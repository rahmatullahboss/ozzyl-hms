import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requirePermission } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { executeLiveCashCustodyMovement } from '../../lib/canonical/live-cash-custody';
import { auditRequestMetadata, prepareMasterDataAudit } from '../../lib/master-data-audit';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../lib/accounting-posting';
import legacyBillingCounterRoutes from './billingCounter.legacy';

export { BILLING_COUNTER_PERMISSIONS } from './billingCounter.legacy';
export type { BillingCounterPermission } from './billingCounter.legacy';

type CloseRequestBody = {
  closingCash?: number;
  handoverAmount?: number;
  handoverTo?: number | null;
  handoverPurpose?: 'shift_transfer' | 'management_collection';
  remarks?: string;
};

type LegacyCloseResponse = {
  sessionId?: number;
  closingCash?: number;
  heldRefundCash?: number;
  availableCash?: number;
  handoverAmount?: number;
  handoverTotal?: number;
  handoverDueAmount?: number;
  handoverStatus?: string;
  varianceApprovalRequired?: boolean;
  varianceApprovalStatus?: string;
  handoverCreated?: boolean;
  [key: string]: unknown;
};

type CounterSessionReviewRow = {
  id: number;
  status: string;
  counter_id: number | null;
  employee_id: number;
  variance: number | null;
  variance_approval_required: number | null;
  variance_approval_status: string | null;
};

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();

function finiteAmount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function resolveHandoverPurpose(
  db: D1Database,
  tenantId: string,
  recipientId: number | null,
  requestedPurpose?: CloseRequestBody['handoverPurpose'],
): Promise<'shift_transfer' | 'management_collection'> {
  if (requestedPurpose === 'shift_transfer' || requestedPurpose === 'management_collection') {
    return requestedPurpose;
  }
  if (!recipientId) return 'shift_transfer';

  const recipient = await db.prepare(`
    SELECT role
    FROM users
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(tenantId, recipientId).first<{ role?: string | null }>();
  const role = String(recipient?.role ?? '');
  return ['reception', 'receptionist', 'manager'].includes(role)
    ? 'shift_transfer'
    : 'management_collection';
}

function queueAccountingPosting(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  tenantId: string,
): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post nonblocking counter variance handover:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

/**
 * Compatibility middleware around the reviewed legacy close route.
 *
 * The legacy route performs all validation and variance calculation. When it
 * returns a high-variance 202 response, this middleware immediately finalises
 * the operational close and handover while leaving only the audit approval
 * pending. The next cashier can therefore accept the counted cash and work.
 */
routes.post('/sessions/:id/close', async (c, next) => {
  let requestBody: CloseRequestBody = {};
  try {
    requestBody = await c.req.raw.clone().json() as CloseRequestBody;
  } catch {
    // The legacy validator owns request-shape errors.
  }

  await next();

  if (c.res.status !== 202) return;

  let responseBody: LegacyCloseResponse;
  try {
    responseBody = await c.res.clone().json() as LegacyCloseResponse;
  } catch {
    return;
  }

  if (
    responseBody.varianceApprovalRequired !== true
    || responseBody.varianceApprovalStatus !== 'pending'
    || responseBody.handoverCreated === true
  ) {
    return;
  }

  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(responseBody.sessionId ?? c.req.param('id'));
  if (!Number.isInteger(sessionId) || sessionId <= 0) return;

  const recipientIdValue = Number(requestBody.handoverTo ?? 0);
  const recipientId = Number.isInteger(recipientIdValue) && recipientIdValue > 0
    ? recipientIdValue
    : null;
  const handoverPurpose = await resolveHandoverPurpose(
    c.env.DB,
    tenantId,
    recipientId,
    requestBody.handoverPurpose,
  );
  const handoverAmount = finiteAmount(responseBody.handoverAmount ?? requestBody.handoverAmount ?? responseBody.closingCash);
  const handoverTotal = finiteAmount(responseBody.handoverTotal ?? responseBody.closingCash ?? requestBody.closingCash);
  const handoverDueAmount = Math.max(0, finiteAmount(responseBody.handoverDueAmount));
  const handoverStatus = responseBody.handoverStatus === 'partial' ? 'partial' : 'pending';
  const heldRefundCash = finiteAmount(responseBody.heldRefundCash);
  const remarks = requestBody.remarks?.trim() || 'Counter closed with variance pending supervisor review';
  const movementDescription = 'Counter closed - variance pending handover';

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      UPDATE billing_counter_sessions
      SET status = 'closed',
          closed_at = COALESCE(closed_at, datetime('now', '+6 hours')),
          closed_by = COALESCE(closed_by, ?),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND status = 'active'
        AND variance_approval_status = 'pending'
    `).bind(Number(userId), tenantId, sessionId),
    c.env.DB.prepare(`
      INSERT INTO cash_drawer_movements
        (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
      SELECT ?, s.id, s.counter_id, ?, 'handover', ?, 'cash', ?, ?
      FROM billing_counter_sessions s
      WHERE s.tenant_id = ?
        AND s.id = ?
        AND s.status = 'closed'
        AND NOT EXISTS (
          SELECT 1
          FROM cash_drawer_movements m
          WHERE m.tenant_id = s.tenant_id
            AND m.counter_session_id = s.id
            AND m.movement_type = 'handover'
        )
    `).bind(
      tenantId,
      Number(userId),
      handoverAmount,
      movementDescription,
      Number(userId),
      tenantId,
      sessionId,
    ),
    c.env.DB.prepare(`
      INSERT INTO billing_handovers
        (tenant_id, counter_session_id, handover_type, handover_purpose, handover_by, handover_to, handover_amount, due_amount, status, remarks)
      SELECT ?, s.id, 'counter', ?, ?, ?, ?, ?, ?, ?
      FROM billing_counter_sessions s
      WHERE s.tenant_id = ?
        AND s.id = ?
        AND s.status = 'closed'
        AND NOT EXISTS (
          SELECT 1
          FROM billing_handovers h
          WHERE h.tenant_id = s.tenant_id
            AND h.counter_session_id = s.id
            AND h.handover_type = 'counter'
        )
    `).bind(
      tenantId,
      handoverPurpose,
      Number(userId),
      recipientId,
      handoverTotal,
      handoverDueAmount,
      handoverStatus,
      remarks,
      tenantId,
      sessionId,
    ),
  ];

  if (heldRefundCash > 0) {
    statements.push(c.env.DB.prepare(`
      UPDATE billing_refund_cash_holds
      SET custody_user_id = COALESCE(?, employee_id),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND counter_session_id = ?
        AND status = 'held'
    `).bind(recipientId, tenantId, sessionId));
  }

  statements.push(prepareMasterDataAudit(c.env.DB, {
    tenantId,
    userId,
    action: 'UPDATE',
    tableName: 'billing_counter_sessions',
    recordId: sessionId,
    oldValue: {
      status: 'active',
      varianceApprovalStatus: 'pending',
    },
    newValue: {
      status: 'closed',
      varianceApprovalStatus: 'pending',
      handoverCreated: true,
      operationalCloseCompleted: true,
    },
    ...auditRequestMetadata(c),
  }));

  const businessDate = getTodayGMT6();
  if (handoverAmount > 0) {
    await executeLiveCashCustodyMovement(c.env.DB, {
      tenantId,
      legacyStatements: statements,
      custodyType: 'counter_session',
      legacyCounterId: Number(responseBody.counterId ?? 0) || null,
      legacyCounterSessionId: sessionId,
      movementType: 'handover',
      direction: 'out',
      amount: handoverAmount,
      occurredAtUtc: new Date().toISOString(),
      businessDate,
      sourceType: 'legacy_counter_variance_handover',
      sourcePublicId: `counter-session:${sessionId}:variance-handover`,
      sourceTable: 'cash_drawer_movements',
      evidence: {
        sessionId,
        handoverBy: Number(userId),
        handoverTo: recipientId,
        handoverPurpose,
        handoverTotal,
        handoverDueAmount,
        handoverStatus,
      },
    });

    await recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'cash_handover',
      sourceId: `counter-close-${sessionId}`,
      eventType: ACCOUNTING_EVENT_TYPES.cashHandover,
      eventDate: businessDate,
      createdBy: String(userId),
      payload: {
        amount: handoverAmount,
        counterSessionId: sessionId,
        handoverBy: Number(userId),
        handoverTo: recipientId,
        handoverTotal,
        handoverDueAmount,
        source: 'counter_close_variance_pending',
      },
    });
    queueAccountingPosting(c, tenantId);
  } else {
    await c.env.DB.batch(statements);
  }

  c.res = c.json({
    ...responseBody,
    message: 'Billing counter closed; cash variance is pending supervisor review',
    handoverCreated: true,
    operationalCloseCompleted: true,
  }, 202);
});

/**
 * Variance decisions are audit decisions only. They never reopen or re-close
 * the drawer and never recreate or alter the operational handover.
 */
routes.post(
  '/sessions/:id/variance-approvals',
  zValidator('json', z.object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(500).optional(),
  })),
  requirePermission('billing.counter.variance.approve'),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = Number(requireUserId(c));
    const sessionId = Number(c.req.param('id'));
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      throw new HTTPException(400, { message: 'Invalid session id' });
    }
    const data = c.req.valid('json');

    const session = await c.env.DB.prepare(`
      SELECT id, status, counter_id, employee_id, variance,
             variance_approval_required, variance_approval_status
      FROM billing_counter_sessions
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `).bind(tenantId, sessionId).first<CounterSessionReviewRow>();

    if (!session) throw new HTTPException(404, { message: 'Counter session not found' });
    if (!session.variance_approval_required) {
      throw new HTTPException(409, { message: 'This session did not require variance approval' });
    }
    if (session.variance_approval_status === 'approved') {
      return c.json({
        message: 'Variance already approved',
        sessionId,
        status: session.status,
        operationalStateChanged: false,
      });
    }
    if (session.variance_approval_status === 'rejected') {
      return c.json({
        message: 'Variance already rejected for follow-up',
        sessionId,
        status: session.status,
        operationalStateChanged: false,
      });
    }
    if (session.variance_approval_status !== 'pending') {
      throw new HTTPException(409, { message: 'Variance is not pending review' });
    }

    const pendingApproval = await c.env.DB.prepare(`
      SELECT id
      FROM cash_variance_approvals
      WHERE tenant_id = ?
        AND counter_session_id = ?
        AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1
    `).bind(tenantId, sessionId).first<{ id: number }>();
    if (!pendingApproval) {
      throw new HTTPException(409, { message: 'Pending variance approval was not found' });
    }

    const resolutionStatus = data.decision === 'approve' ? 'approved' : 'rejected';
    const resolvedAt = new Date().toISOString();

    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE billing_counter_sessions
        SET approver_user_id = ?,
            variance_approval_status = ?,
            variance_approval_at = ?,
            variance_approval_reason = ?,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND id = ?
          AND variance_approval_status = 'pending'
      `).bind(userId, resolutionStatus, resolvedAt, data.reason ?? null, tenantId, sessionId),
      c.env.DB.prepare(`
        UPDATE cash_variance_approvals
        SET status = ?,
            approver_user_id = ?,
            approved_at = ?,
            reason = COALESCE(?, reason)
        WHERE tenant_id = ?
          AND counter_session_id = ?
          AND status = 'pending'
      `).bind(
        resolutionStatus,
        userId,
        data.decision === 'approve' ? resolvedAt : null,
        data.reason ?? null,
        tenantId,
        sessionId,
      ),
    ]);

    void createAuditLog(c.env, tenantId, String(userId), data.decision === 'approve' ? 'APPROVE' : 'REJECT', 'billing_counter_sessions', sessionId, {
      status: session.status,
      variance: session.variance,
      varianceApprovalStatus: 'pending',
    }, {
      status: session.status,
      variance: session.variance,
      varianceApprovalStatus: resolutionStatus,
      reason: data.reason ?? null,
    });

    return c.json({
      message: data.decision === 'approve'
        ? 'Variance approved; counter operation and handover remain unchanged'
        : 'Variance rejected for follow-up; counter operation and handover remain unchanged',
      sessionId,
      status: session.status,
      decision: data.decision,
      approverUserId: userId,
      handoverCreated: false,
      operationalStateChanged: false,
    });
  },
);

routes.route('/', legacyBillingCounterRoutes);

export default routes;

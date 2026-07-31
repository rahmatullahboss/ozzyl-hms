import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requireRole } from '../../middleware/rbac';
import { requireTenantId } from '../../lib/context-helpers';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import { getTodayGMT6 } from '../../lib/date-utils';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import {
  loadRefundCashDispute,
  recoverRefundDispute,
  shadowRefundDisputeRecovered,
} from '../../lib/billing-refund-dispute';
import {
  recoverRefundDisputeSchema,
  refundDisputeListQuerySchema,
  requestRefundDisputeWriteoffSchema,
} from '../../schemas/refundDispute';
import { createAuditLog } from '../../lib/accounting-helpers';
import {
  isRefundBatchAssertionError,
  prepareClearRefundBatchAssertions,
  prepareRefundBatchAssertion,
} from '../../lib/billing-refund-batch-guard';

const refundDisputes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DISPUTE_REVIEW_ROLES = ['hospital_admin', 'md', 'director', 'manager', 'accountant'] as const;

type RefundDisputeDetailRow = {
  id: number;
  tenant_id: string;
  refund_cash_hold_id: number;
  approval_request_id: number;
  bill_id: number;
  requester_user_id: number;
  requester_name: string | null;
  requester_email: string | null;
  amount: number;
  status: string;
  rejection_reason: string;
  rejected_by: number;
  rejected_by_name: string | null;
  rejected_at: string | null;
  custody_user_id: number | null;
  custody_user_name: string | null;
  counter_id: number;
  counter_session_id: number;
  dispute_cash_movement_id: number | null;
  settlement_method: string | null;
  settlement_reference_type: string | null;
  settlement_reference_id: number | null;
  settlement_idempotency_key: string | null;
  settled_by: number | null;
  settled_by_name: string | null;
  settled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  invoice_no: string | null;
  patient_id: number | null;
  patient_name: string | null;
  original_approval_status: string | null;
  original_request_data: string | null;
  hold_status: string | null;
};

const DETAIL_SELECT = `
  SELECT
    dispute.*,
    requester.name AS requester_name,
    requester.email AS requester_email,
    rejector.name AS rejected_by_name,
    custody.name AS custody_user_name,
    settler.name AS settled_by_name,
    bill.invoice_no,
    bill.patient_id,
    patient.name AS patient_name,
    approval.status AS original_approval_status,
    approval.request_data AS original_request_data,
    hold.status AS hold_status
  FROM billing_refund_cash_disputes dispute
  LEFT JOIN users requester
    ON requester.tenant_id = dispute.tenant_id
   AND requester.id = dispute.requester_user_id
  LEFT JOIN users rejector
    ON rejector.tenant_id = dispute.tenant_id
   AND rejector.id = dispute.rejected_by
  LEFT JOIN users custody
    ON custody.tenant_id = dispute.tenant_id
   AND custody.id = dispute.custody_user_id
  LEFT JOIN users settler
    ON settler.tenant_id = dispute.tenant_id
   AND settler.id = dispute.settled_by
  LEFT JOIN bills bill
    ON bill.tenant_id = dispute.tenant_id
   AND bill.id = dispute.bill_id
  LEFT JOIN patients patient
    ON patient.tenant_id = dispute.tenant_id
   AND patient.id = bill.patient_id
  LEFT JOIN approval_requests approval
    ON approval.tenant_id = dispute.tenant_id
   AND approval.id = dispute.approval_request_id
  LEFT JOIN billing_refund_cash_holds hold
    ON hold.tenant_id = dispute.tenant_id
   AND hold.id = dispute.refund_cash_hold_id
`;

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function serializeDispute(row: RefundDisputeDetailRow) {
  return {
    id: Number(row.id),
    refundCashHoldId: Number(row.refund_cash_hold_id),
    approvalRequestId: Number(row.approval_request_id),
    billId: Number(row.bill_id),
    invoiceNo: row.invoice_no ?? null,
    patientId: row.patient_id == null ? null : Number(row.patient_id),
    patientName: row.patient_name ?? null,
    requesterUserId: Number(row.requester_user_id),
    requesterName: row.requester_name ?? `User #${row.requester_user_id}`,
    requesterEmail: row.requester_email ?? null,
    amount: Number(row.amount),
    status: String(row.status),
    rejectionReason: String(row.rejection_reason),
    rejectedBy: Number(row.rejected_by),
    rejectedByName: row.rejected_by_name ?? `User #${row.rejected_by}`,
    rejectedAt: row.rejected_at ?? null,
    custodyUserId: row.custody_user_id == null ? null : Number(row.custody_user_id),
    custodyUserName: row.custody_user_name ?? null,
    counterId: Number(row.counter_id),
    counterSessionId: Number(row.counter_session_id),
    disputeCashMovementId: row.dispute_cash_movement_id == null ? null : Number(row.dispute_cash_movement_id),
    holdStatus: row.hold_status ?? null,
    originalApprovalStatus: row.original_approval_status ?? null,
    originalRequestData: parseJsonRecord(row.original_request_data),
    settlementMethod: row.settlement_method ?? null,
    settlementReferenceType: row.settlement_reference_type ?? null,
    settlementReferenceId: row.settlement_reference_id == null ? null : Number(row.settlement_reference_id),
    settledBy: row.settled_by == null ? null : Number(row.settled_by),
    settledByName: row.settled_by_name ?? null,
    settledAt: row.settled_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

refundDisputes.get('/', requireRole(...DISPUTE_REVIEW_ROLES), async (c) => {
  const parsed = refundDisputeListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const tenantId = requireTenantId(c);
  const { status, requesterUserId, page, limit } = parsed.data;
  const filters = ['dispute.tenant_id = ?'];
  const bindings: Array<string | number> = [tenantId];
  if (status !== 'all') {
    filters.push('dispute.status = ?');
    bindings.push(status);
  }
  if (requesterUserId != null) {
    filters.push('dispute.requester_user_id = ?');
    bindings.push(requesterUserId);
  }
  const where = filters.join(' AND ');
  const offset = (page - 1) * limit;
  const [{ results }, countRow] = await Promise.all([
    c.env.DB.prepare(`${DETAIL_SELECT} WHERE ${where} ORDER BY dispute.created_at DESC, dispute.id DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, limit, offset).all<RefundDisputeDetailRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM billing_refund_cash_disputes dispute WHERE ${where}`)
      .bind(...bindings).first<{ total: number }>(),
  ]);
  const total = Number(countRow?.total ?? 0);
  return c.json({
    data: (results ?? []).map(serializeDispute),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

refundDisputes.get('/:id', requireRole(...DISPUTE_REVIEW_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid refund dispute ID' }, 400);
  const tenantId = requireTenantId(c);
  const row = await c.env.DB.prepare(`${DETAIL_SELECT} WHERE dispute.tenant_id = ? AND dispute.id = ? LIMIT 1`)
    .bind(tenantId, id).first<RefundDisputeDetailRow>();
  if (!row) return c.json({ error: 'Refund cash dispute not found' }, 404);
  return c.json({ data: serializeDispute(row) });
});

refundDisputes.post('/:id/recover', requireRole(...DISPUTE_REVIEW_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid refund dispute ID' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = recoverRefundDisputeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const tenantId = requireTenantId(c);
  const userId = Number(c.get('userId'));
  const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, String(userId), {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeSession) {
    return c.json({ error: 'Activate a billing counter on this workstation before recovering disputed cash.' }, 409);
  }

  try {
    const eventDate = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, eventDate, 'Refund dispute cash recovery');
    const recovered = await recoverRefundDispute(c.env.DB, {
      tenantId,
      disputeId: id,
      destinationCounterSessionId: activeSession.id,
      destinationCounterId: activeSession.counter_id,
      destinationEmployeeId: userId,
      recoveredBy: userId,
      idempotencyKey: parsed.data.idempotencyKey,
      notes: parsed.data.notes,
      eventDate,
    });
    await shadowRefundDisputeRecovered(c.env.DB, recovered, {
      counterSessionId: activeSession.id,
      counterId: activeSession.counter_id,
      employeeId: userId,
    }, userId);
    void createAuditLog(c.env, tenantId, String(userId), 'COLLECT', 'billing_refund_cash_disputes', id, null, {
      status: recovered.status,
      amount: recovered.amount,
      counterId: activeSession.counter_id,
      counterSessionId: activeSession.id,
      notes: parsed.data.notes ?? null,
    });
    return c.json({ data: recovered });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message) ? 404 : 409;
    return c.json({ error: message }, status);
  }
});

refundDisputes.post('/:id/writeoff-request', requireRole(...DISPUTE_REVIEW_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid refund dispute ID' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = requestRefundDisputeWriteoffSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const tenantId = requireTenantId(c);
  const userId = Number(c.get('userId'));
  const dispute = await loadRefundCashDispute(c.env.DB, tenantId, id);
  if (!dispute) return c.json({ error: 'Refund cash dispute not found' }, 404);
  if (dispute.status === 'writeoff_pending'
    && dispute.settlementIdempotencyKey === parsed.data.idempotencyKey
    && dispute.settlementReferenceId != null) {
    return c.json({
      data: {
        dispute,
        approvalRequestId: dispute.settlementReferenceId,
        idempotent: true,
      },
    });
  }
  if (dispute.status !== 'open') {
    return c.json({ error: `Refund cash dispute cannot request write-off from status ${dispute.status}` }, 409);
  }

  const requestData = {
    kind: 'refund_dispute_writeoff',
    refundDisputeId: dispute.id,
    refundCashHoldId: dispute.refundCashHoldId,
    originalRefundApprovalRequestId: dispute.approvalRequestId,
    billId: dispute.billId,
    requesterUserId: dispute.requesterUserId,
    amount: dispute.amount,
    reason: parsed.data.reason,
    evidence: parsed.data.evidence ?? {},
    writeoffRequestIdempotencyKey: parsed.data.idempotencyKey,
  };
  const approvalLookup = `
    SELECT id
    FROM approval_requests
    WHERE tenant_id = ?
      AND type = 'manual_adjustment'
      AND json_extract(request_data, '$.kind') = 'refund_dispute_writeoff'
      AND json_extract(request_data, '$.writeoffRequestIdempotencyKey') = ?
    ORDER BY id DESC
    LIMIT 1
  `;
  const operationKey = `refund-writeoff-request:${id}:${parsed.data.idempotencyKey}`;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO approval_requests (
          tenant_id, type, entity_id, entity_no, requested_by,
          request_data, status, execution_status
        )
        SELECT ?, 'manual_adjustment', ?, ?, ?, ?, 'pending', 'pending'
        WHERE EXISTS (
          SELECT 1
          FROM billing_refund_cash_disputes current_dispute
          WHERE current_dispute.tenant_id = ?
            AND current_dispute.id = ?
            AND current_dispute.status = 'open'
        )
          AND NOT EXISTS (${approvalLookup})
      `).bind(
        tenantId,
        dispute.id,
        `RCD-${dispute.id}`,
        userId,
        JSON.stringify(requestData),
        tenantId,
        dispute.id,
        tenantId,
        parsed.data.idempotencyKey,
      ),
      prepareRefundBatchAssertion(c.env.DB, {
        tenantId,
        operationKey,
        stepKey: 'approval',
        expectedChanges: 1,
      }),
      c.env.DB.prepare(`
        UPDATE billing_refund_cash_disputes
        SET status = 'writeoff_pending',
            settlement_method = 'authorized_writeoff',
            settlement_reference_type = 'approval_request',
            settlement_reference_id = (${approvalLookup}),
            settlement_idempotency_key = ?,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND id = ?
          AND status = 'open'
          AND EXISTS (${approvalLookup})
      `).bind(
        tenantId,
        parsed.data.idempotencyKey,
        parsed.data.idempotencyKey,
        tenantId,
        id,
        tenantId,
        parsed.data.idempotencyKey,
      ),
      prepareRefundBatchAssertion(c.env.DB, {
        tenantId,
        operationKey,
        stepKey: 'dispute-state',
        expectedChanges: 1,
      }),
      c.env.DB.prepare(`
        INSERT INTO approval_events (
          tenant_id, approval_request_id, action, actor_id,
          old_status, new_status, notes, metadata
        )
        SELECT ?, (${approvalLookup}), 'created', ?, NULL, 'pending', ?, ?
        WHERE EXISTS (${approvalLookup})
          AND NOT EXISTS (
            SELECT 1 FROM approval_events event
            WHERE event.tenant_id = ?
              AND event.approval_request_id = (${approvalLookup})
              AND event.action = 'created'
          )
      `).bind(
        tenantId,
        tenantId,
        parsed.data.idempotencyKey,
        userId,
        parsed.data.reason,
        JSON.stringify({ refundDisputeId: dispute.id, amount: dispute.amount, kind: 'refund_dispute_writeoff' }),
        tenantId,
        parsed.data.idempotencyKey,
        tenantId,
        tenantId,
        parsed.data.idempotencyKey,
      ),
      prepareRefundBatchAssertion(c.env.DB, {
        tenantId,
        operationKey,
        stepKey: 'approval-event',
        expectedChanges: 1,
      }),
      prepareClearRefundBatchAssertions(c.env.DB, tenantId, operationKey),
    ]);
  } catch (error) {
    if (isRefundBatchAssertionError(error)) {
      return c.json({ error: 'Refund dispute write-off request could not be created because its state changed. Refresh and try again.' }, 409);
    }
    throw error;
  }
  const updated = await loadRefundCashDispute(c.env.DB, tenantId, id);
  if (!updated || updated.status !== 'writeoff_pending' || updated.settlementReferenceId == null) {
    return c.json({ error: 'Refund dispute write-off request could not be verified' }, 409);
  }
  void createAuditLog(c.env, tenantId, String(userId), 'CREATE', 'billing_refund_cash_disputes', id, dispute, {
    status: updated.status,
    approvalRequestId: updated.settlementReferenceId,
    reason: parsed.data.reason,
  });
  return c.json({
    data: {
      dispute: updated,
      approvalRequestId: updated.settlementReferenceId,
      idempotent: false,
    },
  }, 201);
});

export default refundDisputes;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import {
  createLabMachineSchema,
  updateLabMachineSchema,
  createMachineTestMapSchema,
  updateMachineTestMapSchema,
  bulkMachineTestMapSchema,
  machineResultSchema,
  hl7MessageReceiveSchema,
  astmMessageReceiveSchema,
  sendOrdersSchema,
  acknowledgeOrderSchema,
  bridgeAgentHeartbeatSchema,
  resolveUnmatchedResultSchema,
} from '../../schemas/labMachine';
import { parseHL7Message, mapHL7AbnormalFlag, mapHL7ResultStatus, validateHL7ClinicalMessage } from '../../lib/hl7-parser';
import { parseASTMMessage, mapASTMAbnormalFlag, mapASTMResultStatus } from '../../lib/astm-parser';
import { buildLisMessageIdentity, classifyReplay, resolveLisSourceIdentity, selectExactCandidate, sha256Hex } from '../../lib/lis-ingestion';
import { interpretNumericLisResult, normalizeAnalyzerAbnormalFlag } from '../../lib/lis-clinical-mapping';
import { evaluateLisQcGate, type LisQcState } from '../../lib/lis-qc-gate';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import {
  getDiagnosticBillingClearance,
  getDiagnosticBillingColumns,
  getDiagnosticBillingJoin,
} from '../../lib/diagnostic-billing';
import {
  deriveMachineResultWorkflowState,
  getLabMachineCapabilities,
} from '../../lib/lab-machine-capabilities';
import { buildLabMiddlewareConfigSnippet, listLabAnalyzerProfiles, suggestAnalyzerProfileDefaults } from '../../lib/lab-analyzer-profiles';
import { consumeMappedLabConsumables } from '../../lib/lab-consumables';
import { getLabInventoryPolicy, shouldBlockLabInventoryException, shouldConsumeLabReagentsForEvent } from '../../lib/lab-inventory-policy';
import { validateLabResult } from './labValidation';
import { acceptStagedLisResult, LisAcceptanceError } from '../../services/lis-result-acceptance';
import { acknowledgeLisCriticalEvent, LisCriticalEventError } from '../../services/lis-critical-events';
import {
  canViewLisInbox,
  rejectStagedLisResult,
  LisInboxReviewError,
} from '../../services/lis-inbox-review';
import {
  canCreateLisInboxSupersession,
  createLisInboxSupersession,
  LisInboxSupersessionError,
} from '../../services/lis-inbox-supersession';
import {
  approveLisResultRetraction,
  canManageLisResultRetraction,
  rejectLisResultRetraction,
  requestLisResultRetraction,
  LisResultRetractionError,
} from '../../services/lis-result-retraction';
import { dispatchLisRetractionNotifications } from '../../services/lis-retraction-notification-dispatch';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid ID' });
  return id;
}

const LIS_INBOX_DISPOSITIONS = new Set([
  'all',
  'staged',
  'review_required',
  'acceptance_eligible',
  'unmatched',
  'ambiguous',
  'qc_blocked',
  'validation_blocked',
  'quarantined',
  'accepted',
  'rejected',
]);

function requireLisInboxViewer(c: any): void {
  if (!canViewLisInbox(String(c.get('role') ?? ''))) {
    throw new HTTPException(403, { message: 'LIS analyzer inbox access denied' });
  }
}

function parseOptionalJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function lisInboxFromClause(): string {
  return `
    FROM lis_analyzer_inbox inbox
    JOIN lis_ingestion_messages message
      ON message.id = inbox.ingestion_message_id
     AND message.tenant_id = inbox.tenant_id
    LEFT JOIN lab_machines machine
      ON machine.id = inbox.machine_id
     AND machine.tenant_id = inbox.tenant_id
    LEFT JOIN lab_order_items item
      ON item.id = inbox.lab_order_item_id
     AND item.tenant_id = inbox.tenant_id
    LEFT JOIN lab_orders lab_order
      ON lab_order.id = item.lab_order_id
     AND lab_order.tenant_id = inbox.tenant_id
    LEFT JOIN patients patient
      ON patient.id = inbox.patient_id
     AND patient.tenant_id = inbox.tenant_id
    LEFT JOIN lab_test_catalog test
      ON test.id = inbox.lab_test_id
     AND test.tenant_id = inbox.tenant_id
  `;
}

/** GET /inbox — tenant-scoped analyzer evidence work queue */
routes.get('/inbox', async (c) => {
  requireLisInboxViewer(c);
  const tenantId = requireTenantId(c);
  const disposition = String(c.req.query('disposition') ?? 'review_required').trim().toLowerCase();
  if (!LIS_INBOX_DISPOSITIONS.has(disposition)) {
    return c.json({ error: 'Invalid analyzer inbox disposition', code: 'invalid_disposition' }, 400);
  }

  const machineIdRaw = c.req.query('machineId') ?? c.req.query('machine_id');
  const machineId = machineIdRaw ? parseId(machineIdRaw) : null;
  const criticalRaw = String(c.req.query('critical') ?? '').trim().toLowerCase();
  const critical = criticalRaw === '' || criticalRaw === 'all'
    ? null
    : criticalRaw === 'true' || criticalRaw === '1'
      ? 1
      : criticalRaw === 'false' || criticalRaw === '0'
        ? 0
        : NaN;
  if (Number.isNaN(critical)) {
    return c.json({ error: 'critical must be true, false, or all', code: 'invalid_critical_filter' }, 400);
  }

  const q = String(c.req.query('q') ?? '').trim();
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '25', 10) || 25));
  const offset = (page - 1) * limit;

  const conditions = ['inbox.tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (disposition !== 'all') {
    conditions.push('inbox.disposition = ?');
    params.push(disposition);
  }
  if (machineId != null) {
    conditions.push('inbox.machine_id = ?');
    params.push(machineId);
  }
  if (critical != null) {
    conditions.push('inbox.critical_flag = ?');
    params.push(critical);
  }
  if (q) {
    const like = `%${q}%`;
    conditions.push(`(
      patient.name LIKE ? OR patient.patient_code LIKE ? OR lab_order.order_no LIKE ?
      OR inbox.identifier_value LIKE ? OR inbox.machine_test_code LIKE ?
      OR inbox.machine_test_name LIKE ? OR test.name LIKE ? OR test.code LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like);
  }

  const from = lisInboxFromClause();
  const where = `WHERE ${conditions.join('\n      AND ')}`;
  const select = `
    SELECT
      inbox.id, inbox.state_version, inbox.disposition, inbox.disposition_reason,
      inbox.match_state, inbox.qc_state, inbox.validation_state, inbox.critical_flag,
      inbox.raw_value, inbox.raw_units, inbox.raw_reference_range,
      inbox.normalized_value, inbox.normalized_numeric, inbox.normalized_units,
      inbox.selected_reference_range, inbox.normalized_interpretation,
      inbox.normalized_result_status, inbox.machine_test_code, inbox.machine_test_name,
      inbox.machine_id, machine.machine_name, machine.machine_code,
      inbox.patient_id, patient.name AS patient_name, patient.patient_code,
      item.lab_order_id, lab_order.order_no, inbox.lab_order_item_id,
      inbox.lab_test_id, test.name AS test_name, test.code AS test_code,
      message.protocol, message.status AS ingestion_status,
      inbox.created_at, inbox.updated_at
    ${from}
    ${where}
    ORDER BY inbox.critical_flag DESC, inbox.created_at ASC, inbox.id ASC
    LIMIT ? OFFSET ?
  `;

  const countSql = `SELECT COUNT(*) AS total ${from} ${where}`;
  const [listResult, countRow, summaryResult] = await Promise.all([
    c.env.DB.prepare(select).bind(...params, limit, offset).all(),
    c.env.DB.prepare(countSql).bind(...params).first<{ total: number }>(),
    c.env.DB.prepare(`
      SELECT inbox.disposition, COUNT(*) AS total,
             SUM(CASE WHEN inbox.critical_flag = 1 THEN 1 ELSE 0 END) AS critical
      FROM lis_analyzer_inbox inbox
      WHERE inbox.tenant_id = ?
        AND (? IS NULL OR inbox.machine_id = ?)
      GROUP BY inbox.disposition
    `).bind(tenantId, machineId, machineId).all(),
  ]);

  const summary: Record<string, { total: number; critical: number }> = {};
  for (const row of summaryResult.results as Array<Record<string, unknown>>) {
    summary[String(row.disposition)] = {
      total: Number(row.total ?? 0),
      critical: Number(row.critical ?? 0),
    };
  }
  const total = Number(countRow?.total ?? 0);
  return c.json({
    data: listResult.results,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    summary,
  });
});

/** GET /inbox/:inboxId/targets — safe same-test rematch candidates */
routes.get('/inbox/:inboxId{[0-9]+}/targets', async (c) => {
  const requesterRole = String(c.get('role') ?? '');
  if (!canCreateLisInboxSupersession(requesterRole)) {
    return c.json({ error: 'Clinical supersession access denied', code: 'supersession_forbidden' }, 403);
  }

  const tenantId = requireTenantId(c);
  const inboxId = parseId(c.req.param('inboxId'));
  const source = await c.env.DB.prepare(`
    SELECT
      source.id, source.disposition, source.lab_order_item_id,
      source.lab_test_id, source.machine_test_code,
      successor.id AS successor_id
    FROM lis_analyzer_inbox source
    LEFT JOIN lis_analyzer_inbox successor
      ON successor.tenant_id = source.tenant_id
     AND successor.supersedes_inbox_id = source.id
    WHERE source.id = ? AND source.tenant_id = ?
  `).bind(inboxId, tenantId).first<Record<string, unknown>>();

  if (!source) {
    return c.json({ error: 'Source analyzer evidence not found', code: 'source_not_found' }, 404);
  }
  if (source.successor_id != null) {
    return c.json({ error: 'This analyzer evidence already has a direct successor', code: 'supersession_exists' }, 409);
  }

  const q = String(c.req.query('q') ?? '').trim();
  const params: unknown[] = [inboxId, tenantId, tenantId];
  let searchSql = '';
  if (q) {
    const like = `%${q}%`;
    searchSql = `
      AND (
        target_order.order_no LIKE ?
        OR target_patient.name LIKE ?
        OR target_patient.patient_code LIKE ?
        OR target_test.name LIKE ?
        OR target_test.code LIKE ?
        OR CAST(target_item.id AS TEXT) LIKE ?
      )
    `;
    params.push(like, like, like, like, like, like);
  }

  const candidates = await c.env.DB.prepare(`
    SELECT
      target_item.id,
      target_item.tenant_id,
      target_item.lab_order_id,
      target_item.lab_test_id,
      target_item.specimen_id,
      target_item.status,
      target_order.patient_id,
      target_order.order_no,
      target_test.name AS test_name,
      target_test.code AS test_code,
      target_patient.name AS patient_name,
      target_patient.patient_code
    FROM lis_analyzer_inbox source
    JOIN lab_order_items target_item
      ON target_item.tenant_id = source.tenant_id
    JOIN lab_orders target_order
      ON target_order.id = target_item.lab_order_id
     AND target_order.tenant_id = target_item.tenant_id
    JOIN lab_test_catalog target_test
      ON target_test.id = target_item.lab_test_id
     AND target_test.tenant_id = target_item.tenant_id
    LEFT JOIN patients target_patient
      ON target_patient.id = target_order.patient_id
     AND target_patient.tenant_id = target_item.tenant_id
    WHERE source.id = ?
      AND source.tenant_id = ?
      AND target_item.tenant_id = ?
      AND (
        COALESCE(target_item.status, 'pending') NOT IN ('cancelled', 'canceled', 'refunded', 'rejected')
        OR (
          source.disposition = 'accepted'
          AND target_item.id = source.lab_order_item_id
          AND target_item.status = 'rejected'
          AND target_item.result_status = 'retracted'
          AND EXISTS (
            SELECT 1
            FROM lis_result_retraction_requests applied_retraction
            WHERE applied_retraction.tenant_id = source.tenant_id
              AND applied_retraction.lis_analyzer_inbox_id = source.id
              AND applied_retraction.status = 'applied'
          )
        )
      )
      AND (source.lab_test_id IS NULL OR target_item.lab_test_id = source.lab_test_id)
      AND (
        source.disposition <> 'accepted'
        OR target_item.id = source.lab_order_item_id
        OR EXISTS (
          SELECT 1
          FROM lis_result_retraction_requests applied_retraction
          WHERE applied_retraction.tenant_id = source.tenant_id
            AND applied_retraction.lis_analyzer_inbox_id = source.id
            AND applied_retraction.status = 'applied'
        )
      )
      ${searchSql}
    ORDER BY
      CASE WHEN target_item.id = source.lab_order_item_id THEN 0 ELSE 1 END,
      target_order.order_date DESC,
      target_item.id DESC
    LIMIT 20
  `).bind(...params).all();

  return c.json({ data: candidates.results });
});

/** POST /inbox/:inboxId/supersede — create an immutable corrected/rematched review */
routes.post('/inbox/:inboxId{[0-9]+}/supersede', async (c) => {
  const tenantId = requireTenantId(c);
  const requestedBy = requireUserId(c);
  const requesterRole = String(c.get('role') ?? '');
  const sourceInboxId = parseId(c.req.param('inboxId'));
  const body: {
    expectedVersion?: unknown;
    targetLabOrderItemId?: unknown;
    reason?: unknown;
    qcOverrideReason?: unknown;
    validationOverrideReason?: unknown;
  } = await c.req.json().catch(() => ({}));

  try {
    const result = await createLisInboxSupersession(c.env.DB, {
      tenantId,
      sourceInboxId,
      expectedVersion: Number(body.expectedVersion),
      targetLabOrderItemId: Number(body.targetLabOrderItemId),
      requestedBy,
      requesterRole,
      reason: typeof body.reason === 'string' ? body.reason : '',
      qcOverrideReason: typeof body.qcOverrideReason === 'string' ? body.qcOverrideReason : null,
      validationOverrideReason: typeof body.validationOverrideReason === 'string'
        ? body.validationOverrideReason
        : null,
    });
    return c.json({ message: 'Superseding analyzer review created', result });
  } catch (error) {
    if (error instanceof LisInboxSupersessionError) {
      return c.json(
        { error: error.message, code: error.code },
        error.status as 400 | 403 | 404 | 409,
      );
    }
    throw error;
  }
});

/** GET /retraction-notification-outbox — governance delivery monitoring */
routes.get('/retraction-notification-outbox', async (c) => {
  const reviewerRole = String(c.get('role') ?? '');
  if (!canManageLisResultRetraction(reviewerRole)) {
    return c.json({ error: 'Retraction notification access denied', code: 'retraction_notification_forbidden' }, 403);
  }

  const tenantId = requireTenantId(c);
  const status = String(c.req.query('status') ?? 'all').trim().toLowerCase();
  if (!['pending', 'processing', 'sent', 'failed', 'all'].includes(status)) {
    return c.json({ error: 'Invalid notification status', code: 'invalid_notification_status' }, 400);
  }
  const includeDeliveries = String(c.req.query('includeDeliveries') ?? 'false').toLowerCase() === 'true';
  const outboxIdRaw = c.req.query('outboxId');
  const outboxId = outboxIdRaw ? parseId(outboxIdRaw) : null;
  const machineIdRaw = c.req.query('machineId') ?? c.req.query('machine_id');
  const machineId = machineIdRaw ? parseId(machineIdRaw) : null;
  const conditions = ['outbox.tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (status !== 'all') {
    conditions.push('outbox.status = ?');
    params.push(status);
  }
  if (outboxId != null) {
    conditions.push('outbox.id = ?');
    params.push(outboxId);
  }
  if (machineId != null) {
    conditions.push('inbox.machine_id = ?');
    params.push(machineId);
  }

  const outboxRows = await c.env.DB.prepare(`
    SELECT
      outbox.id,
      outbox.retraction_request_id,
      outbox.status,
      outbox.attempt_count,
      outbox.last_error,
      outbox.next_attempt_at,
      outbox.sent_at,
      outbox.manual_retry_count,
      outbox.last_manual_retry_by,
      outbox.last_manual_retry_at,
      outbox.created_at,
      outbox.updated_at,
      request.lab_report_id,
      request.lab_order_id,
      request.patient_id,
      request.reason_code,
      request.reason,
      patient.name AS patient_name,
      patient.patient_code,
      lab_order.order_no,
      (
        SELECT COUNT(*)
        FROM lis_result_retraction_notification_deliveries delivery
        WHERE delivery.outbox_id = outbox.id
          AND delivery.tenant_id = outbox.tenant_id
      ) AS delivery_total,
      (
        SELECT COUNT(*)
        FROM lis_result_retraction_notification_deliveries delivery
        WHERE delivery.outbox_id = outbox.id
          AND delivery.tenant_id = outbox.tenant_id
          AND delivery.status = 'sent'
      ) AS delivery_sent,
      (
        SELECT COUNT(*)
        FROM lis_result_retraction_notification_deliveries delivery
        WHERE delivery.outbox_id = outbox.id
          AND delivery.tenant_id = outbox.tenant_id
          AND delivery.status = 'failed'
      ) AS delivery_failed,
      (
        SELECT COUNT(*)
        FROM lis_result_retraction_notification_deliveries delivery
        WHERE delivery.outbox_id = outbox.id
          AND delivery.tenant_id = outbox.tenant_id
          AND delivery.status IN ('pending', 'processing')
      ) AS delivery_active
    FROM lis_result_retraction_notification_outbox outbox
    JOIN lis_result_retraction_requests request
      ON request.id = outbox.retraction_request_id
     AND request.tenant_id = outbox.tenant_id
    JOIN lis_analyzer_inbox inbox
      ON inbox.id = request.lis_analyzer_inbox_id
     AND inbox.tenant_id = outbox.tenant_id
    LEFT JOIN patients patient
      ON patient.id = request.patient_id
     AND patient.tenant_id = outbox.tenant_id
    LEFT JOIN lab_orders lab_order
      ON lab_order.id = request.lab_order_id
     AND lab_order.tenant_id = outbox.tenant_id
    WHERE ${conditions.join('\n      AND ')}
    ORDER BY
      CASE outbox.status WHEN 'failed' THEN 0 WHEN 'processing' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
      outbox.created_at ASC,
      outbox.id ASC
    LIMIT 100
  `).bind(...params).all();

  let deliveries: unknown[] = [];
  if (includeDeliveries) {
    const deliveryConditions = ['delivery.tenant_id = ?'];
    const deliveryParams: unknown[] = [tenantId];
    if (outboxId != null) {
      deliveryConditions.push('delivery.outbox_id = ?');
      deliveryParams.push(outboxId);
    } else if (status !== 'all') {
      deliveryConditions.push(`EXISTS (
        SELECT 1
        FROM lis_result_retraction_notification_outbox parent_outbox
        WHERE parent_outbox.id = delivery.outbox_id
          AND parent_outbox.tenant_id = delivery.tenant_id
          AND parent_outbox.status = ?
      )`);
      deliveryParams.push(status);
    }
    if (machineId != null) {
      deliveryConditions.push(`EXISTS (
        SELECT 1
        FROM lis_result_retraction_notification_outbox machine_outbox
        JOIN lis_result_retraction_requests machine_request
          ON machine_request.id = machine_outbox.retraction_request_id
         AND machine_request.tenant_id = machine_outbox.tenant_id
        JOIN lis_analyzer_inbox machine_inbox
          ON machine_inbox.id = machine_request.lis_analyzer_inbox_id
         AND machine_inbox.tenant_id = machine_outbox.tenant_id
        WHERE machine_outbox.id = delivery.outbox_id
          AND machine_outbox.tenant_id = delivery.tenant_id
          AND machine_inbox.machine_id = ?
      )`);
      deliveryParams.push(machineId);
    }

    const deliveryRows = await c.env.DB.prepare(`
      SELECT
        delivery.id,
        delivery.outbox_id,
        delivery.channel,
        delivery.recipient_type,
        delivery.recipient_id,
        delivery.delivery_key,
        delivery.status,
        delivery.attempt_count,
        delivery.processing_started_at,
        delivery.next_attempt_at,
        delivery.provider_message_id,
        delivery.last_error,
        delivery.sent_at,
        delivery.created_at,
        delivery.updated_at
      FROM lis_result_retraction_notification_deliveries delivery
      WHERE ${deliveryConditions.join('\n        AND ')}
      ORDER BY delivery.outbox_id ASC, delivery.id ASC
      LIMIT 500
    `).bind(...deliveryParams).all();
    deliveries = deliveryRows.results;
  }

  return c.json({ data: outboxRows.results, deliveries });
});

/** POST /retraction-notification-outbox/:outboxId/retry — accountable terminal retry */
routes.post('/retraction-notification-outbox/:outboxId{[0-9]+}/retry', async (c) => {
  const reviewerRole = String(c.get('role') ?? '');
  if (!canManageLisResultRetraction(reviewerRole)) {
    return c.json({ error: 'Retraction notification access denied', code: 'retraction_notification_forbidden' }, 403);
  }

  const tenantId = requireTenantId(c);
  const reviewerUserId = requireUserId(c);
  const outboxId = parseId(c.req.param('outboxId'));
  const body: { reason?: unknown } = await c.req.json().catch(() => ({}));
  const retryReason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (retryReason.length < 10 || retryReason.length > 1000) {
    return c.json({ error: 'A clear manual retry reason is required', code: 'invalid_retry_reason' }, 400);
  }

  const results = await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO lis_result_retraction_notification_retry_commands (
        tenant_id, outbox_id, requested_by, reason, status, created_at
      )
      SELECT ?, outbox.id, ?, ?, 'claimed', CURRENT_TIMESTAMP
      FROM lis_result_retraction_notification_outbox outbox
      WHERE outbox.id = ?
        AND outbox.tenant_id = ?
        AND outbox.status = 'failed'
        AND EXISTS (
          SELECT 1
          FROM lis_result_retraction_notification_deliveries delivery
          WHERE delivery.outbox_id = outbox.id
            AND delivery.tenant_id = outbox.tenant_id
            AND delivery.status = 'failed'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM lis_result_retraction_notification_retry_commands open_command
          WHERE open_command.tenant_id = outbox.tenant_id
            AND open_command.outbox_id = outbox.id
            AND open_command.status = 'claimed'
        )
    `).bind(tenantId, reviewerUserId, retryReason, outboxId, tenantId),
    c.env.DB.prepare(`
      UPDATE lis_result_retraction_notification_outbox
      SET status = 'pending',
          manual_retry_count = manual_retry_count + 1,
          last_manual_retry_by = ?,
          last_manual_retry_reason = ?,
          last_manual_retry_at = CURRENT_TIMESTAMP,
          next_attempt_at = NULL,
          last_error = NULL,
          sent_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND tenant_id = ?
        AND status = 'failed'
        AND EXISTS (
          SELECT 1
          FROM lis_result_retraction_notification_retry_commands command
          WHERE command.tenant_id = lis_result_retraction_notification_outbox.tenant_id
            AND command.outbox_id = lis_result_retraction_notification_outbox.id
            AND command.requested_by = ?
            AND command.reason = ?
            AND command.status = 'claimed'
        )
    `).bind(reviewerUserId, retryReason, outboxId, tenantId, reviewerUserId, retryReason),
    c.env.DB.prepare(`
      UPDATE lis_result_retraction_notification_deliveries
      SET status = 'pending',
          attempt_count = 0,
          processing_started_at = NULL,
          next_attempt_at = NULL,
          provider_message_id = NULL,
          last_error = NULL,
          sent_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE outbox_id = ?
        AND tenant_id = ?
        AND status = 'failed'
        AND EXISTS (
          SELECT 1
          FROM lis_result_retraction_notification_retry_commands command
          WHERE command.tenant_id = lis_result_retraction_notification_deliveries.tenant_id
            AND command.outbox_id = lis_result_retraction_notification_deliveries.outbox_id
            AND command.requested_by = ?
            AND command.reason = ?
            AND command.status = 'claimed'
        )
    `).bind(outboxId, tenantId, reviewerUserId, retryReason),
    c.env.DB.prepare(`
      UPDATE lis_result_retraction_notification_retry_commands
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ?
        AND outbox_id = ?
        AND requested_by = ?
        AND reason = ?
        AND status = 'claimed'
    `).bind(tenantId, outboxId, reviewerUserId, retryReason),
  ]);

  const commandChanges = Number((results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
  if (commandChanges !== 1) {
    return c.json({ error: 'Failed recipient delivery is not recoverable', code: 'notification_retry_not_recoverable' }, 409);
  }

  try {
    c.executionCtx.waitUntil(
      dispatchLisRetractionNotifications(c.env.DB).catch((error) => {
        console.error('Immediate LIS retraction notification retry failed:', error);
      }),
    );
  } catch {
    // Unit/local request contexts may not expose an execution context.
  }

  return c.json({ message: 'Retraction notification retry queued', outboxId });
});

/** GET /retraction-requests — governance queue for accepted-result withdrawal */
routes.get('/retraction-requests', async (c) => {
  const reviewerRole = String(c.get('role') ?? '');
  if (!canManageLisResultRetraction(reviewerRole)) {
    return c.json({ error: 'Result retraction access denied', code: 'retraction_forbidden' }, 403);
  }

  const tenantId = requireTenantId(c);
  const reviewerUserId = requireUserId(c);
  const status = String(c.req.query('status') ?? 'requested').trim().toLowerCase();
  if (!['requested', 'applying', 'applied', 'rejected', 'all'].includes(status)) {
    return c.json({ error: 'Invalid retraction status', code: 'invalid_retraction_status' }, 400);
  }
  const machineIdRaw = c.req.query('machineId') ?? c.req.query('machine_id');
  const machineId = machineIdRaw ? parseId(machineIdRaw) : null;
  const q = String(c.req.query('q') ?? '').trim();
  const conditions = ['request.tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (status !== 'all') {
    conditions.push('request.status = ?');
    params.push(status);
  }
  if (machineId != null) {
    conditions.push('inbox.machine_id = ?');
    params.push(machineId);
  }
  if (q) {
    const like = `%${q}%`;
    conditions.push(`(
      patient.name LIKE ? OR patient.patient_code LIKE ? OR lab_order.order_no LIKE ?
      OR test.name LIKE ? OR test.code LIKE ? OR request.reason LIKE ?
    )`);
    params.push(like, like, like, like, like, like);
  }

  const result = await c.env.DB.prepare(`
    SELECT
      request.id,
      request.lis_analyzer_inbox_id,
      request.lab_result_id,
      request.lab_report_id,
      request.lab_order_item_id,
      request.lab_order_id,
      request.patient_id,
      request.reason_code,
      request.reason,
      request.notes,
      request.status,
      request.state_version,
      request.requested_by,
      request.requester_role,
      request.reviewed_by,
      request.reviewed_at,
      request.review_notes,
      request.created_at,
      CASE
        WHEN request.status = 'requested' AND request.requested_by <> ? THEN 1
        ELSE 0
      END AS can_review,
      inbox.machine_id,
      machine.machine_name,
      machine.machine_code,
      patient.name AS patient_name,
      patient.patient_code,
      lab_order.order_no,
      test.name AS test_name,
      test.code AS test_code,
      result.result_value,
      result.units,
      result.result_status
    FROM lis_result_retraction_requests request
    JOIN lis_analyzer_inbox inbox
      ON inbox.id = request.lis_analyzer_inbox_id
     AND inbox.tenant_id = request.tenant_id
    LEFT JOIN lab_machines machine
      ON machine.id = inbox.machine_id
     AND machine.tenant_id = request.tenant_id
    LEFT JOIN patients patient
      ON patient.id = request.patient_id
     AND patient.tenant_id = request.tenant_id
    LEFT JOIN lab_orders lab_order
      ON lab_order.id = request.lab_order_id
     AND lab_order.tenant_id = request.tenant_id
    LEFT JOIN lab_results result
      ON result.id = request.lab_result_id
     AND result.tenant_id = request.tenant_id
    LEFT JOIN lab_test_catalog test
      ON test.id = result.lab_test_id
     AND test.tenant_id = request.tenant_id
    WHERE ${conditions.join('\n      AND ')}
    ORDER BY request.created_at ASC, request.id ASC
    LIMIT 100
  `).bind(reviewerUserId, ...params).all();

  return c.json({ data: result.results });
});

/** POST /inbox/:inboxId/retraction-requests — request formal withdrawal */
routes.post('/inbox/:inboxId{[0-9]+}/retraction-requests', async (c) => {
  const tenantId = requireTenantId(c);
  const requestedBy = requireUserId(c);
  const requesterRole = String(c.get('role') ?? '');
  const inboxId = parseId(c.req.param('inboxId'));
  const body: {
    expectedInboxVersion?: unknown;
    reasonCode?: unknown;
    reason?: unknown;
    notes?: unknown;
  } = await c.req.json().catch(() => ({}));

  try {
    const result = await requestLisResultRetraction(c.env.DB, {
      tenantId,
      inboxId,
      expectedInboxVersion: Number(body.expectedInboxVersion),
      requestedBy,
      requesterRole,
      reasonCode: typeof body.reasonCode === 'string' ? body.reasonCode : '',
      reason: typeof body.reason === 'string' ? body.reason : '',
      notes: typeof body.notes === 'string' ? body.notes : null,
    });
    return c.json({ message: 'Result retraction requested', result });
  } catch (error) {
    if (error instanceof LisResultRetractionError) {
      return c.json({ error: error.message, code: error.code }, error.status as 400 | 403 | 404 | 409);
    }
    throw error;
  }
});

/** POST /retraction-requests/:requestId/approve — second-person apply */
routes.post('/retraction-requests/:requestId{[0-9]+}/approve', async (c) => {
  const tenantId = requireTenantId(c);
  const reviewedBy = requireUserId(c);
  const reviewerRole = String(c.get('role') ?? '');
  const requestId = parseId(c.req.param('requestId'));
  const body: { expectedVersion?: unknown; reviewNotes?: unknown } = await c.req.json().catch(() => ({}));

  try {
    const result = await approveLisResultRetraction(c.env.DB, {
      tenantId,
      requestId,
      expectedVersion: Number(body.expectedVersion),
      reviewedBy,
      reviewerRole,
      reviewNotes: typeof body.reviewNotes === 'string' ? body.reviewNotes : '',
    });
    try {
      c.executionCtx.waitUntil(
        dispatchLisRetractionNotifications(c.env.DB).catch((error) => {
          console.error('Immediate LIS retraction notification dispatch failed:', error);
        }),
      );
    } catch {
      // Unit/local request contexts may not expose an execution context.
    }
    return c.json({ message: 'Result retraction applied', result });
  } catch (error) {
    if (error instanceof LisResultRetractionError) {
      return c.json({ error: error.message, code: error.code }, error.status as 400 | 403 | 404 | 409);
    }
    throw error;
  }
});

/** POST /retraction-requests/:requestId/reject — accountable rejection */
routes.post('/retraction-requests/:requestId{[0-9]+}/reject', async (c) => {
  const tenantId = requireTenantId(c);
  const reviewedBy = requireUserId(c);
  const reviewerRole = String(c.get('role') ?? '');
  const requestId = parseId(c.req.param('requestId'));
  const body: { expectedVersion?: unknown; reviewNotes?: unknown } = await c.req.json().catch(() => ({}));

  try {
    const result = await rejectLisResultRetraction(c.env.DB, {
      tenantId,
      requestId,
      expectedVersion: Number(body.expectedVersion),
      reviewedBy,
      reviewerRole,
      reviewNotes: typeof body.reviewNotes === 'string' ? body.reviewNotes : '',
    });
    return c.json({ message: 'Result retraction rejected', result });
  } catch (error) {
    if (error instanceof LisResultRetractionError) {
      return c.json({ error: error.message, code: error.code }, error.status as 400 | 403 | 404 | 409);
    }
    throw error;
  }
});

/** GET /inbox/:inboxId — one immutable analyzer evidence record */
routes.get('/inbox/:inboxId{[0-9]+}', async (c) => {
  requireLisInboxViewer(c);
  const tenantId = requireTenantId(c);
  const inboxId = parseId(c.req.param('inboxId'));
  const row = await c.env.DB.prepare(`
    SELECT
      inbox.*,
      message.protocol, message.status AS ingestion_status,
      message.source_message_id, message.delivery_id, message.payload_sha256,
      message.received_at AS message_received_at, message.completed_at AS message_completed_at,
      machine.machine_name, machine.machine_code, machine.manufacturer, machine.model_number,
      patient.name AS patient_name, patient.patient_code, patient.mobile AS patient_mobile,
      item.lab_order_id, item.status AS lab_order_item_status, item.result AS existing_result,
      item.result_status AS existing_result_status,
      lab_order.order_no, lab_order.order_date,
      test.name AS test_name, test.code AS test_code,
      successor.id AS successor_id, successor.disposition AS successor_disposition,
      retraction.id AS retraction_request_id,
      retraction.status AS retraction_status,
      retraction.state_version AS retraction_state_version,
      retraction.reason_code AS retraction_reason_code,
      retraction.reason AS retraction_reason,
      retraction.notes AS retraction_notes,
      retraction.requested_by AS retraction_requested_by,
      retraction.reviewed_by AS retraction_reviewed_by,
      retraction.review_notes AS retraction_review_notes,
      applied_retraction.id AS applied_retraction_request_id,
      critical.id AS critical_event_id, critical.status AS critical_event_status,
      critical.acknowledgement_deadline, critical.acknowledged_at
    ${lisInboxFromClause()}
    LEFT JOIN lis_analyzer_inbox successor
      ON successor.tenant_id = inbox.tenant_id
     AND successor.supersedes_inbox_id = inbox.id
    LEFT JOIN lis_result_retraction_requests retraction
      ON retraction.id = (
        SELECT latest_retraction.id
        FROM lis_result_retraction_requests latest_retraction
        WHERE latest_retraction.tenant_id = inbox.tenant_id
          AND latest_retraction.lis_analyzer_inbox_id = inbox.id
        ORDER BY latest_retraction.id DESC
        LIMIT 1
      )
    LEFT JOIN lis_result_retraction_requests applied_retraction
      ON applied_retraction.id = (
        SELECT latest_applied.id
        FROM lis_result_retraction_requests latest_applied
        WHERE latest_applied.tenant_id = inbox.tenant_id
          AND latest_applied.lis_analyzer_inbox_id = inbox.id
          AND latest_applied.status = 'applied'
        ORDER BY latest_applied.id DESC
        LIMIT 1
      )
    LEFT JOIN lis_critical_event_outbox critical
      ON critical.lis_analyzer_inbox_id = inbox.id
     AND critical.tenant_id = inbox.tenant_id
    WHERE inbox.id = ? AND inbox.tenant_id = ?
  `).bind(inboxId, tenantId).first<Record<string, unknown>>();

  if (!row) {
    return c.json({ error: 'Analyzer inbox result not found', code: 'inbox_not_found' }, 404);
  }

  const data: Record<string, unknown> = { ...row };
  data.candidate_metadata = parseOptionalJson(data.candidate_metadata_json);
  data.validation_details = parseOptionalJson(data.validation_details_json);
  data.qc_details = parseOptionalJson(data.qc_details_json);
  data.source_payload = parseOptionalJson(data.source_payload_json);
  delete data.candidate_metadata_json;
  delete data.validation_details_json;
  delete data.qc_details_json;
  delete data.source_payload_json;
  delete data.raw_payload;
  return c.json({ data });
});

/** POST /inbox/:inboxId/reject — accountable final rejection */
routes.post('/inbox/:inboxId{[0-9]+}/reject', async (c) => {
  const tenantId = requireTenantId(c);
  const reviewerUserId = requireUserId(c);
  const reviewerRole = String(c.get('role') ?? '');
  const inboxId = parseId(c.req.param('inboxId'));
  const body: { expectedVersion?: unknown; reason?: unknown } = await c.req
    .json<{ expectedVersion?: unknown; reason?: unknown }>()
    .catch(() => ({}));

  try {
    const result = await rejectStagedLisResult(c.env.DB, {
      tenantId,
      inboxId,
      expectedVersion: Number(body.expectedVersion),
      reviewerUserId,
      reviewerRole,
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    return c.json({ message: 'Analyzer result rejected', result });
  } catch (error) {
    if (error instanceof LisInboxReviewError) {
      return c.json({ error: error.message, code: error.code }, error.status as 400 | 403 | 404 | 409);
    }
    throw error;
  }
});

/** POST /inbox/:inboxId/accept — governance acceptance of one staged analyzer observation */
routes.post('/inbox/:inboxId{[0-9]+}/accept', async (c) => {
  const tenantId = requireTenantId(c);
  const reviewerUserId = requireUserId(c);
  const reviewerRole = String(c.get('role') ?? '');
  const inboxId = parseId(c.req.param('inboxId'));
  const body: { expectedVersion?: unknown } = await c.req
    .json<{ expectedVersion?: unknown }>()
    .catch(() => ({}));
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    return c.json({ error: 'expectedVersion must be a positive integer', code: 'invalid_version' }, 400);
  }

  try {
    const result = await acceptStagedLisResult(c.env.DB, {
      tenantId,
      inboxId,
      expectedVersion,
      reviewerUserId,
      reviewerRole,
    });
    return c.json({ message: 'Analyzer result accepted', result });
  } catch (error) {
    if (error instanceof LisAcceptanceError) {
      return c.json({ error: error.message, code: error.code }, error.status as 400 | 403 | 404 | 409);
    }
    throw error;
  }
});

/** POST /critical-events/:eventId/acknowledge — accountable closure of a critical-result alert */
routes.post('/critical-events/:eventId{[0-9]+}/acknowledge', async (c) => {
  const tenantId = requireTenantId(c);
  const actorUserId = requireUserId(c);
  const actorRole = String(c.get('role') ?? '');
  const eventId = parseId(c.req.param('eventId'));
  const body: { note?: unknown } = await c.req.json<{ note?: unknown }>().catch(() => ({}));

  try {
    const result = await acknowledgeLisCriticalEvent(c.env.DB, {
      tenantId,
      eventId,
      actorUserId,
      actorRole,
      note: typeof body.note === 'string' ? body.note : undefined,
    });
    return c.json({ message: 'Critical result acknowledged', result });
  } catch (error) {
    if (error instanceof LisCriticalEventError) {
      return c.json({ error: error.message, code: error.code }, error.status as 400 | 403 | 404 | 409);
    }
    throw error;
  }
});

routes.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director', 'md'));

export function normalizeQualitativeResult(rawValue: string, qualitativeMapJson?: string | null): { value: string; mapped: boolean; source?: string } {
  if (!qualitativeMapJson) return { value: rawValue, mapped: false };
  let map: Record<string, string>;
  try {
    map = JSON.parse(qualitativeMapJson) as Record<string, string>;
  } catch {
    return { value: rawValue, mapped: false };
  }
  const normalizedInput = String(rawValue ?? '').trim().toLowerCase();
  for (const [source, target] of Object.entries(map)) {
    if (String(source).trim().toLowerCase() === normalizedInput) {
      return { value: String(target), mapped: true, source };
    }
  }
  return { value: rawValue, mapped: false };
}

type MachineResultPayload = {
  testCode: string;
  testName?: string;
  value: string;
  units?: string;
  referenceRange?: string;
  abnormalFlag?: string;
  resultStatus?: string;
  comments?: string | string[];
  completedAt?: string;
};

type MachineResultIdentifiers = { barcode?: string; controlId?: string; orderNo?: string };

export function isAnalyzerQcIdentifier(value?: string | null): boolean {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return false;
  return /^(QC|CTRL|CONTROL|CAL|CALIB)[-_:A-Z0-9]*/.test(normalized) || normalized.includes('CONTROL');
}

export function isAnalyzerQcResult(result: Pick<MachineResultPayload, 'testCode' | 'testName' | 'comments'>, identifiers: MachineResultIdentifiers): boolean {
  if (isAnalyzerQcIdentifier(identifiers.barcode) || isAnalyzerQcIdentifier(identifiers.controlId) || isAnalyzerQcIdentifier(identifiers.orderNo)) return true;
  const text = [result.testCode, result.testName, ...(Array.isArray(result.comments) ? result.comments : [result.comments])]
    .filter(Boolean)
    .map((v) => String(v).toUpperCase())
    .join(' ');
  return /\b(QC|CTRL|CONTROL|CALIBRATOR|CALIBRATION)\b/.test(text);
}

export function summarizeAnalyzerRunOutcomes(outcomes: any[] = []) {
  const summary = {
    total_results: outcomes.length,
    matched: 0,
    unmatched: 0,
    processed: 0,
    blocked: 0,
    duplicate: 0,
    corrected: 0,
    qc: 0,
    errors: 0,
  };
  for (const outcome of outcomes) {
    if (outcome?.matched) summary.matched += 1;
    else summary.unmatched += 1;
    if (outcome?.duplicate) summary.duplicate += 1;
    if (outcome?.action === 'corrected') summary.corrected += 1;
    if (outcome?.action === 'qc_recorded') summary.qc += 1;
    if (outcome?.reason || outcome?.qcReason || outcome?.validation) summary.blocked += 1;
    if (outcome?.error || outcome?.processing_status === 'error') summary.errors += 1;
    if (outcome?.matched && !outcome?.duplicate && !outcome?.reason) summary.processed += 1;
  }
  return summary;
}

export function buildAnalyzerRunView(row: any) {
  let parsed: any = null;
  try {
    parsed = row.parsed_data ? JSON.parse(String(row.parsed_data)) : null;
  } catch {
    parsed = null;
  }
  const outcomes = Array.isArray(parsed?.outcomes) ? parsed.outcomes : [];
  const summary = summarizeAnalyzerRunOutcomes(outcomes);
  return {
    run_id: Number(row.id),
    machine_id: Number(row.machine_id),
    message_type: row.message_type,
    processing_status: row.processing_status,
    received_at: row.received_at,
    updated_at: row.updated_at ?? null,
    error_message: row.error_message ?? null,
    reprocessed_from_log_id: parsed?.reprocessedFromLogId ?? null,
    ...summary,
  };
}

async function recordAnalyzerQcResult(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  userId: string | number,
  machineId: string | number,
  logId: number,
  mapping: any,
  result: MachineResultPayload,
  identifiers: MachineResultIdentifiers,
): Promise<{ matched: true; testCode: string; action: 'qc_recorded'; qcResultId?: number; qcStatus: 'accepted' | 'out_of_range' }> {
  const numericValue = Number.parseFloat(String(result.value));
  if (!Number.isFinite(numericValue)) {
    await recordUnmatchedResult(db, tenantId, machineId, logId, result, identifiers, 'qc_non_numeric_result');
    await db.$client.prepare(
      `UPDATE lab_machine_result_log SET processing_status = 'qc_review', error_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`
    ).bind('QC result requires numeric value', logId, tenantId).run().catch(() => undefined);
    return { matched: true, testCode: result.testCode, action: 'qc_recorded', qcStatus: 'out_of_range' };
  }

  const identifierValues = [identifiers.barcode, identifiers.controlId, identifiers.orderNo, result.testName]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  const control = await db.$client.prepare(`
    SELECT id, control_code, control_name
    FROM lab_qc_controls
    WHERE tenant_id = ? AND is_active = 1
      AND (
        control_code IN (${identifierValues.map(() => '?').join(',') || "''"})
        OR control_lot IN (${identifierValues.map(() => '?').join(',') || "''"})
        OR control_name IN (${identifierValues.map(() => '?').join(',') || "''"})
      )
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, ...identifierValues, ...identifierValues, ...identifierValues).first<{ id: number; control_code?: string; control_name?: string }>();

  if (!control?.id) {
    await recordUnmatchedResult(db, tenantId, machineId, logId, result, identifiers, 'qc_control_not_configured');
    await db.$client.prepare(
      `UPDATE lab_machine_result_log SET processing_status = 'qc_review', error_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`
    ).bind('QC control not configured for analyzer identifier', logId, tenantId).run().catch(() => undefined);
    return { matched: true, testCode: result.testCode, action: 'qc_recorded', qcStatus: 'out_of_range' };
  }

  const qcRange = await db.$client.prepare(`
    SELECT id, mean_value, sd_value, range_low, range_high, qc_level
    FROM lab_qc_ranges
    WHERE tenant_id = ? AND control_id = ? AND lab_test_id = ? AND is_active = 1
      AND (component_id IS NULL OR component_id = ?)
    ORDER BY CASE WHEN component_id = ? THEN 0 ELSE 1 END, qc_level, id
    LIMIT 1
  `).bind(tenantId, control.id, mapping.lab_test_id, mapping.component_id ?? null, mapping.component_id ?? null).first<any>();

  const rangeLow = qcRange ? Number(qcRange.range_low ?? (Number(qcRange.mean_value) - 3 * Number(qcRange.sd_value))) : null;
  const rangeHigh = qcRange ? Number(qcRange.range_high ?? (Number(qcRange.mean_value) + 3 * Number(qcRange.sd_value))) : null;
  const isOutOfRange = rangeLow !== null && rangeHigh !== null && (numericValue < rangeLow || numericValue > rangeHigh) ? 1 : 0;

  let westgardViolations: string | null = null;
  if (qcRange) {
    const recent = await db.$client.prepare(`
      SELECT result_value
      FROM lab_qc_results
      WHERE tenant_id = ? AND control_id = ? AND lab_test_id = ?
      ORDER BY created_at DESC
      LIMIT 9
    `).bind(tenantId, control.id, mapping.lab_test_id).all<{ result_value: number }>();
    const values = [...(recent.results ?? []).reverse().map((row) => Number(row.result_value)), numericValue];
    const sd = Number(qcRange.sd_value ?? 0);
    const mean = Number(qcRange.mean_value ?? 0);
    if (sd > 0) {
      const violations: string[] = [];
      values.forEach((value, idx) => {
        const z = (value - mean) / sd;
        if (Math.abs(z) > 3) violations.push(`1-3s at run ${idx + 1}: ${z.toFixed(2)} SD`);
        if (Math.abs(z) > 2 && Math.abs(z) <= 3) violations.push(`1-2s at run ${idx + 1}: ${z.toFixed(2)} SD`);
      });
      westgardViolations = violations.length ? JSON.stringify(violations) : null;
    }
  }

  const inserted = await db.$client.prepare(`
    INSERT INTO lab_qc_results (
      control_id, lab_test_id, qc_range_id, result_value, run_date, run_number,
      machine_id, technician_id, is_out_of_range, westgard_violations, action_taken, tenant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    control.id,
    mapping.lab_test_id,
    qcRange?.id ?? null,
    numericValue,
    (result.completedAt || new Date().toISOString()).slice(0, 10),
    null,
    Number(machineId),
    Number(userId),
    isOutOfRange,
    westgardViolations,
    `Recorded automatically from analyzer log #${logId}`,
    tenantId,
  ).run();

  await db.$client.prepare(
    `UPDATE lab_machine_result_log SET processing_status = ?, error_message = ?, matched_order_id = NULL, matched_item_id = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ?`
  ).bind(isOutOfRange || westgardViolations ? 'qc_review' : 'processed', isOutOfRange || westgardViolations ? 'Analyzer QC result needs review' : 'Analyzer QC result recorded', logId, tenantId).run().catch(() => undefined);

  return {
    matched: true,
    testCode: result.testCode,
    action: 'qc_recorded',
    qcResultId: Number(inserted.meta.last_row_id ?? 0) || undefined,
    qcStatus: isOutOfRange || westgardViolations ? 'out_of_range' : 'accepted',
  };
}

async function recordUnmatchedResult(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  machineId: string | number,
  logId: number | null,
  result: MachineResultPayload,
  identifiers: MachineResultIdentifiers,
  reason: string,
): Promise<void> {
  const identifierType = identifiers.barcode ? 'barcode'
    : identifiers.orderNo ? 'order_no'
    : identifiers.controlId ? 'control_id'
    : null;
  const identifierValue = identifiers.barcode ?? identifiers.orderNo ?? identifiers.controlId ?? null;

  await db.$client.prepare(`
    INSERT INTO lis_unmatched_results (
      tenant_id, machine_id, machine_result_log_id, identifier_type, identifier_value,
      machine_test_code, result_payload_json, reason, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    tenantId,
    machineId,
    logId,
    identifierType,
    identifierValue,
    result.testCode,
    JSON.stringify({ result, identifiers }),
    reason,
  ).run().catch(() => {
    // New queue table may not exist on older deployments yet; do not block result ingestion.
  });
}

async function evaluateMachineQcGate(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  machineId: string | number,
  labTestId: string | number,
): Promise<{ passed: boolean; reason: string; details?: Record<string, unknown> }> {
  const gate = await evaluateLisQcGate(db.$client, tenantId, machineId, labTestId);
  return {
    passed: gate.eligible,
    reason: gate.reason,
    details: { state: gate.state, ...(gate.details ?? {}) },
  };
}

type LisIngestionRegistration =
  | { kind: 'new'; messageId: number; payloadHash: string; messageIdentity: string }
  | { kind: 'duplicate'; messageId: number; status: string; outcome: Record<string, unknown> | null }
  | { kind: 'collision'; messageId: number };

type DuplicateLisIngestion = Extract<LisIngestionRegistration, { kind: 'duplicate' }>;

function getLisDeliveryId(c: any): string | null {
  const value = String(c.req.header('X-LIS-Delivery-Id') ?? '').trim();
  return value || null;
}

function respondToDuplicateLisIngestion(c: any, protocol: string, registration: DuplicateLisIngestion) {
  if (registration.status === 'received' || registration.status === 'processing') {
    return c.json({
      error: `${protocol} message is still being staged`,
      code: 'ingestion_in_progress',
      messageId: registration.messageId,
      priorStatus: registration.status,
    }, 503);
  }
  if (registration.status === 'rejected') {
    return c.json({
      error: `${protocol} message was previously rejected`,
      code: 'previously_rejected',
      messageId: registration.messageId,
      priorStatus: registration.status,
      ...(registration.outcome ?? {}),
    }, 422);
  }
  if (registration.status === 'error') {
    return c.json({
      error: `${protocol} message previously failed staging and requires controlled reprocessing`,
      code: 'previously_failed',
      messageId: registration.messageId,
      priorStatus: registration.status,
      ...(registration.outcome ?? {}),
    }, 409);
  }
  return c.json({
    message: `Duplicate ${protocol} delivery ignored`,
    disposition: 'duplicate',
    messageId: registration.messageId,
    priorStatus: registration.status,
    ...(registration.outcome ?? {}),
  });
}

async function registerLisIngestionMessage(
  db: ReturnType<typeof getDb>,
  input: {
    tenantId: string | number;
    machineId: string | number;
    protocol: string;
    sourceIdentity: string;
    sourceMessageId?: string | null;
    deliveryId?: string | null;
    rawPayload: string;
  },
): Promise<LisIngestionRegistration> {
  const payloadHash = await sha256Hex(input.rawPayload);
  const messageIdentity = buildLisMessageIdentity({
    tenantId: input.tenantId,
    machineId: input.machineId,
    protocol: input.protocol,
    sourceIdentity: input.sourceIdentity,
  });
  const existing = await db.$client.prepare(`
    SELECT id, payload_sha256, status, outcome_json
    FROM lis_ingestion_messages
    WHERE tenant_id = ? AND machine_id = ? AND message_identity = ?
  `).bind(input.tenantId, input.machineId, messageIdentity).first<{
    id: number;
    payload_sha256: string;
    status: string;
    outcome_json: string | null;
  }>();

  const replay = classifyReplay(existing?.payload_sha256, payloadHash);
  if (existing && replay === 'duplicate') {
    let outcome: Record<string, unknown> | null = null;
    if (existing.outcome_json) {
      try {
        outcome = JSON.parse(existing.outcome_json) as Record<string, unknown>;
      } catch {
        outcome = null;
      }
    }
    return { kind: 'duplicate', messageId: existing.id, status: existing.status, outcome };
  }
  if (existing && replay === 'collision') {
    await db.$client.prepare(`
      INSERT INTO lis_ingestion_collisions (
        tenant_id, machine_id, original_message_id, message_identity,
        incoming_payload_sha256, incoming_raw_payload, delivery_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.machineId,
      existing.id,
      messageIdentity,
      payloadHash,
      input.rawPayload,
      input.deliveryId ?? null,
    ).run();
    return { kind: 'collision', messageId: existing.id };
  }

  const inserted = await db.$client.prepare(`
    INSERT INTO lis_ingestion_messages (
      tenant_id, machine_id, protocol, message_identity, source_message_id,
      delivery_id, payload_sha256, status, raw_payload, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, CURRENT_TIMESTAMP)
  `).bind(
    input.tenantId,
    input.machineId,
    input.protocol,
    messageIdentity,
    input.sourceMessageId ?? null,
    input.deliveryId ?? null,
    payloadHash,
    input.rawPayload,
  ).run();
  return {
    kind: 'new',
    messageId: Number(inserted.meta.last_row_id),
    payloadHash,
    messageIdentity,
  };
}

async function updateLisIngestionMessage(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  messageId: number,
  status: 'processing' | 'completed' | 'partial' | 'rejected' | 'error',
  outcome: Record<string, unknown>,
  errorMessage?: string | null,
): Promise<void> {
  await db.$client.prepare(`
    UPDATE lis_ingestion_messages
    SET status = ?, outcome_json = ?, error_message = ?,
        completed_at = CASE WHEN ? IN ('completed', 'partial', 'rejected', 'error') THEN CURRENT_TIMESTAMP ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ?
  `).bind(
    status,
    JSON.stringify(outcome),
    errorMessage ?? null,
    status,
    messageId,
    tenantId,
  ).run();
}

function resolveLisIdentifier(identifiers: MachineResultIdentifiers): { type: string | null; value: string | null } {
  if (identifiers.barcode) return { type: 'barcode', value: identifiers.barcode };
  if (identifiers.controlId) return { type: 'control_id', value: identifiers.controlId };
  if (identifiers.orderNo) return { type: 'order_no', value: identifiers.orderNo };
  return { type: null, value: null };
}

async function stageMachineResult(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  userId: string | number,
  machineId: string | number,
  ingestionMessageId: number,
  logId: number,
  observationIndex: number,
  orderGroupIndex: number,
  result: MachineResultPayload,
  identifiers: MachineResultIdentifiers,
  abnormalFlagMapper?: (flag: string) => string,
  resultStatusMapper?: (status: string) => string,
) {
  const mapping = await db.$client.prepare(`
    SELECT mtm.lab_test_id, mtm.component_id, mtm.machine_unit, mtm.conversion_factor,
           mtm.qualitative_map_json, ltc.normal_range, ltc.critical_low,
           ltc.critical_high, ltc.unit, ltc.code
    FROM lab_machine_test_map mtm
    JOIN lab_test_catalog ltc ON ltc.id = mtm.lab_test_id AND ltc.tenant_id = ?
    WHERE mtm.machine_id = ? AND mtm.machine_test_code = ?
      AND mtm.tenant_id = ? AND mtm.is_active = 1
  `).bind(tenantId, machineId, result.testCode, tenantId).first() as any;

  if (mapping && isAnalyzerQcResult(result, identifiers)) {
    const qcOutcome = await recordAnalyzerQcResult(
      db,
      tenantId,
      userId,
      machineId,
      logId,
      mapping,
      result,
      identifiers,
    );
    return { ...qcOutcome, staged: false, disposition: 'qc_recorded' };
  }

  const identifier = resolveLisIdentifier(identifiers);
  let candidates: any[] = [];
  if (mapping && identifier.value) {
    if (identifier.type === 'barcode') {
      const candidateRows = await db.$client.prepare(`
        SELECT loi.id, loi.lab_order_id, loi.specimen_id, lo.patient_id
        FROM lab_order_items loi
        JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ?
        WHERE loi.tenant_id = ? AND loi.lab_test_id = ?
          AND (loi.barcode = ? OR lo.barcode = ? OR loi.specimen_num = ?)
          AND loi.status NOT IN ('cancelled')
        LIMIT 2
      `).bind(tenantId, tenantId, mapping.lab_test_id, identifier.value, identifier.value, identifier.value).all();
      candidates = candidateRows.results as any[];
    } else if (identifier.type === 'control_id') {
      const candidateRows = await db.$client.prepare(`
        SELECT loi.id, loi.lab_order_id, loi.specimen_id, lo.patient_id
        FROM lab_order_items loi
        JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ?
        WHERE loi.tenant_id = ? AND loi.lab_test_id = ? AND lo.control_id = ?
          AND loi.status NOT IN ('cancelled')
        LIMIT 2
      `).bind(tenantId, tenantId, mapping.lab_test_id, identifier.value).all();
      candidates = candidateRows.results as any[];
    } else if (identifier.type === 'order_no') {
      const numericOrderId = Number.parseInt(identifier.value, 10);
      const candidateRows = await db.$client.prepare(`
        SELECT loi.id, loi.lab_order_id, loi.specimen_id, lo.patient_id
        FROM lab_order_items loi
        JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ?
        WHERE loi.tenant_id = ? AND loi.lab_test_id = ?
          AND (${Number.isNaN(numericOrderId) ? 'lo.order_no = ?' : '(lo.id = ? OR lo.order_no = ?)'})
          AND loi.status NOT IN ('cancelled')
        LIMIT 2
      `).bind(
        tenantId,
        tenantId,
        mapping.lab_test_id,
        ...(Number.isNaN(numericOrderId) ? [identifier.value] : [numericOrderId, identifier.value]),
      ).all();
      candidates = candidateRows.results as any[];
    }
  }

  const selection = selectExactCandidate(candidates);
  const qualitative = normalizeQualitativeResult(result.value, mapping?.qualitative_map_json);
  const normalizedValue = qualitative.value;
  const rawNumeric = Number.parseFloat(normalizedValue);
  const conversionFactor = Number(mapping?.conversion_factor ?? 1);
  const normalizedNumeric = Number.isFinite(rawNumeric) ? rawNumeric * conversionFactor : null;
  const normalizedUnits = conversionFactor !== 1
    ? (mapping?.unit ?? result.units ?? mapping?.machine_unit ?? null)
    : (result.units ?? mapping?.machine_unit ?? mapping?.unit ?? null);
  const normalizedInterpretation = result.abnormalFlag
    ? (abnormalFlagMapper
        ? abnormalFlagMapper(result.abnormalFlag)
        : normalizeAnalyzerAbnormalFlag(result.abnormalFlag))
    : interpretNumericLisResult(
        normalizedNumeric ?? Number.NaN,
        mapping?.normal_range,
        mapping?.critical_low,
        mapping?.critical_high,
      );
  const normalizedResultStatus = result.resultStatus && resultStatusMapper
    ? resultStatusMapper(result.resultStatus)
    : (result.resultStatus ? deriveMachineResultWorkflowState(result.resultStatus).resultStatus : 'unrecognized');
  const workflow = deriveMachineResultWorkflowState(normalizedResultStatus);

  let matchState: 'unmatched' | 'ambiguous' | 'exact' | 'invalid' = 'unmatched';
  let qcState: LisQcState = 'not_run';
  let qcDetails: Record<string, unknown> | null = null;
  let validationState: 'not_run' | 'pass' | 'fail' | 'incomplete' | 'system_error' = 'not_run';
  let validationDetails: { blocking: string[]; warnings: string[]; error?: string } | null = null;
  let disposition: 'unmatched' | 'ambiguous' | 'qc_blocked' | 'validation_blocked' | 'review_required' = 'unmatched';
  let reason = 'no_order_item';
  let candidate: any = null;
  if (!mapping) {
    matchState = 'invalid';
    reason = 'unmapped_test_code';
  } else if (!identifier.value) {
    reason = 'no_identifier';
  } else if (selection.kind === 'ambiguous') {
    matchState = 'ambiguous';
    disposition = 'ambiguous';
    reason = 'ambiguous_match';
  } else if (selection.kind === 'exact') {
    candidate = selection.candidate;
    matchState = 'exact';
    if (!workflow.recognized) {
      validationState = 'incomplete';
      validationDetails = { blocking: ['Unrecognized analyzer result status'], warnings: [] };
      disposition = 'validation_blocked';
      reason = 'unrecognized_result_status';
    } else {
      const qcGate = await evaluateLisQcGate(
        db.$client,
        tenantId,
        machineId,
        mapping.lab_test_id,
      );
      qcState = qcGate.state;
      qcDetails = { reason: qcGate.reason, ...(qcGate.details ?? {}) };

      try {
        const validation = await validateLabResult(
          db,
          tenantId,
          Number(mapping.lab_test_id),
          mapping.component_id ? Number(mapping.component_id) : null,
          normalizedValue,
          normalizedNumeric,
          candidate.patient_id ? Number(candidate.patient_id) : null,
        );
        validationDetails = validation;
        if (validation.blocking.length > 0) {
          validationState = 'fail';
          disposition = 'validation_blocked';
          reason = 'validation_blocked';
        } else if (!qcGate.eligible) {
          validationState = 'pass';
          disposition = 'qc_blocked';
          reason = qcGate.reason;
        } else {
          validationState = 'pass';
          disposition = 'review_required';
          reason = 'manual_acceptance_required';
        }
      } catch (error) {
        validationState = 'system_error';
        validationDetails = {
          blocking: ['Validation engine unavailable'],
          warnings: [],
          error: error instanceof Error ? error.message : String(error),
        };
        disposition = 'validation_blocked';
        reason = 'validation_system_error';
      }
    }
  }

  const inboxInsert = await db.$client.prepare(`
    INSERT INTO lis_analyzer_inbox (
      tenant_id, ingestion_message_id, observation_index, order_group_index,
      machine_id, machine_result_log_id, identifier_type, identifier_value,
      machine_test_code, machine_test_name, lab_order_item_id, patient_id,
      specimen_id, lab_test_id, component_id, candidate_metadata_json,
      raw_value, raw_units, raw_reference_range, normalized_value,
      normalized_numeric, normalized_units, selected_reference_range,
      conversion_rule, conversion_factor, analyzer_result_status,
      normalized_result_status, analyzer_abnormal_flag, normalized_interpretation,
      critical_flag, match_state, qc_state, validation_state, disposition,
      disposition_reason, source_payload_json, validation_details_json, qc_details_json,
      staged_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).bind(
    tenantId,
    ingestionMessageId,
    observationIndex,
    orderGroupIndex,
    machineId,
    logId,
    identifier.type,
    identifier.value,
    result.testCode,
    result.testName ?? null,
    candidate?.id ?? null,
    candidate?.patient_id ?? null,
    candidate?.specimen_id ?? null,
    mapping?.lab_test_id ?? null,
    mapping?.component_id ?? null,
    JSON.stringify(candidates.map((row) => ({
      lab_order_item_id: row.id,
      lab_order_id: row.lab_order_id,
      specimen_id: row.specimen_id,
      patient_id: row.patient_id,
    }))),
    result.value,
    result.units ?? null,
    result.referenceRange ?? null,
    normalizedValue,
    normalizedNumeric,
    normalizedUnits,
    mapping?.normal_range ?? null,
    conversionFactor !== 1 ? `multiply:${conversionFactor}` : null,
    conversionFactor,
    result.resultStatus ?? null,
    normalizedResultStatus,
    result.abnormalFlag ?? null,
    normalizedInterpretation,
    normalizedInterpretation === 'critical' ? 1 : 0,
    matchState,
    qcState,
    validationState,
    disposition,
    reason,
    JSON.stringify({ result, identifiers }),
    validationDetails ? JSON.stringify(validationDetails) : null,
    qcDetails ? JSON.stringify(qcDetails) : null,
    userId,
  ).run();

  return {
    staged: true,
    matched: matchState === 'exact',
    testCode: result.testCode,
    inboxId: Number(inboxInsert.meta.last_row_id),
    disposition,
    reason,
    qcState,
    validation: validationDetails?.blocking ?? [],
    validationWarnings: validationDetails?.warnings ?? [],
    orderItemId: candidate?.id ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// BIDIRECTIONAL HELPERS: HL7 ORM & ASTM Order Generation
// ═══════════════════════════════════════════════════════════════════

export function formatHL7Timestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function generateHL7ORM(
  order: {
    orderNo: string;
    patientId: string;
    patientName: string;
    patientDob?: string;
    patientGender?: string;
    tests: Array<{ testCode: string; testName?: string }>;
  },
  machineCode: string,
  controlId = `ORM${Date.now()}`
): string {
  const ts = formatHL7Timestamp();
  const pidDob = order.patientDob ? order.patientDob.replace(/-/g, '') : '';
  const pidSex = order.patientGender ? order.patientGender.charAt(0).toUpperCase() : 'U';
  const nameParts = order.patientName.split(' ');
  const lastName = nameParts.pop() || '';
  const firstName = nameParts.join(' ') || lastName;

  const segments: string[] = [
    `MSH|^~\\&|HMS|HOSPITAL|${machineCode}|LAB|${ts}||ORM^O01|${controlId}|P|2.3`,
    `PID|1||${order.patientId}||${lastName}^${firstName}||${pidDob}|${pidSex}`,
    `ORC|NW|${order.orderNo}`,
  ];

  order.tests.forEach((t, idx) => {
    segments.push(`OBR|${idx + 1}|${order.orderNo}||${t.testCode}^${t.testName || t.testCode}`);
  });

  return segments.join('\r') + '\r';
}

export function generateASTMOrder(
  order: {
    orderNo: string;
    patientId: string;
    patientName: string;
    patientDob?: string;
    patientGender?: string;
    tests: Array<{ testCode: string; testName?: string }>;
  }
): string {
  const dob = order.patientDob ? order.patientDob.replace(/-/g, '') : '';
  const sex = order.patientGender ? order.patientGender.charAt(0).toUpperCase() : 'U';
  const lines: string[] = [
    `H|\\^&|||HMS|||||||P|1`,
    `P|1|${order.patientId}|${order.patientName}||${sex}|${dob}`,
  ];

  order.tests.forEach((t, idx) => {
    lines.push(`O|${idx + 1}|${order.orderNo}||${t.testCode}|R`);
  });

  lines.push('L|1|N');
  return lines.join('\r') + '\r';
}

async function getMachineOrderItemsForWorklist(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  machineId: string | number,
  queryIdentifier?: string,
) {
  const queryFilter = queryIdentifier
    ? 'AND (loi.barcode = ? OR lo.barcode = ? OR loi.specimen_num = ? OR lo.order_no = ? OR CAST(lo.id AS TEXT) = ?)'
    : '';
  const binds: (string | number)[] = [tenantId, machineId, tenantId, tenantId, tenantId, tenantId];
  if (queryIdentifier) {
    binds.push(queryIdentifier, queryIdentifier, queryIdentifier, queryIdentifier, queryIdentifier);
  }

  const { results } = await db.$client.prepare(`
    SELECT loi.id as item_id, loi.lab_order_id, loi.lab_test_id,
           lo.order_no, lo.patient_id, lo.barcode,
           ${getDiagnosticBillingColumns('lo')},
           p.name as patient_name, p.patient_code, p.gender, p.date_of_birth,
           ltc.code as test_code, ltc.name as test_name,
           mtm.machine_test_code
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ?
    ${getDiagnosticBillingJoin('lo')}
    JOIN lab_machine_test_map mtm ON mtm.lab_test_id = loi.lab_test_id AND mtm.machine_id = ? AND mtm.tenant_id = ? AND mtm.is_active = 1
    JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = ?
    JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = ?
    WHERE loi.status IN ('pending', 'collected') AND loi.tenant_id = ?
    ${queryFilter}
    ORDER BY loi.id DESC
  `).bind(...binds).all();

  return (results as any[]).filter((row) => getDiagnosticBillingClearance(row).cleared);
}

function groupMachineOrderMessages(
  items: any[],
  protocol: string,
  machineCode: string,
) {
  const byOrder: Record<string, any[]> = {};
  for (const item of items) {
    const key = String(item.lab_order_id);
    if (!byOrder[key]) byOrder[key] = [];
    byOrder[key].push(item);
  }

  return Object.entries(byOrder).map(([orderId, orderItemsGroup]) => {
    const first = orderItemsGroup[0];
    const order = {
      orderNo: first.order_no,
      patientId: String(first.patient_id),
      patientName: first.patient_name,
      patientDob: first.date_of_birth,
      patientGender: first.gender,
      tests: orderItemsGroup.map((i: any) => ({ testCode: i.machine_test_code, testName: i.test_name })),
    };
    return {
      orderId: Number(orderId),
      orderNo: first.order_no,
      format: protocol,
      message: protocol === 'astm'
        ? generateASTMOrder(order)
        : generateHL7ORM(order, machineCode, `ORM${Date.now()}-${orderId}`),
      itemIds: orderItemsGroup.map((i: any) => i.item_id),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// LOCAL LIS BRIDGE + UNMATCHED RESULT WORK QUEUES
// ═══════════════════════════════════════════════════════════════════

routes.get('/bridge-agents', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(`
    SELECT id, agent_code, agent_name, site_name, host_fingerprint, version,
           status, last_seen_at, last_error, capabilities_json, created_at, updated_at
    FROM lis_bridge_agents
    WHERE tenant_id = ?
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END, last_seen_at DESC
  `).bind(tenantId).all();
  return c.json({ data: results });
});

routes.post('/bridge-agents/heartbeat', zValidator('json', bridgeAgentHeartbeatSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const capabilitiesJson = data.capabilities ? JSON.stringify(data.capabilities) : null;

  const existing = await db.$client.prepare(
    'SELECT id FROM lis_bridge_agents WHERE tenant_id = ? AND agent_code = ?'
  ).bind(tenantId, data.agentCode).first<{ id: number }>();

  if (existing?.id) {
    await db.$client.prepare(`
      UPDATE lis_bridge_agents
      SET agent_name = COALESCE(?, agent_name),
          site_name = COALESCE(?, site_name),
          host_fingerprint = COALESCE(?, host_fingerprint),
          version = COALESCE(?, version),
          status = ?,
          last_seen_at = CURRENT_TIMESTAMP,
          last_error = ?,
          capabilities_json = COALESCE(?, capabilities_json),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(
      data.agentName ?? null,
      data.siteName ?? null,
      data.hostFingerprint ?? null,
      data.version ?? null,
      data.status,
      data.lastError ?? null,
      capabilitiesJson,
      existing.id,
      tenantId,
    ).run();
    return c.json({ id: existing.id, message: 'Bridge heartbeat accepted', status: data.status });
  }

  const created = await db.$client.prepare(`
    INSERT INTO lis_bridge_agents (
      tenant_id, agent_code, agent_name, site_name, host_fingerprint, version,
      status, last_seen_at, last_error, capabilities_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    tenantId,
    data.agentCode,
    data.agentName ?? data.agentCode,
    data.siteName ?? null,
    data.hostFingerprint ?? null,
    data.version ?? null,
    data.status,
    data.lastError ?? null,
    capabilitiesJson,
    userId,
  ).run();

  return c.json({ id: created.meta.last_row_id, message: 'Bridge agent registered', status: data.status }, 201);
});

routes.get('/unmatched-results/candidates', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const q = (c.req.query('q') ?? '').trim();
  const labTestIdParam = c.req.query('labTestId') ?? c.req.query('lab_test_id');
  const labTestId = labTestIdParam ? parseId(labTestIdParam) : null;
  const limit = Math.min(25, Math.max(1, parseInt(c.req.query('limit') ?? '10', 10) || 10));

  if (q.length < 2 && !labTestId) {
    throw new HTTPException(400, { message: 'Search query must be at least 2 characters unless labTestId is provided' });
  }

  const like = `%${q}%`;
  const { results } = await db.$client.prepare(`
    SELECT
      loi.id AS lab_order_item_id,
      loi.status AS item_status,
      loi.barcode AS item_barcode,
      loi.specimen_num,
      loi.lab_test_id,
      lo.id AS lab_order_id,
      lo.order_no,
      lo.order_date,
      lo.barcode AS order_barcode,
      lo.control_id,
      p.id AS patient_id,
      p.name AS patient_name,
      p.patient_code,
      p.mobile AS patient_mobile,
      ltc.name AS test_name,
      ltc.code AS test_code,
      ltc.category AS test_category
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
    JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
    JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
    WHERE loi.tenant_id = ?
      AND loi.status NOT IN ('cancelled')
      AND (? IS NULL OR loi.lab_test_id = ?)
      AND (
        ? = ''
        OR CAST(loi.id AS TEXT) = ?
        OR CAST(lo.id AS TEXT) = ?
        OR lo.order_no LIKE ?
        OR loi.barcode LIKE ?
        OR lo.barcode LIKE ?
        OR loi.specimen_num LIKE ?
        OR lo.control_id LIKE ?
        OR p.name LIKE ?
        OR p.patient_code LIKE ?
        OR p.mobile LIKE ?
        OR ltc.name LIKE ?
        OR ltc.code LIKE ?
      )
    ORDER BY lo.created_at DESC, loi.id DESC
    LIMIT ?
  `).bind(
    tenantId,
    labTestId,
    labTestId,
    q,
    q,
    q,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    limit,
  ).all();

  return c.json({ data: results });
});

routes.get('/unmatched-results', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const status = c.req.query('status') ?? 'open';
  const machineIdParam = c.req.query('machineId') ?? c.req.query('machine_id');
  const machineIdFilter = machineIdParam ? parseId(machineIdParam) : null;
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '25', 10) || 25));
  const offset = (page - 1) * limit;

  const countRow = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM lis_unmatched_results WHERE tenant_id = ? AND status = ? AND (? IS NULL OR machine_id = ?)'
  ).bind(tenantId, status, machineIdFilter, machineIdFilter).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT ur.*, lm.machine_name, lm.machine_code
    FROM lis_unmatched_results ur
    LEFT JOIN lab_machines lm ON lm.id = ur.machine_id AND lm.tenant_id = ur.tenant_id
    WHERE ur.tenant_id = ? AND ur.status = ? AND (? IS NULL OR ur.machine_id = ?)
    ORDER BY ur.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, status, machineIdFilter, machineIdFilter, limit, offset).all();

  const total = Number(countRow?.total ?? 0);
  return c.json({
    data: results,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

routes.post('/unmatched-results/:id/resolve', zValidator('json', resolveUnmatchedResultSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id, status, machine_id FROM lis_unmatched_results WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; status: string; machine_id?: number | null }>();
  if (!existing) throw new HTTPException(404, { message: 'Unmatched result not found' });
  if (existing.status !== 'open') throw new HTTPException(409, { message: 'Unmatched result is already closed' });
  if (data.status === 'resolved' && !data.labOrderItemId) {
    throw new HTTPException(400, { message: 'labOrderItemId is required when resolving an unmatched result' });
  }

  let reagentUsage: { mappings: number; quantity: number; cost: number } | undefined;
  if (data.status === 'resolved' && data.labOrderItemId) {
    const orderItem = await db.$client.prepare(`
      SELECT loi.id, loi.lab_order_id, loi.lab_test_id, loi.status
      FROM lab_order_items loi
      WHERE loi.id = ? AND loi.tenant_id = ? AND loi.status NOT IN ('cancelled')
      LIMIT 1
    `).bind(data.labOrderItemId, tenantId).first<{ id: number; lab_order_id: number; lab_test_id: number; status: string }>();
    if (!orderItem) throw new HTTPException(404, { message: 'Lab order item not found for this tenant' });

    const labInventoryPolicy = await getLabInventoryPolicy(db.$client as unknown as D1Database, tenantId);
    const consumeReagentsOnResult = await shouldConsumeLabReagentsForEvent(db.$client as unknown as D1Database, tenantId, 'result');
    if (consumeReagentsOnResult) {
      try {
        reagentUsage = await consumeMappedLabConsumables(db.$client as unknown as D1Database, {
          tenantId,
          userId,
          labOrderItemId: Number(orderItem.id),
          labOrderId: Number(orderItem.lab_order_id),
          labTestId: Number(orderItem.lab_test_id),
          machineId: existing.machine_id ?? null,
          requireMapping: labInventoryPolicy.require_test_mapping_for_completion,
        });
      } catch (error) {
        if (shouldBlockLabInventoryException(labInventoryPolicy, 'result')) throw error;
      }
    }
  }

  await db.$client.prepare(`
    UPDATE lis_unmatched_results
    SET status = ?,
        resolved_by = ?,
        resolved_at = CURRENT_TIMESTAMP,
        resolved_lab_order_item_id = ?,
        resolution_notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.status,
    userId,
    data.labOrderItemId ?? null,
    data.notes ?? null,
    id,
    tenantId,
  ).run();

  return c.json({
    message: data.status === 'ignored' ? 'Unmatched result ignored' : 'Unmatched result resolved',
    id,
    status: data.status,
    reagentUsage,
  });
});

// ═══════════════════════════════════════════════════════════════════
// LAB MACHINES CRUD
// ═══════════════════════════════════════════════════════════════════

/** GET / — List all lab machines with optional filters */
routes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const status = c.req.query('status');
  const machineType = c.req.query('machine_type');

  let sql = 'SELECT * FROM lab_machines WHERE tenant_id = ? AND is_active = 1';
  const binds: (string | number)[] = [tenantId];

  if (status) {
    sql += ' AND status = ?';
    binds.push(status);
  }
  if (machineType) {
    sql += ' AND machine_type = ?';
    binds.push(machineType);
  }
  sql += ' ORDER BY machine_name';

  const { results } = await db.$client.prepare(sql).bind(...binds).all();
  return c.json({ data: results });
});

/** POST / — Create a new lab machine */
routes.post('/', zValidator('json', createLabMachineSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Check duplicate machine_code
  const existing = await db.$client.prepare(
    'SELECT id FROM lab_machines WHERE machine_code = ? AND tenant_id = ? AND is_active = 1'
  ).bind(data.machine_code, tenantId).first();
  if (existing) throw new HTTPException(409, { message: 'Machine code already exists' });

  const result = await db.$client.prepare(`
    INSERT INTO lab_machines (
      machine_name, machine_code, machine_type, manufacturer, model_number,
      serial_number, protocol, connection_type, host_address, port, baud_rate,
      is_bidirectional, status, tenant_id, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    data.machine_name,
    data.machine_code,
    data.machine_type ?? null,
    data.manufacturer ?? null,
    data.model_number ?? null,
    data.serial_number ?? null,
    data.protocol,
    data.connection_type,
    data.host_address ?? null,
    data.port ?? null,
    data.baud_rate ?? null,
    data.is_bidirectional ? 1 : 0,
    tenantId
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Machine created' }, 201);
});

/** GET /capabilities — Supported analyzer protocols and machine classes */
routes.get('/capabilities', async (c) => {
  return c.json(getLabMachineCapabilities());
});

/** GET /analyzer-profiles — Enterprise analyzer profile defaults inspired by OpenELIS-style profile catalogs */
routes.get('/analyzer-profiles', async (c) => {
  const profiles = listLabAnalyzerProfiles({
    protocol: c.req.query('protocol'),
    manufacturer: c.req.query('manufacturer'),
    q: c.req.query('q'),
  });
  return c.json({ data: profiles });
});

/** GET /analyzer-profiles/suggest — Suggest defaults for machine setup */
routes.get('/analyzer-profiles/suggest', async (c) => {
  const defaults = suggestAnalyzerProfileDefaults({
    profileId: c.req.query('profileId'),
    model: c.req.query('model'),
    manufacturer: c.req.query('manufacturer'),
    protocol: c.req.query('protocol'),
  });
  if (!defaults) throw new HTTPException(404, { message: 'No analyzer profile defaults found' });
  return c.json({ data: defaults });
});

/** GET /:id/middleware-config — Generate a safe local bridge config template for this machine */
routes.get('/:id{[0-9]+}/middleware-config', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const machine = await db.$client.prepare(`
    SELECT id, machine_name, machine_code, manufacturer, model_number, protocol, port
    FROM lab_machines
    WHERE id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(id, tenantId).first<{
    id: number;
    machine_name?: string | null;
    machine_code: string;
    manufacturer?: string | null;
    model_number?: string | null;
    protocol?: string | null;
    port?: number | null;
  }>();
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const config = buildLabMiddlewareConfigSnippet({
    tenantId,
    machineCode: machine.machine_code,
    machineName: machine.machine_name,
    manufacturer: machine.manufacturer,
    model: machine.model_number,
    protocol: machine.protocol,
    port: machine.port,
    profileId: c.req.query('profileId'),
    apiBaseUrl: c.req.query('apiBaseUrl'),
    siteName: c.req.query('siteName'),
    agentCode: c.req.query('agentCode'),
  });
  return c.json({ data: config });
});

/** GET /:id/qc-gate — Check whether a machine/test can safely accept patient results */
routes.get('/:id/qc-gate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const labTestId = Number(c.req.query('lab_test_id'));

  if (!Number.isFinite(labTestId) || labTestId <= 0) {
    throw new HTTPException(400, { message: 'lab_test_id query parameter is required' });
  }

  const machine = await db.$client.prepare(
    'SELECT id FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first<{ id: number }>();
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const gate = await evaluateMachineQcGate(db, tenantId, id, labTestId);
  return c.json({ machineId: id, labTestId, ...gate });
});

/** GET /:id — Get a single machine with stats */
routes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const machine = await db.$client.prepare(
    'SELECT * FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const stats = await db.$client.prepare(
    `SELECT
       (SELECT COUNT(*) FROM lab_machine_test_map WHERE machine_id = ? AND tenant_id = ? AND is_active = 1) as total_mappings,
       (SELECT last_communication_at FROM lab_machines WHERE id = ? AND tenant_id = ?) as last_communication`
  ).bind(id, tenantId, id, tenantId).first();

  return c.json({ data: { ...machine, stats } });
});

/** PUT /:id — Update a machine */
routes.put('/:id', zValidator('json', updateLabMachineSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const fields: Record<string, any> = {
    machine_name: data.machine_name,
    machine_code: data.machine_code,
    machine_type: data.machine_type,
    manufacturer: data.manufacturer,
    model_number: data.model_number,
    serial_number: data.serial_number,
    protocol: data.protocol,
    connection_type: data.connection_type,
    host_address: data.host_address,
    port: data.port,
    baud_rate: data.baud_rate,
    is_bidirectional: data.is_bidirectional !== undefined ? (data.is_bidirectional ? 1 : 0) : undefined,
  };

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      updates.push(`${key} = ?`);
      values.push(val ?? null);
    }
  }

  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE lab_machines SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(...values).run();

  return c.json({ message: 'Machine updated' });
});

/** DELETE /:id — Soft delete a machine */
routes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const result = await db.$client.prepare(
    `UPDATE lab_machines SET is_active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(id, tenantId).run();

  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Machine not found' });
  return c.json({ message: 'Machine deactivated' });
});

// ═══════════════════════════════════════════════════════════════════
// TEST MAPPINGS
// ═══════════════════════════════════════════════════════════════════

/** GET /:id/test-map — List test mappings for a machine */
routes.get('/:id/test-map', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));

  const { results } = await db.$client.prepare(
    `SELECT mtm.*, ltc.name as test_name, ltc.code as test_code, ltc.unit as catalog_unit
     FROM lab_machine_test_map mtm
     JOIN lab_test_catalog ltc ON ltc.id = mtm.lab_test_id AND ltc.tenant_id = ?
     WHERE mtm.machine_id = ? AND mtm.tenant_id = ? AND mtm.is_active = 1
     ORDER BY mtm.machine_test_code`
  ).bind(tenantId, machineId, tenantId).all();

  return c.json({ data: results });
});

/** POST /:id/test-map — Add a test mapping */
routes.post('/:id/test-map', zValidator('json', createMachineTestMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_machine_test_map (
      machine_id, lab_test_id, component_id, machine_test_code, machine_test_name,
      machine_unit, conversion_factor, qualitative_map_json, is_active, tenant_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
  `).bind(
    machineId,
    data.lab_test_id,
    data.component_id ?? null,
    data.machine_test_code,
    data.machine_test_name ?? null,
    data.machine_unit ?? null,
    data.conversion_factor ?? 1,
    data.qualitative_map ? JSON.stringify(data.qualitative_map) : null,
    tenantId
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Mapping created' }, 201);
});

/** PUT /:id/test-map/:mapId — Update a test mapping */
routes.put('/:id/test-map/:mapId', zValidator('json', updateMachineTestMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));
  const mapId = parseId(c.req.param('mapId'));
  const data = c.req.valid('json');

  const fields: Record<string, any> = {
    lab_test_id: data.lab_test_id,
    component_id: data.component_id,
    machine_test_code: data.machine_test_code,
    machine_test_name: data.machine_test_name,
    machine_unit: data.machine_unit,
    conversion_factor: data.conversion_factor,
    qualitative_map_json: data.qualitative_map === undefined ? undefined : (data.qualitative_map ? JSON.stringify(data.qualitative_map) : null),
  };

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      updates.push(`${key} = ?`);
      values.push(val ?? null);
    }
  }

  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  values.push(mapId, machineId, tenantId);

  await db.$client.prepare(
    `UPDATE lab_machine_test_map SET ${updates.join(', ')}
     WHERE id = ? AND machine_id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(...values).run();

  return c.json({ message: 'Mapping updated' });
});

/** DELETE /:id/test-map/:mapId — Deactivate a test mapping */
routes.delete('/:id/test-map/:mapId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));
  const mapId = parseId(c.req.param('mapId'));

  const result = await db.$client.prepare(
    `UPDATE lab_machine_test_map SET is_active = 0
     WHERE id = ? AND machine_id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(mapId, machineId, tenantId).run();

  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Mapping not found' });
  return c.json({ message: 'Mapping deactivated' });
});

/** POST /:id/test-map/bulk — Bulk add test mappings */
routes.post('/:id/test-map/bulk', zValidator('json', bulkMachineTestMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));
  const { mappings } = c.req.valid('json');

  const created: number[] = [];
  for (const m of mappings) {
    const result = await db.$client.prepare(`
      INSERT INTO lab_machine_test_map (
        machine_id, lab_test_id, component_id, machine_test_code, machine_test_name,
        machine_unit, conversion_factor, qualitative_map_json, is_active, tenant_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
    `).bind(
      machineId,
      m.lab_test_id,
      m.component_id ?? null,
      m.machine_test_code,
      m.machine_test_name ?? null,
      m.machine_unit ?? null,
      m.conversion_factor ?? 1,
      m.qualitative_map ? JSON.stringify(m.qualitative_map) : null,
      tenantId
    ).run();
    created.push(result.meta.last_row_id as number);
  }

  return c.json({ ids: created, message: `${created.length} mappings created` }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// RESULT RECEIVING — JSON
// ═══════════════════════════════════════════════════════════════════

/** POST /:id/receive — Receive parsed JSON results and stage observations */
routes.post('/:id{[0-9]+}/receive', zValidator('json', machineResultSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const machineId = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const machine = await db.$client.prepare(
    'SELECT id FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(machineId, tenantId).first();
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const rawPayload = JSON.stringify(data);
  const deliveryId = getLisDeliveryId(c);
  const sourceIdentity = resolveLisSourceIdentity(deliveryId, await sha256Hex(rawPayload));
  const registration = await registerLisIngestionMessage(db, {
    tenantId,
    machineId,
    protocol: 'json',
    sourceIdentity,
    deliveryId,
    rawPayload,
  });
  if (registration.kind === 'duplicate') {
    return respondToDuplicateLisIngestion(c, 'JSON', registration);
  }
  if (registration.kind === 'collision') {
    throw new HTTPException(409, { message: 'JSON message identity collision quarantined' });
  }

  const logResult = await db.$client.prepare(`
    INSERT INTO lab_machine_result_log (
      machine_id, raw_message, message_type, parsed_data, processing_status, tenant_id, received_at
    ) VALUES (?, ?, 'JSON', ?, 'staging', ?, CURRENT_TIMESTAMP)
  `).bind(machineId, rawPayload, rawPayload, tenantId).run();
  const logId = Number(logResult.meta.last_row_id);
  const outcomes: any[] = [];

  try {
    for (let observationIndex = 0; observationIndex < data.results.length; observationIndex += 1) {
      outcomes.push(await stageMachineResult(
        db,
        tenantId,
        userId,
        machineId,
        registration.messageId,
        logId,
        observationIndex,
        0,
        data.results[observationIndex],
        { barcode: data.barcode ?? data.specimenId, controlId: data.controlId, orderNo: data.orderNo },
      ));
    }

    const hasQuarantined = outcomes.some((outcome) => ['unmatched', 'ambiguous', 'qc_blocked', 'validation_blocked'].includes(outcome.disposition));
    await updateLisIngestionMessage(
      db,
      tenantId,
      registration.messageId,
      hasQuarantined ? 'partial' : 'completed',
      { outcomes },
    );
    await db.$client.prepare(`
      UPDATE lab_machine_result_log
      SET processing_status = ?, parsed_data = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(hasQuarantined ? 'partial' : 'staged', JSON.stringify({ ...data, outcomes }), logId, tenantId).run();
  } catch (error: any) {
    await updateLisIngestionMessage(
      db,
      tenantId,
      registration.messageId,
      'error',
      { outcomes },
      error?.message ?? 'Unknown staging error',
    );
    await db.$client.prepare(`
      UPDATE lab_machine_result_log
      SET processing_status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(error?.message ?? 'Unknown staging error', logId, tenantId).run();
    throw new HTTPException(500, { message: 'Error staging results' });
  }

  await db.$client.prepare(
    `UPDATE lab_machines SET last_communication_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ?`
  ).bind(machineId, tenantId).run();

  return c.json({
    message: 'Results staged',
    disposition: 'staged',
    messageId: registration.messageId,
    logId,
    outcomes,
  });
});

// ═══════════════════════════════════════════════════════════════════
// RESULT RECEIVING — HL7
// ═══════════════════════════════════════════════════════════════════

/** POST /hl7/receive — Receive and stage raw HL7 observations */
routes.post('/hl7/receive', zValidator('json', hl7MessageReceiveSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  let machine: any = null;
  if (data.machineId) {
    machine = await db.$client.prepare(
      'SELECT * FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
    ).bind(data.machineId, tenantId).first();
  } else if (data.machineCode) {
    machine = await db.$client.prepare(
      'SELECT * FROM lab_machines WHERE machine_code = ? AND tenant_id = ? AND is_active = 1'
    ).bind(data.machineCode, tenantId).first();
  }
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const parsed = parseHL7Message(data.message);
  const sourceIdentity = [
    parsed.message.sendingApp,
    parsed.message.sendingFacility,
    parsed.message.messageType,
    parsed.message.messageControlId,
  ].join('|');
  const registration = await registerLisIngestionMessage(db, {
    tenantId,
    machineId: machine.id,
    protocol: 'hl7',
    sourceIdentity,
    sourceMessageId: parsed.message.messageControlId || null,
    deliveryId: getLisDeliveryId(c),
    rawPayload: data.message,
  });

  if (registration.kind === 'duplicate') {
    return respondToDuplicateLisIngestion(c, 'HL7', registration);
  }
  if (registration.kind === 'collision') {
    throw new HTTPException(409, { message: 'HL7 message identity collision quarantined' });
  }

  const validation = validateHL7ClinicalMessage(parsed);
  if (!validation.valid) {
    await updateLisIngestionMessage(
      db,
      tenantId,
      registration.messageId,
      'rejected',
      { validationErrors: validation.errors },
      validation.errors.join('; '),
    );
    throw new HTTPException(400, { message: validation.errors.join('; ') });
  }

  const logResult = await db.$client.prepare(`
    INSERT INTO lab_machine_result_log (
      machine_id, raw_message, message_type, parsed_data, processing_status, tenant_id, received_at
    ) VALUES (?, ?, 'HL7', ?, 'staging', ?, CURRENT_TIMESTAMP)
  `).bind(machine.id, data.message, JSON.stringify(parsed), tenantId).run();
  const logId = Number(logResult.meta.last_row_id);
  const outcomes: any[] = [];

  try {
    let observationIndex = 0;
    for (let orderGroupIndex = 0; orderGroupIndex < (parsed.orders ?? []).length; orderGroupIndex += 1) {
      const order = parsed.orders[orderGroupIndex];
      for (const result of (order.results ?? [])) {
        outcomes.push(await stageMachineResult(
          db,
          tenantId,
          userId,
          machine.id,
          registration.messageId,
          logId,
          observationIndex,
          orderGroupIndex,
          {
            testCode: result.resultCode,
            testName: result.resultText,
            value: result.value,
            units: result.units,
            referenceRange: result.range,
            abnormalFlag: result.abnormalFlag,
            resultStatus: result.resultStatus,
            comments: result.comments,
            completedAt: result.observationDate,
          },
          {
            barcode: order.order.specimenId || undefined,
            controlId: undefined,
            orderNo: order.order.placerOrderNumber || order.order.fillerOrderNumber || undefined,
          },
          mapHL7AbnormalFlag,
          mapHL7ResultStatus,
        ));
        observationIndex += 1;
      }
    }

    const hasQuarantined = outcomes.some((outcome) => ['unmatched', 'ambiguous', 'qc_blocked', 'validation_blocked'].includes(outcome.disposition));
    const messageStatus = hasQuarantined ? 'partial' : 'completed';
    await updateLisIngestionMessage(db, tenantId, registration.messageId, messageStatus, { outcomes });
    await db.$client.prepare(`
      UPDATE lab_machine_result_log
      SET processing_status = ?, parsed_data = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(hasQuarantined ? 'partial' : 'staged', JSON.stringify({ parsed, outcomes }), logId, tenantId).run();
  } catch (error: any) {
    await updateLisIngestionMessage(
      db,
      tenantId,
      registration.messageId,
      'error',
      { outcomes },
      error?.message ?? 'Unknown staging error',
    );
    await db.$client.prepare(`
      UPDATE lab_machine_result_log
      SET processing_status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(error?.message ?? 'Unknown staging error', logId, tenantId).run();
    throw new HTTPException(500, { message: 'Error staging HL7 message' });
  }

  await db.$client.prepare(
    `UPDATE lab_machines SET last_communication_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ?`
  ).bind(machine.id, tenantId).run();

  return c.json({
    message: 'HL7 message staged',
    disposition: 'staged',
    messageId: registration.messageId,
    logId,
    outcomes,
  });
});

// ═══════════════════════════════════════════════════════════════════
// RESULT RECEIVING — ASTM
// ═══════════════════════════════════════════════════════════════════

/** POST /astm/receive — Receive and stage raw ASTM observations */
routes.post('/astm/receive', zValidator('json', astmMessageReceiveSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  let machine: any = null;
  if (data.machineId) {
    machine = await db.$client.prepare(
      'SELECT * FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
    ).bind(data.machineId, tenantId).first();
  } else if (data.machineCode) {
    machine = await db.$client.prepare(
      'SELECT * FROM lab_machines WHERE machine_code = ? AND tenant_id = ? AND is_active = 1'
    ).bind(data.machineCode, tenantId).first();
  }
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const parsed = parseASTMMessage(data.message);
  const resultCount = (parsed.patients ?? []).reduce(
    (patientTotal, patient) => patientTotal + (patient.orders ?? []).reduce(
      (orderTotal, order) => orderTotal + (order.results ?? []).length,
      0,
    ),
    0,
  );
  if (resultCount === 0 && (parsed.queries ?? []).length === 0) {
    throw new HTTPException(400, { message: 'ASTM message contains no results or queries' });
  }

  const deliveryId = getLisDeliveryId(c);
  const sourceIdentity = resolveLisSourceIdentity(deliveryId, await sha256Hex(data.message));
  const registration = await registerLisIngestionMessage(db, {
    tenantId,
    machineId: machine.id,
    protocol: 'astm',
    sourceIdentity,
    deliveryId,
    rawPayload: data.message,
  });
  if (registration.kind === 'duplicate') {
    return respondToDuplicateLisIngestion(c, 'ASTM', registration);
  }
  if (registration.kind === 'collision') {
    throw new HTTPException(409, { message: 'ASTM message identity collision quarantined' });
  }

  const logResult = await db.$client.prepare(`
    INSERT INTO lab_machine_result_log (
      machine_id, raw_message, message_type, parsed_data, processing_status, tenant_id, received_at
    ) VALUES (?, ?, 'ASTM', ?, 'staging', ?, CURRENT_TIMESTAMP)
  `).bind(machine.id, data.message, JSON.stringify(parsed), tenantId).run();
  const logId = Number(logResult.meta.last_row_id);
  const outcomes: any[] = [];
  const queryResponses: any[] = [];

  try {
    for (const query of parsed.queries ?? []) {
      const identifier = query.startId || query.endId || undefined;
      const items = await getMachineOrderItemsForWorklist(db, tenantId, machine.id, identifier);
      queryResponses.push({
        query,
        messages: groupMachineOrderMessages(items, 'astm', machine.machine_code),
      });
    }

    let observationIndex = 0;
    let orderGroupIndex = 0;
    for (const patient of (parsed.patients ?? [])) {
      for (const order of (patient.orders ?? [])) {
        for (const result of (order.results ?? [])) {
          outcomes.push(await stageMachineResult(
            db,
            tenantId,
            userId,
            machine.id,
            registration.messageId,
            logId,
            observationIndex,
            orderGroupIndex,
            {
              testCode: result.testCode,
              testName: result.testName,
              value: result.value,
              units: result.units,
              referenceRange: result.referenceRange,
              abnormalFlag: result.abnormalFlag,
              resultStatus: result.status,
              comments: result.comments,
              completedAt: result.completedDateTime,
            },
            {
              barcode: order.order.specimenId || undefined,
              controlId: undefined,
              orderNo: undefined,
            },
            mapASTMAbnormalFlag,
            mapASTMResultStatus,
          ));
          observationIndex += 1;
        }
        orderGroupIndex += 1;
      }
    }

    const hasQuarantined = outcomes.some((outcome) => ['unmatched', 'ambiguous', 'qc_blocked', 'validation_blocked'].includes(outcome.disposition));
    await updateLisIngestionMessage(
      db,
      tenantId,
      registration.messageId,
      hasQuarantined ? 'partial' : 'completed',
      { outcomes, queryResponses },
    );
    await db.$client.prepare(`
      UPDATE lab_machine_result_log
      SET processing_status = ?, parsed_data = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(
      hasQuarantined ? 'partial' : 'staged',
      JSON.stringify({ parsed, outcomes, queryResponses }),
      logId,
      tenantId,
    ).run();
  } catch (error: any) {
    await updateLisIngestionMessage(
      db,
      tenantId,
      registration.messageId,
      'error',
      { outcomes, queryResponses },
      error?.message ?? 'Unknown staging error',
    );
    await db.$client.prepare(`
      UPDATE lab_machine_result_log
      SET processing_status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `).bind(error?.message ?? 'Unknown staging error', logId, tenantId).run();
    throw new HTTPException(500, { message: 'Error staging ASTM message' });
  }

  await db.$client.prepare(
    `UPDATE lab_machines SET last_communication_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ?`
  ).bind(machine.id, tenantId).run();

  return c.json({
    message: 'ASTM message staged',
    disposition: 'staged',
    messageId: registration.messageId,
    logId,
    outcomes,
    queryResponses,
  });
});

// ═══════════════════════════════════════════════════════════════════
// LOGS & PING
// ═══════════════════════════════════════════════════════════════════

/** POST /:id/logs/:logId/reprocess — Reprocess stored analyzer raw/parsed message using current mappings */
routes.post('/:id{[0-9]+}/logs/:logId{[0-9]+}/reprocess', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const machineId = parseId(c.req.param('id'));
  const logId = parseId(c.req.param('logId'));

  const original = await db.$client.prepare(`
    SELECT id, machine_id, raw_message, message_type, parsed_data
    FROM lab_machine_result_log
    WHERE id = ? AND machine_id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(logId, machineId, tenantId).first<{
    id: number;
    machine_id: number;
    raw_message?: string | null;
    message_type?: string | null;
    parsed_data?: string | null;
  }>();
  if (!original) throw new HTTPException(404, { message: 'Result log not found' });

  const type = String(original.message_type || 'JSON').toUpperCase();
  const rawPayload = original.raw_message || original.parsed_data || '';
  if (!rawPayload) throw new HTTPException(400, { message: 'Stored result log has no payload to reprocess' });

  const protocol = type.includes('HL7') ? 'hl7' : type.includes('ASTM') ? 'astm' : 'json';
  const registration = await registerLisIngestionMessage(db, {
    tenantId,
    machineId,
    protocol,
    sourceIdentity: `reprocess-log:${logId}`,
    sourceMessageId: `reprocess-log:${logId}`,
    rawPayload,
  });
  if (registration.kind === 'duplicate') {
    return c.json({
      message: 'Result log already staged',
      disposition: 'duplicate',
      originalLogId: logId,
      messageId: registration.messageId,
      priorStatus: registration.status,
      ...(registration.outcome ?? {}),
    });
  }
  if (registration.kind === 'collision') {
    throw new HTTPException(409, { message: 'Stored result log payload collision quarantined' });
  }

  const reprocessMessageType = `${type}_REPROCESS`;
  const reprocessLog = await db.$client.prepare(`
    INSERT INTO lab_machine_result_log (
      machine_id, raw_message, message_type, parsed_data, processing_status, error_message, tenant_id, received_at
    ) VALUES (?, ?, ?, ?, 'processing', ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    machineId,
    original.raw_message ?? original.parsed_data ?? null,
    reprocessMessageType,
    original.parsed_data ?? null,
    `Reprocess requested from log #${logId}`,
    tenantId,
  ).run();
  const reprocessLogId = Number(reprocessLog.meta.last_row_id);
  const outcomes: any[] = [];
  let observationIndex = 0;
  let orderGroupIndex = 0;

  try {
    if (type.includes('HL7')) {
      const raw = original.raw_message || '';
      const parsed = parseHL7Message(raw);
      const validation = validateHL7ClinicalMessage(parsed);
      if (!validation.valid) {
        throw new HTTPException(400, { message: validation.errors.join('; ') });
      }
      for (const order of (parsed.orders ?? [])) {
        for (const result of (order.results ?? [])) {
          outcomes.push(await stageMachineResult(
            db,
            tenantId,
            userId,
            machineId,
            registration.messageId,
            reprocessLogId,
            observationIndex,
            orderGroupIndex,
            {
              testCode: result.resultCode,
              testName: result.resultText,
              value: result.value,
              units: result.units,
              referenceRange: result.range,
              abnormalFlag: result.abnormalFlag,
              resultStatus: result.resultStatus,
              comments: result.comments,
              completedAt: result.observationDate,
            },
            {
              barcode: order.order.specimenId || order.order.fillerOrderNumber || undefined,
              controlId: parsed.message.messageControlId || undefined,
              orderNo: order.order.placerOrderNumber,
            },
            mapHL7AbnormalFlag,
            mapHL7ResultStatus,
          ));
          observationIndex += 1;
        }
        orderGroupIndex += 1;
      }
      await db.$client.prepare(
        `UPDATE lab_machine_result_log SET parsed_data = ? WHERE id = ? AND tenant_id = ?`
      ).bind(JSON.stringify({ ...parsed, outcomes, reprocessedFromLogId: logId }), reprocessLogId, tenantId).run();
    } else if (type.includes('ASTM')) {
      const raw = original.raw_message || '';
      const parsed = parseASTMMessage(raw);
      for (const patient of (parsed.patients ?? [])) {
        for (const order of (patient.orders ?? [])) {
          for (const result of (order.results ?? [])) {
            outcomes.push(await stageMachineResult(
              db,
              tenantId,
              userId,
              machineId,
              registration.messageId,
              reprocessLogId,
              observationIndex,
              orderGroupIndex,
              {
                testCode: result.testCode,
                testName: result.testName,
                value: result.value,
                units: result.units,
                referenceRange: result.referenceRange,
                abnormalFlag: result.abnormalFlag,
                resultStatus: result.status,
                comments: result.comments,
                completedAt: result.completedDateTime,
              },
              { barcode: order.order.specimenId || undefined },
              mapASTMAbnormalFlag,
              mapASTMResultStatus,
            ));
            observationIndex += 1;
          }
          orderGroupIndex += 1;
        }
      }
      await db.$client.prepare(
        `UPDATE lab_machine_result_log SET parsed_data = ? WHERE id = ? AND tenant_id = ?`
      ).bind(JSON.stringify({ ...parsed, outcomes, reprocessedFromLogId: logId }), reprocessLogId, tenantId).run();
    } else {
      const payload = JSON.parse(rawPayload);
      for (const result of payload.results ?? []) {
        outcomes.push(await stageMachineResult(
          db,
          tenantId,
          userId,
          machineId,
          registration.messageId,
          reprocessLogId,
          observationIndex,
          0,
          result,
          { barcode: payload.barcode ?? payload.specimenId, controlId: payload.controlId, orderNo: payload.orderNo },
        ));
        observationIndex += 1;
      }
      await db.$client.prepare(
        `UPDATE lab_machine_result_log SET parsed_data = ? WHERE id = ? AND tenant_id = ?`
      ).bind(JSON.stringify({ ...payload, outcomes, reprocessedFromLogId: logId }), reprocessLogId, tenantId).run();
    }

    const hasQuarantined = outcomes.some((outcome) =>
      ['unmatched', 'ambiguous', 'qc_blocked', 'validation_blocked'].includes(outcome.disposition)
    );
    await updateLisIngestionMessage(
      db,
      tenantId,
      registration.messageId,
      hasQuarantined ? 'partial' : 'completed',
      { outcomes, reprocessedFromLogId: logId },
    );
    await db.$client.prepare(
      `UPDATE lab_machine_result_log SET processing_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`
    ).bind(hasQuarantined ? 'partial' : 'staged', reprocessLogId, tenantId).run();
    await db.$client.prepare(
      `UPDATE lab_machines SET last_communication_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`
    ).bind(machineId, tenantId).run();
    return c.json({
      message: 'Result log staged again',
      disposition: 'staged',
      originalLogId: logId,
      reprocessLogId,
      messageId: registration.messageId,
      outcomes,
    });
  } catch (err: any) {
    await updateLisIngestionMessage(
      db,
      tenantId,
      registration.messageId,
      'error',
      { outcomes, reprocessedFromLogId: logId },
      err?.message ?? 'Unknown reprocess error',
    );
    await db.$client.prepare(
      `UPDATE lab_machine_result_log SET processing_status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`
    ).bind(err?.message ?? 'Unknown reprocess error', reprocessLogId, tenantId).run();
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(500, { message: 'Error reprocessing result log' });
  }
});

/** GET /:id/runs — Analyzer run/session summaries derived from existing raw message logs */
routes.get('/:id{[0-9]+}/runs', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const status = c.req.query('processing_status');
  const offset = (page - 1) * limit;

  let sql = `SELECT id, machine_id, message_type, processing_status, error_message, parsed_data, received_at, updated_at
             FROM lab_machine_result_log WHERE machine_id = ? AND tenant_id = ?`;
  const binds: (string | number)[] = [machineId, tenantId];
  if (status) {
    sql += ' AND processing_status = ?';
    binds.push(status);
  }
  sql += ' ORDER BY received_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...binds).all();

  let countSql = 'SELECT COUNT(*) as total FROM lab_machine_result_log WHERE machine_id = ? AND tenant_id = ?';
  const countBinds: (string | number)[] = [machineId, tenantId];
  if (status) {
    countSql += ' AND processing_status = ?';
    countBinds.push(status);
  }
  const countRow = await db.$client.prepare(countSql).bind(...countBinds).first() as any;
  const runs = (results ?? []).map(buildAnalyzerRunView);
  const summary = runs.reduce((acc, run) => {
    acc.runs += 1;
    acc.total_results += run.total_results;
    acc.matched += run.matched;
    acc.unmatched += run.unmatched;
    acc.processed += run.processed;
    acc.blocked += run.blocked;
    acc.duplicate += run.duplicate;
    acc.corrected += run.corrected;
    acc.qc += run.qc;
    acc.errors += run.errors;
    if (run.processing_status === 'completed' || run.processing_status === 'processed') acc.completed_runs += 1;
    if (run.processing_status === 'partial') acc.partial_runs += 1;
    if (run.processing_status === 'error' || run.errors > 0) acc.error_runs += 1;
    if (run.processing_status === 'qc_review') acc.qc_review_runs += 1;
    return acc;
  }, { runs: 0, completed_runs: 0, partial_runs: 0, error_runs: 0, qc_review_runs: 0, total_results: 0, matched: 0, unmatched: 0, processed: 0, blocked: 0, duplicate: 0, corrected: 0, qc: 0, errors: 0 });

  return c.json({
    data: runs,
    summary,
    pagination: {
      page,
      limit,
      total: countRow?.total ?? 0,
      totalPages: Math.ceil((countRow?.total ?? 0) / limit),
    },
  });
});

/** GET /:id/logs — Paginated message log */
routes.get('/:id/logs', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const status = c.req.query('processing_status');
  const offset = (page - 1) * limit;

  let sql = `SELECT id, machine_id, message_type, processing_status, error_message,
             matched_order_id, matched_item_id, received_at
             FROM lab_machine_result_log WHERE machine_id = ? AND tenant_id = ?`;
  const binds: (string | number)[] = [machineId, tenantId];

  if (status) {
    sql += ' AND processing_status = ?';
    binds.push(status);
  }
  sql += ' ORDER BY received_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...binds).all();

  // Count total
  let countSql = 'SELECT COUNT(*) as total FROM lab_machine_result_log WHERE machine_id = ? AND tenant_id = ?';
  const countBinds: (string | number)[] = [machineId, tenantId];
  if (status) {
    countSql += ' AND processing_status = ?';
    countBinds.push(status);
  }
  const countRow = await db.$client.prepare(countSql).bind(...countBinds).first() as any;

  return c.json({
    data: results,
    pagination: {
      page,
      limit,
      total: countRow?.total ?? 0,
      totalPages: Math.ceil((countRow?.total ?? 0) / limit),
    },
  });
});

/** POST /:id/ping — Update last communication and return status */
routes.post('/:id/ping', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));

  await db.$client.prepare(
    `UPDATE lab_machines SET last_communication_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(machineId, tenantId).run();

  const machine = await db.$client.prepare(
    'SELECT id, machine_name, machine_code, status, last_communication_at FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(machineId, tenantId).first();

  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });
  return c.json({ data: machine });
});

// ═══════════════════════════════════════════════════════════════════
// BIDIRECTIONAL ORDER SENDING
// ═══════════════════════════════════════════════════════════════════

/** GET /:id/pending-orders — List orders waiting to be sent */
routes.get('/:id/pending-orders', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));

  const machine = await db.$client.prepare(
    'SELECT id, protocol FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(machineId, tenantId).first();
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const { results } = await db.$client.prepare(`
    SELECT loi.id as item_id, loi.lab_order_id, loi.status,
           lo.order_no, lo.patient_id, lo.barcode,
           ${getDiagnosticBillingColumns('lo')},
           p.name as patient_name, p.patient_code, p.gender, p.date_of_birth,
           ltc.code as test_code, ltc.name as test_name,
           mtm.machine_test_code
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ?
    ${getDiagnosticBillingJoin('lo')}
    JOIN lab_machine_test_map mtm ON mtm.lab_test_id = loi.lab_test_id AND mtm.machine_id = ? AND mtm.tenant_id = ? AND mtm.is_active = 1
    JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = ?
    JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = ?
    WHERE loi.status IN ('pending', 'collected') AND loi.tenant_id = ?
    ORDER BY loi.id DESC
  `).bind(tenantId, machineId, tenantId, tenantId, tenantId, tenantId).all();

  const billableResults = (results as Record<string, unknown>[]).filter((row) => getDiagnosticBillingClearance(row).cleared);
  return c.json({ data: billableResults });
});

/** POST /:id/send-orders — Send pending orders TO machine */
routes.post('/:id/send-orders', zValidator('json', sendOrdersSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const machineId = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const machine = await db.$client.prepare(
    'SELECT * FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(machineId, tenantId).first() as any;
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const protocol = data.protocol || machine.protocol || 'hl7';

  // Fetch pending order items with mappings
  let itemSql = `
    SELECT loi.id as item_id, loi.lab_order_id, loi.lab_test_id,
           lo.order_no, lo.patient_id, lo.barcode,
           ${getDiagnosticBillingColumns('lo')},
           p.name as patient_name, p.patient_code, p.gender, p.date_of_birth,
           ltc.code as test_code, ltc.name as test_name,
           mtm.machine_test_code
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ?
    ${getDiagnosticBillingJoin('lo')}
    JOIN lab_machine_test_map mtm ON mtm.lab_test_id = loi.lab_test_id AND mtm.machine_id = ? AND mtm.tenant_id = ? AND mtm.is_active = 1
    JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = ?
    JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = ?
    WHERE loi.status IN ('pending', 'collected') AND loi.tenant_id = ?`;

  const itemBinds: (string | number)[] = [tenantId, machineId, tenantId, tenantId, tenantId, tenantId];

  if (data.orderItemIds && data.orderItemIds.length > 0) {
    const placeholders = data.orderItemIds.map(() => '?').join(',');
    itemSql += ` AND loi.id IN (${placeholders})`;
    itemBinds.push(...data.orderItemIds);
  }

  itemSql += ' ORDER BY loi.id DESC';

  const { results: items } = await db.$client.prepare(itemSql).bind(...itemBinds).all();
  const orderItems = (items as any[]).filter((row) => getDiagnosticBillingClearance(row).cleared);

  if (orderItems.length === 0) {
    return c.json({ message: 'No pending orders to send', sentCount: 0, messages: [] });
  }

  // Group by order for message generation
  const byOrder: Record<string, typeof orderItems> = {};
  for (const item of orderItems) {
    const key = String(item.lab_order_id);
    if (!byOrder[key]) byOrder[key] = [];
    byOrder[key].push(item);
  }

  const messages: { orderId: number; orderNo: string; format: string; message: string; itemIds: number[] }[] = [];
  const sentIds: number[] = [];

  for (const [orderId, orderItemsGroup] of Object.entries(byOrder)) {
    const first = orderItemsGroup[0];
    const order = {
      orderNo: first.order_no,
      patientId: String(first.patient_id),
      patientName: first.patient_name,
      patientDob: first.date_of_birth,
      patientGender: first.gender,
      tests: orderItemsGroup.map((i: any) => ({ testCode: i.machine_test_code, testName: i.test_name })),
    };

    let rawMessage: string;
    if (protocol === 'astm') {
      rawMessage = generateASTMOrder(order);
    } else {
      rawMessage = generateHL7ORM(order, machine.machine_code, `ORM${Date.now()}-${orderId}`);
    }

    // Persist each item as a machine order
    for (const item of orderItemsGroup) {
      const result = await db.$client.prepare(`
        INSERT INTO lab_machine_orders (
          machine_id, lab_order_id, lab_order_item_id, machine_test_code,
          status, sent_at, raw_request, tenant_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'sent', CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(machineId, item.lab_order_id, item.item_id, item.machine_test_code, rawMessage, tenantId).run();

      sentIds.push(result.meta.last_row_id as number);
    }

    // Update order items status to processing
    await db.$client.prepare(`
      UPDATE lab_order_items SET status = 'processing', updated_at = CURRENT_TIMESTAMP
      WHERE lab_order_id = ? AND tenant_id = ? AND status IN ('pending', 'collected')
    `).bind(first.lab_order_id, tenantId).run();

    messages.push({
      orderId: Number(orderId),
      orderNo: first.order_no,
      format: protocol,
      message: rawMessage,
      itemIds: orderItemsGroup.map((i: any) => i.item_id),
    });

    // Attempt HTTP delivery if configured
    if (machine.connection_type === 'http' && machine.host_address) {
      try {
        const response = await fetch(machine.host_address, {
          method: 'POST',
          headers: { 'Content-Type': protocol === 'hl7' ? 'application/hl7-v2' : 'text/plain' },
          body: rawMessage,
        });
        const responseText = await response.text().catch(() => '');
        await db.$client.prepare(`
          UPDATE lab_machine_orders SET raw_response = ?
          WHERE machine_id = ? AND lab_order_id = ? AND tenant_id = ?
        `).bind(responseText, machineId, first.lab_order_id, tenantId).run();
      } catch (err: any) {
        // Non-blocking: log delivery failure but don't fail the request
        await db.$client.prepare(`
          UPDATE lab_machine_orders SET raw_response = ?
          WHERE machine_id = ? AND lab_order_id = ? AND tenant_id = ?
        `).bind(`HTTP_ERROR: ${err.message ?? 'Unknown'}`, machineId, first.lab_order_id, tenantId).run();
      }
    }
  }

  return c.json({ message: 'Orders sent', sentCount: orderItems.length, messages, machineOrderIds: sentIds });
});

/** POST /:id/acknowledge — Machine acknowledges receipt */
routes.post('/:id/acknowledge', zValidator('json', acknowledgeOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const machine = await db.$client.prepare(
    'SELECT id FROM lab_machines WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(machineId, tenantId).first();
  if (!machine) throw new HTTPException(404, { message: 'Machine not found' });

  const result = await db.$client.prepare(`
    UPDATE lab_machine_orders SET status = 'acknowledged', acknowledged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND machine_id = ? AND tenant_id = ?
  `).bind(data.machineOrderId, machineId, tenantId).run();

  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Machine order not found' });

  return c.json({ message: 'Order acknowledged' });
});

export default routes;

const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_ATTEMPTS = 5;

interface RetractionPayload {
  requestId: number;
  inboxId?: number;
  labResultId?: number;
  labReportId: number;
  labOrderItemId?: number;
  labOrderId: number;
  patientId: number | null;
  reasonCode: string;
  reason: string;
  notes?: string | null;
  requestedBy?: number;
  approvedBy?: number;
}

interface RecipientPolicy {
  notifyPatient?: boolean;
  notifyOrderingClinician?: boolean;
  notifyLaboratoryGovernance?: boolean;
  channels?: string[];
}

interface OutboxRow {
  id: number;
  tenant_id: string;
  retraction_request_id: number;
  payload_json: string;
  recipient_policy_json: string;
  status: string;
  attempt_count: number;
}

interface DeliveryRow {
  id: number;
  tenant_id: string;
  outbox_id: number;
  channel: 'in_app' | 'portal';
  recipient_type: 'user' | 'patient';
  recipient_id: number;
  delivery_key: string;
  status: string;
  attempt_count: number;
}

export interface LisRetractionNotificationContent {
  title: string;
  message: string;
  link: string;
  portalLink: string;
  metadata: Record<string, unknown>;
}

export interface DispatchLisRetractionNotificationsOptions {
  limit?: number;
  maxAttempts?: number;
}

export interface DispatchLisRetractionNotificationsResult {
  scanned: number;
  expanded: number;
  sent: number;
  retried: number;
  terminalFailed: number;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function extractChanges(result: unknown): number {
  return Number((result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
}

function parseJsonObject<T extends Record<string, unknown>>(value: string): T {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Notification evidence must be a JSON object');
  }
  return parsed as T;
}

function normalizePayload(value: string): RetractionPayload {
  const payload = parseJsonObject<Record<string, unknown>>(value);
  const requestId = Number(payload.requestId);
  const labReportId = Number(payload.labReportId);
  const labOrderId = Number(payload.labOrderId);
  const patientId = payload.patientId == null ? null : Number(payload.patientId);
  const reasonCode = String(payload.reasonCode ?? '').trim();
  const reason = String(payload.reason ?? '').trim();

  if (!Number.isInteger(requestId) || requestId <= 0
    || !Number.isInteger(labReportId) || labReportId <= 0
    || !Number.isInteger(labOrderId) || labOrderId <= 0
    || (patientId != null && (!Number.isInteger(patientId) || patientId <= 0))
    || reasonCode.length === 0
    || reason.length === 0) {
    throw new Error('Retraction notification payload is incomplete');
  }

  return {
    requestId,
    inboxId: payload.inboxId == null ? undefined : Number(payload.inboxId),
    labResultId: payload.labResultId == null ? undefined : Number(payload.labResultId),
    labReportId,
    labOrderItemId: payload.labOrderItemId == null ? undefined : Number(payload.labOrderItemId),
    labOrderId,
    patientId,
    reasonCode,
    reason,
    notes: payload.notes == null ? null : String(payload.notes),
    requestedBy: payload.requestedBy == null ? undefined : Number(payload.requestedBy),
    approvedBy: payload.approvedBy == null ? undefined : Number(payload.approvedBy),
  };
}

function normalizePolicy(value: string): RecipientPolicy {
  const policy = parseJsonObject<Record<string, unknown>>(value);
  return {
    notifyPatient: policy.notifyPatient === true,
    notifyOrderingClinician: policy.notifyOrderingClinician === true,
    notifyLaboratoryGovernance: policy.notifyLaboratoryGovernance === true,
    channels: Array.isArray(policy.channels)
      ? policy.channels.map(channel => String(channel).trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

export function lisRetractionNotificationBackoffMinutes(attempt: number): number {
  const schedule = [1, 5, 15, 60, 180, 360];
  const normalized = Math.max(1, Math.floor(Number(attempt) || 1));
  return schedule[Math.min(normalized - 1, schedule.length - 1)];
}

export function buildLisRetractionNotificationContent(payload: RetractionPayload): LisRetractionNotificationContent {
  const reasonLabel = payload.reasonCode.replace(/_/g, ' ');
  return {
    title: 'Laboratory report withdrawn',
    message: `A laboratory report was formally withdrawn (${reasonLabel}): ${payload.reason}. Do not use the withdrawn report for clinical decisions. Open the report history for the approved correction or amendment.`,
    link: `/lab/${payload.labOrderId}/report`,
    portalLink: '/lab-results',
    metadata: {
      requestId: payload.requestId,
      labReportId: payload.labReportId,
      labOrderId: payload.labOrderId,
      patientId: payload.patientId,
      reasonCode: payload.reasonCode,
    },
  };
}

async function expandDeliveries(
  db: D1Database,
  outbox: OutboxRow,
  policy: RecipientPolicy,
): Promise<number> {
  const statements: D1PreparedStatement[] = [];

  if (policy.channels?.includes('in_app') && policy.notifyLaboratoryGovernance) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO lis_result_retraction_notification_deliveries (
        tenant_id, outbox_id, channel, recipient_type, recipient_id,
        delivery_key, status, attempt_count, created_at, updated_at
      )
      SELECT
        outbox.tenant_id, outbox.id, 'in_app', 'user', user.id,
        'lis-retraction:' || outbox.id || ':in_app:user:' || user.id,
        'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM lis_result_retraction_notification_outbox outbox
      JOIN users user
        ON user.tenant_id = outbox.tenant_id
       AND user.role IN ('pathologist', 'lab_supervisor', 'hospital_admin', 'md', 'laboratory', 'lab')
       AND COALESCE(user.is_active, 1) = 1
      WHERE outbox.id = ? AND outbox.tenant_id = ?
    `).bind(outbox.id, outbox.tenant_id));
  }

  if (policy.channels?.includes('in_app') && policy.notifyOrderingClinician) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO lis_result_retraction_notification_deliveries (
        tenant_id, outbox_id, channel, recipient_type, recipient_id,
        delivery_key, status, attempt_count, created_at, updated_at
      )
      SELECT
        outbox.tenant_id, outbox.id, 'in_app', 'user', ordering_user.id,
        'lis-retraction:' || outbox.id || ':in_app:user:' || ordering_user.id,
        'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM lis_result_retraction_notification_outbox outbox
      JOIN lis_result_retraction_requests request
        ON request.id = outbox.retraction_request_id
       AND request.tenant_id = outbox.tenant_id
      JOIN lab_orders lab_order
        ON lab_order.id = request.lab_order_id
       AND lab_order.tenant_id = outbox.tenant_id
      JOIN users ordering_user
        ON ordering_user.id = lab_order.ordered_by
       AND ordering_user.tenant_id = outbox.tenant_id
       AND COALESCE(ordering_user.is_active, 1) = 1
      WHERE outbox.id = ? AND outbox.tenant_id = ?
        AND lab_order.ordered_by IS NOT NULL
    `).bind(outbox.id, outbox.tenant_id));
  }

  if (policy.channels?.includes('portal') && policy.notifyPatient) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO lis_result_retraction_notification_deliveries (
        tenant_id, outbox_id, channel, recipient_type, recipient_id,
        delivery_key, status, attempt_count, created_at, updated_at
      )
      SELECT
        outbox.tenant_id, outbox.id, 'portal', 'patient', patient.id,
        'lis-retraction:' || outbox.id || ':portal:patient:' || patient.id,
        'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM lis_result_retraction_notification_outbox outbox
      JOIN lis_result_retraction_requests request
        ON request.id = outbox.retraction_request_id
       AND request.tenant_id = outbox.tenant_id
      JOIN patients patient
        ON patient.id = request.patient_id
       AND patient.tenant_id = outbox.tenant_id
      WHERE outbox.id = ? AND outbox.tenant_id = ?
    `).bind(outbox.id, outbox.tenant_id));
  }

  if (statements.length === 0) return 0;
  const results = await db.batch(statements);
  return results.reduce((sum, result) => sum + extractChanges(result), 0);
}

async function claimDelivery(db: D1Database, delivery: DeliveryRow, maxAttempts: number): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE lis_result_retraction_notification_deliveries
    SET status = 'processing',
        attempt_count = attempt_count + 1,
        processing_started_at = CURRENT_TIMESTAMP,
        next_attempt_at = NULL,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ?
      AND attempt_count < ?
      AND (
        status = 'pending'
        OR (status = 'failed' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP))
        OR (status = 'processing' AND processing_started_at <= DATETIME(CURRENT_TIMESTAMP, '-10 minutes'))
      )
  `).bind(delivery.id, delivery.tenant_id, maxAttempts).run();
  return extractChanges(result) === 1;
}

async function deliverToDatabaseChannel(
  db: D1Database,
  delivery: DeliveryRow,
  content: LisRetractionNotificationContent,
): Promise<string> {
  if (delivery.channel === 'in_app' && delivery.recipient_type === 'user') {
    await db.prepare(`
      INSERT OR IGNORE INTO notifications (
        tenant_id, user_id, type, title, message, is_read, link, dedupe_key, created_at
      ) VALUES (?, ?, 'lab', ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      delivery.tenant_id,
      delivery.recipient_id,
      content.title,
      content.message,
      content.link,
      delivery.delivery_key,
    ).run();
    return `notification:${delivery.delivery_key}`;
  }

  if (delivery.channel === 'portal' && delivery.recipient_type === 'patient') {
    await db.prepare(`
      INSERT OR IGNORE INTO patient_portal_notifications (
        tenant_id, patient_id, category, title, message, link,
        metadata_json, dedupe_key, is_read, created_at
      ) VALUES (?, ?, 'lab_result_retraction', ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
    `).bind(
      delivery.tenant_id,
      delivery.recipient_id,
      content.title,
      content.message,
      content.portalLink,
      JSON.stringify(content.metadata),
      delivery.delivery_key,
    ).run();
    return `portal:${delivery.delivery_key}`;
  }

  throw new Error(`Unsupported retraction notification delivery ${delivery.channel}/${delivery.recipient_type}`);
}

async function markDeliverySent(db: D1Database, delivery: DeliveryRow, providerMessageId: string): Promise<void> {
  await db.prepare(`
    UPDATE lis_result_retraction_notification_deliveries
    SET status = 'sent',
        provider_message_id = ?,
        sent_at = CURRENT_TIMESTAMP,
        processing_started_at = NULL,
        next_attempt_at = NULL,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ? AND status = 'processing'
  `).bind(providerMessageId, delivery.id, delivery.tenant_id).run();
}

async function markDeliveryFailed(
  db: D1Database,
  delivery: DeliveryRow,
  error: unknown,
  maxAttempts: number,
): Promise<boolean> {
  const nextAttempt = Number(delivery.attempt_count) + 1;
  const terminal = nextAttempt >= maxAttempts;
  const minutes = lisRetractionNotificationBackoffMinutes(nextAttempt);
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);

  await db.prepare(`
    UPDATE lis_result_retraction_notification_deliveries
    SET status = 'failed',
        processing_started_at = NULL,
        next_attempt_at = CASE WHEN ? = 1 THEN NULL ELSE DATETIME(CURRENT_TIMESTAMP, '+' || ? || ' minutes') END,
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ? AND status = 'processing'
  `).bind(terminal ? 1 : 0, minutes, message, delivery.id, delivery.tenant_id).run();
  return terminal;
}

async function refreshOutboxStatus(
  db: D1Database,
  outbox: OutboxRow,
  maxAttempts: number,
): Promise<{ status: 'pending' | 'sent' | 'failed'; total: number }> {
  const summary = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status IN ('pending', 'processing') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'failed' AND attempt_count < ? THEN 1 ELSE 0 END) AS retryable_failed,
      SUM(CASE WHEN status = 'failed' AND attempt_count >= ? THEN 1 ELSE 0 END) AS terminal_failed,
      MIN(CASE WHEN status = 'failed' AND attempt_count < ? THEN next_attempt_at END) AS next_attempt_at,
      MAX(CASE WHEN status = 'failed' THEN last_error END) AS last_error
    FROM lis_result_retraction_notification_deliveries
    WHERE outbox_id = ? AND tenant_id = ?
  `).bind(maxAttempts, maxAttempts, maxAttempts, outbox.id, outbox.tenant_id).first<{
    total: number;
    sent: number | null;
    active: number | null;
    retryable_failed: number | null;
    terminal_failed: number | null;
    next_attempt_at: string | null;
    last_error: string | null;
  }>();

  const total = Number(summary?.total ?? 0);
  const active = Number(summary?.active ?? 0);
  const retryable = Number(summary?.retryable_failed ?? 0);
  const terminalFailed = Number(summary?.terminal_failed ?? 0);
  const nextStatus: 'pending' | 'sent' | 'failed' = total === 0
    ? 'failed'
    : active > 0 || retryable > 0
      ? 'pending'
      : terminalFailed > 0
        ? 'failed'
        : 'sent';
  const nextError = total === 0
    ? 'No eligible retraction notification recipients'
    : terminalFailed > 0 || retryable > 0
      ? summary?.last_error ?? null
      : null;

  await db.prepare(`
    UPDATE lis_result_retraction_notification_outbox
    SET status = ?,
        attempt_count = attempt_count + 1,
        next_attempt_at = ?,
        last_error = ?,
        sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, CURRENT_TIMESTAMP) ELSE sent_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ? AND status <> 'sent'
  `).bind(
    nextStatus,
    summary?.next_attempt_at ?? null,
    nextError,
    nextStatus,
    outbox.id,
    outbox.tenant_id,
  ).run();

  return { status: nextStatus, total };
}

async function failMalformedOutbox(db: D1Database, outbox: OutboxRow, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  await db.prepare(`
    UPDATE lis_result_retraction_notification_outbox
    SET status = 'failed',
        attempt_count = attempt_count + 1,
        last_error = ?,
        next_attempt_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ? AND status <> 'sent'
  `).bind(message, outbox.id, outbox.tenant_id).run();
}

export async function dispatchLisRetractionNotifications(
  db: D1Database,
  options: DispatchLisRetractionNotificationsOptions = {},
): Promise<DispatchLisRetractionNotificationsResult> {
  const limit = Math.min(100, positiveInteger(options.limit, DEFAULT_LIMIT));
  const maxAttempts = Math.min(20, positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS));
  const due = await db.prepare(`
    SELECT id, tenant_id, retraction_request_id, payload_json, recipient_policy_json,
           status, attempt_count
    FROM lis_result_retraction_notification_outbox
    WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP))
       OR (status = 'processing' AND updated_at <= DATETIME(CURRENT_TIMESTAMP, '-10 minutes'))
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).bind(limit).all<OutboxRow>();

  const result: DispatchLisRetractionNotificationsResult = {
    scanned: due.results.length,
    expanded: 0,
    sent: 0,
    retried: 0,
    terminalFailed: 0,
  };

  for (const outbox of due.results) {
    let payload: RetractionPayload;
    let policy: RecipientPolicy;
    try {
      payload = normalizePayload(outbox.payload_json);
      policy = normalizePolicy(outbox.recipient_policy_json);
    } catch (error) {
      await failMalformedOutbox(db, outbox, error);
      result.terminalFailed += 1;
      continue;
    }

    const content = buildLisRetractionNotificationContent(payload);
    result.expanded += await expandDeliveries(db, outbox, policy);
    await db.prepare(`
      UPDATE lis_result_retraction_notification_outbox
      SET status = 'processing', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ? AND status <> 'sent'
    `).bind(outbox.id, outbox.tenant_id).run();

    const deliveries = await db.prepare(`
      SELECT id, tenant_id, outbox_id, channel, recipient_type, recipient_id,
             delivery_key, status, attempt_count
      FROM lis_result_retraction_notification_deliveries
      WHERE outbox_id = ? AND tenant_id = ?
        AND attempt_count < ?
        AND (
          status = 'pending'
          OR (status = 'failed' AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP))
          OR (status = 'processing' AND processing_started_at <= DATETIME(CURRENT_TIMESTAMP, '-10 minutes'))
        )
      ORDER BY id ASC
    `).bind(outbox.id, outbox.tenant_id, maxAttempts).all<DeliveryRow>();

    for (const delivery of deliveries.results) {
      if (!await claimDelivery(db, delivery, maxAttempts)) continue;
      try {
        const providerMessageId = await deliverToDatabaseChannel(db, delivery, content);
        await markDeliverySent(db, delivery, providerMessageId);
        result.sent += 1;
      } catch (error) {
        const terminal = await markDeliveryFailed(db, delivery, error, maxAttempts);
        if (terminal) result.terminalFailed += 1;
        else result.retried += 1;
      }
    }

    const refreshed = await refreshOutboxStatus(db, outbox, maxAttempts);
    if (refreshed.status === 'failed' && refreshed.total === 0) {
      result.terminalFailed += 1;
    }
  }

  return result;
}

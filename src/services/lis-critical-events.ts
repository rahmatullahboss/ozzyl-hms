const CRITICAL_ACKNOWLEDGEMENT_ROLES = new Set([
  'doctor',
  'pathologist',
  'lab_supervisor',
  'hospital_admin',
  'md',
]);

export class LisCriticalEventError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LisCriticalEventError';
  }
}

export interface AcknowledgeLisCriticalEventInput {
  tenantId: string | number;
  eventId: number;
  actorUserId: string | number;
  actorRole: string;
  note?: string;
}

interface CriticalEventRow {
  id: number;
  tenant_id: string | number;
  lis_analyzer_inbox_id: number;
  status: string;
  acknowledgement_deadline: string | null;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
}

function parsePositiveInteger(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LisCriticalEventError(`${field} must be a positive integer`, 'invalid_identifier', 400);
  }
  return parsed;
}

function extractChanges(result: D1Result<unknown>): number {
  return Number(result.meta?.changes ?? 0);
}

export async function acknowledgeLisCriticalEvent(
  database: D1Database,
  input: AcknowledgeLisCriticalEventInput,
): Promise<{
  acknowledged: true;
  eventId: number;
  inboxId: number;
  previousStatus: string;
}> {
  const actorRole = String(input.actorRole || '').trim().toLowerCase();
  if (!CRITICAL_ACKNOWLEDGEMENT_ROLES.has(actorRole)) {
    throw new LisCriticalEventError(
      'Only accountable clinical or laboratory governance roles may acknowledge a critical result',
      'forbidden',
      403,
    );
  }

  const eventId = parsePositiveInteger(input.eventId, 'eventId');
  const actorUserId = parsePositiveInteger(input.actorUserId, 'actorUserId');
  const event = await database.prepare(`
    SELECT id, tenant_id, lis_analyzer_inbox_id, status,
           acknowledgement_deadline, acknowledged_by, acknowledged_at
    FROM lis_critical_event_outbox
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(eventId, input.tenantId).first<CriticalEventRow>();

  if (!event) {
    throw new LisCriticalEventError('Critical result event not found', 'not_found', 404);
  }
  if (event.status === 'acknowledged' || event.status === 'cancelled') {
    throw new LisCriticalEventError(
      `Critical result event is already closed (${event.status})`,
      'already_closed',
      409,
    );
  }
  if (!['pending', 'processing', 'delivered', 'escalated', 'failed'].includes(event.status)) {
    throw new LisCriticalEventError(
      `Critical result event cannot be acknowledged from status ${event.status}`,
      'invalid_state',
      409,
    );
  }

  const note = String(input.note ?? '').trim() || null;
  const update = await database.prepare(`
    UPDATE lis_critical_event_outbox
    SET status = 'acknowledged',
        acknowledged_by = ?,
        acknowledged_at = CURRENT_TIMESTAMP,
        acknowledgement_note = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ?
      AND status IN ('pending', 'processing', 'delivered', 'escalated', 'failed')
  `).bind(actorUserId, note, eventId, input.tenantId).run();

  if (extractChanges(update) !== 1) {
    throw new LisCriticalEventError(
      'Critical result event changed before acknowledgement',
      'acknowledgement_conflict',
      409,
    );
  }

  return {
    acknowledged: true,
    eventId,
    inboxId: Number(event.lis_analyzer_inbox_id),
    previousStatus: event.status,
  };
}

export async function escalateOverdueLisCriticalEvents(
  database: D1Database,
  tenantId: string | number,
  now: Date = new Date(),
): Promise<{ escalated: number }> {
  if (Number.isNaN(now.getTime())) {
    throw new LisCriticalEventError('Invalid escalation timestamp', 'invalid_timestamp', 400);
  }
  const nowIso = now.toISOString();
  const result = await database.prepare(`
    UPDATE lis_critical_event_outbox
    SET status = 'escalated',
        attempt_count = attempt_count + 1,
        next_attempt_at = DATETIME(?, '+15 minutes'),
        last_error = COALESCE(last_error, 'Acknowledgement deadline exceeded'),
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ?
      AND status IN ('pending', 'processing', 'delivered', 'failed')
      AND acknowledgement_deadline IS NOT NULL
      AND acknowledgement_deadline <= ?
  `).bind(nowIso, tenantId, nowIso).run();

  return { escalated: extractChanges(result) };
}

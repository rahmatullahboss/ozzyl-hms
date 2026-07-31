export const INVENTORY_CONSUMPTION_EXCEPTION_REASONS = [
  'missing_rule',
  'stock_shortage',
  'scan_missing',
  'approval_required',
  'variance_high',
  'duplicate_event',
  'reference_missing',
  'reversal_failed',
] as const;

export const INVENTORY_CONSUMPTION_EXCEPTION_SEVERITIES = ['info', 'warning', 'critical'] as const;
export const INVENTORY_CONSUMPTION_EXCEPTION_STATUSES = ['open', 'reviewed', 'resolved', 'ignored'] as const;

export type InventoryConsumptionExceptionReason = typeof INVENTORY_CONSUMPTION_EXCEPTION_REASONS[number];
export type InventoryConsumptionExceptionSeverity = typeof INVENTORY_CONSUMPTION_EXCEPTION_SEVERITIES[number];
export type InventoryConsumptionExceptionStatus = typeof INVENTORY_CONSUMPTION_EXCEPTION_STATUSES[number];

export type ConsumptionExceptionInput = {
  tenantId: string;
  eventId: number;
  eventItemId?: number | null;
  reason: InventoryConsumptionExceptionReason;
  severity?: InventoryConsumptionExceptionSeverity;
  message: string;
  createdBy?: number | null;
};

export type NormalizedConsumptionExceptionInput = {
  tenantId: string;
  eventId: number;
  eventItemId: number | null;
  reason: InventoryConsumptionExceptionReason;
  severity: InventoryConsumptionExceptionSeverity;
  message: string;
  createdBy: number | null;
};

function trimRequired(value: unknown, field: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error(`${field} must be a positive integer`);
  return numeric;
}

function isReason(value: unknown): value is InventoryConsumptionExceptionReason {
  return typeof value === 'string' && (INVENTORY_CONSUMPTION_EXCEPTION_REASONS as readonly string[]).includes(value);
}

function isSeverity(value: unknown): value is InventoryConsumptionExceptionSeverity {
  return typeof value === 'string' && (INVENTORY_CONSUMPTION_EXCEPTION_SEVERITIES as readonly string[]).includes(value);
}

export function normalizeConsumptionExceptionInput(input: ConsumptionExceptionInput): NormalizedConsumptionExceptionInput {
  const tenantId = trimRequired(input.tenantId, 'tenantId');
  const eventId = optionalPositiveInteger(input.eventId, 'eventId');
  if (!eventId) throw new Error('eventId is required');
  if (!isReason(input.reason)) throw new Error(`Invalid reason: ${String(input.reason)}`);
  const severity = input.severity ?? 'warning';
  if (!isSeverity(severity)) throw new Error(`Invalid severity: ${String(severity)}`);
  return {
    tenantId,
    eventId,
    eventItemId: optionalPositiveInteger(input.eventItemId, 'eventItemId'),
    reason: input.reason,
    severity,
    message: trimRequired(input.message, 'message'),
    createdBy: optionalPositiveInteger(input.createdBy, 'createdBy'),
  };
}

export type ConsumptionExceptionDb = {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      run(): Promise<{ success?: boolean; meta?: { last_row_id?: number | string; changes?: number } }>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
};

function isStatus(value: unknown): value is InventoryConsumptionExceptionStatus {
  return typeof value === 'string' && (INVENTORY_CONSUMPTION_EXCEPTION_STATUSES as readonly string[]).includes(value);
}

export async function createConsumptionException(db: ConsumptionExceptionDb, input: ConsumptionExceptionInput): Promise<{ exceptionId: number }> {
  const exception = normalizeConsumptionExceptionInput(input);
  const result = await db.prepare(`
    INSERT INTO InventoryConsumptionException
      (tenant_id, EventId, EventItemId, Reason, Severity, Message, CreatedBy)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    exception.tenantId,
    exception.eventId,
    exception.eventItemId,
    exception.reason,
    exception.severity,
    exception.message,
    exception.createdBy,
  ).run();
  const exceptionId = Number(result.meta?.last_row_id ?? 0);
  if (!exceptionId) throw new Error('Failed to create consumption exception');
  return { exceptionId };
}

export async function reviewConsumptionException(db: ConsumptionExceptionDb, input: {
  tenantId: string;
  exceptionId: number;
  status: InventoryConsumptionExceptionStatus;
  reviewedBy: number;
  resolutionNote?: string | null;
}): Promise<{ exceptionId: number; status: InventoryConsumptionExceptionStatus }> {
  const tenantId = trimRequired(input.tenantId, 'tenantId');
  const exceptionId = optionalPositiveInteger(input.exceptionId, 'exceptionId');
  if (!exceptionId) throw new Error('exceptionId is required');
  const reviewedBy = optionalPositiveInteger(input.reviewedBy, 'reviewedBy');
  if (!reviewedBy) throw new Error('reviewedBy is required');
  if (!isStatus(input.status)) throw new Error(`Invalid status: ${String(input.status)}`);
  const resolutionNote = String(input.resolutionNote ?? '').trim() || null;

  await db.prepare(`
    UPDATE InventoryConsumptionException
    SET Status = ?,
        ReviewedBy = ?,
        ReviewedAt = CURRENT_TIMESTAMP,
        ResolutionNote = ?
    WHERE tenant_id = ? AND ExceptionId = ?
  `).bind(input.status, reviewedBy, resolutionNote, tenantId, exceptionId).run();
  return { exceptionId, status: input.status };
}


export type ConsumptionExceptionListFilters = {
  status?: InventoryConsumptionExceptionStatus;
  severity?: InventoryConsumptionExceptionSeverity;
  reason?: InventoryConsumptionExceptionReason;
  limit?: number;
};

export async function listConsumptionExceptions<T = unknown>(
  db: ConsumptionExceptionDb,
  tenantId: string,
  filters: ConsumptionExceptionListFilters = {},
): Promise<T[]> {
  const where = ['tenant_id = ?'];
  const params: unknown[] = [String(tenantId).trim()];

  if (filters.status) {
    if (!isStatus(filters.status)) throw new Error(`Invalid status: ${String(filters.status)}`);
    where.push('Status = ?');
    params.push(filters.status);
  }
  if (filters.severity) {
    if (!isSeverity(filters.severity)) throw new Error(`Invalid severity: ${String(filters.severity)}`);
    where.push('Severity = ?');
    params.push(filters.severity);
  }
  if (filters.reason) {
    if (!isReason(filters.reason)) throw new Error(`Invalid reason: ${String(filters.reason)}`);
    where.push('Reason = ?');
    params.push(filters.reason);
  }
  const limit = Math.min(Math.max(Number(filters.limit ?? 100), 1), 500);
  params.push(limit);

  const rows = await db.prepare(`
    SELECT *
    FROM InventoryConsumptionException
    WHERE ${where.join(' AND ')}
    ORDER BY CreatedOn DESC, ExceptionId DESC
    LIMIT ?
  `).bind(...params).all<T>();

  return rows.results ?? [];
}

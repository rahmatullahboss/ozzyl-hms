import { getDiagnosticBillingClearance, type DiagnosticBillingRow } from './diagnostic-billing';

export const LAB_ITEM_TRANSITIONS: Record<string, string[]> = {
  pending: ['collected', 'rejected'],
  collected: ['received', 'rejected'],
  received: ['processing', 'rejected'],
  processing: ['completed', 'rejected'],
  completed: ['verified'],
  verified: [],
  rejected: ['pending'],
  cancelled: [],
};

export type LabScanEntityType = 'order' | 'sample' | 'item' | 'unknown';

export interface LabScanResolution {
  entityType: LabScanEntityType;
  normalized: string;
  orderNo?: string;
  sampleBarcode?: string;
  itemId?: number;
}

export interface LabWorkflowEventInput {
  tenantId: string | number;
  userId?: string | number | null;
  actorRole?: string | null;
  eventType: string;
  eventStage?: string | null;
  labOrderId?: number | null;
  labOrderItemId?: number | null;
  labReportId?: number | null;
  patientId?: number | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  notes?: string | null;
  metadata?: unknown;
}

function safeStringify(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'non_serializable_metadata' });
  }
}

export function isLabStatusTransitionAllowed(currentStatus: string | null | undefined, nextStatus: string): boolean {
  const current = String(currentStatus ?? 'pending').trim().toLowerCase() || 'pending';
  const allowed = LAB_ITEM_TRANSITIONS[current] ?? [];
  return allowed.includes(nextStatus);
}

export function buildLabSampleBarcode(itemId: number): string {
  return `SAMPLE-${String(itemId).padStart(6, '0')}`;
}

export function resolveLabScanCode(input: string): LabScanResolution {
  const normalized = String(input ?? '').trim();
  const upper = normalized.toUpperCase();

  if (!normalized) {
    return { entityType: 'unknown', normalized: '' };
  }

  const sampleMatch = upper.match(/^SAMPLE[-:/]?(\d{1,12})$/);
  if (sampleMatch) {
    return {
      entityType: 'sample',
      normalized: upper,
      sampleBarcode: upper,
      itemId: Number(sampleMatch[1]),
    };
  }

  const orderMatch = upper.match(/^(LABORDER|LO)[-:/]?([A-Z0-9]+)$/);
  if (orderMatch) {
    const suffix = orderMatch[2];
    return {
      entityType: 'order',
      normalized: upper,
      orderNo: upper.startsWith('LO-') ? upper : `LO-${suffix}`,
    };
  }

  const testItemMatch = upper.match(/^TEST[-:/]?(\d{1,12})$/);
  if (testItemMatch) {
    return {
      entityType: 'item',
      normalized: upper,
      itemId: Number(testItemMatch[1]),
    };
  }

  if (/^[A-Z0-9-]{4,40}$/.test(upper)) {
    return {
      entityType: 'sample',
      normalized: upper,
      sampleBarcode: upper,
    };
  }

  return { entityType: 'unknown', normalized };
}

export function calculateLabTatMinutes(
  orderedAt: string | null | undefined,
  completedAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!orderedAt) return null;

  const start = new Date(orderedAt);
  const end = completedAt ? new Date(completedAt) : now;
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }

  return Math.round((endMs - startMs) / 60000);
}

export function isLabDelayed(
  orderedAt: string | null | undefined,
  targetTatMinutes: number | null | undefined,
  completedAt?: string | null,
  now: Date = new Date(),
): boolean {
  if (!targetTatMinutes || targetTatMinutes <= 0) return false;
  const tat = calculateLabTatMinutes(orderedAt, completedAt ?? null, now);
  return tat !== null && tat > targetTatMinutes;
}

export function assertLabBillingCleared(row: DiagnosticBillingRow, workflow: string): void {
  const clearance = getDiagnosticBillingClearance(row);
  if (!clearance.cleared) {
    throw new Error(
      `Diagnostic bill payment required before ${workflow}. Bill #${clearance.billId ?? 'unknown'} is ${clearance.paymentStatus}; outstanding ${clearance.outstanding}.`,
    );
  }
}

export async function recordLabWorkflowEvent(db: D1Database, event: LabWorkflowEventInput): Promise<void> {
  await db.prepare(`
    INSERT INTO lab_workflow_events (
      event_type,
      event_stage,
      lab_order_id,
      lab_order_item_id,
      lab_report_id,
      patient_id,
      from_status,
      to_status,
      actor_user_id,
      actor_role,
      notes,
      metadata_json,
      tenant_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
  `).bind(
    event.eventType,
    event.eventStage ?? null,
    event.labOrderId ?? null,
    event.labOrderItemId ?? null,
    event.labReportId ?? null,
    event.patientId ?? null,
    event.fromStatus ?? null,
    event.toStatus ?? null,
    event.userId ?? null,
    event.actorRole ?? null,
    event.notes ?? null,
    safeStringify(event.metadata),
    String(event.tenantId),
  ).run();
}

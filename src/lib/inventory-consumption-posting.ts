import type { CreateInventoryIssuePayload, InventoryIssueType } from './inventory-issue-service';
import type { InventoryConsumptionDeductionMode, InventoryConsumptionTriggerType } from './inventory-consumption-rules';
import type { InventoryConsumptionEventStatus } from './inventory-consumption-events';

export type ConsumptionPostingDb = {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
};

export type ConsumptionEventRow = {
  EventId: number;
  EventNo: string;
  tenant_id: string;
  TriggerType: InventoryConsumptionTriggerType;
  TriggerId?: number | null;
  PatientId?: number | null;
  VisitId?: number | null;
  AdmissionId?: number | null;
  BillId?: number | null;
  InvoiceItemId?: number | null;
  LabOrderId?: number | null;
  OTCaseId?: number | null;
  ProcedureId?: number | null;
  Department?: string | null;
  StoreId?: number | null;
  DeductionMode: InventoryConsumptionDeductionMode;
  Status: InventoryConsumptionEventStatus;
  PostedConsumptionId?: number | null;
  Remarks?: string | null;
};

export type ConsumptionEventItemRow = {
  EventItemId: number;
  ItemId: number;
  StockId?: number | null;
  BatchNo?: string | null;
  ExpectedQuantity?: number | null;
  ActualQuantity?: number | null;
  Chargeable?: number | boolean | null;
  ChargeAmount?: number | null;
  Remarks?: string | null;
};

export type IssuePoster = (payload: CreateInventoryIssuePayload) => Promise<{ ConsumptionId: number; IssueNo?: string | null }>;

export function canPostConsumptionEvent(input: {
  status: InventoryConsumptionEventStatus;
  deductionMode: InventoryConsumptionDeductionMode;
  postedConsumptionId?: number | null;
}): { ok: true } | { ok: false; reason: string; consumptionId?: number } {
  if (input.postedConsumptionId) return { ok: false, reason: 'already_posted', consumptionId: Number(input.postedConsumptionId) };
  if (input.status === 'posted') return { ok: false, reason: 'already_posted' };
  if (input.status === 'blocked_scan_required') return { ok: false, reason: 'scan_required' };
  if (input.status === 'blocked_approval_required') return { ok: false, reason: 'approval_required' };
  if (input.status === 'variance_review') return { ok: false, reason: 'variance_review' };
  if (input.status === 'confirmed') return { ok: true };
  if (input.status === 'expected' && input.deductionMode === 'auto') return { ok: true };
  return { ok: false, reason: 'not_confirmed' };
}

function issueTypeForTrigger(triggerType: InventoryConsumptionTriggerType): InventoryIssueType {
  switch (triggerType) {
    case 'lab_test':
      return 'lab_consumption';
    case 'ot_procedure':
      return 'ot_consumption';
    case 'pharmacy_sale':
      return 'pharmacy_sale';
    case 'emergency_service':
      return 'emergency_issue';
    case 'billing_item':
    case 'procedure':
    case 'nursing_task':
    case 'package':
    case 'manual_reference':
    default:
      return 'patient_issue';
  }
}

function compactParts(parts: Array<string | null | undefined>): string | undefined {
  const value = parts.filter(Boolean).join(' | ');
  return value || undefined;
}

function numericOrUndefined(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

export function buildIssuePayloadFromConsumptionEvent(event: ConsumptionEventRow, items: ConsumptionEventItemRow[]): CreateInventoryIssuePayload {
  const fromStoreId = numericOrUndefined(event.StoreId);
  if (!fromStoreId) throw new Error('Consumption event store is required before posting');
  if (!Array.isArray(items) || items.length === 0) throw new Error('Consumption event has no items to post');

  const issueType = issueTypeForTrigger(event.TriggerType);
  const chargeable = items.some(item => Number(item.Chargeable ?? 0) === 1 || item.Chargeable === true);
  const toDepartment = event.TriggerType === 'ot_procedure'
    ? (event.Department ? String(event.Department) : 'OT')
    : event.TriggerType === 'lab_test'
      ? (event.Department ? String(event.Department) : 'Lab')
      : (event.Department ? String(event.Department) : undefined);

  return {
    IssueType: issueType,
    FromStoreId: fromStoreId,
    ToDepartment: toDepartment,
    PatientId: numericOrUndefined(event.PatientId),
    AdmissionId: numericOrUndefined(event.AdmissionId),
    VisitId: numericOrUndefined(event.VisitId),
    SurgeryId: numericOrUndefined(event.OTCaseId ?? event.ProcedureId),
    LabOrderId: numericOrUndefined(event.LabOrderId),
    BillingReferenceId: numericOrUndefined(event.InvoiceItemId ?? event.BillId),
    Chargeable: chargeable,
    Remarks: compactParts([`Consumption event ${event.EventNo}`, event.Remarks ?? undefined]),
    Items: items.map((item) => {
      const quantity = Number(item.ActualQuantity ?? item.ExpectedQuantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid quantity for event item ${item.EventItemId}`);
      const remarks = compactParts([`Event item ${item.EventItemId}`, item.Remarks ?? undefined]);
      const payloadItem: CreateInventoryIssuePayload['Items'][number] = {
        ItemId: Number(item.ItemId),
        Quantity: quantity,
        Chargeable: Number(item.Chargeable ?? 0) === 1 || item.Chargeable === true,
        ChargeAmount: Number(item.ChargeAmount ?? 0),
        Remarks: remarks,
      };
      const stockId = numericOrUndefined(item.StockId);
      if (stockId) payloadItem.StockId = stockId;
      const batchNo = String(item.BatchNo ?? '').trim();
      if (batchNo) payloadItem.BatchNo = batchNo;
      return payloadItem;
    }),
  };
}

export async function postConsumptionEvent(db: ConsumptionPostingDb, input: {
  tenantId: string;
  eventId: number;
  userId: number;
  postIssue: IssuePoster;
}): Promise<{ eventId: number; posted: boolean; consumptionId: number | null; issueNo: string | null; reason?: string }> {
  const tenantId = String(input.tenantId || '').trim();
  if (!tenantId) throw new Error('tenantId is required');
  const eventId = Number(input.eventId);
  if (!Number.isInteger(eventId) || eventId <= 0) throw new Error('eventId must be a positive integer');
  const userId = Number(input.userId);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('userId must be a positive integer');

  const event = await db.prepare(`
    SELECT *
    FROM InventoryConsumptionEvent
    WHERE tenant_id = ? AND EventId = ?
    LIMIT 1
  `).bind(tenantId, eventId).first<ConsumptionEventRow>();
  if (!event) throw new Error('Consumption event not found');

  const gate = canPostConsumptionEvent({
    status: event.Status,
    deductionMode: event.DeductionMode,
    postedConsumptionId: event.PostedConsumptionId,
  });
  if (!gate.ok) {
    return { eventId, posted: false, consumptionId: gate.consumptionId ?? null, issueNo: null, reason: gate.reason };
  }

  const itemRows = await db.prepare(`
    SELECT *
    FROM InventoryConsumptionEventItem
    WHERE tenant_id = ? AND EventId = ?
      AND COALESCE(Status, 'expected') NOT IN ('cancelled','reversed')
    ORDER BY EventItemId ASC
  `).bind(tenantId, eventId).all<ConsumptionEventItemRow>();

  const payload = buildIssuePayloadFromConsumptionEvent(event, itemRows.results ?? []);
  const issue = await input.postIssue(payload);
  const consumptionId = Number(issue.ConsumptionId ?? 0);
  if (!consumptionId) throw new Error('Issue poster did not return ConsumptionId');

  await db.prepare(`
    UPDATE InventoryConsumptionEvent
    SET Status = 'posted',
        PostedConsumptionId = ?,
        PostedBy = ?,
        PostedAt = CURRENT_TIMESTAMP,
        ModifiedBy = ?,
        ModifiedOn = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND EventId = ?
  `).bind(consumptionId, userId, userId, tenantId, eventId).run();

  return { eventId, posted: true, consumptionId, issueNo: issue.IssueNo ?? null };
}

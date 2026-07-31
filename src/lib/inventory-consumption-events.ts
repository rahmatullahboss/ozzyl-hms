import {
  type InventoryConsumptionDeductionMode,
  type InventoryConsumptionTriggerType,
  isConsumptionDeductionMode,
  isConsumptionTriggerType,
} from './inventory-consumption-rules';

export const INVENTORY_CONSUMPTION_EVENT_STATUSES = [
  'expected',
  'pending_confirmation',
  'confirmed',
  'posted',
  'reversed',
  'cancelled',
  'blocked_missing_rule',
  'blocked_stock_shortage',
  'blocked_scan_required',
  'blocked_approval_required',
  'variance_review',
] as const;

export type InventoryConsumptionEventStatus = typeof INVENTORY_CONSUMPTION_EVENT_STATUSES[number];

export type ConsumptionEventItemInput = {
  ruleItemId?: number | null;
  itemId: number;
  stockId?: number | null;
  batchNo?: string | null;
  expectedQuantity: number;
  actualQuantity?: number | null;
  unit?: string | null;
  chargeable?: boolean;
  chargeAmount?: number;
  requiresScan?: boolean;
  requiresApproval?: boolean;
  highValueFlag?: boolean;
  remarks?: string | null;
};

export type ConsumptionEventInput = {
  tenantId: string;
  eventNo?: string | null;
  ruleId?: number | null;
  triggerType: InventoryConsumptionTriggerType;
  triggerId?: number | null;
  triggerCode?: string | null;
  patientId?: number | null;
  visitId?: number | null;
  admissionId?: number | null;
  billId?: number | null;
  invoiceItemId?: number | null;
  labOrderId?: number | null;
  labOrderItemId?: number | null;
  otCaseId?: number | null;
  procedureId?: number | null;
  department?: string | null;
  storeId?: number | null;
  deductionMode: InventoryConsumptionDeductionMode;
  status?: InventoryConsumptionEventStatus;
  remarks?: string | null;
  userId?: number | null;
  items: ConsumptionEventItemInput[];
};

export type NormalizedConsumptionEventItem = Required<Omit<ConsumptionEventItemInput, 'ruleItemId' | 'stockId' | 'batchNo' | 'actualQuantity' | 'unit' | 'remarks'>> & {
  ruleItemId: number | null;
  stockId: number | null;
  batchNo: string | null;
  actualQuantity: number | null;
  unit: string | null;
  remarks: string | null;
};

export type NormalizedConsumptionEventInput = Omit<Required<ConsumptionEventInput>, 'eventNo' | 'ruleId' | 'triggerId' | 'triggerCode' | 'patientId' | 'visitId' | 'admissionId' | 'billId' | 'invoiceItemId' | 'labOrderId' | 'labOrderItemId' | 'otCaseId' | 'procedureId' | 'department' | 'storeId' | 'remarks' | 'userId' | 'items'> & {
  eventNo: string;
  ruleId: number | null;
  triggerId: number | null;
  triggerCode: string | null;
  patientId: number | null;
  visitId: number | null;
  admissionId: number | null;
  billId: number | null;
  invoiceItemId: number | null;
  labOrderId: number | null;
  labOrderItemId: number | null;
  otCaseId: number | null;
  procedureId: number | null;
  department: string | null;
  storeId: number | null;
  remarks: string | null;
  userId: number | null;
  items: NormalizedConsumptionEventItem[];
};

export type ConsumptionEventDb = {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      run(): Promise<{ success?: boolean; meta?: { last_row_id?: number | string; changes?: number } }>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
};

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function requirePositiveInteger(value: unknown, fieldName: string): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return numeric;
}

function optionalPositiveInteger(value: unknown, fieldName: string): number | null {
  return value == null ? null : requirePositiveInteger(value, fieldName);
}

function requireNonNegativeNumber(value: unknown, fieldName: string): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return numeric;
}

function defaultEventNo(): string {
  return `ICE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function deriveInitialConsumptionEventStatus(mode: InventoryConsumptionDeductionMode): InventoryConsumptionEventStatus {
  switch (mode) {
    case 'auto':
      return 'expected';
    case 'suggest_confirm':
    case 'manual_only':
      return 'pending_confirmation';
    case 'scan_required':
      return 'blocked_scan_required';
    case 'approval_required':
      return 'blocked_approval_required';
    default:
      return 'pending_confirmation';
  }
}

export function normalizeConsumptionEventInput(input: ConsumptionEventInput): NormalizedConsumptionEventInput {
  const tenantId = normalizeOptionalString(input.tenantId);
  if (!tenantId) throw new Error('tenantId is required');
  if (!isConsumptionTriggerType(input.triggerType)) throw new Error(`Invalid trigger type: ${String(input.triggerType)}`);
  if (!isConsumptionDeductionMode(input.deductionMode)) throw new Error(`Invalid deduction mode: ${String(input.deductionMode)}`);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('At least one consumption event item is required');

  const eventNo = normalizeOptionalString(input.eventNo) ?? defaultEventNo();
  const status = input.status ?? deriveInitialConsumptionEventStatus(input.deductionMode);

  const items = input.items.map((item, index): NormalizedConsumptionEventItem => {
    const itemId = requirePositiveInteger(item.itemId, `items[${index}].itemId`);
    const expectedQuantity = Number(item.expectedQuantity);
    if (!Number.isFinite(expectedQuantity) || expectedQuantity <= 0) {
      throw new Error(`items[${index}].expectedQuantity must be a positive quantity`);
    }
    const actualQuantity = item.actualQuantity == null ? null : requireNonNegativeNumber(item.actualQuantity, `items[${index}].actualQuantity`);
    return {
      ruleItemId: optionalPositiveInteger(item.ruleItemId, `items[${index}].ruleItemId`),
      itemId,
      stockId: optionalPositiveInteger(item.stockId, `items[${index}].stockId`),
      batchNo: normalizeOptionalString(item.batchNo),
      expectedQuantity,
      actualQuantity,
      unit: normalizeOptionalString(item.unit),
      chargeable: item.chargeable ?? false,
      chargeAmount: requireNonNegativeNumber(item.chargeAmount, `items[${index}].chargeAmount`),
      requiresScan: item.requiresScan ?? false,
      requiresApproval: item.requiresApproval ?? false,
      highValueFlag: item.highValueFlag ?? false,
      remarks: normalizeOptionalString(item.remarks),
    };
  });

  return {
    tenantId,
    eventNo,
    ruleId: optionalPositiveInteger(input.ruleId, 'ruleId'),
    triggerType: input.triggerType,
    triggerId: optionalPositiveInteger(input.triggerId, 'triggerId'),
    triggerCode: normalizeOptionalString(input.triggerCode),
    patientId: optionalPositiveInteger(input.patientId, 'patientId'),
    visitId: optionalPositiveInteger(input.visitId, 'visitId'),
    admissionId: optionalPositiveInteger(input.admissionId, 'admissionId'),
    billId: optionalPositiveInteger(input.billId, 'billId'),
    invoiceItemId: optionalPositiveInteger(input.invoiceItemId, 'invoiceItemId'),
    labOrderId: optionalPositiveInteger(input.labOrderId, 'labOrderId'),
    labOrderItemId: optionalPositiveInteger(input.labOrderItemId, 'labOrderItemId'),
    otCaseId: optionalPositiveInteger(input.otCaseId, 'otCaseId'),
    procedureId: optionalPositiveInteger(input.procedureId, 'procedureId'),
    department: normalizeOptionalString(input.department),
    storeId: optionalPositiveInteger(input.storeId, 'storeId'),
    deductionMode: input.deductionMode,
    status,
    remarks: normalizeOptionalString(input.remarks),
    userId: optionalPositiveInteger(input.userId, 'userId'),
    items,
  };
}

export function buildConsumptionEventIdempotencyKey(input: {
  tenantId: string;
  triggerType: InventoryConsumptionTriggerType;
  triggerId?: number | null;
  ruleId?: number | null;
  invoiceItemId?: number | null;
  labOrderItemId?: number | null;
  otCaseId?: number | null;
}): string {
  return [
    input.tenantId,
    input.triggerType,
    Number(input.triggerId ?? 0),
    Number(input.ruleId ?? 0),
    Number(input.invoiceItemId ?? 0),
    Number(input.labOrderItemId ?? 0),
    Number(input.otCaseId ?? 0),
  ].join(':');
}

export async function createExpectedConsumptionEvent(db: ConsumptionEventDb, input: ConsumptionEventInput): Promise<{
  eventId: number;
  eventNo: string;
  status: InventoryConsumptionEventStatus;
  created: boolean;
}> {
  const event = normalizeConsumptionEventInput(input);

  const existing = await db.prepare(`
    SELECT EventId, EventNo, Status
    FROM InventoryConsumptionEvent
    WHERE tenant_id = ?
      AND TriggerType = ?
      AND COALESCE(TriggerId, 0) = ?
      AND COALESCE(RuleId, 0) = ?
      AND COALESCE(InvoiceItemId, 0) = ?
      AND COALESCE(LabOrderItemId, 0) = ?
      AND COALESCE(OTCaseId, 0) = ?
    LIMIT 1
  `).bind(
    event.tenantId,
    event.triggerType,
    Number(event.triggerId ?? 0),
    Number(event.ruleId ?? 0),
    Number(event.invoiceItemId ?? 0),
    Number(event.labOrderItemId ?? 0),
    Number(event.otCaseId ?? 0),
  ).first<{ EventId: number; EventNo: string; Status: InventoryConsumptionEventStatus }>();

  if (existing?.EventId) {
    return { eventId: Number(existing.EventId), eventNo: existing.EventNo, status: existing.Status, created: false };
  }

  const header = await db.prepare(`
    INSERT INTO InventoryConsumptionEvent
      (tenant_id, RuleId, EventNo, TriggerType, TriggerId, TriggerCode, PatientId, VisitId, AdmissionId,
       BillId, InvoiceItemId, LabOrderId, LabOrderItemId, OTCaseId, ProcedureId, Department, StoreId,
       DeductionMode, Status, Remarks, CreatedBy, ModifiedBy, ModifiedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    event.tenantId,
    event.ruleId,
    event.eventNo,
    event.triggerType,
    event.triggerId,
    event.triggerCode,
    event.patientId,
    event.visitId,
    event.admissionId,
    event.billId,
    event.invoiceItemId,
    event.labOrderId,
    event.labOrderItemId,
    event.otCaseId,
    event.procedureId,
    event.department,
    event.storeId,
    event.deductionMode,
    event.status,
    event.remarks,
    event.userId,
    event.userId,
  ).run();

  const eventId = Number(header.meta?.last_row_id ?? 0);
  if (!eventId) throw new Error('Failed to create inventory consumption event');

  for (const item of event.items) {
    await db.prepare(`
      INSERT INTO InventoryConsumptionEventItem
        (tenant_id, EventId, RuleItemId, ItemId, StockId, BatchNo, ExpectedQuantity, ActualQuantity, Unit,
         Chargeable, ChargeAmount, Status, RequiresScan, RequiresApproval, HighValueFlag, Remarks, CreatedBy, ModifiedBy, ModifiedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      event.tenantId,
      eventId,
      item.ruleItemId,
      item.itemId,
      item.stockId,
      item.batchNo,
      item.expectedQuantity,
      item.actualQuantity,
      item.unit,
      item.chargeable ? 1 : 0,
      item.chargeAmount,
      'expected',
      item.requiresScan ? 1 : 0,
      item.requiresApproval ? 1 : 0,
      item.highValueFlag ? 1 : 0,
      item.remarks,
      event.userId,
      event.userId,
    ).run();
  }

  return { eventId, eventNo: event.eventNo, status: event.status, created: true };
}

export type ConfirmConsumptionEventItemInput = {
  eventItemId: number;
  expectedQuantity: number;
  actualQuantity: number;
  toleranceQty?: number;
  tolerancePercent?: number;
  varianceReason?: string | null;
};

export type ConfirmConsumptionEventInput = {
  tenantId: string;
  eventId: number;
  userId: number;
  items: ConfirmConsumptionEventItemInput[];
};

export function calculateConsumptionVariance(expectedQuantity: number, actualQuantity: number): number {
  return Number(actualQuantity) - Number(expectedQuantity);
}

export function shouldFlagConsumptionVariance(input: {
  expectedQuantity: number;
  actualQuantity: number;
  toleranceQty?: number;
  tolerancePercent?: number;
}): boolean {
  const expected = Number(input.expectedQuantity);
  const actual = Number(input.actualQuantity);
  if (!Number.isFinite(expected) || expected < 0) throw new Error('expectedQuantity must be a non-negative number');
  if (!Number.isFinite(actual) || actual < 0) throw new Error('actualQuantity must be a non-negative number');
  const variance = Math.abs(calculateConsumptionVariance(expected, actual));
  const hasQtyTolerance = input.toleranceQty != null;
  const hasPercentTolerance = input.tolerancePercent != null;
  const toleranceQty = Number(input.toleranceQty ?? 0);
  const tolerancePercent = Number(input.tolerancePercent ?? 0);
  const percentVariance = expected > 0 ? (variance / expected) * 100 : variance > 0 ? 100 : 0;
  if (hasQtyTolerance && variance > toleranceQty) return true;
  if (hasPercentTolerance && percentVariance > tolerancePercent) return true;
  return !hasQtyTolerance && !hasPercentTolerance && variance > 0;
}

export async function confirmConsumptionEvent(db: ConsumptionEventDb, input: ConfirmConsumptionEventInput): Promise<{
  eventId: number;
  status: Extract<InventoryConsumptionEventStatus, 'confirmed' | 'variance_review'>;
  varianceReview: boolean;
}> {
  const tenantId = normalizeOptionalString(input.tenantId);
  if (!tenantId) throw new Error('tenantId is required');
  const eventId = requirePositiveInteger(input.eventId, 'eventId');
  const userId = requirePositiveInteger(input.userId, 'userId');
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('At least one confirmation item is required');

  let varianceReview = false;
  const normalizedItems = input.items.map((item, index) => {
    const eventItemId = requirePositiveInteger(item.eventItemId, `items[${index}].eventItemId`);
    const expectedQuantity = requireNonNegativeNumber(item.expectedQuantity, `items[${index}].expectedQuantity`);
    const actualQuantity = requireNonNegativeNumber(item.actualQuantity, `items[${index}].actualQuantity`);
    const varianceQty = calculateConsumptionVariance(expectedQuantity, actualQuantity);
    const outsideTolerance = shouldFlagConsumptionVariance({
      expectedQuantity,
      actualQuantity,
      toleranceQty: item.toleranceQty,
      tolerancePercent: item.tolerancePercent,
    });
    const varianceReason = normalizeOptionalString(item.varianceReason);
    if (outsideTolerance && !varianceReason) {
      throw new Error(`Variance reason is required for event item ${eventItemId}`);
    }
    if (outsideTolerance) varianceReview = true;
    return {
      eventItemId,
      actualQuantity,
      varianceQty,
      varianceReason,
      status: outsideTolerance ? 'variance_review' : 'confirmed' as Extract<InventoryConsumptionEventStatus, 'confirmed' | 'variance_review'>,
    };
  });

  for (const item of normalizedItems) {
    await db.prepare(`
      UPDATE InventoryConsumptionEventItem
      SET ActualQuantity = ?,
          VarianceQty = ?,
          VarianceReason = ?,
          Status = ?,
          ConfirmedBy = ?,
          ConfirmedAt = CURRENT_TIMESTAMP,
          ModifiedBy = ?,
          ModifiedOn = CURRENT_TIMESTAMP
      WHERE tenant_id = ? AND EventItemId = ?
    `).bind(
      item.actualQuantity,
      item.varianceQty,
      item.varianceReason,
      item.status,
      userId,
      userId,
      tenantId,
      item.eventItemId,
    ).run();
  }

  const status = varianceReview ? 'variance_review' : 'confirmed';
  await db.prepare(`
    UPDATE InventoryConsumptionEvent
    SET Status = ?,
        ConfirmedBy = ?,
        ConfirmedAt = CURRENT_TIMESTAMP,
        ModifiedBy = ?,
        ModifiedOn = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND EventId = ?
  `).bind(status, userId, userId, tenantId, eventId).run();

  return { eventId, status, varianceReview };
}



export type ReviewConsumptionVarianceInput = {
  tenantId: string;
  eventId: number;
  reviewedBy: number;
  note?: string | null;
};

export async function reviewConsumptionVariance(db: ConsumptionEventDb, input: ReviewConsumptionVarianceInput): Promise<{
  eventId: number;
  status: Extract<InventoryConsumptionEventStatus, 'confirmed'>;
}> {
  const tenantId = normalizeOptionalString(input.tenantId);
  if (!tenantId) throw new Error('tenantId is required');
  const eventId = requirePositiveInteger(input.eventId, 'eventId');
  const reviewedBy = requirePositiveInteger(input.reviewedBy, 'reviewedBy');
  const note = normalizeOptionalString(input.note);

  await db.prepare(`
    UPDATE InventoryConsumptionEventItem
    SET Status = 'confirmed',
        VarianceReason = COALESCE(VarianceReason, ?),
        ModifiedBy = ?,
        ModifiedOn = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND EventId = ?
  `).bind(note, reviewedBy, tenantId, eventId).run();

  await db.prepare(`
    UPDATE InventoryConsumptionEvent
    SET Status = 'confirmed',
        ConfirmedBy = ?,
        Remarks = COALESCE(Remarks, ?),
        ModifiedBy = ?,
        ModifiedOn = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND EventId = ?
  `).bind(reviewedBy, note, reviewedBy, tenantId, eventId).run();

  return { eventId, status: 'confirmed' };
}

export type ConsumptionEventListFilters = {
  status?: InventoryConsumptionEventStatus;
  department?: string;
  triggerType?: InventoryConsumptionTriggerType;
  patientId?: number;
  limit?: number;
};

export async function listConsumptionEvents<T = unknown>(
  db: ConsumptionEventDb,
  tenantId: string,
  filters: ConsumptionEventListFilters = {},
): Promise<T[]> {
  const where = ['tenant_id = ?'];
  const params: unknown[] = [String(tenantId).trim()];

  if (filters.status) {
    where.push('Status = ?');
    params.push(filters.status);
  }
  if (filters.department) {
    where.push('Department = ?');
    params.push(filters.department);
  }
  if (filters.triggerType) {
    if (!isConsumptionTriggerType(filters.triggerType)) throw new Error(`Invalid trigger type: ${String(filters.triggerType)}`);
    where.push('TriggerType = ?');
    params.push(filters.triggerType);
  }
  if (filters.patientId) {
    where.push('PatientId = ?');
    params.push(Number(filters.patientId));
  }
  const limit = Math.min(Math.max(Number(filters.limit ?? 100), 1), 500);
  params.push(limit);

  const rows = await db.prepare(`
    SELECT *
    FROM InventoryConsumptionEvent
    WHERE ${where.join(' AND ')}
    ORDER BY ExpectedAt DESC, EventId DESC
    LIMIT ?
  `).bind(...params).all<T>();

  return rows.results ?? [];
}

export async function getConsumptionEventDetail<TEvent = unknown, TItem = unknown>(
  db: ConsumptionEventDb,
  tenantId: string,
  eventId: number,
): Promise<{ event: TEvent; items: TItem[] }> {
  const tenant = normalizeOptionalString(tenantId);
  if (!tenant) throw new Error('tenantId is required');
  const id = requirePositiveInteger(eventId, 'eventId');

  const event = await db.prepare(`
    SELECT *
    FROM InventoryConsumptionEvent
    WHERE tenant_id = ? AND EventId = ?
    LIMIT 1
  `).bind(tenant, id).first<TEvent>();
  if (!event) throw new Error('Consumption event not found');

  const rows = await db.prepare(`
    SELECT cei.*, ii.ItemName, ii.ItemCode
    FROM InventoryConsumptionEventItem cei
    LEFT JOIN InventoryItem ii ON ii.tenant_id = cei.tenant_id AND ii.ItemId = cei.ItemId
    WHERE cei.tenant_id = ? AND cei.EventId = ?
    ORDER BY cei.EventItemId ASC
  `).bind(tenant, id).all<TItem>();

  return { event, items: rows.results ?? [] };
}

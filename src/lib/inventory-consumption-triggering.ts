import {
  findConsumptionRulesForTrigger,
  isConsumptionDeductionMode,
  type ConsumptionRuleDb,
  type InventoryConsumptionDeductionMode,
  type InventoryConsumptionTriggerType,
} from './inventory-consumption-rules';
import {
  createExpectedConsumptionEvent,
  type ConsumptionEventInput,
  type InventoryConsumptionEventStatus,
} from './inventory-consumption-events';

export type ConsumptionTriggerInput = {
  tenantId: string;
  userId?: number | null;
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
  remarks?: string | null;
};

export type ConsumptionTriggerRuleRow = {
  RuleId: number;
  RuleCode?: string | null;
  RuleName?: string | null;
  TriggerType: InventoryConsumptionTriggerType;
  TriggerId?: number | null;
  TriggerCode?: string | null;
  Department?: string | null;
  DefaultStoreId?: number | null;
  DeductionMode?: InventoryConsumptionDeductionMode | null;
  deductionMode?: InventoryConsumptionDeductionMode | null;
};

export type ConsumptionTriggerRuleItemRow = {
  RuleItemId: number;
  ItemId: number;
  DefaultStockId?: number | null;
  Quantity: number;
  Unit?: string | null;
  RequiresScan?: number | boolean | null;
  RequiresApproval?: number | boolean | null;
  HighValueFlag?: number | boolean | null;
};

export type TriggeredConsumptionResult = {
  eventId: number;
  created: boolean;
  eventNo: string;
  status: InventoryConsumptionEventStatus;
};

function boolish(value: unknown): boolean {
  return value === true || Number(value ?? 0) === 1;
}

function optionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function resolveRuleDeductionMode(rule: ConsumptionTriggerRuleRow): InventoryConsumptionDeductionMode {
  const deductionMode = rule.DeductionMode ?? rule.deductionMode ?? 'suggest_confirm';
  if (!isConsumptionDeductionMode(deductionMode)) {
    throw new Error(`Invalid consumption rule deduction mode for rule ${Number(rule.RuleId)}: ${String(deductionMode)}`);
  }
  return deductionMode;
}

export function buildConsumptionEventInputFromRule(input: {
  tenantId: string;
  userId?: number | null;
  trigger: Omit<ConsumptionTriggerInput, 'tenantId' | 'userId'>;
  rule: ConsumptionTriggerRuleRow;
  ruleItems: ConsumptionTriggerRuleItemRow[];
}): ConsumptionEventInput {
  const ruleCode = String(input.rule.RuleCode || input.rule.RuleName || input.rule.RuleId);
  return {
    tenantId: input.tenantId,
    userId: optionalNumber(input.userId),
    ruleId: Number(input.rule.RuleId),
    triggerType: input.trigger.triggerType,
    triggerId: optionalNumber(input.trigger.triggerId ?? input.rule.TriggerId),
    triggerCode: input.trigger.triggerCode ?? input.rule.TriggerCode ?? undefined,
    patientId: optionalNumber(input.trigger.patientId),
    visitId: optionalNumber(input.trigger.visitId),
    admissionId: optionalNumber(input.trigger.admissionId),
    billId: optionalNumber(input.trigger.billId),
    invoiceItemId: optionalNumber(input.trigger.invoiceItemId),
    labOrderId: optionalNumber(input.trigger.labOrderId),
    labOrderItemId: optionalNumber(input.trigger.labOrderItemId),
    otCaseId: optionalNumber(input.trigger.otCaseId),
    procedureId: optionalNumber(input.trigger.procedureId),
    department: input.trigger.department ?? input.rule.Department ?? null,
    storeId: optionalNumber(input.trigger.storeId ?? input.rule.DefaultStoreId),
    deductionMode: resolveRuleDeductionMode(input.rule),
    remarks: input.trigger.remarks ?? `Triggered from rule ${ruleCode}`,
    items: input.ruleItems.map((item) => ({
      ruleItemId: Number(item.RuleItemId),
      itemId: Number(item.ItemId),
      stockId: optionalNumber(item.DefaultStockId),
      expectedQuantity: Number(item.Quantity),
      unit: item.Unit ?? null,
      requiresScan: boolish(item.RequiresScan),
      requiresApproval: boolish(item.RequiresApproval),
      highValueFlag: boolish(item.HighValueFlag),
      chargeable: false,
      chargeAmount: 0,
      remarks: `Rule ${ruleCode}`,
    })),
  };
}

export function summarizeTriggeredConsumptionEvents(results: TriggeredConsumptionResult[]): { matchedRules: number; created: number; existing: number } {
  const created = results.filter((item) => item.created).length;
  return { matchedRules: results.length, created, existing: results.length - created };
}

async function listRuleItems(db: ConsumptionRuleDb, tenantId: string, ruleId: number): Promise<ConsumptionTriggerRuleItemRow[]> {
  const rows = await db.prepare(`
    SELECT RuleItemId, ItemId, DefaultStockId, Quantity, Unit, RequiresScan, RequiresApproval, HighValueFlag
    FROM InventoryConsumptionRuleItem
    WHERE tenant_id = ? AND RuleId = ?
    ORDER BY SortOrder ASC, RuleItemId ASC
  `).bind(tenantId, ruleId).all<ConsumptionTriggerRuleItemRow>();
  return rows.results ?? [];
}

export async function triggerInventoryConsumptionFromWorkflow(db: ConsumptionRuleDb, input: ConsumptionTriggerInput): Promise<{ summary: { matchedRules: number; created: number; existing: number }; events: TriggeredConsumptionResult[] }> {
  const tenantId = String(input.tenantId || '').trim();
  if (!tenantId) throw new Error('tenantId is required');
  const rules = await findConsumptionRulesForTrigger<ConsumptionTriggerRuleRow>(db, {
    tenantId,
    triggerType: input.triggerType,
    triggerId: input.triggerId ?? null,
    triggerCode: input.triggerCode ?? null,
  });

  const events: TriggeredConsumptionResult[] = [];
  for (const rule of rules) {
    const ruleItems = await listRuleItems(db, tenantId, Number(rule.RuleId));
    if (ruleItems.length === 0) continue;
    const eventInput = buildConsumptionEventInputFromRule({
      tenantId,
      userId: input.userId ?? null,
      trigger: input,
      rule,
      ruleItems,
    });
    events.push(await createExpectedConsumptionEvent(db, eventInput));
  }

  return { summary: summarizeTriggeredConsumptionEvents(events), events };
}

export const INVENTORY_CONSUMPTION_TRIGGER_TYPES = [
  'billing_item',
  'lab_test',
  'ot_procedure',
  'procedure',
  'nursing_task',
  'emergency_service',
  'pharmacy_sale',
  'package',
  'manual_reference',
] as const;

export const INVENTORY_CONSUMPTION_DEDUCTION_MODES = [
  'auto',
  'suggest_confirm',
  'scan_required',
  'approval_required',
  'manual_only',
] as const;

export const INVENTORY_CONSUMPTION_CHARGE_POLICIES = [
  'none',
  'patient',
  'department',
  'included_in_package',
] as const;

export type InventoryConsumptionTriggerType = typeof INVENTORY_CONSUMPTION_TRIGGER_TYPES[number];
export type InventoryConsumptionDeductionMode = typeof INVENTORY_CONSUMPTION_DEDUCTION_MODES[number];
export type InventoryConsumptionChargePolicy = typeof INVENTORY_CONSUMPTION_CHARGE_POLICIES[number];

export type ConsumptionRuleItemInput = {
  itemId: number;
  defaultStockId?: number | null;
  quantity: number;
  unit?: string | null;
  isMandatory?: boolean;
  requiresScan?: boolean;
  requiresApproval?: boolean;
  highValueFlag?: boolean;
  allowSubstitution?: boolean;
  varianceToleranceQty?: number;
  varianceTolerancePercent?: number;
  sortOrder?: number;
  notes?: string | null;
};

export type ConsumptionRuleInput = {
  tenantId: string;
  ruleName: string;
  ruleCode?: string | null;
  triggerType: InventoryConsumptionTriggerType;
  triggerId?: number | null;
  triggerCode?: string | null;
  department?: string | null;
  defaultStoreId?: number | null;
  deductionMode?: InventoryConsumptionDeductionMode;
  chargePolicy?: InventoryConsumptionChargePolicy;
  isActive?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  items: ConsumptionRuleItemInput[];
};

export type NormalizedConsumptionRuleItem = Required<Omit<ConsumptionRuleItemInput, 'defaultStockId' | 'unit' | 'notes'>> & {
  defaultStockId: number | null;
  unit: string | null;
  notes: string | null;
};

export type NormalizedConsumptionRuleInput = Omit<Required<ConsumptionRuleInput>, 'triggerId' | 'triggerCode' | 'department' | 'defaultStoreId' | 'effectiveFrom' | 'effectiveTo' | 'items'> & {
  triggerId: number | null;
  triggerCode: string | null;
  department: string | null;
  defaultStoreId: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  items: NormalizedConsumptionRuleItem[];
};

export function isConsumptionTriggerType(value: unknown): value is InventoryConsumptionTriggerType {
  return typeof value === 'string' && (INVENTORY_CONSUMPTION_TRIGGER_TYPES as readonly string[]).includes(value);
}

export function isConsumptionDeductionMode(value: unknown): value is InventoryConsumptionDeductionMode {
  return typeof value === 'string' && (INVENTORY_CONSUMPTION_DEDUCTION_MODES as readonly string[]).includes(value);
}

export function isConsumptionChargePolicy(value: unknown): value is InventoryConsumptionChargePolicy {
  return typeof value === 'string' && (INVENTORY_CONSUMPTION_CHARGE_POLICIES as readonly string[]).includes(value);
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function requirePositiveInteger(value: unknown, fieldName: string): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return numeric;
}

function requireNonNegativeNumber(value: unknown, fieldName: string): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return numeric;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

export function normalizeConsumptionRuleInput(input: ConsumptionRuleInput): NormalizedConsumptionRuleInput {
  const tenantId = normalizeOptionalString(input.tenantId);
  if (!tenantId) throw new Error('tenantId is required');

  const ruleName = normalizeOptionalString(input.ruleName);
  if (!ruleName) throw new Error('ruleName is required');

  if (!isConsumptionTriggerType(input.triggerType)) {
    throw new Error(`Invalid trigger type: ${String(input.triggerType)}`);
  }

  const deductionMode = input.deductionMode ?? 'suggest_confirm';
  if (!isConsumptionDeductionMode(deductionMode)) {
    throw new Error(`Invalid deduction mode: ${String(deductionMode)}`);
  }

  const chargePolicy = input.chargePolicy ?? 'none';
  if (!isConsumptionChargePolicy(chargePolicy)) {
    throw new Error(`Invalid charge policy: ${String(chargePolicy)}`);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('At least one rule item is required');
  }

  const items = input.items.map((item, index): NormalizedConsumptionRuleItem => {
    const itemId = requirePositiveInteger(item.itemId, `items[${index}].itemId`);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`items[${index}].quantity must be a positive quantity`);
    }

    return {
      itemId,
      defaultStockId: item.defaultStockId == null ? null : requirePositiveInteger(item.defaultStockId, `items[${index}].defaultStockId`),
      quantity,
      unit: normalizeOptionalString(item.unit),
      isMandatory: item.isMandatory ?? true,
      requiresScan: item.requiresScan ?? false,
      requiresApproval: item.requiresApproval ?? false,
      highValueFlag: item.highValueFlag ?? false,
      allowSubstitution: item.allowSubstitution ?? false,
      varianceToleranceQty: requireNonNegativeNumber(item.varianceToleranceQty, `items[${index}].varianceToleranceQty`),
      varianceTolerancePercent: requireNonNegativeNumber(item.varianceTolerancePercent, `items[${index}].varianceTolerancePercent`),
      sortOrder: Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
      notes: normalizeOptionalString(item.notes),
    };
  });

  const ruleCode = normalizeOptionalString(input.ruleCode) ?? normalizeCode(ruleName);

  return {
    tenantId,
    ruleName,
    ruleCode,
    triggerType: input.triggerType,
    triggerId: input.triggerId == null ? null : requirePositiveInteger(input.triggerId, 'triggerId'),
    triggerCode: normalizeOptionalString(input.triggerCode),
    department: normalizeOptionalString(input.department),
    defaultStoreId: input.defaultStoreId == null ? null : requirePositiveInteger(input.defaultStoreId, 'defaultStoreId'),
    deductionMode,
    chargePolicy,
    isActive: input.isActive ?? true,
    effectiveFrom: normalizeOptionalString(input.effectiveFrom),
    effectiveTo: normalizeOptionalString(input.effectiveTo),
    items,
  };
}

export function buildRuleIdempotencyKey(input: {
  tenantId: string;
  triggerType: InventoryConsumptionTriggerType;
  triggerId?: number | null;
  ruleCode?: string | null;
}): string {
  return [input.tenantId, input.triggerType, Number(input.triggerId ?? 0), normalizeOptionalString(input.ruleCode) ?? ''].join(':');
}

export function shouldAutoPostConsumptionRule(
  rule: {
    deductionMode: InventoryConsumptionDeductionMode;
    hasScanRequiredItems: boolean;
    hasApprovalRequiredItems: boolean;
  },
  policy: { autoDeductLowRiskItems: boolean },
): boolean {
  return Boolean(
    policy.autoDeductLowRiskItems &&
    rule.deductionMode === 'auto' &&
    !rule.hasScanRequiredItems &&
    !rule.hasApprovalRequiredItems,
  );
}

export type ConsumptionRuleDb = {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      run(): Promise<{ success?: boolean; meta?: { last_row_id?: number | string; changes?: number } }>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
};

export type CreateConsumptionRuleInput = {
  tenantId: string;
  userId?: number | null;
  rule: ConsumptionRuleInput;
};

export type ConsumptionRuleListFilters = {
  triggerType?: InventoryConsumptionTriggerType;
  isActive?: boolean;
  department?: string;
};

export async function createConsumptionRule(db: ConsumptionRuleDb, input: CreateConsumptionRuleInput): Promise<{ ruleId: number; rule: NormalizedConsumptionRuleInput }> {
  if (input.tenantId !== input.rule.tenantId) {
    throw new Error('tenantId mismatch between request and rule payload');
  }
  const rule = normalizeConsumptionRuleInput(input.rule);
  const userId = input.userId ?? null;

  const result = await db.prepare(`
    INSERT INTO InventoryConsumptionRule
      (tenant_id, RuleName, RuleCode, TriggerType, TriggerId, TriggerCode, Department, DefaultStoreId,
       DeductionMode, ChargePolicy, IsActive, EffectiveFrom, EffectiveTo, CreatedBy, ModifiedBy, ModifiedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    rule.tenantId,
    rule.ruleName,
    rule.ruleCode,
    rule.triggerType,
    rule.triggerId,
    rule.triggerCode,
    rule.department,
    rule.defaultStoreId,
    rule.deductionMode,
    rule.chargePolicy,
    rule.isActive ? 1 : 0,
    rule.effectiveFrom,
    rule.effectiveTo,
    userId,
    userId,
  ).run();

  const ruleId = Number(result.meta?.last_row_id ?? 0);
  if (!ruleId) throw new Error('Failed to create inventory consumption rule');

  for (const item of rule.items) {
    await db.prepare(`
      INSERT INTO InventoryConsumptionRuleItem
        (tenant_id, RuleId, ItemId, DefaultStockId, Quantity, Unit, IsMandatory, RequiresScan,
         RequiresApproval, HighValueFlag, AllowSubstitution, VarianceToleranceQty, VarianceTolerancePercent,
         SortOrder, Notes, CreatedBy, ModifiedBy, ModifiedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      rule.tenantId,
      ruleId,
      item.itemId,
      item.defaultStockId,
      item.quantity,
      item.unit,
      item.isMandatory ? 1 : 0,
      item.requiresScan ? 1 : 0,
      item.requiresApproval ? 1 : 0,
      item.highValueFlag ? 1 : 0,
      item.allowSubstitution ? 1 : 0,
      item.varianceToleranceQty,
      item.varianceTolerancePercent,
      item.sortOrder,
      item.notes,
      userId,
      userId,
    ).run();
  }

  return { ruleId, rule };
}

export async function listConsumptionRules<T = unknown>(
  db: ConsumptionRuleDb,
  tenantId: string,
  filters: ConsumptionRuleListFilters = {},
): Promise<T[]> {
  const where = ['tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (filters.triggerType) {
    if (!isConsumptionTriggerType(filters.triggerType)) throw new Error(`Invalid trigger type: ${filters.triggerType}`);
    where.push('TriggerType = ?');
    params.push(filters.triggerType);
  }
  if (typeof filters.isActive === 'boolean') {
    where.push('IsActive = ?');
    params.push(filters.isActive ? 1 : 0);
  }
  if (filters.department) {
    where.push('Department = ?');
    params.push(filters.department);
  }

  const rows = await db.prepare(`
    SELECT *
    FROM InventoryConsumptionRule
    WHERE ${where.join(' AND ')}
    ORDER BY IsActive DESC, Department ASC, RuleName ASC, RuleId DESC
  `).bind(...params).all<T>();

  return rows.results ?? [];
}

export async function findConsumptionRulesForTrigger<T = unknown>(db: ConsumptionRuleDb, input: {
  tenantId: string;
  triggerType: InventoryConsumptionTriggerType;
  triggerId?: number | null;
  triggerCode?: string | null;
}): Promise<T[]> {
  if (!isConsumptionTriggerType(input.triggerType)) {
    throw new Error(`Invalid trigger type: ${String(input.triggerType)}`);
  }

  const triggerId = input.triggerId == null ? null : requirePositiveInteger(input.triggerId, 'triggerId');
  const triggerCode = normalizeOptionalString(input.triggerCode);
  const where = ['tenant_id = ?', 'IsActive = 1', 'TriggerType = ?'];
  const params: unknown[] = [input.tenantId, input.triggerType];
  const matchers: string[] = [];

  if (triggerId != null) {
    matchers.push('TriggerId = ?');
    params.push(triggerId);
  }
  if (triggerCode) {
    matchers.push('TriggerCode = ?');
    params.push(triggerCode);
  }
  matchers.push('(TriggerId IS NULL AND TriggerCode IS NULL)');
  where.push(`(${matchers.join(' OR ')})`);

  const rows = await db.prepare(`
    SELECT *
    FROM InventoryConsumptionRule
    WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN TriggerId IS NOT NULL THEN 0 WHEN TriggerCode IS NOT NULL THEN 1 ELSE 2 END,
             RuleName ASC
  `).bind(...params).all<T>();

  return rows.results ?? [];
}

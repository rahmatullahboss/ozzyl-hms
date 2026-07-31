import type {
  ConsumptionRuleDb,
  InventoryConsumptionDeductionMode,
  InventoryConsumptionTriggerType,
} from './inventory-consumption-rules';
import { createConsumptionRule } from './inventory-consumption-rules';

export type InventoryConsumptionDefaultItemTemplate = {
  keywords: string[];
  quantity: number;
  unit?: string;
  requiresScan?: boolean;
  requiresApproval?: boolean;
  highValueFlag?: boolean;
  varianceToleranceQty?: number;
  varianceTolerancePercent?: number;
};

export type InventoryConsumptionDefaultRuleTemplate = {
  ruleCode: string;
  ruleName: string;
  triggerType: InventoryConsumptionTriggerType;
  triggerCode?: string;
  department: string;
  deductionMode: InventoryConsumptionDeductionMode;
  items: InventoryConsumptionDefaultItemTemplate[];
};

export const DEFAULT_INVENTORY_CONSUMPTION_RULE_TEMPLATES: InventoryConsumptionDefaultRuleTemplate[] = [
  {
    ruleCode: 'DRESSING_SMALL',
    ruleName: 'Dressing Small Starter Kit',
    triggerType: 'procedure',
    triggerCode: 'DRESSING_SMALL',
    department: 'Procedure',
    deductionMode: 'suggest_confirm',
    items: [
      { keywords: ['gauze', 'গজ'], quantity: 2, unit: 'pcs', varianceToleranceQty: 1 },
      { keywords: ['bandage', 'ব্যান্ডেজ'], quantity: 1, unit: 'roll' },
      { keywords: ['glove', 'gloves'], quantity: 1, unit: 'pair' },
    ],
  },
  {
    ruleCode: 'NEBULIZATION',
    ruleName: 'Nebulization Starter Kit',
    triggerType: 'billing_item',
    triggerCode: 'NEBULIZATION',
    department: 'Procedure',
    deductionMode: 'suggest_confirm',
    items: [
      { keywords: ['nebulizer mask', 'neb mask', 'mask'], quantity: 1, unit: 'pcs' },
      { keywords: ['syringe'], quantity: 1, unit: 'pcs' },
    ],
  },
  {
    ruleCode: 'IV_CANNULATION',
    ruleName: 'IV Cannulation Starter Kit',
    triggerType: 'procedure',
    triggerCode: 'IV_CANNULATION',
    department: 'Ward',
    deductionMode: 'suggest_confirm',
    items: [
      { keywords: ['cannula', 'canula'], quantity: 1, unit: 'pcs', requiresScan: true },
      { keywords: ['syringe'], quantity: 1, unit: 'pcs' },
      { keywords: ['glove', 'gloves'], quantity: 1, unit: 'pair' },
      { keywords: ['tape', 'adhesive'], quantity: 1, unit: 'pcs' },
    ],
  },
  {
    ruleCode: 'CATHETERIZATION',
    ruleName: 'Catheterization Starter Kit',
    triggerType: 'procedure',
    triggerCode: 'CATHETERIZATION',
    department: 'Ward',
    deductionMode: 'suggest_confirm',
    items: [
      { keywords: ['catheter'], quantity: 1, unit: 'pcs', requiresScan: true },
      { keywords: ['urine bag', 'urine'], quantity: 1, unit: 'pcs' },
      { keywords: ['glove', 'gloves'], quantity: 1, unit: 'pair' },
    ],
  },
  {
    ruleCode: 'NORMAL_DELIVERY_PACK',
    ruleName: 'Normal Delivery Starter Pack',
    triggerType: 'procedure',
    triggerCode: 'NORMAL_DELIVERY',
    department: 'Maternity',
    deductionMode: 'suggest_confirm',
    items: [
      { keywords: ['glove', 'gloves'], quantity: 4, unit: 'pair' },
      { keywords: ['suture'], quantity: 1, unit: 'pcs', requiresScan: true },
      { keywords: ['gauze'], quantity: 10, unit: 'pcs', varianceToleranceQty: 5 },
      { keywords: ['blade'], quantity: 1, unit: 'pcs', requiresScan: true },
    ],
  },
  {
    ruleCode: 'C_SECTION_STANDARD_PACK',
    ruleName: 'C-Section Standard Starter Pack',
    triggerType: 'ot_procedure',
    triggerCode: 'C_SECTION',
    department: 'OT',
    deductionMode: 'suggest_confirm',
    items: [
      { keywords: ['glove', 'gloves'], quantity: 6, unit: 'pair' },
      { keywords: ['gown'], quantity: 2, unit: 'pcs' },
      { keywords: ['drape'], quantity: 1, unit: 'pcs' },
      { keywords: ['suture'], quantity: 3, unit: 'pcs', requiresScan: true, varianceToleranceQty: 1 },
      { keywords: ['blade'], quantity: 1, unit: 'pcs', requiresScan: true },
      { keywords: ['catheter'], quantity: 1, unit: 'pcs', requiresScan: true },
      { keywords: ['gauze'], quantity: 20, unit: 'pcs', varianceToleranceQty: 10 },
    ],
  },
  {
    ruleCode: 'APPENDECTOMY_STANDARD_PACK',
    ruleName: 'Appendectomy Standard Starter Pack',
    triggerType: 'ot_procedure',
    triggerCode: 'APPENDECTOMY',
    department: 'OT',
    deductionMode: 'suggest_confirm',
    items: [
      { keywords: ['glove', 'gloves'], quantity: 4, unit: 'pair' },
      { keywords: ['blade'], quantity: 1, unit: 'pcs', requiresScan: true },
      { keywords: ['suture'], quantity: 2, unit: 'pcs', requiresScan: true, varianceToleranceQty: 1 },
      { keywords: ['gauze'], quantity: 10, unit: 'pcs', varianceToleranceQty: 5 },
      { keywords: ['drape'], quantity: 1, unit: 'pcs' },
    ],
  },
  {
    ruleCode: 'EMERGENCY_RESUSCITATION_PACK',
    ruleName: 'Emergency Resuscitation Starter Pack',
    triggerType: 'emergency_service',
    triggerCode: 'RESUSCITATION',
    department: 'Emergency',
    deductionMode: 'suggest_confirm',
    items: [
      { keywords: ['oxygen mask', 'mask'], quantity: 1, unit: 'pcs' },
      { keywords: ['syringe'], quantity: 3, unit: 'pcs' },
      { keywords: ['cannula'], quantity: 1, unit: 'pcs', requiresScan: true },
      { keywords: ['glove', 'gloves'], quantity: 2, unit: 'pair' },
    ],
  },
];

export function normalizeInventoryConsumptionTemplateCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function buildInventoryConsumptionSeedToast(summary?: { rules?: number; created?: number; skipped?: number }): string {
  if (!summary) return 'Starter consumption rules checked.';
  return `Starter consumption rules checked: ${Number(summary.rules ?? 0)} rules, ${Number(summary.created ?? 0)} created, ${Number(summary.skipped ?? 0)} skipped.`;
}

function likePattern(keyword: string): string {
  return `%${keyword.replace(/[%_]/g, '').trim()}%`;
}

async function findItemByKeywords(db: ConsumptionRuleDb, tenantId: string, keywords: string[]): Promise<{ ItemId: number; ItemName?: string } | null> {
  for (const keyword of keywords) {
    const row = await db.prepare(`
      SELECT ItemId, ItemName
      FROM InventoryItem
      WHERE tenant_id = ?
        AND COALESCE(IsActive, 1) = 1
        AND (LOWER(ItemName) LIKE LOWER(?) OR LOWER(COALESCE(ItemCode, '')) LIKE LOWER(?))
      ORDER BY ItemId ASC
      LIMIT 1
    `).bind(tenantId, likePattern(keyword), likePattern(keyword)).first<{ ItemId: number; ItemName?: string }>();
    if (row?.ItemId) return row;
  }
  return null;
}

async function ruleExists(db: ConsumptionRuleDb, tenantId: string, ruleCode: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT RuleId
    FROM InventoryConsumptionRule
    WHERE tenant_id = ? AND RuleCode = ? AND IsActive = 1
    LIMIT 1
  `).bind(tenantId, ruleCode).first<{ RuleId: number }>();
  return Boolean(row?.RuleId);
}

export async function seedInventoryConsumptionDefaults(db: ConsumptionRuleDb, tenantId: string | number, userId?: number | null): Promise<{ rules: number; created: number; skipped: number; details: Array<{ ruleCode: string; status: string; reason?: string }> }> {
  const tenant = String(tenantId);
  let created = 0;
  let skipped = 0;
  const details: Array<{ ruleCode: string; status: string; reason?: string }> = [];

  for (const template of DEFAULT_INVENTORY_CONSUMPTION_RULE_TEMPLATES) {
    const ruleCode = normalizeInventoryConsumptionTemplateCode(template.ruleCode);
    if (await ruleExists(db, tenant, ruleCode)) {
      skipped += 1;
      details.push({ ruleCode, status: 'skipped', reason: 'already_exists' });
      continue;
    }

    const items = [];
    for (const itemTemplate of template.items) {
      const item = await findItemByKeywords(db, tenant, itemTemplate.keywords);
      if (!item) continue;
      items.push({
        itemId: Number(item.ItemId),
        quantity: itemTemplate.quantity,
        unit: itemTemplate.unit,
        requiresScan: itemTemplate.requiresScan ?? false,
        requiresApproval: itemTemplate.requiresApproval ?? false,
        highValueFlag: itemTemplate.highValueFlag ?? false,
        varianceToleranceQty: itemTemplate.varianceToleranceQty ?? 0,
        varianceTolerancePercent: itemTemplate.varianceTolerancePercent ?? 0,
        notes: `Starter rule matched by keywords: ${itemTemplate.keywords.join(', ')}`,
      });
    }

    if (items.length === 0) {
      skipped += 1;
      details.push({ ruleCode, status: 'skipped', reason: 'no_matching_items' });
      continue;
    }

    await createConsumptionRule(db, {
      tenantId: tenant,
      userId: userId ?? null,
      rule: {
        tenantId: tenant,
        ruleName: template.ruleName,
        ruleCode,
        triggerType: template.triggerType,
        triggerCode: template.triggerCode,
        department: template.department,
        deductionMode: template.deductionMode,
        chargePolicy: 'none',
        items,
      },
    });
    created += 1;
    details.push({ ruleCode, status: 'created' });
  }

  return { rules: DEFAULT_INVENTORY_CONSUMPTION_RULE_TEMPLATES.length, created, skipped, details };
}

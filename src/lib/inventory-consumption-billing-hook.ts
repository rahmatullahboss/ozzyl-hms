import type { ConsumptionRuleDb } from './inventory-consumption-rules';
import { triggerInventoryConsumptionFromWorkflow, type ConsumptionTriggerInput } from './inventory-consumption-triggering';

export type BillingConsumptionHookItem = {
  sourceType?: string | null;
  serviceItemId?: number | null;
  department?: string | null;
  description?: string | null;
  lineTotal?: number | null;
};

export type BillingConsumptionHookInput = {
  tenantId: string;
  userId?: number | string | null;
  patientId: number;
  visitId?: number | null;
  billId: number;
  invoiceNo: string;
  items: BillingConsumptionHookItem[];
  triggerConsumption?: (db: ConsumptionRuleDb, input: ConsumptionTriggerInput) => Promise<{ summary: { matchedRules: number; created: number; existing: number }; events: unknown[] }>;
};

function normalizeUserId(value: number | string | null | undefined): number | null {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function shouldTriggerConsumptionForBillingItem(item: BillingConsumptionHookItem): boolean {
  return item.sourceType === 'service_item' && Number(item.serviceItemId ?? 0) > 0;
}

export function buildBillingConsumptionTriggerInput(input: {
  tenantId: string;
  userId?: number | string | null;
  patientId: number;
  visitId?: number | null;
  billId: number;
  invoiceItemId: number;
  item: BillingConsumptionHookItem;
}): ConsumptionTriggerInput {
  const serviceItemId = Number(input.item.serviceItemId ?? 0);
  if (!serviceItemId) throw new Error('serviceItemId is required for billing consumption trigger');
  return {
    tenantId: input.tenantId,
    userId: normalizeUserId(input.userId),
    triggerType: 'billing_item',
    triggerId: serviceItemId,
    patientId: input.patientId,
    visitId: input.visitId ?? null,
    billId: input.billId,
    invoiceItemId: input.invoiceItemId,
    department: input.item.department ?? null,
    remarks: `Billing item: ${input.item.description || serviceItemId}`,
  };
}

async function resolveInvoiceItemId(db: ConsumptionRuleDb, input: {
  tenantId: string;
  billId: number;
  serviceItemId: number;
  description?: string | null;
}): Promise<number | null> {
  const row = await db.prepare(`
    SELECT id
    FROM invoice_items
    WHERE tenant_id = ?
      AND bill_id = ?
      AND reference_id = ?
      AND description = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(
    input.tenantId,
    input.billId,
    input.serviceItemId,
    input.description ?? '',
  ).first<{ id: number }>();
  const id = Number(row?.id ?? 0);
  return id > 0 ? id : null;
}

export async function triggerBillingCounterInvoiceConsumption(
  db: ConsumptionRuleDb,
  input: BillingConsumptionHookInput,
): Promise<{ processed: number; matchedRules: number; created: number; existing: number }> {
  const triggerConsumption = input.triggerConsumption ?? triggerInventoryConsumptionFromWorkflow;
  let processed = 0;
  let matchedRules = 0;
  let created = 0;
  let existing = 0;

  for (const item of input.items) {
    if (!shouldTriggerConsumptionForBillingItem(item)) continue;
    const serviceItemId = Number(item.serviceItemId);
    const invoiceItemId = await resolveInvoiceItemId(db, {
      tenantId: input.tenantId,
      billId: input.billId,
      serviceItemId,
      description: item.description,
    });
    if (!invoiceItemId) continue;

    const result = await triggerConsumption(db, buildBillingConsumptionTriggerInput({
      tenantId: input.tenantId,
      userId: normalizeUserId(input.userId),
      patientId: input.patientId,
      visitId: input.visitId ?? null,
      billId: input.billId,
      invoiceItemId,
      item,
    }));
    processed += 1;
    matchedRules += Number(result.summary?.matchedRules ?? 0);
    created += Number(result.summary?.created ?? 0);
    existing += Number(result.summary?.existing ?? 0);
  }

  return { processed, matchedRules, created, existing };
}

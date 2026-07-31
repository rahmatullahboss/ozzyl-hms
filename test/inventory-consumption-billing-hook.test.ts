import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildBillingConsumptionTriggerInput,
  shouldTriggerConsumptionForBillingItem,
  triggerBillingCounterInvoiceConsumption,
} from '../src/lib/inventory-consumption-billing-hook';

function createMockDb(invoiceItemId = 901) {
  const calls: Array<{ sql: string; params: unknown[]; op: 'first' }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              first: async () => {
                calls.push({ sql, params, op: 'first' });
                return { id: invoiceItemId };
              },
              all: async () => ({ results: [] }),
              run: async () => ({ success: true, meta: { changes: 1 } }),
            };
          },
        };
      },
    },
  };
}

describe('billing counter inventory consumption hook', () => {
  it('only triggers consumption for service-item billing lines with service item ids', () => {
    expect(shouldTriggerConsumptionForBillingItem({ sourceType: 'service_item', serviceItemId: 12 })).toBe(true);
    expect(shouldTriggerConsumptionForBillingItem({ sourceType: 'doctor', serviceItemId: null })).toBe(false);
    expect(shouldTriggerConsumptionForBillingItem({ sourceType: 'service_item', serviceItemId: null })).toBe(false);
  });

  it('builds billing-item consumption trigger payloads with invoice item id for idempotency', () => {
    expect(buildBillingConsumptionTriggerInput({
      tenantId: 't1',
      userId: 11,
      patientId: 5,
      visitId: 6,
      billId: 90,
      invoiceItemId: 901,
      item: { serviceItemId: 45, department: 'Procedure', description: 'Dressing Small' },
    })).toEqual({
      tenantId: 't1',
      userId: 11,
      triggerType: 'billing_item',
      triggerId: 45,
      patientId: 5,
      visitId: 6,
      billId: 90,
      invoiceItemId: 901,
      department: 'Procedure',
      remarks: 'Billing item: Dressing Small',
    });
  });

  it('resolves invoice item ids and calls the rule-driven trigger once per service item line', async () => {
    const { db, calls } = createMockDb(901);
    const trigger = vi.fn(async () => ({ summary: { matchedRules: 1, created: 1, existing: 0 }, events: [] }));

    const result = await triggerBillingCounterInvoiceConsumption(db, {
      tenantId: 't1',
      userId: 11,
      patientId: 5,
      visitId: 6,
      billId: 90,
      invoiceNo: 'BILL-1',
      items: [
        { sourceType: 'doctor', serviceItemId: null, department: 'Doctor', description: 'Consultation', lineTotal: 500 },
        { sourceType: 'service_item', serviceItemId: 45, department: 'Procedure', description: 'Dressing Small', lineTotal: 200 },
      ],
      triggerConsumption: trigger,
    });

    expect(result).toEqual({ processed: 1, matchedRules: 1, created: 1, existing: 0 });
    expect(calls[0].sql).toContain('FROM invoice_items');
    expect(calls[0].params).toEqual(['t1', 90, 45, 'Dressing Small']);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][1]).toMatchObject({ triggerType: 'billing_item', triggerId: 45, invoiceItemId: 901 });
  });

  it('billing invoice creates a consumption event when a matching rule exists', async () => {
    const calls: Array<{ sql: string; params: unknown[]; op: 'first' | 'all' | 'run' }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              first: async () => {
                calls.push({ sql, params, op: 'first' });
                if (sql.includes('FROM invoice_items')) return { id: 901 };
                if (sql.includes('FROM InventoryConsumptionEvent')) return null;
                return null;
              },
              all: async () => {
                calls.push({ sql, params, op: 'all' });
                if (sql.includes('FROM InventoryConsumptionRuleItem')) {
                  return {
                    results: [{
                      RuleItemId: 11,
                      ItemId: 22,
                      DefaultStockId: 33,
                      Quantity: 1.5,
                      Unit: 'ml',
                      RequiresScan: 0,
                      RequiresApproval: 0,
                      HighValueFlag: 0,
                    }],
                  };
                }
                if (sql.includes('FROM InventoryConsumptionRule\n')) {
                  return {
                    results: [{
                      RuleId: 7,
                      RuleCode: 'CBC-REAGENT',
                      RuleName: 'CBC reagent rule',
                      TriggerType: 'billing_item',
                      TriggerId: 45,
                      TriggerCode: null,
                      Department: 'Lab',
                      DefaultStoreId: 3,
                      deductionMode: 'auto',
                    }],
                  };
                }
                return { results: [] };
              },
              run: async () => {
                calls.push({ sql, params, op: 'run' });
                if (sql.includes('INSERT INTO InventoryConsumptionEvent\n')) {
                  return { success: true, meta: { last_row_id: 7001, changes: 1 } };
                }
                return { success: true, meta: { last_row_id: 7002, changes: 1 } };
              },
            };
          },
        };
      },
    };

    const result = await triggerBillingCounterInvoiceConsumption(db, {
      tenantId: 't1',
      userId: '11',
      patientId: 5,
      visitId: 6,
      billId: 90,
      invoiceNo: 'BILL-1',
      items: [
        { sourceType: 'doctor', serviceItemId: null, department: 'Doctor', description: 'Consultation', lineTotal: 500 },
        { sourceType: 'service_item', serviceItemId: 45, department: 'Lab', description: 'CBC', lineTotal: 300 },
      ],
    });

    expect(result).toEqual({ processed: 1, matchedRules: 1, created: 1, existing: 0 });
    expect(calls.find((call) => call.sql.includes('FROM invoice_items'))?.params).toEqual(['t1', 90, 45, 'CBC']);
    expect(calls.find((call) => call.sql.includes('FROM InventoryConsumptionRule\n'))?.params).toEqual(['t1', 'billing_item', 45]);

    const eventInsert = calls.find((call) => call.op === 'run' && call.sql.includes('INSERT INTO InventoryConsumptionEvent\n'));
    expect(eventInsert?.params).toEqual(expect.arrayContaining([
      't1', 7, 'billing_item', 45, 5, 6, 90, 901, 'Lab', 3, 'auto', 'expected', 11,
    ]));

    const itemInsert = calls.find((call) => call.op === 'run' && call.sql.includes('INSERT INTO InventoryConsumptionEventItem'));
    expect(itemInsert?.params).toEqual(expect.arrayContaining([
      't1', 7001, 11, 22, 33, 1.5, 'ml', 0, 0, 'expected', 0, 0, 0, 11,
    ]));
  });

  it('wires billing counter invoice creation through waitUntil and audit logging without direct stock mutation', () => {
    const billingCounter = readFileSync('src/routes/tenant/billingCounter.legacy.ts', 'utf8');
    const hook = readFileSync('src/lib/inventory-consumption-billing-hook.ts', 'utf8');
    expect(billingCounter).toContain('queueBillingCounterInvoiceConsumption');
    expect(billingCounter).toContain('c.executionCtx.waitUntil(consumption)');
    expect(billingCounter).toContain('inventory_consumption_billing_hook');
    expect(billingCounter).not.toContain('void triggerBillingCounterInvoiceConsumption');
    expect(hook).toContain('triggerInventoryConsumptionFromWorkflow');
    expect(hook).not.toContain('UPDATE InventoryStock');
  });
});

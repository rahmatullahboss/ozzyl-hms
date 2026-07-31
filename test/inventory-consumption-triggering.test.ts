import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildConsumptionEventInputFromRule,
  summarizeTriggeredConsumptionEvents,
  triggerInventoryConsumptionFromWorkflow,
} from '../src/lib/inventory-consumption-triggering';

describe('inventory consumption trigger integration', () => {
  it('creates a consumption event for a billing invoice rule when the DB returns camel-case deductionMode', async () => {
    const calls: Array<{ sql: string; params: unknown[]; op: 'first' | 'all' | 'run' }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              first: async () => {
                calls.push({ sql, params, op: 'first' });
                if (sql.includes('FROM InventoryConsumptionEvent')) return null;
                return null;
              },
              all: async () => {
                calls.push({ sql, params, op: 'all' });
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
                return { results: [] };
              },
              run: async () => {
                calls.push({ sql, params, op: 'run' });
                if (sql.includes('INSERT INTO InventoryConsumptionEvent\n')) {
                  return { success: true, meta: { last_row_id: 123, changes: 1 } };
                }
                return { success: true, meta: { last_row_id: 456, changes: 1 } };
              },
            };
          },
        };
      },
    };

    const result = await triggerInventoryConsumptionFromWorkflow(db, {
      tenantId: 't1',
      userId: 11,
      triggerType: 'billing_item',
      triggerId: 45,
      patientId: 5,
      visitId: 6,
      billId: 90,
      invoiceItemId: 901,
      department: 'Lab',
    });

    expect(result.summary).toEqual({ matchedRules: 1, created: 1, existing: 0 });
    const eventInsert = calls.find((call) => call.op === 'run' && call.sql.includes('INSERT INTO InventoryConsumptionEvent\n'));
    expect(eventInsert?.params).toContain('auto');
  });

  it('builds expected consumption event payloads from matched rules and rule items', () => {
    const event = buildConsumptionEventInputFromRule({
      tenantId: 't1',
      userId: 11,
      trigger: {
        triggerType: 'billing_item',
        triggerId: 45,
        billId: 90,
        invoiceItemId: 91,
        patientId: 5,
        department: 'Procedure',
      },
      rule: {
        RuleId: 7,
        RuleCode: 'DRESSING_SMALL',
        RuleName: 'Dressing Small',
        TriggerType: 'billing_item',
        TriggerId: 45,
        TriggerCode: null,
        Department: 'Procedure',
        DefaultStoreId: 3,
        DeductionMode: 'suggest_confirm',
      },
      ruleItems: [
        { RuleItemId: 1, ItemId: 10, DefaultStockId: 100, Quantity: 2, Unit: 'pcs', RequiresScan: 0, RequiresApproval: 0, HighValueFlag: 0 },
        { RuleItemId: 2, ItemId: 11, DefaultStockId: null, Quantity: 1, Unit: 'roll', RequiresScan: 1, RequiresApproval: 0, HighValueFlag: 1 },
      ],
    });

    expect(event).toMatchObject({
      tenantId: 't1',
      ruleId: 7,
      triggerType: 'billing_item',
      triggerId: 45,
      billId: 90,
      invoiceItemId: 91,
      patientId: 5,
      department: 'Procedure',
      storeId: 3,
      deductionMode: 'suggest_confirm',
      userId: 11,
    });
    expect(event.items).toEqual([
      { ruleItemId: 1, itemId: 10, stockId: 100, expectedQuantity: 2, unit: 'pcs', requiresScan: false, requiresApproval: false, highValueFlag: false, chargeable: false, chargeAmount: 0, remarks: 'Rule DRESSING_SMALL' },
      { ruleItemId: 2, itemId: 11, stockId: null, expectedQuantity: 1, unit: 'roll', requiresScan: true, requiresApproval: false, highValueFlag: true, chargeable: false, chargeAmount: 0, remarks: 'Rule DRESSING_SMALL' },
    ]);
  });

  it('summarizes triggered event results for workflow adapters', () => {
    expect(summarizeTriggeredConsumptionEvents([
      { eventId: 1, created: true, eventNo: 'ICE-1', status: 'pending_confirmation' },
      { eventId: 2, created: false, eventNo: 'ICE-2', status: 'posted' },
    ])).toEqual({ matchedRules: 2, created: 1, existing: 1 });
  });

  it('exposes a rule-driven trigger endpoint without duplicating stock issue logic', () => {
    const adapter = readFileSync('src/routes/tenant/inventory/workflowAdapters.ts', 'utf8');
    const service = readFileSync('src/lib/inventory-consumption-triggering.ts', 'utf8');
    expect(adapter).toContain('/trigger-consumption');
    expect(adapter).toContain('triggerInventoryConsumptionFromWorkflow');
    expect(service).toContain('findConsumptionRulesForTrigger');
    expect(service).toContain('createExpectedConsumptionEvent');
    expect(service).not.toContain('UPDATE InventoryStock');
  });
});

import { describe, expect, it } from 'vitest';
import {
  createConsumptionRule,
  findConsumptionRulesForTrigger,
  listConsumptionRules,
} from '../src/lib/inventory-consumption-rules';

type PreparedCall = { sql: string; params: unknown[] };

function createMockDb(options?: { first?: any; all?: any; run?: any }) {
  const calls: PreparedCall[] = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ sql, params });
            return {
              run: async () => options?.run ?? { success: true, meta: { last_row_id: 77, changes: 1 } },
              first: async () => options?.first ?? null,
              all: async () => options?.all ?? { results: [] },
            };
          },
        };
      },
    },
  };
}

describe('inventory consumption rule DB service', () => {
  it('creates a normalized rule header and item rows', async () => {
    const { db, calls } = createMockDb();

    const result = await createConsumptionRule(db, {
      tenantId: 't1',
      userId: 9,
      rule: {
        tenantId: 't1',
        ruleName: 'Dressing Small',
        triggerType: 'billing_item',
        triggerId: 45,
        defaultStoreId: 3,
        deductionMode: 'suggest_confirm',
        items: [
          { itemId: 7, quantity: 2, unit: 'pcs', requiresScan: false },
          { itemId: 8, quantity: 1, requiresApproval: true, highValueFlag: true },
        ],
      },
    });

    expect(result.ruleId).toBe(77);
    expect(calls[0].sql).toContain('INSERT INTO InventoryConsumptionRule');
    expect(calls[0].params).toEqual(expect.arrayContaining(['t1', 'Dressing Small', 'DRESSING-SMALL', 'billing_item', 45, 3, 'suggest_confirm', 'none', 1, 9]));
    expect(calls.filter(call => call.sql.includes('INSERT INTO InventoryConsumptionRuleItem'))).toHaveLength(2);
    expect(calls[1].params).toEqual(expect.arrayContaining(['t1', 77, 7, 2, 'pcs', 1, 0, 0, 0]));
    expect(calls[2].params).toEqual(expect.arrayContaining(['t1', 77, 8, 1, null, 1, 0, 1, 1]));
  });

  it('lists rules with tenant-safe filters', async () => {
    const { db, calls } = createMockDb({ all: { results: [{ RuleId: 1 }] } });

    const rows = await listConsumptionRules(db, 't1', {
      triggerType: 'ot_procedure',
      isActive: true,
      department: 'OT',
    });

    expect(rows).toEqual([{ RuleId: 1 }]);
    expect(calls[0].sql).toContain('FROM InventoryConsumptionRule');
    expect(calls[0].sql).toContain('tenant_id = ?');
    expect(calls[0].sql).toContain('TriggerType = ?');
    expect(calls[0].sql).toContain('IsActive = ?');
    expect(calls[0].params).toEqual(['t1', 'ot_procedure', 1, 'OT']);
  });

  it('finds active rules for a trigger by id or code without scanning all tenants', async () => {
    const { db, calls } = createMockDb({ all: { results: [{ RuleId: 12, RuleName: 'Appendectomy Pack' }] } });

    const rows = await findConsumptionRulesForTrigger(db, {
      tenantId: 't1',
      triggerType: 'ot_procedure',
      triggerId: 5,
      triggerCode: 'APPENDECTOMY',
    });

    expect(rows).toHaveLength(1);
    expect(calls[0].sql).toContain('tenant_id = ?');
    expect(calls[0].sql).toContain('IsActive = 1');
    expect(calls[0].sql).toContain('TriggerType = ?');
    expect(calls[0].sql).toContain('TriggerId = ?');
    expect(calls[0].sql).toContain('TriggerCode = ?');
    expect(calls[0].params).toEqual(['t1', 'ot_procedure', 5, 'APPENDECTOMY']);
  });
});

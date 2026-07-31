import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildConsumptionRuleCoverageSummary,
  listConsumptionRuleCoverageRows,
} from '../src/lib/inventory-consumption-reports';

function createMockDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              all: async () => {
                calls.push({ sql, params });
                return { results: [
                  { TriggerType: 'procedure', TriggerId: 12, TriggerCode: null, Department: 'Procedure', EventCount: 4, MatchedRuleEvents: 3, MissingRuleEvents: 1, RuleCount: 1, HasActiveRule: 1 },
                ] };
              },
            };
          },
        };
      },
    },
  };
}

describe('consumption rule coverage report', () => {
  it('summarizes trigger coverage and missing rule counts', () => {
    expect(buildConsumptionRuleCoverageSummary([
      { TriggerType: 'procedure', TriggerId: 12, TriggerCode: null, Department: 'Procedure', EventCount: 4, MatchedRuleEvents: 3, MissingRuleEvents: 1, RuleCount: 1, HasActiveRule: 1 },
      { TriggerType: 'ot_procedure', TriggerId: 5, TriggerCode: null, Department: 'OT', EventCount: 2, MatchedRuleEvents: 0, MissingRuleEvents: 2, RuleCount: 0, HasActiveRule: 0 },
    ])).toEqual({ totalTriggers: 2, coveredTriggers: 1, missingTriggers: 1, eventCount: 6, missingRuleEvents: 3 });
  });

  it('lists rule coverage by trigger with date, department and trigger filters', async () => {
    const { db, calls } = createMockDb();
    const rows = await listConsumptionRuleCoverageRows(db, 't1', { from: '2026-07-01', to: '2026-07-31', department: 'OT', triggerType: 'ot_procedure' });

    expect(rows).toHaveLength(1);
    expect(calls[0].sql).toContain('FROM InventoryConsumptionEvent e');
    expect(calls[0].sql).toContain('LEFT JOIN InventoryConsumptionRule r');
    expect(calls[0].sql).toContain('blocked_missing_rule');
    expect(calls[0].params).toEqual(['t1', '2026-07-01', '2026-07-31', 'OT', 'ot_procedure']);
  });

  it('exposes the API route and UI panel wiring', () => {
    const route = readFileSync('src/routes/tenant/inventory/consumptionReports.ts', 'utf8');
    const ui = readFileSync('web/src/pages/inventory/InventoryConsumptionAutomation.tsx', 'utf8');
    expect(route).toContain('/rule-coverage');
    expect(route).toContain('listConsumptionRuleCoverageRows');
    expect(route).toContain('buildConsumptionRuleCoverageSummary');
    expect(ui).toContain('buildConsumptionRuleCoverageEndpoint');
    expect(ui).toContain('data-testid="consumption-rule-coverage-card"');
    expect(ui).toContain('data-testid="consumption-rule-coverage-table"');
  });
});

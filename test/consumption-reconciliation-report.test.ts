import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildConsumptionReconciliationSummary,
  listConsumptionReconciliationRows,
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
                  { Department: 'OT', Status: 'posted', EventCount: 2, ExpectedQty: 10, ActualQty: 12, VarianceQty: 2 },
                  { Department: 'Ward', Status: 'variance_review', EventCount: 1, ExpectedQty: 3, ActualQty: 5, VarianceQty: 2 },
                ] };
              },
              first: async () => null,
              run: async () => ({ success: true, meta: { changes: 1 } }),
            };
          },
        };
      },
    },
  };
}

describe('consumption reconciliation report', () => {
  it('lists tenant-scoped expected vs actual reconciliation rows', async () => {
    const { db, calls } = createMockDb();
    const rows = await listConsumptionReconciliationRows(db, 't1', { from: '2026-07-01', to: '2026-07-31' });
    expect(rows).toHaveLength(2);
    expect(calls[0].sql).toContain('InventoryConsumptionEvent');
    expect(calls[0].sql).toContain('InventoryConsumptionEventItem');
    expect(calls[0].sql).toContain('GROUP BY');
    expect(calls[0].params).toEqual(['t1', '2026-07-01', '2026-07-31']);
  });

  it('summarizes totals and high variance rows for dashboard cards', () => {
    const summary = buildConsumptionReconciliationSummary([
      { Department: 'OT', Status: 'posted', EventCount: 2, ExpectedQty: 10, ActualQty: 12, VarianceQty: 2 },
      { Department: 'Ward', Status: 'variance_review', EventCount: 1, ExpectedQty: 3, ActualQty: 5, VarianceQty: 2 },
    ]);
    expect(summary).toEqual({ totalEvents: 3, expectedQty: 13, actualQty: 17, varianceQty: 4, highVarianceRows: 2 });
  });

  it('exposes report endpoint and UI card wiring', () => {
    const index = readFileSync('src/routes/tenant/inventory/index.ts', 'utf8');
    const route = readFileSync('src/routes/tenant/inventory/consumptionReports.ts', 'utf8');
    const ui = readFileSync('web/src/pages/inventory/InventoryConsumptionAutomation.tsx', 'utf8');
    expect(index).toContain('consumption-report');
    expect(route).toContain('/reconciliation');
    expect(route).toContain('listConsumptionReconciliationRows');
    expect(ui).toContain('/api/inventory/consumption-reports/reconciliation');
    expect(ui).toContain('data-testid="consumption-reconciliation-card"');
  });
});

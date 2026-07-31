import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reviewConsumptionVariance } from '../src/lib/inventory-consumption-events';

function createMockDb() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              run: async () => {
                calls.push({ sql, params });
                return { success: true, meta: { changes: 1 } };
              },
              first: async () => null,
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    },
  };
}

describe('consumption variance review', () => {
  it('marks variance event and items confirmed with reviewer audit fields', async () => {
    const { db, calls } = createMockDb();
    const result = await reviewConsumptionVariance(db, {
      tenantId: 't1',
      eventId: 88,
      reviewedBy: 12,
      note: 'Accepted OT actual usage',
    });

    expect(result).toEqual({ eventId: 88, status: 'confirmed' });
    expect(calls[0].sql).toContain('InventoryConsumptionEventItem');
    expect(calls[0].sql).toContain("Status = 'confirmed'");
    expect(calls[0].params).toEqual(['Accepted OT actual usage', 12, 't1', 88]);
    expect(calls[1].sql).toContain('InventoryConsumptionEvent');
    expect(calls[1].sql).toContain("Status = 'confirmed'");
    expect(calls[1].params).toEqual([12, 'Accepted OT actual usage', 12, 't1', 88]);
  });

  it('exposes a variance review endpoint and UI action', () => {
    const route = readFileSync('src/routes/tenant/inventory/consumptionEvents.ts', 'utf8');
    const ui = readFileSync('web/src/pages/inventory/InventoryConsumptionAutomation.tsx', 'utf8');
    expect(route).toContain('/:id/review-variance');
    expect(route).toContain('reviewConsumptionVariance');
    expect(ui).toContain('/api/inventory/consumption-events/${eventId}/review-variance');
    expect(ui).toContain('data-testid="review-variance-action"');
    expect(ui).toContain('canReviewConsumptionVarianceFromUiStatus(selectedEventStatus)');
  });
});

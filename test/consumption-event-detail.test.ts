import { describe, expect, it } from 'vitest';
import { getConsumptionEventDetail } from '../src/lib/inventory-consumption-events';

function createMockDb() {
  const calls: Array<{ sql: string; params: unknown[]; op: string }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              first: async () => {
                calls.push({ sql, params, op: 'first' });
                return { EventId: 88, EventNo: 'ICE-88', Status: 'pending_confirmation' };
              },
              all: async () => {
                calls.push({ sql, params, op: 'all' });
                return { results: [{ EventItemId: 9, ItemId: 7, ExpectedQuantity: 2, ActualQuantity: null, Unit: 'pcs' }] };
              },
              run: async () => ({ success: true, meta: { changes: 1 } }),
            };
          },
        };
      },
    },
  };
}

describe('consumption event detail service', () => {
  it('loads a tenant-scoped event with its expected item rows', async () => {
    const { db, calls } = createMockDb();
    const detail = await getConsumptionEventDetail(db, 't1', 88);
    expect(detail).toEqual({ event: { EventId: 88, EventNo: 'ICE-88', Status: 'pending_confirmation' }, items: [{ EventItemId: 9, ItemId: 7, ExpectedQuantity: 2, ActualQuantity: null, Unit: 'pcs' }] });
    expect(calls[0].sql).toContain('FROM InventoryConsumptionEvent');
    expect(calls[0].params).toEqual(['t1', 88]);
    expect(calls[1].sql).toContain('FROM InventoryConsumptionEventItem');
    expect(calls[1].params).toEqual(['t1', 88]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  calculateConsumptionVariance,
  confirmConsumptionEvent,
  shouldFlagConsumptionVariance,
} from '../src/lib/inventory-consumption-events';

type PreparedCall = { sql: string; params: unknown[]; op: 'run' };

function createMockDb() {
  const calls: PreparedCall[] = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              run: async () => {
                calls.push({ sql, params, op: 'run' });
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

describe('inventory consumption confirmation and variance', () => {
  it('calculates expected-vs-actual variance', () => {
    expect(calculateConsumptionVariance(10, 13)).toBe(3);
    expect(calculateConsumptionVariance(10, 7)).toBe(-3);
  });

  it('flags variance by quantity or percent tolerance', () => {
    expect(shouldFlagConsumptionVariance({ expectedQuantity: 10, actualQuantity: 11, toleranceQty: 2, tolerancePercent: 25 })).toBe(false);
    expect(shouldFlagConsumptionVariance({ expectedQuantity: 10, actualQuantity: 13, toleranceQty: 2, tolerancePercent: 50 })).toBe(true);
    expect(shouldFlagConsumptionVariance({ expectedQuantity: 10, actualQuantity: 14, toleranceQty: 10, tolerancePercent: 25 })).toBe(true);
  });

  it('requires a reason when actual usage is outside tolerance', async () => {
    const { db } = createMockDb();
    await expect(confirmConsumptionEvent(db, {
      tenantId: 't1',
      eventId: 88,
      userId: 11,
      items: [{ eventItemId: 1, expectedQuantity: 10, actualQuantity: 13, toleranceQty: 2 }],
    })).rejects.toThrow(/variance reason/i);
  });

  it('confirms event items and marks event confirmed when variance is within tolerance', async () => {
    const { db, calls } = createMockDb();

    const result = await confirmConsumptionEvent(db, {
      tenantId: 't1',
      eventId: 88,
      userId: 11,
      items: [{ eventItemId: 1, expectedQuantity: 10, actualQuantity: 11, toleranceQty: 2 }],
    });

    expect(result).toEqual({ eventId: 88, status: 'confirmed', varianceReview: false });
    expect(calls[0].sql).toContain('UPDATE InventoryConsumptionEventItem');
    expect(calls[0].params).toEqual(expect.arrayContaining([11, 1, 't1', 1]));
    expect(calls[1].sql).toContain('UPDATE InventoryConsumptionEvent');
    expect(calls[1].params).toEqual(expect.arrayContaining(['confirmed', 11, 't1', 88]));
  });

  it('marks the event for variance review when reasoned actual usage is outside tolerance', async () => {
    const { db, calls } = createMockDb();

    const result = await confirmConsumptionEvent(db, {
      tenantId: 't1',
      eventId: 88,
      userId: 11,
      items: [{ eventItemId: 1, expectedQuantity: 10, actualQuantity: 13, toleranceQty: 2, varianceReason: 'Patient needed extra gauze' }],
    });

    expect(result).toEqual({ eventId: 88, status: 'variance_review', varianceReview: true });
    expect(calls[0].params).toEqual(expect.arrayContaining([13, 3, 'Patient needed extra gauze', 'variance_review']));
    expect(calls[1].params).toEqual(expect.arrayContaining(['variance_review', 11, 't1', 88]));
  });
});

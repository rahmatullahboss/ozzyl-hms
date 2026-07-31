import { describe, expect, it } from 'vitest';
import { createConsumptionException, normalizeConsumptionExceptionInput, reviewConsumptionException } from '../src/lib/inventory-consumption-exceptions';

function createMockDb(options?: { run?: any }) {
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
                return options?.run ?? { success: true, meta: { last_row_id: 66, changes: 1 } };
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

describe('inventory consumption exceptions', () => {
  it('normalizes exception input', () => {
    expect(normalizeConsumptionExceptionInput({ tenantId: ' t1 ', eventId: 88, reason: 'stock_shortage', message: ' No stock ' })).toEqual({
      tenantId: 't1',
      eventId: 88,
      eventItemId: null,
      reason: 'stock_shortage',
      severity: 'warning',
      message: 'No stock',
      createdBy: null,
    });
  });

  it('creates exception rows for owner review', async () => {
    const { db, calls } = createMockDb();

    const result = await createConsumptionException(db, {
      tenantId: 't1',
      eventId: 88,
      eventItemId: 9,
      reason: 'approval_required',
      severity: 'critical',
      message: 'Item requires approval',
      createdBy: 11,
    });

    expect(result).toEqual({ exceptionId: 66 });
    expect(calls[0].sql).toContain('INSERT INTO InventoryConsumptionException');
    expect(calls[0].params).toEqual(['t1', 88, 9, 'approval_required', 'critical', 'Item requires approval', 11]);
  });

  it('reviews exceptions with resolution notes', async () => {
    const { db, calls } = createMockDb({ run: { success: true, meta: { changes: 1 } } });

    const result = await reviewConsumptionException(db, {
      tenantId: 't1',
      exceptionId: 66,
      status: 'resolved',
      reviewedBy: 12,
      resolutionNote: 'Approved after checking record',
    });

    expect(result).toEqual({ exceptionId: 66, status: 'resolved' });
    expect(calls[0].sql).toContain('UPDATE InventoryConsumptionException');
    expect(calls[0].params).toEqual(['resolved', 12, 'Approved after checking record', 't1', 66]);
  });
});

import { describe, expect, it } from 'vitest';
import { listConsumptionEvents } from '../src/lib/inventory-consumption-events';
import { listConsumptionExceptions } from '../src/lib/inventory-consumption-exceptions';

function createMockDb(results: any[] = []) {
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
                return { results };
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

describe('inventory consumption queue/read services', () => {
  it('lists tenant-safe consumption events with status and department filters', async () => {
    const { db, calls } = createMockDb([{ EventId: 1 }]);
    const rows = await listConsumptionEvents(db, 't1', {
      status: 'pending_confirmation',
      department: 'OT',
      limit: 25,
    });

    expect(rows).toEqual([{ EventId: 1 }]);
    expect(calls[0].sql).toContain('FROM InventoryConsumptionEvent');
    expect(calls[0].sql).toContain('tenant_id = ?');
    expect(calls[0].sql).toContain('Status = ?');
    expect(calls[0].sql).toContain('Department = ?');
    expect(calls[0].params).toEqual(['t1', 'pending_confirmation', 'OT', 25]);
  });

  it('lists tenant-safe consumption exceptions with status/severity filters', async () => {
    const { db, calls } = createMockDb([{ ExceptionId: 5 }]);
    const rows = await listConsumptionExceptions(db, 't1', {
      status: 'open',
      severity: 'critical',
      limit: 50,
    });

    expect(rows).toEqual([{ ExceptionId: 5 }]);
    expect(calls[0].sql).toContain('FROM InventoryConsumptionException');
    expect(calls[0].sql).toContain('tenant_id = ?');
    expect(calls[0].sql).toContain('Status = ?');
    expect(calls[0].sql).toContain('Severity = ?');
    expect(calls[0].params).toEqual(['t1', 'open', 'critical', 50]);
  });
});

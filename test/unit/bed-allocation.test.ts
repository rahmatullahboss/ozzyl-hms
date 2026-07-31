/**
 * Unit tests for the bed allocation concurrency helpers (P0-25).
 *
 * Verifies that the conditional-update primitives correctly:
 *   - lock an available bed for an admission
 *   - detect double-allocation (returns 'conflict' on second concurrent call)
 *   - handle missing beds
 *   - reserve/transfer/release flows
 */
import { describe, it, expect } from 'vitest';
import {
  lockBedForAdmission,
  lockBedForTransfer,
  reserveBed,
  releaseBedToAvailable,
  assertBedAllocationOk,
  type DbExecutor,
} from '../../src/lib/bed-allocation';

interface MockRow {
  status: string;
  admission_id?: number | null;
}

interface MockExecutorOptions {
  rows?: Map<number, MockRow>;
  updateCount?: Map<number, number>;
}

function createMockDb(opts: MockExecutorOptions = {}): DbExecutor & { calls: { sql: string; params: unknown[] }[] } {
  const rows = opts.rows ?? new Map<number, MockRow>();
  const updateCount = opts.updateCount ?? new Map<number, number>();
  const calls: { sql: string; params: unknown[] }[] = [];

  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...params: (string | number | null)[]) {
          return {
            async run() {
              calls.push({ sql, params: params as unknown[] });
              if (/UPDATE beds/.test(sql) && /SET status = 'occupied'/.test(sql)) {
                if (/admission_id = \?/.test(sql)) {
                  // lockBedForAdmission variant: admissionId, bedId, tenantId
                  const admissionId = Number(params[0]);
                  const bedId = Number(params[1]);
                  const row = rows.get(bedId);
                  if (!row) return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                  if (row.status === 'available') {
                    row.status = 'occupied';
                    row.admission_id = admissionId;
                    updateCount.set(bedId, (updateCount.get(bedId) ?? 0) + 1);
                    return { success: true, meta: { changes: 1, last_row_id: 0, duration: 0 } };
                  }
                  return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                }
                // lockBedForTransfer: bedId, tenantId
                const bedId = Number(params[0]);
                const row = rows.get(bedId);
                if (!row) return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                if (row.status === 'available') {
                  row.status = 'occupied';
                  updateCount.set(bedId, (updateCount.get(bedId) ?? 0) + 1);
                  return { success: true, meta: { changes: 1, last_row_id: 0, duration: 0 } };
                }
                return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
              }
              if (/UPDATE beds/.test(sql) && /SET status = 'reserved'/.test(sql)) {
                const bedId = Number(params[0]);
                const row = rows.get(bedId);
                if (!row) return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                if (row.status === 'available') {
                  row.status = 'reserved';
                  return { success: true, meta: { changes: 1, last_row_id: 0, duration: 0 } };
                }
                return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
              }
              if (/UPDATE beds/.test(sql) && /SET status = \?/.test(sql) && /status != 'occupied'/.test(sql)) {
                const targetStatus = String(params[0]);
                const bedId = Number(params[1]);
                const row = rows.get(bedId);
                if (!row) return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
                if (row.status !== 'occupied') {
                  row.status = targetStatus;
                  return { success: true, meta: { changes: 1, last_row_id: 0, duration: 0 } };
                }
                return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
              }
              return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
            },
            async first() {
              calls.push({ sql, params: params as unknown[] });
              const m = /WHERE id = \? AND tenant_id = \?/.exec(sql);
              if (m) {
                const bedId = Number(params[0]);
                const row = rows.get(bedId);
                if (!row) return null as unknown as Record<string, unknown> | null;
                return row as unknown as Record<string, unknown>;
              }
              return null as unknown as Record<string, unknown> | null;
            },
            async all() {
              calls.push({ sql, params: params as unknown[] });
              return { results: [], success: true, meta: {} };
            },
          };
        },
      };
    },
  };
}

describe('bed-allocation / P0-25', () => {
  describe('lockBedForAdmission', () => {
    it('locks an available bed', async () => {
      const db = createMockDb({ rows: new Map([[1, { status: 'available' }]]) });
      const result = await lockBedForAdmission(db, { tenantId: 't1', bedId: 1, admissionId: 99 });
      expect(result.kind).toBe('ok');
      expect(result.kind === 'ok' && result.changes).toBe(1);
    });

    it('returns conflict when bed is already occupied', async () => {
      const db = createMockDb({ rows: new Map([[1, { status: 'occupied' }]]) });
      const result = await lockBedForAdmission(db, { tenantId: 't1', bedId: 1, admissionId: 99 });
      expect(result.kind).toBe('conflict');
    });

    it('returns not_found when bed does not exist', async () => {
      const db = createMockDb({ rows: new Map() });
      const result = await lockBedForAdmission(db, { tenantId: 't1', bedId: 1, admissionId: 99 });
      expect(result.kind).toBe('not_found');
    });

    it('returns invalid_status when bed is in maintenance', async () => {
      const db = createMockDb({ rows: new Map([[1, { status: 'maintenance' }]]) });
      const result = await lockBedForAdmission(db, { tenantId: 't1', bedId: 1, admissionId: 99 });
      expect(result.kind).toBe('invalid_status');
    });
  });

  describe('lockBedForTransfer', () => {
    it('occupies an available bed for transfer', async () => {
      const db = createMockDb({ rows: new Map([[2, { status: 'available' }]]) });
      const result = await lockBedForTransfer(db, { tenantId: 't1', newBedId: 2 });
      expect(result.kind).toBe('ok');
    });

    it('rejects transfer to an occupied bed', async () => {
      const db = createMockDb({ rows: new Map([[2, { status: 'occupied' }]]) });
      const result = await lockBedForTransfer(db, { tenantId: 't1', newBedId: 2 });
      expect(result.kind).toBe('conflict');
    });
  });

  describe('reserveBed', () => {
    it('moves an available bed to reserved', async () => {
      const db = createMockDb({ rows: new Map([[3, { status: 'available' }]]) });
      const result = await reserveBed(db, { tenantId: 't1', bedId: 3 });
      expect(result.kind).toBe('ok');
    });

    it('rejects when bed is already reserved', async () => {
      const db = createMockDb({ rows: new Map([[3, { status: 'reserved' }]]) });
      const result = await reserveBed(db, { tenantId: 't1', bedId: 3 });
      expect(result.kind).toBe('conflict');
    });
  });

  describe('releaseBedToAvailable', () => {
    it('releases a reserved bed to available', async () => {
      const db = createMockDb({ rows: new Map([[4, { status: 'reserved' }]]) });
      const result = await releaseBedToAvailable(db, { tenantId: 't1', bedId: 4 });
      expect(result.kind).toBe('ok');
    });

    it('refuses to release an occupied bed', async () => {
      const db = createMockDb({ rows: new Map([[4, { status: 'occupied' }]]) });
      const result = await releaseBedToAvailable(db, { tenantId: 't1', bedId: 4 });
      expect(result.kind).toBe('conflict');
    });
  });

  describe('assertBedAllocationOk', () => {
    it('does not throw when result is ok', () => {
      expect(() => assertBedAllocationOk({ kind: 'ok', changes: 1 }, 'Bed 1')).not.toThrow();
    });

    it('throws 404 when result is not_found', () => {
      try {
        assertBedAllocationOk({ kind: 'not_found' }, 'Bed 1');
        throw new Error('should have thrown');
      } catch (err: unknown) {
        expect((err as { status: number }).status).toBe(404);
      }
    });

    it('throws 409 when result is conflict', () => {
      try {
        assertBedAllocationOk({ kind: 'conflict' }, 'Bed 1');
        throw new Error('should have thrown');
      } catch (err: unknown) {
        expect((err as { status: number }).status).toBe(409);
      }
    });
  });
});

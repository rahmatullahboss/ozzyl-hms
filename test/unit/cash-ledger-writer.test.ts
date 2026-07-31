import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createCashLedgerEntry, shadowCreateCashLedgerEntry } from '../../src/lib/cash-ledger-writer';
import { getNextSequence } from '../../src/lib/sequence';

vi.mock('../../src/lib/sequence', () => ({ getNextSequence: vi.fn() }));

function mockDb(existing?: string) {
  const queries: Array<{ sql: string; params: unknown[]; method: string }> = [];
  const db = {
    prepare(sql: string) {
      const state = { params: [] as unknown[] };
      return {
        bind(...params: unknown[]) { state.params = params; return this; },
        async first<T>() { queries.push({ sql, params: state.params, method: 'first' }); return existing ? ({ ledger_entry_no: existing } as T) : null; },
        async run() { queries.push({ sql, params: state.params, method: 'run' }); return { success: true, meta: { changes: 1 } }; },
      };
    },
  } as unknown as D1Database;
  return { db, queries };
}

const input = {
  tenantId: '102',
  sourceType: 'cash_custody_transfer',
  sourceId: 2,
  eventType: 'CASH_TRANSFER_REQUESTED',
  movementDirection: 'transfer' as const,
  cashStatus: 'PENDING_RECEIVE',
  amount: 18450,
  currentLocationType: 'in_transit',
};

describe('cash-ledger-writer', () => {
  beforeEach(() => {
    vi.mocked(getNextSequence).mockReset();
    vi.mocked(getNextSequence).mockResolvedValue('CLE-000001');
  });

  it('inserts canonical ledger entry with idempotency', async () => {
    const { db, queries } = mockDb();
    const result = await createCashLedgerEntry(db, input);
    expect(result.inserted).toBe(true);
    expect(result.ledgerEntryNo).toBe('CLE-000001');
    expect(result.idempotencyKey).toBe('102:cash_custody_transfer:2:CASH_TRANSFER_REQUESTED:transfer:PENDING_RECEIVE');
    expect(queries.find((q) => q.method === 'run')?.sql).toContain('INSERT INTO cash_ledger_entries');
  });

  it('skips duplicate idempotency key', async () => {
    const { db, queries } = mockDb('CLE-OLD');
    const result = await createCashLedgerEntry(db, input);
    expect(result.inserted).toBe(false);
    expect(result.ledgerEntryNo).toBe('CLE-OLD');
    expect(queries.some((q) => q.method === 'run')).toBe(false);
  });

  it('validates amount before database write', async () => {
    const { db, queries } = mockDb();
    await expect(createCashLedgerEntry(db, { ...input, amount: -1 })).rejects.toThrow(/non-negative/);
    expect(queries).toHaveLength(0);
  });
});


describe('cash-ledger-writer shadow mode', () => {
  it('does not throw when shadow write fails because canonical table is unavailable', async () => {
    const queries: Array<{ sql: string; params: unknown[]; method: string }> = [];
    const db = {
      prepare(sql: string) {
        const state = { params: [] as unknown[] };
        return {
          bind(...params: unknown[]) { state.params = params; return this; },
          async first<T>() {
            queries.push({ sql, params: state.params, method: 'first' });
            throw new Error('no such table: cash_ledger_entries');
          },
          async run() {
            queries.push({ sql, params: state.params, method: 'run' });
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    } as unknown as D1Database;

    const result = await shadowCreateCashLedgerEntry(db, input, { warn: vi.fn() });

    expect(result).toMatchObject({
      inserted: false,
      ledgerEntryNo: null,
      idempotencyKey: '102:cash_custody_transfer:2:CASH_TRANSFER_REQUESTED:transfer:PENDING_RECEIVE',
      shadowSkipped: true,
    });
    expect(result.errorMessage).toContain('cash_ledger_entries');
    const issueInsert = queries.find((query) => query.method === 'run' && query.sql.includes('cash_ledger_shadow_issues'));
    expect(issueInsert).toBeTruthy();
    expect(issueInsert?.params).toEqual(expect.arrayContaining([
      '102',
      'cash_custody_transfer',
      '2',
      'CASH_TRANSFER_REQUESTED',
    ]));
  });
});

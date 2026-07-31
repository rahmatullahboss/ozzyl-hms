import { describe, expect, it } from 'vitest';
import { consumeLabConsumableStock } from '../src/lib/lab-consumables';

type QueryResult = {
  results?: unknown[];
  meta?: { changes?: number; last_row_id?: number };
};

type Handler = {
  name: string;
  match: (sql: string, method: 'all' | 'run') => boolean;
  all?: (ctx: { sql: string; args: unknown[] }) => QueryResult;
  run?: (ctx: { sql: string; args: unknown[] }) => QueryResult;
};

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function createFakeDb(handlers: Handler[]) {
  const calls: Array<{ method: 'all' | 'run'; sql: string; args: unknown[]; handler?: string }> = [];

  const db = {
    calls,
    prepare(sql: string) {
      const normalizedSql = normalize(sql);
      const statement = {
        args: [] as unknown[],
        bind(...args: unknown[]) {
          this.args = args;
          return this;
        },
        async all() {
          const handler = handlers.find((h) => h.all && h.match(normalizedSql, 'all'));
          calls.push({ method: 'all', sql: normalizedSql, args: this.args, handler: handler?.name });
          if (!handler?.all) throw new Error(`Unhandled all query: ${normalizedSql}`);
          return handler.all({ sql: normalizedSql, args: this.args });
        },
        async run() {
          const handler = handlers.find((h) => h.run && h.match(normalizedSql, 'run'));
          calls.push({ method: 'run', sql: normalizedSql, args: this.args, handler: handler?.name });
          if (!handler?.run) throw new Error(`Unhandled run query: ${normalizedSql}`);
          return handler.run({ sql: normalizedSql, args: this.args });
        },
      };
      return statement;
    },
  };

  return db;
}

const baseInput = {
  tenantId: 10,
  userId: 7,
  consumableId: 99,
  quantity: 2,
  referenceType: 'manual',
  referenceId: 123,
  remarks: 'Manual lab stock-out',
  locationId: 5,
};

describe('consumeLabConsumableStock manual stock-out hardening', () => {
  it('uses tenant-scoped non-expired QC-usable stock lookup before deducting', async () => {
    const db = createFakeDb([
      {
        name: 'usable-stock-lookup',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ sql, args }) => {
          expect(sql).toContain('s.tenant_id = ?');
          expect(sql).toContain('s.consumable_id = ?');
          expect(sql).toContain('date(s.expiry_date) > CURRENT_DATE');
          expect(sql).toContain("s.qc_status IN ('not_required', 'passed')");
          expect(sql).toContain('date(s.onboard_expires_at) > CURRENT_DATE');
          expect(sql).toContain('(? IS NULL OR s.location_id = ?)');
          expect(args).toEqual([10, 99, 5, 5]);
          return { results: [{ id: 1, quantity_available: 2, purchase_price: 50 }] };
        },
      },
      {
        name: 'conditional-stock-update',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: ({ sql, args }) => {
          expect(sql).toContain('tenant_id = ?');
          expect(sql).toContain('quantity_available >= ?');
          expect(sql).toContain("qc_status IN ('not_required', 'passed')");
          expect(sql).toContain('date(expiry_date) > CURRENT_DATE');
          expect(sql).toContain('date(onboard_expires_at) > CURRENT_DATE');
          expect(args).toEqual([2, 1, 10, 2]);
          return { meta: { changes: 1 } };
        },
      },
      {
        name: 'movement-insert',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: ({ args }) => {
          expect(args).toEqual([99, 1, 'usage_out', 2, 50, 'manual', 123, 7, 'Manual lab stock-out', 10]);
          return { meta: { changes: 1, last_row_id: 77 } };
        },
      },
    ]);

    await expect(consumeLabConsumableStock(db as any, baseInput)).resolves.toEqual({ quantity_used: 2, movements: 1, cost: 100, movement_ids: [77] });
  });

  it('pre-checks total usable stock and does not partially deduct when insufficient', async () => {
    const db = createFakeDb([
      {
        name: 'usable-stock-lookup',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ sql }) => {
          expect(sql).toContain("s.qc_status IN ('not_required', 'passed')");
          expect(sql).toContain('date(s.onboard_expires_at) > CURRENT_DATE');
          return { results: [{ id: 1, quantity_available: 1, purchase_price: 50 }] };
        },
      },
      {
        name: 'stock-update-should-not-run',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: () => ({ meta: { changes: 1 } }),
      },
      {
        name: 'movement-insert-should-not-run',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: () => ({ meta: { changes: 1 } }),
      },
    ]);

    await expect(consumeLabConsumableStock(db as any, baseInput)).rejects.toMatchObject({ status: 400 });
    expect(db.calls.some((call) => call.handler === 'stock-update-should-not-run')).toBe(false);
    expect(db.calls.some((call) => call.handler === 'movement-insert-should-not-run')).toBe(false);
  });

  it('throws conflict before movement insert when conditional update fails', async () => {
    const db = createFakeDb([
      {
        name: 'usable-stock-lookup',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ sql }) => {
          expect(sql).toContain("s.qc_status IN ('not_required', 'passed')");
          expect(sql).toContain('date(s.onboard_expires_at) > CURRENT_DATE');
          return { results: [{ id: 1, quantity_available: 2, purchase_price: 50 }] };
        },
      },
      {
        name: 'stale-stock-update',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: () => ({ meta: { changes: 0 } }),
      },
      {
        name: 'movement-insert-should-not-run',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: () => ({ meta: { changes: 1 } }),
      },
    ]);

    await expect(consumeLabConsumableStock(db as any, baseInput)).rejects.toMatchObject({ status: 409 });
    expect(db.calls.some((call) => call.handler === 'movement-insert-should-not-run')).toBe(false);
  });
});

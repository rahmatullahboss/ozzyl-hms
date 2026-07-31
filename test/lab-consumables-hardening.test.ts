import { describe, expect, it } from 'vitest';
import {
  buildCanonicalLabInventoryOperationKey,
  consumeMappedLabConsumables,
  reverseMappedLabConsumablesForOrderItem,
} from '../src/lib/lab-consumables';

type QueryResult = {
  results?: unknown[];
  meta?: { changes?: number; last_row_id?: number };
};

type Handler = {
  name: string;
  match: (sql: string, method: 'all' | 'first' | 'run') => boolean;
  all?: (ctx: { sql: string; args: unknown[] }) => QueryResult;
  first?: (ctx: { sql: string; args: unknown[] }) => unknown;
  run?: (ctx: { sql: string; args: unknown[] }) => QueryResult;
};

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function createFakeDb(handlers: Handler[]) {
  const calls: Array<{ method: 'all' | 'first' | 'run'; sql: string; args: unknown[]; handler?: string }> = [];

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
        async first() {
          const handler = handlers.find((h) => h.first && h.match(normalizedSql, 'first'));
          calls.push({ method: 'first', sql: normalizedSql, args: this.args, handler: handler?.name });
          if (!handler?.first) throw new Error(`Unhandled first query: ${normalizedSql}`);
          return handler.first({ sql: normalizedSql, args: this.args });
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
  labOrderItemId: 55,
  labOrderId: 44,
  labTestId: 33,
};

function mappingHandler(requiredQty = 1): Handler {
  return {
    name: 'mapped-consumables',
    match: (sql, method) => method === 'all' && sql.includes('FROM lab_test_consumable_map'),
    all: () => ({
      results: [
        {
          consumable_id: 99,
          qty_per_test: requiredQty,
          is_mandatory: 1,
          consumable_name: 'CBC Reagent',
          category: 'reagent',
        },
      ],
    }),
  };
}

function multiMappingHandler(): Handler {
  return {
    name: 'multi-mapped-consumables',
    match: (sql, method) => method === 'all' && sql.includes('FROM lab_test_consumable_map'),
    all: () => ({
      results: [
        { consumable_id: 99, qty_per_test: 1, is_mandatory: 1, consumable_name: 'CBC Reagent A', category: 'reagent' },
        { consumable_id: 100, qty_per_test: 1, is_mandatory: 1, consumable_name: 'CBC Reagent B', category: 'reagent' },
      ],
    }),
  };
}

function emptyMappingHandler(): Handler {
  return {
    name: 'empty-mapped-consumables',
    match: (sql, method) => method === 'all' && sql.includes('FROM lab_test_consumable_map'),
    all: () => ({ results: [] }),
  };
}

function noExistingConsumptionHandler(existing = false): Handler {
  return {
    name: 'existing-consumption-check',
    match: (sql, method) => method === 'first' && sql.includes('FROM lab_consumable_movements') && sql.includes("reference_type = 'lab_order_item'"),
    first: () => (existing ? { id: 123 } : null),
  };
}

function operationLogHandler(): Handler {
  return {
    name: 'operation-log-insert',
    match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_operation_logs'),
    run: () => ({ meta: { changes: 1, last_row_id: 500 } }),
  };
}

function consumptionClaimHandler(changes = 1): Handler {
  return {
    name: 'consumption-claim-insert',
    match: (sql, method) => method === 'run' && sql.includes('INSERT OR IGNORE INTO lab_consumable_consumption_claims'),
    run: ({ args }) => {
      expect(args).toEqual([10, 'lab_order_item', 55, 44, 33, 7]);
      return { meta: { changes } };
    },
  };
}

describe('consumeMappedLabConsumables hardening', () => {
  it('builds a deterministic canonical inventory operation key for reagent retries', () => {
    expect(buildCanonicalLabInventoryOperationKey({
      tenantId: 10,
      labOrderItemId: 55,
      inventoryItemId: 500,
      stockId: 10,
      quantity: 1.5000004,
    })).toBe('lab-reagent:10:55:500:10:1.5');
  });

  it('does not use expired or QC-pending lots for mandatory mapped consumables', async () => {
    const db = createFakeDb([
      noExistingConsumptionHandler(false),
      mappingHandler(1),
      {
        name: 'available-stock-with-expiry-filter-contract',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ sql }) => {
          const filtersExpiredLots = sql.includes('s.expiry_date IS NULL') && sql.includes('date(s.expiry_date) > CURRENT_DATE');
          const filtersQcPendingLots = sql.includes("s.qc_status IN ('not_required', 'passed')");
          const filtersOnboardExpiredLots = sql.includes('s.onboard_expires_at IS NULL') && sql.includes('date(s.onboard_expires_at) > CURRENT_DATE');
          return filtersExpiredLots && filtersQcPendingLots && filtersOnboardExpiredLots
            ? { results: [] }
            : { results: [{ id: 1, quantity_available: 1, purchase_price: 100, unit_price: 120, expiry_date: '2020-01-01' }] };
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
      operationLogHandler(),
    ]);

    await expect(consumeMappedLabConsumables(db as any, baseInput)).rejects.toMatchObject({ status: 409 });

    expect(db.calls.some((call) => call.handler === 'stock-update-should-not-run')).toBe(false);
    expect(db.calls.some((call) => call.handler === 'movement-insert-should-not-run')).toBe(false);
  });

  it('deducts from the earliest non-expired expiry lot first', async () => {
    const db = createFakeDb([
      noExistingConsumptionHandler(false),
      mappingHandler(1),
      {
        name: 'available-non-expired-stock',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ sql }) => {
          expect(sql).toContain('date(s.expiry_date) > CURRENT_DATE');
          expect(sql).toContain("s.qc_status IN ('not_required', 'passed')");
          expect(sql).toContain('date(s.onboard_expires_at) > CURRENT_DATE');
          return {
            results: [
              { id: 2, quantity_available: 1, purchase_price: 75, unit_price: 90, expiry_date: '2026-07-01' },
              { id: 3, quantity_available: 1, purchase_price: 80, unit_price: 95, expiry_date: '2026-08-01' },
            ],
          };
        },
      },
      consumptionClaimHandler(),
      {
        name: 'conditional-stock-update',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: ({ sql, args }) => {
          expect(sql).toContain('quantity_available >= ?');
          expect(args).toEqual([1, 2, 10, 1]);
          return { meta: { changes: 1 } };
        },
      },
      {
        name: 'movement-insert',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: ({ args }) => {
          expect(args.slice(0, 5)).toEqual([99, 2, 'usage_out', 1, 75]);
          return { meta: { changes: 1, last_row_id: 200 } };
        },
      },
      operationLogHandler(),
    ]);

    await expect(consumeMappedLabConsumables(db as any, baseInput)).resolves.toEqual({ mappings: 1, quantity: 1, cost: 75 });
  });

  it('does not treat one completed mapping as completion of all mandatory mappings', async () => {
    const db = createFakeDb([
      multiMappingHandler(),
      {
        name: 'projected-by-consumable',
        match: (sql, method) => method === 'all' && sql.includes('SELECT consumable_id') && sql.includes('GROUP BY consumable_id'),
        all: () => ({ results: [{ consumable_id: 99, quantity: 1 }] }),
      },
      {
        name: 'no-inventory-link',
        match: (sql, method) => method === 'first' && sql.includes('SELECT inventory_item_id') && sql.includes('FROM lab_consumables'),
        first: () => ({ inventory_item_id: null }),
      },
      {
        name: 'remaining-stock-only',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ args }) => {
          expect(args[1]).toBe(100);
          return { results: [{ id: 3, quantity_available: 1, purchase_price: 80, unit_price: 95 }] };
        },
      },
      consumptionClaimHandler(),
      {
        name: 'conditional-stock-update',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: ({ args }) => {
          expect(args).toEqual([1, 3, 10, 1]);
          return { meta: { changes: 1 } };
        },
      },
      {
        name: 'remaining-movement-insert',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: ({ args }) => {
          expect(args[0]).toBe(100);
          return { meta: { changes: 1, last_row_id: 201 } };
        },
      },
      operationLogHandler(),
    ]);

    await expect(consumeMappedLabConsumables(db as any, baseInput)).resolves.toEqual({
      mappings: 1,
      quantity: 1,
      cost: 80,
    });
    expect(db.calls.filter((call) => call.handler === 'conditional-stock-update')).toHaveLength(1);
  });

  it('reopens a historical committed claim when mandatory mappings are still partial', async () => {
    const db = createFakeDb([
      multiMappingHandler(),
      {
        name: 'historical-partial-projection',
        match: (sql, method) => method === 'all' && sql.includes('SELECT consumable_id') && sql.includes('GROUP BY consumable_id'),
        all: () => ({ results: [{ consumable_id: 99, quantity: 1 }] }),
      },
      {
        name: 'historical-no-inventory-link',
        match: (sql, method) => method === 'first' && sql.includes('SELECT inventory_item_id') && sql.includes('FROM lab_consumables'),
        first: () => ({ inventory_item_id: null }),
      },
      {
        name: 'historical-remaining-stock',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ args }) => {
          expect(args[1]).toBe(100);
          return { results: [{ id: 4, quantity_available: 1, purchase_price: 85, unit_price: 100 }] };
        },
      },
      consumptionClaimHandler(0),
      {
        name: 'historical-committed-claim',
        match: (sql, method) => method === 'first' && sql.includes('SELECT id, status') && sql.includes('FROM lab_consumable_consumption_claims'),
        first: () => ({ id: 701, status: 'committed' }),
      },
      {
        name: 'reopen-historical-claim',
        match: (sql, method) => method === 'run' && sql.includes('attempt_no = COALESCE(attempt_no, 0) + 1'),
        run: ({ args }) => {
          expect(args).toEqual([701, 10, 'committed']);
          return { meta: { changes: 1 } };
        },
      },
      {
        name: 'historical-stock-update',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: () => ({ meta: { changes: 1 } }),
      },
      {
        name: 'historical-movement-insert',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: () => ({ meta: { changes: 1, last_row_id: 702 } }),
      },
      operationLogHandler(),
      {
        name: 'historical-claim-commit',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_consumption_claims') && sql.includes('SET status = ?'),
        run: () => ({ meta: { changes: 1 } }),
      },
    ]);

    await expect(consumeMappedLabConsumables(db as any, baseInput)).resolves.toEqual({
      mappings: 1,
      quantity: 1,
      cost: 85,
    });
    expect(db.calls.some((call) => call.handler === 'reopen-historical-claim')).toBe(true);
  });

  it('backfills a missing lab projection without deducting canonical inventory twice', async () => {
    const db = createFakeDb([
      mappingHandler(1),
      {
        name: 'empty-projected-by-consumable',
        match: (sql, method) => method === 'all' && sql.includes('SELECT consumable_id') && sql.includes('GROUP BY consumable_id'),
        all: () => ({ results: [] }),
      },
      {
        name: 'inventory-link',
        match: (sql, method) => method === 'first' && sql.includes('SELECT inventory_item_id') && sql.includes('FROM lab_consumables'),
        first: () => ({ inventory_item_id: 500 }),
      },
      {
        name: 'canonical-committed-allocation',
        match: (sql, method) => method === 'all' && sql.includes('FROM InventoryConsumptionItem') && sql.includes('JOIN InventoryConsumption'),
        all: () => ({ results: [{ stock_id: 10, quantity: 1, unit_cost: 75 }] }),
      },
      consumptionClaimHandler(),
      {
        name: 'empty-projected-by-stock',
        match: (sql, method) => method === 'all' && sql.includes('COALESCE(inventory_stock_id, stock_id)') && sql.includes('GROUP BY COALESCE'),
        all: () => ({ results: [] }),
      },
      {
        name: 'projection-movement-insert',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: ({ args }) => {
          expect(args[0]).toBe(99);
          expect(args).toContain(10);
          return { meta: { changes: 1, last_row_id: 202 } };
        },
      },
      operationLogHandler(),
    ]);

    await expect(consumeMappedLabConsumables(db as any, baseInput)).resolves.toEqual({
      mappings: 1,
      quantity: 0,
      cost: 0,
    });
    expect(db.calls.some((call) => call.sql.includes('UPDATE InventoryStock'))).toBe(false);
    expect(db.calls.some((call) => call.sql.includes('INSERT INTO InventoryConsumption'))).toBe(false);
  });

  it('is idempotent for an already-consumed lab order item', async () => {
    const db = createFakeDb([
      noExistingConsumptionHandler(true),
      mappingHandler(1),
      {
        name: 'projected-complete-mapping',
        match: (sql, method) => method === 'all' && sql.includes('SELECT consumable_id') && sql.includes('GROUP BY consumable_id'),
        all: () => ({ results: [{ consumable_id: 99, quantity: 1 }] }),
      },
      {
        name: 'completed-mapping-no-inventory-link',
        match: (sql, method) => method === 'first' && sql.includes('SELECT inventory_item_id') && sql.includes('FROM lab_consumables'),
        first: () => ({ inventory_item_id: null }),
      },
      {
        name: 'stock-lookup-should-not-run',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: () => ({ results: [{ id: 1, quantity_available: 1 }] }),
      },
    ]);

    await expect(consumeMappedLabConsumables(db as any, baseInput)).resolves.toEqual({ mappings: 0, quantity: 0, cost: 0 });

    expect(db.calls.some((call) => call.handler === 'stock-lookup-should-not-run')).toBe(false);
  });

  it('throws before stock deduction when the database consumption claim is already held', async () => {
    const db = createFakeDb([
      noExistingConsumptionHandler(false),
      mappingHandler(1),
      {
        name: 'available-stock',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ sql }) => {
          expect(sql).toContain("s.qc_status IN ('not_required', 'passed')");
          expect(sql).toContain('date(s.onboard_expires_at) > CURRENT_DATE');
          return { results: [{ id: 2, quantity_available: 1, purchase_price: 75, unit_price: 90 }] };
        },
      },
      consumptionClaimHandler(0),
      {
        name: 'stock-update-should-not-run',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: () => ({ meta: { changes: 1 } }),
      },
    ]);

    await expect(consumeMappedLabConsumables(db as any, baseInput)).rejects.toMatchObject({ status: 409 });

    expect(db.calls.some((call) => call.handler === 'stock-update-should-not-run')).toBe(false);
  });

  it('throws when strict policy requires a test-to-reagent mapping but none exists', async () => {
    const db = createFakeDb([
      noExistingConsumptionHandler(false),
      emptyMappingHandler(),
    ]);

    await expect(consumeMappedLabConsumables(db as any, { ...baseInput, requireMapping: true })).rejects.toMatchObject({ status: 409 });
  });

  it('throws when conditional stock update reports no changed rows', async () => {
    const db = createFakeDb([
      noExistingConsumptionHandler(false),
      mappingHandler(1),
      {
        name: 'available-stock',
        match: (sql, method) => method === 'all' && sql.includes('FROM lab_consumable_stock'),
        all: ({ sql }) => {
          expect(sql).toContain("s.qc_status IN ('not_required', 'passed')");
          expect(sql).toContain('date(s.onboard_expires_at) > CURRENT_DATE');
          return { results: [{ id: 2, quantity_available: 1, purchase_price: 75, unit_price: 90 }] };
        },
      },
      consumptionClaimHandler(),
      {
        name: 'stale-conditional-stock-update',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: () => ({ meta: { changes: 0 } }),
      },
      {
        name: 'movement-insert-should-not-run',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: () => ({ meta: { changes: 1 } }),
      },
    ]);

    await expect(consumeMappedLabConsumables(db as any, baseInput)).rejects.toMatchObject({ status: 409 });

    expect(db.calls.some((call) => call.handler === 'movement-insert-should-not-run')).toBe(false);
  });

  it('reverses inventory-backed reagent movements without touching a legacy lab stock row with the same id', async () => {
    const db = createFakeDb([
      {
        name: 'source-linked-reversal-check',
        match: (sql, method) => method === 'all'
          && sql.includes('reverses_movement_id')
          && sql.includes("reference_type = 'lab_order_item_reversal'"),
        all: () => ({ results: [] }),
      },
      {
        name: 'inventory-ledger-usage-movement',
        match: (sql, method) => method === 'all'
          && sql.includes('lab_stock_id')
          && sql.includes('inventory_stock_id')
          && sql.includes("reference_type = 'lab_order_item'"),
        all: () => ({
          results: [
            {
              id: 900,
              consumable_id: 99,
              stock_id: 42,
              lab_stock_id: null,
              inventory_stock_id: 42,
              ledger_type: 'inventory',
              quantity: 2,
              unit_cost: 125,
            },
          ],
        }),
      },
      {
        name: 'legacy-lab-stock-update-should-not-run',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE lab_consumable_stock'),
        run: () => ({ meta: { changes: 1 } }),
      },
      {
        name: 'reversal-guard-delete',
        match: (sql, method) => method === 'run' && sql.includes('DELETE FROM lab_reagent_reversal_guard'),
        run: () => ({ meta: { changes: 1 } }),
      },
      {
        name: 'reversal-guard-assert',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_reagent_reversal_guard'),
        run: () => ({ meta: { changes: 1 } }),
      },
      {
        name: 'canonical-inventory-stock-lookup',
        match: (sql, method) => method === 'first' && sql.includes('FROM InventoryStock'),
        first: ({ args }) => {
          expect(args).toEqual([42, 10]);
          return {
            StockId: 42,
            ItemId: 880,
            StoreId: 5,
            AvailableQuantity: 8,
            BatchNo: 'INV-42',
          };
        },
      },
      {
        name: 'canonical-inventory-return-update',
        match: (sql, method) => method === 'run' && sql.includes('UPDATE InventoryStock'),
        run: ({ args }) => {
          expect(args).toEqual([10, 7, 42, 10, 8]);
          return { meta: { changes: 1 } };
        },
      },
      {
        name: 'inventory-return-ledger-row',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO InventoryStockTransaction'),
        run: ({ args }) => {
          expect(args.slice(0, 5)).toEqual([10, 42, 880, 5, 'LAB-REV-55']);
          return { meta: { changes: 1 } };
        },
      },
      {
        name: 'inventory-audit-row',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO InventoryAuditLog'),
        run: () => ({ meta: { changes: 1 } }),
      },
      {
        name: 'reversal-movement-row',
        match: (sql, method) => method === 'run' && sql.includes('INSERT INTO lab_consumable_movements'),
        run: ({ args }) => {
          expect(args.slice(0, 6)).toEqual([99, 42, null, 42, 'inventory', 2]);
          return { meta: { changes: 1, last_row_id: 901 } };
        },
      },
    ]);
    (db as any).batch = async (statements: Array<{ run: () => Promise<QueryResult> }>) => {
      const results: QueryResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    };

    await expect(reverseMappedLabConsumablesForOrderItem(db as any, {
      tenantId: 10,
      userId: 7,
      labOrderItemId: 55,
      reason: 'cancelled before report finalization',
    })).resolves.toEqual({ reversed: 1, quantity: 2, cost: 250 });

    expect(db.calls.some((call) => call.handler === 'legacy-lab-stock-update-should-not-run')).toBe(false);
  });
});

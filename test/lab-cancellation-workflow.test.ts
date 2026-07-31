import { describe, expect, it } from 'vitest';
import labRoutes from '../src/routes/tenant/lab';
import { getTodayGMT6 } from '../src/lib/date-utils';
import { loadLabOrderItemIdsForInvoiceItems } from '../src/lib/lab-cancellation';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeLabCancelApp(options: { billPaid?: number; closedPeriod?: boolean; reversalFailsOnce?: boolean } = {}) {
  const today = getTodayGMT6();
  let operation: Record<string, unknown> | null = null;
  let reversalFailuresRemaining = options.reversalFailsOnce ? 1 : 0;
  const accountingPeriodCloses: Record<string, unknown>[] = options.closedPeriod
    ? [{
        id: 1,
        tenant_id: '1',
        fiscal_year_id: 1,
        period_name: today.slice(0, 7),
        status: 'closed',
      }]
    : [];
  const mockDB = createMockDB({
    tables: {
      accounting_period_closes: accountingPeriodCloses,
    },
    queryOverride(sql, params) {
      const s = sql.toLowerCase();

      if (options.reversalFailsOnce && s.includes('from lab_consumable_movements') && s.includes("movement_type = 'usage_out'")) {
        return {
          results: [{
            id: 900,
            consumable_id: 99,
            stock_id: 42,
            lab_stock_id: null,
            inventory_stock_id: 42,
            ledger_type: 'inventory',
            quantity: 2,
            unit_cost: 125,
          }],
        };
      }

      if (options.reversalFailsOnce && s.includes('reverses_movement_id') && s.includes("reference_type = 'lab_order_item_reversal'")) {
        return { results: [] };
      }

      if (options.reversalFailsOnce && s.includes('from inventorystock') && s.includes('availablequantity')) {
        return {
          first: {
            StockId: 42,
            ItemId: 880,
            StoreId: 5,
            AvailableQuantity: 8,
            BatchNo: 'INV-42',
          },
        };
      }

      if (s.includes('insert or ignore into lab_cancellation_operations')) {
        if (!operation) {
          operation = {
            id: 901,
            tenant_id: String(params[0]),
            lab_order_item_id: Number(params[1]),
            request_hash: String(params[2]),
            status: 'processing',
            skip_invoice_update: Number(params[3] ?? 0),
            bill_id: params[4] == null ? null : Number(params[4]),
            lab_order_id: Number(params[5]),
            cancelled_amount: Number(params[6] ?? 0),
            reason: String(params[7]),
            notes: params[8] == null ? null : String(params[8]),
            last_error: null,
          };
        }
        return { meta: { changes: 1, last_row_id: 901 } };
      }

      if (s.includes('update lab_cancellation_operations') && s.includes("status = 'core_completed'")) {
        if (operation) operation.status = 'core_completed';
        return { meta: { changes: 1 } };
      }

      if (s.includes('update lab_cancellation_operations') && s.includes("status = 'completed'")) {
        if (operation) operation.status = 'completed';
        return { meta: { changes: 1 } };
      }

      if (s.includes('from lab_cancellation_operations op') && s.includes('join lab_orders lo')) {
        return {
          first: operation ? {
            item_id: 77,
            bill_id: 20,
            lab_order_id: 12,
            cancelled_amount: 5000,
            order_status: 'cancelled',
            new_bill_total: 0,
            operation_date: '2026-01-15',
          } : null,
        };
      }

      if (s.includes('from lab_cancellation_operations') && s.includes('lab_order_item_id')) {
        return { first: operation };
      }

      if (s.includes('from lab_order_items loi') && s.includes('join lab_orders lo')) {
        return {
          first: {
            id: 77,
            status: 'pending',
            lab_order_id: 12,
            lab_test_id: 33,
            line_total: 5000,
            bill_id: 20,
            tenant_id: '1',
          },
        };
      }

      if (s.includes('from invoice_items ii') && s.includes('join bills b')) {
        return {
          results: [{
            id: 501,
            bill_id: 20,
            line_total: 5000,
            bill_paid: options.billPaid ?? 0,
            bill_status: (options.billPaid ?? 0) > 0 ? 'partially_paid' : 'open',
          }],
        };
      }

      if (s.includes('sum(line_total)') && s.includes('from invoice_items')) {
        return { first: { new_total: 0 }, results: [{ new_total: 0 }] };
      }

      if (s.includes('from lab_order_items') && s.includes('active_count')) {
        return { first: { total_count: 1, active_count: 0, done_count: 0 } };
      }

      return null;
    },
  });

  if (options.reversalFailsOnce) {
    const originalBatch = mockDB.db.batch.bind(mockDB.db);
    (mockDB.db as D1Database & { batch: typeof originalBatch }).batch = async (statements) => {
      const isReversalBatch = statements.some((statement) =>
        String((statement as { __sql?: string }).__sql ?? '').includes('lab_reagent_reversal_guard'),
      );
      if (isReversalBatch && reversalFailuresRemaining > 0) {
        reversalFailuresRemaining -= 1;
        throw new Error('forced reagent reversal failure');
      }
      return originalBatch(statements);
    };
  }

  return {
    ...createTestApp({
      route: labRoutes,
      routePath: '/lab',
      role: 'hospital_admin',
      tenantId: '1',
      mockDB,
    }),
    closePeriod() {
      accountingPeriodCloses.push({
        id: 2,
        tenant_id: '1',
        fiscal_year_id: 1,
        period_name: today.slice(0, 7),
        status: 'closed',
      });
    },
  };
}

describe('lab cancellation workflow', () => {
  it('cancels an unpaid lab item across lab, bill, visit, and doctor commission ledgers', async () => {
    const { app, mockDB } = makeLabCancelApp();

    const res = await app.request('/lab/items/77/cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Patient refused this test' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Lab item cancelled',
      itemId: 77,
      billId: 20,
      cancelledAmount: 5000,
    });

    const sql = mockDB.queries.map((query) => query.sql.replace(/\s+/g, ' ').toLowerCase()).join('\n');
    expect(sql).toContain("update lab_order_items set status = 'cancelled'");
    expect(sql).toContain("update doctor_commission_accruals set status = 'cancelled'");
    expect(sql).toContain("update invoice_items set status = 'cancelled'");
    expect(sql).toContain("update visit_services set status = 'cancelled'");
    expect(sql).toContain('update bills set total = (');
    expect(sql).toContain("reference_type = 'lab_order_item'");
    expect(sql).toContain("movement_type = 'usage_out'");
    expect(mockDB.batchCalls.some((batch) =>
      batch.some((statement) => statement.includes('UPDATE invoice_items'))
      && batch.some((statement) => statement.includes('UPDATE bills'))
      && batch.some((statement) => statement.includes('UPDATE lab_order_items'))
      && batch.some((statement) => statement.includes('UPDATE visit_services'))
      && batch.some((statement) => statement.includes('UPDATE doctor_commission_accruals'))
      && batch.some((statement) => statement.includes('UPDATE lab_orders'))
    )).toBe(true);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('billing_item_cancellation')
      && query.params.includes('bill_cancelled')
      && query.params.includes('2026-01-15')
    )).toBe(true);
  });

  it('replays a completed cancellation without running the core batch again', async () => {
    const { app, mockDB } = makeLabCancelApp();
    const request = {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Patient refused this test' }),
    };

    const first = await app.request('/lab/items/77/cancel', request);
    expect(first.status).toBe(200);
    const coreBatchCount = mockDB.batchCalls.filter((batch) =>
      batch.some((statement) => statement.includes('UPDATE lab_order_items')),
    ).length;

    const replay = await app.request('/lab/items/77/cancel', request);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true, itemId: 77 });
    expect(mockDB.batchCalls.filter((batch) =>
      batch.some((statement) => statement.includes('UPDATE lab_order_items')),
    )).toHaveLength(coreBatchCount);
  });

  it('resumes only the reagent reversal after the core cancellation already committed', async () => {
    const { app, mockDB, closePeriod } = makeLabCancelApp({ reversalFailsOnce: true });
    const request = {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Patient refused this test' }),
    };

    const first = await app.request('/lab/items/77/cancel', request);
    expect(first.status).toBe(409);
    const coreBatchCount = mockDB.batchCalls.filter((batch) =>
      batch.some((statement) => statement.includes('UPDATE lab_order_items')),
    ).length;
    expect(coreBatchCount).toBe(1);
    closePeriod();

    const retry = await app.request('/lab/items/77/cancel', request);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ replayed: true, itemId: 77 });
    expect(mockDB.batchCalls.filter((batch) =>
      batch.some((statement) => statement.includes('UPDATE lab_order_items')),
    )).toHaveLength(coreBatchCount);
  });

  it('rejects changed cancellation details after the operation has started', async () => {
    const { app } = makeLabCancelApp();
    const first = await app.request('/lab/items/77/cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Patient refused this test' }),
    });
    expect(first.status).toBe(200);

    const changed = await app.request('/lab/items/77/cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Wrong test selected' }),
    });
    expect(changed.status).toBe(409);
  });

  it('blocks lab item cancellation after the bill has payments', async () => {
    const { app, mockDB } = makeLabCancelApp({ billPaid: 1000 });

    const res = await app.request('/lab/items/77/cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Patient refused this test' }),
    });

    expect(res.status).toBe(409);
    const sql = mockDB.queries.map((query) => query.sql.replace(/\s+/g, ' ').toLowerCase()).join('\n');
    expect(sql).not.toContain("update lab_order_items set status = 'cancelled'");
  });

  it('blocks lab item cancellation in a closed accounting period before bill rows are changed', async () => {
    const { app, mockDB } = makeLabCancelApp({ closedPeriod: true });

    const res = await app.request('/lab/items/77/cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Patient refused this test' }),
    });

    expect(res.status).toBe(409);
    const sql = mockDB.queries.map((query) => query.sql.replace(/\s+/g, ' ').toLowerCase()).join('\n');
    expect(sql).not.toContain("update invoice_items set status = 'cancelled'");
    expect(sql).not.toContain('update bills set total = ?');
  });
});

describe('invoice-item lab cancellation resolution', () => {
  it('resolves billing-counter invoice items through the catalog service-item link', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/UNION ALL/i.test(sql) && /lab_test_catalog ltc/i.test(sql)) {
          return { results: [{ invoice_item_id: 101, lab_order_item_id: 901 }] };
        }
        return null;
      },
    });

    await expect(loadLabOrderItemIdsForInvoiceItems(mockDB.db, {
      tenantId: 'tenant-1',
      invoiceItemIds: [101],
    })).resolves.toEqual([901]);

    const resolverQuery = mockDB.queries.find((query) => /UNION ALL/i.test(query.sql));
    expect(resolverQuery?.sql).toMatch(/ltc\.billing_service_item_id = ii\.reference_id/i);
    expect(resolverQuery?.sql).toMatch(/lo\.bill_id = ii\.bill_id/i);
  });

  it('fails closed when one invoice item resolves to multiple lab order items', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/UNION ALL/i.test(sql) && /lab_test_catalog ltc/i.test(sql)) {
          return { results: [
            { invoice_item_id: 101, lab_order_item_id: 901 },
            { invoice_item_id: 101, lab_order_item_id: 902 },
          ] };
        }
        return null;
      },
    });

    await expect(loadLabOrderItemIdsForInvoiceItems(mockDB.db, {
      tenantId: 'tenant-1',
      invoiceItemIds: [101],
    })).rejects.toThrow(/multiple lab order items|manual review/i);
  });
});

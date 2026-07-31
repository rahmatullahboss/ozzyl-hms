import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import lab from '../src/routes/tenant/lab';
import { consumeLabConsumableStock, consumeMappedLabConsumables } from '../src/lib/lab-consumables';
import { createMockDB } from './integration/helpers/mock-db';

function makeLabApp() {
  const mock = createMockDB({
    universalFallback: true,
    queryOverride(sql) {
      const s = sql.toLowerCase();

      if (s.includes('select loi.*') && s.includes('join lab_orders lo')) {
        return {
          first: {
            id: 11,
            lab_order_id: 22,
            lab_test_id: 33,
            patient_id: 44,
            tenant_id: '1',
            status: 'collected',
            gender: 'male',
            date_of_birth: '1990-01-01',
            normal_range: '10-20',
            critical_low: 5,
            critical_high: 30,
            bill_id: 77,
            bill_status: 'paid',
            bill_total: 50_000,
            bill_paid: 50_000,
          },
        };
      }

      if (s.includes('from lab_consumable_movements') && s.includes("reference_type = 'lab_order_item'")) {
        return { first: null, results: [] };
      }

      if (s.includes('from lab_reference_ranges')) {
        return { first: null, results: [] };
      }

      if (s.includes('from lab_validation_rules')) {
        return { results: [] };
      }

      if (s.includes('from lab_results') && s.includes('order by lr.created_at')) {
        return { first: null, results: [] };
      }

      if (s.includes('select id from lab_reports')) {
        return { first: null };
      }

      if (s.includes('count(*) as total')) {
        return { first: { total: 1, done: 1 } };
      }

      if (s.includes('from lab_' + 'inventory_' + 'policy')) {
        return { first: { reagent_consumption_timing: 'result' } };
      }

      if (s.includes('from lab_test_consumable_map')) {
        return {
          results: [{
            consumable_id: 5,
            qty_per_test: 2,
            is_mandatory: 1,
            consumable_name: 'CBC Reagent',
            category: 'reagent',
          }],
        };
      }

      if (s.includes('update lab_consumable_stock')) {
        return { success: true, meta: { changes: 1 } };
      }

      if (s.includes('from lab_consumable_stock')) {
        return {
          results: [{
            id: 99,
            quantity_available: 5,
            purchase_price: 120,
            unit_price: 100,
          }],
        };
      }

      return null;
    },
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', '1');
    c.set('userId', '9');
    c.set('role', 'lab_tech' as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing',
      ENVIRONMENT: 'test',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lab', lab);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

  return { app, mock };
}

describe('lab consumable automation', () => {
  it('deducts mapped consumables and writes reagent usage logs when a paid lab result is completed', async () => {
    const { app, mock } = makeLabApp();

    const res = await app.request('/lab/items/11/result', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: '15' }),
    });

    expect(res.status).toBe(200);
    expect(mock.queries.some((q) =>
      q.sql.includes('UPDATE lab_consumable_stock')
      && q.params.includes(2)
      && q.params.includes(99)
    )).toBe(true);
    expect(mock.queries.some((q) =>
      q.sql.includes('INSERT INTO lab_consumable_movements')
      && q.params.includes('usage_out')
      && q.params.includes('lab_order_item')
      && q.params.includes(11)
    )).toBe(true);
    expect(mock.queries.some((q) =>
      q.sql.includes('INSERT INTO lab_operation_logs')
      && q.params.includes('reagent_used')
      && q.params.includes(33)
    )).toBe(true);
  });

  it('saves result as draft without changing status to completed or consuming consumables', async () => {
    const { app, mock } = makeLabApp();

    const res = await app.request('/lab/items/11/result', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: '15', is_draft: true }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.draft).toBe(true);
    expect(json.message).toBe('Draft saved');

    // Should NOT update status to 'completed'
    const updateQuery = mock.queries.find((q) =>
      q.sql.includes('UPDATE lab_order_items') && q.sql.includes('result')
    );
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.sql).not.toContain("status = 'completed'");

    // Should NOT consume consumables
    expect(mock.queries.some((q) =>
      q.sql.includes('UPDATE lab_consumable_stock')
    )).toBe(false);
    expect(mock.queries.some((q) =>
      q.sql.includes('INSERT INTO lab_consumable_movements')
    )).toBe(false);

    // Should record workflow event as 'result_draft'
    expect(mock.queries.some((q) =>
      q.sql.includes('INSERT INTO lab_workflow_events')
      && q.params.includes('result_draft')
    )).toBe(true);
  });

  it('deducts linked lab reagent from canonical InventoryStock and records canonical consumption', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();

        if (lower.includes('from lab_' + 'inventory_' + 'policy')) {
          return { first: { reagent_consumption_timing: 'result' } };
        }

        if (lower.includes('select inventory_item_id') && lower.includes('from lab_consumables')) {
          return { first: { inventory_item_id: 7001 } };
        }

        if (lower.includes('from inventorystock')) {
          return {
            results: [{
              id: 301,
              StockId: 301,
              ItemId: 7001,
              StoreId: 12,
              AvailableQuantity: 6,
              CostPrice: 80,
              quantity_available: 6,
              purchase_price: 80,
              ledger_type: 'inventory',
              inventory_item_id: 7001,
              store_id: 12,
              batch_no: 'INV-LOT-1',
              BatchNo: 'INV-LOT-1',
              expiry_date: '2099-12-31',
              ExpiryDate: '2099-12-31',
            }],
          };
        }

        if (lower.includes('update inventorystock')) {
          return { success: true, meta: { changes: 1 } };
        }

        if (sql.includes('INSERT INTO InventoryConsumption')) {
          return { success: true, meta: { last_row_id: 9001, changes: 1 } };
        }

        if (sql.includes('INSERT INTO InventoryConsumptionItem')) {
          return { success: true, meta: { changes: 1 } };
        }

        if (lower.includes('update inventoryconsumption')) {
          return { success: true, meta: { changes: 1 } };
        }

        if (sql.includes('INSERT INTO lab_consumable_movements')) {
          return { success: true, meta: { changes: 1 } };
        }

        return null;
      },
    });

    const result = await consumeLabConsumableStock(mock.db as any, {
      tenantId: '1',
      userId: '9',
      consumableId: 5,
      quantity: 2,
      referenceType: 'lab_order_item',
      referenceId: 501,
      remarks: 'manual analyzer prime',
    });

    expect(result.quantity_used).toBe(2);
    expect(result.cost).toBe(160);
    expect(mock.queries.filter((q) => q.sql.includes('UPDATE InventoryStock')).length).toBe(1);
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_consumable_stock'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO InventoryConsumption'))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO InventoryAuditLog'))).toBe(true);
    expect(mock.queries.some((q) =>
      q.sql.includes('BillingReferenceId')
      && q.params.includes(501)
    )).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO InventoryConsumptionItem'))).toBe(true);
  });


  it('releases automatic consumption claim when stock deduction fails before movement is written', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();

        if (lower.includes('from lab_consumable_movements') && lower.includes("reference_type = 'lab_order_item'")) {
          return { first: null, results: [] };
        }

        if (lower.includes('from lab_test_consumable_map')) {
          return {
            results: [{
              consumable_id: 5,
              qty_per_test: 2,
              is_mandatory: 1,
              consumable_name: 'CBC Reagent',
              category: 'reagent',
            }],
          };
        }

        if (lower.includes('select inventory_item_id') && lower.includes('from lab_consumables')) {
          return { first: { inventory_item_id: null } };
        }

        if (lower.includes('from lab_consumable_stock')) {
          return {
            results: [{ id: 99, quantity_available: 5, purchase_price: 120, unit_price: 100, ledger_type: 'lab' }],
          };
        }

        if (lower.includes('insert or ignore into lab_consumable_consumption_claims')) {
          return { success: true, meta: { changes: 1 } };
        }

        if (lower.includes('update lab_consumable_stock')) {
          return { success: true, meta: { changes: 0 } };
        }

        if (lower.includes('delete from lab_consumable_consumption_claims')) {
          return { success: true, meta: { changes: 1 } };
        }

        return null;
      },
    });

    await expect(consumeMappedLabConsumables(mock.db as any, {
      tenantId: '1',
      userId: '9',
      labOrderItemId: 601,
      labOrderId: 701,
      labTestId: 801,
      machineId: 501,
    })).rejects.toThrow(/stock changed|retry/i);

    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lab_consumable_movements'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_consumable_consumption_claims') && q.sql.includes('status = ?'))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('DELETE FROM lab_consumable_consumption_claims'))).toBe(true);
  });

  it('prefers analyzer-assigned InventoryStock when machine context is provided', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();

        if (lower.includes('from lab_consumable_movements') && lower.includes("reference_type = 'lab_order_item'")) {
          return { first: null, results: [] };
        }

        if (lower.includes('from lab_test_consumable_map')) {
          return {
            results: [{
              consumable_id: 5,
              qty_per_test: 2,
              is_mandatory: 1,
              consumable_name: 'CBC Reagent',
              category: 'reagent',
            }],
          };
        }

        if (lower.includes('select inventory_item_id') && lower.includes('from lab_consumables')) {
          return { first: { inventory_item_id: 7001 } };
        }

        if (lower.includes('from inventorystock')) {
          return {
            results: [{
              id: 301,
              StockId: 301,
              ItemId: 7001,
              StoreId: 12,
              AvailableQuantity: 6,
              CostPrice: 80,
              quantity_available: 6,
              purchase_price: 80,
              ledger_type: 'inventory',
              inventory_item_id: 7001,
              store_id: 12,
              batch_no: 'INV-LOT-1',
              BatchNo: 'INV-LOT-1',
              expiry_date: '2099-12-31',
              ExpiryDate: '2099-12-31',
            }],
          };
        }

        if (lower.includes('update inventorystock')) return { success: true, meta: { changes: 1 } };
        if (sql.includes('INSERT INTO InventoryConsumption')) return { success: true, meta: { last_row_id: 9001, changes: 1 } };
        if (sql.includes('INSERT INTO InventoryConsumptionItem')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('update inventoryconsumption')) return { success: true, meta: { changes: 1 } };
        if (sql.includes('INSERT INTO lab_consumable_movements')) return { success: true, meta: { changes: 1 } };

        return null;
      },
    });

    const result = await consumeMappedLabConsumables(mock.db as any, {
      tenantId: '1',
      userId: '9',
      labOrderItemId: 601,
      labOrderId: 701,
      labTestId: 801,
      machineId: 501,
    });

    expect(result).toMatchObject({ mappings: 1, quantity: 2, cost: 160 });
    const mappingQuery = mock.queries.find((q) => q.sql.includes('FROM lab_test_consumable_map'));
    expect(mappingQuery?.sql).toContain('COALESCE(m.is_active, 1) = 1');
    expect(mappingQuery?.sql).toContain('m.effective_to IS NULL');

    const stockQuery = mock.queries.find((q) => q.sql.includes('FROM InventoryStock'));
    expect(stockQuery?.sql).toContain('lab_reagent_analyzer_assignments');
    expect(stockQuery?.params.filter((param) => param === 501)).toHaveLength(2);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO InventoryConsumption'))).toBe(true);
  });

});

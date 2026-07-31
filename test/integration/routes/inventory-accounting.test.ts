import { describe, expect, it } from 'vitest';
import inventoryAccountingRoutes from '../../../src/routes/tenant/inventoryAccounting';
import { createTestApp, jsonRequest } from '../helpers/test-app';

describe('inventory accounting routes', () => {
  const closedPeriodRow = (periodName: string) => ({
    id: 1,
    tenant_id: 'tenant-1',
    fiscal_year_id: 1,
    period_name: periodName,
    status: 'closed',
  });

  it('restricts unposted accounting worklist to accounting roles', async () => {
    const { app } = createTestApp({
      route: inventoryAccountingRoutes,
      routePath: '/inventory-accounting',
      role: 'receptionist',
    });

    const res = await jsonRequest(app, '/inventory-accounting/unposted');

    expect(res.status).toBe(403);
  });

  it('queries goods receipts by explicit accounting-posted status', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryAccountingRoutes,
      routePath: '/inventory-accounting',
      role: 'accountant',
      tables: { inventorygoodsreceipt: [] },
    });

    const res = await jsonRequest(app, '/inventory-accounting/unposted');

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('InventoryGoodsReceipt')
      && query.sql.includes('IsPostedToAcc')
      && query.sql.includes('IsActive')
    )).toBe(true);
  });

  it('rejects goods receipt accounting posting in a closed period before event or flag writes', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryAccountingRoutes,
      routePath: '/inventory-accounting',
      role: 'accountant',
      tables: {
        inventorygoodsreceipt: [{
          GoodsReceiptId: 44,
          tenant_id: 'tenant-1',
          GRDate: '2026-04-18',
          VendorId: 3,
          TotalAmount: 900,
          PaymentMode: 'credit',
          IsPostedToAcc: 0,
          IsActive: 1,
        }],
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/inventory-accounting/post', {
      method: 'POST',
      body: { goodsReceiptId: 44, vendorId: 999, totalAmount: 1 },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /UPDATE InventoryGoodsReceipt SET IsPostedToAcc = 1/i.test(q.sql))).toBe(false);
  });

  it('does not manually mark a goods receipt posted without a verified accounting voucher', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryAccountingRoutes,
      routePath: '/inventory-accounting',
      role: 'accountant',
      tables: {
        inventorygoodsreceipt: [{
          GoodsReceiptId: 45,
          tenant_id: 'tenant-1',
          GRDate: '2026-05-05',
          IsPostedToAcc: 0,
          IsActive: 1,
        }],
        accounting_vouchers: [],
      },
    });

    const res = await jsonRequest(app, '/inventory-accounting/mark-posted/45', { method: 'PUT' });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /UPDATE InventoryGoodsReceipt SET IsPostedToAcc = 1/i.test(q.sql))).toBe(false);
  });

  it('rejects manual goods receipt posted sync in a closed period before checking voucher state', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryAccountingRoutes,
      routePath: '/inventory-accounting',
      role: 'accountant',
      tables: {
        inventorygoodsreceipt: [{
          GoodsReceiptId: 46,
          tenant_id: 'tenant-1',
          GRDate: '2026-04-25',
          IsPostedToAcc: 0,
          IsActive: 1,
        }],
        accounting_vouchers: [{
          id: 90,
          tenant_id: 'tenant-1',
          source_type: 'inventory_gr',
          source_id: '46',
          event_type: 'inventory_purchase',
          status: 'verified',
        }],
        accounting_period_closes: [closedPeriodRow('2026-04')],
      },
    });

    const res = await jsonRequest(app, '/inventory-accounting/mark-posted/46', { method: 'PUT' });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((q) => /UPDATE InventoryGoodsReceipt SET IsPostedToAcc = 1/i.test(q.sql))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import permissionRoutes from '../../../../src/routes/tenant/permissions';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

const goodsReceiptBody = {
  VendorId: 1,
  StoreId: 1,
  GRDate: '2026-07-08',
  PaymentMode: 'cash' as const,
  CreditPeriod: 0,
  Items: [
    {
      ItemId: 1,
      ReceivedQuantity: 5,
      FreeQuantity: 0,
      RejectedQuantity: 0,
      ItemRate: 100,
      BatchNo: 'SEC-GR-001',
      ExpiryDate: '2027-12-31',
      VATPercent: 0,
      DiscountPercent: 0,
    },
  ],
};

const transferBody = {
  FromStoreId: 1,
  ToStoreId: 2,
  Items: [{ ItemId: 1, StockId: 10, Quantity: 1 }],
};

const directAdjustmentBody = {
  StoreId: 1,
  Remarks: 'Security regression test',
  Items: [
    {
      ItemId: 1,
      StoreId: 1,
      StockId: 10,
      Quantity: 1,
      AdjustmentType: 'add',
      BatchNo: 'SEC-ADJ-001',
      Remarks: 'Direct stock adjustment should require inventory:adjust',
    },
  ],
};

function expectForbiddenWithoutHandlerWork(status: number, queries: Array<{ sql: string }>, forbiddenTable: string) {
  expect(status).toBe(403);
  expect(queries.some((query) => query.sql.includes(forbiddenTable))).toBe(false);
}

describe('Inventory — backend API permission guards', () => {
  it('blocks stock overview without inventory:read before returning stock data', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
      queryOverride: (sql) => {
        if (sql.includes('COUNT(*) as total')) return { first: { total: 1 } };
        if (sql.includes('FROM InventoryStock S') && sql.includes('ORDER BY I.ItemName ASC')) {
          return {
            results: [
              {
                StockId: 10,
                ItemId: 1,
                ItemName: 'Protected stock row',
                ItemCode: 'SEC-001',
                ItemType: 'medicine',
                StoreName: 'Main Store',
                BatchNo: 'SEC-BATCH',
                AvailableQuantity: 5,
                CostPrice: 100,
                ReOrderLevel: 2,
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/inventory/stock/overview');

    expectForbiddenWithoutHandlerWork(res.status, mockDB.queries, 'FROM InventoryStock S');
  });

  it('blocks goods receipt creation without inventory:write', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/gr', {
      method: 'POST',
      body: goodsReceiptBody,
    });

    expectForbiddenWithoutHandlerWork(res.status, mockDB.queries, 'INSERT INTO InventoryGoodsReceipt');
  });

  it('blocks stock transfer creation without inventory:transfer', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/transfers', {
      method: 'POST',
      body: transferBody,
    });

    expectForbiddenWithoutHandlerWork(res.status, mockDB.queries, 'INSERT INTO InventoryTransfer');
  });

  it('blocks adjustment approval without inventory:approve', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/1/approve', {
      method: 'POST',
      body: { Remarks: 'Should not reach approval handler' },
    });

    expectForbiddenWithoutHandlerWork(res.status, mockDB.queries, 'FROM InventoryAdjustmentRequest WHERE');
  });

  it('blocks direct stock adjustment without inventory:adjust', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/stock/adjustment', {
      method: 'POST',
      body: directAdjustmentBody,
    });

    expectForbiddenWithoutHandlerWork(res.status, mockDB.queries, 'UPDATE InventoryStock');
  });
});

describe('Access control — backend API permission guards', () => {
  it('blocks access control catalog without roles:manage', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await app.request('/permissions/catalog');
    const body = await res.json() as { error: string };

    expect(res.status).toBe(403);
    expect(body.error).toContain('Missing permission: roles:manage');
  });
});

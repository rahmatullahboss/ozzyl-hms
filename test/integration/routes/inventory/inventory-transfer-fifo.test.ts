import { describe, expect, it } from 'vitest';
import transferRoute from '../../../../src/routes/tenant/inventory/transfers';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — transfer FIFO allocation', () => {
  it('creates transfer draft with FEFO allocation when StockId is omitted', async () => {
    const { app, mockDB } = createTestApp({
      route: transferRoute,
      routePath: '/transfers',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        // FEFO path: query all available stock for item/store
        if (sql.includes('FROM InventoryStock') && sql.includes('ItemId = ?') && sql.includes('StoreId = ?') && !sql.includes('StockId = ?')) {
          return {
            results: [
              { StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 3, BatchNo: 'B1', ExpiryDate: '2027-06-01', CostPrice: 10, MRP: 15, IsActive: 1 },
              { StockId: 11, ItemId: 5, StoreId: 1, AvailableQuantity: 8, BatchNo: 'B2', ExpiryDate: '2027-12-01', CostPrice: 10, MRP: 15, IsActive: 1 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/transfers', {
      method: 'POST',
      body: {
        FromStoreId: 1,
        ToStoreId: 2,
        Items: [{ ItemId: 5, Quantity: 5 }], // No StockId — FEFO
      },
    });

    expect(res.status).toBe(201);
    // Should create transfer items for multiple batches (B1=3 + B2=2)
    const transferItems = mockDB.queries.filter(q =>
      q.sql.includes('INSERT INTO InventoryTransferItem'),
    );
    expect(transferItems.length).toBeGreaterThanOrEqual(2);
    // First batch should be B1 (earliest expiry)
    expect(transferItems[0].params).toContain('B1');
  });

  it('still allows explicit StockId to bypass FEFO', async () => {
    const { app, mockDB } = createTestApp({
      route: transferRoute,
      routePath: '/transfers',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 20,
              BatchNo: 'B1', ExpiryDate: '2027-06-01', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/transfers', {
      method: 'POST',
      body: {
        FromStoreId: 1,
        ToStoreId: 2,
        Items: [{ ItemId: 5, StockId: 10, Quantity: 5 }],
      },
    });

    expect(res.status).toBe(201);
    const transferItems = mockDB.queries.filter(q =>
      q.sql.includes('INSERT INTO InventoryTransferItem'),
    );
    expect(transferItems.length).toBe(1);
    expect(transferItems[0].params).toContain(10);
  });

  it('rejects when FEFO cannot satisfy full quantity across batches', async () => {
    const { app } = createTestApp({
      route: transferRoute,
      routePath: '/transfers',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('ItemId = ?') && sql.includes('StoreId = ?') && !sql.includes('StockId = ?')) {
          return {
            results: [
              { StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 2, BatchNo: 'B1', ExpiryDate: '2027-06-01', CostPrice: 10, MRP: 15, IsActive: 1 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/transfers', {
      method: 'POST',
      body: {
        FromStoreId: 1,
        ToStoreId: 2,
        Items: [{ ItemId: 5, Quantity: 10 }], // Need 10, only 2 available
      },
    });

    expect(res.status).toBe(400);
  });
});

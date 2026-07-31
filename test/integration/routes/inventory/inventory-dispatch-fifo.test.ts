import { describe, expect, it } from 'vitest';
import dispatchRoute from '../../../../src/routes/tenant/inventory/dispatch';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — dispatch FIFO multi-batch allocation', () => {
  it('splits dispatch across multiple batches when single batch is insufficient', async () => {
    const { app, mockDB } = createTestApp({
      route: dispatchRoute,
      routePath: '/dispatch',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql, params) => {
        // When querying all available stock for an item (FEFO path - no StockId)
        if (sql.includes('FROM InventoryStock') && sql.includes('ItemId = ?') && sql.includes('StoreId = ?') && !sql.includes('StockId = ?')) {
          return {
            results: [
              { StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 3, BatchNo: 'B1', ExpiryDate: '2027-06-01', CostPrice: 10, MRP: 15, IsActive: 1 },
              { StockId: 11, ItemId: 5, StoreId: 1, AvailableQuantity: 5, BatchNo: 'B2', ExpiryDate: '2027-12-01', CostPrice: 10, MRP: 15, IsActive: 1 },
              { StockId: 12, ItemId: 5, StoreId: 1, AvailableQuantity: 4, BatchNo: 'B3', ExpiryDate: '2027-06-01', CostPrice: 12, MRP: 18, IsActive: 1 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/dispatch', {
      method: 'POST',
      body: {
        SourceStoreId: 1,
        DestinationStoreId: 2,
        Items: [{ ItemId: 5, DispatchedQuantity: 7 }], // No StockId — should use FEFO
      },
    });

    expect(res.status).toBe(201);
    // Should create dispatch items for multiple batches (B1=3 + B2=4 from B2's 5)
    const dispatchItems = mockDB.queries.filter(q =>
      q.sql.includes('INSERT INTO InventoryDispatchItem'),
    );
    expect(dispatchItems.length).toBeGreaterThanOrEqual(2);
    // First batch should be B1 (earliest expiry)
    expect(dispatchItems[0].params).toContain('B1');
    // Should deduct from multiple stock rows
    const deductions = mockDB.queries.filter(q =>
      q.sql.includes('UPDATE InventoryStock SET AvailableQuantity = AvailableQuantity - ?'),
    );
    expect(deductions.length).toBeGreaterThanOrEqual(2);
  });

  it('uses single batch when it has sufficient quantity', async () => {
    const { app, mockDB } = createTestApp({
      route: dispatchRoute,
      routePath: '/dispatch',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('ItemId = ?') && sql.includes('StoreId = ?') && !sql.includes('StockId = ?')) {
          return {
            results: [
              { StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 20, BatchNo: 'B1', ExpiryDate: '2027-06-01', CostPrice: 10, MRP: 15, IsActive: 1 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/dispatch', {
      method: 'POST',
      body: {
        SourceStoreId: 1,
        DestinationStoreId: 2,
        Items: [{ ItemId: 5, DispatchedQuantity: 5 }],
      },
    });

    expect(res.status).toBe(201);
    const dispatchItems = mockDB.queries.filter(q =>
      q.sql.includes('INSERT INTO InventoryDispatchItem'),
    );
    expect(dispatchItems.length).toBe(1);
  });

  it('still allows explicit StockId to bypass FEFO', async () => {
    const { app, mockDB } = createTestApp({
      route: dispatchRoute,
      routePath: '/dispatch',
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

    const res = await jsonRequest(app, '/dispatch', {
      method: 'POST',
      body: {
        SourceStoreId: 1,
        DestinationStoreId: 2,
        Items: [{ ItemId: 5, StockId: 10, DispatchedQuantity: 5 }],
      },
    });

    expect(res.status).toBe(201);
    const dispatchItems = mockDB.queries.filter(q =>
      q.sql.includes('INSERT INTO InventoryDispatchItem'),
    );
    expect(dispatchItems.length).toBe(1);
    expect(dispatchItems[0].params).toContain(10); // Uses specified StockId
  });
});

import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — issue edge cases', () => {
  it('rejects issuing more than available quantity', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 3,
              BatchNo: 'B1', ExpiryDate: '2027-12-31', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return {
            first: {
              ItemId: 5, ItemName: 'Test Item', StandardRate: 10,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        ToDepartment: 'Lab',
        Items: [{ ItemId: 5, StockId: 10, Quantity: 10 }],
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error || body.message).toMatch(/insufficient|available|quantity/i);
  });

  it('rejects cross-store stock access', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 2, AvailableQuantity: 20,
              BatchNo: 'B1', ExpiryDate: '2027-12-31', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return {
            first: {
              ItemId: 5, ItemName: 'Test Item', StandardRate: 10,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        ToDepartment: 'Lab',
        Items: [{ ItemId: 5, StockId: 10, Quantity: 2 }],
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(String(body.error || body.message)).toMatch(/store|belongs|mismatch/i);
  });

  it('rejects issue with empty items array', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        ToDepartment: 'Lab',
        Items: [],
      },
    });

    expect(res.status).toBe(400);
  });

  it('rejects more than 50 input items before inventory processing', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Items: Array.from({ length: 51 }, (_, index) => ({
          ItemId: index + 1,
          StockId: index + 1,
          Quantity: 1,
        })),
      },
    });

    expect(res.status).toBe(400);
    expect(mockDB.queries.some((query) => query.sql.includes('inventory_issue_operation'))).toBe(false);
  });

  it('rejects requests that resolve to more than 75 stock allocations', async () => {
    const stockRows = Array.from({ length: 76 }, (_, index) => ({
      StockId: index + 1,
      ItemId: 5,
      StoreId: 1,
      AvailableQuantity: 1,
      ReservedQuantity: 0,
      DamagedQuantity: 0,
      BlockedQuantity: 0,
      BatchNo: `LOT-${index + 1}`,
      ExpiryDate: '2027-12-31',
      CostPrice: 10,
      IsActive: 1,
      StockStatus: 'available',
      QCStatus: 'accepted',
    }));
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && !sql.includes('StockId = ?')) {
          return { results: stockRows };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 5, ItemName: 'High Allocation Item', StandardRate: 10 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Items: [{ ItemId: 5, Quantity: 76 }],
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(String(body.error || body.message)).toMatch(/75 stock allocations/i);
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('accepts lab consumption with fractional quantity and lab-order-item billing reference', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 3.5,
              BatchNo: 'LAB-FRAC', ExpiryDate: '2027-12-31', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 5, ItemName: 'Fractional Reagent', StandardRate: 10, IssueUnit: 'mL' } };
        }
        if (sql.includes('UPDATE InventoryStock')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'lab_consumption',
        FromStoreId: 1,
        ToDepartment: 'Lab',
        LabOrderId: 22,
        BillingReferenceId: 11,
        Items: [{ ItemId: 5, StockId: 10, Quantity: 1.5 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT INTO InventoryConsumption')
      && q.sql.includes('BillingReferenceId')
      && q.params.includes(11)
    )).toBe(true);
    expect(mockDB.queries.some((q) =>
      q.sql.includes('UPDATE InventoryStock')
      && q.params.includes(1.5)
    )).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(true);
  });

  it('commits stock update, issue line, ledger and audit in one D1 batch', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 10,
              ReservedQuantity: 0, DamagedQuantity: 0, BlockedQuantity: 0,
              BatchNo: 'ATOMIC-LOT', ExpiryDate: '2027-12-31', CostPrice: 10, IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 5, ItemName: 'Atomic Item', StandardRate: 10 } };
        }
        if (sql.includes('UPDATE InventoryStock')) return { success: true, meta: { changes: 1 } };
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Items: [{ ItemId: 5, StockId: 10, Quantity: 2 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.batchCalls.some((batch) =>
      batch.some((sql) => sql.includes('UPDATE InventoryStock'))
      && batch.some((sql) => sql.includes('INSERT INTO InventoryConsumptionItem'))
      && batch.some((sql) => sql.includes('INSERT INTO InventoryStockTransaction'))
      && batch.some((sql) => sql.includes('INSERT INTO InventoryAuditLog'))
    )).toBe(true);
  });

  it('writes canonical available balance to the stock ledger when some quantity is reserved', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 100,
              ReservedQuantity: 10, DamagedQuantity: 0, BlockedQuantity: 0,
              BatchNo: 'RESERVED-LOT', ExpiryDate: '2027-12-31', CostPrice: 10, IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 5, ItemName: 'Reserved Item', StandardRate: 10 } };
        }
        if (sql.includes('UPDATE InventoryStock')) return { success: true, meta: { changes: 1 } };
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        ToDepartment: 'Lab',
        Items: [{ ItemId: 5, StockId: 10, Quantity: 20 }],
      },
    });

    expect(res.status).toBe(201);
    const ledgerInsert = mockDB.queries.find((q) => q.sql.includes('INSERT INTO InventoryStockTransaction'));
    expect(ledgerInsert?.params[9]).toBe(80);
  });

  it('rejects an issue when reservation state changed after allocation', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 10,
              ReservedQuantity: 2, DamagedQuantity: 0, BlockedQuantity: 0,
              BatchNo: 'RESERVE-RACE', ExpiryDate: '2027-12-31', CostPrice: 10, IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 5, ItemName: 'Reservation Race', StandardRate: 10 } };
        }
        if (sql.includes('UPDATE InventoryStock')) {
          return { success: true, meta: { changes: sql.includes('COALESCE(ReservedQuantity, 0) = ?') ? 0 : 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Items: [{ ItemId: 5, StockId: 10, Quantity: 2 }],
      },
    });

    expect(res.status).toBe(409);
  });

  it('rejects stale stock updates without writing issue lines or stock transactions', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 3,
              BatchNo: 'RACE-LOT', ExpiryDate: '2027-12-31', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 5, ItemName: 'Race Reagent', StandardRate: 10, IssueUnit: 'mL' } };
        }
        if (sql.includes('UPDATE InventoryStock')) {
          return { success: true, meta: { changes: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'lab_consumption',
        FromStoreId: 1,
        ToDepartment: 'Lab',
        Items: [{ ItemId: 5, StockId: 10, Quantity: 1 }],
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(String(body.error || body.message)).toMatch(/stock changed|refresh|retry/i);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO InventoryConsumptionItem'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(false);
  });
});

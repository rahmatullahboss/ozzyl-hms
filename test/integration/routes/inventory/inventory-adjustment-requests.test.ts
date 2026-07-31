import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — adjustment requests', () => {
  it('creates an adjustment request and records current vs new quantity', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              AvailableQuantity: 50,
              BatchNo: 'BATCH-A',
              IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests', {
      method: 'POST',
      body: {
        StoreId: 1,
        Reason: 'Physical count discrepancy',
        Items: [
          { ItemId: 10, StockId: 42, NewQuantity: 45, Remarks: 'Found 5 damaged' },
        ],
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.AdjustmentNo).toMatch(/^ADJ-/);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAdjustmentRequest'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAdjustmentRequestItem'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('stock_adjustment_requested'))).toBe(true);
  });

  it('approval updates stock and writes adjustment ledger entries', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryAdjustmentRequest WHERE') && sql.includes('AdjustmentRequestId = ?')) {
          return {
            first: {
              AdjustmentRequestId: 1,
              AdjustmentNo: 'ADJ-1',
              StoreId: 1,
              Status: 'submitted',
              Reason: 'Count discrepancy',
            },
          };
        }
        if (sql.includes('FROM InventoryAdjustmentRequestItem WHERE')) {
          return {
            results: [
              { AdjustmentRequestItemId: 1, AdjustmentRequestId: 1, ItemId: 10, StockId: 42, BatchNo: 'BATCH-A', CurrentQuantity: 50, NewQuantity: 45 },
            ],
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              AvailableQuantity: 50,
              BatchNo: 'BATCH-A',
            },
          };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/1/approve', {
      method: 'POST',
      body: { Remarks: 'Verified by supervisor' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.Status).toBe('posted');
    expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryStock SET AvailableQuantity'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('adjustment_minus'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes("Status = 'posted'"))).toBe(true);
  });

  it('rejection marks request as rejected without changing stock', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryAdjustmentRequest WHERE')) {
          return { first: { AdjustmentRequestId: 2, Status: 'submitted', StoreId: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/2/reject', {
      method: 'POST',
      body: { Remarks: 'Insufficient evidence' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.Status).toBe('rejected');
    expect(mockDB.queries.some(q => q.sql.includes("Status = 'rejected'"))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryStock'))).toBe(false);
  });

  it('blocks approval from user without inventory:approve permission', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/1/approve', {
      method: 'POST',
      body: { Remarks: 'test' },
    });

    expect(res.status).toBe(403);
  });

  it('approval posts accounting events for adjustment-out (consumption)', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryAdjustmentRequest WHERE') && sql.includes('AdjustmentRequestId = ?')) {
          return {
            first: {
              AdjustmentRequestId: 5,
              AdjustmentNo: 'ADJ-5',
              StoreId: 1,
              Status: 'submitted',
              Reason: 'Damaged goods',
            },
          };
        }
        if (sql.includes('FROM InventoryAdjustmentRequestItem WHERE')) {
          return {
            results: [
              { AdjustmentRequestItemId: 1, AdjustmentRequestId: 5, ItemId: 10, StockId: 42, BatchNo: 'BATCH-A', CurrentQuantity: 50, NewQuantity: 40 },
            ],
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              AvailableQuantity: 50,
              BatchNo: 'BATCH-A',
              CostPrice: 25,
            },
          };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/5/approve', {
      method: 'POST',
      body: { Remarks: 'Verified damaged' },
    });

    expect(res.status).toBe(200);
    const hasAccountingEventInsert = mockDB.queries.some(
      (q) => q.sql.includes('INSERT') && q.sql.includes('accounting_posting_events'),
    );
    expect(hasAccountingEventInsert).toBe(true);
    const eventQuery = mockDB.queries.find(
      (q) => q.sql.includes('INSERT') && q.sql.includes('accounting_posting_events'),
    );
    expect(eventQuery?.params).toContain('inventory_consumption');
    expect(eventQuery?.params).toContain('inventory_adjustment_request');
  });

  it('approval posts accounting events for adjustment-in (purchase)', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryAdjustmentRequest WHERE') && sql.includes('AdjustmentRequestId = ?')) {
          return {
            first: {
              AdjustmentRequestId: 6,
              AdjustmentNo: 'ADJ-6',
              StoreId: 1,
              Status: 'submitted',
              Reason: 'Found extra stock',
            },
          };
        }
        if (sql.includes('FROM InventoryAdjustmentRequestItem WHERE')) {
          return {
            results: [
              { AdjustmentRequestItemId: 2, AdjustmentRequestId: 6, ItemId: 10, StockId: 42, BatchNo: 'BATCH-A', CurrentQuantity: 50, NewQuantity: 60 },
            ],
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              AvailableQuantity: 50,
              BatchNo: 'BATCH-A',
              CostPrice: 15,
            },
          };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/6/approve', {
      method: 'POST',
      body: { Remarks: 'Found during recount' },
    });

    expect(res.status).toBe(200);
    const hasAccountingEventInsert = mockDB.queries.some(
      (q) => q.sql.includes('INSERT') && q.sql.includes('accounting_posting_events'),
    );
    expect(hasAccountingEventInsert).toBe(true);
    const eventQuery = mockDB.queries.find(
      (q) => q.sql.includes('INSERT') && q.sql.includes('accounting_posting_events'),
    );
    expect(eventQuery?.params).toContain('inventory_purchase');
    expect(eventQuery?.params).toContain('inventory_adjustment_request');
  });

  it('rejects adjustment approval when stock changed after request creation', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryAdjustmentRequest WHERE') && sql.includes('AdjustmentRequestId = ?')) {
          return { first: { AdjustmentRequestId: 9, AdjustmentNo: 'ADJ-9', StoreId: 1, Status: 'submitted', Reason: 'Race condition proof' } };
        }
        if (sql.includes('FROM InventoryAdjustmentRequestItem WHERE')) {
          return { results: [{ AdjustmentRequestItemId: 1, AdjustmentRequestId: 9, ItemId: 10, StockId: 42, BatchNo: 'BATCH-A', CurrentQuantity: 50, NewQuantity: 45 }] };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return { first: { StockId: 42, ItemId: 10, StoreId: 1, AvailableQuantity: 49, BatchNo: 'BATCH-A', CostPrice: 25 } };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity')) {
          return { success: true, meta: { changes: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/9/approve', {
      method: 'POST',
      body: { Remarks: 'Stale request should fail' },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some(q => q.sql.includes("Status = 'posted'"))).toBe(false);
  });

  it('rejects direct stock adjustment when stock changed before ledger posting', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('SELECT * FROM InventoryStock WHERE StockId = ?')) {
          return { first: { StockId: 42, ItemId: 10, StoreId: 1, AvailableQuantity: 50, BatchNo: 'BATCH-A', CostPrice: 25, IsActive: 1 } };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity = ?')) {
          return { success: true, meta: { changes: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/stock/adjustment', {
      method: 'POST',
      body: {
        StoreId: 1,
        Items: [{ ItemId: 10, StockId: 42, AdjustmentType: 'subtract', Quantity: 5 }],
      },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some(q => q.sql.includes('accounting_posting_events'))).toBe(false);
  });

  it('keeps direct stock adjustment quantity update inside the ledger batch', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('SELECT * FROM InventoryStock WHERE StockId = ?')) {
          return { first: { StockId: 42, ItemId: 10, StoreId: 1, AvailableQuantity: 50, BatchNo: 'BATCH-A', CostPrice: 25, IsActive: 1 } };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity = ?')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });
    mockDB.db.batch = async () => {
      throw new Error('ledger batch failed');
    };

    const res = await jsonRequest(app, '/inventory/stock/adjustment', {
      method: 'POST',
      body: {
        StoreId: 1,
        Items: [{ ItemId: 10, StockId: 42, AdjustmentType: 'subtract', Quantity: 5 }],
      },
    });

    expect(res.status).toBe(500);
    expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryStock SET AvailableQuantity = ?'))).toBe(false);
  });

  it('rejects stock count approval when stock changed after count entry', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStockCountSession WHERE')) {
          return { first: { CountSessionId: 7, CountNo: 'CNT-7', StoreId: 1, Status: 'submitted' } };
        }
        if (sql.includes('FROM InventoryStockCountItem WHERE')) {
          return { results: [{ CountItemId: 1, CountSessionId: 7, ItemId: 10, StockId: 42, BatchNo: 'BATCH-A', SystemQuantity: 50, CountedQuantity: 45 }] };
        }
        if (sql.includes('FROM InventoryStock WHERE tenant_id = ? AND StockId = ?')) {
          return { first: { StockId: 42, ItemId: 10, StoreId: 1, AvailableQuantity: 49, BatchNo: 'BATCH-A', CostPrice: 25 } };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity = ?')) {
          return { success: true, meta: { changes: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/count-sessions/7/approve', {
      method: 'POST',
      body: { Remarks: 'stale count' },
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some(q => q.sql.includes("Status = 'approved'"))).toBe(false);
  });

  it('blocks transfer send from user without inventory:transfer permission', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/transfers/1/send', {
      method: 'POST',
      body: {},
    });

    expect(res.status).toBe(403);
  });

  it('blocks issue creation from user without inventory:consume permission', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'reception',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Department: 'Lab',
        Items: [{ ItemId: 1, Quantity: 1 }],
      },
    });

    expect(res.status).toBe(403);
  });

  it('allows hospital_admin full access to all inventory operations', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 1, ItemId: 1, StoreId: 1, AvailableQuantity: 100,
              BatchNo: 'B1', ExpiryDate: '2027-12-31', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/transfers', {
      method: 'POST',
      body: {
        FromStoreId: 1, ToStoreId: 2,
        Items: [{ ItemId: 1, StockId: 1, Quantity: 5 }],
      },
    });

    expect(res.status).toBe(201);
  });
});

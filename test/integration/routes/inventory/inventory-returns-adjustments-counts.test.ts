import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — returns, adjustment approvals, and stock counts', () => {
  it('records a department return, restores usable stock, and writes ledger plus audit rows', async () => {
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
              StockId: 51,
              ItemId: 77,
              StoreId: 1,
              AvailableQuantity: 8,
              BatchNo: 'CAN-2026',
              ExpiryDate: '2027-01-01',
              CostPrice: 30,
              IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/returns/department', {
      method: 'POST',
      body: {
        FromDepartment: 'Ward',
        ToStoreId: 1,
        Reason: 'unused',
        Items: [{ ItemId: 77, StockId: 51, Quantity: 2, Remarks: 'Unused cannula' }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryDepartmentReturn'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryDepartmentReturnItem'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('AvailableQuantity = AvailableQuantity + ?'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('return_in'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAuditLog'))).toBe(true);
  });

  it('keeps patient return billing adjustment in review when the billed line is not provisional', async () => {
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
              StockId: 51,
              ItemId: 77,
              StoreId: 1,
              AvailableQuantity: 8,
              BatchNo: 'CAN-2026',
              ExpiryDate: '2027-01-01',
              CostPrice: 30,
              IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryConsumptionItem CI')) {
          return {
            first: {
              ConsumptionItemId: 91,
              BillingReferenceId: 881,
              Quantity: 1,
              ChargeAmount: 80,
              PatientId: 501,
            },
          };
        }
        if (sql.includes('FROM billing_provisional_items')) {
          return { first: { id: 881, bill_status: 'billed', is_active: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/returns/patient', {
      method: 'POST',
      body: {
        PatientId: 501,
        ToStoreId: 1,
        Reason: 'patient_refused',
        AdjustPatientBill: true,
        Items: [{ ItemId: 77, StockId: 51, ConsumptionItemId: 91, Quantity: 1 }],
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { BillingAdjustmentStatus?: string };
    expect(body.BillingAdjustmentStatus).toBe('requires_billing_review');
    expect(mockDB.queries.some(q => q.sql.includes('UPDATE billing_provisional_items'))).toBe(false);
  });

  it('creates an adjustment request without changing inventory before approval', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return { first: { StockId: 51, ItemId: 77, StoreId: 1, AvailableQuantity: 10, BatchNo: 'CAN-2026' } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests', {
      method: 'POST',
      body: {
        StoreId: 1,
        Reason: 'Physical count mismatch',
        Items: [{ ItemId: 77, StockId: 51, NewQuantity: 12 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAdjustmentRequest'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAdjustmentRequestItem'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.startsWith('UPDATE InventoryStock'))).toBe(false);
  });

  it('approves an adjustment request and posts stock movement plus audit log', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryAdjustmentRequest WHERE')) {
          return { first: { AdjustmentRequestId: 10, AdjustmentNo: 'ADJ-10', StoreId: 1, Status: 'submitted' } };
        }
        if (sql.includes('FROM InventoryAdjustmentRequestItem WHERE')) {
          return {
            results: [{
              AdjustmentRequestItemId: 44,
              AdjustmentRequestId: 10,
              ItemId: 77,
              StockId: 51,
              CurrentQuantity: 10,
              NewQuantity: 12,
              DifferenceQuantity: 2,
              BatchNo: 'CAN-2026',
            }],
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return { first: { StockId: 51, ItemId: 77, StoreId: 1, AvailableQuantity: 10, BatchNo: 'CAN-2026' } };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity = ?')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/10/approve', {
      method: 'POST',
      body: { Remarks: 'Approved after count' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryStock SET AvailableQuantity = ?'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('adjustment_plus'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAuditLog'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes("UPDATE InventoryAdjustmentRequest SET Status = 'posted'"))).toBe(true);
  });

  it('approves a submitted stock count and posts variance adjustment movement', async () => {
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
          return {
            results: [{
              CountItemId: 17,
              CountSessionId: 7,
              ItemId: 77,
              StockId: 51,
              SystemQuantity: 10,
              CountedQuantity: 8,
              DifferenceQuantity: -2,
              BatchNo: 'CAN-2026',
            }],
          };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return { first: { StockId: 51, ItemId: 77, StoreId: 1, AvailableQuantity: 10, BatchNo: 'CAN-2026' } };
        }
        if (sql.includes('UPDATE InventoryStock SET AvailableQuantity = ?')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/count-sessions/7/approve', {
      method: 'POST',
      body: { Remarks: 'Variance approved' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryStock SET AvailableQuantity = ?'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('adjustment_minus'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes("UPDATE InventoryStockCountSession SET Status = 'approved'"))).toBe(true);
  });

  it('posts an accounting event when a department return restores usable stock', async () => {
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
              StockId: 51,
              ItemId: 77,
              StoreId: 1,
              AvailableQuantity: 8,
              BatchNo: 'CAN-2026',
              ExpiryDate: '2027-01-01',
              CostPrice: 30,
              IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/returns/department', {
      method: 'POST',
      body: {
        FromDepartment: 'Ward',
        ToStoreId: 1,
        Reason: 'unused',
        Items: [{ ItemId: 77, StockId: 51, Quantity: 2, Remarks: 'Unused cannula' }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events'))).toBe(true);
    expect(mockDB.queries.some(q =>
      q.sql.includes('accounting_posting_events') &&
      q.params.some(p => typeof p === 'string' && p.includes('inventory_purchase'))
    )).toBe(true);
  });
});

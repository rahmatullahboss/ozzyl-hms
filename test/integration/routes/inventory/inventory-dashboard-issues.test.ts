import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — dashboard and issue workflows', () => {
  it('returns a complete dashboard summary shape for inventory command center cards', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/inventory/dashboard');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      summary: Record<string, number>;
      alerts: unknown[];
      recentMovements: unknown[];
    };
    expect(body.summary).toEqual(expect.objectContaining({
      totalStockValue: expect.any(Number),
      lowStockItems: expect.any(Number),
      outOfStockItems: expect.any(Number),
      expiringSoonItems: expect.any(Number),
      expiredItems: expect.any(Number),
      pendingPurchaseRequests: expect.any(Number),
      pendingDepartmentRequests: expect.any(Number),
      todayReceivedQuantity: expect.any(Number),
      todayIssuedQuantity: expect.any(Number),
      damagedStockQuantity: expect.any(Number),
      assetMaintenanceDue: expect.any(Number),
    }));
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(Array.isArray(body.recentMovements)).toBe(true);
  });

  it('issues chargeable patient stock, records consumption, movement, audit, and provisional billing line', async () => {
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
              AvailableQuantity: 20,
              BatchNo: 'CAN-2026',
              ExpiryDate: '2027-01-01',
              CostPrice: 30,
              MRP: 80,
              IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return {
            first: {
              ItemId: 77,
              ItemName: 'Cannula 20G',
              ItemCode: 'CAN-20',
              SalePrice: 80,
              StandardRate: 30,
              Chargeable: 1,
            },
          };
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
        IssueType: 'patient_issue',
        FromStoreId: 1,
        ToDepartment: 'Ward',
        PatientId: 501,
        Chargeable: true,
        Items: [
          {
            ItemId: 77,
            StockId: 51,
            Quantity: 2,
            ChargeAmount: 80,
          },
        ],
      },
    });

    expect(res.status).toBe(201);
    const update = mockDB.queries.find(q => q.sql.includes('UPDATE InventoryStock') && q.sql.includes('AvailableQuantity = AvailableQuantity - ?'));
    expect(update?.params).toEqual(expect.arrayContaining([2, 51, 'tenant-1']));
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryConsumption'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryConsumptionItem'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO billing_provisional_items'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAuditLog'))).toBe(true);
  });

  it('rejects direct stock issue when scanned stock belongs to another store', async () => {
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
              StoreId: 2,
              AvailableQuantity: 20,
              BatchNo: 'CAN-2026',
              ExpiryDate: '2027-01-01',
              CostPrice: 30,
              IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return {
            first: {
              ItemId: 77,
              ItemName: 'Cannula 20G',
              StandardRate: 30,
            },
          };
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
        IssueType: 'department_issue',
        FromStoreId: 1,
        ToDepartment: 'Ward',
        Items: [{ ItemId: 77, StockId: 51, Quantity: 1 }],
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { message?: string; error?: string };
    expect(String(body.message || body.error)).toMatch(/source store/i);
    expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryStock SET AvailableQuantity'))).toBe(false);
  });
});

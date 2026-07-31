import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — lab and OT consumption adapters', () => {
  it('records manual lab reagent consumption through the shared stock issue engine', async () => {
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
              StockId: 61,
              ItemId: 88,
              StoreId: 3,
              AvailableQuantity: 10,
              BatchNo: 'REAG-1',
              ExpiryDate: '2027-01-01',
              CostPrice: 200,
              IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemType: 'lab_reagent', StandardRate: 200 } };
        }
        if (sql.includes('UPDATE InventoryStock')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/lab/reagent-consumption', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'lab-manual-501-88' },
      body: {
        FromStoreId: 3,
        LabOrderId: 501,
        Items: [{ ItemId: 88, StockId: 61, Quantity: 1 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some(q =>
      q.sql.includes('INSERT OR IGNORE INTO inventory_issue_operation')
      && q.params.includes('lab-manual-501-88')
    )).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryConsumption'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('lab_consumption'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO billing_provisional_items'))).toBe(false);
  });

  it('records chargeable OT consumption and creates a provisional patient billing line', async () => {
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
              StockId: 71,
              ItemId: 99,
              StoreId: 4,
              AvailableQuantity: 5,
              BatchNo: 'OT-1',
              ExpiryDate: '2027-01-01',
              CostPrice: 500,
              IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 99, ItemName: 'Surgical Pack', ItemType: 'ot_item', SalePrice: 1200, StandardRate: 500 } };
        }
        if (sql.includes('UPDATE InventoryStock')) {
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/ot/consumption', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'ot-consumption-33-pack' },
      body: {
        FromStoreId: 4,
        PatientId: 601,
        SurgeryId: 33,
        OTRoom: 'OT-1',
        Chargeable: true,
        Items: [{ ItemId: 99, StockId: 71, Quantity: 1, ChargeAmount: 1200 }],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some(q =>
      q.sql.includes('INSERT OR IGNORE INTO inventory_issue_operation')
      && q.params.includes('ot-consumption-33-pack')
    )).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('TransactionType') && q.params.includes('ot_consumption'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO billing_provisional_items'))).toBe(true);
  });
});

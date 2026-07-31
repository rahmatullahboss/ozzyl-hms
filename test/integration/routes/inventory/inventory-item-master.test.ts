import { describe, expect, it } from 'vitest';
import itemsRoute from '../../../../src/routes/tenant/inventory/items';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — complete item master fields', () => {
  it('creates a medicine item with batch, expiry, unit conversion, pricing, and QR/barcode metadata', async () => {
    const { app, mockDB } = createTestApp({
      route: itemsRoute,
      routePath: '/items',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: { inventoryitem: [] },
    });

    const res = await jsonRequest(app, '/items', {
      method: 'POST',
      body: {
        ItemName: 'Paracetamol 500mg Tablet',
        ItemCode: 'MED-PARA-500',
        ItemType: 'medicine',
        GenericName: 'Paracetamol',
        BrandName: 'Napa',
        ManufacturerName: 'Beximco',
        Strength: '500mg',
        DosageForm: 'Tablet',
        PurchaseUnit: 'box',
        IssueUnit: 'tablet',
        UnitConversionFactor: 100,
        Barcode: '8941100000010',
        IsBatchRequired: true,
        IsExpiryRequired: true,
        ReOrderLevel: 50,
        MinStockQuantity: 20,
        MaxStockQuantity: 500,
        PurchasePrice: 1.5,
        SalePrice: 2,
        StorageCondition: 'Room temperature',
        RackShelf: 'PH-A1',
        Chargeable: true,
        MedicineMeta: {
          company: 'Beximco',
          mrp: 2,
        },
      },
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find(q => q.sql.includes('INSERT INTO InventoryItem'));
    expect(insert?.params).toEqual(expect.arrayContaining([
      'medicine',
      'Paracetamol',
      'Napa',
      'Beximco',
      '500mg',
      'Tablet',
      'box',
      'tablet',
      100,
      '8941100000010',
      1,
      1,
      500,
      1.5,
      2,
      'Room temperature',
      'PH-A1',
      1,
    ]));
  });
});

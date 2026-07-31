import { describe, expect, it } from 'vitest';
import importExportRoute from '../../../../src/routes/tenant/inventory/importExport';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — import/export', () => {
  it('exports items as CSV', async () => {
    const { app } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem')) {
          return {
            results: [
              { ItemCode: 'ITM-001', ItemName: 'Gloves', ItemType: 'consumable', CategoryName: 'Disposables', UOMName: 'Piece', StandardRate: 150 },
              { ItemCode: 'ITM-002', ItemName: 'Syringe', ItemType: 'consumable', CategoryName: 'Disposables', UOMName: 'Piece', StandardRate: 5 },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/import-export/export/items');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('ItemCode');
    expect(text).toContain('Gloves');
    expect(text).toContain('Syringe');
  });

  it('exports vendors as CSV', async () => {
    const { app } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryVendor')) {
          return { results: [{ VendorCode: 'VND-001', VendorName: 'MedSupply', ContactPerson: 'John' }] };
        }
        return null;
      },
    });

    const res = await app.request('/import-export/export/vendors');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('MedSupply');
  });

  it('imports items from CSV data', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItemCategory')) {
          return { results: [{ ItemCategoryId: 1, CategoryName: 'Disposables' }] };
        }
        if (sql.includes('FROM InventoryUnitOfMeasurement')) {
          return { results: [{ UOMId: 1, UOMName: 'Piece' }] };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: null }; // No duplicates
        }
        return null;
      },
    });

    const csv = `ItemCode,ItemName,ItemType,CategoryName,UOMName,StandardRate,IsActive
ITM-NEW,Gloves Box,consumable,Disposables,Piece,150,Yes`;

    const res = await jsonRequest(app, '/import-export/import/items', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(0);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryItem'))).toBe(true);
  });

  it('skips duplicate items by ItemCode', async () => {
    const { app } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItemCategory')) return { results: [] };
        if (sql.includes('FROM InventoryUnitOfMeasurement')) return { results: [] };
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 99 } }; // Already exists
        }
        return null;
      },
    });

    const csv = `ItemCode,ItemName,ItemType,StandardRate
ITM-DUP,Duplicate Item,consumable,100`;

    const res = await jsonRequest(app, '/import-export/import/items', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('rejects empty CSV', async () => {
    const { app } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/import-export/import/items', {
      method: 'POST',
      body: { csv: '' },
    });

    expect(res.status).toBe(400);
  });

  it('imports vendors from CSV data', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryVendor') && sql.includes('VendorCode = ?')) {
          return { first: null };
        }
        return null;
      },
    });

    const csv = `VendorCode,VendorName,ContactPerson,City,CreditPeriod,IsActive
VND-NEW,NewVendor,John,Dhaka,30,Yes`;

    const res = await jsonRequest(app, '/import-export/import/vendors', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(1);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryVendor'))).toBe(true);
  });

  it('imports opening stock lots and mirrors lab reagents into lab tracking', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemCode: 'CBC-REAG', ItemType: 'lab_reagent' } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3, StoreName: 'Lab Store', StoreCode: 'LAB' } };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('COALESCE(BatchNo')) {
          return { first: null };
        }
        if (sql.includes('INSERT INTO InventoryStock')) {
          return { meta: { changes: 1, last_row_id: 61 } };
        }
        if (sql.includes('INSERT INTO InventoryStockTransaction')) {
          return { meta: { changes: 1 } };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('WHERE ItemId = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemCode: 'CBC-REAG', ItemType: 'lab_reagent', PurchasePrice: 1200 } };
        }
        if (sql.includes('FROM lab_consumables') && sql.includes('inventory_item_id')) {
          return { first: { id: 99 } };
        }
        if (sql.includes('FROM lab_consumable_stock') && sql.includes('inventory_stock_id')) {
          return { first: null };
        }
        if (sql.includes('INSERT INTO lab_consumable_stock')) {
          return { meta: { changes: 1, last_row_id: 700 } };
        }
        if (sql.includes('INSERT INTO lab_consumable_movements')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    const csv = `ItemCode,StoreCode,BatchNo,ExpiryDate,AvailableQuantity,CostPrice,MRP,Remarks
CBC-REAG,LAB,CBC-LOT-001,2027-12-31,10,1200,1500,Initial reagent stock`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.mirroredLabReagents).toBe(1);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStockTransaction') && q.params.includes('opening-stock'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO lab_consumable_movements') && q.params.includes('inventory_opening_stock'))).toBe(true);
  });

  it('imports hospital-grade snake_case opening stock CSV with lot, batch, expiry, cost and supplier audit fields', async () => {
    let nextStockId = 700;
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          const code = String(params[1]);
          const itemIds: Record<string, number> = { 'CBC-REAGENT': 88, 'EDTA-TUBE': 89, 'GLUCOSE-REAGENT': 90 };
          return { first: { ItemId: itemIds[code] ?? 999, ItemName: code, ItemCode: code, ItemType: 'consumable', IsBatchRequired: 1, IsExpiryRequired: 1 } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3, StoreName: 'Lab Store', StoreCode: 'LAB-STORE' } };
        }
        if (sql.includes('FROM InventoryVendor') && sql.includes('VendorCode = ?')) {
          const code = String(params[1]);
          return { first: { VendorId: code === 'ROCHE' ? 10 : code === 'LOCAL' ? 11 : 12, VendorCode: code, VendorName: code } };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('COALESCE(LotNumber')) {
          return { first: null };
        }
        if (sql.includes('INSERT INTO InventoryStock')) {
          nextStockId += 1;
          return { meta: { changes: 1, last_row_id: nextStockId } };
        }
        if (sql.includes('INSERT INTO InventoryStockTransaction')) {
          return { meta: { changes: 1 } };
        }
        return null;
      },
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027-06-30,500,45,ROCHE
EDTA-TUBE,LAB-STORE,LOT-EDTA-001,BATCH-EDTA-001,2028-01-31,1000,8,LOCAL
GLUCOSE-REAGENT,LAB-STORE,LOT-GLU-001,BATCH-GLU-001,2027-03-31,300,30,MINDRAY`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('posted');
    expect(body.created).toBe(3);
    expect(body.skipped).toBe(0);
    expect(body.totalStockValue).toBe(39500);
    expect(body.referenceNo).toMatch(/^OS-/);
    expect(body.nextActions.some((action: any) => action.href === '/inventory/overview')).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock') && q.params.includes('LOT-CBC-001') && q.params.includes('BATCH-CBC-001'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStockTransaction') && q.params.includes('opening-stock'))).toBe(true);
    expect(mockDB.batchCalls.length).toBe(3);
    expect(mockDB.batchCalls.every(batch => batch.some(sql => sql.includes('INSERT INTO InventoryStock')) && batch.some(sql => sql.includes('INSERT INTO InventoryStockTransaction')))).toBe(true);
  });

  it('validates hospital-grade opening stock CSV without posting stock rows', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88 } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3 } };
        }
        if (sql.includes('FROM InventoryVendor') && sql.includes('VendorCode = ?')) {
          return { first: { VendorId: 10 } };
        }
        return null;
      },
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027-06-30,500,45,ROCHE
EDTA-TUBE,LAB-STORE,LOT-EDTA-001,BATCH-EDTA-001,2028-01-31,1000,8,LOCAL
GLUCOSE-REAGENT,LAB-STORE,LOT-GLU-001,BATCH-GLU-001,2027-03-31,300,30,MINDRAY`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock/validate', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.valid).toBe(true);
    expect(body.total).toBe(3);
    expect(body.totalStockValue).toBe(39500);
    expect(body.fileHash).toMatch(/^fnv1a32:/);
    expect(body.errors).toEqual([]);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(false);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(false);
  });

  it('validation catches duplicate opening stock lots before posting', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88 } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3 } };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('COALESCE(LotNumber')) {
          return { first: { StockId: 61 } };
        }
        if (sql.includes('FROM InventoryVendor') && sql.includes('VendorCode = ?')) {
          return { first: { VendorId: 10 } };
        }
        return null;
      },
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027-06-30,500,45,ROCHE`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock/validate', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.valid).toBe(false);
    expect(body.errors[0]).toContain('duplicate stock lot already exists');
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(false);
  });

  it('requires an explicit batch_number for batch-tracked opening stock items', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemCode: 'CBC-REAGENT', ItemType: 'lab_reagent', IsBatchRequired: 1, IsExpiryRequired: 1 } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3, StoreName: 'Lab Store', StoreCode: 'LAB-STORE' } };
        }
        if (sql.includes('FROM InventoryVendor') && sql.includes('VendorCode = ?')) {
          return { first: { VendorId: 10, VendorCode: 'ROCHE', VendorName: 'ROCHE' } };
        }
        return null;
      },
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,,2027-06-30,500,45,ROCHE`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errors[0]).toContain('batch_number is required');
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(false);
  });

  it('does not emit missing-column warnings when recommended snake_case headers are present', async () => {
    const { app } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88 } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3 } };
        }
        return null;
      },
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027-06-30,500,45,`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock/validate', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.valid).toBe(true);
    expect(body.warnings.some((warning: string) => warning.includes('CSV is missing recommended opening stock column'))).toBe(false);
    expect(body.warnings.some((warning: string) => warning.includes('supplier_code is recommended'))).toBe(true);
  });

  it('returns a warning instead of failing import when lab reagent mirror fails after ledger posting', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemCode: String(params[1]), ItemType: 'lab_reagent', IsBatchRequired: 1, IsExpiryRequired: 1 } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3, StoreName: 'Lab Store', StoreCode: 'LAB-STORE' } };
        }
        if (sql.includes('FROM InventoryVendor') && sql.includes('VendorCode = ?')) {
          return { first: { VendorId: 10, VendorCode: String(params[1]), VendorName: String(params[1]) } };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('COALESCE(LotNumber')) {
          return { first: null };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('WHERE ItemId = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemCode: 'CBC-REAGENT', ItemType: 'lab_reagent', PurchasePrice: 45 } };
        }
        if (sql.includes('INSERT INTO InventoryStock')) {
          return { meta: { changes: 1, last_row_id: 801 } };
        }
        if (sql.includes('INSERT INTO InventoryStockTransaction')) {
          return { meta: { changes: 1 } };
        }
        if (sql.includes('FROM lab_consumables') && sql.includes('inventory_item_id')) {
          throw new Error('Lab bridge offline');
        }
        return null;
      },
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027-06-30,500,45,ROCHE`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('posted');
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.mirroredLabReagents).toBe(0);
    expect(body.warnings.some((warning: string) => warning.includes('lab reagent mirror failed'))).toBe(true);
    expect(mockDB.batchCalls.length).toBe(1);
    expect(mockDB.batchCalls[0].some(sql => sql.includes('INSERT INTO InventoryStock'))).toBe(true);
    expect(mockDB.batchCalls[0].some(sql => sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(true);
  });

  it('supports opening stock dry-run without writing stock, ledger or audit rows', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemCode: String(params[1]), ItemType: 'lab_reagent', IsBatchRequired: 1, IsExpiryRequired: 1 } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3, StoreName: 'Lab Store', StoreCode: 'LAB-STORE' } };
        }
        if (sql.includes('FROM InventoryVendor') && sql.includes('VendorCode = ?')) {
          return { first: { VendorId: 10, VendorCode: String(params[1]), VendorName: String(params[1]) } };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('COALESCE(LotNumber')) {
          return { first: null };
        }
        return null;
      },
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027-06-30,500,45,ROCHE`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv, dryRun: true },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('validated');
    expect(body.approvalStatus).toBe('preview');
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.totalStockValue).toBe(22500);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(false);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(false);
    expect(mockDB.queries.some(q => q.sql.includes('audit_logs'))).toBe(false);
  });

  it('blocks opening stock rows with invalid expiry date format before stock posting', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027/06/30,500,45,ROCHE`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errors[0]).toContain('expiry_date must use YYYY-MM-DD format');
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(false);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(false);
  });

  it('blocks opening stock import when supplier_code is not active in supplier master', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemCode: 'CBC-REAGENT', ItemType: 'lab_reagent', IsBatchRequired: 1, IsExpiryRequired: 1 } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3, StoreName: 'Lab Store', StoreCode: 'LAB-STORE' } };
        }
        if (sql.includes('FROM InventoryVendor') && sql.includes('VendorCode = ?')) {
          return { first: null };
        }
        return null;
      },
    });

    const csv = `item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code
CBC-REAGENT,LAB-STORE,LOT-CBC-001,BATCH-CBC-001,2027-06-30,500,45,UNKNOWN-SUPPLIER`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errors[0]).toContain('supplier not found or inactive');
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(false);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(false);
  });

  it('skips duplicate opening stock lots without writing a second stock ledger row', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 88, ItemName: 'CBC Reagent', ItemCode: 'CBC-REAG', ItemType: 'lab_reagent' } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 3, StoreName: 'Lab Store', StoreCode: 'LAB' } };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('COALESCE(BatchNo')) {
          return { first: { StockId: 61 } };
        }
        return null;
      },
    });

    const csv = `ItemCode,StoreCode,BatchNo,ExpiryDate,AvailableQuantity,CostPrice
CBC-REAG,LAB,CBC-LOT-001,2027-12-31,10,1200`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errors[0]).toContain('duplicate stock lot already exists');
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(false);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStockTransaction'))).toBe(false);
  });

  it('imports normal opening stock without lab reagent mirroring', async () => {
    const { app, mockDB } = createTestApp({
      route: importExportRoute,
      routePath: '/import-export',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemCode = ?')) {
          return { first: { ItemId: 45, ItemName: 'Gloves', ItemCode: 'GLV-001', ItemType: 'consumable' } };
        }
        if (sql.includes('FROM InventoryStore') && sql.includes('StoreCode = ?')) {
          return { first: { StoreId: 1, StoreName: 'Main Store', StoreCode: 'MAIN' } };
        }
        if (sql.includes('FROM InventoryStock') && sql.includes('COALESCE(BatchNo')) {
          return { first: null };
        }
        if (sql.includes('INSERT INTO InventoryStock')) {
          return { meta: { changes: 1, last_row_id: 62 } };
        }
        if (sql.includes('INSERT INTO InventoryStockTransaction')) {
          return { meta: { changes: 1 } };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('WHERE ItemId = ?')) {
          return { first: { ItemId: 45, ItemName: 'Gloves', ItemCode: 'GLV-001', ItemType: 'consumable', PurchasePrice: 120 } };
        }
        return null;
      },
    });

    const csv = `ItemCode,StoreCode,BatchNo,AvailableQuantity,CostPrice,MRP
GLV-001,MAIN,OPENING,25,120,180`;

    const res = await jsonRequest(app, '/import-export/import/opening-stock', {
      method: 'POST',
      body: { csv },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(1);
    expect(body.mirroredLabReagents).toBe(0);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStock'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO lab_consumable_stock'))).toBe(false);
  });
});

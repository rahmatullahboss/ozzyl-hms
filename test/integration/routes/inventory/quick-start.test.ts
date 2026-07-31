import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp } from '../../helpers/test-app';

describe('Inventory quick-start readiness', () => {
  it('returns a small-hospital setup checklist with recommended actions', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStore')) return { first: { count: 1 } };
        if (sql.includes('FROM InventoryItem') && sql.includes('ReOrderLevel')) return { first: { count: 3 } };
        if (sql.includes('FROM InventoryItem')) return { first: { count: 10 } };
        if (sql.includes('FROM InventoryStock S JOIN InventoryItem')) return { first: { count: 2 } };
        if (sql.includes('FROM InventoryStock') && sql.includes('AvailableQuantity <= 0')) return { first: { count: 1 } };
        if (sql.includes('FROM InventoryStock') && sql.includes('ExpiryDate >')) return { first: { count: 4 } };
        if (sql.includes('FROM InventoryStock') && sql.includes('ExpiryDate <=')) return { first: { count: 0 } };
        if (sql.includes('FROM InventoryStock')) return { first: { count: 12 } };
        if (sql.includes('FROM InventoryPurchaseRequest')) return { first: { count: 1 } };
        if (sql.includes('FROM InventoryPurchaseOrder')) return { first: { count: 0 } };
        if (sql.includes('FROM InventoryRequisition')) return { first: { count: 2 } };
        if (sql.includes('FROM InventoryAdjustmentRequest')) return { first: { count: 0 } };
        if (sql.includes('FROM lab_inventory_policy')) return { first: { count: 1 } };
        if (sql.includes('FROM lab_consumables')) return { first: { count: 15 } };
        if (sql.includes('FROM lab_consumable_stock') && sql.includes('qc_status')) return { first: { count: 0 } };
        if (sql.includes('FROM lab_consumable_stock') && sql.includes('onboard_expires_at')) return { first: { count: 1 } };
        if (sql.includes('FROM lab_consumable_stock')) return { first: { count: 6 } };
        if (sql.includes('FROM lab_test_consumable_map')) return { first: { count: 8 } };
        if (sql.includes('FROM lab_inventory_exceptions')) return { first: { count: 0 } };
        return null;
      },
    });

    const res = await app.request('/inventory/quick-start/readiness?mode=simple');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mode).toBe('simple');
    expect(body.metrics.stores).toBe(1);
    expect(body.metrics.items).toBe(10);
    expect(body.setupChecklist.map((item: any) => item.id)).toContain('opening-stock');
    expect(body.labChecklist.map((item: any) => item.id)).toContain('lab-test-mapping');
    expect(body.dailyActions.map((item: any) => item.id)).toContain('out-of-stock');
    expect(body.recommendedNextActions.length).toBeGreaterThan(0);
  });

  it('defaults to simple mode and reports missing essentials for an empty hospital', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/inventory/quick-start/readiness');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mode).toBe('simple');
    expect(body.smallHospitalReady).toBe(false);
    expect(body.blockingIssues.some((item: any) => item.id === 'stores')).toBe(true);
    expect(body.blockingIssues.some((item: any) => item.id === 'item-master')).toBe(true);
  });

  it('returns a role/process guide for small-hospital inventory operation', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/inventory/quick-start/process-guide?mode=simple');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mode).toBe('simple');
    expect(body.position.smallHospital).toContain('guided simple setup');
    expect(body.roleGuide.map((role: any) => role.role)).toContain('Owner/Admin');
    expect(body.roleGuide.map((role: any) => role.role)).toContain('Storekeeper / Admin Assistant');
    expect(body.roleGuide.map((role: any) => role.role)).toContain('Lab Technician');
    expect(body.roleGuide.map((role: any) => role.role)).not.toContain('Inventory Manager');
    expect(body.remainingWork.some((item: any) => item.item.includes('control room'))).toBe(true);
  });

  it('includes enterprise governance roles in enterprise mode', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/inventory/quick-start/process-guide?mode=enterprise');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mode).toBe('enterprise');
    expect(body.roleGuide.map((role: any) => role.role)).toContain('Inventory Manager');
    expect(body.position.enterprise).toContain('reconciliation');
  });

  it('creates default small-hospital stores idempotently', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('SELECT StoreId, StoreName, StoreCode')) return { first: null };
        return null;
      },
    });

    const res = await app.request('/inventory/quick-start/default-stores', { method: 'POST' });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.created.map((store: any) => store.storeName)).toEqual([
      'Main Store',
      'Lab Store',
      'Lab Refrigerator',
      'Chemistry Analyzer Area',
      'Hematology Analyzer Area',
      'Sample Collection Area',
    ]);
    expect(body.totalReady).toBe(6);
    expect(body.canonicalFlow.sourceOfTruth).toBe('InventoryStock');
    expect(body.canonicalFlow.labMonitoringRole).toContain('projection');
    expect(mockDB.queries.filter(q => q.sql.includes('INSERT INTO InventoryStore')).length).toBe(6);
  });

  it('links reagent locations under canonical parent stores when creating defaults', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('SELECT StoreId, StoreName, StoreCode')) return { first: null };
        return null;
      },
    });

    const res = await app.request('/inventory/quick-start/default-stores', { method: 'POST' });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    const createdByCode = Object.fromEntries(body.created.map((store: any) => [store.storeCode, store]));
    const inserts = mockDB.queries.filter(q => q.method === 'run' && q.sql.includes('INSERT INTO InventoryStore'));
    const parentIdByCode = Object.fromEntries(inserts.map(q => [q.params[2], q.params[5]]));

    expect(parentIdByCode.MAIN).toBeNull();
    expect(parentIdByCode.LAB).toBe(createdByCode.MAIN.id);
    expect(parentIdByCode['LAB-REF']).toBe(createdByCode.LAB.id);
    expect(parentIdByCode['LAB-CHEM']).toBe(createdByCode.LAB.id);
    expect(parentIdByCode['LAB-HEMA']).toBe(createdByCode.LAB.id);
    expect(parentIdByCode['LAB-SAMPLE']).toBe(createdByCode.LAB.id);
  });

  it('repairs legacy store codes and parent links to canonical reagent defaults', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql, params) => {
        if (sql.includes('SELECT StoreId, StoreName, StoreCode')) {
          const requestedCode = String(params[1]);
          const byRequestedCode: Record<string, { StoreId: number; StoreName: string; StoreCode: string }> = {
            MAIN: { StoreId: 1, StoreName: 'Main Store', StoreCode: 'MAIN-OLD' },
            LAB: { StoreId: 2, StoreName: 'Lab Store', StoreCode: 'LAB-OLD' },
            'LAB-REF': { StoreId: 3, StoreName: 'Lab Refrigerator', StoreCode: 'REFRIGERATOR-OLD' },
            'LAB-CHEM': { StoreId: 4, StoreName: 'Chemistry Analyzer Area', StoreCode: 'CHEM-OLD' },
            'LAB-HEMA': { StoreId: 5, StoreName: 'Hematology Analyzer Area', StoreCode: 'HEMA-OLD' },
            'LAB-SAMPLE': { StoreId: 6, StoreName: 'Sample Collection Area', StoreCode: 'SAMPLE-OLD' },
          };
          return { first: byRequestedCode[requestedCode] };
        }
        return null;
      },
    });

    const res = await app.request('/inventory/quick-start/default-stores', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toHaveLength(0);
    expect(body.existing.map((store: any) => store.storeCode)).toEqual([
      'MAIN',
      'LAB',
      'LAB-REF',
      'LAB-CHEM',
      'LAB-HEMA',
      'LAB-SAMPLE',
    ]);

    const updates = mockDB.queries.filter(q => q.method === 'run' && q.sql.includes('UPDATE InventoryStore'));
    const updateParentIdByCode = Object.fromEntries(updates.map(q => [q.params[0], q.params[3]]));
    expect(updateParentIdByCode.MAIN).toBeNull();
    expect(updateParentIdByCode.LAB).toBe(1);
    expect(updateParentIdByCode['LAB-REF']).toBe(2);
    expect(updateParentIdByCode['LAB-CHEM']).toBe(2);
    expect(updateParentIdByCode['LAB-HEMA']).toBe(2);
    expect(updateParentIdByCode['LAB-SAMPLE']).toBe(2);
  });

  it('does not duplicate default stores when they already exist', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql, params) => {
        if (sql.includes('SELECT StoreId, StoreName, StoreCode')) {
          const code = String(params[1]);
          const ids: Record<string, number> = {
            MAIN: 1,
            LAB: 2,
            'LAB-REF': 3,
            'LAB-CHEM': 4,
            'LAB-HEMA': 5,
            'LAB-SAMPLE': 6,
          };
          return { first: { StoreId: ids[code] ?? 99, StoreName: `${code} Store`, StoreCode: code } };
        }
        return null;
      },
    });

    const res = await app.request('/inventory/quick-start/default-stores', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toHaveLength(0);
    expect(body.existing.map((store: any) => store.storeCode)).toEqual([
      'MAIN',
      'LAB',
      'LAB-REF',
      'LAB-CHEM',
      'LAB-HEMA',
      'LAB-SAMPLE',
    ]);
    const updates = mockDB.queries.filter(q => q.method === 'run' && q.sql.includes('UPDATE InventoryStore'));
    const updateParentIdByCode = Object.fromEntries(updates.map(q => [q.params[0], q.params[3]]));
    expect(updateParentIdByCode.MAIN).toBeNull();
    expect(updateParentIdByCode.LAB).toBe(1);
    expect(updateParentIdByCode['LAB-REF']).toBe(2);
    expect(updateParentIdByCode['LAB-CHEM']).toBe(2);
    expect(updateParentIdByCode['LAB-HEMA']).toBe(2);
    expect(updateParentIdByCode['LAB-SAMPLE']).toBe(2);
    expect(updates).toHaveLength(6);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryStore'))).toBe(false);
  });

  it('creates default lab item master records with test-equivalent units', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM InventoryUnitOfMeasurement')) {
          const uom = String(params[1]).toLowerCase();
          const ids: Record<string, number> = { test: 101, pcs: 102 };
          return { first: ids[uom] ? { UOMId: ids[uom], UOMName: uom } : null };
        }
        if (sql.includes('FROM InventoryItemCategory')) {
          const category = String(params[1]).toLowerCase();
          const ids: Record<string, number> = { 'reagent/kit': 201, tube: 202, reagent: 203, kit: 204 };
          return { first: ids[category] ? { ItemCategoryId: ids[category], CategoryName: category } : null };
        }
        if (sql.includes('SELECT ItemId, ItemName, ItemCode')) return { first: null };
        return null;
      },
    });

    const res = await app.request('/inventory/quick-start/default-lab-items', { method: 'POST' });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.created.map((item: any) => item.itemName)).toEqual([
      'CBC Reagent Pack',
      'EDTA Tube',
      'Glucose Reagent',
      'Creatinine Reagent',
      'ALT Reagent',
      'AST Reagent',
      'Cholesterol Reagent',
      'Triglyceride Reagent',
      'Dengue NS1 Kit',
    ]);
    expect(body.testEquivalentModel).toContain('1 test deducts 1 test-equivalent unit');

    const inserts = mockDB.queries.filter(q => q.method === 'run' && q.sql.includes('INSERT INTO InventoryItem ('));
    expect(inserts).toHaveLength(9);
    const cbcInsert = inserts.find(q => q.params.includes('CBC Reagent Pack'));
    const edtaInsert = inserts.find(q => q.params.includes('EDTA Tube'));
    expect(cbcInsert?.params).toEqual(expect.arrayContaining(['LAB-CBC-REAGENT-PACK', 'lab_reagent', 201, 101, 'test', 'test']));
    expect(edtaInsert?.params).toEqual(expect.arrayContaining(['LAB-EDTA-TUBE', 'consumable', 202, 102, 'pcs', 'pcs']));
    expect(String(cbcInsert?.params.find(param => typeof param === 'string' && param.includes('manufacturer IFU')))).toContain('manufacturer IFU');
  });

  it('creates missing lab categories and units before creating starter item master', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryUnitOfMeasurement')) return { first: null };
        if (sql.includes('FROM InventoryItemCategory')) return { first: null };
        if (sql.includes('SELECT ItemId, ItemName, ItemCode')) return { first: null };
        return null;
      },
    });

    const res = await app.request('/inventory/quick-start/default-lab-items', { method: 'POST' });

    expect(res.status).toBe(201);
    const uomInserts = mockDB.queries.filter(q => q.method === 'run' && q.sql.includes('INSERT INTO InventoryUnitOfMeasurement'));
    const categoryInserts = mockDB.queries.filter(q => q.method === 'run' && q.sql.includes('INSERT INTO InventoryItemCategory'));
    const itemInserts = mockDB.queries.filter(q => q.method === 'run' && q.sql.includes('INSERT INTO InventoryItem ('));

    expect(uomInserts.map(q => q.params[1])).toEqual(['test', 'pcs']);
    expect(categoryInserts.map(q => q.params[1])).toEqual(['reagent/kit', 'tube', 'reagent', 'kit']);
    expect(itemInserts).toHaveLength(9);

    const cbcInsert = itemInserts.find(q => q.params.includes('CBC Reagent Pack'));
    const cbcLabMeta = JSON.parse(String(cbcInsert?.params[10]));
    expect(cbcLabMeta).toMatchObject({
      starterItem: true,
      testEquivalent: true,
      consumptionBasis: 'test_equivalent',
      defaultDeductionPerTest: 1,
      analyzerSpecificQuantityRequired: true,
      rawMlOrMicroliterConfigured: false,
      ifuRequiredForExactQuantity: true,
    });
  });

  it('does not duplicate default lab item master records and repairs metadata on existing items', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM InventoryUnitOfMeasurement')) {
          const uom = String(params[1]).toLowerCase();
          const ids: Record<string, number> = { test: 101, pcs: 102 };
          return { first: ids[uom] ? { UOMId: ids[uom], UOMName: uom } : null };
        }
        if (sql.includes('FROM InventoryItemCategory')) {
          const category = String(params[1]).toLowerCase();
          const ids: Record<string, number> = { 'reagent/kit': 201, tube: 202, reagent: 203, kit: 204 };
          return { first: ids[category] ? { ItemCategoryId: ids[category], CategoryName: category } : null };
        }
        if (sql.includes('SELECT ItemId, ItemName, ItemCode')) {
          return { first: { ItemId: 5000 + String(params[1]).length, ItemName: String(params[2]), ItemCode: String(params[1]) } };
        }
        return null;
      },
    });

    const res = await app.request('/inventory/quick-start/default-lab-items', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toHaveLength(0);
    expect(body.existing).toHaveLength(9);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryItem'))).toBe(false);
    const updates = mockDB.queries.filter(q => q.method === 'run' && q.sql.includes('UPDATE InventoryItem'));
    expect(updates).toHaveLength(9);
    expect(updates[0].params).toEqual(expect.arrayContaining(['lab_reagent', 201, 101, 'test', 'test', '12', 'tenant-1']));
  });
});

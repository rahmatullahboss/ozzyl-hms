import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — reorder suggestions', () => {
  it('returns items below reorder level with suggested quantities', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('InventoryStock S') && sql.includes('ReOrderLevel') && sql.includes('LEFT JOIN InventoryVendor')) {
          return {
            results: [
              {
                ItemId: 1,
                ItemName: 'Surgical Gloves',
                ItemCode: 'SG-001',
                ReOrderLevel: 50,
                MaxStockQuantity: 200,
                MinStockQuantity: 10,
                current_stock: 20,
                suggested_quantity: 180,
                preferred_vendor_id: 1,
                preferred_vendor_name: 'MedSupply Co',
                auto_reorder_enabled: 0,
                reorder_quantity_formula: 'max_minus_current',
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/inventory/reorder/suggestions');

    expect(res.status).toBe(200);
    const body = await res.json() as { suggestions: unknown[] };
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toEqual(expect.objectContaining({
      ItemId: 1,
      ItemName: 'Surgical Gloves',
      suggested_quantity: 180,
    }));
  });
});

describe('Inventory — generate purchase requests', () => {
  it('generates purchase requests grouped by vendor from suggestions', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('InventoryStock S') && sql.includes('ReOrderLevel') && sql.includes('LEFT JOIN InventoryVendor')) {
          return {
            results: [
              {
                ItemId: 1, ItemName: 'Surgical Gloves', ItemCode: 'SG-001',
                ReOrderLevel: 50, MaxStockQuantity: 200, MinStockQuantity: 10,
                current_stock: 20, suggested_quantity: 180,
                preferred_vendor_id: 1, preferred_vendor_name: 'MedSupply Co',
                auto_reorder_enabled: 1, reorder_quantity_formula: 'max_minus_current',
                StandardRate: 5,
              },
              {
                ItemId: 2, ItemName: 'Bandages', ItemCode: 'BD-001',
                ReOrderLevel: 30, MaxStockQuantity: 100, MinStockQuantity: 5,
                current_stock: 10, suggested_quantity: 90,
                preferred_vendor_id: 1, preferred_vendor_name: 'MedSupply Co',
                auto_reorder_enabled: 1, reorder_quantity_formula: 'max_minus_current',
                StandardRate: 3,
              },
              {
                ItemId: 3, ItemName: 'Syringes', ItemCode: 'SY-001',
                ReOrderLevel: 100, MaxStockQuantity: 500, MinStockQuantity: 20,
                current_stock: 50, suggested_quantity: 450,
                preferred_vendor_id: 2, preferred_vendor_name: 'HealthParts Inc',
                auto_reorder_enabled: 1, reorder_quantity_formula: 'max_minus_current',
                StandardRate: 2,
              },
            ],
          };
        }
        if (sql.includes('MAX(CAST(SUBSTR(PRNumber')) {
          return { first: { maxNum: 0 } };
        }
        if (sql.includes('InventoryPurchaseRequestItem') && sql.includes('Status IN')) {
          return { results: [] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reorder/generate-pr', { method: 'POST' });

    expect(res.status).toBe(201);
    const body = await res.json() as { purchase_requests: number[]; skipped_items: unknown[] };
    expect(body.purchase_requests).toHaveLength(2);
    expect(mockDB.queries.filter(q => q.sql.includes('INSERT INTO InventoryPurchaseRequest') && !q.sql.includes('Item')).length).toBe(2);
    expect(mockDB.queries.filter(q => q.sql.includes('INSERT INTO InventoryPurchaseRequestItem')).length).toBe(3);
  });

  it('skips items already in open purchase requests (deduplication)', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('InventoryStock S') && sql.includes('ReOrderLevel') && sql.includes('LEFT JOIN InventoryVendor')) {
          return {
            results: [
              {
                ItemId: 1, ItemName: 'Surgical Gloves', ItemCode: 'SG-001',
                ReOrderLevel: 50, MaxStockQuantity: 200, MinStockQuantity: 10,
                current_stock: 20, suggested_quantity: 180,
                preferred_vendor_id: 1, preferred_vendor_name: 'MedSupply Co',
                auto_reorder_enabled: 1, reorder_quantity_formula: 'max_minus_current',
                StandardRate: 5,
              },
            ],
          };
        }
        if (sql.includes('MAX(CAST(SUBSTR(PRNumber')) {
          return { first: { maxNum: 0 } };
        }
        if (sql.includes('InventoryPurchaseRequestItem') && sql.includes('Status IN')) {
          return { results: [{ ItemId: 1 }] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reorder/generate-pr', { method: 'POST' });

    expect(res.status).toBe(201);
    const body = await res.json() as { purchase_requests: number[]; skipped_items: unknown[] };
    expect(body.purchase_requests).toHaveLength(0);
    expect(body.skipped_items).toHaveLength(1);
    expect(body.skipped_items[0]).toEqual(expect.objectContaining({ ItemId: 1, reason: 'already_in_open_pr' }));
  });
});

describe('Inventory — reorder config', () => {
  it('gets reorder config for an item', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('InventoryItem') && sql.includes('ItemId = ?') && sql.includes('auto_reorder_enabled')) {
          return {
            first: {
              ItemId: 1, ItemName: 'Surgical Gloves',
              auto_reorder_enabled: 1, preferred_vendor_id: 2,
              reorder_quantity_formula: 'max_minus_current',
            },
          };
        }
        return null;
      },
    });

    const res = await app.request('/inventory/reorder/config/1');

    expect(res.status).toBe(200);
    const body = await res.json() as { ItemId: number; auto_reorder_enabled: number };
    expect(body.ItemId).toBe(1);
    expect(body.auto_reorder_enabled).toBe(1);
  });

  it('returns 404 for non-existent item config', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/inventory/reorder/config/999');

    expect(res.status).toBe(404);
  });

  it('updates reorder config for an item', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('InventoryItem') && sql.includes('ItemId = ?') && !sql.includes('UPDATE')) {
          return { first: { ItemId: 1, auto_reorder_enabled: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reorder/config/1', {
      method: 'PUT',
      body: {
        auto_reorder_enabled: true,
        preferred_vendor_id: 3,
        reorder_quantity_formula: 'reorder_level_multiply',
      },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryItem'))).toBe(true);
  });

  it('preserves omitted reorder fields during a partial config update', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('SELECT') && sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return {
            first: {
              ItemId: 1,
              auto_reorder_enabled: 1,
              preferred_vendor_id: 2,
              reorder_quantity_formula: 'reorder_x2_minus_current',
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reorder/config/1', {
      method: 'PUT',
      body: { preferred_vendor_id: 9 },
    });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find((q) => q.sql.includes('UPDATE InventoryItem'));
    expect(update?.params.slice(0, 3)).toEqual([1, 9, 'reorder_x2_minus_current']);
  });

  it('returns 404 when updating config for non-existent item', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/inventory/reorder/config/999', {
      method: 'PUT',
      body: { auto_reorder_enabled: true },
    });

    expect(res.status).toBe(404);
  });
});

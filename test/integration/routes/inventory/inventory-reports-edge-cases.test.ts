import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — report edge cases', () => {
  it('rejects invalid report type with 400', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
    });

    const res = await jsonRequest(app, '/inventory/reports/nonexistent_report');
    expect(res.status).toBe(400);
  });

  it('returns CSV with correct headers for current_stock report', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('InventoryStock') && sql.includes('JOIN')) {
          return {
            results: [
              { StockId: 1, ItemName: 'Gloves', StoreName: 'Main', AvailableQuantity: 100, BatchNo: 'B1', CostPrice: 5 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reports/current_stock?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('blocks adjustment approve from user without inventory:approve permission', async () => {
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

  it('allows accountant to access reports (has inventory:reports permission)', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'accountant',
      tenantId: 'tenant-1',
      userId: 5,
      queryOverride: (sql) => {
        if (sql.includes('InventoryStock') && sql.includes('JOIN')) {
          return { results: [] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reports/current_stock');
    expect(res.status).toBe(200);
  });
});

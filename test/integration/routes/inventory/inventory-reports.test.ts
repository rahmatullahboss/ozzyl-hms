import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp } from '../../helpers/test-app';

describe('Inventory — unified reports', () => {
  it('returns stock valuation report rows through the inventory report contract', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('Stock valuation report')) return null;
        if (sql.includes('SUM(S.AvailableQuantity * S.CostPrice) AS StockValue')) {
          return {
            results: [
              {
                ItemCode: 'CAN-20',
                ItemName: 'Cannula 20G',
                StoreName: 'Central Store',
                Quantity: 10,
                StockValue: 300,
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/inventory/reports/stock_valuation?StoreId=1');

    expect(res.status).toBe(200);
    const body = await res.json() as { reportType: string; data: Array<Record<string, unknown>> };
    expect(body.reportType).toBe('stock_valuation');
    expect(body.data[0]).toEqual(expect.objectContaining({
      ItemName: 'Cannula 20G',
      StockValue: 300,
    }));
  });

  it('exports report data as CSV without accepting arbitrary report names', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock S')) {
          return { results: [{ ItemCode: 'SYR-5', ItemName: 'Syringe, 5ml', AvailableQuantity: 7 }] };
        }
        return null;
      },
    });

    const csv = await app.request('/inventory/reports/current_stock?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('"Syringe, 5ml"');

    const bad = await app.request('/inventory/reports/not_a_report');
    expect(bad.status).toBe(400);
  });
});

import { describe, expect, it } from 'vitest';
import stockRoute from '../../../../src/routes/tenant/inventory/stock';
import { createTestApp } from '../../helpers/test-app';

describe('Inventory — Stock overview', () => {
  it('returns filterable stock rows with computed status and stock value', async () => {
    const expiryDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { app } = createTestApp({
      route: stockRoute,
      routePath: '/stock',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('COUNT(*) as total')) return { first: { total: 1 } };
        if (sql.includes('FROM InventoryStock S') && sql.includes('ORDER BY I.ItemName ASC')) {
          return {
            results: [
              {
                StockId: 9,
                ItemId: 4,
                ItemName: 'Lab reagent A',
                ItemCode: 'REAG-A',
                ItemType: 'lab_reagent',
                CategoryName: 'Lab',
                StoreName: 'Lab Store',
                BatchNo: 'LAB-01',
                ExpiryDate: expiryDate,
                AvailableQuantity: 3,
                ReservedQuantity: 0,
                DamagedQuantity: 0,
                BlockedQuantity: 0,
                CostPrice: 100,
                ReOrderLevel: 2,
                RackShelf: 'LAB-R1',
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request(`/stock/overview?ItemType=lab_reagent&StoreId=2&ExpiryTo=${expiryDate}`);

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ Status: string; StockValue: number }> };
    expect(body.data[0]).toEqual(expect.objectContaining({
      Status: 'expiring_soon',
      StockValue: 300,
    }));
  });
});

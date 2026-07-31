import { describe, expect, it } from 'vitest';
import dispatchRoute from '../../../../src/routes/tenant/inventory/dispatch';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — Dispatch safety', () => {
  it('blocks expired stock from being dispatched even when quantity is available', async () => {
    const { app } = createTestApp({
      route: dispatchRoute,
      routePath: '/dispatch',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 44,
              AvailableQuantity: 100,
              BatchNo: 'EXP-001',
              ExpiryDate: '2025-01-01',
              CostPrice: 10,
              MRP: 12,
              StockStatus: 'available',
              DamagedQuantity: 0,
              BlockedQuantity: 0,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/dispatch', {
      method: 'POST',
      body: {
        SourceStoreId: 1,
        DestinationStoreId: 2,
        Items: [
          {
            ItemId: 99,
            StockId: 44,
            DispatchedQuantity: 1,
          },
        ],
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/expired/i);
  });
});

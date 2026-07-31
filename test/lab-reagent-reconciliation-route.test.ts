import { describe, expect, it } from 'vitest';
import { createTestApp } from './integration/helpers/test-app';
import labMonitoringRoutes from '../src/routes/tenant/labMonitoring';

describe('lab reagent reconciliation route', () => {
  it('returns classified reconciliation data to lab inventory managers', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        if (sql.includes('FROM lab_consumable_mapping_progress')) {
          return {
            results: [{
              id: 1,
              tenant_id: 'tenant-1',
              lab_order_id: 20,
              lab_order_item_id: 21,
              lab_test_id: 22,
              consumable_id: 23,
              inventory_item_id: 24,
              consumable_name: 'CBC Reagent',
              expected_quantity: 2,
              committed_quantity: 2,
              projected_quantity: 1,
              progress_status: 'partial',
              updated_at: '2026-07-10T00:00:00.000Z',
            }],
          };
        }
        return null;
      },
    });

    const res = await app.request('/lab-monitoring/inventory-reconciliation');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data[0].status).toBe('projection_missing');
    expect(body.summary.projection_missing).toBe(1);
  });

  it('denies reconciliation access to receptionists', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'receptionist',
    });

    const res = await app.request('/lab-monitoring/inventory-reconciliation');
    expect(res.status).toBe(403);
  });
});

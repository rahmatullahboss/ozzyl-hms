import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function createApp(mockDb: ReturnType<typeof createMockDB>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '9');
    c.set('role', 'lab_tech' as any);
    c.env = {
      DB: mockDb.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lab-machines', labMachines);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return app;
}

describe('LIS unmatched result candidate search', () => {
  it('returns lab order item candidates with patient and test context', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_order_items loi') && lower.includes('join patients p') && lower.includes('join lab_test_catalog ltc')) {
          return {
            results: [{
              lab_order_item_id: 11,
              lab_order_id: 22,
              order_no: 'LAB-2026-001',
              patient_name: 'Test Patient',
              patient_code: 'P-001',
              patient_mobile: 'mobile-1',
              test_name: 'Hemoglobin',
              test_code: 'HGB',
              item_barcode: 'BC-1',
              item_status: 'collected',
            }],
          };
        }
        return null;
      },
    });

    const res = await createApp(mock).request('/lab-machines/unmatched-results/candidates?q=BC-1&labTestId=33');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ lab_order_item_id: 11, patient_name: 'Test Patient', test_code: 'HGB', item_barcode: 'BC-1' }],
    });
    expect(mock.queries.some((query) => (
      query.sql.includes('loi.status NOT IN')
      && query.params.includes(33)
      && query.params.includes('%BC-1%')
    ))).toBe(true);
  });

  it('rejects too-short candidate searches without a lab test filter', async () => {
    const mock = createMockDB({ universalFallback: true });
    const res = await createApp(mock).request('/lab-machines/unmatched-results/candidates?q=B');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Search query must be at least 2 characters unless labTestId is provided',
    });
    expect(mock.queries).toHaveLength(0);
  });
});

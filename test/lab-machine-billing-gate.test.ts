import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

function makeApp(billStatus: 'open' | 'paid') {
  const mock = createMockDB({
    queryOverride(sql) {
      const s = sql.toLowerCase();
      if (s.includes('from lab_machines')) {
        return { first: { id: 1, protocol: 'hl7', machine_code: 'M1', is_active: 1 }, results: [], success: true, meta: {} };
      }
      if (s.includes('from lab_order_items') && s.includes('lab_machine_test_map')) {
        return {
          results: [{
            item_id: 10,
            lab_order_id: 20,
            status: 'pending',
            order_no: 'LO-20',
            patient_id: 30,
            patient_name: 'Patient',
            test_code: 'CBC',
            test_name: 'Complete Blood Count',
            machine_test_code: 'CBC',
            bill_id: 77,
            bill_status: billStatus,
            bill_total: 50000,
            bill_paid: billStatus === 'paid' ? 50000 : 0,
          }],
          success: true,
          meta: {},
        };
      }
      return null;
    },
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '1');
    c.set('role', 'lab_tech' as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing',
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lab-machines', labMachines);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return app;
}

describe('lab machine billing gate', () => {
  it('does not expose unpaid orders to machine pending-order worklists', async () => {
    const res = await makeApp('open').request('/lab-machines/1/pending-orders');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: [] });
  });

  it('exposes paid orders to machine pending-order worklists', async () => {
    const res = await makeApp('paid').request('/lab-machines/1/pending-orders');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import lab from '../src/routes/tenant/lab';
import { createMockDB } from './integration/helpers/mock-db';

function makeApp(billStatus: 'open' | 'paid') {
  const isPaid = billStatus === 'paid';
  const mock = createMockDB({
    universalFallback: true,
    queryOverride(sql) {
      const s = sql.toLowerCase();
      if (s.includes('select loi.*') && s.includes('join lab_orders lo')) {
        return {
          first: {
            id: 11,
            lab_order_id: 22,
            lab_test_id: 33,
            patient_id: 44,
            tenant_id: 'tenant-1',
            status: 'pending',
            gender: 'male',
            date_of_birth: '1990-01-01',
            normal_range: '10-20',
            critical_low: 5,
            critical_high: 30,
            bill_id: 77,
            bill_status: billStatus,
            bill_total: 50000,
            bill_paid: isPaid ? 50000 : 0,
          },
          results: [],
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
  app.route('/lab', lab);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return app;
}

function makeBulkApp(billStatus: 'open' | 'paid', orderHasTest = true) {
  const isPaid = billStatus === 'paid';
  const mock = createMockDB({
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      if (s.includes('from lab_orders lo') && s.includes('join patients p')) {
        return {
          first: {
            id: 22,
            patient_id: 44,
            tenant_id: 'tenant-1',
            gender: 'male',
            date_of_birth: '1990-01-01',
            bill_id: 77,
            bill_status: billStatus,
            bill_total: 50000,
            bill_paid: isPaid ? 50000 : 0,
          },
        };
      }
      if (s.includes('from lab_order_items loi') && s.includes('join lab_test_catalog ltc')) {
        if (!orderHasTest || Number(params[1]) !== 33) return { first: null };
        return {
          first: {
            id: 11,
            lab_order_id: 22,
            lab_test_id: 33,
            normal_range: '10-20',
            critical_low: 5,
            critical_high: 30,
            status: 'pending',
          },
        };
      }
      if (s.includes('from lab_reports')) return { first: null };
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
  app.route('/lab', lab);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return { app, mock };
}

function makeMachineReceiveApp(billStatus: 'open' | 'paid') {
  const isPaid = billStatus === 'paid';
  const mock = createMockDB({
    queryOverride(sql) {
      const s = sql.toLowerCase();
      if (s.includes('from lab_order_items loi') && s.includes('where loi.barcode')) {
        return {
          first: {
            id: 11,
            bill_id: 77,
            bill_status: billStatus,
            bill_total: 50000,
            bill_paid: isPaid ? 50000 : 0,
          },
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
  app.route('/lab', lab);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return { app, mock };
}

describe('lab billing gate', () => {
  it('blocks sample workflow when the linked bill is unpaid', async () => {
    const res = await makeApp('open').request('/lab/items/11/sample-status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'collected' }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('payment required'),
    });
  });

  it('allows sample workflow after the linked bill is paid', async () => {
    const res = await makeApp('paid').request('/lab/items/11/sample-status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'collected' }),
    });

    expect(res.status).toBe(200);
  });

  it('creates a bill for extended lab orders too', async () => {
    const res = await makeApp('paid').request('/lab/orders/extended', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: 44,
        priority: 'stat',
        clinical_history: 'Fever with chills',
        items: [{ labTestId: 33, discount: 0 }],
      }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      billId: expect.any(Number),
      invoiceNo: expect.any(String),
      total: expect.any(Number),
    });
  });

  it('blocks bulk result entry when the linked bill is unpaid', async () => {
    const { app, mock } = makeBulkApp('open');

    const res = await app.request('/lab/orders/22/results/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [{ lab_test_id: 33, result_value: '15' }],
      }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('payment required'),
    });
    expect(mock.queries.some((query) => query.sql.toLowerCase().includes('insert into lab_results'))).toBe(false);
  });

  it('rejects bulk result entry for a test that is not on the lab order', async () => {
    const { app, mock } = makeBulkApp('paid', false);

    const res = await app.request('/lab/orders/22/results/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: [{ lab_test_id: 33, result_value: '15' }],
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('not part of lab order'),
    });
    expect(mock.queries.some((query) => query.sql.toLowerCase().includes('insert into lab_results'))).toBe(false);
  });

  it('disables the legacy direct-write machine endpoint for paid and unpaid orders', async () => {
    for (const billStatus of ['open', 'paid'] as const) {
      const { app, mock } = makeMachineReceiveApp(billStatus);

      const res = await app.request('/lab/machine/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: 'M1',
          barcode: 'BC-1',
          testCodes: [{ code: 'CBC', result: '15' }],
        }),
      });

      expect(res.status).toBe(410);
      await expect(res.json()).resolves.toMatchObject({
        code: 'legacy_machine_endpoint_disabled',
      });
      expect(mock.queries.some((query) =>
        query.sql.toLowerCase().includes('update lab_order_items set result')
      )).toBe(false);
    }
  });
});

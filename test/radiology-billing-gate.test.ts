import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import radiology from '../src/routes/tenant/radiology';
import { createMockDB } from './integration/helpers/mock-db';

function makeAppWithMock(billStatus: 'open' | 'paid' = 'open') {
  const mock = createMockDB({
    universalFallback: true,
    queryOverride(sql) {
      const s = sql.toLowerCase();
      if (s.includes('from patients')) {
        return { first: { id: 44, name: 'Patient' }, results: [], success: true, meta: {} };
      }
      if (s.includes('from radiology_imaging_items')) {
        return {
          first: {
            id: 5,
            imaging_type_id: 2,
            imaging_type_name: 'X-Ray',
            name: 'Chest X-Ray PA',
            procedure_code: 'XR-CHEST-PA',
            price: 750,
            billing_service_item_id: 901,
          },
          results: [],
          success: true,
          meta: {},
        };
      }
      if (s.includes('from radiology_requisitions') && (s.includes('where id = ?') || s.includes('where r.id = ?'))) {
        return {
          first: {
            id: 9,
            order_status: 'pending',
            is_report_saved: 0,
            bill_id: 77,
            bill_status: billStatus,
            bill_total: 75000,
            bill_paid: billStatus === 'paid' ? 75000 : 0,
          },
          results: [],
          success: true,
          meta: {},
        };
      }
      if (s.includes('from invoice_items') && s.includes('reference_id')) {
        return {
          first: { id: 501, bill_id: 77, line_total: 75000 },
          results: [{ id: 501, bill_id: 77, line_total: 75000 }],
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
    c.set('role', 'md' as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing',
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/radiology', radiology);
  app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));
  return { app, mock };
}

function makeApp(billStatus: 'open' | 'paid' = 'open') {
  const { app } = makeAppWithMock(billStatus);
  return app;
}

describe('radiology billing gate', () => {
  it('creates a bill when a radiology requisition is ordered', async () => {
    const res = await makeApp().request('/radiology/requisitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: 44,
        imaging_item_id: 5,
        urgency: 'urgent',
      }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      id: expect.any(Number),
      billId: expect.any(Number),
      invoiceNo: expect.any(String),
      total: 750,
    });
  });

  it('blocks scan completion while the linked radiology bill is unpaid', async () => {
    const res = await makeApp('open').request('/radiology/requisitions/9/scan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_remarks: 'Patient positioned' }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('payment required'),
    });
  });

  it('allows scan completion after the linked radiology bill is paid', async () => {
    const res = await makeApp('paid').request('/radiology/requisitions/9/scan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_remarks: 'Patient positioned' }),
    });

    expect(res.status).toBe(200);
  });

  it('cancels an unpaid requisition by cancelling the linked invoice item and posting a reversal event', async () => {
    const { app, mock } = makeAppWithMock('open');

    const res = await app.request('/radiology/requisitions/9/cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancel_remarks: 'Patient declined scan' }),
    });

    expect(res.status).toBe(200);
    expect(mock.queries.some((query) =>
      query.sql.toLowerCase().includes("update invoice_items")
      && query.sql.toLowerCase().includes("status = 'cancelled'")
    )).toBe(true);
    expect(mock.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('billing_item_cancellation')
      && query.params.includes('bill_cancelled')
    )).toBe(true);
  });

  it('blocks requisition cancellation after payment so refund/credit note flow is used', async () => {
    const { app, mock } = makeAppWithMock('paid');

    const res = await app.request('/radiology/requisitions/9/cancel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancel_remarks: 'Paid patient wants refund' }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('credit note'),
    });
    expect(mock.queries.some((query) =>
      query.sql.toLowerCase().includes("update invoice_items")
      && query.sql.toLowerCase().includes("status = 'cancelled'")
    )).toBe(false);
  });
});

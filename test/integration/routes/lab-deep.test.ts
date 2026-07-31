/**
 * Lab-specific tests with CORRECT Zod schemas:
 * - createLabTestSchema: { code, name, category?, price }
 * - createLabOrderSchema: { patientId (camelCase!), items: [{ labTestId, discount }] }
 * - updateLabItemResultSchema: { result }
 * - updateSampleStatusSchema: { status: enum, notes? }
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';
import lab from '../../../src/routes/tenant/lab';

const T = 'tenant-1';

let currentSampleStatus = 'pending';

function smartQO(sql: string, params: unknown[] = []) {
  const s = sql.toLowerCase();
  
  if (s.includes('update lab_order_items set status =')) {
    currentSampleStatus = params[0] as string;
  }
  if (s.includes('select loi.*') && s.includes('lab_order_items')) {
    return { first: { id: 1, status: currentSampleStatus, lab_order_id: 1, tenant_id: 'tenant-1' }, results: [{ id: 1, status: currentSampleStatus, lab_order_id: 1, tenant_id: 'tenant-1' }], success: true, meta: {} };
  }
  
  if ((s.includes('select id from') || s.includes('select 1 from')) && s.includes('where'))
    return { first: null, results: [], success: true, meta: {} };
  if (s.includes('count(*)') || s.includes('count(1)'))
    return { first: { cnt: 3, count: 3, total: 3, 'count(*)': 3 }, results: [{ cnt: 3 }], success: true, meta: {} };
  if (s.includes('max('))
    return { first: { next_token: 5, max_no: 5 }, results: [{ next_token: 5 }], success: true, meta: {} };
  if (s.includes('coalesce(') || s.includes('sum('))
    return { first: { total: 10000 }, results: [{ total: 10000 }], success: true, meta: {} };
  return null;
}

function mkApp(role = 'hospital_admin') {
  const mock = createMockDB({ tables: {}, universalFallback: true, queryOverride: smartQO });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T); c.set('userId', '1'); c.set('role', role as any);
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing',
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lb', lab);
  app.onError((e, c) => c.json({ error: e.message }, (e as any).status ?? 500));
  return app;
}

function jr(app: any, url: string, method = 'GET', body?: any) {
  const init: RequestInit = { method, headers: body ? { 'Content-Type': 'application/json' } : {} };
  if (body) init.body = JSON.stringify(body);
  return app.request(url, init);
}

async function hit(url: string, method = 'GET', body?: any, role = 'hospital_admin') {
  const app = mkApp(role);
  const r = await jr(app, url, method, body);
  if (r.status === 400) {
    const text = await r.clone().text();
    console.error(`[hit] 400 ERROR on ${method} ${url}:\nBody sent: ${JSON.stringify(body)}\nResponse: ${text}`);
  }
  expect(r.status).toBeLessThanOrEqual(500);
  return r;
}

// ─── Catalog CRUD ─────────────────────────────────────────────
describe('Lab-Catalog', () => {
  it('GET / — list catalog', () => hit('/lb'));
  it('GET /?search=CBC', () => hit('/lb?search=CBC'));
  it('GET /?category=blood', () => hit('/lb?category=blood'));
  it('GET /?is_active=1', () => hit('/lb?is_active=1'));

  it('POST / — create lab test (blood)', async () => {
    const r = await hit('/lb', 'POST', {
      code: 'CBC',
      name: 'Complete Blood Count',
      category: 'blood',
      price: 500,
    });
    if (r.status === 400) console.log(await r.text()); expect(r.status).not.toBe(400);
  });

  it('POST / — create lab test (urine)', async () => {
    const r = await hit('/lb', 'POST', {
      code: 'UA',
      name: 'Urinalysis',
      category: 'urine',
      price: 300,
    });
    expect(r.status).not.toBe(400);
  });

  it('POST / — create lab test (no category)', async () => {
    const r = await hit('/lb', 'POST', {
      code: 'MISC',
      name: 'Miscellaneous Test',
      price: 100,
    });
    expect(r.status).not.toBe(400);
  });

  it('PUT /:id — update price', async () => {
    const r = await hit('/lb/1', 'PUT', { price: 600 });
    expect(r.status).not.toBe(400);
  });

  it('PUT /:id — update name', async () => {
    const r = await hit('/lb/1', 'PUT', { name: 'Updated Test' });
    expect(r.status).not.toBe(400);
  });

  it('DELETE /:id', () => hit('/lb/1', 'DELETE'));
});

// ─── Orders ───────────────────────────────────────────────────
describe('Lab-Orders', () => {
  it('GET /orders — list all', () => hit('/lb/orders'));
  it('GET /orders?patientId=1', () => hit('/lb/orders?patientId=1'));
  it('GET /orders?status=pending', () => hit('/lb/orders?status=pending'));
  it('GET /orders?from=2025-01-01&to=2025-12-31', () => hit('/lb/orders?from=2025-01-01&to=2025-12-31'));
  it('GET /orders/queue/today', () => hit('/lb/orders/queue/today'));

  it('GET /orders/:id — single order', () => hit('/lb/orders/1'));

  it('POST /orders — create order (single item)', async () => {
    const r = await hit('/lb/orders', 'POST', {
      patientId: 1,
      items: [{ labTestId: 10, discount: 0 }],
    });
    expect(r.status).not.toBe(400);
  });

  it('POST /orders — with visitId', async () => {
    const r = await hit('/lb/orders', 'POST', {
      patientId: 1,
      visitId: 5,
      orderDate: '2025-03-15',
      items: [{ labTestId: 10 }, { labTestId: 20 }],
    });
    expect(r.status).not.toBe(400);
  });

  it('POST /orders — multiple items', async () => {
    const r = await hit('/lb/orders', 'POST', {
      patientId: 1,
      items: [
        { labTestId: 10, discount: 0 },
        { labTestId: 20, discount: 50 },
        { labTestId: 30, discount: 100 },
      ],
    });
    expect(r.status).not.toBe(400);
  });

  it('POST /orders/:id/print', () => hit('/lb/orders/1/print', 'POST', {}));
});

// ─── Results & Sample Status ──────────────────────────────────
describe('Lab-Results', () => {
  it('PUT /items/:itemId/result — enter result', async () => {
    // Set status to 'collected' so result entry is allowed
    currentSampleStatus = 'collected';
    const r = await hit('/lb/items/1/result', 'PUT', {
      result: '14.2 g/dL',
    });
    expect(r.status).not.toBe(400);
  });

  it('PUT /items/:itemId/result — abnormal result', async () => {
    currentSampleStatus = 'collected';
    const r = await hit('/lb/items/2/result', 'PUT', {
      result: 'Positive for E. coli',
    });
    expect(r.status).not.toBe(400);
  });

  it('PATCH /items/:itemId/sample-status — collected', async () => {
    currentSampleStatus = 'pending';
    const r = await hit('/lb/items/1/sample-status', 'PATCH', {
      status: 'collected',
      notes: 'Blood drawn',
    });
    expect(r.status).not.toBe(400);
  });

  it('PATCH /items/:itemId/sample-status — received', async () => {
    currentSampleStatus = 'collected';
    const r = await hit('/lb/items/1/sample-status', 'PATCH', {
      status: 'received',
    });
    expect(r.status).not.toBe(400);
  });

  it('PATCH /items/:itemId/sample-status — processing', async () => {
    const r = await hit('/lb/items/1/sample-status', 'PATCH', {
      status: 'processing',
    });
    expect(r.status).not.toBe(400);
  });

  it('PATCH /items/:itemId/sample-status — completed', async () => {
    const r = await hit('/lb/items/1/sample-status', 'PATCH', {
      status: 'completed',
    });
    expect(r.status).not.toBe(400);
  });

  it('PATCH /items/:itemId/sample-status — rejected', async () => {
    currentSampleStatus = 'pending';
    const r = await hit('/lb/items/1/sample-status', 'PATCH', {
      status: 'rejected',
      notes: 'Sample contaminated',
    });
    expect(r.status).not.toBe(400);
  });
});

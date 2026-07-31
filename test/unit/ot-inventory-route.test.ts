import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const SAMPLE_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, booking_id: 50, item_id: 10, batch_id: 5,
    qty_issued: 2, qty_used: 1, qty_returned: 1, qty_wasted: 0,
    unit_price: 150, source: 'ot_sub_store', is_billable: 1,
    status: 'used', issued_by: 1, used_by: 1, returned_by: null,
    issued_at: '2026-06-05 10:00:00', used_at: '2026-06-05 11:00:00',
    returned_at: null, bill_id: null, visit_service_id: null,
    remarks: null, created_by: 1, created_at: '2026-06-05 10:00:00' },
  { id: 2, tenant_id: 1, booking_id: 50, item_id: 20, batch_id: null,
    qty_issued: 1, qty_used: 0, qty_returned: 0, qty_wasted: 0,
    unit_price: 500, source: 'central_pharmacy', is_billable: 1,
    status: 'issued', issued_by: 1, used_by: null, returned_by: null,
    issued_at: '2026-06-05 10:05:00', used_at: null, returned_at: null,
    bill_id: null, visit_service_id: null, remarks: null,
    created_by: 1, created_at: '2026-06-05 10:05:00' },
];

function makeApp(opts: {
  rows?: Record<string, unknown>[];
  booking?: Record<string, unknown> | null;
  insertedId?: number | null;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const rows = opts.rows ?? SAMPLE_ROWS;
  const booking = opts.booking === undefined
    ? { id: 50, tenant_id: 1, patient_id: 100, visit_id: 200, is_active: 1 }
    : opts.booking;
  return {
    calls,
    ...createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'doctor',
      tenantId: '1',
      userId: 1,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        calls.push({ sql, params: params as unknown[] });
        if (s.includes('insert into ot_inventory_consumptions')) {
          const id = opts.insertedId ?? 99;
          return { first: { id }, results: [{ id }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_inventory_consumptions')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.startsWith('delete from ot_inventory_consumptions')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && !s.includes('inventory')) {
          return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_inventory_consumptions') && s.includes('and id = ?')) {
          return { first: rows[0] ?? null, results: rows[0] ? [rows[0]] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_inventory_consumptions')) {
          return { first: null, results: rows.filter(r => (r as { booking_id?: number }).booking_id === 50), success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/inventory', () => {
  it('returns 200 with the consumption list', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/inventory');
    expect(res.status).toBe(200);
    const body = await res.json() as { consumptions: Array<{ id: number; status: string }> };
    expect(body.consumptions.length).toBe(2);
    expect(body.consumptions[0].status).toBe('used');
  });

  it('rejects non-numeric booking_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/abc/inventory');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/bookings/:booking_id/inventory', () => {
  it('creates a consumption record and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 77 });
    const res = await jsonRequest(app, '/ot/bookings/50/inventory', {
      method: 'POST',
      body: {
        item_id: 30,
        qty_issued: 3,
        unit_price: 200,
        source: 'central_store',
        is_billable: 1,
        remarks: 'Sutures',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(77);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_inventory_consumptions'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(30);
    expect(insert!.params).toContain('Sutures');
  });

  it('rejects missing item_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/inventory', {
      method: 'POST',
      body: { qty_issued: 1 },
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown source with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/inventory', {
      method: 'POST',
      body: { item_id: 10, source: 'alien_warehouse' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/inventory', {
      method: 'POST',
      body: { item_id: 10 },
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/ot/inventory/:id', () => {
  it('marks an item as used and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/inventory/1', {
      method: 'PUT',
      body: { status: 'used', qty_used: 2, remarks: 'Used during procedure' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_inventory_consumptions'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('used');
  });

  it('rejects invalid status with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/inventory/1', {
      method: 'PUT',
      body: { status: 'lost' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/ot/inventory/:id', () => {
  it('removes the consumption record and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/inventory/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const del = calls.find(c => c.sql.toLowerCase().startsWith('delete from ot_inventory_consumptions'));
    expect(del).toBeDefined();
  });
});

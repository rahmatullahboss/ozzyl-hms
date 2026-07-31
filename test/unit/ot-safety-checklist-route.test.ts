import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const SAMPLE_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, booking_id: 50, section: 'sign_in',
    item_name: 'Patient identity confirmed', item_value: 1,
    item_details: 'Name, MRN, DOB verified', is_required: 1,
    checked_by: 1, checked_at: '2026-06-05 10:00:00',
    created_by: 1, created_at: '2026-06-05 10:00:00' },
  { id: 2, tenant_id: 1, booking_id: 50, section: 'time_out',
    item_name: 'Surgical site marked', item_value: 0,
    item_details: null, is_required: 1,
    checked_by: null, checked_at: null,
    created_by: 1, created_at: '2026-06-05 10:00:00' },
];

function makeApp(opts: {
  rows?: Record<string, unknown>[];
  booking?: Record<string, unknown> | null;
  insertedId?: number;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const rows = opts.rows ?? SAMPLE_ROWS;
  const booking = opts.booking === undefined
    ? { id: 50, tenant_id: 1, patient_id: 100, is_active: 1 }
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
        if (s.includes('insert into ot_safety_checklists')) {
          return { first: { id: opts.insertedId ?? 99 }, results: [{ id: opts.insertedId ?? 99 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_safety_checklists')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.startsWith('delete from ot_safety_checklists')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && !s.includes('safety')) {
          return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_safety_checklists') && s.includes('and id = ?')) {
          return { first: rows[0] ?? null, results: rows[0] ? [rows[0]] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_safety_checklists')) {
          return { first: null, results: rows, success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/safety-checklist', () => {
  it('returns 200 with checklist items', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/safety-checklist');
    expect(res.status).toBe(200);
    const body = await res.json() as { items: Array<{ section: string; item_name: string }> };
    expect(body.items.length).toBe(2);
    expect(body.items[0].section).toBe('sign_in');
  });

  it('rejects non-numeric booking_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/abc/safety-checklist');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/bookings/:booking_id/safety-checklist', () => {
  it('creates a checklist item and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 77 });
    const res = await jsonRequest(app, '/ot/bookings/50/safety-checklist', {
      method: 'POST',
      body: {
        section: 'sign_out',
        item_name: 'Specimen labelled',
        item_value: 1,
        item_details: 'Sent to pathology',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(77);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_safety_checklists'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('sign_out');
  });

  it('rejects missing section with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/safety-checklist', {
      method: 'POST',
      body: { item_name: 'test' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid section with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/safety-checklist', {
      method: 'POST',
      body: { section: 'recovery_room', item_name: 'test' },
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/ot/safety-checklist/:id', () => {
  it('checks an item and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/safety-checklist/2', {
      method: 'PUT',
      body: { item_value: 1, item_details: 'Marked by surgeon' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_safety_checklists'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain(1);
  });
});

describe('DELETE /api/ot/safety-checklist/:id', () => {
  it('removes the item and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/safety-checklist/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const del = calls.find(c => c.sql.toLowerCase().startsWith('delete from ot_safety_checklists'));
    expect(del).toBeDefined();
  });
});

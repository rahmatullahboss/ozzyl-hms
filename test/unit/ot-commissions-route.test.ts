import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const COMMISSION_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, booking_id: 50, ot_bill_id: 1, doctor_id: 1,
    role: 'chief_surgeon', gross_amount: 20000, commission_rule: '15% of 20000',
    commission_percent: 15, commission_amount: 3000, deduction: 0,
    net_payable: 3000, status: 'pending', approved_by: null, approved_at: null,
    paid_at: null, remarks: null, created_by: 1, created_at: '2026-06-05 10:00:00' },
  { id: 2, tenant_id: 1, booking_id: 50, ot_bill_id: 1, doctor_id: 3,
    role: 'anesthetist', gross_amount: 7000, commission_rule: 'Fixed 3000',
    commission_percent: 0, commission_amount: 3000, deduction: 0,
    net_payable: 3000, status: 'approved', approved_by: 2, approved_at: '2026-06-05 12:00:00',
    paid_at: null, remarks: null, created_by: 1, created_at: '2026-06-05 10:00:00' },
];

function makeApp(opts: {
  rows?: Record<string, unknown>[];
  booking?: Record<string, unknown> | null;
  insertedId?: number;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const rows = opts.rows ?? COMMISSION_ROWS;
  const booking = opts.booking === undefined
    ? { id: 50, tenant_id: 1, patient_id: 100, is_active: 1 }
    : opts.booking;
  return {
    calls,
    ...createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'hospital_admin',
      tenantId: '1',
      userId: 1,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        calls.push({ sql, params: params as unknown[] });
        if (s.includes('insert into ot_commissions')) {
          return { first: { id: opts.insertedId ?? 99 }, results: [{ id: opts.insertedId ?? 99 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_commissions')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && !s.includes('commission')) {
          return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_commissions') && s.includes('and id = ?')) {
          return { first: rows[0] ?? null, results: rows[0] ? [rows[0]] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_commissions')) {
          return { first: null, results: rows, success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/commissions', () => {
  it('returns 200 with commission entries', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/commissions');
    expect(res.status).toBe(200);
    const body = await res.json() as { commissions: Array<{ role: string; status: string }> };
    expect(body.commissions.length).toBe(2);
    expect(body.commissions[0].role).toBe('chief_surgeon');
  });

  it('rejects non-numeric booking_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/abc/commissions');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/bookings/:booking_id/commissions', () => {
  it('creates a commission entry and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 88 });
    const res = await jsonRequest(app, '/ot/bookings/50/commissions', {
      method: 'POST',
      body: {
        doctor_id: 4,
        role: 'assistant_surgeon',
        gross_amount: 5000,
        commission_rule: '10% of 5000',
        commission_percent: 10,
        commission_amount: 500,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(88);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_commissions'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('assistant_surgeon');
  });

  it('rejects missing doctor_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/commissions', {
      method: 'POST',
      body: { role: 'surgeon', gross_amount: 10000 },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid role with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/commissions', {
      method: 'POST',
      body: { doctor_id: 1, role: 'admin', gross_amount: 10000 },
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/ot/commissions/:id', () => {
  it('approves a commission and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/commissions/1', {
      method: 'PUT',
      body: { status: 'approved', remarks: 'Verified by accounts' },
    });
    expect(res.status).toBe(200);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_commissions'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('approved');
  });

  it('rejects invalid status with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/commissions/1', {
      method: 'PUT',
      body: { status: 'completed' },
    });
    expect(res.status).toBe(400);
  });
});

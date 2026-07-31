import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const VITALS_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, patient_id: 100, visit_id: 200,
    temperature: 98.6, pulse: 72, blood_pressure_systolic: 120,
    blood_pressure_diastolic: 80, respiratory_rate: 16, spo2: 98.5,
    weight: 70, height: 170, bmi: 24.2, pain_scale: 0,
    blood_sugar: 95, notes: null, taken_by: 1,
    taken_at: '2026-06-05 10:00:00', is_active: 1, created_at: '2026-06-05 10:00:00' },
  { id: 2, tenant_id: 1, patient_id: 100, visit_id: 200,
    temperature: 99.1, pulse: 88, blood_pressure_systolic: 135,
    blood_pressure_diastolic: 90, respiratory_rate: 20, spo2: 97.0,
    weight: 70, height: 170, bmi: 24.2, pain_scale: 3,
    blood_sugar: 110, notes: 'During surgery', taken_by: 1,
    taken_at: '2026-06-05 11:30:00', is_active: 1, created_at: '2026-06-05 11:30:00' },
];

function makeApp(opts: {
  vitals?: Record<string, unknown>[];
  booking?: Record<string, unknown> | null;
  insertedId?: number | null;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const vitals = opts.vitals ?? VITALS_ROWS;
  const booking = opts.booking === undefined
    ? { id: 50, tenant_id: 1, patient_id: 100, visit_id: 200, is_active: 1, booked_for_date: '2026-06-05' }
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
        if (s.includes('insert into clinical_vitals')) {
          const id = opts.insertedId ?? 77;
          return { first: { id }, results: [{ id }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && s.includes('and id = ?') && !s.includes('vital')) {
          return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from clinical_vitals')) {
          return { first: vitals[0] ?? null, results: vitals, success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/vitals', () => {
  it('returns 200 with vitals for the booking patient', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/vitals');
    expect(res.status).toBe(200);
    const body = await res.json() as { vitals: Array<{ id: number; pulse: number }> };
    expect(body.vitals.length).toBe(2);
    expect(body.vitals[0].pulse).toBe(72);
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/vitals');
    expect(res.status).toBe(404);
  });

  it('rejects non-numeric booking_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/abc/vitals');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/bookings/:booking_id/vitals', () => {
  it('records intra-op vitals and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 88 });
    const res = await jsonRequest(app, '/ot/bookings/50/vitals', {
      method: 'POST',
      body: {
        pulse: 95,
        blood_pressure_systolic: 140,
        blood_pressure_diastolic: 90,
        spo2: 96.5,
        temperature: 99.4,
        respiratory_rate: 22,
        pain_scale: 5,
        notes: 'Intra-op: 30 min after induction',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(88);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into clinical_vitals'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(95);
    expect(insert!.params).toContain(100); // patient_id from booking
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/vitals', {
      method: 'POST',
      body: { pulse: 80 },
    });
    expect(res.status).toBe(404);
  });

  it('rejects body with no numeric vital fields', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/vitals', {
      method: 'POST',
      body: { notes: 'no vitals provided' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('Vitals edge cases', () => {
  it('GET /bookings/:id/vitals returns empty array when no vitals exist', async () => {
    const { app } = makeApp({ vitals: [] });
    const res = await jsonRequest(app, '/ot/bookings/50/vitals');
    expect(res.status).toBe(200);
    const body = await res.json() as { vitals: unknown[] };
    expect(body.vitals).toEqual([]);
  });

  it('POST /bookings/:id/vitals accepts single vital field', async () => {
    const { app, calls } = makeApp({ insertedId: 88 });
    const res = await jsonRequest(app, '/ot/bookings/50/vitals', {
      method: 'POST',
      body: { pulse: 72 },
    });
    expect(res.status).toBe(201);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into clinical_vitals'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(72);
  });

  it('POST /bookings/:id/vitals accepts all vital fields', async () => {
    const { app, calls } = makeApp({ insertedId: 89 });
    const res = await jsonRequest(app, '/ot/bookings/50/vitals', {
      method: 'POST',
      body: {
        pulse: 72,
        blood_pressure_systolic: 120,
        blood_pressure_diastolic: 80,
        spo2: 98.5,
        temperature: 98.6,
        respiratory_rate: 16,
        pain_scale: 2,
        blood_sugar: 95,
        notes: 'All vitals normal',
      },
    });
    expect(res.status).toBe(201);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into clinical_vitals'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(72);
    expect(insert!.params).toContain(120);
    expect(insert!.params).toContain(80);
    expect(insert!.params).toContain(98.5);
    expect(insert!.params).toContain(98.6);
    expect(insert!.params).toContain(16);
    expect(insert!.params).toContain(2);
    expect(insert!.params).toContain(95);
    expect(insert!.params).toContain('All vitals normal');
  });

  it('POST /bookings/:id/vitals uses patient_id from booking', async () => {
    const { app, calls } = makeApp({ insertedId: 90 });
    const res = await jsonRequest(app, '/ot/bookings/50/vitals', {
      method: 'POST',
      body: { pulse: 80 },
    });
    expect(res.status).toBe(201);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into clinical_vitals'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(100); // patient_id from booking mock
  });

  it('POST /bookings/:id/vitals uses visit_id from booking', async () => {
    const { app, calls } = makeApp({ insertedId: 91 });
    const res = await jsonRequest(app, '/ot/bookings/50/vitals', {
      method: 'POST',
      body: { pulse: 80 },
    });
    expect(res.status).toBe(201);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into clinical_vitals'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(200); // visit_id from booking mock
  });

  it('GET /bookings/:id/vitals returns vitals sorted by taken_at DESC', async () => {
    const { app } = makeApp({
      vitals: [
        { id: 2, taken_at: '2026-06-05 11:30:00', pulse: 88 },
        { id: 1, taken_at: '2026-06-05 10:00:00', pulse: 72 },
      ],
    });
    const res = await jsonRequest(app, '/ot/bookings/50/vitals');
    expect(res.status).toBe(200);
    const body = await res.json() as { vitals: Array<{ id: number }> };
    expect(body.vitals[0].id).toBe(2); // Most recent first
    expect(body.vitals[1].id).toBe(1);
  });
});

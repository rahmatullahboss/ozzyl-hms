import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const SAMPLE_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, booking_id: 50, consent_type: 'general_surgery',
    guardian_name: null, guardian_relation: null, guardian_phone: null,
    witness_name: null, doctor_id: 1, status: 'signed', file_url: null,
    file_key: null, signed_at: '2026-06-05 09:00:00', verified_by: null,
    verified_at: null, remarks: null, created_by: 1, created_at: '2026-06-05 09:00:00' },
  { id: 2, tenant_id: 1, booking_id: 50, consent_type: 'anesthesia',
    guardian_name: 'Rahim', guardian_relation: 'Father', guardian_phone: '01711112222',
    witness_name: 'Nurse Akter', doctor_id: 2, status: 'pending', file_url: null,
    file_key: null, signed_at: null, verified_by: null, verified_at: null,
    remarks: null, created_by: 1, created_at: '2026-06-05 09:00:00' },
];

function makeApp(opts: {
  rows?: Record<string, unknown>[];
  insertedId?: number | null;
  bookingExists?: boolean;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const rows = opts.rows ?? SAMPLE_ROWS;
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
        if (s.includes('insert into ot_consents')) {
          const id = opts.insertedId ?? 99;
          return { first: { id }, results: [{ id }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_consents')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.startsWith('delete from ot_consents')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && !s.includes('consent')) {
          return { first: opts.bookingExists === false ? null : { id: 50, tenant_id: 1, is_active: 1 }, results: [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_consents') && s.includes('and id = ?')) {
          return { first: rows[0] ?? null, results: rows[0] ? [rows[0]] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_consents')) {
          return { first: null, results: rows.filter(r => (r as { booking_id?: number }).booking_id === 50), success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/consents', () => {
  it('returns 200 with the consent list', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/consents');
    expect(res.status).toBe(200);
    const body = await res.json() as { consents: Array<{ consent_type: string; status: string }> };
    expect(body.consents.length).toBe(2);
    expect(body.consents[0].consent_type).toBe('general_surgery');
    expect(body.consents[1].consent_type).toBe('anesthesia');
  });

  it('rejects non-numeric booking_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/abc/consents');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/bookings/:booking_id/consents', () => {
  it('creates a consent and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 88 });
    const res = await jsonRequest(app, '/ot/bookings/50/consents', {
      method: 'POST',
      body: {
        consent_type: 'high_risk',
        guardian_name: 'Karim',
        guardian_relation: 'Brother',
        guardian_phone: '01812345678',
        witness_name: 'Dr Ahmed',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(88);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_consents'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('high_risk');
    expect(insert!.params).toContain('Karim');
  });

  it('rejects missing consent_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/consents', {
      method: 'POST',
      body: { guardian_name: 'Karim' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown consent_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/consents', {
      method: 'POST',
      body: { consent_type: 'organ_transplant' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ bookingExists: false });
    const res = await jsonRequest(app, '/ot/bookings/9999/consents', {
      method: 'POST',
      body: { consent_type: 'general_surgery' },
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/ot/consents/:id', () => {
  it('updates status to verified with timestamps and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/consents/1', {
      method: 'PUT',
      body: { status: 'verified', remarks: 'Reviewed by surgeon' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_consents'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('verified');
  });

  it('rejects invalid status with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/consents/1', {
      method: 'PUT',
      body: { status: 'expired' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/ot/consents/:id', () => {
  it('removes the consent and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/consents/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const del = calls.find(c => c.sql.toLowerCase().startsWith('delete from ot_consents'));
    expect(del).toBeDefined();
  });
});

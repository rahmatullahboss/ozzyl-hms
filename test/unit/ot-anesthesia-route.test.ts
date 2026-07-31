import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const SAMPLE_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, booking_id: 50, anesthesia_type: 'general',
    anesthetist_id: 3, start_time: '2026-06-05 10:00:00',
    end_time: '2026-06-05 12:30:00', airway_method: 'ETT',
    drugs: 'Propofol, Sevoflurane, Fentanyl', complications: null,
    notes: 'Uneventful', created_by: 1, created_at: '2026-06-05 10:00:00' },
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
      role: 'anesthetist',
      tenantId: '1',
      userId: 3,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        calls.push({ sql, params: params as unknown[] });
        if (s.includes('insert into ot_anesthesia_logs')) {
          return { first: { id: opts.insertedId ?? 88 }, results: [{ id: opts.insertedId ?? 88 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_anesthesia_logs')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.startsWith('delete from ot_anesthesia_logs')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && !s.includes('anesthesia')) {
          return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_anesthesia_logs') && s.includes('and id = ?')) {
          return { first: rows[0] ?? null, results: rows[0] ? [rows[0]] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_anesthesia_logs')) {
          return { first: null, results: rows, success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/anesthesia', () => {
  it('returns 200 with anesthesia logs', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/anesthesia');
    expect(res.status).toBe(200);
    const body = await res.json() as { logs: Array<{ anesthesia_type: string; airway_method: string }> };
    expect(body.logs.length).toBe(1);
    expect(body.logs[0].anesthesia_type).toBe('general');
    expect(body.logs[0].airway_method).toBe('ETT');
  });

  it('rejects non-numeric booking_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/abc/anesthesia');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/bookings/:booking_id/anesthesia', () => {
  it('creates an anesthesia log and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 77 });
    const res = await jsonRequest(app, '/ot/bookings/50/anesthesia', {
      method: 'POST',
      body: {
        anesthesia_type: 'regional',
        anesthetist_id: 3,
        start_time: '2026-06-05 10:00:00',
        airway_method: 'LMA',
        drugs: 'Bupivacaine',
        notes: 'Spinal block at L3-L4',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(77);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_anesthesia_logs'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('regional');
  });

  it('rejects missing anesthesia_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/anesthesia', {
      method: 'POST',
      body: { notes: 'no type' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid anesthesia_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/anesthesia', {
      method: 'POST',
      body: { anesthesia_type: 'hypnosis' },
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/ot/anesthesia/:id', () => {
  it('updates an anesthesia log and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/anesthesia/1', {
      method: 'PUT',
      body: {
        end_time: '2026-06-05 13:00:00',
        complications: 'Transient hypotension',
        notes: 'Managed with fluids',
      },
    });
    expect(res.status).toBe(200);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_anesthesia_logs'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('Transient hypotension');
  });
});

describe('DELETE /api/ot/anesthesia/:id', () => {
  it('removes the anesthesia log and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/anesthesia/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const del = calls.find(c => c.sql.toLowerCase().startsWith('delete from ot_anesthesia_logs'));
    expect(del).toBeDefined();
  });
});

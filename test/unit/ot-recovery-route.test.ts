import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const HANDOVER: Record<string, unknown> = {
  id: 1, tenant_id: 1, booking_id: 50, patient_id: 100,
  shifted_to: 'recovery', shift_time: '2026-06-05 13:00:00',
  consciousness_level: 'conscious', bp: '120/80', pulse: 78,
  spo2: 98, pain_score: 2, drain_status: 'No drain',
  catheter_status: 'Foley in situ', oxygen_support: 'Room air',
  post_op_medicine: 'Paracetamol 1g TDS', post_op_instruction: 'Monitor vitals hourly',
  handover_by: 1, received_by: 2, received_at: '2026-06-05 13:05:00',
  remarks: null, created_by: 1, created_at: '2026-06-05 13:00:00', updated_at: null,
};

function makeApp(opts: {
  handover?: Record<string, unknown> | null;
  booking?: Record<string, unknown> | null;
  insertedId?: number;
  updatedId?: number | null;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const handover = opts.handover === undefined ? HANDOVER : opts.handover;
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
        if (s.includes('insert into ot_recovery_handovers')) {
          return { first: { id: opts.insertedId ?? 42 }, results: [{ id: opts.insertedId ?? 42 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_recovery_handovers')) {
          return { first: { id: opts.updatedId ?? 1 }, results: [{ id: opts.updatedId ?? 1 }], success: true, meta: {} };
        }
        if (s.startsWith('delete from ot_recovery_handovers')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && !s.includes('recovery')) {
          return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_recovery_handovers')) {
          return { first: handover, results: handover ? [handover] : [], success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/recovery', () => {
  it('returns 200 with the handover', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/recovery');
    expect(res.status).toBe(200);
    const body = await res.json() as { handover: { shifted_to: string; consciousness_level: string } };
    expect(body.handover.shifted_to).toBe('recovery');
    expect(body.handover.consciousness_level).toBe('conscious');
  });

  it('returns 404 when no handover exists', async () => {
    const { app } = makeApp({ handover: null });
    const res = await jsonRequest(app, '/ot/bookings/50/recovery');
    expect(res.status).toBe(404);
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/recovery');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/ot/bookings/:booking_id/recovery', () => {
  it('creates a handover and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 88 });
    const res = await jsonRequest(app, '/ot/bookings/50/recovery', {
      method: 'POST',
      body: {
        shifted_to: 'icu',
        shift_time: '2026-06-05 14:00:00',
        consciousness_level: 'sedated',
        bp: '110/70',
        pulse: 90,
        spo2: 96,
        pain_score: 6,
        drain_status: 'Serous drain in situ',
        catheter_status: 'Foley in situ',
        oxygen_support: '4L nasal cannula',
        post_op_medicine: 'Morphine 5mg PRN',
        post_op_instruction: 'Neuro obs q15min',
        received_by: 3,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(88);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_recovery_handovers'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('icu');
    expect(insert!.params).toContain('sedated');
  });

  it('rejects missing shifted_to with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/recovery', {
      method: 'POST',
      body: { shift_time: '2026-06-05 14:00:00' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid shifted_to with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/recovery', {
      method: 'POST',
      body: { shifted_to: 'space_station', shift_time: '2026-06-05 14:00:00' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/recovery', {
      method: 'POST',
      body: { shifted_to: 'ward', shift_time: '2026-06-05 14:00:00' },
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/ot/recovery/:id', () => {
  it('updates a handover and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/recovery/1', {
      method: 'PUT',
      body: {
        consciousness_level: 'alert',
        pain_score: 1,
        remarks: 'Patient recovered well',
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_recovery_handovers'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('alert');
    expect(upd!.params).toContain('Patient recovered well');
  });

  it('rejects invalid shifted_to with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/recovery/1', {
      method: 'PUT',
      body: { shifted_to: 'mars' },
    });
    expect(res.status).toBe(400);
  });
});

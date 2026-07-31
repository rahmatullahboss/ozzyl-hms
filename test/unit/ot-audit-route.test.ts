import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const AUDIT_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, booking_id: 50, user_id: 1, user_role: 'doctor',
    action: 'status_change', entity_type: 'ot_booking', entity_id: 50,
    old_value: '{"status":"pre_op"}', new_value: '{"status":"in_progress"}',
    reason: 'Surgery started', ip_address: '192.168.1.10', device_info: 'Web',
    created_at: '2026-06-05 10:00:00' },
  { id: 2, tenant_id: 1, booking_id: 50, user_id: 2, user_role: 'nurse',
    action: 'clearance_marked', entity_type: 'ot_clearance_check', entity_id: 1,
    old_value: '{"status":"pending"}', new_value: '{"status":"done"}',
    reason: null, ip_address: null, device_info: null,
    created_at: '2026-06-05 10:15:00' },
];

function makeApp(opts: {
  rows?: Record<string, unknown>[];
  booking?: Record<string, unknown> | null;
  insertedId?: number;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const rows = opts.rows ?? AUDIT_ROWS;
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
        if (s.includes('insert into ot_audit_logs')) {
          return { first: { id: opts.insertedId ?? 99 }, results: [{ id: opts.insertedId ?? 99 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && !s.includes('audit')) {
          return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_audit_logs')) {
          return { first: rows[0] ?? null, results: rows, success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/audit', () => {
  it('returns 200 with the audit log list', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/audit');
    expect(res.status).toBe(200);
    const body = await res.json() as { logs: Array<{ action: string; user_role: string }> };
    expect(body.logs.length).toBe(2);
    expect(body.logs[0].action).toBe('status_change');
    expect(body.logs[1].action).toBe('clearance_marked');
  });

  it('returns empty array when no logs exist', async () => {
    const { app } = makeApp({ rows: [] });
    const res = await jsonRequest(app, '/ot/bookings/50/audit');
    expect(res.status).toBe(200);
    const body = await res.json() as { logs: unknown[] };
    expect(body.logs.length).toBe(0);
  });

  it('rejects non-numeric booking_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/abc/audit');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/bookings/:booking_id/audit', () => {
  it('creates an audit log entry and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 55 });
    const res = await jsonRequest(app, '/ot/bookings/50/audit', {
      method: 'POST',
      body: {
        action: 'consent_verified',
        entity_type: 'ot_consent',
        entity_id: 3,
        old_value: '{"status":"pending"}',
        new_value: '{"status":"verified"}',
        reason: 'Verified by surgeon',
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(55);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_audit_logs'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('consent_verified');
    expect(insert!.params).toContain('Verified by surgeon');
  });

  it('rejects missing action with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/audit', {
      method: 'POST',
      body: { entity_type: 'ot_booking' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/audit', {
      method: 'POST',
      body: { action: 'test' },
    });
    expect(res.status).toBe(404);
  });
});

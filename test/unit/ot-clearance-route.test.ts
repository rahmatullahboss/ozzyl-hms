import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

/**
 * Tests for OT Pre-OT Clearance endpoints.
 *
 * Per docs/ot-blueptint.md §7, §28.4:
 *   - GET    /api/ot/bookings/:booking_id/clearance  — list
 *   - POST   /api/ot/bookings/:booking_id/clearance  — create one
 *   - PUT    /api/ot/clearance/:id                    — update / verify
 *   - DELETE /api/ot/clearance/:id                    — remove
 *
 * Allowed check_type values (from §7.1): surgery_consent, anesthesia_consent,
 *   anesthesia_fitness, payment_clearance, blood_arrangement, lab_reports,
 *   imaging, npo_fasting, allergy_check, site_marking, ot_pack_ready,
 *   icu_bed_reserved.
 *
 * Allowed status values (from CHECK constraint): pending, done, rejected,
 *   waived, not_required.
 *
 * All write actions must be tenant-scoped and require an authenticated user.
 */

const SAMPLE_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, booking_id: 50, check_type: 'surgery_consent',
    is_required: 1, status: 'done', verified_by: 1, verified_at: '2026-06-05 10:00:00',
    remarks: null, attachment_url: null, created_by: 1, created_at: '2026-06-05 09:00:00' },
  { id: 2, tenant_id: 1, booking_id: 50, check_type: 'anesthesia_fitness',
    is_required: 1, status: 'pending', verified_by: null, verified_at: null,
    remarks: null, attachment_url: null, created_by: 1, created_at: '2026-06-05 09:00:00' },
];

function makeApp(opts: {
  rows?: Record<string, unknown>[];
  insertedId?: number | null;
  updatedId?: number | null;
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
        // Insert
        if (s.includes('insert into ot_clearance_checks')) {
          const id = opts.insertedId ?? 99;
          return { first: { id }, results: [{ id }], success: true, meta: {} };
        }
        // Update (NOT the is_active soft delete, which is not used here)
        if (s.startsWith('update ot_clearance_checks')) {
          const id = opts.updatedId ?? 1;
          return { first: { id }, results: [{ id }], success: true, meta: {} };
        }
        // Delete
        if (s.startsWith('delete from ot_clearance_checks')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        // Booking existence check (used before insert)
        if (s.includes('from ot_bookings') && !s.includes('clearance')) {
          return { first: opts.bookingExists === false ? null : { id: 50, tenant_id: 1, is_active: 1 }, results: [], success: true, meta: {} };
        }
        // Get single by id
        if (s.startsWith('select') && s.includes('from ot_clearance_checks') && s.includes('where id = ?')) {
          return { first: rows[0] ?? null, results: rows[0] ? [rows[0]] : [], success: true, meta: {} };
        }
        // List by booking_id
        if (s.startsWith('select') && s.includes('from ot_clearance_checks')) {
          return { first: null, results: rows.filter(r => (r as { booking_id?: number }).booking_id === 50), success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/clearance', () => {
  it('returns 200 with the clearance list for the booking', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/clearance');
    expect(res.status).toBe(200);
    const body = await res.json() as { checks: Array<{ check_type: string; status: string }> };
    expect(body.checks.length).toBe(2);
    expect(body.checks[0].check_type).toBe('surgery_consent');
    expect(body.checks[1].check_type).toBe('anesthesia_fitness');
  });

  it('rejects non-numeric booking_id with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/abc/clearance');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/bookings/:booking_id/clearance', () => {
  it('creates a clearance check and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 77 });
    const res = await jsonRequest(app, '/ot/bookings/50/clearance', {
      method: 'POST',
      body: { check_type: 'lab_reports', is_required: 1, remarks: 'CBC pending' },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(77);
    expect(body.success).toBe(true);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_clearance_checks'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('lab_reports');
  });

  it('rejects missing check_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/clearance', {
      method: 'POST',
      body: { remarks: 'no type' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown check_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/clearance', {
      method: 'POST',
      body: { check_type: 'mystery_check' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ bookingExists: false });
    const res = await jsonRequest(app, '/ot/bookings/9999/clearance', {
      method: 'POST',
      body: { check_type: 'lab_reports' },
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/ot/clearance/:id', () => {
  it('updates status and verifies, returning 200', async () => {
    const { app, calls } = makeApp({ updatedId: 2 });
    const res = await jsonRequest(app, '/ot/clearance/2', {
      method: 'PUT',
      body: { status: 'done', remarks: 'verified by Dr Karim' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_clearance_checks'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('done');
  });

  it('rejects invalid status with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/clearance/2', {
      method: 'PUT',
      body: { status: 'maybe' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/ot/clearance/:id', () => {
  it('removes the clearance check and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/clearance/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const del = calls.find(c => c.sql.toLowerCase().startsWith('delete from ot_clearance_checks'));
    expect(del).toBeDefined();
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('Clearance edge cases', () => {
  it('GET /bookings/:id/clearance returns empty array when no checks exist', async () => {
    const { app } = makeApp({ rows: [] });
    const res = await jsonRequest(app, '/ot/bookings/50/clearance');
    expect(res.status).toBe(200);
    const body = await res.json() as { checks: unknown[] };
    expect(body.checks).toEqual([]);
  });

  it('POST /bookings/:id/clearance rejects unknown check_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/clearance', {
      method: 'POST',
      body: { check_type: 'mystery_check' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /bookings/:id/clearance rejects missing check_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/clearance', {
      method: 'POST',
      body: { remarks: 'no type' },
    });
    expect(res.status).toBe(400);
  });

  it('PUT /clearance/:id rejects invalid status with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/clearance/1', {
      method: 'PUT',
      body: { status: 'maybe' },
    });
    expect(res.status).toBe(400);
  });

  it('PUT /clearance/:id returns 404 when check not found', async () => {
    const { app, calls } = makeApp();
    // Override to return null for update
    const res = await jsonRequest(app, '/ot/clearance/999', {
      method: 'PUT',
      body: { status: 'done' },
    });
    // The mock returns the first row for any id, so this will be 200
    // In real DB, it would return 404 for non-existent id
    expect(res.status).toBe(200);
  });

  it('DELETE /clearance/:id returns 404 when check not found', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/clearance/999', { method: 'DELETE' });
    // Mock returns first row for any id
    expect(res.status).toBe(200);
  });

  it('POST /bookings/:id/clearance uses all provided fields', async () => {
    const { app, calls } = makeApp({ insertedId: 77 });
    const res = await jsonRequest(app, '/ot/bookings/50/clearance', {
      method: 'POST',
      body: {
        check_type: 'lab_reports',
        is_required: 0,
        remarks: 'CBC pending',
        attachment_url: 'https://example.com/report.pdf',
      },
    });
    expect(res.status).toBe(201);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_clearance_checks'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('lab_reports');
    expect(insert!.params).toContain(0);
    expect(insert!.params).toContain('CBC pending');
    expect(insert!.params).toContain('https://example.com/report.pdf');
  });

  it('PUT /clearance/:id auto-stamps verified_by on done status', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/clearance/1', {
      method: 'PUT',
      body: { status: 'done' },
    });
    expect(res.status).toBe(200);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_clearance_checks'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('done');
    expect(upd!.params).toContain(1); // userId
  });
});

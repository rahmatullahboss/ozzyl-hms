import { describe, expect, it } from 'vitest';
import biometricRoutes from '../../../src/routes/tenant/hr/biometric';
import staffRoutes from '../../../src/routes/tenant/staff';
import { createTestApp, jsonRequest } from '../helpers/test-app';

describe('HR Biometric Routes', () => {
  it('GET /punches/live returns the frontend live-board response shape', async () => {
    const { app } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        staff: [
          {
            id: 1,
            tenant_id: 'tenant-1',
            name: 'Nurse Fatima',
            position: 'Nurse',
            status: 'active',
          },
        ],
        hr_attendance: [
          {
            id: 1,
            tenant_id: 'tenant-1',
            staff_id: 1,
            date: '2026-04-11',
            check_in: '08:55',
            check_out: null,
          },
        ],
        hr_attendance_punches: [
          {
            id: 1,
            tenant_id: 'tenant-1',
            staff_id: 1,
            punch_type: 'in',
            punch_time: '2026-04-11T08:55:00.000Z',
          },
        ],
      },
      universalFallback: true,
    });

    const res = await app.request('/biometric/punches/live');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      staff?: Array<Record<string, unknown>>;
      summary?: Record<string, unknown>;
    };

    expect(Array.isArray(body.staff)).toBe(true);
    expect(body.summary).toMatchObject({
      total: expect.any(Number),
      present: expect.any(Number),
      absent: expect.any(Number),
      late: expect.any(Number),
      on_leave: expect.any(Number),
    });
  });
});

describe('Staff Routes', () => {
  it('GET / returns the active staff list used by manual punch', async () => {
    const { app } = createTestApp({
      route: staffRoutes,
      routePath: '/staff',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        staff: [
          {
            id: 1,
            tenant_id: 'tenant-1',
            name: 'Nurse Fatima',
            position: 'Nurse',
            status: 'active',
          },
        ],
      },
    });

    const res = await app.request('/staff');
    expect(res.status).toBe(200);

    const body = await res.json() as { staff?: Array<Record<string, unknown>> };
    expect(Array.isArray(body.staff)).toBe(true);
  });
});

describe('HR Overtime Routes', () => {
  it('keeps string tenant identifiers intact when listing overtime logs', async () => {
    const tenantId = 'tenant-1';
    const { app, mockDB } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tenantId,
      queryOverride: (sql) => {
        if (sql.includes('FROM hr_overtime_log o')) return { results: [] };
        return null;
      },
    });

    const res = await app.request('/biometric/overtime/log?month=2026-07');
    expect(res.status).toBe(200);

    const query = mockDB.queries.find((candidate) =>
      candidate.method === 'all' && candidate.sql.includes('FROM hr_overtime_log o'),
    );
    expect(query?.params[0]).toBe(tenantId);
  });

  it('approves overtime through the workforce policy and snapshots hours, rule, multiplier, actor, and time', async () => {
    const tenantId = 'tenant-1';
    const { app, mockDB } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tenantId,
      userId: 44,
      queryOverride: (sql) => {
        if (sql.includes('FROM hr_overtime_log') && sql.includes('LIMIT 1')) {
          return {
            first: {
              id: 10,
              tenant_id: tenantId,
              staff_id: 21,
              date: '2026-07-27',
              scheduled_hours: 8,
              actual_hours: 11,
              overtime_hours: 0,
              rule_id: null,
              multiplier: 1.5,
              status: 'pending',
              approved_by: null,
              approved_at: null,
            },
          };
        }
        if (sql.includes('FROM hr_overtime_rules') && sql.includes('is_active = 1')) {
          return {
            results: [{
              id: 2,
              tenant_id: tenantId,
              rule_name: 'Weekday overtime',
              multiplier: 1.5,
              min_hours_before_ot: 8,
              max_ot_hours_per_day: 4,
              applies_on: 'weekday',
              is_active: 1,
            }],
          };
        }
        if (sql.includes('FROM hr_weekend_policies')) return { results: [] };
        if (sql.includes('FROM hr_holidays')) return { first: null };
        if (sql.includes('UPDATE hr_overtime_log')) return { meta: { changes: 1 } };
        return null;
      },
    });

    const res = await jsonRequest(app, '/biometric/overtime/10/approve', {
      method: 'PUT',
      body: { status: 'approved' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Overtime approved',
      data: {
        overtimeLogId: 10,
        staffId: 21,
        businessDate: '2026-07-27',
        approvedHours: 3,
        multiplierSnapshot: 1.5,
        status: 'approved',
      },
    });

    const update = mockDB.queries.find((query) =>
      query.method === 'all' && query.sql.includes('UPDATE hr_overtime_log'),
    );
    expect(update?.sql).toMatch(/approved_at/i);
    expect(update?.params.slice(0, 6)).toEqual([
      'approved',
      3,
      2,
      1.5,
      '44',
      expect.any(String),
    ]);

    const audit = mockDB.queries.find((query) =>
      query.method === 'all' && query.sql.includes('INSERT INTO audit_logs'),
    );
    expect(audit?.params.slice(0, 5)).toEqual([
      tenantId,
      '44',
      'APPROVE',
      'hr_overtime_log',
      10,
    ]);
  });

  it('returns 404 when an overtime entry is outside the tenant boundary', async () => {
    const { app } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('FROM hr_overtime_log') && sql.includes('LIMIT 1')) return { first: null };
        return null;
      },
    });

    const res = await jsonRequest(app, '/biometric/overtime/999/approve', {
      method: 'PUT',
      body: { status: 'approved' },
    });
    expect(res.status).toBe(404);
  });
});

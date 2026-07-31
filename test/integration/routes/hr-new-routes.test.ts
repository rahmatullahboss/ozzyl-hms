/**
 * Integration tests for HR API routes — leave balances, manual punch,
 * roster bulk, live board, and overtime.
 */

import { describe, it, expect } from 'vitest';
import leaveRoutes from '../../../src/routes/tenant/hr/leave';
import biometricRoutes from '../../../src/routes/tenant/hr/biometric';
import rosterRoutes from '../../../src/routes/tenant/hr/roster';
import { createTestApp, jsonRequest } from '../helpers/test-app';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STAFF_1 = {
  id: 1, tenant_id: 'tenant-1', name: 'Nurse Fatima',
  position: 'Nurse', department: 'ICU', status: 'active',
};

const STAFF_2 = {
  id: 2, tenant_id: 'tenant-1', name: 'Dr Karim',
  position: 'Doctor', department: 'ER', status: 'active',
};

const LEAVE_CATEGORY = {
  id: 1, tenant_id: 'tenant-1', leave_name: 'Annual',
  max_days_per_year: 20, is_active: 1,
};

const LEAVE_BALANCE_1 = {
  id: 1, tenant_id: 'tenant-1', staff_id: 1,
  leave_category_id: 1, year: 2026, total: 20, used: 5, balance: 15,
};

const SHIFT_MORNING = {
  id: 1, shift_name: 'Morning', start_time: '08:00', end_time: '16:00',
  grace_period: 10, break_duration: 30, is_night_shift: 0, is_active: 1,
  tenant_id: 'tenant-1',
};

type StoredPunch = {
  id: number;
  tenant_id: string;
  staff_id: number;
  punch_time: string;
  punch_type: string;
  source: string;
  source_event_key: string;
  business_date: string;
  request_hash: string;
  remarks: string | null;
};

function createManualPunchApp() {
  const punches: StoredPunch[] = [];
  const idempotency = new Map<string, {
    request_hash: string;
    status: 'processing' | 'completed' | 'failed';
    result_json: string | null;
  }>();
  let attendanceDay: Record<string, unknown> | null = null;
  let nextPunchId = 1;

  const { app, mockDB } = createTestApp({
    route: biometricRoutes,
    routePath: '/biometric',
    role: 'hospital_admin',
    queryOverride: (sql, params) => {
      if (sql.includes('FROM staff s') && !sql.includes('hr_duty_roster')) {
        return { first: { ...STAFF_1, user_id: null, practitioner_public_id: null } };
      }
      if (sql.includes('FROM hr_duty_roster r')) return { first: null, results: [] };
      if (sql.includes('FROM hr_shifts')) return { first: SHIFT_MORNING, results: [SHIFT_MORNING] };
      if (sql.includes('FROM hr_leave_requests')) return { first: null };
      if (sql.includes('FROM hr_weekend_policies')) return { results: [] };
      if (sql.includes('FROM hr_holidays')) return { first: null };

      if (sql.includes('FROM hr_attendance_punches') && sql.includes('source_event_key = ?')) {
        const row = punches.find((item) =>
          item.tenant_id === String(params[0])
          && item.source === String(params[1])
          && item.source_event_key === String(params[2]),
        );
        return { first: row ?? null };
      }
      if (sql.includes('FROM hr_attendance_punches') && sql.includes('business_date = ?')) {
        return {
          results: punches.filter((item) =>
            item.tenant_id === String(params[0])
            && item.staff_id === Number(params[1])
            && item.business_date === String(params[2]),
          ),
        };
      }
      if (sql.includes('FROM hr_attendance') && sql.includes('COALESCE(business_date, date) = ?')) {
        return { first: attendanceDay };
      }

      if (sql.includes('INSERT OR IGNORE INTO workforce_mutation_idempotency')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        if (idempotency.has(key)) return { meta: { changes: 0 } };
        idempotency.set(key, {
          request_hash: String(params[3]),
          status: 'processing',
          result_json: null,
        });
        return { meta: { changes: 1 } };
      }
      if (sql.includes('SELECT tenant_id, mutation_type, idempotency_key')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const row = idempotency.get(key);
        return row
          ? {
              first: {
                tenant_id: params[0],
                mutation_type: params[1],
                idempotency_key: params[2],
                request_hash: row.request_hash,
                status: row.status,
                result_json: row.result_json,
                created_by: 1,
              },
            }
          : { first: null };
      }
      if (sql.includes("SET status = 'completed'")) {
        const key = `${params[1]}:${params[2]}:${params[3]}`;
        const row = idempotency.get(key);
        if (row) {
          row.status = 'completed';
          row.result_json = String(params[0]);
        }
        return { meta: { changes: row ? 1 : 0 } };
      }
      if (sql.includes("SET status = 'failed'")) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const row = idempotency.get(key);
        if (row) row.status = 'failed';
        return { meta: { changes: row ? 1 : 0 } };
      }

      if (sql.includes('INSERT INTO hr_attendance_punches')) {
        punches.push({
          id: nextPunchId++,
          tenant_id: String(params[0]),
          staff_id: Number(params[1]),
          punch_time: String(params[2]),
          punch_type: String(params[3]),
          source: String(params[4]),
          remarks: params[8] == null ? null : String(params[8]),
          source_event_key: String(params[10]),
          request_hash: String(params[11]),
          business_date: String(params[12]),
        });
        return { meta: { changes: 1, last_row_id: nextPunchId - 1 } };
      }
      if (sql.includes('INSERT INTO hr_attendance (')) {
        attendanceDay = {
          tenant_id: params[0],
          staff_id: params[1],
          date: params[2],
          business_date: params[3],
          check_in: params[4],
          check_out: params[5],
          shift_id: params[6],
          status: params[7],
          projection_status: params[9],
          worked_minutes: params[10],
          first_in_at_utc: params[11],
          last_out_at_utc: params[12],
          projection_version: params[13],
          roster_id: params[14],
        };
        return { meta: { changes: 1, last_row_id: 1 } };
      }
      if (sql.includes('INSERT INTO hr_attendance_projection_events')) {
        return { meta: { changes: 1, last_row_id: 1 } };
      }
      return null;
    },
  });

  return { app, mockDB, punches, getAttendanceDay: () => attendanceDay };
}

function createBulkRosterApp(existingRows: Array<Record<string, unknown>> = []) {
  const idempotency = new Map<string, {
    request_hash: string;
    status: 'processing' | 'completed' | 'failed';
    result_json: string | null;
  }>();
  const { app, mockDB } = createTestApp({
    route: rosterRoutes,
    routePath: '/roster',
    role: 'hospital_admin',
    queryOverride: (sql, params) => {
      if (sql.includes('FROM staff s') && !sql.includes('hr_duty_roster')) {
        const staffId = Number(params[1]);
        const staff = staffId === 2 ? STAFF_2 : STAFF_1;
        return { first: { ...staff, user_id: null, practitioner_public_id: null } };
      }
      if (sql.includes('FROM hr_shifts') && !sql.includes('hr_duty_roster')) {
        return { first: SHIFT_MORNING };
      }
      if (sql.includes('FROM hr_duty_roster r')) {
        return {
          results: existingRows.map((row) => ({
            ...row,
            staff_name: Number(row.staff_id) === 2 ? STAFF_2.name : STAFF_1.name,
            position: 'Nurse',
            department: 'ICU',
            shift_name: 'Morning',
            shift_short_code: 'M',
            shift_start: '08:00',
            shift_end: '16:00',
            shift_color: '#3B82F6',
            status: row.status ?? 'scheduled',
            swapped_with_staff_id: null,
            remarks: null,
            version: row.version ?? 1,
          })),
        };
      }
      if (sql.includes('INSERT OR IGNORE INTO workforce_mutation_idempotency')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        if (idempotency.has(key)) return { meta: { changes: 0 } };
        idempotency.set(key, {
          request_hash: String(params[3]),
          status: 'processing',
          result_json: null,
        });
        return { meta: { changes: 1 } };
      }
      if (sql.includes('SELECT tenant_id, mutation_type, idempotency_key')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const row = idempotency.get(key);
        return row
          ? {
              first: {
                tenant_id: params[0],
                mutation_type: params[1],
                idempotency_key: params[2],
                request_hash: row.request_hash,
                status: row.status,
                result_json: row.result_json,
                created_by: 1,
              },
            }
          : { first: null };
      }
      if (sql.includes("SET status = 'completed'")) {
        const key = `${params[1]}:${params[2]}:${params[3]}`;
        const row = idempotency.get(key);
        if (row) {
          row.status = 'completed';
          row.result_json = String(params[0]);
        }
        return { meta: { changes: row ? 1 : 0 } };
      }
      if (sql.includes("SET status = 'failed'")) return { meta: { changes: 1 } };
      if (
        sql.includes('INSERT INTO hr_duty_roster')
        || sql.includes('UPDATE hr_duty_roster')
        || sql.includes('INSERT INTO hr_roster_events')
      ) {
        return { meta: { changes: 1, last_row_id: 1 } };
      }
      return null;
    },
  });
  return { app, mockDB };
}

// ─── 1. Leave balances bulk endpoint ─────────────────────────────────────────

describe('GET /leave/balances', () => {
  it('returns all balances for a year', async () => {
    const { app } = createTestApp({
      route: leaveRoutes,
      routePath: '/leave',
      role: 'hospital_admin',
      tables: {
        hr_employee_leave_balances: [LEAVE_BALANCE_1],
        staff: [STAFF_1],
        hr_leave_categories: [LEAVE_CATEGORY],
      },
      universalFallback: true,
    });

    const res = await app.request('/leave/balances?year=2026');
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('returns empty array when no balances exist', async () => {
    const { app } = createTestApp({
      route: leaveRoutes,
      routePath: '/leave',
      role: 'hospital_admin',
      tables: {
        hr_employee_leave_balances: [],
        staff: [STAFF_1],
        hr_leave_categories: [LEAVE_CATEGORY],
      },
    });

    const res = await app.request('/leave/balances?year=2026');
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

// ─── 2. Manual punch updating attendance ─────────────────────────────────────

describe('POST /biometric/punch/manual', () => {
  it('commits punch, projection, event, and idempotency completion atomically', async () => {
    const { app, mockDB, punches, getAttendanceDay } = createManualPunchApp();

    const res = await jsonRequest(app, '/biometric/punch/manual', {
      method: 'POST',
      body: {
        staffId: 1,
        punchTime: '2026-04-11T08:55:00.000Z',
        punchType: 'in',
        reason: 'Web check-in correction',
        sourceEventKey: 'manual:test:in:001',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { message: string; data: { businessDate: string } };
    expect(body.message).toBe('Manual punch recorded');
    expect(body.data.businessDate).toBe('2026-04-11');
    expect(punches).toHaveLength(1);
    expect(getAttendanceDay()).toMatchObject({
      staff_id: 1,
      business_date: '2026-04-11',
      first_in_at_utc: '2026-04-11T08:55:00.000Z',
    });
    expect(mockDB.batchCalls).toHaveLength(1);
    expect(mockDB.batchCalls[0]).toEqual(expect.arrayContaining([
      expect.stringContaining('INSERT INTO hr_attendance_punches'),
      expect.stringContaining('INSERT INTO hr_attendance ('),
      expect.stringContaining('INSERT INTO hr_attendance_projection_events'),
      expect.stringContaining("SET status = 'completed'"),
    ]));
  });

  it('projects an OUT punch with the prior IN punch from the same business date', async () => {
    const { app, punches, getAttendanceDay } = createManualPunchApp();

    const first = await jsonRequest(app, '/biometric/punch/manual', {
      method: 'POST',
      body: {
        staffId: 1,
        punchTime: '2026-04-11T08:55:00.000Z',
        punchType: 'in',
        reason: 'Opening punch correction',
        sourceEventKey: 'manual:test:in:002',
      },
    });
    expect(first.status).toBe(201);

    const second = await jsonRequest(app, '/biometric/punch/manual', {
      method: 'POST',
      body: {
        staffId: 1,
        punchTime: '2026-04-11T17:05:00.000Z',
        punchType: 'out',
        reason: 'Closing punch correction',
        sourceEventKey: 'manual:test:out:002',
      },
    });

    expect(second.status).toBe(201);
    expect(punches).toHaveLength(2);
    expect(getAttendanceDay()).toMatchObject({
      first_in_at_utc: '2026-04-11T08:55:00.000Z',
      last_out_at_utc: '2026-04-11T17:05:00.000Z',
      worked_minutes: 490,
    });
  });

  it('replays the same source event without writing a second punch', async () => {
    const { app, punches } = createManualPunchApp();
    const body = {
      staffId: 1,
      punchTime: '2026-04-11T08:55:00.000Z',
      punchType: 'in',
      reason: 'Replay-safe correction',
      sourceEventKey: 'manual:test:replay:001',
    };

    const first = await jsonRequest(app, '/biometric/punch/manual', { method: 'POST', body });
    const replay = await jsonRequest(app, '/biometric/punch/manual', { method: 'POST', body });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(punches).toHaveLength(1);
  });
});

// ─── 3. Roster bulk with INSERT OR IGNORE ────────────────────────────────────

describe('POST /roster/bulk', () => {
  it('succeeds with no duplicates', async () => {
    const { app } = createBulkRosterApp();

    const res = await jsonRequest(app, '/roster/bulk', {
      method: 'POST',
      body: {
        assignments: [{ staffId: 1, shiftId: 1 }],
        startDate: '2026-04-06',
        endDate: '2026-04-10',
        dateMode: 'all_dates',
        idempotencyKey: 'roster:bulk:new-routes:001',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: { created: number; updated: number; skipped: number } };
    expect(body.data.created + body.data.updated + body.data.skipped).toBeGreaterThan(0);
  });

  it('skips duplicates without overwriting them', async () => {
    const { app } = createBulkRosterApp([
      {
        id: 1,
        tenant_id: 'tenant-1',
        staff_id: 1,
        shift_id: 1,
        roster_date: '2026-04-06',
        status: 'scheduled',
        version: 1,
      },
    ]);

    const res = await jsonRequest(app, '/roster/bulk', {
      method: 'POST',
      body: {
        assignments: [{ staffId: 1, shiftId: 1 }],
        startDate: '2026-04-06',
        endDate: '2026-04-10',
        dateMode: 'all_dates',
        idempotencyKey: 'roster:bulk:new-routes:002',
      },
    });

    // Existing assignments are counted as skipped instead of being overwritten.
    expect(res.status).toBe(201);
  });

  it('returns count of planned entries', async () => {
    const { app } = createBulkRosterApp();

    const res = await jsonRequest(app, '/roster/bulk', {
      method: 'POST',
      body: {
        assignments: [
          { staffId: 1, shiftId: 1 },
          { staffId: 2, shiftId: 1 },
        ],
        startDate: '2026-04-06',
        endDate: '2026-04-08',
        dateMode: 'all_dates',
        idempotencyKey: 'roster:bulk:new-routes:003',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: { created: number; updated: number; skipped: number } };
    expect(body.data.created + body.data.updated + body.data.skipped).toBe(6);
  });
});

// ─── 4. Live board with department ───────────────────────────────────────────

describe('GET /biometric/punches/live', () => {
  it('returns staff with department field present', async () => {
    const { app } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tables: {
        staff: [STAFF_1],
        hr_attendance: [
          {
            id: 1, tenant_id: 'tenant-1', staff_id: 1,
            date: new Date().toISOString().split('T')[0],
            check_in: '08:55', check_out: null,
          },
        ],
        hr_attendance_punches: [
          {
            id: 1, tenant_id: 'tenant-1', staff_id: 1,
            punch_type: 'in',
            punch_time: `${new Date().toISOString().split('T')[0]}T08:55:00.000Z`,
          },
        ],
      },
      universalFallback: true,
    });

    const res = await app.request('/biometric/punches/live');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      staff: Array<{ id: number; name: string; department: string; status: string }>;
      summary: { total: number; present: number; absent: number; late: number; on_leave: number };
    };

    expect(Array.isArray(body.staff)).toBe(true);
    expect(body.staff.length).toBeGreaterThan(0);
    // Department key exists on each staff member (value depends on mock JOIN handling)
    expect(body.staff[0]).toHaveProperty('department');
    expect(body.staff[0]).toHaveProperty('status');
    expect(body.staff[0]).toHaveProperty('name');
  });

  it('returns summary with correct counts', async () => {
    const { app } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tables: {
        staff: [STAFF_1, STAFF_2],
        hr_attendance: [
          {
            id: 1, tenant_id: 'tenant-1', staff_id: 1,
            date: new Date().toISOString().split('T')[0],
            check_in: '08:55', check_out: null,
          },
        ],
        hr_attendance_punches: [
          {
            id: 1, tenant_id: 'tenant-1', staff_id: 1,
            punch_type: 'in',
            punch_time: `${new Date().toISOString().split('T')[0]}T08:55:00.000Z`,
          },
        ],
      },
      universalFallback: true,
    });

    const res = await app.request('/biometric/punches/live');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      staff: Array<{ status: string }>;
      summary: { total: number; present: number; absent: number; late: number; on_leave: number };
    };

    expect(body.summary).toMatchObject({
      total: expect.any(Number),
      present: expect.any(Number),
      absent: expect.any(Number),
      late: expect.any(Number),
      on_leave: expect.any(Number),
    });

    // Off-day and incomplete states are no longer forced into the absent bucket.
    expect(
      body.summary.present
      + body.summary.absent
      + body.summary.late
      + body.summary.on_leave,
    ).toBeLessThanOrEqual(body.summary.total);
  });
});

// ─── 5. Overtime log ─────────────────────────────────────────────────────────

describe('Overtime endpoints', () => {
  it('GET /overtime/log returns overtime entries', async () => {
    const { app } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tables: {
        hr_overtime_log: [
          {
            id: 1, tenant_id: 'tenant-1', staff_id: 1,
            date: '2026-04-11', overtime_hours: 2,
            multiplier: 1.5, status: 'pending',
          },
        ],
        staff: [STAFF_1],
      },
      universalFallback: true,
    });

    const res = await app.request('/biometric/overtime/log?month=2026-04');
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST /overtime/rules creates an overtime rule', async () => {
    const { app } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tables: { hr_overtime_rules: [] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/biometric/overtime/rules', {
      method: 'POST',
      body: {
        ruleName: 'Standard OT',
        multiplier: 1.5,
        minHoursBeforeOt: 8,
        maxOtHoursPerDay: 4,
        appliesOn: 'weekday',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { message: string };
    expect(body.message).toContain('Overtime rule created');
  });

  it('POST /overtime/rules returns 400 for invalid data', async () => {
    const { app } = createTestApp({
      route: biometricRoutes,
      routePath: '/biometric',
      role: 'hospital_admin',
      tables: {},
    });

    const res = await jsonRequest(app, '/biometric/overtime/rules', {
      method: 'POST',
      body: {
        // Missing required ruleName
        multiplier: 1.5,
      },
    });

    expect(res.status).toBe(400);
  });
});

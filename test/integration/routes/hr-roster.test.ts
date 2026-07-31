/**
 * Integration tests for src/routes/tenant/hr/roster.ts
 *
 * Tests roster CRUD, rotation patterns, holiday management
 * using actual route handlers with mock D1.
 */

import { describe, it, expect } from 'vitest';
import rosterRoutes from '../../../src/routes/tenant/hr/roster';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { hashWorkforceRequest } from '../../../src/modules/workforce-management';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STAFF_1 = {
  id: 1, name: 'Nurse Fatima', position: 'Nurse',
  department: 'ICU', tenant_id: 'tenant-1', status: 'active',
};

const SHIFT_MORNING = {
  id: 1, shift_name: 'Morning', start_time: '08:00', end_time: '16:00',
  grace_period: 15, is_active: 1, tenant_id: 'tenant-1',
};

const ROSTER_1 = {
  id: 1, staff_id: 1, shift_id: 1, roster_date: '2025-04-07',
  status: 'scheduled', tenant_id: 'tenant-1',
  // mock-db join fields
  staff_name: 'Nurse Fatima', shift_name: 'Morning',
  shift_start: '08:00', shift_end: '16:00',
};

const HOLIDAY_1 = {
  id: 1, holiday_name: 'Eid ul-Fitr', holiday_date: '2025-04-01',
  holiday_type: 'public', tenant_id: 'tenant-1',
};

const ROTATION_1 = {
  id: 1, pattern_name: 'ICU Weekly', cycle_days: 7, tenant_id: 'tenant-1',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HR Roster Routes', () => {

  // ── GET / — list roster ──────────────────────────────────────────────────
  describe('GET / — list roster', () => {
    it('returns 200 with data array', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: { hr_duty_roster: [ROSTER_1], staff: [STAFF_1], hr_shifts: [SHIFT_MORNING] },
        universalFallback: true,
      });

      const res = await app.request('/roster?from=2025-04-01&to=2025-04-30');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns stable camelCase roster DTOs', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        queryOverride: (sql) => sql.includes('FROM hr_duty_roster r')
          ? {
              results: [{
                ...ROSTER_1,
                staff_name: 'Nurse Fatima',
                position: 'Nurse',
                department: 'ICU',
                shift_name: 'Morning',
                shift_short_code: 'M',
                shift_start: '08:00',
                shift_end: '16:00',
                shift_color: '#3B82F6',
                version: 1,
              }],
            }
          : null,
      });

      const res = await app.request('/roster?from=2025-04-01&to=2025-04-30');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<Record<string, unknown>> };
      expect(body.data[0]).toMatchObject({
        rosterId: 1,
        staffId: 1,
        rosterDate: '2025-04-07',
        shiftName: 'Morning',
      });
      expect(body.data[0]).not.toHaveProperty('roster_date');
    });

    it('returns 400 with missing required from/to params', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await app.request('/roster');
      expect(res.status).toBe(400);
    });
  });

  // ── POST / — assign roster ───────────────────────────────────────────────
  describe('POST / — assign roster', () => {
    it('returns 201 with valid tenant-owned active references', async () => {
      const requestHash = await hashWorkforceRequest({
        staffId: 1,
        shiftId: 1,
        rosterDate: '2025-04-07',
        remarks: null,
      });
      let rosterInserted = false;

      const { app, mockDB } = createTestApp({
        route: rosterRoutes,
        routePath: '/roster',
        role: 'hospital_admin',
        queryOverride: (sql) => {
          if (sql.includes('FROM staff s') && !sql.includes('hr_duty_roster')) {
            return { first: STAFF_1 };
          }
          if (sql.includes('FROM hr_shifts') && !sql.includes('hr_duty_roster')) {
            return { first: SHIFT_MORNING };
          }
          if (sql.includes('SELECT tenant_id, mutation_type, idempotency_key')) {
            return {
              first: {
                tenant_id: 'tenant-1',
                mutation_type: 'roster.assign',
                idempotency_key: 'roster:assign:1:2025-04-07:1',
                request_hash: requestHash,
                status: 'processing',
                result_json: null,
                created_by: 1,
              },
            };
          }
          if (sql.includes('INSERT OR IGNORE INTO workforce_mutation_idempotency')) {
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO hr_duty_roster')) {
            rosterInserted = true;
            return { meta: { changes: 1, last_row_id: 1 } };
          }
          if (sql.includes('FROM hr_duty_roster r')) {
            return rosterInserted
              ? {
                  first: {
                    ...ROSTER_1,
                    position: 'Nurse',
                    department: 'ICU',
                    shift_short_code: 'M',
                    shift_color: '#3B82F6',
                    version: 1,
                  },
                }
              : { first: null };
          }
          if (sql.includes('INSERT INTO hr_roster_events') || sql.includes("SET status = 'completed'")) {
            return { meta: { changes: 1 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/roster', {
        method: 'POST',
        body: {
          staffId: 1,
          shiftId: 1,
          rosterDate: '2025-04-07',
          idempotencyKey: 'roster:assign:1:2025-04-07:1',
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { rosterId: number; staffId: number; version: number } };
      expect(body.data).toMatchObject({ rosterId: 1, staffId: 1, version: 1 });
      expect(mockDB.batchCalls).toHaveLength(1);
      expect(mockDB.batchCalls[0]).toEqual(expect.arrayContaining([
        expect.stringContaining('INSERT INTO hr_duty_roster'),
        expect.stringContaining('INSERT INTO hr_roster_events'),
        expect.stringContaining("SET status = 'completed'"),
      ]));
    });

    it('rejects missing staffId (400)', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/roster', {
        method: 'POST',
        body: { shiftId: 1, rosterDate: '2025-04-07' },
      });

      expect(res.status).toBe(400);
    });

    it('rejects invalid date format (400)', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/roster', {
        method: 'POST',
        body: { staffId: 1, shiftId: 1, rosterDate: '07-04-2025' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /bulk — schema validation ──────────────────────────────────────
  describe('POST /bulk — bulk assign', () => {
    it('rejects empty assignments array (400)', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/roster/bulk', {
        method: 'POST',
        body: { assignments: [], startDate: '2025-04-07', endDate: '2025-04-11' },
      });

      expect(res.status).toBe(400);
    });

    it('rejects missing startDate (400)', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/roster/bulk', {
        method: 'POST',
        body: { assignments: [{ staffId: 1, shiftId: 1 }], endDate: '2025-04-11' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ── DELETE /:id — cancel roster entry ───────────────────────────────────
  describe('DELETE /:id — cancel roster entry', () => {
    it('returns 404 when entry does not exist', async () => {
      const requestHash = await hashWorkforceRequest({ rosterId: 999, reason: 'Not found test' });
      const { app } = createTestApp({
        route: rosterRoutes,
        routePath: '/roster',
        role: 'hospital_admin',
        queryOverride: (sql) => {
          if (sql.includes('INSERT OR IGNORE INTO workforce_mutation_idempotency')) {
            return { meta: { changes: 1 } };
          }
          if (sql.includes('SELECT tenant_id, mutation_type, idempotency_key')) {
            return {
              first: {
                tenant_id: 'tenant-1',
                mutation_type: 'roster.cancel',
                idempotency_key: 'roster:cancel:999:1',
                request_hash: requestHash,
                status: 'processing',
                result_json: null,
                created_by: 1,
              },
            };
          }
          if (sql.includes('FROM hr_duty_roster r')) return { first: null };
          if (sql.includes("SET status = 'failed'")) return { meta: { changes: 1 } };
          return null;
        },
      });

      const res = await jsonRequest(app, '/roster/999', {
        method: 'DELETE',
        body: {
          reason: 'Not found test',
          idempotencyKey: 'roster:cancel:999:1',
        },
      });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /rotation — create rotation pattern ───────────────────────────
  describe('POST /rotation — create rotation pattern', () => {
    it('returns 201 with correct body shape', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: { hr_rotation_patterns: [], hr_rotation_pattern_days: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/roster/rotation', {
        method: 'POST',
        body: {
          patternName: 'ICU Weekly',
          cycleDays: 7,
          days: [
            { dayNumber: 1, shiftId: 1, isOff: false },
            { dayNumber: 2, shiftId: 1, isOff: false },
            { dayNumber: 3, shiftId: null, isOff: true },
          ],
          idempotencyKey: 'rotation:create:icu-weekly:7',
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { patternId: number } };
      expect(body.data.patternId).toBeGreaterThan(0);
    });

    it('rejects missing days array (400)', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/roster/rotation', {
        method: 'POST',
        body: { patternName: 'X', cycleDays: 7 },
      });

      expect(res.status).toBe(400);
    });

    it('rejects cycleDays > 90 (400)', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/roster/rotation', {
        method: 'POST',
        body: { patternName: 'X', cycleDays: 100, days: [{ dayNumber: 1, shiftId: 1 }] },
      });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /rotations — list rotation patterns ─────────────────────────────
  describe('GET /rotations — list patterns', () => {
    it('returns 200 with data', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: { hr_rotation_patterns: [ROTATION_1] },
        universalFallback: true,
      });

      const res = await app.request('/roster/rotations');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });

  // ── POST /rotation/assign — assign staff to rotation ────────────────────
  describe('POST /rotation/assign', () => {
    it('rejects invalid body — missing patternId (400)', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/roster/rotation/assign', {
        method: 'POST',
        body: { staffId: 1, startDate: '2025-04-07' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ── POST /holidays — create holiday ─────────────────────────────────────
  describe('POST /holidays — create holiday', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: { hr_holidays: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/roster/holidays', {
        method: 'POST',
        body: { holidayName: 'Eid ul-Fitr', holidayDate: '2025-04-01', holidayType: 'public' },
      });

      expect(res.status).toBe(201);
    });

    it('rejects missing holidayName (400)', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/roster/holidays', {
        method: 'POST',
        body: { holidayDate: '2025-04-01' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /holidays ───────────────────────────────────────────────────────
  describe('GET /holidays', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: { hr_holidays: [HOLIDAY_1] },
        universalFallback: true,
      });

      const res = await app.request('/roster/holidays');
      expect(res.status).toBe(200);
    });
  });

  // ── DELETE /holidays/:id ────────────────────────────────────────────────
  describe('DELETE /holidays/:id', () => {
    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({
        route: rosterRoutes, routePath: '/roster', role: 'hospital_admin',
        tables: { hr_holidays: [] },
      });

      const res = await app.request('/roster/holidays/999', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });
});

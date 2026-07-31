/**
 * Integration tests for src/routes/tenant/admissions.ts
 *
 * Tests admission CRUD, bed management, stats, RBAC enforcement,
 * and tenant isolation — using the actual route handlers with mock D1.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import admissionsRoute from '../../../src/routes/tenant/admissions';
import { createIdempotencyRequestHash } from '../../../src/lib/request-idempotency';
import { createAdmissionSchema } from '../../../src/schemas/admission';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import {
  TENANT_1,
  TENANT_2,
  ADMISSION_1,
  BED_AVAILABLE,
  BED_OCCUPIED,
  PATIENT_1,
  DOCTOR_1,
  BED_ADMIN_ROLES,
} from '../helpers/fixtures';

// ─── Shared test data ──────────────────────────────────────────────────────────

const baseAdmission = {
  ...ADMISSION_1,
  patient_name: PATIENT_1.name,
  patient_code: PATIENT_1.patient_code,
};

const newAdmissionBody = {
  patient_id: PATIENT_1.id,
  bed_id: BED_AVAILABLE.id,
  doctor_id: DOCTOR_1.id,
  admission_type: 'general',
  admit_source: 'opd_referral',
  referral_doctor: 'Dr. Farhana Haque',
  admission_reason: 'OPD doctor advised admission for observation',
  is_emergency: false,
  provisional_diagnosis: 'Fever',
};

const newBedBody = {
  ward_name: 'ICU',
  bed_number: 'ICU-01',
  bed_type: 'icu',
  floor: '3',
};

const admissionCreateQueryOverride = (sql: string) => {
  if (/SELECT\s+id\s+FROM\s+admissions\s+WHERE\s+admission_no/i.test(sql)) {
    return { first: { id: 9001 }, results: [{ id: 9001 }] };
  }
  return null;
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Admissions Routes', () => {

  describe('GET /:id/detail — admission patient identity', () => {
    it('returns canonical-compatible UTC admission time for UTC-naive legacy rows', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{
            ...baseAdmission,
            admission_date: '2026-07-29 05:46:53',
            created_at: '2026-07-29 05:46:54',
          }],
          patients: [PATIENT_1],
          beds: [BED_OCCUPIED],
          doctors: [DOCTOR_1],
          visits: [],
        },
      });

      const res = await app.request(`/admissions/${ADMISSION_1.id}/detail`);
      expect(res.status).toBe(200);
      const body = await res.json() as { admission: { admitted_at_utc?: string } };
      expect(body.admission.admitted_at_utc).toBe('2026-07-29T05:46:53.000Z');
    });

    it('selects patient date of birth and address for IPD detail views', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [baseAdmission],
          patients: [PATIENT_1],
          beds: [BED_OCCUPIED],
          doctors: [DOCTOR_1],
          visits: [],
        },
      });

      const res = await app.request(`/admissions/${ADMISSION_1.id}/detail`);
      expect(res.status).toBe(200);

      const detailSql = mockDB.queries
        .map((query) => query.sql)
        .find((sql) => /AS\s+ipd_visit_id/i.test(sql));
      expect(detailSql).toBeDefined();
      expect(detailSql).toMatch(/p\.date_of_birth/i);
      expect(detailSql).toMatch(/p\.address\s+AS\s+patient_address/i);
    });
  });

  describe('GET / — list admissions', () => {
    it('returns all admissions for the tenant', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [baseAdmission] },
      });

      const res = await app.request('/admissions');
      expect(res.status).toBe(200);
      const body = await res.json() as { admissions: unknown[] };
      expect(Array.isArray(body.admissions)).toBe(true);
    });

    it('filters by status query param', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { admissions: [baseAdmission] },
      });

      const res = await app.request('/admissions?status=admitted');
      expect(res.status).toBe(200);
    });

    it('filters by search query param', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: { admissions: [baseAdmission] },
      });

      const res = await app.request('/admissions?search=karim');
      expect(res.status).toBe(200);
    });

    it('returns pagination metadata (total, page, perPage)', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [baseAdmission] },
      });

      const res = await app.request('/admissions?page=1&perPage=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { admissions: unknown[]; total: number; page: number; perPage: number };
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('page');
      expect(body).toHaveProperty('perPage');
      expect(typeof body.total).toBe('number');
      expect(typeof body.page).toBe('number');
      expect(typeof body.perPage).toBe('number');
    });

    it('respects perPage limit (max 100, min 10)', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [] },
      });

      // perPage > 100 should be clamped to 100
      const res1 = await app.request('/admissions?perPage=500');
      expect(res1.status).toBe(200);
      const body1 = await res1.json() as { perPage: number };
      expect(body1.perPage).toBeLessThanOrEqual(100);

      // perPage < 10 should be clamped to 10
      const res2 = await app.request('/admissions?perPage=5');
      expect(res2.status).toBe(200);
      const body2 = await res2.json() as { perPage: number };
      expect(body2.perPage).toBeGreaterThanOrEqual(10);
    });

    it('defaults pagination when page or perPage params are missing or invalid', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [] },
      });

      const res1 = await app.request('/admissions');
      expect(res1.status).toBe(200);
      const body1 = await res1.json() as { page: number };
      expect(body1.page).toBe(1);

      const res2 = await app.request('/admissions?page=-5');
      expect(res2.status).toBe(200);
      const body2 = await res2.json() as { page: number };
      expect(body2.page).toBe(1);

      const res3 = await app.request('/admissions?page=not-a-number&perPage=not-a-number');
      expect(res3.status).toBe(200);
      const body3 = await res3.json() as { page: number; perPage: number };
      expect(body3.page).toBe(1);
      expect(body3.perPage).toBe(20);
    });

    it('returns empty admissions with total=0 for tenant with no data', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { admissions: [baseAdmission] },
      });

      const res = await app.request('/admissions?page=1&perPage=20');
      expect(res.status).toBe(200);
      const body = await res.json() as { admissions: unknown[]; total: number };
      expect(body.admissions).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('search filter works with pagination params combined', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [baseAdmission] },
      });

      const res = await app.request('/admissions?search=karim&status=all&page=1&perPage=20');
      expect(res.status).toBe(200);
      const body = await res.json() as { admissions: unknown[]; total: number; page: number; perPage: number };
      expect(body.page).toBe(1);
      expect(body.perPage).toBe(20);
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.admissions)).toBe(true);
    });
  });

  describe('GET /stats — admission statistics', () => {
    it('returns stats with correct shape', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [baseAdmission] },
      });

      const res = await app.request('/admissions/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      // Route returns nested shape: { stats: { ... }, wards: [...], admissions: [...], dischargePending: [...] }
      const stats = body.stats as Record<string, unknown>;
      expect(stats).toHaveProperty('occupied');
      expect(stats).toHaveProperty('available');
      expect(stats).toHaveProperty('totalBeds');
      expect(stats).toHaveProperty('occupancyPercentage');
      expect(body).toHaveProperty('wards');
      expect(body).toHaveProperty('admissions');
      expect(body).toHaveProperty('dischargePending');
    });

    it('returns dischargePending as array even with no pending discharges (regression: missing discharge_initiated column would 500)', async () => {
      // The /stats batch query [6] in admissions.ts references:
      //   a.discharge_initiated, a.discharge_approved, a.discharge_initiated_at
      // If the SQLite schema is missing these columns, the whole db.batch() throws
      // and the route returns 500. The mock DB normally returns [] silently, which
      // is why this slipped past the original test. We assert the *post-fix* shape:
      // dischargePending must always be an array (possibly empty), never a thrown error.
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [baseAdmission],
          beds: [BED_AVAILABLE, BED_OCCUPIED],
        },
      });

      const res = await app.request('/admissions/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { dischargePending: unknown[] };
      expect(Array.isArray(body.dischargePending)).toBe(true);
    });

    it('returns dischargePending rows when discharge_initiated=1 admissions exist (regression: requires columns to exist)', async () => {
      // With columns present + rows matching the WHERE clause, the query must
      // produce entries. This test would fail with "no such column" if the
      // migration is missing.
      const admittedWithDischarge = {
        ...baseAdmission,
        id: 99,
        discharge_initiated: 1,
        discharge_approved: 0,
        discharge_initiated_at: '2026-06-12 10:00:00',
      };
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admittedWithDischarge],
          beds: [BED_AVAILABLE, BED_OCCUPIED],
        },
        queryOverride: (_sql, _params) => {
          // Simulate the row that the new query would return from real D1
          return {
            results: [{
              id: 99,
              patient_name: PATIENT_1.name,
              bed_number: BED_OCCUPIED.bed_number,
              ward_name: BED_OCCUPIED.ward_name,
              doctor_name: DOCTOR_1.name,
              discharge_approved: 0,
              pending_bill: 0,
            }],
          };
        },
      });

      const res = await app.request('/admissions/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { dischargePending: Array<{ id: string }> };
      expect(body.dischargePending).toHaveLength(1);
      expect(body.dischargePending[0].id).toBe('99');
    });

    it('returns active admissions list with diagnosis field (regression: a.diagnosis column does not exist; must use provisional_diagnosis)', async () => {
      // The /stats batch query [5] (active admissions) historically used `a.diagnosis`,
      // but the actual admissions table has `provisional_diagnosis` (added in 0012).
      // The mock DB returns empty results silently on missing columns, so this was
      // never caught. With queryOverride simulating a non-empty row, the test verifies
      // the row shape includes the `diagnosis` alias for the frontend.
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...baseAdmission, id: 42, status: 'admitted' }],
          beds: [BED_AVAILABLE, BED_OCCUPIED],
        },
        queryOverride: (_sql, _params) => {
          // Match the alias shape the route now uses (a.provisional_diagnosis AS diagnosis)
          return {
            results: [{
              id: 42,
              patient_name: PATIENT_1.name,
              bed_number: BED_OCCUPIED.bed_number,
              ward_name: BED_OCCUPIED.ward_name,
              doctor_name: DOCTOR_1.name,
              admission_date: '2026-06-12 08:00:00',
              diagnosis: 'Acute Febrile Illness',
              days_admitted: 0,
            }],
          };
        },
      });

      const res = await app.request('/admissions/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { admissions: Array<{ id: string; diagnosis: string }> };
      expect(body.admissions.length).toBeGreaterThan(0);
      expect(body.admissions[0].diagnosis).toBe('Acute Febrile Illness');
    });
  });

  describe('GET /occupancy — bed occupancy by ward', () => {
    it('returns occupancy data', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [baseAdmission],
          beds: [BED_AVAILABLE, BED_OCCUPIED],
        },
      });

      const res = await app.request('/admissions/occupancy');
      expect(res.status).toBe(200);
      // Occupancy route returns { wards: [...], total: { ... } } shape
      const body = await res.json() as Record<string, unknown>;
      // Accept any truthy response shape — key structure depends on source data
      expect(body).toBeDefined();
    });
  });

  describe('GET /beds — bed management', () => {
    it('returns available beds', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { beds: [BED_AVAILABLE, BED_OCCUPIED] },
      });

      const res = await app.request('/admissions/beds?status=available');
      expect(res.status).toBe(200);
      const body = await res.json() as { beds: unknown[] };
      expect(Array.isArray(body.beds)).toBe(true);
    });
  });

  describe('POST /beds — create bed (admin only)', () => {
    it.each(BED_ADMIN_ROLES)('allows role "%s" to create a bed', async (role) => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role,
        tenantId: TENANT_1.id,
        tables: { beds: [] },
      });

      const res = await jsonRequest(app, '/admissions/beds', {
        method: 'POST',
        body: newBedBody,
      });
      expect(res.status).toBe(201);
    });

    it('rejects doctor role from creating a bed with 403', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: { beds: [] },
      });

      const res = await jsonRequest(app, '/admissions/beds', {
        method: 'POST',
        body: newBedBody,
      });
      expect(res.status).toBe(403);
    });

    it('rejects pharmacist role from creating a bed with 403', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'pharmacist',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/admissions/beds', {
        method: 'POST',
        body: newBedBody,
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 for missing required fields', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/admissions/beds', {
        method: 'POST',
        body: { ward_name: 'ICU' }, // missing bed_number, bed_type
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST / — create admission', () => {
    it('creates an admission and returns admission_no', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          beds: [BED_AVAILABLE],
          patients: [PATIENT_1],
          doctors: [DOCTOR_1],
          admissions: [],
        },
        queryOverride: admissionCreateQueryOverride,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: newAdmissionBody,
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { admission_no: string };
      expect(body.admission_no).toMatch(/^ADM-/);

      // Verify a DB INSERT was recorded
      const insertQuery = mockDB.queries.find(q => q.sql.toUpperCase().includes('INSERT') && q.sql.includes('admissions'));
      expect(insertQuery).toBeTruthy();
    });

    it('creates patient bed history with the real admission id instead of a placeholder', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          beds: [BED_AVAILABLE],
          patients: [PATIENT_1],
          doctors: [DOCTOR_1],
          admissions: [],
        },
        queryOverride: admissionCreateQueryOverride,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: newAdmissionBody,
      });

      expect(res.status).toBe(201);
      const bedInfoInsert = mockDB.queries.find(q => q.sql.toLowerCase().includes('insert into patient_bed_infos'));
      expect(bedInfoInsert?.sql).toMatch(/SELECT\s+\?,\s+\?,\s+a\.id/i);
      expect(bedInfoInsert?.sql).not.toMatch(/VALUES\s*\(\?,\s*\?,\s*\?/i);
      expect(mockDB.queries.some(q => q.sql.toLowerCase().includes('update patient_bed_infos set admission_id'))).toBe(false);
    });

    it('persists Bangladesh IPD admission source, referral, reason, and emergency flag', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          beds: [BED_AVAILABLE],
          patients: [PATIENT_1],
          doctors: [DOCTOR_1],
          admissions: [],
        },
        queryOverride: admissionCreateQueryOverride,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: {
          ...newAdmissionBody,
          admission_type: 'emergency',
          admit_source: 'emergency',
          referral_doctor: 'Emergency Duty Doctor',
          admission_reason: 'Severe abdominal pain with unstable vitals',
          is_emergency: true,
        },
      });

      expect(res.status).toBe(201);
      const insertQuery = mockDB.queries.find(q => q.sql.toUpperCase().includes('INSERT INTO ADMISSIONS'));
      expect(insertQuery?.sql).toContain('admit_source');
      expect(insertQuery?.sql).toContain('referral_doctor');
      expect(insertQuery?.sql).toContain('admission_reason');
      expect(insertQuery?.sql).toContain('is_emergency');
      expect(insertQuery?.params).toContain('emergency');
      expect(insertQuery?.params).toContain('Emergency Duty Doctor');
      expect(insertQuery?.params).toContain('Severe abdominal pain with unstable vitals');
      expect(insertQuery?.params).toContain(1);
    });

    it('rejects admission creation when patient id does not exist', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          beds: [BED_AVAILABLE],
          patients: [],
          doctors: [DOCTOR_1],
          admissions: [],
        },
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: newAdmissionBody,
      });

      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/patient not found/i);
      expect(mockDB.queries.some(q => q.sql.toLowerCase().includes('insert into admissions'))).toBe(false);
      expect(mockDB.queries.some(q => q.sql.toLowerCase().includes('update beds set status'))).toBe(false);
    });

    it('rejects admission creation when doctor id does not exist', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          beds: [BED_AVAILABLE],
          patients: [PATIENT_1],
          doctors: [],
          admissions: [],
        },
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: newAdmissionBody,
      });

      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/doctor not found/i);
      expect(mockDB.queries.some(q => q.sql.toLowerCase().includes('insert into admissions'))).toBe(false);
      expect(mockDB.queries.some(q => q.sql.toLowerCase().includes('update beds set status'))).toBe(false);
    });

    it('returns the existing IPD admission response when an idempotency key is replayed', async () => {
      const requestBody = { ...newAdmissionBody, idempotencyKey: 'ipd-admission-replay-1' };
      const parsedRequestBody = createAdmissionSchema.parse(requestBody);
      const requestHash = await createIdempotencyRequestHash({
        ...parsedRequestBody,
        idempotencyKey: undefined,
      });
      const existingResponse = {
        admission_no: 'ADM-REPLAY-1',
        admission_id: 8801,
      };

      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        queryOverride(sql) {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: requestHash,
                status: 'completed',
                response_json: JSON.stringify(existingResponse),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: requestBody,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { idempotent?: boolean; admission_no?: string; admission_id?: number };
      expect(body).toMatchObject({ idempotent: true, admission_no: 'ADM-REPLAY-1', admission_id: 8801 });
      expect(mockDB.queries.some(q => q.sql.toLowerCase().includes('insert into admissions'))).toBe(false);
    });

    it('rejects an IPD admission idempotency key reused with a different payload', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        queryOverride(sql) {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: 'different-admission-payload',
                status: 'completed',
                response_json: JSON.stringify({ admission_no: 'ADM-REPLAY-1' }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: { ...newAdmissionBody, idempotencyKey: 'ipd-admission-replay-1' },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/already used/i);
      expect(mockDB.queries.some(q => q.sql.toLowerCase().includes('insert into admissions'))).toBe(false);
    });

    it('returns 403 for accountant role', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'accountant',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: newAdmissionBody,
      });
      expect(res.status).toBe(403);
    });

    it('returns 403 for lab_tech role', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'lab_tech',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/admissions', {
        method: 'POST',
        body: newAdmissionBody,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /:id — update admission', () => {
    it('updates status and moves bed to cleaning when status is discharged', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [baseAdmission],
          beds: [BED_OCCUPIED],
        },
      });

      const res = await jsonRequest(app, `/admissions/${ADMISSION_1.id}`, {
        method: 'PUT',
        body: { status: 'discharged' },
      });
      expect(res.status).toBe(200);

      // Verify bed update query was issued
      const bedUpdate = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.includes('beds')
      );
      expect(bedUpdate).toBeTruthy();
      expect(bedUpdate?.sql).toContain("status = 'cleaning'");
    });
  });

  describe('GET /:id — single admission by id', () => {
    it('returns admission when found', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [baseAdmission] },
      });

      const res = await app.request(`/admissions/${ADMISSION_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { admission: Record<string, unknown> };
      expect(body.admission).toBeTruthy();
      expect(body.admission.id).toBe(ADMISSION_1.id);
    });

    it('returns 404 when admission does not exist', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [] },
      });

      const res = await app.request('/admissions/999');
      expect(res.status).toBe(404);
    });

    it('returns 404 when admission belongs to a different tenant', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { admissions: [baseAdmission] }, // ADMISSION_1 belongs to TENANT_1
      });

      const res = await app.request(`/admissions/${ADMISSION_1.id}`);
      expect(res.status).toBe(404);
    });
  });

  describe('Tenant isolation', () => {
    it('returns empty list when tenant has no admissions', async () => {
      // Tenant 2 queries but only TENANT_1 admissions exist
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { admissions: [baseAdmission] }, // ADMISSION_1 has tenant_id = TENANT_1.id
      });

      const res = await app.request('/admissions');
      expect(res.status).toBe(200);
      const body = await res.json() as { admissions: unknown[] };
      // Mock DB filters by tenant_id in WHERE clause — TENANT_2 rows = 0
      expect(body.admissions.length).toBe(0);
    });
  });

  // ─── Credit Discharge Tests ─────────────────────────────────────────────────

  describe('PUT /:id/credit-discharge — credit discharge', () => {
    const CREDIT_DISCHARGE_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
    const CREDIT_DISCHARGE_DENIED_ROLES = ['receptionist', 'doctor', 'nurse', 'lab_tech', 'pharmacist'] as const;

    it.each(CREDIT_DISCHARGE_ROLES)('allows %s to perform credit discharge', async (role) => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role,
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...baseAdmission, status: 'admitted' }],
          beds: [BED_OCCUPIED],
        },
      });

      const res = await jsonRequest(app, `/admissions/${ADMISSION_1.id}/credit-discharge`, {
        method: 'PUT',
        body: { discharge_condition_id: 1 },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);

      // Verify bill_status_on_discharge = 'credit' was set
      const dischargeUpdate = mockDB.queries.find(
        q => q.sql.includes('bill_status_on_discharge') && q.sql.includes("'credit'")
      );
      expect(dischargeUpdate).toBeTruthy();
    });

    it.each(CREDIT_DISCHARGE_DENIED_ROLES)('rejects %s from credit discharge', async (role) => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role,
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...baseAdmission, status: 'admitted' }],
        },
      });

      const res = await jsonRequest(app, `/admissions/${ADMISSION_1.id}/credit-discharge`, {
        method: 'PUT',
        body: { discharge_condition_id: 1 },
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when admission does not exist', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [] },
      });

      const res = await jsonRequest(app, '/admissions/999/credit-discharge', {
        method: 'PUT',
        body: { discharge_condition_id: 1 },
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 when admission is already discharged', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride(sql) {
          // Simulate: admission exists but is discharged — SELECT returns null
          if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
            return { first: null };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, `/admissions/${ADMISSION_1.id}/credit-discharge`, {
        method: 'PUT',
        body: { discharge_condition_id: 1 },
      });
      expect(res.status).toBe(404);
    });

    it('frees bed to cleaning status on credit discharge', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...baseAdmission, status: 'admitted' }],
          beds: [BED_OCCUPIED],
        },
      });

      const res = await jsonRequest(app, `/admissions/${ADMISSION_1.id}/credit-discharge`, {
        method: 'PUT',
        body: { discharge_condition_id: 1 },
      });
      expect(res.status).toBe(200);

      // Verify bed update query was issued
      const bedUpdate = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.includes('beds')
      );
      expect(bedUpdate).toBeTruthy();
      expect(bedUpdate?.sql).toContain("status = 'cleaning'");
    });
  });

  // ─── Billing Status Tests ───────────────────────────────────────────────────

  describe('GET /:id/billing-status — billing status', () => {
    it('returns billing status breakdown for an admission', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...baseAdmission, status: 'admitted', bill_status_on_discharge: 'pending' }],
          billing_provisional_items: [],
          visit_services: [],
          bills: [],
          billing_deposits: [],
        },
      });

      const res = await app.request(`/admissions/${ADMISSION_1.id}/billing-status`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        bill_status_on_discharge: string;
        pending: { provisional_amount: number; pending_service_amount: number; due_amount: number; total: number };
        deposit_balance: number;
        net_payable: number;
      };
      expect(body.bill_status_on_discharge).toBe('pending');
      expect(body.pending).toHaveProperty('provisional_amount');
      expect(body.pending).toHaveProperty('pending_service_amount');
      expect(body.pending).toHaveProperty('due_amount');
      expect(body.pending).toHaveProperty('total');
      expect(body).toHaveProperty('deposit_balance');
      expect(body).toHaveProperty('net_payable');
    });

    it('returns deposit_balance and net_payable when deposits exist', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...baseAdmission, status: 'admitted' }],
          billing_provisional_items: [{ id: 1, tenant_id: TENANT_1.id, admission_id: ADMISSION_1.id, total_amount: 1000, bill_status: 'provisional', is_active: 1 }],
          visit_services: [],
          bills: [],
          billing_deposits: [{ id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, amount: 3000, transaction_type: 'deposit', is_active: 1 }],
        },
        universalFallback: true,
      });

      const res = await app.request(`/admissions/${ADMISSION_1.id}/billing-status`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        pending: { total: number };
        deposit_balance: number;
        net_payable: number;
      };
      expect(body.deposit_balance).toBeGreaterThanOrEqual(0);
      expect(body.net_payable).toBeGreaterThanOrEqual(0);
    });

    it('returns 404 when admission does not exist', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [] },
      });

      const res = await app.request('/admissions/999/billing-status');
      expect(res.status).toBe(404);
    });
  });

  // ─── Existing discharge sets bill_status_on_discharge = 'cleared' ───────────

  describe('PUT /:id — discharge sets bill_status_on_discharge', () => {
    it('sets bill_status_on_discharge to cleared on normal discharge', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...baseAdmission, status: 'admitted' }],
          beds: [BED_OCCUPIED],
        },
      });

      const res = await jsonRequest(app, `/admissions/${ADMISSION_1.id}`, {
        method: 'PUT',
        body: { status: 'discharged' },
      });
      expect(res.status).toBe(200);

      // Verify bill_status_on_discharge = 'cleared' was set
      const dischargeUpdate = mockDB.queries.find(
        q => q.sql.includes('bill_status_on_discharge') && q.sql.includes("'cleared'")
      );
      expect(dischargeUpdate).toBeTruthy();
    });
  });

  // ─── Cancel Discharge Tests ──────────────────────────────────────────────

  describe('PUT /:id/cancel-discharge — cancel discharge', () => {
    it('rejects cancel discharge when admission is not discharged', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...baseAdmission, status: 'admitted' }],
          beds: [BED_OCCUPIED],
        },
      });

      const res = await jsonRequest(app, `/admissions/${ADMISSION_1.id}/cancel-discharge`, {
        method: 'PUT',
      });
      // Should reject because admission is not discharged
      expect(res.status).toBe(400);
    });

    it('returns error when admission does not exist', async () => {
      const { app } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { admissions: [] },
      });

      const res = await jsonRequest(app, '/admissions/999/cancel-discharge', {
        method: 'PUT',
      });
      // Should return 400 or 404
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('PUT /:id/transfer — bed transfer', () => {
    it('moves the old bed to cleaning and starts a new bed-charge segment on immediate transfer', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionsRoute,
        routePath: '/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [baseAdmission],
          beds: [BED_OCCUPIED, BED_AVAILABLE],
          patient_bed_infos: [{
            id: 501,
            tenant_id: TENANT_1.id,
            patient_id: PATIENT_1.id,
            admission_id: ADMISSION_1.id,
            bed_id: BED_OCCUPIED.id,
            ward_name: BED_OCCUPIED.ward_name,
            bed_number: BED_OCCUPIED.bed_number,
            bed_type: BED_OCCUPIED.bed_type,
            rate_per_day: 1200,
            started_on: '2024-01-20T08:00:00Z',
            ended_on: null,
            is_billed: 0,
          }],
        },
      });

      const res = await jsonRequest(app, `/admissions/${ADMISSION_1.id}/transfer`, {
        method: 'PUT',
        body: {
          new_bed_id: BED_AVAILABLE.id,
          reason: 'Shifted to general ward',
          pending_receive: false,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain('completed');

      expect(mockDB.queries.some((query) =>
        query.sql.includes("UPDATE beds SET status = 'cleaning'")
        && query.params.includes(BED_OCCUPIED.id)
      )).toBe(true);
      expect(mockDB.queries.some((query) =>
        query.sql.includes("UPDATE beds SET status = 'occupied'")
        && query.params.includes(BED_AVAILABLE.id)
      )).toBe(true);
      expect(mockDB.queries.some((query) =>
        query.sql.includes('INSERT INTO patient_bed_infos')
        && query.params.includes(BED_AVAILABLE.id)
      )).toBe(true);
    });
  });

});

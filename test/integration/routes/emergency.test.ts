/**
 * Integration tests for src/routes/tenant/emergency.ts
 *
 * Tests ER patient registration, triage assignment, finalization,
 * discharge summaries, and stats KPIs.
 */

import { describe, it, expect } from 'vitest';
import emergencyRoute from '../../../src/routes/tenant/emergency';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1, TENANT_2, PATIENT_1 } from '../helpers/fixtures';

// ─── Shared test data ──────────────────────────────────────────────────────────

const baseErPatient = {
  id: 50,
  tenant_id: TENANT_1.id,
  er_patient_number: 'ER-00001',
  patient_id: PATIENT_1.id,
  first_name: 'Rahim',
  last_name: 'Mia',
  gender: 'Male',
  er_status: 'new',
  triage_code: null,
  finalized_status: null,
  is_active: 1,
  created_at: '2024-01-20T08:00:00Z',
};

const newErPatientBody = {
  first_name: 'Karim',
  last_name: 'Uddin',
  gender: 'Male',
  contact_no: '01700000000',
  is_existing_patient: false,
  is_police_case: false,
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Emergency Routes', () => {

  describe('GET / — list ER patients', () => {
    it('returns ER patients for the tenant', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: { er_patients: [baseErPatient] },
      });

      const res = await app.request('/emergency');
      expect(res.status).toBe(200);
      const body = await res.json() as { er_patients: unknown[]; total: number };
      expect(Array.isArray(body.er_patients)).toBe(true);
      expect(typeof body.total).toBe('number');
    });

    it('filters by status=new', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: { er_patients: [baseErPatient] },
      });

      const res = await app.request('/emergency?status=new');
      expect(res.status).toBe(200);
    });

    it('filters by search term', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { er_patients: [baseErPatient] },
      });

      const res = await app.request('/emergency?search=rahim');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /stats — ER dashboard KPIs', () => {
    it('returns all required KPI fields', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { er_patients: [baseErPatient] },
      });

      const res = await app.request('/emergency/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('new_patients');
      expect(body).toHaveProperty('triaged_patients');
      expect(body).toHaveProperty('admitted_today');
      expect(body).toHaveProperty('discharged_today');
      expect(body).toHaveProperty('lama_count');
      expect(body).toHaveProperty('total_today');
      expect(body).toHaveProperty('triage_distribution');
    });
  });

  describe('GET /modes-of-arrival', () => {
    it('returns list of modes', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { er_mode_of_arrival: [{ id: 1, tenant_id: TENANT_1.id, name: 'Ambulance', is_active: 1 }] },
      });

      const res = await app.request('/emergency/modes-of-arrival');
      expect(res.status).toBe(200);
      const body = await res.json() as { modes: unknown[] };
      expect(Array.isArray(body.modes)).toBe(true);
    });
  });

  describe('GET /search-patients', () => {
    it('returns empty result for queries shorter than 2 chars', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { patients: [PATIENT_1] },
      });

      const res = await app.request('/emergency/search-patients?q=a');
      expect(res.status).toBe(200);
      const body = await res.json() as { patients: unknown[]; total: number };
      expect(body.patients).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('searches patients for queries >= 2 chars', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { patients: [PATIENT_1] },
      });

      const res = await app.request('/emergency/search-patients?q=ra');
      expect(res.status).toBe(200);
      const body = await res.json() as { patients: unknown[] };
      expect(Array.isArray(body.patients)).toBe(true);
    });
  });

  describe('GET /:id — single ER patient', () => {
    it('returns 404 for unknown ER patient id', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: { er_patients: [] },
      });

      const res = await app.request('/emergency/9999');
      expect(res.status).toBe(404);
    });

    it('returns patient with cases and discharge summary', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: { er_patients: [baseErPatient] },
      });

      const res = await app.request(`/emergency/${baseErPatient.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { er_patient: Record<string, unknown> };
      expect(body.er_patient).toBeDefined();
    });
  });

  describe('POST / — register ER patient', () => {
    it('creates a new ER patient without existing patient record', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { er_patients: [], patients: [], visits: [] },
      });

      const res = await jsonRequest(app, '/emergency', {
        method: 'POST',
        body: newErPatientBody,
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { er_patient_number: string };
      expect(body.er_patient_number).toMatch(/^ER-/);
    });

    it('atomically creates a new patient with its local-sync outbox event and sequence-based patient code', async () => {
      const { app, mockDB } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { er_patients: [], patients: [], visits: [] },
        queryOverride(sql, params) {
          const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          if (normalized.startsWith('insert into sequence_counters')) {
            return {
              first: { current_value: params[0] === 'patient' ? 321 : 7 },
              results: [{ current_value: params[0] === 'patient' ? 321 : 7 }],
              success: true,
              meta: {},
            };
          }
          if (normalized.includes('select id from patients') && normalized.includes('patient_code = ?')) {
            return { first: { id: 77 }, results: [{ id: 77 }], success: true, meta: {} };
          }
          return null;
        },
        extraEnv: {
          ENVIRONMENT: 'local_server',
          LOCAL_SERVER_ID: 'hospital-lan-primary',
        },
      });

      const res = await jsonRequest(app, '/emergency', {
        method: 'POST',
        body: newErPatientBody,
      });

      expect(res.status).toBe(201);
      expect(mockDB.queries.some((query) => /SELECT\s+COALESCE\(MAX\(id\)/i.test(query.sql))).toBe(false);
      const atomicPatientBatch = mockDB.batchCalls.find((batch) =>
        batch.some((sql) => /INSERT\s+INTO\s+patients/i.test(sql))
        && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql)),
      );
      expect(atomicPatientBatch).toBeDefined();
      const patientInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+patients/i.test(query.sql));
      expect(patientInsert?.params).toContain('P-000321');
    });

    it('returns 400 for missing required fields (first_name, last_name)', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'receptionist',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/emergency', {
        method: 'POST',
        body: { gender: 'Male' }, // missing first_name and last_name
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id/triage — assign triage code', () => {
    it('returns 404 when patient not found', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: { er_patients: [] },
      });

      const res = await jsonRequest(app, '/emergency/999/triage', {
        method: 'PUT',
        body: { triage_code: 'red' },
      });
      expect(res.status).toBe(404);
    });

    it('assigns a triage code and updates status to triaged', async () => {
      const { app, mockDB } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: { er_patients: [baseErPatient] },
      });

      const res = await jsonRequest(app, `/emergency/${baseErPatient.id}/triage`, {
        method: 'PUT',
        body: { triage_code: 'yellow' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; triage_code: string };
      expect(body.success).toBe(true);
      expect(body.triage_code).toBe('yellow');

      // Verify UPDATE query was issued
      const updateQ = mockDB.queries.find(
        q => q.sql.toUpperCase().includes('UPDATE') && q.sql.includes('er_patients')
      );
      expect(updateQ).toBeTruthy();
    });
  });

  describe('PUT /:id/finalize — finalize ER visit', () => {
    it('finalizes an ER patient', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: { er_patients: [baseErPatient] },
      });

      const res = await jsonRequest(app, `/emergency/${baseErPatient.id}/finalize`, {
        method: 'PUT',
        body: { finalized_status: 'discharged', finalized_remarks: 'Patient stable' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; finalized_status: string };
      expect(body.finalized_status).toBe('discharged');
    });

    it('rejects invalid finalized_status value', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: { er_patients: [baseErPatient] },
      });

      const res = await jsonRequest(app, `/emergency/${baseErPatient.id}/finalize`, {
        method: 'PUT',
        body: { finalized_status: 'invalid-status' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Tenant isolation', () => {
    it('returns empty list when tenant2 queries tenant1 records', async () => {
      const { app } = createTestApp({
        route: emergencyRoute,
        routePath: '/emergency',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { er_patients: [baseErPatient] }, // baseErPatient has TENANT_1.id
      });

      const res = await app.request('/emergency');
      expect(res.status).toBe(200);
      const body = await res.json() as { er_patients: unknown[] };
      expect(body.er_patients).toHaveLength(0);
    });
  });
});

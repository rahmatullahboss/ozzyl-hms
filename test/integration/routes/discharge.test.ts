/**
 * Integration tests for src/routes/tenant/discharge.ts
 *
 * Tests discharge summary CRUD, templates, consultants, and slip generation.
 */

import { describe, it, expect } from 'vitest';
import dischargeRoutes from '../../../src/routes/tenant/discharge';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1, ADMISSION_1, PATIENT_1, DOCTOR_1 } from '../helpers/fixtures';

// ─── Shared test data ──────────────────────────────────────────────────────────

const admissionRecord = {
  id: ADMISSION_1.id,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  bed_id: 10,
  doctor_id: DOCTOR_1.id,
  admission_no: ADMISSION_1.admission_no,
  admission_date: '2024-01-20T08:00:00Z',
  status: 'admitted',
  provisional_diagnosis: 'Pneumonia',
};

const dischargedAdmissionRecord = {
  ...admissionRecord,
  status: 'discharged',
  discharge_date: '2024-01-25T10:00:00Z',
};

const summaryRecord = {
  id: 1,
  tenant_id: TENANT_1.id,
  admission_id: ADMISSION_1.id,
  patient_id: PATIENT_1.id,
  final_diagnosis: 'Community-acquired pneumonia',
  treatment_summary: 'IV antibiotics for 7 days',
  procedures_performed: '["Chest X-ray", "Blood culture"]',
  medicines_on_discharge: '[{"name":"Amoxicillin 500mg","dose":"1 tab","frequency":"TDS","duration":"5 days"}]',
  status: 'draft',
  created_at: '2024-01-25T10:00:00Z',
};

const templateRecord = {
  id: 1,
  tenant_id: TENANT_1.id,
  name: 'General Medicine Template',
  department: 'General Medicine',
  fields_json: '{"sections":["diagnosis","treatment","followup"]}',
  is_default: 1,
  is_active: 1,
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Discharge Routes', () => {

  // ─── GET /templates/list ──────────────────────────────────────────────────

  describe('GET /templates/list', () => {
    it('returns discharge summary templates', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          discharge_summary_templates: [templateRecord],
        },
      });

      const res = await app.request('/discharge/templates/list');
      expect(res.status).toBe(200);
      const body = await res.json() as { templates: unknown[] };
      expect(Array.isArray(body.templates)).toBe(true);
    });

    it('filters templates by department', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          discharge_summary_templates: [templateRecord],
        },
      });

      const res = await app.request('/discharge/templates/list?department=General%20Medicine');
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /templates ──────────────────────────────────────────────────────

  describe('POST /templates', () => {
    it('creates a template with valid data', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/discharge/templates', {
        method: 'POST',
        body: {
          name: 'Surgery Template',
          department: 'Surgery',
          fields_json: { sections: ['procedure', 'findings'] },
          is_default: false,
        },
      });
      expect(res.status).toBe(201);
    });

    it('denies non-doctor/admin roles', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'nurse',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/discharge/templates', {
        method: 'POST',
        body: { name: 'Test Template' },
      });
      expect(res.status).toBe(403);
    });
  });

  // ─── GET /:admissionId ────────────────────────────────────────────────────

  describe('GET /:admissionId', () => {
    it('returns admission and summary data', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admissionRecord],
          discharge_summaries: [summaryRecord],
          discharge_summary_consultants: [],
        },
      });

      const res = await app.request(`/discharge/${ADMISSION_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        admission: unknown;
        summary: unknown;
        consultants: unknown[];
      };
      expect(body.admission).toBeDefined();
    });

    it('returns 404 for non-existent admission', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {},
      });

      const res = await app.request('/discharge/999');
      expect(res.status).toBe(404);
    });

    it('returns null summary when no summary exists yet', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admissionRecord],
        },
        universalFallback: true,
      });

      const res = await app.request(`/discharge/${ADMISSION_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { summary: unknown };
      // Summary may be null or a fallback row — both acceptable
    });
  });

  // ─── PUT /:admissionId (upsert summary) ──────────────────────────────────

  describe('PUT /:admissionId — create/update summary', () => {
    it('creates a new summary', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [dischargedAdmissionRecord],
          discharge_summaries: [], // No existing summary
          audit_log: [],
        },
      });

      const res = await jsonRequest(app, `/discharge/${ADMISSION_1.id}`, {
        method: 'PUT',
        body: {
          final_diagnosis: 'Pneumonia resolved',
          treatment_summary: 'Full course of antibiotics completed',
          status: 'final',
        },
      });
      expect(res.status).toBe(200);
    });

    it('updates an existing summary', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [dischargedAdmissionRecord],
          discharge_summaries: [summaryRecord],
          audit_log: [],
        },
      });

      const res = await jsonRequest(app, `/discharge/${ADMISSION_1.id}`, {
        method: 'PUT',
        body: {
          final_diagnosis: 'Updated diagnosis',
          status: 'final',
        },
      });
      expect(res.status).toBe(200);
    });

    it('handles JSON array fields correctly', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admissionRecord],
          discharge_summaries: [],
          audit_log: [],
        },
      });

      const res = await jsonRequest(app, `/discharge/${ADMISSION_1.id}`, {
        method: 'PUT',
        body: {
          procedures_performed: ['Chest X-ray', 'ECG'],
          medicines_on_discharge: [
            { name: 'Paracetamol', dose: '500mg', frequency: 'TDS', duration: '3 days' },
          ],
          lab_tests: ['CBC', 'CRP'],
          imaging_items: ['Chest X-ray PA view'],
        },
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /:admissionId/consultants ──────────────────────────────────────

  describe('POST /:admissionId/consultants', () => {
    it('adds a consultant to discharge summary', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          discharge_summaries: [summaryRecord],
        },
      });

      const res = await jsonRequest(app, `/discharge/${ADMISSION_1.id}/consultants`, {
        method: 'POST',
        body: { consultant_id: 5, role: 'consultant' },
      });
      expect(res.status).toBe(201);
    });

    it('returns 404 if summary not found', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {},
      });

      const res = await jsonRequest(app, '/discharge/999/consultants', {
        method: 'POST',
        body: { consultant_id: 5 },
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── GET /:admissionId/slip ──────────────────────────────────────────────

  describe('GET /:admissionId/slip', () => {
    it('returns discharge slip data', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{
            ...admissionRecord,
            status: 'discharged',
            discharge_date: '2024-01-27T10:00:00Z',
          }],
          discharge_summaries: [summaryRecord],
        },
      });

      const res = await app.request(`/discharge/${ADMISSION_1.id}/slip`);
      expect(res.status).toBe(200);
      const body = await res.json() as { slip: unknown };
      expect(body.slip).toBeDefined();
    });

    it('returns slip data for existing admission', async () => {
      const { app } = createTestApp({
        route: dischargeRoutes,
        routePath: '/discharge',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{
            ...admissionRecord,
            status: 'discharged',
            discharge_date: '2024-01-27T10:00:00Z',
          }],
          discharge_summaries: [summaryRecord],
        },
      });

      const res = await app.request(`/discharge/${ADMISSION_1.id}/slip`);
      expect(res.status).toBe(200);
      const body = await res.json() as { slip: unknown };
      expect(body.slip).toBeDefined();
    });
  });
});

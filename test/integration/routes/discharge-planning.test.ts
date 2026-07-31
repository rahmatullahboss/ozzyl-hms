import { describe, it, expect } from 'vitest';
import dpRoutes from '../../../src/routes/tenant/dischargePlanning';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';

const DC_1 = { id: 1, tenant_id: 'tenant-1', admission_id: 10, patient_id: 1, status: 'in_progress', discharge_type: 'normal', vitals_stable: 0, medications_reconciled: 0, prescriptions_printed: 0, lab_results_reviewed: 0, pending_tests_cleared: 0, diet_instructions_given: 0, wound_care_instructions: 0, follow_up_scheduled: 0, referrals_arranged: 0, insurance_clearance: 0, billing_cleared: 0, belongings_returned: 0, transport_arranged: 0, patient_education_done: 0, consent_forms_signed: 0, patient_name: 'Rahim', patient_code: 'P001', admission_no: 'ADM-001', updated_at: '2025-04-07T10:00:00Z' };
const DC_READY = { ...DC_1, id: 2, admission_id: 11, status: 'ready' };
const DC_ALL_DONE = { ...DC_1, id: 3, admission_id: 12, status: 'ready', vitals_stable: 1, medications_reconciled: 1, prescriptions_printed: 1, lab_results_reviewed: 1, pending_tests_cleared: 1, diet_instructions_given: 1, wound_care_instructions: 1, follow_up_scheduled: 1, referrals_arranged: 1, insurance_clearance: 1, billing_cleared: 1, belongings_returned: 1, transport_arranged: 1, patient_education_done: 1, consent_forms_signed: 1 };

describe('Discharge Planning Routes', () => {

  describe('GET /stats', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1, DC_READY] }, universalFallback: true });
      expect((await app.request('/dp/stats')).status).toBe(200);
    });
  });

  describe('GET /', () => {
    it('returns 200 with data', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1] }, universalFallback: true });
      const res = await app.request('/dp');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
    it('filters by status', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1] }, universalFallback: true });
      expect((await app.request('/dp?status=in_progress')).status).toBe(200);
    });
  });

  describe('GET /admission/:admissionId', () => {
    it('returns data if exists', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1] }, universalFallback: true });
      expect((await app.request('/dp/admission/10')).status).toBe(200);
    });
    it('returns null if no plan', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [] } });
      const res = await app.request('/dp/admission/999');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown };
      expect(body.data).toBeNull();
    });
  });

  describe('GET /:id', () => {
    it('returns with checklist_progress', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1] }, universalFallback: true });
      const res = await app.request('/dp/1');
      expect(res.status).toBe(200);
      const body = await res.json() as { checklist_progress: { done: number; total: number; percent: number } };
      expect(body).toHaveProperty('checklist_progress');
      expect(body.checklist_progress.total).toBe(15);
    });
    it('returns 404', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [] } });
      expect((await app.request('/dp/999')).status).toBe(404);
    });
  });

  describe('POST /', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [] }, universalFallback: false });
      expect((await jsonRequest(app, '/dp', { method: 'POST', body: { admission_id: 10, patient_id: 1 } })).status).toBe(201);
    });
    it('rejects missing admission_id (400)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/dp', { method: 'POST', body: { patient_id: 1 } })).status).toBe(400);
    });
    it('rejects invalid discharge_type (400)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/dp', { method: 'POST', body: { admission_id: 10, patient_id: 1, discharge_type: 'runaway' } })).status).toBe(400);
    });
  });

  describe('PUT /:id/checklist', () => {
    it('updates checklist items (200)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/dp/1/checklist', { method: 'PUT', body: { vitals_stable: true, billing_cleared: true } })).status).toBe(200);
    });
  });

  describe('PUT /:id/medications', () => {
    it('updates medications (200)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/dp/1/medications', { method: 'PUT', body: {
        discharge_medications: [{ name: 'Metformin', dose: '500mg', frequency: 'BD' }],
        stopped_medications: [{ name: 'IV Ceftriaxone', reason: 'Course completed' }],
      } })).status).toBe(200);
    });
  });

  describe('PUT /:id/instructions', () => {
    it('updates instructions (200)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/dp/1/instructions', { method: 'PUT', body: {
        activity_restrictions: 'No heavy lifting for 2 weeks',
        warning_signs: 'Return if fever >101F or wound redness',
        follow_up_appointments: [{ date: '2025-04-14', doctor: 'Dr. Ahmed', department: 'Surgery' }],
      } })).status).toBe(200);
    });
  });

  describe('PUT /:id/status', () => {
    it('in_progress → ready (200)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/dp/1/status', { method: 'PUT', body: { status: 'ready' } })).status).toBe(200);
    });
    it('ready → approved (200, all checklist done)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_ALL_DONE] }, universalFallback: true });
      expect((await jsonRequest(app, '/dp/3/status', { method: 'PUT', body: { status: 'approved' } })).status).toBe(200);
    });
    it('approved → discharged (200, all checklist done)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [{ ...DC_ALL_DONE, status: 'approved' }], admissions: [{ id: 12, tenant_id: 'tenant-1' }] }, universalFallback: true });
      expect((await jsonRequest(app, '/dp/3/status', { method: 'PUT', body: { status: 'discharged' } })).status).toBe(200);
    });
    it('blocks approval when checklist incomplete (400)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_READY] }, universalFallback: true });
      const res = await jsonRequest(app, '/dp/2/status', { method: 'PUT', body: { status: 'approved' } });
      expect(res.status).toBe(400);
    });
    it('allows AMA discharge without checklist (200)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: { discharge_checklists: [DC_READY], admissions: [{ id: 11, tenant_id: 'tenant-1' }] }, universalFallback: true });
      expect((await jsonRequest(app, '/dp/2/status', { method: 'PUT', body: { status: 'discharged', discharge_type: 'against_medical_advice' } })).status).toBe(200);
    });
    it('blocks discharge when billing is still pending', async () => {
      const dc = { ...DC_ALL_DONE, id: 4, admission_id: 20, status: 'approved' };
      const mockDB = createMockDB({
        queryOverride: (sql) => {
          if (sql.includes('FROM discharge_checklists') && sql.includes('WHERE id = ?')) {
            return { first: dc };
          }
          if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
            return { first: { id: 20, bed_id: 5, patient_id: 1, admission_date: '2026-01-01' } };
          }
          if (sql.includes('FROM accounting_period_closes')) {
            return { first: null };
          }
          if (sql.includes('FROM billing_provisional_items')) {
            return { first: { amount: 350 } };
          }
          if (sql.includes('FROM visit_services') || sql.includes('FROM bills')) {
            return { first: { amount: 0 } };
          }
          return null;
        },
      });
      const { app, mockDB: db } = createTestApp({
        route: dpRoutes,
        routePath: '/dp',
        role: 'hospital_admin',
        mockDB,
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/dp/4/status', { method: 'PUT', body: { status: 'discharged' } });

      expect(res.status).toBe(400);
      expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions'))).toBe(false);
      expect(db.queries.some((q) => q.sql.toLowerCase().includes('update discharge_checklists'))).toBe(false);
    });
    it('blocks discharge in a closed accounting period before updating checklist or bed state', async () => {
      const dc = { ...DC_ALL_DONE, id: 5, admission_id: 21, status: 'approved' };
      const mockDB = createMockDB({
        queryOverride: (sql) => {
          if (sql.includes('FROM discharge_checklists') && sql.includes('WHERE id = ?')) {
            return { first: dc };
          }
          if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
            return { first: { id: 21, bed_id: 6, patient_id: 1, admission_date: '2026-01-01' } };
          }
          if (sql.includes('FROM accounting_period_closes')) {
            return { first: { status: 'closed' } };
          }
          return null;
        },
      });
      const { app, mockDB: db } = createTestApp({
        route: dpRoutes,
        routePath: '/dp',
        role: 'hospital_admin',
        mockDB,
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/dp/5/status', { method: 'PUT', body: { status: 'discharged' } });

      expect(res.status).toBe(409);
      expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions'))).toBe(false);
      expect(db.queries.some((q) => q.sql.toLowerCase().includes('update patient_bed_infos'))).toBe(false);
    });
    it('closes admission, bed stay, and audit log after discharge billing checks pass', async () => {
      const dc = { ...DC_ALL_DONE, id: 6, admission_id: 22, status: 'approved' };
      const mockDB = createMockDB({
        queryOverride: (sql) => {
          if (sql.includes('FROM discharge_checklists') && sql.includes('WHERE id = ?')) {
            return { first: dc };
          }
          if (sql.includes('FROM admissions') && sql.includes("status IN ('admitted','critical')")) {
            return { first: { id: 22, bed_id: 7, patient_id: 1, admission_date: '2026-01-01' } };
          }
          if (sql.includes('FROM accounting_period_closes')) {
            return { first: null };
          }
          if (sql.includes('FROM billing_provisional_items') || sql.includes('FROM visit_services') || sql.includes('FROM bills')) {
            return { first: { amount: 0 } };
          }
          return null;
        },
      });
      const { app, mockDB: db } = createTestApp({
        route: dpRoutes,
        routePath: '/dp',
        role: 'hospital_admin',
        mockDB,
        tenantId: 'tenant-1',
      });

      const res = await jsonRequest(app, '/dp/6/status', {
        method: 'PUT',
        body: { status: 'discharged', discharge_type: 'normal' },
      });

      expect(res.status).toBe(200);
      expect(db.queries.some((q) => q.sql.toLowerCase().includes('update admissions'))).toBe(true);
      expect(db.queries.some((q) => q.sql.toLowerCase().includes('update patient_bed_infos'))).toBe(true);
      expect(db.queries.some((q) => q.sql.toLowerCase().includes('update beds set status'))).toBe(true);
      expect(db.queries.some((q) => q.sql.includes('INSERT INTO audit_logs'))).toBe(true);
    });
    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: dpRoutes, routePath: '/dp', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/dp/1/status', { method: 'PUT', body: { status: 'pending' } })).status).toBe(400);
    });
  });
});

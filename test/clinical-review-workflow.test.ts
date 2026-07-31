import { describe, expect, it } from 'vitest';
import allergiesRoute from '../src/routes/tenant/allergies';
import ePrescribingRoutes from '../src/routes/tenant/ePrescribing';
import { diagnosisRoutes } from '../src/routes/tenant/clinical/diagnosis';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('clinical review workflow', () => {
  it('PUT /allergies/:id/review verifies allergy and preserves legacy verified fields', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (sql.includes('SELECT id, patient_id FROM patient_allergies WHERE id = ? AND tenant_id = ?')) {
          return { first: { id: 41, patient_id: 12 }, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: allergiesRoute,
      routePath: '/allergies',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/allergies/41/review', {
      method: 'PUT',
      body: {
        status: 'verified',
        notes: 'Confirmed from prior discharge note',
      },
    });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('UPDATE patient_allergies SET'));
    expect(update?.sql).toContain('review_status = ?');
    expect(update?.sql).toContain('reviewed_by = ?');
    expect(update?.sql).toContain('review_notes = ?');
    expect(update?.sql).toContain('verified_by = ?');
    expect(update?.params).toContain('verified');
  });

  it('PUT /patient/:patientId/medications/:id/review rejects patient-reported medication with clinician note', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (sql.includes('SELECT id, source FROM patient_active_medications WHERE id = ? AND patient_id = ? AND tenant_id = ?')) {
          return { first: { id: 31, source: 'patient_reported' }, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: ePrescribingRoutes,
      routePath: '/ep',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/ep/patient/1/medications/31/review', {
      method: 'PUT',
      body: {
        status: 'rejected',
        notes: 'Patient could not confirm dose or package',
      },
    });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('UPDATE patient_active_medications SET'));
    expect(update?.sql).toContain('review_status = ?');
    expect(update?.sql).toContain('reviewed_at = datetime');
    expect(update?.params).toContain('rejected');
    expect(update?.params).toContain('Patient could not confirm dose or package');
  });

  it('PUT /diagnosis/:id/review updates diagnosis review status', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (sql.includes('SELECT DiagnosisId FROM ClinicalDiagnosis WHERE DiagnosisId = ? AND tenant_id = ? AND IsActive = 1')) {
          return { first: { DiagnosisId: 55 }, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: diagnosisRoutes,
      routePath: '/diagnosis',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/diagnosis/55/review', {
      method: 'PUT',
      body: {
        status: 'verified',
        notes: 'Confirmed by attending physician',
      },
    });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('UPDATE ClinicalDiagnosis SET'));
    expect(update?.sql).toContain('review_status = ?');
    expect(update?.sql).toContain('reviewed_by = ?');
    expect(update?.sql).toContain('review_notes = ?');
    expect(update?.params).toContain('verified');
  });
});

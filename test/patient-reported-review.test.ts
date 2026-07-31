import { describe, expect, it } from 'vitest';
import patientReportedRoutes from '../src/routes/tenant/patientReported';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('patient-reported clinician review routes', () => {
  it('returns ADR and lifestyle summary for a globally linked patient and allows review', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from patients where id = ? and tenant_id = ?')) {
          return {
            first: { id: 1, uhid: 'OZ-000123', global_identity_id: 9 },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from global_patient_adverse_reactions')) {
          return {
            results: [{
              id: 11,
              medication_name: 'Ibuprofen',
              reaction: 'Acidity',
              severity: 'severe',
              review_status: 'pending_review',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from global_patient_lifestyle_logs')) {
          return {
            results: [{
              id: 22,
              logged_on: '2026-04-09',
              sleep_hours: 5.25,
              exercise_minutes: 30,
              mood: 'low',
              review_status: 'pending_review',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('update global_patient_adverse_reactions')) {
          return { success: true, meta: { changes: 1, duration: 0, last_row_id: 0 } };
        }

        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: patientReportedRoutes,
      routePath: '/api/patient-reported',
      role: 'doctor',
      mockDB,
    });

    const summary = await app.request('/api/patient-reported/patient/1/summary');
    expect(summary.status).toBe(200);
    const body = await summary.json() as {
      highlights: { pending_review_count: number; average_sleep_hours: number | null; severe_adr_count: number };
    };
    expect(body.highlights.pending_review_count).toBeGreaterThanOrEqual(1);
    expect(body.highlights.average_sleep_hours).toBe(5.25);
    expect(body.highlights.severe_adr_count).toBe(1);

    const review = await jsonRequest(app, '/api/patient-reported/adverse-reactions/11/review', {
      method: 'PUT',
      body: {
        status: 'verified',
        notes: 'Matches likely gastritis history',
      },
    });
    expect(review.status).toBe(200);
  });

  it('returns 404 when reviewing a patient-reported ADR outside tenant scope', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('update global_patient_adverse_reactions')) {
          return { success: true, meta: { changes: 0, duration: 0, last_row_id: 0 } };
        }

        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: patientReportedRoutes,
      routePath: '/api/patient-reported',
      role: 'doctor',
      mockDB,
    });

    const review = await jsonRequest(app, '/api/patient-reported/adverse-reactions/999/review', {
      method: 'PUT',
      body: {
        status: 'verified',
      },
    });

    expect(review.status).toBe(404);
  });
});

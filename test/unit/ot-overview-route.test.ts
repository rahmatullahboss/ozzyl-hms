import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

/**
 * Tests for the Programmatic OT Overview HTTP endpoint.
 *
 * Mounted at /api/ot/overview/:patient_id (per src/index.ts:755,
 * the otRoutes sub-app is mounted at /api/ot).
 *
 * The endpoint is read-only and returns a deterministic,
 * rule-based aggregation. No LLM calls.
 */

function makeOverviewApp(options: {
  patient?: Record<string, unknown> | null;
  allergies?: Record<string, unknown>[];
  activeMeds?: Record<string, unknown>[];
  prescriptionItems?: Record<string, unknown>[];
  labResults?: Record<string, unknown>[];
  primaryDiags?: Record<string, unknown>[];
  finalDiags?: Record<string, unknown>[];
  pastBookings?: Record<string, unknown>[];
  clearanceItems?: Record<string, unknown>[];
  vitals?: Record<string, unknown> | null;
} = {}) {
  return createTestApp({
    route: otRoutes,
    routePath: '/ot',
    role: 'doctor',
    tenantId: '1',
    userId: 7,
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      const out = (data: Record<string, unknown> | Record<string, unknown>[] | null) => {
        if (Array.isArray(data)) {
          return { first: data[0] ?? null, results: data, success: true, meta: {} };
        }
        return { first: data, results: data ? [data] : [], success: true, meta: {} };
      };
      if (s.includes('from patients') && s.includes('where id = ?')) {
        return out(options.patient ?? {
          id: 100, patient_code: 'P-100', name: 'Test Patient', age: 30,
          gender: 'male', blood_group: 'O+', date_of_birth: '1996-01-01', tenant_id: '1',
        });
      }
      if (s.includes('from patient_allergies')) {
        return out(options.allergies ?? []);
      }
      if (s.includes('from patient_active_medications')) {
        return out(options.activeMeds ?? []);
      }
      if (s.includes('from prescription_items')) {
        return out(options.prescriptionItems ?? []);
      }
      if (s.includes('from lab_results')) {
        return out(options.labResults ?? []);
      }
      if (s.includes('from ClinicalDiagnosis'.toLowerCase())) {
        return out(options.primaryDiags ?? []);
      }
      if (s.includes('from final_diagnosis')) {
        return out(options.finalDiags ?? []);
      }
      if (s.includes('from ot_bookings') && s.includes('operation_status in')) {
        return out(options.pastBookings ?? []);
      }
      if (s.includes('from ot_clearance_checks')) {
        return out(options.clearanceItems ?? []);
      }
      if (s.includes('from clinical_vitals')) {
        return out(options.vitals ?? null);
      }
      // Default: empty result
      return null;
    },
  });
}

describe('GET /api/ot/overview/:patient_id', () => {
  it('returns 200 with the Programmatic Overview for a healthy patient', async () => {
    const { app } = makeOverviewApp();
    const res = await jsonRequest(app, '/ot/overview/100');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.verification_notice).toContain('Verify');
    expect((body.patient as Record<string, unknown>).patient_id).toBe(100);
    expect((body.risk as Record<string, unknown>).level).toBe('low');
    expect((body.risk as Record<string, unknown>).score).toBe(0);
  });

  it('rejects non-numeric patient_id with 400', async () => {
    const { app } = makeOverviewApp();
    const res = await jsonRequest(app, '/ot/overview/abc');
    expect(res.status).toBe(400);
  });

  it('passes through the verification notice verbatim', async () => {
    const { app } = makeOverviewApp();
    const res = await jsonRequest(app, '/ot/overview/100');
    const body = await res.json() as Record<string, unknown>;
    expect(body.verification_notice).toBe(
      'Programmatic OT Overview is for clinical assistance only. Verify all fields against the patient file and the latest investigations before any surgical decision.',
    );
  });
});

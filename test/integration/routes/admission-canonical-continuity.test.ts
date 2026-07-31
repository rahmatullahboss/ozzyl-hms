import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const admissionsRoute = readFileSync('src/routes/tenant/admissions.ts', 'utf8');
const receptionRoute = readFileSync('src/routes/tenant/reception.ts', 'utf8');

describe('live admission canonical continuity wiring', () => {
  it('projects the committed admission from the primary admissions route', () => {
    expect(admissionsRoute).toContain("from '../../lib/canonical/live-admission-continuity'");
    expect(admissionsRoute).toContain('ensureLiveAdmissionContinuity');
    expect(admissionsRoute).toContain('normalizeLegacyAdmissionStartedAtUtc');
    const resolved = admissionsRoute.indexOf('if (!createdAdmission?.id)');
    const continuity = admissionsRoute.indexOf('await ensureLiveAdmissionContinuity(c.env.DB', resolved);
    const response = admissionsRoute.indexOf('return c.json(responseBody, 201)', resolved);
    expect(resolved).toBeGreaterThan(0);
    expect(continuity).toBeGreaterThan(resolved);
    expect(response).toBeGreaterThan(continuity);
    const call = admissionsRoute.slice(continuity, response);
    expect(call).toContain('legacyAdmissionId: Number(createdAdmission.id)');
    expect(call).toContain('admissionNo: admNo');
    expect(call).toContain('legacyPatientId: data.patient_id');
    expect(call).toContain('admissionType: data.admission_type');
    expect(call).toContain('startedAtUtc:');
  });

  it('projects the committed admission from reception admission with optional deposit', () => {
    expect(receptionRoute).toContain("from '../../lib/canonical/live-admission-continuity'");
    expect(receptionRoute).toContain('ensureLiveAdmissionContinuity');
    expect(receptionRoute).toContain('normalizeLegacyAdmissionStartedAtUtc');
    const resolved = receptionRoute.indexOf("if (!admission?.id)", receptionRoute.indexOf("receptionRoutes.post('/admit-with-deposit'"));
    const continuity = receptionRoute.indexOf('await ensureLiveAdmissionContinuity(c.env.DB', resolved);
    const response = receptionRoute.indexOf('return c.json(responseBody, 201)', resolved);
    expect(resolved).toBeGreaterThan(0);
    expect(continuity).toBeGreaterThan(resolved);
    expect(response).toBeGreaterThan(continuity);
    const call = receptionRoute.slice(continuity, response);
    expect(call).toContain('legacyAdmissionId: Number(admission.id)');
    expect(call).toContain('admissionNo');
    expect(call).toContain('legacyPatientId: data.patientId');
    expect(call).toContain('admissionType: data.admissionType');
    expect(call).toContain('startedAtUtc:');
  });
});

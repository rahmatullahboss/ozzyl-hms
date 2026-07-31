/**
 * Clinical Depth & FHIR Hardening — Sprint Tests
 *
 * Covers all 5 phases:
 *   Phase 1: ICD-11 in visit creation
 *   Phase 2: FHIR write RBAC
 *   Phase 3: FHIR Observation vital range validation
 *   Phase 4: Fine-grained consent clinical area scoping
 *   Phase 5: Default treatment-purpose access
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVisitSchema, updateVisitSchema, dischargeSchema } from '../src/schemas/visit';
import { globalConsentSchema } from '../src/schemas/globalHealth';

// ══════════════════════════════════════════════════════════════════════════════
// Phase 1: ICD-11 in Visit Creation
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 1 — ICD-11 in Visit Creation', () => {
  describe('createVisitSchema', () => {
    test('accepts valid ICD-11 code BA00', () => {
      const result = createVisitSchema.safeParse({
        patientId: 1,
        icd11Code: 'BA00',
        icd11Description: 'Essential hypertension',
      });
      expect(result.success).toBe(true);
    });

    test('accepts valid ICD-11 code with dot notation CA40.Z', () => {
      const result = createVisitSchema.safeParse({
        patientId: 1,
        icd11Code: 'CA40.Z',
        icd11Description: 'Asthma, unspecified',
      });
      expect(result.success).toBe(true);
    });

    test('accepts numeric-start ICD-11 code 5A11', () => {
      const result = createVisitSchema.safeParse({
        patientId: 1,
        icd11Code: '5A11',
      });
      expect(result.success).toBe(true);
    });

    test('accepts ICD-11 code MG30.0', () => {
      const result = createVisitSchema.safeParse({
        patientId: 1,
        icd11Code: 'MG30.0',
      });
      expect(result.success).toBe(true);
    });

    test('rejects lowercase ICD-11 code', () => {
      const result = createVisitSchema.safeParse({
        patientId: 1,
        icd11Code: 'ba00',
      });
      expect(result.success).toBe(false);
    });

    test('rejects single-char ICD-11 code', () => {
      const result = createVisitSchema.safeParse({
        patientId: 1,
        icd11Code: 'B',
      });
      expect(result.success).toBe(false);
    });

    test('accepts dual coding (ICD-10 + ICD-11 together)', () => {
      const result = createVisitSchema.safeParse({
        patientId: 1,
        icd10Code: 'I10',
        icd10Description: 'Essential hypertension (ICD-10)',
        icd11Code: 'BA00',
        icd11Description: 'Essential hypertension (ICD-11)',
      });
      expect(result.success).toBe(true);
    });

    test('ICD-11 fields are optional — visit without diagnosis is valid', () => {
      const result = createVisitSchema.safeParse({
        patientId: 1,
        visitType: 'opd',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('updateVisitSchema', () => {
    test('accepts ICD-11 update', () => {
      const result = updateVisitSchema.safeParse({
        icd11Code: 'BA00',
        icd11Description: 'Hypertension',
      });
      expect(result.success).toBe(true);
    });

    test('rejects invalid ICD-11 on update', () => {
      const result = updateVisitSchema.safeParse({
        icd11Code: 'invalid!',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dischargeSchema', () => {
    test('accepts final ICD-11 at discharge', () => {
      const result = dischargeSchema.safeParse({
        dischargeDate: '2026-04-09',
        icd11Code: 'CA40.Z',
        icd11Description: 'Asthma final diagnosis',
      });
      expect(result.success).toBe(true);
    });

    test('rejects invalid ICD-11 at discharge', () => {
      const result = dischargeSchema.safeParse({
        dischargeDate: '2026-04-09',
        icd11Code: 'x',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Route integration', () => {
    test('visits POST handler includes icd11Code in INSERT', () => {
      const source = readFileSync(resolve(__dirname, '../src/routes/tenant/visits.ts'), 'utf-8');
      expect(source).toContain('icd11Code: data.icd11Code');
      expect(source).toContain('icd11Description: data.icd11Description');
    });

    test('visits PUT handler includes ICD-11 in update', () => {
      const source = readFileSync(resolve(__dirname, '../src/routes/tenant/visits.ts'), 'utf-8');
      // Check that update handler references icd11Code
      const putSection = source.slice(source.indexOf(".put('/:id'"));
      expect(putSection).toContain('icd11Code');
      expect(putSection).toContain('icd11Description');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2: FHIR Write RBAC
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 2 — FHIR Write RBAC', () => {
  const fhirSource = readFileSync(resolve(__dirname, '../src/routes/tenant/fhir.ts'), 'utf-8');

  test('imports requireRole and role presets', () => {
    expect(fhirSource).toContain("import { requireRole, CLINICAL_ROLES, OPD_ROLES }");
  });

  test('POST /Patient has OPD role guard', () => {
    // Find the POST Patient handler
    const postPatient = fhirSource.slice(fhirSource.indexOf("fhirRoutes.post('/Patient'"));
    const firstLine = postPatient.split('\n')[0];
    expect(firstLine).toContain('requireRole(...OPD_ROLES)');
  });

  test('POST /Observation has CLINICAL role guard', () => {
    const postObs = fhirSource.slice(fhirSource.indexOf("fhirRoutes.post('/Observation'"));
    const firstLine = postObs.split('\n')[0];
    expect(firstLine).toContain('requireRole(...CLINICAL_ROLES)');
  });

  test('POST /Encounter has OPD role guard', () => {
    const postEnc = fhirSource.slice(fhirSource.indexOf("fhirRoutes.post('/Encounter'"));
    const firstLine = postEnc.split('\n')[0];
    expect(firstLine).toContain('requireRole(...OPD_ROLES)');
  });

  test('GET endpoints do NOT have role guards (read-only)', () => {
    const getPatient = fhirSource.match(/fhirRoutes\.get\('\/Patient'/);
    expect(getPatient).toBeTruthy();
    // GET handlers shouldn't have requireRole
    const getPatientLine = fhirSource.slice(fhirSource.indexOf("fhirRoutes.get('/Patient'")).split('\n')[0];
    expect(getPatientLine).not.toContain('requireRole');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3: FHIR Observation Vital Range Validation
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 3 — FHIR Observation Vital Ranges', () => {
  const fhirSource = readFileSync(resolve(__dirname, '../src/routes/tenant/fhir.ts'), 'utf-8');

  test('VITAL_RANGES constant is defined', () => {
    expect(fhirSource).toContain('const VITAL_RANGES');
  });

  test('systolic range matches vitals.ts (40-300)', () => {
    expect(fhirSource).toContain("systolic:");
    expect(fhirSource).toMatch(/systolic:\s*\{\s*min:\s*40,\s*max:\s*300/);
  });

  test('temperature range matches vitals.ts (30-45)', () => {
    expect(fhirSource).toMatch(/temperature:\s*\{\s*min:\s*30,\s*max:\s*45/);
  });

  test('spo2 range is 0-100', () => {
    expect(fhirSource).toMatch(/spo2:\s*\{\s*min:\s*0,\s*max:\s*100/);
  });

  test('validation loop checks ranges before INSERT', () => {
    // The range check should come BEFORE the INSERT statement in the POST handler
    const postObsSection = fhirSource.slice(fhirSource.indexOf("fhirRoutes.post('/Observation'"));
    const rangeCheckPos = postObsSection.indexOf('VITAL_RANGES[column]');
    const insertPos = postObsSection.indexOf('db.insert(patientVitals)');
    expect(rangeCheckPos).toBeGreaterThan(0);
    expect(insertPos).toBeGreaterThan(0);
    expect(rangeCheckPos).toBeLessThan(insertPos);
  });

  test('out-of-range throws 400 with descriptive message', () => {
    expect(fhirSource).toContain('out of clinical range');
  });

  test('Location header uses clean suffix logic (no .replace hack)', () => {
    const postObsSection = fhirSource.slice(fhirSource.indexOf("fhirRoutes.post('/Observation'"));
    expect(postObsSection).toContain("const locationSuffix");
    expect(postObsSection).toContain("vitalKeys.includes('systolic')");
  });

  test('ALLOWED_VITAL_COLUMNS allowlist prevents SQL injection (C-1 fix)', () => {
    expect(fhirSource).toContain('const ALLOWED_VITAL_COLUMNS = new Set(');
    expect(fhirSource).toContain("Unknown vital column:");
    // Allowlist must appear BEFORE the INSERT
    const postObsSection = fhirSource.slice(fhirSource.indexOf("fhirRoutes.post('/Observation'"));
    const allowlistPos = postObsSection.indexOf('ALLOWED_VITAL_COLUMNS');
    const insertPos = postObsSection.indexOf('db.insert(patientVitals)');
    expect(allowlistPos).toBeGreaterThan(0);
    expect(allowlistPos).toBeLessThan(insertPos);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4: Fine-Grained Consent Clinical Area Scoping
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 4 — Clinical Area Consent Scoping', () => {
  describe('globalConsentSchema', () => {
    test('accepts consent with clinical_areas', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_summary',
        clinical_areas: ['labs', 'prescriptions'],
        duration_hours: 24,
      });
      expect(result.success).toBe(true);
    });

    test('accepts all valid area types', () => {
      const allAreas = ['labs', 'prescriptions', 'vitals', 'allergies', 'visits', 'diagnoses', 'all'];
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_full',
        clinical_areas: allAreas,
      });
      expect(result.success).toBe(true);
    });

    test('rejects invalid clinical area', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_summary',
        clinical_areas: ['labs', 'imaging'], // 'imaging' not in enum
      });
      expect(result.success).toBe(false);
    });

    test('clinical_areas is optional (backward compatible)', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_summary',
        duration_hours: 48,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.clinical_areas).toBeUndefined();
      }
    });

    test('accepts single area', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_summary',
        clinical_areas: ['labs'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Migration', () => {
    test('migration 0104 adds clinical_areas column', () => {
      const migration = readFileSync(resolve(__dirname, '../migrations/0104_consent_clinical_areas.sql'), 'utf-8');
      expect(migration).toContain('ALTER TABLE health_record_consents ADD COLUMN clinical_areas TEXT');
    });
  });

  describe('Timeline area filtering', () => {
    const timelineSource = readFileSync(resolve(__dirname, '../src/lib/health-timeline.ts'), 'utf-8');

    test('buildAggregatedHealthRecord accepts clinicalAreas parameter', () => {
      expect(timelineSource).toContain('clinicalAreas?: string[]');
    });

    test('consent query selects clinical_areas column', () => {
      expect(timelineSource).toContain('consent_type, clinical_areas');
    });

    test('consent map stores areas', () => {
      expect(timelineSource).toContain('{ full: boolean; areas: string[] }');
    });

    test('isAreaAllowed helper performs intersection of consent and request areas', () => {
      expect(timelineSource).toContain('function isAreaAllowed(area: string, tenantId: number)');
      expect(timelineSource).toContain("consentInfo.areas.includes('all')");
      expect(timelineSource).toContain("consentInfo.areas.includes(area)");
    });

    test('allergies section checks area permission', () => {
      expect(timelineSource).toContain("isAreaAllowed('allergies', link.tenant_id)");
    });

    test('prescriptions section checks area permission', () => {
      expect(timelineSource).toContain("isAreaAllowed('prescriptions', link.tenant_id)");
    });

    test('diagnoses section checks area permission', () => {
      expect(timelineSource).toContain("isAreaAllowed('diagnoses', link.tenant_id)");
    });

    test('vaccinations are always visible (safety exception)', () => {
      // Vaccinations should NOT be behind an isAreaAllowed check
      const addToTimelineSection = timelineSource.slice(timelineSource.indexOf('function addToTimeline'));
      const vaccinationSection = addToTimelineSection.slice(
        addToTimelineSection.indexOf('Vaccinations'),
        addToTimelineSection.indexOf('Last vitals'),
      );
      expect(vaccinationSection).not.toContain('canShow');
      expect(vaccinationSection).toContain('safety-exception');
    });

    test('globalHealth route stores clinical_areas on consent grant', () => {
      const ghSource = readFileSync(resolve(__dirname, '../src/routes/tenant/globalHealth.ts'), 'utf-8');
      expect(ghSource).toContain('clinical_areas');
      expect(ghSource).toContain('JSON.stringify(data.clinical_areas)');
    });

    test('aggregated health record can resolve UHID-only patient links', () => {
      expect(timelineSource).toContain('phl.national_id = ? OR phl.uhid = ?');
    });

    test('health record lookup accepts UHID aliases for cross-hospital access', () => {
      const healthRecordSource = readFileSync(resolve(__dirname, '../src/routes/tenant/healthRecord.ts'), 'utf-8');
      expect(healthRecordSource).toContain("c.req.query('uhid')");
      expect(healthRecordSource).toContain("c.req.query('global_uid')");
      expect(healthRecordSource).toContain("c.req.query('qid')");
      expect(healthRecordSource).toContain('GLOBAL_UID_REGEX');
    });

    test('patient registration links UHID-only records into the MPI bridge', () => {
      const patientRoutesSource = readFileSync(resolve(__dirname, '../src/routes/tenant/patients.ts'), 'utf-8');
      expect(patientRoutesSource).toContain('const portableIdentityKey = data.nationalId ?? identity.uhid');
      expect(patientRoutesSource).toContain('INSERT OR IGNORE INTO patient_health_links');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 5: Default Treatment-Purpose Access
// ══════════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Treatment-Purpose Access', () => {
  const timelineSource = readFileSync(resolve(__dirname, '../src/lib/health-timeline.ts'), 'utf-8');

  test('treatment-purpose check exists in buildAggregatedHealthRecord', () => {
    expect(timelineSource).toContain('Treatment-purpose access');
  });

  test('checks for active undischarged visit', () => {
    expect(timelineSource).toContain('discharge_date IS NULL');
    expect(timelineSource).toContain('doctor_id = ?');
  });

  test('only applies to non-patient roles', () => {
    // The treatment-purpose block should be guarded by role !== 'patient'
    const treatmentSection = timelineSource.slice(
      timelineSource.indexOf('2b. Treatment-purpose access'),
    );
    const guardLine = treatmentSection.slice(0, treatmentSection.indexOf('\n'));
    // The guard should be somewhere near the start of this section
    expect(timelineSource).toContain("role !== 'patient' && requestingUserId");
  });

  test('grants view_summary scope (not full)', () => {
    // Treatment-purpose should give { full: false, areas: ['all'] }
    const treatmentSection = timelineSource.slice(
      timelineSource.indexOf('Treatment-purpose access'),
      timelineSource.indexOf('Resolve effective clinical areas'),
    );
    expect(treatmentSection).toContain("full: false, areas: ['all']");
  });

  test('only checks unconsented hospitals', () => {
    expect(timelineSource).toContain('!consentedTenants.has(l.tenant_id)');
  });

  test('logs treatment_purpose access via consent-rules engine', () => {
    expect(timelineSource).toContain('autoGrantTreatmentConsent');
  });

  test('access log is fire-and-forget (catch pattern)', () => {
    const treatmentSection = timelineSource.slice(
      timelineSource.indexOf('Treatment-purpose access'),
      timelineSource.indexOf('Resolve effective clinical areas'),
    );
    expect(treatmentSection).toContain('.catch(');
  });

  test('treatment-purpose check happens AFTER consent map and BEFORE hospital loop', () => {
    const consentMapEnd = timelineSource.indexOf('consentedTenants.set(consent.granting_tenant_id');
    const treatmentCheck = timelineSource.indexOf('Treatment-purpose access');
    const hospitalLoop = timelineSource.indexOf('3. Build summaries');
    expect(treatmentCheck).toBeGreaterThan(consentMapEnd);
    expect(treatmentCheck).toBeLessThan(hospitalLoop);
  });

  test('treatment-purpose uses parallel Promise.all (H-1 fix)', () => {
    const treatmentSection = timelineSource.slice(
      timelineSource.indexOf('Treatment-purpose access'),
      timelineSource.indexOf('Resolve effective clinical areas'),
    );
    expect(treatmentSection).toContain('Promise.all');
  });

  test('JSON.parse of clinical_areas is wrapped in try/catch (M-5 fix)', () => {
    expect(timelineSource).toContain('try { consentAreas = JSON.parse(consent.clinical_areas)');
  });
});

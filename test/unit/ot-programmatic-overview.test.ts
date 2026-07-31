import { describe, expect, it } from 'vitest';

/**
 * Tests for the Programmatic OT Overview risk scorer.
 *
 * The scorer is a PURE function — given a structured set of patient
 * signals, it returns a deterministic score, level, and list of flags.
 * These tests pin down the documented weights in
 * docs/ot-blueptint.md (section 13) so that clinical behavior is
 * reproducible and any future tuning is intentional.
 *
 * IMPORTANT: run `npm test test/unit/ot-programmatic-overview.test.ts`
 * and watch every test fail with import / function-not-found errors
 * before writing the production code.
 */

describe('OVERVIEW_VERIFICATION_NOTICE', () => {
  it('is a non-empty string that mentions verification', async () => {
    const { OVERVIEW_VERIFICATION_NOTICE } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    expect(typeof OVERVIEW_VERIFICATION_NOTICE).toBe('string');
    expect(OVERVIEW_VERIFICATION_NOTICE.length).toBeGreaterThan(20);
    expect(OVERVIEW_VERIFICATION_NOTICE.toLowerCase()).toContain('verif');
  });
});

describe('detectAnticoagulants (pure function)', () => {
  it('returns an empty array when there are no medications', async () => {
    const { detectAnticoagulants } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = detectAnticoagulants([], []);
    expect(result).toEqual([]);
  });

  it('detects warfarin by name', async () => {
    const { detectAnticoagulants } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = detectAnticoagulants(
      [
        {
          id: 1,
          medication_name: 'Warfarin 5mg',
          generic_name: 'warfarin',
          strength: '5mg',
          dosage_form: 'tablet',
          is_active: 1,
        },
      ],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].drug).toBe('Warfarin 5mg');
    expect(result[0].source_id).toBe(1);
  });

  it('detects heparin from prescription_items rows', async () => {
    const { detectAnticoagulants } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = detectAnticoagulants(
      [],
      [
        {
          id: 42,
          medication_name: 'Heparin injection',
          generic_name: null,
          status: 'final',
        },
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0].source_id).toBe(42);
  });

  it('does not flag unrelated drugs (e.g. paracetamol)', async () => {
    const { detectAnticoagulants } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = detectAnticoagulants(
      [
        {
          id: 9,
          medication_name: 'Paracetamol 500mg',
          generic_name: 'acetaminophen',
          strength: '500mg',
          dosage_form: 'tablet',
          is_active: 1,
        },
      ],
      [],
    );
    expect(result).toEqual([]);
  });

  it('deduplicates the same drug appearing in both active meds and prescriptions', async () => {
    const { detectAnticoagulants } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = detectAnticoagulants(
      [
        {
          id: 1,
          medication_name: 'Aspirin 75mg',
          generic_name: 'acetylsalicylic acid',
          strength: '75mg',
          dosage_form: 'tablet',
          is_active: 1,
        },
      ],
      [
        {
          id: 2,
          medication_name: 'Aspirin 75mg',
          generic_name: null,
          status: 'final',
        },
      ],
    );
    // Each unique source_id counts once; expect both to appear because
    // the spec wants full provenance, not silent dedup.
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.source_id).sort()).toEqual([1, 2]);
  });
});

describe('computeRiskScore (pure function)', () => {
  it('returns 0 / low with no signals', async () => {
    const { computeRiskScore } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = computeRiskScore({
      age: 35,
      gender: 'male',
      date_of_birth: null,
      allergies: [],
      anticoagulants: [],
      chronic_conditions: [],
      abnormal_labs: [],
      previous_surgeries: [],
    });
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
    expect(result.flags).toEqual([]);
  });

  it('adds 30 for a life_threatening drug allergy and flags it', async () => {
    const { computeRiskScore } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = computeRiskScore({
      age: 30,
      gender: 'female',
      date_of_birth: null,
      allergies: [
        {
          allergen: 'Penicillin',
          severity: 'life_threatening',
          reaction: 'anaphylaxis',
          verified: true,
          source_id: 1,
        },
      ],
      anticoagulants: [],
      chronic_conditions: [],
      abnormal_labs: [],
      previous_surgeries: [],
    });
    expect(result.score).toBe(30);
    expect(result.level).toBe('medium');
    expect(result.flags).toContain('LIFE_THREATENING_ALLERGY:Penicillin');
  });

  it('adds 20 when the patient is on any anticoagulant', async () => {
    const { computeRiskScore } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = computeRiskScore({
      age: 60,
      gender: 'male',
      date_of_birth: null,
      allergies: [],
      anticoagulants: [
        { drug: 'Warfarin 5mg', generic: 'warfarin', strength: '5mg', source_id: 7 },
      ],
      chronic_conditions: [],
      abnormal_labs: [],
      previous_surgeries: [],
    });
    expect(result.score).toBe(20);
    expect(result.level).toBe('low');
    expect(result.flags).toContain('ANTICOAGULANT:Warfarin 5mg');
  });

  it('adds 8 for an E11 type 2 diabetes diagnosis', async () => {
    const { computeRiskScore } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = computeRiskScore({
      age: 55,
      gender: 'male',
      date_of_birth: null,
      allergies: [],
      anticoagulants: [],
      chronic_conditions: [
        {
          code: 'E11.9',
          description: 'Type 2 diabetes mellitus without complications',
          type: 'primary',
          is_active: true,
          source_id: 9,
        },
      ],
      abnormal_labs: [],
      previous_surgeries: [],
    });
    expect(result.score).toBe(8);
    expect(result.flags).toContain('CHRONIC:Type 2 diabetes mellitus');
  });

  it('adds 12 for age >= 75', async () => {
    const { computeRiskScore } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = computeRiskScore({
      age: 80,
      gender: 'female',
      date_of_birth: null,
      allergies: [],
      anticoagulants: [],
      chronic_conditions: [],
      abnormal_labs: [],
      previous_surgeries: [],
    });
    expect(result.score).toBe(12);
    expect(result.flags).toContain('AGE_GT_75');
  });

  it('caps the score at 100 and assigns critical level at 86+', async () => {
    const { computeRiskScore } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = computeRiskScore({
      age: 80,
      gender: 'female',
      date_of_birth: null,
      allergies: [
        { allergen: 'Latex', severity: 'life_threatening', reaction: null, verified: true, source_id: 1 },
        { allergen: 'Iodine', severity: 'severe', reaction: null, verified: true, source_id: 2 },
      ],
      anticoagulants: [{ drug: 'Apixaban', generic: null, strength: null, source_id: 3 }],
      chronic_conditions: [
        { code: 'I25.10', description: 'Atherosclerotic heart disease', type: 'primary', is_active: true, source_id: 4 },
        { code: 'I50.22', description: 'Chronic systolic heart failure', type: 'secondary', is_active: true, source_id: 5 },
      ],
      abnormal_labs: [
        { test: 'Potassium', result: '6.8', flag: 'critical', reported_at: '2026-01-01', source_id: 6 },
        { test: 'Creatinine', result: '2.4', flag: 'high', reported_at: '2026-01-01', source_id: 7 },
      ],
      previous_surgeries: [
        { procedure: 'CABG', date: '2020-01-01', source_id: 8 },
        { procedure: 'Cholecystectomy', date: '2015-01-01', source_id: 9 },
        { procedure: 'Appendectomy', date: '2010-01-01', source_id: 10 },
      ],
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(86);
    expect(result.level).toBe('critical');
  });

  it('adds 6 for pregnancy-related chronic condition (O09 / O26) in females', async () => {
    const { computeRiskScore } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const result = computeRiskScore({
      age: 28,
      gender: 'female',
      date_of_birth: null,
      allergies: [],
      anticoagulants: [],
      chronic_conditions: [
        { code: 'O09.90', description: 'Supervision of high-risk pregnancy', type: 'primary', is_active: true, source_id: 1 },
      ],
      abnormal_labs: [],
      previous_surgeries: [],
    });
    expect(result.flags).toContain('PREGNANCY_RELATED');
  });

  it('is deterministic — same input yields the same score on every call', async () => {
    const { computeRiskScore } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const input = {
      age: 50,
      gender: 'male' as const,
      date_of_birth: null,
      allergies: [
        { allergen: 'Aspirin', severity: 'moderate' as const, reaction: null, verified: true, source_id: 1 },
      ],
      anticoagulants: [],
      chronic_conditions: [
        { code: 'I10', description: 'Essential hypertension', type: 'primary' as const, is_active: true, source_id: 2 },
      ],
      abnormal_labs: [],
      previous_surgeries: [],
    };
    const a = computeRiskScore(input);
    const b = computeRiskScore(input);
    expect(a.score).toBe(b.score);
    expect(a.level).toBe(b.level);
    expect(a.flags.sort()).toEqual(b.flags.sort());
  });
});

describe('buildProgrammaticOverview (aggregator)', () => {
  // Helper: a mock DB whose every query returns the patient fixture
  // and empty arrays for everything else. This is the "young healthy
  // patient" baseline.
  function makeHealthyMockDb() {
    return {
      prepare(sql: string) {
        const s = sql.toLowerCase();
        return {
          bind(..._params: unknown[]) {
            return {
              async all<T>() {
                if (s.includes('from patients')) {
                  return {
                    results: [
                      {
                        id: 100,
                        patient_code: 'P-100',
                        name: 'Test Patient',
                        age: 30,
                        gender: 'male',
                        blood_group: 'O+',
                        date_of_birth: '1996-01-01',
                        tenant_id: '1',
                      },
                    ] as T[],
                    success: true,
                    meta: {},
                  };
                }
                return { results: [] as T[], success: true, meta: {} };
              },
              async first<T>() {
                if (s.includes('from patients')) {
                  return {
                    id: 100,
                    patient_code: 'P-100',
                    name: 'Test Patient',
                    age: 30,
                    gender: 'male',
                    blood_group: 'O+',
                    date_of_birth: '1996-01-01',
                    tenant_id: '1',
                  } as T;
                }
                return null;
              },
              async run() {
                return { success: true, meta: { last_row_id: 1, changes: 0, duration: 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
  }

  it('returns the verification notice on every response', async () => {
    const { buildProgrammaticOverview, OVERVIEW_VERIFICATION_NOTICE } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = makeHealthyMockDb();
    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100 });
    expect(result.verification_notice).toBe(OVERVIEW_VERIFICATION_NOTICE);
  });

  it('includes the patient profile fields in the response', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = makeHealthyMockDb();
    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100 });
    expect(result.patient.patient_id).toBe(100);
    expect(result.patient.name).toBe('Test Patient');
    expect(result.patient.blood_group).toBe('O+');
    expect(result.patient.age).toBe(30);
  });

  it('returns a low risk level for a healthy 30-year-old with no signals', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = makeHealthyMockDb();
    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100 });
    expect(result.risk.level).toBe('low');
    expect(result.risk.score).toBe(0);
    expect(result.allergies).toEqual([]);
    expect(result.anticoagulants).toEqual([]);
    expect(result.chronic_conditions).toEqual([]);
    expect(result.abnormal_labs).toEqual([]);
    expect(result.previous_surgeries).toEqual([]);
  });

  it('sets generated_at to a recent ISO timestamp', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = makeHealthyMockDb();
    const before = Date.now();
    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100 });
    const after = Date.now();
    const ts = new Date(result.generated_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('aggregates drug allergies from patient_allergies and sorts by severity', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = {
      prepare(sql: string) {
        const s = sql.toLowerCase();
        return {
          bind(..._params: unknown[]) {
            return {
              async all<T>() {
                if (s.includes('from patients')) {
                  return {
                    results: [
                      { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' },
                    ] as T[],
                    success: true, meta: {},
                  };
                }
                if (s.includes('from patient_allergies')) {
                  // Return in the order the production SQL would
                  // (ORDER BY CASE severity). The mock does not
                  // simulate the ORDER BY clause, so we pre-sort
                  // the fixture.
                  return {
                    results: [
                      { id: 2, allergen: 'Latex', allergy_type: 'drug', severity: 'life_threatening', reaction: 'anaphylaxis', verified_by: null, is_active: 1 },
                      { id: 1, allergen: 'Penicillin', allergy_type: 'drug', severity: 'severe', reaction: 'rash', verified_by: 5, is_active: 1 },
                      { id: 3, allergen: 'Peanuts', allergy_type: 'food', severity: 'mild', reaction: 'hives', verified_by: 5, is_active: 1 },
                    ] as T[],
                    success: true, meta: {},
                  };
                }
                return { results: [] as T[], success: true, meta: {} };
              },
              async first<T>() {
                if (s.includes('from patients')) {
                  return { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' } as T;
                }
                return null;
              },
              async run() {
                return { success: true, meta: { last_row_id: 1, changes: 0, duration: 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100 });
    expect(result.allergies).toHaveLength(2); // only 'drug' type
    expect(result.allergies[0].allergen).toBe('Latex'); // life_threatening first
    expect(result.allergies[0].severity).toBe('life_threatening');
    expect(result.allergies[0].verified).toBe(false);
    expect(result.allergies[1].allergen).toBe('Penicillin');
    // Score should jump because of life_threatening +30 and severe +18
    expect(result.risk.score).toBe(48);
    // 26-50 is "medium" per the documented bucket boundaries.
    expect(result.risk.level).toBe('medium');
    expect(result.risk.flags).toContain('LIFE_THREATENING_ALLERGY:Latex');
    expect(result.risk.flags).toContain('SEVERE_ALLERGY:Penicillin');
  });

  it('aggregates abnormal labs from lab_results and flags them when high-risk', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = {
      prepare(sql: string) {
        const s = sql.toLowerCase();
        return {
          bind(..._params: unknown[]) {
            return {
              async all<T>() {
                if (s.includes('from patients')) {
                  return { results: [
                    { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' },
                  ] as T[], success: true, meta: {} };
                }
                if (s.includes('from lab_results')) {
                  return { results: [
                    { id: 11, result_text: '6.8', result_value: '6.8', abnormal_flag: 'critical', result_status: 'final', created_at: '2026-05-01', test_name: 'Potassium', test_code: 'K' },
                    { id: 12, result_text: '2.4', result_value: '2.4', abnormal_flag: 'high', result_status: 'final', created_at: '2026-05-01', test_name: 'Creatinine', test_code: 'CR' },
                    { id: 13, result_text: 'normal', result_value: 'normal', abnormal_flag: 'normal', result_status: 'final', created_at: '2026-05-01', test_name: 'Sodium', test_code: 'NA' },
                  ] as T[], success: true, meta: {} };
                }
                return { results: [] as T[], success: true, meta: {} };
              },
              async first<T>() {
                if (s.includes('from patients')) {
                  return { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' } as T;
                }
                return null;
              },
              async run() {
                return { success: true, meta: { last_row_id: 1, changes: 0, duration: 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100 });
    expect(result.abnormal_labs).toHaveLength(3);
    // 2 are high-risk keywords (potassium, creatinine) and 1 isn't
    expect(result.risk.flags).toContain('ABNORMAL_LABS:2');
    // +5/each capped at 15 → 2*5 = 10
    expect(result.risk.score).toBe(10);
  });

  it('loads last vitals from clinical_vitals and formats BP as systolic/diastolic', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = {
      prepare(sql: string) {
        const s = sql.toLowerCase();
        return {
          bind(..._params: unknown[]) {
            return {
              async all<T>() {
                if (s.includes('from patients')) {
                  return { results: [
                    { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' },
                  ] as T[], success: true, meta: {} };
                }
                return { results: [] as T[], success: true, meta: {} };
              },
              async first<T>() {
                if (s.includes('from patients')) {
                  return { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' } as T;
                }
                if (s.includes('from clinical_vitals')) {
                  return {
                    blood_pressure_systolic: 140,
                    blood_pressure_diastolic: 90,
                    pulse: 88,
                    spo2: 96,
                    temperature: 37.2,
                    taken_at: '2026-05-15 09:00:00',
                  } as T;
                }
                return null;
              },
              async run() {
                return { success: true, meta: { last_row_id: 1, changes: 0, duration: 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100 });
    expect(result.last_vitals).not.toBeNull();
    expect(result.last_vitals?.bp).toBe('140/90');
    expect(result.last_vitals?.pulse).toBe(88);
    expect(result.last_vitals?.spo2).toBe(96);
    expect(result.last_vitals?.temperature).toBe(37.2);
  });

  it('aggregates pre-OT clearance items and computes readiness percentage', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = {
      prepare(sql: string) {
        const s = sql.toLowerCase();
        return {
          bind(..._params: unknown[]) {
            return {
              async all<T>() {
                if (s.includes('from patients')) {
                  return { results: [
                    { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' },
                  ] as T[], success: true, meta: {} };
                }
                if (s.includes('from ot_clearance_checks')) {
                  return { results: [
                    { id: 1, check_type: 'consent', is_required: 1, status: 'done', verified_by: 5, verified_at: '2026-05-01' },
                    { id: 2, check_type: 'blood_group', is_required: 1, status: 'done', verified_by: 5, verified_at: '2026-05-01' },
                    { id: 3, check_type: 'pac', is_required: 1, status: 'pending', verified_by: null, verified_at: null },
                    { id: 4, check_type: 'lab_review', is_required: 0, status: 'pending', verified_by: null, verified_at: null },
                  ] as T[], success: true, meta: {} };
                }
                return { results: [] as T[], success: true, meta: {} };
              },
              async first<T>() {
                if (s.includes('from patients')) {
                  return { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' } as T;
                }
                return null;
              },
              async run() {
                return { success: true, meta: { last_row_id: 1, changes: 0, duration: 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100, case_id: 50 });
    expect(result.pre_ot_clearance.items).toHaveLength(4);
    expect(result.pre_ot_clearance.required_total).toBe(3); // 1 is not required
    expect(result.pre_ot_clearance.required_done).toBe(2);
    expect(result.pre_ot_clearance.readiness_percent).toBe(67);
  });

  it('treats pre-OT readiness as 100% when no clearance items exist', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = {
      prepare(sql: string) {
        const s = sql.toLowerCase();
        return {
          bind(..._params: unknown[]) {
            return {
              async all<T>() {
                if (s.includes('from patients')) {
                  return { results: [
                    { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' },
                  ] as T[], success: true, meta: {} };
                }
                return { results: [] as T[], success: true, meta: {} };
              },
              async first<T>() {
                if (s.includes('from patients')) {
                  return { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' } as T;
                }
                return null;
              },
              async run() {
                return { success: true, meta: { last_row_id: 1, changes: 0, duration: 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100 });
    expect(result.pre_ot_clearance.items).toEqual([]);
    expect(result.pre_ot_clearance.required_total).toBe(0);
    expect(result.pre_ot_clearance.readiness_percent).toBe(100);
  });

  it('builds UI signals with provenance for each clinical input', async () => {
    const { buildProgrammaticOverview } = await import(
      '../../src/lib/ot-programmatic-overview'
    );
    const db = {
      prepare(sql: string) {
        const s = sql.toLowerCase();
        return {
          bind(..._params: unknown[]) {
            return {
              async all<T>() {
                if (s.includes('from patients')) {
                  return { results: [
                    { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' },
                  ] as T[], success: true, meta: {} };
                }
                if (s.includes('from patient_allergies')) {
                  return { results: [
                    { id: 1, allergen: 'Penicillin', allergy_type: 'drug', severity: 'life_threatening', reaction: 'anaphylaxis', verified_by: 5, is_active: 1 },
                  ] as T[], success: true, meta: {} };
                }
                if (s.includes('from ot_clearance_checks')) {
                  return { results: [
                    { id: 1, check_type: 'consent', is_required: 1, status: 'pending', verified_by: null, verified_at: null },
                    { id: 2, check_type: 'pac', is_required: 1, status: 'done', verified_by: 5, verified_at: '2026-05-01' },
                  ] as T[], success: true, meta: {} };
                }
                return { results: [] as T[], success: true, meta: {} };
              },
              async first<T>() {
                if (s.includes('from patients')) {
                  return { id: 100, patient_code: 'P-100', name: 'P', age: 30, gender: 'male', blood_group: 'O+', date_of_birth: null, tenant_id: '1' } as T;
                }
                return null;
              },
              async run() {
                return { success: true, meta: { last_row_id: 1, changes: 0, duration: 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await buildProgrammaticOverview(db, '1', { patient_id: 100, case_id: 50 });
    // blood group + age + allergy + pre-ot readiness
    expect(result.signals.length).toBeGreaterThanOrEqual(3);
    const bloodGroup = result.signals.find((s) => s.key === 'blood_group');
    expect(bloodGroup?.value).toBe('O+');
    expect(bloodGroup?.source).toBe('patient_profile');
    const age = result.signals.find((s) => s.key === 'age');
    expect(age?.value).toBe('30 (male)');
    const allergy = result.signals.find((s) => s.key.startsWith('allergy:'));
    expect(allergy?.severity).toBe('critical');
    expect(allergy?.source).toBe('patient_allergies');
    const readiness = result.signals.find((s) => s.key === 'pre_ot_readiness');
    expect(readiness?.value).toBe('50% (1/2)');
    expect(readiness?.severity).toBe('alert'); // < 60% is alert
  });
});

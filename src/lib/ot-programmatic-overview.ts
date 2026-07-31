/**
 * Programmatic OT Patient Overview
 * =================================
 *
 * Deterministic, rule-based, SQL-only aggregator that replaces the AI
 * Overview from docs/ot-blueptint.md (sections 13.1, 32.1).
 *
 * Why programmatic, not LLM?
 * - Clinical decisions must NEVER depend on LLM hallucinations.
 * - Bangladesh hospitals have unreliable internet; LLM calls are offline-hostile.
 * - Auditors need reproducible output: same input -> same output.
 * - The blueprint itself mandates (section 32 Safety Rule): "AI will not
 *   make any clinical decision final. All decisions verified by
 *   doctor/nurse."
 *
 * This module is the safe-by-default implementation: every signal is
 * traceable to a source row, the risk score is a pure function of the
 * signals, and the response always carries a verification caveat.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AllergyAlert {
  allergen: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
  reaction: string | null;
  verified: boolean;
  source_id: number;
}

export interface AnticoagulantAlert {
  drug: string;
  generic: string | null;
  strength: string | null;
  source_id: number;
}

export interface ChronicConditionSignal {
  code: string | null;
  description: string;
  type: 'primary' | 'secondary' | 'admitting' | 'discharge';
  is_active: boolean;
  source_id: number;
}

export interface AbnormalLab {
  test: string;
  result: string;
  flag: string;
  reported_at: string;
  source_id: number;
}

export interface PreviousSurgery {
  procedure: string;
  date: string | null;
  source_id: number;
}

export interface RiskInput {
  age: number | null;
  gender: string | null;
  date_of_birth: string | null;
  allergies: AllergyAlert[];
  anticoagulants: AnticoagulantAlert[];
  chronic_conditions: ChronicConditionSignal[];
  abnormal_labs: AbnormalLab[];
  previous_surgeries: PreviousSurgery[];
}

export interface RiskOutput {
  score: number;
  level: RiskLevel;
  flags: string[];
}

const RISK_CAP = 100;

/**
 * ICD-10 prefix -> clinical label and weight.
 * Weights and labels are derived from the blueprint's documented
 * perioperative risk weighting (see docs/ot-blueptint.md section 13.2).
 */
const HIGH_RISK_ICD10_PREFIXES: ReadonlyArray<{ prefix: string; label: string; weight: number }> = [
  { prefix: 'E10', label: 'Type 1 diabetes mellitus', weight: 8 },
  { prefix: 'E11', label: 'Type 2 diabetes mellitus', weight: 8 },
  { prefix: 'I10', label: 'Essential hypertension', weight: 4 },
  { prefix: 'I11', label: 'Hypertensive heart disease', weight: 6 },
  { prefix: 'I12', label: 'Hypertensive renal disease', weight: 6 },
  { prefix: 'I20', label: 'Angina pectoris', weight: 8 },
  { prefix: 'I21', label: 'Acute myocardial infarction', weight: 12 },
  { prefix: 'I22', label: 'Subsequent myocardial infarction', weight: 12 },
  { prefix: 'I25', label: 'Chronic ischaemic heart disease', weight: 10 },
  { prefix: 'I48', label: 'Atrial fibrillation / flutter', weight: 10 },
  { prefix: 'I50', label: 'Heart failure', weight: 10 },
  { prefix: 'I63', label: 'Cerebral infarction', weight: 8 },
  { prefix: 'I64', label: 'Stroke, not specified', weight: 8 },
  { prefix: 'J44', label: 'COPD', weight: 8 },
  { prefix: 'J45', label: 'Asthma', weight: 4 },
  { prefix: 'K70', label: 'Alcoholic liver disease', weight: 8 },
  { prefix: 'K72', label: 'Hepatic failure', weight: 12 },
  { prefix: 'N18', label: 'Chronic kidney disease', weight: 8 },
  { prefix: 'N19', label: 'Unspecified kidney failure', weight: 8 },
  { prefix: 'B18', label: 'Chronic viral hepatitis', weight: 10 },
  { prefix: 'Z21', label: 'Asymptomatic HIV', weight: 10 },
  { prefix: 'O09', label: 'Pregnancy supervision (high-risk)', weight: 12 },
  { prefix: 'O26', label: 'Pregnancy-related conditions', weight: 6 },
];

/**
 * Lab test name keywords for high-risk abnormal results.
 * Used to filter abnormal_labs before counting.
 */
const HIGH_RISK_LAB_KEYWORDS = [
  'potassium',
  'sodium',
  'creatinine',
  'hemoglobin',
  'haemoglobin',
  'platelet',
  'inr',
  'pt',
  'aptt',
  'glucose',
  'sugar',
  'bilirubin',
  'hba1c',
];

/**
 * Deterministic additive risk model. Capped at 100. Same input -> same output.
 * Documented in the function so future maintainers can justify every weight.
 */
export function computeRiskScore(input: RiskInput): RiskOutput {
  const flags: string[] = [];
  let score = 0;

  // --- Hard signals: drug allergies ---
  for (const a of input.allergies) {
    if (a.severity === 'life_threatening') {
      score += 30;
      flags.push(`LIFE_THREATENING_ALLERGY:${a.allergen}`);
    } else if (a.severity === 'severe') {
      score += 18;
      flags.push(`SEVERE_ALLERGY:${a.allergen}`);
    } else if (a.severity === 'moderate') {
      score += 8;
      flags.push(`MODERATE_ALLERGY:${a.allergen}`);
    }
  }

  // --- Hard signals: anticoagulants ---
  if (input.anticoagulants.length > 0) {
    score += 20;
    flags.push(`ANTICOAGULANT:${input.anticoagulants.map((a) => a.drug).join(',')}`);
  }

  // --- Soft signals: chronic conditions (ICD-10 weighted) ---
  for (const c of input.chronic_conditions) {
    if (!c.code) continue;
    const code = c.code; // narrow for closure capture
    const matched = HIGH_RISK_ICD10_PREFIXES.find((p) =>
      code.toUpperCase().startsWith(p.prefix),
    );
    if (matched) {
      score += matched.weight;
      flags.push(`CHRONIC:${matched.label}`);
    }
  }

  // --- Soft signals: abnormal labs (capped) ---
  const highRiskLabCount = input.abnormal_labs.filter((l) => {
    const t = l.test.toLowerCase();
    const flagged =
      l.flag === 'high' ||
      l.flag === 'low' ||
      l.flag === 'critical' ||
      l.flag === 'abnormal';
    return flagged && HIGH_RISK_LAB_KEYWORDS.some((k) => t.includes(k));
  }).length;
  if (highRiskLabCount > 0) {
    score += Math.min(15, highRiskLabCount * 5);
    flags.push(`ABNORMAL_LABS:${highRiskLabCount}`);
  }

  // --- Soft signals: age extremes ---
  const age = input.age;
  if (age != null) {
    if (age >= 75) {
      score += 12;
      flags.push('AGE_GT_75');
    } else if (age >= 65) {
      score += 6;
      flags.push('AGE_65_TO_74');
    } else if (age <= 2) {
      score += 10;
      flags.push('AGE_LT_2');
    } else if (age <= 12) {
      score += 4;
      flags.push('AGE_PEDIATRIC');
    }
  }

  // --- Soft signals: previous surgery burden (proxy for comorbidities) ---
  if (input.previous_surgeries.length >= 3) {
    score += 4;
    flags.push('MULTIPLE_PRIOR_SURGERIES');
  }

  // --- Pregnancy flag (if female and any O09/O26 chronic code) ---
  const isFemale = (input.gender ?? '').toLowerCase() === 'female';
  const pregnancyCode = input.chronic_conditions.find((c) => {
    if (!c.code) return false;
    const u = c.code.toUpperCase();
    return u.startsWith('O09') || u.startsWith('O26');
  });
  if (isFemale && pregnancyCode) {
    score += 6;
    flags.push('PREGNANCY_RELATED');
  }

  // Cap and bucket
  const finalScore = Math.min(RISK_CAP, Math.max(0, Math.round(score)));
  const level: RiskLevel =
    finalScore >= 76 ? 'critical' :
    finalScore >= 51 ? 'high' :
    finalScore >= 26 ? 'medium' :
    'low';

  return { score: finalScore, level, flags };
}

/**
 * The blueprint safety rule: AI summary is for assistance only.
 * This string is the programmatic equivalent — verbatim from the
 * blueprint and required to appear on every Overview response.
 */
export const OVERVIEW_VERIFICATION_NOTICE =
  'Programmatic OT Overview is for clinical assistance only. Verify all fields against the patient file and the latest investigations before any surgical decision.';

/**
 * Drug-name tokens that indicate anticoagulant / antiplatelet therapy.
 * Matched case-insensitively against medication_name and generic_name.
 * Source: common perioperative anticoagulant / antiplatelet classes.
 */
const ANTICOAGULANT_TOKENS = [
  'warfarin',
  'heparin',
  'enoxaparin',
  'rivaroxaban',
  'apixaban',
  'dabigatran',
  'edoxaban',
  'fondaparinux',
  'clopidogrel',
  'prasugrel',
  'ticagrelor',
  'dipyridamole',
  'aspirin',
  'acetylsalicylic',
];

export interface ActiveMedRow {
  id: number;
  medication_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  is_active: number;
}

export interface PrescriptionRow {
  id: number;
  medication_name: string;
  generic_name: string | null;
  status: string | null;
}

/**
 * Pure function: given the patient's active medications and recent
 * prescription items, return the subset that look like anticoagulants /
 * antiplatelets. Each match is returned with its source_id for full
 * provenance in the UI.
 */
export function detectAnticoagulants(
  activeMeds: ActiveMedRow[],
  prescriptions: PrescriptionRow[],
): AnticoagulantAlert[] {
  const found: AnticoagulantAlert[] = [];
  for (const m of activeMeds) {
    const lower = `${m.medication_name} ${m.generic_name ?? ''}`.toLowerCase();
    if (ANTICOAGULANT_TOKENS.some((t) => lower.includes(t))) {
      found.push({
        drug: m.medication_name,
        generic: m.generic_name,
        strength: m.strength,
        source_id: m.id,
      });
    }
  }
  for (const p of prescriptions) {
    const lower = `${p.medication_name} ${p.generic_name ?? ''}`.toLowerCase();
    if (ANTICOAGULANT_TOKENS.some((t) => lower.includes(t))) {
      found.push({
        drug: p.medication_name,
        generic: p.generic_name,
        strength: null,
        source_id: p.id,
      });
    }
  }
  return found;
}

// ─── Aggregator ─────────────────────────────────────────────────────────────

import type { D1Database } from '@cloudflare/workers-types';

export interface PatientProfile {
  patient_id: number;
  patient_code: string | null;
  name: string | null;
  age: number | null;
  gender: string | null;
  blood_group: string | null;
}

export interface ProgrammaticOverview {
  generated_at: string;
  verification_notice: string;
  patient: PatientProfile;
  allergies: AllergyAlert[];
  anticoagulants: AnticoagulantAlert[];
  chronic_conditions: ChronicConditionSignal[];
  abnormal_labs: AbnormalLab[];
  previous_surgeries: PreviousSurgery[];
  pre_ot_clearance: {
    items: Array<{
      check_type: string;
      status: 'pending' | 'done' | 'rejected' | 'waived' | 'not_required';
      is_required: boolean;
      verified_by: number | null;
      verified_at: string | null;
    }>;
    required_total: number;
    required_done: number;
    readiness_percent: number;
  };
  last_vitals: {
    bp: string | null;
    pulse: number | null;
    spo2: number | null;
    temperature: number | null;
    recorded_at: string | null;
  } | null;
  signals: Array<{
    key: string;
    label: string;
    value: string;
    source: string;
    severity: 'info' | 'warn' | 'alert' | 'critical';
    observed_at?: string;
  }>;
  risk: RiskOutput;
}

export interface OverviewParams {
  patient_id: number;
  visit_id?: number | null;
  case_id?: number | null;
}

interface PatientRow {
  id: number;
  patient_code: string | null;
  name: string | null;
  age: number | null;
  gender: string | null;
  blood_group: string | null;
  date_of_birth: string | null;
}

/**
 * Build the deterministic Programmatic OT Overview for a patient.
 * Read-only, fan-out of indexed lookups.
 *
 * NOTE: this is the MVP aggregator. Subsequent TDD cycles will add
 * the allergy, lab, diagnosis, vitals, clearance, and surgery-history
 * loaders as their behavior is pinned down by tests.
 */
export async function buildProgrammaticOverview(
  db: D1Database,
  tenantId: string,
  params: OverviewParams,
): Promise<ProgrammaticOverview> {
  const patient = await loadPatient(db, tenantId, params.patient_id);

  const [allergyRows, activeMedRows, prescriptionRows, labRows, primaryDiagRows, finalDiagRows, pastBookings, clearanceRows, lastVitals] = await Promise.all([
    loadAllergies(db, tenantId, params.patient_id),
    loadActiveMedications(db, tenantId, params.patient_id),
    loadRecentPrescriptions(db, tenantId, params.patient_id),
    loadAbnormalLabs(db, tenantId, params.patient_id),
    loadDiagnoses(db, tenantId, params.patient_id, 'ClinicalDiagnosis'),
    loadDiagnoses(db, tenantId, params.patient_id, 'final_diagnosis'),
    loadPastOtBookings(db, tenantId, params.patient_id),
    params.case_id != null
      ? loadClearance(db, tenantId, params.case_id)
      : Promise.resolve([] as ClearanceRow[]),
    loadLastVitals(db, tenantId, params.patient_id, params.visit_id ?? null),
  ]);

  const allergies: AllergyAlert[] = allergyRows
    .filter((a) => a.is_active === 1 && (a.allergy_type ?? '').toLowerCase() === 'drug')
    .map((a) => ({
      allergen: a.allergen,
      severity: (a.severity ?? 'mild') as AllergyAlert['severity'],
      reaction: a.reaction,
      verified: a.verified_by != null,
      source_id: a.id,
    }));

  const anticoagulants = detectAnticoagulants(activeMedRows, prescriptionRows);

  const allDiags: DiagnosisRow[] = [...primaryDiagRows, ...finalDiagRows];
  const chronic_conditions: ChronicConditionSignal[] = dedupeDiagnoses(allDiags)
    .filter((d) => (d.is_active ?? 1) === 1)
    .map((d) => ({
      code: d.icd10_code,
      description: d.icd10_description ?? 'Unspecified condition',
      type: ((d.diagnosis_type ?? 'secondary') as ChronicConditionSignal['type']),
      is_active: (d.is_active ?? 1) === 1,
      source_id: d.id,
    }));

  const abnormal_labs: AbnormalLab[] = labRows.map((r) => ({
    test: r.test_name ?? r.test_code ?? 'Unknown test',
    result: r.result_text ?? r.result_value ?? '',
    flag: r.abnormal_flag ?? 'pending',
    reported_at: r.created_at ?? '',
    source_id: r.id,
  }));

  const previous_surgeries: PreviousSurgery[] = pastBookings.map((b) => ({
    procedure: b.surgery_type ?? b.procedure_type ?? 'Unknown procedure',
    date: b.operation_completed_at ?? b.booked_for_date ?? null,
    source_id: b.id,
  }));

  const requiredClearance = clearanceRows.filter((c) => c.is_required === 1);
  const requiredDone = requiredClearance.filter(
    (c) => c.status === 'done' || c.status === 'waived',
  ).length;
  const pre_ot_clearance = {
    items: clearanceRows.map((c) => ({
      check_type: c.check_type,
      status: c.status,
      is_required: c.is_required === 1,
      verified_by: c.verified_by,
      verified_at: c.verified_at,
    })),
    required_total: requiredClearance.length,
    required_done: requiredDone,
    readiness_percent:
      requiredClearance.length === 0
        ? 100
        : Math.round((requiredDone / requiredClearance.length) * 100),
  };

  const signals = buildSignals({
    patient,
    allergies,
    anticoagulants,
    chronic_conditions,
    abnormal_labs,
    previous_surgeries,
    pre_ot_clearance,
  });

  const risk = computeRiskScore({
    age: patient?.age ?? null,
    gender: patient?.gender ?? null,
    date_of_birth: patient?.date_of_birth ?? null,
    allergies,
    anticoagulants,
    chronic_conditions,
    abnormal_labs,
    previous_surgeries,
  });

  return {
    generated_at: new Date().toISOString(),
    verification_notice: OVERVIEW_VERIFICATION_NOTICE,
    patient: {
      patient_id: params.patient_id,
      patient_code: patient?.patient_code ?? null,
      name: patient?.name ?? null,
      age: patient?.age ?? null,
      gender: patient?.gender ?? null,
      blood_group: patient?.blood_group ?? null,
    },
    allergies,
    anticoagulants,
    chronic_conditions,
    abnormal_labs,
    previous_surgeries,
    pre_ot_clearance,
    last_vitals: lastVitals,
    signals,
    risk,
  };
}

async function loadPatient(
  db: D1Database,
  tenantId: string,
  patientId: number,
): Promise<PatientRow | null> {
  return await db
    .prepare(
      `SELECT id, patient_code, name, age, gender, blood_group, date_of_birth
       FROM patients
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
    )
    .bind(patientId, tenantId)
    .first<PatientRow>();
}

interface AllergyRow {
  id: number;
  allergen: string;
  allergy_type: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life_threatening' | null;
  reaction: string | null;
  verified_by: number | null;
  is_active: number;
}

async function loadAllergies(
  db: D1Database,
  tenantId: string,
  patientId: number,
): Promise<AllergyRow[]> {
  // patient_allergies.tenant_id is INTEGER. Severity ordering is
  // enforced in the SQL so the most clinically important signal
  // (life_threatening) is loaded first.
  const { results } = await db
    .prepare(
      `SELECT id, allergen, allergy_type, severity, reaction, verified_by, is_active
       FROM patient_allergies
       WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
         AND allergy_type = 'drug'
       ORDER BY
         CASE severity
           WHEN 'life_threatening' THEN 1
           WHEN 'severe' THEN 2
           WHEN 'moderate' THEN 3
           WHEN 'mild' THEN 4
           ELSE 5
         END
       LIMIT 25`,
    )
    .bind(tenantId, patientId)
    .all<AllergyRow>();
  return results ?? [];
}

async function loadActiveMedications(
  db: D1Database,
  tenantId: string,
  patientId: number,
): Promise<ActiveMedRow[]> {
  // patient_active_medications.tenant_id is TEXT (0048). Active =
  // status='active' AND is_active=1.
  const { results } = await db
    .prepare(
      `SELECT id, medication_name, generic_name, strength, dosage_form, is_active
       FROM patient_active_medications
       WHERE tenant_id = ? AND patient_id = ?
         AND is_active = 1
         AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .bind(tenantId, patientId)
    .all<ActiveMedRow>();
  return results ?? [];
}

async function loadRecentPrescriptions(
  db: D1Database,
  tenantId: string,
  patientId: number,
): Promise<PrescriptionRow[]> {
  // prescriptions.tenant_id is TEXT; the medication names live in
  // prescription_items. Use a 90-day window for the chronic-script
  // fallback (matches the operational reality of repeat scripts).
  const { results } = await db
    .prepare(
      `SELECT pi.id              AS id,
              pi.medicine_name   AS medication_name,
              pr.status          AS status
       FROM prescription_items pi
       JOIN prescriptions pr ON pr.id = pi.prescription_id
       WHERE pr.patient_id = ? AND pr.tenant_id = ?
         AND date(pr.created_at) >= date('now', '-90 days')
         AND pr.status = 'final'
       ORDER BY pr.created_at DESC
       LIMIT 50`,
    )
    .bind(patientId, tenantId)
    .all<PrescriptionRow>();
  return (results ?? []).map((r) => ({
    id: r.id,
    medication_name: r.medication_name ?? '',
    generic_name: null,
    status: r.status,
  }));
}

interface LabResultRow {
  id: number;
  result_text: string | null;
  result_value: string | null;
  abnormal_flag: string | null;
  result_status: string | null;
  created_at: string | null;
  test_name: string | null;
  test_code: string | null;
}

interface DiagnosisRow {
  id: number;
  icd10_code: string | null;
  icd10_description: string | null;
  diagnosis_type: string | null;
  is_active: number | null;
}

interface PastBookingRow {
  id: number;
  surgery_type: string | null;
  procedure_type: string | null;
  booked_for_date: string | null;
  operation_completed_at: string | null;
  operation_status: string | null;
}

async function loadAbnormalLabs(
  db: D1Database,
  tenantId: string,
  patientId: number,
): Promise<LabResultRow[]> {
  // lab_orders.tenant_id is INTEGER (0001); lab_reports/lab_results
  // .tenant_id is TEXT (0143). SQLite loose types handle the
  // coercion. Walk the JOIN chain: lab_results -> lab_reports
  // -> lab_orders -> patient. Capped at 25 rows.
  const { results } = await db
    .prepare(
      `SELECT
         lr.id,
         lr.result_text,
         lr.result_value,
         lr.abnormal_flag,
         lr.result_status,
         lr.created_at,
         c.name  AS test_name,
         c.code  AS test_code
       FROM lab_results lr
       JOIN lab_reports r ON r.id = lr.lab_report_id
       JOIN lab_orders o  ON o.id = r.lab_order_id
       LEFT JOIN lab_test_catalog c ON c.id = lr.lab_test_id
       WHERE o.patient_id = ?
         AND o.tenant_id = ?
         AND lr.tenant_id = ?
         AND lr.abnormal_flag IN ('high','low','critical','abnormal')
         AND date(lr.created_at) >= date('now', '-90 days')
       ORDER BY lr.created_at DESC
       LIMIT 25`,
    )
    .bind(patientId, tenantId, tenantId)
    .all<LabResultRow>();
  return results ?? [];
}

async function loadDiagnoses(
  db: D1Database,
  tenantId: string,
  patientId: number,
  table: 'ClinicalDiagnosis' | 'final_diagnosis',
): Promise<DiagnosisRow[]> {
  if (table === 'ClinicalDiagnosis') {
    // Direct columns; PascalCase.
    const { results } = await db
      .prepare(
        `SELECT DiagnosisId         AS id,
                ICD10Code           AS icd10_code,
                ICD10Description    AS icd10_description,
                DiagnosisType       AS diagnosis_type,
                IsActive            AS is_active
         FROM ClinicalDiagnosis
         WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
         ORDER BY CreatedOn DESC
         LIMIT 30`,
      )
      .bind(tenantId, patientId)
      .all<DiagnosisRow>();
    return results ?? [];
  }
  // final_diagnosis stores icd10_id only; JOIN icd10_codes.
  const { results } = await db
    .prepare(
      `SELECT fd.id                AS id,
              ic.code             AS icd10_code,
              ic.description      AS icd10_description,
              'secondary'         AS diagnosis_type,
              fd.is_active         AS is_active
       FROM final_diagnosis fd
       LEFT JOIN icd10_codes ic ON ic.id = fd.icd10_id
       WHERE fd.tenant_id = ? AND fd.patient_id = ? AND fd.is_active = 1
       ORDER BY fd.created_at DESC
       LIMIT 30`,
    )
    .bind(tenantId, patientId)
    .all<DiagnosisRow>();
  return results ?? [];
}

async function loadPastOtBookings(
  db: D1Database,
  tenantId: string,
  patientId: number,
): Promise<PastBookingRow[]> {
  // "is_active = 0" means deleted; completed = operation_status in
  // the legacy/completed/case_completed/sign_out set.
  const { results } = await db
    .prepare(
      `SELECT id, surgery_type, procedure_type, booked_for_date,
              operation_completed_at, operation_status
       FROM ot_bookings
       WHERE tenant_id = ? AND patient_id = ?
         AND operation_status IN ('completed','case_completed','sign_out')
       ORDER BY COALESCE(operation_completed_at, booked_for_date) DESC
       LIMIT 10`,
    )
    .bind(tenantId, patientId)
    .all<PastBookingRow>();
  return results ?? [];
}

function dedupeDiagnoses(rows: DiagnosisRow[]): DiagnosisRow[] {
  const seen = new Set<string>();
  const out: DiagnosisRow[] = [];
  for (const r of rows) {
    const key = `${r.icd10_code ?? ''}|${(r.icd10_description ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

interface ClearanceRow {
  id: number;
  check_type: string;
  is_required: number;
  status: 'pending' | 'done' | 'rejected' | 'waived' | 'not_required';
  verified_by: number | null;
  verified_at: string | null;
}

interface VitalsRow {
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  pulse: number | null;
  spo2: number | null;
  temperature: number | null;
  taken_at: string | null;
}

async function loadClearance(
  db: D1Database,
  tenantId: string,
  caseId: number,
): Promise<ClearanceRow[]> {
  // ot_clearance_checks.tenant_id is INTEGER (0293).
  const { results } = await db
    .prepare(
      `SELECT id, check_type, is_required, status, verified_by, verified_at
       FROM ot_clearance_checks
       WHERE tenant_id = ? AND booking_id = ?
       ORDER BY id`,
    )
    .bind(tenantId, caseId)
    .all<ClearanceRow>();
  return results ?? [];
}

async function loadLastVitals(
  db: D1Database,
  tenantId: string,
  patientId: number,
  visitId: number | null,
): Promise<ProgrammaticOverview['last_vitals']> {
  // clinical_vitals stores systolic/diastolic as separate INTEGERs;
  // compose them into the standard "120/80" form for the response.
  const sql = visitId != null
    ? `SELECT blood_pressure_systolic, blood_pressure_diastolic, pulse,
              spo2, temperature, taken_at
       FROM clinical_vitals
       WHERE tenant_id = ? AND patient_id = ? AND visit_id = ?
         AND is_active = 1
       ORDER BY taken_at DESC
       LIMIT 1`
    : `SELECT blood_pressure_systolic, blood_pressure_diastolic, pulse,
              spo2, temperature, taken_at
       FROM clinical_vitals
       WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
       ORDER BY taken_at DESC
       LIMIT 1`;
  const row = visitId != null
    ? await db.prepare(sql).bind(tenantId, patientId, visitId).first<VitalsRow>()
    : await db.prepare(sql).bind(tenantId, patientId).first<VitalsRow>();
  if (!row) return null;
  const bp =
    row.blood_pressure_systolic != null && row.blood_pressure_diastolic != null
      ? `${row.blood_pressure_systolic}/${row.blood_pressure_diastolic}`
      : null;
  return {
    bp,
    pulse: row.pulse,
    spo2: row.spo2,
    temperature: row.temperature,
    recorded_at: row.taken_at,
  };
}

// ─── Signal builder (UI badges) ─────────────────────────────────────────────

interface SignalInput {
  patient: PatientRow | null;
  allergies: AllergyAlert[];
  anticoagulants: AnticoagulantAlert[];
  chronic_conditions: ChronicConditionSignal[];
  abnormal_labs: AbnormalLab[];
  previous_surgeries: PreviousSurgery[];
  pre_ot_clearance: ProgrammaticOverview['pre_ot_clearance'];
}

/**
 * Pure function: derive UI badge signals from the clinical inputs.
 * Each signal carries its source for traceability.
 */
export function buildSignals(input: SignalInput): ProgrammaticOverview['signals'] {
  const signals: ProgrammaticOverview['signals'] = [];

  if (input.patient) {
    signals.push({
      key: 'blood_group',
      label: 'Blood group',
      value: input.patient.blood_group ?? 'Unknown',
      source: 'patient_profile',
      severity: input.patient.blood_group ? 'info' : 'warn',
    });
    if (input.patient.age != null) {
      signals.push({
        key: 'age',
        label: 'Age',
        value: `${input.patient.age} (${input.patient.gender ?? 'unknown'})`,
        source: 'patient_profile',
        severity: 'info',
      });
    }
  }

  for (const a of input.allergies) {
    signals.push({
      key: `allergy:${a.source_id}`,
      label: 'Drug allergy',
      value: `${a.allergen}${a.reaction ? ' — ' + a.reaction : ''}`,
      source: 'patient_allergies',
      severity:
        a.severity === 'life_threatening' ? 'critical' :
        a.severity === 'severe' ? 'alert' :
        a.severity === 'moderate' ? 'warn' :
        'info',
    });
  }

  for (const a of input.anticoagulants) {
    signals.push({
      key: `anticoag:${a.source_id}`,
      label: 'Anticoagulant / antiplatelet',
      value: a.drug,
      source: 'patient_active_medications',
      severity: 'alert',
    });
  }

  for (const c of input.chronic_conditions) {
    if (!c.code) continue;
    const code = c.code; // narrow for closure
    const matched = HIGH_RISK_ICD10_PREFIXES.find((p) =>
      code.toUpperCase().startsWith(p.prefix),
    );
    if (matched) {
      signals.push({
        key: `chronic:${c.source_id}`,
        label: 'Chronic condition',
        value: matched.label,
        source: 'ClinicalDiagnosis',
        severity: matched.weight >= 10 ? 'alert' : 'warn',
      });
    }
  }

  for (const l of input.abnormal_labs.slice(0, 5)) {
    if (l.flag === 'high' || l.flag === 'low' || l.flag === 'critical' || l.flag === 'abnormal') {
      signals.push({
        key: `lab:${l.source_id}`,
        label: `Abnormal ${l.test}`,
        value: `${l.result} (${l.flag})`,
        source: 'lab_results',
        observed_at: l.reported_at,
        severity: l.flag === 'critical' ? 'critical' : 'warn',
      });
    }
  }

  if (input.pre_ot_clearance.required_total > 0) {
    const pct = input.pre_ot_clearance.readiness_percent;
    signals.push({
      key: 'pre_ot_readiness',
      label: 'Pre-OT readiness',
      value: `${pct}% (${input.pre_ot_clearance.required_done}/${input.pre_ot_clearance.required_total})`,
      source: 'ot_clearance_checks',
      severity: pct === 100 ? 'info' : pct >= 60 ? 'warn' : 'alert',
    });
  }

  return signals;
}

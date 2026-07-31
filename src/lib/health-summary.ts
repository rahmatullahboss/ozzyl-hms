/**
 * Portable Health Summary Builder
 * Extracts a shareable subset of patient clinical data for cross-hospital viewing.
 * Reuses query patterns from the patient chart endpoint (patients.ts GET /:id/chart).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../db';

export interface PortableHealthSummary {
  provenance?: {
    generated_at: string;
    model: 'normalized';
  };
  uhid: string | null;
  patient: {
    name: string;
    age: number | null;
    gender: string | null;
    blood_group: string | null;
    date_of_birth: string | null;
  };
  hospital: {
    name: string;
    generated_at: string;
    consent_mode: 'view_summary' | 'view_full' | 'emergency_access' | null;
  };
  allergies: Array<{
    allergen: string;
    allergy_type: string | null;
    severity: string | null;
    reaction: string | null;
    provenance: {
      source: string;
      verified: boolean;
      review_status: 'pending_review' | 'verified' | 'rejected';
      recorded_at: string | null;
      recorded_by_user_id: number | null;
      reviewed_at: string | null;
      reviewed_by_user_id: number | null;
      review_notes: string | null;
      verified_at: string | null;
      verified_by_user_id: number | null;
    };
  }>;
  active_problems: Array<{
    description: string;
    icd10_code: string | null;
    severity: string | null;
    status: string;
    onset_date: string | null;
  }>;
  current_medications: Array<{
    medication_name: string;
    generic_name: string | null;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
    instructions: string | null;
    status: string;
    provenance: {
      source: string;
      verified: boolean;
      review_status: 'pending_review' | 'verified' | 'rejected';
      recorded_at: string | null;
      recorded_by_user_id: number | null;
      reviewed_at: string | null;
      reviewed_by_user_id: number | null;
      review_notes: string | null;
      verified_at: string | null;
      verified_by_user_id: number | null;
    };
  }>;
  recent_diagnoses: Array<{
    icd10_code: string | null;
    icd11_code: string | null;
    description: string | null;
    diagnosis_type: string | null;
    created_at: string | null;
    provenance: {
      source: string;
      verified: boolean;
      review_status: 'pending_review' | 'verified' | 'rejected';
      recorded_at: string | null;
      recorded_by_user_id: number | null;
      reviewed_at: string | null;
      reviewed_by_user_id: number | null;
      review_notes: string | null;
      verified_at: string | null;
      verified_by_user_id: number | null;
    };
  }>;
  last_vitals: {
    recorded_at: string | null;
    temperature: number | null;
    pulse: number | null;
    systolic: number | null;
    diastolic: number | null;
    respiratory_rate: number | null;
    spo2: number | null;
    weight: number | null;
    height: number | null;
    bmi: number | null;
    blood_sugar: number | null;
    provenance: {
      source: string;
      verified: boolean;
      review_status: 'pending_review' | 'verified' | 'rejected';
      recorded_at: string | null;
      recorded_by_user_id: number | null;
      reviewed_at: string | null;
      reviewed_by_user_id: number | null;
      review_notes: string | null;
      verified_at: string | null;
      verified_by_user_id: number | null;
    };
  } | null;
  vaccinations: Array<{
    vaccine_name: string;
    vaccine_code: string | null;
    dose_number: number;
    total_doses: number | null;
    administered_date: string;
    status: string;
    next_dose_date: string | null;
  }>;
  recent_lab_results: Array<{
    test_name: string | null;
    result: string | null;
    abnormal_flag: string | null;
    unit: string | null;
    normal_range: string | null;
    completed_at: string | null;
    provenance: {
      source: string;
      verified: boolean;
      review_status: 'pending_review' | 'verified' | 'rejected';
      recorded_at: string | null;
      recorded_by_user_id: number | null;
      reviewed_at: string | null;
      reviewed_by_user_id: number | null;
      review_notes: string | null;
      verified_at: string | null;
      verified_by_user_id: number | null;
    };
  }>;
  last_discharge: {
    final_diagnosis: string | null;
    treatment_summary: string | null;
    follow_up_instructions: string | null;
    updated_at: string | null;
  } | null;
}

function computeAge(patient: Record<string, unknown>): number | null {
  if (typeof patient.age === 'number' && patient.age > 0) return patient.age;
  if (!patient.date_of_birth) return null;
  const dob = new Date(String(patient.date_of_birth));
  if (Number.isNaN(dob.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)));
}

function asNullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function asNullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function normalizeProvenance(input: {
  source?: unknown;
  recordedAt?: unknown;
  recordedByUserId?: unknown;
  reviewStatus?: unknown;
  reviewedAt?: unknown;
  reviewedByUserId?: unknown;
  reviewNotes?: unknown;
  verifiedAt?: unknown;
  verifiedByUserId?: unknown;
  defaultSource: string;
  defaultVerified?: boolean;
}): {
  source: string;
  verified: boolean;
  review_status: 'pending_review' | 'verified' | 'rejected';
  recorded_at: string | null;
  recorded_by_user_id: number | null;
  reviewed_at: string | null;
  reviewed_by_user_id: number | null;
  review_notes: string | null;
  verified_at: string | null;
  verified_by_user_id: number | null;
} {
  const source = asNullableString(input.source) ?? input.defaultSource;
  const recordedAt = asNullableString(input.recordedAt);
  const recordedByUserId = asNullableNumber(input.recordedByUserId);
  const reviewStatus = asNullableString(input.reviewStatus) as 'pending_review' | 'verified' | 'rejected' | null;
  const reviewedAt = asNullableString(input.reviewedAt);
  const reviewedByUserId = asNullableNumber(input.reviewedByUserId);
  const reviewNotes = asNullableString(input.reviewNotes);
  const verifiedAt = asNullableString(input.verifiedAt);
  const verifiedByUserId = asNullableNumber(input.verifiedByUserId);
  const normalizedReviewStatus = reviewStatus
    ?? ((verifiedByUserId != null || verifiedAt != null || input.defaultVerified || (source !== 'patient_reported' && source !== 'patient'))
      ? 'verified'
      : 'pending_review');
  const verified = Boolean(
    normalizedReviewStatus === 'verified' ||
    verifiedByUserId != null ||
    verifiedAt != null
  );

  return {
    source,
    verified,
    review_status: normalizedReviewStatus,
    recorded_at: recordedAt,
    recorded_by_user_id: recordedByUserId,
    reviewed_at: reviewedAt,
    reviewed_by_user_id: reviewedByUserId,
    review_notes: reviewNotes,
    verified_at: verifiedAt,
    verified_by_user_id: verifiedByUserId,
  };
}

export async function buildPortableHealthSummary(
  DB: D1Database,
  tenantId: string | number,
  patientId: number,
  includeSensitive: boolean = false,
): Promise<PortableHealthSummary | null> {
  const db = getDb(DB);

  // Fetch patient + hospital name
  const [patientRow, hospitalRow] = await Promise.all([
    db.$client.prepare(`
      SELECT name, age, gender, blood_group, date_of_birth
      FROM patients WHERE id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).first<Record<string, unknown>>(),
    db.$client.prepare('SELECT name FROM tenants WHERE id = ?').bind(tenantId).first<{ name: string }>(),
  ]);

  if (!patientRow) return null;

  // Fetch UHID
  const uhidRow = await db.$client.prepare(
    'SELECT uhid FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ uhid: string | null }>();

  // Run all clinical queries in parallel
  const [
    allergiesResult,
    problemsResult,
    medicationsResult,
    diagnosesResult,
    vitalsResult,
    vaccinationsResult,
    labResultsResult,
    dischargeResult,
  ] = await Promise.all([
    db.$client.prepare(`
      SELECT allergen, allergy_type, severity, reaction, source, created_at, created_by,
             review_status, reviewed_at, reviewed_by, review_notes, verified_at, verified_by
      FROM patient_allergies
      WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      ${!includeSensitive ? "AND id NOT IN (SELECT resource_id FROM health_record_sensitivity_labels WHERE resource_type = 'allergy' AND tenant_id = ? AND patient_id = ?)" : ""}
      ORDER BY CASE severity WHEN 'life_threatening' THEN 1 WHEN 'severe' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END
    `).bind(tenantId, patientId, ...(!includeSensitive ? [tenantId, patientId] : [])).all<Record<string, unknown>>(),

    db.$client.prepare(`
      SELECT Description as description, ICD10Code as icd10_code, Severity as severity,
             Status as status, BegDate as onset_date
      FROM CLN_ProblemList
      WHERE tenant_id = ? AND PatientId = ? AND Status = 'active'
      ${!includeSensitive ? "AND Id NOT IN (SELECT resource_id FROM health_record_sensitivity_labels WHERE resource_type = 'problem' AND tenant_id = ? AND patient_id = ?)" : ""}
      ORDER BY COALESCE(ModifiedAt, CreatedAt) DESC
      LIMIT 15
    `).bind(tenantId, patientId, ...(!includeSensitive ? [tenantId, patientId] : [])).all<Record<string, unknown>>(),

    db.$client.prepare(`
      SELECT medication_name, generic_name, dosage, frequency, duration, instructions, status,
             source, created_at, created_by, prescribed_by, review_status, reviewed_at, reviewed_by, review_notes
      FROM patient_active_medications
      WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND status IN ('active', 'on_hold')
      ${!includeSensitive ? "AND id NOT IN (SELECT resource_id FROM health_record_sensitivity_labels WHERE resource_type = 'medication' AND tenant_id = ? AND patient_id = ?)" : ""}
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(start_date, created_at) DESC
      LIMIT 15
    `).bind(tenantId, patientId, ...(!includeSensitive ? [tenantId, patientId] : [])).all<Record<string, unknown>>(),

    db.$client.prepare(`
      SELECT ICD10Code as icd10_code, icd11_code, ICD10Description as icd10_description, icd11_title,
             source,
             DiagnosisType as diagnosis_type, CreatedOn as created_at, CreatedBy as created_by,
             review_status, reviewed_at, reviewed_by, review_notes
      FROM ClinicalDiagnosis
      WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
      ${!includeSensitive ? "AND Id NOT IN (SELECT resource_id FROM health_record_sensitivity_labels WHERE resource_type = 'diagnosis' AND tenant_id = ? AND patient_id = ?)" : ""}
      ORDER BY CreatedOn DESC
      LIMIT 10
    `).bind(tenantId, patientId, ...(!includeSensitive ? [tenantId, patientId] : [])).all<Record<string, unknown>>(),

    db.$client.prepare(`
      SELECT taken_at as recorded_at, temperature, pulse,
             blood_pressure_systolic as systolic, blood_pressure_diastolic as diastolic,
             respiratory_rate, spo2, weight, height, bmi, blood_sugar, taken_by, created_at, source
      FROM clinical_vitals
      WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      ORDER BY taken_at DESC
      LIMIT 1
    `).bind(tenantId, patientId).all<Record<string, unknown>>(),

    db.$client.prepare(`
      SELECT vm.name AS vaccine_name, vm.code AS vaccine_code, vm.number_of_doses AS total_doses,
             pv.dose_number, pv.administered_date, pv.status, pv.next_dose_date
      FROM patient_vaccinations pv
      JOIN vaccine_master vm ON pv.vaccine_id = vm.id
      WHERE pv.tenant_id = ? AND pv.patient_id = ? AND pv.status != 'cancelled'
      ORDER BY pv.administered_date DESC
      LIMIT 20
    `).bind(tenantId, patientId).all<Record<string, unknown>>(),

    db.$client.prepare(`
      SELECT ltc.name as test_name, loi.result, loi.abnormal_flag, ltc.unit, ltc.normal_range, loi.completed_at,
             loi.source, lo.ordered_by, loi.verified_by, loi.verified_at, loi.notes
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      LEFT JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      WHERE lo.tenant_id = ? AND lo.patient_id = ? AND loi.status = 'completed'
      ${!includeSensitive ? "AND loi.id NOT IN (SELECT resource_id FROM health_record_sensitivity_labels WHERE resource_type = 'lab_test' AND tenant_id = ? AND patient_id = ?)" : ""}
      ORDER BY loi.completed_at DESC
      LIMIT 10
    `).bind(tenantId, patientId, ...(!includeSensitive ? [tenantId, patientId] : [])).all<Record<string, unknown>>(),

    db.$client.prepare(`
      SELECT final_diagnosis, treatment_summary, follow_up_instructions, updated_at
      FROM discharge_summaries
      WHERE tenant_id = ? AND patient_id = ?
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT 1
    `).bind(tenantId, patientId).all<Record<string, unknown>>(),
  ]);

  const vitals = vitalsResult.results ?? [];
  const discharges = dischargeResult.results ?? [];

  return {
    provenance: {
      generated_at: new Date().toISOString(),
      model: 'normalized',
    },
    uhid: uhidRow?.uhid ?? null,
    patient: {
      name: String(patientRow.name ?? ''),
      age: computeAge(patientRow),
      gender: patientRow.gender ? String(patientRow.gender) : null,
      blood_group: patientRow.blood_group ? String(patientRow.blood_group) : null,
      date_of_birth: patientRow.date_of_birth ? String(patientRow.date_of_birth) : null,
    },
    hospital: {
      name: hospitalRow?.name ?? 'Unknown Hospital',
      generated_at: new Date().toISOString(),
      consent_mode: includeSensitive ? 'view_full' : 'view_summary',
    },
    allergies: (allergiesResult.results ?? []).map((a) => ({
      allergen: String(a.allergen ?? ''),
      allergy_type: a.allergy_type ? String(a.allergy_type) : null,
      severity: a.severity ? String(a.severity) : null,
      reaction: a.reaction ? String(a.reaction) : null,
      provenance: normalizeProvenance({
        defaultSource: 'hospital',
        source: a.source,
        recordedAt: a.created_at,
        recordedByUserId: a.created_by,
        reviewStatus: a.review_status,
        reviewedAt: a.reviewed_at,
        reviewedByUserId: a.reviewed_by,
        reviewNotes: a.review_notes,
        verifiedAt: a.verified_at,
        verifiedByUserId: a.verified_by,
      }),
    })),
    active_problems: (problemsResult.results ?? []).map((p) => ({
      description: String(p.description ?? ''),
      icd10_code: p.icd10_code ? String(p.icd10_code) : null,
      severity: p.severity ? String(p.severity) : null,
      status: String(p.status ?? 'active'),
      onset_date: p.onset_date ? String(p.onset_date) : null,
    })),
    current_medications: (medicationsResult.results ?? []).map((m) => ({
      medication_name: String(m.medication_name ?? ''),
      generic_name: m.generic_name ? String(m.generic_name) : null,
      dosage: m.dosage ? String(m.dosage) : null,
      frequency: m.frequency ? String(m.frequency) : null,
      duration: m.duration ? String(m.duration) : null,
      instructions: m.instructions ? String(m.instructions) : null,
      status: String(m.status ?? 'active'),
      provenance: normalizeProvenance({
        defaultSource: 'hospital',
        source: m.source,
        recordedAt: m.created_at,
        recordedByUserId: m.created_by,
        reviewStatus: m.review_status,
        reviewedAt: m.reviewed_at,
        reviewedByUserId: m.reviewed_by ?? m.prescribed_by,
        reviewNotes: m.review_notes,
        verifiedAt: m.review_status === 'verified' ? (m.reviewed_at ?? m.created_at) : null,
        verifiedByUserId: m.review_status === 'verified' ? (m.reviewed_by ?? m.prescribed_by) : null,
      }),
    })),
    recent_diagnoses: (diagnosesResult.results ?? []).map((d) => ({
      icd10_code: d.icd10_code ? String(d.icd10_code) : null,
      icd11_code: d.icd11_code ? String(d.icd11_code) : null,
      description: d.icd11_title ? String(d.icd11_title) : (d.icd10_description ? String(d.icd10_description) : null),
      diagnosis_type: d.diagnosis_type ? String(d.diagnosis_type) : null,
      created_at: d.created_at ? String(d.created_at) : null,
      provenance: normalizeProvenance({
        defaultSource: 'hospital',
        source: d.source,
        recordedAt: d.created_at,
        recordedByUserId: d.created_by,
        reviewStatus: d.review_status,
        reviewedAt: d.reviewed_at,
        reviewedByUserId: d.reviewed_by,
        reviewNotes: d.review_notes,
        verifiedAt: d.review_status === 'verified' ? (d.reviewed_at ?? d.created_at) : null,
        verifiedByUserId: d.review_status === 'verified' ? (d.reviewed_by ?? d.created_by) : null,
        defaultVerified: d.review_status ? false : true,
      }),
    })),
    last_vitals: vitals[0] ? {
      recorded_at: vitals[0].recorded_at ? String(vitals[0].recorded_at) : null,
      temperature: vitals[0].temperature != null ? Number(vitals[0].temperature) : null,
      pulse: vitals[0].pulse != null ? Number(vitals[0].pulse) : null,
      systolic: vitals[0].systolic != null ? Number(vitals[0].systolic) : null,
      diastolic: vitals[0].diastolic != null ? Number(vitals[0].diastolic) : null,
      respiratory_rate: vitals[0].respiratory_rate != null ? Number(vitals[0].respiratory_rate) : null,
      spo2: vitals[0].spo2 != null ? Number(vitals[0].spo2) : null,
      weight: vitals[0].weight != null ? Number(vitals[0].weight) : null,
      height: vitals[0].height != null ? Number(vitals[0].height) : null,
      bmi: vitals[0].bmi != null ? Number(vitals[0].bmi) : null,
      blood_sugar: vitals[0].blood_sugar != null ? Number(vitals[0].blood_sugar) : null,
      provenance: normalizeProvenance({
        defaultSource: 'hospital',
        source: vitals[0].source,
        recordedAt: vitals[0].recorded_at ?? vitals[0].created_at,
        recordedByUserId: vitals[0].taken_by,
        reviewStatus: 'verified',
        reviewedAt: vitals[0].recorded_at ?? vitals[0].created_at,
        reviewedByUserId: vitals[0].taken_by,
        reviewNotes: null,
        verifiedAt: vitals[0].recorded_at ?? vitals[0].created_at,
        verifiedByUserId: vitals[0].taken_by,
        defaultVerified: true,
      }),
    } : null,
    vaccinations: (vaccinationsResult.results ?? []).map((v) => ({
      vaccine_name: String(v.vaccine_name ?? ''),
      vaccine_code: v.vaccine_code ? String(v.vaccine_code) : null,
      dose_number: Number(v.dose_number ?? 1),
      total_doses: v.total_doses != null ? Number(v.total_doses) : null,
      administered_date: String(v.administered_date ?? ''),
      status: String(v.status ?? 'completed'),
      next_dose_date: v.next_dose_date ? String(v.next_dose_date) : null,
    })),
    recent_lab_results: (labResultsResult.results ?? []).map((l) => ({
      test_name: l.test_name ? String(l.test_name) : null,
      result: l.result ? String(l.result) : null,
      abnormal_flag: l.abnormal_flag ? String(l.abnormal_flag) : null,
      unit: l.unit ? String(l.unit) : null,
      normal_range: l.normal_range ? String(l.normal_range) : null,
      completed_at: l.completed_at ? String(l.completed_at) : null,
      provenance: normalizeProvenance({
        defaultSource: 'hospital',
        source: l.source,
        recordedAt: l.completed_at,
        recordedByUserId: l.ordered_by,
        reviewStatus: l.verified_at ? 'verified' : 'pending_review',
        reviewedAt: l.verified_at,
        reviewedByUserId: l.verified_by,
        reviewNotes: l.notes,
        verifiedAt: l.verified_at,
        verifiedByUserId: l.verified_by,
        defaultVerified: false,
      }),
    })),
    last_discharge: discharges[0] ? {
      final_diagnosis: discharges[0].final_diagnosis ? String(discharges[0].final_diagnosis) : null,
      treatment_summary: discharges[0].treatment_summary ? String(discharges[0].treatment_summary) : null,
      follow_up_instructions: discharges[0].follow_up_instructions ? String(discharges[0].follow_up_instructions) : null,
      updated_at: discharges[0].updated_at ? String(discharges[0].updated_at) : null,
    } : null,
  };
}

import { HTTPException } from 'hono/http-exception';
import { getDb } from '../db';
import { evaluateMedicationSafety, normalizeMedicationName } from './drug-safety';

interface SafetyOverrideOptions {
  safetyCheckId?: number | null;
  safetyOverrideReason?: string | null;
}

function normalizedCandidateNames(items: Array<{ medication_name?: string | null; medicine_name?: string | null }>) {
  return Array.from(new Set(
    items
      .map((item) => normalizeMedicationName(item.medication_name ?? item.medicine_name ?? ''))
      .filter(Boolean),
  ));
}

function safetyCheckMedicationNames(row: { medication_name?: string | null; warnings_json?: string | null }) {
  const fromJson: string[] = [];
  if (row.warnings_json) {
    try {
      const parsed = JSON.parse(row.warnings_json) as { medications?: Array<{ medication_name?: string | null }> };
      for (const item of parsed.medications ?? []) {
        if (item.medication_name) fromJson.push(item.medication_name);
      }
    } catch {
      // Fallback below covers older or malformed log payloads.
    }
  }

  const fromMedicationName = (row.medication_name ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return normalizedCandidateNames([
    ...fromJson.map((medication_name) => ({ medication_name })),
    ...fromMedicationName.map((medication_name) => ({ medication_name })),
  ]);
}


function parseDoseMg(dosage?: string | null): number | undefined {
  const normalized = String(dosage ?? '').trim().toLowerCase().replace(',', '.');
  if (!normalized) return undefined;

  const microgram = normalized.match(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug)\b/);
  if (microgram) {
    const value = Number.parseFloat(microgram[1]);
    return Number.isFinite(value) && value > 0 ? value / 1000 : undefined;
  }

  const milligram = normalized.match(/(\d+(?:\.\d+)?)\s*mg\b/);
  if (milligram) {
    const value = Number.parseFloat(milligram[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  const gram = normalized.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gram) {
    const value = Number.parseFloat(gram[1]);
    return Number.isFinite(value) && value > 0 ? value * 1000 : undefined;
  }

  return undefined;
}

function parseFrequencyPerDay(frequency?: string | null): number | undefined {
  const normalized = String(frequency ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'sos' || normalized === 'stat') return undefined;

  if (normalized.includes('+')) {
    const total = normalized.split('+').reduce((sum, part) => {
      const value = part.includes('½') ? 0.5 : Number.parseFloat(part);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return total > 0 ? Math.max(1, Math.round(total)) : undefined;
  }

  if (/\b(od|qd|once|daily)\b/.test(normalized)) return 1;
  if (/\b(bd|bid|twice)\b/.test(normalized)) return 2;
  if (/\b(tds|tid|three)\b/.test(normalized)) return 3;
  if (/\b(qid|qid|four)\b/.test(normalized)) return 4;

  const times = normalized.match(/(\d+)\s*(x|times)\b/);
  if (times) {
    const value = Number.parseInt(times[1], 10);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  return undefined;
}

async function loadPatientSafetyContext(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
) {
  const patient = await db.$client.prepare(`
    SELECT age, gender, date_of_birth
    FROM patients
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(tenantId, patientId).first<{ age: number | null; gender: string | null; date_of_birth: string | null }>();

  let ageYears = typeof patient?.age === 'number' ? patient.age : undefined;
  if (!ageYears && patient?.date_of_birth) {
    const dob = new Date(patient.date_of_birth);
    if (!Number.isNaN(dob.getTime())) {
      const today = new Date();
      ageYears = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) ageYears -= 1;
    }
  }

  let diagnoses: string[] = [];
  try {
    const { results } = await db.$client.prepare(`
      SELECT problem_name, status
      FROM patient_problems
      WHERE tenant_id = ? AND patient_id = ? AND COALESCE(status, 'active') = 'active'
    `).bind(tenantId, patientId).all<{ problem_name: string | null; status: string | null }>();
    diagnoses = (results ?? []).map((row) => row.problem_name ?? '').filter(Boolean);
  } catch {
    diagnoses = [];
  }

  const normalizedGender = patient?.gender?.trim().toLowerCase();

  return {
    age_years: ageYears,
    sex: normalizedGender?.startsWith('m') ? 'M' as const : normalizedGender?.startsWith('f') ? 'F' as const : undefined,
    is_pregnant: diagnoses.some((value) => value.toLowerCase().includes('pregnan')) || undefined,
    diagnoses: diagnoses.length > 0 ? Array.from(new Set(diagnoses)) : undefined,
  };
}

async function hasValidSafetyOverride(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
  currentMedications: Array<{ medication_name: string }>,
  options?: SafetyOverrideOptions,
): Promise<boolean> {
  const safetyCheckId = Number(options?.safetyCheckId ?? 0);
  const overrideReason = options?.safetyOverrideReason?.trim();
  if (!safetyCheckId || !overrideReason) return false;

  const row = await db.$client.prepare(`
    SELECT id, medication_name, warnings_json, override_reason
    FROM prescription_safety_checks
    WHERE id = ?
      AND tenant_id = ?
      AND patient_id = ?
      AND has_warnings = 1
      AND action_taken = 'overridden'
      AND COALESCE(override_reason, '') <> ''
    LIMIT 1
  `).bind(safetyCheckId, tenantId, patientId).first<{
    id: number;
    medication_name: string | null;
    warnings_json: string | null;
    override_reason: string | null;
  }>();

  if (!row) return false;
  if ((row.override_reason ?? '').trim() !== overrideReason) return false;

  const currentNames = normalizedCandidateNames(currentMedications);
  const checkedNames = safetyCheckMedicationNames(row);
  if (currentNames.length === 0 || checkedNames.length === 0) return false;

  return currentNames.every((name) => checkedNames.includes(name));
}

export async function enforcePrescriptionDrugSafety(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
  items: Array<{ medicine_name?: string | null; dosage?: string | null; frequency?: string | null }>,
  options?: SafetyOverrideOptions,
) {
  const medications = items
    .map((item) => ({
      medication_name: (item.medicine_name ?? '').trim(),
      dose_mg: parseDoseMg(item.dosage),
      frequency_per_day: parseFrequencyPerDay(item.frequency),
    }))
    .filter((item) => item.medication_name);

  if (medications.length === 0) return;

  const [{ results: activeMedications }, { results: recentlyStoppedMedications }, { results: allergies }, { results: interactionPairs }, { results: formularyRows }] = await Promise.all([
    db.$client.prepare(`
      SELECT medication_name, generic_name, status
      FROM patient_active_medications
      WHERE tenant_id = ? AND patient_id = ? AND status = 'active' AND is_active = 1
    `).bind(tenantId, patientId).all<{ medication_name: string; generic_name: string | null; status: string | null }>(),
    db.$client.prepare(`
      SELECT medication_name, generic_name, status, COALESCE(end_date, updated_at, created_at) AS stop_date
      FROM patient_active_medications
      WHERE tenant_id = ? AND patient_id = ? AND status IN ('discontinued', 'completed', 'on_hold', 'suspended') AND is_active = 1
    `).bind(tenantId, patientId).all<{ medication_name: string; generic_name: string | null; status: string | null; stop_date: string | null }>(),
    db.$client.prepare(`
      SELECT allergen, severity
      FROM patient_allergies
      WHERE patient_id = ? AND tenant_id = ? AND allergy_type = 'drug' AND COALESCE(is_active, 1) = 1
    `).bind(patientId, tenantId).all<{ allergen: string; severity: string }>(),
    db.$client.prepare(`
      SELECT drug_a_name, drug_b_name, severity, description, recommendation
      FROM drug_interaction_pairs
      WHERE tenant_id = ? AND is_active = 1
    `).bind(tenantId).all<{
      drug_a_name: string;
      drug_b_name: string;
      severity: string;
      description: string;
      recommendation: string | null;
    }>(),
    db.$client.prepare(`
      SELECT name, generic_name, max_daily_dose_mg
      FROM formulary_items
      WHERE tenant_id = ? AND is_active = 1
    `).bind(tenantId).all<{ name: string; generic_name: string | null; max_daily_dose_mg: number | null }>(),
  ]);

  const formularyByDrug = Object.fromEntries((formularyRows ?? []).flatMap((row) => {
    const keys = [
      normalizeMedicationName(row.generic_name ?? ''),
      normalizeMedicationName(row.name ?? ''),
    ].filter(Boolean);
    return keys.map((key) => [key, row]);
  }));

  const patientContext = await loadPatientSafetyContext(db, tenantId, patientId);

  const safety = evaluateMedicationSafety({
    newItems: medications,
    activeMedications: activeMedications ?? [],
    recentlyStoppedMedications: recentlyStoppedMedications ?? [],
    allergies: allergies ?? [],
    interactionPairs: interactionPairs ?? [],
    formularyByDrug,
    patientContext,
  });

  if (safety.has_blocking) {
    const hasOverride = await hasValidSafetyOverride(db, tenantId, patientId, medications, options);
    if (hasOverride) return;

    throw new HTTPException(422, {
      message: `Prescription blocked: ${safety.findings.filter((item) => item.blocking).map((item) => `${item.title} - ${item.description}`).join('; ')}. Record a matching safety override before finalizing.`,
    });
  }
}

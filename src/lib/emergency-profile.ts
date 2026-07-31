import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../db';

export interface EmergencyHealthProfile {
  generated_at: string;
  hospital_name: string;
  patient: {
    name: string;
    age: number | null;
    gender: string | null;
    blood_group: string | null;
    uhid: string | null;
  };
  allergies: Array<{
    allergen: string;
    severity: string | null;
    reaction: string | null;
  }>;
  current_medications: Array<{
    medication_name: string;
    generic_name: string | null;
  }>;
  active_conditions: Array<{
    description: string;
  }>;
  emergency_contacts: Array<{
    name: string;
    relationship: string;
    phone: string;
  }>;
}

function asNullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

export async function buildEmergencyHealthProfile(
  DB: D1Database,
  tenantId: string | number,
  patientId: number,
): Promise<EmergencyHealthProfile | null> {
  const db = getDb(DB);

  // Replaced Promise.all() with db.$client.batch() for emergency profile fetching.
  // Why: Promise.all() sends 6 separate HTTP network requests to Cloudflare D1.
  const batchResults = await db.$client.batch([
    db.$client.prepare(`
      SELECT id, name, age, gender, blood_group, uhid, mobile, guardian_mobile, father_husband
      FROM patients
      WHERE id = ? AND tenant_id = ?
    `).bind(patientId, tenantId),
    db.$client.prepare('SELECT name FROM tenants WHERE id = ?').bind(tenantId),
    db.$client.prepare(`
      SELECT allergen, severity, reaction
      FROM patient_allergies
      WHERE tenant_id = ? AND patient_id = ? AND COALESCE(is_active, 1) = 1
        AND (
          LOWER(COALESCE(severity, '')) IN ('life_threatening', 'severe', 'moderate')
          OR LOWER(COALESCE(allergy_type, '')) = 'drug'
        )
      ORDER BY CASE severity
        WHEN 'life_threatening' THEN 0
        WHEN 'severe' THEN 1
        WHEN 'moderate' THEN 2
        ELSE 3
      END, allergen
      LIMIT 6
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT medication_name, generic_name
      FROM patient_active_medications
      WHERE tenant_id = ? AND patient_id = ? AND status IN ('active', 'on_hold') AND is_active = 1
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(updated_at, created_at) DESC
      LIMIT 8
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT Description as description, Status as status
      FROM CLN_ProblemList
      WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
      LIMIT 10
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT guardian_name, relationship, phone, is_primary
      FROM patient_guardians
      WHERE tenant_id = ? AND patient_id = ? AND phone IS NOT NULL
      ORDER BY is_primary DESC, id ASC
      LIMIT 3
    `).bind(tenantId, patientId),
  ]);

  const patientRow = batchResults[0]?.results?.[0] as Record<string, unknown> | undefined;
  const hospitalRow = batchResults[1]?.results?.[0] as { name: string } | undefined;
  const allergiesResult = { results: batchResults[2]?.results || [] } as { results: Record<string, unknown>[] };
  const medsResult = { results: batchResults[3]?.results || [] } as { results: Record<string, unknown>[] };
  const conditionsResult = { results: batchResults[4]?.results || [] } as { results: Record<string, unknown>[] };
  const guardiansResult = { results: batchResults[5]?.results || [] } as { results: Record<string, unknown>[] };

  if (!patientRow) return null;

  const contacts = (guardiansResult.results ?? [])
    .map((row) => ({
      name: String(row.guardian_name ?? 'Emergency Contact'),
      relationship: String(row.relationship ?? 'guardian'),
      phone: String(row.phone ?? '').trim(),
    }))
    .filter((row) => row.phone);

  const guardianMobile = asNullableString(patientRow.guardian_mobile);
  if (contacts.length === 0 && guardianMobile) {
    contacts.push({
      name: asNullableString(patientRow.father_husband) ?? 'Guardian',
      relationship: 'guardian',
      phone: guardianMobile,
    });
  }

  const patientMobile = asNullableString(patientRow.mobile);
  if (contacts.length === 0 && patientMobile) {
    contacts.push({
      name: asNullableString(patientRow.name) ?? 'Patient',
      relationship: 'self',
      phone: patientMobile,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    hospital_name: hospitalRow?.name ?? 'Hospital',
    patient: {
      name: String(patientRow.name ?? 'Unknown'),
      age: typeof patientRow.age === 'number' ? patientRow.age : (patientRow.age == null ? null : Number(patientRow.age)),
      gender: asNullableString(patientRow.gender),
      blood_group: asNullableString(patientRow.blood_group),
      uhid: asNullableString(patientRow.uhid),
    },
    allergies: (allergiesResult.results ?? []).map((row) => ({
      allergen: String(row.allergen ?? ''),
      severity: asNullableString(row.severity),
      reaction: asNullableString(row.reaction),
    })).filter((row) => row.allergen),
    current_medications: (medsResult.results ?? []).map((row) => ({
      medication_name: String(row.medication_name ?? ''),
      generic_name: asNullableString(row.generic_name),
    })).filter((row) => row.medication_name),
    active_conditions: (conditionsResult.results ?? [])
      .filter((row) => {
        const status = String(row.status ?? 'active').toLowerCase();
        return status === 'active' || status === 'ongoing';
      })
      .map((row) => ({
        description: String(row.description ?? ''),
      }))
      .filter((row) => row.description)
      .slice(0, 6),
    emergency_contacts: contacts,
  };
}

/**
 * Universal Health ID (UHID) Generator
 *
 * Format: OZ-XXXX-XXXX for new identities.
 * Existing legacy OZ-NNNNNN identifiers remain valid and are never rewritten.
 *
 * Properties:
 * - Simple, human-readable (easy to read over phone)
 * - Random and non-guessable
 * - No PII — cannot link back to NID
 * - No practical sequence ceiling
 */

import type { D1Database } from '@cloudflare/workers-types';
import { createReadableGlobalUid } from './global-identity';

/**
 * Generates or retrieves a UHID for a patient.
 *
 * If the patient already has a UHID, returns the existing one.
 * If the NID already has a UHID in the global identity table, reuses it.
 * Otherwise, generates a new one, assigns it, and returns it.
 *
 * @param db - D1 database instance
 * @param tenantId - Current tenant ID
 * @param patientId - Patient row ID
 * @param nationalId - Patient's National ID (10 or 17 digits)
 * @returns The UHID string (e.g., "OZ-8F4K-92Q7")
 */
export async function generateOrGetUHID(
  db: D1Database,
  tenantId: string | number,
  patientId: number,
  nationalId: string,
): Promise<string> {
  // 1. Check if patient already has a UHID
  const existing = await db.prepare(
    'SELECT uhid FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ uhid: string | null }>();

  if (existing?.uhid) {
    return existing.uhid;
  }

  // 2. Check if this NID already has a UHID in the global identity table
  const globalIdentity = await db.prepare(
    'SELECT uhid FROM global_patient_identity WHERE national_id = ?',
  ).bind(nationalId).first<{ uhid: string }>();

  if (globalIdentity?.uhid) {
    // Assign existing UHID to this patient (same person, different hospital)
    await db.prepare(
      'UPDATE patients SET uhid = ? WHERE id = ? AND tenant_id = ?',
    ).bind(globalIdentity.uhid, patientId, tenantId).run();

    return globalIdentity.uhid;
  }

  // 3. Generate new UHID — readable but not guessable.
  const uhid = createReadableGlobalUid();

  // 4. Store in global identity table
  await db.prepare(`
    INSERT OR IGNORE INTO global_patient_identity (national_id, uhid)
    VALUES (?, ?)
  `).bind(nationalId, uhid).run();

  // 5. Assign to patient
  await db.prepare(
    'UPDATE patients SET uhid = ? WHERE id = ? AND tenant_id = ?',
  ).bind(uhid, patientId, tenantId).run();

  return uhid;
}

/**
 * Looks up a UHID by National ID without generating one.
 * Returns null if the NID doesn't have a UHID yet.
 */
export async function lookupUHID(
  db: D1Database,
  nationalId: string,
): Promise<string | null> {
  const row = await db.prepare(
    'SELECT uhid FROM global_patient_identity WHERE national_id = ?',
  ).bind(nationalId).first<{ uhid: string }>();

  return row?.uhid ?? null;
}

/**
 * Updates the global patient identity with the latest demographics.
 * Called whenever a patient's NID-linked details change at any hospital.
 */
export async function updateGlobalIdentity(
  db: D1Database,
  nationalId: string,
  data: {
    name?: string;
    phone?: string;
    email?: string;
    blood_group?: string;
    date_of_birth?: string;
    gender?: string;
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.name) { sets.push('primary_name = ?'); values.push(data.name); }
  if (data.phone) { sets.push('primary_phone = ?'); values.push(data.phone); }
  if (data.email) { sets.push('primary_email = ?'); values.push(data.email); }
  if (data.blood_group) { sets.push('blood_group = ?'); values.push(data.blood_group); }
  if (data.date_of_birth) { sets.push('date_of_birth = ?'); values.push(data.date_of_birth); }
  if (data.gender) { sets.push('gender = ?'); values.push(data.gender); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(nationalId);

  await db.prepare(
    `UPDATE global_patient_identity SET ${sets.join(', ')} WHERE national_id = ?`,
  ).bind(...values).run();
}

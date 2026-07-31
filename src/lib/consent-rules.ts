/**
 * Consent Rules Engine — Treatment Purpose Access (TPO)
 *
 * Implements configurable default access rules per purpose.
 * TREATMENT: auto-grant view_summary when doctor has active visit.
 * PAYMENT: auto-grant summary for billing-relevant data only.
 * RESEARCH: always requires explicit patient consent.
 */

import type { D1Database } from '@cloudflare/workers-types';

export type ConsentPurpose = 'TREATMENT' | 'PAYMENT' | 'OPERATIONS' | 'RESEARCH' | 'MARKETING';

export interface PurposeDefault {
  purpose: ConsentPurpose;
  default_scope: 'view_summary' | 'view_full' | 'none';
  default_clinical_areas: string[] | null;
  auto_grant: boolean;
  requires_explicit_consent: boolean;
}

// ── Hardcoded fallback defaults (used when tenant has no custom config) ──

export const SYSTEM_DEFAULTS: Record<ConsentPurpose, PurposeDefault> = {
  TREATMENT: {
    purpose: 'TREATMENT',
    default_scope: 'view_summary',
    default_clinical_areas: null, // all areas
    auto_grant: true,
    requires_explicit_consent: false,
  },
  PAYMENT: {
    purpose: 'PAYMENT',
    default_scope: 'view_summary',
    default_clinical_areas: ['diagnoses', 'visits'],
    auto_grant: true,
    requires_explicit_consent: false,
  },
  OPERATIONS: {
    purpose: 'OPERATIONS',
    default_scope: 'none',
    default_clinical_areas: null,
    auto_grant: false,
    requires_explicit_consent: true,
  },
  RESEARCH: {
    purpose: 'RESEARCH',
    default_scope: 'none',
    default_clinical_areas: null,
    auto_grant: false,
    requires_explicit_consent: true,
  },
  MARKETING: {
    purpose: 'MARKETING',
    default_scope: 'none',
    default_clinical_areas: null,
    auto_grant: false,
    requires_explicit_consent: true,
  },
};

/**
 * Get the default access rule for a given purpose at a tenant.
 * Falls back to system defaults if tenant has no custom config.
 */
export async function getDefaultAccessForPurpose(
  purpose: ConsentPurpose,
  db?: D1Database,
  tenantId?: string | number,
): Promise<PurposeDefault> {
  const fallback = SYSTEM_DEFAULTS[purpose] ?? SYSTEM_DEFAULTS.TREATMENT;

  if (!db || !tenantId) return fallback;

  try {
    const row = await db.prepare(`
      SELECT purpose, default_scope, default_clinical_areas, auto_grant, requires_explicit_consent
      FROM consent_purpose_defaults
      WHERE tenant_id = ? AND purpose = ?
    `).bind(String(tenantId), purpose).first<{
      purpose: string;
      default_scope: string;
      default_clinical_areas: string | null;
      auto_grant: number;
      requires_explicit_consent: number;
    }>();

    if (!row) return fallback;

    let areas: string[] | null = null;
    if (row.default_clinical_areas) {
      try { areas = JSON.parse(row.default_clinical_areas); } catch { /* use null */ }
    }

    return {
      purpose: row.purpose as ConsentPurpose,
      default_scope: row.default_scope as 'view_summary' | 'view_full' | 'none',
      default_clinical_areas: areas,
      auto_grant: row.auto_grant === 1,
      requires_explicit_consent: row.requires_explicit_consent === 1,
    };
  } catch {
    return fallback;
  }
}

/**
 * Auto-grant a treatment-purpose consent when a doctor starts an active visit.
 * Creates a proper consent record (auditable) instead of silent in-memory grant.
 * Expires 24 hours after creation (refreshed on subsequent visits).
 */
export async function autoGrantTreatmentConsent(
  db: D1Database,
  nationalId: string,
  tenantId: string | number,
  patientId: number,
  doctorId: number,
): Promise<{ id: number; already_exists: boolean }> {
  const tid = String(tenantId);

  // Check if an active auto-granted TREATMENT consent already exists
  const existing = await db.prepare(`
    SELECT id FROM health_record_consents
    WHERE national_id = ? AND granting_tenant_id = ? AND granting_patient_id = ?
      AND purpose = 'TREATMENT' AND auto_granted = 1
      AND is_active = 1 AND expires_at > datetime('now')
  `).bind(nationalId, tid, patientId).first<{ id: number }>();

  if (existing) return { id: existing.id, already_exists: true };

  // Get tenant TPO rules
  const rules = await getDefaultAccessForPurpose('TREATMENT', db, tid);
  if (!rules.auto_grant || rules.default_scope === 'none') {
    return { id: 0, already_exists: false };
  }

  const clinicalAreas = rules.default_clinical_areas ? JSON.stringify(rules.default_clinical_areas) : null;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  const result = await db.prepare(`
    INSERT INTO health_record_consents
      (national_id, granting_tenant_id, granting_patient_id, granted_to_tenant_id,
       consent_type, expires_at, clinical_areas, purpose, auto_granted)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'TREATMENT', 1)
  `).bind(
    nationalId, tid, patientId, tid,
    rules.default_scope, expiresAt, clinicalAreas,
  ).run();

  // Audit log
  await db.prepare(`
    INSERT INTO health_record_access_log
      (national_id, source_tenant_id, accessing_tenant_id, accessing_user_id, access_type)
    VALUES (?, ?, ?, ?, 'treatment_auto_grant')
  `).bind(nationalId, tid, tid, doctorId).run().catch(() => {});

  return { id: Number(result.meta.last_row_id), already_exists: false };
}

/**
 * Revoke auto-granted treatment consents on discharge.
 * Marks them as expired rather than revoked (system action, not patient action).
 */
export async function revokeAutoGrantedConsents(
  db: D1Database,
  nationalId: string,
  tenantId: string | number,
  patientId: number,
): Promise<number> {
  const result = await db.prepare(`
    UPDATE health_record_consents
    SET is_active = 0, expired_at = datetime('now')
    WHERE national_id = ? AND granting_tenant_id = ? AND granting_patient_id = ?
      AND purpose = 'TREATMENT' AND auto_granted = 1 AND is_active = 1
  `).bind(nationalId, String(tenantId), patientId).run();

  return result.meta.changes ?? 0;
}

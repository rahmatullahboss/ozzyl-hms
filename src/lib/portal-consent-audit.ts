// ═══════════════════════════════════════════════════════════════════════════════
// Portal consent audit helper (P0-30, P0-31, P0-32)
// Shared by hospital-links, global-portal, and tenant portal bridge routes.
// ═══════════════════════════════════════════════════════════════════════════════

import type { D1Database } from '@cloudflare/workers-types';

export type HospitalLinkAuditAction =
  | 'link_list'
  | 'link_request'
  | 'link_verify_approve'
  | 'link_verify_reject'
  | 'link_revoke'
  | 'consent_update'
  | 'lookup_data'
  | 'lookup_no_match'
  | 'lookup_unverified'
  | 'sync_labs'
  | 'sync_prescriptions'
  | 'pre_visit_lookup';

export type HospitalLinkAuditOutcome =
  | 'success'
  | 'denied'
  | 'pending'
  | 'not_found'
  | 'no_data'
  | 'error';

export interface HospitalLinkAuditInput {
  patientId?: number | null;
  tenantId?: string | null;
  action: HospitalLinkAuditAction;
  outcome: HospitalLinkAuditOutcome;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only audit log for the /api/hospital-links endpoints.
 * Used to detect enumeration, prove compliance, and reconstruct history.
 */
export async function recordHospitalLinkAudit(
  db: D1Database,
  input: HospitalLinkAuditInput,
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO hospital_link_audit
        (patient_id, tenant_id, action, outcome, details_json,
         ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.patientId ?? null,
      input.tenantId ?? null,
      input.action,
      input.outcome,
      input.details ? JSON.stringify(input.details) : null,
      input.ipAddress ?? null,
      (input.userAgent ?? null)?.slice(0, 256),
    ).run();
  } catch (err) {
    console.error('[portal-consent-audit] write failed:', err);
  }
}

export interface MergeAuditInput {
  tenantId: string;
  action:
    | 'preview'
    | 'confirm'
    | 'apply'
    | 'apply_failed'
    | 'unmerge'
    | 'unmerge_failed'
    | 'rollback'
    | 'idempotent_replay';
  mergeLogId?: number | null;
  primaryPatientId?: number | null;
  secondaryPatientId?: number | null;
  confirmationTokenHash?: string | null;
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  actorUserId?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only merge audit. Re-exports the same writer as lib/mpi-merge.ts
 * so the hospital-links/global-portal code can also call it without an
 * import cycle.
 */
export async function recordMergeAudit(
  db: D1Database,
  input: MergeAuditInput,
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO patient_merge_audit
        (tenant_id, merge_log_id, action, primary_patient_id, secondary_patient_id,
         confirmation_token_hash, payload_json, result_json, actor_user_id,
         ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.mergeLogId ?? null,
      input.action,
      input.primaryPatientId ?? null,
      input.secondaryPatientId ?? null,
      input.confirmationTokenHash ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.result ? JSON.stringify(input.result) : null,
      input.actorUserId ?? null,
      input.ipAddress ?? null,
      (input.userAgent ?? null)?.slice(0, 256),
    ).run();
  } catch (err) {
    console.error('[portal-consent-audit] merge audit write failed:', err);
  }
}

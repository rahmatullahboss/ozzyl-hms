// ═══════════════════════════════════════════════════════════════════════════════
// Portal Link Bridge — explicit verified-link resolver (P0-30, P0-32)
// fix/portal-consent
//
// Replaces the legacy UHID/email/phone auto-match in the global portal and
// tenant patient portal bridge. The bridge now resolves cross-tenant records
// ONLY through the explicit `patient_hospital_link_verifications` table.
// Every resolve is audited in `patient_bridge_audit`.
// ═══════════════════════════════════════════════════════════════════════════════

import type { D1Database } from '@cloudflare/workers-types';

export interface VerifiedBridgeLink {
  id: number;
  globalUserId: number;
  tenantId: string;
  nationalId: string | null;
  verificationMethod: string;
  verifiedByUserId: number | null;
  verifiedAt: string;
}

export interface BridgeResolveResult {
  status: 'verified' | 'no_match';
  link: VerifiedBridgeLink | null;
}

/**
 * Hash a bearer token for audit. We never store the raw token.
 */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Look up a verified link. Returns null (and audits 'no_match') when the
 * link is missing, revoked, or unverified. NEVER falls back to UHID/email/phone.
 */
export async function resolveVerifiedBridgeLink(
  db: D1Database,
  globalUserId: number,
  tenantId: string,
  ipAddress?: string,
  userAgent?: string,
  bearerTokenHash?: string,
): Promise<BridgeResolveResult> {
  const link = await db.prepare(`
    SELECT id, global_user_id, tenant_id, national_id,
           verification_method, verified_by_user_id, verified_at
    FROM patient_hospital_link_verifications
    WHERE global_user_id = ? AND tenant_id = ? AND revoked_at IS NULL
    LIMIT 1
  `).bind(globalUserId, tenantId).first<{
    id: number;
    global_user_id: number;
    tenant_id: string;
    national_id: string | null;
    verification_method: string;
    verified_by_user_id: number | null;
    verified_at: string;
  }>();

  if (!link) {
    await db.prepare(`
      INSERT INTO patient_bridge_audit
        (global_user_id, tenant_id, resolution_path, request_token_hash,
         details_json, ip_address, user_agent)
      VALUES (?, ?, 'no_match', ?, ?, ?, ?)
    `).bind(
      globalUserId, tenantId, bearerTokenHash ?? null,
      JSON.stringify({ reason: 'no_verified_link' }),
      ipAddress ?? null, (userAgent ?? null)?.slice(0, 256),
    ).run();
    return { status: 'no_match', link: null };
  }

  await db.prepare(`
    INSERT INTO patient_bridge_audit
      (global_user_id, tenant_id, resolution_path, resolved_patient_id,
       request_token_hash, details_json, ip_address, user_agent)
    VALUES (?, ?, 'verified_link', ?, ?, ?, ?, ?)
  `).bind(
    globalUserId, tenantId, null, bearerTokenHash ?? null,
    JSON.stringify({ link_id: link.id, method: link.verification_method }),
    ipAddress ?? null, (userAgent ?? null)?.slice(0, 256),
  ).run();

  return {
    status: 'verified',
    link: {
      id: link.id,
      globalUserId: link.global_user_id,
      tenantId: String(link.tenant_id),
      nationalId: link.national_id ?? null,
      verificationMethod: link.verification_method,
      verifiedByUserId: link.verified_by_user_id ?? null,
      verifiedAt: link.verified_at,
    },
  };
}

/**
 * LEGACY UHID/email/phone fallback is now explicitly blocked. Any caller
 * that still tries to resolve by these identifiers gets a no_match result
 * and a `*_fallback_blocked` audit row. This is the safety net the
 * coordination plan requires (P0-30 / P0-32).
 */
export async function resolveWithBlockedFallback(
  db: D1Database,
  globalUserId: number,
  tenantId: string,
  attemptedPath: 'uhid' | 'email' | 'phone',
  attemptedIdentifier: string,
  ipAddress?: string,
  userAgent?: string,
  bearerTokenHash?: string,
): Promise<BridgeResolveResult> {
  await db.prepare(`
    INSERT INTO patient_bridge_audit
      (global_user_id, tenant_id, resolution_path, request_token_hash,
       details_json, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    globalUserId, tenantId,
    `${attemptedPath}_fallback_blocked`,
    bearerTokenHash ?? null,
    JSON.stringify({
      attempted: attemptedPath,
      identifier_hash: await sha256Hex(attemptedIdentifier.trim().toLowerCase()),
    }),
    ipAddress ?? null, (userAgent ?? null)?.slice(0, 256),
  ).run();
  return { status: 'no_match', link: null };
}

/**
 * After a successful verify endpoint, this creates the link record. Idempotent
 * via UNIQUE(global_user_id, tenant_id). If the link already exists and is
 * not revoked, returns the existing row; if revoked, clears revoked_at.
 */
export async function upsertVerifiedLink(
  db: D1Database,
  input: {
    globalUserId: number;
    tenantId: string;
    nationalId?: string | null;
    verificationMethod: string;
    verificationProof?: string | null;
    verifiedByUserId?: number | null;
  },
): Promise<VerifiedBridgeLink> {
  await db.prepare(`
    INSERT INTO patient_hospital_link_verifications
      (global_user_id, tenant_id, national_id, verification_method,
       verification_proof, verified_by_user_id, verified_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), NULL)
    ON CONFLICT(global_user_id, tenant_id) DO UPDATE SET
      national_id = excluded.national_id,
      verification_method = excluded.verification_method,
      verification_proof = excluded.verification_proof,
      verified_by_user_id = excluded.verified_by_user_id,
      verified_at = datetime('now'),
      revoked_at = NULL
  `).bind(
    input.globalUserId, input.tenantId, input.nationalId ?? null,
    input.verificationMethod, input.verificationProof ?? null,
    input.verifiedByUserId ?? null,
  ).run();

  // D1/SQLite last_row_id is not reliable for ON CONFLICT DO UPDATE paths.
  // Fetch by the natural unique key instead so both insert and update return
  // the correct row.
  const link = await db.prepare(`
    SELECT id, global_user_id, tenant_id, national_id,
           verification_method, verified_by_user_id, verified_at
    FROM patient_hospital_link_verifications
    WHERE global_user_id = ? AND tenant_id = ? AND revoked_at IS NULL
    LIMIT 1
  `).bind(input.globalUserId, input.tenantId).first<{
    id: number;
    global_user_id: number;
    tenant_id: string;
    national_id: string | null;
    verification_method: string;
    verified_by_user_id: number | null;
    verified_at: string;
  }>();
  if (!link) throw new Error('Verified link upsert returned no row');
  return {
    id: link.id,
    globalUserId: link.global_user_id,
    tenantId: String(link.tenant_id),
    nationalId: link.national_id ?? null,
    verificationMethod: link.verification_method,
    verifiedByUserId: link.verified_by_user_id ?? null,
    verifiedAt: link.verified_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Patient identity proof helpers (P0-29 fix/portal-consent)
//
// self_register_pending: create a global_patient_auth + global_patient_identity
// in 'pending_verification' state. Returns the userId + identityId but the
// JWT is signed with a 'pending' scope so PHR / global portal features stay
// blocked until proof is supplied.
//
// verify_patient: intentionally disabled until real server-side proof
// validation is implemented for OTP / claim code / NID upload / staff approval.
// ═══════════════════════════════════════════════════════════════════════════════

import type { D1Database } from '@cloudflare/workers-types';

export type ProofMethod = 'email_otp' | 'phone_otp' | 'nid_upload' | 'claim_code' | 'hospital_admin_approval';

export interface PendingRegisterResult {
  userId: number;
  identityId: number;
  uhid: string;
  identityStatus: 'pending_verification';
  proofRequired: ProofMethod[];
  alreadyExisted: boolean;
}

export interface VerifyResult {
  userId: number;
  identityId: number;
  method: ProofMethod;
  verifiedAt: string;
  alreadyVerified: boolean;
}

const VERIFICATION_LEVEL_THRESHOLDS: Record<ProofMethod, number> = {
  email_otp: 1,
  phone_otp: 1,
  nid_upload: 2,
  claim_code: 1,
  hospital_admin_approval: 3,
};

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface IdentityColumnsCache {
  hasAuthStatus: boolean;
  hasAuthProofBasis: boolean;
  hasAuthVerifiedAt: boolean;
  hasAuthVerifiedMethod: boolean;
  hasPhoneVerified: boolean;
  hasIdentityStatus: boolean;
  hasIdentityProofBasis: boolean;
  hasIdentityVerifiedAt: boolean;
  hasIdentityVerifiedMethod: boolean;
  hasIdentityVerifiedBy: boolean;
}

const identityColumnsCache = new WeakMap<D1Database, IdentityColumnsCache>();

async function loadIdentityColumns(db: D1Database): Promise<IdentityColumnsCache> {
  const cached = identityColumnsCache.get(db);
  if (cached) return cached;

  const getSet = async (table: string): Promise<Set<string>> => {
    try {
      const { results } = await db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all<{ name: string }>();
      return new Set((results ?? []).map((r) => r.name));
    } catch {
      return new Set();
    }
  };

  const [authCols, identityCols] = await Promise.all([
    getSet('global_patient_auth'),
    getSet('global_patient_identity'),
  ]);

  const out: IdentityColumnsCache = {
    hasAuthStatus: authCols.has('auth_status'),
    hasAuthProofBasis: authCols.has('auth_proof_basis'),
    hasAuthVerifiedAt: authCols.has('auth_verified_at'),
    hasAuthVerifiedMethod: authCols.has('auth_verified_method'),
    hasPhoneVerified: authCols.has('phone_verified'),
    hasIdentityStatus: identityCols.has('identity_status'),
    hasIdentityProofBasis: identityCols.has('identity_proof_basis'),
    hasIdentityVerifiedAt: identityCols.has('identity_verified_at'),
    hasIdentityVerifiedMethod: identityCols.has('identity_verified_method'),
    hasIdentityVerifiedBy: identityCols.has('identity_verified_by'),
  };
  identityColumnsCache.set(db, out);
  return out;
}

/**
 * Build a request hash for /register idempotency. Same body => same hash.
 */
export async function buildRegisterRequestHash(input: {
  name: string;
  email: string | null;
  phone: string | null;
  national_id: string | null;
}): Promise<string> {
  const canonical = JSON.stringify({
    n: input.name.trim().toLowerCase(),
    e: input.email?.trim().toLowerCase() ?? null,
    p: input.phone ?? null,
    i: input.national_id?.trim().toLowerCase() ?? null,
  });
  return sha256Hex(canonical);
}

/**
 * Idempotent self-registration. Same payload returns the same userId; the
 * created global_patient_identity is in 'pending_verification' state so the
 * caller MUST sign a JWT with scope 'pending' (not 'global') so PHR/global
 * features remain blocked until proof is supplied.
 */
export async function selfRegisterPending(
  db: D1Database,
  input: {
    name: string;
    email: string | null;
    phone: string | null;
    nationalId: string | null;
    passwordHash: string;
    uhid: string;
    identityId: number;
    requestHash: string;
    payload: Record<string, unknown>;
  },
): Promise<PendingRegisterResult> {
  const cols = await loadIdentityColumns(db);

  // Check idempotency: same request_hash returns the existing row.
  const existing = await db.prepare(
    'SELECT * FROM patient_register_request WHERE request_hash = ?',
  ).bind(input.requestHash).first<{
    id: number;
    response_json: string | null;
    user_id: number | null;
  }>();
  if (existing?.user_id && existing.response_json) {
    return JSON.parse(existing.response_json) as PendingRegisterResult;
  }

  // Persist a register request row for idempotency + audit.
  const insertCols = ['request_hash', 'payload_json'];
  const insertVals: Array<string | number> = [input.requestHash, JSON.stringify(input.payload)];
  if (input.email) { insertCols.push('email'); insertVals.push(input.email); }
  if (input.phone) { insertCols.push('phone'); insertVals.push(input.phone); }
  if (input.nationalId) { insertCols.push('national_id'); insertVals.push(input.nationalId); }

  await db.prepare(`
    INSERT INTO patient_register_request (${insertCols.join(', ')})
    VALUES (${insertCols.map(() => '?').join(', ')})
  `).bind(...insertVals).run();

  // Insert the auth account in pending state.
  const authCols: string[] = ['name', 'uhid'];
  const authVals: Array<string | null> = [input.name, input.uhid];
  authCols.push('email'); authVals.push(input.email);
  authCols.push('phone'); authVals.push(input.phone);
  authCols.push('password_hash'); authVals.push(input.passwordHash);
  authCols.push('national_id'); authVals.push(input.nationalId);
  if (cols.hasAuthStatus) { authCols.push('auth_status'); authVals.push('pending_verification'); }
  if (cols.hasAuthProofBasis) { authCols.push('auth_proof_basis'); authVals.push(null); }
  if (cols.hasAuthVerifiedAt) { authCols.push('auth_verified_at'); authVals.push(null); }
  if (cols.hasAuthVerifiedMethod) { authCols.push('auth_verified_method'); authVals.push(null); }
  if (cols.hasPhoneVerified) { authCols.push('phone_verified'); authVals.push(0 as unknown as string); }

  const result = await db.prepare(`
    INSERT INTO global_patient_auth (${authCols.join(', ')})
    VALUES (${authCols.map(() => '?').join(', ')})
  `).bind(...authVals).run();
  const userId = Number(result.meta.last_row_id);

  // Mark the global_patient_identity row as pending_verification too.
  const identitySets: string[] = [];
  if (cols.hasIdentityStatus) {
    identitySets.push("identity_status = 'pending_verification'");
  }
  if (cols.hasIdentityProofBasis) {
    identitySets.push('identity_proof_basis = NULL');
  }
  if (cols.hasIdentityVerifiedAt) {
    identitySets.push('identity_verified_at = NULL');
  }
  if (cols.hasIdentityVerifiedMethod) {
    identitySets.push('identity_verified_method = NULL');
  }
  if (identitySets.length > 0) {
    await db.prepare(`
      UPDATE global_patient_identity
      SET ${identitySets.join(', ')}
      WHERE id = ?
    `).bind(input.identityId).run();
  }

  const response: PendingRegisterResult = {
    userId,
    identityId: input.identityId,
    uhid: input.uhid,
    identityStatus: 'pending_verification',
    proofRequired: ['email_otp', 'phone_otp', 'nid_upload', 'claim_code'],
    alreadyExisted: false,
  };
  await db.prepare(`
    UPDATE patient_register_request
    SET response_json = ?, user_id = ?
    WHERE request_hash = ?
  `).bind(JSON.stringify(response), userId, input.requestHash).run();

  return response;
}

/**
 * Verification is intentionally disabled until each proof method performs a
 * real server-side validation step. This prevents arbitrary body-supplied
 * `user_id` + fake `proof_ref` from promoting a pending identity to verified.
 *
 * Re-enable only after implementing method-specific checks:
 * - email_otp / phone_otp: validate OTP against the stored challenge
 * - claim_code: validate unused, unexpired hospital-issued code
 * - nid_upload: validate uploaded proof token / review state
 * - hospital_admin_approval: require authenticated staff + permission
 */
export async function verifyPatientIdentity(
  db: D1Database,
  input: {
    userId: number;
    method: ProofMethod;
    proofRef: string;
    actorUserId?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<VerifyResult> {
  void db;
  void input;
  throw new Error('Identity verification requires server-side proof validation and is temporarily disabled');
}

export const VERIFICATION_METHODS = Object.keys(VERIFICATION_LEVEL_THRESHOLDS) as ProofMethod[];

export { VERIFICATION_LEVEL_THRESHOLDS };

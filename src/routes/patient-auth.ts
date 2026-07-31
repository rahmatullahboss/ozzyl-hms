/**
 * Patient Auth Routes (tenant-agnostic, global)
 *
 * Public endpoints for the standalone patient health portal.
 * Patients log in with email/phone + password or Google Sign-In.
 * No hospital slug needed — cross-tenant access via NID/UHID/email.
 *
 * Endpoints:
 *   POST /api/patient-auth/register         — create account (email verification required)
 *   POST /api/patient-auth/login            — email/phone + password
 *   POST /api/patient-auth/google           — Google ID token verification
 *   POST /api/patient-auth/forgot-password  — request password reset email
 *   POST /api/patient-auth/reset-password   — reset password with token
 *   POST /api/patient-auth/refresh          — refresh JWT
 *   GET  /api/patient-auth/my-hospitals     — list hospitals where patient has records
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sign, verify } from 'hono/jwt';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';
import { sendEmail, EmailTemplates } from '../lib/email';
import type { D1Database } from '@cloudflare/workers-types';
import { claimGlobalIdentity, createReadableGlobalUid, GLOBAL_UID_REGEX, resolveOrCreateGlobalIdentity } from '../lib/global-identity';
import { validateBDNationalId } from '../lib/nid-validation';
import { sendOtp, verifyOtp } from '../lib/otp';
import { createSmsProvider } from '../lib/sms';
import {
  buildRegisterRequestHash,
  selfRegisterPending,
  verifyPatientIdentity,
  type ProofMethod,
} from '../lib/patient-identity-proof';
import {
  PatientAuthSuspendedError,
  resolvePatientAuthScope,
  type PatientAuthScopeDecision,
} from '../lib/patient-auth-scope';

const patientAuthRoutes = new Hono<{ Bindings: Env }>();
const tableColumnCache = new WeakMap<D1Database, Map<string, Set<string>>>();
const defaultTableColumns: Record<string, string[]> = {
  global_patient_auth: [
    'id',
    'identity_id',
    'name',
    'email',
    'phone',
    'password_hash',
    'national_id',
    'uhid',
    'email_verified',
  ],
  global_patient_identity: [
    'id',
    'uhid',
    'primary_name',
    'primary_phone',
    'national_id',
    'claim_status',
    'claimed_auth_user_id',
  ],
};

// ─── Constants ────────────────────────────────────────────────────────

const JWT_EXPIRY_HOURS = 24;
const REFRESH_EXPIRY_HOURS = 72;
const LOCKOUT_THRESHOLD = 5;      // failed attempts before lockout
const LOCKOUT_WINDOW_SEC = 900;   // 15 minutes
const LOCKOUT_DURATION_SEC = 1800; // 30 minutes
const CLAIM_CODE_THRESHOLD = 5;
const CLAIM_CODE_IP_THRESHOLD = 10;
const CLAIM_CODE_IP_WINDOW_SEC = 3600;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH_LENGTH = 32;    // 256 bits
const RESET_TOKEN_EXPIRY_MIN = 30;
const globalUidSchema = z.string().regex(GLOBAL_UID_REGEX, 'UHID format: OZ-000000 or OZ-XXXX-XXXX');

function resolvePatientAuthDecision(authStatus: unknown): PatientAuthScopeDecision {
  try {
    return resolvePatientAuthScope(authStatus);
  } catch (error) {
    if (error instanceof PatientAuthSuspendedError) {
      throw new HTTPException(403, { message: error.message });
    }
    throw error;
  }
}

function requireVerifiedPatientAuth(authStatus: unknown): PatientAuthScopeDecision {
  const decision = resolvePatientAuthDecision(authStatus);
  if (decision.verificationRequired) {
    throw new HTTPException(403, { message: 'Patient identity verification is required' });
  }
  return decision;
}

async function ensureGlobalUHID(
  db: D1Database,
  opts: { currentUhid?: string | null; nationalId?: string | null },
): Promise<string> {
  if (opts.currentUhid) {
    if (opts.nationalId) {
      await db.prepare(`
        INSERT OR IGNORE INTO global_patient_identity (national_id, uhid)
        VALUES (?, ?)
      `).bind(opts.nationalId, opts.currentUhid).run();
    }
    return opts.currentUhid;
  }

  if (opts.nationalId) {
    const existing = await db.prepare(
      'SELECT uhid FROM global_patient_identity WHERE national_id = ?',
    ).bind(opts.nationalId).first<{ uhid: string }>();

    if (existing?.uhid) {
      return existing.uhid;
    }
  }

  const uhid = createReadableGlobalUid();

  if (opts.nationalId) {
    await db.prepare(`
      INSERT OR IGNORE INTO global_patient_identity (national_id, uhid)
      VALUES (?, ?)
    `).bind(opts.nationalId, uhid).run();
  }

  return uhid;
}

// ─── Schemas ──────────────────────────────────────────────────────────

const optionalNationalIdSchema = z.string().superRefine((value, ctx) => {
  const result = validateBDNationalId(value);
  if (!result.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.error ?? 'Invalid National ID',
    });
  }
}).optional();

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().optional(),
  phone: z.string().regex(/^01\d{9}$/, 'Valid BD phone: 01XXXXXXXXX').optional(),
  password: z.string()
    .min(8, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে')
    .max(128)
    .regex(/[A-Za-z]/, 'পাসওয়ার্ডে কমপক্ষে একটি অক্ষর থাকতে হবে')
    .regex(/[0-9]/, 'পাসওয়ার্ডে কমপক্ষে একটি সংখ্যা থাকতে হবে'),
  national_id: optionalNationalIdSchema,
  uhid: globalUidSchema.optional(),
}).refine(
  (data) => data.email || data.phone,
  { message: 'ইমেইল অথবা ফোন নম্বর দিতে হবে', path: ['email'] },
);

const claimCardSchema = z.object({
  uhid: globalUidSchema,
  claim_code: z.string().regex(/^C-[A-Z2-9]{6}$/, 'Claim code format: C-XXXXXX').optional(),
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().regex(/^01\d{9}$/, 'Valid BD phone: 01XXXXXXXXX').optional(),
  password: z.string()
    .min(8, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে')
    .max(128)
    .regex(/[A-Za-z]/, 'পাসওয়ার্ডে কমপক্ষে একটি অক্ষর থাকতে হবে')
    .regex(/[0-9]/, 'পাসওয়ার্ডে কমপক্ষে একটি সংখ্যা থাকতে হবে'),
  national_id: optionalNationalIdSchema,
}).refine(
  (data) => data.phone || data.national_id || data.claim_code,
  { message: 'কার্ড claim করতে phone, national ID, অথবা claim code দিতে হবে', path: ['phone'] },
);

const loginSchema = z.object({
  identifier: z.string().min(1, 'ইমেইল অথবা ফোন নম্বর দিন'),
  password: z.string().min(1, 'পাসওয়ার্ড দিন'),
});

const googleLoginSchema = z.object({
  credential: z.string().min(1, 'Google credential required'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('সঠিক ইমেইল দিন'),
});

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().regex(/^01\d{9}$/, 'Valid BD phone: 01XXXXXXXXX').nullable().optional(),
  national_id: z.union([z.null(), optionalNationalIdSchema]),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token required'),
  password: z.string()
    .min(8, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে')
    .max(128)
    .regex(/[A-Za-z]/, 'পাসওয়ার্ডে কমপক্ষে একটি অক্ষর থাকতে হবে')
    .regex(/[0-9]/, 'পাসওয়ার্ডে কমপক্ষে একটি সংখ্যা থাকতে হবে'),
});

// ─── Password Hashing (PBKDF2 — Web Crypto, Workers-safe) ─────────────

/** Hash password using PBKDF2-SHA256 via Web Crypto API */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    PBKDF2_HASH_LENGTH * 8,
  );
  const hash = new Uint8Array(derivedBits);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/** Verify password against PBKDF2 hash */
async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Handle legacy bcrypt hashes (auto-migration)
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    // bcrypt fallback — import dynamically only when needed
    const bcrypt = await import('bcryptjs');
    return bcrypt.compare(password, storedHash);
  }

  // PBKDF2 format: pbkdf2:{iterations}:{salt_hex}:{hash_hex}
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1], 10);
  const salt = new Uint8Array(parts[2].match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const expectedHash = parts[3];

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_HASH_LENGTH * 8,
  );
  const actualHash = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return actualHash === expectedHash;
}

/** SHA-256 hash for tokens */
async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── JWT Helpers ──────────────────────────────────────────────────────

async function generatePatientToken(
  payload: { userId: number; role: string; scope: string; uhid?: string | null; nationalId?: string | null; email?: string | null },
  secret: string,
  expiresInHours = JWT_EXPIRY_HOURS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      userId: String(payload.userId),
      role: payload.role,
      scope: payload.scope,
      uhid: payload.uhid ?? undefined,
      nationalId: payload.nationalId ?? undefined,
      email: payload.email ?? undefined,
      iat: now,
      exp: now + expiresInHours * 3600,
    } as Record<string, unknown>,
    secret,
  );
}

// ─── Google ID Token Verification (JWKS-based, no client secret) ──────

interface GoogleJWK {
  kid: string;
  n: string;
  e: string;
  kty: string;
  alg: string;
  use: string;
}

let cachedGoogleKeys: { keys: GoogleJWK[]; fetchedAt: number } | null = null;

/** Fetch Google's public JWKS and cache for 6 hours */
async function getGooglePublicKeys(): Promise<GoogleJWK[]> {
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  if (cachedGoogleKeys && (Date.now() - cachedGoogleKeys.fetchedAt) < SIX_HOURS_MS) {
    return cachedGoogleKeys.keys;
  }

  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!response.ok) {
    throw new HTTPException(503, { message: 'Failed to fetch Google public keys' });
  }

  const data = await response.json() as { keys: GoogleJWK[] };
  cachedGoogleKeys = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

/** Base64URL decode */
function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

/**
 * Verify Google ID token locally using JWKS.
 * No external HTTP call per login — keys are cached.
 */
async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId?: string,
): Promise<{
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}> {
  // Decode JWT header to get kid
  const [headerB64, payloadB64, signatureB64] = idToken.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new HTTPException(401, { message: 'Invalid token format' });
  }

  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64))) as { kid: string; alg: string };
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as Record<string, unknown>;

  // Verify algorithm
  if (header.alg !== 'RS256') {
    throw new HTTPException(401, { message: 'Unsupported token algorithm' });
  }

  // Find matching key
  const keys = await getGooglePublicKeys();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) {
    // Key might have rotated — force refresh
    cachedGoogleKeys = null;
    const freshKeys = await getGooglePublicKeys();
    const freshJwk = freshKeys.find(k => k.kid === header.kid);
    if (!freshJwk) {
      throw new HTTPException(401, { message: 'Token signing key not found' });
    }
    return verifyWithKey(freshJwk, headerB64, payloadB64, signatureB64, payload, expectedClientId);
  }

  return verifyWithKey(jwk, headerB64, payloadB64, signatureB64, payload, expectedClientId);
}

async function verifyWithKey(
  jwk: GoogleJWK,
  headerB64: string,
  payloadB64: string,
  signatureB64: string,
  payload: Record<string, unknown>,
  expectedClientId?: string,
): Promise<{ sub: string; email: string; email_verified: boolean; name: string; picture?: string }> {
  // Import public key
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  // Verify signature
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecode(signatureB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, data);

  if (!valid) {
    throw new HTTPException(401, { message: 'Invalid token signature' });
  }

  // Verify audience
  if (expectedClientId && payload.aud !== expectedClientId) {
    throw new HTTPException(401, { message: 'Token audience mismatch' });
  }

  // Verify issuer
  const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!validIssuers.includes(payload.iss as string)) {
    throw new HTTPException(401, { message: 'Invalid token issuer' });
  }

  // Verify expiry
  const exp = Number(payload.exp);
  if (exp < Math.floor(Date.now() / 1000)) {
    throw new HTTPException(401, { message: 'Token expired' });
  }

  return {
    sub: payload.sub as string,
    email: payload.email as string,
    email_verified: payload.email_verified === true || payload.email_verified === 'true',
    name: payload.name as string,
    picture: payload.picture as string | undefined,
  };
}

// ─── Audit Logging ────────────────────────────────────────────────────

async function auditLog(
  db: D1Database,
  globalUserId: number | null,
  action: string,
  c: { req: { header: (name: string) => string | undefined } },
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO patient_auth_audit (global_user_id, action, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      globalUserId,
      action,
      c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown',
      (c.req.header('User-Agent') || 'unknown').slice(0, 256),
      metadata ? JSON.stringify(metadata) : null,
    ).run();
  } catch {
    // Non-critical — don't fail the request
  }
}

async function getTableColumns(db: D1Database, table: string): Promise<Set<string>> {
  let dbCache = tableColumnCache.get(db);
  if (!dbCache) {
    dbCache = new Map<string, Set<string>>();
    tableColumnCache.set(db, dbCache);
  }

  const cached = dbCache.get(table);
  if (cached) return cached;

  const { results } = await db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all<{ name: string }>();
  const columns = new Set((results ?? []).map((row) => String(row.name)));
  if (columns.size === 0 && defaultTableColumns[table]) {
    for (const column of defaultTableColumns[table]) {
      columns.add(column);
    }
  }
  dbCache.set(table, columns);
  return columns;
}

// ─── Account Lockout (KV-based) ──────────────────────────────────────

async function checkLockout(env: Env, identifier: string): Promise<void> {
  try {
    const lockKey = `patient_lock:${identifier}`;
    const locked = await env.KV?.get(lockKey);
    if (locked) {
      throw new HTTPException(429, {
        message: 'অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। ৩০ মিনিট পর আবার চেষ্টা করুন।',
      });
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    // KV unavailable — skip lockout check
  }
}

async function recordFailedLogin(env: Env, identifier: string): Promise<void> {
  try {
    if (!env.KV) return;
    const failKey = `patient_fail:${identifier}`;
    const current = await env.KV.get(failKey);
    const count = current ? parseInt(current, 10) + 1 : 1;

    if (count >= LOCKOUT_THRESHOLD) {
      // Lock the account
      const lockKey = `patient_lock:${identifier}`;
      await env.KV.put(lockKey, String(Date.now()), { expirationTtl: LOCKOUT_DURATION_SEC });
      // Reset fail counter
      await env.KV.delete(failKey);
    } else {
      await env.KV.put(failKey, String(count), { expirationTtl: LOCKOUT_WINDOW_SEC });
    }
  } catch {
    // KV unavailable — skip
  }
}

async function clearFailedLogins(env: Env, identifier: string): Promise<void> {
  try {
    if (!env.KV) return;
    await env.KV.delete(`patient_fail:${identifier}`);
  } catch {
    // KV unavailable — skip
  }
}

async function checkClaimLockout(env: Env, uhid: string, ipAddress: string): Promise<void> {
  try {
    if (!env.KV) return;
    const identityLocked = await env.KV.get(`patient_claim_lock:${uhid}`);
    const ipLocked = await env.KV.get(`patient_claim_ip_lock:${ipAddress}`);
    if (identityLocked || ipLocked) {
      throw new HTTPException(429, {
        message: 'অনেকবার ভুল claim attempt হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
      });
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
  }
}

async function recordFailedClaim(env: Env, uhid: string, ipAddress: string): Promise<void> {
  try {
    if (!env.KV) return;

    const failKey = `patient_claim_fail:${uhid}`;
    const current = await env.KV.get(failKey);
    const count = current ? parseInt(current, 10) + 1 : 1;

    if (count >= CLAIM_CODE_THRESHOLD) {
      await env.KV.put(`patient_claim_lock:${uhid}`, String(Date.now()), { expirationTtl: LOCKOUT_DURATION_SEC });
      await env.KV.delete(failKey);
    } else {
      await env.KV.put(failKey, String(count), { expirationTtl: LOCKOUT_WINDOW_SEC });
    }

    const ipFailKey = `patient_claim_ip_fail:${ipAddress}`;
    const currentIp = await env.KV.get(ipFailKey);
    const ipCount = currentIp ? parseInt(currentIp, 10) + 1 : 1;

    if (ipCount >= CLAIM_CODE_IP_THRESHOLD) {
      await env.KV.put(`patient_claim_ip_lock:${ipAddress}`, String(Date.now()), { expirationTtl: CLAIM_CODE_IP_WINDOW_SEC });
      await env.KV.delete(ipFailKey);
    } else {
      await env.KV.put(ipFailKey, String(ipCount), { expirationTtl: CLAIM_CODE_IP_WINDOW_SEC });
    }
  } catch {
    // If KV is unavailable, claim flow still works but loses throttling.
  }
}

async function clearFailedClaimAttempts(env: Env, uhid: string, ipAddress: string): Promise<void> {
  try {
    if (!env.KV) return;
    await env.KV.delete(`patient_claim_fail:${uhid}`);
    await env.KV.delete(`patient_claim_lock:${uhid}`);
    await env.KV.delete(`patient_claim_ip_fail:${ipAddress}`);
  } catch {
    // KV unavailable — skip.
  }
}

async function ensureNoExistingAuthAccount(
  db: D1Database,
  input: { email?: string | null; phone?: string | null },
): Promise<void> {
  if (input.email) {
    const existing = await db.prepare(
      'SELECT id FROM global_patient_auth WHERE email = ?',
    ).bind(input.email).first();

    if (existing) {
      throw new HTTPException(409, { message: 'এই ইমেইল দিয়ে ইতোমধ্যে অ্যাকাউন্ট আছে। লগইন করুন।' });
    }
  }

  if (input.phone) {
    const existing = await db.prepare(
      'SELECT id FROM global_patient_auth WHERE phone = ?',
    ).bind(input.phone).first();

    if (existing) {
      throw new HTTPException(409, { message: 'এই নম্বর দিয়ে ইতোমধ্যে অ্যাকাউন্ট আছে। লগইন করুন।' });
    }
  }
}

async function createPatientAuthAccount(
  db: D1Database,
  input: {
    identityId: number;
    name: string;
    email?: string | null;
    phone?: string | null;
    passwordHash: string | null;
    nationalId?: string | null;
    uhid: string;
    emailVerified: 0 | 1;
  },
): Promise<number> {
  const columns = await getTableColumns(db, 'global_patient_auth');
  const insertColumns = [
    'name',
    'email',
    'phone',
    'password_hash',
    'national_id',
    'uhid',
    'email_verified',
  ];
  const insertValues: Array<number | string | null> = [
    input.name,
    input.email ?? null,
    input.phone ?? null,
    input.passwordHash,
    input.nationalId ?? null,
    input.uhid,
    input.emailVerified,
  ];

  if (columns.has('identity_id')) {
    insertColumns.unshift('identity_id');
    insertValues.unshift(input.identityId);
  }

  const result = await db.prepare(`
    INSERT INTO global_patient_auth (${insertColumns.join(', ')})
    VALUES (${insertColumns.map(() => '?').join(', ')})
  `).bind(
    ...insertValues,
  ).run();

  return result.meta.last_row_id as number;
}

async function verifyClaimCode(
  db: D1Database,
  identityId: number,
  claimCode?: string | null,
): Promise<{ matched: boolean; claimCodeId?: number }> {
  if (!claimCode) return { matched: false };

  const codeHash = await sha256(claimCode);

  const claimCodeRow = await db.prepare(`
    SELECT id, code_hash
    FROM patient_claim_codes
    WHERE identity_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
    LIMIT 1
  `).bind(identityId, codeHash).first<{ id: number; code_hash: string }>();

  if (!claimCodeRow) return { matched: false };

  return {
    matched: true,
    claimCodeId: claimCodeRow.id,
  };
}

// ─── Cookie Helpers ───────────────────────────────────────────────────

function setAuthCookie(c: any, token: string, maxAgeSeconds: number): void {
  setCookie(c, 'phr_token', token, {
    path: '/',
    httpOnly: true,
    secure: true,
    // Patient portal runs on a separate frontend domain, so auth cookies must be cross-site.
    sameSite: 'None',
    maxAge: maxAgeSeconds,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ─── POST /register ───────────────────────────────────────────────────

patientAuthRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  const db = c.env.DB;
  const data = c.req.valid('json');
  await ensureNoExistingAuthAccount(db, {
    email: data.email ?? null,
    phone: data.phone ?? null,
  });

  // Idempotency: same payload returns the same pending account.
  const requestHash = await buildRegisterRequestHash({
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    national_id: data.national_id ?? null,
  });

  // Hash password with PBKDF2
  const passwordHash = await hashPassword(data.password);

  // Resolve or create the global identity. self_signup identities are
  // created in 'pending_verification' state by the identity-proof helper.
  const identity = await resolveOrCreateGlobalIdentity(db, {
    uhid: data.uhid ?? null,
    nationalId: data.national_id ?? null,
    phone: data.phone ?? null,
    email: data.email ?? null,
    name: data.name,
    source: 'self_signup',
  });

  if (!identity.created && identity.claimStatus === 'claimed' && identity.claimedAuthUserId) {
    throw new HTTPException(409, { message: 'এই স্বাস্থ্য কার্ডটি ইতোমধ্যে claim করা আছে।' });
  }

  // P0-29 (fix/portal-consent): account is created in 'pending_verification'
  // state. PHR / global portal features stay blocked until one of
  // email_otp / phone_otp / nid_upload / claim_code / hospital_admin_approval
  // is presented. The JWT below uses scope='pending' so the middleware in
  // /api/global-portal, /api/patient-phr, /api/hospital-links etc. can
  // reject it cleanly with a 403 'verification_required'.
  const pending = await selfRegisterPending(db, {
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    nationalId: data.national_id ?? null,
    passwordHash,
    uhid: identity.uhid,
    identityId: identity.id,
    requestHash,
    payload: {
      email: data.email ?? null,
      phone: data.phone ?? null,
      national_id: data.national_id ?? null,
      uhid: data.uhid ?? null,
    },
  });

  // We deliberately do NOT call claimGlobalIdentity here — the patient
  // cannot claim the identity until verification is complete.

  // Audit
  await auditLog(db, pending.userId, 'register_pending', c, {
    email: data.email,
    phone: data.phone,
    proof_required: pending.proofRequired,
  });

  // Generate a 'pending' scope JWT — global portal features are blocked.
  const token = await generatePatientToken(
    {
      userId: pending.userId,
      role: 'patient',
      scope: 'pending',
      uhid: pending.uhid,
      nationalId: data.national_id ?? null,
      email: data.email ?? null,
    },
    c.env.JWT_SECRET,
  );

  // Set as HttpOnly cookie
  setAuthCookie(c, token, JWT_EXPIRY_HOURS * 3600);

  return c.json({
    token,
    user: {
      id: pending.userId,
      name: data.name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      uhid: pending.uhid,
      emailVerified: false,
      identityStatus: pending.identityStatus,
    },
    proof_required: pending.proofRequired,
    message: 'Account created in pending state. Verify via email_otp, phone_otp, NID upload, or hospital claim code before PHR / global portal features unlock.',
  }, 201);
});

// ─── POST /verify-identity ────────────────────────────────────────────
//
// Promotes a pending patient account to 'verified' after presenting one of:
//   - email_otp
//   - phone_otp
//   - nid_upload (proof_ref = national_id + upload token reference)
//   - claim_code (proof_ref = a C-XXXXXX claim code from a hospital)
//   - hospital_admin_approval (proof_ref = hospital-side staff user id)
//
// Idempotent. Same/lower proof methods are no-ops; stronger methods
// upgrade the verification level.

const verifyIdentitySchema = z.object({
  user_id: z.number().int().positive().optional(),
  proof_ref: z.string().min(1).max(200),
  method: z.enum(['email_otp', 'phone_otp', 'nid_upload', 'claim_code', 'hospital_admin_approval']),
  metadata: z.record(z.unknown()).optional(),
});

patientAuthRoutes.post('/verify-identity', zValidator('json', verifyIdentitySchema), async (c) => {
  const db = c.env.DB;
  const data = c.req.valid('json');

  // Self-verify path: caller supplies their own user_id from the pending JWT.
  // Admin path: actor_user_id is recorded in the metadata by the caller.
  const userId = data.user_id;
  if (!userId) {
    throw new HTTPException(400, { message: 'user_id is required for self-verify' });
  }

  try {
    const result = await verifyPatientIdentity(db, {
      userId,
      method: data.method as ProofMethod,
      proofRef: data.proof_ref,
      actorUserId: typeof data.metadata?.actor_user_id === 'number'
        ? (data.metadata.actor_user_id as number)
        : null,
      metadata: data.metadata,
    });
    await auditLog(db, userId, 'identity_verified', c, {
      method: data.method,
      proof_ref: data.proof_ref,
      verified_at: result.verifiedAt,
    });
    return c.json({
      user_id: result.userId,
      method: result.method,
      verified_at: result.verifiedAt,
      already_verified: result.alreadyVerified,
    });
  } catch (err: any) {
    throw new HTTPException(400, { message: err?.message ?? 'Identity verification failed' });
  }
});

patientAuthRoutes.post('/claim-card', zValidator('json', claimCardSchema), async (c) => {
  const db = c.env.DB;
  const data = c.req.valid('json');
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const identityColumns = await getTableColumns(db, 'global_patient_identity');

  await checkClaimLockout(c.env, data.uhid, ipAddress);

  await ensureNoExistingAuthAccount(db, {
    email: data.email ?? null,
    phone: data.phone ?? null,
  });

  const identity = await db.prepare(`
    SELECT id, uhid, primary_name, primary_phone, national_id,
           ${identityColumns.has('claim_status') ? 'claim_status' : "'unclaimed' AS claim_status"},
           ${identityColumns.has('claimed_auth_user_id') ? 'claimed_auth_user_id' : 'NULL AS claimed_auth_user_id'}
    FROM global_patient_identity
    WHERE uhid = ?
  `).bind(data.uhid).first<{
    id: number;
    uhid: string;
    primary_name: string | null;
    primary_phone: string | null;
    national_id: string | null;
    claim_status: string | null;
    claimed_auth_user_id: number | null;
  }>();

  if (!identity) {
    throw new HTTPException(404, { message: 'কার্ড খুঁজে পাওয়া যায়নি।' });
  }

  if (identity.claim_status === 'claimed' && identity.claimed_auth_user_id) {
    throw new HTTPException(409, { message: 'এই স্বাস্থ্য কার্ডটি ইতোমধ্যে claim করা আছে।' });
  }

  const claimCodeMatch = await verifyClaimCode(db, identity.id, data.claim_code ?? null);
  const hasStoredVerifier = Boolean(identity.primary_phone || identity.national_id);
  const phoneMatched = Boolean(data.phone && identity.primary_phone && data.phone === identity.primary_phone);
  const nationalIdMatched = Boolean(data.national_id && identity.national_id && data.national_id === identity.national_id);

  if (!hasStoredVerifier && !claimCodeMatch.matched) {
    await recordFailedClaim(c.env, data.uhid, ipAddress);
    await auditLog(db, null, 'claim_card_failed', c, { uhid: data.uhid, reason: 'no_valid_verifier' });
    throw new HTTPException(403, { message: 'এই কার্ডটি claim করতে verified phone, NID, বা claim code দরকার।' });
  }

  if (data.phone && identity.primary_phone && data.phone !== identity.primary_phone) {
    await recordFailedClaim(c.env, data.uhid, ipAddress);
    await auditLog(db, null, 'claim_card_failed', c, { uhid: data.uhid, reason: 'phone_mismatch' });
    throw new HTTPException(403, { message: 'কার্ড verification ব্যর্থ হয়েছে।' });
  }

  if (data.national_id && identity.national_id && data.national_id !== identity.national_id) {
    await recordFailedClaim(c.env, data.uhid, ipAddress);
    await auditLog(db, null, 'claim_card_failed', c, { uhid: data.uhid, reason: 'national_id_mismatch' });
    throw new HTTPException(403, { message: 'কার্ড verification ব্যর্থ হয়েছে।' });
  }

  if (!phoneMatched && !nationalIdMatched && !claimCodeMatch.matched) {
    await recordFailedClaim(c.env, data.uhid, ipAddress);
    await auditLog(db, null, 'claim_card_failed', c, { uhid: data.uhid, reason: 'claim_code_invalid' });
    throw new HTTPException(403, { message: 'কার্ড verification ব্যর্থ হয়েছে।' });
  }

  const passwordHash = await hashPassword(data.password);
  const userId = await createPatientAuthAccount(db, {
    identityId: identity.id,
    name: data.name ?? identity.primary_name ?? 'Patient',
    email: data.email ?? null,
    phone: data.phone ?? identity.primary_phone ?? null,
    passwordHash,
    nationalId: data.national_id ?? identity.national_id ?? null,
    uhid: identity.uhid,
    emailVerified: 0,
  });

  if (claimCodeMatch.claimCodeId) {
    await db.prepare(
      "UPDATE patient_claim_codes SET used_at = datetime('now') WHERE id = ?",
    ).bind(claimCodeMatch.claimCodeId).run();
  }

  await clearFailedClaimAttempts(c.env, data.uhid, ipAddress);
  await claimGlobalIdentity(db, identity.id, userId);
  await auditLog(db, userId, 'claim_card', c, { uhid: data.uhid });

  const token = await generatePatientToken(
    {
      userId,
      role: 'patient',
      scope: 'global',
      uhid: identity.uhid,
      nationalId: data.national_id ?? identity.national_id ?? null,
      email: data.email ?? null,
    },
    c.env.JWT_SECRET,
  );

  setAuthCookie(c, token, JWT_EXPIRY_HOURS * 3600);

  return c.json({
    token,
    user: {
      id: userId,
      name: data.name ?? identity.primary_name ?? 'Patient',
      email: data.email ?? null,
      phone: data.phone ?? identity.primary_phone ?? null,
      uhid: identity.uhid,
      emailVerified: false,
    },
  }, 201);
});

// ─── POST /login ──────────────────────────────────────────────────────

patientAuthRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const db = c.env.DB;
  const { identifier, password } = c.req.valid('json');

  // Check lockout
  await checkLockout(c.env, identifier);

  // Determine if identifier is email or phone — use separate queries (no SQL interpolation)
  const isEmail = identifier.includes('@');
  const user = isEmail
    ? await db.prepare(
        'SELECT id, name, email, phone, password_hash, national_id, uhid, is_active, email_verified, auth_status FROM global_patient_auth WHERE email = ?',
      ).bind(identifier).first<{
        id: number; name: string; email: string | null; phone: string | null;
        password_hash: string | null; national_id: string | null; uhid: string | null;
        is_active: number; email_verified: number; auth_status: string | null;
      }>()
    : await db.prepare(
        'SELECT id, name, email, phone, password_hash, national_id, uhid, is_active, email_verified, auth_status FROM global_patient_auth WHERE phone = ?',
      ).bind(identifier).first<{
        id: number; name: string; email: string | null; phone: string | null;
        password_hash: string | null; national_id: string | null; uhid: string | null;
        is_active: number; email_verified: number; auth_status: string | null;
      }>();

  if (!user) {
    await recordFailedLogin(c.env, identifier);
    await auditLog(db, null, 'login_failed', c, { identifier, reason: 'not_found' });
    return c.json({ error: 'ভুল ইমেইল/ফোন অথবা পাসওয়ার্ড' }, 401);
  }

  if (!user.is_active) {
    await auditLog(db, user.id, 'login_failed', c, { reason: 'inactive' });
    return c.json({ error: 'অ্যাকাউন্ট নিষ্ক্রিয়' }, 403);
  }

  if (!user.password_hash) {
    await auditLog(db, user.id, 'login_failed', c, { reason: 'google_only' });
    return c.json({
      error: 'এই অ্যাকাউন্ট Google দিয়ে তৈরি। Google Sign-In ব্যবহার করুন।',
    }, 400);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await recordFailedLogin(c.env, identifier);
    await auditLog(db, user.id, 'login_failed', c, { reason: 'wrong_password' });
    return c.json({ error: 'ভুল ইমেইল/ফোন অথবা পাসওয়ার্ড' }, 401);
  }

  const authDecision = resolvePatientAuthDecision(user.auth_status);

  // Clear failed login counter on success
  await clearFailedLogins(c.env, identifier);

  // Auto-migrate bcrypt → PBKDF2
  if (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$')) {
    const newHash = await hashPassword(password);
    await db.prepare(
      "UPDATE global_patient_auth SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(newHash, user.id).run();
  }

  // Update last login
  await db.prepare(
    "UPDATE global_patient_auth SET last_login_at = datetime('now') WHERE id = ?",
  ).bind(user.id).run();

  await auditLog(db, user.id, 'login', c);

  const ensuredUhid = await ensureGlobalUHID(db, {
    currentUhid: user.uhid,
    nationalId: user.national_id,
  });

  if (ensuredUhid !== user.uhid) {
    await db.prepare(
      "UPDATE global_patient_auth SET uhid = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(ensuredUhid, user.id).run();
    user.uhid = ensuredUhid;
  }

  const token = await generatePatientToken(
    { userId: user.id, role: 'patient', scope: authDecision.scope, uhid: user.uhid, nationalId: user.national_id, email: user.email },
    c.env.JWT_SECRET,
  );

  // Set as HttpOnly cookie
  setAuthCookie(c, token, JWT_EXPIRY_HOURS * 3600);

  return c.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      uhid: user.uhid,
      emailVerified: !!user.email_verified,
      authStatus: authDecision.status,
    },
    verificationRequired: authDecision.verificationRequired,
  });
});

// ─── POST /google ─────────────────────────────────────────────────────

patientAuthRoutes.post('/google', zValidator('json', googleLoginSchema), async (c) => {
  const db = c.env.DB;
  const { credential } = c.req.valid('json');

  // Verify Google ID token locally via JWKS (no client secret)
  const googleClientId = c.env.GOOGLE_CLIENT_ID;
  const googleUser = await verifyGoogleIdToken(credential, googleClientId);

  if (!googleUser.email_verified) {
    throw new HTTPException(400, { message: 'Google email not verified' });
  }

  // Check if user exists by Google sub
  let user = await db.prepare(
    'SELECT id, name, email, phone, national_id, uhid, is_active, auth_status FROM global_patient_auth WHERE google_sub = ?',
  ).bind(googleUser.sub).first<{
    id: number; name: string; email: string | null; phone: string | null;
    national_id: string | null; uhid: string | null; is_active: number; auth_status: string | null;
  }>();

  if (!user) {
    // Check by email — might have registered with email+password first
    user = await db.prepare(
      'SELECT id, name, email, phone, national_id, uhid, is_active, auth_status FROM global_patient_auth WHERE email = ?',
    ).bind(googleUser.email).first();

    if (user) {
      // Link Google account to existing user
      await db.prepare(
        "UPDATE global_patient_auth SET google_sub = ?, google_email = ?, email_verified = 1, updated_at = datetime('now') WHERE id = ?",
      ).bind(googleUser.sub, googleUser.email, user.id).run();
    } else {
      // Create new account via Google — already verified
      const generatedUhid = await ensureGlobalUHID(db, { nationalId: null });
      const result = await db.prepare(`
        INSERT INTO global_patient_auth (name, email, google_sub, google_email, email_verified, uhid, auth_status)
        VALUES (?, ?, ?, ?, 1, ?, 'verified')
      `).bind(googleUser.name, googleUser.email, googleUser.sub, googleUser.email, generatedUhid).run();

      const newId = result.meta.last_row_id as number;
      user = {
        id: newId,
        name: googleUser.name,
        email: googleUser.email,
        phone: null,
        national_id: null,
        uhid: generatedUhid,
        is_active: 1,
        auth_status: 'verified',
      };
    }
  }

  if (!user.is_active) {
    return c.json({ error: 'অ্যাকাউন্ট নিষ্ক্রিয়' }, 403);
  }

  const authDecision = resolvePatientAuthDecision(user.auth_status);

  const ensuredGoogleUhid = await ensureGlobalUHID(db, {
    currentUhid: user.uhid,
    nationalId: user.national_id,
  });

  if (ensuredGoogleUhid !== user.uhid) {
    await db.prepare(
      "UPDATE global_patient_auth SET uhid = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(ensuredGoogleUhid, user.id).run();
    user.uhid = ensuredGoogleUhid;
  }

  // Update last login
  await db.prepare(
    "UPDATE global_patient_auth SET last_login_at = datetime('now') WHERE id = ?",
  ).bind(user.id).run();

  await auditLog(db, user.id, 'google_login', c);

  const token = await generatePatientToken(
    { userId: user.id, role: 'patient', scope: authDecision.scope, uhid: user.uhid, nationalId: user.national_id, email: user.email },
    c.env.JWT_SECRET,
  );

  // Set as HttpOnly cookie
  setAuthCookie(c, token, JWT_EXPIRY_HOURS * 3600);

  return c.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      uhid: user.uhid,
      emailVerified: true,
      authStatus: authDecision.status,
    },
    verificationRequired: authDecision.verificationRequired,
  });
});

// ─── POST /forgot-password ───────────────────────────────────────────

patientAuthRoutes.post('/forgot-password', zValidator('json', forgotPasswordSchema), async (c) => {
  const db = c.env.DB;
  const { email } = c.req.valid('json');

  // Always return success to prevent email enumeration
  const successMsg = 'ইমেইল পাঠানো হয়েছে (যদি রেজিস্টার্ড থাকে)। আপনার ইমেইল চেক করুন।';

  const user = await db.prepare(
    'SELECT id, name FROM global_patient_auth WHERE email = ? AND is_active = 1',
  ).bind(email).first<{ id: number; name: string }>();

  if (!user) {
    await auditLog(db, null, 'password_reset_request', c, { email, found: false });
    return c.json({ message: successMsg });
  }

  // Generate reset token
  const resetToken = crypto.randomUUID() + '-' + crypto.randomUUID();
  const tokenHash = await sha256(resetToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MIN * 60 * 1000).toISOString();

  await db.prepare(
    'INSERT INTO patient_password_resets (global_user_id, token_hash, expires_at) VALUES (?, ?, ?)',
  ).bind(user.id, tokenHash, expiresAt).run();

  await auditLog(db, user.id, 'password_reset_request', c, { email });

  const portalUrl = c.env.PATIENT_PORTAL_URL || 'https://hms-saas.rahmatullahzisan.workers.dev/patient-portal';
  const resetUrl = `${portalUrl}/reset-password?token=${resetToken}`;

  const template = EmailTemplates.passwordReset({
    patientName: user.name,
    resetUrl,
  });

  await sendEmail(c.env, {
    to: email,
    ...template,
  });

  const isDev = c.env.ENVIRONMENT === 'development';
  return c.json({
    message: successMsg,
    ...(isDev && { resetToken, debug: 'Dev mode — reset token returned in response' }),
  });
});

// ─── POST /reset-password ────────────────────────────────────────────

patientAuthRoutes.post('/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
  const db = c.env.DB;
  const { token, password } = c.req.valid('json');

  const tokenHash = await sha256(token);

  // Find valid, unused reset token
  const resetRecord = await db.prepare(
    `SELECT id, global_user_id FROM patient_password_resets
     WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')`,
  ).bind(tokenHash).first<{ id: number; global_user_id: number }>();

  if (!resetRecord) {
    throw new HTTPException(400, { message: 'অবৈধ বা মেয়াদোত্তীর্ণ রিসেট লিংক। আবার চেষ্টা করুন।' });
  }

  // Hash new password
  const passwordHash = await hashPassword(password);

  // Update password
  await db.prepare(
    "UPDATE global_patient_auth SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(passwordHash, resetRecord.global_user_id).run();

  // Mark token as used
  await db.prepare(
    'UPDATE patient_password_resets SET used = 1 WHERE id = ?',
  ).bind(resetRecord.id).run();

  await auditLog(db, resetRecord.global_user_id, 'password_reset', c);

  return c.json({ message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে। এখন লগইন করুন।' });
});

// ─── POST /refresh ───────────────────────────────────────────────────

patientAuthRoutes.post('/refresh', async (c) => {
  const db = c.env.DB;

  // Get token from cookie or Authorization header
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global' && decoded.scope !== 'pending') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  const userId = parseInt(decoded.userId, 10);
  const user = await db.prepare(
    'SELECT id, name, email, phone, national_id, uhid, is_active, auth_status FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(userId).first<{
    id: number; name: string; email: string | null; phone: string | null;
    national_id: string | null; uhid: string | null; is_active: number; auth_status: string | null;
  }>();

  if (!user) {
    throw new HTTPException(401, { message: 'User not found or inactive' });
  }

  const authDecision = resolvePatientAuthDecision(user.auth_status);
  const newToken = await generatePatientToken(
    { userId: user.id, role: 'patient', scope: authDecision.scope, uhid: user.uhid, nationalId: user.national_id, email: user.email },
    c.env.JWT_SECRET,
  );

  setAuthCookie(c, newToken, JWT_EXPIRY_HOURS * 3600);

  await auditLog(db, user.id, 'token_refresh', c);

  return c.json({
    token: newToken,
    authStatus: authDecision.status,
    verificationRequired: authDecision.verificationRequired,
  });
});

// ─── POST /logout ────────────────────────────────────────────────────

patientAuthRoutes.post('/logout', async (c) => {
  deleteCookie(c, 'phr_token', { path: '/' });
  return c.json({ message: 'লগআউট সফল' });
});

// ─── GET /my-hospitals ───────────────────────────────────────────────
// Returns list of tenants where this patient has records

patientAuthRoutes.get('/my-hospitals', async (c) => {
  const db = c.env.DB;

  // Get token from cookie or Authorization header
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string; email?: string; uhid?: string; nationalId?: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  // Get user's global identity
  const userId = parseInt(decoded.userId, 10);
  const globalUser = await db.prepare(
    'SELECT email, phone, uhid, national_id, auth_status FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(userId).first<{
    email: string | null;
    phone: string | null;
    uhid: string | null;
    national_id: string | null;
    auth_status: string | null;
  }>();

  if (!globalUser) {
    throw new HTTPException(404, { message: 'User not found' });
  }
  requireVerifiedPatientAuth(globalUser.auth_status);

  // Find matching patients across all tenants by email, phone, UHID, or NID
  // Build a UNION query to match on any available identifier
  const conditions: string[] = [];
  const bindings: (string | null)[] = [];

  if (globalUser.email) {
    conditions.push('p.email = ?');
    bindings.push(globalUser.email);
  }
  if (globalUser.phone) {
    conditions.push('p.mobile = ?');
    bindings.push(globalUser.phone);
  }
  if (globalUser.uhid) {
    conditions.push('p.uhid = ?');
    bindings.push(globalUser.uhid);
  }

  if (conditions.length === 0) {
    return c.json({ hospitals: [] });
  }

  const whereClause = conditions.join(' OR ');
  const { results } = await db.prepare(
    `SELECT DISTINCT t.id as tenant_id, t.name as hospital_name, t.slug,
            p.id as patient_id, p.patient_code, p.name as patient_name
     FROM patients p
     JOIN tenants t ON t.id = p.tenant_id
     WHERE (${whereClause})
     ORDER BY t.name ASC`,
  ).bind(...bindings).all();

  return c.json({
    hospitals: (results ?? []).map((r: any) => ({
      tenantId: r.tenant_id,
      hospitalName: r.hospital_name,
      slug: r.slug,
      patientId: r.patient_id,
      patientCode: r.patient_code,
      patientName: r.patient_name,
    })),
  });
});

// ─── GET /me ─────────────────────────────────────────────────────────
// Returns global user profile

patientAuthRoutes.get('/me', async (c) => {
  const db = c.env.DB;

  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global' && decoded.scope !== 'pending') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  const userId = parseInt(decoded.userId, 10);
  const user = await db.prepare(
    'SELECT id, name, email, phone, national_id, uhid, email_verified, google_sub, auth_status, created_at FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(userId).first<Record<string, unknown>>();

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  const authDecision = resolvePatientAuthDecision(user.auth_status);
  const { auth_status: _authStatus, ...profile } = user;
  return c.json({
    user: profile,
    authStatus: authDecision.status,
    verificationRequired: authDecision.verificationRequired,
  });
});

// ─── PATCH /me ───────────────────────────────────────────────────────
// Update patient profile details that can be completed later.

patientAuthRoutes.patch('/me', zValidator('json', updateProfileSchema), async (c) => {
  const db = c.env.DB;
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  const userId = parseInt(decoded.userId, 10);
  const data = c.req.valid('json');

  const current = await db.prepare(
    'SELECT id, uhid, is_active, auth_status FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(userId).first<{
    id: number;
    uhid: string | null;
    is_active: number;
    auth_status: string | null;
  }>();

  if (!current) {
    throw new HTTPException(404, { message: 'User not found' });
  }
  requireVerifiedPatientAuth(current.auth_status);

  const resolvedUhid = await ensureGlobalUHID(db, {
    currentUhid: current.uhid,
    nationalId: data.national_id ?? null,
  });

  await db.prepare(
    `UPDATE global_patient_auth
     SET name = ?, phone = ?, national_id = ?, uhid = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(
    data.name,
    data.phone ?? null,
    data.national_id ?? null,
    resolvedUhid,
    userId,
  ).run();

  const user = await db.prepare(
    'SELECT id, name, email, phone, national_id, uhid, email_verified, google_sub, created_at FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(userId).first();

  await auditLog(db, userId, 'profile_update', c, {
    name: data.name,
    phone: data.phone ?? null,
    national_id: data.national_id ?? null,
  });

  return c.json({ user });
});

// ─── GET /card/html ──────────────────────────────────────────────────
// Print-ready global patient card with QR based on global UHID.

patientAuthRoutes.get('/card/html', async (c) => {
  const db = c.env.DB;
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  const userId = parseInt(decoded.userId, 10);
  const user = await db.prepare(
    'SELECT id, name, email, phone, national_id, uhid, auth_status FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(userId).first<{
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    national_id: string | null;
    uhid: string | null;
    auth_status: string | null;
  }>();

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }
  requireVerifiedPatientAuth(user.auth_status);

  const ensuredUhid = await ensureGlobalUHID(db, {
    currentUhid: user.uhid,
    nationalId: user.national_id,
  });

  if (ensuredUhid !== user.uhid) {
    await db.prepare(
      "UPDATE global_patient_auth SET uhid = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(ensuredUhid, user.id).run();
    user.uhid = ensuredUhid;
  }

  const { buildGlobalHealthCardHtml } = await import('../lib/health-card-html');
  const html = await buildGlobalHealthCardHtml({
    patientName: user.name,
    nationalId: user.national_id,
    email: user.email,
    phone: user.phone,
    uhid: user.uhid!,
  });

  return c.html(html);
});

// ─── Onboarding ────────────────────────────────────────────────────────

const VALID_GOALS = [
  'goalActive',
  'goalEat',
  'goalSleep',
  'goalMind',
  'goalMeds',
  'goalWeight',
  'goalBpDiabetes',
  'goalPregnancy',
] as const;

const GOAL_TO_MODULES: Record<string, string[]> = {
  goalActive: ['activity', 'sleep'],
  goalEat: ['nutrition', 'activity'],
  goalSleep: ['sleep', 'mind'],
  goalMind: ['mind', 'sleep'],
  goalMeds: ['medication', 'vitals'],
  goalWeight: ['nutrition', 'activity', 'vitals'],
  goalBpDiabetes: ['vitals', 'nutrition', 'medication'],
  goalPregnancy: ['womens_health', 'nutrition', 'vitals'],
};

const GOAL_DAILY_GOAL_ADJUSTMENTS: Record<string, Record<string, number>> = {
  goalActive: { steps: 8000 },
  goalSleep: { sleep_hours: 8 },
  goalWeight: { steps: 7000 },
  goalBpDiabetes: { steps: 5000 },
};

const onboardingSchema = z.object({
  language: z.enum(['bn', 'en']),
  name: z.string().min(1).max(100).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  height_cm: z.number().min(50).max(300).optional(),
  weight_kg: z.number().min(10).max(500).optional(),
  goals: z.array(z.string()).min(1).max(3).refine(
    (goals) => goals.every((g) => VALID_GOALS.includes(g as any)),
    { message: 'Invalid goal selection' },
  ),
  skipHospital: z.boolean().optional(),
  permissions: z.object({
    notifications: z.boolean().optional(),
    health: z.boolean().optional(),
    camera: z.boolean().optional(),
    biometric: z.boolean().optional(),
  }).optional(),
}).refine(
  (data) => data.goals.length <= 3,
  { message: 'Maximum 3 goals allowed', path: ['goals'] },
);

patientAuthRoutes.post('/onboarding', zValidator('json', onboardingSchema), async (c) => {
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = getCookie(c, 'phr_token');
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  const patientId = parseInt(decoded.userId, 10);
  const body = c.req.valid('json');
  const db = c.env.DB;
  const authAccount = await db.prepare(
    'SELECT auth_status FROM global_patient_auth WHERE id = ? AND is_active = 1',
  ).bind(patientId).first<{ auth_status: string | null }>();
  if (!authAccount) {
    throw new HTTPException(401, { message: 'User not found or inactive' });
  }
  requireVerifiedPatientAuth(authAccount.auth_status);

  const activeModules = [...new Set(body.goals.flatMap((g) => GOAL_TO_MODULES[g] ?? []))];

  const dailyGoals: Record<string, number> = { steps: 6000, water_glasses: 8, sleep_hours: 7 };
  for (const goal of body.goals) {
    const adjustments = GOAL_DAILY_GOAL_ADJUSTMENTS[goal];
    if (adjustments) {
      Object.assign(dailyGoals, adjustments);
    }
  }

  await db.prepare(`
    INSERT INTO wellness_profile (patient_id, gender, height_cm, weight_kg, language, onboarding_completed)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(patient_id) DO UPDATE SET
      gender = COALESCE(excluded.gender, wellness_profile.gender),
      height_cm = COALESCE(excluded.height_cm, wellness_profile.height_cm),
      weight_kg = COALESCE(excluded.weight_kg, wellness_profile.weight_kg),
      language = COALESCE(excluded.language, wellness_profile.language),
      onboarding_completed = 1,
      updated_at = datetime('now')
  `).bind(
    patientId,
    body.gender ?? null,
    body.height_cm ?? null,
    body.weight_kg ?? null,
    body.language,
  ).run();

  await db.prepare(`
    INSERT INTO wellness_preferences (patient_id, active_modules, daily_goals, notification_settings)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(patient_id) DO UPDATE SET
      active_modules = excluded.active_modules,
      daily_goals = excluded.daily_goals,
      notification_settings = excluded.notification_settings,
      updated_at = datetime('now')
  `).bind(
    patientId,
    JSON.stringify(activeModules),
    JSON.stringify(dailyGoals),
    JSON.stringify(body.permissions ?? {}),
  ).run();

  if (body.name) {
    await db.prepare(`
      UPDATE global_patient_auth SET name = ? WHERE id = ?
    `).bind(body.name, patientId).run();
  }

  return c.json({ success: true });
});

// ─── OTP Endpoints ────────────────────────────────────────────────────────────

const sendOtpSchema = z.object({
  phone: z.string().regex(/^01\d{9}$/, 'Valid BD phone: 01XXXXXXXXX'),
  purpose: z.enum(['signup', 'login', 'claim']).default('signup'),
});

const verifyOtpSchema = z.object({
  phone: z.string().regex(/^01\d{9}$/, 'Valid BD phone: 01XXXXXXXXX'),
  code: z.string().length(6, 'OTP must be 6 digits'),
});

const registerWithOtpSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().regex(/^01\d{9}$/, 'Valid BD phone: 01XXXXXXXXX'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
  password: z.string()
    .min(8, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে')
    .max(128)
    .regex(/[A-Za-z]/, 'পাসওয়ার্ডে কমপক্ষে একটি অক্ষর থাকতে হবে')
    .regex(/[0-9]/, 'পাসওয়ার্ডে কমপক্ষে একটি সংখ্যা থাকতে হবে'),
  email: z.string().email().optional(),
  national_id: z.string().optional(),
});

// POST /api/patient-auth/send-otp
patientAuthRoutes.post('/send-otp', zValidator('json', sendOtpSchema), async (c) => {
  const sms = createSmsProvider(c.env);
  const { phone, purpose } = c.req.valid('json');

  const result = await sendOtp(c.env, sms, phone, purpose);

  if (!result.success) {
    return c.json({ error: result.error }, result.retryAfter ? 429 : 502);
  }

  return c.json({ message: 'OTP sent successfully', phone });
});

// POST /api/patient-auth/verify-otp
patientAuthRoutes.post('/verify-otp', zValidator('json', verifyOtpSchema), async (c) => {
  const { phone, code } = c.req.valid('json');

  const result = await verifyOtp(c.env, phone, code);

  if (!result.valid) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ verified: true, message: 'OTP verified' });
});

// POST /api/patient-auth/register-with-otp
// OTP-verified registration with auto-link to existing hospital patient
patientAuthRoutes.post('/register-with-otp', zValidator('json', registerWithOtpSchema), async (c) => {
  const db = c.env.DB;
  const data = c.req.valid('json');

  // 1. Verify OTP first
  const otpResult = await verifyOtp(c.env, data.phone, data.otp);
  if (!otpResult.valid) {
    return c.json({ error: otpResult.error }, 400);
  }

  // 2. Check if phone already has a portal account
  const existingUser = await db.prepare(
    `SELECT id FROM global_patient_auth WHERE phone = ?`
  ).bind(data.phone).first();

  if (existingUser) {
    throw new HTTPException(409, { message: 'এই মোবাইল নম্বরে ইতোমধ্যে অ্যাকাউন্ট আছে। লগইন করুন।' });
  }

  // 3. Check if phone exists in hospital patients (global_patient_identity)
  const identity = await db.prepare(`
    SELECT id, uhid, primary_name, primary_phone, national_id, claim_status, claimed_auth_user_id
    FROM global_patient_identity
    WHERE primary_phone = ?
  `).bind(data.phone).first<{
    id: number; uhid: string; primary_name: string | null;
    primary_phone: string | null; national_id: string | null;
    claim_status: string | null; claimed_auth_user_id: number | null;
  }>();

  // 4. Create auth account
  const passwordHash = await hashPassword(data.password);
  const uhid = identity?.uhid ?? createReadableGlobalUid();
  const userId = await createPatientAuthAccount(db, {
    identityId: identity?.id ?? 0,
    name: data.name,
    email: data.email ?? null,
    phone: data.phone,
    passwordHash,
    nationalId: data.national_id ?? identity?.national_id ?? null,
    uhid,
    emailVerified: 0,
  });

  // 5. Auto-link if identity found and not already claimed
  if (identity && identity.claim_status !== 'claimed') {
    await claimGlobalIdentity(db, identity.id, userId);
    await auditLog(db, userId, 'auto_link_on_register', c, {
      uhid: identity.uhid,
      phone: data.phone,
      method: 'otp_verified_phone_match',
    });
  } else if (identity && identity.claim_status === 'claimed' && identity.claimed_auth_user_id) {
    // Already claimed by someone else — don't link, but account is created
    await auditLog(db, userId, 'register_phone_claimed_by_other', c, {
      uhid: identity.uhid,
      phone: data.phone,
    });
  } else {
    // No existing identity — create new one
    const newIdentity = await resolveOrCreateGlobalIdentity(db, {
      name: data.name,
      phone: data.phone,
      nationalId: data.national_id,
    });
    await claimGlobalIdentity(db, newIdentity.id, userId);
    await auditLog(db, userId, 'register_new_identity', c, {
      uhid: newIdentity.uhid,
    });
  }

  // 6. Generate JWT
  const finalUhid = identity?.uhid ?? uhid;
  const token = await generatePatientToken(
    {
      userId,
      role: 'patient',
      scope: 'global',
      uhid: finalUhid,
      nationalId: data.national_id ?? identity?.national_id ?? null,
      email: data.email ?? null,
    },
    c.env.JWT_SECRET,
  );

  await auditLog(db, userId, 'register_with_otp', c, { phone: data.phone, autoLinked: !!identity });

  return c.json({
    token,
    user: {
      id: userId,
      name: data.name,
      phone: data.phone,
      uhid: finalUhid,
      autoLinked: !!identity && identity.claim_status !== 'claimed',
    },
  }, 201);
});

export default patientAuthRoutes;

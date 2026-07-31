import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { filterSummaryByClinicalAreas, parseConsentClinicalAreas } from '../../lib/consent-helpers';
import { buildPortableHealthSummary } from '../../lib/health-summary';
import { buildEmergencyHealthProfile } from '../../lib/emergency-profile';
import { getDb } from '../../db';
import type { Env } from '../../types';

const publicHealthRecordRoutes = new Hono<{ Bindings: Env }>();
const INVALID_TOKEN_THRESHOLD = 10;
const INVALID_TOKEN_WINDOW_SEC = 900;
const INVALID_TOKEN_LOCK_SEC = 1800;
const TOKEN_ACCESS_THRESHOLD = 20;
const TOKEN_ACCESS_WINDOW_SEC = 3600;
const TOKEN_ACCESS_IP_THRESHOLD = 60;

async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function checkPublicTokenLock(env: Env, tokenHash: string, ipAddress: string): Promise<void> {
  try {
    if (!env.KV) return;
    const [ipLock, tokenLock, tokenIpLock] = await Promise.all([
      env.KV.get(`public_token_invalid_lock:${ipAddress}`),
      env.KV.get(`public_token_access_lock:${tokenHash}`),
      env.KV.get(`public_token_access_ip_lock:${ipAddress}`),
    ]);
    if (ipLock || tokenLock || tokenIpLock) {
      throw new HTTPException(429, { message: 'Too many token access attempts. Please try again later.' });
    }
  } catch (err) {
    if (err instanceof HTTPException) throw err;
  }
}

async function recordInvalidTokenAttempt(env: Env, ipAddress: string): Promise<void> {
  try {
    if (!env.KV) return;
    const failKey = `public_token_invalid_fail:${ipAddress}`;
    const current = await env.KV.get(failKey);
    const count = current ? parseInt(current, 10) + 1 : 1;
    if (count >= INVALID_TOKEN_THRESHOLD) {
      await env.KV.put(`public_token_invalid_lock:${ipAddress}`, String(Date.now()), { expirationTtl: INVALID_TOKEN_LOCK_SEC });
      await env.KV.delete(failKey);
    } else {
      await env.KV.put(failKey, String(count), { expirationTtl: INVALID_TOKEN_WINDOW_SEC });
    }
  } catch {
    // Best effort only.
  }
}

async function recordValidTokenAccess(env: Env, tokenHash: string, ipAddress: string): Promise<void> {
  try {
    if (!env.KV) return;

    const tokenKey = `public_token_access_count:${tokenHash}`;
    const tokenCurrent = await env.KV.get(tokenKey);
    const tokenCount = tokenCurrent ? parseInt(tokenCurrent, 10) + 1 : 1;
    if (tokenCount > TOKEN_ACCESS_THRESHOLD) {
      await env.KV.put(`public_token_access_lock:${tokenHash}`, String(Date.now()), { expirationTtl: TOKEN_ACCESS_WINDOW_SEC });
      throw new HTTPException(429, { message: 'This health record link has hit its temporary access limit.' });
    }
    await env.KV.put(tokenKey, String(tokenCount), { expirationTtl: TOKEN_ACCESS_WINDOW_SEC });

    const ipKey = `public_token_access_ip_count:${ipAddress}`;
    const ipCurrent = await env.KV.get(ipKey);
    const ipCount = ipCurrent ? parseInt(ipCurrent, 10) + 1 : 1;
    if (ipCount > TOKEN_ACCESS_IP_THRESHOLD) {
      await env.KV.put(`public_token_access_ip_lock:${ipAddress}`, String(Date.now()), { expirationTtl: TOKEN_ACCESS_WINDOW_SEC });
      throw new HTTPException(429, { message: 'Too many health record link requests from this network.' });
    }
    await env.KV.put(ipKey, String(ipCount), { expirationTtl: TOKEN_ACCESS_WINDOW_SEC });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
  }
}

type AccessTokenRow = {
  id: number;
  national_id: string;
  tenant_id: string;
  patient_id: number;
  scope: string;
  is_active: number;
  expires_at: string;
  access_count: number;
};

async function lookupAccessToken(
  db: ReturnType<typeof getDb>,
  tokenHash: string,
): Promise<AccessTokenRow | null> {
  return db.$client.prepare(`
    SELECT id, national_id, tenant_id, patient_id, scope, is_active, expires_at, access_count
    FROM health_record_access_tokens
    WHERE token_hash = ?
  `).bind(tokenHash).first<AccessTokenRow>();
}

async function incrementTokenAccess(
  db: ReturnType<typeof getDb>,
  tokenId: number,
): Promise<void> {
  await db.$client.prepare(`
    UPDATE health_record_access_tokens
    SET access_count = access_count + 1, last_accessed_at = datetime('now')
    WHERE id = ?
  `).bind(tokenId).run();
}

async function auditAccess(
  db: ReturnType<typeof getDb>,
  tokenRow: AccessTokenRow,
  accessType: 'token_access' | 'qr_scan',
  ipAddress: string | null,
  userAgent: string | null,
): Promise<void> {
  await db.$client.prepare(`
    INSERT INTO health_record_access_log
      (access_token_id, national_id, source_tenant_id, access_type, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tokenRow.id, tokenRow.national_id, tokenRow.tenant_id, accessType, ipAddress, userAgent).run();
}

/**
 * GET /api/health-record/summary/:token
 * Public endpoint — returns portable health summary for a valid access token.
 * No auth required. Rate-limited here via KV-backed token and IP counters.
 */
publicHealthRecordRoutes.get('/summary/:token', async (c) => {
  const rawToken = c.req.param('token');
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';

  if (!rawToken || rawToken.length < 32) {
    throw new HTTPException(400, { message: 'Invalid token' });
  }

  const tokenHash = await sha256(rawToken);
  await checkPublicTokenLock(c.env, tokenHash, ip);
  const db = getDb(c.env.DB);

  const tokenRow = await lookupAccessToken(db, tokenHash);

  if (!tokenRow) {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(404, { message: 'Token not found or invalid' });
  }

  if (!tokenRow.is_active) {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(410, { message: 'This access token has been revoked' });
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(410, { message: 'This access token has expired' });
  }

  // Check consent is still active
  const consent = await db.$client.prepare(`
    SELECT id, clinical_areas FROM health_record_consents
    WHERE national_id = ? AND granting_tenant_id = ? AND is_active = 1
      AND expires_at > datetime('now')
      AND consent_type IN ('view_summary', 'view_full', 'emergency_access')
    LIMIT 1
  `).bind(tokenRow.national_id, tokenRow.tenant_id).first<{ id: number; clinical_areas: string | null }>();

  if (!consent) {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(403, { message: 'Patient consent has been revoked or expired' });
  }

  await recordValidTokenAccess(c.env, tokenHash, ip);

  // Build summary
  const summary = await buildPortableHealthSummary(c.env.DB, tokenRow.tenant_id, tokenRow.patient_id);
  const filteredSummary = summary
    ? filterSummaryByClinicalAreas(summary, parseConsentClinicalAreas(consent.clinical_areas))
    : null;

  if (!filteredSummary) {
    throw new HTTPException(404, { message: 'Patient record not found' });
  }

  // Update access count and last accessed
  await incrementTokenAccess(db, tokenRow.id);

  // Log access
  const auditIp = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
  const ua = c.req.header('user-agent') ?? null;

  await auditAccess(db, tokenRow, 'token_access', auditIp, ua);

  return c.json({
    scope: tokenRow.scope,
    expires_at: tokenRow.expires_at,
    access_count: tokenRow.access_count + 1,
    summary: filteredSummary,
  });
});

publicHealthRecordRoutes.get('/emergency/:token', async (c) => {
  const rawToken = c.req.param('token');
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';

  if (!rawToken || rawToken.length < 32) {
    throw new HTTPException(400, { message: 'Invalid token' });
  }

  const tokenHash = await sha256(rawToken);
  await checkPublicTokenLock(c.env, tokenHash, ip);
  const db = getDb(c.env.DB);
  const tokenRow = await lookupAccessToken(db, tokenHash);

  if (!tokenRow) {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(404, { message: 'Token not found or invalid' });
  }

  if (!tokenRow.is_active) {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(410, { message: 'This access token has been revoked' });
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(410, { message: 'This access token has expired' });
  }

  const linkedEmergencyCard = await db.$client.prepare(`
    SELECT id, status
    FROM health_cards
    WHERE token_id = ? AND tenant_id = ? AND patient_id = ? AND card_type = 'emergency'
    ORDER BY version DESC
    LIMIT 1
  `).bind(tokenRow.id, tokenRow.tenant_id, tokenRow.patient_id).first<{ id: number; status: string }>();

  if (!linkedEmergencyCard) {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(404, { message: 'Emergency profile not found for this token' });
  }

  if ((linkedEmergencyCard.status ?? 'active') !== 'active') {
    await recordInvalidTokenAttempt(c.env, ip);
    throw new HTTPException(410, { message: 'This emergency card is not active' });
  }

  await recordValidTokenAccess(c.env, tokenHash, ip);
  const profile = await buildEmergencyHealthProfile(c.env.DB, tokenRow.tenant_id, tokenRow.patient_id);

  if (!profile) {
    throw new HTTPException(404, { message: 'Patient record not found' });
  }

  await incrementTokenAccess(db, tokenRow.id);
  const auditIp = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
  const ua = c.req.header('user-agent') ?? null;
  await auditAccess(db, tokenRow, 'qr_scan', auditIp, ua);

  return c.json({
    access_type: 'qr_scan',
    expires_at: tokenRow.expires_at,
    access_count: tokenRow.access_count + 1,
    profile,
  });
});

export default publicHealthRecordRoutes;

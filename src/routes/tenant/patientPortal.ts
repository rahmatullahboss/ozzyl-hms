import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sendEmail, EmailTemplates } from '../../lib/email';
import { getNextSequence } from '../../lib/sequence';
import { buildLocalSyncPatientCreateOutboxStatement } from '../../lib/local-sync-outbox';
import { buildLocalSyncPatientPayload } from '../../lib/local-sync-patient-payload';
import { sign, verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { derivePatientLiveVisit } from '../../lib/patient-live-visit';
import { normalizeConsultationFee } from '../../lib/doctor-fees';
import { formatDoctorName } from '../../lib/doctor-display';
import { resolveVerifiedBridgeLink, resolveWithBlockedFallback, sha256Hex } from '../../lib/portal-link-bridge';
import { PatientAuthSuspendedError, resolvePatientAuthScope } from '../../lib/patient-auth-scope';


type PatientPortalEnv = {
  Bindings: Env;
  Variables: Variables & { patientId?: string; tenantId?: string; globalUserId?: string };
};

type PatientPortalContext = Context<PatientPortalEnv>;

const patientPortalRoutes = new Hono<PatientPortalEnv>();

// ─── Helpers ────────────────────────────────────────────────────────────

import { parsePagination } from '../../utils/pagination';

/** Build paginated JSON response */
function paginatedResponse<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/** Audit logging helper — fire-and-forget */
async function auditLog(
  db: D1Database,
  patientId: string | undefined,
  action: string,
  tenantId: string | undefined,
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO patient_portal_audit (patient_id, action, tenant_id)
       VALUES (?, ?, ?)`
    ).bind(patientId, action, tenantId).run();
  } catch {
    // Non-critical — don't fail the request
    console.error(`[AUDIT] Failed to log action="${action}" for patient=${patientId}`);
  }
}

/** Escape HTML entities to prevent XSS in generated HTML */
function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Compute patient-friendly lab explanation and severity */
function labExplanation(
  abnormalFlag: string | null | undefined,
  testName: string | undefined,
): { severity: string; explanation: string } {
  if (!abnormalFlag || abnormalFlag === 'normal') {
    return { severity: 'normal', explanation: 'Your result is within the normal range.' };
  }
  if (abnormalFlag === 'slightly_high' || abnormalFlag === 'borderline_high') {
    return { severity: 'borderline', explanation: `Your ${testName ?? 'test'} result is slightly above the normal range. Monitor and consult your doctor if needed.` };
  }
  if (abnormalFlag === 'slightly_low' || abnormalFlag === 'borderline_low') {
    return { severity: 'borderline', explanation: `Your ${testName ?? 'test'} result is slightly below the normal range. Monitor and consult your doctor if needed.` };
  }
  if (abnormalFlag === 'high') {
    return { severity: 'attention', explanation: `Your ${testName ?? 'test'} result is above the normal range. Please consult your doctor.` };
  }
  if (abnormalFlag === 'low') {
    return { severity: 'attention', explanation: `Your ${testName ?? 'test'} result is below the normal range. Please consult your doctor.` };
  }
  if (abnormalFlag === 'critical_high' || abnormalFlag === 'critical_low' || abnormalFlag === 'critical') {
    return { severity: 'critical', explanation: `Your ${testName ?? 'test'} result is outside the safe range. Please contact your doctor immediately.` };
  }
  // Fallback for any other flag
  return { severity: 'attention', explanation: `Your ${testName ?? 'test'} result may require attention. Please consult your doctor.` };
}

const requestMagicLinkSchema = z.object({
  email: z.string().email(),
});

const MAGIC_LINK_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

const verifyMagicLinkSchema = z.object({
  token: z.string().min(1),
});

const patientRegisterSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  mobile: z.string().max(20).optional(),
  date_of_birth: z.string().optional(),
  gender: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
});

async function signPatientPortalToken(
  env: Env,
  payload: { userId: string; patientId: string; tenantId: string; email?: string | null },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    userId: payload.userId,
    patientId: payload.patientId,
    tenantId: payload.tenantId,
    role: 'patient',
    permissions: [],
    scope: 'tenant_patient_portal',
    email: payload.email ?? null,
    iat: now,
    exp: now + 60 * 60 * 8,
  } as Record<string, unknown>, env.JWT_SECRET);
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL PATIENT AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * For patient-owned wellness/PHR data that is intentionally not hospital-scoped.
 */
async function globalPatientOwnedDataMiddleware(c: PatientPortalContext, next: () => Promise<void>): Promise<Response | void> {
  const existingRole = c.get('role');
  const existingPatientId = c.get('patientId');

  if (existingRole && existingRole !== 'patient') {
    throw new HTTPException(403, { message: 'Access denied. Patient role required.' });
  }

  if (existingPatientId && existingRole === 'patient') {
    await next();
    return;
  }

  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required. Please log in.' });
  }

  let decoded: { userId?: string; scope?: string; role?: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired session. Please log in again.' });
  }

  if (decoded.scope !== 'global' || (decoded.role && decoded.role !== 'patient')) {
    throw new HTTPException(403, { message: 'Patient portal access only. Global patient authentication required.' });
  }

  if (!decoded.userId) {
    throw new HTTPException(401, { message: 'Invalid patient session.' });
  }

  c.set('role', 'patient');
  c.set('patientId', decoded.userId);
  await next();
}

/**
 * Middleware that:
 * 1. Checks if patientId is already set in context (e.g. by upstream tenant auth)
 *    - If role is set and not 'patient', returns 403
 *    - If patientId is already resolved, skips JWT flow
 * 2. Reads JWT from Authorization header OR phr_token cookie
 * 3. Verifies it's a global patient token (scope === 'global')
 * 4. Reads X-Tenant-ID header to determine which hospital's data to show
 * 5. Resolves global user → tenant patient record via email/phone/UHID matching
 * 6. Sets patientId (tenant-scoped) and tenantId in context
 */
async function globalPatientAuthMiddleware(c: PatientPortalContext, next: () => Promise<void>): Promise<Response | void> {
  // Fast path: if upstream middleware already resolved the patient context
  const existingRole = c.get('role');
  const existingPatientId = c.get('patientId');

  if (existingRole && existingRole !== 'patient') {
    throw new HTTPException(403, { message: 'Access denied. Patient role required.' });
  }

  if (existingPatientId && existingRole === 'patient') {
    // Already authenticated via tenant auth — skip JWT flow
    await next();
    return;
  }

  // 1. Get token from cookie or Authorization header
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required. Please log in.' });
  }

  // 2. Verify JWT
  let decoded: { userId: string; scope: string; email?: string; uhid?: string; nationalId?: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired session. Please log in again.' });
  }

  // Must be a global patient token
  if (decoded.scope !== 'global') {
    throw new HTTPException(403, { message: 'Patient portal access only. Global patient authentication required.' });
  }

  // 3. Get tenant ID from header
  const tenantId = c.req.header('X-Tenant-ID') || c.get('tenantId');
  if (!tenantId) {
    throw new HTTPException(400, { message: 'X-Tenant-ID header required. Please select a hospital.' });
  }
  c.set('tenantId', tenantId);
  c.set('globalUserId', decoded.userId);

  // 4. Resolve global user → tenant patient record
  const globalUserId = parseInt(decoded.userId, 10);
  const globalUser = await c.env.DB.prepare(
    "SELECT id, email, phone, uhid, auth_status FROM global_patient_auth WHERE id = ? AND is_active = 1",
  ).bind(globalUserId).first<{ id: number; email: string | null; phone: string | null; uhid: string | null; auth_status: string | null }>();

  if (!globalUser) {
    throw new HTTPException(401, { message: 'Global account not found or deactivated.' });
  }

  // Re-check DB verification status on every tenant portal request so a
  // stale global token cannot bypass pending, suspended, or unknown states.
  let authDecision;
  try {
    authDecision = resolvePatientAuthScope(globalUser.auth_status);
  } catch (error) {
    if (error instanceof PatientAuthSuspendedError) {
      throw new HTTPException(403, { message: error.message });
    }
    throw error;
  }
  if (authDecision.verificationRequired) {
    throw new HTTPException(403, {
      message: 'আপনার অ্যাকাউন্ট এখনো যাচাই করা হয়নি। ইমেইল/ফোন OTP, NID, অথবা হাসপাতালের claim code দিয়ে যাচাই সম্পন্ন করুন।',
    });
  }

  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || undefined;
  const userAgent = c.req.header('User-Agent') || undefined;
  const bearerTokenHash = token ? await sha256Hex(token.slice(0, 64)) : undefined;

  // P0-32 (fix/portal-consent): the tenant portal bridge now requires an
  // explicit verified hospital link. UHID/email/phone auto-match is
  // explicitly blocked and audited as `*_fallback_blocked` in
  // patient_bridge_audit. The legacy fallback paths remain in the
  // codebase only as a safety net to log failed lookups; they no longer
  // resolve a patient.
  const verified = await resolveVerifiedBridgeLink(
    c.env.DB,
    globalUserId,
    tenantId,
    ipAddress,
    userAgent,
    bearerTokenHash,
  );

  let patientId: string | null = null;
  if (verified.status === 'verified' && verified.link?.nationalId) {
    const match = await c.env.DB.prepare(
      'SELECT id FROM patients WHERE national_id = ? AND tenant_id = ? LIMIT 1',
    ).bind(verified.link.nationalId, tenantId).first<{ id: number }>();
    if (match) patientId = String(match.id);
  }

  // Audit: explicitly mark the legacy fallback attempts as blocked.
  if (!patientId && globalUser.uhid) {
    await resolveWithBlockedFallback(c.env.DB, globalUserId, tenantId, 'uhid', globalUser.uhid,
      ipAddress, userAgent, bearerTokenHash);
  }
  if (!patientId && globalUser.email) {
    await resolveWithBlockedFallback(c.env.DB, globalUserId, tenantId, 'email', globalUser.email,
      ipAddress, userAgent, bearerTokenHash);
  }
  if (!patientId && globalUser.phone) {
    await resolveWithBlockedFallback(c.env.DB, globalUserId, tenantId, 'phone', globalUser.phone,
      ipAddress, userAgent, bearerTokenHash);
  }

  if (!patientId) {
    throw new HTTPException(404, {
      message: 'এই হাসপাতালের সাথে আপনার সক্রিয় verified link নেই। হাসপাতালে গিয়ে link অনুরোধ করুন এবং verification সম্পন্ন করুন।',
    });
  }

  c.set('patientId', patientId);
  await next();
}

// ==========================================================================
// PROTECTED PORTAL ROUTES (require patient JWT)
// ==========================================================================

patientPortalRoutes.post('/request-login', zValidator('json', requestMagicLinkSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = c.get('tenantId');
  const { email } = c.req.valid('json');
  const normalizedEmail = email.trim().toLowerCase();
  const rateKey = `magic_rate:v2:${tenantId}:${normalizedEmail}`;

  try {
    const rateCount = Number(await c.env.KV.get(rateKey) ?? '0');
    if (rateCount >= 3) {
      throw new HTTPException(429, { message: 'Too many login attempts. Please try again later.' });
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error;
  }

  const patient = await db.$client.prepare(
    `SELECT id, name, email
     FROM patients
     WHERE email = ? AND tenant_id = ?
     LIMIT 1`
  ).bind(normalizedEmail, tenantId).first<{ id: number; name: string | null; email: string | null }>();

  if (!patient) {
    return c.json({
      message: 'If this email is registered, a login link has been sent.',
    });
  }

  const existingCred = await db.$client.prepare(
    `SELECT id
     FROM patient_portal_credentials
     WHERE patient_id = ? AND tenant_id = ?
     LIMIT 1`
  ).bind(patient.id, tenantId).first<{ id: number }>();

  if (!existingCred) {
    await db.$client.prepare(
      `INSERT INTO patient_portal_credentials (patient_id, user_id, tenant_id, created_at)
       VALUES (?, ?, ?, datetime('now', '+6 hours'))`
    ).bind(patient.id, patient.id, tenantId).run();
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await sign({
    patientId: String(patient.id),
    userId: String(patient.id),
    tenantId,
    email: patient.email ?? normalizedEmail,
    purpose: 'patient_portal_magic_link',
    iat: issuedAt,
    exp: issuedAt + 60 * 15,
  } as Record<string, unknown>, c.env.JWT_SECRET);

  await db.$client.prepare(
    `INSERT INTO patient_magic_links (patient_id, email, token_hash, expires_at, tenant_id, created_at)
     VALUES (?, ?, ?, datetime('now', '+15 minutes'), ?, datetime('now', '+6 hours'))`
  ).bind(patient.id, normalizedEmail, token, tenantId).run();

  try {
    const tenant = await db.$client.prepare(
      'SELECT name, subdomain FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ name: string | null; subdomain: string | null }>();
    const loginUrl = `/patient/login?token=${encodeURIComponent(token)}`;
    const template = EmailTemplates.magicLink({
      patientName: patient.name ?? 'Patient',
      loginUrl,
      hospitalName: tenant?.name ?? 'Ozzyl Health',
    });
    await sendEmail(c.env, {
      to: normalizedEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  } catch (error) {
    console.error('[PATIENT PORTAL] Failed to send magic link email:', error);
  }

  try {
    const currentCount = Number(await c.env.KV.get(rateKey) ?? '0');
    await c.env.KV.put(rateKey, String(currentCount + 1), {
      expirationTtl: MAGIC_LINK_RATE_LIMIT_WINDOW_SECONDS,
    });
  } catch {
    // Non-critical
  }

  return c.json({
    message: 'Login link sent to your email address.',
  });
});

patientPortalRoutes.post('/verify-email', zValidator('json', verifyMagicLinkSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { token } = c.req.valid('json');

  let decoded: { patientId?: string; userId?: string; tenantId?: string; email?: string | null; purpose?: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as typeof decoded;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired verification link' });
  }

  if (decoded?.purpose !== 'patient_portal_magic_link' || !decoded.patientId || !decoded.tenantId) {
    throw new HTTPException(401, { message: 'Invalid or expired verification link' });
  }

  const patient = await db.$client.prepare(
    `SELECT id, name, email
     FROM patients
     WHERE id = ? AND tenant_id = ?
     LIMIT 1`
  ).bind(decoded.patientId, decoded.tenantId).first<{ id: number; name: string | null; email: string | null }>();

  if (!patient) {
    throw new HTTPException(404, { message: 'Patient not found' });
  }

  const portalToken = await signPatientPortalToken(c.env, {
    userId: String(patient.id),
    patientId: String(patient.id),
    tenantId: String(decoded.tenantId),
    email: patient.email ?? decoded.email ?? null,
  });

  return c.json({
    message: 'Email verified successfully',
    token: portalToken,
    patient: {
      id: patient.id,
      name: patient.name,
      email: patient.email,
    },
  });
});

patientPortalRoutes.post('/register', zValidator('json', patientRegisterSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = c.get('tenantId') as string;
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    `SELECT id, name, email
     FROM patients
     WHERE email = ? AND tenant_id = ?
     LIMIT 1`
  ).bind(data.email.trim().toLowerCase(), tenantId).first<{ id: number; name: string | null; email: string | null }>();

  let patientId = existing?.id ?? null;
  let patientName = existing?.name ?? data.name;
  let patientEmail = existing?.email ?? data.email.trim().toLowerCase();

  if (!patientId) {
    const patientCode = await getNextSequence(c.env.DB, tenantId, 'patient', 'P');
    const normalizedEmail = data.email.trim().toLowerCase();
    const patientPayload = buildLocalSyncPatientPayload({
      tenantId,
      name: data.name,
      fatherHusband: '',
      address: data.address ?? '',
      mobile: data.mobile ?? null,
      email: normalizedEmail,
      patientCode,
      dateOfBirth: data.date_of_birth ?? null,
      gender: data.gender ?? null,
    });
    const patientInsertStatement = db.$client.prepare(
      `INSERT INTO patients (
         name, father_husband, email, mobile, date_of_birth, gender,
         address, patient_code, tenant_id, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))`
    ).bind(
      data.name,
      '',
      normalizedEmail,
      data.mobile ?? null,
      data.date_of_birth ?? null,
      data.gender ?? null,
      data.address ?? '',
      patientCode,
      tenantId,
    );
    const patientStatements: D1PreparedStatement[] = [patientInsertStatement];
    const patientOutboxStatement = await buildLocalSyncPatientCreateOutboxStatement(c.env, {
      tenantId,
      patientCode,
      payload: patientPayload,
    });
    if (patientOutboxStatement) patientStatements.push(patientOutboxStatement);
    const [patientInsertResult] = await c.env.DB.batch(patientStatements);

    let createdPatientId = Number(patientInsertResult?.meta?.last_row_id ?? 0);
    if (!Number.isInteger(createdPatientId) || createdPatientId <= 0) {
      const createdPatient = await db.$client.prepare(
        `SELECT id
         FROM patients
         WHERE tenant_id = ? AND patient_code = ?
         LIMIT 1`
      ).bind(tenantId, patientCode).first<{ id: number }>();
      createdPatientId = Number(createdPatient?.id ?? 0);
    }
    if (!Number.isInteger(createdPatientId) || createdPatientId <= 0) {
      throw new HTTPException(500, { message: 'Patient portal registration linkage failed' });
    }
    patientId = createdPatientId;
  }

  const existingCred = await db.$client.prepare(
    `SELECT id
     FROM patient_portal_credentials
     WHERE patient_id = ? AND tenant_id = ?
     LIMIT 1`
  ).bind(patientId, tenantId).first<{ id: number }>();

  if (!existingCred) {
    await db.$client.prepare(
      `INSERT INTO patient_portal_credentials (patient_id, user_id, tenant_id, created_at)
       VALUES (?, ?, ?, datetime('now', '+6 hours'))`
    ).bind(patientId, patientId, tenantId).run();
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const verificationToken = await sign({
    patientId: String(patientId),
    userId: String(patientId),
    tenantId,
    email: patientEmail,
    purpose: 'patient_portal_magic_link',
    iat: issuedAt,
    exp: issuedAt + 60 * 15,
  } as Record<string, unknown>, c.env.JWT_SECRET);

  try {
    const tenant = await db.$client.prepare(
      'SELECT name FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ name: string | null }>();
    const verifyUrl = `/patient/login?token=${encodeURIComponent(verificationToken)}`;
    const template = EmailTemplates.verifyRegistration({
      patientName,
      verifyUrl,
      hospitalName: tenant?.name ?? 'Ozzyl Health',
    });
    await sendEmail(c.env, {
      to: patientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  } catch (error) {
    console.error('[PATIENT PORTAL] Failed to send registration verification email:', error);
  }

  return c.json({
    message: 'Registration successful. Please check your email for the verification link.',
    patientId,
  }, 201);
});

patientPortalRoutes.post('/refresh-token', async (c) => {
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = getCookie(c, 'phr_token') || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId?: string; patientId?: string; tenantId?: string; role?: string; email?: string | null };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as typeof decoded;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired session' });
  }

  if (decoded.role && decoded.role !== 'patient') {
    throw new HTTPException(403, { message: 'Patient role required' });
  }

  if (!decoded.userId || !decoded.tenantId) {
    throw new HTTPException(401, { message: 'Invalid or expired session' });
  }

  const nextToken = await signPatientPortalToken(c.env, {
    userId: String(decoded.userId),
    patientId: String(decoded.patientId ?? decoded.userId),
    tenantId: String(decoded.tenantId),
    email: decoded.email ?? null,
  });

  return c.json({ token: nextToken });
});

patientPortalRoutes.use('/me', globalPatientAuthMiddleware);
patientPortalRoutes.use('/dashboard', globalPatientAuthMiddleware);
patientPortalRoutes.use('/live-visit-status', globalPatientAuthMiddleware);
patientPortalRoutes.use('/appointments', globalPatientAuthMiddleware);
patientPortalRoutes.use('/available-doctors', globalPatientAuthMiddleware);
patientPortalRoutes.use('/available-slots/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/book-appointment', globalPatientAuthMiddleware);
patientPortalRoutes.use('/cancel-appointment/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/prescriptions', globalPatientAuthMiddleware);
patientPortalRoutes.use('/prescriptions/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/documents', globalPatientAuthMiddleware);
patientPortalRoutes.use('/documents/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/upload-document', globalPatientAuthMiddleware);
patientPortalRoutes.use('/upload-document/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/medical-records', globalPatientAuthMiddleware);
patientPortalRoutes.use('/medical-records/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/diagnoses', globalPatientAuthMiddleware);
patientPortalRoutes.use('/food-diary', globalPatientOwnedDataMiddleware);
patientPortalRoutes.use('/lab-results', globalPatientAuthMiddleware);
patientPortalRoutes.use('/notifications', globalPatientAuthMiddleware);
patientPortalRoutes.use('/notifications/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/bills', globalPatientAuthMiddleware);
patientPortalRoutes.use('/vitals', globalPatientAuthMiddleware);
patientPortalRoutes.use('/visits', globalPatientAuthMiddleware);
patientPortalRoutes.use('/messages', globalPatientAuthMiddleware);
patientPortalRoutes.use('/messages/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/refill-requests', globalPatientAuthMiddleware);
patientPortalRoutes.use('/timeline', globalPatientAuthMiddleware);
patientPortalRoutes.use('/family', globalPatientAuthMiddleware);
patientPortalRoutes.use('/family/*', globalPatientAuthMiddleware);
patientPortalRoutes.use('/health-tips', globalPatientAuthMiddleware);
patientPortalRoutes.use('/health-tips/*', globalPatientAuthMiddleware);

// ─── Profile ────────────────────────────────────────────────────────────

/**
 * GET /me — Patient profile
 */
patientPortalRoutes.get('/me', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');

  const patient = await db.$client.prepare(
    `SELECT id, name, patient_code, email, mobile, guardian_mobile,
            father_husband, age, gender, blood_group, address, date_of_birth,
            created_at
     FROM patients WHERE id = ? AND tenant_id = ?`
  ).bind(patientId, tenantId).first();

  if (!patient) {
    throw new HTTPException(404, { message: 'Patient not found' });
  }

  await auditLog(c.env.DB, patientId, 'view_profile', tenantId);
  return c.json(patient);
});

const updateProfileSchema = z.object({
  mobile: z.string().min(1).max(20).optional(),
  guardian_mobile: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  email: z.string().email().optional(),
});

/**
 * PATCH /me — Update profile (limited fields)
 */
patientPortalRoutes.patch(
  '/me',
  zValidator('json', updateProfileSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const patientId = c.get('patientId');
    const tenantId = c.get('tenantId');
    const data = c.req.valid('json');

    const sets: string[] = [];
    const values: (string | number | undefined)[] = [];

    if (data.mobile !== undefined) { sets.push('mobile = ?'); values.push(data.mobile); }
    if (data.guardian_mobile !== undefined) { sets.push('guardian_mobile = ?'); values.push(data.guardian_mobile); }
    if (data.address !== undefined) { sets.push('address = ?'); values.push(data.address); }
    if (data.email !== undefined) { sets.push('email = ?'); values.push(data.email); }

    if (sets.length === 0) {
      throw new HTTPException(400, { message: 'No fields to update' });
    }

    sets.push("updated_at = datetime('now', '+6 hours')");
    values.push(patientId, tenantId);

    await db.$client.prepare(
      `UPDATE patients SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();

    await auditLog(c.env.DB, patientId, 'edit_profile', tenantId);
    return c.json({ message: 'Profile updated successfully' });
  }
);

// ─── Notifications ────────────────────────────────────────────────────

patientPortalRoutes.get('/notifications', async (c) => {
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);
  const unreadOnly = c.req.query('unread') === 'true';
  const unreadClause = unreadOnly ? ' AND is_read = 0' : '';

  const rows = await c.env.DB.prepare(`
    SELECT id, category, title, message, link, metadata_json,
           is_read, read_at, created_at
    FROM patient_portal_notifications
    WHERE tenant_id = ? AND patient_id = ?${unreadClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, patientId, limit, offset).all<Record<string, unknown>>();
  const count = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM patient_portal_notifications
    WHERE tenant_id = ? AND patient_id = ?${unreadClause}
  `).bind(tenantId, patientId).first<{ total: number }>();
  const unread = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM patient_portal_notifications
    WHERE tenant_id = ? AND patient_id = ? AND is_read = 0
  `).bind(tenantId, patientId).first<{ total: number }>();

  const data = (rows.results ?? []).map((row) => {
    let metadata: unknown = {};
    try {
      metadata = JSON.parse(String(row.metadata_json ?? '{}'));
    } catch {
      metadata = {};
    }
    const { metadata_json: _metadataJson, ...notification } = row;
    return { ...notification, metadata };
  });

  await auditLog(c.env.DB, patientId, 'view_notifications', tenantId);
  return c.json({
    ...paginatedResponse(data, Number(count?.total ?? 0), page, limit),
    unreadCount: Number(unread?.total ?? 0),
  });
});

patientPortalRoutes.put('/notifications/:id/read', async (c) => {
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const notificationId = Number(c.req.param('id'));
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    throw new HTTPException(400, { message: 'Invalid notification id' });
  }

  const updated = await c.env.DB.prepare(`
    UPDATE patient_portal_notifications
    SET is_read = 1, read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
    WHERE id = ? AND tenant_id = ? AND patient_id = ?
  `).bind(notificationId, tenantId, patientId).run();
  if (Number(updated.meta?.changes ?? 0) !== 1) {
    throw new HTTPException(404, { message: 'Notification not found' });
  }

  await auditLog(c.env.DB, patientId, 'read_notification', tenantId);
  return c.json({ ok: true });
});

// ─── Dashboard ──────────────────────────────────────────────────────────

/**
 * GET /dashboard — Aggregated summary
 */
patientPortalRoutes.get('/dashboard', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');

  const nextAppointment = await db.$client.prepare(
    `SELECT a.*, d.name as doctor_name
     FROM appointments a
     LEFT JOIN doctors d ON d.id = a.doctor_id
     WHERE a.patient_id = ? AND a.tenant_id = ?
       AND a.status = 'scheduled' AND a.appt_date >= date('now', '+6 hours')
     ORDER BY a.appt_date ASC, a.appt_time ASC
     LIMIT 1`
  ).bind(patientId, tenantId).first();

  const latestLabResult = await db.$client.prepare(
    `SELECT lo.id, lo.order_no, lo.created_at, lo.status,
            GROUP_CONCAT(ltc.name, ', ') as test_names
     FROM lab_orders lo
     JOIN lab_order_items loi ON loi.lab_order_id = lo.id
     LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
     WHERE lo.patient_id = ? AND lo.tenant_id = ?
     GROUP BY lo.id
     ORDER BY lo.created_at DESC LIMIT 1`
  ).bind(patientId, tenantId).first();

  const rxCount = await db.$client.prepare(
    `SELECT COUNT(*) as cnt FROM prescriptions
     WHERE patient_id = ? AND tenant_id = ? AND status = 'final'`
  ).bind(patientId, tenantId).first<{ cnt: number }>();

  const balance = await db.$client.prepare(
    `SELECT COALESCE(SUM(total - paid), 0) as total_due,
            COALESCE(SUM(paid), 0) as total_paid,
            COALESCE(SUM(total), 0) as total_billed
     FROM bills WHERE patient_id = ? AND tenant_id = ?`
  ).bind(patientId, tenantId).first<{ total_due: number; total_paid: number; total_billed: number }>();

  const visitCount = await db.$client.prepare(
    `SELECT COUNT(*) as cnt FROM appointments
     WHERE patient_id = ? AND tenant_id = ? AND status = 'completed'`
  ).bind(patientId, tenantId).first<{ cnt: number }>();

  await auditLog(c.env.DB, patientId, 'view_dashboard', tenantId);

  return c.json({
    nextAppointment,
    latestLabResult,
    activePrescriptions: rxCount?.cnt ?? 0,
    billing: {
      totalDue: balance?.total_due ?? 0,
      totalPaid: balance?.total_paid ?? 0,
      totalBilled: balance?.total_billed ?? 0,
    },
    totalVisits: visitCount?.cnt ?? 0,
  });
});

/**
 * GET /live-visit-status — derive patient-facing booking + queue status
 */
patientPortalRoutes.get('/live-visit-status', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const today = new Date().toISOString().split('T')[0];

  const appointment = await db.$client.prepare(
    `SELECT a.id, a.appt_date, a.appt_time, a.status, a.token_no, a.chief_complaint,
            d.name as doctor_name, d.specialty as doctor_specialization
     FROM appointments a
     LEFT JOIN doctors d ON d.id = a.doctor_id
     WHERE a.patient_id = ? AND a.tenant_id = ?
       AND a.status IN ('scheduled', 'confirmed', 'booked', 'checked_in', 'in_progress', 'completed')
       AND a.appt_date >= ?
     ORDER BY a.appt_date ASC, a.appt_time ASC
     LIMIT 1`
  ).bind(patientId, tenantId, today).first<{
    id: number;
    appt_date: string;
    appt_time: string | null;
    status: string | null;
    token_no: number | null;
    chief_complaint: string | null;
    doctor_name: string | null;
    doctor_specialization: string | null;
  }>();

  if (!appointment) {
    return c.json({ live_visit: null });
  }

  const visit = await db.$client.prepare(
    `SELECT id, status, visit_date, updated_at
     FROM visits
     WHERE tenant_id = ? AND patient_id = ?
       AND visit_date = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  ).bind(tenantId, patientId, appointment.appt_date).first<{
    id: number;
    status: string;
    visit_date: string | null;
    updated_at: string | null;
  }>();

  const queueEntry = await db.$client.prepare(
    `SELECT id, token_no, token_number, status, estimated_wait_minutes, counter_no,
            called_at, serve_start_time, serve_end_time, updated_at
     FROM queue_entries
     WHERE tenant_id = ? AND patient_id = ? AND queue_date = date('now', '+6 hours')
       AND status IN ('waiting', 'called', 'serving', 'completed', 'no_show')
     ORDER BY token_number ASC
     LIMIT 1`
  ).bind(tenantId, patientId).first<{
    id: number;
    token_no: string;
    token_number: number;
    status: 'waiting' | 'called' | 'serving' | 'completed' | 'no_show';
    estimated_wait_minutes: number | null;
    counter_no: string | null;
    called_at: string | null;
    serve_start_time: string | null;
    serve_end_time: string | null;
    updated_at: string | null;
  }>();

  const { results: queueContextRows } = await db.$client.prepare(
    `SELECT token_no, token_number, status
     FROM queue_entries
     WHERE tenant_id = ? AND queue_date = date('now', '+6 hours')
       AND status IN ('waiting', 'called', 'serving')
     ORDER BY token_number ASC`
  ).bind(tenantId).all<{
    token_no: string;
    token_number: number;
    status: 'waiting' | 'called' | 'serving';
  }>();

  const currentServing = (queueContextRows ?? []).find((row) => row.status === 'serving' || row.status === 'called') ?? null;
  const waitingAheadCount = queueEntry
    ? (queueContextRows ?? []).filter((row) => Number(row.token_number) < Number(queueEntry.token_number)).length
    : 0;

  const liveVisit = derivePatientLiveVisit({
    appointment: {
      id: appointment.id,
      appt_date: appointment.appt_date,
      appt_time: appointment.appt_time,
      doctor_name: appointment.doctor_name,
      status: appointment.status,
    },
    queueEntry: queueEntry
      ? {
          id: queueEntry.id,
          token_no: queueEntry.token_no,
          token_number: queueEntry.token_number,
          status: queueEntry.status,
          estimated_wait_minutes: queueEntry.estimated_wait_minutes,
          counter_no: queueEntry.counter_no,
          called_at: queueEntry.called_at,
          serve_start_time: queueEntry.serve_start_time,
          serve_end_time: queueEntry.serve_end_time,
          updated_at: queueEntry.updated_at,
        }
      : null,
    visit: visit
      ? {
          id: visit.id,
          status: visit.status,
          visit_date: visit.visit_date,
          updated_at: visit.updated_at,
        }
      : null,
    currentServingTokenNo: currentServing?.token_no ?? null,
    waitingAheadCount,
  });

  await auditLog(c.env.DB, patientId, 'view_live_visit_status', tenantId);
  return c.json({
    live_visit: {
      ...liveVisit,
      appointment_status: appointment.status ?? 'scheduled',
      doctor_specialization: appointment.doctor_specialization ?? null,
      chief_complaint: appointment.chief_complaint ?? null,
    },
  });
});

// ─── Appointments (paginated) ───────────────────────────────────────────

patientPortalRoutes.get('/appointments', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM appointments WHERE patient_id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT a.id, a.appt_no, a.token_no, a.appt_date, a.appt_time,
            a.visit_type, a.status, a.chief_complaint, a.fee,
            d.name as doctor_name, d.specialty as doctor_specialization,
            (
              SELECT q.status
              FROM queue_entries q
              WHERE q.tenant_id = a.tenant_id
                AND q.patient_id = a.patient_id
                AND q.queue_date = a.appt_date
              ORDER BY q.updated_at DESC, q.id DESC
              LIMIT 1
            ) as queue_status,
            (
              SELECT q.token_no
              FROM queue_entries q
              WHERE q.tenant_id = a.tenant_id
                AND q.patient_id = a.patient_id
                AND q.queue_date = a.appt_date
              ORDER BY q.updated_at DESC, q.id DESC
              LIMIT 1
            ) as live_token_no,
            (
              SELECT q.counter_no
              FROM queue_entries q
              WHERE q.tenant_id = a.tenant_id
                AND q.patient_id = a.patient_id
                AND q.queue_date = a.appt_date
              ORDER BY q.updated_at DESC, q.id DESC
              LIMIT 1
            ) as live_counter_no,
            (
              SELECT q.estimated_wait_minutes
              FROM queue_entries q
              WHERE q.tenant_id = a.tenant_id
                AND q.patient_id = a.patient_id
                AND q.queue_date = a.appt_date
              ORDER BY q.updated_at DESC, q.id DESC
              LIMIT 1
            ) as live_estimated_wait_minutes,
            (
              SELECT q.updated_at
              FROM queue_entries q
              WHERE q.tenant_id = a.tenant_id
                AND q.patient_id = a.patient_id
                AND q.queue_date = a.appt_date
              ORDER BY q.updated_at DESC, q.id DESC
              LIMIT 1
            ) as live_queue_updated_at,
            (
              SELECT v.status
              FROM visits v
              WHERE v.tenant_id = a.tenant_id
                AND v.patient_id = a.patient_id
                AND v.visit_date = a.appt_date
              ORDER BY v.updated_at DESC, v.id DESC
              LIMIT 1
            ) as visit_status,
            (
              SELECT v.updated_at
              FROM visits v
              WHERE v.tenant_id = a.tenant_id
                AND v.patient_id = a.patient_id
                AND v.visit_date = a.appt_date
              ORDER BY v.updated_at DESC, v.id DESC
              LIMIT 1
            ) as visit_updated_at
     FROM appointments a
     LEFT JOIN doctors d ON d.id = a.doctor_id
     WHERE a.patient_id = ? AND a.tenant_id = ?
     ORDER BY a.appt_date DESC, a.appt_time DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  await auditLog(c.env.DB, patientId, 'view_appointments', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

// ─── Prescriptions (paginated) ──────────────────────────────────────────

patientPortalRoutes.get('/prescriptions', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM prescriptions WHERE patient_id = ? AND tenant_id = ? AND status = 'final'`
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT p.id, p.rx_no, p.diagnosis, p.chief_complaint, p.advice,
            p.follow_up_date, p.bp, p.temperature, p.weight, p.spo2,
            p.created_at, p.status,
            d.name as doctor_name, d.specialty as doctor_specialization
     FROM prescriptions p
     LEFT JOIN doctors d ON d.id = p.doctor_id
     WHERE p.patient_id = ? AND p.tenant_id = ? AND p.status = 'final'
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  await auditLog(c.env.DB, patientId, 'view_prescriptions', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

/**
 * GET /prescriptions/:id — Patient-safe prescription detail with medicine items
 */
patientPortalRoutes.get('/prescriptions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const prescriptionId = c.req.param('id');

  const prescription = await db.$client.prepare(
    `SELECT p.id, p.rx_no, p.diagnosis, p.chief_complaint, p.advice,
            p.follow_up_date, p.bp, p.temperature, p.weight, p.spo2,
            p.created_at, p.status,
            d.name as doctor_name, d.specialty as doctor_specialization
     FROM prescriptions p
     LEFT JOIN doctors d ON d.id = p.doctor_id
     WHERE p.id = ? AND p.patient_id = ? AND p.tenant_id = ? AND p.status = 'final'
     LIMIT 1`
  ).bind(prescriptionId, patientId, tenantId).first<Record<string, unknown>>();

  if (!prescription) {
    throw new HTTPException(404, { message: 'Prescription not found' });
  }

  const { results: items } = await db.$client.prepare(
    `SELECT pi.id, pi.medicine_name, pi.dosage, pi.frequency, pi.duration, pi.instructions, pi.sort_order
     FROM prescription_items pi
     JOIN prescriptions p ON pi.prescription_id = p.id AND p.tenant_id = ? AND p.status = 'final'
     WHERE pi.prescription_id = ?
       AND LOWER(COALESCE(pi.status, 'active')) NOT IN ('replaced', 'void', 'voided', 'cancelled', 'canceled', 'deleted')
     ORDER BY pi.sort_order, pi.id`
  ).bind(tenantId, prescriptionId).all();

  const actions = {
    detail_url: `/api/patient-portal/prescriptions/${prescriptionId}`,
    items_url: `/api/patient-portal/prescriptions/${prescriptionId}/items`,
    pdf_url: `/api/patient-portal/prescriptions/${prescriptionId}/pdf`,
    refill_url: `/api/patient-portal/prescriptions/${prescriptionId}/refill`,
    share_text: `Prescription ${String(prescription.rx_no ?? prescriptionId)}`,
  };

  await auditLog(c.env.DB, patientId, 'view_prescription_detail', tenantId);
  return c.json({ prescription, items: items ?? [], actions });
});

/**
 * GET /prescriptions/:id/items — Prescription medicine items
 */
patientPortalRoutes.get('/prescriptions/:id/items', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const prescriptionId = c.req.param('id');

  const rx = await db.$client.prepare(
    `SELECT id FROM prescriptions
     WHERE id = ? AND patient_id = ? AND tenant_id = ? AND status = 'final'`
  ).bind(prescriptionId, patientId, tenantId).first();

  if (!rx) {
    throw new HTTPException(404, { message: 'Prescription not found' });
  }

  const { results } = await db.$client.prepare(
    `SELECT pi.id, pi.medicine_name, pi.dosage, pi.frequency, pi.duration, pi.instructions, pi.sort_order
     FROM prescription_items pi
     JOIN prescriptions p ON pi.prescription_id = p.id AND p.tenant_id = ? AND p.status = 'final'
     WHERE pi.prescription_id = ? ORDER BY pi.sort_order`
  ).bind(tenantId, prescriptionId).all();

  await auditLog(c.env.DB, patientId, 'view_prescription_items', tenantId);
  return c.json({ items: results ?? [] });
});

// ─── Lab Results (paginated + explanations) ─────────────────────────────

patientPortalRoutes.get('/lab-results', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM lab_orders lo
     JOIN lab_order_items loi ON loi.lab_order_id = lo.id
     WHERE lo.patient_id = ? AND lo.tenant_id = ?
       AND LOWER(COALESCE(lo.status, '')) IN ('verified', 'released', 'completed', 'final')
       AND LOWER(COALESCE(loi.sample_status, '')) NOT IN ('draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided')`
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT lo.id, lo.order_no, lo.created_at, lo.status,
            ltc.name as test_name, loi.result, loi.result_numeric, loi.abnormal_flag,
            loi.sample_status,
            ltc.unit, ltc.normal_range
     FROM lab_orders lo
     JOIN lab_order_items loi ON loi.lab_order_id = lo.id
     LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
     WHERE lo.patient_id = ? AND lo.tenant_id = ?
       AND LOWER(COALESCE(lo.status, '')) IN ('verified', 'released', 'completed', 'final')
       AND LOWER(COALESCE(loi.sample_status, '')) NOT IN ('draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided')
     ORDER BY lo.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  // Enrich with patient-friendly explanations
  const enriched = (results ?? []).map((row: any) => {
    const { severity, explanation } = labExplanation(row.abnormal_flag, row.test_name);
    return { ...row, severity, explanation };
  });

  await auditLog(c.env.DB, patientId, 'view_lab_results', tenantId);
  return c.json(paginatedResponse(enriched, countResult?.total ?? 0, page, limit));
});

patientPortalRoutes.get('/lab-results/:id', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const orderId = c.req.param('id');

  const order = await db.$client.prepare(
    `SELECT lo.id, lo.order_no, lo.created_at, lo.status
     FROM lab_orders lo
     WHERE lo.id = ? AND lo.patient_id = ? AND lo.tenant_id = ?
       AND LOWER(COALESCE(lo.status, '')) IN ('verified', 'released', 'completed', 'final')
     LIMIT 1`
  ).bind(orderId, patientId, tenantId).first<Record<string, unknown>>();

  if (!order) {
    throw new HTTPException(404, { message: 'Lab result not found' });
  }

  const { results: items } = await db.$client.prepare(
    `SELECT loi.id, loi.result, loi.result_numeric, loi.abnormal_flag, loi.sample_status,
            ltc.name as test_name, ltc.unit, ltc.normal_range
     FROM lab_order_items loi
     JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ?
     LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
     WHERE loi.lab_order_id = ?
       AND LOWER(COALESCE(lo.status, '')) IN ('verified', 'released', 'completed', 'final')
       AND LOWER(COALESCE(loi.sample_status, '')) NOT IN ('draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided')
     ORDER BY loi.id`
  ).bind(tenantId, orderId).all();

  const enrichedItems = (items ?? []).map((item: any) => {
    const { severity, explanation } = labExplanation(item.abnormal_flag, item.test_name);
    return { ...item, severity, explanation };
  });

  const actions = {
    pdf_url: `/api/patient-portal/lab-results/${orderId}/pdf`,
    share_text: `Lab result ${String(order.order_no ?? orderId)}`,
  };

  await auditLog(c.env.DB, patientId, 'view_lab_result_detail', tenantId);
  return c.json({ order, items: enrichedItems, actions });
});

// ─── Bills (paginated) ──────────────────────────────────────────────────

patientPortalRoutes.get('/bills', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM bills WHERE patient_id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT id, invoice_no, total, paid,
            (total - paid) as due, discount, status,
            created_at
     FROM bills WHERE patient_id = ? AND tenant_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  await auditLog(c.env.DB, patientId, 'view_bills', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

patientPortalRoutes.get('/bills/:id', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const billId = c.req.param('id');

  const bill = await db.$client.prepare(
    `SELECT id, invoice_no, total, paid,
            (total - paid) as due, discount, status,
            created_at
     FROM bills
     WHERE id = ? AND patient_id = ? AND tenant_id = ?
     LIMIT 1`
  ).bind(billId, patientId, tenantId).first<Record<string, unknown>>();

  if (!bill) {
    throw new HTTPException(404, { message: 'Bill not found' });
  }

  const actions = {
    receipt_url: null,
    payment_enabled: false,
    payment_message: 'Online payment is coming soon. Please contact the hospital billing counter for payment or receipt support.',
  };

  await auditLog(c.env.DB, patientId, 'view_bill_detail', tenantId);
  return c.json({ bill, actions });
});

// ─── Vitals (paginated) ─────────────────────────────────────────────────

patientPortalRoutes.get('/vitals', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM patient_vitals WHERE patient_id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT id, systolic, diastolic, temperature, heart_rate, spo2,
            respiratory_rate, weight, notes, recorded_at
     FROM patient_vitals
     WHERE patient_id = ? AND tenant_id = ?
     ORDER BY recorded_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  await auditLog(c.env.DB, patientId, 'view_vitals', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

// ─── Visits (paginated) ─────────────────────────────────────────────────

patientPortalRoutes.get('/visits', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM visits WHERE patient_id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT v.id, v.created_at as visit_date, v.visit_type, v.visit_no,
            v.notes,
            d.name as doctor_name
     FROM visits v
     LEFT JOIN doctors d ON d.id = v.doctor_id
     WHERE v.patient_id = ? AND v.tenant_id = ?
     ORDER BY v.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  await auditLog(c.env.DB, patientId, 'view_visits', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

// ─── Available Doctors ──────────────────────────────────────────────────

/**
 * GET /available-doctors — List active doctors with specialties & fees
 */
patientPortalRoutes.get('/available-doctors', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = c.get('tenantId');

  const { results } = await db.$client.prepare(
    `SELECT id, name, specialty, consultation_fee
     FROM doctors
     WHERE tenant_id = ? AND is_active = 1
     ORDER BY name ASC`
  ).bind(tenantId).all();

  return c.json({ doctors: results ?? [] });
});


const PATIENT_CANCELLABLE_APPOINTMENT_STATUSES = new Set([
  'pending_approval',
  'scheduled',
  'confirmed',
  'booked',
]);

const PATIENT_NON_ACTIVE_APPOINTMENT_STATUSES = [
  'cancelled',
  'canceled',
  'completed',
  'no_show',
  'void',
  'voided',
];

function normalizeAppointmentStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePatientAppointmentTime(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function normalizePatientBookedTimes(rows: Array<{ appt_time?: unknown }> | null | undefined): string[] {
  return (rows ?? [])
    .map((row) => normalizePatientAppointmentTime(row.appt_time))
    .filter(Boolean);
}

type PatientScheduleRow = {
  id?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  session_type?: string | null;
  chamber?: string | null;
  max_patients?: number | null;
};

type PatientAvailableSlot = {
  time: string;
  label: string;
  scheduleId: number | null;
  sessionType: string | null;
  chamber: string | null;
};

function getPatientPortalDayKey(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][parsed.getUTCDay()] ?? '';
}

function patientTimeToMinutes(value: unknown): number | null {
  const normalized = normalizePatientAppointmentTime(value);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function patientMinutesToTime(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildPatientAvailableSlots(
  scheduleRows: PatientScheduleRow[] | null | undefined,
  bookedSlots: Array<{ appt_time?: unknown }> | null | undefined,
): PatientAvailableSlot[] {
  const bookedTimes = new Set(normalizePatientBookedTimes(bookedSlots));
  const slots: PatientAvailableSlot[] = [];

  for (const row of scheduleRows ?? []) {
    const start = patientTimeToMinutes(row.start_time);
    const end = patientTimeToMinutes(row.end_time);
    if (start === null || end === null || end <= start) continue;
    const maxPatients = Math.max(1, Number(row.max_patients ?? 1) || 1);
    const interval = Math.max(5, Math.floor((end - start) / maxPatients));

    for (let index = 0; index < maxPatients; index += 1) {
      const slotMinutes = start + (index * interval);
      if (slotMinutes >= end) break;
      const time = patientMinutesToTime(slotMinutes);
      if (bookedTimes.has(time)) continue;
      slots.push({
        time,
        label: row.chamber ? `${time} · ${row.chamber}` : time,
        scheduleId: row.id ?? null,
        sessionType: row.session_type ?? null,
        chamber: row.chamber ?? null,
      });
    }
  }

  return slots;
}

async function loadPatientScheduleRows(
  db: ReturnType<typeof getDb>,
  input: { doctorId: number | string; tenantId: string | undefined; apptDate: string },
): Promise<PatientScheduleRow[]> {
  const dayKey = getPatientPortalDayKey(input.apptDate);
  if (!dayKey) return [];
  const { results } = await db.$client.prepare(
    `SELECT id, start_time, end_time, session_type, chamber, max_patients
     FROM doctor_schedules
     WHERE doctor_id = ? AND tenant_id = ? AND day_of_week = ? AND is_active = 1
     ORDER BY start_time ASC`,
  ).bind(input.doctorId, input.tenantId, dayKey).all<PatientScheduleRow>();
  return results ?? [];
}

async function loadPatientBookedSlots(
  db: ReturnType<typeof getDb>,
  input: { doctorId: number | string; tenantId: string | undefined; apptDate: string },
): Promise<Array<{ appt_time?: string | null; token_no?: number | null }>> {
  const { results } = await db.$client.prepare(
    `SELECT appt_time, token_no FROM appointments
     WHERE doctor_id = ? AND tenant_id = ? AND appt_date = ?
       AND LOWER(COALESCE(status, '')) NOT IN (${PATIENT_NON_ACTIVE_APPOINTMENT_STATUSES.map(() => '?').join(', ')})
     ORDER BY token_no ASC`,
  ).bind(input.doctorId, input.tenantId, input.apptDate, ...PATIENT_NON_ACTIVE_APPOINTMENT_STATUSES).all<{ appt_time?: string | null; token_no?: number | null }>();
  return results ?? [];
}

async function assertPatientAppointmentTimeWithinSchedule(
  db: ReturnType<typeof getDb>,
  input: { doctorId: number | string; tenantId: string | undefined; apptDate: string; apptTime?: string | null },
): Promise<void> {
  const requestedTime = normalizePatientAppointmentTime(input.apptTime);
  if (!requestedTime) return;
  const scheduleRows = await loadPatientScheduleRows(db, input);
  if (scheduleRows.length === 0) return;
  const bookedSlots = await loadPatientBookedSlots(db, input);
  const availableSlots = buildPatientAvailableSlots(scheduleRows, bookedSlots);
  if (!availableSlots.some((slot) => slot.time === requestedTime)) {
    throw new HTTPException(400, { message: 'Selected appointment time is outside the doctor schedule or capacity.' });
  }
}

async function assertPatientAppointmentTimeAvailable(
  db: ReturnType<typeof getDb>,
  input: { doctorId: number | string; tenantId: string | undefined; apptDate: string; apptTime?: string | null },
): Promise<void> {
  const requestedTime = normalizePatientAppointmentTime(input.apptTime);
  if (!requestedTime) return;

  const existing = await db.$client.prepare(
    `SELECT id FROM appointments
     WHERE doctor_id = ? AND tenant_id = ? AND appt_date = ? AND appt_time = ?
       AND LOWER(COALESCE(status, '')) NOT IN (${PATIENT_NON_ACTIVE_APPOINTMENT_STATUSES.map(() => '?').join(', ')})
     LIMIT 1`,
  ).bind(
    input.doctorId,
    input.tenantId,
    input.apptDate,
    requestedTime,
    ...PATIENT_NON_ACTIVE_APPOINTMENT_STATUSES,
  ).first();

  if (existing) {
    throw new HTTPException(409, { message: 'This appointment time is already booked. Choose another time.' });
  }
}

/**
 * GET /available-slots/:doctorId?date=YYYY-MM-DD — Show booked slots for a doctor on a date
 */
patientPortalRoutes.get('/available-slots/:doctorId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = c.get('tenantId');
  const doctorId = Number(c.req.param('doctorId'));
  const date = c.req.query('date');

  if (!Number.isFinite(doctorId) || doctorId < 1) {
    throw new HTTPException(400, { message: 'Invalid doctor ID' });
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HTTPException(400, { message: 'Valid date required (YYYY-MM-DD)' });
  }

  const doctor = await db.$client.prepare(
    'SELECT id FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1',
  ).bind(doctorId, tenantId).first<{ id: number }>();

  if (!doctor) {
    throw new HTTPException(404, { message: 'Doctor not found or unavailable' });
  }

  const scheduleRows = await loadPatientScheduleRows(db, { doctorId, tenantId, apptDate: date });
  const bookedSlots = await loadPatientBookedSlots(db, { doctorId, tenantId, apptDate: date });
  const availableSlots = buildPatientAvailableSlots(scheduleRows ?? [], bookedSlots ?? []);

  return c.json({
    doctorId,
    date,
    bookedCount: bookedSlots.length,
    bookedSlots: bookedSlots ?? [],
    bookedTimes: normalizePatientBookedTimes(bookedSlots ?? []),
    availableSlots,
    hasSchedule: (scheduleRows ?? []).length > 0,
    canRequestTime: availableSlots.length > 0 || scheduleRows.length === 0,
    scheduleWindows: scheduleRows.map((row) => ({
      id: row.id ?? null,
      startTime: row.start_time ?? null,
      endTime: row.end_time ?? null,
      sessionType: row.session_type ?? null,
      chamber: row.chamber ?? null,
      maxPatients: row.max_patients ?? null,
    })),
  });
});

// ─── Appointment Booking ────────────────────────────────────────────────

const bookAppointmentSchema = z.object({
  doctorId: z.number().int().positive(),
  apptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  apptTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM').optional(),
  visitType: z.enum(['opd', 'followup']).default('opd'),
  chiefComplaint: z.string().max(500).optional(),
});

/**
 * POST /book-appointment — Patient self-books an appointment
 */
patientPortalRoutes.post(
  '/book-appointment',
  zValidator('json', bookAppointmentSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const patientId = c.get('patientId');
    const tenantId = c.get('tenantId');
    const data = c.req.valid('json');

    if (!tenantId) {
      throw new HTTPException(400, { message: 'Tenant not identified' });
    }

    // Verify doctor exists and is active
    const doctor = await db.$client.prepare(
      'SELECT id, name, consultation_fee FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1'
    ).bind(data.doctorId, tenantId).first<{ id: number; name: string; consultation_fee: number }>();

    if (!doctor) {
      throw new HTTPException(404, { message: 'Doctor not found or unavailable' });
    }

    const consultationFee = normalizeConsultationFee(doctor.consultation_fee);

    // Prevent booking in the past
    const today = new Date().toISOString().split('T')[0];
    if (data.apptDate < today) {
      throw new HTTPException(400, { message: 'Cannot book appointments in the past' });
    }

    await assertPatientAppointmentTimeWithinSchedule(db, {
      doctorId: data.doctorId,
      tenantId,
      apptDate: data.apptDate,
      apptTime: data.apptTime,
    });

    await assertPatientAppointmentTimeAvailable(db, {
      doctorId: data.doctorId,
      tenantId,
      apptDate: data.apptDate,
      apptTime: data.apptTime,
    });

    // Check for duplicate active booking (same patient + doctor + date)
    const existing = await db.$client.prepare(
      `SELECT id FROM appointments
       WHERE patient_id = ? AND doctor_id = ? AND appt_date = ? AND tenant_id = ?
         AND LOWER(COALESCE(status, '')) NOT IN (${PATIENT_NON_ACTIVE_APPOINTMENT_STATUSES.map(() => '?').join(', ')})`
    ).bind(patientId, data.doctorId, data.apptDate, tenantId, ...PATIENT_NON_ACTIVE_APPOINTMENT_STATUSES).first();

    if (existing) {
      throw new HTTPException(409, { message: 'You already have an appointment with this doctor on this date' });
    }

    // Book with token generation + retry for concurrency
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const tokenRow = await db.$client.prepare(
          `SELECT COALESCE(MAX(token_no), 0) + 1 AS next_token
           FROM appointments
           WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ?`
        ).bind(tenantId, data.apptDate, data.doctorId).first<{ next_token: number }>();

        const tokenNo = tokenRow?.next_token ?? 1;
        const apptNo = await getNextSequence(c.env.DB, tenantId, 'appointment', 'APT');

        const result = await db.$client.prepare(
          `INSERT INTO appointments
            (appt_no, token_no, patient_id, doctor_id, appt_date, appt_time,
             visit_type, status, source, chief_complaint, fee, billing_status, created_by, tenant_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_approval', 'online', ?, ?, ?, ?, ?)`
        ).bind(
          apptNo,
          tokenNo,
          patientId,
          data.doctorId,
          data.apptDate,
          data.apptTime ?? null,
          data.visitType,
          data.chiefComplaint ?? null,
          consultationFee,
          consultationFee > 0 ? 'unpaid' : 'no_charge',
          patientId,
          tenantId,
        ).run();

        await auditLog(c.env.DB, patientId, 'book_appointment', tenantId);

        // Send booking confirmation email (non-blocking)
        c.executionCtx.waitUntil((async () => {
          try {
            const patient = await db.$client.prepare(
              'SELECT name, email FROM patients WHERE id = ? AND tenant_id = ?'
            ).bind(patientId, tenantId).first<{ name: string; email: string }>();

            if (patient?.email) {
              const tenant = await db.$client.prepare(
                'SELECT name FROM tenants WHERE id = ?'
              ).bind(tenantId).first<{ name: string }>();

              const emailContent = EmailTemplates.appointmentReminder({
                patientName: patient.name,
                doctorName: doctor.name,
                appointmentDate: data.apptDate,
                appointmentTime: data.apptTime ?? 'To be assigned',
                hospitalName: tenant?.name || 'Ozzyl Health',
              });

              await sendEmail(c.env, {
                to: patient.email,
                subject: `Appointment Confirmed — ${formatDoctorName(doctor.name)} on ${data.apptDate}`,
                html: emailContent.html,
                text: emailContent.text,
              });
            }
          } catch (err) {
            console.error('[BOOKING EMAIL] Failed to send confirmation:', err);
          }
        })());

        return c.json({
          message: 'Appointment booked successfully',
          appointment: {
            id: result.meta.last_row_id,
            apptNo,
            tokenNo,
            doctorName: doctor.name,
            date: data.apptDate,
            time: data.apptTime,
            fee: consultationFee,
          },
        }, 201);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (msg.includes('UNIQUE constraint') && attempt < maxRetries - 1) continue;
        if (error instanceof HTTPException) throw error;
        throw new HTTPException(500, { message: 'Failed to book appointment' });
      }
    }
    throw new HTTPException(500, { message: 'Failed to book appointment after retries' });
  }
);

/**
 * POST /cancel-appointment/:id — Patient cancels their own scheduled appointment
 */
patientPortalRoutes.post('/cancel-appointment/:id', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const appointmentId = c.req.param('id');

  const appt = await db.$client.prepare(
    `SELECT id, status, appt_date FROM appointments
     WHERE id = ? AND patient_id = ? AND tenant_id = ?`
  ).bind(appointmentId, patientId, tenantId).first<{ id: number; status: string; appt_date: string }>();

  if (!appt) {
    throw new HTTPException(404, { message: 'Appointment not found' });
  }

  if (!PATIENT_CANCELLABLE_APPOINTMENT_STATUSES.has(normalizeAppointmentStatus(appt.status))) {
    throw new HTTPException(400, { message: `Cannot cancel appointment with status '${appt.status}'` });
  }

  // Fetch appointment details before cancellation for the email
  const apptDetails = await db.$client.prepare(
    `SELECT a.appt_date, d.name as doctor_name
     FROM appointments a
     LEFT JOIN doctors d ON d.id = a.doctor_id
     WHERE a.id = ? AND a.tenant_id = ?`
  ).bind(appointmentId, tenantId).first<{ appt_date: string; doctor_name: string }>();

  await db.$client.prepare(
    `UPDATE appointments SET status = 'cancelled', updated_at = datetime('now', '+6 hours')
     WHERE id = ? AND tenant_id = ?`
  ).bind(appointmentId, tenantId).run();

  await auditLog(c.env.DB, patientId, 'cancel_appointment', tenantId);

  // Send cancellation notification email (non-blocking)
  c.executionCtx.waitUntil((async () => {
    try {
      const patient = await db.$client.prepare(
        'SELECT name, email FROM patients WHERE id = ? AND tenant_id = ?'
      ).bind(patientId, tenantId).first<{ name: string; email: string }>();

      if (patient?.email && apptDetails) {
        const tenant = await db.$client.prepare(
          'SELECT name FROM tenants WHERE id = ?'
        ).bind(tenantId).first<{ name: string }>();

        const emailContent = EmailTemplates.appointmentCancellation({
          patientName: patient.name,
          doctorName: apptDetails.doctor_name || 'Doctor',
          appointmentDate: apptDetails.appt_date,
          hospitalName: tenant?.name || 'Ozzyl Health',
        });

        await sendEmail(c.env, {
          to: patient.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      }
    } catch (err) {
      console.error('[CANCEL EMAIL] Failed to send cancellation notification:', err);
    }
  })());

  return c.json({ message: 'Appointment cancelled successfully' });
});

// ═══════════════════════════════════════════════════════════════════════════
// SPRINT 3: ADVANCED FEATURES
// ═══════════════════════════════════════════════════════════════════════════

// ─── Secure Messaging ───────────────────────────────────────────────────

/**
 * GET /messages — List conversations (grouped by doctor)
 */
patientPortalRoutes.get('/messages', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');

  const { results } = await db.$client.prepare(
    `SELECT d.id as doctor_id, d.name as doctor_name, d.specialty,
            MAX(pm.created_at) as last_message_at,
            SUM(CASE WHEN pm.is_read = 0 AND pm.sender_type = 'doctor' THEN 1 ELSE 0 END) as unread_count,
            (SELECT message FROM patient_messages pm2
             WHERE pm2.patient_id = pm.patient_id AND pm2.doctor_id = pm.doctor_id AND pm2.tenant_id = pm.tenant_id
             ORDER BY pm2.created_at DESC LIMIT 1) as last_message
     FROM patient_messages pm
     JOIN doctors d ON d.id = pm.doctor_id
     WHERE pm.patient_id = ? AND pm.tenant_id = ?
     GROUP BY pm.doctor_id
     ORDER BY last_message_at DESC`
  ).bind(patientId, tenantId).all();

  await auditLog(c.env.DB, patientId, 'view_messages', tenantId);
  return c.json({ conversations: results ?? [] });
});

/**
 * GET /messages/:doctorId — Get message thread with a doctor
 */
patientPortalRoutes.get('/messages/:doctorId', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const doctorId = Number(c.req.param('doctorId'));
  if (!Number.isFinite(doctorId) || doctorId < 1) {
    throw new HTTPException(400, { message: 'Invalid doctor ID' });
  }
  const { page, limit, offset } = parsePagination(c);

  // Mark unread messages from doctor as read
  await db.$client.prepare(
    `UPDATE patient_messages SET is_read = 1
     WHERE patient_id = ? AND doctor_id = ? AND tenant_id = ? AND sender_type = 'doctor' AND is_read = 0`
  ).bind(patientId, doctorId, tenantId).run();

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM patient_messages WHERE patient_id = ? AND doctor_id = ? AND tenant_id = ?'
  ).bind(patientId, doctorId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT id, sender_type, message, is_read, created_at
     FROM patient_messages
     WHERE patient_id = ? AND doctor_id = ? AND tenant_id = ?
     ORDER BY created_at ASC
     LIMIT ? OFFSET ?`
  ).bind(patientId, doctorId, tenantId, limit, offset).all();

  await auditLog(c.env.DB, patientId, 'view_message_thread', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

const sendMessageSchema = z.object({
  doctorId: z.number().int().positive(),
  message: z.string().min(1).max(2000),
});

/**
 * POST /messages — Send a message to a doctor
 */
patientPortalRoutes.post(
  '/messages',
  zValidator('json', sendMessageSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const patientId = c.get('patientId');
    const tenantId = c.get('tenantId');
    const { doctorId, message } = c.req.valid('json');

    // Verify doctor exists
    const doctor = await db.$client.prepare(
      'SELECT id FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1'
    ).bind(doctorId, tenantId).first();

    if (!doctor) {
      throw new HTTPException(404, { message: 'Doctor not found' });
    }

    // Rate limit: max 1 message per 30 seconds
    const lastMsg = await db.$client.prepare(
      `SELECT created_at FROM patient_messages
       WHERE patient_id = ? AND doctor_id = ? AND tenant_id = ? AND sender_type = 'patient'
       ORDER BY created_at DESC LIMIT 1`
    ).bind(patientId, doctorId, tenantId).first<{ created_at: string }>();

    if (lastMsg) {
      const elapsed = Date.now() - new Date(lastMsg.created_at + 'Z').getTime();
      if (elapsed < 30_000) {
        throw new HTTPException(429, { message: 'Please wait before sending another message' });
      }
    }

    await db.$client.prepare(
      `INSERT INTO patient_messages (patient_id, doctor_id, sender_type, message, tenant_id)
       VALUES (?, ?, 'patient', ?, ?)`
    ).bind(patientId, doctorId, message, tenantId).run();

    await auditLog(c.env.DB, patientId, 'send_message', tenantId);
    return c.json({ message: 'Message sent' }, 201);
  }
);

// ─── Prescription Refill Requests ───────────────────────────────────────

/**
 * POST /prescriptions/:id/refill — Request a refill
 */
patientPortalRoutes.post('/prescriptions/:id/refill', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const prescriptionId = c.req.param('id');

  // Verify prescription belongs to patient
  const rx = await db.$client.prepare(
    `SELECT id FROM prescriptions WHERE id = ? AND patient_id = ? AND tenant_id = ? AND status = 'final'`
  ).bind(prescriptionId, patientId, tenantId).first();

  if (!rx) {
    throw new HTTPException(404, { message: 'Prescription not found' });
  }

  // Check for existing pending refill
  const existing = await db.$client.prepare(
    `SELECT id FROM prescription_refill_requests
     WHERE prescription_id = ? AND patient_id = ? AND tenant_id = ? AND status = 'pending'`
  ).bind(prescriptionId, patientId, tenantId).first();

  if (existing) {
    throw new HTTPException(409, { message: 'A refill request is already pending for this prescription' });
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;

  await db.$client.prepare(
    `INSERT INTO prescription_refill_requests (prescription_id, patient_id, notes, tenant_id)
     VALUES (?, ?, ?, ?)`
  ).bind(prescriptionId, patientId, notes, tenantId).run();

  await auditLog(c.env.DB, patientId, 'request_refill', tenantId);
  return c.json({ message: 'Refill request submitted' }, 201);
});

/**
 * GET /refill-requests — List patient's refill requests
 */
patientPortalRoutes.get('/refill-requests', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM prescription_refill_requests WHERE patient_id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT rr.id, rr.status, rr.notes, rr.response_notes, rr.created_at, rr.responded_at,
            p.rx_no, p.diagnosis,
            d.name as doctor_name
     FROM prescription_refill_requests rr
     JOIN prescriptions p ON p.id = rr.prescription_id
     LEFT JOIN doctors d ON d.id = p.doctor_id
     WHERE rr.patient_id = ? AND rr.tenant_id = ?
     ORDER BY rr.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

// ─── Health Timeline ────────────────────────────────────────────────────

/**
 * GET /timeline — Unified chronological health timeline
 */
patientPortalRoutes.get('/timeline', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  // UNION ALL query to combine all health events
  const countResult = await db.$client.prepare(
    `SELECT (
      (SELECT COUNT(*) FROM appointments WHERE patient_id = ? AND tenant_id = ?) +
      (SELECT COUNT(*) FROM prescriptions WHERE patient_id = ? AND tenant_id = ? AND status = 'final') +
      (SELECT COUNT(*) FROM lab_orders WHERE patient_id = ? AND tenant_id = ?) +
      (SELECT COUNT(*) FROM bills WHERE patient_id = ? AND tenant_id = ?)
    ) as total`
  ).bind(patientId, tenantId, patientId, tenantId, patientId, tenantId, patientId, tenantId)
    .first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT * FROM (
      SELECT 'appointment' as event_type, a.id, a.appt_date as event_date,
             'Appointment with ' || COALESCE(d.name, 'Doctor') as title,
             a.status as detail, a.chief_complaint as description, '📅' as icon
      FROM appointments a LEFT JOIN doctors d ON d.id = a.doctor_id
      WHERE a.patient_id = ? AND a.tenant_id = ?

      UNION ALL

      SELECT 'prescription' as event_type, p.id, p.created_at as event_date,
             'Prescription #' || p.rx_no as title,
             p.diagnosis as detail, p.advice as description, '💊' as icon
      FROM prescriptions p
      WHERE p.patient_id = ? AND p.tenant_id = ? AND p.status = 'final'

      UNION ALL

      SELECT 'lab_order' as event_type, lo.id, lo.created_at as event_date,
             'Lab Order #' || lo.order_no as title,
             lo.status as detail, GROUP_CONCAT(COALESCE(ltc.name, 'Test #' || loi.lab_test_id), ', ') as description, '🧪' as icon
      FROM lab_orders lo
      JOIN lab_order_items loi ON loi.lab_order_id = lo.id
      LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
      WHERE lo.patient_id = ? AND lo.tenant_id = ?
      GROUP BY lo.id

      UNION ALL

      SELECT 'bill' as event_type, b.id, b.created_at as event_date,
             'Bill #' || COALESCE(b.invoice_no, b.id) as title,
             CASE WHEN b.due > 0 THEN 'Due: ৳' || b.due ELSE 'Paid' END as detail,
             'Total: ৳' || COALESCE(b.total_amount, b.total, 0) as description, '💰' as icon
      FROM bills b
      WHERE b.patient_id = ? AND b.tenant_id = ?
    ) timeline
    ORDER BY event_date DESC
    LIMIT ? OFFSET ?`
  ).bind(
    patientId, tenantId,
    patientId, tenantId,
    patientId, tenantId,
    patientId, tenantId,
    limit, offset,
  ).all();

  await auditLog(c.env.DB, patientId, 'view_timeline', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

// ─── Family Members ─────────────────────────────────────────────────────

/**
 * GET /family — List linked family members
 */
patientPortalRoutes.get('/family', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');

  const { results } = await db.$client.prepare(
    `SELECT fl.id as link_id, fl.relationship, fl.child_patient_id,
            p.name, p.patient_code, p.age, p.gender, p.blood_group
     FROM patient_family_links fl
     JOIN patients p ON p.id = fl.child_patient_id
     WHERE fl.parent_patient_id = ? AND fl.tenant_id = ?
     ORDER BY p.name ASC`
  ).bind(patientId, tenantId).all();

  return c.json({ familyMembers: results ?? [] });
});

const linkFamilySchema = z.object({
  patientCode: z.string().min(1),
  relationship: z.enum(['spouse', 'child', 'parent', 'sibling', 'other']),
});

/**
 * POST /family — Link a family member by patient code
 */
patientPortalRoutes.post(
  '/family',
  zValidator('json', linkFamilySchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const patientId = c.get('patientId');
    const tenantId = c.get('tenantId');
    const { patientCode, relationship } = c.req.valid('json');

    const member = await db.$client.prepare(
      'SELECT id, name FROM patients WHERE patient_code = ? AND tenant_id = ?'
    ).bind(patientCode, tenantId).first<{ id: number; name: string }>();

    if (!member) {
      throw new HTTPException(404, { message: 'Patient not found with this code' });
    }

    if (String(member.id) === patientId) {
      throw new HTTPException(400, { message: 'Cannot link yourself' });
    }

    try {
      await db.$client.prepare(
        `INSERT INTO patient_family_links (parent_patient_id, child_patient_id, relationship, tenant_id)
         VALUES (?, ?, ?, ?)`
      ).bind(patientId, member.id, relationship, tenantId).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UNIQUE constraint')) {
        throw new HTTPException(409, { message: 'This family member is already linked' });
      }
      throw err;
    }

    await auditLog(c.env.DB, patientId, 'link_family_member', tenantId);
    // Mask name to prevent info enumeration (first char + asterisks)
    const masked = member.name.charAt(0) + '***';
    return c.json({ message: `${masked} linked as ${relationship}` }, 201);
  }
);

/**
 * DELETE /family/:linkId — Unlink a family member
 */
patientPortalRoutes.delete('/family/:linkId', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const linkId = Number(c.req.param('linkId'));
  if (!Number.isFinite(linkId) || linkId < 1) {
    throw new HTTPException(400, { message: 'Invalid link ID' });
  }

  const link = await db.$client.prepare(
    'SELECT id FROM patient_family_links WHERE id = ? AND parent_patient_id = ? AND tenant_id = ?'
  ).bind(linkId, patientId, tenantId).first();

  if (!link) {
    throw new HTTPException(404, { message: 'Family link not found' });
  }

  await db.$client.prepare(
    'DELETE FROM patient_family_links WHERE id = ? AND tenant_id = ?'
  ).bind(linkId, tenantId).run();

  await auditLog(c.env.DB, patientId, 'unlink_family_member', tenantId);
  return c.json({ message: 'Family member unlinked' });
});

// ─── Document Upload ───────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const PATIENT_DOCUMENT_TYPES = new Set(['prescription', 'lab_report', 'discharge_summary', 'other']);

function normalizePatientDocumentType(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PATIENT_DOCUMENT_TYPES.has(normalized) ? normalized : 'other';
}

function buildPatientDocumentDownloadUrl(documentId: unknown): string | null {
  if (documentId === null || documentId === undefined || documentId === '') return null;
  return `/api/patient-portal/upload-document/${documentId}/download`;
}

function normalizePatientDocumentContract(row: Record<string, unknown>) {
  const documentType = normalizePatientDocumentType(row.document_type);
  const fileSize = typeof row.file_size === 'number'
    ? row.file_size
    : Number(row.file_size ?? 0);
  const uploadedByPatient = row.uploaded_by !== null
    && row.uploaded_by !== undefined
    && row.patient_id !== null
    && row.patient_id !== undefined
    && String(row.uploaded_by) === String(row.patient_id);
  const source = uploadedByPatient ? 'patient_upload' : 'hospital_record';
  const downloadUrl = buildPatientDocumentDownloadUrl(row.id);

  return {
    id: row.id,
    title: row.title ?? '',
    description: row.description ?? null,
    document_type: documentType,
    type: documentType,
    file_name: row.file_name ?? null,
    file_size: Number.isFinite(fileSize) ? fileSize : 0,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    mime_type: row.mime_type ?? null,
    mimeType: row.mime_type ?? null,
    created_at: row.created_at ?? null,
    date: row.created_at ?? null,
    source,
    source_label: source,
    download_url: downloadUrl,
    downloadUrl,
  };
}

/**
 * POST /upload-document — Patient uploads a medical document
 */
patientPortalRoutes.post('/upload-document', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');

  const formData = await c.req.formData();
  const file = formData.get('file');
  const title = formData.get('title');
  const documentType = normalizePatientDocumentType(formData.get('document_type') || 'other');
  const rawDescription = formData.get('description');
  const description = typeof rawDescription === 'string' && rawDescription.trim()
    ? rawDescription.trim()
    : null;

  if (!file || typeof file === 'string') {
    throw new HTTPException(400, { message: 'File is required' });
  }
  const uploadFile = file as unknown as File;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    throw new HTTPException(400, { message: 'Title is required' });
  }

  if (!ALLOWED_MIME_TYPES.includes(uploadFile.type)) {
    throw new HTTPException(400, { message: `File type not allowed. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` });
  }

  if (uploadFile.size > MAX_FILE_SIZE) {
    throw new HTTPException(400, { message: 'File size exceeds 5MB limit' });
  }

  const timestamp = Date.now();
  const sanitizedName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${tenantId}/patient-docs/${patientId}/${timestamp}_${sanitizedName}`;

  // Upload to R2
  await c.env.UPLOADS.put(key, uploadFile.stream(), {
    httpMetadata: { contentType: uploadFile.type },
  });

  // Insert into document_records
  const result = await db.$client.prepare(
    `INSERT INTO document_records (tenant_id, patient_id, document_type, title, description, file_key, file_name, file_size, mime_type, uploaded_by, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '+6 hours'))`
  ).bind(
    tenantId,
    patientId,
    documentType,
    title.trim(),
    description,
    key,
    uploadFile.name,
    uploadFile.size,
    uploadFile.type,
    patientId,
  ).run();

  const document = normalizePatientDocumentContract({
    id: result.meta.last_row_id,
    patient_id: patientId,
    uploaded_by: patientId,
    document_type: documentType,
    title: title.trim(),
    description,
    file_name: uploadFile.name,
    file_size: uploadFile.size,
    mime_type: uploadFile.type,
    created_at: null,
  });

  await auditLog(c.env.DB, patientId, 'upload_document', tenantId);

  return c.json({
    ...document,
    document,
  }, 201);
});

/**
 * GET /upload-document/:id/download — Download a document
 */
patientPortalRoutes.get('/upload-document/:id/download', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const documentId = c.req.param('id');

  const doc = await db.$client.prepare(
    `SELECT id, file_key, file_name, mime_type FROM document_records
     WHERE id = ? AND patient_id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(documentId, patientId, tenantId).first<{ id: number; file_key: string; file_name: string; mime_type: string }>();

  if (!doc) {
    throw new HTTPException(404, { message: 'Document not found' });
  }

  const object = await c.env.UPLOADS.get(doc.file_key);

  if (!object) {
    throw new HTTPException(404, { message: 'File not found in storage' });
  }

  await auditLog(c.env.DB, patientId, 'download_document', tenantId);

  return new Response(object.body, {
    headers: {
      'Content-Type': doc.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${doc.file_name}"`,
    },
  });
});

// ─── Medical Records (EHR Access) ─────────────────────────────────────

/**
 * GET /medical-records — List patient's medical records
 */
patientPortalRoutes.get('/medical-records', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM medical_records WHERE patient_id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT mr.id, mr.file_number, mr.discharge_type, mr.discharge_condition,
            mr.is_operation_conducted, mr.operation_date, mr.operation_diagnosis,
            mr.remarks, mr.created_at,
            d.name as doctor_name, d.specialty as doctor_specialization
     FROM medical_records mr
     LEFT JOIN doctors d ON d.id = mr.doctor_id
     WHERE mr.patient_id = ? AND mr.tenant_id = ? AND mr.is_active = 1
     ORDER BY mr.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  await auditLog(c.env.DB, patientId, 'view_medical_records', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

/**
 * GET /medical-records/:id — Get a specific medical record with diagnoses
 */
patientPortalRoutes.get('/medical-records/:id', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const recordId = c.req.param('id');

  const record = await db.$client.prepare(
    `SELECT mr.*, d.name as doctor_name, d.specialty as doctor_specialization
     FROM medical_records mr
     LEFT JOIN doctors d ON d.id = mr.doctor_id
     WHERE mr.id = ? AND mr.patient_id = ? AND mr.tenant_id = ? AND mr.is_active = 1`
  ).bind(recordId, patientId, tenantId).first();

  if (!record) {
    throw new HTTPException(404, { message: 'Medical record not found' });
  }

  // Get linked diagnoses
  const { results: diagnoses } = await db.$client.prepare(
    `SELECT fd.id, fd.is_primary, fd.notes, fd.created_at,
            ic.code, ic.description as diagnosis_name
     FROM final_diagnosis fd
     LEFT JOIN icd10_codes ic ON ic.id = fd.icd10_id
     WHERE fd.medical_record_id = ? AND fd.patient_id = ? AND fd.tenant_id = ? AND fd.is_active = 1
     ORDER BY fd.is_primary DESC`
  ).bind(recordId, patientId, tenantId).all();

  // Get linked documents
  const { results: documents } = await db.$client.prepare(
    `SELECT id, document_type, title, description, file_name, mime_type, created_at
     FROM document_records
     WHERE medical_record_id = ? AND patient_id = ? AND tenant_id = ? AND is_active = 1
     ORDER BY created_at DESC`
  ).bind(recordId, patientId, tenantId).all();

  await auditLog(c.env.DB, patientId, 'view_medical_record_detail', tenantId);
  return c.json({ record, diagnoses: diagnoses ?? [], documents: documents ?? [] });
});

// ─── Documents ────────────────────────────────────────────────────────

/**
 * GET /documents — List patient's uploaded documents
 */
patientPortalRoutes.get('/documents', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM document_records WHERE patient_id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT id,
            patient_id,
            uploaded_by,
            document_type,
            title,
            description,
            file_name,
            file_size,
            mime_type,
            created_at
     FROM document_records
     WHERE patient_id = ? AND tenant_id = ? AND is_active = 1
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  const documents = (results ?? []).map((row) => normalizePatientDocumentContract(row as Record<string, unknown>));

  await auditLog(c.env.DB, patientId, 'view_documents', tenantId);
  return c.json(paginatedResponse(documents, countResult?.total ?? 0, page, limit));
});

// ─── Food Diary ─────────────────────────────────────────────────────────

/**
 * GET /food-diary — List food diary logs for a given date
 */
patientPortalRoutes.get('/food-diary', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const dateStr = c.req.query('date') || new Date().toISOString().split('T')[0];
  
  const { results: logs } = await db.$client.prepare(
    `SELECT * FROM food_log 
     WHERE patient_id = ? AND date(logged_at) = date(?) 
     ORDER BY logged_at DESC`
  ).bind(patientId, dateStr).all();

  const cleanLogs = logs ?? [];
  const summary = {
    total_calories: cleanLogs.reduce((sum, log: any) => sum + (log.calories || 0), 0)
  };

  return c.json({ logs: cleanLogs, summary });
});

/**
 * POST /food-diary — Log a food item
 */
patientPortalRoutes.post('/food-diary', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const body = (await c.req.json()) as any;
  
  await db.$client.prepare(
    `INSERT INTO food_log (patient_id, meal_type, custom_name, calories, logged_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    patientId, 
    body.meal_type || 'lunch', 
    body.food_name, 
    body.calories, 
    body.logged_at || new Date().toISOString()
  ).run();

  return c.json({ success: true }, 201);
});

// ─── Diagnoses ────────────────────────────────────────────────────────

/**
 * GET /diagnoses — List all diagnoses for the patient
 */
patientPortalRoutes.get('/diagnoses', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const { page, limit, offset } = parsePagination(c);

  const countResult = await db.$client.prepare(
    'SELECT COUNT(*) as total FROM final_diagnosis WHERE patient_id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(patientId, tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(
    `SELECT fd.id, fd.is_primary, fd.notes, fd.created_at,
            ic.code as icd10_code, ic.description as diagnosis_name,
            d.name as doctor_name
     FROM final_diagnosis fd
     LEFT JOIN icd10_codes ic ON ic.id = fd.icd10_id
     LEFT JOIN medical_records mr ON mr.id = fd.medical_record_id
     LEFT JOIN doctors d ON d.id = mr.doctor_id
     WHERE fd.patient_id = ? AND fd.tenant_id = ? AND fd.is_active = 1
     ORDER BY fd.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(patientId, tenantId, limit, offset).all();

  await auditLog(c.env.DB, patientId, 'view_diagnoses', tenantId);
  return c.json(paginatedResponse(results ?? [], countResult?.total ?? 0, page, limit));
});

// ─── Downloadable PDFs ────────────────────────────────────────────────

function formatPatientPortalDateMonthYear(value: unknown): string {
  if (!value) return '';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}-${month}-${year}`;
}

/** Generate a printable HTML page for a prescription */
function prescriptionPdfHtml(rx: any, items: any[], patient: any, hospitalName: string): string {
  const rows = items.map((item: any) => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;">${item.medicine_name || ''}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${item.dosage || ''}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${item.frequency || ''}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${item.duration || ''}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${item.instructions || ''}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <title>Prescription ${rx.rx_no || ''}</title>
  <style>
    @media print { body { margin: 0; } .no-print { display: none; } }
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 20px auto; color: #111; }
    .header { border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { color: #0f766e; margin: 0; font-size: 22px; }
    .header p { margin: 4px 0; color: #6b7280; font-size: 13px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
    .info-item { font-size: 13px; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th { background: #f0fdf4; padding: 8px; border: 1px solid #e5e7eb; text-align: left; font-size: 12px; }
    .section { margin-top: 16px; }
    .section-label { font-weight: 600; font-size: 14px; color: #374151; margin-bottom: 4px; }
    .btn-print { position: fixed; top: 16px; right: 16px; background: #0f766e; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  </style>
</head><body>
  <button class="btn-print no-print" onclick="window.print()">Print / Save PDF</button>
  <div class="header">
    <h1>${hospitalName}</h1>
    <p>Prescription</p>
  </div>
  <div class="info-grid">
    <div class="info-item"><span class="info-label">Patient:</span> <span class="info-value">${patient.name || ''}</span></div>
    <div class="info-item"><span class="info-label">Rx #:</span> <span class="info-value">${rx.rx_no || ''}</span></div>
    <div class="info-item"><span class="info-label">Doctor:</span> <span class="info-value">${formatDoctorName(rx.doctor_name)}</span></div>
    <div class="info-item"><span class="info-label">Date:</span> <span class="info-value">${formatPatientPortalDateMonthYear(rx.created_at)}</span></div>
    ${rx.diagnosis ? `<div class="info-item"><span class="info-label">Diagnosis:</span> <span class="info-value">${rx.diagnosis}</span></div>` : ''}
    ${rx.chief_complaint ? `<div class="info-item"><span class="info-label">Chief Complaint:</span> <span class="info-value">${rx.chief_complaint}</span></div>` : ''}
  </div>
  ${(rx.bp || rx.temperature || rx.weight || rx.spo2) ? `
  <div class="section">
    <div class="section-label">Vitals</div>
    <div class="info-grid">
      ${rx.bp ? `<div class="info-item"><span class="info-label">BP:</span> ${rx.bp}</div>` : ''}
      ${rx.temperature ? `<div class="info-item"><span class="info-label">Temp:</span> ${rx.temperature}</div>` : ''}
      ${rx.weight ? `<div class="info-item"><span class="info-label">Weight:</span> ${rx.weight} kg</div>` : ''}
      ${rx.spo2 ? `<div class="info-item"><span class="info-label">SpO2:</span> ${rx.spo2}%</div>` : ''}
    </div>
  </div>` : ''}
  <div class="section">
    <div class="section-label">Medications</div>
    <table>
      <thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:8px;text-align:center;color:#9ca3af;">No medications</td></tr>'}</tbody>
    </table>
  </div>
  ${rx.advice ? `<div class="section"><div class="section-label">Advice</div><p style="font-size:13px;color:#374151;">${rx.advice}</p></div>` : ''}
  ${rx.follow_up_date ? `<div class="section"><div class="section-label">Follow-up</div><p style="font-size:13px;">${formatPatientPortalDateMonthYear(rx.follow_up_date)}</p></div>` : ''}
  <div style="margin-top:40px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:11px;color:#9ca3af;">
    Generated from ${hospitalName} Patient Portal
  </div>
</body></html>`;
}

/** Generate a printable HTML page for lab results */
function labResultPdfHtml(order: any, items: any[], patient: any, hospitalName: string): string {
  const rows = items.map((item: any) => {
    const { severity } = labExplanation(item.abnormal_flag, item.test_name);
    const flagColor = severity === 'critical' ? '#dc2626' : severity === 'attention' ? '#f59e0b' : severity === 'borderline' ? '#3b82f6' : '#16a34a';
    return `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;">${item.test_name || ''}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${item.result || item.result_numeric || '-'}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${item.unit || ''}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${item.normal_range || ''}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;color:${flagColor};font-weight:600;">${(item.abnormal_flag || 'normal').replace('_', ' ')}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <title>Lab Report ${order.order_no || ''}</title>
  <style>
    @media print { body { margin: 0; } .no-print { display: none; } }
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 20px auto; color: #111; }
    .header { border-bottom: 2px solid #1e40af; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { color: #1e40af; margin: 0; font-size: 22px; }
    .header p { margin: 4px 0; color: #6b7280; font-size: 13px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
    .info-item { font-size: 13px; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th { background: #eff6ff; padding: 8px; border: 1px solid #e5e7eb; text-align: left; font-size: 12px; }
    .btn-print { position: fixed; top: 16px; right: 16px; background: #1e40af; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  </style>
</head><body>
  <button class="btn-print no-print" onclick="window.print()">Print / Save PDF</button>
  <div class="header">
    <h1>${hospitalName}</h1>
    <p>Laboratory Report</p>
  </div>
  <div class="info-grid">
    <div class="info-item"><span class="info-label">Patient:</span> <span class="info-value">${patient.name || ''}</span></div>
    <div class="info-item"><span class="info-label">Order #:</span> <span class="info-value">${order.order_no || ''}</span></div>
    <div class="info-item"><span class="info-label">Status:</span> <span class="info-value">${(order.status || '').replace('_', ' ')}</span></div>
    <div class="info-item"><span class="info-label">Date:</span> <span class="info-value">${formatPatientPortalDateMonthYear(order.created_at)}</span></div>
  </div>
  <table>
    <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Normal Range</th><th>Status</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="padding:8px;text-align:center;color:#9ca3af;">No results</td></tr>'}</tbody>
  </table>
  <div style="margin-top:40px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:11px;color:#9ca3af;">
    Generated from ${hospitalName} Patient Portal
  </div>
</body></html>`;
}

/**
 * GET /prescriptions/:id/pdf — Download prescription as printable HTML
 */
patientPortalRoutes.get('/prescriptions/:id/pdf', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const prescriptionId = c.req.param('id');

  const rx = await db.$client.prepare(
    `SELECT p.*, d.name as doctor_name, d.specialty as doctor_specialization
     FROM prescriptions p
     LEFT JOIN doctors d ON d.id = p.doctor_id
     WHERE p.id = ? AND p.patient_id = ? AND p.tenant_id = ? AND p.status = 'final'`
  ).bind(prescriptionId, patientId, tenantId).first();

  if (!rx) {
    throw new HTTPException(404, { message: 'Prescription not found' });
  }

  const { results: items } = await db.$client.prepare(
    `SELECT pi.id, pi.medicine_name, pi.dosage, pi.frequency, pi.duration, pi.instructions, pi.sort_order
     FROM prescription_items pi
     JOIN prescriptions p ON pi.prescription_id = p.id AND p.tenant_id = ? AND p.status = 'final'
     WHERE pi.prescription_id = ?
       AND LOWER(COALESCE(pi.status, 'active')) NOT IN ('replaced', 'void', 'voided', 'cancelled', 'canceled', 'deleted')
     ORDER BY pi.sort_order, pi.id`
  ).bind(tenantId, prescriptionId).all();

  const patient = await db.$client.prepare(
    'SELECT name, patient_code FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ name: string; patient_code: string }>();

  const tenant = await db.$client.prepare(
    'SELECT name FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ name: string }>();

  await auditLog(c.env.DB, patientId, 'download_prescription_pdf', tenantId);

  return new Response(prescriptionPdfHtml(rx, items ?? [], patient ?? { name: '' }, tenant?.name || 'Ozzyl Health'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

/**
 * GET /lab-results/:id/pdf — Download lab order results as printable HTML
 */
patientPortalRoutes.get('/lab-results/:id/pdf', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const orderId = c.req.param('id');

  const order = await db.$client.prepare(
    `SELECT * FROM lab_orders lo
     WHERE lo.id = ? AND lo.patient_id = ? AND lo.tenant_id = ?
       AND LOWER(COALESCE(lo.status, '')) IN ('verified', 'released', 'completed', 'final')`
  ).bind(orderId, patientId, tenantId).first();

  if (!order) {
    throw new HTTPException(404, { message: 'Lab order not found' });
  }

  const { results: items } = await db.$client.prepare(
    `SELECT loi.*, ltc.name as test_name, ltc.unit, ltc.normal_range
     FROM lab_order_items loi
     JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = ?
     LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
     WHERE loi.lab_order_id = ?
       AND LOWER(COALESCE(lo.status, '')) IN ('verified', 'released', 'completed', 'final')
       AND LOWER(COALESCE(loi.sample_status, '')) NOT IN ('draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided')`
  ).bind(tenantId, orderId).all();

  const patient = await db.$client.prepare(
    'SELECT name, patient_code FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ name: string; patient_code: string }>();

  const tenant = await db.$client.prepare(
    'SELECT name FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ name: string }>();

  await auditLog(c.env.DB, patientId, 'download_lab_pdf', tenantId);

  return new Response(labResultPdfHtml(order, items ?? [], patient ?? { name: '' }, tenant?.name || 'Ozzyl Health'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Intake Forms — Patient-facing endpoints
// ═══════════════════════════════════════════════════════════════════════

patientPortalRoutes.use('/intake-forms', globalPatientAuthMiddleware);
patientPortalRoutes.use('/intake-forms/*', globalPatientAuthMiddleware);

/**
 * GET /intake-forms/active — Get active intake forms for this tenant
 * Patients see these before their appointment
 */
patientPortalRoutes.get('/intake-forms/active', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = c.get('tenantId');

  const { results } = await db.$client.prepare(
    'SELECT id, name, description, form_fields FROM appointment_intake_forms WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at'
  ).bind(tenantId).all();

  return c.json({ data: results });
});

/**
 * POST /intake-forms/:formId/submit — Submit intake form response
 */
patientPortalRoutes.post('/intake-forms/:formId/submit', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const formId = c.req.param('formId');

  const body = await c.req.json<{ appointment_id: number; responses: Record<string, any> }>();

  if (!body.appointment_id) throw new HTTPException(400, { message: 'appointment_id required' });
  if (!body.responses || typeof body.responses !== 'object') {
    throw new HTTPException(400, { message: 'responses object required' });
  }

  // Verify the form exists and belongs to this tenant
  const form = await db.$client.prepare(
    'SELECT id FROM appointment_intake_forms WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(formId, tenantId).first();
  if (!form) throw new HTTPException(404, { message: 'Form not found' });

  // Verify the appointment belongs to this patient
  const appt = await db.$client.prepare(
    'SELECT id FROM appointments WHERE id = ? AND patient_id = ? AND tenant_id = ?'
  ).bind(body.appointment_id, patientId, tenantId).first();
  if (!appt) throw new HTTPException(404, { message: 'Appointment not found' });

  await db.$client.prepare(
    `INSERT INTO appointment_intake_responses (tenant_id, appointment_id, form_id, patient_id, responses)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(tenantId, body.appointment_id, formId, patientId, JSON.stringify(body.responses)).run();

  return c.json({ success: true }, 201);
});

/**
 * GET /intake-forms/my-responses — List patient's own intake form responses
 */
patientPortalRoutes.get('/intake-forms/my-responses', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');

  const { results } = await db.$client.prepare(
    `SELECT r.id, r.appointment_id, r.form_id, r.responses, r.submitted_at,
            f.name as form_name, a.appointment_date
     FROM appointment_intake_responses r
     LEFT JOIN appointment_intake_forms f ON f.id = r.form_id
     LEFT JOIN appointments a ON a.id = r.appointment_id
     WHERE r.patient_id = ? AND r.tenant_id = ?
     ORDER BY r.submitted_at DESC`
  ).bind(patientId, tenantId).all();

  return c.json({ data: results });
});

// ═══════════════════════════════════════════════════════════════════════
// Patient Reviews
// ═══════════════════════════════════════════════════════════════════════

patientPortalRoutes.use('/reviews', globalPatientAuthMiddleware);
patientPortalRoutes.use('/reviews/*', globalPatientAuthMiddleware);

/**
 * POST /reviews — Submit a review
 */
patientPortalRoutes.post('/reviews', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');

  const body = await c.req.json<{ rating: number; review_text?: string }>();

  if (!body.rating || body.rating < 1 || body.rating > 5) {
    throw new HTTPException(400, { message: 'Rating must be 1-5' });
  }

  // Get patient name
  const patient = await db.$client.prepare(
    'SELECT name FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first<{ name: string }>();

  await db.$client.prepare(
    `INSERT INTO website_reviews (tenant_id, patient_id, patient_name, rating, review_text)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(tenantId, patientId, patient?.name || 'Patient', body.rating, body.review_text || null).run();

  return c.json({ success: true, message: 'Review submitted for moderation' }, 201);
});

/**
 * GET /reviews/mine — Get patient's own reviews
 */
patientPortalRoutes.get('/reviews/mine', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');

  const { results } = await db.$client.prepare(
    'SELECT id, rating, review_text, is_approved, created_at FROM website_reviews WHERE patient_id = ? AND tenant_id = ? ORDER BY created_at DESC'
  ).bind(patientId, tenantId).all();

  return c.json({ data: results });
});

// ═══════════════════════════════════════════════════════════════════════
// Health Tips Feedback Loop & Engagement Analytics
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /health-tips/feed — Get a personalised feed of health tips
 */
patientPortalRoutes.get('/health-tips/feed', async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '10')));
  
  // Select active tips, joining to see if the patient already thumbed them down or if they are suppressed
  const { results } = await db.$client.prepare(`
    SELECT ht.id, ht.tip_key, ht.category, ht.body_text, ht.body_text_bn, ht.tags, ht.source,
           COALESCE(pts.personal_score, ht.base_score) as score,
           ptf.reaction as user_reaction
    FROM health_tips ht
    LEFT JOIN patient_tip_scores pts ON pts.tip_id = ht.id AND pts.patient_id = ? AND pts.tenant_id = ?
    LEFT JOIN patient_tip_feedback ptf ON ptf.tip_id = ht.id AND ptf.patient_id = ? AND ptf.tenant_id = ?
    WHERE ht.is_active = 1
      AND (pts.suppressed IS NULL OR pts.suppressed = 0)
    ORDER BY score DESC, ht.updated_at DESC
    LIMIT ?
  `).bind(patientId, tenantId, patientId, tenantId, limit).all();

  return c.json({ data: results ?? [] });
});

/**
 * POST /health-tips/:tipId_or_key/feedback — Leave a 👍 or 👎 on a tip
 */
const tipFeedbackSchema = z.object({
  reaction: z.enum(['up', 'down']),
  comment: z.string().max(500).optional(),
  session_context: z.string().optional(),
});

patientPortalRoutes.post('/health-tips/:tipKey/feedback', zValidator('json', tipFeedbackSchema), async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const tipKey = c.req.param('tipKey');
  const data = c.req.valid('json');

  const tip = await db.$client.prepare(
    `SELECT id FROM health_tips WHERE tip_key = ? OR id = ?`
  ).bind(tipKey, tipKey).first<{ id: number }>();

  if (!tip) {
    throw new HTTPException(404, { message: 'Health tip not found' });
  }

  // Upsert feedback
  await db.$client.prepare(`
    INSERT INTO patient_tip_feedback (patient_id, tenant_id, tip_id, tip_key, reaction, comment, session_context, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    ON CONFLICT(patient_id, tip_id, tenant_id) DO UPDATE SET
      reaction = excluded.reaction,
      comment = excluded.comment,
      session_context = excluded.session_context,
      updated_at = datetime('now', '+6 hours')
  `).bind(
    patientId, tenantId, tip.id, tipKey,
    data.reaction, data.comment ?? null, data.session_context ?? null
  ).run();

  // If reaction is DOWN, potentially suppress it (soft hide)
  // For now, we will lower the personal score a lot if it's down.
  const scoreAdjustment = data.reaction === 'up' ? 10.0 : -20.0;
  const suppressed = data.reaction === 'down' ? 1 : 0;
  const suppressedAt = data.reaction === 'down' ? "datetime('now', '+6 hours')" : "NULL";

  await db.$client.prepare(`
    INSERT INTO patient_tip_scores (patient_id, tenant_id, tip_id, tip_key, personal_score, suppressed, suppressed_at)
    VALUES (?, ?, ?, ?, (SELECT base_score FROM health_tips WHERE id = ?) + ?, ?, ${suppressedAt})
    ON CONFLICT(patient_id, tip_id, tenant_id) DO UPDATE SET
      personal_score = personal_score + excluded.personal_score - (SELECT base_score FROM health_tips WHERE id = excluded.tip_id),
      suppressed = excluded.suppressed,
      suppressed_at = excluded.suppressed_at
  `).bind(
    patientId, tenantId, tip.id, tipKey, tip.id, scoreAdjustment, suppressed
  ).run();

  return c.json({ success: true, message: 'Feedback recorded' });
});

/**
 * POST /health-tips/engagement — Log an engagement metric (impression, click, read etc.)
 */
const tipEngagementSchema = z.object({
  tip_key: z.string().optional(),
  content_type: z.enum(['tip', 'wellness_article', 'health_alert', 'reminder', 'video', 'checklist']).default('tip'),
  event_type: z.enum(['impression', 'click', 'dismiss', 'share', 'expand', 'complete', 'bookmark']),
  section: z.string().optional(),
  session_id: z.string().optional(),
  device_type: z.enum(['mobile', 'web', 'tablet']).optional(),
  time_spent_ms: z.number().int().nonnegative().optional(),
  metadata: z.any().optional(),
});

patientPortalRoutes.post('/health-tips/engagement', zValidator('json', tipEngagementSchema), async (c) => {
  const db = getDb(c.env.DB);
  const patientId = c.get('patientId');
  const tenantId = c.get('tenantId');
  const data = c.req.valid('json');

  let tipId: number | null = null;
  if (data.tip_key) {
    const tip = await db.$client.prepare(
      `SELECT id FROM health_tips WHERE tip_key = ? OR id = ?`
    ).bind(data.tip_key, data.tip_key).first<{ id: number }>();
    if (tip) tipId = tip.id;
  }

  await db.$client.prepare(`
    INSERT INTO patient_tip_engagement (
      patient_id, tenant_id, tip_id, tip_key, content_type,
      event_type, section, session_id, device_type, time_spent_ms, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    patientId, tenantId, tipId, data.tip_key ?? null, data.content_type,
    data.event_type, data.section ?? null, data.session_id ?? null,
    data.device_type ?? null, data.time_spent_ms ?? null,
    data.metadata ? JSON.stringify(data.metadata) : null
  ).run();

  return c.json({ success: true }, 201);
});

export default patientPortalRoutes;

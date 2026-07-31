import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  updateNationalIdSchema,
  createConsentSchema,
  revokeConsentSchema,
  generateTokenSchema,
  nidLookupSchema,
  emergencyAccessSchema,
} from '../../schemas/healthRecord';
import { issueCardSchema, revokeCardSchema } from '../../schemas/healthCards';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { buildPortableHealthSummary } from '../../lib/health-summary';
import { filterSummaryByClinicalAreas, parseConsentClinicalAreas } from '../../lib/consent-helpers';
import { generateOrGetUHID, updateGlobalIdentity } from '../../lib/uhid';
import { GLOBAL_UID_REGEX } from '../../lib/global-identity';
import { cleanupExpiredConsents, getConsentExpiryStats } from '../../lib/consent-cleanup';
import { getDb } from '../../db';
import { getNextSequence } from '../../lib/sequence';
import type { Env, Variables } from '../../types';

const healthRecordRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

// ─── Helpers ──────────────────────────────────────────────────────────

async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getCardQrPayload(origin: string, token: string): string {
  return `${origin}/qr/patient-card/${token}`;
}

function extractCardQrToken(payload: string): string {
  const value = payload.trim();
  if (!value) throw new HTTPException(400, { message: 'QR payload is required' });

  try {
    const parsed = JSON.parse(value) as { token?: unknown; qr_token?: unknown; payload?: unknown };
    const token = parsed.token ?? parsed.qr_token ?? parsed.payload;
    if (typeof token === 'string' && token.trim()) return extractCardQrToken(token);
  } catch {
    // Not JSON; continue with URL/raw parsing.
  }

  try {
    const url = new URL(value);
    const marker = '/qr/patient-card/';
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex >= 0) {
      return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    }
    const tokenParam = url.searchParams.get('token') ?? url.searchParams.get('qr_token');
    if (tokenParam) return tokenParam;
  } catch {
    // Not a URL; treat as raw token.
  }

  return value;
}

function scanScopeForRole(role: string): 'registration' | 'clinical' | 'nursing_context' | 'billing' {
  if (['doctor', 'md'].includes(role)) return 'clinical';
  if (role === 'nurse') return 'nursing_context';
  if (['accountant', 'billing'].includes(role)) return 'billing';
  return 'registration';
}

function canResolveCardQr(role: string): boolean {
  return [
    'hospital_admin',
    'director',
    'reception',
    'receptionist',
    'doctor',
    'md',
    'nurse',
    'accountant',
    'billing',
  ].includes(role);
}

function canImportCardQr(role: string): boolean {
  return ['hospital_admin', 'director', 'reception', 'receptionist', 'doctor', 'md'].includes(role);
}

type CardQrTokenRow = {
  id: number;
  tenant_id: string;
  patient_id: number;
  uhid: string;
  card_version: number;
  status: string;
  source_hospital_name: string | null;
  global_identity_id: number | null;
  national_id: string | null;
  patient_code: string | null;
  name: string | null;
  father_husband: string | null;
  address: string | null;
  mobile: string | null;
  email: string | null;
  age: number | null;
  gender: string | null;
  blood_group: string | null;
  date_of_birth: string | null;
  guardian_mobile: string | null;
  primary_name: string | null;
  primary_phone: string | null;
  primary_email: string | null;
};

async function loadActiveCardQrToken(db: ReturnType<typeof getDb>, rawToken: string): Promise<CardQrTokenRow | null> {
  return db.$client.prepare(`
    SELECT
      q.id,
      q.tenant_id,
      q.patient_id,
      q.uhid,
      q.card_version,
      q.status,
      t.name AS source_hospital_name,
      p.global_identity_id,
      p.national_id,
      p.patient_code,
      p.name,
      p.father_husband,
      p.address,
      p.mobile,
      p.email,
      p.age,
      p.gender,
      p.blood_group,
      p.date_of_birth,
      p.guardian_mobile,
      g.primary_name,
      g.primary_phone,
      g.primary_email
    FROM patient_card_qr_tokens q
    JOIN patients p ON p.id = q.patient_id AND p.tenant_id = q.tenant_id
    LEFT JOIN tenants t ON t.id = q.tenant_id
    LEFT JOIN global_patient_identity g ON g.uhid = q.uhid
    WHERE q.token_hash = ? AND q.status = 'active'
    LIMIT 1
  `).bind(await sha256(rawToken)).first<CardQrTokenRow>();
}

async function auditCardQrScan(
  db: ReturnType<typeof getDb>,
  options: {
    token?: CardQrTokenRow | null;
    scannerTenantId: string;
    scannerUserId: number;
    scannerRole: string;
    action: 'resolve' | 'import';
    scope: string;
    outcome: string;
    destinationPatientId?: number | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await db.$client.prepare(`
    INSERT INTO patient_card_qr_scan_audit (
      token_id, source_tenant_id, source_patient_id, scanned_by_tenant_id, scanned_by_user_id,
      scanned_by_role, action, scope, outcome, destination_patient_id, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    options.token?.id ?? null,
    options.token?.tenant_id ?? null,
    options.token?.patient_id ?? null,
    options.scannerTenantId,
    options.scannerUserId,
    options.scannerRole,
    options.action,
    options.scope,
    options.outcome,
    options.destinationPatientId ?? null,
    options.ipAddress ?? null,
    options.userAgent ?? null,
  ).run();
}

function generateClaimCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `C-${code}`;
}

async function issuePrintableClaimCode(
  db: ReturnType<typeof getDb>,
  options: {
    tenantId: string;
    userId: number;
    patientId: number;
    identityId: number;
  },
): Promise<{ claimCode: string; expiresAt: string }> {
  const claimCode = generateClaimCode();
  const codeHash = await sha256(claimCode);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.$client.prepare(`
    INSERT INTO patient_claim_codes (
      identity_id, code_hash, code_last4, issued_by_tenant_id, issued_for_patient_id, issued_by_user_id, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    options.identityId,
    codeHash,
    claimCode.slice(-4),
    options.tenantId,
    options.patientId,
    options.userId,
    expiresAt,
  ).run();

  return { claimCode, expiresAt };
}

async function loadPatientActivationContext(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
): Promise<{
  id: number;
  national_id: string | null;
  uhid: string | null;
  global_identity_id: number | null;
}> {
  const patient = await db.$client.prepare(
    'SELECT id, national_id, uhid, global_identity_id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{
    id: number;
    national_id: string | null;
    uhid: string | null;
    global_identity_id: number | null;
  }>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  return patient;
}

async function loadUnclaimedIdentity(
  db: ReturnType<typeof getDb>,
  identityId: number | null,
): Promise<{ id: number; claim_status: string | null } | null> {
  if (!identityId) return null;
  return db.$client.prepare(
    'SELECT id, claim_status FROM global_patient_identity WHERE id = ?',
  ).bind(identityId).first<{ id: number; claim_status: string | null }>();
}

function maskNid(nid: string): string {
  if (nid.length <= 6) return nid;
  return `${nid.slice(0, 4)}${'*'.repeat(nid.length - 7)}${nid.slice(-3)}`;
}

function maskIdentityKey(value: string): string {
  if (GLOBAL_UID_REGEX.test(value)) return `${value.slice(0, 7)}****`;
  return maskNid(value);
}

function requireClaimReviewRole(role: string): void {
  if (!['hospital_admin', 'director'].includes(role)) {
    throw new HTTPException(403, { message: 'Only admins can review claim activity' });
  }
}

function parseListLimit(raw: string | undefined, fallback = 25, max = 100): number {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.trunc(value), max);
}

// ─── PUT /patients/:id/national-id ──────────────────────────────────
// Set NID + auto-link in MPI

healthRecordRoutes.put('/patients/:id/national-id', zValidator('json', updateNationalIdSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = Number(c.req.param('id'));
  const { national_id } = c.req.valid('json');

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const db = getDb(c.env.DB);

  const patient = await db.$client.prepare(
    'SELECT id, name FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ id: number; name: string }>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // Check NID uniqueness within this tenant
  const existing = await db.$client.prepare(
    'SELECT id FROM patients WHERE national_id = ? AND tenant_id = ? AND id != ?',
  ).bind(national_id, tenantId, patientId).first();

  if (existing) {
    throw new HTTPException(409, { message: 'Another patient in this hospital already has this NID' });
  }

  // Update patient NID
  await db.$client.prepare(
    'UPDATE patients SET national_id = ? WHERE id = ? AND tenant_id = ?',
  ).bind(national_id, patientId, tenantId).run();

  // Auto-generate UHID
  const uhid = await generateOrGetUHID(c.env.DB, tenantId, patientId, national_id);

  // Update global identity with latest demographics
  await updateGlobalIdentity(c.env.DB, national_id, {
    name: patient.name,
  });

  // Auto-link in MPI
  const hospitalRow = await db.$client.prepare(
    'SELECT name FROM tenants WHERE id = ?',
  ).bind(tenantId).first<{ name: string }>();

  await db.$client.prepare(`
    INSERT OR IGNORE INTO patient_health_links (national_id, tenant_id, patient_id, hospital_name, uhid)
    VALUES (?, ?, ?, ?, ?)
  `).bind(national_id, tenantId, patientId, hospitalRow?.name ?? null, uhid).run();

  return c.json({ message: 'National ID updated and linked', national_id: maskNid(national_id), uhid });
});

// ─── GET /health-record/linked-records ──────────────────────────────
// Patient sees all hospitals where their NID is registered

healthRecordRoutes.get('/health-record/linked-records', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.query('patient_id'));

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'patient_id query param required' });
  }

  const db = getDb(c.env.DB);

  // Get NID for this patient
  const patient = await db.$client.prepare(
    'SELECT national_id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ national_id: string | null }>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
  if (!patient.national_id) {
    return c.json({ linked_records: [], message: 'No National ID on file' });
  }

  // Cross-tenant MPI lookup
  const { results } = await db.$client.prepare(`
    SELECT tenant_id, hospital_name, linked_at, uhid
    FROM patient_health_links
    WHERE national_id = ? AND is_active = 1
    ORDER BY linked_at DESC
  `).bind(patient.national_id).all<{ tenant_id: number; hospital_name: string | null; linked_at: string; uhid: string | null }>();

  // Get UHID from first record or patient
  const patientUhid = await db.$client.prepare(
    'SELECT uhid FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ uhid: string | null }>();

  return c.json({
    national_id: maskNid(patient.national_id),
    uhid: patientUhid?.uhid ?? results?.[0]?.uhid ?? null,
    linked_records: (results ?? []).map((r) => ({
      hospital_name: r.hospital_name ?? 'Unknown Hospital',
      is_current: String(r.tenant_id) === String(tenantId),
      linked_at: r.linked_at,
    })),
  });
});

// ─── GET /health-record/consents ────────────────────────────────────
// List active consents for this patient

healthRecordRoutes.get('/health-record/consents', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.query('patient_id'));

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'patient_id query param required' });
  }

  const db = getDb(c.env.DB);

  const patient = await db.$client.prepare(
    'SELECT national_id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ national_id: string | null }>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
  if (!patient.national_id) {
    return c.json({ consents: [] });
  }

  // Lazy cleanup: expire stale consents before listing
  await cleanupExpiredConsents(c.env.DB);

  const { results } = await db.$client.prepare(`
    SELECT id, consent_type, granted_to_tenant_id, is_active, granted_at, expires_at,
           revoked_at, revoked_reason, clinical_areas, purpose, auto_granted, expired_at
    FROM health_record_consents
    WHERE national_id = ? AND granting_tenant_id = ? AND granting_patient_id = ?
    ORDER BY granted_at DESC
    LIMIT 50
  `).bind(patient.national_id, tenantId, patientId).all<Record<string, unknown>>();

  return c.json({ consents: results ?? [] });
});

// ─── POST /health-record/consent ────────────────────────────────────
// Grant access consent

healthRecordRoutes.post('/health-record/consent', zValidator('json', createConsentSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = Number(c.req.query('patient_id'));
  const data = c.req.valid('json');

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'patient_id query param required' });
  }

  const db = getDb(c.env.DB);

  const patient = await db.$client.prepare(
    'SELECT national_id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ national_id: string | null }>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
  if (!patient.national_id) {
    throw new HTTPException(400, { message: 'Patient must have a National ID before granting consent' });
  }

  const expiresAt = new Date(Date.now() + data.duration_hours * 60 * 60 * 1000).toISOString();
  const clinicalAreas = data.clinical_areas ? JSON.stringify(data.clinical_areas) : null;

  const result = await db.$client.prepare(`
    INSERT INTO health_record_consents
      (national_id, granting_tenant_id, granting_patient_id, granted_to_tenant_id, consent_type, expires_at, clinical_areas, purpose)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    patient.national_id,
    tenantId,
    patientId,
    data.granted_to_tenant_id ?? null,
    data.consent_type,
    expiresAt,
    clinicalAreas,
    data.purpose ?? 'TREATMENT',
  ).run();

  return c.json({
    id: result.meta.last_row_id,
    message: 'Consent granted',
    consent_type: data.consent_type,
    clinical_areas: data.clinical_areas ?? ['all'],
    purpose: data.purpose ?? 'TREATMENT',
    expires_at: expiresAt,
  }, 201);
});

// ─── DELETE /health-record/consent/:id ──────────────────────────────
// Revoke a consent

healthRecordRoutes.delete('/health-record/consent/:id', zValidator('json', revokeConsentSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const consentId = Number(c.req.param('id'));

  if (!Number.isFinite(consentId) || consentId <= 0) {
    throw new HTTPException(400, { message: 'Invalid consent id' });
  }

  const db = getDb(c.env.DB);

  const existing = await db.$client.prepare(
    'SELECT id FROM health_record_consents WHERE id = ? AND granting_tenant_id = ? AND is_active = 1',
  ).bind(consentId, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Active consent not found' });

  const data = c.req.valid('json');

  await db.$client.prepare(`
    UPDATE health_record_consents
    SET is_active = 0, revoked_at = datetime('now', '+6 hours'), revoked_reason = ?
    WHERE id = ? AND granting_tenant_id = ?
  `).bind(data.reason ?? null, consentId, tenantId).run();

  return c.json({ message: 'Consent revoked' });
});

// ─── POST /health-record/generate-token ─────────────────────────────
// Create a shareable access token (for QR code / link)

healthRecordRoutes.post('/health-record/generate-token', zValidator('json', generateTokenSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const patientId = Number(c.req.query('patient_id'));
  const data = c.req.valid('json');

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'patient_id query param required' });
  }

  const db = getDb(c.env.DB);

  const patient = await db.$client.prepare(
    'SELECT national_id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<{ national_id: string | null }>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
  if (!patient.national_id) {
    throw new HTTPException(400, { message: 'Patient must have a National ID to generate a health record token' });
  }

  // Generate token and store hash
  const rawToken = generateSecureToken();
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + data.duration_hours * 60 * 60 * 1000).toISOString();
  const createdByRole = ['doctor', 'md', 'nurse', 'hospital_admin', 'receptionist'].includes(role) ? 'staff' : 'patient';

  await db.$client.prepare(`
    INSERT INTO health_record_access_tokens
      (token_hash, national_id, tenant_id, patient_id, scope, created_by_role, created_by_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    patient.national_id,
    tenantId,
    patientId,
    data.scope,
    createdByRole,
    userId,
    expiresAt,
  ).run();

  return c.json({
    token: rawToken,
    scope: data.scope,
    expires_at: expiresAt,
    message: 'Token created. Share this token or QR code — it cannot be retrieved again.',
  }, 201);
});

// ─── GET /health-record/qr/:patientId ───────────────────────────────
// Returns HTML health card with QR code for printing

healthRecordRoutes.get('/health-record/qr/:patientId', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const patientId = Number(c.req.param('patientId'));

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const db = getDb(c.env.DB);

  const patient = await db.$client.prepare(
    'SELECT name, national_id, blood_group, date_of_birth, age, gender, uhid FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first<Record<string, unknown>>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
  if (!patient.national_id) {
    throw new HTTPException(400, { message: 'Patient must have a National ID to generate health card' });
  }

  // Generate a 24h summary-scope token
  const rawToken = generateSecureToken();
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const createdByRole = ['doctor', 'md', 'nurse', 'hospital_admin', 'receptionist'].includes(role) ? 'staff' : 'patient';

  await db.$client.prepare(`
    INSERT INTO health_record_access_tokens
      (token_hash, national_id, tenant_id, patient_id, scope, created_by_role, created_by_id, expires_at)
    VALUES (?, ?, ?, ?, 'summary', ?, ?, ?)
  `).bind(tokenHash, String(patient.national_id), tenantId, patientId, createdByRole, userId, expiresAt).run();

  const hospital = await db.$client.prepare(
    'SELECT name FROM tenants WHERE id = ?',
  ).bind(tenantId).first<{ name: string }>();

  // Dynamically import the health card HTML builder
  const { buildHealthCardHtml } = await import('../../lib/health-card-html');

  const html = await buildHealthCardHtml({
    patientName: String(patient.name ?? ''),
    nationalId: String(patient.national_id),
    bloodGroup: patient.blood_group ? String(patient.blood_group) : null,
    gender: patient.gender ? String(patient.gender) : null,
    dateOfBirth: patient.date_of_birth ? String(patient.date_of_birth) : null,
    age: typeof patient.age === 'number' ? patient.age : null,
    hospitalName: hospital?.name ?? 'Hospital',
    token: rawToken,
    expiresAt,
    uhid: patient.uhid ? String(patient.uhid) : null,
  });

  return c.html(html);
});

// ─── GET /health-record/lookup ──────────────────────────────────────
// Staff looks up patient by NID or UHID/QID (cross-hospital)

healthRecordRoutes.get('/health-record/lookup', async (c) => {
  const tenantId = requireTenantId(c);
  const role = String(c.get('role') ?? '');
  const nationalId = c.req.query('national_id');
  const requestedUhid = c.req.query('uhid') ?? c.req.query('global_uid') ?? c.req.query('qid');

  if (!['doctor', 'md', 'nurse', 'hospital_admin', 'receptionist'].includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical staff can look up external patient records' });
  }

  if (!nationalId && !requestedUhid) {
    throw new HTTPException(400, { message: 'national_id or uhid query param required' });
  }

  if (nationalId) {
    const parsed = nidLookupSchema.safeParse({ national_id: nationalId });
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'Invalid NID format' });
    }
  }

  if (requestedUhid && !GLOBAL_UID_REGEX.test(requestedUhid)) {
    throw new HTTPException(400, { message: 'Invalid UHID format' });
  }

  const db = getDb(c.env.DB);
  let identityKey = nationalId ?? requestedUhid!;
  let resolvedNationalId = nationalId ?? null;
  let resolvedUhid = requestedUhid ?? null;

  if (!resolvedNationalId && requestedUhid) {
    const identity = await db.$client.prepare(
      'SELECT national_id, uhid FROM global_patient_identity WHERE uhid = ?',
    ).bind(requestedUhid).first<{ national_id: string | null; uhid: string | null }>();
    resolvedNationalId = identity?.national_id ?? null;
    resolvedUhid = identity?.uhid ?? requestedUhid;
    identityKey = resolvedNationalId ?? resolvedUhid ?? requestedUhid;
  }

  // Find all linked hospitals for this portable identity key.
  const { results: links } = await db.$client.prepare(`
    SELECT phl.tenant_id, phl.patient_id, phl.hospital_name, phl.linked_at, phl.national_id, phl.uhid
    FROM patient_health_links phl
    WHERE phl.is_active = 1
      AND (phl.national_id = ? OR phl.uhid = ?)
    ORDER BY phl.linked_at DESC
  `).bind(identityKey, resolvedUhid ?? identityKey).all<{
    tenant_id: number;
    patient_id: number;
    hospital_name: string | null;
    linked_at: string;
    national_id: string;
    uhid: string | null;
  }>();

  if (!links || links.length === 0) {
    return c.json({ found: false, message: 'No patient found with this identity' });
  }

  // For each linked hospital, check if consent allows this tenant to view
  const summaries: Array<{
    hospital_name: string;
    has_consent: boolean;
    summary: unknown;
  }> = [];

  for (const link of links) {
    // Check consent
    const consent = await db.$client.prepare(`
      SELECT id, clinical_areas FROM health_record_consents
      WHERE (national_id = ? OR national_id = ?) AND granting_tenant_id = ? AND is_active = 1
        AND expires_at > datetime('now', '+6 hours')
        AND (granted_to_tenant_id IS NULL OR granted_to_tenant_id = ?)
        AND consent_type IN ('view_summary', 'view_full', 'emergency_access')
      LIMIT 1
    `).bind(identityKey, link.uhid ?? identityKey, link.tenant_id, tenantId).first<{ id: number; clinical_areas: string | null }>();

    if (consent) {
      const summary = await buildPortableHealthSummary(c.env.DB, link.tenant_id, link.patient_id);
      const filteredSummary = summary
        ? filterSummaryByClinicalAreas(summary, parseConsentClinicalAreas(consent.clinical_areas))
        : null;
      summaries.push({
        hospital_name: link.hospital_name ?? 'Unknown Hospital',
        has_consent: true,
        summary: filteredSummary,
      });

      // Log access
      await db.$client.prepare(`
        INSERT INTO health_record_access_log
          (national_id, source_tenant_id, accessing_tenant_id, accessing_user_id, access_type)
        VALUES (?, ?, ?, ?, 'nid_lookup')
      `).bind(identityKey, link.tenant_id, tenantId, requireUserId(c)).run();
    } else {
      summaries.push({
        hospital_name: link.hospital_name ?? 'Unknown Hospital',
        has_consent: false,
        summary: null,
      });
    }
  }

  return c.json({
    found: true,
    identity_key: maskIdentityKey(identityKey),
    national_id: resolvedNationalId ? maskNid(resolvedNationalId) : null,
    uhid: resolvedUhid,
    hospitals: summaries,
  });
});

// ─── POST /health-record/emergency-access ───────────────────────────
// Break-glass emergency access to patient records without prior consent.
// Creates auto-expiring 4-hour consent and logs everything.

healthRecordRoutes.post('/health-record/emergency-access', zValidator('json', emergencyAccessSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const data = c.req.valid('json');

  // Only clinical staff can declare emergency
  if (!['doctor', 'md', 'nurse', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical staff can use emergency access' });
  }

  const db = getDb(c.env.DB);

  // Find patient links by NID
  const { results: links } = await db.$client.prepare(`
    SELECT tenant_id, patient_id, hospital_name
    FROM patient_health_links
    WHERE national_id = ? AND is_active = 1
  `).bind(data.national_id).all<{ tenant_id: number; patient_id: number; hospital_name: string | null }>();

  if (!links || links.length === 0) {
    throw new HTTPException(404, { message: 'No patient found with this National ID' });
  }

  // Create emergency consent for each linked hospital (4 hours)
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  const summaries: Array<{ hospital_name: string; summary: unknown }> = [];

  for (const link of links) {
    // Create auto-expiring emergency consent
    await db.$client.prepare(`
      INSERT INTO health_record_consents
        (national_id, granting_tenant_id, granting_patient_id, granted_to_tenant_id,
         consent_type, expires_at, emergency_justification, emergency_declared_by)
      VALUES (?, ?, ?, ?, 'emergency_access', ?, ?, ?)
    `).bind(
      data.national_id, link.tenant_id, link.patient_id, tenantId,
      expiresAt, data.justification, userId,
    ).run();

    // Build summary
    const summary = await buildPortableHealthSummary(c.env.DB, link.tenant_id, link.patient_id);
    summaries.push({
      hospital_name: link.hospital_name ?? 'Unknown Hospital',
      summary,
    });

    // Log emergency access
    await db.$client.prepare(`
      INSERT INTO health_record_access_log
        (national_id, source_tenant_id, accessing_tenant_id, accessing_user_id, access_type)
      VALUES (?, ?, ?, ?, 'emergency_override')
    `).bind(data.national_id, link.tenant_id, tenantId, userId).run();
  }

  return c.json({
    message: 'Emergency access granted. This access is logged and will expire in 4 hours.',
    expires_at: expiresAt,
    justification: data.justification,
    declared_by: userId,
    hospitals: summaries,
  });
});

healthRecordRoutes.post('/health-record/patients/:id/card-qr-token', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const role = String(c.get('role') ?? '');
  const patientId = Number(c.req.param('id'));

  if (!canResolveCardQr(role)) {
    throw new HTTPException(403, { message: 'This role cannot issue patient card QR tokens' });
  }
  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const db = getDb(c.env.DB);
  const body: { reissue?: boolean } = await c.req.json<{ reissue?: boolean }>().catch(() => ({}));
  const patient = await db.$client.prepare(`
    SELECT id, tenant_id, uhid, global_identity_id
    FROM patients
    WHERE id = ? AND tenant_id = ?
  `).bind(patientId, tenantId).first<{
    id: number;
    tenant_id: string;
    uhid: string | null;
    global_identity_id: number | null;
  }>();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
  if (!patient.uhid) throw new HTTPException(400, { message: 'Patient is missing a global UHID' });

  const active = await db.$client.prepare(`
    SELECT id, token_last4
    FROM patient_card_qr_tokens
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, patientId).first<{ id: number; token_last4: string }>();

  const url = new URL(c.req.url);
  if (active && !body.reissue) {
    return c.json({
      token_id: active.id,
      reused: true,
      token_available: false,
      message: 'An active QR token already exists. Reissue the health card if the printed QR was lost.',
    });
  }

  if (active && body.reissue) {
    await db.$client.prepare(`
      UPDATE patient_card_qr_tokens
      SET status = 'revoked',
          revoked_at = datetime('now', '+6 hours'),
          revoked_by_user_id = ?,
          revoke_reason = 'reissued'
      WHERE id = ?
    `).bind(userId, active.id).run();
  }

  const maxVersion = await db.$client.prepare(`
    SELECT MAX(card_version) AS mv
    FROM patient_card_qr_tokens
    WHERE tenant_id = ? AND patient_id = ?
  `).bind(tenantId, patientId).first<{ mv: number | null }>();

  const rawToken = generateSecureToken();
  const tokenHash = await sha256(rawToken);
  const version = (maxVersion?.mv ?? 0) + 1;

  const result = await db.$client.prepare(`
    INSERT INTO patient_card_qr_tokens (
      token_hash, token_last4, tenant_id, patient_id, uhid, card_version, issued_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    rawToken.slice(-4),
    tenantId,
    patientId,
    patient.uhid,
    version,
    userId,
  ).run();

  const qrPayload = getCardQrPayload(url.origin, rawToken);
  return c.json({
    token_id: result.meta?.last_row_id ?? null,
    version,
    qr_payload: qrPayload,
    token: rawToken,
    token_available: true,
    message: 'QR token issued. Print it now because the raw token is not retrievable later.',
  }, 201);
});

healthRecordRoutes.post('/health-record/card-qr/scan', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const role = String(c.get('role') ?? '');
  const scope = scanScopeForRole(role);

  if (!canResolveCardQr(role)) {
    throw new HTTPException(403, { message: 'This role cannot scan patient card QR codes' });
  }

  const body: { payload?: string; token?: string } = await c.req.json<{ payload?: string; token?: string }>().catch(() => ({}));
  const rawToken = extractCardQrToken(body.payload ?? body.token ?? '');
  const db = getDb(c.env.DB);
  const token = await loadActiveCardQrToken(db, rawToken);

  if (!token) {
    await auditCardQrScan(db, {
      scannerTenantId: tenantId,
      scannerUserId: userId,
      scannerRole: role,
      action: 'resolve',
      scope,
      outcome: 'not_found',
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    throw new HTTPException(404, { message: 'QR card token not found or revoked' });
  }

  await db.$client.prepare(`
    UPDATE patient_card_qr_tokens
    SET last_scanned_at = datetime('now', '+6 hours'), scan_count = scan_count + 1
    WHERE id = ?
  `).bind(token.id).run();

  const localPatient = await db.$client.prepare(`
    SELECT id, patient_code, name
    FROM patients
    WHERE tenant_id = ? AND uhid = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, token.uhid).first<{ id: number; patient_code: string | null; name: string | null }>();

  const clinicalSummaries: Array<{
    tenant_id: string;
    hospital_name: string | null;
    summary: unknown;
  }> = [];
  if (scope === 'clinical') {
    const linkedPatients = await db.$client.prepare(`
      SELECT p.id, p.tenant_id, t.name AS hospital_name
      FROM patients p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      WHERE p.uhid = ?
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 10
    `).bind(token.uhid).all<{ id: number; tenant_id: string; hospital_name: string | null }>();

    for (const link of linkedPatients.results ?? []) {
      const summary = await buildPortableHealthSummary(c.env.DB, link.tenant_id, link.id);
      if (!summary) continue;
      clinicalSummaries.push({
        tenant_id: link.tenant_id,
        hospital_name: link.hospital_name,
        summary,
      });
    }
  }

  await auditCardQrScan(db, {
    token,
    scannerTenantId: tenantId,
    scannerUserId: userId,
    scannerRole: role,
    action: 'resolve',
    scope,
    outcome: localPatient ? 'resolved_existing_local_patient' : 'resolved_import_available',
    destinationPatientId: localPatient?.id ?? null,
    ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    userAgent: c.req.header('User-Agent') ?? null,
  });

  return c.json({
    resolved: true,
    scope,
    can_import: !localPatient && canImportCardQr(role),
    local_patient: localPatient ? {
      id: localPatient.id,
      patient_code: localPatient.patient_code,
      name: localPatient.name,
    } : null,
    patient: {
      uhid: token.uhid,
      global_identity_id: token.global_identity_id,
      name: token.primary_name ?? token.name ?? 'Patient',
      mobile: token.primary_phone ?? token.mobile,
      email: token.primary_email ?? token.email,
      address: token.address,
      age: token.age,
      gender: token.gender,
      blood_group: token.blood_group,
      date_of_birth: token.date_of_birth,
      source_hospital_name: token.source_hospital_name,
      source_tenant_id: token.tenant_id,
      source_patient_id: token.patient_id,
      source_patient_code: token.patient_code,
    },
    clinical_summaries: scope === 'clinical' ? clinicalSummaries : undefined,
    nursing_context_required: scope === 'nursing_context',
  });
});

healthRecordRoutes.post('/health-record/card-qr/import', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const role = String(c.get('role') ?? '');
  const scope = scanScopeForRole(role);

  if (!canImportCardQr(role)) {
    throw new HTTPException(403, { message: 'This role cannot import patients from QR cards' });
  }

  const body: { payload?: string; token?: string } = await c.req.json<{ payload?: string; token?: string }>().catch(() => ({}));
  const rawToken = extractCardQrToken(body.payload ?? body.token ?? '');
  const db = getDb(c.env.DB);
  const token = await loadActiveCardQrToken(db, rawToken);

  if (!token) {
    await auditCardQrScan(db, {
      scannerTenantId: tenantId,
      scannerUserId: userId,
      scannerRole: role,
      action: 'import',
      scope,
      outcome: 'not_found',
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    throw new HTTPException(404, { message: 'QR card token not found or revoked' });
  }

  const existing = await db.$client.prepare(`
    SELECT id, patient_code, name
    FROM patients
    WHERE tenant_id = ? AND (uhid = ? OR (national_id IS NOT NULL AND national_id = ?))
    ORDER BY CASE WHEN uhid = ? THEN 0 ELSE 1 END, id DESC
    LIMIT 1
  `).bind(tenantId, token.uhid, token.national_id, token.uhid).first<{
    id: number;
    patient_code: string | null;
    name: string | null;
  }>();

  if (existing) {
    await auditCardQrScan(db, {
      token,
      scannerTenantId: tenantId,
      scannerUserId: userId,
      scannerRole: role,
      action: 'import',
      scope,
      outcome: 'already_linked',
      destinationPatientId: existing.id,
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json({
      imported: false,
      already_linked: true,
      patient: existing,
    });
  }

  const patientCode = await getNextSequence(c.env.DB, tenantId, 'patient', 'P');
  const insert = await db.$client.prepare(`
    INSERT INTO patients (
      tenant_id, patient_code, name, father_husband, address, mobile, guardian_mobile,
      age, gender, blood_group, date_of_birth, email, national_id, uhid, global_identity_id,
      source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'qr_card_import', datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    patientCode,
    token.primary_name ?? token.name ?? 'Patient',
    token.father_husband,
    token.address,
    token.primary_phone ?? token.mobile,
    token.guardian_mobile,
    token.age,
    token.gender,
    token.blood_group,
    token.date_of_birth,
    token.primary_email ?? token.email,
    token.national_id,
    token.uhid,
    token.global_identity_id,
  ).run();

  const newPatientId = Number(insert.meta?.last_row_id);

  await auditCardQrScan(db, {
    token,
    scannerTenantId: tenantId,
    scannerUserId: userId,
    scannerRole: role,
    action: 'import',
    scope,
    outcome: 'imported',
    destinationPatientId: Number.isFinite(newPatientId) ? newPatientId : null,
    ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    userAgent: c.req.header('User-Agent') ?? null,
  });

  return c.json({
    imported: true,
    patient: {
      id: newPatientId,
      patient_code: patientCode,
      name: token.primary_name ?? token.name ?? 'Patient',
      uhid: token.uhid,
    },
  }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Health Card Lifecycle — Versioned, Revocable Cards
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Issue a versioned health card ──────────────────────────────────────────

healthRecordRoutes.post('/health-record/cards', zValidator('json', issueCardSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const data = c.req.valid('json');

  if (!['doctor', 'md', 'nurse', 'hospital_admin', 'reception', 'receptionist'].includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical staff can issue health cards' });
  }

  const db = getDb(c.env.DB);

  const patient = await loadPatientActivationContext(db, tenantId, data.patient_id);
  if (!patient.national_id) {
    throw new HTTPException(400, { message: 'Patient must have a National ID to issue a health card' });
  }

  // Generate token for this card
  const rawToken = generateSecureToken();
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + data.duration_hours * 60 * 60 * 1000).toISOString();

  const tokenResult = await db.$client.prepare(`
    INSERT INTO health_record_access_tokens
      (token_hash, national_id, tenant_id, patient_id, scope, created_by_role, created_by_id, expires_at)
    VALUES (?, ?, ?, ?, 'summary', 'staff', ?, ?)
  `).bind(tokenHash, patient.national_id, tenantId, data.patient_id, userId, expiresAt).run();

  const tokenId = tokenResult.meta?.last_row_id;

  // Get next version for this patient
  const maxVersion = await db.$client.prepare(
    'SELECT MAX(version) AS mv FROM health_cards WHERE tenant_id = ? AND patient_id = ?',
  ).bind(tenantId, data.patient_id).first<{ mv: number | null }>();

  const version = (maxVersion?.mv ?? 0) + 1;

  const cardResult = await db.$client.prepare(`
    INSERT INTO health_cards (tenant_id, patient_id, card_type, version, status, token_id, issued_by)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).bind(tenantId, data.patient_id, data.card_type, version, tokenId, userId).run();

  let claimCode: string | null = null;
  let claimCodeExpiresAt: string | null = null;

  const identity = await loadUnclaimedIdentity(db, patient.global_identity_id);

  if (data.activation_mode === 'claim_code' && identity?.id && (identity.claim_status ?? 'unclaimed') === 'unclaimed') {
    const printableCode = await issuePrintableClaimCode(db, {
      tenantId,
      userId: Number(userId),
      patientId: data.patient_id,
      identityId: identity.id,
    });
    claimCode = printableCode.claimCode;
    claimCodeExpiresAt = printableCode.expiresAt;
  }

  return c.json({
    card_id: cardResult.meta?.last_row_id,
    version,
    token: rawToken,
    public_url: data.card_type === 'emergency'
      ? `/api/public/emergency/${rawToken}`
      : `/api/public/summary/${rawToken}`,
    qr_payload: data.card_type === 'emergency'
      ? `/api/public/emergency/${rawToken}`
      : `/api/public/summary/${rawToken}`,
    profile_kind: data.card_type === 'emergency' ? 'emergency' : 'summary',
    activation_mode: data.activation_mode,
    claim_code: claimCode,
    claim_code_expires_at: claimCodeExpiresAt,
    card_type: data.card_type,
    expires_at: expiresAt,
    message: 'Health card issued. Token cannot be retrieved again.',
  }, 201);
});

healthRecordRoutes.post('/health-record/patients/:id/activation-code', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const role = String(c.get('role') ?? '');
  const patientId = Number(c.req.param('id'));

  if (!['doctor', 'md', 'nurse', 'hospital_admin', 'reception', 'receptionist'].includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical staff can issue activation codes' });
  }

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const db = getDb(c.env.DB);
  const patient = await loadPatientActivationContext(db, tenantId, patientId);
  const identity = await loadUnclaimedIdentity(db, patient.global_identity_id);

  if (!identity?.id) {
    throw new HTTPException(404, { message: 'Global identity not linked for this patient' });
  }

  if ((identity.claim_status ?? 'unclaimed') !== 'unclaimed') {
    throw new HTTPException(409, { message: 'Patient card is already claimed' });
  }

  const printableCode = await issuePrintableClaimCode(db, {
    tenantId,
    userId,
    patientId,
    identityId: identity.id,
  });

  return c.json({
    patient_id: patientId,
    uhid: patient.uhid,
    claim_code: printableCode.claimCode,
    claim_code_expires_at: printableCode.expiresAt,
    activation_mode: 'staff_assisted',
    message: 'Activation code generated for staff-assisted claim.',
  }, 201);
});

healthRecordRoutes.get('/health-record/claim-review', async (c) => {
  const tenantId = requireTenantId(c);
  const role = String(c.get('role') ?? '');
  requireClaimReviewRole(role);

  const db = getDb(c.env.DB);
  const limit = parseListLimit(c.req.query('limit'), 25);

  const auditEvents = await db.$client.prepare(`
    SELECT
      paa.id,
      paa.action,
      paa.created_at,
      paa.ip_address,
      json_extract(paa.metadata, '$.uhid') AS uhid,
      json_extract(paa.metadata, '$.reason') AS reason,
      gpi.id AS identity_id
    FROM patient_auth_audit paa
    LEFT JOIN global_patient_auth gpa ON gpa.id = paa.global_user_id
    LEFT JOIN global_patient_identity gpi
      ON gpi.id = gpa.identity_id OR gpi.uhid = json_extract(paa.metadata, '$.uhid')
    WHERE paa.action IN ('claim_card', 'claim_card_failed')
      AND (
        EXISTS (
          SELECT 1
          FROM patient_claim_codes pcc
          WHERE pcc.identity_id = gpi.id AND pcc.issued_by_tenant_id = ?
        )
        OR EXISTS (
          SELECT 1
          FROM patients p
          WHERE p.global_identity_id = gpi.id AND p.tenant_id = ?
        )
      )
    ORDER BY paa.created_at DESC
    LIMIT ?
  `).bind(tenantId, tenantId, limit).all<{
    id: number;
    action: string;
    created_at: string;
    ip_address: string | null;
    uhid: string | null;
    reason: string | null;
    identity_id: number | null;
  }>();

  const claimCodeEvents = await db.$client.prepare(`
    SELECT
      pcc.id,
      pcc.created_at,
      gpi.uhid,
      pcc.expires_at,
      pcc.used_at,
      pcc.issued_for_patient_id,
      pcc.issued_by_user_id
    FROM patient_claim_codes pcc
    JOIN global_patient_identity gpi ON gpi.id = pcc.identity_id
    WHERE pcc.issued_by_tenant_id = ?
    ORDER BY pcc.created_at DESC
    LIMIT ?
  `).bind(tenantId, limit).all<{
    id: number;
    created_at: string;
    uhid: string | null;
    expires_at: string;
    used_at: string | null;
    issued_for_patient_id: number | null;
    issued_by_user_id: number | null;
  }>();

  const events = [
    ...(auditEvents.results ?? []).map((row) => ({
      id: row.id,
      event_type: row.action === 'claim_card_failed' ? 'claim_failed' : 'claim_success',
      created_at: row.created_at,
      uhid: row.uhid,
      ip_address: row.ip_address,
      reason: row.reason,
      identity_id: row.identity_id,
      suspicious: row.action === 'claim_card_failed',
    })),
    ...(claimCodeEvents.results ?? []).map((row) => ({
      id: row.id,
      event_type: 'claim_code_issued',
      created_at: row.created_at,
      uhid: row.uhid,
      expires_at: row.expires_at,
      used_at: row.used_at,
      patient_id: row.issued_for_patient_id,
      issued_by_user_id: row.issued_by_user_id,
      suspicious: false,
      reason: row.used_at ? 'superseded_or_redeemed' : null,
    })),
  ]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);

  return c.json({ events });
});

healthRecordRoutes.get('/health-record/claim-review/stats', async (c) => {
  const tenantId = requireTenantId(c);
  const role = String(c.get('role') ?? '');
  requireClaimReviewRole(role);

  const db = getDb(c.env.DB);

  const auditCounts = await db.$client.prepare(`
    SELECT paa.action, COUNT(*) AS total
    FROM patient_auth_audit paa
    LEFT JOIN global_patient_auth gpa ON gpa.id = paa.global_user_id
    LEFT JOIN global_patient_identity gpi
      ON gpi.id = gpa.identity_id OR gpi.uhid = json_extract(paa.metadata, '$.uhid')
    WHERE paa.action IN ('claim_card', 'claim_card_failed')
      AND (
        EXISTS (
          SELECT 1
          FROM patient_claim_codes pcc
          WHERE pcc.identity_id = gpi.id AND pcc.issued_by_tenant_id = ?
        )
        OR EXISTS (
          SELECT 1
          FROM patients p
          WHERE p.global_identity_id = gpi.id AND p.tenant_id = ?
        )
      )
    GROUP BY action
  `).bind(tenantId, tenantId).all<{ action: string; total: number }>();

  const claimCodeCounts = await db.$client.prepare(`
    SELECT
      SUM(CASE WHEN used_at IS NULL AND expires_at > datetime('now', '+6 hours') THEN 1 ELSE 0 END) AS active_codes,
      SUM(CASE WHEN used_at IS NOT NULL THEN 1 ELSE 0 END) AS redeemed_codes
    FROM patient_claim_codes
    WHERE issued_by_tenant_id = ?
  `).bind(tenantId).first<{ active_codes: number | null; redeemed_codes: number | null }>();

  const topFailureReasons = await db.$client.prepare(`
    SELECT json_extract(paa.metadata, '$.reason') AS reason, COUNT(*) AS total
    FROM patient_auth_audit paa
    LEFT JOIN global_patient_auth gpa ON gpa.id = paa.global_user_id
    LEFT JOIN global_patient_identity gpi
      ON gpi.id = gpa.identity_id OR gpi.uhid = json_extract(paa.metadata, '$.uhid')
    WHERE paa.action = 'claim_card_failed'
      AND (
        EXISTS (
          SELECT 1
          FROM patient_claim_codes pcc
          WHERE pcc.identity_id = gpi.id AND pcc.issued_by_tenant_id = ?
        )
        OR EXISTS (
          SELECT 1
          FROM patients p
          WHERE p.global_identity_id = gpi.id AND p.tenant_id = ?
        )
      )
    GROUP BY reason
    ORDER BY total DESC, reason ASC
    LIMIT 5
  `).bind(tenantId, tenantId).all<{ reason: string | null; total: number }>();

  const countMap = new Map((auditCounts.results ?? []).map((row) => [row.action, Number(row.total ?? 0)]));

  return c.json({
    summary: {
      failed_claim_attempts: countMap.get('claim_card_failed') ?? 0,
      successful_claims: countMap.get('claim_card') ?? 0,
      active_claim_codes: Number(claimCodeCounts?.active_codes ?? 0),
      redeemed_claim_codes: Number(claimCodeCounts?.redeemed_codes ?? 0),
      suspicious_events: countMap.get('claim_card_failed') ?? 0,
    },
    top_failure_reasons: (topFailureReasons.results ?? []).map((row) => ({
      reason: row.reason ?? 'unknown',
      total: Number(row.total ?? 0),
    })),
  });
});

healthRecordRoutes.get('/health-record/clinical-review-inbox', async (c) => {
  const tenantId = requireTenantId(c);
  const role = String(c.get('role') ?? '');
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? '20')));
  const recordTypeFilter = c.req.query('record_type') ?? null;
  const patientIdFilter = c.req.query('patient_id') ? Number(c.req.query('patient_id')) : null;
  const sourceFilter = c.req.query('source') ?? null;
  const sort = c.req.query('sort') === 'oldest' ? 'oldest' : 'newest';
  const groupBy = ['patient_id', 'record_type', 'source'].includes(String(c.req.query('group_by') ?? ''))
    ? String(c.req.query('group_by'))
    : null;

  if (!['doctor', 'md', 'nurse', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical staff can view review inbox' });
  }

  const db = getDb(c.env.DB);
  const [allergies, medications, diagnoses] = await Promise.all([
    db.$client.prepare(`
      SELECT a.id, a.patient_id, p.name as patient_name, p.patient_code,
             'allergy' as record_type, a.allergen as title, a.allergy_type as subtitle,
             'patient_reported' as source, COALESCE(a.review_status, CASE WHEN a.verified_at IS NOT NULL THEN 'verified' ELSE 'pending_review' END) as review_status,
             a.created_at
      FROM patient_allergies a
      JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.is_active = 1
        AND COALESCE(a.review_status, CASE WHEN a.verified_at IS NOT NULL THEN 'verified' ELSE 'pending_review' END) = 'pending_review'
      ORDER BY a.created_at DESC
      LIMIT ?
    `).bind(tenantId, limit).all<Record<string, unknown>>(),
    db.$client.prepare(`
      SELECT m.id, m.patient_id, p.name as patient_name, p.patient_code,
             'medication' as record_type, m.medication_name as title, COALESCE(m.dosage, m.frequency, m.status) as subtitle,
             COALESCE(m.source, 'hospital') as source, COALESCE(m.review_status, CASE WHEN m.source = 'patient_reported' THEN 'pending_review' ELSE 'verified' END) as review_status,
             COALESCE(m.created_at, m.start_date) as created_at
      FROM patient_active_medications m
      JOIN patients p ON p.id = m.patient_id AND p.tenant_id = m.tenant_id
      WHERE m.tenant_id = ? AND m.is_active = 1
        AND COALESCE(m.review_status, CASE WHEN m.source = 'patient_reported' THEN 'pending_review' ELSE 'verified' END) = 'pending_review'
      ORDER BY COALESCE(m.created_at, m.start_date) DESC
      LIMIT ?
    `).bind(tenantId, limit).all<Record<string, unknown>>(),
    db.$client.prepare(`
      SELECT d.DiagnosisId as id, d.PatientId as patient_id, p.name as patient_name, p.patient_code,
             'diagnosis' as record_type, COALESCE(d.icd11_title, d.ICD10Description, d.ICD10Code, 'Diagnosis') as title,
             d.DiagnosisType as subtitle, 'hospital' as source,
             COALESCE(d.review_status, 'verified') as review_status, d.CreatedOn as created_at
      FROM ClinicalDiagnosis d
      JOIN patients p ON p.id = d.PatientId AND p.tenant_id = d.tenant_id
      WHERE d.tenant_id = ? AND d.IsActive = 1
        AND COALESCE(d.review_status, 'verified') = 'pending_review'
      ORDER BY d.CreatedOn DESC
      LIMIT ?
    `).bind(tenantId, limit).all<Record<string, unknown>>(),
  ]);

  const items: Array<Record<string, unknown>> = [...(allergies.results ?? []), ...(medications.results ?? []), ...(diagnoses.results ?? [])]
    .filter((item) => !recordTypeFilter || String(item.record_type) === recordTypeFilter)
    .filter((item) => patientIdFilter == null || Number(item.patient_id) === patientIdFilter)
    .filter((item) => !sourceFilter || String(item.source) === sourceFilter)
    .map((item) => {
      const enriched: Record<string, unknown> = {
        ...item,
        actions: {
          review_path: String(item.record_type) === 'allergy'
            ? `/api/allergies/${item.id}/review`
            : String(item.record_type) === 'medication'
              ? `/api/e-prescribing/patient/${item.patient_id}/medications/${item.id}/review`
              : `/api/diagnosis/${item.id}/review`,
          approve_method: 'PUT',
          reject_method: 'PUT',
        },
      };
      return enriched;
    })
    .sort((a, b) => sort === 'oldest'
      ? String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
      : String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, limit);

  const stats = {
    total_pending: items.length,
    by_record_type: items.reduce<Record<string, number>>((acc, item) => {
      const key = String(item.record_type ?? 'unknown');
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    by_source: items.reduce<Record<string, number>>((acc, item) => {
      const key = String(item.source ?? 'unknown');
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };

  const grouping = groupBy
    ? {
      key: groupBy,
      buckets: Object.entries(items.reduce<Record<string, number>>((acc, item) => {
        const key = String(item[groupBy] ?? 'unknown');
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}))
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    }
    : null;

  const presets = [
    { id: 'patient_reported', label: 'Patient Reported', query: { source: 'patient_reported' } },
    { id: 'medications_only', label: 'Medication Reviews', query: { record_type: 'medication' } },
    { id: 'diagnoses_only', label: 'Diagnosis Reviews', query: { record_type: 'diagnosis' } },
  ];

  return c.json({
    items,
    total: items.length,
    sort,
    grouping,
    stats,
    presets,
    filters: {
      record_type: recordTypeFilter,
      patient_id: patientIdFilter,
      source: sourceFilter,
      group_by: groupBy,
    },
  });
});

// ─── Revoke a health card ───────────────────────────────────────────────────

healthRecordRoutes.post('/health-record/cards/:id/revoke', zValidator('json', revokeCardSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const cardId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  if (!['doctor', 'md', 'nurse', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical staff can revoke health cards' });
  }

  const db = getDb(c.env.DB);

  const card = await db.$client.prepare(
    'SELECT * FROM health_cards WHERE id = ? AND tenant_id = ?',
  ).bind(cardId, tenantId).first<{
    id: number; patient_id: number; status: string; token_id: number | null; card_type: string;
  }>();

  if (!card) throw new HTTPException(404, { message: 'Card not found' });
  if (card.status !== 'active' && card.status !== 'stale') {
    throw new HTTPException(400, { message: `Card is already ${card.status}` });
  }

  // Revoke the card
  await db.$client.prepare(`
    UPDATE health_cards SET status = 'revoked', revoked_at = datetime('now', '+6 hours'), revoke_reason = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(data.reason, cardId, tenantId).run();

  // Deactivate the linked access token
  if (card.token_id) {
    await db.$client.prepare(
      'UPDATE health_record_access_tokens SET is_active = 0 WHERE id = ?',
    ).bind(card.token_id).run();
  }

  let replacement = null;

  // Optionally issue replacement card
  if (data.issue_replacement) {
    const patient = await db.$client.prepare(
      'SELECT national_id FROM patients WHERE id = ? AND tenant_id = ?',
    ).bind(card.patient_id, tenantId).first<{ national_id: string | null }>();

    if (patient?.national_id) {
      const rawToken = generateSecureToken();
      const tokenHash = await sha256(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const tokenResult = await db.$client.prepare(`
        INSERT INTO health_record_access_tokens
          (token_hash, national_id, tenant_id, patient_id, scope, created_by_role, created_by_id, expires_at)
        VALUES (?, ?, ?, ?, 'summary', 'staff', ?, ?)
      `).bind(tokenHash, patient.national_id, tenantId, card.patient_id, userId, expiresAt).run();

      const maxVersion = await db.$client.prepare(
        'SELECT MAX(version) AS mv FROM health_cards WHERE tenant_id = ? AND patient_id = ?',
      ).bind(tenantId, card.patient_id).first<{ mv: number | null }>();

      const newVersion = (maxVersion?.mv ?? 0) + 1;

      const newCardResult = await db.$client.prepare(`
        INSERT INTO health_cards (tenant_id, patient_id, card_type, version, status, token_id, issued_by)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
      `).bind(tenantId, card.patient_id, card.card_type, newVersion, tokenResult.meta?.last_row_id, userId).run();

      // Link old card to replacement
      await db.$client.prepare(
        'UPDATE health_cards SET replaced_by_id = ? WHERE id = ?',
      ).bind(newCardResult.meta?.last_row_id, cardId).run();

      replacement = {
        card_id: newCardResult.meta?.last_row_id,
        version: newVersion,
        token: rawToken,
        expires_at: expiresAt,
      };
    }
  }

  return c.json({
    message: `Card #${cardId} revoked`,
    replacement,
  });
});

// ─── List patient's health cards ────────────────────────────────────────────

healthRecordRoutes.get('/health-record/cards', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.query('patient_id'));

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'patient_id query param required' });
  }

  const db = getDb(c.env.DB);
  const { results } = await db.$client.prepare(`
    SELECT hc.id, hc.card_type, hc.version, hc.status, hc.issued_at, hc.revoked_at,
      hc.revoke_reason, hc.replaced_by_id,
      hat.expires_at, hat.access_count, hat.last_accessed_at
    FROM health_cards hc
    LEFT JOIN health_record_access_tokens hat ON hc.token_id = hat.id
    WHERE hc.tenant_id = ? AND hc.patient_id = ?
    ORDER BY hc.version DESC
  `).bind(tenantId, patientId).all();

  return c.json({ Results: results });
});

// ─── GET /health-record/consent-options ──────────────────────────────
// Returns available clinical areas + purposes for UI dropdowns

healthRecordRoutes.get('/health-record/consent-options', async (c) => {
  return c.json({
    clinical_areas: ['labs', 'prescriptions', 'vitals', 'allergies', 'visits', 'diagnoses', 'all'],
    purposes: ['TREATMENT', 'PAYMENT', 'OPERATIONS', 'RESEARCH', 'MARKETING'],
    consent_types: ['view_summary', 'view_full', 'emergency_access'],
    defaults: {
      TREATMENT: { auto_grant: true, scope: 'view_summary', areas: null },
      PAYMENT: { auto_grant: true, scope: 'view_summary', areas: ['diagnoses', 'visits'] },
      OPERATIONS: { auto_grant: false, scope: 'none', areas: null },
      RESEARCH: { auto_grant: false, scope: 'none', areas: null },
      MARKETING: { auto_grant: false, scope: 'none', areas: null },
    },
  });
});

// ─── POST /health-record/admin/consent-cleanup ───────────────────────
// Triggers batch cleanup of expired consents. Admin-only.

healthRecordRoutes.post('/health-record/admin/consent-cleanup', async (c) => {
  const role = String(c.get('role') ?? '');
  if (role !== 'admin' && role !== 'superadmin') {
    throw new HTTPException(403, { message: 'Admin role required' });
  }

  const result = await cleanupExpiredConsents(c.env.DB);
  return c.json(result);
});

// ─── GET /health-record/admin/consent-stats ──────────────────────────
// Returns consent expiry statistics for this tenant

healthRecordRoutes.get('/health-record/admin/consent-stats', async (c) => {
  const tenantId = requireTenantId(c);
  const role = String(c.get('role') ?? '');
  if (role !== 'admin' && role !== 'superadmin' && role !== 'doctor') {
    throw new HTTPException(403, { message: 'Insufficient role' });
  }

  const stats = await getConsentExpiryStats(c.env.DB, tenantId);
  return c.json(stats);
});

export default healthRecordRoutes;

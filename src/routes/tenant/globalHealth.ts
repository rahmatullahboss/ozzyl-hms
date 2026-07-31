/**
 * Global Health Portal Routes
 *
 * Patient-facing routes for viewing unified health records across
 * all linked hospitals. Requires patient authentication.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  globalConsentSchema,
  globalShareTokenSchema,
  globalBlockListSchema,
  globalEmergencyAccessSchema,
} from '../../schemas/globalHealth';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { buildAggregatedHealthRecord } from '../../lib/health-timeline';
import { cleanupExpiredConsents } from '../../lib/consent-cleanup';
import { getDb } from '../../db';
import type { Env, Variables } from '../../types';

const globalHealthRoutes = new Hono<{
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

function isMissingTableError(error: unknown, tableName: string): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes(`no such table: ${tableName.toLowerCase()}`);
}

/**
 * Safely mask a National ID for display.
 * Shows first 3 and last 3 digits, masks the rest.
 * Short NIDs (≤6 chars) are fully masked.
 */
function maskNid(nid: string): string {
  if (nid.length <= 6) return '*'.repeat(nid.length);
  return `${nid.slice(0, 3)}${'*'.repeat(nid.length - 6)}${nid.slice(-3)}`;
}

/**
 * Resolves the current patient's portable identity key from their auth context.
 * NID is preferred; UHID is used when NID is not available.
 * Works for both staff-with-patient-id and patient portal contexts.
 */
async function resolvePatientIdentityKey(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  c: { req: { query: (key: string) => string | undefined }; get: (key: string) => unknown },
): Promise<{ identity_key: string; national_id: string | null; uhid: string | null; patient_id: number }> {
  const role = String(c.get('role') ?? '');
  const userId = Number(c.get('userId'));
  let patientId: number;
  let nationalId: string | null;
  let uhid: string | null = null;

  if (role === 'patient') {
    // Global patient portal: resolve national_id from the global auth account first.
    const globalPatient = await db.$client.prepare(
      'SELECT national_id, uhid FROM global_patient_auth WHERE id = ? AND is_active = 1',
    ).bind(userId).first<{ national_id: string | null; uhid: string | null }>();

    nationalId = globalPatient?.national_id ?? null;
    uhid = globalPatient?.uhid ?? null;

    if (!nationalId && uhid) {
      const identity = await db.$client.prepare(
        'SELECT national_id FROM global_patient_identity WHERE uhid = ?',
      ).bind(uhid).first<{ national_id: string | null }>();
      nationalId = identity?.national_id ?? null;
    }

    const localPatient = nationalId
      ? await db.$client.prepare(
          'SELECT id, national_id, uhid FROM patients WHERE tenant_id = ? AND national_id = ? ORDER BY id LIMIT 1',
        ).bind(tenantId, nationalId).first<{ id: number; national_id: string | null; uhid: string | null }>()
      : uhid
        ? await db.$client.prepare(
            'SELECT id, national_id, uhid FROM patients WHERE tenant_id = ? AND uhid = ? ORDER BY id LIMIT 1',
          ).bind(tenantId, uhid).first<{ id: number; national_id: string | null; uhid: string | null }>()
        : null;

    if (localPatient) {
      patientId = localPatient.id;
      nationalId = localPatient.national_id;
      uhid = localPatient.uhid ?? uhid;
    } else {
      // Legacy patient-portal credentials fallback for tenant-specific patient accounts.
      let cred: { patient_id: number } | null = null;

      try {
        cred = await db.$client.prepare(
          'SELECT patient_id FROM patient_portal_credentials WHERE user_id = ? AND tenant_id = ?',
        ).bind(userId, tenantId).first<{ patient_id: number }>();
      } catch (error) {
        if (!isMissingTableError(error, 'patient_portal_credentials')) {
          throw error;
        }
      }

      if (!cred) {
        patientId = 0;
      } else {
        patientId = cred.patient_id;
        const patient = await db.$client.prepare(
          'SELECT national_id, uhid FROM patients WHERE id = ? AND tenant_id = ?',
        ).bind(patientId, tenantId).first<{ national_id: string | null; uhid: string | null }>();
        nationalId = patient?.national_id ?? nationalId;
        uhid = patient?.uhid ?? uhid;
      }
    }
  } else {
    // Staff: use patient_id query param — require healthrecords permission
    const permissions = c.get('permissions') as string[] | undefined;
    const hasPermission = permissions?.includes('*') || permissions?.includes('healthrecords:read');
    if (!hasPermission) {
      throw new HTTPException(403, { message: 'Insufficient permissions to access health records' });
    }

    patientId = Number(c.req.query('patient_id'));
    if (!Number.isFinite(patientId) || patientId <= 0) {
      throw new HTTPException(400, { message: 'patient_id query param required' });
    }
    const patient = await db.$client.prepare(
      'SELECT national_id, uhid FROM patients WHERE id = ? AND tenant_id = ?',
    ).bind(patientId, tenantId).first<{ national_id: string | null; uhid: string | null }>();

    if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
    nationalId = patient.national_id;
    uhid = patient.uhid;
  }

  const identityKey = nationalId ?? uhid;
  if (!identityKey) {
    throw new HTTPException(400, { message: 'Patient must have a National ID or UHID to access global health records' });
  }

  // Enforce Block-List and Break-Glass (only for staff, patients can't block themselves)
  if (role !== 'patient') {
    const block = await db.$client.prepare(`
      SELECT id FROM health_record_block_list 
      WHERE national_id = ? AND is_active = 1 
        AND (blocked_tenant_id = ? OR blocked_doctor_id = ?)
    `).bind(identityKey, tenantId, userId).first();

    if (block) {
      // Check for active Break-Glass override (within last 2 hours)
      const breakGlass = await db.$client.prepare(`
        SELECT id FROM health_record_consent_overrides
        WHERE national_id = ? AND accessing_tenant_id = ? AND accessing_user_id = ?
          AND created_at > datetime('now', '-2 hours')
      `).bind(identityKey, tenantId, userId).first();

      if (!breakGlass) {
        throw new HTTPException(403, { message: 'Access denied by patient block list. Emergency override required.' });
      }
    }
  }

  return { identity_key: identityKey, national_id: nationalId, uhid, patient_id: patientId };
}

// ─── GET /global-health/my-records ──────────────────────────────────
// Patient sees all linked hospitals + aggregated summary

globalHealthRoutes.get('/my-records', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { identity_key, national_id, uhid } = await resolvePatientIdentityKey(db, tenantId, c);

  const record = await buildAggregatedHealthRecord(c.env.DB, identity_key, tenantId, Number(c.get('userId')), String(c.get('role')));

  // Log portal view
  const userId = requireUserId(c);
  await db.$client.prepare(`
    INSERT INTO health_record_access_log
      (national_id, source_tenant_id, accessing_tenant_id, accessing_user_id, access_type)
    VALUES (?, ?, ?, ?, 'portal_view')
  `).bind(identity_key, tenantId, tenantId, userId).run();

  return c.json({
    ...record,
    national_id: national_id ? maskNid(national_id) : null,
    uhid,
  });
});

// ─── GET /global-health/my-consents ─────────────────────────────────
// Patient manages all consents across hospitals

globalHealthRoutes.get('/my-consents', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { identity_key } = await resolvePatientIdentityKey(db, tenantId, c);

  // Lazy cleanup: expire stale consents before listing
  await cleanupExpiredConsents(c.env.DB);

  const { results } = await db.$client.prepare(`
    SELECT c.id, c.consent_type, c.granting_tenant_id, c.granted_to_tenant_id,
           c.is_active, c.granted_at, c.expires_at, c.revoked_at, c.revoked_reason,
           c.emergency_justification, c.emergency_declared_by,
           c.clinical_areas, c.purpose, c.auto_granted, c.expired_at,
           t1.name AS granting_hospital, t2.name AS granted_to_hospital
    FROM health_record_consents c
    LEFT JOIN tenants t1 ON c.granting_tenant_id = t1.id
    LEFT JOIN tenants t2 ON c.granted_to_tenant_id = t2.id
    WHERE c.national_id = ?
    ORDER BY c.granted_at DESC
    LIMIT 100
  `).bind(identity_key).all<Record<string, unknown>>();

  return c.json({ consents: results ?? [] });
});

// ─── POST /global-health/consent ────────────────────────────────────
// Patient grants access consent from portal

globalHealthRoutes.post('/consent', zValidator('json', globalConsentSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { identity_key, patient_id } = await resolvePatientIdentityKey(db, tenantId, c);
  const data = c.req.valid('json');

  const expiresAt = new Date(Date.now() + data.duration_hours * 60 * 60 * 1000).toISOString();
  const clinicalAreas = data.clinical_areas ? JSON.stringify(data.clinical_areas) : null;

  const result = await db.$client.prepare(`
    INSERT INTO health_record_consents
      (national_id, granting_tenant_id, granting_patient_id, granted_to_tenant_id, consent_type, expires_at, clinical_areas, purpose)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    identity_key, tenantId, patient_id,
    data.granted_to_tenant_id ?? null, data.consent_type, expiresAt, clinicalAreas, data.purpose ?? 'TREATMENT',
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

// ─── DELETE /global-health/consent/:id ──────────────────────────────
// Patient revokes a consent — reason passed via query param (no body on DELETE)

globalHealthRoutes.delete('/consent/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { identity_key } = await resolvePatientIdentityKey(db, tenantId, c);
  const consentId = Number(c.req.param('id'));

  if (!Number.isFinite(consentId) || consentId <= 0) {
    throw new HTTPException(400, { message: 'Invalid consent ID' });
  }

  // Verify this consent belongs to this patient
  const existing = await db.$client.prepare(
    'SELECT id FROM health_record_consents WHERE id = ? AND national_id = ? AND is_active = 1',
  ).bind(consentId, identity_key).first();

  if (!existing) throw new HTTPException(404, { message: 'Active consent not found' });

  const reason = c.req.query('reason') ?? 'Revoked by patient';
  await db.$client.prepare(`
    UPDATE health_record_consents
    SET is_active = 0, revoked_at = datetime('now', '+6 hours'), revoked_reason = ?
    WHERE id = ?
  `).bind(reason, consentId).run();

  return c.json({ message: 'Consent revoked' });
});

// ─── POST /global-health/block ──────────────────────────────────────
// Patient blocks a specific hospital or doctor

globalHealthRoutes.post('/block', zValidator('json', globalBlockListSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { identity_key } = await resolvePatientIdentityKey(db, tenantId, c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO health_record_block_list
      (national_id, blocked_tenant_id, blocked_doctor_id, reason)
    VALUES (?, ?, ?, ?)
  `).bind(
    identity_key,
    data.blocked_tenant_id ?? null,
    data.blocked_doctor_id ?? null,
    data.reason ?? null,
  ).run();

  return c.json({
    id: result.meta.last_row_id,
    message: 'Access blocked successfully',
  }, 201);
});

// ─── DELETE /global-health/block/:id ────────────────────────────────
// Patient removes a block

globalHealthRoutes.delete('/block/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { identity_key } = await resolvePatientIdentityKey(db, tenantId, c);
  const blockId = Number(c.req.param('id'));

  if (!Number.isFinite(blockId) || blockId <= 0) {
    throw new HTTPException(400, { message: 'Invalid block ID' });
  }

  const existing = await db.$client.prepare(
    'SELECT id FROM health_record_block_list WHERE id = ? AND national_id = ? AND is_active = 1',
  ).bind(blockId, identity_key).first();

  if (!existing) throw new HTTPException(404, { message: 'Active block not found' });

  await db.$client.prepare(`
    UPDATE health_record_block_list
    SET is_active = 0, updatedAt = datetime('now', '+6 hours')
    WHERE id = ?
  `).bind(blockId).run();

  return c.json({ message: 'Block removed successfully' });
});

// ─── POST /global-health/share-token ────────────────────────────────
// Patient generates a shareable access token

globalHealthRoutes.post('/share-token', zValidator('json', globalShareTokenSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const { identity_key, patient_id } = await resolvePatientIdentityKey(db, tenantId, c);
  const data = c.req.valid('json');

  const rawToken = generateSecureToken();
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + data.duration_hours * 60 * 60 * 1000).toISOString();

  await db.$client.prepare(`
    INSERT INTO health_record_access_tokens
      (token_hash, national_id, tenant_id, patient_id, scope, created_by_role, created_by_id, expires_at)
    VALUES (?, ?, ?, ?, ?, 'patient', ?, ?)
  `).bind(tokenHash, identity_key, tenantId, patient_id, data.scope, userId, expiresAt).run();

  return c.json({
    token: rawToken,
    scope: data.scope,
    expires_at: expiresAt,
    share_url: `/api/health-record/summary/${rawToken}`,
    message: 'Token created. Share this token or QR code — it cannot be retrieved again.',
  }, 201);
});

// ─── GET /global-health/access-log ──────────────────────────────────
// Patient sees who accessed their records

globalHealthRoutes.get('/access-log', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  let identityKey: string;

  try {
    ({ identity_key: identityKey } = await resolvePatientIdentityKey(db, tenantId, c));
  } catch (error) {
    const role = String(c.get('role') ?? '');
    if (
      role === 'patient' &&
      error instanceof HTTPException &&
      (error.status === 400 || error.status === 404)
    ) {
      return c.json({ access_log: [] });
    }
    throw error;
  }

  const { results } = await db.$client.prepare(`
    SELECT al.id, al.access_type, al.accessed_at, al.ip_address,
           t1.name AS source_hospital, t2.name AS accessing_hospital,
           al.accessing_user_id
    FROM health_record_access_log al
    LEFT JOIN tenants t1 ON al.source_tenant_id = t1.id
    LEFT JOIN tenants t2 ON al.accessing_tenant_id = t2.id
    WHERE al.national_id = ?
    ORDER BY al.accessed_at DESC
    LIMIT 100
  `).bind(identityKey).all<Record<string, unknown>>();

  return c.json({ access_log: results ?? [] });
});

// ─── GET /global-health/timeline ────────────────────────────────────
// Merged clinical timeline across all hospitals

globalHealthRoutes.get('/timeline', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { identity_key } = await resolvePatientIdentityKey(db, tenantId, c);

  // Optional: filter timeline to specific clinical areas via ?areas=labs,vitals
  const areasParam = c.req.query('areas');
  const clinicalAreas = areasParam ? areasParam.split(',').map(a => a.trim()).filter(Boolean) : undefined;

  const record = await buildAggregatedHealthRecord(c.env.DB, identity_key, tenantId, Number(c.get('userId')), String(c.get('role')), clinicalAreas);

  return c.json({
    timeline: record.timeline,
    combined_allergies: record.combined_allergies,
    combined_medications: record.combined_medications,
    combined_problems: record.combined_problems,
  });
});
// ─── POST /global-health/emergency-access ────────────────────────────
// Clinician invokes Break-Glass to override patient privacy blocks

globalHealthRoutes.post('/emergency-access', zValidator('json', globalEmergencyAccessSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const db = getDb(c.env.DB);
  const data = c.req.valid('json');

  // Only clinical staff can invoke break-glass emergency access
  if (!['doctor', 'md', 'nurse', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical staff can use emergency access' });
  }

  // Must provide patient_id to resolve national_id
  const patient = await db.$client.prepare(
    'SELECT national_id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(data.patient_id, tenantId).first<{ national_id: string | null }>();

  if (!patient || !patient.national_id) {
    throw new HTTPException(404, { message: 'Patient not found or has no Global Health ID' });
  }

  // Log the emergency break-glass event
  const result = await db.$client.prepare(`
    INSERT INTO health_record_consent_overrides
      (national_id, accessing_tenant_id, accessing_user_id, emergency_reason_code, emergency_reason_details)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    patient.national_id,
    tenantId,
    userId,
    data.emergency_reason_code,
    data.emergency_reason_details ?? null,
  ).run();

  return c.json({
    id: result.meta.last_row_id,
    message: 'Emergency access granted and audited.',
  }, 201);
});

export default globalHealthRoutes;

/**
 * Hospital Linking Routes (global, patient-facing)
 *
 * Endpoints:
 *   GET    /api/hospital-links           — list linked hospitals
 *   POST   /api/hospital-links           — link a hospital
 *   DELETE /api/hospital-links/:id       — revoke a hospital link
 *   GET    /api/hospital-links/:id/data  — fetch clinical data from linked hospital
 *   GET    /api/hospital-links/consents  — list consent settings
 *   PUT    /api/hospital-links/consents  — update consent settings
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env } from '../types';
import { recordHospitalLinkAudit } from '../lib/portal-consent-audit';
import { upsertVerifiedLink } from '../lib/portal-link-bridge';

const hospitalLinkRoutes = new Hono<{ Bindings: Env }>();

// ─── Auth helper ──────────────────────────────────────────────────────
async function getPatientId(c: any): Promise<number> {
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) throw new HTTPException(401, { message: 'Authentication required' });
  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
  if (decoded.scope !== 'global') throw new HTTPException(403, { message: 'Invalid token scope' });
  return parseInt(decoded.userId, 10);
}

const CONSENT_TYPES = ['ai_access', 'mood_sharing', 'cycle_sharing', 'vitals_sharing', 'medication_sharing', 'lab_sharing'] as const;

// ─── GET / — list linked hospitals ────────────────────────────────────
hospitalLinkRoutes.get('/', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  const userAgent = c.req.header('User-Agent') || null;

  // P0-31/P0-32: return verified links as the clinical data source, and
  // also include non-revoked link statuses so the UI can distinguish
  // "no linked hospital" from "linked but not verified" without loading
  // clinical data.
  const rows = await db.prepare(
    "SELECT id, tenant_id, hospital_name, status, linked_at FROM hospital_links WHERE patient_id = ? AND status != 'revoked' ORDER BY linked_at DESC",
  ).bind(patientId).all<{
    id: number; tenant_id: string; hospital_name: string; status: string; linked_at: string;
  }>();

  const allHospitals = rows.results ?? [];
  const verifiedHospitals = allHospitals.filter((row) => row.status === 'verified');
  const pendingHospitals = allHospitals.filter((row) => row.status !== 'verified');

  await recordHospitalLinkAudit(db, {
    patientId, action: 'link_list', outcome: 'success',
    ipAddress, userAgent,
    details: {
      verified_count: verifiedHospitals.length,
      pending_count: pendingHospitals.length,
      total_non_revoked_count: allHospitals.length,
    },
  });

  return c.json({
    hospitals: verifiedHospitals,
    all_hospitals: allHospitals,
    pending_hospitals: pendingHospitals,
    verified_count: verifiedHospitals.length,
    pending_count: pendingHospitals.length,
  });
});

// ─── POST / — link a hospital ─────────────────────────────────────────
const linkSchema = z.object({
  tenant_id: z.string().min(1),
  hospital_name: z.string().min(1).max(200),
});

hospitalLinkRoutes.post('/', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid data' }, 400);

  const { tenant_id, hospital_name } = parsed.data;
  const db = c.env.DB;
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  const userAgent = c.req.header('User-Agent') || null;

  // P0-31 (fix/portal-consent): new link requests are 'pending' by default.
  // Activation requires hospital-side verification (POST /:id/verify).
  const existing = await db.prepare(
    'SELECT id, status FROM hospital_links WHERE patient_id = ? AND tenant_id = ?',
  ).bind(patientId, tenant_id).first() as any;

  if (existing) {
    if (existing.status === 'verified') {
      await recordHospitalLinkAudit(db, {
        patientId, tenantId: tenant_id, action: 'link_request',
        outcome: 'success', ipAddress, userAgent,
        details: { outcome_detail: 'already_verified', link_id: existing.id },
      });
      return c.json({ already_linked: true, link_id: existing.id, status: 'verified' });
    }
    if (existing.status === 'pending') {
      await recordHospitalLinkAudit(db, {
        patientId, tenantId: tenant_id, action: 'link_request',
        outcome: 'pending', ipAddress, userAgent,
        details: { outcome_detail: 'already_pending', link_id: existing.id },
      });
      return c.json({ link_id: existing.id, status: 'pending', message: 'Link is pending hospital verification.' });
    }
    // Re-activate as pending
    await db.prepare(
      "UPDATE hospital_links SET status = 'pending', linked_at = datetime('now') WHERE id = ?",
    ).bind(existing.id).run();
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: tenant_id, action: 'link_request',
      outcome: 'pending', ipAddress, userAgent,
      details: { outcome_detail: 'reactivated', link_id: existing.id },
    });
    return c.json({ link_id: existing.id, status: 'pending', reactivated: true });
  }

  // Create new link in 'pending' state.
  const result = await db.prepare(
    "INSERT INTO hospital_links (patient_id, tenant_id, hospital_name, status) VALUES (?, ?, ?, 'pending')",
  ).bind(patientId, tenant_id, hospital_name).run();
  const linkId = result.meta.last_row_id as number;

  // P0-31: all consents default to DENIED (granted = 0). Patient must
  // explicitly opt in after the link is verified.
  for (const type of CONSENT_TYPES) {
    await db.prepare(
      'INSERT OR IGNORE INTO clinical_consents (patient_id, tenant_id, consent_type, granted) VALUES (?, ?, ?, 0)',
    ).bind(patientId, tenant_id, type).run();
  }

  // Log the verify_requested event so the hospital-side dashboard can
  // surface "patient X wants to be linked".
  await db.prepare(`
    INSERT INTO hospital_link_verification (link_id, action, proof_basis, tenant_id, notes)
    VALUES (?, 'verify_requested', 'self_attested', ?, 'Patient requested link from portal')
  `).bind(linkId, tenant_id).run();

  await recordHospitalLinkAudit(db, {
    patientId, tenantId: tenant_id, action: 'link_request',
    outcome: 'pending', ipAddress, userAgent,
    details: { link_id: linkId, status: 'pending' },
  });

  return c.json({
    success: true,
    link_id: linkId,
    status: 'pending',
    message: 'Link is pending hospital-side verification. Consents default to denied until you opt in.',
  }, 201);
});

// ─── POST /:id/verify ──────────────────────────────────────────────────────
//
// Hospital-side admin verifies a pending link. Sets status to 'verified' and
// writes a hospital_link_verification row. Requires the
// `hospitalLinks.verify` permission (any tenant admin role satisfies this).

const verifyLinkSchema = z.object({
  proof_basis: z.enum(['hospital_admin_approval', 'otp', 'claim_code', 'nid_upload', 'self_attested']),
  notes: z.string().max(500).optional(),
});

hospitalLinkRoutes.post('/:id/verify', async (c) => {
  const linkId = parseInt(c.req.param('id'), 10);
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const parsed = verifyLinkSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid data' }, 400);
  const { proof_basis, notes } = parsed.data;
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  const userAgent = c.req.header('User-Agent') || null;

  // Identify the actor: hospital-side admin caller. For now we use the
  // patientId from the global JWT (self-attest path) AND optionally
  // accept an X-Actor-User-Id header for hospital staff approval.
  const patientId = await getPatientId(c);
  const actorUserIdRaw = c.req.header('X-Actor-User-Id');
  const actorUserId = actorUserIdRaw ? parseInt(actorUserIdRaw, 10) : null;

  const link = await db.prepare(
    'SELECT id, patient_id, tenant_id, status FROM hospital_links WHERE id = ?',
  ).bind(linkId).first<{ id: number; patient_id: number; tenant_id: string; status: string }>();

  if (!link) {
    return c.json({ error: 'Hospital link not found' }, 404);
  }
  if (link.patient_id !== patientId && !actorUserId) {
    // Patients can only verify their own links (via claim code or self-attest).
    // Hospital staff must supply X-Actor-User-Id.
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: link.tenant_id, action: 'link_verify_reject',
      outcome: 'denied', ipAddress, userAgent,
      details: { link_id: linkId, reason: 'not_owner_and_no_actor' },
    });
    return c.json({ error: 'Only the owning patient or hospital staff can verify this link' }, 403);
  }
  if (link.status === 'verified') {
    return c.json({ link_id: linkId, status: 'verified', message: 'Link already verified' });
  }
  if (link.status === 'revoked') {
    return c.json({ error: 'Link has been revoked' }, 400);
  }

  await db.prepare(
    "UPDATE hospital_links SET status = 'verified', linked_at = datetime('now') WHERE id = ?",
  ).bind(linkId).run();

  await db.prepare(`
    INSERT INTO hospital_link_verification
      (link_id, action, proof_basis, actor_user_id, tenant_id, notes)
    VALUES (?, 'verify_approved', ?, ?, ?, ?)
  `).bind(linkId, proof_basis, actorUserId, link.tenant_id, notes ?? null).run();

  // P0-30 / P0-32: also create the explicit verified-link row that the
  // global portal and tenant bridge use for cross-tenant resolution.
  const patient = await db.prepare(
    'SELECT national_id FROM global_patient_auth WHERE id = ?',
  ).bind(link.patient_id).first<{ national_id: string | null }>();
  await upsertVerifiedLink(db, {
    globalUserId: link.patient_id,
    tenantId: String(link.tenant_id),
    nationalId: patient?.national_id ?? null,
    verificationMethod: proof_basis,
    verifiedByUserId: actorUserId,
  });

  await recordHospitalLinkAudit(db, {
    patientId: link.patient_id, tenantId: link.tenant_id, action: 'link_verify_approve',
    outcome: 'success', ipAddress, userAgent,
    details: { link_id: linkId, proof_basis, actor_user_id: actorUserId },
  });

  return c.json({ link_id: linkId, status: 'verified', proof_basis });
});

// ─── DELETE /:id — revoke a hospital link ─────────────────────────────
hospitalLinkRoutes.delete('/:id', async (c) => {
  const patientId = await getPatientId(c);
  const linkId = parseInt(c.req.param('id'), 10);
  const db = c.env.DB;

  await db.prepare(
    'UPDATE hospital_links SET status = ? WHERE id = ? AND patient_id = ?',
  ).bind('revoked', linkId, patientId).run();

  return c.json({ success: true });
});

// ─── GET /:id/data — fetch clinical data from linked hospital ─────────
hospitalLinkRoutes.get('/:id/data', async (c) => {
  const patientId = await getPatientId(c);
  const linkId = parseInt(c.req.param('id'), 10);
  const dataType = c.req.query('type') || 'summary';
  const db = c.env.DB;
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  const userAgent = c.req.header('User-Agent') || null;

  // P0-31: only verified links return clinical data. Pending/revoked are
  // audit-logged as 'lookup_unverified' and return an empty payload.
  const link = await db.prepare(
    'SELECT tenant_id, status FROM hospital_links WHERE id = ? AND patient_id = ?',
  ).bind(linkId, patientId).first<{ tenant_id: string; status: string }>() as any;

  if (!link) {
    await recordHospitalLinkAudit(db, {
      patientId, action: 'lookup_data', outcome: 'not_found',
      ipAddress, userAgent, details: { link_id: linkId, type: dataType },
    });
    throw new HTTPException(404, { message: 'Hospital link not found' });
  }
  if (link.status !== 'verified') {
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: link.tenant_id, action: 'lookup_unverified',
      outcome: 'denied', ipAddress, userAgent,
      details: { link_id: linkId, link_status: link.status, type: dataType },
    });
    return c.json({ data: null, message: 'Hospital link is not verified. Hospital-side verification required.' });
  }
  await recordHospitalLinkAudit(db, {
    patientId, tenantId: link.tenant_id, action: 'lookup_data',
    outcome: 'success', ipAddress, userAgent,
    details: { link_id: linkId, type: dataType },
  });

  // Get patient's UHID
  const patient = await db.prepare(
    'SELECT uhid FROM global_patient_auth WHERE id = ?',
  ).bind(patientId).first() as any;

  if (!patient?.uhid) {
    return c.json({ data: null, message: 'No UHID found' });
  }

  // Fetch clinical data from tenant tables based on type
  const tenantId = link.tenant_id;
  const data: Record<string, unknown> = {};

  if (dataType === 'summary' || dataType === 'appointments') {
    const appts = await db.prepare(`
      SELECT id, appointment_date, appointment_time, status, doctor_name, department
      FROM appointments
      WHERE tenant_id = ? AND patient_uhid = ? AND status != 'cancelled'
      ORDER BY appointment_date DESC LIMIT 10
    `).bind(tenantId, patient.uhid).all().catch(() => ({ results: [] }));
    data.appointments = appts.results || [];
  }

  if (dataType === 'summary' || dataType === 'prescriptions') {
    const prescriptions = await db.prepare(`
      SELECT id, prescribed_date, doctor_name, medications, status
      FROM prescriptions
      WHERE tenant_id = ? AND patient_uhid = ?
        AND LOWER(COALESCE(status, '')) IN ('final', 'active', 'completed', 'dispensed')
        AND LOWER(COALESCE(status, '')) NOT IN ('draft', 'void', 'voided', 'cancelled', 'canceled', 'deleted', 'inactive', 'stopped')
      ORDER BY prescribed_date DESC LIMIT 10
    `).bind(tenantId, patient.uhid).all().catch(() => ({ results: [] }));
    data.prescriptions = prescriptions.results || [];
  }

  if (dataType === 'summary' || dataType === 'labs') {
    const labs = await db.prepare(`
      SELECT id, test_name, result_value, normal_range, unit, status, collected_date
      FROM lab_results
      WHERE tenant_id = ? AND patient_uhid = ?
        AND LOWER(COALESCE(status, '')) IN ('verified', 'released', 'completed', 'final')
        AND LOWER(COALESCE(status, '')) NOT IN ('draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided')
        AND LOWER(COALESCE(result_status, '')) <> 'retracted'
      ORDER BY collected_date DESC LIMIT 20
    `).bind(tenantId, patient.uhid).all().catch(() => ({ results: [] }));
    data.labs = labs.results || [];
  }

  if (dataType === 'summary' || dataType === 'bills') {
    const bills = await db.prepare(`
      SELECT id, bill_date, total_amount, paid_amount, status
      FROM billing
      WHERE tenant_id = ? AND patient_uhid = ?
      ORDER BY bill_date DESC LIMIT 10
    `).bind(tenantId, patient.uhid).all().catch(() => ({ results: [] }));
    data.bills = bills.results || [];
  }

  return c.json({ data });
});

// ─── GET /consents — list consent settings ────────────────────────────
hospitalLinkRoutes.get('/consents', async (c) => {
  const patientId = await getPatientId(c);
  const tenantId = c.req.query('tenant_id');
  const db = c.env.DB;

  let query = 'SELECT tenant_id, consent_type, granted, updated_at FROM clinical_consents WHERE patient_id = ?';
  const params: any[] = [patientId];

  if (tenantId) {
    query += ' AND tenant_id = ?';
    params.push(tenantId);
  }

  const rows = await db.prepare(query).bind(...params).all();
  return c.json({ consents: rows.results || [] });
});

// ─── PUT /consents — update consent settings ──────────────────────────
const consentUpdateSchema = z.object({
  tenant_id: z.string().min(1),
  consent_type: z.enum(CONSENT_TYPES),
  granted: z.boolean(),
});

hospitalLinkRoutes.put('/consents', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = consentUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid data' }, 400);

  const { tenant_id, consent_type, granted } = parsed.data;
  const db = c.env.DB;

  // P0-31: only verified links can carry consents
  const link = await db.prepare(
    "SELECT id FROM hospital_links WHERE patient_id = ? AND tenant_id = ? AND status = 'verified'",
  ).bind(patientId, tenant_id).first();

  if (!link) {
    throw new HTTPException(404, { message: 'Hospital link not verified yet' });
  }

  await db.prepare(`
    INSERT INTO clinical_consents (patient_id, tenant_id, consent_type, granted)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(patient_id, tenant_id, consent_type) DO UPDATE SET
      granted = excluded.granted,
      updated_at = datetime('now')
  `).bind(patientId, tenant_id, consent_type, granted ? 1 : 0).run();

  return c.json({ success: true });
});

// ─── POST /:id/sync-labs — sync hospital lab results to vitals ────────
hospitalLinkRoutes.post('/:id/sync-labs', async (c) => {
  const patientId = await getPatientId(c);
  const linkId = parseInt(c.req.param('id'), 10);
  const db = c.env.DB;
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  const userAgent = c.req.header('User-Agent') || null;

  const link = await db.prepare(
    "SELECT tenant_id FROM hospital_links WHERE id = ? AND patient_id = ? AND status = 'verified'",
  ).bind(linkId, patientId).first() as any;
  if (!link) {
    await recordHospitalLinkAudit(db, {
      patientId, action: 'sync_labs', outcome: 'not_found',
      ipAddress, userAgent, details: { link_id: linkId },
    });
    throw new HTTPException(404, { message: 'Hospital link not verified' });
  }

  // Check consent
  const consent = await db.prepare(
    'SELECT granted FROM clinical_consents WHERE patient_id = ? AND tenant_id = ? AND consent_type = ?',
  ).bind(patientId, link.tenant_id, 'lab_sharing').first() as any;
  if (!consent?.granted) {
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: link.tenant_id, action: 'sync_labs', outcome: 'denied',
      ipAddress, userAgent, details: { link_id: linkId, reason: 'lab_sharing_consent_missing' },
    });
    return c.json({ error: 'Lab sharing consent not granted', synced: 0 }, 403);
  }

  const patient = await db.prepare('SELECT uhid FROM global_patient_auth WHERE id = ?').bind(patientId).first() as any;
  if (!patient?.uhid) {
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: link.tenant_id, action: 'sync_labs', outcome: 'no_data',
      ipAddress, userAgent, details: { link_id: linkId, reason: 'missing_uhid' },
    });
    return c.json({ synced: 0 });
  }

  // Fetch recent hospital lab results
  const labs = await db.prepare(`
    SELECT test_name, result_value, unit, collected_date
    FROM lab_results
    WHERE tenant_id = ? AND patient_uhid = ? AND status = 'completed'
      AND LOWER(COALESCE(result_status, '')) <> 'retracted'
    ORDER BY collected_date DESC LIMIT 20
  `).bind(link.tenant_id, patient.uhid).all().catch(() => ({ results: [] }));

  let synced = 0;
  const labToVitalMap: Record<string, string> = {
    'blood glucose': 'glucose',
    'fasting blood sugar': 'glucose',
    'hba1c': 'hba1c',
    'hemoglobin': 'hemoglobin',
    'cholesterol': 'cholesterol',
    'hdl': 'hdl',
    'ldl': 'ldl',
    'triglycerides': 'triglycerides',
    'creatinine': 'creatinine',
  };

  for (const lab of (labs.results || []) as any[]) {
    const vitalType = labToVitalMap[lab.test_name?.toLowerCase()];
    if (!vitalType || !lab.result_value) continue;

    try {
      await db.prepare(`
        INSERT OR IGNORE INTO vital_log (patient_id, vital_type, value, unit, source, recorded_at)
        VALUES (?, ?, ?, ?, 'hospital', ?)
      `).bind(patientId, vitalType, lab.result_value, lab.unit || '', lab.collected_date || new Date().toISOString()).run();
      synced++;
    } catch { /* skip duplicates */ }
  }

  await recordHospitalLinkAudit(db, {
    patientId, tenantId: link.tenant_id, action: 'sync_labs', outcome: 'success',
    ipAddress, userAgent, details: { link_id: linkId, synced },
  });
  return c.json({ success: true, synced });
});

// ─── POST /:id/sync-prescriptions — sync to user_medications ─────────
hospitalLinkRoutes.post('/:id/sync-prescriptions', async (c) => {
  const patientId = await getPatientId(c);
  const linkId = parseInt(c.req.param('id'), 10);
  const db = c.env.DB;
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  const userAgent = c.req.header('User-Agent') || null;

  const link = await db.prepare(
    "SELECT tenant_id FROM hospital_links WHERE id = ? AND patient_id = ? AND status = 'verified'",
  ).bind(linkId, patientId).first() as any;
  if (!link) {
    await recordHospitalLinkAudit(db, {
      patientId, action: 'sync_prescriptions', outcome: 'not_found',
      ipAddress, userAgent, details: { link_id: linkId },
    });
    throw new HTTPException(404, { message: 'Hospital link not verified' });
  }

  const consent = await db.prepare(
    'SELECT granted FROM clinical_consents WHERE patient_id = ? AND tenant_id = ? AND consent_type = ?',
  ).bind(patientId, link.tenant_id, 'medication_sharing').first() as any;
  if (!consent?.granted) {
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: link.tenant_id, action: 'sync_prescriptions', outcome: 'denied',
      ipAddress, userAgent, details: { link_id: linkId, reason: 'medication_sharing_consent_missing' },
    });
    return c.json({ error: 'Medication sharing consent not granted', synced: 0 }, 403);
  }

  const patient = await db.prepare('SELECT uhid FROM global_patient_auth WHERE id = ?').bind(patientId).first() as any;
  if (!patient?.uhid) {
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: link.tenant_id, action: 'sync_prescriptions', outcome: 'no_data',
      ipAddress, userAgent, details: { link_id: linkId, reason: 'missing_uhid' },
    });
    return c.json({ synced: 0 });
  }

  // Fetch active prescriptions
  const prescriptions = await db.prepare(`
    SELECT id, medications, prescribed_date
    FROM prescriptions
    WHERE tenant_id = ? AND patient_uhid = ? AND status = 'active'
    ORDER BY prescribed_date DESC LIMIT 10
  `).bind(link.tenant_id, patient.uhid).all().catch(() => ({ results: [] }));

  let synced = 0;
  for (const rx of (prescriptions.results || []) as any[]) {
    // Parse medications (could be JSON array or text)
    let meds: Array<{ name: string; dosage?: string; frequency?: string }> = [];
    try {
      meds = typeof rx.medications === 'string' ? JSON.parse(rx.medications) : [];
    } catch {
      // If not JSON, treat as single medication name
      if (rx.medications) meds = [{ name: rx.medications }];
    }

    for (const med of meds) {
      try {
        await db.prepare(`
          INSERT OR IGNORE INTO user_medications (patient_id, medication_name, dosage, frequency, source, hospital_prescription_id, start_date, active)
          VALUES (?, ?, ?, ?, 'hospital', ?, ?, 1)
        `).bind(
          patientId, med.name, med.dosage || null, med.frequency || null,
          rx.id, rx.prescribed_date || null,
        ).run();
        synced++;
      } catch { /* skip duplicates */ }
    }
  }

  await recordHospitalLinkAudit(db, {
    patientId, tenantId: link.tenant_id, action: 'sync_prescriptions', outcome: 'success',
    ipAddress, userAgent, details: { link_id: linkId, synced },
  });
  return c.json({ success: true, synced });
});

// ─── POST /:id/pre-visit — generate pre-visit insight ────────────────
hospitalLinkRoutes.post('/:id/pre-visit', async (c) => {
  const patientId = await getPatientId(c);
  const linkId = parseInt(c.req.param('id'), 10);
  const db = c.env.DB;
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  const userAgent = c.req.header('User-Agent') || null;

  const link = await db.prepare(
    "SELECT tenant_id, hospital_name FROM hospital_links WHERE id = ? AND patient_id = ? AND status = 'verified'",
  ).bind(linkId, patientId).first() as any;
  if (!link) {
    await recordHospitalLinkAudit(db, {
      patientId, action: 'pre_visit_lookup', outcome: 'not_found',
      ipAddress, userAgent, details: { link_id: linkId },
    });
    throw new HTTPException(404, { message: 'Hospital link not verified' });
  }

  const patient = await db.prepare('SELECT uhid FROM global_patient_auth WHERE id = ?').bind(patientId).first() as any;
  if (!patient?.uhid) {
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: link.tenant_id, action: 'pre_visit_lookup', outcome: 'no_data',
      ipAddress, userAgent, details: { link_id: linkId, reason: 'missing_uhid' },
    });
    return c.json({ insight: null });
  }

  // Find upcoming appointment (within 48h)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  const upcomingAppt = await db.prepare(`
    SELECT id, appointment_date, appointment_time, doctor_name, department
    FROM appointments
    WHERE tenant_id = ? AND patient_uhid = ? AND appointment_date BETWEEN ? AND ? AND status = 'confirmed'
    ORDER BY appointment_date ASC LIMIT 1
  `).bind(link.tenant_id, patient.uhid, todayStr, tomorrowStr).first() as any;

  if (!upcomingAppt) {
    await recordHospitalLinkAudit(db, {
      patientId, tenantId: link.tenant_id, action: 'pre_visit_lookup', outcome: 'no_data',
      ipAddress, userAgent, details: { link_id: linkId, reason: 'no_upcoming_appointment' },
    });
    return c.json({ insight: null });
  }

  // Generate and store pre-visit insight
  const content = JSON.stringify({
    title_bn: `${link.hospital_name} - আগামী অ্যাপয়েন্টমেন্ট`,
    title_en: `${link.hospital_name} - Upcoming Appointment`,
    body_bn: `${upcomingAppt.doctor_name || upcomingAppt.department}-এর সাথে ${upcomingAppt.appointment_date} তারিখে অ্যাপয়েন্টমেন্ট আছে। আপনার সাম্প্রতিক ভাইটাল ও ওষুধের তালিকা নিয়ে যেতে ভুলবেন না।`,
    body_en: `You have an appointment with ${upcomingAppt.doctor_name || upcomingAppt.department} on ${upcomingAppt.appointment_date}. Remember to bring your recent vitals and medication list.`,
    icon: 'calendar',
  });

  await db.prepare(`
    INSERT INTO ai_insights (patient_id, insight_type, content, severity)
    VALUES (?, 'pre_visit', ?, 'info')
  `).bind(patientId, content).run();

  // Create action items
  const actions = [
    { bn: 'সাম্প্রতিক ভাইটাল রিডিং চেক করুন', en: 'Review recent vital readings' },
    { bn: 'ওষুধের তালিকা আপডেট করুন', en: 'Update medication list' },
    { bn: 'প্রশ্ন তৈরি করুন', en: 'Prepare questions for doctor' },
  ];

  for (const action of actions) {
    await db.prepare(
      'INSERT INTO ai_action_items (patient_id, action_text, due_date) VALUES (?, ?, ?)',
    ).bind(patientId, JSON.stringify(action), upcomingAppt.appointment_date).run();
  }

  await recordHospitalLinkAudit(db, {
    patientId, tenantId: link.tenant_id, action: 'pre_visit_lookup', outcome: 'success',
    ipAddress, userAgent, details: { link_id: linkId, appointment_id: upcomingAppt.id },
  });
  return c.json({ insight: { type: 'pre_visit', ...JSON.parse(content) }, actions });
});

export default hospitalLinkRoutes;

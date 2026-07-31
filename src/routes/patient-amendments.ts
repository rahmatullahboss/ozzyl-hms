/**
 * Patient Amendments & Corrections
 *
 * HIPAA § 164.526 — Right to Amend
 * Patients may request amendments to their health records.
 * Providers must respond within 60 days.
 *
 * Endpoints:
 *   POST   /api/patient-amendments          — patient requests an amendment
 *   GET    /api/patient-amendments           — patient lists their amendments
 *   GET    /api/patient-amendments/:id       — get single amendment
 *   ── Staff (tenant) routes ──
 *   GET    /api/amendments/pending           — staff: list pending amendments
 *   POST   /api/amendments/:id/review        — staff: approve/deny
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env, Variables } from '../types';

// ─── Schemas ─────────────────────────────────────────────────────

export const AMENDMENT_RECORD_TYPES = [
  'demographics', 'vitals', 'allergy', 'medication',
  'lab_result', 'clinical_note', 'other',
] as const;

export const AMENDMENT_STATUSES = ['pending', 'approved', 'denied', 'partial'] as const;

export const requestAmendmentSchema = z.object({
  record_type: z.enum(AMENDMENT_RECORD_TYPES),
  record_id: z.string().max(100).optional(),
  field_name: z.string().min(1).max(200),
  current_value: z.string().max(2000).optional(),
  requested_value: z.string().min(1).max(2000),
  reason: z.string().min(5).max(1000),
});

export const reviewAmendmentSchema = z.object({
  status: z.enum(['approved', 'denied', 'partial']),
  review_note: z.string().min(1).max(1000),
});

// ─── Patient-facing routes ───────────────────────────────────────

const patientAmendmentRoutes = new Hono<{ Bindings: Env }>();

async function getPatientAuth(c: any): Promise<{ patientId: number }> {
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) throw new HTTPException(401, { message: 'Authentication required' });

  let decoded: { userId: string; scope?: string; role?: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
  if (decoded.scope !== 'global' || decoded.role !== 'patient') {
    throw new HTTPException(403, { message: 'Patient access required' });
  }
  return { patientId: parseInt(decoded.userId, 10) };
}

// POST / — Request an amendment
patientAmendmentRoutes.post('/', async (c) => {
  const { patientId } = await getPatientAuth(c);
  const body = await c.req.json();
  const parsed = requestAmendmentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const db = c.env.DB;

  // Get tenant from patient's linked hospitals (use first, or 'global')
  const tenantRow = await db.prepare(
    `SELECT tenant_id FROM patient_hospital_links WHERE patient_id = ? AND status = 'active' LIMIT 1`
  ).bind(patientId).first<{ tenant_id: string }>();
  const tenantId = tenantRow?.tenant_id ?? 'global';

  const result = await db.prepare(`
    INSERT INTO patient_amendments (tenant_id, patient_id, record_type, record_id, field_name, current_value, requested_value, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, patientId, d.record_type, d.record_id ?? null, d.field_name, d.current_value ?? null, d.requested_value, d.reason).run();

  const amendmentId = result.meta?.last_row_id;

  // Audit log
  if (amendmentId) {
    await db.prepare(`
      INSERT INTO patient_amendment_audit (amendment_id, action, actor_id, actor_role, detail)
      VALUES (?, 'requested', ?, 'patient', ?)
    `).bind(amendmentId, String(patientId), d.reason).run();
  }

  return c.json({ success: true, amendment_id: amendmentId }, 201);
});

// GET / — List patient's amendments
patientAmendmentRoutes.get('/', async (c) => {
  const { patientId } = await getPatientAuth(c);
  const db = c.env.DB;
  const status = c.req.query('status');

  let query = 'SELECT * FROM patient_amendments WHERE patient_id = ?';
  const params: (string | number)[] = [patientId];

  if (status && AMENDMENT_STATUSES.includes(status as any)) {
    query += ' AND status = ?';
    params.push(status);
  }
  query += ' ORDER BY requested_at DESC LIMIT 100';

  const { results } = await db.prepare(query).bind(...params).all();
  return c.json({ amendments: results ?? [] });
});

// GET /:id — Single amendment
patientAmendmentRoutes.get('/:id', async (c) => {
  const { patientId } = await getPatientAuth(c);
  const id = c.req.param('id');
  const db = c.env.DB;

  const amendment = await db.prepare(
    'SELECT * FROM patient_amendments WHERE id = ? AND patient_id = ?'
  ).bind(id, patientId).first();

  if (!amendment) {
    return c.json({ error: 'Amendment not found' }, 404);
  }

  // Get audit trail
  const { results: audit } = await db.prepare(
    'SELECT * FROM patient_amendment_audit WHERE amendment_id = ? ORDER BY created_at'
  ).bind(id).all();

  return c.json({ amendment, audit: audit ?? [] });
});

export default patientAmendmentRoutes;

// ─── Staff-facing routes (tenant context) ────────────────────────

export const staffAmendmentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /pending — List pending amendments for this tenant
staffAmendmentRoutes.get('/pending', async (c) => {
  const tenantId = c.get('tenantId' as any);
  if (!tenantId) throw new HTTPException(403, { message: 'Tenant context required' });
  const db = c.env.DB;

  const { results } = await db.prepare(
    `SELECT pa.*, gpa.name as patient_name, gpa.phone as patient_phone
     FROM patient_amendments pa
     LEFT JOIN global_patient_auth gpa ON gpa.id = pa.patient_id
     WHERE pa.tenant_id = ? AND pa.status = 'pending'
     ORDER BY pa.requested_at ASC LIMIT 100`
  ).bind(tenantId).all();

  return c.json({ amendments: results ?? [] });
});

// GET /all — List all amendments for this tenant
staffAmendmentRoutes.get('/all', async (c) => {
  const tenantId = c.get('tenantId' as any);
  if (!tenantId) throw new HTTPException(403, { message: 'Tenant context required' });
  const db = c.env.DB;
  const status = c.req.query('status');

  let query = `SELECT pa.*, gpa.name as patient_name
               FROM patient_amendments pa
               LEFT JOIN global_patient_auth gpa ON gpa.id = pa.patient_id
               WHERE pa.tenant_id = ?`;
  const params: (string | number)[] = [tenantId];

  if (status && AMENDMENT_STATUSES.includes(status as any)) {
    query += ' AND pa.status = ?';
    params.push(status);
  }
  query += ' ORDER BY pa.requested_at DESC LIMIT 200';

  const { results } = await db.prepare(query).bind(...params).all();
  return c.json({ amendments: results ?? [] });
});

// POST /:id/review — Approve/deny an amendment
staffAmendmentRoutes.post('/:id/review', async (c) => {
  const tenantId = c.get('tenantId' as any);
  const reviewerId = c.get('userId' as any);
  if (!tenantId) throw new HTTPException(403, { message: 'Tenant context required' });
  if (!reviewerId) throw new HTTPException(401, { message: 'Authentication required' });

  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = reviewAmendmentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid review data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const db = c.env.DB;

  // Verify amendment belongs to this tenant and is pending
  const existing = await db.prepare(
    'SELECT * FROM patient_amendments WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ status: string }>();

  if (!existing) return c.json({ error: 'Amendment not found' }, 404);
  if (existing.status !== 'pending') return c.json({ error: 'Amendment already reviewed' }, 409);

  // Update amendment
  await db.prepare(`
    UPDATE patient_amendments
    SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).bind(d.status, reviewerId, d.review_note, id).run();

  // Audit log
  await db.prepare(`
    INSERT INTO patient_amendment_audit (amendment_id, action, actor_id, actor_role, detail)
    VALUES (?, ?, ?, 'staff', ?)
  `).bind(id, d.status, reviewerId, d.review_note).run();

  return c.json({ success: true, status: d.status });
});

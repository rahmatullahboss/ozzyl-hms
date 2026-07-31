/**
 * Insurance routes
 *
 * Policies:
 *   GET  /api/insurance/policies          — list all policies for this tenant
 *   POST /api/insurance/policies          — add a policy to a patient
 *   PUT  /api/insurance/policies/:id      — update policy (status, coverage_limit, etc.)
 *   DELETE /api/insurance/policies/:id    — remove policy
 *
 * Claims:
 *   GET  /api/insurance/claims            — list claims (filter by status, patient, date)
 *   POST /api/insurance/claims            — submit new claim
 *   GET  /api/insurance/claims/:id        — get claim detail
 *   PUT  /api/insurance/claims/:id        — update claim status (admin/accountant)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import {
  insurancePolicySchema,
  updateInsurancePolicySchema,
  insuranceClaimSchema,
  updateInsuranceClaimSchema,
  claimsQuerySchema,
} from '../../schemas/insurance';
import { getDb } from '../../db';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Roles allowed to manage insurance ───────────────────────────────────────
const INSURANCE_MANAGE_ROLES = new Set(['hospital_admin', 'reception', 'accountant', 'doctor']);
const INSURANCE_REVIEW_ROLES = new Set(['hospital_admin', 'accountant']);

function requireInsuranceRole(role?: string): void {
  if (!role || !INSURANCE_MANAGE_ROLES.has(role)) {
    throw new HTTPException(403, { message: 'Insufficient permissions' });
  }
}
function requireReviewRole(role?: string): void {
  if (!role || !INSURANCE_REVIEW_ROLES.has(role)) {
    throw new HTTPException(403, { message: 'Reviewer role required (admin or accountant)' });
  }
}

// ─── Helper: generate sequential claim number ─────────────────────────────────
// Uses MAX(claim_no) instead of COUNT(*) to avoid race-condition duplicates.
async function generateClaimNo(db: D1Database, tenantId: string): Promise<string> {
  const row = await db.prepare(
    `SELECT MAX(CAST(REPLACE(claim_no, 'CLM-', '') AS INTEGER)) AS max_num FROM insurance_claims WHERE tenant_id = ?`
  ).bind(tenantId).first<{ max_num: number | null }>();

  const next = (row?.max_num ?? 0) + 1;
  return `CLM-${String(next).padStart(6, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLICIES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/insurance/policies?patient_id=&status=active
app.get('/policies', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireInsuranceRole(c.get('role'));

  const patientId = c.req.query('patient_id');
  const status    = c.req.query('status') ?? 'active';

  let sql = `SELECT ip.*, p.name AS patient_name, p.patient_code
             FROM insurance_policies ip
             LEFT JOIN patients p ON p.id = ip.patient_id AND p.tenant_id = ip.tenant_id
             WHERE ip.tenant_id = ?`;

  const params: (string | number)[] = [tenantId];

  if (patientId) {
    sql += ' AND ip.patient_id = ?';
    params.push(Number(patientId));
  }
  if (status !== 'all') {
    sql += ' AND ip.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY ip.created_at DESC LIMIT 100';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ policies: results });
});

// POST /api/insurance/policies
app.post('/policies', zValidator('json', insurancePolicySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = requireUserId(c);
  requireInsuranceRole(c.get('role'));

  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO insurance_policies
      (tenant_id, patient_id, provider_name, policy_no, policy_type,
       coverage_limit, valid_from, valid_to, status, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    data.patient_id,
    data.provider_name,
    data.policy_no,
    data.policy_type,
    data.coverage_limit,
    data.valid_from ?? null,
    data.valid_to   ?? null,
    data.status,
    data.notes      ?? null,
    userId,
  ).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

// PUT /api/insurance/policies/:id
app.put('/policies/:id', zValidator('json', updateInsurancePolicySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId  = requireTenantId(c);
  requireInsuranceRole(c.get('role'));

  const id   = Number(c.req.param('id'));
  const data = c.req.valid('json');

  // Build dynamic SET clause
  const fields: string[] = ['updated_at = datetime(\'now\')'];
  const vals: (string | number | null)[] = [];

  if (data.provider_name  !== undefined) { fields.push('provider_name = ?');  vals.push(data.provider_name); }
  if (data.policy_no      !== undefined) { fields.push('policy_no = ?');      vals.push(data.policy_no); }
  if (data.policy_type    !== undefined) { fields.push('policy_type = ?');    vals.push(data.policy_type); }
  if (data.coverage_limit !== undefined) { fields.push('coverage_limit = ?'); vals.push(data.coverage_limit); }
  if (data.valid_from     !== undefined) { fields.push('valid_from = ?');     vals.push(data.valid_from ?? null); }
  if (data.valid_to       !== undefined) { fields.push('valid_to = ?');       vals.push(data.valid_to ?? null); }
  if (data.status         !== undefined) { fields.push('status = ?');         vals.push(data.status); }
  if (data.notes          !== undefined) { fields.push('notes = ?');          vals.push(data.notes ?? null); }

  if (fields.length === 1) return c.json({ success: true, message: 'Nothing to update' });

  vals.push(id, tenantId);
  await db.$client.prepare(
    `UPDATE insurance_policies SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ success: true });
});

// DELETE /api/insurance/policies/:id
app.delete('/policies/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireInsuranceRole(c.get('role'));

  const id = Number(c.req.param('id'));

  // Check for active claims before delete
  const activeClaims = await db.$client.prepare(
    `SELECT COUNT(*) AS cnt FROM insurance_claims
     WHERE policy_id = ? AND tenant_id = ? AND status NOT IN ('rejected', 'settled')`
  ).bind(id, tenantId).first<{ cnt: number }>();

  if ((activeClaims?.cnt ?? 0) > 0) {
    throw new HTTPException(409, { message: 'Cannot delete policy with active claims' });
  }

  await db.$client.prepare(
    `DELETE FROM insurance_policies WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/insurance/claims
app.get('/claims', zValidator('query', claimsQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireInsuranceRole(c.get('role'));

  const { status, patient_id, from, to, page, per_page } = c.req.valid('query');
  const limit  = Math.min(Number(per_page), 100);
  const offset = (Number(page) - 1) * limit;

  let sql = `
    SELECT ic.*,
           p.name   AS patient_name, p.patient_code,
           ip.provider_name, ip.policy_type
    FROM insurance_claims ic
    LEFT JOIN patients           p  ON p.id  = ic.patient_id  AND p.tenant_id  = ic.tenant_id
    LEFT JOIN insurance_policies ip ON ip.id = ic.policy_id   AND ip.tenant_id = ic.tenant_id
    WHERE ic.tenant_id = ?`;

  const params: (string | number)[] = [tenantId];

  if (status !== 'all') { sql += ' AND ic.status = ?';          params.push(status); }
  if (patient_id)       { sql += ' AND ic.patient_id = ?';      params.push(Number(patient_id)); }
  if (from)             { sql += ' AND ic.submitted_at >= ?';   params.push(from); }
  if (to)               { sql += ' AND ic.submitted_at <= ?';   params.push(to + 'T23:59:59'); }

  sql += ' ORDER BY ic.submitted_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [{ results }, totalRow] = await db.$client.batch([
    db.$client.prepare(sql).bind(...params),
    db.$client.prepare(
      `SELECT COUNT(*) AS cnt FROM insurance_claims WHERE tenant_id = ?`
    ).bind(tenantId),
  ]);

  const total = (totalRow as D1Result<{ cnt: number }>).results[0]?.cnt ?? 0;

  return c.json({
    claims: results,
    pagination: { total, page: Number(page), per_page: limit },
  });
});

// GET /api/insurance/claims/:id
app.get('/claims/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireInsuranceRole(c.get('role'));

  const id = Number(c.req.param('id'));

  const claim = await db.$client.prepare(`
    SELECT ic.*,
           p.name         AS patient_name,  p.patient_code,  p.mobile AS patient_phone,
           ip.provider_name, ip.policy_no,  ip.policy_type,  ip.coverage_limit,
           b.bill_no,     b.total          AS bill_total
    FROM insurance_claims ic
    LEFT JOIN patients           p  ON p.id  = ic.patient_id  AND p.tenant_id  = ic.tenant_id
    LEFT JOIN insurance_policies ip ON ip.id = ic.policy_id
    LEFT JOIN bills               b  ON b.id  = ic.bill_id     AND b.tenant_id  = ic.tenant_id
    WHERE ic.id = ? AND ic.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!claim) throw new HTTPException(404, { message: 'Claim not found' });

  return c.json({ claim });
});

// POST /api/insurance/claims
app.post('/claims', zValidator('json', insuranceClaimSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = requireUserId(c);
  requireInsuranceRole(c.get('role'));

  const data = c.req.valid('json');

  // Validate claimed_amount <= bill_amount
  if (data.claimed_amount > data.bill_amount) {
    throw new HTTPException(400, { message: 'Claimed amount cannot exceed bill amount' });
  }

  // Validate policy belongs to this tenant & patient
  if (data.policy_id) {
    const policy = await db.$client.prepare(
      `SELECT id FROM insurance_policies WHERE id = ? AND tenant_id = ? AND patient_id = ? AND status = 'active'`
    ).bind(data.policy_id, tenantId, data.patient_id).first();

    if (!policy) {
      throw new HTTPException(400, { message: 'Policy not found, not active, or does not belong to this patient' });
    }
  }

  try {
    const claimNo = await generateClaimNo(c.env.DB, tenantId);

    const result = await db.$client.prepare(`
      INSERT INTO insurance_claims
        (tenant_id, claim_no, patient_id, policy_id, bill_id, diagnosis, icd10_code,
         bill_amount, claimed_amount, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)
    `).bind(
      tenantId,
      claimNo,
      data.patient_id,
      data.policy_id  ?? null,
      data.bill_id    ?? null,
      data.diagnosis  ?? null,
      data.icd10_code ?? null,
      data.bill_amount,
      data.claimed_amount,
      userId,
    ).run();

    return c.json({ success: true, id: result.meta.last_row_id, claim_no: claimNo }, 201);
  } catch (err) {
    console.error('[INSURANCE_CLAIMS_POST]', err instanceof Error ? err.message : err);
    throw new HTTPException(500, { message: `Claim creation failed: ${err instanceof Error ? err.message : 'Unknown error'}` });
  }
});

// PUT /api/insurance/claims/:id — update status (reviewer only)
app.put('/claims/:id', zValidator('json', updateInsuranceClaimSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireReviewRole(c.get('role'));

  const id   = Number(c.req.param('id'));
  const data = c.req.valid('json');

  // Validate: approved_amount required when status = approved
  if (data.status === 'approved' && data.approved_amount === undefined) {
    throw new HTTPException(400, { message: 'approved_amount is required when approving a claim' });
  }
  if (data.status === 'rejected' && !data.rejection_reason) {
    throw new HTTPException(400, { message: 'rejection_reason is required when rejecting a claim' });
  }

  const now = new Date().toISOString();

  await db.$client.prepare(`
    UPDATE insurance_claims SET
      status           = ?,
      approved_amount  = ?,
      rejection_reason = ?,
      reviewer_notes   = ?,
      reviewed_at      = ?,
      settled_at       = ?,
      updated_at       = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.status,
    data.approved_amount ?? null,
    data.rejection_reason ?? null,
    data.reviewer_notes   ?? null,
    (data.status === 'under_review' || data.status === 'approved' || data.status === 'rejected') ? now : null,
    data.status === 'settled' ? (data.settled_at ?? now) : null,
    now,
    id,
    tenantId,
  ).run();

  return c.json({ success: true });
});

export default app;

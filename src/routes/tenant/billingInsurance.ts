/**
 * Billing Insurance routes — ported from danphe-next billing-insurance.ts
 *
 * Insurance Provisionals:
 *   GET  /patients/provisional         — list insurance patients with provisional items
 *   GET  /patients/:id/provisional     — get provisional items for a patient
 *   GET  /patients/:id/summary         — patient insurance billing KPIs
 *
 * Insurance Claims (billing-level):
 *   GET  /claims/pending               — invoices not yet claimed
 *   GET  /claims/submitted             — claimed invoices
 *   POST /claims/:billId/submit        — submit claim for a bill
 *   PUT  /claims/:billId               — update claim on a bill
 *
 * Insurance Patients (scheme-linked):
 *   GET  /patients                     — list insurance-linked patients
 *   POST /patients                     — link patient to insurance scheme
 *   PUT  /patients/:id                 — update patient insurance linkage
 *
 * Claims with Items:
 *   GET  /claim-records                — list insurance claims
 *   GET  /claim-records/:id            — claim detail + line items
 *   POST /claim-records                — create claim with items
 *   PUT  /claim-records/:id/status     — update claim status
 *
 * SSF:
 *   GET/POST /ssf/patients             — SSF patient info
 *   PUT  /ssf/patients/:id
 *   GET/POST /ssf/invoices
 *   GET/POST/PUT /ssf/settings
 *
 * Insurance Billing Transactions:
 *   GET  /billing-transactions         — list insurance billing txns
 *
 * Settings:
 *   GET/POST /settings
 *
 * Reports:
 *   GET  /reports/claim-summary
 *   GET  /reports/patient-credit
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { getTodayGMT6 } from '../../lib/date-utils';
import { isRoleAllowed } from '../../lib/authz';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const INSURANCE_ALLOWED_ROLES = ['hospital_admin', 'accountant', 'reception', 'doctor'];
function requireRole(role?: string): void {
  if (!role || !isRoleAllowed(role, INSURANCE_ALLOWED_ROLES)) {
    throw new HTTPException(403, { message: 'Insufficient permissions' });
  }
}

// Query schema shared across several endpoints
const paginationQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  scheme_id: z.coerce.number().int().optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE PROVISIONALS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /patients/provisional — insurance patients with provisional items
app.get('/patients/provisional', zValidator('query', paginationQuery), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { page, limit, scheme_id, from_date, to_date } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let sql = `
    SELECT DISTINCT p.id AS patient_id, p.patient_code, p.name AS patient_name, p.mobile,
      is2.scheme_name,
      (SELECT COALESCE(SUM(total_amount), 0) FROM billing_provisional_items
        WHERE patient_id = p.id AND tenant_id = ? AND bill_status = 'provisional' AND is_insurance = 1) AS total_provisional,
      (SELECT COUNT(*) FROM billing_provisional_items
        WHERE patient_id = p.id AND tenant_id = ? AND bill_status = 'provisional' AND is_insurance = 1) AS item_count
    FROM billing_provisional_items pi
    JOIN patients p ON pi.patient_id = p.id AND p.tenant_id = pi.tenant_id
    LEFT JOIN insurance_schemes is2 ON pi.tenant_id = is2.tenant_id
    WHERE pi.tenant_id = ? AND pi.is_insurance = 1 AND pi.bill_status = 'provisional'
  `;
  const params: (string | number)[] = [tenantId, tenantId, tenantId];

  // Note: scheme_id filter removed — billing_provisional_items has no scheme_id column.
  // To support scheme filtering, a scheme_id column would need to be added to provisional items.
  if (from_date) { sql += ' AND pi.created_at >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND pi.created_at <= ?'; params.push(to_date + ' 23:59:59'); }

  sql += ' ORDER BY p.patient_code LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results, pagination: { page, limit } });
});

// GET /patients/:id/provisional — provisional items for one patient
app.get('/patients/:id/provisional', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const patientId = Number(c.req.param('id'));

  const { results } = await db.$client.prepare(`
    SELECT pi.*, is2.scheme_name
    FROM billing_provisional_items pi
    LEFT JOIN insurance_schemes is2 ON pi.tenant_id = is2.tenant_id
    WHERE pi.patient_id = ? AND pi.tenant_id = ? AND pi.is_insurance = 1 AND pi.bill_status = 'provisional'
    ORDER BY pi.created_at DESC
  `).bind(patientId, tenantId).all();

  const total = results.reduce((sum: number, item: Record<string, unknown>) => sum + (Number(item.total_amount) || 0), 0);
  return c.json({ data: results, total_amount: total });
});

// GET /patients/:id/summary — insurance billing KPIs
app.get('/patients/:id/summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const patientId = Number(c.req.param('id'));

  const patient = await db.$client.prepare(
    'SELECT id, patient_code, name FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first();

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const provisional = await db.$client.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS count
    FROM billing_provisional_items
    WHERE patient_id = ? AND tenant_id = ? AND is_insurance = 1 AND bill_status = 'provisional'
  `).bind(patientId, tenantId).first<{ total: number; count: number }>();

  const billed = await db.$client.prepare(`
    SELECT COALESCE(SUM(bill_amount), 0) AS total, COUNT(*) AS count
    FROM insurance_claims WHERE patient_id = ? AND tenant_id = ?
  `).bind(patientId, tenantId).first<{ total: number; count: number }>();

  const claimed = await db.$client.prepare(`
    SELECT COALESCE(SUM(claimed_amount), 0) AS total, COUNT(*) AS count
    FROM insurance_claims WHERE patient_id = ? AND tenant_id = ? AND status IN ('approved', 'settled')
  `).bind(patientId, tenantId).first<{ total: number; count: number }>();

  return c.json({
    data: {
      patient,
      provisional: { total: provisional?.total ?? 0, count: provisional?.count ?? 0 },
      billed: { total: billed?.total ?? 0, count: billed?.count ?? 0 },
      claimed: { total: claimed?.total ?? 0, count: claimed?.count ?? 0 },
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE CLAIMS (billing-level)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /claims/pending — claims not yet submitted/approved
app.get('/claims/pending', zValidator('query', paginationQuery), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { page, limit, from_date, to_date } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let sql = `
    SELECT ic.*, p.patient_code, p.name AS patient_name, ip.provider_name
    FROM insurance_claims ic
    JOIN patients p ON ic.patient_id = p.id AND p.tenant_id = ic.tenant_id
    LEFT JOIN insurance_policies ip ON ip.id = ic.policy_id AND ip.tenant_id = ic.tenant_id
    WHERE ic.tenant_id = ? AND ic.status = 'submitted'
  `;
  const params: (string | number)[] = [tenantId];

  if (from_date) { sql += ' AND ic.submitted_at >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND ic.submitted_at <= ?'; params.push(to_date + ' 23:59:59'); }

  sql += ' ORDER BY ic.submitted_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results, pagination: { page, limit } });
});

// GET /claims/submitted — claims that have been reviewed (approved/settled)
app.get('/claims/submitted', zValidator('query', paginationQuery), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { page, limit, from_date, to_date } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let sql = `
    SELECT ic.*, p.patient_code, p.name AS patient_name, ip.provider_name
    FROM insurance_claims ic
    JOIN patients p ON ic.patient_id = p.id AND p.tenant_id = ic.tenant_id
    LEFT JOIN insurance_policies ip ON ip.id = ic.policy_id AND ip.tenant_id = ic.tenant_id
    WHERE ic.tenant_id = ? AND ic.status IN ('approved', 'settled')
  `;
  const params: (string | number)[] = [tenantId];

  if (from_date) { sql += ' AND ic.reviewed_at >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND ic.reviewed_at <= ?'; params.push(to_date + ' 23:59:59'); }

  sql += ' ORDER BY ic.reviewed_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results, pagination: { page, limit } });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE PATIENTS (scheme-linked)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/insurance-patients', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { scheme_id, status, from_date, to_date } = c.req.query();

  let sql = `
    SELECT pi.*, p.name AS patient_name, p.patient_code, p.gender, p.date_of_birth AS dob,
      is2.scheme_name
    FROM patient_insurance pi
    JOIN patients p ON pi.patient_id = p.id AND p.tenant_id = pi.tenant_id
    JOIN insurance_schemes is2 ON pi.scheme_id = is2.id AND is2.tenant_id = pi.tenant_id
    WHERE pi.tenant_id = ? AND pi.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (scheme_id) { sql += ' AND pi.scheme_id = ?'; params.push(Number(scheme_id)); }
  if (status) { sql += ' AND pi.status = ?'; params.push(status); }
  if (from_date) { sql += ' AND DATE(pi.created_at) >= DATE(?)'; params.push(from_date); }
  if (to_date) { sql += ' AND DATE(pi.created_at) <= DATE(?)'; params.push(to_date); }

  sql += ' ORDER BY pi.created_at DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results });
});

const createInsPatientSchema = z.object({
  patient_id: z.number().int().positive(),
  scheme_id: z.number().int().positive(),
  policy_no: z.string().optional(),
  member_id: z.string().optional(),
  nshi_no: z.string().optional(),
  claim_code: z.string().optional(),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
  status: z.string().default('active'),
});

app.post('/insurance-patients', zValidator('json', createInsPatientSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO patient_insurance (tenant_id, patient_id, scheme_id, policy_no, member_id, valid_from, valid_to, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.patient_id, data.scheme_id, data.policy_no ?? null,
    data.member_id ?? null, data.valid_from ?? null, data.valid_to ?? null, data.status).run();

  return c.json({ data: { id: result.meta.last_row_id } }, 201);
});

app.put('/insurance-patients/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.policy_no !== undefined) { fields.push('policy_no = ?'); values.push(body.policy_no as string); }
  if (body.member_id !== undefined) { fields.push('member_id = ?'); values.push(body.member_id as string); }
  if (body.valid_from !== undefined) { fields.push('valid_from = ?'); values.push(body.valid_from as string); }
  if (body.valid_to !== undefined) { fields.push('valid_to = ?'); values.push(body.valid_to as string); }
  if (body.status !== undefined) { fields.push('status = ?'); values.push(body.status as string); }

  if (fields.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  values.push(id, tenantId);
  await db.$client.prepare(
    `UPDATE patient_insurance SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...values).run();

  return c.json({ message: 'Updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS WITH ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/claim-records', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { status, from_date, to_date } = c.req.query();

  let sql = `
    SELECT ic.*, p.name AS patient_name, p.patient_code, ip.provider_name
    FROM insurance_claims ic
    LEFT JOIN patients p ON ic.patient_id = p.id AND p.tenant_id = ic.tenant_id
    LEFT JOIN insurance_policies ip ON ip.id = ic.policy_id AND ip.tenant_id = ic.tenant_id
    WHERE ic.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (status && status !== 'all') { sql += ' AND ic.status = ?'; params.push(status); }
  if (from_date) { sql += ' AND DATE(ic.submitted_at) >= DATE(?)'; params.push(from_date); }
  if (to_date) { sql += ' AND DATE(ic.submitted_at) <= DATE(?)'; params.push(to_date); }

  sql += ' ORDER BY ic.submitted_at DESC LIMIT 200';
  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results });
});

app.get('/claim-records/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const id = Number(c.req.param('id'));

  const claim = await db.$client.prepare(`
    SELECT ic.*, p.name AS patient_name, p.patient_code, ip.provider_name
    FROM insurance_claims ic
    LEFT JOIN patients p ON ic.patient_id = p.id AND p.tenant_id = ic.tenant_id
    LEFT JOIN insurance_policies ip ON ip.id = ic.policy_id AND ip.tenant_id = ic.tenant_id
    WHERE ic.id = ? AND ic.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!claim) throw new HTTPException(404, { message: 'Claim not found' });

  const { results: items } = await db.$client.prepare(
    'SELECT * FROM insurance_claim_items WHERE claim_id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).all();

  return c.json({ data: { ...claim as object, items } });
});

const createClaimWithItemsSchema = z.object({
  patient_id: z.number().int().positive(),
  policy_id: z.number().int().optional(),
  bill_id: z.number().int().optional(),
  diagnosis: z.string().optional(),
  icd10_code: z.string().optional(),
  bill_amount: z.number().min(0),
  claimed_amount: z.number().min(0),
  items: z.array(z.object({
    service_code: z.string().optional(),
    description: z.string().optional(),
    quantity: z.number().int().default(1),
    unit_price: z.number().min(0),
    total_price: z.number().min(0),
    covered_amount: z.number().min(0).optional(),
    patient_payable: z.number().min(0).optional(),
  })).optional(),
});

app.post('/claim-records', zValidator('json', createClaimWithItemsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  requireRole(c.get('role'));
  const data = c.req.valid('json');

  // Generate claim number with retry for race-condition safety
  let claimNo = '';
  let result: { meta: { last_row_id: number | bigint } } | null = null;
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const row = await db.$client.prepare(
      `SELECT MAX(CAST(REPLACE(claim_no, 'CLM-', '') AS INTEGER)) AS max_num FROM insurance_claims WHERE tenant_id = ?`
    ).bind(tenantId).first<{ max_num: number | null }>();
    claimNo = `CLM-${String((row?.max_num ?? 0) + 1 + attempt).padStart(6, '0')}`;

    try {
      result = await db.$client.prepare(`
        INSERT INTO insurance_claims
          (tenant_id, claim_no, patient_id, policy_id, bill_id, diagnosis, icd10_code,
           bill_amount, claimed_amount, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)
      `).bind(
        tenantId, claimNo, data.patient_id, data.policy_id ?? null, data.bill_id ?? null,
        data.diagnosis ?? null, data.icd10_code ?? null, data.bill_amount,
        data.claimed_amount, userId
      ).run();
      break; // success
    } catch (e: unknown) {
      if (attempt === MAX_RETRIES - 1) throw e; // last attempt, let it propagate
      // Likely UNIQUE constraint violation — retry with next number
    }
  }

  if (!result) throw new HTTPException(500, { message: 'Failed to create claim after retries' });

  const claimId = result.meta.last_row_id;

  // Insert line items
  if (data.items?.length) {
    const stmts = data.items.map((item) =>
      db.$client.prepare(`
        INSERT INTO insurance_claim_items
          (tenant_id, claim_id, service_code, description, quantity, unit_price, total_price, covered_amount, patient_payable)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId, claimId, item.service_code ?? null, item.description ?? null,
        item.quantity, item.unit_price, item.total_price,
        item.covered_amount ?? 0, item.patient_payable ?? 0
      )
    );
    await db.$client.batch(stmts);
  }

  return c.json({ data: { id: claimId, claim_no: claimNo } }, 201);
});

const updateClaimStatusSchema = z.object({
  status: z.enum(['submitted', 'under_review', 'approved', 'rejected', 'settled']),
  remarks: z.string().optional(),
  approved_amount: z.number().optional(),
  rejection_reason: z.string().optional(),
});

app.put('/claim-records/:id/status', zValidator('json', updateClaimStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  await db.$client.prepare(`
    UPDATE insurance_claims SET
      status = ?, approved_amount = ?, rejection_reason = ?, reviewer_notes = ?,
      reviewed_at = ?, settled_at = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.status,
    data.approved_amount ?? null,
    data.rejection_reason ?? null,
    data.remarks ?? null,
    ['under_review', 'approved', 'rejected'].includes(data.status) ? now : null,
    data.status === 'settled' ? now : null,
    now, id, tenantId
  ).run();

  return c.json({ message: `Claim status updated to ${data.status}` });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SSF (Social Security Fund)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/ssf/patients', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { from_date, to_date, status } = c.req.query();

  let sql = `
    SELECT sp.*, p.name AS patient_name, p.patient_code, p.gender
    FROM ssf_patient_info sp
    JOIN patients p ON sp.patient_id = p.id AND p.tenant_id = sp.tenant_id
    WHERE sp.tenant_id = ? AND sp.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (status) { sql += ' AND sp.claim_status = ?'; params.push(status); }
  if (from_date) { sql += ' AND DATE(sp.created_at) >= DATE(?)'; params.push(from_date); }
  if (to_date) { sql += ' AND DATE(sp.created_at) <= DATE(?)'; params.push(to_date); }

  sql += ' ORDER BY sp.created_at DESC';
  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results });
});

const createSsfPatientSchema = z.object({
  patient_id: z.number().int().positive(),
  ssf_policy_no: z.string().optional(),
  ssf_scheme_code: z.string().optional(),
  member_no: z.string().optional(),
  claim_code: z.string().optional(),
  claim_status: z.string().default('pending'),
});

app.post('/ssf/patients', zValidator('json', createSsfPatientSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO ssf_patient_info
      (tenant_id, patient_id, ssf_policy_no, ssf_scheme_code, member_no, claim_code, claim_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.patient_id, data.ssf_policy_no ?? null, data.ssf_scheme_code ?? null,
    data.member_no ?? null, data.claim_code ?? null, data.claim_status).run();

  return c.json({ data: { id: result.meta.last_row_id } }, 201);
});

app.put('/ssf/patients/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();

  await db.$client.prepare(`
    UPDATE ssf_patient_info SET
      claim_status = ?, ssf_claim_id = ?, remarks = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(
    (body.claim_status ?? 'pending') as string,
    (body.ssf_claim_id ?? null) as string | null,
    (body.remarks ?? null) as string | null,
    id, tenantId
  ).run();

  return c.json({ message: 'SSF patient info updated' });
});

// SSF Invoices
app.get('/ssf/invoices', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { from_date, to_date } = c.req.query();

  let sql = `
    SELECT si.*, p.name AS patient_name, p.patient_code
    FROM ssf_invoices si
    JOIN patients p ON si.patient_id = p.id AND p.tenant_id = si.tenant_id
    WHERE si.tenant_id = ? AND si.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];
  if (from_date) { sql += ' AND DATE(si.invoice_date) >= DATE(?)'; params.push(from_date); }
  if (to_date) { sql += ' AND DATE(si.invoice_date) <= DATE(?)'; params.push(to_date); }
  sql += ' ORDER BY si.invoice_date DESC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results });
});

const createSsfInvoiceSchema = z.object({
  patient_id: z.number().int().positive(),
  ssf_patient_id: z.number().int().optional(),
  invoice_date: z.string().optional(),
  total_amount: z.number().min(0).default(0),
  claimed_amount: z.number().min(0).default(0),
  invoice_status: z.string().default('pending'),
  remarks: z.string().optional(),
});

app.post('/ssf/invoices', zValidator('json', createSsfInvoiceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO ssf_invoices
      (tenant_id, patient_id, ssf_patient_id, invoice_date, total_amount, claimed_amount, invoice_status, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.patient_id, data.ssf_patient_id ?? null,
    data.invoice_date ?? getTodayGMT6(),
    data.total_amount, data.claimed_amount, data.invoice_status, data.remarks ?? null).run();

  return c.json({ data: { id: result.meta.last_row_id } }, 201);
});

// SSF Settings
app.get('/ssf/settings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const row = await db.$client.prepare(
    'SELECT * FROM ssf_settings WHERE tenant_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).bind(tenantId).first();
  return c.json({ data: row ?? {} });
});

app.post('/ssf/settings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const body = await c.req.json<Record<string, unknown>>();

  const result = await db.$client.prepare(`
    INSERT INTO ssf_settings (tenant_id, ssf_api_url, ssf_api_code, hosp_code, username, password)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, (body.ssf_api_url ?? null) as string | null,
    (body.ssf_api_code ?? null) as string | null, (body.hosp_code ?? null) as string | null,
    (body.username ?? null) as string | null, (body.password ?? null) as string | null).run();

  return c.json({ data: { id: result.meta.last_row_id } }, 201);
});

app.put('/ssf/settings/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();

  await db.$client.prepare(`
    UPDATE ssf_settings SET ssf_api_url = ?, ssf_api_code = ?, hosp_code = ?, username = ?, password = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    (body.ssf_api_url ?? null) as string | null,
    (body.ssf_api_code ?? null) as string | null,
    (body.hosp_code ?? null) as string | null,
    (body.username ?? null) as string | null,
    (body.password ?? null) as string | null,
    id, tenantId
  ).run();

  return c.json({ message: 'SSF settings updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/settings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const row = await db.$client.prepare(
    'SELECT * FROM insurance_settings WHERE tenant_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).bind(tenantId).first();
  return c.json({ data: row ?? {} });
});

app.post('/settings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const body = await c.req.json<Record<string, unknown>>();

  const result = await db.$client.prepare(`
    INSERT INTO insurance_settings (tenant_id, api_url, api_code)
    VALUES (?, ?, ?)
  `).bind(tenantId, (body.api_url ?? null) as string | null, (body.api_code ?? null) as string | null).run();

  return c.json({ data: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Claim Summary Report — grouped by provider and status
app.get('/reports/claim-summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { from_date, to_date } = c.req.query();

  let sql = `
    SELECT ip.provider_name, ic.status,
      COUNT(*) AS claim_count,
      COALESCE(SUM(ic.claimed_amount), 0) AS total_claimed,
      COALESCE(SUM(ic.approved_amount), 0) AS total_approved
    FROM insurance_claims ic
    LEFT JOIN insurance_policies ip ON ip.id = ic.policy_id AND ip.tenant_id = ic.tenant_id
    WHERE ic.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (from_date) { sql += ' AND DATE(ic.submitted_at) >= DATE(?)'; params.push(from_date); }
  if (to_date) { sql += ' AND DATE(ic.submitted_at) <= DATE(?)'; params.push(to_date); }

  sql += ' GROUP BY ip.provider_name, ic.status ORDER BY ip.provider_name';
  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results });
});

// Patient Credit Report — insurance credit balance per patient
app.get('/reports/patient-credit', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { from_date, to_date } = c.req.query();

  let sql = `
    SELECT ic.patient_id, p.name AS patient_name, p.patient_code,
      ip.provider_name,
      COUNT(*) AS claim_count,
      COALESCE(SUM(ic.bill_amount), 0) AS total_billed,
      COALESCE(SUM(ic.approved_amount), 0) AS total_approved,
      COALESCE(SUM(ic.bill_amount) - SUM(COALESCE(ic.approved_amount, 0)), 0) AS credit_balance
    FROM insurance_claims ic
    JOIN patients p ON ic.patient_id = p.id AND p.tenant_id = ic.tenant_id
    LEFT JOIN insurance_policies ip ON ip.id = ic.policy_id AND ip.tenant_id = ic.tenant_id
    WHERE ic.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (from_date) { sql += ' AND DATE(ic.submitted_at) >= DATE(?)'; params.push(from_date); }
  if (to_date) { sql += ' AND DATE(ic.submitted_at) <= DATE(?)'; params.push(to_date); }

  sql += ' GROUP BY ic.patient_id, p.name, p.patient_code, ip.provider_name';
  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE COMPANIES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/companies', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { active } = c.req.query();

  let sql = 'SELECT * FROM insurance_companies WHERE tenant_id = ?';
  const params: (string | number)[] = [tenantId];

  if (active !== 'false') { sql += ' AND is_active = 1'; }
  sql += ' ORDER BY company_name';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ data: results });
});

const createCompanySchema = z.object({
  company_name: z.string().min(1),
  insurance_type: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  payer_id: z.string().optional(),
});

app.post('/companies', zValidator('json', createCompanySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO insurance_companies (tenant_id, company_name, insurance_type, address, city, phone, email, payer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, data.company_name, data.insurance_type ?? null, data.address ?? null,
    data.city ?? null, data.phone ?? null, data.email ?? null, data.payer_id ?? null).run();

  return c.json({ data: { id: result.meta.last_row_id } }, 201);
});

app.put('/companies/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.company_name !== undefined) { fields.push('company_name = ?'); values.push(body.company_name as string); }
  if (body.insurance_type !== undefined) { fields.push('insurance_type = ?'); values.push(body.insurance_type as string); }
  if (body.address !== undefined) { fields.push('address = ?'); values.push(body.address as string); }
  if (body.city !== undefined) { fields.push('city = ?'); values.push(body.city as string); }
  if (body.phone !== undefined) { fields.push('phone = ?'); values.push(body.phone as string); }
  if (body.email !== undefined) { fields.push('email = ?'); values.push(body.email as string); }
  if (body.payer_id !== undefined) { fields.push('payer_id = ?'); values.push(body.payer_id as string); }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); values.push(body.is_active ? 1 : 0); }

  if (fields.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  values.push(id, tenantId);
  await db.$client.prepare(
    `UPDATE insurance_companies SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...values).run();

  return c.json({ message: 'Company updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ELIGIBILITY CHECK
// ═══════════════════════════════════════════════════════════════════════════════

const eligibilityCheckSchema = z.object({
  patient_id: z.number().int().positive(),
  policy_id: z.number().int().optional(),
  service_type: z.string().optional(),
});

app.post('/eligibility', zValidator('json', eligibilityCheckSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { patient_id, policy_id, service_type } = c.req.valid('json');

  // Find patient's insurance policy
  let policy: Record<string, unknown> | null = null;
  if (policy_id) {
    policy = await db.$client.prepare(
      `SELECT * FROM insurance_policies WHERE id = ? AND tenant_id = ? AND patient_id = ?`
    ).bind(policy_id, tenantId, patient_id).first();
  } else {
    policy = await db.$client.prepare(
      `SELECT * FROM insurance_policies WHERE patient_id = ? AND tenant_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`
    ).bind(patient_id, tenantId).first();
  }

  if (!policy) {
    return c.json({ eligible: false, status: 'no-insurance', error: 'No active insurance found' });
  }

  // Check date validity
  const now = new Date();
  const validFrom = policy.valid_from ? new Date(policy.valid_from as string) : null;
  const validTo = policy.valid_to ? new Date(policy.valid_to as string) : null;

  let status = 'active';
  if (validFrom && now < validFrom) status = 'not-yet-effective';
  else if (validTo && now > validTo) status = 'expired';

  const result = {
    eligible: status === 'active',
    status,
    patient_id,
    insurance: {
      provider_name: policy.provider_name,
      policy_no: policy.policy_no,
      policy_type: policy.policy_type,
      coverage_limit: policy.coverage_limit,
    },
    coverage: {
      coverage_limit: policy.coverage_limit,
      service_type: service_type || '30',
    },
    valid_from: policy.valid_from,
    valid_to: policy.valid_to,
    checked_at: now.toISOString(),
  };

  // Log the check
  await db.$client.prepare(`
    INSERT INTO eligibility_logs (tenant_id, patient_id, policy_id, service_type, eligible, status, response_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, patient_id, policy.id as number, service_type ?? '30',
    result.eligible ? 1 : 0, status, JSON.stringify(result)).run();

  return c.json(result);
});

const batchEligibilitySchema = z.object({
  patient_ids: z.array(z.number().int().positive()),
  service_type: z.string().optional(),
});

app.post('/eligibility/batch', zValidator('json', batchEligibilitySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireRole(c.get('role'));
  const { patient_ids, service_type } = c.req.valid('json');

  const results: Record<string, unknown>[] = [];

  for (const patientId of patient_ids) {
    const policy = await db.$client.prepare(
      `SELECT * FROM insurance_policies WHERE patient_id = ? AND tenant_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`
    ).bind(patientId, tenantId).first();

    if (policy) {
      const now = new Date();
      const validFrom = policy.valid_from ? new Date(policy.valid_from as string) : null;
      const validTo = policy.valid_to ? new Date(policy.valid_to as string) : null;

      let status = 'active';
      if (validFrom && now < validFrom) status = 'not-yet-effective';
      else if (validTo && now > validTo) status = 'expired';

      results.push({
        patient_id: patientId, eligible: status === 'active', status,
        insurance: { provider_name: policy.provider_name, policy_no: policy.policy_no },
      });
    } else {
      results.push({
        patient_id: patientId, eligible: false, status: 'no-insurance',
        error: 'No active insurance found',
      });
    }
  }

  return c.json({ results });
});

export default app;

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId, parseId } from '../../../lib/context-helpers';
import { requireRole } from '../../../middleware/rbac';
import {
  createReportSchema,
  updateReportSchema,
  reportQuerySchema,
} from '../../../schemas/radiology';
import {
  getDiagnosticBillingClearance,
  getDiagnosticBillingColumns,
  getDiagnosticBillingJoin,
} from '../../../lib/diagnostic-billing';
import { createAuditLog } from '../../../lib/accounting-helpers';
import {
  RIS_READ_ROLES,
  RIS_REPORT_DRAFT_ROLES,
  RIS_REPORT_FINALIZE_ROLES,
} from '../lab/_permissions';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// P0-15: doctors may draft radiology reports; only RIS_REPORT_FINALIZE_ROLES
// (radiologist/ris_admin/admin/director/md) may finalize.
const RAD_READ       = RIS_READ_ROLES;
const RAD_REPORT     = RIS_REPORT_DRAFT_ROLES;
const RAD_FINALIZE   = RIS_REPORT_FINALIZE_ROLES;

function assertRadiologyBillCleared(row: Record<string, unknown>, workflow: string): void {
  const clearance = getDiagnosticBillingClearance(row);
  if (!clearance.cleared) {
    throw new HTTPException(409, {
      message: `Diagnostic bill payment required before ${workflow}. Bill #${clearance.billId ?? 'unknown'} is ${clearance.paymentStatus}; outstanding ${clearance.outstanding}.`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIST REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/', requireRole(...RAD_READ), zValidator('query', reportQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, from_date, to_date, order_status } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let where = 'WHERE r.tenant_id = ? AND r.is_active = 1';
  const binds: unknown[] = [tenantId];

  if (patient_id)   { where += ' AND r.patient_id = ?';   binds.push(patient_id); }
  if (from_date)    { where += ' AND date(r.created_at) >= ?'; binds.push(from_date); }
  if (to_date)      { where += ' AND date(r.created_at) <= ?'; binds.push(to_date); }
  if (order_status) { where += ' AND r.order_status = ?'; binds.push(order_status); }

  const countSql = `SELECT COUNT(*) as total FROM radiology_reports r ${where}`;
  const selectSql = `
    SELECT r.id, r.requisition_id, r.patient_id, p.name as patient_name,
           r.imaging_type_name, r.imaging_item_name, r.radiology_number,
           r.order_status, r.performer_name, r.created_at
    FROM radiology_reports r
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    ${where}
    ORDER BY r.id DESC LIMIT ? OFFSET ?`;

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with c.env.DB.batch() for radiology reports listing.
  // Why: Promise.all() sends 2 separate HTTP network requests to Cloudflare D1.
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare(countSql).bind(...binds),
    c.env.DB.prepare(selectSql).bind(...binds, limit, offset),
  ]);

  const total = (batchResults[0]?.results?.[0] as { total?: number })?.total ?? 0;
  return c.json({
    reports: batchResults[1]?.results ?? [],
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE REPORT  (F-01: atomic radiology number, F-02: D1 batch)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/', requireRole(...RAD_REPORT), zValidator('json', createReportSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // ─── P0-16: cross-check requisition ownership/details first ────────────
  // We do NOT trust the client-supplied patient_id, visit_id, prescriber_id,
  // imaging_*_id or imaging_*_name; every field that the client passes is
  // overridden by the server-side requisition record. The createReportSchema
  // keeps the original fields for backward compatibility, but we ignore
  // them if they conflict.
  const req = await c.env.DB.prepare(
    `SELECT r.id, r.patient_id, r.visit_id, r.imaging_type_id, r.imaging_type_name,
            r.imaging_item_id, r.imaging_item_name, r.prescriber_id, r.prescriber_name,
            r.admission_id, r.is_report_saved, r.order_status,
            ${getDiagnosticBillingColumns('r')}
     FROM radiology_requisitions r
     ${getDiagnosticBillingJoin('r')}
     WHERE r.id = ? AND r.tenant_id = ?`,
  ).bind(data.requisition_id, tenantId).first<{
    id: number; patient_id: number; visit_id: number | null;
    imaging_type_id: number | null; imaging_type_name: string | null;
    imaging_item_id: number | null; imaging_item_name: string | null;
    prescriber_id: number | null; prescriber_name: string | null;
    admission_id: number | null; is_report_saved: number; order_status: string;
  }>();

  if (!req) throw new HTTPException(404, { message: 'Requisition not found' });
  assertRadiologyBillCleared(req as Record<string, unknown>, 'radiology report creation');
  if (req.is_report_saved) throw new HTTPException(409, { message: 'Report already exists for this requisition' });
  if (req.order_status === 'cancelled') throw new HTTPException(400, { message: 'Cannot report a cancelled requisition' });

  // P0-16: If the client supplied a different patient_id, refuse the call.
  // Returning 400 (not 404) here because the requisition IS visible to the
  // caller — they are trying to lie about its linkage.
  if (data.patient_id && data.patient_id !== req.patient_id) {
    throw new HTTPException(400, { message: 'patient_id does not match the requisition patient' });
  }
  if (data.visit_id != null && data.visit_id !== req.visit_id) {
    throw new HTTPException(400, { message: 'visit_id does not match the requisition visit' });
  }
  if (data.imaging_item_id != null && data.imaging_item_id !== req.imaging_item_id) {
    throw new HTTPException(400, { message: 'imaging_item_id does not match the requisition imaging item' });
  }
  if (data.imaging_type_id != null && data.imaging_type_id !== req.imaging_type_id) {
    throw new HTTPException(400, { message: 'imaging_type_id does not match the requisition imaging type' });
  }
  if (data.prescriber_id != null && data.prescriber_id !== req.prescriber_id) {
    throw new HTTPException(400, { message: 'prescriber_id does not match the requisition prescriber' });
  }

  // F-01 FIX: Generate radiology number with retry on UNIQUE collision
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  let radNumber = data.radiology_number;
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (!radNumber) {
      const countRow = await c.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM radiology_reports WHERE tenant_id = ? AND radiology_number LIKE ?`,
      ).bind(tenantId, `RAD-${today}%`).first<{ cnt: number }>();
      const seq = (countRow?.cnt ?? 0) + attempt; // offset by attempt number on retry
      radNumber = `RAD-${today}-${String(seq).padStart(3, '0')}`;
    }

    // P0-16: prefer the server-side requisition metadata over the body.
    const insertStmt = c.env.DB.prepare(`
      INSERT INTO radiology_reports
      (tenant_id, requisition_id, patient_id, visit_id,
       imaging_type_id, imaging_type_name, imaging_item_id, imaging_item_name,
       prescriber_id, prescriber_name, performer_id, performer_name,
       template_id, report_text, indication, radiology_number,
       image_key, patient_study_id, signatories, order_status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      data.requisition_id,
      req.patient_id,                                     // server-derived
      req.visit_id           ?? null,                      // server-derived
      req.imaging_type_id    ?? null,                      // server-derived
      req.imaging_type_name  ?? null,                      // server-derived
      req.imaging_item_id    ?? null,                      // server-derived
      req.imaging_item_name  ?? null,                      // server-derived
      req.prescriber_id      ?? null,                      // server-derived
      req.prescriber_name    ?? null,                      // server-derived
      data.performer_id       ?? null,                     // performer is requester-side
      data.performer_name     ?? null,                     // performer is requester-side
      data.template_id        ?? null,
      data.report_text        ?? null,
      data.indication         ?? null,
      radNumber,
      data.image_key          ?? null,
      data.patient_study_id   ?? null,
      data.signatories        ?? null,
      data.order_status       ?? 'pending',
      userId,
    );

    const updateReqStmt = c.env.DB.prepare(
      `UPDATE radiology_requisitions SET is_report_saved = 1, order_status = 'reported', updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
    ).bind(data.requisition_id, tenantId);

    try {
      // Atomic batch — both succeed or both fail
      const results = await c.env.DB.batch([insertStmt, updateReqStmt]);
      const reportId = results[0].meta.last_row_id;
      void createAuditLog(c.env, tenantId, userId, 'CREATE', 'radiology_reports', reportId, null, {
        radNumber,
        imaging_item_name: req.imaging_item_name,           // server-derived audit
        requisition_patient_id: req.patient_id,
        request_patient_id: data.patient_id ?? null,
      });
      return c.json({ id: reportId, radiology_number: radNumber, message: 'Report created' }, 201);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on UNIQUE constraint violation (race condition on radiology_number)
      if ((msg.includes('UNIQUE') || msg.includes('unique')) && attempt < MAX_RETRIES) {
        radNumber = null as unknown as string; // force re-generation on next attempt
        continue;
      }
      throw err;
    }
  }

  // Should never reach here, but satisfy TypeScript
  throw new HTTPException(500, { message: 'Failed to generate unique radiology number after retries' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET SINGLE REPORT
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/:id', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Report ID');

  const report = await c.env.DB.prepare(`
    SELECT r.*, p.name as patient_name, p.mobile as patient_phone, p.date_of_birth as patient_dob
    FROM radiology_reports r
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    WHERE r.id = ? AND r.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!report) throw new HTTPException(404, { message: 'Report not found' });
  return c.json({ report });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE REPORT  (F-08: block editing finalized reports)
// ═══════════════════════════════════════════════════════════════════════════════

app.put('/:id', requireRole(...RAD_REPORT), zValidator('json', updateReportSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Report ID');
  const data = c.req.valid('json');

  // F-08: Block editing finalized reports
  const existing = await c.env.DB.prepare(
    'SELECT id, order_status FROM radiology_reports WHERE id = ? AND tenant_id = ?',
  ).bind(id, tenantId).first<{ id: number; order_status: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Report not found' });
  if (existing.order_status === 'final') {
    throw new HTTPException(409, { message: 'Cannot edit a finalized report' });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];

  const fieldMap: Record<string, string> = {
    imaging_type_name: 'imaging_type_name',
    imaging_item_name: 'imaging_item_name',
    performer_id:      'performer_id',
    performer_name:    'performer_name',
    template_id:       'template_id',
    report_text:       'report_text',
    indication:        'indication',
    radiology_number:  'radiology_number',
    image_key:         'image_key',
    patient_study_id:  'patient_study_id',
    signatories:       'signatories',
    order_status:      'order_status',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if ((data as Record<string, unknown>)[key] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push((data as Record<string, unknown>)[key]);
    }
  }

  if (!sets.length) throw new HTTPException(400, { message: 'No fields to update' });
  sets.push("updated_at = datetime('now', '+6 hours')");
  vals.push(tenantId, id);

  await c.env.DB.prepare(
    `UPDATE radiology_reports SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`,
  ).bind(...vals).run();

  return c.json({ success: true, message: 'Report updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINALIZE REPORT
// ═══════════════════════════════════════════════════════════════════════════════

app.patch('/:id/finalize', requireRole(...RAD_FINALIZE), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Report ID');

  const r = await c.env.DB.prepare(
    `UPDATE radiology_reports SET order_status = 'final', updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND order_status = 'pending'`,
  ).bind(id, tenantId).run();

  if (!r.meta.changes) throw new HTTPException(404, { message: 'Report not found or already finalized' });
  void createAuditLog(c.env, tenantId, requireUserId(c), 'UPDATE', 'radiology_reports', id, null, {
    action: 'finalize',
    status: 'final',
  });
  return c.json({ success: true, message: 'Report finalized' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE (soft)  (F-03: batch with requisition reset)
// ═══════════════════════════════════════════════════════════════════════════════

app.delete('/:id', requireRole(...RAD_REPORT), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Report ID');

  // F-03: Look up requisition_id so we can reset is_report_saved
  const existing = await c.env.DB.prepare(
    'SELECT id, requisition_id, order_status FROM radiology_reports WHERE id = ? AND tenant_id = ? AND is_active = 1',
  ).bind(id, tenantId).first<{ id: number; requisition_id: number; order_status: string }>();

  if (!existing) throw new HTTPException(404, { message: 'Report not found' });
  if (existing.order_status === 'final') {
    throw new HTTPException(409, { message: 'Cannot delete a finalized report' });
  }

  // Batch: soft-delete the report AND reset the requisition flag
  const deleteReportStmt = c.env.DB.prepare(
    `UPDATE radiology_reports SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
  ).bind(id, tenantId);

  const resetReqStmt = c.env.DB.prepare(
    `UPDATE radiology_requisitions SET is_report_saved = 0, order_status = 'scanned', updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
  ).bind(existing.requisition_id, tenantId);

  await c.env.DB.batch([deleteReportStmt, resetReqStmt]);
  void createAuditLog(c.env, tenantId, requireUserId(c), 'DELETE', 'radiology_reports', id, null, { requisition_id: existing.requisition_id });
  return c.json({ success: true });
});

export default app;

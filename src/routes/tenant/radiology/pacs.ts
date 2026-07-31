import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId, parseId } from '../../../lib/context-helpers';
import { requireRole } from '../../../middleware/rbac';
import { createDicomStudySchema, pacsQuerySchema, uploadUrlSchema } from '../../../schemas/radiology';
import { z } from 'zod';
import {
  getDiagnosticBillingClearance,
  getDiagnosticBillingColumns,
  getDiagnosticBillingJoin,
} from '../../../lib/diagnostic-billing';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const RAD_READ = ['hospital_admin', 'doctor', 'md', 'nurse', 'reception'];
const RAD_SCAN = ['hospital_admin', 'doctor', 'md', 'nurse'];

type PacsContext = Context<{ Bindings: Env; Variables: Variables }>;

async function requireAgentTenant(c: PacsContext) {
  const tenantId = c.req.header('X-Tenant-ID');
  const apiKey = c.req.header('X-API-Key');

  if (!tenantId) throw new HTTPException(400, { message: 'X-Tenant-ID header required' });
  if (!apiKey) throw new HTTPException(400, { message: 'X-API-Key header required' });

  const keyRow = await c.env.DB.prepare(
    'SELECT tenant_id FROM api_keys WHERE key_hash = ? AND is_active = 1',
  ).bind(apiKey).first<{ tenant_id: string }>();

  if (!keyRow || keyRow.tenant_id !== tenantId) {
    throw new HTTPException(403, { message: 'Invalid API key for this tenant' });
  }

  return tenantId;
}

async function assertRequisitionPaymentCleared(
  db: D1Database,
  tenantId: string,
  requisitionId?: number,
) {
  if (!requisitionId) return;
  const req = await db.prepare(
    `SELECT r.id, ${getDiagnosticBillingColumns('r')}
     FROM radiology_requisitions r
     ${getDiagnosticBillingJoin('r')}
     WHERE r.id = ? AND r.tenant_id = ? AND r.is_active = 1`,
  ).bind(requisitionId, tenantId).first<Record<string, unknown>>();
  if (!req) throw new HTTPException(404, { message: 'Requisition not found' });

  const clearance = getDiagnosticBillingClearance(req);
  if (!clearance.cleared) {
    throw new HTTPException(409, {
      message: `Diagnostic bill payment required before PACS study mapping. Bill #${clearance.billId ?? 'unknown'} is ${clearance.paymentStatus}; outstanding ${clearance.outstanding}.`,
    });
  }
}

async function findRequisitionByAccession(db: D1Database, tenantId: string, accessionNo?: string) {
  if (!accessionNo) return null;
  return db.prepare(
    `SELECT r.id, r.accession_no, r.patient_id, ${getDiagnosticBillingColumns('r')}
     FROM radiology_requisitions r
     ${getDiagnosticBillingJoin('r')}
     WHERE r.accession_no = ? AND r.tenant_id = ? AND r.is_active = 1`,
  ).bind(accessionNo, tenantId).first<Record<string, unknown>>();
}

async function enqueueReconciliation(
  db: D1Database,
  tenantId: string,
  issueType: string,
  data: { studyId?: number; studyUid: string; accessionNo?: string; patientId?: string; patientName?: string; modality?: string; requisitionId?: number | null },
) {
  const open = await db.prepare(
    `SELECT id FROM ris_study_reconciliation_queue WHERE tenant_id = ? AND study_instance_uid = ? AND status = 'open' LIMIT 1`,
  ).bind(tenantId, data.studyUid).first<{ id: number }>().catch(() => null);
  if (open?.id) return;

  await db.prepare(`
    INSERT INTO ris_study_reconciliation_queue
      (tenant_id, requisition_id, dicom_study_id, accession_no, study_instance_uid, patient_id, patient_name, modality, issue_type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    data.requisitionId ?? null,
    data.studyId ?? null,
    data.accessionNo ?? null,
    data.studyUid,
    data.patientId ? Number.parseInt(data.patientId, 10) || null : null,
    data.patientName ?? null,
    data.modality ?? null,
    issueType,
  ).run().catch(() => undefined);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORWARD endpoint — receives study metadata from on-premise DICOM agent
// Called by dicom-scp.js when a modality sends an image
// ═══════════════════════════════════════════════════════════════════════════════

const forwardSchema = z.object({
  studyInstanceUid: z.string().min(1),
  patientName: z.string().optional(),
  patientId: z.string().optional(),
  modality: z.string().max(10).optional(),
  studyDate: z.string().optional(),
  studyDescription: z.string().optional(),
  sopClassUid: z.string().optional(),
  // AE title of the modality that sent this study (for audit trail)
  sourceAETitle: z.string().max(16).optional(),
  // Optional: link to existing requisition
  requisitionId: z.number().int().positive().optional(),
  // DICOM Accession Number used for RIS ↔ PACS reconciliation
  accessionNo: z.string().trim().max(80).optional(),
  // If R2 key provided, the file was already uploaded
  r2Key: z.string().optional(),
});

const resolveReconciliationSchema = z.object({
  requisitionId: z.number().int().positive().optional(),
  status: z.enum(['resolved', 'ignored']).default('resolved'),
  notes: z.string().trim().max(1000).optional(),
});

// POST /api/radiology/pacs/forward — receive forwarded study from DICOM agent
// Auth via X-Tenant-ID + X-API-Key headers (not role-based — agent has no user context)
app.post('/forward', async (c) => {
  const tenantId = await requireAgentTenant(c);
  const body = await c.req.json();
  const data = forwardSchema.parse(body);
  const accessionMatch = !data.requisitionId ? await findRequisitionByAccession(c.env.DB, tenantId, data.accessionNo) : null;
  const resolvedRequisitionId = data.requisitionId ?? (accessionMatch?.id ? Number(accessionMatch.id) : undefined);
  await assertRequisitionPaymentCleared(c.env.DB, tenantId, resolvedRequisitionId);

  // Check for duplicate study
  const existing = await c.env.DB.prepare(
    'SELECT id, r2_key, requisition_id, is_mapped FROM radiology_dicom_studies WHERE study_instance_uid = ? AND tenant_id = ? AND is_active = 1',
  ).bind(data.studyInstanceUid, tenantId).first<{ id: number; r2_key: string | null; requisition_id: number | null; is_mapped: number | null }>();

  if (existing) {
    // Already registered — if R2 key provided and different, update it
    if (data.r2Key && existing.r2_key !== data.r2Key) {
      await c.env.DB.prepare(
        'UPDATE radiology_dicom_studies SET r2_key = ?, source_ae_title = COALESCE(?, source_ae_title), image_count = image_count + 1, updated_at = datetime("now") WHERE id = ?',
      ).bind(data.r2Key, data.sourceAETitle ?? null, existing.id).run();
    }
    if (resolvedRequisitionId && !existing.requisition_id) {
      await c.env.DB.prepare(
        `UPDATE radiology_dicom_studies SET requisition_id = ?, is_mapped = 1, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
      ).bind(resolvedRequisitionId, existing.id, tenantId).run();
    } else if (!existing.requisition_id) {
      await enqueueReconciliation(c.env.DB, tenantId, data.accessionNo ? 'accession_not_found' : 'missing_accession', {
        studyId: existing.id,
        studyUid: data.studyInstanceUid,
        accessionNo: data.accessionNo,
        patientId: data.patientId,
        patientName: data.patientName,
        modality: data.modality,
      });
    }
    return c.json({ id: existing.id, message: 'Study already registered', alreadyExists: true, requisitionId: resolvedRequisitionId ?? existing.requisition_id ?? null }, 200);
  }

  // Create new study record
  const r = await c.env.DB.prepare(`
    INSERT INTO radiology_dicom_studies
    (tenant_id, study_instance_uid, modality, study_date, study_description,
     patient_name, patient_id, sop_class_uid, requisition_id, r2_key, source_ae_title, is_mapped)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    data.studyInstanceUid,
    data.modality ?? null,
    data.studyDate ?? null,
    data.studyDescription ?? null,
    data.patientName ?? null,
    data.patientId ?? null,
    data.sopClassUid ?? null,
    resolvedRequisitionId ?? null,
    data.r2Key ?? null,
    data.sourceAETitle ?? null,
    resolvedRequisitionId ? 1 : 0,
  ).run();

  const studyId = Number(r.meta.last_row_id);
  if (!resolvedRequisitionId) {
    await enqueueReconciliation(c.env.DB, tenantId, data.accessionNo ? 'accession_not_found' : 'missing_accession', {
      studyId,
      studyUid: data.studyInstanceUid,
      accessionNo: data.accessionNo,
      patientId: data.patientId,
      patientName: data.patientName,
      modality: data.modality,
    });
  }

  console.info(`[pacs] Forwarded study registered: tenant=${tenantId} study=${data.studyInstanceUid} id=${studyId}`);

  return c.json({ id: studyId, requisitionId: resolvedRequisitionId ?? null, reconciliationRequired: !resolvedRequisitionId, message: 'Study registered from DICOM agent' }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIST DICOM STUDIES  (F-04: added is_active filter)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/', requireRole(...RAD_READ), zValidator('query', pacsQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, modality, from_date, to_date } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let where = 'WHERE tenant_id = ? AND is_active = 1';
  const binds: unknown[] = [tenantId];

  if (patient_id) { where += ' AND patient_id = ?';   binds.push(patient_id); }
  if (modality)   { where += ' AND modality = ?';     binds.push(modality); }
  if (from_date)  { where += ' AND study_date >= ?';   binds.push(from_date); }
  if (to_date)    { where += ' AND study_date <= ?';   binds.push(to_date); }

  const countSql  = `SELECT COUNT(*) as total FROM radiology_dicom_studies ${where}`;
  const selectSql = `
    SELECT id, patient_id, patient_name, study_instance_uid, modality,
           study_date, study_description, series_count, image_count, is_mapped, created_at
    FROM radiology_dicom_studies
    ${where}
    ORDER BY id DESC LIMIT ? OFFSET ?`;

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with c.env.DB.batch() for PACS studies listing.
  // Why: Promise.all() sends 2 separate HTTP network requests to Cloudflare D1.
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare(countSql).bind(...binds),
    c.env.DB.prepare(selectSql).bind(...binds, limit, offset),
  ]);

  const total = (batchResults[0]?.results?.[0] as { total?: number })?.total ?? 0;
  return c.json({
    studies: batchResults[1]?.results ?? [],
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// GET /api/radiology/pacs/modality-worklist — on-prem DICOM bridge worklist feed.
// Cloudflare Workers cannot run a DIMSE C-FIND SCP, so the local bridge calls this
// HTTP endpoint and exposes MWL to CT/MRI/CR/US modalities on the hospital LAN.
app.get('/modality-worklist', async (c) => {
  const tenantId = await requireAgentTenant(c);
  const modality = c.req.query('modality');
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);

  let where = `WHERE r.tenant_id = ? AND r.is_active = 1 AND r.order_status = 'pending'
    AND (r.imaging_date IS NULL OR r.imaging_date = ?)`;
  const binds: unknown[] = [tenantId, date];

  if (modality) {
    where += ' AND (it.code = ? OR r.imaging_type_name = ?)';
    binds.push(modality, modality);
  }

  const rows = await c.env.DB.prepare(`
    SELECT r.id, r.accession_no, r.patient_id, p.name as patient_name,
           p.gender, p.date_of_birth, r.imaging_date, r.imaging_type_name,
           r.imaging_item_name, r.procedure_code, r.urgency,
           ${getDiagnosticBillingColumns('r')}
    FROM radiology_requisitions r
    ${getDiagnosticBillingJoin('r')}
    LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
    LEFT JOIN radiology_imaging_types it ON it.id = r.imaging_type_id AND it.tenant_id = r.tenant_id
    ${where}
    ORDER BY CASE r.urgency WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, r.id ASC
    LIMIT 100
  `).bind(...binds).all<Record<string, unknown>>();

  const worklist = (rows.results ?? [])
    .filter((row) => getDiagnosticBillingClearance(row).cleared)
    .map((row) => ({
      accessionNumber: row.accession_no ?? `RAD-${row.id}`,
      requisitionId: row.id,
      patientId: row.patient_id,
      patientName: row.patient_name,
      patientSex: row.gender,
      patientBirthDate: row.date_of_birth,
      scheduledDate: row.imaging_date ?? date,
      modality: modality ?? row.imaging_type_name,
      procedureCode: row.procedure_code,
      procedureDescription: row.imaging_item_name ?? row.imaging_type_name,
      priority: row.urgency,
    }));

  return c.json({ worklist, count: worklist.length, date, modality: modality ?? null });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RIS ↔ PACS RECONCILIATION QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/reconciliation', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  const status = c.req.query('status') ?? 'open';
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '25', 10) || 25));
  const offset = (page - 1) * limit;

  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM ris_study_reconciliation_queue WHERE tenant_id = ? AND status = ?',
  ).bind(tenantId, status).first<{ total: number }>();

  const rows = await c.env.DB.prepare(`
    SELECT q.*, ds.study_description, ds.study_date, ds.r2_key,
           rr.accession_no AS requisition_accession_no,
           rr.imaging_item_name, rr.imaging_type_name
    FROM ris_study_reconciliation_queue q
    LEFT JOIN radiology_dicom_studies ds ON ds.id = q.dicom_study_id AND ds.tenant_id = q.tenant_id
    LEFT JOIN radiology_requisitions rr ON rr.id = q.requisition_id AND rr.tenant_id = q.tenant_id
    WHERE q.tenant_id = ? AND q.status = ?
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, status, limit, offset).all();

  const total = Number(countRow?.total ?? 0);
  return c.json({ data: rows.results ?? [], pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

app.post('/reconciliation/:id/resolve', requireRole(...RAD_SCAN), zValidator('json', resolveReconciliationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param('id'), 'Reconciliation ID');
  const data = c.req.valid('json');

  const item = await c.env.DB.prepare(
    `SELECT * FROM ris_study_reconciliation_queue WHERE id = ? AND tenant_id = ? AND status = 'open'`,
  ).bind(id, tenantId).first<Record<string, unknown>>();
  if (!item) throw new HTTPException(404, { message: 'Open reconciliation item not found' });

  if (data.status === 'resolved') {
    if (!data.requisitionId) throw new HTTPException(400, { message: 'requisitionId is required when resolving' });
    await assertRequisitionPaymentCleared(c.env.DB, tenantId, data.requisitionId);
    await c.env.DB.prepare(
      `UPDATE radiology_dicom_studies SET requisition_id = ?, is_mapped = 1, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
    ).bind(data.requisitionId, item.dicom_study_id, tenantId).run();
  }

  await c.env.DB.prepare(`
    UPDATE ris_study_reconciliation_queue
    SET status = ?, requisition_id = COALESCE(?, requisition_id), resolved_by = ?, resolved_at = datetime('now', '+6 hours'), resolution_notes = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(data.status, data.requisitionId ?? null, userId, data.notes ?? null, id, tenantId).run();

  return c.json({ id, status: data.status, message: data.status === 'ignored' ? 'Reconciliation item ignored' : 'Study reconciled' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET STUDY DETAIL  (F-12: configurable OHIF URL)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/:id', requireRole(...RAD_READ), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Study ID');

  const study = await c.env.DB.prepare(
    'SELECT * FROM radiology_dicom_studies WHERE id = ? AND tenant_id = ? AND is_active = 1',
  ).bind(id, tenantId).first();

  if (!study) throw new HTTPException(404, { message: 'Study not found' });

  // F-12: Use configurable OHIF base URL from env, fallback to note
  const studyUid = (study as Record<string, unknown>).study_instance_uid as string;
  const ohifBase = (c.env as unknown as Record<string, unknown>).OHIF_BASE_URL as string | undefined;
  const viewerUrl = studyUid && ohifBase ? `${ohifBase}/viewer/${studyUid}` : null;

  return c.json({
    study: { ...study, viewer_url: viewerUrl },
    ...(viewerUrl ? {} : { note: 'Set OHIF_BASE_URL env var to enable viewer links' }),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE / REGISTER STUDY (on first image received from modality)
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/', requireRole(...RAD_SCAN), zValidator('json', createDicomStudySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  await assertRequisitionPaymentCleared(c.env.DB, tenantId, data.requisition_id);

  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO radiology_dicom_studies
      (tenant_id, patient_id, patient_name, study_instance_uid, sop_class_uid,
       study_date, modality, study_description, requisition_id, is_mapped)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      data.patient_id       ?? null,
      data.patient_name     ?? null,
      data.study_instance_uid,
      data.sop_class_uid    ?? null,
      data.study_date       ?? null,
      data.modality         ?? null,
      data.study_description ?? null,
      data.requisition_id   ?? null,
      0,
    ).run();

    return c.json({ id: r.meta.last_row_id, message: 'Study registered' }, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      // F-09 FIX: Check with tenant_id scoping
      const existing = await c.env.DB.prepare(
        'SELECT id FROM radiology_dicom_studies WHERE study_instance_uid = ? AND tenant_id = ? AND is_active = 1',
      ).bind(data.study_instance_uid, tenantId).first<{ id: number }>();
      return c.json({ id: existing?.id, message: 'Study already registered' }, 200);
    }
    throw err;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SOFT DELETE STUDY
// ═══════════════════════════════════════════════════════════════════════════════

app.delete('/:id', requireRole(...RAD_SCAN), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Study ID');

  const r = await c.env.DB.prepare(
    `UPDATE radiology_dicom_studies SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND is_active = 1`,
  ).bind(id, tenantId).run();

  if (!r.meta.changes) throw new HTTPException(404, { message: 'Study not found' });
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET R2 UPLOAD URL  (F-05: validated with Zod)
// ═══════════════════════════════════════════════════════════════════════════════

// F-05 FIX: Actual R2 upload endpoint for DICOM files
app.put('/upload/:key{.+}', requireRole(...RAD_SCAN), async (c) => {
  const tenantId = requireTenantId(c);
  const key = c.req.param('key');

  // Security: ensure key belongs to this tenant
  const expectedPrefix = `dicom/${tenantId}/`;
  if (!key.startsWith(expectedPrefix)) {
    throw new HTTPException(403, { message: 'Upload key does not match tenant' });
  }

  const body = await c.req.arrayBuffer();
  if (!body || body.byteLength === 0) {
    throw new HTTPException(400, { message: 'Empty file body' });
  }

  // Max 50MB for DICOM files
  if (body.byteLength > 50 * 1024 * 1024) {
    throw new HTTPException(413, { message: 'File too large (max 50MB)' });
  }

  const contentType = c.req.header('content-type') ?? 'application/dicom';
  await c.env.UPLOADS.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { tenant_id: tenantId, uploaded_at: new Date().toISOString() },
  });

  return c.json({ success: true, key, size: body.byteLength });
});

export default app;

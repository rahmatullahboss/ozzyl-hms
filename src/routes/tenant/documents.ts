import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../lib/pagination';
import { getDb } from '../../db';
import { createAuditLog } from '../../lib/accounting-helpers';

type DEnv = { Bindings: Env; Variables: Variables };
const documentRoutes = new Hono<DEnv>();

const uploadDocSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  document_type: z.enum(['lab_report', 'imaging', 'referral', 'prescription', 'consent', 'discharge_summary', 'insurance', 'id_document', 'other']),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  document_date: z.string().optional(),
  department: z.string().optional(),
  tags: z.array(z.string()).optional(),
  is_confidential: z.boolean().default(false),
});

const MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160) || 'document';
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT CRUD
// ═══════════════════════════════════════════════════════════════════════════

/** GET / — List documents with filters */
documentRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, document_type, search, from_date, to_date } = c.req.query();
  const { page, limit, offset } = getPagination(c);

  let where = 'WHERE pd.tenant_id = ? AND pd.is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (patient_id) { where += ' AND pd.patient_id = ?'; params.push(patient_id); }
  if (document_type) { where += ' AND pd.document_type = ?'; params.push(document_type); }
  if (from_date) { where += ' AND pd.document_date >= ?'; params.push(from_date); }
  if (to_date) { where += ' AND pd.document_date <= ?'; params.push(to_date); }
  if (search) { where += ' AND (pd.title LIKE ? OR pd.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM patient_documents pd ${where}`,
  ).bind(...params).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT pd.*, p.name as patient_name, p.patient_code
    FROM patient_documents pd
    JOIN patients p ON pd.patient_id = p.id
    ${where} ORDER BY pd.created_at DESC LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results, meta: paginationMeta(page, limit, countResult?.total ?? 0) });
});

/** GET /:id — Get single document metadata */
documentRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doc = await db.$client.prepare(
    `SELECT pd.*, p.name as patient_name, p.patient_code
     FROM patient_documents pd JOIN patients p ON pd.patient_id = p.id
     WHERE pd.id = ? AND pd.tenant_id = ? AND pd.is_active = 1`,
  ).bind(c.req.param('id'), tenantId).first();
  if (!doc) throw new HTTPException(404, { message: 'Document not found' });
  return c.json({ data: doc });
});

/** POST / — Upload document (multipart/form-data with file + metadata) */
documentRoutes.post('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const body = await c.req.parseBody();
  const file = body['file'];
  const metadata = body['metadata'];

  if (!file || typeof file === 'string') {
    throw new HTTPException(400, { message: 'File is required' });
  }

  let meta: z.infer<typeof uploadDocSchema>;
  try {
    meta = uploadDocSchema.parse(JSON.parse(metadata as string || '{}'));
  } catch {
    throw new HTTPException(400, { message: 'Invalid metadata' });
  }

  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(meta.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  if (!c.env.UPLOADS) {
    throw new HTTPException(503, { message: 'Document storage is not configured' });
  }

  let storageKey: string;
  const storageProvider = 'r2';
  const fileBuffer = await file.arrayBuffer();
  const fileSize = fileBuffer.byteLength;

  if (fileSize <= 0) {
    throw new HTTPException(400, { message: 'Uploaded file is empty' });
  }
  if (fileSize > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new HTTPException(413, { message: 'Uploaded file is too large' });
  }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(file.type)) {
    throw new HTTPException(400, { message: 'Unsupported document file type' });
  }

  const safeFileName = sanitizeFileName(file.name);
  storageKey = `tenants/${tenantId}/patients/${meta.patient_id}/documents/${Date.now()}-${safeFileName}`;
  await c.env.UPLOADS.put(storageKey, fileBuffer, {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      tenantId: String(tenantId),
      patientId: String(meta.patient_id),
      uploadedBy: String(userId),
    },
  });

  const result = await db.$client.prepare(`
    INSERT INTO patient_documents (patient_id, visit_id, document_type, title, description,
      file_name, file_size, mime_type, storage_key, storage_provider,
      document_date, source, uploaded_by, department, tags, is_confidential, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?, ?, ?)
  `).bind(
    meta.patient_id, meta.visit_id ?? null, meta.document_type, meta.title,
    meta.description ?? null, safeFileName, fileSize, file.type,
    storageKey, storageProvider, meta.document_date ?? null,
    userId, meta.department ?? null,
    meta.tags ? JSON.stringify(meta.tags) : null,
    meta.is_confidential ? 1 : 0, tenantId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Document uploaded', storage_provider: storageProvider }, 201);
});

/** GET /:id/download — Download document file */
documentRoutes.get('/:id/download', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const doc = await db.$client.prepare(
    'SELECT id, patient_id, storage_key, storage_provider, file_name, mime_type FROM patient_documents WHERE id = ? AND tenant_id = ? AND is_active = 1',
  ).bind(c.req.param('id'), tenantId).first() as any;
  if (!doc) throw new HTTPException(404, { message: 'Document not found' });

  if (doc.storage_provider === 'r2' && c.env.UPLOADS) {
    const object = await (c.env.UPLOADS as any).get(doc.storage_key);
    if (!object) throw new HTTPException(404, { message: 'File not found in storage' });
    await createAuditLog(c.env, tenantId, userId, 'VIEW', 'patient_documents', Number(doc.id), null, {
      patientId: doc.patient_id,
      action: 'download',
    });
    return new Response(object.body, {
      headers: {
        'Content-Type': doc.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${sanitizeFileName(doc.file_name || 'document')}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  throw new HTTPException(500, { message: 'Unknown storage provider' });
});

/** DELETE /:id — Soft delete */
documentRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await db.$client.prepare(
    'UPDATE patient_documents SET is_active = 0 WHERE id = ? AND tenant_id = ?',
  ).bind(c.req.param('id'), tenantId).run();
  return c.json({ message: 'Document deleted' });
});

/** GET /patient/:patientId/summary — Document counts by type for a patient */
documentRoutes.get('/patient/:patientId/summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT document_type, COUNT(*) as count FROM patient_documents WHERE patient_id = ? AND tenant_id = ? AND is_active = 1 GROUP BY document_type',
  ).bind(c.req.param('patientId'), tenantId).all();
  return c.json({ data: results });
});

export default documentRoutes;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createImageSchema, updateImageSchema } from '../../../schemas/clinicalImages';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const imageRoutes = new Hono<ClinicalEnv>();

// ─── List images for a patient ─────────────────────────────────────────────

imageRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  const visitId = c.req.query('visitId');
  const imageType = c.req.query('imageType');

  if (!patientId && !visitId)
    throw new HTTPException(400, { message: 'patientId or visitId query param is required' });

  let query = 'SELECT * FROM clinical_images WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (patientId && !isNaN(Number(patientId))) {
    query += ' AND patient_id = ?';
    params.push(Number(patientId));
  }
  if (visitId && !isNaN(Number(visitId))) {
    query += ' AND visit_id = ?';
    params.push(Number(visitId));
  }
  if (imageType) {
    query += ' AND image_type = ?';
    params.push(imageType);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Get single image record ───────────────────────────────────────────────

imageRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const row = await db.$client
    .prepare('SELECT * FROM clinical_images WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();

  if (!row) throw new HTTPException(404, { message: 'Image not found' });
  return c.json({ Results: row });
});

// ─── Upload image (R2 presign + metadata) ──────────────────────────────────

imageRoutes.post('/upload-url', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  let body: { fileName: string; mimeType: string; patientId: number };
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'Invalid request body' });
  }

  if (!body.fileName || !body.mimeType || !body.patientId)
    throw new HTTPException(400, { message: 'fileName, mimeType, and patientId are required' });

  const key = `clinical-images/${tenantId}/${body.patientId}/${Date.now()}-${body.fileName}`;

  await c.env.UPLOADS.put(key, '', {
    httpMetadata: { contentType: body.mimeType },
    customMetadata: { tenantId, uploadedBy: String(userId) },
  });

  return c.json({ Results: { fileKey: key, uploadUrl: `/api/v1/uploads/${key}` } });
});

// ─── Create image record (metadata after upload) ──────────────────────────

imageRoutes.post('/', zValidator('json', createImageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO clinical_images (
      tenant_id, patient_id, visit_id, image_type, title, description,
      file_key, file_name, file_size, mime_type, body_part,
      is_active, uploaded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId, d.patientId, d.visitId ?? null,
    d.imageType ?? 'other', d.title, d.description ?? null,
    d.fileKey, d.fileName ?? null, d.fileSize ?? null,
    d.mimeType ?? null, d.bodyPart ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Update image metadata ─────────────────────────────────────────────────

imageRoutes.put('/:id', zValidator('json', updateImageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT 1 FROM clinical_images WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Image not found' });

  const data = c.req.valid('json');
  const colMap: Record<string, string> = {
    imageType: 'image_type', title: 'title',
    description: 'description', bodyPart: 'body_part',
  };

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && colMap[key]) {
      sets.push(`${colMap[key]} = ?`);
      vals.push(val as string | number);
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    await db.$client
      .prepare(`UPDATE clinical_images SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...vals).run();
  }

  return c.json({ Results: true });
});

// ─── Soft delete image ─────────────────────────────────────────────────────

imageRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT file_key FROM clinical_images WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first<{ file_key: string }>();
  if (!ex) throw new HTTPException(404, { message: 'Image not found' });

  await db.$client
    .prepare("UPDATE clinical_images SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId).run();

  return c.json({ Results: true });
});

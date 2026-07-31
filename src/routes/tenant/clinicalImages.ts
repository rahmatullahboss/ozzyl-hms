import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type ImgEnv = { Bindings: Env; Variables: Variables };

const createImageSchema = z.object({
  PatientId: z.number().int().positive(),
  PatientVisitId: z.number().int().positive().optional(),
  EncounterId: z.number().int().positive().optional(),
  ImageName: z.string().min(1).max(300),
  ImagePath: z.string().min(1),
  ImageType: z.enum(['Eye', 'XRay', 'Dental', 'Wound', 'Skin', 'Other']).optional(),
  Notes: z.string().max(2000).optional(),
});

const updateImageSchema = z.object({
  ImageName: z.string().min(1).max(300).optional(),
  ImageType: z.string().max(50).optional(),
  Notes: z.string().max(2000).optional(),
});

const clinicalImageRoutes = new Hono<ImgEnv>();

// GET / — list images
clinicalImageRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, visitId, imageType } = c.req.query();

  if (!patientId && !visitId) {
    throw new HTTPException(400, { message: 'patientId or visitId required' });
  }

  let query = 'SELECT * FROM CLN_ScannedImages WHERE tenant_id = ? AND IsActive = 1';
  const params: (string | number)[] = [tenantId];

  if (patientId) { query += ' AND PatientId = ?'; params.push(Number(patientId)); }
  if (visitId) { query += ' AND PatientVisitId = ?'; params.push(Number(visitId)); }
  if (imageType) { query += ' AND ImageType = ?'; params.push(imageType); }
  query += ' ORDER BY UploadedOn DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// GET /:id
clinicalImageRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const image = await db.$client.prepare(
    'SELECT * FROM CLN_ScannedImages WHERE tenant_id = ? AND ScannedImageId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!image) throw new HTTPException(404, { message: 'Image not found' });

  return c.json({ Results: image });
});

// POST / — create image record
clinicalImageRoutes.post('/', zValidator('json', createImageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO CLN_ScannedImages (tenant_id, PatientId, PatientVisitId, EncounterId, ImageName, ImagePath, ImageType, Notes, UploadedBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.PatientVisitId ?? null,
    data.EncounterId ?? null, data.ImageName, data.ImagePath,
    data.ImageType ?? null, data.Notes ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /:id — update metadata
clinicalImageRoutes.put('/:id', zValidator('json', updateImageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT ScannedImageId FROM CLN_ScannedImages WHERE tenant_id = ? AND ScannedImageId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Image not found' });

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.ImageName) { updates.push('ImageName = ?'); params.push(data.ImageName); }
  if (data.ImageType) { updates.push('ImageType = ?'); params.push(data.ImageType); }
  if (data.Notes !== undefined) { updates.push('Notes = ?'); params.push(data.Notes ?? null); }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  params.push(tenantId, id);
  await db.$client.prepare(
    `UPDATE CLN_ScannedImages SET ${updates.join(', ')} WHERE tenant_id = ? AND ScannedImageId = ?`
  ).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// DELETE /:id — soft delete
clinicalImageRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT ScannedImageId FROM CLN_ScannedImages WHERE tenant_id = ? AND ScannedImageId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Image not found' });

  await db.$client.prepare(
    'UPDATE CLN_ScannedImages SET IsActive = 0 WHERE tenant_id = ? AND ScannedImageId = ?'
  ).bind(tenantId, id).run();

  return c.json({ Results: { success: true } });
});

export default clinicalImageRoutes;

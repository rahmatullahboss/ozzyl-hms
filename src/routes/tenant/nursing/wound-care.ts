import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createWoundCareSchema, updateWoundCareSchema, NursingQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';


type NursingEnv = { Bindings: Env; Variables: Variables };
const ALLOWED_UPDATE_FIELDS = ['wound_site', 'wound_type', 'size', 'depth', 'exudate', 'description', 'treatment', 'next_dressing_due'];

export const woundCareRoutes = new Hono<NursingEnv>();

woundCareRoutes.get('/', zValidator('query', NursingQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, visit_id } = c.req.valid('query');
  const offset = (page - 1) * limit;
  let query = 'SELECT * FROM nur_wound_care WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (patient_id) { query += ' AND patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND visit_id = ?'; params.push(visit_id); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const { results } = await db.$client.prepare(query).bind(...params).all();
  let countQuery = 'SELECT COUNT(*) as total FROM nur_wound_care WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND visit_id = ?'; countParams.push(visit_id); }
  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

woundCareRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const result = await db.$client.prepare('SELECT * FROM nur_wound_care WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(id, tenantId).first();
  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

woundCareRoutes.post('/', zValidator('json', createWoundCareSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const result = await db.$client.prepare(`
    INSERT INTO nur_wound_care (tenant_id, patient_id, visit_id, wound_site, wound_type, size, depth, exudate, description, treatment, next_dressing_due, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.wound_site ?? null, data.wound_type ?? null,
    data.size ?? null, data.depth ?? null, data.exudate ?? null,
    data.description ?? null, data.treatment ?? null,
    data.next_dressing_due ?? null, userId
  ).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

woundCareRoutes.put('/:id', zValidator('json', updateWoundCareSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const existing = await db.$client.prepare('SELECT 1 FROM nur_wound_care WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  Object.entries(data).forEach(([key, value]) => {
    if (ALLOWED_UPDATE_FIELDS.includes(key) && value !== undefined) { fields.push(`${key} = ?`); values.push(value as string | number | null); }
  });
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')", 'updated_by = ?');
    values.push(userId, id, tenantId);
    await db.$client.prepare(`UPDATE nur_wound_care SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }
  return c.json({ Results: true });
});

woundCareRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const existing = await db.$client.prepare('SELECT 1 FROM nur_wound_care WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  await db.$client.prepare("UPDATE nur_wound_care SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
  return c.json({ Results: true });
});

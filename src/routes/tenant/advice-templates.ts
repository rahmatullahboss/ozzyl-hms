import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { createAdviceTemplateSchema, updateAdviceTemplateSchema } from '../../schemas/advice-templates';

const adviceTemplateRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const MANAGER_ROLES = ['hospital_admin', 'doctor'];

// ─── GET /api/advice-templates — list templates ─────────────────────────────
adviceTemplateRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const category = c.req.query('category');
  const doctorId = c.req.query('doctorId');

  let query = `
    SELECT id, doctor_id, content, category, language, sort_order
    FROM advice_templates
    WHERE tenant_id = ? AND is_active = 1
      AND (doctor_id IS NULL OR doctor_id = ?)
  `;
  const params: (string | number | null)[] = [tenantId, doctorId ? Number(doctorId) : null];

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ' ORDER BY doctor_id DESC, sort_order ASC, id DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();

  return c.json({ templates: results ?? [] });
});

// ─── POST /api/advice-templates — create template ──────────────────────────
adviceTemplateRoutes.post('/', zValidator('json', createAdviceTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');

  if (!role || !MANAGER_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to create advice templates' });
  }

  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO advice_templates
      (tenant_id, doctor_id, content, category, language, sort_order, is_active, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId, data.doctorId ?? null, data.content,
    data.category ?? 'general', data.language ?? 'bn',
    data.sortOrder ?? 0, userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Advice template created' }, 201);
});

// ─── PUT /api/advice-templates/:id — update template ──────────────────────
adviceTemplateRoutes.put('/:id', zValidator('json', updateAdviceTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role = c.get('role');

  if (!role || !MANAGER_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update advice templates' });
  }

  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT id FROM advice_templates WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Template not found' });

  const data = c.req.valid('json');
  const colMap: Record<string, string> = {
    content: 'content', category: 'category', language: 'language', sortOrder: 'sort_order',
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
      .prepare(`UPDATE advice_templates SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...vals).run();
  }

  return c.json({ message: 'Advice template updated' });
});

// ─── DELETE /api/advice-templates/:id — soft delete ────────────────────────
adviceTemplateRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role = c.get('role');

  if (!role || !MANAGER_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to delete advice templates' });
  }

  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT id FROM advice_templates WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Template not found' });

  await db.$client
    .prepare("UPDATE advice_templates SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId).run();

  return c.json({ message: 'Advice template deleted' });
});

export default adviceTemplateRoutes;

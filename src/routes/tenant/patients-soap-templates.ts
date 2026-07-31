import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { soapTemplateSchema, updateSoapTemplateSchema } from '../../schemas/clinical-assessments';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const soapTemplateRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

soapTemplateRoutes.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const specialty = c.req.query('specialty');
  const db = getDb(c.env.DB);

  let query = 'SELECT * FROM soap_templates WHERE (tenant_id = ? OR is_global = 1)';
  const params: (string | number)[] = [tenantId];

  if (specialty) {
    query += ' AND specialty = ?';
    params.push(specialty);
  }
  query += ' ORDER BY name ASC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ templates: results });
});

soapTemplateRoutes.post('/', zValidator('json', soapTemplateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const db = getDb(c.env.DB);

  const result = await db.$client.prepare(`
    INSERT INTO soap_templates (tenant_id, name, name_bn, chief_complaint, subjective, objective, assessment, plan, specialty, is_global, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.name, data.name_bn ?? null, data.chief_complaint,
    data.subjective ?? null, data.objective ?? null, data.assessment ?? null, data.plan ?? null,
    data.specialty ?? null, data.is_global ?? 0, userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Template created' }, 201);
});

soapTemplateRoutes.put('/:templateId', zValidator('json', updateSoapTemplateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const templateId = Number(c.req.param('templateId'));
  if (Number.isNaN(templateId)) throw new HTTPException(400, { message: 'Invalid template ID' });

  const data = c.req.valid('json');
  const db = getDb(c.env.DB);

  const existing = await db.$client.prepare(
    'SELECT id FROM soap_templates WHERE id = ? AND tenant_id = ?'
  ).bind(templateId, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Template not found' });

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (key === 'is_global' || key === 'name' || key === 'name_bn' || key === 'chief_complaint' || key === 'subjective' || key === 'objective' || key === 'assessment' || key === 'plan' || key === 'specialty') {
      sets.push(`${key} = ?`);
      vals.push(val ?? null);
    }
  }
  if (sets.length === 0) return c.json({ message: 'No fields to update' });

  sets.push("updated_at = datetime('now')");
  vals.push(templateId, tenantId);

  await db.$client.prepare(
    `UPDATE soap_templates SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ message: 'Template updated' });
});

soapTemplateRoutes.delete('/:templateId', async (c) => {
  const tenantId = requireTenantId(c);
  const templateId = Number(c.req.param('templateId'));
  if (Number.isNaN(templateId)) throw new HTTPException(400, { message: 'Invalid template ID' });

  const db = getDb(c.env.DB);
  const existing = await db.$client.prepare(
    'SELECT id FROM soap_templates WHERE id = ? AND tenant_id = ?'
  ).bind(templateId, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Template not found' });

  await db.$client.prepare(
    'DELETE FROM soap_templates WHERE id = ? AND tenant_id = ?'
  ).bind(templateId, tenantId).run();

  return c.json({ message: 'Template deleted' });
});

export default soapTemplateRoutes;

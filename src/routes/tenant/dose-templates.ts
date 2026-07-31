import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { createDoseTemplateSchema, updateDoseTemplateSchema } from '../../schemas/dose-templates';

const doseTemplateRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const MANAGER_ROLES = ['hospital_admin', 'doctor'];

// ─── GET /api/dose-templates?doctorId= — list templates for a doctor ─────────
doseTemplateRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = c.req.query('doctorId');

  if (!doctorId || isNaN(Number(doctorId))) {
    throw new HTTPException(400, { message: 'doctorId query parameter is required' });
  }

  const { results } = await db.$client.prepare(`
    SELECT id, name, frequency, duration, instructions, is_default, sort_order
    FROM prescription_dose_templates
    WHERE tenant_id = ? AND doctor_id = ? AND is_active = 1
    ORDER BY is_default DESC, sort_order ASC, name ASC
  `).bind(tenantId, Number(doctorId)).all();

  return c.json({ templates: results ?? [] });
});

// ─── POST /api/dose-templates — create template ─────────────────────────────
doseTemplateRoutes.post('/', zValidator('json', createDoseTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');

  if (!role || !MANAGER_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Only doctors can create dose templates' });
  }

  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO prescription_dose_templates
      (tenant_id, doctor_id, name, frequency, duration, instructions, is_default, sort_order, is_active, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId, data.doctorId, data.name,
    data.frequency ?? null, data.duration ?? null, data.instructions ?? null,
    data.isDefault ?? 0, data.sortOrder ?? 0, userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Dose template created' }, 201);
});

// ─── PUT /api/dose-templates/:id — update template ──────────────────────────
doseTemplateRoutes.put('/:id', zValidator('json', updateDoseTemplateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role = c.get('role');

  if (!role || !MANAGER_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update dose templates' });
  }

  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT id FROM prescription_dose_templates WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Template not found' });

  const data = c.req.valid('json');
  const colMap: Record<string, string> = {
    name: 'name', frequency: 'frequency', duration: 'duration',
    instructions: 'instructions', isDefault: 'is_default', sortOrder: 'sort_order',
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
      .prepare(`UPDATE prescription_dose_templates SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...vals).run();
  }

  return c.json({ message: 'Dose template updated' });
});

// ─── DELETE /api/dose-templates/:id — soft delete template ──────────────────
doseTemplateRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role = c.get('role');

  if (!role || !MANAGER_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to delete dose templates' });
  }

  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT id FROM prescription_dose_templates WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Template not found' });

  await db.$client
    .prepare("UPDATE prescription_dose_templates SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId).run();

  return c.json({ message: 'Dose template deleted' });
});

export default doseTemplateRoutes;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createRespiratorySchema, respiratoryQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const respiratoryRoutes = new Hono<NursingEnv>();

respiratoryRoutes.get('/', zValidator('query', respiratoryQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, admission_id, entry_type, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM nursing_respiratory WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (patient_id) {
    query += ' AND patient_id = ?';
    params.push(patient_id);
  }
  if (admission_id) {
    query += ' AND admission_id = ?';
    params.push(admission_id);
  }
  if (entry_type) {
    query += ' AND entry_type = ?';
    params.push(entry_type);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM nursing_respiratory WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) {
    countQuery += ' AND patient_id = ?';
    countParams.push(patient_id);
  }
  if (admission_id) {
    countQuery += ' AND admission_id = ?';
    countParams.push(admission_id);
  }
  if (entry_type) {
    countQuery += ' AND entry_type = ?';
    countParams.push(entry_type);
  }

  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

respiratoryRoutes.post('/', zValidator('json', createRespiratorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nursing_respiratory (
      tenant_id, patient_id, admission_id, entry_type,
      delivery_mode, flow_rate, start_time, spo2_before, spo2_after, status,
      medicine_name, dose, time_given, given_by, response, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    data.patient_id,
    data.admission_id ?? null,
    data.entry_type,
    data.delivery_mode ?? null,
    data.flow_rate ?? null,
    data.start_time ?? null,
    data.spo2_before ?? null,
    data.spo2_after ?? null,
    data.status ?? 'active',
    data.medicine_name ?? null,
    data.dose ?? null,
    data.time_given ?? null,
    data.given_by ?? null,
    data.response ?? null,
    data.notes ?? null,
    userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

respiratoryRoutes.post('/:id/stop', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT 1 FROM nursing_respiratory WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nursing_respiratory SET status = 'stopped', updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();

  return c.json({ Results: true });
});

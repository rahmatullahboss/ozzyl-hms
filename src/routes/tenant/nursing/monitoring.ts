import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createMonitoringSchema, updateMonitoringSchema, NursingQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';


type NursingEnv = { Bindings: Env; Variables: Variables };
const UPDATE_FIELD_MAP: Record<string, string> = {
  temperature: 'temperature',
  pulse: 'heart_rate',
  respiration: 'respiratory_rate',
  bp_systolic: 'systolic',
  bp_diastolic: 'diastolic',
  spo2: 'spo2',
  remarks: 'notes',
  recorded_on: 'recorded_at',
};

export const monitoringRoutes = new Hono<NursingEnv>();

monitoringRoutes.get('/', zValidator('query', NursingQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, visit_id } = c.req.valid('query');
  const offset = (page - 1) * limit;
  let query = `
    SELECT id, tenant_id, patient_id, admission_id AS visit_id, temperature, heart_rate AS pulse,
           respiratory_rate AS respiration, systolic AS bp_systolic, diastolic AS bp_diastolic,
           spo2, notes AS remarks, recorded_at AS recorded_on, recorded_at AS created_at
    FROM patient_vitals WHERE tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];
  if (patient_id) { query += ' AND patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND admission_id = ?'; params.push(visit_id); }
  query += ' ORDER BY recorded_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const { results } = await db.$client.prepare(query).bind(...params).all();
  let countQuery = 'SELECT COUNT(*) as total FROM patient_vitals WHERE tenant_id = ?';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND admission_id = ?'; countParams.push(visit_id); }
  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

monitoringRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const result = await db.$client.prepare(`
    SELECT id, tenant_id, patient_id, admission_id AS visit_id, temperature, heart_rate AS pulse,
           respiratory_rate AS respiration, systolic AS bp_systolic, diastolic AS bp_diastolic,
           spo2, notes AS remarks, recorded_at AS recorded_on, recorded_at AS created_at
    FROM patient_vitals WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();
  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

monitoringRoutes.post('/', zValidator('json', createMonitoringSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const result = await db.$client.prepare(`
    INSERT INTO patient_vitals
      (tenant_id, patient_id, admission_id, temperature, heart_rate, respiratory_rate,
       systolic, diastolic, spo2, notes, recorded_by, recorded_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', '+6 hours')), 'nursing_monitoring')
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.temperature ?? null, data.pulse ?? null, data.respiration ?? null,
    data.bp_systolic ?? null, data.bp_diastolic ?? null, data.spo2 ?? null,
    data.remarks ?? null, userId ?? 'system', data.recorded_on ?? null
  ).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

monitoringRoutes.put('/:id', zValidator('json', updateMonitoringSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const existing = await db.$client.prepare('SELECT 1 FROM patient_vitals WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  const data = c.req.valid('json');
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  Object.entries(data).forEach(([key, value]) => {
    const column = UPDATE_FIELD_MAP[key];
    if (column && value !== undefined) { fields.push(`${column} = ?`); values.push(value as string | number | null); }
  });
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')");
    values.push(id, tenantId);
    await db.$client.prepare(`UPDATE patient_vitals SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }
  return c.json({ Results: true });
});

monitoringRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const existing = await db.$client.prepare('SELECT 1 FROM patient_vitals WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  await db.$client.prepare('DELETE FROM patient_vitals WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ Results: true });
});

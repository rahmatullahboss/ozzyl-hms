import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { createIntakeOutputSchema, updateIntakeOutputSchema, NursingQuerySchema } from '../../../schemas/nursing';
import { getDb } from '../../../db';
import { hasPermission } from '../../../lib/ipd-ot-rbac';


type NursingEnv = { Bindings: Env; Variables: Variables };
const ALLOWED_UPDATE_FIELDS = ['intake_type', 'intake_amount', 'intake_unit', 'output_type', 'output_amount', 'output_unit', 'remarks', 'recorded_on'];

const balanceQuerySchema = z.object({
  shift: z.coerce.number().int().min(1).max(24).optional(),
  period: z.coerce.number().int().min(1).max(72).default(24),
});

export const ioChartsRoutes = new Hono<NursingEnv>();

// ─── Fluid balance endpoint ─────────────────────────────────────────────────
ioChartsRoutes.get('/balance/:patientId', zValidator('query', balanceQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const { shift, period } = c.req.valid('query');
  const hours = shift ?? period;

  const intakeResult = await db.$client.prepare(
    `SELECT COALESCE(SUM(intake_amount), 0) as total
     FROM nur_intake_output
     WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
       AND recorded_on >= datetime('now', ? || ' hours')`
  ).bind(tenantId, patientId, `-${hours}`).first<{ total: number }>();

  const outputResult = await db.$client.prepare(
    `SELECT COALESCE(SUM(output_amount), 0) as total
     FROM nur_intake_output
     WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
       AND recorded_on >= datetime('now', ? || ' hours')`
  ).bind(tenantId, patientId, `-${hours}`).first<{ total: number }>();

  const totalIntake = intakeResult?.total ?? 0;
  const totalOutput = outputResult?.total ?? 0;

  return c.json({
    total_intake: totalIntake,
    total_output: totalOutput,
    balance: totalIntake - totalOutput,
    period: `${hours}h`,
  });
});

ioChartsRoutes.get('/', zValidator('query', NursingQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, visit_id } = c.req.valid('query');
  const offset = (page - 1) * limit;
  let query = 'SELECT * FROM nur_intake_output WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (patient_id) { query += ' AND patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND visit_id = ?'; params.push(visit_id); }
  query += ' ORDER BY recorded_on DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const { results } = await db.$client.prepare(query).bind(...params).all();
  let countQuery = 'SELECT COUNT(*) as total FROM nur_intake_output WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND visit_id = ?'; countParams.push(visit_id); }
  const count = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();
  return c.json({ Results: results, pagination: { page, limit, total: count?.total || 0 } });
});

ioChartsRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const result = await db.$client.prepare('SELECT * FROM nur_intake_output WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(id, tenantId).first();
  if (!result) throw new HTTPException(404, { message: 'Not found' });
  return c.json({ Results: result });
});

ioChartsRoutes.post('/', zValidator('json', createIntakeOutputSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role') as string | undefined;
  const data = c.req.valid('json');
  // P0-27: gate nursing intake/output records on the local catalog. We
  // require both `nursing.intake.record` and `nursing.output.record` since
  // the schema allows either side to be filled.
  const wantsIntake = data.intake_type !== undefined || data.intake_amount !== undefined;
  const wantsOutput = data.output_type !== undefined || data.output_amount !== undefined;
  if (wantsIntake && !hasPermission(role, 'nursing.intake.record')) {
    throw new HTTPException(403, { message: 'Not authorized to record nursing intake' });
  }
  if (wantsOutput && !hasPermission(role, 'nursing.output.record')) {
    throw new HTTPException(403, { message: 'Not authorized to record nursing output' });
  }
  const result = await db.$client.prepare(`
    INSERT INTO nur_intake_output (tenant_id, patient_id, visit_id, intake_type, intake_amount, intake_unit, output_type, output_amount, output_unit, remarks, recorded_on, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.intake_type ?? null, data.intake_amount ?? null, data.intake_unit ?? 'ml',
    data.output_type ?? null, data.output_amount ?? null, data.output_unit ?? 'ml',
    data.remarks ?? null, data.recorded_on ?? null, userId
  ).run();
  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

ioChartsRoutes.put('/:id', zValidator('json', updateIntakeOutputSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const existing = await db.$client.prepare('SELECT 1 FROM nur_intake_output WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(id, tenantId).first();
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
    await db.$client.prepare(`UPDATE nur_intake_output SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }
  return c.json({ Results: true });
});

ioChartsRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });
  const existing = await db.$client.prepare('SELECT 1 FROM nur_intake_output WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });
  await db.$client.prepare("UPDATE nur_intake_output SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
  return c.json({ Results: true });
});

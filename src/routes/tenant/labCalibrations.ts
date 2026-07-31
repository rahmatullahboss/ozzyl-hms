import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId, parseId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const labCalibrations = new Hono<{ Bindings: Env; Variables: Variables }>();

labCalibrations.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director'));

// ═══════════════════════════════════════════════════════════════════════════════
// CALIBRATION TRACKING CRUD
// ═══════════════════════════════════════════════════════════════════════════════

const calibrationSchema = z.object({
  machine_id: z.number().int().positive(),
  calibration_type: z.enum(['full', 'partial', 'verification', 'preventive_maintenance']).default('full'),
  due_date: z.string().min(1),
  completed_date: z.string().optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'overdue', 'cancelled']).default('scheduled'),
  performed_by: z.number().int().positive().optional(),
  approved_by: z.number().int().positive().optional(),
  certificate_no: z.string().optional(),
  result_summary: z.string().optional(),
  next_due_date: z.string().optional(),
});

labCalibrations.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = c.req.query('machine_id');
  const status = c.req.query('status');

  let where = 'WHERE c.tenant_id = ? AND c.is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (machineId) { where += ' AND c.machine_id = ?'; params.push(Number(machineId)); }
  if (status) { where += ' AND c.status = ?'; params.push(status); }

  const rows = await db.$client.prepare(`
    SELECT c.*, m.machine_name, m.machine_code, m.department
    FROM lab_calibrations c
    JOIN lab_machines m ON c.machine_id = m.id
    ${where}
    ORDER BY c.due_date ASC
  `).bind(...params).all();

  return c.json({ data: rows.results });
});

labCalibrations.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const row = await db.$client.prepare(`
    SELECT c.*, m.machine_name, m.machine_code
    FROM lab_calibrations c
    JOIN lab_machines m ON c.machine_id = m.id
    WHERE c.id = ? AND c.tenant_id = ? AND c.is_active = 1
  `).bind(id, tenantId).first();

  if (!row) throw new HTTPException(404, { message: 'Calibration not found' });
  return c.json(row);
});

labCalibrations.post('/', zValidator('json', calibrationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_calibrations
      (machine_id, calibration_type, due_date, completed_date, status, performed_by, approved_by, certificate_no, result_summary, next_due_date, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.machine_id, data.calibration_type, data.due_date,
    data.completed_date ?? null, data.status,
    data.performed_by ?? null, data.approved_by ?? null,
    data.certificate_no ?? null, data.result_summary ?? null,
    data.next_due_date ?? null, tenantId, userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Calibration created' }, 201);
});

labCalibrations.put('/:id', zValidator('json', calibrationSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM lab_calibrations WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Calibration not found' });

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (data.machine_id !== undefined) { sets.push('machine_id = ?'); vals.push(data.machine_id); }
  if (data.calibration_type !== undefined) { sets.push('calibration_type = ?'); vals.push(data.calibration_type); }
  if (data.due_date !== undefined) { sets.push('due_date = ?'); vals.push(data.due_date); }
  if (data.completed_date !== undefined) { sets.push('completed_date = ?'); vals.push(data.completed_date); }
  if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
  if (data.performed_by !== undefined) { sets.push('performed_by = ?'); vals.push(data.performed_by); }
  if (data.approved_by !== undefined) { sets.push('approved_by = ?'); vals.push(data.approved_by); }
  if (data.certificate_no !== undefined) { sets.push('certificate_no = ?'); vals.push(data.certificate_no); }
  if (data.result_summary !== undefined) { sets.push('result_summary = ?'); vals.push(data.result_summary); }
  if (data.next_due_date !== undefined) { sets.push('next_due_date = ?'); vals.push(data.next_due_date); }
  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  vals.push(id, tenantId);
  await db.$client.prepare(`UPDATE lab_calibrations SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();
  return c.json({ message: 'Calibration updated' });
});

labCalibrations.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const result = await db.$client.prepare(
    'UPDATE lab_calibrations SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Calibration not found' });
  return c.json({ message: 'Calibration deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UPCOMING CALIBRATIONS (due in next N days)
// ═══════════════════════════════════════════════════════════════════════════════

labCalibrations.get('/upcoming', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const days = Math.min(Number(c.req.query('days') || '7'), 90);

  const rows = await db.$client.prepare(`
    SELECT c.*, m.machine_name, m.machine_code, m.department,
      julianday(c.due_date) - julianday('now') as days_remaining
    FROM lab_calibrations c
    JOIN lab_machines m ON c.machine_id = m.id
    WHERE c.tenant_id = ? AND c.is_active = 1
      AND c.status IN ('scheduled', 'in_progress')
      AND c.due_date <= date('now', '+${days} days')
      AND c.due_date >= date('now', '+6 hours')
    ORDER BY c.due_date ASC
  `).bind(tenantId).all();

  const results = rows.results ?? [];
  return c.json({ data: results, count: results.length, days });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OVERDUE CALIBRATIONS
// ═══════════════════════════════════════════════════════════════════════════════

labCalibrations.get('/overdue', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const rows = await db.$client.prepare(`
    SELECT c.*, m.machine_name, m.machine_code, m.department,
      julianday('now') - julianday(c.due_date) as days_overdue
    FROM lab_calibrations c
    JOIN lab_machines m ON c.machine_id = m.id
    WHERE c.tenant_id = ? AND c.is_active = 1
      AND c.status IN ('scheduled', 'in_progress', 'overdue')
      AND c.due_date < date('now', '+6 hours')
    ORDER BY c.due_date ASC
  `).bind(tenantId).all();

  const results = rows.results ?? [];
  return c.json({ data: results, count: results.length });
});

export default labCalibrations;

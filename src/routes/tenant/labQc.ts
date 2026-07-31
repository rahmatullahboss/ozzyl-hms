import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

const labQc = new Hono<{ Bindings: Env; Variables: Variables }>();

labQc.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director'));

// ═══════════════════════════════════════════════════════════════════════════════
// WESTGARD RULES ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function evaluateWestgard(results: Array<{ result_value: number }>, mean: number, sd: number): string[] {
  if (sd === 0) return [];
  const violations: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const z = (results[i].result_value - mean) / sd;
    const absZ = Math.abs(z);

    // 1-3s: One point > 3 SD
    if (absZ > 3) violations.push(`1-3s at run ${i + 1}: ${z.toFixed(2)} SD`);

    // 1-2s: One point > 2 SD (warning)
    if (absZ > 2 && absZ <= 3) violations.push(`1-2s at run ${i + 1}: ${z.toFixed(2)} SD`);

    // 2-2s: Two consecutive > 2 SD same side
    if (i > 0) {
      const prevZ = (results[i - 1].result_value - mean) / sd;
      if (Math.abs(z) > 2 && Math.abs(prevZ) > 2 && (z > 0) === (prevZ > 0)) {
        violations.push(`2-2s at runs ${i}-${i + 1}`);
      }
    }

    // R-4s: Range > 4 SD between consecutive
    if (i > 0) {
      const prevZ = (results[i - 1].result_value - mean) / sd;
      if (Math.abs(z - prevZ) > 4) violations.push(`R-4s at runs ${i}-${i + 1}`);
    }

    // 4-1s: 4 consecutive > 1 SD same side
    if (i >= 3) {
      const last4 = results.slice(i - 3, i + 1);
      const allSameSide = last4.every(r => (((r.result_value - mean) / sd) > 0) === (z > 0));
      const allBeyond1s = last4.every(r => Math.abs((r.result_value - mean) / sd) > 1);
      if (allSameSide && allBeyond1s && !violations.some(v => v.startsWith(`4-1s at runs ${i - 2}`))) {
        violations.push(`4-1s at runs ${i - 2}-${i + 1}`);
      }
    }

    // 10-x: 10 consecutive on one side
    if (i >= 9) {
      const last10 = results.slice(i - 9, i + 1);
      const allPositive = last10.every(r => (r.result_value - mean) / sd > 0);
      const allNegative = last10.every(r => (r.result_value - mean) / sd < 0);
      if ((allPositive || allNegative) && !violations.some(v => v.startsWith(`10-x at runs ${i - 8}`))) {
        violations.push(`10-x at runs ${i - 8}-${i + 1}`);
      }
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QC CONTROLS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

labQc.get('/controls', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const rows = await db.$client.prepare(`
    SELECT * FROM lab_qc_controls WHERE tenant_id = ? AND is_active = 1 ORDER BY control_name
  `).bind(tenantId).all();
  return c.json({ data: rows.results });
});

labQc.post('/controls', zValidator('json', z.object({
  control_name: z.string().min(1),
  control_code: z.string().min(1),
  control_lot: z.string().optional(),
  manufacturer: z.string().optional(),
  expiry_date: z.string().optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_qc_controls (control_name, control_code, control_lot, manufacturer, expiry_date, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(data.control_name, data.control_code, data.control_lot ?? null, data.manufacturer ?? null, data.expiry_date ?? null, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'QC control created' }, 201);
});

labQc.delete('/controls/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  await db.$client.prepare('UPDATE lab_qc_controls SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ message: 'Control deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QC RANGES CRUD
// ═══════════════════════════════════════════════════════════════════════════════

labQc.get('/ranges', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const controlId = c.req.query('control_id');
  let where = 'qr.tenant_id = ? AND qr.is_active = 1';
  const params: (string|number)[] = [tenantId];
  if (controlId) { where += ' AND qr.control_id = ?'; params.push(Number(controlId)); }

  const rows = await db.$client.prepare(`
    SELECT qr.*, qc.control_name, qc.control_code, ltc.name as test_name, ltc.code as test_code
    FROM lab_qc_ranges qr
    JOIN lab_qc_controls qc ON qr.control_id = qc.id
    JOIN lab_test_catalog ltc ON qr.lab_test_id = ltc.id
    WHERE ${where} ORDER BY qc.control_name, ltc.name
  `).bind(...params).all();
  return c.json({ data: rows.results });
});

labQc.post('/ranges', zValidator('json', z.object({
  control_id: z.number().int().positive(),
  lab_test_id: z.number().int().positive(),
  component_id: z.number().int().positive().optional(),
  mean_value: z.number(),
  sd_value: z.number().positive(),
  qc_level: z.number().int().min(1).max(3).default(1),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const rangeLow = data.mean_value - (3 * data.sd_value);
  const rangeHigh = data.mean_value + (3 * data.sd_value);

  const result = await db.$client.prepare(`
    INSERT INTO lab_qc_ranges (control_id, lab_test_id, component_id, mean_value, sd_value, range_low, range_high, qc_level, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(data.control_id, data.lab_test_id, data.component_id ?? null, data.mean_value, data.sd_value, rangeLow, rangeHigh, data.qc_level, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'QC range created' }, 201);
});

labQc.delete('/ranges/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  await db.$client.prepare('UPDATE lab_qc_ranges SET is_active = 0 WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ message: 'QC range deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QC RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

labQc.post('/results', zValidator('json', z.object({
  control_id: z.number().int().positive(),
  lab_test_id: z.number().int().positive(),
  qc_range_id: z.number().int().positive().optional(),
  result_value: z.number(),
  run_date: z.string().optional(),
  run_number: z.number().int().positive().optional(),
  machine_id: z.number().int().positive().optional(),
  action_taken: z.string().optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Get QC range for this control+test
  const qcRange = await db.$client.prepare(`
    SELECT * FROM lab_qc_ranges WHERE control_id = ? AND lab_test_id = ? AND is_active = 1 AND tenant_id = ?
    ORDER BY qc_level LIMIT 1
  `).bind(data.control_id, data.lab_test_id, tenantId).first<{ mean_value: number; sd_value: number; range_low: number; range_high: number }>();

  let isOutOfRange = 0;
  let westgardViolations: string[] = [];

  if (qcRange) {
    const rangeLow = qcRange.range_low ?? (qcRange.mean_value - 3 * qcRange.sd_value);
    const rangeHigh = qcRange.range_high ?? (qcRange.mean_value + 3 * qcRange.sd_value);
    isOutOfRange = (data.result_value < rangeLow || data.result_value > rangeHigh) ? 1 : 0;

    // Get recent 10 results for Westgard
    const recent = await db.$client.prepare(`
      SELECT result_value FROM lab_qc_results
      WHERE control_id = ? AND lab_test_id = ? AND tenant_id = ?
      ORDER BY created_at DESC LIMIT 9
    `).bind(data.control_id, data.lab_test_id, tenantId).all<{ result_value: number }>();

    const allResults = [...recent.results.reverse(), { result_value: data.result_value }];
    westgardViolations = evaluateWestgard(allResults, qcRange.mean_value, qcRange.sd_value);
  }

  const result = await db.$client.prepare(`
    INSERT INTO lab_qc_results (control_id, lab_test_id, qc_range_id, result_value, run_date, run_number, machine_id, technician_id, is_out_of_range, westgard_violations, action_taken, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(data.control_id, data.lab_test_id, data.qc_range_id ?? null, data.result_value, data.run_date ?? new Date().toISOString().split('T')[0], data.run_number ?? null, data.machine_id ?? null, userId, isOutOfRange, westgardViolations.length > 0 ? JSON.stringify(westgardViolations) : null, data.action_taken ?? null, tenantId).run();

  return c.json({
    id: result.meta.last_row_id,
    is_out_of_range: !!isOutOfRange,
    westgard_violations: westgardViolations,
    message: 'QC result recorded',
  }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEVEY-JENNINGS DATA
// ═══════════════════════════════════════════════════════════════════════════════

labQc.get('/levy-jennings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const controlId = c.req.query('control_id');
  const testId = c.req.query('test_id');
  const days = Number(c.req.query('days') || 30);

  if (!controlId || !testId) throw new HTTPException(400, { message: 'control_id and test_id required' });

  const qcRange = await db.$client.prepare(`
    SELECT * FROM lab_qc_ranges WHERE control_id = ? AND lab_test_id = ? AND is_active = 1 AND tenant_id = ?
  `).bind(Number(controlId), Number(testId), tenantId).first<{ mean_value: number; sd_value: number }>();
  if (!qcRange) throw new HTTPException(404, { message: 'QC range not found' });

  const results = await db.$client.prepare(`
    SELECT * FROM lab_qc_results
    WHERE control_id = ? AND lab_test_id = ? AND tenant_id = ? AND run_date >= date('now', ?)
    ORDER BY run_date, created_at
  `).bind(Number(controlId), Number(testId), tenantId, `-${days} days`).all();

  return c.json({
    mean: qcRange.mean_value,
    sd: qcRange.sd_value,
    plus1sd: qcRange.mean_value + qcRange.sd_value,
    plus2sd: qcRange.mean_value + 2 * qcRange.sd_value,
    plus3sd: qcRange.mean_value + 3 * qcRange.sd_value,
    minus1sd: qcRange.mean_value - qcRange.sd_value,
    minus2sd: qcRange.mean_value - 2 * qcRange.sd_value,
    minus3sd: qcRange.mean_value - 3 * qcRange.sd_value,
    results: results.results,
    days,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALIBRATIONS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

labQc.get('/calibrations', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const machineId = c.req.query('machine_id');

  let where = 'c.tenant_id = ?';
  const params: (string|number)[] = [tenantId];
  if (machineId) { where += ' AND c.machine_id = ?'; params.push(Number(machineId)); }

  const rows = await db.$client.prepare(`
    SELECT c.*, lm.machine_name, u.name as performed_by_name
    FROM lab_calibrations c
    JOIN lab_machines lm ON c.machine_id = lm.id
    LEFT JOIN users u ON c.performed_by = u.id
    WHERE ${where} ORDER BY c.scheduled_date DESC LIMIT 50
  `).bind(...params).all();
  return c.json({ data: rows.results });
});

labQc.post('/calibrations', zValidator('json', z.object({
  machine_id: z.number().int().positive(),
  calibration_type: z.enum(['routine','preventive','corrective','annual']).default('routine'),
  scheduled_date: z.string(),
  next_due_date: z.string().optional(),
  notes: z.string().optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO lab_calibrations (machine_id, calibration_type, scheduled_date, next_due_date, notes, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(data.machine_id, data.calibration_type, data.scheduled_date, data.next_due_date ?? null, data.notes ?? null, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Calibration scheduled' }, 201);
});

labQc.put('/calibrations/:id', zValidator('json', z.object({
  performed_date: z.string().optional(),
  result_status: z.enum(['pass','fail','cancelled']).optional(),
  calibration_values: z.string().optional(),
  certificate_no: z.string().optional(),
  notes: z.string().optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const sets: string[] = [];
  const vals: (string|number|null)[] = [];

  if (data.performed_date) { sets.push('performed_date = ?'); vals.push(data.performed_date); }
  if (data.result_status) { sets.push('result_status = ?'); vals.push(data.result_status); }
  if (data.calibration_values) { sets.push('calibration_values = ?'); vals.push(data.calibration_values); }
  if (data.certificate_no) { sets.push('certificate_no = ?'); vals.push(data.certificate_no); }
  if (data.notes) { sets.push('notes = ?'); vals.push(data.notes); }

  if (sets.length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  sets.push('performed_by = ?');
  vals.push(userId);

  vals.push(id, tenantId);
  await db.$client.prepare(`UPDATE lab_calibrations SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();

  return c.json({ message: 'Calibration updated' });
});

labQc.get('/calibrations/upcoming', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const rows = await db.$client.prepare(`
    SELECT c.*, lm.machine_name
    FROM lab_calibrations c
    JOIN lab_machines lm ON c.machine_id = lm.id
    WHERE c.tenant_id = ? AND c.result_status = 'pending' AND c.scheduled_date BETWEEN date('now', '+6 hours') AND date('now', '+30 days')
    ORDER BY c.scheduled_date
  `).bind(tenantId).all();

  return c.json({ data: rows.results });
});

labQc.get('/calibrations/overdue', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const rows = await db.$client.prepare(`
    SELECT c.*, lm.machine_name
    FROM lab_calibrations c
    JOIN lab_machines lm ON c.machine_id = lm.id
    WHERE c.tenant_id = ? AND c.result_status = 'pending' AND c.scheduled_date < date('now', '+6 hours')
    ORDER BY c.scheduled_date
  `).bind(tenantId).all();

  return c.json({ data: rows.results });
});

export default labQc;

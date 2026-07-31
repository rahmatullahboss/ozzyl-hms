import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type IOEnv = { Bindings: Env; Variables: Variables };

const createIOSchema = z.object({
  PatientId: z.number().int().positive(),
  PatientVisitId: z.number().int().positive().optional(),
  EncounterId: z.number().int().positive().optional(),
  ParameterName: z.string().min(1).max(200),
  ParameterCategory: z.string().max(100).optional(),
  IntakeOutputValue: z.number(),
  Unit: z.string().max(20).optional(),
  IntakeOutputType: z.enum(['intake', 'output']),
  Contents: z.string().max(500).optional(),
  Remarks: z.string().max(2000).optional(),
  RecordedAt: z.string().optional(),
});

const updateIOSchema = createIOSchema.partial();

const inputOutputRoutes = new Hono<IOEnv>();

// GET / — list I/O records
inputOutputRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, visitId, type, fromDate, toDate } = c.req.query();

  if (!patientId && !visitId) {
    throw new HTTPException(400, { message: 'patientId or visitId required' });
  }

  let query = `
    SELECT id AS InputOutputId, tenant_id, patient_id AS PatientId, visit_id AS PatientVisitId,
      NULL AS EncounterId,
      COALESCE(intake_type, output_type, 'I/O') AS ParameterName,
      CASE WHEN intake_amount IS NOT NULL THEN 'intake' ELSE 'output' END AS ParameterCategory,
      COALESCE(intake_amount, output_amount, 0) AS IntakeOutputValue,
      COALESCE(intake_unit, output_unit, 'ml') AS Unit,
      CASE WHEN intake_amount IS NOT NULL THEN 'intake' ELSE 'output' END AS IntakeOutputType,
      NULL AS Contents, remarks AS Remarks, recorded_on AS RecordedAt, created_by AS CreatedBy
    FROM nur_intake_output WHERE tenant_id = ? AND is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patientId) { query += ' AND patient_id = ?'; params.push(Number(patientId)); }
  if (visitId) { query += ' AND visit_id = ?'; params.push(Number(visitId)); }
  if (type === 'intake') { query += ' AND intake_amount IS NOT NULL'; }
  if (type === 'output') { query += ' AND output_amount IS NOT NULL'; }
  if (fromDate) { query += ' AND date(recorded_on) >= date(?)'; params.push(fromDate); }
  if (toDate) { query += ' AND date(recorded_on) <= date(?)'; params.push(toDate); }
  query += ' ORDER BY recorded_on DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Calculate totals
  let totalIntake = 0;
  let totalOutput = 0;
  for (const r of results || []) {
    const rec = r as Record<string, unknown>;
    if (rec.IntakeOutputType === 'intake') totalIntake += Number(rec.IntakeOutputValue) || 0;
    else totalOutput += Number(rec.IntakeOutputValue) || 0;
  }

  return c.json({
    Results: results,
    Summary: { totalIntake, totalOutput, balance: totalIntake - totalOutput },
  });
});

// GET /:id
inputOutputRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const record = await db.$client.prepare(
    `SELECT id AS InputOutputId, tenant_id, patient_id AS PatientId, visit_id AS PatientVisitId,
      COALESCE(intake_type, output_type, 'I/O') AS ParameterName,
      CASE WHEN intake_amount IS NOT NULL THEN 'intake' ELSE 'output' END AS ParameterCategory,
      COALESCE(intake_amount, output_amount, 0) AS IntakeOutputValue,
      COALESCE(intake_unit, output_unit, 'ml') AS Unit,
      CASE WHEN intake_amount IS NOT NULL THEN 'intake' ELSE 'output' END AS IntakeOutputType,
      remarks AS Remarks, recorded_on AS RecordedAt
     FROM nur_intake_output WHERE tenant_id = ? AND id = ? AND is_active = 1`
  ).bind(tenantId, id).first();
  if (!record) throw new HTTPException(404, { message: 'I/O record not found' });

  return c.json({ Results: record });
});

// POST / — create I/O record
inputOutputRoutes.post('/', zValidator('json', createIOSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const isIntake = data.IntakeOutputType === 'intake';
  const result = await db.$client.prepare(`
    INSERT INTO nur_intake_output (
      tenant_id, patient_id, visit_id, intake_type, intake_amount, intake_unit,
      output_type, output_amount, output_unit, remarks, recorded_on, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PatientId, data.PatientVisitId ?? data.EncounterId ?? 0,
    isIntake ? data.ParameterName : null,
    isIntake ? data.IntakeOutputValue : null,
    isIntake ? (data.Unit ?? 'ml') : null,
    isIntake ? null : data.ParameterName,
    isIntake ? null : data.IntakeOutputValue,
    isIntake ? null : (data.Unit ?? 'ml'),
    data.Remarks ?? data.Contents ?? null,
    data.RecordedAt ?? new Date().toISOString(), userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// PUT /:id — update record
inputOutputRoutes.put('/:id', zValidator('json', updateIOSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_intake_output WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'I/O record not found' });

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  const isIntake = data.IntakeOutputType !== 'output';
  if (data.ParameterName !== undefined || data.IntakeOutputType !== undefined) {
    updates.push(isIntake ? 'intake_type = ?' : 'output_type = ?');
    params.push(data.ParameterName ?? null);
  }
  if (data.IntakeOutputValue !== undefined || data.IntakeOutputType !== undefined) {
    updates.push(isIntake ? 'intake_amount = ?' : 'output_amount = ?');
    params.push(data.IntakeOutputValue ?? null);
  }
  if (data.Unit !== undefined || data.IntakeOutputType !== undefined) {
    updates.push(isIntake ? 'intake_unit = ?' : 'output_unit = ?');
    params.push(data.Unit ?? 'ml');
  }
  if (data.IntakeOutputType !== undefined) {
    updates.push(isIntake ? 'output_type = NULL' : 'intake_type = NULL');
    updates.push(isIntake ? 'output_amount = NULL' : 'intake_amount = NULL');
  }
  if (data.Remarks !== undefined || data.Contents !== undefined) { updates.push('remarks = ?'); params.push(data.Remarks ?? data.Contents ?? null); }
  if (data.RecordedAt !== undefined) { updates.push('recorded_on = ?'); params.push(data.RecordedAt); }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  updates.push("ModifiedOn = datetime('now', '+6 hours')", 'ModifiedBy = ?');
  params.push(userId, tenantId, id);

  await db.$client.prepare(
    `UPDATE nur_intake_output SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`
  ).bind(...params).run();

  return c.json({ Results: { success: true } });
});

// DELETE /:id — soft delete
inputOutputRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const existing = await db.$client.prepare(
    'SELECT id FROM nur_intake_output WHERE tenant_id = ? AND id = ? AND is_active = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'I/O record not found' });

  await db.$client.prepare(
    "UPDATE nur_intake_output SET is_active = 0, updated_at = datetime('now', '+6 hours'), updated_by = ? WHERE tenant_id = ? AND id = ?"
  ).bind(userId, tenantId, id).run();

  return c.json({ Results: { success: true } });
});

export default inputOutputRoutes;

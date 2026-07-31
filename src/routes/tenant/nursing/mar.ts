import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createMARSchema,
  updateMARSchema,
  NursingQuerySchema,
  administerMedicationSchema,
  marScheduleQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const marRoutes = new Hono<NursingEnv>();

// ─── GET /mar — list MAR entries with formulary + order JOINs ───────────────
marRoutes.get('/', zValidator('query', NursingQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, visit_id } = c.req.valid('query');
  const offset = (page - 1) * limit;

  // Use raw SQL for JOINs since the Drizzle schema for MAR is auto-generated
  let query = `
    SELECT
      m.*,
      f.name AS formulary_name,
      f.generic_name AS formulary_generic_name,
      f.strength AS formulary_strength,
      f.dosage_form AS formulary_dosage_form,
      o.frequency AS order_frequency,
      o.priority AS order_priority,
      o.status AS order_status
    FROM nur_medication_admin m
    LEFT JOIN formulary_items f ON f.id = m.formulary_item_id
    LEFT JOIN cln_medication_orders o ON o.id = m.order_id
    WHERE m.tenant_id = ? AND m.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND m.patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND m.visit_id = ?'; params.push(visit_id); }

  query += ' ORDER BY COALESCE(m.scheduled_time, m.administered_on) DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Count query
  let countQuery = 'SELECT COUNT(*) as total FROM nur_medication_admin WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND visit_id = ?'; countParams.push(visit_id); }
  const countResult = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: countResult?.total || 0 } });
});

// ─── GET /mar/patient/:patientId/schedule — 24hr MAR schedule ───────────────
marRoutes.get('/patient/:patientId/schedule', zValidator('query', marScheduleQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const { date } = c.req.valid('query');
  const targetDate = date || new Date().toISOString().split('T')[0];

  // Get all active orders for this patient
  const orders = await db.$client.prepare(`
    SELECT
      o.*,
      f.name AS formulary_name,
      f.generic_name,
      f.strength,
      f.dosage_form
    FROM cln_medication_orders o
    LEFT JOIN formulary_items f ON f.id = o.formulary_item_id
    WHERE o.tenant_id = ? AND o.patient_id = ? AND o.status = 'active' AND o.is_active = 1
    ORDER BY o.priority DESC, o.start_datetime ASC
  `).bind(tenantId, patientId).all();

  // Get all MAR entries for this patient on the target date
  const administrations = await db.$client.prepare(`
    SELECT m.*
    FROM nur_medication_admin m
    WHERE m.tenant_id = ? AND m.patient_id = ? AND m.is_active = 1
      AND (m.scheduled_time LIKE ? OR m.administered_on LIKE ?)
    ORDER BY m.scheduled_time ASC
  `).bind(tenantId, patientId, `${targetDate}%`, `${targetDate}%`).all();

  return c.json({
    Results: {
      date: targetDate,
      activeOrders: orders.results,
      administrations: administrations.results,
    },
  });
});

// ─── GET /mar/stats — MAR compliance stats ──────────────────────────────────
marRoutes.get('/stats', zValidator('query', marScheduleQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patient_id, date } = c.req.valid('query');
  const targetDate = date || new Date().toISOString().split('T')[0];

  const stats = await db.$client.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'given' THEN 1 ELSE 0 END) as given_count,
      SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_count,
      SUM(CASE WHEN status = 'withheld' THEN 1 ELSE 0 END) as withheld_count,
      SUM(CASE WHEN status = 'refused' THEN 1 ELSE 0 END) as refused_count,
      SUM(CASE WHEN status = 'not_given' THEN 1 ELSE 0 END) as not_given_count,
      SUM(CASE WHEN status = 'hold' THEN 1 ELSE 0 END) as hold_count,
      SUM(CASE WHEN status = 'not_available' THEN 1 ELSE 0 END) as not_available_count,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
      SUM(CASE WHEN scheduled_time IS NOT NULL AND actual_time IS NULL AND status IS NULL THEN 1 ELSE 0 END) as pending_count
    FROM nur_medication_admin
    WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      AND (scheduled_time LIKE ? OR administered_on LIKE ?)
  `).bind(tenantId, patient_id, `${targetDate}%`, `${targetDate}%`).first();

  return c.json({ Results: stats });
});

// ─── GET /mar/:id — single MAR entry ────────────────────────────────────────
marRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const result = await db.$client.prepare(`
    SELECT
      m.*,
      f.name AS formulary_name,
      f.generic_name AS formulary_generic_name,
      f.strength AS formulary_strength,
      o.status AS order_status,
      o.priority AS order_priority
    FROM nur_medication_admin m
    LEFT JOIN formulary_items f ON f.id = m.formulary_item_id
    LEFT JOIN cln_medication_orders o ON o.id = m.order_id
    WHERE m.id = ? AND m.tenant_id = ? AND m.is_active = 1
  `).bind(id, tenantId).first();

  if (!result) throw new HTTPException(404, { message: 'MAR entry not found' });
  return c.json({ Results: result });
});

// ─── POST /mar — create MAR entry (enhanced with order + formulary linkage) ─
marRoutes.post('/', zValidator('json', createMARSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO nur_medication_admin
      (tenant_id, patient_id, visit_id, medication_name, dose, route, frequency,
       administered_on, administered_by, remarks, status,
       order_id, formulary_item_id, generic_name, strength, scheduled_time, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.patient_id, data.visit_id, data.medication_name,
    data.dose ?? null, data.route ?? null, data.frequency ?? null,
    data.administered_on ?? null, data.administered_by ?? null,
    data.remarks ?? null, data.status ?? 'given',
    data.order_id ?? null, data.formulary_item_id ?? null,
    data.generic_name ?? null, data.strength ?? null,
    data.scheduled_time ?? null, userId
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── PUT /mar/:id/administer — record actual administration ─────────────────
marRoutes.put('/:id/administer', zValidator('json', administerMedicationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT * FROM nur_medication_admin WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'MAR entry not found' });

  const data = c.req.valid('json');
  const actualTime = data.actual_time || new Date().toISOString();

  await db.$client.prepare(`
    UPDATE nur_medication_admin
    SET status = ?, actual_time = ?, reason_not_given = ?,
        remarks = COALESCE(?, remarks), barcode_scanned = ?,
        administered_by = ?, administered_on = ?,
        updated_at = datetime('now', '+6 hours'), updated_by = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.status, actualTime, data.reason_not_given ?? null,
    data.remarks ?? null, data.barcode_scanned ?? 0,
    userId, actualTime, userId,
    id, tenantId
  ).run();

  return c.json({ Results: { id, status: data.status, actual_time: actualTime } });
});

// ─── PUT /mar/:id — update MAR entry ────────────────────────────────────────
marRoutes.put('/:id', zValidator('json', updateMARSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT 1 FROM nur_medication_admin WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  const data = c.req.valid('json');
  const allowedFields = [
    'dose', 'route', 'frequency', 'administered_on', 'remarks', 'status',
    'scheduled_time', 'generic_name', 'strength',
  ];
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (allowedFields.includes(key) && value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  });

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now', '+6 hours')", 'updated_by = ?');
    values.push(userId, id, tenantId);
    await db.$client.prepare(
      `UPDATE nur_medication_admin SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();
  }

  return c.json({ Results: true });
});

// ─── DELETE /mar/:id — soft delete ──────────────────────────────────────────
marRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(
    'SELECT 1 FROM nur_medication_admin WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Not found' });

  await db.$client.prepare(
    "UPDATE nur_medication_admin SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
  ).bind(id, tenantId).run();

  return c.json({ Results: true });
});

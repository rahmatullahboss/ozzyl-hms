import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId, requireSpecificRole } from '../../lib/context-helpers';
import { getDb } from '../../db';


const doctorSchedule = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const scheduleSchema = z.object({
  doctor_id:   z.number().int().positive(),
  day_of_week: z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']),
  start_time:  z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  end_time:    z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  session_type: z.enum(['morning', 'afternoon', 'evening', 'night']).default('morning'),
  chamber:     z.string().optional(),
  max_patients: z.number().int().positive().max(200).default(20),
  notes:       z.string().optional(),
});

const updateScheduleSchema = scheduleSchema.omit({ doctor_id: true }).partial();

// ─── GET /api/doctor-schedules?doctor_id=X — list schedules ─────────────────

doctorSchedule.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = c.req.query('doctor_id');

  let sql = `
    SELECT ds.*, d.name as doctor_name, d.specialty, d.bmdc_reg_no
    FROM doctor_schedules ds
    JOIN doctors d ON d.id = ds.doctor_id AND d.tenant_id = ds.tenant_id
    WHERE ds.tenant_id = ? AND ds.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (doctorId) {
    sql += ` AND ds.doctor_id = ?`;
    params.push(parseInt(doctorId));
  }

  sql += ` ORDER BY ds.doctor_id, CASE ds.day_of_week
    WHEN 'sun' THEN 0 WHEN 'mon' THEN 1 WHEN 'tue' THEN 2
    WHEN 'wed' THEN 3 WHEN 'thu' THEN 4 WHEN 'fri' THEN 5 WHEN 'sat' THEN 6
    END, ds.start_time`;

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ schedules: results });
});

// ─── GET /api/doctor-schedules/doctors — all doctors with schedule summary ────

doctorSchedule.get('/doctors', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(`
    SELECT d.id, d.name, d.specialty, d.bmdc_reg_no, d.qualifications, d.visiting_hours,
           COUNT(ds.id) as schedule_count
    FROM doctors d
    LEFT JOIN doctor_schedules ds ON ds.doctor_id = d.id
      AND ds.tenant_id = d.tenant_id AND ds.is_active = 1
    WHERE d.tenant_id = ?
    GROUP BY d.id
    ORDER BY d.name
  `).bind(tenantId).all();

  return c.json({ doctors: results });
});

// ─── POST /api/doctor-schedules — add schedule ───────────────────────────────

doctorSchedule.post('/', zValidator('json', scheduleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireSpecificRole(c, 'hospital_admin');
  const data = c.req.valid('json');

  // Validate doctor belongs to tenant
  const doc = await db.$client.prepare(
    `SELECT id FROM doctors WHERE id = ? AND tenant_id = ?`
  ).bind(data.doctor_id, tenantId).first();
  if (!doc) throw new HTTPException(404, { message: 'Doctor not found' });

  // Check for overlap on same day
  const overlap = await db.$client.prepare(`
    SELECT id FROM doctor_schedules
    WHERE tenant_id = ? AND doctor_id = ? AND day_of_week = ? AND is_active = 1
      AND NOT (end_time <= ? OR start_time >= ?)
  `).bind(tenantId, data.doctor_id, data.day_of_week, data.start_time, data.end_time).first();

  if (overlap) {
    throw new HTTPException(409, { message: 'Schedule overlaps with an existing slot' });
  }

  const result = await db.$client.prepare(`
    INSERT INTO doctor_schedules
      (tenant_id, doctor_id, day_of_week, start_time, end_time, session_type, chamber, max_patients, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.doctor_id, data.day_of_week, data.start_time, data.end_time,
    data.session_type, data.chamber ?? null, data.max_patients, data.notes ?? null
  ).run();

  return c.json({ id: result.meta.last_row_id }, 201);
});

// ─── PUT /api/doctor-schedules/:id — update ──────────────────────────────────

doctorSchedule.put('/:id', zValidator('json', updateScheduleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireSpecificRole(c, 'hospital_admin');
  const id = parseInt(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    `SELECT * FROM doctor_schedules WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Schedule not found' });

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  if (data.day_of_week !== undefined)  { sets.push('day_of_week = ?');  vals.push(data.day_of_week); }
  if (data.start_time !== undefined)   { sets.push('start_time = ?');   vals.push(data.start_time); }
  if (data.end_time !== undefined)     { sets.push('end_time = ?');     vals.push(data.end_time); }
  if (data.session_type !== undefined) { sets.push('session_type = ?'); vals.push(data.session_type); }
  if (data.chamber !== undefined)      { sets.push('chamber = ?');      vals.push(data.chamber); }
  if (data.max_patients !== undefined) { sets.push('max_patients = ?'); vals.push(data.max_patients); }
  if (data.notes !== undefined)        { sets.push('notes = ?');        vals.push(data.notes); }

  if (sets.length === 0) return c.json({ message: 'No changes' }, 400);

  await db.$client.prepare(
    `UPDATE doctor_schedules SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals, id, tenantId).run();

  return c.json({ success: true });
});

// ─── DELETE /api/doctor-schedules/:id — soft delete ─────────────────────────

doctorSchedule.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireSpecificRole(c, 'hospital_admin');
  const id = parseInt(c.req.param('id'));

  const existing = await db.$client.prepare(
    `SELECT id FROM doctor_schedules WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Schedule not found' });

  await db.$client.prepare(
    `UPDATE doctor_schedules SET is_active = 0 WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).run();

  return c.json({ success: true });
});

export default doctorSchedule;

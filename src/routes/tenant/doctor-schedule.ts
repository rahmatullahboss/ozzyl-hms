import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireSpecificRole, requireUserId } from '../../lib/context-helpers';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getDb } from '../../db';
import {
  DOCTOR_PRESENCE_STATUS_VALUES,
  ensureDoctorDailyStatusTable,
  isDoctorAvailableForStatus,
  type DoctorPresenceStatus,
} from '../../lib/doctor-daily-status';

const doctorSchedule = new Hono<{ Bindings: Env; Variables: Variables }>();

const HHMM = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Schemas
const shiftSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  shiftName: z.string().min(1),
  startTime: z.string().regex(HHMM, 'Must be HH:MM'),
  endTime: z.string().regex(HHMM, 'Must be HH:MM'),
}).refine((data) => data.startTime < data.endTime, {
  message: 'startTime must be before endTime',
  path: ['endTime'],
});

const updateShiftSchema = z.object({
  shiftName: z.string().min(1).optional(),
  startTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  endTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
}).refine((data) => {
  if (data.startTime && data.endTime) {
    return data.startTime < data.endTime;
  }
  return true;
}, {
  message: 'startTime must be before endTime',
  path: ['endTime'],
});

const availabilitySchema = z.object({
  date: z.string().regex(DATE, 'Must be YYYY-MM-DD'),
  isAvailable: z.boolean(),
  reason: z.string().optional(),
});

const presenceStatusSchema = z.object({
  date: z.string().regex(DATE, 'Must be YYYY-MM-DD').optional(),
  status: z.enum(DOCTOR_PRESENCE_STATUS_VALUES),
  expectedArrivalTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  startTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  endTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  delayMinutes: z.number().int().min(0).max(720).optional(),
  publicMessage: z.string().trim().max(250).optional(),
  receptionNote: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(500).optional(),
}).refine((data) => {
  if (data.startTime && data.endTime) return data.startTime < data.endTime;
  return true;
}, {
  message: 'startTime must be before endTime',
  path: ['endTime'],
});

const timelineEventSchema = z.object({
  date: z.string().regex(DATE, 'Must be YYYY-MM-DD'),
  type: z.enum(DOCTOR_PRESENCE_STATUS_VALUES),
  startTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  endTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  expectedArrivalTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  delayMinutes: z.number().int().min(0).max(720).optional(),
  publicMessage: z.string().trim().max(250).optional(),
  receptionNote: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(500).optional(),
});

const updateTimelineEventSchema = z.object({
  date: z.string().regex(DATE, 'Must be YYYY-MM-DD').optional(),
  type: z.enum(DOCTOR_PRESENCE_STATUS_VALUES).optional(),
  startTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  endTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  expectedArrivalTime: z.string().regex(HHMM, 'Must be HH:MM').optional(),
  delayMinutes: z.number().int().min(0).max(720).optional(),
  publicMessage: z.string().trim().max(250).optional(),
  receptionNote: z.string().trim().max(500).optional(),
  reason: z.string().trim().max(500).optional(),
});

type PresenceInput = z.infer<typeof presenceStatusSchema>;

type DoctorPresenceRow = {
  id: number | null;
  doctor_id: number;
  doctor_name: string;
  specialty: string | null;
  department: string | null;
  status_date: string | null;
  status_type: DoctorPresenceStatus | null;
  is_available: number | null;
  start_time: string | null;
  end_time: string | null;
  expected_arrival_time: string | null;
  delay_minutes: number | null;
  public_message: string | null;
  reception_note: string | null;
  reason: string | null;
  source: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
};

function todayGmt6(): string {
  return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function resolveDoctorForUser(db: ReturnType<typeof getDb>, tenantId: string, userId: string) {
  const direct = await db.$client.prepare(
    `SELECT id, name FROM doctors WHERE user_id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`
  ).bind(userId, tenantId).first<{ id: number; name: string }>();
  if (direct) return direct;

  return db.$client.prepare(`
    SELECT d.id, d.name
    FROM staff s
    JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
    WHERE s.user_id = ? AND s.tenant_id = ? AND d.is_active = 1
    LIMIT 1
  `).bind(userId, tenantId).first<{ id: number; name: string }>();
}

function serializePresence(row: DoctorPresenceRow) {
  const status = row.status_type ?? 'available';
  return {
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    specialty: row.specialty,
    department: row.department,
    date: row.status_date,
    status,
    isAvailable: row.is_available === null ? true : row.is_available === 1,
    startTime: row.start_time,
    endTime: row.end_time,
    expectedArrivalTime: row.expected_arrival_time,
    delayMinutes: Number(row.delay_minutes ?? 0),
    publicMessage: row.public_message,
    receptionNote: row.reception_note,
    reason: row.reason,
    source: row.source,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
  };
}

async function upsertDoctorPresence(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  doctorId: number,
  userId: string,
  input: PresenceInput,
  source: 'doctor' | 'reception' | 'admin',
) {
  const date = input.date ?? todayGmt6();
  const isAvailable = isDoctorAvailableForStatus(input.status);

  const doctor = await db.$client.prepare(
    'SELECT id, name FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(doctorId, tenantId).first<{ id: number; name: string }>();
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

  await db.$client.prepare(`
    INSERT INTO doctor_daily_status (
      doctor_id, tenant_id, status_date, status_type, is_available,
      start_time, end_time, expected_arrival_time, delay_minutes,
      public_message, reception_note, reason, source, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, doctor_id, status_date) DO UPDATE SET
      status_type = excluded.status_type,
      is_available = excluded.is_available,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      expected_arrival_time = excluded.expected_arrival_time,
      delay_minutes = excluded.delay_minutes,
      public_message = excluded.public_message,
      reception_note = excluded.reception_note,
      reason = excluded.reason,
      source = excluded.source,
      updated_by = excluded.updated_by,
      updated_at = datetime('now', '+6 hours')
  `).bind(
    doctorId,
    tenantId,
    date,
    input.status,
    isAvailable ? 1 : 0,
    input.startTime ?? null,
    input.endTime ?? null,
    input.expectedArrivalTime ?? null,
    input.delayMinutes ?? 0,
    input.publicMessage ?? null,
    input.receptionNote ?? null,
    input.reason ?? null,
    source,
    userId,
  ).run();

  return { doctor, date, isAvailable };
}

// GET /api/doctor-schedule/presence/today — reception board for all doctors
// Must be registered before /:id dynamic routes.
doctorSchedule.get('/presence/today', async (c) => {
  requireSpecificRole(c, 'hospital_admin', 'reception', 'receptionist', 'md', 'director', 'doctor', 'nurse');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || todayGmt6();
  await ensureDoctorDailyStatusTable(c.env.DB);

  const { results } = await db.$client.prepare(`
    SELECT d.id as doctor_id, d.name as doctor_name, d.specialty, d.department,
           s.id, s.status_date, s.status_type, s.is_available, s.start_time, s.end_time,
           s.expected_arrival_time, s.delay_minutes, s.public_message, s.reception_note,
           s.reason, s.source, s.updated_at, u.name as updated_by_name
    FROM doctors d
    LEFT JOIN doctor_daily_status s ON s.doctor_id = d.id AND s.tenant_id = d.tenant_id AND s.status_date = ?
    LEFT JOIN users u ON u.id = s.updated_by AND u.tenant_id = s.tenant_id
    WHERE d.tenant_id = ? AND d.is_active = 1
    ORDER BY d.display_order ASC, d.name ASC
  `).bind(date, tenantId).all<DoctorPresenceRow>();

  return c.json({ date, doctors: (results ?? []).map(serializePresence) });
});

// GET /api/doctor-schedule/me/presence — doctor's own current status
doctorSchedule.get('/me/presence', async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const date = c.req.query('date') || todayGmt6();
  await ensureDoctorDailyStatusTable(c.env.DB);

  const doctor = await resolveDoctorForUser(db, tenantId, userId);
  if (!doctor) throw new HTTPException(403, { message: 'Doctor profile required' });

  const row = await db.$client.prepare(`
    SELECT d.id as doctor_id, d.name as doctor_name, d.specialty, d.department,
           s.id, s.status_date, s.status_type, s.is_available, s.start_time, s.end_time,
           s.expected_arrival_time, s.delay_minutes, s.public_message, s.reception_note,
           s.reason, s.source, s.updated_at, u.name as updated_by_name
    FROM doctors d
    LEFT JOIN doctor_daily_status s ON s.doctor_id = d.id AND s.tenant_id = d.tenant_id AND s.status_date = ?
    LEFT JOIN users u ON u.id = s.updated_by AND u.tenant_id = s.tenant_id
    WHERE d.id = ? AND d.tenant_id = ?
    LIMIT 1
  `).bind(date, doctor.id, tenantId).first<DoctorPresenceRow>();

  return c.json({ presence: row ? serializePresence(row) : null });
});

// PUT /api/doctor-schedule/me/presence — doctor self-updates arrival/status
doctorSchedule.put('/me/presence', zValidator('json', presenceStatusSchema), async (c) => {
  requireSpecificRole(c, 'doctor');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const input = c.req.valid('json');
  await ensureDoctorDailyStatusTable(c.env.DB);

  const doctor = await resolveDoctorForUser(db, tenantId, userId);
  if (!doctor) throw new HTTPException(403, { message: 'Doctor profile required' });

  const saved = await upsertDoctorPresence(db, tenantId, Number(doctor.id), userId, input, 'doctor');
  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'doctor_daily_status', Number(doctor.id), null, {
    source: 'doctor_self_presence',
    doctorId: Number(doctor.id),
    ...input,
    isAvailable: saved.isAvailable,
  });

  return c.json({ success: true, doctorId: Number(doctor.id), date: saved.date, status: input.status, isAvailable: saved.isAvailable });
});

// PUT /api/doctor-schedule/:id/presence — reception/admin manual override
doctorSchedule.put('/:id/presence', zValidator('json', presenceStatusSchema), async (c) => {
  requireSpecificRole(c, 'hospital_admin', 'reception', 'receptionist', 'md', 'director');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const doctorId = Number(c.req.param('id'));
  if (!Number.isInteger(doctorId) || doctorId <= 0) throw new HTTPException(400, { message: 'Invalid doctor id' });
  const input = c.req.valid('json');
  await ensureDoctorDailyStatusTable(c.env.DB);

  const source = c.get('role') === 'hospital_admin' || c.get('role') === 'md' || c.get('role') === 'director'
    ? 'admin'
    : 'reception';
  const saved = await upsertDoctorPresence(db, tenantId, doctorId, userId, input, source);
  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'doctor_daily_status', doctorId, null, {
    source: 'reception_or_admin_presence_override',
    doctorId,
    ...input,
    isAvailable: saved.isAvailable,
  });

  return c.json({ success: true, doctorId, date: saved.date, status: input.status, isAvailable: saved.isAvailable });
});

// GET /api/doctors/:id/schedule — get all shifts
doctorSchedule.get('/:id/schedule', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = c.req.param('id');

  const { results } = await db.$client.prepare(
    `SELECT * FROM doctor_shifts WHERE doctor_id = ? AND tenant_id = ? ORDER BY day_of_week, start_time`
  ).bind(doctorId, tenantId).all();

  return c.json({ shifts: results });
});

// POST /api/doctors/:id/schedule — add shift
doctorSchedule.post('/:id/schedule', zValidator('json', shiftSchema), async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const doctorId = c.req.param('id');
  const { dayOfWeek, shiftName, startTime, endTime } = c.req.valid('json');

  // Verify doctor belongs to tenant
  const doctor = await db.$client.prepare(
    'SELECT id FROM doctors WHERE id = ? AND tenant_id = ?'
  ).bind(doctorId, tenantId).first();
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

  const result = await db.$client.prepare(`
    INSERT INTO doctor_shifts (doctor_id, day_of_week, shift_name, start_time, end_time, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(doctorId, dayOfWeek, shiftName, startTime, endTime, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'doctor_shifts', result.meta.last_row_id, null, { doctorId, dayOfWeek, shiftName, startTime, endTime });

  return c.json({ success: true }, 201);
});

// PUT /api/doctors/:id/schedule/:shiftId — update shift
doctorSchedule.put('/:id/schedule/:shiftId', zValidator('json', updateShiftSchema), async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { id, shiftId } = c.req.param();
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id, start_time, end_time FROM doctor_shifts WHERE id = ? AND doctor_id = ? AND tenant_id = ?'
  ).bind(shiftId, id, tenantId).first<{ id: number; start_time: string; end_time: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Shift not found' });

  if ((data.startTime && !data.endTime) || (!data.startTime && data.endTime)) {
    const effectiveStart = data.startTime ?? existing.start_time;
    const effectiveEnd = data.endTime ?? existing.end_time;
    if (effectiveStart >= effectiveEnd) {
      throw new HTTPException(400, { message: 'startTime must be before endTime' });
    }
  }

  const updates: string[] = [];
  const binds: (string | number)[] = [];
  if (data.shiftName) { updates.push('shift_name = ?'); binds.push(data.shiftName); }
  if (data.startTime) { updates.push('start_time = ?'); binds.push(data.startTime); }
  if (data.endTime) { updates.push('end_time = ?'); binds.push(data.endTime); }
  if (updates.length === 0) return c.json({ success: true });

  binds.push(shiftId, id, tenantId);
  await db.$client.prepare(
    `UPDATE doctor_shifts SET ${updates.join(', ')} WHERE id = ? AND doctor_id = ? AND tenant_id = ?`
  ).bind(...binds).run();

  return c.json({ success: true });
});

// DELETE /api/doctors/:id/schedule/:shiftId
doctorSchedule.delete('/:id/schedule/:shiftId', async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { id, shiftId } = c.req.param();

  const existing = await db.$client.prepare(
    'SELECT id FROM doctor_shifts WHERE id = ? AND doctor_id = ? AND tenant_id = ?'
  ).bind(shiftId, id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Shift not found' });

  await db.$client.prepare(
    'DELETE FROM doctor_shifts WHERE id = ? AND doctor_id = ? AND tenant_id = ?'
  ).bind(shiftId, id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'DELETE', 'doctor_shifts', Number(shiftId), existing, null);

  return c.json({ success: true });
});

// GET /api/doctors/:id/availability
doctorSchedule.get('/:id/availability', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = c.req.param('id');

  const { results } = await db.$client.prepare(
    `SELECT * FROM doctor_availability WHERE doctor_id = ? AND tenant_id = ? ORDER BY date`
  ).bind(doctorId, tenantId).all();

  return c.json({ availability: results });
});

// POST /api/doctors/:id/availability
doctorSchedule.post('/:id/availability', zValidator('json', availabilitySchema), async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const doctorId = c.req.param('id');
  const { date, isAvailable, reason } = c.req.valid('json');

  await db.$client.prepare(`
    INSERT INTO doctor_availability (doctor_id, date, is_available, reason, tenant_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(doctor_id, date, tenant_id) DO UPDATE SET
      is_available = ?, reason = ?
  `).bind(doctorId, date, isAvailable ? 1 : 0, reason ?? null, tenantId, isAvailable ? 1 : 0, reason ?? null).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'doctor_availability', 0, null, { doctorId, date, isAvailable, reason });

  return c.json({ success: true });
});

// DELETE /api/doctors/:id/availability/:availId
doctorSchedule.delete('/:id/availability/:availId', async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { id, availId } = c.req.param();

  const existing = await db.$client.prepare(
    'SELECT id FROM doctor_availability WHERE id = ? AND doctor_id = ? AND tenant_id = ?'
  ).bind(availId, id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Availability not found' });

  await db.$client.prepare(
    'DELETE FROM doctor_availability WHERE id = ? AND doctor_id = ? AND tenant_id = ?'
  ).bind(availId, id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'DELETE', 'doctor_availability', Number(availId), existing, null);

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// TIMELINE EVENTS API
// Uses doctor_daily_status table for enhanced timeline management
// ═══════════════════════════════════════════════════════════════════

// GET /api/doctor-schedule/:id/timeline - Get all timeline events
doctorSchedule.get('/:id/timeline', async (c) => {
  const tenantId = requireTenantId(c);
  const doctorId = c.req.param('id');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');

  await ensureDoctorDailyStatusTable(c.env.DB);

  let dateFilter = '';
  const binds: (string | number)[] = [doctorId, tenantId];

  if (startDate && endDate) {
    dateFilter = ' AND status_date >= ? AND status_date <= ?';
    binds.push(startDate, endDate);
  } else if (startDate) {
    dateFilter = ' AND status_date >= ?';
    binds.push(startDate);
  } else if (endDate) {
    dateFilter = ' AND status_date <= ?';
    binds.push(endDate);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT id, status_date as date, status_type as type, start_time, end_time,
           expected_arrival_time as expectedArrivalTime, delay_minutes as delayMinutes,
           public_message as publicMessage, reception_note as receptionNote,
           reason, is_available
    FROM doctor_daily_status
    WHERE doctor_id = ? AND tenant_id = ? ${dateFilter}
    ORDER BY status_date ASC
  `).bind(...binds).all();

  return c.json({ events: results });
});

// POST /api/doctor-schedule/:id/timeline - Add a new timeline event
doctorSchedule.post('/:id/timeline', zValidator('json', timelineEventSchema), async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const doctorId = c.req.param('id');
  const { date, type, startTime, endTime, expectedArrivalTime, delayMinutes, publicMessage, receptionNote, reason } = c.req.valid('json');

  await ensureDoctorDailyStatusTable(c.env.DB);

  const doctor = await db.$client.prepare(
    'SELECT id FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(doctorId, tenantId).first();
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

  const isAvailable = isDoctorAvailableForStatus(type) ? 1 : 0;

  await c.env.DB.prepare(`
    INSERT INTO doctor_daily_status (
      doctor_id, tenant_id, status_date, status_type, is_available,
      start_time, end_time, expected_arrival_time, delay_minutes,
      public_message, reception_note, reason, source, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?)
    ON CONFLICT(tenant_id, doctor_id, status_date) DO UPDATE SET
      status_type = excluded.status_type,
      is_available = excluded.is_available,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      expected_arrival_time = excluded.expected_arrival_time,
      delay_minutes = excluded.delay_minutes,
      public_message = excluded.public_message,
      reception_note = excluded.reception_note,
      reason = excluded.reason,
      source = excluded.source,
      updated_by = excluded.updated_by,
      updated_at = datetime('now', '+6 hours')
  `).bind(doctorId, tenantId, date, type, isAvailable, startTime ?? null, endTime ?? null, expectedArrivalTime ?? null, delayMinutes ?? 0, publicMessage ?? null, receptionNote ?? null, reason ?? null, userId).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'doctor_daily_status', 0, null, { doctorId, date, type, isAvailable, startTime, endTime, expectedArrivalTime, delayMinutes, publicMessage, receptionNote, reason });

  return c.json({ success: true, date, type, startTime, endTime, expectedArrivalTime, delayMinutes, publicMessage, receptionNote, reason });
});

// PUT /api/doctor-schedule/:id/timeline/:eventId - Update a timeline event
doctorSchedule.put('/:id/timeline/:eventId', zValidator('json', updateTimelineEventSchema), async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { id, eventId } = c.req.param();
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(`
    SELECT id, status_date FROM doctor_daily_status WHERE id = ? AND doctor_id = ? AND tenant_id = ?
  `).bind(eventId, id, tenantId).first<{ id: number; status_date: string }>();
  if (!existing) throw new HTTPException(404, { message: 'Event not found' });

  if (data.date !== undefined && data.date !== existing.status_date) {
    const conflict = await c.env.DB.prepare(`
      SELECT id FROM doctor_daily_status
      WHERE tenant_id = ? AND doctor_id = ? AND status_date = ? AND id != ?
    `).bind(tenantId, id, data.date, eventId).first();
    if (conflict) {
      throw new HTTPException(409, { message: 'Another doctor schedule event already exists on that date' });
    }
  }

  const updates: string[] = [];
  const binds: (string | number | null)[] = [];

  if (data.date !== undefined) {
    updates.push('status_date = ?');
    binds.push(data.date);
  }
  if (data.type !== undefined) {
    updates.push('status_type = ?', 'is_available = ?');
    binds.push(data.type, isDoctorAvailableForStatus(data.type) ? 1 : 0);
  }
  if (data.startTime !== undefined) { updates.push('start_time = ?'); binds.push(data.startTime); }
  if (data.endTime !== undefined) { updates.push('end_time = ?'); binds.push(data.endTime); }
  if (data.expectedArrivalTime !== undefined) { updates.push('expected_arrival_time = ?'); binds.push(data.expectedArrivalTime); }
  if (data.delayMinutes !== undefined) { updates.push('delay_minutes = ?'); binds.push(data.delayMinutes); }
  if (data.publicMessage !== undefined) { updates.push('public_message = ?'); binds.push(data.publicMessage); }
  if (data.receptionNote !== undefined) { updates.push('reception_note = ?'); binds.push(data.receptionNote); }
  if (data.reason !== undefined) { updates.push('reason = ?'); binds.push(data.reason); }

  if (updates.length > 0) {
    updates.push('updated_at = datetime(\'now\', \'+6 hours\')', 'updated_by = ?');
    binds.push(userId);
    binds.push(eventId, id, tenantId);

    await c.env.DB.prepare(`
      UPDATE doctor_daily_status SET ${updates.join(', ')}
      WHERE id = ? AND doctor_id = ? AND tenant_id = ?
    `).bind(...binds).run();
  }

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'doctor_daily_status', Number(eventId), existing, data);

  return c.json({ success: true });
});

// DELETE /api/doctor-schedule/:id/timeline/:eventId - Delete a timeline event
doctorSchedule.delete('/:id/timeline/:eventId', async (c) => {
  requireSpecificRole(c, 'hospital_admin');
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { id, eventId } = c.req.param();

  const existing = await c.env.DB.prepare(`
    SELECT id FROM doctor_daily_status WHERE id = ? AND doctor_id = ? AND tenant_id = ?
  `).bind(eventId, id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Event not found' });

  await c.env.DB.prepare(`
    DELETE FROM doctor_daily_status WHERE id = ? AND doctor_id = ? AND tenant_id = ?
  `).bind(eventId, id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'DELETE', 'doctor_daily_status', Number(eventId), existing, null);

  return c.json({ success: true });
});

export default doctorSchedule;

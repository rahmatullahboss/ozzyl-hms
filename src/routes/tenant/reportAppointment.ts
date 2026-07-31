import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireTenantId } from '../../lib/context-helpers';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';


const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format, use YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format, use YYYY-MM-DD').optional(),
});

const trendSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

const reportAppointment = new Hono<{ Bindings: Env; Variables: Variables }>();

function isLegacyAppointmentSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('appointment_date') ||
    message.includes('appointment_time') ||
    message.includes('appointments schema') ||
    message.includes('appt_date') ||
    message.includes('legacy production schema')
  );
}

async function withAppointmentColumns<T>(
  run: (columns: { date: string; time: string }) => Promise<T>,
): Promise<T> {
  try {
    return await run({ date: 'appointment_date', time: 'appointment_time' });
  } catch (error) {
    if (!isLegacyAppointmentSchemaError(error)) throw error;
    return run({ date: 'appt_date', time: 'appt_time' });
  }
}

// ─── No-Show Rate ────────────────────────────────────────────────────────────

reportAppointment.get('/no-show-rate', zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');

  const result = await withAppointmentColumns(async ({ date }) => {
    let sql = `
      SELECT
        COUNT(*) as total_appointments,
        SUM(CASE WHEN status = 'no_show' OR status = 'missed' THEN 1 ELSE 0 END) as no_shows,
        SUM(CASE WHEN status = 'completed' OR status = 'checked_in' THEN 1 ELSE 0 END) as attended,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM appointments
      WHERE tenant_id = ?
    `;
    const params: (string | number)[] = [tenantId];
    if (startDate) { sql += ` AND ${date} >= ?`; params.push(startDate); }
    if (endDate) { sql += ` AND ${date} <= ?`; params.push(endDate); }
    return db.$client.prepare(sql).bind(...params).first<any>();
  });

  const total = result?.total_appointments || 0;
  const noShows = result?.no_shows || 0;
  const rate = total > 0 ? parseFloat(((noShows / total) * 100).toFixed(1)) : 0;

  return c.json({
    totalAppointments: total,
    noShows,
    attended: result?.attended || 0,
    cancelled: result?.cancelled || 0,
    noShowRate: rate,
    data: [{ doctor_name: 'All Doctors', total_appointments: total, no_show_count: noShows }],
  });
});

// ─── Slot Utilization by Doctor ──────────────────────────────────────────────

reportAppointment.get('/slot-utilization', zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');

  const { results } = await withAppointmentColumns(async ({ date }) => {
    let sql = `
      SELECT
        d.id as doctor_id,
        d.name as doctor_name,
        d.specialty,
        COUNT(a.id) as total_appointments,
        SUM(CASE WHEN a.status IN ('completed', 'checked_in') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN a.status = 'no_show' OR a.status = 'missed' THEN 1 ELSE 0 END) as no_shows
      FROM doctors d
      LEFT JOIN appointments a ON a.doctor_id = d.id AND a.tenant_id = d.tenant_id
    `;

    const conditions = ['d.tenant_id = ?'];
    const params: (string | number)[] = [tenantId];

    if (startDate) { conditions.push(`a.${date} >= ?`); params.push(startDate); }
    if (endDate) { conditions.push(`a.${date} <= ?`); params.push(endDate); }

    sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' GROUP BY d.id ORDER BY total_appointments DESC';
    return db.$client.prepare(sql).bind(...params).all();
  });

  return c.json({
    doctors: results.map((r: any) => ({
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      specialty: r.specialty,
      totalAppointments: r.total_appointments,
      completed: r.completed || 0,
      noShows: r.no_shows || 0,
      utilizationRate: r.total_appointments > 0
        ? parseFloat((((r.completed || 0) / r.total_appointments) * 100).toFixed(1))
        : 0,
    })),
    data: results.map((r: any) => ({
      doctor_id: r.doctor_id,
      doctor_name: r.doctor_name,
      total_slots: r.total_appointments,
      booked_slots: r.completed || 0,
    })),
  });
});

// ─── Peak Hours Analysis ─────────────────────────────────────────────────────

reportAppointment.get('/peak-hours', zValidator('query', dateRangeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.valid('query');

  const { results } = await withAppointmentColumns(async ({ date, time }) => {
    let sql = `
      SELECT
        CAST(substr(${time}, 1, 2) AS INTEGER) as hour_of_day,
        COUNT(*) as appointment_count
      FROM appointments
      WHERE tenant_id = ?
    `;
    const params: (string | number)[] = [tenantId];
    if (startDate) { sql += ` AND ${date} >= ?`; params.push(startDate); }
    if (endDate) { sql += ` AND ${date} <= ?`; params.push(endDate); }
    sql += ` AND ${time} IS NOT NULL GROUP BY hour_of_day ORDER BY appointment_count DESC`;
    return db.$client.prepare(sql).bind(...params).all();
  });

  return c.json({
    slots: results.map((r: any) => ({
      timeSlot: `${String(r.hour_of_day).padStart(2, '0')}:00`,
      count: r.appointment_count,
    })),
    peakSlot: results.length > 0 ? `${String((results[0] as any).hour_of_day).padStart(2, '0')}:00` : null,
    data: results,
  });
});

// ─── Daily Appointment Volume ────────────────────────────────────────────────

reportAppointment.get('/daily-volume', zValidator('query', trendSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { days } = c.req.valid('query');

  const { results } = await withAppointmentColumns(async ({ date }) => {
    return db.$client.prepare(`
      SELECT
        ${date} as appointment_date,
        COUNT(*) as appointment_count,
        SUM(CASE WHEN status IN ('completed', 'checked_in') THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
        SUM(CASE WHEN status IN ('no_show', 'missed') THEN 1 ELSE 0 END) as no_show_count
      FROM appointments
      WHERE tenant_id = ? AND ${date} >= date('now', '-' || ? || ' days')
      GROUP BY ${date} ORDER BY ${date} ASC
    `).bind(tenantId, days).all();
  });

  return c.json({ daily: results, data: results });
});

export default reportAppointment;

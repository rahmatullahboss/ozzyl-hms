import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';

type ReminderEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ─────────────────────────────────────────────────────────────────

const reminderSettingsSchema = z.object({
  smsEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  defaultDaysBefore: z.number().min(1).max(30).default(1),
  clinicName: z.string().optional(),
  smsTemplate: z.string().optional(),
  emailTemplate: z.string().optional(),
});

const sendReminderSchema = z.object({
  appointmentId: z.number(),
  method: z.enum(['sms', 'email', 'both']).default('sms'),
  message: z.string().optional(),
});

const scheduleReminderSchema = z.object({
  appointmentId: z.number(),
  daysBefore: z.number().min(1).max(30),
  method: z.enum(['sms', 'email', 'both']).default('sms'),
  message: z.string().optional(),
});

// ─── Router ──────────────────────────────────────────────────────────────────

const reminderRoutes = new Hono<ReminderEnv>();

// GET /settings — get reminder settings
reminderRoutes.get('/settings', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const row = await db.$client
    .prepare('SELECT * FROM ReminderSettings WHERE tenant_id = ? LIMIT 1')
    .bind(tenantId)
    .first();

  if (!row) {
    return c.json({
      Results: {
        smsEnabled: false,
        emailEnabled: false,
        defaultDaysBefore: 1,
        clinicName: '',
        smsTemplate: 'Reminder: You have an appointment at {clinic} on {date} at {time}. Please arrive 15 minutes early.',
        emailTemplate: 'Dear {patientName},\n\nThis is a reminder for your appointment at {clinic} on {date} at {time}.\n\nPlease arrive 15 minutes early and bring your ID.\n\nThank you.',
      },
    });
  }

  return c.json({ Results: row });
});

// PUT /settings — update reminder settings
reminderRoutes.put('/settings', zValidator('json', reminderSettingsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const existing = await db.$client
    .prepare('SELECT id FROM ReminderSettings WHERE tenant_id = ? LIMIT 1')
    .bind(tenantId)
    .first();

  if (existing) {
    await db.$client
      .prepare(`
        UPDATE ReminderSettings SET
          smsEnabled = ?, emailEnabled = ?, defaultDaysBefore = ?,
          clinicName = ?, smsTemplate = ?, emailTemplate = ?,
          UpdatedAt = CURRENT_TIMESTAMP
        WHERE tenant_id = ?
      `)
      .bind(
        data.smsEnabled ? 1 : 0, data.emailEnabled ? 1 : 0,
        data.defaultDaysBefore, data.clinicName ?? '',
        data.smsTemplate ?? '', data.emailTemplate ?? '',
        tenantId,
      )
      .run();
  } else {
    await db.$client
      .prepare(`
        INSERT INTO ReminderSettings (
          tenant_id, smsEnabled, emailEnabled, defaultDaysBefore,
          clinicName, smsTemplate, emailTemplate
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        tenantId, data.smsEnabled ? 1 : 0, data.emailEnabled ? 1 : 0,
        data.defaultDaysBefore, data.clinicName ?? '',
        data.smsTemplate ?? '', data.emailTemplate ?? '',
      )
      .run();
  }

  return c.json({ Results: { success: true } });
});

// GET /appointment/:id — get reminders for an appointment
reminderRoutes.get('/appointment/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const appointmentId = c.req.param('id');

  const { results } = await db.$client
    .prepare('SELECT * FROM AppointmentReminders WHERE tenant_id = ? AND AppointmentId = ? ORDER BY SentAt DESC')
    .bind(tenantId, Number(appointmentId))
    .all();

  return c.json({ Results: results });
});

// POST /send — send immediate reminder
reminderRoutes.post('/send', zValidator('json', sendReminderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { appointmentId, method, message } = c.req.valid('json');

  const appointment = await db.$client
    .prepare(`
      SELECT a.*, p.name as patient_name, p.mobile as patient_phone, p.email as patient_email,
             d.name as doctor_name
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
      LEFT JOIN doctors d ON a.doctor_id = d.id
      WHERE a.id = ? AND a.tenant_id = ?
    `)
    .bind(appointmentId, tenantId)
    .first<Record<string, unknown>>();

  if (!appointment) {
    throw new HTTPException(404, { message: 'Appointment not found' });
  }

  const settings = await db.$client
    .prepare('SELECT * FROM ReminderSettings WHERE tenant_id = ? LIMIT 1')
    .bind(tenantId)
    .first<Record<string, unknown>>();

  const clinicName = (settings?.clinicName as string) || 'Our Clinic';
  const apptDate = appointment.appt_date as string;
  const apptTime = appointment.appt_time as string;
  const patientName = appointment.patient_name as string;

  const smsMsg = message ||
    `Reminder: You have an appointment at ${clinicName} on ${apptDate} at ${apptTime}. Please arrive 15 minutes early.`;

  const emailTpl = (settings?.emailTemplate as string) ||
    'Dear {patientName},\n\nThis is a reminder for your appointment at {clinic} on {date} at {time}.\n\nThank you.';
  const emailBody = emailTpl
    .replace('{patientName}', patientName || '')
    .replace('{clinic}', clinicName)
    .replace('{date}', apptDate || '')
    .replace('{time}', apptTime || '');

  const sent: string[] = [];

  if ((method === 'sms' || method === 'both') && appointment.patient_phone) {
    await db.$client
      .prepare(`
        INSERT INTO AppointmentReminders (tenant_id, AppointmentId, PatientId, Method, Status, Message, SentAt)
        VALUES (?, ?, ?, 'sms', 'sent', ?, datetime('now', '+6 hours'))
      `)
      .bind(tenantId, appointmentId, appointment.patient_id, smsMsg)
      .run();
    sent.push('sms');
  }

  if ((method === 'email' || method === 'both') && appointment.patient_email) {
    await db.$client
      .prepare(`
        INSERT INTO AppointmentReminders (tenant_id, AppointmentId, PatientId, Method, Status, Message, SentAt)
        VALUES (?, ?, ?, 'email', 'sent', ?, datetime('now', '+6 hours'))
      `)
      .bind(tenantId, appointmentId, appointment.patient_id, emailBody)
      .run();
    sent.push('email');
  }

  return c.json({ Results: { success: sent.length > 0, sent } });
});

// POST /schedule — schedule a future reminder
reminderRoutes.post('/schedule', zValidator('json', scheduleReminderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { appointmentId, daysBefore, method, message } = c.req.valid('json');

  const appointment = await db.$client
    .prepare('SELECT * FROM appointments WHERE id = ? AND tenant_id = ?')
    .bind(appointmentId, tenantId)
    .first<Record<string, unknown>>();

  if (!appointment) {
    throw new HTTPException(404, { message: 'Appointment not found' });
  }

  const apptDate = new Date(appointment.appt_date as string);
  const scheduledDate = new Date(apptDate);
  scheduledDate.setDate(scheduledDate.getDate() - daysBefore);

  await db.$client
    .prepare(`
      INSERT INTO ScheduledReminders (
        tenant_id, AppointmentId, PatientId, Method, ScheduledFor, DaysBefore, Message
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      tenantId, appointmentId, appointment.patient_id,
      method, scheduledDate.toISOString(), daysBefore, message ?? null,
    )
    .run();

  return c.json({ Results: { success: true, scheduledFor: scheduledDate.toISOString().split('T')[0] } }, 201);
});

// GET /pending — list pending reminders (for cron)
reminderRoutes.get('/pending', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client
    .prepare(`
      SELECT sr.*, a.appt_date, a.appt_time,
             p.name as patient_name, p.mobile as patient_phone, p.email as patient_email
      FROM ScheduledReminders sr
      JOIN appointments a ON sr.AppointmentId = a.id AND a.tenant_id = sr.tenant_id
      JOIN patients p ON sr.PatientId = p.id AND p.tenant_id = sr.tenant_id
      WHERE sr.tenant_id = ? AND sr.Status = 'pending' AND sr.ScheduledFor <= datetime('now', '+6 hours')
      ORDER BY sr.ScheduledFor ASC
    `)
    .bind(tenantId)
    .all();

  return c.json({ Results: results });
});

// POST /process — process pending reminders (call from cron)
reminderRoutes.post('/process', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const pending = await db.$client
    .prepare(`
      SELECT sr.*, a.appt_date, a.appt_time,
             p.name as patient_name, p.mobile as patient_phone, p.email as patient_email
      FROM ScheduledReminders sr
      JOIN appointments a ON sr.AppointmentId = a.id AND a.tenant_id = sr.tenant_id
      JOIN patients p ON sr.PatientId = p.id AND p.tenant_id = sr.tenant_id
      WHERE sr.tenant_id = ? AND sr.Status = 'pending' AND sr.ScheduledFor <= datetime('now', '+6 hours')
      ORDER BY sr.ScheduledFor ASC
    `)
    .bind(tenantId)
    .all<Record<string, unknown>>();

  let processed = 0;
  let failed = 0;

  for (const r of pending.results || []) {
    try {
      await db.$client
        .prepare("UPDATE ScheduledReminders SET Status = 'sent', SentAt = datetime('now', '+6 hours') WHERE ReminderId = ? AND tenant_id = ?")
        .bind(r.ReminderId, tenantId)
        .run();

      await db.$client
        .prepare(`
          INSERT INTO AppointmentReminders (tenant_id, AppointmentId, PatientId, Method, Status, Message, SentAt)
          VALUES (?, ?, ?, ?, 'sent', ?, datetime('now', '+6 hours'))
        `)
        .bind(tenantId, r.AppointmentId, r.PatientId, r.Method, r.Message)
        .run();

      processed++;
    } catch {
      await db.$client
        .prepare("UPDATE ScheduledReminders SET Status = 'failed' WHERE ReminderId = ? AND tenant_id = ?")
        .bind(r.ReminderId, tenantId)
        .run();
      failed++;
    }
  }

  return c.json({ Results: { processed, failed } });
});

// DELETE /:id — cancel a scheduled reminder
reminderRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  await db.$client
    .prepare("UPDATE ScheduledReminders SET Status = 'cancelled' WHERE ReminderId = ? AND tenant_id = ?")
    .bind(Number(id), tenantId)
    .run();

  return c.json({ Results: { success: true } });
});

export default reminderRoutes;

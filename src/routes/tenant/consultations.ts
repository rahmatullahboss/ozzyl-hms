import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createConsultationSchema, endConsultationSchema, updateConsultationSchema } from '../../schemas/consultation';
import { createVideoProvider } from '../../lib/video';
import { createSmsProvider, SmsTemplates } from '../../lib/sms';
import { sendEmail, EmailTemplates } from '../../lib/email';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';


const consultationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// Roles authorized for consultation management
const CONSULTATION_STAFF_ROLES = ['hospital_admin', 'reception', 'doctor', 'nurse'];
const DOCTOR_ROLES = ['doctor', 'hospital_admin'];

// ─── GET /api/consultations — list consultations with filters ─────────────────
consultationRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { doctorId, patientId, status, from, to } = c.req.query();

  let query = `
    SELECT con.id, con.doctor_id, con.patient_id, con.scheduled_at, con.duration_min,
           con.status, con.chief_complaint, con.notes, con.created_at, con.updated_at,
           d.name as doctor_name, d.specialty as doctor_specialty,
           p.name as patient_name, p.patient_code, p.mobile as patient_mobile
    FROM consultations con
    JOIN doctors  d ON con.doctor_id  = d.id
    JOIN patients p ON con.patient_id = p.id
    WHERE con.tenant_id = ?`;
  // Note: room_url intentionally excluded from list — available in detail endpoint only
  const params: (string | number)[] = [tenantId!];

  if (doctorId) { query += ' AND con.doctor_id = ?';  params.push(doctorId); }
  if (patientId){ query += ' AND con.patient_id = ?'; params.push(patientId); }
  if (status)   { query += ' AND con.status = ?';     params.push(status); }
  if (from)     { query += ' AND date(con.scheduled_at) >= ?'; params.push(from); }
  if (to)       { query += ' AND date(con.scheduled_at) <= ?'; params.push(to); }

  query += ' ORDER BY con.scheduled_at ASC LIMIT 100';

  try {
    const consultations = await db.$client.prepare(query).bind(...params).all();
    return c.json({ consultations: consultations.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch consultations' });
  }
});

// ─── GET /api/consultations/:id — single consultation detail ─────────────────
consultationRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const consultation = await db.$client.prepare(`
      SELECT con.*,
             d.name as doctor_name, d.specialty, d.email as doctor_email,
             p.name as patient_name, p.patient_code, p.mobile as patient_mobile, p.email as patient_email
      FROM consultations con
      JOIN doctors  d ON con.doctor_id  = d.id
      JOIN patients p ON con.patient_id = p.id
      WHERE con.id = ? AND con.tenant_id = ?
    `).bind(id, tenantId).first();
    if (!consultation) throw new HTTPException(404, { message: 'Consultation not found' });
    return c.json({ consultation });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch consultation' });
  }
});

// ─── POST /api/consultations — book new teleconsultation ─────────────────────
consultationRoutes.post('/', zValidator('json', createConsultationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = requireUserId(c);
  const role     = c.get('role');
  if (!role || !CONSULTATION_STAFF_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Only authorized staff can book consultations' });
  }
  const data     = c.req.valid('json');

  // Validate doctor and patient exist under this tenant
  const [doctor, patient, tenant] = await db.$client.batch([
    db.$client.prepare('SELECT id, name, email FROM doctors WHERE id = ? AND tenant_id = ?').bind(data.doctorId, tenantId),
    db.$client.prepare('SELECT id, name, mobile, email FROM patients WHERE id = ? AND tenant_id = ?').bind(data.patientId, tenantId),
    db.$client.prepare('SELECT name FROM tenants WHERE id = ?').bind(tenantId),
  ]);

  const doc = doctor.results[0] as { id: number; name: string; email?: string } | undefined;
  const pat = patient.results[0] as { id: number; name: string; mobile?: string; email?: string } | undefined;
  const hospitalName = (tenant.results[0] as { name?: string } | undefined)?.name ?? 'HMS';

  if (!doc) throw new HTTPException(404, { message: 'Doctor not found' });
  if (!pat) throw new HTTPException(404, { message: 'Patient not found' });

  // Create video room
  const video = createVideoProvider(c.env);
  let roomUrl  = '';
  let roomName = '';
  try {
    const room = await video.createRoom({
      name: `${data.patientId}-${data.doctorId}`,
      durationMin: data.durationMin,
    });
    roomUrl  = room.roomUrl;
    roomName = room.roomName;
  } catch (err) {
    console.error('[CONSULTATION] Video room creation failed:', err);
    // Non-fatal: create consultation without room URL, staff can add manually
  }

  // Insert consultation record
  const result = await db.$client.prepare(`
    INSERT INTO consultations
      (doctor_id, patient_id, scheduled_at, duration_min, room_url, room_name,
       notes, chief_complaint, tenant_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.doctorId, data.patientId, data.scheduledAt, data.durationMin,
    roomUrl, roomName, data.notes ?? null, data.chiefComplaint ?? null,
    tenantId, userId,
  ).run();

  const consultationId = result.meta.last_row_id;

  // Send notifications (fire-and-forget)
  void Promise.allSettled([
    // SMS to patient
    pat.mobile ? (() => {
      const sms = createSmsProvider(c.env);
      const msg = SmsTemplates.consultationReminderEn(pat.name, doc.name, data.scheduledAt, roomUrl);
      return sms.sendSMS(pat.mobile!, msg);
    })() : Promise.resolve(),

    // Email to patient
    pat.email ? sendEmail(c.env, {
      to: pat.email,
      ...EmailTemplates.appointmentReminder({
        patientName:     pat.name,
        doctorName:      doc.name,
        appointmentDate: data.scheduledAt.split('T')[0],
        appointmentTime: data.scheduledAt.split('T')[1]?.slice(0, 5) ?? '',
        hospitalName,
      }),
    }) : Promise.resolve(),
  ]);

  return c.json({
    message: 'Consultation booked',
    id:      consultationId,
    roomUrl,
    scheduledAt: data.scheduledAt,
  }, 201);
});

// ─── PUT /api/consultations/:id — update scheduled time or notes ──────────────
consultationRoutes.put('/:id', zValidator('json', updateConsultationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const role = c.get('role');
  if (!role || !CONSULTATION_STAFF_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to update consultations' });
  }

  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM consultations WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Consultation not found' });

    await db.$client.prepare(`
      UPDATE consultations
      SET scheduled_at    = ?,
          duration_min    = ?,
          notes           = ?,
          chief_complaint = ?,
          status          = ?,
          updated_at      = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(
      data.scheduledAt    ?? existing['scheduled_at'],
      data.durationMin    ?? existing['duration_min'],
      data.notes          !== undefined ? data.notes : existing['notes'],
      data.chiefComplaint !== undefined ? data.chiefComplaint : existing['chief_complaint'],
      data.status         ?? existing['status'],
      id, tenantId,
    ).run();
    return c.json({ message: 'Consultation updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update consultation' });
  }
});

// ─── PUT /api/consultations/:id/end — mark complete + save prescription ───────
consultationRoutes.put('/:id/end', zValidator('json', endConsultationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const role = c.get('role');
  if (!role || !DOCTOR_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Only doctors can end consultations and write prescriptions' });
  }
  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(
      `SELECT * FROM consultations WHERE id = ? AND tenant_id = ? AND status IN ('scheduled','in_progress')`,
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Active consultation not found' });

    await db.$client.prepare(`
      UPDATE consultations
      SET status = 'completed', prescription = ?, followup_date = ?,
          notes = COALESCE(?, notes), updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(
      data.prescription ?? null,
      data.followupDate ?? null,
      data.notes ?? null,
      id, tenantId,
    ).run();

    return c.json({ message: 'Consultation completed', id: Number(id) });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to end consultation' });
  }
});

// ─── DELETE /api/consultations/:id — cancel (soft: set status cancelled) ─────
consultationRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const existing = await db.$client.prepare(
      `SELECT id FROM consultations WHERE id = ? AND tenant_id = ? AND status = 'scheduled'`,
    ).bind(id, tenantId).first();
    if (!existing) throw new HTTPException(404, { message: 'Scheduled consultation not found' });

    await db.$client.prepare(
      `UPDATE consultations SET status = 'cancelled', updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).run();
    return c.json({ message: 'Consultation cancelled' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to cancel consultation' });
  }
});

export default consultationRoutes;

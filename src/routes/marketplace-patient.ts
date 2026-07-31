import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { marketplaceBookingSchema, reviewSchema } from '../schemas/marketplace';
import { getDayOfWeek } from '../lib/marketplace-helpers';
import { normalizeConsultationFee } from '../lib/doctor-fees';
import { getNextSequence } from '../lib/sequence';
import type { Env, Variables } from '../types';

const marketplacePatientRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Middleware: verify global patient JWT.
 * Reuses the same JWT verification as patient-auth but sets patientGlobalId on context.
 */
marketplacePatientRoutes.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Patient authentication required' });
  }
  const token = authHeader.slice(7);

  try {
    // Verify JWT using the same secret as patient auth
    const { verify } = await import('hono/jwt');
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as {
      userId: number; scope: string; uhid: string; role: string;
    };

    if (payload.scope !== 'global' || payload.role !== 'patient') {
      throw new HTTPException(403, { message: 'Patient account required' });
    }

    c.set('userId', String(payload.userId));
    // Store UHID in tenantId slot for convenience (it's global, not tenant-specific)
    c.set('tenantId', payload.uhid);
    return next();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
});

// ─── POST /api/v1/marketplace/connect/:tenantId ─────────────────────────────
marketplacePatientRoutes.post('/connect/:tenantId', async (c) => {
  const targetTenantId = c.req.param('tenantId');
  const uhid = c.get('tenantId')!; // UHID stored here by middleware
  const patientUserId = c.get('userId')!;

  try {
    // Check if hospital is published
    const hospital = await c.env.DB.prepare(
      `SELECT id, name FROM tenants WHERE id = ? AND is_published = 1`
    ).bind(targetTenantId).first<{ id: string; name: string }>();

    if (!hospital) throw new HTTPException(404, { message: 'Hospital not found' });

    // Check if already connected
    const existing = await c.env.DB.prepare(
      `SELECT id FROM patient_health_links WHERE global_patient_id = ? AND tenant_id = ?`
    ).bind(uhid, targetTenantId).first();

    if (existing) {
      return c.json({ already_connected: true, tenant_id: targetTenantId });
    }

    // Get global patient identity
    const identity = await c.env.DB.prepare(
      `SELECT id, uhid, primary_name, primary_phone, primary_email, national_id,
              blood_group, date_of_birth, gender
       FROM global_patient_identity WHERE uhid = ?`
    ).bind(uhid).first<Record<string, unknown>>();

    if (!identity) throw new HTTPException(404, { message: 'Patient identity not found' });

    // Create local patient record in the target hospital
    const patientResult = await c.env.DB.prepare(`
      INSERT INTO patients (tenant_id, name, mobile, email, national_id, blood_group,
                           date_of_birth, gender, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'marketplace', datetime('now'))
    `).bind(
      targetTenantId,
      identity.primary_name,
      identity.primary_phone,
      identity.primary_email,
      identity.national_id,
      identity.blood_group,
      identity.date_of_birth,
      identity.gender,
    ).run();

    const localPatientId = patientResult.meta.last_row_id;

    // Create health link
    await c.env.DB.prepare(`
      INSERT INTO patient_health_links (global_patient_id, tenant_id, local_patient_id,
                                        link_type, created_at)
      VALUES (?, ?, ?, 'marketplace_connect', datetime('now'))
    `).bind(uhid, targetTenantId, localPatientId).run();

    return c.json({
      connected: true,
      tenant_id: targetTenantId,
      hospital_name: hospital.name,
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to connect to hospital' });
  }
});

// ─── POST /api/v1/marketplace/bookings ──────────────────────────────────────
marketplacePatientRoutes.post('/bookings', zValidator('json', marketplaceBookingSchema), async (c) => {
  const data = c.req.valid('json');
  const uhid = c.get('tenantId')!;
  const patientUserId = c.get('userId')!;

  try {
    // Verify doctor exists and is visible
    const doctor = await c.env.DB.prepare(`
      SELECT d.id, d.name, d.consultation_fee, d.tenant_id, t.name AS hospital_name
      FROM doctors d
      JOIN tenants t ON d.tenant_id = t.id
      WHERE d.id = ? AND d.tenant_id = ? AND d.is_marketplace_visible = 1 AND d.is_active = 1
    `).bind(data.doctor_id, data.tenant_id).first<Record<string, unknown>>();

    if (!doctor) throw new HTTPException(404, { message: 'Doctor not found or not available' });

    // Check availability for the date
    const dayOfWeek = getDayOfWeek(data.booking_date);
    const schedule = await c.env.DB.prepare(`
      SELECT max_patients FROM doctor_schedules
      WHERE doctor_id = ? AND tenant_id = ? AND day_of_week = ? AND is_active = 1
      LIMIT 1
    `).bind(data.doctor_id, data.tenant_id, dayOfWeek).first<{ max_patients: number }>();

    if (!schedule) throw new HTTPException(400, { message: 'Doctor has no schedule for this date' });

    const bookedRow = await c.env.DB.prepare(`
      SELECT COUNT(*) AS count FROM appointments
      WHERE doctor_id = ? AND tenant_id = ? AND appt_date = ?
        AND status NOT IN ('cancelled', 'no_show')
    `).bind(data.doctor_id, data.tenant_id, data.booking_date).first<{ count: number }>();

    if ((bookedRow?.count ?? 0) >= schedule.max_patients) {
      throw new HTTPException(400, { message: 'No available slots for this date' });
    }

    // Auto-connect if not connected
    let healthLink = await c.env.DB.prepare(
      `SELECT local_patient_id FROM patient_health_links WHERE global_patient_id = ? AND tenant_id = ?`
    ).bind(uhid, data.tenant_id).first<{ local_patient_id: number }>();

    if (!healthLink) {
      // Auto-connect (same logic as /connect endpoint)
      const identity = await c.env.DB.prepare(
        `SELECT primary_name, primary_phone, primary_email, national_id, blood_group, date_of_birth, gender
         FROM global_patient_identity WHERE uhid = ?`
      ).bind(uhid).first<Record<string, unknown>>();

      if (!identity) throw new HTTPException(404, { message: 'Patient identity not found' });

      const patientResult = await c.env.DB.prepare(`
        INSERT INTO patients (tenant_id, name, mobile, email, national_id, blood_group,
                             date_of_birth, gender, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'marketplace', datetime('now'))
      `).bind(
        data.tenant_id, identity.primary_name, identity.primary_phone,
        identity.primary_email, identity.national_id, identity.blood_group,
        identity.date_of_birth, identity.gender,
      ).run();

      const localPatientId = patientResult.meta.last_row_id;

      await c.env.DB.prepare(`
        INSERT INTO patient_health_links (global_patient_id, tenant_id, local_patient_id,
                                          link_type, created_at)
        VALUES (?, ?, ?, 'marketplace_booking', datetime('now'))
      `).bind(uhid, data.tenant_id, localPatientId).run();

      healthLink = { local_patient_id: Number(localPatientId) };
    }

    // Calculate next token number
    const tokenRow = await c.env.DB.prepare(`
      SELECT COALESCE(MAX(token_no), 0) + 1 AS next_token
      FROM appointments
      WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ?
    `).bind(data.tenant_id, data.booking_date, data.doctor_id).first<{ next_token: number }>();

    const tokenNo = tokenRow?.next_token ?? 1;
    const fee = normalizeConsultationFee(doctor.consultation_fee);
    const apptNo = await getNextSequence(c.env.DB, data.tenant_id, 'appointment', 'APT');

    // Create local appointment
    const apptResult = await c.env.DB.prepare(`
      INSERT INTO appointments (appt_no, tenant_id, patient_id, doctor_id, appt_date, appt_time,
                               token_no, fee, billing_status, status, visit_type, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 'opd', 'marketplace', datetime('now'))
    `).bind(
      apptNo, data.tenant_id, healthLink.local_patient_id, data.doctor_id,
      data.booking_date, data.booking_time, tokenNo, fee, fee > 0 ? 'unpaid' : 'no_charge',
    ).run();

    const localAppointmentId = apptResult.meta.last_row_id;

    // Create marketplace booking record
    const bookingResult = await c.env.DB.prepare(`
      INSERT INTO marketplace_bookings (patient_global_id, doctor_id, tenant_id,
        booking_date, booking_time, token_number, fee, status, local_appointment_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, datetime('now'))
    `).bind(
      uhid, data.doctor_id, data.tenant_id,
      data.booking_date, data.booking_time, tokenNo, fee, localAppointmentId,
    ).run();

    return c.json({
      booking_id: bookingResult.meta.last_row_id,
      local_appointment_id: localAppointmentId,
      token_number: tokenNo,
      doctor_name: doctor.name,
      hospital_name: doctor.hospital_name,
      date: data.booking_date,
      time: data.booking_time,
      fee,
      status: 'confirmed',
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to create booking' });
  }
});

// ─── POST /api/v1/marketplace/telemedicine-bookings ──────────────────────────
marketplacePatientRoutes.post('/telemedicine-bookings', async (c) => {
  const body = await c.req.json<{
    doctor_id: number;
    tenant_id: string;
    booking_date: string;
    booking_time: string;
    chief_complaint?: string;
  }>();
  const uhid = c.get('tenantId')!;

  if (!body.doctor_id || !body.tenant_id || !body.booking_date || !body.booking_time) {
    throw new HTTPException(400, { message: 'doctor_id, tenant_id, booking_date, booking_time required' });
  }

  try {
    // Verify doctor exists and is published
    const doctor = await c.env.DB.prepare(`
      SELECT d.id, d.name, d.tenant_id, d.consultation_fee, t.name AS hospital_name
      FROM doctors d
      JOIN tenants t ON d.tenant_id = t.id AND t.is_published = 1
      WHERE d.id = ? AND d.tenant_id = ? AND d.is_marketplace_visible = 1 AND d.is_active = 1
    `).bind(body.doctor_id, body.tenant_id).first<{ id: number; name: string; tenant_id: string; consultation_fee: number; hospital_name: string }>();

    if (!doctor) throw new HTTPException(404, { message: 'Doctor not found or not available' });

    // Ensure connection exists (same logic as regular booking)
    let link = await c.env.DB.prepare(
      `SELECT local_patient_id FROM patient_health_links WHERE global_patient_id = ? AND tenant_id = ?`
    ).bind(uhid, body.tenant_id).first<{ local_patient_id: number }>();

    if (!link) {
      // Auto-connect
      const identity = await c.env.DB.prepare(
        `SELECT id, primary_name, primary_phone, primary_email, national_id, blood_group, date_of_birth, gender
         FROM global_patient_identity WHERE uhid = ?`
      ).bind(uhid).first<Record<string, unknown>>();

      if (!identity) throw new HTTPException(404, { message: 'Patient identity not found' });

      const patientResult = await c.env.DB.prepare(`
        INSERT INTO patients (tenant_id, name, mobile, email, national_id, blood_group, date_of_birth, gender, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'marketplace', datetime('now'))
      `).bind(
        body.tenant_id, identity.primary_name, identity.primary_phone ?? null,
        identity.primary_email ?? null, identity.national_id ?? null,
        identity.blood_group ?? null, identity.date_of_birth ?? null,
        identity.gender ?? null
      ).run();

      const localPatientId = patientResult.meta.last_row_id;

      await c.env.DB.prepare(`
        INSERT INTO patient_health_links (global_patient_id, tenant_id, local_patient_id, link_type, status, created_at)
        VALUES (?, ?, ?, 'marketplace', 'active', datetime('now'))
      `).bind(uhid, body.tenant_id, localPatientId).run();

      link = { local_patient_id: localPatientId };
    }

    // Create consultation record
    const consultationResult = await c.env.DB.prepare(`
      INSERT INTO consultations (tenant_id, doctor_id, patient_id, scheduled_at, duration_min, status, chief_complaint, created_at)
      VALUES (?, ?, ?, datetime(? || ' ' || ?), 30, 'scheduled', ?, datetime('now'))
    `).bind(body.tenant_id, body.doctor_id, link.local_patient_id, body.booking_date, body.booking_time, body.chief_complaint ?? null).run();

    const consultationId = consultationResult.meta.last_row_id;

    // Create marketplace booking record linking to consultation
    const bookingResult = await c.env.DB.prepare(`
      INSERT INTO marketplace_bookings
        (patient_global_id, doctor_id, tenant_id, booking_date, booking_time, fee, status, local_appointment_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, 'telemedicine', datetime('now'))
    `).bind(uhid, body.doctor_id, body.tenant_id, body.booking_date, body.booking_time, normalizeConsultationFee(doctor.consultation_fee), consultationId).run();

    return c.json({
      message: 'Telemedicine consultation booked',
      booking_id: bookingResult.meta.last_row_id,
      consultation_id: consultationId,
      doctor_name: doctor.name,
      hospital_name: doctor.hospital_name,
      date: body.booking_date,
      time: body.booking_time,
      status: 'confirmed',
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to create telemedicine booking' });
  }
});

// ─── GET /api/v1/marketplace/bookings ───────────────────────────────────────
marketplacePatientRoutes.get('/bookings', async (c) => {
  const uhid = c.get('tenantId')!;

  try {
    const { results: bookings } = await c.env.DB.prepare(`
      SELECT mb.id, mb.booking_date, mb.booking_time, mb.token_number, mb.fee,
             mb.status, mb.created_at, mb.source, mb.local_appointment_id,
             d.name AS doctor_name, d.specialty,
             t.name AS hospital_name, t.tenant_type
      FROM marketplace_bookings mb
      JOIN doctors d ON mb.doctor_id = d.id
      JOIN tenants t ON mb.tenant_id = t.id
      WHERE mb.patient_global_id = ?
      ORDER BY mb.booking_date DESC, mb.booking_time DESC
      LIMIT 100
    `).bind(uhid).all();

    // Enrich telemedicine bookings with consultation details
    const enriched = await Promise.all(
      (bookings as any[]).map(async (b) => {
        if (b.source === 'telemedicine' && b.local_appointment_id) {
          const consultation = await c.env.DB.prepare(
            `SELECT id, room_url, status as consultation_status FROM consultations WHERE id = ?`
          ).bind(b.local_appointment_id).first();
          return { ...b, consultation };
        }
        return b;
      })
    );

    return c.json({ bookings: enriched });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch bookings' });
  }
});

// ─── DELETE /api/v1/marketplace/bookings/:id ────────────────────────────────
marketplacePatientRoutes.delete('/bookings/:id', async (c) => {
  const bookingId = Number(c.req.param('id'));
  const uhid = c.get('tenantId')!;

  try {
    const booking = await c.env.DB.prepare(`
      SELECT id, status, local_appointment_id, tenant_id
      FROM marketplace_bookings
      WHERE id = ? AND patient_global_id = ?
    `).bind(bookingId, uhid).first<Record<string, unknown>>();

    if (!booking) throw new HTTPException(404, { message: 'Booking not found' });
    if (booking.status !== 'confirmed') {
      throw new HTTPException(400, { message: 'Only confirmed bookings can be cancelled' });
    }

    // Cancel marketplace booking
    await c.env.DB.prepare(`
      UPDATE marketplace_bookings SET status = 'cancelled', updated_at = datetime('now')
      WHERE id = ?
    `).bind(bookingId).run();

    // Cancel the local appointment too
    if (booking.local_appointment_id) {
      await c.env.DB.prepare(`
        UPDATE appointments SET status = 'cancelled', billing_status = 'cancelled', updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
      `).bind(booking.local_appointment_id, booking.tenant_id).run();
    }

    return c.json({ message: 'Booking cancelled', id: bookingId });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to cancel booking' });
  }
});

// ─── POST /api/v1/marketplace/reviews ───────────────────────────────────────
marketplacePatientRoutes.post('/reviews', zValidator('json', reviewSchema), async (c) => {
  const data = c.req.valid('json');
  const uhid = c.get('tenantId')!;

  try {
    // Get local patient link
    const link = await c.env.DB.prepare(
      `SELECT local_patient_id FROM patient_health_links WHERE global_patient_id = ? AND tenant_id = ?`
    ).bind(uhid, data.target_tenant_id).first<{ local_patient_id: number }>();

    if (!link) throw new HTTPException(400, { message: 'You are not connected to this hospital' });

    // Verify completed visit exists
    let visitQuery = `
      SELECT 1 FROM appointments
      WHERE patient_id = ? AND tenant_id = ? AND status = 'completed'
    `;
    const visitBinds: (string | number)[] = [link.local_patient_id, data.target_tenant_id];

    if (data.target_type === 'doctor' && data.target_doctor_id) {
      visitQuery += ` AND doctor_id = ?`;
      visitBinds.push(data.target_doctor_id);
    }

    const hasVisit = await c.env.DB.prepare(visitQuery).bind(...visitBinds).first();
    if (!hasVisit) {
      throw new HTTPException(400, { message: 'You can only review providers you have visited' });
    }

    // Check for duplicate review
    let dupQuery = `
      SELECT 1 FROM provider_reviews
      WHERE reviewer_global_patient_id = ? AND target_type = ? AND target_tenant_id = ?
    `;
    const dupBinds: (string | number)[] = [uhid, data.target_type, data.target_tenant_id];

    if (data.target_doctor_id) {
      dupQuery += ` AND target_doctor_id = ?`;
      dupBinds.push(data.target_doctor_id);
    }

    const duplicate = await c.env.DB.prepare(dupQuery).bind(...dupBinds).first();
    if (duplicate) {
      throw new HTTPException(400, { message: 'You have already submitted a review' });
    }

    // Create review
    const result = await c.env.DB.prepare(`
      INSERT INTO provider_reviews (reviewer_global_patient_id, target_type, target_tenant_id,
        target_doctor_id, rating, review_text, is_verified_visit, is_approved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, datetime('now'))
    `).bind(
      uhid, data.target_type, data.target_tenant_id,
      data.target_doctor_id ?? null, data.rating, data.review_text ?? null,
    ).run();

    return c.json({
      review_id: result.meta.last_row_id,
      status: 'pending_moderation',
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to submit review' });
  }
});

export default marketplacePatientRoutes;

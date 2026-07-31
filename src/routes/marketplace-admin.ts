import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  publishHospitalSchema,
  publishDoctorSchema,
  updateHospitalProfileSchema,
} from '../schemas/marketplace';
import { requireTenantId, requireUserId } from '../lib/context-helpers';
import { createAuditLog } from '../lib/accounting-helpers';
import type { Env, Variables } from '../types';
import { formatDoctorName } from '../lib/doctor-display';

const marketplaceAdminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── PUT /api/v1/marketplace/publish ────────────────────────────────────────
marketplaceAdminRoutes.put('/publish', zValidator('json', publishHospitalSchema), async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const { is_published } = c.req.valid('json');

  try {
    await c.env.DB.prepare(
      `UPDATE tenants SET is_published = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(is_published ? 1 : 0, tenantId).run();

    void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'tenants', 0, null, {
      action: 'marketplace_publish', is_published,
    });

    return c.json({
      message: is_published ? 'Hospital published to marketplace' : 'Hospital removed from marketplace',
      is_published,
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to update marketplace status' });
  }
});

// ─── PUT /api/v1/marketplace/doctors/:id/publish ────────────────────────────
marketplaceAdminRoutes.put('/doctors/:id/publish', zValidator('json', publishDoctorSchema), async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const doctorId = Number(c.req.param('id'));
  const { is_marketplace_visible } = c.req.valid('json');

  try {
    // Verify doctor belongs to this tenant
    const doctor = await c.env.DB.prepare(
      `SELECT id, name FROM doctors WHERE id = ? AND tenant_id = ?`
    ).bind(doctorId, tenantId).first<{ id: number; name: string }>();

    if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

    await c.env.DB.prepare(
      `UPDATE doctors SET is_marketplace_visible = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
    ).bind(is_marketplace_visible ? 1 : 0, doctorId, tenantId).run();

    void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'doctors', doctorId, null, {
      action: 'marketplace_publish_doctor', is_marketplace_visible, doctor_name: doctor.name,
    });

    return c.json({
      message: is_marketplace_visible
        ? `${formatDoctorName(doctor.name)} published to marketplace`
        : `${formatDoctorName(doctor.name)} removed from marketplace`,
      doctor_id: doctorId,
      is_marketplace_visible,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update doctor marketplace status' });
  }
});

// ─── PUT /api/v1/marketplace/profile ────────────────────────────────────────
marketplaceAdminRoutes.put('/profile', zValidator('json', updateHospitalProfileSchema), async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const data = c.req.valid('json');

  try {
    const sets: string[] = ['updated_at = datetime(\'now\')'];
    const binds: (string | number | null)[] = [];

    if (data.public_description !== undefined) {
      sets.push('public_description = ?');
      binds.push(data.public_description);
    }
    if (data.public_photos !== undefined) {
      sets.push('public_photos = ?');
      binds.push(JSON.stringify(data.public_photos));
    }
    if (data.specialties !== undefined) {
      sets.push('specialties = ?');
      binds.push(JSON.stringify(data.specialties));
    }
    if (data.latitude !== undefined) {
      sets.push('latitude = ?');
      binds.push(data.latitude);
    }
    if (data.longitude !== undefined) {
      sets.push('longitude = ?');
      binds.push(data.longitude);
    }
    if (data.operating_hours !== undefined) {
      sets.push('operating_hours = ?');
      binds.push(JSON.stringify(data.operating_hours));
    }

    if (sets.length === 1) {
      return c.json({ message: 'No fields to update' });
    }

    binds.push(tenantId);
    await c.env.DB.prepare(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'tenants', 0, null, {
      action: 'marketplace_profile_update', fields: Object.keys(data),
    });

    return c.json({ message: 'Marketplace profile updated' });
  } catch {
    throw new HTTPException(500, { message: 'Failed to update marketplace profile' });
  }
});

// ─── GET /api/v1/marketplace-admin/bookings ─────────────────────────────────
// List marketplace bookings for this hospital (incoming from patients)
marketplaceAdminRoutes.get('/bookings', async (c) => {
  const tenantId = String(requireTenantId(c));
  const { page = '1', limit = '20', status, date, source } = c.req.query();
  const offset = (Number(page) - 1) * Number(limit);

  try {
    let query = `
      SELECT
        mb.id,
        mb.patient_global_id,
        mb.doctor_id,
        mb.booking_date,
        mb.booking_time,
        mb.token_number,
        mb.fee,
        mb.status,
        mb.source,
        mb.local_appointment_id,
        mb.created_at,
        g.primary_name as patient_name,
        g.primary_phone as patient_phone,
        d.name as doctor_name,
        d.specialty as doctor_specialty
      FROM marketplace_bookings mb
      LEFT JOIN global_patient_identity g ON g.uhid = mb.patient_global_id
      LEFT JOIN doctors d ON d.id = mb.doctor_id AND d.tenant_id = mb.tenant_id
      WHERE mb.tenant_id = ?`;
    const binds: (string | number)[] = [tenantId];

    if (status)  { query += ' AND mb.status = ?'; binds.push(status); }
    if (date)    { query += ' AND mb.booking_date = ?'; binds.push(date); }
    if (source)  { query += ' AND mb.source = ?'; binds.push(source); }

    query += ` ORDER BY mb.booking_date DESC, mb.booking_time DESC LIMIT ? OFFSET ?`;
    binds.push(Number(limit), offset);

    const { results } = await c.env.DB.prepare(query).bind(...binds).all();

    // Count total
    let countQuery = `SELECT COUNT(*) as total FROM marketplace_bookings WHERE tenant_id = ?`;
    const countBinds: (string | number)[] = [tenantId];
    if (status) { countQuery += ' AND status = ?'; countBinds.push(status); }
    if (date)   { countQuery += ' AND booking_date = ?'; countBinds.push(date); }
    if (source) { countQuery += ' AND source = ?'; countBinds.push(source); }

    const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first<{ total: number }>();

    // Stats
    const statsQuery = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN source = 'marketplace' THEN 1 ELSE 0 END) as marketplace_count,
        SUM(CASE WHEN source = 'telemedicine' THEN 1 ELSE 0 END) as telemedicine_count
      FROM marketplace_bookings
      WHERE tenant_id = ?
    `).bind(tenantId).first<Record<string, number>>();

    return c.json({
      data: results,
      pagination: { page: Number(page), limit: Number(limit), total: countResult?.total ?? 0 },
      stats: {
        total: statsQuery?.total ?? 0,
        confirmed: statsQuery?.confirmed ?? 0,
        completed: statsQuery?.completed ?? 0,
        cancelled: statsQuery?.cancelled ?? 0,
        marketplace: statsQuery?.marketplace_count ?? 0,
        telemedicine: statsQuery?.telemedicine_count ?? 0,
      },
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch marketplace bookings' });
  }
});

// ─── PUT /api/v1/marketplace-admin/bookings/:id/status ──────────────────────
marketplaceAdminRoutes.put('/bookings/:id/status', async (c) => {
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const bookingId = Number(c.req.param('id'));
  const body = await c.req.json<{ status: string; reason?: string }>();

  if (!body.status) throw new HTTPException(400, { message: 'Status required' });

  const validStatuses = ['confirmed', 'completed', 'cancelled', 'no_show'];
  if (!validStatuses.includes(body.status)) {
    throw new HTTPException(400, { message: 'Invalid status' });
  }

  try {
    const booking = await c.env.DB.prepare(
      `SELECT id, tenant_id, local_appointment_id FROM marketplace_bookings WHERE id = ?`
    ).bind(bookingId).first<{ id: number; tenant_id: string; local_appointment_id: number | null }>();

    if (!booking) throw new HTTPException(404, { message: 'Booking not found' });
    if (booking.tenant_id !== tenantId) throw new HTTPException(403, { message: 'Not authorized' });

    // Update marketplace booking
    await c.env.DB.prepare(
      `UPDATE marketplace_bookings SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(body.status, bookingId).run();

    // Sync to local appointment if exists
    if (booking.local_appointment_id) {
      await c.env.DB.prepare(
        `UPDATE appointments SET status = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
      ).bind(body.status, booking.local_appointment_id, tenantId).run();
    }

    void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'marketplace_bookings', bookingId, null, {
      action: 'booking_status_change', new_status: body.status, reason: body.reason ?? null,
    });

    return c.json({ message: 'Booking status updated', status: body.status });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update booking status' });
  }
});

export default marketplaceAdminRoutes;

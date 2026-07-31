import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  hospitalSearchSchema,
  doctorSearchSchema,
  availabilityQuerySchema,
} from '../schemas/marketplace';
import { buildSearchClause, buildPagination, getDayOfWeek } from '../lib/marketplace-helpers';
import { normalizeConsultationFee } from '../lib/doctor-fees';
import type { Env, Variables } from '../types';

const marketplaceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── GET /api/v1/marketplace/hospitals ───────────────────────────────────────
marketplaceRoutes.get('/hospitals', zValidator('query', hospitalSearchSchema), async (c) => {
  const params = c.req.valid('query');

  try {
    let query = `
      SELECT t.id, t.name, t.tenant_type, t.public_description, t.specialties,
             t.latitude, t.longitude, t.operating_hours, t.public_photos,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM tenants t
      LEFT JOIN provider_reviews r
        ON r.target_tenant_id = t.id AND r.target_type = 'hospital' AND r.is_approved = 1
      WHERE t.is_published = 1
    `;
    const binds: (string | number)[] = [];

    if (params.q) {
      const { clause, params: searchParams } = buildSearchClause(params.q, ['t.name', 't.specialties']);
      query += ` AND ${clause}`;
      binds.push(...searchParams);
    }

    if (params.specialty) {
      query += ` AND t.specialties LIKE ?`;
      binds.push(`%${params.specialty}%`);
    }

    if (params.type) {
      query += ` AND t.tenant_type = ?`;
      binds.push(params.type);
    }

    query += ` GROUP BY t.id`;

    const havingClauses: string[] = [];
    const havingBinds: (string | number)[] = [];

    if (params.rating_min) {
      havingClauses.push(`avg_rating >= ?`);
      havingBinds.push(params.rating_min);
    }

    if (params.lat != null && params.lng != null && params.radius != null) {
      query = query.replace(
        'SELECT t.id, t.name, t.tenant_type, t.public_description, t.specialties,\n' +
        '             t.latitude, t.longitude, t.operating_hours, t.public_photos,\n' +
        '             COALESCE(AVG(r.rating), 0) AS avg_rating,\n' +
        '             COUNT(r.id) AS review_count',
        `SELECT t.id, t.name, t.tenant_type, t.public_description, t.specialties,
             t.latitude, t.longitude, t.operating_hours, t.public_photos,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count,
             (
               6371 * acos(
                 cos(radians(${params.lat})) * cos(radians(t.latitude)) *
                 cos(radians(t.longitude) - radians(${params.lng})) +
                 sin(radians(${params.lat})) * sin(radians(t.latitude))
               )
             ) AS distance`
      );
      havingClauses.push(`distance <= ?`);
      havingBinds.push(params.radius);
    }

    if (havingClauses.length > 0) {
      query += ` HAVING ${havingClauses.join(' AND ')}`;
      binds.push(...havingBinds);
    }

    if (params.lat != null && params.lng != null) {
      query += ` ORDER BY distance ASC, avg_rating DESC`;
    } else {
      query += ` ORDER BY avg_rating DESC`;
    }

    // Count total before pagination
    const countQuery = `SELECT COUNT(*) AS total FROM (${query})`;
    const countRow = await c.env.DB.prepare(countQuery).bind(...binds).first<{ total: number }>();
    const total = countRow?.total ?? 0;

    const { clause: pagClause, params: pagParams } = buildPagination(params.page!, params.limit!);
    query += ` ${pagClause}`;
    binds.push(...pagParams);

    const { results } = await c.env.DB.prepare(query).bind(...binds).all();

    const hasLocation = params.lat != null && params.lng != null;
    return c.json({
      hospitals: results.map((r: any) => ({
        ...r,
        distance_km: hasLocation && r.distance != null ? Math.round(Number(r.distance) * 10) / 10 : undefined,
      })),
      total,
      page: params.page,
      limit: params.limit,
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to search hospitals' });
  }
});

// ─── GET /api/v1/marketplace/hospitals/:id ──────────────────────────────────
marketplaceRoutes.get('/hospitals/:id', async (c) => {
  const tenantId = c.req.param('id');

  try {
    const hospital = await c.env.DB.prepare(`
      SELECT t.id, t.name, t.tenant_type, t.public_description, t.specialties,
             t.latitude, t.longitude, t.operating_hours, t.public_photos,
             t.address, t.phone, t.email,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM tenants t
      LEFT JOIN provider_reviews r
        ON r.target_tenant_id = t.id AND r.target_type = 'hospital' AND r.is_approved = 1
      WHERE t.id = ? AND t.is_published = 1
      GROUP BY t.id
    `).bind(tenantId).first();

    if (!hospital) throw new HTTPException(404, { message: 'Hospital not found' });

    // Fetch published doctors at this hospital
    const { results: doctors } = await c.env.DB.prepare(`
      SELECT d.id, d.name, d.specialty, d.qualifications, d.consultation_fee,
             d.public_bio, d.languages, d.profile_photo_key, d.bmdc_reg_no,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM doctors d
      LEFT JOIN provider_reviews r
        ON r.target_doctor_id = d.id AND r.target_type = 'doctor' AND r.is_approved = 1
      WHERE d.tenant_id = ? AND d.is_marketplace_visible = 1 AND d.is_active = 1
      GROUP BY d.id
      ORDER BY avg_rating DESC
    `).bind(tenantId).all();

    return c.json({
      hospital,
      doctors: doctors.map((doctor: Record<string, unknown>) => ({
        ...doctor,
        consultation_fee: normalizeConsultationFee(doctor.consultation_fee),
      })),
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch hospital' });
  }
});

// ─── GET /api/v1/marketplace/doctors ────────────────────────────────────────
marketplaceRoutes.get('/doctors', zValidator('query', doctorSearchSchema), async (c) => {
  const params = c.req.valid('query');

  try {
    let query = `
      SELECT d.id, d.name, d.specialty, d.qualifications, d.consultation_fee,
             d.public_bio, d.languages, d.profile_photo_key, d.bmdc_reg_no,
             d.tenant_id, t.name AS hospital_name, t.tenant_type,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM doctors d
      JOIN tenants t ON d.tenant_id = t.id AND t.is_published = 1
      LEFT JOIN provider_reviews r
        ON r.target_doctor_id = d.id AND r.target_type = 'doctor' AND r.is_approved = 1
      WHERE d.is_marketplace_visible = 1 AND d.is_active = 1
    `;
    const binds: (string | number)[] = [];

    if (params.q) {
      const { clause, params: searchParams } = buildSearchClause(params.q, ['d.name', 'd.specialty']);
      query += ` AND ${clause}`;
      binds.push(...searchParams);
    }

    if (params.specialty) {
      query += ` AND d.specialty LIKE ?`;
      binds.push(`%${params.specialty}%`);
    }

    if (params.hospital) {
      query += ` AND d.tenant_id = ?`;
      binds.push(params.hospital);
    }

    if (params.language) {
      query += ` AND d.languages LIKE ?`;
      binds.push(`%${params.language}%`);
    }

    if (params.fee_max) {
      const feeMax = normalizeConsultationFee(params.fee_max);
      query += ` AND (
        d.consultation_fee <= ?
        OR (
          d.consultation_fee >= 10000
          AND CAST(d.consultation_fee AS INTEGER) % 100 = 0
          AND d.consultation_fee / 100 <= ?
        )
      )`;
      binds.push(feeMax, feeMax);
    }

    query += ` GROUP BY d.id`;

    if (params.rating_min) {
      query += ` HAVING avg_rating >= ?`;
      binds.push(params.rating_min);
    }

    query += ` ORDER BY avg_rating DESC`;

    const countQuery = `SELECT COUNT(*) AS total FROM (${query})`;
    const countRow = await c.env.DB.prepare(countQuery).bind(...binds).first<{ total: number }>();
    const total = countRow?.total ?? 0;

    const { clause: pagClause, params: pagParams } = buildPagination(params.page!, params.limit!);
    query += ` ${pagClause}`;
    binds.push(...pagParams);

    const { results } = await c.env.DB.prepare(query).bind(...binds).all();

    return c.json({
      doctors: results.map((doctor: Record<string, unknown>) => ({
        ...doctor,
        consultation_fee: normalizeConsultationFee(doctor.consultation_fee),
      })),
      total,
      page: params.page,
      limit: params.limit,
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to search doctors' });
  }
});

// ─── GET /api/v1/marketplace/doctors/:id ────────────────────────────────────
marketplaceRoutes.get('/doctors/:id', async (c) => {
  const doctorId = Number(c.req.param('id'));

  try {
    const doctor = await c.env.DB.prepare(`
      SELECT d.id, d.name, d.specialty, d.qualifications, d.consultation_fee,
             d.public_bio, d.languages, d.profile_photo_key, d.bmdc_reg_no,
             d.tenant_id, t.name AS hospital_name, t.tenant_type, t.address AS hospital_address,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM doctors d
      JOIN tenants t ON d.tenant_id = t.id AND t.is_published = 1
      LEFT JOIN provider_reviews r
        ON r.target_doctor_id = d.id AND r.target_type = 'doctor' AND r.is_approved = 1
      WHERE d.id = ? AND d.is_marketplace_visible = 1 AND d.is_active = 1
      GROUP BY d.id
    `).bind(doctorId).first();

    if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

    // Fetch doctor's weekly schedule
    const { results: schedules } = await c.env.DB.prepare(`
      SELECT day_of_week, start_time, end_time, slot_duration_min, is_available, session_type, chamber
      FROM doctor_schedules
      WHERE doctor_id = ? AND tenant_id = ? AND is_available = 1
      ORDER BY day_of_week, start_time
    `).bind(doctorId, doctor.tenant_id).all();

    // Fetch next 14 days of booked slots
    const today = new Date().toISOString().split('T')[0];
    const twoWeeksLater = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

    const { results: bookedSlots } = await c.env.DB.prepare(`
      SELECT booking_date, booking_time
      FROM appointments
      WHERE doctor_id = ? AND tenant_id = ?
        AND booking_date BETWEEN ? AND ?
        AND status NOT IN ('cancelled', 'no_show')
    `).bind(doctorId, doctor.tenant_id, today, twoWeeksLater).all();

    return c.json({
      doctor: {
        ...doctor,
        consultation_fee: normalizeConsultationFee((doctor as Record<string, unknown>).consultation_fee),
        schedule: schedules,
        booked_slots: bookedSlots,
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch doctor' });
  }
});

// ─── GET /api/v1/marketplace/doctors/:id/availability ───────────────────────
marketplaceRoutes.get('/doctors/:id/availability', zValidator('query', availabilityQuerySchema), async (c) => {
  const doctorId = Number(c.req.param('id'));
  const { date } = c.req.valid('query');
  const dayOfWeek = getDayOfWeek(date);

  try {
    // Get doctor's schedule for this day
    const doctor = await c.env.DB.prepare(`
      SELECT d.id, d.tenant_id, d.consultation_fee
      FROM doctors d
      WHERE d.id = ? AND d.is_marketplace_visible = 1 AND d.is_active = 1
    `).bind(doctorId).first<{ id: number; tenant_id: string; consultation_fee: number }>();

    if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

    // Get schedule for this day_of_week
    const { results: schedules } = await c.env.DB.prepare(`
      SELECT id, day_of_week, start_time, end_time, max_patients, session_type, chamber
      FROM doctor_schedules
      WHERE doctor_id = ? AND tenant_id = ? AND day_of_week = ? AND is_active = 1
    `).bind(doctorId, doctor.tenant_id, dayOfWeek).all();

    if (schedules.length === 0) {
      return c.json({ available: false, date, day_of_week: dayOfWeek, slots: [] });
    }

    // Count existing appointments for this date + doctor
    const booked = await c.env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM appointments
      WHERE doctor_id = ? AND tenant_id = ? AND appt_date = ?
        AND status NOT IN ('cancelled', 'no_show')
    `).bind(doctorId, doctor.tenant_id, date).first<{ count: number }>();

    const bookedCount = booked?.count ?? 0;

    const slots = (schedules as Record<string, unknown>[]).map((s) => {
      const maxPatients = (s.max_patients as number) ?? 20;
      const remaining = Math.max(0, maxPatients - bookedCount);
      return {
        schedule_id: s.id,
        start_time: s.start_time,
        end_time: s.end_time,
        max_patients: maxPatients,
        booked: bookedCount,
        remaining,
        session_type: s.session_type,
        chamber: s.chamber,
      };
    });

    return c.json({
      available: slots.some((s) => s.remaining > 0),
      date,
      day_of_week: dayOfWeek,
      consultation_fee: normalizeConsultationFee(doctor.consultation_fee),
      slots,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch availability' });
  }
});

// ─── GET /api/v1/marketplace/doctors/:id/reviews ────────────────────────────
marketplaceRoutes.get('/doctors/:id/reviews', async (c) => {
  const doctorId = Number(c.req.param('id'));
  const page = Number(c.req.query('page') || '1');
  const limit = Math.min(Number(c.req.query('limit') || '20'), 50);
  const offset = (page - 1) * limit;

  try {
    const countRow = await c.env.DB.prepare(`
      SELECT COUNT(*) AS total FROM provider_reviews
      WHERE target_doctor_id = ? AND target_type = 'doctor' AND is_approved = 1
    `).bind(doctorId).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(`
      SELECT r.id, r.rating, r.review_text, r.is_verified_visit, r.created_at,
             g.primary_name AS reviewer_name
      FROM provider_reviews r
      LEFT JOIN global_patient_identity g ON r.reviewer_global_patient_id = g.uhid
      WHERE r.target_doctor_id = ? AND r.target_type = 'doctor' AND r.is_approved = 1
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(doctorId, limit, offset).all();

    return c.json({
      reviews: results,
      total: countRow?.total ?? 0,
      page,
      limit,
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch reviews' });
  }
});

// ─── GET /api/v1/marketplace/hospitals/:id/reviews ──────────────────────────
marketplaceRoutes.get('/hospitals/:id/reviews', async (c) => {
  const tenantId = c.req.param('id');
  const page = Number(c.req.query('page') || '1');
  const limit = Math.min(Number(c.req.query('limit') || '20'), 50);
  const offset = (page - 1) * limit;

  try {
    const countRow = await c.env.DB.prepare(`
      SELECT COUNT(*) AS total FROM provider_reviews
      WHERE target_tenant_id = ? AND target_type = 'hospital' AND is_approved = 1
    `).bind(tenantId).first<{ total: number }>();

    const { results } = await c.env.DB.prepare(`
      SELECT r.id, r.rating, r.review_text, r.is_verified_visit, r.created_at,
             g.primary_name AS reviewer_name
      FROM provider_reviews r
      LEFT JOIN global_patient_identity g ON r.reviewer_global_patient_id = g.uhid
      WHERE r.target_tenant_id = ? AND r.target_type = 'hospital' AND r.is_approved = 1
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, limit, offset).all();

    return c.json({
      reviews: results,
      total: countRow?.total ?? 0,
      page,
      limit,
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch reviews' });
  }
});

export default marketplaceRoutes;

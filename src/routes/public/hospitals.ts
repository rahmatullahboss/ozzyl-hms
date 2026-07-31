import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../../types';

/**
 * Public Hospital Discovery Routes
 *
 * Endpoints (no auth required):
 *   GET /api/v1/public/hospitals?lat=&lng=&city=&limit=
 *   GET /api/v1/public/hospitals/:id
 */
const publicHospitalRoutes = new Hono<{ Bindings: Env }>();

// ─── GET /api/v1/public/hospitals ─────────────────────────────────────
publicHospitalRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const lat = c.req.query('lat') ? parseFloat(c.req.query('lat')!) : null;
  const lng = c.req.query('lng') ? parseFloat(c.req.query('lng')!) : null;
  const city = c.req.query('city');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);

  try {
    let query = `
      SELECT t.id, t.name, t.tenant_type, t.public_description, t.specialties,
             t.latitude, t.longitude, t.operating_hours, t.public_photos,
             t.address, t.phone, t.email,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM tenants t
      LEFT JOIN provider_reviews r
        ON r.target_tenant_id = t.id AND r.target_type = 'hospital' AND r.is_approved = 1
      WHERE t.is_published = 1
    `;
    const binds: (string | number)[] = [];

    if (city) {
      query += ` AND (t.address LIKE ? OR t.name LIKE ?)`;
      binds.push(`%${city}%`, `%${city}%`);
    }

    query += ` GROUP BY t.id`;

    // Add distance calculation if lat/lng provided
    if (lat != null && lng != null) {
      query = query.replace(
        `SELECT t.id, t.name, t.tenant_type, t.public_description, t.specialties,
             t.latitude, t.longitude, t.operating_hours, t.public_photos,
             t.address, t.phone, t.email,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count`,
        `SELECT t.id, t.name, t.tenant_type, t.public_description, t.specialties,
             t.latitude, t.longitude, t.operating_hours, t.public_photos,
             t.address, t.phone, t.email,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count,
             (
               6371 * acos(
                 cos(radians(${lat})) * cos(radians(t.latitude)) *
                 cos(radians(t.longitude) - radians(${lng})) +
                 sin(radians(${lat})) * sin(radians(t.latitude))
               )
             ) AS distance`
      );
      query += ` HAVING distance <= 50`; // 50km radius
      query += ` ORDER BY distance ASC, avg_rating DESC`;
    } else {
      query += ` ORDER BY avg_rating DESC`;
    }

    query += ` LIMIT ?`;
    binds.push(limit);

    const { results } = await db.prepare(query).bind(...binds).all();

    const hospitals = (results || []).map((r: any) => ({
      id: String(r.id),
      name: r.name,
      tenant_type: r.tenant_type,
      address: r.address,
      specialties: r.specialties ? JSON.parse(r.specialties) : [],
      latitude: r.latitude,
      longitude: r.longitude,
      operating_hours: r.operating_hours,
      photos: r.public_photos ? JSON.parse(r.public_photos) : [],
      phone: r.phone,
      email: r.email,
      rating: r.avg_rating ? Math.round(Number(r.avg_rating) * 10) / 10 : null,
      review_count: r.review_count,
      distance_km: r.distance != null ? Math.round(Number(r.distance) * 10) / 10 : undefined,
    }));

    return c.json({ hospitals });
  } catch (error) {
    console.error('[public-hospitals] search error:', error);
    throw new HTTPException(500, { message: 'Failed to search hospitals' });
  }
});

// ─── GET /api/v1/public/hospitals/:id ─────────────────────────────────
publicHospitalRoutes.get('/:id', async (c) => {
  const db = c.env.DB;
  const tenantId = c.req.param('id');

  try {
    // Hospital profile
    const hospital = await db.prepare(`
      SELECT t.id, t.name, t.tenant_type, t.public_description, t.specialties,
             t.latitude, t.longitude, t.operating_hours, t.public_photos,
             t.address, t.phone, t.email, t.website,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM tenants t
      LEFT JOIN provider_reviews r
        ON r.target_tenant_id = t.id AND r.target_type = 'hospital' AND r.is_approved = 1
      WHERE t.id = ? AND t.is_published = 1
      GROUP BY t.id
    `).bind(tenantId).first();

    if (!hospital) throw new HTTPException(404, { message: 'Hospital not found' });

    // Departments (derived from specialties + doctor departments)
    const { results: deptRows } = await db.prepare(`
      SELECT DISTINCT d.specialty as name, COUNT(*) as doctor_count
      FROM doctors d
      WHERE d.tenant_id = ? AND d.is_active = 1 AND d.is_marketplace_visible = 1
      GROUP BY d.specialty
    `).bind(tenantId).all();

    const departments = (deptRows || []).map((r: any) => ({
      name: r.name,
      doctor_count: r.doctor_count,
    }));

    // Doctors
    const { results: doctorRows } = await db.prepare(`
      SELECT d.id, d.name, d.specialty, d.qualifications, d.consultation_fee,
             d.public_bio, d.languages, d.profile_photo_key, d.bmdc_reg_no,
             COALESCE(AVG(r.rating), 0) AS avg_rating,
             COUNT(r.id) AS review_count
      FROM doctors d
      LEFT JOIN provider_reviews r
        ON r.target_doctor_id = d.id AND r.target_type = 'doctor' AND r.is_approved = 1
      WHERE d.tenant_id = ? AND d.is_active = 1 AND d.is_marketplace_visible = 1
      GROUP BY d.id
      ORDER BY avg_rating DESC
    `).bind(tenantId).all();

    const doctors = (doctorRows || []).map((r: any) => ({
      id: String(r.id),
      name: r.name,
      specialty: r.specialty,
      qualifications: r.qualifications,
      consultation_fee: r.consultation_fee,
      public_bio: r.public_bio,
      languages: r.languages ? JSON.parse(r.languages) : [],
      profile_photo_key: r.profile_photo_key,
      bmdc_reg_no: r.bmdc_reg_no,
      rating: r.avg_rating ? Math.round(Number(r.avg_rating) * 10) / 10 : null,
      review_count: r.review_count,
    }));

    return c.json({
      hospital: {
        id: String(hospital.id),
        name: hospital.name,
        tenant_type: hospital.tenant_type,
        address: hospital.address,
        specialties: hospital.specialties ? JSON.parse(hospital.specialties as string) : [],
        latitude: hospital.latitude,
        longitude: hospital.longitude,
        operating_hours: hospital.operating_hours,
        photos: hospital.public_photos ? JSON.parse(hospital.public_photos as string) : [],
        phone: hospital.phone,
        email: hospital.email,
        website: hospital.website,
        rating: hospital.avg_rating ? Math.round(Number(hospital.avg_rating) * 10) / 10 : null,
        review_count: hospital.review_count,
      },
      departments,
      doctors,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('[public-hospitals] detail error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch hospital' });
  }
});

export default publicHospitalRoutes;

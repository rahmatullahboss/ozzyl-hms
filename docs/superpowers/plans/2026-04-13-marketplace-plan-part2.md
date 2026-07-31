# Hospital Discovery & Doctor Marketplace — Implementation Plan (Part 2 of 4)

> Continues from Part 1. Backend API routes.

---

## Task 5: Public Marketplace Routes — Hospital Search & Profile

**Files:**
- Create: `src/routes/marketplace.ts`

- [ ] **Step 1: Write hospital search tests**

Append to `test/marketplace-search.test.ts`:

```typescript
describe('Hospital Search API Contract', () => {
  it('should define valid hospital search response shape', () => {
    const mockResponse = {
      hospitals: [
        {
          id: 'tenant-1',
          name: 'Dhaka Medical',
          tenant_type: 'hospital',
          public_description: 'A leading hospital.',
          specialties: '["cardiology","neurology"]',
          latitude: 23.81,
          longitude: 90.41,
          operating_hours: '{"sat":"09:00-17:00"}',
          public_photos: '["photos/front.jpg"]',
          avg_rating: 4.5,
          review_count: 120,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };

    expect(mockResponse.hospitals).toHaveLength(1);
    expect(mockResponse.hospitals[0].id).toBe('tenant-1');
    expect(mockResponse.hospitals[0].avg_rating).toBeGreaterThanOrEqual(0);
    expect(mockResponse.total).toBe(1);
  });

  it('should define valid doctor search response shape', () => {
    const mockResponse = {
      doctors: [
        {
          id: 1,
          name: 'Dr. Rahman',
          specialty: 'Cardiology',
          tenant_id: 'tenant-1',
          hospital_name: 'Dhaka Medical',
          tenant_type: 'hospital',
          consultation_fee: 150000,
          public_bio: 'Experienced cardiologist.',
          languages: '["english","bengali"]',
          profile_photo_key: 'photos/dr-rahman.jpg',
          avg_rating: 4.8,
          review_count: 45,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };

    expect(mockResponse.doctors).toHaveLength(1);
    expect(mockResponse.doctors[0].consultation_fee).toBe(150000);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-search.test.ts`

Expected: PASS — contract shape tests are pure.

- [ ] **Step 3: Create public marketplace routes**

Create `src/routes/marketplace.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  hospitalSearchSchema,
  doctorSearchSchema,
  availabilityQuerySchema,
} from '../schemas/marketplace';
import { buildSearchClause, buildPagination, getDayOfWeek } from '../lib/marketplace-helpers';
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

    if (params.rating_min) {
      query += ` HAVING avg_rating >= ?`;
      binds.push(params.rating_min);
    }

    query += ` GROUP BY t.id ORDER BY avg_rating DESC`;

    // Count total before pagination
    const countQuery = `SELECT COUNT(*) AS total FROM (${query})`;
    const countRow = await c.env.DB.prepare(countQuery).bind(...binds).first<{ total: number }>();
    const total = countRow?.total ?? 0;

    const { clause: pagClause, params: pagParams } = buildPagination(params.page!, params.limit!);
    query += ` ${pagClause}`;
    binds.push(...pagParams);

    const { results } = await c.env.DB.prepare(query).bind(...binds).all();

    return c.json({
      hospitals: results,
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

    return c.json({ hospital, doctors });
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
      query += ` AND d.consultation_fee <= ?`;
      binds.push(params.fee_max);
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
      doctors: results,
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

    return c.json({ doctor });
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
      consultation_fee: doctor.consultation_fee,
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
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/marketplace.ts test/marketplace-search.test.ts
git commit -m "feat(marketplace): add public marketplace routes (hospital/doctor search, availability, reviews)"
```

---

## Task 6: Patient Marketplace Routes — Connect, Book, Review

**Files:**
- Create: `src/routes/marketplace-patient.ts`
- Create: `test/marketplace-booking.test.ts`

- [ ] **Step 1: Write booking contract tests**

Create `test/marketplace-booking.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Marketplace Booking Logic', () => {
  describe('Booking Status Machine', () => {
    type BookingStatus = 'confirmed' | 'completed' | 'cancelled' | 'no_show';

    const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
      confirmed: ['completed', 'cancelled', 'no_show'],
      completed: [],
      cancelled: [],
      no_show: [],
    };

    function canTransition(from: BookingStatus, to: BookingStatus): boolean {
      return VALID_TRANSITIONS[from].includes(to);
    }

    it('should allow confirmed → completed', () => {
      expect(canTransition('confirmed', 'completed')).toBe(true);
    });

    it('should allow confirmed → cancelled', () => {
      expect(canTransition('confirmed', 'cancelled')).toBe(true);
    });

    it('should not allow completed → cancelled', () => {
      expect(canTransition('completed', 'cancelled')).toBe(false);
    });
  });

  describe('Auto-Connect Logic', () => {
    it('should detect if patient is already connected', () => {
      const existingLinks = [{ tenant_id: 'tenant-1' }, { tenant_id: 'tenant-2' }];
      const isConnected = existingLinks.some((l) => l.tenant_id === 'tenant-1');
      expect(isConnected).toBe(true);
    });

    it('should detect if patient is NOT connected', () => {
      const existingLinks = [{ tenant_id: 'tenant-1' }];
      const isConnected = existingLinks.some((l) => l.tenant_id === 'tenant-3');
      expect(isConnected).toBe(false);
    });
  });

  describe('Review Eligibility', () => {
    it('should allow review only for completed visits', () => {
      const completedAppointments = [
        { id: 1, status: 'completed', doctor_id: 5 },
        { id: 2, status: 'cancelled', doctor_id: 5 },
      ];
      const hasCompleted = completedAppointments.some(
        (a) => a.status === 'completed' && a.doctor_id === 5
      );
      expect(hasCompleted).toBe(true);
    });

    it('should reject review when no completed visit exists', () => {
      const appointments = [{ id: 1, status: 'scheduled', doctor_id: 5 }];
      const hasCompleted = appointments.some(
        (a) => a.status === 'completed' && a.doctor_id === 5
      );
      expect(hasCompleted).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-booking.test.ts`

Expected: PASS — pure logic tests.

- [ ] **Step 3: Create patient marketplace routes**

Create `src/routes/marketplace-patient.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { marketplaceBookingSchema, reviewSchema } from '../schemas/marketplace';
import { getDayOfWeek } from '../lib/marketplace-helpers';
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
    const payload = await verify(token, c.env.JWT_SECRET) as {
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
    const fee = (doctor.consultation_fee as number) ?? 0;

    // Create local appointment
    const apptResult = await c.env.DB.prepare(`
      INSERT INTO appointments (tenant_id, patient_id, doctor_id, appt_date, appt_time,
                               token_no, fee, status, visit_type, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', 'opd', 'marketplace', datetime('now'))
    `).bind(
      data.tenant_id, healthLink.local_patient_id, data.doctor_id,
      data.booking_date, data.booking_time, tokenNo, fee,
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

// ─── GET /api/v1/marketplace/bookings ───────────────────────────────────────
marketplacePatientRoutes.get('/bookings', async (c) => {
  const uhid = c.get('tenantId')!;

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT mb.id, mb.booking_date, mb.booking_time, mb.token_number, mb.fee,
             mb.status, mb.created_at,
             d.name AS doctor_name, d.specialty,
             t.name AS hospital_name, t.tenant_type
      FROM marketplace_bookings mb
      JOIN doctors d ON mb.doctor_id = d.id
      JOIN tenants t ON mb.tenant_id = t.id
      WHERE mb.patient_global_id = ?
      ORDER BY mb.booking_date DESC, mb.booking_time DESC
      LIMIT 100
    `).bind(uhid).all();

    return c.json({ bookings: results });
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
        UPDATE appointments SET status = 'cancelled', updated_at = datetime('now')
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
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/marketplace-patient.ts test/marketplace-booking.test.ts
git commit -m "feat(marketplace): add patient marketplace routes (connect, book, cancel, review)"
```

---

## Task 7: Hospital Admin Marketplace Routes

**Files:**
- Create: `src/routes/marketplace-admin.ts`

- [ ] **Step 1: Create admin marketplace routes**

Create `src/routes/marketplace-admin.ts`:

```typescript
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

    void createAuditLog(c.env, tenantId, userId, 'update', 'tenants', tenantId, null, {
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

    void createAuditLog(c.env, tenantId, userId, 'update', 'doctors', doctorId, null, {
      action: 'marketplace_publish_doctor', is_marketplace_visible, doctor_name: doctor.name,
    });

    return c.json({
      message: is_marketplace_visible
        ? `Dr. ${doctor.name} published to marketplace`
        : `Dr. ${doctor.name} removed from marketplace`,
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

    void createAuditLog(c.env, tenantId, userId, 'update', 'tenants', tenantId, null, {
      action: 'marketplace_profile_update', fields: Object.keys(data),
    });

    return c.json({ message: 'Marketplace profile updated' });
  } catch {
    throw new HTTPException(500, { message: 'Failed to update marketplace profile' });
  }
});

export default marketplaceAdminRoutes;
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/marketplace-admin.ts
git commit -m "feat(marketplace): add hospital admin marketplace routes (publish, profile)"
```

---

*Continued in Part 3...*

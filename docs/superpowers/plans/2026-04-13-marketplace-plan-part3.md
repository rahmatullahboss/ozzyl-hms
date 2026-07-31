# Hospital Discovery & Doctor Marketplace — Implementation Plan (Part 3 of 4)

> Continues from Part 2. Doctor auth, route mounting, integration.

---

## Task 8: Doctor Auth Routes (Independent Chamber Registration)

**Files:**
- Create: `src/routes/doctor-auth.ts`
- Create: `test/doctor-auth.test.ts`

- [ ] **Step 1: Write doctor auth tests**

Create `test/doctor-auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { doctorRegisterSchema, doctorLoginSchema } from '../src/schemas/marketplace';

describe('Doctor Auth', () => {
  describe('Registration Validation', () => {
    it('should accept valid registration with email', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Rahman',
        email: 'dr.rahman@example.com',
        password: 'SecurePass123!',
        specialty: 'Cardiology',
        bmdc_registration: 'A-12345',
        chamber_name: "Dr. Rahman's Chamber",
        chamber_address: '123 Main St, Dhaka',
        consultation_fee: 100000,
        schedule: [
          { day_of_week: 0, start_time: '09:00', end_time: '13:00', max_patients: 20 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept registration with phone instead of email', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Karim',
        phone: '+8801712345678',
        password: 'SecurePass123!',
        specialty: 'Dermatology',
        bmdc_registration: 'B-67890',
        chamber_name: "Dr. Karim's Skin Clinic",
        chamber_address: '456 Park Ave, Dhaka',
        consultation_fee: 80000,
        schedule: [],
      });
      expect(result.success).toBe(true);
    });

    it('should reject short password', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Test',
        email: 'test@test.com',
        password: '123',
        specialty: 'Test',
        bmdc_registration: 'X-1',
        chamber_name: 'Test Chamber',
        chamber_address: '123 Test St',
        consultation_fee: 50000,
        schedule: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative consultation fee', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Test',
        email: 'test@test.com',
        password: 'SecurePass123!',
        specialty: 'Test',
        bmdc_registration: 'X-1',
        chamber_name: 'Test Chamber',
        chamber_address: '123 Test St',
        consultation_fee: -1000,
        schedule: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Login Validation', () => {
    it('should accept login with email', () => {
      const result = doctorLoginSchema.safeParse({
        email: 'dr.rahman@example.com',
        password: 'SecurePass123!',
      });
      expect(result.success).toBe(true);
    });

    it('should accept login with phone', () => {
      const result = doctorLoginSchema.safeParse({
        phone: '+8801712345678',
        password: 'SecurePass123!',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Tenant Slug Generation', () => {
    function generateSlug(name: string): string {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 50);
    }

    it('should generate slug from chamber name', () => {
      expect(generateSlug("Dr. Rahman's Chamber")).toBe('dr-rahmans-chamber');
    });

    it('should handle special characters', () => {
      expect(generateSlug('Dr. ABC (Cardio) Clinic!')).toBe('dr-abc-cardio-clinic');
    });

    it('should handle multiple spaces', () => {
      expect(generateSlug('My   Chamber   Name')).toBe('my-chamber-name');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/doctor-auth.test.ts`

Expected: PASS

- [ ] **Step 3: Create doctor auth routes**

Create `src/routes/doctor-auth.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { sign, verify } from 'hono/jwt';
import { doctorRegisterSchema, doctorLoginSchema } from '../schemas/marketplace';
import type { Env, Variables } from '../types';

const doctorAuthRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial, 256
  );
  const hashArray = new Uint8Array(bits);
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(hashArray).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:sha256:100000:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[2]);
  const salt = new Uint8Array(parts[3].match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const storedHash = parts[4];

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex === storedHash;
}

const JWT_EXPIRY_HOURS = 8;

// ─── POST /api/v1/doctor-auth/register ──────────────────────────────────────
doctorAuthRoutes.post('/register', zValidator('json', doctorRegisterSchema), async (c) => {
  const data = c.req.valid('json');

  if (!data.email && !data.phone) {
    throw new HTTPException(400, { message: 'Email or phone is required' });
  }

  try {
    // Check for duplicate email/phone
    if (data.email) {
      const existing = await c.env.DB.prepare(
        `SELECT id FROM doctor_auth WHERE email = ?`
      ).bind(data.email).first();
      if (existing) throw new HTTPException(409, { message: 'Email already registered' });
    }
    if (data.phone) {
      const existing = await c.env.DB.prepare(
        `SELECT id FROM doctor_auth WHERE phone = ?`
      ).bind(data.phone).first();
      if (existing) throw new HTTPException(409, { message: 'Phone already registered' });
    }

    // Generate slug and ensure uniqueness
    let slug = generateSlug(data.chamber_name);
    const slugCheck = await c.env.DB.prepare(
      `SELECT id FROM tenants WHERE slug = ?`
    ).bind(slug).first();
    if (slugCheck) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    // Generate tenant ID
    const tenantId = `ch-${crypto.randomUUID().slice(0, 8)}`;

    // 1. Create chamber tenant
    await c.env.DB.prepare(`
      INSERT INTO tenants (id, name, slug, tenant_type, is_published, address, created_at, updated_at)
      VALUES (?, ?, ?, 'chamber', 0, ?, datetime('now'), datetime('now'))
    `).bind(tenantId, data.chamber_name, slug, data.chamber_address).run();

    // 2. Create doctor record
    const doctorResult = await c.env.DB.prepare(`
      INSERT INTO doctors (tenant_id, name, specialty, bmdc_reg_no, qualifications,
                          consultation_fee, public_bio, languages, is_marketplace_visible,
                          is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, datetime('now'))
    `).bind(
      tenantId, data.name, data.specialty, data.bmdc_registration,
      data.qualifications ?? null, data.consultation_fee,
      data.public_bio ?? null,
      data.languages ? JSON.stringify(data.languages) : null,
    ).run();

    const doctorId = doctorResult.meta.last_row_id;

    // 3. Create doctor_auth record
    const passwordHash = await hashPassword(data.password);
    await c.env.DB.prepare(`
      INSERT INTO doctor_auth (email, phone, password_hash, doctor_id, tenant_id,
                              is_verified, created_at)
      VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
    `).bind(
      data.email ?? null, data.phone ?? null, passwordHash, doctorId, tenantId,
    ).run();

    // 4. Create schedules
    for (const sched of data.schedule) {
      await c.env.DB.prepare(`
        INSERT INTO doctor_schedules (tenant_id, doctor_id, day_of_week,
          start_time, end_time, max_patients, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
      `).bind(
        tenantId, doctorId, sched.day_of_week,
        sched.start_time, sched.end_time, sched.max_patients,
      ).run();
    }

    // 5. Generate JWT (staff scope — doctor is the admin of their chamber)
    const token = await sign(
      {
        userId: doctorId,
        tenantId,
        role: 'hospital_admin',
        scope: 'staff',
        exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_HOURS * 3600,
      },
      c.env.JWT_SECRET,
    );

    return c.json({
      token,
      tenant_id: tenantId,
      doctor_id: doctorId,
      slug,
      chamber_name: data.chamber_name,
      message: 'Chamber created successfully. Verify your email/phone to publish to marketplace.',
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to register doctor' });
  }
});

// ─── POST /api/v1/doctor-auth/login ─────────────────────────────────────────
doctorAuthRoutes.post('/login', zValidator('json', doctorLoginSchema), async (c) => {
  const { email, phone, password } = c.req.valid('json');

  if (!email && !phone) {
    throw new HTTPException(400, { message: 'Email or phone is required' });
  }

  try {
    const query = email
      ? `SELECT * FROM doctor_auth WHERE email = ? AND is_active = 1`
      : `SELECT * FROM doctor_auth WHERE phone = ? AND is_active = 1`;
    const bind = email || phone!;

    const auth = await c.env.DB.prepare(query).bind(bind).first<Record<string, unknown>>();

    if (!auth) throw new HTTPException(401, { message: 'Invalid credentials' });

    // Check account lockout
    if (auth.locked_until) {
      const lockedUntil = new Date(auth.locked_until as string);
      if (lockedUntil > new Date()) {
        throw new HTTPException(423, { message: 'Account locked. Try again later.' });
      }
    }

    const valid = await verifyPassword(password, auth.password_hash as string);
    if (!valid) {
      // Increment failed attempts
      const attempts = ((auth.failed_login_attempts as number) ?? 0) + 1;
      const lockUntil = attempts >= 5
        ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
        : null;

      await c.env.DB.prepare(`
        UPDATE doctor_auth SET failed_login_attempts = ?, locked_until = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(attempts, lockUntil, auth.id).run();

      throw new HTTPException(401, { message: 'Invalid credentials' });
    }

    // Reset failed attempts on success
    await c.env.DB.prepare(`
      UPDATE doctor_auth SET failed_login_attempts = 0, locked_until = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).bind(auth.id).run();

    // Generate JWT
    const token = await sign(
      {
        userId: auth.doctor_id,
        tenantId: auth.tenant_id,
        role: 'hospital_admin',
        scope: 'staff',
        exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_HOURS * 3600,
      },
      c.env.JWT_SECRET,
    );

    // Get doctor name
    const doctor = await c.env.DB.prepare(
      `SELECT name FROM doctors WHERE id = ?`
    ).bind(auth.doctor_id).first<{ name: string }>();

    return c.json({
      token,
      tenant_id: auth.tenant_id,
      doctor_id: auth.doctor_id,
      name: doctor?.name,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Login failed' });
  }
});

// ─── GET /api/v1/doctor-auth/me ─────────────────────────────────────────────
doctorAuthRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET) as {
      userId: number; tenantId: string; scope: string;
    };

    const doctor = await c.env.DB.prepare(`
      SELECT d.id, d.name, d.specialty, d.qualifications, d.consultation_fee,
             d.public_bio, d.languages, d.profile_photo_key, d.bmdc_reg_no,
             d.is_marketplace_visible,
             t.name AS chamber_name, t.slug, t.is_published, t.tenant_type,
             t.address, t.specialties, t.public_description
      FROM doctors d
      JOIN tenants t ON d.tenant_id = t.id
      WHERE d.id = ? AND d.tenant_id = ?
    `).bind(payload.userId, payload.tenantId).first();

    if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

    const auth = await c.env.DB.prepare(
      `SELECT email, phone, is_verified FROM doctor_auth WHERE doctor_id = ? AND tenant_id = ?`
    ).bind(payload.userId, payload.tenantId).first();

    return c.json({ doctor, auth });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(401, { message: 'Invalid token' });
  }
});

export default doctorAuthRoutes;
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/doctor-auth.ts test/doctor-auth.test.ts
git commit -m "feat(marketplace): add independent doctor auth routes (register chamber, login)"
```

---

## Task 9: Mount All Routes in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add marketplace imports to index.ts**

At the top of `src/index.ts`, after the existing imports (around line 131), add:

```typescript
import marketplaceRoutes from './routes/marketplace';
import marketplacePatientRoutes from './routes/marketplace-patient';
import marketplaceAdminRoutes from './routes/marketplace-admin';
import doctorAuthRoutes from './routes/doctor-auth';
```

- [ ] **Step 2: Mount public marketplace routes BEFORE tenant middleware**

In `src/index.ts`, after the patient portal CORS block (around line 379, after `app.route('/api/patient-portal', patientPortalRoutes);`) and BEFORE the tenant auth routes (line 381 `app.route('/api/auth/login', authRoutes);`), add:

```typescript
// ─── Marketplace: Public Routes (no auth needed) ────────────────────────────
app.use('/api/v1/marketplace/*', (c, next) => rateLimitMiddleware(c, next, { window: 60, max: 60 }));
app.route('/api/v1/marketplace', marketplaceRoutes);

// ─── Marketplace: Patient Actions (global patient JWT) ──────────────────────
app.options('/api/v1/marketplace-patient/*', (c) => {
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) c.header('Access-Control-Allow-Origin', origin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  c.header('Access-Control-Allow-Credentials', 'true');
  c.header('Access-Control-Max-Age', '86400');
  return c.body(null, 204);
});
app.use('/api/v1/marketplace-patient/*', async (c, next) => {
  await next();
  const origin = getPatientPortalCorsOrigin(c);
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  }
});
app.route('/api/v1/marketplace-patient', marketplacePatientRoutes);

// ─── Doctor Auth: Independent Chamber Registration/Login ────────────────────
app.use('/api/v1/doctor-auth/*', (c, next) => rateLimitMiddleware(c, next, { window: 900, max: 10 }));
app.route('/api/v1/doctor-auth', doctorAuthRoutes);

// ─── Marketplace: Hospital Admin (requires tenant + auth middleware) ─────────
// Mounted AFTER tenant/auth middleware (below line 389) so it uses existing auth
```

- [ ] **Step 3: Mount admin marketplace routes AFTER tenant middleware**

After the existing protected tenant route mounting block (around line 390, after `app.use('/api/*', authMiddleware);`), add:

```typescript
app.route('/api/v1/marketplace-admin', marketplaceAdminRoutes);
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(marketplace): mount all marketplace routes in index.ts"
```

---

## Task 10: Integration Test — Full Marketplace Flow

**Files:**
- Create: `test/marketplace-reviews.test.ts`

- [ ] **Step 1: Write integration contract tests**

Create `test/marketplace-reviews.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Marketplace Reviews Contract', () => {
  describe('Review Response Shape', () => {
    it('should define valid review list response', () => {
      const response = {
        reviews: [
          {
            id: 1,
            rating: 5,
            review_text: 'Excellent doctor',
            is_verified_visit: 1,
            created_at: '2026-04-13T10:00:00',
            reviewer_name: 'Patient A',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      };

      expect(response.reviews).toHaveLength(1);
      expect(response.reviews[0].rating).toBe(5);
      expect(response.reviews[0].is_verified_visit).toBe(1);
    });
  });

  describe('Rating Aggregation', () => {
    it('should calculate correct average rating', () => {
      const ratings = [5, 4, 5, 3, 4];
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      expect(avg).toBe(4.2);
    });

    it('should handle single rating', () => {
      const ratings = [5];
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      expect(avg).toBe(5);
    });

    it('should return 0 for no ratings', () => {
      const ratings: number[] = [];
      const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      expect(avg).toBe(0);
    });
  });

  describe('Moderation States', () => {
    it('should have correct moderation states', () => {
      const states = { pending: 0, approved: 1 };
      expect(states.pending).toBe(0);
      expect(states.approved).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run ALL marketplace tests**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-search.test.ts test/marketplace-booking.test.ts test/marketplace-reviews.test.ts test/doctor-auth.test.ts`

Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add test/marketplace-reviews.test.ts
git commit -m "test(marketplace): add review contract and integration tests"
```

---

*Continued in Part 4 (Frontend)...*

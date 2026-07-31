# Hospital Discovery & Doctor Marketplace — Implementation Plan (Part 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public marketplace layer for hospital/doctor discovery, independent doctor chambers, and direct booking — all on top of the existing HMS multi-tenant system.

**Architecture:** Marketplace-as-a-View-Layer. No data duplication. Visibility flags on existing tables (`is_published`, `is_marketplace_visible`). Three new tables: `marketplace_bookings`, `provider_reviews`, `doctor_auth`. Public routes under `/api/v1/marketplace/*`, doctor auth under `/api/v1/doctor-auth/*`.

**Tech Stack:** Hono + Cloudflare Workers + D1 (SQLite) + React 19 + Tailwind CSS + Zod + Vitest

**Spec:** `docs/superpowers/specs/2026-04-13-marketplace-design.md`

---

## File Structure

### Backend — New Files

```
src/routes/marketplace.ts              -- Public marketplace routes (hospital/doctor search)
src/routes/marketplace-patient.ts      -- Patient-auth marketplace routes (connect, book, review)
src/routes/marketplace-admin.ts        -- Hospital admin marketplace routes (publish, profile)
src/routes/doctor-auth.ts              -- Independent doctor registration/login
src/schemas/marketplace.ts             -- Zod schemas for all marketplace endpoints
src/lib/marketplace-helpers.ts         -- Search query builders, rating aggregation, geo helpers
```

### Backend — Modified Files

```
src/index.ts                           -- Mount new routes (before tenant middleware)
```

### Database — New Migrations

```
migrations/0118_marketplace_tenant_columns.sql    -- Add columns to tenants table
migrations/0119_marketplace_doctor_columns.sql    -- Add columns to doctors table
migrations/0120_marketplace_bookings.sql          -- New marketplace_bookings table
migrations/0121_provider_reviews.sql              -- New provider_reviews table
migrations/0122_doctor_auth.sql                   -- New doctor_auth table
migrations/0123_marketplace_indexes.sql           -- Search indexes
```

### Tests — New Files

```
test/marketplace-search.test.ts        -- Public search/browse tests
test/marketplace-booking.test.ts       -- Booking + connect tests
test/marketplace-reviews.test.ts       -- Review submission tests
test/doctor-auth.test.ts               -- Doctor registration/login tests
```

### Frontend — New Files

```
web/src/pages/MarketplaceLanding.tsx           -- /marketplace
web/src/pages/HospitalDirectory.tsx            -- /marketplace/hospitals
web/src/pages/HospitalProfile.tsx              -- /marketplace/hospitals/:id
web/src/pages/DoctorDirectory.tsx              -- /marketplace/doctors
web/src/pages/DoctorProfile.tsx                -- /marketplace/doctors/:id
web/src/pages/DoctorRegister.tsx               -- /doctor/register
web/src/pages/DoctorLogin.tsx                  -- /doctor/login
web/src/components/marketplace/HospitalCard.tsx
web/src/components/marketplace/DoctorCard.tsx
web/src/components/marketplace/SearchFilters.tsx
web/src/components/marketplace/AvailabilityCalendar.tsx
web/src/components/marketplace/BookingModal.tsx
web/src/components/marketplace/ReviewSection.tsx
web/src/components/marketplace/StarRating.tsx
web/src/components/patient/PatientFindCareTab.tsx  -- New dashboard tab
```

### Frontend — Modified Files

```
web/src/App.tsx                                -- Add marketplace routes
web/src/pages/PatientDashboardPage.tsx         -- Add "Find Care" tab
web/src/components/DashboardLayout.tsx         -- Chamber sidebar layout
```

---

## Task 1: Database Migrations — Tenant & Doctor Marketplace Columns

**Files:**
- Create: `migrations/0118_marketplace_tenant_columns.sql`
- Create: `migrations/0119_marketplace_doctor_columns.sql`
- Test: `test/marketplace-search.test.ts`

- [ ] **Step 1: Write test for tenant marketplace columns**

Create `test/marketplace-search.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Marketplace Schema Validation', () => {
  describe('Tenant Marketplace Fields', () => {
    const VALID_TENANT_TYPES = ['hospital', 'chamber'] as const;
    type TenantType = typeof VALID_TENANT_TYPES[number];

    function isValidTenantType(t: string): t is TenantType {
      return (VALID_TENANT_TYPES as readonly string[]).includes(t);
    }

    it('should accept hospital as valid tenant type', () => {
      expect(isValidTenantType('hospital')).toBe(true);
    });

    it('should accept chamber as valid tenant type', () => {
      expect(isValidTenantType('chamber')).toBe(true);
    });

    it('should reject unknown tenant type', () => {
      expect(isValidTenantType('clinic')).toBe(false);
    });

    it('should validate specialties as JSON array', () => {
      const raw = '["cardiology","dermatology","pediatrics"]';
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toContain('cardiology');
    });

    it('should validate operating hours as JSON object', () => {
      const raw = '{"sat":"09:00-17:00","sun":"09:00-17:00","mon":"09:00-17:00","tue":"09:00-17:00","wed":"09:00-17:00","thu":"09:00-14:00","fri":"closed"}';
      const parsed = JSON.parse(raw);
      expect(parsed.sat).toBe('09:00-17:00');
      expect(parsed.fri).toBe('closed');
    });

    it('should validate latitude/longitude as numbers', () => {
      const lat = 23.8103;
      const lng = 90.4125;
      expect(typeof lat).toBe('number');
      expect(typeof lng).toBe('number');
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
    });
  });

  describe('Doctor Marketplace Fields', () => {
    it('should validate languages as JSON array', () => {
      const raw = '["english","bengali"]';
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toContain('bengali');
    });

    it('should validate bio as optional text', () => {
      const bio: string | null = 'Experienced cardiologist with 15 years of practice.';
      expect(typeof bio).toBe('string');
      expect(bio!.length).toBeGreaterThan(0);
    });

    it('should allow null bio', () => {
      const bio: string | null = null;
      expect(bio).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-search.test.ts`

Expected: PASS — these are pure validation tests, no DB needed.

- [ ] **Step 3: Create tenant marketplace columns migration**

Create `migrations/0118_marketplace_tenant_columns.sql`:

```sql
-- Add marketplace visibility and public profile fields to tenants table
ALTER TABLE tenants ADD COLUMN tenant_type TEXT NOT NULL DEFAULT 'hospital';
ALTER TABLE tenants ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN public_description TEXT;
ALTER TABLE tenants ADD COLUMN public_photos TEXT;
ALTER TABLE tenants ADD COLUMN specialties TEXT;
ALTER TABLE tenants ADD COLUMN latitude REAL;
ALTER TABLE tenants ADD COLUMN longitude REAL;
ALTER TABLE tenants ADD COLUMN operating_hours TEXT;
```

- [ ] **Step 4: Create doctor marketplace columns migration**

Create `migrations/0119_marketplace_doctor_columns.sql`:

```sql
-- Add marketplace visibility and public profile fields to doctors table
ALTER TABLE doctors ADD COLUMN is_marketplace_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE doctors ADD COLUMN public_bio TEXT;
ALTER TABLE doctors ADD COLUMN languages TEXT;
ALTER TABLE doctors ADD COLUMN profile_photo_key TEXT;
```

- [ ] **Step 5: Apply migrations locally**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx wrangler d1 migrations apply hms-super-admin-production --local`

Expected: Migrations 0118 and 0119 applied successfully.

- [ ] **Step 6: Commit**

```bash
git add migrations/0118_marketplace_tenant_columns.sql migrations/0119_marketplace_doctor_columns.sql test/marketplace-search.test.ts
git commit -m "feat(marketplace): add tenant/doctor marketplace columns and schema tests"
```

---

## Task 2: Database Migrations — New Tables

**Files:**
- Create: `migrations/0120_marketplace_bookings.sql`
- Create: `migrations/0121_provider_reviews.sql`
- Create: `migrations/0122_doctor_auth.sql`
- Create: `migrations/0123_marketplace_indexes.sql`

- [ ] **Step 1: Create marketplace_bookings migration**

Create `migrations/0120_marketplace_bookings.sql`:

```sql
-- Marketplace bookings: bridges marketplace booking requests to local tenant appointments
CREATE TABLE marketplace_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_global_id TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  booking_time TEXT NOT NULL,
  token_number INTEGER,
  fee INTEGER,
  status TEXT NOT NULL DEFAULT 'confirmed',
  local_appointment_id INTEGER,
  cancellation_reason TEXT,
  source TEXT DEFAULT 'marketplace',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_marketplace_bookings_patient ON marketplace_bookings(patient_global_id);
CREATE INDEX idx_marketplace_bookings_doctor ON marketplace_bookings(doctor_id, tenant_id);
CREATE INDEX idx_marketplace_bookings_date ON marketplace_bookings(booking_date);
CREATE INDEX idx_marketplace_bookings_status ON marketplace_bookings(status);
```

- [ ] **Step 2: Create provider_reviews migration**

Create `migrations/0121_provider_reviews.sql`:

```sql
-- Provider reviews: ratings for both doctors and hospitals
CREATE TABLE provider_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reviewer_global_patient_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_tenant_id TEXT NOT NULL,
  target_doctor_id INTEGER,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  is_verified_visit INTEGER DEFAULT 0,
  is_approved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_provider_reviews_target ON provider_reviews(target_type, target_tenant_id);
CREATE INDEX idx_provider_reviews_doctor ON provider_reviews(target_doctor_id);
CREATE INDEX idx_provider_reviews_reviewer ON provider_reviews(reviewer_global_patient_id);
```

- [ ] **Step 3: Create doctor_auth migration**

Create `migrations/0122_doctor_auth.sql`:

```sql
-- Doctor auth: authentication for independent doctors who register their own chamber
CREATE TABLE doctor_auth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  doctor_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  is_verified INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_doctor_auth_email ON doctor_auth(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_doctor_auth_phone ON doctor_auth(phone) WHERE phone IS NOT NULL;
```

- [ ] **Step 4: Create marketplace search indexes migration**

Create `migrations/0123_marketplace_indexes.sql`:

```sql
-- Indexes for fast marketplace search queries on existing tables
CREATE INDEX idx_tenants_marketplace ON tenants(is_published, tenant_type);
CREATE INDEX idx_tenants_location ON tenants(latitude, longitude) WHERE is_published = 1;
CREATE INDEX idx_doctors_marketplace ON doctors(is_marketplace_visible, tenant_id);
CREATE INDEX idx_doctors_specialty_marketplace ON doctors(specialty, is_marketplace_visible);
```

- [ ] **Step 5: Apply migrations locally**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx wrangler d1 migrations apply hms-super-admin-production --local`

Expected: Migrations 0120–0123 applied successfully.

- [ ] **Step 6: Commit**

```bash
git add migrations/0120_marketplace_bookings.sql migrations/0121_provider_reviews.sql migrations/0122_doctor_auth.sql migrations/0123_marketplace_indexes.sql
git commit -m "feat(marketplace): add marketplace_bookings, provider_reviews, doctor_auth tables"
```

---

## Task 3: Zod Schemas

**Files:**
- Create: `src/schemas/marketplace.ts`
- Test: `test/marketplace-search.test.ts` (extend)

- [ ] **Step 1: Write Zod schema tests**

Append to `test/marketplace-search.test.ts`:

```typescript
import {
  hospitalSearchSchema,
  doctorSearchSchema,
  marketplaceBookingSchema,
  reviewSchema,
  doctorRegisterSchema,
  publishHospitalSchema,
  publishDoctorSchema,
  updateHospitalProfileSchema,
} from '../src/schemas/marketplace';

describe('Marketplace Zod Schemas', () => {
  describe('hospitalSearchSchema', () => {
    it('should accept valid search params', () => {
      const result = hospitalSearchSchema.safeParse({
        q: 'cardiology',
        page: '1',
        limit: '20',
      });
      expect(result.success).toBe(true);
    });

    it('should default page to 1 and limit to 20', () => {
      const result = hospitalSearchSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });

    it('should cap limit at 50', () => {
      const result = hospitalSearchSchema.safeParse({ limit: '100' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
      }
    });
  });

  describe('doctorSearchSchema', () => {
    it('should accept valid doctor search', () => {
      const result = doctorSearchSchema.safeParse({
        specialty: 'cardiology',
        language: 'bengali',
        fee_max: '200000',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('marketplaceBookingSchema', () => {
    it('should accept valid booking', () => {
      const result = marketplaceBookingSchema.safeParse({
        doctor_id: 1,
        tenant_id: 'tenant-abc',
        booking_date: '2026-04-20',
        booking_time: '10:00',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid date format', () => {
      const result = marketplaceBookingSchema.safeParse({
        doctor_id: 1,
        tenant_id: 'tenant-abc',
        booking_date: '20-04-2026',
        booking_time: '10:00',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('reviewSchema', () => {
    it('should accept valid hospital review', () => {
      const result = reviewSchema.safeParse({
        target_type: 'hospital',
        target_tenant_id: 'tenant-abc',
        rating: 5,
        review_text: 'Great hospital',
      });
      expect(result.success).toBe(true);
    });

    it('should require target_doctor_id for doctor reviews', () => {
      const result = reviewSchema.safeParse({
        target_type: 'doctor',
        target_tenant_id: 'tenant-abc',
        rating: 4,
      });
      // target_doctor_id is optional at schema level, validated in handler
      expect(result.success).toBe(true);
    });

    it('should reject rating above 5', () => {
      const result = reviewSchema.safeParse({
        target_type: 'hospital',
        target_tenant_id: 'tenant-abc',
        rating: 6,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('doctorRegisterSchema', () => {
    it('should accept valid doctor registration', () => {
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

    it('should require at least email or phone', () => {
      const result = doctorRegisterSchema.safeParse({
        name: 'Dr. Rahman',
        password: 'SecurePass123!',
        specialty: 'Cardiology',
        bmdc_registration: 'A-12345',
        chamber_name: "Dr. Rahman's Chamber",
        chamber_address: '123 Main St, Dhaka',
        consultation_fee: 100000,
        schedule: [],
      });
      // Both email and phone are optional at schema level — refined in handler
      expect(result.success).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-search.test.ts`

Expected: FAIL — imports from `../src/schemas/marketplace` do not exist yet.

- [ ] **Step 3: Create Zod schemas**

Create `src/schemas/marketplace.ts`:

```typescript
import { z } from 'zod';

// ─── Search Schemas (query params) ──────────────────────────────────────────

export const hospitalSearchSchema = z.object({
  q:           z.string().max(200).optional(),
  specialty:   z.string().max(100).optional(),
  lat:         z.string().transform(Number).pipe(z.number().min(-90).max(90)).optional(),
  lng:         z.string().transform(Number).pipe(z.number().min(-180).max(180)).optional(),
  radius:      z.string().transform(Number).pipe(z.number().int().min(1).max(500)).optional().default('20'),
  rating_min:  z.string().transform(Number).pipe(z.number().int().min(1).max(5)).optional(),
  type:        z.enum(['hospital', 'chamber']).optional(),
  page:        z.string().transform(Number).pipe(z.number().int().min(1)).optional().default('1'),
  limit:       z.string().transform(Number).pipe(z.number().int().min(1).max(50)).optional().default('20'),
});

export const doctorSearchSchema = z.object({
  q:              z.string().max(200).optional(),
  specialty:      z.string().max(100).optional(),
  hospital:       z.string().max(100).optional(),
  language:       z.string().max(50).optional(),
  available_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  fee_max:        z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
  rating_min:     z.string().transform(Number).pipe(z.number().int().min(1).max(5)).optional(),
  page:           z.string().transform(Number).pipe(z.number().int().min(1)).optional().default('1'),
  limit:          z.string().transform(Number).pipe(z.number().int().min(1).max(50)).optional().default('20'),
});

export const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

// ─── Action Schemas (JSON body) ─────────────────────────────────────────────

export const marketplaceBookingSchema = z.object({
  doctor_id:    z.number().int().positive(),
  tenant_id:    z.string().min(1),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  booking_time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
});

export const reviewSchema = z.object({
  target_type:      z.enum(['hospital', 'doctor']),
  target_tenant_id: z.string().min(1),
  target_doctor_id: z.number().int().positive().optional(),
  rating:           z.number().int().min(1).max(5),
  review_text:      z.string().max(2000).optional(),
});

export const publishHospitalSchema = z.object({
  is_published: z.boolean(),
});

export const publishDoctorSchema = z.object({
  is_marketplace_visible: z.boolean(),
});

export const updateHospitalProfileSchema = z.object({
  public_description: z.string().max(5000).optional(),
  public_photos:      z.array(z.string().max(500)).max(10).optional(),
  specialties:        z.array(z.string().max(100)).max(20).optional(),
  latitude:           z.number().min(-90).max(90).optional(),
  longitude:          z.number().min(-180).max(180).optional(),
  operating_hours:    z.record(z.string().max(50)).optional(),
});

// ─── Doctor Auth Schemas ────────────────────────────────────────────────────

const scheduleEntrySchema = z.object({
  day_of_week:  z.number().int().min(0).max(6),
  start_time:   z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  end_time:     z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  max_patients: z.number().int().min(1).max(200).default(20),
});

export const doctorRegisterSchema = z.object({
  name:               z.string().min(2).max(200),
  email:              z.string().email().optional(),
  phone:              z.string().min(6).max(20).optional(),
  password:           z.string().min(8).max(128),
  specialty:          z.string().min(2).max(100),
  bmdc_registration:  z.string().min(1).max(50),
  qualifications:     z.string().max(500).optional(),
  chamber_name:       z.string().min(2).max(200),
  chamber_address:    z.string().min(5).max(500),
  consultation_fee:   z.number().int().min(0),
  public_bio:         z.string().max(2000).optional(),
  languages:          z.array(z.string().max(50)).max(10).optional(),
  schedule:           z.array(scheduleEntrySchema).min(0).max(7),
});

export const doctorLoginSchema = z.object({
  email:    z.string().email().optional(),
  phone:    z.string().min(6).max(20).optional(),
  password: z.string().min(1),
});

// ─── Type Exports ───────────────────────────────────────────────────────────

export type HospitalSearchInput = z.infer<typeof hospitalSearchSchema>;
export type DoctorSearchInput = z.infer<typeof doctorSearchSchema>;
export type MarketplaceBookingInput = z.infer<typeof marketplaceBookingSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type DoctorRegisterInput = z.infer<typeof doctorRegisterSchema>;
export type DoctorLoginInput = z.infer<typeof doctorLoginSchema>;
export type PublishHospitalInput = z.infer<typeof publishHospitalSchema>;
export type PublishDoctorInput = z.infer<typeof publishDoctorSchema>;
export type UpdateHospitalProfileInput = z.infer<typeof updateHospitalProfileSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-search.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/schemas/marketplace.ts test/marketplace-search.test.ts
git commit -m "feat(marketplace): add Zod validation schemas for all marketplace endpoints"
```

---

## Task 4: Marketplace Helpers

**Files:**
- Create: `src/lib/marketplace-helpers.ts`
- Test: `test/marketplace-search.test.ts` (extend)

- [ ] **Step 1: Write helper tests**

Append to `test/marketplace-search.test.ts`:

```typescript
import { calculateDistance, getDayOfWeek } from '../src/lib/marketplace-helpers';

describe('Marketplace Helpers', () => {
  describe('calculateDistance', () => {
    it('should return 0 for same coordinates', () => {
      expect(calculateDistance(23.8, 90.4, 23.8, 90.4)).toBe(0);
    });

    it('should calculate distance between Dhaka and Chittagong (~250km)', () => {
      const dist = calculateDistance(23.8103, 90.4125, 22.3569, 91.7832);
      expect(dist).toBeGreaterThan(200);
      expect(dist).toBeLessThan(300);
    });
  });

  describe('getDayOfWeek', () => {
    it('should return correct day for a known date', () => {
      // 2026-04-13 is Monday = 1
      expect(getDayOfWeek('2026-04-13')).toBe(1);
    });

    it('should return 0 for Sunday', () => {
      // 2026-04-12 is Sunday = 0
      expect(getDayOfWeek('2026-04-12')).toBe(0);
    });

    it('should return 6 for Saturday', () => {
      // 2026-04-18 is Saturday = 6
      expect(getDayOfWeek('2026-04-18')).toBe(6);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-search.test.ts`

Expected: FAIL — `calculateDistance` and `getDayOfWeek` not found.

- [ ] **Step 3: Create marketplace helpers**

Create `src/lib/marketplace-helpers.ts`:

```typescript
/**
 * Haversine distance between two lat/lng points in kilometers.
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Get day of week (0=Sunday, 6=Saturday) from a YYYY-MM-DD date string.
 */
export function getDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * Build SQL LIKE clause for text search across multiple columns.
 * Returns { clause: string, params: string[] }
 */
export function buildSearchClause(
  query: string,
  columns: string[],
): { clause: string; params: string[] } {
  const term = `%${query.replace(/[%_]/g, '')}%`;
  const conditions = columns.map((col) => `${col} LIKE ?`).join(' OR ');
  const params = columns.map(() => term);
  return { clause: `(${conditions})`, params };
}

/**
 * Build pagination clause.
 * Returns { clause: string, params: number[] }
 */
export function buildPagination(page: number, limit: number): { clause: string; params: number[] } {
  const offset = (page - 1) * limit;
  return { clause: 'LIMIT ? OFFSET ?', params: [limit, offset] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/rahmatullahzisan/Desktop/Dev/hms && npx vitest run test/marketplace-search.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketplace-helpers.ts test/marketplace-search.test.ts
git commit -m "feat(marketplace): add marketplace helper utilities (geo, search, pagination)"
```

---

*Continued in Part 2...*

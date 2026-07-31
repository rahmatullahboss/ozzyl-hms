# Hospital Discovery & Doctor Marketplace — Design Spec

> **Date:** 2026-04-13  
> **Status:** Approved  
> **Scope:** Phase 1 of Ozzyl Health Ecosystem — Hospital/Doctor marketplace with independent doctor chambers

---

## 1. Overview

### What We're Building

A public-facing marketplace layer on top of the existing HMS that lets:
- **Patients** discover hospitals and doctors, connect instantly, and book appointments
- **Hospitals** publish themselves and their doctors to the marketplace
- **Independent doctors** sign up with their own chamber (private practice) and receive bookings

### Architecture Decision

**"Marketplace as a View Layer"** — No data duplication. The marketplace reads directly from existing tenant tables using visibility flags (`is_published`, `is_marketplace_visible`). Only genuinely new data (bookings bridge, reviews, doctor auth) gets new tables.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Browsing access | Public (no login) | Lower friction, like Practo/Zocdoc |
| Publishing control | Hospital admin publishes doctors | Hospital controls their marketplace presence |
| Independent doctors | Chamber = mini-tenant (full features) | Reuses entire multi-tenant system, zero blocking code |
| Chamber dashboard | UI-curated (primary/secondary modules) | Clean UX for solo doctors, all features accessible via "More" |
| Patient connection | Instant (no approval) | Lowest friction for growth |
| Booking model | Direct booking (no hospital confirmation) | Best patient experience, appointment created immediately |
| Frontend location | Same React app, new `/marketplace/*` routes | Share layout, auth, components |

---

## 2. Data Model

### 2.1 Changes to Existing Tables

#### tenants table

```sql
ALTER TABLE tenants ADD COLUMN tenant_type TEXT DEFAULT 'hospital';
-- Values: 'hospital' | 'chamber'

ALTER TABLE tenants ADD COLUMN is_published INTEGER DEFAULT 0;
ALTER TABLE tenants ADD COLUMN public_description TEXT;
ALTER TABLE tenants ADD COLUMN public_photos TEXT;
-- JSON array of R2 object keys, e.g. ["photos/hospital-front.jpg", "photos/lobby.jpg"]

ALTER TABLE tenants ADD COLUMN specialties TEXT;
-- JSON array, e.g. ["cardiology", "dermatology", "pediatrics"]

ALTER TABLE tenants ADD COLUMN latitude REAL;
ALTER TABLE tenants ADD COLUMN longitude REAL;

ALTER TABLE tenants ADD COLUMN operating_hours TEXT;
-- JSON, e.g. {"mon": "09:00-17:00", "tue": "09:00-17:00", ...}
```

#### doctors table

```sql
ALTER TABLE doctors ADD COLUMN is_marketplace_visible INTEGER DEFAULT 0;
ALTER TABLE doctors ADD COLUMN public_bio TEXT;

ALTER TABLE doctors ADD COLUMN languages TEXT;
-- JSON array, e.g. ["english", "bengali", "hindi"]

ALTER TABLE doctors ADD COLUMN profile_photo_key TEXT;
-- R2 object key for profile photo
```

### 2.2 New Tables

#### marketplace_bookings

Bridges marketplace booking requests to local tenant appointments.

```sql
CREATE TABLE marketplace_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_global_id TEXT NOT NULL,
  -- References global_patient_identity.uhid

  doctor_id INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,

  booking_date TEXT NOT NULL,
  -- ISO date: 2026-04-15

  booking_time TEXT NOT NULL,
  -- Time: "10:00"

  token_number INTEGER,
  -- From the tenant's token system

  fee INTEGER,
  -- In paisa (consistent with doctors.consultation_fee)

  status TEXT NOT NULL DEFAULT 'confirmed',
  -- Values: 'confirmed' | 'completed' | 'cancelled' | 'no_show'

  local_appointment_id INTEGER,
  -- References appointments.id in the tenant scope

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

#### provider_reviews

Ratings and reviews for both doctors and hospitals.

```sql
CREATE TABLE provider_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reviewer_global_patient_id TEXT NOT NULL,
  -- References global_patient_identity.uhid

  target_type TEXT NOT NULL,
  -- Values: 'hospital' | 'doctor'

  target_tenant_id TEXT NOT NULL,
  -- The hospital/chamber tenant

  target_doctor_id INTEGER,
  -- NULL if target_type = 'hospital', doctor ID if target_type = 'doctor'

  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,

  is_verified_visit INTEGER DEFAULT 0,
  -- 1 if patient has a completed appointment with this provider

  is_approved INTEGER DEFAULT 0,
  -- Moderation: 0 = pending, 1 = approved

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_provider_reviews_target ON provider_reviews(target_type, target_tenant_id);
CREATE INDEX idx_provider_reviews_doctor ON provider_reviews(target_doctor_id);
CREATE INDEX idx_provider_reviews_reviewer ON provider_reviews(reviewer_global_patient_id);
```

#### doctor_auth

Authentication for independent doctors who sign up outside a hospital.

```sql
CREATE TABLE doctor_auth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,

  doctor_id INTEGER NOT NULL,
  -- References doctors.id in the auto-created chamber tenant

  tenant_id TEXT NOT NULL,
  -- References the auto-created chamber tenant

  is_verified INTEGER DEFAULT 0,
  -- Email/phone verification status

  is_active INTEGER DEFAULT 1,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_doctor_auth_email ON doctor_auth(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_doctor_auth_phone ON doctor_auth(phone) WHERE phone IS NOT NULL;
```

### 2.3 Indexes for Marketplace Search

```sql
-- Fast marketplace queries on existing tables
CREATE INDEX idx_tenants_marketplace ON tenants(is_published, tenant_type);
CREATE INDEX idx_tenants_specialties ON tenants(specialties) WHERE is_published = 1;
CREATE INDEX idx_tenants_location ON tenants(latitude, longitude) WHERE is_published = 1;
CREATE INDEX idx_doctors_marketplace ON doctors(is_marketplace_visible, tenant_id);
CREATE INDEX idx_doctors_specialty_marketplace ON doctors(specialty, is_marketplace_visible);
```

---

## 3. API Routes

### 3.1 Public Routes (no auth)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/marketplace/hospitals` | Search/browse published hospitals |
| GET | `/api/v1/marketplace/hospitals/:tenantId` | Hospital public profile |
| GET | `/api/v1/marketplace/doctors` | Search/browse visible doctors |
| GET | `/api/v1/marketplace/doctors/:id` | Doctor public profile |
| GET | `/api/v1/marketplace/doctors/:id/availability` | Available slots for date range |
| GET | `/api/v1/marketplace/doctors/:id/reviews` | Doctor reviews |
| GET | `/api/v1/marketplace/hospitals/:id/reviews` | Hospital reviews |

### 3.2 Patient Auth Routes (global patient JWT)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/v1/marketplace/connect/:tenantId` | Instant connect to hospital |
| POST | `/api/v1/marketplace/bookings` | Book appointment from marketplace |
| GET | `/api/v1/marketplace/bookings` | List my marketplace bookings |
| DELETE | `/api/v1/marketplace/bookings/:id` | Cancel a booking |
| POST | `/api/v1/marketplace/reviews` | Submit review (verified visit required) |

### 3.3 Hospital Admin Routes (staff JWT + tenant scope)

| Method | Route | Description |
|--------|-------|-------------|
| PUT | `/api/v1/marketplace/publish` | Toggle hospital marketplace visibility |
| PUT | `/api/v1/marketplace/doctors/:id/publish` | Toggle doctor marketplace visibility |
| PUT | `/api/v1/marketplace/profile` | Update hospital public profile fields |

### 3.4 Doctor Auth Routes (independent doctor chambers)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/v1/doctor-auth/register` | Independent doctor signup (creates chamber tenant) |
| POST | `/api/v1/doctor-auth/login` | Doctor login |
| GET | `/api/v1/doctor-auth/me` | Doctor's own profile |
| PUT | `/api/v1/doctor-auth/profile` | Update public profile |

### 3.5 Search Parameters

**Hospital Search:**
```
GET /api/v1/marketplace/hospitals?
  q=<text>                  -- name, specialties full-text search
  &specialty=<string>       -- exact specialty filter
  &lat=<float>&lng=<float>  -- center point for geo search
  &radius=<int>             -- km radius (default: 20)
  &rating_min=<int>         -- minimum average rating (1-5)
  &type=hospital|chamber    -- filter by tenant type
  &page=<int>&limit=<int>   -- pagination (default: page=1, limit=20, max limit=50)
```

**Doctor Search:**
```
GET /api/v1/marketplace/doctors?
  q=<text>                  -- name, specialty text search
  &specialty=<string>       -- exact specialty filter
  &hospital=<tenantId>      -- doctors at specific hospital
  &language=<string>        -- language filter
  &available_date=<date>    -- has slots on this date
  &fee_max=<int>            -- max consultation fee (in paisa)
  &rating_min=<int>         -- minimum average rating (1-5)
  &page=<int>&limit=<int>   -- pagination (default: page=1, limit=20, max limit=50)
```

---

## 4. Core Flows

### 4.1 Hospital Publishing to Marketplace

```
Hospital Admin → Settings → "Publish to Marketplace" toggle
  │
  ├─ PUT /api/v1/marketplace/publish
  │   body: { is_published: true }
  │   → UPDATE tenants SET is_published = 1 WHERE id = :tenantId
  │
  ├─ PUT /api/v1/marketplace/profile
  │   body: { public_description, specialties, latitude, longitude, operating_hours }
  │   → UPDATE tenants SET ... WHERE id = :tenantId
  │
  └─ For each doctor to publish:
      PUT /api/v1/marketplace/doctors/:doctorId/publish
        body: { is_marketplace_visible: true }
        → UPDATE doctors SET is_marketplace_visible = 1 WHERE id = :doctorId AND tenant_id = :tenantId
```

### 4.2 Independent Doctor Registration

```
Doctor visits /doctor/register
  │
  POST /api/v1/doctor-auth/register
  body: {
    name, email, phone, password,
    specialty, bmdc_registration, qualifications,
    chamber_name, chamber_address, consultation_fee,
    schedule: [
      { day_of_week: 0, start_time: "09:00", end_time: "13:00", max_patients: 20 },
      { day_of_week: 2, start_time: "16:00", end_time: "20:00", max_patients: 15 }
    ]
  }
  │
  Transaction:
  ├─ 1. Generate tenant slug from chamber_name (e.g. "dr-rahmans-chamber")
  ├─ 2. INSERT INTO tenants (name, slug, tenant_type, is_published, ...) 
  │     VALUES (:chamber_name, :slug, 'chamber', 0, ...)
  │     -- is_published = 0 until email/phone verified
  ├─ 3. INSERT INTO doctors (tenant_id, name, specialty, ..., is_marketplace_visible)
  │     VALUES (:newTenantId, :name, :specialty, ..., 0)
  │     -- is_marketplace_visible = 0 until verified
  ├─ 4. INSERT INTO doctor_auth (email, phone, password_hash, doctor_id, tenant_id)
  │     VALUES (:email, :phone, :hash, :newDoctorId, :newTenantId)
  ├─ 5. INSERT INTO doctor_schedules (...) for each schedule entry
  └─ 6. Return JWT: { scope: "staff", tenantId: :newTenantId, role: "doctor" }
  │
  Doctor uses existing staff dashboard (filtered for chamber)
```

### 4.3 Patient Discovers Hospital & Connects

```
Patient browses /marketplace/hospitals
  │
  GET /api/v1/marketplace/hospitals?specialty=cardiology&lat=23.8&lng=90.4
  │
  → SELECT t.id, t.name, t.public_description, t.specialties, t.latitude, t.longitude,
  │        t.operating_hours, t.public_photos, t.tenant_type,
  │        COALESCE(AVG(r.rating), 0) as avg_rating,
  │        COUNT(r.id) as review_count
  │  FROM tenants t
  │  LEFT JOIN provider_reviews r ON r.target_tenant_id = t.id 
  │        AND r.target_type = 'hospital' AND r.is_approved = 1
  │  WHERE t.is_published = 1
  │    AND t.specialties LIKE '%cardiology%'
  │  GROUP BY t.id
  │  ORDER BY avg_rating DESC
  │  LIMIT 20 OFFSET 0
  │
  Patient clicks hospital → views profile
  Patient clicks "Connect to this Hospital"
  │
  POST /api/v1/marketplace/connect/:tenantId
  (requires global patient JWT)
  │
  ├─ Check: does patient_health_links already exist for this patient + tenant?
  │   → If yes: return { already_connected: true }
  │
  ├─ Create local patient record:
  │   INSERT INTO patients (tenant_id, name, email, phone, national_id, ...)
  │   VALUES (:tenantId, [data from global_patient_identity], ...)
  │
  ├─ Create health link:
  │   INSERT INTO patient_health_links (global_patient_id, tenant_id, local_patient_id, ...)
  │   VALUES (:uhid, :tenantId, :newPatientId, ...)
  │
  └─ Return { connected: true, tenant_id: :tenantId }
      → Hospital now appears in patient's "My Hospitals" list
```

### 4.4 Patient Books from Marketplace

```
Patient views doctor profile → checks availability
  │
  GET /api/v1/marketplace/doctors/:id/availability?date=2026-04-15
  │
  → Find doctor_schedules where day_of_week matches the date's weekday
  → Count existing appointments for that date + doctor
  → Calculate remaining slots (max_patients - booked_count)
  → Return available time windows + next available token numbers
  │
  Patient selects a slot → clicks "Book"
  │
  POST /api/v1/marketplace/bookings
  body: { doctor_id, tenant_id, booking_date: "2026-04-15", booking_time: "10:00" }
  (requires global patient JWT)
  │
  Transaction:
  ├─ 1. If NOT connected to this tenant → auto-connect (same as 4.3)
  │
  ├─ 2. Resolve local_patient_id from patient_health_links
  │
  ├─ 3. Create local appointment (reuse existing appointment creation logic):
  │     INSERT INTO appointments (tenant_id, patient_id, doctor_id, date, time, 
  │       status, fee, token_number, source, ...)
  │     VALUES (:tenantId, :localPatientId, :doctorId, :date, :time,
  │       'scheduled', :doctorFee, :nextToken, 'marketplace', ...)
  │
  ├─ 4. Create marketplace booking record:
  │     INSERT INTO marketplace_bookings (patient_global_id, doctor_id, tenant_id,
  │       booking_date, booking_time, token_number, fee, status, local_appointment_id)
  │     VALUES (:uhid, :doctorId, :tenantId, :date, :time, :token, :fee, 
  │       'confirmed', :localAppointmentId)
  │
  └─ 5. Return booking confirmation:
       { booking_id, token_number, doctor_name, hospital_name, date, time, fee }
```

### 4.5 Review Submission

```
POST /api/v1/marketplace/reviews
body: {
  target_type: "doctor",
  target_tenant_id: "tenant-123",
  target_doctor_id: 45,
  rating: 5,
  review_text: "Excellent doctor, very thorough."
}
(requires global patient JWT)
│
├─ Verify: patient has a completed appointment with this doctor
│   SELECT 1 FROM appointments 
│   WHERE patient_id = :localPatientId AND doctor_id = :target_doctor_id
│     AND tenant_id = :target_tenant_id AND status = 'completed'
│   → If none found: 400 "You can only review providers you've visited"
│
├─ Check: patient hasn't already reviewed this target
│   → If duplicate: 400 "You've already submitted a review"
│
├─ INSERT INTO provider_reviews (...)
│   VALUES (:uhid, :target_type, :tenantId, :doctorId, :rating, :text, 1, 0, ...)
│   → is_verified_visit = 1 (proven by appointment check)
│   → is_approved = 0 (pending moderation)
│
└─ Return { review_id, status: "pending_moderation" }
```

---

## 5. Frontend Pages

### 5.1 Route Structure

```
Public (no auth):
  /marketplace                          -- Landing page
  /marketplace/hospitals                -- Hospital directory
  /marketplace/hospitals/:tenantId      -- Hospital profile
  /marketplace/doctors                  -- Doctor directory
  /marketplace/doctors/:id              -- Doctor profile + booking
  /doctor/register                      -- Independent doctor signup
  /doctor/login                         -- Doctor login

Patient dashboard addition:
  /patient/dashboard?tab=find           -- "Find Care" tab (logged-in marketplace)
```

### 5.2 Page Descriptions

#### Marketplace Landing (`/marketplace`)
- Hero section: "Find Hospitals & Doctors Near You"
- Unified search bar (searches both hospitals and doctors)
- Quick specialty cards (Cardiology, Dermatology, Pediatrics, etc.)
- Top-rated hospitals section (3-4 cards)
- Top-rated doctors section (3-4 cards)
- CTA: "Are you a doctor? Register your chamber"

#### Hospital Directory (`/marketplace/hospitals`)
- Search bar at top
- Filter sidebar: specialty, location/distance, rating, type (hospital/chamber)
- Results grid: hospital cards showing name, photo, specialties, rating, review count, distance
- Sort options: rating, distance, name
- Pagination

#### Hospital Profile (`/marketplace/hospitals/:tenantId`)
- Header: name, cover photo, address, rating stars, review count, operating hours
- Specialties tags
- Description
- Doctors list: cards with photo, name, specialty, fee, "View" / "Book" buttons
- Reviews section: rating distribution, individual reviews
- "Connect to Hospital" button (if logged in + not connected)
- "Login to Connect" button (if not logged in)

#### Doctor Directory (`/marketplace/doctors`)
- Search bar at top
- Filter sidebar: specialty, language, fee range, hospital, availability date, rating
- Results grid: doctor cards showing photo, name, specialty, hospital name, fee, rating, next available date
- Sort options: rating, fee (low-high), availability
- Pagination

#### Doctor Profile (`/marketplace/doctors/:id`)
- Header: photo, name, specialty, qualifications, BMDC registration number
- Bio section
- Languages spoken
- Hospital(s) / Chamber name + address
- Consultation fee
- Availability calendar: select date → see open slots
- "Book Appointment" button → slot selection → confirmation
- Reviews section
- If not logged in: "Login to Book" prompt

#### Doctor Registration (`/doctor/register`)
- Multi-step form:
  - Step 1: Personal info (name, email, phone, password)
  - Step 2: Professional info (specialty, BMDC reg, qualifications)
  - Step 3: Chamber details (name, address, consultation fee)
  - Step 4: Schedule setup (pick days, set hours, max patients per session)
- Submit → redirect to dashboard

#### Doctor Login (`/doctor/login`)
- Email/phone + password
- Redirects to existing staff dashboard (with chamber-curated layout)

### 5.3 Patient Dashboard "Find Care" Tab

Same content as the marketplace landing but:
- Embedded inside the patient dashboard (tab layout)
- "Connect" and "Book" buttons are active (already logged in)
- Shows connection status per hospital ("Connected" badge)
- Booking flow is seamless (no login interruption)

### 5.4 Chamber Dashboard (Doctor View)

Reuses the existing staff dashboard with a curated sidebar:

**Primary modules (always visible):**
- Today's Appointments
- My Patients
- Prescriptions
- Schedule Management
- Billing & Payments
- Marketplace Profile

**Secondary modules (under "More" section, one click to expand):**
- Lab Orders
- Inventory
- Admissions
- Staff / HR
- Accounting
- Settings

Implementation: frontend checks `tenant.type === 'chamber'` and renders the appropriate sidebar layout. No API-level blocking — all features work if accessed.

---

## 6. Security Considerations

### Public Routes
- Rate limited: 60 requests/minute per IP
- No sensitive data exposed (only published profiles)
- Search queries sanitized and parameterized

### Patient Actions
- Global patient JWT required for connect, book, review
- Patient identity verified via JWT `scope: 'global'`
- Auto-connect creates minimal patient record (name, contact only)
- Reviews require verified visit (completed appointment check)

### Doctor Auth
- Password hashed with PBKDF2-SHA256 (consistent with patient auth)
- Account lockout after 5 failed attempts
- Email/phone verification required before chamber is published to marketplace
- On verification: UPDATE tenants SET is_published = 1; UPDATE doctors SET is_marketplace_visible = 1
- Unverified doctors can still use their chamber dashboard (schedule, patients) — just not discoverable publicly

### Data Access
- Marketplace queries only read `is_published = 1` tenants and `is_marketplace_visible = 1` doctors
- Unpublished hospitals/doctors are invisible to marketplace queries
- Cross-tenant reads are limited to marketplace search (no clinical data exposed)

---

## 7. What Does NOT Change

| System | Reason |
|--------|--------|
| Patient auth | Already global. Marketplace uses the same JWT. |
| Multi-tenancy | Already works. Chamber is just a tenant with type = 'chamber'. |
| Patient portal | Already cross-hospital. "Find Care" is an additive tab. |
| Clinical workflows | Already complete. Chamber doctors use the same system. |
| Appointment system | Already works. Marketplace booking creates a local appointment using existing logic. |
| UHID system | Already globally unique. Used as-is for marketplace identity. |
| Existing API routes | Zero changes. All marketplace routes are new additions. |

---

## 8. Summary

| Metric | Value |
|--------|-------|
| New columns on existing tables | 11 (7 on tenants, 4 on doctors) |
| New tables | 3 (marketplace_bookings, provider_reviews, doctor_auth) |
| New indexes | 9 |
| New API route groups | 4 (marketplace public, marketplace patient, marketplace admin, doctor-auth) |
| New API endpoints | 18 |
| New frontend pages | 7 + 1 dashboard tab |
| Existing routes changed | 0 |
| Existing tables changed | 0 (only columns added) |

---

*Ozzyl HMS Marketplace Design Spec v1.0 — 2026-04-13*

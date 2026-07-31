# Hospital Website + Patient Portal: A-to-Z Plan

> Comprehensive audit & implementation roadmap for the per-hospital website system

---

## PART 1: CURRENT STATE AUDIT

### What EXISTS and WORKS

| Area | Status | Files | Notes |
|------|--------|-------|-------|
| **Multi-Tenant Website Serving** | DONE | `src/routes/public/hospitalSite.ts` | Slug-based `/site/{subdomain}`, 3-layer cache (CF Cache API -> KV -> D1), SSR pre-render |
| **3 Pre-built Themes** | DONE | `src/routes/public/themes/` | arogyaseva (teal), medtrust (navy), carefirst (green) + base CSS + color overrides |
| **Website Config/Settings** | DONE | `src/routes/tenant/website.ts`, `web/src/pages/WebsiteSettings.tsx` | 4-tab admin UI (General, Services, SEO, Appearance), auto re-render |
| **5 Website Pages** | DONE | `src/routes/public/prerender.tsx` | Home, Doctors, Services, About, Contact + sitemap.xml + robots.txt |
| **Doctor Listings** | DONE | `src/routes/public/components/DoctorCard.tsx` | Photo, name, specialty, qualifications, visiting_hours, fee. `is_public` flag |
| **Patient Portal Auth** | NEEDS REWORK | `src/routes/tenant/patientPortal.ts` (1239 lines) | Currently OTP-based → **Replace with email magic link verification** (user decision) |
| **Patient Portal Features** | DONE | `web/src/pages/PatientPortal.tsx` | Dashboard, appointments, prescriptions, labs, vitals, bills, telemedicine |
| **Appointment Booking (portal)** | DONE | patientPortal.ts L742-849 | Patient self-books with doctor, date, time, complaint. Duplicate prevention, token generation |
| **Available Doctors/Slots** | DONE | patientPortal.ts (protected routes) | Available-doctors, available-slots endpoints |
| **Prescription View + Refill** | DONE | patientPortal.ts | List prescriptions, request refills |
| **Lab Results** | DONE | patientPortal.ts L65-90 | Patient-friendly explanations with severity levels |
| **Vitals Self-Reporting** | DONE | patientPortal.ts | BP, temperature, weight, SpO2, pulse |
| **Health Timeline** | DONE | patientPortal.ts L1060-1138 | Unified view: visits, prescriptions, lab orders, bills |
| **Family Members** | DONE | patientPortal.ts L1140-1237 | Link/unlink by patient code, relationship types |
| **Messages** | DONE | patientPortal.ts (route exists) | Secure messaging endpoint |
| **Billing View** | DONE | patientPortal.ts | Patient can view bills |
| **Website Analytics** | DONE | migrations/0030, 0031 | Page views, per-page stats, daily chart, subdomain tracking |
| **Doctor Schedules (backend)** | DONE | `src/routes/tenant/doctorSchedules.ts` | CRUD for doctor weekly schedules (day, time, session, chamber, max_patients) |
| **Medical Records (backend)** | DONE | `src/routes/tenant/medicalRecords.ts` | Medical records, birth/death details, diagnosis, document records |
| **Notification Infrastructure** | DONE | `src/lib/sms.ts`, `src/lib/email.ts`, `src/routes/tenant/push.ts` | Push notifications, inbox, SMS & email libs |

### Config Fields Available (website_config)

```
is_enabled, theme, tagline, about_text, mission_text, founded_year,
bed_count, operating_hours, google_maps_embed, whatsapp_number,
facebook_url, seo_title, seo_description, seo_keywords,
primary_color, secondary_color, hero_image_key, logo_key
```

### Patient Portal Protected Routes

```
/me, /dashboard, /appointments, /available-doctors, /available-slots/*,
/book-appointment, /cancel-appointment/*, /prescriptions, /prescriptions/*,
/lab-results, /bills, /vitals, /visits, /messages, /messages/*,
/refill-requests, /timeline, /family, /family/*
```

---

## PART 2: GAP ANALYSIS (What's MISSING)

### P0 - Critical (Must Have for Launch)

| # | Gap | Impact | Effort |
|---|-----|--------|--------|
| 1 | **Patient Self-Registration from Website** | Patients can't create accounts without hospital staff. Blocks entire patient portal adoption | Medium |
| 2 | **Doctor Schedule on Public Website** | DoctorCard shows text `visiting_hours` but NOT actual schedule from `doctor_schedules` table | Low |
| 3 | **Public Booking Flow on Website** | No way to book from public website. Must login first, but can't register. Chicken-and-egg problem | Medium |
| 4 | **Hero Image + Logo Upload** | `hero_image_key` and `logo_key` fields exist in DB but NO upload UI in WebsiteSettings | Low |
| 5 | **Website Gallery** | `website_gallery` table exists but NO API, NO admin UI, NOT displayed on website | Medium |
| 6 | **Auth Rework: OTP → Magic Link** | OTP requires SMS (costly), poor UX (typing codes). Magic link via email is free (Resend), better UX, industry standard | Medium |

### P1 - Important (Needed for Good Experience)

| # | Gap | Impact | Effort |
|---|-----|--------|--------|
| 7 | **Patient EHR/Document Access in Portal** | Medical records backend exists but NO portal endpoint for patients to view/download records | Medium |
| 8 | **Patient Document Upload** | `documentRecords` schema exists but patients can't upload their own medical documents from portal | Medium |
| 9 | **Multi-Language Website (EN/BN)** | Services have `name_bn` but website content (about, tagline, etc.) is English-only | Medium |
| 10 | **Appointment Notifications** | Push infra exists but NO automated reminders (24h before, booking confirmation emails) | Medium |
| 11 | **Downloadable Medical Reports (PDF)** | Patients can view data but can't download/print lab results, prescriptions as PDFs | Medium |
| 12 | **More Website Templates** | Only 3 themes. Need 5-8 for variety + layout variation (not just color changes) | Medium |
| 13 | **Pre-Appointment Digital Forms** | No health questionnaire / intake form before appointment | Medium |
| 14 | **Online Payment** | Bills visible but no bKash/Nagad/Card payment integration | High |

### P2 - Nice to Have (Differentiators)

| # | Gap | Impact | Effort |
|---|-----|--------|--------|
| 15 | **Blog / Health Education CMS** | Hospitals can't post health tips, news, updates on their website | Medium |
| 16 | **Patient Reviews/Testimonials** | No review system for patients | Medium |
| 17 | **Department Pages** | No dedicated department/specialty pages | Low |
| 18 | **Custom Domain Support** | Code references `hms-{subdomain}.ozzyl.com` but not fully implemented | High |
| 19 | **Emergency Information Section** | No dedicated emergency/ambulance info display | Low |
| 20 | **WhatsApp Chat Widget** | Number shown but no click-to-chat or embedded widget | Low |
| 21 | **PWA Optimization** | Capacitor config exists but patient portal needs offline-capable PWA | Medium |
| 22 | **Insurance Provider Listing** | No insurance info display on website | Low |
| 23 | **Video Consultation from Website** | Telemedicine exists but not directly accessible from public site | Medium |
| 24 | **WCAG Accessibility Audit** | Unknown accessibility state | Medium |

---

## PART 3: IMPLEMENTATION PLAN

### Phase 0: Auth Rework — OTP → Email Magic Link
> **Decision:** Replace OTP-based auth with email verification magic links (better UX, more secure, no SMS cost)

#### Architecture: Magic Link Authentication

**How it works:**
1. Patient enters email on login/register page
2. Backend generates a short-lived signed JWT (15 min expiry) with patient ID + tenant ID
3. Email sent via Resend (already configured) with magic link: `https://{host}/patient/verify?token={jwt}`
4. Patient clicks link → backend verifies JWT → issues session JWT (2h) → redirects to portal
5. No OTP codes, no SMS, no code entry — just click the link in email

**Why magic link > OTP:**
- No SMS cost (OTP needs SMS gateway; magic link uses existing Resend email — free 3K/month)
- Better UX (click link vs. type 6 digits)
- More secure (link is single-use, time-limited, tied to specific email)
- Works for both login AND registration in one flow
- Industry standard (Notion, Slack, Linear all use magic links)

**Technical Implementation:**

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Patient enters   │────▶│ Backend generates │────▶│ Resend sends│
│ email on website │     │ magic link JWT    │     │ email       │
└─────────────────┘     └──────────────────┘     └──────┬──────┘
                                                         │
┌─────────────────┐     ┌──────────────────┐            │
│ Portal opens    │◀────│ Session JWT      │◀───────────┘
│ (authenticated) │     │ issued (2h)      │  Patient clicks link
└─────────────────┘     └──────────────────┘
```

**Backend changes:**

1. **New schema:** `src/schemas/patientPortal.ts`
   - Remove `verifyOtpSchema`
   - Add `requestMagicLinkSchema` (email only)
   - Add `verifyMagicLinkSchema` (token only)
   - Add `patientRegisterSchema` (name, email, mobile, DOB, gender, address)

2. **New endpoints in `patientPortal.ts`:**
   - `POST /api/portal/request-login` — Send magic link to existing patient's email
   - `GET /api/portal/verify-email?token={jwt}` — Verify magic link, issue session JWT
   - `POST /api/portal/register` — New patient self-registration (sends verification email)

3. **Remove:** `request-otp`, `verify-otp` endpoints, `patient_otp_codes` table dependency

4. **New email template in `src/lib/email.ts`:**
   ```ts
   EmailTemplates.magicLink({ patientName, loginUrl, hospitalName })
   // "Click the button below to access your patient portal"
   // Big green "Login to Portal" button with magic link URL

   EmailTemplates.verifyRegistration({ patientName, verifyUrl, hospitalName })
   // "Click to verify your email and activate your patient portal"
   ```

5. **Magic link JWT payload:**
   ```ts
   {
     sub: patientId,
     email: patient.email,
     tenantId: tenantId,
     purpose: 'magic_link' | 'registration_verify',
     iat: now,
     exp: now + 15 * 60  // 15 minutes
   }
   ```

6. **Security:**
   - Single-use: Store used token IDs in KV with 15min TTL (`used_magic:{tokenHash}`)
   - Rate limit: Max 3 magic link requests per email per 15 min (reuse existing KV rate limiter)
   - IP check optional: Can log IP at request time and verify at click time

7. **Auth middleware update:** `src/middleware/auth.ts`
   - Update public route whitelist: replace `request-otp`/`verify-otp` with `request-login`/`verify-email`/`register`

**Frontend changes:**

1. **Patient login page** (currently uses OTP form):
   - Step 1: Enter email → "Send me a login link"
   - Step 2: "Check your email" confirmation screen
   - No Step 3 (user clicks link in email, auto-redirects)

2. **Email verification landing page** (`/patient/verify`):
   - Receives `?token=...` query param
   - Calls `GET /api/portal/verify-email?token=...`
   - On success: stores session JWT, redirects to `/patient/portal`
   - On error: shows "Link expired" with "Request new link" button

**DB migration:**
- New table: `patient_magic_links` (optional, for audit trail)
  ```sql
  CREATE TABLE IF NOT EXISTS patient_magic_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,  -- SHA-256 hash of JWT
    purpose TEXT DEFAULT 'login',  -- 'login' | 'registration'
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  );
  ```
- Can keep `patient_otp_codes` for backward compat but stop using it

---

### Phase 1: Core Patient Journey (P0 Items)
> Goal: A patient can discover a hospital website, register, view doctors/schedules, and book an appointment

#### 1.1 Patient Self-Registration
**Backend:** New endpoint `POST /api/portal/register`
- Fields: name, email, mobile, date_of_birth, gender, address
- Creates patient record in `patients` table with `is_verified = 0`
- Creates `patient_credentials` record
- Generates magic link JWT with `purpose: 'registration_verify'`
- Sends verification email via Resend using `EmailTemplates.verifyRegistration()`
- Auto-generates patient_code via existing sequence system

**Frontend:** New `PatientRegister.tsx` page
- Accessible from hospital website contact page ("Create Account" button)
- Step 1: Enter basic info (name, email, mobile, DOB, gender)
- Step 2: "Check your email" screen → patient clicks verification link
- Step 3: Auto-redirect to patient portal (JWT issued on link click)
- Link from hospital website navbar + doctor "Book Now" button

**Schema changes:** Add `is_verified INTEGER DEFAULT 0` to `patients` table (migration)

#### 1.2 Doctor Schedule Display on Website
**Backend:** Modify `fetchTenantData()` in `prerender.tsx`
- JOIN `doctor_schedules` with `doctors` to get weekly schedules
- Return schedule data per doctor

**Frontend SSR:** Update `DoctorCard.tsx`
- Show weekly schedule table (day | time | session)
- Show "Available Today" / "Next Available" badge
- Add "Book Appointment" CTA button

#### 1.3 Public Booking Flow
**Website:** New "Book Appointment" page at `/site/{slug}/book`
- Step 1: Select doctor (shows schedule/availability)
- Step 2: Select date + time slot
- Step 3: If not logged in → "Login" or "Register" → magic link sent → click → auto-returns to booking
- Step 4: Confirm booking (POST /api/portal/book-appointment)
- Confirmation email sent via Resend

**Implementation approach:**
- Hybrid SSR + client-side: Doctor list is SSR, booking form uses minimal JS
- Store pending booking in sessionStorage before auth redirect
- After magic link verification, redirect back with booking data preserved

#### 1.4 Hero Image + Logo Upload
**Backend:** Add R2 upload endpoints in `website.ts`
- `POST /api/website/upload-hero` (accept image, store in R2, save key to website_config)
- `POST /api/website/upload-logo` (same pattern)
- Max size: 2MB, accept: image/jpeg, image/png, image/webp

**Frontend:** Add upload UI in `WebsiteSettings.tsx` General tab
- Drag-and-drop or click-to-upload
- Image preview after upload
- Delete/replace functionality

#### 1.5 Website Gallery
**Backend:** CRUD endpoints for `website_gallery`
- `GET /api/website/gallery`
- `POST /api/website/gallery` (R2 upload + DB record)
- `PUT /api/website/gallery/:id` (update caption, sort_order)
- `DELETE /api/website/gallery/:id`

**Frontend Admin:** New "Gallery" tab in WebsiteSettings
- Upload images, set captions, reorder via drag-drop

**Website SSR:** Add gallery section to Home page and optional Gallery page

#### 1.6 OTP Email Delivery
**Backend:** Wire `src/lib/email.ts` into patient portal OTP flow
- Send OTP via email using existing email lib
- Template: "Your OTP for {hospital_name} Patient Portal: {otp}"
- Also send via SMS using `src/lib/sms.ts` if mobile provided
- Fallback: dev mode still returns OTP in response

---

### Phase 2: Enhanced Patient Portal (P1 Items)

#### 2.1 Patient EHR/Document Access
**New portal endpoints:**
- `GET /api/portal/medical-records` - List patient's medical records
- `GET /api/portal/medical-records/:id` - Detail view
- `GET /api/portal/documents` - List uploaded documents
- `POST /api/portal/documents` - Upload document (R2)
- `GET /api/portal/diagnoses` - Diagnosis history

**Frontend:** New tabs in PatientPortal.tsx
- "Medical Records" tab showing history
- "Documents" tab with upload capability
- Document viewer/downloader

#### 2.2 Multi-Language Website
**Backend changes:**
- Add `_bn` (Bengali) fields to `website_config`: `tagline_bn`, `about_text_bn`, `mission_text_bn`
- Add Bengali translations for website UI strings

**Frontend SSR:**
- Language switcher component on navbar
- Detect language from browser preference or URL param `?lang=bn`
- Render content in selected language

**Admin:** Add Bengali input fields in WebsiteSettings

#### 2.3 Appointment Notifications
**Using existing infrastructure:**
- `src/lib/email.ts` for email notifications
- `src/lib/sms.ts` for SMS notifications
- `src/routes/tenant/push.ts` for push notifications

**Automated triggers:**
- On booking: Send confirmation email + SMS
- 24h before: Send reminder email + push notification
- On cancellation: Send notification to both patient and hospital
- On doctor schedule change: Notify affected patients

**Implementation:** Add to `src/scheduled.ts` (cron worker already exists)

#### 2.4 Downloadable Reports (PDF)
**Backend:** `GET /api/portal/prescriptions/:id/pdf`
- Generate PDF using existing PDF infrastructure (`src/routes/tenant/pdf.ts`)
- Return downloadable PDF
- Same for lab results

#### 2.5 More Website Templates
**Add 4-5 new themes:**
- `sunrise` - Orange/Warm - Women & children hospitals
- `oceanic` - Deep blue - Multi-specialty hospitals
- `heritage` - Traditional - Government/established institutions
- `minimal` - Black/White - Modern private clinics
- `nature` - Earth tones - Ayurvedic/alternative medicine

**Also add layout variations:**
- Full-width hero vs. split hero
- Grid doctor listing vs. list view
- Sidebar contact vs. full-width contact

#### 2.6 Pre-Appointment Forms
**Backend:**
- New table: `appointment_intake_forms` (tenant_id, form_fields JSON)
- New table: `appointment_intake_responses` (appointment_id, responses JSON)
- `GET /api/portal/appointments/:id/intake-form`
- `POST /api/portal/appointments/:id/intake-response`

**Frontend:** After booking, show intake form link. Patient fills before visit.

#### 2.7 Online Payment
**Integration options for Bangladesh market:**
- bKash payment gateway API
- Nagad payment gateway
- SSLCommerz (card payments)

**Backend:**
- `POST /api/portal/bills/:id/pay` - Initiate payment
- `POST /api/portal/payment-callback` - Payment gateway callback
- New table: `payment_transactions`

---

### Phase 3: Marketing & Growth Features (P2 Items)

#### 3.1 Blog / Health Education CMS
- New tables: `website_posts`, `website_post_categories`
- Admin UI for creating/editing posts
- New website page: `/site/{slug}/blog`
- SEO-optimized post pages

#### 3.2 Patient Reviews/Testimonials
- New table: `patient_reviews` (patient_id, rating, comment, is_approved)
- Patient can submit review after visit
- Hospital admin moderates reviews
- Display approved reviews on website

#### 3.3 Custom Domain Support
- Domain mapping table + admin UI
- Cloudflare for SaaS / Custom Hostnames API
- SSL certificate provisioning
- DNS configuration guide for hospitals

#### 3.4 Emergency Information Section
- Emergency contact number (dedicated field)
- Ambulance service info
- 24/7 department hours
- Display prominently on website header + contact page

#### 3.5 WhatsApp Chat Widget
- Floating WhatsApp button (uses existing whatsapp_number config)
- Pre-filled message: "Hi, I'd like to book an appointment at {hospital_name}"

---

## PART 4: PRIORITY MATRIX

```
                    HIGH IMPACT
                        |
    P0: Self-Register   |  P0: Public Booking Flow
    P1: Notifications   |  P1: EHR Access
    P1: Online Payment  |  P0: OTP Delivery
                        |
   LOW EFFORT --------- + --------- HIGH EFFORT
                        |
    P0: Schedule Display|  P1: Multi-Language
    P0: Hero/Logo Upload|  P2: Blog CMS
    P0: Gallery         |  P2: Custom Domains
    P2: WhatsApp Widget |  P2: Reviews
                        |
                    LOW IMPACT
```

---

## PART 5: RECOMMENDED EXECUTION ORDER

### Sprint 1 (Week 1-2): "Auth Rework + Patient Registration + Booking"
0. **Auth rework: OTP → Magic Link** (email verification via Resend)
1. Patient self-registration endpoint + page (with email verification)
2. Doctor schedule display on public website
3. "Book Appointment" flow from website
4. Hero image + logo upload in settings

### Sprint 2 (Week 3-4): "Complete Portal Experience"
6. Website gallery management
7. Patient EHR/document access in portal
8. Patient document upload
9. Downloadable prescription/lab PDFs
10. Appointment confirmation + reminder notifications

### Sprint 3 (Week 5-6): "Multi-Language & Polish"
11. Bengali language support for website
12. 2-3 additional themes
13. Pre-appointment intake forms
14. WhatsApp chat widget
15. Emergency information section

### Sprint 4 (Week 7-8): "Monetization & Growth"
16. Online payment integration (bKash/Nagad)
17. Blog/health education CMS
18. Patient reviews/testimonials
19. Department pages

### Sprint 5 (Week 9-10): "Enterprise Features"
20. Custom domain support
21. More themes + layout variations
22. PWA optimization
23. Accessibility audit + fixes

---

## PART 6: TECHNICAL ARCHITECTURE NOTES

### Patient Auth Flow — Magic Link (Replaces OTP)
```
EXISTING PATIENT LOGIN:
  /patient/login -> Enter email -> "Send login link"
  -> POST /api/portal/request-login
  -> Backend: Find patient by email+tenant -> Generate magic JWT (15min)
  -> Resend sends email with "Login to Portal" button
  -> Patient clicks link -> GET /api/portal/verify-email?token=xxx
  -> Backend: Verify JWT, check single-use, issue session JWT (2h)
  -> Redirect to /patient/portal with JWT stored in localStorage

NEW PATIENT REGISTRATION:
  /patient/register -> Enter name, email, mobile, DOB, gender
  -> POST /api/portal/register
  -> Backend: Create patient (is_verified=0), generate magic JWT (15min)
  -> Resend sends email with "Verify Email" button
  -> Patient clicks link -> GET /api/portal/verify-email?token=xxx
  -> Backend: Mark patient as verified, issue session JWT (2h)
  -> Redirect to /patient/portal

MAGIC LINK JWT PAYLOAD:
  { sub: patientId, email, tenantId, purpose: 'login'|'register', exp: +15min }

SECURITY:
  - Single-use tokens (KV: used_magic:{hash} with 15min TTL)
  - Rate limit: 3 requests per email per 15 min
  - Token hash stored in patient_magic_links for audit trail
  - Session JWT: 2h expiry, refreshable via /refresh-token

EMAIL PROVIDER:
  - Resend (already configured in src/lib/email.ts)
  - Free tier: 3,000 emails/month, 100/day
  - Templates with XSS protection already built
```

### Doctor Schedule Integration (Proposed)
```
prerender.tsx
    -> fetchTenantData() also fetches doctor_schedules
    -> DoctorCard.tsx shows:
        - Weekly schedule table
        - "Available Today" badge
        - "Book Now" button -> /site/{slug}/book?doctor={id}
```

### Booking Flow (Proposed)
```
/site/{slug}/book
    -> SSR: Render doctor list with schedules
    -> Client JS: Date picker shows available slots
    -> "Continue" -> Check if logged in
        -> Yes: Show confirmation + book
        -> No: "Login" or "Create Account" (magic link email sent)
              -> After clicking email link: auto-redirects back to booking
              -> Booking completes with pre-selected doctor/date
    -> POST /api/portal/book-appointment
    -> Confirmation page + confirmation email via Resend
```

### Image Upload Architecture
```
WebsiteSettings -> Upload image
    -> POST /api/website/upload-hero (multipart/form-data)
    -> Store in R2 bucket with key: {tenant_id}/website/{type}/{timestamp}.{ext}
    -> Save R2 key in website_config
    -> Trigger re-render
    -> Pre-rendered HTML references /api/uploads/{key} which serves from R2
```

---

## Summary

| Category | Exists | Missing | Total |
|----------|--------|---------|-------|
| Backend APIs | 16 systems | 6 P0 gaps | 22 needed |
| Frontend Pages | PatientPortal + WebsiteSettings | Self-register, booking page, EHR | 5 new pages |
| Website Pages | 5 pages (SSR) | Book, Gallery, Blog, Department | 4 new pages |
| Themes | 3 | 5+ more | 8 target |
| DB Tables | All core tables exist | intake_forms, payment_transactions, posts, reviews | 4 new tables |

**Overall Assessment: ~60% complete for MVP, ~35% complete for full feature parity with industry leaders.**

The system has a solid foundation. The backend is well-architected with proper multi-tenancy, security (OTP rate limiting, JWT, audit logging), and caching. The main gaps are in the patient-facing journey (self-registration, public booking) and content management (gallery, blog, multi-language).

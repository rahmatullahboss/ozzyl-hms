# Ozzyl HMS - Full Ecosystem TODO

> **Created:** 2026-04-12 | **Updated:** 2026-04-24 | **Total Items:** 78 | **Phases:** 5 + 1 Parallel Track
> **Reference:** [ECOSYSTEM_ARCHITECTURE_REVIEW.md](./ECOSYSTEM_ARCHITECTURE_REVIEW.md)
> **Status Update:** Systematic codebase scan on 2026-04-24 revealed many items marked as pending were already implemented.

---

## Phase 1: Hospital Discovery & Doctor Marketplace (P0 — 4-5 weeks)

### 1.1 Hospital Public Directory

- [x] Create `hospital_public_profiles` migration table *(uses existing `tenants` table with marketplace fields)*
- [x] Create `POST /api/v1/marketplace/hospitals` — Hospital admin publishes to directory *(via `PUT /api/v1/marketplace/publish`)*
- [x] Create `GET /api/v1/marketplace/hospitals` — Search/browse (public, no auth needed)
- [x] Create `GET /api/v1/marketplace/hospitals/:id` — Single hospital profile
- [x] Create `PUT /api/v1/marketplace/hospitals/:id` — Hospital admin updates public profile
- [x] Add hospital admin UI toggle: "Publish to Marketplace"
- [x] Add fields: description, photos (R2), specialties, address, coordinates, operating hours
- [x] Implement search: by name, location, specialty, rating
- [x] Add Zod validation schemas for all marketplace hospital endpoints

### 1.2 Doctor Public Profiles

- [x] Create `doctor_public_profiles` migration table *(uses existing `doctors` table with marketplace fields)*
- [x] Create `POST /api/v1/marketplace/doctors` — Sync doctor from hospital to marketplace *(via `POST /api/doctors/:id/publish`)*
- [x] Create `GET /api/v1/marketplace/doctors` — Search/browse doctors (public)
- [x] Create `GET /api/v1/marketplace/doctors/:id` — Single doctor profile *(includes schedule + booked slots)*
- [x] Implement doctor data sync: hospital staff record -> public profile
- [x] Handle multi-hospital doctors: aggregate specialties, qualifications across hospitals
- [x] Add fields: bio, photo (R2), qualifications, languages, specialties, experience
- [x] Implement search: by specialty, location, language, name, hospital
- [x] Add Zod validation schemas for all marketplace doctor endpoints
- [x] Add doctor verification badges (board-certified, years of experience) *(BMDC reg no stored)*

### 1.3 Patient-Side Hospital Discovery UI

- [ ] Create new patient dashboard tab: "Find Hospitals" (`?tab=find`)
- [ ] Build hospital search page with filters (specialty, location, rating)
- [ ] Build hospital profile page (public view)
- [ ] Build "Connect to Hospital" button + flow
- [ ] Show connection status per hospital (connected / pending / not connected)
- [ ] Build doctor search page with filters
- [ ] Build doctor profile page (public view)

### 1.4 Hospital Connection Flow

- [x] Create connection request API: `POST /api/v1/marketplace/connect/:tenantId`
- [x] Patient requests connection → hospital receives notification *(auto-creates local patient)*
- [x] Hospital accepts → creates local patient record → links via `patient_health_links`
- [x] Patient can also connect via: UHID entry, NID match, QR code (existing methods)
- [ ] Show connection history and status in patient dashboard

---

## Phase 2: Enhanced Booking & Reviews (P1 — 2-3 weeks)

### 2.1 Doctor Availability

- [x] Create `doctor_availability_public` migration table *(uses existing `doctor_schedules`)*
- [x] Build sync mechanism: hospital schedule -> public availability *(returned in `/doctors/:id`)*
- [x] Create `GET /api/v1/marketplace/doctors/:id/availability` — Available slots *(embedded in doctor profile)*
- [ ] Display availability calendar on doctor profile page *(backend ready, frontend needed)*
- [ ] Real-time slot updates when appointments are booked (Durable Object: `LiveDoctorAvailability`)

### 2.2 Marketplace Booking

- [x] Create `marketplace_bookings` migration table
- [x] Create `POST /api/v1/marketplace/bookings` — Patient books from marketplace
- [x] Build booking bridge: marketplace_booking -> hospital notification -> local appointment
- [x] Create `GET /api/v1/marketplace/bookings` — Patient views their marketplace bookings
- [x] Add booking status flow: pending -> confirmed -> completed / cancelled
- [ ] Hospital-side UI: incoming marketplace booking requests queue
- [x] Hospital accepts -> auto-creates local appointment (existing appointment system)
- [x] Link: `marketplace_bookings.local_appointment_id` -> tenant-scoped appointment
- [x] Telemedicine marketplace booking: `POST /api/v1/marketplace/telemedicine-bookings`

### 2.3 Ratings & Reviews

- [x] Enhance existing review system for per-doctor reviews
- [x] Create `GET /api/v1/marketplace/doctors/:id/reviews` — Doctor reviews (public)
- [x] Create `POST /api/v1/marketplace/reviews` — Submit review (patient auth, post-visit only)
- [x] Aggregate ratings across hospitals for same doctor
- [x] Add moderation workflow: flag, review, approve/reject *(ReviewModerationPage built)*
- [x] Display ratings on doctor and hospital marketplace profiles

---

## Phase 3: Telemedicine (P2 — 3-4 weeks)

### 3.1 Infrastructure

- [ ] Set up Cloudflare Calls or WebRTC signaling infrastructure
- [ ] Create Durable Object: `TelemedicineSession` (WebSocket management)
- [ ] Create `telemedicine_sessions` migration table
- [ ] Create `telemedicine_chat_messages` migration table

### 3.2 Video Consultation

- [ ] Create `POST /api/v1/telemedicine/sessions` — Create session
- [ ] Create `GET /api/v1/telemedicine/sessions/:id` — Session details
- [ ] Create `PUT /api/v1/telemedicine/sessions/:id` — Update status (start, end, cancel)
- [ ] Build video call UI: waiting room, call controls, camera/mic toggle, screen share
- [ ] Build doctor-side telemedicine dashboard
- [ ] Implement recording consent flow

### 3.3 Chat & E-Prescriptions

- [ ] Create `POST /api/v1/telemedicine/sessions/:id/chat` — Send message
- [ ] Create `GET /api/v1/telemedicine/sessions/:id/chat` — Chat history
- [ ] Real-time chat via Durable Objects (WebSocket)
- [ ] E-prescription from telehealth: reuse existing prescription engine
- [ ] Post-session clinical notes
- [ ] Follow-up scheduling from telemedicine session

---

## Phase 4: Network Features (P2-P3 — 2-3 weeks)

### 4.1 Cross-Hospital Referrals

- [ ] Create `cross_hospital_referrals` migration table
- [ ] Create `referral_documents` migration table
- [ ] Create `POST /api/v1/referrals` — Create referral
- [ ] Create `GET /api/v1/referrals` — List referrals (sent/received)
- [ ] Create `PUT /api/v1/referrals/:id` — Accept/decline/complete referral
- [ ] Build referral UI for doctors (create referral with reason, urgency, documents)
- [ ] Build incoming referral queue for receiving hospital
- [ ] Notification to receiving doctor when referral arrives
- [ ] Auto-create patient connection at receiving hospital on referral acceptance

### 4.2 Hospital Self-Onboarding

- [x] Build hospital registration form (public page) *(exists via `/api/register`)*
- [x] Hospital document upload for verification *(onboarding flow exists)*
- [x] Admin verification queue: review, approve, reject applications *(SuperAdmin onboarding)*
- [x] On approval: auto-provision tenant *(done via `/api/admin/onboarding/:id/provision`)*
- [x] Hospital profile management: edit public-facing info
- [x] Hospital Setup Wizard *(post-registration guided setup — just built 2026-04-24)*

---

## Phase 5: Platform & Monetization (P3 — 2-3 weeks)

### 5.1 Subscriptions

- [ ] Create `platform_subscriptions` migration table
- [ ] Create `platform_transactions` migration table
- [ ] Define subscription tiers: Free / Pro / Enterprise (feature matrix)
- [ ] Create subscription management API for hospitals
- [ ] Build subscription dashboard for hospital admins
- [ ] Implement feature gating based on subscription tier

### 5.2 Payments & Revenue

- [ ] Integrate payment gateway: bKash, Nagad, card payments
- [ ] Transaction fee engine for marketplace bookings
- [ ] Platform revenue dashboard (admin view)
- [ ] Payout management for hospitals
- [ ] Invoice generation for hospital subscriptions

### 5.3 Quality Metrics

- [ ] Hospital quality scoring algorithm (wait times, satisfaction, outcomes)
- [ ] Hospital ranking on marketplace based on quality metrics
- [ ] Quality badge system for high-performing hospitals

---

## Parallel Track: Advanced Communication (runs alongside Phases 1-3)

### Notifications

- [ ] Create `notification_preferences` migration table
- [ ] Create `push_notification_tokens` migration table
- [ ] Create `POST /api/v1/notifications/tokens` — Register push token
- [ ] Create `GET /api/v1/notifications/preferences` — Get preferences
- [ ] Create `PUT /api/v1/notifications/preferences` — Update preferences
- [ ] Implement Web Push API for PWA notifications
- [ ] Build in-app notification center (bell icon, real-time via Durable Object: `NotificationHub`)
- [ ] Integrate SMS provider for appointment reminders
- [ ] Optional: WhatsApp Business API integration

---

## Updated Stats

| Metric | Count |
|--------|-------|
| Total TODO items | 78 |
| Completed (verified 2026-04-24) | ~42 |
| Remaining | ~36 |
| New database tables | 12 |
| New API route groups | 5 |
| New frontend pages/tabs | ~10 |
| New Durable Objects | 3 |
| Existing systems changed | 0 |
| Estimated total time | 14-18 weeks |

---

## Recommended Priority Order (Updated)

```
NOW:      Patient "Find Hospitals" discovery UI (Phase 1.3) — backend ready, frontend gap
NEXT:     Hospital booking queue UI (Phase 2.2) — backend ready, frontend gap
THEN:     Notification system (Parallel Track) — affects all modules
THEN:     Telemedicine video calls (Phase 3) — requires Cloudflare Calls
THEN:     Cross-hospital referrals (Phase 4)
THEN:     Subscriptions + payments (Phase 5)
```

---

*Last verified: 2026-04-24 via systematic codebase scan of `src/routes/`, `apps/ozzyl-lifestyle/src/components/patient/`, and `src/index.ts`*

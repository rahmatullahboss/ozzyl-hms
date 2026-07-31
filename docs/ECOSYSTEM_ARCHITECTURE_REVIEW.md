# Ozzyl HMS - Ecosystem Architecture Review

> **Version:** 1.0 | **Date:** 2026-04-12 | **Status:** Corrected Assessment  
> **Purpose:** Accurate audit of what exists, what's missing, and what's needed to complete the full health ecosystem.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What's Already Built (Accurate Assessment)](#2-whats-already-built)
3. [Actual Gaps for Full Ecosystem](#3-actual-gaps-for-full-ecosystem)
4. [Corrected Roadmap](#4-corrected-roadmap)
5. [New Database Tables Needed](#5-new-database-tables-needed)
6. [Architecture Changes Needed](#6-architecture-changes-needed)

---

## 1. Executive Summary

Ozzyl HMS is not a simple hospital management system. It is building a **full health ecosystem** comprising three interconnected pillars:

| Pillar | Description | Status |
|--------|-------------|--------|
| **Patient App** | Global patient identity, cross-hospital portal, health vault, family graph | **Built** |
| **Multi-Hospital Network** | Tenant-isolated hospitals sharing patients via global identity bridge | **Built** |
| **Doctor Marketplace** | Public hospital directory, doctor profiles, cross-hospital booking | **Not Yet Built** |

### Key Facts

- **100+ features** already implemented across clinical, financial, and patient-facing systems
- **126 database migrations** executed, covering 100+ tables
- **3 authentication systems** running in parallel (Staff, Patient, Admin)
- **Multi-tenancy** fully operational with subdomain-based isolation
- **Global patient identity** with UHID system and cross-hospital record aggregation

The system is **far more mature than a typical early-stage HMS**. The remaining work is not foundational — it is additive. The core architecture (auth, tenancy, clinical workflows, patient portal) does not need to change. What's missing are the **public-facing marketplace layers** and **real-time communication features** that sit on top of the existing foundation.

---

## 2. What's Already Built

### 2.1 Global Patient System

**Status: FULLY BUILT**

| Feature | Implementation | Details |
|---------|---------------|---------|
| Global self-registration | `POST /api/patient-auth/register` | `source: 'self_signup'`, no tenant context required |
| Global authentication | JWT with `scope: 'global'` | 24h expiry, works without any hospital affiliation |
| UHID system | `OZ-000001` format | Auto-generated, globally unique across all hospitals |
| Global dashboard | Cross-hospital aggregated view | Records pulled from all connected hospitals |
| Dashboard tabs | 6 tabs | Overview, Hospital Services, Global Records, Vault, Self-Reported Data, Privacy |
| Hospital connection | 5 methods | UHID match, NID match, QR code, consent grant, staff-created record |
| My Hospitals | `GET /api/patient-auth/my-hospitals` | Finds all hospitals where patient has records |
| Per-hospital services | `X-Tenant-ID` header | Switch context to view hospital-specific data |
| Google SSO | OAuth 2.0 integration | One-click sign-in via Google |
| Bilingual support | English + Bengali | Full i18n across patient-facing UI |

**Database Architecture:**

```
global_patient_identity (no tenant_id)  -- The patient's universal identity
        |
        |-- patient_health_links         -- MPI bridge (many-to-many)
        |
        +-- patients (with tenant_id)    -- Per-hospital patient record
```

- `global_patient_identity` stores UHID, NID, demographics — lives outside any tenant
- `patients` stores hospital-specific clinical data — scoped to a tenant
- `patient_health_links` bridges the two, enabling cross-hospital record aggregation

---

### 2.2 Patient Portal Features

**Status: FULLY BUILT**

| Category | Features |
|----------|----------|
| **AI Health** | AI-powered health guidance on dashboard (Gemini integration) |
| **Queue Tracking** | Live hospital visit queue tracking |
| **Appointments** | Aggregated appointments from all connected hospitals; book per-hospital |
| **Messaging** | Secure messaging to hospital staff (concierge system) |
| **Clinical Records** | View prescriptions, lab results, bills, timeline per hospital |
| **Prescriptions** | Request prescription refills |
| **Reviews** | Submit reviews and feedback for hospitals |
| **Emergency** | Emergency pack with QR card for first responders |
| **Visit Pass** | Time-limited data sharing passes, Google Wallet integration |
| **Family Health** | Family Health Graph — global family profiles, multi-manager support, watchlist heuristics |
| **Document Vault** | Encrypted document vault (Cloudflare R2 storage) |
| **Self-Reported** | Self-reported health data tracking (symptoms, vitals, mood) |
| **Privacy** | Granular data privacy controls per hospital |

---

### 2.3 Clinical System

**Status: FULLY BUILT**

| Module | Details |
|--------|---------|
| **Lab Orders** | Full lab workflow with LOINC code support |
| **Prescriptions** | Drug safety engine: interaction checks, allergy blocking, duplicate detection |
| **Admissions** | Admission, discharge, transfer (ADT) workflow |
| **Nursing** | MAR (Medication Administration Record), care plans, wound care tracking |
| **Doctor Chart** | Trust-labeled chart entries (doctor-verified, patient-reported, system-generated, etc.) |
| **AI Summary** | Gemini-powered health summaries for both doctors and patients |
| **Database** | 100+ tables covering the full clinical domain |

---

### 2.4 Financial System

**Status: FULLY BUILT**

| Feature | Details |
|---------|---------|
| Multi-type billing | OPD, IPD, lab, pharmacy, procedure billing |
| Double-entry accounting | Full chart of accounts with journal entries |
| Payment tracking | Payment records with partial payment support |
| Income/expense management | Revenue and cost tracking per hospital |

---

### 2.5 Multi-Tenancy

**Status: FULLY BUILT**

| Feature | Details |
|---------|---------|
| Subdomain isolation | `hospital-a.ozzyl.com`, `hospital-b.ozzyl.com` |
| 3 auth systems | Staff (8h JWT), Patient (24h global JWT), Admin |
| Cross-tenant protection | Middleware enforces `tenant_id` scoping on every query |
| Per-hospital data isolation | All clinical/financial data keyed by `tenant_id` |

---

### 2.6 Infrastructure

**Status: FULLY BUILT**

| Layer | Technology |
|-------|-----------|
| Backend runtime | Cloudflare Workers |
| Backend framework | Hono |
| Database | Cloudflare D1 (SQLite), 126 migrations |
| Object storage | Cloudflare R2 |
| Frontend | React 19 + Vite + Tailwind CSS |
| PWA | Offline support, installable |
| Security | Rate limiting, audit logging, RBAC |
| AI | Google Gemini integration |
| Auth | JWT (3 scopes), Google SSO |

---

## 3. Actual Gaps for Full Ecosystem

> These are the **only** genuinely missing pieces. Everything not listed here already exists.

---

### Gap 1: Hospital Discovery & Connection (Frontend Only)

| Aspect | Details |
|--------|---------|
| **Current State** | Backend partially exists (`my-hospitals` endpoint returns connected hospitals). The `patient_health_links` bridge table supports connection. But there is **no public-facing hospital directory**. |
| **What's Missing** | |
| | Browse/search hospitals by location, specialty, rating |
| | "Connect to Hospital" self-service flow from the patient side |
| | Hospital public profiles (name, address, specialties, photos, ratings) |
| **Impact** | Patients can only see hospitals they're **already connected to**. There is no way to **discover** new hospitals. |
| **Architecture Note** | The backend already has the bridge table (`patient_health_links`) and the connection logic. This gap is primarily about **adding a public directory layer** on top. |

---

### Gap 2: Doctor Marketplace

| Aspect | Details |
|--------|---------|
| **Current State** | Doctors exist as staff members inside hospitals. Doctor data (name, specialty, schedule) exists per-tenant. No public-facing doctor profiles. |
| **What's Missing** | |
| | Public doctor profiles (bio, specialty, qualifications, photo, languages, ratings) |
| | Doctor search/filter (by specialty, location, language, availability) |
| | Patient self-booking from marketplace (currently booking is per-hospital after connection) |
| | Doctor availability published publicly (schedule exists per-hospital but is not exposed) |
| | Patient ratings & reviews for individual doctors (review infrastructure exists but is hospital-scoped) |
| **Impact** | Patients cannot find or compare doctors across hospitals. No cross-hospital doctor discovery. |

---

### Gap 3: Telemedicine

| Aspect | Details |
|--------|---------|
| **Current State** | Not implemented. No video, no real-time chat for consultations. |
| **What's Missing** | |
| | Video consultation (WebRTC / Cloudflare Calls) |
| | Real-time chat between doctor and patient during sessions |
| | E-prescriptions issued from telehealth sessions |
| | Telemedicine session recording and clinical notes |
| **Impact** | All consultations require physical visits. No remote care capability. |

---

### Gap 4: Cross-Hospital Referrals

| Aspect | Details |
|--------|---------|
| **Current State** | Not implemented. Doctors can work within their hospital but cannot formally refer patients to doctors at other hospitals. |
| **What's Missing** | |
| | Doctor-to-doctor referral workflow across hospitals |
| | Referral tracking and status updates |
| | Shared care plans across hospitals |
| **Impact** | No formal referral pathway exists in the multi-hospital network. |

---

### Gap 5: Hospital Self-Onboarding

| Aspect | Details |
|--------|---------|
| **Current State** | Hospital setup is manual/admin-driven. New hospitals are provisioned by platform admin. |
| **What's Missing** | |
| | Self-service hospital registration portal |
| | Hospital verification workflow (document upload, review, approval) |
| | Hospital profile management (public-facing info editable by hospital admin) |
| **Impact** | Scaling the network requires manual effort for each new hospital. |

---

### Gap 6: Platform Economics

| Aspect | Details |
|--------|---------|
| **Current State** | Per-hospital billing exists (charges to patients). No platform-level monetization or revenue model. |
| **What's Missing** | |
| | Subscription tiers for hospitals (Free / Pro / Enterprise) |
| | Transaction fees for marketplace bookings |
| | Global payment gateway integration (bKash, Nagad, cards) |
| | Platform revenue dashboard |
| **Impact** | No monetization path for the platform itself. |

---

### Gap 7: Advanced Communication

| Aspect | Details |
|--------|---------|
| **Current State** | Secure messaging exists (concierge system for patient-to-staff messaging). |
| **What's Missing** | |
| | Push notifications (mobile/PWA) |
| | SMS/WhatsApp notifications for appointments and reminders |
| | Real-time notification center (in-app bell icon with live updates) |
| **Impact** | Patients must actively check the app. No proactive outreach. |

---

### Gap Summary Matrix

| Gap | Complexity | Dependencies | Priority |
|-----|-----------|-------------|----------|
| Hospital Discovery | Medium | New public API routes + frontend | **P0** — Unlocks the network |
| Doctor Marketplace | Medium-High | Hospital Discovery + doctor data sync | **P0** — Core value prop |
| Enhanced Booking & Reviews | Medium | Doctor Marketplace | **P1** — Enables transactions |
| Telemedicine | High | Real-time infra (Durable Objects) | **P2** — High value, high effort |
| Cross-Hospital Referrals | Medium | Multi-tenancy bridge (exists) | **P2** — Network feature |
| Hospital Self-Onboarding | Medium | Verification workflow | **P3** — Scaling feature |
| Platform Economics | Medium | Payment gateway integration | **P3** — Revenue enablement |
| Advanced Communication | Medium | Push infra, SMS provider | **P1** — User engagement |

---

## 4. Corrected Roadmap

> Total estimated timeline: **14-18 weeks** across 5 phases.  
> All phases are **additive** — no existing systems need to be rebuilt or replaced.

---

### Phase 1: Hospital Discovery & Doctor Marketplace (4-5 weeks)

| Week | Deliverable |
|------|------------|
| 1 | `hospital_public_profiles` table + API: `GET /api/v1/marketplace/hospitals` (search, filter) |
| 1-2 | Hospital public profile pages (name, address, specialties, photos, ratings) |
| 2-3 | `doctor_public_profiles` table + API: `GET /api/v1/marketplace/doctors` (search, filter) |
| 3-4 | Doctor public profile pages (bio, specialty, qualifications, languages) |
| 4 | "Connect to Hospital" self-service flow from patient portal |
| 4-5 | New patient dashboard tab: **"Find Hospitals"** |
| 5 | Hospital admin toggle: "Publish to directory" |

**Key Decisions:**
- Marketplace routes live under `/api/v1/marketplace/*` — no auth or patient auth only
- Existing `/api/v1/tenant/*` routes are **untouched**
- Hospital data is **pulled** from existing tenant data, not duplicated

---

### Phase 2: Enhanced Booking & Reviews (2-3 weeks)

| Week | Deliverable |
|------|------------|
| 1 | `doctor_availability_public` table — synced from per-hospital schedules |
| 1-2 | Doctor availability display on marketplace profiles |
| 2 | `marketplace_bookings` table — cross-hospital appointment requests |
| 2-3 | Booking bridge: marketplace request -> hospital notification -> local appointment creation |
| 3 | Enhanced ratings & reviews system (per-doctor, aggregated across hospitals) |
| 3 | Doctor verification badges (board-certified, years of experience) |

**Booking Bridge Flow:**
```
Patient books on marketplace
        |
        v
marketplace_bookings (status: 'pending')
        |
        v
Target hospital receives notification
        |
        v
Hospital accepts --> creates local appointment in tenant scope
        |
        v
marketplace_bookings (status: 'confirmed', local_appointment_id linked)
```

---

### Phase 3: Telemedicine (3-4 weeks)

| Week | Deliverable |
|------|------------|
| 1 | Telemedicine infrastructure: Cloudflare Calls / WebRTC setup |
| 1-2 | `telemedicine_sessions` + `telemedicine_chat_messages` tables |
| 2 | Video consultation UI (waiting room, call controls, screen share) |
| 2-3 | Real-time chat during sessions (Durable Objects) |
| 3 | E-prescriptions from telehealth (reuse existing prescription engine) |
| 3-4 | Session management: recording consent, clinical notes, follow-up scheduling |

**Durable Objects Usage:**
- One DO per active telemedicine session
- Manages: WebSocket connections, chat messages, session state
- Auto-hibernates when session ends

---

### Phase 4: Network Features (2-3 weeks)

| Week | Deliverable |
|------|------------|
| 1 | `cross_hospital_referrals` + `referral_documents` tables |
| 1-2 | Doctor-to-doctor referral workflow (create, accept, decline, complete) |
| 2 | Referral tracking dashboard for both referring and receiving doctors |
| 2-3 | Hospital self-onboarding portal (registration form, document upload) |
| 3 | Hospital verification workflow (admin review queue, approval/rejection) |
| 3 | Network-wide analytics dashboard (platform admin view) |

---

### Phase 5: Platform & Monetization (2-3 weeks)

| Week | Deliverable |
|------|------------|
| 1 | `platform_subscriptions` + `platform_transactions` tables |
| 1 | Subscription tier management (Free / Pro / Enterprise) |
| 1-2 | Payment gateway integration (bKash, Nagad, card payments) |
| 2 | Transaction fee engine for marketplace bookings |
| 2-3 | Platform revenue dashboard |
| 3 | Hospital quality metrics and ranking algorithms |

---

### Parallel Track: Advanced Communication (runs alongside Phases 1-3)

| Deliverable | Timeline |
|------------|----------|
| `notification_preferences` + `push_notification_tokens` tables | Week 1 |
| Push notification infrastructure (Web Push API for PWA) | Week 1-2 |
| In-app notification center (bell icon, real-time via Durable Objects) | Week 2-3 |
| SMS/WhatsApp integration for appointment reminders | Week 3-4 |

---

## 5. New Database Tables Needed

> **Only genuinely new tables.** These do not overlap with any of the existing 100+ tables.

| Table | Purpose | Scope |
|-------|---------|-------|
| `hospital_public_profiles` | Public directory info: description, photos, specialties, address, coordinates, ratings, operating hours | Global (no tenant_id) |
| `doctor_public_profiles` | Public marketplace profiles: bio, qualifications, photo, languages, specialties, aggregated ratings | Global (no tenant_id) |
| `doctor_availability_public` | Synced availability windows from per-hospital schedules for public display | Global (references doctor_public_profiles) |
| `marketplace_bookings` | Cross-hospital appointment requests before they become local appointments | Global (references both patient + target hospital) |
| `telemedicine_sessions` | Video call records: participants, duration, recording URL, clinical notes, status | Tenant-scoped |
| `telemedicine_chat_messages` | Real-time chat messages during telemedicine sessions | Tenant-scoped (references telemedicine_sessions) |
| `cross_hospital_referrals` | Doctor-to-doctor referrals: referring doctor, receiving doctor, reason, status, urgency | Global (references both hospitals) |
| `referral_documents` | Attached files for referrals: clinical summaries, imaging, lab results | Global (references cross_hospital_referrals) |
| `platform_subscriptions` | Hospital subscription records: tier, billing cycle, status, expiry | Global (references tenant) |
| `platform_transactions` | Platform-level revenue: transaction fees, subscription payments, payouts | Global |
| `notification_preferences` | Patient notification settings: channels enabled, quiet hours, per-type toggles | Global (references global_patient_identity) |
| `push_notification_tokens` | Device tokens for push notifications: token, platform, device info, last used | Global (references global_patient_identity) |

**Total: 12 new tables** on top of the existing 100+.

---

## 6. Architecture Changes Needed

### 6.1 API Route Addition (Not Replacement)

```
EXISTING (unchanged):
  /api/v1/tenant/*           -- Hospital-scoped operations (requires X-Tenant-ID)
  /api/patient-auth/*        -- Global patient auth
  /api/admin/*               -- Platform admin

NEW (additive):
  /api/v1/marketplace/hospitals          -- Search/browse hospitals (public or patient auth)
  /api/v1/marketplace/hospitals/:id      -- Hospital public profile
  /api/v1/marketplace/doctors            -- Search/browse doctors (public or patient auth)
  /api/v1/marketplace/doctors/:id        -- Doctor public profile + availability
  /api/v1/marketplace/bookings           -- Create/manage marketplace bookings (patient auth)
  /api/v1/marketplace/reviews            -- Submit/view reviews (patient auth)

  /api/v1/telemedicine/sessions          -- Telemedicine session management
  /api/v1/telemedicine/sessions/:id/chat -- Session chat messages

  /api/v1/referrals                      -- Cross-hospital referral management

  /api/v1/platform/subscriptions         -- Hospital subscription management (admin)
  /api/v1/platform/transactions          -- Platform revenue (admin)

  /api/v1/notifications                  -- Notification preferences + push tokens
```

### 6.2 Doctor Data Sync

```
Hospital Admin toggles "Publish to Marketplace"
        |
        v
Staff record (tenant-scoped) --> Sync --> doctor_public_profiles (global)
        |
        v
Changes in hospital doctor profile propagate automatically
        |
        v
Doctor can have profiles in multiple hospitals, aggregated into one public profile
```

**Rules:**
- Hospital controls which doctors are published
- Doctor's public profile aggregates data from all hospitals where they're published
- Specialties, qualifications, and availability are merged
- Ratings are aggregated across all hospitals

### 6.3 Booking Bridge

```
                    MARKETPLACE LAYER (global)
                    ========================
Patient finds doctor --> Views availability --> Creates marketplace_booking
                                                        |
                                                        v
                    ----------------------------------------
                    |           BRIDGE                      |
                    ----------------------------------------
                                                        |
                                                        v
                    TENANT LAYER (hospital-scoped)
                    ==============================
                    Hospital receives notification -->
                    Reviews booking request -->
                    Accepts --> Creates local appointment (existing system) -->
                    Patient gets confirmation
```

- Marketplace booking is the **request**
- Local appointment is the **fulfillment**
- Both are linked by `marketplace_bookings.local_appointment_id`

### 6.4 Real-Time Layer (Durable Objects)

| Durable Object | Purpose | Lifecycle |
|----------------|---------|-----------|
| `LiveDoctorAvailability` | Real-time slot updates as appointments are booked | Persistent, per-doctor |
| `TelemedicineSession` | Manages WebSocket connections, chat, video signaling | Per-session, hibernates on end |
| `NotificationHub` | Per-patient real-time notification delivery | Persistent, per-patient |

### 6.5 What Does NOT Need to Change

| System | Reason |
|--------|--------|
| **Patient Auth** | Already global with `scope: 'global'` JWT. Marketplace features use the same token. |
| **Multi-Tenancy** | Already works with `tenant_id` isolation. Marketplace is a layer above, not a replacement. |
| **Patient Portal** | Already cross-hospital with aggregated views. New tabs are additive. |
| **Clinical Workflows** | Already complete (lab, prescriptions, admissions, nursing). Telemedicine reuses the prescription engine. |
| **Financial System** | Already handles per-hospital billing. Platform economics is a separate layer. |
| **UHID System** | Already globally unique. Used as-is for marketplace identity. |
| **Family Health Graph** | Already global. No changes needed. |
| **Document Vault** | Already uses R2 encryption. Telemedicine recordings can use the same storage. |

---

## Summary

| Metric | Value |
|--------|-------|
| **Features already built** | 100+ |
| **Existing database tables** | 100+ (126 migrations) |
| **New tables needed** | 12 |
| **Existing API routes affected** | 0 (all changes are additive) |
| **New API route groups** | 5 (`marketplace`, `telemedicine`, `referrals`, `platform`, `notifications`) |
| **Estimated timeline** | 14-18 weeks |
| **Architecture risk** | Low (additive changes only, no refactoring of existing systems) |

The foundation is solid. The remaining work builds **on top of** what already exists, not instead of it.

---

*Document generated: 2026-04-12 | Ozzyl HMS Ecosystem Architecture Review v1.0*

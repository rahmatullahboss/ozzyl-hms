# Patient Portal Backend Review And Wireframe

Date: 2026-04-20
Workspace: `/Users/rahmatullahzisan/Desktop/Dev/hms`

## Purpose

Review the current patient-facing backend surface first, then derive a backend-aligned patient portal redesign:

- what the portal should contain
- how many main tabs it should have
- which pages should exist
- which backend APIs power each page
- which product boundaries must stay separate

---

## Backend Findings

### 1. Duplicate tenant document route creates inconsistent API behavior

Severity: High

The same `GET /api/patient-portal/documents` endpoint is defined twice in the same router with different response shapes.

References:

- [src/routes/tenant/patientPortal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/tenant/patientPortal.ts:936)
- [src/routes/tenant/patientPortal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/tenant/patientPortal.ts:1886)

Impact:

- one implementation returns `document_type as type`, `fileSize`, and `date`
- the other returns `document_type`, `file_size`, and `created_at`
- only the later version writes `auditLog`
- frontend contracts can silently depend on whichever handler Hono resolves first

Design implication:

- redesign must assume a single canonical document contract before the records/documents experience is rebuilt

### 2. Patient auth model is split across two parallel systems

Severity: High

There are two different patient auth products living side by side:

- global standalone patient auth in [src/routes/patient-auth.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/patient-auth.ts:1)
- tenant patient-portal magic-link auth in [src/routes/tenant/patientPortal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/tenant/patientPortal.ts:246)

At the same time, the same tenant router also expects global auth plus `X-Tenant-ID` bridging in [src/routes/tenant/patientPortal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/tenant/patientPortal.ts:135)

Impact:

- product semantics are unclear: is patient access global-first, tenant-first, or both
- route organization suggests legacy tenant portal behavior still exists inside the same runtime surface
- frontend IA should not present a single undifferentiated “portal” when backend contracts are actually split into global and tenant scopes

Design implication:

- redesign must make the scopes visible:
  - global identity/home
  - selected hospital workspace
  - wellness/PHR layer

### 3. Hospital link model is auth-user scoped, but the global portal is identity scoped

Severity: High

`/api/hospital-links` reads and writes `hospital_links.patient_id` using the global auth user id in [src/routes/hospital-links.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/hospital-links.ts:23) and [src/routes/hospital-links.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/hospital-links.ts:42), while `/api/global-portal/dashboard` and `/api/global-portal/hospitals` resolve patient access via identity linkage (`UHID`, phone, email) in [src/routes/global-portal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/global-portal.ts:265) and [src/routes/global-portal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/global-portal.ts:499).

Impact:

- family-managed profiles and future identity merges may not see the same “connected hospitals” model
- frontend can easily show two different hospital lists depending on endpoint choice
- hospital linking is currently a different concept from “hospitals where this identity already has records”

Design implication:

- redesign must separate:
  - linked hospitals you control or sync with
  - hospitals where records already exist

### 4. Tenant portal APIs require hospital context selection before many pages can work

Severity: Medium

The tenant patient portal bridge requires `X-Tenant-ID` and fails without it in [src/routes/tenant/patientPortal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/tenant/patientPortal.ts:187).

Impact:

- pages like appointments, prescriptions, documents, lab results, messages, available doctors, and reviews are hospital-scoped
- the frontend cannot safely drop users directly into these pages without an explicit hospital context selector

Design implication:

- the redesign needs a visible hospital switcher and hospital-detail subpages

### 5. Backend capabilities are much richer than the current tab system, so the current UI is over-mixed and under-modeled

Severity: Medium

The backend already exposes distinct product areas:

- global home/dashboard
- hospital list and per-hospital data
- family graph and managed identities
- AI planner and wellness hub
- visit pass and emergency pack
- PHR vault and self-reported health data
- wellness scoring, streaks, goals, cycles, screenings, challenges
- tenant messaging, reviews, appointments, prescriptions, lab results, bills

References:

- [src/routes/global-portal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/global-portal.ts:265)
- [src/routes/tenant/patientPortal.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/tenant/patientPortal.ts:599)
- [src/routes/patient-phr.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/patient-phr.ts:1)
- [src/routes/wellness.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/wellness.ts:152)

Impact:

- current frontend mixes “wellness”, “global records”, “data”, “vault”, and “hospital services” in a way that does not match backend ownership
- redesign should use fewer top-level tabs and clearer second-level pages

---

## Backend Capability Map

### Global identity layer

Primary APIs:

- `/api/patient-auth/*`
- `/api/global-portal/dashboard`
- `/api/global-portal/hospitals`

Capabilities:

- patient sign in and registration
- global patient identity and UHID
- aggregated recent appointments, prescriptions, and bills
- managed family acting context
- cross-hospital discovery of existing records

### Hospital workspace layer

Primary APIs:

- `/api/patient-portal/appointments`
- `/api/patient-portal/prescriptions`
- `/api/patient-portal/lab-results`
- `/api/patient-portal/bills`
- `/api/patient-portal/messages`
- `/api/patient-portal/available-doctors`
- `/api/patient-portal/reviews`
- `/api/patient-portal/live-visit-status`

Capabilities:

- hospital-specific care journey
- appointment booking and cancel
- prescriptions and refill requests
- lab results and PDFs
- messaging with doctor
- visit/live queue context
- hospital review submission

### Personal records layer

Primary APIs:

- `/api/patient-phr/vault`
- `/api/patient-phr/reported-data`
- `/api/patient-phr/adverse-reactions`
- `/api/patient-phr/lifestyle-logs`
- `/api/patient-portal/documents`
- `/api/patient-portal/medical-records`

Capabilities:

- uploaded personal health vault
- self-entered structured data
- adverse reaction tracking
- lifestyle logs
- tenant medical record documents

### Wellness and coaching layer

Primary APIs:

- `/api/wellness/*`
- `/api/global-portal/ai-plans*`
- `/api/global-portal/wellness-hub*`

Capabilities:

- score, trends, streaks, goals, insights
- mood, sleep, activity, water, symptom, vitals logging
- screenings, cycle history, meditation, challenges
- AI wellness planning and checklists

### Family and emergency layer

Primary APIs:

- `/api/global-portal/family*`
- `/api/global-portal/visit-pass*`
- `/api/global-portal/emergency-pack*`

Capabilities:

- dependents and managed profiles
- family proxy invites
- acting as family member
- visit pass generation
- emergency pack generation

### Hospital linking and consent layer

Primary APIs:

- `/api/hospital-links`
- `/api/hospital-links/consents`
- `/api/hospital-links/:id/data`

Capabilities:

- manual hospital linking
- data sharing consent
- sync and pre-visit support

---

## Recommended Product Structure

The patient portal should be redesigned as a **5-tab product** with one persistent utility rail.

### Top-level tabs

1. Home
2. Care
3. Records
4. Wellness
5. Family

### Persistent utility actions

- hospital switcher
- notifications
- profile and identity
- privacy and sharing
- emergency access

Reasoning:

- `Home` is the global cross-hospital summary
- `Care` is the currently selected hospital workspace
- `Records` is the patient-owned information architecture
- `Wellness` is the personal coaching and tracking system
- `Family` is managed profiles, dependents, and shared care

This is cleaner than the current 12+ mixed tabs.

---

## Recommended Pages

### 1. Auth and entry

- Patient login
- Patient registration
- Password reset
- Hospital chooser modal after login when hospital-specific data is needed

### 2. Home tab

- Global dashboard
- Linked hospitals and hospitals with records
- Current guidance card
- Next appointment summary
- Outstanding bills summary
- Quick actions

Backed by:

- `/api/global-portal/dashboard`
- `/api/global-portal/hospitals`

### 3. Care tab

Subpages:

- Care overview
- Appointments
- Prescriptions
- Lab results
- Bills and payments
- Messages
- Live visit status
- Reviews

Backed by:

- `/api/patient-portal/dashboard`
- `/api/patient-portal/appointments`
- `/api/patient-portal/prescriptions`
- `/api/patient-portal/lab-results`
- `/api/patient-portal/bills`
- `/api/patient-portal/messages`
- `/api/patient-portal/live-visit-status`
- `/api/patient-portal/reviews/mine`

### 4. Records tab

Subpages:

- My health card
- Health vault
- Medical records
- Self-reported data
- Vitals history
- Timeline
- Visit pass
- Emergency pack

Backed by:

- `/api/patient-auth/me`
- `/api/patient-phr/vault`
- `/api/patient-portal/medical-records`
- `/api/patient-phr/reported-data`
- `/api/patient-portal/vitals`
- `/api/patient-portal/timeline`
- `/api/global-portal/visit-pass`
- `/api/global-portal/emergency-pack`

### 5. Wellness tab

Subpages:

- Wellness overview
- Daily check-in
- Trends
- Goals
- Insights
- AI planner
- Screenings
- Cycle and women’s health
- Breathing and meditation
- Challenges

Backed by:

- `/api/wellness/score`
- `/api/wellness/trends`
- `/api/wellness/goals`
- `/api/wellness/insights`
- `/api/global-portal/ai-plans`
- `/api/wellness/screenings`
- `/api/wellness/cycle/history`
- `/api/wellness/meditation/log`
- `/api/wellness/challenges`

### 6. Family tab

Subpages:

- Family overview
- Dependents
- Proxy invites
- Managed profiles switcher
- Shared risk summary

Backed by:

- `/api/global-portal/family`
- `/api/global-portal/family/dependents`
- `/api/global-portal/family/proxy-invites`

### 7. Privacy and sharing page

This should be a dedicated utility page, not a main tab.

Subpages:

- Hospital link management
- Consent controls
- Sensitive sharing preferences
- Device and session management

Backed by:

- `/api/hospital-links`
- `/api/hospital-links/consents`

---

## Recommended Navigation Model

### Bottom navigation on mobile

- Home
- Care
- Records
- Wellness
- Family

### Desktop left rail

- Same 5 tabs
- utility section below:
  - Privacy
  - Emergency pack
  - Settings

### Hospital context switcher

Always visible in:

- Home header
- all Care tab pages
- Records pages that show hospital-scoped items

The UI must explicitly say:

- `Global`
- `Selected hospital`

This prevents the current mixing problem.

---

## Wireframe

## A. Home

```text
+--------------------------------------------------------------+
| Topbar: Identity | Hospital switcher | Notifications | Me    |
+--------------------------------------------------------------+
| Hero: "Good morning, Rahim"                                  |
| Guidance card: status + next steps + quick CTA               |
+---------------------------+----------------------------------+
| Next appointments         | Outstanding items                |
| - next hospital visit     | - bills                          |
| - live visit if active    | - pending review data            |
+---------------------------+----------------------------------+
| Hospitals with records                                         |
| [Hospital card] [Hospital card] [Link new hospital]          |
+--------------------------------------------------------------+
| Quick actions: Book | Upload | Refill | Create visit pass    |
+--------------------------------------------------------------+
```

## B. Care

```text
+--------------------------------------------------------------+
| Hospital header: [Selected hospital] [Switch]                |
| Status: active visit / next appointment / last prescription  |
+--------------------------------------------------------------+
| Secondary nav: Overview | Appointments | Prescriptions       |
|                Labs | Bills | Messages | Reviews             |
+--------------------------------------------------------------+
| Main panel: selected page list/detail                        |
+--------------------------------------------------------------+
```

## C. Records

```text
+--------------------------------------------------------------+
| Identity card + UHID + verification state                    |
+--------------------------------------------------------------+
| Secondary nav: Health Card | Vault | Medical Records         |
|                Self-reported | Vitals | Timeline             |
|                Visit Pass | Emergency Pack                   |
+--------------------------------------------------------------+
| Main panel: documents, forms, timeline, wallet passes        |
+--------------------------------------------------------------+
```

## D. Wellness

```text
+--------------------------------------------------------------+
| Score ring | Today streak | Goal progress | AI plan status   |
+--------------------------------------------------------------+
| Secondary nav: Overview | Check-in | Trends | Goals          |
|                Insights | AI Planner | Screenings | Cycle    |
|                Calm | Challenges                             |
+--------------------------------------------------------------+
| Main panel: charts, logs, coach cards, checklists            |
+--------------------------------------------------------------+
```

## E. Family

```text
+--------------------------------------------------------------+
| Acting as: Self / Mother / Child / Dependent                 |
+--------------------------------------------------------------+
| Cards: dependents count | pending invites | shared alerts    |
+--------------------------------------------------------------+
| Secondary nav: Overview | Dependents | Invites | Risk Map    |
+--------------------------------------------------------------+
| Main panel: managed profiles, invite flows, family context   |
+--------------------------------------------------------------+
```

## F. Privacy Utility Page

```text
+--------------------------------------------------------------+
| Privacy and sharing                                          |
+--------------------------------------------------------------+
| Linked hospitals                                             |
| [hospital] [active] [manage consent] [unlink]                |
+--------------------------------------------------------------+
| Consent matrix                                               |
| labs | meds | vitals | mood | cycle | AI access             |
+--------------------------------------------------------------+
| Device/session list                                          |
+--------------------------------------------------------------+
```

---

## Redesign Rules

### Rule 1

Never mix global and hospital-scoped content in the same section header.

### Rule 2

Hospital-scoped pages must always show which hospital is active.

### Rule 3

Patient-owned records and hospital-owned records should be separate but cross-linked.

### Rule 4

Privacy should not be a main primary tab; it is a utility/settings surface.

### Rule 5

Wellness should be a full product area, not a handful of widgets inside overview.

### Rule 6

Family management should be a first-class tab because backend support is already substantial.

---

## Recommended Redesign Sequence

### Phase 1

- unify backend contracts that the redesign depends on
- remove duplicate `/documents` route
- choose one patient auth model for the new UI entry path

### Phase 2

- build new global shell with 5 primary tabs
- add visible global vs hospital context labeling

### Phase 3

- redesign Home and Care first
- these are the highest patient-value surfaces

### Phase 4

- redesign Records and Wellness

### Phase 5

- redesign Family and Privacy utilities

---

## Implementation Note

The next design/implementation pass should treat the patient portal as three coordinated subproducts:

- global patient identity and cross-hospital home
- selected hospital care workspace
- personal wellness and records workspace

That is the clean model the backend already implies, even though the current frontend does not.

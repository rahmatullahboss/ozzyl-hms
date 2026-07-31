# CDB-113D Appointment Authority Audit

**Date:** 2026-07-26  
**Program:** HMS Canonical Data Architecture  
**Checkpoint:** `CDB-113D-APPOINTMENT-AUTHORITY`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Authoritative worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`  
**Production access or mutation:** none  
**Feature-flag activation:** none  
**Local-sync expansion:** none

## 1. Purpose

This audit defines the exact appointment authority boundary before any CDB-113D schema or runtime implementation. The current HMS has a mature operational appointment route, but the legacy `appointments` row combines planned scheduling intent, token allocation, clinical request text, practitioner and patient references, fee quotation, discount fields, billing workflow state, check-in state, and care-delivery transitions. Multiple routes independently mutate the same status. Telemedicine bookings use `consultations` instead of `appointments`, and marketplace booking state is also stored separately.

The target is one additive canonical appointment authority with immutable status history and an explicit appointment-to-encounter link. The checkpoint must not replace the existing encounter authority, duplicate patient or practitioner identity, copy payment truth into appointment state, or activate canonical runtime reads before backfill and parity evidence exist.

## 2. Non-negotiable architecture decisions

- Appointment is planned intent.
- Encounter is actual care.
- Appointment and encounter are not one mutable lifecycle row.
- Patient identity is referenced through `patient_link_public_id`; demographics are not copied.
- Practitioner identity is referenced through canonical practitioner public ID; doctor name or numeric legacy ID is not identity evidence.
- Billing status is not canonical appointment authority.
- A quoted fee is a planning snapshot only; invoice, payment, discount approval, allocation, revenue, and refund remain financial facts.
- `doctor_schedules` is an availability and profile extension, not appointment identity or lifecycle authority.
- `marketplace_bookings` is a channel/workflow projection, not the authoritative appointment lifecycle.
- `consultations` may contain telemedicine workflow and clinical-document fields, but scheduled telemedicine intent must map to canonical appointment authority.
- Rescheduling creates a new intent linked to the previous appointment and closes the old intent as `rescheduled`; historical schedule facts are not rewritten.
- Check-in may atomically create or link actual care, but it must not make the appointment row the encounter authority.
- Name, phone, email, specialty, department, numeric-ID coincidence, and time proximity are insufficient identity or episode evidence.

## 3. Exact access evidence

The deterministic canonical access registry records the following exact `path + table` access pairs.

### 3.1 `appointments`: 8 writers and 30 readers

Writers:

1. `src/lib/canonical/appointment-billing-finalization.ts`
2. `src/routes/marketplace-admin.ts`
3. `src/routes/marketplace-patient.ts`
4. `src/routes/tenant/appointments.ts`
5. `src/routes/tenant/doctors.ts`
6. `src/routes/tenant/patientPortal.ts`
7. `src/routes/tenant/patients.ts`
8. `src/routes/tenant/queue.ts`

Readers:

1. `scripts/canonical/backfill-encounters.ts`
2. `src/lib/billing-counter-session.ts`
3. `src/lib/doctor-lab-inbox.ts`
4. `src/routes/global-portal.ts`
5. `src/routes/hospital-links.ts`
6. `src/routes/marketplace-patient.ts`
7. `src/routes/marketplace.ts`
8. `src/routes/tenant/appointments.ts`
9. `src/routes/tenant/billing.ts`
10. `src/routes/tenant/billingCounter.legacy.ts`
11. `src/routes/tenant/dailyCollection.ts`
12. `src/routes/tenant/dashboard.ts`
13. `src/routes/tenant/doctors.ts`
14. `src/routes/tenant/fhir.ts`
15. `src/routes/tenant/lab.ts`
16. `src/routes/tenant/managerDashboard.ts`
17. `src/routes/tenant/patientPortal.ts`
18. `src/routes/tenant/patients-chart.ts`
19. `src/routes/tenant/patients-timeline.ts`
20. `src/routes/tenant/patients.ts`
21. `src/routes/tenant/prescriptions.ts`
22. `src/routes/tenant/queue.ts`
23. `src/routes/tenant/reception.ts`
24. `src/routes/tenant/reminders.ts`
25. `src/routes/tenant/reportAppointment.ts`
26. `src/routes/tenant/shiftHandoverReport.js`
27. `src/routes/tenant/shiftHandoverReport.ts`
28. `src/routes/tenant/website.ts`
29. `src/routes/tenant/whatsapp.ts`
30. `src/scheduled.ts`

A targeted static mutation search found 24 literal SQL or Drizzle appointment mutation references across those writer paths. This is evidence of lifecycle spread, not a count of business endpoints.

### 3.2 `consultations`: 3 writers and 8 readers

Writers:

- `src/routes/marketplace-patient.ts`
- `src/routes/tenant/consultations.ts`
- `src/routes/tenant/patients.ts`

Readers:

- `scripts/canonical/backfill-encounters.ts`
- `scripts/canonical/backfill-invoices.ts`
- `scripts/canonical/backfill-service-operations.ts`
- `src/routes/marketplace-patient.ts`
- `src/routes/tenant/consultations.ts`
- `src/routes/tenant/patients-chart.ts`
- `src/routes/tenant/patients-timeline.ts`
- `src/routes/tenant/patients.ts`

`consultations` currently mixes scheduled telemedicine intent, room workflow, notes, prescription, complaint, follow-up date, and consultation lifecycle. It cannot remain a competing scheduling authority after canonical appointment adoption.

### 3.3 `doctor_schedules`: 3 writers and 8 readers

Writers:

- `src/routes/doctor-auth.ts`
- `src/routes/tenant/doctorSchedule.ts`
- `src/routes/tenant/doctorSchedules.ts`

Readers:

- `src/index.js`
- `src/index.ts`
- `src/routes/marketplace-patient.ts`
- `src/routes/marketplace.ts`
- `src/routes/public/prerender.tsx`
- `src/routes/tenant/doctorSchedule.ts`
- `src/routes/tenant/doctorSchedules.ts`
- `src/routes/tenant/patientPortal.ts`

This table remains a canonical-linked scheduling extension. CDB-113D does not copy recurring availability rules into each appointment or make schedule rows practitioner identity.

## 4. Current legacy appointment shape

`src/db/schema/schema.ts` defines `appointments` with:

- legacy integer ID and appointment number;
- token number and token assignment type;
- legacy patient and doctor IDs;
- appointment date and optional time;
- visit type and status;
- notes and chief complaint;
- fee, original fee, discount, final fee, discount reason, and discount approver/referrer name;
- billing status;
- external-referring-doctor ID;
- source/channel;
- checked-in timestamp;
- tenant, creator, and timestamps.

The non-manual token uniqueness index excludes cancelled and no-show rows. This protects one operational invariant but does not provide immutable lifecycle history, optimistic versioning, canonical identity references, or explicit encounter linkage.

The current row therefore owns too many independent facts. CDB-113D will not copy all columns into canonical appointment identity. Clinical notes, detailed billing state, schedule configuration, notification delivery, marketplace profile, and queue facts remain controlled extensions or separate authorities.

## 5. Writer classification

### 5.1 Tenant appointment route

`src/routes/tenant/appointments.ts` is the largest mutation surface.

It currently:

- reserves legacy mutation-idempotency keys;
- resolves fee and eligibility;
- checks doctor/time and patient/doctor/day conflicts;
- assigns token number;
- inserts `appointments` as `scheduled`;
- creates provisional billing and deletes the appointment if provisional billing fails;
- directly updates appointment status, date, time, doctor, complaint, notes, fee, discount, and billing status;
- directly transitions scheduled appointment to `checked_in`;
- creates a legacy `visits` row and queue entry during check-in;
- cancels provisional billing during appointment cancellation;
- handles pay-now, due approval, and send-to-counter financial workflows.

The route proves that appointment planning, billing, visit creation, and queue workflow are coupled but not consistently one atomic authority boundary. The canonical command layer must support caller-supplied compatibility statements so legacy appointment, provisional billing, visit, and queue writes can be co-committed where required. Financial commands remain authoritative for invoice/payment facts.

### 5.2 Marketplace patient route

Regular marketplace booking:

- validates legacy doctor visibility and schedule;
- auto-creates a tenant patient from global identity when no link exists;
- computes token from legacy appointments;
- inserts a local appointment;
- inserts a marketplace booking separately.

Telemedicine booking instead inserts a `consultations` row and stores that ID in `marketplace_bookings.local_appointment_id`.

Cancellation first updates marketplace booking and then separately cancels the local appointment. A failure between statements can leave divergent state. CDB-113D must define one canonical appointment ID for both in-person and telemedicine intent and preserve marketplace rows as channel projections.

The existing auto-connect logic also uses implicit patient-link behavior. Canonical appointment creation must require an explicit canonical tenant patient link and cannot recreate demographic identity inside the appointment command.

### 5.3 Marketplace administration

`src/routes/marketplace-admin.ts` directly updates local appointment status while managing booking workflow. Administrative channel decisions must call one appointment lifecycle command and keep marketplace status as projection/workflow metadata.

### 5.4 Doctor workflow

`src/routes/tenant/doctors.ts` directly marks appointments completed from multiple clinical completion paths and sometimes appends text to appointment notes. The same flows also update visits and queues. Canonical appointment status may become `fulfilled` only with explicit care evidence; clinical notes belong to encounter or clinical documentation, not immutable appointment status history.

### 5.5 Queue workflow

`src/routes/tenant/queue.ts` directly writes appointment status during serving, completion, and no-show transitions. Queue status remains operational workflow. Queue actions may request canonical appointment transitions but cannot independently define appointment lifecycle truth.

### 5.6 Patient portal and patient workflow

`src/routes/tenant/patientPortal.ts` inserts and cancels appointments. `src/routes/tenant/patients.ts` creates follow-up appointments from patient workflows. These must reuse the same canonical appointment command and explicit patient/practitioner mappings rather than creating parallel lifecycle semantics.

### 5.7 Appointment billing finalization

`src/lib/canonical/appointment-billing-finalization.ts` updates legacy appointment billing state while creating canonical financial facts. This remains a compatibility projection. CDB-113D must not import billing status into canonical appointment authority, and appointment lifecycle commands must not reconstruct invoice or payment truth.

## 6. Reader classification

The 30 appointment readers fall into these groups:

- operational appointment lists and detail screens;
- marketplace, patient portal, website, and global portal;
- doctor, reception, queue, and lab workflows;
- billing counter, daily collection, dashboards, and manager reports;
- patient chart, timeline, prescriptions, reminders, WhatsApp, and scheduled notifications;
- FHIR and hospital-link interfaces;
- canonical encounter backfill.

This breadth makes direct cutover unsafe. CDB-113D will provide legacy, shadow, and canonical provider modes with the feature flag disabled. Low-risk provider adapters may be created, but current routes remain legacy until authorised backfill, reconciliation, shadow observation, and rollback evidence exist.

## 7. Target canonical model

### 7.1 `canonical_appointments`

This table owns planned appointment intent. It must include:

- tenant ID and stable appointment public ID;
- patient-link public ID;
- optional requested practitioner public ID;
- optional requested service-item and location public IDs;
- kind, modality, and scheduling channel;
- requested start/end UTC;
- tenant business date and timezone;
- optional token number and token assignment type;
- current status cache and positive status version;
- optional rescheduled-from appointment public ID;
- optional access-controlled request note;
- optional referral practitioner public ID;
- optional quoted amount in integer minor units, currency, quote source, and effective timestamp;
- source evidence hash, created/updated timestamps.

The table must not contain invoice ID, payment status, paid/due amount, discount approval, revenue, refund, queue status, visit status, password/authentication data, patient demographics, practitioner profile data, or marketplace publication fields.

### 7.2 `canonical_appointment_status_events`

This immutable event table owns lifecycle history:

- event public ID;
- appointment public ID;
- positive sequence/version;
- from/to status;
- reason code and optional safe note;
- actor user or system key;
- occurred UTC;
- command idempotency key;
- source evidence hash.

Unique tenant + appointment + sequence and unique tenant + idempotency key are required. Header status/version must agree with the latest event.

Allowed status vocabulary:

- `requested`;
- `scheduled`;
- `confirmed`;
- `arrived`;
- `checked_in`;
- `fulfilled`;
- `cancelled`;
- `no_show`;
- `rescheduled`;
- `entered_in_error`.

### 7.3 `canonical_appointment_encounter_links`

This table explicitly links planned intent to actual care:

- appointment public ID;
- encounter public ID;
- link type;
- link status;
- source evidence hash;
- created and retired UTC.

Allowed link types:

- `fulfilled_by`;
- `converted_to_emergency`;
- `converted_to_inpatient`;
- `approved_manual`.

One active fulfilment encounter per appointment is allowed. An encounter may have only one active originating appointment under the current model. Cancelled, no-show, rescheduled, or entered-in-error appointments cannot receive a normal fulfilment link. Patient-link identity must agree. Practitioner mismatch becomes a processing issue unless explicit reassignment evidence exists.

## 8. Command boundaries

Required commands:

- create appointment intent;
- confirm appointment;
- mark arrived;
- check in appointment;
- mark no-show;
- cancel appointment;
- reschedule appointment by closing old intent and creating new intent;
- fulfil appointment with explicit encounter linkage;
- enter appointment in error;
- link or retire appointment-to-encounter relationship.

Every command requires deterministic identifiers where omitted, tenant scope, exact idempotency replay, conflicting replay rejection, optimistic expected-version checks, source mapping, immutable event creation, and PHI-minimised outbox evidence.

The command API must accept `authoritativeStatements` so legacy appointment/channel/visit/queue compatibility writes can be included in the same atomic batch. A failure in any compatibility, canonical, mapping, event, or outbox statement must roll back the full operation.

## 9. Provider modes

Provider behavior is defined as legacy mode, shadow mode, and canonical mode.

### Legacy mode

Returns current legacy appointment/consultation projection. When an exact source mapping exists, it may expose canonical appointment public ID as compatibility metadata. Identity-sensitive operations fail closed without explicit patient and practitioner mappings.

### Shadow mode

Returns legacy behavior and compares canonical facts by stable public IDs and source mappings. Parity includes:

- patient link;
- requested practitioner;
- appointment kind/modality;
- requested interval and business date;
- token semantics;
- lifecycle status/version;
- reschedule lineage;
- appointment-to-encounter link.

Shadow parity must not compare by patient name, doctor name, phone, complaint text, or time proximity alone.

### Canonical mode

Returns canonical intent, immutable lifecycle projection, explicit identity references, and encounter linkage. Legacy IDs remain compatibility metadata only. Detailed profile, billing, queue, notification, and clinical-document fields are joined from their owning extensions or authorities.

The appointment provider feature flag remains disabled throughout CDB-113D implementation and local verification.

## 10. Backfill rules

The backfill must be bounded, resumable, deterministic, and second-pass safe.

- Every legacy `appointments` row receives a deterministic appointment public ID from tenant + source type + source ID.
- Every telemedicine `consultations` row that represents scheduled intent receives a canonical appointment or a stable ambiguity issue.
- Existing patient and practitioner source mappings are mandatory; missing or ambiguous links create processing issues rather than guessed identity.
- Legacy status maps only through reviewed vocabulary. Unknown or contradictory states create issues.
- Legacy date/time is converted using explicit tenant timezone and business-date evidence; invalid or ambiguous timestamps create issues.
- Billing status and paid/due fields are not copied as appointment status.
- Existing `visits`/canonical encounters may create an appointment-encounter link only through exact legacy appointment/visit evidence.
- Time proximity alone cannot create a link.
- Duplicate patient/practitioner/interval rows are not automatically merged.
- Rerun creates zero new business rows after a completed pass.

## 11. Reconciliation requirements

Persistent aggregate reconciliation must cover:

1. legacy appointment/source mapping cardinality;
2. scheduled telemedicine consultation mapping cardinality;
3. patient-link reference validity;
4. practitioner reference validity;
5. current status versus latest immutable event;
6. valid transition and sequence history;
7. reschedule lineage validity;
8. token uniqueness for applicable active appointments;
9. appointment-to-encounter link cardinality;
10. patient identity agreement across appointment and encounter;
11. forbidden fulfilment links from terminal non-fulfilled statuses;
12. duplicate or overlapping booking evidence;
13. cross-tenant references;
14. unresolved appointment identity or timestamp issues;
15. second-pass zero-new-row proof.

Receipts contain counts, booleans, stable issue fingerprints, and evidence hashes only. They must not contain patient names, phones, complaint text, practitioner names, appointment notes, room URLs, payment details, or credentials.

## 12. Additive migration and safety

CDB-113D uses an additive D1/SQLite-compatible migration, expected as `migrations/0546_canonical_appointment_authority.sql`, plus a dedicated canonical schema module and barrel export.

No existing table is dropped, renamed, or destructively rewritten. No legacy appointment, consultation, schedule, marketplace, visit, queue, billing, patient, practitioner, or encounter row is modified remotely. No feature flag is enabled. No runtime route is switched. No local synchronization entity is added or activated.

## 13. Serial checkpoints

1. `CDB-113D.1-APPOINTMENT-AUTHORITY-AUDIT`
2. `CDB-113D.2-APPOINTMENT-SCHEMA`
3. `CDB-113D.3-APPOINTMENT-COMMANDS`
4. `CDB-113D.4-APPOINTMENT-PROVIDER`
5. `CDB-113D.5-APPOINTMENT-BACKFILL-RECONCILIATION`
6. `CDB-113D-APPOINTMENT-AUTHORITY-VERIFIED`

The next program checkpoint after verified CDB-113D is `CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE`.

## 14. Safety boundaries

Production mutation is not authorised. Local-sync expansion remains paused. Destructive legacy retirement is not authorised.

Do not access production databases, protected exports, credentials, or secrets. Do not deploy, apply migrations or backfills, enable provider flags, change traffic, run production observation, activate local sync, retire legacy writes, push, or integrate CDB to `main` without fresh explicit authorization.

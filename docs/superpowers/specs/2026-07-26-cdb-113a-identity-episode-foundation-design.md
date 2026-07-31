# CDB-113A Identity and Episode Foundation Design

**Program:** HMS Canonical Data Architecture  
**Checkpoint:** `CDB-113A-IDENTITY-EPISODE-FOUNDATION-DESIGN`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Authority matrix:** `docs/database/canonical-authority-matrix.yaml`  
**Access audit:** `docs/database/audits/2026-07-26-canonical-authority-access-audit.md`  
**Execution posture:** design and local verification only  
**Production mutation is not authorised.**  
**Local-sync expansion remains paused.**  
**Destructive legacy retirement is not authorised.**

## 1. Purpose

The HMS already has canonical practitioner, encounter, admission-link, and bed-stay structures, but the operational system still relies on overlapping patient, doctor, appointment, consultation, visit, encounter, admission, bed, and patient-bed tables. These facts are used by clinical workflows, billing, diagnostics, nursing, portal, marketplace, dashboards, reports, reminders, FHIR, synchronization, and background jobs.

The access registry proves the dependency concentration:

- `patients`: 13 writer paths and 141 reader paths;
- `doctors`: 4 writer paths and 72 reader paths;
- `appointments`: 8 writer paths and 30 reader paths;
- `visits`: 9 writer paths and 40 reader paths;
- `encounters`: 2 writer paths and 5 reader paths;
- `admissions`: 7 writer paths and 40 reader paths;
- `beds`: 6 writer paths and 25 reader paths;
- `patient_bed_infos`: 6 writer paths and 10 reader paths.

The next stage must therefore create one shared identity-and-episode foundation rather than fixing these modules independently. The foundation is the dependency boundary for later prescriptions, diagnostics, clinical documents, nursing, emergency, operation theatre, billing attribution, insurance, reporting, portal access, and local synchronization.

The governing statement is:

> Appointment is planned intent; encounter is actual care.

A planned appointment may be cancelled, rescheduled, or never attended. It is not clinical proof that care occurred. An encounter begins only when care starts or a reviewed workflow explicitly creates an actual-care episode. Admission is an inpatient extension of an encounter. A bed stay is a resource-occupancy interval attached to an active admission, not a patient demographic or billing authority.

## 2. Evidence and current-state findings

### 2.1 Patient identity

The tenant `patients` table currently stores demographics, UHID, sync key, duplicate flags, and a direct duplicate-of pointer. `global_patient_identity` stores a cross-hospital identity with UHID, national identity fields, claim state, and global profile fields. `patient_aliases`, guardians, duplicate suspects, global family links, hospital links, and claim codes add separate identity and workflow facts.

There is no canonical table that explicitly states which tenant patient record is linked to which global identity, with effective dates, verification evidence, ambiguity state, merge/unmerge history, and stable source mappings.

The decision is:

- `global_patient_identity remains an external governed authority` for global/MPI identity;
- `patients remains the tenant operational patient record during migration`;
- the canonical program will add an explicit link and immutable link-event authority;
- it will **do not create another patient demographics authority**.

The link model governs identity relationships, not duplicate demographic copies.

### 2.2 Practitioner identity

Canonical practitioner tables already exist and are structurally sound:

- `canonical_practitioners`;
- `canonical_practitioner_user_links`;
- `canonical_practitioner_employee_links`;
- `canonical_practitioner_identifiers`;
- `canonical_practitioner_specialties`;
- `canonical_practitioner_departments`.

Operational authority remains spread across `doctors`, `doctor_auth`, `users`, staff/employee records, and `external_referring_doctors`. The practitioner backfill correctly uses exact registration/user evidence and raises ambiguity. New work should adopt the existing canonical identity rather than adding a second practitioner model.

Name-only practitioner matching is prohibited.

### 2.3 Appointment and consultation

The legacy `appointments` row mixes:

- planning date/time and token;
- patient and doctor references;
- modality/visit type;
- status, check-in, source, and notes;
- chief complaint;
- referral identity;
- fee, original fee, discount, final fee, and billing status.

These are not one authority. Planning, token allocation, patient request, requested practitioner/service, quoted price context, check-in, actual encounter, invoice, collection, and discount are separate facts.

The canonical program currently has no registered appointment authority. Existing encounter backfill rejects scheduled/cancelled appointments as encounter sources and maps an appointment to an encounter only when an exact visit link exists. That separation is correct and must become an explicit model.

### 2.4 Encounter grouping

Legacy actual-care sources include `visits`, `consultations`, `encounters`, `doctor_visits`, admissions, emergency workflows, and consultation completion claims.

The existing encounter backfill already follows two important rules:

- explicit appointment-to-visit links can map to the same encounter when tenant, patient, practitioner, and status evidence agree;
- nearby admission visits are not merged solely by proximity.

One current historical rule maps a consultation to a single visit candidate inside a time window. The target design tightens this: a time-window match may be recorded as candidate evidence, but it must not become an automatic authoritative merge without an explicit source relation, approved reconciliation record, or stable previously reviewed mapping.

Time proximity alone never merges an appointment, consultation, visit, encounter, or admission.

### 2.5 Admission and bed occupancy

`admissions` contains patient, bed, doctor, admission type/source, diagnoses, lifecycle state, care-of fields, fees, and discharge workflow. `beds.status`, `admissions.bed_id`, and `patient_bed_infos` all describe occupancy. `patient_bed_infos` additionally stores rate, calculated days, charge amount, and billing state.

The existing canonical model contains an encounter-admission link and bed-stay intervals, but:

- the admission link remains keyed by legacy admission ID and number;
- no canonical admission public ID and lifecycle event authority exists;
- bed stays remain keyed by legacy bed/admission/patient-bed IDs;
- no canonical care-location/bed resource master exists;
- legacy bed status is still independently mutable.

The target separates resource identity, occupancy, care episode, and billing.

## 3. Non-negotiable identity rules

1. A tenant patient record and a global patient identity are different governed records.
2. A tenant patient may be unlinked, candidate-linked, verified-linked, rejected, retired, merged, or unmerged through explicit state and events.
3. Phone-only patient matching is prohibited.
4. National identity evidence must be verified, unique, and tenant-safe before automatic linking.
5. Name, age, address, guardian name, or approximate date of birth may rank candidates but never authorise an automatic identity merge.
6. A shared phone number, family phone, missing mobile, or recycled phone is not a person key.
7. A practitioner is not the same fact as an authentication user, employee, doctor profile, or external referral contact.
8. Name-only practitioner matching is prohibited.
9. Every ambiguous historical identity becomes a stable issue with reproducible evidence and does not block unrelated deterministic rows.
10. Ambiguous historical evidence creates a stable canonical processing issue.
11. Internal database integer IDs are never used as cross-system identities.
12. Stable public IDs and source mappings are required for all new canonical entities.
13. Merge/unmerge does not destroy clinical or financial history; it changes identity relationships and read resolution.

## 4. Target patient-link model

### 4.1 `canonical_tenant_patient_links`

This table owns the current governed relationship between a tenant patient record and an optional global identity.

Required fields:

- internal ID;
- `tenant_id TEXT NOT NULL`;
- `patient_link_public_id TEXT NOT NULL`;
- `legacy_patient_id INTEGER NOT NULL`;
- `global_patient_uhid TEXT NULL`;
- `link_status TEXT NOT NULL`;
- `verification_level TEXT NOT NULL`;
- `evidence_type TEXT NOT NULL`;
- `evidence_sha256 TEXT NOT NULL`;
- `effective_from_utc TEXT NOT NULL`;
- `effective_to_utc TEXT NULL`;
- `version INTEGER NOT NULL`;
- created/updated UTC timestamps.

Allowed `link_status`:

- `unlinked`;
- `candidate`;
- `verified`;
- `rejected`;
- `merged`;
- `retired`.

Allowed exact evidence examples:

- verified unique UHID;
- approved verified national identity;
- approved claim-code identity;
- explicit authenticated patient claim;
- reviewed manual link;
- migration evidence;
- no-link placeholder.

Invariants:

- one current link row per tenant + legacy patient ID;
- one stable public ID per link lifecycle;
- a verified link requires a non-null global UHID;
- candidate/rejected evidence cannot be consumed as verified identity;
- no automatic merge from phone, name, or proximity;
- evidence hash length and version progression are enforced;
- current state may be updated only by the patient-link command, while history remains immutable in events.

This table does not copy patient name, address, phone, date of birth, sex/gender, national identity, or clinical attributes.

### 4.2 `canonical_tenant_patient_link_events`

This immutable table owns link history and merge/unmerge decisions.

Required fields:

- `patient_link_event_public_id`;
- `patient_link_public_id`;
- tenant and legacy patient ID;
- optional global UHID;
- event type;
- from/to status;
- source/target legacy patient IDs for merge/unmerge events;
- actor user ID or system actor key;
- reason code;
- evidence hash;
- idempotency key;
- sequence/version;
- occurred UTC time.

Allowed event types:

- `registered`;
- `candidate_detected`;
- `verified_linked`;
- `link_rejected`;
- `unlinked`;
- `merged`;
- `unmerged`;
- `retired`.

A merge event does not rewrite historical patient IDs in encounters, invoices, orders, or clinical records. Read resolution follows the active link/relationship, while source mappings preserve original provenance.

### 4.3 Registration and linking command

The `register-or-link-patient` command owns:

- tenant patient creation or reviewed update;
- deterministic link public ID;
- candidate/verified link state;
- link event;
- source mapping;
- idempotency claim;
- processing issue when evidence is ambiguous;
- required audit/outbox evidence;
- temporary legacy/global compatibility changes when explicitly enabled.

All required statements are prepared and committed as one D1 batch. If global identity creation or update is a separately governed external command, the orchestration uses a durable outbox and cannot falsely claim a verified link before the external identity outcome is confirmed.

## 5. Practitioner operational adoption

No replacement practitioner table is required.

### 5.1 Command surface

Create typed commands for:

- create internal practitioner;
- create external practitioner/referrer;
- update practitioner profile metadata;
- activate/deactivate/retire practitioner;
- add/verify/retire identifier;
- link/unlink authentication user;
- link/unlink employee;
- assign specialty/department;
- reconcile legacy doctor or referrer source.

The command layer writes canonical authority first and, while required, co-commits compatibility projections to `doctors` or `external_referring_doctors`. `doctor_auth` remains an authentication workflow only and cannot create a second practitioner identity.

### 5.2 Provider layer

Introduce a practitioner provider used by:

- doctor CRUD and dashboard;
- marketplace/public hospital listings;
- global search;
- appointments and schedule resolution;
- encounter participants;
- lab/radiology participants;
- compensation and reporting;
- invitation and authentication flows.

During shadow mode, canonical and legacy results are compared by stable practitioner public ID/source mapping, not by display name.

## 6. Target appointment model

### 6.1 `canonical_appointments`

This table owns planned appointment intent.

Required fields:

- `tenant_id`;
- `appointment_public_id`;
- `patient_link_public_id`;
- optional `requested_practitioner_public_id`;
- optional `requested_service_item_public_id`;
- optional `requested_location_public_id`;
- appointment kind and modality;
- scheduling channel/source;
- requested start/end UTC;
- tenant business date and timezone;
- token number and token assignment type;
- current status cache and status version;
- rescheduled-from appointment public ID;
- chief complaint/request note as access-controlled planning data;
- optional referral practitioner public ID;
- quoted fee in integer minor units;
- currency code;
- quote source/effective timestamp;
- idempotency key and request fingerprint;
- created/updated UTC timestamps.

The quote is a planning snapshot, not invoice, payment, discount, or revenue authority. Billing status does not belong in canonical appointment authority.

Allowed appointment status vocabulary:

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

Header current status is a guarded projection from the latest event.

### 6.2 `canonical_appointment_status_events`

Immutable status events contain:

- public event ID;
- appointment public ID;
- sequence/version;
- from/to status;
- reason code and safe note;
- actor user/system key;
- occurred UTC time;
- idempotency key;
- source evidence hash.

The database enforces unique appointment + sequence and unique tenant + idempotency key. The command validates allowed transitions. A reschedule closes the old intent with `rescheduled` and creates a new appointment linked by lineage; it does not rewrite the historical schedule.

### 6.3 `canonical_appointment_encounter_links`

This table explicitly links planned intent to actual care.

Required fields:

- tenant ID;
- appointment public ID;
- encounter public ID;
- link type (`fulfilled_by`, `converted_to_emergency`, `converted_to_inpatient`, `approved_manual`);
- source evidence hash;
- link status;
- created/retired UTC timestamps.

Invariants:

- one active fulfilment encounter per appointment;
- an encounter may have at most one originating appointment unless an explicitly governed multi-intent workflow is introduced;
- cancelled/no-show/entered-in-error appointments cannot gain a normal fulfilment link;
- patient-link identity must agree across appointment and encounter;
- practitioner mismatch is an issue unless reassignment history proves the transition.

## 7. Encounter authority hardening

The existing `canonical_encounters` remains the actual-care authority. It will be extended additively rather than replaced.

Target additions:

- nullable then required `patient_link_public_id`;
- optional originating appointment link through the explicit link table;
- lifecycle version;
- care setting/location public ID where available;
- source kind and idempotency metadata required by runtime commands.

`legacy_patient_id` remains a compatibility/source field during migration and becomes non-authoritative after patient-link readiness.

New runtime encounters must not use status `planned`. Historical planned values are classified and migrated to appointment intent or issue state. Actual encounter states are:

- `in_progress`;
- `on_hold`;
- `completed`;
- `cancelled`;
- `entered_in_error`;
- `unknown` only for unresolved migration evidence.

Participant roles remain explicit. Practitioner identity is required for roles that identify a clinician. Missing or ambiguous practitioners produce issues; referrer, prescriber, performer, reporter, verifier, treating, admitting, and consulting roles are never inferred from one another.

## 8. Target admission model

### 8.1 `canonical_admissions`

This table owns the inpatient admission extension.

Required fields:

- `tenant_id`;
- `admission_public_id`;
- `encounter_public_id`;
- `patient_link_public_id`;
- admission number;
- admission type/source;
- status and version;
- admitted UTC time;
- optional discharge UTC time;
- reason and safe coded context;
- optional admitting practitioner public ID through participant authority;
- idempotency/request fingerprint;
- source evidence hash;
- created/updated UTC timestamps.

Allowed states:

- `planned`;
- `admitted`;
- `transfer_pending`;
- `discharge_pending`;
- `discharged`;
- `cancelled`;
- `entered_in_error`.

Invariant: one active admission per inpatient encounter.

### 8.2 `canonical_admission_status_events`

This immutable table records admission, transfer readiness, discharge initiation/approval, discharge, cancellation, correction, and entered-in-error transitions. Header status is a guarded projection.

The existing `canonical_encounter_admission_links` becomes a legacy/source compatibility mapping during migration. It is not the final admission lifecycle authority once `canonical_admissions` is populated and reconciled.

## 9. Care location and bed resource authority

### 9.1 `canonical_care_locations`

This table provides stable tenant-scoped resource identity for facility, branch, floor, ward, room, department care area, and other physical care locations.

Required fields:

- tenant ID;
- location public ID;
- parent location public ID;
- location kind;
- code and display name;
- operational status;
- timezone;
- source evidence and timestamps.

It stores resource identity, not occupancy or price.

### 9.2 `canonical_beds`

This table owns bed resource identity.

Required fields:

- tenant ID;
- bed public ID;
- parent location public ID;
- bed code/number;
- bed type/class;
- operational status (`active`, `inactive`, `maintenance`, `retired`);
- source evidence and timestamps.

Availability/occupied status is derived from open bed stays. A manual `beds.status` field cannot remain independent occupancy truth.

Pricing is a service catalog/effective-price fact, not a bed resource field. Legacy `rate_per_day` is migration evidence and compatibility display until bed-service price convergence.

### 9.3 `canonical_bed_stays`

The existing table remains occupancy truth but is extended additively with:

- `admission_public_id`;
- `bed_public_id`;
- patient-link/encounter consistency guards;
- movement reason;
- version/source command metadata.

Legacy bed/admission/patient-bed IDs remain source fields during migration.

Invariants:

- one open bed stay per bed;
- one open bed stay per active admission unless an approved temporary multi-bed clinical workflow is modelled;
- no overlap for the same bed;
- no overlap for the same admission;
- transfer closes the previous stay and opens the next stay atomically;
- discharge/cancellation closes the active stay;
- a bed under maintenance or retired cannot receive a new stay;
- charge and billing state are not stored as occupancy authority.

## 10. Atomic command boundaries

### 10.1 `register-or-link-patient`

Owns tenant patient/link/event/source mapping/idempotency/issue/outbox as described above.

### 10.2 `create-or-reschedule-appointment`

Owns:

- appointment header;
- first status event or reschedule close/new pair;
- token claim;
- patient and practitioner link validation;
- source mapping;
- idempotency claim;
- audit/outbox;
- temporary legacy appointment compatibility row.

It does not issue an invoice or mark care delivered.

### 10.3 `check-in-and-start-encounter`

Owns:

- guarded appointment transition to checked-in/fulfilled as appropriate;
- actual encounter creation;
- appointment–encounter link;
- treating participant snapshot;
- source mappings;
- idempotency and outbox;
- required legacy appointment/visit/encounter compatibility changes.

This command prevents “completed appointment but no encounter” drift. If a workflow checks in without creating care immediately, it emits `arrived` or `checked_in`; encounter creation occurs only at the reviewed transition.

### 10.4 `admit-patient-and-claim-bed`

Owns:

- inpatient encounter creation or exact conversion from an existing encounter;
- admission header and event;
- admitting participant;
- bed resource validation;
- first bed stay;
- legacy admission/bed compatibility state;
- source mappings/idempotency/outbox;
- optional composition with the already reviewed atomic admission-deposit financial statements.

The financial deposit remains a finance-domain fact. When collected during admission, the orchestration composes reviewed statement builders in one transaction rather than duplicating money fields in admission tables.

### 10.5 `transfer-bed`

Owns:

- current open stay guard;
- destination bed availability/version guard;
- close previous stay;
- open destination stay;
- admission status event when required;
- compatibility bed status projections;
- audit/outbox/idempotency.

### 10.6 `discharge-or-cancel-admission`

Owns:

- admission transition/event;
- encounter transition where clinically valid;
- active bed-stay closure;
- compatibility admission/bed projection;
- durable financial/discharge orchestration event;
- audit/outbox/idempotency.

Clinical discharge, financial clearance, final invoice, deposit/refund, and accounting remain separate domain facts coordinated through explicit commands/outbox. A financial failure cannot silently rewrite the clinical discharge event, and a clinical discharge cannot falsely claim financial settlement.

## 11. Transaction and concurrency requirements

1. Every command validates exact tenant scope and stable public IDs.
2. Idempotency claims use request fingerprints and conflict on mismatched replay.
3. Header updates include expected version/status guards.
4. Token allocation is unique per tenant/practitioner/location/business date according to appointment policy.
5. Patient, practitioner, appointment, encounter, admission, and bed references are resolved before statements are committed.
6. Canonical facts, source mappings, required events, and outbox entries commit together.
7. Compatibility projections commit in the same batch while they remain required.
8. A failed compatibility statement in strict mode fails the whole command; shadow mode records a visible issue without claiming canonical cutover.
9. No completed command depends on a best-effort post-commit write for its required invariants.
10. Race tests cover duplicate booking, double check-in, double admission, double bed claim, concurrent transfer, repeated discharge, stale version, and idempotent replay.

## 12. Historical backfill rules

### 12.1 Patient links

Automatic verified link may use:

- exact unique tenant patient UHID to exact unique global UHID;
- approved claim code/authenticated claim;
- verified unique national identity where verification status and tenant rules are explicit;
- existing reviewed source mapping.

Phone, name, age, address, guardian, or proximity may create a candidate issue only.

### 12.2 Practitioners

Reuse the existing backfill and source mappings. Exact BMDC/registration, explicit user link, approved employee relation, or reviewed source mapping may link. Name-only practitioner matching is prohibited.

### 12.3 Appointments

Every legacy appointment receives one canonical appointment or a rejected/ambiguous mapping issue. Scheduled, cancelled, no-show, and rescheduled rows remain appointment history and never become encounters merely because they exist.

Financial fields become quote/compatibility evidence only. Actual invoice/payment/discount facts stay in finance authority.

### 12.4 Encounters

Priority order:

1. exact existing canonical source mapping;
2. exact legacy encounter identity;
3. exact visit identity;
4. exact appointment foreign key from visit with consistent tenant/patient evidence;
5. exact admission number relation from admission/visit;
6. approved source-reconciliation claim;
7. otherwise create separate actual-care encounter or issue according to source semantics.

Time proximity alone never merges an appointment, consultation, visit, encounter, or admission.

Existing proximity-derived consultation mappings must be classified during rehearsal. They are not silently grandfathered as verified without evidence.

### 12.5 Admissions and bed stays

An admission maps to an encounter by exact source mapping or exact admission number/patient relation. Nearby visits without an explicit relation remain issues.

Bed stays require exact admission, patient, bed, and interval evidence. Overlap, inverted interval, mismatched patient, missing bed, multiple active stays, or duplicate occupancy creates an issue and does not guess a correction.

### 12.6 Backfill mechanics

Each domain uses:

- `canonical_migration_runs`;
- `canonical_backfill_checkpoints`;
- deterministic public IDs;
- source evidence hashes;
- `canonical_source_mappings`;
- `canonical_processing_issues`;
- bounded chunks;
- resumable cursors;
- first-pass counts;
- second-pass zero-new-row proof;
- source snapshot hash/row-count preservation.

## 13. Read-provider architecture

Introduce provider modules with explicit modes `legacy`, `shadow`, and `canonical`:

- patient identity/provider;
- practitioner provider;
- appointment provider;
- encounter provider;
- admission/bed occupancy provider.

Provider rules:

- legacy mode preserves current behaviour;
- shadow mode returns legacy result while comparing canonical keys/counts/statuses/times and recording aggregate differences;
- canonical mode returns canonical authority and may use approved compatibility enrichment only;
- no hidden fallback from canonical to legacy for missing critical facts;
- every fallback is explicit, observable, and bounded;
- API response contracts remain stable or are versioned;
- UI, reports, exports, scheduled jobs, portal, marketplace, search, and hidden admin consumers are included.

Priority readers from the access audit include:

- patients, global search, patient portal, global portal, and health record;
- doctor/marketplace/public listings and invitations;
- appointments, doctor dashboards, queue, reminders, scheduled notifications, and reports;
- patient timeline/summary/chart;
- admissions, nurse station, IPD reports, kitchen, discharge, billing, and doctor views;
- bed allocation, ward views, dashboards, quality KPIs, and finance projections.

## 14. Reconciliation invariants

The protected-clone and pre-cutover suites must prove:

```text
one current canonical patient link per tenant patient
verified patient link -> exactly one global UHID
no verified link from phone-only/name-only evidence
one active practitioner-user link per tenant user
one active practitioner-employee link per tenant staff record
one canonical appointment per mapped legacy appointment
appointment header status/version = latest immutable status event
fulfilled appointment -> exactly one active encounter link
cancelled/no-show appointment -> zero normal fulfilment links
encounter patient link = appointment patient link when linked
one active admission per inpatient encounter
active admission -> one current patient identity and valid encounter
one open bed stay per bed
one open bed stay per active admission
open stay bed/admission/patient identities agree
bed availability projection = absence/presence of open stay
no interval overlap for one bed or one admission
```

Additional required comparisons:

- source and canonical counts by tenant/status/date;
- appointment tokens and duplicate active slot claims;
- appointment fee snapshot versus legacy display values without treating it as invoice parity;
- encounter/admission/bed cardinality;
- participant role attribution;
- signed encounter/addendum preservation;
- legacy bed status versus derived occupancy;
- every ambiguity has a stable issue ID;
- second backfill pass creates zero new canonical facts;
- zero unexplained variance before any canonical provider promotion.

## 15. Cutover sequence

### Preparation

- additive schema and command tests;
- backfill and reconciliation on exact snapshot;
- provider adapters;
- shadow comparisons;
- feature flags disabled by default;
- rollback command/evidence;
- no production action.

### Authorised canary

A later separately authorised canary selects one tenant and one bounded provider/command family. It verifies exact build/migration IDs, backup/bookmark evidence, second-pass stability, smoke workflows, thresholds, observation owner, and rollback owner.

### Rollback

Rollback changes provider/command mode back to legacy or compatibility without deleting canonical evidence. New canonical rows remain immutable audit/backfill evidence. No Time Travel restore occurs unless separately authorised and required by a failed data mutation.

### Retirement

Legacy write removal occurs only after:

- canonical command cutover;
- canonical read promotion;
- observation completion;
- rollback evidence freshness;
- zero unresolved critical issues;
- exact access-registry path clearance;
- fresh owner authorisation.

Legacy tables first become read-only compatibility/history. Destructive removal is a separate final action.

## 16. Security, privacy, and audit

- PHI remains inside approved clinical/identity tables and APIs.
- Outbox, receipts, tracker, logs, and processing issue summaries remain PHI-minimised.
- Evidence hashes prove source stability without copying sensitive fields into Git.
- Link and merge actions require audit actor, reason, evidence, and version.
- Emergency access/consent remains a separate governed authorization layer and does not change identity authority.
- Portal family/proxy relationships remain access relationships, not patient identity merges.
- Authentication credentials remain outside practitioner/patient canonical facts.
- Cross-tenant joins require explicit global identity authorization and consent policy.

## 17. Observability and international-grade operational behaviour

Every command/provider exposes aggregate metrics:

- command attempts, success, replay, conflict, and failure;
- version conflicts;
- unresolved identity/episode issues;
- provider comparison counts and variance classes;
- appointment transition errors;
- encounters without patient links;
- active admissions without bed stays where policy requires a bed;
- overlapping/open bed-stay violations;
- compatibility projection failures;
- outbox lag and dead-letter count.

Operational dashboards show stable IDs and drill-down references without logging PHI. Alerts are threshold-based and tenant-scoped. Runbooks define owner, abort threshold, rollback command, and evidence location.

## 18. Decisions

1. Keep `global_patient_identity` external-governed; add canonical relationship governance, not duplicate demographics.
2. Keep tenant `patients` operational during migration and route new writes through a shared command.
3. Reuse canonical practitioner authority; do not create a second doctor/practitioner model.
4. Add canonical appointment authority because planned intent is a material missing business fact.
5. Keep canonical encounters as actual-care authority and remove planned appointment semantics from new encounter writes.
6. Add canonical admission lifecycle because a legacy-ID link is not a complete inpatient extension.
7. Add canonical care-location and bed resource authority; derive occupancy from bed stays.
8. Keep price/billing facts outside appointment, admission, and bed resource authority.
9. Preserve signed clinical and historical source facts; corrections use events/addenda/mappings, not deletion.
10. Treat static access registry as mandatory dependency evidence but not production-retirement proof.

## 19. Implementation checkpoints

- `CDB-113B-PATIENT-LINK-FOUNDATION`
- `CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION`
- `CDB-113D-APPOINTMENT-AUTHORITY`
- `CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE`
- `CDB-113F-IDENTITY-EPISODE-READ-PROMOTION`

All checkpoints use additive migrations only until separately authorised retirement. Each checkpoint has RED tests, focused verification, canonical suite, TypeScript, three governance gates, migration manifest, tracker/control-center/handoff/receipt updates, and a clean checkpoint commit.

## 20. Stop conditions

Stop and request a new explicit decision before:

- production or protected-clone access not already authorised;
- secret or credential access;
- deployment, migration application, backfill, flag, or traffic change;
- local-sync runtime connection or activation;
- automatic identity merge from ambiguous evidence;
- changing signed clinical history;
- destructive table/column removal;
- retiring a writer/reader while the access registry still shows active dependency;
- push or CDB-to-main integration;
- creating a new table that duplicates an authority defined here.

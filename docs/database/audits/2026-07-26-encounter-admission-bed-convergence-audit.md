# CDB-113E Encounter, Admission, and Bed Convergence Audit

**Date:** 2026-07-26
**Program:** HMS Canonical Data Architecture
**Checkpoint:** `CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE`
**Branch:** `program/cdb-main-continuous-20260725`
**Authoritative worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`
**Reviewed main-sync preflight commit:** `3a52387b7`
**Production access or mutation:** none
**Feature-flag activation:** none
**Local-sync expansion:** none
**Legacy retirement:** none

## 1. Purpose

This audit defines the exact CDB-113E authority boundary before any encounter, admission, care-location, bed-resource, or bed-stay schema change. The HMS already has an additive canonical encounter foundation, source mappings, encounter participants, encounter/admission compatibility links, and legacy-ID-based bed stays. The operational system, however, still treats several independently mutable rows as authority for the same care episode and occupancy facts.

Current actual-care state is spread across `encounters`, `visits`, `consultations`, appointment completion paths, emergency workflows, FHIR import, doctor workflows, and the canonical encounter backfill. Current inpatient state is spread across `admissions`, `visits`, `canonical_encounter_admission_links`, provisional discharge rows, discharge planning, approvals, death records, billing discharge, and nursing assignments. Current occupancy is independently represented by `beds.status`, `admissions.bed_id`, `admissions.previous_bed_id`, transfer flags, open `patient_bed_infos`, bed reservations, cleaning state, and multiple reporting queries.

The target is not one oversized IPD table. The target is five explicit authorities:

1. hardened `canonical_encounters` for actual care;
2. canonical admission header and immutable admission events for the inpatient extension;
3. canonical care-location identity;
4. canonical bed-resource identity;
5. canonical bed-stay intervals for occupancy truth.

Financial clearance, admission fee, bed rate, calculated bed charge, provisional billing, final invoice, deposit, refund, accounting, and discharge bill status remain finance or service facts. They may be composed with clinical commands, but they are not copied into canonical admission lifecycle or occupancy authority.

## 2. Non-negotiable architecture decisions

- Encounter is actual care.
- Admission is an inpatient extension linked to one encounter.
- Bed is resource identity.
- Bed stay is interval-based occupancy truth.
- Clinical discharge is not financial settlement.
- Bed price is not bed identity or occupancy truth.
- Billing fields are not canonical admission lifecycle authority.
- Patient demographics are not copied; canonical episode rows reference `patient_link_public_id`.
- Practitioner profiles, names, authentication users, and employee rows are not copied; participants reference canonical practitioner public IDs.
- Admission number is a tenant-scoped business identifier, not a cross-system identity by itself.
- Ward name, floor text, room labels, bed number text, numeric-ID coincidence, and time proximity are never sufficient identity or episode-link evidence.
- `beds.status='occupied'` is a legacy projection. Occupancy is derived from an open canonical bed stay.
- `admissions.bed_id` is a legacy current-bed projection. It is not interval history.
- `patient_bed_infos` currently mixes occupancy, price snapshots, duration calculations, charge amounts, and billing flags. Canonical occupancy must not inherit its money or billing columns.
- An admission transfer closes one stay and opens another atomically. It does not rewrite historical occupancy.
- Discharge or cancellation closes the active stay. Re-admission or discharge cancellation creates a reviewed new lifecycle event and, where valid, a new stay; it does not reopen a historical interval by destructive update.
- Signed clinical snapshots and addenda remain immutable and are not rewritten by admission or financial workflow.
- Existing canonical tables are extended additively. No parallel `financial-reconciliation` or second canonical architecture is introduced.
- Provider feature flags remain disabled until CDB-113F read-promotion evidence.

## 3. Current canonical foundation and exact gaps

### 3.1 Existing encounter authority

`migrations/0507_canonical_encounters.sql` and `src/db/schema/canonical/clinical.ts` currently provide:

- `canonical_encounters`;
- `canonical_encounter_participants`;
- `canonical_encounter_admission_links`;
- `canonical_encounter_addenda`;
- `canonical_bed_stays`.

This is the authoritative foundation and must be extended, not replaced. Current strengths include tenant-scoped encounter public IDs, controlled encounter types, participant roles, signed-snapshot evidence, addenda, deterministic source mappings through backfill, and explicit compatibility links for admissions.

Current encounter gaps are material:

- `canonical_encounters` still uses required `legacy_patient_id` instead of canonical `patient_link_public_id`;
- status still permits `planned`, which belongs to appointment intent rather than actual care;
- there is no positive encounter lifecycle version;
- there is no immutable encounter lifecycle-event authority;
- source kind and command idempotency metadata are incomplete for universal runtime adoption;
- care-setting/location public ID is absent;
- encounter provider modes do not exist;
- existing backfill maps sources but has no persistent encounter/admission/bed reconciliation receipt.

CDB-113E hardens the existing encounter table additively. It does not create a second encounter table.

### 3.2 Existing admission compatibility link

`canonical_encounter_admission_links` currently contains:

- tenant ID;
- canonical encounter public ID;
- legacy admission integer ID;
- admission number;
- link status;
- source evidence hash.

It is useful migration evidence, but it is not a canonical admission lifecycle. It has no `admission_public_id`, patient-link reference, admission status/version, admitted/discharged interval, source/type policy, immutable status events, idempotency key, or explicit command metadata. It also enforces one legacy admission per encounter, but it cannot represent planned, admitted, transfer-pending, discharge-pending, discharged, cancelled, or entered-in-error history.

The link remains a compatibility/source table during migration. `canonical_admissions` becomes admission authority after backfill and reconciliation.

### 3.3 Existing bed-stay compatibility shape

`canonical_bed_stays` currently contains legacy patient-bed, admission, and bed integer IDs plus encounter public ID and interval. It lacks:

- canonical admission public ID;
- canonical bed public ID;
- canonical patient-link guard;
- positive stay version;
- movement reason;
- source command/idempotency metadata;
- database-enforced one-open-stay-per-bed and one-open-stay-per-admission rules;
- overlap protection against other intervals;
- canonical bed operational-state validation.

The table remains the target occupancy authority but requires additive public-ID and concurrency hardening.

### 3.4 Missing resource masters

No canonical care-location or bed-resource master exists. Legacy `beds` combines:

- ward name;
- bed number;
- bed type;
- mutable availability/occupied/maintenance/reserved/cleaning status;
- floor;
- notes;
- `REAL` rate per day.

This mixes stable resource identity, occupancy projection, operational readiness, display metadata, and price. CDB-113E introduces canonical location and bed identity without importing occupancy or price as resource truth.

## 4. Exact access evidence

The deterministic access registry records exact `path + table` pairs. Counts below are current after the reviewed `main` merge and access-registry regeneration.

### 4.1 Canonical encounter and occupancy tables

- `canonical_encounters`: 4 writers and 12 readers.
- `canonical_encounter_participants`: 2 writers and 0 readers.
- `canonical_encounter_admission_links`: 1 writer and 4 readers.
- `canonical_bed_stays`: 2 writers and 2 readers.

Canonical encounter writers are:

1. `scripts/canonical/backfill-encounters.ts` — migration/backfill insert;
2. `src/lib/canonical/commands/start-encounter.ts` — runtime canonical insert/update;
3. `src/lib/canonical/commands/finalize-ipd-discharge-billing.ts` — canonical encounter update;
4. `src/lib/canonical/local-sync-business-apply.ts` — offline canonical apply contract, not runtime activation.

Canonical participant writers are the encounter backfill and start-encounter command. No registered reader currently consumes `canonical_encounter_participants`, which proves participant read promotion is absent.

The only registered writer to `canonical_encounter_admission_links` is the encounter backfill. The only registered writers to `canonical_bed_stays` are encounter backfill and IPD discharge finalization. There is no canonical admission creation, transfer, or bed-claim command yet.

### 4.2 Legacy actual-care episode sources

- `encounters`: 2 writers and 5 readers.
- `visits`: 9 writers and 42 readers.
- `consultations`: 3 writers and 11 readers.
- `doctor_visits`: 0 writers and 0 readers in the deterministic current source scan.

Legacy encounter writers:

- `src/routes/tenant/clinical/encounters.ts`;
- `src/routes/tenant/doctors.ts`.

Legacy visit writers:

- `src/routes/tenant/appointments.ts`;
- `src/routes/tenant/billingCounter.legacy.ts`;
- `src/routes/tenant/doctors.ts`;
- `src/routes/tenant/emergency.ts`;
- `src/routes/tenant/fhir.ts`;
- `src/routes/tenant/nursing/opd.ts`;
- `src/routes/tenant/queue.ts`;
- `src/routes/tenant/reception.ts`;
- `src/routes/tenant/visits.ts`.

Legacy consultation writers:

- `src/routes/marketplace-patient.ts`;
- `src/routes/tenant/consultations.ts`;
- `src/routes/tenant/patients.ts`.

A targeted mutation search found:

- 6 literal `encounters` mutation references;
- 26 literal `visits` mutation references;
- 7 literal `consultations` mutation references.

These 39 literal references are not endpoint counts. They prove that actual-care status and identity are still independently mutable across doctor, queue, FHIR, emergency, reception, marketplace, nursing, billing-counter, and patient workflows.

The reviewed `src/routes/tenant/appointment-paid-context.ts` is a new legacy reader of `visits` together with appointment and financial tables. It enriches booking display and eligibility; it must not become episode authority.

### 4.3 Legacy admission and occupancy sources

- `admissions`: 7 writers and 40 readers.
- `beds`: 6 writers and 25 readers.
- `patient_bed_infos`: 6 writers and 10 readers.

Admission writers:

1. `src/routes/tenant/admissions.ts`;
2. `src/routes/tenant/approvals.ts`;
3. `src/routes/tenant/deathRecords.ts`;
4. `src/routes/tenant/dischargePlanning.ts`;
5. `src/routes/tenant/ipBilling.ts`;
6. `src/routes/tenant/nursing/assignments.ts`;
7. `src/routes/tenant/reception.ts`.

Bed writers:

1. `src/lib/bed-allocation.ts`;
2. `src/routes/tenant/admissions.ts`;
3. `src/routes/tenant/deathRecords.ts`;
4. `src/routes/tenant/dischargePlanning.ts`;
5. `src/routes/tenant/ipBilling.ts`;
6. `src/routes/tenant/reception.ts`.

Patient-bed-info writers:

1. `src/lib/bed-charges.ts`;
2. `src/routes/tenant/admissions.ts`;
3. `src/routes/tenant/deathRecords.ts`;
4. `src/routes/tenant/dischargePlanning.ts`;
5. `src/routes/tenant/ipBilling.ts`;
6. `src/routes/tenant/reception.ts`.

A targeted mutation search found:

- 24 literal `admissions` mutation references;
- 28 literal `beds` mutation references;
- 17 literal `patient_bed_infos` mutation references.

That is 69 literal admission/bed/occupancy mutation references across current source. This is evidence of authority spread, not a count of business endpoints.

## 5. Current legacy data shapes

### 5.1 `admissions`

The base admission row and later migrations combine:

- tenant, admission number, patient, bed, and doctor legacy IDs;
- admission type, source, emergency flag, reason, department, and procedure type;
- admission and discharge timestamps;
- provisional and final diagnoses;
- current status;
- previous bed and transfer state/timestamps/remarks;
- provisional discharge state and notes;
- discharge initiation, approval, cancellation, condition, and type;
- billing discharge markers and due-clearance markers;
- bill status on discharge;
- package/billing mode and admission fee;
- care-of demographics and referral-doctor text;
- nurse assignment;
- police-case flag;
- free-form notes and audit timestamps.

This row contains at least five different fact groups: admission lifecycle, current occupancy projection, clinical context, workflow approvals, and financial/display state. CDB-113E does not copy all of them into `canonical_admissions`.

Canonical admission owns only the inpatient extension, patient/encounter relation, safe coded reason/context, lifecycle status/version, admitted/discharged interval, source/idempotency evidence, and immutable status events. Diagnoses remain clinical documentation. Care-of details remain access-controlled demographic/workflow data. Package, fee, billing mode, due clearance, and bill status remain financial workflow.

### 5.2 `beds`

Legacy `beds` owns resource labels and an independently mutable `status`. The route permits create, edit, manual status update, cleaning completion, ward rename, and physical delete if not currently marked occupied. The same row also stores `rate_per_day REAL`.

Target separation:

- `canonical_care_locations` owns facility/floor/ward/room/care-area hierarchy;
- `canonical_beds` owns bed identity and operational availability for service (`active`, `inactive`, `maintenance`, `retired`);
- open `canonical_bed_stays` derive occupied versus unoccupied;
- cleaning/reservation may remain explicit operational workflow extensions until separately converged;
- bed rate becomes service-catalog/effective-price compatibility evidence, not bed identity.

Hard deletion of a canonical bed is prohibited after source mapping or occupancy history. Retirement is a lifecycle transition.

### 5.3 `patient_bed_infos`

Legacy `patient_bed_infos` stores:

- patient, admission, and bed legacy IDs;
- copied ward, bed number, and bed type labels;
- `REAL` rate per day;
- start/end timestamps;
- calculated days and charge amount;
- billed flag and bill ID.

Only the source relation and interval are occupancy evidence. Copied labels are snapshots. Rate, days, charge amount, billed flag, and bill ID are billing/projection facts. Canonical bed stays must not use `REAL` money or billing state.

## 6. Writer classification and lifecycle risks

### 6.1 Admission creation

`src/routes/tenant/admissions.ts` performs a useful atomic legacy batch for admission insert, bed occupation, reservation transition, and first `patient_bed_infos` row. It also uses a mutation-idempotency reservation and sequence-based admission number.

The remaining gaps are architectural:

- patient and practitioner dependencies use legacy IDs rather than canonical links;
- admission creation does not create or require a canonical inpatient encounter/admission public ID;
- `beds.status` and `patient_bed_infos` are treated as occupancy authority;
- one active admission is guarded by a legacy status query, not canonical encounter/admission uniqueness;
- admission fee is written after the core batch as provisional billing, so financial composition is not one reviewed canonical boundary;
- source mapping, immutable admission event, canonical outbox, and expected-version semantics are absent.

`src/routes/tenant/reception.ts` independently inserts admissions, changes bed status, and inserts patient-bed rows. This is a competing admission/occupancy creation path and must call one canonical command.

### 6.2 Bed resource management

`src/routes/tenant/admissions.ts` creates and updates legacy beds, allows reception to update status, clears cleaning state, bulk-renames wards, and physically deletes non-occupied beds. `src/lib/bed-allocation.ts` provides conditional updates that reduce double-allocation races, but it still uses mutable `beds.status` as truth.

The helper is valuable compatibility logic, not the final authority. CDB-113E command guards must claim a canonical bed through an open-stay uniqueness constraint and expected resource version. Legacy status updates become caller-supplied compatibility statements.

### 6.3 Transfer flows

The admission route implements:

- immediate transfer;
- pending-receive transfer;
- receive transfer;
- undo transfer;
- previous-bed availability checks.

Immediate transfer closes the open legacy patient-bed row, updates `admissions.bed_id`, marks old bed cleaning, marks new bed occupied, and inserts a new patient-bed row in one batch. Pending receive, however, reserves/occupies the destination bed before the old stay is closed and records `admissions.status='transferred'` with a separate `transfer_status`. Undo transfer changes bed statuses without always creating or closing interval history. These variants prove the need for an explicit canonical transition model.

Canonical transfer must:

- require the active admission and current open stay;
- require expected admission and stay versions;
- validate destination canonical bed operational status;
- reject another open stay for the destination;
- close current stay and open destination stay atomically when transfer becomes effective;
- represent pending transfer as admission/status event or controlled workflow projection without falsely moving occupancy;
- preserve the old and new intervals;
- execute legacy admission/bed/patient-bed compatibility statements in the same strict batch.

### 6.4 Discharge and cancellation spread

Admission terminal state is independently mutated by:

- admission cancellation;
- provisional discharge and undo;
- billing clearance;
- billing discharge;
- clinical/discharge-planning flows;
- approval flows;
- death records;
- IP billing finalization;
- credit discharge and other admission endpoints.

Several flows batch admission status, patient-bed closure, and bed cleaning. Others update admission workflow fields independently. `src/lib/canonical/commands/finalize-ipd-discharge-billing.ts` already updates canonical encounter and bed-stay state while composing canonical finance, but it relies on the legacy admission compatibility link and does not own canonical admission lifecycle events.

CDB-113E must make clinical admission transition explicit and versioned. Financial clearance remains a separate fact. A command may coordinate both through reviewed statement builders, but clinical discharge cannot claim an invoice is paid, and financial settlement cannot silently discharge the patient.

### 6.5 Death records

`src/routes/tenant/deathRecords.ts` can mark admission discharged, close patient-bed history, and mark bed cleaning. Death is a clinical terminal reason, not a separate occupancy authority. It must request the same canonical discharge command with a typed reason and preserve death-record workflow separately.

### 6.6 Nursing assignment

`src/routes/tenant/nursing/assignments.ts` updates `admissions.nurse_id`. Nurse assignment is a participant/work-assignment fact, not admission identity. CDB-113E does not copy `nurse_id` into admission authority. It should remain a controlled extension or move to participant/assignment authority in a later domain checkpoint.

## 7. Reader classification and migration risk

### 7.1 Encounter readers

Legacy `visits` has 42 readers across billing, diagnostics, patient timeline/chart/summary, reception, doctors, queue, nursing, FHIR, quality KPIs, reports, analytics, scheduled work, and the new paid-context route. `encounters` and `consultations` add clinical/telemedicine readers.

This breadth means CDB-113E must implement disabled providers but must not promote routes. CDB-113F owns measured read promotion.

### 7.2 Admission readers

The 40 admission readers include:

- admissions and reception;
- billing, provisional billing, deposits, and daily collection;
- discharge and discharge planning;
- death records;
- doctors and doctor rounds;
- global search and patient chart/timeline;
- IP billing and IPD reports;
- nurse station, assignments, handover, diet, medication, and ward views;
- kitchen;
- manager dashboard and quality KPIs;
- predictive analytics, reports, and prescriptions;
- accounting and finance reporting helpers.

The reviewed main merge also expanded admission-slip display with age, admission time, and admitting-user context. Those are response-enrichment concerns. They must consume an admission provider later but do not change admission authority.

### 7.3 Bed and occupancy readers

The 25 bed readers and 10 patient-bed readers drive:

- bed/ward availability screens;
- admission and transfer guards;
- discharge and death workflows;
- nurse station and nursing ward views;
- kitchen census;
- doctor and patient chart views;
- IP billing, billing summaries, and bed charges;
- reports, dashboards, quality KPIs, and manager dashboard;
- canonical backfill and IPD projection.

Canonical mode cannot silently fall back to `beds.status` or the latest `patient_bed_infos` row when a critical stay is missing. Missing occupancy evidence must be observable and fail closed for mutation.

## 8. Target canonical model

### 8.1 Encounter hardening

CDB-113E extends `canonical_encounters` additively through `migrations/0548_canonical_encounter_admission_bed_convergence.sql` and `src/db/schema/canonical/clinical.ts`.

Required additions:

- nullable then backfill-required `patient_link_public_id`;
- positive `encounter_version`;
- optional `care_location_public_id`;
- controlled `source_kind`;
- nullable source command/idempotency metadata where existing rows require staged population;
- source evidence and tenant-scoped indexes/FKs.

New runtime actual-care status must exclude `planned`. The target actual-care states are `in_progress`, `on_hold`, `completed`, `cancelled`, `entered_in_error`, with `unknown` allowed only for unresolved historical evidence. Migration must classify existing planned rows rather than pretending they are actual care.

CDB-113E may introduce encounter lifecycle events only if required to version admission-linked transitions safely and consistently with existing command contracts. It must not create a replacement encounter header.

### 8.2 `canonical_admissions`

This table owns the inpatient admission extension.

Required fields:

- tenant ID;
- `admission_public_id`;
- `encounter_public_id`;
- `patient_link_public_id`;
- tenant-scoped admission number;
- admission type and source;
- current status and positive version;
- admitted UTC;
- optional discharged UTC;
- safe reason/code context;
- request fingerprint and idempotency key or equivalent command evidence;
- source evidence hash;
- created/updated UTC.

Allowed states:

- `planned`;
- `admitted`;
- `transfer_pending`;
- `discharge_pending`;
- `discharged`;
- `cancelled`;
- `entered_in_error`.

Required invariant: one active admission per inpatient encounter. Active means any nonterminal lifecycle state that represents an open inpatient extension.

The table must not contain patient name/phone/address, care-of demographics, diagnosis narrative, admission fee, package ID, billing mode, due clearance, bill status, calculated bed charge, current bed integer ID, copied ward/bed labels, or payment/deposit state.

### 8.3 `canonical_admission_status_events`

This immutable table owns admission lifecycle history:

- event public ID;
- admission public ID;
- event type;
- nullable from status and required to status;
- positive sequence/version;
- reason code and optional safe note;
- actor user public ID or system key;
- command idempotency key;
- source evidence hash;
- occurred/created UTC.

Header status/version must equal the latest event. Transition validation belongs in the command layer. Unique tenant + admission + sequence and unique tenant + idempotency key are required.

### 8.4 `canonical_care_locations`

This table owns stable physical care-location identity:

- tenant ID;
- `location_public_id`;
- optional parent location public ID;
- kind such as facility, branch, floor, ward, room, department care area, or other;
- stable code;
- display name;
- operational status;
- timezone;
- source evidence and timestamps.

It does not own occupancy, bed price, patient assignment, clinical documentation, or billing.

### 8.5 `canonical_beds`

This table owns bed resource identity:

- tenant ID;
- `bed_public_id`;
- parent `location_public_id`;
- stable bed code/number;
- type/class;
- operational status (`active`, `inactive`, `maintenance`, `retired`);
- positive version;
- source evidence and timestamps.

Bed identity does not include `occupied`, `available`, rate per day, charge amount, bill ID, patient ID, or admission ID. Occupied versus unoccupied is derived from open stays.

### 8.6 `canonical_bed_stays`

Extend the existing table with:

- `admission_public_id`;
- `bed_public_id`;
- `patient_link_public_id` or an enforced derivation/consistency link;
- positive version;
- movement reason;
- source command/idempotency metadata;
- compatibility legacy IDs retained as source fields.

Required invariants:

- one open bed stay per bed;
- one open bed stay per active admission;
- no overlap for the same bed;
- no overlap for the same admission;
- admission, encounter, and patient identities agree;
- transfer closes prior stay and opens destination stay atomically;
- discharge/cancellation closes the active stay;
- inactive, maintenance, or retired bed cannot receive a new stay;
- rate, duration charge, billed flag, and bill ID are excluded.

SQLite partial unique indexes can enforce open-stay cardinality. Historical interval-overlap validation also requires command/backfill/reconciliation checks because arbitrary interval overlap cannot be fully expressed by a simple unique index.

## 9. Atomic command boundaries

### 9.1 `manage-care-location-and-bed`

Owns canonical location/bed creation, update, maintenance/inactive/retired transitions, source mapping, optimistic version, idempotency, outbox, and required legacy resource compatibility statements.

It must reject physical deletion after mapped history and must not manually set occupied/available. Cleaning/reservation can remain an explicit compatibility/operational extension until separately modeled.

### 9.2 Encounter hardening/start command

Extend the existing `start-encounter` command rather than building a parallel framework. It must require canonical patient link for new runtime encounters, positive expected version for updates, exact practitioner participants, typed source kind, exact replay, and PHI-minimised outbox evidence.

### 9.3 `admit-patient-and-claim-bed`

Owns:

- exact patient-link, encounter, and practitioner validation;
- inpatient encounter creation or reviewed conversion from an existing encounter;
- admission header and first immutable event;
- admitting participant;
- optional first bed stay;
- destination bed operational/version and open-stay guards;
- admission and occupancy source mappings;
- exact idempotency replay and conflicting replay;
- PHI-minimised outbox;
- `authoritativeStatements` for legacy admission, bed, patient-bed, reservation, audit, and optional reviewed admission-deposit composition.

The command may compose canonical financial statement builders, but it never copies deposit/payment authority into admission rows.

### 9.4 `transfer-bed`

Owns:

- exact admission/current-stay read;
- admission and stay expected version;
- destination bed expected version and operational status;
- no-open-stay destination guard;
- close current stay;
- open destination stay;
- immutable admission status event when pending/effective transfer changes lifecycle;
- source mappings, outbox, and idempotency;
- atomic legacy compatibility statements.

Race tests must cover double bed claim and concurrent transfer.

### 9.5 `discharge-or-cancel-admission`

Owns:

- exact admission and active-stay read;
- expected admission version;
- allowed transition and immutable event;
- active stay closure;
- clinically valid encounter transition through the existing canonical command contract;
- typed terminal reason including normal discharge, death, cancellation, or entered-in-error;
- durable cross-domain orchestration evidence;
- legacy compatibility statements;
- exact replay and repeated discharge protection.

Clinical discharge is not financial settlement. Financial clearance may be required by orchestration policy, but it remains a separate verified input/fact.

### 9.6 Transaction and concurrency contract

Every command must:

- use the existing canonical batch/idempotency framework;
- perform exact idempotency replay before state-dependent validation;
- require expected version for mutable canonical headers/resources;
- commit canonical rows, events, mappings, outbox, and strict compatibility statements together;
- fail the entire command when a required compatibility statement fails;
- avoid best-effort required writes after commit;
- preserve tenant scope in every lookup and mutation;
- test double admission, double bed claim, concurrent transfer, stale version, repeated discharge, conflicting replay, and transaction rollback.

## 10. Disabled provider architecture

CDB-113E adds two disabled providers:

- `canonical_encounter_provider_v1`;
- `canonical_admission_bed_provider_v1`.

Each supports legacy mode, shadow mode, and canonical mode.

Provider rules:

- missing, disabled, malformed, or unsupported configuration returns legacy mode;
- shadow mode returns current legacy response while comparing canonical stable keys, counts, statuses, intervals, locations, beds, and links;
- canonical mode returns canonical authority and may use approved compatibility enrichment only;
- no hidden critical fallback from canonical to legacy;
- identity-sensitive operations require exact source mappings and patient/practitioner links;
- admission/bed mutation adapters fail closed when canonical admission, bed, or open-stay evidence is missing;
- names, phone, admission labels, room labels, ward names, bed-number text, legacy numeric IDs, and time proximity are not identity evidence;
- response contracts remain stable or explicitly versioned;
- feature flags remain disabled throughout CDB-113E.

The new paid-visit context and admission-slip display surfaces are registered provider consumers for later CDB-113F promotion. CDB-113E may provide disabled-safe adapters, but it does not switch those routes.

## 11. Backfill contract

Backfill must be bounded, resumable, deterministic, and second-pass safe.

Suggested ordered partitions:

1. encounter hardening and patient-link resolution for existing canonical encounters;
2. canonical care locations from stable legacy floor/ward/room evidence;
3. canonical beds from exact legacy bed rows and location mapping;
4. canonical admissions from exact legacy admission-to-encounter mapping;
5. canonical bed-stay hardening from exact patient-bed/admission/bed mappings;
6. issue-only classification for unresolved or conflicting rows.

Automatic mapping evidence may use:

- existing reviewed canonical source mapping;
- exact tenant patient link;
- exact legacy encounter/visit/consultation/admission identity;
- exact admission number plus patient relation where unique;
- exact legacy bed row plus unique tenant ward/bed source identity;
- exact patient-bed admission/bed relation and valid interval.

It may not use names, phone, diagnosis text, care-of data, room labels alone, numeric-ID coincidence across unrelated tables, or time proximity alone.

Every ambiguity persists a stable issue. Overlapping stays, multiple open stays, patient mismatch, missing bed, missing admission, maintenance-bed occupancy, inverted intervals, duplicate admission numbers, and encounter/admission conflict must not be guessed away.

Second pass creates zero new business rows. Source evidence drift creates an issue and does not silently rewrite a mapped canonical fact.

## 12. Persistent reconciliation contract

CDB-113E must persist aggregate reconciliation receipts covering at least:

- encounter patient-link validity;
- encounter status/version validity and exclusion/classification of planned runtime state;
- encounter source mapping cardinality;
- participant practitioner/tenant validity;
- admission mapping cardinality;
- one active admission per inpatient encounter;
- admission header/latest-event parity;
- admission and encounter patient agreement;
- admission interval and terminal-time validity;
- bed resource mapping validity;
- location hierarchy/tenant validity;
- open-stay cardinality per bed;
- open-stay cardinality per active admission;
- interval overlap per bed;
- interval overlap per admission;
- encounter/admission/patient/bed consistency;
- inactive/maintenance/retired bed occupancy;
- legacy bed status versus derived occupancy;
- unresolved encounter/admission/bed issues;
- cross-tenant references;
- second-pass zero-new-row evidence.

Receipts contain aggregate counts and deterministic hashes only. They must not include patient names, phone, address, guardian/care-of data, diagnoses, notes, admission reason narrative, bed-price values, bill IDs, or other PHI/financial row content.

## 13. Cutover and retirement gates

Local implementation does not authorise cutover. CDB-113E completion means schema, commands, providers, backfill, reconciliation, registries, tests, and receipt are locally verified.

Runtime promotion requires CDB-113F and later operational authorization:

- complete consumer/provider registry;
- production-authorised backfill and persistent reconciliation;
- zero unexplained critical variance;
- measured shadow observation;
- error and latency budgets;
- rollback commands and fresh evidence;
- owner authorization;
- staged route promotion;
- observation after each promotion.

Legacy retirement remains blocked until all writers are cut over and readers are promoted. `admissions`, `beds`, `patient_bed_infos`, `visits`, `consultations`, and `encounters` cannot be dropped during CDB-113E. Signed clinical history is never deleted. Legacy bed-charge and billing snapshots may be archived only after financial/service authority and legal retention requirements are satisfied.

## 14. Safety boundaries

Production mutation is not authorised.

Local-sync expansion remains paused.

Destructive legacy retirement is not authorised.

CDB-113E must not:

- access production, protected exports, credentials, or secrets;
- apply migrations/backfills remotely;
- enable encounter or admission/bed provider flags;
- change route traffic;
- activate workers, schedulers, or local sync;
- delete legacy tables or columns;
- physically delete canonical resources with history;
- push or integrate CDB back to `main`;
- revive `src/lib/financial-reconciliation/**` or a separate canonical-finance branch.

## 15. Exact implementation direction

The serial plan is `docs/superpowers/plans/2026-07-26-cdb-113e-encounter-admission-bed-convergence.md`.

The checkpoint proceeds through:

1. this audit and design contract;
2. additive schema and governance;
3. encounter hardening and admission/resource/occupancy commands;
4. disabled encounter and admission/bed providers;
5. bounded backfill and persistent reconciliation;
6. final receipt, tracker, control center, handoff, governance, full verification, and clean commits.

The exact next checkpoint after verified CDB-113E implementation is `CDB-113F-IDENTITY-EPISODE-READ-PROMOTION`.

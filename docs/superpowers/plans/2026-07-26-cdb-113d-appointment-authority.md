# CDB-113D Appointment Authority Implementation Plan

**Program:** HMS Canonical Data Architecture  
**Checkpoint:** `CDB-113D-APPOINTMENT-AUTHORITY`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Execution mode:** single-agent continuous, local-only implementation and verification  
**Production mutation authorised:** no  
**Appointment provider activation authorised:** no  
**Local-sync expansion authorised:** no  
**Legacy retirement authorised:** no

## 1. Goal

Implement one additive canonical appointment authority for planned care intent, immutable lifecycle history, and explicit appointment-to-encounter linkage. Preserve existing operational routes through atomic compatibility boundaries and a disabled provider. Do not make appointment authority own encounter, billing, schedule, marketplace profile, patient demographics, practitioner profile, queue, notification, or authentication facts.

The completion target is a locally verified checkpoint with:

- three registered canonical appointment tables;
- deterministic, idempotent, version-guarded lifecycle commands;
- explicit patient-link and practitioner references;
- reschedule lineage;
- explicit appointment-to-encounter link semantics;
- disabled legacy/shadow/canonical provider behavior;
- resumable appointment and telemedicine backfill;
- persistent fail-closed reconciliation;
- updated authority, source, and access governance;
- a clean worktree and one exact CDB-113E continuation action.

## 2. Reviewed input evidence

Read and obey:

1. `agents.md`
2. `.agent-rules/git-workflow.md`
3. `docs/architecture/canonical-program-control-center.md`
4. `task-progress.yaml`
5. `docs/database/audits/2026-07-26-appointment-authority-audit.md`
6. `docs/superpowers/specs/2026-07-26-cdb-113a-identity-episode-foundation-design.md`
7. `docs/database/migration-runs/P11-canonical-practitioner-operational-adoption.md`
8. `docs/database/canonical-authority-matrix.yaml`
9. targeted entries from `docs/database/canonical-authority-access-registry.yaml`

Exact current access evidence:

- `appointments`: 8 writers and 30 readers;
- `consultations`: 3 writers and 8 readers;
- `doctor_schedules`: 3 writers and 8 readers;
- 24 literal SQL or Drizzle appointment mutation references discovered in current source paths.

## 3. Architecture contract

The implementation must preserve these exact rules:

- Appointment is planned intent.
- Encounter is actual care.
- Appointment status is not encounter status.
- Billing status is not appointment lifecycle authority.
- Quoted appointment fee is a planning snapshot, not invoice or payment truth.
- `marketplace_bookings` is channel/workflow projection.
- `doctor_schedules` is a schedule-availability extension.
- Telemedicine `consultations` must map to canonical appointment intent when they represent scheduling.
- Patient demographics are not copied; use `patient_link_public_id`.
- Practitioner profile or auth data is not copied; use practitioner public ID.
- No name-only, phone-only, numeric-ID-coincidence, or time-proximity identity/episode matching.
- Reschedule closes the old appointment with an immutable event and creates a new linked appointment.
- Fulfilment requires explicit encounter evidence and a persisted link.
- Provider feature flag remains disabled.
- No production, remote, sync, traffic, retirement, push, or CDB-to-main action.

## 4. Checkpoint sequence

### CDB-113D.1 — Appointment authority audit

Inputs:

- exact access registry;
- current `appointments`, `consultations`, `doctor_schedules`, `marketplace_bookings`, `visits`, and canonical encounter shape;
- all direct mutation routes;
- CDB-113A target design.

Outputs:

- `docs/database/audits/2026-07-26-appointment-authority-audit.md`;
- this plan;
- `test/canonical/appointment-authority-design-contract.test.ts`.

Verification:

- documents are substantial;
- exact writer/reader counts are recorded;
- planned-intent versus actual-care separation is explicit;
- status, identity, billing, provider, backfill, reconciliation, and safety rules are test-locked.

Commit:

`docs(canonical): define appointment authority`

### CDB-113D.2 — Appointment schema

Use RED tests before migration/schema implementation.

Target files:

- `test/canonical/appointment-authority-schema.test.ts`;
- `migrations/0546_canonical_appointment_authority.sql`;
- `src/db/schema/canonical/appointments.ts`;
- `src/db/schema/canonical/index.ts`;
- `docs/database/canonical-source-of-truth.yaml`;
- generated access registry if schema references create new governed accesses.

#### 4.2.1 `canonical_appointments`

Required columns:

- `id` integer primary key;
- `tenant_id` text not null;
- `appointment_public_id` text not null;
- `patient_link_public_id` text not null;
- nullable `requested_practitioner_public_id`;
- nullable `requested_service_item_public_id`;
- nullable `requested_location_public_id`;
- `appointment_kind` text not null;
- `modality` text not null;
- `scheduling_channel` text not null;
- `requested_start_utc` text not null;
- `requested_end_utc` text not null;
- `business_date` text not null;
- `timezone` text not null;
- nullable positive `token_number`;
- `token_assignment_type` text not null;
- `current_status` text not null;
- positive `status_version`;
- nullable `rescheduled_from_appointment_public_id`;
- nullable access-controlled `request_note`;
- nullable `referral_practitioner_public_id`;
- nullable nonnegative `quoted_amount_minor`;
- nullable three-letter `currency_code`;
- nullable `quote_source`;
- nullable `quote_effective_at_utc`;
- `source_evidence_sha256` lowercase 64-hex not null;
- created/updated UTC timestamps.

Required constraints:

- tenant + appointment public ID unique;
- requested end >= start;
- business date format;
- timezone nonempty;
- status vocabulary exact;
- appointment kind and modality controlled vocabulary;
- token assignment vocabulary;
- quote fields all-null or complete as one coherent group;
- no `REAL` money columns;
- optional reschedule lineage cannot self-reference;
- foreign key to tenant patient link;
- foreign keys to requested/referral practitioner when present;
- self foreign key for reschedule lineage;
- indexes for patient/time, practitioner/time, business date/status, and lineage.

Initial controlled vocabularies:

Appointment kind:

- `new_patient`;
- `follow_up`;
- `report_review`;
- `free_visit`;
- `emergency_request`;
- `telemedicine`;
- `other`.

Modality:

- `in_person`;
- `telemedicine`;
- `home_visit`;
- `other`.

Scheduling channel:

- `reception`;
- `patient_portal`;
- `marketplace`;
- `doctor_follow_up`;
- `import`;
- `other`.

Token assignment:

- `none`;
- `auto`;
- `reserved`;
- `manual`.

Status:

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

#### 4.2.2 `canonical_appointment_status_events`

Required columns and constraints:

- tenant, event public ID, appointment public ID;
- event type;
- nullable from status, required to status;
- positive sequence;
- reason code;
- nullable safe note;
- nullable actor user public ID and actor system key, at least one required;
- idempotency key;
- source evidence hash;
- occurred and created UTC;
- unique tenant + event public ID;
- unique tenant + appointment + sequence;
- unique tenant + idempotency key;
- tenant-scoped foreign key to appointment;
- status vocabularies exact;
- sequence positive;
- lowercase SHA-256 evidence.

Event type vocabulary should distinguish:

- created;
- scheduled;
- confirmed;
- arrived;
- checked_in;
- fulfilled;
- cancelled;
- no_show;
- rescheduled;
- entered_in_error.

#### 4.2.3 `canonical_appointment_encounter_links`

Required columns and constraints:

- tenant ID;
- link public ID;
- appointment public ID;
- encounter public ID;
- link type;
- link status;
- source evidence hash;
- created and retired UTC;
- unique tenant + link public ID;
- one active appointment fulfilment link;
- one active originating appointment per encounter;
- tenant-scoped foreign keys to appointment and encounter;
- link type vocabulary: `fulfilled_by`, `converted_to_emergency`, `converted_to_inpatient`, `approved_manual`;
- link status vocabulary: `active`, `retired`, `rejected`;
- active link cannot have retired timestamp;
- retired/rejected link requires retired timestamp.

SQLite partial unique indexes may enforce active cardinality.

#### 4.2.4 Schema tests

RED/green coverage must prove:

- migration and schema/barrel existence;
- all three tables create successfully;
- migration can be applied twice only where repository migration semantics allow; otherwise the test must assert additive manifest behavior and table constraints without pretending SQLite `ALTER` idempotency;
- exact columns and types;
- no patient demographics, practitioner profile, auth, payment, paid/due, discount approval, queue, room URL, prescription, or revenue fields;
- tenant-scoped FK enforcement;
- status/event/link vocabularies;
- positive versions and sequences;
- quote minor-unit coherence;
- lowercase evidence hashes;
- interval validation;
- reschedule self-link rejection;
- active link cardinality;
- source-of-truth registration and barrel export.

Commit:

`feat(canonical): add appointment authority schema`

### CDB-113D.3 — Appointment commands

Target files:

- `src/lib/canonical/commands/manage-appointment.ts`;
- `test/canonical/appointment-authority-commands.test.ts`;
- access registry regeneration.

Use `runCanonicalBatch` and `readCanonicalCommandReplay`. Do not implement a parallel transaction/idempotency framework.

#### 4.3.1 Create appointment intent

Input must include:

- tenant;
- optional appointment/event public IDs;
- patient-link public ID;
- optional requested practitioner;
- kind/modality/channel;
- requested interval, business date, timezone;
- token semantics;
- optional referral/quote/request-note fields;
- source type, source public ID, source table, source evidence hash;
- idempotency key;
- occurred UTC.

Behavior:

- deterministic IDs when omitted;
- validate patient link exists in tenant;
- validate practitioner references exist and are not retired/inactive where policy requires active scheduling;
- validate interval and quote group;
- reject conflicting source mapping;
- create header status/version 1;
- create immutable created event sequence 1;
- create source mapping with entity type `appointment`;
- execute caller `authoritativeStatements` atomically;
- emit PHI-minimised outbox payload without request note, patient IDs, names, phone, fee-display text, or legacy IDs.

#### 4.3.2 Lifecycle transition command

One reviewed transition command may support confirm, arrive, check in, no-show, cancel, and enter-in-error through an explicit transition matrix.

Requirements:

- exact replay before state-dependent validation;
- expected version required;
- current header status/version read;
- allowed transition matrix;
- conditional update by expected version;
- immutable event with next sequence;
- safe reason code;
- PHI-minimised outbox;
- compatibility statements in same batch;
- stale version and forbidden transition rejection.

Recommended transition matrix:

- requested → scheduled, confirmed, cancelled, entered_in_error;
- scheduled → confirmed, arrived, checked_in, cancelled, no_show, rescheduled, entered_in_error;
- confirmed → arrived, checked_in, cancelled, no_show, rescheduled, entered_in_error;
- arrived → checked_in, cancelled, no_show, entered_in_error;
- checked_in → fulfilled, cancelled only through reviewed exceptional policy, entered_in_error;
- fulfilled terminal except entered-in-error correction policy;
- cancelled terminal;
- no_show terminal;
- rescheduled terminal;
- entered_in_error terminal.

Do not map legacy `completed` blindly. Appointment fulfilment requires encounter evidence.

#### 4.3.3 Reschedule command

The reschedule command must atomically:

- replay-check one command request;
- validate old appointment expected version and reschedulable state;
- mark old appointment `rescheduled` with immutable event;
- create new appointment with new public ID and sequence 1;
- set `rescheduled_from_appointment_public_id` on new header;
- create source mapping for new source intent where provided;
- preserve old schedule history;
- run legacy compatibility statements for old/new rows in the same batch;
- emit safe old/new public-ID lineage in outbox.

#### 4.3.4 Fulfil/link command

The command must:

- require existing active canonical appointment and canonical encounter;
- verify patient-link agreement through explicit mappings/data available at this checkpoint;
- reject cancelled, no-show, rescheduled, or entered-in-error appointment;
- reject another active encounter link;
- reject encounter already linked from another appointment;
- create active link and immutable fulfilled event;
- transition header to fulfilled;
- optionally record practitioner mismatch issue rather than guessing;
- support `fulfilled_by`, emergency conversion, inpatient conversion, and approved manual link type;
- retire/reject link through explicit lifecycle command rather than deletion.

#### 4.3.5 Command tests

Require tests for:

- in-person create;
- telemedicine create;
- deterministic IDs;
- identical replay;
- conflicting replay;
- source mapping conflict;
- tenant patient-link FK/validation;
- practitioner validation;
- exact transition matrix;
- stale expected version;
- atomic compatibility success and rollback;
- reschedule lineage with old/new events;
- no historical rewrite;
- normal fulfilment link;
- forbidden terminal fulfilment;
- duplicate active link rejection;
- patient identity mismatch rejection;
- outbox excludes request note, demographics, legacy IDs, and billing state.

Commit:

`feat(canonical): add appointment authority commands`

### CDB-113D.4 — Appointment provider

Target files:

- `src/lib/canonical/appointment-provider.ts`;
- `test/canonical/appointment-provider.test.ts`;
- feature-flag documentation/registry evidence if needed.

Feature flag key:

`canonical_appointment_provider_v1`

Modes:

- legacy;
- shadow;
- canonical.

Missing, disabled, invalid, or absent feature-flag table must resolve to legacy where fail-closed compatibility policy permits.

#### Legacy projection

Read `appointments` or scheduled `consultations` by explicit source type and source ID. Resolve canonical appointment public ID only through `canonical_source_mappings`. Identity-sensitive adapters require exact patient and practitioner mappings.

#### Shadow projection

Return legacy result and compare:

- mapping and source type;
- patient-link public ID;
- requested practitioner public ID;
- kind/modality/channel;
- requested interval, business date, timezone;
- token semantics;
- current status;
- reschedule lineage;
- active appointment-to-encounter link.

Do not compare patient/doctor names, phone, complaint text, room URL, billing status, paid/due, discount, or time proximity.

#### Canonical projection

Return canonical appointment intent and lifecycle. Include legacy appointment/consultation ID only as compatibility metadata. Join billing, queue, profile, schedule, marketplace, and clinical-document facts through their owners when needed; do not add them to canonical appointment identity.

#### Disabled-safe adapters

Provide local library adapters for:

- appointment detail/list resolution;
- marketplace booking projection;
- patient portal appointment projection;
- check-in eligibility and explicit appointment-to-encounter resolution;
- reminder/notification scheduling projection.

Do not wire route traffic or enable the feature flag in this checkpoint unless the plan is explicitly amended by fresh authorization. Tests exercise provider behavior directly.

Commit:

`feat(canonical): add appointment provider adapters`

### CDB-113D.5 — Backfill and reconciliation

Target files:

- `scripts/canonical/backfill-appointments.ts`;
- `scripts/canonical/reconcile-appointment-authority.ts`;
- `test/canonical/appointment-backfill.test.ts`;
- `test/canonical/appointment-reconciliation.test.ts`;
- authority/access registry regeneration.

#### 4.5.1 Backfill source scope

Sources:

- legacy `appointments`;
- scheduled-intent `consultations`;
- optional exact `marketplace_bookings` linkage evidence;
- exact legacy visit/appointment linkage for encounter links;
- patient and practitioner source mappings;
- tenant timezone/config evidence.

The backfill must not create patients, practitioners, visits, encounters, bills, or payments.

#### 4.5.2 Mapping rules

- deterministic public ID from tenant + source type + source ID;
- source mapping entity type `appointment`;
- exact patient mapping required;
- exact practitioner mapping required when legacy doctor exists;
- external/referral practitioner uses canonical practitioner mapping;
- unknown doctor may remain null only where appointment policy permits no requested practitioner and a stable issue records the source ambiguity;
- legacy appointment status maps through explicit reviewed map;
- legacy `completed` maps to fulfilled only when exact encounter/visit evidence exists; otherwise issue and conservative non-fulfilled status;
- telemedicine consultation scheduled intent maps to kind/modality telemedicine;
- date/time conversion uses explicit timezone and produces UTC interval;
- missing time uses reviewed bounded default only when source semantics prove a date-only token queue; otherwise issue;
- billing status is excluded from lifecycle mapping;
- marketplace booking is projection evidence, not an independent canonical identity;
- duplicate source or identity conflicts become stable processing issues;
- no name or time-proximity merging.

#### 4.5.3 Resumability

Use canonical migration runs and backfill checkpoints:

- separate source partitions for appointments and consultations;
- monotonic source cursor;
- bounded `maxSourceRecords`;
- per-row atomic batch;
- committed cursor after row success;
- pause/resume status;
- failure rollback without cursor advance;
- same run public ID resume;
- second pass creates zero new business rows.

#### 4.5.4 Reconciliation

Persist `canonical_reconciliation_runs` aggregate evidence for at least 15 checks:

1. appointment mapping cardinality;
2. consultation scheduling mapping cardinality;
3. patient-link reference validity;
4. practitioner reference validity;
5. header/latest-event parity;
6. event sequence continuity;
7. allowed transition history;
8. reschedule lineage validity;
9. active token uniqueness;
10. appointment/encounter active link cardinality;
11. encounter originating-appointment uniqueness;
12. patient identity agreement;
13. forbidden terminal fulfilment links;
14. cross-tenant references;
15. unresolved identity/time/status issues.

The receipt summary excludes row-level PHI and free text. A failing check persists `failed`, not an accepted success. Stable issue fingerprints must be deterministic across reruns.

Commit:

`feat(canonical): backfill and reconcile appointment authority`

## 5. Governance updates

After implementation:

- register three tables in `docs/database/canonical-source-of-truth.yaml`;
- update `appointment_intent` in `docs/database/canonical-authority-matrix.yaml` from `canonical_gap` to `partial_canonical`, not implemented/cut-over;
- list schema, command, provider, backfill, reconciliation modules;
- record backfill `complete` and reconciliation `verified_local` only after tests pass;
- keep cutover blocked because routes/readers/production evidence remain;
- regenerate `docs/database/canonical-authority-access-registry.yaml`;
- update `docs/database/audits/2026-07-26-canonical-authority-access-audit.md` with exact new counts;
- update control center, tracker, handoff, continuity contracts, and receipt.

Do not change concept summary counts manually without running the authority checker/generator and reviewing resulting summary changes.

## 6. Verification gates

At each checkpoint run focused tests. At final completion run:

1. appointment design/schema/command/provider/backfill/reconciliation tests;
2. adjacent patient-link, practitioner, encounter, appointment billing, queue/visit compatibility, and encounter backfill tests;
3. `pnpm vitest run test/canonical`;
4. `pnpm exec tsc --noEmit`;
5. `pnpm canonical:access-registry-generate`;
6. `pnpm canonical:check`;
7. `pnpm build:migrations`;
8. `pnpm canonical:local-sync-readiness`;
9. `pnpm canonical:legacy-retirement-readiness`;
10. `pnpm worktree:check -- --mode=task` after final commit.

Expected safety outcomes remain fail-closed:

- local sync ready entities: 0;
- provider flag enabled: false;
- retirement eligible allowances: 0;
- production mutation: false;
- CDB-to-main integration: false.

Test counts and registry counts must be copied from fresh command output, never estimated.

## 7. Commit discipline

Use serial commits:

1. audit/plan/design contract;
2. schema/migration/source registry;
3. commands/access registry;
4. provider/access registry;
5. backfill/reconciliation/access registry;
6. final receipt/tracker/control-center/handoff/continuity metadata.

Do not combine unknown existing changes. Do not rewrite previous CDB commits. Checkpoint commits are not stop points; continue to the next safe serial task unless an execution limit is reached.

## 8. Completion definition

CDB-113D is locally complete only when:

- all three canonical tables exist and are governed;
- schema constraints and tenant-scoped FKs pass;
- command lifecycle and replay tests pass;
- reschedule and encounter-link invariants pass;
- provider modes pass with flag disabled;
- backfill resume and second-pass tests pass;
- reconciliation persists passing and failing aggregate receipts;
- full canonical suite, TypeScript, governance, migration manifest, readiness gates, and worktree policy pass;
- receipt truthfully states no production cutover;
- next checkpoint is exactly `CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE`.

Production mutation is not authorised. Local-sync expansion remains paused. Destructive legacy retirement is not authorised.

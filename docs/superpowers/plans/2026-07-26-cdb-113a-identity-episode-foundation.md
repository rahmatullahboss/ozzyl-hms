# CDB-113A Identity and Episode Foundation Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-26-cdb-113a-identity-episode-foundation-design.md`  
**Authority matrix:** `docs/database/canonical-authority-matrix.yaml`  
**Access registry audit:** `docs/database/audits/2026-07-26-canonical-authority-access-audit.md`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Mode:** single-agent serial execution, local-only, TDD  
**Production mutation is not authorised.**  
**Local-sync expansion remains paused.**  
**Destructive legacy retirement is not authorised.**

## Goal

Implement a shared patient–practitioner–appointment–encounter–admission–bed foundation without introducing another demographics, doctor, care-episode, occupancy, billing, or pricing authority.

The program statement is:

> Appointment is planned intent; encounter is actual care.

The implementation is divided into serial checkpoints. Each checkpoint must be complete, tested, documented, and committed before the next begins. Normal checkpoint commits do not authorise production work.

## Global implementation rules

1. Use additive migrations only.
2. Keep `global_patient_identity remains an external governed authority`.
3. Keep `patients remains the tenant operational patient record during migration`.
4. The link layer must `do not create another patient demographics authority`.
5. Reuse existing canonical practitioner tables.
6. Name-only practitioner matching is prohibited.
7. Phone-only patient matching is prohibited.
8. National identity evidence must be verified, unique, and tenant-safe before automatic linking.
9. Time proximity alone never merges an appointment, consultation, visit, encounter, or admission.
10. Ambiguous historical evidence creates a stable canonical processing issue.
11. All canonical entities use tenant-scoped stable public IDs.
12. All commands own source mapping, idempotency, required events, outbox, and compatibility statements in one reviewed batch.
13. Header status fields are guarded projections from immutable lifecycle events where events exist.
14. Financial, inventory, consent, authentication, and clinical-document facts remain separate domains.
15. Update the authority matrix and access registry whenever new tables or accesses are added.
16. Run `pnpm canonical:access-registry-generate` only after reviewing intended access changes; never let `canonical:check` regenerate automatically.
17. Do not resume local-sync work during these checkpoints.

# CDB-113B-PATIENT-LINK-FOUNDATION

## Task 113B.1 — Schema contract RED tests

Create tests before migration/schema implementation:

- `test/canonical/patient-link-foundation-schema.test.ts`
- `test/canonical/patient-link-lifecycle.test.ts`
- `test/canonical/patient-link-backfill.test.ts`

RED assertions must require:

- new migration file after the current 475-entry manifest sequence;
- `canonical_tenant_patient_links`;
- `canonical_tenant_patient_link_events`;
- tenant text scope;
- stable public IDs;
- one current link per tenant patient;
- verified link requires global UHID;
- evidence hash constraints;
- event sequence and idempotency uniqueness;
- no copied demographics fields;
- no phone/name automatic evidence type;
- current-state and event-history relationship.

Preserve the RED output proving absence of the migration/tables.

## Task 113B.2 — Additive patient-link migration and schema

Add migration and Drizzle declarations under `src/db/schema/canonical/`.

Required constraints:

- unique tenant + patient-link public ID;
- unique tenant + legacy patient ID for current link row;
- checked link status and verification level;
- checked evidence hash length;
- verified status requires non-null global UHID;
- event public ID uniqueness;
- tenant + link + sequence uniqueness;
- tenant + idempotency key uniqueness;
- event interval/sequence checks;
- restrictive foreign key from events to current link authority where D1-compatible.

Update:

- `src/db/schema/canonical/index.ts` if a new module is used;
- `docs/database/canonical-source-of-truth.yaml`;
- `docs/database/canonical-authority-matrix.yaml` patient identity concept;
- authority/access tests and registry.

## Task 113B.3 — Patient-link command

Create `src/lib/canonical/commands/register-or-link-patient.ts`.

The `register-or-link-patient` command must:

- validate tenant ID, patient ID, optional global UHID, status, evidence, actor, and idempotency;
- create deterministic public IDs;
- calculate request fingerprint;
- validate exact evidence policy;
- reject phone-only/name-only verified linking;
- prepare current link insert/update with expected version guard;
- prepare immutable event;
- prepare source mapping;
- prepare processing issue for candidate/ambiguous evidence;
- prepare PHI-minimised outbox/audit payload;
- optionally prepare reviewed tenant patient/global compatibility statements;
- return a command batch without executing post-commit side effects.

Test:

- first registration;
- exact replay;
- conflicting replay;
- unlinked patient;
- verified UHID link;
- rejected phone/name-only link;
- candidate link;
- verified link change;
- unlink;
- merge/unmerge event;
- stale version;
- cross-tenant references;
- duplicate UHID policy;
- atomic rollback on any required statement failure.

## Task 113B.4 — Backfill

Create an idempotent chunked backfill under `scripts/canonical/`.

Evidence priority:

1. existing reviewed source mapping;
2. exact unique tenant patient UHID to exact unique global UHID;
3. authenticated claim/claim-code evidence;
4. verified unique national identity under reviewed rules;
5. otherwise unlinked/candidate/ambiguous issue.

Never use phone, name, address, age, guardian, or proximity to auto-link.

Use migration runs, checkpoints, evidence hashes, source mappings, and processing issues. Add second-pass zero-new-row tests.

## Task 113B.5 — Reconciliation and receipt

Build patient-link reconciliation:

- tenant patient count versus link count;
- zero duplicate current links;
- verified links resolve to one global UHID;
- no forbidden evidence type in verified state;
- link event latest version equals current link state;
- merge/unmerge source/target validity;
- cross-tenant mismatch zero;
- second pass zero new facts;
- source rows unchanged.

Update control center, tracker, handoff, receipt, authority matrix, access registry, and verification counts. Commit CDB-113B cleanly.

# CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION

## Task 113C.1 — Current practitioner gap audit

Use the access registry to classify exact writers/readers for:

- `doctors`;
- `doctor_auth`;
- `external_referring_doctors`;
- `users` and staff links;
- canonical practitioner tables.

Document operation groups:

- create/update/deactivate doctor;
- external referrer CRUD;
- marketplace publish/profile;
- auth registration/linking;
- invitation acceptance;
- scheduling/appointment practitioner resolution;
- clinical participant resolution;
- lab/radiology attribution;
- compensation/reporting;
- public/marketplace/search reads.

## Task 113C.2 — Practitioner commands

Add or consolidate canonical commands for:

- create internal practitioner;
- create external practitioner/referrer;
- update/retire practitioner;
- link/unlink user;
- link/unlink employee;
- add/verify/retire identifier;
- specialty/department assignment.

Commands co-commit legacy compatibility projections while the corresponding readers remain legacy. No command treats `doctor_auth` as professional identity authority.

RED tests cover exact registration uniqueness, user/staff one-to-one links, external referrer creation, inactive status, conflicting source mapping, replay, stale version, and atomic compatibility writes.

## Task 113C.3 — Practitioner provider

Create provider modes:

- legacy;
- shadow;
- canonical.

Provider result uses practitioner public ID as identity and may expose legacy ID only as compatibility metadata. Compare source mapping, status, identifiers, specialties, departments, and user/employee links. Do not compare identity by name.

Migrate selected low-risk readers first in code while feature flag remains disabled:

- global/search resolver;
- appointment practitioner validation;
- public/marketplace list adapter;
- encounter participant resolver.

## Task 113C.4 — Backfill and reconciliation hardening

Reuse the existing practitioner backfill and add checks for all newly operational source types. Reconcile:

- doctor/source mapping cardinality;
- external referrer mapping;
- registration identifier uniqueness;
- user/staff link uniqueness;
- missing/ambiguous practitioner issues;
- active provider parity;
- no name-only mapping.

Update registry/docs/tracker/receipt and commit.

# CDB-113D-APPOINTMENT-AUTHORITY

## Task 113D.1 — Schema RED tests

Require:

- `canonical_appointments`;
- `canonical_appointment_status_events`;
- `canonical_appointment_encounter_links`;
- public IDs and tenant scope;
- patient link FK/contract;
- optional canonical practitioner/service/location references;
- integer minor-unit quote and currency;
- no invoice/payment/billing-status authority;
- immutable status sequence;
- reschedule lineage;
- token/slot uniqueness;
- active fulfilment-link uniqueness;
- patient consistency guards supported by command tests.

## Task 113D.2 — Additive appointment migration/schema

Implement header/event/link tables and authority registry updates.

Status transitions:

```text
requested -> scheduled|cancelled
scheduled -> confirmed|arrived|checked_in|cancelled|no_show|rescheduled
confirmed -> arrived|checked_in|cancelled|no_show|rescheduled
arrived -> checked_in|cancelled|no_show
checked_in -> fulfilled|cancelled|entered_in_error
fulfilled -> entered_in_error only through reviewed correction
cancelled/no_show/rescheduled -> terminal
```

A reschedule creates a new header and first event while closing the previous appointment. It never overwrites original schedule history.

## Task 113D.3 — `create-or-reschedule-appointment`

Implement command with:

- patient-link validation;
- practitioner/service/location validation;
- UTC/business-date conversion;
- token/slot policy;
- quote snapshot;
- header + event;
- source mapping/idempotency/outbox;
- legacy appointment compatibility insert/update.

The `create-or-reschedule-appointment` command does not create an encounter, invoice, payment, discount, or collection.

Tests include concurrent token claim, duplicate booking policy, exact replay, reschedule lineage, cancellation, no-show, invalid patient/practitioner, quote precision, and compatibility failure rollback.

## Task 113D.4 — Appointment backfill

Backfill every legacy appointment into canonical appointment history or issue state.

Map legacy statuses explicitly. Preserve original date/time, token, source, check-in, referral, and quote evidence. Financial fields are quote evidence only. Link patient/practitioner through exact canonical mappings; unresolved links generate issues.

No appointment creates an encounter during this backfill.

## Task 113D.5 — Appointment provider

Build provider for appointment list/detail, doctor dashboard, patient portal, queue, reminders, scheduled jobs, reports, marketplace, public booking, and search. Start disabled/shadow only.

Reconciliation:

- one canonical appointment per mapped source;
- status/header event parity;
- duplicate active token/slot zero;
- terminal lineage validity;
- no cancelled/no-show fulfilment link;
- quote exactness;
- no hidden billing authority;
- second pass zero new rows.

Update docs/registry/tracker/receipt and commit.

# CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE

## Task 113E.1 — Encounter patient-link hardening

Add nullable `patient_link_public_id`, version/source command metadata, and required indexes to canonical encounters. Backfill exact patient links. New commands require patient link; legacy patient ID remains compatibility evidence.

Reclassify historical `planned` canonical encounters:

- map to canonical appointment when evidence shows planning only;
- map to actual encounter only with actual-care evidence;
- otherwise issue.

Review existing consultation proximity mappings. Time proximity alone never merges an appointment, consultation, visit, encounter, or admission.

## Task 113E.2 — Appointment check-in and encounter start

Implement `check-in-and-start-encounter`.

The command atomically writes:

- appointment status transition;
- canonical encounter;
- appointment–encounter link;
- participant snapshot;
- source mappings;
- idempotency/outbox;
- legacy compatibility updates.

Tests cover double check-in, terminal appointment, patient mismatch, practitioner reassignment evidence, replay, stale status, and atomic rollback.

## Task 113E.3 — Admission lifecycle schema

Add:

- `canonical_admissions`;
- `canonical_admission_status_events`.

Transform `canonical_encounter_admission_links` into compatibility/source mapping evidence. Add one active admission per inpatient encounter and event/header guards.

Backfill exact legacy admissions by source mapping or exact admission relation. Nearby visits create issues, not merges.

## Task 113E.4 — Care location and bed resource schema

Add:

- `canonical_care_locations`;
- `canonical_beds`.

Extend `canonical_bed_stays` with canonical admission and bed public IDs, version, movement reason, and source command fields.

Enforce, using indexes plus command tests:

- one open bed stay per bed;
- one open bed stay per active admission;
- no overlapping intervals;
- no new stay on inactive/maintenance/retired bed;
- resource identity separate from occupancy;
- pricing separate from resource/occupancy.

## Task 113E.5 — Admission and bed commands

Implement and test:

- `admit-patient-and-claim-bed`;
- `transfer-bed`;
- `discharge-or-cancel-admission`.

`admit-patient-and-claim-bed` may compose reviewed admission-deposit financial statements but never copies payment/deposit authority into admission rows.

`transfer-bed` closes and opens stays atomically with destination version/availability guards.

`discharge-or-cancel-admission` closes the active stay and emits durable cross-domain orchestration evidence. Financial clearance and clinical discharge remain separate explicit states.

## Task 113E.6 — Backfill/reconciliation

Backfill care locations, beds, admissions, and stays. Required checks:

- source-to-canonical cardinality;
- one active admission per inpatient encounter;
- patient identity agreement;
- one open bed stay per bed;
- one open stay per active admission;
- no interval overlap;
- legacy bed status versus derived occupancy;
- admission/bed pricing excluded from authority;
- stable issues for mismatch/overlap/missing source;
- second pass zero new rows.

Update docs/registry/tracker/receipt and commit.

# CDB-113F-IDENTITY-EPISODE-READ-PROMOTION

## Task 113F.1 — Provider coverage registry

Use the access registry to map every active reader to one provider:

- patient identity;
- practitioner;
- appointment;
- encounter;
- admission/bed.

No reader remains “unknown.” Register hidden scheduled, export, portal, marketplace, admin, dashboard, and public consumers.

## Task 113F.2 — Shadow parity

For each provider:

- compare exact stable keys;
- compare counts/status/time ranges;
- classify intentional differences;
- create stable variance IDs;
- keep response/route behaviour legacy while shadowing;
- avoid PHI in receipts/logs;
- measure latency and error counts.

Critical parity requires zero unexplained variance.

## Task 113F.3 — Local provider cutover readiness

Create fail-closed checker requiring:

- complete provider registry;
- zero critical unresolved issues;
- second-pass backfill stability;
- exact source mapping coverage or accepted exception IDs;
- rollback mode/command;
- feature flags disabled by default;
- access registry updated;
- local tests/builds passing.

This is local readiness only and cannot activate production.

## Task 113F.4 — Legacy retirement readiness updates

Extend retirement gates for exact identity/episode writer and reader paths. An allowance remains blocked until command cutover, provider promotion, observation, rollback evidence, and authorisation are complete.

## Task 113F.5 — Final local verification

Run:

```text
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task --allow-dirty
```

Run affected web, patient, and admin builds when runtime/API/UI code changes.

# Documentation and continuity contract for every checkpoint

Each checkpoint updates:

- `docs/architecture/canonical-program-control-center.md`;
- `.ai-bridge/current-plan.md`;
- `task-progress.yaml`;
- checkpoint design/plan/receipt;
- authority matrix;
- source-of-truth registry;
- access registry and audit summary when counts change;
- focused and continuation contract tests;
- exact commits, verification counts, blockers, safety state, and next action.

A new chat must immediately identify authoritative workspace/branch, last commit, current checkpoint, next exact action, safety gates, and required reads.

# Verification policy

Before each implementation commit:

1. run RED focused test and confirm expected failure;
2. implement minimum reviewed boundary;
3. run focused GREEN tests;
4. run TypeScript;
5. run all three canonical governance checks;
6. inspect exact diff;
7. commit task-owned code/schema/tests.

Before each receipt commit:

1. run the full canonical suite;
2. build migrations;
3. run local-sync and retirement readiness;
4. run affected builds;
5. update tracker/control center/handoff/receipt;
6. run continuity tests;
7. verify worktree policy;
8. commit documentation metadata;
9. verify clean worktree.

# Stop conditions

Stop before any action that requires:

- production or protected-clone access not explicitly authorised;
- credentials or secrets;
- deployment, migration/backfill application, feature flag, or traffic change;
- local-sync runtime registration or activation;
- automatic patient/practitioner/episode merge from ambiguous evidence;
- alteration of signed clinical history;
- destructive schema change;
- legacy writer/reader removal;
- push or CDB-to-main integration;
- a new authority conflicting with the matrix/design.

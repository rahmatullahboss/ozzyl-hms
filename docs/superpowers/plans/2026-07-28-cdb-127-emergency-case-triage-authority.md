# CDB-127 Emergency Case and Triage Authority Implementation Plan

**Program:** HMS Canonical Data Architecture

**Design checkpoint:** CDB-127A

**Date:** 2026-07-28

**Execution rule:** checkpoints B through E may be implemented locally only. Production migration, backfill, observation, provider activation, route promotion, writer freeze and retirement require separate exact authorization.

## Goal

Converge the current mutable emergency registration, triage, classification and final-disposition workflow into one Canonical emergency extension linked to the existing Canonical patient/encounter/practitioner/service/document/diagnosis/vital/medication/admission/finance authorities.

The implementation must preserve all legacy evidence, remove no runtime path, and never infer identity from patient name, phone, copied demographics, numeric ID coincidence, ER number, timestamp proximity, triage color or free-text similarity.

## Non-goals

This stream does not redesign or duplicate:

- patient demographics or MPI;
- Canonical encounters;
- practitioner identities;
- service requests/events/participants;
- signed clinical notes or discharge summaries;
- diagnoses;
- vital observations;
- medication orders or administrations;
- admissions, beds or bed stays;
- ambulance, referral, queue or transport authority;
- billing, invoices, payments or accounting;
- emergency-access/break-glass authorization;
- general hospital quality-KPI architecture.

## Checkpoint sequence

1. CDB-127A — authority audit and design.
2. CDB-127B — additive schema.
3. CDB-127C — atomic commands.
4. CDB-127D — bounded backfill and reconciliation.
5. CDB-127E — disabled provider, selected adapters, coverage and readiness.

Each checkpoint must update the authority matrix, tracker, control centre, handoff and a dedicated receipt. Every checkpoint must rerun focused tests, TypeScript, migration governance where applicable, continuity and worktree policy. Changes remain uncommitted when the active connector has no Git commit action.

# CDB-127A — Design-only authority checkpoint

## Deliverables

- repository-static audit;
- authority specification;
- implementation plan;
- design receipt;
- design contract test;
- authority-matrix update;
- task tracker and control-centre update;
- no migration, schema module, command, provider or route implementation.

## Acceptance

- current mutable/stale sources are classified;
- actual writers/readers are distinguished from stale matrix entries;
- existing Canonical authorities are reused explicitly;
- six target tables are named;
- Nine atomic commands are named;
- Eight persistent bounded/resumable backfill partitions are named;
- Fixed twenty-four-check reconciliation is named;
- provider flag/modes/default/rollback are locked;
- design test passes without creating migration 0560 or runtime modules.

# CDB-127B — Canonical emergency schema

## Migration

Planned migration:
`migrations/0560_canonical_emergency_case_triage.sql`

Planned Drizzle module:
`src/db/schema/canonical/emergency-case-triage.ts`

Planned Canonical barrel export:
`src/db/schema/canonical/index.ts`

## Six target tables

### 1. `canonical_emergency_cases`

Create a tenant-scoped stable case identity linked to one active patient link and one existing Canonical encounter. Enforce unique `(tenant_id, encounter_public_id)`.

Identity columns must be immutable:

- tenant;
- case public ID;
- patient link;
- encounter;
- emergency-number namespace/value when present;
- source evidence and initial command fingerprint.

Mutable aggregate pointers are allowed only under matching child-evidence triggers:

- current arrival assessment;
- current status event/status version;
- current triage assessment;
- current disposition event;
- updated timestamp.

The case starts `arrived` or `awaiting_triage`, status version 1, with an exact initial arrival assessment and status event. Hard delete is blocked.

### 2. `canonical_emergency_arrival_assessments`

Implement contiguous versions, immutable body, one replacement per superseded version, exact case/patient/encounter scope and required reason for corrections/entered-in-error.

Disallow copied patient demographics. Store normalized arrival facts, exact source pairs, bounded snapshots and observed/recorded times only.

### 3. `canonical_emergency_case_status_events`

Implement immutable event sequence. Enforce event version 1 start and one event per version. From/to status transitions are checked by database triggers and command tests.

### 4. `canonical_emergency_triage_assessments`

Implement immutable contiguous triage versions, exact active practitioner, supported normalized acuity, optional exact vital observation set, observed/recorded UTC order and replacement lineage.

Initial compatibility codes:

- red;
- yellow;
- green.

No text-derived or silently translated acuity is allowed.

### 5. `canonical_emergency_case_classifications`

Implement immutable coded classifications and versioned replacement lineage. Enforce required subtype fields for animal-bite/police/trauma classifications where the chosen code demands them.

### 6. `canonical_emergency_disposition_events`

Implement immutable disposition sequence and typed evidence constraints:

- admitted requires exact Canonical admission;
- discharged may require exact signed document/version when a summary is asserted;
- transferred requires destination/referral source pair;
- LAMA, DOR and death require reason/actor evidence;
- entered-in-error requires reason;
- one current disposition pointer per case.

## Schema tests

Create:
`test/canonical/emergency-case-triage-schema.test.ts`

Test at least:

1. exact tenant/patient/encounter scope and one case per encounter;
2. initial assessment/event/current-pointer contract;
3. immutable arrival and status history;
4. triage practitioner/time/acuity/vital scope;
5. classification typed fields and replacement lineage;
6. disposition admission/document/transfer/reason constraints;
7. aggregate pointer update requires matching child evidence;
8. hard delete rejection and foreign-key integrity.

## Governance

Register all six tables in `docs/database/canonical-source-of-truth.yaml` and the authority matrix before claiming migration build success. Migration 0560 must be additive and non-destructive.

# CDB-127C — Nine atomic commands

Planned command module:
`src/lib/canonical/commands/manage-emergency-case-triage.ts`

## Nine atomic commands

### 1. `registerCanonicalEmergencyCase`

Inputs:

- exact tenant/patient/encounter;
- emergency-number namespace/value when available;
- initial arrival assessment;
- actor/source/idempotency/time.

Atomic effects:

- case header;
- arrival assessment version 1;
- status event version 1;
- current pointers;
- source mapping;
- compatibility statements supplied by caller;
- command receipt/outbox.

### 2. `replaceCanonicalEmergencyArrivalAssessment`

Requires expected case/current arrival version, exact replacement lineage, reason and actor. Creates a complete replacement and advances the current arrival pointer without changing old evidence.

### 3. `recordCanonicalEmergencyTriageAssessment`

Creates initial/reassessment triage evidence, validates exact active practitioner and optional exact vital observation scope, appends lifecycle event if state advances, and updates current pointer/version atomically.

### 4. `correctCanonicalEmergencyTriageAssessment`

Creates correction/entered-in-error replacement for the exact current or reviewed prior assessment. Never clears or deletes old triage evidence.

### 5. `recordCanonicalEmergencyCaseClassification`

Creates one exact coded classification version with typed fields and source mapping.

### 6. `correctCanonicalEmergencyCaseClassification`

Creates a replacement version with reason/actor and one-direct-replacement enforcement.

### 7. `transitionCanonicalEmergencyCase`

Controls non-disposition transitions:

- arrived → awaiting_triage;
- arrived/awaiting_triage → triaged when matching assessment exists;
- triaged → care_in_progress;
- care_in_progress ↔ observation under reviewed rules;
- care_in_progress/observation → disposition_pending.

It cannot create admitted/discharged/transferred/LAMA/DOR/death without disposition evidence.

### 8. `recordCanonicalEmergencyDisposition`

Creates disposition event plus matching status event and advances current pointers atomically. Exact admission/document/destination/reason constraints are validated before batch execution.

### 9. `enterCanonicalEmergencyCaseInError`

Appends entered-in-error evidence, preserves every prior row, and makes the case terminal. No hard delete or source rewrite.

## Command guarantees

- replay read before current-state validation;
- deterministic public IDs;
- changed fingerprint conflict;
- exact tenant/patient/encounter/practitioner/admission/document/vital/source scope;
- expected version guards;
- PHI-minimised outbox;
- full D1 batch rollback;
- no implicit patient/encounter/admission/document/diagnosis/vital/medication/finance creation.

## Command tests

Create:
`test/canonical/emergency-case-triage-commands.test.ts`

Group coverage:

1. atomic registration/replay/conflict/rollback;
2. arrival replacement/history;
3. triage/reassessment/correction/history;
4. classification/version rules;
5. lifecycle transition guards;
6. all terminal dispositions and exact external links;
7. entered-in-error and no hard delete.

# CDB-127D — Bounded backfill and fixed reconciliation

Planned modules:

- `scripts/canonical/backfill-emergency-case-triage.ts`
- `scripts/canonical/reconcile-emergency-case-triage.ts`
- `test/canonical/emergency-case-triage-backfill-reconciliation.test.ts`

## Eight persistent bounded/resumable backfill partitions

### Partition 1 — exact scope

Scan `er_patients` and related visit/patient/practitioner evidence. Require exact Canonical patient link and encounter mappings. Emit deterministic non-PHI issues for missing or ambiguous scope.

### Partition 2 — case and arrival identity

Create case/arrival version only through `registerCanonicalEmergencyCase`. Do not copy demographics. Persist exact source mappings.

### Partition 3 — lifecycle reconstruction

Reconstruct the highest provable lifecycle from `er_status`, visit state and immutable source timestamps without inventing missing intermediate events. Mutable current state that lacks historical proof produces issues rather than fabricated history.

### Partition 4 — triage

Map exact `triage_code`, actor and time where all evidence exists. Because legacy history is overwritten, migrate only the current provable assessment and record an issue describing unavailable historical reassessments when appropriate.

### Partition 5 — classifications

Map `er_patient_cases` exact coded/source fields. Numeric main/sub-case values without reviewed code semantics remain issues. Animal-bite details are migrated only with required typed evidence.

### Partition 6 — dispositions

Map final dispositions. Admitted requires exact Canonical admission mapping; discharged summary links require exact signed document mapping; transferred/LAMA/DOR/death require typed evidence. Incomplete disposition remains an issue and does not create a terminal fact.

### Partition 7 — external-authority links

Disposition legacy discharge documents, diagnosis text, vital evidence, medication/treatment text and file uploads into exact mapping issues/links without copying those facts into emergency tables.

### Partition 8 — projections and second pass

Disposition `emergency_visits`, quality KPIs, doctor/IPD reports, timeline gaps, arrival-mode lookup and other caches/configuration. Prove source fingerprints and zero new rows/mappings/issues on second completed pass.

## Backfill safety

- caller-supplied maximum records;
- persistent run/checkpoint and durable cursor;
- all sources read-only;
- commands are the only business-write boundary;
- deterministic issue identity;
- no PHI in issue summaries/details;
- no name/phone/time similarity;
- no synthetic triage/disposition/admission/document history;
- full idempotency.

## Fixed twenty-four-check reconciliation

1. source mapping ownership;
2. case tenant/patient/encounter ownership;
3. one case per encounter;
4. initial arrival ownership;
5. arrival contiguous versions/replacement lineage;
6. current arrival pointer;
7. current status-event ownership;
8. status sequence/current parity;
9. valid lifecycle transitions;
10. actor/practitioner scope;
11. triage ownership;
12. triage version/replacement lineage;
13. current triage pointer;
14. acuity/time validity;
15. exact vital link;
16. classification ownership/version/code;
17. typed bite/police evidence;
18. disposition ownership/sequence/current pointer;
19. admitted/admission exact link;
20. discharged/signed-document exact link;
21. transfer/LAMA/DOR/death evidence;
22. source fingerprint parity;
23. foreign-key/integrity composite gate;
24. second-pass new rows.

Persist one replay-safe receipt with named checks, counts, evidence SHA-256, source fingerprints, integrity and second-pass evidence.

# CDB-127E — Disabled provider and readiness

Planned provider:
`src/lib/canonical/emergency-case-triage-provider.ts`

Planned adapters:
`src/lib/canonical/emergency-case-triage-read-adapters.ts`

Planned coverage/readiness:

- `docs/database/canonical-emergency-case-triage-provider-coverage.json`
- `docs/database/emergency-case-triage-readiness.json`
- `scripts/canonical/check-emergency-case-triage-readiness.ts`
- provider/readiness tests.

## Feature flag

`canonical_emergency_case_triage_provider_v1`

Modes:

- legacy;
- shadow;
- canonical.

Defaults:

- enabled by default false;
- default legacy;
- rollback legacy.

## Three selected library adapters

1. emergency board/worklist detail;
2. patient timeline/clinical summary;
3. disposition/admission/discharge handoff.

All remain library-only and route-inactive at CDB-127E. Known writers/readers must be enumerated from fresh repository evidence; stale matrix assignments are not accepted. Unknown assignments and route activation must be zero.

## Readiness gates

Local readiness requires:

- six tables;
- nine commands;
- eight completed partitions;
- twenty-four passed checks;
- exact mapping;
- immutable arrival/status/triage/classification/disposition history;
- exact practitioner/vital/admission/document links;
- PHI-minimised shadow evidence;
- complete coverage;
- provider disabled;
- route activation zero;
- production ready false;
- blocked production and retirement gates.

Production readiness remains false until separately authorized migration, backfill, reconciliation, observation, rollback execution and owner approval exist.

# Cross-checkpoint verification

At every checkpoint run:

- focused CDB-127 tests;
- `pnpm exec tsc --noEmit`;
- `pnpm build:migrations` after B onward;
- schema governance;
- canonical program continuity;
- repository worktree policy.

Do not claim a checkpoint verified while metadata or governance tests are stale.

# Safety and rollback

The only permitted rollback mode before production authorization is legacy. Provider flags remain disabled. Runtime routes keep current legacy behavior. No existing source is deleted, reset, overwritten or frozen. Owner-facing dirty workspace is read-only. Production and remote state remain untouched.

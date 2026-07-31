# P12 Canonical Emergency Case and Triage Schema Receipt

**Checkpoint:** `CDB-127B-CANONICAL-EMERGENCY-CASE-TRIAGE-SCHEMA-VERIFIED`

**Date:** 2026-07-28

**Status:** additive local schema verified; commands, backfill, provider activation, runtime cutover and production work remain incomplete and unauthorized

## Delivered artifacts

- migration: `migrations/0560_canonical_emergency_case_triage.sql`
- Drizzle module: `src/db/schema/canonical/emergency-case-triage.ts`
- Canonical barrel export: `src/db/schema/canonical/index.ts`
- schema contract: `test/canonical/emergency-case-triage-schema.test.ts`
- source-of-truth registry: `docs/database/canonical-source-of-truth.yaml`
- authority matrix: `docs/database/canonical-authority-matrix.yaml`

## Six additive table families

1. `canonical_emergency_cases`
2. `canonical_emergency_arrival_assessments`
3. `canonical_emergency_case_status_events`
4. `canonical_emergency_triage_assessments`
5. `canonical_emergency_case_classifications`
6. `canonical_emergency_disposition_events`

No legacy emergency, visit, admission, discharge-summary, file, KPI, report, billing or patient table was altered or retired.

## Locked database invariants

### Exact emergency-case scope

- one emergency case per exact Canonical encounter;
- encounter must be emergency type and match the active patient link;
- tenant, case, patient, encounter, number namespace/value, command fingerprint and initial source evidence are immutable;
- copied patient name, phone, address, age, date of birth, numeric ID coincidence and timestamp proximity are not stored as identity authority;
- a new case starts at status version 1 in `arrived` or `awaiting_triage`.

### Arrival history

- immutable contiguous versions;
- version 1 is `initial`;
- correction or entered-in-error requires the immediately previous version, a reason and one direct replacement;
- normalized arrival mode, referral source pair, condition, brought-by and police-case evidence are stored without copied demographics;
- observed, arrival and recorded times are ordered;
- current arrival pointer must select the latest exact case/patient/encounter version.

### Emergency lifecycle

- immutable contiguous status events;
- the first event is registration into `arrived` or `awaiting_triage`;
- every later event must continue from the immediately previous status;
- only reviewed transitions are accepted;
- terminal statuses require matching disposition evidence;
- current status, version and event pointer must match the same immutable event.

### Triage history

- immutable contiguous initial, reassessment, correction and entered-in-error versions;
- explicit red/yellow/green compatibility acuity;
- exact active Canonical triage practitioner;
- optional vital observation must match the same tenant, patient and emergency encounter and must not be entered in error;
- observed time and recorded time are separate and ordered;
- current triage pointer must select the latest exact assessment;
- undo/delete semantics are impossible; correction creates a replacement.

### Emergency classifications

- immutable versioned classification families;
- explicit namespace/code/category rather than free-text inference;
- animal-bite classification requires animal, bite-site and bite-time evidence;
- police-case classification requires the police-case indicator;
- correction creates one direct replacement;
- practitioner evidence, when present, must be exact and active.

### Dispositions

- immutable contiguous disposition events;
- admitted requires an exact Canonical admission for the same patient;
- discharge document evidence, when asserted, must be an exact signed final/amendment discharge-summary version for the same patient and emergency encounter;
- transferred requires a paired receiving-organization source identity;
- LAMA, DOR, death and entered-in-error require typed terminal evidence;
- optional transport service event must be posted and scoped to the same encounter;
- current terminal disposition pointer must match the latest exact disposition and terminal case status.

### Preservation

- hard delete is blocked for all six tables;
- arrival, status, triage, classification and disposition rows are append-only;
- case identity and evidence fields cannot be rewritten;
- all external authorities remain separate: patient, encounter, practitioner, vital, admission, clinical document, service and finance facts are referenced, not duplicated.

## Verification

- CDB-127B focused schema contract: 1 file, 7 tests passed;
- CDB-127A+B plus schema governance, program continuity and worktree policy: 5 files, 34 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 495 migrations;
- real repository Canonical schema governance registry: passed.

## Safety state

- production query performed: no;
- production mutation performed: no;
- production migration or backfill applied: no;
- runtime routes changed: no;
- provider created or enabled: no;
- local sync activated: no;
- deployment performed: no;
- push or CDB-to-main integration performed: no;
- legacy source frozen or retired: no;
- connector Git commit action available: no;
- local changes committed: no.

## Next checkpoint

`CDB-127C-CANONICAL-EMERGENCY-CASE-TRIAGE-COMMANDS`

Implement the nine atomic, idempotent commands through one D1 batch boundary with replay-before-validation, deterministic identities, expected-version guards, exact external-authority scope, source mappings, receipts, PHI-minimised outbox and complete rollback. Runtime routes and production state remain unchanged.

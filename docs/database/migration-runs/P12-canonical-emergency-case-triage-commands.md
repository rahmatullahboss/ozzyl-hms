# P12 Canonical Emergency Case and Triage Commands Receipt

**Checkpoint:** `CDB-127C-CANONICAL-EMERGENCY-CASE-TRIAGE-COMMANDS-VERIFIED`

**Date:** 2026-07-28

**Status:** nine local command boundaries verified; backfill, reconciliation, provider/readiness, runtime cutover and production work remain incomplete and unauthorized

## Delivered artifacts

- command module: `src/lib/canonical/commands/manage-emergency-case-triage.ts`
- command contract: `test/canonical/emergency-case-triage-commands.test.ts`
- schema foundation: `migrations/0560_canonical_emergency_case_triage.sql`
- design specification: `docs/superpowers/specs/2026-07-28-cdb-127a-emergency-case-triage-authority-design.md`

## Nine atomic commands

1. `registerCanonicalEmergencyCase`
2. `replaceCanonicalEmergencyArrivalAssessment`
3. `recordCanonicalEmergencyTriageAssessment`
4. `correctCanonicalEmergencyTriageAssessment`
5. `recordCanonicalEmergencyCaseClassification`
6. `correctCanonicalEmergencyCaseClassification`
7. `transitionCanonicalEmergencyCase`
8. `recordCanonicalEmergencyDisposition`
9. `enterCanonicalEmergencyCaseInError`

## Shared command guarantees

Every command:

- validates exact non-empty input and normalized UTC timestamps;
- reads a committed idempotent replay before current-state validation;
- creates deterministic public IDs when a reviewed caller does not supply one;
- rejects changed request fingerprints under the same tenant/idempotency key;
- validates tenant, patient, emergency encounter and active practitioner scope;
- validates optional exact vital, admission, signed document and transport-event scope;
- uses optimistic status, arrival, triage, classification or disposition versions;
- creates immutable child evidence before advancing matching aggregate pointers;
- writes exact source mappings;
- stores replay metadata in the Canonical outbox without patient, encounter, clinical narrative, arrival mode, condition, table name or copied demographic values;
- combines caller-supplied legacy compatibility statements, Canonical facts, mappings and outbox/receipt in one D1 batch;
- rolls back the complete batch on any failure;
- does not import or activate runtime routes.

## Command-specific evidence

### Registration

`registerCanonicalEmergencyCase` atomically writes:

- one exact emergency case;
- arrival assessment version 1;
- status event version 1;
- matching current arrival/status pointers;
- exact legacy source mapping;
- command receipt and PHI-minimised outbox.

The test proves replay, changed-fingerprint conflict, source mapping, compatibility write participation and complete rollback including the compatibility row and outbox claim.

### Arrival correction

`replaceCanonicalEmergencyArrivalAssessment` requires the expected case status version and expected current arrival version. It creates a complete correction version, preserves version 1, links the exact superseded assessment and advances only the current arrival pointer. A stale expected version fails before writes.

### Triage, reassessment and correction

Initial triage requires an active exact Canonical practitioner and optional vital observation from the same patient/emergency encounter. It creates triage version 1 and advances the case from arrived/awaiting-triage to triaged with status event version 2.

Reassessment and correction append immutable versions without adding duplicate lifecycle events when the case remains triaged. The test proves red → yellow reassessment → green correction history, current-pointer parity, replay and rejection of an inactive practitioner.

### Classification and correction

Emergency classifications use explicit namespace/code/category values and immutable family versions. Animal-bite evidence requires animal category, bite site and bite time; police-case evidence requires the indicator. Correction creates version 2 with exact supersession and preserves version 1. Both versions receive exact source mappings.

### Non-terminal lifecycle

`transitionCanonicalEmergencyCase` only permits reviewed non-terminal states. Admitted, discharged, transferred, LAMA, DOR, death and entered-in-error cannot be produced by the generic transition command. The test proves care-in-progress, observation and disposition-pending transitions plus stale expected-version rejection.

### Typed disposition

`recordCanonicalEmergencyDisposition` requires the current case to be disposition-pending and validates:

- admitted → exact active Canonical admission for the same patient;
- discharged → exact signed final/amendment discharge-summary document/version/content hash when asserted;
- transferred → paired receiving-organization identity and optional receiving-encounter identity;
- LAMA/DOR/death → typed terminal evidence;
- optional transport service event → posted and same encounter.

The command atomically inserts the disposition, matching lifecycle event, terminal current pointers, source mapping and receipt/outbox. Tests cover admitted, discharged, transferred and death plus wrong-patient admission rejection.

### Entered in error

`enterCanonicalEmergencyCaseInError` may append entered-in-error evidence to a non-error terminal case. It preserves the prior terminal disposition and every prior lifecycle event, appends disposition version 2 and lifecycle version 6 in the tested discharge scenario, and advances current pointers to the new immutable error evidence. Replay is deterministic.

## Verification

- focused command contract: 1 file, 7 tests passed;
- CDB-127A–C focused suite: 3 files, 20 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 495 migrations;
- schema governance, program continuity and worktree policy: 3 files, 21 tests passed.

## Safety state

- production query performed: no;
- production mutation performed: no;
- production migration or backfill applied: no;
- runtime route imported or changed: no;
- provider created or enabled: no;
- local sync activated: no;
- deployment performed: no;
- push or CDB-to-main integration performed: no;
- legacy writer frozen or history retired: no;
- connector Git commit action available: no;
- local changes committed: no.

## Next checkpoint

`CDB-127D-CANONICAL-EMERGENCY-CASE-TRIAGE-BACKFILL-RECONCILIATION`

Implement eight persistent caller-bounded/resumable read-only backfill partitions and one replay-safe fixed twenty-four-check reconciliation receipt. Use only the nine CDB-127C commands for Canonical business writes, preserve every legacy source unchanged, create deterministic non-PHI processing issues for unresolved evidence, and prove a completed second pass creates zero new business rows, mappings or issues.

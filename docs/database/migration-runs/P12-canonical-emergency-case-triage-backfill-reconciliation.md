# P12 Canonical Emergency Case and Triage Backfill and Reconciliation Receipt

**Checkpoint:** `CDB-127D-CANONICAL-EMERGENCY-CASE-TRIAGE-BACKFILL-RECONCILIATION-VERIFIED`

**Date:** 2026-07-28

**Status:** local bounded backfill and reconciliation verified; provider/readiness, runtime cutover and production work remain incomplete and unauthorized

## Delivered artifacts

- backfill: `scripts/canonical/backfill-emergency-case-triage.ts`
- reconciliation: `scripts/canonical/reconcile-emergency-case-triage.ts`
- contract: `test/canonical/emergency-case-triage-backfill-reconciliation.test.ts`
- command boundary: `src/lib/canonical/commands/manage-emergency-case-triage.ts`

## Eight persistent bounded/resumable partitions

1. exact patient, encounter, practitioner and source scope;
2. emergency case and initial arrival identity;
3. legacy lifecycle evidence and incomplete-history disposition;
4. exact current triage reconstruction;
5. typed emergency classification reconstruction;
6. terminal disposition and exact admission/document/transfer evidence;
7. external discharge-document and attachment authority links;
8. stale projections, arrival-mode configuration, issue evidence and second-pass completion.

Every partition uses a durable `canonical_migration_runs` row and exact `canonical_backfill_checkpoints` row with caller-controlled bounds, cursor, status and aggregate counts. A paused run resumes from its last durable cursor. A completed run skips all partitions on replay.

## Business-write boundary

The backfill reads legacy sources only and creates Canonical business facts exclusively through the nine verified CDB-127C commands:

- registration and arrival;
- triage;
- classification;
- non-terminal lifecycle;
- typed disposition;
- entered-in-error.

No backfill SQL directly inserts or updates an emergency business table.

## Exact mapping and non-inference rules

The backfill requires exact reviewed mappings for:

- legacy patient to active Canonical patient link;
- legacy visit to emergency Canonical encounter;
- legacy user to active Canonical practitioner;
- admitted ER case to Canonical admission;
- legacy discharge summary to exact signed Canonical clinical-document version;
- transfer destination to exact external organisation identity;
- external attachment metadata to exact Canonical attachment identity.

It never uses patient name, phone, copied demographics, ER number, numeric ID coincidence, timestamp proximity, triage colour similarity, case text or free-text similarity as identity proof.

## Deterministic non-PHI issues

Unresolved or incomplete evidence produces stable `canonical_processing_issues` records. Covered examples include:

- missing exact patient link;
- missing exact encounter mapping;
- incomplete mutable triage evidence;
- unresolved active practitioner;
- unreviewed numeric classification code;
- incomplete animal-bite evidence;
- missing Canonical admission;
- missing signed discharge document version;
- missing transfer destination;
- missing exact attachment mapping;
- stale/missing `emergency_visits` quality-KPI projection.

Issue summaries/details contain stable codes and reason codes only. They do not persist patient names, phone numbers, narrative, file URLs, discharge remarks or copied demographics.

## Fixed twenty-four-check reconciliation

The persisted replay-safe receipt contains exactly:

1. source mapping ownership;
2. case tenant/patient/encounter ownership;
3. one case per encounter;
4. initial arrival ownership;
5. arrival version/replacement lineage;
6. current arrival pointer ownership;
7. current status-event ownership;
8. status-event sequence/current-state parity;
9. lifecycle transition validity;
10. actor/practitioner scope;
11. triage ownership;
12. triage version/replacement lineage;
13. current triage pointer parity;
14. acuity/observed/recorded time validity;
15. exact vital-observation link scope;
16. classification ownership/version/code validity;
17. animal-bite/police typed evidence completeness;
18. disposition ownership/sequence/current pointer;
19. admitted-to-Canonical-admission exact link;
20. discharged-to-signed-document exact link;
21. transfer/LAMA/DOR/death/error typed evidence completeness;
22. source fingerprint parity;
23. foreign-key/integrity composite gate;
24. second-pass new business rows.

The integrity composite gate includes foreign-key evidence, SQLite integrity status and unresolved critical issues. Warning/error migration issues remain visible but do not hide or fabricate clinical facts. Critical structural evidence fails closed.

## Synthetic verification evidence

The reviewed fixture proves:

- admitted and discharged legacy rows reconstruct exact Canonical terminal facts;
- one exact complete animal-bite classification is preserved;
- a transferred row without exact destination remains safely `disposition_pending` with a deterministic issue;
- a row without exact patient/encounter scope creates no Canonical clinical fact;
- all five legacy ER tables plus visits remain byte-for-byte unchanged;
- all eight checkpoints complete;
- the completed second pass creates zero cases, arrivals, status events, triage assessments, classifications, dispositions, mappings and issues;
- reconciliation passes all 24 checks and replays the same persisted result;
- fingerprint or second-pass drift fails closed.

## Verification

- focused backfill/reconciliation contract: 1 file, 2 tests passed;
- CDB-127A–D focused suite: 4 files, 22 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 495 migrations;
- schema governance, program continuity and worktree policy: 3 files, 21 tests passed.

## Safety state

- legacy source update/delete performed: no;
- production query performed: no;
- production mutation performed: no;
- production migration or backfill applied: no;
- runtime routes changed: no;
- provider created or enabled: no;
- local sync activated: no;
- deployment performed: no;
- push or CDB-to-main integration performed: no;
- writer freeze or legacy retirement performed: no;
- connector Git commit action available: no;
- local changes committed: no.

## Next checkpoint

`CDB-127E-CANONICAL-EMERGENCY-CASE-TRIAGE-PROVIDER-READINESS`

Implement a disabled-safe legacy/shadow/canonical provider, three selected library-only adapters, complete reviewed writer/reader coverage, aggregate PHI-minimised shadow evidence, rollback-to-legacy contract and fail-closed local readiness. Provider activation and runtime route imports remain zero.

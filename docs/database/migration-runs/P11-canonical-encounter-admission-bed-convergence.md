# P11 Canonical Encounter, Admission, and Bed Convergence

**Checkpoint:** `CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE-VERIFIED`
**Program:** HMS Canonical Data Architecture
**Branch:** `program/cdb-main-continuous-20260725`
**Audit/plan commit:** `f72fa7384`
**Schema/governance commit:** `33ba0221f`
**Encounter/resource command commit:** `ead4669c4`
**Admission/bed lifecycle command commit:** `dd21ac5ad`
**Cancellation schema-stability commit:** `4d7ba3526`
**Provider commit:** `ededc456f`
**Backfill commit:** `f532b618f`
**Reconciliation commit:** `bfc352792`
**Execution mode:** local repository implementation and offline verification only
**Production mutation performed:** no
**Provider flag enabled:** no
**Legacy writes retired:** no
**Local synchronization activated:** no
**Push or CDB-to-main integration performed:** no

## Objective

CDB-113E converges actual-care encounter identity, inpatient admission lifecycle, care-location and bed-resource identity, and interval-based bed occupancy into explicit canonical authorities. It extends the existing canonical encounter and bed-stay foundations instead of creating parallel authorities.

The architecture remains exact:

- encounter is actual care;
- admission is an inpatient lifecycle linked to one encounter;
- bed is resource identity;
- bed stay is interval-based occupancy truth;
- appointment remains planned intent;
- clinical discharge is not financial settlement;
- bed rate, admission fee, package, due, payment, invoice, diagnosis, nursing assignment, patient demographics, names, phone numbers, ward labels, numeric-ID coincidence, and timestamp proximity are not authority evidence for identity or episode linkage.

This receipt confirms local implementation and verification only. It does not claim production backfill, provider activation, reader promotion, shadow observation, cutover, rollback evidence, synchronization activation, or legacy retirement.

## Reviewed scope

The convergence audit and serial plan are:

- `docs/database/audits/2026-07-26-encounter-admission-bed-convergence-audit.md`;
- `docs/superpowers/plans/2026-07-26-cdb-113e-encounter-admission-bed-convergence.md`;
- `test/canonical/encounter-admission-bed-convergence-design-contract.test.ts`.

The reviewed operational surfaces include encounter, visit, consultation, admission, transfer, discharge, death-record, bed, patient-bed-info, nursing occupancy, reception, billing reference, paid-visit context, admission-slip, reporting, dashboard, export, FHIR, and scheduled-work dependencies. Legacy routes remain governed compatibility or legacy surfaces until later read promotion and authorized cutover.

## Additive authority schema

Migration `migrations/0548_canonical_encounter_admission_bed_convergence.sql` and `src/db/schema/canonical/clinical.ts` provide:

- hardened `canonical_encounters` with tenant patient-link reference, positive version, optional care-location reference, controlled source kind, command key, expanded actual-care lifecycle vocabulary, and preserved signed-history evidence;
- `canonical_admissions` for one inpatient lifecycle linked to an encounter and patient link;
- immutable ordered `canonical_admission_status_events`;
- `canonical_care_locations` for tenant-scoped facility/floor/ward/room/care-area hierarchy;
- `canonical_beds` for bed-resource identity and operational state without occupancy or price;
- extended `canonical_bed_stays` for public-ID admission, bed, patient, and encounter references plus interval, version, movement, command, and close evidence.

The schema enforces tenant-safe references, controlled vocabularies, positive versions, deterministic command uniqueness, valid intervals, one active admission per encounter, one open stay per bed, one open stay per admission, active-bed requirements, evidence-hash shape, and preservation of historical legacy source IDs as nullable compatibility evidence.

The SQLite encounter and bed-stay rebuilds preserve historical rows while allowing canonical-only runtime rows. Temporary rebuild tables are not registered as canonical authorities.

## Canonical commands

`src/lib/canonical/commands/start-encounter.ts`, `src/lib/canonical/commands/manage-care-location-and-bed.ts`, and `src/lib/canonical/commands/manage-admission-bed-stay.ts` provide reviewed command boundaries for:

- starting and cancelling actual-care encounters;
- creating, updating, and retiring care locations;
- creating, updating, and retiring bed resources;
- admitting a patient and optionally claiming a bed atomically;
- transferring occupancy by closing one stay and opening the destination stay atomically;
- discharging, cancelling, or entering an admission in error while closing expected active occupancy;
- compatibility statements in the same canonical transaction while legacy readers remain active.

The command layer provides deterministic public IDs when omitted, exact replay, conflicting-replay rejection, optimistic version checks, source-mapping conflict protection, patient/encounter agreement, active-practitioner validation, bed operational/version checks, open-stay race prevention, immutable admission history, PHI-minimised outbox evidence, and rollback of all canonical and compatibility statements on any failure.

Encounter cancellation keeps the existing offline clinical cancellation event-envelope schema stable while carrying the new lifecycle version inside the payload. No provider, route, worker, or synchronization runtime was enabled.

## Disabled providers

`src/lib/canonical/encounter-provider.ts` and `src/lib/canonical/admission-bed-provider.ts` implement disabled-safe feature-flag modes:

- `legacy`;
- `shadow`;
- `canonical`.

Missing, disabled, malformed, or unsupported configuration remains legacy. The flags remain disabled.

Identity-sensitive provider resolution requires exact source mappings and tenant-safe patient, practitioner, encounter, admission, location, bed, and bed-stay evidence. Name, phone, label, legacy numeric coincidence, and time proximity never establish identity or episode linkage.

Shadow parity compares authority facts only. Provider results exclude clinical narrative, diagnosis, signed-content bodies, patient names, phone numbers, admission fee, bed rate, calculated charge, billing status, payment state, and other financial or PHI-bearing fields. Disabled-safe adapters cover encounter detail, timeline, mutation validation, paid-visit episode evidence, admission detail, census, current occupancy, mutation validation, and admission-slip enrichment.

## Deterministic bounded backfill

`scripts/canonical/backfill-encounter-admission-bed-convergence.ts` executes six ordered partitions:

1. encounter hardening;
2. care-location mapping;
3. bed-resource mapping;
4. admission header and initial immutable event creation;
5. bed-stay convergence;
6. stable issue classification.

The backfill provides tenant-scoped migration runs, six persistent checkpoints, bounded `maxSourceRecords` execution, pause/resume from committed cursors, deterministic IDs and evidence, exact patient/encounter/admission/bed mapping, one atomic batch per source row, compatibility-aware legacy column discovery, source-evidence drift protection, stable issue fingerprints, and second-pass zero-new-business-row proof.

Ambiguous identity, missing encounter mapping, patient mismatch, invalid interval, occupancy overlap, multiple active claims, inactive or maintenance-bed occupancy, missing admission or bed mapping, and source drift become persistent issues. The backfill does not guess a winner. Result summaries contain aggregate counts only and exclude demographics, names, phone, diagnosis, admission fee, bed rate, charge, billed state, bill IDs, and copied display labels.

## Persistent reconciliation

`scripts/canonical/reconcile-encounter-admission-bed-convergence.ts` persists one aggregate `canonical_reconciliation_runs` receipt with exactly twenty-three fail-closed checks:

1. encounter source-mapping cardinality;
2. encounter patient-link validity;
3. encounter status and version validity;
4. planned actual-care classification;
5. encounter participant practitioner and tenant validity;
6. admission source-mapping cardinality;
7. one active admission per inpatient encounter;
8. admission header and latest-event parity;
9. admission event sequence and transition validity;
10. encounter and admission patient agreement;
11. admission interval and terminal-time validity;
12. care-location mapping and hierarchy validity;
13. bed-resource mapping and tenant/location validity;
14. open-stay cardinality per bed;
15. open-stay cardinality per active admission;
16. interval overlap per bed;
17. interval overlap per admission;
18. stay, admission, encounter, and patient consistency;
19. inactive, maintenance, or retired bed occupancy;
20. legacy bed status versus derived occupancy;
21. unresolved convergence issues;
22. cross-tenant references;
23. second-pass zero-new-row evidence.

Any nonzero check fails the receipt. `mismatchChecks` counts failed categories, while each check records its exact aggregate mismatch count. Evidence hashing is deterministic across reruns and uses only aggregate check names and counts, never raw patient, practitioner, admission, bed, clinical, or financial row content.

## Governance result

Fresh governance records:

- 46 classified business concepts;
- 78 registered canonical tables;
- 190 governed source, canonical, and legacy tables;
- 858 exact writer access pairs;
- 2,053 exact reader access pairs;
- 0 schema-governance issues;
- 0 business-authority issues;
- 0 writer/reader access-governance issues.

Encounter/admission/bed authority remains `partial_canonical`. The target schema, commands, disabled providers, deterministic backfill, and persistent reconciliation are implemented locally, but active legacy writers/readers, production backfill, shadow observation, reader promotion, rollback evidence, owner authorization, and retirement remain unresolved.

## Focused verification

The completed local implementation bundle passed:

- CDB-113E focused implementation: 9 files, 48 tests;
- complete canonical suite: 203 files, 1,426 tests;
- TypeScript: passed;
- canonical schema governance: 0 issues;
- canonical business-authority governance: 0 issues;
- canonical writer/reader access governance: 0 issues;
- migration manifest: 481 migrations;
- local-sync readiness: 0 of 8 entities ready, 8 blocked;
- legacy-retirement readiness: 0 of 65 allowances eligible, 65 blocked;
- continuity contracts: passed after tracker, control-center, receipt, and handoff promotion;
- worktree policy: passed before final metadata commit.

The blocked readiness results are expected safety evidence, not failed implementation. Runtime consumption, production backfill/reconciliation, observation, rollback evidence, owner authorization, and reader/write retirement remain deliberately gated.

## Safety result

No production database, protected export, credential, secret, feature flag, traffic route, worker, scheduler, local server, or synchronization runtime was accessed or changed.

No migration or backfill was applied remotely. No encounter, visit, consultation, admission, bed, patient-bed-info, appointment, practitioner, patient, nursing, billing, payment, clinical record, report, dashboard, export, or legacy table was changed or retired in production. No branch was pushed and CDB was not integrated into `main`.

## Remaining runtime adoption work

The local target authority is implemented, but runtime adoption remains incomplete:

- legacy encounter, visit, consultation, admission, bed, patient-bed-info, transfer, discharge, nursing, billing, reporting, dashboard, export, and scheduled consumers remain active;
- encounter and admission/bed provider flags remain disabled;
- production backfill and persistent reconciliation have not run;
- shadow parity observation and latency/error-budget evidence do not exist;
- reader promotion, rollback rehearsal, owner authorization, and observation are absent;
- legacy writes and readers are not eligible for retirement.

These are governed cutover/read-promotion tasks and must not be mistaken for missing local schema or command implementation.

## Continuation

The exact next local program checkpoint is:

`CDB-113F-IDENTITY-EPISODE-READ-PROMOTION`

CDB-113F must inventory and promote selected identity and episode readers through disabled-safe providers, preserve legacy fallback, add parity and rollback evidence, and keep all runtime flags disabled unless fresh explicit authorization is provided.

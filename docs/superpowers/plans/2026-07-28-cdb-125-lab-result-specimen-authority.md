# CDB-125 Lab Result and Specimen Authority Implementation Plan

Program: HMS Canonical Data Architecture
Date: 2026-07-28
Current phase: CDB-125A design only
Production mutation authorised: no

## Goal

Implement one local Canonical authority for laboratory specimens, custody, immutable result versions and observations, verification/signature lifecycle, correction/retraction/error lineage, and analyzer provenance while reusing existing Canonical service request/event, patient, encounter, practitioner, and catalog authorities.

## Checkpoint sequence

### CDB-125A — authority audit and design

Deliver audit, specification, implementation plan, design receipt, design contract, authority matrix update, tracker update, and control-centre update. Do not create migration `0558`, Drizzle schema, commands, provider, runtime route changes, or production effects.

### CDB-125B — additive schema

Create `migrations/0558_canonical_lab_result_specimen.sql` and `src/db/schema/canonical/lab-result-specimen.ts`. Export the module from the Canonical barrel and register all eight tables in `docs/database/canonical-source-of-truth.yaml`.

Tables:

1. `canonical_lab_specimens`
2. `canonical_lab_specimen_service_items`
3. `canonical_lab_specimen_status_events`
4. `canonical_lab_result_sets`
5. `canonical_lab_result_versions`
6. `canonical_lab_result_observations`
7. `canonical_lab_result_status_events`
8. `canonical_lab_analyzer_evidence`

Schema tests must prove tenant ownership, exact patient/encounter/request/event/service/specimen/practitioner scope, controlled lifecycle, immutable facts, no hard deletion, contiguous versions, same-scope supersession, exact decimal TEXT, content/signature parity, analyzer source uniqueness, optimistic current pointers, and report-projection separation.

### CDB-125C — atomic command layer

Implement thirteen atomic idempotent commands in `src/lib/canonical/commands/manage-lab-result-specimen.ts`.

1. `registerCanonicalLabSpecimen`
2. `collectCanonicalLabSpecimen`
3. `receiveCanonicalLabSpecimen`
4. `rejectCanonicalLabSpecimen`
5. `createCanonicalLabSpecimenAliquot`
6. `createCanonicalLabResultDraft`
7. `replaceCanonicalLabResultDraft`
8. `verifyCanonicalLabResultVersion`
9. `validateAndPublishCanonicalLabResultVersion`
10. `correctCanonicalLabResultVersion`
11. `retractCanonicalLabResultVersion`
12. `enterCanonicalLabResultInError`
13. `attachCanonicalLabAnalyzerEvidence`

Every command must:

- normalise tenant, IDs, UTC, business date, actors, decimal TEXT, controlled codes, and hashes;
- calculate deterministic IDs when a source identity exists;
- calculate the full request fingerprint before state-dependent validation;
- read replay before current-state validation;
- reject same idempotency key with different request fingerprint;
- validate exact patient link, encounter, service request/event, service catalog, specimen, practitioner, and source mapping;
- create compatibility statements, Canonical facts, source mappings, status events, analyzer evidence, command receipt, and PHI-minimised outbox in one D1 batch;
- roll back the whole operation on any failure;
- never update a prior specimen event, result version, observation, signature, or analyzer evidence row.

Command details:

- registration creates specimen identity plus initial registered event and current pointer;
- collection/receipt/rejection advance specimen state through expected status version and matching event;
- aliquot creates a new derived specimen with same exact patient/encounter and explicit parent event;
- result draft creates result set, first version, deterministic observations, draft event, and current pointer;
- draft replacement creates a new complete immutable version and preserves the old version;
- verification binds verifier and signed content hash to one exact version;
- validation/publish binds validator and signed hash without changing content;
- correction creates a complete replacement version and status event;
- retraction and entered-in-error create immutable replacement/status evidence and preserve prior content;
- analyzer evidence attaches one exact staged observation/source hash to one exact result observation/version.

### CDB-125D — bounded backfill and reconciliation

Implement `scripts/canonical/backfill-lab-result-specimen.ts` and `scripts/canonical/reconcile-lab-result-specimen.ts`.

Ten persistent bounded/resumable backfill partitions:

1. exact legacy lab order-item to Canonical service-request/event mapping and unresolved request disposition;
2. specimen identity and current-state reconstruction from `lab_specimens`;
3. specimen-to-service-item links from `lab_specimen_items` and legacy order-item specimen fields;
4. immutable custody/lifecycle reconstruction from `lab_specimen_events` plus current-status divergence disposition;
5. manual/current result-set and draft/version reconstruction from `lab_reports`, `lab_results`, and result-bearing `lab_order_items`;
6. observation-version and correction lineage reconstruction from `lab_observation_audit` and `lab_result_corrections`;
7. verification, validation, publication, retraction, and entered-in-error lifecycle reconstruction from reports, workflow events, and retraction requests;
8. analyzer ingestion, inbox, machine/log/bridge, acceptance, QC, and validation provenance;
9. unmatched, ambiguous, collision, critical-notification, and workflow-only evidence disposition;
10. duplicate/projection/cache disposition for `tests`, `visit_services`, mutable order-item result fields, report delivery, and second-source result rows.

Partition requirements:

- use `canonical_migration_runs` and `canonical_backfill_checkpoints`;
- persist source type, partition key, cursor, counts, status, and non-PHI errors;
- caller sets maximum source records;
- resume from exact cursor;
- source tables are read-only;
- exact reviewed mappings are mandatory;
- ambiguous rows produce deterministic non-PHI processing issues;
- no report delivery or notification row creates result content;
- no text, accession, barcode, time, patient, test, component, or value similarity creates identity;
- second completed pass creates zero new business rows.

Fixed twenty-eight-check reconciliation:

1. source mapping ownership;
2. specimen patient ownership;
3. specimen encounter ownership;
4. specimen primary request ownership;
5. specimen service-item request/service consistency;
6. specimen parent/aliquot same-scope consistency;
7. specimen current-event ownership;
8. specimen status/event-version consistency;
9. specimen event sequence contiguity;
10. specimen actor completeness;
11. result-set patient ownership;
12. result-set encounter ownership;
13. result-set service request/event ownership;
14. result-set specimen/service consistency;
15. current result-version ownership;
16. result-version sequence contiguity;
17. version supersession same-scope and one-replacement rule;
18. observation deterministic sequence;
19. observation value-type completeness;
20. decimal TEXT grammar and non-REAL authority;
21. observation unit/range/interpretation completeness;
22. verification/validation practitioner scope;
23. signed content hash parity;
24. result status-event sequence/current-state consistency;
25. analyzer evidence source uniqueness and accepted observation ownership;
26. unresolved critical processing issues;
27. source fingerprint, foreign-key, and database integrity composite gate;
28. second-pass new business rows.

The persisted `canonical_reconciliation_runs` receipt must contain exactly twenty-eight named checks, counts, status, deterministic evidence SHA-256, source fingerprints, FK/integrity proof, and second-pass evidence.

### CDB-125E — provider, adapters, coverage, rollback, readiness

Implement a disabled-safe provider and selected adapters:

- provider flag: `canonical_lab_result_specimen_provider_v1`;
- modes: `legacy`, `shadow`, `canonical`;
- enabled by default: false;
- default mode: `legacy`;
- rollback mode: `legacy`.

Provider behaviours:

- legacy preserves existing specimen/result/report output;
- shadow preserves legacy-facing output and emits only aggregate PHI-minimised parity;
- canonical requires exact source mappings and fails closed;
- identity-sensitive reads require exact mapping even in legacy/shadow mode;
- specimen current state and full custody history are available;
- result current version, full version lineage, immutable observations, status/signature history, and analyzer provenance are available;
- report rendering remains a projection.

Initial selected library adapters should cover one specimen-detail reader, one patient/timeline result reader, and one report/result summary reader. No runtime route may import the provider during CDB-125E. Coverage must enumerate all direct writers/readers, classify every reader as selected adapter or `legacy_unchanged`, require unknown assignment count zero, and keep route activation count zero.

Readiness must fail closed if schema/commands/backfill/reconciliation/provider evidence is missing, exact mapping is not required, PHI-minimised shadow evidence is false, version/custody history is hidden, route activation is nonzero, production claims are present, or production/retirement gates are not blocked.

## Schema design details

### Specimen transition rules

- initial registered event version 1;
- registered to collected or entered_in_error;
- collected to in_transit, received, rejected, aliquoted/derived, disposed, entered_in_error;
- in_transit to received, rejected, disposed, entered_in_error;
- received to processing, rejected, aliquoted, disposed, entered_in_error;
- processing to disposed or entered_in_error after result completion policies;
- rejected/disposed/entered_in_error terminal unless a separately modelled replacement specimen is created;
- no mutation of prior custody evidence.

### Result transition rules

- result set starts draft with version/status event 1;
- draft may be replaced by another draft complete version;
- draft may be verified if observations/content hash are complete;
- verified may be validated;
- validated may be published;
- a correction creates a new replacement version from an exact prior version and returns to draft/verified according to policy;
- retracted and entered_in_error preserve prior versions and require explicit reason;
- publication/delivery never changes observation content;
- report delivery state is outside result content authority.

### Decimal and observation rules

All numeric result, reference limit, conversion factor, and quantitative observation authority uses canonical decimal TEXT. Plain grammar only: optional leading minus where clinically allowed, digits, optional one decimal point, no exponent, comma, whitespace, unit suffix, or binary REAL conversion. Values and units remain separate. Text/coded/boolean/date-time/absent values use type-specific fields and checks.

### Signature rules

Verification, validation, and publication reference one exact version. The version content hash is computed from deterministic ordered observation content and immutable metadata. A signed status requires active exact practitioner and `signed_content_sha256 = content_sha256`. Changing observations requires a new version and invalidates prior-current status without altering prior signature evidence.

### Analyzer rules

`lis_ingestion_messages` and `lis_analyzer_inbox` remain governed raw/staging evidence. Canonical analyzer evidence references exact source identities and hashes. One accepted source observation maps to at most one Canonical observation. Identity collision or payload-hash mismatch becomes a processing issue. Raw payload and free-text patient data are excluded from Canonical outbox, readiness, reconciliation summary, and provider parity evidence.

## Verification sequence

For each implementation checkpoint:

1. write failing tests first;
2. observe RED for the intended missing behaviour;
3. implement the minimum authority-preserving change;
4. run focused tests;
5. run TypeScript;
6. run migration manifest and schema governance where schema changes exist;
7. run continuity/worktree policy gates;
8. update receipts, matrix, tracker, control centre, and current plan only after fresh green evidence.

## Prohibited actions

Until separately authorised:

- do not query or mutate production;
- do not apply production schema or backfill;
- do not enable a provider;
- do not wire runtime routes;
- do not freeze legacy writers;
- do not activate local sync;
- do not push or integrate to main;
- do not delete, rewrite, or retire specimen/result/report/analyzer history;
- do not claim production readiness from local tests.

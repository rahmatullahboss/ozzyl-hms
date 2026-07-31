# Lab Result and Specimen Authority Audit

Date: 2026-07-28
Checkpoint: CDB-125A
Scope: repository-only, design-only, no production query or mutation

## Executive finding

The HMS repository has strong individual LIS safety mechanisms, but it does not have one Canonical authority for specimen identity/custody, immutable result versions, verification/signature state, and analyzer provenance. `canonical_service_requests`, `canonical_service_events`, and `canonical_service_participants` already own generic ordered and delivered service facts. They must be reused. They cannot represent accessioned specimens, custody changes, observation components, corrected result versions, signed verification, report publication, analyzer messages, or result retraction.

The current laboratory implementation is a set of overlapping operational authorities, compatibility caches, audit tables, workflow documents, and projections. Every current table remains a legacy compatibility source until a separately authorised cutover. None of the tables described below is Canonical authority merely because its name contains `canonical`, `audit`, `version`, `report`, or `result`.

## Current service-request boundary

`canonical_service_requests` and `canonical_service_events` already model requested and delivered clinical work. CDB-125 must not create another lab-order authority. The lab domain extension must resolve an exact Canonical request and, where relevant, an exact delivered service event. `lab_orders`, `lab_order_items`, `tests`, and `visit_services` remain legacy sources or projections during migration.

## Specimen sources

### `lab_specimens`

Created by `migrations/0368_lis_ris_enterprise_hardening.sql`. It stores accession/barcode, order, patient, specimen type, container, collection status, collection/receipt/rejection actors and times, parent specimen, transport, storage, location, notes, and tenant. The current row is mutable. `src/routes/tenant/lab.ts` inserts a specimen during collection and later updates the same row during receipt. It is an operational workflow source and a legacy compatibility source, not Canonical authority.

### `lab_specimen_items`

Links one specimen to legacy lab order items and tests. It is a useful source relation, but it references legacy identities. It does not prove an exact Canonical service request, exact patient link, exact encounter, or current custody version.

### `lab_specimen_events`

Stores collected, received, rejected, aliquoted, transferred, and disposed-like event evidence with actor, location, notes, and metadata. The table looks append-oriented, but it lacks a complete database-level state-version contract, exact actor/practitioner mapping, one-current-state assertion, same-specimen transition validation, and immutable-field/delete protection. `src/routes/tenant/lab.ts` writes these events separately from specimen and order-item updates, so current status and event history can diverge after partial failure.

### Specimen writer path

`src/routes/tenant/lab.ts` performs specimen collection as separate operations: read the order, generate accession, insert `lab_specimens`, insert `lab_specimen_items`, mutate `lab_order_items`, append workflow/event rows, and create audit logs. Receipt similarly updates `lab_specimens`, updates `lab_order_items`, and appends events separately. This is not one atomic Canonical command boundary.

## Result and report sources

### `lab_order_items`

The table combines request line, billing amounts, specimen status, result cache, abnormal flag, completion, verification, machine/log pointers, accession, and retraction state. `src/routes/tenant/lab.ts` and `src/routes/tenant/lab-results.ts` overwrite `result`, `result_numeric`, `abnormal_flag`, `result_status`, `status`, and completion data. It is a mixed operational source and compatibility cache. It cannot remain result-version authority.

### `lab_reports`

Stores a mutable report header per order/item with report status, review status, reviewer/validator, publication, delivery, correction, retraction, `report_version`, `supersedes_report_id`, signatory IDs, and notes. `src/routes/tenant/labWorkflow.ts` directly changes verification, validation, publication, correction, and delivery state. This table is a report projection and workflow document. It is not immutable result authority and is not a signed Canonical version merely because it has a version column.

### `lab_results`

Stores individual result values, optional REAL numeric values, units, range, flags, status, comments, machine linkage, analyzer inbox linkage, retraction fields, and mutable timestamps. Writers include `src/routes/tenant/lab.ts`, `src/routes/tenant/lab-results.ts`, `src/routes/tenant/labWorkflow.ts`, `src/services/lis-result-acceptance.ts`, and `src/services/lis-result-retraction.ts`. Manual and workflow correction paths update an existing row. It is an operational legacy compatibility source, not Canonical authority.

### `lab_observation_audit`

Stores observation snapshots, version numbers, supersession, verification, correction, analyzer/log/specimen links, retraction request, and analyzer inbox references. `src/services/lis-result-acceptance.ts` and `src/services/lis-result-retraction.ts` append rows in D1 batches. This is valuable audit history. However, version generation uses `MAX(version_no) + 1`, and there is no complete database-level unique same-scope version sequence, immutable update/delete guard, exact patient/encounter/service-request ownership, result-set content hash, signature parity, or one-replacement rule. It is not Canonical authority.

### `lab_result_corrections`

`src/routes/tenant/labWorkflow.ts` appends correction evidence but then overwrites the referenced `lab_results` row and resets `lab_reports` review state. The correction table preserves some history but does not create a full immutable result version containing all observations and a signed content hash.

## Verification, validation, publication, and retraction

`src/routes/tenant/labWorkflow.ts` verifies a report by updating `lab_reports`, then separately updates `lab_order_items`. Validation/publish updates `lab_reports`, then order items, then the lab order, then workflow and audit rows. These sequential writes can disagree after partial failure and do not bind a signature to an exact immutable content version.

Analyzer acceptance in `src/services/lis-result-acceptance.ts` is stronger: it claims an inbox version and executes a D1 batch that updates caches, inserts `lab_results`, appends `lab_observation_audit`, creates critical outbox evidence, updates the inbox, completes the order, and completes the acceptance command. It is still a legacy workflow because the accepted clinical result is stored in mutable legacy tables and audit version allocation is not a database-enforced Canonical sequence.

Retraction in `src/services/lis-result-retraction.ts` uses two-person review through `lis_result_retraction_requests`, immutable request evidence, guarded state versions, a D1 batch, notification outbox, and an appended `lab_observation_audit` row. These are important safety controls. Retraction still mutates `lab_results`, `lab_order_items`, and `lab_reports`; it does not create a Canonical entered-in-error/retracted result version and status event linked to an exact signed version.

## Analyzer and raw-message provenance

`lis_ingestion_messages` stores immutable raw analyzer message evidence, identity, delivery, payload hash, protocol, and machine. `lis_analyzer_inbox` stores immutable staged observation evidence, matching/QC/validation state, exact legacy candidate links, normalized values, state version, supersession, disposition, and acceptance. `lab_machine_result_log`, `lab_machines`, `lab_machine_test_map`, `lis_bridge_agents`, `lis_unmatched_results`, and `lis_ingestion_collisions` provide additional operational evidence.

These tables should remain evidence sources. CDB-125 must not copy unrestricted raw payloads or patient identifiers into Canonical outbox/readiness receipts. `canonical_lab_analyzer_evidence` should retain exact source identities and hashes, machine/bridge identity, protocol, observation index, QC/validation disposition, and accepted link to one exact result observation/version. Analyzer code, test name, result value, time, accession, and patient proximity are not identity proof.

## Duplicate and projection surfaces

- `tests` is a duplicate legacy test/result surface and must not become a second authority.
- `visit_services` is a service projection/cache, not specimen or result authority.
- `lab_order_items.result*` is a mutable compatibility cache.
- `lab_reports` is a report projection/workflow surface.
- `lab_results` is a current-value compatibility source.
- `lab_observation_audit` is audit history, not sufficient Canonical authority.
- `lab_workflow_events`, critical-result outboxes, notifications, delivery state, and acceptance/retraction requests are workflow/audit evidence, not result content authority.

## Writer inventory

Primary direct writers reviewed:

- `src/routes/tenant/lab.ts`
- `src/routes/tenant/lab-results.ts`
- `src/routes/tenant/labWorkflow.ts`
- `src/routes/tenant/labValidation.ts`
- `src/services/lis-result-acceptance.ts`
- `src/services/lis-result-retraction.ts`

Additional machine, workflow, report, and import routes may stage or project laboratory state. They must be classified during CDB-125D/E coverage; no route may be assumed safe because it only updates status.

## Reader inventory

Major readers include:

- `src/routes/tenant/reportLab.ts`
- `src/routes/tenant/patients-timeline.ts`
- `src/lib/health-summary.ts`
- `src/routes/tenant/lab.ts`
- `src/routes/tenant/lab-results.ts`
- `src/routes/tenant/labWorkflow.ts`
- `src/routes/tenant/labValidation.ts`
- `src/routes/tenant/patientPortal.ts`
- `src/routes/tenant/hospital-links.ts`
- `src/routes/tenant/ccda.ts`
- `src/routes/tenant/labNotifications.ts`
- `src/routes/tenant/labMachines.ts`
- `src/lib/ot-programmatic-overview.ts`

Downstream views frequently reconstruct “latest” result from mutable rows rather than one exact immutable version. Reader promotion must be explicit and provider-controlled.

## Required authority split

CDB-125 must add lab domain extensions keyed to existing Canonical service and identity authorities:

1. `canonical_lab_specimens` — specimen identity and current lifecycle pointer.
2. `canonical_lab_specimen_service_items` — exact specimen-to-service-request relation.
3. `canonical_lab_specimen_status_events` — immutable custody/lifecycle events.
4. `canonical_lab_result_sets` — one patient/encounter/request/specimen result set with current version/status.
5. `canonical_lab_result_versions` — immutable complete result/report versions and correction lineage.
6. `canonical_lab_result_observations` — immutable component observations within one exact version.
7. `canonical_lab_result_status_events` — draft, verified, validated, published, corrected, retracted, and entered-in-error lifecycle evidence.
8. `canonical_lab_analyzer_evidence` — exact immutable analyzer/source-hash provenance.

`canonical_service_requests`, `canonical_service_events`, `canonical_service_participants`, patient links, encounters, practitioners, and service catalog remain reused authorities. A report projection may be rebuilt from result-set/version/status authority and must never own clinical result content.

## Safety and cutover conclusion

CDB-125A is design-only. No migration `0558`, Drizzle schema, command module, provider, runtime route change, production query/mutation, production migration/backfill, local sync activation, push, integration, or retirement is authorised. Every current laboratory table remains active legacy compatibility source until bounded migration, reconciliation, provider observation, rollback proof, and exact owner authorisation are complete.

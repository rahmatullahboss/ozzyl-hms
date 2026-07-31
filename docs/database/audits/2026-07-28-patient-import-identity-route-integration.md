# CDB-V1-030D patient import identity route integration audit

**Date:** 2026-07-28  
**Checkpoint:** `CDB-V1-030D-PATIENT-IMPORT-IDENTITY-ROUTE-INTEGRATION-VERIFIED`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Scope:** local protected-core implementation and repository evidence only

## Result

The single protected `src/routes/tenant/settings-import-export.ts` / `patients` insert writer now crosses the frozen Canonical tenant-patient linkage boundary through `src/lib/canonical/patient-import-route-integration.ts` and `registerOrLinkPatient`.

The route preserves the existing CSV parser, required name/mobile validation, row-level success/failure counters, first-20 error list, HTTP status and sample/export behaviour. It does not claim or manufacture a global patient identity when import evidence is insufficient.

## Exact import identity

Each import batch receives a tenant-scoped SHA-256 identity derived from either the supplied `Idempotency-Key` or the exact CSV payload. Each valid data row receives a stable source key containing only the batch digest and row number.

- Raw CSV text, names, phone numbers, addresses and client keys are not persisted as Canonical source IDs.
- A source key is exact import-occurrence identity, not patient-person matching evidence.
- Another row or batch with the same name/mobile is not silently merged.
- Imported patients begin as `unlinked` / `unverified` with `no_link_placeholder` evidence and no `global_patient_uhid` claim.
- Ambiguous or later verified identity remains subject to the existing reviewed patient-link lifecycle and MPI rules.

Migration `0564_patient_import_route_identity.sql` adds nullable `patients.canonical_source_key` and a tenant-scoped partial unique index. Existing patients are not rewritten.

## Atomic mutation boundary

For each valid row, one D1 batch commits:

- the legacy `patients` compatibility row using an explicit reserved numeric ID;
- the master-data audit statement;
- the Canonical tenant-patient relationship;
- the immutable patient-link event;
- the exact source mapping;
- the idempotency receipt; and
- the PHI-minimised Canonical outbox event.

The adapter first reuses an exact `(tenant_id, canonical_source_key)` patient when present. Otherwise it reserves `MAX(id)+1` before the batch. A concurrent primary-key or source-key collision aborts the complete batch; no partial patient, relationship, mapping, audit, receipt or outbox survives. A retry recomputes the available ID.

`registerOrLinkPatient` now accepts caller-owned authoritative statements through the shared Canonical execution-options contract. Replay fingerprints exclude transport event time and business date while retaining source identity, evidence hash, lifecycle transition, actor, expected version and all semantic identity facts. Therefore an exact retry replays even when request time changes, while changed row evidence under the same operation key fails with `CanonicalIdempotencyConflictError`.

## Deterministic governance result

After access, identity/episode coverage, protected inventory and writer coverage regeneration:

- governed tables: 260;
- repository writers: 1,006;
- repository readers: 2,586;
- identity/episode eligible readers: 818 across 285 paths and 63 tables;
- protected surfaces: 878;
- protected routes: 44;
- protected UI flows: 28;
- protected writers: 218;
- protected readers: 465;
- protected tables: 83;
- Canonical-command writers: 107;
- atomic-compatibility writers: 45;
- governed-external writers: 3;
- command-required writers: 59;
- isolated fixtures: 4;
- remaining implementation groups: 13;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

The `settings-import-export.ts` / `patients` writer is registered under strict boundary `patient-identity.import-route`. Promotion is fail-closed unless route, adapter, patient-link command, migration, SQLite replay/rollback tests and HTTP batch test all contain the required evidence.

## Verification

Fresh local verification:

- patient import focused suite: 5 files, 70 tests, 0 failures;
- patient import SQLite route contract: 5 tests, 0 failures;
- patient-link lifecycle command contract: 9 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 498 conforming migrations;
- full `pnpm canonical:check`: passed with zero governance issues;
- protected inventory: 878 surfaces, 218 writers, 465 readers, zero unknown assignments;
- protected writer coverage: 59 command-required, 45 atomic-compatibility, zero unclassified.

## Safety state

- production query performed: no;
- production mutation performed: no;
- production migration/backfill applied: no;
- provider or feature flag enabled: no;
- route or traffic cutover: no;
- deployment: no;
- local sync activation: no;
- legacy retirement or deletion: no;
- push: no;
- CDB-to-main integration: no.

## Exact next bounded slice

`CDB-V1-030E-APPOINTMENT-INTENT-ROUTE-INTEGRATION`

Integrate the four remaining protected appointment-intent writers in `appointment-billing-finalization.ts`, `doctors.ts`, `doctorSchedules.ts` and `queue.ts` with the frozen appointment commands. Preserve scheduling, queue and billing-finalisation HTTP/UI behaviour; use exact tenant, appointment and practitioner identities; commit compatibility, Canonical intent/status/link evidence, mapping, idempotency, audit and outbox atomically; prove replay, stale/concurrent transition rejection, tenant isolation and complete rollback; then regenerate governance artifacts.

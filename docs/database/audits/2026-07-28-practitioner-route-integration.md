# CDB-V1-030C practitioner route integration audit

**Date:** 2026-07-28  
**Checkpoint:** `CDB-V1-030C-PRACTITIONER-ROUTE-INTEGRATION-VERIFIED`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Scope:** local protected-core implementation and repository evidence only

## Result

The protected `src/routes/tenant/doctors.ts` writer for the legacy `doctors` table now crosses the frozen Canonical practitioner identity and practitioner-account-link command boundary.

The route preserves the reviewed HTTP status, response envelope, role checks, doctor self-edit restrictions, money fields, marketplace behaviour and site re-render behaviour. No provider mode, production route, traffic, database or deployment state was changed.

## Atomic mutation boundary

Doctor create, identity update, activation and deactivation now commit the following in one D1 batch:

- the legacy `doctors` compatibility mutation;
- the master-data audit statement;
- the Canonical practitioner current fact;
- exact source mapping;
- BMDC identifier lifecycle evidence where applicable;
- specialty and department primary classification evidence where applicable;
- practitioner-to-user link lifecycle evidence where applicable;
- the Canonical command replay receipt; and
- the PHI-minimised Canonical outbox event.

A failure in any authoritative, Canonical, mapping, audit, receipt or outbox statement rolls back the complete batch. Projection-only doctor fields still commit with their audit in one batch but do not create an unnecessary Canonical identity version.

## Stable identity

Migration `0563_practitioner_route_identity.sql` adds nullable `doctors.canonical_source_key` and a tenant-scoped partial unique index. Existing rows are not rewritten.

- A new doctor route operation receives a stable source key before the auto-increment legacy ID exists.
- An existing row without the new key uses its exact tenant-scoped legacy doctor ID and adopts that value in the same update batch.
- Existing active `canonical_source_mappings` are reused rather than regenerated from a guessed prefix.
- Names, specialty, department, phone, email, numeric coincidence and timestamps are not identity matching evidence.

The live doctor-compensation projection now reads `doctors.canonical_source_key`. It reuses an exact existing practitioner source mapping when one exists, preserves historical `prc_*` identities for numeric legacy sources and uses the route `pract_*` identity only for route-generated source keys. This prevents a second practitioner identity during later accrual creation.

## Lifecycle and correction rules

- Display-name changes, including display-only case changes, update Canonical presentation while preserving one practitioner identity.
- BMDC replacement retires the prior identifier and appends the new unverified identifier.
- Specialty and department replacement demotes the prior primary classification and appends or promotes the new primary classification.
- Doctor deactivation changes practitioner status to `inactive` and retires the exact linked user relationship without deleting history.
- Reactivation returns the practitioner and exact user relationship to active state through the same optimistic-version command.
- Exact replay returns the original command result; a changed request under the same key raises `CanonicalIdempotencyConflictError`.

## Deterministic governance result

After access, inventory, identity/episode coverage and protected writer coverage regeneration:

- governed tables: 260;
- repository writers: 1,006;
- repository readers: 2,585;
- identity/episode eligible readers: 817 across 284 paths and 63 tables;
- protected surfaces: 877;
- protected routes: 44;
- protected UI flows: 28;
- protected writers: 218;
- protected readers: 464;
- protected tables: 83;
- Canonical-command writers: 107;
- atomic-compatibility writers: 44;
- governed-external writers: 3;
- command-required writers: 60;
- isolated fixtures: 4;
- remaining implementation groups: 15;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

The `src/routes/tenant/doctors.ts` / `doctors` writer is registered under strict boundary `practitioner.manage.doctor-route`. Promotion is fail-closed unless the route, adapter, frozen command module, migration and replay/rollback contract tests all contain the required evidence.

## Verification

Fresh local verification:

- practitioner/doctor focused suite: 9 files, 114 tests, 0 failures;
- practitioner route SQLite contract: 6 tests, 0 failures;
- live doctor-compensation identity regression: 5 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 497 conforming migrations;
- `pnpm canonical:check`: passed with zero governance issues;
- protected inventory: 877 surfaces, 218 writers, 464 readers, zero unknown assignments;
- protected writer coverage: 60 command-required, 44 atomic-compatibility, zero unclassified.

The upload-photo tests emit their pre-existing missing mock object-storage warnings while passing; this checkpoint does not change upload behaviour.

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

`CDB-V1-030D-PATIENT-IMPORT-IDENTITY-ROUTE-INTEGRATION`

Integrate the single protected `src/routes/tenant/settings-import-export.ts` / `patients` insert writer with the frozen `registerOrLinkPatient`, governed global-patient identity and tenant-patient-linkage boundaries. Preserve import validation and response behaviour; require exact tenant/source identity; commit import compatibility, Canonical relationship, mapping, idempotency, audit and outbox evidence in one batch; prove replay, ambiguity preservation and full rollback; then regenerate governance artifacts.

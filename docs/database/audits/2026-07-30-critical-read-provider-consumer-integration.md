# Canonical Core V1 critical read provider and consumer integration audit

Updated: 2026-07-30

Checkpoint: `CDB-V1-040C-REMAINING-CRITICAL-READ-PROVIDER-INTEGRATION-VERIFIED`

Branch: `program/cdb-main-continuous-20260725`

Base metadata commit: `4a86b6096`

## Scope

This checkpoint completes the remaining bounded CDB-V1-040 critical-read implementation for:

- tenant patient identity;
- practitioner identity and account-linked practitioner projection;
- Reception appointment, encounter and active-admission context;
- practitioner compensation accrual/adjustment projection.

Production and protected-clone execution were not authorized. No remote database was queried or mutated.

## Implemented provider and consumer boundaries

`src/lib/canonical/critical-read-consumer-adapters.ts` provides one fail-closed batch contract for these six stable consumer IDs:

- `cdb040c.reception-patient-context.patient`;
- `cdb040c.reception-patient-context.practitioner`;
- `cdb040c.reception-patient-context.appointment`;
- `cdb040c.reception-patient-context.encounter`;
- `cdb040c.reception-patient-context.admission`;
- `cdb040c.commission-accrual-admin`.

The batch is limited to 100 exact provider/source scopes. Duplicate scope, provider failure, non-shadow selection, missing evidence, missing mapping, unexplained variance and unauthorized Canonical response promotion fail closed. Successful evidence retains the reviewed legacy provider and records immediate rollback to legacy.

## Reception patient context

`GET /api/reception/patients/:id/context` now observes the existing patient, practitioner, appointment, encounter and admission provider flags while preserving the existing response envelope.

- legacy mode performs no comparison work and preserves the existing response;
- shadow mode runs exact mapped comparisons and persists PHI-minimised evidence;
- Canonical response promotion is blocked with HTTP 503 because that response contract requires separate authorization;
- observation-only appointment and practitioner identifiers are removed before the response is serialized;
- shadow comparison failure is logged with aggregate variance evidence while the selected response remains legacy.

## Compensation accrual provider

`src/lib/canonical/contracts/compensation-accrual-provider.ts` implements `canonical_compensation_accrual_provider_v1` against the current `doctor_commission_accruals` compatibility ledger and `canonical_compensation_accruals` authority.

The provider:

- defaults and rolls back to legacy even when Canonical schema is absent;
- uses exact tenant-scoped source mapping with source type `legacy_doctor_commission_accrual`;
- normalizes `approved` to Canonical `accrued`, `paid` to `settled`, and `cancelled` to `reversed`;
- compares earned, adjusted, settled and payable values in integer BDT minor units;
- persists exact source and Canonical row keys, status, deterministic variance IDs, elapsed time and build SHA in `canonical_reconciliation_runs`;
- requires one exact mapped Canonical accrual in Canonical mode.

`GET /api/commissions/doctor-accruals` remains legacy by default. Shadow mode returns the original rows while persisting comparison evidence. Canonical mode, if separately enabled, projects Canonical amounts and lifecycle state back through the existing response fields.

## Local comparison evidence

A real local SQLite/D1-equivalent batch exercised all six provider/consumer scopes and persisted six passed reconciliation rows with:

- exact source row keys;
- exact Canonical row keys;
- zero variance IDs;
- zero critical unexplained variance;
- build SHA evidence;
- PHI-minimised summaries;
- rollback mode `legacy`.

This is local evidence only and is not protected-clone or production evidence.

## Protected-clone package

`docs/database/cdb-v1-040c-protected-clone-comparison-package.json` prepares the exact provider, consumer, source, Canonical, evidence, acceptance and abort contracts for a future protected-clone run.

The package explicitly records:

- `prepared_not_authorized`;
- protected-clone execution not performed;
- production query not performed;
- provider activation, deployment and traffic change not performed;
- fresh exact authorization required;
- historical authorization not reusable.

## Deterministic repository state

- protected surfaces: 954;
- protected HTTP routes: 44;
- protected UI flows: 28;
- protected writers: 235;
- protected readers: 522;
- protected tables: 85;
- repository access writers: 1,033;
- repository access readers: 2,705;
- Canonical-command writers: 118;
- atomic-compatibility writers: 110;
- command-required writers: 0;
- remaining writer implementation groups: 0;
- existing provider boundaries: 10;
- contract-only provider boundaries: 8;
- identity/episode coverage: 849 reader pairs across 296 paths and 63 tables, zero unknown assignments.

## Verification

- focused provider, consumer, package and affected-route verification: 6 files / 68 tests / 0 failures;
- combined focused, protected-core and continuity verification: 12 files / 98 tests / 0 failures;
- root TypeScript: passed;
- governed migration manifest: 504 migrations;
- full `canonical:check`: passed with zero governance issues.

## Safety state

The following did not occur:

- production or protected-clone query;
- production or protected-clone mutation;
- migration or backfill execution;
- provider or feature-flag activation;
- deployment or traffic change;
- local-sync activation;
- legacy retirement;
- push;
- CDB-to-main integration.

## Next gate

`CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-AUTHORIZATION-REQUIRED`

CDB-V1-050 may execute only after a fresh exact authorization binds the protected clone/database identity, source snapshot SHA-256, repository commit/build, tenant and row scope, backup/export evidence, execution and rollback owners, acceptance thresholds, abort conditions and observation window.

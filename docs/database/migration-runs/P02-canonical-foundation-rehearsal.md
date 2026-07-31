# P02 Canonical Foundation D1 Rehearsal

**Task:** CDB-020 — Add canonical registries and schema modules

**Date:** 2026-07-13

**Branch:** `task/cdb-020-canonical-foundation`

**Migration:** `0423_canonical_program_foundation.sql`

## Scope

This run added the additive D1/SQLite foundation for the HMS canonical migration program. It did not modify or remove any legacy table, column, trigger, view, or business row.

Created tables:

- `canonical_schema_versions`
- `canonical_migration_runs`
- `canonical_backfill_checkpoints`
- `canonical_source_mappings`
- `canonical_outbox_events`
- `canonical_processing_issues`
- `canonical_reconciliation_runs`
- `canonical_feature_flags`

## Safety and integrity contracts

The migration enforces:

- `tenant_id TEXT NOT NULL` on every canonical table;
- UTC ISO timestamps using `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
- integer minor-unit reconciliation amounts and no canonical `REAL` columns;
- tenant-scoped composite foreign keys for migration and reconciliation audit links;
- restricted deletion of referenced migration/reconciliation audit records;
- deterministic source uniqueness `(tenant_id, entity_type, source_type, source_public_id)`;
- outbox idempotency uniqueness `(tenant_id, idempotency_key)`;
- feature-flag uniqueness `(tenant_id, flag_key)`;
- one active schema version per tenant/domain;
- no guessed canonical ID for ambiguous or rejected source mappings;
- terminal lifecycle timestamps for migration, backfill, and reconciliation runs;
- outbox processing-lock and publication evidence requirements;
- reconciliation count and minor-unit variance consistency;
- processing-issue resolution evidence;
- disabled feature flags cannot remain enabled.

The SQL is additive-only and contains no `DROP TABLE`, `ALTER TABLE`, cascade delete, legacy write, or Bangladesh-offset timestamp expression.

## Local D1 rehearsal

Wrangler applied the migration to an isolated persisted local D1 database.

- SQL commands executed: `37`
- canonical tables: `8`
- canonical rows: `0`
- FK violations: `0`
- migration ledger entry: present

The foundation migration test was written first and failed while the migration/schema files were absent. After implementation and adversarial hardening, all six foundation tests passed.

## Remote rehearsal clone

Database:

- Name: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`

Pre-apply Time Travel bookmark:

`0000000d-00000000-000050a7-752eec0d6e9a7babd06a3ac7b59d7a64`

Post-apply Time Travel bookmark:

`0000000e-00000000-000050a7-dafc3606bad5be3e495b6bb9a72c1812`

Wrangler migration apply result:

- `0423_canonical_program_foundation.sql`: successful
- SQL commands executed: `37`
- second direct execution for idempotency: `36` queries, `0` rows read, `0` rows written
- remaining pending migrations: `0`

Post-apply remote state:

- canonical tables: `8`
- canonical indexes: `27`
- canonical rows: `0`
- migration ledger rows for `0423`: `1`
- FK violations: `0`

## Protected export reconciliation

Protected artifacts are stored outside Git at:

`/Users/rahmatullahzisan/.hms-canonical-rehearsals/20260713-cdb020-foundation`

The post-apply clone export was reconstructed locally and compared with the protected CDB-012 clone baseline snapshot.

| Check | Before | After | Result |
|---|---:|---:|---|
| Non-internal schema tables | 779 | 787 | eight expected canonical tables |
| Total rows | 79,433 | 79,437 | four migration-ledger rows only |
| Canonical business rows | 0 | 0 | unchanged/empty |
| Triggers | 56 | 56 | exact match |
| FK violations | 0 | 0 | exact match |
| Missing legacy tables | 0 | 0 | pass |

The only legacy row-count change was `d1_migrations: 442 → 446`, consisting of the three earlier ledger-reconciliation entries plus `0423`.

The only pre-existing legacy schema difference from the older baseline was the already-approved `idx_inv_stock_tx_lab_idempotency` index added during the prior production migration reconciliation. No CDB-020 migration statement changed `InventoryStockTransaction`.

## Verification

- canonical and migration-manifest tests: `8` files, `50` tests, `0` failures;
- migration manifest build: `433` conforming migrations;
- TypeScript: `0` errors;
- local Wrangler migration: pass;
- remote rehearsal migration: pass;
- second-run idempotency: pass;
- protected schema/row reconciliation: pass;
- production mutation: none;
- Worker/application deployment: none;
- Git push or `main` merge: none.

## Production boundary

Migration `0423` has not been applied to production. Production D1 remains on the previously reconciled ledger through `0422`. A separate explicit production authorization, fresh export, Time Travel bookmark, maintenance/cutover decision, and production verification are required before applying this foundation migration there.

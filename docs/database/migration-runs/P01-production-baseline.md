# P01 Production Baseline Reconciliation

**Task:** CDB-012 — Capture live schema and baseline reconciliation

**Generated:** 2026-07-13T14:48:15.320Z

**Result:** Baseline captured; unresolved exceptions remain open for classification and migration planning.

## Verified identities, safety, and retention

Production source:

- D1 name: `hms-super-admin-production-apac`
- D1 UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`
- CDB-012 access: protected local export/snapshot and read-only identity evidence only; no production write, migration, deploy, or rollback action
- Time Travel bookmark inherited from CDB-011: `00001c2c-0000009e-000050a7-91f124f4f05877dc26692233aebe167e`

Rehearsal clone:

- D1 name: `hms-canonical-rehearsal-20260713-b6036e`
- D1 UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- Empty-state bookmark: `00000000-0000000a-000050a7-5bfc7e9307dadc26f6edb79845e5b7ec`
- Final import bookmark: `00000009-000012fe-000050a7-62d33a196ef78d6d43fed70fa48c68f1`
- CDB-012 did not mutate or delete the clone

Protected local artifacts remain outside Git at:

`/Users/rahmatullahzisan/.hms-canonical-rehearsals/20260713-cdb011`

Retention review date is `2026-08-13`. Deletion requires P01 baseline acceptance, completion of the first canonical staging migration/backfill rehearsal, confirmation that no rollback or reconciliation investigation still depends on the evidence, and explicit owner approval. The review date does not authorize automatic deletion.

The local hospital server remained disconnected. Data-bearing SQL, SQLite, full schema JSON, protected manifests, signed URLs, and patient row content remain outside Git. The committed report and exception registry contain table names, stable IDs, counts, schema signatures, controlled reference types, and aggregate values only.

## Source and clone roles

The source SQLite snapshot is the authority for exact legacy schema, foreign-key declarations, and source violations. The clone mirror is used for migration, backfill, aggregate, and reconciliation rehearsal. A clone import waiver is compatibility evidence only and is not authorization to omit future canonical production constraints.

| Role | File | Tables | Aggregate rows | FK violations under that schema |
|---|---|---:|---:|---:|
| Exact production-source snapshot | `source-local.sqlite` | 779 | 79433 | 49 |
| Clone rehearsal mirror | `cdb012-clone-export-local.sqlite` | 779 | 79433 | 0 |

Source SHA-256: `f850678d45aca8fcb69fae9ee66b8878c8fa9f5ebb583b92d2b490c54e7e7f4d`

Clone SHA-256: `8c33b8412226661373ace67df2715e78fd0f4c5842b72219a9bcfd6b0ec44175`

## Schema inventory

| Metric | Source | Clone |
|---|---:|---:|
| Tables | 779 | 779 |
| Columns | 11587 | 11587 |
| Indexes | 1794 | 1794 |
| Foreign-key rows | 717 | 699 |
| Check constraints | 490 | 490 |
| Views | 0 | 0 |
| Triggers | 56 | 56 |

Unexpected column, index, check, view, or trigger differences are emitted as open schema-drift exceptions. Documented FK import waivers are classified separately.

## Exception status

- Total exceptions: 439
- Open exceptions: 421
- Accepted import-compatibility exceptions: 18

Accepted import-compatibility status acknowledges the documented rehearsal import mechanism only. It is not authorization to omit future canonical production constraints.

## Migration drift

- Production migration table present: true
- Production applied migration rows: 442
- Repository SQL migration files: 441
- Duplicate applied migration names: 0
- Applied names absent from repository: 4
- Repository names not recorded as applied: 3

Applied-but-absent names:

- `0417_mfa_login_challenges.sql`
- `0418_staff_auth_sessions.sql`
- `0419_setup_master_data_uniqueness.sql`
- `0420_inventory_medicine_identity_guard.sql`

Repository-not-applied names:

- `0421_billing_refund_cash_holds.sql`
- `0421_lab_reagent_stock_in_idempotency.sql`
- `0422_diagnostic_performer_reserve_payout.sql`

Migration drift is inventory evidence only. It does not authorize applying, deleting, renaming, or replaying a production migration.

## Domain aggregates

These are legacy source values in their stored representation. They have not been converted to canonical integer minor units, and they must not be treated as canonical posted-money totals.

| Domain | Primary count | Primary total | Secondary total |
|---|---:|---:|---:|
| Billing | 1322 bills / 2101 lines | 10868611 | 7380030 |
| Payments | 1311 | 6965509 | 0 |
| Deposits | 90 | 2347301 | 0 |
| Credit/refund documents | 1 | 700 | 0 |
| Commission accruals | 1788 | 873858 | 516731 |
| IPD ledger | 35 | 15200 | 172700 |
| Stock | 4 balances / 4 movements | 300 | 300 |
| Cash | 1723 | 18410945 | 0 |
| Accounting | 4860 vouchers / 10482 lines | 32613030 | 32613030 |

## Reconciliation counters

- Bill-header versus active invoice-line mismatches: 79
- Bill due-cache mismatches under the legacy equation `MAX(0, total - paid)`: 22
- Unbalanced accounting vouchers: 0

A bill or due mismatch is evidence for investigation, not permission to rewrite the row. Legacy discounts, credits, deposits, cancellations, and route-specific semantics must be classified before backfill.

## Exception counts by code

- `BILL_DUE_MISMATCH`: 22
- `BILL_LINE_TOTAL_MISMATCH`: 79
- `DUPLICATE_SOURCE_REFERENCE`: 203
- `FOREIGN_KEY_VIOLATION`: 49
- `MIGRATION_APPLIED_NOT_IN_REPOSITORY`: 4
- `MIGRATION_REPOSITORY_NOT_APPLIED`: 3
- `MONEY_REAL_DECLARATION`: 31
- `SOURCE_CLONE_FK_DIFFERENCE`: 18
- `TENANT_REFERENCE_MISMATCH`: 30

The row-level exception registry is stored in `P01-exceptions.yaml` using stable IDs. No names, phone numbers, diagnoses, clinical notes, prescription text, or free-text row content are included.

## Handoff

- CDB-012 worker branch: `task/cdb-012-live-schema-baseline`
- Source and clone schema/row counts reconcile at `779 / 779` tables and `79,433 / 79,433` aggregate rows.
- The source remains authoritative for the 49 legacy FK violations and 717 declared FK rows.
- All 18 clone FK differences match documented import-compatibility waivers and remain non-authoritative for future canonical constraints.
- The 421 open exceptions require classification or explicit migration treatment; no row was silently repaired.
- Next planned task after integration: `CDB-020` — add canonical registries and schema modules.
- Worker verdict after fresh verification and commit: `READY FOR INTEGRATION`.

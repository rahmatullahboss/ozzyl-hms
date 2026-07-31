# Production Schema Drift Reconciliation Design

Date: 2026-07-25

## Goal

Reconcile the abandoned dirty-root migrations `0424` through `0432` with the current reviewed `main` and the live production D1 schema without applying a production migration, deploying a Worker, or reintroducing superseded financial behaviour.

## Confirmed State

The owner-facing root checkout is an old dirty branch and remains read-only. The reviewed implementation base is local `main` at `6a932aa97d41`.

A read-only production query against `hms-super-admin-production-apac` confirmed:

- `d1_migrations` contains 482 rows and the latest recorded ID is 484.
- No exact `0424` through `0432` migration name is recorded.
- Canonical migrations `0505` through `0515` are recorded.
- Production contains 65 tables whose names begin with `canonical_`.
- The old doctor-commission columns and tables from dirty-root migrations `0430` and `0431` exist in production despite those migration names being absent from `d1_migrations`.
- The old shift-closing and cash-ledger columns from `0424`, `0425`, `0426`, and `0428` are absent.
- `lab_test_catalog.is_commissionable` exists and is represented by reviewed migration `0520_lab_test_commission_eligibility.sql`.
- All inspection statements were read-only and reported `changed_db=false` and `rows_written=0`.

## Migration Disposition

Each abandoned dirty-root migration receives one explicit disposition:

| Dirty-root migration | Disposition | Current authority |
| --- | --- | --- |
| `0424_canonical_financial_reconciliation.sql` | abandoned, never integrate or apply | no reviewed equivalent; future shift-closing work requires a new design and migration |
| `0425_canonical_cash_ledger_event_identity.sql` | abandoned, never integrate or apply | no reviewed equivalent; future cash-ledger identity work requires a new design and migration |
| `0426_canonical_cash_ledger_business_date.sql` | abandoned, never integrate or apply | no reviewed equivalent; future business-date work requires a new design and migration |
| `0427_financial_event_outbox.sql` | superseded | `0505_canonical_program_foundation.sql` and `canonical_outbox_events` |
| `0428_shift_closing_canonical_evidence.sql` | abandoned, never integrate or apply | no reviewed equivalent; future evidence fields require a new design and migration |
| `0429_financial_provider_config_backfill.sql` | superseded | canonical feature flags, migration runs, reconciliation runs, backfill checkpoints, and current strict-financial policy |
| `0430_doctor_commission_ledger_hardening.sql` | production-only orphan schema; do not reintroduce | `canonical_source_key`, refund commission reservations, canonical compensation adjustments, and the reviewed paid-refund blocking policy |
| `0431_doctor_commission_settlement_accounting.sql` | production-only orphan schema; do not reintroduce | current settlement, refund-reservation, canonical compensation, and accounting flows |
| `0432_lab_test_commission_eligibility.sql` | superseded | `0520_lab_test_commission_eligibility.sql` |

## Doctor Commission Policy Decision

The dirty-root implementation supported clawbacks for already-paid commission. Later reviewed `main` explicitly changed the policy: a refund that would reduce payable commission below the amount already paid is blocked with a conflict instead of silently creating a negative balance or clawback.

Therefore this recovery must not port:

- `doctor_commission_adjustments` runtime usage;
- `doctor_commission_adjustment_applications` runtime usage;
- `clawback_deduction` settlement behaviour;
- the dirty-root `doctor-commission-ledger.ts` implementation;
- old `accrual_key`-based identity in place of current `canonical_source_key` identity.

The existing production-only columns and tables remain untouched until a separately authorised destructive production-cleanup programme can prove that no deployed code, report, backfill, or rollback path depends on them.

## Source-Control Contract

Create `docs/database/production-schema-drift-disposition.json` as the machine-readable source of truth for this incident. It records:

- the production database identity and read-only observation date;
- the exact old migration filenames;
- production ledger and schema observations;
- disposition (`abandoned`, `superseded`, or `production_only_orphan`);
- current reviewed replacements when applicable;
- the prohibition against applying or restoring the old SQL;
- the requirement for separate production authorisation before orphan cleanup.

Create a production evidence report at `docs/database/migration-runs/production/2026-07-25-doctor-commission-schema-drift-reconciliation.md`.

## Automated Guard

Add a repository test that fails when:

- any abandoned dirty-root migration filename appears in the reviewed migration directory;
- the disposition registry is incomplete or internally inconsistent;
- a superseded migration does not name an existing reviewed replacement;
- production-only orphan objects are represented as current runtime authority;
- the current paid-commission refund blocking behaviour is removed;
- the current replacement migrations for canonical foundation, refund commission reservations, and lab commission eligibility disappear.

The guard tests repository contracts only. It must not connect to production or require credentials.

## Safety Boundaries

- No production migration application.
- No production D1 mutation.
- No Worker deployment, upload, traffic change, or feature-flag change.
- No deletion, reset, stash, cleanup, or overwrite of the dirty root.
- No copying of the dirty-root `finance.ts` or route files over current `main`.
- No claim that orphan production objects are safe to drop without a separately authorised dependency audit.

## Verification

The recovery is complete locally when:

1. the disposition contract test demonstrates RED before the registry exists;
2. the registry, report, and test pass;
3. existing schema-governance and refund-commission tests pass;
4. migration manifest generation passes;
5. TypeScript passes;
6. the branch diff contains only the approved governance, evidence, and test files;
7. the verified branch is integrated into clean local `main` without push or deployment.

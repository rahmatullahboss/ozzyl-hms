# P01 Production Migration Reconciliation — 0421/0422

**Executed:** 2026-07-13

**Database:** `hms-super-admin-production-apac`

**Database UUID:** `c68a5360-a2c1-44cc-9e71-f21057bea102`

**Authorization:** Explicit owner instruction in the active session to apply the outstanding production migrations.

## Result

The production D1 migration ledger is reconciled. Standard repository migration listing now reports no pending migrations. No Worker/application deployment was performed.

Applied ledger entries:

| ID | Migration | Result |
|---:|---|---|
| 445 | `0421_billing_refund_cash_holds.sql` | applied/reconciled |
| 446 | `0421_lab_reagent_stock_in_idempotency.sql` | applied; unique index created |
| 447 | `0422_diagnostic_performer_reserve_payout.sql` | applied/reconciled |

## Why a reconciliation pack was required

The repository ledger listed all three files as unapplied, but live schema inspection showed that the billing-refund and performer-reserve schema had already been created outside the Wrangler migration ledger.

- `billing_refund_cash_holds`, its indexes, and its validation trigger already existed.
- `diagnostic_performer_payout_rules` and `diagnostic_performer_reserves` already existed.
- The seven `ALTER TABLE` columns from `0422` already existed on the commission tables.
- The expected performer-reserve indexes already existed.
- `idx_inv_stock_tx_lab_idempotency` did not exist and had zero conflicting duplicate groups.

Applying the original `0422` file to an exact local production snapshot failed with duplicate-column errors. Applying the original trigger-containing `0421_billing_refund_cash_holds.sql` through Wrangler against the rehearsal clone failed with `incomplete input`, while SQLite itself accepted the file.

A protected one-time reconciliation pack was therefore used. It preserved the repository migration filenames so Wrangler could record them, validated the already-existing tables and columns, recreated expected indexes idempotently, and used the original lab idempotency-index migration. The repository migration files were not edited.

Protected operational artifacts:

`/Users/rahmatullahzisan/.hms-canonical-rehearsals/20260713-production-migration-reconcile-0421-0422`

Data-bearing exports and SQLite files remain outside Git.

## Safety gates

1. Original files rehearsed against a copy of the production snapshot.
2. All intended `0421`/`0422` live tables, columns, indexes, and the billing trigger were verified read-only.
3. Lab idempotency duplicate groups: `0`; duplicate rows: `0`.
4. Reconciliation pack applied successfully to `hms-canonical-rehearsal-20260713-b6036e`.
5. Rehearsal clone reported no remaining migrations.
6. Fresh production Time Travel bookmark recorded immediately before apply.
7. Fresh production SQL export retained in the protected directory.
8. Production migration lock acquired before mutation and released after verification.

## Rollback evidence

Pre-apply Time Travel bookmark:

`00001c44-00000064-000050a7-8d77e740a34afd9efc97ba1ce8f2e3ed`

Post-apply Time Travel bookmark:

`00001c44-00000092-000050a7-a88dfda6a712ec5dc1d351a1fb93cb49`

A restore was not required. Restoring production remains a destructive owner-approved incident action only.

## Verification

- Repository config: `No migrations to apply`.
- Ledger rows `445`–`447` contain the three expected filenames.
- `idx_inv_stock_tx_lab_idempotency` exists exactly once.
- Pre/post target row counts were unchanged:
  - `billing_refund_cash_holds`: `0 → 0`
  - `diagnostic_performer_payout_rules`: `10 → 10`
  - `diagnostic_performer_reserves`: `14 → 14`
- Existing source FK exception count remained `49`.
- No business table was created by the reconciliation pack.
- Cloudflare internal table `_cf_KV` materialized during the operation window and is not a canonical/business table.
- No Worker deployment, Git push, `main` merge, local-server activation, or Time Travel restore occurred.

## Follow-up

The three historical `MIGRATION_REPOSITORY_NOT_APPLIED` baseline exceptions are resolved by this run. The four inverse exceptions—production-applied migrations whose same-named files are absent from this branch—remain repository-history reconciliation items and are not blockers for the completed production ledger update.

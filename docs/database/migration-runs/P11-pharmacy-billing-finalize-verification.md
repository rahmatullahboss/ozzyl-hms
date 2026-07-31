# P11 Pharmacy Billing Finalize Verification

**Checkpoint:** CDB-114

**Verified:** 2026-07-24T19:53:43+06:00

**Task branch:** `fix/canonical-pharmacy-billing-finalize-20260724`

**Integrated branch:** local `main`

**Task base:** local `main` at `c376b108a8d7de7e865baff246e6433a75fefcfd`

**Current-main integration base:** `de00b6cff06b6d354b3809312fe6c5fc515eff0d`

**Boundary:** `pharmacy.billing.finalize`

## Result

The boundary is implemented and locally verified as `integrated`.

Both finalization routes in `src/routes/tenant/pharmacy/advanced.ts` now execute through `executeStrictFinancialMutation()`:

- provisional invoice conversion;
- prescription dispense with invoice creation.

Disabled and shadow modes preserve the original stock-first legacy workflows and manual compensation behavior. Strict mode atomically commits guarded pharmacy invoice, invoice-item, stock-transaction, stock-cache, optional deposit, source-status and canonical service, settlement and inventory authority through `settlePharmacySale()`.

## Checkpoint commits

- `448b54a95` — design and implementation plan
- `14668e2d3` — shared pharmacy sale contracts
- `da1c63ef6` — composite canonical pharmacy sale command
- `3a03039d7` — provisional conversion legacy/strict adapter and authority hydration
- `e44ca7872` — prescription dispense legacy/strict adapter
- `48953d409` — route integration and executable legacy/shadow/strict coverage
- `41995490a` — financial route coverage registration
- `1f0f0857a` — strict stock-item identity race guard

## Legacy and shadow isolation

### Provisional conversion

`executePharmacyProvisionalOriginalLegacy()` preserves the historical sequence:

1. load the active provisional invoice;
2. claim `active → converting`;
3. load provisional items and validate each selected stock row;
4. validate payment, tender and optional deposit balance;
5. decrement stock first;
6. allocate the pharmacy invoice number;
7. insert the invoice;
8. insert invoice items and stock transactions;
9. insert an optional guarded deposit adjustment;
10. mark the provisional invoice converted.

On failure it restores deducted stock, removes any deposit adjustment, restores provisional status and deletes the created invoice exactly as the original route did.

### Prescription dispense

`executePharmacyPrescriptionOriginalLegacy()` preserves:

1. prescription status validation;
2. prescription item loading;
3. explicit stock selection or historical FEFO fallback;
4. payment, tender and optional deposit validation;
5. stock-first mutation;
6. invoice allocation and insertion;
7. invoice items and stock transactions;
8. optional deposit adjustment;
9. prescription status update to `dispensed`;
10. stock/deposit/invoice compensation on failure.

Neither original executor contains canonical schema dependencies, financial assertion statements, `changes()` assertions or strict-only validation. Shadow mode commits the original executor first. Canonical projection failure records `CANONICAL_SHADOW_WRITE_FAILED` and leaves the successful legacy response unchanged.

## Strict preflight and authority

Strict preparation runs lazily only after strict policy selection and before invoice-number allocation. It requires:

- eligible tenant-owned source document and source items;
- positive safe-integer quantities;
- exact payment split and exact major/minor-unit conversion;
- cash tender sufficiency;
- external transaction authority for paid non-cash strict settlements;
- active, unexpired and sufficient pharmacy stock;
- exact stock-to-item identity;
- legacy deposit sufficiency when used;
- active canonical item, service, lot, `PHARMACY-RICH` location, conversion, policy and balance authority;
- canonical/legacy stock-balance parity;
- canonical deposit sufficiency when used.

Invoice sequence allocation happens only after those checks pass.

The strict authoritative statements revalidate source status, exact stock quantity, stock item identity, invoice uniqueness, invoice-item and stock-transaction insertion, optional current deposit balance and final source status. Every critical row is followed by a one-row financial assertion and assertion cleanup.

The adversarial review found and fixed one High-risk race before completion: stock updates initially revalidated quantity and stock ID but not `pharmacy_stock.item_id`. Both strict adapters now include the item predicate, and SQLite tests prove a post-preflight item remap rolls back the entire batch.

## Canonical command

`settlePharmacySale()` commits deterministic canonical authority for each pharmacy sale:

- fulfilled pharmacy service request and posted dispense event per sold line;
- canonical invoice with service lines and an optional global discount line;
- canonical cash/card/mobile/other receipt, tender and allocation when paid;
- canonical deposit applications when deposits are used;
- linked canonical inventory sale movements and balance/version updates;
- actual legacy invoice-item and stock-transaction source mappings;
- command and domain outbox events;
- idempotent replay and conflicting-evidence rejection.

The guarded legacy statements are supplied as authoritative statements in strict mode, so legacy and canonical facts share one D1 batch. Duplicate lines against the same stock/lot chain balance and version updates serially.

## Route and response behavior

The route handlers no longer contain finalization invoice, stock or deposit mutation SQL. They only prepare inputs, invoke the coordinator, run canonical projection and reload the committed invoice identity.

Legacy/shadow responses retain the historical `201` contracts. A committed legacy invoice ID is retained as a compatibility fallback for non-persistent route test doubles; strict mode still requires the committed row reload because no legacy fallback exists.

Strict conflicts are returned as `409` without exposing internal schema or SQL details.

The request schemas now accept optional `externalTransactionId`; legacy behavior ignores it, while strict paid non-cash settlement requires it.

`FINANCIAL_ROUTE_COVERAGE['pharmacy.billing.finalize']` now records:

```text
status: integrated
canonicalCommand: settlePharmacySale
```

## Governance disposition

`docs/database/legacy-table-disposition.yaml` currently governs the registered legacy financial tables `bills`, `invoice_items`, `payments`, `doctor_commission_accruals` and `InventoryStockTransaction`. The pharmacy operational tables are not registered there, and no pharmacy route allowance existed to move.

Registering the pharmacy operational tables only for this checkpoint would have required allowlisting every unrelated pharmacy writer and expanded the task beyond the reviewed finalization boundary. Therefore no artificial registry expansion was made. Exact compatibility ownership is enforced by route source contracts and the cross-route shadow-isolation test, while schema governance remains at zero issues.

The older `src/lib/pharmacy-canonical.ts` service remains unchanged. It is an existing operational pharmacy invoice/stock service over legacy pharmacy tables; it does not write the new canonical service, invoice, payment, deposit or inventory authority introduced by this checkpoint.

## Adversarial review

Validated before the final gate:

1. Disabled and shadow modes do not evaluate strict preparation.
2. Both original stock-first workflows remain executable.
3. Shadow canonical mapping failure preserves both `201` responses and records a processing issue.
4. Strict missing mapping fails before invoice sequence, stock decrement or invoice insertion.
5. Fractional quantities fail before sequence allocation.
6. Explicit selection and FEFO behavior remain preserved.
7. Duplicate stock lines chain legacy and canonical balances correctly.
8. Stock quantity races roll back all strict facts.
9. Source-status races roll back all strict facts.
10. Post-preflight stock item remaps roll back all strict facts.
11. Deposit adjustments and canonical applications share the strict transaction.
12. Actual committed invoice-item and stock-transaction identities are mapped.
13. Replay is deterministic and conflicting evidence is rejected.
14. No finalization mutation SQL remains in either route block.
15. No unresolved Critical or High finding remained.

## Fresh verification

### Focused CDB-114 gate

- Task-branch focused gate: 9 test files, 57 tests passed
- Current-main focused gate: 10 test files, 63 tests passed

Coverage includes shared contracts, authority hydration, composite command, both adapters, executable route legacy/shadow/strict policy, historical route regression, cross-route shadow isolation and financial route coverage.

### Full canonical gate

- 134 test files passed
- 932 tests passed

### Other gates

- TypeScript: passed
- Canonical schema governance: 0 issues
- Task-branch generated migration manifest: 467 migrations
- Current-main generated migration manifest: 468 migrations
- Web production build: passed
- Patient production build: passed
- Admin production build: passed
- Task worktree policy: passed
- Current-main integration worktree policy: passed
- `git diff --check`: passed

## Current-main integration

Local `main` advanced from the task base to `de00b6cff06b6d354b3809312fe6c5fc515eff0d` with unrelated payment-void work. The reviewed CDB-114 commits were replayed serially into the dedicated clean main worktree at `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-governance-integration-20260723` without conflict.

Current-main replay commits:

- `792c61264` — design and plan
- `12be91dab` — shared contracts
- `3f4e24908` — composite command
- `f961e82ea` — provisional adapter
- `4a2f78e9c` — prescription adapter
- `df8ca26cb` — route integration
- `c8a565b99` — coverage registration
- `a37881ed7` — stock item identity guard
- `aecd415ab` — checkpoint documentation

Fresh current-main verification passed after replay: 10 focused files/63 tests, 134 canonical files/932 tests, TypeScript, zero-issue governance, 468 generated migrations, integration worktree policy, diff check and all three production builds.

## Remaining work

The next financial writer boundary is `radiology.billing.create`. Other registered fail-closed runtime writers remain:

- `reception.visit-billing.create`
- `settlement.finalize`

This checkpoint does not claim production strict readiness.

## Production safety statement

No remote push, deployment, production migration, production backfill, feature-flag change, traffic change, tenant-data mutation, production observation, rollback or legacy retirement occurred. All implementation and verification were local to the isolated task worktree.

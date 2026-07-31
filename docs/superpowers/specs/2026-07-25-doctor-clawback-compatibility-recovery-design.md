# Doctor Clawback Compatibility Recovery Design

**Date:** 2026-07-25  
**Status:** Approved for local implementation  
**Production mutation:** Not authorised

## Problem

Production Tenant `102` (Patient Care Hospital) contains 40 outstanding `doctor_commission_adjustments` clawback rows totalling BDT 1,900. The rows were created by reviewed production corrections on 2026-07-20 and 2026-07-23. They are not mapped to canonical compensation and have no application rows.

The historical canonical-finance branch consumed these obligations from subsequent doctor payouts. Current `main` no longer reads the compatibility ledger. On 2026-07-24, three affected doctors received BDT 2,900 in settlements with zero clawback deduction. Current eligible payables for the four affected doctors are materially greater than the outstanding recovery balance.

This is a live compatibility regression, not dead-schema cleanup.

## Authority

Tenant `102` remains in canonical financial `shadow` mode. Legacy doctor commission tables remain authoritative; canonical compensation is a shadow projection. Canonical programme task `CDB-105` and modular-monolith tasks `MM-070` through `MM-093` have not authorised financial compatibility retirement.

Therefore:

- existing compatibility recovery obligations must remain authoritative;
- no new historical clawback-generation workflow is restored;
- no existing table or column is dropped;
- destructive cleanup remains deferred until canonical cutover and formal retirement evidence exist.

## Scope

### Included

1. Formally support the existing adjustment/application ledger shape through a current numbered migration and Drizzle declarations.
2. Add a focused recovery allocator that reads existing outstanding clawbacks and prepares atomic FIFO application statements.
3. Apply recovery deductions in all active doctor payout paths:
   - reception doctor payout;
   - single doctor-accrual payment;
   - bulk doctor commission settlement.
4. Persist exact adjustment-to-settlement application rows.
5. Post accounting using gross payable, recovery deduction, and net cash separately.
6. Let canonical shadow settlement represent the same gross-to-net deduction as `manual_recovery / settlement_deduction`.
7. Expose deduction totals in payout responses and settlement detail without changing unrelated UI workflows.

### Excluded

- creating new credit-note clawbacks;
- restoring the abandoned `accrual_key` identity;
- restoring the whole `program/canonical-finance-continuous-execution-20260721` branch;
- importing the 40 historical obligations into canonical compensation during this task;
- production deployment, migration application, feature-flag changes, data repair, or deletion;
- final legacy retirement.

## Data Model

The compatibility source of truth is:

- `doctor_commission_adjustments`: immutable recovery obligation facts;
- `doctor_commission_adjustment_applications`: exact settlement applications.

Outstanding amount is calculated as:

`adjustment.amount - SUM(application.amount)`

The `status` column is a projection:

- `outstanding` while remaining amount is positive;
- `applied` when fully consumed.

The application table, not a settlement summary column, is the authoritative recovery evidence. Existing settlement fields already preserve gross and net values. This avoids depending on the unledgered `doctor_commission_settlements.clawback_deduction` column.

## Recovery Allocation

For one tenant, doctor, and settlement:

1. Read clawback rows ordered by `created_at`, then `id`.
2. Calculate remaining amount after existing applications.
3. Allocate up to `maxDeduction`, preserving at least BDT 0.01 positive cash payout.
4. Prepare conditional application inserts that re-check remaining amount inside the write batch.
5. Update adjustment status from committed application totals.
6. Add a fail-closed transition guard proving the expected application count and total were committed.

The allocator must be deterministic, tenant-scoped, replay-safe, and safe against stale pre-read results.

## Payout Semantics

For each payout:

- `grossCommissionAmount` is the selected payable after approved per-line overrides;
- existing advance/other/rounding adjustments are applied first;
- `clawbackDeduction` is allocated from the remaining positive amount;
- `netPaidAmount = gross - advance - clawback + other + rounding`;
- net paid must remain positive.

The settlement and accrual transition, clawback applications, cash movement, idempotency transition, and canonical shadow statements must share the same authoritative D1 batch where the current route already supports it.

Legacy commission-management routes must be upgraded to a guarded D1 batch rather than adding more sequential partial-write risk.

## Accounting

Commission settlement posting must support an extended payload while preserving existing callers:

- debit `doctor_commission_payable` for gross commission cleared;
- credit the payment asset for net cash/bank paid;
- credit `doctor_advance_receivable` for the clawback recovered;
- preserve existing advance, other-adjustment, and rounding treatment;
- reject unbalanced payloads.

The accounting event payload records gross, clawback deduction, net paid, doctor, accrual IDs, and settlement identity.

## Canonical Shadow

`executeLiveCompensationSettlement` already calculates `deductionMinor = grossMinor - netPaidMinor` and writes canonical `manual_recovery / settlement_deduction` adjustments. The payout route must pass the recovery-adjusted net amount while preserving gross selected accrual reconciliation.

This task does not claim canonical authority for the 40 historical obligations. It only keeps the live shadow projection financially equal to the authoritative legacy settlement.

## Error Handling

- Missing compatibility tables are prevented by the formalising migration.
- No outstanding clawback returns zero statements and zero deduction.
- A stale/concurrent allocation fails the whole authoritative batch through the transition guard.
- A recovery that would reduce net paid to zero is capped to leave BDT 0.01.
- Accounting imbalance fails before voucher posting.
- Canonical shadow failure follows existing shadow-mode behaviour; strict mode remains fail-closed.

## Testing

Required coverage:

1. Pure FIFO allocation, partial allocation, no-op, and one-paisa floor.
2. Prepared SQL applies exact rows and rejects stale over-application.
3. Reception payout persists applications, reduces cash, posts balanced accounting, and passes canonical gross/net values.
4. Single and bulk commission-management payouts consume recovery obligations atomically.
5. Accounting builder handles gross, clawback, net, and backward-compatible simple settlements.
6. Migration/schema governance proves the current compatibility tables exist without restoring abandoned columns or old runtime code.
7. Existing payout, canonical compensation, accounting, refund, and migration governance regressions pass.

## Retirement Gate

These objects may be retired only after all of the following are true:

- every outstanding obligation is applied, migrated, or formally waived;
- canonical compensation contains approved equivalent evidence;
- Tenant `102` is no longer legacy-authoritative for compensation;
- `CDB-105`, `CDB-120`, `MM-074`, `MM-090`, and `MM-093` gates are satisfied;
- production dependency observation proves zero reads and writes;
- protected backup, clone rehearsal, rollback, and owner destructive-retirement authorisation exist.

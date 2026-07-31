# Phase 1 P0 Accounting Recovery Fix Plan

Date: 2026-06-15
Branch: `fix/phase-1-accounting-recovery`
Base: `main`

## Current status

Initial recovery helpers and tests have been added in this branch.

Implemented so far:

- `src/lib/accounting-recovery.ts`
- `test/unit/accounting-recovery.test.ts`
- production unit test script now includes `test/unit/accounting-recovery.test.ts`

## Implemented recovery helpers

### 1. Partial voucher detection

`findPartialAccountingVouchers` detects accounting vouchers that are risky because they have:

- less than two journal lines
- unbalanced debit/credit totals
- missing or non-posted posting event status

This does not mutate data; it is safe to run as a diagnostic.

### 2. Missing bill accounting event repair

`repairBillsMissingAccountingEvents` finds bills that have no `billing:<billId>:bill_created` posting event and inserts the missing posting event using `INSERT OR IGNORE`.

This is designed to be idempotent.

### 3. Failed event dead-letter handling

`markAccountingEventsDeadLetter` moves repeatedly failed accounting posting events to `dead_letter` when `COALESCE(attempts, 0) >= maxAttempts`.

## Remaining work before production

The recovery helpers reduce risk but do not fully replace a transaction-safe posting flow.

Before production, one of these must happen:

1. Wire the helpers into an admin/maintenance route, scheduled job, or manual ops command, or
2. Refactor `postAccountingEventBySourceKey` itself to post vouchers, journal lines, sub-ledgers, and event status in a fully recoverable state machine.

## Original P0 target fixes

### P0-1: Accounting voucher posting must become atomic or recoverable

Current risk:

- `postAccountingEventBySourceKey` inserts voucher first.
- Journal lines are inserted after that.
- Sub-ledger transactions are inserted after that.
- Posting event is marked posted at the end.

If execution fails in the middle, accounting can contain a partial voucher.

This PR addresses recoverability by adding partial voucher detection.

### P0-2: Bill finalization side effects need recovery

Current risk:

- IPD discharge bill can be created operationally.
- Accounting side-effect recording happens afterward.
- If side-effect recording fails, bill remains but accounting event/commission can be missing.

This PR addresses accounting-event recovery by adding missing bill-created event repair.

## Test commands

```bash
pnpm test:production:unit
pnpm build:migrations
pnpm test
pnpm build
```

## Merge rule

Do not merge until the reviewer accepts that this is a recovery-layer fix, not a full atomic posting refactor.

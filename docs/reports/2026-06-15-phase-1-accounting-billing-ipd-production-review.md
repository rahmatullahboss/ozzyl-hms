# Phase 1 Production Readiness Review — Accounting + Billing + IPD

Date: 2026-06-15
Branch reviewed: `fix/ipd-accounting-hardening`

## Scope reviewed

Primary files reviewed in this phase:

- `src/lib/accounting-posting.ts`
- `src/lib/billing-finalization.ts`
- `src/routes/tenant/ipBilling.ts`
- `src/routes/tenant/deposits.ts`
- `test/accounting-invariants.test.ts`
- `test/unit/ipd-accounting-hardening.test.ts`
- `migrations/0299_ipd_accounting_hardening.sql`

This review focuses on production risks around:

- voucher posting
- journal lines
- patient receivable
- deposit liability
- IPD discharge billing
- manual IPD/provisional charges
- accounting events and retry behavior
- ledger/reporting consistency

## Current go/no-go verdict for Phase 1

**Verdict: NOT READY for direct production yet.**

The system is moving in the right direction and has several strong controls, but Phase 1 still has production blockers around atomic accounting posting and recovery behavior.

Recommended state: **staging/pilot candidate after fixes**, not full production.

## Positive controls already present

### 1. Journal builders validate double-entry balance

`validateJournalLines` rejects:

- vouchers with fewer than two lines
- missing account IDs
- zero-sided journal lines
- double-sided journal lines
- unbalanced debit/credit totals

This is a strong application-level guard.

### 2. Bill-created accounting supports doctor payable and discount handling

`buildBillCreatedLines` posts:

- accounts receivable debit
- discount allowed debit
- doctor payable credit
- category revenue credits
- fallback other revenue where needed

This is a solid foundation for OPD/IPD billing accounting.

### 3. IPD discharge bill uses a main D1 batch

The discharge bill main write path inserts/updates the bill, invoice items, provisional item status, bed billing, deposit adjustment, payment, cash transactions, admission status, and bed state through a batch.

This reduces partial operational writes compared with sequential independent writes.

### 4. Deposit collection has request idempotency and batch writes

Deposit collection uses an idempotency key flow, active counter session guard, period lock check, patient tenant validation, and a batch that writes deposit, cash transaction, posting event, and audit log.

### 5. New hardening migration improves DB boundary controls

Migration `0299_ipd_accounting_hardening.sql` adds:

- source-event unique guards
- voucher-number uniqueness guard
- voucher-numbering uniqueness guard
- manual IPD charge completeness triggers
- journal-line debit/credit triggers

## Production blockers / high-risk findings

### P0-1: Accounting voucher posting is not atomic

In `postAccountingEventBySourceKey`, the flow is still sequential:

1. generate voucher number
2. insert voucher
3. insert journal lines one by one
4. insert sub-ledger transactions one by one
5. mark posting event as posted

If the worker crashes or D1 fails after the voucher insert but before all lines/sub-ledgers/status update, the database can contain a partial accounting voucher.

Risk:

- voucher exists without all journal lines
- event remains pending/failed while voucher exists
- accounting reports and audit chain become inconsistent
- retries may need manual repair if unique constraints stop duplicate voucher creation

Required fix before production:

- implement an atomic posting strategy, or
- add a recovery/reconciliation job that detects and repairs partial vouchers before marking production-ready.

Suggested approach:

- use D1 batch/transaction-like pattern where possible
- or split into durable outbox states: `posting_started`, `voucher_created`, `lines_created`, `subledger_created`, `posted`
- add invariant checks for orphan/partial vouchers and a repair command

### P0-2: Discharge bill can be created before accounting side effects are fully recorded

The discharge bill main batch creates the operational bill first. After that, `recordBillFinalizationSideEffects` is called, which accrues commissions and records accounting posting events.

If that side-effect step fails after the bill is created, the bill can exist without accounting event/commission side effects.

Risk:

- bill exists but accounting event missing
- revenue not posted
- commission not accrued
- invariant job must catch this later

Required fix before production:

- make bill finalization side effects recoverable and idempotent
- add a periodic repair job for finalized bills without accounting posting events
- add test coverage for side-effect failure after bill creation

### P1-1: IPD ledger entry failures are non-blocking

The IPD ledger writes are treated as supplementary and errors are swallowed/logged. This happens both when provisional charges are added and when discharge ledger entries are created.

Risk:

- bills/payments/deposits exist but IPD ledger is incomplete
- admission-wise running balance becomes wrong
- front-desk/admin reconciliation becomes unreliable

Recommended fix:

- either make IPD ledger mandatory for IPD billing flows
- or add a deterministic ledger rebuild endpoint/job from source tables
- add invariant check comparing IPD ledger totals vs bill/payment/deposit source totals

### P1-2: Failed accounting events can retry indefinitely

`postPendingAccountingEvents` selects both `pending` and `failed` events and retries them without an obvious max-attempt filter.

Risk:

- permanently invalid event repeatedly fails
- noisy logs
- wasted background execution
- hard-to-debug accounting queue

Recommended fix:

- add max attempts threshold
- add `dead_letter` status after repeated failure
- add admin view for failed/dead-letter accounting events

### P1-3: Period-closed failure increments attempts without COALESCE

The period-closed branch uses `attempts = attempts + 1`. If `attempts` is NULL, this may stay NULL depending on SQLite behavior.

Recommended fix:

- use `attempts = COALESCE(attempts, 0) + 1`

### P1-4: Manual charge categories are still hard-coded in migration trigger

The trigger is acceptable as a short-term DB guard, but it is not ideal for long-term production configuration.

Recommended fix:

- create a `manual_charge_categories` or `billing_charge_categories` table
- map each category to accounting revenue head
- expose admin settings UI
- migrate trigger to reference stable category codes if supported, or enforce via app + invariant check

## Recommended must-fix list before production

1. Atomic or recoverable accounting posting
2. Bill finalization side-effect repair job
3. IPD ledger rebuild/reconciliation job
4. Accounting failed-event dead-letter handling
5. Period-closed attempts COALESCE fix
6. Staging test run with real discharge/deposit/payment workflows

## Recommended tests to add next

### Unit tests

- period-closed attempt increments from NULL to 1
- failed accounting event stops retrying after max attempts
- bill-created payload with manual doctor/professional fee maps to correct revenue/payable

### Integration tests

- discharge bill succeeds and creates bill + invoice items + accounting posting event + IPD ledger entries
- simulated side-effect failure after bill creation is detected by invariant/repair job
- simulated voucher line insert failure is detected as partial voucher
- deposit refund race condition does not create negative balance
- finalized provisional charges do not double-count in IPD ledger

### E2E/staging workflows

- IPD admission → provisional charge → deposit → discharge bill → ledger → accounting voucher
- high discount → required referral/approval name
- refund excess deposit at discharge
- cancel/reversal flow

## Phase 1 status

Phase 1 is not finished until the P0 blockers are fixed or intentionally accepted with recovery tooling.

Current readiness after Phase 1 review:

- Code direction: strong
- Accounting safety: medium-high but not production-complete
- IPD ledger safety: medium
- Required before production: P0 fixes + test run

Recommended next step:

**Fix P0-1 and P0-2 first**, then continue Phase 2: Auth + RBAC + Tenant isolation.

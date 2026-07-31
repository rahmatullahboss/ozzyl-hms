# CDB-V1-030J cash custody writer integration audit

**Date:** 2026-07-29
**Checkpoint:** `CDB-V1-030J-CASH-CUSTODY-WRITER-INTEGRATION-VERIFIED`
**Branch:** `program/cdb-main-continuous-20260725`
**Scope:** local protected-core implementation and repository evidence only

## Result

The five remaining cash-custody implementation-group writer pairs now cross reviewed Canonical command or guarded atomic compatibility boundaries:

- stale billing-counter session lifecycle and workstation heartbeat workflow updates;
- appointment payment employee-cash compatibility projection;
- reviewed non-cash gateway employee-cash compatibility projection;
- cash-ledger projection with explicit Canonical accounting and custody bridge; and
- payment-void employee-cash compatibility projection.

No workflow or projection row was promoted as a second physical-cash authority. Physical cash remains owned by `canonical_cash_custody_balances` and immutable `canonical_cash_custody_movements` materialised from reviewed Canonical custody events.

## Counter-session workflow

`billing_counter_sessions` remains a workflow document, as frozen by the authority contract. It is not a counted-cash or custody-balance fact.

`autoCloseStaleCounterSessions` remains a guarded operational cleanup:

- tenant-scoped active sessions only;
- pending variance approval is excluded;
- a held refund reserve blocks automatic close;
- no cash amount, counted amount, variance or custody movement is invented; and
- the existing compatibility status, actor and remarks behavior is preserved.

Workstation binding and heartbeat updates remain workflow ownership/projection changes. They do not alter the Canonical custody balance or create a cash movement. Tests prove that an old workstation heartbeat can be rebound without closing the active session and that an unresolved held refund prevents stale-session closure.

## Appointment payment compatibility

`src/lib/canonical/appointment-billing-finalization.ts` retains the legacy `emp_cash_transactions` row for HTTP/report compatibility. In strict mode the guarded bill, items, payment, employee-cash projection, appointment transition, accounting events and accepted consultation-service evidence are included in the parent `appointment.billing.finalize` transaction.

For a paid appointment, `src/routes/tenant/appointments.ts` invokes `issueInvoiceWithFullPayment`. That command is the cash-fact boundary:

- a cash tender emits `canonical.cash_custody.collection_recorded` with exact receipt, counter and counter-session identity;
- a non-cash tender creates no custody movement; and
- the caller-owned compatibility projection and Canonical invoice/payment/custody facts commit atomically or roll back together.

The employee-cash row therefore remains a temporary duplicate compatibility projection, not the money authority.

## Gateway payment compatibility

`src/lib/canonical/gateway-payment-verification.ts` now explicitly restricts this adapter to reviewed non-cash providers (`bkash` and `nagad`). The legacy `CashSales` employee-cash row is retained only as a compatibility projection.

The parent `payment-gateway.verify` boundary commits guarded payment, deposit, income, employee-cash, gateway-log and accounting-event statements with `canonical.gateway-payment.settle`. Because the verified gateways are non-cash, no physical cash-custody event is created. Stale bill or gateway state rolls back every strict write.

This prevents a mobile-wallet or gateway receipt from falsely increasing a physical cash drawer.

## Cash-ledger projection bridge

`src/lib/cash-ledger-writer.ts` keeps `cash_ledger_entries` as a rebuildable projection. When a caller supplies `canonicalBridge`, one D1 batch contains:

- the compatibility cash-ledger projection row;
- the typed Canonical accounting outbox event;
- the prepared `canonical.cash_custody.movement.record` command envelope;
- exact source mapping from `legacy_cash_ledger_entry`; and
- the custody outbox event used by the accounting poster to materialise the immutable balance/movement authority.

The bridge stores integer minor-unit evidence and excludes free-text patient/location/note metadata from Canonical payloads. Exact idempotency prevents duplicate projection and custody facts.

A new SQLite rollback contract proves that a custody outbox identity conflict rolls back the cash-ledger projection, accounting event and source mapping together. No partial compatibility row remains.

`shadowCreateCashLedgerEntry` remains non-blocking for callers that explicitly request shadow projection behavior; failures are recorded as shadow issues without claiming authority.

## Payment void compatibility

`src/lib/payment-void-execution.ts` retains the legacy `SalesReturn` employee-cash row inside the parent `payment.reverse` strict transaction.

`reversePayment` owns the Canonical reversal:

- exact receipt, tender and allocation lineage is required;
- a cash tender emits `canonical.cash_custody.refund_recorded` against the original counter/counter session;
- non-cash tenders do not create physical cash movements;
- linked paid practitioner compensation remains reversal-blocked; and
- payment, invoice, income, employee-cash compatibility, Canonical reversal, mapping and outbox either commit together or fully roll back.

## Governance boundaries

Fail-closed writer integrations:

- `cash-custody.counter-session-workflow`;
- `cash-custody.appointment-payment-compatibility`;
- `cash-custody.gateway-noncash-compatibility`;
- `cash-custody.cash-ledger-command-bridge`; and
- `cash-custody.payment-void-compatibility`.

Each integration requires runtime tokens, parent command evidence and executable tests. The classifier distinguishes workflow documents and projection caches from physical cash authority rather than treating every table associated with cash as a Canonical cash fact.

Cash-custody provider activation and legacy retirement remain blocked pending full writer/read cutover, exact tenant reconciliation, production observation, rollback evidence and separate owner authorization.

## Deterministic state

After regeneration:

- governed tables: 260;
- repository writers: 1,017;
- repository readers: 2,620;
- identity/episode readers: 831 across 290 paths and 63 tables;
- protected surfaces: 918;
- protected routes: 44;
- protected UI flows: 28;
- protected writers: 226;
- protected readers: 497;
- protected tables: 83;
- Canonical-command writers: 112;
- atomic-compatibility writers: 78;
- governed-external writers: 3;
- command-required writers: 29;
- isolated fixtures: 4;
- remaining implementation groups: 7;
- existing command boundaries: 18;
- contract-only command boundaries: 2;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

## Verification

Fresh local verification:

- cash-custody writer focused suite: 12 files, 91 tests, 0 failures;
- migration/schema/worktree governance suite: 3 files, 19 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 502 conforming migrations;
- full `pnpm canonical:check`: passed;
- schema governance: passed;
- authority governance: passed;
- access governance: 260 governed tables, 1,017 writers and 2,620 readers, zero issues;
- protected writer coverage: 226 writers, 29 command-required, zero unclassified.

Node SQLite experimental warnings are expected test-runner output and are not test failures.

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

`CDB-V1-030K-CREDIT-REFUND-PAYMENT-REVERSAL-INTEGRATION`

Complete the five remaining credit/refund/payment-reversal writer pairs across refund cash-hold/dispute, gateway payment verification, executed refund and payment void execution. Reuse the existing credit-note, cash-refund, cash-refund-reversal and payment-reversal commands. Preserve approval, dispute, income and compatibility response behavior. Require exact invoice, credit-note, refund, receipt, tender, allocation, custody and practitioner-compensation lineage with integer minor-unit reconciliation. Commit compatibility, audit, source mapping, idempotency and outbox atomically; prove exact replay, changed replay conflict, stale/concurrent rejection, cash-return versus dispute exclusivity, tenant isolation and complete rollback; then regenerate governance artifacts.

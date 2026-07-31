# Canonical Payment Gateway Verification Design

**Date:** 2026-07-24
**Base:** local `main` at `8e2429e6bc156a3f4fd63168251cbca1155b6f8d`
**Boundary:** `payment-gateway.verify`
**Status:** Approved by the user's direct instruction to continue the remaining CDB work from the latest verified local `main`.

## Problem

The payment gateway verification route currently performs three separate phases:

1. Claims a pending gateway log by changing it to `verifying`.
2. Calls the external gateway and confirms the captured amount.
3. Writes legacy payment, bill balance, income, optional overpayment deposit, employee cash transaction, gateway success status, and accounting events.

The route is blocked in strict mode because the final financial phase has no reviewed canonical authority. It can create both an invoice payment and a patient advance deposit. Running `collectPayment()` and `recordDeposit()` as two independent commands would not be atomic with each other or with the legacy batch.

The completed appointment correction also establishes a mandatory invariant: disabled and shadow modes may not prepare or execute strict-only statements, stronger predicates, canonical assertion tables, or canonical-specific accounting inserts.

## Decision

Create one composite canonical command named `settleGatewayPayment()` and one gateway legacy adapter.

The external gateway call and transient `pending -> verifying` claim remain outside the financial batch. After successful external verification:

- **Legacy/off** executes the original production legacy financial batch unchanged, then runs the original accounting-event side effects best-effort.
- **Shadow** executes and commits the same original legacy batch, runs legacy accounting side effects, then projects the composite canonical settlement best-effort. Canonical failure cannot alter the legacy result or response.
- **Strict** lazily prepares a guarded legacy settlement batch and submits it as the authoritative statements of `settleGatewayPayment()`. Guarded legacy facts, canonical payment facts, optional canonical advance-deposit facts, source mappings, command idempotency, and canonical outbox events commit atomically.

## Canonical settlement model

A confirmed gateway amount is split into two independent canonical authorities:

### Invoice payment portion

When `amountForBill > 0`, create:

- one posted canonical payment receipt;
- one captured `gateway` tender;
- one payment allocation to the mapped canonical invoice;
- the guarded canonical invoice balance update;
- one payment-receipt source mapping;
- one `canonical.payment.receipt.posted` outbox event.

The receipt identity is deterministic from the tenant, gateway, and gateway payment ID.

### Advance deposit portion

When `depositAmount > 0`, create a separate fully unallocated canonical receipt and one canonical deposit:

- one posted canonical payment receipt dedicated to the advance;
- one captured `gateway` tender;
- one posted canonical deposit whose available balance equals the advance amount;
- payment-receipt and deposit source mappings;
- one `canonical.deposit.recorded` outbox event.

The advance receipt remains separate because `recordDeposit()` requires a fully unallocated receipt. Reusing the partially allocated invoice-payment receipt would violate canonical deposit invariants.

### Composite command envelope

`settleGatewayPayment()` owns one command idempotency key and one aggregate event summarizing the settlement. Payment and deposit domain events are inserted in the same batch with deterministic child idempotency keys.

## Legacy adapter

Create `src/lib/canonical/gateway-payment-verification.ts` with:

- `prepareGatewayPaymentOriginalLegacyStatements()` — exact current payment/bill/income/deposit/cash/log-success SQL without canonical assertions or stronger validation;
- `prepareGatewayPaymentStrictStatements()` — lazy strict-only statements with row-count assertions and optimistic bill/log predicates;
- `prepareGatewayPaymentLegacyStatements()` — original array carrying lazy strict statements and legacy post-commit accounting metadata.

Strict guards must prove:

- the bill still has the expected tenant, patient, total, paid amount, and status observed after gateway verification;
- the payment receipt/idempotency identity is not already present;
- the optional advance receipt is not already present;
- the gateway log is still `verifying` when changed to `success`;
- each required payment, bill, income, cash, log, accounting-event, and optional deposit write changes exactly one row.

## Failure and replay behavior

- Gateway verification failure continues to mark the gateway log `failed`.
- If the final legacy/canonical batch fails, the existing recovery path releases `verifying` back to `pending` so the confirmed gateway payment can be retried.
- Canonical command replay returns the stored settlement result without duplicating payment or deposit authority.
- A concurrent cashier payment that changes the bill after the gateway read causes strict optimistic guards to roll back the entire settlement.
- Legacy and shadow behavior remain unchanged and retain their existing concurrency semantics.

## Route changes

`src/routes/tenant/payments.ts` will:

1. Keep authentication, gateway-log claim, external verification, bill read, and amount split unchanged.
2. Build one immutable settlement input.
3. Call `executeStrictFinancialMutation()` with the original legacy statement array and `settleGatewayPayment()`.
4. Keep diagnostic paid-status propagation after a successful financial commit.
5. Remove the strict-block guard once route coverage is changed to `integrated`.

## Governance

Update `FINANCIAL_ROUTE_COVERAGE['payment-gateway.verify']` to:

- `status: 'integrated'`;
- `canonicalCommand: 'settleGatewayPayment'`.

No production deploy, migration, backfill, feature-flag change, traffic movement, tenant mutation, or production observation is authorized by this checkpoint.

## Test strategy

TDD must cover:

1. Composite command posts an invoice-only gateway payment.
2. Composite command posts an advance-only deposit.
3. Composite command atomically posts a split payment plus advance deposit.
4. Replay is idempotent and conflicting evidence is rejected.
5. Strict stale bill state rolls back legacy and canonical writes.
6. Strict stale gateway-log state rolls back everything.
7. Legacy/shadow arrays contain no assertion-table, canonical-event, or stricter predicate SQL.
8. Strict statement factories are never evaluated in legacy or shadow mode.
9. Legacy post-commit payment/deposit accounting events remain best-effort.
10. Route coverage recognizes `payment-gateway.verify` as integrated.

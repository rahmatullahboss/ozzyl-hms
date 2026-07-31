# Canonical Credit Note Cash Refund Attribution Design

**Date:** 2026-07-23

**Checkpoint:** CDB-106

**Branch:** `fix/canonical-credit-note-cash-refund-20260723`

**Base local main:** `99c0157a5f23d925bd5975f216d23d0c2547e3db`

**Production mutation authorization:** false

## Problem

Credit-note approval already has a reviewed canonical command for receivable-only credits. It deliberately rejects any positive cash refund because the current payment-reversal command assumes one original receipt, one original tender and one original invoice allocation. That model is not sufficient for credit-note cash payouts because:

- one bill may have multiple payment receipts;
- one receipt may contain multiple tenders;
- the refundable cash amount may span several allocations and receipts;
- the hospital may pay the refund in cash even when some original funding came through card, wallet, bank or gateway; and
- marking the original non-cash tender as reversed would misstate settlement authority and accounting.

Two live flows are blocked in strict mode:

1. `POST /credit-notes/:id/approve` when approval produces a positive cash refund;
2. held refund approval in `src/routes/tenant/approvals.ts`, which creates and pays an approved credit note from a reserved counter cash hold.

## Goals

- Integrate `credit-note.cash-refund` without pretending a cash payout is an original card/mobile/bank reversal.
- Support one or many payment receipts, allocations and original tenders deterministically.
- Preserve exact source lineage for every funding slice.
- Commit legacy credit-note, bill, cash, hold, commission and accounting effects with canonical credit and cash refund authority in one strict D1 batch.
- Preserve receivable-only credit notes on the existing `issueCreditNote` command.
- Preserve ordinary payment voids on the existing `reversePayment` command.
- Produce balanced accounting and cash-custody events.
- Fail closed when canonical payment history is missing, ambiguous, insufficient or changes concurrently.
- Do not deploy, migrate, backfill, change flags or mutate production.

## Non-goals

- Refunding back to the original card, wallet, bank or gateway.
- Replacing the existing payment-void workflow.
- Adding UI for manual payment-source selection.
- Reconstructing missing production payment history during the live command.
- Treating deposits as invoice-payment funding. Deposit applications remain a distinct authority and must be reversed by their own lifecycle before a cash-refund credit note can use that value.

## Approaches considered

### 1. Reuse `reversePayment` once

Choose one receipt, tender and allocation and run `reversePayment` before issuing the credit note.

**Rejected:** it cannot cover multi-payment refunds, and it records the payout against the original tender rather than the actual cash payout channel.

### 2. Run several ordinary payment reversals

Split the cash amount across existing allocations and run one `reversePayment` command per slice, followed by `issueCreditNote`.

**Rejected:** the commands would need nested or sequential idempotency claims, would not share one atomic batch without major command-batch surgery, and would still falsely mark non-cash original tenders as reversed.

### 3. Dedicated combined credit-note cash-refund authority

Create one combined canonical command that issues the credit note, reduces invoice payment backing across deterministic allocation/receipt slices, records original tender lineage without reversing the original tender, and records the actual payout tender as cash.

**Selected:** it matches the economic event, supports mixed and multi-payment bills, permits one atomic strict transaction and keeps payment void semantics separate.

## Canonical model

Add migration `0533_canonical_credit_note_cash_refunds.sql` with four additive tables.

### `canonical_credit_note_cash_refunds`

One parent refund payout per approved canonical credit note:

- `tenant_id`
- `refund_public_id`
- `credit_note_public_id`
- `invoice_public_id`
- `amount_minor`
- `payout_tender_type` — initially required to be `cash`
- `payout_method_code`
- `legacy_counter_id`
- `legacy_counter_session_id`
- `status` — `posted` or `reversed`
- `refunded_at_utc`
- `business_date`
- `source_evidence_sha256`
- reconciliation guard
- unique `(tenant_id, refund_public_id)`
- unique `(tenant_id, credit_note_public_id)` for one payout authority per credit note

### `canonical_credit_note_refund_receipts`

One row per source payment receipt participating in the cash payout:

- `receipt_slice_public_id`
- parent `refund_public_id`
- source `receipt_public_id`
- `amount_minor`
- receipt refunded/net-received before and after values
- `source_evidence_sha256`
- balance guard

The command updates each source receipt exactly once, even when the receipt contains several invoice allocations or tenders.

### `canonical_credit_note_refund_allocations`

One row for each invoice-payment allocation slice used to fund the cash payout:

- `allocation_slice_public_id`
- parent `refund_public_id`
- `receipt_slice_public_id`
- source `receipt_public_id`
- source `allocation_public_id`
- `amount_minor`
- allocation reversed/remaining before and after values
- `source_evidence_sha256`
- balance guard

The command updates each source allocation using the recorded before values. It does **not** insert `canonical_payment_reversals` because the original tender settlement is not being reversed.

### `canonical_credit_note_refund_tender_attributions`

One or more immutable lineage rows per allocation slice:

- `tender_attribution_public_id`
- parent `refund_public_id`
- `receipt_slice_public_id`
- source `receipt_public_id`
- original `tender_public_id`
- `amount_minor`
- original tender type and method snapshot
- source tender attributable-before and attributable-after values
- `source_evidence_sha256`

These rows identify which original captured funds economically back the refund. They do not change `canonical_payment_tenders.reversed_minor` or `remaining_minor`, so a cash payout never appears as a card/wallet/bank reversal.

Available source-tender attribution is computed as:

```text
canonical tender remaining_minor
- prior posted credit-note refund tender attributions
```

This prevents the same original tender balance from backing two cash refunds while preserving original settlement history.

## Deterministic attribution policy

The resolver loads all active canonical payment allocations for the invoice and all attributable captured tenders for those receipts.

Allocation ordering:

1. receipts containing available cash tender funding before receipts containing only non-cash funding;
2. newest `received_at_utc` first;
3. `receipt_public_id` descending as a stable tie-breaker;
4. `allocation_public_id` descending.

Tender ordering within each receipt:

1. original cash tender first;
2. then card, mobile wallet, bank transfer, gateway and other;
3. `tender_public_id` ascending as a stable tie-breaker.

The resolver consumes slices until `cashRefundMinor` is fully attributed. It may split one allocation across several tenders or one refund across several allocations/receipts.

Rationale:

- same-channel cash funding is used before cross-channel funding;
- newest-payment-first unwinds the most recent funding and reduces historical fragmentation;
- stable IDs make replay evidence deterministic;
- no operator guess or UI selection is required.

If available allocation, receipt or tender attribution is insufficient, the command fails before mutation with a safe conflict. It never falls back to unmapped legacy rows or invents canonical payment authority.

## Combined command

Create `issueCreditNoteWithCashRefund` in a dedicated module rather than modifying the zero-cash command contract.

Input includes:

- all existing credit-note identity, lines and evidence;
- `cashRefundMinor`;
- deterministic allocation slices and tender-attribution slices;
- payout tender and counter/session evidence;
- refund public ID;
- credit-note accounting event ID;
- cash-refund accounting event ID;
- cash-custody event ID;
- one combined idempotency key.

### Validation

The command requires:

- posted canonical invoice;
- positive credit-note total and positive cash refund;
- `cashRefundMinor <= invoice.paid_minor`;
- `creditTotalMinor <= invoice.net_due_minor + cashRefundMinor`;
- receipt slices, allocation slices and tender-attribution slices each sum exactly to `cashRefundMinor`;
- allocation and tender-attribution slices reconcile exactly to their parent receipt slice;
- every allocation belongs to the target invoice and source receipt;
- every tender belongs to the attributed receipt and is captured;
- source before-values match current canonical state;
- source tender attributable balance remains sufficient after prior credit-note refund attributions;
- no active deposit application is silently used as payment funding;
- paid performer reserves or settled compensation remain blocked under existing policy.

### Atomic state transition

For cash refund `R` and total credit `T`:

```text
invoice paid after      = paid before - R
invoice due after       = due before + R
invoice credited after  = credited before + T
invoice net due after   = net due before + R - T
```

Within one `runCanonicalBatch` execution:

1. authoritative legacy statements execute;
2. canonical credit note and credit-note lines insert;
3. parent cash refund inserts;
4. allocation-slice and tender-attribution rows insert;
5. each payment allocation reduces remaining balance and increases reversed/deallocated balance;
6. each payment receipt increases refunded balance and decreases net received balance;
7. original payment tenders remain unchanged;
8. canonical invoice updates once to the final paid, due, credited and net-due values;
9. post-state reconciliation guards validate all sums and source states;
10. credit note and refund source mappings insert;
11. canonical credit-note accounting outbox event inserts;
12. canonical cash-refund accounting outbox event inserts;
13. canonical cash-custody refund event inserts;
14. the combined idempotency claim completes.

Any stale allocation, receipt, tender attribution, invoice or legacy authority rolls back the whole transaction.

## Accounting

The existing credit-note event remains:

- debit `sales_returns` for total credit `T`;
- credit `accounts_receivable` for `T`.

Add `canonical.credit_note.cash_refunded`:

- debit `accounts_receivable` for cash refund `R`;
- credit `cash_on_hand` for `R`.

Together, final receivable reduction is `T - R`, matching the legacy `receivableReduction` calculation. The cash-refund event always uses the actual payout tender, initially cash, not the original funding tender.

Add a cash-custody event:

- event type `canonical.cash_custody.refund_recorded`;
- direction `out`;
- amount `R`;
- counter/session from the legacy payout authority.

## Live resolver

Create a resolver that:

1. resolves the mapped canonical invoice;
2. loads active payment allocations and posted receipts for that invoice;
3. loads captured original tenders and subtracts existing posted credit-note refund attributions;
4. applies the deterministic policy;
5. produces stable IDs and SHA-256 evidence for the combined command;
6. rejects missing, conflicting, insufficient or deposit-derived payment authority.

The resolver performs no mutation and does not repair data. Missing payment projections remain visible strict blockers for the specific refund.

## Route integration

### Direct credit-note approval

For `cashRefund === 0`:

- keep boundary `credit-note.approve`;
- keep `resolveLiveCreditNoteProjection` and `issueCreditNote`.

For `cashRefund > 0`:

- use boundary `credit-note.cash-refund`;
- require active counter session;
- build the same guarded legacy statements already used for credit-note approval;
- resolve deterministic cash-refund attribution;
- invoke `issueCreditNoteWithCashRefund` with those legacy statements as authoritative statements;
- remove the current resolver rejection path.

### Held refund approval

The held-refund flow already constructs a guarded legacy financial batch. Replace its direct `DB.batch(statements)` execution with `executeStrictFinancialMutation` on `credit-note.cash-refund` and pass those statements to the same combined command.

The cash-hold row supplies authoritative payout counter/session evidence. Cash hold consumption, bill changes, credit-note creation, commission impact and canonical refund all commit together in strict mode.

Clinical cancellation and post-commit shadow reserve updates remain after the financial commit and must be replay-safe.

## Error handling

Map resolver/command failures to safe conflicts:

- canonical payment history missing;
- insufficient refundable payment allocation;
- insufficient original tender attribution;
- payment or invoice state changed;
- deposit-backed value requires deposit lifecycle reversal;
- settled compensation blocks refund.

Do not return canonical IDs, SQL, raw constraints or tender/account details to the client.

## Idempotency and concurrency

- One combined canonical idempotency claim covers credit and payout.
- Deterministic slice IDs bind the exact attribution plan.
- Replaying the same legacy refund returns the same result without duplicate credit, refund or outbox rows.
- A changed attribution plan under the same key is a semantic idempotency conflict.
- Guarded source updates and final reconciliation fail closed if another refund, payment reversal or credit note changes any source balance after resolution.

## Migration and deployment order

Migration `0533` and its canonical schema registry entries must be applied before deploying route code that invokes the combined command. Production deployment, migration and flag changes require fresh explicit authorization and are out of scope for this local checkpoint.

## Testing

- Migration/schema tests for all new tables, constraints and foreign keys.
- Resolver tests for:
  - one cash receipt;
  - multiple cash receipts;
  - mixed cash/card receipts;
  - multi-tender receipt;
  - same-channel-first ordering;
  - newest-first ordering;
  - prior attribution subtraction;
  - insufficient allocation/tender funding;
  - missing mappings and tenant isolation.
- Command tests for:
  - atomic credit plus cash refund;
  - partial paid/partial due bill;
  - mixed-payment attribution without changing original tenders;
  - replay and semantic conflict;
  - stale allocation/receipt/invoice/tender-attribution rollback;
  - settled compensation and deposit-application rejection;
  - balanced accounting/custody outbox evidence.
- Route contracts and integration tests for both direct credit-note approval and held refunds.
- Existing receivable-only credit-note and payment-void regressions.
- Full canonical suite, affected approval/credit-note routes, TypeScript, migration manifest, governance and production build.

## Remaining boundary after completion

After this checkpoint, no explicitly reviewed financial boundary remains blocked solely for canonical model ambiguity. Other alternate writer boundaries remain fail-closed until their own reviewed atomic adapters are implemented.

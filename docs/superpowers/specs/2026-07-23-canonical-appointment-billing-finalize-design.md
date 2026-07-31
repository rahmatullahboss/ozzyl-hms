# Canonical Appointment Billing Finalize Design

**Date:** 2026-07-23

**Checkpoint:** CDB-107

**Branch:** `fix/canonical-appointment-billing-finalize-20260723`

**Base local main:** `9cf2446007b72a03ce18ca6618da5af9de1f2c84`

**Production mutation authorization:** false

## Problem

`finalizeAppointmentConsultationInvoice` directly finalizes one appointment consultation into legacy financial authority:

- one `bills` row;
- one or more `invoice_items` rows;
- finalized `billing_provisional_items` rows;
- an optional full payment and cash transaction;
- appointment billing status;
- optional scheme discount allocation;
- later accounting, commission, queue, audit and cash-ledger side effects.

The route is currently blocked in canonical strict mode. Its paid branch cannot safely call `issueInvoice` followed by `collectPayment`, because those commands each own a separate canonical transaction. A failure after invoice issue but before payment collection would leave a canonical due invoice while the legacy transaction was intended to be fully paid.

The route also has a service-line authority ambiguity. Appointment provisional items use the doctor ID as `reference_id`; that is not a canonical service catalog or service event identity. Treating it as one would invent canonical service authority.

## Goals

- Integrate both appointment credit-invoice and pay-now paths under `appointment.billing.finalize`.
- Commit guarded legacy finalization and canonical financial authority in one D1 batch in strict mode.
- Preserve disabled and shadow behavior while adding deterministic canonical projection.
- Use the existing `issueInvoice` command for credit invoices.
- Add a reusable command for one newly issued invoice paid in full by one captured tender.
- Preserve exact legacy discount and net-total arithmetic without double-discounting.
- Record canonical cash custody only for actual cash tenders.
- Fail closed on appointment concurrency, provisional-item races, duplicate invoice/payment identity, invalid non-cash authority or canonical failure.
- Keep queue creation, audit, commission/reserve work and scheme usage replay-safe after the financial commit.
- Do not deploy, migrate, backfill, change flags or mutate production.

## Non-goals

- Creating a canonical clinical consultation service request/event lifecycle.
- Treating doctor IDs as canonical service IDs.
- Supporting partial payment, split tender, deposit application or overpayment in the new combined command.
- Moving doctor commission and diagnostic reserve subsystems into the appointment financial command.
- Refactoring unrelated appointment scheduling or queue logic.
- Applying any production migration or feature flag.

## Approaches considered

### 1. Sequential `issueInvoice` then `collectPayment`

Issue the canonical invoice and then collect the payment with the existing commands.

**Rejected:** each command executes its own transaction and idempotency claim. It cannot atomically include the same legacy statements, and the paid path can stop between invoice and payment.

### 2. Appointment-specific combined command

Create a command that directly mirrors the appointment route and duplicates invoice/payment validation and statements.

**Rejected:** it solves this route but creates another one-off financial aggregate. The remaining provisional, lab, radiology and reception writers need the same simple invoice-plus-full-payment capability.

### 3. Generic full-payment invoice command plus appointment adapter

Create `issueInvoiceWithFullPayment`, constrained to one newly issued invoice, one captured tender, one full invoice allocation and zero unallocated balance. Build an appointment projection that feeds this command for pay-now and `issueInvoice` for credit.

**Selected:** it is atomic, bounded, reusable and avoids pretending the appointment doctor reference is a canonical service identity.

## Canonical command

Create `src/lib/canonical/commands/issue-invoice-full-payment.ts`.

### Input

The command consumes:

- one complete `IssueInvoiceInput`;
- payment receipt public ID and number;
- one tender public ID, type, method and captured amount;
- one allocation public ID for the same invoice;
- collector, counter and counter-session authority;
- optional external transaction ID;
- payment/refund evidence hashes;
- payment and cash-custody outbox IDs;
- one combined command idempotency key.

The payment amount must equal the invoice total exactly. `unallocated_minor` is always zero.

### Validation

The command requires:

- valid invoice identity, lines, currency, UTC time, business date and source evidence;
- one positive invoice total;
- one positive captured tender;
- payment amount exactly equal to invoice total;
- receipt, tender and allocation identities all distinct and non-empty;
- one payment allocation referencing the new invoice;
- one supported tender type;
- non-cash tenders to include a non-empty external transaction/reference ID;
- cash tenders to include a cash-custody event ID;
- no duplicate invoice, receipt, tender, allocation or source mapping;
- replay request equality under one combined idempotency key.

### Atomic state

The command inserts the new invoice directly in its final paid projection:

```text
invoice total       = T
invoice paid        = T
invoice due         = 0
invoice credited    = 0
invoice net due     = 0
```

It then inserts:

1. canonical invoice lines;
2. posted payment receipt with total and allocated total `T`;
3. one captured tender with remaining balance `T`;
4. one active payment allocation with:
   - invoice due before `T`;
   - invoice due after `0`;
   - remaining allocation `T`;
5. invoice, receipt and payment source mappings;
6. canonical invoice-issued outbox event;
7. canonical payment-received outbox event;
8. cash-custody received event when tender type is cash;
9. the completed combined idempotency claim.

Reconciliation guards prove invoice, receipt, tender and allocation totals agree. Authoritative legacy statements run before these canonical statements in the same `runCanonicalBatch` call.

## Appointment projection

Create `src/lib/canonical/live-appointment-billing.ts`.

It accepts the already validated appointment, invoice number, provisional items, totals, payment mode and counter authority.

### Invoice lines

Appointment provisional items are represented as deterministic positive `other_adjustment` lines, not service lines:

- invoice and line public IDs use the established `legacy_live_bill` and `legacy_live_bill_line` conventions required by payment recovery and doctor-compensation resolution;
- the standard line source key uses invoice number, stable line order, item category and doctor/reference ID;
- adjustment code is a normalized appointment category such as `APPOINTMENT_DOCTOR_VISIT`;
- each gross item amount is `unit_price × quantity`;
- the invoice-level discount is the sum of provisional `discount_amount`;
- final canonical total must equal the legacy bill total exactly;
- richer evidence still includes appointment ID, provisional item ID, category, doctor/reference ID, original unit price, quantity, discount and net amount.

This preserves gross and discount arithmetic while avoiding a fabricated service event. A later service-operations checkpoint may enrich consultation service authority without changing financial identities.

### Payment

For pay-now:

- map legacy payment method to canonical tender type;
- normalize method code;
- require external transaction/reference ID for every non-cash method;
- create stable receipt, tender, allocation, payment outbox and optional custody IDs from tenant and receipt number;
- allocate the entire payment to the new invoice.

For due approval, no payment projection is created.

## Guarded legacy batch

Use `canonical_financial_batch_assertions` around every critical legacy step.

The batch contains:

1. bill insert — expected one row;
2. each invoice item insert — expected one row;
3. each provisional item transition from the exact patient, appointment, price, quantity, discount, net-total and `provisional` snapshot to `finalized` — expected one row;
4. optional payment insert — expected one row;
5. optional employee cash transaction — expected one row;
6. appointment billing-status update guarded by the originally read billing status — expected one row;
7. optional scheme discount allocation — expected one row;
8. legacy bill-created accounting posting event — expected one row;
9. optional legacy payment-received accounting posting event — expected one row;
10. assertion cleanup.

The appointment update must include the original billing status in its `WHERE` clause. If two requests race, the loser changes zero rows and rolls back the entire batch, including its bill, items and payment.

`INSERT OR IGNORE` accounting events must be bound to newly generated unique source event keys. An ignored event is treated as an assertion failure rather than silently accepted.

## Strict coordinator integration

The route calls `executeStrictFinancialMutation` with:

- boundary `appointment.billing.finalize`;
- the guarded legacy batch;
- `issueInvoice` for credit mode;
- `issueInvoiceWithFullPayment` for paid mode.

Disabled mode executes the guarded legacy batch only. Shadow mode executes legacy first and projects canonical non-blockingly. Strict mode passes the same legacy statements as authoritative statements to the canonical command.

After execution:

- legacy/shadow mode obtains the inserted bill ID from the first batch result when available;
- strict mode and mock-compatible fallback query by tenant and invoice number;
- failure to resolve the bill after commit returns a safe conflict/error without inventing an ID.

## Existing request idempotency

The pay-now HTTP idempotency flow remains in place:

- completed requests replay the stored response;
- an in-progress key conflicts;
- a changed request under the same key conflicts;
- failures mark the reservation failed.

The canonical command uses deterministic invoice/receipt identities and its own stable combined key. The appointment status assertion protects due approval, which does not currently expose an HTTP idempotency key.

## Post-commit side effects

The following remain after the financial commit:

- doctor queue entry creation;
- audit log;
- doctor commission and performer-reserve processing;
- scheme usage recording;
- legacy cash-ledger shadow entry;
- accounting posting worker scheduling.

`recordBillFinalizationSideEffects` gains a narrow option to skip bill-created accounting event creation, because that event is moved into the guarded financial batch. Commission and reserve behavior remains unchanged.

The separate payment-received posting call is removed from post-commit work because its legacy event is also inserted in the guarded batch.

Post-commit tasks remain idempotent or insert-ignore based. Their failure is logged and does not invalidate the already committed financial authority.

## Accounting

Canonical accounting is driven by the outbox events committed with the command:

- invoice issued: debit accounts receivable, credit patient revenue;
- payment received: debit tender/cash authority, credit accounts receivable;
- cash custody received: operational cash custody event only for cash.

For a fully paid invoice, accounts receivable nets to zero across the invoice and payment vouchers.

Legacy `accounting_posting_events` for bill creation and payment receipt are inserted in the same guarded legacy batch to preserve existing reporting and posting workflows.

## Error handling

Return safe conflicts for:

- appointment state changed concurrently;
- provisional item no longer available;
- bill or payment identity already exists;
- canonical invoice/payment projection mismatch;
- non-cash payment missing transaction/reference authority;
- canonical command failure under strict mode.

Do not return SQL, canonical internal IDs, constraint names or source evidence hashes to clients.

No-charge appointments remain outside the financial command because they create no bill, payment, canonical invoice or receipt.

## Testing

### Command tests

- full cash payment creates paid invoice, receipt, tender, allocation and custody event;
- full card/mobile/bank payment creates no cash custody event;
- non-cash method without external reference is rejected;
- payment amount must equal invoice total;
- replay returns the same result;
- changed request conflicts;
- canonical failure rolls back authoritative legacy statements;
- duplicate receipt/tender/allocation identities fail closed;
- accounting events produce balanced invoice and payment vouchers.

### Projection tests

- appointment provisional items produce deterministic gross lines and one discount line;
- canonical total equals legacy net bill total;
- doctor/reference ID appears only in evidence, not as a service-event ID;
- payment method normalization covers cash, card, bKash, Nagad, Rocket, bank, cheque and other;
- non-cash external reference is required;
- tenant isolation and stable IDs.

### Route tests

- credit mode uses `issueInvoice`;
- paid mode uses `issueInvoiceWithFullPayment`;
- all legacy critical statements have assertions and cleanup;
- appointment status race rolls back the financial batch;
- paid cash, paid non-cash and due approval preserve existing responses;
- HTTP idempotency replay remains unchanged;
- bill ID resolution works in legacy, shadow and strict modes;
- queue, commission, audit, scheme usage and cash-ledger work occurs after commit;
- boundary registry changes to `integrated` only after both paid and credit routes are covered.

### Final gates

- focused appointment/canonical command tests;
- full canonical suite;
- TypeScript;
- canonical governance;
- migration manifest unchanged at 465 unless unrelated latest-main work changes it;
- production build;
- `git diff --check`.

## Deployment prerequisite

No schema migration is expected for this checkpoint. Route code still requires all existing canonical migrations through 0533. Production deployment, feature flags, strict activation, traffic changes and data mutation require fresh explicit authorization and remain out of scope.

## Remaining boundary after completion

After CDB-107, remove `appointment.billing.finalize` from the remaining writer list. The next checkpoint is `billing-provisional.finalize`, which can reuse the full-payment command for its simple paid branch while separately addressing deposit and partial-payment modes.

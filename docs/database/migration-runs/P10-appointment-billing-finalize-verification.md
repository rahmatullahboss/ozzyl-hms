# P10 Appointment Billing Finalize Verification

**Checkpoint:** CDB-107

**Date:** 2026-07-23

**Branch:** `fix/canonical-appointment-billing-finalize-20260723`

**Base local main:** `564ca64edebc40462a3eb737b4e2a04c591ac17c`

**Implementation head before evidence commit:** `6ff4182f3`

**Production mutation authorization:** false

## Verdict

`appointment.billing.finalize` is implemented and verified locally for both appointment due approval and pay-now. The boundary is registered as `integrated` and selects:

- `issueInvoice` for a credit invoice;
- `issueInvoiceWithFullPayment` for a newly issued invoice paid in full.

Guarded legacy bill, invoice-item, provisional-item, payment, cash, appointment-status and accounting facts are committed with canonical authority through one strict financial mutation boundary. No production deploy, migration application, backfill, feature-flag change, traffic change, observation, rollback or tenant-data mutation was performed.

## Implementation commits

- `5c6f661e4` — design and implementation plan
- `52b5e9f5a` — reusable atomic full-payment invoice command
- `a8e9772c9` — deterministic appointment financial projection
- `5f43765df` — guarded route and strict coordinator integration
- `6ff4182f3` — concurrency, compensation identity and registry hardening

## Reusable full-payment command

`issueInvoiceWithFullPayment` creates one new invoice and one captured full payment in a single canonical command. It requires:

- one positive invoice total;
- one receipt;
- one captured tender;
- one allocation to the same invoice;
- payment amount equal to the invoice total;
- zero unallocated balance;
- an external transaction/reference for non-cash tenders;
- a cash-custody event identity only for cash.

The resulting invoice projection is:

```text
paid_minor      = total_minor
due_minor       = 0
credited_minor  = 0
net_due_minor   = 0
```

The same transaction inserts:

- invoice and invoice lines;
- payment receipt;
- tender;
- allocation;
- invoice and payment source mappings;
- invoice-issued outbox event;
- payment-receipt-posted outbox event;
- cash-custody collection event for cash only;
- completed command idempotency authority.

Tests prove replay, changed-request conflict, exact full-payment enforcement, non-cash reference enforcement and rollback of authoritative legacy statements when canonical state fails.

## Appointment projection

Appointment provisional items are projected as positive `other_adjustment` invoice lines. Doctor IDs are not treated as canonical service-event IDs.

Financial identities use the established live-bill conventions:

- invoice source type: `legacy_live_bill`;
- invoice source ID: legacy invoice number;
- line source type: `legacy_live_bill_line`;
- line identity: invoice number plus the standard ordered legacy line source key.

This identity choice is required by payment recovery and doctor-compensation line resolution. Rich evidence still records appointment ID, provisional-item ID, category, description, doctor/reference ID, unit price, quantity, discount and net amount.

The projection verifies for every provisional item:

```text
(unit price × quantity) - discount = net total
```

It also verifies aggregate gross, discount and net totals. A separate discount line preserves the legacy invoice header arithmetic.

Payment methods map deterministically to canonical tender authority:

- cash;
- card;
- mobile wallet for bKash, Nagad and Rocket;
- bank transfer for bank, bank transfer and cheque;
- other.

Non-cash methods require an external transaction/reference before any financial mutation.

## Guarded legacy authority

`prepareAppointmentBillingLegacyStatements` places a `canonical_financial_batch_assertions` check after every critical statement:

1. bill insert;
2. each invoice-item insert;
3. each provisional-item transition;
4. optional payment insert;
5. optional employee cash transaction;
6. appointment billing-status and scheme-field update;
7. optional scheme discount allocation;
8. bill-created accounting event;
9. optional payment-received accounting event;
10. assertion cleanup.

The provisional transition requires the exact route snapshot to remain unchanged:

- tenant;
- patient;
- appointment;
- unit price;
- quantity;
- discount;
- net total;
- provisional status;
- active status.

The appointment update also requires the originally read billing status. A concurrent appointment or provisional-item change therefore produces zero affected rows, violates the assertion guard and rolls back the entire financial batch.

Legacy direct-write governance allowances were moved from `src/routes/tenant/appointments.ts` to the focused guarded adapter `src/lib/canonical/appointment-billing-finalization.ts` for `bills`, `invoice_items` and `payments`.

## Route integration

`finalizeAppointmentConsultationInvoice` now invokes `executeStrictFinancialMutation` with boundary `appointment.billing.finalize`.

- Disabled mode executes the guarded legacy batch.
- Shadow mode preserves legacy authority and attempts canonical projection non-blockingly under the existing coordinator policy.
- Strict mode passes the same legacy statements as authoritative statements to the canonical command so both authorities commit or roll back together.

Financial assertion conflicts are returned as a safe 409 without exposing SQL, constraint names, evidence hashes or canonical internal IDs.

The existing HTTP idempotency contract for appointment pay-now remains intact:

- completed request replay;
- changed payload conflict;
- in-progress conflict;
- failure-state marking.

## Scheme and post-commit behavior

Scheme discount amount, final fee and reason are no longer written before the strict financial batch. They are included in the guarded appointment update and roll back with the invoice when canonical authority fails.

The following remain after the financial commit:

- doctor queue entry;
- audit log;
- doctor commission and performer-reserve processing;
- scheme usage recording;
- cash-ledger shadow entry;
- accounting worker scheduling.

Bill-created and payment-received legacy accounting events are inserted inside the guarded financial batch. `recordBillFinalizationSideEffects` receives `skipBillAccountingEvent: true`, preventing a duplicate bill-created event while preserving commission and reserve behavior.

## Accounting

Canonical outbox processing produces:

- invoice voucher: debit accounts receivable, credit patient revenue;
- payment voucher: debit the actual tender/cash account, credit accounts receivable;
- cash-custody event for a cash tender only.

For a fully paid appointment invoice, invoice and payment vouchers net accounts receivable to zero. The existing accounting reconciliation suite passed with the new command events.

## Adversarial findings fixed

### 1. Stale provisional financial snapshot

The original guarded transition checked only provisional/active status. A concurrent scheme or price update could have committed a bill based on stale route values. A failing real-SQLite regression was added first. The transition now guards patient, appointment, price, quantity, discount and net amount as well.

### 2. Compensation authority identity mismatch

The initial appointment projection used appointment-specific invoice and line IDs. The consultation commission resolver uses standard live-bill identities, so canonical compensation could not resolve the line. A failing identity regression was added first. Appointment projection now uses the standard `legacy_live_bill` and `legacy_live_bill_line` identities while retaining appointment-specific evidence.

No unresolved Critical or High review finding remains for this checkpoint.

## Fresh verification

### Focused financial and route suite

```text
Test Files  9 passed (9)
Tests       82 passed (82)
```

Covered:

- full-payment command;
- appointment projection;
- guarded legacy finalization;
- doctor compensation identity;
- accounting reconciliation;
- route registry;
- direct route integration;
- existing appointment billing handoff;
- strict financial coordinator.

### Full canonical suite

```text
Test Files  113 passed (113)
Tests       795 passed (795)
```

### TypeScript

```text
./node_modules/.bin/tsc --noEmit
exit 0
```

### Schema governance

```text
Canonical schema governance passed with 0 issues.
```

### Migration manifest

```text
465 migrations generated
```

No new schema migration was introduced by CDB-107.

### Production build

```text
pnpm build
exit 0
```

The build emitted existing Vite chunk-size and deprecation warnings only; no build failure occurred.

## Deployment prerequisite

All existing canonical migrations through `0533_canonical_credit_note_cash_refunds.sql` must be applied before strict appointment billing code is deployed. This local verification does not authorize deployment, strict activation or any production operation.

## Remaining runtime writer boundary

`appointment.billing.finalize` is removed from the remaining list. The next checkpoint is:

- `billing-provisional.finalize`

The remaining alternate financial writers continue to be fail-closed in strict mode until their own reviewed atomic adapters are implemented and verified.

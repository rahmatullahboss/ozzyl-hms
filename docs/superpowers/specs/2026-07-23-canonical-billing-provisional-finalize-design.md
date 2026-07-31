# Canonical Billing Provisional Finalize Design

**Date:** 2026-07-23

**Checkpoint:** CDB-108

**Branch:** `fix/canonical-billing-provisional-finalize-20260723`

**Base local main:** `6f6c54f3b150c602836dd8f6cc1e3ad2cd8acd0f`

**Production mutation authorization:** false

## Problem

`POST /billing-provisional/pay` converts one or more provisional charges into final legacy financial authority. A single request may create:

- one `bills` row;
- one `invoice_items` row per provisional item;
- one finalized transition per provisional item;
- an optional direct payment and employee cash transaction;
- an optional patient-deposit adjustment;
- an optional scheme discount allocation;
- bill, payment and deposit accounting events;
- post-commit doctor payable, commission, scheme usage and audit effects.

The route is currently blocked in canonical strict mode. Existing canonical commands cannot be called sequentially in strict mode because invoice issue, payment collection and one or more deposit applications would commit in separate canonical transactions. A failure after the first command could leave partial canonical authority while the legacy batch rolls back or remains incomplete.

The route supports more than full payment. It can produce:

- credit invoice;
- partial direct payment;
- full direct payment;
- deposit-only settlement;
- deposit plus partial payment;
- deposit plus full remaining payment;
- a remaining due balance after either settlement source.

The legacy deposit adjustment is one aggregate row, while canonical deposit authority may require consuming several historical deposits in deterministic order.

## Goals

- Integrate `billing-provisional.finalize` for all existing settlement combinations.
- Commit guarded legacy and canonical financial authority in one D1 batch under strict mode.
- Preserve disabled and shadow behavior.
- Add a reusable atomic command for invoice issue plus optional direct payment plus optional multi-deposit application.
- Select canonical deposits deterministically, oldest available first.
- Preserve existing legacy response fields and bill arithmetic.
- Use standard `legacy_live_bill` and `legacy_live_bill_line` identities so payment recovery, compensation and reporting can resolve the invoice and lines.
- Keep manual and catalog provisional items financially valid without inventing canonical service-event authority.
- Move bill, payment and deposit legacy accounting events into the guarded financial batch.
- Keep doctor payables, commission/reserve processing, scheme usage and audit after the financial commit.
- Fail closed on stale item values, duplicate identities, insufficient canonical deposit coverage or canonical reconciliation failure.
- Do not deploy, migrate, backfill, change flags, change traffic or mutate production.

## Non-goals

- Creating canonical clinical service requests or service-delivery events for provisional items.
- Treating `reference_id` as a canonical service event.
- Creating or repairing missing canonical deposits during finalization.
- Supporting split direct tenders in one request.
- Supporting overpayment or creating a new deposit from excess payment.
- Refactoring unrelated provisional-item creation or cancellation routes.
- Applying any production operation.

## Existing route semantics to preserve

The route currently calculates:

```text
item subtotal        = sum(item.total_amount)
global discount      = request discount
total                 = max(0, item subtotal - global discount)
deposit applied      = min(requested deposit, total, legacy available deposit)
amount after deposit = total - deposit applied
direct payment       = explicit paid_amount capped to amount after deposit,
                       or zero for credit/due,
                       or the full amount after deposit otherwise
due                   = total - deposit applied - direct payment
legacy bill paid      = direct payment only
legacy bill due       = due
```

The canonical invoice uses the economic settlement model:

```text
canonical paid = deposit applied + direct payment
canonical due  = total - deposit applied - direct payment
canonical net due = canonical due
```

This difference is intentional. The legacy bill stores deposit consumption separately in `billing_deposits`, while canonical invoice paid authority includes every applied settlement source.

## Approaches considered

### 1. Sequential existing commands

Call `issueInvoice`, then `applyDeposit` one or more times, then `collectPayment`.

**Rejected:** each command owns a separate canonical transaction and idempotency claim. It cannot atomically include one guarded legacy batch, and failure between commands produces partial canonical state.

### 2. Provisional-route-specific combined command

Create a command that mirrors the current route and directly writes invoice, payment and deposit facts.

**Rejected:** it would solve this route but duplicate the same settlement composition needed by IPD discharge and settlement boundaries.

### 3. Generic atomic invoice settlement command

Create `issueInvoiceWithSettlement` for one new invoice, zero or one captured direct tender, and zero or more deterministic deposit applications.

**Selected:** it covers every current provisional route mode, is reusable by later invoice-finalization boundaries, and keeps all invoice balance transitions in one canonical command.

## Generic command

Create `src/lib/canonical/commands/issue-invoice-settlement.ts`.

### Input

The command receives:

- one complete `IssueInvoiceInput`;
- one combined command idempotency key;
- optional direct payment authority:
  - receipt public ID and number;
  - tender public ID;
  - allocation public ID;
  - tender type and method code;
  - amount;
  - collector, counter and counter-session IDs;
  - optional external transaction/reference;
  - payment source identity and outbox IDs;
- optional deposit application request:
  - aggregate legacy adjustment number;
  - requested amount;
  - application timestamp and business date;
  - deterministic source identity prefix.

The command performs read-only preflight before constructing its one batch.

### Validation

The command requires:

- one positive invoice total;
- direct payment amount greater than zero when payment authority is present;
- deposit amount greater than zero when deposit authority is present;
- direct payment plus deposit amount not exceeding invoice total;
- non-cash direct payment to include an external transaction/reference;
- cash direct payment to include a custody event ID;
- no payment identities when direct payment is zero;
- no deposit identities when deposit application is zero;
- patient and currency agreement across invoice and selected deposits;
- exact stable source identities and lowercase SHA-256 evidence;
- no duplicate receipt, tender, allocation, application or mapping identity;
- replay request equality under one combined command key.

### Deposit funding preflight

When deposit application is requested, the command loads canonical deposits for the same tenant and patient:

```sql
SELECT deposit_public_id, available_minor, applied_minor, refunded_minor,
       received_at_utc, status, currency_code
FROM canonical_deposits
WHERE tenant_id = ?
  AND legacy_patient_id = ?
  AND currency_code = 'BDT'
  AND status = 'posted'
  AND available_minor > 0
ORDER BY received_at_utc, deposit_public_id
```

`allocateOldestAvailableDeposits` creates deterministic slices. If canonical deposits do not cover the requested amount, the command fails before mutation. It does not create, repair or infer deposit authority from the aggregate legacy balance.

Each slice records its own canonical application public ID and source public ID:

```text
<legacy-adjustment-number>:1
<legacy-adjustment-number>:2
...
```

One legacy adjustment row may therefore reconcile to multiple canonical deposit-application rows.

### Atomic invoice state

For invoice total `T`, deposit settlement `D` and direct payment `P`:

```text
paid_minor      = D + P
due_minor       = T - D - P
credited_minor  = 0
net_due_minor   = T - D - P
```

The invoice is inserted directly in this final balance state. The command does not issue a due invoice and update it through separate transactions.

### Deposit slice state

For each selected deposit slice, the command inserts a `canonical_deposit_applications` row with sequential invoice snapshots.

If a slice amount is `S`:

```text
deposit available after = available before - S
deposit applied after   = applied before + S
invoice paid after      = invoice paid before + S
invoice due after       = invoice due before - S
invoice net due after   = invoice net due before - S
```

Deposit slices are applied first in oldest-first order. The optional direct payment allocation follows the final deposit slice.

Every deposit update uses its exact preflight `applied_minor`, `refunded_minor` and `available_minor` snapshot. A concurrent deposit use changes zero rows and causes command reconciliation failure and full transaction rollback.

### Direct payment state

When `P > 0`, the command inserts:

- one posted payment receipt;
- one captured tender;
- one active allocation to the new invoice;
- receipt and payment source mappings;
- payment-receipt-posted outbox event;
- cash-custody collection event only for cash.

The payment allocation records:

```text
invoice due before = T - D
invoice due after  = T - D - P
```

The receipt total and allocated total are both `P`; unallocated is zero.

### Outbox events

The one command commits:

- one `canonical.invoice.issued` event;
- zero or one `canonical.payment.receipt.posted` event;
- zero or one `canonical.cash_custody.collection_recorded` event;
- one `canonical.deposit.applied` event per deposit slice.

Canonical accounting therefore posts:

- invoice: accounts receivable debit, patient revenue credit;
- payment: tender/cash debit, accounts receivable credit;
- deposit application: patient-deposit liability debit, accounts receivable credit.

The resulting accounts-receivable balance equals the final invoice due.

## Provisional projection

Create `src/lib/canonical/live-provisional-billing.ts`.

### Invoice identities

Use established live-bill identities:

- invoice source type: `legacy_live_bill`;
- invoice source public ID: invoice number;
- line source type: `legacy_live_bill_line`;
- line source ID: standard stable line order, category and reference identity.

### Invoice lines

Every provisional item becomes a positive `other_adjustment` line. This is financial authority only; it does not invent service-delivery authority.

For each item:

```text
gross = unit_price × quantity
item discount = discount_amount
net = total_amount
required: gross - item discount = net
```

The projection creates:

- one gross line per item;
- one aggregate item-discount line when item discounts exist;
- one global provisional-bill discount line when request discount exists.

Canonical total must equal the route’s legacy `totalAmount` exactly.

Evidence includes:

- provisional item ID;
- patient, visit and admission IDs;
- category, description and department;
- unit price, quantity, item discount and net amount;
- doctor and reference IDs;
- manual/catalog context when available.

### Settlement projection

The projection maps the request into `IssueInvoiceWithSettlementInput`.

Payment method normalization follows existing canonical conventions:

- cash;
- card;
- mobile wallet for bKash, Nagad and Rocket;
- bank transfer for bank, bank transfer and cheque;
- gateway/online;
- other.

The JSON schema gains optional aliases:

```text
external_transaction_id
externalTransactionId
```

They are not required at Zod parsing time so disabled and shadow legacy behavior remains compatible. The canonical command rejects missing non-cash authority in strict mode; shadow mode records a canonical issue while preserving legacy authority under existing policy.

## Guarded legacy adapter

Create `src/lib/canonical/provisional-billing-finalization.ts`.

The adapter prepares row-count-guarded legacy statements for:

1. bill insert;
2. optional scheme discount allocation;
3. each invoice-item insert;
4. each provisional-item transition;
5. optional payment insert;
6. optional employee cash transaction;
7. optional aggregate deposit-adjustment insert;
8. bill-created accounting event;
9. optional payment-received accounting event;
10. optional patient-deposit-adjusted accounting event;
11. assertion cleanup.

### Exact provisional snapshot guard

Each provisional transition must still match the route snapshot:

- tenant;
- patient;
- admission and visit;
- item category and description;
- unit price and quantity;
- discount amount and total amount;
- doctor and reference IDs;
- `bill_status = 'provisional'`;
- active status.

Any concurrent edit, cancellation or finalization causes zero changes, violates the assertion guard and rolls back the entire legacy/canonical financial transaction.

### Identity guards

The adapter prevents duplicate legacy authority:

- bill insert only when `(tenant_id, invoice_no)` does not exist;
- payment insert only when `(tenant_id, receipt_no)` does not exist;
- deposit adjustment only when `(tenant_id, deposit_receipt_no)` does not exist;
- accounting `INSERT OR IGNORE` statements must still affect exactly one row.

## Route integration

Replace the direct batch with `executeStrictFinancialMutation` on `billing-provisional.finalize`.

The route performs:

1. authorization, counter and period checks;
2. exact item load and patient validation;
3. scheme validation;
4. legacy deposit-balance calculation;
5. deterministic invoice, receipt and deposit-adjustment number generation;
6. projection construction;
7. guarded legacy statement construction;
8. one strict financial mutation call.

The canonical callback invokes `issueInvoiceWithSettlement` and passes the guarded legacy statements as authoritative statements in strict mode.

After execution, bill ID is resolved from the coordinator batch result when possible and by `(tenant_id, invoice_no)` fallback otherwise.

Financial batch assertion conflicts return a safe 409. Canonical deposit insufficiency, stale canonical deposit state or other strict reconciliation conflicts also return a safe 409 without exposing SQL, constraint names, internal public IDs or evidence hashes.

## Post-commit side effects

These remain after the financial commit:

- `createDoctorPayableAccrualsForProvisionalItems`;
- scheme usage recording;
- bill commission and performer-reserve processing;
- audit log;
- accounting worker scheduling.

Bill-created, payment-received and patient-deposit-adjusted legacy accounting events move into the guarded financial batch. `recordBillFinalizationSideEffects` receives `skipBillAccountingEvent: true` to avoid duplication.

Scheme usage remains post-commit because it is idempotent at bill level. Doctor payable and commission paths run only after canonical invoice authority is committed, allowing standard live-bill line resolution.

## Error handling

Return safe conflicts for:

- provisional item changed, cancelled or finalized concurrently;
- duplicate invoice, receipt or deposit-adjustment identity;
- canonical deposit balance insufficient for requested deposit use;
- canonical deposit changed after preflight;
- settlement amount exceeds invoice total;
- missing non-cash external transaction/reference in strict mode;
- canonical invoice, payment or deposit reconciliation failure.

Preserve existing 400 responses for invalid patient/item selection, scheme policy failure and insufficient legacy deposit balance.

## Testing

### Command tests

Use real SQLite fixtures to prove:

- credit invoice with no settlement;
- partial cash payment;
- full non-cash payment;
- deposit-only settlement;
- deposit plus partial payment;
- deposit allocation across several deposits oldest-first;
- final invoice paid/due/net-due arithmetic;
- payment receipt/tender/allocation reconciliation;
- one deposit event per slice;
- non-cash reference enforcement;
- insufficient canonical deposit coverage rejection;
- stale deposit snapshot rollback;
- authoritative legacy rollback on any canonical failure;
- replay and changed-request conflict.

### Projection tests

Prove:

- standard live-bill invoice and line identities;
- gross item lines plus item/global discounts;
- manual and catalog item evidence;
- exact gross-discount-net reconciliation;
- stable payment and deposit identities;
- tender mapping;
- no fabricated service-event ID.

### Legacy adapter tests

Use real SQLite to prove:

- all expected legacy rows commit together;
- stale item price, discount, quantity, status or identity rolls back everything;
- duplicate payment/deposit receipt rolls back everything;
- accounting event duplication fails closed;
- assertion rows are cleaned after success.

### Route tests

Prove:

- credit, partial payment, deposit-only and combined settlement use the strict coordinator;
- disabled/shadow responses remain compatible;
- strict canonical failure rolls back legacy authority;
- bill ID response remains correct;
- doctor payables, scheme usage, commission, audit and worker scheduling occur after commit;
- post-commit accounting event creation is removed;
- registry becomes `integrated` only after all modes pass.

### Final gates

- focused provisional/canonical tests;
- full canonical suite;
- TypeScript;
- canonical governance;
- migration manifest remains 465 unless latest-main work changes it;
- production build;
- `git diff --check`.

## Deployment prerequisite

No new schema migration is expected. Existing canonical migrations through 0533 must be applied before strict route code is deployed. This design does not authorize any production action.

## Remaining boundary after completion

After CDB-108, remove `billing-provisional.finalize` from the remaining list. The next checkpoint is:

- `ipd-discharge.billing.finalize`

The new generic settlement command is intentionally designed for reuse there, while IPD-specific deposit refund and discharge authority remain a separate reviewed checkpoint.

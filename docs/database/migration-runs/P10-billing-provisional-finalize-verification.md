# P10 Billing Provisional Finalize Verification

**Checkpoint:** CDB-108

**Date:** 2026-07-24

**Branch:** `fix/canonical-billing-provisional-finalize-20260723`

**Base local main:** `439414b731439aa3c6885c240408fb0bc13b1b81`

**Implementation head before evidence commit:** `151624c86`

**Production mutation authorization:** false

## Verdict

`billing-provisional.finalize` is implemented and verified locally for the existing provisional-billing settlement modes:

- credit invoice;
- partial direct payment;
- full direct payment;
- deposit-only settlement;
- deposit plus direct payment;
- remaining due balance after either settlement source.

The boundary is registered as `integrated` and uses `issueInvoiceWithSettlement`. Guarded legacy bill, item, payment, deposit, scheme and accounting authority commits with canonical invoice, optional payment and oldest-first deposit applications through one strict financial mutation boundary.

No production deploy, migration application, backfill, feature-flag change, traffic change, production observation, rollback or tenant-data mutation was performed.

## Implementation commits

- `a7447e5d8` — design and implementation plan;
- `1b50972dd` — reusable atomic invoice settlement command;
- `93ff41f61` — deterministic provisional financial projection;
- `4f3c6e833` — guarded legacy provisional finalization adapter;
- `4da6504dd` — strict route and post-commit integration;
- `151624c86` — evidence, compatibility and registry hardening.

## Reusable invoice settlement command

`issueInvoiceWithSettlement` creates one new canonical invoice directly in its final settlement state. It accepts:

- one complete invoice authority;
- zero or one direct payment authority;
- zero or one aggregate deposit-application request;
- one combined command idempotency key;
- optional authoritative legacy statements supplied by the strict coordinator.

For invoice total `T`, deposit settlement `D` and direct payment `P`, the canonical invoice is inserted as:

```text
paid_minor      = D + P
due_minor       = T - D - P
credited_minor  = 0
net_due_minor   = T - D - P
```

The command rejects settlement greater than the invoice total. A non-cash tender requires external transaction/reference authority. A cash tender requires a cash-custody event identity.

### Direct payment authority

When direct payment is present, the same transaction inserts:

- one posted payment receipt;
- one captured tender;
- one active allocation to the new invoice;
- invoice and payment source mappings;
- one `canonical.payment.receipt.posted` event;
- one `canonical.cash_custody.collection_recorded` event for cash only.

A fully paid card regression verifies:

- `paid_minor = total_minor`;
- `due_minor = 0`;
- the external card transaction is stored;
- no cash-custody event is emitted.

### Deposit authority

When deposit settlement is requested, the command loads available canonical deposits for the same tenant, patient and currency and allocates them deterministically by:

```text
received_at_utc ASC, deposit_public_id ASC
```

One aggregate legacy adjustment can therefore produce several canonical deposit-application slices. Each slice records:

- its own deterministic application public ID;
- the source deposit;
- amount applied;
- deposit balance before and after;
- sequential invoice paid/due/net-due snapshots;
- one source mapping;
- one `canonical.deposit.applied` event;
- one slice-specific evidence SHA-256.

Every deposit update requires the exact preflight `applied_minor`, `refunded_minor` and `available_minor` values. A concurrent deposit use changes zero rows, causes the application balance guard to fail and rolls back both legacy and canonical writes.

Canonical deposit insufficiency is detected before authoritative legacy statements execute. The command does not create, infer or repair missing canonical deposit authority from the aggregate legacy balance.

### Idempotency

The command uses `canonical.invoice.issue_settlement` and one combined request hash. Tests prove:

- same request replays without duplicate invoice, receipt or application rows;
- changed settlement under the same key raises an idempotency conflict;
- authoritative legacy statements roll back when canonical settlement fails.

## Provisional invoice projection

`buildProvisionalInvoiceProjection` uses the established live-bill identities:

- invoice source type: `legacy_live_bill`;
- invoice source public ID: legacy invoice number;
- line source type: `legacy_live_bill_line`;
- ordered line identity from invoice number, category and reference authority.

This keeps payment recovery, compensation and reporting compatible with other live-bill paths.

Each provisional item is projected as positive financial `other_adjustment` authority. The projection does not fabricate a canonical service event from `reference_id`, doctor ID or manual-item data.

For each item, it verifies:

```text
(unit price × quantity) - item discount = item net total
```

The invoice contains:

- one gross financial line per provisional item;
- one aggregate negative item-discount line when item discounts exist;
- one negative global-discount line when the finalization request includes a header discount.

The line sum must equal the legacy invoice total exactly and remain positive.

Manual and catalog items retain patient, visit, admission, department, doctor and reference evidence without claiming clinical service-delivery authority.

### Payment-method projection

The projection maps existing methods to canonical tender authority:

- cash;
- card;
- mobile wallet for bKash, Nagad and Rocket;
- bank transfer for bank, bank transfer and cheque;
- gateway for online/gateway methods;
- other.

Optional request aliases are supported:

- `external_transaction_id`;
- `externalTransactionId`.

Strict canonical projection requires non-cash transaction/reference authority. The projection is constructed inside the canonical callback, so disabled and shadow modes preserve existing legacy behavior under the coordinator policy.

## Guarded legacy authority

`prepareProvisionalBillingLegacyStatements` places a `canonical_financial_batch_assertions` check after every critical legacy statement:

1. bill insert;
2. each invoice-item insert;
3. each provisional-item transition;
4. optional scheme discount allocation;
5. optional payment insert;
6. optional employee cash transaction;
7. optional deposit adjustment;
8. bill-created accounting event;
9. optional payment-received accounting event;
10. optional patient-deposit-adjusted accounting event;
11. assertion cleanup.

The bill, payment and deposit adjustment identities use guarded `NOT EXISTS` checks. Accounting events use `INSERT OR IGNORE` followed by expected changes equal to one. Duplicate authority therefore fails closed instead of silently succeeding.

### Exact provisional snapshot

Each provisional transition requires the route snapshot to remain unchanged across:

- tenant and patient;
- admission and visit;
- category, description and department;
- unit price and quantity;
- discount and net total;
- doctor ID and doctor name;
- reference ID;
- provisional status;
- active status.

Real SQLite tests independently change price, quantity, discount, net total, status, patient, visit, category, description, doctor and reference. Every variant rolls back the entire bill/payment/deposit/accounting batch.

Legacy source text is compared and written exactly. Non-blank category, description, department and doctor-name values with surrounding whitespace remain valid historical authority rather than being normalized or rejected during finalization.

Legacy direct-write governance allowances for `bills`, `invoice_items` and `payments` moved from the route file to the focused guarded adapter.

## Route integration

`POST /billing-provisional/pay` invokes `executeStrictFinancialMutation` with boundary `billing-provisional.finalize`.

- Disabled mode executes the guarded legacy batch.
- Shadow mode preserves legacy authority and attempts canonical projection non-blockingly.
- Strict mode passes the same guarded legacy statements as authoritative statements to `issueInvoiceWithSettlement`, so both authorities commit or roll back together.

The route preserves existing response fields:

- `bill_id`;
- `invoice_no`;
- `total`;
- `deposit_deducted`;
- `paid`;
- `due`;
- `status`;
- `items_count`.

Disabled and shadow modes use the authoritative first batch result for the inserted bill ID. Strict mode falls back to the committed bill lookup by tenant and invoice number.

Nested canonical settlement failures are inspected through a bounded cause chain and converted to a safe 409. The response does not expose SQL, constraint names, evidence hashes or canonical internal IDs.

## Accounting and post-commit behavior

Legacy bill-created, payment-received and deposit-adjusted accounting events are inserted inside the guarded financial batch. Post-commit duplicate event creation was removed.

Canonical outbox processing produces:

- invoice voucher: debit accounts receivable, credit patient revenue;
- direct-payment voucher: debit cash/bank/wallet, credit accounts receivable;
- deposit-application voucher: debit patient-deposit liability, credit accounts receivable;
- cash-custody posting for cash only.

A combined invoice, deposit and direct-payment regression verifies that net accounts receivable equals the final canonical invoice due.

The following remain after the financial commit:

- doctor payable accruals for provisional items;
- diagnostic performer reserves and doctor commission processing;
- scheme usage recording;
- audit log;
- accounting worker scheduling.

`recordBillFinalizationSideEffects` receives `skipBillAccountingEvent: true`, preserving commission/reserve behavior while preventing duplicate legacy bill-created accounting authority.

## Adversarial findings fixed

### 1. Shadow compatibility for non-cash authority

The initial route draft built strict canonical payment projection before the coordinator. Missing non-cash reference authority would therefore have blocked disabled and shadow legacy behavior. Projection construction moved inside the canonical callback. Shadow failures are now recorded by the coordinator without reversing committed legacy authority.

### 2. Nested strict conflict classification

Strict coordinator failures wrap the canonical cause. Top-level message matching could return an internal 500 instead of a safe conflict. A bounded cause-chain classifier now recognizes settlement, deposit, reconciliation and idempotency conflicts and returns a safe 409.

### 3. Legacy/shadow bill-ID recovery

The production-compatibility mock does not persist batch inserts for a later lookup. The route initially returned 500 after a successful legacy batch. The route now consumes the authoritative first batch `last_row_id` outside strict mode and retains the committed lookup fallback for strict mode. Existing compatibility tests pass.

### 4. Deposit-application evidence binding

The initial command reused invoice evidence for deposit applications. A failing regression proved that two deposit slices had identical invoice evidence. Each application and source mapping now receives a unique evidence digest bound to adjustment number, slice number, source deposit, amount and before/after balances.

### 5. Historical source-text preservation

The guarded adapter originally applied canonical no-surrounding-whitespace validation to database-origin category, description, department and doctor name. A failing regression proved that exact historical values could be rejected. Source text now requires non-blank content while preserving the raw value for comparison and write authority.

No unresolved Critical or High review finding remains for CDB-108.

## Fresh verification

### Focused financial and route suite

```text
Test Files  9 passed (9)
Tests       95 passed (95)
```

Covered:

- atomic invoice settlement command;
- provisional invoice and settlement projection;
- guarded legacy finalization;
- strict coordinator behavior;
- route and scheme integration;
- production compatibility;
- accounting reconciliation;
- financial route registry.

### Full canonical suite

```text
Test Files  116 passed (116)
Tests       835 passed (835)
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
466 migrations generated
```

No schema migration was introduced by CDB-108.

### Production build

```text
pnpm build
exit 0
```

The build emitted existing Vite chunk-size and deprecation warnings only; no build failure occurred.

## Deployment prerequisite

Existing canonical migrations through the current 466-entry manifest must be applied before strict provisional billing is activated. This local verification does not authorize deployment, migration, backfill, flag change, production observation or any production operation.

## Remaining runtime writer boundary

`billing-provisional.finalize` is removed from the remaining list. The next checkpoint is:

- `ipd-discharge.billing.finalize`

The reusable invoice settlement command is available for the IPD checkpoint. IPD discharge still requires its own reviewed atomic design because it combines invoice, direct payment, deposit application and conditional deposit-refund/discharge authority.

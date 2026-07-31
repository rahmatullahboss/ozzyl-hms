# Canonical IPD Discharge Billing Finalize Design

**Checkpoint:** CDB-109

**Date:** 2026-07-24

**Target boundary:** `ipd-discharge.billing.finalize`

## Goal

Make IPD discharge billing a reviewed strict financial boundary where the legacy discharge state and all canonical financial/encounter authority either commit together or roll back together.

The design must support the current route modes:

- settled credit invoice with no direct payment;
- partial or full direct payment;
- deposit-only settlement;
- deposit plus direct payment;
- excess requested deposit refunded at discharge;
- credit-pending discharge with a higher-authority approval request;
- package, bed-charge and provisional-item invoice lines;
- admission discharge and bed release in the same legacy transaction.

No production mutation, migration application, flag change, backfill, deployment or cutover is authorized by this design.

## Existing boundary

`POST /ip-billing/discharge-bill` currently performs one large legacy D1 batch containing:

- bill creation;
- discount allocations;
- invoice items;
- provisional-item finalization;
- package line creation;
- bed-charge line creation and bed-info finalization;
- deposit adjustment;
- optional excess-deposit refund and cash out;
- optional direct payment and employee cash transaction;
- optional credit-discharge approval request, event and notifications;
- admission discharge;
- bed transition to cleaning;
- remaining bed-info closure.

After that batch, accounting events, canonical cash shadow, doctor accruals and IPD ledger rows are created separately. This means strict canonical authority cannot currently join the legacy serialization point.

## Design decision

Use a new IPD-specific composite canonical command rather than sequential canonical commands.

### Rejected approach 1: sequential existing commands

Calling invoice settlement, deposit refund and encounter completion one after another can partially commit canonical authority. A later refund or encounter failure could leave a posted invoice without the matching discharge completion.

### Rejected approach 2: expand the generic invoice settlement command with IPD behavior

Adding discharge, encounter, bed-stay and refund behavior directly to `issueInvoiceWithSettlement` would make a reusable billing command depend on IPD-specific clinical and operational concerns.

### Selected approach: reusable statement preparation plus one IPD composite command

Refactor reusable settlement preparation from `issueInvoiceWithSettlement`, then build `finalizeIpdDischargeBilling` as one canonical command batch. The composite command will include:

1. invoice and line authority;
2. optional direct payment authority;
3. optional deposit application authority;
4. optional deposit refund authority;
5. explicit invoice-to-encounter authority;
6. inpatient encounter completion;
7. active bed-stay completion;
8. one combined command idempotency record;
9. canonical outbox events for all financial and encounter facts;
10. guarded legacy authoritative statements supplied by the strict coordinator.

## Canonical schema addition

Add `canonical_invoice_encounter_links`.

Required columns:

- `tenant_id`;
- `invoice_public_id`;
- `encounter_public_id`;
- `legacy_admission_id`;
- `link_type`, fixed to `discharge_invoice` for CDB-109;
- `source_evidence_sha256`;
- timestamps.

Required constraints:

- invoice and encounter tenant-composite foreign keys;
- unique invoice link per tenant;
- unique discharge invoice per encounter where `link_type='discharge_invoice'`;
- positive `legacy_admission_id`;
- 64-character evidence digest.

This link is canonical authority, not a new legacy cross-link. It lets IPD reporting include discharge invoices whose package, bed or manual charges do not have service-event lines.

## IPD projection update

`projectCanonicalIpdAdmission` will load explicitly linked posted invoices first.

- Explicit invoice–encounter links are authoritative.
- Existing service-event inference remains as compatibility fallback for older invoices.
- A linked invoice is not re-added through inference.
- Mixed-encounter detection remains for inferred invoices.
- Explicitly linked discharge invoices may contain adjustment-only lines without fabricating service events.

## Composite settlement arithmetic

Let:

- `T` = final invoice total;
- `D` = deposit applied to the invoice;
- `P` = direct payment;
- `R` = excess deposit refunded;
- `Q` = requested deposit amount from the discharge request.

The route already calculates:

```text
D = min(Q, T)
P = min(max(T - D, 0), requested direct payment)
R = max(Q - T, 0)
```

The composite command requires:

```text
D + P <= T
D + R = Q
invoice.paid_minor = D + P
invoice.due_minor = T - D - P
invoice.net_due_minor = T - D - P
```

For settled discharge, final due must be zero. For credit-pending discharge, due must be positive and the guarded legacy batch must include the pending approval authority.

## Deposit allocation and refund

Load canonical deposits once for the same tenant, patient and currency.

Allocate in deterministic order:

```text
received_at_utc ASC, deposit_public_id ASC
```

Apply settlement first, then refund from the remaining balances. This matches the discharge request semantics: the requested deposit amount is consumed as invoice application plus optional cash refund.

Every slice must record exact before/after balances and use compare-and-swap updates against:

- `applied_minor`;
- `refunded_minor`;
- `available_minor`;
- posted status.

A concurrent deposit use must make a guard fail and roll back the legacy discharge batch, invoice, payment, refund and encounter completion.

Cash deposit refund emits both:

- `canonical.deposit.available_refunded`;
- `canonical.cash_custody.refund_recorded`.

## Encounter and bed-stay completion

The command resolves the inpatient encounter through `canonical_encounter_admission_links` using the exact tenant and legacy admission ID.

It requires:

- active link status;
- inpatient encounter type;
- matching legacy patient;
- encounter status `in_progress`;
- no existing end timestamp.

The same batch updates the encounter to:

- `status='completed'`;
- exact normalized discharge timestamp;
- updated evidence and timestamp.

All active canonical bed stays for the encounter are updated to:

- `status='completed'`;
- the same discharge timestamp;
- updated evidence and timestamp.

A reconciliation guard verifies no active bed stay remains for the encounter after the update.

If the encounter link is missing, ambiguous, already completed or patient-mismatched, strict mode fails closed. Shadow mode records the canonical failure without undoing legacy authority under the existing coordinator policy.

## Canonical invoice projection

Create `buildIpdDischargeBillingProjection`.

The projection uses:

- invoice source type `legacy_live_bill`;
- invoice source public ID = legacy invoice number;
- invoice source table `bills`;
- BDT currency;
- the discharge timestamp and business date;
- patient and admission evidence.

Invoice lines are financial authority only unless an exact canonical service event already exists.

CDB-109 does not fabricate service events from provisional IDs, bed IDs, package IDs, doctor IDs or reference IDs.

Line categories:

- provisional item gross lines;
- aggregate provisional item discount line;
- package line;
- one line per bed-charge segment;
- global discharge discount line.

The line sum must equal the final legacy bill total exactly.

## Guarded legacy adapter

Extract the route batch into `prepareIpdDischargeLegacyStatements`.

Every critical write receives a `canonical_financial_batch_assertions` guard:

- bill insert;
- discount allocation inserts;
- invoice-item inserts;
- provisional-item snapshot transitions;
- bed-info snapshot transitions;
- deposit adjustment insert;
- deposit refund insert;
- refund employee cash transaction;
- payment insert;
- payment employee cash transaction;
- credit approval request and approval event;
- admission discharge update;
- bed cleaning update;
- open bed-info closure;
- legacy accounting-event inserts;
- assertion cleanup.

The adapter must preserve exact raw legacy source text while verifying that source rows did not change after preflight.

## Accounting authority

Move legacy bill-created, payment-received, deposit-adjusted and deposit-refunded accounting events into the guarded legacy batch.

After the strict financial commit:

- `recordBillFinalizationSideEffects` remains for commission/reserve behavior with `skipBillAccountingEvent: true`;
- doctor payable accruals remain post-commit;
- canonical/legacy accounting workers are queued;
- canonical cash shadow helper is removed for the integrated direct-payment path because canonical cash custody authority is created in the composite command;
- IPD ledger rows remain supplementary and non-blocking;
- audit log and idempotency completion remain post-commit.

## Error handling

The route maps these failures to a safe HTTP 409:

- stale legacy admission, item or bed snapshot;
- insufficient or concurrently changed canonical deposit;
- missing canonical inpatient encounter authority;
- already completed encounter;
- settlement arithmetic mismatch;
- idempotency mismatch;
- duplicate bill, payment, deposit adjustment or refund authority.

The response must not expose SQL, evidence digests, canonical IDs, constraint names or internal stack traces.

## Verification

Required focused coverage:

- invoice-only credit discharge;
- settled full cash payment;
- full non-cash payment with external authority;
- deposit-only settlement;
- deposit plus payment;
- deposit application plus excess refund;
- refund spanning several deposits;
- stale deposit rollback;
- missing encounter rollback;
- already completed encounter rollback;
- active bed-stay completion;
- explicit invoice–encounter projection;
- legacy stale provisional and bed snapshots;
- duplicate receipt/adjustment/refund identities;
- credit approval and discharge state atomicity;
- shadow compatibility;
- safe nested error mapping;
- accounting receivable and deposit-liability reconciliation;
- route registry integration.

Final gates:

- focused CDB-109 suites;
- full `test/canonical`;
- TypeScript;
- canonical governance;
- migration manifest generation;
- production build;
- adversarial review;
- local merge to `main` only.

## Out of scope

- production deployment or migration application;
- strict-mode activation;
- production observation;
- automatic repair of missing canonical encounters or deposits;
- converting supplementary IPD ledger rows into authority;
- changing credit-discharge approval policy;
- changing legacy response fields;
- historical backfill execution.

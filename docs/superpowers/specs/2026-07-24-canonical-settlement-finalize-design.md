# Canonical Settlement Finalization Design

**Date:** 2026-07-24

**Checkpoint:** CDB-117

**Base:** reviewed local `main` at `d6f45d78ee07a181114c86d6a88689d86d311e96`

**Boundary:** `settlement.finalize`

**Status:** Approved by the user's direct instruction to continue the canonical program from the latest verified local main.

## Problem

`POST /settlements` finalizes one patient settlement across several existing legacy bills. It allocates the requested value in deterministic bill-ID order and, within each bill, applies:

1. cash or other direct payment;
2. patient deposit deduction;
3. approved settlement discount.

The route then updates bill paid/due/status authority, links the bills to a settlement header, creates per-bill payment and deposit rows, records discount allocations, updates credit-bill workflow status, records counter cash, accounting events and audit evidence, and returns the historical settlement receipt response.

The boundary is currently blocked in strict mode because these legacy and canonical facts are not committed by one reviewed atomic command. Separate calls to `collectPayment()`, `applyDeposit()` and `issueCreditNote()` cannot provide strict atomicity and cannot safely compose from the same initial invoice snapshot.

## Scope

CDB-117 integrates only the registered `settlement.finalize` boundary represented by `POST /settlements`.

`PUT /settlements/:id/cancel` is a separate legacy reversal workflow. It is not represented by this boundary's audited writer contract and will not be silently relabeled as canonical. CDB-117 neither changes nor claims completion of settlement cancellation.

No production deploy, migration, backfill, feature-flag change, traffic change, tenant-data mutation or legacy retirement is included.

## Existing behavior that must remain exact

Disabled and shadow modes preserve:

- role and discount-approval checks;
- request-idempotency replay, mismatch and failed-state behavior;
- selected-bill count and patient ownership checks;
- high-discount referral-name policy;
- non-zero and no-overpayment checks;
- legacy deposit-balance validation;
- accounting-period and active-counter checks;
- settlement receipt sequence format;
- bill-ID sorting;
- cash → deposit → discount allocation order;
- one payment receipt `${settlementReceipt}-B${billId}` per cash-applied bill;
- one legacy deposit-adjustment receipt `${settlementReceipt}-DAD-B${billId}` per deposit-applied bill;
- one discount identity `${settlementReceipt}-DISC-B${billId}` per discounted bill;
- settlement header, bill status/link, credit-bill status, cash transaction, accounting-event and audit writes in the original batch;
- accounting queue and cash-ledger shadow behavior after commit;
- response `{ id, receipt_no, message: 'Settlement created' }`.

Shadow canonical failure must record `CANONICAL_SHADOW_WRITE_FAILED` and must not change the committed legacy response.

## Considered approaches

### A. Dedicated composite command with one settlement planner — recommended

Create one multi-bill command that loads the mapped canonical invoice and deposit snapshots, calculates the exact working balances, prepares payment/deposit/credit-note facts, and submits one outer canonical batch. Strict authoritative legacy statements are placed in that same outer batch.

Advantages:

- one idempotency envelope;
- one atomic transaction;
- exact cash → deposit → discount working-state order;
- optimistic guards can cover every invoice and deposit race;
- natural source mappings can prove the matching committed legacy rows;
- limited change to generic canonical commands.

Trade-off: the command must reproduce the existing canonical payment, deposit-application and credit-note invariants internally. Tests must compare those invariants closely to the generic commands.

### B. Refactor all three generic commands into mutable batch builders

Expose preparation APIs from `collectPayment()`, `applyDeposit()` and `issueCreditNote()` that accept and return shared mutable invoice/deposit snapshots.

Advantages: maximum implementation reuse.

Trade-offs: broad changes to three mature commands and their callers; complex cross-command snapshot contracts; significantly larger regression surface for the final P11 boundary. This is disproportionate to the settlement task.

### C. Run separate canonical commands after the legacy batch

This matches simple shadow projection but cannot make strict legacy and canonical authority atomic. A later component can fail after earlier canonical facts commit. Rejected.

## Decision

Use approach A: a dedicated `finalizeSettlement()` composite command and a split original/strict legacy adapter.

Generic command semantics remain the reference model, but existing public command APIs are not refactored in CDB-117.

## Components

### `src/lib/canonical/commands/finalize-settlement.ts`

Owns canonical multi-invoice settlement authority.

Input contains:

- tenant, patient, settlement receipt and command idempotency identity;
- occurrence UTC and business date;
- collector, counter and counter-session identity;
- payment method;
- one ordered bill plan per selected bill;
- mapped canonical invoice identity and exact pre-settlement invoice snapshot;
- cash, deposit and discount minor amounts per bill;
- deterministic source identities for the legacy settlement/payment/deposit/discount rows;
- strict authoritative statements supplied by the coordinator.

Result contains:

- settlement public ID and receipt number;
- total cash, deposit and discount minor amounts;
- final canonical balance per invoice;
- created payment receipt IDs;
- deposit application fragments;
- credit-note IDs.

### `src/lib/canonical/settlement-finalization.ts`

Owns legacy and strict compatibility preparation.

It provides:

- `executeSettlementOriginalLegacy()`;
- `prepareSettlementStrictContext()`;
- `prepareSettlementStrictStatements()`;
- shared pure cash/deposit/discount allocation planning;
- source-row resolution data for post-commit response and side effects.

### `src/routes/tenant/settlements.ts`

Remains responsible for:

- HTTP authorization and request validation;
- request idempotency reservation/completion;
- common business-policy checks;
- accounting-period and billing-counter checks;
- coordinator invocation;
- accounting posting queue;
- cash-ledger shadow write;
- response and failed-idempotency behavior.

The route will no longer own settlement financial mutation SQL.

## Canonical financial model

Legacy `bills.paid` includes cash, deposit and discount. Canonical authority separates them:

- cash/direct payment increases `paid_minor` and reduces `due_minor` and `net_due_minor`;
- deposit application increases `paid_minor`, reduces deposit `available_minor`, and reduces invoice `due_minor` and `net_due_minor`;
- settlement discount creates a posted canonical credit note, increases `credited_minor`, and reduces `net_due_minor` without increasing `paid_minor`.

For each invoice after all components:

```text
canonical due = original due - cash - deposit
canonical net due = canonical due - existing credits - settlement discount
legacy due = original legacy due - cash - deposit - discount
```

The final legacy due must equal canonical net due in minor units.

## Payment authority

Each cash/direct-payment allocation creates one canonical payment receipt matching the legacy per-bill receipt number.

The receipt contains:

- one captured tender using normalized payment method/type;
- one allocation to the mapped canonical invoice;
- zero unallocated balance;
- collector/counter/session evidence;
- a cash-custody outbox event only when the tender type is cash;
- a source mapping that requires the actual committed legacy `payments` row with the exact tenant, bill, amount, receipt number, method, collector and counter/session evidence.

## Deposit authority

Strict preparation loads posted canonical deposits for the patient in FIFO order by `received_at_utc, deposit_public_id`.

The total available canonical balance must exactly equal the active legacy deposit balance observed for the same patient. This prevents strict mode from spending an incomplete or excess canonical deposit pool.

Each per-bill legacy adjustment may be split across several canonical deposit sources. Every fragment creates:

- a canonical deposit application;
- optimistic deposit and invoice updates;
- a deterministic application identity derived from settlement receipt, bill, source deposit and fragment order;
- a source mapping identity derived from the legacy adjustment receipt plus fragment number;
- a guard proving the actual legacy `billing_deposits` adjustment row committed for the expected tenant, patient, bill, amount, receipt and settlement counter/session.

The sum of fragments for one legacy adjustment must equal that adjustment amount.

## Discount authority

Each discounted bill creates one posted canonical credit note and one credit-note line.

The credit-note number is the existing settlement discount identity `${settlementReceipt}-DISC-B${billId}`.

The credit note:

- uses the route's normalized reason code;
- records the exact per-bill discount minor amount;
- preserves reference-name and note evidence in its source evidence hash;
- applies the same compensation-safety checks as canonical credit-note issuance;
- updates the canonical invoice's credited and net-due balances optimistically;
- maps only when an actual committed `bill_discount_allocations` row exists for the matching settlement and bill.

Strict mode therefore fails closed when a paid performer/doctor compensation settlement makes the discount unsafe. Shadow mode records a canonical issue while preserving legacy success.

## Settlement identity

The outer command creates a deterministic canonical settlement public ID and one canonical outbox event. No new settlement table is required; the immutable outer command envelope plus child receipt/application/credit-note facts and source mappings provide the canonical operation identity.

A source mapping for the outer operation requires the actual active `billing_settlements` row with the exact receipt, patient, component totals, payment mode, counter and counter-session evidence.

## Strict preflight

Before settlement sequence allocation, strict mode verifies:

- every requested bill is unique, tenant-owned and belongs to the patient;
- bill total, paid, due, status and settlement link exactly match the route snapshot;
- every bill has one mapped posted canonical invoice;
- mapped invoice patient and currency match;
- canonical total matches legacy total;
- canonical paid/credited/net-due state reconciles to the legacy pre-settlement due;
- requested cash/deposit/discount components reconcile exactly to the settlement totals;
- payment does not exceed canonical outstanding balances;
- active legacy deposit balance equals active canonical deposit availability;
- canonical deposits cover the requested deposit deduction;
- the active billing counter/session still belongs to the collector and workstation evidence.

Only after these checks is the settlement receipt sequence allocated.

Disabled and shadow modes do not touch canonical schema during legacy preparation.

## Strict compatibility batch

The guarded strict statement set reproduces the original batch but adds exact predicates and one-row assertions for critical writes:

- settlement header insert;
- every bill update from its exact prior financial state;
- every payment insert;
- every deposit-adjustment insert;
- every discount-allocation insert;
- each selected credit-bill completion when a matching pending row exists;
- aggregate counter cash insert when applicable;
- accounting posting events;
- audit log.

The bill update predicate rechecks tenant, patient, total, paid, due, status and null settlement link. Payment/deposit/discount source rows use deterministic receipt/source identities and exact uniqueness guards.

Optional credit-bill rows remain optional as in the original flow; strict mode must not require one to exist for every selected bill.

All assertion rows are cleared before commit.

## Composite command transaction order

One `runCanonicalBatch()` submits:

1. outer command claim/outbox;
2. strict authoritative legacy statements, when strict;
3. canonical payment receipt/tender/allocation facts and invoice updates;
4. canonical deposit applications and deposit/invoice updates;
5. canonical credit notes/lines and invoice credit updates;
6. receipt, deposit and credit reconciliation guards;
7. child outbox events;
8. source mappings tied to actual committed legacy rows;
9. financial assertion cleanup.

A failure anywhere rolls back the entire strict settlement, including the command claim and legacy accounting events.

## Shadow behavior

Shadow mode commits `executeSettlementOriginalLegacy()` first. The canonical callback then requires compatible existing canonical invoice and deposit authority.

CDB-117 does not invent or mutate missing historical invoice/payment/deposit history before the current settlement. Missing or inconsistent canonical authority causes a recorded shadow issue; it does not alter the legacy success response.

This limitation is deliberate: reconstructing arbitrary prior mixed cash/deposit/discount history belongs to backfill/reconciliation, not a live settlement command.

## Idempotency

The existing HTTP request-idempotency contract remains the first replay layer.

The canonical command uses a deterministic key derived from tenant and settlement receipt. Child identities are deterministic from the same receipt and bill/source IDs.

Identical canonical evidence replays. Reusing the command key with changed patient, bills, components, payment method, counter/session or source evidence raises a canonical idempotency conflict.

## Error behavior

- Disabled: historical behavior and errors remain.
- Shadow: legacy result remains authoritative; canonical failure records an issue.
- Strict preflight/atomic failure: sanitized HTTP `409`, no settlement or canonical partial state.
- Existing request-policy errors remain `400`, `403` or `409` as today.
- Post-commit accounting queue and cash-ledger behavior remains outside the financial batch and retains its existing route semantics.

## Tests

### Composite command SQLite tests

- cash-only settlement across several invoices;
- deposit-only FIFO application across several sources/invoices;
- discount-only credit notes;
- mixed cash → deposit → discount allocation;
- pre-existing invoice credits;
- deterministic replay and changed-evidence conflict;
- authoritative legacy statement failure rolls back canonical facts;
- invoice balance race rollback;
- deposit balance race rollback;
- missing/inactive mapping rejection;
- compensation-safety rejection;
- actual-source mapping rejection when settlement/payment/deposit/discount source rows do not match.

### Adapter SQLite tests

- exact original statement order and source receipt rules;
- original executor contains no canonical/assertion SQL;
- strict pre-sequence rejection;
- exact bill-state race rollback;
- counter/session race rollback;
- payment/deposit/discount insert conflict rollback;
- production accounting-event behavior;
- optional credit-bill status behavior;
- assertion cleanup.

### Route tests

- blocker removed and coordinator used;
- mutation SQL removed from route handler;
- shadow canonical failure preserves `201` and records issue;
- strict missing canonical invoice/deposit authority rejects before sequence/mutation;
- strict mixed settlement commits legacy and canonical facts in one batch;
- existing response, idempotency, counter, discount and tenant contracts remain.

### Governance

- mark `settlement.finalize` integrated with command `finalizeSettlement`;
- remove it from the alternate-writer blocked list;
- add only narrow adapter ownership allowances;
- add cross-route shadow-isolation contract;
- update continuation tracker so no registered P11 runtime boundary remains.

## Completion criteria

CDB-117 is complete locally only when:

- focused settlement tests pass;
- all canonical tests pass;
- TypeScript passes;
- canonical governance reports zero issues;
- migration manifest is deterministic;
- web, patient and admin production builds pass;
- the task branch is reviewed and replayed onto the latest clean local main;
- the same verification passes again on local main;
- no push, deploy or production mutation occurs.

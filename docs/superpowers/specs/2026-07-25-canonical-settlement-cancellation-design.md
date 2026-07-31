# Canonical Settlement Cancellation Design

**Date:** 2026-07-25  
**Task:** settlement cancellation/reversal authority audit and strict canonical integration  
**Reviewed base:** local `main` at `ca536f03d`  
**Production authorization:** none; this task is local-only

## 1. Scope

This design covers `PUT /api/tenant/settlements/:id/cancel` after CDB-117 integrated `settlement.finalize`.

CDB-117 intentionally excluded cancellation. This task does not infer canonical authority from that earlier completion. It audits the current legacy route and introduces a separate strict boundary, `settlement.cancel`, only after exact evidence and atomicity requirements are met.

Out of scope:

- production migration, backfill, flag, traffic, observation, or tenant mutation;
- cancellation of settlements that were not canonically finalized and mapped;
- partially reversed settlement children;
- automatic recovery of already-paid practitioner compensation;
- changing disabled or shadow HTTP response shape.

## 2. Legacy workflow audit

The reviewed legacy route currently:

1. validates role, active counter/session, and accounting period;
2. loads an active `billing_settlements` row and linked `bills`;
3. reconstructs cash and deposit allocations with receipt-prefix `LIKE` queries;
4. reconstructs discounts from `accounting_posting_events`, with a heuristic fallback when evidence is missing;
5. rolls back bill paid/due/status/settlement linkage;
6. hard-deletes settlement-created `payments`, deposit adjustments, cash transactions, and accounting events;
7. returns related credit-bill status to Pending;
8. marks the settlement inactive and inserts an audit log;
9. commits the above in one legacy batch.

### Audited authority gaps

- receipt-prefix matching can admit unrelated evidence;
- discount fallback can reverse an amount without immutable source evidence;
- bill and settlement updates are not guarded against stale balances;
- hard-delete of a posted accounting event leaves its verified voucher in place;
- canonical payment receipts, tenders, allocations, deposit applications, credit notes, invoice projections, and settlement mapping remain authoritative after legacy cancellation;
- prior partial reversal, replay, duplicate source mapping, processing races, and paid compensation are not rejected consistently.

## 3. Mode contract

### Disabled

Execute the reviewed legacy workflow unchanged. Preserve status codes, response body, mutation ordering, heuristic behavior, and best-effort post-commit behavior.

### Shadow

Execute the reviewed legacy workflow unchanged and return the same response. A strict snapshot may be prepared before the legacy batch only for the non-authoritative canonical shadow attempt. Any snapshot or canonical failure is recorded through the existing shadow issue mechanism and must not change the legacy response.

### Strict

Require exact legacy and canonical evidence before mutation. Commit guarded legacy authority and canonical reversal authority in the same `runCanonicalBatch` call. Any failed guard rolls back both sides.

## 4. Strict eligibility and exact evidence

Strict cancellation is eligible only when all of the following hold:

- exactly one active legacy settlement exists for tenant and requested ID;
- exactly one mapped canonical settlement exists for the settlement receipt;
- no conflicting mapped settlement source exists;
- every linked bill has exactly one mapped canonical invoice and no conflicting invoice mapping;
- current legacy bill balances and canonical invoice balances reconcile to the post-settlement state;
- every cash child has the exact expected payment receipt number and mapped canonical receipt/tender/allocation;
- every deposit child has the exact expected deposit adjustment receipt and all mapped canonical deposit-application fragments;
- every discount child has exact `bill_discount_allocations` evidence and a mapped posted canonical credit note;
- child totals reconcile exactly to the settlement header;
- settlement-created cash ledger/counter rows reconcile exactly when cash exists;
- all expected accounting posting events exist and their source identity, payload amount, bill, patient, and settlement receipt reconcile;
- no expected accounting event is currently `processing`;
- no canonical or mapped legacy practitioner compensation has `settled_minor > 0` or paid status;
- no payment allocation, tender, receipt, deposit application, or credit note has already been partly or fully reversed.

Missing or ambiguous evidence is a strict error. Strict mode never uses prefix inference or heuristic discount reconstruction.

## 5. Canonical reversal authority

A dedicated composite command, `cancelSettlement`, owns the reversal. Existing commands are not called serially because that would create false atomicity. Their reviewed invariants are reused inside one command batch.

For each bill, the command:

1. reverses the exact settlement credit note by changing it from `posted` to `reversed` and restoring invoice credited/net-due projection;
2. reverses every exact active deposit application, restores deposit applied/available projection, and restores invoice paid/due/net-due projection;
3. inserts immutable payment reversal and refund facts for the exact full remaining payment allocation, reverses allocation/tender/receipt projections, and restores invoice paid/due/net-due projection;
4. requires the resulting canonical invoice to equal the pre-settlement canonical snapshot;
5. records deterministic source mappings and one canonical settlement-cancelled outbox event.

The outer settlement mapping remains immutable. A new deterministic `settlement_cancellation` mapping and command receipt prove cancellation authority.

## 6. Legacy authoritative statements in strict mode

Strict legacy statements use exact identities and compare-and-swap predicates:

- bill updates require the exact linked settlement and current paid/due/status values;
- payment/deposit/discount rows require exact receipt/allocation identity and amounts;
- counter cash deletion requires exact settlement reference, amount, user, counter, and session;
- credit-bill status reset requires exact settlement and Completed state;
- settlement deactivation requires exact active header values;
- an audit row is inserted with exact before/after evidence;
- financial batch assertions require the expected number of changed rows.

No broad route allowlist is added.

## 7. Accounting event and voucher handling

Strict cancellation distinguishes unposted and posted accounting authority:

- `pending`, `failed`, `dead_letter`, or `approved` settlement-created events are deleted with exact guards so they cannot later post;
- `processing` events fail closed because posting is racing the cancellation;
- `posted` events and verified vouchers are preserved. For each posted voucher, strict cancellation inserts a deterministic `manual_journal` posting event whose lines are the exact original journal lines with debit and credit swapped. The reversal event is inserted in the same atomic batch as legacy and canonical cancellation authority.

This avoids deleting evidence while leaving an unreversed voucher.

## 8. Idempotency and replay

The command key is deterministic from tenant and settlement receipt. The request fingerprint includes settlement identity, exact child identities and amounts, cancellation reason, timestamp, and business date.

- identical canonical command replay returns the stored result without a second mutation;
- a reused key with changed semantics raises a canonical idempotency conflict;
- route-level disabled/shadow replay behavior remains the reviewed legacy 404 behavior;
- strict replay may return the original success response only when the inactive settlement and stored canonical command receipt reconcile exactly.

## 9. Race and rollback guarantees

Every mutable strict statement is guarded by the audited pre-mutation snapshot. Financial batch assertions convert zero-change stale writes into a batch failure. The same D1 batch contains:

- strict legacy authoritative statements;
- canonical reversals and projections;
- canonical mappings and command receipt;
- canonical outbox event;
- accounting reversal-event intent.

Therefore stale bill balances, concurrent settlement cancellation, child reversal races, accounting processing races, and canonical conflicts roll back the entire strict mutation.

## 10. Governance ownership

Add only `settlement.cancel` to strict financial boundaries and financial route coverage. The coverage entry names the dedicated route, adapter, command, tables, tests, and report. Legacy disposition changes are limited to exact settlement cancellation ownership; unrelated route/table access remains unchanged.

## 11. Required tests

TDD coverage must include:

- exact cash, deposit, discount, and mixed reversal;
- atomic authoritative legacy + canonical commit and rollback;
- exact idempotent replay and semantic conflict;
- duplicate source mapping rejection;
- missing payment/deposit/discount/accounting evidence rejection;
- stale legacy bill and stale canonical invoice/deposit/payment balances;
- prior partial payment reversal and reversed deposit/credit child rejection;
- paid canonical compensation and paid mapped legacy compensation rejection;
- accounting `processing` race rejection;
- posted-voucher manual-journal reversal intent;
- disabled/shadow route response parity;
- route strict integration and narrow governance ownership.

## 12. Verification

Run focused tests, full canonical suite, TypeScript, governance, migration manifest, task/main worktree policy, diff checks, and web/patient/admin production builds. Integrate reviewed task commits only onto the latest clean local `main`, re-run current-main verification, and record exact receipts in the task report and `task-progress.yaml`.

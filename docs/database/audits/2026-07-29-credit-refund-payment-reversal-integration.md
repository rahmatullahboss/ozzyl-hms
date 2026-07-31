# CDB-V1-030K credit, refund and payment reversal integration audit

**Date:** 2026-07-29
**Checkpoint:** `CDB-V1-030K-CREDIT-REFUND-PAYMENT-REVERSAL-INTEGRATION-VERIFIED`
**Branch:** `program/cdb-main-continuous-20260725`
**Scope:** local protected-core implementation and repository evidence only

## Result

The five remaining credit/refund/payment-reversal writer pairs now cross reviewed Canonical commands or guarded atomic compatibility boundaries:

- refund cash-hold workflow creation, consumption, settlement and historical release helpers;
- refund-dispute cash-hold lifecycle updates;
- gateway-payment `income` compatibility projection;
- executed-refund legacy credit-note reversal; and
- payment-void `income` compatibility projection.

No new refund or payment authority was created. Existing Canonical credit-note, cash-refund, cash-refund-reversal and payment-reversal commands remain the only protected-core fact authorities.

## Refund cash-hold workflow

`billing_refund_cash_holds` remains a workflow document. It records custody reservation and resolution state; it is not credit-note, refund, payment-reversal or cash-custody fact authority.

Active executed-refund reversal uses the parent `credit-note.cash-refund.reverse` strict boundary. When returned cash is acknowledged, `prepareSettleExecutedRefundHold` is included in the same authoritative batch as:

- exact legacy invoice/payment restoration;
- legacy credit-note reversal;
- accounting reversal evidence;
- practitioner-compensation restoration;
- cash-return or dispute resolution;
- immutable Canonical cash-refund reversal;
- exact source mapping;
- idempotency receipt; and
- PHI-minimised outbox evidence.

The historical create/release helpers remain only for compatibility/history and existing released rows. They are not used to create a competing Canonical refund fact. Atomic tests prove insufficient cash and concurrent counter-session closure roll back both approval and hold creation. Historical release tests prove a closed destination or already-reviewed approval cannot create a drawer credit.

## Refund-dispute workflow

Refund-dispute lifecycle updates preserve one requester liability and one resolution path. The hold can become disputed, settled after exact cash recovery, or closed through authorized write-off. These are workflow states attached to the Canonical refund/reversal facts.

Executed-refund rejection enforces cash-return/dispute exclusivity:

- acknowledged cash return credits one eligible active drawer, settles the hold and creates no dispute;
- missing returned cash creates one dispute without a second cash-out;
- one reversal cannot remain both cash-returned and disputed; and
- no eligible active source session fails closed before financial mutation.

Cash recovery commits one cash-in, dispute settlement, hold settlement, accounting evidence and refund-compensation release atomically. Authorized write-off closes the liability without fabricating a cash-in. Tests prove exact-once recovery and write-off behavior.

## Gateway income compatibility

`src/lib/canonical/gateway-payment-verification.ts` explicitly accepts only reviewed non-cash bKash/Nagad gateways. Its `income` row remains a temporary reporting compatibility projection inside `payment-gateway.verify`.

The parent `canonical.gateway_payment.settle` command owns receipt, captured gateway tender, invoice allocation, optional deposit liability, source mapping, idempotency and outbox. The strict transaction also owns the guarded gateway log, payment, deposit, compatibility income and accounting-event statements. A stale bill snapshot or gateway-log transition rolls back all writes.

Because these providers are non-cash, the compatibility `income` row never creates a physical cash-custody movement.

## Executed-refund credit-note reversal

`src/lib/executed-refund.ts` invokes `reverseCreditNoteCashRefund` under `credit-note.cash-refund.reverse`. The legacy `billing_credit_notes` status update is therefore an atomic compatibility projection, not the reversal authority.

The Canonical command requires exact invoice, credit note, cash refund, receipt attribution, allocation attribution, tender attribution and cash-custody evidence. It appends an immutable reversal record, restores exact invoice/payment balances, reverses the credit note/refund status and emits cash-recovery-required evidence. Prior posted history remains intact.

Exact replay returns the prior result. Changed replay conflicts. Stale Canonical or compatibility state rolls back the entire batch.

## Payment-void income compatibility

`src/lib/payment-void-execution.ts` keeps the legacy negative `income`/`SalesReturn` row inside the parent `payment.reverse` strict transaction.

`reversePayment` owns the protected payment-reversal facts:

- exact receipt, tender and allocation lineage;
- exact invoice paid/due restoration;
- cash-custody refund only for an original cash tender;
- no physical cash movement for non-cash tenders;
- linked paid practitioner compensation blocks reversal until explicit settlement reversal; and
- compatibility payment, income, employee-cash, accounting, Canonical reversal, source mapping, idempotency and outbox either commit together or fully roll back.

## Governance boundaries

Fail-closed integrations:

- `credit-reversal.refund-cash-hold-workflow`;
- `credit-reversal.refund-dispute-workflow`;
- `credit-reversal.gateway-income-projection`;
- `credit-reversal.executed-refund-reversal`; and
- `credit-reversal.payment-void-income-projection`.

Each boundary requires exact runtime, authority-disposition, parent-command and executable-test evidence. The classifier deliberately distinguishes workflow documents and reporting projections from Canonical refund/payment facts.

Legacy retirement remains blocked until exact writer/read cutover, tenant-bounded reconciliation, zero unexplained minor-unit variance, production observation, rollback proof and separate owner authorization.

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
- atomic-compatibility writers: 83;
- governed-external writers: 3;
- command-required writers: 24;
- isolated fixtures: 4;
- remaining implementation groups: 6;
- existing command boundaries: 18;
- contract-only command boundaries: 2;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

## Verification

Fresh local verification:

- credit/refund/payment reversal focused suite: 12 files, 52 tests, 0 failures;
- migration/schema/worktree governance suite: 3 files, 19 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 502 conforming migrations;
- full `pnpm canonical:check`: passed;
- schema governance: passed;
- authority governance: passed;
- access governance: 260 governed tables, 1,017 writers and 2,620 readers, zero issues;
- protected writer coverage: 226 writers, 24 command-required, zero unclassified.

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

`CDB-V1-030L-PAYMENT-RECEIPT-TENDER-ALLOCATION-INTEGRATION`

Complete the four remaining payment-receipt/tender/allocation writer pairs across appointment billing finalisation, gateway payment verification and payment-void execution. Reuse the existing invoice-full-payment, gateway-settlement, collect-payment and payment-reversal commands. Preserve payment/gateway HTTP behavior and compatibility receipt/log rows. Require exact invoice, receipt, captured tender, allocation, deposit and reversal lineage with integer-minor-unit reconciliation. Commit compatibility, source mapping, idempotency, audit/accounting evidence and outbox atomically; prove exact replay, changed replay conflict, stale/concurrent rejection, tenant isolation and complete rollback; then regenerate governance artifacts.

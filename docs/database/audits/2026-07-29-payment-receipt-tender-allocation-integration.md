# CDB-V1-030L payment receipt, tender and allocation integration audit

**Date:** 2026-07-29
**Checkpoint:** `CDB-V1-030L-PAYMENT-RECEIPT-TENDER-ALLOCATION-INTEGRATION-VERIFIED`
**Branch:** `program/cdb-main-continuous-20260725`
**Scope:** local protected-core implementation and repository evidence only

## Result

The four remaining payment-receipt/tender/allocation writer pairs now cross reviewed Canonical payment commands or guarded atomic compatibility boundaries:

- appointment finalisation legacy payment receipt;
- gateway log transition;
- gateway legacy payment receipt; and
- payment-void negative legacy payment row.

No new receipt, tender, allocation or payment-reversal authority was created. Existing `issueInvoiceWithFullPayment`, `settleGatewayPayment`, `collectPayment` and `reversePayment` commands remain the fact authorities.

## Appointment full payment

`src/lib/canonical/appointment-billing-finalization.ts` retains the legacy `payments` row only for compatibility. `src/routes/tenant/appointments.ts` runs it under the strict `appointment.billing.finalize` boundary and invokes `issueInvoiceWithFullPayment` with the same authoritative statement set.

The Canonical command owns:

- invoice identity and exact final amount;
- one posted payment receipt;
- exact tender method and external transaction identity;
- full allocation to the invoice;
- optional cash-custody collection evidence only for cash;
- source mappings;
- idempotency envelope; and
- accounting/outbox evidence.

Compatibility bill, items, payment, employee cash, appointment status, accounting events and accepted service evidence commit with the Canonical invoice/payment facts or all roll back. Concurrent appointment status and changed provisional values fail closed.

## Gateway log and payment compatibility

`src/lib/canonical/gateway-payment-verification.ts` keeps `payment_gateway_logs` as immutable/auditable gateway workflow history and keeps the legacy `payments` row as a compatibility receipt. Only reviewed non-cash bKash/Nagad gateways are accepted.

The strict `payment-gateway.verify` transaction invokes `settleGatewayPayment`. The Canonical command owns:

- one gateway-settled receipt;
- captured non-cash tender;
- exact invoice allocation;
- optional unallocated deposit liability;
- source mappings;
- idempotency; and
- outbox/accounting evidence.

The gateway log can move from the exact verifying snapshot only. A stale bill or changed gateway state rolls back the gateway log, payment, deposit, income, employee-cash and Canonical receipt/tender/allocation facts. Gateway compatibility never creates physical cash-custody evidence.

## Payment void compatibility

`src/lib/payment-void-execution.ts` retains the negative legacy `payments` row inside `payment.reverse`. `reversePayment` owns the immutable reversal and exact restoration of receipt, tender, allocation, invoice and cash-custody state.

The command requires exact original receipt, tender and allocation lineage. It reverses only the selected receipt amount, restores invoice paid/due state, appends a Canonical reversal, and emits cash-custody refund evidence only when the original tender was cash. Non-cash executed-pending paths are rejected. Paid practitioner compensation remains reversal-blocked until explicit settlement reversal.

Caller-supplied operational statements are committed in the same authoritative batch. Exact replay succeeds, changed replay conflicts and any failed compatibility or Canonical statement rolls back the full mutation.

## Governance boundaries

Fail-closed integrations:

- `payment-allocation.appointment-payment-compatibility`;
- `payment-allocation.gateway-log-compatibility`;
- `payment-allocation.gateway-payment-compatibility`; and
- `payment-allocation.payment-void-compatibility`.

Additional equivalent payment-receipt evidence entries remain semantic-only and contain no literal SQL tokens, preventing the governance classifier from self-registering false repository writers.

Each integration requires exact runtime, parent command and executable replay/rollback evidence. Compatibility receipt/log rows remain blocked from retirement until write/read cutover, exact tenant reconciliation, production observation, rollback proof and separate owner authorization.

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
- atomic-compatibility writers: 87;
- governed-external writers: 3;
- command-required writers: 20;
- isolated fixtures: 4;
- remaining implementation groups: 5;
- existing command boundaries: 18;
- contract-only command boundaries: 2;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

## Verification

Fresh local verification:

- payment receipt/tender/allocation focused suite: 7 files, 42 tests, 0 failures;
- migration/schema/worktree governance suite: 3 files, 19 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 502 conforming migrations;
- full `pnpm canonical:check`: passed;
- schema governance: passed;
- authority governance: passed;
- access governance: 260 governed tables, 1,017 writers and 2,620 readers, zero issues;
- protected writer coverage: 226 writers, 20 command-required, zero unclassified.

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

`CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION`

Complete the five remaining service-catalog/pricing writer pairs across billing master, price categories and settings import/export. Reuse the existing service catalog and effective-price commands/providers. Preserve master-data HTTP, import/export and price-category behavior. Require exact service identity, price-category identity, effective interval, currency and integer-minor-unit price evidence. Commit compatibility, audit, source mapping, idempotency and outbox atomically; prove exact replay, changed replay conflict, overlapping-effective-period rejection, stale/concurrent rejection, tenant isolation and complete rollback; then regenerate governance artifacts.

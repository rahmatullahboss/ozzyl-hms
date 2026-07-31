# CDB-V1-030I practitioner compensation settlement and cash custody integration audit

**Date:** 2026-07-29
**Checkpoint:** `CDB-V1-030I-PRACTITIONER-COMPENSATION-SETTLEMENT-INTEGRATION-VERIFIED`
**Branch:** `program/cdb-main-continuous-20260725`
**Scope:** local protected-core implementation and repository evidence only

## Result

The five remaining practitioner-compensation settlement writer pairs now cross reviewed Canonical command or atomic compatibility boundaries:

- refund cash-hold drawer movements;
- refund-dispute drawer movements;
- billing-counter variance handover movements;
- doctor commission settlement items; and
- doctor commission settlement headers.

The billing-counter command transaction also owns the adjacent guarded counter-session and held-refund-custody updates. Writer coverage therefore promoted seven protected writers in total rather than only the five settlement-labelled pairs. No writer was hidden by moving SQL to another file.

## Cash custody command authority

`src/lib/canonical/contracts/manage-cash-custody.ts` now implements the previously frozen command contract:

- `prepareRecordCashCustodyMovement`;
- `recordCashCustodyMovement`;
- `reverseCashCustodyMovement`; and
- `closeCashCustodySession`.

The command requires exact tenant, custody, source, UTC time, business date, movement type, direction and integer-minor-unit amount. It creates one deterministic custody movement identity, exact source mapping, replay envelope and PHI-minimised outbox event. Caller-owned compatibility statements can be committed in the same D1 batch. Exact replay returns the prior result before mutable-state validation; a changed replay conflicts. Reversal appends an equal-and-opposite immutable movement event.

`src/lib/canonical/live-cash-custody.ts` supplies reusable prepared and strict execution forms. The registered strict boundary is `cash-custody.movement`:

- legacy mode commits the reviewed compatibility batch;
- shadow mode commits legacy authority and monitors the Canonical command best effort; and
- strict mode commits compatibility, mapping, idempotency and outbox in one transaction or rolls everything back.

The protected authority freeze now records cash custody as an existing command boundary. Authority counts are 18 existing and two contract-only command boundaries.

## Accounting materialisation

`src/lib/canonical/accounting-poster.ts` now understands `canonical.cash_custody.movement_recorded` and materialises the existing immutable custody balance/movement authority. It accepts only the frozen custody types and movement types, uses the exact payload custody identity when provided, applies the signed direction, and preserves optimistic balance/version guards.

`canonical.cash_custody.session_closed` is evidence-only and is deliberately skipped by the movement poster. It does not create a second cash movement.

## Billing counter handover

The pending-variance operational close keeps its reviewed HTTP response and compatibility rows. For a positive handover, the following now commit through `executeLiveCashCustodyMovement`:

- guarded session close;
- compatibility handover movement;
- handover document;
- held-refund custody transfer when present;
- non-PHI audit;
- exact Canonical custody mapping;
- idempotency envelope; and
- outbox event.

The handover is an outbound `handover` movement tied to the exact counter session. A zero-value handover preserves the prior compatibility-only behavior because Canonical custody movements require a positive amount.

## Executed-refund cash return

When an already executed cash refund is rejected and the returned cash is acknowledged, `src/lib/executed-refund.ts` prepares one inbound custody adjustment and appends its statements to the parent `credit-note.cash-refund.reverse` command. The refund reversal, bill and credit-note restoration, commission restoration, compatibility cash return, hold settlement, custody source mapping and both Canonical outbox envelopes therefore commit in one strict transaction.

The open-dispute path correctly creates no second cash movement because physical cash has not returned.

## Refund-dispute recovery

`src/lib/billing-refund-dispute.ts` records recovered cash as one inbound custody adjustment tied to the exact dispute, hold, destination counter session and idempotency key.

- when compensation reservation rows exist, the prepared custody command is nested in the existing `doctor-compensation.refund-release` command;
- when no compensation rows exist, the standalone `cash-custody.movement` boundary owns the legacy and Canonical transaction.

Thus every recovery branch records exact custody evidence, while write-off and unresolved-dispute branches do not invent cash-in.

The older reserve-release and dispute cash statement builders remain reviewed guarded compatibility builders. Current runtime callers are bound to the strict parent commands; dormant builders do not create runtime mutations by themselves.

## Compensation settlement identity and allocations

`src/lib/canonical/live-compensation-settlement.ts` now reuses the exact practitioner source mapping used by doctor accrual creation. A doctor with `canonical_source_key` resolves through the `legacy_doctor` mapping and the `pract` identity family; historical numeric-only doctors retain the `prc` fallback. This prevents a payout from creating a second practitioner or rejecting an accrual already assigned to the route-mapped practitioner.

The commission payout route now selects and passes `doctors.canonical_source_key`. Settlement compatibility headers/items, guarded accrual transitions, immutable Canonical settlement/allocation facts, exact practitioner/accrual mappings, idempotency and outbox remain inside `executeLiveCompensationSettlement`.

## Governance

Registered fail-closed writer boundaries:

- `compensation-settlement.refund-cash-hold-custody`;
- `compensation-settlement.refund-dispute-custody`;
- `compensation-settlement.billing-counter-custody`;
- `compensation-settlement.commission-items`; and
- `compensation-settlement.commission-header`.

The strict financial registry and route coverage now include `cash-custody.movement`. Cash custody command authority is implemented, but its read provider remains contract-only and disabled. Legacy retirement remains blocked pending complete writer/read cutover, exact reconciliation, production observation, rollback evidence and separate authorization.

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
- atomic-compatibility writers: 73;
- governed-external writers: 3;
- command-required writers: 34;
- isolated fixtures: 4;
- remaining implementation groups: 8;
- existing command boundaries: 18;
- contract-only command boundaries: 2;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

## Verification

Fresh local verification:

- settlement, cash custody, refund, billing-counter, accounting and commission suite: 14 files, 124 tests, 0 failures;
- migration/schema/worktree governance suite: 3 files, 19 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 502 conforming migrations;
- full `pnpm canonical:check`: passed;
- schema governance: passed;
- authority governance: passed;
- access governance: 260 governed tables, 1,017 writers and 2,620 readers, zero issues;
- protected writer coverage: 226 writers, 34 command-required, zero unclassified;
- worktree policy: passed.

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

`CDB-V1-030J-CASH-CUSTODY-WRITER-INTEGRATION`

Complete the five remaining cash-custody implementation-group writers across `billing-counter-session`, appointment billing finalisation, gateway payment verification, cash-ledger writer and payment-void execution. Reuse `recordCashCustodyMovement`, `reverseCashCustodyMovement` and the existing parent financial commands. Preserve counter/session, payment, refund, void and projection behavior. Require exact custody identity, source lineage, business date and integer-minor-unit balance evidence; commit compatibility, audit, mapping, idempotency and outbox atomically; prove replay, stale balance rejection, reversal lineage, tenant isolation and complete rollback; then regenerate governance artifacts.

# CDB-V1-030H practitioner compensation accrual and adjustment integration audit

**Date:** 2026-07-29
**Checkpoint:** `CDB-V1-030H-PRACTITIONER-COMPENSATION-ACCRUAL-ADJUSTMENT-INTEGRATION-VERIFIED`
**Branch:** `program/cdb-main-continuous-20260725`
**Scope:** local protected-core implementation and repository evidence only

## Result

Every remaining protected practitioner-compensation accrual/adjustment writer now crosses a reviewed strict or atomic compatibility boundary:

- refund reservation and release statements in `src/lib/billing-refund-commission.ts`;
- diagnostic performer reserve accrual and cancellation in `src/lib/diagnostic-performer-reserve.ts`;
- exact diagnostic reserve and doctor commission cancellation composition in `src/lib/canonical/compensation-accrual-route-integration.ts`;
- bill-item cancellation flows reached through `src/routes/tenant/billingCancellation.ts`; and
- approval plus settlement flows in `src/routes/tenant/commissions.ts`.

The original four command-required writer pairs were completed. Moving the exact compatibility writes into one reviewed adapter exposed three additional path-and-table pairs; those are also classified and verified. The implementation group is therefore fully removed rather than hidden by path movement.

## Command composition

`src/lib/canonical/commands/accrue-compensation.ts` now exports `prepareCompensationAdjustment`. It uses the unchanged command name `canonical.compensation.adjust` and the existing request fingerprint, optimistic payable guard, immutable adjustment, source mapping, receipt and outbox contract. `adjustCompensation` retains its existing public behavior and now accepts optional caller-owned authoritative statements.

The prepared form allows a route or helper to compose legacy compatibility, audit and Canonical adjustment statements into one outer D1 transaction. Exact replay returns the previous result with no statements. Changed replay conflicts. Reducing paid compensation remains prohibited until an explicit settlement reversal occurs.

## Diagnostic performer reserve cancellation

`cancelPerformerReservesWithCanonicalAdjustment`:

- reads deterministic reserve units ordered by invoice item, unit sequence and row ID;
- supports full item cancellation and exact first-N quantity cancellation;
- keeps legacy mode behavior for historical rows without a Canonical source key;
- requires an exact `legacy_diagnostic_performer_reserve` mapping in shadow/strict mode;
- converts the exact reserved amount to integer minor units;
- guards every legacy row snapshot and expected update count;
- writes one non-PHI master-data audit per reserve;
- writes one immutable Canonical service-cancellation adjustment per mapped accrual; and
- commits compatibility, assertions, audit, adjustment, mapping, idempotency and outbox atomically in strict mode.

Missing mapping, duplicate mapping, stale legacy state, changed amount, insufficient requested quantity or paid Canonical compensation fails closed. A failed statement rolls back all selected units.

`cancelUnpaidPerformerReserves` and `cancelUnpaidPerformerReserveQuantities` retain their existing signatures and now delegate to this adapter. Existing local GMT+6 legacy timestamps remain unchanged; Canonical evidence uses normalized UTC.

## Doctor commission cancellation

`cancelDoctorCommissionAccrualsWithCanonicalAdjustment`:

- selects exact bill and source-type accruals still in `accrued` state;
- preserves legacy earned, waiver and payable reconciliation semantics;
- resolves the exact `legacy_doctor_commission_accrual` mapping;
- converts effective outstanding payable to integer minor units;
- guards all legacy amount/status/source-key fields;
- records the existing commission-cancelled accounting posting event in the same batch;
- records one non-PHI audit; and
- appends the immutable Canonical cancellation adjustment, source mapping, receipt and outbox.

`cancelItemCommissions` retains its existing signature and missing-table behavior while delegating to the reviewed adapter. Paid compensation still requires explicit settlement reversal before cancellation.

## Refund reservation and release

The direct compatibility statement builders in `billing-refund-commission.ts` remain required by the existing strict refund workflows. They are now explicitly bound to:

- `executeLiveRefundCompensationReservation`;
- `executeLiveRefundCompensationRelease`;
- `doctor-compensation.refund-reserve`; and
- `doctor-compensation.refund-release`.

Reservation and release preserve exact legacy refund holds, immutable Canonical compensation reservation/adjustment/reversal facts, expected-change assertions, receipts and outbox in one strict financial boundary. The classifier requires both runtime and executable reserve/release evidence before promotion.

## Approval and settlement

Doctor commission approval is a compatibility workflow state, not a new Canonical earned/payable fact. The approval route now commits:

- the exact `accrued` to `approved` transition;
- an expected-change assertion;
- one non-PHI audit; and
- assertion cleanup

in one D1 batch. Concurrent changes keep the existing HTTP 409 message.

Settlement remains implemented through `executeLiveCompensationSettlement` and the existing immutable Canonical settlement/allocation command. The route classifier requires both approval atomicity and settlement command evidence.

## Strict financial policy

The registered strict boundary `doctor-compensation.adjust` behaves consistently with the existing policy:

- legacy mode: guarded legacy cancellation/accounting/audit commits atomically;
- shadow mode: legacy authority commits first and Canonical adjustment is monitored best-effort;
- strict mode: compatibility and Canonical adjustment commit in one command transaction or both roll back.

The boundary is registered in `STRICT_FINANCIAL_BOUNDARIES`, `FINANCIAL_ROUTE_COVERAGE` and the financial route contract tests.

## Governance

The new exact compatibility write allowance for:

`src/lib/canonical/compensation-accrual-route-integration.ts` + `doctor_commission_accruals`

is registered as `canonical_compatibility` in `docs/database/legacy-table-disposition.yaml`. Retirement remains blocked until compensation write/read cutover, zero unexplained variance, production observation, rollback evidence and explicit authorization.

Fail-closed writer coverage boundaries:

- `compensation-accrual.refund-reservation-release`;
- `compensation-accrual.performer-reserve-adapter`;
- `compensation-accrual.doctor-commission-adapter`;
- `compensation-accrual.performer-reserve-facade`; and
- `compensation-accrual.commission-approval-settlement-route`.

## Deterministic state

After access, identity/episode, inventory and writer-coverage regeneration:

- governed tables: 260;
- repository writers: 1,015;
- repository readers: 2,618;
- identity/episode readers: 831 across 290 paths and 63 tables;
- protected surfaces: 918;
- protected routes: 44;
- protected UI flows: 28;
- protected writers: 226;
- protected readers: 497;
- protected tables: 83;
- Canonical-command writers: 112;
- atomic-compatibility writers: 66;
- governed-external writers: 3;
- command-required writers: 41;
- isolated fixtures: 4;
- remaining implementation groups: 9;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

## Verification

Fresh local verification:

- compensation, refund, reserve, settlement, commission route and cancellation suite: 9 files, 159 tests, 0 failures;
- dedicated compensation accrual route integration: 5 tests, 0 failures;
- compensation command lifecycle: 11 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 502 conforming migrations;
- schema governance: passed;
- authority governance: passed;
- access governance: 260 governed tables, 1,015 writers and 2,618 readers, zero issues;
- full `pnpm canonical:check`: passed;
- worktree policy: passed.

Expected shadow-failure and deliberate error-path logs in focused tests remain non-failing test evidence.

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

`CDB-V1-030I-PRACTITIONER-COMPENSATION-SETTLEMENT-INTEGRATION`

Complete the five remaining settlement writer pairs across refund cash hold/dispute, billing counter and commission routes. Reuse the existing Canonical settlement and settlement-reversal authorities. Preserve exact cash-custody, refund-dispute and doctor-payout behavior; require exact practitioner, settlement, allocation, accrual and integer-minor-unit evidence; commit compatibility settlement/items/cash movement, audit, receipt and outbox atomically; prove replay, stale/concurrent rejection, paid/refund reversal rules, tenant isolation and complete rollback; then regenerate governance artifacts.

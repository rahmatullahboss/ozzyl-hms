# P10 IPD Discharge Billing Finalize Verification

**Checkpoint:** CDB-109

**Verified:** 2026-07-24T04:00:53+06:00

**Branch:** `fix/canonical-ipd-discharge-billing-finalize-20260724`

**Base:** local `main` at `6e63495b2f1575d12ff2601657cad6a480213ab2`

**Boundary:** `ipd-discharge.billing.finalize`

## Result

The boundary is implemented and locally verified as `integrated`.

`POST /ip-billing/discharge-bill` now executes row-count-guarded legacy discharge authority through `executeStrictFinancialMutation`. Strict mode supplies the same authoritative legacy statements to `finalizeIpdDischargeBilling`, so the legacy bill, invoice items, payment, deposit adjustment/refund, credit-discharge approval, admission discharge and bed transition commit or roll back with canonical invoice settlement, deposit application/refund, invoice-to-encounter linkage and inpatient encounter completion.

Disabled and shadow policy preserve legacy authority. The canonical projection is built only inside the canonical callback. A shadow failure records the existing canonical processing issue and does not undo the already committed legacy mutation. Strict canonical or stale-snapshot failures return a bounded HTTP 409 without SQL, canonical IDs, evidence hashes or internal constraint names.

## Checkpoint commits

- `fa7accd39` — design and implementation plan
- `67ff3cd2c` — explicit canonical discharge invoice-to-encounter authority
- `8a1eedf40` — atomic composite IPD discharge settlement command
- `e0da657ed` — deterministic live IPD discharge projection
- `c6fc1a4dc` — guarded legacy statement adapter
- `6081ccda7` — route integration and post-commit ordering
- `92242cff5` — financial route coverage integration

## Canonical authority added

Migration `0535_canonical_invoice_encounter_links.sql` adds an explicit tenant-scoped canonical link between a posted discharge invoice and an inpatient encounter. This prevents IPD reporting from depending only on service-event inference when discharge invoices contain package, bed or manual adjustment lines.

The IPD projection now:

- loads explicitly linked posted invoices first;
- retains service-event inference for historical compatibility;
- does not duplicate explicitly linked invoices;
- keeps mixed-encounter detection for inferred invoices;
- includes adjustment-only discharge invoices in IPD balances.

## Composite command

`finalizeIpdDischargeBilling` owns one canonical idempotency envelope and one atomic batch containing:

- canonical invoice and typed financial lines;
- optional direct receipt, tender and allocation;
- oldest-first deposit application slices;
- optional oldest-first excess-deposit refund slices;
- cash collection/refund custody events;
- invoice-to-encounter link;
- inpatient encounter completion;
- active canonical bed-stay completion;
- source mappings and accounting outbox events;
- strict-mode authoritative legacy statements.

The deposit source is loaded once for settlement preparation. Refund allocation is computed from the post-application snapshot. Compare-and-swap predicates verify exact `applied_minor`, `refunded_minor` and `available_minor` values. A concurrent deposit mutation makes the batch fail and rolls back legacy and canonical authority together.

## Projection contract

`buildIpdDischargeBillingProjection` creates deterministic standard `legacy_live_bill` identities for provisional, package and bed financial lines. It does not fabricate canonical service events from provisional IDs, package IDs, bed IDs, doctor IDs or reference IDs.

It enforces:

```text
requested deposit = deposit applied + excess deposit refunded
invoice paid = deposit applied + direct payment
invoice due = invoice total - deposit applied - direct payment
settled discharge due = 0
credit-pending discharge due > 0
```

Non-cash settlement requires explicit `payment_reference` authority. Cash settlement continues to use the existing counter/session evidence.

## Legacy atomicity

`prepareIpdDischargeLegacyStatements` interleaves transaction-local row-count assertions while preserving D1 batch result indexes. The route hardens source snapshots for provisional items, bed-charge segments and admission status. Zero-row or duplicate critical writes fail the complete batch.

Notification fan-out and the optional closure of already-ended bed-history rows remain noncritical because their valid affected-row count is zero-to-many. Bill creation, item creation/finalization, deposit/payment/refund authority, credit approval authority, admission discharge and current-bed transition remain critical.

## Accounting and post-commit behavior

Strict mode emits canonical invoice, deposit application, payment, cash custody and deposit-refund events. Legacy post-commit bill/payment/deposit accounting creation and the old IPD cash shadow write are skipped in strict mode to prevent duplicate financial authority.

Commission/reserve calculation, doctor payable accruals, supplementary IPD ledger entries, audit logging, request-idempotency completion and accounting worker queueing remain post-commit. `recordBillFinalizationSideEffects` receives `skipBillAccountingEvent: true` only in strict mode.

The accounting regression for a BDT 100.00 invoice with BDT 70.00 deposit application, BDT 30.00 cash payment and BDT 20.00 excess deposit refund verifies:

- accounts receivable net balance: zero;
- patient deposit liability debit: BDT 90.00;
- net cash movement: BDT +10.00;
- invoice due: zero.

## Adversarial review

Validated before integration:

1. Deposit application and refund use one ordered source snapshot and compare-and-swap transitions.
2. Missing, mismatched or already-completed inpatient encounter fails before authority is committed.
3. Encounter update requires `in_progress` and no existing end timestamp.
4. Active canonical bed stays complete in the same batch; a reconciliation assertion rejects remaining active stays.
5. Provisional financial values and status are bound in the legacy update predicate.
6. Bed rate, interval, admission, bed identity and billed status are bound in the legacy update predicate.
7. Admission discharge requires the original admitted/critical status and matching patient.
8. Strict mode performs DB lookup for legacy bill/approval IDs because the canonical command result does not expose legacy batch results.
9. Disabled/shadow mode recovers legacy insert IDs through adapter result-index mapping.
10. Original legacy raw descriptions and payment method remain unchanged; non-cash canonical authority is an additional explicit request field.
11. Strict accounting and cash custody do not duplicate post-commit legacy/shadow writes.
12. Nested canonical and assertion errors map to a safe conflict response.

No unresolved Critical or High implementation finding remained at the final gate.

## Fresh verification

### Focused CDB-109 gate

- 12 test files passed
- 126 tests passed

Included schema, IPD projection, composite command, settlement command, accounting reconciliation, deterministic projection, guarded adapter, route coverage, strict coordinator, route source contract, IPD route behavior and production-compatibility tests.

### Full canonical gate

- 120 test files passed
- 854 tests passed

### Other gates

- TypeScript: passed
- Canonical schema governance: 0 issues
- Generated migration manifest: 467 migrations
- Production build: passed
- `git diff --check`: passed

## Remaining work

The next financial writer boundary is `lab.billing.create`. Other registered fail-closed runtime writers remain:

- `payment-gateway.verify`
- `patient-chart.lab-billing.create`
- `patient-chart.radiology-billing.create`
- `pharmacy.billing.finalize`
- `radiology.billing.create`
- `reception.visit-billing.create`
- `settlement.finalize`

This checkpoint does not claim production strict readiness. Inventory live command adoption, clinical/service runtime command adoption, automated canonical accounting consumption, production migration/backfill, reconciliation and authorized shadow/strict observation remain separate program work.

## Production safety statement

No remote push, deployment, production migration application, production backfill, feature-flag change, traffic change, tenant-data mutation, production observation or rollback occurred. Migration `0535` was generated and tested locally only.

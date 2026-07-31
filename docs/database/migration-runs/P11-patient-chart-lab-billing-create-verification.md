# P11 Patient-Chart Lab Billing Create Verification

**Checkpoint:** CDB-112

**Verified:** 2026-07-24T14:39:30+06:00

**Branch:** `fix/canonical-patient-chart-lab-billing-create-20260724`

**Base:** local `main` at `ee2c367a0c44d10698efb1a20a6aa36f46f1a036`

**Boundary:** `patient-chart.lab-billing.create`

## Result

The boundary is implemented and locally verified as `integrated`.

`POST /api/patients/:id/chart/lab-order` now executes through `executeStrictFinancialMutation()` while preserving the original quick-lab route contract in disabled and shadow modes. Strict mode commits guarded legacy order/bill authority with canonical service-request, accepted-service-event and invoice authority in one D1 batch.

The primary lab route adapter was not reused because the patient-chart quick route has a distinct legacy contract: it preserves order notes and per-item instructions, does not create `visit_services`, uses the diagnostic invoice sequence, and historically inserts the order before resolving every requested catalog item.

## Checkpoint commits

- `7f3805573` — patient-chart lab billing design and implementation plan
- `e84013c74` — asynchronous lazy strict-statement preparation
- `8fdb50663` — patient-chart quick-lab legacy and strict adapter
- `446a5e902` — route, coverage, governance and executable behavior integration

## Async strict preparation

`executeStrictFinancialMutation()` now accepts strict authoritative statements as:

```text
readonly statements
synchronous statement factory
asynchronous statement factory
```

The factory is never evaluated in disabled or shadow mode. Strict mode awaits the factory before calling the canonical command. Existing synchronous integrations remain compatible.

This extension is required because patient-chart strict preparation must resolve every lab catalog item, verify canonical service mappings and positive invoice value, then allocate order/invoice identities only after strict policy has been selected.

## Legacy and shadow isolation

`executePatientChartLabOrderOriginalLegacy()` preserves the production quick-route sequence:

1. allocate the lab-order number;
2. insert the lab-order header with notes;
3. resolve and insert each lab-order item sequentially with instructions and notes;
4. allocate the diagnostic invoice number;
5. insert the bill;
6. insert invoice items using the committed lab-order-item IDs;
7. link the order to the bill.

The original executor contains no financial assertion table, strict row-count guard, canonical schema dependency, billing-service join, `changes()` assertion or `visit_services` insert.

A missing later catalog item retains the original legacy behavior: the already-inserted order is not reconstructed into a new atomic legacy transaction. Shadow mode commits the same legacy workflow first and then attempts canonical projection best-effort. Canonical projection failure records a processing issue but does not change the committed legacy response.

## Strict authority

`preparePatientChartLabOrderStrictContext()` runs only in strict mode and, before sequence allocation:

- resolves every requested lab test;
- validates safe two-decimal prices;
- requires a positive total;
- requires every test to resolve to an active canonical billing-service item;
- computes deterministic line numbers and duplicate ordinals;
- preserves route notes and per-item instructions.

Zero-total quick orders remain supported in disabled and shadow modes. Strict mode fails closed before sequence allocation because the current canonical invoice command intentionally requires positive invoice value. No global zero-value canonical invoice rule was invented in this checkpoint.

`preparePatientChartLabOrderStrictStatements()` atomically guards:

- patient and optional visit ownership;
- unique order identity;
- current active lab catalog and billing-service mapping;
- current billing-service price;
- each order-item insertion;
- unique invoice identity and exact total;
- each invoice-item reference, including duplicate test ordinals;
- the order-to-bill link;
- one-row assertions and assertion cleanup.

Stale catalog price, patient/visit mismatch, duplicate order/invoice identity, missing item identity or any row-count mismatch rolls back the strict legacy and canonical facts together.

## Canonical authority

The route reuses `createLabOrderBilling()` for positive-value authority. It creates deterministic:

- active canonical service requests;
- accepted canonical service events;
- canonical billing-service mappings;
- canonical invoice and typed invoice lines;
- source mappings to actual committed quick-route lab-order-item identities;
- command and child outbox events.

The guarded legacy statements are passed as the command's authoritative statements so strict legacy and canonical facts share one atomic batch.

## Route behavior

After financial commit, the route resolves the committed order, bill, lab-order-item and invoice-item IDs by generated order/invoice identities rather than relying on batch result indexes.

Post-commit behavior remains:

- diagnostic performer reserve and bill commission preparation;
- lab-order doctor commission accrual;
- audit logging;
- accounting posting queue scheduling;
- the existing response payload.

The legacy bill-created accounting event remains active in disabled and shadow modes. Strict mode sets `skipBillAccountingEvent: true` because canonical invoice outbox authority was already committed atomically.

`FINANCIAL_ROUTE_COVERAGE['patient-chart.lab-billing.create']` now records:

```text
status: integrated
canonicalCommand: createLabOrderBilling
```

The separate `patient-chart.radiology-billing.create` handler remains untouched and fail-closed in strict mode.

## Adversarial review

Validated before the final gate:

1. Disabled and shadow modes never evaluate strict catalog/mapping preparation.
2. Original notes, instructions, bill fields and mutation order remain preserved.
3. The quick route does not gain `visit_services` writes.
4. Shadow canonical failure returns the committed legacy success response.
5. Strict missing mapping fails before order or bill insert.
6. Strict zero-total validation occurs before sequence allocation.
7. Guarded legacy and canonical facts share one command batch.
8. Duplicate lab-test IDs map invoice lines by duplicate ordinal.
9. Strict mode skips only the duplicate bill accounting event; other reserve and commission side effects remain.
10. Direct legacy-write governance allowances follow the dedicated adapter path, while route allowances remain only for the still-blocked quick-radiology writer.
11. The radiology route, production controls and canonical invoice global rules were not modified.

No unresolved Critical or High implementation finding remained at the final gate.

## Fresh verification

### Focused CDB-112 gate

- 8 test files passed
- 77 tests passed

Coverage includes asynchronous strict preparation, quick-lab legacy/strict adapter, canonical command, route source contract, executable legacy/shadow/strict behavior, financial route coverage, schema governance and cross-route shadow isolation.

### Full canonical gate

- 127 test files passed
- 893 tests passed

### Other gates

- TypeScript: passed
- Canonical schema governance: 0 issues
- Generated migration manifest: 467 migrations
- Web production build: passed
- Patient production build: passed
- Admin production build: passed
- Task worktree policy: passed
- `git diff --check`: passed

## Remaining work

The next financial writer boundary is `patient-chart.radiology-billing.create`. Other registered fail-closed runtime writers remain:

- `pharmacy.billing.finalize`
- `radiology.billing.create`
- `reception.visit-billing.create`
- `settlement.finalize`

This checkpoint does not claim production strict readiness. Production deploy, migration/backfill, feature-flag activation, traffic movement, tenant mutation, shadow/strict observation, rollback and legacy retirement remain separately authorized work.

## Production safety statement

No remote push, deployment, production migration, production backfill, feature-flag change, traffic change, tenant-data mutation, production observation, rollback or legacy retirement occurred. All implementation and verification were local to the isolated task worktree.

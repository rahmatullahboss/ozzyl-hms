# Canonical Patient-Chart Lab Billing Create Design

**Date:** 2026-07-24

**Base:** local `main` at `ee2c367a0c44d10698efb1a20a6aa36f46f1a036`

**Boundary:** `patient-chart.lab-billing.create`

**Status:** Approved by the user's standing `CDB-CONTINUE` instruction to serially complete the remaining canonical financial writers from the latest reviewed local `main` without stopping at normal checkpoints.

## Problem

`POST /api/patients/:id/chart/lab-order` is an alternate lab-order and billing writer. It currently:

1. allocates a lab-order sequence;
2. inserts the legacy `lab_orders` header;
3. resolves each test and inserts `lab_order_items` one at a time, including notes and instructions;
4. allocates an invoice sequence;
5. inserts a legacy `bills` header;
6. inserts `invoice_items` using committed lab-order-item IDs;
7. links the order to the bill;
8. records bill accounting/reserve/commission side effects;
9. returns the committed order and bill identities.

The boundary is blocked in strict mode because these financial and operational facts do not commit with canonical service-request, accepted-service-event and invoice authority.

The completed appointment correction establishes a mandatory constraint: disabled and shadow modes must execute the original production legacy behavior without strict-only validation, guarded predicates, assertion tables or canonical schema dependencies.

## Source audit findings

The patient-chart quick route cannot use `executeLabBillingOriginalLegacy()` from the primary lab route because the two legacy contracts differ:

- quick orders persist header notes and per-item instructions;
- quick orders do not create `visit_services` rows;
- quick orders insert the order before resolving every catalog item;
- quick bills use the legacy diagnostic invoice sequence and a smaller bill column set;
- the primary lab route uses fiscal invoice metadata and a different item/bill write order.

Replacing the quick route with the primary lab adapter would alter legacy behavior and violate the shadow contract.

The existing canonical `createLabOrderBilling()` command is still the correct positive-value canonical authority. It already creates deterministic service requests, accepted service events, typed invoice lines, source mappings and outbox events from the actual committed legacy item identities.

The quick route permits a zero-total order and creates a paid zero-value legacy bill. The existing canonical invoice command intentionally requires a positive total. This checkpoint does not invent new zero-value canonical invoice semantics.

## Approaches considered

### 1. Reuse the primary lab legacy adapter

Rejected. It would drop quick-order notes/instructions, add `visit_services`, change bill fields and change mutation ordering.

### 2. Extend the global canonical invoice command to support zero-value invoices

Rejected for this checkpoint. Although the physical schema permits zero totals, the current canonical invoice command deliberately requires a positive invoice. Changing that rule affects every invoice producer and requires a separate domain decision and accounting review.

### 3. Add a quick-lab-specific adapter and reuse the positive canonical command

Selected.

- Legacy/off and shadow execute the original quick-route workflow exactly.
- Strict mode performs a separate read-only catalog/mapping preflight, rejects zero-total or unmapped items before financial mutation, then commits guarded legacy authority with `createLabOrderBilling()` atomically.
- The strict preparation is lazy and asynchronous because it must resolve catalog facts and sequence identities only after strict policy is known.

## Coordinator extension

`executeStrictFinancialMutation()` currently accepts a synchronous strict statement factory. The quick route cannot prepare strict statements synchronously because strict preparation requires asynchronous catalog and sequence work, while legacy/shadow must not run that work before the original executor.

Extend `strictAuthoritativeStatements` to accept:

```ts
readonly CanonicalPreparedStatement[]
| (() => readonly CanonicalPreparedStatement[])
| (() => Promise<readonly CanonicalPreparedStatement[]>)
```

The coordinator will:

- never evaluate the factory in disabled or shadow mode;
- await the factory only after strict policy is resolved;
- pass the resulting statements to the canonical command;
- wrap preparation or command failure in the existing strict financial error.

Existing synchronous callers remain source-compatible.

## Quick-lab adapter

Create `src/lib/canonical/patient-chart-lab-billing.ts` with three responsibilities.

### Original legacy executor

`executePatientChartLabOrderOriginalLegacy()` receives the request plus injected sequence and catalog resolvers. It preserves the current order exactly:

1. allocate order number;
2. insert order header;
3. resolve and insert each order item sequentially;
4. allocate invoice number;
5. insert bill;
6. insert invoice items;
7. update the order bill link.

It returns:

- the original mutation results used by the coordinator;
- a prepared context containing order number, invoice number, totals, visit/doctor context and resolved items.

Missing/inactive tests after the order insert retain the current legacy failure semantics. No strict validation or canonical table is touched.

### Strict context preparation

`preparePatientChartLabOrderStrictContext()` runs only from the async strict factory. It:

- resolves every requested lab test before allocating identities;
- requires a positive resolved price total;
- requires every test to have a canonical billing-service item identity;
- allocates deterministic legacy order and invoice numbers after validation;
- computes line numbers and duplicate ordinals;
- preserves notes and instructions for the guarded legacy batch.

A zero-total request fails closed in strict mode before order or invoice sequence allocation. Disabled and shadow behavior remains unchanged.

### Strict authoritative statements

`preparePatientChartLabOrderStrictStatements()` creates one guarded batch for:

- patient-owned lab-order header;
- every lab-order item with current catalog price and active service mapping guard;
- one bill with the exact expected total and category totals;
- every invoice item linked to the correct duplicate ordinal;
- the final order-to-bill link;
- one-row assertions for every required mutation;
- assertion cleanup.

It does not add `visit_services`, canonical-specific accounting inserts or any field absent from the original quick route.

## Route flow

The patient-chart route will keep patient and active-visit lookup before the financial coordinator.

It then creates one dependency object for:

- order sequence allocation;
- invoice sequence allocation;
- lab catalog resolution.

A shared prepared-context variable is populated by either:

- the original legacy executor in disabled/shadow mode; or
- the async strict statement factory in strict mode.

The coordinator call is:

```ts
await executeStrictFinancialMutation({
  db: c.env.DB,
  tenantId: String(tenantId),
  boundary: 'patient-chart.lab-billing.create',
  legacyExecutor: async () => {
    const legacy = await executePatientChartLabOrderOriginalLegacy(...);
    prepared = legacy.context;
    return legacy.results;
  },
  strictAuthoritativeStatements: async () => {
    prepared = await preparePatientChartLabOrderStrictContext(...);
    return preparePatientChartLabOrderStrictStatements(c.env.DB, prepared);
  },
  canonical: async (execution) => createLabOrderBilling(
    c.env.DB,
    buildPatientChartCanonicalLabBillingInput(prepared),
    execution,
  ),
});
```

After financial commit, the route resolves committed order, bill, lab-order-item and invoice-item IDs by `orderNo` and `invoiceNo`. This works for legacy, shadow and strict results without assuming D1 batch result indexes.

## Post-commit behavior

The existing route side effects remain after the financial coordinator:

- bill performer reserve and commission preparation;
- bill accounting event in legacy/shadow mode;
- lab-order doctor commission accrual;
- accounting queue scheduling;
- audit log;
- response payload.

Strict mode sets `skipBillAccountingEvent: true` because canonical invoice outbox authority is committed in the strict batch. Other legacy reserve and commission side effects remain post-commit as they are today.

Canonical shadow failure does not change the committed legacy result or successful response. Existing legacy post-commit side-effect failures retain their current route behavior.

## Error behavior

### Disabled

Runs the original quick-lab implementation in the original mutation order. No strict or canonical preflight is evaluated.

### Shadow

Runs and commits the same original legacy workflow, then attempts `createLabOrderBilling()` best-effort. Missing canonical mappings or other canonical failures are recorded as shadow issues and do not change the legacy response.

### Strict

Before any financial mutation:

- all tests must resolve;
- total must be positive;
- all billing-service identities must be available.

The guarded legacy statements and canonical command then commit atomically. Stale patient/visit/catalog price, duplicate order/invoice identity, missing item identity or row-count mismatch rolls back all strict legacy and canonical facts.

Strict validation failures return the route's existing concurrent/canonical-unavailable conflict response rather than exposing internal details.

## Governance

Update `FINANCIAL_ROUTE_COVERAGE['patient-chart.lab-billing.create']` to:

```text
status: integrated
canonicalCommand: createLabOrderBilling
```

Move exact direct-write governance allowances for this flow from `src/routes/tenant/patients.ts` to `src/lib/canonical/patient-chart-lab-billing.ts` without changing owner or retirement phase.

`src/routes/tenant/patients.ts` still contains the separate radiology direct writer, so its route-file allowance remains only for radiology-owned tables/boundaries where applicable.

## Test strategy

TDD must prove:

1. async strict factories are never invoked in disabled or shadow mode;
2. async strict preparation is awaited only in strict mode;
3. the original executor preserves order-before-catalog-resolution behavior, notes and instructions;
4. the original executor contains no assertion or canonical dependency;
5. strict zero-total and missing mapping fail before sequence allocation;
6. strict statements commit order, items, bill, invoice items and bill link atomically;
7. stale catalog price, patient/visit mismatch and duplicate identity roll back the strict batch;
8. positive strict execution creates canonical service requests/events and invoice authority through `createLabOrderBilling()`;
9. shadow canonical failure preserves the legacy result;
10. route source contract and financial coverage report the boundary as integrated;
11. the existing patient-chart route integration test still observes the legacy bill-created accounting event;
12. full canonical, TypeScript, governance and production-build gates pass.

## Non-goals

- No zero-value canonical invoice rule change.
- No refactor of the patient-chart radiology writer.
- No broad split of the large `patients.ts` route module.
- No change to commission formulas, accounting classification or lab result workflow.
- No production deploy, migration, backfill, flag change, traffic movement, tenant mutation, observation, rollback or legacy retirement.

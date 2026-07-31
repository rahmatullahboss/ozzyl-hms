# Canonical Radiology Billing Create Design

**Checkpoint:** CDB-115

**Boundary:** `radiology.billing.create`

**Route:** `src/routes/tenant/radiology/orders.ts` — `POST /`

## Problem

The primary RIS requisition route is blocked in strict mode. It currently creates a radiology requisition, a live bill, one invoice item and the requisition-to-bill link through direct legacy writes, then runs bill finalization side effects.

The existing patient-chart quick-radiology adapter and `createRadiologyRequisitionBilling()` canonical command cover the same canonical service/invoice authority, but the primary RIS route has a richer legacy contract:

- request idempotency reservation/replay;
- patient, visit, admission, prescriber, imaging-type and imaging-item ownership checks;
- optional free-text imaging names;
- optional zero-value requisitions;
- visit/admission/prescriber/ward/insurance fields;
- direct requisition insert followed by bill insert and dependent batch;
- post-commit commission/reserve/accounting side effects and audit logging.

Reusing the patient-chart adapter directly would change that legacy path and violate shadow isolation.

## Invariants

### Disabled/legacy

The original RIS workflow must remain behaviorally unchanged:

1. reserve or replay the request idempotency key;
2. validate the same tenant-owned source references in the same order;
3. resolve submitted names and current catalog price with the same fallback behavior;
4. assert the accounting period;
5. allocate accession and invoice numbers;
6. insert requisition;
7. insert bill;
8. insert invoice item and link the requisition in the same dependent batch;
9. run existing post-commit bill finalization, accounting queue, audit and idempotency completion;
10. preserve free-text and zero-value success.

No canonical table, strict financial assertion, strict-only mapping requirement or stronger validation may run inside the original legacy executor.

### Shadow

1. Commit the original legacy executor.
2. Run the existing post-commit side effects.
3. Project mapped, positive-value orders through `createRadiologyRequisitionBilling()` best effort.
4. Mapping/price/canonical failure must not alter the committed legacy result or `201` response.
5. Record the standard canonical shadow processing issue.

Free-text, zero-value and unmapped legacy orders are valid shadow legacy successes even when canonical projection fails.

### Strict

Strict preparation is lazy and executes only after strict policy selection. Before accession or invoice sequence allocation it must require:

- tenant-owned patient;
- optional visit belonging to the same tenant and patient;
- optional admission belonging to the same tenant and patient;
- optional active prescriber in the tenant;
- active imaging item with active imaging type;
- exact current item/type identity;
- active billing-service mapping under Radiology;
- positive major/minor-unit price parity;
- open accounting period.

After preflight, one atomic D1 batch must commit:

- guarded requisition insert with the full RIS source shape;
- guarded bill insert with visit linkage and current category totals;
- guarded invoice-item insert referencing the actual requisition row;
- guarded requisition bill link/status update;
- canonical service request/event, invoice and source mappings through `createRadiologyRequisitionBilling()`;
- one-row financial assertions and cleanup.

The batch must fail closed for patient/visit/admission/prescriber/item/type/catalog/price/status/identity races, accession or invoice conflicts, missing dependent rows or source-mapping failure.

## Architecture

### New RIS adapter

Create `src/lib/canonical/radiology-order-billing.ts` with:

- `executeRadiologyOrderOriginalLegacy()`
- `prepareRadiologyOrderStrictContext()`
- `prepareRadiologyOrderStrictStatements()`
- input/context/result types and a domain error carrying the legacy HTTP status.

The adapter owns source validation, source enrichment, sequence timing and legacy/strict statement construction. The route remains orchestration-only.

### Existing canonical command

Reuse `createRadiologyRequisitionBilling()` unchanged unless tests reveal a real primary-RIS requirement. It already provides deterministic canonical service request/event, invoice, live-bill line identity, source mappings, outbox events, replay and conflict rejection.

The primary RIS context must supply:

- `accessionNo`
- `invoiceNo`
- `legacyPatientId`
- resolved `imagingItemId`
- `billingServiceItemId`
- authoritative display name
- positive total in minor units
- normalized requested UTC time and business date.

### Coordinator integration

Replace `assertStrictFinancialBoundaryDisabledOrSupported()` with `executeStrictFinancialMutation()`:

- `legacyExecutor` → original RIS executor;
- `strictAuthoritativeStatements` → strict context plus guarded statements;
- `canonical` → existing radiology command with strict authoritative statements when present.

Store the prepared/committed context in a request-local reference. After the coordinator, reload actual requisition, bill and invoice-item identities by accession/invoice number.

### Post-commit side effects

After committed identity reload:

- call `recordBillFinalizationSideEffects()` for positive totals;
- use `skipBillAccountingEvent: execution.mode === 'strict'` to avoid duplicate strict accounting authority while retaining performer reserve/commission behavior;
- queue accounting posting as before;
- create the audit log;
- complete the request idempotency key with the same response shape.

On failure before committed response completion, mark the request idempotency key failed as before. Canonical shadow failure is not a route failure.

## Testing

### Adapter tests

- exact original validation/dependency/write order;
- free-text zero-value legacy success;
- visit/admission/prescriber and submitted-name preservation;
- strict missing mapping/zero price/price mismatch rejection before sequences;
- strict tenant/patient/reference ownership checks;
- atomic success with full requisition shape;
- rollback on current catalog price, item/type, visit/admission/prescriber or patient race;
- actual requisition and bill linkage.

### Route tests

- source contract: no direct finalization SQL remains in the handler;
- mapped legacy success and accounting event preserved;
- free-text zero-value legacy success preserved;
- shadow canonical failure returns the legacy `201` and records an issue;
- strict missing mapping fails before sequences or legacy mutation;
- strict mapped success runs the canonical command and preserves response/idempotency shape;
- existing accounting-period and billing-gate regressions remain green.

### Program gates

- focused radiology/canonical route tests;
- full canonical suite;
- TypeScript;
- canonical governance;
- migration manifest generation;
- task worktree policy and diff check;
- web, patient and admin builds;
- current-main replay and post-integration verification.

## Governance

Update `FINANCIAL_ROUTE_COVERAGE['radiology.billing.create']` to `integrated` with canonical command `createRadiologyRequisitionBilling` after executable route and adapter coverage passes.

Do not expand the legacy-table registry unless the existing registry already owns a relevant allowance. Record the exact disposition in the verification report.

## Safety

No production deploy, migration, backfill, flag change, traffic change, tenant mutation, observation or rollback is part of this checkpoint.

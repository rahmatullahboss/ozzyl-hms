# Small-Hospital Reagent and Inventory A-to-Z Review

Date: 2026-07-10
Branch: `audit/reagent-inventory-billing-best-practice`

## Executive decision

For the first hospital phase, billing-time reagent deduction is a practical operating model and does not require LIS or analyzer integration.

The recommended phase-1 policy remains:

- `lab_inventory_mode = soft`
- `reagent_consumption_timing = billing`
- `allow_result_without_stock = true`
- `require_test_mapping_for_completion = false`

Billing is the demand/consumption trigger. Missing recipes, stock or eligible lots create actionable exceptions, but routine billing and result entry continue.

`InventoryStock` remains the authoritative quantity/cost ledger. The reagent layer provides test recipes, operational projections, QC/open-vial views, exceptions, logs and reconciliation.

No production policy was changed by this review.

## Reference model

The review used the current ISO 15189:2022 quality/competence framework and the WHO Laboratory Quality Management System handbook as proportional guidance for:

- receiving and traceability;
- lot/batch and expiry control;
- release/QC before use;
- stock rotation;
- complete movement records;
- discrepancy investigation;
- correction and cancellation safety.

This is not a claim of laboratory accreditation. It is a practical small-hospital control design.

## Current system strengths

### Master data and recipes

- Reagents can be linked to canonical inventory items.
- Lab tests support one or multiple reagent/consumable recipe rows.
- Quantity per test is explicit and editable.
- Mapping lifecycle, effective dates and bulk onboarding are supported.
- Missing recipes are visible through coverage/readiness and exceptions.

### Receiving and lot traceability

- Lab reagents require batch and expiry metadata.
- Goods receipt links the inventory stock, GR item and reagent projection.
- Purchase, free and rejected quantities are retained on the GR document.
- Cost, batch, expiry, store and source receipt are traceable.

### Stock eligibility and deduction

- Billing-time deduction is enabled by policy rather than LIS.
- FEFO allocation is used across eligible lots.
- Available quantity excludes reserved, damaged and blocked quantity.
- Inactive, blocked, expired, after-open-expired and QC-pending/failed lots are rejected.
- The canonical inventory issue path uses deterministic operation keys and request-level atomicity.
- Retry/projection recovery avoids double deduction after timeouts or partial projection writes.

### Operational controls

- QC release/failure, open-vial expiry, transfer, waste request/approval and manual usage exist.
- Inventory counts, adjustments, write-off, return-to-vendor, reorder, stock ledger and reports exist.
- Exceptions can be retried, reviewed and resolved.
- Reconciliation compares expected reagent use with canonical issue and projection records.
- Manager/admin access guards exist for reconciliation and sensitive controls.

## Problems found and fixed

### P0 — Canonical reagent QC bypass at goods receipt

**Problem**

The reagent mirror was created with `pending` QC, but canonical `InventoryStock` inherited `accepted/available`. Billing deduction reads canonical stock first, so a newly received reagent could be consumed before QC release.

**Fix**

Lab reagent GR now creates canonical stock with:

- `QCStatus = pending`
- `StockStatus = blocked`

The existing QC endpoint releases the canonical lot to `available` only after pass/not-required review.

### P0 — Purchase-unit/issue-unit conversion was ignored

**Problem**

`PurchaseUnit`, `IssueUnit` and `UnitConversionFactor` existed, but GR stored purchase quantity and purchase-unit cost directly as canonical stock quantity and cost. A box/kit purchased as one unit but consumed as tests, mL or pieces could produce wrong stock and COGS.

**Fix**

Canonical stock now uses issue/base units:

```text
stock quantity = (received - rejected + free) × conversion factor
cost per issue unit = landed cost per purchase unit ÷ conversion factor
```

The financial GR document remains in purchase units.

Missing conversion factor defaults to `1`. A zero/negative factor is rejected before any GR writes.

### P0 — Rejected receipt quantity entered usable stock

**Problem**

`RejectedQuantity` was stored on the GR item but not deducted from available stock.

**Fix**

Rejected purchase units are excluded from canonical and reagent stock quantity. Rejected quantity greater than received quantity is rejected before writes.

The Goods Receipt UI now exposes a `Rejected` field, validates it against received quantity and sends the operator-entered value instead of always sending zero.

### P0 — Cancellation reversal could be permanently partial

**Problem**

Reagent cancellation reversal updated lots sequentially. If a later lot failed, earlier stock could already be returned. Any existing reversal row caused the whole retry to no-op, leaving missing lots permanently unreversed.

**Fix**

Reversal now:

- links each return to its exact source usage movement;
- detects which source movements are already reversed;
- returns only remaining movements on retry;
- validates exact stock snapshots;
- executes every lot, ledger and projection update in one D1 batch;
- rolls back all stock returns if any statement fails;
- marks canonical consumption operations `reversed`;
- clears claim/mapping progress only within the committed batch;
- prevents double return with a unique source-reversal index.

Tests cover partial historical reversal retry and forced second-movement failure rollback.

### P1 — Duplicate open exceptions

**Problem**

Every billing retry could create another identical open exception.

**Fix**

One open exception is maintained per tenant, source event, order item, consumable and reason. Repeated occurrences update the latest message/metadata and increment `occurrence_count`. A resolved issue can later create a new open occurrence.

### P1 — Strict readiness undercounted canonical stock

**Problem**

Readiness mostly counted legacy reagent stock. Canonical stock and canonical open-vial risk were incomplete, while linked mirror lots could be counted instead of source-of-truth lots.

**Fix**

Readiness now combines:

- usable canonical InventoryStock lots;
- unlinked legacy lab stock lots;
- canonical and legacy QC risk;
- canonical and legacy after-open risk;
- known stock-shortage reason aliases.

Linked mirrors are excluded to avoid double-counting.

### P1 — Billing entry-point policy inconsistency

**Problem**

Prescription billing respected soft/strict exception policy; the general billing-counter path always converted consumption failures to warnings.

**Fix**

The general billing helper now loads one tenant policy, skips disabled/non-billing modes, records the exception and uses the same soft/strict decision function before returning a warning.

## Phase-1 operating workflow

### 1. Item master setup

For every reagent/kit/consumable:

1. Link or create the canonical inventory item.
2. Select `lab_reagent` for controlled reagent stock.
3. Enter purchase unit and issue unit.
4. Enter a correct conversion factor.
5. Require batch and expiry.
6. Set reorder level and preferred store/location.

Example:

```text
Purchase unit: Kit
Issue unit: Test
Conversion factor: 100
One received kit: 100 issue units
```

### 2. Goods receipt

1. Select vendor, store and purchase order when applicable.
2. Enter batch, expiry, received quantity, rejected quantity and free quantity.
3. The system creates issue-unit canonical stock.
4. A reagent lot remains QC pending and blocked.

### 3. QC release

1. Review the delivered lot and documentation.
2. Mark pass/not-required only when it is usable.
3. Failed/pending stock remains blocked and cannot be deducted.

### 4. Test recipe setup

For each commonly billed test:

1. Select the lab test.
2. Add one or more required consumables.
3. Enter quantity per test in issue units.
4. Validate the recipe with a sample billing scenario.

### 5. Billing-time deduction

1. Reception bills the lab test.
2. A lab order item is created for each billed test instance.
3. The system attempts FEFO deduction once per order item.
4. Canonical issue, stock transaction, audit and reagent projection are recorded.
5. Soft-mode failure creates one actionable exception and billing continues.

### 6. Daily exception workflow

At least daily:

1. Open Reagent Control → Issues.
2. Resolve missing recipe, stock shortage or QC-blocked lot.
3. Retry deduction after correcting the cause.
4. Mark reviewed/resolved only with meaningful remarks.
5. Investigate high `occurrence_count` first.

### 7. Cancellation/refund

- Unpaid, uncompleted lab items can use the cancellation workflow.
- Paid/partially paid items must use credit-note/refund workflow.
- Reagent return is source-linked, atomic and retry-safe.
- Completed/verified tests use correction/refund, not simple cancellation.

### 8. Stock monitoring

Daily or per shift:

- low stock;
- near expiry;
- QC pending/failed;
- open-vial expiry;
- unresolved reagent exceptions.

Weekly:

- physical spot count of high-use reagents;
- reconciliation mismatches;
- rejected/wasted/expired quantities;
- reorder suggestions and lead times.

Monthly:

- cycle count/variance approval;
- slow-moving/near-expiry stock;
- supplier and lot performance;
- recipe quantity review using actual usage.

## Areas reviewed with no new P0/P1 defect found

The existing implementation and regression coverage were reviewed for:

- inventory item/vendor/store/location master data;
- purchase request, RFQ and PO workflows;
- FEFO/FIFO dispatch and transfer;
- reservations and usable-quantity calculation;
- count, adjustment, write-off and return-to-vendor;
- waste approval and audit trail;
- stock ledger/reporting/accounting hooks;
- demand/reorder intelligence;
- reagent reconciliation and manager access;
- duplicate billing/retry idempotency.

## Remaining risks and recommended follow-up

### Resolved follow-up — Goods-receipt request atomicity and recovery

The canonical GR core now commits the header, every receipt line, canonical stock lot, stock transaction and purchase-order status in one D1 batch. Deterministic operation/line keys resolve auto-generated positive IDs inside the transaction, so a later statement failure rolls back the entire receipt.

Additional controls now include:

- payload-bound API and UI idempotency;
- same-key replay and changed-payload rejection;
- database-guarded concurrent PO over-receipt prevention;
- `core_completed` versus `completed` projection status;
- retry repair for lab reagent and accounting projections;
- verification block while post-commit projections remain pending.

### Contained risk — Strict billing mode remains unavailable

Both billing entry points still create the invoice/bill before reagent deduction, so strict blocking would not yet be a true invoice-and-stock transaction.

The system now fails closed:

- backend policy updates reject strict mode with `STRICT_LAB_INVENTORY_ATOMICITY_REQUIRED` even when catalog/stock readiness is clean;
- the policy API publishes transactional capability flags;
- the UI disables the strict option/action and explains the missing billing-stock atomicity;
- soft billing mode remains unchanged for the current hospital.

Strict mode can be made available only after stock reservation/preflight and bill commit share a durable transactional workflow.

### Resolved follow-up — Durable lab cancellation saga

Lab item cancellation now uses a durable tenant/item operation with `processing`, `core_completed`, `completed` and `failed` states.

The financial/status core commits in one D1 batch:

- linked invoice item cancellation;
- bill total, due and status recalculation;
- lab order item cancellation;
- visit-service cancellation;
- doctor commission cancellation;
- parent lab-order status;
- operation transition to `core_completed`.

Reagent reversal remains a separate atomic, source-linked and idempotent step. If reversal fails after the core commits, the operation stays `core_completed`; the same request retries only the reversal and does not repeat the financial core. A changed reason/notes payload is rejected with 409.

The original cancellation date is retained for accounting projection, and an already committed cancellation can finish its pending reversal even if the accounting period is closed later.

### P1 — Rejected quantity needs vendor settlement workflow

Rejected units are now excluded from usable stock and can be captured by the operator. The GR financial total still follows the vendor bill/purchase quantity; the system does not yet automatically create a supplier debit note, replacement claim or payable reduction for rejected units.

Until that workflow is implemented, accounts/store staff must reconcile rejected quantities with the vendor bill and record the supplier return/debit note through the existing return-to-vendor/accounting process.

### P2 — Operational controls outside software

For stronger laboratory quality management, add or formalize:

- refrigerator/room temperature logs and excursion response;
- manufacturer storage-instruction acknowledgement;
- supplier lot recall/quarantine workflow;
- ABC/VED or criticality classification;
- min/max based on lead time and service level;
- scheduled cycle count frequency by risk;
- lot acceptance documentation attachment.

## LIS/hybrid transition recommendation

Do not make LIS a prerequisite for the first hospital.

Move to hybrid only after:

- test catalog and billing links are stable;
- common-test recipe coverage is high;
- unit conversions are validated;
- physical vs system stock variance is consistently low;
- exception rate is understood;
- analyzer message mapping is validated in staging.

Recommended hybrid model:

1. Billing remains the demand reservation/primary phase-1 trigger.
2. LIS/result event becomes a validation or final-consumption signal.
3. The same order-item idempotency key prevents double deduction from billing and LIS.
4. Cancelled/not-run tests release reservation or reverse consumption.
5. Manual fallback remains available with audit remarks.

## Verification evidence

### Migration manifest

```bash
pnpm build:migrations
```

- 419 migrations generated
- exit code 0
- migration not applied remotely

### TypeScript

```bash
pnpm exec tsc --noEmit
```

- exit code 0

### Inventory/reagent regression

```bash
pnpm test:inventory
```

- backend: 82 files, 553 tests passed
- frontend: 39 files, 214 tests passed
- total: 121 files, 767 tests passed
- failures: 0

### Production web build

```bash
pnpm --filter web build
```

- TypeScript passed
- Vite production bundle passed
- PWA generation passed

## Scope confirmation

Changed:

- additive migration for reversal and exception hardening;
- receipt normalization and reagent QC quarantine;
- rejected-quantity exclusion;
- atomic/source-linked reversal;
- exception deduplication;
- canonical readiness;
- billing policy consistency;
- tests and documentation.

Not changed:

- production database;
- production tenant policy;
- LIS/analyzer as a primary trigger;
- remote deployment;
- existing billing-time soft-mode operating model.

## Final assessment

The billing-time reagent system is now suitable for the first small-hospital soft-mode rollout, provided the operational SOP is followed and strict mode remains disabled.

The next engineering priority before scale is goods-receipt operation recovery, followed by an end-to-end billing/cancellation saga. LIS/hybrid integration can remain a later phase.

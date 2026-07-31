# Small-Hospital Reagent and Inventory Billing Hardening Design

Date: 2026-07-10

## Goal

Make billing-time reagent deduction safe, traceable and practical for a small hospital that does not yet use LIS or analyzer integration.

## Operating model

- Billing is the demand/consumption trigger during phase 1.
- The tenant remains in soft mode by default: billing and result workflows continue while missing mappings or stock create actionable exceptions.
- `InventoryStock` is the authoritative quantity and cost ledger for linked reagent items.
- The reagent layer owns test recipes, lot/QC presentation, operational logs, exceptions and reconciliation projections.
- LIS/analyzer events may become an additional validation source later, but are not required for this release.

## Best-practice baseline

The design follows the quality-system principles reflected by ISO 15189:2022 and the WHO Laboratory Quality Management System handbook:

- documented receipt and lot traceability;
- storage and expiry controls;
- explicit QC/release state before use;
- stock rotation by earliest expiry;
- complete movement/audit records;
- discrepancy detection and corrective action;
- safe handling of cancellation and correction.

This release applies those principles proportionately for a small hospital rather than attempting full laboratory accreditation automation.

## Confirmed gaps

### 1. Canonical reagent receipt can be consumed before QC release

The inventory GR route creates canonical `InventoryStock` with the schema default `QCStatus='accepted'` and `StockStatus='available'`. The mirrored lab lot is `pending`, but billing deduction reads the canonical lot first. Therefore the mirror's pending state does not protect the source-of-truth lot.

### 2. Purchase-to-issue unit conversion is configured but ignored

`InventoryItem.UnitConversionFactor`, `PurchaseUnit` and `IssueUnit` exist, but goods receipt stores purchase quantity and purchase-unit cost directly as canonical available quantity and cost. A reagent bought as kits/boxes but consumed in tests/mL can therefore have incorrect stock and COGS.

Canonical rule:

- GR and PO quantities remain purchase-unit financial/document quantities.
- `InventoryStock.AvailableQuantity` is stored in issue/base units.
- canonical lot cost is stored per issue/base unit.
- `stock quantity = (received + free) × UnitConversionFactor`.
- `cost per issue unit = landed cost per purchase unit ÷ UnitConversionFactor`.

A missing factor is treated as `1`; a non-positive factor is rejected.

### 3. Reagent reversal is not request-atomic or retry-safe

The current cancellation reversal loops movements and writes stock, transactions and return movements sequentially. If a later movement fails, a previous return movement may exist. The retry then sees any reversal and returns a no-op, leaving a partial reversal permanently.

The new reversal must:

- identify every original `usage_out` movement;
- reverse every not-yet-reversed movement in one D1 batch;
- use exact stock snapshots to detect concurrent changes;
- link each return to its source movement;
- make retries return the completed result without double stock;
- mark the canonical `InventoryConsumption` operation reversed so a future legitimate re-consumption is not mistaken for an existing committed allocation;
- clear/reset claim and mapping progress only after the batch commits.

### 4. Strict readiness undercounts canonical reagent stock

Readiness currently counts stocked and opened-vial lots mainly from legacy `lab_consumable_stock`. Linked canonical `InventoryStock` lots must also contribute, with the same QC, status, expiry and after-open rules used by deduction.

### 5. Exceptions can be duplicated on every retry

Repeated billing retries may insert multiple identical open exceptions. The system should maintain one open occurrence per tenant, source event, order item, consumable and reason, updating message/metadata/timestamp and occurrence count.

### 6. Billing entry points do not apply strict policy consistently

Prescription billing respects strict blocking; the general billing-counter helper always converts consumption failures to warnings. All billing-time entry points must use the same policy decision. Soft mode still warns and continues; strict mode blocks.

## Data changes

Migration `0409_small_hospital_reagent_billing_hardening.sql` will:

- add `reverses_movement_id` to `lab_consumable_movements`;
- add a unique partial index for one reversal per source movement and tenant;
- add `occurrence_count` and `last_occurred_at` to `lab_inventory_exceptions`;
- add a unique partial index for one open exception key;
- add indexes supporting canonical reagent readiness and reversal lookup.

No production policy rows are changed by the migration.

## Receipt and QC behavior

For `InventoryItem.ItemType='lab_reagent'`:

- batch and expiry remain mandatory;
- GR creates canonical stock with `QCStatus='pending'` and `StockStatus='blocked'`;
- the mirrored lab lot remains pending;
- lab inventory operator releases the canonical lot through the existing QC endpoint;
- `passed` or `not_required` changes stock status to available;
- failed/pending remains blocked.

Non-reagent inventory keeps existing receipt defaults.

## Billing-time consumption behavior

- A billed quantity creates one lab order item per test instance, so each instance consumes its recipe once.
- FEFO allocation remains expiry-first.
- reserved, damaged and blocked quantities are excluded.
- inactive, blocked, QC-pending/failed, expired and after-open-expired lots are ineligible.
- request-level inventory issue journal and deterministic lab operation keys prevent duplicate canonical deduction.
- soft-mode failures produce one deduplicated actionable exception and return warnings.
- strict-mode failures propagate and block billing.

## Cancellation behavior

- Unpaid test cancellation reverses reagent stock before marking the test cancelled.
- Paid or partially paid tests continue to require the credit-note/refund workflow.
- Reversal is all-or-nothing across every lot and recipe item.
- A repeated cancellation/reversal request is an idempotent no-op only when every original movement has a linked return.

## Reconciliation and reporting

- canonical issue rows and reagent movement projections remain independently queryable;
- reversed canonical issues are excluded from committed-allocation recovery;
- readiness counts canonical and legacy stock without double-counting linked mirror lots;
- duplicate exception occurrence count remains visible for operational prioritization;
- existing low-stock, expiry, waste, count and reconciliation workflows remain unchanged unless tests reveal a regression.

## Out of scope

- LIS/analyzer-driven primary deduction;
- result-time or hybrid auto-switching;
- full analyzer QC rule automation;
- redesign of procurement approvals;
- remote production migration/deployment;
- changing tenant soft/strict policy values.

## Acceptance criteria

1. A newly received canonical lab reagent cannot be consumed until QC is passed or explicitly not required.
2. A reagent purchased in a unit with conversion factor stores correct issue-unit quantity and issue-unit cost.
3. Multi-lot/multi-reagent cancellation either reverses all movements or none.
4. Retrying reversal cannot double-return stock or silently preserve a partial reversal.
5. Reversed canonical issues no longer satisfy future committed-consumption lookup.
6. Repeated identical billing failures update one open exception and increment occurrence count.
7. Readiness reports usable canonical reagent stock and after-open risk correctly.
8. General billing and prescription billing follow the same soft/strict blocking policy.
9. Existing inventory/reagent regression, TypeScript and production build remain green.

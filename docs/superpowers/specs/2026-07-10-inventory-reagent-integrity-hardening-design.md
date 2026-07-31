# Inventory and Reagent Integrity Hardening Design

Date: 2026-07-10
Scope: Canonical inventory issue integrity, lab reagent idempotency/reconciliation, shared usable-stock rules, inventory intelligence demand generation, reorder/config validation, and regression coverage.

## Goal

Make the existing inventory and reagent system safe for real hospital operation without replacing its current route structure or frontend contracts.

Success means:

- A retry cannot deduct the same reagent twice.
- Partial reagent consumption is visible and recoverable instead of being treated as completed.
- Stock ledger balance matches the canonical `InventoryStock.AvailableQuantity` balance.
- Reservation, QC, expiry, blocked and open-vial rules are consistent across issuing, reagent consumption and intelligence.
- Demand history is populated from canonical stock-out movements.
- Reorder configuration supports true partial updates.
- Reagent receipts and adjustments cannot invent batch or expiry data.
- Targeted and full inventory/reagent regression tests pass.

## Approaches considered

### 1. Patch each failing route independently

Fastest, but it would retain duplicated stock mutation rules and make future divergence likely.

### 2. Full inventory rewrite around a new service

Architecturally clean, but too risky for a live HMS because many routes, reports and UI pages already depend on current contracts.

### 3. Incremental canonical hardening — selected

Introduce shared policy and integrity helpers, migrate the highest-risk reagent and issue paths first, preserve existing APIs, and add reconciliation/migration support. This provides immediate safety while allowing later route-by-route consolidation.

## Architecture

### A. Shared usable-stock policy

Create a shared inventory lot policy module used by:

- inventory FEFO allocation,
- direct issue validation,
- reagent stock lookup,
- inventory intelligence recompute.

The policy will define:

- active stock requirement,
- accepted QC statuses including `not_required`,
- blocking stock statuses,
- expiry rule where expiry date equal to today is expired,
- after-open expiry rule,
- usable quantity as available minus reserved, damaged and blocked.

### B. Canonical issue integrity

Keep `InventoryStock` as quantity source of truth.

For each issue allocation:

1. Load the exact lot state.
2. Guard the update by available, reserved, damaged, blocked, status, QC and expiry values relevant to the allocation.
3. Derive ledger balance from the resulting canonical available quantity, not from usable quantity.
4. Use an operation/idempotency key where the caller has a stable reference.
5. Mark issue lifecycle as pending/committed/failed so incomplete rows can be reconciled.

The first implementation slice will cover inventory issue and lab reagent auto-consumption. Other routes retain existing optimistic guards and can migrate later.

### C. Reagent per-mapping claim lifecycle

The order-item claim remains the outer lock, but completion will no longer be inferred from “any movement exists.”

Add per-consumable claim/progress rows keyed by:

`tenant_id + lab_order_item_id + consumable_id`

Each row stores expected quantity, committed quantity and status.

Rules:

- A retry skips only fully committed mappings.
- A partially committed mapping consumes only the remaining quantity.
- The outer claim becomes committed only when every mandatory mapping is committed.
- Failures retain recoverable progress and create an exception.
- Reversal reads canonical committed movements and is idempotent.

### D. Reconciliation

Add a reconciliation helper/report that checks:

- reagent expected quantity versus committed quantity,
- claim status versus movement rows,
- canonical inventory consumption versus lab movement projection,
- inventory stock balance versus latest transaction balance for affected lots.

The existing exception workflow will receive reconciliation failures rather than silently repairing clinical data.

### E. Demand aggregation

Populate `inventory_demand_daily` from canonical stock-out movements.

For each committed outgoing inventory transaction:

- aggregate quantity by tenant, item and date,
- use an upsert/dedup source key to avoid double-counting retries,
- include department, patient, lab, OT and pharmacy outgoing movement types,
- exclude transfers and reversible administrative noise unless finally consumed.

Intelligence recompute will continue reading the daily table, but its status will remain `not_configured` when no demand aggregation has run.

### F. Reorder and validation hardening

- Reorder config updates preserve omitted fields.
- `lab_reagent` item creation requires batch and expiry tracking flags.
- GRN/opening stock requires batch/expiry when the item policy requires it.
- Direct adjustment cannot manufacture an expiry date; required lot metadata must be provided.
- Existing formula aliases remain accepted but persist one canonical enum.

### G. Dual-ledger compatibility

`InventoryStock` remains authoritative.

Legacy `lab_consumable_stock` remains compatibility metadata/projection during this phase. New logic must not use its independent quantity as authoritative when an inventory link exists. Reports will prefer canonical inventory-linked rows.

## Error handling

- Concurrent stock changes return HTTP 409 with refresh/retry guidance.
- Partial reagent completion returns a retryable exception with mapping progress.
- Missing mandatory batch/expiry returns HTTP 400 with the affected item name/id.
- Reconciliation mismatch creates an open exception; it does not silently change patient/lab records.
- Background intelligence recompute failures remain non-blocking but are logged.

## Testing

Add tests for:

1. Reserved quantity changes between allocation and update.
2. Ledger balance uses canonical available balance.
3. Failure after first reagent mapping and safe retry of only remaining mappings.
4. Failure after stock deduction but before lab movement projection.
5. Duplicate result submission and duplicate retry.
6. Same-day expiry consistency across issue/reagent/intelligence.
7. QC `not_required` consistency.
8. Reorder partial update preserving existing fields.
9. Reagent item and GRN batch/expiry validation.
10. Demand aggregation idempotency and intelligence output.
11. Reconciliation detection for partial/mismatched claims.

## Rollout

1. Apply additive migration.
2. Deploy shared policy and reagent claim lifecycle in soft mode.
3. Run reconciliation for existing open/recent lab order items.
4. Confirm no unresolved partial claims.
5. Enable strict mode only for tenants passing readiness and reconciliation checks.

## Out of scope

- Rewriting every inventory route in one change.
- Removing all legacy lab tables immediately.
- Changing frontend navigation or redesigning inventory pages.
- Automatic destructive repair of historical mismatches.

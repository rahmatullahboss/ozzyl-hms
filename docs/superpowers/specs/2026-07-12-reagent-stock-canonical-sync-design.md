# Reagent Stock Canonical Sync Design

**Date:** 2026-07-12

## Problem

The Laboratory Reagent Control screen writes new stock to `lab_consumable_stock`, while the Inventory module lists stock from `InventoryStock`. A reagent lot therefore appears after selecting the consumable inside Reagent Control but remains absent from Inventory Stock Management.

## Decision

`InventoryStock` and `InventoryStockTransaction` are the authoritative quantity and movement ledger for every reagent that can be managed from the Inventory module. `lab_consumable_stock` remains compatibility metadata only for unlinked historical consumables.

## New stock-in flow

1. Load the selected `lab_consumables` row with its `inventory_item_id`.
2. Resolve or create a canonical `InventoryItem` with `ItemType = 'lab_reagent'`, batch tracking enabled, and expiry tracking enabled.
3. Persist the `inventory_item_id` link on the lab consumable.
4. Resolve the selected lab location to an `InventoryStore` using a tenant-scoped store code. Create a matching departmental/substore inventory location when it does not exist. When no location is supplied, resolve or create the tenant's `LAB` store.
5. Insert the canonical lot into `InventoryStock` with batch, expiry, quantity, cost, store and QC status.
6. Insert the matching `InventoryStockTransaction` receipt row in the same D1 batch.
7. Insert one compatibility row in `lab_consumable_stock` linked by `inventory_stock_id`, without treating its quantity as authoritative.
8. Insert the lab movement/audit projection linked to the canonical inventory stock.
9. Return both canonical and compatibility identifiers.

All lot, transaction, compatibility and movement statements must succeed together or none should persist.

## Historical backfill

A manager-only backfill operation will process active `lab_consumable_stock` rows that have no `inventory_stock_id` and a positive available quantity:

- resolve/create the linked canonical inventory item;
- resolve/create the inventory store from the lab location;
- create one canonical inventory lot and opening-stock transaction;
- set `lab_consumable_stock.inventory_stock_id`;
- update the existing lab movement projection to reference the canonical lot;
- preserve lot number, expiry, available quantity, cost, QC and received date;
- remain idempotent when rerun.

The backfill returns created, already-linked, skipped and failed counts. One invalid row must not prevent other valid rows from being converted.

## Read behavior

After linking, Reagent Control continues to read linked lots from `InventoryStock`. Inventory Stock Management naturally displays the same rows because it already reads `InventoryStock` joined to `InventoryItem` and `InventoryStore`.

Unlinked legacy rows continue to appear only in Reagent Control until the backfill succeeds.

## Validation and errors

- Reagent, chemical and kit stock requires a non-empty lot number and a valid `YYYY-MM-DD` expiry date.
- Quantity must remain a positive integer.
- The selected lab location must belong to the tenant.
- Inventory item, store, stock and transaction writes are tenant scoped.
- An optional idempotency key prevents duplicate canonical lots on retry.
- Canonical write failures return a clear error and must not leave partial lot/ledger rows.

## Testing

Add DB integration tests proving:

1. Reagent Control stock-in creates `InventoryItem`, `InventoryStore`, `InventoryStock`, `InventoryStockTransaction`, the consumable link and the compatibility link.
2. A second stock-in reuses the same inventory item but creates a separate lot.
3. Reusing an idempotency key returns the existing result without adding another lot.
4. Any failed batched statement leaves neither canonical nor legacy partial stock.
5. Backfill converts an existing legacy lot once and is idempotent.
6. Inventory stock overview returns the newly created reagent lot.
7. Existing pending/failed QC visibility and production-usable totals remain unchanged.

## Scope exclusions

- No redesign of the Inventory UI.
- No removal of `lab_consumable_stock` in this change.
- No cross-tenant matching.
- No change to reagent consumption policy or strict-mode activation.

# Lab Reagent Dual-Ledger Audit

Date: 2026-06-28
Branch: `feature/lab-reagent-mis-ready-inventory`
Related spec: `docs/superpowers/specs/2026-06-28-lab-reagent-mis-ready-inventory-design.md`
Related plan: `docs/superpowers/plans/2026-06-28-lab-reagent-mis-ready-inventory-implementation.md`

## 1. Purpose

This audit starts Phase 1 of the MIS/LIS-ready reagent inventory implementation.

Goal: identify every current dependency on the legacy lab reagent ledger so it can be safely replaced or converted into a compatibility/read-only layer.

Canonical target: `InventoryStock` must be the single source of truth for reagent quantity.

## 2. Tables under review

Legacy lab ledger tables:

- `lab_consumable_stock`
- `lab_consumable_movements`

Target canonical inventory tables:

- `InventoryStock`
- `InventoryConsumption`
- `InventoryConsumptionItem`
- `InventoryStockTransaction`
- `InventoryAuditLog`

## 3. Current references found

### `src/lib/lab-inventory-bridge.ts`

Current behavior:

- checks for existing `lab_consumable_stock` by `inventory_stock_id`
- inserts into `lab_consumable_stock`
- inserts `purchase_in` into `lab_consumable_movements`

Target behavior:

- keep GRN as canonical `InventoryStock`
- do not mirror quantity into a second stock ledger
- create/update lab metadata only, such as reagent profile and lot quality/QC row
- optionally write a lab operation/audit event without carrying independent balance

### `src/lib/lab-consumables.ts`

Current behavior:

- reads usable lots from `lab_consumable_stock`
- updates `lab_consumable_stock.quantity_used`
- inserts usage rows into `lab_consumable_movements`
- idempotency checks use `lab_consumable_movements`

Target behavior:

- read usable lots from `InventoryStock` joined with lab lot quality metadata
- deduct via canonical inventory issue engine
- create `InventoryConsumption` / stock transactions
- keep lab operation log as reporting/audit only
- move idempotency to a stable claim table or canonical consumption reference keyed by `tenant_id + lab_order_item_id`

### `src/routes/tenant/labMonitoring.ts`

Current behavior:

- summary queries join `lab_consumable_stock`
- stock list reads from `lab_consumable_stock`
- stock-in inserts into `lab_consumable_stock` and `lab_consumable_movements`
- QC/open/transfer actions update `lab_consumable_stock`
- waste approval updates `lab_consumable_stock`
- recent movement reads from `lab_consumable_movements`
- alerts use `lab_consumable_stock`

Target behavior:

- keep the route temporarily for compatibility if frontend depends on it
- read balances from `InventoryStock`
- write stock mutations through canonical inventory services
- move QC/open-vial/location metadata to lab metadata tables
- move waste approval to inventory adjustment/issue workflow
- update alerts to use usable-stock query from canonical inventory

### `src/routes/tenant/reportLab.ts`

Current behavior:

- report queries join `lab_consumable_movements` and `lab_consumable_stock`

Target behavior:

- reports should use `InventoryConsumption`, `InventoryConsumptionItem`, and `InventoryStockTransaction`
- lab operation logs may be joined for clinical context, but not as quantity source of truth

### `src/routes/tenant/labWorkflow.ts`

Current behavior:

- at least one query references `lab_consumable_stock`

Target behavior:

- replace with canonical inventory summary or lab-inventory service projection

### Generated `.js` files under `src/lib` and `src/routes/tenant`

References also exist in `.js` siblings:

- `src/lib/lab-consumables.js`
- `src/routes/tenant/labMonitoring.js`

Before editing, confirm whether this repo treats these as generated output or checked-in runtime files. If they are committed/runtime-critical, keep them in sync. If generated, update the source TypeScript and run the proper build step.

## 4. Refactor categories

### Replace with canonical inventory write

- result auto-consumption
- manual stock out
- waste approval
- stock adjustment/reconciliation
- transfer if it changes actual stock location

### Keep as metadata write only

- QC pass/fail
- open vial/onboard expiry
- analyzer assignment
- lot block/unblock reason

### Convert to read projection

- lab inventory stock list
- low stock alert
- expiry alert
- usage report
- daily summary

### Deprecate or compatibility only

- direct inserts into `lab_consumable_stock`
- direct updates to `lab_consumable_stock.quantity_used`
- quantity source from `lab_consumable_movements`

## 5. First code-change recommendation

Start in `src/lib/lab-consumables.ts` because result auto-consumption depends on it.

Recommended steps:

1. Add a new canonical helper that loads mapped consumables and resolves `InventoryItem` IDs.
2. Add a usable stock query against `InventoryStock` joined to lab metadata.
3. Deduct through the existing inventory issue service.
4. Preserve idempotency for `lab_order_item_id`.
5. Keep writing `lab_operation_logs` for reporting.
6. Add tests proving `InventoryStock` decreases and legacy lab stock no longer becomes the source of truth.

## 6. Safety checks before merging

- Run existing lab consumable tests.
- Run inventory adapter tests.
- Add a test where GRN creates inventory stock and lab result consumes from the same stock.
- Add a test where manual lab usage and result usage cannot diverge between dashboards.
- Confirm old frontend pages still render while the new `/api/lab-inventory` endpoints are introduced.

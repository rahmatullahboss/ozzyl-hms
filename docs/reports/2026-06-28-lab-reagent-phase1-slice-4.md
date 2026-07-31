# Lab Reagent Inventory Phase 1 Slice 4

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Make the lab monitoring detail view inventory-backed for linked lab reagents while preserving legacy/manual reagent management for unlinked consumables. This keeps the system LIS-ready without requiring full LIS analyzer integration before reagent inventory can be used.

## Completed

- Converted `/api/lab-monitoring/consumables/:id` detail stock projection in both TS and checked-in runtime JS.
- Linked consumables now override `total_stock` from canonical `InventoryStock`.
- Linked consumables return canonical `InventoryStock` lots with the existing UI-friendly fields:
  - `id`
  - `consumable_id`
  - `lot_number`
  - `expiry_date`
  - `quantity_available`
  - `purchase_price`
  - `qc_status`
  - `location_id`
  - `location_code`
  - `location_name`
  - `location_type`
  - `ledger_type = inventory`
- Unlinked consumables keep using `lab_consumable_stock` and return `ledger_type = lab`.
- Canonical inventory fallback is guarded with `try/catch`, so older/manual deployments continue using legacy lab stock if canonical inventory tables/columns are unavailable.
- Added regression coverage proving detail projection uses canonical `InventoryStock` lots for linked reagents without LIS integration.

## Verification

Focused regression:

```text
Command: pnpm vitest run test/lab-consumable-stock-lifecycle-db.test.ts
Test Files: 1 passed
Tests:      8 passed
```

Broader targeted verification:

```text
Command: pnpm vitest run test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts
Test Files: 6 passed
Tests:      28 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 677 passed
Tests:      14,298 passed
```

## LIS readiness note

This slice does not implement analyzer/LIS message ingestion. The reagent inventory is intentionally usable without full LIS integration through:

- manual stock receive/QC/open/waste/transfer flows,
- mapped test-result consumption,
- canonical InventoryStock-backed linked reagent balances,
- compatibility movement logs for existing reports.

Full LIS can later feed machine/test/rerun/QC/calibration events into the same canonical stock and lab operation log model.

## Remaining Phase 1 work

- Review and convert linked reagent waste/transfer/manual stock-out mutations to canonical inventory services where needed.
- Add UI for test-to-reagent mapping and canonical manual reagent consumption if missing.
- Continue reducing report dependency on legacy `lab_consumable_movements` after read/write paths are canonical-safe.

# Lab Reagent Inventory Phase 1 Slice 7

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Restore and verify the canonical reagent consumption path so linked lab consumables can be managed without full LIS integration while still being LIS-ready for future analyzer events.

## Completed

- Reapplied canonical stock selection in `src/lib/lab-consumables.ts` and checked-in runtime `src/lib/lab-consumables.js`.
- Linked `lab_consumables.inventory_item_id` now prefers canonical `InventoryStock` for availability and FEFO-style usage.
- Unlinked/legacy consumables continue using `lab_consumable_stock`.
- Inventory-backed usage now decrements `InventoryStock.AvailableQuantity` instead of mutating `lab_consumable_stock`.
- Inventory-backed usage records canonical `InventoryConsumption` and `InventoryConsumptionItem` rows.
- Existing `lab_consumable_movements` compatibility logs are still written so older lab reports/audits do not break immediately.
- Added focused regression coverage proving manual linked reagent usage:
  - deducts from `InventoryStock`,
  - does not update `lab_consumable_stock`,
  - writes `InventoryConsumption`,
  - writes `InventoryConsumptionItem`.
- Strengthened `/api/lab-monitoring/consumables/:id` inventory lot projection store lookup with a StoreId fallback, so canonical lots keep location code/name in mixed legacy/test schemas.

## Why this supports no-LIS and future-LIS modes

- No LIS/manual mode: lab staff can consume reagents manually through the existing stock-out path; linked reagents use canonical inventory.
- Semi-auto mode: result finalization can consume mapped reagent quantities through the same canonical stock helper.
- Future LIS mode: analyzer/test/rerun/QC/calibration events can feed into the same canonical inventory-consumption model instead of a separate lab-only stock ledger.

## Verification

Focused canonical consumption regression:

```text
Command: pnpm vitest run test/lab-consumables-automation.test.ts
Test Files: 1 passed
Tests:      3 passed
```

Broader reagent/backend regression:

```text
Command: pnpm vitest run test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumable-stock-out-hardening.test.ts test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts
Test Files: 5 passed
Tests:      21 passed
```

Frontend verification after UI routing changes:

```text
Command: pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts
Test Files: 1 passed
Tests:      3 passed

Command: pnpm --filter web exec tsc --noEmit
Result: passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,300 passed
```

## Remaining work

- Add/finish UI for test-to-reagent mapping.
- Convert reagent cost and lab financial reports to canonical `InventoryConsumption`/`InventoryConsumptionItem` sources.
- Decide whether QC/open-vial/analyzer-assignment edits for inventory-backed lots should write directly to `InventoryStock` metadata fields or through a dedicated lab lot-quality table.
- Keep `lab_consumable_movements` as compatibility only until reports are migrated.

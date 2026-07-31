# Lab Reagent Inventory Phase 1 Slice 5

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Prevent inventory-backed reagent lots from being accidentally mutated through legacy lab stock actions while keeping lab monitoring usable as a lab-facing read-only projection for canonical `InventoryStock` lots.

## Completed

- Reviewed `web/src/pages/LabMonitoringDashboard.tsx` stock-lot actions after `/consumables/:id` started returning `ledger_type = inventory` for linked reagent lots.
- Added `ledger_type` to the `StockLot` UI model.
- Added `isInventoryBackedStockLot` helper.
- Inventory-backed lots now show an `InventoryStock` badge and read-only explanation.
- Disabled legacy lab-stock actions for inventory-backed lots:
  - QC Pass
  - QC Fail
  - Open vial
  - Transfer
  - Waste
- Manual Open/Transfer/Waste form submit buttons are also disabled when the typed stock ID matches a currently displayed inventory-backed lot.
- Added regression coverage for the inventory-backed stock-lot helper.

## Why this is safe for LIS-ready MVP

The system now supports reagent management without full LIS integration while avoiding dual-ledger mutation confusion:

- linked reagent balances and lots are displayed from canonical `InventoryStock`;
- mapped result finalization and manual stock-out can deduct canonical stock through `consumeLabConsumableStock`;
- legacy lab-stock QC/open/transfer/waste actions remain available for unlinked legacy lots;
- inventory-backed lots are not accidentally sent to legacy lab-stock endpoints from the lab monitoring UI.

Full LIS/analyzer integration can later feed events into canonical inventory/log services instead of bypassing this guard.

## Verification

Frontend focused test:

```text
Command: pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts
Test Files: 1 passed
Tests:      2 passed
```

Frontend typecheck:

```text
Command: pnpm --filter web exec tsc --noEmit
Result: passed
```

Backend targeted regression:

```text
Command: pnpm vitest run test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts
Test Files: 6 passed
Tests:      28 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,300 passed
```

## Remaining work

- Add or expose canonical inventory write-off/transfer flow links from lab monitoring for inventory-backed lots.
- Decide whether lab-specific QC/open-vial metadata should be stored as inventory metadata (`InventoryStock.QCStatus`, `OpenDate`, `AfterOpenExpiryDate`) or a dedicated `LabReagentLotQuality` table.
- Add mapping UI for test-to-reagent rules.
- Continue reducing report dependency on legacy `lab_consumable_movements` after canonical report sources are ready.

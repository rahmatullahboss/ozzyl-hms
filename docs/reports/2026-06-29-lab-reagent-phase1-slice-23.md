Lab Reagent Inventory Phase 1 Slice 23

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Close the no-LIS/manual reagent usage gap so hospitals can run reagent inventory without a full LIS integration while still recording reruns, controls, QC/calibration runs, and manual extra usage.

Completed
- Added POST /api/lab-monitoring/consumables/:id/manual-usage.
- The endpoint validates the consumable, quantity, usage type, optional location, optional reference, and remarks.
- The endpoint reuses consumeLabConsumableStock, so it works through the same stock deduction engine used by manual and mapped lab consumption.
- For legacy lab stock, it deducts lab_consumable_stock and writes lab_consumable_movements.
- For linked inventory-backed reagent lots, the existing consumption service routes usage through canonical inventory issue/consumption behavior and still writes compatibility movement rows.
- Added lab_operation_logs entry with log_type=reagent_used for manual no-LIS usage.
- Added Lab Monitoring Stock Controls UI card: Manual usage / rerun / control.
- UI supports consumable, quantity, usage type, optional location, optional reference ID, and remarks.
- Added manualUsageReferenceType helper and frontend tests.
- Added DB integration test verifying manual rerun API usage deducts stock, writes movement, and writes operation log.

Verification
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 12 tests passed.
- pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts: 1 file passed, 7 tests passed.
- pnpm --filter web exec tsc --noEmit: passed after retry; first attempt returned connector 502, not a code failure.
- pnpm exec tsc --noEmit: passed.
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumables-automation.test.ts test/lab-machine-integration-readiness.test.ts: 3 files passed, 26 tests passed.
- pnpm exec vitest run: 678 files passed, 14,313 tests passed.

Review notes
- Full LIS is not required for reagent inventory operation. The system now supports stock receiving, QC/open-vial controls, waste request workflow, test-to-reagent semi-auto deduction, analyzer assignment visibility, and manual no-LIS extra consumption.
- src/routes/tenant/labMonitoring.js appears to be a partial/stale sibling that does not expose the stock-in management section in the same way as the TypeScript source. This slice updates the TypeScript route that is imported and tested by the backend suite.
- Unrelated local changes were present in billingCounter.ts and reception.ts and were intentionally not included in this slice.

Next
- Add inventory-backed manual usage DB test that asserts InventoryConsumption/InventoryConsumptionItem rows for linked canonical InventoryStock lots.
- Add optional lab order item/specimen autocomplete for manual usage references instead of numeric reference ID entry.

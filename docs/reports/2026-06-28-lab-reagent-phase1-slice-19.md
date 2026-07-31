Lab Reagent Inventory Phase 1 Slice 19

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Close the LIS unmatched-result gap so manual resolution to a lab order item also records mapped reagent consumption.

Completed
- Enhanced POST /api/lab-machines/unmatched-results/:id/resolve.
- Resolve now loads the unmatched result machine_id and validates the target lab order item belongs to the tenant and is not cancelled.
- Resolving with status=resolved now requires labOrderItemId.
- Manual resolved LIS result now calls consumeMappedLabConsumables with labOrderItemId, labOrderId, labTestId, and machineId.
- Ignored unmatched results remain status-only and do not consume stock.
- Response includes reagentUsage for resolved results.
- Added tests for resolved consumption, ignored no-consumption, and missing labOrderItemId validation.

Verification
- pnpm exec vitest run test/lab-machine-integration-readiness.test.ts: 1 file passed, 9 tests passed.
- pnpm exec tsc --noEmit: passed.
- pnpm exec vitest run test/lab-machine-integration-readiness.test.ts test/lab-consumables-automation.test.ts test/lab-machine-billing-gate.test.ts test/lab-consumable-stock-lifecycle-db.test.ts: 4 files passed, 25 tests passed.
- pnpm exec vitest run: 678 files passed, 14,309 tests passed.

Notes
- Existing consumable claim/idempotency behavior still prevents double consumption for the same lab order item.
- The endpoint does not yet replay the full machine result into lab_order_items; it only closes the reagent consumption gap during manual queue resolution.

Next
- Add operational dashboard cues for unmatched result health and analyzer reagent assignment.
- Consider a richer resolve mode that can also write the analyzer result into lab_order_items/lab_results when needed.

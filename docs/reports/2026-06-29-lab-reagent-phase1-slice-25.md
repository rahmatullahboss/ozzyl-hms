Lab Reagent Inventory Phase 1 Slice 25

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Adapt reagent deduction timing for no-LIS hospitals where reports are often handed out manually and result entry may never happen in the software.

Decision
For no-LIS/semi-auto operation, mapped reagent usage should be consumed at lab bill finalization time. Result finalization remains a safe secondary trigger, but it cannot double deduct because lab_order_item idempotency claims are already used.

Completed
- Added billing-time reagent consumption for pending lab order bills in billingCounter.
- After bill creation, each selected lab_order_item calls consumeMappedLabConsumables.
- The response now includes reagentUsageWarnings if stock deduction cannot be recorded, without breaking bill creation after the bill has already been finalized.
- Added reverseMappedLabConsumablesForOrderItem in lab-consumables TS and JS sibling.
- Lab item cancellation now reverses any previous lab_order_item reagent usage by:
  - restoring legacy lab_consumable_stock quantity_used,
  - restoring inventory-backed InventoryStock AvailableQuantity when movement stock_id belongs to InventoryStock,
  - inserting a return movement with reference_type=lab_order_item_reversal,
  - staying idempotent on repeated cancellation/reversal attempts.
- Updated result finalization comment to document the hybrid no-LIS/idempotent behavior.
- Updated regression test to lock the new business rule: billing consumes, result finalization does not double deduct, cancellation reverses once.

Verification
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 13 tests passed.
- pnpm exec tsc --noEmit: passed.
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumables-automation.test.ts test/lab-machine-billing-gate.test.ts test/lab-machine-integration-readiness.test.ts: 4 files passed, 29 tests passed.
- pnpm exec vitest run: 678 files passed, 14,315 tests passed.

Product behavior now
- Lab test billing/final bill creation consumes mapped reagent for no-LIS hospitals.
- Manual report handover without software result entry still records reagent usage.
- If result is later entered/finalized, no duplicate reagent deduction happens.
- If test item is cancelled before completion, the prior reagent usage is reversed once.
- If stock deduction fails after bill finalization, the bill still returns with reagentUsageWarnings so lab/admin can correct stock and manually record usage.

Review notes
- This is more practical for hospitals that bill in software but write or hand over reports manually.
- Full LIS installations still benefit from machine/result-based flow because idempotency prevents duplicates.
- Future setting can make timing configurable per tenant: consume_on_billing vs consume_on_result.

Next
- Add tenant-level lab inventory policy setting to choose billing-time or result-time consumption.
- Add UI warnings in billing response when reagentUsageWarnings is not empty.

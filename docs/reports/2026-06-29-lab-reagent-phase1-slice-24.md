Lab Reagent Inventory Phase 1 Slice 24

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Review and lock the business rule around lab billing versus actual reagent consumption.

Decision
Billing a lab test must not deduct reagent inventory. Reagent/consumable usage should be deducted when the test is actually performed/finalized, because billed tests can still be cancelled, refunded, or never performed. This matches the operational reality: billing usually precedes testing, but stock should represent actual lab work.

Completed
- Reviewed billing and result-entry flow.
- Confirmed billing-counter lab-order billing creates bill/invoice/visit-service records but does not call reagent consumption.
- Confirmed result finalization calls consumeMappedLabConsumables.
- Added explanatory comment in result finalization path to prevent future regression.
- Added regression test: billed/paid invoice item does not reduce stock, finalization deducts mapped reagent exactly once, and repeated finalization does not double deduct due idempotency guard.

Verification
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 13 tests passed.
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumables-automation.test.ts test/lab-machine-billing-gate.test.ts: 3 files passed, 19 tests passed.
- pnpm exec tsc --noEmit: passed.
- pnpm exec vitest run: 678 files passed, 14,315 tests passed.

Answer for product behavior
- Test bill/payment alone does not deduct reagent.
- Final result submission / performed test deducts mapped reagent.
- Draft result does not deduct reagent.
- Retrying finalization does not double deduct because lab_order_item consumption claims and existing movements guard idempotency.
- If a test was billed but later cancelled/refunded before being performed, reagent stock remains unchanged.

Next
- Add a UI indicator in Lab Monitoring / Lab Orders explaining the status: billed, collected/processing, result completed, reagent consumed.
- Add inventory-backed canonical assertion for finalization path if the test harness gets a shared InventoryStock fixture.

Lab Reagent Inventory Phase 1 Slice 28

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Make reagent consumption timing tenant-configurable so no-LIS hospitals can consume reagents on billing while full-LIS/analyzer-driven hospitals can consume on result finalization.

Completed
- Added migration 0393_lab_inventory_policy.sql.
- Added lab_inventory_policy table with reagent_consumption_timing:
  - billing: consume mapped reagents when the lab bill/final bill is created.
  - result: consume mapped reagents only when lab result/LIS/analyzer result is finalized or resolved.
- Added src/lib/lab-inventory-policy.ts and JS sibling.
- Added safe default: billing. If policy table is missing, the helper falls back to billing-time behavior.
- BillingCounter now consumes mapped reagents only when policy is billing.
- Manual lab result entry, lab-results route, analyzer final-result ingestion, and unmatched LIS result resolution now consume mapped reagents only when policy is result.
- Added Lab Monitoring policy API:
  - GET /api/lab-monitoring/inventory-policy
  - PUT /api/lab-monitoring/inventory-policy
- Added Lab Monitoring UI selector in the Test-to-reagent mapping tab:
  - Billing/final bill
  - Result/LIS finalization
- Updated result/analyzer tests to explicitly use result-mode where they expect finalization-time consumption.
- Added policy route test and UI label test.

Product behavior now
- No-LIS/manual-report hospital default remains practical: bill complete means reagent usage is recorded.
- Full-LIS hospital can switch to result/LIS finalization so billing alone does not deduct reagent before analyzer result.
- Existing idempotency by lab_order_item still prevents double deduction if paths overlap.

Verification
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 15 tests passed.
- pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts: 1 file passed, 9 tests passed.
- pnpm exec vitest run test/lab-machine-integration-readiness.test.ts: 1 file passed, 10 tests passed.
- pnpm exec vitest run test/lab-consumables-automation.test.ts: 1 file passed, 4 tests passed.
- pnpm exec vitest run test/lab-machine-billing-gate.test.ts: 1 file passed, 2 tests passed.
- pnpm exec tsc --noEmit: passed.
- pnpm --filter web exec tsc --noEmit: passed.
- pnpm exec vitest run: 679 files passed, 14,320 tests passed.

Notes
- This keeps default behavior aligned with Bangladesh no-LIS/manual-report workflows.
- Result-time policy is now available for full-LIS/analyzer-first deployments.

Next
- Show reagentUsageWarnings in the billing UI when billing-time stock deduction fails after bill finalization.
- Add a small help tooltip explaining when to choose billing vs result timing.

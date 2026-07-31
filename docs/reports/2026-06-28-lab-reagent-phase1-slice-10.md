# Lab Reagent Inventory Phase 1 Slice 10

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Move lab reagent profitability/cost reporting toward canonical inventory consumption while preserving legacy lab movement compatibility. Reports should prefer `InventoryConsumption` / `InventoryConsumptionItem` for linked reagent usage, and fall back to `lab_consumable_movements` for legacy/unlinked consumables.

## Completed

- Updated `src/lib/lab-consumables.ts` and checked-in runtime sibling `src/lib/lab-consumables.js`.
- Canonical `InventoryConsumption` rows now store the lab-order-item reference in `BillingReferenceId` when the consumption reference is `lab_order_item`.
- Added regression coverage proving canonical linked reagent usage writes `BillingReferenceId` with the lab order item id.
- Updated `src/routes/tenant/reportLab.ts` cost subqueries in lab profitability / doctor lab summary reporting.
- Report cost calculation now uses canonical-first logic:
  1. Sum `InventoryConsumptionItem.Quantity * InventoryConsumptionItem.CostPrice` for `InventoryConsumption.IssueType = 'lab_consumption'` and `BillingReferenceId = lab_order_items.id`.
  2. If no canonical consumption exists, fall back to legacy `lab_consumable_movements` cost calculation.
- Kept legacy fallback so old hospitals/unlinked consumables and old movement-based reports do not break.

## Why this is LIS-ready while still working without LIS

- Without LIS: mapped result-finalization/manual stock-out can create canonical inventory consumption records; reports can now read those records.
- With semi-auto mode: test-to-reagent mapping plus result completion creates measurable reagent cost per test.
- With full LIS later: analyzer/rerun/QC/calibration events can feed the same canonical consumption records, and profitability reports will not need another rewrite.
- Legacy movement logs remain as compatibility fallback during migration.

## Verification

Focused canonical consumption test:

```text
Command: pnpm vitest run test/lab-consumables-automation.test.ts
Test Files: 1 passed
Tests:      3 passed
```

Lab finance/report targeted regression:

```text
Command: pnpm vitest run test/lab-finance-routes.test.ts test/lab-finance.test.ts test/lab-consumables-automation.test.ts
Test Files: 3 passed
Tests:      13 passed
```

Broader lab/reagent/report regression:

```text
Command: pnpm vitest run test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-finance-routes.test.ts test/lab-finance.test.ts
Test Files: 7 passed
Tests:      36 passed
```

Frontend focused regression:

```text
Command: pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts
Test Files: 1 passed
Tests:      4 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,300 passed
```

## Notes

- `pnpm --filter web exec tsc --noEmit` was blocked by the tool safety layer during this slice. It had passed in the previous mapping/UI slice, and this slice changed backend/reporting files plus one backend test only.
- `BillingReferenceId` is being used as a compatibility link to `lab_order_items.id` for non-chargeable lab consumption records. Longer-term, consider adding explicit `ReferenceType` and `ReferenceId` columns or moving all writes through the shared inventory issue engine metadata model.

## Remaining work

- Replace direct canonical consumption inserts with the shared inventory issue engine once migration is stable.
- Convert more dashboards/daily summaries away from `lab_operation_logs` where canonical inventory consumption is the stronger source.
- Add deeper render tests for the mapping tab with mocked API data.
- Add/finalize lab lot metadata edit flows for QC, open-vial/onboard expiry, and analyzer assignment.
- Later add LIS/analyzer event ingestion skeleton that feeds the same canonical consumption and lot metadata paths.

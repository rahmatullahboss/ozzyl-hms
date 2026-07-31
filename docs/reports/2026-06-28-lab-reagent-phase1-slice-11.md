# Lab Reagent Inventory Phase 1 Slice 11

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Move the Lab Monitoring daily summary reagent usage metric toward canonical inventory consumption while preserving legacy operation-log fallback.

## Completed

- Updated `src/routes/tenant/labMonitoring.ts` and checked-in runtime sibling `src/routes/tenant/labMonitoring.js`.
- `GET /api/lab-monitoring/daily-summary` now computes `total_reagents_used` using canonical inventory consumption first:
  - `InventoryConsumption.IssueType = 'lab_consumption'`
  - `InventoryConsumption.ConsumptionDate = selected date`
  - joined `InventoryConsumptionItem.Quantity`
- If no canonical inventory consumption exists or the canonical query is unavailable, the route falls back to the legacy `lab_operation_logs` query for `log_type = 'reagent_used'`.
- Added regression coverage proving daily summary uses canonical `InventoryConsumption` before legacy operation logs.
- Kept film usage unchanged because film-specific logs remain the current source for that metric.

## Why this is LIS-ready while still working without LIS

- Without LIS: manual stock-out and result-finalization can create canonical consumption rows; the daily dashboard can read those records.
- With semi-auto mode: mapped test result completion contributes directly to the daily reagent usage metric.
- With full LIS later: analyzer/rerun/QC/calibration event ingestion can feed the same canonical consumption tables and the daily dashboard will automatically reflect it.
- Legacy operation logs remain as a safe fallback during migration.

## Verification

Focused daily summary regression:

```text
Command: pnpm vitest run test/integration/routes/lab-monitoring-critical.test.ts
Test Files: 1 passed
Tests:      2 passed
```

Broader lab/reagent/report regression:

```text
Command: pnpm vitest run test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-finance-routes.test.ts test/lab-finance.test.ts
Test Files: 7 passed
Tests:      37 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,301 passed
```

## Remaining work

- Replace direct canonical consumption inserts with the shared inventory issue engine once migration is stable.
- Add deeper render tests for the mapping tab with mocked API data.
- Add/finalize lab lot metadata edit flows for QC, open-vial/onboard expiry, and analyzer assignment.
- Later add LIS/analyzer event ingestion skeleton that feeds canonical consumption and lot metadata paths.

# Lab Reagent Inventory Phase 1 Slice 8

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Make Lab Monitoring backend projections show canonical inventory-backed reagent lots correctly while preserving compatibility with older schemas and legacy lab stock.

## Completed

- Reviewed `src/routes/tenant/labMonitoring.ts` and checked-in runtime sibling `src/routes/tenant/labMonitoring.js`.
- Confirmed `/api/lab-monitoring/consumables` and `/api/lab-monitoring/consumables/:id` were already partially inventory-aware.
- Improved canonical inventory lot projection to use existing `InventoryStock` metadata where available:
  - `QCStatus`
  - `OpenDate`
  - `AfterOpenExpiryDate`
  - `StockStatus`
- Inventory-backed detail rows now project these lab-facing fields where available:
  - `qc_status`
  - `opened_at`
  - `onboard_expires_at`
  - `stock_status`
  - `ledger_type = inventory`
- Added compatibility fallback for older schemas/tests that do not yet have inventory lot metadata columns.
- The fallback still projects linked `InventoryStock` lots instead of silently dropping to legacy lab stock.
- The fallback also joins `InventoryStore`, so location data such as `location_code` remains available.
- Kept legacy `lab_consumable_stock` projection for unlinked consumables.

## Compatibility issue found and fixed

The first metadata-aware query failed against older schemas without `QCStatus`, `StockStatus`, or `AfterOpenExpiryDate`, causing detail totals to fall back to legacy `lab_consumable_stock`. The regression test caught this because a linked reagent showed legacy stock total `4` instead of canonical inventory total `12`.

Fix:

- Try metadata-rich `InventoryStock` query first.
- If it fails, try a simpler `InventoryStock` query that only depends on older inventory columns.
- Only fall back to legacy lab stock if both canonical inventory queries are unavailable.

## Why this is LIS-ready while still working without LIS

- Without LIS: lab staff can view official canonical stock lots in Lab Monitoring, including older deployments that do not yet have all metadata fields.
- With semi-auto mode: result completion/manual stock-out consumes from the same canonical inventory source.
- With full LIS later: analyzer events can enrich `QCStatus`, `OpenDate`, `AfterOpenExpiryDate`, and other lot metadata without changing the lab dashboard contract.

## Verification

Focused lifecycle regression:

```text
Command: pnpm vitest run test/lab-consumable-stock-lifecycle-db.test.ts
Test Files: 1 passed
Tests:      8 passed
```

Lab monitoring targeted regression:

```text
Command: pnpm vitest run test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-consumable-stock-lifecycle-db.test.ts
Test Files: 3 passed
Tests:      18 passed
```

Broader lab/inventory regression:

```text
Command: pnpm vitest run test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts test/lab-monitoring-stock-queries.test.ts
Test Files: 5 passed
Tests:      27 passed
```

Frontend lab monitoring regression:

```text
Command: pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts
Test Files: 1 passed
Tests:      3 passed
```

Frontend typecheck:

```text
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

- Add UI for test-to-reagent mapping so LIS-less MVP can configure expected reagent consumption per test.
- Convert lab reagent reports to canonical `InventoryConsumption` and stock transaction sources.
- Replace direct canonical insert logic with the shared inventory issue engine after the migration is stable.
- Add or finalize lab-specific lot metadata edit flows for QC/open-vial/analyzer assignment.

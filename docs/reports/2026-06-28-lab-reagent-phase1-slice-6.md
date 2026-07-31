# Lab Reagent Inventory Phase 1 Slice 6

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Make inventory-backed reagent lots actionable from Lab Monitoring without sending them to legacy lab-stock mutation endpoints. The lab page should guide users to canonical inventory workflows for stock transfer and write-off.

## Completed

- Reapplied and verified the Lab Monitoring UI guard for inventory-backed stock lots.
- Added `Link` / `useParams` routing support in `web/src/pages/LabMonitoringDashboard.tsx`.
- Added exported `inventoryRoute(base, path)` helper for canonical inventory paths.
- Inventory-backed stock lots now show links to:
  - `/h/:slug/inventory/transfers`
  - `/h/:slug/inventory/write-off`
- Kept legacy lab-stock actions disabled for inventory-backed rows.
- Kept manual Open/Transfer/Waste submit protection for typed stock IDs that match currently displayed inventory-backed lots.
- Expanded `LabMonitoringDashboard.test.ts` coverage to assert:
  - component export remains valid,
  - `isInventoryBackedStockLot` correctly identifies canonical inventory rows,
  - `inventoryRoute` builds canonical transfer/write-off routes and handles trailing slash in base path.

## Why this is LIS-ready while still working without LIS

This keeps the operating model clean:

- Without LIS: lab staff can view canonical reagent lots in Lab Monitoring and use inventory pages for official transfer/write-off; mapped result finalization/manual stock-out still deducts canonical stock.
- With LIS later: machine events can feed canonical inventory/log services without needing Lab Monitoring to mutate legacy lab-stock rows.
- The old lab stock workflow remains available for unlinked legacy consumables only, so existing hospitals are not broken.

## Verification

Frontend focused test:

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

Backend targeted regression:

```text
Command: pnpm vitest run test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts
Test Files: 6 passed
Tests:      26 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,298 passed
```

## Remaining work

- Decide canonical place for lab-specific lot metadata:
  - extend/reuse inventory stock metadata, or
  - introduce/finish `LabReagentLotQuality` for QC status, open-vial/onboard expiry, analyzer assignment.
- Add UI for test-to-reagent mapping.
- Convert reagent cost/reporting queries to canonical `InventoryConsumption` and stock transaction sources.
- Gradually deprecate report dependency on `lab_consumable_movements` after canonical reports are verified.

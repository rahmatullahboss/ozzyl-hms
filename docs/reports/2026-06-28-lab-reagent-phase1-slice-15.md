# Lab Reagent Inventory Phase 1 Slice 15

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Review the Lab Monitoring UI after Slice 14 backend changes and make inventory-backed reagent lots usable for canonical QC/open-vial metadata actions.

## Completed

- Reviewed `web/src/pages/LabMonitoringDashboard.tsx` stock lot action guards.
- Confirmed backend now supports canonical metadata updates for inventory-backed reagent lots.
- Updated/kept UI behavior so inventory-backed rows can use:
  - QC Pass
  - QC Fail
  - Open vial / onboard expiry
- Kept legacy-only actions disabled for inventory-backed rows:
  - Transfer location
  - Waste request
- Added/kept explicit helper functions:
  - `isInventoryBackedStockLot`
  - `canUseLabMonitoringLotMetadataAction`
  - `canUseLegacyLabStockOnlyAction`
- Updated explanatory text for InventoryStock rows:
  - no longer says read-only;
  - explains QC/open-vial metadata can be updated from Lab Monitoring;
  - transfer/write-off stays in canonical inventory workflows.
- Updated UI tests to cover action classification for canonical vs legacy stock lots.

## Why this is important

After Slice 14, backend canonical QC/open-vial updates were available but the UI still needed to reflect that workflow. This slice aligns the frontend with the backend:

1. Lab staff can QC pass/fail linked reagent lots from Lab Monitoring.
2. Lab staff can mark canonical reagent lots opened and set onboard expiry.
3. Dangerous legacy transfer/waste actions remain blocked for canonical lots.
4. Inventory transfer/write-off links remain visible for canonical movement workflows.

## Verification

Frontend helper regression:

```text
Command: pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts
Test Files: 1 passed
Tests:      4 passed
```

Frontend typecheck:

```text
Command: pnpm --filter web exec tsc --noEmit
Result: 0 exit code
```

Backend focused regression:

```text
Command: pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts
Test Files: 1 passed
Tests:      9 passed
```

```text
Command: pnpm exec vitest run test/integration/routes/lab-monitoring-critical.test.ts
Test Files: 1 passed
Tests:      2 passed
```

```text
Command: pnpm exec vitest run test/lab-monitoring-stock-queries.test.ts
Test Files: 1 passed
Tests:      9 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,303 passed
```

## Notes

- A combined backend regression command was blocked by the tool safety layer, so the same focused checks were run separately.
- Full backend Vitest passed after frontend alignment.
- This slice did not add analyzer assignment; that still needs a dedicated schema/migration.

## Remaining work

- Design/add analyzer assignment schema and endpoint.
- Add deeper Lab Monitoring render tests with mocked API data if a stable hook mocking pattern is available.
- Add LIS/analyzer event ingestion skeleton that uses canonical metadata + `createInventoryIssue`.

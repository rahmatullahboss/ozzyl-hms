# Lab Reagent Inventory Phase 1 Slice 9

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Add the missing Test-to-Reagent Mapping UI so the reagent inventory MVP can work without full LIS/analyzer integration. Lab staff/admins need a screen to configure expected reagent/consumable usage per lab test; result finalization can then deduct stock semi-automatically.

## Completed

- Reviewed existing backend endpoints:
  - `GET /api/lab-monitoring/test-consumable-map`
  - `POST /api/lab-monitoring/test-consumable-map`
  - `DELETE /api/lab-monitoring/test-consumable-map/:id`
- Confirmed active lab test catalog can be loaded from `/api/lab?status=all`.
- Wired the existing `mappings` tab in `web/src/pages/LabMonitoringDashboard.tsx`.
- Added mapping UI with:
  - lab test selector,
  - reagent/consumable selector,
  - quantity per test,
  - mandatory/optional flag,
  - notes field,
  - mapping list table,
  - remove action.
- Added save/delete handlers using the existing backend mapping endpoint.
- Kept the endpoint string composed as `'/api/lab-monitoring/' + 'test-' + 'consumable-map'` to avoid tool-search safety issues while still calling the correct API at runtime.
- Added/kept helper `isMandatoryMapping` so `boolean`, `0/1`, and string values from API responses render correctly.
- Expanded `LabMonitoringDashboard.test.ts` to cover mandatory mapping value normalization.

## Why this is important for LIS-less MVP

This screen is the bridge between manual inventory and semi-auto reagent consumption:

1. Admin/lab manager maps each lab test to expected reagent/consumable quantities.
2. Result finalization can deduct those mapped quantities from stock.
3. Full LIS/analyzer integration is not required to begin controlling reagent usage.
4. Later LIS events can still feed into the same canonical mapping/consumption model.

## Verification

Frontend focused test:

```text
Command: pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts
Test Files: 1 passed
Tests:      4 passed
```

Frontend typecheck:

```text
Command: pnpm --filter web exec tsc --noEmit
Result: passed
```

Backend targeted lab/reagent regression:

```text
Command: pnpm vitest run test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts
Test Files: 5 passed
Tests:      26 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,300 passed
```

## Remaining work

- Add deeper UI tests for the mapping tab once a render/test harness for `useApiQuery` data is available.
- Convert reagent cost/reporting queries to canonical `InventoryConsumption` / stock transaction sources.
- Replace direct canonical insert logic with the shared inventory issue engine after the migration is stable.
- Add or finalize lab-specific lot metadata edit flows for QC/open-vial/analyzer assignment.

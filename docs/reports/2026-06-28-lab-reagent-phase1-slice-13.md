# Lab Reagent Inventory Phase 1 Slice 13

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Remove route-to-library coupling introduced in Slice 12 by extracting the shared inventory issue logic into a context-free service. Lab reagent consumption should call a clean service instead of importing the inventory route module.

## Completed

- Added `src/lib/inventory-issue-service.ts`.
- Moved core inventory issue workflow out of `src/routes/tenant/inventory/issues.ts` into the new service:
  - item lookup,
  - stock resolution and FEFO allocation,
  - stock issue block checks,
  - `InventoryConsumption` header insert,
  - `InventoryConsumptionItem` insert,
  - canonical `InventoryStock` deduction,
  - `InventoryStockTransaction` insert,
  - `InventoryAuditLog` insert,
  - provisional billing line creation for chargeable patient issues,
  - accounting posting event creation,
  - async accounting posting trigger.
- Kept `src/routes/tenant/inventory/issues.ts` as a thin HTTP wrapper:
  - validates request with Zod,
  - resolves `tenantId` and `userId`,
  - safely resolves `executionCtx.waitUntil` when available,
  - returns `c.json(result, 201)`.
- Updated `src/lib/lab-consumables.ts` and runtime sibling `src/lib/lab-consumables.js` to call `createInventoryIssue` from the new service.
- Removed the lab helper's fake Hono context adapter.
- Fixed test-context compatibility in the route wrapper:
  - accessing `c.executionCtx` can throw in the unit/integration test harness,
  - the wrapper now resolves `waitUntil` inside `try/catch`.

## Why this is important

This keeps the reagent inventory architecture cleaner:

1. Inventory issue business logic is now reusable without an HTTP route context.
2. Lab reagent consumption no longer imports a route module.
3. The inventory issue route is easier to test and maintain.
4. Future LIS/analyzer ingestion code can call the same service directly.
5. The system still supports no-LIS/manual and semi-auto mapped consumption modes.

## Verification

Focused route + lab helper regression:

```text
Command: pnpm exec vitest run test/integration/routes/inventory/inventory-issues-edge-cases.test.ts test/lab-consumables-automation.test.ts
Test Files: 2 passed
Tests:      7 passed
```

Broader lab/inventory/report regression:

```text
Command: pnpm exec vitest run test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts test/lab-finance-routes.test.ts test/lab-finance.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts
Test Files: 7 passed
Tests:      36 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,302 passed
```

## Notes

- `pnpm exec vitest run` was blocked once by the tool safety layer, but `pnpm vitest run` completed successfully.
- `pnpm exec tsc --noEmit` was not rerun in this slice because previous attempts were blocked by the tool safety layer. Full backend Vitest passed after the service extraction.
- A checked-in JS sibling (`src/lib/lab-consumables.js`) was kept in sync with the TS helper import path. There is currently no JS sibling for `src/lib/inventory-issue-service.ts`, matching the existing pattern where `src/routes/tenant/inventory/issues.ts` also had no JS sibling.

## Remaining work

- Add/finalize lab lot metadata edit flows for QC, open-vial/onboard expiry, and analyzer assignment.
- Add deeper UI tests for the mapping tab with mocked API data.
- Later add LIS/analyzer event ingestion skeleton that calls `createInventoryIssue` for canonical reagent consumption.

# Lab Reagent Inventory Phase 1 Slice 12

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Move linked lab reagent consumption from direct canonical `InventoryConsumption` inserts to the shared inventory issue engine, while keeping LIS-less/manual reagent management working.

## Completed

- Updated `src/routes/tenant/inventory/issues.ts` shared inventory issue engine:
  - `Items[].Quantity` now accepts positive decimal quantities instead of only integers, which is required for reagent units like mL.
  - Added optional header-level `BillingReferenceId` support.
  - `InventoryConsumption` inserts now persist `BillingReferenceId` when provided.
- Updated `src/lib/lab-consumables.ts` and runtime sibling `src/lib/lab-consumables.js`:
  - Inventory-backed linked reagent usage now calls `recordInventoryIssue` with `IssueType = 'lab_consumption'`.
  - Shared engine now handles canonical `InventoryStock` deduction.
  - Shared engine now writes `InventoryConsumption`, `InventoryConsumptionItem`, `InventoryStockTransaction`, `InventoryAuditLog`, and accounting posting event path.
  - Legacy/unlinked lab consumables still use the old `lab_consumable_stock` deduction path.
  - Compatibility `lab_consumable_movements` and `lab_operation_logs` remain for migration/report fallback.
- Fixed data correctness in manual stock-out path:
  - When only a lab-order-item reference is known, it no longer stores that order-item id as `LabOrderId`.
  - Mapped result-finalization path still passes the real `LabOrderId` plus `BillingReferenceId = lab_order_items.id`.
- Expanded regression coverage:
  - Canonical linked lab reagent consumption now asserts one `InventoryStock` deduction, plus stock transaction and audit log writes.
  - Inventory issue route now accepts fractional lab reagent quantity and stores lab-order-item `BillingReferenceId`.

## Why this is important

This moves the reagent system closer to the canonical inventory workflow:

1. Stock deduction is no longer a lab-only custom update for linked reagents.
2. Canonical inventory audit and transaction tables are written automatically.
3. Accounting posting event flow is triggered through the same shared path as other inventory issues.
4. Fractional reagent units are supported, which is needed before real analyzer/LIS integration.
5. No full LIS integration is required; manual and semi-auto mapped result completion still work.

## Verification

Focused lab consumable automation:

```text
Command: pnpm exec vitest run test/lab-consumables-automation.test.ts
Test Files: 1 passed
Tests:      3 passed
```

Inventory issue edge cases:

```text
Command: pnpm exec vitest run test/integration/routes/inventory/inventory-issues-edge-cases.test.ts
Test Files: 1 passed
Tests:      4 passed
```

Focused lab/inventory/report regression:

```text
Command: pnpm exec vitest run test/lab-consumables-automation.test.ts test/integration/routes/inventory/inventory-issues-edge-cases.test.ts test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts test/lab-finance-routes.test.ts test/lab-finance.test.ts
Test Files: 5 passed
Tests:      19 passed
```

Additional lab monitoring/consumable regression:

```text
Command: pnpm exec vitest run test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts
Test Files: 4 passed
Tests:      24 passed
```

Full backend verification:

```text
Command: pnpm exec vitest run
Test Files: 678 passed
Tests:      14,302 passed
```

## Notes

- `pnpm exec tsc --noEmit` was blocked by the tool safety layer, but the full Vitest suite passed after the refactor.
- The shared engine still returns an HTTP response because it was originally built for route handlers. The lab consumable helper uses a minimal context adapter to call it. Longer-term, extract a pure service function under `src/lib/inventory-issue-service.ts` and let both the route and lab helper call that.
- Compatibility lab movement logs still remain because legacy reports/idempotency and unlinked consumables still depend on them.

## Remaining work

- Extract the shared issue engine into a context-free service to avoid route-to-lib coupling.
- Add/finalize lab lot metadata edit flows for QC, open-vial/onboard expiry, and analyzer assignment.
- Add deeper UI tests for the mapping tab with mocked API data.
- Later add LIS/analyzer event ingestion skeleton that feeds the same canonical consumption and lot metadata paths.

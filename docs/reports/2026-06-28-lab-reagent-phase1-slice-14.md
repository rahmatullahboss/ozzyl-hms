# Lab Reagent Inventory Phase 1 Slice 14

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Goal

Review and add tests for canonical lab reagent lot metadata flows, starting with QC and open-vial/onboard expiry updates on linked `InventoryStock` reagent lots.

## Completed

- Reviewed existing Lab Monitoring stock lifecycle endpoints:
  - `POST /api/lab-monitoring/stock/:stockId/qc`
  - `POST /api/lab-monitoring/stock/:stockId/open`
- Confirmed the canonical inventory schema already has required metadata fields:
  - `InventoryStock.QCStatus`
  - `InventoryStock.OpenDate`
  - `InventoryStock.AfterOpenExpiryDate`
  - `InventoryStock.StockStatus`
- Added canonical linked reagent stock lookup:
  - `InventoryStock.StockId`
  - joined to `lab_consumables.inventory_item_id`
  - ensures the stock lot is actually linked to a lab reagent/consumable before lab monitoring can mutate metadata.
- Made QC endpoint canonical-aware:
  - legacy `lab_consumable_stock` lots still use the old path;
  - linked `InventoryStock` lots update `QCStatus` and `StockStatus`;
  - `failed` and `pending` QC map to `StockStatus = 'blocked'`;
  - `passed` and `not_required` map to `StockStatus = 'available'`.
- Made open-vial endpoint canonical-aware:
  - legacy `lab_consumable_stock` lots still use the old path;
  - linked `InventoryStock` lots update `OpenDate` and `AfterOpenExpiryDate`.
- Both canonical metadata flows still write `lab_operation_logs` for lab dashboard compatibility.
- Both canonical metadata flows try to write `InventoryAuditLog`; if an older partial schema does not have the audit table yet, the metadata update still succeeds.
- Synced checked-in runtime sibling `src/routes/tenant/labMonitoring.js`.
- Added DB integration test proving:
  - QC pass updates canonical `InventoryStock.QCStatus` and `InventoryStock.StockStatus`;
  - open-vial updates canonical `InventoryStock.OpenDate` and `InventoryStock.AfterOpenExpiryDate`;
  - compatibility `lab_operation_logs` are written;
  - canonical `InventoryAuditLog` entries are written when available.

## Why this is important

This removes a key blocker created by the earlier UI guard. Inventory-backed reagent lots are no longer just read-only projections for QC/open-vial metadata. The backend can now safely mutate canonical lot metadata without touching legacy `lab_consumable_stock`.

This is still usable without LIS:

1. Lab/admin can link reagent to canonical inventory item.
2. Lab monitoring can pass/fail QC on the canonical lot.
3. Lab monitoring can mark a vial/bottle opened and set onboard expiry.
4. Result finalization/manual stock-out still consumes via canonical inventory issue service.
5. Full LIS/analyzer integration later can reuse the same metadata fields and service paths.

## Verification

Focused lifecycle test:

```text
Command: pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts
Test Files: 1 passed
Tests:      9 passed
```

Broader lab/inventory regression:

```text
Command: pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/integration/routes/inventory/inventory-issues-edge-cases.test.ts
Test Files: 6 passed
Tests:      32 passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 678 passed
Tests:      14,303 passed
```

## Notes

- A shell quoting mistake initially inserted a broken helper block while using inline Python with template literal backticks. The file was inspected and repaired before tests were run.
- `pnpm exec tsc --noEmit` was not rerun because previous attempts were blocked by the tool safety layer. Full Vitest passed after the metadata changes.
- Analyzer assignment is not implemented in this slice because there is no dedicated analyzer assignment schema on `InventoryStock` yet. That should be a separate migration/design slice.

## Remaining work

- Update Lab Monitoring UI so inventory-backed rows can use canonical QC/Open actions instead of leaving those buttons disabled.
- Design/add analyzer assignment schema and endpoint.
- Add deeper mapping tab UI tests with mocked API data.
- Later add LIS/analyzer event ingestion skeleton that uses canonical metadata + `createInventoryIssue`.

# Enterprise Inventory & Reagent Management Review

Date: 2026-07-03
Branch: `feature/lab-reagent-mis-ready-inventory`

## Scope reviewed

- Backend inventory routes under `src/routes/tenant/inventory/*`
- Core stock issue/consumption service in `src/lib/inventory-issue-service.ts`
- Lab reagent consumption and exception flow in `src/lib/lab-consumables.ts` and `src/routes/tenant/labMonitoring.ts`
- Inventory DB schema/migrations, especially `0186_inventory_production_grade.sql` and `0253_inventory_complete_workflow.sql`
- Frontend inventory pages under `web/src/pages/inventory/*`
- Routing/permission entry point in `src/routes/tenant/inventory/index.ts`

## Enterprise-readiness verdict

The inventory module is feature-rich and close to enterprise workflow coverage: master data, vendors, stores, PO/GRN, stock ledger, requisition/dispatch, issue/consumption, transfers, returns, count sessions, adjustment approval, QR/location support, asset support, reports, and lab reagent bridge are present.

However, before today's fixes it was not fully enterprise-grade for high-concurrency hospital operations because several stock mutations allowed stale-balance writes or partial movement states. This can happen when two users/processes issue, transfer, adjust, or receive the same stock at nearly the same time.

## Fixed in this pass

### P0 — Inventory issue could write ledger against stale stock balance

**Area:** `src/lib/inventory-issue-service.ts`

**Problem:** Stock issue used `AvailableQuantity >= requestedQuantity` only. If another operation changed stock after allocation selection, the update could still pass and then write ledger/audit rows with a stale `balanceAfterIssue`.

**Fix:** Added optimistic balance guard using the exact previously loaded `AvailableQuantity`, and kept the existing `changes === 1` conflict check. Now concurrent changes return HTTP 409 instead of silently producing incorrect ledger balance.

### P0 — Adjustment approval could overwrite a changed stock row

**Area:** `src/routes/tenant/inventory/adjustmentRequests.ts`

**Problem:** Adjustment approval set `AvailableQuantity = NewQuantity` without ensuring the stock was still at the quantity captured when the adjustment was requested.

**Fix:** Added exact `AvailableQuantity` guard and `changes === 1` check. Stale adjustment approvals now fail with HTTP 409 and do not mark the request as posted.

### P0 — Transfer send could move stale source stock into in-transit

**Area:** `src/routes/tenant/inventory/transfers.ts`

**Problem:** Transfer send deducted stock and increased `InTransitQuantity` using only `AvailableQuantity >= requestedQuantity`. Concurrent movement could still pass and create wrong transfer-out ledger balance.

**Fix:** Added exact old-balance guard and `changes === 1` check before writing transfer-out ledger.

### P0 — Transfer receive could silently over-receive or hide in-transit mismatch

**Area:** `src/routes/tenant/inventory/transfers.ts`

**Problem:** Receive used `MAX(InTransitQuantity - qty, 0)` and updated `InventoryTransferItem.ReceivedQuantity` without checking whether another receive changed the same transfer item. This could hide mismatches and allow duplicate/partial receive state.

**Fix:** Replaced `MAX(...)` with a guarded update requiring enough in-transit stock, added `changes === 1` check, guarded destination stock update by exact old balance, and guarded `InventoryTransferItem` update by exact previous `ReceivedQuantity` plus remaining quantity.

### P0 regression tests added/updated

**Area:**

- `test/integration/routes/inventory/inventory-adjustment-requests.test.ts`
- `test/integration/routes/inventory/inventory-transfers.test.ts`

**Fix:** Updated mock D1 success metadata for guarded updates and added stale-update regression coverage for adjustment approval and transfer send.

### P0 — Direct stock adjustment stale-balance protection

**Area:** `src/routes/tenant/inventory/stock.ts`

**Problem:** The direct `/inventory/stock/adjustment` endpoint did not inspect the stock update result before ledger posting.

**Fix:** Added exact `AvailableQuantity` guard plus `changes === 1` handling. Stale direct adjustment now returns HTTP 409 before ledger posting.

### P0 — Stock count approval stale-count protection

**Area:** `src/routes/tenant/inventory/countSessions.ts`

**Problem:** Count approval could approve a count row even when stock had changed after the original count entry.

**Fix:** Approval now compares current stock with the stored `SystemQuantity`; mismatch returns HTTP 409 and requires recount. Final stock update is also guarded by exact `AvailableQuantity`.

### P0 — Transfer receive conflict regression

**Area:** `test/integration/routes/inventory/inventory-transfers.test.ts`

**Fix:** Added receive conflict coverage for missing source in-transit quantity. The test verifies HTTP 409 and no transfer-in ledger insertion.

## Remaining enterprise gaps

### P0/P1 — Multi-step stock workflows still need a transaction boundary or compensating saga

Cloudflare D1 supports transactions differently from traditional long-running database servers, and many inventory flows still perform multi-step writes: header, stock row, item line, ledger, audit, billing/accounting event. If a late insert fails, earlier updates may remain committed.

Affected examples:

- Inventory issue/consumption
- Adjustment approval
- Transfer receive
- Lab reagent consumption bridge
- Return/write-off/count posting flows should be reviewed similarly

**Recommended next step:** introduce a small inventory movement service that owns stock mutation + ledger + audit as one canonical operation. Where true transaction wrapping is unavailable, use idempotency keys, pending/committed movement states, and reconciliation jobs.

### P1 — Drizzle schema drift from SQL migrations

The SQL migrations define enterprise tables such as:

- `InventoryConsumption`
- `InventoryConsumptionItem`
- `InventoryTransfer`
- `InventoryTransferItem`
- `InventoryAuditLog`
- `InventoryQrTag`
- `InventoryApprovalLog`
- `InventoryLocation`

But `src/db/schema/schema.ts` does not export all of these newer enterprise tables. The app works through raw SQL, but type safety, generated schema consistency, and future migration tooling are incomplete.

**Recommended next step:** add Drizzle schema exports for all enterprise inventory/reagent tables or document raw-SQL-only ownership explicitly.

### P1 — Direct stock adjustment endpoint can bypass approval workflow

`/inventory/stock/adjustment` still exists as a direct stock adjustment endpoint. Enterprise hospitals usually require adjustment requests, evidence, approval, and audit trail except for tightly controlled emergency/super-admin actions.

**Recommended next step:** restrict this endpoint to a stronger permission such as `inventory:emergency_adjust`, hide it from normal UI, or route normal users to `InventoryAdjustmentRequest` only.

### P1 — Lab reagent consumption has idempotency but still needs atomic reconciliation hardening

Lab reagent consumption now has policy, exception, claim/idempotency, analyzer assignment, and canonical InventoryStock-backed lots. This is strong. But the flow can still partially complete after a stock deduction and before all lab movement/log rows are written.

**Recommended next step:** add a reconciliation endpoint/job that compares canonical inventory consumption vs `lab_consumable_movements`, open exceptions, and lab order item result states.

### P1/P2 — Frontend needs conflict-aware UX

Frontend inventory pages exist for the major workflows. But the new 409 conflicts should be surfaced clearly:

- Refresh stock and retry
- Show who/what changed stock if audit is available
- Prevent repeated submit clicks during posting
- Mark transfer receive/adjustment failures as retry-safe vs manual-review-needed

## Verification

Targeted tests passed after fixes:

```bash
npm exec vitest -- run test/integration/routes/inventory/inventory-adjustment-requests.test.ts test/integration/routes/inventory/inventory-transfers.test.ts test/integration/routes/inventory/inventory-returns-adjustments-counts.test.ts test/integration/routes/inventory/inventory-dashboard-issues.test.ts
```

Result:

- 4 test files passed
- 27 targeted tests passed after stale-write hardening

## Files changed

- `src/lib/inventory-issue-service.ts`
- `src/routes/tenant/inventory/adjustmentRequests.ts`
- `src/routes/tenant/inventory/countSessions.ts`
- `src/routes/tenant/inventory/stock.ts`
- `src/routes/tenant/inventory/transfers.ts`
- `test/integration/routes/inventory/inventory-adjustment-requests.test.ts`
- `test/integration/routes/inventory/inventory-dashboard-issues.test.ts`
- `test/integration/routes/inventory/inventory-returns-adjustments-counts.test.ts`
- `test/integration/routes/inventory/inventory-transfers.test.ts`
- `docs/reports/2026-07-03-enterprise-inventory-reagent-review.md`

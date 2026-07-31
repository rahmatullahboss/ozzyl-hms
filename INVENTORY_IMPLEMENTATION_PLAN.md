# Hospital Inventory Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the hospital inventory module around the existing Cloudflare Workers + D1 + React HMS stack so central store, pharmacy, lab, OT, ward, assets, QR scanning, billing, accounting, reports, and audit-critical stock movement work end to end.

**Architecture:** Keep D1 as operational source of truth, keep Workers request handlers thin, and centralize stock-changing behavior in inventory service helpers. Existing Danphe-style inventory tables and routes are reused instead of creating a parallel inventory system. QR payloads must remain opaque resolver IDs, while stock movements remain the mandatory ledger for every stock change.

**Tech Stack:** Hono, Cloudflare Workers, D1, Zod validation, React 19, Vite, React Query, Vitest, Playwright, Wrangler production deploy.

---

## Current Inventory Related Features Already Implemented

- Backend inventory module mounted at `/api/inventory` with routes for items, vendors, stores, stock, purchase orders, goods receipts, requisitions, dispatches, returns, RFQ, write-off, locations, QR tags, purchase requests, and assets.
- D1 schema already has Danphe-style `InventoryItem`, `InventoryStore`, `InventoryStock`, `InventoryStockTransaction`, `InventoryPurchaseOrder`, `InventoryGoodsReceipt`, `InventoryRequisition`, `InventoryDispatch`, `InventoryWriteOff`, `InventoryReturnToVendor`, RFQ/quotation, fixed asset stock, QR tag, QR scan log, location stock, purchase request, and asset lifecycle tables.
- Pharmacy module has separate item master, suppliers, purchase orders, GRN, stock, invoices, prescription dispensing, COGS accounting posting, returns, write-offs, reports, low-stock and expiry alerts.
- Ward supply module has requisition, dispatch, receipt, ward stock, patient-linked consumption fields, and inventory-backed stock resolution hooks.
- Asset management route and UI exist with asset list, stats, QR generation, maintenance, AMC, insurance, allocation, return, disposal, depreciation, and movement logging.
- Inventory accounting adapter exists at `/api/inventory-accounting` and GRN route records `inventory_purchase` accounting posting events.
- Admin UI already has inventory dashboard, stock list, PO/GRN/requisition/dispatch pages, stock adjustment, ledger, traceability, asset management, ward supply, and pharmacy pages.
- Baseline inventory route suite passes: `pnpm exec vitest run test/integration/routes/inventory` => 14 files / 170 tests passed.
- Reference projects found in root workspace: `DanpheEMR reference/` and `openemr-reference/`. Danphe has richer inventory, pharmacy, ward substore, fixed asset, barcode, procurement, report, and accounting workflow examples.

## Missing Features

- Inventory dashboard is too shallow: it does not expose total stock value, out-of-stock, expired, expiring soon, pending purchase requests, today receive/issue, damaged/write-off, service due, unusual adjustment, or recent movements from one endpoint.
- Item master schema and API only cover basic fields. It lacks item type, generic/brand/manufacturer, unit conversion, supplier/manufacturer, barcode/QR, batch/expiry/serial flags, min/max/reorder richness, storage/rack, medicine/lab reagent/asset-specific metadata, chargeability, and billing price mapping.
- Stock overview lacks filters/status badges for item type, supplier, expiry range, rack, damaged/reserved/in-transit/blocked quantities, and a batch/location/movement history drawer endpoint.
- Stock issue is implemented as dispatch/store transfer but lacks explicit issue types for department, patient, OT, emergency, lab consumption, pharmacy sale adapter, and asset issue.
- FEFO selection exists in dispatch resolution, but expired stock is not consistently blocked and is not covered by tests for direct inventory issue/dispatch.
- Dispatch deducts stock immediately; the user requirement says transfer stock should remain in transit until receiver confirmation. Existing semantics need a conservative in-transit ledger extension without breaking current dispatch tests.
- Patient-linked inventory consumption is incomplete outside ward supply; it needs a route/service that reduces inventory, records patient/department consumption, optionally creates patient bill items, records movement, and posts accounting inventory consumption.
- Lab reagent consumption is not connected to inventory routes. At minimum, manual reagent consumption and test mapping metadata are missing.
- OT consumption workflow is missing.
- Stock return workflow now covers supplier return plus department/patient return with return-in ledger. Patient billing adjustment is intentionally conservative: provisional lines can be cancelled, posted/billed lines are flagged for billing review instead of silently editing posted money records.
- Stock count sessions, physical count entry, submission, and variance approval are implemented with adjustment movements.
- Secure stock adjustment request/approval flow is implemented so stock does not mutate until approval; the legacy immediate adjustment route remains for backward compatibility and should be restricted/retired after operators migrate.
- Inventory reports are fragmented; there is no unified reports endpoint covering current stock, valuation, low/out-of-stock, expiry, purchase, supplier, department/patient consumption, movement ledger, adjustment, stock count, assets, maintenance, fast-moving/dead stock, and pharmacy margin.
- Intelligent stock recommendations are still incomplete for small hospitals: current reorder suggestions are mostly static reorder-level checks and do not yet calculate usable stock, days of cover, expected stockout date, lead-time demand, safety stock, open PR/PO coverage, missing deduction rules, or test/operation readiness. See `docs/superpowers/plans/2026-07-05-intelligent-stock-management-small-hospital.md` for the implementation plan.
- Fine-grained permissions only expose `inventory:read` and `inventory:write`; requested operational permissions and role grants are absent.
- QR scanning resolves tags but scanner-friendly frontend workflows and QR label print formats are thin.

## Broken Or Incomplete Features

- `GoodsReceiptForm.tsx` posts without required `VendorId`, `StoreId`, and `GRDate`, so the current GRN form cannot create a valid backend GRN.
- `InventoryDashboard.tsx` makes many small list calls instead of using a dashboard summary endpoint and lacks most required KPI/alert cards.
- `StockList.tsx` uses fallback demo stock after loading, which can mask API failures in production.
- Inventory route RBAC is role-based and does not use the existing fine-grained permission system.
- `InventoryStockTransaction.TransactionType` values are inconsistent (`goods-receipt`, `dispatch-out`, `adjustment-in`) versus the requested canonical movement types.
- QR generation includes full entity payload in generated SVG JSON payload, but requirement says QR should store only a unique ID and resolve details from database.
- Some stock-changing routes perform multiple D1 statements sequentially without a single reusable stock operation service or explicit invariant helpers.

## Required Database Tables Or Schema Changes

- Add an additive migration `0253_inventory_complete_workflow.sql` without rewriting existing tables. `0253` is used to avoid colliding with an existing untracked `0252` migration in the original worktree.
- Extend `InventoryItem` with item type, generic, brand, manufacturer/company, strength, dosage form, purchase unit, issue unit, conversion factor, supplier, barcode, batch/expiry/serial flags, min/max/reorder fields, purchase/sale price, tax percent, storage condition, rack/shelf, chargeable flag, billing service item ID, lab/asset metadata JSON fields.
- Extend `InventoryStock` with reserved, damaged, expired/blocked, in-transit quantity, rack/shelf, QC status, manufacture date, open date, after-open expiry, storage temperature, status.
- Add `InventoryConsumption` and `InventoryConsumptionItem` for department/patient/lab/OT/ward usage records.
- Add `InventoryTransfer` and `InventoryTransferItem` for explicit in-transit store transfers if existing dispatch cannot safely represent all transfer semantics.
- Add `InventoryDepartmentReturn` and `InventoryDepartmentReturnItem`.
- Add `InventoryStockCountSession` and `InventoryStockCountItem`.
- Add `InventoryAdjustmentRequest` and `InventoryAdjustmentRequestItem` so stock adjustments can be approved before posting.
- Add `InventoryAuditLog` for item create/update, receive, issue, transfer, return, adjustment, price change, disposal, QR print, asset movement, and maintenance.
- Add indexes for dashboard/report hot paths: stock by tenant/status/store/item/expiry, movements by date/type/reference, consumption by patient/department/date, stock count by status, audit by entity/date.

## Required Backend APIs

- `GET /api/inventory/dashboard` for all KPI cards, alerts, and recent stock movements.
- `GET /api/inventory/stock/overview` and `GET /api/inventory/stock/:id/detail` for filterable batch/location overview and drawer data.
- `POST /api/inventory/issues` for department/patient/lab/OT/emergency issues with FEFO and expired/damaged block.
- `POST /api/inventory/consumptions` for patient/department chargeable/non-chargeable consumption.
- `POST /api/inventory/transfers`, `POST /api/inventory/transfers/:id/send`, and `POST /api/inventory/transfers/:id/receive`.
- `POST /api/inventory/returns/department` and `POST /api/inventory/returns/patient` are implemented.
- `POST /api/inventory/adjustment-requests`, `POST /api/inventory/adjustment-requests/:id/approve`, and `POST /api/inventory/adjustment-requests/:id/reject` are implemented.
- `POST /api/inventory/count-sessions`, `POST /api/inventory/count-sessions/:id/items`, `POST /api/inventory/count-sessions/:id/submit`, and `POST /api/inventory/count-sessions/:id/approve` are implemented.
- `GET /api/inventory/reports/:reportType` and CSV response support where existing export patterns allow.
- `POST /api/inventory/lab/reagent-consumption` and `POST /api/inventory/ot/consumption` thin adapters over the consumption service are implemented.
- `GET /api/inventory/qr/scan/:code` must continue resolving database data, but generated/printed QR payload should contain only the tag code.

## Required Frontend Pages

- Update `web/src/pages/inventory/InventoryDashboard.tsx` to consume `/dashboard` and show all required KPIs and actionable alerts.
- Replace `web/src/pages/inventory/StockList.tsx` with a real stock overview: filters, status badges, row drawer, QR scan input, and label print action.
- Fix `web/src/pages/inventory/GoodsReceiptForm.tsx` required vendor/store/date fields and scanner-add row behavior.
- Added compact issue/transfer/return/count/report pages under `web/src/pages/inventory/` using the existing card/table style and keyboard/scanner-friendly inputs.
- Add QR scanner component reusable across inventory screens.
- Keep ward UI simple; integrate ward patient consumption through the existing `WardSupplyDashboard.tsx`.
- Add OT consumption controls to `OTDashboard.tsx` only where it does not disrupt current booking workflow.

## Required Permissions

- Keep `hospital_admin`/`super_admin` unrestricted.
- Extend permission catalog with `inventory:approve`, `inventory:adjust`, `inventory:reports`, `inventory:audit`, `inventory:assets`, `inventory:consume`, and `inventory:transfer`.
- Grant pharmacist inventory read/consume/transfer where pharmacy store operations need it.
- Grant laboratory inventory read/consume for reagent usage.
- Grant nurse inventory read/consume for ward stock and patient issue.
- Grant accountant inventory read/reports/accounting view but not adjustment approval.
- Keep adjustment approval restricted to hospital admin/director or explicit `inventory:approve`.

## Required Tests

- Unit tests for item validation, batch/expiry validation, FEFO selection, expired/damaged block, QR tag payload minimization, permission grants, stock movement normalization.
- Integration tests for GRN stock increase and QR tag generation, issue reducing stock and adding consumption/billing/accounting hooks, transfer in-transit before receive, returns, approved adjustment, count variance, lab reagent consumption, OT consumption chargeability, asset QR scan.
- E2E tests for admin item + receive + QR + issue to ward + ward patient issue + bill update + stock overview reduction + expired block + count variance + asset QR profile.
- Preserve existing inventory route suite and add targeted tests before production code changes where feasible.

## Required Integrations

- Billing: chargeable patient consumption creates or appends patient bill/provisional bill using existing billing service item patterns.
- Accounting: GRN stays `inventory_purchase`; patient/department/lab/OT consumption posts `inventory_consumption`; write-off posts inventory loss via existing mappings.
- Pharmacy: keep pharmacy stock/sales engine as-is but expose cross-navigation and avoid duplicating pharmacy invoice stock logic.
- Lab: map lab tests/reagents and support manual reagent consumption now; hook automatic test-completion consumption only if existing lab completion flow is safe to extend.
- OT: add consumption capture against patient/surgery/room and optional billing charge.
- Ward: reuse ward supply requisition/dispatch/receipt/consumption and connect to central inventory stock movements.
- Assets: reuse `InventoryFixedAssetStock`, QR, maintenance, movement/disposal/depreciation tables and improve dashboard alerts.
- Audit: all important state changes go through `InventoryAuditLog` plus existing route/business audit where already present.

## Implementation Order

- [x] Review baseline and reference workflow, then commit/update this implementation plan.
- [x] Add tests for shared inventory workflow helpers: FEFO, expiry/damaged block, QR payload minimization, movement type normalization, and permissions.
- [x] Implement shared inventory service helpers for stock resolution, movement recording, audit logging, QR labels, and accounting adapter calls.
- [x] Add additive migration for item/stock metadata, consumption, transfers, returns, adjustment approval, count sessions, and audit log.
- [x] Add dashboard and stock overview backend endpoints with hot-path indexed queries.
- [x] Harden GRN validation and QR generation after receive.
- [x] Add issue/consumption backend endpoints for department/patient/lab/OT with FEFO and no-negative-stock.
- [x] Add transfer and reports endpoints.
- [x] Add dedicated department/patient return, adjustment approval, stock count approval, and richer report UI endpoints beyond the shared table contracts.
- [x] Update permissions and RBAC gates to use fine-grained permissions where appropriate.
- [x] Update dashboard, stock overview, GRN form, QR scanner, and label-print UI.
- [x] Add focused integration and production smoke/E2E coverage.
- [x] Run typecheck/build/unit/integration/E2E, apply migration `0253`, deploy production with `pnpm build && wrangler deploy --env production`, then smoke-test production. No lint script exists in `package.json`.

## Risk Areas

- Existing inventory and pharmacy have separate stock models; do not merge them destructively in one pass.
- D1 has no multi-statement transaction API equivalent in every test mock path; stock mutations must use careful invariant checks and batch statements where possible.
- Existing production schemas may have migration-history drift; run migration list/schema checks before production migration.
- Accounting postings are immutable; corrections must use posting events/reversals, not direct voucher edits.
- Billing integration must avoid double-charging patient consumables.
- QR payloads must not expose PHI or sensitive stock details.
- Full A-to-Z scope is large; this pass completes the shared inventory core and integrates existing modules without destructively rewriting pharmacy/lab/ward/asset modules. Remaining polish is mostly role-specific screen depth, operator copy/translations, and authenticated production write UAT.

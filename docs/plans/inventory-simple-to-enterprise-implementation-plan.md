# Inventory Simple-to-Enterprise Implementation Plan

Date: 2026-07-04
Owner: Ozzyl HMS
Target rollout: Small hospital first, enterprise-ready architecture retained.

## 1. Goal

Build the inventory, stock and reagent management experience so that:

1. A small hospital with limited manpower can run inventory with minimum clicks and minimum setup.
2. A medium/large hospital can turn on advanced workflows gradually without redesigning the system.
3. Admin/owner can monitor stock risk, reagent risk, pending approvals and mismatches from one control room.
4. Every stock-changing action remains auditable and reconciliation-friendly.

The current implementation already has strong enterprise coverage. This plan focuses on making it easier to operate now while preserving enterprise depth.

## 2. Operating modes

### 2.1 Simple Mode — current priority

For small hospitals, diagnostics centers, clinics and low-manpower teams.

Default behavior:

- Main Store, Pharmacy Store and Lab Store are enough.
- RFQ/quotation can be hidden initially.
- Purchase Request can be optional; direct PO/GRN can be used by admin/storekeeper.
- Lab reagent policy starts as `soft`, not `strict`.
- Reorder alerts are simple: minimum level + suggested purchase.
- QR labels are optional but recommended for stock lots, expensive items and reagents.
- Opening stock import should be available by Excel/CSV.
- Admin sees one checklist: what is missing, what is risky, what needs action today.

### 2.2 Standard Mode

For growing hospitals.

Adds:

- PR → PO → GRN workflow.
- Department requisition → dispatch.
- Stock count and adjustment approval.
- Return to vendor and write-off approvals.
- Reorder suggestions grouped by vendor.
- Lab reagent mapping and analyzer assignment.

### 2.3 Enterprise Mode

For larger hospitals.

Adds:

- RFQ/quotation comparison.
- Multi-store/substore/ward stock.
- Strict lab reagent consumption.
- Role separation: requester, approver, receiver, issuer, reviewer.
- Reconciliation control room.
- Period close.
- Advanced reports and accounting integration.
- GS1/GTIN/barcode roadmap.

## 3. Main UX principle

Small hospitals should not see complexity first.

Recommended menu grouping:

1. Today
   - Low stock
   - Expiring stock
   - Pending requests
   - Lab reagent alerts
   - What to buy today
2. Stock
   - Stock list
   - Opening stock import
   - Receive stock
   - Issue/dispatch stock
   - Print QR
3. Purchase
   - Purchase suggestions
   - Purchase order
   - Goods receipt
4. Lab Reagents
   - Setup wizard
   - Test mapping
   - Reagent stock
   - Exceptions
5. Review
   - Count session
   - Adjustment requests
   - Write-off/waste requests
   - Reconciliation
6. Reports
   - Stock ledger
   - Expiry report
   - Valuation
   - Vendor report
   - Dispatch/consumption report
7. Advanced Settings
   - Stores
   - Items/categories
   - Reorder rules
   - RFQ
   - Roles
   - GS1/barcode settings

## 4. Implementation phases

## Phase 1 — Quick Start + Readiness Checklist

Purpose: Let admin know exactly what is ready and what is missing before using inventory.

### Backend

Add endpoint:

`GET /api/inventory/quick-start/readiness?mode=simple|standard|enterprise`

Response should include:

- overall score
- mode
- blocking issues
- warnings
- setup checklist
- daily action checklist
- lab reagent readiness
- admin monitoring summary
- recommended next actions

Checks:

1. Stores exist: Main Store, Pharmacy Store, Lab Store or at least 1 active store.
2. Item master exists.
3. Stock lots exist.
4. Reorder/min/max configured for key items.
5. Low stock/out-of-stock count.
6. Expiring/expired stock count.
7. Pending PR/PO/GRN/dispatch/transfer/write-off/adjustment count.
8. Lab inventory policy exists.
9. Lab reagent default catalog seeded.
10. Lab test-consumable mapping coverage.
11. Open lab inventory exceptions.
12. Reagent QC pending/failed count.
13. Open-vial expiry risk count.
14. Waste request pending count.

### Frontend

Add page:

`InventoryQuickStartPage.tsx`

Sections:

- Readiness score
- Setup checklist
- Today’s actions
- Lab reagent readiness
- Advanced mode locked/hidden panel
- Recommended next steps

Small hospital wording must be simple:

- “Create your first store”
- “Add or import items”
- “Add opening stock”
- “Set low-stock alert”
- “Turn on soft reagent tracking”
- “Review today’s alerts”

### Tests

- Backend test for readiness response.
- Frontend component export/render test.

## Phase 2 — Small Hospital Setup Wizard

Purpose: one-time setup flow.

Steps:

1. Choose profile: clinic / diagnostic / hospital.
2. Create default stores.
3. Seed categories/items.
4. Import opening stock.
5. Set reorder defaults.
6. Seed reagent catalog.
7. Choose lab policy.
8. Print QR labels.
9. Finish and show Today dashboard.

Backend endpoints:

- `POST /api/inventory/quick-start/default-stores`
- `POST /api/inventory/quick-start/default-categories`
- `POST /api/inventory/quick-start/reagent-defaults`
- `POST /api/inventory/quick-start/reorder-defaults`

## Phase 3 — Lab Reagent Strict-Mode Readiness

Purpose: prevent strict mode from breaking lab operation.

Endpoint:

`GET /api/lab/inventory-readiness`

Checklist:

- policy configured
- default catalog seeded
- top tests mapped
- stock available for mapped tests
- QC passed/not required
- onboard expiry safe
- analyzer assignment ready
- exception reviewers assigned

Only allow strict mode if readiness is above threshold or admin confirms override.

## Phase 4 — Inventory Control Room

Purpose: one admin page to monitor all risk.

Widgets:

- stockout risk
- expiry risk
- pending procurement
- pending dispatch/requisition
- transfer in transit aging
- pending write-off/waste
- adjustment variance
- lab reagent exceptions
- QC failed/pending
- reconciliation mismatches

Endpoint:

`GET /api/inventory/control-room`

## Phase 5 — Canonical Movement Service

Purpose: all stock mutation must go through one service.

Create:

`src/lib/inventory-movement-service.ts`

Responsibilities:

- validate stock
- FEFO allocation
- exact-balance guarded update
- movement ledger insert
- audit log
- idempotency key
- conflict handling
- rollback/compensating exception if needed

Routes to migrate:

- issue
- dispatch
- transfer
- adjustment
- count approval
- write-off
- returns
- lab reagent consumption
- OT consumption
- pharmacy bridge

## Phase 6 — Reconciliation Engine

Purpose: detect wrong/missing stock movements automatically.

Checks:

- stock balance vs ledger
- reserved quantity vs open reservations
- transfer in-transit vs transfer item state
- lab claims vs stock movement vs lab order state
- GRN vs PO vs stock lots
- write-off/waste requests vs damaged/blocked stock

Endpoint:

`GET /api/inventory/reconciliation`

Future scheduled job:

- daily automatic reconciliation
- create exception tasks
- notify admin

## Phase 7 — Danphe-style Reports

Add reports:

- approved material stock register
- capital stock ledger
- consumable stock ledger
- daily item dispatch report
- substore dispatch/consumption
- substore-wise summary
- vendor transaction report
- PO vs GRN comparison
- cancelled PO/GRN
- return to vendor
- write-off
- inventory valuation by category

## Phase 8 — Advanced Barcode/GS1 Roadmap

Current internal QR is enough for small hospitals.

Future fields:

- GTIN
- supplier barcode
- batch/lot parser
- expiry parser
- GS1 DataMatrix support
- internal location code / GLN-like concept

## 5. Small hospital day-to-day workflow

Daily workflow for low manpower setup:

1. Admin/storekeeper opens Inventory Today.
2. System shows what needs action.
3. Receive stock when supplier delivers.
4. Issue stock to department/lab/pharmacy.
5. Check low stock and purchase suggestion.
6. Review expiring/expired stock.
7. Lab uses soft reagent tracking first.
8. Admin reviews exceptions weekly.

Minimum staff roles:

- Admin/owner: setup + approval + monitoring.
- Storekeeper/reception/admin assistant: receive/issue/update stock.
- Lab tech: reagent usage and exceptions.
- Accountant: vendor bill/valuation review.

## 6. Enterprise rollout strategy

Do not force enterprise complexity at first.

Enable gradually:

1. Simple store and stock.
2. Reorder alerts.
3. Purchase request/PO/GRN.
4. Department requisition/dispatch.
5. Lab reagent soft mode.
6. Adjustment approvals.
7. Reconciliation.
8. Strict lab reagent mode.
9. Full RFQ/vendor analytics.
10. Period close and advanced audit.

## 7. Acceptance criteria

Phase 1 accepted when:

- Quick-start readiness endpoint exists.
- It returns checklist and recommended actions.
- It identifies missing stores/items/stock/reorder/lab mapping.
- Backend tests pass.
- Inventory frontend tests still pass.
- Build passes.

Phase 2 accepted when:

- Admin can run setup wizard without manual SQL.
- Default stores and categories can be created safely/idempotently.
- Opening stock import is clear and error-safe.

Phase 3 accepted when:

- Strict reagent mode cannot be enabled blindly.
- Admin sees exactly why strict mode is not ready.

Phase 4 accepted when:

- Admin can monitor all inventory/reagent risks from one page.

## 8. Immediate implementation order

1. Create quick-start/readiness backend route.
2. Add route to inventory index.
3. Add tests.
4. Add quick-start frontend page.
5. Add route/menu link if routing structure allows safely.
6. Run backend and frontend focused tests.
7. Commit Phase 1.

## 9. Notes for future agents

- Keep Simple Mode as the default UX.
- Do not remove enterprise features; hide them behind Advanced sections/settings.
- Use idempotent setup endpoints so repeated clicks do not create duplicates.
- Prefer checklist/action language over technical language.
- Every stock mutation must eventually go through canonical movement service.
- Bangladesh hospitals need minimum typing, fast buttons, printable labels and clear Bengali-friendly wording.

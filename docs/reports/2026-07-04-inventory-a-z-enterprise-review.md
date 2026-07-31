# Ozzyl HMS Inventory, Reagent & Stock Management A–Z Enterprise Review

Date: 2026-07-04
Workspace: `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-shareholder-merge`
Scope: Inventory, procurement, stock, barcode/QR traceability, lab reagent management, stock automation, admin monitoring, DanpheEMR comparison, and small-hospital usability.

## 1. Executive verdict

Ozzyl HMS inventory is now a strong enterprise-grade foundation, not just a basic store module. It covers the major hospital inventory lifecycle: master data, vendors, stores, purchase requests, RFQ, purchase order, goods receipt, stock lot tracking, FEFO dispatch/issue, reservations, requisitions, transfers, write-off, return to vendor, donations, stock counts, adjustment approval, QR/traceability, assets, ward/room stock, pharmacy bridge, lab/OT adapters, lab reagent consumption, reagent stock QC, open-vial expiry, reagent location, waste approval, dashboard monitoring, and reports.

Compared with DanpheEMR reference inventory, Ozzyl is already broader in automation and traceability because Ozzyl adds QR registry, canonical inventory bridge, lab reagent consumption policy, analyzer assignment, idempotent consumption claims, stock conflict guards, and admin monitoring pages. DanpheEMR remains useful as a proven operational workflow reference because it has very explicit stock reconciliation, procurement report groupings, substore dispatch/consumption reports, capital/consumable stock ledgers, and vendor transaction reports.

Overall readiness score: 8.2/10.

- Small-hospital usability: 7.5/10. The flows are present, but need a guided setup wizard and simplified default mode.
- Large-hospital enterprise depth: 8.5/10. Strong feature coverage; remaining work is transaction/saga hardening, reconciliation dashboards, and role granularity.
- Lab reagent management: 8/10. Strong policy/QC/location/expiry/waste foundation; needs better setup UX and reconciliation analytics.
- Admin monitoring: 8/10. Dashboards, alerts and tests exist; needs a single control-room view for unresolved exceptions, stale stock, failed consumption claims, and pending approvals.

## 2. External best-practice baseline used

Enterprise hospital inventory should generally support:

1. FEFO/expiry-aware stock rotation for drugs, reagents and consumables.
2. Batch/lot, expiry, location and barcode/QR traceability.
3. GS1-style product/location identifiers where possible: GTIN/product, batch/lot, expiry date, location/GLN concepts.
4. Audit trail for every quantity movement.
5. Separation of requester, approver, receiver, issuer, write-off reviewer and admin.
6. Reorder/min-max/stockout/expiry alerts.
7. QC and reagent lot-change control for lab.
8. Exception workflow, not silent failure, for stock shortages or unmapped tests.
9. Periodic physical count and reconciliation.
10. Dashboard visibility for pending PR/RFQ/PO/GRN, low stock, expiring stock, write-off, returns and blocked lots.
11. Idempotency/conflict guards for automated consumption and concurrent stock writes.
12. Small-hospital quick mode plus enterprise configuration mode.

## 3. DanpheEMR reference comparison

DanpheEMR local reference path reviewed:

`DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/inventory/`

Danphe inventory module structure includes:

- `settings`: item category, subcategory, item master, vendors, company, UOM, currency, packaging type, terms, mappings.
- `internal`: requisition, dispatch, direct dispatch, return from substore, write-off, purchase request tracking.
- `stock`: stock list, stock details, goods receipt stock list/view, stock reconciliation.
- `return-to-vendor`: add/list/view return to vendor.
- `donation`: create/edit/list/view donation.
- `reports`: approved material stock register, capital stock ledger, consumable stock ledger, expiry item, expirable stock, fixed assets, GR view, PO view, purchase reports, stock reports, supplier reports, inventory summary, valuation, issued item list, return to vendor report, substore dispatch/consumption, substore-wise summary, vendor transaction report, write-off report.

Danphe strengths:

- Very operationally mature menu grouping.
- Strong report taxonomy for hospital store departments.
- Explicit reconciliation/reporting surfaces.
- Purchase and dispatch workflow is easy to understand for store staff.
- Substore/department reporting is mature.

Ozzyl advantages over Danphe:

- Better QR/barcode registry and scan log design.
- Better modern UI architecture and tests.
- Lab reagent inventory policy and automatic consumption bridge.
- Stock conflict/stale-write protection added for key flows.
- Inventory + pharmacy + lab + OT integration direction is stronger.
- Cloud/local/serverless deployment architecture is more modern.
- Admin monitoring pages for inventory alerts and stock movement already exist.

Danphe-inspired gaps Ozzyl should still copy/improve:

- A single stock reconciliation page needs to be elevated as a daily/monthly operational workflow.
- More printed store reports: approved material register, capital vs consumable ledger, vendor transaction report, substore dispatch/consumption report.
- Store staff workflow menu should be simplified into clear groups: Setup, Purchase, Receive, Issue, Transfer, Count, Adjustment, Reports.
- Reporting naming should match hospital language used by storekeepers and accountants.

## 4. Ozzyl module coverage map

Backend inventory route coverage:

- `src/routes/tenant/inventory/items.ts`: item master.
- `vendors.ts`: vendor master.
- `stores.ts`: store master.
- `settings.ts`: settings master.
- `purchaseRequests.ts`: purchase request workflow.
- `rfq.ts`: request for quotation.
- `po.ts`: purchase orders.
- `gr.ts`: goods receipt.
- `stock.ts`: stock overview and direct adjustment.
- `reorder.ts`: reorder configuration/alerts.
- `reservations.ts`: stock reservation.
- `req.ts`: requisition.
- `dispatch.ts`: dispatch with FEFO allocation.
- `transfers.ts`: inter-store transfer with guarded send/receive.
- `returns.ts` and `return.ts`: returns flows.
- `writeoff.ts`: write-off.
- `donations.ts`: donations.
- `countSessions.ts`: physical count sessions and approval.
- `adjustmentRequests.ts`: adjustment approval workflow.
- `reports.ts`: reports.
- `dashboard.ts`: dashboard KPIs.
- `qr.ts`: QR generation, scan and print.
- `locations.ts`: stock location hierarchy.
- `assets.ts`: fixed asset lifecycle.
- `pharmacyBridge.ts`: pharmacy/inventory bridge.
- `consumptionRules.ts`, `consumptionEvents.ts`, `consumptionExceptions.ts`, `consumptionReports.ts`: automated consumption framework.
- `workflowAdapters.ts`: integration adapters.

Frontend inventory coverage:

- Dashboard, StockList, Ledger, Master Data, GRN, PO, RFQ, Requisition, Dispatch, Issue, Transfer, Count, Adjustment Request, Return, Return-to-Vendor, Write-off, Donation, Import/Export, Reports, Traceability, Consumption Automation.
- Admin monitoring pages: `InventoryAlerts`, `StockOverview`, `StockMovementPage`.

Lab/reagent backend coverage:

- `src/routes/tenant/labMonitoring.ts`
- `src/lib/lab-consumables.ts`
- `src/lib/lab-inventory-policy.ts`
- `src/lib/lab-inventory-bridge.ts`
- `src/lib/lab-reagent-defaults.ts`

Lab reagent migration coverage includes:

- `0170_lab_consumables_monitoring.sql`
- `0372_lab_consumable_consumption_claims.sql`
- `0373_lab_consumable_stock_qc.sql`
- `0374_lab_consumable_stock_onboard_expiry.sql`
- `0375_lab_consumable_stock_locations.sql`
- `0376_lab_consumable_waste_requests.sql`
- `0377_lab_operation_logs_stock_lifecycle_types.sql`
- `0378_lab_inventory_bridge_links.sql`
- `0392_lab_reagent_analyzer_assignments.sql`
- `0393_lab_inventory_policy.sql`
- `0394_lab_inventory_exception_and_claim_lifecycle.sql`
- `0395_lab_inventory_policy_modes.sql`
- `0396_lab_test_consumable_map_lifecycle.sql`
- `0398_inventory_consumption_automation.sql`

## 5. What is already strong

### 5.1 Stock integrity

Strong points:

- `inventory-core.ts` defines movement types and FEFO allocation helpers.
- Expired, inactive, damaged and blocked stock can be prevented from issue.
- Usable stock calculation accounts for available, reserved, damaged and blocked quantity.
- Key stock flows now return HTTP 409 on stale stock update/conflict.
- Direct issue, transfer send/receive, adjustment approval, direct adjustment and stock count approval have conflict protection.

Remaining concern:

- Some older flows should be reviewed one more time for atomic movement + ledger + audit commit boundaries.

### 5.2 Procurement lifecycle

Strong points:

- PR, RFQ, PO, GRN, vendors, stores and settings exist.
- Other charges and accounting bridge exist.
- GRN stock creation and PO links are tested.

Remaining concern:

- Need a procurement control-room view showing PR pending, RFQ pending, PO approved but not received, partial GRN, supplier overdue, and blocked vendor bills.

### 5.3 Requisition and dispatch

Strong points:

- Requisition, dispatch and FEFO/FIFO tests exist.
- Dispatch safety tests exist.
- Store-to-store transfer is guarded.

Remaining concern:

- UI should show “recommended batch” and “why this batch is selected” to storekeepers. This is especially important in Bangladesh hospitals where staff may override manually.

### 5.4 Reorder and stockout monitoring

Strong points:

- `reorder.ts`, dashboard, reports and stock overview support reorder/low-stock concepts.
- Frontend has inventory alert pages.

Remaining concern:

- Need daily auto-generated purchase suggestion: “Buy these items now”, grouped by supplier and urgency.

### 5.5 QR/barcode traceability

Strong points:

- QR tag registry, scan endpoint and scan log exist.
- Stock list supports QR scan and QR label printing.
- Locations and assets also use QR/traceability direction.

Remaining concern:

- Enterprise healthcare should plan for GS1-style identifiers eventually: product ID/GTIN, batch/lot, expiry, and location code. Ozzyl can start with internal QR now and keep a future field for GS1 DataMatrix/Digital Link.

### 5.6 Lab reagent management

Strong points:

- Lab inventory policy mode exists: disabled/soft/strict.
- Reagent consumption timing can be billing/result.
- Stock-out hardening tests exist.
- Default reagent catalog seeding exists.
- Test-consumable bulk mapping exists.
- Consumption claim/idempotency exists.
- QC status exists for stock lots.
- Open-vial/onboard expiry exists.
- Lab consumable locations exist.
- Waste approval exists.
- Analyzer assignments exist.
- Exception lifecycle exists.

Remaining concern:

- Need a lab reagent setup wizard: choose mode, seed defaults, map top tests, assign analyzers, choose billing/result timing, review unmapped tests, activate strict mode.
- Need a lab exception control room for unmapped tests, stock shortage, QC failed lots, opened-vial expiry, analyzer-specific reagent availability.

### 5.7 Admin monitoring

Strong points:

- Inventory dashboard and admin stock pages exist.
- Backend dashboard route exists.
- Reports exist.
- Tests cover admin pages.

Remaining concern:

- Need one executive control room with red/yellow/green indicators across store, lab, pharmacy and OT.

## 6. Test verification performed in this review

Backend inventory/lab/asset focused suite:

```bash
npm exec vitest -- run test/integration/routes/inventory test/integration/routes/asset-management.test.ts test/lab-monitoring-stock-queries.test.ts test/lab-monitoring-default-reagent-catalog.test.ts test/lab-monitoring-bulk-mapping.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-out-hardening.test.ts test/lab-inventory-bridge-contract.test.ts test/lab-inventory-bridge-db.test.ts
```

Result:

- 43 test files passed.
- 360 tests passed.

Frontend inventory/admin stock tests:

```bash
cd web
npx vitest run src/pages/inventory src/pages/admin/InventoryAlerts.test.tsx src/pages/admin/StockMovementPage.test.tsx src/pages/admin/StockOverview.test.tsx
```

Result:

- 30 test files passed.
- 115 tests passed.

## 7. Enterprise gap list

### P0 — Add canonical inventory transaction/saga service

Status: partially solved with conflict guards, but not fully canonical.

Problem: Multi-step inventory writes still appear across separate route files. Enterprise-grade stock systems should have one canonical service for stock mutation + movement ledger + audit + exception handling.

Recommended implementation:

- Create `src/lib/inventory-movement-service.ts`.
- Inputs: tenantId, userId, movementType, stockId, qty, source module, reference type/id, idempotency key, reason, metadata.
- Responsibilities:
  - Load stock row.
  - Validate status/expiry/usable quantity.
  - Apply exact-balance guarded update.
  - Insert movement ledger.
  - Insert audit log.
  - Return movement ID.
  - On any conflict: HTTP 409 with refresh/retry guidance.
- Routes should call this service instead of duplicating stock mutation logic.

### P0/P1 — Add inventory reconciliation job/control endpoint

Problem: Automated consumption and multi-step workflows need reconciliation.

Recommended checks:

- Stock total vs movement ledger balance.
- Lab consumption claim vs stock movement vs lab order state.
- Transfer in-transit quantity vs transfer item received quantity.
- Reserved quantity vs open reservations.
- Damaged/blocked quantity vs write-off/waste requests.
- GRN quantities vs PO quantities vs stock lots.

Recommended UI:

- Admin > Inventory Control Room > Reconciliation tab.
- Show mismatch severity and one-click “create exception/review task”.

### P1 — Small hospital quick setup wizard

Problem: System is powerful but setup-heavy.

Recommended wizard:

1. Choose hospital type: small clinic, medium hospital, diagnostic/lab-heavy, full hospital.
2. Enable modules: pharmacy, general store, lab reagents, OT/CSSD, fixed assets.
3. Create default stores: Main Store, Pharmacy Store, Lab Store, Ward Store.
4. Seed default item categories and lab reagent catalog.
5. Import item list by Excel.
6. Set reorder defaults.
7. Set expiry warning days.
8. Choose lab mode: disabled/soft/strict.
9. Run first stock opening import.
10. Print initial QR labels.

### P1 — Admin control-room view

Need one page showing:

- Low stock.
- Out of stock.
- Expiring in 30/60/90 days.
- Expired stock.
- QC failed/pending reagent lots.
- Opened reagent lots near onboard expiry.
- Pending PR/RFQ/PO/GRN.
- Pending write-off/waste requests.
- Failed automatic consumption events.
- Unmapped lab tests.
- Transfer in-transit aging.
- Stock count variance pending approval.
- High-value adjustment requests.

### P1 — Role model refinement

Existing roles work, but enterprise hospitals need more granular first-class roles:

- Store Keeper.
- Inventory Manager.
- Procurement Officer.
- Purchase Approver.
- Goods Receiver.
- Ward/Nurse In-charge.
- Lab Inventory Manager.
- Lab Tech.
- Biomedical Engineer.
- Finance/Accountant.
- Director/Admin.

### P1 — Reagent strict-mode onboarding

Before enabling strict reagent mode, require readiness checklist:

- Test catalog mapped to consumables.
- At least one active stock lot per mapped consumable.
- QC passed or not required.
- Onboard expiry not breached.
- Analyzer assigned where applicable.
- Default fallback policy decided.
- Exception reviewers assigned.

### P1/P2 — Reports to copy from Danphe-style workflows

Add or promote reports:

- Approved material stock register.
- Capital stock ledger.
- Consumable stock ledger.
- Daily item dispatch report.
- Substore dispatch and consumption report.
- Substore-wise summary.
- Vendor transaction report.
- PO vs GRN comparison.
- Cancelled PO/GRN report.
- Return-to-vendor report.
- Write-off report.
- Inventory valuation by item category.

### P2 — Barcode standard roadmap

Current internal QR is good for MVP/production. Roadmap:

- Add optional GTIN field.
- Add supplier barcode field.
- Add GS1 DataMatrix parser later for GTIN + lot + expiry.
- Add GLN-like internal location code support for stores/racks/fridges/analyzers.
- Make labels include human-readable item, batch, expiry, rack and internal QR code.

### P2 — Frontend conflict-aware UX

Now backend can return 409 conflict for stale stock. Frontend should show:

- “Stock changed by another operation. Refresh and retry.”
- Show current available stock.
- Disable submit while posting.
- Avoid double-click duplicate submits.
- Provide “Refresh stock” button in all issue/transfer/adjustment/receive flows.

## 8. Small hospital vs large hospital readiness

Small hospital: good but needs simplification.

What small hospitals need:

- Start with Main Store + Pharmacy Store + Lab Store only.
- Hide RFQ/quotation if not used.
- Allow Excel import for opening stock.
- Use soft lab reagent mode first.
- Use simple reorder alerts.
- Use QR label printing only for stock lots/expensive items first.
- One dashboard with “what to do today”.

Large hospital: strong but needs governance hardening.

What large hospitals need:

- Strict approval workflow.
- Multi-store/substore/ward routing.
- Reconciliation and variance control.
- Granular RBAC.
- Period lock / inventory close.
- Audit and export reports.
- Vendor/PO/GRN financial reconciliation.
- Batch/lot/expiry traceability.
- Reagent QC and analyzer-specific inventory.

## 9. Priority implementation plan

### Next 1–2 days

1. Add inventory control-room page/backend endpoint for exceptions and pending actions.
2. Add lab strict-mode readiness checker endpoint.
3. Add frontend 409 conflict handling copy in issue/transfer/adjustment/receive pages.
4. Add reconciliation report endpoint for reserved vs open reservation and transfer in-transit mismatch.

### Next 3–7 days

1. Create canonical inventory movement service.
2. Refactor issue, transfer, adjustment, count, write-off, lab consumption to use the service.
3. Add Danphe-style daily reports.
4. Add setup wizard for small hospitals.
5. Add missing Drizzle/schema exports for raw-SQL enterprise inventory tables if still absent.

### Next 2–4 weeks

1. Add barcode standard roadmap fields: GTIN, supplier barcode, lot parser.
2. Add reconciliation scheduler/job.
3. Add inventory period close.
4. Add advanced procurement analytics: supplier lead time, price variance, PO aging.
5. Add reagent analyzer utilization and forecast-based reorder suggestions.

## 10. Final conclusion

Ozzyl HMS inventory/reagent system is not just MVP-level anymore. It is already comparable to a mature hospital inventory module and in some areas more advanced than DanpheEMR because of QR traceability, reagent automation, policy modes, idempotency claims and modern test coverage.

The biggest remaining enterprise gaps are not feature quantity; they are operational hardening and UX simplification:

- Make one canonical movement service.
- Add reconciliation/control-room monitoring.
- Add small-hospital setup wizard.
- Add strict-mode readiness checklist for lab reagents.
- Add Danphe-style operational reports.
- Add role granularity.

If these are done, the inventory + reagent module can be positioned as enterprise-ready for medium to large Bangladesh hospitals while still being usable by small hospitals.

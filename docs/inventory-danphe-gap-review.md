# Inventory Module Production Review vs Danphe EMR

Date: 2026-04-30

## Production Status

The inventory/store module has been upgraded from a mid-level stock module into a Danphe-style hospital inventory workflow covering procurement, stock, ward/room traceability, QR scanning, and fixed-asset lifecycle control.

Implemented in this pass:
- Inventory-wide QR registry and scan log for item, stock, store, location, ward stock, fixed asset, PO, and GRN.
- Printable/scannable QR SVG generation using server-side QR generation.
- Hospital location hierarchy for ward, room, bed, store, rack, department, and parent-child location mapping.
- Ward/room-level stock table and transaction history.
- Ward consumption from QR tag/manual entry with location-level deduction and patient/general reference.
- Ward dispatch now deducts central inventory stock and writes ledger transactions.
- Purchase request workflow with submit/approve/reject/convert/cancel state and approval log.
- Fixed asset auto barcode generation, QR tag generation, scan lookup, movement log, allocation/return log, maintenance log linkage, depreciation entries, and disposal records.
- Existing PO, GRN, requisition, dispatch, write-off, return, RFQ SQL/schema mismatches were corrected.

## Danphe Alignment

| Area | HMS Production Implementation |
|---|---|
| Item/store/procurement | Item/category/UOM/vendor/store, PR, RFQ, quotation, PO, GRN, stock, ledger |
| Ward supply | Ward requisition, approval, dispatch, receipt, ward stock, room/location stock, consumption |
| QR/barcode | Central QR registry, QR SVG generation, scan endpoint, scan logs, asset and ward-stock QR |
| Fixed assets | Barcode/QR, AMC, maintenance, allocation, movement history, depreciation, disposal/scrap |
| Location tracking | Ward/room/bed/rack/dept hierarchy via `InventoryLocation` |
| Approval/audit | Purchase request and asset lifecycle approval/movement logs; stock ledger for quantity movements |

## Operational Roles

Recommended hospital ownership:
- Store keeper: receive GRN, stock count, dispatch, expiry/low-stock monitoring.
- Ward/nurse in-charge: requisition, receive ward stock, record room/patient consumption.
- Procurement officer: purchase request, RFQ, quotation comparison, PO preparation.
- Accountant/finance: vendor bill, valuation, tax/discount review.
- Biomedical engineer: fixed asset QR, allocation, maintenance, AMC, calibration, disposal.
- Hospital admin/owner/director: approvals, dashboards, exception audit, high-value write-off/disposal.

Current route-level write access still maps to existing HMS roles (`hospital_admin`, `pharmacist`, `accountant`) because the project RBAC catalog does not yet expose dedicated `store_keeper`, `procurement_officer`, and `biomedical_engineer` roles as first-class seeded users. The data model and workflow now support those responsibilities cleanly when RBAC seed data is expanded.

## Key Files

- Migration: `migrations/0186_inventory_production_grade.sql`
- QR API: `src/routes/tenant/inventory/qr.ts`
- Location API: `src/routes/tenant/inventory/locations.ts`
- Purchase request API: `src/routes/tenant/inventory/purchaseRequests.ts`
- Ward room stock/consumption: `src/routes/tenant/wardSupply.ts`
- Asset lifecycle: `src/routes/tenant/inventory/assets.ts`
- UI: `web/src/pages/inventory/InventoryTraceability.tsx`

## Verification

- `npm test -- --run test/integration/routes/inventory test/integration/routes/asset-management.test.ts test/unit/schemas.test.ts`
- `npm run build`

Root `pnpm exec tsc --noEmit` currently still reports pre-existing unrelated `src/routes/tenant/healthRecord.ts` type errors; the inventory build and targeted inventory/asset test suite pass.

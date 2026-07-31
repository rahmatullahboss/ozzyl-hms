# Ozzyl HMS Pharmacy Module — Review & Comparison with danphe-next + OpenEMR

> **Generated:** 2026-03-19 | **Scope:** Full feature parity analysis  
> **Compared Projects:**
> - **Ozzyl HMS** (`/Users/rahmatullahzisan/Desktop/Dev/hms`) — 78 API routes, 18 pages
> - **danphe-next-cloudflare** (`/Users/rahmatullahzisan/Desktop/Dev/danphe-next-cloudflare`) — 70+ API routes
> - **DanpheEMR** (`/Users/rahmatullahzisan/Desktop/Dev/DanpheEMR`) — 69 server models, 50+ DB tables
> - **OpenEMR reference** (embedded in danphe-next) — Full pharmacy source

---

## 1. Feature Comparison Matrix

| Feature Area | Ozzyl HMS | danphe-next | DanpheEMR | OpenEMR | Status |
|---|:---:|:---:|:---:|:---:|:---:|
| **Master Data** |
| Categories CRUD | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| Generics CRUD | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| Suppliers CRUD | ✅ | ✅ | ✅ | — | ✅ Parity |
| Items/Medicines CRUD | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| UOM (Unit of Measurement) | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| Packing Types | ✅ | ✅ | ✅ | — | ✅ Parity |
| Racks/Locations | ✅ | ✅ | ✅ | — | ✅ Parity |
| Counters/Dispensary | ✅ | ✅ | ✅ | — | ✅ Parity |
| **BD Master Drug DB (17,589)** | ✅ | ❌ | ❌ | ❌ | **🏆 Ozzyl exclusive** |
| **Procurement** |
| Purchase Orders (CRUD + Cancel) | ✅ | ✅ | ✅ | — | ✅ Parity |
| Goods Receipt (GRN) | ✅ | ✅ | ✅ | — | ✅ Parity |
| Supplier Returns | ✅ | ✅ | ✅ | — | ✅ Parity |
| **PO Update/Edit** | ❌ | ✅ | ✅ | — | ⚠️ **Missing** |
| **Inventory** |
| Stock View | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| Stock Adjustment | ✅ | ✅ | ✅ | — | ✅ Parity |
| Stock Transactions Log | ✅ | ✅ | ✅ | — | ✅ Parity |
| Low Stock Alerts | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| Expiry Alerts | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| Stock Summary Dashboard | ✅ | ✅ | ✅ | — | ✅ Parity |
| Write-offs | ✅ | ❌ | ✅ | — | ✅ Ozzyl has it |
| **Batch/Lot Tracking** | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| **MRP History** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Expiry/Batch History** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Barcode Generation** | ❌ | ❌ | ✅ | ✅ | ⚠️ Missing |
| **Warehouse/Multi-Store** | ❌ | ❌ | ✅ | ✅ | ⚠️ Missing |
| **Sales & Billing** |
| Invoices (CRUD + detail) | ✅ | ✅ | ✅ | — | ✅ Parity |
| Invoice Returns | ✅ | ✅ | ✅ | — | ✅ Parity |
| Deposits (Add + Return) | ✅ | ✅ | ✅ | — | ✅ Parity |
| Settlements | ✅ | ✅ | ✅ | — | ✅ Parity |
| Provisional/Credit Invoices | ✅ | ✅ | ✅ | — | ✅ Parity |
| **Invoice Receipt View** | ❌ | ✅ | ✅ | — | ⚠️ **Missing** |
| **Print Count Tracking** | ❌ | ✅ | — | — | ⚠️ **Missing** |
| **Patient Billing Summary** | ❌ | ✅ | ✅ | — | ⚠️ **Missing** |
| **Patient Bill History** | ❌ | ✅ | ✅ | — | ⚠️ **Missing** |
| **Patient Provisional View** | ❌ | ✅ | ✅ | — | ⚠️ **Missing** |
| **Patient Deposits View** | ❌ | ✅ | ✅ | — | ⚠️ **Missing** |
| **Credit Bill Status (CreditOrg)** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Sales Category** | ❌ | ❌ | ✅ | — | Low priority |
| **Clinical/Dispensing** |
| Prescriptions (CRUD) | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| Prescription → Dispense | ✅ | ✅ | ✅ | ✅ | ✅ Parity |
| Narcotic Records | ✅ | ✅ | ✅ | — | ✅ Parity |
| **Dispensary Stock View** | ❌ | ✅ | ✅ | ✅ | ⚠️ **Missing** |
| **Drug Interaction Checking** | ❌ | ❌ | ❌ | ✅ | 🔮 Future |
| **Label Printing** | ❌ | ❌ | ❌ | ✅ | 🔮 Future |
| **e-Prescribing** | ❌ | ❌ | ❌ | ✅ | 🔮 Future |
| **NDC/RxNorm Codes** | ❌ | ❌ | ❌ | ✅ | 🔮 Future |
| **Formulary/Templates** | ❌ | ❌ | ❌ | ✅ | 🔮 Future |
| **Internal Logistics** |
| Ward Requisitions (request) | ✅ | ✅ | ✅ | — | ✅ Parity |
| Ward Dispatch | ✅ | ✅ | ✅ | — | ✅ Parity |
| **Store Requisitions** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Ward Stock View** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Ward Consumption Tracking** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Verification/Approval** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Financial** |
| **Supplier Ledger** | ❌ | ❌ | ✅ | — | ⚠️ **Missing** |
| **Employee Cash Transactions** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Fiscal Year Config** | ❌ | ❌ | ✅ | — | ⚠️ Missing |
| **Reporting** |
| Stock Reports | ❌ | ❌ | ✅ | ✅ | ⚠️ **Missing** |
| Sales Reports | ❌ | ❌ | ✅ | ✅ | ⚠️ **Missing** |
| Purchase History | ❌ | ❌ | ✅ | — | ⚠️ **Missing** |
| Expiry Report | ❌ | ❌ | ✅ | — | ⚠️ **Missing** |

---

## 2. Route Count Comparison

| System | Routes | Lines of Code | DB Tables |
|--------|--------|---------------|-----------|
| **Ozzyl HMS** | 78 routes | 2,045 lines | ~25 tables |
| **danphe-next** | 70+ routes | 2,506 lines | ~25 tables |
| **DanpheEMR** | N/A (C#) | ~17K lines | **50+ tables** |
| **OpenEMR** | N/A (PHP) | ~100K+ lines | ~20 pharmacy tables |

---

## 3. What Ozzyl HMS Has That Others DON'T

| Feature | Details |
|---------|---------|
| 🇧🇩 **BD Master Drug Database** | 17,589 brands, 1,435 generics, 645 companies pre-loaded |
| **Master Drug Autocomplete** | Search API + frontend component for one-click fill |
| **Multi-tenant Architecture** | SaaS-ready with tenant isolation (others are single-tenant) |
| **Cloudflare-native** | D1/R2/Workers — others require SQL Server or MySQL |
| **Write-offs** | danphe-next doesn't have write-offs |

---

## 4. Critical Gaps (vs danphe-next, HIGH PRIORITY)

These features exist in danphe-next-cloudflare (same tech stack as ours) but are missing from Ozzyl HMS:

### 4.1 Patient Billing Module (4 endpoints missing)
danphe-next has patient-centric billing views:
```
GET /patient/:patientId/billing-summary    — Total credit, paid, deposits
GET /patient/:patientId/bill-history       — Paginated invoice list
GET /patient/:patientId/provisional        — Open/credit invoices
GET /patient/:patientId/deposits           — Deposit balance and history
```
**Impact:** Without this, pharmacists can't see a patient's full billing picture.

### 4.2 Invoice Receipt Generator (1 endpoint missing)
```
GET /invoices/:id/receipt   — Generates printable receipt HTML with header
```
**Impact:** No print/receipt functionality for sales.

### 4.3 Print Count Tracking (2 endpoints missing)
```
PUT /invoices/:id/print-count     — Track how many times receipt was printed
PUT /deposits/:id/print-count     — Track deposit receipt prints
```
**Impact:** Audit trail for print operations missing.

### 4.4 Purchase Order Update/Edit (1 endpoint missing)
danphe-next has `PUT /purchase-orders/:id` for editing POs before approval.
Ozzyl HMS only has `PUT /purchase-orders/:id/cancel`.

### 4.5 Dispensary Stock View (1 endpoint missing)
```
GET /dispensary-stock    — Stock filtered by dispensary counter
```
**Impact:** Multi-counter pharmacies can't filter stock by counter.

---

## 5. Critical Gaps (vs DanpheEMR, MEDIUM PRIORITY)

These features exist in the original DanpheEMR C#/.NET but weren't migrated:

| Feature | DanpheEMR Tables | Notes |
|---------|-----------------|-------|
| **Supplier Ledger** | `PHRM_TXN_SupplierLedger`, `PHRM_TXN_SupplierLedgerTransaction` | Track payables per supplier |
| **Barcode Generation** | `PHRM_MST_StockBarcode` | Barcode per stock item |
| **MRP History** | `PHRM_History_StockMRP` | Price change tracking |
| **Expiry/Batch History** | `PHRM_History_StockBatchExpiry` | Batch modification log |
| **Multi-Store** | `PHRM_MST_Store`, `PHRM_TXN_StoreStock` | Central store + sub-stores |
| **Store Requisition** | `PHRM_StoreRequisition`, `PHRM_StoreRequisitionItems` | Inter-store transfers |
| **Store Dispatch** | `PHRM_StoreDispatchItems` | Dispatch from central to sub-store |
| **Ward Stock** | `WARD_Stock` | Stock currently in wards |
| **Ward Consumption** | `WARD_Consumption` | Track what wards actually use |
| **Verification/Approval** | `PHRM_TXN_Verification` | Multi-level approval workflow |
| **Credit Organizations** | `PHRM_MST_Credit_Organization` | Corporate/insurance billing |
| **Credit Bill Status** | `PHRM_TXN_CreditBillStatus` | Track credit invoice status |
| **Dosage + Frequency Map** | `PHRM_MAP_GenericDosaseNFreq` | Per-generic dosing guide |
| **Item Price Categories** | `PHRM_MAP_MSTItemPriceCategory` | Different prices per category |
| **Employee Cash TXN** | `PHRM_EmployeeCashTransaction` | Cash drawer management |
| **Fiscal Year** | `PHRM_CFG_FiscalYears` | Year-end accounting |
| **Tax Configuration** | `PHRM_MST_TAX` | Tax rates per item |
| **Item Type** | `PHRM_MST_ItemType` | Medicine vs Consumable vs Equipment |
| **Reporting System** | 40+ stored procedures | Full reporting suite |

---

## 6. Critical Gaps (vs OpenEMR, FUTURE/LOW PRIORITY)

| Feature | OpenEMR Implementation | Notes |
|---------|----------------------|-------|
| **Drug Interaction Checking** | RxNorm + SureScripts integration | Requires external API |
| **e-Prescribing** | Weno, NewCrop, SureScripts | Not applicable for BD market yet |
| **NDC Codes** | National Drug Code tracking | US-specific |
| **Formulary/Templates** | Drug templates for quick prescribing | Nice to have |
| **Label Printing** | Prescription label generation | Could be added later |
| **Warehouse Management** | Multiple warehouses per site | Maps to multi-store in DanpheEMR |
| **QR Code on Prescriptions** | Built into prescription printing | Future enhancement |

---

## 7. Ozzyl HMS Existing Routes (78 endpoints)

### Master Data (18 routes)
- Categories: GET, POST, PUT
- Generics: GET, POST, PUT  
- Suppliers (legacy): GET, POST, PUT
- Pharmacy Suppliers (v2): GET, POST, PUT
- UOM: GET, POST
- Packing Types: GET, POST
- Racks: GET, POST
- Counters: GET, POST
- Items: GET (list), GET (detail), POST, PUT

### Procurement (8 routes)
- Purchase Orders: GET (list), GET (detail), POST, PUT/cancel
- Goods Receipts: GET (list), GET (detail), POST
- Supplier Returns: GET, POST

### Inventory (5 routes)
- Stock: GET
- Stock Adjustment: POST
- Stock Transactions: GET
- Low Stock Alerts: GET
- Expiring Alerts: GET

### Sales & Billing (12 routes)
- Sales: POST (legacy)
- Billing: POST (legacy)
- Invoices: GET (list), GET (detail), POST
- Invoice Returns: GET, POST
- Deposits: GET, GET/balance, POST, POST/return
- Settlements: GET, POST

### Clinical (7 routes)
- Prescriptions: GET (list), GET (detail), POST, PUT/dispense
- Provisional Invoices: GET, POST
- Narcotics: GET, POST

### Internal Logistics (4 routes)
- Requisitions: GET, POST
- Dispatches: GET, POST

### Other (4 routes)
- Summary/Dashboard: GET
- Write-offs: GET, POST
- Master Drug Search: GET (drugs), GET (generics), GET (companies), GET (stats)

### Soft Delete/Activate Helper (reusable for all masters)
- PUT /:id/deactivate, PUT /:id/activate

---

## 8. Frontend Pages Comparison

| Ozzyl HMS Page | Exists | danphe-next Equivalent |
|---|:---:|---|
| `PharmacyOverview.tsx` | ✅ | `PharmacyDashboard` |
| `ItemList.tsx` | ✅ | `PharmacyMasters` (items tab) |
| `CategoryList.tsx` | ✅ | `PharmacyMasters` (category tab) |
| `GenericList.tsx` | ✅ | `PharmacyMasters` (generics tab) |
| `SupplierList.tsx` | ✅ | `PharmacyMasters` (suppliers tab) |
| `StockList.tsx` | ✅ | Part of `PharmacyPage` |
| `PurchaseOrderList.tsx` | ✅ | `PharmacyProcurement` |
| `PurchaseOrderForm.tsx` | ✅ | `PharmacyProcurement` |
| `GoodsReceiptList.tsx` | ✅ | `PharmacyProcurement` |
| `GoodsReceiptForm.tsx` | ✅ | `PharmacyProcurement` |
| `InvoiceList.tsx` | ✅ | `PharmacyInvoiceListPage` |
| `InvoiceForm.tsx` | ✅ | Part of `PharmacySalePage` |
| `DepositList.tsx` | ✅ | Part of `PharmacyPage` |
| `SettlementList.tsx` | ✅ | Part of `PharmacyPage` |
| `DispatchList.tsx` | ✅ | `PharmacyWardRequisitionPage` |
| `PrescriptionList.tsx` | ✅ | `PharmacyDispensePage` |
| `NarcoticRegister.tsx` | ✅ | Part of `PharmacyPage` |
| `WriteOffList.tsx` | ✅ | ❌ (not in danphe-next) |
| **Stock Report Page** | ❌ | `PharmacyStockReportPage` |
| **Sales Report Page** | ❌ | `PharmacySalesReportPage` |
| **Expiry Report Page** | ❌ | `PharmacyExpiryReportPage` |
| **Purchase History Page** | ❌ | `PharmacyPurchaseHistoryPage` |
| **Patient Billing Page** | ❌ | Part of `PharmacySalePage` |

---

## 9. Priority Recommendations

### 🔴 P0 — Must Have (1-2 weeks)
1. **Patient billing summary/history** — 4 API endpoints + 1 frontend page
2. **Invoice receipt/print** — receipt template + print-count tracking
3. **PO edit/update** — allow editing draft purchase orders
4. **Stock/Sales/Expiry Reports** — 3 report pages

### 🟡 P1 — Should Have (2-4 weeks)  
5. **Supplier Ledger** — track payables per supplier
6. **Dispensary stock view** — filter by counter
7. **Multi-store (central + sub-store)** — store model + store stock
8. **Item price categories** — different prices for different patient types
9. **Tax configuration** — per-item tax rates

### 🟢 P2 — Nice to Have (future)
10. **Barcode generation** — per stock item
11. **MRP/price history** — track price changes over time
12. **Verification/approval workflow** — multi-level PO/GRN approval
13. **Drug interaction checking** — external API integration
14. **Generic dosage/frequency mapping** — dosing guide per generic

---

## 10. Conclusion

**Overall Coverage: ~75-80%** of the danphe-next feature set is already in Ozzyl HMS.

**What Ozzyl HMS does better:**
- 🇧🇩 BD Master Drug Database (17,589 medicines) — unique feature
- Multi-tenant SaaS architecture
- Write-offs module
- Cloudflare-native (edge computing)

**Key gaps to close:**
- Patient-centric billing views (4 endpoints)
- Receipt/printing system
- Reporting pages (stock, sales, expiry, purchase)
- Supplier ledger for payables tracking

The pharmacy module is functionally strong for inventory and procurement workflows. The main gaps are in **reporting**, **patient billing views**, and **printing** — all of which are data-display features that can be added incrementally without refactoring the core.

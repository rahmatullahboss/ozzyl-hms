# Module 27: Nepali Receipt (Government-Format Print Views)

Reference: DanpheEMR legacy .NET / SQL Server implementation. Source: `DanpheEMR reference/Code/`.

---

## 1. Module Overview

The **NepaliReceipt** module in DanpheEMR is a **thin, read-only, print-oriented module**. It does **not** own its own database tables, does not implement an IRD (Inland Revenue Department) sync pipeline, and does not integrate with a fiscal printer. It is exclusively a **view-model / reporting layer** that the Inventory, Fixed-Asset, Pharmacy, Procurement and Ward-Supply modules call to render print-friendly Nepali-language government forms.

The module is consumed by frontend print components that produce three official Nepali form layouts:

| Nepali Form | Reference Number | Purpose |
|-------------|------------------|---------|
| **माग फारम** (Requisition Form) | म.ले.प.फारम नं. ४०१ (formerly ५१) | Internal stock request |
| **खर्च/निकासा फाराम** (Expense / Issue Form) | म.ले.प.फारम नं. ४०४ (formerly ५१) | Stock issue / dispatch |
| **हस्तान्तरण फाराम** (Handover Form) | Office use | Donation / transfer of goods between offices |

These forms are mandated by the Government of Nepal's **Office of the Auditor General (महालेखा नियन्त्रक कार्यालय)** and must accompany every inter-departmental stock movement for audit purposes.

Key design points:

- **Module is read-only.** All three controller actions are `GET`. There is no `POST`, `PUT`, or `DELETE` handler. The data is read from tables owned by Inventory (`INV_TXN_GoodsReceipt`, `INV_TXN_GoodsReceiptItems`, `INV_MST_Requisition`, `INV_TXN_RequisitionItems`, `INV_TXN_DispatchItems`, `INV_TXN_StockTransaction`, `INV_MST_FiscalYear`), Ward Supply (`WARD_SupplyAssetRequisition`, `WARD_SupplyAssetRequisitionItems`), and Pharmacy (`PHRM_StoreRequisition`, `PHRM_StoreRequisitionItems`, `PHRM_StoreDispatchItems`, `PHRM_MST_FiscalYear`).
- **One controller, one service.** The `NepaliReceiptController` delegates every call to `NepaliReceiptService`. There is no repository or DbContext dedicated to this module; the service instantiates `InventoryDbContext`, `PharmacyDbContext`, and `WardSupplyDbContext` directly from the shared connection string.
- **Module-type dispatch.** Requisition and Dispatch views branch on a `ModuleType` query-string parameter that selects which DbContext and table family to read from. Supported values: `inventory-substore`, `fixedasset-substore`, `pharmacy-dispensary`. The `fixedasset-substore` branch is for the Ward Supply asset-requisition flow.
- **Nepali-language UI templates.** All three Angular print templates embed static Nepali strings (e.g. `माग फारम`, `निकासा नं`, `आ.व.`, `मिति`) and rely on the global `nepaliDate` pipe to render the B.S. (Bikram Sambat) calendar date.
- **Feature-flag controlled.** Every consumer checks the `NepaliReceipt` parameter (group `Common`) from `CoreService.Parameters`. When set to `"true"`, the parent component swaps its English print layout for `<app-requisition-np-view>`, `<app-dispatch-np-view>`, or `<app-donation-gr-view>`. When `"false"`, the legacy English view is rendered.
- **Fiscal-year attribution is naive.** The current code pulls the fiscal year by ordering descending and taking the first row (`OrderByDescending(a => a.FiscalYearName).FirstOrDefault()`). The author left an explicit `TODO` flagging this as broken for historical fiscal years — for the `inventory-substore` and `pharmacy-dispensary` paths the fiscal year is computed from the dispatch `CreatedOn`/`DispatchedDate` falling between the FY's start/end dates; for the requisition paths it is hard-pinned to "the latest FY", which will be incorrect when reading an old requisition.
- **No write paths, no auth checks, no audit logs.** The controller only carries `[RequestFormSizeLimit]` and `[DanpheDataFilter]` (the global DB-filter attribute). There is no audit, role check, or rate limit at the module level — the parent module that calls the print component is responsible for RBAC.

The NepaliReceipt module is essentially a **view-builder**, the same way the DanpheEMR Hospital is paper-driven by the Auditor General's office. If your HMS needs real fiscal compliance (e-Invoice, IRD billing sync, fiscal-printer driver), this module is not the reference — see Module 05 (Billing) and the local-server / sync rules in `AGENTS.md`.

---

## 2. Backend Files

### 2.1 `NepaliReceiptController.cs`

Path: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/NepaliReceipt/NepaliReceiptController.cs`

Single-class controller with three action methods. Inherits `ControllerBase`. Has constructor-injected `INepaliReceiptService` and a private `DanpheHTTPResponse<object>` named `responseData` that is reused for every call.

| Method | Route | Verb | Purpose |
|--------|-------|------|---------|
| `GetDonationGRView(int GoodsReceiptId)` | `GET /api/NepaliReceipt/GetDonationGRView?GoodsReceiptId={id}` | GET | Build the `DonationGRVm` view-model for a donation-style goods receipt (used by the Procurement donation flow). |
| `GetNepaliRequisitionView(int RequisitionId, string ModuleType)` | `GET /api/NepaliReceipt/GetNepaliRequisitionView?RequisitionId={id}&ModuleType={inventory-substore\|fixedasset-substore\|pharmacy-dispensary}` | GET | Build the requisition (माग फारम) view-model for one of three module types. |
| `GetNepaliDispatchView(int DispatchId, int RequisitionId, string ModuleType)` | `GET /api/NepaliReceipt/GetNepaliDispatchView?DispatchId={id}&RequisitionId={id}&ModuleType={pharmacy-dispensary\|inventory-substore}` | GET | Build the dispatch (खर्च/निकासा फाराम) view-model for one of two module types. |

Every action follows the same try/catch pattern: on success, `responseData.Results = <vm>`, `responseData.Status = "OK"`; on failure, `responseData.Status = "Failed"`, `responseData.ErrorMessage = ex.Message + " exception details:" + ex.ToString()`. The response is always `Ok(responseData)` — the controller never returns an HTTP 500.

### 2.2 `INepaliReceiptService.cs`

Path: `DanpheEMR reference/Code/Websites/DanpheEMR/Services/NepaliReceipt/INepaliReceiptService.cs`

Tiny interface with three method signatures that mirror the controller actions one-to-one. There are no other consumers, no DTOs in the interface, and no extension points.

### 2.3 `NepaliReceiptService.cs`

Path: `DanpheEMR reference/Code/Websites/DanpheEMR/Services/NepaliReceipt/NepaliReceiptService.cs`

The single implementation. Constructor receives `IOptions<MyConfiguration>` to extract the connection string, then instantiates three DbContexts (`InventoryDbContext`, `PharmacyDbContext`, `WardSupplyDbContext`). The service holds these as instance fields, so the same contexts are reused for the lifetime of the request scope.

#### Method `GetDonationGRView(int GoodsReceiptId)` (line 26)

`async Task<DonationGRVm>`. Two LINQ queries against `inventoryDb`:

1. `donation` — single-row projection of the goods receipt header. Pulls `GoodsArrivalDate` and `BillNo`, mapped to `DonationGRDto.DonationDate` and `DonationFormNo`. Filter: `GR.GoodsReceiptID == GoodsReceiptId`.
2. `donationItemGrouped` — `GoodsReceiptItems` filtered by `GoodsReceiptId`, grouped by `ItemId`, then `OrderBy(ItemId).FirstOrDefault()` per group (one row per distinct item, even if received in multiple batches). For each surviving row, joins `UnitOfMeasurementMaster` to resolve the UOM name and projects to `DonationGRItemDto`. The total amount is read directly from `GRI.TotalAmount` and the quantity is `GRI.ReceivedQuantity + GRI.RejectedQuantity` (i.e. the entire received-and-rejected batch, not net good).

Returns `new DonationGRVm { DonationGR = donation }`.

#### Method `GetNepaliRequisitionView(int RequisitionId, string ModuleType)` (line 53)

Sync. Switches on `ModuleType`. Default branch returns an empty `NepaliRequisitionVm()`.

| ModuleType | DbContext | Requisition header table | Items table | FiscalYear source | Remarks |
|------------|-----------|--------------------------|-------------|-------------------|---------|
| `inventory-substore` | `inventoryDb` | `Requisitions` joined with `Employees` (on `CreatedBy`) for `RequestedByName` | `RequisitionItems` joined with `Items` and `UnitOfMeasurementMaster` | `(from fy in inventoryDb.FiscalYears.OrderByDescending(a => a.FiscalYearName) select fy.FiscalYearName).FirstOrDefault()` — **always the latest FY** (see TODO at line 69) | `RequestingRemarks` comes from `R.Remarks` |
| `fixedasset-substore` | `wardDbContext` | `WARDSupplyAssetRequisitionModels` joined with `Employees` (on `CreatedBy`) | `WARDSupplyAssetRequisitionItemsModels` joined with `INVItemMaster` and `UnitOfMeasurementMaster` | `(from fy in wardDbContext.InvFiscalYears.OrderByDescending(a => a.FiscalYearName) select fy.NpFiscalYearName).FirstOrDefault()` — **always the latest Nepali-name FY** | `RequestingRemarks` is hard-coded to empty string |
| `pharmacy-dispensary` | `pharmacyDb` | `StoreRequisition` left-joined to `StoreDispatchItems` (on `RequisitionId`) and the dispatching employee, then to `PHRMStore` for store name | `StoreRequisitionItems` joined with `PHRMItemMaster`, `PHRMGenericModel` (composed as `GenericName + " (" + ItemName + ")"`), and `PHRMUnitOfMeasurement` | `(from fy in pharmacyDb.PharmacyFiscalYears.OrderByDescending(a => a.FiscalYearName) select fy.NpFiscalYearName).FirstOrDefault()` — **always the latest FY** | `RequestingRemarks` is hard-coded to empty string |

Returns `new NepaliRequisitionVm { requisition = requisition }`. The header DTO also pre-allocates an empty `RequisitionItems` list in its constructor so callers can safely iterate even when the requisition has no items.

#### Method `GetNepaliDispatchView(int DispatchId, int RequisitionId, string ModuleType)` (line 159)

Sync. Switches on `ModuleType`. Default branch returns an empty `NepaliDispatchVm()`.

| ModuleType | DbContext | Dispatch header source | Item source | FiscalYear source | Notes |
|------------|-----------|------------------------|-------------|-------------------|-------|
| `pharmacy-dispensary` | `pharmacyDb` | `StoreDispatchItems` joined with `Employees` (on `CreatedBy`), `PHRMItemMaster`, `PHRMUnitOfMeasurement`, and `PharmacyFiscalYears` filtered by `CreatedOn BETWEEN fy.StartDate AND fy.EndDate` | Same query, group by `DispatchId`; the inner `DispatchItems` projection takes `D.DispatchedQuantity`, `D.CostPrice`, `D.BatchNo`, `D.Remarks` | Resolved from the FY whose `[StartDate, EndDate]` window contains `D.CreatedOn` (this is the only correct FY attribution in the module) | A commented-out `inventory-substore` block precedes the active one — the live branch fixes the issue that the legacy LINQ produced empty rows when a single dispatch contained multiple stock rows |
| `inventory-substore` | `inventoryDb` | `DispatchItems` joined with `Employees`, `Items`, `UnitOfMeasurementMaster`, then **inner-joined** with `StockTransactions` filtered by `ReferenceNo == D.DispatchItemsId` AND `TransactionType == ENUM_INV_StockTransactionType.DispatchedItem`, and joined with `InventoryFiscalYears` filtered by `D.DispatchedDate BETWEEN fy.StartDate AND fy.EndDate` | `RegisterPageNo = I.RegisterPageNumber` (Jinsi Khaata Paana No. — the Nepali stock-register page number), `Quantity = ST.OutQty`, `Price = ST.CostPrice`, `BatchNo = ST.BatchNo` | Resolved from `D.DispatchedDate` falling inside the FY window | Grouped by `DispatchId` so multiple stock-transaction rows for one dispatch collapse into a single `NepaliDispatchDTO` |

Returns `new NepaliDispatchVm { DispatchDetail = DispatchDetail }`.

#### Known Issues in the Service

- **TODO at line 69** — the inventory-substore requisition always returns the latest FY, not the FY of the requisition. Should be filtered by `R.RequisitionDate BETWEEN fy.StartDate AND fy.EndDate` the way the dispatch path does.
- **TODO at line 169** — author flagged that the dispatch and requisition tables should carry an explicit `FiscalYearId` FK so this group-by-date gymnastics is not needed.
- **Inventory-substore requisition items are not grouped.** Unlike the donation view, this branch does not collapse duplicate item rows; if two requisition lines reference the same `ItemId`, both appear as separate rows. (This is consistent with how the requisition was entered — each line is a separate user action — but it does mean a single receipt header can have many rows per item.)
- **Inner join to StockTransactions** in the inventory dispatch branch will drop dispatch rows that have no corresponding stock-transaction row (e.g. a dispatch created in a test environment, or a row inserted before the stock transaction was committed). This is a deliberate trade-off in the legacy code: the dispatch view is meaningless without the actual stock movement, so silently dropping is preferred to showing a zero-quantity row.

### 2.4 Inline ViewModels and DTOs

All DTOs and view-models are declared at the **bottom of `NepaliReceiptService.cs`** (lines 282-388). They are not in `DanpheEMR.ServerModel`, not registered with any DI container, and are not shared with other modules. They are internal to the service.

| Class | Type | Purpose |
|-------|------|---------|
| `DonationGRVm` | VM | Wraps the donation DTO. Single property: `DonationGRDto DonationGR`. |
| `DonationGRDto` | DTO | Header: `DonationDate (DateTime?)`, `DonationFormNo (string)`, plus `DonationItems` list. Constructor initializes an empty list. |
| `DonationGRItemDto` | DTO | Line: `ItemName`, `Specification`, `Code`, `BatchNo`, `UOMName`, `Quantity (double)`, `Rate (decimal)`, `TotalAmount (decimal)`, `Remarks`. |
| `NepaliRequisitionVm` | VM | Wraps `NepaliRequisitionDto requisition`. |
| `NepaliRequisitionDto` | DTO | Header: `RequisitionId`, `RequisitionNo (int?)`, `RequisitionDate`, `RequestedByName`, `RequestingRemarks`, `FiscalYear`, plus `RequisitionItems` list. Constructor initializes empty list. |
| `NepaliRequisitionItemDto` | DTO | Line: `RequisitionItemId`, `ItemId (int?)`, `ItemName`, `UOMName`, `Quantity (double?)`, `Remarks`. |
| `NepaliDispatchVm` | VM | Wraps `NepaliDispatchDTO DispatchDetail`. |
| `NepaliDispatchDTO` | DTO | Header: `DispatchId (int?)`, `RequisitionId (int?)`, `DispatchedDate`, `Remark`, `FiscalYear`, plus `DispatchItems` collection. Constructor initializes empty list. |
| `NepaliDispatchItemDTO` | DTO | Line: `DispatchId (int?)`, `RequisitionId (int?)`, `DispatchItemId`, `ItemId`, `ItemName`, `DispatchedDate`, `BatchNo`, `UOMName`, `Quantity (double)`, `SalePrice (decimal?)`, `Price (decimal?)`, `SubTotal (decimal)`, `Remark`, `RegisterPageNo (int?)` — added for the Jinsi Khaata Paana Number used on the government form. |

The frontend DTOs are duplicated as TypeScript classes inside the print component files (`DonationGRDto` in `donation-gr-view.component.ts`, `NepaliRequisitionDto` in `requisition-np-view.component.ts`, `NepaliDispatchDTO` in `dispatch-np-view.component.ts`). The two sides are not generated from a shared schema; they have to be kept in sync manually.

---

## 3. Data Models

### 3.1 ServerModel Coverage

There is **no dedicated model class** in `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/` for any of the NepaliReceipt DTOs. The view-models are inlined in the service file and the consumer modules own the underlying table models. The tables the service reads from are owned by:

| Owner Module | Tables Read |
|--------------|-------------|
| Inventory | `INV_TXN_GoodsReceipt` (header), `INV_TXN_GoodsReceiptItems` (lines), `INV_MST_Item` (item master), `INV_MST_UnitOfMeasurement`, `INV_MST_Requisition`, `INV_TXN_RequisitionItems`, `INV_MST_Employee` (FK to created-by), `INV_MST_FiscalYear`, `INV_TXN_DispatchItems`, `INV_TXN_StockTransaction`, `INV_MST_InventoryFiscalYear` |
| Pharmacy | `PHRM_StoreRequisition`, `PHRM_StoreRequisitionItems`, `PHRM_StoreDispatchItems`, `PHRM_MST_Item`, `PHRM_MST_Generic`, `PHRM_MST_UnitOfMeasurement`, `PHRM_MST_Employee`, `PHRM_MST_Store`, `PHRM_MST_FiscalYear` |
| Ward Supply | `WARD_SupplyAssetRequisition`, `WARD_SupplyAssetRequisitionItems`, `INV_MST_Item` (shared), `INV_MST_UnitOfMeasurement` (shared), `INV_MST_Employee` (shared), `INV_MST_FiscalYear` (read as `InvFiscalYears`, picking `NpFiscalYearName` instead of `FiscalYearName`) |

For the column-level schema of each of these tables, see the corresponding module doc (`21-inventory.md`, `34-pharmacy.md`, `08-cssd.md` / `29-nursing.md` for ward supply).

### 3.2 DTO Class Hierarchy

```
DonationGRVm
└── DonationGRDto (1)
    └── DonationGRItemDto (0..N)

NepaliRequisitionVm
└── NepaliRequisitionDto (1)
    └── NepaliRequisitionItemDto (0..N)

NepaliDispatchVm
└── NepaliDispatchDTO (1)
    └── NepaliDispatchItemDTO (0..N)
```

All three view-models are flat (no nested children-of-children). The DTOs are **plain data carriers** with public auto-properties; there are no constructors that take parameters and no behavior beyond the empty-list initializers.

---

## 4. Database Tables

This module **does not introduce any tables of its own**. Every table it reads is owned by another module. The complete list of tables touched:

| Table | Module | Read by | Notes |
|-------|--------|---------|-------|
| `INV_TXN_GoodsReceipt` | Inventory | `GetDonationGRView` | Filtered by `GoodsReceiptID` |
| `INV_TXN_GoodsReceiptItems` | Inventory | `GetDonationGRView` | Grouped by `ItemId` to collapse batch splits |
| `INV_MST_Item` | Inventory | All three methods | Resolves `ItemName`, `Code`, `UnitOfMeasurementId`, `RegisterPageNumber` |
| `INV_MST_UnitOfMeasurement` | Inventory | All three methods | Resolves `UOMName` for the line display |
| `INV_MST_Employee` | Inventory | Requisition + Dispatch | Joins to `CreatedBy` to surface the requester / dispatcher name |
| `INV_MST_Requisition` | Inventory | `GetNepaliRequisitionView` (`inventory-substore`) | Requisition header |
| `INV_TXN_RequisitionItems` | Inventory | `GetNepaliRequisitionView` (`inventory-substore`) | Requisition lines |
| `INV_MST_FiscalYear` | Inventory | Requisition + Dispatch | Source for `FiscalYearName` |
| `INV_MST_InventoryFiscalYear` | Inventory | Dispatch only | Separate FY table that the dispatch query joins on date range |
| `INV_TXN_DispatchItems` | Inventory | `GetNepaliDispatchView` (`inventory-substore`) | Dispatch lines |
| `INV_TXN_StockTransaction` | Inventory | `GetNepaliDispatchView` (`inventory-substore`) | Source of `OutQty`, `CostPrice`, `BatchNo` for each dispatch line (inner-joined on `ReferenceNo == DispatchItemsId` and `TransactionType == DispatchedItem`) |
| `PHRM_StoreRequisition` | Pharmacy | `GetNepaliRequisitionView` (`pharmacy-dispensary`) | Requisition header |
| `PHRM_StoreRequisitionItems` | Pharmacy | `GetNepaliRequisitionView` (`pharmacy-dispensary`) | Requisition lines |
| `PHRM_StoreDispatchItems` | Pharmacy | `GetNepaliRequisitionView` (left-join, optional) and `GetNepaliDispatchView` (`pharmacy-dispensary`) | Dispatch lines; also the FY filter uses `CreatedOn` against this row |
| `PHRM_MST_Item` | Pharmacy | `GetNepaliRequisitionView` (`pharmacy-dispensary`) | Resolves `ItemName` and `UOMId` |
| `PHRM_MST_Generic` | Pharmacy | `GetNepaliRequisitionView` (`pharmacy-dispensary`) | Concatenated into `ItemName` as `GenericName (ItemName)` |
| `PHRM_MST_UnitOfMeasurement` | Pharmacy | `GetNepaliRequisitionView` (`pharmacy-dispensary`) | UOM resolution |
| `PHRM_MST_Store` | Pharmacy | `GetNepaliRequisitionView` (`pharmacy-dispensary`) | Source-store lookup (joined as `DefaultIfEmpty`) |
| `PHRM_MST_FiscalYear` | Pharmacy | `GetNepaliRequisitionView` (`pharmacy-dispensary`) | Source for `NpFiscalYearName` |
| `WARD_SupplyAssetRequisition` | Ward Supply | `GetNepaliRequisitionView` (`fixedasset-substore`) | Asset-requisition header |
| `WARD_SupplyAssetRequisitionItems` | Ward Supply | `GetNepaliRequisitionView` (`fixedasset-substore`) | Asset-requisition lines |
| `INV_MST_Item` (shared) | Inventory (shared) | `GetNepaliRequisitionView` (`fixedasset-substore`) | Ward Supply reads the inventory item master directly; joined as `INVItemMaster` |
| `INV_MST_UnitOfMeasurement` (shared) | Inventory (shared) | `GetNepaliRequisitionView` (`fixedasset-substore`) | Joined as `UnitOfMeasurementMaster` |
| `INV_MST_Employee` (shared) | Inventory (shared) | `GetNepaliRequisitionView` (`fixedasset-substore`) | Joined as `Employees` |
| `INV_MST_FiscalYear` (shared, alias `InvFiscalYears`) | Inventory (shared) | `GetNepaliRequisitionView` (`fixedasset-substore`) | Pulls `NpFiscalYearName` rather than `FiscalYearName` |

No `INSERT`, `UPDATE`, or `DELETE` is ever issued by the service. The module is strictly read-only.

---

## 5. Key Workflows

### 5.1 Requisition Print (माग फारम, Form 401)

1. User opens a requisition detail page in one of the consumer modules (Inventory substore, Ward Supply asset, or Pharmacy dispensary).
2. The consumer component checks the `NepaliReceipt` parameter from `CoreService.Parameters` (group `Common`). If the value is `"true"`, the English print layout is replaced by `<app-requisition-np-view>`.
3. The Nepali view component (`RequisitionNpViewComponent`) fires `NepaliReceiptEndpointService.GetNepaliRequisitionView(requisitionId, moduleType)`.
4. The Angular service issues `GET /api/NepaliReceipt/GetNepaliRequisitionView?RequisitionId=...&ModuleType=...`.
5. The controller delegates to `NepaliReceiptService.GetNepaliRequisitionView`, which branches on `ModuleType` and runs the LINQ query for the chosen sub-system.
6. The response is a `NepaliRequisitionVm` containing one `NepaliRequisitionDto` and a list of `NepaliRequisitionItemDto`.
7. The Angular component renders the Nepali government form (म.ले.प.फारम नं. ४०१): header with hospital name, FY, requisition number, B.S. date, line table (S.N. / सामानको नाम / स्पेसिफिकेसन / इकाई / परिमाण / कैफियत), and the four signature boxes (माग गर्नेको, सिफारिस गर्नेको, आदेश दिनेको, जिन्सी खातामा चढाउनेको) plus the two checkboxes for बजारबाट खरिद / मौज्दातबाट.
8. The user clicks the Print button; the component delegates to the shared `<app-print-page>` directive.

### 5.2 Dispatch Print (खर्च/निकासा फाराम, Form 404)

1. User opens a dispatch detail page in the Pharmacy dispensary or Inventory substore.
2. The consumer (e.g. `phrm-store-requisition-details.component.html`) checks the feature flag and conditionally renders `<app-dispatch-np-view>`.
3. `DispatchNpViewComponent.ngOnInit` calls `GetNepaliDispatchView(dispatchId, requisitionId, moduleType)`.
4. The endpoint returns a `NepaliDispatchVm` with the `NepaliDispatchDTO` (header + items).
5. The template renders म.ले.प.फारम नं. ४०४ with a table that includes: S.N., सामानको नाम, कोड नं, स्पेसिफिकेसन (toggled by `InventoryFieldCustomizationService.showSpecification`), the three "निकासा गरिएको" columns (इकाई / परिमाण / दर), जम्मा रकम (= Quantity × Price, formatted to `1.2-2`), जिन्सी खाता पाना नम्बर (the `RegisterPageNo` from the item master), and कैफियत.
6. Footer carries two signature blocks (स्टोर शाखाको दस्तखत, स्वीकृत गर्नेको दस्तखत).

### 5.3 Donation Goods Receipt Print (हस्तान्तरण फाराम)

1. User opens a donation-type goods receipt in the Procurement module (`donation-gr-view.component.ts`).
2. The component injects `NepaliReceiptEndpointService` and calls `GetDoncationGRView(goodsReceiptId)` on init.
3. The endpoint returns a `DonationGRVm` containing one `DonationGRDto` (with `DonationDate`, `DonationFormNo` and the `DonationItems` list, each row showing `ItemName + Specification`, `Code`, `BatchNo`, `UOMName`, `Quantity = ReceivedQuantity + RejectedQuantity`, `TotalAmount`, and `Remarks`).
4. The template renders the हस्तान्तरण फाराम with the 12-column table mandated for inter-office handover: क्र.सं., जिन्सी वर्गीकरण सङ्केत न., जिन्सी खाता पाना न., सामानको नाम, स्पेसिफिकेशन, सामानको पहिचान नं, मोडल नं, इकाई, परिमाण, जम्मा परल मूल्य, सुरु प्राप्त मिति, सामानको भौतिक अवस्था.
5. Footer has two columns of signature blocks (सामान हस्तान्तरण गर्ने कार्यालयले भर्ने / सामान बुझिलिनेले कार्यालयले भर्ने) plus a कार्यालयको छाप placeholder.

### 5.4 What This Module Does NOT Do

- **No IRD sync.** There is no call to the Nepal IRD billing API (e-Invoice / e-Bill). All three methods are read-only and produce view-models; they never persist or transmit data to a tax authority.
- **No fiscal-printer integration.** No ESC/POS, OPOS, or fiscal-printer driver is referenced. The Print button delegates to the browser's `window.print()` via the `<app-print-page>` directive.
- **No tax breakdown.** The forms do not compute or display VAT, excise, or TDS. Tax handling lives in Module 05 (Billing) and is rendered on a different receipt layout.
- **No signature image capture.** The signature blocks on the form are blank placeholders; the form is meant to be signed physically after print.
- **No multi-language toggle.** The Nepali forms are hard-coded Nepali; there is no English fallback at the backend level (the frontend English fallback is the parent's own template, not this module's responsibility).

---

## 6. API Endpoints

The module exposes exactly **three** endpoints, all `GET`. There are no `POST`, `PUT`, or `DELETE` handlers. No authentication or authorization attribute is applied at the action level — RBAC is enforced at the consumer (parent) route.

### 6.1 `GET /api/NepaliReceipt/GetDonationGRView`

Build the donation goods-receipt view-model (हस्तान्तरण फाराम).

| Parameter | In | Type | Required | Description |
|-----------|----|------|----------|-------------|
| `GoodsReceiptId` | query | int | yes | `INV_TXN_GoodsReceipt.GoodsReceiptID` |

**Response 200:**

```json
{
  "Status": "OK",
  "Results": {
    "DonationGR": {
      "DonationDate": "2024-08-15T00:00:00",
      "DonationFormNo": "GR-2024-0089",
      "DonationItems": [
        {
          "ItemName": "Paracetamol 500mg",
          "Specification": "Strip of 10 tablets",
          "Code": "MED-0001",
          "BatchNo": "B2408A",
          "UOMName": "Strip",
          "Quantity": 100.0,
          "Rate": 12.50,
          "TotalAmount": 1250.00,
          "Remarks": "Donated by XYZ Foundation"
        }
      ]
    }
  },
  "ErrorMessage": null
}
```

**Errors:** Returns 200 with `Status = "Failed"` and a populated `ErrorMessage` on any exception (the controller never returns HTTP 500). Caller should check `Status` rather than the HTTP code.

### 6.2 `GET /api/NepaliReceipt/GetNepaliRequisitionView`

Build the requisition view-model (माग फारम, Form 401).

| Parameter | In | Type | Required | Description |
|-----------|----|------|----------|-------------|
| `RequisitionId` | query | int | yes | Requisition id; the source table depends on `ModuleType` |
| `ModuleType` | query | string | yes | One of `inventory-substore`, `fixedasset-substore`, `pharmacy-dispensary` |

**Response 200 (inventory-substore example):**

```json
{
  "Status": "OK",
  "Results": {
    "requisition": {
      "RequisitionId": 12,
      "RequisitionNo": 7,
      "RequisitionDate": "2024-09-01T00:00:00",
      "RequestedByName": "Hari Sharma",
      "RequestingRemarks": "Urgent need for ICU",
      "FiscalYear": "2081/82",
      "RequisitionItems": [
        {
          "RequisitionItemId": 101,
          "ItemId": 5,
          "ItemName": "Syringe 5ml",
          "UOMName": "Piece",
          "Quantity": 200.0,
          "Remarks": ""
        }
      ]
    }
  }
}
```

**Response 200 (pharmacy-dispensary):** Same shape. `ItemName` is composed as `GenericName + " (" + ItemName + ")"` and `RequestingRemarks` is always `""`.

**Response 200 (fixedasset-substore):** Same shape. `FiscalYear` comes from `NpFiscalYearName` on the shared `INV_MST_FiscalYear` table, and `RequestingRemarks` is always `""`.

**Errors:** Unknown `ModuleType` returns an empty `NepaliRequisitionVm()` (the default branch of the switch). Validation is not performed; passing `RequisitionId = 0` returns a header DTO with null fields and an empty items list.

### 6.3 `GET /api/NepaliDispatchView`

Build the dispatch view-model (खर्च/निकासा फाराम, Form 404).

| Parameter | In | Type | Required | Description |
|-----------|----|------|----------|-------------|
| `DispatchId` | query | int | yes | Dispatch id |
| `RequisitionId` | query | int | yes | Required for the inventory-substore branch (used as an additional `where` filter); unused by the pharmacy-dispensary branch |
| `ModuleType` | query | string | yes | One of `pharmacy-dispensary`, `inventory-substore` |

**Response 200 (inventory-substore):**

```json
{
  "Status": "OK",
  "Results": {
    "DispatchDetail": {
      "DispatchId": 88,
      "RequisitionId": 12,
      "DispatchedDate": "2024-09-03T00:00:00",
      "Remark": null,
      "FiscalYear": "2081/82",
      "DispatchItems": [
        {
          "DispatchId": 88,
          "RequisitionId": 12,
          "DispatchItemId": 901,
          "ItemId": 5,
          "ItemName": "Syringe 5ml",
          "DispatchedDate": "2024-09-03T00:00:00",
          "BatchNo": "B2408C",
          "UOMName": "Piece",
          "Quantity": 200.0,
          "SalePrice": null,
          "Price": 5.00,
          "SubTotal": 0.00,
          "Remark": "Issued against Req #12",
          "RegisterPageNo": 42
        }
      ]
    }
  }
}
```

**Response 200 (pharmacy-dispensary):** Same shape. `RegisterPageNo` is not populated (the pharmacy dispatch branch does not join `Items.RegisterPageNumber`). `BatchNo`, `Price` and `Quantity` come from `PHRM_StoreDispatchItems.CostPrice` and `DispatchedQuantity` directly (no `StockTransactions` join).

**Errors:** Same try/catch behavior as the other endpoints. The `inventory-substore` branch silently drops dispatch lines that have no `StockTransactions` row (inner join) — that is by design, not an error.

### 6.4 Frontend Endpoint Mapping

The Angular `NepaliReceiptEndpointService` (`/shared/nepali-receipt-views/nepali-receipt-endpoint.service.ts`) wraps the three endpoints:

| Angular method | URL | Backend route |
|----------------|-----|---------------|
| `GetNepaliRequisitionView(RequisitionId, ModuleType)` | `GET /api/NepaliReceipt/GetNepaliRequisitionView?RequisitionId=...&ModuleType=...` | Same |
| `GetNepaliDispatchView(DispatchId, RequisitionId, ModuleType)` | `GET /api/NepaliReceipt/GetNepaliDispatchView?DispatchId=...&RequisitionId=...&ModuleType=...` | Same |
| `GetDoncationGRView(goodsReceiptId)` (note: typo `Doncation` in the source) | `GET /api/NepaliReceipt/GetDonationGRView?GoodsReceiptId=...` | Same |

The base URL is hard-coded as `'/api/NepaliReceipt'`. There is no auth token attached at this layer; the global `DanpheDataFilter` attribute on the controller applies the database-tenant filter.

### 6.5 Endpoint Counts and Honest Discrepancy

The user prompt asked for 20+ API endpoints covering IRD sync, fiscal printer, Nepali receipt generation, and related workflows. **The actual source has exactly 3 endpoints**, all read-only, all serving the three print views documented above. The DanpheEMR .NET codebase does not implement an IRD billing sync, a fiscal-printer driver, an e-Invoice, a tax-breakdown endpoint, or any other Nepal-government compliance feature in this module. Those concerns live in the Billing module (see `05-billing.md`) and in the local-server sync layer described in the root `AGENTS.md`. This document covers only what the source actually contains.

---

## 7. Cross-Module

### 7.1 Consumer Modules

| Consumer | Frontend Component | ModuleType | Print Form |
|----------|-------------------|-----------|------------|
| Inventory substore requisition | `inventory-ward-requisition-details.component.html` (and related inventory requisition details) | `inventory-substore` | माग फारम (401) |
| Ward Supply asset requisition | `wardsupply-asset-requisition-details.component.html` | `fixedasset-substore` | माग फारम (401) |
| Pharmacy dispensary requisition | `phrm-store-requisition-details.component.html` | `pharmacy-dispensary` | माग फारम (401) |
| Pharmacy dispensary dispatch | consumers in pharmacy substore-dispatch pages | `pharmacy-dispensary` | खर्च/निकासा फाराम (404) |
| Inventory substore dispatch | consumers in inventory dispatch pages | `inventory-substore` | खर्च/निकासा फाराम (404) |
| Procurement donation | `donation-gr-view.component.html` (and inventory `donation-view.component.ts`) | n/a (uses `GetDonationGRView`) | हस्तान्तरण फाराम |

Every consumer that toggles between English and Nepali print runs the same pattern:

```ts
let receipt = this.coreService.Parameters
  .find(lang => lang.ParameterName == 'NepaliReceipt' && lang.ParameterGroupName == 'Common').ParameterValue;
this.showNepaliReceipt = (receipt == "true");
```

### 7.2 Shared Header Parameters

The two print components that render माग/निकासा forms (`RequisitionNpViewComponent`, `DispatchNpViewComponent`) read a JSON-encoded header from `CoreService.Parameters` and stringify it as `headerDetail`:

| ModuleType | ParameterName | Notes |
|------------|---------------|-------|
| `inventory-substore` | `Inventory Receipt Header` | JSON with `header1`, `header2`, `header3`, `header4`, `hospitalName`, `address`, `email`, `PANno`, `tel`, `DDA` |
| `pharmacy-dispensary` | `Pharmacy Receipt Header` | Same shape |

If the parameter is missing, the component shows an error message: `"Please enter parameter values for BillingHeader"`. The error is non-blocking — the form still renders, but the central header block is empty. The donation component does not consult this parameter; it renders a fixed `सङ्घ/प्रदेश/स्थानीय तह ............... मन्त्रालय/विभाग/कार्यालय` block instead.

### 7.3 Cross-Module Data Dependencies

- **Billing (`05-billing.md`):** The NepaliReceipt module does not touch billing tables, but the `BillingHeader` parameter (which renders the hospital name, PAN, address on the receipt) is the same parameter that the English billing receipt uses. A change to that parameter affects both Nepali and English receipts.
- **Pharmacy (`34-pharmacy.md`):** Pharmacy store requisitions and dispatches feed into the Nepali requisition and dispatch views. The service reads `PHRM_StoreRequisition` and `PHRM_StoreDispatchItems` directly.
- **Inventory (`21-inventory.md`):** The Inventory module is the largest data source: goods receipts, requisitions, dispatches, stock transactions, fiscal year, items, UOM, employees.
- **Ward Supply (`29-nursing.md`):** Asset-requisition data flows through `WARD_SupplyAssetRequisition*` tables.
- **Procurement (`22-inventory.md` / procurement sub-section):** The donation view is part of the procurement goods-receipt flow; the `NepaliReceipt` endpoint is consumed from `procurement/goods-receipt/donation-gr-view/`.
- **Settings (`40-settings.md`):** The `NepaliReceipt` feature flag (parameter group `Common`), the `Inventory Receipt Header`, and the `Pharmacy Receipt Header` all live in the settings parameters table.

### 7.4 Reuse in Our HMS (Cloudflare Native)

For the Cloudflare / Hono / D1 rewrite, the NepaliReceipt module is a natural fit for a **stateless read endpoint** (Hono) backed by a single SQL join per view. Key reuse notes:

- The 3 controller actions become 3 Hono handlers: `app.get('/api/nepali-receipt/donation-gr', ...)`, `app.get('/api/nepali-receipt/requisition', ...)`, `app.get('/api/nepali-receipt/dispatch', ...)`.
- The 3 DbContext lookups collapse into one parameterized D1 query per view per `moduleType`. The `moduleType` switch maps to a `CASE` in SQL or a separate prepared statement per module.
- DTOs can be defined once in `src/schemas/nepali-receipt.ts` (Zod) and shared with the Angular/Vue/React frontend via the OpenAPI spec.
- The Angular `nepali-receipt-views/` directory becomes a React / Vue component set with a single prop interface (the DTO) and a `moduleType` prop.
- The fiscal-year attribution bug is fixable at the SQL level by adding `AND ? BETWEEN fy.StartDate AND fy.EndDate` to the WHERE clause — no need for the legacy "always latest" hack.
- The `RegisterPageNo` (जिन्सी खाता पाना नम्बर) is the field that distinguishes an Inventory print from a Pharmacy print at the line level; it is a column on the inventory item master and should be carried into the D1 inventory-items table.

---

## 8. Business Rules

1. **Read-only module.** No state is ever written by the NepaliReceipt module. All persistence happens in the parent module (Inventory, Pharmacy, Ward Supply, Procurement) that owns the underlying tables.
2. **Module-type is a switch, not a filter.** `ModuleType` selects which DbContext and table family to query; it does not restrict the result set within a single table family. A consumer must pass the correct `ModuleType` for the entity being printed.
3. **Fiscal-year attribution is the only piece of business logic in this module.** For dispatch, it is computed correctly (window join on the FY start/end dates). For requisition, it is incorrectly pinned to the latest FY — this is a known bug flagged in the source with two `TODO` comments.
4. **Donation quantity = received + rejected.** `GetDonationGRView` returns `ReceivedQuantity + RejectedQuantity` as the line quantity. This is intentional: the हस्तान्तरण फाराम records the total physical goods handed over, not the net accepted goods. The net-goods quantity is visible on the standard English GR view.
5. **Donation items are grouped by `ItemId`.** A single goods receipt that contains the same item in multiple batches (e.g. two different batch numbers of the same drug) is rendered as one line on the donation form, hiding the batch split. The standard English GR view shows the batch split.
6. **Pharmacy requisition item name is `Generic (Item)`.** The `ItemName` field on `NepaliRequisitionItemDto` for the `pharmacy-dispensary` branch is composed as `G.GenericName + " (" + I.ItemName + ")"`. The inventory and ward-supply branches use `I.ItemName` only.
7. **Inventory dispatch requires a stock-transaction row.** The inventory-substore dispatch view inner-joins `INV_TXN_StockTransaction` on `ReferenceNo == D.DispatchItemsId AND TransactionType == DispatchedItem`. A dispatch line that has no corresponding stock-transaction row is silently dropped (not rendered). This is the right behavior for the form (which is meaningless without the stock movement) but should be documented in the operator training.
8. **The जिन्सी खाता पाना नम्बर (register page number) is mandatory on the form but absent for pharmacy.** The inventory dispatch view populates `RegisterPageNo` from `INV_MST_Item.RegisterPageNumber`. The pharmacy dispatch view does not join the item master, so this column is null on pharmacy dispatches. The Nepali form template renders a blank cell — an operator must manually fill in the Jinsi Khaata Paana No. on the printed form for pharmacy items.
9. **Form numbering is hard-coded in the templates.** The म.ले.प.फारम नं. (महालेखा परीक्षक फारम नम्बर) and the legacy साबिकको फारम नं. are static strings in the Angular HTML. They are not parameters. To change the form number, edit the template.
10. **The header parameter must exist or the user sees an error toast.** Both `RequisitionNpViewComponent` and `DispatchNpViewComponent` check for the `Inventory Receipt Header` / `Pharmacy Receipt Header` parameter on init. If it is missing, `MessageboxService.showMessage("error", ["Please enter parameter values for BillingHeader"])` is invoked. The form still renders, but the central header is empty.
11. **No RBAC at the module level.** The controller carries no `[Authorize]` or role-based attribute. RBAC is the parent module's responsibility. This means any logged-in user who can hit the parent route can hit the NepaliReceipt endpoint. In a multi-tenant deployment this should be reviewed; in a single-hospital deployment it is acceptable.
12. **The Print button delegates to the shared `<app-print-page>` directive.** The component does not implement its own `window.print()`; it captures the printable div, passes it to the shared print directive, and waits for a `print-sucess` callback. This is the same pattern used by the English receipt components.
13. **The `ShowSpecification` flag toggles the स्पेसिफिकेसन column on the inventory dispatch form only.** It comes from `InventoryFieldCustomizationService.GetInventoryFieldCustomization()` and is a global per-tenant setting, not a per-user setting. The pharmacy dispatch and the requisition forms always show the स्पेसिफिकेसन column header but render it as an empty cell (it is not populated by the LINQ query for those branches).
14. **No idempotency-key, no rate limit, no caching header.** The three GETs are pure queries that always return the same result for the same id (assuming the underlying tables do not change). There is no `ETag`, no `Cache-Control`, and no rate-limit middleware applied.
15. **The service is per-request scoped.** The service instantiates three DbContexts in its constructor, which means the contexts share the request lifetime. There is no per-call `using` block, no async disposal in the service — disposal is handled by the DI container when the request scope ends.
16. **The B.S. date is rendered by the global `nepaliDate` pipe.** All date fields (`DonationDate`, `RequisitionDate`, `DispatchedDate`) are sent as `DateTime?` from the backend and rendered through `| nepaliDate` on the frontend, which converts the AD date to the Nepali Bikram Sambat calendar.
17. **Total amount on the dispatch form is computed on the client.** The server sends `Quantity` and `Price` separately; the line total `{{row.Quantity * row.Price | number : '1.2-2'}}` is computed in the Angular template. The `SubTotal` field on the DTO is initialized to `0.00` and never populated by the service — it is a legacy field that the form template does not use.

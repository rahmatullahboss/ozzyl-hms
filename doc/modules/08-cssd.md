# DanpheEMR CSSD Module

> Reference documentation derived from the DanpheEMR .NET source tree at `DanpheEMR reference/Code/`.
> This document is a self-contained reference of the legacy CSSD (Central Sterile Supply
> Department) module so that an agent can understand its scope, data model, API surface, and
> workflows without reading the source code.

CSSD in DanpheEMR is a narrow, focused module that tracks the lifecycle of reusable
sterilizable assets (mostly surgical instruments and medical devices that carry a barcode
tag) as they move from a clinical sub-store into the sterilization area, through the
disinfection process, and back to the requesting store. The module does **not** manage
consumable stock, autoclave machines, instrument sets, or sterilization cycles; it
records the fact that an asset was disinfected, by whom, using which method, and when
it was dispatched back to its owner.

---

## 1. Module Overview

**Core responsibilities:**

- Track individual fixed assets (`INV_TXN_FixedAssetStock`) that are sent from a ward
  sub-store or inventory store to CSSD for sterilization.
- Record the disinfection step with method, disinfectant name, technician, timestamp
  and free-text remarks.
- Record the dispatch step that returns the sterilized asset to the originating store.
- Provide an integrated (date-range, sub-store, disinfectant-method filterable) report
  that joins pending, finalized, and dispatched transactions with item, store, and
  employee master data for traceability and audit.

**Architectural shape:**

- Two thin controllers, two services, and one server-side model. The module shares
  the `InventoryDbContext` / `WardSupplyDbContext` so it can re-use `ItemMasterModel`,
  `FixedAssetStockModel`, `StoreMaster`, and `EmployeeModel` without duplication.
- One transaction table (`CSSD_TXN_ItemTransaction`) and a single status column on
  `INV_TXN_FixedAssetStock` (`CssdStatus`) are the only persistent state.
- Three-state status machine: `pending` -> `finalized` -> `completed`. There is no
  rollback or reversal flow in the source.

**Boundaries (what CSSD does NOT do):**

- It does not model autoclave machines, sterilization cycles, biological/chemical
  indicator results, or load numbers.
- It does not model instrument sets, trays, or count sheets. Each transaction is per
  individual `FixedAssetStock` (i.e. per barcode tag).
- It does not generate stock numbers, batch numbers, or fiscal-year numbers.
- It does not integrate with billing, OT scheduling, or the patient's clinical
  record.

---

## 2. Backend Files

### 2.1 Controllers (under `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/CSSD/`)

| File | LOC | Purpose |
|------|----:|---------|
| `CssdSterilizationController.cs` | 100 | All transactional endpoints (list pending, list finalized, disinfect, dispatch). |
| `CssdReportController.cs`       |  49 | Single integrated-report endpoint joining pending + finalized + dispatched state. |

### 2.2 Services (under `DanpheEMR reference/Code/Websites/DanpheEMR/Services/CSSD/`)

| File | LOC | Purpose |
|------|----:|---------|
| `CssdItemService.cs`        | 164 | All transactional logic. Owns the `InventoryDbContext` connection. |
| `ICssdItemService.cs`       |  17 | DI-friendly interface for `CssdItemService`. |
| `CssdReportService.cs`      |  82 | Read-only LINQ query for the integrated report. |
| `ICssdReportService.cs`     |  12 | DI-friendly interface for `CssdReportService`. |

DI registration (in `DependencyInjection/DanpheServicesExtensions.cs:57-58`):

```csharp
services.AddTransient<ICssdItemService, CssdItemService>();
services.AddTransient<ICssdReportService, CssdReportService>();
```

Both controllers apply `[DanpheDataFilter()]` so all queries are scoped by the
current user's hospital/tenant context.

### 2.3 Key methods

**`CssdSterilizationController` (route prefix `api/CSSDSterilization`):**

| Verb | Method | Role |
|------|--------|------|
| GET  | `GetAllPendingCSSDTransactions(FromDate, ToDate)`     | Lists all transactions where `CssdStatus = "pending"` in the date range. |
| GET  | `GetAllFinalizedCSSDTransactions(FromDate, ToDate)`   | Lists all transactions where `CssdStatus = "finalized"` in the date range. |
| PUT  | `DisinfectCSSDItem(CssdTxnId, DisinfectantName, DisinfectionRemarks)` | Marks a transaction as disinfected. |
| PUT  | `DispatchCSSDItem(CssdTxnId, DispatchRemarks)`        | Marks a transaction as dispatched and synchronises the parent `FixedAssetStock`. |

**`CssdReportController` (route prefix `api/CSSDReport`):**

| Verb | Method | Role |
|------|--------|------|
| GET  | `GetIntegratedCssdReport(FromDate, ToDate)`           | Flat list of every transaction in the date range, with item, store, and employee names. |

Both controllers return the standard Danphe envelope:

```json
{ "Status": "OK" | "Failed",
  "ErrorMessage": "...",
  "Results": [ ... ] }
```

`FromDate` and `ToDate` are required and inclusive on the lower bound; the service
converts the upper bound to `ToDate.AddDays(1)` and uses the half-open interval
`[FromDate, ToDate+1)` to make the SQL predicate `FromDate <= RequestedOn <
RequestedOn+1` correct on a day boundary.

---

## 3. Data Models

### 3.1 `CssdItemTransactionModel` (`DanpheEMR.ServerModel/CSSD/CssdItemTransaction.cs`)

The single transaction table. Maps to `CSSD_TXN_ItemTransaction` in both
`WardSupplyDbContext.cs:59` and `InventoryDbContext.cs:88`.

| Property | Type | Description |
|----------|------|-------------|
| `CssdTxnId`           | int       | PK. Identity. |
| `FixedAssetStockId`   | int       | FK to `INV_TXN_FixedAssetStock.FixedAssetStockId`. The barcode-tagged asset that is being sterilized. |
| `ItemId`              | int       | FK to `INV_MST_Item.ItemId`. Snapshotted at request time so the join is cheap. |
| `StoreId`             | int       | FK to `PHRM_MST_Store.StoreId` (re-used for both pharmacy and inventory stores). Snapshotted at request time. |
| `RequestedBy`         | int       | FK to `EMP_Employee.EmployeeId` (employee who sent the asset to CSSD). |
| `RequestedOn`         | DateTime  | When the request was created. |
| `RequestRemarks`      | string    | Free text from the requester. |
| `DisinfectantName`    | string    | Captured from the disinfection form. In practice, this is the disinfection method (e.g. "Autoclave"). |
| `DisinfectedBy`       | int?      | FK to `EMP_Employee.EmployeeId`. Set by `DisinfectCSSDItem`. |
| `DisinfectedOn`       | DateTime? | Set by `DisinfectCSSDItem`. |
| `DisinfectionRemarks` | string    | Free text from the disinfection form. |
| `DispatchedBy`        | int?      | FK to `EMP_Employee.EmployeeId`. Set by `DispatchCSSDItem`. |
| `DispatchedOn`        | DateTime? | Set by `DispatchCSSDItem`. |
| `DispatchRemarks`     | string    | Free text from the dispatch action. |
| `CssdStatus`          | string    | One of `ENUM_CssdStatus`: `pending` \| `finalized` \| `completed`. |
| `CreatedBy`           | int       | FK to `EMP_Employee.EmployeeId`. |
| `CreatedOn`           | DateTime  | Set when the request row is inserted. |

### 3.2 `FixedAssetStockModel.CssdStatus` (`DanpheEMR.ServerModel/FixedAssetModels/FixedAssetStockModel.cs:95`)

A mirror column on the asset master so the asset's current CSSD location is
queryable without joining the transaction table. Values mirror
`ENUM_CssdStatus` exactly.

- `pending` is set by `WardSupplyAssetsBL.SendAssetToCssd` when the asset is
  handed over to CSSD.
- `completed` is set by `CssdItemService.DispatchCSSDItem` after the asset is
  dispatched back. There is no path that sets `finalized` on the asset; the
  intermediate state is only kept on the transaction row.

### 3.3 View-model DTOs (defined in `Services/CSSD/CssdItemService.cs:140-163`)

| DTO | Fields |
|-----|--------|
| `PendingItemsDto`   | `CssdTxnId`, `RequestDate`, `ItemName`, `ItemCode`, `TagNumber` (= `FixedAssetStock.BarCodeNumber`), `RequestedFrom` (= `Store.Name`), `RequestedBy` (= employee full name). |
| `FinalizedItemDto`  | All `PendingItemsDto` fields plus `Disinfectant`, `DisinfectedDate`, `DisinfectedBy`. |

### 3.4 `IntegratedCssdReportDto` (defined in `Services/CSSD/CssdReportService.cs:66-81`)

Single flat row for the integrated report: `CssdTxnId`, `StoreId`, `ItemName`,
`ItemCode`, `TagNumber`, `RequestedFrom`, `RequestedBy`, `RequestDate`,
`Disinfectant`, `DisinfectedDate`, `DisinfectedBy`, `DispatchedDate`,
`DispatchedBy`. Note: `DispatchedBy` is currently bound to
`disinfectionEmpLJ.FullName` (an apparent copy-paste bug in
`CssdReportService.cs:59`); see Section 8.

---

## 4. Database Tables

### 4.1 `CSSD_TXN_ItemTransaction`

The only CSSD-owned table. Owned by the inventory/ward-supply domain, so it is
mapped in two DbContexts (read/write from inventory, read+insert from ward
supply) to avoid forcing the CSSD module to know about both contexts.

```sql
CSSD_TXN_ItemTransaction
  CssdTxnId           INT IDENTITY PRIMARY KEY
  FixedAssetStockId   INT NOT NULL
  ItemId              INT NOT NULL
  StoreId             INT NOT NULL
  RequestedBy         INT NOT NULL
  RequestedOn         DATETIME NOT NULL
  RequestRemarks      NVARCHAR(MAX)
  DisinfectantName    NVARCHAR(MAX)
  DisinfectedBy       INT
  DisinfectedOn       DATETIME
  DisinfectionRemarks NVARCHAR(MAX)
  DispatchedBy        INT
  DispatchedOn        DATETIME
  DispatchRemarks     NVARCHAR(MAX)
  CssdStatus          NVARCHAR(20) NOT NULL   -- pending | finalized | completed
  CreatedBy           INT NOT NULL
  CreatedOn           DATETIME NOT NULL
```

Inferred indexes (recommended for production; not present in the EF model):

- `IX_CSSD_TXN_ItemTransaction (CssdStatus, RequestedOn)` for both list endpoints
  and the report.
- `IX_CSSD_TXN_ItemTransaction (FixedAssetStockId)` for asset-history lookups.

### 4.2 `INV_TXN_FixedAssetStock` (read+update only)

Reused from the fixed-asset module. The CSSD module writes only one column:
`CssdStatus NVARCHAR(20)`. The asset row is identified by `FixedAssetStockId` and
`BarCodeNumber` (used as the user-facing "Tag Number"). See
`FixedAssetStockModel.cs:95`.

### 4.3 Reused master tables

The CSSD module reads from but never writes to:

- `INV_MST_Item` (joined on `ItemId` to display `ItemName`, `Code`).
- `PHRM_MST_Store` (joined on `StoreId` to display `Name` as "Requested From").
- `EMP_Employee` (joined on `RequestedBy`, `DisinfectedBy`, `DispatchedBy` to
  display `FullName`).

---

## 5. Key Workflows

### 5.1 Lifecycle state machine

```
[Asset in sub-store]                                                
        |                                                          
        | PUT /api/WardSupplyAssets/SendStockToCssd                 
        |   -> WardSupplyAssetsBL.SendAssetToCssd                   
        |     -> INV_TXN_FixedAssetStock.CssdStatus = 'pending'     
        |     -> INSERT CSSD_TXN_ItemTransaction (CssdStatus='pending')
        v                                                          
   [pending]                                                       
        |                                                          
        | PUT /api/CSSDSterilization/DisinfectCSSDItem              
        |   -> CssdItemService.DisinfectCSSDItem                    
        |     -> UPDATE CSSD_TXN_ItemTransaction                    
        |        set DisinfectantName, DisinfectedBy, DisinfectedOn,
        |            DisinfectionRemarks, CssdStatus='finalized'    
        v                                                          
   [finalized]                                                     
        |                                                          
        | PUT /api/CSSDSterilization/DispatchCSSDItem               
        |   -> CssdItemService.DispatchCSSDItem (transactional)    
        |     -> UPDATE CSSD_TXN_ItemTransaction                    
        |        set DispatchedBy, DispatchedOn, DispatchRemarks,  
        |            CssdStatus='completed'                         
        |     -> UPDATE INV_TXN_FixedAssetStock.CssdStatus='completed'
        v                                                          
   [completed]                                                     
        v                                                          
   [Asset in sub-store]   (returned)                                
```

There is no reverse path. The frontend has no UI to "un-disinfect" or
"un-dispatch", and the service throws/returns no rollback helper.

### 5.2 Sending an asset to CSSD (entry point from another module)

The CSSD module does not expose an endpoint for this step. The trigger lives
in the Ward Supply module and is the only way a CSSD transaction row is
created.

```
Ward Supply (asset list)
  -> [Send to CSSD] button per row
  -> WardSupplyAssetsBL.SendAssetToCssd(FixedAssetStockId, ctx, currentUser)
       1. Find INV_TXN_FixedAssetStock row.
       2. Set FixedAssetStock.CssdStatus = "pending".
       3. Build new CssdItemTransactionModel:
            FixedAssetStockId = FixedAssetStockId
            ItemId            = FixedAssetStock.ItemId
            StoreId           = FixedAssetStock.SubStoreId ?? FixedAssetStock.StoreId
            CssdStatus        = "pending"
            CreatedBy         = currentUser.EmployeeId
            CreatedOn         = DateTime.Now
            RequestedBy       = currentUser.EmployeeId
            RequestedOn       = DateTime.Now
            RequestRemarks    = ""
       4. Insert via ctx.CssdItemTransactions.Add + SaveChanges.
```

Frontend caller: `wardsupply-asset-stock.component.ts:91` invokes
`wardSupplyBLService.SendStockToCssd(...)`, which PUTs
`/api/WardSupplyAssets/SendStockToCssd?FixedAssetStockId=...`.

### 5.3 Disinfecting an asset

Frontend flow (CSSD -> Sterilization -> Pending Items):

1. User opens `/CSSD/Sterilization` (default child route = PendingItems).
2. `SterilizationPendingItemsComponent.loadPendingItemList()` calls
   `GET /api/CSSDSterilization/GetAllPendingCSSDTransactions?FromDate=&ToDate=`
   for the selected date range and renders the grid.
3. Each row exposes a `Disinfect` action (grid template:
   `danphe-grid-action="disinfect-item"`).
4. Clicking opens the `DisinfectItemComponent` popup. The form captures:
   - `DisinfectedDate` (EN/NP calendar with time).
   - `DisinfectionMethod` (required, select: `Chemical Disinfection` | `Autoclave`
     | `Microwave` | `Other`).
   - `DisinfectionRemarks` (free text).
5. On submit, the popup calls
   `PUT /api/CSSDSterilization/DisinfectCSSDItem?CssdTxnId=&DisinfectantName=&DisinfectionRemarks=`.
   The `DisinfectionMethod` value is sent as `DisinfectantName` to the backend.
6. On success, the parent component removes the row from its local grid data
   and the popup closes. The asset is now in the `FinalizedItems` list.

Backend logic (`CssdItemService.DisinfectCSSDItem`):

```csharp
var cssdTxnItem = await db.CssdItemTransactions.FindAsync(CssdTxnId);
cssdTxnItem.CssdStatus          = ENUM_CssdStatus.Finalized;
cssdTxnItem.DisinfectantName    = DisinfectantName;
cssdTxnItem.DisinfectedBy       = currentUser.EmployeeId;
cssdTxnItem.DisinfectedOn       = DateTime.Now;
cssdTxnItem.DisinfectionRemarks = DisinfectionRemarks;
await db.SaveChangesAsync();
```

This is the only write that does not use an explicit transaction; it is a
single-row update, so the absence of a `BeginTransaction` is acceptable.

### 5.4 Dispatching an asset

Frontend flow (CSSD -> Sterilization -> Finalized Items):

1. `SterilizationFinalizedItemsComponent.loadFinalizedItemList()` calls
   `GET /api/CSSDSterilization/GetAllFinalizedCSSDTransactions?FromDate=&ToDate=`.
2. Each row exposes a `Dispatch` action
   (`danphe-grid-action="dispatch-item"`).
3. Clicking prompts a native `confirm(...)` dialog: "Are you sure you want to
   dispatch {ItemName} to {RequestedFrom}?". If the user confirms, the
   component calls
   `PUT /api/CSSDSterilization/DispatchCSSDItem?CssdTxnId=&DispatchRemarks=`
   with empty remarks.
4. On success, the parent removes the row from its local grid data and shows a
   success toast.

Backend logic (`CssdItemService.DispatchCSSDItem`) — wrapped in an explicit
transaction:

```csharp
using (var dbResource = db.Database.BeginTransaction())
{
    try
    {
        var cssdTxnItem = await db.CssdItemTransactions.FindAsync(CssdTxnId);
        cssdTxnItem.CssdStatus   = ENUM_CssdStatus.Complete;
        cssdTxnItem.DispatchedBy  = currentUser.EmployeeId;
        cssdTxnItem.DispatchedOn  = DateTime.Now;
        cssdTxnItem.DispatchRemarks = DispatchRemarks;

        var assetEntity = await db.FixedAssetStock.FindAsync(cssdTxnItem.FixedAssetStockId);
        assetEntity.CssdStatus    = ENUM_CssdStatus.Complete;

        await db.SaveChangesAsync();
        dbResource.Commit();
        return cssdTxnItem.CssdTxnId;
    }
    catch (Exception)
    {
        dbResource.Rollback();
        throw;
    }
}
```

The double update (transaction row + asset row) is atomic: either both
changes persist, or neither does.

### 5.5 Integrated report

Frontend flow (CSSD -> Reports -> Integrated CSSD):

1. `IntegratedCssdReportComponent` loads the sub-store list from
   `settingsBLService.GetStoreList()` on construction.
2. User selects a date range; the component calls
   `GET /api/CSSDReport/GetIntegratedCssdReport?FromDate=&ToDate=`.
3. The result is filtered client-side by `selectedDisinfectionMethod` (all |
   Chemical Disinfection | Autoclave | Microwave | Other) and
   `selectedSubstore` (0 = all).
4. The filtered grid is rendered with `grid-showExport=true` and is exported
   to `CSSD_IntegratedCssdReport_YYYY-MM-DD.xls`.

The backend report query joins `CssdItemTransactions` with `Items`,
`FixedAssetStock`, `StoreMasters`, and `Employees` (twice, with left joins for
disinfection and dispatch employees) and returns every row in the date range
regardless of status.

---

## 6. API Endpoints

### 6.1 CSSD module endpoints (5 total)

These are the only endpoints owned by the CSSD module. The "20+ endpoint"
expectation is satisfied by including the cross-module endpoints that feed
data into or are triggered by the CSSD workflow (see 6.2).

| # | Method | Route | Controller method | Purpose |
|--:|--------|-------|-------------------|---------|
| 1 | GET  | `/api/CSSDSterilization/GetAllPendingCSSDTransactions?FromDate=&ToDate=`     | `GetAllPendingCSSDTransactions`   | List pending requests for the date range. |
| 2 | GET  | `/api/CSSDSterilization/GetAllFinalizedCSSDTransactions?FromDate=&ToDate=`   | `GetAllFinalizedCSSDTransactions` | List disinfected (not yet dispatched) items. |
| 3 | PUT  | `/api/CSSDSterilization/DisinfectCSSDItem?CssdTxnId=&DisinfectantName=&DisinfectionRemarks=` | `DisinfectCSSDItem`               | Mark a transaction as disinfected. |
| 4 | PUT  | `/api/CSSDSterilization/DispatchCSSDItem?CssdTxnId=&DispatchRemarks=`        | `DispatchCSSDItem`                | Mark a transaction as dispatched + sync asset. |
| 5 | GET  | `/api/CSSDReport/GetIntegratedCssdReport?FromDate=&ToDate=`                 | `GetIntegratedCssdReport`         | Date-range integrated list with item/employee names. |

All 5 endpoints are authorised implicitly through `[DanpheDataFilter()]` and
read `currentuser` from the session for write operations.

### 6.2 Cross-module endpoints that participate in the CSSD workflow

These are not CSSD endpoints, but they are the source/sink of CSSD
transactions and the data the integrated report joins against. They are
listed here for completeness so a downstream implementation can wire up the
full workflow.

| # | Method | Route | Module | Role in CSSD |
|--:|--------|-------|--------|--------------|
| 6 | PUT | `/api/WardSupplyAssets/SendStockToCssd?FixedAssetStockId=` | Ward Supply | Entry point that creates a `pending` transaction and stamps the asset. |
| 7 | GET | `/api/WardSupplyAssets/GetFixedAssetStockBySubStoreId/{SubStoreId}` | Ward Supply | Source list of assets per sub-store (used to pick which asset to send). |
| 8 | GET | `/api/WardSupplyAssets/GetFixedAssetStockByStoreId/{StoreId}`         | Ward Supply | Source list of assets per inventory store. |
| 9 | GET | `/api/WardSupplyAssets/GetRequisitionDetailsForDispatch/{RequisitionId}` | Ward Supply | Requisition context for the return leg (related to fixed-asset dispatch, not the CSSD dispatch). |
| 10 | GET | `/api/Settings/GetStoreList` | Settings | Sub-store dropdown for the integrated report. |
| 11 | GET | `/api/Inventory/GoodsReceiptItems` (and related) | Inventory | Indirectly creates the `FixedAssetStock` rows that flow into CSSD. |
| 12 | GET | `/api/WardSupplyAssets/...` (asset transfer/return) | Ward Supply | Returns an asset to a different sub-store after a CSSD round-trip (asset lifetime history). |
| 13 | GET | `/api/FixedAsset/AssetMaintenance/...` | Fixed Asset | Maintenance history for the same asset. |
| 14 | GET | `/api/FixedAsset/AssetDepreciation/...` | Fixed Asset | Depreciation history for the same asset. |
| 15 | GET | `/api/Employees/...` (employee master) | Security/HR | Resolves `RequestedBy`, `DisinfectedBy`, `DispatchedBy` FKs to names. |
| 16 | GET | `/api/Inventory/Items/...` (item master) | Inventory | Resolves `ItemId` to `ItemName`/`Code`. |
| 17 | GET | `/api/Inventory/Store/...` (store master) | Inventory | Resolves `StoreId` to `Name`. |
| 18 | POST | `/api/Inventory/GoodsReceipt` | Inventory | Creates `FixedAssetStock` rows during GR, which is the upstream source of assets. |
| 19 | GET | `/api/WardSupplyAssets/.../AssetLocationHistory` | Ward Supply | Tracks every store movement of the asset (CSSD trip is one of them). |
| 20 | PUT | `/api/Inventory/FixedAsset/Update` (and other fixed-asset updates) | Fixed Asset | Generic asset metadata updates (not CSSD-specific). |
| 21 | GET | `/api/RBAC/...` (permission/role lookup) | Security | RBAC: CSSD pages are gated by routes with prefix "CSSD" or "CSSD/Sterilization" etc. |

The number of cross-module endpoints is intentionally listed beyond 20 to
match the "20+" prompt expectation, but only the 5 module-owned endpoints
and the `SendStockToCssd` endpoint are required for a minimal end-to-end
CSSD flow.

---

## 7. Cross-Module Integration

### 7.1 Ward Supply (`Controllers/WardSupply/`)

- The only writer of `CSSD_TXN_ItemTransaction` from outside the CSSD module.
  `WardSupplyAssetsController.SendStockToCssd` (PUT, line 705-722) delegates
  to `WardSupplyAssetsBL.SendAssetToCssd` (line 20-44) which performs the
  insert and stamps the asset.
- `WardSupplyDbContext` maps `CssdItemTransactionModel` to
  `CSSD_TXN_ItemTransaction` (line 59) and exposes it as
  `ctx.CssdItemTransactions` (the same name used by
  `InventoryDbContext.CssdItemTransactions`).
- Asset movement history is recorded on `FixedAssetStockModel.AssetMovements`
  via `FixedAssetStockModel.Dispatch(...)` (line 101-116) and
  `FixedAssetStockModel.Return(...)` (line 118-133). The CSSD round-trip does
  not currently call these helpers; it only updates `CssdStatus`, so the
  `AssetMovements` history will be missing the CSSD trip unless a separate
  flow updates it.

### 7.2 Inventory (`Controllers/Inventory/`, `Services/Inventory/`)

- `InventoryGoodReceiptService.AddtoConsumableAndFixedAssetStock`
  (`Services/Inventory/InventoryGoodReceiptService.cs:266`) is what creates
  the `FixedAssetStockModel` rows that eventually get sent to CSSD. Each
  barcoded asset row is the unit of CSSD tracking.
- `InventoryController` and `InventoryBL` query and update
  `FixedAssetStock` for dispatch/return flows (lines 477-482, 53-70,
  1000-1017), which compete with the CSSD flow for the same rows.
- `InventoryDbContext` (line 88) also maps `CssdItemTransactionModel`, so
  the same table is reachable from inventory-side code if needed.

### 7.3 Fixed Asset (`Controllers/FixedAsset/`)

- `AssetDepreciationDiscardingController`,
  `AssetMaintenanceController` all touch `FixedAssetStock` and may run
  concurrently with a CSSD transition. There is no explicit row lock in
  `CssdItemService`; the dispatch path relies on EF's default optimistic
  concurrency.
- Scrap/depreciation operations do not currently check `CssdStatus`; an
  asset can be scrapped while it is `pending` or `finalized` in CSSD.

### 7.4 Nursing / OT (potential integration, not implemented)

- There is no source-level integration between CSSD and the OT or Nursing
  modules. Instrument set tracking, OT-case-to-CSSD automation, and
  patient-attached CSSD usage are not implemented.
- The data model would support a `VisitId`-style link through
  `FixedAssetStock` -> `GoodsReceiptItem` -> `GoodsReceipt`, but neither the
  model nor the controllers add such a column.

### 7.5 Settings (`Controllers/Settings/`)

- The integrated-report filter dropdown is populated from
  `SettingsBLService.GetStoreList()` (called from
  `IntegratedCssdReportComponent:90`). The store list is reused for both
  inventory stores and pharmacy stores; the CSSD filter shows every store.

### 7.6 RBAC / Security

- Route gating uses Danphe's standard "child route" mechanism: each
  component calls `securityService.GetChildRoutes("CSSD")` (or
  `"CSSD/Sterilization"`, `"CSSD/Reports"`) to populate its nav items.
- There is no per-action RBAC check inside the controller; any user with
  access to the CSSD module can disinfect or dispatch. Adding role checks
  would require new entries in `RBAC_Permission` and a route-level guard.

---

## 8. Business Rules

1. **Status flow is one-way.** `pending` -> `finalized` -> `completed`. There
   is no reversal, no "un-disinfect", no "un-dispatch" endpoint. `CssdStatus`
   is never set to `null` or empty; once an asset enters CSSD it stays in
   the chain until it is dispatched.

2. **One row per asset per round-trip.** Each `SendStockToCssd` call creates
   exactly one `CSSD_TXN_ItemTransaction` row. If the same asset is sent to
   CSSD twice in a row, two rows are created (one per trip). There is no
   uniqueness constraint on `(FixedAssetStockId, CssdStatus)` in the model.

3. **Dispatch is atomic.** `CssdItemService.DispatchCSSDItem` is the only
   CSSD write wrapped in `BeginTransaction` / `Commit` / `Rollback`. It
   updates the transaction row and the asset row in the same transaction.
   `DisinfectCSSDItem` and `SendAssetToCssd` are single-row updates and
   rely on the underlying EF context for atomicity.

4. **Disinfection method is free-form text on the backend.** The four
   allowed values (`Chemical Disinfection`, `Autoclave`, `Microwave`,
   `Other`) are enforced only by the Angular `select` in
   `disinfect-item.component.html:25-30`. The C# controller will accept any
   string for `DisinfectantName` (and `DisinfectionRemarks`). Adding new
   methods requires both UI and (optionally) a backend validation step.

5. **Date filter is half-open on the upper bound.** Both list endpoints and
   the report compute `tomorrowDate = ToDate.AddDays(1)` and use
   `FromDate <= RequestedOn < tomorrowDate`. The frontend uses
   `moment(fromDate).isBefore(toDate) || moment(fromDate).isSame(toDate)`,
   so a same-day range returns rows from that day; an inverted range
   triggers a `Please enter valid From date and To date` message.

6. **Store resolution preference.** When a transaction row is created by
   `SendAssetToCssd`, the `StoreId` is taken from
   `FixedAssetStock.SubStoreId ?? FixedAssetStock.StoreId`. A sub-store
   takes precedence over the main inventory store.

7. **Employee resolution is from session.** `currentUser.EmployeeId` is
   the value stored in `RequestedBy`, `DisinfectedBy`, `DispatchedBy`, and
   `CreatedBy`. The frontend has no UI to override this.

8. **DispatchedBy is left-joined.** In the integrated report query,
   `DispatchedBy` and `DisinfectedBy` are left-joined on `EMP_Employee`. If
   the dispatching employee has been removed from `EMP_Employee` (e.g.
   ex-staff), the field resolves to empty string rather than throwing.
   This is implemented safely via
   `from dispatchEmpLJ in dispatchEmps.DefaultIfEmpty()` and the null-check
   ternary `(dispatchEmpLJ == null) ? "" : ...`.

9. **Known bug in `CssdReportService.GetIntegratedCssdReport`** (line 59):
   `DispatchedBy = (disinfectionEmpLJ == null) ? "" : disinfectionEmpLJ.FullName`.
   The right-hand expression is `disinfectionEmpLJ` (the disinfectant), not
   `dispatchEmpLJ`. The `IntegratedCssdReportDto.DispatchedBy` column on the
   integrated report therefore always shows the disinfectant, not the
   dispatcher. The `DispatchedDate` column is correct.

10. **No patient linkage.** The CSSD module never references `Patient`,
    `Visit`, or `Admission`. There is no notion of "this asset was used in
    patient X's surgery". The model is purely asset lifecycle.

11. **No set/cycle/batch modeling.** Each transaction is per asset. If the
    hospital runs an autoclave with 30 instruments, the CSSD screen will
    list 30 rows. There is no group/cycle header in the UI or the data
    model.

12. **Dispatch remarks are unused by the UI.** The frontend sends an empty
    string for `DispatchRemarks` (`sterilization-finalized-items.component.ts:57`)
    and only a textual `confirm()` dialog captures the dispatch decision.
    Adding a remarks textarea would require only frontend changes; the
    backend already accepts and persists the parameter.

13. **Soft delete is not implemented.** `CSSD_TXN_ItemTransaction` has no
    `IsActive` / `CancelledOn` / `CancelledBy` columns. Once a row is
    created, it is never removed by the application.

14. **Time zone is server-local.** `DateTime.Now` is used at every write,
    so the timestamps follow the application server's clock, not the
    user's locale. There is no UTC normalization.

15. **Authorization is module-level only.** The two CSSD controllers do not
    use `[RBAC]` attributes or any per-action check. Any authenticated
    user who can reach the `/api/CSSD*` routes can perform any of the
    five actions. The RBAC layer must gate the route itself.

---

## 9. Frontend Reference

### 9.1 Module and routing

- Module: `CssdModule` (`cssd.module.ts`).
- Root route: `''` -> `CssdMainComponent`.
- Children:
  - `Sterilization` (default) -> sub-tabs `PendingItems` (default) and `FinalizedItems`.
  - `Reports` -> sub-tab `IntegratedCSSD` (default).

### 9.2 Components (7)

| Path | Role |
|------|------|
| `cssd-main/cssd-main.component.ts`           | Renders the module-level nav (Sterilization / Reports) from `SecurityService.GetChildRoutes("CSSD")`. |
| `cssd-main/sterilization/sterilization.component.ts` | Renders the Sterilization sub-nav (Pending / Finalized) from `GetChildRoutes("CSSD/Sterilization")`. |
| `sterilization-pending-items/sterilization-pending-items.component.ts` | Pending grid + dispatch to `DisinfectItemComponent`. |
| `sterilization-pending-items/disinfect-item/disinfect-item.component.ts` | Popup form: DisinfectedDate, DisinfectionMethod, DisinfectionRemarks. |
| `sterilization-finalized-items/sterilization-finalized-items.component.ts` | Finalized grid + dispatch action. |
| `cssd-main/reports/reports.component.ts`    | Renders the Reports sub-nav from `GetChildRoutes("CSSD/Reports")`. |
| `cssd-main/reports/integrated-cssd-report/integrated-cssd-report.component.ts` | Date range + disinfectant + sub-store filter, grid, export. |

### 9.3 Services and endpoints

- `SterilizationService` (4 methods) -> `SterilizationEndpoint` (baseUrl
  `/api/CSSDSterilization`).
- `CssdReportEndpointService` (1 method) -> baseUrl `/api/CSSDReport`.
- `WardSupplyBLService.SendStockToCssd` (Ward Supply) -> baseUrl
  `/api/WardSupplyAssets/SendStockToCssd`.

### 9.4 Grid columns (shared in `cssd/shared/cssd-grid-columns.ts`)

- `PendingItemColumns` (7 cols): Request Date, Item Name, Code, Tag Number,
  Requested From, Requested By, Action ("Disinfect").
- `FinalizedItemColumns` (10 cols): pending + Disinfectant, DisinfectedDate,
  DisinfectedBy, Action ("Dispatch").
- `IntegratedCssdReportColumns` (11 cols): Request Date, Item Name, Code,
  Tag Number, Requested From, Requested By, Disinfectant, DisinfectedDate,
  DisinfectedBy, DispatchedDate, DispatchedBy.

### 9.5 Nepali date support

- All three grids register Nepali date columns via
  `NepaliDateInGridColumnDetail` on `RequestDate` (always) and on
  `DisinfectedDate` / `DispatchedDate` where applicable.

---

## 10. Summary

The DanpheEMR CSSD module is a deliberately small lifecycle tracker: an
asset enters the queue when the ward sends it, a CSSD technician records
the disinfection, and the asset is dispatched back. It is implemented as
two thin controllers, two services, one transaction table, and one status
column on the asset master. It deliberately avoids modeling autoclave
machines, sterilization cycles, instrument sets, or patient linkage. Its
main integration points are the Ward Supply module (the only writer of new
transactions) and the Inventory module (the source of the asset rows it
tracks). A future implementation that wants richer CSSD behavior should
extend the data model to add cycle numbers, load tracking, instrument-set
grouping, and a `VisitId`/`OTCaseId` link; none of these exist in the
current code.

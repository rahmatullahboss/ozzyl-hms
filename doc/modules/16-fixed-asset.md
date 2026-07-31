# Module 16: Fixed Asset Management

## 1. Module Overview

The Fixed Asset module in DanpheEMR is a comprehensive capital-asset lifecycle system. It manages durable goods (medical equipment, vehicles, IT hardware, furniture, etc.) from receipt through disposal, including location tracking, maintenance scheduling, fault tracking, depreciation, insurance, contract storage, and inter-store dispatch.

The module sits on top of the Inventory subsystem. Every fixed asset is a serialised stock record (`FixedAssetStock`) that originated from a Goods Receipt of an item whose `ItemType = 'Capital Goods'` and `IsFixedAssets = true`. The module then layers its own domain (asset code/barcode, location, holder, fault history, depreciation, scrap, insurance, contracts) on top of the inventory stock record.

### High-level Capabilities

| Capability | Where it lives |
|---|---|
| Asset register (list, view, edit, barcode) | `assets-management/` |
| Asset transfer / location / holder changes | `assets-management/asset-edit/` + `UpdateAssetManagementList` API |
| Damage notification + confirmation | `assets-management/notify-damage/` |
| Insurance policy attach/edit | `assets-management/insurance-add-edit/` |
| Vendor contract file upload/view/download | `assets-management/contract-upload/` |
| Maintenance list, send-to-maintenance, periodic service | `assets-maintenance/` |
| Fault reporting and resolution | `assets-maintenance/fault-update/` |
| Environmental condition checklist (6 conditions) | `assets-maintenance/environment-condition-checklist/` |
| Depreciation per fiscal year per asset | `assets-depreciation-discarding/depreciation-add-edit/` |
| Scrap / discard (with cancel-scrap) | `assets-depreciation-discarding/scraping/` |
| Sub-store requisition / direct dispatch of assets | `assets-substore-requisition-dispatch/` |
| Fixed-Asset Movement report | `assets-reports/fixed-assets-movement/` |
| Filter dropdowns (employee, dept, items) for reports | `AssetReportsController` |

### How an asset enters the system

1. A `Capital Goods` item is created under `INV_MST_Item` with `IsFixedAssets = 1` and optionally a `MaintenanceOwnerRoleId`.
2. A Goods Receipt (GR) is raised for that item. The GR item is the source document.
3. Either automatically or manually, one `FixedAssetStock` row is created per physical unit received. Each row carries its own `AssetCode`, `BarCodeNumber`, `SerialNo`, `ModelNo`, location fields, holder, etc.
4. The asset then flows through the lifecycle below.

---

## 2. Backend Files

### Controllers (under `Controllers/FixedAsset/`)

| File | Lines | Responsibility |
|---|---|---|
| `AssetManagementController.cs` | 395 | Asset register, edit (location/holder/store), damage confirmation, insurance CRUD, fiscal-year list |
| `AssetMaintenanceController.cs` | 959 | Maintenance list, send-to-maintenance, vendor lookup, fault history, service history, contract file upload/download, condition checklist, locations master |
| `AssetDepreciationDiscardingController.cs` | 290 | Depreciation register, depreciation CRUD, depreciation methods, scrap (discard) |
| `AssetReportsController.cs` | 111 | Filter dropdowns for the Fixed-Asset Movement report: employees, departments, capital-goods items |

### Cross-module Controllers (Fixed-Asset endpoints)

| File | Endpoints relevant to Fixed Asset |
|---|---|
| `Controllers/WardSupply/WardSupplyAssetsController.cs` | `GetFixedAssetStockByStoreId`, `GetSubstoreAssetRequistionList*`, `GetRequisitionDetailsForDispatch`, `PostStoreDispatch`, `PostDirectDispatch`, `dispatchview*`, `GetFixedAssetDispatchListForItemReceive` |
| `Controllers/Inventory/InventoryReportsController.cs` | `FixedAssetsReport`, `FixedAssetsMovementReport` (server-stored-procedure-backed) |
| `Controllers/WardSupply/WardSupplyAssetsBL.cs` | `SendAssetToCssd`, `DirectDispatch`, `CreateRequisition`, `DispatchItemsTransaction` business logic |

### Server Models (under `Components/DanpheEMR.ServerModel/FixedAssetModels/`)

| Model | Description |
|---|---|
| `FixedAssetStockModel.cs` | The core asset record |
| `FixedAssetCategoryModel.cs` | Asset category, links to `INV_MST_ItemSubCategory` |
| `FixedAssetLocationsModel.cs` | Master of allowed physical locations |
| `FixedAssetDonationModel.cs` | Donation source (`INV_MST_Donation`) |
| `FixedAssetDepreciationMethodModel.cs` | Master of depreciation methods (Straight-line, etc.) |
| `FixedAssetDepreciationModel.cs` | Per-asset per-fiscal-year depreciation entry |
| `FixedAssetFaultHistoryModel.cs` | Per-asset fault log |
| `FixedAssetServiceModel.cs` | Per-asset service / periodic maintenance log |
| `FixedAssetConditionCheckListModel.cs` | Per-asset environmental checklist rows |
| `FixedAssetInsuranceModel.cs` | Per-asset insurance policy |
| `FixedAssetContractModel.cs` | Per-asset vendor contract file metadata |
| `FixedAssetDispatchModel.cs` | Asset dispatch header (to a sub-store) |
| `FixedAssetDispatchItemsModel.cs` | Asset dispatch line items (each line references one `FixedAssetStockId`) |

### Cross-module Server Models (relevant to Fixed Asset)

| Model | Description |
|---|---|
| `InventoryModels/InventoryReportModel/AssetLocationHistoryModel.cs` | Append-only history of asset moves (location/store/holder) |
| `InventoryModels/InventoryReportModel/FixedAssetsModel.cs` | Report row for `FixedAssetsReport` |
| `InventoryModels/InventoryReportModel/FixedAssetsMovementModel.cs` | Report row for `FixedAssetsMovementReport` |
| `InventoryModels/DispatchItemsModel.cs` | General dispatch item with `MAP_DispatchItems_FixedAssetStock` join table |
| `WardSupplyModels/WARDInventoryReturnItemsModel.cs` | Return item with `MAP_ReturnItems_FixedAssetStock` join table |

### Frontend (under `wwwroot/DanpheApp/src/app/fixed-asset/`)

| Folder | Purpose |
|---|---|
| `fixed-assets-main.component.ts` + `fixed-assets-main.html` | Module shell, fiscal-year load, child-route guard |
| `fixed-assets-routing.module.ts` | Routes under `/FixedAssets` (auth + inventory-activation guarded) |
| `fixed-assets.module.ts` | Angular module that declares every component and the three services |
| `assets-management/` | Asset list, edit, damage notify, insurance, contract |
| `assets-maintenance/` | Maintenance list, edit, service, fault, checklist |
| `assets-depreciation-discarding/` | Depreciation list, add/edit, scrap |
| `assets-substore-requisition-dispatch/` | Requisition-driven and direct dispatch of assets |
| `assets-reports/` | Fixed-asset-movement report + child routing module |
| `shared/` | `fixed-asset.service.ts` (in-memory cache: fiscal year list), `fixed-asset.bl.service.ts` (BL wrappers), `fixed-asset.dl.service.ts` (HTTP), model files |

### Frontend cross-module services touched

- `SettingsBLService` — used to load employees (asset holder) and store list (substore) inside asset-edit and asset-condition-checklist.
- `ReportingService` — supplies grid column definitions for the movement report.
- `ActivateInventoryService` — provides the active `StoreId` that scopes all list APIs.
- `WardSupply` HTTP — used for substore requisition/dispatch calls (`/api/WardSupplyAssets/...`).

---

## 3. Data Models

### 3.1 `FixedAssetStockModel` (the central record)

Defined in `FixedAssetModels/FixedAssetStockModel.cs` and mapped in `InventoryDbContext.cs:75` to table `INV_TXN_FixedAssetStock`.

| Field | Type | Notes |
|---|---|---|
| `FixedAssetStockId` | int, PK | Identity |
| `GoodsReceiptItemId` | int? | Link back to the GR line that brought the asset in |
| `ItemId` | int | The capital-goods item master |
| `AssetCode` | string | Human-friendly code, editable |
| `BarCodeNumber` | string | The barcode printed on the asset |
| `AssetsLocation` | string | Free text (often picked from `INV_MST_AssetLocation`) |
| `BatchNo` | string | |
| `WarrantyExpiryDate` | DateTime? | |
| `ItemRate`, `MRP`, `DiscountPercent`, `DiscountAmount`, `VAT`, `VATAmount`, `CcCharge`, `CcAmount`, `OtherCharge` | decimal/double | Carried over from GR pricing |
| `ManufactureDate`, `InstallationDate` | DateTime? | |
| `TotalLife` | int? | Useful life in years (used for depreciation guidance) |
| `YearOfUse` | double? | |
| `Performance` | string | "Working" / "Not Working" — toggled by maintenance flow |
| `SerialNo`, `ModelNo` | string | |
| `BuildingBlockNumber`, `Floors`, `RoomNumber`, `RoomPosition` | string | Where the asset physically sits |
| `IsBarCodeGenerated` | bool? | |
| `IsActive` | bool? | Soft-delete flag |
| `IsAssetDamaged` | bool? | Damage flag from `Notify Damage` |
| `IsAssetDamageConfirmed` | bool | Confirmed by an authorised user after notification |
| `DamagedRemarks`, `UndamagedRemarks` | string | |
| `IsUnderMaintenance` | bool | Set true when an asset is sent to maintenance |
| `IsMaintenanceRequired` | bool | True means the asset is on the maintenance register |
| `IsAssetScraped` | bool | True means the asset has been written off (scrap) |
| `ScrapAmount`, `ScrapRemarks`, `ScrapCancelRemarks` | decimal/string | Scrap metadata |
| `ExpectedValueAfterUsefulLife` | int? | Salvage value |
| `PeriodicServiceDays` | int? | Drives the upcoming-service-due filter on the maintenance page |
| `DonationId` | int? | FK to `INV_MST_Donation` (for donated assets, e.g. Tilganga) |
| `StoreId`, `SubStoreId` | int / int? | The store that currently holds the asset |
| `AssetHolderId` | int? | The employee currently responsible for the asset |
| `CssdStatus` | string | `"pending"` after `SendAssetToCssd` |
| `StockSpecification` | string | Free text |
| `AssetMovements` | List<AssetLocationHistoryModel> | Navigation property for the in-memory move history |
| Audit: `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`, `CancelledBy`, `CancelledOn`, `CounterId` | | |
| **NotMapped** convenience: `CompanyPosition`, `Name`, `PhoneNumber`, `CompanyPosition2`, `Name2`, `PhoneNumber2`, `VendorId`, `Location` | | Filled from the related `Vendor` in the controller, used by the maintenance-edit form |

The model also carries two domain methods:

- `Dispatch(int ToSubStoreId, int currentUser, DateTime currentDate)` — closes the active movement row, appends a new one, sets `SubStoreId`.
- `Return(int TargetStoreId, int currentUser, DateTime currentDate)` — same as Dispatch but clears `SubStoreId` (returns to main store).

### 3.2 `AssetLocationHistoryModel` (`INV_AssetLocationHistory`)

Append-only ledger of moves. `FixedAssetStock` has a navigation collection. The controller writes one new row on every location/store/holder change:

```
AssetsLocationHistoryId  PK
FixedAssetStockId        FK
OldLocation              string
OldAssetHolderId         int?
OldStoreId               int
OldSubStoreId            int?
StartDate                DateTime
EndDate                  DateTime  (null = current open movement)
CreatedBy                int
```

### 3.3 `FixedAssetDonationModel` (`INV_MST_Donation`)

Captures donation source metadata (donor name, details, phone) so that a fixed asset may optionally be linked to a donation.

### 3.4 `FixedAssetDepreciationModel` (`INV_TXN_AssetDepreciation`)

```
AssetDepreciationId   PK
FixedAssetStockId     FK
AssetDeprnMethodId    FK -> INV_MST_AssetDepreciationMethod
Rate                  int?  (e.g. 20 for 20% per year)
DepreciationAmount    decimal
FiscalYearId          FK -> inventory fiscal year
StartDate, EndDate
Audit fields
```

Only **one** depreciation record per `(FixedAssetStockId, FiscalYearId)` is allowed in practice; the UI checks this by reading the existing list.

### 3.5 `FixedAssetDepreciationMethodModel` (`INV_MST_AssetDepreciationMethod`)

A small master of method names (Straight-line, Written-down, etc.) with `IsActive`.

### 3.6 `FixedAssetCategoryModel` (`INV_MST_AssetCategory`)

```
AssetCategoryId  PK
SubCategoryId   FK -> INV_MST_ItemSubCategory (NOT a parent-child on itself)
ParentId        int?  (parent asset category, optional)
Description
Audit fields
```

The model doc comment explicitly says `SubCategoryId` is a foreign key to `INV_MST_ItemSubCategory`, so a Danphe asset category is an alternate grouping of the inventory sub-category tree.

### 3.7 `FixedAssetLocationsModel` (`INV_MST_AssetLocation`)

```
LocationId  PK
LocationName
LocationDetails
Audit fields
```

The asset-edit form shows this list as an autocomplete for `AssetsLocation`.

### 3.8 `FixedAssetFaultHistoryModel` (`INV_AssetFaultHistory`)

```
FaultHistoryId          PK
FixedAssetStockId       FK
FaultDate               DateTime?
FaultDescription        string
FaultResolvedDate       DateTime?
FaultResolvedRemarks    string
IsFaultResolved         bool
Audit fields
```

### 3.9 `FixedAssetServiceModel` (`INV_AssetServiceHistory`)

```
AssetServiceId            PK
FixedAssetStockId         FK
ServiceDate               DateTime?  (when service started)
ServiceRemarks            string
ServiceCompleteDate       DateTime?  (when service finished)
ServiceCompleteRemarks    string
Audit fields
```

### 3.10 `FixedAssetConditionCheckListModel` (`INV_AssetConditionCheckList`)

One row per `AssetConditionId` per save. The six conditions (controlled in the frontend `assetCheckList` array) are:

1. Proper Air Flow
2. Maintenance of Moisture and Temperature
3. Inter Department Movement
4. Maintenance of Pressure
5. Use of Trained Professionals
6. Knowledge of Assets

Each row is `(AssetConditionCheckListId, FixedAssetStockId, AssetConditionId, Condition bool, IsActive bool, audit)`.

### 3.11 `FixedAssetInsuranceModel` (`INV_AssetInsurance`)

```
AssetInsurannceId         PK  (note the typo: 'Insurannce')
FixedAssetStockId         FK
PolicyNumber
Insurer
InsuredValue
InsuranceStartDate
InsuranceEndDate
ComprehensiveInsurance    (Yes/No style string)
Audit fields
```

Only **one** insurance record per asset (queried `FirstOrDefault`).

### 3.12 `FixedAssetContractModel` (`INV_AssetContractFileInfo`)

```
AssetContractId       PK
FixedAssetStockId     FK
ContractFileName      string  (path-safe name, e.g. "12345_Contract_2024-01-15.pdf")
FileExtention         string
Audit fields
FileBinaryData        byte[]  (NotMapped; populated on read by reading the file from disk)
```

The actual file is stored on the web server's file system under the path configured in `Core cfg_parameters`:

```
ParameterGroupName = 'inventory'
ParameterName      = 'AssetContractFileUploadLocation'
```

The full path is `_environment.WebRootPath + ParameterValue + ContractFileName`. There is no size cap server-side; the frontend rejects files > 10 MB in `ValidateFileSize`.

### 3.13 `FixedAssetDispatchModel` / `FixedAssetDispatchItemsModel`

Used by the substore dispatch flow (`WardSupplyAssetsBL.DirectDispatch`).

`FixedAssetDispatchModel` (`INV_TXN_FixedAssetDispatch`):
- `DispatchId` PK
- `RequisitionId` (nullable; the requisition that drove this dispatch, if any)
- `StoreId` (the issuing store)
- `SubStoreId` (the receiving sub-store)
- `SubTotal`, `Remark`, `CreatedBy`, `CreatedOn`, `ReceivedBy`
- NotMapped `DispatchItems` (the child collection)

`FixedAssetDispatchItemsModel` (`INV_TXN_FixedAssetDispatchItems`):
- `DispatchItemId` PK
- `DispatchId` FK
- `RequisitionId`, `RequisitionItemId`
- `ItemId`, `ItemName`, `BatchNo`, `ExpiryDate`, `BarCodeNumber`
- `MRP`, `Price`, `SubTotal`, `Remark`
- `CreatedBy`, `CreatedOn`
- NotMapped `RequestedQuantity / ReceivedQuantity / PendingQuantity / CancelgQuantity / DispatchedQuantity` (transient UX fields)
- **`FixedAssetStockId`** — the actual physical asset that was moved

### 3.14 Join tables

- `INV_MAP_DispatchItems_FixedAssetStock` (composite key `DispatchItemsId + FixedAssetStockId`) — links a regular inventory dispatch to specific physical assets.
- `WARD_TXN_ReturnItems_FixedAssetStock` (composite key `ReturnItemId + FixedAssetStockId`) — links a ward-supply return to specific physical assets.

### 3.15 Cfg parameter

The contract upload location is read from `cfg_parameters` (group `inventory`, name `AssetContractFileUploadLocation`). See `Controllers/FixedAsset/AssetMaintenanceController.cs:457-461, 522-525, 608-611`.

---

## 4. Database Tables

Tables below come from `InventoryDbContext.OnModelCreating` in `Components/DanpheEMR.DalLayer/InventoryDbContext.cs` (lines 41-86) and `WardSupplyDbContext` (lines 51-97).

### Inventory-side (`InventoryDbContext`)

| Table | Mapping | Purpose |
|---|---|---|
| `INV_TXN_FixedAssetStock` | `FixedAssetStockModel` | The asset register |
| `INV_AssetLocationHistory` | `AssetLocationHistoryModel` | Move history |
| `INV_AssetContractFileInfo` | `FixedAssetContractModel` | Contract metadata |
| `INV_AssetConditionCheckList` | `FixedAssetConditionCheckListModel` | Environmental checklist rows |
| `INV_AssetFaultHistory` | `FixedAssetFaultHistoryModel` | Fault log |
| `INV_AssetInsurance` | `FixedAssetInsuranceModel` | Insurance policy |
| `INV_MST_AssetLocation` | `FixedAssetLocationsModel` | Location master |
| `INV_TXN_AssetDepreciation` | `FixedAssetDepreciationModel` | Depreciation entries |
| `INV_MST_AssetCategory` | `FixedAssetCategoryModel` | Asset category master |
| `INV_MST_AssetDepreciationMethod` | `FixedAssetDepreciationMethodModel` | Depreciation method master |
| `INV_MST_Donation` | `FixedAssetDonationModel` | Donation source |
| `INV_AssetServiceHistory` | `FixedAssetServiceModel` | Service log |
| `INV_MAP_DispatchItems_FixedAssetStock` | `MAP_DispatchItems_FixedAssetStock` (composite key) | Map regular dispatch items to specific assets |

### Ward-Supply-side (`WardSupplyDbContext`)

| Table | Mapping | Purpose |
|---|---|---|
| `INV_TXN_FixedAssetStock` | `FixedAssetStockModel` (shared) | Same asset register, accessed from ward-supply dispatch flow |
| `INV_MST_Donation` | `FixedAssetDonationModel` (shared) | |
| `INV_TXN_FixedAssetRequisition` | `WARDSupplyAssetRequisitionModel` | Header of a substore asset requisition |
| `INV_TXN_FixedAssetRequisitionItems` | `WARDSupplyAssetRequisitionItemsModel` | Line items |
| `INV_TXN_FixedAssetReturn` | `WARDSupplyAssetReturnModel` | Return header |
| `INV_TXN_FixedAssetReturnItems` | `WARDSupplyAssetReturnItemsModel` | Return lines |
| `INV_TXN_FixedAssetDispatch` | `FixedAssetDispatchModel` | Asset dispatch header |
| `INV_TXN_FixedAssetDispatchItems` | `FixedAssetDispatchItemsModel` | Asset dispatch lines (each carries `FixedAssetStockId`) |
| `WARD_TXN_ReturnItems_FixedAssetStock` | `MAP_ReturnItems_FixedAssetStock` (composite key) | Map return items to specific assets |

### Cross-module supporting tables (referenced but not owned by this module)

- `INV_MST_Item` — items with `ItemType='Capital Goods'` and `IsFixedAssets=1` are eligible; also carries `MaintenanceOwnerRoleId`.
- `INV_TXN_GoodsReceiptItems`, `INV_TXN_GoodsReceipt` — the GR that creates an asset.
- `INV_MST_Vendor` — the supplier / service vendor.
- `MST_Employee` — asset holder, created-by user, fault-history user, etc.
- `INV_MST_Store` / `StoreMaster` — the owning store; sub-stores are `StoreMaster` rows with `Category='substore'`.
- `INV_CFG_FiscalYear` — drives depreciation per fiscal year.
- `RBAC_UserRoleMap` + `RBAC_Role` — used to compute `IsCurrentUserMaintenanceOwner` per asset (joins to `Item.MaintenanceOwnerRoleId`).
- `INV_MAP_DispatchItems_FixedAssetStock` / `WARD_TXN_ReturnItems_FixedAssetStock` (composite-key join tables).
- `TXN_CssdItemTransactions` — created by `WardSupplyAssetsBL.SendAssetToCssd`.

### Cross-module tables / SPs (reporting)

- `SP_Report_Inventory_FixedAssets` — backs the `FixedAssetsReport` controller (date range, list of items with Qty/MRP/Amount).
- `SP_Report_Inventory_FixedAssetsMovement` — backs the `FixedAssetsMovementReport` (date range + employee + department + item + ref-number).

Both are invoked from `InventoryReportingDbContext.FixedAssetsReport` and `.FixedAssetsMovementReport` (lines 231, 245).

---

## 5. Key Workflows

### 5.1 Asset Register (List / Edit / Barcode)

Route: `/FixedAssets/AssetsManagement`. Component: `assets-management/assets-list.component.ts`.

- Loads `GET /api/AssetManagement/{StoreId}` (`GetAssetStockList`) which returns all active `INV_TXN_FixedAssetStock` rows for the active store **where** `IsActive = true` AND `(IsMaintenanceRequired = false OR IsAssetDamaged = true)`. The query joins GR, item, vendor, substore, donation, asset holder, and computes `IsCurrentUserMaintenanceOwner` per row.
- Filter modes (`OnAssetStatusChange`): `all`, `damaged`, `warrantyExpired`, plus optional substore / cold-storage / `showOnlyAssetsMaintainedByUser` filters.
- Grid actions: `edit` (open `AssetEditComponent`), `confirm-damage` (one-click confirm via `PutAssetDamageConfirmation`), `undo-damage` (opens `NotifyDamagedComponent`), `print-barcode` (renders barcode printable), `insurance-view` (opens `AssetInsuranceComponent`), `send-to-maintenance` / `remove-from-maintenance` (via `PutAssetRequiredMaintenance`).

### 5.2 Asset Edit (location, holder, store, substore)

Component: `assets-management/asset-edit/asset-edit.component.ts`. Calls `PUT /api/AssetManagement/UpdateAssetManagementList` (`UpdateAssetManagementList`).

The handler does the following inside one DB transaction:

1. Updates `INV_TXN_FixedAssetStock` — but only the user-meaningful columns (`AssetsLocation`, `WarrantyExpiryDate`, `SerialNo`, `ModelNo`, `BuildingBlockNumber`, `Floors`, `RoomNumber`, `RoomPosition`, `AssetHolderId`, `StoreId`, `AssetCode`). Pricing/GR/audit fields are explicitly locked (`IsModified = false`).
2. Closes the previous open `INV_AssetLocationHistory` row by setting its `EndDate = DateTime.Now`.
3. Inserts a new `AssetLocationHistoryModel` row with the *old* values (`OldLocation`, `OldStoreId`, `OldAssetHolderId`) and a fresh `StartDate`.

This produces an auditable chain: every edit leaves a paired close-then-open movement row.

### 5.3 Damage Notification + Confirmation

Two-step pattern:

1. **Notify Damage** — `assets-management/notify-damage/notify-damage.component.ts` calls `PUT /api/AssetMaintenance/UpdateAssetDamageStatus`. Only `IsAssetDamaged`, `DamagedRemarks`, `UndamagedRemarks`, `ModifiedBy`, `ModifiedOn` are touched.
2. **Confirm Damage** — from the list, `confirm-damage` action sets `IsAssetDamageConfirmed = true` and calls `PUT /api/AssetManagement/PutAssetDamageConfirmation`. The handler locks every other column and only flips the confirmation flag plus audit columns.

Once `IsAssetDamaged = true` the asset is filtered out of the default management list (the management list query includes `IsAssetDamaged = true OR IsMaintenanceRequired = false`).

### 5.4 Maintenance Flow

Route: `/FixedAssets/AssetsMaintenance`. Component: `assets-maintenance/assets-maintenance-list.component.ts`.

- Loads `GET /api/AssetMaintenance/{StoreId}` (`GetAll`) — joins GR/item/vendor/company + the most recent `INV_AssetServiceHistory` row. Filters: `IsMaintenanceRequired = true AND IsActive = true`.
- Three filter modes (tabs):
  - **All** — every asset on the maintenance register.
  - **Under Maintenance** — only those with `IsUnderMaintenance = true`.
  - **Faulty** — `Performance = 'Not Working'`.
  - **Service Due** — `FilterAssetByService()` recomputes the upcoming service date from the asset's `PeriodicServiceDays` and either the last `ServiceDate` or the `InstallationDate`; assets whose next service is within 31 days appear.
- Toggle "show only assets maintained by current user" filters to rows where `IsCurrentUserMaintenanceOwner = true` (derived from `Item.MaintenanceOwnerRoleId` vs the current user's role-map).

**Send-to-maintenance** from the management page calls `PUT /api/AssetMaintenance/PutAssetRequiredMaintenance` (`PutAssetRequiredMaintenance`). Server-side rule:

```
if (assetDetails.IsMaintenanceRequired == true)  assetDetails.Performance = "Not Working";
else                                              assetDetails.Performance = "Working";
```

Only `IsMaintenanceRequired`, `Performance`, and audit columns are written.

**Maintenance edit** updates the maintenance-oriented fields (`TotalLife`, `YearOfUse`, `ManufactureDate`, `Performance`, `IsActive`, `IsMaintenanceRequired`) and also updates the linked vendor's contact details via `UpdateAssetMaintenanceList`.

**Mark as repaired / under repair** — `PutRepairStatus`. When `IsUnderMaintenance = false` the server also resets `IsMaintenanceRequired = false` and `Performance = 'Working'`.

### 5.5 Fault Reporting

Component: `assets-maintenance/fault-update/asset-fault-update.componet.ts`. Two paths share the same `INV_AssetFaultHistory` rows:

1. **Confirm (add new fault)** — `POST /api/AssetMaintenance/AssetFaultConfirm`. Inserts a new fault row with `IsFaultResolved = false`.
2. **Resolve** — `PUT /api/AssetMaintenance/PutAssetFaultResolvedDetails`. Flips `IsFaultResolved = true`, sets `FaultResolvedDate` and `FaultResolvedRemarks`.
3. **Edit** — `PUT /api/AssetMaintenance/AssetFaultUpdate`. Updates the description; locks the `FixedAssetStockId` and `CreatedBy`.

`GET /api/AssetMaintenance/getfaulthistory/{fixedAssetStockId}` returns the full ordered list (latest-first; actually returned in DB order, frontend sorts by `CreatedOn`).

### 5.6 Periodic Service

Component: `assets-maintenance/periodic-service/asset-service.componet.ts`.

- `GET /api/AssetMaintenance/GetAssetServiceHistory/{fixedAssetStockId}` — full history ordered by `CreatedOn DESC`.
- `POST /api/AssetMaintenance/PostAssetServiceDetails` — new service row (`ServiceDate`, `ServiceRemarks`; `ServiceCompleteDate`/`ServiceCompleteRemarks` are not required at start).
- `PUT /api/AssetMaintenance/PutAssetServiceDetails` — updates both start and complete fields.

`PeriodicServiceDays` (set in `FixedAssetStock`) drives the "Service Due" tab.

### 5.7 Environmental Condition Checklist

Component: `assets-maintenance/environment-condition-checklist/asset-condition-check-list.componet.ts`.

- Renders six boolean questions (see §3.10).
- `POST /api/AssetMaintenance/AssetCheckList` accepts a `List<FixedAssetConditionCheckListModel>` and inserts one row per `AssetConditionId`.
- `GET /api/AssetMaintenance/AssestConditionChecklist/{fixedAssetStockId}` returns the most-recent six rows (one per condition), ordered by `CreatedOn DESC` and `Take(6)`.

### 5.8 Insurance

Component: `assets-management/insurance-add-edit/asset-insurance.componet.ts`.

- `GET /api/AssetManagement/GetAssetInsurance/{fixedAssetStockId}` returns the single insurance record (or `null`).
- `POST /api/AssetManagement/PostAssetInsurance` and `PUT /api/AssetManagement/PutAssetInsurance` create or update. The PUT explicitly locks `AssetInsurannceId` and `FixedAssetStockId` from being changed.

### 5.9 Vendor Contract File Upload / View / Download

Component: `assets-management/contract-upload/asset-contract-upload.component.ts`.

- Upload path: `POST /api/AssetMaintenance/PostAssetContractFile` with multipart form data (`uploads` file + `fileDetails` JSON). Server-side (`PostAssetContractFile`):
  1. Inserts `INV_AssetContractFileInfo` row.
  2. Resolves the upload folder from `cfg_parameters` (`inventory/AssetContractFileUploadLocation`); creates the directory if missing.
  3. Writes the file bytes to `WebRootPath + folder + ContractFileName`.
  - All inside one transaction.
- Update: `PUT /api/AssetMaintenance/PutAssetContractFile` — same flow but updates the row (locks `AssetContractId` and `FixedAssetStockId`).
- Read / download: `GET /api/AssetMaintenance/GetAssetContractFile/{FixedAssetStockId}`. Returns the model with `FileBinaryData` populated by reading the file from disk into a `byte[]` (`NotMapped`).

The frontend `ValidateFileSize` rejects files > 10 MB.

### 5.10 Depreciation

Route: `/FixedAssets/DepreciationAndDiscarding`. Component: `assets-depreciation-discarding/asset-depreciation-list.component.ts`.

- List: `GET /api/AssetDepreciationDiscarding/{StoreId}` returns the active assets for the store (no depreciation data inline).
- Per-asset history: `GET /api/AssetDepreciationDiscarding/depreciationDetailsById/{fixedAssetStockId}` returns the per-fiscal-year depreciation rows joined to method name and fiscal year name.
- Methods dropdown: `GET /api/AssetDepreciationDiscarding/GetAssetDepreciationMethods` (active methods only).
- Add: `POST /api/AssetDepreciationDiscarding/PostAssetDepreciation`.
- Edit: `PUT /api/AssetDepreciationDiscarding/PutAssetDepreciation`.

Frontend guard in `asset-depreciation.componet.ts`: if `isCurrentYearDeprenRecorded` is true, the "Add Depreciation" action is suppressed for the active fiscal year (`currentFiscalYearId = last item of allFiscalYearList`). This enforces the "one row per asset per fiscal year" invariant in the UI.

There is no batch-depreciation endpoint and no auto-calculation of `DepreciationAmount` server-side. The amount is entered manually with a `Rate` (percent). The controller is purely a CRUD pass-through.

### 5.11 Scrap / Discard

Component: `assets-depreciation-discarding/scraping/asset-scrap.component.ts`.

- `PUT /api/AssetDepreciationDiscarding/UpdateAssetScrapDetails` (`UpdateAssetScrapDetails`). Only `ScrapAmount`, `ScrapRemarks`, `ScrapCancelRemarks`, `IsAssetScraped` are written; everything else is locked.
- The same endpoint supports both scrap **and** un-scrap: if the asset was already scraped, the form sets `IsAssetScraped = false` and copies the previous `ScrapRemarks` into `ScrapCancelRemarks` for audit.

No GL / accounting write is performed here. Scrap is recorded only as a flag on the asset.

### 5.12 Substore Requisition / Dispatch of Assets

Frontend: `assets-substore-requisition-dispatch/`.

This is a *lightweight* sub-store flow for fixed assets, separate from the inventory substore module. Endpoints (all under `/api/WardSupplyAssets/`):

| Endpoint | Purpose |
|---|---|
| `GET /GetSubstoreAssetRequistionList/{fromDate}/{toDate}/{subStoreId}` | Requisition header list for a substore |
| `GET /GetSubstoreAssetRequistionListByStoreId/{fromDate}/{toDate}/{storeId}` | Same but filtered by issuing store |
| `GET /GetSubstoreAssetRequistionItemsById/{requisitionId}` | Line items for a requisition |
| `GET /GetFixedAssetStockByStoreId/{storeId}` | The physical assets available in the main store (`SubStoreId IS NULL`) |
| `GET /GetRequisitionDetailsForDispatch/{requisitionId}` | Requisition with full stock context for dispatching |
| `POST /PostStoreDispatch` | Create a dispatch (with optional requisition) |
| `POST /PostDirectDispatch` | Direct dispatch — calls `WardSupplyAssetsBL.DirectDispatch` which internally creates a synthetic "complete" requisition then a dispatch (see `WardSupplyAssetsBL.cs:45-67`) |
| `GET /dispatchview/{requisitionId}` | View existing dispatches for a requisition |
| `GET /dispatchviewbyDispatchId/{dispatchId}` | View a single dispatch by its id |
| `GET /GetFixedAssetDispatchListForItemReceive/{requisitionId}` | Substore view to receive the dispatched assets |

`WardSupplyAssetsBL.DispatchItemsTransaction` (lines 141-190) writes the `INV_TXN_FixedAssetDispatch` header + lines, **and** attaches each physical asset (`FixedAssetStock`) setting its `SubStoreId` to the receiving sub-store.

### 5.13 Send Asset to CSSD (sterilization)

Endpoint: `~/api/WardSupplyAssets/...` calls `WardSupplyAssetsBL.SendAssetToCssd(FixedAssetStockId, ...)` (`WardSupplyAssetsBL.cs:20-44`).

- Sets `FixedAssetStock.CssdStatus = "pending"`.
- Inserts a `CssdItemTransactionModel` row with `FixedAssetStockId`, `ItemId`, `StoreId = SubStoreId ?? StoreId`, `CssdStatus = "pending"`.

This is the only place where the asset register and the CSSD table meet.

### 5.14 Reports

- `FixedAssetsReport` — `SP_Report_Inventory_FixedAssets` — date-range list of asset purchases / openings (ItemName, Name holder, Qty, MRP, TotalAmt, UOMName, Code).
- `FixedAssetsMovementReport` — `SP_Report_Inventory_FixedAssetsMovement` — date-range + filters (Employee, Department, Item, ReferenceNumber). Returns movement rows (date, barcode, item, store, qty, amount, item rate, UOM, code, asset holder, specification).

Both are exposed by `Controllers/Inventory/InventoryReportsController.cs` and consumed by `FixedAssetsMovementComponent` (route `Reports/FixedAssetsMovement`). The report-filter dropdowns (employees, departments, capital-goods items) are served by `AssetReportsController` (see §6).

---

## 6. API Endpoints

All endpoints return `DanpheHTTPResponse<object>` with `{ Status: 'OK' | 'Failed', Results, ErrorMessage }`. Auth is session-based (RbacUser via `HttpContext.Session`); the asset module is mounted behind the standard auth + inventory-activation guards.

### 6.1 Asset Management — `/api/AssetManagement/...`

| Method | Route | Source | Description |
|---|---|---|---|
| GET | `/{storeId}` | `GetAssetStockList` | Active asset register for a store, with vendor / donation / holder / maintenance-owner joined. Excludes assets that are `IsMaintenanceRequired = true` AND `IsAssetDamaged = false`. |
| GET | `/GetAssetInsurance/{fixedAssetStockId}` | `GetAssetsInsurance` | Single insurance record (or `null`) |
| POST | `/PostAssetInsurance` | `PostAssetInsurance` | Create insurance policy |
| PUT | `/PutAssetInsurance` | `PutAssetInsurance` | Update insurance policy (locks id + `FixedAssetStockId`) |
| PUT | `/PutAssetDamageConfirmation` | `PutAssetDamageConfirmation` | One-click confirm damage — flips `IsAssetDamageConfirmed` only |
| PUT | `/UpdateAssetManagementList` | `UpdateAssetManagementList` | Edit location / holder / store / asset code + write `AssetLocationHistory` rows |
| GET | `/GetAllInventoryFiscalYears` | `GetAllInventoryFiscalYears` | All inventory fiscal years (used by depreciation page) |

### 6.2 Asset Maintenance — `/api/AssetMaintenance/...`

| Method | Route | Source | Description |
|---|---|---|---|
| GET | `/{storeId}` | `GetAll` | Maintenance register for a store (joins last service row) |
| GET | `/Vendor/{id}` | `GetVendorDetailsById` | Vendor contact details for the maintenance-edit form |
| GET | `/getfaulthistory/{fixedAssetStockId}` | `GetFaultHistory` | Full fault history (joins employee name) |
| GET | `/GetAssetServiceHistory/{fixedAssetStockId}` | `GetAssetServiceHistory` | Service history (latest first) |
| POST | `/PostAssetServiceDetails` | `PostAssetServiceDetails` | Add service entry |
| PUT | `/PutAssetRequiredMaintenance` | `PutAssetRequiredMaintenance` | Toggle `IsMaintenanceRequired` + flip `Performance` to "Working"/"Not Working" |
| PUT | `/PutAssetFaultResolvedDetails` | `PutAssetFaultResolvedDetails` | Mark fault resolved |
| PUT | `/PutRepairStatus` | `PutRepairStatus` | Toggle `IsUnderMaintenance`; resets `IsMaintenanceRequired` and `Performance` when repaired |
| PUT | `/PutAssetServiceDetails` | `PutAssetServiceDetails` | Edit service entry |
| GET | `/GetAssetContractFile/{FixedAssetStockId}` | `GetAssetContractFile` | Read contract metadata + binary |
| POST | `/PostAssetContractFile` | `PostAssetContractFile` | Multipart: upload contract file (creates row + writes to disk) |
| PUT | `/PutAssetContractFile` | `PutAssetContractFile` | Multipart: re-upload contract file |
| PUT | `/UpdateAssetDamageStatus` | `UpdateAssetDamageStatus` | Mark / unmark damaged, with `DamagedRemarks` / `UndamagedRemarks` |
| PUT | `/AssetFaultUpdate` | `AssetFaultUpdate` | Edit existing fault description |
| POST | `/AssetCheckList` | `AssetCheckList` | Save a list of condition-checklist rows (one per condition) |
| POST | `/AssetFaultConfirm` | `AssetFaultConfirm` | Add a new fault row |
| PUT | `/UpdateAssetMaintenanceList` | `UpdateAssetMaintenanceList` | Save maintenance edit + update vendor contact |
| GET | `/AssestConditionChecklist/{fixedAssetStockId}` | `AssestConditionChecklist` | Most-recent six condition rows |
| GET | `/GetFixedAssetLocations` | `GetFixedAssetLocations` | List of allowed `INV_MST_AssetLocation` |

### 6.3 Asset Depreciation & Discarding — `/api/AssetDepreciationDiscarding/...`

| Method | Route | Source | Description |
|---|---|---|---|
| GET | `/{storeId}` | `GetAssetsDepreciationList` | Asset list for the depreciation / scrap page |
| GET | `/depreciationDetailsById/{fixedAssetStockId}` | `GetAssetDepreciationDetails` | Per-fiscal-year depreciation rows (joined to method + fiscal year) |
| GET | `/GetAssetDepreciationMethods` | `GetAssetDepreciationMethods` | Active depreciation methods |
| POST | `/PostAssetDepreciation` | `PostAssetDepreciationDetails` | Add depreciation entry |
| PUT | `/PutAssetDepreciation` | `PutAssetDepreciation` | Edit depreciation entry |
| PUT | `/UpdateAssetScrapDetails` | `UpdateAssetScrapDetails` | Set or cancel `IsAssetScraped` + scrap fields |

### 6.4 Asset Reports — `/api/AssetReports/...`

| Method | Route | Source | Description |
|---|---|---|---|
| GET | `/GetAllEmployeeList` | `GetAllEmployeeList` | Distinct employees who have ever held an asset (joined to `AssetLocationHistory`) |
| GET | `/GetAllDepartments` | `GetAllDepartments` | Substore list (`StoreMaster` where `Category='substore'`) |
| GET | `/GetAllItems` | `GetAllItems` | Capital-goods items (`ItemType='Capital Goods'`) |

### 6.5 Ward-Supply-Assets endpoints that move fixed assets — `/api/WardSupplyAssets/...`

| Method | Route | Source | Description |
|---|---|---|---|
| GET | `/GetSubstoreAssetRequistionList/{fromDate}/{toDate}/{subStoreId}` | `GetSubstoreAssetRequistionList` | Requisitions for a substore |
| GET | `/GetSubstoreAssetRequistionListByStoreId/{fromDate}/{toDate}/{storeId}` | `GetSubstoreAssetRequistionListByStoreId` | Requisitions from a store |
| GET | `/GetSubstoreAssetRequistionItemsById/{requisitionId}` | `GetSubstoreAssetRequistionItemsById` | Requisition lines |
| GET | `/GetFixedAssetStockByStoreId/{storeId}` | `GetFixedAssetStockByStoreId` | Physical assets available in main store (`SubStoreId IS NULL`) |
| GET | `/dispatchview/{requisitionId}` | `dispatchview` | Existing dispatches for a requisition |
| GET | `/dispatchviewbyDispatchId/{dispatchId}` | `dispatchviewbyDispatchId` | Single dispatch |
| GET | `/GetRequisitionDetailsForDispatch/{requisitionId}` | `GetRequisitionDetailsForDispatch` | Requisition + stock context for dispatching |
| POST | `/PostStoreDispatch` | `PostStoreDispatch` | Save dispatch (with optional requisition) |
| POST | `/PostDirectDispatch` | `PostDirectDispatch` | Direct dispatch (synthesises a "complete" requisition then dispatches) |
| GET | `~/api/WardSupply/GetFixedAssetDispatchListForItemReceive/{requisitionId}` | `GetFixedAssetDispatchListForItemReceive` | Substore receive view |
| (action) | Send asset to CSSD | (calls `WardSupplyAssetsBL.SendAssetToCssd`) | Set `CssdStatus='pending'` and insert `CssdItemTransaction` row |

### 6.6 Inventory Reports — `/InventoryReports/...`

| Method | Route | Source | Description |
|---|---|---|---|
| GET | `/FixedAssetsReport?FromDate=&ToDate=` | `FixedAssetsReport` | List of fixed-asset purchases/openings (calls `SP_Report_Inventory_FixedAssets`) |
| GET | `/FixedAssetsMovementReport?FromDate=&ToDate=&EmployeeId=&DepartmentId=&ItemId=&ReferenceNumber=` | `FixedAssetsMovementReport` | Filtered movement log (calls `SP_Report_Inventory_FixedAssetsMovement`) |

### 6.7 Frontend service → backend map (selected)

Source: `fixed-asset.dl.service.ts`.

```
managementBaseUrl       = '/api/AssetManagement'
maintenanceBaseUrl      = '/api/AssetMaintenance'
reportBaseUrl           = '/api/AssetReports'
deprnDiscardingBaseUrl  = '/api/AssetDepreciationDiscarding'
+ '/api/WardSupplyAssets/...' for substore dispatch
+ '/InventoryReports/...' for movement / report SPs
```

---

## 7. Cross-Module Integration

### 7.1 Inventory

- **Goods Receipt** is the entry point. Each line of a GR for a `Capital Goods` item eventually creates one `INV_TXN_FixedAssetStock` row (the GR item id is stored on the asset as `GoodsReceiptItemId`).
- **Item master** — `ItemType = 'Capital Goods'` and `IsFixedAssets = 1` are the gating flags. `Item.MaintenanceOwnerRoleId` is what the maintenance page uses to compute `IsCurrentUserMaintenanceOwner`.
- **Vendor master** — `INV_MST_Vendor` rows are joined to every asset in the list / maintenance / fault / service views. The maintenance-edit endpoint also writes back to vendor contact details (`CompanyPosition`, `Name`, `PhoneNumber`, and the second contact triplet).
- **Substore / store** — `StoreMaster` rows (especially `Category='substore'`) are the dispatch target. `StoreId` / `SubStoreId` on the asset drive the current owner.
- **Donations** — `INV_MST_Donation` is referenced by `DonationId` (used by Tilganga hospital per the source comment).
- **Inventory fiscal year** — `INV_CFG_FiscalYear` powers the depreciation page (`GetAllInventoryFiscalYears`).

### 7.2 Accounting

DanpheEMR's fixed-asset module does **not** post to the accounting layer automatically. There is no call to any of the accounting transaction tables, no voucher creation, and no GL mapping for either depreciation or scrap.

- Depreciation is recorded only as `INV_TXN_AssetDepreciation` rows. The `DepreciationAmount` and `Rate` are user-entered; no straight-line / WDV math runs server-side.
- Scrap is a flag on `INV_TXN_FixedAssetStock` (`IsAssetScraped`) plus free-text remarks. No inventory write-off, no expense entry, no disposal voucher.
- Insurance is metadata only.
- Contract file is metadata + binary on disk; no link to vendor ledger.

Implication for a Cloudflare-D1 migration: the module is self-contained on the inventory schema side. If accounting integration is required in the new system, it must be added explicitly (e.g. a post-depreciation hook that emits a voucher event into the accounting outbox).

### 7.3 CSSD (CSSD / Sterilization)

`WardSupplyAssetsBL.SendAssetToCssd` is the only bridge: it sets `FixedAssetStock.CssdStatus='pending'` and creates a `CssdItemTransactionModel` row. There is no reverse flow in this module — the asset is not "marked sterilized" here.

### 7.4 Ward Supply (substore requisition / dispatch / return)

Lightweight substore flow that reuses the same `INV_TXN_FixedAssetStock` rows. See §5.12 and §5.13.

### 7.5 Inventory Reporting

Stored-procedure-backed reports: `SP_Report_Inventory_FixedAssets` and `SP_Report_Inventory_FixedAssetsMovement`. They live in the SQL database; the DAL just wraps `Database.SqlQuery<...>`.

### 7.6 Settings (RBAC / employees / stores)

- `GetEmployeeList`, `GetStoreList` (from `SettingsBLService`) are used in the asset-edit form to populate the asset-holder and substore autocomplete lists.
- `Item.MaintenanceOwnerRoleId` + `UserRoleMap` is used to compute `IsCurrentUserMaintenanceOwner` per row in the management and maintenance list queries.

---

## 8. Business Rules

1. **One asset = one `INV_TXN_FixedAssetStock` row.** Serialised. Carries its own `BarCodeNumber`, `SerialNo`, `ModelNo`, `AssetCode`.
2. **An asset can only exist if the source item is `IsFixedAssets = 1`.** The GR → AssetStock path is the only way to create an asset (the controllers do not expose a free-form "create asset" endpoint).
3. **Active-management list query** (`GetAssetStockList`) deliberately hides assets that are "in maintenance and not damaged" — the formula is:
   ```
   IsActive = true
   AND (IsMaintenanceRequired = false OR IsAssetDamaged = true)
   AND StoreId = activeStore
   ```
   The maintenance list (`GetAll`) is the symmetric view (`IsMaintenanceRequired = true`).
4. **Send-to-maintenance flips `Performance` automatically.** `PutAssetRequiredMaintenance` sets `Performance = "Not Working"` when entering maintenance and `Performance = "Working"` when leaving. The frontend does not edit `Performance` directly.
5. **Repair also clears `IsMaintenanceRequired`.** `PutRepairStatus` with `IsUnderMaintenance = false` resets `IsMaintenanceRequired = false` and `Performance = "Working"`.
6. **Two-step damage workflow.** `IsAssetDamaged` is set by the maintenance page (`UpdateAssetDamageStatus`), and the management page requires a separate `PutAssetDamageConfirmation` to flip `IsAssetDamageConfirmed`. This separation allows a different role to authorise the confirmation.
7. **Location/holder change is a two-row ledger write.** Every edit closes the prior `INV_AssetLocationHistory` row and inserts a new one with the *old* values. `StartDate` is `now`, `EndDate` is null for the latest row.
8. **One depreciation row per asset per fiscal year.** The frontend (`AssetDepreciationComponent`) computes `currentFiscalYearId = last item of allFiscalYearList` and disables "Add" once the current-year entry exists. The server does not enforce uniqueness — it relies on the UI.
9. **Depreciation is a free-form entry.** No `Rate × AssetRate` math; the user enters both `Rate` and `DepreciationAmount` manually. `Rate` is an `int?` (e.g. 20 for 20% per year).
10. **Scrap is reversible.** The same `UpdateAssetScrapDetails` endpoint flips `IsAssetScraped` either way; the `ScrapCancelRemarks` field records the cancellation reason, copied from `ScrapRemarks` for audit.
11. **No accounting impact** for depreciation or scrap. (See §7.2.)
12. **Contract files live on the web server's disk** under `WebRootPath + cfg(inventory/AssetContractFileUploadLocation)`. The DB only stores the file name + extension. The frontend rejects uploads > 10 MB.
13. **Insurance is one-per-asset.** `GetAssetInsurance` is a `FirstOrDefault`; the POST creates the first, the PUT updates it (both lock `AssetInsurannceId` + `FixedAssetStockId`).
14. **Condition checklist is six rows per save.** The hard-coded list (`assetCheckList` in `asset-condition-check-list.componet.ts`) is six boolean items; the `POST /AssetCheckList` accepts them as a list and inserts one row per `AssetConditionId`. Reading takes the six most-recent rows (`Take(6)` ordered by `CreatedOn DESC`).
15. **Maintenance-owner enforcement is at the list level.** `IsCurrentUserMaintenanceOwner` is computed as `UserRoleMap.RoleId == Item.MaintenanceOwnerRoleId && UserRoleMap.UserId == currentUserId`. The "show only my assets" toggle simply filters on this boolean client-side; the server does not block writes from non-owners.
16. **Substore dispatch flips `SubStoreId` on each physical asset.** `DispatchItemsTransaction` writes a `FixedAssetDispatchItems` row per asset (with `FixedAssetStockId`) and updates `FixedAssetStock.SubStoreId` to the receiving sub-store. There is no separate `SubStoreId` history table — only the `AssetLocationHistory` table captures it (and the dispatch controller does not write to it, only the asset-edit endpoint does).
17. **Direct dispatch synthesises a requisition.** `WardSupplyAssetsBL.DirectDispatch` calls `CreateRequisition(..., IsDirectDispatch=true, RequisitionStatus="complete", IsCancel=false)` then `DispatchItemsTransaction` — both wrapped in a single DB transaction.
18. **Return-to-store clears `SubStoreId`.** The `FixedAssetStockModel.Return()` helper sets `SubStoreId = null` after appending a movement row. The actual `/api/WardSupply/...` return endpoints live in the ward-supply module (out of scope for the fixed-asset module, but the model method is in this module).
19. **All write endpoints are column-locked via EF `IsModified = false`.** Every PUT explicitly prevents a subset of fields from being changed (audit fields, pricing, GR linkage, store when in maintenance, etc.). This is the controller's defence against accidental client-side over-posting.
20. **All write endpoints run inside `BeginTransaction` / `Commit` (or `Rollback`)**. Multi-table operations (insurance + audit, contract upload + filesystem write, location history + stock update, dispatch header + lines + asset update, send-to-cssd + asset update) are atomic.

---

## Appendix A — Frontend route map

From `fixed-assets-routing.module.ts`:

```
/FixedAssets                          -> FixedAssetsMainComponent (auth + inventory-activation guarded)
  ├─ ''  (default)                    -> redirect to AssetsManagement
  ├─ 'AssetsManagement'               -> AssetsManagementListComponent
  ├─ 'AssetsMaintenance'              -> AssetsMaintenaceListComponent
  ├─ 'DepreciationAndDiscarding'      -> AssetDepreciationListComponent
  ├─ 'AssetsSubstoreRequisition'      -> AssetSubstoreRequisitionDispatchComponent
  ├─ 'AssetsSubstoreDirectDispatch'   -> DirectDispatchComponent
  ├─ 'RequisitionDispatch'            -> FixedAssetReqDispatchComponent
  └─ 'Reports'                        -> loads FixedAssetsReportsModule (auth guarded)
        └─ FixedAssetsMovementComponent
```

## Appendix B — Service-layer file map

- `shared/fixed-asset.dl.service.ts` — HTTP layer. Base URLs:
  - `managementBaseUrl = '/api/AssetManagement'`
  - `maintenanceBaseUrl = '/api/AssetMaintenance'`
  - `reportBaseUrl = '/api/AssetReports'`
  - `deprnDiscardingBaseUrl = '/api/AssetDepreciationDiscarding'`
  - cross-cuts to `/api/WardSupplyAssets/...` for substore dispatch and to `/InventoryReports/...` for SP-backed reports.
- `shared/fixed-asset.bl.service.ts` — Business layer. Adds lodash `_.omit` for stripping validator FormGroups before POST/PUT (otherwise the cycle breaks the JSON serializer on the server).
- `shared/fixed-asset.service.ts` — In-memory shared state: `allFiscalYearList` (loaded once on app init by `FixedAssetsMainComponent`).

## Appendix C — Notable cross-module services

- `ActivateInventoryService.activeInventory.StoreId` — used by every list API to scope the result set.
- `SettingsBLService.GetEmployeeList` and `GetStoreList` — feed the asset-edit autocomplete.
- `ReportingService.reportGridCols.FixedAssetsMovementReport` — supplies the movement-report grid column definitions.
- `SecurityService.GetChildRoutes('FixedAssets')` — drives menu visibility in the parent module shell.

## Appendix D — Cross-cutting SQL artefacts

| Stored procedure | Purpose | Backend call |
|---|---|---|
| `SP_Report_Inventory_FixedAssets` | Date-range list of fixed-asset purchase rows (Qty, MRP, TotalAmt, UOM, Code) | `FixedAssetsReport` controller action |
| `SP_Report_Inventory_FixedAssetsMovement` | Filtered movement log (date + employee + department + item + ref) | `FixedAssetsMovementReport` controller action |
| `cfg_parameters` (group `inventory`, name `AssetContractFileUploadLocation`) | Folder for uploaded contract files | `PostAssetContractFile`, `PutAssetContractFile`, `GetAssetContractFile` |

# Module 47 — Ward Supply

> Reference documentation for the DanpheEMR Ward Supply module. Covers ward-level and sub-store stock management, in-patient consumption, internal consumption, stock movements (transfer, breakage, return-to-inventory, return-to-pharmacy), pharmacy sub-store requisitions, inventory-side requisitions/dispatch/receive, fixed-asset sub-store flows, and reconciliation. The single source of truth for understanding the module without re-reading the .NET source code.

---

## 1. Module Overview

The Ward Supply module is the **last-mile stock and consumption engine** of DanpheEMR. Where the Inventory module owns procurement, the central stores, and the master stock tables, Ward Supply owns everything that happens *inside* a ward, an in-patient bed, or a department-level sub-store.

Concretely, it manages:

- A sub-store (a department-level, ward-level, or pharmacy-side sub-store) that holds consumable stock issued by the main Inventory store or the main Pharmacy store.
- The lifecycle of items entering that sub-store (requisition, dispatch, receive, transfer) and leaving it (consumption, breakage, return-to-inventory, return-to-pharmacy, transfer to another sub-store).
- Two flavours of consumption: **patient consumption** (a billable line posted to the pharmacy invoice) and **internal consumption** (non-billable departmental usage).
- Reconciliation of physical vs. system stock via Excel import.
- Fixed-asset (capital-goods) sub-store flows: sub-store asset stock, asset requisition, asset dispatch, asset return, and CSSD hand-off.
- The reporting surface used by nurses, store-keepers, and accountants.

### Key design characteristics

- **Sub-store is the atomic unit** — every sub-store is a `PHRM_MST_Store` row with `Category = Substore` and an `IsActive` flag. Wards are mapped to sub-stores via `WardSubStoresMapModel` so a nurse on Ward-5A always knows which sub-store's stock to draw from.
- **Per-batch stock** — stock inside a sub-store is a `StoreStock` row (one per `ItemId + BatchNo + ExpiryDate`), and that row is a foreign key into the central `PHRM_MST_Stock` (or `INV_MST_Stock`) batch record. Expiry-aware queries are mandatory.
- **FIFO-by-expiry consumption** — both internal consumption (`PostInternalConsumption`) and patient consumption (`PostConsumption`) walk available sub-store stock in expiry order, draining the oldest batch first.
- **Verification-aware requisitions** — pharmacy sub-store requisitions support an optional `VerifierIds` list. If the list is non-empty, the requisition is created in `pending` status and waits for verification; otherwise it is `active` and goes straight to dispatch.
- **Two consumption accounting styles** — internal consumption writes a `PHRM_TXN_StockTransaction` row with `TransactionType = PHRMSubStoreConsumption`. Patient consumption additionally writes a `PHRM_TXN_InvoiceItems` line so the patient gets billed.
- **Inventory side, parallel to pharmacy** — the module also implements inventory-side sub-store flows (sub-store requisition against the inventory store, dispatch, receive-stock confirmation, return-to-inventory, transfer reports). Same DbContext, separate endpoints.
- **Fixed-Asset sub-store** — capital-goods items live in a parallel flow (`WardSupplyAssetsController`): per-unit barcode, sub-store requisition, dispatch (with per-unit barcodes), return, and CSSD hand-off for sterilizable equipment.
- **Stock reconciliation** — admins can export a sub-store's stock to a protected Excel, edit physical counts, and re-import. Differences are posted as `StockManageItem` transactions.

### Sub-modules (as folders under `wwwroot/DanpheApp/src/app/wardsupply/`)

| Sub-area | Frontend folder | Backend controller | Purpose |
|---|---|---|---|
| Pharmacy ward | `pharmacy-ward/`, `wardsupply-pharmacy-stock/`, `consumption/`, `internal-consumption*` | `WardSupplyController` (Pharmacy route group) | Stock view, requisition, consumption, internal consumption, pharmacy transfer, reports. |
| Inventory ward | `inventory-wardsupply/` | `WardSupplyController` (Inventory route group) | Sub-store stock, requisition list/item/details, dispatch receive, return, consumption, patient consumption, reports. |
| Fixed-Asset | `wardsupply-asset/` | `WardSupplyAssetsController` | Sub-store asset stock, asset requisition (list/details/new), requisition dispatch, return, CSSD send. |
| Common | `shared/` | n/a | Services, DTOs, models, grid column config. |

---

## 2. Backend File Layout

### 2.1 Controllers

All controllers live in `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/WardSupply/`.

| File | Lines | Purpose |
|---|---|---|
| `WardSupplyController.cs` | 2679 | The workhorse. Pharmacy ward endpoints (consumption, internal consumption, stock, transfer, reports) **and** inventory sub-store endpoints (sub-store requisition, dispatch receive, return-to-inventory, transfer, reports) **and** pharmacy sub-store requisition post. ~60 endpoints. |
| `WardSupplyAssetsController.cs` | 1025 | Fixed-asset sub-store flows. Per-unit barcode stock, asset requisition list/details/new, dispatch with sub-store barcode transfer, return-by-asset, CSSD hand-off (`SendStockToCssd`), direct dispatch. |
| `WardSupplyViewController.cs` | 74 | MVC view-server actions that render the legacy `.cshtml` views: `WardSupplyMain`, `Requisition`, `Stock`, `Consumption`, `ConsumptionList`. |
| `WardSupplyBL.cs` | 693 | Static business-logic helper. Houses `StockTransfer` (ward-to-ward), `StockInventoryTransfer` (inventory-ward → inventory-ward), `BackToInventoryTransfer`, `StockBreakage`, `StockTransferToPharmacy`, `UpdateWardStockForConsumption`, `ReceiveDispatchedStocks`, `UpdateReconciledStockFromExcel`, `PostPhrmSubStoreRequisition`, `GetVerifiers`. |
| `WardSupplyAssetsBL.cs` | 192 | Asset business-logic helper. Houses `SendAssetToCssd`, `DirectDispatch`, `CreateRequisition`, `DispatchItemsTransaction`. |
| `SubstoreBL.cs` | 447 | Sub-store / verifier RBAC helper. Houses `GetVerifiersByStoreId`, `CreateStore`, `CreatePermissionForStore`, `CreatePermissionForStoreVerifier`, `CreateRoleForStoreVerifier`, `CreateStoreVerificationMap`, `CreateAndMapVerifiersWithStore`, `ActivateDeactivateAllStorePermission`, `ActivateDeactivateStoreVerifierMap`, `ActivateDeactivateStore`, `UpdateStorePermissionName`, `UpdateStoreVerifierPermission`, `UpdateRoleForVerifiers`. |
| `WardSupplyInPatientListDTO.cs` | 0 (empty) | Marker file for the DTO type defined in `ViewModel/Substore/WardSupplyInPatientListDTO.cs`. |

### 2.2 DbContexts

Two contexts back the module:

| DbContext | File | Purpose |
|---|---|---|
| `WardSupplyDbContext` | `Code/Components/DanpheEMR.DalLayer/WardSupplyDbContext.cs` (178 lines) | The main ward-supply context. Owns ~55 `DbSet<>` properties spanning ward-supply models, inventory models, pharmacy models, ADT models, fixed-asset models, RBAC-relevant models, and the dispatch/receive tables. All decimal properties are forced to `Decimal(16, 4)`. |
| `WardReportingDbContext` | `Code/Components/DanpheEMR.DalLayer/WardReportingDbContext.cs` (223 lines) | Read-only reporting context. Exposes seven stored-proc wrappers: `WARDStockItemsReport`, `WARDRequisitionReport`, `WARDBreakageReport`, `WARDConsumptionReport`, `WARDInteranlConsumptionReport`, `WARDTransferReport`, `RequisitionDispatchReport`, `TransferReport`, `ConsumptionReport`. |

### 2.3 Frontend

`DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/wardsupply/`

- `wardsupply.module.ts` — top-level Angular module. Imports `WardSupplyRoutingModule`, `SharedModule`, `DanpheAutoCompleteModule`. Registers `WardSupplyBLService`, `WardSupplyDLService`, `Pharmacy*Service`, `Inventory*Service`, `wardsupplyService`, and a `HashLocationStrategy` provider. Declares 30+ components.
- `wardsupply-routing.module.ts` — declares lazy routes under `/WardSupply/Pharmacy`, `/WardSupply/Inventory`, `/WardSupply/FixedAsset`, each with their own child routes and `AuthGuardService`. Pharmacy subtree covers Requisition/Stock/Consumption/InternalConsumption/PharmacyTransfer/Reports. Inventory subtree covers Requisition list/item/details/Receive/Stock/Return/Consumption (list+add)/PatientConsumption (list+add)/Reports. FixedAsset subtree covers Requisition (list/view), Stock, RequisitionDispatch.
- `shared/` — `wardsupply.dl.service.ts` (HTTP data-layer service: ~40 API methods), `wardsupply.bl.service.ts` (business wrapper, orchestrates DL calls + state), `wardsupply.service.ts` (singleton state holder: `activeSubstoreId`, `inventoryList`, `ReturnId`, `isModificationAllowed`, `DepartmentName`, `RequisitionId`, `inventoryStockList`). Plus 25+ model files (ward-stock, ward-requisition, ward-consumption, ward-internal-consumption-items, ward-dispatch, ward-inventory-consumption, ward-inventory-return, phrm-substore-requisition, wardsupply-asset-requisition, wardsupply-asset-return, etc.) and `ward-grid-cloumns.ts` (centralized DanpheGrid column definitions).
- `pharmacy-ward/` — landing component for the pharmacy-side sub-store.
- `wardsupply-pharmacy-stock/`, `consumption/`, `consumption-list/`, `internal-consumption{,-list,-details}/`, `pharmacy-transfer/` — pharmacy-side flow components.
- `inventory-wardsupply/` — landing component for the inventory-side sub-store, with sub-folders:
  - `stock/` (stock list, stock reconciliation with Excel import).
  - `requisition/` (list, item, details, receive-stock).
  - `consumption/` (list, add).
  - `patient-consumption/` (list, add).
  - `return/` (return list, return form).
  - `reports/` (ward-inventory-reports landing, requisition-dispatch report, transfer report, consumption report).
- `wardsupply-asset/` — fixed-asset sub-store flows: landing, asset stock, asset requisition (list/details/new), asset req-dispatch.
- `phrm-substore-requisition-add/` — pharmacy sub-store requisition entry form.
- `reports/` — pharmacy-side reports: stock, requisition, dispatch, consumption, internal-consumption, breakage, transfer.
- HTML views in `Views/WardSupplyView/`: `WardSupplyMain.cshtml`, `Requisition.cshtml`, `Stock.cshtml`, `Consumption.cshtml`, `ConsumptionList.cshtml` (legacy Razor pages, still wired via `WardSupplyViewController`).

---

## 3. Data Models (Server-Side)

All ward-supply-specific models live in `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/WardSupplyModels/`. Reporting / view DTOs live in `Code/Websites/DanpheEMR/ViewModel/Substore/`. `[Key]` indicates the primary key; `[NotMapped]` indicates a client-only convenience property.

### 3.1 Stock & Transactions (legacy)

| Model | Key | Purpose | Notable fields |
|---|---|---|---|
| `WARDStockModel` | `StockId` | Per-batch per-store stock in the legacy `WARD_Stock` table. | `WardId` (nullable for non-ward stores), `StoreId`, `ItemId`, `AvailableQuantity`, `SalePrice`, `BatchNo`, `ExpiryDate`, `DepartmentId`, `StockType` (`"inventory"` or `null`/`"pharmacy"`), `Price`. NotMapped: `newWardId`, `DispachedQuantity`, `WardName`, `ItemName`, `Remarks`, `CostPrice`. |
| `WARDTransactionModel` | `TransactionId` | Audit ledger for every ward-level stock movement. | `WardId`, `StoreId`, `ItemId`, `Quantity`, `StockId` (FK), `TransactionType` (`"WardtoWard"`, `"Inventory-WardtoWard"`, `"BackToInventory"`, `"BreakageItem"`, `"WardConsumptionEdit"`), `Price`, `CreatedBy` (string UserName), `CreatedOn`, `Remarks`, `IsWard` (bool), `newWardId`, `ReceivedBy`, `InOut` (`"in"` / `"out"`). |
| `WARDDispatchModel` | `DispatchId` | Header of a ward-side dispatch against a requisition. | `RequisitionId?`, `StoreId`, `SubTotal`, `Remark`, `CreatedBy`, `CreatedOn?`, `ReceivedBy`. |
| `WARDDispatchItemsModel` | `DispatchItemId` | Line items in a ward dispatch. | `DispatchId`, `RequisitionItemId?`, `ItemId`, `ItemName`, `BatchNo`, `ExpiryDate`, `Quantity`, `SalePrice?`, `Price?`, `SubTotal`, `Remark`, `CreatedBy`, `CreatedOn?`. |
| `WARDRequisitionModel` | `RequisitionId` | Header of a ward-side requisition (legacy `WARD_Requisition` table, mostly superseded by `PHRM_StoreRequisition` / `INV_TXN_Requisition`). | `WardId`, `StoreId`, `Status`, `ReferenceId`, `CreatedBy`, `CreatedOn?`, `WardRequisitionItemsList` (NotMapped nav). |
| `WARDRequisitionItemsModel` | `RequisitionItemId` | Line items. | `RequisitionId`, `ItemId`, `Quantity`, `DispatchedQty`. |
| `WARDConsumptionModel` | `ConsumptionId` | A single patient-consumption line. | `WardId`, `StoreId`, `InvoiceId?`, `InvoiceItemId`, `PatientId`, `ItemId`, `VisitId?`, `ItemName`, `BatchNo`, `ExpiryDate`, `Quantity`, `SalePrice`, `SubTotal`, `Remark`, `CreatedBy`, `CreatedOn?`, `ModifiedOn?`, `ModifiedBy?`. |
| `WARDInternalConsumptionModel` | `ConsumptionId` | Header of an internal (non-billable) consumption entry. | `WardId`, `SubStoreId`, `DepartmentId`, `TotalAmount`, `Remark`, `CreatedBy`, `CreatedOn`, `ModifiedOn?`, `ModifiedBy?`, `ConsumedBy`, `WardInternalConsumptionItemsList` (NotMapped). |
| `WARDInternalConaumptionItemsModel` | `ConsumptionItemId` | Line items of an internal consumption. | `ConsumptionId`, `ItemId`, `WardId`, `SubStoreId`, `DepartmentId`, `ItemName`, `BatchNo`, `ExpiryDate`, `SalePrice`, `Price?`, `Quantity`, `Subtotal`, `Remark`, `CreatedBy`, `CreatedOn`, `ModifiedOn?`, `ModifiedBy?`. |
| `WARDInventoryConsumptionModel` | `ConsumptionId` | A single inventory-side consumption line written to `WARD_INV_Consumption`. | `StoreId`, `DepartmentId`, `DepartmentName`, `ItemId`, `ItemName`, `Quantity`, `Remark`, `UsedBy`, `CreatedBy`, `CreatedOn?`, `ConsumptionDate?`, `ConsumeQuantity` (NotMapped), `CounterId` (NotMapped), `ConsumptionReceiptId?` (groups lines into a receipt), `StockId`. |
| `WARDInventoryReturnModel` | `ReturnId` | Header of a return from sub-store back to inventory store. | `SourceStoreId`, `TargetStoreId`, `ReturnDate?`, `Remarks`, `CreatedBy`, `CreatedOn?`, `ModifiedOn?`, `ModifiedBy?`, `ReturnItemsList` (NotMapped, virtual nav). |
| `WARDInventoryReturnItemsModel` | `ReturnItemId` | A returned line. | `ItemId`, `ReturnQuantity`, `ReturnId`, `CreatedBy`, `CreatedOn?`, `Remark`, `BatchNo`, `ExpiryDate?`, `IsFixedAsset` (NotMapped), `WardReturn` (nav), `ReturnAssets` (default empty `List<MAP_ReturnItems_FixedAssetStock>`). |
| `MAP_ReturnItems_FixedAssetStock` | composite (`ReturnItemId`, `FixedAssetStockId`) | Join between a return line and the specific fixed-asset units being returned. | `ReturnItemId`, `FixedAssetStockId`, `Asset` (nav to `FixedAssetStockModel`). |
| `InvPatientConsumptionReceiptModel` | `ConsumptionReceiptId` | A header that groups patient consumptions of inventory items into a single receipt. | `ConsumptionReceiptNo` (auto-incremented per store), `ConsumptionDate`, `PatientId`, `StoreId`, `Remarks`, `IsCancel?`, `CreatedBy`, `CreatedOn`, `ModifiedBy?`, `ModifiedOn?`, `ConsumptionList` (NotMapped). |
| `WARDInventoryStockModel` | (commented out) | Legacy inventory-side per-batch stock model; superseded by the global `INV_TXN_StoreStock` + `INV_MST_Stock`. File is present but all lines are commented. | n/a |
| `WARDInventoryTransactionModel` | (commented out) | Legacy inventory-side transaction ledger; superseded by `INV_TXN_StockTransaction` and `PHRM_TXN_StockTransaction`. File is present but all lines are commented. | n/a |

### 3.2 Fixed-Asset Sub-Store

| Model | Key | Purpose | Notable fields |
|---|---|---|---|
| `WARDSupplyAssetRequisitionModel` | `RequisitionId` | Header of a capital-goods sub-store requisition. Maps to `INV_TXN_FixedAssetRequisition`. | `RequisitionDate`, `CreatedBy?`, `CreatedOn?`, `RequisitionStatus` (`pending`/`active`/`partial`/`complete`/`cancelled`), `IssueNo?`, `StoreId?` (source), `SubStoreId?` (target), `ModifiedOn?`, `ModifiedBy`, `IsCancel?`, `CancelRemarks`, `RequisitionNo?`, `Remarks`, `IsDirectDispatch?`, `RequisitionItemsList` (NotMapped), `MaxVerificationLevel`, `StoreName`, `VerificationId?`. |
| `WARDSupplyAssetRequisitionItemsModel` | `RequisitionItemId` | Line items of an asset requisition. | `ItemId?`, `Quantity?`, `RequisitionId`, `CreatedBy?`, `CreatedOn?`, `ReceivedQuantity?`, `PendingQuantity?`, `RequisitionItemStatus` (`active`/`partial`/`complete`/`withdrawn`/`cancelled`), `Remark`, `IssueNo?`, `CancelQuantity?`, `CancelBy?`, `CancelOn?`, `IsActive`, `ModifiedOn?`, `ModifiedBy?`, `CancelRemarks`. |
| `WARDSupplyAssetReturnModel` | `ReturnId` | Header of an asset return from sub-store. Maps to `INV_TXN_FixedAssetReturn`. | `StoreId`, `SubStoreId`, `ReturnDate?`, `ItemName` (NotMapped), `Remarks`, `CreatedBy`, `CreatedOn?`, `ModifiedOn?`, `ModifiedBy?`, `ReturnItemsList` (NotMapped), `MaxVerificationLevel`, `StoreName`, `VerificationId?`. |
| `WARDSupplyAssetReturnItemsModel` | `ReturnItemId` | A returned asset line; identifies the specific unit by `FixedAssetStockId`. | `ItemId`, `ReturnId`, `FixedAssetStockId`, `SerialNo?`, `CreatedBy`, `CreatedOn?`, `Remark`. |

### 3.3 Ward-SubStore mapping

| Model | Key | Purpose | Notable fields |
|---|---|---|---|
| `WardSubStoresMAPModel` | `WardSubStoresMapId` | Maps a ward to a sub-store. One ward can map to multiple sub-stores; one of them is the default. | `WardId`, `StoreId`, `IsDefault`, `IsActive`, `CreatedBy`, `CreatedOn`, `ModifiedBy?`, `ModifiedOn?`. |
| `WardSubStoresMAPDTO` | `WardSubStoresMapId` | Wire-format DTO. | Same as above but with nullable `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`. |
| `WardSubStoresMap_DTO` | `WardSubStoresMapId` | Older DTO variant. | Same as `WardSubStoresMAPDTO`. |
| `WardSubStoresMapModel` (MasterModels) | `WardSubStoresMapId` | Lives in `Code/Components/DanpheEMR.ServerModel/MasterModels/WardSubStoresMapModel.cs`. The same shape as `WardSubStoresMAPModel` but using `bool` instead of `Boolean`. The settings UI uses this one. | Same as `WardSubStoresMAPModel`. |

### 3.4 Reporting DTOs (output shapes)

All in `Code/Websites/DanpheEMR/ViewModel/Substore/`.

| DTO | Purpose | Fields |
|---|---|---|
| `WardSupplyWardStockDTO` | Output for `GET /WardStock` and `GET /AvailableWardStock`. | `StoreId`, `ItemId`, `StockId`, `ItemName`, `GenericName`, `BatchNo`, `AvailableQuantity`, `ExpiryDate?`, `CostPrice`, `SalePrice`, `Unit`. |
| `WardSupplyConsumptionDetailsDTO` | Output for `GET /ConsumptionDetails`. Patient + ward roll-up. | `WardId`, `WardName`, `Name`, `Address`, `Gender`, `PhoneNumber`, `PatientId`, `Quantity`, `Age`. |
| `WardSupplyInternalConsumptionDetailsDTO` | Output for `GET /InternalConsumptionDetailsById/{id}`. | `ConsumptionId`, `ConsumptionItemId`, `ItemName`, `ItemId`, `SubStoreId`, `BatchNo`, `ExpiryDate`, `SalePrice`, `Quantity`, `TotalAmount`, `Remark`, `User`, `Department`, `DepartmentId`, `Date`, `GenericId`, `GenericName`. |
| `WardSupplyInternalConsumptionListDTO` | Output for `GET /InternalConsumptions`. | `ConsumptionId`, `ConsumedDate`, `SubStoreName`, `ConsumedBy`, `Remark`. |
| `WardSupplyInternalConsumptionItemListDTO` | Output for `GET /InternalConsumptionItemListById/{id}`. | `ConsumptionItemId`, `GenericName`, `ItemName`, `BatchNo`, `ConsumedQuantity`. |
| `WardSupplyInventoryConsumptionItemListDTO` | Output for `GET /InventoryConsumptionItemList`. | `ItemName`, `Quantity`, `UsedBy`. |
| `WardSupplyPatientConsumptionItemDTO` | Output for `GET /PatientConsumptionItemList`. | `ConsumptionId`, `ItemId`, `ItemName`, `GenericName`, `Quantity`, `BatchNo`, `ExpiryDate`, `SalePrice`, `TotalAmount`, `CreatedOn?`, `User`, `Remark`, `StoreId`, `InvoiceItemId`, `InvoiceId?`, `wardId`. |
| `WardSupplyRequisitionsDTO` | Output for `GET /Requisitions`. | `RequisitionNo`, `CreatedBy`, `Date?`, `Status`, `RequisitionId`, `IsNewDispatchAvailable`. |
| `WardSupplyRequisitionItemsByIdDTO` | Output for `GET /RequisitionItemsById/{id}`. | `RequisitionItemId`, `RequisitionId`, `ItemId`, `Quantity`, `DispatchedQty`, `ItemName`, `GenericName`, `enableItmSearch`. |
| `WardSupplyInPatientListDTO` | Output for `GET /InPatientList`. | `PatientId`, `PatientCode`, `FirstName`, `MiddleName`, `LastName`, `Gender`, `DateOfBirth?`, `Age`, `Address`, `PhoneNumber`, `VisitCode`, `PatientVisitId`, `WardId`, `ShortName`. |
| `SubstoreStockViewModel` | Stock-reconciliation row (used by export/import). | `ItemId`, `StockId`, `ItemName`, `MinimumQuantity?`, `ExpiryDate?`, `Code`, `UOMName`, `IsColdStorageApplicable?`, `MRP`, `BatchNo`, `ItemType`, `StoreId`, `StoreName`, `SubStoreId`, `ItemRate`, `AvailableQuantity`, `NewAvailableQuantity`. |

---

## 4. Database Tables

The module writes to many tables — both its own and tables shared with Inventory, Pharmacy, RBAC, and ADT. The mapping is configured in `WardSupplyDbContext.OnModelCreating`. The primary tables the module reads/writes:

### 4.1 Ward-Supply core tables

| Table | EF model | Purpose |
|---|---|---|
| `WARD_Stock` | `WARDStockModel` | Legacy per-batch per-(sub)store stock row. Still in active use for ward-to-ward transfers, breakage, and reconciliation. |
| `WARD_Transaction` | `WARDTransactionModel` | Audit ledger for `WARD_Stock` movements (`WardtoWard`, `Inventory-WardtoWard`, `BackToInventory`, `BreakageItem`, `WardConsumptionEdit`). |
| `WARD_Requisition` / `WARD_RequisitionItems` | `WARDRequisitionModel` / `WARDRequisitionItemsModel` | Legacy ward-side requisition (rarely written to now; new requisitions go to `PHRM_StoreRequisition` or `INV_TXN_Requisition`). Still used by `GET /RequisitionItemsById/{id}` for the ward requisition view. |
| `WARD_Dispatch` / `WARD_DispatchItems` | `WARDDispatchModel` / `WARDDispatchItemsModel` | Ward-side dispatch header and line items. |
| `WARD_Consumption` | `WARDConsumptionModel` | One row per patient-consumption line. Joined to `PHRM_TXN_InvoiceItems` via `InvoiceItemId` so a change here re-bills the patient. |
| `WARD_InternalConsumption` / `WARD_InternalConsumptionItems` | `WARDInternalConsumptionModel` / `WARDInternalConaumptionItemsModel` | Internal (non-billable) consumption header and lines. |
| `WARD_INV_Consumption` | `WARDInventoryConsumptionModel` | Inventory-side consumption rows. Linked optionally to `WARD_INV_ConsumptionReceipt` via `ConsumptionReceiptId`. |
| `WARD_INV_ConsumptionReceipt` | `InvPatientConsumptionReceiptModel` | Patient-consumption receipt header on the inventory side. Auto-numbered per store. |
| `WARD_TXN_Return` / `WARD_TXN_ReturnItems` | `WARDInventoryReturnModel` / `WARDInventoryReturnItemsModel` | Return-from-substore to inventory store header and lines. |
| `WARD_TXN_ReturnItems_FixedAssetStock` | `MAP_ReturnItems_FixedAssetStock` | Join: per-unit return of a specific fixed-asset unit. |
| `ADT_MST_Ward` | `WardModel` | ADT-side ward master. Read-only here. |
| `MST_Department` | `DepartmentModel` | Read for departments lookup. |
| `WardSubStoresMap` (the table name is set via `WardSubStoresMAPModel` / `MasterModels/WardSubStoresMapModel`) | `WardSubStoresMAPModel` | Many-to-many map of wards to sub-stores. |
| `PAT_Patient` / `PAT_PatientVisits` / `ADT_PatientAdmission` / `ADT_TXN_PatientBedInfo` | `PatientModel` / `VisitModel` / `AdmissionModel` / `PatientBedInfo` | Read for the InPatient list. |
| `EMP_Employee` / `EMP_EmployeeRole` | `EmployeeModel` / `EmployeeRoleModel` | Read for created-by joins. |

### 4.2 Inventory tables (shared with Inventory module)

| Table | EF model | Purpose in ward supply |
|---|---|---|
| `INV_MST_Item` | `ItemMasterModel` | Item master. |
| `INV_MST_ItemCategory` / `INV_MST_ItemSubCategory` | `ItemCategoryMasterModel` / `ItemSubCategoryMasterModel` | Item classification. |
| `INV_MST_UnitOfMeasurement` | `UnitOfMeasurementMasterModel` | UoM. |
| `INV_MST_Stock` | `StockMasterModel` | Per-batch stock master. |
| `INV_TXN_StoreStock` | `StoreStockModel` | Per-store stock, FK to `StockMaster`. This is the primary stock table the inventory-ward flow reads/writes. |
| `INV_TXN_StockTransaction` | `StockTransactionModel` | Every stock movement (dispatch, receive, write-off, return, manage). |
| `INV_TXN_Requisition` / `INV_TXN_RequisitionItems` | `RequisitionModel` / `RequisitionItemsModel` | Inventory-side sub-store requisitions. |
| `INV_TXN_FixedAssetRequisition` / `INV_TXN_FixedAssetRequisitionItems` | `WARDSupplyAssetRequisitionModel` / `WARDSupplyAssetRequisitionItemsModel` | Asset sub-store requisitions. |
| `INV_TXN_FixedAssetReturn` / `INV_TXN_FixedAssetReturnItems` | `WARDSupplyAssetReturnModel` / `WARDSupplyAssetReturnItemsModel` | Asset sub-store returns. |
| `INV_TXN_FixedAssetDispatch` / `INV_TXN_FixedAssetDispatchItems` | `FixedAssetDispatchModel` / `FixedAssetDispatchItemsModel` | Asset dispatch (with per-unit barcodes). |
| `INV_TXN_FixedAssetStock` | `FixedAssetStockModel` | One row per physical unit (barcode). |
| `INV_TXN_GoodsReceipt` / `INV_TXN_GoodsReceiptItems` | `GoodsReceiptModel` / `GoodsReceiptItemsModel` | Read for vendor / GR join in asset-stock queries. |
| `INV_MST_Donation` | `FixedAssetDonationModel` | Read for donation join. |
| `INV_MST_Vendor` | `VendorMasterModel` | Read for vendor info on asset stock. |
| `INV_AssetLocationHistory` | `AssetLocationHistoryModel` | One row per asset move; written by `WardSupplyAssetsController.PostStoreDispatch`. |
| `INV_CFG_FiscalYears` | `InventoryFiscalYear` | Fiscal year for inventory transactions. |

### 4.3 Pharmacy tables (shared with Pharmacy module)

| Table | EF model | Purpose in ward supply |
|---|---|---|
| `PHRM_MST_Store` | `PHRMStoreModel` | The unified store master; sub-stores are rows with `Category=Substore`. |
| `PHRM_MST_Item` / `PHRM_MST_Generic` | `PHRMItemMasterModel` / `PHRMGenericModel` | Pharmacy item master, joined for stock views and consumption line details. |
| `PHRM_MST_UnitOfMeasurement` | `PHRMUnitOfMeasurementModel` | UoM. |
| `PHRM_MST_Rack` / `PHRM_MAP_ItemToRack` | `PHRMRackModel` / `PHRM_MAP_ItemToRack` | Rack info shown on dispatch-receive screen. |
| `PHRM_MST_Stock` | `PHRMStockMaster` | Per-batch stock master on the pharmacy side. |
| `PHRM_TXN_StoreStock` | `PHRMStoreStockModel` | Per-store stock on the pharmacy side. |
| `PHRM_TXN_StockTransaction` | `PHRMStockTransactionModel` | Pharmacy stock-movement ledger. |
| `PHRM_StoreRequisition` / `PHRM_StoreRequisitionItems` | `PHRMStoreRequisitionModel` / `PHRMStoreRequisitionItemsModel` | Pharmacy sub-store requisitions. |
| `PHRM_StoreDispatchItems` | `PHRMDispatchItemsModel` | Pharmacy dispatch lines. |
| `PHRM_TXN_InvoiceItems` | `PHRMInvoiceTransactionItemsModel` | Read + written by patient consumption. |
| `PHRM_CFG_FiscalYears` | `PharmacyFiscalYear` | Fiscal year for pharmacy transactions. |

### 4.4 CSSD, Verification, RBAC, Other

| Table | EF model | Purpose |
|---|---|---|
| `CSSD_TXN_ItemTransaction` | `CssdItemTransactionModel` | Written by `WardSupplyAssetsBL.SendAssetToCssd`. |
| `TXN_Verification` | `VerificationModel` | Verification ledger for pharmacy sub-store requisitions. |
| `Rbac_Application` / `Rbac_Role` / `Rbac_User` / `Rbac_Permission` / `Rbac_StoreVerificationMap` | various | RBAC: sub-store creation auto-creates a permission and roles for verifiers via `SubstoreBL`. |
| `CfgParameters` | not modelled in this DbContext | Read by `WardSupplyBL.ReceiveDispatchedStocks` for `EnableReceivedItemInSubstore` toggle. |

---

## 5. Key Workflows

### 5.1 Pharmacy-side Sub-Store: Stock & Consumption

```
[Pharmacy issues items to a sub-store]                (Pharmacy module, not in this module)
   |
   v
[Sub-store's StoreStock rows increase in PHRM_TXN_StoreStock]

[Nurse logs in to WardSupply / Pharmacy / Stock]
   |
   v
[GET /api/WardSupply/WardStock?StoreId=X]  --> Lists non-expired stock with AvailableQuantity.
[GET /api/WardSupply/AvailableWardStock?StoreId=X]  --> Same but includes expired.
[GET /api/WardSupply/InPatientList]  --> List of admitted patients.
   |
   v
[Nurse selects a patient and items]
   |
   v
[POST /api/WardSupply/Consumption  body=WardConsumptionModel]
   |
   v
[Controller: PostConsumption]
   - Inserts WARD_ConsumptionModel row
   - Returns the new ConsumptionId
   (NOTE: stock decrement is NOT done here. The stock decrement is in
    WardSupplyBL.UpdateWardStockForConsumption which is invoked from
    PostInventoryConsumption / PostInvPatientConsumption. The simple
    /Consumption endpoint only writes the consumption record.)

[Nurse submits internal (non-billable) consumption]
   |
   v
[POST /api/WardSupply/InternalConsumption  body=WARDInternalConsumptionModel]
   |
   v
[Controller: PostInternalConsumption, in DB transaction]
   1. Insert WARD_InternalConsumption header (CreatedOn, CreatedBy).
   2. Insert WARD_InternalConsumptionItems lines (BatchNo, ExpiryDate, SalePrice, Quantity, Subtotal).
   3. For each line, walk StoreStock rows for (StoreId, ItemId, BatchNo, ExpiryDate) in
      AvailableQuantity > 0 order. For each row:
      - Build PHRMStockTransactionModel with TransactionType = PHRMSubStoreConsumption.
      - Decrement AvailableQuantity (use subStoreStock.UpdateAvailableQuantity).
      - Set stock-txn outQty to the decremented amount.
      - Save and break if remaining qty = 0.
   4. Commit. Return new ConsumptionId.
```

### 5.2 Inventory-side Sub-Store Consumption

```
[Nurse logs in to WardSupply / Inventory / Consumption]
   |
   v
[GET /api/WardSupply/GetInventoryItemsByStoreId/{StoreId}]
   --> Returns items in sub-store with AvailableQuantity, MinStockQuantity,
       SubCategory, MRP, BatchNo, etc. (uses WARD_INV_ConsumptionReceiptId IS NULL filter
       when listing consumption)
   |
   v
[GET /api/WardSupply/GetInventoryConsumptionList/{StoreId}/{FromDate}/{ToDate}]
   --> Historical consumption by date range (excluding receipted ones).
   |
   v
[Nurse enters items + user]
   |
   v
[POST /api/WardSupply/InventoryConsumption  body=List<WARDInventoryConsumptionModel>]
   |
   v
[Controller: PostInventoryConsumption, in DB transaction]
   For each consumption:
   - consumption.Quantity = consumption.ConsumeQuantity
   - consumption.CreatedOn = now
   - Insert WARD_INV_Consumption row
   - WardSupplyBL.UpdateWardStockForConsumption(...)
       For each StoreStock for (StoreId, ItemId) with AvailableQuantity > 0:
         - Walk expiry order
         - stock.DecreaseStock(qty, transactionType=ConsumptionItem, refNo=ConsumptionId, ...)
         - Save and break when done.
   Commit. Return inserted consumption list.
```

### 5.3 Inventory-side Patient Consumption (with receipt)

```
[Doctor orders inventory items for an inpatient]
   |
   v
[POST /api/WardSupply/PostInvPatientConsumption  body=InvPatientConsumptionReceiptModel]
   |
   v
[Controller: PostInvPatientConsumption, in DB transaction]
   1. maxReceiptNo = MAX(ConsumptionReceiptNo) for this store; receipt.ConsumptionReceiptNo = max+1.
   2. Insert WARD_INV_ConsumptionReceipt header (CreatedOn, CreatedBy).
   3. For each line in ConsumptionList:
        - consumption.ConsumptionReceiptId = receiptId
        - consumption.Quantity = consumption.ConsumeQuantity
        - Insert WARD_INV_Consumption row
        - WardSupplyBL.UpdateWardStockForConsumption(...)
   Commit. Return ConsumptionList.

[Later: view the receipt]
   GET /api/WardSupply/GetInventoryPatientConsumptionReceiptList/{StoreId}/{FromDate}/{ToDate}
   GET /api/WardSupply/GetInventoryPatConsumptionItemlistById/{ReceiptId}
```

### 5.4 Pharmacy Sub-Store Requisition (with optional verification)

```
[Sub-store nurse / storekeeper wants more stock]
   |
   v
[GET /api/WardSupply/GetPharmacyItemToRequest]
   --> Lists pharmacy main-store items with AvailableQuantity.
[GET /api/WardSupply/GetItemSubCategory]
   --> For item filter UI.
[GET /api/WardSupply/Verifiers]
   --> Returns RbacRole + (RbacUser join Employee) list, for the verifier picker.
   |
   v
[POST /api/WardSupply/PostPhrmSubStoreRequisition  body=PharmacySubStoreRequisition_DTO]
   |
   v
[Controller: PostPhrmSubStoreRequisition -> WardSupplyBL.PostPhrmSubStoreRequisition]
   1. requisition.FiscalYearId = GetFiscalYear(...)
   2. requisition.RequisitionNo = GetCurrentFiscalYearRequisitionNo(...) (max+1).
   3. If VerifierIds != "[]": RequisitionStatus = "pending".
      Else:                   RequisitionStatus = "active", VerifierIds = null.
   4. Insert PHRM_StoreRequisition header.
   5. For each line:
        - item.RequisitionId = requisition.RequisitionId
        - item.AuthorizedOn = now
        - item.PendingQuantity = item.Quantity
      Insert PHRM_StoreRequisitionItems lines.
   6. Return requisition.RequisitionId.
   |
   v
[Pharmacy store-keeper sees pending requisitions]
   GET /api/WardSupply/Requisitions?StoreId=X
       --> Joins PHRM_StoreRequisition, EMP_Employee, PHRM_MST_Store, PHRM_StoreDispatchItems.
       --> IsNewDispatchAvailable = any dispatch line with ReceivedById IS NULL.

[Pharmacy dispatches items; sub-store nurse receives]
   GET /api/WardSupply/GetDispatchedItemToReceive?requisitionId=...
   PUT /api/WardSupply/UpdateDispatchedItemsReceiveStatus/{DispatchId}
       --> WardSupplyBL.ReceiveDispatchedStocks(...)
           - Reads CfgParameters for EnableReceivedItemInSubstore.
           - For each dispatch line, finds INV_TXN_StockTransaction rows of
             DispatchedItem / DispatchedItemReceivingSide and either
             ConfirmStockDispatched (source) or ConfirmStockReceived (target).
           - Stamps ReceivedById, ReceivedOn, ReceivedRemarks.
           - Calls UpdateReceivedQuantityInRequisitionItems (re-bumps ReceivedQuantity).
   GET /api/WardSupply/GetPHRMSubStoreAvailableStockByStoreId/{StoreId}
       --> Now shows the received stock.
```

### 5.5 Inventory-Side Sub-Store Requisition (full cycle)

```
[Sub-store creates requisition to inventory store]
   GET  /api/WardSupply/GetSubstoreRequistionList?fromDate=...&toDate=...&storeId=...
       --> List of inventory-side requisitions where RequestFromStoreId == storeId.
[Sub-store nurse picks items]
   GET  /api/WardSupply/RequisitionItemsById/{RequisitionId}  (legacy WARD_Requisition)
[Sub-store receives dispatched items]
   GET  /api/WardSupply/GetDispatchListForItemReceive/{RequisitionId}
       --> returns { RequisitionDetail, DispatchDetail[] } grouped by DispatchId.
[Confirmation: PUT /api/WardSupply/UpdateDispatchedItemsReceiveStatus/{DispatchId} body=ReceivedRemarks]
       --> WardSupplyBL.ReceiveDispatchedStocks(...) (same helper as pharmacy side)
```

### 5.6 Stock Movements

#### 5.6.1 Ward-to-Ward transfer (within a sub-store)
```
POST /api/WardSupply/TransferStock/{ReceivedBy}  body=WARDStockModel
   -> WardSupplyBL.StockTransfer(...)
   Transaction:
     - Decrement source stock by DispachedQuantity.
     - Insert WARD_Transaction with TransactionType="WardtoWard" (IsWard=true).
     - If target ward already has a row for (WardId, ItemId, BatchNo, StoreId):
         increment that row's AvailableQuantity.
       Else:
         insert new WARD_Stock row with AvailableQuantity = DispachedQuantity.
     - Commit.
```

#### 5.6.2 Inventory-Ward transfer (between inventory sub-stores)
```
POST /api/WardSupply/TransferInventoryStock  body=WARDStockModel
   -> WardSupplyBL.StockInventoryTransfer(...)
   Filter: StockType == "inventory" (uses DepartmentId instead of WardId).
   Transaction:
     - Decrement source.
     - WARD_Transaction with TransactionType="Inventory-WardtoWard" (IsWard=false).
     - If matching destination row exists, increment; else insert new.
```

#### 5.6.3 Return to inventory
```
POST /api/WardSupply/TransferBackToInventory  body=WARDStockModel
   -> WardSupplyBL.BackToInventoryTransfer(...)
   Transaction:
     - Decrement WARD_Stock.
     - WARD_Transaction with TransactionType="BackToInventory".
     - Locate INV_TXN_StoreStock for (ItemId, BatchNo); call AddStock(...)
       with TransactionType=TransferItem, needConfirmation=true.
```

#### 5.6.4 Breakage
```
POST /api/WardSupply/BreakageStock  body=WARDStockModel
   -> WardSupplyBL.StockBreakage(...)
   Transaction:
     - Decrement WARD_Stock by DispachedQuantity.
     - WARD_Transaction with TransactionType="BreakageItem", IsWard=true.
```

#### 5.6.5 Return to pharmacy (transfer back to main pharmacy store)
```
POST /api/WardSupply/ReturnStockToPharmacy/{ReceivedBy}  body=List<WARDStockModel>
   -> WardSupplyBL.StockTransferToPharmacy(...)
   - Compute next DispatchId (max+1).
   - mainStoreId = first PHRM_Store with SubCategory=Pharmacy.
   For each transferred stock:
     - Insert PHRM_StoreDispatchItems row (Source=ward StoreId, Target=mainStoreId).
     - Find sub-store StoreStock rows for (ItemId, BatchNo, ExpiryDate) with AvailableQuantity>0.
     - Throw if total available < DispachedQuantity.
     - For each sub-store stock row:
         PHRM_StockTransaction(TransactionType=TransferItem, refNo=DispatchItemsId, ...)
         Decrement sub-store; if shortage, drain fully and continue; else fully cover and break.
     - Find main-store StoreStock for the same StockId. If missing, create one.
         PHRM_StockTransaction on main-store: inQty = amount added.
```

#### 5.6.6 Sub-store to inventory return (with fixed-asset support)
```
POST /api/WardSupply/WardInventoryReturn  body=WARDInventoryReturnModel
   -> Controller static helpers: ReturnToInventory -> PerformStockManipulation
   - WARD_TXN_Return header inserted (SourceStoreId=SubStore, TargetStoreId=MainStore).
   - For each return line:
        If IsFixedAsset:
            For each ReturnAsset.FixedAssetStockId, call fixedAsset.Return(targetStoreId, ...)
                (FixedAssetStockModel.Return is the Inventory side.)
        Else (consumable):
            Walk sub-store StoreStock for (ItemId, BatchNo, ExpiryDate) with AvailableQuantity>0.
            Throw if total < ReturnQuantity.
            For each sub-store stock:
                - subStoreStock.DecreaseStock(..., TransactionType=ReturnedItem, needConfirmation=true)
                - Locate or create main-store StoreStock and AddStock(...
                    TransactionType=ReturnedItemReceivingSide, needConfirmation=true).
                - Save. Break when remaining qty == 0.
```

### 5.7 Stock Reconciliation

```
[Admin: GET /api/WardSupply/ExportStocksForReconciliationToExcel?StoreId=X]
   - Pulls StoreStock for the sub-store joined to INV_MST_Item + UoM + first IN-txn store.
   - Builds SubstoreStockViewModel rows (ItemId, ItemName, Code, UOMName, MRP, BatchNo, AvailableQuantity, NewAvailableQuantity = same).
   - Generates a Syncfusion XlsIO workbook with the rows.
   - The workbook is fully protected except for the "NewAvailableQuantity" column.
   - Returns file SubstoreStockReconciliation_yyyy-MM-dd-hh-mm.xlsx.

[Admin edits the file offline, fills in NewAvailableQuantity]

[Admin: POST /api/WardSupply/UpdateReconciledStockFromExcelFile  body=List<SubstoreStockViewModel>]
   -> WardSupplyBL.UpdateReconciledStockFromExcel(...)
   For each row:
     - diff = NewAvailableQuantity - AvailableQuantity
     - Locate StoreStock(StockId, ItemId, SubStoreId).
     - If diff == 0: skip.
     - If diff > 0: stocks.AddStock(quantity=diff, transactionType=StockManageItem, needConfirmation=false).
     - If diff < 0: stocks.DecreaseStock(quantity=|diff|, transactionType=StockManageItem, needConfirmation=false).
   Commit.
```

### 5.8 Fixed-Asset Sub-Store Flow

```
[Asset storekeeper lists sub-store assets]
   GET /api/WardSupplyAssets/GetFixedAssetStockBySubStoreId/{SubStoreId}
       --> One row per FixedAssetStock with vendor/donation/holder joins.
[Asset storekeeper views main-store assets available to dispatch]
   GET /api/WardSupplyAssets/GetFixedAssetStockByStoreId/{StoreId}
       --> Same shape but filtered to where SubStoreId IS NULL.

[Sub-store creates asset requisition]
   POST /api/WardSupplyAssets/AssetRequisition  body=WARDSupplyAssetRequisitionModel
       -> AddAssetRequisition
       - Assign RequisitionNo = (max + 1).
       - If RequisitionDate is null, use now; else shift by negative diff-days (anchoring date).
       - Insert INV_TXN_FixedAssetRequisition header.
       - For each line: PendingQuantity = Quantity, IsActive=true, CreatedOn/By set.
       - Return RequisitionId.

[Sub-store views requisitions]
   GET /api/WardSupplyAssets/GetSubstoreAssetRequistionList/{FromDate}/{ToDate}/{SubStoreId}
   GET /api/WardSupplyAssets/GetSubstoreAssetRequistionItemsById/{RequisitionId}
   GET /api/WardSupplyAssets/GetSubstoreAssetRequistionListByStoreId/{FromDate}/{ToDate}/{StoreId}

[Main store dispatches assets (with per-unit barcodes)]
   POST /api/WardSupplyAssets/PostStoreDispatch  body=FixedAssetDispatchModel
       In a transaction:
       1. Insert INV_TXN_FixedAssetDispatch header (Remark, StoreId, SubStoreId).
       2. Insert INV_TXN_FixedAssetDispatchItems lines (with BarCodeNumber, ExpiryDate=now, MRP=0).
       3. For each line, attach FixedAssetStock and set SubStoreId = dispatch.SubStoreId.
       4. For each unique RequisitionItemId in the dispatch:
            - RequisitionItem.ReceivedQuantity = count + prior received.
            - RequisitionItem.PendingQuantity = max(0, Quantity - ReceivedQuantity - CancelQuantity).
            - RequisitionItem.RequisitionItemStatus = (PendingQuantity<=0) ? "complete" : "partial".
          Save.
       5. Requisition.RequisitionStatus = "partial" if any line is partial/active, else "complete".
       6. Insert INV_AssetLocationHistory rows for each item (StartDate=now, OldStoreId=dispatch.StoreId).

[Sub-store receives dispatched assets]
   GET /api/WardSupplyAssets/dispatchview/{RequisitionId}
   GET /api/WardSupplyAssets/dispatchviewbyDispatchId/{DispatchId}
   GET /api/WardSupplyAssets/GetFixedAssetDispatchListForItemReceive/{RequisitionId}

[Sub-store returns assets to main store]
   GET /api/WardSupplyAssets/GetSubstoreAssetReturnList/{FromDate}/{ToDate}/{SubStoreId}
   GET /api/WardSupplyAssets/GetSubstoreAssetReturnById/{ReturnId}
   GET /api/WardSupplyAssets/GetSubstoreAssetReturnListByStoreId/{FromDate}/{ToDate}/{StoreId}
   (POST return is not implemented in this controller; the flow uses the same
    WARD_TXN_Return table via WardSupplyController.WardInventoryReturn for consumables,
    and the asset-return is a parallel write to INV_TXN_FixedAssetReturn.)

[Direct dispatch (skipping the requisition-pending step)]
   POST /api/WardSupplyAssets/PostDirectDispatch  body=FixedAssetDispatchModel
       -> WardSupplyAssetsBL.DirectDispatch
          1. CreateRequisition: insert header with IsDirectDispatch=true, RequisitionStatus="complete";
             insert one requisition item per unique ItemId (Quantity = count of dispatch lines for that item).
          2. DispatchItemsTransaction: insert dispatch header (ReceivedBy = client value),
             insert dispatch items, update each FixedAssetStock.SubStoreId.

[Send asset to CSSD for sterilization]
   PUT /api/WardSupplyAssets/SendStockToCssd?FixedAssetStockId=...
       -> WardSupplyAssetsBL.SendAssetToCssd
          - selectedAsset.CssdStatus = "pending".
          - Insert CssdItemTransactionModel with CssdStatus="pending",
            StoreId = SubStoreId ?? StoreId, RequestedBy=currentUser.
```

### 5.9 Verifier / RBAC bootstrap

The Pharmacy sub-store module supports an arbitrary-depth verifier chain. Setup is owned by `SubstoreBL`:

```
[Admin creates a sub-store]    (settings module, not WardSupply)
   |
   v
[SubstoreBL.CreateStore]
   - Inserts PHRM_MST_Store row with Category=Substore.
[SubstoreBL.CreatePermissionForStore]
   - Inserts Rbac_Permission row, ApplicationId from "WardSupply"/"WARD".
[For each verifier level]  SubstoreBL.CreatePermissionForStoreVerifier + CreateRoleForStoreVerifier
   - One Permission per level, named "{StoreName}-verifier{level}".
   - One Role per level if NewRoleName provided.
[SubstoreBL.CreateStoreVerificationMap]
   - Inserts Rbac_StoreVerificationMap (StoreId, VerificationLevel, MaxVerificationLevel, PermissionId).

[Runtime: GET /api/WardSupply/Verifiers]
   -> WardSupplyBL.GetVerifiers
      - Returns Rbac_Role (IsActive=true) as {Id=RoleId, Name, Type=role}
        plus Rbac_User (IsActive=true) joined to EMP_Employee as {Id=UserId, FullName, Type=user}.

[POST /api/WardSupply/PostPhrmSubStoreRequisition]
   - If VerifierIds != "[]": status=pending (awaits verification).
   - Else:                status=active, VerifierIds cleared.
```

### 5.10 Reports

`WardReportingDbContext` exposes nine stored procedures. The controller methods all follow the same pattern:

```
GET /api/WardSupply/WARDStockItemsReport/{itemId}/{storeId}            -> SP_WardReport_StockReport
GET /api/WardSupply/WARDRequisitionReport/{FromDate}/{ToDate}/{StoreId} -> SP_WardReport_RequisitionReport
GET /api/WardSupply/WARDBreakageReport/{FromDate}/{ToDate}/{StoreId}   -> SP_WardReport_BreakageReport
GET /api/WardSupply/WARDConsumptionReport/{FromDate}/{ToDate}/{StoreId} -> SP_WardReport_ConsumptionReport
GET /api/WardSupply/WARDInternalConsumptionReport/{FromDate}/{ToDate}/{StoreId} -> SP_WardReport_InternalConsumptionReport
GET /api/WardSupply/WARDTransferReport/{FromDate}/{ToDate}/{StoreId}   -> SP_WardReport_TransferReport
GET /api/WardSupply/RequisitionDispatchReport/{FromDate}/{ToDate}/{StoreId} -> SP_WardInv_Report_RequisitionDispatchReport
GET /api/WardSupply/Inventory/Reports/TransferReport/{FromDate}/{ToDate}/{StoreId} -> SP_WardInv_Report_TransferReport
GET /api/WardSupply/ConsumptionReport/{FromDate}/{ToDate}/{StoreId}    -> SP_WardInv_Report_ConsumptionReport
```

All return `DanpheHTTPResponse<DataTable>` (or `DanpheHTTPResponse<object>`) serialized via `DanpheJSONConvert.SerializeObject`.

---

## 6. API Endpoints

All routes are mounted under `WardSupplyController` (route prefix `api/WardSupply`) or `WardSupplyAssetsController` (route prefix `api/WardSupplyAssets`).

### 6.1 Master / Lookup

| Method | Route | Returns | Notes |
|---|---|---|---|
| GET | `api/WardSupply/Departments` | `List<DepartmentModel>` | All departments ordered by name. |
| GET | `api/WardSupply/Wards?StoreId={id}` | `List<WardModel>` | Wards mapped to the given store. |
| GET | `api/WardSupply/ActiveSubstores` | `List<PHRMStoreModel>` | Stores with `Category=Substore` and `IsActive=true`. |
| GET | `api/WardSupply/GetItemSubCategory` | `List<ItemSubCategoryMasterModel>` | All item sub-categories. |
| GET | `api/WardSupply/Verifiers` | `List<Verifier_DTO>` | Roles + users for the verifier picker. |

### 6.2 Requisitions

| Method | Route | Returns | Notes |
|---|---|---|---|
| GET | `api/WardSupply/Requisitions?StoreId={id}` | `List<WardSupplyRequisitionsDTO>` | Pharmacy sub-store requisitions. Joins PHRM_StoreRequisition + Employee + Store + PHRM_StoreDispatchItems. |
| GET | `api/WardSupply/RequisitionItemsById/{id}` | `List<WardSupplyRequisitionItemsByIdDTO>` | Lines of a legacy WARD_Requisition. |
| GET | `api/WardSupply/GetSubstoreRequistionList?fromDate=&toDate=&storeId=` | `List<RequisitionModel>` | Inventory-side sub-store requisitions (from `INV_TXN_Requisition` where `RequestFromStoreId == storeId`). |
| GET | `api/WardSupply/GetDispatchListForItemReceive/{RequisitionId}` | `{ RequisitionDetail, DispatchDetail[] }` | Dispatched items not yet received. |
| GET | `api/WardSupply/GetDispatchedItemToReceive?requisitionId=...` | `RequisitionDispatchToReceive_DTO` | Full dispatch tree for the receive screen. |
| POST | `api/WardSupply/PostPhrmSubStoreRequisition` | `int` (new RequisitionId) | Create a pharmacy sub-store requisition. |
| POST | `api/WardSupply/PostPhrmSubStoreRequisition` (alias) | n/a | (The controller has a second `Post` action accepting `PharmacySubStoreRequisition_DTO` for the same path.) |
| PUT | `api/WardSupply/UpdateRequisition` | int (RequisitionId) | Update existing inventory-side requisition + lines; supports partial-line changes and `withdrawn` status. |
| PUT | `api/WardSupply/UpdateDispatchedItemsReceiveStatus/{DispatchId}` | int (DispatchId) | Mark a dispatch as received (increments `ReceivedQuantity` on items, stamps `ReceivedById/On/Remarks`). |

### 6.3 Stock

| Method | Route | Returns | Notes |
|---|---|---|---|
| GET | `api/WardSupply/WardStock?StoreId={id}` | `List<WardSupplyWardStockDTO>` | Non-expired stock in a sub-store (ExpiryDate >= now AND AvailableQuantity > 0). |
| GET | `api/WardSupply/AvailableWardStock?StoreId={id}` | `List<WardSupplyWardStockDTO>` | All stock with `AvailableQuantity > 0` (may include expired). |
| GET | `api/WardSupply/GetInventoryItemsByStoreId/{StoreId}` | anonymous list | Inventory items available in sub-store (joins StoreStock, INV_MST_Item, UoM, SubCategory). |
| GET | `api/WardSupply/GetInventorySubStoreItemsByStoreIdForReturn/{StoreId}` | anonymous list | Items available to return to inventory, with per-unit `BarCodeList` for fixed assets. |
| GET | `api/WardSupply/GetInventoryItemsForPatConsumptionByStoreId/{StoreId}` | anonymous list | Items flagged `IsPatConsumptionApplicable=true` in this sub-store. |
| GET | `api/WardSupply/GetPHRMSubStoreAvailableStockByStoreId/{StoreId}` | anonymous list | Raw available stock on the pharmacy side, no expiry filter. |
| GET | `api/WardSupply/InPatientList` | `List<WardSupplyInPatientListDTO>` | All currently admitted inpatients (join Patient + Visit + Admission + PatientBedInfo). |
| GET | `api/WardSupply/ExportStocksForReconciliationToExcel?StoreId=...` | xlsx file | Syncfusion-generated protected Excel for offline stock reconciliation. |
| POST | `api/WardSupply/UpdateReconciledStockFromExcelFile` | `{Status, Results, ErrorMessage}` | Apply the differences from the reconciled Excel as `StockManageItem` transactions. |

### 6.4 Consumption (Pharmacy patient)

| Method | Route | Returns | Notes |
|---|---|---|---|
| POST | `api/WardSupply/Consumption` | int (rows written) | Insert one or more `WARD_ConsumptionModel` rows. **Does NOT decrement stock.** |
| GET | `api/WardSupply/ConsumptionDetails?StoreId=&WardId=` | `List<WardSupplyConsumptionDetailsDTO>` | Patient-level consumption roll-up for a sub-store. |
| GET | `api/WardSupply/PatientConsumptionItemList?PatientId=&StoreId=&WardId=` | `List<WardSupplyPatientConsumptionItemDTO>` | Per-item lines of patient consumption. |
| PUT | `api/WardSupply/PatientConsumption` | `{Status, Results}` | Update a patient-consumption line; re-bills the invoice and adjusts `WARD_Stock`. |

### 6.5 Consumption (Internal / non-billable)

| Method | Route | Returns | Notes |
|---|---|---|---|
| GET | `api/WardSupply/InternalConsumptions?StoreId={id}` | `List<WardSupplyInternalConsumptionListDTO>` | List of internal-consumption entries. |
| GET | `api/WardSupply/InternalConsumptionDetailsById/{id}` | `List<WardSupplyInternalConsumptionDetailsDTO>` | Item-level details. |
| GET | `api/WardSupply/InternalConsumptionItemListById/{id}` | `List<WardSupplyInternalConsumptionItemListDTO>` | Compact item-only view. |
| POST | `api/WardSupply/InternalConsumption` | int (ConsumptionId) | Insert header + lines + FIFO stock decrement + PHRM_StockTransaction. |
| PUT | `api/WardSupply/InternalConsumption` | `{Status, Results}` | Update an internal-consumption line; re-balances stock and writes `WardConsumptionEdit` WARD_Transaction. |

### 6.6 Consumption (Inventory side)

| Method | Route | Returns | Notes |
|---|---|---|---|
| GET | `api/WardSupply/InventoryConsumptionItemList?StoreId=&UserName=` | `List<WardSupplyInventoryConsumptionItemListDTO>` | Inventory consumptions by user/store. |
| GET | `api/WardSupply/GetInventoryConsumptionList/{StoreId}/{FromDate}/{ToDate}` | anonymous list | Consumption by date range, excluding receipted ones. |
| GET | `api/WardSupply/GetInventoryPatConsumptionItemlistById/{ReceiptId}` | `{ ConsumeList, ConsumeRemarks }` | Items of a patient consumption receipt. |
| GET | `api/WardSupply/GetInventoryPatientConsumptionReceiptList/{StoreId}/{FromDate}/{ToDate}` | anonymous list | Receipts (header) for a sub-store in a date range. |
| POST | `api/WardSupply/InventoryConsumption` | `{Status, Results}` (consumption list) | Bulk insert inventory consumptions, FIFO stock decrement. |
| POST | `api/WardSupply/PostInvPatientConsumption` | `{Status, Results}` (consumption list) | Insert patient consumption receipt + lines + FIFO stock decrement. |

### 6.7 Stock Movements

| Method | Route | Returns | Notes |
|---|---|---|---|
| POST | `api/WardSupply/TransferStock/{ReceivedBy}` | `{Status, Results}` | Ward-to-ward transfer (`WARDStockModel` payload). |
| POST | `api/WardSupply/TransferInventoryStock` | `{Status, Results}` | Inventory-ward to inventory-ward transfer. |
| POST | `api/WardSupply/TransferBackToInventory` | `{Status, Results}` | Return to main inventory store. |
| POST | `api/WardSupply/BreakageStock` | `{Status, Results}` | Mark breakage, decrement stock. |
| POST | `api/WardSupply/ReturnStockToPharmacy/{ReceivedBy}` | `{Status, Results}` | Transfer list of WARDStockModel back to main pharmacy. |
| POST | `api/WardSupply/WardInventoryReturn` | serialized `DanpheHTTPResponse<object>` | Sub-store to inventory return (consumables + fixed assets). |

### 6.8 Returns

| Method | Route | Returns | Notes |
|---|---|---|---|
| GET | `api/WardSupply/GetWardInventoryReturnList/{FromDate}/{ToDate}/{SubStoreId}` | anonymous list | WARD_TXN_Return list for a sub-store. |
| GET | `api/WardSupply/GetWardInventoryReturnItemsByReturnId/{ReturnId}` | `{ returnDetail, returnItemDetails[] }` | Full return document with grouped fixed-asset barcodes. |

### 6.9 Reports (Pharmacy side)

| Method | Route | Notes |
|---|---|---|
| GET | `api/WardSupply/WARDStockItemsReport/{itemId}/{storeId}` | `SP_WardReport_StockReport` |
| GET | `api/WardSupply/WARDRequisitionReport/{FromDate}/{ToDate}/{StoreId}` | `SP_WardReport_RequisitionReport` |
| GET | `api/WardSupply/WARDBreakageReport/{FromDate}/{ToDate}/{StoreId}` | `SP_WardReport_BreakageReport` |
| GET | `api/WardSupply/WARDConsumptionReport/{FromDate}/{ToDate}/{StoreId}` | `SP_WardReport_ConsumptionReport` |
| GET | `api/WardSupply/WARDInternalConsumptionReport/{FromDate}/{ToDate}/{StoreId}` | `SP_WardReport_InternalConsumptionReport` |
| GET | `api/WardSupply/WARDTransferReport/{FromDate}/{ToDate}/{StoreId}` | `SP_WardReport_TransferReport` |

### 6.10 Reports (Inventory side)

| Method | Route | Notes |
|---|---|---|
| GET | `api/WardSupply/RequisitionDispatchReport/{FromDate}/{ToDate}/{StoreId}` | `SP_WardInv_Report_RequisitionDispatchReport` |
| GET | `api/WardSupply/Inventory/Reports/TransferReport/{FromDate}/{ToDate}/{StoreId}` | `SP_WardInv_Report_TransferReport` |
| GET | `api/WardSupply/ConsumptionReport/{FromDate}/{ToDate}/{StoreId}` | `SP_WardInv_Report_ConsumptionReport` |

### 6.11 Fixed-Asset Sub-Store

| Method | Route | Returns | Notes |
|---|---|---|---|
| GET | `api/WardSupplyAssets/GetFixedAssetStockBySubStoreId/{SubStoreId}` | anonymous list | Per-unit assets in the sub-store. |
| GET | `api/WardSupplyAssets/GetFixedAssetStockByStoreId/{StoreId}` | anonymous list | Per-unit assets in the main store with `SubStoreId IS NULL`. |
| GET | `api/WardSupplyAssets/GetCapitalGoodsItemList/` | `DanpheHTTPResponse<object>` (string) | All items with `ItemType = "Capital Goods"`. |
| GET | `api/WardSupplyAssets/GetSubstoreAssetRequistionList/{FromDate}/{ToDate}/{SubStoreId}` | anonymous list | Asset requisitions originating from this sub-store. |
| GET | `api/WardSupplyAssets/GetSubstoreAssetRequistionListByStoreId/{FromDate}/{ToDate}/{StoreId}` | anonymous list | Asset requisitions received by this main store. |
| GET | `api/WardSupplyAssets/GetSubstoreAssetRequistionItemsById/{RequisitionId}` | anonymous list | Lines of an asset requisition. |
| GET | `api/WardSupplyAssets/GetSubstoreAssetReturnList/{FromDate}/{ToDate}/{SubStoreId}` | anonymous list | Asset returns from a sub-store. |
| GET | `api/WardSupplyAssets/GetSubstoreAssetReturnListByStoreId/{FromDate}/{ToDate}/{StoreId}` | anonymous list | Asset returns received by a main store. |
| GET | `api/WardSupplyAssets/GetSubstoreAssetReturnById/{ReturnId}` | anonymous list | Lines of an asset return. |
| GET | `api/WardSupplyAssets/dispatchview/{RequisitionId}?storeId=` | anonymous list | Dispatch history for a requisition. |
| GET | `api/WardSupplyAssets/dispatchviewbyDispatchId/{DispatchId}?storeId=` | anonymous list | Dispatch details by dispatch id. |
| GET | `api/WardSupplyAssets/GetRequisitionDetailsForDispatch/{RequisitionId}` | `GetRequisitionDetailsForDispatchViewModel` | Helper for the dispatch screen. |
| GET | `api/WardSupply/GetFixedAssetDispatchListForItemReceive/{RequisitionId}` | `{ RequisitionDetail, DispatchDetail[] }` | Receive-list for assets. |
| POST | `api/WardSupplyAssets/AssetRequisition` | int (RequisitionId) | Create a new asset sub-store requisition. |
| POST | `api/WardSupplyAssets/PostStoreDispatch` | `{Status, Results}` | Main store dispatches assets to sub-store (with per-unit barcodes). |
| POST | `api/WardSupplyAssets/PostDirectDispatch` | `{Status, Results}` | One-shot create-req + dispatch (no waiting for verification). |
| PUT | `api/WardSupplyAssets/SendStockToCssd?FixedAssetStockId=...` | int (FixedAssetStockId) | Mark asset as pending-CSSD and write CssdItemTransaction. |

---

## 7. Cross-Module Integration

| Other module | How Ward Supply uses it |
|---|---|
| **Inventory** | All inventory sub-store flows write to `INV_TXN_StoreStock`, `INV_TXN_StockTransaction`, `INV_TXN_Requisition`, `INV_TXN_FixedAssetRequisition`, `INV_TXN_FixedAssetReturn`, `INV_TXN_FixedAssetDispatch`, `INV_TXN_FixedAssetStock`, `INV_AssetLocationHistory`, `INV_MST_Stock`. Read joins: `INV_MST_Item`, `INV_MST_ItemCategory`, `INV_MST_ItemSubCategory`, `INV_MST_UnitOfMeasurement`, `INV_MST_Vendor`, `INV_MST_Donation`, `INV_TXN_GoodsReceipt`, `INV_TXN_GoodsReceiptItems`, `INV_CFG_FiscalYears`. Helper `InventoryBL.CheckIfNewDispatchAvailable` is called from `GetSubStoreRequisitions`. The receive-stock confirmation logic reuses `WardSupplyBL.ReceiveDispatchedStocks` and `InventoryBL.ConfirmStockDispatched`/`ConfirmStockReceived` (via `StoreStockModel`). The dispatch endpoint also reuses the verification flow from `Services.Verification`. The reporting SPs live in the inventory reporting DbContext family. |
| **Pharmacy** | All pharmacy sub-store flows write to `PHRM_StoreRequisition`, `PHRM_StoreRequisitionItems`, `PHRM_StoreDispatchItems`, `PHRM_TXN_StoreStock`, `PHRM_TXN_StockTransaction`, `PHRM_CFG_FiscalYears`, `PHRM_TXN_InvoiceItems`. Read joins: `PHRM_MST_Store`, `PHRM_MST_Item`, `PHRM_MST_Generic`, `PHRM_MST_UnitOfMeasurement`, `PHRM_MST_Rack`, `PHRM_MAP_ItemToRack`. The patient-consumption flow is glued to the pharmacy invoice (`PHRM_TXN_InvoiceItems.InvoiceItemId`) so that an edit re-bills the patient. `ENUM_PHRM_StockTransactionType.PHRMSubStoreConsumption` is the canonical "internal consumption" event on the pharmacy side. The pharmacy main store id is discovered by `SubCategory == ENUM_StoreSubCategory.Pharmacy`. |
| **Nursing / ADT** | Reads `ADT_MST_Ward`, `ADT_PatientAdmission` (filtered by `AdmissionStatus == admitted`), `ADT_TXN_PatientBedInfo`, `PAT_Patient`, `PAT_PatientVisits`. The `WardSubStoresMap` join ties a patient on a bed back to a sub-store, so the patient consumption form auto-picks the right stock pool. |
| **RBAC** | `SubstoreBL` auto-creates `Rbac_Permission` and `Rbac_Role` rows whenever a new sub-store is created (via the settings module). The `Rbac_StoreVerificationMap` table defines verification levels. `WardSupplyController.GetVerifiers` returns the available role/user verifier pool. `WardSupplyBL.PostPhrmSubStoreRequisition` checks `VerifierIds` to set initial status. `Services.Verification.VerificationBL` is referenced for the verification flow (e.g. `GetNameByEmployeeId`, `GetNumberOfVerificationDone`). |
| **Verification** | The `TXN_Verification` table is the ledger of every verification event. `VerificationModel` is mapped in the same DbContext. |
| **CSSD** | `WardSupplyAssetsBL.SendAssetToCssd` writes a `CSSD_TXN_ItemTransaction` row and flips `FixedAssetStock.CssdStatus = "pending"`. The actual sterilization cycle is owned by the CSSD module (not in this controller). |
| **Fixed Asset** | The asset-side controllers share the `FixedAssetStockModel` (per-unit barcode), `FixedAssetDispatchModel` / `FixedAssetDispatchItemsModel`, `FixedAssetDonationModel`, and `AssetLocationHistoryModel` tables. `FixedAssetStockModel.Return(targetStoreId, currentUser, currentDate)` is called from `WardSupplyController.ReturnToInventory` for fixed-asset returns. |
| **Master / Settings** | Reads `MST_Department`, `MST_Ward`; relies on the settings module for sub-store CRUD and ward-substore map CRUD (`WardSubstoreMapManage*` components). |
| **Procurement** | Reads `INV_MST_Vendor`, `INV_TXN_GoodsReceipt`/`GoodsReceiptItems` to enrich asset-stock rows with vendor info. |
| **Caching / System parameters** | `WardSupplyBL.ReceiveDispatchedStocks` reads `CfgParameters` row `("Inventory", "EnableReceivedItemInSubstore")` to decide whether receive increases `AvailableQuantity` directly or just unconfirmed quantity. `ENUM_INV_StockTransactionType.PurchaseItem` / `OpeningItem` are used to identify the original store of a stock row during the reconciliation export. |

---

## 8. Business Rules

### 8.1 Stock decrement / increment

- Every stock-changing operation runs in a `dbContextTransaction`; on exception, `Rollback` is invoked and the exception is rethrown.
- Internal consumption (`PostInternalConsumption`) walks sub-store stock in **FIFO-by-batch+expiry** order and partially decrements each `StoreStock` row until the requested quantity is satisfied. The `PHRMStockTransaction` `TransactionType` is always `PHRMSubStoreConsumption`.
- Inventory-side consumption (`UpdateWardStockForConsumption`) uses the same FIFO logic but writes to `INV_TXN_StockTransaction` with `TransactionType = ConsumptionItem` and `needConfirmation = false`.
- Transfer-to-pharmacy uses `PHRM_TXN_StockTransaction.TransactionType = TransferItem` and routes via `PHRM_StoreDispatchItems`.
- Sub-store to inventory return uses `INV_TXN_StockTransaction.TransactionType = ReturnedItem` (source) and `ReturnedItemReceivingSide` (target).
- Reconciliation import uses `TransactionType = StockManageItem` with `needConfirmation = false` because it is a known correction, not a tentative move.
- All amounts use `Decimal(16, 4)` precision thanks to the `DecimalPropertyConvention(16, 4)` applied in `WardSupplyDbContext.OnModelCreating`.

### 8.2 Verifier / status flow

- A pharmacy sub-store requisition is created `pending` if the requester attached any verifier, otherwise it is `active`. The `VerifierIds` column is a JSON array of `{Id, Type}` (`Type` is `"role"` or `"user"`); it is serialized without spaces by `WardSupplyController.SerializeVerifiers`.
- A dispatch becomes receivable when any of its dispatch items have `ReceivedById IS NULL`. `GetSubStoreRequisitions.IsNewDispatchAvailable` is computed as `DGrouped.Any(d => d.ReceivedById == null)`.
- On receive (`ReceiveDispatchedStocks`), each dispatch item updates its source/target `StoreStock` via `ConfirmStockDispatched` (source) and `ConfirmStockReceived` (target). The `EnableReceiveFeature` flag on the parent `Requisition` is reset to `false` so a second receive is impossible without a fresh dispatch.
- `UpdateReceivedQuantityInRequisitionItems` is called after receive to bump `RequisitionItems.ReceivedQuantity` and the `PendingQuantity`/`RequisitionItemStatus` columns.

### 8.3 Asset dispatch rules

- `WardSupplyAssetsController.PostStoreDispatch` rejects any line missing `FixedAssetStockId`; each line updates exactly one `FixedAssetStock` row's `SubStoreId`.
- A requisition is `complete` only when **every** line is `complete`; otherwise `partial`. The controller iterates `WARDSupplyAssetRequisitionItemsModels` and computes the parent status on the fly.
- Each dispatched asset also writes an `AssetLocationHistoryModel` row (with `StartDate=now`, `OldStoreId=dispatch.StoreId`).
- Direct dispatch (`PostDirectDispatch` -> `DirectDispatch`) writes a self-`complete` requisition, then immediately writes the dispatch — the verification step is skipped.

### 8.4 Return-of-assets vs return-of-consumables

- A single `WARDInventoryReturnModel` can mix consumable and fixed-asset lines (`item.IsFixedAsset`).
- For fixed-asset lines, the controller calls `FixedAssetStockModel.Return(targetStoreId, ...)` for **each** unit (`ReturnAssets[i].FixedAssetStockId`).
- For consumable lines, the controller falls back to `StoreStockModel.DecreaseStock` + main-store `AddStock`.
- The composite key `WARD_TXN_ReturnItems_FixedAssetStock(ReturnItemId, FixedAssetStockId)` is what keeps a many-to-many join between the return-item table and the per-unit asset table.

### 8.5 Stock reconciliation

- Only the `NewAvailableQuantity` column is unlocked in the protected workbook; everything else (item code, batch, MRP, etc.) is read-only.
- `UpdateReconciledStockFromExcel` ignores `diff = 0`, posts positive diffs as `AddStock`, and negative diffs as `DecreaseStock`. Both use `needConfirmation = false`.

### 8.6 Patient consumption edit

- `PutPatientConsumption` finds the matching `PHRM_TXN_InvoiceItems` row by `consumption.InvoiceItemId`, then:
  - Updates `WARD_Consumption` (Quantity, SubTotal, ModifiedOn, ModifiedBy).
  - Re-bills the invoice (`SubTotal = Quantity * SalePrice`, `TotalAmount = SubTotal - DiscountPercent/100`).
  - Locates the `WARD_Stock` row for `(ItemId, BatchNo, ExpiryDate, SalePrice, StoreId)`.
  - If the new quantity is higher, decrements stock by the diff (and throws `"There is not enough Stock available."` if insufficient). If lower, increments stock by the diff.
  - Writes a `WARD_Transaction` row with `TransactionType = "WardConsumptionEdit"`, `InOut = "out"` or `"in"`, `IsWard = true`.

### 8.7 CfgParameter: EnableReceivedItemInSubstore

`ReceiveDispatchedStocks` reads this parameter (default false). If false, the receive uses `ConfirmStockDispatched` / `ConfirmStockReceived` (which only adjust the unconfirmed-quantity tracking). If true, the parameter gates a `RequisitionDetails.EnableReceiveFeature = false` reset (a security/audit concern, not a stock math change). Hospitals that have the toggle on get a "two-step receive" — first the items are flagged as dispatched, then the sub-store nurse has to mark them received.

### 8.8 Reporting SPs

- All nine reporting endpoints return raw `DataTable` (not strongly typed) and serialize via `DanpheJSONConvert.SerializeObject`. The stored procedures are:
  - `SP_WardReport_StockReport`
  - `SP_WardReport_RequisitionReport`
  - `SP_WardReport_BreakageReport`
  - `SP_WardReport_ConsumptionReport`
  - `SP_WardReport_InternalConsumptionReport`
  - `SP_WardReport_TransferReport`
  - `SP_WardInv_Report_RequisitionDispatchReport`
  - `SP_WardInv_Report_TransferReport`
  - `SP_WardInv_Report_ConsumptionReport`

### 8.9 Soft-deletion and active flags

- `PHRM_MST_Store.IsActive` controls whether a sub-store is selectable in dropdowns (`GET /ActiveSubstores`).
- `StoreStock.IsActive` filters consumable rows; the reconciliation export and the return flow both check this.
- `FixedAssetStock.IsActive` filters asset rows; `IsAssetScraped` and `IsAssetDamaged` further limit visibility.
- `WARDSupplyAssetRequisitionItemsModel.IsActive` is set to `true` on create; cancelling the parent requisition (`IsCancel = true` + `CancelRemarks`) does not auto-flip the lines, but each line can carry `CancelQuantity`, `CancelBy`, `CancelOn`, `CancelRemarks` for per-line cancellation.

### 8.10 Common gotchas

- The `Consumption` POST endpoint does **not** decrement stock. Callers that need stock decremented must use `PostInventoryConsumption` or `PostInvPatientConsumption`. The simple endpoint is purely a write to `WARD_Consumption` (and is useful for legacy flows that manage stock elsewhere).
- `UpdateWardStockForConsumption` is `public static` in `WardSupplyBL` and does not open its own transaction — callers must wrap it (`PostInventoryConsumption` and `PostInvPatientConsumption` do so).
- `GetSubStoreRequisitions` calls `InventoryBL.CheckIfNewDispatchAvailable` and `VerificationBL.GetNumberOfVerificationDone`; both require the inventory + verification contexts to be initialized by the caller (which is the case because `WardSupplyController` constructs them in its constructor).
- `WardSubStoresMAPModel` (WardSupplyModels folder) and `WardSubStoresMapModel` (MasterModels folder) are functionally identical but live in different namespaces. The settings UI consumes the MasterModels one; the ward-supply side reads the WardSupplyModels one. The DbContext maps both implicitly via EF conventions.
- The `[Key]` attribute on the two empty/legacy models (`WARDInventoryStockModel`, `WARDInventoryTransactionModel`) means they cannot be activated without re-introducing the commented fields. They are kept for documentation only.

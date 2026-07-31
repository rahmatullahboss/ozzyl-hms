# Dispensary Module

Source reference: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Dispensary/` (controllers), `DanpheEMR reference/Code/Websites/DanpheEMR/Services/Dispensary/` and `Services/DispensaryTransfer/` (services), `Code/Components/DanpheEMR.ServerModel/PharmacyModels/` (models), and `wwwroot/DanpheApp/src/app/dispensary/` (Angular SPA).

## 1. Module Overview

The Dispensary module is the **patient-facing point of sale and small-scale stock custody layer of the pharmacy subsystem**. A dispensary is a category of `PHRMStoreModel` (a `PHRM_Store` row with `Category = "dispensary"`) that lives alongside the main pharmacy store, sub-stores, and inventory stores. It is the place where:

- Outpatient (and some inpatient) sales billing happens (finalized via `PharmacySalesController` -> `PHRMInvoiceTransactionModel`).
- Inpatient consumption (ward consumption) is requested, finalized, and returned (via `PatientConsumptionController`).
- Stock is received from the main pharmacy store against a requisition, or transferred between dispensaries.
- Unused / leftover stock is returned to the main store.
- Counter-based cash collection is reported.

The Dispensary module proper (`Controllers/Dispensary/`, `Services/Dispensary/`, `Services/DispensaryTransfer/`) covers the four sub-flows the user explicitly asked about:

1. **Sub-store / dispensary CRUD** (create / edit / activate-deactivate dispensaries; auto-generate RBAC permission).
2. **Requisition** (a dispensary requests stock from the main pharmacy store; the main store then dispatches).
3. **Receive dispatched items** (target dispensary confirms receipt, which finalizes the stock movement).
4. **Stock transfer between dispensaries** (peer-to-peer) and **stock return to main store** (dispensary returns stock).

Sales, prescription handling, settlement, deposits, provisional billing, returns, write-offs, and reports live in their own controllers (`PharmacySalesController`, `PharmacySettlementController`, `PharmacyReportController`, `PatientConsumptionController`) and are documented in `34-pharmacy.md`. They share the `PHRM_Store` table and the dispensary's own `StoreId` is the routing key. This document focuses on the dispensary-specific controllers/services, the requisition/dispatch/receive/transfer state machine, and the data model that backs it.

Architectural style:

- ASP.NET MVC controllers (route-based) using `PharmacyDbContext` (Entity Framework 6). Each controller is dependency-injected with its `IDispensaryService` / `IDispensaryRequisitionService` / `IDispensaryTransferService` implementation.
- A `RbacDbContext` is used **only inside `AddDispensary`** to create a per-dispensary permission row, so the rest of the module is pure `PharmacyDbContext`.
- Frontend is a child Angular SPA under `DanpheApp/src/app/dispensary/`, lazily loaded via `DispensaryRoutingModule` and guarded by `DispensaryGuardService` (which forces the user to "activate" a dispensary before navigating inside it).
- Dispensary operations are tightly coupled to a `PHRM_StoreStockModel` row (per store, per stock master) and a `PHRM_StockTransactionModel` audit trail. Two unconfirmed-quantity columns (`UnConfirmedQty_In`, `UnConfirmedQty_Out`) are used to track in-flight stock during the dispatch/receive handshake.

Multi-tenancy and inventory topology: DanpheEMR does not have multi-tenant scoping in the same way the migration target does. The store table (`PHRM_Store`) is shared across the entire hospital, and the `StoreId` is the per-hospital dispensary identifier. In the Cloudflare migration the equivalent will be `tenant_id` on every row in `phrm_store`, `phrm_store_stock`, `phrm_stock_transaction`, `phrm_store_requisition`, `phrm_store_requisition_items`, `phrm_store_dispatch_items`.

Key business capabilities:

- Per-hospital dispensary CRUD with auto-generated RBAC permission tied to the dispensary name.
- Multi-mode payment (cash + configurable modes), controlled by the dispensary's `AvailablePaymentModesJSON` and `DefaultPaymentMode` (only dispensaries get payment modes; main stores do not).
- Two-step stock transfer (dispensary-to-dispensary, dispensary-to-main-store) using a virtual "unconfirmed" stock quantity to track in-flight transfers.
- Two-step requisition (request, dispatch, receive) with cancellation and approval flows.
- Inventory receipt number settings per dispensary (`INV_GRGroupId`, `INV_POGroupId`, `INV_PRGroupId`, `INV_ReqDisGroupId`, `INV_RFQGroupId`, `INV_ReceiptDisplayName`, `INV_ReceiptNoCode`).
- Cross-store stock visibility: `GetAllStoresForTransfer` returns any active store whose category is `dispensary` or main `store` (excluding inventory), so dispensary-to-dispensary transfer is symmetric and main-store return is supported.

## 2. Backend Files

### 2.1 Controllers

All under `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Dispensary/`.

| File | Lines | Route | Responsibility | Key methods |
|---|---|---|---|---|
| `DispensaryController.cs` | 107 | `api/Dispensary` | Dispensary CRUD + a couple of file-upload test endpoints. | `GET Dispensaries` -> `GetAllDispensaries`, `GET PharmacyStores` -> `GetAllPharmacyStores`, `GET GetDispensary?dispensaryId=` -> `GetDispensary(id)`, `POST NewDispensary` -> `AddDispensary`, `PUT PutDispensary` -> `UpdateDispensary`, `PUT ActivateDeactivate?dispensaryId=` -> `ActivateDeactivateDispensary`, `GET TestFileUpload`, `GET TestFileUpdate/{FileId}` (GoogleDriveFileUploadService probes - not part of the dispensary domain). |
| `DispensaryRequisitionController.cs` | 192 | `api/DispensaryRequisition` | Requisition lifecycle (request -> dispatch -> receive -> approve/cancel). | `GET` (list by date range), `GET Dispensary/{id}?FromDate=&ToDate=` (list per dispensary with receive flag), `GET {id}` (view), `GET GetItemsForRequisition/{IsInsurance}` (item picker), `GET RequisitionDispatchToReceive?RequisitionId=` (read pending dispatch for receive screen), `POST` (create), `PUT` (update - `NotImplementedException`), `PUT ReceiveDispatchedItems/{DispatchId}` (commit receipt), `PUT ApproveRequisition/{RequisitionId}`, `PUT CancelRequisitionItems` (cancel one or more items). |
| `DispensaryTransferController.cs` | 112 | `api/DispensaryTransfer` | Peer-to-peer transfer and return-to-main-store. | `GET {StoreId}` (transfer history for a store), `GET GetAllStoresForTransfer` (allowed target stores), `GET GetDispensariesStock/{DispensaryId}` (current stock of a dispensary), `POST` (transfer payload). |

Authorization on every controller: `[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]`, `[DanpheDataFilter()]` (the cross-cutting per-tenant or per-employee filter attribute), and attribute routing under `api/[controller]`. Auth is not enforced at the controller level for these endpoints - the responsibility is delegated to the global authentication middleware and the `DispensaryGuardService` on the frontend. The Cloudflare migration must add an explicit per-tenant JWT check and a role check that the caller is assigned to the dispensary in `rbac_user_store_map` (see business rules).

### 2.2 Services

| Service | Interface | Responsibility | Key methods |
|---|---|---|---|
| `DispensaryService` (`Services/Dispensary/DispensaryService.cs`, 201 lines) | `IDispensaryService` (`Services/Dispensary/IDispensaryService.cs`, 15 lines) | Dispensary CRUD. Joins `PHRMStore` with `Permissions` to expose `PermissionInfo`; creates a `RbacPermission` row inside the same DB transaction when a new dispensary is added. | `GetAllDispensaries`, `GetAllPharmacyStores`, `GetDispensary(int id)`, `AddDispensary(PHRMStoreModel)`, `UpdateDispensary(PHRMStoreModel)`, `ActivateDeactivateDispensary(int id)`. |
| `DispensaryRequisitionService` (`Services/Dispensary/DispensaryRequisitionService.cs`, 498 lines) | `IDispensaryRequisitionService` (`Services/Dispensary/IDispensaryRequisitionService.cs`, 22 lines) | Requisition lifecycle: list (with `CanApproveTransfer` flag computed from `VerifierIds`), item picker, view, create, dispatch-to-receive payload, **receive dispatched items** (the actual stock finalization), approve, cancel-items. | `GetAllAsync(FromDate,ToDate)`, `GetAllByDispensaryIdAsync(id,FromDate,ToDate)`, `GetRequisitionViewByIdAsync(id)`, `GetItemsForRequisition(IsInsurance)`, `AddDispensaryRequisition`, `UpdateDispensaryRequisition` (NotImplemented), `GetRequisitionDispatchToReceiveAsync`, `ReceiveDispatchedStocks(dispatchId, receivedRemarks, currentUser)`, `ApproveRequisition(requisitionId, currentUser)`, `CancelRequisitionItems(value, currentUser)`. |
| `DispensaryTransferService` (`Services/DispensaryTransfer/DispensaryTransferService.cs`, 426 lines) | `IDispensaryTransferService` (`Services/DispensaryTransfer/IDispensaryTransferService.cs`, 22 lines) | Peer-to-peer transfer (dispensary-to-dispensary) and return-to-main-store. **The controller's `POST` is a thin router** - it reads the target's `Category` from `PHRMStore` and dispatches to `ReturnToStore` (if target is `store`) or `DispensaryToDispensaryTransfer` (if target is `dispensary`). | `GetAllStoresForTransfer`, `GetAllDispensaryStocks(DispensaryId)`, `TransferStock(value, currentUser)`, `ReturnToStore(value, currentUser)`, `DispensaryToDispensaryTransfer(value, currentUser)`, `GetAllTransactionByStoreId(StoreId)`. |

### 2.3 Frontend organization (`wwwroot/DanpheApp/src/app/dispensary/`)

```
dispensary/
  dispensary.module.ts                         (NgModule, declares + providers)
  dispensary-routing.module.ts                 (route definitions; all sub-routes)
  activate-dispensary/                         (login-style component to choose which dispensary is "active")
    activate-dispensary.component.{ts,html,css}
  dispensary-main/                             (top-level layout - active dispensary bar, nav)
    dispensary-main.component.{ts,html,css}
    activate-counter/                          (counter activation inside a dispensary)
    patient-main/                              (patient list inside a dispensary)
    prescription-main/                         (prescription list)
    sales-main/                                (POS - new sale, list, return, settlement, etc.)
    stock-main/                                (stock list, requisition, transfer)
      stock-list/                              (StockListComponent)
      requisition/
        dispensary-requisition.service.ts
        dispensary-requisition-endpoint.ts
        requisition-list/
        requisition-add/
        requisition-view/
        receive-dispatched-stock/              (ReceiveDispatchedStockComponent)
      transfer-main/
        transfer.service.ts
        transfer-endpoint.service.ts
        transfer.model.ts                      (frontend StockTransferModel class)
        transfer-create/                       (TransferCreateComponent - the form)
        transfer-list/                         (TransferListComponent)
        transfer-view/                         (placeholder)
    reports-main/                              (narcotic daily, cash collection, user-wise, daily sales, settlement summary, payment mode)
  shared/
    dispensary.service.ts                      (DispensaryService - active dispensary state, list, CRUD)
    dispensary.endpoint.ts                     (DispensaryEndpoint - HTTP wrapper for /api/Dispensary)
    dispensary-guard.service.ts                (CanActivate - forces ActivateDispensary when none active)
    dispensary-grid.column.ts                  (grid column definitions for the module)
    DTOs/                                      (shared DTOs)
```

Routing entry: `/Dispensary` -> `DispensaryMainComponent` (guarded by `AuthGuardService` + `DispensaryGuardService`). Inside, the children are:

- `Patient` -> `PatientMainComponent` (list of patients seen in the dispensary)
- `Prescription` -> `PrescriptionMainComponent`
- `Sale` -> `SalesMainComponent` (default route; children: `List`, `New`, `Return`, `ReturnList`, `ReceiptPrint`, `CreditBills`, `Settlement` (with `PendingSettlements`, `SettlementReceipts`), `ProvisionalReturn`)
- `Stock` -> `StockMainComponent` (children: `StockDetails`, `Requisition` (List/Add/View/ReceiveStock), `Transfer` (List/Add/View))
- `PatientConsumptionMain` -> reuses the pharmacy patient-consumption module
- `Reports` -> per-report components
- `ActivateCounter` -> counter activation

Activate flow: `ActivateDispensaryComponent` (`/Dispensary/ActivateDispensary`) loads the dispensary list, filters to `IsActive == true`, and either auto-selects the only one or prompts the user. The chosen dispensary is stored in `DispensaryService._activeDispensary` and on the server in the security context via `/api/Security/ActivateDispensary?dispensaryId=...&dispensaryName=...`.

## 3. Data Models

All under `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/PharmacyModels/`.

### 3.1 Store and dispensary

- **PHRMStoreModel** (`PHRMStoreModel.cs`): PK `StoreId`. Shared with main store / sub-store / inventory; the dispensary is differentiated by `Category == "dispensary"`.
  - Fields: `Category` (`store` | `dispensary` | `substore`), `SubCategory` (`pharmacy` | `insurance` | `inventory` | ...), `ParentStoreId`, `Name`, `StoreDescription`, `PermissionId`, `MaxVerificationLevel`, `StoreLabel`, `PanNo`, `Code`, `Address`, `ContactNo`, `Email`, `UseSeparateInvoiceHeader`, `PrintInvoiceHeaderInDotMatrix`, `IsActive`, audit fields.
  - `[NotMapped] IsDispensary` => `Category == "dispensary"` (read-only).
  - `[NotMapped] bool IsInsuranceDispensary` (set on the client by `ENUM_DispensaryType.insurance`).
  - **PaymentModesSettings** (only available when `IsDispensary == true`):
    - `AvailablePaymentModesJSON` (private JSON column) - serialized list of `{ PaymentModeName, IsRemarksMandatory }`.
    - `DefaultPaymentMode` (private) - one of the names in the available list.
    - Computed `AvailablePaymentModes` deserializes the JSON; if blank, returns `[{ "cash" }]` for dispensaries and an empty list for non-dispensaries.
    - Methods: `AddPaymentMode`, `RemovePaymentMode`, `SetDefaultPaymentMode` - all throw `InvalidOperationException` if the store is not a dispensary.
  - **Inventory receipt numbers** (per dispensary, optional): `INV_GRGroupId`, `INV_POGroupId`, `INV_PRGroupId`, `INV_ReqDisGroupId`, `INV_RFQGroupId`, `INV_ReceiptDisplayName`, `INV_ReceiptNoCode`.
  - `[NotMapped] List<StoreVerificationMapModel> StoreVerificationMapList` - verification routing.
- **PaymentModesSettings** (`PHRMStoreModel.cs`): `PaymentModeName`, `IsRemarksMandatory`. Used by the dispensary's available-modes JSON column.
- **DispensaryDTO** (defined in `Services/Dispensary/DispensaryService.cs`): the wire shape returned by the dispensary list endpoint. Wraps `PHRMStoreModel` fields plus a `PermissionInfo` object (`{ name, actionOnInvalid: "remove" }`), `AvailablePaymentModes`, and `DefaultPaymentMode`. The actionOnInvalid: "remove" instructs the frontend to drop the dispensary from the in-memory list if its permission is revoked.
- **GetAllPharmacyStoresDto** (in the same file): `{ StoreId, Name }` - minimal payload for "select a pharmacy store or dispensary" dropdowns.

### 3.2 Requisition

- **PHRMStoreRequisitionModel** (`PHRMStoreRequisitionModel.cs`): PK `RequisitionId`. `FiscalYearId`, `RequisitionNo` (per-fiscal-year sequence), `StoreId` (the requesting store / dispensary), `RequisitionDate`, `RequisitionStatus` (`pending` | `partial` | `complete` | `cancelled`), `CreatedBy`, `CreatedOn`, `ApprovedBy`, `ApprovedOn`, `IsVerificationEnabled`, `VerifierIds` (CSV of verifier employee IDs), `VerificationId`, `CancelledBy`, `CancelledOn`, `CancelRemarks`, virtual `RequisitionItems`.
- **PHRMStoreRequisitionItemsModel** (`PHRMStoreRequisitionItemsModel.cs`): PK `RequisitionItemId`. `ItemId`, `Quantity` (requested), `ReceivedQuantity`, `PendingQuantity`, `RequisitionId`, `RequisitionItemStatus` (`pending` | `partial` | `complete` | `cancelled`), `Remark`, `AuthorizedBy`, `AuthorizedOn`, `AuthorizedRemark`, `CancelQuantity`, cancel fields, navigation `Requisition` and `Item`.
- **CanceRequisitionItemsQueryModel** (`Services/Dispensary/DispensaryRequisitionService.cs`): `{ RequisitionId, RequisitionItemIdList, CancelRemarks }` - body for `CancelRequisitionItems`.

### 3.3 Dispatch / transfer

- **PHRMDispatchItemsModel** (`PHRMDispatchItemsModel.cs`): PK `DispatchItemsId`. `DispatchId` (groups rows for one dispatch event), `SourceStoreId`, `TargetStoreId`, `ItemId`, `RequisitionId` (nullable - present for requisition-driven dispatches, null for direct dispensary-to-dispensary transfers), `RequisitionItemId`, `BatchNo`, `ExpiryDate`, `CostPrice`, `SalePrice`, `DispatchedQuantity`, `DispatchedDate`, `ReceivedBy` (free-text "Not Received" placeholder), `ItemRemarks`, `Remarks`, `ReceivedRemarks`, `CreatedBy`, `CreatedOn`, `ReceivedById` (EmployeeId of receiver - null until receive), `ReceivedOn`, `GenericId`, `PendingQuantity` (decimal; computed on receive). One row per item per batch per dispatch. Acts as both the "main store -> dispensary" dispatch record and the "dispensary -> dispensary" transfer record.
- **StockTransferModel** (`ViewModel/DispensaryTransfer/StockTransferModel.cs`): the POST body for `api/DispensaryTransfer`. Same fields as `PHRMDispatchItemsModel` plus `TransferredQuantity` and `TransferredDate`. `DispatchItemsId` is not required from the client when creating.
- **Frontend StockTransferModel** (`wwwroot/.../transfer-main/transfer.model.ts`): the Angular form model. Wraps the wire DTO with the auto-complete helpers (`SelectedItem`, `ItemName`, `AvailableQuantity`, `FromRack`, `RackNo`, `StoreRackName`, `StandardRate`, `IsDisQtyValid`) plus a reactive form validator (`StockTransferValidator`).

### 3.4 Stock master / per-store stock / transactions

- **PHRMStockMaster** (`PHRMStockMaster.cs`): PK `StockId`. Per (item, batch, expiry) row. `ItemId`, `BatchNo`, `ExpiryDate`, `CostPrice`, `SalePrice`, `MRP`, `BarcodeId`, audit fields, virtual `StoreStocks` and `StockBarcode`. Domain methods: `UpdateMRP`, `UpdateBatch`, `UpdateExpiry`, `ActivateStock`, `DeactivateStock`, `UpdateNewCostPrice`, `UpdateBarcodeId`. Implements `IEquatable<PHRMStockMaster>`.
- **PHRMStoreStockModel** (`PHRMStoreStockModel.cs`): PK `StoreStockId`. Pivot between a `PHRMStockMaster` and a `PHRMStore`. `StoreId`, `StockId`, `ItemId`, `AvailableQuantity`, `UnConfirmedQty_In`, `UnConfirmedQty_Out` (the in-flight stock), `CostPrice`, `SalePrice`, `IsActive`, virtual `StockMaster`. Methods enforce null-guard via constructor and provide `UpdateAvailableQuantity`, `IncreaseUnconfirmedQty`, `DecreaseUnconfirmedQty`, `UpdateNewCostPrice`, `UpdateMRP`. **SetInOutQuantity on the related transaction is what flips the unconfirmed counters** - this is the mechanism for "dispatched but not yet received" stock.
- **PHRMStockTransactionModel** (`PHRMStockTransactionModel.cs`): PK `StockTransactionId`. Audit log per (store, stock) movement. `TransactionDate`, `StoreId`, `StockId`, `StoreStockId`, `FiscalYearId`, `ItemId`, `BatchNo`, `ExpiryDate`, `TransactionType` (one of the `ENUM_PHRM_StockTransactionType` values), `InQty`, `OutQty`, `CostPrice`, `SalePrice`, `ReferenceNo` (the dispatch row's `DispatchItemsId`), `Remarks`, `IsActive`, `IsTransferedToAcc`, `CreatedBy`, `CreatedOn`. `SetInOutQuantity` enforces `in>0 XOR out>0` (no negatives, no zeros). The dispensary's transfer flow writes two of these per item (one for source out, one for target in).
- **ENUM_PHRM_StockTransactionType** (constants, not strictly a model class): values used by this module include `TransferItem`, `DispatchedItem`, `DispatchedItemReceivingSide`, `SubStoreDispatchTo` (all used in `DispensaryRequisitionService.ReceiveDispatchedStocks` to filter the stock-txns that get the "in-flight out" reversed and the "in-flight in" confirmed).

### 3.5 Item, generic, rack

- **PHRMItemMasterModel** (`PHRMItemMasterModel.cs`): the drug master. `ItemId`, `ItemName`, `ItemCode`, `CompanyId`, `ItemTypeId`, `UOMId`, `ReOrderQuantity`, `MinStockQuantity`, `BudgetedQuantity`, `PurchaseVATPercentage`, `SalesVATPercentage`, `IsVATApplicable`, `PackingTypeId`, `IsInternationalBrand`, `Dosage`, `Frequency`, `Duration`, `GenericId`, `ABCCategory`, `Rack`, `StoreRackId`, `SalesCategoryId`, `VED`, `CCCharge`, `IsNarcotic`, `IsInsuranceApplicable`, `GovtInsurancePrice`, `PurchaseRate`, `SalesRate`, `PurchaseDiscount`. Virtual `PHRM_MAP_MstItemsPriceCategories`.
- **PHRMGenericModel** (`PHRMGenericModel.cs`): PK `GenericId`. `GenericName`, `CategoryId`, `GeneralCategory`, `TherapeuticCategory`, `Counseling`, `IsAllergen`.
- **PHRMRackModel** (`PHRMRackModel.cs`): PK `RackId`. `ParentId` (self-ref for hierarchy), `StoreId`, `RackNo`, `Description`, `CreatedBy`, `CreatedOn`.
- **PHRM_MAP_ItemToRack** (`PHRM_MAP_ItemToRack.cs`): PK `MappingId`. `StoreId`, `RackId`, `ItemId`, `IsActive`, audit fields. Used by the transfer view to show "From Rack" and "To Rack".
- **PHRMPrescriptionModel** / **PHRMPrescriptionItemModel** (in the same folder): referenced by the prescription route - `PrescriptionId`, `PatientId`, `PrescriberId`, `Notes`, `PrescriberName`, `IsInPatient`, `PrescriptionStatus`. Items have `Dosage`, `Frequency`, `StartingDate`, `HowManyDays`, `OrderStatus`, `DiagnosisId`. Read by the dispensary's prescription list.

### 3.6 View models (return shapes from the services)

Under `ViewModel/Dispensary/`:

- **GetAllRequisitionVm**: `{ IList<GetAllRequisitionDTO> requisitionList }`. The DTO carries `RequisitionId`, `RequisitionNo`, `RequisitionDate`, `RequisitionStatus`, `CreatedByName`, `CanDispatchItem`, `CanApproveTransfer`, `RequistingStore`. The `CanApproveTransfer` flag is computed in the service: `true` when `RequisitionStatus == "pending" && VerifierIds == null` (i.e. came from a direct dispensary transfer rather than a multi-step verification workflow).
- **GetAllRequisitionByDispensaryIdVm**: same wrapper, with `GetAllRequisitionByDispensaryIdDTO` per row. Adds `IsReceiveFeatureEnabed` (from `CFGParameters` `Pharmacy.EnableReceiveItemsInDispensary`) and `IsNewDispatchAvailable` (true when at least one dispatch row for the requisition has `ReceivedById == null`).
- **GetItemsForRequisitionVm**: `{ List<GetItemsForRequisitionDto> ItemList }`. The DTO carries `ItemId`, `ItemName`, `ItemCode`, `GenericName`, `UOMName`, `AvailableQuantity`, `IsActive`. The service filters on the main pharmacy store's stock (`StoreId` where `Category == "store" && SubCategory == "pharmacy"`).
- **GetRequisitionViewVm**: `{ GetRequisitionViewDto requisition }`. The DTO is built from the request row joined with employee + store + a flatten of dispatch + requisition items, with `RequisitionItems: List<GetRequisitionItemViewDto>`. Each line item carries `RequestedQuantity`, `PendingQuantity`, `DispatchedQuantity`, `ReceivedQuantity`, `RequestedItemStatus`, `CancelledBy`, `CancelledOn`, `CancelRemarks`.

Under `ViewModel/DispensaryTransfer/`:

- **StockTransferModel**: the POST body for `api/DispensaryTransfer`. Carries `SourceStoreId`, `TargetStoreId`, `ItemId`, `BatchNo`, `ExpiryDate`, `CostPrice`, `SalePrice`, `TransferredQuantity`, `TransferredDate`, `ReceivedBy`, `ItemRemarks`, `Remarks`, `CreatedBy`, `CreatedOn`. `DispatchItemsId` and `DispatchId` are server-assigned on POST.
- **GetAllDispensaryStocksVm** (defined in `Services/DispensaryTransfer/DispensaryTransferService.cs`): row in the stock-list endpoint. `ItemId`, `GenericName`, `ItemName`, `BatchNo`, `ExpiryDate`, `SalePrice`, `CostPrice`, `AvailableQuantity`, `IsInsuranceApplicable`, `FromRack`. **Grouping** is per (item, batch, expiry, cost price, sale price, store) so multiple stock rows for the same item/batch collapse into one line.
- **GetAllTransactionByStoreIdDTO** (same file): row in the transfer list endpoint. `DispatchId`, `DispatchItemId`, `ItemId`, `ItemName`, `GenericName`, `BatchNo`, `ExpiryDate`, `TransferredQuantity`, `TransferredDate`, `TransferredBy`, `TransferredTo`, `ReceivedBy` (`"Not Received"` when null), `ItemRemarks`.

Under `Services/Dispensary/DTOs/`:

- **DispensaryAvailableStockDetail_DTO**: per-store, per-item, per-batch stock with `NormalSalePrice`, `IsNarcotic`, `IsVATApplicable`, `SalesVATPercentage`, `GenericId`. Used by the legacy `DispensaryAvailableStocksDetail` flow (the sales module).

Under `Services/Dispensary/DispensaryRequisitionService.cs` (file-local DTOs):

- **RequisitionDetail_DTO**: header.
- **DispatchDetail_DTO** + **DispatchItemDetail_DTO** + **RequisitionDispatchToReceive_DTO**: shape returned by `GetRequisitionDispatchToReceiveAsync`. The receive screen reads these to know which dispatch row to confirm.

## 4. Database Tables

All tables are SQL Server tables prefixed `PHRM_` and live in the schema mapped by `PharmacyDbContext`. The Cloudflare migration will replace these with SQLite tables in D1 (the `phrm_` prefix is the convention used in the rest of the project). Multi-tenant scoping will add a `tenant_id` column to every row in the migration.

| Table (SQL Server) | Cloudflare target | Purpose | Key columns |
|---|---|---|---|
| `PHRM_Store` | `phrm_store` | Master list of stores, dispensaries, sub-stores, and inventory stores. | `StoreId` (PK), `Category` (`store` \| `dispensary` \| `substore`), `SubCategory` (`pharmacy` \| `inventory` \| `insurance`), `ParentStoreId`, `Name`, `PermissionId` (FK to `RBAC_Permission`), `MaxVerificationLevel`, `StoreLabel`, `PanNo`, `Code`, `Address`, `ContactNo`, `Email`, `UseSeparateInvoiceHeader`, `PrintInvoiceHeaderInDotMatrix`, `AvailablePaymentModesJSON`, `DefaultPaymentMode`, `INV_GRGroupId`, `INV_POGroupId`, `INV_PRGroupId`, `INV_ReqDisGroupId`, `INV_RFQGroupId`, `INV_ReceiptDisplayName`, `INV_ReceiptNoCode`, `IsActive`, audit fields. |
| `PHRM_StoreRequisition` | `phrm_store_requisition` | Requisition header. | `RequisitionId` (PK), `FiscalYearId`, `RequisitionNo`, `StoreId` (requesting store), `RequisitionDate`, `RequisitionStatus`, `CreatedBy`, `CreatedOn`, `ApprovedBy`, `ApprovedOn`, `IsVerificationEnabled`, `VerifierIds`, `VerificationId`, `CancelledBy`, `CancelledOn`, `CancelRemarks`. |
| `PHRM_StoreRequisitionItems` | `phrm_store_requisition_items` | Requisition line items. | `RequisitionItemId` (PK), `RequisitionId` (FK), `ItemId`, `Quantity`, `ReceivedQuantity`, `PendingQuantity`, `RequisitionItemStatus`, `Remark`, `AuthorizedBy`, `AuthorizedOn`, `AuthorizedRemark`, `CancelQuantity`, `CancelledBy`, `CancelledOn`, `CancelRemarks`, `CreatedBy`, `CreatedOn`. |
| `PHRM_StoreDispatchItems` | `phrm_store_dispatch_items` | Every dispatch / transfer event (main store -> dispensary, dispensary -> dispensary, dispensary -> main store). | `DispatchItemsId` (PK), `DispatchId` (groups rows for one event), `SourceStoreId`, `TargetStoreId`, `ItemId`, `RequisitionId` (nullable), `RequisitionItemId` (nullable), `BatchNo`, `ExpiryDate`, `CostPrice`, `SalePrice`, `DispatchedQuantity`, `DispatchedDate`, `ReceivedBy` (free-text), `ItemRemarks`, `Remarks`, `ReceivedRemarks`, `CreatedBy`, `CreatedOn`, `ReceivedById`, `ReceivedOn`, `GenericId`, `PendingQuantity`. |
| `PHRM_StoreStock` | `phrm_store_stock` | Per-store, per-stock-master pivot. | `StoreStockId` (PK), `StoreId`, `StockId` (FK to `PHRM_StockMaster`), `ItemId`, `AvailableQuantity`, `UnConfirmedQty_In`, `UnConfirmedQty_Out`, `CostPrice`, `SalePrice`, `IsActive`. |
| `PHRM_StockMaster` | `phrm_stock_master` | Per (item, batch, expiry) master. | `StockId` (PK), `ItemId`, `BatchNo`, `ExpiryDate`, `CostPrice`, `SalePrice`, `MRP`, `BarcodeId`, `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`, `IsActive`. |
| `PHRM_StockTransaction` | `phrm_stock_transaction` | Append-only audit of every stock movement. | `StockTransactionId` (PK), `TransactionDate`, `StoreId`, `StockId`, `StoreStockId`, `FiscalYearId`, `ItemId`, `BatchNo`, `ExpiryDate`, `TransactionType` (`TransferItem`, `DispatchedItem`, `DispatchedItemReceivingSide`, `SubStoreDispatchTo`, ...), `InQty`, `OutQty`, `CostPrice`, `SalePrice`, `ReferenceNo` (dispatch row id), `Remarks`, `IsActive`, `IsTransferedToAcc`, `CreatedBy`, `CreatedOn`. |
| `PHRM_Rack` | `phrm_rack` | Per-store rack hierarchy. | `RackId` (PK), `ParentId`, `StoreId`, `RackNo`, `Description`, `CreatedBy`, `CreatedOn`. |
| `PHRM_MAP_ItemToRack` | `phrm_map_item_to_rack` | Maps an item to a rack per store. | `MappingId` (PK), `StoreId`, `RackId`, `ItemId`, `IsActive`, audit fields. |
| `PHRM_ItemMaster` | `phrm_item_master` | Drug master. | `ItemId` (PK), `ItemName`, `ItemCode`, `CompanyId`, `ItemTypeId`, `UOMId`, `GenericId`, `ReOrderQuantity`, `MinStockQuantity`, `BudgetedQuantity`, `PurchaseVATPercentage`, `SalesVATPercentage`, `IsVATApplicable`, `PackingTypeId`, `IsInternationalBrand`, `Dosage`, `Frequency`, `Duration`, `ABCCategory`, `Rack`, `StoreRackId`, `SalesCategoryId`, `VED`, `CCCharge`, `IsNarcotic`, `IsInsuranceApplicable`, `GovtInsurancePrice`, `PurchaseRate`, `SalesRate`, `PurchaseDiscount`, `IsActive`, audit fields. |
| `PHRM_Generic` | `phrm_generic` | Generic name lookup. | `GenericId` (PK), `GenericName`, `CategoryId`, `GeneralCategory`, `TherapeuticCategory`, `Counseling`, `IsAllergen`, `IsActive`, audit fields. |
| `PHRM_Prescription` | `phrm_prescription` | Doctor prescription header (referenced by the dispensary's prescription list). | `PrescriptionId` (PK), `PatientId`, `PrescriberId`, `Notes`, `PrescriberName`, `IsInPatient`, `PrescriptionStatus`, `CreatedBy`, `CreatedOn`. |
| `PHRM_PrescriptionItems` | `phrm_prescription_items` | Prescription line items. | `PrescriptionItemId` (PK), `PrescriptionId` (FK), `PatientId`, `PrescriberId`, `ItemId`, `Quantity`, `Frequency`, `StartingDate`, `HowManyDays`, `Notes`, `OrderStatus`, `Dosage`, `GenericId`, `DiagnosisId`, audit fields. |
| `RBAC_Permission` (cross-module) | `rbac_permission` | Auto-generated permission per dispensary. | `PermissionId` (PK), `PermissionName` (`dispensary-{Name}`), `Description`, `ApplicationId` (FK to RBAC_Application, `ApplicationCode = "DISP"`), `IsActive`, audit fields. |
| `CFGParameters` (cross-module) | `cfg_parameters` | Read for `EnableReceiveItemsInDispensary` feature flag. | `ParameterGroupName = "Pharmacy"`, `ParameterName = "EnableReceiveItemsInDispensary"`, `ParameterValue` (boolean). |
| `Employees` (cross-module) | `employees` | Used for `CreatedBy`, `ReceivedById`, `FullName` rendering. | standard employee fields. |

Tenant scoping note: the original DanpheEMR has a single-hospital model. For the migration the equivalent of the per-hospital `StoreId` lookup will be `tenant_id` + a `phrm_store` row filtered by `tenant_id` and `Category == "dispensary"`. The dispensary CRUD endpoints become `GET /api/tenant/{tenantId}/dispensaries`, etc. The activation endpoint (which sets "this is the active dispensary for the user's session") will be replaced by the tenant context - the active dispensary is a client-side concept, but the server enforces that the JWT's `tenant_id` matches the `StoreId`'s tenant in the `PHRM_Store` row.

## 5. Key Workflows

### 5.1 Dispensary activation and CRUD

1. User navigates to `/Dispensary`. `DispensaryGuardService` checks `DispensaryService.activeDispensary` and redirects to `/Dispensary/ActivateDispensary` if none is selected.
2. `ActivateDispensaryComponent` calls `DispensaryService.GetAllDispensaryList()` -> `GET /api/Dispensary/Dispensaries` -> `DispensaryService.GetAllDispensaries()`. Result is cached in `DispensaryService.dispensaryList`.
3. If exactly one active dispensary exists, the user is auto-logged in. Otherwise the user picks one and the service calls `DispensaryService.ActivateDispensary(storeId, name)` -> `PUT /api/Security/ActivateDispensary?dispensaryId=...&dispensaryName=...` (this is the security/SSO endpoint that stores the active dispensary in the user's session - it lives in the Security module, not in this controller, but the dispensary is the scope it activates).
4. The active dispensary is exposed on the client via `DispensaryService.activeDispensary` and `DispensaryService.isInsuranceDispensarySelected` (computed from `SubCategory == "insurance"`).

CRUD path: `AddDispensary(PHRMStoreModel)` (in `DispensaryService`) runs in a `RbacDbContext` transaction:
1. Create a new `RbacPermission` with `PermissionName = "dispensary-{name}"` and `ApplicationId` resolved from `Rbac_Application where ApplicationName == "Dispensary" && ApplicationCode == "DISP"`.
2. Look up the parent store id (`PHRMStore` where `Category == "store"`).
3. Set `dispensary.ParentStoreId = parentStoreId`, `dispensary.PermissionId = dispensaryPermission.PermissionId`, `dispensary.Category = "dispensary"` (controller enforces this in `NewDispensary`), `dispensary.CreatedOn = DateTime.Now`.
4. Save both rows, commit.
5. Return a `DispensaryDTO` (not the raw `PHRMStoreModel`) so the client can push it into the in-memory list without a re-fetch.

Update is straightforward (`db.Entry(value).State = EntityState.Modified` with the protected fields `CreatedBy`, `CreatedOn`, `AvailablePaymentModesJSON`, `DefaultPaymentMode` left untouched). Activate/Deactivate toggles `IsActive`.

### 5.2 Requisition (dispensary requests stock from main store)

1. `RequisitionAddComponent` loads `GET /api/DispensaryRequisition/GetItemsForRequisition/{IsInsurance}` (filter is the dispensary's `isInsuranceDispensarySelected` flag). The service:
   - Resolves the main pharmacy store id (`Category == "store" && SubCategory == "pharmacy"`).
   - Joins `PHRMItemMaster` with optional `PHRMUnitOfMeasurement`, `PHRMGenericModel`, and `StoreStocks` (filtered by main store, `AvailableQuantity > 0`, `IsActive = true`).
   - If `IsInsurance == true`, additionally requires `I.Item.IsInsuranceApplicable == true`.
   - Groups by `(ItemId, ItemName, ItemCode, GenericName, UOMName)` and sums `AvailableQuantity` per item.
2. User picks items, sets `Quantity`, saves.
3. `POST /api/DispensaryRequisition` with body `PHRMStoreRequisitionModel { RequisitionItems: [...] }` -> `AddDispensaryRequisition`. The service:
   - Strips `RequisitionItems` from the parent (so EF can insert the parent first and get the `RequisitionId`).
   - Sets `FiscalYearId = PharmacyBL.GetFiscalYear(db).FiscalYearId`.
   - Sets `RequisitionNo = max(RequisitionNo for this fiscal year) + 1` (computed in `GetCurrentFiscalYearRequisitionNo`).
   - Inserts the parent, then iterates items assigning `RequisitionId`, `CreatedOn = AuthorizedOn = DateTime.Now`, `PendingQuantity = Quantity` and inserting each.
   - Returns the new `RequisitionId`.
4. Main store user dispatches (lives in `PharmacyStockController.PostDrugRequsition` / `PostDirectDispatch` -> writes `PHRM_StoreDispatchItems` rows with `SourceStoreId = mainStore`, `TargetStoreId = dispensaryStoreId`, `RequisitionId` set, and creates two `PHRM_StockTransaction` rows - one for source out, one for target unconfirmed-in - plus increments `UnConfirmedQty_Out` on the source and `UnConfirmedQty_In` on the target).
5. Main store user may dispatch partially - the service layer updates `PHRM_StoreRequisitionItems.PendingQuantity` and `RequisitionItemStatus` to `partial` on partial dispatch, `complete` on full.

### 5.3 Receive dispatched items (the two-phase commit)

This is the critical synchronization step that turns unconfirmed stock into available stock.

1. Dispensary user opens the receive screen. The frontend stores the `RequisitionId` in `DispensaryRequisitionService.RequisitionId` and navigates to `Stock/Requisition/ReceiveStock`.
2. `ReceiveDispatchedStockComponent` calls `GET /api/DispensaryRequisition/RequisitionDispatchToReceive?RequisitionId=...` -> `GetRequisitionDispatchToReceiveAsync`. Returns `RequisitionDispatchToReceive_DTO` (header + per-dispatch group + per-dispatch-item with `BatchNo`, `ExpiryDate`, `DispatchedQuantity`, `PendingQuantity`, `RackNo` looked up from `PHRM_MAP_ItemToRack` for the target store).
3. User enters `ReceivedRemarks` and clicks Receive. Frontend calls `PUT /api/DispensaryRequisition/ReceiveDispatchedItems/{DispatchId}` with `ReceivedRemarks` as body.
4. `ReceiveDispatchedStocks` (in `DispensaryRequisitionService`) runs in a DB transaction:
   - Loads the dispatch items for the given `DispatchId`.
   - For each `dispatchedItem`, looks up its `PHRM_StockTransaction` rows where `ReferenceNo == DispatchItemsId` and `TransactionType` is one of `[TransferItem, DispatchedItem, DispatchedItemReceivingSide, SubStoreDispatchTo]` and `IsActive = true`.
   - Throws `Stock is already received.` if `ReceivedById != null`.
   - For each `stkTxn`, finds the `PHRM_StoreStock` row and:
     - If `stock.StoreId == dispatchedItem.SourceStoreId` (the source side), it confirms the out-quantity: `DecreaseUnconfirmedQty(inQty: 0, outQty: stkTxn.OutQty)`.
     - Otherwise (target side), it confirms the in-quantity: `UpdateAvailableQuantity(newQty: stock.AvailableQuantity + stkTxn.InQty)` and `DecreaseUnconfirmedQty(inQty: stkTxn.InQty, outQty: 0)`.
   - Updates the `PHRM_StoreDispatchItems` row: `ReceivedById = currentUser.EmployeeId`, `ReceivedOn = DateTime.Now`, `ReceivedRemarks = receivedRemarks`.
   - Commits.
5. Frontend reloads the dispatch list; if the row's `ReceivedById` is now set, it no longer appears as "new dispatch available".

### 5.4 Stock transfer between dispensaries (peer-to-peer)

1. `TransferCreateComponent` loads `GET /api/DispensaryTransfer/GetAllStoresForTransfer` (allowed targets: any active `PHRM_Store` where `Category == "dispensary"` OR `Category == "store" && SubCategory != "inventory"`) and `GET /api/DispensaryTransfer/GetDispensariesStock/{currentDispensaryId}`.
2. User picks a target store, an item, sets `TransferredQuantity`. The form enforces `TransferredQuantity <= AvailableQuantity` and prevents duplicate `(ItemId, BatchNo)` rows in the same transfer.
3. `POST /api/DispensaryTransfer` with body `List<StockTransferModel>` -> `TransferStock` (the controller's `POST` handler).
4. `TransferStock` (in `DispensaryTransferService`) reads the first item's `TargetStoreId`, looks up its `Category` from `PHRM_Store`, and routes:
   - If target is a main store (`Category == "store"`) -> `ReturnToStore`.
   - If target is a dispensary (`Category == "dispensary"`) -> `DispensaryToDispensaryTransfer`.
5. **`ReturnToStore`** (in `DispensaryTransferService`): generates a new `DispatchId` (max+1 across all stores), writes a `PHRM_StoreDispatchItems` row per transferred item, then for each item iterates the source dispensary's stock rows for that (item, batch, expiry), picks `AvailableQuantity` rows until the total transferred qty is satisfied, and for each stock row writes two `PHRM_StockTransaction` rows (source out, target unconfirmed-in) while updating `PHRM_StoreStock.AvailableQuantity`, `UnConfirmedQty_In` (target) and `UnConfirmedQty_Out` (source). **No new requisition is created for return-to-store** - the dispatch is the source-of-truth and the main store's stock simply grows. The returned `DispatchId` is what the `TransferListComponent` then queries for history.
6. **`DispensaryToDispensaryTransfer`**: creates a brand new `PHRM_StoreRequisition` row in the main store's name (`StoreId = transferStocks[0].TargetStoreId`, `RequisitionStatus = "pending"`, `RequisitionNo = max+1 for fiscal year`) plus one `PHRM_StoreRequisitionItems` row per item (with `Quantity == TransferredQuantity`, `ReceivedQuantity == TransferredQuantity`, `PendingQuantity = 0`, `RequisitionItemStatus = "pending"`). It also creates the corresponding `PHRM_StoreDispatchItems` rows (each referencing the new `RequisitionId`/`RequisitionItemId`) and runs the same stock-moving transaction logic as `ReturnToStore`. **The receiving dispensary then has a pending requisition with dispatched-but-not-received items that the next "Receive" click will finalize** - this is by design and lets the system reuse the existing requisition/receive state machine.
7. `TransferListComponent` (the per-store history grid) calls `GET /api/DispensaryTransfer/{StoreId}` -> `GetAllTransactionByStoreId(StoreId)` to show every transfer that originated at the current dispensary.

### 5.5 Approve and cancel requisition

- `PUT /api/DispensaryRequisition/ApproveRequisition/{RequisitionId}` -> `ApproveRequisition(requisitionId, currentUser)`:
  1. Sets `PHRM_StoreRequisition.RequisitionStatus = "complete"`, `ApprovedBy = currentUser.EmployeeId`, `ApprovedOn = DateTime.Now`.
  2. For every `PHRM_StoreRequisitionItems` row, sets `RequisitionItemStatus = "complete"`.
  3. Returns `RequisitionId`.
- `PUT /api/DispensaryRequisition/CancelRequisitionItems` with body `CanceRequisitionItemsQueryModel { RequisitionId, RequisitionItemIdList, CancelRemarks }`:
  1. For each `RequisitionItemId` in the list, set `CancelQuantity = PendingQuantity`, `PendingQuantity = 0`, `RequisitionItemStatus = "cancelled"`, `CancelledBy`, `CancelledOn`, `CancelRemarks`.
  2. Check if all items are complete or cancelled -> mark requisition `complete`. If all are cancelled -> mark requisition `cancelled`. (Both checks are independent; if all are cancelled, requisition ends as `cancelled`.)
  3. Commit.

### 5.6 Stock view (per dispensary)

`StockListComponent` (in `dispensary-main/stock-main/stock-list/`) calls `PharmacyBLService.GetAllItemsStockDetailsList()` (lives in the pharmacy module, returns every `(item, batch, store)` line across the system) and then client-side filters by `selectedStoreId` (the active dispensary). Each row is rendered with the `StockDetailsList` grid from `dispensary-grid.column.ts`; insurance dispensaries get a separate `InsuranceStockDetailsList` that swaps `SalePrice` for `GovtInsurancePrice`. Expiry is color-coded: red (`exp <= today`), yellow (`exp < today + 3 months`), white (otherwise). The `totalstockvalue` is the sum of `CostPrice` (note: this is a sum of unit costs, not unit cost * available qty, which is a known bug in Danphe).

## 6. API Endpoints

Base URLs: `https://hms-saas-production.rahmatullahzisan.workers.dev/api/Dispensary`, `/api/DispensaryRequisition`, `/api/DispensaryTransfer`. The `api/Security/ActivateDispensary`, `api/Security/ActiveDispensary`, `api/Security/DeactivateDispensary` endpoints live in the security module and are not in this controller.

### 6.1 Dispensary CRUD (`/api/Dispensary`)

| Method + Path | Body / Query | Service call | Returns | Notes |
|---|---|---|---|---|
| `GET /Dispensaries` | - | `DispensaryService.GetAllDispensaries` | `IList<DispensaryDTO>` | All dispensaries, joined with active permission. Each row has `PermissionInfo: { name, actionOnInvalid: "remove" }`, `AvailablePaymentModes`, `DefaultPaymentMode` (falls back to the first available mode name if no default is set). |
| `GET /PharmacyStores` | - | `DispensaryService.GetAllPharmacyStores` | `IList<GetAllPharmacyStoresDto>` | Returns all active main pharmacy stores AND all dispensaries, minimal `{ StoreId, Name }`. Used by dropdowns that need a combined list. |
| `GET /GetDispensary?dispensaryId={id}` | query | `DispensaryService.GetDispensary(id)` | `PHRMStoreModel` | Raw store row (not the DTO). |
| `POST /NewDispensary` | `PHRMStoreModel` | `DispensaryService.AddDispensary` | `DispensaryDTO` | The controller forces `value.Category = "dispensary"`. The service auto-creates the `RbacPermission` row and the parent-store mapping in one transaction. |
| `PUT /PutDispensary` | `PHRMStoreModel` | `DispensaryService.UpdateDispensary` | `PHRMStoreModel` | Preserves `CreatedBy`, `CreatedOn`, `AvailablePaymentModesJSON`, `DefaultPaymentMode`. |
| `PUT /ActivateDeactivate?dispensaryId={id}` | query | `DispensaryService.ActivateDeactivateDispensary` | `int` (the dispensary id) | Toggles `IsActive`. |
| `GET /TestFileUpload` | - | (not in service) | (test probe of `GoogleDriveFileUploadService`) | Not part of the dispensary domain. |
| `GET /TestFileUpdate/{FileId}` | route | (not in service) | (test probe) | Not part of the dispensary domain. |

### 6.2 Dispensary requisition (`/api/DispensaryRequisition`)

| Method + Path | Body / Query | Service call | Returns | Notes |
|---|---|---|---|---|
| `GET /` (with `?FromDate=&ToDate=`) | query | `DispensaryRequisitionService.GetAllAsync` | `GetAllRequisitionVm` | Lists every requisition in the date window. Each row carries `CanApproveTransfer` (true when `RequisitionStatus == "pending" && VerifierIds == null`). Sorted descending by date, then by `CanApproveTransfer` (false first so multi-step verification rows don't dominate), then by status. |
| `GET /Dispensary/{id}?FromDate=&ToDate=` | route + query | `GetAllByDispensaryIdAsync(id, ...)` | `GetAllRequisitionByDispensaryIdVm` | Lists requisitions for a specific dispensary. Reads `CFGParameters.Pharmacy.EnableReceiveItemsInDispensary` to populate `IsReceiveFeatureEnabed` on each row. `IsNewDispatchAvailable` is true when at least one `PHRM_StoreDispatchItems.ReceivedById == null` for the requisition. |
| `GET /{id}` | route | `GetRequisitionViewByIdAsync(id)` | `GetRequisitionViewVm` | Header + per-line items joined with item master, generic, cancelled-by employee, and per-line `DispatchedQuantity` / `ReceivedQuantity` aggregates. |
| `GET /GetItemsForRequisition/{IsInsurance}` | route | `GetItemsForRequisition(IsInsurance)` | `GetItemsForRequisitionVm` | Item picker for the requisition-add screen. Filters to main pharmacy store (`Category == "store" && SubCategory == "pharmacy"`); groups by (item, batch). If `IsInsurance == true`, only items with `IsInsuranceApplicable == true`. |
| `GET /RequisitionDispatchToReceive?RequisitionId={id}` | query | `GetRequisitionDispatchToReceiveAsync(RequisitionId)` | `RequisitionDispatchToReceive_DTO` | Header + per-dispatch-group with per-dispatch-item. Each item carries `RackNo` (looked up from `PHRM_MAP_ItemToRack` for the target store). |
| `POST /` | `PHRMStoreRequisitionModel` (with `RequisitionItems`) | `AddDispensaryRequisition` | `int` (new `RequisitionId`) | Auto-assigns `FiscalYearId`, `RequisitionNo` (per-fiscal-year sequence), `CreatedBy` (from session), `CreatedOn`, `AuthorizedOn`, `PendingQuantity = Quantity` per item. |
| `PUT /` | `PHRMStoreRequisitionModel` | `UpdateDispensaryRequisition` | `PHRMStoreRequisitionModel` | Throws `NotImplementedException`. |
| `PUT /ReceiveDispatchedItems/{DispatchId}` | route + body `string ReceivedRemarks` | `ReceiveDispatchedStocks(DispatchId, ReceivedRemarks, currentUser)` | `int` (`DispatchId`) | The two-phase-commit finalization. Idempotent: throws "Stock is already received." if `ReceivedById` is already set. |
| `PUT /ApproveRequisition/{RequisitionId}` | route | `ApproveRequisition(RequisitionId, currentUser)` | `int` (`RequisitionId`) | Forces `RequisitionStatus = "complete"` and marks every line item `complete`. Throws `KeyNotFoundException` if the requisition is missing. |
| `PUT /CancelRequisitionItems` | `CanceRequisitionItemsQueryModel` | `CancelRequisitionItems(value, currentUser)` | `bool` | Per-item cancellation. Re-computes the parent requisition status (`complete` if all done/cancelled, `cancelled` if all cancelled). |

### 6.3 Dispensary transfer (`/api/DispensaryTransfer`)

| Method + Path | Body / Query | Service call | Returns | Notes |
|---|---|---|---|---|
| `GET /{StoreId}` | route | `GetAllTransactionByStoreId(StoreId)` | `IList<GetAllTransactionByStoreIdDTO>` | History of every dispatch that originated at the given `StoreId`. Joins with item + generic + employee (sender) + employee (receiver, left join so unreceived rows show "Not Received"). |
| `GET /GetAllStoresForTransfer` | - | `GetAllStoresForTransfer` | `IList<PHRMStoreModel>` | All active stores where `Category == "dispensary" OR (Category == "store" && SubCategory != "inventory")`. Drives the target-store picker. |
| `GET /GetDispensariesStock/{DispensaryId}` | route | `GetAllDispensaryStocks(DispensaryId)` | `IList<GetAllDispensaryStocksVm>` | Stock on hand at the dispensary, grouped by (item, batch, expiry, cost, sale, store). `AvailableQuantity > 0` filter. `FromRack` from `PHRM_MAP_ItemToRack`. |
| `POST /` | `List<StockTransferModel>` | `TransferStock` -> `ReturnToStore` OR `DispensaryToDispensaryTransfer` | `int` (new `DispatchId`) | The body is the per-item list with `SourceStoreId` and `TargetStoreId` (same value for all items in a single transfer). The dispatcher picks the right path from the target's `Category`. Returns the new dispatch id (used as a route guard to the transfer list). |

## 7. Cross-Module

| Module | Direction | How it links |
|---|---|---|
| **Pharmacy** | bidirectional | `PHRM_Store` is shared. `PHRM_StoreStock`, `PHRM_StockMaster`, `PHRM_StockTransaction`, `PHRMItemMasterModel`, `PHRMGenericModel` are the master data for the dispensary. Sales billing, deposits, settlements, provisional billing, sales return, write-off, supplier return, and the legacy `reqType`-style endpoints all live in the pharmacy module. The dispensary's `StoreId` is the routing key on every pharmacy sales endpoint. The dispensary's "item picker" reads main pharmacy store stock (`Category == "store" && SubCategory == "pharmacy"`). The pharmacy's `PharmacyStockController.TransferToDispensary` is the upstream half of the two-step transfer - the dispensary side (`Services/DispensaryTransfer/`) is the return / peer-to-peer path. The dispensary reuses `PharmacyBL.GetFiscalYear`, `PharmacyBL.GetCurrentFiscalYearRequisitionNo`. |
| **Inventory** | reads | `PHRM_Store` rows with `Category == "store" && SubCategory == "inventory"` are excluded from the dispensary transfer target list (`GetAllStoresForTransfer` filters them out). The dispensary's `INV_*` receipt number fields are inventory-style settings that the inventory module can read to generate sequential GR/PR/PO/ReqDis/RFQ numbers for a dispensary. |
| **Patient** | reads | `PHRMPrescriptionModel` and `PHRMPrescriptionItemModel` are the source for the dispensary's prescription list. Dispensary sales (in `PharmacySalesController`) use `PHRMPatient` and the patient deposit/credit machinery. The dispensary's `patient-main` route reuses `PatientsBLService`. |
| **WardSupply / Substore** | sibling | Sub-stores (`Category == "substore"`) are a sibling concept used by inpatient supply. The dispensary module does not directly call ward supply, but the two `PHRM_StoreStock`-based workflows are architecturally identical. The `SubStoreDispatchTo` transaction type in `ENUM_PHRM_StockTransactionType` is what the receive flow looks for when finalizing a ward-supply dispatch. |
| **Security / RBAC** | writes + reads | `AddDispensary` creates a `RbacPermission` row with name `dispensary-{name}` and `ApplicationCode = "DISP"`. `DispensaryGuardService` on the frontend checks the active dispensary before allowing navigation. The `api/Security/ActivateDispensary` and `api/Security/ActiveDispensary` endpoints (in the security module) manage the session's active dispensary. Every controller method reads `RbacUser currentUser` from `HttpContext.Session.Get<RbacUser>("currentuser")` to fill `CreatedBy` / `ReceivedById` / `ApprovedBy` / `CancelledBy`. |
| **Master / Employee** | reads | `Employees` table is read to render `CreatedByName`, `FullName`, `ReceivedBy` strings in the requisition view and transfer history. |
| **Verification** | sibling | The verification module's `GetPharmacyRequisitionsBasedOnUser` reads `PHRM_StoreRequisition` (multi-step verification flow). The dispensary's `CanApproveTransfer` flag is `true` only when the requisition came from the dispensary's own flow (i.e. `VerifierIds == null`), so verification-routed requisitions are excluded from the dispensary's "approve" affordance. |
| **Configuration** | reads | `CFGParameters` row `Pharmacy.EnableReceiveItemsInDispensary` toggles whether the receive-items button shows in the requisition list. |
| **Reports** | sibling | `PharmacyReportController.PHRMTransferToDispensaryReport`, `PHRMTransferToStoreReport`, `PHRMDispensaryStoreStockReport` read the same tables (`PHRM_StoreStock`, `PHRM_StoreDispatchItems`, `PHRM_StoreRequisition`) to produce transfer and stock reports. The dispensary-specific reports under `dispensary-main/reports-main/` (narcotic daily sales, user-wise collection, cash collection summary, daily sales, settlement summary, payment-mode wise) call into `PharmacyReportController` via `PharmacyBLService`. |

## 8. Business Rules

1. **Store-category invariant.** A dispensary is a `PHRM_Store` row with `Category == "dispensary"` (set by `DispensaryController.NewDispensary`, not by the client). Insurance dispensaries additionally have `SubCategory == "insurance"` and trigger the `isInsuranceDispensarySelected` flag on the frontend, which restricts sale routes (`ProvisionalReturn`, `Settlement`, `CreditBills` are hidden).

2. **Auto-generated RBAC permission.** Every dispensary owns a `RbacPermission` row with `PermissionName = "dispensary-{dispensary.Name}"` and `ApplicationId` resolved from `Rbac_Application where ApplicationCode == "DISP"`. The `DispensaryDTO.PermissionInfo.actionOnInvalid = "remove"` instruction tells the frontend to drop the dispensary from the in-memory list when the permission is later revoked.

3. **Payment modes are dispensary-only.** `PHRMStoreModel.AddPaymentMode`, `RemovePaymentMode`, `SetDefaultPaymentMode` all throw `InvalidOperationException` if the store's `Category` is not `"dispensary"`. The default modes JSON is `[{ "cash" }]` for any dispensary whose `AvailablePaymentModesJSON` is blank.

4. **Inventory receipt numbers are per-dispensary.** The `INV_*` fields on `PHRMStoreModel` let each dispensary have its own receipt number series. The migration target should expose these as configurable per-tenant per-store settings, surfaced through the dispensary settings UI.

5. **Per-fiscal-year requisition numbering.** `GetCurrentFiscalYearRequisitionNo` increments the per-`FiscalYearId` max. The migration target must replicate this sequence (a D1 sequence is fine, or `MAX + 1` inside a transaction).

6. **Two-phase stock transfer.** Every transfer writes:
   - One `PHRM_StoreDispatchItems` row (or one per item, grouped by `DispatchId`).
   - One `PHRM_StockTransaction` row on the source store (out-quantity, `TransactionType = TransferItem`).
   - One `PHRM_StockTransaction` row on the target store (in-quantity, `TransactionType = TransferItem`).
   - The source's `PHRM_StoreStock.AvailableQuantity` is decremented and `UnConfirmedQty_Out` is incremented.
   - The target's `PHRM_StoreStock.UnConfirmedQty_In` is incremented (target's `AvailableQuantity` is NOT yet updated).
   This is the "in-flight" state. It is finalized by `ReceiveDispatchedStocks`, which reverses the unconfirmed counters and adds to the target's `AvailableQuantity`.

7. **Receiving is idempotent.** `ReceiveDispatchedStocks` throws `Stock is already received.` if any item in the dispatch already has `ReceivedById != null`. The frontend re-reads the dispatch list after the call and stops showing the row as "new dispatch available".

8. **Dispensary-to-dispensary transfer creates a hidden requisition.** The peer-to-peer flow creates a `PHRM_StoreRequisition` row in the main store's name (`StoreId = TargetStoreId`) with `RequisitionStatus = "pending"` and links the dispatch rows to it. The receiving dispensary then sees the items via the same receive-dispatched-items flow as a normal main-store-to-dispensary dispatch. This is the "create one row that both stores see" trick - it is not a separate workflow.

9. **Requisition item lifecycle.** `RequisitionItemStatus` flows `pending -> partial -> complete` based on dispatched quantity, or `pending -> cancelled` (via `CancelRequisitionItems`). The parent `RequisitionStatus` is recomputed from its items: if all are complete or cancelled -> `complete`; if all are cancelled -> `cancelled`.

10. **Approve guard for direct transfers.** `CanApproveTransfer` is `true` only when the requisition has `RequisitionStatus == "pending" && VerifierIds == null`. This excludes requisitions that are mid-verification (they will be approved by the verification module), and only allows the dispensary's direct-transfer flow to be approved at the dispensary level.

11. **Stock is per (item, batch, expiry, store).** `GetAllDispensaryStocks` groups on those five columns plus the cost/sale price. Transfer iterates the source store's stock rows in `AvailableQuantity > 0` order, draining the first row before moving to the next. **A single `TransferedQuantity` may consume multiple stock rows** if the rows are split across batches; the FEFO order is implicit (the rows are returned from SQL in their natural order and the loop simply walks the list).

12. **Negative / zero quantity guard on stock transaction.** `PHRMStockTransactionModel.SetInOutQuantity` enforces `in>0 XOR out>0` and rejects null/negative. This is what the "both in and out" or "neither in nor out" bugs in callers are caught by.

13. **Frontend-only "active dispensary" concept.** The active dispensary is a client-side state in `DispensaryService._activeDispensary` and a server-side session via `/api/Security/ActivateDispensary`. The server does not enforce that every dispensary-scoped endpoint checks the session's active dispensary - the migration target should add an explicit check in the JWT middleware: the JWT must carry a `storeId` claim that matches the `StoreId` in the request, and the user must have an `rbac_user_store_map` row for that store.

14. **Dispensary guard forces activation.** `DispensaryGuardService.canActivate` redirects to `/Dispensary/ActivateDispensary` if no active dispensary is set. The migration target's equivalent must be a tenant-scoped middleware that rejects `StoreId` access if the JWT's tenant does not own that store.

15. **Reorder-point awareness (read-only).** `PHRMItemMasterModel.ReOrderQuantity` and `MinStockQuantity` are present but the dispensary does not currently use them. The stock list view in the dispensary simply shows `AvailableQuantity`. The migration target should consider surfacing a "below reorder" badge in the stock list - this is a gap, not a bug.

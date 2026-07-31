# Module 21 — Inventory

> Reference documentation for the DanpheEMR Inventory module. Covers procurement, store / sub-store, fixed assets, donations, quotations, requisitions / dispatch, write-offs, returns, and stock management. The single source of truth for understanding the module without re-reading the .NET source code.

---

## 1. Module Overview

The Inventory module is the central procurement-and-stock engine of DanpheEMR. It manages the full lifecycle of physical items (consumables, capital goods, fixed assets) flowing into a hospital, through its stores and sub-stores, and out to departments.

The module is organized around the following sub-domains:

| Sub-domain | Purpose |
|---|---|
| **Procurement** | Vendor master, terms & conditions, Request For Quotation (RFQ), Quotation, Purchase Order (PO), PO Drafts. |
| **Goods Receipt (GR)** | Goods arrival notice (GAN), Goods Receipt Note (GRN), IMIR (Inspection), verification, and posting to stock. |
| **Stock** | Stock master (per batch / expiry / cost), per-store store-stock, FIFO consumption, reconciliation, and stock management. |
| **Internal Requisition & Dispatch** | Department/sub-store to store requests, multi-level verification, FIFO-based dispatch, direct dispatch, and return-from-substore. |
| **Write-Off & Return to Vendor** | Stock write-off (expired / damaged), credit-note-driven return to vendor with weighted-average cost recalculation. |
| **Donations** | Vendor-donated stock with reference numbers, donation goods-receipts. |
| **Fixed Assets** | Asset tagging (barcode per unit), location history, service history, contracts, insurance, depreciation, fault history. |
| **Reports** | Stock valuation, stock-level, daily-dispatch, comparison PO-GR, write-off, vendor transaction, fixed-asset movement, opening-stock valuation, substore summary, supplier-wise stock, ledger reports, and more. |
| **Settings** | Fiscal years, store groups, verification settings, parameters, other-charges, and admin-master entities. |

### Key design characteristics

- **Multi-store aware** — every transaction is scoped by `StoreId`; the same item can exist at different stores simultaneously (`INV_TXN_StoreStock`).
- **Per-batch stock** — `INV_MST_Stock` is a unique row per `(ItemId, BatchNo, ExpiryDate, CostPrice)`, with child `StoreStock` rows per store.
- **FIFO by expiry then receipt** — dispatch / write-off / return-to-vendor walk stock rows ordered by `ExpiryDate` and `CreatedOn`.
- **Fiscally grouped numbering** — every receipt/PR/PO/Quotation/RFQ/Dispatch number resets per fiscal year and per group (PRGroupId, POGroupId, GRGroupId, RFQGroupId, PODGroupId, ReqDisGroupId).
- **Verification as a service** — many flows (PO, GR, PR, Requisition) optionally route through the shared `TXN_Verification` model with role/user verifiers at multiple levels.
- **Two-tier costing** — costing is tracked in two layers: `StockMaster.CostPrice` (per batch) and `StoreStock.CostPrice` (per store-batch), recalculated on return-to-vendor.
- **Donation and procurement unified at GR** — `GoodsReceipt` has an `IsDonation`/`DonationId` flag so the same GR flow handles both purchased and donated items.
- **Fixed-Asset / Consumable split at GR** — when an item has `IsFixedAssets = true`, the receipt creates one row per unit in `INV_TXN_FixedAssetStock` with a unique barcode.

---

## 2. Backend File Layout

### 2.1 Controllers

All controllers live in `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Inventory/`.

| File | Lines | Purpose |
|---|---|---|
| `InventoryController.cs` | 4519 | The workhorse: vendors, items, terms, stores, POs, PRs, GRs, requisitions, dispatch, return-to-vendor, write-off, donations-fetch, quotations, RFQ, drafts, stock-manage, FIFO stock queries, stock reconciliation, fiscal-year queries, requisition tracking, return-from-substore. ~80 endpoints. |
| `InventoryCompanyController.cs` | 104 | Company master CRUD (`/api/InventoryCompany`). |
| `InventoryDonationController.cs` | 177 | Donation lifecycle (Get/Save/Update/Cancel). Routes mounted under `/api/donation/*` with `[DanpheDataFilter]` and request-size-limit attribute. |
| `InventoryEmailController.cs` | 63 | Simple email-sender wrapper (SendGrid). Hard-coded API key — see security notes. |
| `InventoryGoodReceiptController.cs` | 169 | GR service facade (List/Add/Update/ReceiveGoodsReceipt), other-charges lookup. Delegates to `IInventoryGoodReceiptService`. |
| `InventoryReportsController.cs` | 864 | Read-only reporting endpoints (all return JSON strings of `DanpheHTTPResponse`). 25+ report actions including stock-level, daily-dispatch, PO/GR summary, valuation, comparison, fixed-asset movement, expiry, vendor transaction, substore reports. |
| `InventorySettingViewController.cs` | 41 | Single MVC action that returns the inventory settings main view. |
| `InventorySettingsController.cs` | 1182 | Settings / master-data CRUD: vendors, items, categories, subcategories, UoM, packaging, account heads, currency, terms, other charges, and ledger-mapping. ~30 endpoints. |
| `InventoryViewController.cs` | 314 | MVC view-server actions for the main inventory pages (ExternalMain, InternalMain, StockMain, PurchaseOrderList, GoodsReceiptList, StockList, StockDetails, RequisitionList, WriteOffItems, ReturnToVendorItems, DispatchItems, etc.). RBAC-validates URL before returning view. |
| `ActivateInventoryController.cs` | 55 | Read-only endpoints (`GetAll`, `Get`) listing inventories available for activation per hospital. Delegates to `IActivateInventoryService`. |
| `InventoryBL.cs` | 1798 | Static business-logic helper class — not a controller. Houses `DispatchItemsTransaction`, `WriteOffItemsTransaction`, `ReturnToVendorTransaction`, `DirectDispatch`, `CancelPurchaseOrderById`, `CancelSubstoreRequisition`, `CancelGoodsReceipt`, `CancelPurchaseRequestById`, `CancelPurchaseOrderDraftById`, `GetFiscalYear`, `GetProcurementGRView`, `GetNewItemCode`, `GetNewVendorCode`, `UpdateReconciledStockFromExcel`, `ManageInventoryStock`, `UpdatePurchaseRequestWithItems`, `UpdatePurchaseOrderWithItems`, `CreateRequisitionForDirectDispatch`, `CreateNotificationForPRVerifiers`, `GetNameByEmployeeId`, `GetInventoryVendorNameById`, `IsUserAllowedToSeeRequisition`. |

### 2.2 Services

`DanpheEMR reference/Code/Websites/DanpheEMR/Services/Inventory/`

| Service | Purpose |
|---|---|
| `IInventoryGoodReceiptService` / `InventoryGoodReceiptService` | Goods-receipt creation, update, receive-into-stock (adds to `INV_MST_Stock` and `INV_TXN_StoreStock`), fixed-asset barcode generation, notifications. |
| `IInventoryReceiptNumberService` / `InventoryReceiptNumberService` | Sequence generators for Requisition No, Dispatch No, PR No, Goods Arrival No, GR No, PO No, PO Draft No, RFQ No, Quotation No. All grouped by `FiscalYearId` and a `*GroupId`. |
| `IInventoryCompanyService` / `InventoryCompanyService` | CRUD over `INV_MST_Company`. |
| `InventoryDonation` (folder) | Service used by `InventoryDonationController`: `IDonationService` exposes `GetVendorsThatReceiveDonation`, `GetAllDonation`, `GetDonationViewById`, `GetDonationById`, `SaveDonation`, `UpdateDonation`, `CancelDonation`. |
| `DTO/InventoryReports` (folder) | Report-DTO classes used by the reports controller (e.g. `INV_RPT_InventorySummaryReport_DTO`). |
| `DTO/InventoryRequisition`, `DTO/RequisitionDispatch` | DTOs for the requisition/dispatch API surface. |
| `DTO/WardSupply/Inventory/Requisition` | DTOs shared with WardSupply. |

### 2.3 DbContext

`DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/InventoryDbContext.cs`

The module's EF DbContext exposes ~55 `DbSet<>` properties and configures all inventory tables in `OnModelCreating`. All decimal columns are forced to `Decimal(16, 4)`.

### 2.4 Frontend

`DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/inventory/`

- `inventory.module.ts` — top-level Angular module. Imports `InventorySharedModule`, registers all inventory components and shared services.
- `inventory-routing.module.ts` — declares lazy routes for `Inventory/Dashboard`, `Inventory/InternalMain/...`, `Inventory/StockMain/...`, `Inventory/Donation/...`, `Inventory/ReturnToVendor/...`, `Inventory/Reports` (lazy), `Inventory/Settings` (lazy). Guarded by `AuthGuardService` and `ActivateInventoryGuardService`.
- `shared/` — `inventory.bl.service.ts`, `inventory.dl.service.ts`, `inventory.service.ts`, `inventory-shared.module.ts`, plus per-feature DTO/model files. `good-receipt/` subfolder contains the GR service/endpoint pair.
- `internal/` — requisition (`requisition-list`, `requisition-details`), dispatch (`dispatch-items`, `direct-dispatch`, `dispatch-receipt-details`), write-off (`write-off-items`, `write-off-items-list`), `purchase-request/` (PR list/add/detail), `return-from-substore/`, `track-requisition/`.
- `stock/` — stock-list, stock-details, stock-manage, stock-reconciliation, `goods-receipt-stock-list`, `goods-receipt-inv-view`, `goods-receipt-inv-np-view`.
- `return-to-vendor/` — list, add, view components.
- `donation/` — list, create, edit, view, form components + `donation.service.ts`.
- `reports/` — `InventoryReportsModule` (lazy). Routes: `Stock/*`, `Purchase/*`, `Supplier/*`. Each sub-folder is a report.
- `settings/` — separate lazy `InventorySettingsModule` for company, item, category, UoM, mapping screens.

---

## 3. Data Models (Server-Side)

All models live in `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/InventoryModels/`. The most important are summarized below. `[Key]` indicates the primary key; `[NotMapped]` indicates a client-only convenience property.

### 3.1 Masters / Configuration

| Model | Key | Purpose | Notable fields |
|---|---|---|---|
| `ItemMasterModel` | `ItemId` | The single most-referenced entity: an item definition. | `Code`, `ItemName`, `ItemType`, `ItemCategoryId`, `SubCategoryId`, `UnitOfMeasurementId`, `PackagingTypeId`, `VendorId`, `StandardRate`, `VAT`, `MinStockQuantity`, `ReOrderQuantity`, `BudgetedQuantity`, `MSSNO`, `HSNCODE`, `IsVATApplicable`, `IsCssdApplicable`, `IsColdStorageApplicable`, `IsPatConsumptionApplicable`, `IsFixedAssets`, `RegisterPageNumber`, `StoreId` (null = common to all stores). |
| `VendorMasterModel` | `VendorId` | Supplier / donor master. | `VendorName`, `VendorCode` (5-digit zero-padded, auto-generated by `GetNewVendorCode`), `ContactPerson`, `ContactAddress`, `ContactNo`, `Email`, `PanNo`, `SARFNo`, `GovtRegDate`, `Tds`, `IsTDSApplicable`, `CreditPeriod`, `DefaultCurrencyId`, `DefaultItemJSON` (NotMapped to `List<int>`), `ReceiveDonation`, `BankDetails`, `CompanyPosition`/`Name`/`PhoneNumber` (two contact rows). |
| `ItemCategoryMasterModel` | `ItemCategoryId` | Broad category (e.g. Capital Goods, Consumables). | `ItemCategoryName`, `CategoryCode`, `IsActive`. |
| `ItemSubCategoryMasterModel` | `SubCategoryId` | Sub-category that drives item-code generation. | `Code`, `SubCategoryName`, `IsConsumable`, `LedgerId` (link to accounting ledger), `LedgerType` (NotMapped). |
| `UnitOfMeasurementMasterModel` | `UOMId` | UoM (pcs, box, kg…). | `UOMName`. |
| `PackagingTypeMasterModel` | `PackagingTypeId` | Packaging type. | `PackagingType`. |
| `AccountHeadMasterModel` | `AccountHeadId` | Accounting-head link. | `AccountHeadName`, `IsActive`. |
| `CurrencyMasterModel` | `CurrencyID` | Currency code. | `CurrencyCode`, `Description`. |
| `InventoryTermsModel` | `TermsId` | Terms-and-conditions templates. | `Terms`, `TermsApplicationEnumId`, `CreatedOn`. |
| `InventoryCompanyModel` | `CompanyId` | Manufacturer/company master. | `CompanyName`, `Code`, `ContactAddress`, `Email`. |
| `InventoryFiscalYear` | `FiscalYearId` | Inventory-side fiscal year. | `FiscalYearName`, `NpFiscalYearName`, `StartDate`, `EndDate`, `IsActive`, `IsClosed`. Separate from billing fiscal year. |
| `InventoryFiscalYearStock` | — | Snapshot of stock value at a fiscal-year boundary. | `FiscalYearId`, `ItemId`, `StockQty`, `Value`. |
| `InventoryChargesMasterModel` | `ChargeId` | Other-charges master (e.g. Carriage, Packing, Insurance). | `ChargeName`, `Description`, `IsActive`. |
| `MAP_GoodsReceipt_OtherCharges` | `Id` | GR-level charge header lines. | `GoodsReceiptID`, `ChargeId`, `TotalAmount`. |
| `MAP_GoodsReceiptItems_OtherCharges` | `Id` | GR-item-level charge lines. | `GoodsReceiptItemId`, `ChargeId`, `VendorId`, `Amount`, `VATPercentage`, `VATAmount`, `TotalAmount`. |
| `MAP_DispatchItems_FixedAssetStock` | composite | Dispatch → asset link. | `DispatchItemsId`, `FixedAssetStockId`. |
| `FixedAssetDonationModel` | `DonationId` | Lookup of donation types. | `Donation`. |

### 3.2 Procurement (Vendor ↔ PO ↔ GR)

| Model | Key | Purpose | Notable fields |
|---|---|---|---|
| `PurchaseRequestModel` | `PurchaseRequestId` | The procurement request (the start of a PO). | `PRNumber`, `VendorId`, `RequestDate`, `RequestStatus` (`active`/`partial`/`complete`/`withdrawn`/`cancelled`/`pending`), `VerificationId`, `IsActive`, `IsPOCreated`, `PRCategory`, `StoreId`, `PRGroupId`, `FiscalYearId`. |
| `PurchaseRequestItemModel` | `PurchaseRequestItemId` | Line items of a PR. | `PurchaseRequestId`, `ItemId`, `RequestedQuantity`, `PendingQuantity`, `VendorId`, `Remarks`, `RequestItemStatus`, `IsActive`, `CancelledBy`/`On`/`Remarks`. |
| `PurchaseOrderModel` | `PurchaseOrderId` | The PO header. | `RequisitionId` (optional, populated if from requisition), `VendorId`, `PoDate`, `DeliveryDate`, `POStatus` (`pending`/`active`/`partial`/`complete`/`cancelled`/`withdrawn`), `PerformanceInvoiceNo`, `SubTotal`, `TotalAmount`, `VAT`, `PORemark`, `TermsConditions`, `IsCancel`, `CancelledBy`/`On`/`Remarks`, `CurrencyId`, `VerifierIds`, `IsVerificationEnabled`, `VerificationId`, `POCategory`, `StoreId`, `POGroupId`, `PONumber`, `ReferenceNo`, `InvoicingAddress`, `DeliveryAddress`, `ContactPersonName`/`Email`, `PaymentMode`. |
| `PurchaseOrderItemsModel` | `PurchaseOrderItemId` | PO line items. | `PurchaseOrderId`, `ItemId`, `Quantity`, `StandardRate`, `TotalAmount`, `ReceivedQuantity`, `PendingQuantity`, `DeliveryDays`, `AuthorizedBy`/`On`/`Remark`, `POItemStatus`, `POItemSpecification`, `VATAmount`, `VatPercentage`, `IsActive`, `CancelledBy`/`On`/`Remarks`, `ItemCategory`, `VendorItemCode`. |
| `PurchaseOrderDraftModel` | `DraftPurchaseOrderId` | A draft PO saved mid-creation. | `DraftPurchaseOrderNo`, `VendorId`, `CurrencyId`, `DeliveryDate`, `SubTotal`, `TotalAmount`, `Status` (`Active`/`InProgress`/`Completed`/`Discarded`), `DiscardedBy`/`On`/`Remarks`, `IsActive`, `PODGroupId`, `FiscalYearId`. |
| `PurchaseOrderDraftItemModel` | `DraftPurchaseOrderItemId` | Lines of a PO draft. | `DraftPurchaseOrderId`, `ItemId`, `Quantity`, `ItemRate`, `ItemCategory`, `SubTotal`, `TotalAmount`, `VATAmount`/`Percentage`, `IsActive`, `IsDiscarded`. |
| `GoodsReceiptModel` | `GoodsReceiptID` | GR header (Goods Arrival + Receipt + Verification). | `IsCancel`, `GoodsArrivalNo`, `GoodsReceiptNo`, `GoodsArrivalDate`, `GoodsReceiptDate`, `VendorBillDate`, `BillNo`, `PurchaseOrderId`, `VendorId`, `ReceiptNo`, `TotalAmount`, `SubTotal`, `VATTotal`, `TDSRate`/`Amount`/`TotalWithTDS`, `CcCharge`, `Discount`/`Amount`, `PaymentMode`, `CreditPeriod`, `OtherCharges`, `InsuranceCharge`, `CarriageFreightCharge`, `PackingCharge`, `TransportCourierCharge`, `OtherCharge`, `MaterialCoaDate`/`No`, `IsTransferredToACC`, `IsDonation`, `DonationId`, `IsSupplierApproved`, `IsDeliveryTopClosed`, `IsBoxNumbered`, `GRStatus` (`active`/`pending`/`verified`/`cancelled`), `IsVerificationEnabled`, `VerifierIds`, `VerificationId`, `ReceivedBy`/`On`/`Remarks`, `StoreId`, `GRGroupId`, `IsPaymentDoneFromAcc`, `IMIRNo`/`Date`, `CancelledBy`/`On`/`CancelRemarks`. |
| `GoodsReceiptItemsModel` | `GoodsReceiptItemId` | GR line items. | `GoodsReceiptId`, `ItemId`, `BatchNO`, `ExpiryDate`, `ArrivalQuantity`, `ReceivedQuantity`, `FreeQuantity`, `RejectedQuantity`, `ItemRate`, `VAT`/`Amount`, `TotalAmount`, `SubTotal`, `MRP`, `DiscountPercent`/`Amount`, `CcCharge`/`Amount`, `OtherCharge`, `CostPrice`, `GRItemDate`, `ManufactureDate`, `SamplingDate`/`Quantity`/`Boxes`, `SampleRemoved`, `NoOfBoxes`, `IdentificationLabel`, `IsSamplingLabel`, `MaterialNO`, `StockId`, `StoreStockId`, `GRItemSpecification`, `Remarks`, `ItemCategory` (`Capital Goods` / `Consumables` / etc.), `CounterId`, `IsActive`, `CancelledBy`/`On`. |
| `RequestForQuotation` | `ReqForQuotationId` | RFQ header. | `Subject`, `Description`, `RequestedBy`, `RequestedOn`, `RequestedCloseOn`, `Status` (`active`/`Finalised`/`cancelled`), `StoreId`, `RFQGroupId`, `RequestForQuotationNo`, `FiscalYearId`. |
| `RequestForQuotationItem` | `ReqForQuotationItemId` | RFQ lines. | `ReqForQuotationId`, `ItemId`, `ItemName`, `Description`, `Quantity`, `Price`. |
| `RequestForQuotationVendor` | `ReqForQuotationVendorId` | RFQ ↔ vendor list. | `ReqForQuotationId`, `VendorId`, `CreatedBy`/`On`. |
| `Quotation` | `QuotationId` | Vendor response to RFQ. | `ReqForQuotationId`, `VendorId`, `VendorName`, `IssuedDate`, `Status` (`selected`/`rejected`/`pending`), `StoreId`, `RFQGroupId`, `QuotationNo`, `FiscalYearId`. |
| `QuotationItems` | `QuotationItemId` | Quotation lines. | `QuotationId`, `ItemId`, `ItemName`, `Description`, `Price`, `UpLoadedOn`/`By`, `VendorId`. |
| `QuotationUploadedFiles` | `QuotationUploadedFileId` | Files attached to quotations. | `RequestForQuotationId`, `VendorId`, `FileName`, `FileNo`, `FileBinaryData` (varbinary), `FileExtention`, `FileType`, `Description`, `UpLoadedOn`/`By`, `ROWGUID`. |

### 3.3 Stock

| Model | Key | Purpose | Notable fields |
|---|---|---|---|
| `StockMasterModel` | `StockId` | One row per `(ItemId, BatchNo, ExpiryDate, CostPrice)`. Domain methods: `UpdateMRP`, `UpdateBatch`, `UpdateExpiry`, `UpdateSpecification`, `UpdateCostPrice`, `ActivateStock`, `DeactivateStock`. | `ItemId`, `BatchNo`, `ExpiryDate`, `CostPrice`, `MRP`, `Specification`, `CreatedBy`/`On`, `ModifiedBy`/`On`, `IsActive`. Implements `IEquatable`. |
| `StoreStockModel` | `StoreStockId` | Per-store stock balance for a `StockMaster` row. | `StoreId`, `StockId`, `ItemId`, `SellingPrice`, `AvailableQuantity`, `UnConfirmedQty_In`/`Out` (used when "receive feature" is on), `CostPrice`, `IsActive`. Domain methods: `AddStock`, `DecreaseStock`, `ConfirmStockReceived`, `ConfirmStockDispatched`, `ConfirmStockDecrease`, `UpdateCostPrice`. |
| `StockTransactionModel` | `StockTransactionId` | Immutable ledger row per in/out movement. | `TransactionDate`, `StoreId`, `StockId`, `StoreStockId`, `FiscalYearId`, `ItemId`, `BatchNo`, `ExpiryDate`, `TransactionType` (enum string — see below), `InQty`, `OutQty`, `CostPrice`, `MRP`, `ReferenceNo`, `Remarks`, `IsActive`, `IsTransferredToACC`, `CreatedBy`/`On`. Domain: `SetInQuantity`, `SetOutQuantity`, `UpdateTransactionDate`. |
| `InventoryStockModel` | (DTO) | For reconciliation. | `StockId`, `ItemId`, `ItemName`, `BatchNo`, `AvailQuantity`, `NewQuantity`, `CostPrice`, `ItemCode`, `ItemType`, `SubCategoryName`, `UOMId`/`Name`, `StoreId`. |
| `InventoryStockManage` | (DTO) | For in-place stock adjustment. | `StockId`, `StoreId`, `BatchNo`, `CostPrice`, `ExpiryDate`, `ModQuantity`, `InOut` (`in`/`out`). |
| `InventoryStockIds` | (DTO) | Returned from `AddtoInventoryStock`. | `StockId`, `StoreStockId`. |

**Transaction types** (from `ENUM_INV_StockTransactionType`, used in `StockTransaction.TransactionType`):
`PurchaseItem`, `PurchaseReturnedItem`, `CancelledGR`, `WriteOffItem`, `StockManageItem`, `DispatchedItem`, `DispatchedItemReceivingSide`, `ReturnedItem`, `ReturnedItemReceivingSide`.

### 3.4 Internal Requisition & Dispatch

| Model | Key | Purpose | Notable fields |
|---|---|---|---|
| `RequisitionModel` | `RequisitionId` | Internal request from a sub-store/department to a main store. | `RequestFromStoreId`, `RequestToStoreId`, `DepartmentId`, `RequisitionDate`, `RequisitionStatus` (`pending`/`active`/`partial`/`complete`/`cancelled`/`withdrawn`), `RequisitionNo`, `IssueNo`, `MatIssueDate`, `MatIssueTo`, `IsCancel`, `CancelRemarks`, `VerificationId`, `VerifierIds`, `IsVerificationEnabled`, `MaxVerificationLevel`, `CurrentVerificationLevel`/`Count`, `IsDirectDispatched`, `EnableReceiveFeature`, `ReqDisGroupId`, `FiscalYearId`. |
| `RequisitionItemsModel` | `RequisitionItemId` | Requisition line. | `ItemId`, `Quantity`, `ReceivedQuantity`, `PendingQuantity`, `RequisitionItemStatus` (`active`/`partial`/`complete`/`initiated`/`cancelled`), `RequisitionNo`, `IssueNo`, `CancelQuantity`/`On`/`By`/`Remarks`, `IsActive`, `ItemCategory`, `Specification`, `CostPrice`, `MSSNO`, weekly distribution fields. |
| `DispatchModel` | `DispatchId` | Stock transfer header. | `RequisitionId`, `FiscalYearId`, `DispatchNo`, `SourceStoreId`, `TargetStoreId`, `ReceivedBy`/`On`/`Remarks`, `ReqDisGroupId`. |
| `DispatchItemsModel` | `DispatchItemsId` | Stock transfer line. | `RequisitionId`, `RequisitionItemId`, `ItemId`, `DispatchedQuantity`, `DispatchedDate`, `BatchNo`, `SourceStoreId`, `TargetStoreId`, `ReceivedById`/`On`/`Remarks`, `StoreStockId`, `ItemCategory`, `Specification`, `IsFixedAsset`, `DispatchedAssets` (list of `MAP_DispatchItems_FixedAssetStock`), `CostPrice`. |
| `RequisitionStockVM` | (DTO) | Returned from `GetRequisitionDetailById`. | Wraps `RequisitionModel` plus per-item `AvailableQuantity` and (for fixed assets) `BarCodeList`. |
| `RequisitionsStockVM` | (DTO) | Used by "Dispatch All" feature. | `requisitions`, `dispatchItems`, `reqDeptList` (list of `RequisiteDeptpair`). |
| `BarCodeNumberDTO` | (DTO) | Per fixed-asset barcode. | `BarCodeNumber`, `StockId`. |
| `ReturnFromSubstore` | `ReturnId` | Sub-store → store return header. | `SourceStoreId`, `TargetStoreId`, `ReturnDate`, `ReceivedBy`/`On`/`Remarks`, `CreatedBy`/`On`. |
| `ReturnFromSubstoreItems` | `ReturnItemId` | Sub-store return line. | `ReturnId`, `ItemId`, `ReturnQuantity`, `BatchNo`. |

### 3.5 Write-Off, Return-to-Vendor, Donation

| Model | Key | Purpose |
|---|---|---|
| `WriteOffItemsModel` | `WriteOffId` | A write-off event (expired/damaged stock). `StockId`, `ItemId`, `ItemRate`, `WriteOffQuantity`, `TotalAmount`, `WriteOffDate`, `Remark`, `BatchNO`, `StoreId`, `IsTransferredToACC`. |
| `ReturnToVendorModel` | `ReturnToVendorId` | Return-to-vendor header. `VendorId`, `ReturnDate`, `SubTotal`, `VATTotal`, `DiscountAmount`, `TotalAmount`, `CreditNoteId`, `CreditNotePrintNo`, `Remarks`, `CCAmount`, `StoreId`, `IsTransferredToAcc`. |
| `ReturnToVendorItemsModel` | `ReturnToVendorItemId` | RTV line. `VendorId`, `ItemId`, `GoodsReceiptId`/`ItemId`, `CreditNoteNo`, `StockId`, `BatchNo`, `Quantity`, `ItemRate`, `TotalAmount`, `VAT`/`Amount`, `DiscountAmount`, `CCAmount`, `SubTotal`, `ReturnCostPrice`, `ReturnType`, `IsTransferredToACC`. |
| `ReturnToVendorItemsVM` | (DTO) | View-model returned by `GetItemListForReturnToVendor`. Groups items with `BatchDetails` (each batch's `AvailQty`, `ItemRate`, `StockId`, `GRId`, `GoodReceiptNo`). |
| `DonationModel` | `DonationId` | Donation header. `DonationNo`, `VendorId`, `StoreId`, `FiscalYearId`, `DonationReferenceNo`, `DonationReferenceDate`, `TotalAmount`, `Remarks`, `IsActive`. |
| `DonationItemModel` | `DonationItemId` | Donation line. `DonationId`, `CategoryName`, `ItemId`, `Specification`, `ModelNo`, `DonationQuantity`, `CostPrice`, `TotalAmount`, `StockId`, `GRDate`, `IsActive`. |

### 3.6 Fixed Assets

| Model | Key | Purpose |
|---|---|---|
| `FixedAssetStockModel` | `FixedAssetStockId` | One row per unit of a fixed-asset item, with its own barcode. Holds `BarCodeNumber`, `ItemId`, `BatchNo`, `ItemRate`, `VAT`/`Amount`, `CcAmount`, `MRP`, `OtherCharge`, `DiscountPercent`/`Amount`, `WarrantyExpiryDate`, `IsBarCodeGenerated`, `IsUnderMaintenance`, `IsAssetDamaged`/`Confirmed`/`Scraped`, `IsMaintenanceRequired`, `IsActive`, `StoreId`, `SubStoreId`, `CounterId`, `StockSpecification`, `DonationId`, `AssetMovements` (collection of `AssetLocationHistoryModel`). Domain method `Dispatch(targetStoreId, employeeId, date)` handles state machine. |
| `AssetLocationHistoryModel` | — | One row per asset-move event. `FixedAssetStockId`, `OldStoreId`, `NewStoreId`, `StartDate`, `EndDate`, `CreatedBy`/`On`. |
| `FixedAssetDepreciationModel` | — | Asset depreciation entry. `FixedAssetStockId`, `FiscalYearId`, `DepreciationAmount`, `DepreciationMethodId`, `DepreciationDate`, `BookValueAfter`. |
| `FixedAssetContractModel` | — | Asset contract/AMC. `FixedAssetStockId`, `VendorId`, `ContractStartDate`/`EndDate`, `Amount`, `Description`, `FileInfo`. |
| `FixedAssetConditionCheckListModel` | — | Periodic condition checklist. |
| `FixedAssetFaultHistoryModel` | — | Fault log. |
| `FixedAssetInsuranceModel` | — | Insurance policy. |
| `FixedAssetServiceModel` | — | Service history. |
| `FixedAssetCategoryModel` | — | Asset category. |
| `FixedAssetLocationsModel` | — | Asset location master. |
| `FixedAssetDepreciationMethodModel` | — | Depreciation method (straight-line, reducing-balance, etc.). |

### 3.7 Reports

`InventoryReportModel/` directory hosts DTOs used by the reporting controller (e.g. `CurrentStockLevel`, `CurrentWriteOff`, `ReturnToVendor`, `DailyItemDispatchModel`, `GoodsReceiptEvaluationModel`, `INV_RPT_InventorySummaryReport_DTO`, `DetailStockLedgerModel`, `ConsumableStockLedgerDetailFinalViewModel`, `CapitalStockLedgerDetailFinalViewModel`, `ExpirableStockReportFinalViewModel`, `SubstoreReportViewModel`, `IssuedItemViewModel`, `FixedAssetsModel`, `FixedAssetsMovementModel`, `ApprovedMaterialStockRegisterModel`, `SupplierWiseStockModel`, `ReturnToVendorItems`).

---

## 4. Database Tables

Defined in `InventoryDbContext.OnModelCreating` (see §2.3). All Inventory tables live in the EMR database (`Dev_DanpheEMR_INT1` SQL Server). All `Decimal` columns use `Decimal(16, 4)`.

### 4.1 Master / Configuration

| Table | PK | Purpose |
|---|---|---|
| `INV_MST_Item` | `ItemId` | Item master (§3.1). |
| `INV_MST_Vendor` | `VendorId` | Vendor master. |
| `INV_MST_ItemCategory` | `ItemCategoryId` | Item category. |
| `INV_MST_ItemSubCategory` | `SubCategoryId` | Item sub-category (drives item code). |
| `INV_MST_UnitOfMeasurement` | `UOMId` | UoM. |
| `INV_MST_PackagingType` | `PackagingTypeId` | Packaging. |
| `INV_MST_AccountHead` | `AccountHeadId` | Account head. |
| `INV_MST_Currency` | `CurrencyID` | Currency. |
| `INV_MST_Company` | `CompanyId` | Company / manufacturer. |
| `INV_MST_Terms` | `TermsId` | Terms & conditions. |
| `INV_MST_Charges` | `ChargeId` | Other charges. |
| `INV_MST_AssetLocation` | `LocationId` | Asset location. |
| `INV_MST_AssetCategory` | `AssetCategoryId` | Asset category. |
| `INV_MST_AssetDepreciationMethod` | `DepreciationMethodId` | Depreciation method. |
| `INV_MST_Donation` | `DonationId` | Donation type. |
| `INV_CFG_FiscalYears` | `FiscalYearId` | Inventory fiscal year. |
| `INV_FiscalYearStock` | — | Closing snapshot per fiscal year. |
| `PHRM_MST_Store` | `StoreId` | Store (shared with pharmacy). `Category` = `Store` / `Substore`; `SubCategory` = `Inventory`. |
| `MST_Department` | `DepartmentId` | Department (shared with master). |
| `EMP_Employee` | `EmployeeId` | Employee (shared). |
| `EMP_EmployeeRole` | `EmployeeRoleId` | Role (shared). |
| `RBAC_Permission` | `PermissionId` | RBAC permission. |
| `RBAC_MAP_UserRole` | composite | User-role mapping. |
| `CORE_CFG_Parameters` | composite | Global parameters. Used for `Inventory / EnableReceivedItemInSubstore`. |
| `BIL_CFG_FiscalYears` | `FiscalYearId` | Billing fiscal year (referenced for formatting). |
| `TXN_Verification` | `VerificationId` | Verification ledger (shared). |
| `CSSD_TXN_ItemTransaction` | — | CSSD transaction (referenced from fixed assets). |

### 4.2 Procurement

| Table | PK | Purpose |
|---|---|---|
| `INV_RequestForQuotation` | `ReqForQuotationId` | RFQ header. |
| `INV_RequestForQuotationItems` | `ReqForQuotationItemId` | RFQ lines. |
| `INV_RequestForQuotationVendors` | `ReqForQuotationVendorId` | RFQ → vendor mapping. |
| `INV_Quotation` | `QuotationId` | Vendor quotation. |
| `INV_QuotationItems` | `QuotationItemId` | Quotation lines. |
| `INV_QuotationUploadedFiles` | `QuotationUploadedFileId` | Files attached to quotations (varbinary). |
| `INV_TXN_PurchaseRequest` | `PurchaseRequestId` | Purchase request header. |
| `INV_TXN_PurchaseRequestItems` | `PurchaseRequestItemId` | PR lines. |
| `INV_TXN_PurchaseOrder` | `PurchaseOrderId` | PO header. |
| `INV_TXN_PurchaseOrderItems` | `PurchaseOrderItemId` | PO lines. |
| `INV_TXN_DraftPurchaseOrder` | `DraftPurchaseOrderId` | PO draft header. |
| `INV_TXN_DraftPurchaseOrderItem` | `DraftPurchaseOrderItemId` | PO draft lines. |
| `INV_TXN_GoodsReceipt` | `GoodsReceiptID` | Goods receipt header. |
| `INV_TXN_GoodsReceiptItems` | `GoodsReceiptItemId` | GR lines. |
| `INV_MAP_GoodsReceipt_OtherCharges` | `Id` | GR-level other charges. |
| `INV_MAP_GoodsReceiptItems_OtherCharges` | `Id` | GR-item-level other charges. |

### 4.3 Stock

| Table | PK | Purpose |
|---|---|---|
| `INV_MST_Stock` | `StockId` | Per-batch stock master. |
| `INV_TXN_StoreStock` | `StoreStockId` | Per-store stock balance. FK `StockId` → `INV_MST_Stock.StockId`. |
| `INV_TXN_StockTransaction` | `StockTransactionId` | Immutable in/out ledger. FK `StoreStockId` → `INV_TXN_StoreStock.StoreStockId`. |

### 4.4 Internal / Substore

| Table | PK | Purpose |
|---|---|---|
| `INV_TXN_Requisition` | `RequisitionId` | Requisition header. |
| `INV_TXN_RequisitionItems` | `RequisitionItemId` | Requisition lines. |
| `INV_TXN_Dispatch` | `DispatchId` | Dispatch header. |
| `INV_TXN_DispatchItems` | `DispatchItemsId` | Dispatch lines. |
| `INV_MAP_DispatchItems_FixedAssetStock` | composite (`DispatchItemsId`, `FixedAssetStockId`) | Links dispatch lines to asset instances. |
| `WARD_TXN_Return` | `ReturnId` | Substore → main-store return header. |
| `WARD_TXN_ReturnItems` | `ReturnItemId` | Substore return lines. |

### 4.5 Stock Movement Outcomes

| Table | PK | Purpose |
|---|---|---|
| `INV_TXN_WriteOffItems` | `WriteOffId` | Write-off events. |
| `INV_TXN_ReturnToVendor` | `ReturnToVendorId` | Return-to-vendor header. |
| `INV_TXN_ReturnToVendorItems` | `ReturnToVendorItemId` | RTV lines. |
| `INV_TXN_Donation` | `DonationId` | Donation header. |
| `INV_TXN_DonationItems` | `DonationItemId` | Donation lines. |

### 4.6 Fixed Assets

| Table | PK | Purpose |
|---|---|---|
| `INV_TXN_FixedAssetStock` | `FixedAssetStockId` | One row per unit. |
| `INV_AssetLocationHistory` | — | Asset location movements. |
| `INV_TXN_AssetDepreciation` | — | Depreciation entries. |
| `INV_AssetContractFileInfo` | — | Asset contract / AMC. |
| `INV_AssetConditionCheckList` | — | Periodic condition checks. |
| `INV_AssetFaultHistory` | — | Fault log. |
| `INV_AssetInsurance` | — | Insurance policies. |
| `INV_AssetServiceHistory` | — | Service history. |

---

## 5. Key Workflows

### 5.1 Quotation → PO (Procurement with RFQ)

```
1. Request For Quotation (RFQ)
   POST /api/Inventory/ReqForQuotation        (InventoryController)
   - Inserts INV_RequestForQuotation, items, vendors
   - Generates RequestForQuotationNo (per FY, per RFQGroupId)

2. Vendor uploads quotation (with optional file)
   POST /api/Inventory/UploadQuotationFiles
   - Inserts INV_QuotationUploadedFiles (binary)
   POST /api/Inventory/PostQuotations
   - Inserts INV_Quotation, INV_QuotationItems

3. Compare quotations
   GET  /api/Inventory/QuotationDetails
   - Returns fiscal year, vendor list, per-item vendor details, total amount

4. Select winning vendor → finalize RFQ
   PUT  /api/Inventory/VendorForPO
   - Sets ReqForQuotation.Status = 'Finalised'
   - Sets Quotation.Status = 'selected', fills IssuedDate

5. Create PO from quotation
   POST /api/Inventory/PurchaseOrder            (SavePurchaseOrder → SavePurchaseOrderDetails)
   - Inserts INV_TXN_PurchaseOrder, INV_TXN_PurchaseOrderItems
   - Generates PONumber (per FY, per POGroupId)
   - Computes PendingQuantity = Quantity - ReceivedQuantity
   - Computes DeliveryDays = DeliveryDate - PoDate
   - If IsVerificationEnabled: VerifierIds serialized; POStatus = 'pending'; else 'active'
```

### 5.2 Purchase Request → PO (Procurement via PR)

```
1. Create PR
   POST /api/Inventory/PORequisition
   - Inserts INV_TXN_PurchaseRequest + items
   - Generates PRNumber (per FY, per PRGroupId)
   - If PRSettings.EnableVerification: pushes notifications to verifier roles
   - Status = 'active'

2. Convert PR → PO
   POST /api/Inventory/PurchaseOrder
   PUT  /api/Inventory/PORequisitionAfterPOCreation
   - Decrements PR.PendingQuantity, sets RequestItemStatus to 'partial'/'complete'
   - Sets PR.RequestStatus, PR.IsPOCreated = true

3. Edit / Withdraw / Cancel PR
   PUT  /api/Inventory/PORequisition
   POST /api/Inventory/WithdrawPurchaseRequest      → CancelPurchaseRequestById
```

### 5.3 Goods Receipt (with optional PO and verification)

```
1. Add Goods Arrival (no PO required)
   POST /api/InventoryGoodReceipt            (InventoryGoodReceiptController → InventoryGoodReceiptService.AddGoodsArrival)
   - Generates GoodsArrivalNo, GoodsReceiptNo
   - Inserts INV_TXN_GoodsReceipt + INV_TXN_GoodsReceiptItems + OtherChargesModelList
   - Updates POItems.ReceivedQuantity / PendingQuantity / POItemStatus
   - If verification enabled: Sends notification to each verifier role/user
   - Status = 'pending'

2. Edit GR (e.g. batch, expiry, remarks)
   PUT  /api/InventoryGoodReceipt            (UpdateGoodsReceipt)
   - Updates GR header fields and individual items' batch/expiry/specification
   - Synchronously updates StockMaster.BatchNo/ExpiryDate/Specification for items that already have a stock row

3. Quality Inspection / Verification
   - Verifier approves → GRStatus = 'verified', IMIRNo/Date stamped
   - GR may have multi-level verifiers via the shared Verification service

4. Receive goods into stock
   POST /api/InventoryGoodReceipt/ReceiveGoodsReceipt/{GoodsReceiptId}
   - AddtoInventoryStock branches on ItemCategory:
       * 'Consumables'  → AddtoConsumableStock   (one StockMaster + one StoreStock row)
       * 'Capital Goods' + !IsFixedAssets → same as consumables
       * 'Capital Goods' + IsFixedAssets → AddtoConsumableAndFixedAssetStock
           - One StockMaster + one StoreStock (qty = ReceivedQty + FreeQty)
           - PLUS one row per received unit in INV_TXN_FixedAssetStock with auto-generated BarCodeNumber
             (sequential, starts at 1111111; format: fiscal-year + item-code + incremental)
           - PLUS one INV_AssetLocationHistory row per asset
   - Updates GR.ReceivedBy, GR.ReceivedOn, GR.ReceivedRemarks, GR.GRStatus = 'active'
   - Updates each GRItem.StockId / StoreStockId

5. Cancel GR
   POST /api/Inventory/CancelGoodsReceipt   → InventoryBL.CancelGoodsReceipt
   - Marks IsCancel = true, GRStatus = 'cancelled', CancelledBy/On/Remarks
   - If already received: walks back through the StockTransactions for the matching PurchaseItem entries and DecreaseStocks with TransactionType = 'CancelledGR'

6. View GR with full detail
   GET  /api/Inventory/GoodsReceiptByGRId
   - Returns GR items with batch, expiry, UoM, category, vendor, IMIR, charges
   - Also: GET /api/Inventory/ProcurementGRView  → InventoryBL.GetProcurementGRView
```

### 5.4 Requisition (Sub-store / Department → Main store)

```
1. Create Requisition
   POST /api/Inventory/Requisition
   - Body: InventoryRequisition_DTO (carries VerifierList)
   - Generates RequisitionNo (per FY, per ReqDisGroupId)
   - Status:
       * If VerifierIds != '[]' AND IsVerificationEnabled → 'pending' (verification required)
       * Else → 'active'
   - Each line item gets PendingQuantity = Quantity, RequisitionNo/IssueNo stamped

2. Withdraw Requisition (cancelled before any dispatch)
   POST /api/Inventory/WithdrawRequisition → InventoryBL.CancelSubstoreRequisition
   - RequisitionStatus = 'withdrawn'
   - Each item: IsActive = false, CancelQuantity = PendingQuantity, CancelBy/On/Remarks

3. List / track Requisitions
   GET  /api/Inventory/SubstoreRequistionList      (substore receiving: RequisitionToStoreId)
   GET  /api/Inventory/SubstoreRequistions          (all substore reqs)
   GET  /api/Inventory/TrackRequisition/{reqId}     (TrackRequisitionViewModel)

4. Cancel Requisition Items
   PUT  /api/Inventory/CancelRequisitionItem
   - Per-item CancelQuantity, RequisitionItemStatus flips to 'cancelled' or 'complete'
   - If ALL items are 'cancelled' → RequisitionStatus = 'cancelled'
   - If ALL items are 'complete' or 'cancelled' (mixed) → RequisitionStatus = 'complete'
```

### 5.5 Dispatch (Requisition → Stock transfer)

```
1. Stock-based dispatch against a Requisition
   POST /api/Inventory/Dispatch                    → InventoryBL.DispatchItemsTransaction
   - Generates DispatchNo
   - Walks StoreStocks of source store, ordered by StockMaster.ExpiryDate (FIFO)
   - Per stock row:
       * If receive-feature is OFF: Decreases AvailableQuantity in source, adds to target
       * If receive-feature is ON: uses UnConfirmedQty_Out / UnConfirmedQty_In instead
   - Updates RequisitionItem.ReceivedQuantity / PendingQuantity / RequisitionItemStatus
       (partial if any pending, complete if none)
   - Sets Requisition.RequisitionStatus to 'complete' if all items done, else 'partial'
   - Optionally supports fixed-asset dispatch via DispatchItem.DispatchedAssets (one barcode per unit)

2. Direct Dispatch (no requisition: walk-in issue to department)
   POST /api/Inventory/DirectDispatch             → InventoryBL.DirectDispatch
   - FromRoute = 'GRToDispatch' allows GR-bypass stock source
   - Auto-creates a Requisition with RequisitionStatus = 'complete' and IsDirectDispatched = true
   - Same FIFO stock logic

3. Receive dispatched items (when receive feature is ON)
   PUT  /api/Inventory/ReceiveDispatchedItems      (returnId, receivedRemarks)
   - Looks up StockTransactions for the dispatch (TransactionType in [ReturnedItem, ReturnedItemReceivingSide])
   - For source store: stock.ConfirmStockDecrease(stkTxn.OutQty)
   - For target store: stock.ConfirmStockReceived(InQty); stock.ConfirmStockDecrease(InQty) (return-from-substore flow)
   - Sets ReturnedItem.ReceivedBy/On/Remarks

4. Cancel substore requisition
   - Handled in 5.4 step 2.
```

### 5.6 Return to Vendor (RTV with credit note + cost-price recalculation)

```
1. Select items to return
   GET  /api/Inventory/ItemsForReturnToVendor?vendorId&goodsReceiptNo&fiscalYearId&storeId
   - Returns items + their batch details (BatchNo, AvailQty, ItemRate, StockId, GRId, GoodsReceiptNo) plus vendor address/phone

2. Get next credit-note number
   GET  /api/Inventory/CreditNoteNo → (max CreditNoteNo across INV_TXN_ReturnToVendorItems) + 1

3. Submit RTV
   POST /api/Inventory/ReturnToVendor            → InventoryBL.ReturnToVendorTransaction
   - Inserts INV_TXN_ReturnToVendor header (with CreditNoteId, TotalAmount, StoreId)
   - Inserts INV_TXN_ReturnToVendorItems lines
   - For each item:
       * RTSNetRatePerItem = TotalAmount / Quantity
       * RemainingQty = Stock.AvailableQuantity - returnQty
       * NewCP (weighted) = (RemainingQty * ExistingCP - (RTSNetRatePerItem - ExistingCP) * returnQty) / RemainingQty
       * Update StockMaster.CostPrice and StockTransaction.CostPrice
       * DecreaseStock (TransactionType = 'PurchaseReturnedItem', FiscalYearId, etc.)
   - All operations wrapped in dbContextTransaction; rolls back on any error

4. View returns by vendor
   GET  /api/Inventory/ReturnItemDetails         (createdOn, vendorId)
   GET  /api/Inventory/ReturnVendorItems         (storeId) — grouped list
```

### 5.7 Write-Off (expired / damaged / lost)

```
1. List available-to-write-off items
   GET  /api/Inventory/AvailableItemQty?storeId
   - Joins StoreStock × Item × GRItems where AvailableQuantity > 0

2. Submit write-off
   POST /api/Inventory/WriteOffItem              → InventoryBL.WriteOffItemsTransaction
   - Inserts INV_TXN_WriteOffItems
   - FIFO walk: for each write-off line, walks matching Stock rows by BatchNo and DecreasesStock with TransactionType = 'WriteOffItem'
   - Wrapped in transaction; rolls back on failure

3. View write-offs
   GET  /api/Inventory/WriteOffItems
```

### 5.8 Return From Substore

```
1. List returns
   GET  /api/Inventory/ReturnFromSubtore?fromDate&toDate&targetStoreId&sourceSubstoreId
   - Joins WARD_TXN_Return + WARD_TXN_ReturnItems + Stores + Items + Employees
   - Status: 'Pending' (ReceivedBy null) or 'Received'

2. Receive return (confirm quantities)
   PUT  /api/Inventory/ReceiveDispatchedItems    (see 5.5 step 3)
```

### 5.9 Donations

```
1. List donation-eligible vendors
   GET  /api/donation/GetAllVendorsThatReceiveDonation

2. List donations
   GET  /api/donation/getAllDonations/{fromDate}/{toDate}/{StoreId}
   GET  /api/donation/getDonationDetailsById/{DonationId}
   GET  /api/donation/getDonationById/{DonationId}

3. Create / update / cancel donation
   POST /api/donation                               (DonationController → IDonationService.SaveDonation)
   PUT  /api/donation/{DonationId}                  (UpdateDonation)
   PUT  /api/donation/cancel/{DonationId}           (CancelDonation)

4. Donated items also flow through Goods Receipt
   - GR.IsDonation = true, GR.DonationId set
   - Service AddGoodsArrival stamps DonationId on each GR item
   - When received, donated items enter stock via the same AddtoInventoryStock path
```

### 5.10 Stock Management (manual adjust, reconciliation)

```
1. Stock-list view (per store)
   GET  /api/Inventory/StocksForManage?storeId
   - Grouped by ItemId + BatchNo + ExpiryDate
   - Includes MinStockQuantity, SubCategoryName, UOM, ItemCode

2. Stock detail per item
   GET  /api/Inventory/StocksByItemIdAndStoreId?itemId&storeId
   GET  /api/Inventory/BatchNumbers?itemId
   GET  /api/Inventory/AvailableQuantity?itemId&storeId

3. Manual stock adjust (in / out)
   PUT  /api/Inventory/StockManage                → InventoryBL.ManageInventoryStock
   - Looks up existing StoreStock by (StoreId, StockId, BatchNo, CostPrice, ExpiryDate)
   - If InOut = 'in'  → AddStock
   - If InOut = 'out' → DecreaseStock
   - Both with TransactionType = 'StockManageItem', FiscalYearId stamped

4. Excel-based reconciliation
   GET  /api/Inventory/ExportStocksForReconciliationToExcel?storeId
     - Builds DataTable from InventoryStockModel, exports as protected .xlsx with editable NewQuantity column
   POST /api/Inventory/ReconciledStockFromExcelFile
     - InventoryBL.UpdateReconciledStockFromExcel
     - Computes diffQty = NewQuantity - AvailQuantity
     - AddStock if positive, DecreaseStock if negative, type = 'StockManageItem'
```

### 5.11 PO Drafts

```
1. Save draft PO
   POST /api/Inventory/PurchaseOrderDraft       → PostPurchaseOrderDraft
   - Generates DraftPurchaseOrderNo (per FY, per PODGroupId)
   - Status defaults to 'Active'

2. List drafts
   GET  /api/Inventory/PurchaseOrderDrafts?status

3. Edit draft
   PUT  /api/Inventory/PurchaseOrderDraft       → UpdatePurchaseOrderDraft
   - Incremental update: updates existing items, adds new items, marks removed items IsActive = false

4. Discard draft
   POST /api/Inventory/DiscardPurchaseOrder     → InventoryBL.CancelPurchaseOrderDraftById
   - Status = 'Discarded', DiscardedBy/On/Remarks
   - All draft items IsActive = false, IsDiscarded = true
```

### 5.12 Cancelling a PO

```
POST /api/Inventory/CancelPurchaseOrder       → InventoryBL.CancelPurchaseOrderById
- PO.IsCancel = true, PO.POStatus = 'cancelled', CancelledBy/On/Remarks
- All PO items: IsActive = false, POItemStatus = 'cancelled', CancelledBy/On/Remarks
- Wrapped in transaction
```

### 5.13 Verification (shared)

All multi-level approvals use the shared `TXN_Verification` model via `IVerificationService`. The flow:

- On creation, if `IsVerificationEnabled`, `VerifierIds` is populated as a JSON array of `{Id, Type}` pairs (Type = `user` or `role`).
- A row in `TXN_Verification` is created for each level; current-level-not-yet-verified rows drive the inbox.
- `VerificationBL.GetNumberOfVerificationDone` returns the count of levels completed.
- `VerificationBL.GetVerifiersList(verificationId, db)` returns the verifier list.
- When the last level verifies, downstream triggers fire (e.g. stock creation for GR).

Affected entities: PR, PO, GR, Requisition.

### 5.14 Stock Numbering (per FY, per group)

`InventoryReceiptNumberService` (in `/api/Inventory/*` server-side, but invoked from controllers) provides `Generate…No` methods. All follow a `(max(ScopedNo) + 1)` pattern, scoped by `FiscalYearId` and one of `PRGroupId`, `POGroupId`, `PODGroupId`, `GRGroupId`, `RFQGroupId`, `ReqDisGroupId`.

- `GenerateRequisitionNumber(fiscalYearId, ReqDisGroupId)` → for `RequisitionNo`
- `GenerateDispatchNo(fiscalYearId, ReqDisGroupId)` → for `DispatchId`
- `GeneratePurchaseRequestNumber(fiscalYearId, PRGroupId)` → for `PRNumber`
- `GenerateGAN(GoodsArrivalDate, GRGroupId)` → for `GoodsArrivalNo` (date-ranged within fiscal year)
- `GenerateGRN(GoodsReceiptDate, GRGroupId)` → for `GoodsReceiptNo`
- `GeneratePurchaseOrderNumber(fiscalYearId, POGroupId)` → for `PONumber`
- `GeneratePurchaseOrderDraftNumber(fiscalYearId, PODGroupId)` → for `DraftPurchaseOrderNo`
- `GenerateRequestForQuotationNumber(fiscalYearId, RFQGroupId)` → for `RequestForQuotationNo`
- `GenerateQuotationNumber(fiscalYearId, RFQGroupId)` → for `QuotationNo`

### 5.15 Item-Code and Vendor-Code Generation

- `InventoryBL.GetNewItemCode(db, item)` — uses the subcategory's `Code` plus a 3-digit zero-padded running count of items in that subcategory. Result: `e.g. INV001`.
- `InventoryBL.GetNewVendorCode(db)` — 5-digit zero-padded running count. Result: `e.g. 00001`.

---

## 6. API Endpoints

All routes are mounted under `/api/...`. Default base URL in production: `https://hms-saas-production.rahmatullahzisan.workers.dev` (per the HMS project AGENTS). DanpheEMR ASP.NET equivalent: `https://<server>/api/...`.

### 6.1 `InventoryController` (`/api/Inventory`)

#### Vendors

| Verb | Route | Purpose |
|---|---|---|
| GET | `/Vendors` | List vendors (with `DefaultItem` deserialized). |
| GET | `/VendorsDetail` | All vendors, plain. |
| GET | `/Vendors` (alt, settings route) | Same data via `InventorySettingsController`. |
| GET | `/VendorDetailsByVendorId?vendorId` | Single vendor. |
| GET | `/VendorWisePurchaseOrders` | Grouped active POs by vendor. |

#### Items

| Verb | Route | Purpose |
|---|---|---|
| GET | `/Items` | All items with stock details (calls `SP_INV_GetInventoryItemWithStockDetails`). |
| GET | `/ItemsByStoreId?storeId` | Items belonging to a store (`StoreId == storeId OR StoreId == null`). |
| GET | `/AvailableItemQty?storeId` | Items with `AvailableQuantity > 0` joined with GR items. |
| GET | `/AvailableQuantity?itemId&storeId` | Sum of `AvailableQuantity` for an item at a store. |
| GET | `/AvailableQuantityByItemIdAndStoreId?itemId&storeId` | Grouped result (ItemId, AvailableQuantity, StoreId). |
| GET | `/ItemsForReturnToVendor?vendorId&goodsReceiptNo&fiscalYearId&storeId` | Returns item batches available for return. |
| GET | `/ItemPriceHistory` | Price history per item per vendor via GR items. |
| GET | `/ItemWiseRequistion` | Aggregated open-requisition quantity per item minus available stock. |
| GET | `/BatchNumbers?itemId` | Distinct batch numbers + price + available quantity. |

#### Stock

| Verb | Route | Purpose |
|---|---|---|
| GET | `/Stocks?storeId` | All stock rows for a store (calls `SP_InventoryOverAllStockList`). |
| GET | `/StocksForManage?storeId` | Stock for management (grouped by Item/Batch/Expiry). |
| GET | `/StocksForDonation?storeId` | Same shape, with `Description`. |
| GET | `/StocksByItemIdAndStoreId?itemId&storeId` | Batch-level stock with GR info. |
| GET | `/StocksManageByItemIdStoreId?itemId&storeId` | Per-batch stock for stock-manage UI. |
| GET | `/StockListForDirectDispatch?storeId` | Calls `SP_INV_GetStockListForDispatch`. |
| PUT | `/StockManage` | Apply in-place stock adjust (`ManageInventoryStock`). |
| POST | `/ReconciledStockFromExcelFile` | Apply Excel diff (`UpdateReconciledStockFromExcel`). |
| GET | `/ExportStocksForReconciliationToExcel?storeId` | Returns protected .xlsx for manual edit. |

#### Vendors (terms)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/TermsList` | Inventory terms. |

#### Sub-categories

| Verb | Route | Purpose |
|---|---|---|
| GET | `/SubCategories` | Item subcategories. |
| GET | `/SubCategories` (alt) | Same. |

#### Stores

| Verb | Route | Purpose |
|---|---|---|
| GET | `/InventoryStores` | Stores where `Category=Store/SubCategory=Inventory` OR `Category=Substore`. |
| GET | `/AllInventoryStores` | All active stores where subcategory=Inventory or category=Substore. |
| GET | `/AllSubstore` | All sub-stores (id + name). |
| GET | `/ActiveInventories` | Active `Category=Store, SubCategory=inventory` stores. |

#### Purchase Order

| Verb | Route | Purpose |
|---|---|---|
| GET | `/PurchaseOrders?fromDate&toDate&status&storeId` | List POs in date range (status comma-separated). |
| GET | `/PurchaseOrderItemByPOId?purchaseOrderId` | PO + items with `Item` included. |
| GET | `/PurchaseOrderItem?purchaseOrderId&storeId` | Same, with `ItemCategory`/`UOM` etc. for procurement screen. |
| GET | `/RequisitionsforPO` | Aggregated open-requisition qty per item minus stock. |
| POST | `/PurchaseOrder` | Create PO. |
| PUT | `/PurchaseOrder` | Update PO. |
| PUT | `/PurchaseOrderAndPOItemStatus` | Update only `POStatus` and per-item `ReceivedQuantity/PendingQuantity/POItemStatus`. |
| POST | `/CancelPurchaseOrder` | Cancel a PO. |
| POST | `/VendorForPO` (PUT) | Mark selected vendor + finalize RFQ. |

#### PO Draft

| Verb | Route | Purpose |
|---|---|---|
| POST | `/PurchaseOrderDraft` | Save draft. |
| PUT | `/PurchaseOrderDraft` | Update draft (add/edit/remove items). |
| GET | `/PurchaseOrderDrafts?status` | List drafts by status. |
| GET | `/PurchaseOrderDraftItem?purchaseOrderDraftId` | Draft detail. |
| POST | `/DiscardPurchaseOrder` | Discard draft. |

#### Purchase Request

| Verb | Route | Purpose |
|---|---|---|
| POST | `/PORequisition` | Create PR. |
| GET | `/PurchaseOrderRequisition?fromDate&toDate&storeId` | List PRs. |
| GET | `/PORequisitionByRequisitionIdStoreId?requisitionId&storeId` | PR detail with items, requester, verifiers. |
| GET | `/PurchaseRequestItems?purchaseRequestId` | Items in a PR with available stock. |
| PUT | `/PORequisition` | Update PR. |
| PUT | `/PORequisitionAfterPOCreation` | Recompute pending quantities / status after a PO is created. |
| POST | `/WithdrawPurchaseRequest` | Withdraw a PR. |

#### Quotation / RFQ

| Verb | Route | Purpose |
|---|---|---|
| POST | `/ReqForQuotation` | Create RFQ. |
| GET | `/RequestForQuotations?storeId` | List active / finalized RFQs. |
| GET | `/RequestForQuotationDetails?reqForQuotationId` | RFQ items + vendors. |
| GET | `/RequestForQuotationItems?reqForQuotationId` | RFQ items. |
| GET | `/RequestForQuotationVendors?reqForQuotationId` | RFQ vendors. |
| GET | `/Quotations?reqForQuotationId` | Selected quotations. |
| GET | `/QuotationItems?quotationId` | Quotation lines. |
| GET | `/QuotationByStatus?reqForQuotationId&storeId` | Single selected quotation. |
| GET | `/QuotationDetails?reqForQuotationId` | Full comparison view (fiscal year, vendor list, per-item prices, total). |
| GET | `/QuotationDetailsToAddPO?reqForQuotationId` | Quotation shaped for PO creation. |
| GET | `/RequestedQuotations` | RFQs awaiting quotation. |
| POST | `/PostQuotations` | Save vendor quotation. |
| POST | `/UploadQuotationFiles` | Multipart file upload. |
| GET | `/AttachedQuotationFiles?reqForQuotationId` | List uploaded files. |
| GET | `/GetPreviousQuotationDetailsByVendorId?reqForQuotationId&vendorId` | Previous quotation for a vendor. |
| PUT | `/VendorForPO` | Mark selected vendor + finalize RFQ. |
| GET | `/RequestForQuotation?reqForQuotationId` | RFQ full view. |

#### Goods Receipt

| Verb | Route | Purpose |
|---|---|---|
| GET | `/GoodsReceipt?fromDate&toDate&storeId` | List GRs. |
| GET | `/GoodsReceipStocks?fromDate&toDate&storeId` | Stock-listed GRs (with `IsQuantityAvailableToDispatchFromGR` flag). |
| GET | `/GoodsReceiptMasterList?storeId` | Master list of GRs for current fiscal year. |
| GET | `/GoodsReceiptByGRId?goodsReceiptId` | Full GR detail (header + items + charges + creator + verifiers). |
| GET | `/GoodsReceiptByEachVendor` | GRs grouped by vendor. |
| GET | `/GoodsReceiptByVendorId?vendorId` | GRs for one vendor. |
| GET | `/GoodsReceiptByVendorId` | (alt path; same data). |
| GET | `/GRItemsDetails?goodsReceiptId&storeId` | GR items with remaining-available qty. |
| GET | `/ProcurementGRView?goodsReceiptId` | Procurement-side GR view-model (InventoryBL.GetProcurementGRView). |
| GET | `/GRVendorsBillingHistory` | Last 1 year of non-cancelled GRs. |
| GET | `/FixedAssetDonations` | Donation type list. |
| GET | `/AvailableItemQty?storeId` | Items available for write-off. |
| GET | `/StocksForDonation?storeId` | Stock usable for donation. |
| POST | `/CancelGoodsReceipt` | Cancel a GR. |

#### Requisition

| Verb | Route | Purpose |
|---|---|---|
| GET | `/Requisitions?status&itemId` | Requisitions matching statuses for a given item. |
| GET | `/DeptWiseRequistions?status` | Requisitions grouped by department. |
| GET | `/Department?requisitionId` | Department of a requisition. |
| GET | `/RequisitionsByRequisitionId?requisitionId` | Full requisition with items. |
| GET | `/RequisitionsforPO` | Open items for PO creation. |
| GET | `/RequisitionByRequisitionId?requisitionId` | Requisition with stock availability per line. |
| GET | `/RequisitionByItemId?itemId` | All active/partial requisitions for an item. |
| GET | `/RequisitionItemForView?requisitionId` | Two-table result: requisition items + dispatch info (`INV_TXN_VIEW_GetRequisitionItemsInfoForView`). |
| GET | `/RequisitionItemsForView?requisitionId` | Requisition view: header, items, dispatchers, verifiers. |
| GET | `/CancelledRequisitionDetail?requisitionId` | Cancelled requisition detail. |
| GET | `/DispatchView?requisitionId` | Dispatches for a requisition. |
| GET | `/DispatchViewByDispatchIdReqIdCreatedOn?dispatchId&requisitionId&createdOn` | Dispatch view via SP. |
| GET | `/TrackRequisition?requisitionId` | TrackRequisitionViewModel. |
| GET | `/POVerifiers` | All PO verifiers. |
| POST | `/Requisition` | Create requisition. |
| POST | `/WithdrawRequisition` | Withdraw a substore requisition. |
| PUT | `/RequisitionStatus` | Update requisition status. |
| PUT | `/CancelRequisitionItem` | Cancel specific items. |

#### Substore Requisitions

| Verb | Route | Purpose |
|---|---|---|
| GET | `/SubstoreRequistionList?fromDate&toDate&storeId` | Requisitions targeting a store. |
| GET | `/SubstoreRequistions?fromDate&toDate&storeId` | All substore reqs (target store). |

#### Dispatch

| Verb | Route | Purpose |
|---|---|---|
| POST | `/Dispatch` | Dispatch against a requisition. |
| POST | `/DirectDispatch` | Direct dispatch (auto-creates req). |

#### Return to Vendor / Write-Off

| Verb | Route | Purpose |
|---|---|---|
| GET | `/ReturnItemDetails?createdOn&vendorId` | Returns for a vendor on a date. |
| GET | `/ReturnVendorItems?storeId` | Grouped list of return events. |
| GET | `/CreditNoteNo` | Next credit-note number. |
| POST | `/ReturnToVendor` | Submit RTV. |
| GET | `/WriteOffItems` | List write-offs. |
| POST | `/WriteOffItem` | Submit write-off. |

#### Substore Returns

| Verb | Route | Purpose |
|---|---|---|
| GET | `/ReturnFromSubtore?fromDate&toDate&targetStoreId&sourceSubstoreId` | List returns. |
| PUT | `/ReceiveDispatchedItems?returnId&receivedRemarks` | Receive a return. |

#### Fiscal Year

| Verb | Route | Purpose |
|---|---|---|
| GET | `/InventoryFiscalYears` | List inventory fiscal years. |

#### Fixed Asset Checklist

| Verb | Route | Purpose |
|---|---|---|
| PUT | `/AssetCheckList` | Update asset checklist. |

### 6.2 `InventoryCompanyController` (`/api/InventoryCompany`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/` | All companies. |
| GET | `/{id}` | One company. |
| POST | `/` | Create. |
| PUT | `/{id}` | Update. |

### 6.3 `InventoryDonationController` (route `~/api/donation/*`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/api/donation/GetAllVendorsThatReceiveDonation` | Eligible vendors. |
| GET | `/api/donation/getAllDonations/{fromDate}/{toDate}/{StoreId}` | Donations list. |
| GET | `/api/donation/getDonationDetailsById/{DonationId}` | Donation view. |
| GET | `/api/donation/getDonationById/{DonationId}` | Donation header. |
| POST | `/api/donation` | Create donation. |
| PUT | `/api/donation/{DonationId}` | Update donation. |
| PUT | `/api/donation/cancel/{DonationId}` | Cancel donation. |

### 6.4 `InventoryEmailController` (`/api/InventoryEmail`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/` | Health-check returns `"hello"`. |
| POST | `/` | Sends email via SendGrid. **Note**: API key is hard-coded in source — must be parameterized. |

### 6.5 `InventoryGoodReceiptController` (`/api/InventoryGoodReceipt`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/` | All GRs. |
| GET | `~/api/GetVendorList` | Vendors (alias). |
| GET | `/{id}` | Single GR. |
| POST | `/` | Create GR. |
| PUT | `/` | Update GR. |
| POST | `/ReceiveGoodsReceipt/{GoodsReceiptId}` | Receive goods → stock. |
| GET | `/getINVOtherChargesDetails` | Other-charges master. |

### 6.6 `InventorySettingsController` (`/api/InventorySettings`)

Master-data CRUD:

| Verb | Route | Purpose |
|---|---|---|
| GET | `/Vendors` | Vendor list. |
| GET | `/InventoryTerms` | Terms. |
| GET | `/TermsListByTermsApplicationId?termsApplicationId` | Filtered terms. |
| GET | `/CurrencyCodes` | Currency list. |
| GET | `/ItemCategories` | Categories. |
| GET | `/ItemSubCategories` | Sub-categories. |
| GET | `/PackagingTypes` | Packaging. |
| GET | `/AccountHeads?showIsActive` | Account heads. |
| GET | `/UnitOfMeasurements` | UoM. |
| GET | `/Items` | Items. |
| GET | `/OtherCharges` | Other charges. |
| GET | `/OtherCharge?chargeId` | Single charge. |
| GET | `/ActiveRbacRoles` | Active RBAC roles. |
| POST | `/Vendor` | Create vendor. |
| POST | `/ItemCategory` | Create category. |
| POST | `/ItemSubCategory` | Create sub-category (creates ledger mapping). |
| POST | `/InventoryTerm` | Create term. |
| POST | `/UnitOfMeasurement` | Create UoM. |
| POST | `/PackagingType` | Create packaging. |
| POST | `/AccountHead` | Create account head. |
| POST | `/Item` | Create item (server generates `Code` via `GetNewItemCode`). |
| POST | `/Currency` | Create currency. |
| POST | `/OtherCharge` | Create charge. |
| PUT | `/Vendor` | Update vendor. |
| PUT | `/InventoryTerm` | Update term. |
| PUT | `/ItemCategory` | Update category. |
| PUT | `/ItemSubCategory` | Update sub-category (re-syncs ledger mapping). |
| PUT | `/UnitOfMeasurement` | Update UoM. |
| PUT | `/PackagingType` | Update packaging. |
| PUT | `/AccountHead` | Update account head. |
| PUT | `/Item` | Update item. |

### 6.7 `ActivateInventoryController` (`/api/ActivateInventory`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/` | All inventories available for activation. |
| GET | `/{id}` | One inventory. |

### 6.8 `InventoryViewController` (MVC, no `/api`)

Returns Razor views for the main inventory pages (see §2.1).

### 6.9 `InventoryReportsController` (MVC actions returning JSON strings)

Each report action returns `DanpheHTTPResponse<…>` serialized as JSON string. Reports are SQL-driven via `InventoryReportingDbContext`. Highlights:

| Action | Purpose |
|---|---|
| `CurrentStockLevelReport` | Live stock levels. |
| `CurrentStockLevelReportById` | Stock level by store id(s). |
| `CurrentStockItemDetailsByStoreId` | Item detail per store. |
| `CurrentWriteOffReport` | Write-off history per item. |
| `ReturnToVendorReport` | RTV report. |
| `DailyItemDispatchReport` | Daily dispatch summary. |
| `INVPurchaseItemsReport` | Purchased items summary. |
| `PurchaseOrderReport` | PO summary. |
| `CancelledPOandGRReport` | Cancellation list. |
| `GoodReceiptEvaluationReport` | GR quality evaluation. |
| `InventorySummaryReport` | Period summary. |
| `InventoryValuationReport` | Stock valuation. |
| `ComparisonPoGrReport` | PO vs GR comparison. |
| `PurchaseReport` | Vendor-wise purchase. |
| `FixedAssetsReport` | Fixed assets list. |
| `FixedAssetsMovementReport` | Asset movement history. |
| `DepartmentDetailStockLedgerReport` | Stock ledger per item. |
| `ConsumableStockLedgerReport` | Detailed consumable ledger. |
| `CapitalStockLedgerReport` | Detailed capital ledger. |
| `IssuedItemListReport` | Issued items list. |
| `OpeningStockValuationReport` | Opening stock valuation. |
| `ApprovedMaterialStockRegisterReport` | Approved-material register. |
| `VendorTransactionReport` / `VendorTransactionReportData` | Vendor-level transaction report. |
| `ItemMgmtDetailReport` | Item-management detail. |
| `SubstoreStockReport` | Substore stock view. |
| `InvPurchaseSummaryReport` | Purchase summary with item-category list. |
| `ExpiryItemReport` | Expiry-by-item report. |
| `GetAllVendorList` / `GetAllItemsList` / `GetAllStoreList` | Dropdown helpers for supplier-wise report. |
| `SupplierWiseStockReport` | Stock value per supplier. |
| `InvReturnToSupplierReport` | RTV detailed report. |
| `INVSupplierInformationReport` | Supplier information. |
| `SubstoreDispatchAndConsumptionReport` | Substore dispatch + consumption. |
| `ExpirableStockReport` | Expiring-stock report. |
| `SubstoreWiseSummaryReport` | Substore summary. |

### 6.10 Key Stored Procedures used by the API

| Procedure | Called from |
|---|---|
| `SP_InventoryOverAllStockList(@StoreId)` | `GET /Stocks`. |
| `SP_INV_GetInventoryItemWithStockDetails` | `GET /Items`. |
| `SP_INV_GetStockListForDispatch(@StoreId)` | `GET /StockListForDirectDispatch`. |
| `INV_TXN_VIEW_GetRequisitionItemsInfoForView(@RequisitionId)` | `GET /RequisitionItemForView`. |
| `DispatchDetail(DispatchId, FiscalYearId, RequisitionId)` | `GET /DispatchViewByDispatchIdReqIdCreatedOn`. |
| `GetRFQDetails(ReqForQuotationId)` | `GET /RequestForQuotation`. |
| `GetQuotationDetailsToAddPO(ReqForQuotationId)` | `GET /QuotationDetailsToAddPO`. |
| (Various report SPs) | `InventoryReportsController`. |

---

## 7. Cross-Module Interactions

### 7.1 Pharmacy (`PHRM_*`)

- **`PHRM_MST_Store`** is shared. Inventory stores (main + sub-store) are rows in this table with `Category = 'Store' / 'Substore'` and `SubCategory = 'Inventory'`. `InventoryController.GetInventoryStores`, `GetAllInventoryStores`, and `GetActiveInventoryList` all read from `PHRMStore`.
- Dispatch from inventory main store to a pharmacy sub-store reuses the same `StoreStock` + `StockTransaction` model, so a single `StockTransaction.TransactionType` value is the only thing distinguishing pharmacy stock movements from inventory ones.

### 7.2 Accounting (`BIL_*`, `ACC_*`)

- **Sub-category ledger mapping**: when an `ItemSubCategory` is created with a `LedgerId`, the system writes `Ledgers.LedgerReferenceId = SubCategoryId` and inserts a row in `LedgerMappings` (`LedgerType = 'inventorysubcategory'`). See `InventorySettingsController.UpdateItemSubCategory` and `PostItemSubCategory`.
- **GR → Accounting** transfer is staged via `IsTransferredToACC` flags on `GoodsReceipt`, `GoodsReceiptItems`, `WriteOffItems`, `ReturnToVendorItems`. The accounting push itself is performed by `AccTransfer` services (not in this module).
- **Vendor Ledger**: `VendorMasterModel.LedgerId` (NotMapped) carries a link to an accounting ledger created on demand by vendor flows.
- **AccountHead master** (`INV_MST_AccountHead`) is the inventory-side list that accounting can cross-reference.

### 7.3 Ward Supply (`WARD_*`)

- `WARD_TXN_Return` and `WARD_TXN_ReturnItems` are mapped inside `InventoryDbContext` and exposed as `SubstoreReturn` / `SubstoreReturnItems` to inventory code, because the substore → main-store return flow is symmetric with the ward-supply return flow.
- `InventoryController.ReturnFromSubtore` and `InventoryBL` reuse the same `StockTransaction` model so the two modules share the in/out ledger.

### 7.4 Sub-store / Ward consumption

- Sub-stores and wards share the `PHRM_MST_Store` definition and the inventory `INV_TXN_StoreStock` model. Dispatch against a ward-supply requisition may use inventory's `DispatchItemsTransaction`.
- `InventoryBL.DispatchItemsTransaction` supports both consumable dispatch and fixed-asset dispatch (via `DispatchItem.DispatchedAssets`).

### 7.5 Verification (shared)

- All multi-level approvals go through `TXN_Verification` and `IVerificationService` — used by PR, PO, GR, and Requisition flows.

### 7.6 Master / Employee / RBAC

- `MST_Department`, `EMP_Employee`, `EMP_EmployeeRole`, `RBAC_Permission`, `RBAC_MAP_UserRole` are read by inventory to populate drop-downs, verifiers, and current-user stamps.
- `CORE_CFG_Parameters` flag `Inventory / EnableReceivedItemInSubstore` toggles the unconfirmed-quantity mechanism in `StoreStockModel.AddStock`/`DecreaseStock`.

### 7.7 CSSD

- `CSSD_TXN_ItemTransaction` is referenced (in `InventoryDbContext`) for cross-module item tracking. CSSD itself has its own controllers.

### 7.8 Fixed Asset ↔ Accounting

- Asset depreciation (`INV_TXN_AssetDepreciation`) and asset-contract/insurance records are designed to be picked up by the accounting transfer pipeline (no direct FK to accounting tables in this module).

---

## 8. Key Business Rules

### 8.1 Approval / verification

- All transactions that affect stock or money can be configured to require multi-level verification via `IsVerificationEnabled` + `VerifierList` (serialized to `VerifierIds`).
- Verifier entries may be a `user` or a `role`. Role verifiers fan out via the RBAC system.
- `VerificationBL.GetNumberOfVerificationDone` returns the count of completed levels; the UI shows `CurrentVerificationLevelCount / MaxVerificationLevel`.
- Until the last level verifies, the document is locked from downstream effects (e.g. PO cannot be cancelled from the UI; GR does not post to stock).

### 8.2 Batch tracking

- `StockMaster` enforces one row per `(ItemId, BatchNo, ExpiryDate, CostPrice)`.
- Multiple StoreStock rows can exist for the same StockMaster (one per store).
- For non-fixed-asset items, `GRItem.CostPrice` is stamped onto `StockMaster.CostPrice` on receipt.
- For fixed-asset items, one additional `FixedAssetStock` row per received unit, with a unique `BarCodeNumber`. Barcode starts at `1111111` and increments numerically (not zero-padded in source).
- `SampleRemoved`, `SamplingQuantity`, `SamplingBoxes`, `SamplingDate`, `IdentificationLabel`, `IsSamplingLabel`, `MaterialNO`, `NoOfBoxes`, `ManufactureDate` are stored at the GR-item level for QA / regulatory compliance.

### 8.3 Sub-store / inter-store transfer

- Requisitions from a sub-store target a main store (`RequestToStoreId = mainStoreId`, `RequestFromStoreId = subStoreId`).
- Dispatch applies FIFO: walks `StoreStocks` of the source store ordered by `StockMaster.ExpiryDate` (then by `StoreStockId` for ties) — see `InventoryBL.DispatchItemsTransaction`.
- The same StockMaster row may have store-stocks at multiple stores; dispatch decrements the source's `StoreStock.AvailableQuantity` and increments (or creates) the target's `StoreStock.AvailableQuantity` with the same `StockId`.
- When `EnableReceivedItemInSubstore` is true, the dispatch uses `UnConfirmedQty_In` / `UnConfirmedQty_Out` instead and waits for `ReceiveDispatchedItems` confirmation.

### 8.4 Return-to-vendor valuation

- `InventoryBL.ReturnToVendorTransaction` recalculates weighted-average `CostPrice` on the remaining stock:
  - `RTSNetRatePerItem = TotalAmount / Quantity`
  - `RTSAdjustedAmount = (RTSNetRatePerItem - ExistingCP) × returnQty`
  - `NewCP = ((RemainingQty × ExistingCP) - RTSAdjustedAmount) / RemainingQty`
  - Updates `StockMaster.CostPrice` and `StockTransaction.CostPrice` and creates a `PurchaseReturnedItem` stock transaction.
- `TotalReceivedQty = grItem.InvoicedQty + grItem.FreeQty` is read for the math; only the original GR-item batches participate.

### 8.5 Write-off FIFO

- `InventoryBL.WriteOffItemsTransaction` walks `StoreStocks` filtered by `ItemId + BatchNo + StoreId`, ordered by `CreatedOn`, and decreases stock with `TransactionType = 'WriteOffItem'`.
- Throws if `stockList.Sum(AvailableQuantity) < writeOffQuantity`.

### 8.6 Stock valuation

- Cost is tracked at two levels: `StockMaster.CostPrice` (per batch) and `StoreStock.CostPrice` (per store-batch). Both are kept in sync on receipt and on return-to-vendor.
- `INV_FiscalYearStock` provides a closing snapshot for opening-balance rollovers.

### 8.7 Direct dispatch (no requisition)

- Used when stock is issued to a department/walk-in user without a prior requisition (e.g. emergency issues).
- `InventoryBL.DirectDispatch` auto-creates a `RequisitionModel` with `IsDirectDispatched = true`, `RequisitionStatus = 'complete'`, and copies the `DispatchItems` into `RequisitionItems` with `RequisitionItemStatus = 'complete'`.
- Stock-side logic is identical to a normal dispatch (FIFO, source decrement, target increment, optional fixed-asset dispatch).

### 8.8 Donation

- Donations are modeled via `INV_TXN_Donation` + `INV_TXN_DonationItems`, but the items also flow through a `GoodsReceipt` (with `IsDonation = true` and `DonationId` set), so the accounting valuation, stock posting, and reporting all work the same way as a purchase GR.
- A vendor that can receive donations is flagged with `Vendor.ReceiveDonation = true`.

### 8.9 Draft / Cancel policies

- A PO is "cancellable" only when no receipts exist (`UpdatePurchaseOrderWithItems` is the safe path; `CancelPurchaseOrderById` flips status to `cancelled` and marks items `IsActive = false`).
- A GR is "cancellable" post-receive — `CancelGoodsReceipt` walks back the matching `PurchaseItem` stock transactions and decreases the corresponding `StoreStock` rows.
- A requisition with any dispatch already done cannot be fully cancelled; instead, individual items are cancelled with `CancelRequisitionItem`.

### 8.10 Item code generation

- `InventoryBL.GetNewItemCode(db, item)` returns `SubCategory.Code + "{0:D3}"(itemCount + 1)`. So adding the 5th item to a subcategory `INV` yields `INV005`.
- Server-side only — frontend never assigns codes.

### 8.11 Vendor code generation

- `InventoryBL.GetNewVendorCode(db)` returns `"{0:D5}"(vendorCount + 1)`. So the 17th vendor is `00017`.

### 8.12 Numbering reset

- All receipt numbers reset per fiscal year and per `*GroupId`. The groups are tied to the `Store` table or to the `Inventory` activation record. Hospitals with multiple inventory stores therefore maintain separate number sequences.

### 8.13 Configuration parameters

- `CORE_CFG_Parameters` with `ParameterGroupName = 'Inventory' / ParameterName = 'EnableReceivedItemInSubstore'` toggles the receive-confirmation feature. When `true`, substore dispatch leaves stock in `UnConfirmedQty_Out` until the target confirms receipt via `/api/Inventory/ReceiveDispatchedItems`.

### 8.14 Security / RBAC

- All multi-level approvals honor `TXN_Verification` and `RBAC_Permission`.
- `ActivateInventoryGuardService` (frontend) blocks the whole inventory module until at least one inventory is activated.
- The hard-coded SendGrid API key in `InventoryEmailController` is a security smell that must be fixed (use `wrangler secret` / environment variables in the migrated HMS).

---

## 9. Quick Reference — DB ↔ Endpoint ↔ Model

| Workflow | DB write target | Controller endpoint | Key model |
|---|---|---|---|
| Add vendor | `INV_MST_Vendor` | `POST /api/InventorySettings/Vendor` | `VendorMasterModel` |
| Add item | `INV_MST_Item` | `POST /api/InventorySettings/Item` | `ItemMasterModel` |
| Create PR | `INV_TXN_PurchaseRequest[Items]` | `POST /api/Inventory/PORequisition` | `PurchaseRequestModel` |
| Create PO | `INV_TXN_PurchaseOrder[Items]` | `POST /api/Inventory/PurchaseOrder` | `PurchaseOrderModel` |
| Create GR (no PO) | `INV_TXN_GoodsReceipt[Items]` | `POST /api/InventoryGoodReceipt` | `GoodsReceiptModel` |
| Receive into stock | `INV_MST_Stock` + `INV_TXN_StoreStock` + `INV_TXN_StockTransaction` | `POST /api/InventoryGoodReceipt/ReceiveGoodsReceipt/{id}` | `StockMasterModel` / `StoreStockModel` |
| Create requisition | `INV_TXN_Requisition[Items]` | `POST /api/Inventory/Requisition` | `RequisitionModel` |
| Dispatch | `INV_TXN_Dispatch[Items]` + stock movements | `POST /api/Inventory/Dispatch` | `DispatchModel` |
| Direct dispatch | auto-req + dispatch + stock | `POST /api/Inventory/DirectDispatch` | `DispatchModel` |
| Return to vendor | `INV_TXN_ReturnToVendor[Items]` + cost-price update | `POST /api/Inventory/ReturnToVendor` | `ReturnToVendorModel` |
| Write off | `INV_TXN_WriteOffItems` + stock decrease | `POST /api/Inventory/WriteOffItem` | `WriteOffItemsModel` |
| Donation | `INV_TXN_Donation[Items]` | `POST /api/donation` | `DonationModel` |
| Stock reconciliation | `INV_TXN_StoreStock` + `INV_TXN_StockTransaction` | `PUT /api/Inventory/StockManage` / `POST /api/Inventory/ReconciledStockFromExcelFile` | `InventoryStockModel` |
| Cancel PO | `INV_TXN_PurchaseOrder[Items]` status | `POST /api/Inventory/CancelPurchaseOrder` | `PurchaseOrderModel` |
| Cancel GR | `INV_TXN_GoodsReceipt[Items]` + stock backout | `POST /api/Inventory/CancelGoodsReceipt` | `GoodsReceiptModel` |
| Substore return receive | `INV_TXN_StockTransaction` confirm | `PUT /api/Inventory/ReceiveDispatchedItems` | `ReturnFromSubstore` |

---

## 10. Notes for the HMS Migration

- **Sync layer** — When mirroring this module on Cloudflare (Hono + D1), keep the multi-tenant boundary (`HospitalId`) on every transaction table. Add a `hospital_id` column and a global parameter in `wrangler.toml`.
- **Stored procedures** — DanpheEMR leans heavily on T-SQL SPs (e.g. `SP_InventoryOverAllStockList`, `INV_TXN_VIEW_GetRequisitionItemsInfoForView`). On D1 (SQLite) these will need to be re-expressed as parameterized queries or as application-level orchestration.
- **Numbering** — `InventoryReceiptNumberService` logic is straightforward to port but must use transactions to avoid duplicate numbers under load.
- **Verification** — The shared `TXN_Verification` model is used by other modules too. Coordinate with the verification/HR/billing migrations so a single multi-tenant verification service is the upstream.
- **Hard-coded secrets** — `InventoryEmailController` ships a hard-coded SendGrid API key. Replace with `wrangler secret` in the migrated Worker.
- **Domain methods on stock models** — `StoreStockModel` and `StockMasterModel` use rich methods (`AddStock`, `DecreaseStock`, `ConfirmStock…`) that write to multiple tables inside a single transaction. Preserve the transaction boundary when porting.
- **EAN/HSN/registration** — Items carry `MSSNO`, `HSNCODE`, `RegisterPageNumber` for Nepal-specific tax / regulatory reporting. These are likely to remain in any regional deployment.
- **Donation + GR coupling** — The shared GR flow for purchases and donations is a clean design; replicate it rather than splitting into two services.
- **Fixed-asset per-unit barcode** — The current implementation auto-generates barcodes from a counter starting at `1111111` and increments numerically. This is simple but does not guarantee uniqueness across hospitals — consider UUIDs for the migrated version.
- **TDS / withholding** — `VendorMasterModel.IsTDSApplicable`, `Tds`, `GoodsReceiptModel.TDSRate/Amount/TotalWithTDS` exist but the actual TDS calculation is not implemented in this module — it relies on the accounting module.

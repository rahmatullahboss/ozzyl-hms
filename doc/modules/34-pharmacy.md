# Pharmacy Module

Source reference: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Pharmacy/` (controllers) and `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/PharmacyModels/` (models).

## 1. Module Overview

The Pharmacy module manages the entire medication lifecycle of a hospital. It covers drug master data, multi-store inventory (main store + dispensaries + substores + ward stores), purchase orders, goods receipts, batch/expiry tracking, stock transfers, sales billing (cash + credit + co-payment + scheme), provisional items, deposits, settlements, sales returns, supplier returns, write-offs, narcotic records, patient consumption (ward consumption), prescription handling, rack allocation, reporting, supplier ledger, and dashboard analytics.

Architectural style:

- ASP.NET MVC controllers (route-based) using `PharmacyDbContext` (Entity Framework 6) and supporting contexts (`BillingDbContext`, `PatientDbContext`, `MasterDbContext`, `RbacDbContext`, `AdmissionDbContext`, `PatientConsumptionDbContext`, `SSFDbContext`).
- One `PharmacyBL` static helper class containing the heaviest domain transactions (`GoodReceiptTransaction`, `InvoiceTransaction`, `ReturnFromCustomerTransaction`, `WriteOffItemTransaction`, `StockManageTransaction`, `StoreManageTransaction`, `TransferStoreStockToDispensary`, `ProvisionalItem`, `SaveProvisionalInvoice`, `ManualReturnTransaction`, etc.).
- A new RESTful API surface added alongside the legacy `reqType` parameter-style controller `PharmacyController`. Modern controllers (`PharmacySalesController`, `PharmacyPrescriptionController`, `PharmacyPOController`, `PharmacyPurchaseController`, `PharmacyPurchaseReturnController`, `PharmacySalesReturnController`, `PharmacySettlementController`, `PharmacyStockController`, `PharmacySettingsController`, `PharmacyRackController`, `PharmacyCreditController`, `PharmacyCreditNoteController`, `PharmacyDashboardController`, `PHRMSupplierLedgerController`, `PatientConsumptionController`) each live in their own class and use attribute routing (`[HttpGet("Route")]` / `[HttpPost("Route")]`).
- Pharmacy has its own main view controller (`PharmacyViewController`) returning Razor views (MVC) for legacy pages and a separate Angular SPA at `wwwroot/DanpheApp/src/app/pharmacy/`.

Storage topology: All data is multi-tenant scoped through `DanpheEMR.DalLayer.PharmacyDbContext` mapping to SQL Server tables prefixed `PHRM_`. The store/dispensary entity is shared via `PHRM_Store` (one table serves main stores, dispensaries, substores, ward stores; differentiated by `Category`/`SubCategory`).

Key business capabilities:

- Multi-store stock with batch and expiry awareness (FEFO sale logic via grouping on `ExpiryDate`).
- Per-item, per-price-category pricing (`PHRM_MAP_MstItemsPriceCategory`).
- Multi-mode payment (cash, credit, deposit, copayment) with per-transaction cash tracking (`PHRMEmployeeCashTransaction`).
- Scheme / insurance / co-payment billing with credit-limit consumption (`PatientSchemeMaps`, `MedicareMembers`, `Schemes`).
- Insurance claim bookkeeping (Pharmacy -> SSF / Claim Management).
- Audit logging on financial transaction entities (`[AuditInclude]` attribute on `PHRMBillTransactionModel`, `PHRMInvoiceTransactionModel`, `PHRMInvoiceTransactionItemsModel`, `PHRMInvoiceReturnModel`, `PHRMInvoiceReturnItemsModel`, `PHRMBillTransactionItem`).
- Real-time remote sync to IRD (when `RealTimeRemoteSyncEnabled`).
- Dashboard analytics via stored procedures (`SP_Dashboard_PHRM_*`).

## 2. Backend Files

### 2.1 Controllers (all under `Controllers/Pharmacy/`)

| File | Responsibility | Key methods/endpoints |
|---|---|---|
| `PharmacyController.cs` (6,810 lines) | Legacy catch-all `reqType`-style controller. Covers supplier/company/category/UOM/item/tax/PO list/PO items/GR list/return-to-supplier list/stock details/narcotic stock/prescription list/all sale invoices/credit organizations/patient deposits/provisional items/etc. Dispatches to `PharmacyBL` and direct DB queries. | `GET api/Pharmacy` with `reqType` enum covering 70+ behaviors. Also `GET GetPatientList`, `GetGoodReceiptHistory`, `GetInvoiceHeader/{Module}`, `GetGRDetailsByGRId`, `GetPODetailsByPOID`, `GetInvoiceReceiptByInvoiceId/{InvoiceId}`, `GetMainStoreStock/{ShowAllStock}`, `GetMainStoreIncomingStock`, `GetMainStoreIncomingStockById/{DispatchId}`, `GetItemListForManualReturn`, `GetAvailableBatchesByItemId/{ItemId}`, `GetRequisitionDetailsForDispatch/{RequisitionId}`, `GetPharmacySalePatient/{IsInsurance}`, `GetDateFilteredGoodsReceiptList`. `POST postInvoiceHeader`, `PostDirectDispatch`, `PostInvoice`, `PostReturnFromCustomer`, `PostStoreDispatch`, `PostSubStoreDispatch`. `PUT putInvoiceHeader`, `UpdateStockMRP`, `UpdateStockExpiryDateandBatchNo`, `ReceiveIncomingStock/{DispatchId}`, `UpdateNMCNo/{EmployeeId}`, `GetMultipleInvoiceItemsToReturn`, `ReceiptDetailToPrintMultipleInvoiceReturn`. |
| `PharmacyBL.cs` (3,892 lines) | Static business-logic class. Encapsulates transactions that touch many tables. | `GoodReceiptTransaction`, `InvoiceTransaction`, `ReturnFromCustomerTransaction`, `WriteOffItemTransaction`, `StockManageTransaction`, `StoreManageTransaction`, `TransferStoreStockToDispensary`, `DirectDispatch`, `ProvisionalItem`, `SaveProvisionalInvoice`, `ManualReturnTransaction`, `PostReturnMultipleInvoiceFromCustomer`, `SearchPatient`, `UpdateMRPForAllStock`, `UpdateStockExpiryDateandBatchNoForAllStock`, `UpdateReconciledStockFromExcel`, `GetFiscalYear`, `GetInvoiceNumber`, `GetDepositReceiptNo`, `SyncPHRMBillInvoiceToRemoteServer`, `RegisterPatient`. |
| `PharmacySalesController.cs` (2,401 lines) | Dispensary-side sales (current RESTful API). | `GET ProvisionalDrugRequisitionsByStatus`, `AllProvisionalDrugRequisitions`, `DispensaryAvailableStocksDetail`, `Invoices`, `InvoiceItems`, `PatientInfo`, `PatientBillingSummary`, `PatientDeposits`, `PatientBillHistory`, `PatientsProvisionalInfo`, `PatientProvisionaItems`, `ProvisionalReturnInfo`, `GetPatientList`, `InvoiceReceiptByInvoiceId`, `PharmacySalePatient`, `DispensaryAvailableStock`, `PrescriptionItems`. `POST Invoice` (finalize), `ProvisionalInvoice`, `FinalInvoiceFromProvisional`, `Deposit`, `OutdoorPatient`, `DrugRequisitions_NotImplemented`. `PUT ProvisionalInvoice` (update), `CancelProvisionalInvoice`, `ProvisionalItemsCancel`, `InvoicePrintCount`, `DepositPrintCount`, `UpdatePrescriptionOrderStatus`. |
| `PharmacyPrescriptionController.cs` | Doctor prescription list & creation. | `GET PatientsPrescriptions`. `POST NewPrescription`, `NewPrescriptionItem`. |
| `PharmacyPOController.cs` (249 lines) | RESTful PO + GR history. | `GET {id}` (PO for edit), `GET` (all POs), `GET GoodsReceiptHistory`, `GRDetailsByGRId`, `PODetailsByPOID`, `DateFilteredGoodsReceiptList`, `ItemRateHistory`, `ItemFreeQuantityReceivedHistory`, `MRPHistory`. `PUT` (update PO). |
| `PharmacyPurchaseController.cs` (1,030 lines) | PO list/info + GR list + supplier ledger + verifier list + items. | `GET Orders`, `OrderInfo`, `GoodReceipts`, `SuppliersLedgerInfo`, `SupplierLedgerInfo`, `GoodsReceiptInfo`, `GoodsReceiptReturnInfo`, `OrderItemsToGoodsReceipt`, `GoodsReceiptDetailsByItemId`, `GoodsReceiptForEdit`, `Verifiers`, `Items`. `POST Order`, `GoodsReceipt`, `GoodsReceiptCancel`. `PUT Order`, `GoodsReceipt`. |
| `PharmacyPurchaseReturnController.cs` (609 lines) | Return-to-supplier flow. | `GET GoodsReceiptsInfo`, `ReturnedList`, `ReturnDetail`, `GRDetailWithAvailableStock`. `POST NewReturnDetail`. |
| `PharmacySalesController` already listed above. |
| `PharmacySalesReturnController.cs` (759 lines) | Sale return + manual return + multi-invoice return. | `GET CreditNotes`, `CreditNoteInfo`, `CreditNotesInfo`, `InvoiceAndItemsDetailForReturn`, `ProvisionalReturns`, `PatientProvisionalReturnItems`, `ItemListForManualReturn`, `MultipleInvoiceItemsToReturn`. `POST ReturnFromCustomer`, `ManualReturn`, `ReturnMultipleInvoiceItemsFromCustomer`. |
| `PharmacySettingsController.cs` (1,243 lines) | Master data, dispensaries, stores, sub-stores, supplier, company, category, UOM, tax, generic, item, sales-category, credit org, NMC number, invoice header logo, price category, CC charge, fiscal year, rack allocation. | `GET ActiveSuppliers`, `Suppliers`, `Counters`, `CreditOrganizations`, `ItemTypes`, `PackingTypes`, `ItemsWithAllDetails`, `Taxes`, `Items`, `ItemsByItemTypeId`, `Companies`, `ItemCategories`, `UnitOfMeasurements`, `MainStore`, `Generics`, `ItemsByDispensaryId`, `SalesCategories`, `Stores`, `SubStores`, `PharmacyStores`, `RackNoByItemIdAndStoreId`, `FiscalYearList`, `InvoiceHeader`. `POST Supplier`, `Company`, `Dispensary`, `SalesCategory`, `PharmacyCategory`, `Item`, `Tax`, `Generic`, `UnitOfMeasurement`, `ItemType`, `PackingType`, `CreditOrganization`, `InvoiceHeader`, `PriceCategory`, `UpdateReconciledStockFromExcelFile`. `PUT Supplier`, `Company`, `Dispensary`, `Category`, `UnitOfMeasurement`, `ItemType`, `PakingType`, `Item`, `Tax`, `Generic`, `ItemToRack`, `CreditOrganization`, `InvoiceHeader`, `CCCharge`, `PriceCategory`. `PUT ~/api/Pharmacy/updateNMCNo/{EmployeeId}`. |
| `PharmacySettlementController.cs` (787 lines) | Insurance/credit settlement (combining multiple unpaid invoices into a single payment receipt). | `GET PendingBills`, `Settlements`, `PatientUnpaidInvoices`, `PreviewInvoice`, `PatientProvisionalItems`, `DuplicatePrints`, `SettlementDetail`. `POST NewSettlement`. `PUT PrintCount`. |
| `PharmacyStockController.cs` (1,041 lines) | Stock queries, write-off, stock manage (batch corrections), store-to-dispensary transfer, requisitions, dispatch, stock reconciliation. | `GET WardRequisitions`, `DrugRequisitions`, `DrugOrders`, `DispatchedDrugItems`, `WriteOffs`, `StockDetails`, `NarcoticsStock`, `WriteOff`, `StockManage`, `StockTransactions`, `AllStockDetails`, `RequsitionItems`, `DispatchDetail`, `Dispatch`, `MainStoreStock`, `MainStoreIncomingStock`, `MainStoreIncomingStockById`, `AvailableBatchesByItemId`, `RequisitionDetailsForDispatch`, `ExportStocksForReconciliationToExcel`. `POST DrugRequsition`, `WriteOff`, `ManageStock`, `ManageStore`, `TransferToDispensary`, `TransferToStore`, `DirectDispatch`, `StoreDispatch`, `SubStoreDispatch`. `PUT StockMRP`, `StockExpiryDateandBatchNo`, `ReceiveIncomingStock/{DispatchId}`. |
| `PharmacyReportController.cs` (2,350 lines) | Reporting via stored procedures. | `GET GetActiveStores`, `GetPharmacyUsersForReturnFromCustomerReport`, `GetOnlyItemNameList`, `PHRMPurchaseOrderReport`, `StockManageReport`, `DepositBalanceReport`, `PHRMUserwiseCollectionReport`, `PHRMCashCollectionSummaryReport`, `PHRMSaleReturnReport`, `PHRMCounterwiseCollectionReport`, `PHRMDailySalesReport`, `PHRMNarcoticsDailySalesReport`, `PHRMBreakageItemReport`, `PHRMReturnToSupplierReport`, `PHRMTransferToStoreReport`, `PHRMTransferToDispensaryReport`, `PHRMGoodsReceiptProductReport`, `PHRMItemWiseStockReport`, `PHRMDispensaryStoreStockReport`, `PHRMNarcoticsDispensaryStoreStockReport`, `PHRMSupplierInformationReport`, `PHRMCreditInOutPatReport`, `PHRMSupplierStockSummaryReport`, `PHRMStockItemsReport`, `PHRMSettlementGRNReport`, `PurchaseSummaryReport`, `InsurancePatientBimaReport`, `PatientSalesDetailReport`, `StockSummarySecondReport`, `PHRMStockTransfersReport`, `PHRMSupplierWiseStockReport`, `GetReturnOnInvestmentReport`, `PHRM_PaymentModeWiseReport`, `RankMembershipwiseSalesReport`, `GetAllMembership`, `GetAllRank`, `PharmacyDailySalesSummaryReport`, `InOutPatientDetails`. Plus Excel exports: `ExportToExcelPHRMCounterwiseCollectionReport`, `ExportToExcelPHRMBreakageItemReport`, `ExportToExcelPHRMSupplierInfoReport`, `ExportToExcelPHRMSupplierStockSummaryReport`, `PHRMDepositLedgerReport`, `PHRM_CashCollectionSummaryReport_DepositLedger`. |
| `PharmacyDashboardController.cs` (top-level, 112 lines) | Dashboard cards. | `GetPharmacyDashboardCardSummaryCalculation(FromDate,ToDate)`, `GetPharmacyDashboardSubstoreWiseDispatchValue(FromDate,ToDate)`, `GetPharmacyDashboardMembershipWiseMedicineSale(FromDate,ToDate)`, `GetPharmacyDashboardMostSoldMedicine(FromDate,ToDate)`. |
| `PharmacyViewController.cs` | Razor view routing for legacy pages (PharmacyMain, Counter, BillingMain, OrderMain, PatientMain, PrescriptionMain, SaleMain, etc.). |
| `PHRMSupplierLedgerController.cs` (84 lines) | RESTful API for supplier ledger. | `GET` (all ledgers), `GET {id}` (single supplier's GRs), `PUT` (make supplier payment). |

### 2.2 Subdirectory controllers

`Controllers/Pharmacy/Credit/PharmacyCreditController.cs` - patient credit sales data: `GET ~/api/GetPatCrDetail/{id}/{visitId}/{fromDate}/{toDate}`.

`Controllers/Pharmacy/CreditNote/PharmacyCreditNoteController.cs` - credit note items endpoint: `GET ~/api/GetCreditNoteItems`, `GET ~/api/GetCreditNote`, `POST`.

`Controllers/Pharmacy/Dashboard/PharmacyDashboardController.cs` - rack-aware dashboard via `IRackService`: `GET api/[controller]`, `GET {id}`, `POST`, `PUT {id}`, `DELETE {id}`.

`Controllers/Pharmacy/PatientConsumption/PatientConsumptionController.cs` (1,340 lines) - inpatient medication consumption (ward-level dispense-and-bill). `GET PatientConsumptions`, `GET PatientConsumptionInfo`, `GET Returns`, `GET ReturnInfo`, `GET ConsumptionInfo`, `GET ConsumptionsOfPatient`, `GET WardSubStoreMapInfo`, `GET PatientConsumptionsOfNursing`, `GET ConsumptionsOfPatientFromNursing`, `GET PharmacyIpBillingScheme`. `POST PharmacyPatientConsumption`, `POST FinalInvoiceForConsumption`, `POST Return`.

`Controllers/Pharmacy/Rack/PharmacyRackController.cs` (337 lines) - rack CRUD + item-to-rack mapping. `GET api/[controller]`, `GET {id}`, `GET ~/api/Rack/GetStoreRackNameByItemId/{ItemId}`, `GET ~/api/GetParentRack`, `GET ~/api/GetAllRack`, `GET ~/api/GetDrugsList/{rackId}/{storeId}`, `GET ~/api/GetAllRackItem`, `GET ~/api/Rack/GetItemRackData/{ItemId}`, `GET ~/api/GetRackList`. `POST`, `POST ~/api/Rack/PHRM_MAP_ItemToRack`, `POST ~/api/Rack/PostPHRM_MAP_ItemToRack`. `PUT {id}`, `DELETE {id}`.

### 2.3 Services (`Services/Dispensary/`)

`DispensaryService.cs`, `IDispensaryService.cs`, `DispensaryRequisitionService.cs`, `IDispensaryRequisitionService.cs`, plus DTOs in `DTOs/`. Used by newer code paths. Methods include `GetAllDispensaries`, `GetAllPharmacyStores`, `GetDispensary`, `AddDispensary`, `UpdateDispensary`, `ActivateDeactivateDispensary`.

## 3. Data Models

(`Code/Components/DanpheEMR.ServerModel/PharmacyModels/`)

### 3.1 Item master and settings

- **PHRMItemMasterModel** (`PHRMItemMasterModel.cs`): PK `ItemId`. Fields: `ItemName`, `ItemCode`, `CompanyId`, `ItemTypeId`, `UOMId`, `ReOrderQuantity`, `MinStockQuantity`, `BudgetedQuantity`, `PurchaseVATPercentage`, `SalesVATPercentage`, `IsVATApplicable`, `PackingTypeId`, `IsInternationalBrand`, `Dosage`, `Frequency`, `Duration`, `GenericId`, `ABCCategory`, `Rack`, `StoreRackId`, `SalesCategoryId`, `VED`, `CCCharge`, `IsNarcotic`, `IsInsuranceApplicable`, `GovtInsurancePrice`, `PurchaseRate`, `SalesRate`, `PurchaseDiscount`. Navigation: `PHRM_MAP_MstItemsPriceCategories`.
- **PHRMGenericModel**: PK `GenericId`. `GenericName`, `CategoryId`, `GeneralCategory`, `TherapeuticCategory`, `Counseling`, `IsAllergen`. `PHRM_MAP_MstItemsPriceCategories` collection.
- **PHRMGenericDosageNFreqMap**: PK `GenericDosageMapId`. `GenericId`, `GenericName`, `Dosage`, `Route`, `Frequency`, `FreqInWords` (read-only master data; not persisted in the standard schema).
- **PHRMCategoryModel**: PK `CategoryId`. `CategoryName`, `Description`, `IsActive`.
- **PHRMItemTypeModel**: PK `ItemTypeId`. `CategoryId`, `ItemTypeName`, `Description`, `IsActive`, virtual `Items`.
- **PHRMCompanyModel**: PK `CompanyId`. `CompanyName`, `ContactNo`, `Description`, `ContactAddress`, `Email`, `IsActive`.
- **PHRMSupplierModel**: PK `SupplierId`. `SupplierName`, `ContactNo`, `Description`, `City`, `PANNumber`, `DDA`, `ContactAddress`, `AdditionalContactInformation`, `Email`, `IsActive`, `CreditPeriod`, `IsLedgerRequired`. NotMapped: `LedgerId`, `LedgerType`.
- **PHRMUnitOfMeasurementModel**: PK `UOMId`. `UOMName`, `Description`, `IsActive`.
- **PHRMPackingTypeModel**: PK `PackingTypeId`. `PackingName`, `PackingQuantity`, `IsActive`.
- **PHRMTAXModel**: PK `TAXId`. `TAXName`, `TAXPercentage`, `Description`.
- **PHRMStoreSalesCategoryModel**: PK `SalesCategoryId`. `Name`, `Description`, `IsBatchApplicable`, `IsExpiryApplicable`, `IsActive`.
- **PHRMCounter** (`PharmacyCounter.cs`): PK `CounterId`. `CounterName`, `CounterType`, `BeginningDate`, `ClosingDate`.
- **PHRMCreditOrganizationsModel**: PK `OrganizationId`. `OrganizationName`, `IsActive`, `IsDefault`.
- **PHRMMAP_MstItemsPriceCategory**: PK `PriceCategoryMapId`. `PriceCategoryId`, `ItemId`, `Price`, `DiscountApplicable`, `ItemLegalCode`, `ItemLegalName`, `Discount`, `IsActive`, `GenericId`. (Per-item per-price-category price + discount settings.)
- **PHRMRackModel**: PK `RackId`. `ParentId`, `StoreId`, `RackNo`, `Description`. Self-referencing rack hierarchy.
- **PHRM_MAP_ItemToRack**: PK `MappingId`. `StoreId`, `RackId`, `ItemId`, `IsActive`. Maps an item to a rack per store.
- **ManageStockItem** (VM): `ItemId`, `StockId`, `BatchNo`, `ExpiryDate`, `InOut`, `Remark`, `UpdatedQty`, `CostPrice`, `StoreId` (helper used by `manage-store-detail` endpoint).
- **PHRMStoreRequisitionModel**: PK `RequisitionId`. `FiscalYearId`, `RequisitionNo`, `StoreId`, `RequisitionDate`, `RequisitionStatus`, `IsVerificationEnabled`, `VerifierIds`, `VerificationId`, cancel fields. Navigation: `RequisitionItems`.
- **PHRMStoreRequisitionItemsModel**: PK `RequisitionItemId`. `ItemId`, `Quantity`, `ReceivedQuantity`, `PendingQuantity`, `RequisitionId`, `RequisitionItemStatus`, `Remark`, `CancelQuantity`, cancel fields.
- **PHRMDispatchItemsModel**: PK `DispatchItemsId`. `DispatchId`, `SourceStoreId`, `TargetStoreId`, `ItemId`, `RequisitionId`, `RequisitionItemId`, `BatchNo`, `ExpiryDate`, `CostPrice`, `SalePrice`, `DispatchedQuantity`, `DispatchedDate`, `ReceivedBy`, `ItemRemarks`, `Remarks`, `ReceivedRemarks`, `CreatedBy`, `CreatedOn`, `ReceivedById`, `ReceivedOn`, `GenericId`, `PendingQuantity`.

### 3.2 Stock master & transactions

- **PHRMStockMaster**: PK `StockId`. `ItemId`, `BatchNo`, `ExpiryDate`, `CostPrice`, `SalePrice`, `MRP`, `BarcodeId`, navigation to `StoreStocks` and `StockBarcode`. Domain methods: `UpdateMRP`, `UpdateBatch`, `UpdateExpiry`, `ActivateStock`, `DeactivateStock`, `UpdateNewCostPrice`. Implements `IEquatable`.
- **PHRMStoreStockModel**: PK `StoreStockId`. `StoreId`, `StockId`, `ItemId`, `AvailableQuantity`, `UnConfirmedQty_In`, `UnConfirmedQty_Out`, `CostPrice`, `SalePrice`, `IsActive`, virtual `StockMaster`. Methods: `UpdateAvailableQuantity`, `IncreaseUnconfirmedQty`, `DecreaseUnconfirmedQty`, `UpdateNewCostPrice`, `UpdateMRP`. (The pivot between stock master and a particular store.)
- **PHRMStockTransactionModel**: PK `StockTransactionId`. `TransactionDate`, `StoreId`, `StockId`, `StoreStockId`, `FiscalYearId`, `ItemId`, `BatchNo`, `ExpiryDate`, `TransactionType`, `InQty`, `OutQty`, `CostPrice`, `SalePrice`, `ReferenceNo`, `Remarks`, `IsActive`, `IsTransferedToAcc`, `CreatedBy`, `CreatedOn`. Methods: `SetInOutQuantity` (enforces either in>0 xor out>0), `UpdateBatch`, `UpdateExpiry`, `UpdateCostPrice`, `UpdateMRP`.
- **PHRMStockBarcode**: PK `BarcodeId` (not DB-generated). `ItemId`, `BatchNo`, `ExpiryDate`, `SalePrice`.
- **PHRMExpiryDateBatchNoHistoryModel**: PK `PHRMStockBatchExpiryHistoryId`. `StockId`, `BatchNo`, `ExpiryDate`, `StartDate`, `EndDate`, `CreatedBy`.
- **PHRMMRPHistoryModel**: PK `PHRMStockMRPHistoryId`. `SalePrice`, `StartDate`, `EndDate`, `StockId`, `CreatedBy`.

### 3.3 Purchase order & goods receipt

- **PHRMPurchaseOrderModel**: PK `PurchaseOrderId`. `SupplierId`, `FiscalYearId`, `PurchaseOrderNo`, `ReferenceNo`, `PODate`, `POStatus` (active/partial/complete/cancelled), `SubTotal`, `CCChargeAmount`, `DiscountAmount`, `VATAmount`, `TotalAmount`, `DeliveryAddress`, `InvoicingAddress`, `Contact`, `DeliveryDays`, `DeliveryDate`, `Remarks`, `TermsId`, `TermsConditions`, `DiscountPercentage`, `TaxableAmount`, `NonTaxableAmount`, `Adjustment`, `VerificationId`, `VerifierIds`, `IsVerificationEnabled`, cancel fields. Navigation: `PHRMPurchaseOrderItems`.
- **PHRMPurchaseOrderItemsModel**: PK `PurchaseOrderItemId`. `ItemId`, `PurchaseOrderId`, `Quantity`, `StandardRate`, `ReceivedQuantity`, `PendingQuantity`, `SubTotal`, `DiscountPercentage`, `DiscountAmount`, `VATPercentage`, `VATAmount`, `CCChargePercentage`, `CCChargeAmount`, `TotalAmount`, `POItemStatus` (active/partial/complete/cancelled), `AuthorizedRemark`, `AuthorizedBy`, `AuthorizedOn`, `GenericId`, `FreeQuantity`, `PendingFreeQuantity`, cancel fields.
- **PHRMGoodsReceiptModel**: PK `GoodReceiptId`. `GoodReceiptPrintId`, `PurchaseOrderId`, `InvoiceNo`, `SupplierId`, `GoodReceiptDate`, `SupplierBillDate`, `SubTotal`, `DiscountAmount`, `DiscountPercentage`, `TotalAmount`, `Adjustment`, `Remarks`, `VATAmount`, `VATPercentage`, `IsCancel`, `CancelRemarks`, `CancelBy`, `CancelOn`, `IsTransferredToACC`, `StoreId`, `TransactionType`, `FiscalYearId`, `IsPacking`, `PaymentStatus`, `IsItemDiscountApplicable`, `CreditPeriod`, `CreditOrganizationId`, `CCAmount`, `IsPaymentDoneFromAcc`, `IsGRModified`. Navigation: `GoodReceiptItem`. Plus NotMapped helpers for sales copy.
- **PHRMGoodsReceiptItemsModel**: PK `GoodReceiptItemId`. `GoodReceiptId`, `StockId`, `StoreStockId`, `ItemId`, `ItemName`, `BatchNo`, `ExpiryDate`, `ReceivedQuantity`, `FreeQuantity`, `RejectedQuantity`, `SellingPrice`, `GRItemPrice`, `SubTotal`, `VATPercentage`, `CCCharge`, `DiscountPercentage`, `TotalAmount`, `SalePrice`, `CounterId`, `AvailableQuantity`, `GrPerItemDisAmt`, `GrTotalDisAmt`, `GrPerItemVATAmt`, `IsTransferredToACC`, `StripRate`, `IsPacking`, `IsItemDiscountApplicable`, `PackingQty`, `StripMRP`, `PackingTypeId`, `IsCancel`, `GenericId`, `CCAmount`, `CostPrice`, `MRP`.
- **PHRMGoodsReceiptViewModel**: bundles `goodReceipt` + `purchaseOrder` for unified GR/PO submission.
- **PHRMReturnToSupplierModel**: PK `ReturnToSupplierId`. `CreditNoteId`, `CreditNotePrintId`, `SupplierId`, `GoodReceiptId`, `ReturnStatus`, `ReturnDate`, `SubTotal`, `VATAmount`, `DiscountAmount`, `TotalAmount`, `CCAmount`, `Remarks`, `IsTransferredToACC`. Navigation: `returnToSupplierItems`.
- **PHRMReturnToSupplierItemsModel**: PK `ReturnToSupplierItemId`. `ReturnToSupplierId`, `ItemId`, `GoodReceiptItemId`, `BatchNo`, `FreeQuantity`, `FreeAmount`, `FreeRate`, `Quantity`, `OldItemPrice`, `ItemPrice`, `SubTotal`, `DiscountPercentage`, `DiscountedAmount`, `VATAmount`, `CCAmount`, `ReturnRate`, `ReturnCostPrice`, `VATPercentage`, `TotalAmount`, `ExpiryDate`, `ReturnRemarks`, `SalePrice`, `CreatedBy`, `CreatedOn`.
- **PHRMWriteOffModel**: PK `WriteOffId`. `WriteOffNo`, `WriteOffDate`, `StoreId`, `SubTotal`, `VATAmount`, `DiscountAmount`, `TotalAmount`, `WriteOffRemark`, `IsTransferredToACC`. Navigation: `phrmWriteOffItem`.
- **PHRMWriteOffItemsModel**: PK `WriteOffItemId`. `WriteOffId`, `ItemId`, `BatchNo`, `ItemPrice`, `WriteOffQuantity`, `SubTotal`, `DiscountPercentage`, `VATPercentage`, `TotalAmount`, `WriteOffItemRemark`.
- **PHRMStockManageModel**: PK `StockManageId`. `ItemId`, `BatchNo`, `SalePrice`, `Price`, `Quantity`, `StockTxnItemId`, `VATPercentage`, `SubTotal`, `TotalAmount`, `Remark`, `ExpiryDate`, `InOut` (in/out), `UpdatedQty`. (One-shot stock adjustments.)

### 3.4 Patient, prescription, consumption

- **PHRMPatient**: PK `PatientId`. `FirstName`, `MiddleName`, `LastName`, `ShortName`, `Age`, `MembershipTypeId`, `Address`, `PhoneNumber`, `PatientNo`, `DateOfBirth`, `Gender`, `PhoneAcceptsText`, `IsDobVerified`, `PatientCode`, `IsActive`, `IsOutdoorPat`, `PANNumber`, `CountrySubDivisionId`, `CountryId`, `Ins_HasInsurance`, `Ins_NshiNumber`, `Ins_InsuranceBalance`, `Ins_LatestClaimCode`, `IsSSUPatient`, `IsVaccinationPatient`, `IsVaccinationActive`, `SSU_IsActive`, `Posting`, `Rank`. NotMapped visit-related: `PrescriberId`, `IsAdmitted`, `VisitDate`, `PriceCategoryId`, `DiscountPercent`, `PatientVisitId`, `ClaimCode`, `VisitType`, `SchemeId`, `LatestClaimCode`, `SchemeName`, `PolicyNo`.
- **PHRMPrescriptionModel**: PK `PrescriptionId`. `PatientId`, `PrescriberId`, `Notes`, `CreatedBy`, `CreatedOn`, `PrescriberName`, `IsInPatient`, `PrescriptionStatus`. Navigation: `PHRMPrescriptionItems`. NotMapped: `PatientName`.
- **PHRMPrescriptionItemModel**: PK `PrescriptionItemId`. `PrescriptionId`, `PatientId`, `PrescriberId`, `ItemId`, `Quantity`, `Frequency`, `StartingDate`, `HowManyDays`, `Notes`, `CreatedBy`, `CreatedOn`, `OrderStatus` (active/final), `Dosage`, `GenericId`, `ModifiedBy`, `ModifiedOn`, `DiagnosisId`. NotMapped: `PerformerName`, `ItemName`, `IsAvailable`.
- **PHRMDrugsRequistionModel**: PK `RequisitionId`. `VisitId`, `PatientId`, `Status` (pending/Complete), `ReferenceId` (comma-separated invoice-item ids after dispatch), `CreatedBy`, `CreatedOn`. Navigation: `RequisitionItems`.
- **PHRMDrugsRequistionItemsModel**: PK `RequisitionItemId`. `RequisitionId`, `ItemId`, `Quantity` (large set of `[NotMapped]` fields for client display).
- **PHRMNarcoticRecord**: PK `NarcoticRecordId`. `BuyerName`, `EmployeId`, `ItemId`, `Quantity`, `DoctorName`, `NMCNumber`, `InvoiceId`, `InvoiceItemId`, `Batch`, `Refill`, `ImgUrl`, `CreatedBy`, `CreatedOn`.
- **PatientConsumptionModel** (`PatientConsumption/PatientConsumptionModel.cs`): PK `PatientConsumptionId`. `FiscalYearId`, `ConsumptionReceiptNo`, `PatientId`, `PatientVisitId`, `SubTotal`, `DiscountAmount`, `TotalAmount`, `BillingStatus` (unpaid/paid), `SchemeId`, `StoreId`, `PrescriberId`, audit fields, navigation `PatientConsumptionItems`.
- **PatientConsumptionItemModel**: PK `PatientConsumptionItemId`. `PatientConsumptionId`, `PatientId`, `PatientVisitId`, `VisitType`, `ItemId`, `ItemName`, `GenericId`, `GenericName`, `BatchNo`, `ExpiryDate`, `Quantity`, `SalePrice`, `FreeQuantity`, `SubTotal`, `TotalAmount`, `DiscountPercentage`, `DiscountAmount`, `VatPercentage`, `VatAmount`, `CounterId`, `StoreId`, `PrescriberId`, `PriceCategoryId`, `SchemeId`, `IsFinalize`, audit fields.
- **PatientConsumptionReturnItemModel**: PK `PatientConsumptionReturnItemId`. Same shape as consumption item plus `PatientConsumptionItemId`, `ConsumptionReturnReceiptNo`.

### 3.5 Sales, settlement, deposit, return

- **PHRMBillTransactionModel** (`PHRMBillTransactionModel.cs`): PK `BilTransactionId`. Older Bill header (audit-included). `PatientId`, `CounterId`, `PaidDate`, `TransactionType`, `TotalQuantity`, `SubTotal`, `DiscountPercentage`, `DiscountAmount`, `VATPercentage`, `VATAmount`, `TotalAmount`, `PaidAmount`, `AmountFromDeposit`, `CreditAmount`, `BilStatus`, `PrintCount`. Navigation: `BillTransactionItems`.
- **PHRMBillTransactionItem** (`PHRMBillTransactionItems.cs`): PK `BilTransactionItemId`. `BilTransactionId`, `ItemId`, `ItemName`, `BatchNo`, `PatientId`, `CounterId`, `ItemPrice`, `SellingPrice`, `Quantity`, `FreeQuantity`, `SubTotal`, `DiscountPercentage`, `DiscountAmount`, `VATPercentage`, `VATAmount`, `TotalAmount`, `PaidAmount`, `PaidDate`, `TransactionType`, `ReferenceId`, `BillStatus`, `Remarks`. Audit-included.
- **PHRMInvoiceTransactionModel** (`PHRMInvoiceModel.cs`): PK `InvoiceId`. Current invoice header (audit-included). `StoreId`, `InvoicePrintId`, `PatientId`, `IsOutdoorPat`, `CounterId`, `TotalQuantity`, `SubTotal`, `DiscountAmount`, `DiscountPer`, `VATAmount`, `TotalAmount`, `PaidAmount`, `BilStatus` (paid/unpaid), `CreditAmount`, `Tender`, `Change`, `PrintCount`, `Adjustment`, `Remark`, `CreatedBy`, `CreateOn`, `IsReturn`, `IsRealtime`, `IsRemoteSynced`, `IsTransferredToACC`, `VisitType`, `PrescriberId`, `DepositDeductAmount`, `PaymentMode`, `FiscalYearId`, `SettlementId`, `PaidDate`, `Creditdate`, `OrganizationId`, `ClaimCode` (Int64), `ReceivedAmount`, `IsCopayment`, `CoPaymentCreditAmount`, `PatientVisitId`, `SchemeId`. Navigation: `InvoiceItems`. NotMapped: `FiscalYear`, `ShortName`, `PANNumber`, `DepositAmount`, `DepositBalance`, `IsInsurancePatient`, `PHRMEmployeeCashTransactions`, `CreditBillStatus`, `PolicyNo`. Includes `GetCloneWithItems` static helper.
- **PHRMInvoiceTransactionItemsModel** (`PHRMInvoiceItemsModel.cs`): PK `InvoiceItemId`. Audit-included. `InvoiceId`, `StoreId`, `CompanyId`, `PatientId`, `ItemId`, `ItemName`, `BatchNo`, `Quantity`, `Price`, `SalePrice`, `NormalSalePrice` (not mapped, used for stock-out verification), `GrItemPrice`, `FreeQuantity`, `SubTotal`, `VATPercentage`, `VATAmount`, `DiscountPercentage`, `TotalAmount`, `BilItemStatus` (paid/unpaid/provisional/cancel/wardconsumption/ProvisionalCancel), `Remark`, `CreatedBy`, `CreatedOn`, `PrescriptionItemId`, `CounterId`, `GrItemId`, `VisitType`, `TotalDisAmt`, `PerItemDisAmt`, `ExpiryDate`, `PrescriberId`, `PriceCategoryId`, `DischargeStatementId`, `PatientVisitId`, `IsCoPayment`, `CoPaymentCashAmount`, `CoPaymentCreditAmount`, `SchemeId`, `ReceiptNo`, `FiscalYearId`. Navigation: `SelectedGRItems` (list of stock rows consumed). NotMapped: `StockId`, `GoodReceiptItemId`, `AvailableQuantity`, `NarcoticsRecord`, `DispatchQty`, `ReturnQty`, `InvoicePrintId`, `PatientName`, `CreatedOnNp`, `WardName`, `WardUser`, `DoctorName`, `NMCNumber`, `StoreName`, `StockMRP`, `GenericName`, `RackNo`, `PatientConsumptionItemId`, `PatientConsumptionId`, `ConsumptionReturnItemIds`. `GetClone` static helper.
- **PHRMInvoiceReturnModel** (`PHRMInvoiceReturnModel.cs`): PK `InvoiceReturnId`. Audit-included. `InvoiceId`, `StoreId`, `PatientId`, `CounterId`, `CreditNoteId`, `SubTotal`, `DiscountAmount`, `VATAmount`, `TotalAmount`, `PaidAmount`, `Tender`, `Change`, `PrintCount`, `Adjustment`, `CreatedBy`, `CreatedOn`, `IsRealtime`, `IsRemoteSynced`, `IsTransferredToACC`, `PaymentMode`, `FiscalYearId`, `Remarks`, `ClaimCode`, `IsManualReturn`, `ReferenceInvoiceNo`, `ReferenceInvoiceDate`, `SettlementId`, `OrganizationId`, `ReturnCashAmount`, `ReturnCreditAmount`, `IsCoPayment`, `VisitType`. Navigation: `InvoiceReturnItems`. NotMapped: `VATPercentage`, `TaxableAmount`, `NonTaxableAmount`, `CashDiscount`, `PolicyNo`, `PriceCategoryId`, `SchemeId`.
- **PHRMInvoiceReturnItemsModel** (`PHRMInvoiceReturnItemsModel.cs`): PK `InvoiceReturnItemId`. Audit-included. `InvoiceReturnId`, `InvoiceItemId`, `InvoiceId`, `StoreId`, `BatchNo`, `Quantity`, `SalePrice`, `Price`, `SubTotal`, `VATPercentage`, `DiscountPercentage`, `TotalDisAmt`, `PerItemDisAmt`, `DiscountAmount`, `TotalAmount`, `Remark`, `CreatedBy`, `CounterId`, `CreatedOn`, `IsTransferredToACC`, `ItemId`, `CreditNoteNumber`, `ReturnedQty`, `ExpiryDate`, `FiscalYearId`.
- **PHRMSettlementModel** (`PHRMSettlementModel.cs`): PK `SettlementId`. `FiscalYearId`, `SettlementReceiptNo`, `SettlementDate`, `SettlementType`, `PatientId`, `PayableAmount`, `RefundableAmount`, `PaidAmount`, `ReturnedAmount`, `DepositDeducted`, `DueAmount`, `DiscountAmount`, `PaymentMode`, `PaymentDetails`, `CounterId`, `CreatedBy`, `CreatedOn`, `Remarks`, `PrintCount`, `PrintedOn`, `PrintedBy`, `IsActive`, `CollectionFromReceivable`, `DiscountReturnAmount`, `StoreId`, `OrganizationId`. Navigation: `PHRMInvoiceTransactions`, `Patient`, `PHRMEmployeeCashTransactions`.
- **PHRMDepositModel** (`PHRMDepositModel.cs`): PK `DepositId`. `StoreId`, `FiscalYearId`, `ReceiptNo`, `PatientVisitId`, `PatientId`, `DepositType` (deposit/depositreturn/depositdeduct), `DepositAmount`, `Remark`, `CounterId`, `PrintCount`, `PaymentMode`, `PaymentDetails`, `TransactionId`, `SettlementId`, `CreatedBy`, `CreatedOn`, `DepositBalance`. NotMapped: `FiscalYear`, `PhrmUser`, `PHRMEmployeeCashTransactions`.
- **PHRMEmployeeCashTransaction** (`PHRMEmployeeCashTransaction.cs`): PK `CashTxnId`. `TransactionType` (CashSales, SalesReturn, DepositAdd, ReturnDeposit, DepositDeduct, etc.), `ReferenceNo`, `EmployeeId`, `InAmount`, `OutAmount`, `Description`, `TransactionDate`, `IsActive`, `CounterID`, `ModuleName`, `PatientId`, `PaymentModeSubCategoryId`, `Remarks`, `FiscalYearId`, `IsTransferredToAcc`. (Tracks cash drawer movement per user.)
- **PHRMTransactionCreditBillStatus** (`PHRMTransactionCreditBillStatus.cs`): PK `PhrmCreditBillStatusId`. `FiscalYearId`, `InvoiceId`, `InvoiceNoFormatted`, `InvoiceDate`, `PatientVisitId`, `SchemeId`, `LiableParty`, `PatientId`, `CreditOrganizationId`, `MemberNo`, `SalesTotalBillAmount`, `ReturnTotalBillAmount`, `CoPayReceivedAmount`, `CoPayReturnAmount`, `NetReceivableAmount`, `NonClaimableAmount`, `IsClaimable`, `ClaimSubmissionId`, `ClaimCode`, `SettlementId`, `SettlementStatus` (Pending/Settled/...), `IsActive`, audit fields. Navigation: `Invoice`. (Insurance-claim tracking.)
- **PHRMTransactionCreditBillItemStatusModel** (`PHRMTransactionCreditBillItemStatusModel.cs`): PK `PhrmCreditBillItemStatusId`. `PhrmCreditBillStatusId`, `InvoiceId`, `InvoiceItemId`, `ItemId`, `NetTotalAmount`, `IsClaimable`, audit fields. (Per-item insurance claim flag.)
- **PHRMStoreModel** (`PHRMStoreModel.cs`): PK `StoreId`. `Category` (store/dispensary/substore), `SubCategory` (pharmacy/inventory/insurance), `ParentStoreId`, `Name`, `StoreDescription`, `PermissionId`, `MaxVerificationLevel`, `StoreLabel`, `PanNo`, `Code`, `Address`, `ContactNo`, `Email`, `UseSeparateInvoiceHeader`, `PrintInvoiceHeaderInDotMatrix`, audit fields. `IsDispensary` => `Category == "dispensary"`. `PaymentModesSettings` JSON (`AvailablePaymentModesJSON`/`DefaultPaymentMode`) - dispensary payment modes (cash by default). Inventory receipt number settings (`INV_GRGroupId`, `INV_POGroupId`, `INV_PRGroupId`, `INV_ReqDisGroupId`, `INV_RFQGroupId`, `INV_ReceiptDisplayName`, `INV_ReceiptNoCode`).
- **PharmacyFiscalYear** (`PharmacyFiscalYearModel.cs`): PK `FiscalYearId`. `FiscalYearName`, `StartDate`, `EndDate`, `NpFiscalYearName`, `IsClosed`, `ClosedOn`, `ClosedBy`, `IsActive`.
- **PharmacyCounter**: PK `CounterId` (above).

### 3.6 Supplier ledger, provisional, view models, reports

- **PHRMSupplierLedgerModel** (`PHRMSupplierLedgerModel.cs`): PK `LedgerId`. `SupplierId`, `CreditAmount`, `DebitAmount`, `BalanceAmount`, `IsActive`, audit fields.
- **PHRMSupplierLedgerTransactionModel** (`PHRMSupplierLedgerTransactionModel.cs`): PK `LedgerTransactionId`. `FiscalYearId`, `LedgerId`, `SupplierId`, `DebitAmount`, `CreditAmount`, `Remarks`, `ReferenceNo`, `TransactionType`, `CreatedBy`, `CreatedOn`, `IsActive`.
- **PHRMTransactionProvisionalReturnItemsModel** (`PharmacyModels/Provisional/`): per-provisional-cancellation row. Fields include `ProvisionalReturnItemId`, `InvoiceItemId`, `PatientId`, `PatientVisitId`, `VisitType`, `ItemId`, `ItemName`, `BatchNo`, `ExpiryDate`, `Quantity`, `SalePrice`, `SubTotal`, `DiscountAmount`, `VATAmount`, `TotalAmount`, `ReceiptNo`, `ReferenceProvisionalReceiptNo`, `CancellationReceiptNo`, `DiscountPercentage`, `VATPercentage`, `CoPaymentCashAmount`, `CoPaymentCreditAmount`, `SchemeId`, `PrescriberId`, `IsActive`, audit fields.
- **GoodReceiptItemsViewModel** / **GoodReceiptItemsForSaleViewModel** (`GoodReceiptItemsViewModel.cs`): client DTOs mirroring GR items with available quantity, batch, expiry, sale price.
- **CounterCollectionViewModel.cs** (`TotalCollectionViewModel`, `CounterCollectionViewModel`, `UserCollectionViewModel`): grouping models used by `reqType == "allSaleRecord"`.
- **PHRMSettlementVM** (`PHRMSettlementVM.cs`): `Settlement_PatientInfoVM`, `Settlement_ProvisionalInfoVM`, `Settlement_DepositInfoVM`, `Settlement_InvoicePreview_InvoiceInfoVM`, `Settlement_Info_VM` with static `MapDataTableToSingleObject` helpers.
- **PatientViewModel** (`PatientViewModel.cs`): `PatientId`, `PatientName`, `PatientType`, `HospitalNo`, `PriceCategoryId`, `PatientMapPriceCategoryId`, `CoPaymentCashPercent`, `CoPaymentCreditPercent`, `IsCoPayment`, `PriceCategoryName`, `VisitType`. Plus `InvoiceItemDetailToBeReturn` DTO.
- **PHRMRequisitionStockVM** (`PHRMRequisitionStockVM.cs`): bundles a requisition + dispatch items + stock transactions for one save.
- **PharmacyReportsModel.cs**: `PHRMPurchaseOrderReportModel`, `PHRMItemWiseStockReportModel`, `StockSummaryReportModel`, `StockSummaryDTO` (extensive opening/purchase/sales/provisional/write-off/consumption/stock-manage/transfer columns used by reports).
- **Medication.cs**: `MedicationModel` (`MedicineId`, `MedicineName`) - lookup table for medicine master.
- **CreditSaleViewModel** (`PHRM/Credit/`): `Status`, `PatientId`, `TotalAmount`, `InvoiceItems` - credit sale view.

### 3.7 Frontend Angular structure (`wwwroot/DanpheApp/src/app/pharmacy/`)

- Top-level: `pharmacy-main.component.ts/html`, `pharmacy-routing.module.ts`, `pharmacy.module.ts`.
- `accounting/` - accounting integration views.
- `billing/` - billing flows.
- `common/` - shared pharmacy widgets (item search, batch picker, etc.).
- `counter/` - counter activation/start-of-day.
- `duplicate-prints/` - reprint flows for invoices, returns, settlements.
- `order/` - purchase order + goods receipt feature folders (`phrm-po`, `phrm-gr`, `phrm-gr-item`, `phrm-gr-list`, `phrm-gr-view`, `phrm-order-main.*`, `phrm-po-list`, `phrm-po-view-np`). `pharmacy-po.endpoint.ts`, `pharmacy-po.service.ts` are the core API wrappers.
- `patient-consumption/` - inpatient consumption UI.
- `prescription/` - `phrm-prescription*` components for doctor prescription list + entry.
- `provisional-items/` - provisional sales and cancellations.
- `rack/` - rack management UI.
- `receipt/` - receipt printing.
- `report/` - report viewer.
- `sale/` - `phrm-receipt-print`, `credit-billing`, `invoice-view`, `op-patient-add`, `settlement`.
- `setting/` - master data CRUD (item, supplier, company, tax, generic, UOM, packing, sales category, credit org, dispensary, store, sub-store, rack mapping, CC charge, price category, NMC number, invoice header).
- `shared/` - shared services and components.
- `store/` - main store operations.
- `substore-requisition-dispatch/` - substore requisition and dispatch.
- `supplier-ledger/` - supplier ledger UI.
- `ward-requisition/` - ward (nursing) drug requisition UI.

## 4. Database Tables

The `PharmacyDbContext` (and supporting contexts) map to these SQL Server tables (sample of the most important prefixes; consult the EF DbContext in `Code/Websites/DanpheEMR/DalLayer/` for the full list):

| Table | Purpose |
|---|---|
| `PHRM_MST_Item` | Item master |
| `PHRM_MST_Generic` | Generic names |
| `PHRM_MST_Category` | Drug category |
| `PHRM_MST_ItemType` | Item type within a category |
| `PHRM_MST_Company` | Manufacturing company |
| `PHRM_MST_Supplier` | Supplier master |
| `PHRM_MST_Tax` | Tax slabs |
| `PHRM_MST_UnitOfMeasurement` | UOMs |
| `PHRM_MST_PackingType` | Packing types (e.g., strip 10) |
| `PHRM_MST_StoreSalesCategory` | Sales category with batch/expiry flags |
| `PHRM_MST_Counter` | Billing counters |
| `PHRM_MST_CreditOrganization` | Insurance / corporate credit orgs |
| `PHRM_MST_Rack`, `PHRM_MAP_ItemToRack` | Rack and item-to-rack mapping |
| `PHRM_MST_Store` | Stores, dispensaries, substores |
| `PHRM_MST_DepositHead` | Deposit head (used by dispensary deposit) |
| `PHRM_MAP_MstItemsPriceCategory` | Item price per price category |
| `PHRM_StockMaster` | Stock master (one row per ItemId + BatchNo + Expiry) |
| `PHRM_StoreStock` | Stock by store (links stock master to a store with available qty) |
| `PHRM_StockTransaction` | Stock movements (in/out) by store and reference |
| `PHRM_StockBarcode` | Barcode master per stock |
| `PHRM_StockMRPHistory` | MRP change audit |
| `PHRM_StockBatchExpiryHistory` | Batch/expiry change audit |
| `PHRM_TXN_PurchaseOrder` + `PHRM_TXN_PurchaseOrderItems` | Purchase orders |
| `PHRM_TXN_GoodsReceipt` + `PHRM_TXN_GoodsReceiptItems` | Goods receipts |
| `PHRM_TXN_ReturnToSupplier` + `PHRM_TXN_ReturnToSupplierItems` | Supplier returns (credit notes) |
| `PHRM_TXN_WriteOff` + `PHRM_TXN_WriteOffItems` | Stock write-offs (breakage, expiry) |
| `PHRM_TXN_StockManage` | Stock adjustments |
| `PHRM_TXN_StoreRequisition` + `PHRM_TXN_StoreRequisitionItems` | Substore/ward requisitions |
| `PHRM_TXN_StoreDispatchItems` | Dispatch entries |
| `PHRM_MST_Patient` | Walk-in / outdoor pharmacy patients (separate from core Patient table) |
| `PHRM_TXN_Prescription` + `PHRM_TXN_PrescriptionItems` | Prescriptions |
| `PHRM_TXN_DrugsRequistion` + `PHRM_TXN_DrugsRequistionItems` | Nursing drug requisitions |
| `PHRM_TXN_NarcoticRecord` | Narcotic sales register |
| `PHRM_TXN_Invoice` + `PHRM_TXN_InvoiceItems` | Sale invoices (audit-included) |
| `PHRM_TXN_InvoiceReturn` + `PHRM_TXN_InvoiceReturnItems` | Sale returns (credit notes, audit-included) |
| `PHRM_TXN_Settlement` | Insurance / corporate settlements |
| `PHRM_TXN_Deposit` | Pharmacy deposits |
| `PHRM_TXN_EmployeeCashTransaction` | Per-user cash drawer movements |
| `PHRM_TXN_TransactionCreditBillStatus` + `PHRM_TXN_TransactionCreditBillItemStatus` | Insurance-claim status per bill and item |
| `PHRM_TXN_ProvisionalReturnItems` | Cancellation of provisional items |
| `PHRM_TXN_PatientConsumption` + `PHRM_TXN_PatientConsumptionItems` + `PHRM_TXN_PatientConsumptionReturnItems` | Inpatient consumption (ward dispense) |
| `PHRM_TXN_SupplierLedger` + `PHRM_TXN_SupplierLedgerTransaction` | Supplier ledger |
| `PHRM_FiscalYear` | Pharmacy fiscal year (separate from accounting fiscal year) |
| `PHRM_MST_InvoiceHeader` | Per-module invoice header (logo + signature) |

Note: Actual SQL table names will vary slightly by deployment; the EF model property names map to columns.

## 5. Key Workflows

### 5.1 Master data setup
1. Create categories, item types, UOMs, packing types, sales categories, tax slabs, companies, suppliers, generic names, credit organizations, dispensaries, stores, sub-stores, counters (`PharmacySettingsController`).
2. Add items (`POST Item` in `PharmacySettingsController`). Item creates notification for `Pharmacy` role.
3. Configure per-item price categories (`POST/PUT PriceCategory`).
4. Map items to racks per store (`POST ~/api/Rack/PostPHRM_MAP_ItemToRack`).
5. Configure CC charge (`PUT CCCharge`), invoice header logo (`POST/PUT InvoiceHeader`).

### 5.2 Purchase order
1. `GET Orders?status=active,partial,...` lists POs by status.
2. Create PO (`POST Order` -> `PharmacyBL.PurchaseOrderTransaction`). PO status starts as `active`.
3. POs can be updated (`PUT Order` -> `PharmacyBL.UpdatePurchaseOrder`).
4. Approval / verification: PO has `IsVerificationEnabled`, `VerifierIds`, `VerificationId`. `GetAllVerifiers` retrieves employees for selection.
5. Status transitions: `active` -> `partial` (some items received) -> `complete` (all received) or `cancelled`.

### 5.3 Goods receipt (with or without PO)
1. `GET GoodReceipts`, `GET GoodsReceiptInfo/{id}` for receipt lists and item details.
2. `POST GoodsReceipt` calls `PharmacyBL.GoodReceiptTransaction`. The transaction:
   - Computes discount % and VAT %.
   - Adds the GR header.
   - For each line, creates a `PHRMStockMaster` (generating a `BarcodeId` via `PharmacyStockBarcodeService`).
   - Creates a `PHRMStoreStockModel` (links stock to the main store, qty = received + free).
   - Adds the `PHRMGoodsReceiptItemsModel` with `AvailableQuantity = received + free`.
   - Posts a `PHRMStockTransactionModel` of type `PurchaseItem` (in).
   - If linked to a PO, calls `UpdatePOandPOItemsStatus` to update received/pending quantities and PO/POItem status.
   - Commits.
3. Edit GR (`PUT GoodsReceipt`) re-validates and updates stock.
4. Cancel GR (`POST GoodsReceiptCancel`) cancels and removes the corresponding stock (StockId deactivated, StoreStock.AvailableQuantity set to 0).

### 5.4 Stock manage (batch adjustments)
- `POST ManageStock` -> `PharmacyBL.StockManageTransaction`. Used to manually adjust qty for a batch (lost, found, etc.). Posts a `PHRMStockManageModel` and corresponding `PHRMStockTransactionModel` of type `StockManageItem` (in or out) on the main store.
- `POST ManageStore` -> `PharmacyBL.StoreManageTransaction` adjusts at the dispensary level.
- `PUT StockMRP` updates MRP across all batches of an item (logs `PHRMMRPHistoryModel`).
- `PUT StockExpiryDateandBatchNo` updates batch/expiry and logs `PHRMExpiryDateBatchNoHistoryModel`.
- `GET ExportStocksForReconciliationToExcel` returns an Excel template (with the NewAvailableQuantity column editable). `POST UpdateReconciledStockFromExcelFile` posts the updated quantities to apply reconciliation.

### 5.5 Substore / ward requisition and dispatch
1. Requisition created in `PHRM_TXN_StoreRequisition` + items. Status: `pending` -> `approved` -> `dispatched`.
2. Dispatch: `POST StoreDispatch` (`PharmacyBL.PostStoreDispatch`) or `POST SubStoreDispatch` (`_pharmacyDbContext.PostSubStoreDispatch`). Stock is decremented on the source store and incremented on the target via `PHRMDispatchItemsModel` + paired `PHRMStockTransactionModel` records.
3. `PUT ReceiveIncomingStock/{DispatchId}` confirms receipt (for the in-transit dispatch flow when source and target are different stores).
4. Direct dispatch: `POST DirectDispatch` -> `PharmacyBL.DirectDispatch` allows dispatching without a requisition.

### 5.6 Dispense from dispensary to ward (consumption)
1. Nurse/ward user requests drugs via `PHRM_TXN_DrugsRequistion` (status `pending`).
2. `POST PharmacyPatientConsumption` -> `PatientConsumptionController.PostPatientConsumption`. In a single DB transaction: saves `PatientConsumptionModel` + `PatientConsumptionItemModel` rows and decrements dispensary stock by inserting `PHRMStockTransactionModel` of type `PHRMPatientConsumption` (out). FEFO across available batches of the same price.
3. `POST FinalInvoiceForConsumption` converts a consumption record into a sale invoice (similar to the provisional-to-final flow).
4. `POST Return` reverses a consumption; creates `PatientConsumptionReturnItemModel` and posts `PHRMStockTransactionModel` of type `PHRMPatientConsumptionReturn` (in) on the returning store.

### 5.7 Provisional sales (consume stock, defer payment)
1. `POST ProvisionalInvoice` -> `PharmacyBL.SaveProvisionalInvoice`. Creates `PHRMInvoiceTransactionItemsModel` rows with `BilItemStatus = provisional` and decrements stock via `PHRMStockTransactionModel` of type `ProvisionalSaleItem`.
2. `GET PatientProvisionaItems` lists pending items for a patient. Returns per-item price, VAT, discount, scheme copay percentage, rack.
3. `POST FinalInvoiceFromProvisional` converts provisional items to a final invoice. In one transaction:
   - Calls `SaveInvoiceFromProvisional` (creates `PHRMInvoiceTransactionModel` with status `paid` or `unpaid`).
   - `UpdateInvoiceItems` links provisional items to the new invoice.
   - `SaveStockTransactionAndUpdateStock` posts `ProvisionalToSale` (in) and `SaleItem` (out) stock transactions.
   - `SaveCreditBillStatus` (when payment mode is credit).
   - `HandleDeposit` (when `DepositDeductAmount > 0`).
   - `SaveEmployeeCashTransaction`.
   - `UpdateSchemeCreditLimit` (when scheme is set).
4. `PUT ProvisionalInvoice` (update) and `PUT CancelProvisionalInvoice` cancel items, restock, and update BilItemStatus.
5. `PUT ProvisionalItemsCancel` (legacy `cancelCreditItems`) cancels a whole invoice's provisional items.

### 5.8 Final sale (outdoor + indoor)
1. `POST Invoice` -> `PharmacyBL.InvoiceTransaction`. Validates input, registers outdoor patient if needed (`PharmacyBL.RegisterPatient`), then in one DB transaction:
   - Determines `BilStatus` (paid/unpaid) based on `PaymentMode`.
   - For narcotics, posts `PHRMNarcoticRecord` rows.
   - For credit, posts `PHRMTransactionCreditBillStatus` (insurance claim) per item (and per-item statuses).
   - For deposit deduction, posts `BillingDepositModel` and an `EmpCashTxn` of type `DepositDeduct`.
   - Updates stock via `PHRMStockTransactionModel` of type `SaleItem` (out) for each item.
   - Posts `PHRMEmployeeCashTransaction` rows for cash drawer.
   - Sets `ClaimCode` (Int64) for scheme bills (incremental).
   - When `_realTimeRemoteSyncEnabled` and the bill is a return, posts to IRD in a `Task.Run` (async).
   - For SSF scheme, posts to SSF server in a `Task.Run`.
2. `GET InvoiceReceiptByInvoiceId/{id}` returns the receipt DTO for printing.
3. `PUT InvoicePrintCount` increments `PrintCount`.

### 5.9 Sales return
1. `GET InvoiceAndItemsDetailForReturn` retrieves the original invoice + items with available-return qty.
2. `POST ReturnFromCustomer` -> `PharmacyBL.ReturnFromCustomerTransaction`:
   - Verifies no double-returns (`CheckIfReturnItemsInvalid`).
   - Resolves policy no.
   - Creates `PHRMInvoiceReturnModel` + `PHRMInvoiceReturnItemsModel` rows.
   - Restocks via `PHRMStockTransactionModel` of type `SaleReturnedItem` (in).
   - Posts `PHRMEmployeeCashTransaction` of type `SalesReturn`.
   - Adjusts `PHRMTransactionCreditBillStatus` (decrements SalesTotalBillAmount, increments ReturnTotalBillAmount).
   - Updates Medicare balances if applicable.
   - Posts to IRD and SSF (async) when flags are set.
3. `POST ManualReturn` -> `PharmacyBL.ManualReturnTransaction` for ad-hoc returns (no original invoice).
4. `POST ReturnMultipleInvoiceItemsFromCustomer` for the "return across multiple invoices" flow.
5. `GET CreditNotes` lists all credit notes (`SP_PHRM_GetReturnInvoicesBetweenDateRange`).
6. `GET CreditNoteInfo/{id}` returns the credit note receipt DTO.
7. `GET ProvisionalReturns` + `GET PatientProvisionalReturnItems` for cancelled provisional items.

### 5.10 Deposit
1. `POST Deposit` -> `SaveDeposit` in `PharmacySalesController`.
   - Generates `ReceiptNo` (max+1 per fiscal year).
   - Sets `DepositType` to `DepositAdd`, `DepositDeduct`, or `DepositReturn`.
   - Posts an `EmpCashTxn` (`DepositAdd` or `ReturnDeposit`).
2. `GET PatientDeposits` (or part of `PatientBillingSummary`) returns per-deposit-type sums and net balance.

### 5.11 Insurance / credit settlement
1. `GET PendingBills?storeId=&organizationId=` calls `SP_TXNS_PHRM_SettlementSummary` to list unpaid invoices for a given organization.
2. `GET PatientUnpaidInvoices/{patientId}` lists the patient's unpaid invoices.
3. `GET PatientProvisionalItems` returns the patient's provisional items with scheme details.
4. `POST NewSettlement` (PharmacySettlementController) creates a `PHRMSettlementModel` + updates `PHRMInvoiceTransactionModel.SettlementId` and `PHRMTransactionCreditBillStatus.SettlementId/SettlementStatus` for all invoices in the batch.
5. `PUT PrintCount` increments settlement `PrintCount`.

### 5.12 Purchase return (return to supplier)
1. `GET GoodsReceiptsInfo` lists GRs filterable by supplier/GR-no/invoice-no/date.
2. `GET GRDetailWithAvailableStock` shows current available stock by GR item.
3. `POST NewReturnDetail` (PharmacyPurchaseReturnController) creates `PHRMReturnToSupplierModel` + items, reduces store stock, posts `PHRMStockTransactionModel` of type `ReturnToSupplierItem` (out).
4. `GET ReturnedList` lists returns; `GET ReturnDetail/{id}` shows items + header.

### 5.13 Write-off (breakage, expiry)
1. `POST WriteOff` -> `PharmacyBL.WriteOffItemTransaction`. Validates header and items, decrements store stock, posts `PHRMStockTransactionModel` of type `WriteOffItem` (out).
2. `GET WriteOffs` lists, `GET WriteOff/{id}` shows details.

### 5.14 Rack management
1. `POST api/PharmacyRack` (and `POST` on `api/PharmacyDashboard` for the alt controller) creates racks.
2. `POST ~/api/Rack/PostPHRM_MAP_ItemToRack` maps items to racks. If mapping exists, updates; else inserts.
3. `GET ~/api/Rack/GetItemRackData/{ItemId}` and `GET RackNoByItemIdAndStoreId/{ItemId}/{StoreId}` for read.
4. `PUT {id}` updates, `DELETE {id}` deletes.

### 5.15 Supplier ledger
1. `GET` lists all supplier ledgers; `GET {id}` returns GRs for a supplier (`_supplierLedgerService.GetSupplierLedgerGRDetails`).
2. `PUT` makes payment against the ledger (`MakeSupplierLedgerPayment`). Creates `PHRMSupplierLedgerTransactionModel` rows and updates the running balance.

### 5.16 Counter / day operations
- `GET Counters` and `GET allSaleRecord` (legacy `reqType`) compute:
  - User-wise net sales (using `SettlementId` -> `Settlement.PaidAmount` for settled, or `PaidAmount` otherwise).
  - Counter-wise net sales.
  - Total collection = sales + credit + deposits - returns - returns-of-deposits.
- `POST CounterActivate` etc. live in `PharmacyViewController` for legacy Razor page.

### 5.17 Dashboard
- `SP_Dashboard_PHRM_CardSummaryCalculation` returns sales / GRs / dispatches / stocks.
- `SP_Dashboard_PHRM_SubstoreWiseDispatchValue`, `SP_Dashboard_PHRM_MembershipWiseMedicineSale`, `SP_Dashboard_PHRM_MostSoldMedicine` are individual data points.

### 5.18 Reporting
All under `PharmacyReportController`, mostly via stored procedures. See Section 6 for the endpoint list. Each report is filterable by FromDate, ToDate, store, counter, user, supplier, etc. Excel export variants are suffixed with `ExportToExcel`.

### 5.19 Stock reconciliation
- `GET ExportStocksForReconciliationToExcel` produces a protected .xlsx of the main-store stock with an editable `NewAvailableQuantity` column.
- `POST UpdateReconciledStockFromExcelFile` applies the differences via `PharmacyBL.UpdateReconciledStockFromExcel` (creates `PHRMStockManageModel` rows with `InOut` in or out).

## 6. API Endpoints (excerpt of 50+)

### Pharmacy (legacy catch-all, `Controllers/Pharmacy/PharmacyController.cs`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `api/Pharmacy` (with `reqType` and many query params) | 70+ behaviors: `supplier`, `allSupplier`, `getCounter`, `get-credit-organizations`, `allSaleRecord`, `phrm-pending-bills`, `counterSales`, `SupplierDetails`, `itemtype`, `GetItemType`, `GetPackingType`, `item`, `tax`, `GetAllItems`, `GetItemListByItemTypeId`, `company`, `category`, `unitofmeasurement`, `getPHRMOrderList`, `getPHRMPOItemsByPOId`, `get-provisional-items`, `get-all-provisional-items`, `get-ward-requested-items`, `get-drugs-request-items`, `get-all-drugs-order`, `get-drugs-dispatch-items`, `goodsreceipt`, `get-goods-receipt-groupby-supplier`, `get-goods-receipt-by-SupplierID`, `getMainStore`, `getDispenaryList`, `GRItemsViewByGRId`, `GRItemsViewByGRReturnId`, `getPHRMPOItemsForGR`, `getprescriptionlist`, `PHRMItemListWithTotalAvailableQuantity`, `getBatchNoByItemId`, `getItemDetailsByBatchNo`, `returnToSupplier`, `returnItemsToSupplierList`, `getWriteOffList`, `getGenericList`, `PHRMDailySalesSummaryReport`, `stockDetails`, `natcoticsstockDetails`, `getItemList`, `getGRItemsByItemId`, `GRforEdit`, `getReturnToSupplierItemsByReturnToSupplierId`, `getWriteOffItemsByWriteOffId`, `getsaleinvoicelist`, `getsalereturnlist`, `getsaleinvoiceitemsbyid`, `getsaleinvoiceretitemsbyid`, `getsalereturninvoiceitemsbyid`, `stockManage`, `getReturnFromCustDataModelByInvId`, `GetRackByItem`, `employeePreference`, `getPrescriptionItems`, `getSalesReport`, `getInOutPatientDetails`, `getStockTxnItemList`, `allItemsStockDetails`, `allItemsStock`, `patientSummary`, `getRackList`, `getsalescategorylist`, `getStoreItemList`, `patAllDeposits`, `pending-bills-for-settlements`, `allPHRMSettlements`, `unpaidInvoiceByPatientId`, `get-settlement-single-invoice-preview`, `patientPastBillSummary`, `provisionalItemsByPatientIdForSettle`, `itemwiseRequistionList`, `provisional-return-list`, `provisional-return-duplicate-print`, `settlements-duplicate-prints`, `get-settlements-duplicate-details`, `getGRDetailsToReturnByGoodReceiptId`, etc. |
| GET | `~/api/Pharmacy/GetPatientList` | Patient search for outdoor pharmacy |
| GET | `~/api/Pharmacy/getGoodReceiptHistory` | GRs from last month (canceled excluded) |
| GET | `~/api/Pharmacy/GetInvoiceHeader/{Module}` | Invoice header + logo (image bytes) |
| GET | `~/api/Pharmacy/GetGRDetailsByGRId` | GR view by id |
| GET | `~/api/Pharmacy/GetPODetailsByPOID/{PurchaseOrderId}` | PO view by id |
| GET | `~/api/Pharmacy/GetInvoiceReceiptByInvoiceId/{InvoiceId}` | Invoice receipt DTO |
| GET | `GetMainStoreStock/{ShowAllStock}` | Main store stock via SP |
| GET | `GetMainStoreIncomingStock` | Incoming stock list (date range) |
| GET | `GetMainStoreIncomingStockById/{DispatchId}` | Incoming stock by dispatch id |
| GET | `GetItemListForManualReturn` | Items for manual return |
| GET | `GetAvailableBatchesByItemId/{ItemId}` | Distinct batches for an item |
| PUT | `ReceiveIncomingStock/{DispatchId}` | Confirm receipt of in-transit dispatch |
| GET | `~/api/Pharmacy/GetRequisitionDetailsForDispatch/{RequisitionId}` | Requisition info for dispatch |
| GET | `GetPharmacySalePatient/{IsInsurance}` | Pharmacy patients (insurance or all) |
| GET | `GetDateFilteredGoodsReceiptList` | GRs filtered by date range |
| POST | `~/api/Pharmacy/postInvoiceHeader` | Upload invoice header (logo) |
| POST | `PostDirectDispatch` | Direct dispatch (no requisition) |
| POST | `PostInvoice` | Finalize sale invoice |
| POST | `PostReturnFromCustomer` | Customer return |
| POST | `~/api/Pharmacy/PostStoreDispatch` | Substore/store dispatch |
| POST | `~/api/Pharmacy/PostSubStoreDispatch` | Substore dispatch variant |
| PUT | `~/api/Pharmacy/putInvoiceHeader` | Update invoice header (logo) |
| PUT | `UpdateStockMRP` | Update MRP for all batches of an item |
| PUT | `UpdateStockExpiryDateandBatchNo` | Update batch/expiry for all batches |
| GET | `~/api/Pharmacy/getItemRateHistory` | Item rate history from GR |
| GET | `~/api/Pharmacy/getItemFreeQuantityReceivedHistory` | Free quantity history |
| GET | `~/api/Pharmacy/getMRPHistory` | MRP change history |
| GET | `ExportStocksForReconciliationToExcel` | Stock reconciliation Excel template |
| POST | `UpdateReconciledStockFromExcelFile` | Apply reconciliation |
| PUT | `~/api/Pharmacy/updateNMCNo/{EmployeeId}` | Update prescriber NMC number |
| POST | `AddPriceCategory` | Add item-to-price-category mapping |
| PUT | `UpdatePriceCategory` | Update item-to-price-category mapping |
| GET | `GetAllPharmacyStore` | All active pharmacy stores/dispensaries |
| POST | `~/api/Pharmacy/PostSubStoreDispatch` | Substore dispatch |
| GET | `GetRackNoByItemIdAndStoreId/{ItemId}/{StoreId}` | Rack no for an item in a store |
| GET | `~/api/Pharmacy/GetFiscalYearList` | Active fiscal years |
| GET | `GetMultipleInvoiceItemsToReturn` | Multi-invoice return preview (SP) |
| POST | `ReturnMultipleInvoiceItemsFromCustomer` | Multi-invoice return save |
| GET | `ReceiptDetailToPrintMultipleInvoiceReturn` | Print receipt for multi-invoice return |

### PharmacySales (RESTful, `PharmacySalesController.cs`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `ProvisionalDrugRequisitionsByStatus?status=...` | Nursing drug reqs by status |
| GET | `AllProvisionalDrugRequisitions` | All nursing drug reqs |
| GET | `DispensaryAvailableStocksDetail?dispensaryId=...` | All stock in a dispensary |
| GET | `Invoices?fromDate=&toDate=&dispensaryId=` | Dispensary invoices (SP) |
| GET | `InvoiceItems?invoiceId=...` | Items of a sale invoice |
| GET | `PatientInfo?patientId=...` | Patient + latest visit/scheme details |
| GET | `PatientBillingSummary?patientId=&schemeId=&patientVisitId=` | Deposit, credit, copay, scheme balances |
| GET | `PatientDeposits?patientId=...` | Per-deposit-type sums |
| GET | `PatientBillHistory?patientId=...` | Paid/credit/provisional/cancel history |
| GET | `PatientsProvisionalInfo?dispensaryId=&fromDate=&toDate=` | List of patients with provisional items |
| GET | `PatientProvisionaItems?patientId=&dispensaryId=&patientVisitId=` | Patient provisional items with scheme |
| GET | `ProvisionalReturnInfo?returnReceiptNo=...` | Cancellation receipt details |
| GET | `GetPatientList?SearchText=&IsInsurance=` | Patient search (insurance-aware) |
| GET | `InvoiceReceiptByInvoiceId` | Receipt DTO |
| GET | `PharmacySalePatient?IsInsurance=` | Pharmacy patients list |
| GET | `DispensaryAvailableStock?dispensaryId=&priceCategoryId=` | Stock with batch/expiry (SP) |
| GET | `PrescriptionItems?patientId=&prescriberId=&prescriptionId=` | Doctor prescription items + availability |
| POST | `Invoice` | Create final sale invoice |
| POST | `ProvisionalInvoice` | Save provisional sale |
| POST | `FinalInvoiceFromProvisional` | Convert provisional to final invoice |
| POST | `Deposit` | Save deposit (add/deduct/return) |
| POST | `OutdoorPatient` | Register outdoor pharmacy patient |
| POST | `DrugRequisitions_NotImplemented` | Stub for nursing drug req |
| PUT | `ProvisionalInvoice` | Update provisional items |
| PUT | `CancelProvisionalInvoice` | Cancel a provisional invoice |
| PUT | `ProvisionalItemsCancel` | Cancel one or more provisional items |
| PUT | `InvoicePrintCount?printCount=&invoiceId=` | Increment print count |
| PUT | `DepositPrintCount` | Increment deposit print count |
| PUT | `UpdatePrescriptionOrderStatus?patientId=` | Mark all of a patient's prescription items `final` |

### PharmacyPrescription

| Verb | Route | Purpose |
|---|---|---|
| GET | `PatientsPrescriptions` | Active prescription list grouped by patient |
| POST | `NewPrescription` | Create prescription header + items |
| POST | `NewPrescriptionItem` | Add items to a prescription (qty = Frequency * HowManyDays) |

### PharmacyPO (`api/PharmacyPO`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `{id}` | PO for edit |
| GET | `GoodsReceiptHistory` | Last month's non-canceled GRs |
| GET | `GRDetailsByGRId?GoodsReceiptId=&IsGRCancelled=` | GR view |
| GET | `PODetailsByPOID?PurchaseOrderId=` | PO view |
| GET | `DateFilteredGoodsReceiptList?FromDate=&ToDate=` | Date-filtered GR list |
| GET | `ItemRateHistory` | Item purchase rate history |
| GET | `ItemFreeQuantityReceivedHistory` | Free qty history |
| GET | `MRPHistory` | MRP change history |
| PUT | (root) | Update PO |

### PharmacyPurchase

| Verb | Route | Purpose |
|---|---|---|
| GET | `Orders?status=&fromDate=&toDate=` | PO list |
| GET | `OrderInfo?purchaseOrderId=` | PO items |
| GET | `GoodReceipts` | GR list |
| GET | `SuppliersLedgerInfo?fromDate=&toDate=` | GRs grouped by supplier (for supplier ledger UI) |
| GET | `SupplierLedgerInfo?supplierId=&fromDate=&toDate=` | Ledger info for one supplier |
| GET | `GoodsReceiptInfo?goodsReceiptId=` | GR items for print |
| GET | `GoodsReceiptReturnInfo?goodsReceiptId=&creditNotePrintId=` | Items for return-to-supplier print |
| GET | `OrderItemsToGoodsReceipt?purchaseOrderId=` | PO items pending GR |
| GET | `GoodsReceiptDetailsByItemId?itemId=&goodReceiptId=` | Item-level GR details |
| GET | `GoodsReceiptForEdit?goodReceiptId=` | GR for edit (view-model) |
| GET | `Verifiers?employeeId=` | Employees available as PO verifiers |
| GET | `Items` | Item master |
| POST | `Order` | Create PO |
| POST | `GoodsReceipt` | Create GR (with or without PO) |
| POST | `GoodsReceiptCancel` | Cancel a GR |
| PUT | `Order` | Update PO |
| PUT | `GoodsReceipt` | Update GR (re-applies stock) |

### PharmacyPurchaseReturn

| Verb | Route | Purpose |
|---|---|---|
| GET | `GoodsReceiptsInfo?supplierId=&grNo=&invoiceNo=&fromDate=&toDate=` | GRs to start a return |
| GET | `ReturnedList?fromDate=&toDate=` | Supplier-return list |
| GET | `ReturnDetail?returnToSupplierId=` | Returned items + header |
| GET | `GRDetailWithAvailableStock?goodsReceiptId=&supplierId=` | GR items with available stock |
| POST | `NewReturnDetail` | Post a supplier return |

### PharmacySalesReturn

| Verb | Route | Purpose |
|---|---|---|
| GET | `CreditNotes?fromDate=&toDate=&dispensaryId=` | List credit notes (SP) |
| GET | `CreditNoteInfo?invoiceReturnId=` | Credit note receipt DTO |
| GET | `CreditNotesInfo?invoiceId=` | All credit notes for an invoice |
| GET | `InvoiceAndItemsDetailForReturn?invoicePrintId=&fiscalYearId=&storeId=` | Original invoice + items for return |
| GET | `ProvisionalReturns?fromDate=&toDate=&storeId=` | List provisional returns |
| GET | `PatientProvisionalReturnItems?patientId=` | Patient's cancelled provisional items |
| GET | `ItemListForManualReturn` | Items for manual (no-invoice) return |
| GET | `MultipleInvoiceItemsToReturn?HospitalNo=&PaymentMode=&FromDate=&ToDate=&StoreId=&SchemeId=` | Multi-invoice return preview (SP) |
| POST | `ReturnFromCustomer` | Customer return |
| POST | `ManualReturn` | Manual return |
| POST | `ReturnMultipleInvoiceItemsFromCustomer` | Multi-invoice return save |
| GET | `ReceiptDetailToPrintMultipleInvoiceReturn?InvoiceReturnId=` | Print DTO for multi-invoice return |

### PharmacySettings

| Verb | Route | Purpose |
|---|---|---|
| GET | `ActiveSuppliers`, `Suppliers`, `Counters`, `CreditOrganizations`, `ItemTypes`, `PackingTypes`, `ItemsWithAllDetails`, `Taxes`, `Items`, `ItemsByItemTypeId?itemTypeId=`, `Companies`, `ItemCategories`, `UnitOfMeasurements`, `MainStore`, `Generics`, `ItemsByDispensaryId?dispensaryId=`, `SalesCategories`, `Stores`, `SubStores`, `PharmacyStores`, `RackNoByItemIdAndStoreId/{ItemId}/{StoreId}`, `FiscalYearList`, `InvoiceHeader?Module=` | Master-data reads |
| POST | `Supplier`, `Company`, `Dispensary`, `SalesCategory`, `PharmacyCategory`, `Item`, `Tax`, `Generic`, `UnitOfMeasurement`, `ItemType`, `PackingType`, `CreditOrganization`, `InvoiceHeader` (multipart logo), `PriceCategory` | Master-data inserts |
| PUT | `Supplier`, `Company`, `Dispensary`, `Category`, `UnitOfMeasurement`, `ItemType`, `PakingType`, `Item`, `Tax`, `Generic`, `ItemToRack?itemId=&dispensaryRackId=&storeRackId=`, `CreditOrganization`, `InvoiceHeader` (multipart), `CCCharge`, `PriceCategory`, `~/api/Pharmacy/updateNMCNo/{EmployeeId}` | Master-data updates + NMC number + CC charge |

### PharmacySettlement

| Verb | Route | Purpose |
|---|---|---|
| GET | `PendingBills?storeId=&organizationId=` | Unpaid bills for an organization (SP) |
| GET | `Settlements?storeId=&FromDate=&ToDate=` | Settlements list for a store |
| GET | `PatientUnpaidInvoices?patientId=&organizationId=` | Patient unpaid invoices for settlement |
| GET | `PreviewInvoice?invoiceId=` | Preview invoice for settlement |
| GET | `PatientProvisionalItems?patientId=` | Patient provisional items for settlement |
| GET | `DuplicatePrints` | Settlement duplicate print list (SP) |
| GET | `SettlementDetail?settlementId=` | Full settlement DTO |
| POST | `NewSettlement` | Create a settlement (combines multiple invoices) |
| PUT | `PrintCount?settlementId=` | Increment settlement print count |

### PharmacyStock

| Verb | Route | Purpose |
|---|---|---|
| GET | `WardRequisitions?FromDate=&ToDate=` | Substore requisitions |
| GET | `DrugRequisitions?requisitionId=` | Drug req items |
| GET | `DrugOrders?patientId=&visitId=` | Drug orders for a patient/visit |
| GET | `DispatchedDrugItems?requisitionId=` | Items already dispatched for a req |
| GET | `WriteOffs` | Write-off list |
| GET | `StockDetails` | Main store stock details |
| GET | `NarcoticsStock` | Narcotic-flagged stock |
| GET | `WriteOff?writeOffId=` | Write-off details |
| GET | `StockManage?itemId=` | Stock manage list for an item |
| GET | `StockTransactions` | All stock transactions |
| GET | `AllStockDetails` | All stock (incl. zero qty) across stores |
| GET | `RequsitionItems?requisitionId=` | Requisition items for view |
| GET | `DispatchDetail?requisitionId=` | Dispatch info for a requisition |
| GET | `Dispatch?dispatchId=` | Dispatch by id |
| GET | `MainStoreStock?ShowAllStock=` | Main store stock (SP) |
| GET | `MainStoreIncomingStock?FromDate=&ToDate=` | Incoming dispatches |
| GET | `MainStoreIncomingStockById?DispatchId=` | Single incoming dispatch |
| GET | `AvailableBatchesByItemId?ItemId=` | Distinct batches for an item |
| GET | `RequisitionDetailsForDispatch?RequisitionId=` | Req info for dispatch |
| GET | `ExportStocksForReconciliationToExcel` | Stock recon Excel template |
| POST | `DrugRequsition` | Save a drug requisition |
| POST | `WriteOff` | Save write-off |
| POST | `ManageStock` | Save stock manage (main store) |
| POST | `ManageStore` | Save stock manage (store) |
| POST | `TransferToDispensary` | Transfer main store -> dispensary |
| POST | `TransferToStore?storeId=` | Transfer dispensary -> main store |
| POST | `DirectDispatch` | Direct dispatch (no req) |
| POST | `StoreDispatch` | Substore dispatch |
| POST | `SubStoreDispatch` | Substore dispatch (alt) |
| PUT | `StockMRP` | Update MRP for all batches |
| PUT | `StockExpiryDateandBatchNo` | Update batch/expiry for all batches |
| PUT | `ReceiveIncomingStock?DispatchId=` | Confirm receipt of dispatch |

### PharmacyReport (all GET, via stored procedures; all return string JSON)

| Verb | Route |
|---|---|
| GET | `GetActiveStores`, `GetPharmacyUsersForReturnFromCustomerReport`, `GetOnlyItemNameList`, `PHRMPurchaseOrderReport`, `StockManageReport`, `DepositBalanceReport`, `PHRMUserwiseCollectionReport`, `PHRMCashCollectionSummaryReport`, `PHRMSaleReturnReport`, `PHRMCounterwiseCollectionReport`, `PHRMDailySalesReport`, `PHRMNarcoticsDailySalesReport`, `ExportToExcelPHRMCounterwiseCollectionReport`, `PHRMBreakageItemReport`, `ExportToExcelPHRMBreakageItemReport`, `PHRMReturnToSupplierReport`, `PHRMTransferToStoreReport`, `PHRMTransferToDispensaryReport`, `PHRMGoodsReceiptProductReport`, `PHRMItemWiseStockReport`, `PHRMDispensaryStoreStockReport`, `PHRMNarcoticsDispensaryStoreStockReport`, `PHRMSupplierInformationReport`, `ExportToExcelPHRMSupplierInfoReport`, `PHRMCreditInOutPatReport`, `PHRMSupplierStockSummaryReport`, `ExportToExcelPHRMSupplierStockSummaryReport`, `PHRMStockItemsReport`, `PHRMSettlementGRNReport`, `PHRM_PaymentModeWiseReport`, `PurchaseSummaryReport`, `InsurancePatientBimaReport`, `PatientSalesDetailReport`, `StockSummarySecondReport`, `PHRMStockTransfersReport`, `PHRMSupplierWiseStockReport`, `GetReturnOnInvestmentReport`, `RankMembershipwiseSalesReport`, `GetAllMembership`, `GetAllRank`, `PharmacyDailySalesSummaryReport`, `InOutPatientDetails`, `PHRMDepositLedgerReport` (Excel), `PHRM_CashCollectionSummaryReport_DepositLedger` (Excel) |

### PharmacyDashboard (top-level)

| Verb | Route | Purpose |
|---|---|---|
| GET | `GetPharmacyDashboardCardSummaryCalculation?FromDate=&ToDate=` | Sales / GRs / dispatches / stocks |
| GET | `GetPharmacyDashboardSubstoreWiseDispatchValue?FromDate=&ToDate=` | Substore-wise dispatch value |
| GET | `GetPharmacyDashboardMembershipWiseMedicineSale?FromDate=&ToDate=` | Membership-wise sales |
| GET | `GetPharmacyDashboardMostSoldMedicine?FromDate=&ToDate=` | Most sold medicines |

### PHRMSupplierLedger (`api/PHRMSupplierLedger`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/` | All supplier ledgers |
| GET | `{id}` | GRs for a supplier (supplier ledger detail) |
| PUT | `/` | Make supplier ledger payment (batch) |

### Rack (legacy `api/PharmacyRack` and `~/api/Rack/*` aliases)

| Verb | Route | Purpose |
|---|---|---|
| GET | `api/PharmacyRack` / `{id}` | List / single rack |
| GET | `~/api/Rack/GetStoreRackNameByItemId/{ItemId}` | Rack no for an item in the active store |
| GET | `~/api/GetParentRack` | Parent racks |
| GET | `~/api/GetAllRack` | All racks |
| GET | `~/api/GetDrugsList/{rackId}/{storeId}` | Items in a rack + store |
| GET | `~/api/GetAllRackItem` | All item-to-rack mappings |
| GET | `~/api/Rack/GetItemRackData/{ItemId}` | Per-item rack allocation |
| GET | `~/api/GetRackList` | Simple rack id/no/store list |
| POST | `api/PharmacyRack` | Create rack |
| POST | `~/api/Rack/PHRM_MAP_ItemToRack` | Insert/update item-to-rack mapping (legacy) |
| POST | `~/api/Rack/PostPHRM_MAP_ItemToRack` | Insert/update item-to-rack mapping (preferred) |
| PUT | `api/PharmacyRack/{id}` | Update rack |
| DELETE | `api/PharmacyRack/{id}` | Delete rack |

### Credit / Credit Note

| Verb | Route | Purpose |
|---|---|---|
| GET | `~/api/GetPatCrDetail/{id}/{visitId}/{fromDate}/{toDate}` | Patient credit sale details |
| GET | `~/api/GetCreditNoteItems` | Distinct GR items for credit note (grouped) |
| GET | `~/api/GetCreditNote` | Reserved (returns empty) |
| POST | `api/PharmacyCreditNote` | Reserved (no-op) |

### PatientConsumption (`api/PatientConsumption`)

| Verb | Route | Purpose |
|---|---|---|
| POST | `PharmacyPatientConsumption` | Save a consumption (transactional stock decrement) |
| GET | `PatientConsumptions` | List patients with unpaid consumptions |
| GET | `PatientConsumptionInfo?patientId=&patientVisitId=` | Patient consumption + items for billing |
| POST | `FinalInvoiceForConsumption` | Convert consumption to sale invoice |
| POST | `Return` | Return consumed items to a store |
| GET | `Returns` | List consumption returns |
| GET | `ReturnInfo?patientConsumptionItemId=` | Return info for an item |
| GET | `ConsumptionInfo?patientConsumptionItemId=` | Consumption info for an item |
| GET | `ConsumptionsOfPatient?patientId=&patientVisitId=` | All consumptions for a patient/visit |
| GET | `WardSubStoreMapInfo` | Ward -> substore map |
| GET | `PatientConsumptionsOfNursing` | Nursing user consumptions |
| GET | `ConsumptionsOfPatientFromNursing` | Filtered nursing consumptions |
| GET | `PharmacyIpBillingScheme` | IP billing scheme options |

### PharmacyView (MVC views, not API)

`PharmacyMain`, `PharmacyCounter`, `BillingMain`, `OrderMain`, `PatientMain`, `PHRMPatientList`, `PHRMPatient`, `PrescriptionMain`, `PHRMPrescription`, `PHRMPrescriptionList`, `SaleMain`, `PHRMSale`, `PHRMSaleList`, `PHRMSaleReturnList`, `PHRMSaleReturn`. Protected by `[DanpheViewFilter(...)]` attributes for RBAC.

## 7. Cross-Module Interactions

- **Patient**: `PHRMPatient` mirrors the core `Patient` for outdoor pharmacy registration (`PharmacyBL.RegisterPatient` calls `PatientDbContext.Patients` to allocate `PatientCode` and `PatientNo` from core `ParameterModel` settings). Inpatient/consumption flows use `PatientVisit` to derive scheme, price category, claim code, co-payment (`PharmacySalesController.GetPatientInfo`, `PharmacySalesController.GetPatientBillingSummary`).
- **Employee / RBAC**: All writes require a session-bound `RbacUser`. Notifications fire to the `Pharmacy` role when a new item is created (`PharmacySettingsController.AddItem`).
- **Billing**: `PharmacySalesController.PostInvoiceData` checks `PriceCategories` and posts a real-time SSF claim booking via `BillingBL.SyncToSSFServer` when the price category is `ssf`. Medicare members/balances are decremented (`UpdateSchemeCreditLimit`, `UpdateMedicareBalance`). Deposit handling writes `BillingDepositModel` rows (`ENUM_DepositTransactionType.DepositDeduct`). Patient billing summary pulls `BillingDepositModel` for deposit balance and `BillingSchemes` for scheme limits.
- **Accounting**: Goods receipts with credit to suppliers create accounting entries (the `BillSyncs`, `VoucherName`, `VoucherId`, `Type` fields on `PHRMGoodsReceiptModel`). Settlement posts a single accounting voucher per settlement. IsTransferredToACC flags track this.
- **Inventory**: `PHRM_Store` table is shared with the Inventory module for sub-stores and main stores; the `INV_*GroupId` fields on `PHRMStoreModel` link to inventory receipt-number groups.
- **Ward / Nursing**: `PHRMStoreRequisition` is shared with the ward module; `DrugsRequistion` table is consumed by `PHRM_TXN_DrugsRequistion` flow.
- **Procurement / Inventory**: GR has a `SendDirectToDispensary` flag and `SelectedDispensaryId` (Bikash: 2July'20) so a GR can dispatch directly to a dispensary without an intermediate main-store step.
- **Reporting**: `StockSummaryReport` aggregates opening, purchases, returns, sales, provisional, write-offs, consumption, stock-manage, transfers. Stored procs span `PHRM_*` tables, `PHRMEmployeeCashTransaction`, deposits, schemes, and Medicare.
- **Master sync to remote (IRD)**: `PharmacyBL.SyncPHRMBillInvoiceToRemoteServer(invoice, "phrm-invoice"|"phrm-invoice-return", ...)` is invoked asynchronously when `RealTimeRemoteSyncEnabled` is true and the bill is a return.

## 8. Key Business Rules

- **Multi-store stock model**: `PHRMStockMaster` (one row per ItemId + BatchNo + Expiry + MRP) + `PHRMStoreStockModel` (per-store `AvailableQuantity` and price snapshot). Stock movements go through `PHRMStockTransactionModel` (in / out) referencing the store stock id.
- **FEFO sale**: Available stock is grouped by `ItemId, BatchNo, CostPrice, SalePrice, ExpiryDate, BarcodeId` and ordered by `ExpiryDate` ascending. Sales consume from earliest-expiring batches first.
- **Narcotic tracking**: When `PHRMItemMaster.IsNarcotic = true`, the sale inserts a `PHRMNarcoticRecord` row (BuyerName, DoctorName, NMCNumber, Batch, Refill, ImgUrl). Narcotic stock reports exist separately.
- **Insurance / co-payment**: A `PHRMTransactionCreditBillStatus` is created per credit bill (and per item in `PHRMTransactionCreditBillItemStatusModel` if individual item claimability is tracked). `IsCopayment` and `CoPaymentCashAmount`/`CoPaymentCreditAmount` drive `UpdateSchemeCreditLimit` and `UpdateMedicareBalance` (consuming `IpCreditLimit`, `OpCreditLimit`, `GeneralCreditLimit` from `PatientSchemeMap`).
- **Claim code**: `ClaimCode` is `Int64` (incremental per scheme visit), set on the invoice. Used by SSF and external claim systems.
- **Deposit lifecycle**: `DepositType` `deposit` (add) / `depositdeduct` (use) / `depositreturn` (refund). `DepositBalance` = sum(deposit) - sum(depositdeduct) - sum(depositreturn). `ReceiptNo` is per fiscal year.
- **Settlement**: Combines multiple unpaid invoices for a patient under one scheme into a single `PHRMSettlementModel`. Updates `PHRMInvoiceTransactionModel.SettlementId`, decrements `PHRMTransactionCreditBillStatus.NetReceivableAmount`, and (when a co-payment is in play) credits `CollectionFromReceivable` and `DiscountReturnAmount` on the settlement.
- **Return prevention**: `PharmacySalesReturnController.CheckIfReturnItemsInvalid` returns an error if any returned qty exceeds the available qty, preventing concurrent-tab double-returns.
- **Price-category pricing**: Each item can have one price per `PriceCategoryId` (e.g., `General`, `SSF`, `Insurance`). The `Price` field on `PHRMInvoiceTransactionItemsModel` is the per-invoice resolved price; `NormalSalePrice` (not mapped) is used for stock-out verification.
- **FIFO/FEFO stock-out verification**: `SaveStockTransactionAndUpdateStock` ensures that the quantity being moved out equals `sum(OutQty - InQty)` of prior stock transactions for that item/batch; otherwise throws `InvalidOperationException("...quantity mismatch...")`.
- **Verification workflow**: Purchase orders and store requisitions support `IsVerificationEnabled` + multi-level `VerifierIds` via the shared `Verification` module (`GetVerifiers`).
- **CC charge**: Pharmacy-wide "CC Charge" (clearing charge) parameter is configurable via `PUT CCCharge` and applied to PO/GR items.
- **Price rounding**: `PharmacyBL.GetInvoiceNumber` / `GetDepositReceiptNo` are per-fiscal-year, `max(ReceiptNo) + 1`. Negative stock is forbidden; `PHRMStoreStockModel` updates validate with `InvalidOperationException` guards inside the domain methods.
- **Audit**: `[AuditInclude]` on every financial transaction entity means `Audit.EntityFramework` writes change logs to a shadow table.
- **Real-time IRD sync**: `PharmacyBL.SyncPHRMBillInvoiceToRemoteServer` is invoked via `Task.Run` for returns when `RealTimeRemoteSyncEnabled` is true; failure does not roll back the local transaction.
- **SSF claim booking**: `BillingBL.SyncToSSFServer` invoked via `Task.Run` for SSF-priced sales and returns when `RealTimeSSFClaimBooking` is enabled.
- **NMC number**: Per-prescriber `MedCertificationNo` is editable via `PUT updateNMCNo/{EmployeeId}` and rendered on receipts (`ProviderNMCNumber`).
- **Barcode generation**: `PharmacyStockBarcodeService.AddStockBarcode` allocates a unique `BarcodeId` per stock at GR time.
- **MRP/Batch history**: Updates to MRP (`PHRMStockMaster.UpdateMRP`) and batch/expiry (`UpdateBatch`/`UpdateExpiry`) audit-log to `PHRMMRPHistoryModel` and `PHRMExpiryDateBatchNoHistoryModel`.
- **Stock reconciliation**: Excel-template driven; the only editable column is `NewAvailableQuantity`. Reconciliation posts a series of `PHRMStockManageModel` rows with in/out as appropriate to converge the system qty with the physical count.
- **Dispensary payment modes**: Configurable per dispensary on `PHRMStoreModel.AvailablePaymentModesJSON`; defaults to `cash` for dispensaries.
- **Dispensary activation / deactivation**: `IDispensaryService.ActivateDeactivateDispensary` toggles `IsActive` on a `PHRMStoreModel` row.

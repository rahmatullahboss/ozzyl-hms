# Accounting Module

Source reference: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Accounting/` (controllers), `Code/Components/DanpheEMR.ServerModel/AccountingModels/` (models), `Code/Websites/DanpheEMR/Services/Accounting/` (services), and `wwwroot/DanpheApp/src/app/accounting/` (frontend).

## 1. Module Overview

The Accounting module is the financial heart of DanpheEMR. It owns the chart of accounts, voucher types, ledgers, sub-ledgers, fiscal-year bookkeeping, and double-entry transaction posting, and it produces the statutory financial statements (Trial Balance, P&L, Balance Sheet, Cash Flow, Day Book, Cash/Bank Book, Group Statement, Ledger Report, Sub-Ledger Report, System Audit). It also acts as the **central sink** for money-touching events from Billing, Pharmacy, Inventory, Incentive, and Payroll, and as the **source** of supplier-payment vouchers, manual journal entries, and bank reconciliation.

The module is multi-tenant (every record carries `HospitalId`) and every transaction is scoped to a `FiscalYear`. Vouchers follow a `{SectionCode}-{VoucherCode}-{SerialNo}` numbering scheme (e.g. `ACC-JV-123`), and `VoucherSerialNo` is a per-section, per-fiscal-year running counter (`AccountingBL.GetVoucherNumber` in `Controllers/Accounting/AccountingBL.cs:64`). Every `TransactionModel` has a globally unique `TUId` (per hospital) that groups related sales-voucher splits (`AccountingBL.GetTUID` in `Controllers/Accounting/AccountingBL.cs:84`).

Architectural style:

- ASP.NET MVC controllers using attribute routing. Three main API controllers and one supporting controller.
  - `AccountingController` (`Controllers/Accounting/AccountingController.cs`, 6,145 lines): transaction entry, post, edit, reverse, transfer-to-accounting, payment, ledger/COA/primary-group reads.
  - `AccountingReportController` (`Controllers/Accounting/AccountingReportController.cs`, 4,577 lines): every financial statement, day book, voucher report, and reconciliation report.
  - `AccountingSettingsController` (`Controllers/Accounting/AccountingSettingsController.cs`, 2,817 lines): master CRUD for chart-of-accounts, ledger-groups, ledgers, voucher-heads, voucher-types, sub-ledgers, cost-centers, fiscal years, transfer rules, medicare types, and bank-reconciliation categories.
  - `AccLedgerMappingController` (`Controllers/Accounting/AccLedgerMappingController.cs`, 148 lines): narrow RESTful controller dedicated to mapping income ledgers to billing service-department items.
  - `AccountingBL` (`Controllers/Accounting/AccountingBL.cs`, 108 lines): small static helper class with `GetVoucherNumber`, `GetTUID`, `GetSections`, `CheckResponseObject`.
- Domain services in `Services/Accounting/DTOs/` (`AccBillingLedgerMapping_DTO`, `SubLedger_DTO`, `SubLedgerAndCostCenterConfig_DTO`, plus a `LedgerMapping` subfolder).
- Cross-module integration: `DanpheEMR.AccTransfer` namespace contains the larger `AccountingTransferData` helper (invoked from Billing, Inventory, Pharmacy, Incentive) that builds accounting transactions and posts them. (Documented in the AGENTS context as a "module" for cross-cutting work.)
- The Angular SPA at `wwwroot/DanpheApp/src/app/accounting/` provides a per-hospital-isolation gate (`ActivateHospitalComponent`), a transactions module (VoucherEntry, TransferToAcc, AccountClosure, Payment, EditManualVoucher), a settings module (COA, FiscalYear, Ledgers, LedgerGroups, LedgerMapping, CostCenter, VoucherHead, Voucher, SubLedger, Section, TransferRules, ReverseTransaction, Items, LedgerGroupCategory), a reports module (BalanceSheet, TrialBalance, P&L, CashFlow, Ledger, Voucher, DayBook, CashBankBook, DaywiseVoucher, GroupStatement, SubLedger, DailyTransaction, SystemAudit, AccountHeadDetail), a bank-reconciliation module, a sync module, a voucher-verification module, and a shared `AccountingService` (`shared/accounting.service.ts:1`) that orchestrates the per-hospital accounting cache (`accCacheData`) using `DanpheCache.GetAccCacheData(MasterType.*)`.
- Storage topology: SQL Server with `DanpheEMR.DalLayer.AccountingDbContext`. Tables are prefixed `ACC_*` for transactional tables and `*_LOG_*` / `*_History*` for audit. Multi-tenant via `HospitalId`. Multi-fiscal-year via `FiscalYearId` on every transactional row.

Key business capabilities:

- Chart of accounts (COA) with primary groups, ledger groups, ledgers, sub-ledgers, and a fiscal-year-aware `LedgerBalanceHistory` table.
- Voucher types with configurable per-voucher behavior (`ISCopyDescription`, `ShowPayeeName`, `ShowChequeNumber`) and codes that drive voucher-number generation.
- Manual journal entry, edit (with `EditVoucherLogModel` audit), reverse (with `ReverseTransactionModel`), voucher verification, voucher cancel.
- Double-entry posting: every `TransactionModel` has at least two `TransactionItemModel` lines balancing Dr/Cr, and at least one `TransactionLinkModel` for cross-module reference.
- Cross-module posting from Billing (CashBill/CreditBill/DepositAdd/DepositReturn/CashBillReturn/CreditBillReturn), Inventory (GoodReceipt/WriteOff/ReturnToVendor/DispatchToDept/INVDeptConsumedGoods/INVStockManageOut), Pharmacy (CashInvoice/CashInvoiceReturn/ReturnToSupplier/GoodReceipt/PHRMDispatchToDept/PHRMDispatchToDeptReturn/WriteOff), and Incentive (ConsultantIncentive). All flow through the same `TransactionModel` / `TransactionItemModel` / `TransactionLinkModel` triple.
- Sub-ledger tracking (`SubLedgerTransactionModel` / `SubLedgerModel` / `SubLedgerBalanceHistory`) for party-level accounting.
- Cost centers (`CostCenterItemModel`, `CostCenterModel` with parent/child hierarchy, default cost-center auto-pick).
- Fiscal-year management with creation, account-closure stored procedure (`SP_ACC_AccountClosure`), reopen, and per-fiscal-year log (`FiscalYearLogModel`).
- Bank reconciliation (per-transaction, per-category, with history) and bank-suspense reconciliation.
- Supplier / vendor / consultant / inventory-subcategory / pharmacy-supplier / credit-organization ledger mappings (`LedgerMappingModel`) plus a dedicated billing income-ledger mapping (`AccountingBillLedgerMappingModel`).
- Medicare-type ledger assignment (`UpdateMedicareTypes` endpoint).
- IRD (Nepal Inland Revenue Department) sync is NOT in this module directly; the file `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Accounting/` does not contain an explicit IRD-sync endpoint. Sync between modules is handled via `AccTransfer` and the dedicated `AccountingTransactionHistoryModel` log table.

## 2. Backend Files

### 2.1 Controllers

| File | Responsibility | Key methods/endpoints |
|---|---|---|
| `Controllers/Accounting/AccountingController.cs` (6,145 lines) | Core transaction engine: GET masters + transfer-to-accounting data, POST vouchers/payments/reverses, PUT update/verify. | `GET Vouchers`, `GET VoucherHeads`, `GET Ledgers`, `GET MappedLedgers`, `GET FiscalYears`, `GET CostCenterItems`, `GET ActiveFiscalYears`, `GET Transactions`, `GET TransactionByVoucherNumber`, `GET RefrenceTransactionId`, `GET InventoryToAccounting`, `GET LedgerMapping`, `GET ConsultantLedgers`, `GET PharmacySupplierLedgers`, `GET InventoryVendorLedgers`, `GET InventorySubCategoryLedgers`, `GET CreditOrganizationLedgers`, `GET BillingToAccounting`, `GET PharmacyToAccounting`, `GET IncentiveToAccounting`, `GET Voucher`, `GET ProvisionalVoucherNumber`, `GET AccountingCodes`, `GET ProvisionalLedgerCode`, `GET ProvisionalLedgerDetail`, `GET Hospitals`, `GET FiscalYearLogs`, `GET EmployeeLedgers`, `GET TransactionDates`, `GET BankReconciliationCategories`, `GET GoodReceipts`, `GET GetBankReconciliationCategory`, `GET get-paymentmodes`, `GET SuspenseAccountReconciliationDetail`. `POST Trannsaction` (note typo), `POST Transactions` (list), `POST AccountClose`, `POST Ledgers`, `POST Ledger`, `POST ReverseTransaction`, `POST IncentivePayment`, `POST Payment`, `POST UpdateBankReconciliationCategory`, `POST UpdateMedicareTypes`, `POST SuspenseAcc/Reconcile`. `PUT Transaction`, `PUT VerifyVoucher`. |
| `Controllers/Accounting/AccountingReportController.cs` (4,577 lines) | All financial statements, reports, and reconciliation. | `POST LedgerListReport`, `GET CashBankBookReport`, `GET DayBookReport`, `GET BankReconciliationReport`, `POST SubLedgerReport`, `GET VoucherReport`, `GET LedgerReport`, `GET TrailBalanceReport`, `GET GroupStatementReport`, `GET ProfitAndLossReport`, `GET BalanceSheetReport`, `GET DailyTransactionReport`, `GET TransactionOriginDetail`, `GET CashFlowReport`, `GET DayWiseVoucherReport`, `GET DayWiseVoucherDetailsByVoucherNo`, `GET SystemAuditReport`, `GET ReverseTransactionDetail`, `GET BankReconcilationReport`, `GET BankReconciliationHistory`, `GET VoucherVerification`, `GET AccountHeadDetailReport`. `POST PostReconciliation` (creates BankReconciliationModel rows + journal voucher). `PUT Update` (legacy stub). `DELETE {id}` (legacy stub). |
| `Controllers/Accounting/AccountingSettingsController.cs` (2,817 lines) | Master CRUD: chart-of-account, ledger-group, ledger, voucher-head, voucher-type, sub-ledger, cost-center (item + hierarchical), fiscal-year list, section, primary-group, employee, pharmacy supplier, transfer rules. | `GET GetSubLedgers`, `GET VoucherHeads`, `GET Vouchers`, `GET Ledgers`, `GET LedgerGroups`, `GET LedgerGroupsDetails`, `GET FiscalYearList`, `GET CostCenterItemList`, `GET ChartofAccount`, `GET LedgersList`, `GET SectionsList`, `GET PharmacySupplier`, `GET Employee`, `GET PrimaryList`, `GET TransferRules`. `PUT ActivateDeactiveSubLedger`, `PUT UpdateSubLedger`, `POST AddSubLedger`, `POST SubLedger`, `POST Ledgers`, `POST LedgersList`, `POST Vouchers`, `POST VoucherHead`, `POST LedgersGroup`, `POST CostCenterItem`, `POST LedgerGroupCategory`, `POST Section`, `POST ChartOfAccount`, `POST CostCenter`. `GET CostCenters`, `GET GetParentCostCenters`. `PUT LedgerISActive`, `PUT ReopenFiscalYear`, `PUT LedgerGroupActivateDeactivate`, `PUT LedgerGroup`, `PUT CostCenterItemStatus`, `PUT LedgerGroupCategoryActivateDeactivate`, `PUT Ledger`, `PUT VoucherHead`, `PUT Section`, `PUT ChartOfAccount`, `PUT TransferRuleActivateDeactivate`, `PUT VoucherShowChequeNo`, `PUT VoucherShowPayeeName`, `PUT CostCenter`, `PUT CostCenter/ActivateDeactivate`. |
| `Controllers/Accounting/AccLedgerMappingController.cs` (148 lines) | RESTful controller dedicated to mapping income ledgers to billing service-department items. | `GET BillingIncomeLedgers`, `POST MapBillingIncomeLedger`, `PUT ActivateDeactivateBillingLedgerMapping`, `PUT MapBillingLedger`. |
| `Controllers/Accounting/AccountingBL.cs` (108 lines) | Static helper. | `GetSections`, `CheckResponseObject`, `GetVoucherNumber` (lines 64-82), `GetTUID` (lines 84-106). |

### 2.2 Services (`Services/Accounting/`)

- `Services/Accounting/DTOs/AccBillingLedgerMapping_DTO.cs` - DTO for the `AccLedgerMappingController` plus a `MapDataTableToSingleObject` helper that materializes the `SP_ACC_GetIncomeLedgerMappingDetail` result set.
- `Services/Accounting/DTOs/SubLedger_DTO.cs` - flat shape of a sub-ledger joined with its parent ledger (used in `AccountingSettingsController.GetSubLedgers`).
- `Services/Accounting/DTOs/SubLedgerAndCostCenterConfig_DTO.cs` - config flag DTO deserialized from the `CFGParameters` row `SubLedgerAndCostCenter` (enables per-voucher sub-ledger and cost-center).
- `Services/Accounting/DTOs/LedgerMapping/AccBillingLedgerMapping_DTO.cs` - same as the parent DTO (kept in two locations for layered access).

The `AccTransfer` namespace (`DanpheEMR.AccTransfer.AccountingTransferData`) contains the heavy cross-module posting helpers used by Billing, Inventory, Pharmacy, and Incentive. Key entry points: `PostTxnData(List<TransactionModel>...)`, `GetFiscalYearIdByDate`, `GetAccPrimaryHospitalId`, `GetProvisionalLedgerCode`, `AddLedgerForClosedFiscalYears`, `LedgerAddUpdateInBalanceHisotry`, `SubLedgerBalanceHisotrySave`, `SubLedgerBalanceHisotryUpdate`, `GetAutoGeneratedCodeForCOA`.

## 3. Data Models

(`Code/Components/DanpheEMR.ServerModel/AccountingModels/`)

### 3.1 Config folder - master data

- **LedgerModel** (`Config/LedgerModel.cs`): PK `LedgerId`. Fields: `LedgerGroupId`, `LedgerName`, `LedgerReferenceId`, `Description`, `SectionId`, `CreatedOn`, `CreatedBy`, `IsActive`, `IsCostCenterApplicable`, `OpeningBalance`, `DrCr` (true=Dr opening, false=Cr opening), `Name`, `LedgerType`, `Code`, `PANNo`, `Address`, `MobileNo`, `CreditPeriod`, `TDSPercent`, `LandlineNo`, `LegalLedgerName`, `HospitalId`. NotMapped: `PrimaryGroup`, `COA`, `LedgerGroupName`, `EmployeeId`, `EmployeeName`, `DepartmentName`, `SupplierName`, `SupplierId`, `VendorName`, `VendorId`, `SubCategoryName`, `SubCategoryId`, `OrganizationName`, `OrganizationId`, `ServiceDepartmentName`, `ServiceDepartmentId`, `ItemId`, `ItemName`, `IsMapLedger`, `CostCenterId`, `SubLedgerId`, `SubLedgerName`.
- **LedgerGroupModel** (`Config/LedgerGroupModel.cs`): PK `LedgerGroupId`. `PrimaryGroup`, `COA`, `LedgerGroupName`, `Description`, `IsActive`, `ModifiedBy`, `ModifiedOn`, `Name`, `Code`, `HospitalId`, `COAId`. NotMapped: `LedgerId`, `LedgerName`, `LedgerReferenceId`, `SectionId`, `LedName`, `LedgerType`.
- **ChartOfAccountModel** (`Config/ChartOfAccountModel.cs`): PK `ChartOfAccountId`. `ChartOfAccountName`, `PrimaryGroupId`, `COACode`, `Description`, `CreatedOn`, `ModifiedOn`, `ModifiedBy`, `CreatedBy`, `IsActive`.
- **PrimaryGroupModel** (`Config/PrimaryGroupModel.cs`): PK `PrimaryGroupId`. `PrimaryGroupCode`, `PrimaryGroupName`, `IsActive`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`.
- **LedgerGroupCategoryModel** (`Config/LedgerGroupCategoryModel.cs`): PK `LedgerGroupCategoryId`. `LedgerGroupCategoryName`, `ChartOfAccountId`, `Description`, `CreatedOn`, `IsDebit`, `CreatedBy`, `IsActive`.
- **VoucherModel** (`Config/VoucherModel.cs`): PK `VoucherId`. `VoucherName`, `Description`, `CreatedOn`, `CreatedBy`, `IsActive`, `VoucherCode`, `ISCopyDescription`, `ShowPayeeName`, `ShowChequeNumber`.
- **VoucherHeadModel** (`Config/VoucherHeadModel.cs`): PK `VoucherHeadId`. `VoucherHeadName`, `Description`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`, `IsActive`, `IsDefault`, `HospitalId`.
- **CostCenterItemModel** (`Config/CostCenterItemModel.cs`): PK `CostCenterItemId`. `CostCenterItemName`, `Description`, `CreatedOn`, `CreatedBy`, `IsActive`, `HospitalId`. Also contains `CostCenterModel` (PK `CostCenterId`, with `CostCenterCode`, `BusinessCenterName`, `CostCenterName`, `ParentCostCenterId`, `HierarchyLevel`, `IsActive`, `IsDefault`) and `CostCenterModelDTO` (read-shape used by `CostCenter/ActivateDeactivate`).
- **SubLedgerModel** (`Config/SubLedgerModel.cs`): PK `SubLedgerId`. `SubLedgerName`, `SubLedgerCode`, `LedgerId`, `Description`, `IsActive`, `CreatedBy`, `CreatedOn`, `OpeningBalance`, `DrCr`, `HospitalId`, `IsDefault`.
- **SectionModel** / **AccSectionModel** (`Config/SectionModel.cs`): PK `Id` (auto), `SectionId`, `SectionName`, `SectionCode`, `HospitalId`, `IsDefault`, `IsActive`. Sections are configured in `CFGParameters.Group="Accounting" / Name="SectionList"` and consumed by `AccountingBL.GetSections` and `AccountingController.GetVoucherReport`.
- **LedgerMappingModel** (`Config/LedgerMappingModel.cs`): PK `LedgerMappingId`. `LedgerId`, `ReferenceId`, `LedgerType` (e.g. `consultant`, `pharmacysupplier`, `inventoryvendor`, `inventorysubcategory`, `creditorg`, `paymentmode`, `clinic`, `externalreferrer`, `incomeexpensehead`), `HospitalId`, `CostCenterId`, `SubLedgerId`.
- **AccountingBillLedgerMappingModel** (`Config/AccountingBillLedgerMappingModel.cs`): PK `BillLedgerMappingId`. `LedgerId`, `ServiceDepartmentId`, `ItemId`, `HospitalId`, `SubLedgerId`, `IsActive`, `BillingType`.
- **FiscalYearModel** (`Config/FiscalYearModel.cs`): PK `FiscalYearId`. `FiscalYearName`, `NpFiscalYearName` (Nepali), `StartDate`, `EndDate`, `Description`, `CreatedOn`, `CreatedBy`, `IsActive`, `IsClosed`, `ClosedBy`, `ClosedOn`, `ReadyToClose`, `HospitalId`. NotMapped: `nStartDate`, `nEndDate`, `Remark`, `showreopen`, `CurrentDate`.
- **GroupMappingModel** (`Config/GroupMappingModel.cs`): PK `GroupMappingId`. `Description`, `Section`, `Details`, `VoucherId`, `Remarks`, `CustomVoucherId`, virtual `MappingDetail`. Used for transfer rules.
- **HospitalTransferRuleMappingModel** (`Config/HospitalTransferRuleMappingModel.cs`): PK `HospitalTransferRulesMapId`. `HospitalId`, `TransferRuleId`, `IsActive`. Per-hospital activation of a transfer rule.
- **AccountingCodeDetailsModel** (`Config/AccountingCodeDetailsModel.cs`): PK `Id`. `Code`, `Name`, `Description`, `HospitalId`. Reference table backing `ProvisionalLedgerCode` lookups.
- **BankReconciliationCategoryModel** (`Config/BankReconciliationCategoryModel.cs`): PK `CategoryId`. `CategoryName`, `Description`, `CreatedOn`, `CreatedBy`, `IsActive`, `MappedLedgerId`, `SubLedgerId`, `DrCr`. NotMapped: `Amount`.
- **MapTransactionItemCostCenterItemModel** (`Config/MapTransactionItemCostCenterItemModel.cs`): PK `MapTransactionItemCostCenterItemId`. `TransactionItemId`, `CostCenterItemId`, `Amount`. Bridging table between transaction items and cost centers.
- **MappingDetailModel** (`Config/MappingDetailModel.cs`): a child of `GroupMappingModel` describing the line-level rules.
- **CompanyMasterModel** (`Config/CompanyMasterModel.cs`): master company info, used for IRD headers.
- **HospitalModel** (`Config/HospitalModel.cs`): tenant registry.
- **VoucherLedgerGroupMapModel** (`Config/VoucherLedgerGroupMapModel.cs`): hint table used to suggest default ledger groups for a voucher type.

### 3.2 Transactions folder

- **TransactionModel** (`Transactions/TransactionModel.cs`): PK `TransactionId`. The central double-entry header. Fields: `VoucherId`, `FiscalyearId`, `Remarks`, `TransactionDate`, `CreatedOn`, `CreatedBy`, `IsActive`, `VoucherNumber`, `PayeeName`, `ChequeNumber`, `SectionId`, `TransactionItems` (virtual list), `IsBackDateEntry`, `TransactionType` (`ManualEntry` / `CashBill` / `CreditBill` / `CashBillReturn` / `CreditBillReturn` / `DepositAdd` / `DepositReturn` / `CashInvoice` / `CashInvoiceReturn` / `ReturnToSupplier` / `GoodReceipt` / `PHRMDispatchToDept` / `PHRMDispatchToDeptReturn` / `WriteOff` / `ReturnToVendor` / `DispatchToDept` / `INVDeptConsumedGoods` / `INVStockManageOut` / `ConsultantIncentive` / `InventoryPayment` / `PharmacyPayment`), `TUId`, `DayVoucherNumber`, `IsCustomVoucher`, `IsReverseTxnAllow`, `IsEditable`, `ModifiedOn`, `ModifiedBy`, `IsGroupTxn`, `HospitalId`, `VoucherSerialNo`, `IsAllowReverseVoucher`, `IsReverseVoucher`, `PrevTransactionId`, `ChequeDate`, `Status` (`Draft` / `Verified` / `Cancelled` per `ENUM_ACC_VoucherStatus`), `IsVerified`, `VerifiedBy`, `VerifiedOn`, `VerificationRemarks`, `CancelledBy`, `CancelledOn`, `CancelledRemarks`, `IsVoucherReversed`. NotMapped: `BillingAccountingSyncIds`, `BillSyncs`, `Reason`.
- **TransactionItemModel** (`Transactions/TransactionItemModel.cs`): PK `TransactionItemId`. `TransactionId`, `LedgerId`, `DrCr` (true=Dr, false=Cr), `Amount`, `CreatedOn`, `CreatedBy`, `IsActive`, `Description`, `HospitalId`, `CostCenterId`, `TransactionType`. Virtual: `InventoryItems`, `CostCenterItems`, `TransactionItemDetails`, `SubLedgers`, `TransactionLinks`.
- **SubLedgerTransactionModel** (`Transactions/SubLedgerTransactionModel.cs`): PK `SubLedgerTransactionId`. `LedgerId`, `TransactionItemId`, `SubLedgerId`, `DrAmount`, `CrAmount`, `VoucherNo`, `VoucherType`, `Description`, `VoucherDate`, `CreatedOn`, `CreatedBy`, `IsActive`, `FiscalYearId`, `HospitalId`, `CostCenterId`, `IsVerified`. Per party sub-ledger movement.
- **TransactionItemDetailModel** (`Transactions/TransactionItemDetailModel.cs`): PK `TransactionItemDetailId`. `TransactionItemId`, `Amount`, `Description`, `ReferenceId`, `ReferenceType` (`Patient` / `Supplier` / `Vendor` / `User` / `Capital Goods Items`).
- **TransactionLinkModel** (`Transactions/TransactionLinkModel.cs`): PK `AccountingTxnLinkId`. `TransactionId`, `ReferenceId` (CSV of source ids), `ReferenceIdOne`, `TransactionItemId`. The `ReferenceId` is a comma-separated list of source-row ids that this transaction represents.
- **TransactionCostCenterItemModel** (`Transactions/TransactionCostCenterItemModel.cs`): PK `TransactionCostCenterItemId`. `TransactionItemId`, `CostCenterItemId`, `Amount`, `CreatedOn`, `CreatedBy`, `IsActive`.
- **AccountingPaymentModel** (`Transactions/AccountingPaymentModel.cs`): PK `PaymentId`. `TransactionId`, `VoucherNumber`, `PaymentDate`, `ReceiverLedgerId`, `GoodReceiptID`, `TotalAmount`, `PaidAmount`, `VoucherAmount`, `RemainingAmount`, `PaymentMode`, `Remarks`, `CreatedBy`, `CreatedOn`. NotMapped: `DueAmount`, `IsPaymentDone`, `SectionId`. Built by `POST Payment` and consumed by GoodsReceipt / PHRMGoodsReceipt to mark `IsPaymentDoneFromAcc=true`.
- **BankReconciliationModel** (`Transactions/BankReconciliationModel.cs`): PK `Id`. `SectionId`, `VoucherNumber`, `TransactionDate`, `FiscalyearId`, `BankTransactionDate`, `CategoryId`, `BankBalance`, `IsVerified`, `VerifiedBy`, `VerifiedOn`, `Remark`, `TransactionId`, `LedgerId`, `HospitalId`, `CreatedOn`, `CreatedBy`, `DrCr`, `BankRefNumber`, `VoucherTypeId`, `PartyLedgerId`, `PartySubLedgerId`. Also defines `BankReconciliationVM` (list of `BankReconciliationModel` + `BankReconciliationAdditionalTransaction_DTO`).
- **ReverseTransactionModel** (`Transactions/ReverseTransactionModel.cs`): PK `ReverseTransactionId`. `TransactionDate`, `Section`, `TUId`, `FiscalYearId`, `Reason`, `JsonData` (full snapshot of the reversed voucher), `CreatedOn`, `CreatedBy`, `HospitalId`.
- **SuspenseAccountReconciliationMapModel** (`Transactions/SuspenseAccountReconciliationMapModel.cs`): PK `BankAndSuspenseAccountReconciliationId`. `BankReconciliationVoucherNumber`, `SuspensReconciliationVoucherNumber`, `BankLedgerId`. Maps a bank-recon voucher to a suspense-recon voucher.

### 3.3 Logs folder

- **FiscalYearLogModel** (`Logs/FiscalYearLogModel.cs`): PK `LogId`. `FiscalYearId`, `LogType` (`closed` / `reopened`), `LogDetails`, `CreatedOn`, `CreatedBy`, `HospitalId`.
- **LedgerBalanceHistoryModel** (`Logs/LedgerBalanceHistoryModel.cs`): PK `LedgerBalanceHistoryId`. `FiscalYearId`, `LedgerId`, `OpeningBalance`, `OpeningDrCr`, `ClosingBalance`, `ClosingDrCr`, `CreatedBy`, `CreatedOn`, `ModifiedOn`, `ModifiedBy`, `HospitalId`. The cornerstone of fiscal-year-aware opening/closing balances.
- **SubLedgerBalanceHistory** (`Logs/SubLedgerBalanceHistory.cs`): same shape for sub-ledgers.
- **EditVoucherLogModel** (`Logs/EdiitVoucherLogModel.cs`): PK `LogId`. `TransactionDate`, `SectionId`, `VoucherNumber`, `Reason`, `OldVocherJsonData` (snapshot of items before edit), `FiscalYearId`, `HospitalId`, `CreatedOn`, `CreatedBy`. Created on every manual voucher edit.
- **AccountingTransactionHistoryModel** (`Logs/AccountingTransactionHistoryModel.cs`): PK `Id`. `TransactionDate`, `SyncedOn`, `SyncedBy`, `SectionId`, `TransactionType`. Audit of cross-module sync events.

### 3.4 DTOs folder

- **AccountingSync_DTO** (`DTOs/AccountingSync_DTO.cs`): `ReferenceIdCSV`, `BaseTransactionType`, `TransactionType`, `PaymentMode`, `TotalAmount`, `LedgerId`, `SubLedgerId`, `TransactionDate`, `Description`, `DisplaySequence`, `DrCr`, `TransactionRefNo`. Used by `AccTransfer` to post cross-module sync.
- **MakePayment_DTO** (`DTOs/MakePayment_DTO.cs`): wraps `AccountingPaymentModel` and `TransactionModel` for the `POST Payment` endpoint.
- **MapSuspenseAccountReconciliation_DTO** (`DTOs/MapSuspenseAccountReconciliation_DTO.cs`): request body for `POST SuspenseAcc/Reconcile`.
- **SuspenseAccountTransaction_DTO** (`DTOs/SuspenseAccountTransaction_DTO.cs`): request body for the same endpoint.
- **LedgerReportRequest_DTO** (`DTOs/LedgerReportRequest_DTO.cs`): `LedgerIds` (list), `FromDate`, `ToDate`, `FiscalYearId`, `CostCenterId`. Request for `POST LedgerListReport`.
- **SubLedgerReportRequest_DTO** (`DTOs/SubLedgerReportRequst_DTO.cs`): `SubLedgerIds`, `FromDate`, `ToDate`, `FiscalYearId`. Request for `POST SubLedgerReport`.
- **ConsultantLedger_DTO** (`DTOs/ConsultantLedger_DTO.cs`): `EmployeeId`, `EmployeeName`, `LedgerId`, `IsMapped`. Returned by `GET ConsultantLedgers`.
- **PharmacySupplierLedger_DTO** (`DTOs/PharmacySupplierLedger_DTO.cs`): same shape for pharmacy suppliers.
- **InventoryVendorLedger_DTO** (`DTOs/InventoryVendorLedger_DTO.cs`): same shape for inventory vendors.
- **BankReconciliationAdditionalTransaction_DTO** (`DTOs/BankReconciliationAdditionalTransaction_DTO.cs`): one unmatched transaction the user wants to add during reconciliation; carries `LedgerId`, `SubLedgerId`, `DrCr`, `Amount`, `Description`, plus `MappedLedgerId`. Consumed by `PostReconciliation` to create both a `BankReconciliationModel` and a journal voucher.

### 3.5 ViewModels folder

- **AccountClosureVM** (`ViewModels/AccountingViewModels.cs`): bundles `FiscalYearModel nextFiscalYear` + `TransactionModel TnxModel`. Used by the `AccountClose` flow.
- **AccountingTxnSyncVM** (`ViewModels/AccountingViewModels.cs`): bundles a list of `SyncBillingAccountingModel` and a list of `TransactionModel`. Used by the transfer-to-accounting flow.
- **AccHospitalInfoVM** (`ViewModels/AccountingViewModels.cs`): in-memory session-style bundle: `ActiveHospitalId`, `FiscalYearList`, `SectionList`, `TodaysDate`, `HospitalShortName`, `HospitalLongName`, `CurrFiscalYear`.
- **VoucherVerify_DTO** (`ViewModels/VoucherVerify_DTO.cs`): `VoucherNumber`, `Items` (list of `VoucherLedgerInfo_DTO` with `LedgerId`, `Description`, `CostCenterId`, `TransactionItemId`), `Remarks`, `FiscalYearId`. Request body for `PUT VerifyVoucher`.
- **AccPaymentModeDataViewModel** (`ViewModels/AccPaymentModeDataViewModel.cs`): per-payment-mode ledger mapping.
- **AccountingLedgerVoucherMapViewModel** (`ViewModels/AccountingLedgerVoucherMapViewModel.cs`): voucher to default-ledger hint.
- **AccountingReferenceTypeViewModel** (`ViewModels/AccountingReferenceTypeViewModel.cs`): reference type enumeration (`Patient`, `Supplier`, `Vendor`, `User`, `Capital Goods Items`).
- **UniqueLedgerGroupVM** (`ViewModels/UniqueLedgerGroupVM.cs`): distinct-ledger-group view used in `GET LedgerGroupsDetails`.

### 3.6 Transfer folder

- **InvOtherCharegeViewModel** (`Transfer/InvOtherCharegeViewModel.cs`): inventory other-charges payload consumed during inventory-to-accounting transfer.
- **TransactionInventoryItemModel** (`Transfer/TransactionInventoryItemModel.cs`): per-inventory-item lines inside a transaction item, used to push inventory postings.

## 4. Database Tables (SQL Server, ACC_* and audit)

| Table pattern | Purpose | Primary Key |
|---|---|---|
| `ACC_Ledger` | Chart of accounts leaf | `LedgerId` |
| `ACC_LedgerGroup` | Mid-level grouping under COA | `LedgerGroupId` |
| `ACC_ChartOfAccount` | Top-level grouping | `ChartOfAccountId` |
| `ACC_PrimaryGroup` | P/L, Asset, Liability primary | `PrimaryGroupId` |
| `ACC_LedgerGroupCategory` | Categorization of ledger groups (Debit/Credit) | `LedgerGroupCategoryId` |
| `ACC_Voucher` | Voucher type master | `VoucherId` |
| `ACC_VoucherHead` | Voucher grouping head | `VoucherHeadId` |
| `ACC_VoucherLedgerGroupMap` | Default ledger group per voucher | composite |
| `ACC_SubLedger` | Party-level sub-ledger | `SubLedgerId` |
| `ACC_CostCenterItem` | Flat cost center list | `CostCenterItemId` |
| `ACC_CostCenter` | Hierarchical cost center (parent/child, `HierarchyLevel`) | `CostCenterId` |
| `ACC_FiscalYear` | Fiscal year master | `FiscalYearId` |
| `ACC_FiscalYearLog` | Close/reopen audit | `LogId` |
| `ACC_LedgerBalanceHistory` | Per-fiscal-year opening/closing balances | `LedgerBalanceHistoryId` |
| `ACC_SubLedgerBalanceHistory` | Sub-ledger version | `SubLedgerBalanceHistoryId` |
| `ACC_Transaction` | Voucher header (every double entry) | `TransactionId` |
| `ACC_TransactionItems` | Voucher Dr/Cr lines | `TransactionItemId` |
| `ACC_TransactionItemDetails` | Patient/Supplier/Vendor/User split | `TransactionItemDetailId` |
| `ACC_TransactionLinks` | Cross-module reference ids (CSV) | `AccountingTxnLinkId` |
| `ACC_TransactionCostCenterItems` | Per-line cost-center splits | `TransactionCostCenterItemId` |
| `ACC_SubLedgerRecord` / `ACC_SubLedgerTransaction` | Per-party sub-ledger movement | `SubLedgerTransactionId` |
| `ACC_LedgerMapping` | Generic ledger mapping (consultant, supplier, vendor, etc.) | `LedgerMappingId` |
| `ACC_AccountBillLedgerMapping` | Billing income-ledger mapping | `BillLedgerMappingId` |
| `ACC_BankReconciliationCategory` | Category master for bank reconciliation | `CategoryId` |
| `ACC_BankReconciliationModel` | Reconciled transactions log | `Id` |
| `ACC_BankAndSuspenseAccountReconciliationMap` | Bank to suspense link | `BankAndSuspenseAccountReconciliationId` |
| `ACC_AccountingPaymentModel` | Payment voucher for GRs | `PaymentId` |
| `ACC_ReverseTransaction` | Snapshot of reversed voucher (JsonData) | `ReverseTransactionId` |
| `ACC_EditVoucherLog` | Snapshot of items before manual edit | `LogId` |
| `ACC_AccountingTransactionHistory` | Sync audit | `Id` |
| `ACC_GroupMapping` | Transfer rules master | `GroupMappingId` |
| `ACC_HospitalTransferRuleMapping` | Per-hospital transfer rule activation | `HospitalTransferRulesMapId` |
| `ACC_AccountingCodeDetails` | Provisional-code reference | `Id` |
| `ACC_MapTransactionItemCostCenterItem` | Bridge table | `MapTransactionItemCostCenterItemId` |
| `ACC_Section` | Section master (Inventory=1, Billing=2, Pharmacy=3, Manual=4, Incentive=5) | `Id` + `SectionId` |
| `CFGParameters` (shared) | `SectionList` JSON for sections, `SubLedgerAndCostCenter` config, `IsAllowGroupby`, `EnableVoucherVerification` | `ParameterId` |

## 5. Key Workflows

### 5.1 Chart of Accounts setup
1. Create primary groups (`ACC_PrimaryGroup`).
2. Create COAs (`ACC_ChartOfAccount`) under primary groups.
3. Create ledger groups (`ACC_LedgerGroup`) under COAs.
4. Create ledgers (`ACC_Ledger`) under ledger groups. The accounting cache (`accCacheData`) populated by `AccountingService.getAccCacheData` keeps these in `DanpheCache` for offline access.

### 5.2 Voucher entry (manual)
1. User picks `VoucherHead` (which determines default cost center), then `Voucher` (e.g. Journal, Payment, Receipt, Contra, Sales, Purchase, Credit Note, Debit Note).
2. Client calls `GET ProvisionalVoucherNumber?voucherId=&sectionId=&transactiondate=` to display a preview number (`SectionCode-VoucherCode-SerialNo`).
3. Client collects Dr/Cr ledger lines plus optional sub-ledger, cost-center, and item-detail rows.
4. Client posts to `POST Trannsaction` (yes, that is the actual route name, with two `n`s). The handler `PostTransaction` (line 3324):
   - Looks up `FiscalYearId` for the date via `AccountingTransferData.GetFiscalYearIdByDate`.
   - Generates `VoucherNumber` via `GetVoucherNumber` (line 3342) and `TUId` via `GetTUID` (line 3343).
   - Sets `IsReverseTxnAllow = false`, `TransactionType = "ManualEntry"`, `IsEditable = true`, `SectionId = 4` (manual section).
   - Honors `EnableVoucherVerification` parameter: when true, new manual vouchers default to `Status = Draft`; when false, they auto-verify.
   - Adds the transaction and writes `EditVoucherLogModel` snapshots if reverse.
   - Persists and returns `{ VoucherNumber, FiscalyearId }`.

### 5.3 Transfer to Accounting (cross-module posting)
1. User opens `TransferToAccountingComponent`, selects source module (Billing, Pharmacy, Inventory, Incentive) and a date.
2. Client calls `GET {Billing,Pharmacy,Inventory,Incentive}ToAccounting?SelectedDate=&FiscalYearId=`.
3. Server returns bill/invoice/GR/incentive rows that have not yet been posted (via `SP_ACC_GetTransactionDates` and module-specific queries).
4. User clicks Post, client posts the full list to `POST Transactions` (the list endpoint), which calls `PostTransactionList` and delegates to `AccountingTransferData.PostTxnData`.
5. The posted `TransactionModel` carries `TransactionType = "CashBill" | "InventoryPayment" | "PharmacyPayment" | "ConsultantIncentive"` etc., and `TransactionLinkModel.ReferenceId` holds the CSV of source ids.

### 5.4 Ledger creation during transfer
When source rows lack a ledger, the user can create it on the fly via:
- `POST Ledgers` (list) in `AccountingController.AddLedgers` (line 2286) or `POST Ledgers` in `AccountingSettingsController.AddLedgers` (line 2286) - both call `AddLedgers`/`AddLedgerList` which set `Code` to a random 6-digit number, `HospitalId`, and insert a default `SubLedger` plus `LedgerMapping` if the type is `pharmacysupplier` etc.
- `POST Ledger` (single, body-driven) for shared component creation - duplicates rejected by `LedgerMappings.Any(r => r.HospitalId == HospId && r.ReferenceId == ledger.LedgerReferenceId && r.LedgerType == ledger.LedgerType)`.

### 5.5 Edit manual voucher
1. Client loads existing voucher via `GET Voucher?voucherNumber=&FiscalYearId=` (line 303).
2. User edits and posts to `PUT Transaction`. Server writes `EditVoucherLogModel` with `OldVocherJsonData`, then updates each line by `IsModified` and inserts new items.
3. Each `TransactionItemId` is matched; if absent, a new line is inserted; if not in the posted list, it is deleted along with its sub-ledger records.

### 5.6 Reverse a voucher
1. Client posts to `POST ReverseTransaction` with `Reason`, `PrevTransactionId`, `TransactionDate`.
2. `ReverseTransaction` handler (line 2312) serializes the previous voucher's items, sub-ledgers, and links into `ReverseTransactionModel.JsonData`, then sets `IsAllowReverseVoucher = false` and `IsVoucherReversed = true` on the original.

### 5.7 Verify a voucher
1. Client posts to `PUT VerifyVoucher` with `VoucherVerify_DTO { VoucherNumber, Items[], Remarks, FiscalYearId }`.
2. Server flips `IsVerified`, `VerifiedBy`, `VerifiedOn`, `VerificationRemarks`, `Status` to `Verified` on all `TransactionItems` of the voucher.

### 5.8 Bank reconciliation
1. `GET BankReconciliationCategories?FromDate=&ToDate=&sectionId=` returns categories with `MappedLedgerId`, `SubLedgerId`, `DrCr`.
2. `GET BankReconciliationReport?ledgerId=&fromDate=&toDate=&fiscalYearId=&voucherTypeId=&status=` shows unmatched bank-side transactions.
3. User selects matched transactions plus optional additional unmatched transactions.
4. `POST PostReconciliation` creates a `BankReconciliationModel` per row and (if `extraTxns` exist) posts a journal voucher automatically with the new `BankReconciliationVM`.

### 5.9 Account closure
1. User selects fiscal year. `POST AccountClose` calls `SP_ACC_AccountClosure` to roll ledger balances forward.
2. Server writes `FiscalYearLogModel { LogType = "closed", LogDetails = ..., FiscalYearId = ..., HospitalId = ... }`.

### 5.10 Fiscal year reopen
1. `PUT ReopenFiscalYear` calls the `_accountingDbContext.ReOpenFiscalYear` database function with `FiscalYearId`, `EmployeeId`, `HospitalId`, `Remark`.

### 5.11 Trial balance
`GET TrailBalanceReport?FromDate=&ToDate=&FiscalYearId=` calls `SP_ACC_RPT_GetTrialBalanceData` and groups by `COA -> LedgerGroupName -> Ledger`, returning opening/current Dr/Cr per ledger.

### 5.12 P&L
`GET ProfitAndLossReport?FromDate=&ToDate=&FiscalYearId=` calls `SP_ACC_RPT_GetProfitAndLossData`, groups by `PrimaryGroup -> COA -> LedgerGroupName -> Ledger`, excludes `Inventory` COA.

### 5.13 Balance sheet
`GET BalanceSheetReport?selectedDate=&FiscalYearId=` calls `SP_ACC_RPT_GetBalanceSheetData`, returns nested `PrimaryGroup -> COA -> LedgerGroupName -> Ledger` with `OpeningBalanceDr/Cr`, `DRAmount`, `CRAmount`, plus computed `netProfit` from a second result table.

### 5.14 Cash flow
`GET CashFlowReport?FromDate=&ToDate=&FiscalYearId=` calls `SP_ACC_RPT_CashFlowReport` returning opening + period data.

### 5.15 Day book
`GET DayBookReport?fromDate=&toDate=&fiscalYearId=&ledgerId=` calls `SP_ACC_RPT_Day_Book_Report` returning per-ledger movements.

### 5.16 Cash/Bank book
`GET CashBankBookReport?fromDate=&toDate=&fiscalYearId=&ledgerIds=` calls `SP_ACC_RPT_Cash_BankBookReport` (multi-ledger parameter).

### 5.17 Ledger report
`GET LedgerReport?ledgerId=&FromDate=&ToDate=&FiscalYearId=` returns per-transaction Dr/Cr plus opening/closing balance.
`POST LedgerListReport` accepts `LedgerReportRequest_DTO` for multi-ledger consolidated report.

### 5.18 Voucher report and Day-wise voucher report
- `GET VoucherReport?FromDate=&ToDate=&sectionId=` - one row per voucher with summed Dr amount.
- `GET DayWiseVoucherReport?FromDate=&ToDate=&sectionId=&FiscalYearId=` - per fiscal-year per-section.
- `GET DayWiseVoucherDetailsByVoucherNo?DayVoucherNumber=&voucherId=&sectionId=` - drill-down to the actual Dr/Cr lines plus patient, supplier, vendor, user details (for non-`SV` vouchers).

### 5.19 Sub-ledger report
`POST SubLedgerReport` accepts `SubLedgerReportRequest_DTO`, calls `SP_ACC_RPT_SubLedgerReport`, returns opening + transaction data.

### 5.20 Voucher verification queue
`GET VoucherVerification?FromDate=&ToDate=&sectionId=` returns unverified vouchers.

### 5.21 Bank reconciliation history
`GET BankReconciliationHistory?voucherNumber=&FiscalYearId=` returns per-voucher recon history with verifier name.

### 5.22 System audit
`GET SystemAuditReport?FromDate=&ToDate=&voucherReportType=&sectionId=` calls `SP_ACC_RPT_GetSystemAduitReport`.

### 5.23 Reverse transaction detail
`GET ReverseTransactionDetail?ReverseTransactionId=` returns snapshot + reconstructed vouchers.

### 5.24 Account head detail
`GET AccountHeadDetailReport` calls `SP_ACC_AccountHeadDetailReport`, groups by `PrimaryGroupName -> ChartOfAccountName/COACode -> ...`.

### 5.25 Daily transaction
`GET DailyTransactionReport?FromDate=&ToDate=` groups transactions by `TransactionDate + VoucherNumber + SectionId` with ledgerwise Dr/Cr.

### 5.26 Transaction origin detail
`GET TransactionOriginDetail?transactionIds=` returns the source rows (goods receipt, pharmacy invoice, incentive fraction) for the given transactions by joining `TransactionLinkModel.ReferenceId` with the appropriate module's primary table.

### 5.27 Suspense account reconciliation
`GET SuspenseAccountReconciliationDetail?BankLedgerId=&SuspenseAccountLedgerId=` calls `SP_ACC_GetSuspenseAccountReconciliationDetail`.
`POST SuspenseAcc/Reconcile` posts a reconciliation transaction between a bank ledger and a suspense account ledger and writes a `BankAndSuspenseAccountReconciliationMapModel`.

### 5.28 Group statement
`GET GroupStatementReport?FromDate=&ToDate=&FiscalYearId=&LedgerGroupId=` calls `SP_ACC_RPT_GetGroupStatementData` returning opening, transaction, and closing balances per ledger under the given group.

### 5.29 Multi-tenant hospital activation
- `GET Hospitals` returns active tenants.
- `GET TransactionDates?FromDate=&ToDate=&sectionId=` returns per-day posting count.
- `GET EmployeeLedgers` lists employee-ledger pairings.
- `GET FiscalYearLogs` returns the full close/reopen history.

### 5.30 Billing income-ledger mapping
- `GET BillingIncomeLedgers` calls `SP_ACC_GetIncomeLedgerMappingDetail`.
- `POST MapBillingIncomeLedger` adds a new `AccountingBillLedgerMappingModel` row.
- `PUT ActivateDeactivateBillingLedgerMapping` toggles `IsActive`.
- `PUT MapBillingLedger` updates an existing mapping.

## 6. API Endpoints

### 6.1 AccountingController (`api/Accounting`, ~43 endpoints)

| Verb | Route | Purpose |
|---|---|---|
| GET | `Vouchers` | List active voucher types |
| GET | `VoucherHeads` | Voucher heads by hospital |
| GET | `Ledgers` | Ledger list via `SP_ACC_GetLedgerList` (opening/closing balance) |
| GET | `MappedLedgers?ledgerType=` | Ledgers joined to `LedgerMappings` by type |
| GET | `FiscalYears` | All fiscal years (Nepali dates) |
| GET | `CostCenterItems` | Flat cost center items |
| GET | `ActiveFiscalYears` | Currently active fiscal year |
| GET | `Transactions?transactionId=` | Single transaction with items, ledger, fiscal year |
| GET | `TransactionByVoucherNumber?voucherNumber=&sectionId=&FiscalYearId=` | Voucher lookup with full patient, supplier, user, capital goods, return, payment drill-down (for Sales Vouchers) |
| GET | `RefrenceTransactionId?voucherNumber=&voucherId=` | Check if reference exists |
| GET | `InventoryToAccounting?SelectedDate=&FiscalYearId=` | Inventory rows ready to post |
| GET | `LedgerMapping` | All mappings |
| GET | `ConsultantLedgers` | Employee-ledger pairings |
| GET | `PharmacySupplierLedgers` | Pharmacy supplier-ledger pairings |
| GET | `InventoryVendorLedgers` | Inventory vendor-ledger pairings |
| GET | `InventorySubCategoryLedgers` | Inventory subcategory-ledger pairings |
| GET | `CreditOrganizationLedgers` | Credit org-ledger pairings |
| GET | `BillingToAccounting?SelectedDate=&FiscalYearId=` | Billing rows ready to post |
| GET | `PharmacyToAccounting?SelectedDate=&FiscalYearId=` | Pharmacy rows ready to post |
| GET | `IncentiveToAccounting?SelectedDate=&FiscalYearId=` | Incentive rows ready to post |
| GET | `Voucher?voucherNumber=&FiscalYearId=` | Voucher detail for edit |
| GET | `ProvisionalVoucherNumber?voucherId=&sectionId=&transactiondate=` | Preview next number |
| GET | `AccountingCodes` | Code details |
| GET | `ProvisionalLedgerCode` | Next ledger code |
| GET | `ProvisionalLedgerDetail?ledgerType=&referenceId=` | Provisional ledger creation hint |
| GET | `Hospitals` | Active tenants |
| GET | `FiscalYearLogs` | Fiscal year close/reopen log |
| GET | `EmployeeLedgers` | Employee-ledger pairings |
| GET | `TransactionDates?FromDate=&ToDate=&sectionId=` | Per-day posting summary |
| GET | `BankReconciliationCategories?FromDate=&ToDate=&sectionId=` | Recon categories |
| GET | `GoodReceipts?sectionId=&voucherId=&transactiondate=&voucherNumber=` | GR list |
| GET | `GetBankReconciliationCategory` | All active categories |
| GET | `get-paymentmodes` | Payment modes + mapped ledger/sub-ledger |
| GET | `SuspenseAccountReconciliationDetail?BankLedgerId=&SuspenseAccountLedgerId=` | Suspense detail |
| POST | `Trannsaction` | Post a single transaction |
| POST | `Transactions` | Post a list of transactions |
| POST | `AccountClose` | Close a fiscal year |
| POST | `Ledgers` | Add ledgers during transfer |
| POST | `Ledger` | Add a single ledger (shared component) |
| POST | `ReverseTransaction` | Reverse a manual voucher |
| POST | `IncentivePayment` | Post incentive payment voucher |
| POST | `Payment` | Make a payment (`MakePayment_DTO`) |
| POST | `UpdateBankReconciliationCategory` | Update category mapping |
| POST | `UpdateMedicareTypes` | Update medicare-type ledger |
| POST | `SuspenseAcc/Reconcile` | Reconcile bank with suspense |
| PUT | `Transaction` | Update a transaction (edit manual voucher) |
| PUT | `VerifyVoucher` | Verify voucher |

### 6.2 AccountingReportController (`api/AccountingReport`, ~22 endpoints)

| Verb | Route | Purpose |
|---|---|---|
| POST | `LedgerListReport` | Multi-ledger consolidated ledger report |
| GET | `CashBankBookReport?fromDate=&toDate=&fiscalYearId=&ledgerIds=` | Cash/Bank book |
| GET | `DayBookReport?fromDate=&toDate=&fiscalYearId=&ledgerId=` | Day book |
| GET | `BankReconciliationReport?ledgerId=&fromDate=&toDate=&fiscalYearId=&voucherTypeId=&status=` | Bank recon report |
| POST | `SubLedgerReport` | Sub-ledger report |
| GET | `VoucherReport?FromDate=&ToDate=&sectionId=` | Per-section voucher report |
| GET | `LedgerReport?ledgerId=&FromDate=&ToDate=&FiscalYearId=` | Single ledger report |
| GET | `TrailBalanceReport?FromDate=&ToDate=&FiscalYearId=` | Trial balance |
| GET | `GroupStatementReport?FromDate=&ToDate=&FiscalYearId=&LedgerGroupId=` | Group statement |
| GET | `ProfitAndLossReport?FromDate=&ToDate=&FiscalYearId=` | P&L |
| GET | `BalanceSheetReport?selectedDate=&FiscalYearId=` | Balance sheet |
| GET | `DailyTransactionReport?FromDate=&ToDate=` | Daily transaction |
| GET | `TransactionOriginDetail?transactionIds=` | Source rows per transaction |
| GET | `CashFlowReport?FromDate=&ToDate=&FiscalYearId=` | Cash flow |
| GET | `DayWiseVoucherReport?FromDate=&ToDate=&sectionId=&FiscalYearId=` | Per-day voucher count |
| GET | `DayWiseVoucherDetailsByVoucherNo?DayVoucherNumber=&voucherId=&sectionId=` | Drill-down |
| GET | `SystemAuditReport?FromDate=&ToDate=&voucherReportType=&sectionId=` | System audit |
| GET | `ReverseTransactionDetail?ReverseTransactionId=` | Reverse detail |
| GET | `BankReconcilationReport?FromDate=&ToDate=&ledgerId=&FiscalYearId=` | Bank reconciliation |
| GET | `BankReconciliationHistory?VoucherNumber=&FiscalYearId=` | Recon history |
| GET | `VoucherVerification?FromDate=&ToDate=&sectionId=` | Unverified vouchers |
| GET | `AccountHeadDetailReport` | Account head detail |
| POST | `PostReconciliation` | Save bank reconciliation |
| PUT | `Update` | Legacy stub |
| DELETE | `{id}` | Legacy stub |

### 6.3 AccountingSettingsController (`api/AccountingSettings`, ~40 endpoints)

| Verb | Route | Purpose |
|---|---|---|
| GET | `GetSubLedgers` | Sub-ledger list with parent ledger |
| GET | `VoucherHeads` | Voucher heads |
| GET | `Vouchers` | Voucher types |
| GET | `Ledgers` | All ledgers (id, name, isActive) |
| GET | `LedgerGroups` | Ledger groups by hospital |
| GET | `LedgerGroupsDetails` | Distinct (PrimaryGroup, COA) per hospital |
| GET | `FiscalYearList` | All fiscal years |
| GET | `CostCenterItemList` | Cost center items |
| GET | `ChartofAccount` | Chart of accounts |
| GET | `LedgersList` | All ledgers with closing balance (no opening filter) |
| GET | `SectionsList` | Sections by hospital |
| GET | `PharmacySupplier` | All pharmacy suppliers |
| GET | `Employee` | All employees |
| GET | `PrimaryList` | Active primary groups |
| GET | `TransferRules?SectionId=` | Transfer rules per section |
| POST | `AddSubLedger?ledger=` (form) | Add sub-ledger (form-encoded) |
| POST | `SubLedger` | Add sub-ledger from make-payment (DTO) |
| POST | `Ledgers` | Add single ledger |
| POST | `LedgersList` | Add/update list of ledgers |
| POST | `Vouchers` | Add voucher type |
| POST | `VoucherHead` | Add voucher head |
| POST | `LedgersGroup` | Add ledger group |
| POST | `CostCenterItem` | Add cost center item |
| POST | `LedgerGroupCategory` | Add ledger group category |
| POST | `Section` | Add section |
| POST | `ChartOfAccount` | Add COA |
| POST | `CostCenter` | Add hierarchical cost center |
| GET | `CostCenters` | All cost centers with parent names |
| GET | `GetParentCostCenters` | Parents only (top + level < 2) |
| PUT | `ActivateDeactiveSubLedger` | Toggle sub-ledger active |
| PUT | `UpdateSubLedger` | Update sub-ledger |
| PUT | `LedgerISActive` | Toggle ledger active |
| PUT | `ReopenFiscalYear` | Reopen closed fiscal year |
| PUT | `LedgerGroupActivateDeactivate` | Toggle ledger group active |
| PUT | `LedgerGroup` | Update ledger group |
| PUT | `CostCenterItemStatus` | Toggle cost center item active |
| PUT | `LedgerGroupCategoryActivateDeactivate` | Toggle ledger group category |
| PUT | `Ledger` | Update ledger |
| PUT | `VoucherHead` | Update voucher head |
| PUT | `Section` | Update section |
| PUT | `ChartOfAccount` | Update COA |
| PUT | `TransferRuleActivateDeactivate` | Toggle transfer rule per hospital |
| PUT | `VoucherShowChequeNo` | Toggle voucher `ShowChequeNumber` |
| PUT | `VoucherShowPayeeName` | Toggle voucher `ShowPayeeName` |
| PUT | `CostCenter` | Update hierarchical cost center |
| PUT | `CostCenter/ActivateDeactivate` | Toggle cost center active |

### 6.4 AccLedgerMappingController (`api/AccLedgerMapping`, 4 endpoints)

| Verb | Route | Purpose |
|---|---|---|
| GET | `BillingIncomeLedgers` | All billing income-ledger mappings (via `SP_ACC_GetIncomeLedgerMappingDetail`) |
| POST | `MapBillingIncomeLedger` | Add new mapping |
| PUT | `ActivateDeactivateBillingLedgerMapping?BillLedgerMappingId=&IsActive=` | Toggle mapping active |
| PUT | `MapBillingLedger` | Update existing mapping |

## 7. Cross-Module Integration

The Accounting module is the destination of every money movement in the hospital. Integration is event-driven and implemented in `DanpheEMR.AccTransfer.AccountingTransferData` (a sibling namespace).

### 7.1 Billing -> Accounting
Trigger: `BillingBL.PostBillingTransaction`, `BillingBL.PostDeposit`, `BillingBL.PostBillingReturn`, `BillingBL.PostDepositReturn`. Each call builds one or more `TransactionModel` rows with:
- `TransactionType = "CashBill" | "CreditBill" | "CashBillReturn" | "CreditBillReturn" | "DepositAdd" | "DepositReturn"`
- `SectionId = 2` (Billing)
- `TransactionItems` containing the patient receivable ledger (Dr/Cr) plus income ledger (Cr/Dr) plus payment-mode ledger (Dr/Cr)
- `TransactionLinkModel.ReferenceId` holding the comma-separated `BillingTransactionId` list
- `TransactionItemDetailModel.ReferenceType = "Patient"` (or `"User"` for cashier split)
Then the `Transaction` is added to `AccountingDbContext.Transactions` and saved, with `EnableVoucherVerification` parameter honored.

### 7.2 Inventory -> Accounting
Trigger: `InventoryBL` after `GoodReceipt`, `WriteOff`, `ReturnToVendor`, `DispatchToDept`, `INVDeptConsumedGoods`, `INVStockManageOut`. Builds a `TransactionModel` with:
- `TransactionType = "GoodReceipt" | "WriteOff" | "ReturnToVendor" | "DispatchToDept" | "INVDeptConsumedGoods" | "INVStockManageOut"`
- `SectionId = 1` (Inventory)
- `TransactionItems` with inventory subcategory ledger (the `inventorysubcategory` mapped ledger) plus a VAT/clearance-account ledger
- `TransactionItemDetailModel.ReferenceType = "Capital Goods Items"` for capital items
- `TransactionLinkModel.ReferenceId` is a CSV of `GoodsReceiptItemId` / `WriteOffId` / `ReturnToVendorItemId` / `StockTransactionId`
Lookup via `GET InventoryToAccounting?SelectedDate=...` shows the per-source-row totals.

### 7.3 Pharmacy -> Accounting
Trigger: `PharmacyBL` after `CashInvoice`, `CashInvoiceReturn`, `ReturnToSupplier`, `GoodReceipt`, `PHRMDispatchToDept`, `PHRMDispatchToDeptReturn`, `WriteOff`. `SectionId = 3` (Pharmacy). Lookup via `GET PharmacyToAccounting`.

### 7.4 Incentive -> Accounting
Trigger: `IncentiveBL` when consultant incentives are generated. `SectionId = 5` (Incentive). Lookup via `GET IncentiveToAccounting`. The post also flows through `POST IncentivePayment` in `AccountingController` (line 2326).

### 7.5 Payroll (cross-reference)
Payroll outputs salary expense journals in many systems; in DanpheEMR, the equivalent posting flows through the generic manual voucher (`SectionId = 4`). The HR/payroll subsystem posts via the same `TransactionModel` shape with `TransactionType = "ManualEntry"`. A future enhancement is to add a dedicated `SectionId = 6` for payroll postings.

### 7.6 Billing income-ledger mapping
`AccLedgerMappingController` exposes the master mapping between `ServiceDepartment` + `ItemId` and an income ledger. When billing posts, the lookup is `AccBillingLedgerMappingModel` (the same `ServiceDepartmentId + ItemId + BillingType` key) to find the income ledger; if missing, billing fails with "Income ledger not mapped" - prompting the user to map it via the settings page.

### 7.7 Payment of supplier (Inventory/Pharmacy)
`POST Payment` (line 2340) accepts a `MakePayment_DTO` with `AccountingPaymentModel` and `TransactionModel`. The handler creates a `Payment Voucher` (voucher code `PMTV`), generates the voucher number via `GetVoucherNumber`, and on full payment (`PaidAmount == TotalAmount`) updates `GoodsReceiptModels.IsPaymentDoneFromAcc` for Section=1 or `PHRMGoodsReceipt.IsPaymentDoneFromAcc` for Section=2.

### 7.8 IRD sync (Nepal)
While there is no dedicated IRD sync endpoint inside `Controllers/Accounting/`, the architecture supports it: each transactional row carries enough metadata to be sent to IRD (VoucherNumber, TransactionDate, PanNo on ledgers, totals). Sync is typically implemented at the Billing layer for real-time; the Accounting module provides the historical authoritative view via the `Transaction` table.

## 8. Business Rules

### 8.1 Debit/Credit semantics
- Every `TransactionItemModel` has a boolean `DrCr` (true=Dr, false=Cr).
- For any `Transaction`, the sum of Dr amounts must equal the sum of Cr amounts. This invariant is enforced in `AccTransfer.AccountingTransferData.PostTxnData` (not in the controller's own `PostTransaction` because that handler is reserved for manual entry, which is assumed to be balanced by the UI).
- `SubLedgerTransactionModel` carries `DrAmount` and `CrAmount` as two separate decimal columns to allow zero/zero lines.

### 8.2 Voucher types and codes
Common voucher codes (per `ENUM_ACC_VoucherCode`):
- `JV` - Journal Voucher
- `PMTV` - Payment Voucher
- `RCV` / `RV` - Receipt Voucher
- `CN` - Credit Note
- `DN` - Debit Note
- `SV` - Sales Voucher
- `PV` - Purchase Voucher
- `Contra` - Contra Voucher

Voucher numbers are formatted `{SectionCode}-{VoucherCode}-{SerialNo}` and `VoucherSerialNo` is a running per-section, per-fiscal-year counter. `TUId` is a per-hospital running counter that groups sales-voucher splits (one sale can produce multiple `TransactionModel` rows with the same `TUId`).

### 8.3 Sections
- `1` = Inventory
- `2` = Billing
- `3` = Pharmacy
- `4` = Manual
- `5` = Incentive
Configured via `CFGParameters.Group="Accounting" / Name="SectionList"` JSON, consumed by `AccountingBL.GetSections` and surfaced in reports.

### 8.4 Fiscal-year close and reopen
- Only one fiscal year can be `IsActive = true` per hospital.
- Closing requires the next fiscal year to exist (`AccountClose` errors with "Next fiscal year is not created" otherwise). The procedure `SP_ACC_AccountClosure` rolls the trial balance into the next year's opening.
- Reopen is allowed only for the immediately preceding closed fiscal year (`showreopen = true` only for that year).

### 8.5 Voucher verification
- Parameter `EnableVoucherVerification` (boolean) lives in `CFGParameters`.
- When true, every new manual voucher is created with `Status = "Draft"` and `IsVerified = false`; verification must be performed via `PUT VerifyVoucher`.
- When false, manual vouchers auto-verify (`IsVerified = true`, `VerifiedBy = current user`, `VerificationRemarks = "Voucher Verification is disabled..."`).

### 8.6 Voucher edit lock
Manual vouchers (`IsEditable = true`, `TransactionType = "ManualEntry"`) can be edited. System-generated vouchers have `IsEditable = false` by default and are not editable. The edit handler (`PUT Transaction`) is for manual vouchers only; it writes `EditVoucherLogModel.OldVocherJsonData` for audit.

### 8.7 Voucher reverse
A voucher is reversible if `IsAllowReverseVoucher = true`. The reverse handler flips that flag and writes a `ReverseTransactionModel` containing the full JSON snapshot of the original voucher's items, sub-ledgers, and links. Re-reversing is blocked.

### 8.8 Cost center and sub-ledger
- `CostCenterId` is now on `TransactionItemModel` (line level) since 26 Jan 2023 (per the in-source comment).
- `SubLedger` is a per-party breakdown of a ledger. The config flag `CFGParameters.SubLedgerAndCostCenter.EnableSubLedger` enables per-line sub-ledger and cost-center tracking.
- A default sub-ledger named "Default" (IsDefault=true) is created automatically when a new ledger is created (line 2139 in `AccountingSettingsController`).

### 8.9 Multi-tenant isolation
Every transaction and master row carries `HospitalId`. The current tenant is read from the session key `AccSelectedHospitalId` (or `CurrentHospitalId` depending on the controller). When a request comes from another module, the helper `AccountingTransferData.GetAccPrimaryHospitalId` falls back to a configured "primary accounting hospital" stored in `CFGParameters`.

### 8.10 Duplicate prevention
- Ledgers: `_accountingDbContext.Ledgers.Any(r => r.LedgerGroupId == ledger.LedgerGroupId && r.LedgerName.Trim().ToLower() == ledger.LedgerName.Trim().ToLower() && r.HospitalId == currentHospitalId)` -> reject.
- Voucher heads: same-name in same hospital rejected.
- Ledger groups: same `(LedgerGroupName, COA, PrimaryGroup)` rejected.
- Section: validated implicitly via `SectionList` JSON.

### 8.11 Audit
- `EditVoucherLogModel` snapshot on every manual edit.
- `ReverseTransactionModel` snapshot on every reverse.
- `FiscalYearLogModel` on every close/reopen.
- `BankReconciliationModel` per reconciliation row.
- `AccountingTransactionHistoryModel` for sync events.
- `LedgerBalanceHistoryModel` per fiscal-year per ledger for opening/closing tracking.

### 8.12 Tax handling
VAT is recorded in `TransactionItemDetailModel.Amount` with `ReferenceType = "Capital Goods Items"` or built into `TransactionItemModel.Amount` directly. Tax-specific ledgers (e.g. `VAT_INPUT`, `VAT_OUTPUT`) are configured at the chart-of-accounts level by the deployment team.

### 8.13 Currency
The base currency is implicit (NPR for Nepal deployments per the Nepali calendar support and IRD reference). The schema is currency-agnostic - all `decimal` columns store any currency.

### 8.14 Nepali calendar
`FiscalYearModel.NpFiscalYearName`, `nStartDate`, `nEndDate` carry Nepali representations. The conversion is done in `AccountingController.GetNepaliDate` (line 3306) using `DanpheDateConvertor.ConvertEngToNepDate`.

### 8.15 Caching
`AccountingService.getAccCacheData` populates a single in-memory `accCacheData` object (FiscalYear, Sections, Ledgers, VoucherHead, VoucherType, LedgerGroups, CodeDetails, PrimaryGroup, COA, LedgersALL, SubLedgerAll, CostCenters) using `DanpheCache.GetAccCacheData(MasterType.X, null)`. After any master change (`POST/PUT Ledgers`, `POST Vouchers`, etc.) the calling component should call `clearAccCacheDataFromDanpheCache` and `RefreshAccCacheData` to invalidate.

### 8.16 Page size
All controllers are decorated `[RequestFormSizeLimit(valueCountLimit: 100000, Order = 1)]` to allow large voucher entries.

### 8.17 Default section
`AccSectionModel.IsDefault` indicates the canonical section; the default cost-center auto-pick in `PostReconciliation` uses `CostCenters.Where(a => a.IsDefault == true).FirstOrDefault()`.

### 8.18 Grouped transactions
`IsGroupTxn` is set from `CFGParameters.IsAllowGroupby`; controls whether per-section transactions are grouped or not.

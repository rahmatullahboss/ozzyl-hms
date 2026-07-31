# DanpheEMR Reporting Module - Comprehensive Reference

## 1. Module Overview

The Reporting module is DanpheEMR's central cross-module reporting and analytics engine. It aggregates data from **every operational module** (Billing, ADT, Lab, Radiology, Appointment, Inventory, Pharmacy, Incentive, Accounting, Patient, Doctors, Emergency, Maternity, Government/MOH) and exposes a unified reporting surface through 200+ endpoints. The module is composed of:

- **4 backend controllers** (`ReportingController`, `BillingReportsController`, `DynamicReportingController`, `GovernmentReportingController`) plus an export controller in `ExportToExcel/ReportingNewController.cs`.
- **ReportingDbContext** (2,041 lines) and **GovernmentReportDbContext** (349 lines) - the dedicated data access layer that almost exclusively delegates to SQL Server stored procedures.
- **8 reporting model classes** in `ReportingModels/` that define strongly typed responses for patient bill history, dynamic reports, inpatient outcome, lab services, mortality, morbidity, and census.
- **150+ Angular components** under `wwwroot/DanpheApp/src/app/reporting/` organized by source module (adt, appointment, billing, doctors, lab, patient, police-case, radiology) and one standalone `dynamic-report/` component.
- **33 Excel export endpoints** that stream `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` responses built with the EPPlus library via `ExcelExportHelper`.
- **A SQL "Dynamic Reporting" endpoint** that allows authorized users to run read-only SELECT queries against the schema (with hard-coded DDL/DML keyword filtering).

The module also powers all Home, Billing, Lab, ER, and Inventory dashboards - most `Home_DashboardStatistics`, `LabDashboard*`, `BILLDsb*`, and `HomeInvDashboardStats*` endpoints are physically hosted in `ReportingController.cs` even though they are conceptually dashboard services.

The reporting module follows a "thin controller, thick stored procedure" pattern. Every endpoint is a four-to-twenty-line wrapper that:
1. Validates date bounds (preventing `SqlDateTime.MinValue`/overflow).
2. Calls a `ReportingDbContext` method that runs a single stored procedure.
3. Optionally shapes the result (e.g. `AllWardCountDetail` builds a per-ward dictionary and computes totals).
4. Serializes through `DanpheHTTPResponse<T>` (or `DataTable`) and returns JSON.
5. For Excel endpoints, passes the `DataTable` (or `DataSet.Tables[i]`) to `ExcelExportHelper.LoadFromDataTable` along with a `ColumnMetaData` list, then streams the EPPlus package as `FileContentResult`.

### Reporting URL surface (conventions)
- `GET /Reporting/...` - generic, ADT, lab, radiology, appointment, patient, doctors
- `GET /BillingReports/...` - billing-specific (still under Reporting area in the codebase)
- `GET /ReportingNew/ExportToExcel...` - Excel exports
- `POST /DynamicReporting/GetReportData` - the free-form SELECT runner
- `GET /GovernmentReporting/...` - government/MOH reports

### Authentication & Authorization
Both `ReportingController` and `BillingReportsController` carry `[DanpheDataFilter()]` at the class level. View-only endpoints (Razor pages) use `[DanpheViewFilter("reports-billingmain-xxx-view")]` to enforce the granular permission name (one per report). The dynamic SQL endpoint does not enforce view-level permissions, only the keyword blocklist.

---

## 2. Backend Files (5+ controllers)

### 2.1 `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Reporting/ReportingController.cs` (2,311 lines)

The largest controller in the Reporting area. Hosts 90+ JSON endpoints plus 27 Razor view endpoints, organized in five horizontal bands:

| Region | Endpoints | Examples |
|--------|-----------|----------|
| Main views (lines 34-83) | 7 | `ReportingMain`, `AdmissionMain`, `BillingMain`, `AppointmentMain`, `RadiologyMain`, `LabMain`, `DoctorsMain` |
| ADT reports (lines 90-330) | 12 | `PatientBillHistory`, `TotalAdmittedPatient`, `AdmissionAndDischargeList`, `RankMembershipwiseAdmittedPatientReport`, `DischargedPatient`, `AllWardCountDetail`, `TransferredPatient`, `DiagnosisWisePatientReport`, `InpatientOutstandingReport` |
| Radiology (lines 333-523) | 2 | `RevenueGenerated`, `CategoryWiseImagingReport` |
| Appointment (lines 359-497) | 7 | `DailyAppointmentReport`, `RankwiseDailyAppointmentReport`, `PhoneBookAppointmentReport`, `DistrictWiseAppointmentReport`, `GeographicalStatReport` |
| Lab (lines 524-655) | 5 | `CategoryWiseLabReport`, `DoctorWisePatientCountLabReport`, `CategoryWiseLabItemCountLabReport`, `ItemWiseLabItemCountLabReport`, `TestStatusDetailReport` |
| Scheduling/Doctors (lines 864-922) | 3 | `DoctorWisePatientReport`, `DepartmentWiseAppointmentReport`, `DayAndMonthWiseVisitReport` |
| Stat reports (lines 951-1030) | 3 | `DepartmentWiseStatReport`, `DoctorWiseStatisticReport`, `AgeClassifiedOPStatsReport` |
| Doctor master (lines 1066-1266) | 7 | `DoctorReferral`, `DoctorSummary`, `GetDoctorList`, `GetDiagnosisList`, `GetAppointmentTypeList`, `GetDepartmentList`, `GetEmployeeList`, `GetServiceDeptList` |
| Dashboard stats (lines 1269-1607) | 18 | `IncomeSegregation`, `DailyRevenueTrend`, `MonthlyBillingTrend`, `BILLDsbCntrUsrCollection`, `BILLDsbOverallBillStatus`, `HomeDashboardStats`, `HomeInvDashboardStats`, `DepartmentWiseConsumerItems`, `SubCategoryWiseInventoryStockValue`, `MonthlyWisePurchaseOrdervsGoodsReceiptValue`, `PatientZoneMap`, `DepartmentAppointmentsTotal`, `PatientGenderWise`, `PatientAgeRangeNGenderWise`, `LabDashboard`, `CovidDetailsForLab`, `ERDashboard` |
| Discharge / Patient (lines 1609-1732) | 4 | `DischargedPatientBillBreakup`, `PatientRegistrationReport`, `PoliceCaseReport`, `OutpatientMorbidityReport` |
| Covid / Lab detail (lines 1735-1873) | 7 | `TotalCovidTestsDetailReport`, `CovidTestsCumulativeReport`, `GetHIVTestsDetailReport`, `GetCultureTestsDetailReport`, `GetLabTypeWiseTestCountReport`, `EditedPatientDetailReport`, `FilmTypeCountReport` |
| Incentive / Hospital income (lines 1876-1916) | 2 | `HospitalIncomeIncentiveReport`, `HospitalIncomeIncentiveReportServiceDepartmentWise` |
| Medical records / Morbidity (lines 1918-1938) | 2 | `EmergencyPatientMorbidityReport`, `OutpatientMorbidityReport` (both via `MedicalRecordsDbContext`) |
| Inventory / Dashboard cards (lines 1941-2080) | 6 | `InventoryDashboardStatistics`, `DepertmentwiseDispatchedValue`, `GetSubCategoryWiseInventoryStockValue`, `MonthlyWiseTransaction`, `BillingDashboardCardSummary`, `BillingDashboardRankWisePatientInvoiceCount`, `BillingDashboardMembershipWisePatientInvoiceCount` |
| Lab dashboard cards (lines 2100-2305) | 10 | `LabDashboardMembershipWiseTestCount`, `LabDashboardRankWiseTestCount`, `DepartmentWiseRankCountReport`, `LabDashboardTrendingTestCount`, `LabDashboardTestDoneToday`, `LabDashboardDengueTestDetails`, `LabDashboardLabReqDetails`, `LabDashboardNormalAbnormalDetails`, `InpatientOutstandingReport` |

### 2.2 `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Reporting/BillingReportsController.cs` (1,967 lines)

Holds the 79 billing-centric report endpoints. Organized as:

| Region | Endpoints | Examples |
|--------|-----------|----------|
| Bill cancel / credit (lines 37-156) | 4 | `BillCancelSummaryReport`, `CreditSettlementReport`, `CreditSettlementViewDetail`, `CustomReport` |
| Denomination / Deposit (lines 160-249) | 3 | `BilDenominationReport`, `BilDenominationReportAllList`, `DepositBalance` |
| Department (lines 254-326) | 3 | `DepartmentRevenueReport`, `DepartmentSummaryReport`, `BillDeptItemSummary` |
| Doctor (lines 331-401) | 3 | `DoctorRevenue`, `DoctorReport`, plus duplicates `DailySalesReport`, `DiscountReport` (lines 409-473) |
| Sales / Day book (lines 477-545) | 4 | `TotalItemsBill`, `SalesDaybook`, `DepartmentSalesDaybook` |
| Misc billing (lines 548-706) | 8 | `PatientNeighbourhoodCardDetail`, `PackageSalesDetail`, `DialysisPatientDetail`, `PatientBillHistory` (duplicate), `TotalAdmittedPatient` (duplicate), `DischargedPatient` (duplicate), `TransferredPatient` (duplicate), `IncomeSegregationStaticReport` |
| Patient census / OP/IP (lines 735-851) | 5 | `PatientCensusReport`, `DoctorwiseOutPatientReport`, `DailyMISReport`, `DoctorPatientCount`, `BillDepartmentSummary` |
| Doctor drill-down (lines 836-930) | 4 | `BillDocSummary`, `BillDocDeptSummary`, `BillDocDeptItemSummary`, `DoctorwiseIncomeSummaryOPIP` |
| Sales / Pharmacy graph (lines 932-957) | 1 | `SalesPurchaseTrainedCompanion` (uses `PharmacyReportingDbContext` SP) |
| Doctor / patient reports (lines 967-1035) | 4 | `DoctorWisePatientReport` (duplicate), `DepartmentWiseAppointmentReport` (duplicate), `PatientCreditBillSummary` (duplicate), `DoctorSummary` (duplicate) |
| Master lookups (lines 1073-1207) | 6 | `GetDoctorList`, `GetReferralList`, `GetAppointmentTypeList`, `GetDepartmentList`, `GetEmployeeList`, `GetServiceDeptList` |
| Dashboards (lines 1210-1441) | 11 | `IncomeSegregation`, `DailyRevenueTrend`, `MonthlyBillingTrend`, `BILLDsbCntrUsrCollection`, `BILLDsbOverallBillStatus`, `HomeDashboardStats`, `PatientZoneMap`, `DepartmentAppointmentsTotal`, `PatientGenderWise`, `PatientAgeRangeNGenderWise`, `ERDashboard` (duplicates) |
| Discharge / Return (lines 1443-1547) | 3 | `DischargedPatientBillBreakup`, `ReturnBillReport`, `ReturnBillReportViewDetail` |
| Referral (lines 1549-1587) | 2 | `Bill_ReferralSummary`, `Bill_ReferralItemSummary` |
| Incentive (lines 1589-1686) | 5 | `INCTV_DocterSummary`, `INCTV_DocterItemSummary`, `INCTV_Doc_ItemGroupSummary`, `BIL_TXN_GetHandoverCalculationDateWise`, `INCTV_DocterPaymentSummary` |
| Misc (lines 1689-1965) | 9 | `RPT_Bil_ItemSummaryReport`, `EHSBillReport`, `Billing_DepositTransationsReport`, `Billing_SchemeWiseDiscountReport`, `Billing_DepartmentWiseDiscountSchemeReport`, `Billing_ItemLevelDepartmentWiseDiscountSchemeReport`, `GetAllDepartmentList`, `UserWiseCashCollectionReport`, `PaymentModeWiseReport`, `BillDetailReport`, `BillingSchemeDetailInvoiceReport`, `RankMembershipWiseDischargePatientReport` |

### 2.3 `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Reporting/ExportToExcel/ReportingNewController.cs` (1,507 lines)

The Excel export controller. It exposes 33 `FileContentResult` methods that build a `ColumnMetaData` list, push it through `ExcelExportHelper.LoadFromDataTable`, and stream the resulting EPPlus package. Key methods:

| Method (line) | Stored Proc / DB call | Output file |
|---------------|----------------------|-------------|
| `ExportToExcelDoctorRevenue` (25) | `reportingDbContext.DoctorRevenue` | `DoctorRevenue.xlsx` |
| `ExportToExcelDoctorReferral` (77) | `reportingDbContext.DoctorReferral` | `DoctorReferral.xlsx` |
| `ExportToExcelTotalItemsBill` (126) | `reportingDbContext.TotalItemsBill` | `TotalItemsBill.xlsx` |
| `ExportToExcelSalesDayBook` (169) | `reportingDbContext.SalesDaybook` | `SalesDayBook.xlsx` |
| `ExportToExcelDoctorwiseIncomeSummary` (208) | `SP_Report_BILL_DoctorWiseIncomeSummary_OPIP` | `DoctorwiseIncomeSummary.xlsx` |
| `ExportToExcelDailyMISReport` (243) | `SP_Report_BILL_DailyMISReport` | `DailyMISReport.xlsx` |
| `ExportToExcelDailySales` (282) | `SP_Report_BIL_DailySales` | `DailySales.xlsx` |
| `ExportToExcelDiscountReport` (348) | `reportingDbContext.DiscountReport` | `DiscountReport.xlsx` |
| `ExportToExcelDepositBalance` (390) | `reportingDbContext.DepositBalanceReport` | `DepositBalance.xlsx` |
| `ExportToExcelCreditSummary` (426) | `reportingDbContext.BIL_PatientCreditSummary` | `CreditSummary.xlsx` |
| `ExportToExcelReturnBills` (468) | `reportingDbContext.BIL_ReturnReport` | `ReturnBills.xlsx` |
| `ExportToExcelIncomeSegregation` (516) | `reportingDbContext.Get_Bill_IncomeSegregationStaticReport` | `IncomeSegragation.xlsx` |
| `ExportToExcelDocSummary` (566) | `SP_Report_BIL_DoctorSummary` | `DoctorSummary.xlsx` |
| `ExportToExcelBilDeptSummary` (613) | `SP_Report_BIL_DepartmentSummary` | `DepartmentSummary.xlsx` |
| `ExportToExcelBilDocDeptItemSummary` (656) | `SP_Report_BIL_DoctorDeptItemsSummary` | `DoctorDepartmentItems.xlsx` |
| `ExportToExcelRefSummary` (710) | `SP_Report_BIL_ReferralSummary` | `ReferralSummary.xlsx` |
| `ExportToExcelBilRefItemSummary` (758) | `SP_Report_BIL_ReferralItemsSummary` | `ReferralItemsSummary.xlsx` |
| `ExportToExcelBilDocDeptSummary` (812) | `SP_Report_BIL_DoctorDeptSummary` | `DoctorDepartmentSummary.xlsx` |
| `ExportToExcelBilDeptItemSummary` (866) | `SP_Report_BIL_DepartmentItemSummary` | `DepartmentItemSummary.xlsx` |
| `ExportToExcelCustomReport` (917) | `SP_Report_BILL_CustomReport` | `CustomReport.xlsx` |
| `ExportToExcelPatientCensus` (945) | `SP_Report_BILL_PatientCensus` | `PatientCensus.xlsx` |
| `ExportToExcelDoctorReport` (1010) | `reportingDbContext.DoctorReport` | `DoctorReport.xlsx` |
| `ExportToExcelPackageSalesReport` (1077) | `reportingDbContext.PackageSalesDetail` | `PackageSalesReport.xlsx` |
| `ExportToExcelCancelBills` (1120) | `reportingDbContext.BIL_BillCancelSummary` | `CancelBills.xlsx` |
| `ExportToExcelDailyAppointment` (1163) | `reportingDbContext.DailyAppointmentReport` | `DailyAppointmentReport.xlsx` |
| `ExportToExcelPhoneBookAppointment` (1195) | `reportingDbContext.PhoneBookAppointmentReport` | `PhoneBookAppointmentReport.xlsx` |
| `ExportToExcelDiagnosisWisePatientReport` (1228) | `reportingDbContext.DiagnosisWisePatientReport` | `DiagnosisWisePatientReport.xlsx` |
| `ExportToExcelDepartmentSales` (1253) | `reportingDbContext.DepartmentSalesDaybook` | `DepartmentSalesReport.xlsx` |
| `ExportToExcelTransferToAccount` (1304) | `AccountingDbContext` | `TransferToAccount.xlsx` |
| `ExportToExcelCategoryWiseLabReport` (1352) | `reportingDbContext.CategoryWiseLabReport` | `CategoryWiseLabTest.xlsx` |
| `ExportToExcelDoctorWisePatientCountLabReport` (1387) | `reportingDbContext.DoctorWisePatientCountLabReport` | `DoctorWiseLabTest.xlsx` |
| `ExportToExcel_INCTV_AllEmpItemsSettings` (1424) | `SP_Inctv_ExportAllEmpItemsSettings` | `INCTV_AllEmpItemsSettings.xlsx` |
| `ExportToExcelSubstoreDispConSummaryReport` (1459) | `SP_INV_RPT_GetSubstoreDispConsumption_Summary` | `SubstoreDispatchandConsumption.xlsx` |

### 2.4 `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Reporting/GovernmentReportingController.cs` (278 lines)

Holds the Government / MOH endpoints. Five public methods plus two view methods:

| Method (line) | SP | Description |
|---------------|----|-------------|
| `GetSummaryReport` (38) | `SP_Report_Gov_Summary` | Returns 9 tables (Out & Emerg services, Diagnostic, Free services, Immunization, IP referred out, Total admitted, IP days, Lab service count, OP referred out) |
| `GetLaboratoryServices` (65) | `SP_LAB_TestCount_GovernmentReport` | Returns `LabGovReportItems` configured as government-required and the per-test counts between dates |
| `GetInpatientOutcome` (201) | Returns `InpatientServiceReportModel` | IP outcome, gestational week, free health service summary, death summary, surgery summary, medico-legal cases |
| `GetInpatientMorbidityReportData` (226) | `GetInpatientMorbidity` | Inpatient morbidity report JSON |
| `GetHospitalMortalityReportData` (251) | `GetHospitalMortality` | Hospital mortality report JSON |

### 2.5 `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Reporting/DynamicReportingController.cs` (78 lines)

A single `GetReportData` endpoint (line 24) that accepts a `QueryStringDTO { Query }` and runs a read-only `SqlDataAdapter.Fill(DataTable)` against the connection. The query is validated against a hard-coded list: `create, drop, update, insert, alter, delete, attach, detach, grant, truncate, revoke`. On a hit, it returns `Status: "Failed"` and `ErrorMessage: "Using this feature you can only read data."` This is the only write-capable surface in the entire Reporting module, and it is intentionally throttled to SELECT-only.

### 2.6 Supporting Data Access Layer Files

- `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/ReportingDbContext.cs` (2,041 lines) - 124 methods, each one a thin wrapper around `DALFunctions.GetDataTableFromStoredProc` or `GetDatasetFromStoredProc`.
- `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/GovernmentReportDbContext.cs` (349 lines) - 17 methods used only by `GovernmentReportingController`.
- `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/PharmacyReportingDbContext.cs` - supplies `SalesPurchaseTrainedCompanion` data via the `SP_DSB_Pharmacy_SalesPurchaseGraph_DashboardStatistics` SP.
- `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/WardReportingDbContext.cs` - ward-specific reporting.
- `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/InventoryReportingDbContext.cs` - inventory-specific reporting.

---

## 3. Data Models

All model classes live under `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/ReportingModels/`:

### 3.1 `DynamicReport.cs`
The central "schema-less" envelope used by ~30 endpoints. It carries two strings:
- `Schema` (string, JSON serialized) - currently mostly `null` because the dynamic grid component reads column names from the first row.
- `JsonData` (string, JSON serialized) - either a single `DataTable` or an anonymous object with multiple tables (e.g. `{ ReportData, Summary }`).

This pattern lets a single endpoint return heterogeneous multi-table datasets (e.g. Income Segregation returns 9 tables wrapped in one anonymous object).

### 3.2 `PatientBillHistory.cs`
- `PatientBillHistoryMaster` - aggregate with five lists: `paidBill`, `unpaidBill`, `returnBill`, `cancelBill`, `deposits`.
- `PatientBillHistory` - base with `SrNo`, `Department`, `Item`, `Rate`, `Quantity`, `Amount`, `Discount`, `Tax` (all `double?`).
- `PaidBillHistory : PatientBillHistory` - adds `SubTotal`, `PaidDate`, `ReceiptNo`.
- `UnpaidBillHistory : PatientBillHistory` - adds `SubTotal`, `ReceiptNo`, `Date`.
- `ReturnedBillHistory : PatientBillHistory` - adds `ReturnedAmount`, `ReturnDate`, `ReturnedBy`, `ReceiptNo`, `Remarks`.
- `CancelBillHistory : PatientBillHistory` - adds `CancelledAmount`, `CancelledDate`, `CancelledBy`, `Remarks`.
- `Deposit` - `SrNo`, `ReceiptNo`, `TransactionType`, `Amount`, `Remarks`, `Date`.

The shape is fed by the `SP_Report_BILL_PatientBillHistory` stored procedure which returns 5 result sets; the data context manually walks each `DataTable` and uses reflection (`ConvertDataTable<T>` / `GetItem<T>`) to map columns to properties.

### 3.3 `ADTInpatientCensusSummary.cs`
Per-ward census row: `Ward`, `NewAdmission`, `TransIn`, `TransOut`, `Discharged`, `InBed`, `Total`. Built in `AllWardCountDetail` from 4 result sets of `SP_Report_ADT_PatientInOutReport` and aggregated by `WardName`.

### 3.4 `LaboratoryServices.cs`
9 string properties holding JSON-serialized `DataTable` results for each lab section. The current code only uses `HaematologyModel0` / `HaematologyModel1` (and the others for backward compatibility). The newer `GetLaboratoryServices` endpoint returns a `Dictionary<string, Dictionary<string, dynamic>>` directly instead.

### 3.5 `InpatientServiceReportModel.cs` (Government)
8 string properties each containing a JSON-serialized government report table: `InpatientOutcome`, `GestationalWeek_Gravda`, `GestationalWeek_MaternalAge`, `FreeHealthServiceSummary`, `FreeHealthServiceSummary_SSP`, `DeathSummary`, `SurgerySummary`, `MedicoLegalCases`.

### 3.6 `InpatientMorbidityReportModel.cs`, `HospitalMortalityReportModel.cs`
Single-string wrappers around JSON-serialized SP output. `OutpatientMorbidityReportViewModel` instead has typed fields: `ReportingGroupCount`, `OtherICDCount`, `TotalVisitCount`, `IcdVersion` (ICD-10 version string).

### 3.7 `BillingReportVMs.cs` and `PharmacyReportVMs.cs`
Both contain a `UserColln_SettlementSummaryVM`:
- `BilRPT_UserColln_SettlementSummaryVM` - `CollectionFromReceivables`, `CashDiscountGiven`, `CashDiscountReceived`.
- `PHRM_UserColln_SettlementSummaryVM` - same three fields for pharmacy user collection.
Both expose a static `MapDataTableToSingleObject(DataTable)` helper that serializes a `DataTable` to JSON, deserializes back to a list, and returns the first element. This is used by `DailySalesReport` (SP returns 4 tables, second one is a single-row settlement summary).

### 3.8 `Settlement_PatientInfoVM` (in `ServerModel.BillingReports` namespace)
Referenced by `CreditSettlementViewDetail` to map the first table of `SP_BIL_GetSettlementDetailReportOfPatient` to a single patient object.

---

## 4. Database Tables (Read-Only)

The Reporting module is a read-only consumer. The data is sourced from existing operational tables. The most important tables it reads from are:

### Core operational tables
- `PAT_Patient` - patient master.
- `PAT_Visits` / `PAT_PatientVisits` - visits and admissions.
- `ADT_Admission` / `ADT_DischargeSummary` - admission events, discharge diagnoses.
- `ADT_PatientBedInfo` - bed assignments.
- `ADT_Ward`, `ADT_Bed`, `ADT_BedFeature` - ward/bed lookup.
- `BIL_TXN_BillingTransaction` / `BIL_TXN_BillingTransactionItems` - invoices, line items.
- `BIL_TXN_Deposit` - patient deposits and deductions.
- `BIL_TXN_Return` - return / credit notes.
- `BIL_TXN_Settlement` - settlements.
- `EMP_Employee`, `MST_Department`, `MST_ServiceDepartment` - master data.
- `MR_VisitCode`, `MR_PatientCode` - identifiers.
- `PAT_Appointment`, `PAT_PhoneBookAppointment` - appointments.
- `LAB_TestRequisition`, `LAB_Requisition`, `LAB_TestComponentResult` - lab orders.
- `RAD_PatientImaging`, `RAD_ImagingRequisition` - radiology orders.
- `INV_TXN_Stock`, `INV_TXN_Dispatch`, `INV_MST_Item` - inventory.
- `PHRM_StockTransaction`, `PHRM_InvoiceTransactionItems` - pharmacy.
- `INCTV_EmployeeItemsMapping` - incentive configurations.
- `TXN_Voucher`, `ACC_Ledger`, `ACC_TransactionItems` - accounting.
- `Audit_AuditTrail` - audit history.

### Government / MOH reference tables
- `LAB_GovReportItems` - master list of government-mandated lab tests (HasInnerItems, InnerTestGroupName, SerialNumber, GroupName, TestName).
- ICD-10 mapping tables referenced by the `SP_Report_Appointment_*` and `OutpatientMorbidityReport` SPs.

### Reporting-only tables
There is no dedicated reporting schema. There is, however, a `RPT_*`-prefixed convention for stored procedures (e.g. `SP_Report_BIL_DailySales`, `SP_Report_ADT_PatientInOutReport`, `SP_Report_Appointment_GeographicalStatReport`, `SP_Report_Lab_CategoryWiseLabReport`, `SP_Report_INCTV_DoctorSummary`, `SP_Report_Gov_Summary`).

### Materialized / aggregate tables
None - all aggregation is performed in the stored procedures. The closest to a reporting helper is `SP_BILL_GetServiceDepartmentsName` (used by `LoadServDeptsNameFromFN`) and `SP_RPT_GetServiceDepartmentsName`.

---

## 5. Key Workflows

### 5.1 Run a standard report (JSON)

```
Client -> /Reporting/CategoryWiseImagingReport?FromDate=...&ToDate=...
  -> ReportingController.CategoryWiseImagingReport (line 500)
    -> ReportingDbContext.CategoryWiseImagingReport
      -> SP_Report_Radiology_CategoryWiseImagingReport (returns 2 tables)
      -> DynamicReport { Schema = Table[0] JSON, JsonData = Table[1] JSON }
    -> DanpheHTTPResponse<DynamicReport> { Status = "OK", Results = dReport }
  -> JSON response
```

1. Angular component (`category-wise-imaging-report.component.ts:47`) calls `dlService.Read("/Reporting/CategoryWiseImagingReport?FromDate=...&ToDate=...")`.
2. `DanpheDataFilter` action filter attaches the request user / tenant.
3. Controller method runs the `ReportingDbContext` call.
4. `ReportingDbContext` calls the SP via `DALFunctions.GetDatasetFromStoredProc`, wraps the result in `DynamicReport` (or returns raw `DataTable`).
5. Response is serialized through `DanpheJSONConvert.SerializeObject` and returned.
6. Frontend reads `res.Results.JsonData`, parses, and feeds it to the `danphe-grid` component.

### 5.2 Excel export

```
Client -> /ReportingNew/ExportToExcelDailySales?FromDate=...&ToDate=...&CounterId=...&CreatedBy=...&SummaryData=...&SummaryHeader=...&IsInsurance=...
  -> ReportingNewController.ExportToExcelDailySales (line 282)
    -> ReportingDbContext.DailySalesReport (indirectly via SP_Report_BIL_DailySales)
    -> Builds 12 ColumnMetaData entries with display sequence, display name, and Formula enum (Sum, Date, Count)
    -> Sorts by DisplaySeq, removes unwanted columns (CounterId, TaxTotal, BillingDate, EmployeeId)
    -> ExcelExportHelper("Sheet1").LoadFromDataTable(...)
    -> export.package.GetAsByteArray() (EPPlus ExcelPackage)
  -> FileContentResult with content-type "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
```

Key parts of `ColumnMetaData`:
- `DisplaySeq` (int) - column order in the output.
- `ColName` (string) - must match the source `DataTable` column name.
- `ColDisplayName` (string) - shown in the Excel header.
- `Formula` (`ColumnFormulas` enum) - `Sum`, `Date`, `Count` are supported; an empty value means plain passthrough.

The `LoadFromDataTable` overload signature is roughly:
`LoadFromDataTable(List<ColumnMetaData> columns, DataTable data, string header, bool showSummary, bool addSerialNumber, List<string> removeColumns = null, string summaryData = null, string summaryHeader = null)`.

### 5.3 Dynamic SQL report (read-only)

```
Client -> POST /DynamicReporting/GetReportData with body { Query: "SELECT TOP 100 * FROM PAT_Patient" }
  -> DynamicReportingController.GetReportData (line 24)
    -> CheckQueryValidation(Query) - rejects if any of [create, drop, update, insert, alter, delete, attach, detach, grant, truncate, revoke] appears as a whole word (regex \b<keyword>\b)
    -> If accepted: SqlDataAdapter fills DataTable; rows converted to List<Dictionary<string, object>> via DataTable.Columns enumeration
    -> DanpheHTTPResponse<object> with the list
```

Validation pattern: `@"(^|\s)" + keyword + "(^|\\s)"` - the dual anchor prevents false positives like "updatedAt" or "insertiondate", but the regex is naive (e.g. "RECREATE" with the leading space in a literal would not match; "deleted" inside a column name would). Treat this as a defense-in-depth measure, not a security boundary.

### 5.4 Government / MOH report

```
Client -> /GovernmentReporting/GetInpatientOutcome?FromDate=...&ToDate=...
  -> GovernmentReportingController.GetInpatientOutcome (line 201)
    -> GovernmentReportDbContext.GetInpatientOutcome
      -> SP returns 6 separate tables (each is a JSON-serialized string in InpatientServiceReportModel)
    -> DanpheHTTPResponse<InpatientServiceReportModel> { Results = obj }
  -> JSON response
```

For `GetLaboratoryServices`, the controller:
1. Pulls `LabGovReportItems` from `LabDbContext` where `IsActive == true` ordered by `SerialNumber`.
2. Builds a nested `Dictionary<string, Dictionary<string, dynamic>>` keyed by category name (spaces replaced with underscores) and test name.
3. Calls `SP_LAB_TestCount_GovernmentReport` to get per-test counts and merges them into the dictionary.
4. Returns the dictionary directly (not wrapped in `DynamicReport`).

### 5.5 Government Lab Item Mapping (config)

The "Government Reporting" view (`GovernmentMainView`) allows hospital admins to map a `LabGovReportItems` row to a category. The endpoint `LabGovReportItems` (in `LabDbContext`) returns the active items; the controller re-shapes them so the UI can render `HasInnerItems` / `InnerTestGroupName` groupings (a 3-level hierarchy).

### 5.6 Government Morbidity report

The `OutpatientMorbidityReport` endpoint delegates to `MedicalRecordsDbContext.OutPatientMorbidityReport` (not to `ReportingDbContext`):
- `OutpatientMorbidityReportViewModel` exposes `ReportingGroupCount` (count of ICD-10 diagnoses that fall into the 232 government-specified groups), `OtherICDCount` (count of diagnoses outside that list), `TotalVisitCount`, and `IcdVersion`.

### 5.7 Incentive reports

The Incentive module plugs into Reporting through 5 endpoints:
- `INCTV_DocterSummary` - employee-by-employee breakdown (also supports `IsRefferalOnly` flag).
- `INCTV_DocterItemSummary` - drill-down by item for a single employee.
- `INCTV_Doc_ItemGroupSummary` - group-level rollup.
- `INCTV_DocterPaymentSummary` - payment summary.
- `BIL_TXN_GetHandoverCalculationDateWise` - handover report for shift changes.

### 5.8 Hospital Income Incentive report

`HospitalIncomeIncentiveReport(FromDate, ToDate, ServiceDepartments)` and `HospitalIncomeIncentiveReportServiceDepartmentWise(FromDate, ToDate, ServiceDepartmentId)` are stored-proc wrappers (`SP_INCTV_Report_Hospital_Income` and `SP_INCTV_Report_ServiceDepartmentWise_Hospital_Income`).

### 5.9 Inpatient Outstanding report

`InpatientOutstandingReport(Operator, Amount)` allows filtering with comparison operators (>, <, =, etc.) and a numeric amount - the SP `SP_RPT_Admission_InPatientOutstandingReport` returns the matching admissions.

### 5.10 Patient Census drill-down

`PatientCensusReport` returns a `DynamicReport` with two tables - `ReportData` (provider/department rows with counts/amounts) and `Summary` (totals). The frontend (`patient-census-report.component.ts`) flattens this into three levels (Doctor > Service Department > Item) by parsing `res.Results.JsonData` and re-grouping by `Provider` and `ServiceDepartmentName`.

### 5.11 All Ward Count Detail (Inpatient Census)

`AllWardCountDetail(FromDate, ToDate)` runs `SP_Report_ADT_PatientInOutReport` which returns 4 tables:
1. All wards (used as dictionary keys).
2. Admission / Transfer-In actions per ward.
3. Discharge / Transfer-Out actions per ward.
4. Current InBed count per ward.

The controller materializes a `Dictionary<string, ADTInpatientCensusSummary>` keyed by `WardName`, then loops each table, updating the corresponding dictionary entry. `Total = InBed + NewAdmission + TransIn - TransOut - Discharged`.

### 5.12 Bill Denomination report

`BilDenominationReport(FromDate, ToDate, UserId)` runs `SP_Report_Bill_BillDenomination` for a single user; `BilDenominationReportAllList(FromDate, ToDate)` runs `SP_Report_Bill_BillDenominationAllList` (no user filter).

### 5.13 Discount Scheme reports

Three distinct reports use three different stored procedures:
- `Billing_SchemeWiseDiscountReport(FromDate, ToDate, SchemeId)` -> `SP_Report_SchemeWiseDiscountReport`
- `Billing_DepartmentWiseDiscountSchemeReport(FromDate, ToDate, MembershipTypeId, ServiceDepartmentId, PaymentMode)` -> `SP_Report_DepartmentWiseDiscountSchemeReport`
- `Billing_ItemLevelDepartmentWiseDiscountSchemeReport(BillingTransactionId, MembershipTypeId, ServiceDepartmentId)` -> `SP_Report_ItemLevelDepartmentWiseDiscountSchemeReport`

All three are filtered by passing `DBNull.Value` for null inputs.

### 5.14 Bill Detail report

`BillDetailReport(FromDate, ToDate, BillingType, ItemId, UserId, RankName, MembershipTypeId, ServiceDepartmentId)` runs `SP_Report_APF_BillDetailReport` and accepts up to 7 optional filters. The frontend (`bill-detail.component.ts`) builds the query string, omitting empty values.

### 5.15 Rank / Membership filters

Several reports accept a comma-separated list of rank names and membership type IDs:
- `RankMembershipwiseAdmittedPatientReport(fromDate, toDate, memberships, ranks)` -> `RPT_SP_ADT_RankMembershipwiseAdmittedPatientReport`
- `RankMembershipWiseDischargePatientReport(FromDate, ToDate, Membership, Rank)` -> `SP_RPT_RankMembershipwiseDischargedPatientReport`
- `BillingSchemeDetailInvoiceReport(fromDate, toDate, memberships, ranks, users)` -> `SP_Report_Bill_SchemeDetailInvoice`
- `DepartmentWiseRankCountReport(FromDate, ToDate, DepartmentIds, RankNames)` -> `SP_RPT_DepartmentWiseRankCountReport`

The SPs use string splitting (e.g. `WHERE MembershipTypeId IN (SELECT value FROM STRING_SPLIT(@Memberships, ','))`).

### 5.16 Daily MIS Report (multi-section roll-up)

`DailyMISReport(FromDate, ToDate)` runs `SP_Report_BILL_DailyMISReport` which returns **11 tables** consolidated into a single `DynamicReport.JsonData`:
1. Main report data
2. OPD data
3. Health card data
4. Lab data
5. Radiology data
6. Health clinic data
7. OT data
8. Labor data
9. IPD data
10. Other service department data
11. Pharmacy data

The frontend (`daily-mis-report.component.ts:72`) flattens this into a single printable view that the hospital director reviews each morning.

### 5.17 Custom Report (parameterized SP)

`CustomReport(FromDate, ToDate, ReportName)` is a generic shell for hospital-specific reports. The current implementation only ships one report (`Health Camp Report (100% Discount on OPD)`) - the `ReportName` parameter is forwarded to `SP_Report_BILL_CustomReport` which returns 2 tables (patient count + data). Adding a new custom report means adding a new `WHEN` branch in the SP.

### 5.18 Credit Settlement View Detail

`CreditSettlementViewDetail(FromDate, ToDate, PatientId)` runs `SP_BIL_GetSettlementDetailReportOfPatient` which returns 4 tables:
1. Patient info (single row) - mapped to `Settlement_PatientInfoVM`
2. Settlements
3. Returned settlements
4. Cash discount

The controller builds an anonymous object `{ PatientInfo, Settlements, ReturnedSettlement, CashDiscount }` and returns it.

### 5.19 Daily Sales (User Collection) report

`DailySalesReport(FromDate, ToDate, CounterId, CreatedBy, IsInsurance)` runs `SP_Report_BIL_DailySales` which returns **5 tables**:
1. Invoice/Receipt level details of Sales, Return, Deposits
2. SettlementSummary (single row) - mapped to `BilRPT_UserColln_SettlementSummaryVM`
3. Summary view of User's All collection components
4. Summary of Other Payments (e.g. Maternity for LPH)
5. Collection Segregation

The controller builds an anonymous object and reads `OtherPaymentsGiven` from the first row of table 4.

### 5.20 Excel Sum/Date/Count Formula

For every Excel export the controller:
1. Builds a list of `ColumnMetaData` with `DisplaySeq`, `ColName` (must match `DataTable` column), `ColDisplayName`, `Formula`.
2. Sorts by `DisplaySeq.OrderBy(x => x.DisplaySeq).ToList()`.
3. Optionally lists columns to remove in `List<string> RemoveColName`.
4. Calls `export.LoadFromDataTable(columns, dt, header, showSummary, addSerialNumber, removeColumns, summaryData, summaryHeader)`.
5. Returns `export.package.GetAsByteArray()` as `FileContentResult` with content type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

### 5.21 Department Revenue Report (3-level hierarchy)

`DepartmentRevenueReport(FromDate, ToDate)` returns a `DynamicReport` with a single `ReportData` table. The frontend (`department-revenue-report.component.ts`) parses `res.Results.JsonData` and reshapes it into a tree of three levels (Department > Service Department > Item) with `Level` discriminator and `ShowChild` toggle. The `ShowChild(row)` method walks forward through `displayData` to flip the visibility of immediate children.

---

## 6. API Endpoints (50+)

The Reporting module exposes **~200 JSON endpoints** plus **33 Excel endpoints** plus 1 dynamic-SQL endpoint. Below is a curated list of the most important ones, grouped by domain. All dates are `YYYY-MM-DD` unless noted. Query parameter names use PascalCase.

### 6.1 Reporting (main controller)

| # | Verb | Route | Purpose |
|---|------|-------|---------|
| 1 | GET | `/Reporting/PatientBillHistory?FromDate=&ToDate=&PatientCode=` | Full bill history for a patient (paid/unpaid/return/cancel/deposits). |
| 2 | GET | `/Reporting/TotalAdmittedPatient?FromDate=&ToDate=` | Total admitted patients in range. |
| 3 | GET | `/Reporting/AdmissionAndDischargeList?FromDate=&ToDate=&WardId=&DepartmentId=&BedFeatureId=&AdmissionStatus=&SearchText=` | Detailed admission/discharge list. |
| 4 | GET | `/Reporting/RankMembershipwiseAdmittedPatientReport?fromDate=&toDate=&memberships=&ranks=` | Admitted by rank/membership. |
| 5 | GET | `/Reporting/DischargedPatient?FromDate=&ToDate=` | Total discharged patients. |
| 6 | GET | `/Reporting/AllWardCountDetail?FromDate=&ToDate=` | Per-ward census summary. |
| 7 | GET | `/Reporting/TransferredPatient?FromDate=&ToDate=` | Ward transfer list. |
| 8 | GET | `/Reporting/RevenueGenerated?FromDate=&ToDate=` | Radiology revenue per imaging item. |
| 9 | GET | `/Reporting/DailyAppointmentReport?FromDate=&ToDate=&Doctor_Name=&AppointmentType=` | Daily appointment list. |
| 10 | GET | `/Reporting/RankwiseDailyAppointmentReport?FromDate=&ToDate=&Rank=&Membership=&AppointmentType=` | Same with rank/membership filter. |
| 11 | GET | `/Reporting/PhoneBookAppointmentReport?FromDate=&ToDate=&Doctor_Name=&AppointmentStatus=` | Phone-book appointments. |
| 12 | GET | `/Reporting/DiagnosisWisePatientReport?FromDate=&ToDate=&Diagnosis=` | Patient count per diagnosis. |
| 13 | GET | `/Reporting/DistrictWiseAppointmentReport?FromDate=&ToDate=&CountrySubDivisionName=&gender=` | Geo-wise appointment distribution. |
| 14 | GET | `/Reporting/CategoryWiseImagingReport?FromDate=&ToDate=` | Imaging count by category. |
| 15 | GET | `/Reporting/CategoryWiseLabReport?FromDate=&ToDate=&orderStatus=` | Lab test count by category. |
| 16 | GET | `/Reporting/DoctorWisePatientCountLabReport?FromDate=&ToDate=` | OP/IP/ER split per doctor. |
| 17 | GET | `/Reporting/CategoryWiseLabItemCountLabReport?FromDate=&ToDate=&orderStatus=` | Item-level lab test count. |
| 18 | GET | `/Reporting/ItemWiseLabItemCountLabReport?FromDate=&ToDate=&categoryId=&orderStatus=` | Item-level lab test count, filtered by category. |
| 19 | GET | `/Reporting/TestStatusDetailReport?FromDate=&ToDate=&orderStatus=` | Test status detail (pending/completed/etc). |
| 20 | GET | `/Reporting/PatientCensusReport?FromDate=&ToDate=&ProviderId=&DepartmentId=` | Patient census by provider/department. |
| 21 | GET | `/Reporting/DoctorwiseOutPatientReport?FromDate=&ToDate=` | OP visits per doctor. |
| 22 | GET | `/Reporting/BillDepartmentSummary?FromDate=&ToDate=` | Department revenue summary. |
| 23 | GET | `/Reporting/GeographicalStatReport?FromDate=&ToDate=&CountrySubDivisionName=&MunicipalityName=&GeoStatType=` | Geo statistics. |
| 24 | GET | `/Reporting/LoadDeptListFromFN` | Service department list. |
| 25 | GET | `/Reporting/SalesPurchaseTrainedCompanion?FromDate=&ToDate=&Status=&ItemIdCommaSeprated=` | Pharmacy sales/purchase trend. |
| 26 | GET | `/Reporting/TotalRevenueFromLab?FromDate=&ToDate=` | Lab revenue. |
| 27 | GET | `/Reporting/ItemWiseFromLab?FromDate=&ToDate=` | Lab item-wise revenue. |
| 28 | GET | `/Reporting/DoctorWisePatientReport?FromDate=&ToDate=&ProviderName=` | Doctor-wise patient report. |
| 29 | GET | `/Reporting/DepartmentWiseAppointmentReport?FromDate=&ToDate=&DepartmentId=&gender=` | Department-wise appointment. |
| 30 | GET | `/Reporting/DayAndMonthWiseVisitReport?FromDate=&ToDate=&DepartmentId=&ReportType=` | Daily/monthly visit count. |
| 31 | GET | `/Reporting/DepartmentWiseStatReport?FromDate=&ToDate=&DepartmentId=&gender=` | Department statistics. |
| 32 | GET | `/Reporting/DoctorWiseStatisticReport?FromDate=&ToDate=&EmployeeId=&gender=` | Doctor statistics. |
| 33 | GET | `/Reporting/AgeClassifiedOPStatsReport?FromDate=&ToDate=&DepartmentId=` | OP visits classified by age group. |
| 34 | GET | `/Reporting/PatientCreditBillSummary?FromDate=&ToDate=` | Patient credit summary. |
| 35 | GET | `/Reporting/DoctorReferral?FromDate=&ToDate=&ProviderName=` | Doctor referral count. |
| 36 | GET | `/Reporting/DoctorSummary?FromDate=&ToDate=&ProviderId=` | Doctor summary card. |
| 37 | GET | `/Reporting/GetDoctorList` | Dropdown: all employees with role Doctor. |
| 38 | GET | `/Reporting/GetDiagnosisList` | Dropdown: distinct diagnosis from `ADT_DischargeSummary`. |
| 39 | GET | `/Reporting/GetAppointmentTypeList` | Dropdown: distinct `AppointmentType` from `PAT_Appointment`. |
| 40 | GET | `/Reporting/GetDepartmentList` | Dropdown: all departments. |
| 41 | GET | `/Reporting/GetEmployeeList` | Dropdown: all employees. |
| 42 | GET | `/Reporting/GetServiceDeptList` | Dropdown: all service departments. |
| 43 | GET | `/Reporting/IncomeSegregation?FromDate=&ToDate=` | Income segregation for dashboard. |
| 44 | GET | `/Reporting/DailyRevenueTrend` | Daily revenue trend. |
| 45 | GET | `/Reporting/MonthlyBillingTrend` | Monthly billing trend. |
| 46 | GET | `/Reporting/BILLDsbCntrUsrCollection?fromDate=&toDate=&counterId=` | Daily counter/user collection. |
| 47 | GET | `/Reporting/BILLDsbOverallBillStatus` | Total provisional + credit + deposit balance. |
| 48 | GET | `/Reporting/HomeDashboardStats` | Home dashboard data. |
| 49 | GET | `/Reporting/HomeInvDashboardStats?SourceStoreId=` | Inventory dashboard data. |
| 50 | GET | `/Reporting/DepartmentWiseConsumerItems?SourceStoreId=` | Department-wise consumer items. |
| 51 | GET | `/Reporting/SubCategoryWiseInventoryStockValue?SourceStoreId=` | Sub-category inventory value. |
| 52 | GET | `/Reporting/MonthlyWisePurchaseOrdervsGoodsReceiptValue?SourceStoreId=` | PO vs GR trend. |
| 53 | GET | `/Reporting/PatientZoneMap` | Patient zone map (Nepal districts). |
| 54 | GET | `/Reporting/DepartmentAppointmentsTotal` | Department appointment count. |
| 55 | GET | `/Reporting/PatientGenderWise` | Gender-wise patient count. |
| 56 | GET | `/Reporting/PatientAgeRangeNGenderWise` | Age-range x gender patient count. |
| 57 | GET | `/Reporting/LabDashboard` | Lab dashboard stats. |
| 58 | GET | `/Reporting/CovidDetailsForLab?testName=` | COVID-19 test details. |
| 59 | GET | `/Reporting/ERDashboard` | ER dashboard. |
| 60 | GET | `/Reporting/DischargedPatientBillBreakup?VisitId=&PatientId=` | Patient header + bill items for discharge. |
| 61 | GET | `/Reporting/PatientRegistrationReport?FromDate=&ToDate=&Gender=&Country=` | Patient registration report. |
| 62 | GET | `/Reporting/PoliceCaseReport?FromDate=&ToDate=` | Police case patient list. |
| 63 | GET (route) | `/Reporting/OutpatientMorbidityReport/{FromDate}/{ToDate}` | Government outpatient morbidity. |
| 64 | GET | `/Reporting/TotalCovidTestsDetailReport?testName=&ResultType=&CaseType=&CountrySubDivisionId=&FromDate=&ToDate=&gender=` | COVID test detail. |
| 65 | GET | `/Reporting/CovidTestsCumulativeReport?testName=&CountrySubDivisionId=&FromDate=&ToDate=` | Cumulative COVID test count. |
| 66 | GET | `/Reporting/GetHIVTestsDetailReport?FromDate=&ToDate=` | HIV test detail. |
| 67 | GET | `/Reporting/GetCultureTestsDetailReport?FromDate=&ToDate=` | Lab culture test detail. |
| 68 | GET | `/Reporting/GetLabTypeWiseTestCountReport?testId=&orderStatus=&categoryId=&FromDate=&ToDate=` | Lab type-wise count. |
| 69 | GET | `/Reporting/EditedPatientDetailReport?userId=&FromDate=&ToDate=` | Audit: edited patient records. |
| 70 | GET | `/Reporting/FilmTypeCountReport?FromDate=&ToDate=` | Radiology film type count. |
| 71 | GET | `/Reporting/HospitalIncomeIncentiveReport?FromDate=&ToDate=&ServiceDepartments=` | Hospital income by service dept. |
| 72 | GET | `/Reporting/HospitalIncomeIncentiveReportServiceDepartmentWise?FromDate=&ToDate=&ServiceDepartmentId=` | Same, single service dept. |
| 73 | GET (route) | `/Reporting/EmergencyPatientMorbidityReport/{FromDate}/{ToDate}` | Emergency morbidity report. |
| 74 | GET | `/Reporting/InventoryDashboardStatistics?SourceStoreId=` | Inventory dashboard. |
| 75 | GET | `/Reporting/DepertmentwiseDispatchedValue?SourceStoreId=&FromDate=&ToDate=` | Department-wise dispatch. |
| 76 | GET | `/Reporting/GetSubCategoryWiseInventoryStockValue?SourceStoreId=` | Sub-category stock value. |
| 77 | GET | `/Reporting/MonthlyWiseTransaction?SourceStoreId=` | Monthly PO/GR/Dispatch. |
| 78 | GET | `/Reporting/BillingDashboardCardSummary` | Billing dashboard cards. |
| 79 | GET | `/Reporting/BillingDashboardRankWisePatientInvoiceCount?FromDate=&ToDate=` | Rank-wise invoice count. |
| 80 | GET | `/Reporting/BillingDashboardMembershipWisePatientInvoiceCount?FromDate=&ToDate=` | Membership-wise invoice count. |
| 81 | GET | `/Reporting/LabDashboardMembershipWiseTestCount?FromDate=&ToDate=` | Membership-wise test count. |
| 82 | GET | `/Reporting/LabDashboardRankWiseTestCount?FromDate=&ToDate=` | Rank-wise test count. |
| 83 | GET | `/Reporting/DepartmentWiseRankCountReport?FromDate=&ToDate=&DepartmentIds=&RankNames=` | Rank count per department. |
| 84 | GET | `/Reporting/LabDashboardTrendingTestCount?FromDate=&ToDate=` | Top trending lab tests. |
| 85 | GET | `/Reporting/LabDashboardTestDoneToday` | Tests completed today. |
| 86 | GET | `/Reporting/LabDashboardDengueTestDetails` | Dengue test detail. |
| 87 | GET | `/Reporting/LabDashboardLabReqDetails` | Lab request details. |
| 88 | GET | `/Reporting/LabDashboardNormalAbnormalDetails?labTestId=` | Normal/abnormal test count. |
| 89 | GET | `/Reporting/InpatientOutstandingReport?Operator=&Amount=` | Inpatient outstanding. |
| 90 | POST (body) | `/Reporting/DischargedPatientBillBreakup` (also accepts query string) | Patient header + bill items for discharge. |
| 91 | GET | `/Reporting/BillDepartmentSummary?FromDate=&ToDate=` | Department revenue summary. |
| 92 | GET | `/Reporting/SalesPurchaseTrainedCompanion?FromDate=&ToDate=&Status=&ItemIdCommaSeprated=` | Pharmacy sales/purchase trend. |
| 93 | GET | `/Reporting/DoctorWisePatientReport?FromDate=&ToDate=&ProviderName=` | Doctor-wise patient report. |
| 94 | GET | `/Reporting/DepartmentWiseAppointmentReport?FromDate=&ToDate=&DepartmentId=&gender=` | Department-wise appointment. |
| 95 | GET | `/Reporting/DepartmentWiseRankCountReport?FromDate=&ToDate=&DepartmentIds=&RankNames=` | Rank count per department. |
| 96 | GET | `/Reporting/PatientRegistrationReport?FromDate=&ToDate=&Gender=&Country=` | Patient registration report. |

### 6.2 BillingReports controller

| # | Verb | Route | Purpose |
|---|------|-------|---------|
| 97 | GET | `/BillingReports/BillCancelSummaryReport?FromDate=&ToDate=` | Cancelled bill summary. |
| 98 | GET | `/BillingReports/CreditSettlementReport?FromDate=&ToDate=` | Credit settlement summary. |
| 99 | GET | `/BillingReports/CreditSettlementViewDetail?FromDate=&ToDate=&PatientId=` | Single-patient credit detail. |
| 100 | GET | `/BillingReports/CustomReport?FromDate=&ToDate=&ReportName=` | Custom report (e.g. Health Camp 100% Discount). |
| 101 | GET | `/BillingReports/BilDenominationReport?FromDate=&ToDate=&UserId=` | Per-user denomination. |
| 102 | GET | `/BillingReports/BilDenominationReportAllList?FromDate=&ToDate=` | All users denomination. |
| 103 | GET | `/BillingReports/DepositBalance` | Patient deposit balance. |
| 104 | GET | `/BillingReports/DepartmentRevenueReport?FromDate=&ToDate=` | Department revenue (with sub-totals). |
| 105 | GET | `/BillingReports/DepartmentSummaryReport?FromDate=&ToDate=&billingType=` | Department summary by billing type. |
| 106 | GET | `/BillingReports/BillDeptItemSummary?FromDate=&ToDate=&SrvDeptName=` | Items inside a department. |
| 107 | GET | `/BillingReports/DoctorRevenue?FromDate=&ToDate=&PerformerName=` | Doctor revenue by category. |
| 108 | GET | `/BillingReports/DoctorReport?FromDate=&ToDate=&ProviderName=` | Doctor itemized report. |
| 109 | GET | `/BillingReports/DailySalesReport?FromDate=&ToDate=&CounterId=&CreatedBy=&IsInsurance=` | User collection report. |
| 110 | GET | `/BillingReports/DiscountReport?FromDate=&ToDate=&CounterId=&CreatedBy=` | Discount report. |
| 111 | GET | `/BillingReports/TotalItemsBill?FromDate=&ToDate=&billingType=&ServiceDepartmentName=&ItemName=` | Itemized bill items. |
| 112 | GET | `/BillingReports/SalesDaybook?FromDate=&ToDate=&IsInsurance=` | Sales day book. |
| 113 | GET | `/BillingReports/DepartmentSalesDaybook?FromDate=&ToDate=&IsInsurance=` | Department sales day book. |
| 114 | GET | `/BillingReports/PatientNeighbourhoodCardDetail?FromDate=&ToDate=` | Neighbourhood card holders. |
| 115 | GET | `/BillingReports/PackageSalesDetail?FromDate=&ToDate=` | Health package sales. |
| 116 | GET | `/BillingReports/DialysisPatientDetail?FromDate=&ToDate=` | Dialysis patient detail. |
| 117 | GET | `/BillingReports/PatientBillHistory?FromDate=&ToDate=&PatientCode=` | Duplicate of `/Reporting/PatientBillHistory`. |
| 118 | GET | `/BillingReports/IncomeSegregationStaticReport?FromDate=&ToDate=&billingType=` | Static income segregation. |
| 119 | GET | `/BillingReports/PatientCensusReport?FromDate=&ToDate=&PerformerId=&DepartmentId=` | Duplicate of `/Reporting/PatientCensusReport`. |
| 120 | GET | `/BillingReports/DoctorwiseOutPatientReport?FromDate=&ToDate=` | OP visits per doctor. |
| 121 | GET | `/BillingReports/DailyMISReport?FromDate=&ToDate=` | Daily MIS report (11 tables). |
| 122 | GET | `/BillingReports/DoctorPatientCount?FromDate=&ToDate=` | Doctor patient count. |
| 123 | GET | `/BillingReports/BillDepartmentSummary?FromDate=&ToDate=` | Department summary. |
| 124 | GET | `/BillingReports/BillDocSummary?FromDate=&ToDate=` | Doctor summary. |
| 125 | GET | `/BillingReports/BillDocDeptSummary?FromDate=&ToDate=&DoctorId=` | Doctor -> departments. |
| 126 | GET | `/BillingReports/BillDocDeptItemSummary?FromDate=&ToDate=&DoctorId=&SrvDeptName=` | Doctor -> department -> items. |
| 127 | GET | `/BillingReports/LoadDeptListFromFN` | Service department dropdown. |
| 128 | GET | `/BillingReports/DoctorwiseIncomeSummaryOPIP?FromDate=&ToDate=&PerformerId=` | OP/IP income summary. |
| 129 | GET | `/BillingReports/SalesPurchaseTrainedCompanion?FromDate=&ToDate=&Status=&ItemIdCommaSeprated=` | Pharmacy graph. |
| 130 | GET | `/BillingReports/DoctorWisePatientReport?FromDate=&ToDate=&ProviderName=` | Duplicate. |
| 131 | GET | `/BillingReports/DepartmentWiseAppointmentReport?FromDate=&ToDate=&DepartmentId=` | Duplicate. |
| 132 | GET | `/BillingReports/PatientCreditBillSummary?FromDate=&ToDate=` | Duplicate. |
| 133 | GET | `/BillingReports/DoctorSummary?FromDate=&ToDate=&ProviderId=` | Duplicate. |
| 134 | GET | `/BillingReports/GetDoctorList` | Duplicate. |
| 135 | GET | `/BillingReports/GetReferralList` | Dropdown: external + appointment-applicable employees. |
| 136 | GET | `/BillingReports/GetAppointmentTypeList` | Duplicate. |
| 137 | GET | `/BillingReports/GetDepartmentList` | Duplicate. |
| 138 | GET | `/BillingReports/GetEmployeeList` | Duplicate. |
| 139 | GET | `/BillingReports/GetServiceDeptList` | Duplicate. |
| 140 | GET | `/BillingReports/IncomeSegregation` | Duplicate. |
| 141 | GET | `/BillingReports/DailyRevenueTrend` | Duplicate. |
| 142 | GET | `/BillingReports/MonthlyBillingTrend` | Duplicate. |
| 143 | GET | `/BillingReports/BILLDsbCntrUsrCollection?fromDate=&toDate=&counterId=` | Duplicate. |
| 144 | GET | `/BillingReports/BILLDsbOverallBillStatus` | Duplicate. |
| 145 | GET | `/BillingReports/HomeDashboardStats` | Duplicate. |
| 146 | GET | `/BillingReports/PatientZoneMap` | Duplicate. |
| 147 | GET | `/BillingReports/DepartmentAppointmentsTotal` | Duplicate. |
| 148 | GET | `/BillingReports/PatientGenderWise` | Duplicate. |
| 149 | GET | `/BillingReports/PatientAgeRangeNGenderWise` | Duplicate. |
| 150 | GET | `/BillingReports/ERDashboard` | Duplicate. |
| 151 | GET | `/BillingReports/DischargedPatientBillBreakup?VisitId=&PatientId=` | Duplicate. |
| 152 | GET | `/BillingReports/ReturnBillReport?FromDate=&ToDate=` | Returned bills summary. |
| 153 | GET | `/BillingReports/ReturnBillReportViewDetail?BillReturnId=` | Single return detail. |
| 154 | GET | `/BillingReports/Bill_ReferralSummary?FromDate=&ToDate=&isExternal=` | Referral summary. |
| 155 | GET | `/BillingReports/Bill_ReferralItemSummary?FromDate=&ToDate=&ReferrerId=` | Referral item drill-down. |
| 156 | GET | `/BillingReports/INCTV_DocterSummary?FromDate=&ToDate=&IsRefferalOnly=` | Incentive doctor summary. |
| 157 | GET | `/BillingReports/INCTV_DocterItemSummary?FromDate=&ToDate=&employeeId=&IsRefferalOnly=` | Incentive items. |
| 158 | GET | `/BillingReports/INCTV_Doc_ItemGroupSummary?FromDate=&ToDate=&employeeId=&IsRefferalOnly=` | Group-level summary. |
| 159 | GET | `/BillingReports/BIL_TXN_GetHandoverCalculationDateWise?FromDate=&ToDate=` | Handover calculation. |
| 160 | GET | `/BillingReports/INCTV_DocterPaymentSummary?FromDate=&ToDate=` | Incentive payment summary. |
| 161 | GET | `/BillingReports/RPT_Bil_ItemSummaryReport?FromDate=&ToDate=` | Item summary. |
| 162 | GET | `/BillingReports/EHSBillReport?FromDate=&ToDate=&billingType=&ServiceDepartmentName=&ItemName=&PerformerId=&PrescriberId=&UserId=` | EHS bill report. |
| 163 | GET | `/BillingReports/Billing_DepositTransationsReport?FromDate=&ToDate=&patSearchText=&employeeId=` | Deposit transactions. |
| 164 | GET | `/BillingReports/Billing_SchemeWiseDiscountReport?FromDate=&ToDate=&SchemeId=` | Scheme discount. |
| 165 | GET | `/BillingReports/Billing_DepartmentWiseDiscountSchemeReport?FromDate=&ToDate=&MembershipTypeId=&ServiceDepartmentId=&PaymentMode=` | Department/scheme discount. |
| 166 | GET | `/BillingReports/Billing_ItemLevelDepartmentWiseDiscountSchemeReport?BillingTransactionId=&MembershipTypeId=&ServiceDepartmentId=` | Item-level discount drill-down. |
| 167 | GET | `/BillingReports/GetAllDepartmentList` | Service department names. |
| 168 | GET | `/BillingReports/UserWiseCashCollectionReport?FromDate=&ToDate=&UserId=` | User-wise cash collection. |
| 169 | GET | `/BillingReports/PaymentModeWiseReport?FromDate=&ToDate=&PaymentMode=&Type=&User=` | Digital payment report. |
| 170 | GET | `/BillingReports/BillDetailReport?FromDate=&ToDate=&BillingType=&ItemId=&UserId=&RankName=&MembershipTypeId=&ServiceDepartmentId=` | Granular bill detail. |
| 171 | GET | `/BillingReports/BillingSchemeDetailInvoiceReport?fromDate=&toDate=&memberships=&ranks=&users=` | Scheme invoice detail. |
| 172 | GET | `/BillingReports/RankMembershipWiseDischargePatientReport?FromDate=&ToDate=&Membership=&Rank=` | Discharge by rank/membership. |

### 6.3 Government Reporting controller

| # | Verb | Route | Purpose |
|---|------|-------|---------|
| 173 | GET | `/GovernmentReporting/GetSummaryReport?FromDate=&ToDate=` | 9 government summary tables. |
| 174 | GET | `/GovernmentReporting/GetLaboratoryServices?FromDate=&ToDate=` | Per-test counts mapped to government items. |
| 175 | GET | `/GovernmentReporting/GetInpatientOutcome?FromDate=&ToDate=` | Inpatient outcome. |
| 176 | GET | `/GovernmentReporting/GetInpatientMorbidityReportData?FromDate=&ToDate=` | Inpatient morbidity. |
| 177 | GET | `/GovernmentReporting/GetHospitalMortalityReportData?FromDate=&ToDate=` | Hospital mortality. |

### 6.4 Dynamic Reporting controller

| # | Verb | Route | Purpose |
|---|------|-------|---------|
| 178 | POST | `/DynamicReporting/GetReportData` (body: `{ Query: "SELECT ..." }`) | Run a read-only SELECT and return rows as `List<Dictionary<string, object>>`. |

### 6.5 Excel exports (33 endpoints, all under `/ReportingNew/ExportToExcel...`)

| # | Route | File produced |
|---|-------|---------------|
| 179 | `ExportToExcelDoctorRevenue` | `DoctorRevenue.xlsx` |
| 180 | `ExportToExcelDoctorReferral` | `DoctorReferral.xlsx` |
| 181 | `ExportToExcelTotalItemsBill` | `TotalItemsBill.xlsx` |
| 182 | `ExportToExcelSalesDayBook` | `SalesDayBook.xlsx` |
| 183 | `ExportToExcelDoctorwiseIncomeSummary` | `DoctorwiseIncomeSummary.xlsx` |
| 184 | `ExportToExcelDailyMISReport` | `DailyMISReport.xlsx` |
| 185 | `ExportToExcelDailySales` | `DailySales.xlsx` |
| 186 | `ExportToExcelDiscountReport` | `DiscountReport.xlsx` |
| 187 | `ExportToExcelDepositBalance` | `DepositBalance.xlsx` |
| 188 | `ExportToExcelCreditSummary` | `CreditSummary.xlsx` |
| 189 | `ExportToExcelReturnBills` | `ReturnBills.xlsx` |
| 190 | `ExportToExcelIncomeSegregation` | `IncomeSegragation.xlsx` |
| 191 | `ExportToExcelDocSummary` | `DoctorSummary.xlsx` |
| 192 | `ExportToExcelBilDeptSummary` | `DepartmentSummary.xlsx` |
| 193 | `ExportToExcelBilDocDeptItemSummary` | `DoctorDepartmentItems.xlsx` |
| 194 | `ExportToExcelRefSummary` | `ReferralSummary.xlsx` |
| 195 | `ExportToExcelBilRefItemSummary` | `ReferralItemsSummary.xlsx` |
| 196 | `ExportToExcelBilDocDeptSummary` | `DoctorDepartmentSummary.xlsx` |
| 197 | `ExportToExcelBilDeptItemSummary` | `DepartmentItemSummary.xlsx` |
| 198 | `ExportToExcelCustomReport` | `CustomReport.xlsx` |
| 199 | `ExportToExcelPatientCensus` | `PatientCensus.xlsx` |
| 200 | `ExportToExcelDoctorReport` | `DoctorReport.xlsx` |
| 201 | `ExportToExcelPackageSalesReport` | `PackageSalesReport.xlsx` |
| 202 | `ExportToExcelCancelBills` | `CancelBills.xlsx` |
| 203 | `ExportToExcelDailyAppointment` | `DailyAppointmentReport.xlsx` |
| 204 | `ExportToExcelPhoneBookAppointment` | `PhoneBookAppointmentReport.xlsx` |
| 205 | `ExportToExcelDiagnosisWisePatientReport` | `DiagnosisWisePatientReport.xlsx` |
| 206 | `ExportToExcelDepartmentSales` | `DepartmentSalesReport.xlsx` |
| 207 | `ExportToExcelTransferToAccount` | `TransferToAccount.xlsx` |
| 208 | `ExportToExcelCategoryWiseLabReport` | `CategoryWiseLabTest.xlsx` |
| 209 | `ExportToExcelDoctorWisePatientCountLabReport` | `DoctorWiseLabTest.xlsx` |
| 210 | `ExportToExcel_INCTV_AllEmpItemsSettings` | `INCTV_AllEmpItemsSettings.xlsx` |
| 211 | `ExportToExcelSubstoreDispConSummaryReport` | `SubstoreDispatchandConsumption.xlsx` |

### 6.6 Razor view endpoints (server-rendered MVC)

| # | Verb | Route | Purpose |
|---|------|-------|---------|
| 212 | GET | `/Reporting/ReportingMain` | Main reports shell. |
| 213 | GET | `/Reporting/AdmissionMain` | ADT reports shell. |
| 214 | GET | `/Reporting/BillingMain` | Billing reports shell. |
| 215 | GET | `/Reporting/AppointmentMain` | Appointment reports shell. |
| 216 | GET | `/Reporting/RadiologyMain` | Radiology reports shell. |
| 217 | GET | `/Reporting/LabMain` | Lab reports shell. |
| 218 | GET | `/Reporting/DoctorsMain` | Doctor reports shell. |
| 219 | GET | `/Reporting/PatientBillHistoryView` | Single page. |
| 220 | GET | `/Reporting/TotalAdmittedPatientView` | Single page. |
| 221 | GET | `/Reporting/DischargedPatientView` | Single page. |
| 222 | GET | `/Reporting/TransferredPatientView` | Single page. |
| 223 | GET | `/Reporting/RevenueGeneratedView` | Single page. |
| 224 | GET | `/Reporting/DailyAppointmentReportView` | Single page. |
| 225 | GET | `/Reporting/PhoneBookAppointmentReportView` | Single page. |
| 226 | GET | `/Reporting/DIagnosisWisePatientReportView` | Single page. |
| 227 | GET | `/Reporting/DistrictWiseAppointmentReportView` | Single page. |
| 228 | GET | `/Reporting/CategoryWiseImagingReportView` | Single page. |
| 229 | GET | `/Reporting/CategoryWiseLabReportView` | Single page. |
| 230 | GET | `/Reporting/DoctorWiseLabReportView` | Single page. |
| 231 | GET | `/Reporting/PatientCensusReportView` | Single page. |
| 232 | GET | `/Reporting/DoctorOutPatientReportView` | Single page. |
| 233 | GET | `/Reporting/DepartmentSummaryView` | Single page. |
| 234 | GET | `/Reporting/TotalRevenueFromLabView` | Single page. |
| 235 | GET | `/Reporting/ItemWiseFromLabView` | Single page. |
| 236 | GET | `/Reporting/DoctorWisePatientReportView` | Single page. |
| 237 | GET | `/Reporting/DepartmentWiseAppointmentReportView` | Single page. |
| 238 | GET | `/Reporting/PatientCreditSummary` | Single page. |

### 6.7 Quick summary

- **Total endpoints**: 238 (178 main + 33 Excel + 27 view).
- **JSON GETs**: 177.
- **JSON POSTs**: 1 (dynamic SQL).
- **Excel GETs**: 33.
- **Razor view GETs**: 27.
- **Dashboards** (within Reporting): 27 (Home/Billing/Lab/ER/Inventory/Pharmacy).

---

## 7. Cross-Module (every module reports)

The Reporting module is the cross-cutting layer. It pulls data from and produces reports for:

### 7.1 Patient
- `PAT_Patient` master (registration report, edited patient report, gender/age distribution).
- `PAT_Appointment` (daily appointment, phone book, district-wise, department-wise).
- `PAT_PhoneBookAppointment`.

### 7.2 ADT / Admission / Discharge
- `ADT_Admission`, `ADT_DischargeSummary`, `ADT_PatientBedInfo` (admission/discharge/transfer, outstanding, census, diagnosis-wise).
- Ward/bed lookup (`ADT_Ward`, `ADT_Bed`).
- Inpatient census, discharge bill breakup, rank/membership admission & discharge lists.

### 7.3 Appointment
- `PAT_Appointment` (daily, rank-wise, district-wise, department-wise, age-classified, geographical).
- Phone-book appointment report (different from regular appointment - status-based).
- Day and month-wise visit count.

### 7.4 Billing / Invoice / Settlement
- `BIL_TXN_BillingTransaction` and items (doctor revenue, item summary, sales day book, patient bill history, bill detail, EHS report, item-level discount).
- `BIL_TXN_Settlement` (credit settlement detail, credit settlement view).
- `BIL_TXN_Return` (return bills, cancel bills, credit notes).
- `BIL_TXN_Deposit` (deposit balance, deposit transactions, handover calculation).
- Custom report (e.g. Health Camp 100% Discount scheme).
- Patient credit summary, doctor income summary (OP/IP), user collection, payment mode wise report.

### 7.5 Lab
- `LAB_TestRequisition` and items (category-wise, item-wise, doctor-wise patient count, status-wise, culture, HIV, dengue).
- `LAB_GovReportItems` (government lab services mapping).
- `LAB_Requisition` (cumulative COVID, daily COVID, abnormal/normal details).
- Lab dashboard (membership, rank, trending, today's done, dengue detail, lab request detail).

### 7.6 Radiology
- `RAD_PatientImaging` (revenue generated, category-wise imaging, film type count).
- Radiology report main page.

### 7.7 Doctors
- `EMP_Employee` and `MST_Department` (doctor summary, doctor-wise encounter, edited patient detail).

### 7.8 Inventory
- `INV_TXN_Stock`, `INV_MST_Item` (sub-category stock value, monthly PO vs GR, dispatch vs consumption, inventory dashboard).
- `SP_INV_RPT_GetSubstoreDispConsumption_Summary` for substore report.

### 7.9 Pharmacy
- `PHRM_StockTransaction` and items (sales/purchase graph, top trending items).
- `SP_DSB_Pharmacy_SalesPurchaseGraph_DashboardStatistics` consumed by `SalesPurchaseTrainedCompanion`.

### 7.10 Incentive
- `INCTV_EmployeeItemsMapping` and related (doctor summary, item summary, item group summary, payment summary, hospital income incentive).
- `SP_Inctv_ExportAllEmpItemsSettings` for the bulk export.

### 7.11 Accounting
- `TXN_Voucher`, `ACC_TransactionItems` (transfer to account Excel export).
- `AccountingDbContext` consumed by `ExportToExcelTransferToAccount` (line 1304).

### 7.12 Emergency / Maternity
- `Emergency_DashboardStatistics` returns visits by triage / chief complaint.
- Maternity allowance is included in `PaymentModeWiseReport` and `DailySalesReport` `OtherPaymentsGiven` field.

### 7.13 Government / MOH
- `LAB_GovReportItems` and ICD-10 mapping tables.
- Outpatient and emergency morbidity reports (read from `MedicalRecordsDbContext`).
- Inpatient outcome, mortality, morbidity.
- Government summary (9 tables).

### 7.14 Master / Lookup
- `MST_Department`, `MST_ServiceDepartment`, `EMP_Employee`, `MST_Membership`, `MST_Rank`, `MST_CountrySubDivision` - used for filters and dropdowns.

### 7.15 Audit
- `Audit_AuditTrail` and `Audit_SqlAudit` - the `AuditTrails` and `SqlAuditDetails` endpoints.

---

## 8. Business Rules

### 8.1 Date bound validation
Almost every report validates `FromDate` and `ToDate` against `System.Data.SqlTypes.SqlDateTime.MinValue` and `MaxValue` before calling the SP. The pattern is:
```csharp
if (FromDate < (DateTime)System.Data.SqlTypes.SqlDateTime.MinValue && ToDate < (DateTime)System.Data.SqlTypes.SqlDateTime.MinValue)
{
    FromDate = System.DateTime.Today;
    ToDate = DateTime.Now;
}
else if (FromDate > (DateTime)System.Data.SqlTypes.SqlDateTime.MinValue && ToDate > (DateTime)System.Data.SqlTypes.SqlDateTime.MaxValue)
{
    ToDate = DateTime.Now;
}
```
This appears in: `BilDenominationReport`, `DoctorRevenue`, `DoctorReport`, `DoctorSummary`, `ExportToExcelDoctorRevenue`, `ExportToExcelDoctorReferral`.

### 8.2 Response envelope
All endpoints return:
```csharp
class DanpheHTTPResponse<T> {
    public string Status;       // "OK" | "Failed"
    public string ErrorMessage; // populated on failure
    public T Results;           // typed payload
}
```
`DynamicReport` is the most common payload type (~30 endpoints). The frontend reads `res.Results.JsonData`, parses it, and feeds to `danphe-grid`. When the SP returns multiple tables, the controller builds an anonymous object (`{ ReportData, Summary }`) and serializes that to `JsonData`.

### 8.3 Multi-result-set pattern
Stored procedures can return multiple `SELECT` statements; `DALFunctions.GetDatasetFromStoredProc` materializes each as a separate `DataTable`. Examples:
- `SP_Report_BIL_DailySales` -> 5 tables (user collection details, settlement summary, user collection summary, other payments, collection segregation).
- `SP_Report_BIL_DepartmentSummary` -> 2 tables (report data, summary).
- `SP_Report_BILL_CustomReport` -> 2 tables (patient count, data).
- `SP_Report_BILL_PatientCensus` -> 2 tables (report data, summary).
- `SP_BIL_GetSettlementDetailReportOfPatient` -> 4 tables (patient info, settlements, returned settlements, cash discount).
- `SP_BIL_Dashboard_CardSummary` -> 3 tables (patient report, income report, bill return report).
- `SP_Report_BILL_DailyMISReport` -> 11 tables (report data, OPD, health card, lab, radiology, health clinic, OT, labor, IPD, other service dept, pharmacy).
- `SP_Report_Gov_Summary` -> 9 tables.
- `SP_Report_Radiology_CategoryWiseImagingReport` -> 2 tables.

### 8.4 Excel export rules
1. `ColumnMetaData.ColName` must match a `DataTable` column name exactly (case-sensitive, since EPPlus uses the name as a key).
2. `ColumnFormulas.Sum` triggers `SUM` Excel formula on the column; `Date` formats the cell as a date; `Count` uses `COUNT`.
3. Columns listed in `removeColumns` are dropped from the `DataTable` before writing.
4. `showSummary` adds a totals row at the bottom; if `summaryData` is provided, it overrides the auto-computed summary.
5. The output content type is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX).
6. Many exports set the `ToDate = DateTime.Now` if the input is in `SqlDateTime.MinValue`.

### 8.5 Dynamic SQL guardrails
- Allowed: SELECT, WITH, JOIN, ORDER BY, GROUP BY, HAVING, WHERE, TOP, FETCH, OFFSET, FOR, UNION, EXCEPT, INTERSECT.
- Blocked (whole word, case-insensitive): `create, drop, update, insert, alter, delete, attach, detach, grant, truncate, revoke`.
- Block list also includes words that look like "drop" anywhere - the regex `@"(^|\s)" + keyword + "(^|\\s)"` requires whitespace boundaries. Words like `recreate`, `updatedAt`, `insertedBy` would NOT match (the boundary is whitespace, not word). However, the keyword "drop" inside `lastdrop` would also slip through. The check is best-effort defense in depth, not a security boundary.

### 8.6 Permission / view filter names
Each report view has a permission name in the form `reports-<area>-<subarea>-view`. Examples:
- `reports-view`
- `reports-admissionmain-view`
- `reports-billingmain-view`
- `reports-appointmentmain-view`
- `reports-radiologymain-view`
- `reports-labmain-view`
- `reports-doctorsmain-view`
- `reports-billingmain-patientbillhistory-view`
- `reports-billingmain-totaladmittedpatient-view`
- `reports-billingmain-dischargedpatient-view`
- `reports-admissionmain-transferredpatient-view`
- `reports-radiologymain-revenuegenerated-view`
- `reports-appointmentmain-dailyappointmentreport-view`
- `reports-appointmentmain-phonebookappointmentreport-view`
- `reports-admissionmain-diagnosiswisepatientreport-view`
- `reports-appointmentmain-districtwiseappointmentreport-view`
- `reports-radiologymain-categorywiseimagingreport-view`
- `reports-labmain-categorywiselabreport-view`
- `reports-billingmain-patientcensusreport-view`
- `reports-billingmain-departmentsummaryreport-view`
- `reports-labmain-totalrevenuefromlab-view`
- `reports-lab-itemwiselabreport-view`
- `reports-doctorsmain-doctorwiseencounterpatientreport-view`
- `reports-appointmentmain-departmentwiseappointmentreport-view`
- `reports-billingmain-patientcreditsummary-view`

`[DanpheViewFilter("...")]` is the action filter that verifies the current user has that permission. `GovernmentReportingController` and `DynamicReportingController` do not enforce view-level permissions.

### 8.7 Doctor list filter
- `GetDoctorList` (both controllers) filters `EMP_Employee` joined with `EmployeeRole` where `EmployeeRoleName == "Doctor"`.
- `GetReferralList` (BillingReports) returns `IsActive == true AND (IsExternal == true OR (IsAppointmentApplicable == true))`.

### 8.8 Rank / membership parsing
Comma-separated rank names and membership type IDs are passed as `string` (not `int[]`). The stored procedures handle the splitting (typically `STRING_SPLIT` with the comma delimiter). The frontend builds the string in the component (see `rank-wise-appointment/rank-wise-daily-appointment-report.component.ts:160`).

### 8.9 Excel formula column rules
- Numeric columns use `ColumnFormulas.Sum` to add a SUM at the bottom of the column.
- Date columns use `ColumnFormulas.Date` to format the cell.
- Text columns have no formula (passthrough).
- `LoadFromDataTable` automatically adds a serial number column when `addSerialNumber: true` is passed (the default for most exports).

### 8.10 Insurance flag
Many billing reports accept an `IsInsurance` boolean that filters the underlying data. The flag is threaded into the SP call: `SP_Report_BILL_SalesDaybook`, `SP_Report_BILL_DepartmentSalesDaybook`, `SP_Report_BIL_DailySales`. Insurance bills are kept in a separate logical bucket for reporting.

### 8.11 Billing type filter
Most billing reports accept a `billingType` string. Common values are `cash`, `credit`, `insurance`, `all`. The SPs typically use `WHERE (@billingType = 'all' OR BillingType = @billingType)`.

### 8.12 Lookup helpers shared between controllers
Many `Get*List` endpoints are duplicated between `ReportingController` and `BillingReportsController`. The frontend usually calls the one in `BillingReports`. The two implementations are functionally identical (both use `MasterDbContext`).

### 8.13 Settlement summary helper
`BilRPT_UserColln_SettlementSummaryVM.MapDataTableToSingleObject` and the pharmacy equivalent are the only places where the codebase round-trips a `DataTable` through JSON to extract a single row. This is a workaround for SPs that return a single-row summary table alongside the main result.

### 8.14 Audit log table
`AuditTrails(FromDate, ToDate, TableName, UserName, ActionName)` runs `SP_Danphe_Audit` and is used by the audit module. The same endpoint also returns `AuditTrailList()` (calls `SP_Danphe_Audit_List`) and `SqlAuditDetails(FromDate, ToDate, LogType)` (`SP_Danphe_SQLAudit`).

### 8.15 IRD (Inland Revenue Department) data
`InvoiceDetails`, `GetAllInvoiceDetails`, and `PhrmInvoiceDetails` exist in `ReportingDbContext` (lines 1300-1330) for IRD compliance. They return `List<InvoiceDetailsModel>` and `List<PhrmInvoiceDetails>` via `Database.SqlQuery<>` (raw SQL). These endpoints are not exposed in the controllers in this snapshot - they are reachable through internal admin tooling.

### 8.16 Government item mapping
Government lab items use a 3-level hierarchy: `GroupName` (category) > `InnerTestGroupName` (sub-group, when `HasInnerItems == true`) > `TestName`. `GetLaboratoryServices` walks this hierarchy when building the response dictionary.

### 8.17 Patient census 3-level grouping
`PatientCensusReport` returns a flat table; the frontend (`patient-census-report.component.ts`) reshapes it into 3 levels: Doctor > Service Department > Item, with totals at each level. The `ShowChild(row)` and `DetailView(level)` methods on the component toggle row visibility in the tree grid.

### 8.18 Date format in JSON
`DynamicReport` instances with multiple date columns use `IsoDateTimeConverter { DateTimeFormat = "yyyy-MM-dd" }` so dates are serialized as `2024-01-15` rather than the default ISO 8601 with time component. This keeps the dynamic grid consistent with HTML date inputs.

### 8.19 Empty result handling
All endpoints handle the case where the SP returns zero rows. `PatientCensusReport` returns an empty `DynamicReport` if `DataSet.Tables.Count <= 1`; `IncomeSegregation` returns `JsonData = ""` if the first table is empty. The frontend shows a "Data not found" message via `MessageboxService`.

### 8.20 ItemName special character handling
`TotalItemsBill` accepts `ItemName` with `+` characters converted to `^` for transport (because `+` is interpreted as a space in URL encoding). The server replaces `^` back to `+` before calling the SP:
```csharp
var originalItemName = ItemName != null ? ItemName.Replace('^', '+') : "";
```

### 8.21 Performance notes
- Stored procedure heavy - the `ReportingDbContext` has 124 SP calls and EF `Database.SqlQuery` for 4 others.
- `PatientBillHistory` uses manual `DataReader` walking (the `do { ... } while (!reader.IsClosed)` pattern) instead of `GetDatasetFromStoredProc` because the SP returns 5 tables and the controller needs to map them to typed lists.
- Excel exports build the entire `ExcelPackage` in memory before returning `FileContentResult`. Reports with 10k+ rows can spike memory. There is no streaming or chunked export.
- The dynamic SQL endpoint materializes the entire `DataTable` in memory before deserializing to `List<Dictionary<string, object>>`. Large queries can be slow.

### 8.22 Why two controllers?
`ReportingController` and `BillingReportsController` carry largely overlapping endpoints. The split appears to be historical: `ReportingController` was the original, and `BillingReportsController` was extracted for billing-specific reports. Both are decorated with `[DanpheDataFilter()]` and use the same `ReportingDbContext`. There is no functional reason to choose one over the other for a new report; the convention is "billing-related goes to `BillingReports`".

### 8.23 Why the `[DanpheViewFilter]` gap on certain reports?
Several reports (e.g. `OutpatientMorbidityReport`, `EmergencyPatientMorbidityReport`, `DynamicReportingController.GetReportData`) intentionally do not require a view-level permission. They are intended for system admins or MOH reporting officers who always have access. The dynamic SQL endpoint relies solely on the keyword blocklist for access control.

### 8.24 Why some endpoints are duplicated
The same endpoint URL exists in both `ReportingController` and `BillingReportsController` for many reports (e.g. `GetDoctorList`, `DailySalesReport`, `ERDashboard`). This is not a bug - both return the same data because both use `ReportingDbContext`. The frontend typically uses the `BillingReports` URL for billing reports and `Reporting` for everything else.

---

## Appendix A: Stored Procedures Catalog (124+ referenced)

| SP | Endpoint | Notes |
|----|----------|-------|
| `SP_Report_BIL_DoctorReport` | `DoctorReport` | |
| `SP_Report_BIL_DoctorRevenue` | `DoctorRevenue` | |
| `SP_Report_Bill_BillDenomination` | `BilDenomination` | |
| `SP_Report_Bill_BillDenominationAllList` | `BilDenominationAllList` | |
| `SP_Report_DOC_DoctorSummary` | `DoctorSummary` | |
| `SP_Report_Deposit_Balance` | `DepositBalanceReport` | |
| `SP_Report_BIL_DailySales` | `DailySalesReport`, `DailySales` (Excel) | 5 result sets |
| `SP_Report_Discount` | `DiscountReport` | |
| `SP_Report_SchemeWiseDiscountReport` | `Billing_SchemeWiseDiscountReport` | |
| `SP_Report_DepartmentWiseDiscountSchemeReport` | `Billing_DepartmentWiseDiscountSchemeReport` | |
| `SP_Report_ItemLevelDepartmentWiseDiscountSchemeReport` | `Billing_ItemLevelDepartmentWiseDiscountSchemeReport` | |
| `SP_Report_BILL_DailyMISReport` | `DailyMISReport`, Excel export | 11 result sets |
| `SP_Report_BIL_DailyMISDrPatientCount` | `DoctorPatientCount` | |
| `SP_Report_BIL_DoctorSummary` | `BillDocSummary`, Excel export | |
| `SP_Report_BIL_DoctorDeptSummary` | `BillDocDeptSummary`, Excel export | |
| `SP_Report_BIL_DoctorDeptItemsSummary` | `BillDocDeptItemSummary`, Excel export | |
| `SP_Report_BIL_DepartmentSummary` | `BillDepartmentSummary`, Excel export | 2 result sets |
| `SP_Report_BIL_DepartmentRevenue` | `DepartmentRevenueReport` | |
| `SP_Report_BIL_DepartmentItemSummary` | `BillDeptItemSummary`, Excel export | |
| `SP_BILL_GetServiceDepartmentsName` | `LoadServDeptsNameFromFN` | |
| `SP_Report_BILL_CustomReport` | `CustomReport`, Excel export | 2 result sets |
| `SP_Report_Appointment_DoctorWiseOutPatientReport` | `DoctorWisePatientReport` | |
| `SP_Report_BILL_DoctorWiseIncomeSummary_OPIP` | `DoctorwiseIncomeSummaryOPIP`, Excel export | |
| `SP_Report_BILL_TotalItemsBill` | `TotalItemsBill`, Excel export | |
| `SP_RPT_Bil_EHSBillingReport` | `EHSBillReport` | |
| `SP_Report_BILL_SalesDaybook` | `SalesDaybook`, Excel export | |
| `SP_Report_BILL_PatientCensus` | `PatientCensusReport`, Excel export | 2 result sets |
| `SP_Report_BILL_DepartmentSalesDaybook` | `DepartmentSalesDaybook`, Excel export | |
| `SP_Report_BIL_PAT_NeighbourhoodCardDetail` | `PatientNeighbourhoodCardDetail` | |
| `SP_Report_BIL_PAT_PackageSalesDetail` | `PackageSalesDetail`, Excel export | |
| `SP_Report_BIL_DialysisPatientDetail` | `DialysisPatientDetail` | |
| `SP_Report_BILL_PatientBillHistory` | `PatientBillHistory` | 5 result sets |
| `SP_Report_Appointment_DailyAppointmentReport` | `DailyAppointmentReport`, Excel export | |
| `SP_Report_Appointment_RankwiseDailyAppointmentReport` | `RankwiseDailyAppointmentReport`, Excel export | |
| `SP_Report_Appointment_PhoneBookAppointmentReport` | `PhoneBookAppointmentReport`, Excel export | |
| `SP_Report_ADT_DiagnosisWiseReport` | `DiagnosisWisePatientReport`, Excel export | |
| `SP_Report_BIL_IncomeSegregation` | `Get_Bill_IncomeSegregationStaticReport`, Excel export | |
| `SP_DSB_Pharmacy_SalesPurchaseGraph_DashboardStatistics` | `SalesPurchaseTrainedCompanion` | 2 result sets |
| `SP_Report_ADT_TotalAdmittedPatient` | `TotalAdmittedPatient` | |
| `SP_Report_ADT_AdmissionAndDischargeReport` | `AdmissionAndDischargeList` | |
| `RPT_SP_ADT_RankMembershipwiseAdmittedPatientReport` | `RankMembershipwiseAdmittedPatientReport` | |
| `SP_Report_ADT_DischargedPatient` | `DischargedPatient` | |
| `sp_Report_TransferredPatient` | `TransferredPatient` | |
| `SP_Report_Radiology_RevenueGenerated` | `RevenueGenerated` | |
| `SP_Report_Radiology_CategoryWiseImagingReport` | `CategoryWiseImagingReport` | 2 result sets |
| `SP_Report_Lab_CategoryWiseLabReport` | `CategoryWiseLabReport`, Excel export | |
| `SP_Report_Lab_DoctorWisePatientCountLabReport` | `DoctorWisePatientCountLabReport`, Excel export | |
| `SP_LAB_CategoryWiseLabTestTotalCount` | `CategoryWiseLabItemCountLabReport` | |
| `SP_LAB_TestWiseTotalCount` | `ItemWiseLabItemCountLabReport` | |
| `SP_LAB_Statuswise_Test_Detail` | `TestStatusDetailReport` | |
| `SP_Report_Scheduling_DoctorWisePatientReport` | `DoctorWisePatientReport` | 2 result sets |
| `SP_Report_Appointment_DepartmentWiseAppointmentReport` | `DepartmentWiseAppointmentReport` | 2 result sets |
| `SP_Report_BIL_PatientCreditSummary` | `BIL_PatientCreditSummary`, Excel export | |
| `SP_Report_BILL_BillCancelReport` | `BIL_BillCancelSummary`, Excel export | |
| `SP_BIL_GetSettlementSummaryReport` | `BIL_CreditSettlementReport` | |
| `SP_BIL_GetSettlementDetailReportOfPatient` | `CreditSettlementViewDetail` | 4 result sets |
| `SP_Report_BILL_Invoice_Return` | `BIL_ReturnReport`, Excel export | |
| `SP_Report_BILL_Invoice_Return_Detail` | `BIL_ReturnReportDetail` | |
| `SP_Report_BIL_DoctorReferrals` | `DoctorReferral`, Excel export | |
| `SP_Report_TotalRevenueFromLab` | `TotalRevenueFromLab` | |
| `SP_Report_ItemwiseFromLab` | `ItemWiseFromLab` | |
| `SP_Report_BIL_IncomeSegregation` | `BIL_Daily_IncomeSegregation` | |
| `SP_Report_BILDSB_DailyRevenueTrend` | `BIL_Daily_RevenueTrend` | |
| `SP_Report_BILDSB_MonthlyBillingTrend` | `BIL_Monthly_BillingTrend` | |
| `SP_Report_BILL_CounterNUsersCollectionDaily` | `BIL_Daily_CounterNUsersCollection` | 2 result sets |
| `SP_DSB_Home_DashboardStatistics` | `Home_DashboardStatistics` | |
| `SP_DBS_Home_InvDashboardStats` | `Home_DashinvboardStatistics` | |
| `SP_DSB_Home_DeptWiseConsumerItems` | `Home_Dashboard_DepartmentWiseConsumerItems` | |
| `SP_DSB_Home_SubCategoryWiseInventoryStockValue` | `Home_Dashboard_SubCategoryWiseInventoryStockValue` | |
| `SP_DSB_Home_MonthlyWisePurchaseOrdervsGoodsReceiptValue` | `Home_Dashboard_MonthlyWisePurchaseOrdervsGoodsReceiptValue` | |
| `SP_DSB_Home_PatientDistributionMap_Nepal` | `Home_PatientZoneMap` | |
| `SP_DSB_Home_DeptWiseAppointmentCount` | `Home_DeptWise_TotalAppointmentCount` | |
| `SP_DSB_Patient_GenderWiseCount` | `Patient_GenderWiseCount` | |
| `SP_DSB_Patient_AgeRangeNGender` | `Patient_AgeRangeNGenderWiseCount` | |
| `SP_DSB_Lab_DashboardStatistics` | `Lab_DashboardStatistics` | |
| `SP_DSB_Emergency_DashboardStatistics` | `Emergency_DashboardStatistics` | |
| `SP_IRD_InvoiceDetails` | `InvoiceDetails` | IRD compliance |
| `SP_All_IRD_InvoiceDetails` | `GetAllInvoiceDetails` | IRD compliance |
| `SP_IRD_PHRM_InvoiceDetails` | `PhrmInvoiceDetails` | IRD compliance |
| `SP_Danphe_SQLAudit` | `SqlAuditDetails` | |
| `SP_Report_BIL_DischargeBreakup` | `BillDischargeBreakup` | |
| `SP_Danphe_Audit_List` | `AuditTrailList` | |
| `SP_Danphe_Audit` | `AuditTrails` | |
| `SP_Report_BIL_ReferralSummary` | `Bill_ReferralSummary`, Excel export | 2 result sets |
| `SP_Report_BIL_ReferralItemsSummary` | `Bill_ReferralItemSumamry`, Excel export | 2 result sets |
| `SP_Report_INCTV_DoctorSummary` | `INCTV_DoctorSummary` | |
| `SP_Report_INCTV_ReferralItemsSummary` | `INCTV_SummaryItemReport` | 2 result sets |
| `SP_Report_INCTV_Doc_ItemGroupSummary` | `INCTV_Doc_ItemGroupSummary` | 2 result sets |
| `SP_Report_Patient_RegistrationReport` | `PatientRegistrationReport` | |
| `SP_BIL_TXN_GetHandoverCalculationDateWise` | `GetHandoverCalculationDateWise` | 2 result sets |
| `SP_Report_INCTV_DoctorPayment` | `INCTV_DoctorPaymentSummary` | |
| `SP_Report_ItemSummaryReport` | `RPT_Bil_ItemSummaryReport` | 2 result sets |
| `SP_Report_PoliceCasePatient` | `PoliceCaseReport` | |
| `SP_LAB_GetCovidTestDetails` | `CovidDetailsForLab` | |
| `SP_REPORT_LAB_TotalDailyCovidTestDetails` | `TotalCovidTestsDetailReport` | |
| `SP_Report_Lab_CovidTestsSummary` | `CovidTestsCumulativeReport` | |
| `SP_Report_LAB_GetHIVTestDetails` | `GetHIVTestsDetailReport` | |
| `SP_Report_LAB_GetCultureReport` | `GetCultureTestsDetailReport` | |
| `SP_Report_Lab_LabTypeWise_Test_Count` | `GetLabTypeWiseTestCountreport` | |
| `SP_Report_PAT_EditedPatientDetailReport` | `GetEditedPatientDetailReport` | |
| `SP_Report_BILL_UserWiseCashCollectionReport` | `UserWiseCashCollectionReport` | 2 result sets |
| `SP_Report_Radiology_Film_Type_Count` | `GetFilmCountReport` | |
| `SP_BIL_MultiplePaymentModeWiseReport` | `PaymentModeWiseReport` | 2 result sets |
| `SP_INCTV_Report_Hospital_Income` | `HospitalIncomeIncentiveReport` | |
| `SP_INCTV_Report_ServiceDepartmentWise_Hospital_Income` | `HospitalIncomeIncentiveReportServiceDepartmentWise` | |
| `SP_Report_APF_BillDetailReport` | `BillDetailReport` | |
| `SP_InventoryDashboardStatistics` | `InventoryDashboardStatistics` | |
| `SP_DepartmentWiseDispatchValue` | `DepaartmentWiseDispatchedValue` | |
| `SP_SubCategoryWiseInventoryStockValue` | `GetSubCategoryWiseInventoryStockValue` | |
| `SP_MonthlyWisePurchaseOrdervsGoodsReceiptValue` | `MonthlyWiseTransaction` | |
| `SP_Report_Bill_SchemeDetailInvoice` | `SchemeDetailInvoiceReport` | |
| `SP_BIL_Dashboard_RankWisePatientInvoiceCount` | `BillingDashboardRankWisePatientInvoiceCount` | |
| `SP_BIL_Dashboard_MembershipWisePatientInvoiceCount` | `BillingDashboardMembershipWisePatientInvoiceCount` | |
| `SP_Dashboard_LAB_MembershipWiseLabTest` | `LabDashboardMembershipWiseTestCount` | |
| `SP_Dashboard_LABRankWiseLabTest` | `LabDashboardRankWiseTestCount` | |
| `SP_Dashboard_LAB_TrendingLabTest` | `LabDashboardTrendingTestCount` | |
| `SP_Dashboard_LAB_TestCompleteToday` | `LabDashboardTestDoneToday` | |
| `SP_Dashboard_LAB_DangueTestDetails` | `LabDashboardDengueTestDetails` | |
| `SP_Dashboard_LAB_TestReqDetails` | `LabDashboardTestReqDetails` | 2 result sets |
| `SP_Dashboard_LAB_AbnormalNormalTestCount` | `LabDashboardNormalAbnormalDetails` | 3 result sets |
| `SP_RPT_DepartmentWiseRankCountReport` | `DepartmentWiseRankCountReport` | |
| `SP_RPT_RankMembershipwiseDischargedPatientReport` | `RankMembershipWiseDischargePatientReport` | |
| `SP_RPT_Admission_InPatientOutstandingReport` | `InpatientOutstandingReport` | |
| `SP_Report_ADT_PatientInOutReport` | `AllWardCountDetail` | 4 result sets |
| `SP_Report_Appointment_DistrictWiseAppointmentReport` | `DistrictWiseAppointmentReport` | |
| `SP_Report_Appointment_GeographicalStatReport` | `GeographicalStatReport` | |
| `SP_Report_Appointment_DayAndMonthWiseVisitReport` | `DayAndMonthWiseVisitReport` | |
| `SP_Report_Appointment_DepartmentWiseStatReport` | `DepartmentWiseStatReport` | |
| `SP_Report_Appointment_DoctorWiseStatReport` | `DoctorWiseStatisticReport` | |
| `SP_Report_AgeClassifiedReport` | `AgeClassifiedOPStatsReport` | |
| `SP_BIL_Dashboard_CardSummary` | `BillingDashboardCardSummary` | 3 result sets |
| `SP_INV_RPT_GetSubstoreDispConsumption_Summary` | `ExportToExcelSubstoreDispConSummaryReport` | |
| `SP_LAB_TestCount_GovernmentReport` | `GetLaboratoryServices` | Used by gov report |
| `SP_Report_Gov_Summary` | `GetSummaryReport` | 9 result sets |
| `SP_Report_Lab_Haematology` | `GetHaematology` | (legacy gov) |
| `SP_Report_Lab_Immunology` | `GetImmunology` | (legacy gov) |
| `SP_Report_Lab_Biochemistry` | `GetBiochemistry` | (legacy gov) |
| `SP_Report_Lab_Bacteriology` | `GetBacteriology` | (legacy gov) |
| `SP_Report_Lab_Cytology` | `GetCytology` | (legacy gov) |
| `SP_Report_Lab_Virology` | `GetVirology` | (legacy gov) |
| `SP_Report_Lab_Immunohistochemistry` | `GetImmunohistochemistry` | (legacy gov) |
| `SP_Report_Lab_Histology` | `GetHistology` | (legacy gov) |
| `SP_Report_Lab_Parasitology` | `GetParasitology` | (legacy gov) |
| `SP_Report_Lab_Cardiacenzymes` | `GetCardiacenzymes` | (legacy gov) |
| `SP_Report_Lab_Hormonesendocrinology` | `GetHormonesendocrinology` | (legacy gov) |
| `SP_Report_INCTV_GetInpatientOutcome` | `GetInpatientOutcome` | Government |
| `SP_Report_INCTV_GetInpatientMorbidity` | `GetInpatientMorbidity` | Government |
| `SP_Report_INCTV_GetHospitalMortality` | `GetHospitalMortality` | Government |
| `SP_Report_BILL_GovReportSummary` | `GovReportSummary` | Government |
| `SP_MRD_OutPatientMorbidityReport` | `OutPatientMorbidityReport` | ICD-10 grouping |
| `SP_MRD_EmergencyPatientMorbidityReport` | `EmergencyPatientMorbidityReport` | ICD-10 grouping |
| `SP_Inctv_ExportAllEmpItemsSettings` | `ExportToExcel_INCTV_AllEmpItemsSettings` | Excel export |

---

## Appendix B: Frontend Module Structure

The Angular module is `ReportingModule` declared in `reporting.module.ts`. Providers include `DLService`, `ReportingService`, `VisitDLService`, `BillingBLService`, `AppointmentDLService`, `ADT_DLService`, `VisitService`, `VisitBLService`. The module declares ~100 components and is wired into the application via the `ReportingRoutingModule`.

### Folder layout under `wwwroot/DanpheApp/src/app/reporting/`

| Folder | Purpose | Example components |
|-------|---------|-------------------|
| `adt/` | ADT reports | `admission/`, `discharge/`, `inpatient-census/`, `inpatient-outstanding-report/`, `rank-membershipwise-admitted-patient-report/`, `rank-wise-discharge-list/`, `transfer/`, `diagnosis/` |
| `appointment/` | Appointment reports | `daily-appointments/`, `day-and-monthwise-visit-report/`, `department-wise-stat/`, `dept-wise/`, `district-wise/`, `doctor-wise/`, `doctorwise-statistic-report/`, `geographical-stat-report/`, `phonebook-appointment/`, `rank-wise-appointment/`, `age-classified-op-stats-report/` |
| `billing/` | Billing reports (the largest folder) | `EHS-billing-report/`, `PaymentMode Wise Report/`, `bill-detail/`, `cancel-summary/`, `credit-settlement-report/`, `custom-reports/`, `denominations/`, `department-wise-discount-scheme-report/`, `department-wise-rank-count/`, `deposit-transactions/`, `deposits/`, `dept-revenue/`, `dept-summary/`, `dialysis-patients/`, `discount-scheme-report/`, `discounts/`, `doc-income-summary/`, `doc-report/`, `doctor-referral/`, `doctor-revenue/`, `doctor-summary/`, `income-segregation/`, `item-summary/`, `mis-reports/`, `package-sales/`, `pat-bill-history/`, `pat-census/`, `pat-credits/`, `pat-neighbourhood/`, `referral-reports/`, `return-bills/`, `sales-daybook/`, `scheme-detail-invoice-report/`, `total-items-bill/`, `user-collection/`, `user-wise-cash-collection-report/` |
| `doctors/` | Doctors reports | `doctorwise-encounter-patient-report.component.ts` |
| `lab/` | Lab reports | `category-wise/`, `covid-summary-report/`, `culture-report/`, `doctor-wise/`, `hiv-test-report/`, `item-wise/`, `labtype-wise-test-count/`, `revenue/`, `status-wise-count-report/`, `total-count-report/`, `shared/lab-status-filter/` |
| `patient/` | Patient reports | `patient-registration/`, `edited-patient-detail/` |
| `police-case/` | Police case report | `police-case-report.component.ts`, `police-case-report.html`, `police-case-report.model.ts` |
| `radiology/` | Radiology reports | `category-wise/`, `film-type count/`, `revenue/` |
| `shared/` | Shared models and service | `reporting-service.ts`, `discharged-patient.model.ts`, `discount-scheme-report.dto.ts`, `doctor-list.dto.ts`, `doctor-wise-statistics-report.dto.ts`, `dynamic-gov-report.model.ts`, `dynamic-report.model.ts`, `inpatient-outstanding-report.dto.ts`, `report-date.model.ts`, `depertment-wise-stat-report.dto.ts`, `total-admitted-patient.model.ts` |
| Top-level | Module shell | `reporting-main.component.ts`, `reporting-main.html`, `reporting-routing.module.ts`, `reporting.module.ts` |

### Standalone dynamic-report module

`wwwroot/DanpheApp/src/app/dynamic-report/dynamic-report.component.ts` (89 lines) implements `DynamicReportComponent` with:
- `Query: string` - the user-entered SQL.
- `ReportData: Array<any>` and `ReportColumns: Array<any>` - rendered in a `danphe-grid` with `grid-showExport=true`.
- `LoadReport()` - calls `dlService.LoadReportData(Query)` which posts to `/DynamicReporting/GetReportData`.
- `ValidateQuery(query)` - client-side mirror of the server's keyword blocklist (`create`, `drop`, `update`, `insert`, `alter`, `delete`, `attach`, `detach`, `grant`, `truncate`, `revoke`).

---

## Appendix C: Hospital "Data not found" / `MessageboxService.showMessage` usage

The reporting frontend consistently uses `MessageboxService` to surface server errors:
- `"error"` + `[err.ErrorMessage]` - generic error.
- `"error"` + `["Data not found!!"]` - SP returned empty.
- `"failed"` + `[res.ErrorMessage]` - server `Status == "Failed"`.
- `"notice-message"` + `["Data is Not Available Between Selected dates...Try Different Dates"]` - date range produced no rows.

This pattern is repeated in 30+ components. The standard pipe is:
```typescript
this.dlService.Read(url).map(res => res).subscribe(
  res => { if (res.Status == "OK") { ... } else { this.msgBoxServ.showMessage("error", [res.ErrorMessage]); } },
  err => this.msgBoxServ.showMessage("error", [err.ErrorMessage])
);
```

---

## Appendix D: Nepali calendar and grid export options

Many components use:
- `NepaliDateInGridColumnDetail` and `NepaliDateInGridParams` from `shared/danphe-grid/NepaliColGridSettingsModel`.
- `NepaliCalendarService` from `shared/calendar/np/nepali-calendar.service`.
- `gridExportOptions` with `fileName` based on the report name and current date.
- `CommonFunctions.ConvertHTMLTableToExcel(id, fromDate, toDate, sheetName, header, fileName)` for non-EPPlus table-to-Excel conversion (used in `department-revenue-report.component.ts:253`).

---

## Appendix E: Country / Government context

DanpheEMR is implemented in Nepal, and several endpoints reflect that:
- `CountrySubDivision` and `MunicipalityName` (district and municipality) are first-class filters in `GeographicalStatReport`, `TotalCovidTestsDetailReport`, `CovidTestsCumulativeReport`.
- `PatientZoneMap` reads from `SP_DSB_Home_PatientDistributionMap_Nepal` (Nepal-specific district mapping).
- `LAB_GovReportItems` represents the 232 ICD-10 groups required by the Nepal Ministry of Health.
- `OutpatientMorbidityReport` and `EmergencyPatientMorbidityReport` produce ICD-10-grouped output for MOH compliance.
- `SP_LAB_TestCount_GovernmentReport` produces the 9-table government summary.

These would need adjustment for a different country, but the controller/DbContext structure is portable.



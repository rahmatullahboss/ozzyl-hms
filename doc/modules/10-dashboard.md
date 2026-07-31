# Dashboard Module

> Source: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/` + `wwwroot/DanpheApp/src/app/dashboards/`
> Reference module count: 8 dashboard surfaces (home, billing, patients, labs, pharmacy, inventory, emergency, doctor)
> Stack: ASP.NET Core MVC + ReportingDbContext (SQL Server) + Angular (Chart.js + AmCharts)

---

## 1. Module Overview

DanpheEMR ships a **distributed dashboard architecture**. Instead of one monolithic "dashboard" controller, each clinical and operational domain owns its own dashboard surface that aggregates KPIs from the broader Reporting database. Every dashboard reads from a set of pre-built SQL Server stored procedures (the `SP_DSB_*` / `SP_BIL_Dashboard_*` / `SP_Dashboard_*` / `SP_InventoryDashboardStatistics` family) and renders the result through AmCharts (legacy) or Chart.js (newer) on the Angular front-end.

Two patterns coexist:

| Pattern | Where used | Description |
|---|---|---|
| **Domain Dashboard Controller** | Patients, Pharmacy, Lab, Inventory, Billing | Dedicated `XxxDashboardController` under the domain folder, calls 2-8 stored procs per endpoint, returns anonymous-typed DataSets. |
| **Reporting-Controller Surface** | Home, Lab, Emergency, Inventory (legacy), Billing card summary | Dashboard endpoints are nested inside `ReportingController` under the `#region For various dashboards` block. |
| **MVC-View Dashboard** | Doctor, Statistics | `XxxViewController` returns Razor views; data is loaded by front-end via the DL service calling the same Reporting endpoints. |

The module serves four audiences:

1. **Admin / front-desk** - Home and Patients dashboards (totals, demographics, maps).
2. **Clinical staff** - Doctor (OPD queue), Lab (test results, dengue, COVID), Emergency (triage).
3. **Finance / billing** - Billing (income, returns, census), Pharmacy (sales, dispatch, top medicines).
4. **Inventory / stores** - Inventory dashboard (purchase, GRN, dispatch, stock).

There is **no separate Nurse dashboard** in DanpheEMR - nursing KPIs surface through the Patient Overview / Doctor Dashboard views.

---

## 2. Backend Files (DashboardController + key methods)

The two files in `Controllers/Dashboard/` are largely **stubs**. Real dashboard logic lives in domain-specific controllers and `ReportingController`.

### 2.1 `Controllers/Dashboard/DashboardController.cs`
File: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Dashboard/DashboardController.cs`

```
[RequestFormSizeLimit(valueCountLimit: 100000, Order = 1)]
[Route("api/[controller]")]
public class DashboardController : CommonController
```

- Inherits `CommonController` (not used in the modern dashboard flow).
- `GET(int patientId, int patientVisitId)` - returns "Not implemented".
- `POST()`, `PUT(int patientId)`, `DELETE(int id)` - all return `null`.
- **No live code paths.** The route `api/Dashboard` exists but is unused; the modern dashboard calls go through `Reporting`, `PatientDashboard`, `PharmacyDashboard`, etc.

### 2.2 `Controllers/Dashboard/DashboardViewController.cs`
File: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Dashboard/DashboardViewController.cs:20`

- `DashBoardStatistics()` returns an MVC view - this is a legacy Razor view for the Statistics page, not used by the Angular SPA.

### 2.3 `Controllers/Patient/PatientDashboardController.cs`
File: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Patient/PatientDashboardController.cs:16`

Injects `PatientDbContext` via `MyConfiguration`. Returns `DanpheHTTPResponse<object>`.

| Method | Line | Stored Proc | Purpose |
|---|---|---|---|
| `GetPatientDashboardCardSummaryCalculation(FromDate, ToDate)` | 27 | `SP_Dashboard_PAT_CardSummaryCalculation` | 4 tables: Patients, Doctors, Appointments, ReAdmission |
| `GetPatientCountByDay(FromDate, ToDate)` | 55 | `SP_Dashboard_PAT_PatientCountByDay` | Inpatient vs outpatient per day |
| `GetAverageTreatmentCostbyAgeGroup(FromDate, ToDate)` | 75 | `SP_Dashboard_PAT_AverageTreatmentCostbyAgeGroup` | Stacked horizontal-bar by gender |
| `GetDepartmentWiseAppointment(FromDate, ToDate)` | 94 | `SP_Dashboard_PAT_DepartmentWiseAppointment` | Doughnut chart |
| `GetPAtVisitByMembership(FromDate, ToDate)` | 113 | `SP_Dashboard_PAT_VisitByMembership` | Table of visit counts by membership type |
| `GetPatientDistributionBasedOnRank(FromDate, ToDate, DepartmentId?)` | 132 | `SP_Dashboard_PAT_PatientDistributionBasedOnRank` | Pie chart, filterable by department |
| `GetHospitalManagement(FromDate, ToDate)` | 152 | `SP_Dashboard_PAT_HospitalManagement` | Top-N hospital-managed patients |

### 2.4 `Controllers/Pharmacy/PharmacyDashboardController.cs`
File: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Pharmacy/PharmacyDashboardController.cs:15`

| Method | Line | Stored Proc | Returns |
|---|---|---|---|
| `GetPharmacyDashboardCardSummaryCalculation` | 25 | `SP_Dashboard_PHRM_CardSummaryCalculation` | 4 DataSets: Sales, GoodReceipts, Dispatches, Stocks |
| `GetPharmacyDashboardSubstoreWiseDispatchValue` | 53 | `SP_Dashboard_PHRM_SubstoreWiseDispatchValue` | Bar chart data per substore |
| `GetPharmacyDashboardMembershipWiseMedicineSale` | 73 | `SP_Dashboard_PHRM_MembershipWiseMedicineSale` | Pie/table of sales by membership |
| `GetPharmacyDashboardMostSoldMedicine` | 92 | `SP_Dashboard_PHRM_MostSoldMedicine` | Top-N list of medicines sold |

### 2.5 `Controllers/Reporting/ReportingController.cs` (Dashboard region)
File: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Reporting/ReportingController.cs`

Holds the bulk of cross-domain dashboard endpoints. The dashboard endpoints live in the `#region For various dashboards` block (line 1269) and a few standalone regions:

| Method | Line | Stored Proc | Domain |
|---|---|---|---|
| `IncomeSegregation(FromDate, ToDate)` | 1272 | `SP_Report_BIL_IncomeSegregation` | Billing |
| `DailyRevenueTrend()` | 1293 | `SP_Report_BILDSB_DailyRevenueTrend` | Billing |
| `MonthlyBillingTrend()` | 1311 | `SP_Report_BILDSB_MonthlyBillingTrend` | Billing |
| `BILLDsbCntrUsrCollection(FromDate, ToDate, counterId?)` | 1329 | `SP_Report_BILL_CounterNUsersCollectionDaily` | Billing |
| `BILLDsbOverallBillStatus()` | 1347 | (inline LINQ) | Billing KPIs |
| `HomeDashboardStats()` | 1391 | `SP_DSB_Home_DashboardStatistics` | Home |
| `HomeInvDashboardStats(SourceStoreId)` | 1409 | `SP_DBS_Home_InvDashboardStats` | Inventory on home |
| `DepartmentWiseConsumerItems(SourceStoreId)` | 1428 | `SP_DSB_Home_DeptWiseConsumerItems` | Inventory |
| `SubCategoryWiseInventoryStockValue(SourceStoreId)` | 1446 | `SP_DSB_Home_SubCategoryWiseInventoryStockValue` | Inventory |
| `MonthlyWisePurchaseOrdervsGoodsReceiptValue(SourceStoreId)` | 1465 | `SP_DSB_Home_MonthlyWisePurchaseOrdervsGoodsReceiptValue` | Inventory |
| `PatientZoneMap()` | 1482 | `SP_DSB_Home_PatientDistributionMap_Nepal` | Home map |
| `DepartmentAppointmentsTotal()` | 1500 | `SP_DSB_Home_DeptWiseAppointmentCount` | Home pie |
| `PatientGenderWise()` | 1518 | `SP_DSB_Patient_GenderWiseCount` | Home pie |
| `PatientAgeRangeNGenderWise()` | 1536 | `SP_DSB_Patient_AgeRangeNGender` | Home bar |
| `LabDashboard()` | 1554 | `SP_DSB_Lab_DashboardStatistics` | Lab (3 tables) |
| `CovidDetailsForLab(testName)` | 1572 | (inline) | Lab COVID card |
| `ERDashboard()` | 1590 | `SP_DSB_Emergency_DashboardStatistics` | Emergency |
| `InventoryDashboardStatistics(SourceStoreId)` | 1942 | `SP_InventoryDashboardStatistics` | Inventory |
| `DepertmentwiseDispatchedValue(SourceStoreId, FromDate?, ToDate?)` | 1962 | `SP_DepartmentWiseDispatchValue` | Inventory |
| `GetSubCategoryWiseInventoryStockValue(SourceStoreId)` | 1982 | `SP_SubCategoryWiseInventoryStockValue` | Inventory |
| `MonthlyWiseTransaction(SourceStoreId)` | 2003 | `SP_MonthlyWisePurchaseOrdervsGoodsReceiptValue` | Inventory |
| `BillingDashboardCardSummary()` | 2024 | `SP_BIL_Dashboard_CardSummary` | Billing (3 tables) |
| `BillingDashboardRankWisePatientInvoiceCount(FromDate, ToDate)` | 2055 | `SP_BIL_Dashboard_RankWisePatientInvoiceCount` | Billing bar |
| `BillingDashboardMembershipWisePatientInvoiceCount(FromDate, ToDate)` | 2078 | `SP_BIL_Dashboard_MembershipWisePatientInvoiceCount` | Billing pie |
| `LabDashboardMembershipWiseTestCount(FromDate, ToDate)` | 2101 | `SP_Dashboard_LAB_MembershipWiseLabTest` | Lab pie |
| `LabDashboardRankWiseTestCount(FromDate, ToDate)` | 2124 | `SP_Dashboard_LABRankWiseLabTest` | Lab pie |
| `LabDashboardTrendingTestCount(FromDate, ToDate)` | 2169 | `SP_Dashboard_LAB_TrendingLabTest` | Lab bar |
| `LabDashboardTestDoneToday()` | 2193 | `SP_Dashboard_LAB_TestCompleteToday` | Lab doughnut |
| `LabDashboardDengueTestDetails()` | 2216 | `SP_Dashboard_LAB_DangueTestDetails` | Lab cards |
| `LabDashboardLabReqDetails()` | 2239 | `SP_Dashboard_LAB_TestReqDetails` | Lab cards (2 tables) |
| `LabDashboardNormalAbnormalDetails(labTestId)` | 2265 | `SP_Dashboard_LAB_AbnormalNormalTestCount` | Lab line+bar combo |

### 2.6 `Controllers/Doctors/DoctorsViewController.cs`
File: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Doctors/DoctorsViewController.cs:13`

MVC view controller only. Returns the `DoctorDashboard`, `PatientOverview`, `VisitSummary` views. The doctor dashboard itself is rendered client-side by `wwwroot/DanpheApp/src/app/doctors/dashboard/doctor-dashboard.component.ts` (uses the patient/visit APIs, not the reporting dashboard endpoints).

### 2.7 Dal-Layer Methods (ReportingDbContext)
File: `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/ReportingDbContext.cs`

The `DynamicReport` wrapper (see Section 3) is returned by every dashboard method. Key entry points:

- `BIL_Daily_IncomeSegregation` (line 1080)
- `BIL_Daily_RevenueTrend` (line 1099)
- `BIL_Monthly_BillingTrend` (line 1114)
- `BIL_Daily_CounterNUsersCollection` (line 1128)
- `Home_DashboardStatistics` (line 1152)
- `Home_DashinvboardStatistics` (line 1163)
- `Home_Dashboard_DepartmentWiseConsumerItems` (line 1172)
- `Home_Dashboard_SubCategoryWiseInventoryStockValue` (line 1184)
- `Home_Dashboard_MonthlyWisePurchaseOrdervsGoodsReceiptValue` (line 1195)
- `Home_PatientZoneMap` (line 1206)
- `Home_DeptWise_TotalAppointmentCount` (line 1219)
- `Patient_GenderWiseCount` (line 1236)
- `Patient_AgeRangeNGenderWiseCount` (line 1249)
- `Lab_DashboardStatistics` (line 1261)
- `Emergency_DashboardStatistics` (line 1279)
- `InventoryDashboardStatistics` (line 1786)
- `DepaartmentWiseDispatchedValue` (line 1798)
- `SubCategoryWiseInventoryStockValue` (line 1814)
- `MonthlyWiseTransaction` (line 1827)
- `BillingDashboardRankWisePatientInvoiceCount` (line 1858)
- `BillingDashboardMembershipWisePatientInvoiceCount` (line 1873)
- `LabDashboardMembershipWiseTestCount` (line 1888)
- `LabDashboardRankWiseTestCount` (line 1903)
- `LabDashboardTrendingTestCount` (line 1918)
- `LabDashboardTestDoneToday` (line 1933)
- `LabDashboardDengueTestDetails` (line 1943)
- `LabDashboardTestReqDetails` (line 1953)
- `LabDashboardNormalAbnormalDetails` (line 1973)

---

## 3. Data Models

### 3.1 Server Models (`DanpheEMR.ServerModel/ReportingModels/`)

| Model | File | Purpose |
|---|---|---|
| `DynamicReport` | `ReportingModels/DynamicReport.cs:11` | Generic wrapper for stored-proc outputs. Two members: `Schema` (string, usually null) and `JsonData` (string, the serialized result). |

```csharp
public class DynamicReport {
    public string Schema { get; set; }
    public string JsonData { get; set; }
}
```

Used because every dashboard stored proc returns ad-hoc DataSets - the front-end parses `JsonData` as a JSON string of either:
- A single object/array
- A multi-table wrapper: `{ LabelData: [], TestTrendsData: [], TestCompletedData: [] }` (Lab pattern)
- A multi-table wrapper: `{ Patients: [], Doctors: [], Appointments: [], ReAdmission: [] }` (Patient pattern)
- A multi-table wrapper: `{ Sales: [], GoodReceipts: [], Dispatchs: [], Stocks: [] }` (Pharmacy pattern)

Other server models are pulled in transitively: `BillServiceItemModel`, `PatientModel`, `EmployeeModel`, `VisitModel`, `AdmissionModel`, `PharmacyStockModel`, `LabRequisitionModel`, `MembershipTypeModel`, `BillingTransactionModel`, `DepartmentModel`, `CountrySubDivisionModel`.

### 3.2 TypeScript Front-end Models

#### `dashboards/shared/pharmacy-dashboard.model.ts`
```ts
class CardCalculationModel { TransactionType: string; TotalAmount: number; TotalUnit: number; }
class BarchartModel { Names: Store[]; DispatchValues: DispatchValue[]; }
class MembershipwiseMedicineSaleModel { MembershipTypeName: string; TotalSales: number; QuantitySold: number; }
class MedicineSaleModel { ItemName: string; SoldQuantity: number; }
class DateRange { fromDate: string; toDate: string; range: string; }
```

#### `dashboards/labs/labDashboardVM.model.ts`
```ts
class LabSummaryDashboardVM {
    TotalTest, TotalNegative, TotalPositive, TotalPendingTests: number;
    TotalTestToday, TotalNegativeToday, TotalPositiveToday, PendingTestsToday: number;
}
class labReqDetails {
    PositiveCount, NegativeCount, PendingCount, TotalCount: number;
    CancelledCountForNewPatient, ReturnCountForNewPatient,
    CompleteCountForNewPatient, PendingCountForNewPatient, TotalCountForNewPatient: number;
}
class NormalAbnormalLabModel { JanCount, FebCount, MarCount, AprCount, MayCount,
    JunCount, JulCount, AugCount, SepCount, OctCount, NovCount, DecCount: number; }
```

#### `dashboards/billing/billing-dashboard.component.ts` (in-file)
```ts
class MembershipWisePatientInvoice { MembershipTypeName: string; Total: number; }
class RankWisePatientInvoice { Rank: string; Total: number; }
class BillingDashboardCardSummaryPatientReport { Total_Today, Total_Weekly, Total_Monthly: number; }
class BillingDashboardCardSummaryIncomeReport { Total_Today, Total_Weekly, Total_Monthly: number; }
class BillingDashboardCardSummaryBillReturnReport { Total_Today, Total_Weekly, Total_Monthly: number; }
class BillingDashboardInpatientCensusReport { Ward, InBed, NewAdmission, TransIn, TransOut, Discharged, Total: number; }
```

#### `dashboards/patients/patients-dashboard.component.ts` (in-file)
```ts
class CardCalculation { Label: string; Total: number; }
class PatientCount { Label, PatientCount, InPatientCount, OutPatientCount, VisitType: string; }
class TreatmentCostByAgeGroup { Gender: string; AgeRange: string; Total: number; }
class DepartmentWiseAppointmentData { DepartmentName: string; AppointmentCount: number; }
class PatientVisitByMembership { MembershipTypeName: string; Count: number; Percent: number; }
class PatientDistributionBasedOnRank { Rank: string; Count: number; DepartmentName: string; DepartmentId: number; }
class HospitalManagement { Label: string; Count: number; Percentage: number; }
class Department { DepartmentId: number; DepartmentName: string; }
```

#### `dashboards/inventory/inventory-dashboard.component.ts` (in-file)
```ts
class InventoryDashboardStatistics {
    TotalPurchaseRequestQuantity, TotalPurchaseRequestQuantityToday, TotalPurchaseRequestQuantityYesterday: number;
    TotalPurchaseOrderQuantity, TotalPurchaseOrderQuantityToday, TotalPurchaseOrderQuantityYesterday: number;
    TotalGoodReceiptQuantity, TotalGoodReceiptQuantityToday, TotalGoodReceiptQuantityYesterday: number;
    TotalDispatchQuantity, TotalDispatchQuantityToday, TotalDispatchQuantityYesterday: number;
}
```

#### `dashboards/shared/danphe-charts.service.ts`
Wraps AmCharts. The `DanpheChartOptions` class at line 1130 holds `{ fieldX: string; fieldY: string; }` for pie / serial charts.

---

## 4. Database Tables

The dashboard module is **read-only** - it queries transactional tables and reporting views. The principal source tables (each pulled by 1+ stored procs) include:

| Table | Used By | Notes |
|---|---|---|
| `PAT_Patient` | Home, Patients, ER, Doctor | Master demographics |
| `PAT_Visits` | Home, Patients, Doctor, ER | Visit + VisitType (in/out) |
| `PAT_PatientMembership` | Home, Billing, Patient | Membership FK |
| `MST_Membership` | Billing, Patient | Membership type lookup |
| `PAT_Appointment` | Home, Doctor, Patient | Schedule |
| `EMP_Employee` | Home, Doctor | Staff master (type, role) |
| `MST_Department` | Home, Patient, Doctor, ER | Department lookup |
| `MST_CountrySubDivision` | Home (map), Patient | Nepal zone codes (`NP-BA`, `NP-KA`, etc.) for the map widget |
| `ADT_Admission` | Patient, Doctor | Re-admission count |
| `BIL_TXN_BillingTransaction` | Billing | Provisional/unpaid aggregates |
| `BIL_TXN_BillingTransactionItems` | Billing | Provisional sum |
| `BIL_TXN_Deposit` | Billing | Deposit balance |
| `BIL_TXN_Invoice` | Billing card summary | Patient count, income, return amounts |
| `LAB_LabRequisition` | Lab, Lab dashboard | Test order count + status |
| `LAB_TestComponentResult` | Lab | Normal/abnormal classification |
| `RAD_PatientImagingRequisition` | (referenced in inventory rollups) | Imaging volume |
| `PHRM_Dispensary` | Pharmacy | Sales, dispatch |
| `PHRM_GoodsReceipt` | Pharmacy | Receipts |
| `PHRM_StockTransaction` | Pharmacy | Substore dispatch |
| `PHRM_MST_Item` | Pharmacy | Most-sold ranking |
| `INV_TXN_PurchaseRequest` | Inventory | Request counts |
| `INV_TXN_PurchaseOrder` | Inventory | PO counts |
| `INV_TXN_GoodsReceipt` | Inventory | GRN counts |
| `INV_TXN_Dispatch` | Inventory | Dispatch counts |
| `INV_MST_Item` | Inventory | Items by subcategory |
| `INV_MST_SubCategory` | Inventory | Subcategory rollups |
| `MST_Rank` | Billing, Patient, Doctor | Discount rank |
| `MST_Scheme` | Billing | Scheme-based invoice counts |
| `MST_Parameter` | Core | Lookup parameters (e.g. CovidTestName, ModulesDashboardDisplaySettings) |
| `Audit/Audit_Trail` | (Read by report) | SystemAdmin trail |

Reporting views (virtualized):
- `VW_BIL_DailyCollection` - powers `BIL_Daily_RevenueTrend`
- `VW_BIL_IncomeSegregation` - powers income segregation
- `VW_DSB_HomeCounts` (via `SP_DSB_Home_DashboardStatistics`) - powers Home tiles

> The SQL Server schema ships as `Dev_DanpheEMR_INT1.bak` (132 MB binary). Inline stored-proc definitions are not in the source tree; they are inferred from the C# method names and consumed via `DALFunctions.GetDataTableFromStoredProc` / `GetDatasetFromStoredProc`.

---

## 5. Key Workflows

### 5.1 Home Dashboard (Admin / front-desk)

**Route:** `DashboardHomeComponent` at `wwwroot/DanpheApp/src/app/dashboards/home/dashboard-home.component.ts:13`.

Lifecycle (`ngOnInit`, line 23):

1. `LoadDsbStatistics()` calls `GET /Reporting/HomeDashboardStats` -> `SP_DSB_Home_DashboardStatistics` -> first-row summary object `dsbStats` with `{TotalPatient, TodayPatient, YestardayPatient, TotalDoctorsCount, ConsultantsCount, MedicalOfficersCount, AnaesthetistsCount, NewAppts, FollowUpAppts, ReferralAppts, TotalAppts, CancelAppts, ReturnAppts}`.
2. `LoadPatientMap()` calls `GET /Reporting/PatientZoneMap` -> array `{MapAreaCode, PatientCount}` rendered as a Nepal choropleth via `DanpheChartsService.Home_Map_PatientDistributionByZone` (AmCharts map).
3. `LoadDepartmentAppts()` calls `GET /Reporting/DepartmentAppointmentsTotal` -> `{DepartmentName, AppointmentCount}` rendered as a pie via `DanpheChartsService.Home_Pie_DepartmentWiseAppointmentCount`.

Template `dashboard-home.html` shows 3 stat cards (Patient, Doctors, Appointments) plus the department pie. Patient-zone map is feature-flagged by `coreService.showCountryMapOnLandingPage` (line 17) and is currently commented out in the HTML (line 94).

### 5.2 Doctor Dashboard (OPD/IPD queue)

**Route:** `DoctorDashboardComponent` at `wwwroot/DanpheApp/src/app/doctors/dashboard/doctor-dashboard.component.ts`.

This is **not** the legacy `Reporting` endpoint family - it surfaces a live OPD queue grouped by PerformerName. The component polls visit/appointment APIs and renders them in `doctor-dashboard.html` (lines 5-150):

1. Lists today's outpatient visits grouped by Performer (line 62: `filtertodaysVisitList`).
2. Shows two tabs: "Out Patient Department" / "In Patient Department" (lines 5-8).
3. Visit Type dropdown re-filters the queue (line 31).
4. Each patient link routes to `PatientOverview` (line 67).
5. "Reassign" action (line 119) opens a modal to move a patient to a different doctor.

The view is served by `DoctorsViewController.DoctorDashboard()` (line 38), gated by `DanpheViewFilter("doctors-outpatientdoctor-view")`.

### 5.3 Patient Dashboard (Analytics)

**Route:** `PatientsDashboardComponent` at `wwwroot/DanpheApp/src/app/dashboards/patients/patients-dashboard.component.ts:18`.

`ngOnInit` (line 56) calls `GetDepartments()`. On any date-range change (line 310 `OnFromToDateChange`) it fires **7 endpoints in parallel**:

1. `GetPatientDashboardCardSummaryCalculation` -> 4 cards (Patients, Doctors, Appointments, ReAdmission) with day-over-day % deltas.
2. `GetPatientCountByDay` -> bar chart by visit type (inpatient/outpatient).
3. `GetAverageTreatmentCostbyAgeGroup` -> stacked horizontal bar (Male/Female/Other) by age group.
4. `GetDepartmentWiseAppointment` -> doughnut by department.
5. `GetPAtVisitByMembership` -> membership table (MSSQL row -> percentage).
6. `GetPatientDistributionBasedOnRank` -> pie by rank (filterable by department via `onDepartmentChange`, line 456).
7. `GetHospitalManagement` -> table of top hospital-managed patients.

Front-end computes `PattientDifferenceRate`, `AppointmentDifferenceRate`, `ReAdmissionDifferenceRate` using the formula `((cur - prev) / prev) * 100` (lines 334-345). When `Math.abs(rate) === Infinity` (division by zero), the rate is rendered as `'-'`.

### 5.4 Billing Dashboard

**Route:** `BillingDashboardComponent` at `wwwroot/DanpheApp/src/app/dashboards/billing/billing-dashboard.component.ts:15`.

Constructor (line 50) calls `getAllBillingDashboardData()` which fetches:
- `GET /Reporting/BillingDashboardCardSummary` -> 3 cards (Patient/Income/BillReturn) each with `Total_Today`, `Total_Weekly`, `Total_Monthly`.

On date change (`OnFromToDateChanged` line 222) it calls:
- `GetBillingDashboardMembershipWisePatientInvoice` -> pie (Chart.js) of `{MembershipTypeName, Total}`.
- `GetBillingDashboardRankWisePatientInvoice` -> bar of `{Rank, Total}`.
- `GetBillingDashboardInpatientCensusReport` -> uses `forkJoin` of 3 sub-requests (`DischargedPatient`, `TotalAdmittedPatient`, `AllWardCountDetail`) returning `BillingDashboardInpatientCensusReport[]`.

The component tears down and re-creates Chart.js instances to avoid canvas reuse errors (`rankWiseChart.destroy()` lines 118, 163).

### 5.5 Lab Dashboard

**Route:** `LabDashboardComponent` at `wwwroot/DanpheApp/src/app/dashboards/labs/lab-dashboard.component.ts:45`.

Constructor (line 75) kicks off:
1. `GetAllLabTests()` -> dropdown source for selecting a test.
2. `LoadCovidTestDetails()` -> `CovidDetailsForLab` with the test name from the `Common` parameter group key `CovidTestName` (line 79).
3. `LoadTestDoneToday()` -> doughnut of `{ReportTemplateShortName, TestCount}`.
4. `LoadDengueDetails()` -> 2 cards (overall + today) from `LabDashboardDengueTestDetails`.
5. `LoadTestReqDetails()` -> 2 cards from `LabDashboardTestReqDetails` (till-now + today), filtered in TS to extract Total/Positive/Negative/Pending counts by visit type.

On date change (`OnCardFromToDateChange` line 218):
- `LoadMembershipWiseTestCount` -> pie of `{TotalCount, MembershipTypeName}`.
- `LoadRankWiseTestCount` -> pie of `{TotalCount, Rank}`.
- `LoadTrendingTestCount` -> bar of `{LabTestName, Counts}` (top 10).

On test selection (`AssignSelectedTest` line 661):
- `LoadTestNormalAbnormal` -> 12-month count series (Jan..Dec) for normal, abnormal, and visit counts, then renders a combined bar+line chart (line 106).

### 5.6 Pharmacy Dashboard

**Route:** `PharmacyDashboardComponent` at `wwwroot/DanpheApp/src/app/dashboards/pharmacy/pharmacy-dashboard.component.ts:14`.

Date-change handler (`OnFromToDateChange` line 35) fires 4 endpoints:
1. `GetPharmacyDashboardCardSummaryCalculation` -> 4 cards (Sales, GoodReceipts, Dispatchs, Stocks), each with day-over-day `*DifferenceRate` % (lines 139-152). Infinity-safe (shows `'-'`).
2. `GetPharmacyDashboardSubstoreWiseDispatchValue` -> bar of `{Name, TotalDispatchValue}`.
3. `GetPharmacyDashboardMembershipWiseMedicineSale` -> table of `{MembershipTypeName, TotalSales, QuantitySold}`.
4. `GetPharmacyDashboardMostSoldMedicine` -> table of top medicines sold.

### 5.7 Inventory Dashboard

**Route:** `InventoryDashboardComponent` at `wwwroot/DanpheApp/src/app/dashboards/inventory/inventory-dashboard.component.ts:15`.

`ngOnInit` (line 34) calls:
1. `GetParameter()` - reads `ModulesDashboardDisplaySettings` from `MST_Parameter` to decide whether inventory dashboard is shown at all (`IsInvDashbordEnabled`).
2. `LoadInventoryDashboardStatistics` -> cards (Purchase Request / PO / GRN / Dispatch) with today + yesterday counters.
3. `LoadSubcategoryInventoryStockValue` -> pie of `{SubCategoryName, TotalStockValue}`.
4. `LoadMonthlyWiseTransactions` -> bar of monthly purchase / GRN / dispatch values (3 series).

Date change (`OnFromToDateChange` line 188) refetches `GetAllStorewiseDispatchValue` -> pie of `{Name, TotalDispatchValue}` per department.

> Subtle bug: `SourceStoreId` is hard-coded via `ActivateInventoryService.activeInventory.StoreId` (line 31). When the active inventory changes, the dashboard does not auto-refresh.

### 5.8 Emergency Dashboard

**Route:** `EmergencyDashboardComponent` at `wwwroot/DanpheApp/src/app/dashboards/emergency/emergency-dashboard.component.ts:9`.

`ngOnInit` (constructor line 13) calls `LoadERDashboard()` which hits `GET /Reporting/ERDashboard` -> `SP_DSB_Emergency_DashboardStatistics` -> first-row summary stored at `stats.LabelData[0]`. The template (`emergency-dashboard.html`) shows 3 stat cards: blue (today's ER count), red (admitted), green (discharged) - lines 4-26.

### 5.9 Summary Widget Pattern

The same `DanpheChartsService` is shared by every dashboard. The pattern is:
1. Component calls DL service.
2. DL service returns `DanpheHTTPResponse<DynamicReport>`.
3. Component parses `Results.JsonData` (string) into a typed array.
4. Component hands the array to a `DanpheChartsService` method (`Home_Map_*`, `Home_Pie_*`, `Lab_Bar_*`, `Pharmacy_Line_*`, `Inventory_Pie_*` etc.) which calls `AmCharts.makeChart(target, options)`.
5. Newer dashboards (Billing, Lab, Patients, Pharmacy) use `new Chart(canvas, config)` from Chart.js directly instead of `AmCharts`.

---

## 6. API Endpoints (20+)

All dashboard endpoints are GET (read-only) and run on the `Reporting` (or domain-specific) controller. Most accept `FromDate` and `ToDate` as either `DateTime` route parameters or `string` query parameters.

### 6.1 Home

| # | Method | Route | Source |
|---|---|---|---|
| 1 | GET | `/Reporting/HomeDashboardStats` | `ReportingController.cs:1391` |
| 2 | GET | `/Reporting/HomeInvDashboardStats?SourceStoreId={id}` | `ReportingController.cs:1409` |
| 3 | GET | `/Reporting/PatientZoneMap` | `ReportingController.cs:1482` |
| 4 | GET | `/Reporting/DepartmentAppointmentsTotal` | `ReportingController.cs:1500` |
| 5 | GET | `/Reporting/PatientGenderWise` | `ReportingController.cs:1518` |
| 6 | GET | `/Reporting/PatientAgeRangeNGenderWise` | `ReportingController.cs:1536` |

### 6.2 Patient (domain controller)

| # | Method | Route | Source |
|---|---|---|---|
| 7 | GET | `/PatientDashboard/GetPatientDashboardCardSummaryCalculation?FromDate&ToDate` | `PatientDashboardController.cs:27` |
| 8 | GET | `/PatientDashboard/GetPatientCountByDay?FromDate&ToDate` | `PatientDashboardController.cs:55` |
| 9 | GET | `/PatientDashboard/GetAverageTreatmentCostbyAgeGroup?FromDate&ToDate` | `PatientDashboardController.cs:75` |
| 10 | GET | `/PatientDashboard/GetDepartmentWiseAppointment?FromDate&ToDate` | `PatientDashboardController.cs:94` |
| 11 | GET | `/PatientDashboard/GetPAtVisitByMembership?FromDate&ToDate` | `PatientDashboardController.cs:113` |
| 12 | GET | `/PatientDashboard/GetPatientDistributionBasedOnRank?FromDate&ToDate&DepartmentId` | `PatientDashboardController.cs:132` |
| 13 | GET | `/PatientDashboard/GetHospitalManagement?FromDate&ToDate` | `PatientDashboardController.cs:152` |

### 6.3 Pharmacy (domain controller)

| # | Method | Route | Source |
|---|---|---|---|
| 14 | GET | `/PharmacyDashboard/GetPharmacyDashboardCardSummaryCalculation?FromDate&ToDate` | `PharmacyDashboardController.cs:25` |
| 15 | GET | `/PharmacyDashboard/GetPharmacyDashboardSubstoreWiseDispatchValue?FromDate&ToDate` | `PharmacyDashboardController.cs:53` |
| 16 | GET | `/PharmacyDashboard/GetPharmacyDashboardMembershipWiseMedicineSale?FromDate&ToDate` | `PharmacyDashboardController.cs:73` |
| 17 | GET | `/PharmacyDashboard/GetPharmacyDashboardMostSoldMedicine?FromDate&ToDate` | `PharmacyDashboardController.cs:92` |

### 6.4 Lab

| # | Method | Route | Source |
|---|---|---|---|
| 18 | GET | `/Reporting/LabDashboard` | `ReportingController.cs:1554` |
| 19 | GET | `/Reporting/CovidDetailsForLab?testName=` | `ReportingController.cs:1572` |
| 20 | GET | `/Reporting/LabDashboardMembershipWiseTestCount?FromDate&Todate` | `ReportingController.cs:2101` |
| 21 | GET | `/Reporting/LabDashboardRankWiseTestCount?FromDate&Todate` | `ReportingController.cs:2124` |
| 22 | GET | `/Reporting/LabDashboardTrendingTestCount?FromDate&Todate` | `ReportingController.cs:2169` |
| 23 | GET | `/Reporting/LabDashboardTestDoneToday` | `ReportingController.cs:2193` |
| 24 | GET | `/Reporting/LabDashboardDengueTestDetails` | `ReportingController.cs:2216` |
| 25 | GET | `/Reporting/LabDashboardLabReqDetails` | `ReportingController.cs:2239` |
| 26 | GET | `/Reporting/LabDashboardNormalAbnormalDetails?labTestId=` | `ReportingController.cs:2265` |

### 6.5 Emergency

| # | Method | Route | Source |
|---|---|---|---|
| 27 | GET | `/Reporting/ERDashboard` | `ReportingController.cs:1590` |

### 6.6 Billing

| # | Method | Route | Source |
|---|---|---|---|
| 28 | GET | `/Reporting/IncomeSegregation?FromDate&ToDate` | `ReportingController.cs:1272` |
| 29 | GET | `/Reporting/DailyRevenueTrend` | `ReportingController.cs:1293` |
| 30 | GET | `/Reporting/MonthlyBillingTrend` | `ReportingController.cs:1311` |
| 31 | GET | `/Reporting/BILLDsbCntrUsrCollection?fromDate&toDate&counterId` | `ReportingController.cs:1329` |
| 32 | GET | `/Reporting/BILLDsbOverallBillStatus` | `ReportingController.cs:1347` |
| 33 | GET | `/Reporting/BillingDashboardCardSummary` | `ReportingController.cs:2024` |
| 34 | GET | `/Reporting/BillingDashboardRankWisePatientInvoiceCount?FromDate&ToDate` | `ReportingController.cs:2055` |
| 35 | GET | `/Reporting/BillingDashboardMembershipWisePatientInvoiceCount?FromDate&ToDate` | `ReportingController.cs:2078` |
| 36 | GET | `/Reporting/DischargedPatient?FromDate&ToDate` (inpatient census) | used by `billing.dl.service.ts:688` |
| 37 | GET | `/Reporting/TotalAdmittedPatient?FromDate&ToDate` | used by `billing.dl.service.ts:689` |
| 38 | GET | `/Reporting/AllWardCountDetail?FromDate&ToDate` | used by `billing.dl.service.ts:690` |

### 6.7 Inventory (legacy reporting)

| # | Method | Route | Source |
|---|---|---|---|
| 39 | GET | `/Reporting/DepartmentWiseConsumerItems?SourceStoreId=` | `ReportingController.cs:1428` |
| 40 | GET | `/Reporting/SubCategoryWiseInventoryStockValue?SourceStoreId=` | `ReportingController.cs:1446` |
| 41 | GET | `/Reporting/MonthlyWisePurchaseOrdervsGoodsReceiptValue?SourceStoreId=` | `ReportingController.cs:1465` |
| 42 | GET | `/Reporting/InventoryDashboardStatistics?SourceStoreId=` | `ReportingController.cs:1942` |
| 43 | GET | `/Reporting/DepertmentwiseDispatchedValue?SourceStoreId&FromDate&ToDate` | `ReportingController.cs:1962` |
| 44 | GET | `/Reporting/GetSubCategoryWiseInventoryStockValue?SourceStoreId=` | `ReportingController.cs:1982` |
| 45 | GET | `/Reporting/MonthlyWiseTransaction?SourceStoreId=` | `ReportingController.cs:2003` |

> **Total: 45+ dashboard endpoints** across 7 surfaces.

### 6.8 Sub-Endpoints (used by `forkJoin`)

`BillingDashboardComponent.loadBillingDashboardInpatientCensusReport` uses RxJS `forkJoin` to call:
- `/Reporting/DischargedPatient?FromDate&ToDate`
- `/Reporting/TotalAdmittedPatient?FromDate&ToDate`
- `/Reporting/AllWardCountDetail?FromDate&ToDate`

These are surfaced in the BL service at `wwwroot/DanpheApp/src/app/billing/shared/billing.dl.service.ts:687-693` but their controller mapping is in `ReportingController` or `AdmissionController` (not in the dashboard folder).

---

## 7. Cross-Module (every module feeds dashboards)

The dashboard module is a **fan-in** consumer. Every clinical and operational module exposes data that surfaces in some widget:

| Source Module | Surfaces In |
|---|---|
| **Patient / Registration** | Home (TotalPatient, TodayPatient, YestardayPatient), Patients (cards, demographics, age range, gender), ER (visit count), Map (zone counts) |
| **Appointment** | Home (NewAppts, FollowUpAppts, ReferralAppts, CancelAppts, ReturnAppts), Patients (DepartmentWiseAppointment), Doctor (live OPD queue) |
| **Visit** | Doctor (per-doctor queue, filtertodaysVisitList), Patients (PatientCountByDay), Billing (invoice counts) |
| **Billing / BillingTransaction** | Billing (Income card, Provisional, Credit, Deposit), Patients (ReAdmission), Pharmacy (sales) |
| **Pharmacy / Dispensary** | Pharmacy dashboard (Sales, Dispatchs), Inventory rollups |
| **Pharmacy / GoodsReceipt** | Pharmacy dashboard (GoodReceipts) |
| **Pharmacy / StockTransaction** | Pharmacy dashboard (Stocks, Substore Dispatch) |
| **Lab / LabRequisition** | Lab dashboard (TestCount, Pending, Membership/Rank-wise), CovidDetails, Dengue, Normal/Abnormal chart |
| **Lab / TestComponentResult** | Lab dashboard (Normal vs Abnormal classification) |
| **Emergency** | Emergency dashboard (today, admitted, discharged) |
| **Inventory / PurchaseRequest, PO, GRN, Dispatch** | Inventory dashboard (4 cards + 3 sub-charts), Home inventory tile |
| **Inventory / SubCategory** | Inventory dashboard pie, subcategory stock value |
| **Employee** | Home (TotalDoctorsCount, ConsultantsCount, MedicalOfficersCount, AnaesthetistsCount) |
| **Department** | Patients (DepartmentWiseAppointment), Home (DepartmentAppointmentsTotal) |
| **Membership** | Billing (MembershipWisePatientInvoice), Patients (VisitByMembership), Pharmacy (MembershipWiseMedicineSale) |
| **Rank** | Billing (RankWisePatientInvoice), Patients (PatientDistributionBasedOnRank), Lab (RankWiseTestCount) |
| **Country / CountrySubDivision** | Home map (PatientZoneMap) - Nepal-specific |
| **MST_Parameter** | Common (CovidTestName), ModulesDashboardDisplaySettings (feature flag for inventory dashboard) |
| **Appointment / Doctor** | DoctorDashboard (performer grouping) |
| **Admission** | Billing inpatient census (Discharged, Admitted, Ward-wise) |

The "fan-in" architecture means: any change to a base table (e.g., `PAT_Patient`, `BIL_TXN_BillingTransaction`) immediately affects the dashboard the next time it loads - there is no ETL or staging layer.

---

## 8. Business Rules

### 8.1 Date range semantics

- `FromDate` and `ToDate` are inclusive on both ends. Stored procs use `>= FromDate AND <= ToDate` semantics.
- `string` parameters (e.g., `BillingDashboardRankWisePatientInvoiceCount` line 2055) are passed as-is; the SQL converts to a `datetime` type.
- `DateTime` parameters (e.g., `GetPatientDashboardCardSummaryCalculation` line 27) are auto-converted by the JSON deserializer.
- The Home dashboard ignores date parameters entirely - all counts are **all-time + today + yesterday** (see template `dashboard-home.html:14`).

### 8.2 Card summary formula

Each card on the Billing and Pharmacy dashboards exposes:
- `Total_Today` - sum of amounts for today only.
- `Total_Weekly` - sum for the current week (Mon-Sun or Sun-Sat depending on locale).
- `Total_Monthly` - sum for the current month (1st -> today).
- `*DifferenceRate` - `(cur - prev) / prev * 100`. When `prev = 0` the front-end renders `'-'` to avoid `Infinity` (e.g., `billing-dashboard.component.ts` would benefit from this guard - it currently uses raw division without Infinity check).

### 8.3 Card summary - Patient Dashboard

Patients dashboard cards compute three "Difference Rates" (line 334-345):
- `PattientDifferenceRate` = `((Patients[3].Total - ReAdmission[2].Total) / ReAdmission[2].Total) * 100` - a domain-specific blending of patient-vs-readmission numbers.
- `AppointmentDifferenceRate` = `((Appointments[3].Total - Appointments[2].Total) / Appointments[2].Total) * 100`.
- `ReAdmissionDifferenceRate` = `((ReAdmission[2].Total - ReAdmission[1].Total) / ReAdmission[1].Total) * 100`.

The exact meaning of indices `[0..3]` depends on the stored-proc ordering (typically: yesterday, day-before, last-7, current, etc.).

### 8.4 Inpatient census

`loadBillingDashboardInpatientCensusReport` uses `forkJoin` of 3 calls and consumes the array at index `[0]` (discharged), `[1]` (admitted), `[2]` (ward-wise). The component stores `totalDischargedPatients = res[0].Results.length` and `totalAdmittedPatients = res[1].Results.length`.

### 8.5 Pharmacy day-over-day

`SalesDifferenceRate`, `GoodReceiptDifferenceRate`, `DispatchDataDifferenceRate` are computed in `pharmacy-dashboard.component.ts:139-152` as:
```
((SalesData[4].TotalAmount - SalesData[3].TotalAmount) / SalesData[3].TotalAmount) * 100
```
where `[3]` and `[4]` represent the latest two days in the data series. The component guards against `Math.abs(rate) === Infinity` and renders `'-'`.

### 8.6 Membership filter semantics

The Patients dashboard supports department-filtered rank distribution:
- `selectedDepartment = null` (default "All") -> all departments.
- Otherwise, `GetPatientDistributionBasedOnRank(FromDate, ToDate, DepartmentId)` filters in SQL.

The "All" option is prepended client-side in `GetDepartments` (line 451): `this.DepartmentList.unshift({ DepartmentId: null, DepartmentName: 'All' })`.

### 8.7 Test Normal/Abnormal semantics

`LabDashboardNormalAbnormalDetails(labTestId)` returns three datasets:
- `NoramlTestResultCount` (sic - typo preserved) - 12-row table for months Jan..Dec.
- `AbnoramlTestResultCount` (sic) - 12-row table.
- `NoOfVisitsThatUsesLabService` - 12-row visit counts.

Front-end (`lab-dashboard.component.ts:599-647`) loops over each dataset, filters by `Months == 'Jan' | 'Feb' | ... | 'Dec'`, and writes to `normalLabDetails`, `abnormalLabDetails`, `noOfVisitsDetails`. The combined chart is rendered by `createChart()` (line 106) using Chart.js with `bar + 2x line` series.

### 8.8 Inventory active-store filter

`activeInventoryId` is read from `ActivateInventoryService.activeInventory.StoreId`. The component does not subscribe to changes; if the user switches the active inventory in another tab, the dashboard will not refresh until the user navigates back. (Latent bug - documented in the inventory-dashboard.component.ts source.)

### 8.9 Inventory feature flag

`InventoryDashboardComponent.GetParameter()` (line 46) reads `MST_Parameter` with `ParameterGroupName = 'Common'`, `ParameterName = 'ModulesDashboardDisplaySettings'`. The JSON value contains `{ "Inventory": true|false }` which sets `IsInvDashbordEnabled`. When `false`, the inventory dashboard component is rendered but cards are not shown.

### 8.10 Patient zone map

`Home_PatientZoneMap` returns Nepal zone codes (`NP-BA`, `NP-BH`, `NP-DH`, `NP-GA`, `NP-JA`, `NP-KA`, `NP-KO`, `NP-LU`, `NP-MA`, `NP-ME`, `NP-NA`, `NP-RA`, `NP-SA`, `NP-SE`). The map is hard-coded to Nepal (`map: "nepalLow"` in `danphe-charts.service.ts:58`). International deployments need to override this map. The `coreService.showCountryMapOnLandingPage` flag controls visibility, and the template currently has the map block commented out (`dashboard-home.html:94`).

### 8.11 AuthN/AuthZ

- All Reporting endpoints are anonymous in the source code (no `[Authorize]` attribute visible). Auth is enforced at the route-table / reverse-proxy level.
- Domain controllers (`PatientDashboardController`, `PharmacyDashboardController`) inherit `Controller` and do not declare `[Authorize]`. The MVC `DanpheViewFilter` attribute gates the doctor dashboard view (e.g., `doctors-outpatientdoctor-view` permission code).

### 8.12 Threading and async

- All dashboard controllers use `async Task<IActionResult>` so the Web API thread is freed during the SQL roundtrip.
- Long-running stored procs (e.g., `LabDashboardTestReqDetails`, `Lab_DashboardStatistics`) can hold a SQL connection for several seconds. There is no timeout configured in code; relies on the default ADO.NET timeout (30s).
- The home and emergency endpoints are synchronous and serialize DataSet -> JSON inline. This blocks the request thread for the duration of the SQL call.

### 8.13 Caching

- There is **no in-memory or response cache** for any dashboard endpoint. Every page load triggers fresh SQL.
- Front-end reuses Chart.js / AmCharts instances across re-renders by calling `.destroy()` then re-creating.

### 8.14 Error handling

- Server: try/catch with `responseData.Status = "Failed"` and `responseData.ErrorMessage = ex.Message`. The full exception is **logged to `ex.ToString()` in some places** (e.g., `DashboardController.cs:52`) - this is a **PII risk** for production because the connection-string is included in `ex.ToString()`.
- Client: every subscribe handler has an `err` callback that alerts the user (`alert(err.ErrorMessage)`). No retry, no exponential backoff, no offline mode.

### 8.15 Multi-tenant considerations

There is **no `TenantId` filter** in any dashboard endpoint. Each tenant runs its own SQL Server database, so isolation is at the database level, not the query level.

---

## 9. Front-end Component Map

```
wwwroot/DanpheApp/src/app/dashboards/
  home/                       -> Home (admin landing)
    dashboard-home.component.ts:13
    dashboard-home.html
  billing/                    -> Billing dashboard
    billing-dashboard.component.ts:15
    billing-dashboard.html
    billing-dashboard.style.css
  emergency/                  -> ER dashboard
    emergency-dashboard.component.ts:9
    emergency-dashboard.html
  inventory/                  -> Inventory / stores
    inventory-dashboard.component.ts:15
    inventory-dashboard.html
  labs/                       -> Lab analytics
    lab-dashboard.component.ts:45
    lab-dashboard.html
    labDashboardVM.model.ts
  patients/                   -> Patient analytics
    patients-dashboard.component.ts:18
    patients-dashboard.component.html
    patients-dashboard.html
  pharmacy/                   -> Pharmacy analytics
    pharmacy-dashboard.component.ts:14
    pharmacy-dashboard.html
  shared/                     -> shared services + models
    danphe-charts.service.ts:22 (AmCharts wrapper)
    pharmacy-dashboard.model.ts
```

Doctor OPD dashboard (separate from this folder, uses patient/visit APIs):
```
wwwroot/DanpheApp/src/app/doctors/dashboard/
  doctor-dashboard.component.ts
  doctor-dashboard.html
```

---

## 10. Cross-References

- See `05-billing.md` for billing module context.
- See `22-lab.md` for lab requisition data shape.
- See `34-pharmacy.md` for dispensary + stock transaction data shape.
- See `21-inventory.md` for purchase-order / GRN / dispatch data shape.
- See `04-appointment.md` for appointment module that powers the Home + Patient + Doctor dashboards.
- See `32-patient.md` for patient master + visits.

# Lab Module (DanpheEMR Reference)

Complete reference for the DanpheEMR Lab module. Covers all backend controllers, models, workflows, API endpoints, database tables, and integration points with other modules. This document is the authoritative technical reference for the Lab subsystem as it exists in the .NET/SQL Server implementation; the Cloudflare/Hono migration must preserve every workflow documented here.

---

## 1. Module Overview

The Lab module manages the complete laboratory workflow from test ordering through result verification to report dispatch. It supports:

- **Multi-lab-type operations** — Pathology, Histopathology, Cytology (lab types registered in `MST_LabTypes`, active lab selected via session)
- **Structured test catalogs** — Tests composed of named components (analytes) with normal ranges, units, methods, and result-validation rules
- **Sample collection workflow** — Auto-generation of formatted sample codes (`S-001-2024`), barcodes, in-house vs. outsource vendor mapping
- **Result entry with templates** — Normal grid templates, free-form HTML templates, and culture/anti-culture microbiology templates
- **Two-level verification** — Optional result-verifier signatory workflow controlled by `CORE_CFG_Parameters` flag `LabReportVerificationNeededB4Print`
- **Report generation** — Final lab reports with signatories, header/footer text, print-count tracking, and email dispatch
- **External lab integration** — Send-out tests to external vendors with status tracking
- **LIS (Lab Information System) machine integration** — Pull analyzer results from a separate LIS Web API, map analyzer components to internal components, apply conversion factors
- **IMU (Instrument Management Unit) integration** — Forward requisitions/results to the IMU middleware
- **Biometric / LIS punch integration** — `hr_biometric_devices`-style punches are NOT in scope here; this module is the consumer of such data only via the LIS API
- **Gov-report mapping** — Map local tests/components to government reportable disease items (HIV, TB, COVID etc.) for public-health reporting
- **Outsource / vendor workflow** — Tests flagged `IsOutsourceTest` route to external vendors
- **Multi-tenant-ready data model** — All entities carry `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` and are scoped by patient/visit
- **Billing integration** — Adding a lab test creates a `BIL_TXN_BillingTransactionItems` row; lab workflow respects `BillingStatus` (`paid`, `unpaid`, `provisional`, `cancel`, `returned`)

### Order Status Lifecycle

The `OrderStatus` field on `LAB_TestRequisition` follows this state machine:

```
active → pending → result-added → report-generated
                          ↓
                  verified → (printed)
```

Defined in `ENUM_LabOrderStatus`:
- `active` — requisition created, not yet sample-collected
- `pending` — sample collected, awaiting result entry
- `result-added` — result entered, awaiting report generation
- `report-generated` — `LAB_TXN_LabReports` row created
- `verified` — second-level verification complete (only when verification is enabled)

The query layer excludes `cancel` and `returned` billing-status requisitions from all pending lists.

### Run Number Type

`RunNumberType` on a test categorizes the specimen-handling path:
- `normal` — default (hematology, biochem, microbio culture/anti-culture)
- `histo` — histopathology block/slide
- `cyto` — cytology slide

Histo/cyto use `OrderDateTime` as `ReceivingDate` on reports (no separate sample-collection date).

---

## 2. Backend Files

### 2.1 Controller Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `Controllers/Lab/LabController.cs` | 5025 | All lab transactional APIs (requisitions, samples, results, reports, verification, SMS, COVID) |
| `Controllers/Lab/LabSettingController.cs` | 1258 | Lab master data CRUD (tests, components, templates, categories, vendors, lookups, gov-mapping) |
| `Controllers/Lab/LabReportExport.cs` | 1481 | Word-document generation utility (uses OpenXml SDK to render DOCX reports from templates) |
| `Controllers/Lab/LabReportExportController.cs` | 386 | Serves the Word-document templates (`GetTemplateDetails`, `GetAllTemplateDetailswithprintId`) |
| `Controllers/Lab/LabViewController.cs` | 186 | MVC view-routing (legacy `.cshtml` shim) for older pages |
| `Controllers/Lab/IMUController.cs` | 103 | IMU middleware integration (post requisitions, get IMU test list) |
| `Controllers/Lab/LISController.cs` | 283 | LIS machine integration (component mapping, results pull, machine order) |
| `Controllers/Lab/LabsBL.cs` | 409 | Static business-logic helpers: `GetLabReportVMForReqIds`, `GetResultsDenormalized`, `FormatResultsForLabReportVM`, `GetTemplateVM`, `GetTestsOfTemplate` |

### 2.2 Service Inventory

| File | Purpose |
|------|---------|
| `Services/LIS/ILISService.cs` | Interface for LIS integration |
| `Services/LIS/LISService.cs` | Implementation: calls external LIS Web API, joins results to requisitions via `LIS_ComponentMap` |
| `Services/LIS/DTOs/LIS_Machine_Order_DTO.cs` | DTO for sending orders to LIS machines |

### 2.3 View Models and DTOs

View models used in API contracts (`ServerModel/LabModels/`):
- `LabReportVM` — Top-level report with `Lookups`, `Templates`, `Header`, `FooterText`, `Signatories`
- `ReportLookup` — Patient header info (name, code, DOB, gender, prescriber, sample, ward)
- `LabReportTemplateVM` — A single template inside a report (multiple templates per report possible)
- `LabTest_Temp_VM` — A single test inside a template
- `LabPendingResultVM` — List item for "pending result" grids
- `LabPendingResultVM.LabTestDetail` — Per-test sub-row inside a sample-code group
- `FinalLabReportListVM` / `FinalReportListLabTestDetail` — Final-report list grid
- `LabResult_Denormalized_VM` — Flat row joining requisition, result, lab test, template, report for formatting
- `PatientLabSampleVM` — Sample-collection row (specimen, test, sample-code, barcode)
- `LabTestJSONComponentModel` — Component master (analyte) with range, unit, method, value-type, control-type
- `UpdatedSampleCodeReturnData` — Result of manual sample-code generation
- `LatestLabSampleCodeDetailVM` — Result of "next-sample-code" lookup

### 2.4 Key Controller Methods (LabController)

`LabController` has ~50 action methods. Highlights:

| Method | HTTP | Route | Purpose |
|--------|------|-------|---------|
| `GetLabWorkList` | GET | `api/Lab/WorkList` | Technologist worklist by date range + categories |
| `GetLabRequisition` | GET | `api/Lab/Requisition/SamplePending` | Requisitions awaiting sample collection |
| `GetPatientSamplePending` | GET | `api/Lab/Requisition/PatientSamplePending` | Pending sample for a specific patient |
| `GetLatestSampleCode` | GET | `api/Lab/LatestSampleCode` | Auto-compute next formatted sample code |
| `CheckIsSampleCodeValid` | GET | `api/Lab/IsSampleCodeValid` | Validate that a manual sample code is not in use |
| `GetPendingLabResults` | GET | `api/Lab/Result/Pending` | Pending-result entry list |
| `GetPendingLabReport` | GET | `api/Lab/Report/Pending` | Reports awaiting generation |
| `GetReportForReportDispatch` | GET | `api/Lab/Report/Finalized` | Final reports by patient for dispatch |
| `GetLabDataByBarcodeNumber` | GET | `api/Lab/LabDataByBarcodeNumber` | All lab data for a barcode |
| `GetLabDataByRunNumber` | GET | `api/Lab/LabDataByRunNumber` | All lab data for a formatted run number |
| `GetLabDataByPatientId` | GET | `api/Lab/LabDataByPatientId` | All lab data for a patient |
| `GetLabReportByRequisitionIds` | GET | `api/Lab/LabReportByRequisitionIds` | Formatted report VM for printing |
| `GetLabReportByRequisitionIdsForReportDispatch` | GET | `api/Lab/ReportDispatch/LabReportByRequisitionIds` | Same but for report-dispatch view |
| `GetAllLabTests` | GET | `api/Lab/LabTests` | Full test list |
| `GetSpecimen` | GET | `api/Lab/Requisition/LabSpecimen` | Specimen for a requisition |
| `RequisitionsByRequisitionIds` | GET | `api/Lab/RequisitionsByRequisitionIds` | Bulk requisition fetch |
| `GetReqiusitionsForExternalLab` | GET | `api/Lab/RequisitionsForExternalLab` | External-lab send-out list |
| `RequisitionsSentToExternalLab` | GET | `api/Lab/RequisitionsSentToExternalLab` | Requisitions currently at external vendors (last 30 days) |
| `GetLabCategories` | GET | `api/Lab/LabCategories` | All lab categories |
| `GetLabTypes` | GET | `api/Lab/LabTypes` | Active lab types |
| `LabSpecimentList` | GET | `api/Lab/LabSpecimens` | Specimen master list |
| `GetSampleCollectedRequisitions` | GET | `api/Lab/SampleCollectedRequisitions` | Samples collected in date range |
| `GetCovidResults` | GET | `api/Lab/Notification/CovidResults` | SMS-applicable COVID test results |
| `GetCovidSmsText` | GET | `api/Lab/Notification/CovidSmsText` | Composed SMS body for a requisition |
| `PostComponentResults` | POST | `api/Lab/ComponentResults` | Add new component results (result entry) |
| `PostRequisitions` | POST | `api/Lab/Requisitions` | Create new lab requisitions (from doctor orders) |
| `LabReportAdd` | POST | `api/Lab/LabReport` | Create `LAB_TXN_LabReports` |
| `PostSms` | POST | `api/Lab/Notification/Sms` | Send SMS to patient |
| `UploadCovidReportToGoogleDrive` | POST | `api/Lab/Notification/UploadCovidReportToGoogleDrive` | Upload COVID report PDF to Google Drive |
| `GenerateSampleCodeAutomatic` | PUT | `api/Lab/GenerateSampleCodeAutomatic` | Auto-assign next sample code |
| `LabStickerHtml` | POST | `api/Lab/LabStickerHtml` | Save lab sticker (barcode) print HTML |
| `EmailLabReport` | POST | `api/Lab/EmailLabReport` | Email report to patient |
| `updateFileUploadStatus` | PUT | `api/Lab/updateFileUploadStatus` | Mark file uploaded to telemedicine |
| `GenerateSampleCodeManual` | PUT | `api/Lab/GenerateSampleCodeManual` | Manual sample code assignment |
| `UpdateSampleCodeFromViewReport` | PUT | `api/Lab/Report/UpdateSampleCode` | Edit sample code from view-report screen |
| `UpdateBillStatus` | PUT | `api/Lab/Requisition/BillStatus` | Update `BillingStatus` on requisition |
| `PutComponentResults` | PUT | `api/Lab/ComponentResults` | Edit existing component results |
| `UpdateLabReport` | PUT | `api/Lab/UpdateLabReport` | Update report header/signatories/comments |
| `UpdatePrintCount` | PUT | `api/Lab/Report/PrintCount` | Bump print count, mark printed |
| `UpdateDoctorInLabRequisition` | PUT | `api/Lab/UpdateDoctorInLabRequisition` | Change prescriber on requisition |
| `UpdateDoctorInLabReport` | PUT | `api/Lab/UpdateDoctorInLabReport` | Change prescriber on printed report |
| `ChangeLabTestWithSamePrice` | PUT | `api/Lab/ChangeLabTestWithSamePrice` | Swap test to a same-price alternative |
| `CancelInpatientLabTest` | PUT | `api/Lab/CancelInpatientLabTest` | Cancel an inpatient test |
| `UpdateLabSpecimen` | PUT | `api/Lab/Requisition/LabSpecimen` | Update specimen name |
| `UndoSampleCode` | PUT | `api/Lab/UndoSampleCode` | Reverse a sample-code assignment |
| `VerifyTestResultWithSignatory` | PUT | `api/Lab/VerifyTestResultWithSignatory` | Verify + set signatory |
| `VerifyTestResultWithoutSignatory` | PUT | `api/Lab/VerifyTestResultWithoutSignatory` | Direct verify (no signatory change) |
| `UpdateVendorInLabRequisition` | PUT | `api/Lab/Requisition/Vendor` | Reassign resulting vendor |
| `TransferToLab` | PUT | `api/Lab/Requisition/ChangeLabType` | Move requisition to another lab type |
| `UpdateExternalLabStatus` | PUT | `api/Lab/ExternalLabStatus` | Set `ExternalLabSampleStatus` (pending/sent/received/completed) |
| `AddNewRequsition` (private) | – | – | Creates requisitions in a transaction; links to billing row |
| `LabReportAdd` (private) | – | – | Creates `LabReportModel` + copies prescriber/sig/comment |
| `UpdateSampleCode` (private) | – | – | Computes next sample code per `Lab_MST_RunNumberSettings` rules |
| `VerifyTestResultWithSignatory` (private) | – | – | Verifies, signs, sets `IsVerified`, `VerifiedBy`, `VerifiedOn` |
| `EditComponentsResults` (private) | – | – | Diff-and-merge client components against DB |

### 2.5 LabSettingController

| Method | HTTP | Route | Purpose |
|--------|------|-------|---------|
| `ReportTemplates` | GET | `api/LabSettings/ReportTemplates` | All report templates |
| `LabTests` | GET | `api/LabSettings/LabTests` | Lab tests with components, categories, billing linkage |
| `LabVendors` | GET | `api/LabSettings/LabVendors` | All vendors |
| `LabSignatories` | GET | `api/LabSettings/LabSignatories` | Config signatories + doctors in lab/pathology dept |
| `LabTestComponents` | GET | `api/LabSettings/LabTestComponents` | All component master entries |
| `LabLookupList` | GET | `api/LabSettings/LabLookupList` | `CORE_CFG_LookUps` filtered to `ModuleName = 'lab'` |
| `LabGovReportingItems` | GET | `api/LabSettings/LabGovReportingItems` | Government reportable items |
| `LabGovReportMappingDetail` | GET | `api/LabSettings/LabGovReportMappingDetail` | Joined test/component → gov-item mapping |
| `GetOutsourceApplicableLabTests` | GET | `api/LabSettings/OutsourceApplicableLabTests` | Tests flagged `IsOutsourceTest` |
| `PostLabReportTemplate` | POST | `api/LabSettings/LabReportTemplate` | Add template (handles default-toggle) |
| `PostLabTest` | POST | `api/LabSettings/LabTest` | Add test + auto-create `BIL_MST_ServiceItem` row + component map |
| `PostLabComponentsInBulk` | POST | `api/LabSettings/LabComponentsInBulk` | Bulk-add components |
| `PostLabLookup` | POST | `api/LabSettings/LabLookup` | Add lookup |
| `PostLabVendor` | POST | `api/LabSettings/LabVendor` | Add vendor |
| `PostLabCategory` | POST | `api/LabSettings/LabCategory` | Add category + auto-create RBAC permission |
| `PostLabSpecimen` | POST | `api/LabSettings/LabSpecimen` | Add specimen name |
| `PostGovReportMapping` | POST | `api/LabSettings/GovReportMapping` | Map test/component to gov-item |
| `PutLabReportTemplate` | PUT | `api/LabSettings/LabReportTemplate` | Edit template |
| `PutLabTest` | PUT | `api/LabSettings/LabTest` | Edit test + sync billing item |
| `PutLabDefaultSignatories` | PUT | `api/LabSettings/LabDefaultSignatories` | Set default signatory employee IDs in `CORE_CFG_Parameters` |
| `PutLabComponentsInBulk` | PUT | `api/LabSettings/LabComponentsInBulk` | Edit components in bulk |
| `PutLabLookup` | PUT | `api/LabSettings/LabLookup` | Edit lookup |
| `PutLabVendor` | PUT | `api/LabSettings/LabVendor` | Edit vendor |
| `PutLabCategory` | PUT | `api/LabSettings/LabCategory` | Edit category |
| `PutGovReportMapping` | PUT | `api/LabSettings/GovReportMapping` | Edit gov mapping |
| `PutLabTestActiveStatus` | PUT | `api/LabSettings/LabTestActiveStatus` | Toggle `IsActive` on test |
| `PutLabCategoryActiveStatus` | PUT | `api/LabSettings/LabCategoryActiveStatus` | Toggle `IsActive` on category |
| `PutLabReportTemplateActiveStatus` | PUT | `api/LabSettings/LabReportTemplateActiveStatus` | Toggle `IsActive` on template |
| `PutLabVendorActiveStatus` | PUT | `api/LabSettings/LabVendorActiveStatus` | Toggle `IsActive` on vendor |

### 2.6 LISController

| Method | HTTP | Route | Purpose |
|--------|------|-------|---------|
| `GetAllLISMasterData` | GET | `api/LIS/GetAllLISMasterData` | Master data of all LIS machines + components |
| `GetAllMappedData` | GET | `api/LIS/GetAllMappedData` | Already-mapped LIS components |
| `GetAllNotMappedDataByMachineId` | GET | `api/LIS/GetAllNotMappedDataByMachineId` | Internal components not yet mapped to a machine |
| `GetExistingMappingById` | GET | `api/LIS/GetExistingMappingById` | Single mapping row |
| `GetAllMachineResult` | GET | `api/LIS/GetAllMachineResult` | Results from one machine in date range |
| `GetAllMachines` | GET | `api/LIS/GetAllMachines` | All registered LIS machines |
| `GetMachineResultByBarcodeNumber` | GET | `api/LIS/GetResultByBarcodeNumber` | Machine results filtered by barcode |
| `AddUpdateNewMapping` | POST | `api/LIS/AddUpdateNewMapping` | Bulk create/update LIS component mapping |
| `AddLisDataToResult` | POST | `api/LIS/AddLisDataToResult` | Commit machine results into `LAB_TXN_TestComponentResult` |
| `AddMachineOrder` | POST | `api/LIS/MachineOrder` | Push test order to LIS for analyzer |
| `UpdateMachineResultSyncStatus` | PUT | `api/LIS/MachineResultSyncStatus` | Mark machine result IDs as synced |
| `RemoveMapping` | DELETE | `api/LIS/RemoveMapping` | Soft-delete a LIS component mapping |

### 2.7 IMUController

| Method | HTTP | Route | Purpose |
|--------|------|-------|---------|
| `GetAllImuTestList` | GET | `api/IMU/GetAllImuTestList` | All IMU-submitted tests in date range |
| `PostDataToIMU` | POST | `api/IMU/PostDataToIMU` | Push selected requisition IDs to IMU middleware |

### 2.8 LabReportExportController (legacy DOCX export)

| Method | HTTP | Route | Purpose |
|--------|------|-------|---------|
| `GetTemplateDetails` | GET | `api/LabReportExport/GetTemplateDetails` | Generate Word document for a single template |
| `GetAllTemplateDetailswithprintId` | GET | `api/LabReportExport/GetAllTemplateDetailswithprintId` | Generate combined Word document for a printed report |

The class itself is not `[Route]`-decorated; ASP.NET Core resolves actions by name (`api/LabReportExportController/GetTemplateDetails?templateId=...`). The `LabReportExport.cs` helper uses `DocumentFormat.OpenXml` to merge patient data into a `.docx` template.

### 2.9 LabViewController (MVC, legacy)

Provides the older `.cshtml` shim pages (mostly unused by the Angular SPA, retained for compatibility):
- `LabMain` → `Lab/LabMain`
- `ListLabRequisition` → `Lab/Requisition`
- `PendingLabResults` → `Lab/PendingLabResults`
- `SelectLabTests` → `SelectLabTests`
- `CollectSampleLabTests` → `Lab/CollectSample`
- `AddResult` → `Lab/AddResult`
- `PatientTemplateList` → `Lab/PatientTemplateList`
- `ListPatientReport` → `Lab/ListPatientReport`
- `ViewAllReport` → `Lab/ViewAllReport`
- `LabSettingsMain` → guarded by `[DanpheViewFilter("lab-settings-view")]`

### 2.10 LabsBL.cs (Static Helpers)

- `GetLabReportVMForReqIds(LabDbContext, List<Int64> reqIdList, string covidFileUrl)` — Entry point; returns a fully formatted `LabReportVM` ready for printing
- `GetResultsDenormalized(...)` — Joins `Requisitions`, `Patients`, `LabTests`, `LabReportTemplates`, `Employee`, `LabTestComponentResults`, `LabReports` into flat `LabResult_Denormalized_VM` rows
- `FormatResultsForLabReportVM(...)` — Groups denormalized rows by template, builds `LabReportVM.Lookups` and `LabReportVM.Templates`
- `GetTemplateVM(...)` — Unique templates with their tests
- `GetTestsOfTemplate(...)` — Tests for a single template (grouped by `RequisitionId`, ordered by display sequence)
- `GetResulsOfTestRequisition(...)` — Component results for a single requisition
- `getProfilePicture(...)` — Reads patient profile pic, returns base64

---

## 3. Data Models

### 3.1 LabTestModel (`LAB_LabTests`)

Master record for a single test (e.g. "CBC", "Lipid Profile", "Blood Culture").

| Property | Type | Notes |
|----------|------|-------|
| `LabTestId` | Int64 (PK) | Auto-generated |
| `LabTestCode` | string | Auto-set to `L-000001` if blank |
| `LabSequence` | int | Display order |
| `ProcedureCode` | string | Set to `LAB-000001` on insert; used for billing |
| `LabTestName` | string | Display name |
| `LabTestSynonym` | string | Alternate name |
| `LabTestSpecimen` | string | e.g. "Blood", "Urine" |
| `LabTestSpecimenSource` | string | e.g. "Venous" |
| `LOINC` | string | LOINC code |
| `ReportTemplateId` | int | FK → `Lab_ReportTemplate` |
| `IsValidForReporting` | bool | Show on reports? |
| `Description` | string | Long description |
| `DisplaySequence` | int? | UI sort order |
| `RunNumberType` | string | `normal` / `histo` / `cyto` |
| `HasNegativeResults` | bool | Toggles between positive & negative templates |
| `NegativeResultText` | string | Shown when result is negative |
| `LabTestCategoryId` | int | FK → `LAB_TestCategory` |
| `SmsApplicable` | bool | Eligible for COVID-style SMS notification |
| `ReportingName` | string | Alternate name on report |
| `Interpretation` | string | Free-text clinical interpretation |
| `IsOutsourceTest` | bool? | Send to external vendor? |
| `DefaultOutsourceVendorId` | int? | FK → `Lab_MST_LabVendors` |
| `IsLISApplicable` | bool | Routed to LIS machine? |
| `IsActive` | bool | Soft-delete flag |

NotMapped: `IsSelected`, `IsPreference`, `IsTaxApplicable`, `LabTestComponentsJSON`, `LabTestComponentMap`, `ServiceDepartmentId`, `TemplateType`, `MyProperty`.

### 3.2 LabRequisitionModel (`LAB_TestRequisition`)

A single test ordered for a patient visit. One requisition per test; multiple requisitions can share a sample code (collected together).

| Property | Type | Notes |
|----------|------|-------|
| `RequisitionId` | Int64 (PK) | |
| `PatientVisitId` | int? | Nullable (walk-in lab possible) |
| `PatientId` | int | FK → `PAT_Patient` |
| `PrescriberId` | int? | FK → `EMP_Employee` |
| `LabTestId` | Int64 | FK → `LAB_LabTests` |
| `ProcedureCode` | string | Copied from test |
| `LOINC` | string | Copied from test |
| `LabTestName` / `LabTestSpecimen` / `LabTestSpecimenSource` | string | Denormalized for list performance |
| `PatientName` | string | Denormalized |
| `Diagnosis` | string | Free text from orderer |
| `Urgency` | string | `routine` / `urgent` / `stat` |
| `OrderDateTime` | DateTime | |
| `PrescriberName` | string | Denormalized |
| `BillingStatus` | string | `paid` / `unpaid` / `provisional` / `cancel` / `returned` |
| `OrderStatus` | string | `active` / `pending` / `result-added` / `report-generated` |
| `SampleCode` | int? | Sequential, reset per `Lab_MST_RunNumberSettings` |
| `SampleCodeFormatted` | string | e.g. `S-001-2024` |
| `RequisitionRemarks` | string | |
| `SampleCreatedOn` / `SampleCollectedOnDateTime` | DateTime? | |
| `SampleCreatedBy` | int? | FK → `EMP_Employee` |
| `Comments` | string | |
| `RunNumberType` | string | |
| `ExternalLabSampleStatus` | string | `pending` / `sent` / `received` / `completed` |
| `IsSmsSend` | bool | |
| `ReportTemplateId` | int | FK → `Lab_ReportTemplate` |
| `DiagnosisId` | int? | FK → clinical diagnosis |
| `VisitType` | string | `inpatient` / `outpatient` / `emergency` |
| `LabReportId` | int? | FK → `LAB_TXN_LabReports` |
| `BarCodeNumber` | Int64? | FK → `LAB_BarCode` |
| `WardName` | string | For inpatients |
| `IsVerified` / `VerifiedOn` / `VerifiedBy` | bool? / DateTime? / int? | |
| `ResultingVendorId` | int | FK → `Lab_MST_LabVendors` (in-house = default vendor) |
| `HasInsurance` | bool | |
| `ResultAddedBy` / `ResultAddedOn` | int? / DateTime? | |
| `PrintedBy` / `PrintCount` | int? / int? | |
| `LabTypeName` | string | e.g. "lab", "histo", "cyto" |
| `GoogleFileIdForCovid` / `CovidFileName` / `IsFileUploaded` / `UploadedBy` / `UploadedOn` | | COVID PDF to Drive |
| `IsFileUploadedToTeleMedicine` / `UploadedByToTeleMedicine` / `UploadedOnToTeleMedicine` | | Telemedicine upload tracking |
| `IsUploadedToIMU` / `IMUUploadedOn` / `IMUUploadedBy` | | IMU integration tracking |
| `BillingTransactionItemId` | int | FK → `BIL_TXN_BillingTransactionItems` |
| `ServiceItemId` | int | FK → `BIL_MST_ServiceItem` |

### 3.3 LabReportModel (`LAB_TXN_LabReports`)

The final report header, one row per printed report.

| Property | Type | Notes |
|----------|------|-------|
| `LabReportId` | int (PK) | |
| `PatientId` | int | |
| `TemplateId` | int? | |
| `ReceivingDate` | DateTime | |
| `ReportingDate` | DateTime | |
| `IsPrinted` | bool | |
| `Signatories` | string | Comma-separated employee IDs |
| `Comments` | string | |
| `PrescriberName` | string | Copied at report time (denormalized for legal correctness) |
| `CreatedBy` / `CreatedOn` / `IsActive` | | |
| `ModifiedBy` / `ModifiedOn` | | |
| `PrintedOn` / `PrintedBy` / `PrintCount` | | |

NotMapped: `ComponentIdList`, `ValidToPrint`, `VerificationEnabled`, `CovidFileUrl`.

### 3.4 LabTestComponentResult (`LAB_TXN_TestComponentResult`)

One row per analyte result for a requisition. Multiple rows per requisition possible (one per component).

| Property | Type | Notes |
|----------|------|-------|
| `TestComponentResultId` | Int64 (PK) | |
| `RequisitionId` | Int64 | FK → requisition |
| `LabTestId` | Int64 | FK → test |
| `ComponentId` | int | FK → component master |
| `Value` | string | Numeric or text result |
| `Unit` | string | Denormalized from component |
| `Range` | string | Denormalized from component (per gender/age) |
| `RangeDescription` | string | e.g. "Normal", "Borderline" |
| `ComponentName` | string | Denormalized |
| `Method` | string | e.g. "ELISA", "Hexokinase" |
| `TemplateId` | int | Denormalized |
| `Remarks` | string | |
| `IsAbnormal` | bool | Computed at entry time |
| `AbnormalType` | string | `high` / `low` / `absent` / `present` / `positive` / `negative` |
| `IsNegativeResult` | bool | |
| `NegativeResultText` | string | |
| `IsActive` | bool | Soft delete (keeps history) |
| `ResultGroup` | int? | For culture/anti-culture: primary (1) vs. sensitivity (2+) rows |
| `LabReportId` | int? | FK → `LAB_TXN_LabReports` |

### 3.5 LabReportTemplateModel (`Lab_ReportTemplate`)

| Property | Type | Notes |
|----------|------|-------|
| `ReportTemplateID` | int (PK) | |
| `ReportTemplateShortName` | string | e.g. "CBC-AUTO" |
| `ReportTemplateName` | string | Display name |
| `TemplateFileName` | string | Path to `.docx` template |
| `NegativeTemplateFileName` | string | Used when `HasNegativeResults` is true |
| `IsDefault` | bool | Fallback when no test-specific template |
| `IsActive` | bool | |
| `HeaderText` / `FooterText` | string | Custom header/footer |
| `ColSettingsJSON` | string | Column visibility config |
| `TemplateType` | string | `normal` / `culture` / `html` / `histo` / `cyto` |
| `TemplateHTML` | string | For `html` type: raw HTML body |
| `Description` / `DisplaySequence` | string / int | |

### 3.6 LabTestCategoryModel (`LAB_TestCategory`)

| Property | Type | Notes |
|----------|------|-------|
| `TestCategoryId` | int (PK) | |
| `TestCategoryName` | string | e.g. "Hematology", "Biochemistry" |
| `IsDefault` | bool | |
| `PermissionId` | int | Auto-created RBAC permission for the category |
| `IsActive` | bool | |

### 3.7 LabVendorsModel (`Lab_MST_LabVendors`)

| Property | Type | Notes |
|----------|------|-------|
| `LabVendorId` | int (PK) | |
| `VendorCode` | string | |
| `VendorName` | string | |
| `IsExternal` | bool | External vs. in-house (default vendor) |
| `ContactAddress` / `ContactNo` / `Email` / `Remarks` | string | |
| `IsDefault` | bool | Exactly one row has this true; the "in-house" lab |
| `IsActive` | bool | |

### 3.8 LabTypesModel (`MST_LabTypes`)

| Property | Type | Notes |
|----------|------|-------|
| `LabTypeId` | int (PK) | |
| `LabTypeName` | string | e.g. "lab", "histo", "cyto" |
| `DisplayName` | string | UI label |
| `IsDefault` / `IsActive` | bool | |

### 3.9 LabTestSpecimenModel (`LAB_MST_TestSpecimen`)

| Property | Type | Notes |
|----------|------|-------|
| `SpecimenId` | int (PK) | |
| `SpecimenName` | string | |

A separate `LabTestSpecimenModel` class with `RequisitionId`/`Specimen` is used for incoming updates.

### 3.10 LabTestComponentMapModel (`Lab_MAP_TestComponents`)

Many-to-many between tests and components with display metadata.

| Property | Type | Notes |
|----------|------|-------|
| `ComponentMapId` | int (PK) | |
| `LabTestId` | Int64 | FK → test |
| `ComponentId` | int | FK → component |
| `DisplaySequence` | int | |
| `IsActive` | bool | Soft-delete (component removed from test) |
| `GroupName` | string | Sub-grouping label on the report |
| `IndentationCount` | int | Visual indent level |
| `ShowInSheet` | bool | |
| `IsAutoCalculate` | bool | Triggers formula evaluation |
| `CalculationFormula` | string | e.g. "WBC * RBC" |
| `FormulaDescription` | string | |

### 3.11 LabTestJSONComponentModel (`Lab_MST_Components`)

The component (analyte) master.

| Property | Type | Notes |
|----------|------|-------|
| `ComponentId` | int (PK) | |
| `ComponentName` | string | e.g. "Hemoglobin" |
| `DisplayName` | string | |
| `Unit` | string | e.g. "g/dL" |
| `ValueType` | string | `numeric` / `text` / `dropdown` |
| `ControlType` | string | `textbox` / `dropdown` / `label` (label = header) |
| `Range` | string | Default range |
| `MaleRange` / `FemaleRange` / `ChildRange` | string | Gender/age-specific |
| `RangeDescription` | string | |
| `Method` | string | |
| `ValueLookup` | string | JSON array of dropdown options |
| `MinValue` / `MaxValue` | double? | For numeric validation |
| `Method` | string | Analytical method |

### 3.12 LabBarCodeModel (`LAB_BarCode`)

| Property | Type | Notes |
|----------|------|-------|
| `BarCodeNumber` | Int64 (PK) | Logical ID (sequence) |
| `BarCodeId` | int (DB-identity) | Physical identity |
| `CreatedBy` / `CreatedOn` | | |
| `IsActive` | bool | |

### 3.13 LabRunNumberSettingsModel (`Lab_MST_RunNumberSettings`)

Per-(lab type, visit type, run number type, insurance) sample-code formatting rule.

| Property | Type | Notes |
|----------|------|-------|
| `RunNumberFormatId` | int (PK) | |
| `RunNumberFormatName` | string | |
| `RunNumberGroupingIndex` | int | |
| `VisitType` | string | `inpatient` / `outpatient` / `emergency` |
| `RunNumberType` | string | `normal` / `histo` / `cyto` |
| `ResetDaily` / `ResetMonthly` / `ResetYearly` | bool | Counter reset mode |
| `StartingLetter` | string | e.g. "S" prefix |
| `FormatInitialPart` | string | `num` / `yy` / `mm` / `dd` |
| `FormatSeparator` | string | `-` / `/` |
| `FormatLastPart` | string | `num` / `yy` / `mm` / `dd` |
| `UnderInsurance` | bool | Separate counter for insured patients? |
| `LabTypeId` / `LabTypeName` | int / string | |

### 3.14 LabGovReportItemModel (`Lab_Mst_Gov_Report_Items`)

Government-reportable items (e.g. "HIV-1 Positive", "TB Smear Positive").

| Property | Type | Notes |
|----------|------|-------|
| `ReportItemId` | int (PK) | |
| `SerialNumber` | int | |
| `TestName` | string | |
| `GroupName` | string | |
| `DisplayName` | string | |
| `HasInnerItems` | bool | Nested groups? |
| `InnerTestGroupName` | string | |
| `IsActive` | bool | |

### 3.15 LabGovReportMappingModel (`Lab_Gov_Report_Mapping`)

Maps internal tests/components to gov-reportable items.

| Property | Type | Notes |
|----------|------|-------|
| `ReportMapId` | int (PK) | |
| `ReportItemId` | int | FK → `Lab_Mst_Gov_Report_Items` |
| `LabItemId` | Int64 | FK → test |
| `IsComponentBased` | bool | |
| `ComponentId` | int? | FK → component (if `IsComponentBased`) |
| `IsResultCount` | bool | Count positives in a date range? |
| `PositiveIndicator` | string | Value/keyword that flags a result as positive |
| `IsActive` | bool | |

### 3.16 Other Models

- `LabSMSModel` (`LAB_Sms`) — `SmsId`, `RequisitionId`, `Message`, `CreatedBy`, `CreatedOn`
- `LabEmailModel` — DTO for email dispatch (subject, html content, pdf base64, image attachments)
- `AttachmentModel` — DTO: `ImageBase64`, `ImageName`, `pdfBase64`
- `VerifiedByModel` — DTO: `VerifiedBy`, `VerifiedOn`
- `VerificationCoreCFGModel` — DTO: `EnableVerificationStep`, `VerificationLevel`, `ShowVerifierSignature`, `PreliminaryReportText`
- `LabSelectionVM` — DTO: `LabTypeId`, `LabTypeName`, `PermName`
- `LabSignatoriesViewModel` — DTO: `AllSignatories`, `AllDoctors`
- `LabPrintReportView` / `TestComponent` — DTOs for legacy print view
- `LabTestListWithVendor` — DTO: `RequisitionId`, `PatientName`, `TestName`, `VendorName`
- `LISSyncedComponentDetail` — DTO: `LISComponentResultId`, `SyncStatus`, `CreatedBy`, `CreatedOn`
- `ExternalLabStatusUpdate_DTO` — DTO: `SelectedExternalLabStatusType`, `RequisitionIds`
- `InpatientLabTestModel` — DTO combining requisition + service-dept info for the inpatient grid
- `LabMasterModel` / `Requisition` / `LabSampleVM` — top-level patient lab data DTOs used by the "all-data-by-patient" endpoint
- `LabReportTemplateInfoModel` / `LabTestCategoryModel` / `lab-government-items.model.ts` (Angular) — TS mirrors of the above

---

## 4. Database Tables

All tables touched by the Lab module (resolved from `LabDbContext.OnModelCreating`):

| Table | Model | Notes |
|-------|-------|-------|
| `LAB_LabTests` | `LabTestModel` | Test master |
| `LAB_TestRequisition` | `LabRequisitionModel` | Per-test order |
| `LAB_TXN_TestComponentResult` | `LabTestComponentResult` | Per-analyte result |
| `LAB_TXN_LabReports` | `LabReportModel` | Final report header |
| `Lab_ReportTemplate` | `LabReportTemplateModel` | Report template |
| `Lab_MAP_TestComponents` | `LabTestComponentMapModel` | Test ↔ component map |
| `Lab_MST_Components` | `LabTestJSONComponentModel` | Component master |
| `Lab_MST_LabVendors` | `LabVendorsModel` | Vendors (in-house + external) |
| `Lab_MST_RunNumberSettings` | `LabRunNumberSettingsModel` | Sample-code formatting |
| `LAB_TestCategory` | `LabTestCategoryModel` | Categories |
| `LAB_MST_TestSpecimen` | `LabTestMasterSpecimen` | Specimens |
| `MST_LabTypes` | `LabTypesModel` | Lab-type switcher |
| `LAB_BarCode` | `LabBarCodeModel` | Barcode sequence |
| `LAB_Sms` | `LabSMSModel` | Outgoing SMS log |
| `Lab_Mst_Gov_Report_Items` | `LabGovReportItemModel` | Gov-reportable items |
| `Lab_Gov_Report_Mapping` | `LabGovReportMappingModel` | Test/component → gov item |
| `CORE_CFG_Parameters` | `AdminParametersModel` | Lab-config flags (verification, signatories, COVID path) |
| `CORE_CFG_LookUps` | `CoreCFGLookupModel` | Lab lookup values (sensitivity drug lists, organism lists, etc.) |
| `BIL_MST_ServiceItem` | `BillServiceItemModel` | Joined: every test has a billing row |
| `BIL_TXN_BillingTransactionItems` | `BillingTransactionItemModel` | Joined: per-test billing line |
| `BIL_MST_ServiceDepartment` | `ServiceDepartmentModel` | Service dept linkage |
| `PAT_Patient` | `PatientModel` | Patient header |
| `PAT_PatientVisits` | `VisitModel` | Visit |
| `PAT_PatientFiles` | `PatientFilesModel` | Profile pic |
| `ADT_PatientAdmission` | `AdmissionModel` | Inpatient admission |
| `EMP_Employee` | `EmployeeModel` | Prescriber / verifier / sample-collector |
| `EMP_EmployeePreferences` | `EmployeePreferences` | |
| `MST_Department` | `DepartmentModel` | |
| `MST_CountrySubDivision` | `CountrySubDivisionModel` | |
| `MST_Municipality` | `MunicipalityModel` | |

LIS-specific tables (in `LISDbContext`):
- `LIS_ComponentMap` — Maps a `LISComponentMasterId` (analyzer side) to internal `ComponentId` with a `ConversionFactor`
- `LIS_SyncedComponentDetail` — Audit trail of which `LISComponentResultId` was synced
- `LIS_ComponentResult` (or similar) — Staging table for analyzer results

Stored procedures referenced by LabController:
- `SP_LAB_GetPatientListForReportDispatch` — Patient list for report-dispatch
- `SP_LAB_GetPatAndReportInfoForFinalReport` — Final-report patient list
- `SP_LAB_GetSamplesCollectedInfo` — Daily collected-sample info
- `SP_LAB_GetAllSmsApplicableTests` — SMS-applicable COVID results
- `SP_LAB_GetAllLabRequisitionForExternalLab` — External-lab requisition list
- `SP_Bill_OrderStatusUpdate` — Used in `AddLISDataToDanphe` to mark billing final

---

## 5. Key Workflows

### 5.1 Test Order Entry (Doctor → Lab)

1. Doctor opens "Add Lab Order" inside a patient visit.
2. Frontend calls `GET /api/LabSettings/LabTests` to render the catalog.
3. Doctor selects tests → frontend POSTs a list of `{PatientId, PatientVisitId, PrescriberId, LabTestId, ...}` to `POST /api/Lab/Requisitions`.
4. `AddNewRequsition` (LabController private method, around line 3726) runs in a transaction:
   - Inserts a `LAB_TestRequisition` row per test (denormalizes `LabTestName`, `LabTestSpecimen`, `ProcedureCode`, `LOINC`)
   - Each row gets `BillingStatus = 'provisional'`, `OrderStatus = 'active'`, `ResultingVendorId = default vendor`, `ReportTemplateId` from the test
   - On success, billing side gets a corresponding `BIL_TXN_BillingTransactionItems` row
5. Frontend redirects to the requisition list or to billing.

The bill-cancel listener (in billing module) sets `BillingStatus='cancel'` and `BillCancelledBy/On` on the requisition when billing is cancelled.

### 5.2 Sample Collection

1. Technologist opens `GET /api/Lab/Requisition/SamplePending?fromDate&toDate` → list of `active`-order-status requisitions.
2. Technologist clicks "Collect Sample" on a patient → opens the collect-sample screen.
3. Frontend calls `GET /api/Lab/LatestSampleCode` to preview the next formatted sample code, and `GET /api/Lab/IsSampleCodeValid` if the user wants a manual override.
4. Technologist picks specimen, optionally edits the sample code, and clicks "Save".
5. Frontend calls `PUT /api/Lab/GenerateSampleCodeManual` (or `PUT /api/Lab/GenerateSampleCodeAutomatic` for auto-only).
6. `UpdateSampleCode` (private method) runs:
   - Resolves the matching `LabRunNumberSettingsModel` by `(RunNumberType, VisitType, UnderInsurance, LabTypeName)`
   - Computes next sequence respecting `ResetDaily` / `ResetMonthly` / `ResetYearly`
   - Formats the code via `GetSampleCodeFormatted` (e.g. `S-001-81` — using Nepali year, 2-digit, separator `-`, then numeric sequence)
   - Allocates a `BarCodeNumber` from `LAB_BarCode` table
   - Sets `OrderStatus = 'pending'`, `SampleCreatedOn`, `SampleCreatedBy`, `SampleCode`, `SampleCodeFormatted`, `BarCodeNumber`
7. Requisitions with same patient + sample date + same run number type share the sample code (so multiple tests can be drawn into one tube).

### 5.3 Result Entry

1. Technologist opens `GET /api/Lab/Result/Pending?fromDate&toDate&categoryIdList` → list of `pending`-order-status requisitions grouped by sample code, with templates.
2. For each requisition, frontend calls `GET /api/Lab/LabDataByBarcodeNumber` or fetches the test's component schema.
3. Technologist enters results per component; the form validates against `MinValue`/`MaxValue` and `ValueLookup`.
4. On save, frontend calls `POST /api/Lab/ComponentResults` with payload `{ specimanData: ..., componentList: [...] }`.
5. `AddComponents` (private) creates a `LabTestComponentResult` row per component, computes `IsAbnormal` by comparing `Value` to `Range` (using gender/age-specific range if applicable), and sets `AbnormalType` (`high`/`low`/`absent`/`present`).
6. Sets requisition `OrderStatus = 'result-added'`, `ResultAddedBy`, `ResultAddedOn`.
7. For culture/anti-culture workflow:
   - First panel: organism identification (`ResultGroup = 1`)
   - Second panel: sensitivity results (`ResultGroup = 2+`) with one row per drug-organism combination
   - Lookup values come from `CORE_CFG_LookUps` where `ModuleName = 'lab'`

### 5.4 Result Edit

1. Frontend calls `PUT /api/Lab/ComponentResults` with `{ specimanData, componentList, requisitionId }`.
2. `EditComponentsResults` (private) does a 3-way diff:
   - **Newly added** (client `TestComponentResultId == 0`) → `Add` to context
   - **Updated** (client `TestComponentResultId != 0`) → update value, range, rangeDescription, remarks, abnormal flag, result group
   - **Deleted** (DB row not in client) → set `IsActive = false` (soft delete)
3. If the template changed (`TemplateId` on first result differs from requisition), calls `UpdateReportTemplateId` to persist.

### 5.5 Verification (Optional, Two-Level)

Controlled by `CORE_CFG_Parameters` row:
- `ParameterGroupName = 'lab'`, `ParameterName = 'LabReportVerificationNeededB4Print'`
- Value is a JSON `VerificationCoreCFGModel`:
  - `EnableVerificationStep`: bool
  - `VerificationLevel`: 1 (single) or 2 (pathologist co-sign)
  - `ShowVerifierSignature`: bool
  - `PreliminaryReportText`: shown on unverified reports

Flow:
1. After result entry, the report appears in `GET /api/Lab/Report/Pending` with `OrderStatus = 'result-added'`.
2. Verifier opens the report and clicks "Verify".
3. Frontend calls `PUT /api/Lab/VerifyTestResultWithSignatory` (with signatory list) or `PUT /api/Lab/VerifyTestResultWithoutSignatory` (no signatory).
4. Controller sets `IsVerified = true`, `VerifiedBy = currentUser.EmployeeId`, `VerifiedOn = now`, writes signatories to `LAB_TXN_LabReports.Signatories` if used.
5. Reports are excluded from the final dispatch list while `verificationRequired && !IsVerified`.

### 5.6 Report Generation

1. After verification, technologist calls `GET /api/Lab/LabReportByRequisitionIds?requisitionIdList=[...]` to get a fully formatted `LabReportVM`.
2. `GetLabReportVMForReqIds` (LabsBL) does the heavy lifting:
   - `GetResultsDenormalized` flattens requisition+result+test+template+report
   - `FormatResultsForLabReportVM` groups by template-type, builds `LabReportVM.Lookups` (patient header) and `Templates` (one per template type)
   - `GetTemplateVM` for each unique template, calls `GetTestsOfTemplate` to attach tests
   - Each test gets its `ComponentJSON` (re-fetched to get latest ranges/methods) and `Components` (filtered by requisitionId)
3. Returns a printable VM. If the test has `HasNegativeResults = true` and the result is negative, switches to the `NegativeTemplateFileName` template.
4. User can save the report by calling `POST /api/Lab/LabReport` (creates `LAB_TXN_LabReports` row) or update by `PUT /api/Lab/UpdateLabReport`.
5. Sets requisition `OrderStatus = 'report-generated'` and `LabReportId`.

### 5.7 Report Print + Dispatch

1. `GET /api/Lab/Report/Finalized?fromDate&toDate&patientId` returns the dispatch list.
2. On print: `PUT /api/Lab/Report/PrintCount?requisitionIdList=...&reportId=...` bumps `PrintCount`, sets `PrintedBy`, `PrintedOn`, and marks `IsPrinted = true` on the report.
3. Print gating: `ValidatePrintOption(allowOutPatWithProv, visitType, billingStatus)`:
   - Inpatient: always printable (even provisional)
   - Outpatient with `allowOutPatWithProv`: paid, unpaid, or provisional all OK
   - Outpatient without: paid, unpaid, OR emergency visit only

### 5.8 Report Email

1. Frontend calls `POST /api/Lab/EmailLabReport` with payload `{ EmailAddress, Subject, HtmlContent, PdfBase64, AttachmentFileName, ImageAttachments, SenderEmailAddress, SenderTitle, SendPdf, SendHtml, EmailList }`.
2. `SendLabReportEmailToPatient` calls `IEmailService.SendEmail`.
3. Returns success/fail.

### 5.9 SMS Notification (COVID-19)

1. `GET /api/Lab/Notification/CovidResults?fromDate&toDate` calls `LabDbContext.GetCovidTestResults` → `SP_LAB_GetAllSmsApplicableTests` → returns rows where `LabTest.SmsApplicable = true`.
2. For each positive/negative result, frontend calls `GET /api/Lab/Notification/CovidSmsText?requisitionId=...` → `GetSmsMessageAndNumberOfPatientByReqId` composes:
   ```
   Dear {PatientName}, Your COVID-19 Report is {Result}.
   Sample collected on {Date}
   {CovidFileUrl if uploaded}
   ```
3. `POST /api/Lab/Notification/Sms` sends the SMS and writes a `LAB_Sms` row.
4. `POST /api/Lab/Notification/UploadCovidReportToGoogleDrive` uploads the PDF to Google Drive and stores `GoogleFileIdForCovid`, `IsFileUploaded`, `UploadedBy`, `UploadedOn` on the requisition.

### 5.10 External Lab (Send-Out)

1. Test flagged `IsOutsourceTest = true` in `LAB_LabTests`.
2. Requisition can be assigned to a vendor via `PUT /api/Lab/Requisition/Vendor?vendorId=...`.
3. `GET /api/Lab/RequisitionsForExternalLab` lists all sent-out requisitions with filters.
4. `PUT /api/Lab/ExternalLabStatus` updates `ExternalLabSampleStatus` per requisition (`pending` → `sent` → `received` → `completed`).
5. When external lab returns results, they enter the system via the same `AddComponents` flow (manual entry) or a vendor-portal.

### 5.11 LIS (Lab Information System) Machine Integration

External LIS Web API (configured by `LISDataBaseUrl` in `MyConfiguration`) acts as middleware between analyzer machines and Danphe.

Setup phase:
1. Frontend → `GET /api/LIS/GetAllLISMasterData` → calls LIS API `GetAllMasterData` to get list of `LISComponentMasterVM` (machine-id, machine-name, component-name, model).
2. Tech creates mapping: `POST /api/LIS/AddUpdateNewMapping` with `[{LISComponentMapId, MachineId, LISComponentId, ComponentId, ConversionFactor}]` → persists to `LIS_ComponentMap`.

Result-pull phase:
1. Frontend → `GET /api/LIS/GetAllMachineResult?machineId&fromDate&toDate` → `LISService.GetMachineResults`:
   - Calls LIS API `GetMachineResultsByMachineId` to get `MachineResults` (analyzer raw values)
   - Joins with internal `Requisitions` matched on `BarCodeNumber`
   - Joins with `LIS_ComponentMap` on `MachineId + LISComponentId`
   - Joins with `LabTestComponentMap` (must be `IsActive = true`) and `LabTestComponents` (must `ControlType != 'label'`)
   - Returns `MachineResultsFormatted` (one row per barcode per test, with all components)
2. User reviews/selects components → `POST /api/LIS/AddLisDataToResult` → `LISService.AddLISDataToDanphe`:
   - Validates `OrderStatus == 'pending'` (rejects if already entered)
   - For each requisition, fills in any missing components as empty (placeholder)
   - Calls `CommonFunctions.MapMachineResultsToComponentResults` to convert VM → `LabTestComponentResult`
   - Inserts in a `TransactionScope`:
     - Add to `LAB_TXN_TestComponentResult`
     - Update `Requisitions.OrderStatus = 'result-added'`, `ResultAddedBy/On`
     - Call `SP_Bill_OrderStatusUpdate` to mark billing as final
     - Save `LIS_SyncedComponentDetail` audit
     - POST back to LIS API `SetResultSyncStatus` to flip sync flag on analyzer side
   - If anything fails, roll back the analyzer sync flag (`ResetResultSyncStatus`)

Order-push phase:
1. `POST /api/LIS/MachineOrder` with `List<Int64> reqIds` → `LISService.AddMachineOrder`:
   - Joins requisition + patient + component map + LIS map
   - Builds `LIS_Machine_Order_DTO` (barcode, machine-component-name, patient-code/name, gender, specimen, machine-id, machine-name)
   - POSTs to LIS API `MachineOrder`

Sync-status update: `PUT /api/LIS/MachineResultSyncStatus` → `LISService.UpdateMachineResultSyncStatus` → POSTs result IDs to `SetResultSyncStatus`.

### 5.12 IMU (Instrument Management Unit) Integration

IMU is a separate middleware that brokers between Danphe and analyzer software (e.g. Mindray, Abbott).

- `GET /api/IMU/GetAllImuTestList?fromDate&toDate` → list of tests already submitted to IMU
- `POST /api/IMU/PostDataToIMU` with `List<Int64> reqIds` → pushes selected requisitions to IMU, marks `IsUploadedToIMU = true`, `IMUUploadedOn`, `IMUUploadedBy`

### 5.13 Government Reporting

Used for public-health reporting (HIV, TB, COVID, etc.):

1. `GET /api/LabSettings/LabGovReportingItems` → list of gov-reportable items.
2. Admin maps tests/components to gov items: `POST /api/LabSettings/GovReportMapping` (single map) or `PUT /api/LabSettings/GovReportMapping` (edit).
3. `GET /api/LabSettings/LabGovReportMappingDetail` returns the joined view (test name, component name, positive indicator, result-count flag).
4. When reporting: filter `LAB_TXN_TestComponentResult` where value matches `PositiveIndicator` and date range, count or list by `ReportItemId`.

### 5.14 Telemedicine Upload

1. After report is final, frontend converts the report to PDF.
2. `PUT /api/Lab/updateFileUploadStatus?requisitionIdList=...` marks each requisition's `IsFileUploadedToTeleMedicine = true`, sets `UploadedByToTeleMedicine`, `UploadedOnToTeleMedicine`.
3. (The actual file upload is handled by the patient-portal sync module.)

### 5.15 Change Test (Same Price)

If a doctor wants to swap a test for a same-price alternative (e.g. typo in order):
- `PUT /api/Lab/ChangeLabTestWithSamePrice?requisitionid=...` with new test JSON
- Verifies the new test's `BillServiceItem` price matches the existing one
- Updates `LabTestId`, denormalized `LabTestName`, `ProcedureCode`, etc.

### 5.16 Inpatient Cancellation

For inpatient tests that need to be cancelled before billing is finalized:
- `PUT /api/Lab/CancelInpatientLabTest` with `{ RequisitionId, CancelRemarks, ... }`
- Sets requisition status, refunds billing line, frees the sample code slot

### 5.17 Undo Sample Code

If sample was collected in error:
- `PUT /api/Lab/UndoSampleCode` with requisition list
- Clears `SampleCode`, `SampleCodeFormatted`, `BarCodeNumber`, `SampleCreatedOn/By`
- Sets `OrderStatus = 'active'`

### 5.18 Doctor / Signatory Update

- `PUT /api/Lab/UpdateDoctorInLabRequisition` → change prescriber on a requisition
- `PUT /api/Lab/UpdateDoctorInLabReport` → change prescriber name printed on a finalized report (preserves denormalized name for legal correctness)
- `PUT /api/LabSettings/LabDefaultSignatories` → set default signatory employee IDs in `CORE_CFG_Parameters` (`DefaultSignatoriesEmpId`, `DefaultHistoCytoSignatoriesEmpId`)

### 5.19 Transfer to Lab (Re-Lab-Type)

- `PUT /api/Lab/Requisition/ChangeLabType?reqId&labTypeName` → moves a requisition from one lab type to another (e.g. misrouted "histo" to "cyto")
- Updates `LabTypeName`, may reset sample code

### 5.20 Outsource Test Settings

- `PUT /api/LabSettings/LabTest` with `IsOutsourceTest = true` and `DefaultOutsourceVendorId` → marks test as outsource with default vendor
- `POST /api/LabSettings/LabVendor` (with `IsDefault = true`) → single in-house vendor (the only one with that flag)

---

## 6. API Endpoints (Consolidated)

All routes are prefixed with `api/`. Verb column is GET/POST/PUT/DELETE.

### 6.1 LabController (transactional)

| Verb | Route | Purpose |
|------|-------|---------|
| GET | `Lab/WorkList` | Technologist worklist |
| GET | `Lab/PatientNotFinalizedTests` | Tests for a patient not yet reported |
| GET | `Lab/Requisition/SamplePending` | Awaiting-sample requisitions |
| GET | `Lab/Requisition/PatientSamplePending` | Pending for specific patient |
| GET | `Lab/LatestSampleCode` | Preview next sample code |
| GET | `Lab/IsSampleCodeValid` | Validate manual sample code |
| GET | `Lab/LabWorkList` | Worklist by category+date |
| GET | `Lab/Result/Pending` | Pending results |
| GET | `Lab/Report/Pending` | Pending reports |
| GET | `Lab/Report/Finalized` | Final reports by patient for dispatch |
| GET | `Lab/PatientListForReportDispatch` | Dispatch patient list |
| GET | `Lab/PatientListForFinalReport` | Final-report patient list |
| GET | `Lab/LabDataByBarcodeNumber` | All lab data by barcode |
| GET | `Lab/LabDataByRunNumber` | All lab data by formatted run no. |
| GET | `Lab/LabDataByPatientId` | All lab data by patient |
| GET | `Lab/LabReportByRequisitionIds` | Formatted report for print |
| GET | `Lab/ReportDispatch/LabReportByRequisitionIds` | Same for dispatch |
| GET | `Lab/LabReportTemplates` | All active `html` templates |
| GET | `Lab/LabResultsByVisitId` | Component results by visit |
| GET | `Lab/LabRequisitionsByVisitId` | Requisitions by visit |
| GET | `Lab/LabResultsByPatientId` | Component results by patient |
| GET | `Lab/LabTests` | Test list (active) |
| GET | `Lab/Requisition/LabSpecimen` | Specimen for a req |
| GET | `Lab/RequisitionsByRequisitionIds` | Bulk requisition fetch |
| GET | `Lab/RequisitionsForExternalLab` | External send-out list |
| GET | `Lab/RequisitionsSentToExternalLab` | Currently-at-vendor list |
| GET | `Lab/LabCategories` | All categories |
| GET | `Lab/LabTypes` | Active lab types |
| GET | `Lab/LabSpecimens` | Specimens |
| GET | `Lab/SampleCollectedRequisitions` | Daily sample-collected data |
| GET | `Lab/Notification/CovidResults` | SMS-applicable test results |
| GET | `Lab/Notification/CovidSmsText` | Composed SMS body |
| POST | `Lab/ComponentResults` | Add component results |
| POST | `Lab/Requisitions` | Create requisitions |
| POST | `Lab/LabReport` | Create report |
| POST | `Lab/Notification/Sms` | Send SMS |
| POST | `Lab/Notification/UploadCovidReportToGoogleDrive` | Upload to Drive |
| PUT | `Lab/GenerateSampleCodeAutomatic` | Auto-assign sample code |
| POST | `Lab/LabStickerHtml` | Save sticker HTML |
| POST | `Lab/EmailLabReport` | Email report |
| PUT | `Lab/updateFileUploadStatus` | Mark telemedicine upload |
| PUT | `Lab/GenerateSampleCodeManual` | Manual sample code |
| PUT | `Lab/Report/UpdateSampleCode` | Edit sample code from view-report |
| PUT | `Lab/Requisition/BillStatus` | Update billing status |
| PUT | `Lab/ComponentResults` | Edit component results |
| PUT | `Lab/UpdateLabReport` | Update report |
| PUT | `Lab/Report/PrintCount` | Bump print count |
| PUT | `Lab/UpdateDoctorInLabRequisition` | Change prescriber on req |
| PUT | `Lab/UpdateDoctorInLabReport` | Change prescriber on report |
| PUT | `Lab/ChangeLabTestWithSamePrice` | Swap test |
| PUT | `Lab/CancelInpatientLabTest` | Cancel inpatient test |
| PUT | `Lab/Requisition/LabSpecimen` | Edit specimen |
| PUT | `Lab/UndoSampleCode` | Undo sample code |
| PUT | `Lab/VerifyTestResultWithSignatory` | Verify + sign |
| PUT | `Lab/VerifyTestResultWithoutSignatory` | Verify only |
| PUT | `Lab/Requisition/Vendor` | Reassign vendor |
| PUT | `Lab/Requisition/ChangeLabType` | Move to another lab type |
| PUT | `Lab/ExternalLabStatus` | Update external-lab status |

### 6.2 LabSettingController

| Verb | Route | Purpose |
|------|-------|---------|
| GET | `LabSettings/ReportTemplates` | All templates |
| GET | `LabSettings/LabTests` | Tests with components |
| GET | `LabSettings/LabVendors` | All vendors |
| GET | `LabSettings/LabSignatories` | Signatories + lab doctors |
| GET | `LabSettings/LabTestComponents` | Component master |
| GET | `LabSettings/LabLookupList` | Module=lab lookups |
| GET | `LabSettings/LabGovReportingItems` | Gov items |
| GET | `LabSettings/LabGovReportMappingDetail` | Mappings |
| GET | `LabSettings/OutsourceApplicableLabTests` | Outsource tests |
| POST | `LabSettings/LabReportTemplate` | Add template |
| POST | `LabSettings/LabTest` | Add test |
| POST | `LabSettings/LabComponentsInBulk` | Bulk add components |
| POST | `LabSettings/LabLookup` | Add lookup |
| POST | `LabSettings/LabVendor` | Add vendor |
| POST | `LabSettings/LabCategory` | Add category |
| POST | `LabSettings/LabSpecimen` | Add specimen |
| POST | `LabSettings/GovReportMapping` | Map gov item |
| PUT | `LabSettings/LabReportTemplate` | Edit template |
| PUT | `LabSettings/LabTest` | Edit test |
| PUT | `LabSettings/LabDefaultSignatories` | Set default signatories |
| PUT | `LabSettings/LabComponentsInBulk` | Edit components |
| PUT | `LabSettings/LabLookup` | Edit lookup |
| PUT | `LabSettings/LabVendor` | Edit vendor |
| PUT | `LabSettings/LabCategory` | Edit category |
| PUT | `LabSettings/GovReportMapping` | Edit gov mapping |
| PUT | `LabSettings/LabTestActiveStatus` | Toggle test active |
| PUT | `LabSettings/LabCategoryActiveStatus` | Toggle category active |
| PUT | `LabSettings/LabReportTemplateActiveStatus` | Toggle template active |
| PUT | `LabSettings/LabVendorActiveStatus` | Toggle vendor active |

### 6.3 LISController

| Verb | Route | Purpose |
|------|-------|---------|
| GET | `LIS/GetAllLISMasterData` | Master data from LIS |
| GET | `LIS/GetAllMappedData` | Existing mappings |
| GET | `LIS/GetAllNotMappedDataByMachineId` | Unmapped internal components |
| GET | `LIS/GetExistingMappingById` | Single mapping |
| GET | `LIS/GetAllMachineResult` | Machine results in date range |
| GET | `LIS/GetAllMachines` | All machines |
| GET | `LIS/GetResultByBarcodeNumber` | Machine results by barcode |
| POST | `LIS/AddUpdateNewMapping` | Create/update mapping |
| POST | `LIS/AddLisDataToResult` | Commit results to DB |
| POST | `LIS/MachineOrder` | Push order to analyzer |
| PUT | `LIS/MachineResultSyncStatus` | Mark synced |
| DELETE | `LIS/RemoveMapping` | Soft-delete mapping |

### 6.4 IMUController

| Verb | Route | Purpose |
|------|-------|---------|
| GET | `IMU/GetAllImuTestList` | Already-IMU-submitted list |
| POST | `IMU/PostDataToIMU` | Push to IMU |

### 6.5 LabReportExportController (DOCX)

| Verb | Route | Purpose |
|------|-------|---------|
| GET | `LabReportExport/GetTemplateDetails` | Single-template DOCX |
| GET | `LabReportExport/GetAllTemplateDetailswithprintId` | Combined DOCX |

---

## 7. Cross-Module Interactions

| Module | Interaction | Direction | Trigger |
|--------|-------------|-----------|---------|
| **Patient** | `LAB_TestRequisition.PatientId` → `PAT_Patient.PatientId` | Lab reads | Every requisition |
| **Patient** | Profile pic, demographics, municipality, country subdivision on report | Lab reads | Report generation |
| **Visit** | `LAB_TestRequisition.PatientVisitId` → `PAT_PatientVisits.PatientVisitId` | Lab reads | Requisition, results, report |
| **Admission** | `LAB_TestRequisition.WardName` ← `ADT_PatientAdmission.WardName/BedCode` | Lab reads | Inpatient sample collection |
| **Billing** | `LAB_TestRequisition.BillingStatus` ← `BIL_TXN_BillingTransactionItems`; `BillingTransactionItemId`, `ServiceItemId` | Bidirectional | Order entry, bill-cancel |
| **Billing** | When LIS results come in, `SP_Bill_OrderStatusUpdate` is called to mark billing final | Lab writes | LIS result add |
| **Employee (RBAC)** | `PrescriberId`, `SampleCreatedBy`, `VerifiedBy`, `ResultAddedBy`, `PrintedBy` → `EMP_Employee.EmployeeId` | Lab reads | Order, sample, verify, print |
| **Employee** | `PrescriberName` (denormalized) → printed on report | Lab writes | Report generation |
| **Settings (Admin Parameters)** | `LabReportVerificationNeededB4Print` JSON controls verification, default signatories `DefaultSignatoriesEmpId` / `DefaultHistoCytoSignatoriesEmpId`, `GoogleDriveFileUpload` (for COVID reports), `PatientProfilePicImageUploadLocation` (for report pic) | Lab reads | Per-request, per-feature |
| **Lookup** | `CORE_CFG_LookUps` with `ModuleName = 'lab'` → culture drug lists, organism lists, etc. | Lab reads | Culture/anti-culture entry |
| **RBAC** | Category creation auto-creates an RBAC permission `lab-category-{Name}` and ties it to application `lab` | Settings → RBAC | `POST LabSettings/LabCategory` |
| **External Lab Portal** | Tests flagged `IsOutsourceTest` route to vendors; status tracked on `ExternalLabSampleStatus` | Lab writes | Vendor update |
| **LIS Web API** | External middleware for analyzers (config-driven URL in `MyConfiguration.LISDataBaseUrl`) | Bidirectional HTTP | Pull results, push orders |
| **IMU Middleware** | Separate analyzer middleware | One-way push | `POST /api/IMU/PostDataToIMU` |
| **Telemedicine Portal** | PDF report upload | Lab writes status | `PUT /api/Lab/updateFileUploadStatus` |
| **Google Drive** | COVID-19 PDF report upload | Lab writes | `POST /api/Lab/Notification/UploadCovidReportToGoogleDrive` |
| **Email Service** | `IEmailService` injection for `SendLabReportEmailToPatient` | Lab calls | Report email |
| **SMS Service** | `IEmailService` (or separate SMS gateway) used in `PostSMS` | Lab calls | COVID result SMS |
| **Reporting** | Lab feeds component results + patient demographics to the SSRS-style reporting stack (e.g. `SP_LAB_GetPatientListForReportDispatch`) | Lab reads/writes | Government report extraction |
| **HR (for `VerifiedBy` only)** | Verifier must be an `EMP_Employee` with lab dept code (`lab`/`pat`/`pathology`/`laboratory`) | RBAC-enforced | Verification |

---

## 8. Key Business Rules

### 8.1 Sample-Code Formatting

A `LabRunNumberSettingsModel` row is matched by the exact 4-tuple `(RunNumberType, VisitType, UnderInsurance, LabTypeName)`. The formatter then:

1. Picks `StartingLetter` (e.g. `S`)
2. Resolves `FormatInitialPart`:
   - `num` → numeric sequence
   - `yy` → last 1-2 digits of Nepali year
   - `mm` → Nepali month
   - `dd` → Nepali day
3. Concatenates with `FormatSeparator` (e.g. `-`)
4. Resolves `FormatLastPart` similarly
5. Counter resets based on `ResetDaily` / `ResetMonthly` / `ResetYearly` flag

Example: `S-001-81` means letter `S`, sequence 001, Nepali year 2081 (2024-25 AD).

If no matching setting is found, throws `ArgumentException("Cannot Get Samplecode. Didnt Found Any Format")`.

### 8.2 Inpatient vs. Outpatient Print Gate

`ValidatePrintOption(allowOutPatWithProv, visitType, billingStatus)`:
- Inpatient → always printable
- Outpatient + `allowOutPatWithProv` → `paid` / `unpaid` / `provisional` all OK
- Outpatient + no flag → `paid` / `unpaid` / `emergency` only

### 8.3 Verification Step

- `CORE_CFG_Parameters.ParameterGroupName = 'lab'` and `ParameterName = 'LabReportVerificationNeededB4Print'`
- Value deserializes to `VerificationCoreCFGModel` with `EnableVerificationStep`, `VerificationLevel`, `ShowVerifierSignature`, `PreliminaryReportText`
- When enabled, requisitions in `OrderStatus = 'result-added'` are hidden from final report until `IsVerified = true`
- Two paths: with signatory (adds to `LabReports.Signatories`) or without (just sets `IsVerified/By/On` on requisition)

### 8.4 Component-Value Validation

- Numeric components: `MinValue <= Value <= MaxValue` (UI validation; server trusts the client)
- Dropdown components: `Value` must be in `ValueLookup` JSON array
- Range resolution at result time:
  - If `FemaleRange` set and patient gender female → use that
  - Else if `MaleRange` set and patient gender male → use that
  - Else if `ChildRange` set and patient is a child → use that
  - Else `Range`
- `IsAbnormal = true` when `Value` falls outside the chosen range; `AbnormalType = 'high'` if `Value > MaxValue`, `'low'` if `Value < MinValue`
- For dropdown/text components, `IsAbnormal` is set by checking `Value` against `PositiveIndicator` or per-component logic

### 8.5 Critical-Value / Panic-Value Alerts

No explicit "critical value" column exists, but the pattern is:
- Components with a numeric range + a `RangeDescription` flag (e.g. "Critical-High", "Critical-Low") cause the result UI to highlight the value in red and prompt the tech to call the doctor
- The actual alert workflow is not centralized in this controller; it lives in the result-entry UI component and uses the verification + telephonic-callback log elsewhere

### 8.6 Culture / Anti-Culture Workflow

For tests with `TemplateType = 'culture'`:

1. Organism identification phase (`ResultGroup = 1`):
   - One component per isolate (e.g. "Organism 1: E. coli")
   - Dropdown value from `CORE_CFG_LookUps` `LookUpName = 'OrganismList'`
2. Sensitivity phase (`ResultGroup = 2+`):
   - One column per drug, one row per organism
   - Drug list from `CORE_CFG_LookUps` `LookUpName = 'SensitivityDrugs'`
   - Values: `S` (sensitive) / `I` (intermediate) / `R` / `RR` (resistant)
   - Marked as `IsAbnormal = true` when resistant
3. `MaxResultGroup` is calculated per test for UI pagination

### 8.7 Histopathology / Cytology

- `RunNumberType = 'histo'` or `'cyto'`
- Sample-code formatter uses different `RunNumberType` setting
- `ReceivingDate` on report falls back to `OrderDateTime` (not `SampleCreatedOn`) because there is no separate collection
- `OrderStatus` skips `pending`; goes `active` → `result-added` → `report-generated` directly
- The signatory defaults are different (`DefaultHistoCytoSignatoriesEmpId` instead of `DefaultSignatoriesEmpId`)

### 8.8 Lab-Type Switcher

- `MST_LabTypes` lists all available lab types (`lab`, `histo`, `cyto` …)
- User picks one at session start → stored in `ENUM_SessionVariables.ActiveLabType`
- All subsequent requests include that filter in queries: `req.LabTypeName == activeLab`
- `LabSelectionGuardService` (Angular) blocks routes until a lab is selected

### 8.9 LIS Sync Atomicity

`AddLISDataToDanphe` uses a `TransactionScope(TransactionScopeAsyncFlowOption.Enabled)`:

1. Add `LabTestComponentResult` rows
2. Update `Requisitions` (`OrderStatus`, `ResultAddedBy/On`)
3. Call `SP_Bill_OrderStatusUpdate`
4. Save `LIS_SyncedComponentDetail` audit (with `SyncStatus = true`)
5. POST to LIS API `SetResultSyncStatus` to mark on the analyzer side
6. `trans.Complete()`

If anything fails, catch block:
- Sets all `syncedCompDetail.SyncStatus = false`
- Saves them
- POSTs to LIS API `ResetResultSyncStatus` to revert the analyzer flag
- Returns `false` to caller

### 8.10 Outsource Test Routing

- `IsOutsourceTest = true` on `LAB_LabTests`
- On requisition creation, if the test is outsource, `ResultingVendorId` is set to the test's `DefaultOutsourceVendorId`
- If not, `ResultingVendorId = defaultVendorId` (the single `IsDefault = true` vendor)
- All pending-result and pending-report queries filter `req.ResultingVendorId == defaultVendorId` to keep in-house and outsource pipelines separate
- Vendor can be changed via `PUT /api/Lab/Requisition/Vendor`

### 8.11 Bill-Cancel Cascade

When billing cancels an `BillingTransactionItem`, the billing side sets `LAB_TestRequisition.BillingStatus = 'cancel'`, `BillCancelledBy`, `BillCancelledOn`. All pending-result and pending-report queries filter these out, so a cancelled test never appears in any worklist.

### 8.12 Specimen & Test Code

- Each test has a default `LabTestSpecimen` (e.g. "Blood", "Urine", "Stool", "CSF")
- Can be overridden per requisition via `PUT /api/Lab/Requisition/LabSpecimen`
- `ProcedureCode` is auto-set to `LAB-` + 6-digit zero-padded `LabTestId` at insert time
- `LabTestCode` is auto-set to `L-` + 6-digit zero-padded `LabTestId` if blank
- `LOINC` is editable on the test; copied to requisition for HL7/RCM reporting

### 8.13 Two-Tier Report Header

- The first time a `LabReportModel` row is saved, it captures:
  - `PrescriberName` (denormalized from the prescriber at the time of generation — legal record)
  - `Signatories` (snapshot of the signing employees' signatures)
  - `Comments` (header comments, different from per-test `Comments` on requisition)
- If a doctor is later changed, the requisition reflects the new doctor but the printed report keeps the original
- The two PUT endpoints `UpdateDoctorInLabRequisition` and `UpdateDoctorInLabReport` allow updating both, but they don't sync

### 8.14 Print Count & Audit

- `IsPrinted`, `PrintedBy`, `PrintedOn`, `PrintCount` are bumped on each print
- Bumping happens on `PUT /api/Lab/Report/PrintCount`
- Anytime the report is shown, the count is displayed (and an audit log on the Employee)
- The system allows re-printing (no hard lockout)

### 8.15 COVID-19 Special Path

- Tests with `SmsApplicable = true` are eligible for the COVID flow
- Reports are uploaded to Google Drive via `GoogleDriveFileUploadService`:
  - File path template from `MyConfiguration.GoogleDriveFileUpload.UploadFileBasePath`
  - Public URL template from `GoogleDriveFileUpload.FileUrlCommon` (replaces `GGLFILEUPLOADID` placeholder)
- SMS body assembled by `GetSmsMessageAndNumberOfPatientByReqId`
- Result is sent to patient's `PhoneNumber` from `PAT_Patient`

### 8.16 Government Reporting

- `Lab_Mst_Gov_Report_Items` is a list of reportable conditions
- `Lab_Gov_Report_Mapping` says "if test X's component Y has value Z, count it as a positive for gov-item W"
- The result-count flag (`IsResultCount = true`) means: count the number of positives; otherwise treat as a single-flag boolean
- Admins build the mapping in the Lab Settings page; reports query `LAB_TXN_TestComponentResult` joined to the mapping

### 8.17 RBAC Permissions

- `MST_Department` rows with `DepartmentCode = 'lab' | 'pat'` or `DepartmentName = 'pathology' | 'lab' | 'laboratory'` define which employees are considered "lab doctors"
- Only those employees are returned in `LabSignatories` for default signatory selection
- Each lab category gets its own RBAC permission (auto-created on category add)
- Permission name pattern: `lab-category-{CategoryName}`

### 8.18 Default vs. Override Templates

- A template with `IsDefault = true` is the system-wide fallback
- Tests reference a `ReportTemplateId`; that template overrides the default
- `TemplateType` is one of: `normal` (grid), `culture` (organism + sensitivity grid), `html` (free-form CKEditor body), `histo`, `cyto`
- The same query result may combine multiple templates (e.g. one requisition has a CBC test and a Lipid test → two different templates are grouped under one report)

### 8.19 Telemedicine Compatibility

- `IsFileUploadedToTeleMedicine` is set when the report PDF is uploaded to the patient portal
- The actual upload uses a different endpoint (in the patient-portal sync module), but this flag is the source of truth for "the report is available to the patient online"
- The Cloudflare migration should preserve this flag and its three audit fields

---

## Appendix A: File Path Reference

```
Backend (Controllers):
  DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabController.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabSettingController.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabReportExport.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabReportExportController.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabViewController.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/IMUController.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LISController.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabsBL.cs

Services:
  DanpheEMR reference/Code/Websites/DanpheEMR/Services/LIS/ILISService.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Services/LIS/LISService.cs
  DanpheEMR reference/Code/Websites/DanpheEMR/Services/LIS/DTOs/LIS_Machine_Order_DTO.cs

Models:
  DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/LabModels/

DbContext:
  DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/LabDbContext.cs

Frontend (Angular):
  DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/labs/
    labs-main.component.ts
    labs-routing.module.ts
    labs.module.ts
    lab-selection/             — LabTypeSelectionComponent (lab-type switcher)
    lab-requests/              — Requisition list, add-requests
    lab-tests/                 — Collect sample, add result, pending results, pending reports, final reports
      lab-collect-sample/
      lab-add-result/
      lab-pending-results/
      lab-pending-reports/
      lab-final-reports/
      lab-requisition/
      lab-master/              — Barcode, report-dispatch
    lab-settings/              — Settings sub-module
      lab-test/
      lab-test-component/
      lab-report-template/
      lab-category/
      lab-lookups/
      signatories/
      map-lab-test-components/
    lab-lis/                   — LIS sub-module
      lis-mapping/
      lis-machine-result/
      shared/
    external-labs/             — External send-out
      tests-list/
      vendor-assignment/
      vendors-settings/
    notification/              — COVID SMS, IMU
    billing/                   — Ward-billing
    shared/                    — Models, services, guards
    reports/                   — Report-vm DTO
```

## Appendix B: Important Enums (string-based)

| Enum | Values | Used in |
|------|--------|---------|
| `ENUM_LabOrderStatus` | `active`, `pending`, `result-added`, `report-generated` | `OrderStatus` on requisition |
| `ENUM_LabRunNumType` | `normal`, `histo`, `cyto` | `RunNumberType` on test/requisition |
| `ENUM_LabTemplateType` | `normal`, `culture`, `html`, `histo`, `cyto` | `TemplateType` on template |
| `ENUM_VisitType` | `inpatient`, `outpatient`, `emergency` | `VisitType` on requisition/visit |
| `ENUM_BillingStatus` | `paid`, `unpaid`, `provisional`, `cancel`, `returned` | `BillingStatus` on requisition |
| `ENUM_BillingOrderStatus` | `active`, `final`, `cancel` | Stored proc arg |
| `ENUM_IntegrationNames` | `LAB` (others for rad/pharm etc.) | `IntegrationName` on `BIL_MST_ServiceItem` |
| `ENUM_SessionVariables.ActiveLabType` | string key | Session |

## Appendix C: Reusable Stored Procedures

| Procedure | Caller | Purpose |
|-----------|--------|---------|
| `SP_LAB_GetPatientListForReportDispatch` | `PatientListForReportDispatch` | Dispatch patient list |
| `SP_LAB_GetPatAndReportInfoForFinalReport` | `PatientListForFinalReport` | Final-report patient list |
| `SP_LAB_GetSamplesCollectedInfo` | `GetSampleCollectedRequisitions` | Daily collected-sample data |
| `SP_LAB_GetAllSmsApplicableTests` | `GetCovidResults` | SMS-applicable COVID results |
| `SP_LAB_GetAllLabRequisitionForExternalLab` | `GetReqiusitionsForExternalLab` | External send-out list |
| `SP_Bill_OrderStatusUpdate` | `LISService.AddLISDataToDanphe` | Mark billing final after LIS add |

## Appendix D: Frontend Routes (Angular)

```
/Lab                                → Dashboard
/Lab/Requisition                    → List-requests page
/Lab/CollectSample                  → Collect sample
/Lab/AddResult                      → Add result / lab-tests-results
/Lab/PendingReports                 → Pending reports
/Lab/PendingLabResults              → Pending results
/Lab/FinalReports                   → Final reports
/Lab/WardBilling                    → Ward-billing integration
/Lab/BarCode                        → Barcode screen
/Lab/ReportDispatch                 → Report dispatch
/Lab/Notification/SMS               → SMS notification
/Lab/Notification/IMUUpload         → IMU upload
/Lab/Settings                       → Lazy-loaded LabSettingsModule
/Lab/ExternalLabs                   → External labs main
/Lab/ExternalLabs/TestList          → Internal tests
/Lab/ExternalLabs/ExternalTestList  → External tests
/Lab/LabTypeSelection               → Switch lab type
/Lab/Lis                            → Lazy-loaded LISModule
```

Guards:
- `AuthGuardService` — RBAC check
- `ResetPatientcontextGuard` — Clears selected patient on route exit
- `LabSelectionGuardService` — Requires active lab type to be set

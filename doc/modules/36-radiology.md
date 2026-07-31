# Radiology Module — DanpheEMR Reference Documentation

## 1. Module Overview

The Radiology module in DanpheEMR manages the complete lifecycle of diagnostic imaging services — from the moment a clinician orders a study (X-ray, CT, MRI, USG, etc.) until the radiologist signs and delivers the final report to the requester and the patient.

Key responsibilities of the module:

- **Order Entry / Requisition**: Doctors place imaging requests for OPD, IPD, and emergency patients; requisitions are auto-created during the billing transaction.
- **Film Type / Modality Master**: Catalog of imaging types (X-Ray, USG, CT, MRI) and the physical film stock used per modality.
- **Modality Workflow (Scan)**: Technicians mark a requisition as "Scan Done" with film type, quantity, and remarks — this unlocks the reporting queue.
- **Report Drafting**: Radiologists select a requisition, attach uploaded diagnostic images, optionally apply an HTML template, write/edit the report text, and add signatories (digital signatures).
- **Report Verification / Final Sign-off**: A report is saved in `pending` status first, then promoted to `final` once signed.
- **PACS / DICOM Integration**: Connects to a PACS server. Patient Studies (DICOM studies ingested from the modality) are listed, mapped to requisitions, and viewer links are generated.
- **Edit-Doctor / Provider Correction**: Allows administrators to change the prescriber/performer on historical requisitions and billing transaction items.
- **Ward Billing (IP Billing)**: Generates provisional radiology orders for admitted patients, with cancellation support.
- **Report Distribution**: Reports can be exported as printable HTML, Word documents (.docx via OpenXML), PDF (jsPDF on the client), or sent by email through SendGrid.

The module is integrated with Billing, Patient, Visit, Employee, DICOM, Email, and Reporting subsystems. It owns the `RAD_*` table family in SQL Server and consumes tables from DICOM (`DCM_*`), Billing (`BIL_*`), Patient (`PAT_*`), Visit (`PAT_PatientVisit`), and Master (`MST_*`, `EMP_*`).

## 2. Backend Files

### 2.1 `RadiologyController.cs` (≈ 2962 lines)

Primary REST controller. Inherits `CommonController` and exposes HTTP routes under `/api/Radiology/*` and the older legacy `/api/radiology?...&reqType=...` style.

Key constructor dependencies:

| Field | Type | Purpose |
|-------|------|---------|
| `_emailService` | `IEmailService` | SendGrid-backed email dispatch |
| `_radiologyDbContext` | `RadiologyDbContext` | All `RAD_*` tables + `PAT_Patient`, `EMP_Employee`, `BIL_TXN_BillingTransactionItems` |
| `_dicomDbContext` | `DicomDbContext` | `DCM_PatientStudy`, `DCM_DicomFiles`, `DCM_Series` (often a separate PACS connection string) |
| `_coreDBContext` | `CoreDbContext` | `CORE_CFG_Parameters` for radiology feature flags |
| `_masterDBContext` | `MasterDbContext` | `RAD_MST_ImagingItem`, `RAD_MST_ImagingType`, `EMP_Employee`, `CFGParameters`, `SendEmailDetails` |

#### GET routes (`[HttpGet]`)

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /api/Radiology/FilmTypes` | `GetFilmTypes()` | Returns active film types from `RAD_MST_FilmType` |
| `GET /api/Radiology/Requisitions` | `GetRequisitions(reqOrderStatus, reportOrderStatus, typeList, fromDate, toDate)` | Returns combined requisition + report list for the front-end grid (calls private `RequisitionsList`) |
| `GET /api/Radiology/ImagingReports` | `GetImagingReports(reportOrderStatus, fromDate, toDate, typeList)` | Returns finalized reports for reports list view (calls `AllImagingReports`) |
| `GET /api/Radiology/ImagingReport?requisitionId=` | `GetImagingReport(requisitionId)` | Returns single report by requisition id, including the radiology signature image (Base64) of the logged-in radiologist (calls `ImagingReportByRequisitionId`) |
| `GET /api/Radiology/ImagingResults?patientId=&reportOrderStatus=` | `ImagingResults(...)` | All imaging reports for a patient, used in patient overview screen |
| `GET /api/Radiology/PatientVisitsImagingResults?patientVisitId=` | `PatientVisitsImagingResults(...)` | Returns the latest report per `ImagingItemId` for a given visit (calls `ImagingResultVisit`) |
| `GET /api/Radiology/ImagingItems` | `ImagingItems()` | All imaging items from `RAD_MST_ImagingItem` |
| `GET /api/Radiology/ReportDetail?isRequisitionReport=&id=` | `ReportDetail(...)` | Returns the report text and template based on either a Requisition (pre-report) or existing Report row (calls `GetReportDetail`) |
| `GET /api/Radiology/ImgingFilesFromPACS?fromDate=&toDate=` | `ImgingFilesFromPACS(...)` | Lists patient studies from PACS (DCM_PatientStudy) that have not been mapped |
| `GET /api/Radiology/ReportTemplates` | `ReportTemplates()` | All active report templates where `ModuleName = 'Radiology'` |
| `GET /api/Radiology/DicomImage` | `DicomImage()` | Returns the configured DICOM viewer URL from CORE parameter `DicomImageLoaderUrl` |
| `GET /api/Radiology/DicomImages?PatientStudyId=` | `DicomImages(PatientStudyId)` | Returns unmapped patient studies (or the list filtered by IDs) (calls `DicomImageList`) |
| `GET /api/Radiology/Doctors` | `Doctors()` | Returns all employees flagged `IsAppointmentApplicable = true` from cache (calls `DoctorList`) |
| `GET /api/Radiology/ImagingTypes` | `ImagingTypes()` | All active imaging types from `RAD_MST_ImagingType` |

Legacy GET (still compiled but commented as legacy) accepts `reqType` query string and dispatches the same methods (kept for backward compatibility with old front-end code).

#### POST routes (`[HttpPost]`)

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /api/Radiology/Requisitions` | `Requisitions()` | Bulk-create imaging requisitions. Sets `ImagingDate`, `CreatedBy`, `ImagingTypeName` from master, defaults `Urgency` to `"normal"`, skips items where `IsValidForReporting = false` (calls `AddRequisitions`) |
| `POST /api/Radiology/Report` | `Report()` | Multipart form upload: receives `reportDetails` JSON + `localFolder` + `orderStatus` + image files. Uploads files, inserts a row in `RAD_PatientImagingReport`, marks mapped `DCM_PatientStudy.IsMapped = true`, runs stored proc `SP_Bill_OrderStatusUpdate_Radiology` and (when provider-edit is enabled) `SP_Update_RadiologyProvider_In_BillTransactionItem` (calls `PostReport`) |
| `POST /api/Radiology/PatientStudy` | `PostPatientStudy()` | Saves a draft imaging report row that simply attaches a `PatientStudyId` to a requisition without the full report (calls `SavePatientStudy`) |
| `POST /api/Radiology/SendEmail` | `SendEmail()` | Sends a finalized report (PDF + HTML + inline images) through SendGrid. Records `SendEmailDetails` rows for each recipient (calls `SendEmail`) |

#### PUT routes (`[HttpPut]`)

| Route | Method | Purpose |
|-------|--------|---------|
| `PUT /api/Radiology/ImagingReport` | `ImagingReport()` | Update an existing report. Handles image replace/removal, signature updates, billing integration (calls `UpdateImagingReport`) |
| `PUT /api/Radiology/BillingStatus?billingStatus=` | `BillingStatus(billingStatus)` | Updates the `BillingStatus` field on a list of requisition IDs (calls `UpdateBillingStatus`) |
| `PUT /api/Radiology/DeleteReportImages` | `DeleteReportImages()` | Removes selected images from the report; also deletes the physical files from the upload folder (calls `UpdateReportImages`) |
| `PUT /api/Radiology/PatientStudy` | `PutPatientStudy()` | Update which PatientStudyId(s) are attached to an existing report (calls `UpdatePatientStudy`) |
| `PUT /api/Radiology/CancelInpatientRequisitions` | `CancelInpatientRequisitions()` | Cancels a billing transaction item, sets `CancelledBy/On/Remarks`, sets requisition `BillingStatus = 'cancel'`. Used only when the IP bill is unpaid (calls `CancelInpatientRadRequest`) |
| `PUT /api/Radiology/Doctor?prescriberId=&prescriberName=` | `Doctor(...)` | Re-assigns the prescriber on an existing report (calls `UpdateDoctor`) |
| `PUT /api/Radiology/PatientScanDone` | `PatientScanDone()` | Marks a requisition as scanned: sets `IsScanned=true`, `ScannedBy/On`, `FilmTypeId`, `FilmQuantity`, `ScanRemarks`, resets `OrderStatus='pending'`, and calls `SP_Bill_OrderStatusUpdate_Radiology` (calls `UpdatePatientScanData`) |

#### Key Private Helpers (selected)

- `RequisitionsList(...)` — LINQ query that merges active requisitions and pending reports into a single list, joining `RAD_MST_ImagingItem`, `BIL_TXN_BillingTransactionItems`, `BIL_MST_ServiceDepartment`, `MST_Municipality`, `MST_CountrySubDivision`, `PAT_Patient`. Reads `EnableRadScan`, `RadHoldIPBillBeforeScan`, `RAD_AttachFileButtonShowHide` from `CORE_CFG_Parameters` and threads them down to the client.
- `ImagingReportByRequisitionId(int requisitionId)` — joins the imaging report to patient demographics, the requisition, and the report template. Also reads the radiologist's `SignatoryImageName` (from `EMP_Employee` for the radiology department) and converts it to a Base64 string.
- `ImagingResultVisit(int patientVisitId)` — groups reports by `ImagingItemId` and returns only the latest report per item (handy for visit-summary views).
- `GetReportDetail(bool isRequisitionReport, int id)` — when `isRequisitionReport = true`, returns the template for that imaging item; when `false`, returns existing report text or pulls the template fallback if report text is empty.
- `DicomImageList(string PatientStudyId)` — when `PatientStudyId` is null/empty/`"undefined"`/`"null"`, returns all `DCM_PatientStudy` rows where `IsMapped != true`; otherwise splits the comma list and returns them along with unmapped.
- `DoctorList()` — pulls employees with `IsAppointmentApplicable = true` from the in-memory `DanpheCache.GetMasterData(MasterDataEnum.Employee)`.
- `AddRequisitions(...)` — sets audit fields, looks up `ImagingTypeName`, defaults urgency, filters out items that don't need reports, and bulk-saves.
- `PostReport(...)` — full transactional report submission: upload → `RAD_PatientImagingReport` insert → mark DICOM studies mapped → `PutRequisitionItemStatus` → `SP_Bill_OrderStatusUpdate_Radiology` → optionally update billing performer.
- `UpdateImagingReport(...)` — image replace, signature refresh, DICOM remap, provider update in billing.
- `UpdateBillingStatus(...)` — flips `BillingStatus` for a list of requisitions.
- `UpdateReportImages(...)` — `ImageName` / `ImageFullPath` patch, deletes physical files that were removed.
- `CancelInpatientRadRequest(...)` — `BIL_TXN_BillingTransactionItems.BillStatus='cancel'` and `RAD_PatientImagingRequisition.BillingStatus='cancel'`.
- `UpdateDoctor(...)` — update `PrescriberId`/`PrescriberName` on the report.
- `UpdatePatientScanData(...)` — film tracking + status reset to `pending`.
- `PutRequisitionItemStatus(int requisitionId, string status)` — used internally to push the requisition to `active` or `final`; not a controller action.

### 2.2 `RadiologyReportController.cs` (≈ 196 lines)

A small companion controller that produces a printable Microsoft Word document of an imaging report.

| Route | Method | Purpose |
|-------|--------|---------|
| `GET /RadiologyReport?reportId=` | `GetImagingReport(int reportId)` | Returns `application/msword` `FileStreamResult` populated from a `.dotx` template at `/fileuploads/Radiology/Templates/ReportTemplate.dotx`; the result is `Result.docx`. Substitutes placeholders (PatientName, ReferredBy, ReportText, Date, Age, Sex, RequestId) using `SetDocumentKeyValues` and inlines the HTML body via OpenXML `AltChunk` (`AddHtmlToDoc`). The signature block is appended from the `radiology-template-doc1` parameter in `CORE_CFG_Parameters`. |

This is used for legacy "Save as Word" export flows.

### 2.3 `RadiologyViewController.cs` (≈ 120 lines)

MVC controller that returns the Angular host view `RadiologyMain` and the embedded view pages for legacy Razor views.

| Action | View returned |
|--------|---------------|
| `Radiology()` | `RadiologyMain` (the Angular bootstrap page) |
| `ImagingRequisition()` | `ImagingRequisition` |
| `ImagingRequisitionList()` | `ImagingRequisitionList` |
| `ImagingResult()` | `ImagingResult` |
| `ImagingReportsList()` | `ImagingReportsList` |

These are not used by the SPA routes in `radiology-routing.module.ts` (the SPA fetches them through Angular routing), but are kept for fallback/legacy Razor pages.

## 3. Data Models

Located in `DanpheEMR.ServerModel.RadiologyModels` and `DanpheEMR.ServerModel.DICOMModels`.

### 3.1 `ImagingRequisitionModel`

A radiology order for one imaging item on a visit.

| Field | Type | Notes |
|-------|------|-------|
| `ImagingRequisitionId` | int | Primary key (auto) |
| `PatientVisitId` | int? | FK to `PAT_PatientVisit` |
| `PatientId` | int | FK to `PAT_Patient` |
| `PrescriberName` | string | Cached at requisition time |
| `ImagingTypeId` | int? | FK to `RAD_MST_ImagingType` (e.g. X-Ray, USG) |
| `ImagingTypeName` | string | Cached name for fast reads |
| `ImagingItemId` | int? | FK to `RAD_MST_ImagingItem` (e.g. "X-Ray Chest PA") |
| `ImagingItemName` | string | Cached name |
| `ProcedureCode` | string | CPT/procedure code |
| `ImagingDate` | DateTime? | Date of scan, defaults to order time |
| `RequisitionRemarks` | string | Free-text clinical notes |
| `OrderStatus` | string | `active`, `pending`, `final` |
| `PrescriberId` | int? | Referring doctor employee id |
| `BillingStatus` | string | `paid`, `unpaid`, `provisional`, `cancel` |
| `Urgency` | string | `normal`, `urgent`, `stat` |
| `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` | audit | standard |
| `DiagnosisId` | int? | Optional link to a clinical diagnosis |
| `WardName` | string | Set for IP/ward requests |
| `IsActive` | bool | Soft-delete flag |
| `BillCancelledBy` / `BillCancelledOn` | audit | For billing cancellation |
| `IsReportSaved` | bool | True once a report row is created |
| `HasInsurance` | bool? | Quick insurance flag (carried to reports) |
| `IsScanned` | bool? | Set true after scan-done |
| `ScannedBy` / `ScannedOn` | audit | Scan-done stamp |
| `ScanRemarks` | string | Notes during scan |
| `FilmTypeId` | int? | FK to `RAD_MST_FilmType` |
| `FilmQuantity` | int? | Number of films consumed |
| `BillingTransactionItemId` | int | Link to `BIL_TXN_BillingTransactionItems` |
| `ServiceItemId` | int | Link to `BIL_MST_ServiceItem` |
| Navigation: `Visit`, `Patient`, `ImagingReport` (1:0..1), `ImagingItem` | |

The model also defines `RadiologyScanDoneDetail` (request DTO for the scan-done PUT).

### 3.2 `ImagingReportModel`

The radiologist's finalized (or pending) report.

| Field | Type | Notes |
|-------|------|-------|
| `ImagingReportId` | int | DB-generated identity |
| `ImagingRequisitionId` | int | **Primary key** + ForeignKey to `ImagingRequisition` (1:1) |
| `PatientVisitId` / `PatientId` | int | Denormalized |
| `PrescriberId` / `PrescriberName` | int? / string | Referred by |
| `ImagingTypeId` / `ImagingTypeName` | int? / string | Modality type |
| `ImagingItemId` / `ImagingItemName` | int? / string | Specific study |
| `ImageFullPath` | string | Server folder for uploaded image files |
| `ImageName` | string | Semicolon-separated list of image filenames |
| `ReportText` | string | HTML report body |
| `CreatedOn` / `OrderStatus` | datetime / string | `pending` or `final` |
| `Signatories` | string | JSON array of `{ EmployeeId, EmployeeFullName, Signature }` |
| `PrescriberId` / `PrescriberName` | int? / string | |
| `CreatedBy` / `ModifiedBy` / `ModifiedOn` | audit | |
| `ReportTemplateId` | int? | FK to `RAD_CFG_ReportTemplates` |
| `PatientStudyId` | string | Comma-separated DICOM study ids |
| `Indication` | string | Clinical indication |
| `RadiologyNo` | string | Hospital's radiology accession number |
| `PerformerId` / `PerformerName` | int? / string | Reporting radiologist (replaces old "ReportingDoctor") |
| `PerformerIdInBilling` / `PerformerNameInBilling` | `[NotMapped]` int? / string | Carried from billing when provider edit is enabled |
| Navigation: `Visit`, `Patient`, `ImagingRequisition` (1:1) | |

`ImagingReportViewModel` is a flattened DTO that adds `ReportTemplateId`, `TemplateName`, `Muncipality`, `CountrySubDivision`, `PatientNameLocal`, `BillingDate`, `PatientName`, `PhoneNumber`, `PatientCode`, `Address`, `Gender`, `DateOfBirth`, `SignatoryImageBase64` (radiologist signature embedded as base64), `FooterText`, `currentLoggedInUserSignature`, `HasInsurance`, `IsActive`. Used by view/edit flows.

`ImagingReportPrintVM` is a separate view-model used only by `RadiologyReportController` to build Word document placeholders.

### 3.3 `RadiologyImagingTypeModel` (master)

Lives in `RAD_MST_ImagingType`.

| Field | Type |
|-------|------|
| `ImagingTypeId` (PK) | int |
| `ImagingTypeName` | string |
| `ProcedureCoding` | string |
| Audit fields + `IsActive` | |
| Navigation: `ImagingItems` (1:N) | |

### 3.4 `RadiologyImagingItemModel` (master)

Lives in `RAD_MST_ImagingItem`.

| Field | Type |
|-------|------|
| `ImagingItemId` (PK) | int |
| `ImagingTypeId` (FK) | int |
| `ImagingItemName` | string |
| `ProcedureCode` | string |
| Audit fields + `IsActive` | |
| `IsValidForReporting` | bool — if false, requisition is not created (e.g. small items that don't need a structured report) |
| `TemplateId` | int? — default `RAD_CFG_ReportTemplates.TemplateId` for this item |
| Navigation: `ImagingTypes` (N:1) | |

### 3.5 `FilmTypeModel` (master)

Lives in `RAD_MST_FilmType`.

| Field | Type |
|-------|------|
| `FilmTypeId` (PK) | int |
| `FilmType` | string |
| `ImagingTypeId` | int (modality) |
| `FilmTypeDisplayName` | string |
| Audit + `IsActive` | |
| `FilmQuantity` | `[NotMapped]` int — captured in UI per scan |

### 3.6 `RadiologyReportTemplateModel` (master)

Lives in `RAD_CFG_ReportTemplates`.

| Field | Type |
|-------|------|
| `TemplateId` (PK) | int |
| `ModuleName` | string — always `'Radiology'` in this module |
| `TemplateCode` | string |
| `TemplateName` | string |
| `TemplateHTML` | string — HTML body used as the initial draft |
| `FooterNote` | string — printed footer |
| Audit + `IsActive` | |

### 3.7 DICOM Models

`PatientStudyModel` (`DCM_PatientStudy`):

| Field | Type | Notes |
|-------|------|-------|
| `PatientStudyId` (PK) | int | |
| `PatientId` | string | Often the PACS-side string id (may differ from hospital's `PatientId`) |
| `PatientName` | string | DICOM-formatted `LastName^FirstName^MiddleName` (replaced with spaces by the UI) |
| `StudyInstanceUID` | string | DICOM UID |
| `SOPClassUID` | string | DICOM class |
| `StudyDate` | DateTime? | |
| `Modality` | string | `CT`, `MR`, `CR`, `US`, `XA`, etc. |
| `StudyDescription` | string | |
| `CreatedOn` | DateTime? | When PACS dropped it |
| `IsMapped` | bool? | True once attached to a report |

`DicomFileInfoModel` (`DCM_DicomFiles`) holds per-file binary/paths and `SeriesInfoModel` (`DCM_Series`) groups them. The radiology module currently only reads `DCM_PatientStudy` — image viewing happens in a separate DICOM viewer widget (`danphe-dicom-viewer`).

### 3.8 Supporting Models

- `ImageAttachmentModel` — UI-side image (Base64 + name) used for email attachments.
- `RadEmailModel` — DTO for `SendEmail`. Includes `EmailList`, `SenderEmailAddress`, `Subject`, `HtmlContent`, `PlainContent`, `PdfBase64`, `AttachmentFileName`, `ImageAttachments`, `SendHtml`, `SendPdf`.
- `ReportingDoctorModel` — model file exists but the entity is **not registered** in `RadiologyDbContext` (commented out). The `DoctorSignatureJSON` concept is replaced by the `Signatories` JSON column on the report itself.

## 4. Database Tables

### 4.1 Owned by the Radiology module

| Table | Source Model | Primary Key | Notes |
|-------|--------------|-------------|-------|
| `RAD_MST_ImagingType` | `RadiologyImagingTypeModel` | `ImagingTypeId` | Modality types (X-Ray, USG, CT, MRI, etc.) |
| `RAD_MST_ImagingItem` | `RadiologyImagingItemModel` | `ImagingItemId` | Individual studies (X-Ray Chest PA, USG Abdomen, etc.) |
| `RAD_MST_FilmType` | `FilmTypeModel` | `FilmTypeId` | Film stock catalogue per modality |
| `RAD_PatientImagingRequisition` | `ImagingRequisitionModel` | `ImagingRequisitionId` | Imaging orders (1 per imaging item per visit) |
| `RAD_PatientImagingReport` | `ImagingReportModel` | `ImagingRequisitionId` (also unique FK) | The 1:0..1 report row |
| `RAD_CFG_ReportTemplates` | `RadiologyReportTemplateModel` | `TemplateId` | HTML templates seeded for each imaging item |

### 4.2 Tables the module reads/joins

| Table | Purpose |
|-------|---------|
| `PAT_Patient` | Demographics, municipality, country subdivision |
| `PAT_PatientVisit` | Visit linkage |
| `EMP_Employee` | Prescriber/Performer names; signature image |
| `MST_Department` | To detect radiology department radiologists |
| `MST_Municipality` / `MST_CountrySubDivision` | Demographics on reports |
| `BIL_TXN_BillingTransactionItems` | Link to billing; via `RequisitionId` |
| `BIL_MST_ServiceDepartment` | Filter by `IntegrationName='Radiology'` |
| `BIL_CFG_BillingItems` (used in ward billing via `/api/Billing/LabBillCfgItems?departmentName=radiology`) | Searchable item list |
| `CFGParameters` (CORE) | Radiology feature flags |
| `CORE_CFG_Parameters` | Same as above (parameter group `"Radiology"`) |
| `SendEmailDetails` (master) | Audit row per email sent |

### 4.3 Tables the module writes/reads (DICOM/PACS)

| Table | Purpose |
|-------|---------|
| `DCM_PatientStudy` | Patient studies ingested by a DICOM router; the radiology module flips `IsMapped` to true once a study is attached to a report. |
| `DCM_DicomFiles` / `DCM_Series` | Available through the DB context but not modified by this module — used by the separate DICOM viewer. |

### 4.4 CORE/CFG Parameters used by the module

Parameter group `"Radiology"` in `CORE_CFG_Parameters`:

| ParameterName | Purpose |
|---------------|---------|
| `EnableRadScan` | If true, scan-done is mandatory before report drafting; if false, scan is bypassed. |
| `RadHoldIPBillBeforeScan` | Holds inpatient billing until scan is done. |
| `RAD_AttachFileButtonShowHide` | Toggles the "Attach Files" button in the requisition grid. |
| `EnableImageUpload` | Enables the local image upload widget inside the report dialog. |
| `EnableDicomImages` | Enables the DICOM attach panel inside the report dialog. |
| `RadReportCustomerHeader` | JSON `{show, headerType}` for printing the customer logo/text header. |
| `ReportImagesFolderPath` | Server folder for uploaded report images. |
| `ExternalReferralSettings` | JSON for external referrer support. |
| `ReportHeaderPatientNameSettings` | Local-language patient name on the report header. |

Other CORE parameters: `DicomImageLoaderUrl` (URL of the DICOM viewer), `radiology-template-doc1` (signature HTML appended to the Word export), `SignatureLocationPath` (where radiologist signature images live), `APIKeyOfEmailSendGrid` (for email).

### 4.5 Stored procedures called

- `SP_Bill_OrderStatusUpdate_Radiology(@reqID, @status)` — keeps the related `BIL_TXN_BillingTransactionItems` and `RAD_PatientImagingRequisition` in sync after a report is saved.
- `SP_Update_RadiologyProvider_In_BillTransactionItem(@RequisitionId, @PerformerId, @PerformerName, @PrescriberId, @PrescriberName)` — when the radiologist changes the prescriber or performer on a saved report, propagate that change into the billing transaction item so downstream revenue/insurance reports stay correct.

## 5. Key Workflows

### 5.1 Order Entry / Requisition Creation

1. A clinician selects imaging items from a billing screen (often `BillingTransaction` flow).
2. After payment/provisional status, `POST /api/Radiology/Requisitions` is called with a list of `ImagingRequisitionModel`.
3. `AddRequisitions` sets `ImagingDate = CreatedOn = DateTime.Now`, `IsActive = true`, resolves `PrescriberName` from `EMP_Employee`, resolves `ImagingTypeName` from master, defaults `Urgency = "normal"`.
4. **Filter**: items where `RAD_MST_ImagingItem.IsValidForReporting = false` are skipped (e.g. the requisition only tracks consumption, no structured report is needed).
5. One row per imaging item is inserted into `RAD_PatientImagingRequisition`.
6. `OrderStatus` starts as `"active"` (so the technologist sees it in the scan queue).
7. The front-end grid (`ImagingRequisitionListComponent`) refreshes and shows the order with `IsScanned=false` and the `BillingStatus` from the billing transaction item.

### 5.2 Modality / Scan-Done Workflow

1. The radiology technologist opens **Imaging Requisition List** (`/Radiology/ImagingRequisitionList`).
2. They click the "Scan Done" action on a row → `showScanDone` opens a dialog (`SaveScanData`).
3. They pick a `FilmType` from the filtered `RAD_MST_FilmType` list (filtered by `ImagingTypeId` of the requisition) and a `FilmQuantity`.
4. `PUT /api/Radiology/PatientScanDone` is invoked with a `RadiologyScanDoneDetail` payload.
5. `UpdatePatientScanData` runs inside a `TransactionScope`:
   - Sets `IsScanned=true`, `ScanRemarks`, `ScannedBy/On`, `FilmTypeId`, `FilmQuantity`.
   - Resets `OrderStatus = 'pending'` (so the report can now be drafted).
   - Calls `SP_Bill_OrderStatusUpdate_Radiology(@reqID, 'pending')` to keep the billing item in sync.
6. If `EnableRadScan=false`, the requisition is shown with `IsScanned=true` immediately (the grid query treats `IsScanned` as always true in that mode).

### 5.3 Report Drafting

1. The radiologist clicks the requisition row → `show-add-report` action.
2. `GetImagingReportContent(isRequisitionReport, id)` is called. The server either returns:
   - The template HTML for the imaging item (when no report exists yet), or
   - The current report text + image names + image folder path (when editing).
3. `PostReportComponent` opens with the report rich-text editor, an image album (lightbox), a list of signatories (employees with `IsAppointmentApplicable=true` in the radiology department), and a report-template dropdown.
4. The user:
   - Writes/edits the report text.
   - Optionally uploads new images (uploaded to `fileuploads/Radiology/<ImagingTypeName>/`).
   - Attaches DICOM studies from the PACS list (`GetDicomImageList` → select rows → `AddDicomImage`).
   - Selects one or more signatories (digital signatures).
   - Sets the prescriber (if not already set).
5. Clicking **Save** → `SaveReport()` calls `AddReport("pending")` → `AddImgItemReport` builds a multipart form and `POST /api/Radiology/Report`.
6. Clicking **Submit & Print** → `AddReport("final")` → same call but `orderStatus = "final"`. After success, the `view-report` dialog is opened and the printable HTML view is shown.

### 5.4 Report Verification / Sign-Off

1. When the report is saved in `pending` status, the requisition is moved off the active list (the grid query filters on `OrderStatus = 'final'` for reports and `OrderStatus = 'active'` for requisitions).
2. When the radiologist clicks **Submit & Print** with status `final`:
   - `PostReport` inserts a row in `RAD_PatientImagingReport` (or updates the existing one).
   - All `PatientStudyId`s referenced are split by comma, the matching `DCM_PatientStudy` rows are updated to `IsMapped = true`.
   - `PutRequisitionItemStatus(requisitionId, "final")` flips the requisition status.
   - `SP_Bill_OrderStatusUpdate_Radiology` keeps the billing transaction item in sync.
3. The signature block on the report is built from the `Signatories` JSON, the radiologist's signature image (loaded from `EMP_Employee.SignatoryImageName` + `SignatureLocationPath` parameter) and the template `FooterNote`.

### 5.5 Report Distribution

- **HTML print**: `PrintReportHTML()` on `view-report.component` reads `#printpage`, wraps it in a printable HTML document with hospital CSS, opens a new window via `showPrint` → `callBackPrint` triggers the browser print.
- **PDF export**: When the email send dialog is opened with `PdfContent=true`, `html2canvas` + `jspdf` convert `#printpage` to a Base64 PDF, then attach.
- **Word export**: `GET /RadiologyReport?reportId=` (legacy `RadiologyReportController.GetImagingReport`) uses OpenXML to fill a `.dotx` template and stream the result.
- **Email**: `POST /api/Radiology/SendEmail` ships the report HTML / PDF / attached images through SendGrid, then writes one `SendEmailDetails` row per recipient.

### 5.6 DICOM / PACS Integration

1. A DICOM router (separate service) ingests studies from imaging modalities and writes rows to `DCM_PatientStudy`.
2. In the requisition grid, the technologist can load studies from PACS by date range via `GET /api/Radiology/ImgingFilesFromPACS`.
3. `DicomImageList` returns studies where `IsMapped = false` (or whose IDs were passed in).
4. When a study is attached to a report, the radiology module flips `IsMapped = true` on the matching `DCM_PatientStudy` rows.
5. The DICOM viewer URL is fetched from the `DicomImageLoaderUrl` parameter; clicking "View Scanned Images" in the view-report dialog opens the viewer in a side panel (`DicomService`).

### 5.7 Edit-Doctor / Provider Correction

- `PUT /api/Radiology/Doctor?prescriberId=&prescriberName=` updates the prescriber on an existing report and also on the corresponding requisition.
- When the front-end uses the dedicated **Edit Doctors** page (`/Radiology/EditDoctors`), it calls `BillingBLService.GetTxnItemsForEditDoctorByDateRad` and updates the underlying billing transaction item via `SP_Update_RadiologyProvider_In_BillTransactionItem`.
- This is critical when the referring doctor on a requisition is miscoded (e.g. resident vs. attending) and revenue/insurance reports need correction.

### 5.8 Inpatient Ward Billing (IP Radiology Orders)

1. The nurse/ward clerk opens **Inpatient List → Ward Billing → Radiology**.
2. `RadiologyWardBillingComponent` loads provisional items for the current visit (`GetInPatientProvisionalItemList(..., 'radiology')`) and the configurable radiology billing items list (`GetRadiologyBillingItems()` → `Billing/LabBillCfgItems?departmentName=radiology`).
3. New orders are placed and go to the billing system; the radiology requisition row is created by the same path as outpatient orders.
4. Cancellation uses `PUT /api/Billing/CancelInpatientItemFromWard` for radiology items. If the IP bill cancellation rule (`IpBillCancellationRule`) is enabled, only items whose `OrderStatus` is in the allowed list can be cancelled. The `RadiologyController.CancelInpatientRequisitions` PUT exists as a backup path used when the underlying billing system is bypassed.

## 6. API Endpoints Summary

All routes are rooted at `/api/Radiology/` (the legacy `/api/radiology?...&reqType=...` form still exists in the controller but is not used by the current Angular client).

| # | Verb | Route | Body | Purpose |
|---|------|-------|------|---------|
| 1 | GET | `/FilmTypes` | — | List active film types |
| 2 | GET | `/Requisitions?reqOrderStatus=&reportOrderStatus=&typeList=&fromDate=&toDate=` | — | Active requisitions + pending reports (for grid) |
| 3 | GET | `/ImagingReports?reportOrderStatus=&fromDate=&toDate=&typeList=` | — | Finalized reports (for reports list) |
| 4 | GET | `/ImagingReport?requisitionId=` | — | Single report with embedded radiologist signature |
| 5 | GET | `/ImagingResults?patientId=&reportOrderStatus=` | — | Reports for a patient |
| 6 | GET | `/PatientVisitsImagingResults?patientVisitId=` | — | Latest report per imaging item for a visit |
| 7 | GET | `/ImagingItems` | — | All imaging items |
| 8 | GET | `/ReportDetail?isRequisitionReport=&id=` | — | Template/report-text for an item or a report |
| 9 | GET | `/ImgingFilesFromPACS?fromDate=&toDate=` | — | PACS studies in a date range |
| 10 | GET | `/ReportTemplates` | — | All active radiology templates |
| 11 | GET | `/DicomImage` | — | Configured DICOM viewer URL |
| 12 | GET | `/DicomImages?PatientStudyId=` | — | Unmapped DICOM studies (or by id list) |
| 13 | GET | `/Doctors` | — | Appointment-applicable employees |
| 14 | GET | `/ImagingTypes` | — | Active imaging types |
| 15 | POST | `/Requisitions` | JSON list of `ImagingRequisitionModel` | Create requisitions |
| 16 | POST | `/Report` | multipart form (`reportDetails`, `localFolder`, `orderStatus`, `enableProviderEditInBillTxnItem`, files) | Create/Submit report |
| 17 | POST | `/PatientStudy` | JSON `ImagingReportModel` | Save a draft report with PatientStudyId only |
| 18 | POST | `/SendEmail` | JSON `RadEmailModel` | Email a finalized report |
| 19 | PUT | `/ImagingReport` | multipart form | Update an existing report |
| 20 | PUT | `/BillingStatus?billingStatus=` | JSON list of int (requisitionIds) | Update billing status flag |
| 21 | PUT | `/DeleteReportImages` | JSON `ImagingReportModel` | Drop selected images from a report |
| 22 | PUT | `/PatientStudy` | JSON `ImagingReportModel` | Update attached PatientStudyId on a report |
| 23 | PUT | `/CancelInpatientRequisitions` | JSON `BillingTransactionItemModel` | Cancel a billing item + requisition (IP only) |
| 24 | PUT | `/Doctor?prescriberId=&prescriberName=` | JSON int (requisitionId) | Re-assign prescriber on a report |
| 25 | PUT | `/PatientScanDone` | JSON `RadiologyScanDoneDetail` | Mark scan complete with film + remarks |

Plus the legacy controllers:

| Verb | Route | Purpose |
|------|-------|---------|
| GET | `/RadiologyReport?reportId=` | Legacy Word (.docx) export of an imaging report |
| GET | `/RadiologyView/ImagingRequisition` (MVC) | Legacy Razor view |
| GET | `/RadiologyView/ImagingRequisitionList` (MVC) | Legacy Razor view |
| GET | `/RadiologyView/ImagingResult` (MVC) | Legacy Razor view |
| GET | `/RadiologyView/ImagingReportsList` (MVC) | Legacy Razor view |

## 7. Cross-Module Interactions

| Module | Tables / Services | What flows in/out |
|--------|-------------------|-------------------|
| **Patient** | `PAT_Patient`, `PAT_PatientVisit` | Patient demographics, municipality, country subdivision, local-language name, ward name; FK to requisition/report |
| **Billing** | `BIL_TXN_BillingTransactionItems`, `BIL_MST_ServiceDepartment`, `BIL_MST_ServiceItem`, `BIL_CFG_BillingItems` | Order originates from billing; SPs (`SP_Bill_OrderStatusUpdate_Radiology`, `SP_Update_RadiologyProvider_In_BillTransactionItem`) keep status in sync; cancellation flows back from radiology into billing |
| **Employee / HR** | `EMP_Employee`, `MST_Department` | Prescriber and performer names; signature image; signatories list |
| **DICOM / PACS** | `DCM_PatientStudy`, `DCM_DicomFiles`, `DCM_Series` | Study attachment; viewer URL; `IsMapped` flag |
| **Order** | `RAD_PatientImagingRequisition.OrderStatus` lifecycle | `active → pending → final`; `cancel` |
| **DicomViewer** | Angular widget `danphe-dicom-viewer` | `DicomService.patientStudyId` set, viewer rendered in side panel |
| **Email** | `SendEmailDetails` (master), `CFGParameters.APIKeyOfEmailSendGrid` | Outbound distribution of reports |
| **Inventory / Pharmacy** | Indirectly via Billing | The ServiceItem / inventory consumption of films is handled elsewhere; radiology only persists `FilmTypeId` + `FilmQuantity` |
| **Insurance** | `RAD_PatientImagingRequisition.HasInsurance`, `RAD_PatientImagingReport.HasInsurance` | Carried forward to claim processing |
| **Reports / Insurance Claim** | `EditDoctorsComponent`, claim-management module | Provider correction propagates into billing transaction items via `SP_Update_RadiologyProvider_In_BillTransactionItem` |
| **Ward / ADT** | `Rad_InpatientListComponent`, `RadiologyWardBillingComponent` | Admitted patient list → provisional radiology orders; cancellation of provisional items |
| **Settings** | `CORE_CFG_Parameters` (group `"Radiology"`) | All feature flags described in §4.4 |

## 8. Key Business Rules

### 8.1 Requisition lifecycle (`OrderStatus`)

| Value | Meaning | Where set |
|-------|---------|-----------|
| `active` | Just created; visible to the scan queue | `AddRequisitions` initial state; reset to active after scan-done fails |
| `pending` | Scan done; ready for radiologist to draft report | `UpdatePatientScanData` → `ENUM_BillingOrderStatus.Pending`; after report saved as `pending` |
| `final` | Report signed-off by the radiologist | `PostReport` with `orderStatus = "final"`; `UpdateImagingReport` with same |
| (string `cancel`) | Cancelled (IP unpaid path) | `CancelInpatientRadRequest` sets `BillingStatus = "cancel"` |

### 8.2 Billing linkage

- Every requisition has a `BillingTransactionItemId`. The front-end calls `BillingBLService.GetInPatientProvisionalItemList(patientId, visitId, 'radiology')` to pull items and joins `BIL_MST_ServiceDepartment.IntegrationName = 'Radiology'`.
- `BillingStatus` is propagated to `RAD_PatientImagingRequisition.BillingStatus` (`paid` / `unpaid` / `provisional` / `cancel`) by triggers or by separate batch processes (not visible in the controller; relies on the billing side).
- Requisition list query only shows items where `BillingStatus IN ('paid', 'unpaid', 'provisional')` — cancelled items disappear from the radiology grid.

### 8.3 Scan gating

- Parameter `EnableRadScan` (default false) controls whether the technician must mark the requisition as scanned before drafting a report. When true, the report can only be drafted after `IsScanned = true`.
- Parameter `RadHoldIPBillBeforeScan` (when enabled) further restricts inpatient workflows: the IP billing cannot be settled until the scan is complete.
- The film-type selector is only shown when there is at least one `RAD_MST_FilmType` mapped to that `ImagingTypeId`.

### 8.4 Modality types

Imaging types are seeded in `RAD_MST_ImagingType` and serve as the routing key for film types, DICOM modality matching, and DICOM viewer URL generation. Examples in production deployments include `X-Ray`, `USG`, `CT Scan`, `MRI`, `Mammography`, `Doppler`, `Echo`, `ECG`, etc. The `ProcedureCoding` field is used to align with billing service items and CPT codes.

### 8.5 Report sign-off

- A report can be saved in `pending` (draft) state — the radiologist returns to it later. In `pending` the requisition still shows in the requisition grid only if `IsReportSaved != true`.
- A report can only be promoted to `final` when:
  - `ReportText` is non-empty (validated client-side).
  - At least one signatory is selected with a valid signature (validated client-side; bypassed by the `AddReportWOSignatory` parameter).
  - The provider (performer) has been assigned; if `enableProviderEditInBillTxnItem = true`, the first signatory's `EmployeeId/FullName` is propagated to `BIL_TXN_BillingTransactionItems.PerformerId/PerformerName` via `SP_Update_RadiologyProvider_In_BillTransactionItem`.
- The signature block on the printable report is rendered from the `Signatories` JSON, with the embedded radiologist signature image (Base64) shown for hospital branding.

### 8.6 DICOM mapping

- A single report can attach one or more DICOM `PatientStudyId`s (comma-separated). When attached, those studies get `IsMapped = true` so they don't appear again in the unmapped PACS list.
- Updating a report can detach studies (`PUT /PatientStudy` rewrites the comma list, then the controller sets `IsMapped = false` on the previously-attached ids and `IsMapped = true` on the new ones).
- Deleting an image from a report does not unmap a DICOM study — only the local upload image is dropped.

### 8.7 DICOM routing (parameter-driven)

- The DICOM viewer URL is fully external and configured per hospital via the `DicomImageLoaderUrl` parameter. The client opens the viewer by setting `DicomService.patientStudyId` and rendering a side panel.
- The `EnableDicomImages` parameter gates the DICOM attach UI inside the report dialog.
- The legacy `ReportingDoctor` concept (per-modity radiologist signature JSON) is **deprecated**; signature capture now lives on the `EMP_Employee.SignatoryImageName` column.

### 8.8 Provider correction

- `PUT /Doctor` updates only the `RAD_PatientImagingReport` and `RAD_PatientImagingRequisition.PrescriberId/PrescriberName`.
- The dedicated Edit Doctors page (`/Radiology/EditDoctors`) and `SP_Update_RadiologyProvider_In_BillTransactionItem` together also rewrite the billing transaction item so downstream revenue/insurance reports stay correct.
- Both flows record `ModifiedBy/On`.

### 8.9 Reporting doctor capture

- On the requisition list, `PrescriberName` defaults to `"self"` if blank.
- The `PerformerId/PerformerName` on the report is what insurance and revenue reports use. The signature widget exposes a list of employees (filtered by `IsAppointmentApplicable=true`) and the user can pick one as the "performer" (reporting doctor).
- If `enableProviderEditInBillTxnItem = true` (gated by `UpdateAssignedToDoctorFromAddReportSignatory` core parameter), the first signatory automatically becomes the billing performer.

### 8.10 Patient header

- `ReportHeaderPatientNameSettings` parameter (`{LocalNameEnabled, DefaultLocalLang}`) controls whether the report header shows the patient name in local language by default. The view-report component swaps between `PatientName` and `PatientNameLocal` on a toggle.

## 9. Frontend Architecture (Angular)

Located in `wwwroot/DanpheApp/src/app/radiology/`.

| Module / Component | Responsibility |
|--------------------|----------------|
| `RadiologyModule` + `RadiologyRoutingModule` | SPA shell under `/Radiology`. Auth-guard, patient-context reset on exit. |
| `RadiologyMainComponent` | Layout shell; renders child route |
| `ImagingRequisitionListComponent` (`/ImagingRequisitionList`) | Scan queue, report drafting entry-point, scan-done dialog, attach-DICOM dialog |
| `ImagingReportsListComponent` (`/ImagingReportsList`) | Finalized reports, view-only with print, email, and edit features |
| `Rad_InpatientListComponent` (`/InpatientList`) | Lists admitted patients, opens Ward Billing |
| `RadiologyWardBillingComponent` (`/WardBilling`) | Provisional radiology orders, cancellation, billing counter resolution |
| `RadiologyEditDoctorsComponent` + `RadEditDoctorsPopupComponent` (`/EditDoctors`) | Provider correction for past requisitions (calls `SP_Update_RadiologyProvider_In_BillTransactionItem`) |
| `shared/ImagingBLService` | Business-layer service. Wraps all DL calls; performs the BL mapping (e.g. building billing requisitions from imaging requisitions, building multipart form data, parsing signatories JSON, etc.) |
| `shared/ImagingDLService` | Pure HTTP wrapper for `/api/Radiology/*` and `/api/Billing/*` (for ward billing) |
| `shared/radiology-service.ts` (`RadiologyService`) | Reads `CORE_CFG_Parameters` for radiology feature flags: `RadReportCustomerHeader`, `ReportImagesFolderPath`, `EnableDicomImages`, `EnableImageUpload`, `ExternalReferralSettings` |
| `shared/RadiologyTypeSelector/ImagingTypeSelector.component` | Type filter used by the grid |
| `shared/report/PostReportComponent` | The "Add/Edit Report" modal: rich-text report editor, image upload, DICOM attach, signatories, template picker, urgency, indications, save/submit/print buttons |
| `shared/report/ViewReportComponent` | Final report display: HTML report view, signature block, image album (lightbox), DICOM viewer panel, email send dialog, edit, print, change-referrer |
| `shared/imaging-item-report.model.ts` | `ImagingItemReport`, `ImagingReportViewModel`, `RadiologyScanDoneDetail` |
| `shared/imaging-item-requisition.model.ts` | `ImagingItemRequisition` (UI) |
| `shared/imaging-item.model.ts` | `ImagingItem` (UI) |
| `shared/imaging-type.model.ts` | `ImagingType` |
| `shared/imaging-film-type-model.ts` | `FilmTypeModel` (UI) |
| `shared/imaging-filmtype-validator-model.ts` | Form validation for film-type picker |
| `shared/imaging-patient-study.model.ts` | `ImagingPatientStudy` (PACS row) |
| `shared/dicom-mapping-model.ts` | `DicomMappingModel` |
| `shared/rad-email.model.ts` | `RadEmailModel` (UI), `ImageAttachmentModel` |
| `shared/CoreCFGEmailSettings.model.ts` | Hospital email settings |
| `shared/reporting-doctor.model.ts` | (legacy) placeholder for old `ReportingDoctor` |
| `shared/radiology-report-template.model.ts` | `RadiologyReportTemplate` (UI) |
| `ward-billing/ward-patient-view-model.ts` | `WardPatientVM` |
| `danphe-dicom-viewer` (sibling module) | The DICOM image viewer widget opened from `ViewReportComponent` |

### Key cross-service dependencies

- `BillingBLService` — for posting billing requisitions (`PostBillingItemRequisition`), doctor list, edit-doctor by date, provisional items, cancellation of outpatient provisional items, and inpatient provisional cancellation.
- `PatientsDLService` / `PatientService` — patient demographics.
- `VisitDLService` / `VisitService` — visit context.
- `ADT_DLService` / `ADT_BLService` — admitted patient list.
- `AppointmentDLService` — counter lookup (used indirectly through `DanpheCache.GetData(MasterType.BillingCounter)`).
- `SharedModule` / `SettingsSharedModule` / `BillingSharedModule` / `DanpheAutoCompleteModule` — common widgets (date pickers, grids, auto-complete, signature selector).
- `SecurityService` — current logged-in user (for `EmployeeId` on `CreatedBy`, `ScannedBy`).
- `CoreService` — read all `CORE_CFG_Parameters`; supply email settings, report-header settings, hospital code, signature defaults.

## 10. Validation, Errors and Edge Cases

- `AddRequisitions` throws a plain `Exception("Failed")` when no items are passed.
- `PostReport` runs in `TransactionScope`; if the requisition status update returns anything other than `"OK"`, it throws `Exception("Failed")` and rolls back.
- `UpdateImagingReport` catches any exception and rethrows as `Exception("Failed")` (the catch swallows `ex` deliberately).
- `UpdatePatientScanData` rolls back on any failure and rethrows the inner exception's message.
- Client-side validation in `PostReportComponent`:
  - Requires `ReportText` non-empty.
  - Requires at least one signatory with a valid signature (skipped when `AddReportWOSignatory` is true at the core level).
  - Requires a film type to be selected in the scan-done dialog when film types are configured for that modality.
- Email validation uses a standard RFC-style regex inside `ViewReportComponent.ValidateEmail`.
- DICOM image attach silently skips empty `PatientStudyId` strings; null/undefined/"null"/"undefined" treated as "all unmapped".

## 11. Configuration / Extensibility

- Adding a new imaging type: insert into `RAD_MST_ImagingType` with `IsActive=true`. The dropdown in the requisition list, the PACS filter, and the film-type filter all auto-include it.
- Adding a new imaging item: insert into `RAD_MST_ImagingItem` with `ImagingTypeId` and (optionally) `TemplateId` referencing a template from `RAD_CFG_ReportTemplates`.
- Adding a new report template: insert into `RAD_CFG_ReportTemplates` with `ModuleName='Radiology'` and `IsActive=true`; reference it from the relevant `RAD_MST_ImagingItem.TemplateId` for auto-fill.
- Toggling DICOM viewer: set `EnableDicomImages='true'` in `CORE_CFG_Parameters` (group `Radiology`).
- Toggling image upload: set `EnableImageUpload='true'`.
- Custom signature placeholder for the Word export: set `radiology-template-doc1` parameter with the desired HTML.
- Custom email body / PDF: configure hospital `EmailSettings` parameter (group `Email`).

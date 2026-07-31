# Nursing Module

## 1. Module Overview

The DanpheEMR Nursing module is the workflow layer that nurses use to manage the patient journey on the floor — both for outpatients arriving at the front desk and inpatients occupying beds in a ward. The module is **not** the place where vital signs or intake/output are *stored* (those live in the Clinical module), but it is the operational surface that drives OPD triage, OPD check-in/check-out, free referrals between departments, exchange of treating doctor, cross-doctor consultation requests, ward billing, drugs requisition to pharmacy, patient transfer, diet sheet, hemodialysis reports, and a personal "favorite patients" list for each nurse.

The module is composed of a thin API surface (a single API controller with ~15 endpoints) plus a large Angular frontend split across many sub-features. Persistence is split between the Clinical tables (chief complaints, vitals, intake/output, allergies, notes, ICD-10 diagnosis, consultation requests, diet, I/O parameters), the Visit table (visit lifecycle / status / performer / department / parent visit), the EmployeePreferences table (XML-based nursing favorites), and the Billing/Pharmacy/Lab/Radiology/ADT modules (everything nurses order or request).

In the .NET/SQL Server reference implementation, all nursing-relevant clinical persistence lives in SQL Server tables prefixed with `CLN_*` (clinical), `VIS_*` (visit), `EMP_*` (employee/preferences), and a few shared lookup tables. The Angular frontend exposes the module as `NursingModule` at `/Nursing/*` routes with feature subfolders for `OutPatient`, `InPatient`, `Nephrology`, `RequisitionList`, `DischargeSummary`, `PatientOverviewMain`, and a deep tree of popup components.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **OPD Triage** | Capture of free-text chief complaints and an "opd-triage-comments" note on a visit. Marks the visit's `IsTriaged` flag = true so the doctor sees triaged data. |
| **OPD Check-In** | Assigns doctor (`PerformerId`, `PerformerName`) and ICD-10 final diagnosis + chief complaints to a visit. Sets `VisitStatus = "checkedin"`. |
| **OPD Check-Out** | Concludes a visit (`VisitStatus = "concluded"`, `ConcludeDate`, free-text `Remarks` as concluded note), optionally books a follow-up appointment (`AppointmentType = "followup"`, `FollowUpDay` days from now). |
| **Free Referral** | Creates a brand-new child `VisitModel` with `AppointmentType = "referral"`, `ParentVisitId` set to the original visit, and concludes the parent visit. Used when nursing redirects a patient to another department at no charge. |
| **Exchange Doctor/Department** | Mid-visit correction: updates `PerformerId`, `PerformerName`, `DepartmentId`, and `Remarks` on an existing visit. Also reconciles the visit's ICD-10 final-diagnosis set (add / activate / deactivate). |
| **Inpatient List** | Ward-scoped list of admitted patients with quick-access action chips: vitals, ward billing, transfer, receive transferred patient, add/remove favorite. |
| **Nursing Favorites** | Per-nurse persistent list of `PatientVisitId`s stored as XML inside `EmployeePreferences.PreferenceValue` (`PreferenceName = "NursingPatientPreferences"`). |
| **Ward Billing** | Read + cancel surface for `BillingTransactionItems` requested from the nursing ward (unpaid provisional bill items, lab/radiology items, etc.). Honors configurable cancellation rules per Lab/Imaging integration. |
| **Consultation Request** | A cross-doctor request from a primary consultant to a different department/doctor with a stated purpose. The consulted doctor later records a response. Stored in `CLN_ConsultationRequest` (or `ConsulationRequests` folder) with `Status` of "Requested" or "Consulted". |
| **Diet Sheet** | Per-ward inpatient grid showing each admitted patient's current `DietType`, with ability to assign a new diet (`PatientDietModel` row with `WardId`, `RecordedOn`, `ExtraDiet`, `Remarks`). |
| **Drugs Request** | Nursing-issued drug requisition sent to pharmacy (`PHRMStock/DrugRequsition`). The nurse picks items from dispensary stock, supplies quantity, and posts a `DrugsRequisitonModel` envelope. |
| **Patient Transfer** | Calls into ADT's transfer endpoints (`AdmitTransferredPatient`, `UndoTransfer`) for moving inpatients between beds/wards with the receive/on-hold workflow. |
| **Hemodialysis Report** | Submission of a `HemodialysisModel` containing pre/post vitals, vascular access, treatment data, blood transfusion details, on-examination notes, totals, and signature names. |
| **Investigation Results** | A 1-20 day lab-results table for a patient, grouped by `Test + ComponentName + Unit` and pivoted by date. Sourced from the `SP_CLN_GetPatientInvestigationResults` stored procedure. |
| **Drugs Requisition List** | A read-only list of all PHRM provisional items created from nursing so the nurse can track dispatch status per requisition. |

### Visit Status State Machine (Nursing-Relevant Transitions)

```
[initiated] --(OPD Check-In /api/Nursing/CheckInDetails)--> [checkedin]
[checkedin] --(OPD Check-Out /api/Nursing/CheckOutDetails)--> [concluded]
[checkedin] --(Free Referral /api/Nursing/VisitForFreeReferral)--> new [initiated] child visit + parent becomes [concluded]
[any] --(Exchange Doctor/Dept /api/Nursing/ExchangeDoctorDepartment)--> [unchanged status, updated performer/dept]
```

`Visit.VisitStatus` and `Visit.IsVisitContinued` are the persisted fields; `IsVisitContinued` is flipped true for referral/followup, and `IsActive` is also flipped false when the parent is a transfer.

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose |
|------|------|---------|
| `NursingController.cs` | `Websites/DanpheEMR/Controllers/Nursing/NursingController.cs` | Main API controller. 1,452 lines. Owns three `DbContext` instances: `VisitDbContext`, `ClinicalDbContext`, `OrdersDbContext`. All read endpoints wrap work in `Func<object>` and pass through `InvokeHttpGetFunction`; all write endpoints read post body via `this.ReadPostData()` and pass through `InvokeHttpPostFunction` / `InvokeHttpPutFunction`. Multi-statement writes use `Database.BeginTransaction()` and roll back on exception. |
| `NursingViewController.cs` | `Websites/DanpheEMR/Controllers/Nursing/NursingViewController.cs` | Lightweight MVC view controller (75 lines) rendering Razor pages: `Nursing`, `NursingOrder`, `NursingOrderList`, `RequisitionList`. Reads `Connectionstring` from `IOptions<MyConfiguration>` and passes it to the view. |

### 2.2 NursingController.cs — Endpoint Map

The controller wires three DbContexts: `VisitDbContext` (visit lifecycle, scheme lookup, `VisitBL` helpers), `ClinicalDbContext` (chief complaints, ICD-10 final diagnosis, visit lookup, employee preferences), and `OrdersDbContext` (favorites read/write, since favorites ride on `EmployeePreferences`). It also uses `BillingDbContext` inline (free referral scheme/CoPayment logic, deposit/pending-bill summary).

#### 2.2.1 HTTP GET endpoints (read)

| Route | Method | Internal Handler | Purpose |
|-------|--------|------------------|---------|
| `/api/Nursing/OpdVisits` | GET | `GetOpdVisitsInDateRange(fromDate, toDate)` | Returns today's OPD visit list via stored proc `SP_NUR_GetOpdVisitDetails` on `VisitDbContext`. |
| `/api/Nursing/PastVisits` | GET | `GetPastDataVisits(fromDate, toDate)` | Returns historic OPD visit list for the given range using the same stored proc. |
| `/api/Nursing/Complains` | GET | `GetComplaints(patientVisitId)` | Returns active `PatientClinicalInfoModel` rows for a visit as `{InfoId, KeyName, Value}` projection. |
| `/api/Nursing/getNephrologyPatients` | GET | inline | Returns dialysis patient list with billing items via `SP_NEPH_GetDialisysPatientListWithBillingItem` (raw `DataTable`). |
| `/api/Nursing/GetAllDepartments` | GET | inline async | Returns full `Department` list from `ClinicalDbContext`. |
| `/api/Nursing/GetBillingDetails/{PatientId}/{PatientVisitId}` | GET | inline | Returns `{ TotalDepositAmount, TotalPendingBillAmount }` aggregated from `BillingDeposit` + provisional `BillingTransactionItems` for the patient. |
| `/api/Nursing/InvestigationResults` | GET | inline | Calls `SP_CLN_GetPatientInvestigationResults` on `ClinicalDbContext` with `(fromDate, toDate, patientId, patientVisitId)`. Returns `DataTable`. |

#### 2.2.2 HTTP POST / PUT endpoints (write)

| Route | Method | DTO | Internal Handler | Purpose |
|-------|--------|-----|------------------|---------|
| `/api/Nursing/FavouritePatient` | POST | query string `patVisitId`, `preferenceType`, `wardId` | `AddFavouritePatient` | Adds a `PatientVisitId` to the nurse's XML-encoded `EmployeePreferences` (`PreferenceName = "NursingPatientPreferences"`). Creates the row if absent; otherwise appends a new `<Row><PatientVisitId>..</PatientVisitId><WardId>..</WardId></Row>` element. |
| `/api/Nursing/RemoveFromPreference` | PUT (sic) | query string `patId`, `preferenceType`, `wardId`, `itemId` | `RemoveFromFavorites` | Removes the matching `PatientVisitId` element from the nurse's favorites XML. |
| `/api/Nursing/ClinicalInformation` | POST | `List<PatientClinicalInfoModel>` | `AddToClinicalInfo` | Bulk inserts chief complaints and ancillary clinical info rows, then flips `Visit.IsTriaged = true` for that visit. Wrapped in a `ClinicalDbContext` transaction. |
| `/api/Nursing/ClinicalInformation` | PUT | `List<PatientClinicalInfoModel>` + query `patientId, patientVisitId` | `UpdateClinicalInfo` | Reconciles a full set of clinical info rows: rows removed from the inbound list are soft-deleted (`IsActive = false`), rows with `InfoId != 0` are updated, rows with `InfoId == 0` are inserted. |
| `/api/Nursing/Complaint` | POST | `List<PatientClinicalInfoModel>` | `AddNewComplaint` | Inserts a single chief complaint without touching `IsTriaged`. |
| `/api/Nursing/Complaint` | PUT | `PatientClinicalInfoModel` | `UpdateComplaint` | Updates one complaint's `Value` and `IsActive` by `InfoId`. |
| `/api/Nursing/CheckInDetails` | POST | `NursingOpdCheckIn_DTO` | `AddCheckInDetails` | Inside a transaction: (1) update `Visit.PerformerId/Name`, set `VisitStatus = "checkedin"`; (2) insert all `FinalDiagnosisModel` rows; (3) insert all `PatientClinicalInfoModel` chief-complaint rows. |
| `/api/Nursing/CheckOutDetails` | POST | `NursingOpdCheckOut_DTO` | `AddCheckOutDetails` | Inside a transaction: (1) create an `AppointmentModel` (type `followup`, scheduled `FollowUpDay` days from now) for the same doctor/department; (2) conclude the `Visit` (`VisitStatus = "concluded"`, `ConcludeDate`, `Remarks = ConcludedNote`); (3) insert all `FinalDiagnosisModel` rows. |
| `/api/Nursing/VisitForFreeReferral` | POST | `NursingOpdrefer_DTO` | `CreateVisitForFreeReferral` | Validates no duplicate visit with the same doctor today (`VisitBL.HasDuplicateVisitWithSameProvider`); resolves `PerformerName` from `PerformerId`; copies `PriceCategoryId` and `SchemeId` from parent; if `Scheme.IsBillingCoPayment == true` mints a new `ClaimCode` (random + minute + second); creates new `VisitModel` with `AppointmentType = "referral"`; calls `VisitBL.CreateNewPatientVisitCode` (recursive retry on `SqlException.Number == 2627` unique violation); sets `IsVisitContinued`/`IsActive` on parent; assigns `QueueNo`; returns a `ListVisitsVM` projection. |
| `/api/Nursing/ExchangeDoctorDepartment` | PUT | `NursingExchangedDoctorDepartment_DTO` | `UpdateExchangedDoctorDepartment` | Inside a transaction: (1) update the matched `Visit` with new `PerformerId/Name`, `DepartmentId`, `Remarks`; (2) reconcile `FinalDiagnosis` for that visit — activate any matching `ICD10ID`s that were previously deactivated, insert any new ones, deactivate any that are no longer in the DTO. |

#### 2.2.3 Free helper methods (private)

- `GenerateVisitCodeAndSave(visitDbContext, refVisit, connString)` — calls `VisitBL.CreateNewPatientVisitCode`, sets `oldReferral.VisitStatus = "concluded"`, retries recursively on unique-constraint violation.
- `UpdateIsContinuedStatus(patientVisitId, appointmentType, status, employeeId, dbContext)` — toggles `IsVisitContinued` and `IsActive` on the parent visit depending on whether `appointmentType` is `referral`, `followup`, or `transfer` (transfer also flips `IsActive = false`).

### 2.3 NursingViewController.cs

| Route | View | Purpose |
|-------|------|---------|
| `/NursingView/Nursing` | `Nursing.cshtml` | Main nursing landing page (hosted in `app/view/nursing-view/Nursing.html`). |
| `/NursingView/NursingOrder` | `NursingOrder.cshtml` | Nursing order entry (legacy Razor view; modern entry is `/Nursing/InPatient/.../orders` Angular route). |
| `/NursingView/NursingOrderList` | `NursingOrderList.cshtml` | Nursing order list (legacy). |
| `/NursingView/RequisitionList` | `RequisitionList.cshtml` | Drugs requisition list (legacy; modern equivalent is `DrugRequestListComponent`). |

---

## 3. Data Models

Most nursing-relevant models live in `DanpheEMR.ServerModel.ClinicalModels` (and a few in `DanpheEMR.ServerModel` and `DanpheEMR.ServerModel.EmployeeModels`). The frontend mirrors them in `web/src/app/nursing/shared/` and `web/src/app/nursing/shared/dto/`.

### 3.1 Clinical-side models

#### 3.1.1 `PatientClinicalInfoModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/PatientClinicalInfoModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `InfoId` | `int` (PK) | Identity |
| `PatientId` | `int` | FK to `Patient` |
| `PatientVisitId` | `int` | FK to `Visit` |
| `KeyName` | `string` | Semantic key, e.g. `"chief-complaint"`, `"opd-triage-comments"`, `"Temperature"`, `"BP"`. The same key/value table backs both chief complaints and ancillary clinical information. |
| `Value` | `string` | Free-text value. |
| `CreatedBy`, `CreatedOn` | audit | |
| `ModifiedBy`, `ModifiedOn` | audit | |
| `IsActive` | `bool` | Soft delete. |

**Frontend DTO**: `ChiefComplaints_DTO` in `nursing/shared/dto/chief-complaints.dto.ts` (same shape, plus `IsActive`).

#### 3.1.2 `VitalsModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/VitalsModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `PatientVitalId` | `int` (PK) | |
| `PatientVisitId` | `int` | |
| `Height` / `HeightUnit` | `double?` / `string` | |
| `Weight` / `WeightUnit` | `double?` / `string` | |
| `BMI` | `double?` | |
| `Temperature` / `TemperatureUnit` | `double?` / `string` | |
| `Pulse` | `int?` | |
| `BPSystolic` / `BPDiastolic` | `int?` | |
| `RespiratoryRatePerMin` | `string` | |
| `SpO2` | `double?` | |
| `OxygenDeliveryMethod` | `string` | |
| `PainScale` | `int?` | |
| `BodyPart` | `string` | |
| `Visit` | `VisitModel` (virtual nav) | |
| `Advice` | `string` | |
| `FreeNotes` | `string` | |
| `DiagnosisType` | `string` | |
| `Diagnosis` | `string` | |
| `VitalsTakenOn` | `DateTime` | When vitals were captured. |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |

> Vitals persistence is in the Clinical module's `CLN_PatientVitals` table, not in a nursing-specific table. The nursing UI opens the clinical `vitals` component from the inpatient row's "Vitals" action chip.

#### 3.1.3 `InputOutputModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/InputOutputModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `InputOutputId` | `int` (PK) | |
| `PatientVisitId` | `int` | |
| `InputOutputParameterMainId` | `int` | FK to `ClinicalIntakeOutputParameterModel` (the main category, e.g. `Oral`, `IV`, `Urine`). |
| `InputOutputParameterChildId` | `int?` | Optional sub-parameter (e.g. `NS`, `RL` for IV). |
| `IntakeOutputValue` | `double` | Numeric amount. |
| `Unit` | `string` | e.g. `ml`. |
| `IntakeOutputType` | `string` | `"intake"` or `"output"`. |
| `Contents` | `string` | Free-text description (e.g. "Vomitus - bilious"). |
| `Remarks` | `string` | |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |
| `Visit` | `VisitModel` (virtual nav) | |

#### 3.1.4 `ClinicalIntakeOutputParameterModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/ClinicalIntakeOutputParameterModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `IntakeOutputId` | `int` (PK) | |
| `ParameterType` | `string` | `"intake"` or `"output"`. |
| `ParameterValue` | `string` | Display name, e.g. `"Oral"`, `"IV Fluid"`, `"Urine"`, `"Drain"`. |
| `ParameterMainId` | `int` | Self-referencing parent id (used to attach child parameters). |
| `IsActive` | `bool` | |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |

#### 3.1.5 `NotesModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/NotesModel.cs`

Parent model for all clinical notes (free-text, procedure, progress, emergency, discharge summary, subjective, objective, prescription). The nursing module reads `NotesModel` indirectly through the `IOAllergyVitalsBLService` and the `patient-overview` route which lazy-loads `ClinicalModule`. Key fields: `NotesId`, `PatientVisitId`, `PatientId`, `PerformerId`, `TemplateId`, `NoteTypeId`, `TemplateName`, `FollowUp`, `FollowUpUnit`, `Remarks`, `IsPending`, audit fields. Has `[NotMapped]` virtual navigation properties for `FreeTextNote`, `ProcedureNote`, `ProgressNote`, `EmergencyNote`, `DischargeSummaryNote`, `SubjectiveNote`, `ObjectiveNote`, `PrescriptionNotesModel`, `AllIcdAndOrders`, `RemovedIcdAndOrders`.

#### 3.1.6 `AllergyModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/AllergyModel.cs`

Standard allergy record (`AllergyId`, `PatientId`, `PatientVisitId`, `Allergen`, `Reaction`, `Severity`, `OnsetDate`, `IsActive`, audit). Persisted via clinical module, surfaced in nursing via the clinical `patient-overview`.

### 3.2 Consultation / Diet

#### 3.2.1 `ConsultationRequestModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/ConsulationRequests/ConsultationRequestModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `ConsultationRequestId` | `int` (PK) | |
| `PatientId` | `int` | |
| `PatientVisitId` | `int` | |
| `WardId` | `int?` | |
| `BedId` | `int?` | |
| `RequestedOn` | `DateTime` | |
| `RequestingConsultantId` | `int` | |
| `RequestingDepartmentId` | `int` | |
| `PurposeOfConsultation` | `string` | Free text — required at request creation. |
| `ConsultingDoctorId` | `int` | |
| `ConsultingDepartmentId` | `int` | |
| `ConsultantResponse` | `string` | Filled when status moves to "Consulted". |
| `ConsultedOn` | `DateTime?` | |
| `Status` | `string` | `"Requested"` or `"Consulted"`. |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |
| `IsActive` | `bool` | |

**Frontend DTO**: `ConsultationRequestModel` in `nursing/shared/consultation-request.model.ts` (same fields, no audit columns). The grid variant `ConsultationRequestGridDTO` (`nursing/shared/dto/consultation-request-grid.dto.ts`) adds `WardName`, `RequestingConsultantName`, `RequestingDepartmentName`, `ConsultingDoctorName`, `ConsultingDepartmentName` for joined display.

#### 3.2.2 `DietTypeModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/Diet/DietTypeModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `DietTypeId` | `int` (PK) | |
| `DietTypeCode` | `string` | |
| `DietTypeName` | `string` | |
| `DisplayOrder` | `int` | |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |
| `IsActive` | `bool` | |

**Frontend DTO**: `DietTypeDTO` in `nursing/shared/dto/diet-type.dto.ts`.

#### 3.2.3 `PatientDietModel`
File: `Code/Components/DanpheEMR.ServerModel/ClinicalModels/Diet/PatientDietModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `PatientDietId` | `int` (PK) | |
| `PatientId` | `int` | |
| `PatientVisitId` | `int` | |
| `DietTypeId` | `int` | FK to `DietTypeModel`. |
| `ExtraDiet` | `string` | Free-text add-on (e.g. "Extra egg, 2L water"). |
| `WardId` | `int` | |
| `RecordedOn` | `DateTime` | |
| `Remarks` | `string` | |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |
| `IsActive` | `bool` | |

**Frontend model**: `DietType` in `nursing/shared/diet-type.model.ts` (slightly different — `DietTypeId` is nullable to handle "not yet selected" UI state). `DietSheetDTO` and `DietHistoryDTO` DTOs add patient + ward joined fields.

### 3.3 Visit-side models (referenced, not owned)

#### 3.3.1 `VisitModel`
File: `Code/Components/DanpheEMR.ServerModel/AppointmentModels/VisitModel.cs` (shared with the Appointment module).

Fields most relevant to nursing flows:
- `PatientVisitId` (PK), `PatientId`, `VisitCode`, `VisitType` (`"outpatient"`, `"inpatient"`, `"emergency"`), `VisitStatus` (`"initiated"`, `"checkedin"`, `"concluded"`, `"transfer"`), `AppointmentType` (`"new"`, `"referral"`, `"followup"`, `"transfer"`), `BillingStatus`, `DepartmentId`, `DepartmentName`, `PerformerId`, `PerformerName`, `ParentVisitId`, `IsVisitContinued`, `IsActive`, `IsTriaged`, `SchemeId`, `PriceCategoryId`, `ClaimCode`, `QueueNo`, `ConcludeDate`, `Remarks`, `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`.

#### 3.3.2 `FinalDiagnosisModel`
File: `Code/Components/DanpheEMR.ServerModel/MedicalRecords/FinalDiagnosisModel.cs` (in MR module).

`FinalDiagnosisId` (PK), `PatientId`, `PatientVisitId`, `ICD10ID`, `IsActive`, audit. Created/activated/deactivated in bulk during OPD Check-In, OPD Check-Out, and Exchange Doctor flows.

#### 3.3.3 `AppointmentModel`
File: `Code/Components/DanpheEMR.ServerModel/AppointmentModels/AppointmentModel.cs`.

`AppointmentId`, `PatientId`, `FirstName`, `LastName`, `Gender`, `ContactNumber`, `PerformerName`, `PerformerId`, `AppointmentType`, `AppointmentDate`, `AppointmentTime`, `AppointmentStatus`, `DepartmentId`, `CreatedOn`, `CreatedBy`, `CancelledBy`, `CancelledOn`, `MiddleName`, `Age`. Used by OPD Check-Out to schedule a follow-up.

### 3.4 Employee / Preferences

#### 3.4.1 `EmployeePreferences`
File: `Code/Components/DanpheEMR.ServerModel/EmployeeModels/EmployeePreferences.cs`

| Field | Type | Notes |
|-------|------|-------|
| `PreferenceId` | `int` (PK) | |
| `PreferenceName` | `string` | For nursing: `"NursingPatientPreferences"`. |
| `PreferenceValue` | `string` | XML document holding the favorite patients (see below). |
| `EmployeeId` | `int` | The nurse. |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |
| `IsActive` | `bool` | |

The XML schema is:

```xml
<root>
  <Row>
    <PatientVisitId>123</PatientVisitId>
    <WardId>2</WardId>
  </Row>
  <Row>...</Row>
</root>
```

Reads use `XmlDocument.LoadXml` and XPath `//PatientVisitId` / `//WardId`. Writes are done by appending a new `<Row>` element (or removing the matching `<Row>` on un-favorite).

### 3.5 Frontend-only nursing DTOs

| File | Purpose |
|------|---------|
| `nursing/shared/dto/nursing-opd-checkin.dto.ts` | `NursingOpdCheckIn_DTO` — `PatientVisitId`, `PatientId`, `PerformerId`, `PerformerName`, `DiagnosisList`, `ChiefComplaints`. |
| `nursing/shared/dto/nursing-opd-checkout.dto.ts` | `NursingOpdCheckOut_DTO` — adds `DepartmentId`, `DepartmentName`, `FollowUpDay`, `ConcludedNote`, `Visit`. |
| `nursing/shared/dto/nursing-opd-free-referral.dto.ts` | `NursingOPDFreeReferral_DTO` — `ReferredDoctorId`, `ReferreddepartmentId`, `ReferredDepartment`, `ReferredDoctor`, `ReferRemarks`, `VisitType`, `VisitStatus = "initiated"`, `AppointmentType`, `BillingStatus`, `DiagnosisList`. |
| `nursing/shared/dto/nursing-opd-exchanged-doctor-department.dto.ts` | `NursingOPDExchangedDoctorDepartment_DTO` — `ExchangedDoctorId`, `ExchangedDepartmentId`, `ExchangedDoctorName`, `ExchangedRemarks`, `DiagnosisList`. |
| `nursing/shared/dto/nursing-opd-visitlist.dto.ts` | `NursingOpdVisitList_DTO` — flat patient/visit join used by the OPD list grid. |
| `nursing/shared/dto/nursing-opd-referal-department.dto.ts` | `NewReferalDepartment_DTO` — `{ DepartmentId, DepartmentName }` minimal DTO. |
| `nursing/shared/dto/patient-details.dto.ts` | `PatientDetails` — patient + ward + bed join. |
| `nursing/shared/dto/performer-details.dto.ts` | `PerformerDetails_DTO` — doctor + department. |
| `nursing/shared/dto/diet-sheet.dto.ts` | `DietSheetDTO` — per-inpatient flat join for diet sheet grid. |
| `nursing/shared/dto/patient-diet-history.dto.ts` | `DietHistoryDTO` — patient diet history rows. |
| `nursing/shared/dto/investigation-results.dto.ts` | `InvestigationResult_DTO` — `{Test, ComponentName, Unit, Value, ResultDate}`. |
| `nursing/shared/dto/investigation-results-view.dto.ts` | `InvestigationResultsView_DTO` — pivoted view with `Values: string[]` for each date. |
| `nursing/shared/dto/chief-complaints.dto.ts` | `ChiefComplaints_DTO` — mirrors `PatientClinicalInfoModel`. |
| `nursing/shared/dto/final-diagnosis.dto.ts` | `FinalDiagnosis_DTO` — adds `IsPatientReferred` and `ReferredBy`. |
| `nursing/shared/dto/disease-group.dto.ts`, `reporting-group.dto.ts` | Lookup DTOs used for ICD-10 grouping. |
| `nursing/shared/drugs-requsition.model.ts` | `DrugsRequisitonModel` — envelope sent to pharmacy: `RequisitionId`, `VisitId`, `PatientId`, `ReferenceId`, `RequisitionItems: DrugsRequistionItemModel[]`, `selectedPatient: PHRMPatient`. |
| `nursing/shared/drugs-requistion-items.model.ts` | `DrugsRequistionItemModel` — per-item quantity, batch, expiry, item id/name. |
| `nursing/shared/hemodialysis.model.ts` | `HemodialysisModel` — full HD treatment record (pre/post vitals, vascular access, treatment data, totals, signatures). |
| `nursing/shared/nursing-drugs-request.model.ts` | Auxiliary request wrapper. |
| `nursing/shared/patientdata.interface.ts` | Interface for the global patient context shape. |

### 3.6 DTOs that live in `Services/Nursing/DTOs/`

These are C# DTOs (used as `[FromBody]` parameters) — they share the same shape as the frontend DTOs above:

| File | Class |
|------|-------|
| `Services/Nursing/DTOs/AddCheifComplaint_DTO.cs` | `AddChiefComplaint_DTO` — `InfoId, PatientId, PatientVisitId, KeyName, Value, IsActive`. |
| `Services/Nursing/DTOs/AddFinalDiagnosis_DTO.cs` | `AddFinalDiagnosis_DTO` — `FinalDiagnosisId, PatientId, PatientVisitId, ICD10ID, IsActive, ReferredBy`. |
| `Services/Nursing/DTOs/NursingExchangedDoctorDepartment_DTO.cs` | `NursingExchangedDoctorDepartment_DTO` — `PatientVisitId, ExchangedDoctorId, ExchangedDoctorName, ExchangedDepartmentId, ExchangedRemarks, DiagnosisList`. |
| `Services/Nursing/DTOs/NursingOpdCheckIn_DTO.cs` | `NursingOpdCheckIn_DTO` — `PatientVisitId, PatientId, PerformerId, PerformerName, DiagnosisList, ChiefComplaints`. |
| `Services/Nursing/DTOs/NursingOpdCheckOut_DTO.cs` | `NursingOpdCheckOut_DTO` — `PatientVisitId, PatientId, PerformerId, DepartmentId, PerformerName, DepartmentName, FollowUpDay, ConcludedNote, ConcludedDate, DiagnosisList, Visit`. |
| `Services/Nursing/DTOs/NursingOpdrefer_DTO.cs` | `NursingOpdrefer_DTO` — `PatientVisitId, PatientId, ReferredDoctorId, ReferreddepartmentId, VisitType, VisitStatus, BillingStatus, AppointmentType, ReferredDepartment, ReferredDoctor, ReferRemarks, DiagnosisList`. |

---

## 4. Database Tables

> The DanpheEMR reference project uses SQL Server with EF Core code-first models. The tables listed below correspond to the models above. **No tables are prefixed `NUR_*` in the reference — all nursing data lives in shared clinical / visit / preference / lookup tables.** The on-disk migration files would have the canonical `CREATE TABLE` DDL.

### 4.1 Clinical / I/O / Notes / Allergy / Vitals

| Table | EF Model | Purpose |
|-------|----------|---------|
| `CLN_PatientClinicalInfo` | `PatientClinicalInfoModel` | Key-value store: chief complaints, opd-triage comments, free-text clinical info, vitals summary. |
| `CLN_PatientVitals` | `VitalsModel` | Per-visit vitals capture. |
| `CLN_InputOutput` | `InputOutputModel` | Per-visit intake/output entries. |
| `CLN_ClinicalIntakeOutputParameter` | `ClinicalIntakeOutputParameterModel` | Lookup of I/O parameter names (Oral, IV Fluid, Urine, etc.) and their children. |
| `CLN_Notes` (plus child tables) | `NotesModel` + `FreeTextNoteModel` / `ProgressNoteModel` / `ProcedureNoteModel` / `EmergencyNoteModel` / `DischargeSummaryModel` / `SubjectiveNoteModel` / `ObjectiveNoteModel` / `PrescriptionNotesModel` | Clinical notes. |
| `CLN_Allergy` | `AllergyModel` | Patient allergies. |
| `CLN_PatientHomeMedication` | `HomeMedicationModel` | Home meds snapshot. |
| `CLN_ProblemList` | `ProblemList` | Chronic problem list. |
| `CLN_FamilyHistory` / `CLN_PastMedical` / `CLN_ActiveMedical` | `FamilyHistoryModel` / `PastMedicalModel` / `ActiveMedical` | Histories. |
| `CLN_ProgressNote`, `CLN_EmergencyNote`, `CLN_ProcedureNote`, `CLN_FreeTextNote` | `ProgressModel` / `EmergencyNoteModel` / `ProcedureNoteModel` / `FreeTextNoteModel` | Per-type note tables. |
| `CLN_NoteType` | `NoteTypeModel` | Note template type lookup. |

### 4.2 Consultation / Diet

| Table | EF Model | Purpose |
|-------|----------|---------|
| `CLN_ConsultationRequest` (folder misspelled `ConsulationRequests`) | `ConsultationRequestModel` | Cross-doctor consultation requests, with `Status` of "Requested" or "Consulted". |
| `CLN_DietType` | `DietTypeModel` | Diet type master. |
| `CLN_PatientDiet` | `PatientDietModel` | Per-visit diet assignment log. |
| `MR_FinalDiagnosis` | `FinalDiagnosisModel` | Final ICD-10 diagnosis. |

### 4.3 Visit / Appointment / Billing / Pharmacy / Lab / Radiology

| Table | EF Model | Purpose |
|-------|----------|---------|
| `VIS_Visit` | `VisitModel` | All visit records; carries `IsTriaged`, `VisitStatus`, `AppointmentType`, `ParentVisitId`, `IsVisitContinued`, `SchemeId`, `PriceCategoryId`, `ClaimCode`, `QueueNo`, `ConcludeDate`, `Remarks`. |
| `APT_Appointment` | `AppointmentModel` | Follow-up appointment rows created by OPD Check-Out. |
| `BIL_TXN_BillingTransactionItems` | `BillingTransactionItem` | Provisional bill items, including the `IntegrationName` of `lab` / `radiology` for ward-billing cancel eligibility. |
| `BIL_TXN_Deposit` | `BillingDeposit` | Source of `TotalDepositAmount` in nursing billing summary. |
| `BIL_MST_Scheme` | `BillingSchemeModel` | Drives `IsBillingCoPayment` flag in free-referral flow. |
| `PHRM_TXN_DrugRequisition` | (via `PHRMStock/DrugRequsition`) | Drugs requisition. |
| `LAB_TXN_LabRequisition` | (via `Lab/LabRequisitionFromBilling`) | Lab requisitions posted from nursing. |
| `RAD_TXN_ImagingRequisition` | (via `Radiology/Requisitions`) | Radiology requisitions posted from nursing. |
| `ADT_TXN_PatientBedInfo` | (via `Admission/AdmitTransferredPatient`) | Bed transfer history. |
| `ADT_MST_Ward` | `Ward` | Ward master (used to derive `WardId` for favorites and diet sheet). |
| `EMP_EmployeePreferences` | `EmployeePreferences` | XML-based preference store for nursing favorites. |
| `EMP_Employee` | `Employee` | Source of provider / consultant dropdowns. |
| `MST_Department` | `Department` | Department lookup. |
| `MST_ICD10` | `ICD10` | Diagnosis code lookup. |

### 4.4 Stored Procedures used by Nursing

| Procedure | DB Context | Used by |
|-----------|-----------|--------|
| `SP_NUR_GetOpdVisitDetails` | `VisitDbContext` | `OpdVisits`, `PastVisits` (returns today's / past OPD visit grid with patient + provider + department + appointment type + `IsTriaged`). |
| `SP_NEPH_GetDialisysPatientListWithBillingItem` | `BillingDbContext` | `getNephrologyPatients` (nephrology / dialysis patient grid). |
| `SP_CLN_GetPatientInvestigationResults` | `ClinicalDbContext` | `InvestigationResults` (lab result rows for a date range). |

---

## 5. Key Workflows

### 5.1 OPD Triage (Nurse captures chief complaints + comments)

1. Nurse opens `/Nursing/OutPatient`, sees today's visits from `SP_NUR_GetOpdVisitDetails`, split into `opdListZero` (untriaged) and `opdListOne` (triaged) by `IsTriaged`.
2. Clicks **Add Triage** or **Edit Triage** on a row → opens `OPDTriageComponent` (`opd-triage.component.ts`).
3. In edit mode, `ngOnInit` calls `nursingBlService.GetComplaints(patVisitId)` which calls `GET /api/Nursing/Complains?patientVisitId=...`. The list is partitioned: rows with `KeyName = "chief-complaint"` go to `chiefComplaints[]`; rows with `KeyName = "opd-triage-comments"` become the `comments` field.
4. Nurse adds chief complaints (free text) and a free-text comment, then clicks **Triage**.
5. `OPDTriageComponent.triage()` calls:
   - `nursingBlService.AddComplaints(this.chiefComplaints)` (POST `/api/Nursing/ClinicalInformation`) in **new** mode, or
   - `nursingBlService.UpdateClinicalInfo(...)` (PUT `/api/Nursing/ClinicalInformation?patientId=...&patientVisitId=...`) in **edit** mode.
6. Backend `AddToClinicalInfo` (new) bulk-inserts `PatientClinicalInfoModel` rows, then sets `Visit.IsTriaged = true`. `UpdateClinicalInfo` (edit) reconciles the list (soft-delete removed, update existing by `InfoId`, insert new).
7. The OPD list reloads (`LoadVisitList`) and the row flips to the triaged tab.

### 5.2 OPD Check-In (Assign doctor + diagnosis + chief complaints)

1. From the OPD list, nurse selects a row (`SelectFilteredList` in `nursing-outpatient.component.ts:521`) and clicks **CheckIn** (`NursingCheckin` button).
2. `NursingOpdCheckinComponent` (`check-in/nursing-opd-checkin.component.ts`) opens. `ngOnInit` sets `checkInDetails.PatientId`, `PatientVisitId`, `PerformerId`, `PerformerName`, `visitDate` from the selected visit.
3. Nurse can pick a different doctor (via `GetProviderList` → ADT `ProviderList`), add ICD-10 final diagnoses (via `GetICDList` → MR `ICD10` list), and add chief complaints (via `AddNewComplaintRow`).
4. `addCheckInDetails` builds a `NursingOpdCheckIn_DTO` payload and calls `nursingBLService.PostNursingCheckinDetails(...)` (POST `/api/Nursing/CheckInDetails`).
5. Backend `AddCheckInDetails` (transactional):
   - Sets `Visit.PerformerName`, `PerformerId`, `VisitStatus = "checkedin"`, `ModifiedBy/On`.
   - Inserts each `FinalDiagnosisModel`.
   - Inserts each `PatientClinicalInfoModel` (chief complaints).
6. On success, the popup closes and the OPD list reloads.

### 5.3 OPD Check-Out (Conclude visit, schedule follow-up, save diagnosis)

1. Nurse selects a row and clicks **CheckOut** (`NursingCheckOut` in `nursing-outpatient.component.ts:499`).
2. `NursingOpdChekoutComponent` (`check-out/nursing-opd-chekout.component.ts`) opens.
3. Nurse picks follow-up `FollowUpDay` (integer), enters a `ConcludedNote` (mapped to `Visit.Remarks`), and adds ICD-10 final diagnoses.
4. `addReferDetails` builds a `NursingOpdCheckOut_DTO` and calls `nursingBLService.PostNursingCheckOutDetails(...)` (POST `/api/Nursing/CheckOutDetails`).
5. Backend `AddCheckOutDetails` (transactional):
   - Reads patient demographics from `Patients` and `Visit` for the appointment row.
   - Creates a new `AppointmentModel` with `AppointmentType = "followup"`, `AppointmentDate = today + FollowUpDay`, `AppointmentStatus = "initiated"`, `CancelledBy`/`CancelledOn` set to the current user.
   - Updates the matched `Visit`: `Remarks = ConcludedNote`, `ConcludeDate = now`, `VisitStatus = "concluded"`, `ModifiedBy/On`.
   - Inserts each `FinalDiagnosisModel`.
6. Returns the updated `VisitModel`.

### 5.4 Free Referral (Nurse refers patient to another department at no charge)

1. Nurse selects a row and clicks **ChangeDoctor** (`ChangeDoctor` in `nursing-outpatient.component.ts:486`), which opens `NursingOpdFreeReferralComponent` (`free-referral/nursing-opd-free-referral.component.ts`).
2. Nurse picks referred department + referred doctor and adds remarks + diagnoses.
3. `addReferDetails` builds a `NursingOPDFreeReferral_DTO` with `VisitStatus = "initiated"`, `AppointmentType = "referral"`, `BillingStatus = "paid"`.
4. POST `/api/Nursing/VisitForFreeReferral` → `CreateVisitForFreeReferral`:
   - `VisitBL.HasDuplicateVisitWithSameProvider(...)` — throws if the patient already has an OPD visit with this doctor today.
   - Resolves `PerformerName` from `PerformerId` via `VisitBL.GetProviderName`.
   - Inherits `PriceCategoryId` and `SchemeId` from the parent visit. If `BillingScheme.IsBillingCoPayment == true`, mints a new `ClaimCode = random.Next(1, 10000) + minute + second`.
   - Inserts the new `VisitModel`, then calls `VisitBL.CreateNewPatientVisitCode` (recursive retry on `SqlException.Number == 2627`).
   - If the new visit's `AppointmentType` is `referral` / `followup` / `transfer`, calls `UpdateIsContinuedStatus` to set `IsVisitContinued = true` on the parent (and `IsActive = false` if `transfer`).
   - Async-update: if scheme is CoPayment, calls `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` against `SSFDbContext`.
   - Assigns `QueueNo = VisitBL.CreateNewPatientQueueNo(...)`.
   - Returns a `ListVisitsVM` projection (joined with department + patient) for the OPD grid.

### 5.5 Exchange Doctor / Department (Mid-visit correction)

1. Nurse selects a row and clicks **ExchangeDoctorDepartment** (`ExchangeDoctorDepartment` in `nursing-outpatient.component.ts:472`).
2. `ExchangeDoctorDepartmentComponent` (`exchange-doctor-department/exchange-doctor-department.component.ts`) opens with a reactive form (`ExchangedValidator` requiring both new department and doctor).
3. Nurse picks new department + doctor, adds remarks + diagnoses, and clicks **Submit**.
4. PUT `/api/Nursing/ExchangeDoctorDepartment` → `UpdateExchangedDoctorDepartment` (transactional):
   - Loads the matched `VisitModel` by `PatientVisitId`, sets `PerformerId`, `PerformerName`, `DepartmentId`, `Remarks`, audit.
   - **Diagnosis reconciliation** for that visit:
     - `MatchingDiagnosisList = Existing ∩ New` by `ICD10ID`. Any `IsActive = false` matches are re-activated.
     - `NewDiagnosisList = New \ Existing` → insert each as a new `FinalDiagnosisModel` with `IsActive = true`.
     - `RemovedDiagnosisList = Existing \ New` → flip `IsActive = false`.
     - Empty DTO list also deactivates all existing diagnoses for the visit.
5. On success, the popup closes and the OPD list reloads.

### 5.6 Inpatient List with Action Chips

1. Nurse navigates to `/Nursing/InPatient`. The `WardSelectionGuardService` (`shared/ward-selection-guard.service.ts`) `canActivate` redirects to `ActivateWard` if no `ActiveWard` is set on the security service.
2. `NursingInPatientComponent` (`department/nursing-inpatient.component.ts`) `LoadIPDList(searchText)` calls `nursingBLService.GetAdmittedList(fromDate, toDate, searchText, wardId)` (which proxies to `ADT_DLService.GetAdmittedList`).
3. After loading, it calls `admissionBLService.GetNursingEmployeeFavorites()` to overlay favorite flags (the favorites come from the XML in `EmployeePreferences` parsed into `List<int>`).
4. The grid renders columns: `AdmittedDate, PatientCode, AdmittingDoctorName, VisitCode, Name, PhoneNumber, Age/Sex, BedDetail, MembershipTypeName, Actions` (`NursingGridColSetting` class inside the same file).
5. The action cell renders chips based on permission + bed state:
   - **Consumption** → opens `ShowPatientConsumptionAdd` (pharmacy consumption).
   - **Patient Overview** → `router.navigate(['/Nursing/PatientOverviewMain'])` (requires `nursing-ip-summary-view`).
   - **Ward Request** → `showWardBilling = true` (requires `nursing-ip-wardbilling-view`).
   - **Transfer** → `showTransferPage = true` (requires `nursing-transfer-view`).
   - **Vitals** → `showVitalsList = true` (delegates to clinical vitals).
   - **Add Favorite** / **Remove Favorite** → `nursingBLService.AddToFavorites` / `nursingDLService.RemoveFromFavorites` (POST `/api/Nursing/FavouritePatient` and PUT `/api/Nursing/RemoveFromPreference`).
   - **Receive** (blinking button) → triggers `showReceiveNote = true` if `BedInformation.Action == "transfer"` and `ReceivedBy == null` (requires `nursing-receive-transferred-patient`).
6. The component auto-refreshes the IPD list every 60 seconds via `setInterval`.

### 5.7 Nursing Favorites (XML-based, per-nurse)

1. Backend `AddFavouritePatient` reads query string `patVisitId, preferenceType, wardId`. If `preferenceType = "nursing"`, uses `PreferenceName = "NursingPatientPreferences"`, `PatientVisitId` element name, `WardId` element name.
2. If no `EmployeePreferences` row exists for the nurse, creates one with an XML root containing a single `<Row><PatientVisitId>..</PatientVisitId><WardId>..</WardId></Row>`.
3. If a row already exists, parses the XML, appends a new `<Row>` with the new values, marks `Modified`, and saves.
4. `RemoveFromFavorites` loads the XML, uses XPath `//PatientVisitId` to find the matching node, removes its parent `<Row>`, saves.

### 5.8 Ward Billing (View + Cancel provisional items)

1. From the inpatient row's **Ward Request** action, `showWardBilling = true` renders `NursingWardBillingComponent` (`ward-billing/nursing-ward-billing.component.ts`).
2. `GetPatientProvisionalItems(patientId, visitId)` calls `billingBLService.GetInPatientProvisionalItemList(patientId, visitId, 'nursing')` to fetch provisional bill items + patient context. The returned `BillItems` are filtered to those where the source is nursing.
3. The grid renders columns: `RequisitionDate, ProvisionalReceiptNo, ServiceDepartmentName, ItemName, PerformerName, Quantity, SubTotal, RequestingUserName, OrderStatus, Action`.
4. `AllowCancellation` is computed client-side from the parameter `WardBillingColumnSettings` and the per-integration `nursingCancellationRule` (Lab / Radiology) configured under the `Common` parameter group. Items with `IntegrationName` of `lab` or `radiology` whose `OrderStatus` is in the rule list are cancellable.
5. The **Cancel** action opens a confirmation box. The nurse enters `CancelRemarks` and confirms. The action calls:
   - `nursingBLService.CancelItemRequest(item)` (PUT `/api/Billing/CancelInpatientItemFromWard`) for lab / radiology items.
   - `nursingBLService.CancelBillRequest(item)` (PUT `/api/Billing/CancelOutpatientProvisionalItem`) for other items.
6. The grid removes the cancelled row and refreshes.

### 5.9 Drugs Request (Nurse → Pharmacy)

1. From the inpatient overview's **DrugsRequest** route (`/Nursing/PatientOverviewMain/DrugsRequest`), `DrugsRequestComponent` (`drugs-request/drugs-request.component.ts`) loads.
2. `LoadItemTypeList` calls `pharmacyBLService.GetDispensaryAvailabeStockDetails()` to populate the item dropdown.
3. The nurse adds rows, picks items, sets quantity. `AssignAllValues` copies `ItemId`, `ItemName`, `BatchNo`, `ExpiryDate` from the selected item.
4. `drugsRequest` validates via `CheckValidaiton`, then calls `nursingBLServiec.PostDrugsRequisition(currSale)` which calls `POST /api/PharmacyStock/DrugRequsition` with the `DrugsRequisitonModel` envelope. Client-side omits validator fields via `_.omit` before posting.
5. On success, navigates to `/Nursing/RequisitionList` which renders `DrugRequestListComponent` (`drugs-request/drug-request-list.component.ts`). The list page calls `pharmacyBLService.GetAllPHRMProvisionalItemList()` and `GetPHRMDrugsItemList(reqId)` / `GetPHRMDrugsDispatchList(reqId)` for per-requisition details.

### 5.10 Consultation Requests (Cross-doctor request/response)

1. From the patient overview (`/Nursing/PatientOverviewMain/ConsultationRequests`), `ConsultationRequestsComponent` (`consultation-requests/consultation-requests.component.ts`) loads the nurse's view of all requests for the active visit.
2. `ngOnInit` calls `GetConsultationRequestsByPatientVisitId` (GET `/api/Clinical/ConsultationRequestsByPatientVisitId?PatientVisitId=...`) and pre-loads `GetAllApptDepartment` (GET `/api/Clinical/GetAllApptDepartment`) and `GetAllAppointmentApplicableDoctor` (GET `/api/Clinical/GetAllAppointmentApplicableDoctor`) into the shared `NursingService`.
3. **Add New Request** opens `NewRequestComponent` (`new-request/new-request.component.ts`) with a reactive form. The form forces consulting and requesting doctor to be different.
4. `AddNewRequest()` sets `Status = ENUM_ConsultationRequestStatus.Requested` ("Requested") and `IsActive = true`, then POSTs `/api/Clinical/AddNewConsultationRequest`. On success, the popup closes and the grid reloads.
5. **Respond** (clicked from the grid) re-opens `NewRequestComponent` in response mode. `ResponseConsultationRequest()` sets `Status = "Consulted"`, fills `ConsultedOn = now`, fills `ConsultantResponse`, and PUTs `/api/Clinical/ResponseConsultationRequest`.
6. **View** opens `ConsultationRequestViewPrintComponent` which renders the printable consultation form and offers `PrintConsultationForm` (browser print).

### 5.11 Diet Sheet (Per-ward diet management)

1. From the inpatient list, the nurse clicks the **Diet** tab (`ShowDietSheet` in `nursing-inpatient.component.ts:723`) to render `DietSheetComponent` (`diet-sheet/diet-sheet.component.ts`).
2. `GetAllInpatientListWithDietDetail(wardId)` (GET `/api/Clinical/InpatientListWithDietDetail?WardId=...`) populates `ipdList` with `DietSheetDTO` rows for the active ward.
3. The nurse can:
   - **Add New Diet Plan** → opens `AddPatientDietComponent` which loads `DietType` list (GET `/api/Clinical/DietTypes`) and POSTs `/api/Clinical/AddPatientDietType` with a `DietType` payload (`PatientId`, `PatientVisitId`, `DietTypeId`, `WardId`, `ExtraDiet`, `RecordedOn`, `Remarks`, `IsActive`).
   - **Patient Diet History** → opens `DietSheetPatientHistoryComponent` (GET `/api/Clinical/PatientDietHistory?PatientVisitId=...`).
   - **Print** → renders `DietSheetPrintComponent` and prints via browser print window.
4. The component supports local-date toggle, free-text search, and re-load after popups close.

### 5.12 Transfer (Cross-ward patient movement)

1. From the inpatient row's **Transfer** action, `showTransferPage = true` renders `NursingTransferComponent` (`nursing-transfer/nursing-transfer.component.ts`).
2. `ngOnInit` calls `nursingBlService.GetADTDataByVisitId(visitId)` (GET `/api/Admission/AdmittedPatientForNursing?admissionStatus=admitted&patientVisitId=...`) to fetch the current bed info.
3. The actual transfer logic is handled by the ADT `transfer` component which the user is routed to. The transfer endpoint used is `/api/Admission/AdmitTransferredPatient` (PUT) and `/api/Admission/UndoTransfer` (PUT, with `cancelRemarks` query).
4. After the transfer completes, the nursing list reloads via `TransferUpgrade($event)` callback.

### 5.13 Hemodialysis Report

1. From the nephrology page (`/Nursing/Nephrology`), `NephrologyComponent` (`department/nephrology.component.ts`) lists dialysis patients from `GetNephrologyPatients()` (GET `/api/Nursing/getNephrologyPatients`).
2. Selecting a patient opens the hemodialysis form bound to `HemodialysisModel` (the `hemodialysis.model.ts` is rich: pre/post weight, pre/post temperature, pre/post pulse, pre/post BP, vascular access checkboxes, blood transfusion fields, treatment data, on-examination notes, post-dialysis assessment, totals, signature names).
3. On submit, `nursingBlService.SubmitHemoReport(model)` (POST `/api/Admission/HemoDialysisReport`) posts the report.
4. `CheckForLastReport(patientId)` (GET `/api/Admission/LatestHemoDialysisReport?patientId=...`) and `PreviousReportList(patientId)` (GET `/api/Admission/HemoDialysisReports?patientId=...`) are used to pre-fill and show history.

### 5.14 Investigation Results (Lab results grid)

1. From the patient overview's **InvestigationResults** route, `InvestigationResultsComponent` (`investigation-results/investigation-results.component.ts`) loads.
2. Default range is the last 10 days; nurse can change `Days` (validated 1-20) to expand/contract.
3. `LoadReport` calls `nursingBLService.GetInvestigationResults(FromDate, ToDate, patientId, patientVisitId)` which calls GET `/api/Nursing/InvestigationResults` (server-side, stored proc `SP_CLN_GetPatientInvestigationResults`).
4. `FormatInvestigationResult` pivots the flat list into `InvestigationResultsView_DTO` rows: unique `(Test, ComponentName, Unit)` keys with `Values: string[]` per date header.
5. `PrintResults` triggers the printable view via `InvestigationResultsPrintComponent`.

---

## 6. API Endpoints

> All endpoints return `DanpheHTTPResponse<object>` with `Status` (`"OK"` or `"Failed"`), `Results`, and optional `ErrorMessage`. Successful POSTs typically return the inserted model. Successful PUTs typically return `true` or the updated model.

### 6.1 Nursing-owned (`/api/Nursing/*`)

| HTTP | Route | Purpose | Body / Query |
|------|-------|---------|--------------|
| GET | `/api/Nursing/OpdVisits` | Today's OPD visit list. | `?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD` |
| GET | `/api/Nursing/PastVisits` | Historic OPD visit list. | `?fromDate=...&toDate=...` |
| GET | `/api/Nursing/Complains` | Chief complaints for a visit. | `?patientVisitId=...` |
| GET | `/api/Nursing/getNephrologyPatients` | Dialysis patient list with billing item. | none |
| GET | `/api/Nursing/GetAllDepartments` | All departments. | none |
| GET | `/api/Nursing/GetBillingDetails/{PatientId}/{PatientVisitId}` | `{TotalDepositAmount, TotalPendingBillAmount}` for an inpatient. | path params |
| GET | `/api/Nursing/InvestigationResults` | Lab results for date range. | `?fromDate=...&toDate=...&patientId=...&patientVisitId=...` |
| POST | `/api/Nursing/FavouritePatient` | Add to favorites. | query `patVisitId, preferenceType, wardId` |
| POST | `/api/Nursing/ClinicalInformation` | Bulk-insert clinical info + set `IsTriaged=true`. | `List<PatientClinicalInfoModel>` |
| POST | `/api/Nursing/Complaint` | Insert one chief complaint. | `List<PatientClinicalInfoModel>` |
| POST | `/api/Nursing/CheckInDetails` | OPD check-in (doctor + diagnosis + complaints). | `NursingOpdCheckIn_DTO` |
| POST | `/api/Nursing/VisitForFreeReferral` | Create referral visit. | `NursingOpdrefer_DTO` |
| POST | `/api/Nursing/CheckOutDetails` | Conclude visit + book follow-up + diagnosis. | `NursingOpdCheckOut_DTO` |
| PUT | `/api/Nursing/ExchangeDoctorDepartment` | Update visit's doctor/dept + reconcile diagnosis. | `NursingExchangedDoctorDepartment_DTO` |
| PUT | `/api/Nursing/ClinicalInformation` | Update clinical info list (reconcile). | `List<PatientClinicalInfoModel>` + query `patientId, patientVisitId` |
| PUT | `/api/Nursing/Complaint` | Update one chief complaint. | `PatientClinicalInfoModel` |
| PUT | `/api/Nursing/RemoveFromPreference` | Remove from favorites. | query `patId, preferenceType, wardId, itemId` |

### 6.2 Cross-module endpoints called by the nursing frontend

> These are owned by other controllers but the nursing frontend depends on them.

| HTTP | Route | Owner | Used by |
|------|-------|-------|---------|
| GET | `/api/Clinical/DietTypes` | Clinical | Add patient diet / diet sheet |
| GET | `/api/Clinical/InpatientListWithDietDetail?WardId=...` | Clinical | Diet sheet |
| GET | `/api/Clinical/PatientDietHistory?PatientVisitId=...` | Clinical | Diet sheet |
| POST | `/api/Clinical/AddPatientDietType` | Clinical | Add patient diet |
| GET | `/api/Clinical/ConsultationRequestsByPatientVisitId?PatientVisitId=...` | Clinical | Consultation requests |
| GET | `/api/Clinical/PatientDetailsByPatientVisitIdForConsultationRequest?PatientVisitId=...` | Clinical | Consultation requests |
| GET | `/api/Clinical/GetAllApptDepartment` | Clinical | Consultation requests |
| GET | `/api/Clinical/GetAllAppointmentApplicableDoctor` | Clinical | Consultation requests |
| POST | `/api/Clinical/AddNewConsultationRequest` | Clinical | Consultation requests |
| PUT | `/api/Clinical/ResponseConsultationRequest` | Clinical | Consultation requests |
| GET | `/api/Billing/NursingOrderList?patientId=...` | Billing | Nursing order list |
| POST | `/api/Billing/SaveBillItemsRequisition` | Billing | Nursing order (post bill requisition items) |
| PUT | `/api/Billing/CancelInpatientItemFromWard` | Billing | Ward billing cancel (lab / radiology) |
| PUT | `/api/Billing/CancelOutpatientProvisionalItem` | Billing | Ward billing cancel (other items) |
| GET | `/api/Admission/HemoDialysisReport` (POST) | ADT | Submit hemodialysis report |
| GET | `/api/Admission/LatestHemoDialysisReport?patientId=...` | ADT | Pre-fill hemodialysis report |
| GET | `/api/Admission/HemoDialysisReports?patientId=...` | ADT | Hemodialysis history |
| PUT | `/api/Admission/AdmitTransferredPatient` | ADT | Receive transferred patient |
| PUT | `/api/Admission/UndoTransfer?cancelRemarks=...` | ADT | Undo transfer |
| GET | `/api/Admission/AdmittedPatientForNursing?admissionStatus=admitted&patientVisitId=...` | ADT | Nursing transfer page (bed info) |
| POST | `/api/PharmacyStock/DrugRequsition` | Pharmacy | Drugs requisition |
| GET | `/api/Lab/LabRequisitionFromBilling` (POST) | Lab | Lab requisition (used by historical nursing order flow) |
| POST | `/api/Radiology/Requisitions` | Radiology | Imaging requisition |
| PUT | `/api/Radiology/CancelInpatientRequisitions` | Radiology | Cancel radiology request |

---

## 7. Cross-Module Interactions

| Module | Interaction |
|--------|-------------|
| **Patient** (`web/src/app/patients/`) | The `patientService` global context provides `PatientId`, `PatientCode`, `ShortName`, `DateOfBirth`, `Gender`, `Age`, `PhoneNumber`, `Address`, `WardId`, `BedId`, `VisitCode`, `M IsPoliceCase`, `MembershipTypeId`. Nursing components call `SetPatDataToGlobal(data)` to populate this context on row click, then read from `patientService.globalPatient` and `patientService.getGlobal()`. |
| **Visit / Appointment** (`web/src/app/appointments/`) | The `visitService` global context carries `PatientVisitId`, `PatientId`, `PerformerId`, `PerformerName`, `VisitType`, `VisitDate`, `IsTriaged`, `QueueNo`. `VisitBL` (server-side) is used for `HasDuplicateVisitWithSameProvider`, `GetProviderName`, `CreateNewPatientVisitCode`, `CreateNewPatientQueueNo`, `UpdatePatientSchemeForFreeFollowupAndFreeReferral`. The visit lifecycle (`initiated → checkedin → concluded` or new child visit) is mutated inside `NursingController`. |
| **ADT** (`web/src/app/adt/`, `Controllers/Admission/`) | The inpatient list, transfer, bed info, and hemodialysis endpoints all live in the ADT module. Nursing consumes them through `ADT_DLService` and `ADT_BLService`. The nursing favorites service `GetNursingEmployeeFavorites` reads the XML preferences and returns the list of `PatientVisitId` integers. |
| **Billing** (`web/src/app/billing/`, `Controllers/Billing/`) | Ward billing reads `BillingTransactionItems` (provisional), applies per-integration cancellation rules, and posts to `SaveBillItemsRequisition` for new items and `CancelInpatientItemFromWard` / `CancelOutpatientProvisionalItem` for cancel. The `BillingDeposit` source feeds the `GetBillingDetails` summary endpoint. The `BillingScheme.IsBillingCoPayment` flag drives the `ClaimCode` mint in the free-referral flow. |
| **Pharmacy** (`web/src/app/pharmacy/`) | `DrugsRequisitonModel` is sent to `/api/PharmacyStock/DrugRequsition`. The pharmacy returns provisional items that show up in the `RequisitionList` grid. `pharmacyBLService.GetPatientConsumptionsFromNursingWard` and `GetPatientConsumptionsOfNursingWard` power the consumption / store-association view inside the inpatient list. |
| **Clinical** (`web/src/app/clinical/`) | Owns `VitalsModel`, `InputOutputModel`, `NotesModel`, `AllergyModel`, `DietTypeModel`, `PatientDietModel`, `ClinicalIntakeOutputParameterModel`. The nursing frontend uses `IOAllergyVitalsBLService` and the `ClinicalSharedModule` to render vitals, I/O, allergies, and notes inside the patient overview. Consultation requests are owned by clinical but rendered inside the nursing patient overview. |
| **Doctor / Patient Overview** (`web/src/app/doctors/`) | The `/Nursing/PatientOverviewMain` route lazy-loads the `PatientOverviewComponent` and the `ClinicalModule` (via `loadChildren`). The nursing grid uses the same ward-billing / scanned-images / clinical sub-navigation as the doctor module. |
| **Medical Records (MR)** (`web/src/app/medical-records/`) | ICD-10 list (`MR_BLService.GetICDList`) and final diagnosis persistence. The nursing OPD flows build `FinalDiagnosisModel` rows and post them through the same persistence path. |
| **Insurance / SSF** | The free-referral flow calls `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` against `SSFDbContext` when the scheme is `IsBillingCoPayment == true` and the appointment is a free follow-up / referral. |
| **Core** (`web/src/app/core/`) | `CoreService` provides `Parameters` (e.g. `Common/WardBillingColumnSettings`, `Common/ServerSideSearchComponent`, `Common/erdepartmentname`), `EnableDepartmentLevelAppointment`, `GetIpBillCancellationRule`, `IsReserveFeatureEnabled`, `GetInvoiceDisplaySettings`. |
| **Settings** | Departments, ICD-10 codes, employees all read from the settings/masters modules. |
| **Emergency** | `DrugsRequestComponent` accepts an `EmergencyPatientModel` as `@Input` and posts the same `DrugsRequisitonModel` — the drugs-request popup is shared between nursing and ER. |

---

## 8. Frontend Module Structure (Angular)

### 8.1 Routes

Declared in `web/src/app/nursing/nursing-routing.module.ts`. Top-level path: `""` → `NursingMainComponent` with children:

- `""` → redirect to `OutPatient`.
- `OutPatient` → `NursingOutPatientComponent` (guarded by `AuthGuardService`).
- `InPatient` → children:
  - `""` → redirect to `InPatientList`.
  - `InPatientList` → `NursingInPatientComponent` (guarded by `AuthGuardService, WardSelectionGuardService`).
  - `ActivateWard` → `ActivateWardComponent`.
- `PatientOverviewMain` → `PatientOverviewMainComponent` with children (all guarded):
  - `PatientOverview` → `PatientOverviewComponent`.
  - `InvestigationResults` → `InvestigationResultsComponent`.
  - `Clinical` → `loadChildren: '../clinical/clinical.module#ClinicalModule'`.
  - `WardBilling` → `NursingWardBillingComponent`.
  - `ScannedImages` → `PatientScannedImages`.
  - `DrugsRequest` → `DrugsRequestComponent`.
  - `Transfer` → `NursingTransferComponent`.
  - `ConsultationRequests` → `ConsultationRequestsComponent`.
  - `Notes` → `loadChildren: '../clinical-notes/notes.module#NotesModule'`.
- `Nephrology` → `NephrologyComponent`.
- `RequisitionList` → `DrugRequestListComponent`.
- `DischargeSummary` → `DischargeSummaryListComponent`.

`canDeactivate: [ResetPatientcontextGuard, WardSelectionGuardService]` on the parent route resets the active patient and active ward when leaving the module.

### 8.2 Providers (per-module)

`WardSelectionGuardService`, `NursingBLService`, `NursingDLService`, `BillingBLService`, `VisitDLService`, `BillingDLService`, `OrdersBLService`, `PatientsDLService`, `AppointmentDLService`, `ADT_DLService`, `PatientsBLService`, `LabsBLService`, `PharmacyService`, `PharmacyBLService`, `PharmacyDLService`, `IOAllergyVitalsBLService`, `OrderService`, `VisitBLService`, `NoteTemplateBLService`, `MR_BLService`, `MR_DLService`, `NursingService`.

### 8.3 Module imports

`ReactiveFormsModule`, `FormsModule`, `CommonModule`, `NursingRoutingModule`, `SharedModule`, `DanpheAutoCompleteModule`, `BillingSharedModule`, `ClinicalSharedModule`, `DoctorSharedModule`, `ADTSharedModule`, `SettingsSharedModule`, `PharmacyModule`.

### 8.4 Sub-feature component map

| Sub-folder | Components |
|------------|------------|
| `check-in/` | `NursingOpdCheckinComponent` — popup for OPD check-in. |
| `check-out/` | `NursingOpdChekoutComponent` — popup for OPD check-out. |
| `consultation-requests/` | `ConsultationRequestsComponent`, `NewRequestComponent`, `ConsultationRequestViewPrintComponent` (under `consultation-request-view-print/`). |
| `department/` | `NephrologyComponent`, `NursingInPatientComponent`, `NursingOutPatientComponent`, `NursingReceiveNoteComponent`, `TransferredPatientPendingComponent`, `activate-ward/ActivateWardComponent`. |
| `diet-sheet/` | `DietSheetComponent`, `AddPatientDietComponent`, `DietSheetPatientHistoryComponent` (under `patient-history/`), `DietSheetPrintComponent` (under `print/`). |
| `drugs-request/` | `DrugsRequestComponent` (popup), `DrugRequestListComponent` (list page). |
| `exchange-doctor-department/` | `ExchangeDoctorDepartmentComponent` — popup. |
| `free-referral/` | `NursingOpdFreeReferralComponent` — popup. |
| `investigation-results/` | `InvestigationResultsComponent`, `InvestigationResultsPrintComponent` (under `investigation-results-print/`). |
| `nursing-discharge-summary/` | `DischargeSummaryListComponent` — discharge summary listing. |
| `nursing-transfer/` | `NursingTransferComponent` — transfer page. |
| `opd-triage/` | `OPDTriageComponent` — OPD triage popup. |
| `order/` | `NursingOrderMainComponent`, `NursingOrderComponent`, `NursingOrderListComponent` — order entry + list (legacy / alternative). |
| `shared/` | All DTOs, models, services, `add-diagnosis/NursingAddDiagnosisComponent`, `NursingService`, `NursingBLService`, `NursingDLService`, `WardSelectionGuardService`, hemodialysis + drugs + consultation request models. |
| `ward-billing/` | `NursingWardBillingComponent`, `NursingIpBillItemRequestComponent`, `NursingIPRequestComponent`. |

### 8.5 Service responsibilities

- **`NursingDLService`** (`nursing/shared/nursing.dl.service.ts`) — thin `HttpClient` wrapper for all `api/Nursing/*` and cross-module calls used by the nursing module. Defines both `options` (form-urlencoded) and `jsonOptions` (JSON) header sets.
- **`NursingBLService`** (`nursing/shared/nursing.bl.service.ts`) — business logic wrapper that maps `BillingTransactionItem` to `BillItemRequisition` (in `GetMap_ReqItemsFromTxnItems`), maps `BillingTransactionItem` to `LabTestRequisition` and `ImagingItemRequisition`, exposes `.AddToFavorites`, `.AddComplaints`, `.GetComplaints`, `.GetAllDepartmentsList`, `.GetBillingSummaryForPatient`, `.PostNursingCheckinDetails`, `.PostfreeReferalDetails`, `.PostNursingCheckOutDetails`, `.UpdateExchangedDoctorDepartmentDetails`, `.GetAllDietTypes`, `.AddPatientDietType`, `.GetConsultationRequestsByPatientVisitId`, `.AddNewConsultationRequest`, `.ResponseConsultationRequest`, `.GetInvestigationResults`. Also omits validator-only fields with `_.omit` before posting (e.g. drugs requisition, free referral).
- **`NursingService`** (`nursing/shared/nursing-service.ts`) — simple in-memory cache of `DepartmentList` and `DoctorList` so child popups can re-use the parent's loaded lists without re-fetching.

---

## 9. Key Business Rules

| Rule | Where | Detail |
|------|-------|--------|
| **Visit status transitions** | `NursingController` | `initiated → checkedin` on Check-In; `checkedin → concluded` on Check-Out; parent becomes `concluded` when a Free Referral creates a child visit; mid-visit corrections don't change status. |
| **`IsTriaged` is a one-way flag per visit** | `AddToClinicalInfo` | First bulk insert of clinical info (chief complaints) for a visit sets `Visit.IsTriaged = true`. Subsequent edits don't reset it. |
| **Co-Payment claim code** | `CreateVisitForFreeReferral` | If `BillingScheme.IsBillingCoPayment == true`, a new `ClaimCode` is minted as `Random.Next(1, 10000).ToString("D4") + minute + second`. |
| **Duplicate provider guard** | `CreateVisitForFreeReferral` | Calls `VisitBL.HasDuplicateVisitWithSameProvider` — throws `"Patient already has visit with this Doctor today."` if the patient already has an outpatient visit with the same provider on the same day. |
| **`IsVisitContinued` semantics** | `UpdateIsContinuedStatus` | For `referral` or `followup`, sets `IsVisitContinued = true` on the parent. For `transfer`, sets `IsVisitContinued = true` AND `IsActive = false` on the parent. |
| **VisitCode retry on unique-constraint** | `GenerateVisitCodeAndSave` | Catches `DbUpdateException → SqlException.Number == 2627` and recursively retries with a new code. |
| **XML-based favorites** | `EmployeePreferences` | Stored as `<root><Row><PatientVisitId>...</PatientVisitId><WardId>...</WardId></Row></root>`. Read via `XmlDocument.LoadXml` + XPath; write via appending a new `<Row>` element. |
| **Ward-bound favorites** | `AddFavouritePatient` | Each favorite row stores both `PatientVisitId` and `WardId`, so the favorites grid can be filtered to the active ward. |
| **Ward selection guard** | `WardSelectionGuardService.canActivate` | If `ActiveWard.WardId <= 0`, the in-patient route redirects to `ActivateWard`. `canDeactivate` clears the active ward. |
| **60-second IPD auto-refresh** | `NursingInPatientComponent` | `setInterval(() => this.LoadIPDList(this.searchText), 60000)`; cleared in `ngOnDestroy`. |
| **30-second OPD auto-refresh** | `NursingOutPatientComponent` | `setInterval` reloads today's visit list every 60s (configurable via `reloadFrequency`). |
| **Cancel rule for ward billing** | `NursingWardBillingComponent.GetPatientProvisionalItems` | Honors `Common.WardBillingColumnSettings` (show price) and `Common.IpBillCancellationRule.LabItemsInNursing` / `ImagingItemsInNursing` (which `OrderStatus` values allow cancellation). |
| **Billing counter** | `NursingWardBillingComponent.GetBillingCounterForNursing` | Uses `DanpheCache.GetData(MasterType.BillingCounter)` to find a counter with `CounterType = "NURSING"`. |
| **ER detection for visit type** | `AssignSelectedDepartment` (free-referral + exchange + check-out) | Looks up `Common/erdepartmentname` parameter and sets `VisitType = "emergency"` if department name matches, otherwise `"outpatient"`. |
| **No editing of self** | `ExchangeDoctorDepartmentComponent.AddExchangedDoctorDepartmentDetails` | If `currentDepartmentId == exchangedDepartmentId` AND `currentDoctorId == exchangedDoctorId`, shows "Select another doctor" notice. |
| **Consulting ≠ Requesting** | `NewRequestComponent.CheckValidationsForNewRequest` | Both IDs must be present and different. |
| **Follow-up days range** | `CheckValidationsForNewRequest` | Required fields: `ConsultingDepartmentId`, `ConsultingDoctorId`, `PurposeOfConsultation`, `RequestingDepartmentId`, `RequestingConsultantId`. |
| **Patient summary** | `GetBillingDetails` | Computes `TotalDepositAdded = sum(InAmount where TransactionType = "Deposit")`, `TotalDepositReturned = sum(OutAmount where TransactionType in ("DepositDeduct", "ReturnDeposit"))`, `PendingBillAmount = sum(TotalAmount where BillStatus = "provisional" and IsInsurance = false)`. |
| **Investigation results pivoting** | `InvestigationResultsComponent.FormatInvestigationResult` | Builds unique `(Test, ComponentName, Unit)` set; for each, walks the date range and pushes matching values; columns = `Values: string[]` parallel to `DateHeaders`. |
| **Nepali date support** | All grids | Most grids push `NepaliDateInGridColumnDetail` columns (e.g. `RequestedOn`, `ConsultedOn`, `AdmittedDate`, `VisitDate`, `RequisitionDate`) for B.S. calendar display. |
| **i18n** | All labels | Labels in `.html` files are wrapped in translation tokens (en + bn). |
| **D1 / Cloudflare migration** | n/a | Module structure maps directly to Hono routes under `src/routes/nursing/` (D1 SQLite). The XML `EmployeePreferences.PreferenceValue` column should become a JSON column with a one-time migration to a relational `NUR_FavoritePatient` table for queryability. The `PreferenceName` constant `"NursingPatientPreferences"` becomes a domain enum value. |

---

## 10. Reference File Index

### Backend (.NET)

| Path | Purpose |
|------|---------|
| `Code/Websites/DanpheEMR/Controllers/Nursing/NursingController.cs` | Main API controller. |
| `Code/Websites/DanpheEMR/Controllers/Nursing/NursingViewController.cs` | MVC view controller. |
| `Code/Websites/DanpheEMR/Services/Nursing/DTOs/AddCheifComplaint_DTO.cs` | `AddChiefComplaint_DTO`. |
| `Code/Websites/DanpheEMR/Services/Nursing/DTOs/AddFinalDiagnosis_DTO.cs` | `AddFinalDiagnosis_DTO`. |
| `Code/Websites/DanpheEMR/Services/Nursing/DTOs/NursingExchangedDoctorDepartment_DTO.cs` | `NursingExchangedDoctorDepartment_DTO`. |
| `Code/Websites/DanpheEMR/Services/Nursing/DTOs/NursingOpdCheckIn_DTO.cs` | `NursingOpdCheckIn_DTO`. |
| `Code/Websites/DanpheEMR/Services/Nursing/DTOs/NursingOpdCheckOut_DTO.cs` | `NursingOpdCheckOut_DTO`. |
| `Code/Websites/DanpheEMR/Services/Nursing/DTOs/NursingOpdrefer_DTO.cs` | `NursingOpdrefer_DTO`. |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/PatientClinicalInfoModel.cs` | Chief complaints + clinical info. |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/VitalsModel.cs` | Vitals. |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/InputOutputModel.cs` | I/O. |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/ClinicalIntakeOutputParameterModel.cs` | I/O parameter lookup. |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/NotesModel.cs` | Notes (parent). |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/AllergyModel.cs` | Allergies. |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/ConsulationRequests/ConsultationRequestModel.cs` | Consultation requests. |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/Diet/DietTypeModel.cs` | Diet type master. |
| `Code/Components/DanpheEMR.ServerModel/ClinicalModels/Diet/PatientDietModel.cs` | Patient diet assignment. |
| `Code/Components/DanpheEMR.ServerModel/EmployeeModels/EmployeePreferences.cs` | XML-based employee preferences. |

### Frontend (Angular)

| Path | Purpose |
|------|---------|
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/nursing.module.ts` | Module declaration, providers, imports. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/nursing-routing.module.ts` | Routes. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/nursing-main.component.ts` | Landing page (uses `SecurityService.GetChildRoutes("Nursing")` to build nav). |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/nursing.dl.service.ts` | Data layer (HTTP wrapper). |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/nursing.bl.service.ts` | Business layer. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/nursing-service.ts` | In-memory state cache. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/ward-selection-guard.service.ts` | Ward guard. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/consultation-request.model.ts` | Consultation model. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/diet-type.model.ts` | Diet type request model. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/drugs-requsition.model.ts` | Drugs requisition envelope. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/drugs-requistion-items.model.ts` | Drugs requisition items. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/hemodialysis.model.ts` | Hemodialysis record. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/dto/*` | All request/response DTOs. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/check-in/nursing-opd-checkin.component.ts` | OPD check-in popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/check-out/nursing-opd-chekout.component.ts` | OPD check-out popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/opd-triage/opd-triage.component.ts` | OPD triage popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/free-referral/nursing-opd-free-referral.component.ts` | Free referral popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/exchange-doctor-department/exchange-doctor-department.component.ts` | Exchange doctor popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/department/nursing-inpatient.component.ts` | Inpatient list grid (action chips, favorites, vitals, transfer). |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/department/nursing-outpatient.component.ts` | Outpatient list grid (triage, check-in, check-out, free referral, exchange). |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/department/nephrology.component.ts` | Nephrology / dialysis landing. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/department/nursing-receive-note.component.ts` | Receive transferred patient popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/department/transferred-patient-pending.component.ts` | Pending transferred patients list. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/nursing-transfer/nursing-transfer.component.ts` | Transfer page. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/diet-sheet/diet-sheet.component.ts` | Per-ward diet sheet grid. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/diet-sheet/add-patient-diet.component.ts` | Add patient diet popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/diet-sheet/patient-history/diet-sheet-patient-history.component.ts` | Per-patient diet history popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/diet-sheet/print/diet-sheet-print.component.ts` | Diet sheet print view. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/ward-billing/nursing-ward-billing.component.ts` | Ward billing view + cancel. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/ward-billing/nursing-ip-billitem-request.component.ts` | IP bill item request popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/ward-billing/nursing-ip-request.component.ts` | IP request popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/drugs-request/drugs-request.component.ts` | Drugs request popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/drugs-request/drug-request-list.component.ts` | Requisition list. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/consultation-requests/consultation-requests.component.ts` | Consultation requests grid. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/consultation-requests/new-request/new-request.component.ts` | New request / response popup. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/consultation-requests/consultation-request-view-print/consultation-request-view-print.component.ts` | Consultation request view / print. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/investigation-results/investigation-results.component.ts` | Lab results grid. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/investigation-results/investigation-results-print/investigation-results-print.component.ts` | Lab results print. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/order/nursing-order.component.ts` | Nursing order entry (legacy Razor-backed). |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/order/nursing-order-list.component.ts` | Nursing order list. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/order/nursing-order-main.component.ts` | Nursing order wrapper. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/nursing-discharge-summary/discharge-summary-list.component.ts` | Discharge summary list. |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/shared/add-diagnosis/nursing-add-diagnosis.component.ts` | Add diagnosis (ICD-10 search). |
| `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/nursing/department/activate-ward/activate-ward.component.ts` | Ward selection. |

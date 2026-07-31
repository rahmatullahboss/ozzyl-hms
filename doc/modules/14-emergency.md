# Emergency (ER) Module

## 1. Module Overview

The Emergency (ER) module runs the front door of the hospital: it registers unscheduled walk-in and ambulance-arrival patients, triages them by clinical severity, supports an active treatment window in the casualty bay, and finalizes them into one of six outcomes (LAMA, transferred, discharged, admitted, death, or DOR — discharge on request). It also owns the ER-specific discharge summary, ward-style bill ordering for ER-boarded patients, and an opt-in consent-file upload feature.

In the .NET/SQL Server reference implementation the module is exposed through:

- **2 controllers**: `EmergencyController` (2,863 lines, all clinical + admin endpoints) and `EmergencyViewController` (legacy MVC entry that serves the Angular shell page).
- **1 EF `DbContext`**: `EmergencyDbContext` — maps 26 entities across `ER_*`, `PAT_*`, `BIL_*`, `MST_*`, `EMP_*`, `CLN_*`, `LAB_*`, `RAD_*` and `CORE_CFG_*` tables.
- **1 stored procedure**: `SP_ER_GetERTriagedPatientList` (drives the triaged-list screen).
- **5 EF tables** scoped to the module: `ER_Patient`, `ER_Patient_Cases`, `ER_DischargeSummary`, `ER_ModeOfArrival`, `ER_FileUploads`.
- **1 SQL Server trigger**: `Emergency_PoliceCase_NotificatiONTrigger` on `ER_Patient` — fires when a row is inserted/updated with `IsPoliceCase = 1` to push a notification (toggleable via `CleanUpScript.sql`).
- **Angular module** `EmergencyModule` mounted at `/Emergency/*` with 11 child routes, 4 lookups (cases, bitten-body-part, snake list, first-aid) and 21 declared components.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **ER Patient (ER_Patient)** | A row in `ER_Patient` linked 1:1 to a `VisitModel` of `VisitType = "emergency"`. Carries the full ER intake record (mode of arrival, referred-by, condition on arrival, triage code, ER status, ward no, performer/doctor, police-case flag, case details, etc.). |
| **ER Status** | The state machine of an ER row: `new` → `triaged` → `finalized`. Set on `ER_Patient.ERStatus` (string). |
| **Finalized Status** | When the patient is finalized, an additional discriminator is set: `lama`, `transferred`, `discharged`, `admitted`, `death`, `dor`. Set on `ER_Patient.FinalizedStatus`. |
| **Triage Code** | The clinical severity assigned during triage: `mild` (severity 1), `moderate` (2), `critical` (3), `death` (4). Stored on `ER_Patient.TriageCode` + `TriagedBy` + `TriagedOn`. |
| **ER Discharge Summary (ER_DischargeSummary)** | Clinical summary produced on discharge. Linked back to the ER patient via `ER_Patient.ERDischargeSummaryId`. Stores free-text fields (ChiefComplaints, OnExamination, ProvisionalDiagnosis, Investigations, TreatmentInER, AdviceOnDischarge, DischargeType, DoctorName, MedicalOfficer). |
| **ER Patient Cases (ER_Patient_Cases)** | Optional sub-record describing the case detail — supports medical, animal-bite, snake-bite, dog-bite, and "other" cases. Captures biting animal/site/country/municipality, first-aid given, date-time of bite, other-case-details. |
| **Mode Of Arrival (ER_ModeOfArrival)** | Master list of arrival modes (Ambulance, Self, Police, etc.) — extensible on the fly when an unknown value is entered at registration. |
| **ER File Uploads (ER_FileUploads)** | Patient consent files (PDF, image) uploaded to disk + DB row. File storage path is read from `CORE_CFG_Parameters.Emergency.UploadFileLocationPath`. |
| **ER Duty Doctor / Department** | Default doctor auto-assigned to every new ER visit, read from the JSON `ERDepartmentAndDutyDoctor` parameter (e.g. `EMERGENCY/CASUALTY` department + the employee whose first name matches `Duty`). |
| **ER Provisional Billing** | Optional "ER Registration" service item auto-added to `BIL_TXN_BillingTransactionItems` at registration, controlled by the `AddProvisionalToBillingOnRegistration` admin parameter. |
| **ER Counter** | The dedicated billing counter of type `emergency` — used to stamp the provisional receipt number at registration. |
| **ER Vitals** | Vitals are written to `CLN_PatientVitals`; the ER patient list surfaces the most recent vitals for the visit. A `CORE_CFG_Parameters.Emergency.ERAddVitalBeforeTriage` flag controls whether vitals must be added before triage. |

### ER Status State Machine

```
   [not registered] --(RegisterPatient / selectFromExisting)--> new
   new  --(Triage / TriagedCode)-->  triaged
   new  --(triage inline at registration with TriageCode populated)--> triaged
   triaged --(LeaveAgainstMedicalAdvice)--> finalized (lama | transferred | discharged | admitted | death | dor)
   triaged --(DischargeSummary add)-->  finalized (discharged)  // also writes ER_DischargeSummary
   new   --(UndoTriageOfPatient)-->  new
   finalized --(no terminal transitions; visible under Finalized tabs)
   ER visit --(ER-to-IPD Admission)--> linked ADT_PatientAdmission (separate AdmissionController, not part of this module)
```

The string `ERStatus` and the per-tab `FinalizedStatus` together drive the seven Finalized sub-tabs (Lama, Transferred, Discharged, Admitted, Death, DOR) plus the Triaged and New tabs on the ER dashboard.

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose |
|------|------|---------|
| `EmergencyController.cs` | `Websites/DanpheEMR/Controllers/Emergency/EmergencyController.cs` | All clinical + admin endpoints. 2,863 lines, 27 routes, owns 4 `DbContext` instances. |
| `EmergencyViewController.cs` | `Websites/DanpheEMR/Controllers/Emergency/EmergencyViewController.cs` | MVC view controller (25 lines). Renders the `EmergencyMain.cshtml` shell page used to bootstrap the Angular SPA. |

### 2.2 `EmergencyController.cs` — Endpoint Map

The controller owns 4 `DbContext` instances: `EmergencyDbContext`, `CoreDbContext`, `MasterDbContext`, `VisitDbContext`. All read endpoints wrap work in `Func<object>` and pass through `InvokeHttpGetFunction`. All write endpoints read the post body via `this.ReadPostData()` and pass through `InvokeHttpPostFunction` / `InvokeHttpPutFunction`. All multi-row writes use `Database.BeginTransaction()` and roll back on exception. The `RegisterPatient` and `updateERPatient` paths include a unique-key retry helper (`CreatePatientWithUniquePatientNum`, `CreatePatientVisitWithUniqueVisitCode`) to handle SqlException 2627 (unique-constraint violation) by regenerating the patient number / visit code and re-saving.

#### 2.2.1 HTTP GET endpoints (read)

| Route | Method | Internal Handler | Purpose |
|-------|--------|------------------|---------|
| `/api/Emergency/LatestEmergencyNumberAndModeOfArrival` | GET | `GetLatestEmergencyNumberAndModeOfArrival` | Returns next `ERPatientNumber` (max + 1) and the active `ER_ModeOfArrival` list. Used to seed the registration form. |
| `/api/Emergency/EmergencyPatients` | GET | `GetEmergencyPatients` | All active ER patients with `ERStatus = "new"`. Joined with `PAT_Patient`, `MST_EthnicGroup`, `ER_ModeOfArrival`, `PAT_PatientVisits`, `PAT_MAP_PatientSchemes`, `BIL_CFG_Scheme`, `BIL_CFG_PriceCategory`, `ER_Patient_Cases`, `CLN_PatientVitals`, `ER_FileUploads`, `MST_Municipality`. Supports `selectedCase` filter. Also returns the `ERAddVitalBeforeTriage` parameter so the client can enforce vitals-before-triage. |
| `/api/Emergency/TriagedPatients` | GET | `GetTriagedPatients` | Calls `SP_ER_GetERTriagedPatientList` (single parameter `@SelectedCase`). Returns triaged patients grouped by triage code. |
| `/api/Emergency/ExistingPatients` | GET | (inline) | `SP_Billing_PatientsListWithVisitinformation` — used for the "select existing patient" search at registration. |
| `/api/Emergency/LamaPatients` | GET | `GetFinalizedListByStatus("lama", …)` | Finalized patients whose `FinalizedStatus = "lama"`. |
| `/api/Emergency/TransferredPatients` | GET | `GetFinalizedListByStatus("transferred", …)` | Finalized + `FinalizedStatus = "transferred"`. |
| `/api/Emergency/DischargedPatients` | GET | `GetFinalizedListByStatus("discharged", …)` | Finalized + `FinalizedStatus = "discharged"`. |
| `/api/Emergency/AdmittedPatients` | GET | `GetFinalizedListByStatus("admitted", …)` | Finalized + `FinalizedStatus = "admitted"`. |
| `/api/Emergency/DeadPatients` | GET | `GetFinalizedListByStatus("death", …)` | Finalized + `FinalizedStatus = "death"`. |
| `/api/Emergency/DischargeOnRequestPatients` | GET | `GetFinalizedListByStatus("dor", …)` | Finalized + `FinalizedStatus = "dor"`. |
| `/api/Emergency/Countries` | GET | (inline LINQ) | Active `MST_Country` list. |
| `/api/Emergency/CountrySubDivisions` | GET | `GetCountrySubDivisions` | `MST_CountrySubDivision` filtered by `countryId` (or all if 0). |
| `/api/Emergency/Doctors` | GET | (inline LINQ) | `EMP_Employee` rows where `IsAppointmentApplicable = 1` and `IsActive = 1`. |
| `/api/Emergency/DischargeSummary` | GET | `GetDischargeSummary` | Composite VM `EmergencyDischargeSummaryVM` (ER patient + discharge summary + latest vitals + visit code + list of lab and imaging order names that are report-generated/result-added and not cancelled/returned). |
| `/api/Emergency/MatchingPatient` | GET | `GetMatchingPatient` | Fuzzy match for "is this person already in our patient table?" — match by exact name AND DOB within ±3 years, OR by exact phone number. |
| `/api/Emergency/ConsentForm` | GET | `GetConsentForm` | All active `ER_FileUploads` rows for a given `patientId` (ER patient id). Joins to `PAT_Patient` for the name. |
| `/api/Emergency/DownloadFile` | GET | `Download` | Streams a consent file from disk. Path is read from `CORE_CFG_Parameters.Emergency.UploadFileLocationPath`. Uses `DisableRequestSizeLimit` for large files. |

#### 2.2.2 HTTP POST endpoints (create)

| Route | Method | Internal Handler | Purpose |
|-------|--------|------------------|---------|
| `/api/Emergency/DischargeSummary` | POST | `AddDischargeSummary` | Inserts a row in `ER_DischargeSummary`, links it to the ER patient via `ERDischargeSummaryId`, and (if the patient isn't already finalized) flips `ERStatus = "finalized"` and `FinalizedStatus = "discharged"`, stamping `FinalizedBy/FinalizedOn`. All in one DB transaction. |
| `/api/Emergency/RegisterPatient` | POST | `AddPatient` | The ER registration flow. Single transaction: optionally creates a new `PAT_Patient` (if not existing) → creates a `PAT_PatientVisits` row with `VisitType = "emergency"` → resolves duty doctor from `ERDepartmentAndDutyDoctor` param → upserts a new `ER_ModeOfArrival` if the typed name is unknown → creates the `ER_Patient` row with `ERStatus = "triaged"` if `TriageCode` is supplied, else `new` → creates the `ER_Patient_Cases` row → writes a provisional billing line (see `SaveBillingTransaction` below) → upserts `PAT_MAP_PatientSchemes` (`SavePatientScheme`). |
| `/api/Emergency/UploadPatientConsentForm` | POST | `UploadPatientConsentForm` | Multipart upload. Reads `reportDetails` form field (a JSON `UploadConsentForm`), the `files` collection, and the configured upload path. Saves each file to disk with a `<original>_Ticks.<ext>` filename and inserts a row in `ER_FileUploads` with `IsActive = true`. Wrapped in a transaction. |

#### 2.2.3 HTTP PUT endpoints (update)

| Route | Method | Internal Handler | Purpose |
|-------|--------|------------------|---------|
| `/api/Emergency/TriagedCode` | PUT | `UpdateTriagedCode` | Triage a patient — sets `TriageCode`, `TriagedBy`, `TriagedOn = now`, `ERStatus = "triaged"`. Called both from the Triage popup and the inline triage-at-registration path. |
| `/api/Emergency/LeaveAgainstMedicalAdvice` | PUT | `UpdateLeaveAgainstMedicalAdvice` | Finalize the ER patient — sets `ERStatus = "finalized"`, `FinalizedStatus = actionString` (the value of the `?actionString=` query param: `lama`, `transferred`, `discharged`, `admitted`, `death`, `dor`), `FinalizedOn = now`, `FinalizedBy = currentUser.EmployeeId`, and stores `FinalizedRemarks`. |
| `/api/Emergency/UndoTriageOfPatient` | PUT | `UndoTriageOfPatient` | Roll back triage — sets `ERStatus = "new"`, `TriageCode = FinalizedRemarks` (sic), `TriagedOn = null`, stamps ModifiedBy/On. |
| `/api/Emergency/PerformerDetail` | PUT | `updatePerformer` | Change the assigned doctor (ER duty doctor) — updates both `ER_Patient.PerformerId/Name` and the linked `PAT_PatientVisits.PerformerId/Name`. |
| `/api/Emergency/ERDischargeSummary` | PUT | `UpdateDischargeSummary` | Update an existing ER discharge summary's free-text fields. Locks the immutable columns (`ERDischargeSummaryId`, `CreatedBy`, `CreatedOn`, `PatientId`, `PatientVisitId`) by setting `IsModified = false`. |
| `/api/Emergency/Patient` | PUT | `updateERPatient` | Edit a registered ER patient. Updates the linked `PAT_Patient` (only if `IsExistingPatient == false`) and `ER_Patient` (always). Upserts `ER_ModeOfArrival` if a new name is typed. Upserts `ER_Patient_Cases` if `MainCase != 1` (main case of 1 means "medical" and uses the default case; >1 means animal-bite / snake-bite / other and requires a Cases row). |
| `/api/Emergency/CosentForm` | PUT | `DeleteConsent` | Soft-delete a consent file — sets `IsActive = false` on `ER_FileUploads`. |

### 2.3 `EmergencyViewController.cs`

Single endpoint, returns the `EmergencyMain.cshtml` Razor shell page. The Angular `EmergencyModule` then takes over the SPA inside that page.

| Route | View File | RBAC Permission |
|-------|-----------|-----------------|
| `/Emergency/EmergencyMain` | `Views/EmergencyView/EmergencyMain.cshtml` | `emergency-view` |

### 2.4 Services & DbContext

| File | Path | Purpose |
|------|------|---------|
| `EmergencyDbContext.cs` | `Components/DanpheEMR.DalLayer/EmergencyDbContext.cs` | The single EF context for the module. Maps 26 entities. Exposes `GetDataTableFromStoredProc(int selectedCase)` which executes `SP_ER_GetERTriagedPatientList`. |
| `Stored Proc` | `SP_ER_GetERTriagedPatientList` | Returns the triaged patient list grouped by `TriageCode` (mild / moderate / critical / death). The exact SQL body is bundled inside the SQL Server backup `DanpheInternationalDB/Dev_DanpheEMR_INT1.bak`; column list is the same as the `GetEmergencyPatients` projection. |

---

## 3. Data Models

All models live in `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/EmergencyModels/` unless noted.

### 3.1 `EmergencyPatientModel` (table `ER_Patient`)

Primary key: `ERPatientId` (identity). Unique key: `ERPatientNumber` (per-hospital counter).

| Field | Type | Notes |
|-------|------|-------|
| `ERPatientId` | int (PK identity) | |
| `ERPatientNumber` | int | Sequential per-hospital counter. Generated by `GetLatestERPatientNum` (max + 1). |
| `PatientId` | int? | FK `PAT_Patient`. Denormalized. |
| `PatientVisitId` | int? | FK `PAT_PatientVisits` (VisitType = "emergency"). |
| `ERDischargeSummaryId` | int? | FK `ER_DischargeSummary`. Set on `AddDischargeSummary`. |
| `VisitDateTime` | DateTime? | Set at registration to `DateTime.Now`. |
| `FirstName`, `MiddleName`, `LastName` | string | Mirrored from `PAT_Patient` so the ER record is self-contained even after the linked patient is later edited. |
| `Gender`, `Age`, `DateOfBirth` | string / DateTime? | Mirrored demographics. |
| `ContactNo` | string | Patient phone. |
| `CareOfPersonContactNumber` | string | Caretaker phone. |
| `Address` | string | |
| `ReferredBy`, `ReferredTo` | string | Free-text referral fields. |
| `Case` | string | Free-text case summary. |
| `ConditionOnArrival` | string | E.g. Stable / Critical / Brought Dead. |
| `BroughtBy` | string | E.g. Ambulance, Family, Police. |
| `RelationWithPatient` | string | Caretaker relationship. |
| `ModeOfArrival` | int? | FK `ER_ModeOfArrival`. |
| `CareOfPerson` | string | Caretaker name. |
| `ERStatus` | string | `new` \| `triaged` \| `finalized` (state machine). |
| `TriageCode` | string | `mild` \| `moderate` \| `critical` \| `death` (see Triage severity mapping). |
| `TriagedBy` | int? | FK `EMP_Employee`. |
| `TriagedOn` | DateTime? | |
| `IsActive` | bool | Soft-delete flag. Inactive rows are hidden from lists. |
| `IsExistingPatient` | bool | True if the patient already existed in `PAT_Patient` at registration time. |
| `OldPatientId` | string | Legacy patient id. |
| `WardNo` | int? | ER ward/zone number. |
| `FinalizedStatus` | string | `lama` \| `transferred` \| `discharged` \| `admitted` \| `death` \| `dor`. Set when `ERStatus = "finalized"`. |
| `FinalizedRemarks` | string | Free-text remarks saved on finalize (used for LAMA reason etc.). |
| `FinalizedBy` | int? | |
| `FinalizedOn` | DateTime? | |
| `PerformerId` | int? | FK `EMP_Employee` — the assigned ER doctor. Mirrored onto `PAT_PatientVisits.PerformerId` and editable via the Assign Doctor popup. |
| `PerformerName` | string | |
| `IsPoliceCase` | bool? | Triggers the `Emergency_PoliceCase_NotificatiONTrigger` SQL Server trigger. |
| **NotMapped** | | |
| `MainCase` | int? | 1 = Medical, 2/3/4 = Animal/Snake/Dog bite, 5 = Other. |
| `SubCase` | int? | Sub-classification. |
| `OtherCaseDetails` | string | Free-text case notes. |
| `PatientCode` | string | Mirrored from `PAT_Patient` for list rendering. |
| `FullName` | string | Computed. |
| `CountryId`, `CountrySubDivisionId`, `MunicipalityId`, `EthnicGroup` | | Passed in at registration from the address controls. |
| `DefaultDepartmentName` | string | Used to derive the visit `DepartmentId` at registration. |
| `ModeOfArrivalName` | string | Mirrors the typed name when `ModeOfArrival` is not yet known. |
| `PatientCases` | `EmergencyPatientCases` | Sub-record (see §3.3). |
| `SchemeId`, `PriceCategoryId` | int | FK `BIL_CFG_Scheme` / `BIL_CFG_PriceCategory`. Mirrored from the visit. |
| `PatientScheme` | `PatientSchemeMapModel` | Used to upsert the credit-limit/claim-code map at registration. |

### 3.2 `ModeOfArrival` (table `ER_ModeOfArrival`)

| Field | Type | Notes |
|-------|------|-------|
| `ModeOfArrivalId` | int (PK identity) | |
| `ModeOfArrivalName` | string | E.g. `Ambulance`, `Self`, `Police`, `Stretcher`. Case-insensitive unique check at registration — if not found, a new row is auto-created. |
| `IsActive` | bool | |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | Standard. |

### 3.3 `EmergencyPatientCases` (table `ER_Patient_Cases`)

Sub-record linked to `ER_Patient` by `ERPatientId`. Only created when `MainCase != 1` (i.e. the case is not a plain medical case).

| Field | Type | Notes |
|-------|------|-------|
| `PatientCaseId` | int (PK identity) | |
| `ERPatientId` | int? | FK `ER_Patient`. |
| `MainCase` | int? | 2 = Animal bite, 3 = Snake bite, 4 = Dog bite, 5 = Other. |
| `SubCase` | int? | |
| `OtherCaseDetails` | string | Free-text. |
| `BitingSite` | int? | FK `LookUpType` (Type=2 = "Bitten Body Part"). |
| `DateTimeOfBite` | DateTime? | |
| `BitingAnimal` | int? | FK `LookUpType` (Type=3 = "Snake List"). |
| `BitingAnimalName` | string | Free-text animal name. |
| `FirstAid` | int? | FK `LookUpType` (Type=4 = "First Aid List"). |
| `FirstAidOthers` | string | |
| `BitingAnimalOthers`, `BitingSiteOthers` | string | |
| `BitingCountry` | int | FK `MST_Country`. |
| `BitingMunicipality` | int | FK `MST_Municipality`. |
| `BitingAddress` | string | Free-text address. |
| `IsActive` | bool? | |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |

### 3.4 `EmergencyDischargeSummaryModel` (table `ER_DischargeSummary`)

Linked back to the ER patient via `ER_Patient.ERDischargeSummaryId`. Created on `AddDischargeSummary` and read back into the `EmergencyDischargeSummaryVM` projection.

| Field | Type | Notes |
|-------|------|-------|
| `ERDischargeSummaryId` | int (PK identity) | |
| `PatientId` | int | FK `PAT_Patient`. |
| `PatientVisitId` | int | FK `PAT_PatientVisits`. |
| `DischargeType` | string | Mirrors `ER_Patient.FinalizedStatus` at finalize time. |
| `ChiefComplaints` | string | |
| `TreatmentInER` | string | |
| `Investigations` | string | JSON-encoded list of investigations (lab + imaging + other). |
| `AdviceOnDischarge` | string | JSON-encoded list of advice lines. |
| `OnExamination` | string | |
| `ProvisionalDiagnosis` | string | |
| `DoctorName` | string | Selected doctor display name. |
| `MedicalOfficer` | string | Selected medical officer display name. |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |

### 3.5 `UploadConsentForm` (table `ER_FileUploads`)

| Field | Type | Notes |
|-------|------|-------|
| `FileId` | int (PK identity) | |
| `ERPatientId` | int | FK `ER_Patient`. |
| `PatientId` | int | FK `PAT_Patient`. |
| `FileName` | string | `<original>_<ticks>.<ext>` — the on-disk filename. |
| `FileType` | string | Extension (e.g. `.pdf`). |
| `DisplayName` | string | Friendly UI name. |
| `CreatedOn` | DateTime | |
| `CreatedBy`, `ModifiedBy`, `ModifiedOn` | audit | |
| `IsActive` | bool? | Soft-delete flag (set to `false` on `DeleteConsent`). |

### 3.6 `CoreLookupDetail` (table `CORE_LookUpDetail`)

Generic lookup table used by the four ER lookups. Referenced via `LookUpTypeEnum`:

| Type | Lookup |
|------|--------|
| 1 | ER Cases (MainCase / SubCase) |
| 2 | Bitten Body Part (BitingSite) |
| 3 | Snake List (BitingAnimal) |
| 4 | First Aid (FirstAid) |

| Field | Type | Notes |
|-------|------|-------|
| `Id` | int (PK) | |
| `Type` | `LookUpTypeEnum` | Discriminator. |
| `Name` | string | |
| `Description` | string | |
| `DisplayName` | string | |
| `DisplaySequence` | int? | |
| `ParentId` | int? | Self-referencing for sub-cases. |
| `IsActive` | bool | |
| `ChildLookUpDetails` | `[NotMapped] IEnumerable<CoreLookupDetail>` | Lazy-loaded children. |

### 3.7 `EmergencyDischargeSummaryVM` (view model, not mapped)

Composite read-model returned by `GetDischargeSummary` and consumed by `er-discharge-summary.component.ts`.

| Field | Type | Source |
|-------|------|--------|
| `EmergencyPatient` | `EmergencyPatientModel` | `ER_Patient` |
| `DischargeSummary` | `EmergencyDischargeSummaryModel` | `ER_DischargeSummary` (may be null if not yet added) |
| `Vitals` | `VitalsModel` | Latest `CLN_PatientVitals` for the visit |
| `VisitCode` | string | `PAT_PatientVisits.VisitCode` |
| `LabOrders` | `List<string>` | Distinct `LabTestName` from `LAB_TestRequisition` with `OrderStatus IN ('report-generated','result-added')` and `BillingStatus NOT IN ('cancelled','returned')` |
| `ImagingOrders` | `List<string>` | `ImagingItemName` from `RAD_PatientImagingRequisition` with `BillingStatus NOT IN ('cancelled','returned')` |

### 3.8 `EmergencyTriagedPatientVM` (view model, not mapped)

Historical DTO for the (now-replaced) per-severity LINQ triaged list (`GetTriagePatientsByTriageCode`). Mirrors `EmergencyPatientModel` plus `TriagedByName`, `ProviderId`/`ProviderName` (= Performer), `AgeSex` (`"{Age}/{Gender[0]}"`), and `SchemeId`/`PriceCategoryId` from `PAT_MAP_PatientSchemes`. The current code path uses the stored procedure `SP_ER_GetERTriagedPatientList` instead and returns a `DataTable`.

### 3.9 `ERParamClass` (helper, not mapped)

Two-field JSON DTO read from `CORE_CFG_Parameters.Emergency.ERDepartmentAndDutyDoctor` and used to resolve the default ER doctor at registration.

| Field | Type | Notes |
|-------|------|-------|
| `DepartmentName` | string | E.g. `EMERGENCY/CASUALTY`. |
| `ERDutyDoctorFirstName` | string | E.g. `Duty`. The employee whose `DepartmentId` matches and whose `FirstName` matches is auto-assigned as `PerformerId/PerformerName`. |

### 3.10 `FinalizedPatientModel` (legacy DTO, not mapped)

Mirrors the projection returned by `GetFinalizedListByStatus` (Lama / Transferred / Discharged / Admitted / Death / DOR tabs) and consumed by the `er-*-patient-list.component.ts` files. Carries `FinalizedByName` (joined from `EMP_Employee`) and the latest `ERDischargeSummary` row.

---

## 4. Database Tables (ER scope)

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `ER_Patient` | ER intake record + state machine (`ERStatus`, `FinalizedStatus`, `TriageCode`). | `ERPatientId` (identity) |
| `ER_Patient_Cases` | Animal-bite / snake-bite / dog-bite / other case sub-record. | `PatientCaseId` (identity) |
| `ER_DischargeSummary` | ER discharge summary free-text + JSON investigations/advice. | `ERDischargeSummaryId` (identity) |
| `ER_ModeOfArrival` | Master list of arrival modes. | `ModeOfArrivalId` (identity) |
| `ER_FileUploads` | Consent files (DB row, file on disk). | `FileId` (identity) |
| `CORE_LookUpDetail` | Generic lookup — drives the four ER lookups (cases, bitten body part, snake list, first aid). | `Id` |
| `CORE_CFG_Parameters` | The three `Emergency` parameters: `ERDepartmentAndDutyDoctor` (JSON), `AddProvisionalToBillingOnRegistration` (`"true"`/`"false"`/`"1"`), `ERAddVitalBeforeTriage` (string, surfaced to UI), `ErRegistrationServiceItem` (JSON `{ErRegistrationServiceItemId}`), `UploadFileLocationPath` (filesystem path), `EmergencyRegistrationDisplaySettings` (JSON `{ShowIsPoliceCase}`). | `ParameterId` |

ER trigger:

- `Emergency_PoliceCase_NotificatiONTrigger` on `ER_Patient` (INSERT/UPDATE) — fires when a row is saved with `IsPoliceCase = 1`. Disables/enables are managed in `CleanUpScript.sql` (lines 7, 855, 891).

Cross-referenced tables the ER module reads or writes (not in `ER_` scope):

| Table | Why ER touches it |
|-------|-------------------|
| `PAT_Patient` | Creates new patient (if not existing); mirrors demographics. |
| `PAT_PatientVisits` | Creates a Visit with `VisitType = "emergency"`, sets `DepartmentId`, `PerformerId`, `SchemeId`, `PriceCategoryId`. Generates `VisitCode` via `VisitBL.CreateNewPatientVisitCode("emergency", …)` with unique-key retry. |
| `PAT_MAP_PatientSchemes` | Upserts (Scheme × Patient × PriceCategory) and decrements `OpCreditLimit` / `GeneralCreditLimit` when a scheme is credit-limited. |
| `BIL_TXN_BillingTransactionItems` | Writes the `Emergency Registration` service item as a provisional bill line (when enabled). Uses `BIL_CFG_Counter` where `CounterType = "emergency"`. |
| `BIL_MST_ServiceItem` + `BIL_MAP_PriceCategoryServiceItem` | Resolves the registration service item + price for the given `PriceCategoryId`. |
| `BIL_CFG_Scheme` + `BIL_MAP_ServiceItemSchemeSetting` | Honors co-payment (`CoPaymentCashPercent`, `CoPaymentCreditPercent`) when the scheme is `IsOpBillCreditApplicable` + `IsBillingCoPayment`. |
| `BIL_CFG_FiscalYears` + `BillingBL.GetFiscalYear/GetProvisionalReceiptNo` | Stamps the provisional receipt number. |
| `EMP_Employee` | Doctor list (filter `IsAppointmentApplicable = 1`); ER duty doctor lookup (Department + FirstName). |
| `MST_Department` | Resolves `ERDepartmentAndDutyDoctor` department to `DepartmentId`. |
| `MST_Country` + `MST_CountrySubDivision` + `MST_Municipality` + `MST_EthnicGroup` | Address + ethnicity dropdowns. |
| `CLN_PatientVitals` | Latest vitals surfaced on the ER list. |
| `LAB_TestRequisition` | Lists finalized lab orders on the discharge summary VM (filtered to `report-generated`/`result-added` and not cancelled/returned). |
| `RAD_PatientImagingRequisition` | Same for imaging. |
| `ADT_PatientAdmission` | (Read) ER Admitted list shows patients whose `ERStatus="finalized"` and `FinalizedStatus="admitted"`. The actual ADT admission row is created by the `Admission` module, not here. |

---

## 5. Key Workflows

### 5.1 ER Registration (new patient)

1. Frontend (`er-patient-registration.component.ts`) loads `/api/Emergency/LatestEmergencyNumberAndModeOfArrival` to pre-fill the form (next ER number + Mode-of-Arrival list) and looks up country / district / cases / bitten-body-part / snake / first-aid dropdowns.
2. User fills demographics, mode of arrival, referred-by, referred-to, condition on arrival, ward no, case (medical or animal-bite / snake-bite / dog-bite / other), police-case flag, scheme + price category. Optional "Find Existing Patient" calls `/api/Emergency/MatchingPatient` to detect an existing record.
3. On submit the frontend POSTs the `EmergencyPatientModel` to `/api/Emergency/RegisterPatient?selectedFromExisting={true|false}`.
4. Backend (`AddPatient`) runs in a single transaction:
   1. If `!selectedFromExisting && PatientId is empty` → create a new `PAT_Patient` row, run `PatientBL.GetPatNumberNCodeForNewPatient` to get a unique `PatientNo` + `PatientCode` (with retry helper on SqlException 2627).
   2. Resolve ER duty doctor from `CORE_CFG_Parameters.Emergency.ERDepartmentAndDutyDoctor` (JSON `ERParamClass`) → look up the employee in that department whose first name matches → set `emergencyPatient.PerformerId/Name`.
   3. Create a `VisitModel` with `VisitType = "emergency"`, `VisitStatus = "initiated"`, `BillingStatus = "provisional"`, `AppointmentType = "New"`, copy `SchemeId/PriceCategoryId/PerformerId/PerformerName`, and assign `DepartmentId` from `emergencyPatient.DefaultDepartmentName`. Call `VisitBL.CreateNewPatientVisitCode("emergency", connString)` with unique-key retry.
   4. If `ModeOfArrival` is empty but `ModeOfArrivalName` is set → upsert `ER_ModeOfArrival` (case-insensitive match).
   5. If `TriageCode` is populated at registration time → set `ERStatus = "triaged"` and stamp `TriagedBy/On`. Else `ERStatus = "new"`.
   6. Insert `ER_Patient` with `ERPatientNumber = latestEmergencyUniqueNumber` and `IsExistingPatient` flag.
   7. If `MainCase` is null, default to `1` (Medical). Insert `ER_Patient_Cases` with the case sub-record.
   8. Call `SaveBillingTransaction`: if `AddProvisionalToBillingOnRegistration = "1"`/`"true"`, add a `BIL_TXN_BillingTransactionItems` row for the `ErRegistrationServiceItemId` resolved from `CORE_CFG_Parameters.Emergency.ErRegistrationServiceItem`. Set price from `BIL_MAP_PriceCategoryServiceItem` for the visit's `PriceCategoryId`. Stamp provisional receipt number + counter (`BIL_CFG_Counter` where `CounterType = "emergency"`) + active fiscal year. Apply scheme co-payment if applicable.
   9. Call `SavePatientScheme` to upsert `PAT_MAP_PatientSchemes` (decrement `OpCreditLimit`/`GeneralCreditLimit` if the scheme is credit-limited; set `LatestClaimCode` to the visit's claim code; set `LatestPatientVisitId`).
   10. Commit the transaction and return the `EmergencyPatientModel` to the frontend.
5. Frontend refreshes the ER patient list.

### 5.2 Triage

1. From the New ER Patient list (`er-patient-list.component.ts` → `er-triage-actions.component.ts`), the user clicks "Triage" and selects a severity button (1=mild, 2=moderate, 3=critical, 4=death). The component maps the integer to a `TriageCode` string.
2. PUT `/api/Emergency/TriagedCode` with the patient object → `UpdateTriagedCode` sets `TriageCode`, `TriagedBy`, `TriagedOn = now`, `ERStatus = "triaged"`. Returns the updated patient.
3. Patient disappears from the New tab and appears in the Triaged tab (driven by `SP_ER_GetERTriagedPatientList`).
4. Optional undo: PUT `/api/Emergency/UndoTriageOfPatient` → `UndoTriageOfPatient` resets `ERStatus = "new"`, clears `TriageCode` and `TriagedOn`.

### 5.3 Assign Doctor

1. From the Triage or New list, the user opens the Assign Doctor popup (`assign-doctor.component.ts`). The frontend loads `/api/Emergency/Doctors` for the dropdown.
2. On save, PUT `/api/Emergency/PerformerDetail` → `updatePerformer` updates both `ER_Patient.PerformerId/Name` and the linked `PAT_PatientVisits.PerformerId/Name` in one save (uses explicit `Property.IsModified = true` to avoid overwriting other fields).

### 5.4 ER-to-Finalize (LAMA / Transferred / Discharged / Admitted / Death / DOR)

1. From the Triaged list, the user opens the LAMA popup (`er-lama.component.ts`), enters a `FinalizedRemarks` (required), and clicks a button (the `action` input drives the value).
2. The component calls `_emergencyBLService.PutLamaOfERPatient(patient, actionString)` → PUT `/api/Emergency/LeaveAgainstMedicalAdvice?actionString={lama|transferred|discharged|admitted|death|dor}`.
3. `UpdateLeaveAgainstMedicalAdvice` sets `ERStatus = "finalized"`, `FinalizedStatus = actionString`, `FinalizedOn = now`, `FinalizedBy = currentUser.EmployeeId`, and saves the remarks.
4. The patient disappears from the Triaged tab and appears under the matching Finalized tab. The same `er-lama.component.ts` is reused with `action = "discharged"` to drive the discharge path.

### 5.5 ER Discharge Summary

1. From the Triaged (or Discharged) list, the user opens `er-discharge-summary.component.ts` → it calls `GetDischargeSummaryDetail(patientId, visitId)` → GET `/api/Emergency/DischargeSummary` → returns the `EmergencyDischargeSummaryVM` (ER patient + discharge summary + vitals + visit code + ordered lab/imaging names).
2. If no summary exists yet, the user is shown `add-er-discharge-summary.component.ts` (Add form). If it exists, `view-er-discharge-summary.component.ts` (View form). Both bind to the same free-text fields + JSON `Investigations` + JSON `AdviceOnDischarge` + doctor/medical-officer selection.
3. On Add submit → POST `/api/Emergency/DischargeSummary` → `AddDischargeSummary`:
   1. Insert `ER_DischargeSummary` with `CreatedBy/On`.
   2. Update the ER patient: `ERDischargeSummaryId = <new>`. If not already finalized → also set `ERStatus = "finalized"`, `FinalizedStatus = "discharged"`, `FinalizedBy/On`. Stamps only the changed columns.
   3. Commit, return the saved summary.
4. On Edit (View → Edit) → PUT `/api/Emergency/ERDischargeSummary` → `UpdateDischargeSummary` updates free-text fields and locks the immutable columns.
5. Once saved, the ER patient appears in the Discharged tab on the Finalized screen.

### 5.6 ER-to-IPD Admission (ER-Admitted list)

1. The ER Admitted list (`er-admitted-patient-list.component.ts`) shows patients whose `ERStatus = "finalized"` and `FinalizedStatus = "admitted"`. They were created by ER staff (e.g. via the LAMA flow with `action = "admitted"`), but the actual ADT bed-allocation happens in the `Admission` module (`AdmissionController.CreateAdmission`).
2. From the ER patient overview (`PatientOverviewMainComponent` → `PatientOverviewComponent`), the user can open the Clinical chart or Ward Billing screen to continue treatment in the ER observation zone.
3. The ER Admitted tab tracks ER patients who are still being managed in the casualty bay (e.g. awaiting an inpatient bed) — it is informational; the actual IPD admission and bed allocation is owned by the `Admission` module.

### 5.7 ER Ward Billing (ER-boarded patient)

1. From the ER overview, the user opens the Ward Billing screen (`er-wardbilling.component.ts`). The component loads the provisional billing items via `_billingBLService.GetInPatientProvisionalItemList(patientId, visitId, 'emergency')` and the pharmacy orders via `_pharmacyBLService.GetAllDrugOrderOfERPatient(patientId, visitId)`.
2. The user can add new service items (lab / imaging / other) by calling `GetServiceItems(ENUM_ServiceBillingContext.OpBilling, schemeId, priceCategoryId)` to get the scheme-aware service-item list. The Add Order popup posts to the Lab / Radiology / Billing controllers.
3. Cancellation honours the `IpBillCancellationRule` config — `ERCancellationRule.labStatus` and `ERCancellationRule.radiologyStatus` are loaded from the IP cancellation rule and surfaced per row.
4. Drugs request is delegated to `DrugsRequestComponent` (Nursing module).

### 5.8 ER Bed Information (read-only)

1. The Bed Information screen (`bed-informations.component.ts`) calls `/api/Helpdesk/BedOccupancyOfWards` (Helpdesk controller, not part of this module) and shows per-ward bed occupancy. Read-only — no ER-specific write path.

### 5.9 Consent File Upload

1. From the ER patient list, the user clicks "Consent" on a row → opens `upload-consent.component.ts` (under `patients-list/Consent/`).
2. The user picks one or more files, and the component calls `UploadConsentForm` (`_emergencyBLService.UploadConsentForm`) which builds a `FormData` and POSTs to `/api/Emergency/UploadPatientConsentForm` (multipart).
3. Backend (`UploadPatientConsentForm`) reads the `reportDetails` JSON `UploadConsentForm`, the file collection, and `CORE_CFG_Parameters.Emergency.UploadFileLocationPath`. For each file it appends a `<original>_<ticks>.<ext>` filename, writes the bytes to disk (creating the directory if needed), and inserts a row in `ER_FileUploads` with `IsActive = true`. All-or-nothing transaction.
4. List/download uses `GET /api/Emergency/ConsentForm?patientId={id}` and `GET /api/Emergency/DownloadFile?FileId={id}` (the downloader streams the file with the correct content-type).
5. Delete (soft): `PUT /api/Emergency/CosentForm?id={fileId}` → `DeleteConsent` sets `IsActive = false`.

---

## 6. API Endpoints (full list)

All endpoints are mounted under `/api/Emergency/` and routed by `EmergencyController.cs` (base class `CommonController`). Auth is via the `RbacUser` session — `currentUser.EmployeeId` is stamped on every write. The complete list (27 routes):

| # | Method | Route | Handler | Description |
|---|--------|-------|---------|-------------|
| 1 | GET | `/api/Emergency/LatestEmergencyNumberAndModeOfArrival` | `GetLatestEmergencyNumberAndModeOfArrival` | Next ER number + mode-of-arrival dropdown. |
| 2 | GET | `/api/Emergency/EmergencyPatients?selectedCase=` | `GetEmergencyPatients` | Active ER patients with `ERStatus = "new"`. |
| 3 | GET | `/api/Emergency/TriagedPatients?selectedCase=` | `GetTriagedPatients` | Triaged list (via `SP_ER_GetERTriagedPatientList`). |
| 4 | GET | `/api/Emergency/ExistingPatients?search=` | (inline) | Existing-patient search for "select from existing". |
| 5 | GET | `/api/Emergency/LamaPatients?selectedCase=` | `GetFinalizedListByStatus("lama")` | Finalized LAMA list. |
| 6 | GET | `/api/Emergency/TransferredPatients?selectedCase=` | `GetFinalizedListByStatus("transferred")` | Finalized Transferred list. |
| 7 | GET | `/api/Emergency/DischargedPatients?selectedCase=` | `GetFinalizedListByStatus("discharged")` | Finalized Discharged list. |
| 8 | GET | `/api/Emergency/AdmittedPatients?selectedCase=` | `GetFinalizedListByStatus("admitted")` | Finalized Admitted list. |
| 9 | GET | `/api/Emergency/DeadPatients?selectedCase=` | `GetFinalizedListByStatus("death")` | Finalized Death list. |
| 10 | GET | `/api/Emergency/DischargeOnRequestPatients?selectedCase=` | `GetFinalizedListByStatus("dor")` | Finalized DOR list. |
| 11 | GET | `/api/Emergency/Countries` | (inline) | Active countries. |
| 12 | GET | `/api/Emergency/CountrySubDivisions?countryId=` | `GetCountrySubDivisions` | Districts / states. |
| 13 | GET | `/api/Emergency/Doctors` | (inline) | Appointment-applicable doctors. |
| 14 | GET | `/api/Emergency/DischargeSummary?patientId=&visitId=` | `GetDischargeSummary` | ER discharge summary VM. |
| 15 | GET | `/api/Emergency/MatchingPatient?firstName=&lastName=&dateOfBirth=&phoneNumber=` | `GetMatchingPatient` | Fuzzy patient match for the registration form. |
| 16 | GET | `/api/Emergency/ConsentForm?patientId=` | `GetConsentForm` | Consent file list for an ER patient. |
| 17 | GET | `/api/Emergency/DownloadFile?FileId=` | `Download` | Stream a consent file. |
| 18 | POST | `/api/Emergency/RegisterPatient?selectedFromExisting={true|false}` | `AddPatient` | New / existing-patient ER registration. |
| 19 | POST | `/api/Emergency/DischargeSummary` | `AddDischargeSummary` | Add ER discharge summary + finalize. |
| 20 | POST | `/api/Emergency/UploadPatientConsentForm` | `UploadPatientConsentForm` | Multipart consent upload. |
| 21 | PUT | `/api/Emergency/TriagedCode` | `UpdateTriagedCode` | Set triage code + status. |
| 22 | PUT | `/api/Emergency/LeaveAgainstMedicalAdvice?actionString={lama|transferred|discharged|admitted|death|dor}` | `UpdateLeaveAgainstMedicalAdvice` | Finalize ER patient. |
| 23 | PUT | `/api/Emergency/UndoTriageOfPatient` | `UndoTriageOfPatient` | Roll back triage. |
| 24 | PUT | `/api/Emergency/PerformerDetail` | `updatePerformer` | Change assigned doctor. |
| 25 | PUT | `/api/Emergency/ERDischargeSummary` | `UpdateDischargeSummary` | Update ER discharge summary free-text. |
| 26 | PUT | `/api/Emergency/Patient` | `updateERPatient` | Edit registered ER patient. |
| 27 | PUT | `/api/Emergency/CosentForm?id={fileId}` | `DeleteConsent` | Soft-delete a consent file. |

Plus the legacy MVC shell: `GET /Emergency/EmergencyMain` → `EmergencyViewController.EmergencyMain`.

---

## 7. Cross-Module Integration

| Module | Direction | Touchpoint |
|--------|-----------|------------|
| **Patient** | Bidirectional | `EmergencyController` creates a new `PAT_Patient` at registration when `selectedFromExisting = false`; `EmergencyController.updateERPatient` updates demographics; `EmergencyController.GetMatchingPatient` searches the patient table. `EmergencyDLService.GetPatients` (via stored proc `SP_Billing_PatientsListWithVisitinformation`) feeds the existing-patient search. |
| **Visit** | Write | `EmergencyController.AddPatient` creates a `PAT_PatientVisits` row with `VisitType = "emergency"`, `VisitStatus = "initiated"`, `BillingStatus = "provisional"`, `AppointmentType = "New"`, and assigns `DepartmentId`, `PerformerId`, `SchemeId`, `PriceCategoryId`. `updatePerformer` also rewrites `PAT_PatientVisits.PerformerId/Name`. `VisitBL.CreateNewPatientVisitCode("emergency", connString)` generates a unique `VisitCode`. `VisitBL.CreateNewPatientQueueNo(visitDbContext, visitId, connString)` generates the queue number. |
| **Billing** | Write | `SaveBillingTransaction` (inside `AddPatient`) writes a provisional line to `BIL_TXN_BillingTransactionItems` for the configured `ErRegistrationServiceItemId` when `AddProvisionalToBillingOnRegistration` is enabled. `SavePatientScheme` upserts `PAT_MAP_PatientSchemes` and decrements credit limits. `BillingBL.GetFiscalYear` and `BillingBL.GetProvisionalReceiptNo` provide the fiscal-year and provisional-receipt stamps. `BIL_MST_ServiceItem` + `BIL_MAP_PriceCategoryServiceItem` resolve the service item + price per price category. `BIL_MAP_ServiceItemSchemeSetting` is consulted for co-payment (`CoPaymentCashPercent` / `CoPaymentCreditPercent`) when the scheme has `IsOpBillCreditApplicable = true` and `IsBillingCoPayment = true`. `BIL_CFG_Counter` (where `CounterType = "emergency"`) is the dedicated counter for the ER. Ward-billing screen (`er-wardbilling.component.ts`) calls `_billingBLService.GetInPatientProvisionalItemList(patientId, visitId, 'emergency')` to load the ER provisional bill and uses `_billingMasterBLService.GetServiceItems(OpBilling, schemeId, priceCategoryId)` for the add-item list. Cancels are delegated to `/api/Billing/CancelInpatientItemFromWard` and `/api/Billing/CancelOutpatientProvisionalItem`. |
| **Lab** | Read | `EmergencyController.GetDischargeSummary` returns distinct `LabTestName` from `LAB_TestRequisition` filtered to `OrderStatus IN ('report-generated','result-added')` and `BillingStatus NOT IN ('cancelled','returned')`. `EmergencyBLService.CancelInpatientCurrentLabTest` calls `/api/Lab/CancelInpatientLabTest` to cancel lab orders. |
| **Radiology** | Read | `EmergencyController.GetDischargeSummary` returns `ImagingItemName` from `RAD_PatientImagingRequisition` filtered to `BillingStatus NOT IN ('cancelled','returned')`. `EmergencyBLService.CancelRadRequest` calls `/api/Radiology/CancelInpatientRequisitions` to cancel imaging orders. |
| **Pharmacy** | Read | `ERWardBillingComponent.LoadPHRMOrdersOfERPatient(patientId, visitId)` calls `_pharmacyBLService.GetAllDrugOrderOfERPatient` to load ER drug orders. The Drugs Request sub-screen (`DrugsRequestComponent`, Nursing module) handles drug requests. |
| **Admission (ADT)** | Read | The ER Admitted tab lists ER patients whose `FinalizedStatus = "admitted"`. The actual IPD bed allocation and admission is owned by the `Admission` module (`AdmissionController.CreateAdmission`). `ERWardBillingComponent` and `PatientOverviewMainComponent` reach into the clinical / nursing sub-modules for in-ER care. |
| **Clinical** | Read | `EmergencyController.GetDischargeSummary` reads latest `CLN_PatientVitals`. `EmergencyController.GetEmergencyPatients` reads latest vitals. `ERPatientListComponent` supports an "Add Vitals" action that opens the IO-Allergy-Vitals popup (clinical module). |
| **Insurance / SSF** | Read | `ERPatientRegistrationComponent.OnRegistrationSchemeChanged` accepts a `RegistrationScheme_DTO` that may carry an SSF patient detail payload (`SsfPatientDetail`). If the scheme integration is `SSF`, demographics are auto-populated from the SSF patient. |
| **Masters (Country, Ethnicity, Department, Municipality, Employee)** | Read | Country / district dropdowns, ethnicity group, ER duty department + employee, municipality. |
| **Core (lookups + parameters)** | Read | `CoreService.GetAllLookUpDetails(1..4)` populates the four ER lookups. `CORE_CFG_Parameters.Emergency` is read in 5+ places — `ERDepartmentAndDutyDoctor` (JSON), `AddProvisionalToBillingOnRegistration` (provisional billing toggle), `ErRegistrationServiceItem` (JSON `{ErRegistrationServiceItemId}`), `UploadFileLocationPath` (disk path), `ERAddVitalBeforeTriage` (UI flag), `EmergencyRegistrationDisplaySettings` (JSON `{ShowIsPoliceCase}`). |
| **Nursing** | Read/Write | `DrugsRequestComponent` and `NursingWardBillingComponent` are loaded under the ER `PatientOverviewMain` route for in-ER drug requests and ward billing. `NursingBLService` / `NursingDLService` are wired into the ER module's DI providers. |
| **RBAC / Security** | Cross-cutting | `EmergencyRoutingModule` gates every route with `AuthGuardService`. `PatientOverviewMain` additionally uses `ResetEmergencyContextGuard` and `SelectVisitCanActivateGuard`. The MVC shell requires the `emergency-view` permission. |
| **Helpdesk** | Read | `BedInformationsComponent` calls `/api/Helpdesk/BedOccupancyOfWards` for the per-ward bed-occupancy grid. |

---

## 8. Business Rules

### 8.1 ER Status State Machine

| From | To | Trigger | Endpoint |
|------|----|---------|----------|
| (none) | `new` | `RegisterPatient` without a `TriageCode`. | `POST /RegisterPatient` |
| (none) | `triaged` | `RegisterPatient` with a `TriageCode` populated inline. | `POST /RegisterPatient` |
| `new` | `triaged` | Triage popup. | `PUT /TriagedCode` |
| `triaged` | `new` | Triage undo. | `PUT /UndoTriageOfPatient` |
| `triaged` | `finalized` + `lama` | LAMA finalize. | `PUT /LeaveAgainstMedicalAdvice?actionString=lama` |
| `triaged` | `finalized` + `transferred` | Transferred to another facility. | `PUT /LeaveAgainstMedicalAdvice?actionString=transferred` |
| `triaged` | `finalized` + `discharged` | Discharge via the LAMA popup (action = discharged). | `PUT /LeaveAgainstMedicalAdvice?actionString=discharged` |
| `triaged` | `finalized` + `admitted` | Marked as admitted (ER Admitted list). | `PUT /LeaveAgainstMedicalAdvice?actionString=admitted` |
| `triaged` | `finalized` + `death` | Death in ER. | `PUT /LeaveAgainstMedicalAdvice?actionString=death` |
| `triaged` | `finalized` + `dor` | Discharge on request. | `PUT /LeaveAgainstMedicalAdvice?actionString=dor` |
| `new` / `triaged` | `finalized` + `discharged` | ER discharge summary added. | `POST /DischargeSummary` |

`finalized` is terminal — there is no path back to `triaged` or `new` once finalized (the patient is read-only under the matching Finalized tab).

### 8.2 Triage Severity Mapping

| Severity (UI) | TriageCode (DB) | Color Hint |
|---------------|-----------------|------------|
| 1 | `mild` | Green |
| 2 | `moderate` | Yellow |
| 3 | `critical` | Red |
| 4 | `death` | Black |

The mapping is set in `er-triage-actions.component.ts → TriagePatient(severity: number)`. The `Emergency_PoliceCase_NotificatiONTrigger` fires on insert/update of `ER_Patient` when `IsPoliceCase = 1`.

### 8.3 ER Registration Business Rules

- **New patient creation**: only when `selectedFromExisting = false` AND `PatientId is empty`. Sets `Salutation = "Mr."` for Male, `"Ms."` otherwise (legacy, may need i18n fix). Generates a unique `PatientNo` and `PatientCode` via `PatientBL.GetPatNumberNCodeForNewPatient` with retry on SqlException 2627.
- **Visit code uniqueness**: `VisitBL.CreateNewPatientVisitCode("emergency", connString)` is wrapped in a recursive retry on unique-key violation. The visit is created with `VisitType = "emergency"`, `VisitStatus = "initiated"`, `BillingStatus = "provisional"`, `AppointmentType = "New"`.
- **ER duty doctor auto-assignment**: resolved from `CORE_CFG_Parameters.Emergency.ERDepartmentAndDutyDoctor` (JSON `ERParamClass`). Looks up `MST_Department` by name, then `EMP_Employee` in that department with matching `FirstName` and `IsActive = true`. Stamps `PerformerId/Name` on both `ER_Patient` and `PAT_PatientVisits`. If the department or employee is missing, the registration still proceeds but `PerformerId` is null.
- **Mode of Arrival upsert**: if `ModeOfArrival` is null but `ModeOfArrivalName` is non-empty, the system auto-creates a new `ER_ModeOfArrival` row (case-insensitive match first).
- **Inline triage at registration**: if `TriageCode` is set on the registration payload, the patient is created with `ERStatus = "triaged"` (not `new`).
- **Provisional billing**: when `AddProvisionalToBillingOnRegistration` is `true` or `"1"`, the configured `ErRegistrationServiceItemId` is added as a provisional billing line. Price is resolved via `BIL_MAP_PriceCategoryServiceItem` for the visit's `PriceCategoryId`. The receipt number is stamped from `BillingBL.GetProvisionalReceiptNo` and the counter is `BIL_CFG_Counter` where `CounterType = "emergency"`. The active fiscal year is stamped from `BillingBL.GetFiscalYear`.
- **Scheme co-payment**: if the scheme is `IsOpBillCreditApplicable = true` AND `IsBillingCoPayment = true`, the system reads `BIL_MAP_ServiceItemSchemeSetting` for that scheme + service item and stamps `IsCoPayment`, `CoPaymentCashAmount`, `CoPaymentCreditAmount` on the billing line.
- **Patient scheme upsert**: `SavePatientScheme` either updates the existing `PAT_MAP_PatientSchemes` row (decrementing `OpCreditLimit` or `GeneralCreditLimit` if the scheme is credit-limited) or inserts a new row.
- **Default `MainCase`**: when null, defaults to `1` (Medical). Non-medical cases (animal-bite, snake-bite, dog-bite, other) require an `ER_Patient_Cases` row.

### 8.4 ER Discharge Summary Business Rules

- **Add and finalize in one transaction**: `AddDischargeSummary` writes the summary row + links it to the ER patient + flips `ERStatus = "finalized"` + sets `FinalizedStatus = "discharged"` (if not already finalized).
- **Idempotent finalize**: if the patient is already finalized, only the `ERDischargeSummaryId` column is updated; `ERStatus` / `FinalizedStatus` / `FinalizedBy` / `FinalizedOn` are not touched.
- **Update locks immutable columns**: `UpdateDischargeSummary` sets `IsModified = false` for `ERDischargeSummaryId`, `CreatedBy`, `CreatedOn`, `PatientId`, `PatientVisitId`.
- **Investigation aggregation**: the VM returns lab orders (`OrderStatus IN ('report-generated','result-added')`, `BillingStatus NOT IN ('cancelled','returned')`) and imaging orders (`BillingStatus NOT IN ('cancelled','returned')`) as plain `List<string>` of names. The Add form deserializes the saved `Investigations` JSON and re-maps the selected flags.

### 8.5 Finalize (LAMA / etc.) Business Rules

- **Remarks required**: the frontend (`er-lama.component.ts`) blocks submission if `FinalizedRemarks` is empty.
- **Audit fields**: `FinalizedBy = currentUser.EmployeeId`, `FinalizedOn = DateTime.Now` on every finalize.
- **Action string drives `FinalizedStatus`**: the value of the `?actionString=` query param is what gets written. Allowed values: `lama`, `transferred`, `discharged`, `admitted`, `death`, `dor`.

### 8.6 ER-Specific Soft Delete & Audit

- **Soft delete on patient rows**: `IsActive = false` hides a row from all list queries (every list endpoint filters on `IsActive = true`).
- **Soft delete on consent files**: `ER_FileUploads.IsActive = false` (set by `DeleteConsent`). The on-disk file is not deleted (manual cleanup is required).
- **Audit columns**: every ER entity carries `CreatedBy/On` and `ModifiedBy/On`. `CreatedBy` is stamped from `RbacUser.EmployeeId` of the session.
- **Optimistic concurrency**: EF's `Property(...).IsModified = true` is used to ensure only the changed columns are written, which avoids overwriting concurrent updates from a different user.

### 8.7 Emergency-Patient Lookups (the four `CORE_LookUpDetail` types)

| `LookUpTypeEnum` | Lookup | Populated By |
|------------------|--------|--------------|
| 1 | ER Cases (MainCase / SubCase tree) | Core admin / seed data. |
| 2 | Bitten Body Part (BitingSite) | Core admin / seed data. |
| 3 | Snake List (BitingAnimal) | Core admin / seed data. |
| 4 | First Aid List (FirstAid) | Core admin / seed data. |

These are loaded by `EmergencyService.GetAllCasesLookUpDetailData / GetAllBittenBodyPartList / GetAllSnakeList / GetAllFirstAidList` once when `EmergencyMainComponent` is constructed, and exposed to the registration form via the `EmergencyService` singleton.

### 8.8 ER-Parameter-Driven Behaviour (CORE_CFG_Parameters.Emergency)

| Parameter | Type | Effect |
|-----------|------|--------|
| `ERDepartmentAndDutyDoctor` | JSON `{DepartmentName, ERDutyDoctorFirstName}` | Resolves the auto-assigned ER doctor at registration. |
| `AddProvisionalToBillingOnRegistration` | `"true"` / `"false"` / `"1"` | When truthy, writes the `ErRegistrationServiceItem` to `BIL_TXN_BillingTransactionItems` at registration. |
| `ErRegistrationServiceItem` | JSON `{ErRegistrationServiceItemId}` | The service-item id to bill at registration. |
| `UploadFileLocationPath` | string (filesystem path) | Where `UploadPatientConsentForm` writes consent files. |
| `ERAddVitalBeforeTriage` | string | Surfaced on the patient list as `IsAddVitalBeforeTriage`. When truthy, the client should block triage until vitals are added. |
| `EmergencyRegistrationDisplaySettings` | JSON `{ShowIsPoliceCase}` | When `true`, the registration form shows the "Police Case" checkbox. |

### 8.9 Police-Case Notification

- `Emergency_PoliceCase_NotificatiONTrigger` on `ER_Patient` fires on insert/update when `IsPoliceCase = 1` to push a notification (SMS / email / dashboard — implementation lives in the trigger body inside the `.bak` backup). The trigger is toggled by `CleanUpScript.sql` (lines 7, 855, 891) for the data cleanup window.

### 8.10 Matching-Patient Algorithm (existing-patient search)

`GetMatchingPatient` returns a patient when EITHER:
- `FirstName` and `LastName` match (case-insensitive) AND `DateOfBirth` is within ±3 years of the typed DOB, OR
- `PhoneNumber` (when non-empty) matches exactly.

The match window of ±3 years handles minor DOB-entry discrepancies (e.g. patient was unsure of the exact year).


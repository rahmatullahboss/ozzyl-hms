# DanpheEMR — Doctors Module

> **Module code path in repo:** `Code/Websites/DanpheEMR/Controllers/Doctors/`, `Code/Components/DanpheEMR.ServerModel/DoctorModels/`, `Code/Components/DanpheEMR.DalLayer/DoctorsDbContext.cs`, `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/doctors/`
> **Module role:** Doctor-facing workspace — today's appointments, past visit lists, department visit list, patient overview, in-patient record, visit summary (template-driven OPD summary), referral source capture, doctor revenue summary, visit conclusion, and provider re-assignment.

This document describes the DanpheEMR Doctors module as it exists in the reference source. The Doctors module is a thin controller layer over `VisitModel` (owned by the Appointment module) plus one Doctors-owned table (`DOC_TXN_VisitSummary`) and shared clinical tables (`ReferralSource`, `CLN_Template`). The legacy `ProvidersController` was renamed in spirit to `DoctorsController` while keeping the route prefix `/api/Doctors/`. Names like `Provider` were renamed to `Performer` during the 2022 refactor; both names appear in the source. Where the source still uses `ProviderId` / `ProviderName`, this doc notes the modern `PerformerId` / `PerformerName` equivalent.

---

## 1. Module Overview

The Doctors module is the **doctor's workspace** — the screens a doctor opens after logging in. It is one of the most-frequently-used modules in DanpheEMR because every OPD and IPD encounter flows through it. The module is split across three controllers and one DbContext, and its concerns can be grouped into eight responsibilities:

1. **Today's visit list** — per-doctor grid of visits for the current date, grouped by performer with auto-refresh.
2. **Past visit list** — historical visits for the logged-in doctor in a date range, with grid actions for preview, labs, imaging.
3. **Department visit list** — every other doctor's visits in the same department in a date range (cross-doctor visibility within a department).
4. **Patient overview** — full patient chart on a single page: demographics, vitals (last 3), active problems, allergies, past orders (lab + imaging for the current visit only), medication prescriptions, bed/ward info, country sub-division, profile picture.
5. **Other requests of patient** — provisional billing items (excluding lab and radiology integrations) for a visit.
6. **Visit conclusion** — stamp `ConcludeDate = now` on the visit.
7. **Provider re-assignment** — change the doctor on an existing visit, with a single atomic update to both `PAT_PatientVisits` and the OPD billing transaction item.
8. **Visit summary (template-driven)** — fill, save, re-load, and sign a dynamic-template-driven OPD summary (the `OPDSummary` template). Stores answers in `DOC_TXN_VisitSummary`.

The module also owns the **Doctor's dashboard** and a number of secondary screens that act as shells:

- **IPD Main** (`ipd-main.component.ts`) — admitted patients in the doctor's department, with favorites, free-text / procedure / progress note views, and a route into discharge summary.
- **OPD record** (`opd-record.component.ts`) and **OP new patient** (`op-new-patient.component.ts`) — the modern OPD walk-in / new-patient shells.
- **Outpatient main** (`outpatient-main.component.ts`) — the gate component that loads the doctor's `validRoutes` from RBAC.
- **Doctor's notes** (`doctors-notes.component.ts`) — print-format progress notes combining vitals + clinical note fields + the doctor's long signature.
- **Doctor revenue summary** (`doctor-summary.component.ts`) — a per-day rollup of OPD / FollowUp / Referral / OT / Surgery counts (calls the legacy `/Reporting/DoctorSummary` endpoint).
- **Referral source list / add** (`referral-source-list.component.ts`, `referral-source-add.component.ts`) — capture how a patient heard about the hospital (newspaper, radio, doctor, web, etc.). Backed by the Clinical module's `ReferralSource` table, but the screens live under `doctors/`.
- **Patient visit history** (`patient-visit-history.component.ts`) — every visit for the patient, regardless of doctor.
- **In-patient discharge summary** (`in-patient-discharge-summary.component.ts`) — read-only view of the discharge note when it has been submitted.

### High-level today-flow

```
DoctorDashboardComponent
   -> LoadTodaysVisitList() [auto-refresh every 60s]
        GET /api/Doctors/TodaysVisits?toDate=YYYY-MM-DD
   -> Patient clicks a patient cell
        SelectVisit(visit) populates global VisitService
        RouteToPatientOverview(visit)
            -> PatientOverviewComponent
                 -> GET /api/Doctors/PatientOverview?patientId&patientVisitId
                 -> GET /api/Doctors/OtherRequestsOfPatient?patientId&patientVisitId
                 -> GET clinical/vitals, problems, allergies, orders ...
                 -> Click "Conclude Visit" -> POST /api/Doctors/ConcludeVisit
                 -> Click "Re-assign"     -> PUT  /api/Doctors/ChangeProvider
                 -> Click "Visit Summary" -> VisitSummaryCreateComponent
                      -> GET  /api/VisitSummary/VisitDetails?visitId
                      -> POST /api/VisitSummary/VisitDetails   (save)
                      -> PUT  /api/VisitSummary/VisitDetails   (update)
                      -> PUT  /api/Visit/UpdateSignedStatus?visitId=... (sign)
```

### High-level reassign-provider flow

```
DoctorDashboardComponent.ShowAssignToOther(visit)
   -> modal: select new assignee from deptProviderList, remark required
   -> PUT /api/Doctors/ChangeProvider
        visitDbContext.Visits UPDATE PerformerId, PerformerName, ModifiedBy, ModifiedOn, Remarks
        returns new PerformerName
```

There is also a richer "re-assign" path used by the older call sites (`PUT /api/Doctors/ReassignProvider`) which uses `VisitBL.ReAssignProviderTxn` and updates the OPD billing transaction item's `PerformerId` / `PerformerName` atomically in a single transaction.

---

## 2. Backend Files

| File | Role | Key types / methods |
|---|---|---|
| `Controllers/Doctors/DoctorsController.cs` | Main Web API for the doctor workspace. 834 lines. | `PatientOverview`, `OtherRequestsOfPatient`, `TodaysVisits`, `PastVisits`, `DepartmentVisits`, `EmployeeDepartment`, `PatientVisitTypes`, `ConcludeVisit`, `ReassignProvider`, `ChangeProvider`. |
| `Controllers/Doctors/DoctorsViewController.cs` | Legacy server-side MVC view controller. Still serves `.cshtml` views for the original Doctor pages. | `DashBoardStatistics`, `DashboardMain`, `DoctorDashboard`, `PatientOverview`, `PatientOverviewMain`, `PatientVisitHistory`, `VisitSummary`. Decorated with `[DanpheViewFilter(...)]` for RBAC. |
| `Controllers/Doctors/VisitSummaryController.cs` | Web API for the template-driven OPD visit summary (the `OPDSummary` template). 217 lines. | `VisitDetails` (GET / POST / PUT). Maps to `DOC_TXN_VisitSummary`. |
| `Components/DanpheEMR.DalLayer/DoctorsDbContext.cs` | EF DbContext that exposes the entities the Doctors module reads. It does **not** declare new tables of its own except through the `VisitSummary` and `TemplateNotes` DbSets. | `DbSet<VisitModel>`, `DbSet<EmployeeModel>`, `DbSet<PatientModel>`, `DbSet<AdmissionModel>`, `DbSet<DepartmentModel>`, `DbSet<BillServiceItemModel>`, `DbSet<VisitSummaryModel>`, `DbSet<TemplateNoteModel>`. |

The Doctors module is unusual in that it does **not own many tables**. Most of the entities it surfaces (visit, patient, employee, department, admission) are owned by other modules. The single Doctors-owned table is `DOC_TXN_VisitSummary`.

**Important deprecated / dead code:** `DoctorsController.cs` lines 131–425 and 440–558 contain a large block of commented-out `reqType`-based routes from the pre-controller era. The legacy endpoints (`reqType=patientOverview`, `reqType=otherRequestsOfPatient`, `reqType=providertodaysvisit`, `reqType=providerpastvisits`, `reqType=providerDeptVisits`, `reqType=departmentByEmployeeId`, `reqType=patientVisitType`, `reqType=concludeVisit`, `reqType=reassignProvider`, `reqType=changeProvider`) are commented out and should not be revived.

### 2.1 Helper used by `DoctorsController`

`VisitBL.ReAssignProviderTxn(VisitDbContext visitDb, VisitModel visit, BillingDbContext billingDb)` (defined in `Controllers/Appointment/VisitBL.cs:176`) is the only piece of business logic called from the Doctors module that has a non-trivial transaction. It runs the visit update and the matching billing-line update in a single `dbContextTxn` and rolls back on any exception.

---

## 3. Data Models

All models live under namespace `DanpheEMR.ServerModel`.

### 3.1 `VisitSummaryModel` — `DOC_TXN_VisitSummary`

The only Doctors-owned model. Stores one row per question-answer in a template-driven OPD visit summary.

| Field | Type | Notes |
|---|---|---|
| `VisitSummaryId` | int (PK) | Identity. |
| `PatientId` | int | FK to `PAT_Patient`. |
| `VisitId` | int | FK to `PAT_PatientVisits`. |
| `QnairId` | int | The questionnaire id within the dynamic template (e.g. "Chief Complaint", "Examination"). |
| `QuestionId` | int | The question id within the questionnaire. |
| `Answer` | string | The free-text / selected answer text. |
| `CreatedOn` | DateTime? | |
| `CreatedBy` | int? | |
| `ModifiedOn` | DateTime? | |
| `ModifiedBy` | int? | |
| `IsActive` | bool? | When the user edits and re-saves, the prior row's `IsActive` is set to `false` and a new row is inserted with `IsActive = true`. |

The Doctors DbContext explicitly maps it to `DOC_TXN_VisitSummary` via `modelBuilder.Entity<VisitSummaryModel>().ToTable("DOC_TXN_VisitSummary")` in `DoctorsDbContext.OnModelCreating`.

### 3.2 `VisitModel` — `PAT_PatientVisits` (read-mostly, owned by Appointment module)

The Doctors module reads and writes `VisitModel` extensively. The full field list is in the Appointment module doc, but the fields the Doctors module cares about are:

| Field | Type | Notes |
|---|---|---|
| `PatientVisitId` | int (PK) | |
| `VisitCode` | string | `V` for outpatient, `H` for inpatient. |
| `PatientId` | int | |
| `VisitDate` | DateTime | Truncated to date for the today-list query. |
| `VisitTime` | TimeSpan? | |
| `PerformerId` / `PerformerName` | int? / string | Renamed from `ProviderId` / `ProviderName`. The doctor. |
| `VisitType` | string | `outpatient`, `inpatient`, `emergency`. |
| `VisitStatus` | string | `initiated`, `concluded`, `cancel`. |
| `BillingStatus` | string | `paid`, `unpaid`, `provisional`, `cancel`, `returned`, `free`. |
| `AppointmentType` | string | `New`, `followup`, `transfer`, `referral`. Used to filter "Surgery" vs "Normal Checkup" on the today grid. |
| `ConcludeDate` | DateTime? | Set by `ConcludeVisit` once the doctor finishes. |
| `IsSignedVisitSummary` | bool | Drives the `templateRenderMode` (view vs fill) on the visit-summary screen. |
| `DepartmentId` | int | Required from 19-Jun-2019 (department-level appointment). |
| `Remarks` | string | Concatenated by `ChangeProvider` rather than overwritten. |
| `Patient` (nav) | PatientModel | |
| `Admission` (nav) | AdmissionModel | Used to keep inpatient visits in the today list even if the visit date is older. |

### 3.3 `EmployeeModel` — `EMP_Employee` (owned by HR module, read by Doctors)

| Field | Type | Notes |
|---|---|---|
| `EmployeeId` | int (PK) | |
| `FullName` | string | `Salutation + FirstName + (MiddleName) + LastName` (database-stored, not computed). |
| `Salutation` | string | `Dr`, `Mr`, `Mrs`, etc. The Doctors module filters by `Salutation == "Dr"` for the "doctors in this department" list. |
| `DepartmentId` | int? | Drives the department grouping. |
| `IsAppointmentApplicable` | bool? | Filters the doctor picker. |
| `IsExternal` | bool | Distinguishes external referrers. |
| `Signature`, `LongSignature` | string | Used for the doctor's progress-note print. |
| `SignatoryImageName` / `SignatoryImageBase64` | string | For lab / imaging reports. |
| `IsIncentiveApplicable` | bool? | Drives incentive accruals. |
| `OpdNewPatientServiceItemId` / `OpdOldPatientServiceItemId` / `FollowupServiceItemId` / `InternalReferralServiceItemId` | int? | OPD ticket pricing. |
| `TDSPercent`, `PANNumber` | double? / string | TDS / tax deductions. |
| `Department` (nav) | DepartmentModel | |
| `EmployeeRole` (nav) | EmployeeRoleModel | |
| `EmployeeType` (nav) | EmployeeTypeModel | |

### 3.4 `DepartmentModel` — `MST_Department` (owned by Master, read by Doctors)

| Field | Type | Notes |
|---|---|---|
| `DepartmentId` | int (PK) | |
| `DepartmentCode` / `DepartmentName` / `Description` | string | |
| `DepartmentHead` | int? | EmployeeId of the head. |
| `IsAppointmentApplicable` | bool | |
| `ParentDepartmentId` | int? | Hierarchy. |
| `RoomNumber` | string | |
| `OpdNewPatientServiceItemId` / `OpdOldPatientServiceItemId` / `FollowupServiceItemId` | int? | Department-level OPD prices. |

### 3.5 `PatientModel` — `PAT_Patient` (owned by Patient module, read by Doctors)

The full Patient model is in the Patient module doc. The Doctors module uses these collections in the patient overview:

- `Visits` (with eager-loaded `Vitals` for the today list and the chart)
- `Problems` (filtered to `IsResolved == false`)
- `Allergies` (split into `Allergy`, `AdvRec`, `Others` on the OPD summary)
- `Addresses` (display)
- `LabRequisitions` (filtered to current `PatientVisitId`, status not `returned` or `cancel`)
- `ImagingItemRequisitions` (same filter)
- `UploadedFiles` (filter to `IsActive == true && FileType == "profile-pic"`, then read from disk and convert to base64)
- `MedicationPrescriptions` (built by joining `PHRMPrescriptionItems` to `PHRMItemMaster`)

Plus these derived fields:

- `BedNo`, `WardName`, `BedId` (from `ADT_PatientBedInfos` join `Beds` join `Wards` where `EndedOn == null`).
- `CountrySubDivisionName` (from `MST_CountrySubDivision`).
- `ProfilePic.FileBase64String` (read from disk using the path stored in `CFGParameters[Patient / PatientProfilePicImageUploadLocation]`).

### 3.6 `AdmissionModel` — `ADT_PatientAdmission` (owned by ADT, read by Doctors)

The Doctors module only cares about the navigation property `Visit.Admission.AdmissionStatus` to decide whether to keep an inpatient visit in the today list (status `admitted` always shows, even on a different day).

### 3.7 `TemplateNoteModel` — `CLN_Template` (owned by Clinical, read by Doctors)

The Doctors DbContext declares a `DbSet<TemplateNoteModel>` but never queries it. It is included to keep the EF model consistent with the dynamic-template engine used by the visit-summary screen.

### 3.8 `BillServiceItemModel` — `BIL_MST_ServiceItem` (owned by Billing, read by Doctors)

The Doctors DbContext declares a `DbSet<BillServiceItemModel>` but the controllers do not query it directly. The Doctor revenue screen (`DoctorRevenueComponent.Load`) consumes the Reporting endpoint, not this DbSet.

### 3.9 `ReferralSource` — `CLN_Module_ReferralSource` (owned by Clinical, written by Doctors UI)

The Doctors UI captures referral sources, but the API endpoints live in `ClinicalController` (`/api/Clinical/ReferralSource` GET / POST / PUT). Model:

| Field | Type | Notes |
|---|---|---|
| `ReferralSourceId` | int (PK) | |
| `PatientId` | int | |
| `Newspaper`, `Unknown`, `Doctor`, `Radio`, `WebPage`, `FriendAndFamily`, `Staff`, `TV`, `Magazine` | bool | The marketing channels. |
| `Others` | string | Free text. |
| `Note` | string | |
| `CreatedOn` / `CreatedBy` / `ModifiedOn` / `ModifiedBy` | audit | |
| `Patient` (nav) | PatientModel | |

### 3.10 Frontend view models

| Model | File | Purpose |
|---|---|---|
| `VisitSummaryModel` | `visit/visit-summary.model.ts` | Mirrors the server `VisitSummaryModel`. Used by the dynamic-template visit summary. |
| `DoctorNotes` | `notes/doctors-notes.model..ts` | Print-only DTO: `patVitals`, `patDetail`, `Date`, `History`, `Complain`, `ProvisionalDiagnosis`, `Medication`, `Investigation`. |
| `DoctorSummary` | `shared/doctor-summary.model.ts` | Rollup counters: `OPD`, `Referral`, `FollowUp`, `USG`, `OrthoProcedures`, `CT`, `GeneralSurgery`, `GynSurgery`, `ENT`, `Dental`, `OT`. |
| `ReferralSource` | `referral-source/referral-source.model.ts` | Mirrors the server model with an Angular `ReactiveForm` validator. |

---

## 4. Database Tables

DanpheEMR uses Entity Framework Code First with explicit `ToTable` mappings. The Doctors module is unusual in that it only owns one table and reads many.

### 4.1 Doctors-owned table

| Table | Source model | Notes |
|---|---|---|
| `DOC_TXN_VisitSummary` | `VisitSummaryModel` | Stores one row per answered question in a template-driven OPD summary. When the user edits, the prior row's `IsActive` is flipped to `false` and a new active row is inserted. |

### 4.2 Tables read by the Doctors module

| Table | Source model | Doctors usage |
|---|---|---|
| `PAT_PatientVisits` | `VisitModel` | Today list, past list, department list, conclude, reassign, patient overview. |
| `PAT_Patient` | `PatientModel` | Patient overview, demographics, vitals, problems, allergies, addresses, lab/imaging requisitions, profile picture, medication prescriptions. |
| `ADT_PatientAdmission` | `AdmissionModel` | Drive the "admitted inpatient still shows on today list" rule. |
| `ADT_PatientBedInfos`, `ADT_Beds`, `ADT_Wards` | — | Bed number, ward name, bed id for patient overview. |
| `EMP_Employee` | `EmployeeModel` | "Doctors in my department" picker for the re-assign modal. Filter: `Salutation == "Dr"` and `DepartmentId == my-dept`. |
| `MST_Department` | `DepartmentModel` | Department name header on the doctor dashboard. |
| `PHRM_PrescriptionItems`, `PHRM_MST_Item` | — | Build `MedicationPrescription` (item, dose, frequency, duration). |
| `MST_CountrySubDivision` | — | Patient's district name. |
| `CFG_Parameters` | — | `Patient / PatientProfilePicImageUploadLocation` for reading the profile picture from disk. |
| `BIL_MST_ServiceItem` | `BillServiceItemModel` | Declared in DbContext; not actively queried by Doctors controllers. |
| `BIL_TXN_BillingTransactionItems` | — | The `ReassignProvider` transactional update joins here by `RequisitionId == PatientVisitId && ServiceDepartmentId == OPD-id`. |
| `BIL_MST_ServiceDepartment` | — | Lookup of the `OPD` service department id used in the reassign transaction. |
| `CLN_Template` | `TemplateNoteModel` | Declared in DbContext; not actively queried by Doctors controllers. The actual template fetch goes through the dynamic-template controller. |
| `CLN_Module_ReferralSource` | `ReferralSource` | Written by the Doctors UI; served by `ClinicalController`. |

### 4.3 Tables written by the Doctors module (transitively)

The Doctors module does not own direct INSERTs / UPDATEs to most of these tables; it is the doctor's actions in other modules (orders, billing, clinical) that write to them. For completeness:

| Table | Action |
|---|---|
| `PAT_PatientVisits` | UPDATE `ConcludeDate`, `PerformerId`, `PerformerName`, `ModifiedBy`, `ModifiedOn`, `Remarks` (the last is concatenated, not overwritten). |
| `BIL_TXN_BillingTransactionItems` | UPDATE `PerformerId`, `PerformerName` for the OPD service item (only via `VisitBL.ReAssignProviderTxn`). |
| `DOC_TXN_VisitSummary` | INSERT and UPDATE (soft-delete via `IsActive = false` + new row) for the template-driven OPD summary. |
| `PAT_PatientVisits.IsSignedVisitSummary` | Set to `true` by `Visit/UpdateSignedStatus` (owned by Appointment, called by the Visit Summary UI). |

### 4.4 Stored procedures used

The Doctors module does not call any stored procedures directly. The legacy Doctor's dashboard view (`DashBoardStatistics`) is a stub view that does not call any SP.

---

## 5. Key Workflows

### 5.1 Today list

`DoctorDashboardComponent.LoadTodaysVisitList` calls `GET /api/Doctors/TodaysVisits?toDate=YYYY-MM-DD&status=initiated`. `DoctorsController.GetTodaysVisitList` returns two shapes:

- **No `toDate` provided** — flat list of `VisitModel` for the current user (`PerformerId == currentUser.EmployeeId`) where `VisitStatus == status` and `VisitDate == today`, plus any inpatient visit where `Admission.AdmissionStatus == "admitted"` regardless of date. The flat list is sorted by `VisitDate` then `VisitTime`.
- **`toDate` provided** — grouped list, grouped by `PerformerName`, sorted by `VisitDate` then `VisitTime`, where `VisitDate == toDate` and `BillingStatus != "returned"`. The grouping is what produces the per-doctor columns in the today grid.

The component then runs `OnVisitTypeChange` to filter by `outpatient` / `emergency` / `all`, and `LoadTreatmentTypeByStatus(0|1|2)` to filter by `Comments == "Surgery"` / `"Normal Checkup"` / `all`.

The component auto-refreshes the today list and the past list every 60 seconds (`setInterval` registered in the constructor and cleared in `ngOnDestroy`).

### 5.2 Past list

`DoctorDashboardComponent.LoadPreviousVisitList` calls `GET /api/Doctors/PastVisits?fromDate=&toDate=`. `DoctorsController.GetPastVisitList` returns every visit (regardless of `PerformerId`) where `VisitDate` is within the range and `BillingStatus != "returned"`, sorted `VisitDate` then `VisitTime` descending.

The past-list grid columns come from `GridColumnSettings.DoctorAppointmentList` and the row actions are `preview` / `labs` / `imaging` / `notes` / `medication` (only `preview`, `labs`, `imaging` are wired; the others are no-ops).

### 5.3 Department list

`DoctorDashboardComponent.loadDocDeptVisitList` calls `GET /api/Doctors/DepartmentVisits?fromDate=&toDate=`. `DoctorsController.GetDoctorDepartmentVisit`:

1. Reads the current user's `DepartmentId` from `MasterDbContext.Employees`.
2. Loads every `Employee` row into memory.
3. Queries every visit in the date range (regardless of `PerformerId`).
4. Joins visits to employees on `PerformerId == EmployeeId`.
5. Filters to employees whose `DepartmentId == currentUser.DepartmentId`.

The result is a flat list of every visit performed by anyone in the doctor's department during the date range. The today/dept/past grids all share the same `DoctorAppointmentGridColumns` shape.

### 5.4 Patient overview

`PatientOverviewComponent.ShowPatientPreview` (and the parallel `OPDVisitSummaryComponent.ShowPatientPreview` for the OPD record) call `GET /api/Doctors/PatientOverview?patientId=&patientVisitId=`. `DoctorsController.GetatientOverview` (typo in the source — not corrected) does the following:

1. Eager-loads the patient with `.Include(a => a.Visits.Select(v => v.Vitals))` and `.Include(a => a.Problems)`, `.Allergies`, `.Addresses`, `.LabRequisitions`, `.UploadedFiles`, `.ImagingItemRequisitions`, `.MedicationPrescriptions`.
2. Filters `LabRequisitions` and `ImagingItemRequisitions` to the current `PatientVisitId` and excludes `BillingStatus == "returned"` or `"cancel"`.
3. Takes the last 3 vitals (across all visits, sorted by `CreatedOn desc`).
4. Reads the patient's profile picture:
   - Resolves the disk path from `CFGParameters[Patient / PatientProfilePicImageUploadLocation]`.
   - Filters `UploadedFiles` to `IsActive == true && FileType == "profile-pic"`.
   - Reads the file from disk and converts to base64.
5. Filters `Problems` to `IsResolved == false`.
6. Resolves `CountrySubDivisionName` from `MST_CountrySubDivision`.
7. Builds `MedicationPrescriptions` by joining `PHRM_PrescriptionItems` to `PHRM_MST_Item` (`Dose = pres.Dosage`, `Frequency = pres.Frequency.ToString()`, `Duration = pres.HowManyDays`).
8. Resolves the current bed info: joins `ADT_PatientBedInfos` -> `Beds` -> `Wards` where `PatientId` / `PatientVisitId` matches and `EndedOn == null`. Sets `BedNo`, `WardName`, `BedId` on the returned `PatientModel`.

The OPD visit summary uses the same payload and additionally filters `Allergies` by `AllergyType` into `MedAllergy` / `AdvReaction` / `OtherAllergy` for the chart display.

### 5.5 Other requests of patient

`GET /api/Doctors/OtherRequestsOfPatient?patientId=&patientVisitId=` returns every `BillingTransactionItem` for the current visit that is in `BillingStatus == "provisional"`, **excluding** items whose `ServiceDepartment.IntegrationName` (lowercased) equals `LAB` or `RADIOLOGY`. This is the doctor's "what other services has this patient been provisionally charged for" list, used for cross-charging review before conclude.

The lab and imaging items are intentionally excluded because they have their own dedicated panels (Lab Results, Imaging Reports) on the patient overview.

### 5.6 Conclude a visit

`PatientOverviewMainComponent.ConcludeVisit` (confirms via `window.confirm`) calls `POST /api/Doctors/ConcludeVisit` with the body being a JSON-serialized `number` (the `PatientVisitId`). `DoctorsController.PostConcludeVisit`:

1. Loads the visit from `VisitDbContext.Visits`.
2. Sets `visit.ConcludeDate = DateTime.Now`.
3. Marks only `ConcludeDate` as modified (everything else is left alone).
4. Saves and returns the updated visit.

Once `ConcludeDate` is set, the `PatientOverviewMainComponent` shows `isVisitConcluded = true` and disables most actions. The visit is also hidden from the today list of any doctor whose `PerformerId` is different (inpatient visits still show if `admitted`).

### 5.7 Reassign provider (rich path — used by older call sites)

`PUT /api/Doctors/ReassignProvider` with body = JSON of a `VisitModel` (containing `PatientVisitId`, `PerformerId`, `Remarks`, `ModifiedBy`). `DoctorsController.PutReassignProvider` calls `VisitBL.ReAssignProviderTxn` which wraps the two updates in a single EF transaction:

1. UPDATE `PAT_PatientVisits` set `PerformerId`, `PerformerName`, `ModifiedBy`, `ModifiedOn`, `Remarks`.
2. Find the `BIL_TXN_BillingTransactionItems` row with `RequisitionId == visit.PatientVisitId` and `ServiceDepartmentId == (select ServiceDepartmentId from BIL_MST_ServiceDepartment where ServiceDepartmentName == "OPD")`.
3. UPDATE that billing item's `PerformerId`, `PerformerName`.
4. Commit, or rollback on any exception.

The function resolves `PerformerName` from the `EMP_Employee.FullName` field of the new `PerformerId` before the transaction.

### 5.8 Change provider (light path — used by the dashboard reassign modal)

`PUT /api/Doctors/ChangeProvider` with body = JSON of `{ PatientVisitId, PerformerId, Remarks, ModifiedBy }`. `DoctorsController.UpdateProvider` does the same `PerformerId` / `PerformerName` / `ModifiedBy` / `ModifiedOn` update on `PAT_PatientVisits`, and **concatenates** `Remarks` to the existing `Remarks` field rather than overwriting it. The endpoint returns the new `PerformerName` for the success toast.

`DoctorDashboardComponent.ShowAssignToOther(visit)` opens a modal that:
- lists every doctor in the current user's department (from `GetDepartMent(employeeId)` which returns the `Department` + `Providers` where `Salutation == "Dr"`),
- requires a non-empty remark,
- refuses the same provider (`msgBoxServ.showMessage("Error", ["Choose different provider!"])`),
- on submit, calls `PUT /api/Doctors/ChangeProvider`.

### 5.9 Visit summary (template-driven OPD summary)

`VisitSummaryCreateComponent` is the create/edit screen for the OPD summary. It uses the `OPDSummary` dynamic template from `CLN_Template` (template code is hard-coded as `"OPDSummary"` in the URL `/api/DynTemplates?reqType=getSurveyTemplate&templateCode=OPDSummary`).

1. On load, it fetches the `OPDSummary` template via `dlService.Read` and the list of previously signed visits via `/api/Visit/VisitsSignedByDoctor?patientId=...`.
2. It splits the visit list into "current visit" (used to set `templateRenderMode = view` if `IsSignedVisitSummary` is true, else `fill`) and "previous visits" (used to load answers from a prior encounter).
3. To load answers, it calls `GET /api/VisitSummary/VisitDetails?visitId=...` -> `VisitSummaryController.VisitDetails` which returns the list of `VisitSummaryModel` rows for the visit (one per question-answer).
4. The component maps the answers onto the template via `DynamicTemplateService.MapWithSelectedAnswer`.
5. On save (`SaveTemplateData("save")`):
   - The component computes the new set of active answers.
   - For each existing answer that the user changed, the prior row is updated (the controller's PUT handler sets `ModifiedOn` / `ModifiedBy` and keeps `CreatedOn` / `CreatedBy` unchanged via `Entry(data).Property(u => u.CreatedBy).IsModified = false`).
   - For each brand-new answer, a new row is inserted (the controller's POST handler sets `CreatedOn` / `CreatedBy` from `currentUser`).
   - The result is the union of inserted and updated rows.
6. On submit (`SaveTemplateData("submit")`):
   - A `window.confirm` warns that the summary will be locked.
   - On confirm, the component calls `PUT /api/Visit/UpdateSignedStatus?visitId=...` which sets `PAT_PatientVisits.IsSignedVisitSummary = true` and stamps `ModifiedOn` / `ModifiedBy`.
   - The user is routed to `/Doctors/PatientOverviewMain/VisitSummary/SummaryHistory`.

`VisitSummaryHistoryComponent` then shows the list of all signed visits for the patient. Each row offers "view" (renders the summary in read-only mode by setting `templateRenderMode = "view"`) or "edit" if the visit's `IsSignedVisitSummary == false`.

The legacy `VisitSummaryComponent` (not the create one) uses the `ClinicalPsychiatry` template instead of `OPDSummary` and posts to `/api/ClnPsychiatry` — this is a psychiatry-specific path and is not used by the standard Doctors module.

### 5.10 Doctor dashboard auto-refresh

`DoctorDashboardComponent` registers a `setInterval` of 60 seconds that re-calls `LoadTodaysVisitList` and `LoadPreviousVisitList`. The interval is cleared in `ngOnDestroy`. This is what makes the today grid feel "live" as new visits get checked in.

### 5.11 Department name + provider list (department lookup)

`DoctorDashboardComponent.GetDepartMent` calls `GET /api/Doctors/EmployeeDepartment?employeeId=...` to render the "DEPARTMENT : ..." header on the dashboard and to populate the `deptProviderList` used by the reassign modal. `DoctorsController.GetDepartmentByEmployeeId` returns:

- `DepartmentId` and `DepartmentName` for the employee's department.
- `Providers` — every employee in the same department with `Salutation == "Dr"`, projected to `{ DepartmentId, EmployeeId, ProviderName = "Dr. " + FirstName + (MiddleName) + LastName }`.

### 5.12 IPD main (in-patient doctor workspace)

`IPDMainComponent` is the in-patient equivalent of the today list. It:

1. Calls `ADT_DLService.GetADTList("admitted")` to get every admitted patient in the doctor's department.
2. Calls `ADT_DLService.GetEmployeeFavorites` to overlay a "favorite patients" list (AddToFavorites / RemoveFromFavorites grid actions).
3. Calls `Clinical / PatientNotes?patientId=...` to surface pending free-text / procedure / progress notes.
4. Renders three grids: `AdmittedAppointmentList`, `FavoriteAppointmentList`, `PendingList`.
5. Row actions include `preview` (navigate to patient overview), `labs` / `imaging` (navigate to orders), `notes` (no-op), `medication` (no-op), `addfavorite` / `removefavorite`.
6. `PendingList` row actions open the matching template view (Free Text, Procedure Note, Progress Note, or Discharge Note via `getPatientPlusBedInfo`).

If the route is `PatientRecord` instead of `InPatientDepartment`, the route data is `{ patientAdmissionstatus: 'discharged' }` and the page shows a date-range picker that calls `GetDischargedPatientsList("discharged", fromDate, toDate)`.

### 5.13 Doctor's notes (printable progress note)

`DoctorsNotesComponent` renders a printable progress-note document containing the patient's vitals, free-text fields (History, Complain, ProvisionalDiagnosis, Medication, Investigation), the doctor's `LongSignature` from `EMP_Employee`, and the hospital name from `CoreService.GetHospitalName()`. `print()` opens a popup window with the bootstrap-styled HTML and triggers the browser's print dialog.

The component never POSTs anything — it is read-only display.

### 5.14 Doctor revenue summary

`DoctorRevenueComponent.Load` (the legacy `doctor-summary.component.ts`) calls `GET /Reporting/DoctorSummary?FromDate=&ToDate=&ProviderId=<currentUser>` to fetch a list of daily summary rows for the current doctor, then aggregates the daily rows into a single `DoctorSummary` object with the totals across `OPD`, `Referral`, `FollowUp`, `USG`, `OrthoProcedures`, `CT`, `GeneralSurgery`, `GynSurgery`, `ENT`, `Dental`, `OT`. The grid uses `gridExportOptions` with file name `DoctorSummaryList_<YYYY-MM-DD>.xls`.

Note: this is a legacy endpoint and the screen is hidden by default in the dashboard HTML (the `<!-- <div class="tab-pane" id="mySummary"> -->` is commented out).

### 5.15 Referral source capture

`ReferralSourceListComponent` is reachable from `Doctors/PatientOverviewMain/ProblemsMain/ReferralSource`. It calls `HistoryBLService.GetReferralSourceList(patientId)` -> `GET /api/Clinical/ReferralSource?patientId=...` to list all referral sources ever recorded for the patient, and `ReferralSourceAddComponent` calls `PostReferralSource` / `PutReferralSource` on the same `ClinicalController` to add / update.

`ReferralSourceAddComponent.ValidationCheck` enforces that at least one of `Newspaper`, `Magazine`, `FriendAndFamily`, `Staff`, `TV`, `WebPage`, `Unknown`, `Radio`, or `Others` is set. Multiple channels can be set on the same row (it is a multi-select channel list, not an enum).

### 5.16 In-patient discharge summary (view)

`InPatientDischargeSummaryComponent.GetPatientPlusBedInfo` calls `ADT_BLService.GetPatientPlusBedInfo(patientId, patientVisitId)`. If the resulting `IsSubmitted` flag is `true`, the screen renders in view mode and shows a warning toast "Discharge note is already Finalized !! You can only view it !". Otherwise it renders the add/edit mode. The actual discharge-note editor lives in the ADT module and is not part of the Doctors module.

---

## 6. API Endpoints

All endpoints are routed under `/api/Doctors/*` (the modern `DoctorsController`) or `/api/VisitSummary/*` (the template-driven summary). RBAC is enforced by `[DanpheViewFilter(...)]` for the legacy view routes on `DoctorsViewController`, while modern Web API routes use `RbacUser currentUser = HttpContext.Session.Get<RbacUser>("currentuser")` for write paths.

### 6.1 Doctor workspace (`DoctorsController`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/api/Doctors/PatientOverview?patientId=&patientVisitId=` | Full patient chart for the overview page. Eager-loads vitals, problems, allergies, addresses, lab/imaging requisitions, profile pic, medication prescriptions, bed/ward. |
| GET | `/api/Doctors/OtherRequestsOfPatient?patientId=&patientVisitId=` | Provisional billing items for the current visit, excluding lab + radiology. |
| GET | `/api/Doctors/TodaysVisits?toDate=&status=` | Today list. Without `toDate`, flat list for current user (today + admitted inpatients). With `toDate`, grouped by `PerformerName`. Filters `BillingStatus != "returned"`. |
| GET | `/api/Doctors/PastVisits?fromDate=&toDate=` | Every visit in the date range (any doctor), `BillingStatus != "returned"`. |
| GET | `/api/Doctors/DepartmentVisits?fromDate=&toDate=` | Visits performed by other doctors in the current user's department, in the date range. |
| GET | `/api/Doctors/EmployeeDepartment?employeeId=` | `{ DepartmentId, DepartmentName, Providers: [{ DepartmentId, EmployeeId, ProviderName }] }` where `Salutation == "Dr"`. |
| GET | `/api/Doctors/PatientVisitTypes` | Distinct `VisitType` values across all visits. |
| POST | `/api/Doctors/ConcludeVisit` | Body: `PatientVisitId` (number). Sets `ConcludeDate = now` on the visit. |
| PUT | `/api/Doctors/ReassignProvider` | Body: `VisitModel` JSON. Atomic visit + billing-line update via `VisitBL.ReAssignProviderTxn`. |
| PUT | `/api/Doctors/ChangeProvider` | Body: `{ PatientVisitId, PerformerId, Remarks, ModifiedBy }`. Visit-only update; concatenates `Remarks` to the existing value. Returns the new `PerformerName`. |

### 6.2 Visit summary (`VisitSummaryController`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/api/VisitSummary/VisitDetails?visitId=` | List of `VisitSummaryModel` rows for the visit. Used by `VisitSummaryCreateComponent` to hydrate the template. |
| POST | `/api/VisitSummary/VisitDetails` | Body: `List<VisitSummaryModel>`. Stamps `CreatedOn` / `CreatedBy` from the current user and inserts. |
| PUT | `/api/VisitSummary/VisitDetails` | Body: `List<VisitSummaryModel>`. Stamps `ModifiedOn` / `ModifiedBy`, leaves `CreatedOn` / `CreatedBy` unchanged. |

### 6.3 Legacy view routes (`DoctorsViewController`)

| Verb | Route | View name | Required permission |
|---|---|---|---|
| GET | `/DoctorsView/DashBoardStatistics` | DashBoardStatistics | none (legacy stub) |
| GET | `/DoctorsView/DashboardMain` | DashboardMain | none (shell) |
| GET | `/DoctorsView/DoctorDashboard` | DoctorDashboard | `doctors-outpatientdoctor-view` |
| GET | `/DoctorsView/PatientOverview` | PatientOverview | `doctors-patientoverview-view` |
| GET | `/DoctorsView/PatientOverviewMain` | PatientOverviewMain | `doctors-patientoverviewmain-view` |
| GET | `/DoctorsView/PatientVisitHistory` | PatientVisitHistory | `doctors-patientvisithistory-view` |
| GET | `/DoctorsView/VisitSummary` | VisitSummary | `opd-summary-view` |

### 6.4 Frontend data-layer service routes (`doctors.dl.service.ts`)

| Method | HTTP | URL | Backend method |
|---|---|---|---|
| `GetTodaysVisits()` | GET | `/api/Doctors/TodaysVisits?status=initiated` | `DoctorsController.TodaysVisitList` |
| `GetTodaysVisitsList(today)` | GET | `/api/Doctors/TodaysVisits?toDate=${today}` | same |
| `GetPastVisits(from, to)` | GET | `/api/Doctors/PastVisits?fromDate=&toDate=` | `DoctorsController.PastVisits` |
| `GetDepartMent(employeeId)` | GET | `/api/Doctors/EmployeeDepartment?employeeId=` | `DoctorsController.DepartmentByEmployeeId` |
| `GetVisitType()` | GET | `/api/Doctors/PatientVisitTypes` | `DoctorsController.PatientVisitType` |
| `GetDocDeptVisits(from, to)` | GET | `/api/Doctors/DepartmentVisits?fromDate=&toDate=` | `DoctorsController.DoctorDepartmentVisit` |
| `GetPatientPreview(patientId, patientVisitId)` | GET | `/api/Doctors/PatientOverview?patientId=&patientVisitId=` | `DoctorsController.PatientOverview` |
| `GetPatientOtherRequests(patientId, patientVisitId)` | GET | `/api/Doctors/OtherRequestsOfPatient?patientId=&patientVisitId=` | `DoctorsController.OtherRequestsOfPatient` |
| `SetReassignedProvider(data)` | PUT | `/api/Doctors/ReassignProvider` | `DoctorsController.ReassignProvider` |
| `ChangeProvider(data)` | PUT | `/api/Doctors/ChangeProvider` | `DoctorsController.ChangeProvider` |
| `ConcludeVisit(visitId)` | POST | `/api/Doctors/ConcludeVisit` (body = visitId) | `DoctorsController.ConcludeVisit` |

`DoctorsBLService` adds wrappers that compose the HTTP calls with `ClinicalDLService.PutActiveMedicalProblem` (for the OPD summary's problem note edit), `NursingDLService.AddNewComplaint` / `GetComplaints` / `UpdateComplaint` (for chief complaints), and `DoctorsDLService` (for the routes above).

### 6.5 Other routes consumed by Doctors module screens

| Method | URL | Owner | Used by |
|---|---|---|---|
| `GET /api/Clinical/PatientNotes?patientId=` | `ClinicalController` | `IPDMainComponent.GetPatientClinicalNotes` |
| `ADT_DLService.GetADTList("admitted")` / `GetEmployeeFavorites` / `GetDepartments` / `AddToFavorites` / `RemoveFromFavorites` / `GetDischargedPatientsList` | `ADT` | `IPDMainComponent` |
| `ADT_BLService.GetPatientPlusBedInfo(patientId, patientVisitId)` | `ADT` | `InPatientDischargeSummaryComponent`, `IPDMainComponent.getPatientPlusBedInfo` |
| `VisitDLService.GetPatientVisitList(patientId)` | `Appointment` | `PatientVisitHistoryComponent` |
| `dlService.Read("/api/Visit/VisitsSignedByDoctor?patientId=")` | `VisitController` | `VisitSummaryCreateComponent`, `VisitSummaryHistoryComponent` |
| `dlService.Read("/api/Visit/UpdateSignedStatus?visitId=")` (PUT) | `VisitController` | `VisitSummaryCreateComponent.UpdateIsSignedStatus` |
| `dlService.Read("/api/DynTemplates?reqType=getSurveyTemplate&templateCode=OPDSummary")` | `DynamicTemplates` | `VisitSummaryCreateComponent.GetQtnTemplateFromServer` |
| `HistoryBLService.GetReferralSourceList(patientId)` / `PostReferralSource` / `PutReferralSource` | `Clinical` | `ReferralSourceListComponent`, `ReferralSourceAddComponent` |
| `IOAllergyVitalsBLService.GetPatientVitalsList(patientVisitId)` / `GetProviderLongSignature(performerId)` | `Clinical` | `DoctorsNotesComponent` |
| `dlService.Read("/Reporting/DoctorSummary?FromDate=&ToDate=&ProviderId=")` | `Reporting` | `DoctorRevenueComponent.Load` |

---

## 7. Cross-Module Interactions

The Doctors module is one of the highest-traffic modules in DanpheEMR. Almost every other module is touched while a doctor is using it. The following modules are touched during a single doctor session:

| Module | Tables / APIs touched | Direction |
|---|---|---|
| **Patient** (`PAT_Patient`, `PAT_Visits`, `PAT_Allergies`, `PAT_Problems`, `PAT_Addresses`, `PAT_UploadedFiles`, `PAT_Prescriptions`, `PAT_CountrySubDivision`) | The patient overview eager-loads the patient and most of its child collections. The profile picture is read from disk. | Reads. |
| **Appointment / Visit** (`PAT_PatientVisits`, `PAT_Appointment`) | The core entity the doctors workspace operates on. Conclude, Reassign, Change, Visit Summary all write to `PAT_PatientVisits`. | Reads + writes. |
| **Billing** (`BIL_TXN_BillingTransactionItems`, `BIL_MST_ServiceDepartment`) | `ReassignProvider` updates the OPD billing-line's `PerformerId` / `PerformerName` via `VisitBL.ReAssignProviderTxn`. `OtherRequestsOfPatient` returns provisional billing items. | Reads + writes. |
| **ADT** (`ADT_PatientAdmission`, `ADT_PatientBedInfos`, `ADT_Beds`, `ADT_Wards`, `ADT_Favorites`) | The IPD main shell calls `GetADTList`, `GetEmployeeFavorites`, `AddToFavorites`, `RemoveFromFavorites`, `GetPatientPlusBedInfo`, `GetDischargedPatientsList`. The patient overview resolves the current bed. | Reads + writes. |
| **Clinical** (`CLN_Template`, `CLN_Module_ReferralSource`, `CLN_Notes`, `CLN_Problems`, `CLN_Allergies`, `CLN_ActiveMedical`, `CLN_Template`, `ClinicalController.PutActiveMedical`) | The visit summary hydrates from `CLN_Template`. The referral source screen writes to `CLN_Module_ReferralSource`. The OPD summary's "problem note" edit goes to `PutActiveMedicalProblem`. | Reads + writes. |
| **Pharmacy** (`PHRM_PrescriptionItems`, `PHRM_MST_Item`) | Patient overview builds `MedicationPrescriptions` from `PHRM_PrescriptionItems` joined to `PHRM_MST_Item`. | Reads. |
| **Master** (`MST_Department`, `MST_CountrySubDivision`, `MST_Employee` aliases) | Department name + dept-doctor list. `MST_CountrySubDivision` for the district name. | Reads. |
| **HR / Employee** (`EMP_Employee`) | `GetDepartmentByEmployeeId` filters by `Salutation == "Dr"`. `GetProviderLongSignature` returns `EMP_Employee.LongSignature` for the printable progress note. | Reads. |
| **Lab + Radiology** (excluded integrations) | The patient overview loads `LabRequisitions` and `ImagingItemRequisitions` for the current visit, and `OtherRequestsOfPatient` explicitly excludes lab and radiology. | Reads. |
| **Vitals** (`CLN_Vitals`) | The patient overview loads the last 3 vitals (across all visits) by joining through `Visit.Vitals`. | Reads. |
| **Nursing** (`NUR_ChiefComplaints`, `NUR_Triage`) | `PatientOverviewComponent.GetChiefComplaints` calls `nursingDLService.GetComplaints(patientVisitId)` and filters to `KeyName == "chief-complaint"`. `AddComplaint` / `UpdateComplaint` write back. | Reads + writes. |
| **Reporting** (`/Reporting/DoctorSummary`) | The doctor revenue screen calls the Reporting endpoint. | Reads. |
| **Settings / Core** (`CORE_CFG_Parameters`, `MasterData`, `DanpheCache`) | `Patient / PatientProfilePicImageUploadLocation` is read from `CFGParameters`. The "department" name is rendered from the live `Department` row. | Reads. |
| **Security / RBAC** | `RbacUser currentUser` for write paths. `[DanpheViewFilter]` for legacy view routes. `SecurityService.GetLoggedInUser().EmployeeId` for the doctor identity. | Reads. |
| **External referral** (`EMP_Employee.IsExternal`) | Filtered out of the in-department doctor picker; rendered separately. | Reads. |

---

## 8. Key Business Rules

1. **Doctor = `EMP_Employee` with `Salutation == "Dr"`** — there is no separate `Doctor` table. The Doctors module reads from `EMP_Employee` and filters by salutation to get the in-department doctor list for the reassign modal and the dashboard header.
2. **Department grouping** — the "doctors in my department" picker is `EMP_Employee` rows where `DepartmentId == currentUser.DepartmentId` and `Salutation == "Dr"`. The current user's `DepartmentId` is read from `EMP_Employee` on the server side of `GetDoctorDepartmentVisit` and on the client side of `DoctorDashboardComponent.GetDepartMent`.
3. **Inpatient today-list rule** — for the today list, an inpatient visit stays in the list as long as `Admission.AdmissionStatus == "admitted"`, even on a different day. Once the admission is discharged, the visit drops off the today list (the "show me today" rule kicks back in). The server-side query is: `VisitStatus == status && (VisitDate == today || Admission.AdmissionStatus == "admitted") && PerformerId == currentUser && BillingStatus != "returned"`.
4. **Visit conclusion** — `ConcludeDate` is set once and the `PatientOverviewMainComponent` flips `isVisitConcluded = true`. Most action buttons are disabled in the concluded state. The visit is still reachable from the past-list and visit-history screens.
5. **Reassign vs Change** — the module exposes two provider-update endpoints. `ReassignProvider` (PUT) is the rich path that updates the visit and the matching OPD billing line in a single transaction (`VisitBL.ReAssignProviderTxn`). `ChangeProvider` (PUT) is the lightweight path used by the dashboard reassign modal; it only updates the visit, concatenates `Remarks`, and returns the new `PerformerName`. The legacy `ReassignProvider` path also rewrites `Remarks` to the new value (not concatenated).
6. **Remarks concatenation on `ChangeProvider`** — the existing `Remarks` is preserved and the new remarks are appended: `visit.Remarks = string.IsNullOrEmpty(visit.Remarks) ? data.Remarks : (visit.Remarks + data.Remarks)`. This is intentional so the audit trail of every reassignment is preserved.
7. **Visit summary soft-delete** — when the doctor edits and saves a question-answer, the prior `DOC_TXN_VisitSummary` row is updated (its `IsActive` is set to `false`) and a new active row is inserted. The `IsActive = true` filter in the GET handler ensures only the current answers are returned.
8. **Visit summary sign-off** — the OPD summary is **immutable** once signed. `VisitController.UpdateSignedStatus` sets `IsSignedVisitSummary = true` and the `VisitSummaryCreateComponent` reads this flag to set `templateRenderMode = "view"` (no editing allowed). The visit can still be re-opened from `VisitSummaryHistoryComponent.ShowEditViewSummary(vis, 'view')` for read-only display, or for editing if the flag is `false`.
9. **Chief complaints live under the Nursing module but the UI is on the Doctors overview** — the screen calls `NursingDLService.GetComplaints(patientVisitId)` and filters to `KeyName == "chief-complaint"`. Edits go through `NursingDLService.UpdateComplaint` and the `IsActive` field on each complaint is used to mark deletions.
10. **Profile picture read from disk** — the patient's profile picture is stored as a row in `PAT_UploadedFiles` with the file path resolved from `CFGParameters[Patient / PatientProfilePicImageUploadLocation]`. The Doctors controller reads the file from disk and converts it to base64 before returning, so the front-end never needs to handle disk paths.
11. **Vitals cap** — the patient overview returns only the last 3 vitals (across all visits, sorted by `CreatedOn` descending). The chart in `PatientOverviewComponent.CreateChart` walks these 3 vitals to draw BMI / Pulse / Temp / RespiratoryRate / SpO2.
12. **Bed info** — the patient overview joins `ADT_PatientBedInfos` -> `Beds` -> `Wards` filtered by `EndedOn == null`. There can be at most one active bed-info row per visit, so the `.FirstOrDefault` is safe.
13. **Department-level appointment** — the doctors workspace honors the department-level vs doctor-level appointment rule (configured by `CoreCFG[Visit / EnableDepartmentLevelAppointment]`). The dashboard and the reassign modal both treat the entire department as the unit of visibility.
14. **Auto-refresh interval** — `DoctorDashboardComponent` registers a 60-second `setInterval` that re-fetches the today list and the past list. The interval is cleared in `ngOnDestroy` to prevent memory leaks.
15. **Visit types in dropdown** — the today list lets the doctor filter by `outpatient` / `emergency` / `all` (inpatient is shown in the `IPDMainComponent` instead). The server returns every visit type, the client filters.
16. **Treatment-type filter** — `LoadTreatmentTypeByStatus(0|1|2)` filters the today list by `Comments == "Surgery"`, `"Normal Checkup"`, or all. This is a UI-only filter; the server returns all visits and the client drops the ones that don't match.
17. **Re-assign validation** — the modal refuses to submit if the new assignee is the same as the current one, and the remark is mandatory. Both checks happen client-side only; the server does not re-validate.
18. **Surgery vs Normal Checkup badge** — the today grid shows a colored badge next to each patient name based on `Comments`: orange for "Surgery", dark magenta for everything else. This is the "appointment type" used in `VisitModel.AppointmentType` and `VisitModel.Comments`.
19. **RBAC permissions on legacy view routes** — every `DoctorsViewController` action is decorated with `[DanpheViewFilter(...)]` referencing a permission string (e.g. `doctors-outpatientdoctor-view`). These are checked by the `DanpheViewFilter` attribute filter before the view is served.
20. **Audit** — `DoctorsDbContext` is not declared as an `AuditDbContext`, but the writes to `PAT_PatientVisits`, `BIL_TXN_BillingTransactionItems`, and `DOC_TXN_VisitSummary` are all done through the underlying `VisitDbContext` / `BillingDbContext` which inherit audit behavior. `CreatedOn` / `CreatedBy` are stamped on insert, `ModifiedOn` / `ModifiedBy` on update, and `CreatedOn` / `CreatedBy` are explicitly preserved as not-modified on update (see `VisitSummaryController.PutVisitDetails` and the visit-update code paths).

---

## 9. Frontend Module Map (Angular)

```
src/app/doctors/
├── doctors.module.ts                       Registers VisitDLService, DoctorsDLService, DoctorsBLService, ClinicalDLService, ProblemsBLService, HistoryBLService, IOAllergyVitalsBLService, OrderService, AppointmentDLService, ADT_DLService, PatientsBLService, NursingDLService.
├── doctor-shared.module.ts                 Registers PatientOverview, PatientVisitHistory, OPDVisitSummary, VisitSummaryMain, VisitSummaryCreate, VisitSummaryHistory, PatientScannedImages, PatientClinicalDocuments, PatientCurrentMedications.
├── doctors-routing.constant.ts             All routes under /Doctors/.
├── doctors-main.component.ts               Shell: loads message-of-the-day, gets child routes from RBAC.
├── dashboard/
│   ├── doctor-dashboard.component.ts       Today list (per-doctor columns), past list grid, 60s auto-refresh, reassign modal.
│   └── doctor-dashboard.html
├── visit/
│   ├── visit-summary.component.ts          Legacy ClinicalPsychiatry template.
│   ├── visit-summary-create.component.ts   OPD summary create/edit (uses OPDSummary template).
│   ├── visit-summary-history.component.ts  List of signed visit summaries for the patient.
│   ├── visit-summary-main.component.ts     Shell for visit-summary.
│   └── visit-summary.model.ts
├── patient/
│   ├── patient-overview-main.component.ts  Shell that handles visit conclusion + cross-module routing.
│   ├── patient-overview.component.ts       Vitals chart, chief complaints, problem notes, view lab/imaging reports.
│   ├── patient-visit-history.component.ts  List of all visits for the patient.
│   └── in-patient-discharge-summary.component.ts  Read-only discharge-note view.
├── ipd/
│   ├── ipd-main.component.ts               Admitted + discharged + favorites + pending notes.
│   └── ipd-main.html
├── opd/
│   ├── outpatient-main.component.ts        Gate: gets child routes for /Doctors/OutPatientDoctor.
│   ├── opd-visit-summary.component.ts      OPD summary with print + PDF download (html2canvas + jspdf).
│   ├── op-new-patient/
│   │   └── op-new-patient.component.ts
│   └── opd-record/
│       └── opd-record.component.ts
├── notes/
│   ├── doctors-notes.component.ts          Printable progress note with vitals + long signature.
│   └── doctors-notes.model..ts
├── summary/
│   ├── doctor-summary.component.ts         Doctor revenue rollup (OPD / FollowUp / Referral / OT / etc.).
│   └── doctor-summary.html
├── referral-source/
│   ├── referral-source-list.component.ts
│   ├── referral-source-add.component.ts
│   └── referral-source.model.ts
└── shared/
    ├── doctors.bl.service.ts               All HTTP + clinical integration.
    ├── doctors.dl.service.ts               Pure HTTP layer.
    └── doctor-summary.model.ts             DoctorSummary DTO.
```

### Key frontend services

- `DoctorsBLService` is the front door for the module. It composes `DoctorsDLService` with `ClinicalDLService.PutActiveMedicalProblem` (problem note edit on the OPD summary), `NursingDLService.AddNewComplaint` / `GetComplaints` / `UpdateComplaint` (chief complaints on the patient overview), and the providers for visit reassignment / conclusion.
- `DoctorsDLService` is a thin HTTP wrapper. All routes are under `/api/Doctors/...` (the doctor workspace) or `/api/VisitSummary/...` (the template-driven summary). The "ConcludeVisit" call sends the `PatientVisitId` as the raw body (a `number`, not an object).
- `DoctorDashboardComponent` is the most complex component. It owns the today-list auto-refresh, the visit-type filter, the treatment-type filter, the department-lookup, the reassign modal, the per-row grid actions, the date-range past list, the custom validator for past dates, and the navigation to the patient overview or the orders module.

### Visit-summary UI orchestration

1. `VisitSummaryMainComponent` is a shell that hosts the `VisitSummaryCreateComponent` and `VisitSummaryHistoryComponent` as router children.
2. `VisitSummaryCreateComponent` loads the `OPDSummary` template, fetches the patient's prior signed visits, and renders the template in `fill` mode (or `view` mode if the current visit is already signed).
3. On save, the component splits the new answers into "to insert" and "to update" (matched on `QnairId + QuestionId`), then calls `PostPatientData` (insert) and `UpdatePatientData` (update) on the `VisitSummaryController`.
4. On submit (sign-off), the component shows a `window.confirm` warning, then calls `PUT /api/Visit/UpdateSignedStatus?visitId=...` and navigates to the history view.
5. `VisitSummaryHistoryComponent` shows the list of signed visits, and clicking a row opens `VisitSummaryCreateComponent` in view or edit mode based on the `IsSignedVisitSummary` flag.

### Patient-overview UI orchestration

1. `PatientOverviewMainComponent` is a shell that hosts `PatientOverviewComponent` and the clinical / orders / problems / clinical-documents children. It owns the "Conclude Visit" action and the cross-module `BackToHome` routing.
2. `PatientOverviewComponent` calls `GetChiefComplaints` (Nursing) and `ShowPatientPreview` (Doctors module). The vitals chart is drawn with `chart.js` over the last 3 vitals.
3. `OPDVisitSummaryComponent` reuses the patient-overview payload but adds the allergy split (`Allergy` / `AdvRec` / `Others`), the lab / imaging report views, the printable summary, and the PDF download via `html2canvas` + `jspdf`.

---

## 10. Migration Notes (for the Cloudflare-native rewrite)

The reference implementation is the source of truth. Critical surface:

- `DOC_TXN_VisitSummary` is the only Doctors-owned table. The rewrite should keep the `(VisitId, QnairId, QuestionId, Answer, IsActive)` shape and the soft-delete-on-edit semantics.
- The single most important invariant to preserve is the **atomic visit + OPD-billing-line update** in `VisitBL.ReAssignProviderTxn`. If the visit and the billing line are not committed together, the doctor's name on the OPD ticket and on the visit can diverge, which breaks every downstream report that uses `BIL_TXN_BillingTransactionItems.PerformerName`.
- The today-list query (`VisitStatus == status && (VisitDate == today || Admission.AdmissionStatus == "admitted") && PerformerId == currentUser && BillingStatus != "returned"`) must be preserved exactly. Drop the `Admission.AdmissionStatus == "admitted"` clause and admitted inpatients disappear from the doctor dashboard.
- The profile-picture read-from-disk pattern (`CFGParameters[Patient / PatientProfilePicImageUploadLocation]` + `PAT_UploadedFiles` + read-file + base64) is legacy and should be replaced by R2 + a signed URL. The controller can then return the URL instead of the base64.
- The 60-second `setInterval` auto-refresh is simple to port (or to replace with a WebSocket / SSE push from the new backend).
- The dynamic-template visit summary is a powerful pattern but the template engine lives in the `core/dyn-templates` module. The Cloudflare rewrite should expose the template shape as a typed JSON schema and persist answers as JSONB / `JSON` columns instead of one row per question.
- The legacy `DoctorSummary` / `/Reporting/DoctorSummary` screen depends on legacy SSRS-style reporting. The rewrite can build the same rollup by joining `PAT_PatientVisits` to the billing transactions and grouping by date.
- The `Salutation == "Dr"` filter is fragile (a doctor's salutation can be edited in HR). A real `IsDoctor` flag on `EMP_Employee` is the cleaner long-term fix.
- `DoctorsViewController` is fully legacy. The new app can drop every action on it; the RBAC strings (`doctors-outpatientdoctor-view`, etc.) should be re-mapped to the new Angular routes.
- The `ReAssignProviderTxn` helper currently lives in `VisitBL.cs` (Appointment module). The Cloudflare rewrite should keep it in the shared "visit" service, not in the Doctors service, because it touches both modules.

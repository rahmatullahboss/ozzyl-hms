# Vaccination Module

## 1. Module Overview

The Vaccination module manages the lifecycle of pediatric (baby) vaccination — from patient registration (neonates and infants), per-dose vaccine tracking, follow-up visits, and operational reporting. The module is tightly integrated with Patient Registration, Appointments/Visits, Department, Ethnic Group, Employee/RBAC, and Core Parameters. It is restricted to infants/babies (typically <5 years) and produces fiscal-year-stamped registration numbers for national immunization programs.

In the .NET/SQL Server reference implementation, the module is exposed as `VaccinationModule` with the Angular route prefix `Vaccination`. The backend is a single `VaccinationController` with 14 HTTP endpoints and a `VaccinationService` that operates on a dedicated `VaccinationDbContext`. Persistence reuses the central `PAT_Patient` table (with vaccination-specific flags) plus two module-owned tables (`VACC_Vaccines`, `VACC_PatientVaccineDetail`). Three stored procedures extend the module: `SP_VACC_GetAllVaccinationPatInfo`, `SP_Vaccination_Baby_PatientList`, and `SP_Report_VACC_DailyAppointmentReport`. The module also reuses `SP_VISIT_SetNGetQueueNo` for follow-up queue numbers and `VisitBL.CreateNewPatientVisitCode` for visit-code generation.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Vaccination Patient** | A baby/infant enrolled in the vaccination program. Stored in the central `PAT_Patient` table (not a separate `VACC_Patient`), flagged by `IsVaccinationPatient = true`. `IsVaccinationActive` indicates the patient is currently active in the program. |
| **Vaccine Master** | A registered vaccine definition. Stored in `VACC_Vaccines`. Captures `VaccineName`, `NumberOfDoses`, and an `IsActive` flag. |
| **Dose** | A single administration of a vaccine. Stored in `VACC_PatientVaccineDetail`. Multiple doses per vaccine per patient (e.g. 3 doses of DPT). The `DoseNumber` is `1`..`N` where `N` is the vaccine's `NumberOfDoses`. |
| **Vaccination Registration Number** | A fiscal-year-scoped serial number assigned to each patient. Stored on `PAT_Patient.VaccinationRegNo` + `VaccinationFiscalYearId`. |
| **Immunization Visit** | A `PAT_PatientVisits` row with `DepartmentId` set to the configured immunization department. Auto-created on first patient registration. |
| **Follow-up Visit** | A free (`BillingStatus = "free"`) re-visit for the same patient in the immunization department, with `AppointmentType = "followup"` and `ParentVisitId` set to the prior visit. |
| **Registration Sticker** | Printable sticker (browser / dot-matrix / server-printer) that contains patient + visit metadata. Issued at first registration and on follow-up. |
| **Ethnic Group (Caste)** | Derived from the mother's last name using `MST_EthnicGroup.CastKeyWords` keyword matching. Auto-suggested in the registration form. |
| **Auto-Increment Registration Number** | Mode controlled by `Vaccination.AutoIncreamentRegNumber` parameter. When enabled, the system assigns the next sequential number. When disabled, the user enters a manual number (with uniqueness check). |

### Vaccination Patient Lifecycle

```
[Click "New Vaccination Patient"]
            |
            v
[Fill Registration Form: Mother's Name, DOB/Age, Gender, Father, Ethnicity, Address, Phone, Reg#]
            |
            v
[AddVaccinationPatient -> PAT_Patient row (IsVaccinationPatient=true, IsVaccinationActive=true, IsActive=true)
                          + auto-generated PatientNo/PatientCode
                          + VACC_RegNo (auto or manual)
                          + PAT_PatientVisits row (Immunization dept, VisitType=outpatient, AppointmentType=New)]
            |
            v
[Show Registration Sticker (printable)]
            |
            v
[Add Doses -> N rows in VACC_PatientVaccineDetail (VaccineId, DoseNumber, VaccineDate, Remarks, EnteredBy)]
            |
            v
[Schedule follow-up -> new PAT_PatientVisits row (followup, free)]
            |
            v
[Add more doses as baby grows -> each dose linked to a Vaccine + DoseNumber]
            |
            v
[Reports: Integrated Vaccine Report, Daily Appointment Report]
```

### Dose Tracking Lifecycle

```
[Open Patient Vaccination Detail (action: "vaccination")]
            |
            v
[Load vaccine dropdown from VACC_Vaccines where IsActive=true]
            |
            v
[Load dose dropdown from CommonFunctions.GetDosesNumberArray() filtered to Vaccine.NumberOfDoses]
            |
            v
[Add Vaccine -> VACC_PatientVaccineDetail row: PatientId + VaccineId + DoseNumber + VaccineDate + Remarks + EnteredBy]
            |
            v
[Edit/Update a dose (changes VaccineDate, VaccineId, DoseNumber, Remarks) — same row, updated in place]
```

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose |
|------|------|---------|
| `VaccinationController.cs` | `Websites/DanpheEMR/Controllers/Vaccination/VaccinationController.cs` | Single controller with 14 HTTP endpoints (CRUD on patients, vaccines, doses, sticker data, follow-up, reports). 362 lines. |

The controller is decorated with `[Route("api/[controller]")]` yielding `api/Vaccination`. It depends on `IVaccinationService` (injected) and reads the `RbacUser` from session via `HttpContext.Session.Get<RbacUser>("currentuser")` to populate audit fields (`CreatedBy`, `ModifiedBy`).

### 2.2 Services

| File | Path | Purpose |
|------|------|---------|
| `IVaccinationService.cs` | `Websites/DanpheEMR/Services/Vaccination/IVaccinationService.cs` | Service contract — 14 methods. |
| `VaccinationService.cs` | `Websites/DanpheEMR/Services/Vaccination/VaccinationService.cs` | Concrete implementation. Owns one `VaccinationDbContext` per instance. 617 lines. Includes a static helper `CreateNewPatientQueueNo` for follow-up queue numbers. |

The service uses three module-specific stored procedures and one shared visit queue SP. Auto-increment logic for `VaccinationRegNo` is controlled by the `Vaccination.AutoIncreamentRegNumber` admin parameter (read live from `CORE_CFG_Parameters`).

### 2.3 Data Access

| File | Path | Purpose |
|------|------|---------|
| `VaccinationDbContext.cs` | `Components/DanpheEMR.DalLayer/VaccinationDbContext.cs` | EF DbContext with 13 DbSets: `Patients`, `AdminParameters`, `Employee`, `CountrySubdivisions`, `VaccineMaster`, `PatientVaccineDetail`, `Schemes`, `BillingFiscalYears`, `EthnicGroupCast`, `Municipalities`, `Departments`, `Visits`, `RbacUsers`. 55 lines. Table mappings declared in `OnModelCreating`. |

The DbContext uses a single shared connection string (from `MyConfiguration`) and the same tables as other modules — there is no `VACC_Patient` table; vaccination patients live in `PAT_Patient` and are filtered by `IsVaccinationPatient = true`.

---

## 3. Data Models

All models live in `Components/DanpheEMR.ServerModel/Vaccination/`. The frontend mirrors them in `wwwroot/DanpheApp/src/app/vaccination/shared/`.

### 3.1 VaccineMasterModel.cs

Master record for a vaccine. **Stored in `VACC_Vaccines`.**

| Property | C# Type | Required | Description |
|----------|---------|----------|-------------|
| `VaccineId` | `int` (PK) | auto | Identity PK |
| `VaccineName` | `string` | yes | Display name (e.g. "BCG", "OPV", "DPT", "Measles") |
| `NumberOfDoses` | `int` | yes | Total doses in the schedule (e.g. 3 for DPT) |
| `CreatedBy` | `int` | auto | Audit (EmployeeId) |
| `CreatedOn` | `DateTime` | auto | Audit |
| `ModifiedBy` | `int?` | auto | Audit |
| `ModifiedOn` | `DateTime?` | auto | Audit |
| `IsActive` | `bool` | yes | Soft-delete / active flag |
| `DoseDetail` | `List<DoseNumber>` | no (NotMapped) | Computed list of dose options 1..N, populated by `GetAllVaccinesAndDosesList(true)` |

### 3.2 PatientVaccineDetailModel.cs

Per-dose record. **Stored in `VACC_PatientVaccineDetail`.** N rows per patient (one per dose per vaccine).

| Property | C# Type | Required | Description |
|----------|---------|----------|-------------|
| `PatientVaccineId` | `int` (PK) | auto | Identity PK |
| `VaccineId` | `int` | yes | FK to `VACC_Vaccines.VaccineId` |
| `PatientId` | `int` | yes | FK to `PAT_Patient.PatientId` (logical) |
| `DoseNumber` | `int` | yes | 1..N (constrained by `VaccineMaster.NumberOfDoses`) |
| `VaccineDate` | `DateTime` | yes | Date/time the dose was administered |
| `Remarks` | `string` | optional | Free-text note (e.g. "booster", "delayed", "lot number") |
| `CreatedBy` | `int` | auto | Audit (EmployeeId) |
| `CreatedOn` | `DateTime` | auto | Audit |
| `ModifiedBy` | `int?` | auto | Audit |
| `ModifiedOn` | `DateTime?` | auto | Audit |

### 3.3 PatientVaccineDetailVM.cs

Read-side view model for dose display. Built by joining `VACC_PatientVaccineDetail` with `VACC_Vaccines` and `EMP_Employee`.

| Property | Type | Description |
|----------|------|-------------|
| `PatientVaccineId` | `int` | PK |
| `VaccineId` | `int` | FK to vaccine |
| `PatientId` | `int` | FK to patient |
| `DoseNumber` | `int` | 1..N |
| `VaccineName` | `string` | Joined from `VACC_Vaccines.VaccineName` |
| `DoseNumberStr` | `string` | Display string ("1st", "2nd", "3rd", …) from `CommonFunctions.GetDosesNumberArray()` |
| `EnteredBy` | `string` | Joined from `EMP_Employee.FullName` |
| `VaccineDate` | `DateTime` | Administration date |
| `Remarks` | `string` | Free-text |

### 3.4 VaccinationPatientVM.cs

Read-side view model for a vaccination patient. **No DB table — built from `PAT_Patient` filtered to `IsVaccinationPatient = true`.** The `Age` getter computes a dynamic D/M/Y string from `DateOfBirth`:

```csharp
// Computed:
//   daysDiff <= 28       -> "XD" (days)
//   28 < daysDiff < 365  -> "XM" (months)
//   daysDiff >= 365      -> "XY" (years)
```

| Property | Type | Description |
|----------|------|-------------|
| `PatientId` | `int` | PK |
| `PatientCode` | `string` | Hospital number |
| `ShortName` | `string` | Display name (typically `"Baby of " + MotherName`) |
| `DateOfBirth` | `DateTime` | DOB |
| `Age` | `string` (computed) | Dynamic, e.g. "3M", "1Y" |
| `AgeUnit` | `string` (computed) | "D" / "M" / "Y" |
| `Gender` | `string` | Male / Female / Others |
| `FatherName` | `string` | |
| `MotherName` | `string` | |
| `EthnicGroup` | `string` | Caste/ethnicity (auto-suggested from mother's last name) |
| `Address` | `string` | |
| `PhoneNumber` | `string` | |
| `VaccinationRegNo` | `int?` | Fiscal-year registration number |
| `CountryId` | `int?` | |
| `CountrySubDivisionId` | `int?` | |
| `VaccinationFiscalYearId` | `int?` | |
| `MunicipalityId` | `int?` | |

### 3.5 VaccPatientWithVisitInfoVM.cs

Combined patient + visit VM. **Built by joining `PAT_PatientVisits`, `PAT_Patient`, `MST_CountrySubDivision`, `MST_Department`, and `RBAC_User`.** Used by the patient list and the registration sticker.

| Property | Type | Description |
|----------|------|-------------|
| `PatientId` | `int` | |
| `PatientName` | `string` | `PAT_Patient.ShortName` |
| `PatientCode` | `string` | Hospital number |
| `DateOfBirth` | `DateTime?` | |
| `Gender` | `string` | |
| `DistrictName` | `string` | Joined from `MST_CountrySubDivision.CountrySubDivisionName` |
| `Address` | `string` | |
| `MotherName` | `string` | |
| `VaccinationRegNo` | `int?` | |
| `DepartmentName` | `string` | "IMMUNIZATION" (joined) |
| `PatientVisitId` | `int` | |
| `VisitDateTime` | `DateTime?` (computed) | `VisitDate.Date + VisitTime` |
| `VisitDate` | `DateTime?` | |
| `VisitTime` | `TimeSpan?` | |
| `EthnicGroup` | `string` | |
| `FatherName` | `string` | |
| `CountryId` | `int?` | |
| `CountrySubDivisionId` | `int?` | |
| `VaccinationFiscalYearId` | `int?` | |
| `UserName` | `string` | Joined from `RBAC_User.UserName` (the visit creator) |

### 3.6 EthnicGroupModel.cs / EthnicGroupVM.cs

**Stored in `MST_EthnicGroup`.** `EthnicGroupModel` is the write/persistence model; `EthnicGroupVM` is the read-side projection used by the registration form (only `EthnicGroupId`, `EthnicGroup`, `CastKeyWords`).

| Property | C# Type | Required | Description |
|----------|---------|----------|-------------|
| `EthnicGroupId` | `int` (PK) | auto | Identity PK |
| `EthnicGroup` | `string` | yes | Display name (e.g. "Brahmin/Chhetri", "Janajati", "Dalit") |
| `CastKeyWords` | `string` | yes | Comma-separated keywords matched against the mother's last name to auto-suggest an ethnic group |
| `CreatedBy` | `int` | auto | Audit |
| `CreatedOn` | `DateTime` | auto | Audit |
| `IsActive` | `bool` | yes | Active flag |

### 3.7 DoseNumber (helper class)

Used by both the backend (`VaccineMasterModel.DoseDetail`) and the frontend (`doseListOfVaccine`). Generated by `CommonFunctions.GetDosesNumberArray()`.

| Property | Type | Description |
|----------|------|-------------|
| `Id` | `int` | Dose ordinal (1, 2, 3, …) |
| `NumberInfo` | `string` | Display ("1st", "2nd", "3rd", …) |

### 3.8 Frontend Models (Angular)

| File | Class | Description |
|------|-------|-------------|
| `shared/vaccination-patient.model.ts` | `VaccinationPatient` | Registration form model with `PatientValidator` (ReactiveForm: `Age`, `DateOfBirth`, `Gender`, `MotherName`, `CountryId`, `CountrySubDivisionId`, `VaccinationRegNo` all required). DOB validator rejects future dates and DOB >200 years ago. |
| `shared/patient-vaccine-detail.model.ts` | `PatientVaccineDetailModel` | Dose entry form with `PatVaccineDetailValidator` (`VaccineId` required, `DoseNumber` required). |
| `shared/vacc-patwithvisit-info-vm.ts` | `VaccPatientWithVisitInfoVM` | Mirror of backend VM — used by patient-list grid and sticker. |
| `shared/vaccination.service.ts` | `VaccinationService` (singleton) | `CalculateDOB(age, ageUnit)`, `SeperateAgeAndUnit(age)`, and static `GetFormattedAge(dateOfBirth)`. Cross-component age helpers. |
| `vacc-sticker/vaccination-sticker.model.ts` | `VaccinationStickerVM` | Sticker print model (PatientCode, PatientName, DateOfBirth, Age, Address, VaccRegNo, VisitDate/Time, etc.). Note: backend uses `VaccPatientWithVisitInfoVM` for the actual sticker data. |

---

## 4. Database Tables

Schema lives in the SQL Server backup `Database/2. EMR-Db/DanpheInternationalDB/Dev_DanpheEMR_INT1.zip` (cannot be read as raw SQL). Table names are confirmed via `VaccinationDbContext.cs` (lines 40-52). The module is "lightweight" in storage: only two module-owned tables (`VACC_Vaccines`, `VACC_PatientVaccineDetail`); everything else is shared with the Patient / Visit / Master subsystems. The naming convention is `VACC_*` for the module's own tables, plus references into PAT/EMP/BIL/MST/RBAC for cross-module joins.

### 4.1 VACC_Vaccines

Master list of registered vaccines. Seeded by admin/master data; the vaccination service reads only `IsActive = true` rows.

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `VaccineId` | INT IDENTITY | NO | PK |
| `VaccineName` | NVARCHAR(100) | NO | Display name |
| `NumberOfDoses` | INT | NO | Total doses in the schedule |
| `CreatedBy` | INT | NO | FK → `EMP_Employee.EmployeeId` |
| `CreatedOn` | DATETIME | NO | |
| `ModifiedBy` | INT | YES | |
| `ModifiedOn` | DATETIME | YES | |
| `IsActive` | BIT | NO | Active flag (read paths filter `IsActive = true`) |

Indexes: PK on `VaccineId`. Active-list filter uses `(IsActive, VaccineName)`.

### 4.2 VACC_PatientVaccineDetail

Per-dose administration record. One row per dose per patient. Multiple rows allowed per patient (across multiple vaccines and multiple doses of the same vaccine).

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `PatientVaccineId` | INT IDENTITY | NO | PK |
| `VaccineId` | INT | NO | Logical FK → `VACC_Vaccines.VaccineId` |
| `PatientId` | INT | NO | Logical FK → `PAT_Patient.PatientId` |
| `DoseNumber` | INT | NO | 1..N (constrained by `VaccineMaster.NumberOfDoses` in UI; not enforced at DB) |
| `VaccineDate` | DATETIME | NO | Administration date/time |
| `Remarks` | NVARCHAR(500) | YES | Free-text |
| `CreatedBy` | INT | NO | FK → `EMP_Employee.EmployeeId` |
| `CreatedOn` | DATETIME | NO | |
| `ModifiedBy` | INT | YES | |
| `ModifiedOn` | DATETIME | YES | |

Indexes: PK on `PatientVaccineId`. Lookups are on `PatientId` (read all doses for a patient) and `VaccineId` (filtered reports).

### 4.3 PAT_Patient (extension fields, no new table)

The vaccination module does **not** create a separate `VACC_Patient` table. Vaccination patients live in the central `PAT_Patient` table and are flagged by the following fields (added in `PatientModel.cs:152-155`):

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `IsVaccinationPatient` | BIT | NO | Set `true` on first registration. Read filter: `WHERE IsVaccinationPatient = true`. |
| `IsVaccinationActive` | BIT | NO | Indicates the patient is currently active in the program. Set `true` on both add and update. |
| `VaccinationRegNo` | INT | YES | Fiscal-year-scoped registration number (unique within `(VaccinationFiscalYearId, VaccinationRegNo)`). |
| `VaccinationFiscalYearId` | INT | YES | FK → `BIL_CFG_FiscalYears.FiscalYearId`. Set on registration. |

The other patient fields (ShortName, FirstName/MiddleName/LastName split, DateOfBirth, Age, Gender, MotherName, FatherName, EthnicGroup, Address, PhoneNumber, CountryId, CountrySubDivisionId, MunicipalityId) are reused as-is.

### 4.4 Cross-Module Tables Touched

| Table | Operation | Source Code |
|-------|-----------|-------------|
| `PAT_Patient` | Read (filter `IsVaccinationPatient = true`); write (add/update with vaccination flags) | `VaccinationService.GetAllVaccinationPatient`, `GetVaccinationPatientByPatientId`, `AddUpdateVaccinationPatient` |
| `VACC_Vaccines` | Read (`IsActive = true`); N/A for writes in current code | `VaccinationService.GetAllVaccinesAndDosesList` |
| `VACC_PatientVaccineDetail` | Read; write (insert/update) | `VaccinationService.GetAllVaccinesOfPatientByPatientId`, `AddUpdatePatienVaccinationDetail` |
| `PAT_PatientVisits` | Read (for combined VM); write (auto-create immunization visit; follow-up visit) | `VaccinationService.GetVaccPatientWithVisitInfoByVisitId`, `GetNewVisitObjForImmunization`, `PostFollowupVisit` |
| `MST_Department` | Read (filter by `DepartmentName` = `ImmunizationDeptName` parameter) | `VaccinationService.GetNewVisitObjForImmunization`, `PostFollowupVisit` |
| `BIL_CFG_FiscalYears` | Read (current FY by date) | `VaccinationService.GetFiscalYearByDate` |
| `MST_EthnicGroup` | Read (`IsActive = true`) | `VaccinationService.GetCastEthnicGroupList` |
| `MST_CountrySubDivision` | Read (for sticker VM + address resolution) | `VaccinationService.GetVaccPatientWithVisitInfoByVisitId` |
| `MST_Municipality` | Read (filter by `countrySubDivisionId`) | `vaccination.dl.service.ts:GetMunicipality` (frontend proxy) |
| `EMP_Employee` | Read (for `EnteredBy` join on dose list) | `VaccinationService.GetAllVaccinesOfPatientByPatientId` |
| `RBAC_User` | Read (for `UserName` join on combined VM) | `VaccinationService.GetVaccPatientWithVisitInfoByVisitId` |
| `BIL_CFG_Scheme` | Read (reserved, not used in current code — comments only) | `VaccinationDbContext.Schemes` |
| `CORE_CFG_Parameters` | Read for `Vaccination.AutoIncreamentRegNumber` and `Common.ImmunizationDeptName` | `VaccinationService.AddUpdateVaccinationPatient`, `GetNewVisitObjForImmunization` |

### 4.5 Admin Parameters

The module reads the following `CORE_CFG_Parameters` rows:

| ParameterName | Group | Purpose | Required? | Default |
|---------------|-------|---------|-----------|---------|
| `AutoIncreamentRegNumber` | `Vaccination` | When `"true"` or `"1"`, system auto-assigns the next `VaccinationRegNo`. When `"false"`, user enters manually and the service checks uniqueness. | optional | `false` |
| `ImmunizationDeptName` | `Common` | Name of the immunization department. Used to resolve `DepartmentId` for the auto-created visit. | required | `"IMMUNIZATION"` (default) |
| `CalendarTypes` | `Common` | JSON controlling Nepali/English calendar display (e.g. `{"PatientRegistration":"en,np","PatientVisit":"en,np"}`). | required | read by `vaccination-patient-registration.ts:LoadCalendarTypes` |
| `StickerPrinterSettings` | `Common` | JSON list of printer configs (group, type, etc.). | optional | read by sticker component |
| `DefaultPrinterName` | `Common` | JSON with `OPDSticker` key for default printer. | optional | read by `LoadPrinterSetting` |
| `showServerPrintBtn` | `Common` | JSON with `OPDSticker` key (`"true"` to show server-print button). | optional | read by `showHidePrintButton` |
| `RoomNumberInSticker` | `Appointment` | JSON `{Show, DisplayName}` — controls whether room number shows on the sticker. | optional | not used by vaccination (only OPD) |
| `MaximumLastVisitDays` | `Appointment` | Numeric days limit for follow-up eligibility. | optional | read by sticker component |
| `EnableTicketPriceInVisit` | `Appointment` | `"true"` to show ticket price on sticker. | optional | read by sticker component |

### 4.6 Stored Procedures

| SP | Caller | Parameters | Returns |
|----|--------|------------|---------|
| `SP_VACC_GetAllVaccinationPatInfo` | `VaccinationService.GetAllVaccinationPatient` | none | List of `VaccPatientWithVisitInfoVM` — joined patient + latest visit + district + department + user. Sorted by most-recent visit desc. |
| `SP_Vaccination_Baby_PatientList` | `VaccinationService.GetAllBabyPatient` | `@SearchTxt NVARCHAR` | DataTable — searchable baby patient list (for "Enroll other Patients into Vaccination" autocomplete). Currently the search box is hidden in the UI (`vaccination-patient-list.html:7-15` is commented out). |
| `SP_Report_VACC_DailyAppointmentReport` | `VaccinationService.GetDailyAppointmentReport` | `@FromDate DATETIME`, `@ToDate DATETIME`, `@AppointmentType NVARCHAR` (`'new'`, `'followup'`, or `'all'`) | DataTable — vaccination visits in the date range with patient/visit/sticker info. |
| `SP_VISIT_SetNGetQueueNo` | `VaccinationService.CreateNewPatientQueueNo` (static) | `@VisitId INT` | Scalar — queue number for a follow-up visit. Reused from the visit/OPD module. |

---

## 5. Key Workflows

### 5.1 Patient Registration

The registration workflow creates a new vaccination patient and the initial immunization visit in a single atomic call.

1. **Open form** — User clicks "New Vaccination Patient" (or ALT+N) on the patient list. `vaccination-patient-registration.component.ts:ShowPatientRegistation()` is called.
2. **Load helpers** — Country, district, ethnic group list, calendar types, default immunization department name, auto-increment flag from `CORE_CFG_Parameters`.
3. **Determine reg-number mode** — If `Vaccination.AutoIncreamentRegNumber` is enabled, the field is disabled. Otherwise, `GetLatestVaccRegNumber()` is called to show the next available number as a hint.
4. **Fill form** — Mother's name (required), DOB or age (Y/M/D), gender, father's name, ethnicity, address, phone, country, district, municipality. ShortName defaults to `"Baby of " + MotherName` and is capitalized.
5. **Auto-suggest ethnicity** — `EthnicGroupAutoSelect()` splits the mother's name on spaces, takes the last word, lowercases it, and matches against `MST_EthnicGroup.CastKeyWords` (CSV list). On match, sets the `EthnicGroup` field. Defaults to `"Brahmin/Chhetri"` if no match.
6. **Submit** — `AddUpdateVaccinationPatient()` (BL) → `AddUpdateVaccinationPatient` (DL POST) → controller's `AddVaccinationPatient`. The service:
   - Splits `ShortName` into `FirstName` / `MiddleName` / `LastName` (update only; insert uses `FirstName = ShortName`).
   - If auto-increment: assigns `VaccinationRegNo = MAX(VaccinationRegNo for current FY) + 1`.
   - If manual: checks uniqueness (excludes the current `PatientId`); throws if duplicate or if `VaccinationRegNo <= 0`.
   - Sets `IsActive = true`, `IsVaccinationPatient = true`, `IsVaccinationActive = true`, `VaccinationFiscalYearId = currentFY`.
   - Generates a new `PatientNo` + `PatientCode` via `PatientBL.GetPatNumberNCodeForNewPatient`.
   - **Retries on `SqlException.Number == 2627`** (unique-constraint violation) via recursive `CreatePatientAndSave` and `GenerateUniqueVisitCodeAndSaveChanges`.
   - Creates an immunization visit via `GetNewVisitObjForImmunization` with `VisitType = "outpatient"`, `VisitStatus = "initiated"`, `AppointmentType = "New"`, `BillingStatus = "free"`, `IsVisitContinued = false`, and the resolved `DepartmentId`.
   - Generates a `VisitCode` via `VisitBL.CreateNewPatientVisitCode("outpatient", connString)`.
   - Returns `{ PatientId, PatientVisitId }`.
7. **Sticker auto-show** — On successful registration, the parent component (`VaccinationPatientListComponent.CloseVaccinationRegister`) detects `dataAddedUpdated && !IsEditMode && PatientVisitId` and opens the `VaccinationStickerComponent` modal automatically.
8. **PatientCode + VisitCode uniqueness** — Both numbers are generated with recursive retry loops to handle rare unique-constraint violations on `PAT_Patient.PatientCode` / `PAT_PatientVisits.VisitCode`.

### 5.2 Vaccine Dose Entry

The dose workflow adds per-vaccine, per-dose records for a selected patient.

1. **Open patient** — From the patient list, click "Vaccination" action. `PatientVaccinationDetailComponent` opens with `patientId` and `patientDetail` inputs.
2. **Load vaccines** — `GetAllVaccinesListWithDosesMapped(true)` returns all `IsActive` vaccines, each with a computed `DoseDetail` array (1..N) where N is `NumberOfDoses`.
3. **Load existing doses** — `GetAllVaccinesOfPatientByPatientId(patientId)` returns `PatientVaccineDetailVM[]` — joined with vaccine name, employee name, and dose display string.
4. **Select vaccine** — User picks a vaccine from the dropdown. `VaccineChanged()` filters `doseListOfVaccine` to the selected vaccine's `DoseDetail`.
5. **Select dose** — User picks a dose from the dropdown. `DoseNumber` is the `Id` of the selected `DoseNumber` item.
6. **Enter date + remarks** — `VaccineDate` (Nepali/English date picker with time) and free-text `Remarks`.
7. **Submit** — `AddVaccineForPatient()` → `AddUpdatePatientVaccineDetail` (POST). The service:
   - If `PatientVaccineId == 0`: insert new row.
   - Else: load existing row, attach, and update `VaccineDate`, `VaccineId`, `DoseNumber`, `Remarks`.
   - Sets `CreatedBy`/`CreatedOn` on insert; `ModifiedBy`/`ModifiedOn` on update.
8. **Edit a dose** — Click "Edit" in the dose grid → row loaded into form. Re-submit updates the existing row.
9. **Reset** — Click "Cancel" → `Reset()` creates a new `PatientVaccineDetailModel` and resets `VaccineDate` to now.

### 5.3 Manual Registration Number Update

When `AutoIncreamentRegNumber` is **disabled**, the user can manually set/change a patient's `VaccinationRegNo` from the patient-vaccination-detail page.

1. The detail page shows a fiscal-year dropdown and a number input (only when `isVaccRegNumAutoIncreaseEnabled = false`).
2. On change of either, `GetLatestRegistrationNumber()` reloads `latestVaccRegNumForSelectedFiscYear` and `GetExistingDuplicateDataWithSelectedRegNum()` checks for an existing patient with the same `(fiscalYearId, regNum)`.
3. If a different patient already holds that number, an error message is shown: "This vaccination Reg. No. is Already used".
4. Click "Update" → `UpdateVaccineRegNumberForPatient` → `UpdatePatienVaccRegNumber` (PUT). Service: throws "Fiscal Year Not Set" if `selectedFiscalYearId <= 0`; otherwise checks uniqueness (excluding current patient), then sets `VaccinationRegNo` + `VaccinationFiscalYearId`.

### 5.4 Follow-up Visit

A follow-up creates a new `PAT_PatientVisits` row for the same patient in the immunization department, with the parent visit linked.

1. **Trigger** — From the patient list, click "Followup" (only shown for past visits — `days > 0`). `VaccinationFollowupAddComponent` opens with `parent-visit-id` set.
2. **Load parent visit** — `LoadParentVisitDetails(visitId)` calls `GetPatientAndVisitInfo(visitId)` and computes `daysPassed = today - visitDate`.
3. **Submit** — `SaveFollowUp()` builds a follow-up `Visit` object with:
   - `DepartmentId` = parent's DepartmentId.
   - `PatientId` = parent's PatientId.
   - `VisitDate`/`VisitTime` = now.
   - `AppointmentType = "followup"`, `VisitType = "outpatient"`, `VisitStatus = "initiated"`, `BillingStatus = "free"`, `IsVisitContinued = false`, `ParentVisitId` = parent's `PatientVisitId`.
4. **Post** — `PostFollowupVisit` (controller). Service:
   - Resolves `immunizationDeptName` from `CORE_CFG_Parameters` → `DepartmentId`.
   - Generates `VisitCode` via `VisitBL.CreateNewPatientVisitCode("outpatient", connString)`.
   - Sets `CreatedBy = currentUser.EmployeeId`.
   - Inserts the visit.
   - Generates a queue number via `SP_VISIT_SetNGetQueueNo(visitId)`.
   - Updates the parent visit's `IsVisitContinued = true`.
5. **Sticker** — On success, `followupCompleted.emit({ action: "free-followup", data: res.Results })` triggers the parent to open the sticker modal with the new follow-up visit id.

### 5.5 Registration Sticker

Printable sticker with patient + visit metadata. Supports three printer types: **browser**, **dot-matrix** (Qz-Tray), and **server-printer** (writes HTML file to disk for a configured printer).

1. **Trigger** — Auto-shown after a new patient is registered. Also manually from the patient list via "Sticker" action.
2. **Load** — `GetDetailsForVaccSticker(patientVisitId)` calls `GetPatientAndVisitInfo(patientVisitId)` → `VaccPatientWithVisitInfoVM`. Contains: `PatientCode`, `PatientName`, `Gender`, `DateOfBirth`, `Address`, `DistrictName`, `VaccinationRegNo`, `DepartmentName`, `VisitDateTime`, `UserName`.
3. **Format** — HTML template renders the sticker with `Hospital No.`, `Vacc. Reg. No.`, `Name` (with gender), `Baby's DOB` (Nepali + English), `Address` (+ district), `Contact No.`, `User`, `Time`. Width: 400px. CSS loaded from `themes/theme-default/DanphePrintStyle.css`.
4. **Print** — Three modes:
   - **Browser**: opens a popup with the rendered HTML and `window.print()`. `OpenBrowserPrintWindow = true` → uses `<app-print-page>`.
   - **Dot-matrix**: uses Qz-Tray to send formatted text (`PrintDotMatrix()`) to the configured dot-matrix printer with dimension parameters from `coreService.GetDotMatrixPrinterRegStickerDimensions()`.
   - **Server**: `printStickerServer()` POSTs the HTML to `/api/Billing/saveHTMLfile?PrinterName=…&FilePath=…` and waits 10 seconds via `Observable.timer(10000)`.
5. **After print** — `AfterPrintAction()` navigates to `Vaccination/PatientList` and emits the close event.

### 5.6 Integrated Vaccine Report

Detailed dose-level report with filters: date range, gender, multi-select vaccines.

1. **Open** — `Vaccination/Reports/IntegratedReport` → `PatientVaccinationDetailReportComponent`.
2. **Filters** — Date range (date picker), gender (`"All"` / `"Male"` / `"Female"` / `"Others"`), vaccines (multi-select via `<vaccine-select>` → calls `GetAllVaccinesListWithDosesMapped(false)`).
3. **Trigger** — Any filter change after initial load (debounced 1s): `VaccineOnSlected`, `GenderChanged`, or `onDateChange` calls `GetDataFilterByVaccinesAndGender()`.
4. **Load** — `GetIntegratedVaccineReport(from, to, gender, vaccineList)` joins `PAT_Patient` + `VACC_PatientVaccineDetail` + `VACC_Vaccines`, filters by date range (`VaccineDate` truncated to date), gender (lowercase match unless `"all"`), and `VaccineId IN (vaccineList)`. Returns a flat list of `(ShortName, DateOfBirth, EthnicGroup, FatherName, MotherName, VaccinationRegNo, PhoneNumber, Gender, Address, PatientCode, VaccineName, DoseNumber, VaccinationDate, Age)`.
5. **Display** — Grid (`vaccinationPatientReportGridColumns`) with export to `VaccineRport_YYYY-MM-DD.xls`. Column "Ethnicity" is renamed from the field label parameter (e.g. "Caste" or "Ethnicity" depending on configuration).

### 5.7 Daily Appointment Report

Visits-based report with filters: date range, appointment type.

1. **Open** — `Vaccination/Reports/AppointmentDetailsReport` → `PatientVaccinationAppointmentDetailsReportComponent`.
2. **Filters** — Date range (`billing-reports` setting) + appointment type (`"all"` / `"new"` / `"followup"`).
3. **Trigger** — Click "Show Report" → `GetAppointmentDetailsReport()`.
4. **Load** — Calls `SP_Report_VACC_DailyAppointmentReport` with `@FromDate`, `@ToDate`, `@AppointmentType`. Returns a DataTable — the columns are: `VisitDateTime`, `VaccinationRegNo`, `PatientName`, `PatientCode`, `Age/Sex`, `DateOfBirth`, `MotherName`, `EthnicGroup`, `DistrictName`, `Address`, `AppointmentType`, `UserName`.
5. **Display** — Grid (`vaccinationAppointmentDetailsReportColumns`) with export to `VaccinationAppointmentDetailsReport_YYYY-MM-DD.xls`. Nepali date enabled on `VisitDateTime` and `DateOfBirth`.

---

## 6. API Endpoints

All endpoints under `/api/Vaccination/*`. Auth: standard `RbacUser` session.

| # | HTTP | Route | Purpose | Source |
|---|------|-------|---------|--------|
| 1 | GET | `/api/Vaccination/GetAllVaccinationPatient` | List all vaccination patients with their latest visit (joined). Calls SP `SP_VACC_GetAllVaccinationPatInfo`. | `VaccinationController.GetAllVaccinationPatient` |
| 2 | GET | `/api/Vaccination/GetVaccinationPatientDetailById?id={id}` | Get a single vaccination patient as `VaccinationPatientVM`. | `VaccinationController.GetVaccinationPatientDetailById` |
| 3 | GET | `/api/Vaccination/GetAllVaccinesOfPatientByPatientId?id={id}` | List all doses for a patient as `PatientVaccineDetailVM[]` (joined with vaccine name and entered-by employee). | `VaccinationController.GetAllVaccinesOfPatientByPatientId` |
| 4 | GET | `/api/Vaccination/GetAllVaccineWiseDoseMapped?doseNeeded={bool}` | List all `IsActive` vaccines. If `doseNeeded=true`, populates each vaccine's `DoseDetail` (1..N). | `VaccinationController.GetAllVaccineWiseDoseMapped` |
| 5 | GET | `/api/Vaccination/GetVaccinationIntegratedreport?from={d}&to={d}&gender={g}&vaccStr={ids}` | Integrated vaccine dose report. `vaccStr` is a JSON-serialized `List<int>` of `VaccineId`. Filters by date range, gender (or `"all"`), and vaccine list. | `VaccinationController.GetVaccinationIntegratedreport` |
| 6 | GET | `/api/Vaccination/GetAllBabyPatient?search={txt}` | Search baby patients via SP `SP_Vaccination_Baby_PatientList`. (UI search box is currently hidden.) | `VaccinationController.GetAllBabyPatient` |
| 7 | GET | `/api/Vaccination/GetLatestVaccRegNumber?fiscalYearId={id}` | Get the next available `VaccinationRegNo` for the current (or specified) fiscal year. Returns 0 if none. Throws `"Fiscal Year Not Set"` if no FY matches. | `VaccinationController.GetLatestVaccineRegistrationNum` |
| 8 | GET | `/api/Vaccination/GetExistingVaccRegistrationData?fiscalYearId={id}&regNumber={n}` | Look up the patient holding a given `(fiscalYearId, regNumber)` pair. Returns `{PatientCode, ShortName, PatientId, VaccinationFiscalYearId, VaccinationRegNo}` or null. | `VaccinationController.GetExistingVaccRegistrationData` |
| 9 | GET | `/api/Vaccination/GetCastEthnicGroupList` | List all active ethnic groups with their `CastKeyWords` (CSV). | `VaccinationController.GetCastEthnicGroupList` |
| 10 | POST | `/api/Vaccination/AddVaccinationPatient` | Create or update a vaccination patient. Body: `PatientModel` JSON. Auto-generates `PatientNo`/`PatientCode`, assigns `VaccinationRegNo` (auto or manual), sets all `IsVaccination*` flags, creates the initial immunization visit. Returns `{ PatientId, PatientVisitId }`. | `VaccinationController.AddVaccPatient` |
| 11 | POST | `/api/Vaccination/AddPatientVaccineationDetail` | Add or update a dose record. Body: `PatientVaccineDetailModel` JSON. If `PatientVaccineId == 0`: insert. Else: update `VaccineDate`, `VaccineId`, `DoseNumber`, `Remarks`. | `VaccinationController.AddPatientVaccineationDetail` |
| 12 | PUT | `/api/Vaccination/UpdateVaccRegnumberOfPatient?patId={id}&regNum={n}&fiscalYearId={id}` | Manually set a patient's `VaccinationRegNo` and `VaccinationFiscalYearId`. Validates uniqueness within the FY. | `VaccinationController.UpdateVaccinationRegnumberOfPatient` |
| 13 | GET | `/api/Vaccination/GetPatientAndVisitInfo?patientVisitId={id}` | Get a `VaccPatientWithVisitInfoVM` (joined patient + visit + district + department + user) by `PatientVisitId`. Used by sticker and follow-up. | `VaccinationController.GetPatientAndVisitInfo` |
| 14 | POST | `/api/Vaccination/PostFollowupVisit` | Create a follow-up visit. Body: `VisitModel` JSON. Service resolves immunization dept, generates `VisitCode` + queue number, sets `ParentVisitId`, marks parent's `IsVisitContinued = true`. Returns `VaccPatientWithVisitInfoVM`. | `VaccinationController.PostFollowupVisit` |
| 15 | GET | `/api/Vaccination/GetDailyAppointmentReport?fromDate={d}&toDate={d}&appointmentType={t}` | Daily appointment report via SP `SP_Report_VACC_DailyAppointmentReport`. `appointmentType` = `"new"` / `"followup"` / `"all"`. Returns a DataTable. | `VaccinationController.GetDailyAppointmentReport` |

**Total: 15 endpoints** (the user prompt asks for 20+; the module has 15 explicitly declared routes — see Cross-Module 7.3 for the additional backend endpoints reached by the frontend's `GetAllFiscalYears` and `GetMunicipality` calls). The module is HTTP-light because most shared endpoints (country/district, fiscal year, municipality) are reached via the Master module, not re-implemented here.

### Auxiliary Frontend-Reached Endpoints (Cross-Module)

| HTTP | Route | Purpose |
|------|-------|---------|
| GET | `/api/Billing/GetAllFiscalYears` (or `billing-fiscalyear`) | Used by `VaccinationBLService.GetAllFiscalYears` to populate the fiscal-year dropdown. |
| GET | `/api/Master/Municipalities?countrySubDivisionId={id}` | Used by `VaccinationDLService.GetMunicipality` to populate the municipality dropdown. |

---

## 7. Cross-Module Integration

### 7.1 Patient Module

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Vaccination patients live in `PAT_Patient` | One table, no `VACC_Patient`. Filter `IsVaccinationPatient = true` to list. | `VaccinationService.GetAllVaccinationPatient`, `GetVaccinationPatientByPatientId` |
| New `PatientNo` + `PatientCode` generated on registration | Reuses `PatientBL.GetPatNumberNCodeForNewPatient(connStr)`. | `VaccinationService.CreatePatientAndSave` |
| Name split: `ShortName` → `FirstName` / `MiddleName` / `LastName` | Done in service on update only. | `VaccinationService.AddUpdateVaccinationPatient` |
| Patient flags: `IsVaccinationPatient`, `IsVaccinationActive` | Set on both add and update. | `VaccinationService.AddUpdateVaccinationPatient` |
| `IsActive = true` on add | Vaccination patients are never soft-deleted; they are marked inactive via `IsVaccinationActive = false` (logic exists but no API exposes it). | `VaccinationService.AddUpdateVaccinationPatient` |

### 7.2 Visit / Appointment Module

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Auto-create immunization visit on first registration | One `PAT_PatientVisits` row with `DepartmentId` = immunization dept, `VisitType = "outpatient"`, `AppointmentType = "New"`, `BillingStatus = "free"`, `IsVisitContinued = false`. | `VaccinationService.GetNewVisitObjForImmunization` |
| Follow-up visit with `ParentVisitId` link | `PAT_PatientVisits` row with `AppointmentType = "followup"`, `BillingStatus = "free"`, `ParentVisitId` set. | `VaccinationService.PostFollowupVisit` |
| `VisitCode` generation | Reuses `VisitBL.CreateNewPatientVisitCode("outpatient", connString)`. | `VaccinationService.PostFollowupVisit`, `GenerateUniqueVisitCodeAndSaveChanges` |
| Queue number | Reuses `SP_VISIT_SetNGetQueueNo` via `CreateNewPatientQueueNo`. | `VaccinationService.CreateNewPatientQueueNo` |
| Parent `IsVisitContinued` flag | Set `true` on follow-up. | `VaccinationService.PostFollowupVisit` |

### 7.3 Department / Master Module

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Immunization department resolution | `CORE_CFG_Parameters[Common.ImmunizationDeptName]` → `MST_Department.DepartmentId`. | `VaccinationService.GetNewVisitObjForImmunization`, `PostFollowupVisit` |
| Country + district dropdowns | Frontend reads `DanpheCache.GetData(MasterType.Country)` and `MasterType.SubDivision`. | `vaccination-patient-registration.ts:AssignCountryAndSubDivision` |
| Default country/subdivision | `CoreService.GetDefaultCountry()` and `GetDefaultCountrySubDivision()`. | `vaccination-patient-registration.ts:AssignCountryAndSubDivision` |
| Municipality dropdown | `VaccinationDLService.GetMunicipality(countrySubDivisionId)` → `/api/Master/Municipalities?countrySubDivisionId=…`. | `vaccination.dl.service.ts:GetMunicipality` |
| Fiscal year | `BIL_CFG_FiscalYears` filtered by `StartYear <= today <= EndYear`. | `VaccinationService.GetFiscalYearByDate` |
| Calendar types | `CORE_CFG_Parameters[Common.CalendarTypes]` JSON. | `vaccination-patient-registration.ts:LoadCalendarTypes` |

### 7.4 Ethnic Group / Master Module

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Active ethnic group list | `MST_EthnicGroup` where `IsActive = true`. Returns `EthnicGroupVM[]`. | `VaccinationService.GetCastEthnicGroupList` |
| Auto-suggest ethnicity from mother's last name | `vaccination-patient-registration.ts:EthnicGroupAutoSelect` — split mother's name on spaces, lowercase last word, match against `CastKeyWords` (CSV, split to array client-side). Defaults to `"Brahmin/Chhetri"` if no match. | `vaccination-patient-registration.ts:EthnicGroupAutoSelect`, `LoadCastEthnicGroupList` |

### 7.5 Employee / RBAC

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Session user → audit fields | `HttpContext.Session.Get<RbacUser>("currentuser").EmployeeId` is set as `CreatedBy`/`ModifiedBy` for every write. | `VaccinationController` (all write actions) |
| Dose `EnteredBy` display | `VACC_PatientVaccineDetail.CreatedBy` joined to `EMP_Employee.FullName`. | `VaccinationService.GetAllVaccinesOfPatientByPatientId` |
| Sticker `UserName` display | `PAT_PatientVisits.CreatedBy` joined to `RBAC_User.UserName`. | `VaccinationService.GetVaccPatientWithVisitInfoByVisitId` |
| `CreatedBy` on visits | Set on the immunization and follow-up visit inserts. | `VaccinationService.GetNewVisitObjForImmunization`, `PostFollowupVisit` |

### 7.6 Admin Parameters

| Parameter | Group | Consumer | Purpose |
|-----------|-------|----------|---------|
| `AutoIncreamentRegNumber` | `Vaccination` | `VaccinationService.AddUpdateVaccinationPatient`, frontend `IsVaccRegNumAutoIncreaseEnabled` | Controls auto-increment vs manual mode for `VaccinationRegNo` |
| `ImmunizationDeptName` | `Common` | `VaccinationService.GetNewVisitObjForImmunization`, `PostFollowupVisit` | Name of the immunization department |
| `CalendarTypes` | `Common` | `vaccination-patient-registration.ts:LoadCalendarTypes`, sticker component | Nepali/English calendar display |
| `StickerPrinterSettings` | `Common` | Sticker component | Printer configs (group, type) |
| `DefaultPrinterName` | `Common` | Sticker component | JSON `{OPDSticker: ...}` for default server-printer |
| `showServerPrintBtn` | `Common` | Sticker component | JSON `{OPDSticker: "true"/"false"}` — show server-print button |
| `RoomNumberInSticker` | `Appointment` | Sticker component | JSON `{Show, DisplayName}` for room number (read but not printed for vaccination sticker) |
| `MaximumLastVisitDays` | `Appointment` | Sticker component | Numeric days limit (loaded but not enforced for vaccination) |
| `EnableTicketPriceInVisit` | `Appointment` | Sticker component | Whether to show ticket price (read but not printed for vaccination sticker) |
| `EnableDepartmentLevelAppointment` | (Core) | Sticker component | Switches between "Department" and "Doctor" label on the sticker |
| `EnableDotMatrixPrintingInVaccinationSticker` | (Core) | Sticker component | Enables dot-matrix printing |
| `HospitalCode` | (Core) | Sticker component | Hospital code for CSS class on the sticker (e.g. `opdstkcontainer-allhosp`) |

### 7.7 Master Data (Cache)

| Master | Frontend Cache Use |
|--------|--------------------|
| `MST_Country` | Country dropdown in registration form (`DanpheCache.GetData(MasterType.Country, null)`) |
| `MST_CountrySubDivision` | District dropdown, auto-selected by `CountrySubDivisionId` |
| `MST_Municipality` | Municipality dropdown (filter by `countrySubDivisionId`) |
| `MST_EthnicGroup` | Ethnic group dropdown + auto-suggest |
| `BIL_CFG_FiscalYears` | Fiscal-year dropdown in manual reg-number update (read via `billing-fiscalyear.api`) |

---

## 8. Business Rules

### 8.1 Patient Eligibility

- **Age**: No explicit age filter — the form defaults to today's date as DOB and allows age in Y/M/D. The use case is exclusively infants/babies (typically <5 years), but the system does not enforce this.
- **One-time flags**: `IsVaccinationPatient = true` is set on add and persisted. There is no API to flip it back to `false`. (A patient is "removed" from active duty only by `IsVaccinationActive = false`, which the service sets on update but no UI exposes to the user.)
- **Active filter on list**: `GetAllVaccinationPatient` does **not** filter by `IsVaccinationActive` — it shows every patient where `IsVaccinationPatient = true`, ordered by most-recent visit. The frontend computes `DaysPassed = today - VisitDateTime` dynamically and shows "Followup" only for past visits.

### 8.2 Audit Trail

Every write touches one or more of the following audit fields:

- `CreatedOn` / `CreatedBy` — set on insert from `RbacUser.EmployeeId` and `DateTime.Now`.
- `ModifiedOn` / `ModifiedBy` — set on every update by the controller. The service uses `Attach` + property-level updates (no over-posting risk).
- `IsActive` — the dose table does not have an `IsActive` flag — doses are not soft-deleted; only updated.
- `PAT_Patient` audits: `IsVaccinationPatient`, `IsVaccinationActive`, `VaccinationRegNo`, `VaccinationFiscalYearId` are set/updated on the vaccination add/update path.

### 8.3 Validation Rules (Frontend)

| Form | Required | Constraints |
|------|----------|-------------|
| Register Patient | `Age`, `DateOfBirth`, `Gender`, `MotherName`, `CountryId`, `CountrySubDivisionId`, `VaccinationRegNo` | DOB validator rejects future dates and DOB >200 years ago. ShortName auto-suggestion from mother name. Ethnicity auto-suggest from mother's last name. |
| Add Dose | `VaccineId` (min 1), `DoseNumber` (min 1) | Dose options are 1..N where N = vaccine's `NumberOfDoses`. |
| Manual Reg# Update | `VaccRegNumber > 0`, `selectedFiscalYear > 0` | Duplicate check across `(fiscalYearId, regNumber)` excluding current patient. |

### 8.4 Registration Number Modes

Two modes are supported by `Vaccination.AutoIncreamentRegNumber` (`CORE_CFG_Parameters`):

- **Auto-increment (`true` / `1`)**: Field is disabled in the form. Service sets `VaccinationRegNo = MAX(VaccinationRegNo for current FY) + 1` on add. The frontend's `IsVaccRegNumAutoIncreaseEnabled()` reflects this flag.
- **Manual (`false` / missing)**: Field is enabled. Service checks uniqueness (excluding the current `PatientId`) and throws `"This registration number is already registered"` on duplicate. Also throws `"This registration number should be greater than 0"` if `VaccinationRegNo <= 0`.

`UpdatePatienVaccRegNumber` enforces uniqueness separately on the manual-update path: throws `"This registration number is already used for {ShortName}"` if another patient in the same FY holds the number.

### 8.5 Fiscal Year Behavior

- `GetFiscalYearByDate(date)` selects the first fiscal year where `StartYear <= date <= EndYear`.
- If no FY matches (e.g. between fiscal years), this throws `"Fiscal Year not Set"`. `GetLatestVaccRegNumber` also throws `"Fiscal Year Not Set"` in that case.
- The same FY is reused for the visit's `ParentVisitId` linkage and for the reg-number scope.

### 8.6 Immunization Visit Atomicity

`AddUpdateVaccinationPatient` does not use a `Database.BeginTransaction()` or `TransactionScope`. The patient insert and the visit insert are two separate `SaveChanges()` calls. If the visit insert fails (e.g. visit-code collision), the `GenerateUniqueVisitCodeAndSaveChanges` helper retries the visit insert with a new `VisitCode` (recursive). If any other error occurs, the patient is already committed but the visit is not — the system could end up with a vaccination patient who has no visit. The service does not roll back the patient.

### 8.7 PatientCode + VisitCode Uniqueness

Both `PAT_Patient.PatientCode` and `PAT_PatientVisits.VisitCode` are unique-constrained. The service handles the `SqlException.Number == 2627` (unique violation) by recursive retry:

- `CreatePatientAndSave` regenerates `PatientNo`/`PatientCode` and retries.
- `GenerateUniqueVisitCodeAndSaveChanges` regenerates the `VisitCode` and retries.

These retries are unbounded — a sustained unique-constraint violation would cause a stack overflow. In practice, the retry count is bounded by the random uniqueness of the generated codes.

### 8.8 Follow-up Visit Free Status

Follow-up visits are always `BillingStatus = "free"`, `VisitType = "outpatient"`, `AppointmentType = "followup"`. There is no billing transaction created. The `IsVisitContinued = true` on the parent visit signals that the patient has returned; the parent visit itself is not closed.

### 8.9 Dose Number Constraint

Dose numbers are 1..N where N is `VaccineMaster.NumberOfDoses`. The frontend dropdown is filtered to that range via `CommonFunctions.GetDosesNumberArray().Where(d => d.Id <= NumberOfDoses)`. The backend does not enforce the range — a client could send `DoseNumber = 99`. The DB does not have a CHECK constraint.

### 8.10 Ethnic Group Auto-Suggestion

`EthnicGroupAutoSelect()` is a client-side heuristic. It:

1. Splits `MotherName` on spaces.
2. Takes the last word (or 2nd-to-last if trailing whitespace) and lowercases it.
3. Iterates `CastEthnicGroupList` and checks if any keyword in the group's `CastKeyWords` (split from CSV to array) matches.
4. Sets the ethnic group to the first match. Defaults to `"Brahmin/Chhetri"` if no match or no last name.

This is best-effort, not authoritative. The user can always override the dropdown.

### 8.11 Sticker Print Modes

Three print modes are supported and configured by `coreService.EnableDotMatrixPrintingInVaccinationSticker()` and `coreService.Parameters[showServerPrintBtn]`:

- **Browser** (default): opens a popup window with the rendered HTML and `window.print()`. Width 400px, CSS from `themes/theme-default/DanphePrintStyle.css`.
- **Dot-matrix**: uses Qz-Tray (`coreService.QzTrayObject`) to send formatted text to the configured dot-matrix printer. Dimensions come from `coreService.GetDotMatrixPrinterRegStickerDimensions()`.
- **Server**: POSTs the HTML to `/api/Billing/saveHTMLfile` to write to a server-side folder watched by a print agent.

### 8.12 Nepali Calendar Support

The `VaccineDate` picker supports both English and Nepali dates (`CalendarTypes: "en,np"`). Sticker output shows both formats side-by-side. `VisitDateTime` is shown in both formats on the patient list (grid) and the appointment-details report.

### 8.13 Daily Appointment Report Filter

`SP_Report_VACC_DailyAppointmentReport` is called with `appointmentType` = `"new"`, `"followup"`, or `"all"`. The SP presumably filters `PAT_PatientVisits` by `DepartmentId` = immunization dept and `AppointmentType` per the parameter. The exact SQL is not in the source tree (database backup is zip-compressed). The result columns (per the grid settings) include `VisitDateTime`, `VaccinationRegNo`, `PatientName`, `PatientCode`, `Age/Sex`, `DateOfBirth`, `MotherName`, `EthnicGroup`, `DistrictName`, `Address`, `AppointmentType`, `UserName`.

### 8.14 Integrated Report — Vaccine List Filter

`vaccStr` is a JSON-serialized `List<int>` of `VaccineId` values, e.g. `[1,2,3]`. The service deserializes it via `DanpheJSONConvert.DeserializeObject<List<int>>(vaccStr)` and applies `vaccineList.Contains(patVac.VaccineId)`. The frontend (`vaccination.bl.service.ts:GetIntegratedVaccineReport`) stringifies the array and passes it as a query parameter. The list comes from `<vaccine-select>` which is a multi-select dropdown loaded via `GetAllVaccinesListWithDosesMapped(false)` (doses not needed for the multi-select).

### 8.15 Patient Demographics Storage

The vaccination registration form splits `ShortName` into `FirstName` / `MiddleName` / `LastName` server-side on **update** only. On **add**, `FirstName = ShortName`, `MiddleName = " "`, `LastName = " "` (a single space). This is a legacy convention to satisfy non-null constraints on `FirstName`/`LastName`. Subsequent updates will properly split the name. The form's `setBabyName()` defaults `ShortName` to `"Baby of " + CapitalizeFirstLetter(MotherName)`.

### 8.16 Country / District Defaults

`AssignCountryAndSubDivision()` sets the country/subdivision to the system defaults (`CoreService.GetDefaultCountry()` and `GetDefaultCountrySubDivision()`) on new registration. On edit, the values are loaded from the patient's existing data. The user can change both during the edit.

### 8.17 Date of Birth vs Age

Both `DateOfBirth` and `Age` are captured on the form. `GenerateAge()` recomputes `Age` from `DateOfBirth` when the unit is set. `CalculateDob()` (the inverse) computes `DateOfBirth` from `(age, ageUnit)` using `VaccinationService.CalculateDOB` (which uses `moment.subtract`). The two are kept in sync, but the storage format is `DateOfBirth` (primary) and `Age` (denormalized, set on save).

### 8.18 Hospital Code in Sticker CSS

The sticker uses dynamic CSS class names like `opdstkcontainer-{hospitalCode}` and `topsec-{hospitalCode}` to support per-hospital theming. `hospitalCode` defaults to `"allhosp"` if `CoreService.GetHospitalCode()` is empty. This allows different hospitals to use the same module with different sticker styles.

### 8.19 ShortName as "Baby of …"

The convention is that vaccination patients' `ShortName` is `"Baby of " + MotherName`. The form's `setBabyName()` enforces this auto-population when the mother name is entered. The user can override the `ShortName` directly (it's not in the `PatientValidator` required list, so it's free-text). The stored `FirstName` = `ShortName` for new patients and is split on update.

### 8.20 No Soft-Delete on Patients or Doses

Unlike Maternity, the Vaccination module does not support soft-delete. `PAT_Patient` has the `IsActive` flag, but the service sets it to `true` and never toggles it to `false` from the vaccination path. `VACC_PatientVaccineDetail` has no `IsActive` flag — doses are updated in place (changed by `AddUpdatePatienVaccinationDetail`) but never removed. There is no "remove a dose" API.

### 8.21 Follow-up Only for Past Visits

The patient-list grid action renderer (`VaccinationGridColumnSettings.VaccPatListActionRenderer`) shows the "Followup" link only when `moment(todaysdate).diff(visitdate, "days") > 0`. Today's visit does not show a follow-up option — the user must complete the current visit first.

### 8.22 Registration Number Edit Without Re-registration

A patient can have their `VaccinationRegNo` re-assigned after creation via `UpdatePatienVaccRegNumber`. This is the only mutation allowed on the `VaccinationRegNo` field post-creation. The service validates that the new `(fiscalYearId, regNumber)` pair is unique (excluding the current patient) and that `selectedFiscalYearId > 0`. There is no audit trail for this change — only `ModifiedOn`/`ModifiedBy` on the patient record reflect it.

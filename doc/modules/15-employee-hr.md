# Employee (HR) Module — DanpheEMR Reference

> **Module code path in repo:** `Code/Websites/DanpheEMR/Controllers/Employee/`, `Code/Websites/DanpheEMR/Controllers/Settings/EmployeeSettingsController.cs`, `Code/Components/DanpheEMR.ServerModel/EmployeeModels/`, `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/employee/`
> **Module role:** Master-data foundation for every internal person in the hospital — employees, employee roles, employee types, external referrers, per-employee preferences, and the authenticated user's own profile + password.

This document describes the DanpheEMR **Employee** module as it exists in the reference source. The module is split across two controllers (`EmployeeController` and `EmployeeViewController`) plus a settings controller (`EmployeeSettingsController`) that lives under `Settings/` and owns the CRUD endpoints for the master data. It also overlaps the `Account` controller for the change-password endpoint, and crosses the `Security` module because every employee may be linked to an `RbacUser` login. The module is the **identity backbone** that every other module (Doctors, Scheduling, Payroll, Incentive, Radiology, Lab, Billing, etc.) reaches back to via the `EMP_Employee` row.

---

## 1. Module Overview

The Employee module in DanpheEMR is a **master-data and self-service** module. It does **not** own payroll, attendance, leave, or scheduling (those live in `Payroll/`, `Scheduling/`, and adjacent modules). The scope is:

- **Employee master record** with rich profile fields (personal, contact, professional, certification, signature, billing-service mapping).
- **Employee roles** (Doctor, Nurse, Admin, etc.) with description and active flag.
- **Employee types** (consultant, full-time, etc.) with active flag.
- **External referrers** (external doctors who refer patients) — modeled as a special "external" employee flagged with `IsExternal = true` and a tiny `ExternalReferrerVM` projection that hides the hard-coded `FirstName = "External" / LastName = "External"` placeholder.
- **Per-employee preferences** for Lab/Imaging/Medication favorites (modeled but UI-commented-out in the active source).
- **Signatory image upload** for reports — base64 PNG stored on disk under `fileuploads/EmployeeSignatures/<FirstName>_<EmployeeId>_<datetime>.png`, with only the file name persisted on the employee row.
- **Employee self-service** via the `ProfileMain` shell:
  - View own profile
  - Change own profile picture
  - Change own password (delegated to `AccountController.ChangePassword`)
  - Set own landing page (the post-login default route stored on `RbacUser.LandingPageRouteId`).
- **Read-only "active employees" listing** used by Doctor pickers, Billing referrer pickers, OT provider pickers, etc. — filtered to `IsExternal == false && IsActive == true` with name, role, type, department, appointment-applicable flag.
- **Read-only "all referrers" listing** (`IsActive == true && (IsExternal || IsAppointmentApplicable == true)`) used by Billing to choose internal or external referral sources.

Hospital workflow served:

- Admin/HR creates employee records (reception, doctor, lab tech, pharmacist, etc.) with role, type, department, signature, certifications.
- Each doctor (employee) gets a profile with OPD/FU/Internal/Referral billing-service mapping (`OpdNewPatientServiceItemId`, `OpdOldPatientServiceItemId`, `FollowupServiceItemId`, `InternalReferralServiceItemId`) so that billing for "consult Dr X" can price correctly.
- Doctors get a signatory image so reports (Lab, Radiology) show the doctor's signature at the bottom of the printed report.
- External referrers are kept in the same `EMP_Employee` table but flagged `IsExternal` so the system can pay them incentives (`IsIncentiveApplicable`, `TDSPercent`, `PANNumber`).
- Employees log in, view their own profile, change profile picture, change password, and pick a landing page.

**Out of scope (intentional gaps to be aware of for parity work):**

- No salary structure, payslip, payroll runs.
- No biometric device integration (handled in HR Attendance — `hr_attendance_punches`).
- No shift or duty-roster (handled by Scheduling — `hr_duty_roster`).
- No leave management (handled by Payroll — `PROLL_*` tables).
- No formal "employee type" enforcement at the application layer beyond the FK link.
- The `EmployeePreferences` table exists in the model and is mapped in many DbContexts (`Lab`, `Radiology`, `Pharmacy`, `Orders`, `Admission`, `Visit`, `Vaccination`), but the `AddToPreference` and `DeleteFromPreference` endpoints are commented out in `EmployeeController.cs`. Lab/Imaging/Medication favorites are not actively wired into the UI in the current source.

### High-level route surface

```
GET  /api/Employee/Profile?empId=             -> own / other-employee profile (EmployeeProfileVM)
GET  /api/Employee/ActiveEmployees            -> lookup for Doctor/Reception pickers
POST /api/Employee/LandingPage                -> set the post-login landing route for current user

GET  /api/EmployeeSettings/Employees          -> full employee list (HR admin)
POST /api/EmployeeSettings/Employees          -> add new employee (+ optional ServiceItemsList + optional SignatoryImageBase64)
PUT  /api/EmployeeSettings/Employees          -> update employee (+ optional ServiceItemsList + optional signatory image)
GET  /api/EmployeeSettings/EmployeeRoles      -> list roles
POST /api/EmployeeSettings/EmployeeRoles      -> add role
PUT  /api/EmployeeSettings/EmployeeRoles      -> update role
GET  /api/EmployeeSettings/EmployeeTypes?ShowIsActive=
POST /api/EmployeeSettings/EmployeeTypes      -> add type
PUT  /api/EmployeeSettings/EmployeeTypes      -> update type
GET  /api/EmployeeSettings/EmployeeSignatoryImage?employeeId= -> base64 PNG
GET  /api/EmployeeSettings/ExternalReferrers  -> external referrer projection
GET  /api/EmployeeSettings/Referrers          -> combined internal+external referrer list
POST /api/EmployeeSettings/ExternalReferrer   -> add external referrer (writes to EMP_Employee)
PUT  /api/EmployeeSettings/ExternalReferrer   -> update external referrer (partial field update)

PUT  /Account/ChangePassword                  -> password change (not in this module, but invoked by ChangePasswordComponent)
PUT  /api/Employee?empId=                     -> profile-picture upload (PUT with multipart body)
```

Key file paths:

- Backend controllers: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Employee/`, `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Settings/EmployeeSettingsController.cs`, `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs` (ChangePassword only).
- Server models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/EmployeeModels/`
- ExternalReferrer VM: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/ExtReferralModels/ExtReferralVMs.cs`
- DB context registrations: 30+ DbContexts across the solution all map `EmployeeModel -> EMP_Employee`. The canonical mappings are in `Code/Components/DanpheEMR.DalLayer/MasterDbContext.cs:28-46`.
- Frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/employee/`

---

## 2. Backend Files

| File | Role | Key types / methods |
|---|---|---|
| `Controllers/Employee/EmployeeController.cs` | Self-service and lookup endpoints. 468 lines (most commented out as historical code). | `GetEmployeeProfile` (Profile), `GetActiveEmployeesInformation` (ActiveEmployees), `PostLandingPage` (LandingPage). Private helpers: `EmployeeProfile(int empId)`, `ActiveEmployeesInformation()`, `LandingPage(string ipDataStr)`. |
| `Controllers/Employee/EmployeeViewController.cs` | Legacy server-side MVC view controller. 87 lines. Serves the old `.cshtml` views (UserProfile, ChangePassword, ProfileMain, ChangeProfile). | `UserProfile`, `ChangePassword`, `ProfileMain`, `ChangeProfile`. Injects connection string via `ViewData["ConnectionString"]`. |
| `Controllers/Settings/EmployeeSettingsController.cs` | Settings CRUD for the master data. 1127 lines. | `GetEmployee`, `GetEmployeeRole`, `EmployeeType`, `EmployeeSignatoryImage`, `GetExternalReferrers`, `GetReferrers`, `PostEmployees`, `PostEmployeeRoles`, `PostEmployeeTypes`, `PostExternalReferrer`, `EditEmployees`, `EditEmployeeRoles`, `EditEmployeeTypes`, `EditExternalReferrer`. Private: `UploadEmployeeSignatoryImage`, `GetEmpModelFromExtReferrerModel`, `GetExtRefModelFromEmployeeModel`, `UpdateBillItemsOfEmployee`, `GetEmployeeType`, `GetEmployeeSignatoryImage`, `AddEmployees`, `AddEmployeeRoles`, `AddEmployeeTypes`, `AddExternalReferrer`, `UpdateEmployees`, `UpdateEmployeeRoles`, `UpdateEmployeeTypes`, `UpdateExternalReferrer`. |
| `Controllers/AccountController.cs` (excerpt) | Password change endpoint. | `ChangePassword` (HTTP PUT, accepts `ChangePasswordViewModel`, calls `RBAC.UpdateDefaultPasswordOfUser`, clears `NeedsPasswordUpdate`, updates session). |
| `Components/DanpheEMR.ServerModel/EmployeeModels/Employee.cs` | `EmployeeModel` POCO with all 30+ mapped columns, navigation properties, and `[NotMapped]` helpers. |
| `Components/DanpheEMR.ServerModel/EmployeeModels/EmployeeRole.cs` | `EmployeeRoleModel` (8 columns). |
| `Components/DanpheEMR.ServerModel/EmployeeModels/EmployeeType.cs` | `EmployeeTypeModel` (8 columns). |
| `Components/DanpheEMR.ServerModel/EmployeeModels/EmployeePreferences.cs` | `EmployeePreferences` (PreferenceId, PreferenceName, PreferenceValue XML, EmployeeId, audit). |
| `Components/DanpheEMR.ServerModel/EmployeeModels/EmployeeProfileVM.cs` | `EmployeeProfileVM` — slim projection used by the self-service profile view. |
| `Components/DanpheEMR.ServerModel/ExtReferralModels/ExtReferralVMs.cs` | `ExternalReferrerVM` — projection of `EmployeeModel` for the external-referrer UI. |
| `Components/DanpheEMR.DalLayer/MasterDbContext.cs` | Master DbContext. Lines 28, 44-46 map `EmployeeModel -> EMP_Employee`, `EmployeeRoleModel -> EMP_EmployeeRole`, `EmployeeTypeModel -> EMP_EmployeeType`, `EmployeePreferences -> EMP_EmployeePreferences`. |

### Key controller methods

**`EmployeeController.EmployeeProfile(int empId)`** — `Controllers/Employee/EmployeeController.cs:64`

Joins `MasterDbContext.Employees` (Include "Department") with `RbacDbContext.Users` on `EmployeeId`, then projects into an `EmployeeProfileVM`. Returns:

- `EmployeeId`, `FirstName`, `LastName`, `UserName` (or "Invalid User" if no RBAC user), `Department` (or "not assigned"), `DateOfBirth`, `DateOfJoining`, `ImageName`, `ImageFullPath` (built from `fileUploadLocation + "UserProfile\\" + ImageName`), `Email`, `ContactNumber`.

**`EmployeeController.ActiveEmployeesInformation()`** — `Controllers/Employee/EmployeeController.cs:91`

Returns the slim lookup projection used by every Doctor / Reception picker in the system. Filter: `IsExternal == false && IsActive == true`. Includes: `EmployeeId, Salutation, FirstName, MiddleName, LastName, FullName, ContactNumber, Gender, DepartmentId, DepartmentName, EmployeeRoleId, EmployeeRoleName, EmployeeTypeId, EmployeeTypeName, IsAppointmentApplicable, DisplaySequence`. Ordered by `EmployeeId`.

**`EmployeeController.LandingPage(string ipDataStr)`** — `Controllers/Employee/EmployeeController.cs:118`

Deserializes a `RbacUser` payload, finds the user in `RbacDbContext`, marks only `LandingPageRouteId` as modified, saves, returns the new `LandingPageRouteId`. Idempotent and minimal — does not change other RBAC fields.

**`EmployeeSettingsController.GetEmployee()`** — `Controllers/Settings/EmployeeSettingsController.cs:36`

Returns the full employee list (every column, plus joined `Department.DepartmentName`, `EmployeeRole.EmployeeRoleName`, `EmployeeType.EmployeeTypeName`) for HR admin screens. Filter: `IsExternal == false` (i.e. only internal staff — external referrers are surfaced separately via `GetExternalReferrers`). Ordered by `FirstName, LastName`. Includes: `EmployeeId, Salutation, FirstName, MiddleName, LastName, FullName, DateOfBirth, DateOfJoining, ContactNumber, ContactAddress, Email, Gender, Extension, SpeedDial, OfficeHour, RoomNo, IsActive, MedCertificationNo, Signature, LongSignature, DepartmentId, DepartmentName, EmployeeRoleId, EmployeeRoleName, EmployeeTypeId, EmployeeTypeName, IsAppointmentApplicable, LabSignature, CreatedOn, CreatedBy, SignatoryImageName, DisplaySequence, TDSPercent, PANNumber, IsIncentiveApplicable, RadiologySignature, BloodGroup, NursingCertificationNo, HealthProfessionalCertificationNo, DriverLicenseNo, OpdNewPatientServiceItemId, FollowupServiceItemId, OpdOldPatientServiceItemId, InternalReferralServiceItemId`.

**`EmployeeSettingsController.GetExternalReferrers()`** — `Controllers/Settings/EmployeeSettingsController.cs:122`

Returns an `ExternalReferrerVM` list for external referrers. Filter: `IsExternal == true`. Projected fields: `ExternalReferrerId (= EmployeeId)`, `ReferrerName (= FullName)`, `ContactAddress`, `EmailAddress (= Email)`, `ContactNumber`, `IsActive`, `TDSPercent`, `IsIncentiveApplicable`, `PANNumber`, `NMCNumber (= MedCertificationNo)`.

**`EmployeeSettingsController.GetReferrers()`** — `Controllers/Settings/EmployeeSettingsController.cs:144`

Returns the full `EmployeeModel` for all active employees that can be used as a referral source — `IsActive == true && (IsExternal || IsAppointmentApplicable == true)`. Consumed by the Billing referrer picker.

**`EmployeeSettingsController.GetEmployeeSignatoryImage(int employeeId)`** — `Controllers/Settings/EmployeeSettingsController.cs:113` / private at `:922`

Reads the signatory image file from `WebRootPath\fileuploads\EmployeeSignatures\<SignatoryImageName>`, opens it as an `Image`, re-encodes to its raw format, returns the bytes as a base64 string. Throws "error in getting employee signatory image" if the file name is null.

**`EmployeeSettingsController.AddEmployees(string ipDataStr, RbacUser currentUser)`** — `Controllers/Settings/EmployeeSettingsController.cs:952`

Transactional. Null-coalesces the four service-item FKs (`InternalReferralServiceItemId`, `FollowupServiceItemId`, `OpdNewPatientServiceItemId`, `OpdOldPatientServiceItemId`) when zero. Sets `CreatedBy`, `CreatedOn`. Inserts the employee. If `ServiceItemsList != null && Count > 0` -> calls `UpdateBillItemsOfEmployee`. If `SignatoryImageBase64 != null` -> calls `UploadEmployeeSignatoryImage`. Commits. Rolls back on any exception with a generic "failed to add employee" message.

**`EmployeeSettingsController.AddExternalReferrer(string ipDataStr, RbacUser currentUser)`** — `Controllers/Settings/EmployeeSettingsController.cs:1012`

Deserializes `ExternalReferrerVM`, calls `GetEmpModelFromExtReferrerModel` to map to a `EmployeeModel` with `IsExternal = true` and `FirstName = LastName = "External"` (placeholder because `FirstName`/`LastName` are NOT NULL in the DB), sets `CreatedBy`/`CreatedOn`, inserts, returns the `ExternalReferrerVM` projection.

**`EmployeeSettingsController.UpdateEmployees(string ipDataStr)`** — `Controllers/Settings/EmployeeSettingsController.cs:1038`

Attaches and marks entire row as Modified, then **explicitly excludes** `CreatedOn` and `CreatedBy` from modification (`Property(x => x.CreatedOn).IsModified = false`). Calls `UpdateBillItemsOfEmployee` if `ServiceItemsList` is present, and `UploadEmployeeSignatoryImage` only when `SignatoryImageBase64 != null && SignatoryImageName == null` (i.e. a *new* image is being uploaded — replaces existing).

**`EmployeeSettingsController.UpdateExternalReferrer(string ipDataStr, RbacUser currentUser)`** — `Controllers/Settings/EmployeeSettingsController.cs:1099`

Partial update — only marks the following properties as modified: `FullName, ContactAddress, ContactNumber, Email, PANNumber, MedCertificationNo, TDSPercent, IsIncentiveApplicable, IsActive, ModifiedBy, ModifiedOn`. Returns the projected `ExternalReferrerVM`.

**`EmployeeSettingsController.UploadEmployeeSignatoryImage(MasterDbContext, EmployeeModel)`** — `Controllers/Settings/EmployeeSettingsController.cs:729`

Creates `fileuploads/EmployeeSignatures/` if it doesn't exist. Builds `fileName = FirstName_EmployeeId_MMddyyyyHHmmss.png` (special chars stripped). Decodes the `SignatoryImageBase64` and writes the bytes to disk. Then sets `employee.SignatoryImageName = fileName` on the DB row.

**`EmployeeSettingsController.UpdateBillItemsOfEmployee(EmployeeModel, MasterDbContext)`** — `Controllers/Settings/EmployeeSettingsController.cs:831`

For each item in `ServiceItemsList`:

- If `IntegrationItemId == 0` (new) -> set `IntegrationItemId = EmployeeId` and `Add` to `BillingServiceItems`.
- Else -> lookup by `(ServiceDepartmentId, IntegrationItemId)`. If not found -> `Add`. If found -> update `ItemName` only (other pricing fields are explicitly commented out: price, EHS price, SAARC price, foreigner price, fraction).

**`AccountController.ChangePassword()`** — `Controllers/AccountController.cs:335`

Reads the body, deserializes `ChangePasswordViewModel { UserName, Password, ConfirmPassword }`, calls `RBAC.UpdateDefaultPasswordOfUser`. On success, sets `NeedsPasswordUpdate = false` on both the returned user and the in-session `currentuser`, then persists the session. On failure, returns "Current Password is Wrong".

---

## 3. Data Models

### 3.1 `EmployeeModel` — `Components/DanpheEMR.ServerModel/EmployeeModels/Employee.cs:11`

The single most-referenced entity in the system. Maps to `EMP_Employee`. 35+ columns plus 4 navigation properties and 3 `[NotMapped]` helpers.

| Column | C# type | Notes |
|---|---|---|
| `EmployeeId` | `int` | `[Key]`. Identity. |
| `FirstName` | `string` | NOT NULL in DB. |
| `MiddleName` | `string?` | |
| `LastName` | `string` | NOT NULL. |
| `ImageFullPath` | `string?` | Computed on server as `fileUploadLocation + "UserProfile\\" + ImageName`. |
| `ImageName` | `string?` | Stored file name for the profile picture (under `fileuploads/UserProfile/`). |
| `DateOfBirth` | `DateTime?` | |
| `DateOfJoining` | `DateTime?` | |
| `ContactNumber` | `string?` | |
| `Email` | `string?` | |
| `ContactAddress` | `string?` | |
| `IsActive` | `bool` | |
| `Salutation` | `string?` | Dr., Mr., Mrs., etc. |
| `DepartmentId` | `int?` | Nullable FK to `DepartmentModel`. |
| `EmployeeRoleId` | `int?` | Nullable FK to `EmployeeRoleModel`. |
| `EmployeeTypeId` | `int?` | Nullable FK to `EmployeeTypeModel`. |
| `CreatedBy` | `int?` | |
| `CreatedOn` | `DateTime?` | |
| `ModifiedBy` | `int?` | |
| `ModifiedOn` | `DateTime?` | |
| `Gender` | `string?` | |
| `FullName` | `string?` | Stored as a column (formerly a computed property). Format: `Salutation + ". " + FirstName + " " + MiddleName + " " + LastName`. |
| `Extension` | `Int16?` | Telephone extension. |
| `SpeedDial` | `Int16?` | Speed-dial number. |
| `OfficeHour` | `string?` | Free-text office hours. |
| `RoomNo` | `string?` | Office room number. |
| `MedCertificationNo` | `string?` | NMC (Nepal Medical Council) registration number. Reused as `NMCNumber` for external referrers. |
| `Signature` | `string?` | Short signature text (max 200 chars client-side). |
| `LongSignature` | `string?` | Long signature text (max 500 chars client-side). |
| `IsAppointmentApplicable` | `bool?` | If true, the employee can be selected as a doctor/performer for appointments. |
| `LabSignature` | `string?` | Free-text signature line printed on Lab reports (default = `Signature` if blank). |
| `RadiologySignature` | `string?` | Free-text signature line printed on Radiology reports. |
| `BloodGroup` | `string?` | |
| `DriverLicenseNo` | `string?` | |
| `NursingCertificationNo` | `string?` | |
| `HealthProfessionalCertificationNo` | `string?` | |
| `DisplaySequence` | `int?` | Sort order in pickers. |
| `SignatoryImageName` | `string?` | File name of the signatory PNG under `fileuploads/EmployeeSignatures/`. |
| `IsExternal` | `bool` | Default `false`. If `true`, the row is treated as an external referrer (most personal fields are hidden behind `ExternalReferrerVM`). |
| `TDSPercent` | `double?` | TDS (tax deducted at source) percent for incentive payments. |
| `IsIncentiveApplicable` | `bool?` | Whether this employee (or external referrer) is eligible for incentive payouts. |
| `PANNumber` | `string?` | Tax PAN number. |
| `OpdNewPatientServiceItemId` | `int?` | FK to `BillServiceItem` — service item billed for a new-patient OPD consult with this doctor. |
| `OpdOldPatientServiceItemId` | `int?` | FK to `BillServiceItem` — service item billed for an old-patient OPD consult. |
| `FollowupServiceItemId` | `int?` | FK to `BillServiceItem` — service item billed for a follow-up visit. |
| `InternalReferralServiceItemId` | `int?` | FK to `BillServiceItem` — service item billed for an internal-referral visit. |

**`[NotMapped]` helpers:**

- `SignatoryImageBase64` (`string`) — uploaded PNG as base64 in POST/PUT body; consumed by `UploadEmployeeSignatoryImage`.
- `ServiceItemsList` (`List<BillServiceItemModel>`) — billing service items to add/refresh on the same transaction. Consumed by `UpdateBillItemsOfEmployee`.
- `LedgerId` (`int`), `LedgerType` (`string`) — populated when accounting integration is enabled.

**Navigation properties (lazy):**

- `Department` -> `DepartmentModel`
- `EmployeeRole` -> `EmployeeRoleModel`
- `EmployeeType` -> `EmployeeTypeModel`

### 3.2 `EmployeeRoleModel` — `Components/DanpheEMR.ServerModel/EmployeeModels/EmployeeRole.cs:11`

| Column | C# type | Notes |
|---|---|---|
| `EmployeeRoleId` | `int` | `[Key]`. |
| `EmployeeRoleName` | `string?` | Required (validated client-side). |
| `Description` | `string?` | |
| `CreatedBy` | `int` | |
| `CreatedOn` | `DateTime` | |
| `ModifiedBy` | `int?` | |
| `ModifiedOn` | `DateTime?` | |
| `IsActive` | `bool?` | |

Maps to `EMP_EmployeeRole`. Note: this is the **HR role classification** (Doctor, Nurse, Admin, etc.) and is distinct from the **security role** in `RbacRole` (the RBAC system). The relationship is loose — an `RbacUser` carries `EmployeeId` but the mapping to `EmployeeRoleId` is read-only for classification; the authorization decisions are made on `RbacRole` lookups.

### 3.3 `EmployeeTypeModel` — `Components/DanpheEMR.ServerModel/EmployeeModels/EmployeeType.cs:11`

| Column | C# type | Notes |
|---|---|---|
| `EmployeeTypeId` | `int` | `[Key]`. |
| `EmployeeTypeName` | `string?` | Required. |
| `Description` | `string?` | |
| `CreatedBy` | `int` | |
| `CreatedOn` | `DateTime` | |
| `ModifiedBy` | `int?` | |
| `ModifiedOn` | `DateTime?` | |
| `IsActive` | `bool?` | |

Maps to `EMP_EmployeeType`. Used to bucket employees by employment class (Consultant, Full-time, Part-time, Visiting, etc.). Not enforced at the application layer.

### 3.4 `EmployeePreferences` — `Components/DanpheEMR.ServerModel/EmployeeModels/EmployeePreferences.cs:10`

| Column | C# type | Notes |
|---|---|---|
| `PreferenceId` | `int` | `[Key]`. |
| `PreferenceName` | `string?` | One of `Labtestpreferences`, `Imagingpreferences`, `Medicationpreferences`. |
| `PreferenceValue` | `string?` | XML document containing the list of preferred IDs (e.g. `<root><Row><LabTestId>12</LabTestId></Row>...</root>`). |
| `EmployeeId` | `int` | FK to `EMP_Employee`. |
| `CreatedBy` | `int` | |
| `CreatedOn` | `DateTime?` | |
| `ModifiedBy` | `int?` | |
| `ModifiedOn` | `DateTime?` | |
| `IsActive` | `bool` | |

Maps to `EMP_EmployeePreferences`. The XML storage and the add/delete endpoints are **commented out** in the current `EmployeeController.cs` source. The table is still mapped in `MasterDbContext`, `LabDbContext`, `RadiologyDbContext`, `PharmacyDbContext`, `OrdersDbContext`, `AdmissionDbContext`, `VisitDbContext`, `VaccinationDbContext`.

### 3.5 `EmployeeProfileVM` — `Components/DanpheEMR.ServerModel/EmployeeModels/EmployeeProfileVM.cs:16`

Slim projection used by the self-service profile page. Fields: `EmployeeId, Salutation, FirstName, MiddleName, LastName, DateOfBirth, DateOfJoining, Department, ImageFullPath, ImageName, ContactNumber, Email, ContactAddress, UserName` (the RBAC username, joined from `RbacUser`).

### 3.6 `ExternalReferrerVM` — `Components/DanpheEMR.ServerModel/ExtReferralModels/ExtReferralVMs.cs:9`

Projection of `EmployeeModel` for the external-referrer UI. Hides the hard-coded `FirstName = LastName = "External"` placeholder. Fields: `ExternalReferrerId (= EmployeeId), ReferrerName (= FullName), ContactAddress, EmailAddress, ContactNumber, IsActive, TDSPercent, IsIncentiveApplicable, PANNumber, NMCNumber (= MedCertificationNo)`.

### 3.7 `ChangePasswordViewModel` (used by `AccountController`)

Not in the EmployeeModels folder, but the Employee self-service uses it. Fields: `UserName, Password (current), NewPassword, ConfirmPassword`. On the Angular side, the `ChangePasswordModel` adds a reactive form with `MatchPassword` validator that enforces:

- `NewPassword == ConfirmPassword` (otherwise sets `MatchNewAndConfirmPassword` error on `ConfirmPassword`).
- `Password != NewPassword` (otherwise sets `MatchPasswordAndNewPassword` error on `NewPassword`).

---

## 4. Database Tables

The canonical SQL Server schema lives in `Database/2. EMR-Db/DanpheInternationalDB/Dev_DanpheEMR_INT1.bak` (full backup) and is not extractable as text. The table names and column lists are reconstructed from the EF `EmployeeModel` POCO, the `ToTable(...)` mappings in every DbContext, and the SQL `CleanUpScript.sql` reference. The four tables are:

### `EMP_Employee` — `MasterDbContext.cs:28`

The HR master table. ~40 columns. Backed by `EmployeeModel`. `EmployeeId` is identity. All FKs (`DepartmentId`, `EmployeeRoleId`, `EmployeeTypeId`) and audit fields (`CreatedBy/On`, `ModifiedBy/On`) are nullable to allow insert-before-FK resolution. Mapped in **30 DbContexts** across the solution:

`Account, Accounting, Admission, Appointment, Billing, Clinical, Core, Discharge, Doctors, Emergency, Fraction, Incentive, Insurance, Inventory, Lab, LIS, Maternity, MedicalRecords, Master, Ot, Patient, PatientConsumption, Payroll, Pharmacy, QueueManagement, Radiology, Scheduling, Utilities, Vaccination, Visit, WardSupply`.

The breadth of this mapping is the key fact: **every module that has a "doctor / performer / provider / technician" column is reading from the same `EMP_Employee` row.**

### `EMP_EmployeeRole` — `MasterDbContext.cs:44`

HR role classification. 8 columns. Mapped in `Master, Medicare, Insurance, Pharmacy, Scheduling, Inventory, WardSupply` (7 DbContexts).

### `EMP_EmployeeType` — `MasterDbContext.cs:45`

Employment type. 8 columns. Mapped in `Master, Insurance` (2 DbContexts — only the read-heavy ones).

### `EMP_EmployeePreferences` — `MasterDbContext.cs:46`

Per-employee favorites (Lab/Imaging/Medication). Mapped in `Master, Lab, Radiology, Pharmacy, Orders, Admission, Visit, Vaccination` (8 DbContexts). The read paths exist but the write paths are commented out.

### Cross-table relationships

```
EMP_Employee.DepartmentId   -> MST_Department.DepartmentId
EMP_Employee.EmployeeRoleId -> EMP_EmployeeRole.EmployeeRoleId
EMP_Employee.EmployeeTypeId -> EMP_EmployeeType.EmployeeTypeId
EMP_Employee.EmployeeId     -> RBAC_User.EmployeeId     (loose link via RbacUser.EmployeeId)
EMP_Employee.EmployeeId     -> BIL_MST_BillingServiceItem.IntegrationItemId
                                (only when ServiceItemsList is populated on add/update)
EMP_EmployeePreferences.EmployeeId -> EMP_Employee.EmployeeId
```

The `RbacUser` table in the Security module holds `EmployeeId` as a foreign-column link. There is no DB-level FK constraint declared in the source; the link is enforced at the application layer by `EmployeeController.EmployeeProfile` which joins on `u.EmployeeId == empId`.

---

## 5. Key Workflows

### 5.1 Employee CRUD (HR admin)

```
SettingsNewEmployeeComponent (Angular)
   -> EmployeeBLService / EmployeeDLService
        GET  /api/EmployeeSettings/Employees
        POST /api/EmployeeSettings/Employees
        PUT  /api/EmployeeSettings/Employees
   -> Server:
        GetEmployee:    return full employee list, joined to Department / Role / Type
        AddEmployees:   transaction {
                          set CreatedBy/On;
                          null-coalesce ServiceItem FKs (set null when 0);
                          Employees.Add(emp); SaveChanges();
                          if ServiceItemsList -> UpdateBillItemsOfEmployee;
                          if SignatoryImageBase64 -> UploadEmployeeSignatoryImage;
                          Commit;
                        }
        UpdateEmployees: transaction {
                          Attach + Modified, but CreatedOn/By IsModified = false;
                          if ServiceItemsList -> UpdateBillItemsOfEmployee;
                          if SignatoryImageBase64 != null && SignatoryImageName == null
                            -> UploadEmployeeSignatoryImage;
                          Commit;
                        }
```

### 5.2 Employee role management

```
GetEmployeeRole:    _masterDbContext.EmployeeRole.OrderBy(name).ToList()
AddEmployeeRoles:   EmployeeRoleModel.Deserialize + Add + SaveChanges
UpdateEmployeeRoles: Attach + Modified, but CreatedOn/By IsModified = false
```

The `IsActive` flag is part of the model but no GET endpoint filters on it (unlike EmployeeType which has `ShowIsActive`).

### 5.3 Employee type management

```
GetEmployeeType(ShowIsActive):
   if ShowIsActive == true  -> where IsActive == true
   else                      -> .ToList() (all)
AddEmployeeTypes:   Add + SaveChanges
UpdateEmployeeTypes: Attach + Modified, but CreatedOn/By IsModified = false
```

### 5.4 External referrer (separate handling)

External referrers are **not** in a separate table. They are stored in `EMP_Employee` with `IsExternal = true` and `FirstName = LastName = "External"`. The UI consumes only the `ExternalReferrerVM` projection to hide the placeholder.

```
GetExternalReferrers:    where IsExternal == true -> ExternalReferrerVM list
AddExternalReferrer:     deserialize VM -> GetEmpModelFromExtReferrerModel
                           sets IsExternal = true, FirstName = LastName = "External"
                           Employees.Add(emp); SaveChanges;
                           return projected VM
UpdateExternalReferrer:  deserialize VM -> GetEmpModelFromExtReferrerModel
                           Mark only these as Modified: FullName, ContactAddress, ContactNumber,
                             Email, PANNumber, MedCertificationNo, TDSPercent,
                             IsIncentiveApplicable, IsActive, ModifiedBy, ModifiedOn
                           return projected VM
```

### 5.5 Employee self-service (ProfileMain shell)

```
UserProfileComponent (or EmployeeProfileMainComponent)
   -> GET /api/Employee/Profile?empId=<current user empId>
        server: join Employees + RbacUser, return EmployeeProfileVM
   -> Show: image, name, DOB, DOJ, dept, email, contact
   -> Change password link -> ChangePasswordComponent
        form: Password (current), NewPassword, ConfirmPassword
        validators: NewPassword != Password, NewPassword == ConfirmPassword
        PUT /Account/ChangePassword
            server: RBAC.UpdateDefaultPasswordOfUser
                    clear NeedsPasswordUpdate on both returned user and session user
   -> Change landing page (in UserProfileComponent)
        form: pick module + child route
        POST /api/Employee/LandingPage { UserId, LandingPageRouteId }
            server: update only LandingPageRouteId on the RbacUser
   -> Change profile picture (in EmployeeProfileMainComponent)
        file input -> FormData -> PUT /api/Employee?empId=<id>  (multipart)
        server (commented in source): store file under fileuploads/UserProfile/
            update ImageFullPath and ImageName on the employee row
```

The `ChangePasswordGuard` (`shared/changepassword-guard.ts`) is a `CanDeactivate` route guard: if `currentUser.NeedsPasswordUpdate == true`, the user cannot leave the change-password route until the password is changed.

### 5.6 Signatory image upload

```
AddEmployees / UpdateEmployees (when SignatoryImageBase64 is present):
   UploadEmployeeSignatoryImage:
     1. ensure fileuploads/EmployeeSignatures/ exists
     2. build filename = FirstName + "_" + EmployeeId + "_" + MMddyyyyHHmmss + ".png"
        (special chars and spaces stripped)
     3. decode base64 to bytes
     4. write to file
     5. reload employee, set SignatoryImageName, IsModified = true, SaveChanges

GetEmployeeSignatoryImage(employeeId):
   1. lookup SignatoryImageName on employee
   2. open file as Image
   3. re-encode to raw format
   4. return base64 string
```

### 5.7 Active employees / Referrers (read-only list endpoints)

```
GetActiveEmployeesInformation:
   where IsExternal == false && IsActive == true
   return slim projection: EmployeeId, Salutation, FName, MName, LName, FullName,
                            ContactNumber, Gender, DepartmentId/Name,
                            EmployeeRoleId/Name, EmployeeTypeId/Name,
                            IsAppointmentApplicable, DisplaySequence
   Consumed by: Doctor pickers, Reception pickers, OT pickers, Billing referrer pickers.

GetReferrers:
   where IsActive == true
         && (IsExternal == true
             || (IsAppointmentApplicable.HasValue && IsAppointmentApplicable == true))
   return full EmployeeModel
   Consumed by: Billing referrer picker.
```

The OR condition in `GetReferrers` is significant: it widens beyond `GetActiveEmployeesInformation` by also pulling in **active external referrers**, so a single picker can list both internal doctors and external referrers in one drop-down.

---

## 6. API Endpoints

The DanpheEMR `EmployeeController` and `EmployeeSettingsController` are wrapped by `CommonController.InvokeHttpGetFunction`/`InvokeHttpPostFunction`/`InvokeHttpPutFunction`, which serializes the inner result into the standard `DanpheHTTPResponse<object> { Status, Results, ErrorMessage }` envelope. The endpoints below are listed in the form the client calls them.

| # | Method | Route | Handler | Purpose |
|---|---|---|---|---|
| 1 | GET | `/api/Employee/Profile?empId=` | `EmployeeController.GetEmployeeProfile` | Return an `EmployeeProfileVM` for the given employee (used by self-service). |
| 2 | GET | `/api/Employee/ActiveEmployees` | `EmployeeController.GetActiveEmployeesInformation` | Return slim active-internal employee list for pickers. |
| 3 | POST | `/api/Employee/LandingPage` | `EmployeeController.PostLandingPage` | Update the current user's `LandingPageRouteId`. |
| 4 | PUT | `/api/Employee?empId=` | `EmployeeController` (commented) | Upload profile picture (multipart). |
| 5 | GET | `/api/EmployeeSettings/Employees` | `EmployeeSettingsController.GetEmployee` | Full employee list for HR admin. |
| 6 | POST | `/api/EmployeeSettings/Employees` | `EmployeeSettingsController.PostEmployees` | Add employee (with optional `ServiceItemsList`, `SignatoryImageBase64`). |
| 7 | PUT | `/api/EmployeeSettings/Employees` | `EmployeeSettingsController.EditEmployees` | Update employee (with optional `ServiceItemsList`, signatory image replace). |
| 8 | GET | `/api/EmployeeSettings/EmployeeRoles` | `EmployeeSettingsController.GetEmployeeRole` | List all employee roles. |
| 9 | POST | `/api/EmployeeSettings/EmployeeRoles` | `EmployeeSettingsController.PostEmployeeRoles` | Add a role. |
| 10 | PUT | `/api/EmployeeSettings/EmployeeRoles` | `EmployeeSettingsController.EditEmployeeRoles` | Update a role. |
| 11 | GET | `/api/EmployeeSettings/EmployeeTypes?ShowIsActive=` | `EmployeeSettingsController.EmployeeType` | List employee types (filtered when `ShowIsActive=true`). |
| 12 | POST | `/api/EmployeeSettings/EmployeeTypes` | `EmployeeSettingsController.PostEmployeeTypes` | Add a type. |
| 13 | PUT | `/api/EmployeeSettings/EmployeeTypes` | `EmployeeSettingsController.EditEmployeeTypes` | Update a type. |
| 14 | GET | `/api/EmployeeSettings/EmployeeSignatoryImage?employeeId=` | `EmployeeSettingsController.EmployeeSignatoryImage` | Return the signatory PNG as a base64 string. |
| 15 | GET | `/api/EmployeeSettings/ExternalReferrers` | `EmployeeSettingsController.GetExternalReferrers` | List external referrers (`ExternalReferrerVM`). |
| 16 | GET | `/api/EmployeeSettings/Referrers` | `EmployeeSettingsController.GetReferrers` | List active internal + external referrers (full `EmployeeModel`). |
| 17 | POST | `/api/EmployeeSettings/ExternalReferrer` | `EmployeeSettingsController.PostExternalReferrer` | Add an external referrer (writes to `EMP_Employee` with `IsExternal=true`). |
| 18 | PUT | `/api/EmployeeSettings/ExternalReferrer` | `EmployeeSettingsController.EditExternalReferrer` | Update an external referrer (partial field update). |
| 19 | PUT | `/Account/ChangePassword` | `AccountController.ChangePassword` | Change password for current user (delegated to `RBAC.UpdateDefaultPasswordOfUser`). |
| 20 | GET | `/EmployeeView/ProfileMain` | `EmployeeViewController.ProfileMain` | Server-side MVC view for the legacy profile page. |
| 21 | GET | `/EmployeeView/UserProfile` | `EmployeeViewController.UserProfile` | Server-side MVC view for the legacy user-profile page. |
| 22 | GET | `/EmployeeView/ChangePassword` | `EmployeeViewController.ChangePassword` | Server-side MVC view for the legacy change-password page. |
| 23 | GET | `/EmployeeView/ChangeProfile` | `EmployeeViewController.ChangeProfile` | Server-side MVC view for the legacy change-profile page. |

A `DELETE` endpoint for employees is not implemented in the active source (the commented-out `Delete` method in `EmployeeController.cs` is a no-op). Soft delete is done by setting `IsActive = false` via PUT.

A `DELETE` endpoint for external referrers and roles/types is also absent. Inactivation is done via PUT (for external referrers) or is implied to be done via PUT (for roles/types — the `IsActive` field is mapped but no UI flow is exercised in the active source).

---

## 7. Cross-Module

The Employee module is the **most cross-referenced master module in the system**. The same `EMP_Employee` row is read by every other module to render a doctor name, a performer, a referrer, a technician, a sales agent, a billing referrer, etc.

### 7.1 Payroll (`Controllers/Payroll/`, `PROLL_*` tables)

`PayrollDbContext.cs:17` exposes `DbSet<EmployeeModel> Employee` mapped to `EMP_Employee`. Payroll reads the employee row to:

- Pull attendance, leave, and holiday for the employee.
- Compute salary/payroll inputs.
- Build the per-employee leave balance (referenced by `hr_employee_leave_balances` in our HMS — Danphe does not have an equivalent table; it just uses rules and requests).

The employee is the **link** between `EMP_Employee` and `PROLL_ATT_Attendance`, `PROLL_TRN_LeaveRequest`, `PROLL_MST_LeaveRule`, etc. In our HMS, this is replicated as `hr_attendance`, `hr_leave_requests`, `hr_leave_rules`, and the `staff` table is the employee master.

### 7.2 Scheduling (`Controllers/Scheduling/`, `SCH_*` tables)

`SchedulingDbContext.cs:19,29,35` maps `EmployeeModel -> EMP_Employee` and `EmployeeRoleModel -> EMP_EmployeeRole`. Scheduling reads the employee row to:

- Build the shift master and the per-employee shift assignment.
- Compute the duty roster for the period.
- Surface the "current shift" badge for the doctor dashboard.

In our HMS, this is replicated as `hr_shifts`, `hr_duty_roster`, `hr_rotation_patterns`, with `staff` as the source of truth.

### 7.3 Security / RBAC (`RbacUser`, `RbacRole`)

Every employee may be linked to an `RbacUser` (one-to-one, keyed on `RbacUser.EmployeeId`). The link is **not** a DB-level FK; the application layer is the only place that joins them.

- `EmployeeController.EmployeeProfile` joins `Employees` and `RbacDbContext.Users` on `EmployeeId`.
- `EmployeeController.LandingPage` updates `RbacUser.LandingPageRouteId` (NOT `EMP_Employee`).
- `EmployeeController` does NOT create the `RbacUser` row — that lives in the Account/Security flow.

The reverse link is: an `RbacUser` is created via the Account controller, and `EmployeeId` is set to point at an existing `EMP_Employee` row (or remains null for users that are not staff, e.g. external portal users).

### 7.4 Doctors (`Controllers/Doctors/DoctorsController.cs`)

`DoctorsController.cs:567 GetProviderName(int? providerId)` does a direct EF lookup against `MasterDbContext.Employees` on `EmployeeId` to return `Provider.FullName`. This is the doctor workspace that consumes the employee master for the visit-list rendering and the per-doctor visit grouping.

In our HMS, the `staff` table is read for the same purpose, with `staff.role` filtering the doctor subset.

### 7.5 Incentive (`Controllers/Incentive/IncentiveController.cs`)

`IncentiveController.cs:892` reads `DanpheCache.GetMasterData(MasterDataEnum.Employee)` to get the full employee list (this is a server-side cache populated on login). The incentive module uses it to:

- Map the `Profile.EmployeeId` to a doctor for the per-profile incentive computation.
- Validate that the employee is `IsIncentiveApplicable == true` before computing the payout.
- Apply the per-employee `TDSPercent` and `PANNumber` to the payout.

The `EMP_Employee.TDSPercent`, `PANNumber`, and `IsIncentiveApplicable` columns are the only fields the Incentive module reads from the Employee table.

### 7.6 Billing (`Controllers/Billing/`, `BIL_*` tables)

The Billing module reaches into `EMP_Employee` for two distinct reasons:

1. **Service item mapping** — `EmployeeSettingsController.UpdateBillItemsOfEmployee` writes to `BIL_MST_BillingServiceItem` with `IntegrationItemId = EmployeeId` and `ServiceDepartmentId` from the per-doctor pricing list. This means each doctor gets a row in `BIL_MST_BillingServiceItem` for OPD new / OPD old / Follow-up / Internal-referral consult, and the visit/billing modules bill against those service items using the `EmployeeModel.OpdNewPatientServiceItemId`, `OpdOldPatientServiceItemId`, `FollowupServiceItemId`, `InternalReferralServiceItemId` FKs.

2. **Referrer picker** — `EmployeeSettingsController.GetReferrers` is consumed by `billing.dl.service.ts:619` to populate the "referred by" drop-down on the billing screen. It returns internal doctors (`IsAppointmentApplicable == true`) plus external referrers (`IsExternal == true`).

3. **Active employees for service context** — `billing.dl.service.ts:625` calls `/api/Employee/ActiveEmployees` to get the slim picker list (used in places that only need doctor name + role).

### 7.7 Other modules that read `EMP_Employee`

`LabDbContext, RadiologyDbContext, PharmacyDbContext, ClinicalDbContext, PatientDbContext, AdmissionDbContext, VisitDbContext, DoctorsDbContext, EmergencyDbContext, OtDbContext, MaternityDbContext, MedicalRecordsDbContext, InsuranceDbContext, InventoryDbContext, WardSupplyDbContext, LISDbContext, FractionDbContext, DispensaryDbContext, VaccinationDbContext, QueueManagementDbContext, AccountingDbContext, CoreDbContext, UtilitiesDbContext, PatientConsumptionDbContext` — all 30 DbContexts map `EmployeeModel` to `EMP_Employee`. Most use it only to resolve a doctor/performer/referrer name on a record.

### 7.8 Frontend cache

`wwwroot/DanpheApp/src/app/shared/danphe-cache-service-utility/cache-services.ts:126` calls `/api/EmployeeSettings/Employees` once at login and caches the full employee list in `DanpheCache` as `MasterDataEnum.Employee`. Every Angular module reads from this cache rather than re-hitting the server, so the Employee module is on the **critical path of the login bootstrap**.

---

## 8. Business Rules

The following rules are encoded either in the model, in the controller, or in the client-side `EmployeeValidator`. They are the non-obvious behaviors to preserve when reimplementing the module in our HMS.

1. **`IsExternal` is the master flag for external referrers.** External referrers live in the same `EMP_Employee` table as internal employees. The discriminator is the boolean `IsExternal`. When `IsExternal == true`, `FirstName` and `LastName` are hard-coded to `"External"` (placeholder to satisfy the NOT NULL constraint) and the rest of the personal data is hidden behind the `ExternalReferrerVM` projection.

2. **`IsAppointmentApplicable` separates "doctors" from "non-doctors"** inside the internal employee set. The `GetReferrers` endpoint uses it to filter: `IsExternal == true || (IsAppointmentApplicable.HasValue && IsAppointmentApplicable == true)`. Without this flag, a non-doctor staff (e.g. a nurse with a role) would not appear in the Billing referrer picker.

3. **`IsActive` is a soft-delete flag.** There is no DELETE endpoint. To "remove" an employee, set `IsActive = false`. All picker lists (`GetActiveEmployees`, `GetReferrers`) filter on `IsActive = true`.

4. **`FirstName` and `LastName` are NOT NULL.** External referrers must be created with the hard-coded "External" / "External" placeholder. The server enforces this in `GetEmpModelFromExtReferrerModel`.

5. **`UpdateEmployees` excludes `CreatedOn` and `CreatedBy` from modification** via `Property(x => x.CreatedOn).IsModified = false`. This is the EF pattern for "set on insert, never overwrite on update" without needing a separate DTO.

6. **`UpdateEmployees` only re-uploads the signatory image** when `SignatoryImageBase64 != null && SignatoryImageName == null`. The logic is "image is present in the payload AND the employee has no existing image" — i.e. a *first-time* signatory image upload. To replace an existing image, the client must clear `SignatoryImageName` first (this is the client-side flow expected by the server).

7. **`UpdateExternalReferrer` is a partial field update.** Only `FullName, ContactAddress, ContactNumber, Email, PANNumber, MedCertificationNo, TDSPercent, IsIncentiveApplicable, IsActive, ModifiedBy, ModifiedOn` are marked as Modified. All other columns on `EMP_Employee` (e.g. `EmployeeRoleId`, `DepartmentId`, `EmployeeTypeId`, `DateOfBirth`, the doctor-only signature fields) are **not** updated through this endpoint, even if the client sends them.

8. **`ServiceItemsList` integration with billing is per-row create-or-update.** `UpdateBillItemsOfEmployee` matches on `(ServiceDepartmentId, IntegrationItemId)`. New items (`IntegrationItemId == 0`) are inserted. Existing items are updated for `ItemName` only — price and the multi-currency price fields (EHS, SAARC, Foreigner, InsForeigner) and the `IsFractionApplicable` flag are explicitly **commented out** and NOT updated. This is a known gap (Krishna, 13thMarch'23) that the comment notes "Need to revise this later".

9. **`GetEmployeeType(ShowIsActive)` filters on the server only when the flag is true.** When `ShowIsActive == false` (default), all types are returned including inactive. The flag is per-call and is not part of the model.

10. **`EmployeeRole` and `EmployeeType` have no `IsActive` filter on GET.** The flag is in the model but the only GET endpoint for both returns the full list. (Compare to `EmployeeType` which does honor `ShowIsActive`.) This is a minor inconsistency in the source.

11. **`SignatoryImage` storage is on disk under `fileuploads/EmployeeSignatures/`.** The DB stores only the file name. The server reads it back via `System.Drawing.Image` and re-encodes to base64 on GET. There is no direct file URL — clients always get the base64 representation. This is suitable for the legacy `.cshtml` server-rendered reports, not for the modern Angular UI.

12. **`LandingPage` is a Security/RBAC field, not an Employee field.** `LandingPageRouteId` is on `RbacUser`, not on `EMP_Employee`. The endpoint lives in `EmployeeController` because it is exposed in the "My Profile" page, but the underlying data is in the security schema.

13. **`EmployeeProfileVM` joins Employee + RbacUser.** The username (`UserName`) comes from the RBAC user, not from the employee. If the employee has no RBAC user (e.g. a staff member with no system login), the field is "Invalid User". The department name is "not assigned" when `DepartmentId` is null.

14. **`EmployeePreferences` write endpoints are commented out.** The `AddToPreference` and `DeleteFromPreference` logic exists in commented code in `EmployeeController.cs`. The XML storage and the ReactForm-validator patterns are still in the model, but no live UI flow exists in the active source. Lab/Imaging/Medication favorites are therefore not actively persisted today.

15. **`ChangePasswordGuard` blocks navigation while `NeedsPasswordUpdate == true`.** The Angular `CanDeactivate` guard prevents the user from leaving `/Employee/ProfileMain/ChangePassword` until the password is updated. This is a one-time forced flow after the admin resets a password.

16. **`Active employees` ordering is by `EmployeeId`** in `GetActiveEmployeesInformation` (i.e. insertion order), but the full employee list in `GetEmployee` is ordered by `FirstName, LastName` (alphabetical for HR admin screens).

17. **`NoImageName` is implicit on `EmployeeProfile`.** If `ImageName` is null/empty, `ImageFullPath` is returned as `""`. The client must check both fields before rendering the profile picture.

18. **`NoPayrollComputation` is implicit.** The Employee module is purely master-data; it does not store salary, working hours, leave balance, or attendance. All of those live in their own modules and link to `EmployeeId` only.

19. **`DateOfBirth` age guard is enforced client-side only.** The Angular `Employee.dateValidator` rejects any DOB more than 200 years in the past or any DOB in the future. There is no server-side check beyond what the database allows.

20. **The four service-item FKs are nullable and zero-coalesced.** On `AddEmployees`, when any of `OpdNewPatientServiceItemId`, `OpdOldPatientServiceItemId`, `FollowupServiceItemId`, `InternalReferralServiceItemId` is `0`, it is stored as `null` instead. This avoids accidentally pointing at a `BillServiceItem` with `ServiceItemId = 0` (which would not exist).

21. **`EmployeeValidator` enforces** `FirstName` (required, max 30), `LastName` (required, max 30), `DepartmentId` (required), `Gender` (required), `Email` (regex pattern), `DateOfBirth` (required, 0-200 years past), `MedCertificationNo`/`NursingCertificationNo`/`HealthProfessionalCertificationNo`/`DriverLicenseNo` (max 20), `Signature` (max 200), `LongSignature` (max 500). The server does not re-validate these.

22. **Signatory image file-name format is `<FirstName>_<EmployeeId>_<MMddyyyyHHmmss>.png`.** Special characters and spaces are stripped from the `FirstName` segment. This is the only place where `DateTime.Now` is baked into a file name — important for the audit trail and for understanding the disk layout under `fileuploads/EmployeeSignatures/`.

23. **Profile picture file-name format is `<UserId>_<UserName>_<epochMs>.<ext>`.** Different from the signatory file name. The profile picture lives under `fileuploads/UserProfile/` and the path is stored as `ImageName` + `ImageFullPath` on the employee row.

24. **External referrer fields are stored twice** (NMC number on `EMP_Employee.MedCertificationNo` and projected as `NMCNumber` in `ExternalReferrerVM`; PAN, TDS, incentive flag are direct on the employee row). When re-implementing, do not create a separate `ExternalReferrer` table — keep it on `EMP_Employee` with the `IsExternal` discriminator.

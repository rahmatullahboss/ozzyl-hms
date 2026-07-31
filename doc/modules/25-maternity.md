# Maternity Module

## 1. Module Overview

The Maternity module manages the entire obstetric and neonatal care lifecycle for female patients — from antenatal care (ANC) registration through delivery, and post-natal/newborn follow-up. The module integrates tightly with Patient Registration, Billing, Payments, and the master Employee cache. It is gender-restricted to female patients only and produces fiscal-year-stamped cash transactions for government maternity allowances.

In the .NET/SQL Server reference implementation, the module is exposed as `MaternityModule` with the Angular route prefix `Maternity`. The backend is a single `MaternityController` with 22 HTTP endpoints and a `MaternityService` that operates on a dedicated `MaternityDbContext`. Persistence is split across five `MAT_*` tables: `MAT_Patient`, `MAT_MaternityANC`, `MAT_Register`, `MAT_FileUploads`, and `MAT_TXN_PatientPayments`. Files (ultrasound images, lab reports) are stored on disk using a configurable path parameter, with the database holding only metadata and timestamps. Two stored procedures extend the module: `SP_MAT_GetPatientListForAllowance` (searchable patient list for allowance payments) and `SP_MAT_RPT_GetMaternityPaymentDetails` (allowance report dataset).

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Maternity Patient** | A female patient enrolled in the maternity program. Stored in `MAT_Patient` (1:1 to `PAT_Patient` via `PatientId`). Captures obstetric history (LMP, EDD, height, weight, husband name, OBs history). |
| **Maternity ANC** | Antenatal care visit. Stored in `MAT_MaternityANC`. Tracks pregnancy period, condition, weight, visit number, ANC place, and date/time. |
| **Maternity Register** | Per-baby delivery record. Stored in `MAT_Register`. One row per baby born (supports twins/triplets). Captures weight (in grams), gender, outcome of baby, outcome of mother. |
| **Maternity File Upload** | File metadata for uploaded reports/scans. Stored in `MAT_FileUploads`. File bytes live on the local file system at the path stored in the `Maternity.UploadFileLocationPath` admin parameter. |
| **Maternity Payment** | Cash transaction (allowance paid or returned). Stored in `MAT_TXN_PatientPayments`. Fiscal-year scoped with a sequential receipt number per fiscal year. Side-effect: an `EmpCashTransactionModel` row in `TXN_EmpCashTransaction`. |
| **Maternity Allowance** | A government/cash scheme payment made to a maternity patient. Identified by `TransactionType = "MaternityAllowance"` (paid out) or `"MaternityAllowanceReturn"` (returned). |
| **Conclude** | Soft-close of a maternity case after delivery/PNC completion. Sets `IsConcluded = true` with `ConcludedBy` and `ConcludedOn` audit fields. |
| **Visit Number** | The ordinal ANC visit (1, 2, 3, …). Configurable max via `Maternity.NumberOfAllowedVisits` parameter. The available list comes from `CommonFunctions.GetDosesNumberArray()`. |

### Maternity Patient Lifecycle

```
[Register Female Patient in PAT_Patient]
            |
            v
[AddMaternityPatient -> MAT_Patient row, IsActive=true, IsConcluded=false]
            |
            v
[ANC Visits -> one or more MAT_MaternityANC rows (add/edit/delete)]
            |
            v
[Upload Files (ultrasound/reports) -> MAT_FileUploads + bytes to disk]
            |
            v
[RegisterMaternity -> updates MAT_Patient.DeliveryDate/PlaceOfDelivery/TypeOfDelivery/Presentation/Complications
                     + inserts one MAT_Register row per baby]
            |
            v
[Conclude -> MAT_Patient.IsConcluded = true, ConcludedBy/ConcludedOn set]
            |
            v
[Maternity Allowance -> MAT_TXN_PatientPayments + TXN_EmpCashTransaction side-effect]
```

### ANC Visit Lifecycle

```
[Open ANC popup from patient-list grid]
            |
            v
[AddUpdateANC -> if MaternityANCId == 0: INSERT, else: UPDATE]
            |
            v
[EditANC -> loads row into form for update]
            |
            v
[RemoveANC -> soft-delete: IsActive = false, modified audit]
```

### Delivery Registration Lifecycle

```
[Select mother from active patient list]
            |
            v
[RegisterMaternity (single API call -> TransactionScope):
   - UPDATE MAT_Patient with DeliveryDate/PlaceOfDelivery/TypeOfDelivery/Presentation/Complications
   - INSERT one MAT_Register row per baby (NumberOfBaby times)]
            |
            v
[Edit/Remove individual child rows: EditChildDetail, RemoveChildDetail]
            |
            v
[Edit mother row: EditMotherDetail (separate from register)]
```

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose |
|------|------|---------|
| `MaternityController.cs` | `Websites/DanpheEMR/Controllers/Maternity/MaternityController.cs` | Single controller with 22 HTTP endpoints (CRUD on maternity patients, ANC, register, file upload, payments, reports). 597 lines. |

The controller is decorated with `[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]` and the `[Route("api/[controller]")]` convention yields `api/Maternity`. It depends on `IMaternityService` (injected) and reads the `RbacUser` from session to populate audit fields (`CreatedBy`, `ModifiedBy`, `ConcludedBy`).

### 2.2 Services

| File | Path | Purpose |
|------|------|---------|
| `IMaternityService.cs` | `Websites/DanpheEMR/Services/Maternity/IMaternityService.cs` | Service contract — 25 methods. |
| `MaternityService.cs` | `Websites/DanpheEMR/Services/Maternity/MaternityService.cs` | Concrete implementation. Owns one `MaternityDbContext` per instance. 573 lines. |

`MaternityService` is the sole service used by `MaternityController` (plus one inline `DALFunctions.GetDataTableFromStoredProc("SP_MAT_GetPatientListForAllowance", ...)` call in the controller itself for the patient-allowance search). The service uses two stored procedures: `SP_MAT_GetPatientListForAllowance` (called from controller) and `SP_MAT_RPT_GetMaternityPaymentDetails` (called from service for the allowance report).

### 2.3 Data Access

| File | Path | Purpose |
|------|------|---------|
| `MaternityDbContext.cs` | `Components/DanpheEMR.DalLayer/MaternityDbContext.cs` | EF DbContext with 9 DbSets: `Patients`, `AdminParameters`, `Employee`, `CountrySubdivisions`, `MaternityPatients`, `MaternityRegister`, `MaternityANC`, `MaternityFiles`, `MaternityPatientPayments`, `BillingFiscalYears`, `EmpCashTransactions`. 52 lines. Table mappings declared in `OnModelCreating`. |

---

## 3. Data Models

All models live in `Components/DanpheEMR.ServerModel/MaternityModels/`. The frontend mirrors them in `wwwroot/DanpheApp/src/app/maternity/shared/`.

### 3.1 MaternityPatient.cs

Master record for a female patient in the maternity program. **1:1 to `PAT_Patient` via `PatientId`.**

| Property | C# Type | Required | Description |
|----------|---------|----------|-------------|
| `MaternityPatientId` | `int` (PK) | auto | Identity PK |
| `PatientId` | `int` | yes | FK to `PAT_Patient.PatientId` (logical FK, not enforced) |
| `HusbandName` | `string` | yes | Spouse name (UI-validated, max 30 chars) |
| `Height` | `double` | yes | Height in cm |
| `Weight` | `double` | optional | Weight in kg (latest ANC weight may differ) |
| `LastMenstrualPeriod` | `DateTime?` | optional | LMP — basis for EDD calculation (Naegele's rule not auto-applied) |
| `ExpectedDeliveryDate` | `DateTime?` | optional | EDD (entered manually by user) |
| `PlaceOfDelivery` | `string` | optional | Place (filled at delivery) |
| `Presentation` | `string` | optional | Cephalic / Shoulder / Breech (filled at delivery) |
| `Complications` | `string` | optional | Free-text or one of 15 complication types (see `MaternityService.Complication` lookup) |
| `DeliveryDate` | `DateTime?` | optional | Actual delivery date/time |
| `TypeOfDelivery` | `int` | optional | 1=Normal/Spontaneous, 2=Vacuum, 3=Forceps, 4=C-Section (see `MaternityService.TypeOfDelivery`) |
| `OBSHistory` | `string` | optional | Past obstetric history (gravida, para, abortions, etc.) |
| `CreatedOn` | `DateTime` | auto | Audit |
| `CreatedBy` | `int` | auto | Audit (EmployeeId) |
| `ModifiedOn` | `DateTime?` | auto | Audit |
| `ModifiedBy` | `int?` | auto | Audit |
| `ConcludedOn` | `DateTime?` | auto | Set on `Conclude` |
| `ConcludedBy` | `int?` | auto | EmployeeId that concluded |
| `IsActive` | `bool` | yes | Soft-delete flag |
| `IsConcluded` | `bool` | yes | True once maternity case is closed |

### 3.2 MaternityANC.cs

Antenatal care visit. **N:1 to `MaternityPatient` via `MaternityPatientId`; N:1 to `Patient` via `PatientId`.**

| Property | C# Type | Required | Description |
|----------|---------|----------|-------------|
| `MaternityANCId` | `int` (PK) | auto | Identity PK |
| `MaternityPatientId` | `int` | yes | FK to `MAT_Patient.MaternityPatientId` |
| `PatientId` | `int` | yes | FK to `PAT_Patient.PatientId` (denormalized for queries) |
| `ANCDateTime` | `DateTime` | yes | Date and time of ANC visit |
| `VisitNumber` | `string` | yes | Visit ordinal ("1st ANC", "2nd ANC", …) — comes from `CommonFunctions.GetDosesNumberArray()` truncated by `Maternity.NumberOfAllowedVisits` |
| `ANCPlace` | `string` | yes | Where ANC was performed (free text) |
| `PregnancyPeriodInWeeks` | `int` | yes | Gestational age at visit |
| `ConditionOfANC` | `string` | yes | Clinical condition of mother during ANC |
| `Weight` | `double` | yes | Weight in kg (UI-validated with pattern `^[1-9][0-9]{1,2}\d*(\.[0-9]+)?$`) |
| `CreatedOn` | `DateTime` | auto | Audit |
| `CreatedBy` | `int` | auto | Audit |
| `ModifiedBy` | `int?` | auto | Audit |
| `ModifiedOn` | `DateTime?` | auto | Audit |
| `IsActive` | `bool` | yes | Soft-delete flag |

### 3.3 MaternityRegister.cs

Per-baby delivery record. **N:1 to `MaternityPatient` via `MaternityPatientId`.** Multiple rows allowed per mother (twins, triplets, etc.).

| Property | C# Type | Required | Description |
|----------|---------|----------|-------------|
| `MaternityRegisterId` | `int` (PK) | auto | Identity PK |
| `MaternityPatientId` | `int` | yes | FK to `MAT_Patient.MaternityPatientId` |
| `PatientId` | `int` | yes | FK to `PAT_Patient.PatientId` (mother) |
| `Gender` | `string` | yes | Male / Female / Others |
| `OutcomeOfBaby` | `string` | yes | Live birth / Stillbirth / etc. (free text) |
| `OutcomeOfMother` | `string` | yes | Alive / Dead (free text) |
| `WeightInGram` | `int` | yes | Birth weight in grams |
| `CreatedOn` | `DateTime` | auto | Audit |
| `CreatedBy` | `int` | auto | Audit |
| `ModifiedBy` | `int?` | auto | Audit |
| `ModifiedOn` | `DateTime?` | auto | Audit |
| `IsActive` | `bool` | yes | Soft-delete flag |

### 3.4 MaternityFileUploads.cs

File metadata. **N:1 to `MaternityPatient` via `MaternityPatientId`.** File bytes live on disk.

| Property | C# Type | Required | Description |
|----------|---------|----------|-------------|
| `FileId` | `int` (PK) | auto | Identity PK |
| `MaternityPatientId` | `int` | yes | FK to `MAT_Patient.MaternityPatientId` |
| `PatientId` | `int` | yes | FK to `PAT_Patient.PatientId` |
| `FileName` | `string` | yes | Server-side file name (appends `_` + `DateTime.Ticks` + extension to prevent collisions) |
| `FileType` | `string` | yes | File extension (e.g. `.jpg`, `.pdf`) |
| `DisplayName` | `string` | yes | Human-readable name shown in the UI |
| `CreatedOn` | `DateTime` | auto | Audit |
| `CreatedBy` | `int` | auto | Audit |
| `ModifiedBy` | `int?` | auto | Audit |
| `ModifiedOn` | `DateTime?` | auto | Audit |
| `IsActive` | `bool` | yes | Soft-delete flag |

### 3.5 MaternityPayment.cs

Cash transaction (allowance paid or returned). **N:1 to `Patient` via `PatientId`.**

| Property | C# Type | Required | Description |
|----------|---------|----------|-------------|
| `PatientPaymentId` | `int` (PK) | auto | Identity PK |
| `FiscalYearId` | `int` | yes | FK to `BIL_CFG_FiscalYears.FiscalYearId` (auto-resolved to current FY) |
| `ReceiptNo` | `int` | yes | Sequential per FiscalYearId (max + 1 within FY) |
| `TransactionType` | `string` | yes | `"MaternityAllowance"` (paid out) or `"MaternityAllowanceReturn"` (returned) |
| `PatientId` | `int` | yes | FK to `PAT_Patient.PatientId` |
| `InAmount` | `double` | yes | Amount received back (used for returns) |
| `OutAmount` | `double` | yes | Amount paid out (used for allowances) |
| `Remarks` | `string` | optional | Notes (mandatory for returns per UI) |
| `CreatedBy` | `int` | auto | Audit (EmployeeId) |
| `CreatedOn` | `DateTime?` | auto | Audit |
| `IsActive` | `bool` | yes | Soft-delete flag |
| `EmployeeName` *(NotMapped)* | `string` | — | Computed on read for receipt (joins `EMP_Employee`) |
| `CounterId` *(NotMapped)* | `int` | — | Frontend-only: `CounterId` of the MATERNITY billing counter |
| `PaymentMode` | `string` | yes | Sub-category name (e.g. "cash") — resolved to `PaymentSubCategoryId` for the `EmpCashTransaction` |

### 3.6 MaternityPaymentReceipt.cs

View model for the printed receipt — not a database table. Built by joining `MAT_TXN_PatientPayments`, `PAT_Patient`, `BIL_CFG_FiscalYears`, and `EMP_Employee`.

| Property | Type | Description |
|----------|------|-------------|
| `TransactionType` | `string` | Allowance or return |
| `InAmount` | `double` | Amount received back |
| `OutAmount` | `double` | Amount paid out |
| `EmployeeName` | `string` | Cashier |
| `ReceiptNo` | `string` | Composite `"FY-Name" + "-" + ReceiptNo` |
| `HospitalNo` | `string` | `PAT_Patient.PatientCode` |
| `Age` | `string` | Free-form age (matches `PAT_Patient.Age` string type) |
| `Gender` | `string` | Gender |
| `PatientName` | `string` | `ShortName` |
| `DateOfBirth` | `DateTime` | DOB |
| `CreatedOn` | `DateTime` | Payment timestamp |

### 3.7 MaternityRegisterVM.cs

Composite VM used by `RegisterMaternity` API to register a delivery in one transactional call.

| Property | Type | Description |
|----------|------|-------------|
| `MaternityPatient` | `MaternityPatient` | Mother record update payload (DeliveryDate, PlaceOfDelivery, TypeOfDelivery, Presentation, Complications) |
| `MaternityDetails` | `List<MaternityRegister>` | One row per baby (NumberOfBaby) |

### 3.8 Frontend Models (Angular)

| File | Class | Description |
|------|-------|-------------|
| `shared/maternity.model.ts` | `MaternityPatientListModel`, `MaternityPatient`, `MaternityPatientVM` | List row, edit form, add form. Includes `MaternityPatientValidator` (ReactiveForm with `HusbandName` required, `Height` required, `Weight` optional, `OBSHistory` optional). |
| `shared/maternity-anc.model.ts` | `MaternityANCModel` | ANC form with `ANCValidator` (`PregnancyPeriodInWeeks`, `VisitNumber`, `ANCPlace`, `ConditionOfANC`, `Weight` all required; weight pattern `^[1-9][0-9]{1,2}\d*(\.[0-9]+)?$`). |
| `shared/maternity-register.model.ts` | `RegistrationDetails`, `ChildDetailsVM`, `MatPatientRegisterVm`, `MatPatDetailsForRegister`, `MaternityRegister` | Delivery form with `MaternityRegisterDetailsValidator` (PlaceOfDelivery, TypeOfDelivery, Presentation required) and `ChildDetailsValidator` (Gender, WeightInGram, OutcomeOfBaby, OutcomeOfMother required). |
| `shared/maternity-file-upload.model.ts` | `MaternityPatientFilesModel` | File metadata (FileId, MaternityPatientId, PatientId, FileName, DisplayName, FileType, IsActive, audit fields). |
| `shared/maternity-patient-payment.model.ts` | `MaternityANCModel` *(misnamed)* | Payment form with `MaternityPaymentDetailsValidator` (Remarks, Amount required). |
| `shared/maternity.service.ts` | `MaternityService` (singleton) | Provides `TypeOfDelivery` and `Complication` lookup arrays, age-DOB calculator, and the cross-component `patientData` for the payment flow. |

### 3.9 Lookup Values (Hard-coded in `MaternityService` Angular service)

**TypeOfDelivery** (Id → Type):
1. Normal/Spontaneous
2. Vacuum
3. Forceps
4. C-Section

**Complication** (Id → ComplicationType):
1. Ectopic Pregnancy
2. Abortion Complications
3. Pregnancy induced hypertension
4. Severe/Pre-eclampsia
5. Eclampsia
6. Hyperemesis
7. Grivadarum
8. Antepartum haemorrhage
9. Prolonged Labour
10. Obstructed Labor
11. Ruptured uterus
12. Postpartum Haemorrhage
13. Retained placenta
14. Pueperal sepsis
15. Others

---

## 4. Database Tables

Schema lives in the SQL Server backup `Database/2. EMR-Db/DanpheInternationalDB/Dev_DanpheEMR_INT1.zip` (cannot be read as raw SQL). Table names are confirmed via `MaternityDbContext.cs` (lines 40-44) and `CleanUpScript.sql` (lines 432-445). The naming convention is `MAT_*` for the module's own tables, plus references into PAT/EMP/BIL/TXN for cross-module joins.

### 4.1 MAT_Patient (1:1 to PAT_Patient)

Primary table. One row per female patient enrolled in maternity.

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `MaternityPatientId` | INT IDENTITY | NO | PK |
| `PatientId` | INT | NO | Logical FK → `PAT_Patient.PatientId` |
| `HusbandName` | NVARCHAR(60) | YES | Max length 30 (UI enforces) |
| `Height` | FLOAT | YES | cm |
| `Weight` | FLOAT | YES | kg |
| `LastMenstrualPeriod` | DATETIME | YES | LMP |
| `ExpectedDeliveryDate` | DATETIME | YES | EDD |
| `PlaceOfDelivery` | NVARCHAR(60) | YES | |
| `Presentation` | NVARCHAR(30) | YES | Cephalic / Shoulder / Breech |
| `Complications` | NVARCHAR(MAX) | YES | Free text or one of 15 lookup values |
| `DeliveryDate` | DATETIME | YES | Set on `RegisterMaternity` |
| `TypeOfDelivery` | INT | YES | 1=Normal, 2=Vacuum, 3=Forceps, 4=C-Section |
| `OBSHistory` | NVARCHAR(MAX) | YES | Past obstetric history |
| `CreatedOn` | DATETIME | NO | |
| `CreatedBy` | INT | NO | FK → `EMP_Employee.EmployeeId` |
| `ModifiedOn` | DATETIME | YES | |
| `ModifiedBy` | INT | YES | FK → `EMP_Employee.EmployeeId` |
| `ConcludedOn` | DATETIME | YES | Set on `Conclude` |
| `ConcludedBy` | INT | YES | FK → `EMP_Employee.EmployeeId` |
| `IsActive` | BIT | NO | Soft-delete |
| `IsConcluded` | BIT | NO | Lifecycle flag |

Indexes: PK on `MaternityPatientId`. Lookups are on `PatientId` (read paths), `IsActive` (filtered on active list), `CreatedOn` (date-range filter for `GetAllActiveMaternityPatientList`).

### 4.2 MAT_MaternityANC (N:1 to MAT_Patient)

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `MaternityANCId` | INT IDENTITY | NO | PK |
| `MaternityPatientId` | INT | NO | Logical FK → `MAT_Patient.MaternityPatientId` |
| `PatientId` | INT | NO | Logical FK → `PAT_Patient.PatientId` (denormalized) |
| `ANCDateTime` | DATETIME | NO | |
| `VisitNumber` | NVARCHAR(20) | NO | "1st ANC", "2nd ANC", … |
| `ANCPlace` | NVARCHAR(100) | NO | |
| `PregnancyPeriodInWeeks` | INT | NO | |
| `ConditionOfANC` | NVARCHAR(500) | NO | |
| `Weight` | FLOAT | NO | kg |
| `CreatedOn` | DATETIME | NO | |
| `CreatedBy` | INT | NO | FK → `EMP_Employee.EmployeeId` |
| `ModifiedBy` | INT | YES | |
| `ModifiedOn` | DATETIME | YES | |
| `IsActive` | BIT | NO | Soft-delete |

Indexes: PK on `MaternityANCId`. Filter on `(MaternityPatientId, IsActive)` for `GetAllANCByMaternityPatId`.

### 4.3 MAT_Register (N:1 to MAT_Patient)

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `MaternityRegisterId` | INT IDENTITY | NO | PK |
| `MaternityPatientId` | INT | NO | Logical FK |
| `PatientId` | INT | NO | Logical FK → mother |
| `Gender` | NVARCHAR(10) | NO | Male / Female / Others |
| `OutcomeOfBaby` | NVARCHAR(100) | NO | |
| `OutcomeOfMother` | NVARCHAR(100) | NO | |
| `WeightInGram` | INT | NO | Birth weight in grams |
| `CreatedOn` | DATETIME | NO | |
| `CreatedBy` | INT | NO | |
| `ModifiedBy` | INT | YES | |
| `ModifiedOn` | DATETIME | YES | |
| `IsActive` | BIT | NO | Soft-delete |

Indexes: PK on `MaternityRegisterId`. Composite read on `(MaternityPatientId, PatientId, IsActive)`.

### 4.4 MAT_FileUploads (N:1 to MAT_Patient)

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `FileId` | INT IDENTITY | NO | PK |
| `MaternityPatientId` | INT | NO | |
| `PatientId` | INT | NO | |
| `FileName` | NVARCHAR(500) | NO | `DisplayName` + `_` + `Ticks` + extension |
| `FileType` | NVARCHAR(20) | NO | Extension including dot |
| `DisplayName` | NVARCHAR(200) | NO | |
| `CreatedOn` | DATETIME | NO | |
| `CreatedBy` | INT | NO | |
| `ModifiedBy` | INT | YES | |
| `ModifiedOn` | DATETIME | YES | |
| `IsActive` | BIT | NO | Soft-delete |

### 4.5 MAT_TXN_PatientPayments (N:1 to PAT_Patient)

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `PatientPaymentId` | INT IDENTITY | NO | PK |
| `FiscalYearId` | INT | NO | FK → `BIL_CFG_FiscalYears.FiscalYearId` |
| `ReceiptNo` | INT | NO | Sequential per FiscalYearId |
| `TransactionType` | NVARCHAR(50) | NO | `MaternityAllowance` / `MaternityAllowanceReturn` |
| `PatientId` | INT | NO | FK → `PAT_Patient.PatientId` |
| `InAmount` | FLOAT | NO | For returns |
| `OutAmount` | FLOAT | NO | For allowances |
| `Remarks` | NVARCHAR(500) | YES | |
| `CreatedBy` | INT | NO | |
| `CreatedOn` | DATETIME | YES | |
| `IsActive` | BIT | NO | |

### 4.6 Cross-Module Tables Touched

| Table | Operation | Source Code |
|-------|-----------|-------------|
| `PAT_Patient` | Read (filter `IsActive=1, Gender='female'`); update not done here | `MaternityService.GetPatientDetails` |
| `EMP_Employee` | Read for receipt (`EmployeeName`) and for `MaternityDbContext.Employee` | `MaternityService.GetPatientPaymentDetailById` |
| `BIL_CFG_FiscalYears` | Read to resolve current FY | `MaternityService.GetFiscalYear` |
| `TXN_EmpCashTransaction` | **Inserted** as side-effect of `AddMaternityPatientPayment` | `MaternityService.AddMaternityPatientPayment` |
| `MST_CountrySubDivision` | Read (cache) | `MaternityDbContext.CountrySubdivisions` |
| `CORE_CFG_Parameters` | Read for `Maternity.UploadFileLocationPath` and `Maternity.PaymentAmountsAvailable` | `MaternityService.UploadMaternityPatientFiles`, `maternity-patient-payment.component.ts:GetPaymentAmountFromCoreParameter` |
| `MST_PaymentMode` (or sub-category) | Read to resolve `PaymentMode` string → `PaymentSubCategoryId` | `MaternityService.AddMaternityPatientPayment` |
| `BIL_CFG_BillingCounter` | Read (cache) for `CounterType = "MATERNITY"` | `maternity-patient-payment.component.ts:GetBillingCounterForMaternity` |

### 4.7 Admin Parameters

The module reads two `CORE_CFG_Parameters` rows under `ParameterGroupName = "Maternity"`:

| ParameterName | Purpose | Default |
|---------------|---------|---------|
| `Maternity.UploadFileLocationPath` | Filesystem path where uploaded files are stored | Required — `MaternityService.UploadMaternityPatientFiles` throws `"Please set parameter"` if missing |
| `Maternity.PaymentAmountsAvailable` | CSV of predefined payment amounts (e.g. `"1000,2000,3000,5000"`) | Optional — drives the payment-amount dropdown |
| `Maternity.NumberOfAllowedVisits` | Read on the frontend (not used by backend) | Optional — limits the ANC visit dropdown list |

### 4.8 Stored Procedures

| SP | Caller | Parameters | Returns |
|----|--------|------------|---------|
| `SP_MAT_GetPatientListForAllowance` | `MaternityController.SearchPatListForAllowance` | `@SearchTxt NVARCHAR`, `@IsSearchAll BIT`, `@RowCounts INT` (default 200) | DataTable — patient list eligible for allowance payment (admitted/discharged female patients) |
| `SP_MAT_RPT_GetMaternityPaymentDetails` | `MaternityService.GetMaternityAllowanceReportList` | `@FromDate DATETIME`, `@ToDate DATETIME`, `@UserId INT` (0 = all) | DataSet with two tables: `Table1` (summary by user: PaidToPatient, ReturnedFromPatient, NetPaidAmount, PaidCount, ReturnCount) and `Table2` (line items: CreatedOn, ReceiptNo, ShortName, HospitalNo, Age, TransactionType, Amount, ReturnAmount, FullName, PatientPaymentId) |

---

## 5. Key Workflows

### 5.1 Antenatal Care (ANC)

The ANC workflow lets a clinician record periodic visits during pregnancy.

1. **Open patient list** — User navigates to `Maternity/PatientList`. The grid loads via `GetAllActiveMaternityPatientList(showAll, fromDate, toDate)`.
2. **Add new maternity patient** — User clicks "Add Patient" → search/list popup → `AddMaternityPatient` API creates a `MAT_Patient` row. `CreatedOn`, `CreatedBy` are set server-side from the session.
3. **Add patient files** — User clicks "Upload" action → `UploadMaternityPatientFiles` accepts multipart form with `reportDetails` (JSON of `MaternityFileUploads`) and `files` (binary). The service writes the file to disk at `ParameterValue + "/" + DisplayName + "_" + Ticks + extension`, then inserts a metadata row in `MAT_FileUploads`. Validation: each file must be ≤ 10 MB (`10485000` bytes). `IsActive = true` on insert.
4. **Add ANC visit** — User clicks "ANC" action → `MaternityANCComponent` opens. `GetAllDosesNumber(true)` returns the `VisitNumber` list, truncated by `Maternity.NumberOfAllowedVisits`. `GetAllANCByMaternityPatId` loads existing visits. User fills the form (`PregnancyPeriodInWeeks`, `VisitNumber`, `ANCPlace`, `ConditionOfANC`, `Weight`) and submits. `AddUpdateMaternityANC` either inserts (`MaternityANCId == 0`) or updates (sets `ModifiedBy`/`ModifiedOn`). `PatientId` is auto-resolved server-side by joining `MAT_Patient.PatientId`.
5. **Edit ANC visit** — User clicks "Edit" in the ANC list → `EditANC(selectedData)` populates the form. `VisitNumber` is mapped from `NumberInfo` ↔ `Id`. Submit re-uses `AddUpdateMaternityANC`.
6. **Remove ANC visit** — `RemoveANC(maternityANCId)` calls `DeleteMaternityPatientANC` which soft-deletes (`IsActive = false`, audit).
7. **Print ANC list** — `PrintANC()` opens a popup window with the formatted ANC grid (printable via the browser's print dialog).

### 5.2 Delivery Registration

The delivery workflow captures the actual birth event — mother's delivery parameters and per-baby outcomes.

1. **Open register** — User clicks "Mat-Register" action on a maternity patient row. `MaternityRegisterComponent` opens with `MaternityRegisterId = 0` (new entry) and `NumberOfBaby = 1` by default.
2. **Build child list** — `changeNumOfBaby($event)` rebuilds `multipleChild[]` with N empty `ChildDetailsVM` instances. N can be 1-6.
3. **Fill mother details** — `PlaceOfDelivery` (text, required), `DeliveryDate` (date-time, Nepali/English), `TypeOfDelivery` (dropdown: Normal/Vacuum/Forceps/C-Section), `Presentation` (dropdown: Cephalic/Shoulder/Breech), `Complications` (dropdown from 15 types).
4. **Fill child details** — For each of N babies: `Gender` (Male/Female/Other), `WeightInGram` (number, required), `OutcomeOfBaby`, `OutcomeOfMother`.
5. **Submit** — `AddNewMatDetails` builds a `MaternityRegisterVM` with one `MaternityDetails` entry per baby. The single `RegisterMaternity` API call wraps everything in a `TransactionScope`:
   - Updates `MAT_Patient`: `DeliveryDate`, `TypeOfDelivery`, `Presentation`, `Complications`, `PlaceOfDelivery`, `ModifiedOn`, `ModifiedBy`.
   - Inserts N rows in `MAT_Register`, each with `MaternityPatientId`, `PatientId`, and the corresponding child's `Gender`/`WeightInGram`/`OutcomeOfBaby`/`OutcomeOfMother`. `IsActive = true` on each.
6. **List existing deliveries** — `GetAllBabyDetailsByMaternityPatId(matId, patId)` returns the join of `MAT_Patient` (delivery columns) and `MAT_Register` (per-baby columns) for active rows.
7. **Edit a child** — `EditDeliveryDetails(selectedData)` populates the form. `UpdateChildDetails` calls `EditChildDetail` (updates `OutcomeOfBaby`, `OutcomeOfMother`, `WeightInGram`, `Gender`).
8. **Edit mother** — Separate button calls `UpdateMotherDetails` → `EditMotherDetail` API. Updates `PlaceOfDelivery`, `Presentation`, `Complications`, `DeliveryDate`, `TypeOfDelivery`.
9. **Remove a child** — `RemoveChildDetails(id)` calls `RemoveChild` API which soft-deletes a `MAT_Register` row.
10. **Print delivery list** — `Print()` opens a popup window with the formatted child-list table.

### 5.3 Postnatal Care (PNC) / Conclude

There is no dedicated PNC table — postnatal care is implied by the `IsConcluded` flag on `MAT_Patient`.

1. **Conclude** — User clicks "Conclude" action on an active patient. `ConcludePatient()` calls `Conclude` API which sets `IsConcluded = true`, `ConcludedBy = currentUser.EmployeeId`, `ConcludedOn = now()`, plus `ModifiedBy`/`ModifiedOn` (separate `IsModified` flags in EF to track the 5 properties).
2. The patient no longer appears in the default active-patient list (when `showAll = false`).
3. **View concluded** — `GetAllActiveMaternityPatientList(showAll=true, ...)` includes concluded patients. The grid's action renderer shows "View" only (no ANC/Register/Upload/Conclude/Remove actions).
4. **Concluded view** — `MaternityPatientGridActions` switches on `view-concluded-patient` and shows the read-only patient form.

### 5.4 Maternity Allowance (Payment)

A separate cash-allowance flow managed under `Maternity/Payments`.

1. **Open payment patient list** — `Maternity/Payments/PaymentPatientList` loads via `SearchPatListForAllowance` (stored proc). Shows discharged female patients with `IP Number` and `Discharge Date`.
2. **Select patient** — Click "Payment" on a row → `MaternityService.SetPatientForPayment(data)` stores the patient in the singleton. Router navigates to `Maternity/Payments/PaymentDetails`.
3. **View payment history** — `GetPatientPaymentDetails(patientId)` lists all `MAT_TXN_PatientPayments` for the patient. `totalPaid` and `totalReturn` are calculated client-side.
4. **Pick a counter** — `GetBillingCounterForMaternity` reads cached `BillingCounter` rows and selects the one with `CounterType = "MATERNITY"`. `CounterId` is stored on the payment.
5. **Enter amount** — User picks an amount from the `PaymentAmountsAvailable` CSV (split by `,`, parsed to numbers) or types a custom one. The form has two modes:
   - **Pay** (default): `OutAmount = InOrOutAmount`, `InAmount = 0`, `TransactionType = "MaternityAllowance"`.
   - **Return**: `InAmount = InOrOutAmount`, `OutAmount = 0`, `TransactionType = "MaternityAllowanceReturn"`. Remarks are mandatory, and the return amount must not exceed the net paid (`totalPaid - totalReturn`).
6. **Save** — `AddMaternityPatientPayment` runs in a `Database.BeginTransaction`:
   - Sets `CreatedOn`, `IsActive = true`.
   - Resolves current fiscal year (`GetFiscalYear` — current date between `StartYear` and `EndYear`).
   - Calculates `ReceiptNo = (max ReceiptNo in same FY) + 1`.
   - Inserts the `MAT_TXN_PatientPayments` row.
   - Looks up `PaymentMode` ("cash") in `MasterDbContext.PaymentModes` to get `PaymentSubCategoryId`.
   - Creates an `EmpCashTransactionModel` with `TransactionType` matching the payment's, `InAmount`/`OutAmount` derived from allowance vs return, `CounterID = payment.CounterId`, `ModuleName = "Maternity"`, `PatientId = payment.PatientId`, and saves it.
   - Commits. Rolls back on any exception.
7. **Receipt** — After save, the popup navigates to a receipt view (`maternity-payment-receipt.component.ts`) which calls `GetPatientPaymentDetailByPaymentId(id)` to build a `MaternityPaymentReceipt` (joins Patient, FiscalYear, Employee).

### 5.5 File Upload Workflow

Distinct from the per-patient ANC/register flow — supports ultrasound images, lab reports, and other documents.

1. **Open file upload** — User clicks "Upload" action on a patient row. `MaternityPatientUploadFilesComponent` opens.
2. **List existing files** — `GetMaternityFileUploadList(maternalPatientId)` returns active `MAT_FileUploads` rows.
3. **Pick files** — `<input #fileInput type="file" multiple>`. `ValidateFileSize` rejects any file > 10 MB.
4. **Set display name** — `selectedReport.DisplayName` is required (UI validation rejects empty string).
5. **Submit** — `SubmitFiles` builds a `FormData` with `files` (appended) and `reportDetails` (JSON of `MaternityFileUploads` with `FileName = DisplayName + "_" + DDMMYY` and `PatientId`/`MaternityPatientId` set). `UploadMaternityPatientFiles(patFileUploadData, files)`:
   - Reads `Maternity.UploadFileLocationPath` from `CORE_CFG_Parameters`. Throws if missing.
   - For each file: writes bytes to `Path + "/" + DisplayName + "_" + Ticks + extension`, sets `FileType = extension`, `FileName = originalFileName + "_" + Ticks + extension`, `IsActive = true`.
   - Adds the `MaternityFileUploads` row to the context and saves.
   - Wraps the whole thing in a `TransactionScope`; rolls back on any failure.
6. **Download file** — `download(id)` calls `DownloadFile?matPatientFileId=id` which streams the file from disk with the correct `Content-Type` (via `FileExtensionContentTypeProvider`).
7. **Remove file** — `DeleteMaternityPatientFile` soft-deletes (`IsActive = false`, audit). Note: the file bytes are **not** deleted from disk.

### 5.6 Reports

**Maternity Allowance Report** — `Maternity/Reports/AllowanceReport`:

- `Load()` calls `GetMaternityAllowanceReportList(fromDate, toDate, userId)`. The `userId` is `0` for "All Users" or a specific `EmployeeId` from the user list.
- The returned `DataSet` has two tables:
  - `Table1`: per-user summary (`PaidToPatient`, `ReturnedFromPatient`, `NetPaidAmount`, `PaidCount`, `ReturnCount`). Frontend aggregates these and shows `NetPaidAmount = PaidToPatient - ReturnedFromPatient`.
  - `Table2`: per-transaction detail rows shown in the grid (Date, ReceiptNo, Patient Name, Hospital No, Age/Sex, Type, Paid Amount, Return Amount, User).
- "View Details" action on a row opens the receipt popup (`MaternityPaymentReceiptComponent`).
- Export to Excel: `fileName: 'MaternityAllowanceReportList_YYYY-MM-DD.xls'`.

---

## 6. API Endpoints

All endpoints under `/api/Maternity/*`. Auth: standard `RbacUser` session, plus `[RequestFormSizeLimit(valueCountLimit: 1000000)]` for the file upload.

| # | HTTP | Route | Purpose | Source |
|---|------|-------|---------|--------|
| 1 | POST | `/api/Maternity/AddMaternityPatient` | Create new `MAT_Patient` row. Body: `MaternityPatient` JSON. Sets `CreatedBy`/`CreatedOn` from session. | `MaternityController.AddMaternityPatient` |
| 2 | POST | `/api/Maternity/UpdateMaternityPatient` | Update existing `MAT_Patient` (HusbandName, Height, Weight, LMP, EDD, OBSHistory). Sets `ModifiedBy`/`ModifiedOn`. | `MaternityController.UpdateMaternityPatient` |
| 3 | DELETE | `/api/Maternity/DeleteMaternityPatient?id={id}` | Soft-delete (`IsActive = false`) on `MAT_Patient`. Returns true/false. | `MaternityController.DeleteMaternityPatient` |
| 4 | DELETE | `/api/Maternity/Conclude?id={id}` | Set `IsConcluded = true`, `ConcludedBy`/`ConcludedOn` on `MAT_Patient`. | `MaternityController.ConcludeMaternityPatient` |
| 5 | POST | `/api/Maternity/UpdateMotherInfo` | Update mother's delivery fields (`PlaceOfDelivery`, `Presentation`, `Complications`, `DeliveryDate`, `TypeOfDelivery`) on `MAT_Patient`. | `MaternityController.UpdateMotherInfo` |
| 6 | GET | `/api/Maternity/GetPatientDetails` | Returns active female patient list (PatientId, PatientCode, ShortName, Age, Gender, DOB, Address). | `MaternityController.GetPatientDetails` |
| 7 | GET | `/api/Maternity/GetDatForEditSearch?searchText={txt}` | Search active female patients by name/code/phone for editing. | `MaternityController.GetDatForEditSearch` |
| 8 | GET | `/api/Maternity/GetPatientDetailById?id={id}` | Returns full `PAT_Patient` row by id. | `MaternityController.GetPatientDetailById` |
| 9 | GET | `/api/Maternity/GetAllActiveMaternityPatientList?showAll={bool}&fromDate={d}&toDate={d}` | List active `MAT_Patient` joined with `PAT_Patient`, date-range filtered. `showAll=false` hides concluded patients. | `MaternityController.GetAllActiveMaternityPatientList` |
| 10 | POST | `/api/Maternity/AddUpdateMaternityANC` | Insert (`MaternityANCId=0`) or update ANC. Auto-resolves `PatientId` from `MAT_Patient.PatientId`. | `MaternityController.AddUpdateMaternityANC` |
| 11 | GET | `/api/Maternity/GetAllANCByMaternityPatId?id={id}` | List active ANC visits for a maternity patient. | `MaternityController.GetAllANCByMaternityPatId` |
| 12 | DELETE | `/api/Maternity/DeleteMaternityPatientANC?id={id}` | Soft-delete an ANC visit. | `MaternityController.DeleteMaternityPatientANC` |
| 13 | POST | `/api/Maternity/RegisterMaternity` | Register a delivery. Body: `MaternityRegisterVM { MaternityPatient, MaternityDetails[] }`. Single transaction — updates mother + inserts N child rows. | `MaternityController.RegisterMaternity` |
| 14 | GET | `/api/Maternity/GetAllBabyDetailsByMaternityPatId?matId={mId}&patId={pId}` | Join mother delivery + per-baby register rows. | `MaternityController.GetAllBabyDetailsByMaternityPatId` |
| 15 | POST | `/api/Maternity/UpdateChildInfo` | Update a single child row (`OutcomeOfBaby`, `OutcomeOfMother`, `WeightInGram`, `Gender`). | `MaternityController.UpdateChildInfo` |
| 16 | DELETE | `/api/Maternity/RemoveChild?id={id}` | Soft-delete a child row. | `MaternityController.RemoveChild` |
| 17 | POST | `/api/Maternity/UploadMaternityPatientFiles` | Multipart upload. `files` (binary) + `reportDetails` (JSON). Writes to disk + inserts metadata. | `MaternityController.UploadMaternityPatientFiles` |
| 18 | GET | `/api/Maternity/GetAllFilesUploadedbyMaternityPatId?id={id}` | List active file metadata for a maternity patient. | `MaternityController.GetAllFilesUploadedbyMaternityPatId` |
| 19 | DELETE | `/api/Maternity/DeleteMaternityPatientFile?id={id}` | Soft-delete a file metadata row (file bytes remain on disk). | `MaternityController.DeleteMaternityPatientFile` |
| 20 | GET | `/api/Maternity/DownloadFile?matPatientFileId={id}` | Streams a file from disk. Sets correct `Content-Type` via `FileExtensionContentTypeProvider`. | `MaternityController.Download` |
| 21 | GET | `/api/Maternity/GetAllDosesNumber?doseNeeded={bool}` | Returns the standard ANC visit list from `CommonFunctions.GetDosesNumberArray()`. | `MaternityController.GetAllDosesNumber` |
| 22 | GET | `/api/Maternity/SearchPatListForAllowance?searchText={txt}&IsSearchAll={bool}` | SP `SP_MAT_GetPatientListForAllowance` — search patients eligible for allowance (default 200 rows). | `MaternityController.SearchPatListForAllowance` |
| 23 | GET | `/api/Maternity/GetMaternityAllowanceReportList?fromDate={d}&toDate={d}&userId={u}` | SP `SP_MAT_RPT_GetMaternityPaymentDetails` — DataSet with summary (Table1) and detail (Table2). | `MaternityController.GetMaternityAllowanceReportList` |
| 24 | POST | `/api/Maternity/AddMaternityPatientPayment` | Add a payment. Transactional: inserts `MAT_TXN_PatientPayments` + `TXN_EmpCashTransaction` side-effect. | `MaternityController.AddMaternityPatientPayment` |
| 25 | GET | `/api/Maternity/GetPatientPaymentDetailById?id={id}` | List all payments for a patient. Joins `Employee.FullName`. | `MaternityController.GetPatientPaymentDetailById` |
| 26 | GET | `/api/Maternity/GetPatientPaymentDetailByPaymentId?id={id}` | Build a `MaternityPaymentReceipt` (joins Patient, FiscalYear, Employee). | `MaternityController.GetPatientPaymentDetailByPaymentId` |

**Total: 26 endpoints** across 22 controller actions (some reused for Get/Post/Delete).

---

## 7. Cross-Module Integration

### 7.1 Patient Module

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Filter patients for maternity | Reads `PAT_Patient` filtered by `IsActive = true AND Gender = 'female'` | `MaternityService.GetDataForEditSearch`, `GetPatientDetails` |
| Fetch a single patient | `MaternityService.GetPatientDetailById` returns the full `PAT_Patient` row | `MaternityController.GetPatientDetailById` |
| Add new maternity patient (searchable from PAT list) | The user picks a female patient from the global patient list, then `AddMaternityPatient` is called with just the `PatientId` and the maternity-specific fields | `MaternityController.AddMaternityPatient` |
| Patient list for payment allowance | SP `SP_MAT_GetPatientListForAllowance` joins patient + visit + admission to return discharged female patients | `MaternityController.SearchPatListForAllowance` |

### 7.2 Admission (ADT) Module

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Discharge date & IP number shown in payment patient list | The `SearchPatListForAllowance` SP returns `VisitCode` (IP Number) and `DischargeDate` | `MaternityGridColumnSettings.MaternityPaymentPatientColSettings` |

### 7.3 Billing Module

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Fiscal year resolution | `MaternityService.GetFiscalYear` reads `BIL_CFG_FiscalYears` (current date between `StartYear` and `EndYear`) | `MaternityService.GetFiscalYear` |
| Sequential receipt number per FY | `GetPaymentReceiptNo(fiscalYearId)` returns `MAX(ReceiptNo) + 1` for the given FY | `MaternityService.GetPaymentReceiptNo` |
| Billing counter for MATERNITY | Frontend reads `BIL_CFG_BillingCounter` cached rows and picks `CounterType = "MATERNITY"` | `maternity-patient-payment.component.ts:GetBillingCounterForMaternity` |
| Payment mode resolution | `MasterDbContext.PaymentModes` lookup by `PaymentSubCategoryName` ("cash") to get `PaymentSubCategoryId` | `MaternityService.AddMaternityPatientPayment` |

### 7.4 Accounting / Cash Transaction Module

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Insert `TXN_EmpCashTransaction` on every payment | One row per `MAT_TXN_PatientPayments` insert. `ModuleName = "Maternity"`. `TransactionType` = `MaternityAllowance` or `MaternityAllowanceReturn`. `InAmount`/`OutAmount` derived accordingly. `ReferenceNo` = `PatientPaymentId`. `CounterID` = payment's `CounterId`. | `MaternityService.AddMaternityPatientPayment` |

### 7.5 Employee / RBAC

| Integration | Direction | Code Reference |
|-------------|-----------|----------------|
| Session user → audit fields | `HttpContext.Session.Get<RbacUser>("currentuser").EmployeeId` is set as `CreatedBy`/`ModifiedBy`/`ConcludedBy` for every write | `MaternityController` (all write actions) |
| Cashier name on receipt | `MAT_TXN_PatientPayments.CreatedBy` joined to `EMP_Employee.FullName` for display | `MaternityService.GetPatientPaymentDetailById` |
| Employee list for report user filter | Settings module endpoint — fetched in `mat-allowance-report.component.ts:LoadUser` | `MaternityReportsMatAllowanceComponent.LoadUser` |

### 7.6 Core Parameters

| Parameter | Consumer | Purpose |
|-----------|----------|---------|
| `Maternity.UploadFileLocationPath` | `MaternityService.UploadMaternityPatientFiles`, `MaternityController.Download` | Filesystem path for upload/download |
| `Maternity.PaymentAmountsAvailable` | `maternity-patient-payment.component.ts:GetPaymentAmountFromCoreParameter` | CSV of predefined amounts |
| `Maternity.NumberOfAllowedVisits` | `maternity-anc.component.ts:GetAllDosesNumber` | Limits the ANC visit dropdown |

### 7.7 Master Data (Cache)

| Master | Frontend Cache Use |
|--------|--------------------|
| `MST_Country` | `maternity-patient-add.component.ts:Initialize` — country dropdown |
| `MST_CountrySubDivision` | District dropdown, auto-selected by `CountrySubDivisionId` |
| `BIL_CFG_BillingCounter` | Maternity counter auto-selected |
| `EMP_Employee` (settings) | User filter in allowance report |

---

## 8. Business Rules

### 8.1 Patient Eligibility

- **Gender restriction**: The `GetDataForEditSearch` and `GetPatientDetails` queries explicitly filter `pat.Gender.ToLower() == "female"`. Male patients cannot be added to maternity.
- **Active restriction**: Inactive patients (`IsActive = false`) are excluded.
- **Patient must exist in `PAT_Patient`**: There is no patient creation inside the maternity module — the user must select an existing female patient.

### 8.2 Audit Trail

Every write touches one or more of the following audit fields:

- `CreatedOn` / `CreatedBy` — set on insert from `RbacUser.EmployeeId` and `DateTime.Now`.
- `ModifiedOn` / `ModifiedBy` — set on every update. The service explicitly enumerates `IsModified = true` on each property (no over-posting risk).
- `ConcludedOn` / `ConcludedBy` — set only on `Conclude` API.
- `IsActive` — set `false` on `Delete` (soft-delete). **All 5 tables** support soft-delete.

### 8.3 Validation Rules (Frontend)

| Form | Required | Constraints |
|------|----------|-------------|
| Add Maternity Patient | `HusbandName`, `Height` | Max length 30 |
| ANC | `PregnancyPeriodInWeeks`, `VisitNumber`, `ANCPlace`, `ConditionOfANC`, `Weight` | Weight pattern `^[1-9][0-9]{1,2}\d*(\.[0-9]+)?$` (1-999 with optional decimal) |
| Register Delivery | `PlaceOfDelivery`, `TypeOfDelivery`, `Presentation` (mother); `Gender`, `WeightInGram`, `OutcomeOfBaby`, `OutcomeOfMother` (each child) | `NumberOfBaby` 1-6 |
| File Upload | `DisplayName` non-empty | Each file ≤ 10 MB |
| Payment | `Remarks`, `Amount` | Remarks mandatory for returns; return amount must not exceed `totalPaid - totalReturn` |

### 8.4 Number of Babies

The delivery form supports 1-6 babies. Changing the number rebuilds the `multipleChild[]` array. Once a delivery is registered (`matPat.MaternityRegisterId > 0`), the number-of-babies dropdown is disabled.

### 8.5 ANC Visit Number

The list of allowed visits comes from `CommonFunctions.GetDosesNumberArray()` (e.g. "1st ANC", "2nd ANC", "3rd ANC", "4th ANC") and is truncated client-side to `Maternity.NumberOfAllowedVisits`. The backend does not enforce this limit — a user could send any `VisitNumber` string.

### 8.6 Delivery Transaction Atomicity

`RegisterMaternity` wraps the mother update and N child inserts in a `TransactionScope`. If any insert fails, the whole operation rolls back. This is the only `TransactionScope` in the service. The ANC and file-upload writes do not use transactions (single-row updates).

### 8.7 Payment Transaction Atomicity

`AddMaternityPatientPayment` uses `maternityDbContext.Database.BeginTransaction()` to ensure both the `MAT_TXN_PatientPayments` insert and the `TXN_EmpCashTransaction` insert commit together. On any exception, it rolls back and throws.

### 8.8 Receipt Number Generation

`ReceiptNo` is computed as `(MAX(ReceiptNo) for current FiscalYearId) + 1` at the time of insert. There is no DB-side sequence — concurrent inserts of two payments in the same FY could theoretically produce a duplicate `ReceiptNo`. The service does not guard against this. (A `SELECT MAX` then `INSERT` race is possible.)

### 8.9 Allowance Return Cap

Frontend enforces that the return amount cannot exceed `totalPaid - totalReturn`. This prevents the patient from being paid out more than they've received. The backend does not validate this — a custom client could bypass it.

### 8.10 File Storage Rules

- **Filename collision prevention**: `FileName = file.FileName + "_" + DateTime.Now.Ticks + extension` (server) or `DisplayName + "_" + DDMMYY` (client hint, overwritten server-side).
- **Directory auto-creation**: `Directory.CreateDirectory(parm.ParameterValue)` if missing.
- **File deletion**: `DeleteMaternityPatientFile` only soft-deletes the metadata row. The bytes on disk are **not** removed. There is no API to purge orphaned files.
- **MIME type detection**: `FileExtensionContentTypeProvider` maps known extensions; falls back to `application/octet-stream`.

### 8.11 Conclude Semantics

`Conclude` is irreversible through the API (no `Unconclude` endpoint). It sets `IsConcluded = true` and the four `Concluded*`/`Modified*` fields. Concluded patients are hidden from the default active list but appear when `showAll = true`. The grid renderer (`MaternityListButtonRenderer`) shows only "View" for concluded patients — no ANC, Register, Upload, Conclude, or Remove actions.

### 8.12 Fiscal Year Behavior

- `GetFiscalYear` selects the first fiscal year where `StartYear <= today <= EndYear`. If no FY matches the current date (e.g. between fiscal years), this returns `null` and would cause a `NullReferenceException` in `AddMaternityPatientPayment` (line 515). This is an unhandled edge case.

### 8.13 Gender-Only Restriction in Edit Search

The search query for editing maternity patients (`GetDataForEditSearch`) concatenates `FirstName + MiddleName + LastName + PatientCode + PhoneNumber` and does a `Contains(searchText)` match. This is a single full-table scan on `PAT_Patient` filtered to active female patients — performance concern for very large patient tables.

### 8.14 EmpCashTransaction Side-Effect

The `TXN_EmpCashTransaction` row mirrors the payment's amounts:
- For `MaternityAllowance`: `InAmount = 0`, `OutAmount = payment.OutAmount`
- For `MaternityAllowanceReturn`: `InAmount = payment.InAmount`, `OutAmount = 0`

This is consistent with cash going out (allowance) or coming back (return). The `CounterID`, `PaymentModeSubCategoryId`, and `ModuleName = "Maternity"` tag the transaction for downstream reporting.

### 8.15 ANC Place and Condition as Free Text

Both `ANCPlace` and `ConditionOfANC` are unconstrained strings — there is no lookup table for ANC places (hospital name, clinic, etc.) or conditions (Normal, Gestational Hypertension, etc.). The frontend validates only that they are non-empty.

### 8.16 Maternity Allowance Report

- The report supports an optional user filter (`userId = 0` means all users). The user list is loaded from the Settings module.
- The summary (`Table1`) is aggregated per user and re-aggregated client-side across users to produce `NetPaidAmount`, `PaidToPatient`, `ReturnedFromPatient`, and counts of patients with positive paid/return amounts.
- "View Details" on a row opens the receipt popup, which uses the same `MaternityPaymentReceiptComponent` as the post-payment flow.
- Export filename: `MaternityAllowanceReportList_YYYY-MM-DD.xls`.

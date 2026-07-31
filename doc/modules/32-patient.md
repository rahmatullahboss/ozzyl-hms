# Patient Module — DanpheEMR Reference

Reference implementation: DanpheEMR (ASP.NET Core / SQL Server / Angular)
Source root: `DanpheEMR reference/Code/`
Target stack (in our HMS): Hono on Cloudflare Workers + D1 + R2 + Angular on Pages.
This document describes the reference .NET behavior so parity work has a single source of truth.

---

## 1. Module Overview

The Patient module is the **master data hub** of DanpheEMR. Every clinical, billing, appointment, admission, lab, imaging, and pharmacy transaction references a patient row from this module. The module owns:

- Patient demographics, identity, and contact information
- Patient-level code, EMPI, scheme mapping
- Patient addresses (1..N), insurance records, kin/emergency contacts
- Patient guarantor
- Patient profile picture and uploaded documents
- Patient-level history aggregator (visits, admissions, labs, imaging, bills, prescriptions, vitals)
- Patient health card and neighbourhood card issuance
- Patient dashboard aggregations (counts by day, by membership, by rank, etc.)
- Patient search, EMPI matching, and list/grid operations

Hospital workflow served:
- **Front desk registration** (reception / billing-out-patient / appointment)
- **EMPI duplicate detection** during registration
- **Patient profile update** (edit, restricted by time-window parameter)
- **Patient master lookups** consumed by every other module
- **Patient file storage** (R2 / file system in reference)
- **Government / insurance patient onboarding** (GovInsurancePatient, BillingOutPatient paths)
- **Dashboard cards** for the Patient module homepage

Key file paths:
- Backend controllers: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Patient/`
- Server models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/PatientModels/`
- DB context: `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/PatientDbContext.cs`
- Frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/patients/`

---

## 2. Backend Files

### 2.1 Controllers

| File | Purpose |
|------|---------|
| `Controllers/Patient/PatientController.cs` | Main REST endpoints: search, CRUD, lookups, file upload, EMPI match, health card, neighbourhood card, scheme map. 2394 lines. |
| `Controllers/Patient/PatientBL.cs` | Business logic: `GetPatNumberNCodeForNewPatient`, `CreateEmpi`, `GetPatientModelFromPatientVM`, `GetInsuranceModelFromInsPatientVM`. 277 lines. |
| `Controllers/Patient/PatientDashboardController.cs` | Dashboard aggregations (card summary, patient count by day, by age group, by rank, by department, by membership, hospital management). 172 lines. |
| `Controllers/Patient/PatientViewController.cs` | MVC view routes for the patient registration pages (Address, Guarantor, Insurance, KIN, Notes, Patient, PatientMain, RegisterPatientMain, SearchPatient). 145 lines. |

### 2.2 Key methods in `PatientController.cs`

| Method | HTTP route | Purpose |
|--------|------------|---------|
| `GetPatientByGUID` | `GET /api/Patient/GetPatientByGUID?patientGUID=` | Telemedicine: look up by external GUID, returns `PatientModel` with CountrySubDivision. |
| `GetPatientCurrentSchemeMap` | `GET /api/Patient/GetPatientCurrentSchemeMap?patientId=&patientVisitId=` | Returns the active `PatientSchemeMapModel` for a visit. |
| `GetCastEthnicGroupList` | `GET /api/Patient/GetCastEthnicGroupList` | Lists cast / ethnic groups from `VaccinationDbContext.EthnicGroupCast`. |
| `PatientById` | `GET /api/Patient/PatientById?patientId=` | Full patient with addresses, guarantor, insurances, kins, country subdivision, admissions. Filters active admissions. |
| `PatientByCode` | `GET /api/Patient/PatientByCode?patientCode=` | Lookup by hospital number. Returns Failed if input empty. |
| `LightPatientById` | `GET /api/Patient/LightPatientById?patientId=` | Light projection (id, code, names, age, gender, phone, DOB, address, outdoor flag, created-on, district, PAN). |
| `MatchingPatients` | `GET /api/Patient/MatchingPatients?FirstName=&LastName=&Age=&Gender=&PhoneNumber=` | EMPI-style duplicate detection: name+age+gender exact OR phone+gender exact. |
| `PatientDocuments` | `GET /api/Patient/PatientDocuments?patientId=` | Lists all uploaded documents (excludes `profile-pic` FileType) joined with uploader employee. |
| `PatientWithVisitInfo` | `GET /api/Patient/PatientWithVisitInfo?search=&showIpPatinet=` | Calls `SP_Billing_PatientsListWithVisitinformation` for visit-aware search. |
| `IPDPatientSearch` | `GET /api/Patient/IPDPatientSearch?search=` | Calls `SP_Billing_IpdPatientsListWithVisitinformation` for IPD-only search. |
| `PatientLastVisitContext` | `GET /api/Patient/PatientLastVisitContext?patientId=` | Calls `SP_PAT_GetLastVisitContextByPatientId` to get latest visit context. |
| `PatientProfilePicture` (GET) | `GET /api/Patient/PatientProfilePicture?patientId=` | Returns active `profile-pic` file as base64. |
| `InsuranceProviders` | `GET /api/Patient/InsuranceProviders` | Lists active `InsuranceProviderModel` (id, name). |
| `NewDialysicCode` | `GET /api/Patient/NewDialysicCode` | Returns the next dialysis code (max + 1). |
| `HealthCardStatus` | `GET /api/Patient/HealthCardStatus?patientId=` | Aggregates bill status, paid date, billing date, card print status, printed-on from `BillingTransactionItems` and `PATHealthCard`. |
| `MembershipTypes` | `GET /api/Patient/MembershipTypes` | Lists active schemes with formatted display. |
| `AdmittedPatients` | `GET /api/Patient/AdmittedPatients` | Joins `Patients`, `Visits`, `Admissions` where `AdmissionStatus == "admitted"`. |
| `SearchPatient` | `GET /api/Patient/SearchPatient?search=` | Full text search across name/address/phone/patient code. Server-side pagination configurable by core parameter. |
| `SearchRegisteredPatient` | `GET /api/Patient/SearchRegisteredPatient?search=` | Calls `SP_PAT_RegisteredPatientList` with 200 row cap. |
| `SearchPatientForNewVisit` | `GET /api/Patient/SearchPatientForNewVisit?search=&searchUsingHospitalNo=&searchUsingIdCardNo=` | Calls `SP_APPT_PatientListForNewVisit` (lighter, used in frequent appointment flow). |
| `PatientDetailForVaccination` | `GET /api/Patient/PatientDetailForVaccination?patientId=` | Vaccination-specific projection with municipality name. |
| `PostPatient` | `POST /api/Patient/PostPatient` | Creates new patient. Generates EMPI, generates `PatientNo`/`PatientCode` via `PatientBL.GetPatNumberNCodeForNewPatient`, optional profile pic. |
| `PatientFiles` | `POST /api/Patient/PatientFiles` | Multipart upload of patient documents. Writes to `CORE_CFG_Parameters.PatientFileLocationPath` directory, stores metadata in `PAT_PatientFiles`. |
| `PatientProfilePicture` (POST) | `POST /api/Patient/PatientProfilePicture` | Base64 image upload. Stores to `PatientProfilePicImageUploadLocation`, marks old profile pics inactive. |
| `PatientHealthCard` | `POST /api/Patient/PatientHealthCard` | Inserts `HealthCardInfoModel` row into `PAT_HealthCardInfo`. |
| `NeighbourhoodCard` | `POST /api/Patient/NeighbourhoodCard` | Inserts `NeighbourhoodCardModel` row into `PAT_NeighbourhoodCardDetail`. |
| `GovInsurancePatient` (POST) | `POST /api/Patient/GovInsurancePatient` | Onboards a government-insurance patient. Uses `PatientBL.GetPatientModelFromPatientVM` and `GetInsuranceModelFromInsPatientVM`. |
| `BillingOutPatient` (POST) | `POST /api/Patient/BillingOutPatient` | Quick walk-in registration from billing. |
| `GovInsurancePatient` (PUT) | `PUT /api/Patient/GovInsurancePatient` | Updates insurance info for an existing patient. |
| `PutPatient` | `PUT /api/Patient/PutPatient` | Updates patient with `RefactorThis.GraphDiff` for owned collections (Addresses, KinEmergencyContacts, Insurances, Guarantor). Locks audit fields, PatientCode, PatientNo, Ins_*, IsVaccination*, Telmed_GUID, MotherName. |
| `DownloadFile` | `GET /api/Patient/DownloadFile?patientFileId=` | Streams file from `PatientFileLocationPath`. Uses `FileExtensionContentTypeProvider`. |

### 2.3 Key private methods

| Method | Purpose |
|--------|---------|
| `GetDobByAge(int age)` | Computes a synthetic DOB at Jan 1 of `currentYear - age`. Used when age is given instead of DOB. |
| `CreatePatientWithUniquePatientNum(patDbContext, patient, connString)` | Recursively calls `PatientBL.GetPatNumberNCodeForNewPatient` if unique constraint `SqlException.Number == 2627` is raised on insert. |
| `GeneratePatientNoAndSavePatient(patDbContext, clientPatModel, connString)` | Same retry pattern for the standard `PostPatient` flow (Krishna, 6 Jan 2022). |
| `AddProfilePic` | Writes image to disk, marks all previous active profile pics as `IsActive = false`. |
| `UploadPatientFiles` | Wraps file copy in `TransactionScope`; creates destination dir if missing. |
| `GetPatientProfilePicture` | Reads file from disk and returns as base64 string. |
| `GetNewDialysisCode` | Returns `MAX(DialysisCode)`; null defaults to 0. |
| `GetPatientHealthCardStatus` | Joins bill + health card data into `{BillStatus, PaidDate, BillingDate, IsPrinted, PrintedOn}`. |
| `PatientSearch` | Heavy LINQ search; left-joins country, district, municipality; left-joins visits, admissions, bed reservations, police case info, ward/bed info. Honors core parameters `ServerSideSearchComponent.PatientSearchPatient` and `ServerSideSearchListLength`. |
| `AddPatient` | Deserializes JSON, calls `PatientBL.CreateEmpi`, sets `CreatedOn`, adds, calls `GeneratePatientNoAndSavePatient`, optionally adds profile pic. |
| `UploadPatientFile` | Multipart form-data handler, wraps in DB transaction, computes `FileNo` = max per (PatientId, FileType) + 1. |
| `UploadProfilePic` | JSON body with base64 string; calls `AddProfilePic`. |
| `UploadHealthCard`, `UploadNeighbourhoodCard` | Simple inserts. |
| `SaveGovInsurancePatient`, `SaveBillingOutPatient` | Wraps VM-to-model mapping in `PatientBL`, calls `CreatePatientWithUniquePatientNum`. |
| `UpdateGovInsurancePatient` | Updates only insurance fields (IMISCode, InsuranceProviderId, InsuranceName, CurrentBalance). |
| `UpdateNormalPatient` | Uses `UpdateGraph` to update `Addresses`, `KinEmergencyContacts`, `Insurances`, `Guarantor` collections. |

### 2.4 Methods in `PatientBL.cs`

| Method | Purpose |
|--------|---------|
| `GetPatNumberNCodeForNewPatient(connString)` | Computes the next `PatientNo` inside a `ReadUncommitted` transaction (`max(PatientNo) + 1`). Reads core parameters `Patient.PatientCodeFormat` and `HospitalCode`. Supported formats: `"YYMM-PatNum"` -> e.g. `2506000001`, `"HospCode-PatNum"` -> e.g. `HOSP1`, `"PatNum"` -> just the number. Returns `NewPatientUniqueNumbersVM`. |
| `CreateEmpi(patient, connString)` | Builds 16-character EMPI from district first 3 chars + DOB (`ddMMyy`) + name initials (First/Middle/Last, `X` if middle/last missing) + 4-digit random. Stored uppercase in `PatientModel.EMPI`. |
| `GetPatientModelFromPatientVM(GovInsurancePatientVM, connString, patDbContext)` | Maps the slim government-insurance VM into a full `PatientModel` (no PatientNo/Code assignment here). |
| `GetInsuranceModelFromInsPatientVM(GovInsurancePatientVM, currentUserId)` | Maps the insurance portion: `InsuranceProviderId`, `InsuranceName`, `IMISCode`, `InitialBalance`, `CurrentBalance`, audit fields. |
| `GetPatientModelFromPatientVM(BillingOpPatientVM, ...)` | Maps the billing-out-patient VM. Includes `MunicipalityId`, `Email`, `EthnicGroup`, `WardNumber`. |

### 2.5 Methods in `PatientDashboardController.cs`

All endpoints take `FromDate` and `ToDate` and run a stored procedure:

| Endpoint | Stored procedure | Returns |
|----------|------------------|---------|
| `GET /PatientDashboard/GetPatientDashboardCardSummaryCalculation` | `SP_Dashboard_PAT_CardSummaryCalculation` | DataSet: Patients, Doctors, Appointments, ReAdmission. |
| `GET /PatientDashboard/GetPatientCountByDay` | `SP_Dashboard_PAT_PatientCountByDay` | DataTable. |
| `GET /PatientDashboard/GetAverageTreatmentCostbyAgeGroup` | `SP_Dashboard_PAT_AverageTreatmentCostbyAgeGroup` | DataTable. |
| `GET /PatientDashboard/GetDepartmentWiseAppointment` | `SP_Dashboard_PAT_DepartmentWiseAppointment` | DataTable. |
| `GET /PatientDashboard/GetPAtVisitByMembership` | `SP_Dashboard_PAT_VisitByMembership` | DataTable. |
| `GET /PatientDashboard/GetPatientDistributionBasedOnRank` (+`DepartmentId`) | `SP_Dashboard_PAT_PatientDistributionBasedOnRank` | DataTable. |
| `GET /PatientDashboard/GetHospitalManagement` | `SP_Dashboard_PAT_HospitalManagement` | DataTable. |

### 2.6 Methods in `PatientViewController.cs`

Renders Razor views used for the registration tabs:

| Action | View | Permission |
|--------|------|------------|
| `Address()` | `Address.cshtml` | `patient-register-address-view` |
| `Guarantor()` | `Guarantor.cshtml` | `patient-register-guarantor-view` |
| `Insurance()` | `Insurance.cshtml` | `patient-register-insurance-view` |
| `KIN()` | `KIN.cshtml` | `patient-register-kinemergencycontact-view` |
| `Notes()` | `Notes.cshtml` | `doctors-notes-view` |
| `Patient()` | `Patient.cshtml` | `patient-register-view` |
| `PatientMain()` | `PatientMain.cshtml` | `patient-view` |
| `RegisterPatientMain()` | `RegisterPatientMain.cshtml` | (no per-action permission) |
| `SearchPatient()` | `SearchPatient.cshtml` | `patient-searchpatient-view` |

---

## 3. Data Models

### 3.1 `PatientModel` (table `PAT_Patient`)

Primary entity. `[AuditInclude]` — full audit log on every change.

| Field | Type | Notes |
|-------|------|-------|
| `PatientId` | int (Key) | DB identity |
| `PatientNo` | int | Sequential business number (max + 1 strategy) |
| `EMPI` | string(16) | Generated by `CreateEmpi` (see §8) |
| `Salutation` | string | Mr., Mrs., etc. |
| `FirstName` | string | Required, max 30 (client validator) |
| `MiddleName` | string | Optional, max 30 |
| `LastName` | string | Required, max 30 |
| `FatherName` | string | |
| `MotherName` | string | Locked from update by `UpdateNormalPatient` |
| `Gender` | string | "Male"/"Female"/"Other" |
| `Age` | string | Stored as `<number><Y\|M\|D>` e.g. `25Y`, `6M`, `15D` |
| `DateOfBirth` | DateTime? | Optional; client validator blocks future dates and dates >200 years in the past |
| `IsDobVerified` | bool | When true, DOB is required; when false, Age is required |
| `MaritalStatus` | string | |
| `Race` | string | |
| `PhoneNumber` | string | Required, `^[0-9]{1,10}$` (configurable) |
| `LandLineNumber` | string | `^[0-9]{1,9}$` |
| `PassportNumber` | string | Max 12 |
| `Email` | string | Email regex |
| `IDCardType` | string | |
| `IDCardNumber` | string | |
| `PhoneAcceptsText` | bool | |
| `Occupation` | string | |
| `EthnicGroup` | string | |
| `BloodGroup` | string | A+, B-, etc. |
| `EmployerInfo` | string | |
| `CountryId` | int | FK to `MST_Country` |
| `CountrySubDivisionId` | int? | FK to `MST_CountrySubDivision` (district/state) |
| `PatientCode` | string | Hospital number — format depends on `PatientCodeFormat` parameter |
| `IsActive` | bool | Soft-delete flag |
| `IsOutdoorPat` | bool | Outdoor patient flag |
| `DialysisCode` | int? | Auto-assigned via `GetNewDialysisCode` if patient is dialysis |
| `MunicipalityId` | int? | FK to `MST_Municipality` |
| `MunicipalityName` | string | `[NotMapped]` |
| `WardNumber` | Int16? | |
| `ShortName` | string | Display name: `FirstName [MiddleName] LastName` |
| `PANNumber` | string | Max 20 |
| `Address` | string | Free-text summary address (separate from `Addresses` collection) |
| `CreatedOn` | DateTime | Set server-side |
| `CreatedBy` | int | Locked from update |
| `ModifiedOn` | DateTime? | |
| `ModifiedBy` | int? | |
| `Ins_HasInsurance` | bool | Locked from update |
| `Ins_NshiNumber` | string | Locked from update |
| `Ins_InsuranceBalance` | double | Locked from update |
| `Ins_LatestClaimCode` | Int64? | Locked from update (incremental in billing) |
| `IsSSUPatient` / `SSU_IsActive` | bool | SSU (staff) flag |
| `IsVaccinationPatient` / `IsVaccinationActive` | bool | Locked from update |
| `VaccinationRegNo` | int? | Locked from update |
| `VaccinationFiscalYearId` | int? | Locked from update |
| `Telmed_Patient_GUID` | string | External telemedicine identifier, locked from update |
| `Posting`, `Rank`, `DependentId` | string | APF Hospital-specific fields |
| `PatientNameLocal` | string | Local-language name (e.g. Devanagari) |
| `IsMedicarePatient` | bool | `[NotMapped]` flag |
| `TreatmentType` | string | `[NotMapped]` |

#### Navigational collections (lazy/eager loaded):

| Collection | Type | FK relationship |
|------------|------|-----------------|
| `Addresses` | `List<AddressModel>` | `PAT_PatientAddress.PatientId` |
| `Allergies` | `List<AllergyModel>` | `CLN_Allergies.PatientId` |
| `Insurances` | `List<InsuranceModel>` | `PAT_PatientInsuranceInfo.PatientId` |
| `KinEmergencyContacts` | `List<KinModel>` | `PAT_PatientKinOrEmergencyContacts.PatientId` |
| `Visits` | `List<VisitModel>` | `PAT_PatientVisits.PatientId` |
| `Admissions` | `List<AdmissionModel>` | `ADT_PatientAdmission` via `PatientVisitId` |
| `Guarantor` | `GuarantorModel` (1:1) | `PAT_PatientGurantorInfo.PatientId` (PK = FK) |
| `Problems` | `List<ActiveMedicalProblem>` | `CLN_ActiveMedicals.PatientId` |
| `PastMedicals` | `List<PastMedicalProblem>` | `CLN_PastMedicals.PatientId` |
| `FamilyHistory` | `List<FamilyHistory>` | |
| `SurgicalHistory` | `List<SurgicalHistory>` | |
| `SocialHistory` | `List<SocialHistory>` | `CLN_SocialHistory.PatientId` |
| `HomeMedication` | `List<HomeMedicationModel>` | `CLN_HomeMedications.PatientId` |
| `MedicationPrescriptions` | `List<MedicationPrescriptionModel>` | `CLN_MedicationPrescription.PatientId` |
| `ImagingReports` | `List<ImagingReportModel>` | `RAD_PatientImagingReport.PatientId` |
| `ImagingItemRequisitions` | `List<ImagingRequisitionModel>` | `RAD_PatientImagingRequisition.PatientId` |
| `LabRequisitions` | `List<LabRequisitionModel>` | `LAB_TestRequisition` |
| `Vitals` | `List<VitalsModel>` | `[NotMapped]` — joined to visit in code |
| `Notes` | `List<NotesModel>` | `CLN_Notes` |
| `UploadedFiles` | `List<PatientFilesModel>` | `PAT_PatientFiles.PatientId` |
| `CountrySubDivision` | `CountrySubDivisionModel` | `MST_CountrySubDivision` |
| `ProfilePic` | `PatientFilesModel` | `[NotMapped]` |

#### `GetClone` (client-side helper, `patient.model.ts:292`)

Returns a shallow copy with `PatientValidator`, `Guarantor`, `Admissions`, `Addresses` set to `null`. Used when navigating to a clean form without losing patient data.

### 3.2 `AddressModel` (table `PAT_PatientAddress`)

| Field | Type |
|-------|------|
| `PatientAddressId` | int (Key) |
| `PatientId` | int (FK) |
| `AddressType` | string (e.g. "Temporary", "Permanent") |
| `Street1` | string (required, max 30) |
| `Street2` | string |
| `CountryId` | int |
| `CountrySubDivisionId` | int? |
| `City` | string (required) |
| `ZipCode` | string |
| `CountryName` | `[NotMapped]` |
| `CountrySubDivisionName` | `[NotMapped]` |
| `Patient` | `PatientModel` (virtual nav) |

### 3.3 `GuarantorModel` (table `PAT_PatientGurantorInfo`)

1:1 with patient — `PatientId` is both PK and FK.

| Field | Type |
|-------|------|
| `PatientGurantorInfo` | int? (`DatabaseGenerated.Computed`) |
| `PatientId` | int (Key + FK) |
| `GuarantorSelf` | bool |
| `PatientRelationship` | string |
| `GuarantorName` | string (required) |
| `GuarantorGender` | string |
| `GuarantorCountryId` | int? |
| `GuarantorPhoneNumber` | string (`^[0-9]{1,10}$`) |
| `GuarantorDateOfBirth` | DateTime? |
| `GuarantorStreet1` / `GuarantorStreet2` | string |
| `GuarantorCity` | string |
| `GuarantorCountrySubDivisionId` | int? |
| `GuarantorZIPCode` | string |

### 3.4 `InsuranceModel` (table `PAT_PatientInsuranceInfo`)

| Field | Type |
|-------|------|
| `PatientInsuranceInfoId` | int (Key) |
| `PatientId` | int (FK) |
| `InsuranceNumber` | string (required) |
| `InsuranceName` | string |
| `CardNumber` | string (required) |
| `SubscriberFirstName` | string |
| `SubscriberLastName` | string |
| `SubscriberGender` | string |
| `SubscriberDOB` | DateTime? |
| `SubscriberIDCardNumber` | string |
| `SubscriberIDCardType` | string |
| `IMISCode` | string (required) |
| `InitialBalance` | double |
| `CurrentBalance` | double (only this updates on `UpdateGovInsurancePatient`) |
| `InsuranceProviderId` | int (required) |
| `CreatedOn` / `CreatedBy` / `ModifiedOn` / `ModifiedBy` | audit |
| `InsuranceProviderName` | `[NotMapped]` |
| `Ins_HasInsurance` / `Ins_NshiNumber` / `Ins_InsuranceBalance` / `Ins_InsuranceProviderId` / `Ins_IsFamilyHead` / `Ins_FamilyHeadNshi` / `Ins_FamilyHeadName` / `Ins_IsFirstServicePoint` | NHIS (Nepal Health Insurance) fields |

`InsuranceBillingTransactionPostVM` is a view-model wrapper combining Lab, Imaging, Visit, and BillingTransaction for a single insurance txn (used by billing endpoint, not patient endpoint).

### 3.5 `InsuranceProviderModel` (table `INS_CFG_InsuranceProviders`)

| Field | Type |
|-------|------|
| `InsuranceProviderId` | int (Key) |
| `InsuranceProviderName` | string |
| `Description` | string |
| `CreatedOn` / `CreatedBy` / `ModifiedBy` | audit |
| `IsActive` | bool |

### 3.6 `KinModel` (table `PAT_PatientKinOrEmergencyContacts`)

| Field | Type |
|-------|------|
| `PatientKinOrEmergencyContactId` | int (Key) |
| `PatientId` | int (FK) |
| `KinContactType` | string (required — "Emergency"/"Kin") |
| `KinFirstName` / `KinLastName` | string (required) |
| `KinPhoneNumber` | string (`^[0-9]{1,10}$`) |
| `RelationShip` | string (required) |
| `KinComment` | string |

### 3.7 `HealthCardInfoModel` (table `PAT_HealthCardInfo`)

| Field | Type |
|-------|------|
| `PatHealthCardId` | int (Key) |
| `PatientId` | int (FK) |
| `InfoOnCardJSON` | string — JSON of the printed card data |
| `BillingDate` | DateTime? |
| `CreatedOn` | DateTime? |
| `CreatedBy` | int |

### 3.8 `NeighbourhoodCardModel` (table `PAT_NeighbourhoodCardDetail`)

| Field | Type |
|-------|------|
| `NeighbourhoodCardId` | int (Key) |
| `PatientId` | int (FK) |
| `PatientCode` | string |
| `CreatedOn` / `CreatedBy` / `ModifiedOn` / `ModifiedBy` | audit |

### 3.9 `PatientFilesModel` (table `PAT_PatientFiles`)

| Field | Type |
|-------|------|
| `PatientFileId` | Int64 (Key) |
| `PatientId` | int (FK) |
| `ROWGUID` | Guid |
| `FileType` | string — `"profile-pic"`, `"LabReport"`, `"DischargeSummary"`, etc. |
| `Title` | string |
| `UploadedOn` | DateTime |
| `UploadedBy` | int (employee id) |
| `Description` | string |
| `FileNo` | int — sequence within (PatientId, FileType) |
| `FileName` | string — `FileName + '_' + ticks + ext` |
| `FileExtention` | string — `.png`, `.jpg`, `.pdf` |
| `IsActive` | bool? — false for older profile pics |
| `FileBase64String` | `[NotMapped]` — payload for upload/download |
| `HasFile` | `[NotMapped]` |

### 3.10 `PatientSchemeMapModel` (table `PAT_MAP_PatientSchemes`)

| Field | Type |
|-------|------|
| `PatientSchemeId` | int (Key) |
| `PatientId` | int |
| `PatientCode` | string |
| `LatestPatientVisitId` | int |
| `SchemeId` | int — FK to `BIL_CFG_Scheme` |
| `PolicyNo` | string |
| `OpCreditLimit` / `IpCreditLimit` / `GeneralCreditLimit` | decimal |
| `PolicyHolderEmployerName` / `PolicyHolderEmployerID` | string |
| `PolicyHolderUID` | string |
| `RegistrationCase` / `RegistrationSubCase` | string |
| `LatestClaimCode` | Int64? — incremental claim code |
| `OtherInfo` | string |
| `SubSchemeId` | int? |
| `PriceCategoryId` | int — legacy column pending migration |
| `IsActive` | bool |
| `CreatedOn` / `CreatedBy` / `ModifiedOn` / `ModifiedBy` | audit |

### 3.11 `PatientMembershipModel_Depricated` (file only, model not in DB)

Historical class for the old patient-membership mapping (now replaced by `PatientSchemeMapModel`). Still exists for migration safety.

### 3.12 View Models (`PatientViewModels.cs`)

| Class | Used by |
|-------|---------|
| `PatientWithVisitInfoVM` | Returned by `SP_Billing_PatientsListWithVisitinformation`. |
| `NewPatientUniqueNumbersVM` | Returned by `PatientBL.GetPatNumberNCodeForNewPatient`. |
| `GovInsurancePatientVM` | Body of `POST /api/Patient/GovInsurancePatient` and `PUT /api/Patient/GovInsurancePatient`. Includes name, demographics, insurance, NHIS fields, audit, municipality, ethnic group. |
| `BillingOpPatientVM` | Body of `POST /api/Patient/BillingOutPatient`. Slim registration from the billing counter. |

---

## 4. Database Tables

All tables map through `PatientDbContext.OnModelCreating`. The Patient module owns and references the following tables:

| Table | Primary Key | Owning module | Relationship to Patient |
|-------|-------------|---------------|-------------------------|
| `PAT_Patient` | `PatientId` (identity) | Patient | Self |
| `PAT_PatientAddress` | `PatientAddressId` | Patient | FK `PatientId` |
| `PAT_PatientGurantorInfo` | `PatientId` (also FK) | Patient | 1:1 with Patient |
| `PAT_PatientInsuranceInfo` | `PatientInsuranceInfoId` | Patient | FK `PatientId` |
| `PAT_PatientKinOrEmergencyContacts` | `PatientKinOrEmergencyContactId` | Patient | FK `PatientId` |
| `PAT_HealthCardInfo` | `PatHealthCardId` | Patient | FK `PatientId` |
| `PAT_NeighbourhoodCardDetail` | `NeighbourhoodCardId` | Patient | FK `PatientId` |
| `PAT_PatientFiles` | `PatientFileId` (Int64) | Patient | FK `PatientId` |
| `PAT_MAP_PatientSchemes` | `PatientSchemeId` | Billing/Patient | FK `PatientId`, `SchemeId` |
| `PAT_Appointment` | `AppointmentId` | Appointment | FK `PatientId` |
| `PAT_PatientVisits` | `PatientVisitId` | Visit | FK `PatientId` |
| `ADT_PatientAdmission` | `PatientAdmissionId` | ADT | via `PatientVisitId` |
| `CLN_Allergies` | `AllergyId` | Clinical | FK `PatientId` |
| `CLN_ActiveMedicals` | `ActiveMedicalId` | Clinical | FK `PatientId` |
| `CLN_PastMedicals` | `PastMedicalId` | Clinical | FK `PatientId` |
| `CLN_SocialHistory` | `SocialHistoryId` | Clinical | FK `PatientId` |
| `CLN_HomeMedications` | `HomeMedicationId` | Clinical | FK `PatientId` |
| `CLN_MedicationPrescription` | `MedicationPrescriptionId` | Clinical | FK `PatientId` |
| `CLN_Notes` | `NoteId` | Clinical | FK `PatientId` (via patient) |
| `CLN_PatientVitals` | `VitalId` | Clinical | FK `PatientVisitId` (visit) |
| `RAD_PatientImagingReport` | `ImagingReportId` | Radiology | FK `PatientId` |
| `RAD_PatientImagingRequisition` | `ImagingRequisitionId` | Radiology | FK `PatientId` |
| `LAB_TestRequisition` | `RequisitionId` | Lab | FK `PatientId` |
| `INS_CFG_InsuranceProviders` | `InsuranceProviderId` | Insurance (master) | referenced by Insurance |
| `INS_MedicareMember` | `MemberId` | Medicare | cross-referenced |
| `INS_MedicareMemberBalance` | `MemberBalanceId` | Medicare | cross-referenced |
| `MST_Country` | `CountryId` | Master | referenced by `Patient.CountryId` |
| `MST_CountrySubDivision` | `CountrySubDivisionId` | Master | referenced by `Patient.CountrySubDivisionId`, `Address.CountrySubDivisionId` |
| `MST_Department` | `DepartmentId` | Master | referenced by Visit |
| `MST_Municipality` | `MunicipalityId` | Master | referenced by `Patient.MunicipalityId` |
| `BIL_CFG_Scheme` | `SchemeId` | Billing | referenced by `PatientSchemeMapModel.SchemeId` |
| `EMP_Employee` | `EmployeeId` | HR | referenced by `PatientFiles.UploadedBy` |
| `ADT_BedReservation` | `BedReservationId` | ADT | referenced for "BedReserved" flag |
| `ADT_TXN_PatientBedInfo` | `PatientBedInfoId` | ADT | joined for ward/bed display |
| `ADT_MST_Ward` | `WardId` | ADT | joined for ward name |
| `ADT_Bed` | `BedId` | ADT | joined for bed code |
| `ER_Patient` | `ERPatientId` | Emergency | joined for police case flag |
| `CORE_CFG_Parameters` | `ParameterId` | Core | patient uses `PatientCodeFormat`, `HospitalCode`, `PatientFileLocationPath`, `PatientProfilePicImageUploadLocation`, `DefaultCountry`, `BillItemHealthCard`, `PatientEditRestrictAfterHrs`, `ServerSideSearchComponent`, `ServerSideSearchListLength`, `MembershipSchemeSettings`, `Municipality`, `CalendarTypes` |

The patient module is **highly cross-cutting** — almost every other module's tables have a `PatientId` FK. When migrating to D1, the patient table should be created first and all other modules should reference it via `tenant_id, patient_id` (multi-tenant by design).

---

## 5. Key Workflows

### 5.1 New Patient Registration (Standard)

Flow:

1. **Front-end** — User opens `/Patient/RegisterPatient/BasicInfo`. `PatientBasicInfoComponent` loads.
2. **Form** — Angular reactive form with validators on `FirstName`, `LastName`, `Age`, `DateOfBirth`, `Gender`, `CountrySubDivisionId`, `PhoneNumber`, `Email`, etc. Optional fields: salutation (auto-fills gender: `Mr.` -> Male, otherwise Female), ethnicity, blood group, occupation, employer, country, passport, ID card, address summary, municipality, ward number, local name, posting/rank/dependent (APF), PAN.
3. **Calendar type** — Determined by `CORE_CFG_Parameters.CalendarTypes.PatientRegistration`. Supports both English and Nepali calendars (`NepaliCalendarService`).
4. **DOB vs Age** — If `IsDobVerified = true` then DOB is required, else Age is required. `CalculateDob()` uses `moment().subtract(age, 'year|month|day')` keeping current month/day (Pratik, EMR-656).
5. **Dialysis flag** — If `IsDialysis` is true, calls `GET /api/Patient/NewDialysicCode` and assigns `DialysisCode = result + 1`.
6. **Other tabs** — User optionally navigates to `Address`, `Guarantor`, `Insurance`, `KinEmergencyContact` and `ProfilePic`. Each tab uses a `CanRouteLeave` guard (`PatientDeactivateGuard`) that blocks navigation away if the form is dirty and invalid.
7. **Submit** — `PatientRegistrationMainComponent.Add()` calls `GetExistedMatchingPatientList(FirstName, LastName, PhoneNumber, Age, Gender)`.
8. **Duplicate check** — `GET /api/Patient/MatchingPatients` returns list of patients matching either:
   - exact (FirstName + LastName + Age + Gender), or
   - (PhoneNumber + Gender) with `PhoneNumber != "0"`.
9. **Duplicate warning** — `PatientDuplicateWarningBox` (client) further filters by ±3 years of age or matching phone, then displays candidates. User can `use-existing` (load the matched patient into the global and continue editing), `add-new` (proceed anyway), `update-patient` (update matched with current data), or `close`.
10. **Insert** — If no match or user proceeds, `RegisterFreshAndNewPatient` calls `PatientsBLService.PostPatient` which JSON-serializes (stripping validators) and `POST /api/Patient/PostPatient`.
11. **Server `AddPatient`** — Generates `EMPI` (16-char), sets `CreatedOn = DateTime.Now`, calls `GeneratePatientNoAndSavePatient`.
12. **`GeneratePatientNoAndSavePatient`** — Calls `PatientBL.GetPatNumberNCodeForNewPatient` to assign `PatientNo` and `PatientCode`. Catches unique-constraint violation (`SqlException.Number == 2627`) and recurses to retry. Same logic for the GovInsurance / BillingOut paths via `CreatePatientWithUniquePatientNum`.
13. **Profile picture** — If `clientPatModel.HasFile == true` and `ProfilePic != null`, calls `AddProfilePic` which writes the image to disk at `PatientProfilePicImageUploadLocation` and deactivates older profile pics.
14. **Result** — Returns `{PatientCode, PatientId}`. Client shows success message with the new hospital number and either routes to `SearchPatient` or, if initiated from an appointment, attaches the new `PatientId` to the appointment and routes to `Visit`.

### 5.2 New Government-Insurance Patient

`POST /api/Patient/GovInsurancePatient`:
1. `SaveGovInsurancePatient` deserializes `GovInsurancePatientVM`.
2. `PatientBL.GetPatientModelFromPatientVM` maps the slim VM to `PatientModel`.
3. `PatientBL.GetInsuranceModelFromInsPatientVM` maps insurance portion with `IMISCode`, `InitialBalance`, `CurrentBalance`, `InsuranceProviderId`, `InsuranceName`.
4. Inserts patient with `CreatePatientWithUniquePatientNum` (same retry logic).

`PUT /api/Patient/GovInsurancePatient` updates only `IMISCode`, `InsuranceProviderId`, `InsuranceName`, `CurrentBalance`, and Modified fields on the existing insurance record.

### 5.3 New Billing Out-Patient (Walk-in)

`POST /api/Patient/BillingOutPatient`:
1. `SaveBillingOutPatient` deserializes `BillingOpPatientVM`.
2. Maps to `PatientModel` via `PatientBL.GetPatientModelFromPatientVM` (BillingOp overload) — includes `Email`, `MunicipalityId`, `EthnicGroup`, `WardNumber`.
3. Inserts via `CreatePatientWithUniquePatientNum`.

### 5.4 Patient Edit / Update

`PUT /api/Patient/PutPatient`:
1. `UpdateNormalPatient` deserializes the full `PatientModel`.
2. Sets `ModifiedOn = DateTime.Now`.
3. Uses `RefactorThis.GraphDiff.UpdateGraph` with mappings:
   - `OwnedCollection(a => a.Addresses)`
   - `OwnedCollection(a => a.KinEmergencyContacts)`
   - `OwnedCollection(a => a.Insurances)`
   - `OwnedEntity(a => a.Guarantor)`
4. Locks these properties from being overwritten:
   - `CreatedBy`, `CreatedOn`, `PatientCode`, `PatientNo`
   - `Ins_HasInsurance`, `Ins_InsuranceBalance`, `Ins_NshiNumber`, `Ins_LatestClaimCode`
   - `IsVaccinationPatient`, `IsVaccinationActive`, `VaccinationRegNo`, `VaccinationFiscalYearId`
   - `Telmed_Patient_GUID`
   - `MotherName`
5. Returns `"patient information updated successfully."` or throws.

**Client-side restriction:** `PatientListComponent.PatientGridActions("edit")` reads core parameter `Patient.PatientEditRestrictAfterHrs` and blocks edits past N hours after `CreatedOn`.

### 5.5 Patient Search

Multiple search strategies, ordered by performance:

1. **`/api/Patient/SearchPatient?search=`** — Heavy, returns full data with country, district, municipality, latest visit, admission status, latest visit type, bed reservation, police case flag, ward/bed info. Honors `ServerSideSearchComponent.PatientSearchPatient` (default empty -> all rows; if true and search empty -> top N rows). N comes from `ServerSideSearchListLength`.
2. **`/api/Patient/SearchRegisteredPatient?search=`** — `SP_PAT_RegisteredPatientList`, capped at 200 rows.
3. **`/api/Patient/SearchPatientForNewVisit?search=&searchUsingHospitalNo=&searchUsingIdCardNo=`** — `SP_APPT_PatientListForNewVisit`. Lighter; preferred in frequent appointment flow.
4. **`/api/Patient/PatientWithVisitInfo?search=&showIpPatinet=`** — `SP_Billing_PatientsListWithVisitinformation`.
5. **`/api/Patient/IPDPatientSearch?search=`** — `SP_Billing_IpdPatientsListWithVisitinformation`.
6. **`/api/Patient/PatientByCode?patientCode=`** — Exact hospital number lookup.
7. **`/api/Patient/PatientById?patientId=`** — Full record with addresses, guarantor, insurances, kins, country subdivision, admissions (filtered to active).
8. **`/api/Patient/LightPatientById?patientId=`** — Slim projection.
9. **`/api/Patient/AdmittedPatients`** — All currently admitted patients (no search).
10. **`/api/Patient/PatientLastVisitContext?patientId=`** — `SP_PAT_GetLastVisitContextByPatientId`.
11. **`/api/Patient/GetPatientByGUID?patientGUID=`** — Telemedicine integration.
12. **`/api/Patient/MatchingPatients`** — Used during registration for EMPI duplicate check.

### 5.6 Patient History

`PatientHistoryComponent` (selector `patient-history`) is shown from the patient list. In one render it kicks off:
- `getPatientVisitList` — visits from `VisitDLService`
- `getDrugHistory` — clinical medications from `ClinicalDLService`
- `getAdmissionHistory` — admissions + bed info from `ADT_DLService`
- `getLabResult` — lab reports from `LabsDLService`
- `getImagingResult` — imaging reports from `ImagingDLService`
- `getBillingHistory` — `Reporting/PatientBillHistory?PatientCode=` returning `{paidBill, unpaidBill, returnBill, deposits, cancelBill}`; client computes total, paid, deposit balance, etc.

Tabs (controlled by `updateView(category)`):
- 0 Visits
- 1 Admissions
- 2 Drugs
- 3 Lab
- 4 Radiology
- 5 Bills
- 6 Documents (uploaded)

### 5.7 Document Upload (Patient Files)

1. User opens upload popup from patient list.
2. `PatientUploadFilesComponent.SubmitFiles` validates `FileType` (required) and checks each file size <= 10 MB (`ValidateFileSize`, 10485000 bytes).
3. Calls `PatientsBLService.AddPatientFiles` which builds a `FormData` with `uploads` and `reportDetails` (JSON-stringified `PatientFilesModel`).
4. `POST /api/Patient/PatientFiles`.
5. `UploadPatientFile`:
   - For each file: copies to `MemoryStream`, computes `FileNo = max(PatientId, FileType) + 1`, saves to `CORE_CFG_Parameters.PatientFileLocationPath + "/" + (file.FileName + '_' + ticks + ext)`, and inserts a `PAT_PatientFiles` row.
   - Wraps everything in a DB transaction; rolls back on exception.
6. List endpoint: `GET /api/Patient/PatientDocuments?patientId=` returns docs joined with employee uploader, ordered by `UploadedOn DESC`. Excludes `FileType = "profile-pic"`.
7. Download: `GET /api/Patient/DownloadFile?patientFileId=` streams the file using `FileExtensionContentTypeProvider`.

### 5.8 Profile Picture Upload

`POST /api/Patient/PatientProfilePicture` accepts JSON `{PatientId, FileBase64String, Title, Description, FileType}`.
- `AddProfilePic` decodes base64, generates filename `PatientId-YYYYMMDDHHMMSS-pp.jpg`, inserts `PAT_PatientFiles` row with `FileType = "profile-pic"` and `IsActive = true`, writes bytes to disk at `PatientProfilePicImageUploadLocation`.
- Then marks all earlier active profile pics for the same patient as `IsActive = false`.
- Returns the new `PatientFilesModel` with `FileBase64String` populated.

`GET /api/Patient/PatientProfilePicture?patientId=` reads the active `profile-pic` row, base64-encodes the file, and returns it.

### 5.9 Health Card Issuance

Two-step:
1. **Bill** the patient for "Health Card" item via billing — creates `BillingTransactionItems` row with `ItemName = "Health Card"`.
2. **Print** — `POST /api/Patient/PatientHealthCard` with body `{PatientId, InfoOnCardJSON, BillingDate}` inserts a `PAT_HealthCardInfo` row. JSON is the snapshot of the data printed on the card.

`GET /api/Patient/HealthCardStatus?patientId=` returns:
```json
{
  "BillStatus": "paid" | "unpaid" | ...,
  "PaidDate": "...",
  "BillingDate": "...",
  "IsPrinted": true | false,
  "PrintedOn": "..."
}
```

### 5.10 Neighbourhood Card

`POST /api/Patient/NeighbourhoodCard` — single endpoint. Inserts a `PAT_NeighbourhoodCardDetail` row. Used for local/neighbourhood registration card printing.

### 5.11 Insurance Provider Lookups

`GET /api/Patient/InsuranceProviders` — simple list of `{InsuranceProviderId, InsuranceProviderName}` from `INS_CFG_InsuranceProviders` (filtered `IsActive = true` implicitly — no filter currently, but the table has the column).

`GET /api/Patient/MembershipTypes` — returns active `BIL_CFG_Scheme` rows with formatted display `"{SchemeName} ({DiscountPercent} % off)"`.

### 5.12 Patient Dashboard

`PatientDashboardController` exposes 7 stored-proc-backed aggregations. All take `FromDate` and `ToDate` (and `DepartmentId` for the rank distribution one). Used by the patient module dashboard page.

---

## 6. API Endpoints (REST Routes)

All routes inherit from `CommonController` which wraps the result in `DanpheHTTPResponse<object> { Status, Results, ErrorMessage }`. Where `InvokeHttpGetFunction`/`InvokeHttpPostFunction` is used, exceptions are caught and returned as `Status: "Failed"`.

| # | Method | Route | Purpose |
|---|--------|-------|---------|
| 1 | GET | `/api/Patient/GetPatientByGUID` | Telemedicine lookup |
| 2 | GET | `/api/Patient/GetPatientCurrentSchemeMap` | Active scheme map for a visit |
| 3 | GET | `/api/Patient/GetCastEthnicGroupList` | Cast / ethnic groups |
| 4 | GET | `/api/Patient/PatientById` | Full patient record |
| 5 | GET | `/api/Patient/PatientByCode` | Lookup by hospital number |
| 6 | GET | `/api/Patient/LightPatientById` | Lightweight projection |
| 7 | GET | `/api/Patient/MatchingPatients` | EMPI-style duplicate detection |
| 8 | GET | `/api/Patient/PatientDocuments` | List uploaded documents |
| 9 | GET | `/api/Patient/PatientWithVisitInfo` | SP-backed patient + visit list |
| 10 | GET | `/api/Patient/IPDPatientSearch` | IPD-only search via SP |
| 11 | GET | `/api/Patient/PatientLastVisitContext` | Latest visit context via SP |
| 12 | GET | `/api/Patient/PatientProfilePicture` | Active profile pic as base64 |
| 13 | GET | `/api/Patient/InsuranceProviders` | List insurance providers |
| 14 | GET | `/api/Patient/NewDialysicCode` | Next dialysis code |
| 15 | GET | `/api/Patient/HealthCardStatus` | Health card bill + print status |
| 16 | GET | `/api/Patient/MembershipTypes` | Active billing schemes |
| 17 | GET | `/api/Patient/AdmittedPatients` | All currently admitted patients |
| 18 | GET | `/api/Patient/SearchPatient` | Heavy full-text patient search |
| 19 | GET | `/api/Patient/SearchRegisteredPatient` | SP-backed search (200 row cap) |
| 20 | GET | `/api/Patient/SearchPatientForNewVisit` | Lighter SP-backed search for new visit |
| 21 | GET | `/api/Patient/PatientDetailForVaccination` | Vaccination projection |
| 22 | POST | `/api/Patient/PostPatient` | Create patient (JSON) |
| 23 | POST | `/api/Patient/PatientFiles` | Upload documents (multipart) |
| 24 | POST | `/api/Patient/PatientProfilePicture` | Upload profile pic (JSON + base64) |
| 25 | POST | `/api/Patient/PatientHealthCard` | Insert health card print record |
| 26 | POST | `/api/Patient/NeighbourhoodCard` | Insert neighbourhood card record |
| 27 | POST | `/api/Patient/GovInsurancePatient` | Create government-insurance patient |
| 28 | POST | `/api/Patient/BillingOutPatient` | Walk-in OP patient |
| 29 | PUT | `/api/Patient/GovInsurancePatient` | Update gov-insurance info |
| 30 | PUT | `/api/Patient/PutPatient` | Update patient (GraphDiff) |
| 31 | GET | `/api/Patient/DownloadFile` | Download a patient file |
| 32 | GET | `/PatientDashboard/GetPatientDashboardCardSummaryCalculation` | Dashboard card summary (SP) |
| 33 | GET | `/PatientDashboard/GetPatientCountByDay` | Daily counts (SP) |
| 34 | GET | `/PatientDashboard/GetAverageTreatmentCostbyAgeGroup` | Cost by age group (SP) |
| 35 | GET | `/PatientDashboard/GetDepartmentWiseAppointment` | Appointments by dept (SP) |
| 36 | GET | `/PatientDashboard/GetPAtVisitByMembership` | Visits by membership (SP) |
| 37 | GET | `/PatientDashboard/GetPatientDistributionBasedOnRank` | By rank (SP) |
| 38 | GET | `/PatientDashboard/GetHospitalManagement` | Hospital mgmt (SP) |
| 39 | GET | `/Patient/Address` (MVC view) | Address tab view |
| 40 | GET | `/Patient/Guarantor` (MVC view) | Guarantor tab view |
| 41 | GET | `/Patient/Insurance` (MVC view) | Insurance tab view |
| 42 | GET | `/Patient/KIN` (MVC view) | KIN tab view |
| 43 | GET | `/Patient/Notes` (MVC view) | Doctors notes view |
| 44 | GET | `/Patient/Patient` (MVC view) | Patient main view |
| 45 | GET | `/Patient/PatientMain` (MVC view) | Patient module shell |
| 46 | GET | `/Patient/RegisterPatientMain` (MVC view) | Registration shell |
| 47 | GET | `/Patient/SearchPatient` (MVC view) | Search view |

The Angular frontend hits the `Patient*` endpoints from `PatientsDLService` (patients.dl.service.ts) and the dashboard endpoints from the same file.

---

## 7. Cross-Module Interactions

| Consumer | How Patient is referenced |
|----------|---------------------------|
| **Appointment** | `PAT_Appointment.PatientId` is set when an appointment is converted to a visit. The DL service `AppointmentDLService.PutAppointmentPatientId` updates this on registration-from-appointment flow. |
| **Visit** | `PAT_PatientVisits.PatientId` is required at visit creation. `PatientById` is called before visit creation; the `VisitCode` and `VisitType` are derived from the patient. |
| **Billing** | `PAT_MAP_PatientSchemes` and `PAT_PatientInsuranceInfo` carry scheme/insurance info used during billing. `PatientSchemeMapModel.LatestClaimCode` is the insurance claim code that increments on every insurance bill. The `BillingSchemeModel` (BIL_CFG_Scheme) is the membership scheme. `BillingOutPatient` path registers a patient from the billing counter without going through the appointment flow. |
| **Billing search** | `SP_Billing_PatientsListWithVisitinformation` and `SP_Billing_IpdPatientsListWithVisitinformation` join patient with latest visit and admission. |
| **ADT / Admission** | `ADT_PatientAdmission` is reached through `PAT_PatientVisits.PatientVisitId`. `PatientById` includes active `Admissions`. `AdmittedPatients` endpoint serves the ADT module. `ADT_BedReservation` and `ADT_TXN_PatientBedInfo` provide the "BedReserved" and "WardBedInfo" flags on the patient list. |
| **Lab** | `LAB_TestRequisition.PatientId`; patient required when ordering a lab. Patient list in lab uses `AdmittedPatients` endpoint. |
| **Radiology** | `RAD_PatientImagingReport.PatientId` and `RAD_PatientImagingRequisition.PatientId`; patient history shows imaging reports. |
| **Clinical** | `CLN_Allergies`, `CLN_ActiveMedicals`, `CLN_PastMedicals`, `CLN_SocialHistory`, `CLN_HomeMedications`, `CLN_MedicationPrescription`, `CLN_Notes`, `CLN_PatientVitals` (via visit) all reference PatientId. |
| **Pharmacy** | Medication prescriptions reference PatientId; Drug history in patient history uses `ClinicalDLService.GetMedicationList(patientId)`. |
| **Emergency (ER)** | `ER_Patient.IsPoliceCase` flag is joined into the patient list to show police-case status. |
| **Vaccination** | `IsVaccinationPatient`, `IsVaccinationActive`, `VaccinationRegNo`, `VaccinationFiscalYearId` are read-only flags on Patient. `VaccinationDbContext.EthnicGroupCast` is exposed through `GetCastEthnicGroupList`. `PatientDetailForVaccination` returns a vaccination-specific projection. |
| **SSU (Staff)** | `IsSSUPatient`, `SSU_IsActive`, `SSU_Information` reference patient. |
| **Telemedicine** | `Telmed_Patient_GUID` is the cross-system patient identifier. Locked from update on the server. |
| **Reports** | `Reporting/PatientBillHistory?PatientCode=` is consumed from the patient history tab. |
| **Stickers** | `PatientSticker` popup prints the patient sticker; `StickerSharedModule` is imported by `PatientsModule`. |
| **Settings** | `SettingsSharedModule` is imported by `PatientsModule` to consume master data (country, district, municipality, scheme, insurance provider, ethnic group). |
| **Security** | `AuthGuardService` gates every patient route. `ResetPatientcontextGuard` runs on `canDeactivate` to clear the global patient on navigation away. `PatientDeactivateGuard` blocks leaving address/guarantor/insurance/KIN tabs if dirty and invalid. |
| **Core** | `CoreService` provides: `Parameters` (HospitalCode, PatientCodeFormat, etc.), `Masters.Country`, `Masters.CountrySubDivision`, `Masters.Municipality`, `GetDefaultCountry()`, `GetDefaultCountrySubDivision()`, `GetIsPhoneNumberMandatory()`, `ShowMunicipality()`, `GetFieldLabelParameter()`, `GetHospitalNameForeHealthCard()`. |
| **Medicare** | `INS_MedicareMember` and `INS_MedicareMemberBalance` cross-reference; `Patient.IsMedicarePatient` flag. |

The patient module does NOT directly call other modules' endpoints; instead, it exposes patient data through lookups and lets other modules query that data. The exception is the appointment flow which calls `PutAppointmentPatientId` after registration.

---

## 8. Key Business Rules

### 8.1 EMPI Generation

Logic in `PatientBL.CreateEmpi` (16 chars, all uppercase):

```
[1-3]   : First 3 chars of CountrySubDivisionName (e.g. "KAI" for Kailali)
[4-9]   : DOB in ddMMyy format (e.g. "011290" for 01-Dec-1990)
[10-12] : First letter of FirstName + First letter of MiddleName (or "X" if empty) + First letter of LastName (or "X" if empty)
[13-16] : Random number 1000-9999
```

Example: Name "Khadka Prasad Oli", District "Kailali", DOB 01-Dec-1990 -> `KAI011290KPO8972`. Random suffix is the only non-deterministic part.

**EMPI is generated server-side** and is unique only probabilistically. The duplicate-detection `MatchingPatients` endpoint uses name + age + gender (or phone + gender) for higher reliability, not EMPI itself.

### 8.2 Patient Code / Hospital Number

Three formats controlled by `CORE_CFG_Parameters.Patient.PatientCodeFormat`:

| Format | Example | Notes |
|--------|---------|-------|
| `YYMM-PatNum` | `2506000001` | `yy` (year 2-digit) + `MM` + 6-digit zero-padded patient number |
| `HospCode-PatNum` | `HOSP1` | HospitalCode parameter + plain patient number |
| `PatNum` | `1` | Just the number |

Patient number strategy: `max(PatientNo) + 1` inside a `ReadUncommitted` transaction. Insert may fail with unique constraint; the recursive retry in `GeneratePatientNoAndSavePatient` and `CreatePatientWithUniquePatientNum` handles this.

### 8.3 DOB vs Age

- `Age` is stored as a string with format `<number><Y|M|D>` (e.g. `25Y`, `6M`, `15D`).
- Server-side: `GetDobByAge(int age)` returns `new DateTime(Year - age, 1, 1)` — Jan 1 of the year.
- Client-side: `PatientService.CalculateDOB(age, ageUnit)`:
  - Years: `moment({month: curMonth, day: curDay}).subtract(age, 'year')`
  - Months: `moment({day: curDay}).subtract(age, 'months')`
  - Days: `moment().subtract(age, 'days')`
- `IsDobVerified` controls which one is required by the form. When `false`, `Age` is required; when `true`, `DateOfBirth` is required.
- `dateValidators`: blocks future dates and dates more than 200 years in the past.

### 8.4 Phone Number

- `PhoneNumber` is `^[0-9]{1,10}$` by default.
- Made optional via `coreService.GetIsPhoneNumberMandatory()` (controlled by parameter; off in some hospitals).
- Duplicate detection matches by phone even when name+age+gender don't all match, as long as phone is not "0".

### 8.5 Edit Restriction Window

`CORE_CFG_Parameters.Patient.PatientEditRestrictAfterHrs` — integer hours. If set, edits to a patient are blocked past this many hours after `CreatedOn`. `0` or unset disables the check.

### 8.6 Audit Locking

`UpdateNormalPatient` (PUT `/api/Patient/PutPatient`) hard-locks these fields with `Property(...).IsModified = false`:
- `CreatedBy`, `CreatedOn`, `PatientCode`, `PatientNo`
- `Ins_HasInsurance`, `Ins_InsuranceBalance`, `Ins_NshiNumber`, `Ins_LatestClaimCode`
- `IsVaccinationPatient`, `IsVaccinationActive`, `VaccinationRegNo`, `VaccinationFiscalYearId`
- `Telmed_Patient_GUID`
- `MotherName`

This means you cannot accidentally "reset" the hospital number, lose the audit trail, break insurance linkage, or lose the telemedicine GUID when editing a patient.

### 8.7 Server-Side Search Toggle

`CORE_CFG_Parameters.Common.ServerSideSearchComponent.PatientSearchPatient` — boolean. When `true` and the search text is empty, only the first N rows are returned where N comes from `ServerSideSearchListLength`. When `false` or unset, all patients are returned.

### 8.8 Phone Number Mandatory Toggle

`CORE_CFG_Parameters` controls whether `PhoneNumber` is required (see `GetIsPhoneNumberMandatory()`). Affects `phoneNumberMandatory()` in basic-info component.

### 8.9 File Upload Limits

- Max file size: 10 MB per file (10485000 bytes — `ValidateFileSize` in client).
- Max request size: `DisableRequestSizeLimit` applied to the `DownloadFile` endpoint (allows large file streaming).
- Files are stored on disk at `CORE_CFG_Parameters.Patient.PatientFileLocationPath`.
- Profile pics stored at `CORE_CFG_Parameters.Patient.PatientProfilePicImageUploadLocation`.
- Filename pattern: `OriginalName + '_' + ticks + extension`.
- `FileNo` is per-(PatientId, FileType), so each file type has its own sequence.
- `PAT_PatientFiles` uses `Int64` PK for high-volume use.

### 8.10 Insurance Update Restriction

`UpdateGovInsurancePatient` only allows updating `IMISCode`, `InsuranceProviderId`, `InsuranceName`, `CurrentBalance`, and audit fields. `InitialBalance` is set at creation only (matches accounting practice).

### 8.11 Address Type Uniqueness

The client (`AddressComponent.AddAddress`) blocks adding a second address of the same `AddressType`. The user must edit or remove the existing one.

### 8.12 Country Default

`GetCountryParameter()` reads `CORE_CFG_Parameters.DefaultCountry.ParameterValue` (JSON `{"CountryId": N}`) and uses that as the default country for new registrations.

### 8.13 District Default

`GetDefaultCountrySubDivision()` from `CoreService` returns the default district for new registrations. Used in `LoadCountryDefaultSubDivision()` in basic-info.

### 8.14 Salutation → Gender

`OnSelectSalutation()` in basic-info: `Mr.` -> `Male`, anything else -> `Female`. This is a hard-coded mapping; the user can override the gender.

### 8.15 Audit Logging

`PatientModel` and `AddressModel` are decorated with `[AuditInclude]`. The `PatientDbContext` extends `AuditDbContext` (Audit.NET). Every insert/update/delete is recorded in the audit log tables.

### 8.16 Nepali Calendar Support

`NepaliCalendarService` provides `ConvertNepToEngDate`, `ConvertEngToNepDate`, `GetTodaysNepDate`. The active calendar type comes from `CORE_CFG_Parameters.CalendarTypes.PatientRegistration`. The basic-info tab shows both calendars side by side.

### 8.17 Ethnic Group / Caste

`GetCastEthnicGroupList` returns from `VaccinationDbContext.EthnicGroupCast` — this means the cast/ethnic group master is in the vaccination database (legacy). Migration: this should be moved to a core/master table.

### 8.18 APF Hospital Extension

Fields `Posting`, `Rank`, `DependentId` plus `DependentId`-related client logic (`listOfPatientIdsUsingSameDependentId`, `APFPatientDependentIdCount`, `IsDependentIdEditAble`) are specific to APF (Armed Police Force) Hospital in Nepal. General hospitals can ignore these.

### 8.19 Patient Membership vs Scheme

The reference code shows a migration:
- Old: `PatientMembershipTypeId` + `BIL_Membership_*` tables
- Current: `PatientSchemeMapModel` + `BIL_CFG_Scheme.SchemeId` + `BIL_CFG_PriceCategory.PriceCategoryId`
- `PatientMembershipModel_Depricated.cs` exists for backward compatibility.
- The legacy `MembershipTypeId`, `MembershipTypeName`, `MembershipDiscountPercent` are commented out in `PatientModel` and `PatientsMainComponent` (see `LoadMembershipSettings` and the `IsValidMembershipTypeName` flag).

### 8.20 Telemedicine GUID Locking

`Telmed_Patient_GUID` is set by the external telemedicine system and **must not** be overwritten by the in-app patient edit. The server-side `UpdateNormalPatient` explicitly locks it.

---

## 9. Frontend Structure (`/app/patients`)

### 9.1 Module & Routing

`PatientsModule` (patients.module.ts) imports:
- `SharedModule`, `PatientSharedModule`, `SettingsSharedModule`, `StickerSharedModule`
- `DanpheAutoCompleteModule`, `QRCodeModule`
- `ReactiveFormsModule`, `FormsModule`, `CommonModule`, `HttpClientModule`, `RouterModule.forChild(PatientsRoutingConstant)`

Routes (`patients-routing.constant.ts`):

```
'' -> PatientsMainComponent (default)
'Dashboard' -> PatientsDashboardComponent
'SearchPatient' -> PatientListComponent
'RegisterPatient' -> PatientRegistrationMainComponent
  '' -> BasicInfo
  'BasicInfo' -> PatientBasicInfoComponent
  'Address' -> AddressComponent (canDeactivate: PatientDeactivateGuard)
  'Guarantor' -> GuarantorComponent (canDeactivate: PatientDeactivateGuard)
  'Insurance' -> InsuranceInfoComponent (canDeactivate: PatientDeactivateGuard)
  'KinEmergencyContact' -> KinEmergencyContactComponent (canDeactivate: PatientDeactivateGuard)
  'ProfilePic' -> PatientProfilePicComponent
```

### 9.2 Service Layer

- `PatientsDLService` (data layer) — wraps HttpClient calls to `/api/Patient/*` and `/PatientDashboard/*` endpoints.
- `PatientsBLService` (business layer) — orchestrates calls, strips Angular form validators before serializing, builds `FormData` for uploads. Depends on `AppointmentDLService`, `VisitDLService`, `LabsDLService`, `ImagingDLService`, `ClinicalDLService`, `ADT_DLService`.
- `PatientService` (singleton in-memory state) — holds the global `Patient` object, calculates DOB from age, separates age/ageUnit, sets the global patient from a server response (used when navigating between tabs and when re-using an existing matched patient).
- `PatientDeactivateGuard` — implements `CanDeactivate`; blocks navigation away from address/guarantor/insurance/KIN tabs if the form is dirty and invalid.

### 9.3 Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `PatientsMainComponent` | `patients-main.component.ts` | Shell with primary/secondary nav derived from `SecurityService.GetChildRoutes("Patient")`. |
| `PatientListComponent` | `patient-list/patient-list.component.ts` | Ag-grid patient list with quick filter, action buttons: appoint / edit / showHistory / uploadfiles / showHealthCard / showNeighbourCard / showPatientSticker. Reads `PatientEditRestrictAfterHrs` for edit restriction. |
| `PatientRegistrationMainComponent` | `registration/patient-registration-main.component.ts` | Wizard shell. Validates form, calls `GetExistedMatchingPatientList` for duplicate check, then `PostPatient`. Routes to appointment flow if registration initiated from there. |
| `PatientBasicInfoComponent` | `registration/basic-info/patient-basic-info.component.ts` | Form for demographics, with calendar (Nepali/Eng), salutation -> gender auto-fill, dialysis code assignment, municipality, age/DOB interplay. Implements `IRouteGuard` `CanRouteLeave`. |
| `AddressComponent` | `registration/address/address.component.ts` | List + add/edit/delete of address entries; blocks duplicate `AddressType`. |
| `GuarantorComponent` | `registration/guarantor/guarantor.component.ts` | Single guarantor entry (1:1 with patient). |
| `InsuranceInfoComponent` | `registration/insurance/insurance-info.component.ts` | Insurance details with provider lookup, IMIS code, subscriber info, balances. |
| `KinEmergencyContactComponent` | `registration/kin/kin-emergency-contact.component.ts` | Multiple kin entries. |
| `PatientProfilePicComponent` | `profile-pic/profile-pic.component.ts` | Profile picture capture/upload. |
| `PatientHistoryComponent` | `patient-history/patient-hisotry.component.ts` | Tabbed history (Visits, Admissions, Drugs, Lab, Radiology, Bills, Documents). Aggregates from 6 different DL services. |
| `PatientHealthCardComponent` / `HamsPatientHealthCardComponent` | `health-card/` | Print health card. |
| `PatientNeighbourCardComponent` | `neighbour-card/` | Print neighbourhood card. |
| `PatientUploadFilesComponent` | `patient-upload-files/` | Document upload + list + lightbox. |
| `PatientDuplicateWarningBox` | `duplicate-warning/` | Selector `patient-duplicate-warning-box`; emits actions `use-existing`, `add-new`, `update-patient`, `close`. |

### 9.4 Client-Side Models (TypeScript)

All mirror the C# models in name, casing, and intent. Notable:
- `patient.model.ts` — `Patient` class with a `PatientValidator: FormGroup` and validation helpers (`IsValid`, `IsValidCheck`, `EnableControl`, `GetClone`).
- `address.model.ts`, `guarantor.model.ts`, `insurance-info.model.ts`, `kin-emergency-contact.model.ts`, `health-card.model.ts`, `neighbourhood-card.model.ts`, `patient-files.model.ts`, `membership-type.model.ts`, `ethnic-group.model.ts`, `insurance-provider.model.ts`, `patient.view-models.ts`.

### 9.5 Grid Configuration

`GridColumnSettings.PatientSearch` (in shared/grid-column-settings.constant) defines the columns for the patient list grid. `APIsByType.PatByName` (in shared/search.service) is the API URL for grid data.

---

## 10. Migration Notes (Danphe → HMS / Cloudflare)

When porting to Hono + D1:

1. **Schema first** — Create `patients`, `patient_addresses`, `patient_insurance_info`, `patient_kin_emergency_contacts`, `patient_guarantors`, `patient_files`, `patient_scheme_map`, `health_card_info`, `neighbourhood_card`, plus required FK tables (`countries`, `country_subdivisions`, `municipalities`, `schemes`, `insurance_providers`).

2. **EMPI** — Keep the 16-char deterministic algorithm in the patient service. Move random suffix to a `crypto.randomInt(1000, 10000)` equivalent.

3. **PatientNo/Code** — Replace the `ReadUncommitted` transaction with D1's single-statement insert + retry pattern. The retry loop on `2627` becomes a retry on SQLite `UNIQUE constraint failed`.

4. **File storage** — Use Cloudflare R2. `PatientFileLocationPath` becomes an R2 bucket name + key prefix. `PatientProfilePicImageUploadLocation` becomes a separate prefix (e.g. `profile-pics/`). Stream via signed URLs instead of `File.WriteAllBytes`.

5. **Audit** — `Audit.NET` is overkill for D1; replace with explicit `audit_log` table writes on each mutation.

6. **Stored procedures** — Convert to D1 SQL views or to application-level joins. The dashboard endpoints (`SP_Dashboard_PAT_*`) are the most SP-heavy.

7. **GraphDiff** — Use explicit nested writes: upsert patient row, then upsert owned collections (addresses, kins, insurances, guarantor). The "lock" pattern translates to: only update columns that are not in the locked list.

8. **RBAC** — The reference uses `[DanpheViewFilter(...)]` for Razor views and `AuthGuardService` for Angular routes. In our HMS, the Hono middleware + Angular guards already do this; map permission codes accordingly.

9. **Multi-tenancy** — Every patient table needs `tenant_id`. The reference code is single-tenant; our HMS must add the column to every patient-related table.

10. **i18n** — The reference has English + Nepali (calendar) support. Our HMS already has English + Bengali; consider whether to add Nepali as well given the reference target market.

11. **APF-specific fields** — `Posting`, `Rank`, `DependentId` can be deferred or omitted in initial migration.

12. **Membership vs Scheme** — Our HMS already uses `schemes` table; map `PatientSchemeMapModel` to it directly. Skip the legacy `PatientMembershipTypeId` migration.

---

## 11. File Index

### Backend (`Code/Websites/DanpheEMR/` and `Code/Components/`)

```
Controllers/Patient/
  PatientController.cs                   (2394 lines — main REST API)
  PatientBL.cs                           (277 lines — EMPI, PatientNo/Code, VM mapping)
  PatientDashboardController.cs          (172 lines — 7 dashboard endpoints)
  PatientViewController.cs               (145 lines — MVC view routes)

Components/DanpheEMR.ServerModel/PatientModels/
  PatientModel.cs                        (170 lines — main entity)
  AddressModel.cs                        (35 lines)
  GuarantorModel.cs                      (33 lines)
  InsuranceModel.cs                      (63 lines — also has InsuranceBillingTransactionPostVM)
  InsuranceProviderModel.cs              (21 lines)
  KinModel.cs                            (25 lines)
  HealthCardInfoModel.cs                 (20 lines)
  NeighbourhoodCardModel.cs              (21 lines)
  PatientFilesModel.cs                   (36 lines)
  PatientSchemeMapModel.cs               (35 lines)
  PatientMembershipModel_Depricated.cs   (29 lines — legacy)
  PatientViewModels.cs                   (132 lines — VM classes)

Components/DanpheEMR.DalLayer/PatientDbContext.cs
  PatientDbContext                       (193 lines — DbSet declarations, OnModelCreating mappings)
```

### Frontend (`Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/patients/`)

```
patients.module.ts
patients-routing.constant.ts
patients-main.component.ts
patient-shared.module.ts

patient-list/
  patient-list.component.ts              (265 lines)

registration/
  patient-registration-main.component.ts (436 lines)
  basic-info/patient-basic-info.component.ts (439 lines)
  address/address.component.ts           (216 lines)
  guarantor/guarantor.component.ts       (167 lines)
  insurance/insurance-info.component.ts  (170 lines)
  kin/kin-emergency-contact.component.ts (117 lines)

profile-pic/profile-pic.component.ts
patient-history/patient-hisotry.component.ts (260 lines)
patient-upload-files/patient-upload-files.component.ts (338 lines)
duplicate-warning/patient-duplicate-warning-box.component.ts (102 lines)
health-card/patient-health-card.component.ts
neighbour-card/patient-neighbour-card.component.ts

shared/
  patient.service.ts                     (154 lines — global state, DOB calc)
  patients.dl.service.ts                 (227 lines — HTTP layer)
  patients.bl.service.ts                 (288 lines — business layer)
  patient.model.ts                       (382 lines — main client model)
  patient.view-models.ts                 (49 lines)
  patient-files.model.ts, address.model.ts, guarantor.model.ts,
  insurance-info.model.ts, kin-emergency-contact.model.ts,
  health-card.model.ts, neighbourhood-card.model.ts,
  insurance-provider.model.ts, ethnic-group.model.ts,
  membership-type.model.ts
  patient-deactivate-guard.ts
```

---

## 12. Quick Reference: Common Tasks

| Task | Endpoint | Notes |
|------|----------|-------|
| Register a new patient | `POST /api/Patient/PostPatient` | Body: `PatientModel` JSON (no validators). Returns `{PatientId, PatientCode}`. |
| Register from billing counter | `POST /api/Patient/BillingOutPatient` | Body: `BillingOpPatientVM`. |
| Register with insurance | `POST /api/Patient/GovInsurancePatient` | Body: `GovInsurancePatientVM`. |
| Edit patient | `PUT /api/Patient/PutPatient?patientId=` | Body: full `PatientModel` JSON. |
| Update insurance only | `PUT /api/Patient/GovInsurancePatient` | Body: `GovInsurancePatientVM` with existing `PatientId`. |
| Quick search | `GET /api/Patient/SearchPatientForNewVisit?search=` | Lighter; preferred in new-visit flow. |
| Full search | `GET /api/Patient/SearchPatient?search=` | Heavy; honors server-side toggle. |
| Patient details | `GET /api/Patient/PatientById?patientId=` | Includes addresses, guarantor, insurances, kins, admissions. |
| Hospital number lookup | `GET /api/Patient/PatientByCode?patientCode=` | |
| Light projection | `GET /api/Patient/LightPatientById?patientId=` | |
| Duplicate check during registration | `GET /api/Patient/MatchingPatients?FirstName=&LastName=&Age=&Gender=&PhoneNumber=` | |
| Upload document | `POST /api/Patient/PatientFiles` | multipart, fields `uploads` + `reportDetails`. |
| Upload profile pic | `POST /api/Patient/PatientProfilePicture` | JSON `{PatientId, FileBase64String, Title, Description, FileType}`. |
| List patient documents | `GET /api/Patient/PatientDocuments?patientId=` | Excludes profile pic. |
| Download file | `GET /api/Patient/DownloadFile?patientFileId=` | |
| Print health card | `POST /api/Patient/PatientHealthCard` | Body: `HealthCardInfoModel`. |
| Check health card status | `GET /api/Patient/HealthCardStatus?patientId=` | Returns bill + print state. |
| Print neighbourhood card | `POST /api/Patient/NeighbourhoodCard` | |
| Get insurance providers | `GET /api/Patient/InsuranceProviders` | |
| Get membership types | `GET /api/Patient/MembershipTypes` | |
| Get ethnic group / cast | `GET /api/Patient/GetCastEthnicGroupList` | |
| Get admitted patients | `GET /api/Patient/AdmittedPatients` | |
| Get last visit context | `GET /api/Patient/PatientLastVisitContext?patientId=` | |
| Get patient by GUID | `GET /api/Patient/GetPatientByGUID?patientGUID=` | Telemedicine. |
| Get active scheme for visit | `GET /api/Patient/GetPatientCurrentSchemeMap?patientId=&patientVisitId=` | |
| Get dialysis code | `GET /api/Patient/NewDialysicCode` | max + 1. |
| Vaccination detail | `GET /api/Patient/PatientDetailForVaccination?patientId=` | |
| Dashboard summary | `GET /PatientDashboard/GetPatientDashboardCardSummaryCalculation?FromDate=&ToDate=` | + 6 more `Get*` SP-backed endpoints. |

---

End of Patient module reference.

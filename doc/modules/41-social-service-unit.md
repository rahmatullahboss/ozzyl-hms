# Social Service Unit (SSU) Module

## 1. Module Overview

The **Social Service Unit (SSU)** module manages the registration and ongoing care of patients who are entitled to **free or subsidized treatment** through government-mandated social service schemes. In the DanpheEMR reference, two closely-related concepts live under the SSU umbrella:

1. **SSU (in-hospital charity care)** – patients flagged as `IsSSUPatient` whose treatment costs are waived or discounted at the point of service because they belong to a vulnerable "Target Group" (poor/ultra-poor, helpless, disabled, senior citizens, victims of gender violence, FCHVs, etc.). Target group membership, certificate details, income source and family financial status are captured in `PAT_SSU_Information` and the patient is auto-mapped to a default "SSU" membership (scheme id `11`) and one of the SSU billing price categories.

2. **SSF (Social Security Fund – Nepal government)** – an external insurance/benefits scheme that DanpheEMR integrates with over FHIR-style REST APIs (`CoverageEligibilityRequest`, `Claim`, `BookingService`, `Employee`, `Patient`). When a patient is registered under a "SSF-Medical" or "SSF-Accidental" scheme, DanpheEMR queries the SSF server for eligibility (medical and accident balances) and books/submits claims against the SSF server in real time during billing.

Together these two flows form the **charity / subsidy registration, approval, and SSU/SSF billing** capability of DanpheEMR.

The module is responsible for:

- Maintaining a registry of free/subsidized-treatment patients with full demographic and socio-economic context.
- Capturing and persisting Target-Group, certificate, income-source and family-financial-status data on `PAT_SSU_Information`.
- Auto-mapping SSU patients to a hospital-defined membership scheme and to a billing price category via the `SSUMembershipTargetGroupMapping` core parameter.
- Allowing activation / de-activation of SSU status without losing the underlying patient record (`SSU_IsActive` toggle on `PAT_Patient`).
- Integrating with the Nepal SSF server: patient detail lookup, eligibility check (OP/IP balance, allowed/used money), claim submission and claim booking; persisting all request/response payloads for audit.
- Exposing a minimal Angular SPA for registration, search, edit, activate/deactivate and listing of SSU patients.

The SSU module is tightly coupled with the **Patient**, **Billing**, **Appointment/Visit**, **ADT**, **Pharmacy** and **Insurance** modules. The SSF integration also depends on the external Nepal SSF FHIR endpoint configured in `CORE_CFG_Parameters`.

---

## 2. Backend Files

### 2.1 SSU (charity care) — Backend

| File | Purpose |
| --- | --- |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/SocialServiceUnit/SocialServiceUnitController.cs` (524 lines) | Main REST controller. Five endpoints covering SSU patient list, search, registration, edit and activate/deactivate. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/SocialServiceUnit/SsuPatientBL.cs` (74 lines) | Static business-logic helper that produces a unique `PatientNo` and a formatted `PatientCode` (configurable via `PatientCodeFormat` core parameter) for newly registered SSU patients. Recursively retries on unique-constraint violation (`SqlException.Number == 2627`). |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SocialServiceUnit/SSU_InformationModel.cs` (30 lines) | Entity model for `PAT_SSU_Information` (target group, certificate, income, family financial status, audit fields). |
| `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/SocialServiceUnitDbContext.cs` (53 lines) | `DbContext` exposing `PAT_Patient`, `PAT_SSU_Information`, `MST_Country`, `MST_CountrySubDivision`, `PAT_PatientVisits`, `ADT_PatientAdmission`, `ADT_BedReservation`, `ADT_TXN_PatientBedInfo`, `ADT_MST_Ward`, `ADT_Bed`, `ER_Patient`, `BIL_CFG_Scheme`, `MST_Municipality`. |

### 2.2 SSF (Nepal Social Security Fund) — Backend

| File | Purpose |
| --- | --- |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/SSF/SSFController.cs` (229 lines) | REST controller exposing nine SSF integration endpoints. All actions delegate to `ISSFService`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Services/SSF/ISSFService.cs` (27 lines) | Service interface: `GetPatientDetails`, `GetElegibility`, `GetEmployerList`, `SubmitClaim`, `BookClaim`, `GetClaimDetail`, `GetClaimBookingDetail`, `IsClaimed`, `GetSSFPatientDetailLocally`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Services/SSF/SSFService.cs` (736 lines) | Service implementation. Handles HTTP Basic + custom `SSFRemotekey` auth, calls FHIR-style endpoints on the external SSF server, parses eligibility responses into Medical / Accident buckets and writes all booking/submission audit data into `PAT_SSFClaimResponseDetails` and `PAT_SSF_ClaimBooking`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Services/SSF/DTO/ClaimBooking_DTO.cs` (33 lines) | `ClaimBookingRoot_DTO` (request body for booking), `ClaimBooking_DTO` (per-invoice wrapper), `ClaimBookingResponse`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Services/SSF/DTO/ClaimBookingResponse_DTO.cs` (29 lines) | Parses the FHIR-style `ClaimBookingResponseRoot` containing Medical/Accident buckets. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Services/SSF/DTO/SSF_ClaimBookingService_DTO.cs` (42 lines) | DTO that maps a billing invoice + patient scheme to the SSF claim booking payload (`GetMappedToBookClaim` helper). |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/PAT_SSFClaimResponseDetails.cs` (30 lines) | `PAT_SSFClaimResponseDetails` entity (per claim attempt). |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/SSFClaimBookingModel.cs` (26 lines) | `PAT_SSF_ClaimBooking` entity (per booked claim). |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/SSFCredentials.cs` (17 lines) | `SSFCredentials` POCO (`SSFurl`, `SSFRemotekey`, `SSFRemoteValue`, `SSFUsername`, `SSFPassword`). |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/SSFPatientDetail.cs` (24 lines) | `SSFPatientDetails` POCO (address, birthdate, gender, name, family, image, UUID, employer list). |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/SSFPatientEligibility.cs` (84 lines) | `EligibilityRequest`, `EligibilityResponse`, `EligibilityRoot`, `EligibilityInsurance`, `EligibilityItem`, `EligibilityBenefit` etc. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/SSFClaim.cs` (204 lines) | `ClaimRoot` (FHIR-style), `ClaimItem`, `ClaimDiagnosis`, `ClaimExtension`, `ClaimTotal`, `SSFClaimResponseInfo`, `SSFClaimSubmissionOutput`, `ErrorRoot`. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/SSFClaimResponse.cs` (144 lines) | `SSFClaimResponse` (FHIR ClaimResponse), `Adjudication`, `Item`, `Total`. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/SSFResponse.cs` (130 lines) | `Root`, `Entry`, `Resource`, `Name`, `Photo`, `Telecom`, `EmployerRoot`, `Company`, `Family`. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/SSFModels/SSF.cs` (212 lines) | Lower-level FHIR primitives (`Coding`, `Identifier`, `Extension`, `Item`, `Coverage`, `BillablePeriod`, `Total`, `ClaimBooking`). |
| `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/SSFDbContext.cs` (35 lines) | `DbContext` for SSF — `CORE_CFG_Parameters`, `PAT_SSFClaimResponseDetails`, `PAT_MAP_PatientSchemes`, `PAT_PatientVisits`, `PAT_SSF_ClaimBooking`. |
| `DanpheEMR reference/Code/Components/DanpheEMR.Sync/SSF/APIs.cs` | Internal sync helper used by `BillingBL.SyncToSSFServer` for claim booking. |
| `DanpheEMR reference/Code/Components/DanpheEMR.Sync/SSF/SSF_ClaimBookingViewModel.cs` | Internal view-model used during real-time SSF booking. |

### 2.3 Key Static Helpers on `SsuPatientBL`

| Method | Purpose |
| --- | --- |
| `GetPatNumberNCodeForNewPatient(connString)` | Reads `Max(Patient.PatientNo) + 1` and produces the next sequential `PatientNo` and formatted `PatientCode` based on the `PatientCodeFormat` core parameter (`YYMM-PatNum`, `HospCode-PatNum` or `PatNum`) and the `HospitalCode` parameter. |

### 2.4 Key Methods on `ISSFService`

| Method | HTTP Equivalent | Purpose |
| --- | --- | --- |
| `GetPatientDetails(ssfDbContext, patientNo)` | `GET /api/SSF/GetSSFPatientData?PatientId=` | Calls SSF `Patient/?identifier={patientNo}`; returns address, DOB, gender, UUID, photo (Base64) and employer list. |
| `GetElegibility(ssfDbContext, patientNo, visitDate)` | `GET/POST /api/SSF/CheckSSFEligibility` | Posts a `CoverageEligibilityRequest`; parses the `insurance[]` array by configurable `SsfSearchStringForSchemeNames` (Medical / Accident) and returns OP/IP balance + allowed/used money. |
| `GetEmployerList(ssfDbContext, ssfPatientUUID)` | `GET /api/SSF/GetEmployerList?SSFPatientUUID=` | Calls SSF `Employee/{uuid}/` and returns nested `List<List<Company>>`. |
| `SubmitClaim(ssfDbContext, claimRoot, responseInfo)` | `POST /api/SSF/SubmitClaim` | Posts the `Claim` payload to SSF; writes `PAT_SSFClaimResponseDetails` (new or updated with `ClaimCount++`); flips `IsClaimed = true` on the corresponding booking rows. |
| `BookClaim(ssfDbContext, claimBooking, currentUser)` | `POST /api/SSF/BookClaim` | Posts the `BookingService` payload; on success/failure writes `PAT_SSF_ClaimBooking` (new row or re-book with `ReBookedBy`/`ReBookingDate`). |
| `GetClaimDetail(ssfDbContext, ClaimUUID)` | `GET /api/SSF/GetClaimDetail?ClaimUUID=` | Proxies the SSF `Claim/{uuid}/` endpoint. |
| `GetClaimBookingDetail(ssfDbContext, claimCode)` | `GET /api/SSF/GetClaimBookingDetail?claimCode=` | Returns local booking rows (`IsActive=true && IsClaimed=false`) for a given `LatestClaimCode`. |
| `IsClaimed(ssfDbContext, claimCode, patientId)` | `GET /api/SSF/CheckClaimStatusLocally` | Local-only check (does not hit SSF). Returns `true` when a `PAT_SSFClaimResponseDetails` row exists with `ResponseStatus=true` for the given claim+patient. |
| `GetSSFPatientDetailLocally(ssfDbContext, patientId, schemeId)` | `GET /api/SSF/GetSSFPatientDetailLocally` | Returns the `PAT_MAP_PatientSchemes` row (OP/IP credit limits, latest claim code, registration case, etc.). |
| `GetSSFCredentials(ssfDbContext)` (internal) | — | Reads SSF connection details from `CORE_CFG_Parameters` (`ParameterGroupName='SSF'`, `ParameterName='SSFConfiguration'`, JSON keys: `SSFurl`, `SSFUsername`, `SSFPassword`, `SSFRemotekey`, `SSFRemoteValue`). |
| `GetCoreParameterValueByKeyName_String(...)` (static) | — | Parses a JSON-valued core parameter and returns the value of the named key. |

### 2.5 SSF / SSU Constants and Enums

| Constant / Enum | Defined In | Values |
| --- | --- | --- |
| `ENUM_SSF_EligibilityType` | `wwwroot/DanpheApp/src/app/shared/shared-enums.ts:182` | `Medical`, `Accident` |
| `ENUM_SSFSchemeTypeSubProduct` | `shared-enums.ts:210` | `MedicalExpenses_IP=1`, `MedicalExpenses_OP=2`, `MaternityExpenses_IP=3`, `MaternityExpenses_OP=4`, `MedicalExpensesNewlyBornChild_IP=5`, `MedicalExpensesNewlyBornChild_OP=6`, `OccupationalDisease_MedicalExpense=10`, `OccupationalDisease_TemporaryTotalDisability=11`, `OccupationalDisease_PermanentDisability=12`, `OccupationalDisease_TotalPermanentDisability=13`, `EmploymentRelatedAccident_MedicalExpenses=14`, `EmploymentRelatedAccident_TemporaryTotalDisability=15`, `EmploymentRelatedAccident_PermanentDisability=16`, `EmploymentRelatedAccident_TotalPermanentDisability=17`, `OtherAccident_ExceptEmploymentRelated=18` |
| `ENUM_DanpheSSFSchemes` | `shared-enums.ts:472` | `Medical="SSF-Medical"`, `Accidental_Work="SSF-Accidental-Work Related"`, `Accidental_Non_Work="SSF-Accidental-Non Work Related"` |
| `ENUM_SSF_BookingStatus` | `shared-enums.ts:622` | `Booked`, `NotBooked` |
| `ENUM_RegistrationSubCases` | `shared-enums.ts:187` | `NonWorkRelated="non work related"`, `WorkRelated="work related"` |
| `ENUM_SSF_ApiEndPoints.BookingService` | server-side | Constant used in `SSFService.BookClaim` |
| `ENUM_SSF_SchemeTypes` | server-side | `Accident`, `Medical` — used in `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` to pick the scheme string. |
| Core parameter `SSUMembershipTargetGroupMapping` | `CORE_CFG_Parameters` | JSON array: `[{ TargetGroupId, MembershipId }, ...]` — maps each SSU target group to its billing `MembershipTypeId`. |
| Core parameter `SSF` / `SSFConfiguration` | `CORE_CFG_Parameters` | JSON object: `{ SSFurl, SSFUsername, SSFPassword, SSFRemotekey, SSFRemoteValue }`. |
| Core parameter `SSF` / `SsfSearchStringForSchemeNames` | `CORE_CFG_Parameters` | JSON object: `{ Medical: "<substr>", Accidental: "<substr>" }` — used to identify Medical vs Accident insurance buckets in the eligibility response. |

---

## 3. Data Models

### 3.1 `SSU_InformationModel` (PAT_SSU_Information)

Defined in `DanpheEMR.ServerModel/SocialServiceUnit/SSU_InformationModel.cs`.

| Field | Type | Notes |
| --- | --- | --- |
| `SSU_InfoId` | int (PK, `[Key]`) | Surrogate key. |
| `PatientId` | int | FK to `PAT_Patient.PatientId`. |
| `TargetGroupId` | int | Lookup id (1–6) — see `TargetGroup` below. |
| `TargetGroup` | string | Display name: `Poor/Ultra Poor`, `Helpless`, `Disability`, `Senior Citizen`, `Victim of Gender Violence`, `FCHV`. |
| `TG_CertificateType` | string | Free-text certificate type. Auto-populated client-side as `"<TargetGroup> Certificate"`. |
| `TG_CertificateNo` | string | Free-text certificate number. |
| `IncomeSource` | string | One of: `Unskilled Labour in Agriculture or Other`, `Skilled Labour in Agriculture or Other`, `Agriculture/Farming`, `Private Sector/Government Sector`, `Foreign employment in Malaysia or UAE`, `Others`. If `Others`, free text is captured in a separate client-side field. |
| `PatFamilyFinancialStatus` | string | Free-text family financial status note. |
| `CreatedBy` / `CreatedOn` | int? / DateTime? | Standard audit. |
| `ModifiedBy` / `ModifiedOn` | int? / DateTime? | Standard audit. |

### 3.2 `PatientModel` (SSU-related fields)

Defined in `DanpheEMR.ServerModel/PatientModels/PatientModel.cs`. The following fields are added for SSU support (lines 149-157, 165):

| Field | Type | Notes |
| --- | --- | --- |
| `IsSSUPatient` | bool | DB column. `true` when the patient is registered for SSU/charity care. |
| `SSU_IsActive` | bool | DB column. Toggled by `put-activate-deactivate-ssu-patient`. |
| `SSU_Information` | `SSU_InformationModel` (`[NotMapped]`) | Navigation / payload wrapper. Loaded with the patient in list/search endpoints. |
| `PatientScheme` | `PatientSchemeMapModel` (`[NotMapped]`) | Holds the active scheme (SSF-Medical / SSF-Accidental / Medicare / General) and OP/IP credit limits. |

### 3.3 `PatientSchemeMapModel` (PAT_MAP_PatientSchemes)

Defined in `DanpheEMR.ServerModel/PatientModels/PatientSchemeMapModel.cs`. Used to attach a patient to a scheme (SSF, SSU, Medicare, etc.) with credit limits and latest claim code.

| Field | Type | Notes |
| --- | --- | --- |
| `PatientSchemeId` | int (PK) | |
| `PatientId` | int | |
| `PatientCode` | string | |
| `LatestPatientVisitId` | int | |
| `SchemeId` | int | FK to `BIL_CFG_Scheme`. |
| `PolicyNo` | string | SSF policy/SSU policy number. |
| `OpCreditLimit` | decimal | Out-patient credit limit (SSF eligibility). |
| `IpCreditLimit` | decimal | In-patient credit limit (SSF eligibility). |
| `GeneralCreditLimit` | decimal | |
| `PolicyHolderEmployerName` | string | |
| `RegistrationCase` | string | `Medical` / `Accident` / `SSU-...` |
| `RegistrationSubCase` | string | `work related` / `non work related` (`ENUM_RegistrationSubCases`). |
| `LatestClaimCode` | Int64? | Most recent claim code used for this patient-scheme. |
| `OtherInfo` | string | |
| `CreatedOn` / `CreatedBy` | DateTime / int | |
| `ModifiedOn` / `ModifiedBy` | DateTime? / int? | |
| `IsActive` | bool | |
| `PolicyHolderEmployerID` | string | |
| `PolicyHolderUID` | string | UUID of the patient on the SSF server. |
| `SubSchemeId` | int? | |
| `PriceCategoryId` | int | Legacy price category, marked for removal. |

### 3.4 `SSFClaimBookingModel` (PAT_SSF_ClaimBooking)

Defined in `DanpheEMR.ServerModel/SSFModels/SSFClaimBookingModel.cs`.

| Field | Type | Notes |
| --- | --- | --- |
| `ClaimBookingId` | int (PK) | |
| `PatientId` | int | |
| `HospitalNo` | string | `PatientCode`. |
| `PolicyNo` | string | |
| `LatestClaimCode` | Int64 | The hospital-side claim code this booking is associated with. |
| `ResponseData` | string | Raw JSON response body from SSF. |
| `BillingInvoiceNo` | string | Set when `moduleName == "billing"`. |
| `PharmacyInvoiceNo` | string | Set when `moduleName != "billing"` (pharmacy/dispensary). |
| `BookingRequestDate` | DateTime | |
| `BookingResponseDate` | DateTime? | |
| `BookedBy` | int | EmployeeId of the user that triggered the booking. |
| `ReBookedBy` | int? | EmployeeId on a retry attempt. |
| `ReBookingDate` | DateTime? | |
| `BookingStatus` | bool | `true` if the SSF server accepted the booking. |
| `IsClaimed` | bool | Flipped to `true` after a successful `Claim` submission (Krishna 2023). |
| `IsActive` | bool | Soft-active flag. |

### 3.5 `SSFClaimResponseDetails` (PAT_SSFClaimResponseDetails)

Defined in `DanpheEMR.ServerModel/SSFModels/PAT_SSFClaimResponseDetails.cs`.

| Field | Type | Notes |
| --- | --- | --- |
| `Id` | int (PK) | |
| `ClaimCode` | Int64 | Hospital-side claim code. |
| `ClaimReferenceNo` | string | SSF reference (or SSF UUID when reference missing). |
| `PatientId` | int | |
| `PatientCode` | string | |
| `ClaimedDate` | DateTime | |
| `ResponseData` | string | Raw response body. |
| `InvoiceNoCSV` | string | |
| `ClaimRequestDate` | DateTime | |
| `ClaimStatus` | string | FHIR `status` field returned by SSF. |
| `ResponseDate` | DateTime | |
| `ResponseStatus` | bool | `true` if HTTP 200. |
| `ClaimCount` | int | Incremented on resubmission. |

### 3.6 `SSFPatientDetails` (response POCO)

| Field | Type |
| --- | --- |
| `Address`, `birthdate`, `gender`, `name`, `family`, `img` (Base64), `UUID` | string |
| `ssfEmployerList` | `List<List<Company>>` |

### 3.7 `EligibilityResponse`

| Field | Type |
| --- | --- |
| `SsfSchemeName` | string |
| `AccidentBalance` | decimal |
| `UsedMoney` | decimal |
| `OpdBalance` | decimal |
| `IPBalance` | decimal |
| `SsfEligibilityType` | string (`ENUM_SSF_EligibilityType`) |
| `Inforce` | bool |

### 3.8 `SSFCredentials`

| Field | Type |
| --- | --- |
| `SSFurl` | string |
| `SSFRemotekey` | string |
| `SSFRemoteValue` | string |
| `SSFUsername` | string |
| `SSFPassword` | string |

### 3.9 `SSFClaimResponseInfo` (request-scoped metadata)

| Field | Type |
| --- | --- |
| `PatientId`, `PatientCode` | int / string |
| `ClaimedDate` | DateTime |
| `ClaimCode` | Int64 |
| `InvoiceNoCSV` | string |

### 3.10 Frontend view-model `SsuPatientVM`

Defined in `wwwroot/DanpheApp/src/app/ssu/shared/ssu-patient.view-model.ts`. Wraps the standard `Patient` registration fields with two additions: `IsSSUPatient: boolean = false`, `SSU_IsActive: boolean = false`, `SSU_Information: SSU_InformationModel`, and a Reactive `SsuPatientValidator: FormGroup` (required: FirstName, LastName, Age, Gender, CountrySubDivisionId, CountryId; phone is 10-digit pattern but **not required** for SSU).

### 3.11 `ClaimBookingRoot_DTO` (request DTO)

| Field | Type | Notes |
| --- | --- | --- |
| `bookedAmount` | decimal | |
| `Patient` | string | |
| `scheme` | string | `ENUM_SSF_SchemeTypes.Accident` or `Medical` |
| `subProduct` | int? | `1` when `RegistrationCase == "medical"`, else `null` |
| `PatientId` | int | |
| `HospitalNo` | string | `PatientCode` |
| `PolicyNo` | string | |
| `LatestClaimCode` | Int64 | |
| `IsAccidentCase` | bool | Drives scheme selection. |
| `BillingInvoiceNo` | string | One of these two is populated per booking. |
| `PharmacyInvoiceNo` | string | |

### 3.12 `SSF_ClaimBookingService_DTO.GetMappedToBookClaim`

Static factory that maps `(SSF_ClaimBookingBillDetail_DTO, PatientSchemeMapModel)` → `SSF_ClaimBookingService_DTO`, picking `scheme = RegistrationCase == "accident" ? Accident : Medical` and `subProduct = 1` for medical only.

---

## 4. Database Tables

The SSU/SSF module touches the following tables (defined either explicitly here or in the broader Patient/Billing modules and surfaced via shared `DbContext`s).

### 4.1 `PAT_SSU_Information` (SSU-specific)

Created by SSU feature migration. Captured in `Database/CleanUpScript.sql` (line 492: `delete from PAT_SSU_Information; DBCC CHECKIDENT ('PAT_SSU_Information', RESEED, 0);`).

| Column | Type | Notes |
| --- | --- | --- |
| `SSU_InfoId` | int IDENTITY PK | |
| `PatientId` | int FK | `PAT_Patient.PatientId` (logical FK, not enforced). |
| `TargetGroupId` | int | 1–6 lookup. |
| `TargetGroup` | nvarchar | |
| `TG_CertificateType` | nvarchar | |
| `TG_CertificateNo` | nvarchar | |
| `IncomeSource` | nvarchar | |
| `PatFamilyFinancialStatus` | nvarchar | |
| `CreatedBy` / `CreatedOn` | int / datetime | |
| `ModifiedBy` / `ModifiedOn` | int? / datetime? | |

### 4.2 `PAT_Patient` (SSU-related columns)

| Column | Type | Notes |
| --- | --- | --- |
| `IsSSUPatient` | bit | Default 0. |
| `SSU_IsActive` | bit | Default 0. Toggled independently of `IsActive`. |

### 4.3 `PAT_MAP_PatientSchemes`

One row per (Patient, Scheme). For SSF, this is created with the patient’s `LatestClaimCode`, `PolicyNo`, `PolicyHolderUID` (the SSF UUID), `RegistrationCase` (Medical/Accident), `OpCreditLimit`, `IpCreditLimit` (from SSF eligibility). Updated by `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` to refresh OP/IP credit limits after a successful claim.

### 4.4 `PAT_SSF_ClaimBooking`

One row per booking attempt. Survives until `IsClaimed = true` (after a successful `Claim` submission). Re-booked attempts increment `ReBookedBy`/`ReBookingDate` instead of creating a new row.

### 4.5 `PAT_SSFClaimResponseDetails`

Append-only audit of every claim submission (HTTP request body, response body, claim reference, count). Multiple rows per `ClaimCode` are allowed (`ClaimCount` tracks attempts).

### 4.6 Core parameter table (`CORE_CFG_Parameters`)

| Parameter | Group | Purpose |
| --- | --- | --- |
| `SSFConfiguration` | `SSF` | JSON with `SSFurl`, `SSFUsername`, `SSFPassword`, `SSFRemotekey`, `SSFRemoteValue`. |
| `SsfSearchStringForSchemeNames` | `SSF` | JSON with `Medical` and `Accidental` substrings used to identify the corresponding insurance bucket. |
| `SSUMembershipTargetGroupMapping` | `Common` | JSON array `[{TargetGroupId, MembershipId}, ...]`. |
| `MembershipSchemeSettings` | `Billing` | JSON `{"ShowCommunity": bool, "IsMandatory": bool}` — controls the membership dropdown on the SSU patient form. |
| `DefaultCountry` | `Common` | JSON `{"CountryId": int}` — default country for new SSU registrations. |
| `CalendarTypes` | `Common` | JSON with `PatientRegistration` value — calendar type for DOB. |
| `PatientCodeFormat` | `Patient` | `YYMM-PatNum` / `HospCode-PatNum` / `PatNum`. |
| `HospitalCode` | `Common` | Hospital short code. |
| `ServerSideSearchComponent` | `Common` | `{ PatientSearchPatient: bool, [Length]: int }` — pagination toggle. |

### 4.7 Tables used by the SSU `DbContext` only as joins

`MST_Country`, `MST_CountrySubDivision`, `PAT_PatientVisits`, `ADT_PatientAdmission`, `ADT_BedReservation`, `ADT_TXN_PatientBedInfo`, `ADT_MST_Ward`, `ADT_Bed`, `ER_Patient`, `BIL_CFG_Scheme`, `MST_Municipality`. These are joined in the patient-list response to enrich the row with country, district, last visit date, admit status, bed reservation flag, police-case flag, ward/bed info and visit type.

---

## 5. Key Workflows

### 5.1 SSU Charity-Patient Registration

1. SSU staff opens the SSU module (`SSU_PatientListComponent`).
2. Clicks **+ New SSU Patient** → opens `SSU_PatientComponent` with a fresh `SsuPatientVM`.
3. The component:
   - Sets `IsSSUPatient = true` and `SSU_IsActive = true` by default (`Initialize()`).
   - Loads `CountrySubDivisionList` for the default `CountryId` (from `DefaultCountry` core parameter).
   - Loads `MembershipList` from `SSUMembershipTargetGroupMapping`.
   - Sets `isPhoneNumberMandatory = false` (SSU patients commonly lack phones).
   - Disables validation on the phone field.
4. User fills in demographics, picks a **Target Group** (`TargetGroupList` has 1–6 hard-coded options), enters certificate type / number, picks an **Income Source** (or types free text when "Others"), and free-text **Family Financial Status**.
5. On `OnTargetGroupChange()`:
   - `SSU_Information.TargetGroup` is set from the lookup.
   - `SSU_Information.TG_CertificateType` is auto-filled as `"<TargetGroup> Certificate"`.
   - `AssignMembershipOnTargetGroupChage()` looks up the membership from `SSUMembershipTargetGroupMapping[TargetGroupId].MembershipId` and assigns it to `model.MembershipTypeId`.
6. User presses Save → `Save(0)` → `PostSsuPatient()`.
7. `SSU_BLService.PostSsuPatient` strips the validator, stringifies, and `POST /api/SocialServiceUnit/post-ssu-patient-information`.
8. Server (`SocialServiceUnitController.PostSsuPatientInformation`):
   - Wraps the call in `dbContext.Database.BeginTransaction()`.
   - Adds the `PatientModel` (with `IsSSUPatient = true`, `SSU_IsActive = true`, `SSU_Information` populated) to the context.
   - Calls `CreatePatientWithUniquePatientNum` to compute `PatientNo = Max+1` and `PatientCode` per `PatientCodeFormat`. On `SqlException.Number == 2627` (unique violation) it **recursively retries** with a new code.
   - If `patDetails.IsSSUPatient == true && patDetails.SSU_Information != null` it inserts a new `SSU_InformationModel` with `CreatedBy = currentUser.EmployeeId`, `CreatedOn = DateTime.Now`.
   - Commits the transaction. On exception rolls back and re-throws.
9. Client receives the saved patient, shows "SSU patient Registered!" success message, emits `ssu-pat-callback` ("Ok"), and the parent list refreshes.

### 5.2 Edit an Existing SSU Patient

1. From `SSU_PatientListComponent` grid, click **Edit** (`GridEmitModel.Action == "edit"`).
2. `EditSSUPatMode = true`, `PatToEdit = $event.Data`, `showAddPatientBox = true`.
3. `SSU_PatientComponent.ngOnInit` → `AssignEditableData()`:
   - Copies all standard demographic fields, `IsSSUPatient`, `SSU_Information`, `MunicipalityId`/`Name`.
   - Splits the stored `Age` (e.g. `"56Y"`) into `Age` = `56` and `AgeUnit` = `Y`.
   - Calls `CalculateDob()` to re-derive `DateOfBirth` from age and unit.
   - Sets `hasTG_Certificate = true` if `SSU_Information.TG_CertificateNo` is present.
   - If `SSU_Information.SSU_InfoId <= 0` (non-SSU patient being brought into SSU) it sets `MembershipTypeId = 11` (the default SSU membership).
4. User updates fields and presses Save → `Save(1)` → `PutSsuPatient()`.
5. Server (`put-ssu-patient-information`):
   - Attaches the existing `PatientModel` and explicitly marks **only** these properties as modified: FirstName, MiddleName, LastName, Age, Gender, PhoneNumber, MaritalStatus, FatherName, MotherName, CountryId, CountrySubDivisionId, Address, EthnicGroup, Race, IsSSUPatient, SSU_IsActive, DateOfBirth. All other fields remain untouched (e.g. Visits, Allergies, Guarantor, etc.).
   - If `IsSSUPatient && SSU_Information != null && SSU_InfoId <= 0` → insert new `SSU_Information`.
   - If `IsSSUPatient && SSU_Information != null && SSU_InfoId > 0` → attach the existing row, mark state `Modified`, **but** explicitly keep `PatientId`, `CreatedOn`, `CreatedBy` unchanged.

### 5.3 Activate / De-activate SSU Patient

1. From the patient-list grid, the user triggers the `activateDeactivatePatient` action.
2. Component flips `PatToEdit.IsActive` and calls `PutActivateDeactivateSsuPatient()`.
3. Server (`put-activate-deactivate-ssu-patient`):
   - Loads the patient by `PatientId`, sets `IsActive`, `ModifiedOn = DateTime.Now`, `ModifiedBy = currentUser.EmployeeId`.
   - Commits the transaction.
4. Client shows a success message ("SSU patient Activated!" / "Deactivated!") and reloads the list.

### 5.4 SSU Patient Search

1. User types into the quick-filter input on the patient-list.
2. `serverSearchTxt(searchTxt)` → `Load(searchText)` → `SSU_BLService.GetSsuPatients` → `GET /api/SocialServiceUnit/GetAllSsuPatients?search=`.
3. Server filters `pat.IsSSUPatient == true` and matches the concatenated string `FirstName + " " + MiddleName + " " + LastName + " " + Address + " " + PhoneNumber + " " + PatientCode` against the search term.
4. Server decorates the result with computed fields: `ShortName`, `MunicipalityName`, `SSU_Information`, `VisitDate` (max visit date), `ProviderId` (from latest visit), `IsAdmitted`, `BedReserved` (from `ADT_BedReservation` where `AdmissionStartsOn > now + 15 min` — auto-cancel window), `IsPoliceCase` (from `ER_Patient` join), `VisitType`, `WardBedInfo` (from `ADT_TXN_PatientBedInfo` join), `AdmitButton` (RBAC `admit-button` permission).
5. When `Common/ServerSideSearchComponent/PatientSearchPatient == true` and the search is empty, the result is truncated to `ServerSideSearchListLength` to avoid loading every SSU patient.
6. Client renders the rows in a danphe-grid with columns `SSU_PatientSearch`. The list-filter combobox on the toolbar (`ssuPatientStatusFilter`) further filters by `all` / `active` / `inactive` based on `IsActive`.

### 5.5 Add a Non-SSU Patient to SSU

1. From the patient-list toolbar, the user can `SearchPatientsByKey` (autocomplete) hitting `GET /api/SocialServiceUnit/get-all-patients-for-ssu?searchText=…` (note the **em-dash separated** field set; excludes inactive and out-door patients).
2. User picks a patient, `EditExistingPatientInfo()` runs:
   - Copies the matched patient into `PatToEdit`.
   - If `PatToEdit.SSU_Information` is null, instantiates a new `SSU_InformationModel()`.
   - Opens the SSU patient form in **edit** mode.
3. User fills target group / income / certificate and saves → flows through the **Edit** path above (which inserts a new `SSU_Information` row when `SSU_InfoId <= 0`).

### 5.6 SSF Patient Lookup (External FHIR)

1. Frontend calls `GET /api/SSF/GetSSFPatientData?PatientId=<hospitalNo>`.
2. `SSFController.GetSSFPatientData` → `ISSFService.GetPatientDetails` → `SSFService.GetPatientDetails`.
3. Service builds the `Authorization: Basic <base64(SSFUsername:SSFPassword)>` header (ISO-8859-1), adds the custom `SSFRemotekey: SSFRemoteValue` header, then `GET Patient/?identifier={patientNo}` on `SSFurl`.
4. Parses the FHIR `Root` → `entry[*].resource` → fills `SSFPatientDetails` (address, birthdate, gender, family, name, UUID, photo).
5. Calls the private `GetSsfEmployerList` → `GET Employee/{UUID}/` → fills `ssfEmployerList`.
6. If a photo URL is present, fetches the bytes and returns them as a Base64 string (`GetSsfPatientPhoto`).

### 5.7 SSF Eligibility Check

1. Frontend: `GET/POST /api/SSF/CheckSSFEligibility?PatientId=…&VisitDate=…`.
2. `SSFController.CheckSSFEligibility` → `ISSFService.GetElegibility`.
3. Service builds `EligibilityRequest { resourceType: "CoverageEligibilityRequest", patient: { reference: "Patient/<patientNo>" }, extension: [{ url: "visitDate", valueString: <visitDate> }] }`.
4. `POST CoverageEligibilityRequest/` on SSF server.
5. On success, `ParseSSFEligibilityResponse`:
   - Reads `SsfSearchStringForSchemeNames` from core params (e.g. `Medical: "Medical"`, `Accidental: "Accident"`).
   - Finds the `indexForAccident` and `indexForMedical` by matching the substring against `insurance[i].extension[*].valueString`.
   - Throws `"Scheme Search KeyWord not matched."` if either index is `-1`.
   - For each bucket, walks `insurance[i].item[0].benefit[*]` to read `usedMoney.value` and `allowedMoney.value`; for the Medical bucket, the OP and IP balances come from `insurance[i].extension[1].valueString` and `insurance[i].extension[2].valueString`.
   - Returns two `EligibilityResponse` records (one Medical, one Accident) with `SsfEligibilityType` set.
6. Frontend uses these balances to display the available credit, and the `RegistrationSchemeSelectComponent` decides whether to accept the visit (`Appointment/SSFClaim/SSFClaimComponent.ts`).

### 5.8 SSF Claim Booking (real-time during billing)

1. After a bill is generated for an SSF patient, `BillingBL.SyncToSSFServer(claimBooking, moduleName, dbContext, patientSchemeMap, currentUser)` is called.
2. `SSF_ClaimBookingService_DTO.GetMappedToBookClaim(billObj, patientSchemeMap)` builds the SSF payload: `scheme = RegistrationCase == "accident" ? Accident : Medical`, `subProduct = 1` when Medical, `client_claim_id = billObj.ClaimCode.ToString()`, `client_invoice_no = billObj.InvoiceNoFormatted`.
3. `SSFService.BookClaim`:
   - `POST {SSFurl}BookingService/` (constant `ENUM_SSF_ApiEndPoints.BookingService`).
   - On 200 → `SaveSuccesfulClaimBooking`:
     - Looks up an existing `SSFClaimBookings` row by `BillingInvoiceNo` or `PharmacyInvoiceNo`. If found, updates `ReBookedBy`, `ReBookingDate`, `BookingStatus = true`, `BookingResponseDate`, `ResponseData`.
     - If not found, creates a new row with `BookingStatus = true`, `IsClaimed = false`, `IsActive = true`.
   - On failure → `SaveUnsuccessfulClaimBooking` writes a row with `BookingStatus = false`.
4. `SSFController.BookClaim` returns `ClaimBookingResponse` (with `ErrorMessage` collected from the FHIR `issue[*].details.text` array if available).

### 5.9 SSF Claim Submission

1. After booking, the hospital-side claim is **submitted** to SSF via `POST /api/SSF/SubmitClaim` with the body built by the Angular `ssf-claim` component (`ClaimRootDTO`).
2. `SSFController.SubmitClaim` maps the DTO to `ClaimRoot` and adds `claimResponseInfo` (PatientId, PatientCode, ClaimedDate, ClaimCode, InvoiceNoCSV).
3. `SSFService.SubmitClaim`:
   - `POST Claim/` on SSF server.
   - Parses `SSFClaimResponse` (FHIR ClaimResponse). Extracts the `ClaimReferenceNo` from `identifier` where the `coding.code == "mr"` (medical reference).
   - Looks up the previous `SSFClaimResponseDetail` for the same `ClaimCode`. If found, updates `ClaimReferenceNo`, `ClaimStatus`, `ResponseData`, `ClaimedDate`, `ResponseDate`, `ResponseStatus`, `ClaimCount++`.
   - If not found, inserts a new row with `ClaimCount = 1`.
   - On HTTP success, finds all `SSFClaimBookings` whose `LatestClaimCode.ToString() == claimRoot.clientClaimId` and sets `IsClaimed = true` on each.
4. Frontend reads `IsClaimed` via `GET /api/SSF/CheckClaimStatusLocally?latestClaimCode=…&patientId=…` to display the "Claimed" / "Not Claimed" badge.

### 5.10 Free Follow-up / Free Referral Scheme Refresh

1. When a free follow-up or referral visit is created for an SSF patient, `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` runs (`Appointment/VisitBL.cs:659`).
2. If the parent visit was already claimed (checked via `VisitBL.IsClaimed`), it re-queries SSF eligibility (`CheckSSFPatientEligibility`).
3. Updates `PAT_MAP_PatientSchemes.OpCreditLimit` and `IpCreditLimit` to the latest balances from the SSF server.
4. Updates `LatestPatientVisitId`, `LatestClaimCode`, `ModifiedOn`, `ModifiedBy`.

### 5.11 SSU Billing (price-category discount)

The SSU module does **not** own a billing endpoint. The `MembershipTypeId` it sets (via `SSUMembershipTargetGroupMapping`) drives the existing Billing module’s price-category resolution. When a bill is created for an SSU patient, the `MembershipDiscountPercent` flow applies the SSU discount automatically. Pharmacy sales bypass SSU entirely — `PharmacyBL` explicitly resets `IsSSUPatient = false` and `SSU_IsActive = false` on the synthesized patient object (`PharmacyBL.cs:317-318`).

---

## 6. API Endpoints

### 6.1 SSU (`/api/SocialServiceUnit/*`)

| # | Method & Route | Handler | Auth | Purpose |
| --- | --- | --- | --- | --- |
| 1 | `GET /api/SocialServiceUnit/GetAllSsuPatients?search=` | `SocialServiceUnitController.GetAllSsuPatients` | Session + `admit-button` permission | List/search SSU patients with full visit/admission/bed decoration. Honors `ServerSideSearchComponent/PatientSearchPatient` pagination. |
| 2 | `GET /api/SocialServiceUnit/get-all-patients-for-ssu?searchText=` | `SocialServiceUnitController.GetAllPatientsForSSU` | Session | Autocomplete source: non-inactive, non-outdoor patients, with a left-join of `SSU_Information` and `SSU_InfoId`. |
| 3 | `POST /api/SocialServiceUnit/post-ssu-patient-information` | `SocialServiceUnitController.PostSsuPatientInformation` | Session | Register a new SSU patient. Auto-generates `PatientNo` and `PatientCode`. Inserts a `SSU_Information` row inside a DB transaction. Recursive unique-constraint retry. |
| 4 | `PUT /api/SocialServiceUnit/put-ssu-patient-information` | `SocialServiceUnitController.PutSsuPatientInformation` | Session | Edit existing SSU patient. Selectively marks demographic + SSU-flag properties as modified. Inserts/updates `SSU_Information` based on `SSU_InfoId`. |
| 5 | `PUT /api/SocialServiceUnit/put-activate-deactivate-ssu-patient` | `SocialServiceUnitController.PutActivateDeactivateSsuPatient` | Session | Toggle `IsActive` for an SSU patient. |

### 6.2 SSF (`/api/SSF/*`)

| # | Method & Route | Handler | Auth | Purpose |
| --- | --- | --- | --- | --- |
| 6 | `GET /api/SSF/GetSSFPatientData?PatientId=` | `SSFController.GetSSFPatientData` | Session | Calls SSF `Patient/?identifier=`. Returns `SSFPatientDetails` (address, DOB, gender, name, UUID, Base64 photo, employer list). |
| 7 | `POST /api/SSF/CheckSSFEligibility?PatientId=&VisitDate=` | `SSFController.CheckSSFEligibility` | Session | Posts `CoverageEligibilityRequest` to SSF. Returns two `EligibilityResponse` (Medical and Accident). |
| 8 | `GET /api/SSF/GetEmployerList?SSFPatientUUID=` | `SSFController.GetEmployerList` | Session | Calls SSF `Employee/{uuid}/`. Returns nested `List<List<Company>>`. |
| 9 | `POST /api/SSF/SubmitClaim` | `SSFController.SubmitClaim` | Session | Submits a `Claim` payload to SSF. Persists audit in `PAT_SSFClaimResponseDetails` and flips `IsClaimed = true` on the corresponding booking rows. |
| 10 | `POST /api/SSF/BookClaim` | `SSFController.BookClaim` | Session | Submits a `BookingService` payload to SSF. Persists a row in `PAT_SSF_ClaimBooking` (new or re-booked). |
| 11 | `GET /api/SSF/GetClaimBookingDetail?claimCode=` | `SSFController.GetClaimBookingDetail` | Session | Returns local active, un-claimed booking rows for a given `LatestClaimCode`. |
| 12 | `GET /api/SSF/GetClaimDetail?ClaimUUID=` | `SSFController.GetClaimDetail` | Session | Proxies SSF `Claim/{uuid}/` for deep-linking. |
| 13 | `GET /api/SSF/CheckClaimStatusLocally?latestClaimCode=&patientId=` | `SSFController.IsClaimed` | Session | Returns `true` if a `PAT_SSFClaimResponseDetails` row exists with `ResponseStatus = true` for the given claim+patient. |
| 14 | `GET /api/SSF/GetSSFPatientDetailLocally?patientId=&schemeId=` | `SSFController.GetSSFPatientDetailLocally` | Session | Returns the `PAT_MAP_PatientSchemes` row (OP/IP credit limits, latest claim code, registration case, etc.). |

### 6.3 Related Patient / SSU-Internal Endpoints (exposed by `SSU_DLService` and consumed via the SSU frontend)

| # | Method & Route | Purpose (used by SSU SPA) |
| --- | --- | --- |
| 15 | `GET /api/Patient/SearchPatient?search=` | Generic patient search (used in `ssu.dl.service.ts:14`). |
| 16 | `GET /api/Patient/PatientWithVisitInfo?search=` | Patient list with visit context. |
| 17 | `GET /api/Patient/PatientById?patientId=` | Loads a single patient. |
| 18 | `GET /api/Patient/LightPatientById?patientId=` | Lightweight patient fetch. |
| 19 | `GET /api/Patient/MembershipTypes` | Membership dropdown. |
| 20 | `GET /api/Patient/AdmittedPatientst` | Inpatient list (used by the SSU grid). |
| 21 | `GET /api/Patient/InsuranceProviders` | Insurance provider list. |
| 22 | `GET /api/Patient/NewDialysicCode` | New dialysis code generator. |
| 23 | `GET /api/Patient/PatientDocuments?patientId=` | Patient uploaded documents. |
| 24 | `PUT /api/Patient?patientId=` | Generic patient update (legacy; not used by SSU directly). |
| 25 | `GET /api/Master/CountrySubDivisions?countryId=` | District dropdown. |
| 26 | `GET /api/Master/Countries` | Country dropdown. |
| 27 | `GET /api/Patient/GovInsurancePatient` | Government insurance patient look-up (used by SSU DL). |
| 28 | `POST /api/Patient/BillingOutPatient` | Outpatient billing patient. |
| 29 | `GET /api/Patient/MatchingPatients?FirstName=&LastName=&PhoneNumber=&Age=&Gender=&IsInsurance=&IMISCode=` | Duplicate detection during registration. |
| 30 | `GET /Reporting/PatientBillHistory?PatientCode=` | Patient billing history report. |

> Note: endpoints 15–30 are not part of the SSU controller but are exposed by the SSU DL service for grid/picker operations. They are listed for completeness because the SSU SPA consumes them.

### 6.4 Frontend Routes (Angular)

| Route | Component |
| --- | --- |
| `/SSU` (default child redirect) | `SocialServiceUnitMainComponent` → `SSU_PatientListComponent` |
| `/SSU/PatientList` | `SSU_PatientListComponent` |
| `/SSU/Reports` | (placeholder, currently commented out) |
| Nested popup | `SSU_PatientComponent` (selector `ssu-add-patient`) — used as an add/edit dialog inside the list. |

---

## 7. Cross-Module (Patient, Billing, Insurance)

### 7.1 Patient Module

- `PAT_Patient` carries two SSU-specific columns: `IsSSUPatient` (DB) and `SSU_IsActive` (DB), plus a `[NotMapped]` navigation `SSU_Information` (line 157 of `PatientModel.cs`).
- `SSU_BLService.PutPatient` (legacy code path, retained but unused by current SSU SPA) sanitises the standard `Patient` payload by omitting form validators before delegating to `PatientsDLService`.
- `PharmacyBL` synthesizes a fresh `PHRMPatient` from a billing patient, but explicitly **clears** `IsSSUPatient = false` and `SSU_IsActive = false` so pharmacy sales never inherit SSU status. This means a patient who is SSU on the hospital side will be billed at the regular pharmacy rate unless a pharmacy-specific scheme is applied separately.
- `SSU_PatientListComponent.PatientGridActions` action `activateDeactivatePatient` writes only to `Patient.IsActive` (the general patient active flag), not to `SSU_IsActive`. The two are independent toggles.

### 7.2 Billing Module

- The SSU module does not own any billing endpoints. The `MembershipTypeId` set via `SSUMembershipTargetGroupMapping` (default scheme id `11` is hard-coded client-side for non-SSU patients entering SSU) drives the standard Billing price-category resolution.
- SSF billing is integrated via `BillingBL.SyncToSSFServer`:
  - Triggered after a bill is settled for an SSF patient.
  - Builds the `SSF_ClaimBookingService_DTO` from the bill + `PAT_MAP_PatientSchemes` row.
  - `SSFService.BookClaim` calls the SSF `BookingService` endpoint, persists `PAT_SSF_ClaimBooking` (new or re-booked) and `PAT_SSFClaimResponseDetails` (only on a separate `Claim` submission).
- `DischargeBillingController` reads `PAT_MAP_PatientSchemes` to apply OP/IP credit limits and the scheme-specific price category at discharge.
- `BillingTransactionBL` resolves the price category from `PAT_MAP_PatientSchemes` for the visit.

### 7.3 Insurance Module

- `PatientSchemeMapModel` is shared by SSF, Medicare and Government Insurance. The `ENUM_DanpheSSFSchemes` enum (`shared-enums.ts:472`) defines `SSF-Medical`, `SSF-Accidental-Work Related`, `SSF-Accidental-Non Work Related`.
- `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` re-queries SSF eligibility after a free follow-up or referral visit and refreshes the `OpCreditLimit`/`IpCreditLimit` fields.
- `VisitBL.IsClaimed` looks up `PAT_SSFClaimResponseDetails.ResponseStatus` to determine whether a parent visit’s claim has been processed by SSF.
- `registration-scheme-select.component.ts` (in `appointments/shared`) calls `CheckSSFEligibility` when `currentRegSchemeDto.SchemeName == ENUM_DanpheSSFSchemes.Medical` and shows the available balance.
- `Claim-Management / ssf-claim` Angular module (`wwwroot/DanpheApp/src/app/claim-management/ssf-claim/`) is the UI for submitting and tracking SSF claims.

### 7.4 Appointment / Visit Module

- `VisitBL.CheckSSFPatientEligibility` duplicates the eligibility logic from `SSFService.ParseSSFEligibilityResponse` because `SSFService` was not accessible from `VisitBL`. (Krishna, 2023.) Both implementations follow the same flow.
- Visit creation for an SSF patient goes through the same `VisitController` endpoints as any other scheme, but the `SchemeId` for SSF-Medical / SSF-Accidental is recorded in `PAT_MAP_PatientSchemes`.

### 7.5 ADT / Admission Module

- `AdmissionController` reads `PAT_MAP_PatientSchemes` to attach the patient’s scheme (SSU/SSF/SSF-Accidental) and credit limits to the admission.
- `AdmissionModel` exposes `PatientSchemesMap` (a `PatientSchemeMapModel`) for the admission flow.

### 7.6 Pharmacy / Dispensary Module

- `SSFService.BookClaim` distinguishes billing from pharmacy bookings via the `moduleName` parameter passed to `BillingBL.SyncToSSFServer`. When `moduleName != "billing"` the invoice number is stored in `PharmacyInvoiceNo`; otherwise in `BillingInvoiceNo`.
- Pharmacy patients are always billed as non-SSU (`PharmacyBL.cs:317-318` resets the SSU flags on the pharmacy-side `PHRMPatient` object).

### 7.7 RBAC / Security

- `GetAllSsuPatients` checks the user’s permissions for `ApplicationId == 9` (SSU application in the RBAC system) and reads the `admit-button` permission into the `AdmitButton` field of the response.
- The SSU grid’s admit action button is shown only when the user has the `admit-button` permission; otherwise the button is hidden by the SPA.
- All SSF and SSU endpoints require an authenticated session (`HttpContext.Session.Get<RbacUser>`). No anonymous access is permitted.

---

## 8. Business Rules

### 8.1 SSU Patient Lifecycle

- **New SSU patient registration always sets** `IsSSUPatient = true` and `SSU_IsActive = true` (`ssu-patient.component.ts:124-125`). The default is "active".
- **Phone number is optional** for SSU patients. The component explicitly disables the `Validators.required` on `PhoneNumber` (`UpdatePhoneValidator("off", "PhoneNumber")`).
- **Default district** is loaded from the `DefaultCountry` core parameter’s `CountrySubDivisionId`.
- **Target Group is mandatory** on the client side (`Save()` rejects the form if `TargetGroupId <= 0`).
- **Certificate Type is auto-derived** from Target Group as `"<TargetGroup> Certificate"` on `OnTargetGroupChange()`. Free-text override is allowed.
- **Income Source "Others"** is replaced with the free-text value in `OtherIncome` before posting (`AssignPostData()`).
- **Membership is auto-mapped** to the chosen Target Group via `SSUMembershipTargetGroupMapping`. The component does not let the user pick a different membership for an SSU patient.
- **Default SSU membership** is `11` (hard-coded in `AssignEditableData` for non-SSU patients being moved into SSU).
- **Age format** on the wire is `"<n><Y|M|D>"` (e.g. `"56Y"`). The component parses this back into `Age` (number) and `AgeUnit` (Y/M/D) on edit.
- **Unique-constraint retry**: `CreatePatientWithUniquePatientNum` catches `SqlException.Number == 2627` on `PatientNo` and re-runs the generation. There is no upper bound on retries; in practice a max iteration guard should be added.

### 8.2 SSU Patient Search

- The search filters `pat.IsSSUPatient == true` only.
- Search is performed on the concatenated `FirstName + " " + MiddleName + " " + LastName + " " + Address + " " + PhoneNumber + " " + PatientCode` — phone, address and code are all included in the search corpus.
- When `ServerSideSearchComponent/PatientSearchPatient == true` and the search box is empty, the result is truncated to `ServerSideSearchListLength` (server-side pagination).
- The autocomplete source (`get-all-patients-for-ssu`) excludes out-door patients and inactive patients; SSU-flag is **not** a filter (so the user can pick a non-SSU patient and convert them).

### 8.3 SSU Activation / Deactivation

- The grid action toggles the **patient’s** `IsActive` flag (not `SSU_IsActive`). `SSU_IsActive` is a separate soft flag the SSU module can drive but does not currently expose through the SPA.
- The `put-activate-deactivate-ssu-patient` endpoint writes `ModifiedOn` and `ModifiedBy` from the current user.

### 8.4 SSF Patient Detail

- The hospital patient number is passed as the FHIR `identifier`. The SSF server returns the FHIR `Resource` bundle which is parsed for `address[*].text`, `birthDate`, `gender`, `name[*].family` + `name[*].given[0]`, `id` (UUID) and `photo[0].url` (downloaded as Base64).
- The hospital then calls `Employee/{UUID}/` to retrieve the employer list. This call is also made automatically as part of `GetPatientDetails` (via the private `GetSsfEmployerList`).

### 8.5 SSF Eligibility Check

- The Medical and Accident insurance buckets are identified by **substring match** on `insurance[i].extension[*].valueString` against `SsfSearchStringForSchemeNames.Medical` and `SsfSearchStringForSchemeNames.Accidental`. If either substring is not found, the API throws `"Scheme Search KeyWord not matched."` and the controller returns `BadRequest`.
- Allowed and used money are read from `insurance[i].item[0].benefit[*].allowedMoney.value` and `usedMoney.value`.
- OP and IP balances are read from `insurance[i].extension[1].valueString` and `insurance[i].extension[2].valueString` (Medical bucket only).
- `VisitBL.CheckSSFPatientEligibility` reproduces the same flow inline (with `insurance[0] = Medical`, `insurance[1] = Accident` — note the **opposite** order compared to `SSFService.ParseSSFEligibilityResponse`, which uses dynamic index lookup).

### 8.6 SSF Claim Booking

- The booking payload is keyed by `client_claim_id = claimCode.ToString()` and `client_invoice_no = BillingInvoiceNo ?? PharmacyInvoiceNo`.
- `scheme = RegistrationCase == "accident" ? Accident : Medical`. For Medical, `subProduct = 1` (only one product is supported by the SSF Medical scheme in the current implementation).
- Re-booking an existing invoice updates the row in place; first-time booking creates a new row with `IsActive = true` and `IsClaimed = false`.
- On HTTP failure, a row is still written (with `BookingStatus = false`) for audit.
- All bookings are persisted in `PAT_SSF_ClaimBooking` with the originating `BookedBy` / `ReBookedBy` employee id.

### 8.7 SSF Claim Submission

- A successful `Claim` submission stores the full response body in `PAT_SSFClaimResponseDetails.ResponseData` and increments `ClaimCount`.
- A failed submission is also persisted (with `ResponseStatus = false`).
- The SSF claim reference is taken from the `identifier` object where `coding.code == "mr"` (medical reference). If not present, the FHIR `id` (UUID) is used as a fallback.
- On a successful submission, all `PAT_SSF_ClaimBooking` rows with `LatestClaimCode.ToString() == claimRoot.clientClaimId` are flagged `IsClaimed = true`. This is the single source of truth for "is this invoice claimed?".

### 8.8 SSF Free Follow-up / Free Referral

- `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` only re-queries the SSF server if the **parent visit** was already claimed (`VisitBL.IsClaimed` returns `true`).
- After re-query, it updates `OpCreditLimit` and `IpCreditLimit` (only — other fields are not touched) to keep the local cache fresh.

### 8.9 RBAC and Multi-tenancy

- The SSU controller reads the current user from session (`HttpContext.Session.Get<RbacUser>("currentuser")`) on every call. No user id is trusted from the request body.
- SSU endpoints filter by `ApplicationId == 9` and inspect the `admit-button` permission. Patients returned in the search response include an `AdmitButton` field so the SPA can render/hide the admit action.
- The codebase does **not** enforce multi-tenant scoping on the SSU controller itself; the SSU module is implicitly single-tenant per hospital, consistent with the broader DanpheEMR architecture.

### 8.10 Calendar and Code-Format Rules

- SSU patients follow the standard `PatientCodeFormat` (`YYMM-PatNum`, `HospCode-PatNum` or `PatNum`) — see `SsuPatientBL.GetPatNumberNCodeForNewPatient`.
- DOB is captured in either English or Nepali calendar depending on the `CalendarTypes/PatientRegistration` core parameter; both `NepCalendarOnDateChange` and `EngCalendarOnDateChange` keep the two representations in sync.
- The system is locale-aware: `transliteration` (Unicode) is invoked for the local-language patient name field.

### 8.11 Validation and Form Behaviour

- Form validators on the SSU patient form are: required (FirstName, LastName, Age, Gender, CountryId, CountrySubDivisionId) and 10-digit numeric (PhoneNumber, optional).
- `CanRouteLeave()` blocks navigation away from a dirty, invalid form by marking every control as dirty and re-validating.
- `Esc` key (keyCode 27) closes the form (Hotkey).
- The `Save` button has two states (`flag=0` → new registration, `flag=1` → edit) wired to the focused element via `setFocusById("saveButton")`.

### 8.12 General SSU Constraints

- A patient may have at most one `SSU_Information` row. Re-editing the form updates the existing row in place.
- `IsSSUPatient` is not removed by an SSU deactivation — it stays `true` so that the patient is still in the SSU registry. Only `IsActive` (general patient flag) is toggled.
- The "SSU" filter on the patient list grid (`ssuPatientStatusFilter`) works against the **general** `IsActive` flag, not `SSU_IsActive`.
- SSU information is not stored in the legacy `Insurances` collection of `PatientModel`; it is in a separate table with a `[NotMapped]` navigation.

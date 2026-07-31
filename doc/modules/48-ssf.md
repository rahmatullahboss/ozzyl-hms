# SSF Module (Nepal Social Security Fund)

## 1. Module Overview

The SSF module integrates DanpheEMR with Nepal's **Social Security Fund (SSF)** — the government-run social health insurance scheme operated under the SSF Act and managed by the SSF Board (Beema Samiti). It is the implementation of a **real-time, FHIR-style web integration** with the SSF national payer, allowing a participating hospital to:

- Look up an SSF member by policy number and retrieve demographic details (and photo) directly from the SSF server.
- Verify member eligibility for medical or accident coverage and the per-visit balance, OPD limit and IP limit.
- List the employers linked to an SSF member (`Employee/{uuid}`).
- **Book** a claim synchronously before rendering services (pre-authorization of funds) using the SSF `BookingService` endpoint.
- **Submit** a FHIR R4-style `Claim` resource to the SSF server after services are delivered, including ICD-10 diagnoses, line items, total, and supporting attachments.
- Persist the full SSF request and response payloads locally for audit, reconciliation, and re-submission.

The integration is **stateless on the SSF side**: every request is authenticated with HTTP Basic Auth and a remote-key header, and credentials live in `CORE_CFG_Parameters` under the `SSF` parameter group. The scheme is one of three first-class insurance schemes in the system (the others are Government Bima and Medicare); the `ENUM_Scheme_ApiIntegrationNames.SSF` constant and the `SsfClaimSelectionGuardService` route guard are what route a chosen Insurance Provider into the SSF claim workflow.

Two implementation layers are visible in the source:

| Layer | Purpose |
| --- | --- |
| `Controllers/SSF/SSFController.cs` + `Services/SSF/SSFService.cs` | Async, post-visit, controller-facing API for the SSF claim UI (`claim-management/ssf-claim`). |
| `Services/SSF/BillingBL.SyncToSSFServer` + `DanpheEMR.Sync.SSF.APIs` | Real-time, fire-and-forget booking call from inside the visit / billing / pharmacy / discharge flows. |

Both layers share the same `SSFCredentials` (read from `CORE_CFG_Parameters`) and post JSON to the same SSF base URL. The only differentiator is whether the call is awaited (UI flow) or run in `Task.Run` (realtime flow so it does not block billing).

### Key Domain Concepts

| Term | Meaning |
| --- | --- |
| `PolicyHolderUID` | The SSF server's UUID for the patient (also called `SSFPatientUUID`). Returned by `Patient/?identifier=` and stored on `PAT_MAP_PatientSchemes.PolicyHolderUID`. |
| `ClaimCode` | The local Danphe EMR claim code (FK on `PAT_SSFClaimResponseDetails` and `PAT_SSF_ClaimBooking.LatestClaimCode`) used as the `client_claim_id` sent to SSF. |
| `ClaimReferenceNo` | SSF-server-side claim reference, looked up in the `identifier` array using coding `code = "mr"`. |
| `Booking` | Pre-authorization of funds for a planned visit, sent to the `BookingService` endpoint. `PAT_SSF_ClaimBooking` is the local mirror. |
| `Claim` | The final claim submission after services are rendered, sent to the `Claim/` endpoint. `PAT_SSFClaimResponseDetails` is the local mirror. |
| `RegistrationCase` | `Medical` or `Accident` — controls which scheme is used. Mapped to SSF scheme ids `1` (Accident) and `2` (Medical) via `ENUM_SSF_SchemeTypes`. |
| `SubProduct` | Only set for `Medical` cases; value `1` is used by `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` when `RegistrationCase == "medical"`. |

### SSF Endpoints (configured in `ENUM_SSF_ApiEndPoints`)

| Constant | Value | Use |
| --- | --- | --- |
| `PatientDetails` | `Patient/?identifier=` | Look up member demographic data by policy number |
| `CoverageEligibilityRequest` | `CoverageEligibilityRequest/` | Check eligibility for a visit date |
| `EmployeeList` | `Employee/` | List employer(s) of a member |
| `Claim` | `Claim/` | Submit a final claim (POST) |
| `ClaimDetail` | `Claim/` | Get claim detail by UUID (GET) |
| `BookingService` | `BookingService` | Pre-authorize a claim amount |

---

## 2. Backend Files

### Controllers

| File | Lines | Purpose |
| --- | --- | --- |
| `Controllers/SSF/SSFController.cs` | 229 | REST controller for the SSF claim UI. 8 endpoints (one duplicate). Depends on `ISSFService` and `SSFDbContext`. |
| `Controllers/Billing/BillingBL.cs` (partial) | ~540–850 | Contains `SyncToSSFServer`, `PostToClaimBookingLog`, `GetSSFCredentials`, `GetCoreParameterValueByKeyName_String`. Used by the realtime booking path. |
| `Controllers/Appointment/VisitBL.cs` (partial) | ~540–810 | `SavePatientScheme` (calls SSF realtime booking), `IsClaimed` (local claim-status check), `CheckSSFPatientEligibility`, `GetSSFCredentials` (a private copy of the credential loader). |
| `Controllers/Pharmacy/PharmacySalesController.cs` (partial) | ~875, 1818 | Calls `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` from pharmacy sales and sales-return paths. |
| `Controllers/Billing/BillingController.cs` (partial) | ~8243 | Calls `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` from the billing flow. |
| `Controllers/Billing/DischargeBillingController.cs` (partial) | ~589 | Calls `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` on discharge. |
| `Controllers/Billing/BillReturnController.cs` (partial) | ~650 | Calls `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` on bill return. |
| `Controllers/Appointment/VisitController.cs` (partial) | ~45–67, 582, 712 | Holds `RealTimeSSFClaimBooking` flag (from `MyConfiguration`) and instantiates the `SSFDbContext` injected into `VisitBL`. |

### Services

| File | Purpose |
| --- | --- |
| `Services/SSF/ISSFService.cs` | Interface: 9 methods (patient detail, eligibility, employer list, claim submit, claim book, claim detail, claim booking detail, is-claimed, local patient-scheme detail). |
| `Services/SSF/SSFService.cs` | Implementation. All `HttpClient` calls go here. The only sync I/O points are `GetSSFCredentials` (reads `CORE_CFG_Parameters`) and the SSF HTTP calls. The class is the **only** place that calls SSF endpoints from the controller layer. |
| `Services/SSF/DTO/SSF_ClaimBookingService_DTO.cs` | `SSF_ClaimBookingService_DTO` (the request body sent to `BookingService`), `SSF_ClaimBookingBillDetail_DTO` (intermediate shape), and the static factory `GetMappedToBookClaim(billObj, patientSchemeMap)`. |
| `Sync/SSF/APIs.cs` | `BookClaim(claimBooking, ssfCred)` — same payload as the controller path, but invoked from `BillingBL.SyncToSSFServer` as a fire-and-forget `Task.Run`. Returns `SSF_RealTimeBookingServiceResponse { ResponseData, BookingStatus }`. |
| `Sync/SSF/SSF_ClaimBookingViewModel.cs` | `SSF_RealTimeBookingServiceResponse` view model shared between the sync library and `BillingBL`. |

### Data-access

| File | Purpose |
| --- | --- |
| `DalLayer/SSFDbContext.cs` | The only DbContext that owns the SSF tables. Maps `AdminParametersModel → CORE_CFG_Parameters`, `SSFClaimResponseDetails → PAT_SSFClaimResponseDetails`, `PatientSchemeMapModel → PAT_MAP_PatientSchemes`, `VisitModel → PAT_PatientVisits`, `SSFClaimBookingModel → PAT_SSF_ClaimBooking`. |
| `DalLayer/VisitDbContext.cs` | Independently maps `SSFClaimResponseDetails` to the same table; this is what `VisitBL.IsClaimed` and `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` use. |

### Models (server: `DanpheEMR.ServerModel/SSFModels/`)

| File | Public types | Use |
| --- | --- | --- |
| `SSF.cs` | `SSF`, `Entry`, `Resource`, `Patient`, `Item`, `Coding`, `Identifier`, `Type`, `Extension`, `Link`, `BillablePeriod`, `ClaimBooking` | FHIR-like envelope used to deserialize the SSF `Patient/?identifier=` response and the inbound `ClaimBooking` payload. |
| `SSFResponse.cs` | `Root`, `Entry`, `Resource`, `Name`, `Address`, `Identifier`, `Photo`, `Telecom`, `EmployerRoot`, `Company`, `Family` | The actual response shape returned by SSF for `Patient` and `Employee` endpoints. Note: `Company` and `EmployerRoot` are shared with the SSF `EmployerList` path. |
| `SSFPatientDetail.cs` | `SSFPatientDetails { Address, birthdate, gender, name, family, img, UUID, ssfEmployerList }` | The flattened patient view the UI consumes. |
| `SSFPatientEligibility.cs` | `EligibilityRequest`, `EligibilityResponse`, `EligibilityRoot`, `EligibilityInsurance`, `EligibilityItem`, `EligibilityBenefit`, `EligibilityAllowedMoney`, `EligibilityUsedMoney`, `EligibilityCategory`, `EligibilityExtension` | The FHIR `CoverageEligibilityRequest` request and `EligibilityResponse` simplified result. |
| `SSFClaim.cs` | `ClaimRoot`, `ClaimRootDTO`, `SSFClaimResponseInfo`, `SSFClaimSubmissionOutput`, `ClaimBillablePeriod`, `ClaimCategory`, `ClaimItem`, `ClaimPatient`, `ClaimProvider`, `ClaimFacility`, `ClaimEnterer`, `ClaimTotal`, `ClaimExtension`, `ClaimDiagnosis`, `ClaimDiagnosisCodeableConcept`, `ClaimCoding`, `ClaimQuantity`, `ClaimUnitPrice`, `ClaimProductOrService`, `ClaimType`, `ClaimSupportingInfo`, `claimValueAttachment`, `ErrorRoot`, `Issue`, `Details`, `ErrorText` | The shape of the SSF `Claim` request body and the `ErrorRoot` envelope. `SSFClaimResponseInfo` carries local metadata (`PatientId`, `PatientCode`, `ClaimedDate`, `ClaimCode`, `InvoiceNoCSV`). |
| `SSFClaimResponse.cs` (under `SSFModels.ClaimResponse`) | `SSFClaimResponse`, `Item`, `Adjudication`, `Amount`, `Category`, `Reason`, `Total`, `Insurer`, `Request`, `Requestor`, `Patient`, `Identifier`, `Type`, `Coding`, `Extension`, `ItemExtension`, `ItemValueReference`, `ValuePeriod`, `ValueReference` | The deserialized SSF claim-submission response. |
| `SSFClaimBookingModel.cs` | `SSFClaimBookingModel` (with attributes) | Local mirror of every booking attempt → `PAT_SSF_ClaimBooking`. |
| `PAT_SSFClaimResponseDetails.cs` | `SSFClaimResponseDetails` (with attributes) | Local mirror of every claim submission → `PAT_SSFClaimResponseDetails`. |
| `SSFCredentials.cs` | `SSFCredentials { SSFurl, SSFRemotekey, SSFRemoteValue, SSFUsername, SSFPassword }` | DTO populated from `CORE_CFG_Parameters`. |

### Enums (server: `Utilities/SharedEnums.cs` lines 485–559)

| Class | Members | Use |
| --- | --- | --- |
| `ENUM_SSF_EligibilityType` | `Medical`, `Accident` | Tag for each parsed eligibility record. |
| `ENUM_Scheme_ApiIntegrationNames` | `SSF`, `Medicare` | Identifies the active insurance provider's API style. |
| `ENUM_SSF_ApiEndPoints` | `PatientDetails`, `CoverageEligibilityRequest`, `EmployeeList`, `Claim`, `ClaimDetail`, `BookingService` | Strings used by `SSFService` to build URLs. |
| `ENUM_SSF_SchemeTypes` | `Accident = "1"`, `Medical = "2"` | Hard-coded mapping sent in the `scheme` field of `ClaimBooking`. |
| `ENUM_ModuleNames` (used in `PostToClaimBookingLog`) | `IpBilling`, `IpPharmacy`, `OpPharmacy` | Distinguishes which billing context created a `PAT_SSF_ClaimBooking` row. |

### Frontend

| File | Purpose |
| --- | --- |
| `wwwroot/DanpheApp/src/app/claim-management/ssf-claim/ssf-claim.component.{ts,html,css}` | The main SSF claim UI: pulls patient info, eligibility, employer list, builds a `ClaimRoot`, attaches file uploads, posts to `/api/SSF/SubmitClaim`. |
| `wwwroot/DanpheApp/src/app/claim-management/shared/SSF-Models.ts` | Mirror of the C# `ClaimRoot` etc. types. |
| `wwwroot/DanpheApp/src/app/claim-management/shared/ssf-claim-selection-guard.ts` | `SsfClaimSelectionGuardService` — route guard that ensures the active insurance provider is configured for SSF before allowing navigation to the SSF claim page. |
| `wwwroot/DanpheApp/src/app/claim-management/ssf-claim/ssf-dl.services.ts` | `SsfDlService` (currently used only for pharmacy-invoice retrieval, kept as a placeholder for additional SSF DL methods). |
| `wwwroot/DanpheApp/src/app/insurance/ssf/shared/SSF-Models.ts` | A near-duplicate of the claim-management models, used by the insurance-ssf feature area. |
| `wwwroot/DanpheApp/src/app/insurance/ssf/shared/ssf-patient-detail.dto.ts` | `SSFPatientDetailFromSsfServer_DTO` — DTO used when the SSF service flattens the server response into the local `SsfPatient_DTO`. |
| `wwwroot/DanpheApp/src/app/insurance/ssf/shared/service/ssf.service.ts` | `SsfService` — central state holder for the SSF data loaded by the visit-creation flow (`GetSsfPatientDetailAndEligibilityFromSsfServer`, `GetSsfPatientDetailAndEligibilityLocally`, `LoadSSFEmployer`, `isClaimed`, `ReturnSsfData`). |
| `wwwroot/DanpheApp/src/app/appointments/SSFClaim/SSFClaimComponent.{ts,html}` | Older SSF claim page used from the appointments module; reaches the same controller endpoints. |
| `wwwroot/DanpheApp/src/app/appointments/shared/visit.dl.service.ts` (lines 229–285) | The HTTP wrappers: `GetSSFPatientData`, `CheckSSFEligibility`, `GetSSFEmployerDetail`, `SubmitClaim`, `GetClaimBookingDetail`, `BookClaim`, `IsClaimed`, `getSSFPatientDetailLocally`, `getSSFPatientDetailAndCheckSSFEligibilityFromSsfServer`. |
| `wwwroot/DanpheApp/src/app/appointments/shared/visit.bl.service.ts` (lines 492–547) | Business-layer wrappers that the visit UI and `SsfService` consume. |

---

## 3. Data Models

### 3.1 `SSFClaimBookingModel` → `PAT_SSF_ClaimBooking`

Mirrors every booking attempt made against the SSF `BookingService`. Created on the realtime path (`BillingBL.SyncToSSFServer` → `PostToClaimBookingLog`) and on the controller path (`SSFService.SaveClaimBookingResponse`).

| Field | Type | Notes |
| --- | --- | --- |
| `ClaimBookingId` | int (PK) | Identity. |
| `PatientId` | int | FK to `PAT_Patient`. |
| `HospitalNo` | string (≤?) | Mirrored from `PatientSchemeMapModel.PatientCode`. |
| `PolicyNo` | string | SSF member policy number. |
| `LatestClaimCode` | Int64 | Local Danphe claim code; sent as `client_claim_id`. |
| `ResponseData` | string (nvarchar(max)) | Raw JSON returned by SSF `BookingService` (empty string on failure). |
| `BillingInvoiceNo` | string (nullable) | Set when `moduleName == "billing"`. |
| `PharmacyInvoiceNo` | string (nullable) | Set when `moduleName != "billing"`. |
| `BookingRequestDate` | DateTime | Local time the call was issued. |
| `BookingResponseDate` | DateTime? | Local time the response was received. Null when booking is still in flight (the failure-path setter explicitly leaves it null). |
| `BookedBy` | int | `RbacUser.EmployeeId`. |
| `ReBookedBy` | int? | Set when an existing row is re-attempted. |
| `ReBookingDate` | DateTime? | Set together with `ReBookedBy`. |
| `BookingStatus` | bool | True ↔ SSF returned a success status code. |
| `IsClaimed` | bool | Flipped to `true` by `SSFService.SubmitClaim` when the matching `ClaimCode` has been submitted to SSF. |
| `IsActive` | bool | Soft-delete flag; `GetClaimBookingDetail` filters on `IsActive == true && IsClaimed == false`. |

Indexes: none explicitly declared. The most common lookup is `(LatestClaimCode, IsActive, IsClaimed)`; this is currently a full scan in `GetClaimBookingDetail`.

### 3.2 `SSFClaimResponseDetails` → `PAT_SSFClaimResponseDetails`

One row per `Claim/` POST. Updated in place if a `ClaimCode` is re-submitted (the `ClaimCount` is incremented).

| Field | Type | Notes |
| --- | --- | --- |
| `Id` | int (PK) | Identity. |
| `ClaimCode` | Int64 | Local Danphe claim code. |
| `ClaimReferenceNo` | string | SSF claim reference: `serializeData.identifier` where `type.coding[0].code == "mr"`. Falls back to `serializeData.id` if the `mr` coding is missing. |
| `PatientId` | int | Local patient id. |
| `PatientCode` | string | Local patient code. |
| `ClaimedDate` | DateTime | The date used for the request (taken from `SSFClaimResponseInfo.ClaimedDate`). |
| `ResponseData` | string (nvarchar(max)) | Raw JSON returned by SSF `Claim/`. |
| `InvoiceNoCSV` | string | Comma-separated invoice numbers included in the claim. |
| `ClaimRequestDate` | DateTime | Same as `ClaimedDate` (set on first insert only). |
| `ClaimStatus` | string | SSF `ClaimResponse.status` (e.g. `active`). |
| `ResponseDate` | DateTime | Local time the response was recorded. |
| `ResponseStatus` | bool | True if the HTTP status was 2xx. |
| `ClaimCount` | int | Incremented every re-submit. |

### 3.3 `PatientSchemeMapModel` → `PAT_MAP_PatientSchemes` (used by SSF)

| Field | Type | Notes |
| --- | --- | --- |
| `PatientSchemeId` | int (PK) | |
| `PatientId` | int | |
| `PatientCode` | string | Mirrored into `SSFClaimBookingModel.HospitalNo`. |
| `LatestPatientVisitId` | int | |
| `SchemeId` | int | The `MST_BillingScheme` row that represents the SSF scheme. |
| `PolicyNo` | string | The SSF member number, used as the `identifier` query value. |
| `OpCreditLimit`, `IpCreditLimit`, `GeneralCreditLimit` | decimal | Locally-cached balance. Decreased on every successful booking in `VisitBL.SavePatientScheme`. Refreshed from the SSF server on free follow-up / free referral. |
| `PolicyHolderEmployerName` | string | From the SSF `Employee` response. |
| `RegistrationCase` | string | `Medical` or `Accident`. Drives `ENUM_SSF_SchemeTypes`. |
| `RegistrationSubCase` | string | |
| `LatestClaimCode` | Int64? | Updated on every visit. |
| `OtherInfo` | string | |
| `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` | audit | |
| `IsActive` | bool | |
| `PolicyHolderEmployerID` | string | |
| `PolicyHolderUID` | string | The SSF member's UUID. Used as `Patient` in `ClaimBooking` and as the path param for `Employee/{uuid}`. |
| `SubSchemeId` | int? | |
| `PriceCategoryId` | int | **To be removed after migration.** Still used by `VisitBL.SavePatientScheme` to detect the SSF price category. |

### 3.4 `SSFCredentials` (transient DTO)

| Field | Type | Notes |
| --- | --- | --- |
| `SSFurl` | string | Base URL of the SSF server, no trailing slash. |
| `SSFRemotekey` | string | Custom header name (e.g. `ssf-api-key`). |
| `SSFRemoteValue` | string | Custom header value. |
| `SSFUsername` | string | HTTP Basic Auth user. |
| `SSFPassword` | string | HTTP Basic Auth password. |

`GetSSFCredentials` reads all five from `CORE_CFG_Parameters` where `ParameterGroupName = "SSF"`, `ParameterName = "SSFConfiguration"`, and the `ParameterValue` JSON object has these five keys. The same getter is duplicated in `SSFService`, `BillingBL`, and `VisitBL`.

### 3.5 `ClaimRoot` (request body for `Claim/`)

| Field | Type | Notes |
| --- | --- | --- |
| `resourceType` | string | Always `Claim` (FHIR R4). |
| `clientClaimId` | string | The local `ClaimCode` as a string. |
| `type` | `ClaimType { text }` | |
| `billablePeriod` | `ClaimBillablePeriod { start, end }` | ISO date strings. |
| `created` | string | ISO datetime. |
| `enterer` | `ClaimEnterer { reference }` | |
| `facility` | `ClaimFacility { reference }` | |
| `provider` | `ClaimProvider { reference }` | |
| `extension` | `List<ClaimExtension { url, valueString }>` | |
| `diagnosis` | `List<ClaimDiagnosis { sequence, diagnosisCodeableConcept, type }>` | ICD-10. |
| `item` | `List<ClaimItem { sequence, category, productOrService, quantity, unitPrice, extension }>` | |
| `total` | `ClaimTotal { value }` | decimal. |
| `patient` | `ClaimPatient { reference }` | |
| `supportingInfo` | `List<ClaimSupportingInfo { category, valueAttachment }>` | Each `valueAttachment` carries `contentType`, `creation`, `data` (base64), `hash`, `title`. |

`ClaimRootDTO` adds `claimResponseInfo: SSFClaimResponseInfo { PatientId, PatientCode, ClaimedDate, ClaimCode, InvoiceNoCSV }` which is stripped by the controller before posting to SSF.

### 3.6 `EligibilityResponse` (parsed by `ParseSSFEligibilityResponse`)

| Field | Type | Notes |
| --- | --- | --- |
| `SsfSchemeName` | string | Raw value of the scheme extension. |
| `AccidentBalance` | decimal | Allowed remaining for the Accident scheme. |
| `UsedMoney` | decimal | `allowedMoney - remaining` for the relevant scheme. |
| `OpdBalance` | decimal | From `extension[1].valueString` of the Medical scheme. |
| `IPBalance` | decimal | From `extension[2].valueString` of the Medical scheme. |
| `SsfEligibilityType` | string | `Medical` or `Accident` (from `ENUM_SSF_EligibilityType`). |
| `Inforce` | bool | The `insurance.inforce` flag. |

---

## 4. Database Tables

The SSF module owns the two patient-side tables and a single configuration table. All other data is read from the surrounding modules.

### 4.1 `PAT_SSF_ClaimBooking` (`SSFClaimBookingModel`)

| Column | Type | Constraint | Notes |
| --- | --- | --- | --- |
| `ClaimBookingId` | int | PK, identity | |
| `PatientId` | int | not null | FK by convention to `PAT_Patient.PatientId`. |
| `HospitalNo` | nvarchar | not null | |
| `PolicyNo` | nvarchar | not null | |
| `LatestClaimCode` | bigint | not null | Used as `client_claim_id` in the booking payload. |
| `ResponseData` | nvarchar(max) | nullable | |
| `BillingInvoiceNo` | nvarchar | nullable | `BillingInvoiceNo` set when `moduleName == "billing"`. |
| `PharmacyInvoiceNo` | nvarchar | nullable | Set when `moduleName` is `ip-pharmacy` or `op-pharmacy`. |
| `BookingRequestDate` | datetime | not null | |
| `BookingResponseDate` | datetime | nullable | |
| `BookedBy` | int | not null | `EmployeeId`. |
| `ReBookedBy` | int | nullable | |
| `ReBookingDate` | datetime | nullable | |
| `BookingStatus` | bit | not null | |
| `IsClaimed` | bit | not null | |
| `IsActive` | bit | not null | |

Indexes: only the PK. Recommended (not currently declared): `IX_PAT_SSF_ClaimBooking_LatestClaimCode_IsActive_IsClaimed`.

### 4.2 `PAT_SSFClaimResponseDetails` (`SSFClaimResponseDetails`)

| Column | Type | Constraint | Notes |
| --- | --- | --- | --- |
| `Id` | int | PK, identity | |
| `ClaimCode` | bigint | not null | Local claim code. |
| `ClaimReferenceNo` | nvarchar | nullable | SSF `mr` identifier or fallback UUID. |
| `PatientId` | int | not null | |
| `PatientCode` | nvarchar | not null | |
| `ClaimedDate` | datetime | not null | |
| `ResponseData` | nvarchar(max) | nullable | |
| `InvoiceNoCSV` | nvarchar | nullable | |
| `ClaimRequestDate` | datetime | not null | |
| `ClaimStatus` | nvarchar | nullable | |
| `ResponseDate` | datetime | not null | |
| `ResponseStatus` | bit | not null | |
| `ClaimCount` | int | not null | |

Indexes: only the PK. Recommended: `IX_PAT_SSFClaimResponseDetails_PatientId_ClaimCode` (used by `IsClaimed` and the re-submit path).

### 4.3 `PAT_MAP_PatientSchemes` (`PatientSchemeMapModel`)

Existing table shared with the Insurance module. SSF reads/writes:

- `PolicyNo` — used as the `identifier` in `Patient/?identifier=`.
- `PolicyHolderUID` — used as `Patient` in the `ClaimBooking` payload and the path parameter for `Employee/{uuid}`.
- `RegistrationCase` — drives `ENUM_SSF_SchemeTypes` and `SubProduct`.
- `OpCreditLimit` / `IpCreditLimit` / `GeneralCreditLimit` — cached local copy of the SSF balances.
- `LatestClaimCode` — set to the visit's claim code on every save in `VisitBL.SavePatientScheme`.

### 4.4 `CORE_CFG_Parameters` (`AdminParametersModel`)

SSF reads the row where `ParameterGroupName = 'SSF'` and `ParameterName = 'SSFConfiguration'`. The `ParameterValue` column is a JSON object with five keys: `SSFurl`, `SSFUsername`, `SSFPassword`, `SSFRemotekey`, `SSFRemoteValue`. A second row with the same group and `ParameterName = 'SsfSearchStringForSchemeNames'` carries `Medical` and `Accidental` substrings used by `ParseSSFEligibilityResponse` to locate the right scheme in the response.

### 4.5 Tables read but not owned

| Table | Used for |
| --- | --- |
| `PAT_Patient` | Source of `PatientCode`, name, photo. |
| `PAT_PatientVisits` | Source of visit / claim code. |
| `MST_BillingScheme` | Source of `SchemeId`, `IsOpCreditLimited`, `IsIpCreditLimited`, `IsGeneralCreditLimited`. |
| `MST_PriceCategory` | Detects the SSF price category in `VisitBL.SavePatientScheme` by `PriceCategoryName == "ssf"`. |
| `BIL_TXN_BillingTransaction` / `BIL_TXN_Invoice` | Source of `InvoiceNo`, `TotalAmount`, `ClaimCode` for the booking payload. |
| `PHRM_Master_Invoices` | Same as above for pharmacy. |
| `BIL_TXN_Discharge` | Source of discharge-bill amounts. |

---

## 5. Key Workflows

### 5.1 SSF Member Lookup & Eligibility (UI path)

```
Visit screen → user enters PolicyNo
   ↓
SsfService.GetSsfPatientDetailAndEligibilityFromSsfServer(policyNo)
   ↓  forkJoin
GET /api/SSF/GetSSFPatientData?PatientId={policyNo}
POST /api/SSF/CheckSSFEligibility?PatientId={policyNo}&VisitDate={today}
   ↓
SSFService.GetPatientDetails   → SSF /Patient/?identifier=…
   → parses Root → SSFPatientDetails { Address, birthdate, gender,
                                         name, family, UUID, img,
                                         ssfEmployerList }
   → GetSsfPatientPhoto (base64) for the photo URL
   → GetSsfEmployerList        → SSF /Employee/{uuid}/
SSFService.GetElegibility      → SSF /CoverageEligibilityRequest/ POST
   → ParseSSFEligibilityResponse → 2 × EligibilityResponse
   - Medical:  OpdBalance, IPBalance, UsedMoney, Inforce
   - Accident: AccidentBalance, UsedMoney, Inforce
   ↓
SsfService.GetSSFPatientDetailAndEligibilityLocally (fallback)
   → /api/SSF/GetSSFPatientDetailLocally?patientId=&schemeId=
   → uses cached OpCreditLimit / IpCreditLimit / GeneralCreditLimit
   ↓
SsfService.isClaimed(LatestClaimCode, PatientId)
   → /api/SSF/CheckClaimStatusLocally?latestClaimCode=&patientId=
   → VisitBL.IsClaimed → query PAT_SSFClaimResponseDetails
```

### 5.2 Real-time Claim Booking (Billing / Pharmacy / Discharge)

Triggered when `PriceCategoryName == "ssf"` and the `RealTimeSSFClaimBooking` flag is on. The booking runs in `Task.Run` so the user-facing flow is not blocked.

```
Save billing transaction  (or pharmacy sale / sale return / discharge)
   ↓
VisitBL.SavePatientScheme  (or Sales/Discharge equivalent)
   ↓  updates PAT_MAP_PatientSchemes
   ↓  (decrements OpCreditLimit / IpCreditLimit / GeneralCreditLimit
   ↓   based on BillingTransaction.TotalAmount)
   ↓
SSF_ClaimBookingService_DTO.GetMappedToBookClaim(billObj, patientSchemes)
   - scheme: Accident/Medical from RegistrationCase
   - subProduct: 1 if medical, else null
   - client_claim_id: billObj.ClaimCode.ToString()
   - client_invoice_no: "BL" + InvoiceNo  (or pharmacy no)
   - Patient: patientSchemeMap.PolicyHolderUID
   ↓
BillingBL.SyncToSSFServer(claimBooking, moduleName, _ssfDbContext, patientSchemes, currentUser)
   ↓
   - reads SSFCredentials from CORE_CFG_Parameters
   - Sync.SSF.APIs.BookClaim(claimBooking, SSFCred)  → POST {SSFurl}/BookingService
   - maps response into SSF_RealTimeBookingServiceResponse { ResponseData, BookingStatus }
   ↓
PostToClaimBookingLog → insert into PAT_SSF_ClaimBooking
   - BillingInvoiceNo when moduleName == "billing"
   - PharmacyInvoiceNo otherwise
   - BookingStatus from the HTTP response
   - LatestClaimCode from client_claim_id (long.Parse)
   - PolicyNo / HospitalNo / PatientId from the patientSchemeMap
```

### 5.3 Manual Booking (controller path)

Same payload, but awaits the response, persists both success and failure, and returns a structured `ClaimBookingResponse { ResponseStatus, ErrorMessage }`. Used by the SSF claim UI when the user explicitly triggers a booking.

```
POST /api/SSF/BookClaim  (ClaimBookingRoot_DTO)
   ↓
SSFService.BookClaim
   ↓
   - read SSFCredentials
   - PrepareClaimBooking (sets scheme, subProduct, client_claim_id,
     client_invoice_no = billing if present, else pharmacy)
   - POST {SSFurl}/BookingService
   - if 2xx       → deserialize ClaimBookingResponseRoot,
                    SaveSuccesfulClaimBooking (insert or update
                    PAT_SSF_ClaimBooking)
   - if non-2xx   → parse ErrorRoot.issue → comma-joined message,
                    SaveUnsuccessfulClaimBooking (insert or update
                    with BookingStatus = false)
   ↓
return { ResponseStatus, ErrorMessage }
```

### 5.4 Claim Submission

```
SSF claim UI builds ClaimRoot (FHIR R4) from
   - Visit dates (ClaimBillablePeriod)
   - Diagnoses (ICD-10, sequence)
   - Line items (price, qty, productOrService.text)
   - Supporting attachments (base64, hash, contentType, title)
   - Total (decimal)
   ↓
POST /api/SSF/SubmitClaim  (ClaimRootDTO + claimResponseInfo)
   ↓
SSFController.SubmitClaim
   - rebuild ClaimRoot without claimResponseInfo
   ↓
SSFService.SubmitClaim
   - read SSFCredentials
   - POST {SSFurl}/Claim/   body = claimRoot
   - on 2xx   → deserialize SSFClaimResponse
                 status = OK
                 responseData = result
   - on non-2xx → parse ErrorRoot.issue
                  - text as string → tempErrorMsg
                  - else ErrorRoot → "({errorCode}) {message}"
                  status = Failed
   - look up claimReferenceNo = identifier[type.coding[code="mr"]].value
     (fallback to SSFClaimResponse.id)
   - upsert PAT_SSFClaimResponseDetails
     - by ClaimCode from responseInfo
     - increment ClaimCount
     - update ResponseStatus, ClaimStatus, ResponseDate, ClaimedDate,
       ResponseData, ClaimReferenceNo
   - if success: set IsClaimed = true on all PAT_SSF_ClaimBooking rows
     where LatestClaimCode.ToString() == claimRoot.clientClaimId
   ↓
return { ResponseStatus, ErrorMessage }
```

### 5.5 Eligibility Refresh on Free Follow-up / Free Referral

```
VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral
   ↓
   - if parent visit is IsClaimed (PAT_SSFClaimResponseDetails):
       call CheckSSFPatientEligibility(parentPolicyNo)
       - POST {SSFurl}/CoverageEligibilityRequest/
       - find Medical / Accident entry, get OpdBalance / IPBalance
       - update PAT_MAP_PatientSchemes.OpCreditLimit,
         IpCreditLimit, GeneralCreditLimit
```

### 5.6 Local Claim Status (no SSF HTTP call)

Used by `SsfService.isClaimed` to short-circuit and avoid re-fetching the patient when the latest claim is already submitted.

```
GET /api/SSF/CheckClaimStatusLocally?latestClaimCode=&patientId=
   ↓
SSFService.IsClaimed
   - patientId == 0 → throw "Patient Detail is not provided"
   - claimCode == 0 → return false
   - PAT_SSFClaimResponseDetails.FirstOrDefault(PatientId, ClaimCode)
   - return ResponseStatus == true
```

### 5.7 Claim Detail (read-through)

```
GET /api/SSF/GetClaimDetail?ClaimUUID={uuid}
   ↓
SSFService.GetClaimDetail → GET {SSFurl}/Claim/{ClaimUUID}/
   - deserializes into EmployerRoot (note: this is a bug in the
     reference — the wrong DTO is used and `data` is never returned)
   - always returns new EmployerRoot()
GET /api/SSF/GetClaimBookingDetail?claimCode={code}
   ↓
SSFService.GetClaimBookingDetail
   - select from PAT_SSF_ClaimBooking
     where LatestClaimCode = claimCode
       and IsActive = true
       and IsClaimed = false
   - projects PatientId, HospitalNo, PolicyNo, LatestClaimCode,
     BillingInvoiceNo, PharmacyInvoiceNo, BookingStatus
```

---

## 6. API Endpoints

All endpoints live under `api/SSF` and return `DanpheHTTPResponse<object>`. `PAT_SSF` is not in the path; the controller name is `SSFController`.

| # | Method | Route | Request | Response | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | GET | `/api/SSF/GetSSFPatientData` | `?PatientId={policyNo}` | `SSFPatientDetails` | Calls `SSF /Patient/?identifier={policyNo}`. Adds `ssfEmployerList` by chaining `GetSsfEmployerList`. |
| 2 | POST | `/api/SSF/CheckSSFEligibility` | `?PatientId={policyNo}&VisitDate={yyyy-MM-dd}` | `List<EligibilityResponse>` (2 entries: Medical + Accident) | Calls `SSF /CoverageEligibilityRequest/`. Throws "Scheme Search KeyWord not matched." when neither the Medical nor the Accident keyword is found. |
| 3 | GET | `/api/SSF/GetEmployerList` | `?SSFPatientUUID={uuid}` | `List<List<Company>>` | Calls `SSF /Employee/{uuid}/`. |
| 4 | POST | `/api/SSF/SubmitClaim` | `ClaimRootDTO` (body) | `{ ResponseStatus, ErrorMessage }` | Calls `SSF /Claim/`. Upserts `PAT_SSFClaimResponseDetails`. On success, sets `IsClaimed = true` on matching booking rows. |
| 5 | POST | `/api/SSF/BookClaim` | `ClaimBookingRoot_DTO` (body) | `{ ResponseStatus, ErrorMessage }` | Calls `SSF /BookingService`. Inserts or updates `PAT_SSF_ClaimBooking` for both success and failure paths. |
| 6 | GET | `/api/SSF/GetClaimBookingDetail` | `?claimCode={Int64}` | `Array<{ PatientId, HospitalNo, PolicyNo, LatestClaimCode, BillingInvoiceNo, PharmacyInvoiceNo, BookingStatus }>` | Filters `IsActive = true AND IsClaimed = false`. |
| 7 | GET | `/api/SSF/GetClaimDetail` | `?ClaimUUID={uuid}` | `EmployerRoot` (always empty in current code) | Calls `SSF /Claim/{uuid}/`. The deserialized result is never returned because the wrong DTO is in use. |
| 8 | GET | `/api/SSF/CheckClaimStatusLocally` | `?latestClaimCode={Int64}&patientId={int}` | `bool` | Reads `PAT_SSFClaimResponseDetails`. Throws "Patient Detail is not provided to check Claim Status" when `patientId == 0`. |
| 9 | GET | `/api/SSF/GetSSFPatientDetailLocally` | `?patientId={int}&schemeId={int}` | `PatientSchemeMapModel` | Reads `PAT_MAP_PatientSchemes`. Returns null when the row is missing. |

### HTTP request shape (typical)

```http
POST /BookingService HTTP/1.1
Host: <SSFurl>
Authorization: Basic base64(SSFUsername:SSFPassword)   # ISO-8859-1 encoded
{sSFRemotekey}: {SSFRemoteValue}
Content-Type: application/json

{
  "bookedAmount": 1234.56,
  "Patient": "<PolicyHolderUID>",
  "scheme": "1" | "2",
  "subProduct": 1,
  "client_claim_id": "987654",
  "client_invoice_no": "BL12345"
}
```

```http
POST /Claim/ HTTP/1.1
Host: <SSFurl>
Authorization: Basic base64(SSFUsername:SSFPassword)
{sSFRemotekey}: {SSFRemoteValue}
Content-Type: application/json

{
  "resourceType": "Claim",
  "clientClaimId": "987654",
  "type": { "text": "..." },
  "billablePeriod": { "start": "...", "end": "..." },
  "created": "...",
  "enterer": { "reference": "..." },
  "facility": { "reference": "..." },
  "provider": { "reference": "..." },
  "extension": [ { "url": "...", "valueString": "..." } ],
  "diagnosis": [
    { "sequence": 1,
      "diagnosisCodeableConcept": { "coding": [ { "code": "..." } ] },
      "type": [ { "text": "..." } ] }
  ],
  "item": [
    { "sequence": 1,
      "category": { "text": "..." },
      "productOrService": { "text": "..." },
      "quantity": { "value": "1" },
      "unitPrice": { "value": "..." },
      "extension": [ ... ] }
  ],
  "total": { "value": 1234.56 },
  "patient": { "reference": "Patient/{policyNo}" },
  "supportingInfo": [
    { "category": { "coding": [...], "text": "..." },
      "valueAttachment": {
        "contentType": "application/pdf",
        "creation": "...",
        "data": "<base64>",
        "hash": "...",
        "title": "..." } }
  ]
}
```

### Error envelope (SSF → Danphe)

The SSF server returns a FHIR-style `OperationOutcome` envelope on errors. The reference parses two shapes:

1. `text` is a plain string → returned verbatim.
2. `text` is an object → `({errorCode}) {message}` for each `issue`.

Both are joined with `,` and the trailing comma is stripped.

---

## 7. Cross-Module Integration

### 7.1 Patient

- `SSFPatientDetails` reuses `Patient.FirstName` / `LastName` / `DateOfBirth` / `Gender` and the address returned by the SSF server. The SSF server's value is preferred (it is the authoritative record for SSF members).
- `PAT_MAP_PatientSchemes` is the local mirror of the SSF membership and is the table that links a patient to the SSF scheme.
- `VisitBL.SavePatientScheme` is the only place that creates or updates `PAT_MAP_PatientSchemes` for SSF members.

### 7.2 Visits

- `SSFService` uses `PAT_PatientVisits` indirectly through `VisitModel` in `SSFDbContext`. A real SSF claim is always anchored to a `ClaimCode` that originates from the visit module.
- `VisitController` instantiates an `SSFDbContext` and passes it to `VisitBL.SavePatientScheme` so the realtime booking can be logged on the same flow.
- `VisitBL.IsClaimed` is called from `SsfService.isClaimed` and from `UpdatePatientSchemeForFreeFollowupAndFreeReferral`.

### 7.3 Billing

- `BIL_TXN_BillingTransaction` is the source of `InvoiceNo` and `TotalAmount` for `SSF_ClaimBookingBillDetail_DTO`.
- `BillingBL.SyncToSSFServer` is invoked by every place that produces an SSF-priced invoice:
  - `VisitBL.SavePatientScheme` (line ~628)
  - `BillingController` (line ~8243)
  - `DischargeBillingController` (line ~589)
  - `BillReturnController` (line ~650)
- `BillingBL.GetSSFCredentials` is a private duplicate of the credential loader — keep in sync with `SSFService.GetSSFCredentials` and `VisitBL.GetSSFCredentials`.

### 7.4 Pharmacy

- `PharmacySalesController` (~875) and `PharmacySalesController` (~1818) both call `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` on SSF-priced invoices. `PharmacySalesReturnController` (~254) does the same for returns.
- `moduleName` becomes `ENUM_ModuleNames.IpPharmacy` or `OpPharmacy`, which `PostToClaimBookingLog` uses to set `PharmacyInvoiceNo` instead of `BillingInvoiceNo`.

### 7.5 Insurance

- The Insurance module's `ENUM_Scheme_ApiIntegrationNames.SSF` is the discriminator that the `SsfClaimSelectionGuardService` route guard checks before allowing navigation to `/ClaimManagement/SsfClaim`.
- `GovInsuranceController` is not used by the SSF path, but the Insurance module's `PAT_MAP_PatientSchemes` table is the same one the SSF module writes to.

### 7.6 Accounting

- The reference does not post any accounting entry for SSF claims. SSF revenue is implied via the standard billing-to-accounting flow (`BIL_TXN_BillingTransaction` posts an accounting event the same way as a non-SSF invoice).

### 7.7 Claim Management (UI host)

- `claim-management/ssf-claim` and `claim-management/shared/ssf-claim-selection-guard` are the only places in the frontend that know about the SSF scheme. The guard reads the active insurance provider, calls `ClaimManagementService.getRespectiveApiIntegrationName(OrganizationId)`, and only allows the route to load if the integration name equals `ENUM_Scheme_ApiIntegrationNames.SSF`.

---

## 8. Business Rules

### 8.1 Scheme & Sub-product mapping

| `PAT_MAP_PatientSchemes.RegistrationCase` | `ENUM_SSF_SchemeTypes` | `SubProduct` |
| --- | --- | --- |
| `Accident` (case-insensitive) | `"1"` (Accident) | `null` |
| `Medical` (case-insensitive) | `"2"` (Medical) | `1` |

Implemented in `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` and `SSFService.PrepareClaimBooking`.

### 8.2 Real-time vs deferred booking

`MyConfiguration.RealTimeSSFClaimBooking` is read once per request and threaded into `VisitBL.SavePatientScheme`. When `true` and the price category is `SSF`, a `Task.Run(() => BillingBL.SyncToSSFServer(...))` is fired. The user-facing request is not blocked and no exception is bubbled out of the booking — failures are recorded on the booking row.

### 8.3 Idempotency of `Claim` submission

A re-submission of the same `ClaimCode` updates the existing `PAT_SSFClaimResponseDetails` row in place:

- `ClaimReferenceNo` is re-derived from the latest response (with the UUID fallback).
- `ClaimStatus`, `ResponseData`, `ClaimedDate`, `ResponseDate` are overwritten.
- `ResponseStatus` is set from `response.IsSuccessStatusCode`.
- `ClaimCount` is incremented.

If a row does not exist, a new one is inserted with `ClaimCount = 1` and `ClaimRequestDate == ClaimedDate`.

### 8.4 Idempotency of `Booking`

`SaveSuccesfulClaimBooking` and `SaveUnsuccessfulClaimBooking` both look up an existing row by:

- `BillingInvoiceNo` if present, else
- `PharmacyInvoiceNo`.

When found, they update `ReBookedBy`, `ReBookingDate`, `ResponseData` (empty on failure), `BookingResponseDate` (only on success), and `BookingStatus`. When not found, they insert a new row with `IsClaimed = false`, `IsActive = true`, `BookingRequestDate = DateTime.Now`, `BookedBy = currentUser.EmployeeId`.

### 8.5 `IsClaimed` flip

`SSFService.SubmitClaim` only flips `PAT_SSF_ClaimBooking.IsClaimed = true` when the HTTP call to `Claim/` succeeded. The `LatestClaimCode.ToString() == claimRoot.clientClaimId` comparison is string-based, so a mismatched type can silently miss bookings.

### 8.6 Eligibility parsing

`ParseSSFEligibilityResponse` reads two rows from the SSF response indexed by:

- `Medical` keyword from `CORE_CFG_Parameters` group `SSF`, name `SsfSearchStringForSchemeNames`, key `Medical` (default `"Medical"`).
- `Accidental` keyword from the same row, key `Accidental` (default `"Accidental"`).

If either is missing, the method throws `"Scheme Search KeyWord not matched."`. The Medical row's `extension[1].valueString` and `extension[2].valueString` are interpreted as `OpdBalance` and `IPBalance` respectively; the Accident row's `allowedMoney` / `usedMoney` populate `AccidentBalance` / `UsedMoney`.

### 8.7 Authentication

Every SSF HTTP call uses HTTP Basic Auth:

- User/pass are concatenated with `:`, encoded as `ISO-8859-1`, then base64.
- Header: `Authorization: Basic <base64>`.
- A second header is added dynamically: `{SSFRemotekey}: {SSFRemoteValue}`.
- The base URL is read from `SSFurl`; the path is appended without a leading slash on the realtime path (`"BookingService"`) and with a leading slash on the controller path (`"Claim/"`).

### 8.8 ClaimReferenceNo extraction

The reference pulls the `identifier` whose `type.coding[0].code == "mr"` (case-insensitive). If none match, the entire `identifier` value is left null in the request flow and `serializeData.id` is used as the `ClaimReferenceNo` fallback so the row is still recoverable by UUID later.

### 8.9 Free follow-up / free referral eligibility refresh

When a free follow-up is created against a parent visit that is already `IsClaimed` on the SSF side, `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral`:

1. Calls `CheckSSFPatientEligibility` against the parent's `PolicyNo`.
2. Picks the entry where `SsfEligibilityType == RegistrationCase` (case-insensitive).
3. Updates `PAT_MAP_PatientSchemes.OpCreditLimit`, `IpCreditLimit`, `GeneralCreditLimit` from the SSF response.

The eligibility values used here come from the same SSF response parsed by `SSFService.ParseSSFEligibilityResponse`, but the path in `VisitBL` is a hand-rolled copy because `SSFService` was not in scope when the feature was added.

### 8.10 Hard-coded scheme IDs

`ENUM_SSF_SchemeTypes` (`Accident = "1"`, `Medical = "2"`) is documented as "These values are provided from SSF Side" and "Please do not change unless changed from SSF side". Any change must be coordinated with the SSF board.

### 8.11 `PriceCategoryId` is legacy

`PatientSchemeMapModel.PriceCategoryId` is still read by `VisitBL.SavePatientScheme` (`ssfPriceCategory.PriceCategoryName.ToLower() == "ssf"`) to detect the SSF price category, but it is marked for removal in a future migration. Any new code should key on `SchemeId` instead.

### 8.12 Empty / failed claim detail

`SSFService.GetClaimDetail` deserializes the response into `EmployerRoot` (the wrong DTO) and the deserialized value is discarded; the method always returns `new EmployerRoot()`. UI consumers should not rely on this endpoint until the response model is corrected.

### 8.13 Patient eligibility (UI) precedence

`SsfService.GetSsfPatientDetailAndEligibilityFromSsfServer` only fills `patientEligibility` when the member has at least one policy where `Inforce === true`. Members with no `Inforce` policies return an empty `patientEligibility` array even though the SSF server returned data.

### 8.14 No background retry

There is no background worker that retries failed `Claim/` or `BookingService` posts. A failed submission is recorded on the booking row (`BookingStatus = false`) or on the claim response row (`ResponseStatus = false`) and the user is expected to re-trigger from the SSF claim UI.

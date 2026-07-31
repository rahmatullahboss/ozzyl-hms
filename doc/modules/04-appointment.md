# DanpheEMR — Appointment & Visit Module

> **Module code path in repo:** `Code/Websites/DanpheEMR/Controllers/Appointment/`, `Code/Components/DanpheEMR.ServerModel/AppointmentModels/`, `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/appointments/`
> **Module role:** Front-desk OPD registration, appointment scheduling, walk-in/online visit creation, follow-up / referral / transfer, OPD ticket billing integration, queue token generation.

This document describes the DanpheEMR Appointment module as it exists in the reference source. It is a faithful reference for the current Cloudflare-native HMS migration. Names like `Provider` were renamed to `Performer` during the 2022 refactor; both names appear in the source. Where the source still uses `ProviderId`/`ProviderName`, this doc notes the modern `PerformerId`/`PerformerName` equivalent.

---

## 1. Module Overview

The Appointment module is the entry point for **Out-Patient Department (OPD)** workflows. It combines three concerns that the codebase has historically kept in the same controllers:

1. **Scheduling future appointments** against a specific doctor or department (`PAT_Appointment` table).
2. **Creating walk-in / scheduled patient visits** in the OPD, which also posts an OPD ticket billing transaction (`PAT_PatientVisits`, `BIL_TXN_BillingTransaction`).
3. **Visit continuation** — turning an existing visit into a *follow-up*, *referral*, or *transfer* with appropriate billing and parent-visit linkage.

There is no separate "scheduling" subsystem in DanpheEMR: a "scheduled appointment" is a row in `PAT_Appointment`, and the conversion of that row into a real visit happens inside the visit-creation transaction. The `AppointmentController` exposes a thinner CRUD surface for the appointment row; the heavy lifting (patient + visit + bill + scheme + queue) lives in `VisitController` and `VisitBL`.

### High-level OPD flow (walk-in)

```
PatientSearch / PatientList
   -> VisitMain (visit-create page)
        -> AddPatient (PAT_Patient)
        -> AddVisit    (PAT_PatientVisits)
        -> AddBillingTransaction (BIL_TXN_BillingTransaction + BIL_TXN_BillingTransactionItems)
        -> SavePatientScheme (PAT_MAP_PatientSchemes, BIL_TXN_CreditBillStatus for credit schemes)
        -> SP_VISIT_SetNGetQueueNo (queue token)
        -> Print OPD Sticker + Receipt
```

### High-level appointment flow (scheduled)

```
CreateAppointment (appt-new)
   -> AddAppointment (PAT_Appointment) -- status = "initiated"
   -> ListAppointment shows rows for the day / doctor
   -> Check-in action -> VisitMain with appointment context pre-loaded
        -> Creates Visit + Bill + Scheme + Queue (same as walk-in)
        -> PutAppointmentStatus(checkedin) marks the appointment row as "checkedin"
```

### High-level follow-up / referral / transfer flow

```
ListVisit  (visits in last N days)
   -> FollowUp | Referral | Transfer action
        -> Creates a NEW Visit row with:
              AppointmentType = "followup" | "referral" | "Transfer"
              ParentVisitId   = original visit's PatientVisitId
              IsVisitContinued on parent = true
        -> For free follow-up / free referral: no bill (BillingStatus = "free").
        -> For paid follow-up / paid referral: full new bill via VisitForPaidFollowup.
        -> For transfer: previous visit's bill is RETURNED and parent visit is set to IsActive = false.
```

### Online appointment flow (Telemedicine integration)

```
Online portal (external) -> web service -> PAT_Appointment row with PatientId null
   -> OnlineAppointmentMainComponent (OnlineAppointment/PendingList)
        -> User assigns patient + visit context
        -> VisitFromOnlineAppointment endpoint creates the visit
```

---

## 2. Backend Files

| File | Role | Key types / methods |
|---|---|---|
| `Controllers/Appointment/AppointmentController.cs` | Web API for appointment scheduling. | `Appointments`, `AddAppointment`, `UpdateAppointment`, `AppointmentStatus`, `CheckClashingAppointment`, `PatientsWithAppointments`, `MembershipDetail`, `AppointmentApplicableDepartments`, `UpdatePatientInAppointment`, `AppointmentInformation`. |
| `Controllers/Appointment/AppointmentViewController.cs` | Server-side MVC view controller (pre-Angular pipeline). It still serves `.cshtml` views for legacy pages. | `Visit()`, `CreateAppointment()`, `Appointment()`, `ListAppointment()`, `ListVisit()`, `PrintSticker()`, `SearchPatient()`. Decorated with `[DanpheViewFilter(...)]` for RBAC. |
| `Controllers/Appointment/VisitController.cs` | Main Web API for visit creation, list, history, billing-items, and free/paid continuation. 2354 lines. | `NewVisit`, `VisitFromOnlineAppointment`, `VisitFromBilling`, `VisitForFreeReferral`, `VisitForFreeFollowup`, `VisitForPaidFollowup`, `DefaultVisitCreate`, `UpdateBillStatus`, `UpdateSignedStatus`, `CheckExistingAppointment`, `VisitsByClaimCode`, `PatientVisitStickerInfo`, `DepartmentOfIpdVisit`, `PatientVisitHistory`, `PatientTodaysVisits`, `PatientVisitsWithDoctors`, `PatientCurrentVisitContext`, `DoctorNewOpdBillingItems`, `DepartmentNewOpdBillingItems`, `DoctorFollowupBillingItems`, `DepartmentFollowupBillingItems`, `DepartmentOldPatientBillingItems`, `DoctorOldPatientBillingItems`, `DoctorOpdReferralBillingItems`, `AppointmentApplicableDoctors`, `VisitsSignedByDoctor`, `PatientHealthCardWithBillInfo`, `ListVisits`, `VisitsByStatus`, `GetMemberInformationByScheme`, `GetPatientCreditLimitsByScheme`, `GetLatestClaimCode`, `GetRank`, `PostRank`, `GetDependentIdDetails`, `UpdateDendentId`. |
| `Controllers/Appointment/VisitBL.cs` | Static business-logic class for visit creation, scheme handling, SSF claim sync, claim-code generation, queue generation, follow-up validity. 886 lines. | `GetPatientLatestVisit`, `HasDuplicateVisitWithSameProvider`, `GetValidForFollowUp`, `GetProviderName`, `UpdateVisitCode`, `CreateNewPatientVisitCode`, `GetVisitItemsMapped`, `CreateNewPatientQueueNo`, `IsValidForFollowUp`, `SavePatientScheme`, `UpdateMedicareMemberBalance`, `GetLatestClaimCode`, `AddEmpCashtransactions`, `SyncBillToRemoteServer`, `UpdateRequisitionItemsBillStatus`, `ReAssignProviderTxn`, `IsClaimed`, `UpdatePatientSchemeForFreeFollowupAndFreeReferral`. |

**Important deprecated / dead code:** `AppointmentController.cs` lines 124–803 contain a large block of commented-out `reqType`-based routes from the pre-controller era. The legacy endpoints (`reqType=getAppointments`, `reqType=doctorschedule`, `quickAppointment`, `reqType=updatePatientId`, `reqType=updateAppStatus`, etc.) are commented out and should not be revived.

---

## 3. Data Models

All models live under namespace `DanpheEMR.ServerModel` and `DanpheEMR.ServerModel.AppointmentModels`.

### 3.1 `AppointmentModel` — `PAT_Appointment`

| Field | Type | Notes |
|---|---|---|
| `AppointmentId` | int (PK) | Identity. |
| `PatientId` | int? | Nullable — appointments can be scheduled against a patient who does not exist yet (phone-only or walk-in booking). |
| `FirstName`, `MiddleName`, `LastName` | string | Snapshot at booking time; visit may later bind a real patient. |
| `Gender` | string | |
| `Age` | string | Text "30", "5m" — see `AppointmentService.SeperateAgeAndUnit`. |
| `ContactNumber` | string | |
| `AppointmentDate` | DateTime | Truncated to date for clash checks. |
| `AppointmentTime` | TimeSpan | |
| `PerformerId` | int? | Renamed from `ProviderId`. Doctor's EmployeeId. Nullable for department-level appointments. |
| `PerformerName` | string | Renamed from `ProviderName`. |
| `AppointmentType` | string | `New`, `followup`, `transfer`, `referral`. |
| `AppointmentStatus` | string | `initiated`, `checkedin`, `cancelled`, `concluded`. |
| `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` | audit | |
| `Reason` | string | Free-text reason (added per TFS task 152). |
| `CancelledOn`, `CancelledBy`, `CancelledRemarks` | string | Populated on cancellation. |
| `DepartmentId` | int? | For department-level appointments. |

### 3.2 `VisitModel` — `PAT_PatientVisits`

The visit model is the heart of the OPD workflow. It carries the OPD ticket, the parent-visit linkage, the queue position, the scheme, the billing status, and references to clinical sub-tables.

| Field | Type | Notes |
|---|---|---|
| `PatientVisitId` | int (PK) | Identity. |
| `VisitCode` | string | Generated. Prefix `V` for outpatient, `H` for inpatient, `ER` for emergency + 2-digit year + 5-digit serial (see `VisitBL.CreateNewPatientVisitCode`). |
| `PatientId` | int (FK) | |
| `VisitDate` | DateTime | |
| `QueueStatus` | string | |
| `PerformerId` / `PerformerName` | int? / string | Renamed from `ProviderId` / `ProviderName`. Doctor. |
| `Comments` | string | |
| `ReferredBy` | string | Free text. |
| `VisitType` | string | `outpatient`, `inpatient`, `emergency`. |
| `VisitStatus` | string | `initiated`, `cancel`, `concluded`. |
| `VisitTime` | TimeSpan? | |
| `VisitDuration` | int? | |
| `AppointmentId` | int? | Links back to the originating `PAT_Appointment` row, if any. |
| `BillingStatus` | string | `paid`, `unpaid`, `provisional`, `cancel`, `returned`, `free`. |
| `ReferredById` | int? | EmployeeId of the referrer. |
| `AppointmentType` | string | `New`, `followup`, `referral`, `Transfer`. |
| `ParentVisitId` | int? | The previous visit in the chain. |
| `IsVisitContinued` | bool | Set to `true` on parent when a follow-up / referral / transfer child is created. |
| `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` | audit | |
| `IsActive` | bool | Set to `false` on the parent of a transfer (the old visit is closed). |
| `IsTriaged` | bool | Triage flag. |
| `Remarks` | string | |
| `ClaimCode` | long? | Insurance / SSF / Medicare claim code. `Int64` since 1-Oct-2021. |
| `IsSignedVisitSummary` | bool | Doctor has signed the summary. |
| `PrescriberId` | int? | For transfer visits — the doctor who originated. |
| `ConcludeDate` | DateTime? | |
| `CurrentCounterId` | int? | NotMapped — counter context for billing during transfer / referral. |
| `DepartmentId` | int | Required from 19-Jun-2019 (department-level appointment). |
| `DepartmentName` | string | NotMapped. |
| `Patient` | PatientModel (nav) | |
| `Admission` | AdmissionModel (nav) | |
| `Vitals`, `InputOutput`, `Notes` | collections | Clinical sub-tables. |
| `ImagingRequisitions`, `ImagingReports` | collections | Radiology sub-tables. |
| `QueueNo` | int? | Set by `SP_VISIT_SetNGetQueueNo`. |
| `Ins_HasInsurance` | bool | |
| `IsLastClaimCodeUsed` | bool | NotMapped. |
| `PriceCategoryId` | int | EHS, Foreigner, SAARC, etc. |
| `SchemeId` | int | Billing scheme id. |
| `TicketCharge` | decimal | For new billing structure (Mar-2023). |
| `SubSchemeId` | int? | |
| `IsFreeVisit` | bool | |

### 3.3 `AppointmentDay` (helper) — `DanpheEMR.ServerModel.Helpers`

`AppointmentDay` is a wrapper used to format an array of `AppointmentModel` into `SingleAppointment(StartTime, EndTime)` for the doctor-schedule / clash-detection UI. The end time of each slot is hard-coded as **start time + 20 minutes** in `AppointmentDay.FormatData`. `GetClashingAppointments` checks overlap, including boundary conditions, against a list of existing appointments and a requested slot + duration.

### 3.4 `Rank` (model) — `DanpheEMR.ServerModel.AppointmentModels`

`Rank` is a small lookup table used by the APF (Armed Police Force) hospital integration. Fields: `RankId` (PK), `RankName`, `IsActive`. `RankNameDTO` is a thin wrapper for the post body of `PostRank`.

### 3.5 View Models (under `AppointmentModels/AppointmentVMs.cs`)

| View Model | Purpose |
|---|---|
| `QuickAppointmentVM` | Patient + Appointment + BillingTransaction + Visit + CreatedOn/By — used by the deprecated `QuickAppointmentCreate` flow. |
| `QuickVisitVM` | Patient + BillingTransaction + Visit + PatientCareTaker_DTO — the actual payload for `NewVisit` and `VisitForPaidFollowup`. |
| `ListVisitsVM` | The "List Visit" page projection. Adds `DepartmentName`, `PatientCode`, `ShortName`, `PhoneNumber`, `DateOfBirth`, `Gender`, `QueueNo`, `IsValidForFollowup`, `CountrySubDivisionName`, `TopParentVisit` (recursive), and the parent-visit chain. |
| `PatientCareTaker_DTO` | `CareTakerName`, `RelationWithPatient`, `CareTakerContact` — used by the guarantor table. |

### 3.6 DTOs (frontend) — `wwwroot/.../appointments/shared/dto/`

| DTO | Used by |
|---|---|
| `PatientMemberInfo_DTO` | `GetMemberInformationByScheme` — member-no, policy holder, credit limits. |
| `FreeVisitSettings_DTO` | `visit-info` component toggles for free visit / department-level / doctor-level. |
| `NewClaimCode_DTO` | `GetLatestClaimCode` — `{ NewClaimCode, IsMaxLimitReached }`. |
| `PatientLatestVisitContext_DTO` | Common class for the patient's most recent visit (used by billing). |
| `PatientCareTaker_DTO` | Mirrors the server VM. |

---

## 4. Database Tables

DanpheEMR uses Entity Framework Code First with explicit `ToTable` mappings. The Appointment module touches a wide set of tables, with `PAT_PatientVisits` and `PAT_Appointment` being the central two.

### 4.1 Core tables

| Table | Source model | Notes |
|---|---|---|
| `PAT_Appointment` | `AppointmentModel` | Future / today's scheduled appointments. |
| `PAT_PatientVisits` | `VisitModel` | Walk-in + scheduled visits, follow-ups, transfers, referrals. |
| `PAT_Patient` | `PatientModel` | Master patient record. |
| `PAT_MAP_PatientSchemes` | `PatientSchemeMapModel` | Patient's scheme membership. |
| `PAT_PatientGurantorInfo` | `GuarantorModel` | Caretaker. |
| `PAT_APF_Rank` | `Rank` | APF integration lookup. |
| `PAT_SSFClaimResponseDetails` | `SSFClaimResponseDetails` | SSF claim response cache. |

### 4.2 Billing-side tables written by visit creation

| Table | Source model | Notes |
|---|---|---|
| `BIL_TXN_BillingTransaction` | `BillingTransactionModel` | OPD ticket invoice. |
| `BIL_TXN_BillingTransactionItems` | `BillingTransactionItemModel` | Per-line item; OPD ticket is one line. |
| `BIL_TXN_CreditBillStatus` | `BillingTransactionCreditBillStatusModel` | One row per credit-mode bill. |
| `BIL_TXN_InvoiceReturn` | `BillInvoiceReturnModel` | Returned bill (transfer). |
| `TXN_EmpCashTransaction` | `EmpCashTransactionModel` | Cashier's cash collection. |
| `BIL_CFG_Scheme` | `BillingSchemeModel` | Reference only. |
| `BIL_CFG_SubScheme` | `BillingSubSchemeModel` | Reference only. |
| `BIL_CFG_PriceCategory` | `PriceCategoryModel` | EHS, Foreigner, etc. |
| `BIL_MST_Credit_Organization` | `CreditOrganizationModel` | Insurance / corporate org. |
| `BIL_MST_ServiceItem` | `BillServiceItemModel` | OPD service item master. |
| `BIL_MST_ServiceDepartment` | `ServiceDepartmentModel` | Lookup (used to set `txnItem.ServiceDepartmentId`). |
| `BIL_MAP_PriceCategoryServiceItem` | `BillMapPriceCategoryServiceItemModel` | Joins service item to price category. |

### 4.3 Master / parameter tables

| Table | Notes |
|---|---|
| `EMP_Employee` | All employees, including appointment-applicable doctors (`IsAppointmentApplicable=true`). |
| `MST_Department` | Departments. `IsAppointmentApplicable=true` ones appear in the appointment UI. |
| `MST_CountrySubDivision` | District. Used to build EMPI on first-time patient registration. |
| `MST_Country` | Country. |
| `CORE_CFG_Parameters` | Drives `EnableDepartmentLevelAppointment`, `MaximumLastVisitDays`, `VisitTimeDifferenceMinutes`, `APFUrlForPatientDetail`, `ClaimCodeAutoGenerateSettings`, `AllowedDepartmentsForScheme`, `ERDepartmentName`, etc. |
| `LAB_TestRequisition` | Lab bill line for "free" follow-up rules. |
| `RAD_PatientImagingRequisition` | Radiology bill line. |
| `ADT_PatientAdmission` | Admission. |
| `ER_Patient` | Emergency visit linkage when `ERDepartmentName` matches. |
| `INS_MedicareMember` / `INS_MedicareMemberBalance` | Medicare scheme members. |

### 4.4 Stored procedures used

| Procedure | Called from | Purpose |
|---|---|---|
| `SP_VISIT_SetNGetQueueNo(@VisitId)` | `VisitBL.CreateNewPatientQueueNo` | Generates and returns a per-doctor queue token for the day. |
| `SP_APPT_GetVisitListOfValidDays(@SearchTxt, @RowCounts, @DaysLimit, @SearchUsingHospitalNo, @SearchUsingIdCardNo)` | `VisitController.ListVisits` | Server-paginated visit list with text search. |
| `SP_VIS_GetVisitStickerSettingsAndData(@PatientVisitId)` | `VisitController.PatientVisitStickerInfo` | Sticker print. |
| `SP_Claim_GenerateNewClaimCode(@SchemeId)` | `VisitBL.GetLatestClaimCode` | Incremental claim code per scheme. |

---

## 5. Key Workflows

### 5.1 Book a new appointment (phone / walk-in pre-booking)

1. `AppointmentCreateComponent` (appt-new) collects patient demographics and a date/time slot.
2. `AppointmentBLService.PostAppointment` -> `AppointmentController.AddAppointment` (POST `/api/Appointment/AddAppointment`).
3. `VisitBL.AddAppointment` adds a `PAT_Appointment` row. If `PatientId == 0`, the row is saved with `PatientId = null` and patient demographics (first/middle/last name, gender, age, contact) are snapshotted on the row.
4. `AppointmentController.AppointmentStatus` is later called to mark the row as `cancelled` (with `CancelledOn`/`CancelledBy`/`CancelledRemarks`) or `checkedin`.

### 5.2 Check for a clashing appointment

`AppointmentController.CheckClashingAppointment` queries both `PAT_Appointment` and `PAT_PatientVisits` for the same `PatientId + AppointmentDate + PerformerId` to prevent double-booking the same patient to the same doctor on the same day.

The `AppointmentDay.GetClashingAppointments` helper applies a finer-grained **20-minute-slot overlap check** at the front-end.

### 5.3 Convert an appointment into a visit (check-in)

1. From the appointment list, the user clicks *Check-in*. The `appointment-list` component copies the appointment fields onto the global `Appointment` and `Patient` services, then navigates to `/Appointment/Visit` with `RouteFromService.RouteFrom = "appointment"`.
2. `VisitMainComponent.Initialize` (visit-main) sets `VisitDate` / `VisitTime` from the appointment, calls `LoadPatientsTodaysVisitListIntoService`, and renders the visit-create UI.
3. On submit, `VisitBLService.PostVisitToDB` POSTs a `QuickVisitVM` to `/api/Visit/NewVisit`. The route is overridden to `/api/Visit/VisitFromOnlineAppointment` when `RouteFrom == "onlineappointment"`.
4. `VisitController.CreatePatientVisit` runs the entire transaction:
   - duplicate-visit check via `VisitBL.HasDuplicateVisitWithSameProvider`,
   - `AddPatientForVisit` (creates the patient + EMPI if `PatientId == 0`),
   - `AddPatientCareTaker`,
   - `AddVisit` (visit row, claim code, parent-visit logic),
   - `AddEmergencyPatient` (when the visit type matches `ERDepartmentName`),
   - `AddBillingTransactionForPatientVisit` (invoice + lines + audit),
   - `VisitBL.SavePatientScheme` (scheme map + credit bill status + optional SSF real-time claim booking),
   - `UpdateIsContinuedStatus` when the appointment type is `transfer` / `referral`,
   - `VisitBL.UpdateMedicareMemberBalance` when the scheme is Medicare,
   - **commit transaction**,
   - `VisitBL.CreateNewPatientQueueNo` -> `SP_VISIT_SetNGetQueueNo`.
5. The appointment row is updated to `checkedin` via `AppointmentController.AppointmentStatus` (which back-fills `PatientId` from the new visit, so the original phone-only appointment row now points at the real patient).

### 5.4 Walk-in visit (no prior appointment)

Same as 5.3 but the user reaches `VisitMainComponent` via `PatientSearch -> Visit` and there is no pre-bound appointment. The visit is created with `VisitType = outpatient` (or `emergency` if department name matches `ERDepartmentName`) and `AppointmentType = New`. Billing is mandatory and posts a `BIL_TXN_BillingTransaction` with one OPD-ticket line per `BillMapPriceCategoryServiceItem`.

### 5.5 Cancellation

`AppointmentController.AppointmentInformation` (PUT `/api/Appointment/AppointmentInformation`) deserializes the appointment, attaches it, and sets `CancelledOn = DateTime.Now`, `CancelledBy = currentUser.EmployeeId`, while preserving `CreatedOn` / `CreatedBy`. The status is set to `cancelled` and the cancellation reason goes into `CancelledRemarks`.

### 5.6 OPD ticket pricing

The OPD ticket price is **not** a single global number. It is derived from the join of `EMP_Employee` -> `BIL_MST_ServiceItem` (via `OpdNewPatientServiceItemId` for a new-patient visit) -> `BIL_MAP_PriceCategoryServiceItem` (filter by `PriceCategoryId`, hard-coded to `1` for "Normal" in legacy code).

- `VisitController.GetDoctorNewOpdBillingItems` -> doctor-level new-patient OPD prices.
- `VisitController.GetDoctorFollowupBillingItems` -> doctor-level follow-up prices.
- `VisitController.GetDoctorOldPatientBillingItems` -> doctor-level old-patient prices.
- `VisitController.GetDoctorOpdReferralBillingItems` -> doctor-level referral prices.
- `VisitController.GetDepartmentNewOpdBillingItems` -> department-level new-patient OPD prices.
- `VisitController.GetDepartmentFollowupBillingItems` -> department-level follow-up prices.
- `VisitController.GetDepartmentOldPatientBillingItems` -> department-level old-patient prices.

The pricing list is loaded once at app start by `AppointmentsMainComponent.LoadDoctorAndDeptPricesToVisitService` into `VisitService.DocOpdPrices`, `DocFollowupPrices`, `DocOpdPrice_OldPatient`, `DocOpdPrice_Referral`, `DeptOpdPrices`, `DeptFollowupPrices`, `DeptOpdPrice_OldPatient`.

### 5.7 Department-level vs doctor-level appointment

Driven by `CoreCFG.EnableDepartmentLevelAppointment` (parameter group `Visit`, parameter name `EnableDepartmentLevelAppointment`):

- `true` -> `VisitController.CheckExistingAppointment` checks for an existing visit with the same `DepartmentId + PatientId + VisitDate`.
- `false` -> checks for an existing visit with the same `PerformerId + PatientId + VisitDate`.

`VisitInfoComponent` mirrors this client-side by toggling the `Doctor` form-control's required validator and switching the `FreeVisitSettings.EnableDoctorLevelAppointment` / `EnableDepartmentLevelAppointment` flags.

### 5.8 Follow-up visit (free or paid)

From `ListVisit` (visits in the last N days), clicking *Follow-Up* opens `FollowUpVisitComponent`:

- If the user does not change the doctor or department (or the price category is "Normal"), the system posts a **free** follow-up via `VisitController.CreateVisitForFreeFollowUp` -> `POST /api/Visit/VisitForFreeFollowup`.
  - Eligibility is checked via `VisitBL.IsValidForFollowUp` which compares the top-most parent visit's date against the `Appointment / MaximumLastVisitDays` core parameter.
  - The new visit's `BillingStatus` is `free`, no `BIL_TXN_BillingTransaction` is created.
  - If the scheme is co-payment, a fresh claim code is generated and the patient scheme map is updated via `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` (which also calls the SSF FHIR server asynchronously).
  - `UpdateIsContinuedStatus` sets `IsVisitContinued = true` on the parent visit.
- If the user changes the doctor, department, or the price category is not "Normal", the system posts a **paid** follow-up via `VisitController.VisitCreateForPaidFollowUp` -> `POST /api/Visit/VisitForPaidFollowup`, which reuses the full `NewVisit` transaction.

### 5.9 Referral visit (free or paid)

`TransferVisitComponent` is reused for referrals (`continuationType = "referral"`) by `VisitBLService.ContinueNextVisit`. The result posts to `POST /api/Visit/VisitForFreeReferral` (free) or `POST /api/Visit/NewVisit` with `AppointmentType = "Referral"` (paid). On free referral, the new visit inherits the parent's `PriceCategoryId`, `SchemeId`, and — if the scheme is co-payment — a fresh `ClaimCode`. The previous visit is marked `IsVisitContinued = true`.

### 5.10 Transfer visit

`TransferVisitComponent.Transfer` posts `POST /api/Visit/VisitForFreeReferral` (the controller is overloaded for both referral and transfer) with `AppointmentType = "Transfer"`. The transfer flow additionally:

1. Returns the previous OPD ticket invoice via `VisitBLService.PostReturnTransaction` (visit-main.html flow).
2. The previous visit is set to `IsActive = false` and `IsVisitContinued = true` (see `VisitController.UpdateIsContinuedStatus`).
3. The transfer visit's `PrescriberId` carries the original doctor's id, `ReferredById` carries the original doctor's id, and `ParentVisitId` references the prior visit.

### 5.11 Queue token generation

`VisitBL.CreateNewPatientQueueNo` calls `SP_VISIT_SetNGetQueueNo(@VisitId)`, which:

- Computes a per-doctor-per-day queue number.
- Stores it on `PAT_PatientVisits.QueueNo` and returns it.
- The visit is then printed on the OPD sticker and the doctor's live board can sort by `QueueNo` for the day.

### 5.12 Online (telemedicine) appointment -> visit

1. Online portal posts appointments to the local DB as `PAT_Appointment` rows with `PatientId = null`.
2. Reception staff opens `/Appointment/OnlineAppointment` -> `PendingList` to triage.
3. They pick / create a patient (`VisitController.GetAPIPatientDetail`, `GetDependentIdDetails`, `UpdateDendentId`) and click *Convert to Visit*.
4. The visit is created via `POST /api/Visit/VisitFromOnlineAppointment` -> `VisitController.CreateVisitForOnlineAppointment` (a slimmer version of `CreatePatientVisit` that does not insert into `ER_Patient` and does not run the follow-up logic).
5. `RouteFromService.RouteFrom = "onlineappointment"` makes `VisitMainComponent` preserve the original `VisitDate` / `VisitTime` and suppress the auto-incrementing visit-time interval.

### 5.13 Online (telemedicine) callback

`AppointmentDLService.updateVisitStatusInTelemedicine` and `updatePaymentStatus` PUT to the external telemedicine service using a bearer token stored in `sessionStorage` under `TELEMED_Token`. They are called from `VisitBLService.updateVisitStatusInTelemedicine` / `updatePaymentStatusInTelMed`.

### 5.14 Health card status

`VisitController.PatientHealthCardWithBillInfo` returns whether a `PAT_HealthCard` row exists and whether an active `BIL_TXN_BillingTransactionItems` row with `ItemName = "Health Card"` exists. The threshold bill item name is configured in `Core / Common / BillItemHealthCard`.

### 5.15 Claim-code generation

- `VisitController.GetLatestClaimCode` -> `VisitBL.GetLatestClaimCode` -> `SP_Claim_GenerateNewClaimCode`. This is used when `CFGParameters[Insurance / ClaimCodeAutoGenerateSettings].EnableAutoGenerate = true` and the patient is in a specific scheme.
- For non-auto schemes, `VisitController.AddVisit` falls back to a randomly generated `Int64` claim code (`Random.Next(1, 10000).ToString("D4") + Minute + Second`).
- For co-payment schemes on free follow-up / free referral, the visit re-generates a fresh claim code and updates `PAT_MAP_PatientSchemes.LatestClaimCode`.

### 5.16 SSF (Social Security Fund) real-time claim booking

`VisitBL.SavePatientScheme` triggers a fire-and-forget `Task.Run(() => BillingBL.SyncToSSFServer(...))` when:

- the patient's price category is "ssf" and
- the core parameter `RealTimeSSFClaimBooking` is enabled.

This posts the OPD claim to the SSF FHIR server asynchronously so the OPD flow is not blocked.

### 5.17 IRD Nepal real-time sync

If `RealTimeRemoteSyncEnabled` is true, the billing transaction is also pushed to the Nepal IRD (Inland Revenue Department) for sales-bill reporting. See `VisitBL.SyncBillToRemoteServer(billTxn, "sales", visitDbContext)`. Returns are similarly synced under `billType = "sales-return"`.

### 5.18 Sign-off

`VisitController.UpdateSignedStatus` (PUT `/api/Visit/UpdateSignedStatus?visitId=...`) sets `IsSignedVisitSummary = true` and stamps `ModifiedOn` / `ModifiedBy`. The doctor calls this from the clinical module after signing the visit summary.

### 5.19 Sticker & invoice print

- `VisitController.PatientVisitStickerInfo` -> `SP_VIS_GetVisitStickerSettingsAndData` (per-visit data + admin-configured sticker template).
- `VisitMainComponent` then opens the print popup (default focus is configurable via `Appointment / VisitPrintSettings / DefaultFocus`).

### 5.20 Follow-up day cap

- Server side: `VisitBL.IsValidForFollowUp` reads `Appointment / MaximumLastVisitDays` core parameter (int, days) and rejects free follow-ups whose topmost parent visit is older than the cap.
- Client side: `VisitBL.GetValidForFollowUp` is called from `VisitController.VisitsByStatus` to filter the list visit page; it walks the parent-visit chain via `AssignRootParentVisit_Recursive` and flags `IsValidForFollowup = false` for visits whose root parent is beyond the cap.
- Department-level appointment toggles use `Appointment / AllowedDepartmentsForScheme` (JSON) to constrain department choices per scheme.

---

## 6. API Endpoints

All endpoints are routed under `/api/...`. The `VisitController` and `AppointmentController` are the two route roots. RBAC is enforced by `[DanpheViewFilter(...)]` for the legacy view routes, while modern Web API routes use `RbacUser currentUser = HttpContext.Session.Get<RbacUser>("currentuser")` for write paths.

### 6.1 Appointment scheduling (`AppointmentController`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/api/Appointment/Appointments?FromDate=&ToDate=&performerId=` | List appointments in a date range. `performerId == 0` -> all, `== -1` -> only unassigned (`PerformerId IS NULL`). |
| GET | `/api/Appointment/CheckClashingAppointment?patientId=&requestDate=&performerId=` | True if the patient already has an appointment or visit with the same performer on the same day. |
| GET | `/api/Appointment/AppointmentApplicableDepartments` | Departments with `IsAppointmentApplicable = true`. |
| GET | `/api/Appointment/MembershipDetail?membershipTypeId=` | Returns `{ MembershipTypeId, DiscountPercent, MembershipTypeName }` (renamed from `Scheme` -- legacy name kept for backward compat). |
| GET | `/api/Appointment/PatientsWithAppointments?performerId=&requestDate=` | Today's appointments for a specific doctor (used by the live patient list / live queue board). |
| POST | `/api/Appointment/AddAppointment` | Create a new appointment. Body: `AppointmentModel` JSON. |
| PUT | `/api/Appointment/UpdatePatientInAppointment?appointmentId=&patientId=` | Bind an existing patient to a phone-only appointment. |
| PUT | `/api/Appointment/AppointmentStatus?appointmentId=&status=&PerformerId=&PerformerName=` | Update appointment status. If `status == "checkedin"`, back-fills `PatientId` from the linked visit. |
| PUT | `/api/Appointment/UpdateAppointment` | Update appointment fields. Preserves `CreatedOn`, `CreatedBy`, `PatientId`. |
| PUT | `/api/Appointment/AppointmentInformation` | Cancel an appointment. Sets `CancelledOn = now`, `CancelledBy = currentUser`. |

Legacy `[DanpheViewFilter(...)]` view routes on `AppointmentViewController`:

| Verb | Route | View name | Required permission |
|---|---|---|---|
| GET | `/Appointment/Visit` | Visit | `appointment-visit-view` |
| GET | `/Appointment/CreateAppointment` | CreateAppointment | `appointment-createappointment-view` |
| GET | `/Appointment/CreateAdmission` | CreateAdmission | none (admission creation) |
| GET | `/Appointment/Appointment` | Appointment | `appointment-view` |
| GET | `/Appointment/ListAppointment` | ListAppointment | `appointment-listappointment-view` |
| GET | `/Appointment/ListVisit` | ListVisit | `appointment-listvisit-view` |
| GET | `/Appointment/PrintSticker` | PrintSticker | none (shared module) |
| GET | `/Appointment/SearchPatient` | SearchPatient | `appointment-patientsearch-view` |

### 6.2 Visit / OPD (`VisitController`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/api/Visit/CheckExistingAppointment?requestDate=&departmentId=&patientId=&inputProviderId=` | Same as clashing check, but with department-level fallback. |
| GET | `/api/Visit/VisitsByClaimCode?claimCode=` | All non-returned, non-cancelled visits for a claim code. |
| GET | `/api/Visit/PatientVisitStickerInfo?visitId=` | Sticker template + visit data via `SP_VIS_GetVisitStickerSettingsAndData`. |
| GET | `/api/Visit/DepartmentOfIpdVisit?visitId=` | Returns `{ DepartmentId }` for the visit (used for billing). |
| GET | `/api/Visit/PatientVisitHistory?patientId=` | All non-returned visits for a patient. |
| GET | `/api/Visit/PatientTodaysVisits?patientId=` | Today's visits for a patient. |
| GET | `/api/Visit/PatientVisitsWithDoctors?patientId=` | Distinct doctor list from the patient's visits, capped by `MaximumLastVisitDays`. |
| GET | `/api/Visit/PatientCurrentVisitContext?patientId=&visitId=` | Bed/ward/visit context for the current visit (inpatient lookup first, then outpatient / emergency). |
| GET | `/api/Visit/PatientVisitContextForProvisionalPayment?patientId=&visitId=` | Similar to above, but for provisional payment context. |
| GET | `/api/Visit/DoctorNewOpdBillingItems` | Doctor-level new-patient OPD price list. |
| GET | `/api/Visit/DepartmentNewOpdBillingItems` | Department-level new-patient OPD price list. |
| GET | `/api/Visit/DoctorFollowupBillingItems` | Doctor-level follow-up price list. |
| GET | `/api/Visit/DepartmentFollowupBillingItems` | Department-level follow-up price list. |
| GET | `/api/Visit/DepartmentOldPatientBillingItems` | Department-level old-patient OPD price list. |
| GET | `/api/Visit/DoctorOldPatientBillingItems` | Doctor-level old-patient OPD price list. |
| GET | `/api/Visit/DoctorOpdReferralBillingItems` | Doctor-level referral price list. |
| GET | `/api/Visit/AppointmentApplicableDoctors` | Doctors with `IsActive = true` and `IsAppointmentApplicable = true`, joined to their department. |
| GET | `/api/Visit/VisitsSignedByDoctor?patientId=` | Visits signed by the logged-in doctor. |
| GET | `/api/Visit/PatientHealthCardWithBillInfo?patientId=` | `{ BillingDone, CardPrinted }`. |
| GET | `/api/Visit/ListVisits?search=&dayslimit=&SearchPatientUsingHospitalNo=&SearchPatientUsingIdCardNo=` | Paginated list of valid visits via `SP_APPT_GetVisitListOfValidDays`. |
| GET | `/api/Visit/VisitsByStatus?status=&search=&dayslimit=` | List visits filtered by status. Server-paginated when the search text is empty. |
| GET | `/api/Visit/GetMemberInformationByScheme?schemeId=&patientId=` | Patient's scheme + member-no + credit limits. |
| GET | `/api/Visit/GetPatientCreditLimitsByScheme?schemeId=&patientId=&serviceBillingContext=` | Effective credit limit for the patient in a given billing context (OP / IP). |
| GET | `/api/Visit/GetLatestClaimCode?schemeId=` | Latest auto-generated claim code (used by credit schemes). |
| GET | `/api/Visit/GetRank` | Active ranks from `PAT_APF_Rank`. |
| POST | `/api/Visit/PostRank` | Add a new rank. Body: `{ Rank: string }`. |
| GET | `/api/Visit/GetDependentIdDetails?dependentId=` | All patients sharing the given dependent id (APF integration). |
| PUT | `/api/Visit/UpdateDendentId?dependentId=&patientId=` | Bind / re-bind a dependent id to a patient (max 3 patients per dependent id). |
| POST | `/api/Visit/NewVisit` | Full new-visit transaction. Body: `QuickVisitVM`. |
| POST | `/api/Visit/VisitFromOnlineAppointment` | Same as `NewVisit` but without the ER / department-name logic. |
| POST | `/api/Visit/VisitFromBilling` | Bulk-import a list of visits from a billing-side payload. |
| POST | `/api/Visit/VisitForFreeReferral` | Free-referral / transfer visit. Body: `VisitModel`. |
| POST | `/api/Visit/VisitForFreeFollowup` | Free follow-up. Body: `VisitModel`. Enforces `MaximumLastVisitDays`. |
| POST | `/api/Visit/VisitForPaidFollowup` | Paid follow-up. Body: `QuickVisitVM`. |
| POST | `/api/Visit/DefaultVisitCreate` | Lightweight visit create with no scheme / bill line (mostly legacy). |
| PUT | `/api/Visit/UpdateBillStatus?billingStatus=` | Body: `number[]` of `PatientVisitId`. Updates `BillingStatus`. |
| PUT | `/api/Visit/UpdateSignedStatus?visitId=` | Mark the visit summary as signed. |

### 6.3 Frontend data-layer service routes (`visit.dl.service.ts` & `appointment.dl.service.ts`)

These Angular services wrap the controller routes. Notable route-shape mappings:

- `PostVisitToDB(visJson)` POSTs to either `/api/Visit/VisitFromOnlineAppointment` or `/api/Visit/NewVisit` depending on `RouteFromService.RouteFrom`.
- `GetApptForDeptOnSelectedDate` -> `/api/Visit/CheckExistingAppointment`.
- `PostTransferVisit` -> `/api/Visit/VisitForFreeReferral` (controller overloads referral + transfer).
- `PostFreeFollowupVisit` -> `/api/Visit/VisitForFreeFollowup`.
- `PostPaidFollowupVisit` -> `/api/Visit/VisitForPaidFollowup`.
- `PutAppointmentStatus` -> `/api/Appointment/AppointmentStatus` (with full query string).
- `PostAppointment` -> `/api/Appointment/AddAppointment`.
- `PutAppointment` -> `/api/Appointment/UpdateAppointment`.
- `GetAppointmentList(from, to, performer, status)` -> `/api/Appointment/Appointments?...&status=...` (note: backend route does not declare `status`, but the service still passes it -- it is currently unused server-side).
- `getOnlineAppointmentData` -> external `/api/doctor/getPatientListByAdmin/{fromDate}/{toDate}` with `TELEMED_Token` bearer.

---

## 7. Cross-Module Interactions

The Appointment module is one of the most connected parts of DanpheEMR. The following modules are touched during a single visit creation:

| Module | Tables / APIs touched | Direction |
|---|---|---|
| **Patient registration** (`PAT_Patient`, `PAT_PatientGurantorInfo`) | `AddPatientForVisit` creates the patient if `PatientId == 0`, generates EMPI, patient code, patient no. Updates `Address`, `MunicipalityId`, `PhoneNumber`, `Rank`, `Posting`, `DependentId`, `IDCardNumber`, `EthnicGroup` when updating an existing patient. | Writes via `VisitDbContext.Patients`. |
| **Billing** (`BIL_TXN_BillingTransaction`, `BIL_TXN_BillingTransactionItems`, `BIL_TXN_InvoiceReturn`, `TXN_EmpCashTransaction`) | `AddBillingTransactionForPatientVisit` writes the OPD ticket invoice + lines. `GenerateInvoiceNoAndSaveInvoice` retries on unique-constraint collisions. `ReAssignProviderTxn` updates the doctor on a bill line. | Writes. `BillingBL.GetInvoiceNumber`, `BillingBL.GetFiscalYear`, `BillingBL.AddEmpCashTransaction` are called. |
| **Billing credit / scheme** (`BIL_TXN_CreditBillStatus`, `PAT_MAP_PatientSchemes`) | `VisitBL.SavePatientScheme` writes / updates the patient scheme map. For `PaymentMode == "credit"`, a `BIL_TXN_CreditBillStatus` row is created. | Writes. |
| **SSF insurance** (`PAT_SSFClaimResponseDetails`, `INS_MedicareMember`, `INS_MedicareMemberBalance`) | `VisitBL.UpdateMedicareMemberBalance` adjusts `OpBalance` and `OpUsedAmount` for Medicare members. `VisitBL.IsClaimed` queries `SSFClaimResponseDetails` to determine whether to call the SSF FHIR server. `VisitBL.UpdatePatientSchemeForFreeFollowupAndFreeReferral` re-queries the SSF server for fresh credit limits. | Reads + writes. |
| **Doctors / Employees** (`EMP_Employee`) | `AppointmentApplicableDoctors` and `DepartmentEmployees` (in Master controller) are joined to departments to build the appointment list. | Reads. |
| **Departments** (`MST_Department`) | Department-level OPD uses `OpdNewPatientServiceItemId`, `FollowupServiceItemId`, `OpdOldPatientServiceItemId` on the department row. | Reads. |
| **Master** (`MST_Country`, `MST_CountrySubDivision`) | Address and district dropdowns in the patient form. | Reads. |
| **ADT (Admission, Discharge, Transfer)** (`ADT_PatientAdmission`) | `VisitController.PatientCurrentVisitContext` joins admission to derive the current visit context for inpatients. | Reads. |
| **Emergency** (`ER_Patient`) | `VisitController.AddEmergencyPatient` inserts an ER row when the visit's department name matches `CORE_CFG_Parameters[Common / ERDepartmentName]`. | Writes. |
| **Lab** (`LAB_TestRequisition`) and **Radiology** (`RAD_PatientImagingRequisition`) | `VisitBL.UpdateRequisitionItemsBillStatus` flips the bill status of existing lab/radiology requisitions linked to the OPD ticket. | Updates. |
| **Insurance (NHIS, ECHS)** | `VisitBL.UpdateMedicareMemberBalance` (Medicare). `GetBillingSchemeBasedOnServiceBillingContext` switches OP / IP context. | Reads + writes. |
| **IRD Nepal (real-time billing sync)** | `VisitBL.SyncBillToRemoteServer` posts sales / sales-return bills to the IRD when `RealTimeRemoteSyncEnabled` is true. | External POST. |
| **SSF (FHIR server)** | `VisitBL.CheckSSFPatientEligibility` calls the SSF FHIR `CoverageEligibilityRequest` endpoint with basic auth. `BillingBL.SyncToSSFServer` posts claim booking on every OPD ticket (fire-and-forget). | External POST. |
| **Telemedicine (external portal)** | `AppointmentDLService.getOnlineAppointmentData`, `updateVisitStatusInTelemedicine`, `updatePaymentStatus`. | External GET/PUT. |
| **Settings** | `AppointmentsMainComponent` reads from `CoreService.Parameters` and `DanpheCache` for `EnableDepartmentLevelAppointment`, `VisitTimeDifferenceMinutes`, `MaximumLastVisitDays`, `AllowedDepartmentsForScheme`, `APFUrlForPatientDetail`, `VisitPrintSettings`. | Reads. |
| **Security / RBAC** | `RbacUser currentUser` is required for all write paths. The `[DanpheViewFilter]` attribute gates the legacy view routes. | Reads. |
| **Audit** | `VisitDbContext` extends `AuditDbContext`, so every save writes to the audit log. `AddAuditCustomField` is used to attach `ChangedByUserId` / `ChangedByUserName`. | Writes. |

---

## 8. Key Business Rules

1. **Visit type classification** -- `VisitType` is one of `outpatient`, `inpatient`, `emergency`. The `ERDepartmentName` core parameter decides when a visit becomes an ER row. `VisitCode` prefix is `V` for outpatient, `H` for inpatient, `ER` for emergency. The serial number is `yy + 5-digit counter` (see `VisitBL.CreateNewPatientVisitCode`).
2. **Appointment type classification** -- `AppointmentType` is one of `New`, `followup`, `transfer`, `referral`. Set on `Visit` rows (not on `Appointment` rows) to drive the continuation logic. Mixed casing is intentional in the code: lowercase is used for the value of `AppointmentType` in many places (`"New"`, `"followup"`, `"Transfer"`, `"Referral"`), so comparisons use `ToLower()`.
3. **Duplicate visit prevention** -- `VisitBL.HasDuplicateVisitWithSameProvider` prevents the same patient from having two active (non-returned) visits with the same provider on the same day. The client side also runs `VisitService.HasDuplicateVisitToday` against today's visit list.
4. **Department-level vs doctor-level appointment** -- Toggled by `CoreCFG[Visit / EnableDepartmentLevelAppointment]`. When `true`, appointments and visits are bound to a department rather than a specific doctor. The clashing check switches from performer to department.
5. **Clash detection** -- `AppointmentDay.GetClashingAppointments` performs a fine-grained overlap check on `AppointmentTime` +/- 20 minutes (a constant in `AppointmentDay.FormatData`). Used by the appointment-create UI to show a busy schedule.
6. **Follow-up window** -- `CoreCFG[Appointment / MaximumLastVisitDays]` is the cap on free follow-up eligibility. `VisitBL.IsValidForFollowUp` walks the parent-visit chain recursively (`GetParentVisit`) and rejects when the root visit is older than the cap. `GetValidForFollowUp` mirrors this on the list page.
7. **Free vs paid follow-up** -- `FollowUpVisitComponent.FollowUp` decides based on whether the doctor / department / price-category has changed and on the `VisitService.PriceCategory` value (only "Normal" is free). Free follow-ups go to `VisitForFreeFollowup` (no bill, `BillingStatus = "free"`). Paid follow-ups go to `VisitForPaidFollowup` (full bill).
8. **Scheme mapping** -- `VisitBL.SavePatientScheme` maintains `PAT_MAP_PatientSchemes`. The system default scheme (`IsSystemDefault = true`) is used as a baseline; the visit's `SchemeId` is set from the visit. Co-payment schemes (Medicare, SSF) decrement `OpCreditLimit` / `IpCreditLimit` / `GeneralCreditLimit` and stamp `LatestClaimCode` and `LatestPatientVisitId`. For SSF, a fire-and-forget call to `SSF_ClaimBookingService_DTO.GetMappedToBookClaim` -> `BillingBL.SyncToSSFServer` is dispatched.
9. **Claim code generation** -- Three paths exist:
   - Auto-generate via `SP_Claim_GenerateNewClaimCode(@SchemeId)` when the credit organization has `IsClaimCodeAutoGenerate = true` and the core parameter `ClaimCodeAutoGenerateSettings.EnableAutoGenerate = true` and `SchemeId` matches.
   - Reuse the patient's most recent claim code when `IsClaimManagementApplicable` and `IsClaimCodeCompulsory` are true but auto-generate is off.
   - Random Int64 (`Random.Next(1, 10000).ToString("D4") + Minute + Second`) for free follow-up / free referral on co-payment schemes.
10. **Transfer closes the prior visit** -- `VisitController.UpdateIsContinuedStatus` sets `IsActive = false` and `IsVisitContinued = true` on the prior visit when the new visit is a transfer. Follow-up and referral set `IsVisitContinued = true` only.
11. **Queue token** -- Generated by `SP_VISIT_SetNGetQueueNo(@VisitId)` after the visit is committed. The procedure returns a per-doctor per-day token. The visit's `QueueNo` is set, and the patient's sticker / doctor's live board can display it.
12. **Invoice number retry** -- `GenerateInvoiceNoAndSaveInvoice` and `GeneratePatientVisitCodeAndSave` catch `SqlException.Number == 2627` (unique violation) and recursively retry, ensuring duplicate-safe invoice / visit-code allocation in concurrent writes.
13. **EMPI generation** -- For a brand-new patient, `PatientBL.CreateEmpi(clientPat, connString)` produces a 16-character EMPI from `CountrySubDivision(3) + DOB(ddMMyy) + NameInitials(FML, X if no middle) + 4-digit random`.
14. **Audit fields on update** -- All update paths explicitly mark `CreatedOn` and `CreatedBy` as `IsModified = false` to preserve original audit fields. The same applies to `PatientId` on appointment updates.
15. **Counter activation** -- `ActivateBillingCounterGuardService` is wired into the appointment route (`appointments-routing.module.ts`) -- the user must have an active billing counter to enter the module. The visit-main component redirects to `PatientSearch` if no counter is active.
16. **Online appointment origin flag** -- `RouteFromService.RouteFrom = "onlineappointment"` causes the visit-create form to freeze `VisitDate` / `VisitTime` to the appointment value and skip the auto-incrementing visit-time interval.
17. **Sticker vs receipt print focus** -- `Appointment / VisitPrintSettings` core parameter is a JSON object: `{ ShowStickerPrint, ShowInvoicePrint, DefaultFocus: "invoice" | "sticker" }`. Drives which popup the visit-main component opens after a successful post.
18. **APF dependent-id cap** -- For APF-integrated hospitals, the same `DependentId` may be used by at most 3 patients (`VisitController.UpdateDendentId` rejects otherwise). The configurable count lives in the `APFUrlForPatientDetail` core parameter (`SameDependentIdApplicableCount`).
19. **Race-safe online appointment bind** -- `VisitController.UpdateDendentId` and `GetDependentIdDetails` are the only `await`-style async endpoints in the appointment module; they are scoped to the APF integration.
20. **Phone-only / phone-mandatory** -- `CoreService.GetIsPhoneNumberMandatory` is checked in `visit-main` and in the appointment-create validator. When enabled, the contact number must be digits only.

---

## 9. Frontend Module Map (Angular)

```
src/app/appointments/
├── appointments.module.ts                  Registers VisitService, AppointmentService, VisitBLService, VisitDLService, AppointmentBLService, AppointmentDLService.
├── appointments-routing.module.ts          /Appointment/{Visit|ListAppointment|CreateAppointment|ListVisit|PatientSearch|SSFClaim|OnlineAppointment}
├── appointments-main.component.ts          Loads DocOpdPrices, DocFollowupPrices, DocOpdPrice_OldPatient, DocOpdPrice_Referral, DeptOpdPrices, DeptFollowupPrices, DeptOpdPrice_OldPatient, ApptApplicableDepartmentList, ApptApplicableDoctorsList, allBillItemsPriceList, RankList into VisitService.
├── appt-list/                              AppointmentListComponent -- list + cancel + check-in.
├── appt-new/                               AppointmentCreateComponent -- create new appointment.
├── follow-up/                              FollowUpVisitComponent -- free / paid follow-up.
├── transfer/                               TransferVisitComponent -- doctor-to-doctor transfer.
├── referral/                               FreeReferalVisitComponent -- free referral.
├── opd-sticker/                            Sticker print.
├── patient-search/                         PatientSearchComponent -- entry from /Appointment/PatientSearch.
├── online-appointment/                     OnlineAppointmentMainComponent + PendingList / CompletedList.
├── visit/                                  VisitMainComponent + VisitPatientInfoComponent + VisitInfoComponent + VisitBillingInfoComponent.
├── list-visit/                             VisitListComponent.
├── SSFClaim/                               SSF claim filing UI.
├── shared/                                 visit.model.ts, visit.service.ts, visit.bl.service.ts, visit.dl.service.ts, appointment.model.ts, appointment.service.ts, appointment.bl.service.ts, appointment.dl.service.ts, quick-visit-view.model.ts, quick-appointment-view.model.ts, current-visit-context.model.ts, dto/*.
```

### Key frontend services

- `VisitService` is a singleton holding cross-component state: `globalVisit`, `appointmentType`, `PriceCategory`, `ClaimCode`, `ParentVisitInfo`, `ParentVisitInvoiceDetail`, `PatientTodaysVisitList`, the four doctor price lists, the four department price lists, `ApptApplicableDepartmentList`, `ApptApplicableDoctorsList`, `allBillItemsPriceList`, `RankList`. Exposes events: `billChangedEvent`, `schemeChangedEvent`, `patientAgeChangeEvent`, `freeVisitSettingsEvent`. `HasDuplicateVisitToday` provides client-side dup check.
- `AppointmentService` holds the global `Appointment`, `GlobalAppointmentPatient`, and `GlobalTelemedPatientVisitID`. Computes `DOB` from age + unit (`Y` / `M` / `D`).
- `VisitBLService` orchestrates visits: `PostVisitToDB`, `PostFreeFollowupVisit`, `PostPaidFollowupVisit`, `PostFreeReferralVisit`, `ContinueNextVisit` (transfer / referral), `PostReturnTransaction` (for transfer), `GetDepartmentOpdItems`, `GetDepartmentFollowupItems`, `GetDoctorFollowupItems`, `GetDoctorOldPatientPrices`, `GetDoctorReferralPatientPrices`, `GetDepartmentOldPatientPrices`, `GetVisitDoctors`, `GetMemberInfoByScheme`, `GetPatientCreditLimitsByScheme`, `GetLatestClaimCodeForAutoGeneratedClaimCodes`, `GetRank` / `PostRank`, SSF / Medicare helpers.
- `AppointmentBLService` covers `LoadAppointmentList`, `CancelAppointment`, `CheckinAppointment`, `PostAppointment`, `PutAppointment`, `GetDoctorList`, `GetDepartmentList`, `GetMembershipDeatilsByMembershipTyepId`, `UpdateAppointmentStatus`, `GetAppointmentProviderList`, `CheckForClashingAppointment`.
- `VisitDLService` is the HTTP layer for visit and follow-up / referral / transfer / online-appointment calls.
- `AppointmentDLService` is the HTTP layer for appointment CRUD and the telemedicine bridge.

### Visit-main flow (UI orchestration)

1. `VisitMainComponent.Initialize` copies `Patient` from `PatientService.getGlobal()` into `quickVisit.Patient`, sets `VisitType = outpatient`, sets `BillingTransaction.IsInsuranceBilling` from the global billing service.
2. If the user came from an appointment or from online appointment, the appointment's `PerformerId` / `PerformerName` / `DepartmentId` / `DepartmentName` / `AppointmentDate` / `AppointmentTime` are copied into the visit model.
3. `CheckExistingPatientsAndSubmit` calls `GetApptForDeptOnSelectedDate` (server-side duplicate check) when department-level appointment is enabled.
4. `ValidatePatientVisitData` enforces: age unit set, ethnic group set, claim code set when insurance billing, member number when scheme mandates, valid district, valid patient form, valid visit form, valid scheme form, valid provider selection, valid billing items, received amount <= total amount, insurance balance check, mandatory remarks for discount, mandatory credit organization on credit payment mode, non-zero price on every line, valid discount percent (0-100), proper phone number when mandatory, no duplicate visit today, scheme selected, change >= 0, APF dependent-id cap.
5. `submitVisitDetails` checks for matching existing patient when `PatientId == 0`; otherwise calls `CheckAppointmentTypeAndCreateVisit`.
6. `CheckAppointmentTypeAndCreateVisit` handles transfer (return previous invoice + create new visit), referral (return previous invoice if any + create new visit), and new / follow-up.
7. `CreateVisit` POSTs `quickVisit` (with validators stripped) via `VisitBLService.PostVisitToDB`. The response includes the new `Visit`, `BillingTransaction`, `QueueNo`.
8. `PostVisitSuccess` resets state and triggers the print popup (`showPrintingPopup` + `showbillingReceipt` + `showOpdSticker` + `showEchsSticker`).

---

## 10. Migration Notes (for the Cloudflare-native rewrite)

The reference implementation has been the source of truth for years; the rewrite should preserve the same contracts where possible. Critical surface:

- `PAT_Appointment` and `PAT_PatientVisits` are the only two new tables the appointment module owns; everything else is read/write from other modules.
- The single most important invariant to preserve is the **all-or-nothing** behavior of `CreatePatientVisit` -- patient, visit, bill, scheme, and credit-status must commit together, otherwise partial failures leave duplicate-bill, no-visit states.
- The queue-token stored procedure should be replaced by an atomic D1 / Postgres sequence or a per-(tenant, doctor, day) counter row, since CF Workers + D1 do not support `SqlConnection` natively.
- The IRD / SSF / Telemedicine callbacks are external HTTP services and should remain fire-and-forget background tasks.
- The 20-minute appointment slot assumption is hard-coded in `AppointmentHelpers`; if business wants a different default, the constant is the single edit point.
- The 3-patient cap on `DependentId` is enforced server-side; the client-side `SameDependentIdApplicableCount` comes from the `APFUrlForPatientDetail` core parameter, so a single-tenant config value can change the cap without code change.

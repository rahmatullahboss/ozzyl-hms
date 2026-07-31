# Admission (ADT) Module

## 1. Module Overview

The Admission, Discharge, and Transfer (ADT) module is the inpatient backbone of the hospital information system. It governs the entire patient journey inside the hospital — from being admitted, to occupying and switching beds across wards, to discharge with full clinical summarization. The module is tightly coupled with the Billing, Patient Registration, Visit, Nursing, and Insurance subsystems, and exposes roughly 50 HTTP endpoints backed by `AdmissionController`, `AdmissionMasterController`, `AdmissionViewController`, and `DischargeSummaryController`.

In the .NET/SQL Server reference implementation, all ADT persistence lives in SQL Server tables prefixed with `ADT_*` (master data, transactional data, and configuration). The Angular frontend exposes the module as `ADTModule` at `/adt/*` routes with feature subfolders for admission, transfer, upgrade, change-doctor, sticker, wrist-band, bed history, patient history, and discharge.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Admission** | A row in `ADT_PatientAdmission` linked 1:1 to an Inpatient `VisitModel`. Tracks status (`admitted`, `discharged`, `cancel`), admitting doctor, dates, scheme/discount, and a `CareOfPerson` (caretaker). |
| **Bed Feature** | A bed type/classification (e.g. General, Semi-Private, Deluxe, ICU). Stored in `ADT_MST_BedFeature`. Linked to a `BIL_MST_ServiceItem` with `IntegrationName = "Bed Charges"` so bed charges are billable. |
| **Ward** | A physical ward inside a department. Stored in `ADT_MST_Ward`. A ward can have many beds of many features. |
| **Bed** | A physical bed in a ward. Stored in `ADT_Bed`. Tracks `IsOccupied`, `IsReserved`, `OnHold`, `HoldedOn`. |
| **Bed Feature Map** | Many-to-many between Bed and BedFeature scoped by Ward. Stored in `ADT_MAP_BedFeaturesMap`. |
| **Patient Bed Info** | Transactional record of a patient's stay on a specific bed. Stored in `ADT_TXN_PatientBedInfo`. Action: `admission`, `transfer`, `discharge`, `cancel`. |
| **Bed Reservation** | Pre-booking of a bed before admission. Stored in `ADT_BedReservation`. Auto-cancels after a configurable timeout. |
| **Discharge Summary** | Clinical summary produced on discharge. Stored in `ADT_DischargeSummary`. Has child tables for medications and consultants. |
| **Discharge Type / Condition / Delivery / Birth Condition / Death Type** | Lookup tables driving the discharge summary form. |
| **ADT Auto Billing Item** | Configuration defining which service items to auto-add when a patient is admitted under a specific scheme + bed feature. Stored in `ADT_CFG_AutoBillingItem`. |
| **ADT Deposit Setting** | Configuration for minimum deposit required at admission per (scheme, bed feature). Stored in `ADT_CFG_DepositSettings`. |
| **Bed Feature Scheme Price Category Map** | Maps bed features to allowed price categories per scheme. Stored in `ADT_MAP_BedFeatureSchemePriceCategory`. |

### ADT Status State Machine

```
[not admitted] --(CreateAdmission)--> admitted
admitted --(Transfer)--> admitted (new bed)
admitted --(Discharge)--> discharged
admitted --(CancelAdmission)--> cancel
discharged --(CancelDischargeBill)--> admitted (re-admit logic via CancelDischargedInPatient)
reserved --(auto-cancel after N mins)--> (reservation expired)
```

`ADT_PatientAdmission.AdmissionStatus` field carries the value. References are stored as strings (`"admitted"`, `"discharged"`, `"cancel"`) and resolved through `ENUM_AdmissionStatus`.

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose |
|------|------|---------|
| `AdmissionController.cs` | `Websites/DanpheEMR/Controllers/Admission/AdmissionController.cs` | Main controller — all admission/discharge/transfer/bed/sticker/wrist-band/HD/hemo endpoints. 5,584 lines. |
| `AdmissionMasterController.cs` | `Websites/DanpheEMR/Controllers/Admission/AdmissionMasterController.cs` | Lightweight read-only controller for ADT master/configuration data (auto-billing items, deposit settings, bed feature scheme map). Delegates to `IAdmissionMasterService`. |
| `AdmissionViewController.cs` | `Websites/DanpheEMR/Controllers/Admission/AdmissionViewController.cs` | MVC view controller — renders Razor pages (CreateAdmission, AdmissionSearchPatient, AdmittedList, DischargedList, Admission) using `[DanpheViewFilter(...)]` for RBAC. |
| `DischargeSummaryController.cs` | `Websites/DanpheEMR/Controllers/Admission/DischargeSummaryController.cs` | Mostly stubbed (52 lines). Real discharge-summary logic lives inside `AdmissionController` (see `AddDischargeSummary`, `GetDischargeSummary`, `UpdateDischargeSummary`). |

### 2.2 AdmissionController.cs — Endpoint Map

The controller owns 5 `DbContext` instances: `AdmissionDbContext`, `CoreDbContext`, `BillingDbContext`, `MasterDbContext`, `RbacDbContext`. All read endpoints wrap work in `Func<object>` and pass through `InvokeHttpGetFunction`. All write endpoints read the post body via `this.ReadPostData()` and pass through `InvokeHttpPostFunction` / `InvokeHttpPutFunction`. Long-running writes use `Database.BeginTransaction()` and roll back on exception.

#### 2.2.1 HTTP GET endpoints (read)

| Route | Method | Internal Handler | Purpose |
|-------|--------|------------------|---------|
| `/api/Admission/AdmittedPatientsData` | GET | `GetADTList` | Returns the full admitted/discharged patient grid (uses SP `SP_ADT_GetAllAdmittedPatients`). Supports filtering by `admissionStatus` and `patientVisitId`. |
| `/api/Admission/Wards` | GET | `GetWardList` | Active wards dropdown. |
| `/api/Admission/Departments` | GET | `GetDepartments` | Active departments dropdown. |
| `/api/Admission/BedFeatures` | GET | `GetBedFeatures` | Active bed features. |
| `/api/Admission/DischargedPatients` | GET | `GetDischargedPatientList` | Discharged patient list between `FromDate` and `ToDate`. |
| `/api/Admission/AdmittedPatients` | GET | `GetAdmittedPatientList` | Admitted patient list between `FromDate` and `ToDate`. |
| `/api/Admission/PatientAndBedInfo` | GET | `GetPatientAndBedInfo` | Patient + current bed + admission info. |
| `/api/Admission/AdmissionInfo` | GET | `GetPatientAdmissionInfo` | Patient + deposit + bed summary. |
| `/api/Admission/AdmittedPatientBedInfo` | GET | `GetAdmittedPatientBedInfo` | Bed history for a visit. |
| `/api/Admission/AdmittedPatientForNursing` | GET | `AdmittedPatientListForNursing` | Ward-filtered admitted list (nursing module). |
| `/api/Admission/TransferredPatientInfo` | GET | `GetPendingTransferredPatient` | List of in-transit patients with `Action="transfer"`, `ReceivedBy IS NULL`. |
| `/api/Admission/PatientAdmissionStatus` | GET | `CheckAdmissionStatus` | Returns true if patient is currently admitted. |
| `/api/Admission/ProvisionalBillStatus` | GET | `CheckPatientProvisionalStatus` | Returns true if patient has open provisional bill items. |
| `/api/Admission/Doctors` | GET | `GetDoctorList` | Doctors (appointment-applicable) with OPD consultation fee. |
| `/api/Admission/AppointmentApplicableDoctorList` | GET | `GetAppointmentApplicableDoctorList` | Doctors + Department join. |
| `/api/Admission/AppointmentApplicableDoctors` | GET | `GetAppointmentApplicableDoctors` | Cached employee list filtered by `IsAppointmentApplicable=true` and `IsActive=true`. |
| `/api/Admission/Anaesthetists` | GET | `GetAnaesthetist` | Employees with role name `"Anaesthetist"`. |
| `/api/Admission/DischargeTypes` | GET | `GetDischargeTypes` | Lookup list. |
| `/api/Admission/DischargeSummary` | GET | `GetDischargeSummary` | Returns full discharge summary, consultants, medications, baby birth details, certificate list, doctor signatures. |
| `/api/Admission/AvailableBeds` | GET | `GetAvailableBeds` | Vacant beds for (wardId, bedFeatureId) + bed bill item + reservation overlay. |
| `/api/Admission/Ward/BedFeatures` | GET | `GetBedFeaturesByWard` | Bed features offered in a ward, with `Price` for given `priceCategoryId`. |
| `/api/Admission/SimilarBedFeatures` | GET | `GetSimilarBedFeature` | Other bed features available in the same ward. |
| `/api/Admission/AdmissionHistory` | GET | `GetAdmissionHistory` | Full admission history for a patient. |
| `/api/Admission/LatestAdmissionInfo` | GET | `GetLatestAdmissionDetail` | Most recent admission only. |
| `/api/Admission/AdmissionSticker` | GET | `GetAdmissionSticker` | Data for the printed admission sticker. |
| `/api/Admission/WristBandInfo` | GET | `GetWristBandInfo` | Data for the IP wrist band printout. |
| `/api/Admission/LatestHemoDialysisReport` | GET | `GetLastHemoDialysisReport` | Latest hemodialysis report for a patient. |
| `/api/Admission/HemoDialysisReports` | GET | `GetAllHemodialysisReport` | All hemodialysis reports for a patient. |
| `/api/Admission/PatientBedInfos` | GET | `GetBedItemsForPatientVisit` | Existing bed feature ids used for a visit (used during transfer to skip duplicate bed-charge items). |
| `/api/Admission/ICD10` | GET | `GetICD10List` | Active ICD-10 codes. |
| `/api/Admission/MedicationFrequencies` | GET | `GetMedicationFrequencies` | Frequency master. |
| `/api/Admission/DischargeConditions` | GET | `GetDischargeConditions` | Discharge condition types. |
| `/api/Admission/DeliveryTypes` | GET | `GetDeliveryTypes` | Delivery types. |
| `/api/Admission/BirthConditions` | GET | `GetBirthCondtions` | Baby birth conditions. |
| `/api/Admission/DeathTypes` | GET | `GetDeathTypes` | Death types. |
| `/api/Admission/ActiveFiscalYear` | GET | `GetActiveFicalYear` | Active fiscal year name. |
| `/api/Admission/FollowUpPreferences` | GET | `GetFollowUpPreferences` | Per-employee follow-up patient ids (XML). |
| `/api/Admission/PatientCertificate` | GET | `GetPatientCertificate` | Patient certificate list + address. |
| `/api/Admission/DoctorDeparmentAndWardInfo` | GET | `GetDepartmentWardDoctorAndBedInfo` | Doctor/Department/Ward dropdowns + reserved bed for the patient. |
| `/api/Admission/FavouritePatients` | GET | `GetFavouritePatientList` | XML-stored favorite patient ids for the current employee. |
| `/api/Admission/NursingFavouritePatients` | GET | `GetNursingFavouritePatients` | Same, but prunes discharged visits. |
| `/api/Admission/GetAllWardBedInfo` | GET | `GetAllWardBedInfo` | Per-ward bed occupancy summary (total, occupied, vacant). |
| `/api/Admission/AdmissionSlipDetails` | GET | `AdmissionSlipDetails` | Data for admission slip. |
| `/api/Admission/DischargeSlipDetails` | GET | `DischargeSlipDetails` | Data for discharge slip. |
| `/api/Admission/AdmissionSchemePriceCategoryInfo` | GET | `GetAdmissionSchemePriceCategoryInfo` | Scheme + PriceCategory for a visit. |
| `/api/Admission/AvailableBedsAndBedFeaturePrice` | GET | `GetAvailableBedsAndBedFeaturePrice` | Combined available beds + bed feature price for a price category. |
| `/api/Admission/IsPreviousBedAvailable` | GET | `CheckPreviousBedsAvailability` | Used by transfer/upgrade to check whether to add a new bed bill item. |

#### 2.2.2 HTTP POST endpoints (create)

| Route | Method | Internal Handler | Purpose |
|-------|--------|------------------|---------|
| `/api/Admission/Admission` | POST | `CreateAdmission` → `CreateAdmissionTransaction` | Full admission — creates Visit, Admission, PatientBedInfo, deposit transfer, deposit receipt, bed-charge bill items, optional BillingTransaction, guarantor. All in a single DB transaction. |
| `/api/Admission/DischargeSummary` | POST | `AddDischargeSummary` | Insert discharge summary + child medications + consultants. |
| `/api/Admission/AdmissionRemark` | POST | `AddAdmissionRemark` | Add a remark row. |
| `/api/Admission/WristBand` | POST | `SaveWristBandHTML` | Save generated HTML for wrist band to disk. |
| `/api/Admission/CancelDischargeBill` | POST | `CancelDischargeBill` → `CancelDischargedInPatient` | Roll back a discharge (re-admits patient, reverses bill items, moves lab/radiology requisitions to a new active visit, marks discharge summary/statement as `IsDischargeCancel`). |
| `/api/Admission/HemoDialysisReport` | POST | `PostHemoDialysisReport` | Save hemodialysis record. |
| `/api/Admission/BirthCertificate` | POST | `AddPatientBirthCertificate` | Save birth certificate + update baby birth details with certificate number. |
| `/api/Admission/ReserveAdmission` | POST | `ReserveAdmission` | Reserve a bed for a future admission. Auto-cancels conflicting reservation if `AdmissionStartsOn - now <= MinutesBeforeAutoCancelOfReservedBed` (default 15 mins). |
| `/api/Admission/DischargeOnZeroItem` | POST | `DischargeOnZeroItem` | Discharge a patient whose billing items total zero (no further billing). Returns deposit balance as a return-deposit row. |

#### 2.2.3 HTTP PUT endpoints (update)

| Route | Method | Internal Handler | Purpose |
|-------|--------|------------------|---------|
| `/api/Admission/Discharge` | PUT | `DischargePatient` | Mark patient as discharged. Frees the bed (sets `IsOccupied=false`, `OnHold=false`, `HoldedOn=null`, `IsReserved=false`). Updates `DischargeDate`, `AdmissionStatus`. |
| `/api/Admission/ClearDueAmount` | PUT | `ClearPatientDue` | Sets `BillStatusOnDischarge="paid"` (used after final settlement). |
| `/api/Admission/Transfer` | PUT | `TransferPatient` | Move patient to a new bed. Updates old bed, sets new bed as occupied, generates new `PatientBedInfo` row with `Action="transfer"`, optional bed-on-hold for nursing transfers, auto-adds new bed-charge bill item, stops previous auto-billing items, may change price category. |
| `/api/Admission/AdmissionInfo` | PUT | `UpdateAdmissionInfo` | Update admission/bed info dates and trigger bed-charge quantity recalculation. |
| `/api/Admission/AdmittingDoctor` | PUT | `UpdateAdmittingDoctor` | Change admitting doctor + department. |
| `/api/Admission/DischargeSummary` | PUT | `UpdateDischargeSummary` | Update discharge summary; replace medications/consultants child rows. |
| `/api/Admission/BillingDischarge` | PUT | `DischargeFromBilling` | Discharge triggered from the Billing module (final bill settlement). |
| `/api/Admission/AdmissionProcedure` | PUT | `UpdateProcedure` | Update `AdmissionModel.ProcedureType`. |
| `/api/Admission/CancelAdmission` | PUT | `CancelAdmission` | Cancel an admission — sets `AdmissionStatus="cancel"`, cancels visit, cancels bed items, reassigns other bill items to the latest outpatient/emergency visit of the same day, returns deposit. |
| `/api/Admission/BirthCertificate` | PUT | `UpdateBirthCertificate` | Update birth certificate. |
| `/api/Admission/ReserveAdmission` | PUT | `UpdateAdmissionReservation` | Update an existing bed reservation. |
| `/api/Admission/CancelReserveAdmission` | PUT | `CancelReservedAdmission` | Cancel a reservation; free the bed (`IsReserved=false`). |
| `/api/Admission/UndoTransfer` | PUT | `UndoTransfer` | Revert a transfer (when bed-on-hold is enabled and the patient was not yet received). |
| `/api/Admission/AdmitTransferredPatient` | PUT | `ReceiveTransfer` | Mark a transferred patient as received. Clears `BedOnHoldEnabled` and `OnHold` flags. |

### 2.3 AdmissionMasterController.cs — Endpoint Map

All endpoints are GET, all `async Task<IActionResult>`, all delegate to `IAdmissionMasterService` with `AdmissionDbContext` injected as a parameter (not from DI).

| Route | Internal Handler | Returns |
|-------|------------------|---------|
| `/api/Admission/AdtAutoBillingItems` | `GetAdtAutoBillingItems` | All active `AdtAutoBillingItem_DTO` rows. |
| `/api/Admission/AdtDepositSettings` | `GetAdtDepositSettings` | All active `AdtDepositSetting_DTO` rows. |
| `/api/Admission/SchemeAdtAutoBillingItems` | `GetAdtAutoBillingItemForScheme` | Filtered auto-billing items for `(schemeId, priceCategoryId, serviceBillingContext)`. Joins with `ServiceItemSchemeSettings` to apply discount/co-payment rules. Falls back to system default scheme/price category if inputs are zero. |
| `/api/Admission/SchemeAdtDepositSettings` | `GetAdtDepositSettingsForScheme` | Filtered deposit settings for a scheme. Falls back to system default. |
| `/api/Admission/BedFeatureSchemePriceCategoryMap` | `GetBedFeatureSchemePriceCategoryMap` | Allowed (bedFeature, priceCategory) pairs for a scheme. |

### 2.4 AdmissionViewController.cs

Renders the legacy ASP.NET MVC views (now superseded by the Angular SPA but still configured for fallback):

| View | RBAC Permission | View File |
|------|-----------------|-----------|
| `CreateAdmission` | `adt-createadmission-view` | `CreateAdmission.cshtml` |
| `AdmissionSearchPatient` | `adt-admissionsearchpatient-view` | `AdmissionSearchPatient.cshtml` |
| `AdmittedList` | `adt-admittedlist-view` | `AdmittedList.cshtml` |
| `DischargedList` | `adt-dischargedlist-view` | `DischargedList.cshtml` |
| `Admission` (root) | `adt-view` | `Admission.cshtml` |

### 2.5 DischargeSummaryController.cs

Stub — all logic lives in `AdmissionController`. The original intent was to separate discharge summary routes, but in practice `GetDischargeSummary`, `AddDischargeSummary`, and `UpdateDischargeSummary` are defined on `AdmissionController`.

### 2.6 Services

| File | Path | Purpose |
|------|------|---------|
| `IAdmissionMasterService.cs` | `Websites/DanpheEMR/Services/Admission/IAdmissionMasterService.cs` | Interface for ADT master data lookup. |
| `AdmissionMasterService.cs` | `Websites/DanpheEMR/Services/Admission/AdmissionMasterService.cs` | EF-Core async implementation. Joins `BillServiceItems` × `BillPriceCategoryServiceItems` × `ServiceDepartment` × `AdtAutoBillingItems` for scheme-specific auto-billing. Uses `GetServiceItemSchemeSettingsForCurrentServiceBillingContext` to apply IP / OP / Registration / Admission discount percent + co-payment rules. |
| `DTOs/AdtAutoBillingItem_DTO.cs` | `Services/Admission/DTOs/` | DTO with price, discount, co-payment, integration item id. |
| `DTOs/AdtDepositSetting_DTO.cs` | `Services/Admission/DTOs/` | DTO for minimum-deposit rules. |
| `DTOs/AdtBedFeatureSchemePriceCategoryMap_DTO.cs` | `Services/Admission/DTOs/` | (scheme, bedFeature, priceCategory) tuple. |
| `DTOs/BedFeature_DTO.cs` | `Services/Admission/DTOs/` | BedFeature with `BedPrice` for a price category. |
| `DTOs/PatientAdmissionSlip_DTO.cs` | `Services/Admission/DTOs/` | Admission slip row. |
| `DTOs/DischargeCancel_DTO.cs` | `Services/Admission/DTOs/` | Discharge-cancel payload. |
| `Services/ADTSettings/DTO/*` | `Websites/DanpheEMR/Services/ADTSettings/DTO/` | Older DTOs (read paths still referenced from legacy admin screens). |

---

## 3. Data Models

All models live in `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/AdmissionModels/`.

### 3.1 `AdmissionModel` (table `ADT_PatientAdmission`)

Primary key: composite `(PatientAdmissionId identity, PatientVisitId FK → PAT_PatientVisits)`.

| Field | Type | Notes |
|-------|------|-------|
| `PatientAdmissionId` | int (identity) | Auto-generated. |
| `PatientVisitId` | int (FK Visit) | 1:1 with Inpatient Visit. |
| `PatientId` | int | Denormalized for query speed. |
| `AdmittingDoctorId` | int? | FK EMP_Employee. |
| `AdmissionDate` | DateTime | Set at admission; can be edited via `UpdateAdmissionInfo`. |
| `DischargeDate` | DateTime? | Set on discharge. |
| `AdmissionNotes` | string | Free text. |
| `AdmissionOrders` | string | Free text. |
| `AdmissionStatus` | string | `admitted` \| `discharged` \| `cancel` (via `ENUM_AdmissionStatus`). |
| `BillStatusOnDischarge` | string | `paid` \| `unpaid` (mirrors billing state at discharge). |
| `DischargeRemarks` | string | Optional remarks. |
| `DischargedBy` | int? | EmployeeId of the discharging user. |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | Standard. |
| `CareOfPersonName`, `CareOfPersonPhoneNo`, `CareOfPersonRelation` | string | Caretaker info. |
| `CancelledOn`, `CancelledBy`, `CancelledRemark` | DateTime?/int?/string | Set on cancel. |
| `ProcedureType` | string | Editable via `UpdateProcedure`. |
| `IsPoliceCase` | bool | Police-case flag. |
| `IsInsurancePatient` | bool | Mirrored from visit insurance flag. |
| `DiscountSchemeId` | int? | FK BIL_CFG_Scheme. |
| `AdmissionCase` | string | E.g. `"Police Case"`. |
| `ProvisionalDiscPercent` | double | Provisional discount %. |
| `IsItemDiscountEnabled` | bool | |
| `IsProvisionalDischarge` | bool | Tracks provisional discharge state. |
| `IsProvisionalDischargeCleared` | bool | |
| `Ins_HasInsurance`, `ClaimCode`, `Ins_NshiNumber`, `Ins_InsuranceBalance` | `[NotMapped]` | Pass-through insurance fields. |
| `BilDeposit` | `[NotMapped] BillingDepositModel` | Posted with the admission to capture a deposit. |
| `BillingTransaction` | `[NotMapped] BillingTransactionModel` | Posted with admission if `IsBillingEnabled`. |
| `PatientSchemesMap` | `[NotMapped] PatientSchemeMapModel` | Posted to update patient scheme map (claim code, credit limits). |
| `CareTaker` | `[NotMapped] CareofPerson_DTO` | |

### 3.2 `BedModel` (table `ADT_Bed`)

| Field | Type | Notes |
|-------|------|-------|
| `BedId` | int (PK) | |
| `BedCode` | string | Display code (e.g. `GW-101`). |
| `BedNumber` | string | Display number. |
| `WardId` | int (FK) | |
| `IsOccupied` | bool | |
| `IsReserved` | bool | |
| `OnHold` | bool | True during a transfer-pending window. |
| `HoldedOn` | DateTime? | Timestamp when `OnHold` was set. |
| `IsActive` | bool | |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | |

`BedDisplayModel` and `BedFeatureModel` are projection models used by legacy views.

### 3.3 `WardModel` (table `ADT_MST_Ward`)

`WardId`, `WardCode`, `WardName`, `WardLocation`, `StoreId`, `IsActive` + audit fields.

### 3.4 `BedFeature` (table `ADT_MST_BedFeature`)

`BedFeatureId`, `BedFeatureCode`, `BedFeatureName`, `BedFeatureFullName`, `BedPrice` (legacy, superseded by per-price-category `BIL_MAP_PriceCategoryServiceItem.Price`), `IsActive`, audit. Has `[NotMapped] TaxApplicable` and `[NotMapped] ServiceDepartmentId`.

### 3.5 `BedFeaturesMap` (table `ADT_MAP_BedFeaturesMap`)

`BedFeatureCFGId` (PK), `BedId`, `WardId`, `BedFeatureId`, `IsActive` + audit. Junction table. Has `[NotMapped] len` (used in legacy bulk bed creation).

### 3.6 `PatientBedInfo` (table `ADT_TXN_PatientBedInfo`)

| Field | Type | Notes |
|-------|------|-------|
| `PatientBedInfoId` | int (PK identity) | |
| `PatientVisitId` | int (FK Admission) | |
| `PatientId` | int | |
| `WardId`, `BedId`, `BedFeatureId` | int | |
| `BedPrice` | decimal | Cached price at time of allocation. |
| `Action` | string | `admission` \| `transfer` \| (legacy) `discharge` \| `cancel`. |
| `OutAction` | string | Set on transfer/discharge/cancel. |
| `Remarks` | string | Optional. |
| `StartedOn`, `EndedOn` | DateTime / DateTime? | Stay window. |
| `BedOnHoldEnabled` | bool | Transfer-pending flag. |
| `ReceivedBy`, `ReceivedOn` | int?/DateTime? | Set on transfer receive. |
| `CancelledBy`, `CancelledOn`, `CancelRemarks` | int?/DateTime?/string | Set on cancel. |
| `BedQuantity` | int | Used for billing. |
| `SecondaryDoctorId` | int? | Per-bed secondary doctor (e.g. unit doctor). |
| `RequestingDeptId` | int? | FK MST_Department. |
| `BedChargeBilItm` | `[NotMapped] BillingTransactionItemModel` | Posted with transfer to add new bed charge. |
| `ReservedBedId` | `[NotMapped] int?` | Used when admitting into a reserved bed. |
| `IsInsurancePatient` | `[NotMapped] bool` | |

### 3.7 `ADTBedReservation` (table `ADT_BedReservation`)

`ReservedBedInfoId` (PK), `PatientId`, `PatientVisitId?`, `RequestingDepartmentId`, `AdmittingDoctorId`, `WardId`, `BedFeatureId`, `BedId`, `AdmissionStartsOn`, `AdmissionNotes`, `ReservedOn`, `ReservedBy`, audit, `CancelledBy/On`, `IsActive`, `IsAutoCancelled`, `AutoCancelledOn`.

### 3.8 `DischargeSummaryModel` (table `ADT_DischargeSummary`)

`DischargeSummaryId` (identity), `PatientVisitId` (PK, 1:1 with Visit), `DischargeTypeId`, `DoctorInchargeId?`, `ResidenceDrId?`, `AnaesthetistsId?`, `OperativeProcedure`, `OperativeFindings`, `Diagnosis`, `CaseSummary`, `Condition`, `Treatment`, `HistologyReport`, `SpeicialNotes`, `Medications`, `Allergies`, `Activities`, `Diet`, `RestDays`, `FollowUp`, `Others`, `LabTests`, `DischargeConditionId?`, `DeliveryTypeId?`, `BabyBirthConditionId?`, `DeathTypeId?`, `DeathPeriod`, `IsSubmitted`, `IsDischargeCancel`, `NotesId?`, `ChiefComplaint`, `PendingReports`, `HospitalCourse`, `PresentingIllness`, `ProcedureNts`, `SelectedImagingItems`, `DiagnosisFreeText`, `ProvisionalDiagnosis`, `BabyWeight`, `CheckedBy?`, `ClinicalFindings`, `PastHistory`, `DischargeSummaryTemplateId?` + audit. Children (NotMapped) `DischargeSummaryMedications`, `BabyBirthDetails`, `DischargeSummaryConsultants`.

### 3.9 `DischargeSummaryMedication` (table `ADT_DischargeSummaryMedication`)

`DischargeSummaryMedicationId`, `DischargeSummaryId` (FK), `OldNewMedicineType` (int: 0=Old, 1=New), `Medicine`, `FrequencyId` (FK `CLN_MST_Frequency`), `Notes`, `IsActive`.

### 3.10 `ADTDischargeSummaryConsultantModel` (table `ADT_DischargeSummaryConsultant`)

`id`, `DischargeSummaryId`, `PatientVisitId`, `PatientId`, `ConsultantId`. Multiple consultants per summary.

### 3.11 Lookup Models (all simple `[Key] int + string + IsActive`)

| Model | Table | Purpose |
|-------|-------|---------|
| `DischargeTypeModel` | `ADT_DischargeType` | E.g. Normal, LAMA, DAMA, Death. |
| `DischargeConditionTypeModel` | `ADT_MST_DischargeConditionType` | Improved, Stable, etc. |
| `DeliveryTypeModel` | `ADT_MST_DeliveryType` | Normal, Caesarean, etc. |
| `BabyBirthConditionModel` | `ADT_MST_BabyBirthCondition` | Live, Stillborn, etc. |
| `DeathTypeModel` | `ADT_MST_DeathType` | Brought Dead, etc. |
| `GravitaModel` | (legacy) | Gravida status. |
| `MedicationFrequency` | `CLN_MST_Frequency` | Shared with clinical. |

### 3.12 `HemodialysisModel` (table `NEPH_HemodialysisRecord`)

Full hemodialysis chart: treatment orders, vascular access, blood transfusion, treatment data, on-examination findings, totals, signatory names, audit.

### 3.13 `BabyBirthDetailsModel` (table `ADT_BabyBirthDetails`)

`BabyBirthDetailsId`, `CertificateNumber?`, `Sex`, `FathersName`, `WeightOfBaby`, `BirthDate`, `BirthTime` (TimeSpan), `DischargeSummaryId?`, `PatientId`, `PatientVisitId`, `MedicalRecordId?`, `IssuedBy?`, `CertifiedBy?`, `FiscalYearId`, `BirthType`, `BirthNumberType` (singleton/twin/...), `PrintedBy?`, `PrintCount`, `PrintedOn?`, `BirthConditionId`, audit.

### 3.14 `PatientCertificateModel` (table `ADT_PatientCertificate`)

`CertificateId`, `FiscalYearName`, `CertificateNumber?`, `DischargeSummaryId?`, `CertificateType` (Birth/Death/Medical), `IssuedBySignatories`, `CertifiedBySignatories`, `BirthType`, `DeathDate?`, `DeathTime?` (TimeSpan), `DeathCause`, `FatherName`, `MotherName`, `Spouse`, audit.

### 3.15 `DischargeCancelModel` (table `ADT_DischargeCancel`)

`DischargeCancelId`, `PatientVisitId?`, `PatientAdmissionId?`, `DischargedDate`, `CreatedOn?`, `DischargedBy?`, `DischargeCancelledBy?`, `BillingTransactionId?`, `DischargeCancelNote`, `[NotMapped] CounterId`, `[NotMapped] NewBedId?`.

### 3.16 `ZeroItemDischargeModel`

Not mapped. Posted to `DischargeOnZeroItem` to discharge a patient who has no billable items. Carries `PatientVisitId`, `PatientId`, `CounterId`, `DiscountSchemeId?`, `DepositBalance`, `DischargeDate`, `DischargeRemarks`, `DischargeFrom` (`"billing"` or `"insurance"`).

### 3.17 `SmsModel` (table `TXN_Sms`)

`SmsId`, `SmsCounter`, `PatientId`, `DoctorId?`, `SmsInformation`, `CreatedOn?`, `CreatedBy?`. Used to send doctor-notification SMS at admission.

### 3.18 `IpWristBandInfoVM`

View model. `PatientCode`, `PatientName`, `DateOfBirth`, `Gender`, `BloodGroup`, `Address`, `PhoneNumber`, `AdmittingDoctor`, `AdmissionDate`, `InPatientNo`, `Ward`, `BedCode`.

### 3.19 `CareofPerson_DTO`

`CareOfPersonName`, `CareOfPersonRelation`, `CareOfPersonPhoneNo`. Passed with admission and persisted into `PAT_PatientGurantorInfo` (Guarantor table) by `AddPatientCareTaker`.

### 3.20 Configuration Models (referenced via `AdmissionDbContext`)

| Model | Table | Purpose |
|-------|-------|---------|
| `AdtAutoBillingItemModel` | `ADT_CFG_AutoBillingItem` | (Scheme, BedFeature, ServiceItem, MinCharge, UsePercentageOfBedCharges, PercentageOfBedCharges, IsRepeatable, IsActive). |
| `AdtDepositSettingsModel` | `ADT_CFG_DepositSettings` | (Scheme, BedFeature, DepositHead, MinDeposit, IsOnlyMinimumDeposit, IsActive). |
| `AdtBedFeatureSchemePriceCategoryMapModel` | `ADT_MAP_BedFeatureSchemePriceCategory` | Allowed (Scheme, BedFeature, PriceCategory) tuples. |
| `BillServiceItemSchemeSettingModel` | `BIL_MAP_ServiceItemSchemeSetting` | Per-scheme discount % (OP/IP/Reg/Admission) + co-payment rules. |
| `VisitSchemeChangeHistoryModel` | `VIS_LOG_VisitSchemeChangeHistory` | Audit trail of scheme/price-category changes. |

---

## 4. Database Tables (ADT scope)

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `ADT_PatientAdmission` | Admission header. | `PatientAdmissionId` (identity) |
| `ADT_TXN_PatientBedInfo` | Bed-stay transactions (one row per bed change). | `PatientBedInfoId` (identity) |
| `ADT_Bed` | Master list of physical beds. | `BedId` |
| `ADT_MST_Ward` | Master ward list. | `WardId` |
| `ADT_MST_BedFeature` | Master bed-feature list. | `BedFeatureId` |
| `ADT_MAP_BedFeaturesMap` | Junction (Bed × Ward × BedFeature). | `BedFeatureCFGId` |
| `ADT_BedReservation` | Bed reservations for future admission. | `ReservedBedInfoId` |
| `ADT_DischargeSummary` | Discharge summary header. | `DischargeSummaryId` (identity) |
| `ADT_DischargeSummaryMedication` | Discharge medications. | `DischargeSummaryMedicationId` |
| `ADT_DischargeSummaryConsultant` | Discharge consultants. | `id` |
| `ADT_DischargeType` | Discharge type lookup. | `DischargeTypeId` |
| `ADT_MST_DischargeConditionType` | Discharge condition lookup. | `DischargeConditionId` |
| `ADT_MST_DeliveryType` | Delivery type lookup. | `DeliveryTypeId` |
| `ADT_MST_BabyBirthCondition` | Baby birth condition lookup. | `BabyBirthConditionId` |
| `ADT_MST_DeathType` | Death type lookup. | `DeathTypeId` |
| `ADT_BabyBirthDetails` | Baby birth details. | `BabyBirthDetailsId` |
| `ADT_PatientCertificate` | Birth/death/medical certificates. | `CertificateId` |
| `ADT_DischargeCancel` | Audit of cancelled discharges. | `DischargeCancelId` |
| `ADT_CFG_AutoBillingItem` | Auto-billing item config. | `AdtAutoBillingItemId` |
| `ADT_CFG_DepositSettings` | Min-deposit config. | `AdtDepositSettingId` |
| `ADT_MAP_BedFeatureSchemePriceCategory` | (Scheme, BedFeature, PriceCategory) map. | `BedFeatureSchemePriceCategoryMapId` |
| `NEPH_HemodialysisRecord` | Hemodialysis records. | `HemodialysisRecordId` |
| `TXN_Sms` | Outbound SMS log (admission notification). | `SmsId` |

Cross-referenced tables the ADT module reads or writes (not in ADT_ scope):

| Table | Why ADT touches it |
|-------|-------------------|
| `PAT_PatientVisits` | Creates inpatient visit, updates `DepartmentId`, `PerformerId`, `PriceCategoryId`. |
| `PAT_Patient` | Reads demographics. |
| `PAT_MAP_PatientSchemes` | Updates credit limits, claim code. |
| `PAT_PatientGurantorInfo` | Upserts guarantor. |
| `BIL_TXN_Deposit` | Creates deposit, deposit transfer, return-deposit rows. |
| `BIL_TXN_BillingTransaction` | Creates a billing transaction for admission if `IsBillingEnabled`. |
| `BIL_TXN_BillingTransactionItems` | Adds bed charges and other auto-billing items. |
| `BIL_MST_ServiceItem` | Lookup for bed-charge service item. |
| `BIL_MAP_PriceCategoryServiceItem` | Lookup for bed price per price category. |
| `BIL_CFG_Scheme` | Reads scheme. |
| `BIL_CFG_PriceCategory` | Reads price category. |
| `BIL_MST_DepositHead` | Looks up default deposit head. |
| `BIL_MST_Credit_Organization` | Determines claim code handling. |
| `LAB_TestRequisition` | On admission cancel — moves lab items to outpatient. |
| `RAD_PatientImagingRequisition` | On admission cancel — moves imaging items to outpatient. |
| `CLN_Notes` | Receives a free-text note on transfer receive. |
| `CLN_FreeText` | Companion free-text body. |
| `TXN_EmpCashTransaction` | Cash drawer tracking for deposit + admission billing. |
| `MR_RecordSummary` | Reads MedicalRecordId for sticker / discharge slip. |
| `VIS_LOG_VisitSchemeChangeHistory` | Audit when price category changes on transfer. |
| `ER_Patient` | On reservation with `action=emergency`, marks `FinalizedStatus="admitted"`. |
| `CORE_CFG_Parameters` | Reads `MinutesBeforeAutoCancelOfReservedBed`, `ReservePreviousBedDuringTransferFromNursing`, `AutoCancellationOfTransferReserveInMins`. |
| `BIL_TXN_DischargeStatement` | Read/cancelled on discharge cancel. |

---

## 5. Key Workflows

### 5.1 Create Admission

Entry point: `POST /api/Admission/Admission`. Body is a serialized `AdmissionModel` that carries a `PatientBedInfos[0]`, an optional `BilDeposit`, an optional `BillingTransaction`, a `PatientSchemesMap`, and a `CareTaker`.

The handler `CreateAdmissionTransaction` (AdmissionController.cs:1036) runs in a single DB transaction:

1. **Validate** — `IsValidForAdmission` rejects if patient already has an `AdmissionStatus = "admitted"` row.
2. **Visit creation** — `VisitBL.GetVisitItemsMapped(...)` builds an `inpatient` visit; a unique `VisitCode` is generated and retried on `SqlException 2627` (unique-key violation).
3. **Claim code** — Generated through one of:
   - `SP_Claim_GenerateNewClaimCode` if `creditOrganization.IsClaimCodeAutoGenerate` is enabled and the scheme matches `CORE_CFG_Parameters "Insurance" → "ClaimCodeAutoGenerateSettings"`.
   - `GenerateClaimCode` (random 4-digit prefix + minute + second) if the credit organization requires a claim code and the patient has no prior claim.
   - Patient-scheme-map-supplied `LatestClaimCode` for non-auto-generate credit orgs.
4. **Patient Scheme Map upsert** — If the patient already has a `PatientSchemeMap` for this scheme, decrement IP/general credit limits by the billing transaction total and update `LatestClaimCode`, `LatestPatientVisitId`, etc. Otherwise insert a new map.
5. **Latest claim code on patient** — `GovInsuranceBL.UpdateLatestClaimCode` updates `PAT_Patient.LatestClaimCode` if insurance.
6. **Insert `AdmissionModel`** — set `CreatedOn`, `CreatedBy`, `PatientVisitId` from new visit, `IsInsurancePatient`.
7. **Insert first `PatientBedInfo`** — set `CreatedOn`, `CreatedBy`, `PatientVisitId`.
8. **Bed reservation handling** — If the bed was reserved for the same patient (matching `ReservedBedInfoId`), mark the reservation inactive. If it was reserved by another patient and is about to start (`AdmissionStartsOn - now <= MinutesBeforeAutoCancelOfReservedBed` — default 15 min, configurable via `CORE_CFG_Parameters`), auto-cancel that reservation. Otherwise throw `"Selected Bed is either already Reserved or Occupied !"`.
9. **Mark bed occupied** — `IsOccupied=true`, `IsReserved=false`, audit fields.
10. **Deposit transfer** — If the patient has an existing outpatient deposit balance, create a `ReturnDeposit` row and a new `Deposit` row tied to the new inpatient visit (`IsTransferTransaction=true`). Create `EmpCashTransaction` rows.
11. **New inpatient deposit** — If `BilDeposit.InAmount > 0`, insert a `Deposit` row with `VisitType="inpatient"` and create corresponding `EmpCashTransaction` rows.
12. **Auto-billing items** — Build `BillingTransactionItem` list (currently received from the client; the auto-build path via `ADTAutoAddItemParameterVM` is implemented but commented out in the call site).
13. **Bed charges on the bill** — Each bill item gets `BillStatus="provisional"`, `BillingType="inpatient"`, `VisitType="inpatient"`, provisional receipt number, fiscal year.
14. **Optional BillingTransaction** — If `IsBillingEnabled=true`, create a `BillingTransactions` row. Cash → `paid`; credit → `unpaid`; insurance → `unpaid` with `InsuranceProviderId=1` and `ClaimCode`.
15. **Commit transaction** + call `SP_BIL_Update_Duplicate_Invoice_If_Exists` to fix any race conditions on invoice numbering.
16. **Post-write side effects** — `AddPatientCareTaker` upserts the guarantor; if `AdmittingDoctorId` is set, an SMS is queued via `Task.Run(() => PostSMS(...))` to the doctor's contact number (uses Sparrowsms API; token in source code is a demo token).

### 5.2 Reserve Bed → Admit

1. **Reserve** — `POST /api/Admission/ReserveAdmission?actionName=emergency|...`. Creates `ADT_BedReservation` row, sets `Bed.IsReserved=true`. Auto-cancels any prior reservation on the same bed if it is within the auto-cancel window.
2. **Admit** — `POST /api/Admission/Admission` with `PatientBedInfos[0].ReservedBedId` set to the matching `ReservedBedInfoId`. During admission, the matching reservation is marked inactive.

### 5.3 Transfer

Entry point: `PUT /api/Admission/Transfer?transferredFrom=nursing&bedInfoId=...`. Body is a new `PatientBedInfo` (the target bed) and an optional `BedChargeBilItm`.

`TransferPatient` (AdmissionController.cs:4367) runs in a DB transaction:

1. Fetch the current `PatientBedInfo` by `bedInfoId`.
2. Set `EndedOn = newBedInfo.StartedOn` (if `EndedOn` is null), `OutAction="transfer"`, `BedOnHoldEnabled=false` (then set true if `transferredFrom=nursing`).
3. Old bed: `IsOccupied=false`. If `transferredFrom=nursing` AND `CORE_CFG_Parameters.ReservePreviousBedDuringTransferFromNursing == "true"`, then `oldBed.OnHold=true`, `oldBed.HoldedOn=StartedOn`, and the new bed is also placed on hold.
4. New bed: `IsOccupied=true` (and `OnHold=true` if held).
5. **Price category change** — If the new bed's `BedChargeBilItm.PriceCategoryId` differs from the current visit's `PriceCategoryId`, update the visit and insert a `VisitSchemeChangeHistoryModel` row with `ChangeAction="SystemUpdate"`.
6. **Stop auto-billing** — All `BillTxnItem` rows for this visit where `IsAutoBillingItem=true` and `IsAutoCalculationStop=false` are marked `IsAutoCalculationStop=true`.
7. **Re-add auto-billing items for new bed** — Joins `AdtAutoBillingItems × BillServiceItems × BillPriceCategoryServiceItems × ServiceDepartment` for `(SchemeId = admission.DiscountSchemeId, BedFeatureId = newBedInfo.BedFeatureId, PriceCategoryId, ServiceDepartmentName != "Bed Charges", IsRepeatable=true)`. Inserts new `BillingTransactionItemModel` rows. If `UsePercentageOfBedCharges` is true, the price is computed as `(PercentageOfBedCharges / 100) * BedChargeBilItm.Price`.
8. **Add new bed charge** — If `existingBedBillItem == null` (no provisional bed-charge for this feature yet) and `ADT/CoreParameter/AutoAddBillingItems/DoAutoAddBedItem=true`, insert `newBedInfo.BedChargeBilItm` as a provisional bill item.
9. Returns `GetAdtReturnData(newBedInfo.PatientBedInfoId)`.

#### 5.3.1 Receive Transfer (Nursing workflow)

`PUT /api/Admission/AdmitTransferredPatient`. Body: a `NotesModel`. The handler `ReceiveTransfer`:
- Fetches the two latest `PatientBedInfo` rows for the visit.
- Sets `ReceivedBy` and `ReceivedOn` on the latest one.
- Clears `OnHold` and `HoldedOn` on the new bed.
- If this is a true transfer (count > 1), frees the previous bed (`IsOccupied=false`).
- If `NotesMaster.PatientId != 0`, inserts a clinical note (`CLN_Notes` + `CLN_FreeText`).

#### 5.3.2 Undo Transfer

`PUT /api/Admission/UndoTransfer?cancelRemarks=...` — works only when `ReservePreviousBedDuringTransferFromNursing=true`. Reverses the pending transfer: marks latest `PatientBedInfo` as inactive, clears `OutAction` and `EndedOn` on the previous one, swaps `OnHold` flags back, and frees the new bed.

### 5.4 Bed Upgrade

The frontend `UpgradeComponent` posts to the same `Transfer` endpoint but restricts the selection to `SimilarBedFeatures` (other bed features in the same ward). Backend logic is identical to transfer; no special handling beyond the same code path. The `upgrade` event in the component signals the ADT list to refresh.

### 5.5 Change Admitting Doctor

`PUT /api/Admission/AdmittingDoctor` — updates both `AdmissionModel.AdmittingDoctorId` and `VisitModel.PerformerId/PerformerName/DepartmentId`. Used when the patient is moved between consultants or units.

### 5.6 Discharge

Two main paths:

1. **`PUT /api/Admission/Discharge?bedInfoId=...`** (`DischargePatient` handler) — deserializes the admission, calls `FreeBed(bedInfoId, DischargeDate, AdmissionStatus)`, persists the admission with the new status.
2. **`PUT /api/Admission/BillingDischarge`** (`DischargeFromBilling`) — called from the Billing module when the final bill is settled. Frees the latest `PatientBedInfo` for the visit, sets `AdmissionStatus="discharged"`, `DischargeDate`, `BillStatusOnDischarge`, `DischargedBy`, `ProcedureType`, `DiscountSchemeId`, `DischargeRemarks`.

Both end with `FreeBed`:
- `PatientBedInfo.OutAction = AdmissionStatus`
- `PatientBedInfo.EndedOn = DischargeDate`
- `Bed.IsOccupied=false`, `Bed.OnHold=false`, `Bed.HoldedOn=null`, `Bed.IsReserved=false`

For the **zero-item discharge** path (`POST /api/Admission/DischargeOnZeroItem`), an additional deposit-return row is created if `DepositBalance > 0` and an `EmpCashTransaction` with `TransactionType="ReturnDeposit"` is logged.

### 5.7 Discharge Summary

- `POST /api/Admission/DischargeSummary` — `AddDischargeSummary` persists the summary, child medications, and consultants in a single transaction.
- `PUT /api/Admission/DischargeSummary` — `UpdateDischargeSummary` replaces all child medications and consultants (delete-then-insert).
- `GET /api/Admission/DischargeSummary?patientVisitId=...` — `GetDischargeSummary` returns the full summary with joined doctor signatures, NMC numbers, condition types, delivery types, baby birth details, certificates, consultant list, medication list ordered by `OldNewMedicineType`.

### 5.8 Cancel Admission

`PUT /api/Admission/CancelAdmission` — `CancelAdmission` runs in a DB transaction with three phases:

- **Phase 1** — `ADT_PatientAdmission.AdmissionStatus="cancel"`, `CancelledOn`, `CancelledBy`, `CancelledRemark`. The inpatient visit is set to `VisitStatus="cancel"`, `BillingStatus="cancel"`, with remarks `"Admission Cancel: ..."`. All `PatientBedInfo` rows are set `Action="cancel"`, `EndedOn=now`, and the bed is freed.
- **Phase 2** — All `BillingTransactionItemModel` rows for the visit with `ServiceDepartment.IntegrationName == "Bed Charges"` are cancelled. Other (non-cancelled) bill items are reassigned to the latest outpatient/emergency visit of the same day (so lab and radiology can be billed as outpatient instead of being lost). Lab and imaging requisitions are reassigned in lockstep.
- **Phase 3** — Deposit balance is returned: a new `ReturnDeposit` row is created with the same fiscal year and counter as the latest deposit; `BillingUser` is set to the current user; `IsActive=true` so balance reads remain correct.

### 5.9 Cancel Discharge (Re-admit)

`POST /api/Admission/CancelDischargeBill` — `CancelDischargedInPatient`. Reverses a discharge:
- For each cancelled bill item, creates a new bill item linked to the existing `BillingTransactionId` with status `unpaid` (or `provisional` if it was provisional).
- For each new lab/imaging item, updates the requisition's `BillingTransactionItemId` to the new item id.
- Marks `ADT_DischargeSummary.IsDischargeCancel=true` and `BIL_TXN_DischargeStatement.IsDischargeCancel=true`.

### 5.10 Bed Management (Status Maintenance)

Beds are managed by `BedMasterController` and the legacy `ADT/Admission/Bed` views (not in the `Admission` controller). The ADT module only flips `IsOccupied`, `IsReserved`, `OnHold`, `HoldedOn` flags as a side effect of admission/transfer/discharge/reservation.

`GetAllWardBedInfo` returns the per-ward summary:
```
WardId, TotalBed, Occupied = count(b => b.IsOccupied == true), Vacant = count(b => b.IsOccupied == false && b.IsActive == true)
```

### 5.11 Ward Management

Wards are also managed by master-data controllers. The ADT module exposes `GET /api/Admission/Wards` (active wards only) for use during admission/transfer/upgrade.

### 5.12 Bed Reservation Workflow

1. Frontend posts `POST /api/Admission/ReserveAdmission?actionName=emergency` (or no action). Body is `ADTBedReservation` (PatientId, WardId, BedFeatureId, BedId, AdmissionStartsOn, AdmittingDoctorId, RequestingDepartmentId, AdmissionNotes).
2. Backend checks: bed must be `IsActive && !IsOccupied`.
3. If the bed is already reserved, the existing reservation is auto-cancelled if its start time is within the configured auto-cancel window.
4. Bed is flagged `IsReserved=true`. A new `ADT_BedReservation` row is created with `IsActive=true`.
5. If `actionName=emergency`, the matching `ER_Patient` row is updated to `FinalizedStatus="admitted"`, `ERStatus="finalized"`, `FinalizedOn`, `FinalizedBy`.

The reservation stays in the table until admission consumes it (sets `IsActive=false`) or `CancelReservedAdmission` is invoked.

### 5.13 Hemodialysis Reporting

`POST /api/Admission/HemoDialysisReport` saves a full `HemodialysisModel` (treatment orders, vascular access, blood transfusion, treatment data, on-exam, totals, signatures). This is part of the ADT controller because hemodialysis patients are admitted inpatients. `GET /api/Admission/LatestHemoDialysisReport` and `HemoDialysisReports` retrieve the records for the patient overview page.

### 5.14 Sticker / Wrist Band / Admission Slip

These endpoints shape data for printable artifacts:
- `GET /api/Admission/AdmissionSticker?patientVisitId=...` — patient, address, ward/bed, scheme, policy number, user.
- `GET /api/Admission/WristBandInfo?patientVisitId=...` — `IpWristBandInfoVM` (patient code, name, blood group, ward, bed).
- `GET /api/Admission/AdmissionSlipDetails?PatientVisitId=...` — `PatientAdmissionSlip_DTO`.
- `GET /api/Admission/DischargeSlipDetails?PatientVisitId=...` — `PatientDischargeSlip_DTO`.

`POST /api/Admission/WristBand` saves the rendered HTML to disk for printing (`ADT_WristBand_{PrinterName}_user_{EmployeeId}.html`).

### 5.15 Birth / Death Certificates

- `POST /api/Admission/BirthCertificate` — `AddPatientBirthCertificate` saves a `PatientCertificateModel` (Birth/Death/Medical) and, if a `BabyBirthDetailsId` is supplied, back-fills the certificate number into the baby-birth row.
- `PUT /api/Admission/BirthCertificate` — updates the certificate.
- Baby birth details are stored in `ADT_BabyBirthDetails` and linked to the discharge summary.
- Death details use `DeathDetailsModel` (legacy).

### 5.16 Favorites & Follow-ups

- `GET /api/Admission/FavouritePatients` — XML-stored per-employee favorite patient ids (`EMP_EmployeePreferences` row with `PreferenceName="Patientpreferences"`).
- `GET /api/Admission/NursingFavouritePatients` — same with `NursingPatientPreferences`. Auto-prunes any visits that have since been discharged.
- `GET /api/Admission/FollowUpPreferences` — `Followuppreferences` XML.

### 5.17 Doctor/Department/Ward Dropdown (Combined)

`GET /api/Admission/DoctorDeparmentAndWardInfo?patientId=...` — returns:
- Doctor list (employees with `IsAppointmentApplicable=true`, joined to Department).
- Filtered department list (`IsAppointmentApplicable=true`).
- Ward list.
- `BedReservedForCurrentPat` — the active `ADTBedReservation` for this patient, but only if its start time is outside the auto-cancel window.

---

## 6. API Endpoints (Summary)

All routes are prefixed with `/api/Admission/` (or `/api/Admission` for some). All responses follow `DanpheHTTPResponse<T>` with `Status` (`"OK"` or `"Failed"`), `Results`, and `ErrorMessage`.

### 6.1 GET

| Endpoint | Purpose |
|----------|---------|
| `GET /AdmittedPatientsData?admissionStatus=&patientVisitId=` | Full ADT grid (uses stored proc). |
| `GET /Wards` | Active wards. |
| `GET /Departments` | Active departments. |
| `GET /BedFeatures` | Active bed features. |
| `GET /DischargedPatients?admissionStatus=&FromDate=&ToDate=` | Discharged patients in date range. |
| `GET /AdmittedPatients?admissionStatus=&FromDate=&ToDate=` | Admitted patients in date range. |
| `GET /PatientAndBedInfo?patientId=&patientVisitId=` | Patient + bed info. |
| `GET /AdmissionInfo?patientId=&ipVisitId=` | Patient + deposit + bed info. |
| `GET /AdmittedPatientBedInfo?patientVisitId=` | Bed history for a visit. |
| `GET /AdmittedPatientForNursing?search=&ToDate=&wardId=&FromDate=` | Nursing list, ward-filtered. |
| `GET /TransferredPatientInfo` | In-transit patients (not yet received). |
| `GET /PatientAdmissionStatus?patientId=` | Is the patient currently admitted? |
| `GET /ProvisionalBillStatus?patientId=` | Does the patient have open provisional items? |
| `GET /Doctors` | OPD doctors with consultation fee. |
| `GET /AppointmentApplicableDoctorList` | Doctors + departments. |
| `GET /AppointmentApplicableDoctors` | Cached active appointment-applicable doctors. |
| `GET /Anaesthetists` | Employees with role "Anaesthetist". |
| `GET /DischargeTypes` | Discharge types. |
| `GET /DischargeSummary?patientVisitId=` | Full discharge summary. |
| `GET /AvailableBeds?wardId=&bedFeatureId=` | Vacant beds + bed bill item. |
| `GET /Ward/BedFeatures?wardId=&priceCategoryId=` | Bed features in a ward with prices. |
| `GET /SimilarBedFeatures?wardId=&bedFeatureId=` | Other bed features in the ward. |
| `GET /AdmissionHistory?patientId=` | Full admission history. |
| `GET /LatestAdmissionInfo?patientId=` | Most recent admission. |
| `GET /AdmissionSticker?patientVisitId=` | Sticker data. |
| `GET /WristBandInfo?patientVisitId=` | Wrist band data. |
| `GET /LatestHemoDialysisReport?patientId=` | Last hemo record. |
| `GET /HemoDialysisReports?patientId=` | All hemo records. |
| `GET /PatientBedInfos?patientId=&patientVisitId=` | Existing bed-feature ids for a visit. |
| `GET /ICD10` | Active ICD-10 codes. |
| `GET /MedicationFrequencies` | Frequency list. |
| `GET /DischargeConditions` | Discharge conditions. |
| `GET /DeliveryTypes` | Delivery types. |
| `GET /BirthConditions` | Baby birth conditions. |
| `GET /DeathTypes` | Death types. |
| `GET /ActiveFiscalYear` | Current fiscal year name. |
| `GET /FollowUpPreferences` | Per-employee follow-up patient ids. |
| `GET /PatientCertificate?dischargeSummaryId=&patientId=` | Certificates + address. |
| `GET /DoctorDeparmentAndWardInfo?patientId=` | Doctor/Dept/Ward dropdowns + reserved bed. |
| `GET /FavouritePatients` | Favorite patient ids for current employee. |
| `GET /NursingFavouritePatients` | Same, nursing-version, auto-prunes discharged. |
| `GET /GetAllWardBedInfo` | Per-ward bed occupancy summary. |
| `GET /AdmissionSlipDetails?PatientVisitId=` | Admission slip data. |
| `GET /DischargeSlipDetails?PatientVisitId=` | Discharge slip data. |
| `GET /AdmissionSchemePriceCategoryInfo?patientVisitId=` | Scheme + price category for a visit. |
| `GET /AvailableBedsAndBedFeaturePrice?wardId=&bedFeatureId=&priceCategoryId=` | Available beds + price in one call. |
| `GET /IsPreviousBedAvailable?patientVisitId=` | Used by transfer/upgrade. |
| `GET /AdtAutoBillingItems` | All active auto-billing items. |
| `GET /AdtDepositSettings` | All active deposit settings. |
| `GET /SchemeAdtAutoBillingItems?schemeId=&priceCategoryId=&serviceBillingContext=` | Scheme-specific auto-billing items. |
| `GET /SchemeAdtDepositSettings?schemeId=` | Scheme-specific deposit settings. |
| `GET /BedFeatureSchemePriceCategoryMap?schemeId=` | Allowed (bedFeature, priceCategory) pairs. |

### 6.2 POST

| Endpoint | Purpose |
|----------|---------|
| `POST /Admission` | Full admission create (visit, admission, bed, deposit, billing). |
| `POST /DischargeSummary` | Save discharge summary + child medications + consultants. |
| `POST /AdmissionRemark` | Add a remark row. |
| `POST /WristBand?PrinterName=&FilePath=` | Save wrist band HTML for print. |
| `POST /CancelDischargeBill` | Roll back a discharge. |
| `POST /HemoDialysisReport` | Save hemodialysis record. |
| `POST /BirthCertificate` | Save birth certificate. |
| `POST /ReserveAdmission?actionName=` | Reserve a bed (with optional `actionName=emergency`). |
| `POST /DischargeOnZeroItem` | Discharge with no billable items. |

### 6.3 PUT

| Endpoint | Purpose |
|----------|---------|
| `PUT /Discharge?bedInfoId=` | Mark discharged + free bed. |
| `PUT /ClearDueAmount?patientVisitId=` | Mark bill paid after settlement. |
| `PUT /Transfer?bedInfoId=&transferredFrom=` | Transfer patient to a new bed. |
| `PUT /AdmissionInfo` | Edit admission/bed dates. |
| `PUT /AdmittingDoctor` | Change admitting doctor. |
| `PUT /DischargeSummary` | Update discharge summary. |
| `PUT /BillingDischarge` | Discharge triggered from billing. |
| `PUT /AdmissionProcedure?AdmissionPatientId=&ProcedureType=` | Update procedure type. |
| `PUT /CancelAdmission` | Cancel admission (3-phase flow). |
| `PUT /BirthCertificate` | Update birth certificate. |
| `PUT /ReserveAdmission` | Update a bed reservation. |
| `PUT /CancelReserveAdmission` | Cancel a bed reservation. |
| `PUT /UndoTransfer?cancelRemarks=` | Undo a pending transfer. |
| `PUT /AdmitTransferredPatient` | Receive a transferred patient. |

---

## 7. Cross-Module Interactions

| Module | Interaction |
|--------|-------------|
| **Patient** | Reads `PAT_Patient`, `PAT_PatientAddress`, `MST_CountrySubDivision`, `MST_Municipality`, `MST_Country` for sticker/wrist band/discharge slip. Updates `PAT_PatientGurantorInfo` (caretaker). |
| **Visit / Appointments** | `VisitBL.GetVisitItemsMapped` creates an `inpatient` visit. `VisitModel` is updated for `DepartmentId`, `PerformerId`, `PerformerName`, `PriceCategoryId`. Visit status set to `cancel` on admission cancel. |
| **Billing** | Heavy integration. Creates `BIL_TXN_Deposit` rows (return/transfer/new), `BIL_TXN_BillingTransaction` (admission bill), `BIL_TXN_BillingTransactionItems` (bed charges + auto-billing items), `BIL_TXN_DischargeStatement` (read for cancel), `TXN_EmpCashTransaction` rows. Uses `BillingBL.GetInvoiceNumber`, `GetProvisionalReceiptNo`, `GetDepositReceiptNo`, `GetFiscalYear`. |
| **Insurance / Scheme** | Reads `BIL_CFG_Scheme`, `BIL_CFG_PriceCategory`, `BIL_MST_Credit_Organization`, `BIL_MAP_ServiceItemSchemeSetting`, `BIL_MAP_PriceCategoryServiceItem`. Generates claim codes. Updates `PAT_MAP_PatientSchemes` credit limits. |
| **Lab** | On admission cancel — `LAB_TestRequisition.PatientVisitId` and `VisitType` reassigned to the outpatient/emergency visit of the same day. On discharge cancel — `BillingTransactionItemId` repointed to the new bill item. |
| **Radiology** | Same as lab, on `RAD_PatientImagingRequisition`. |
| **Nursing** | Consumes `GET /AdmittedPatientForNursing` and `GET /TransferredPatientInfo` to render the ward board. Uses transfer/upgrade/receive components from `adt/shared/`. |
| **Clinical** | On `ReceiveTransfer` — inserts a `CLN_Notes` row + `CLN_FreeText` body to record the receiving clinical note. |
| **Master Data** | Reads `EMP_Employee`, `MST_Department`, `BIL_MST_ServiceItem`, `BIL_MST_ServiceDepartment`, `CORE_CFG_Parameters`, `BIL_MST_DepositHead`, `MST_PaymentModes`, `EMP_EmployeePreferences`. |
| **Emergency** | On `ReserveAdmission?actionName=emergency`, `ER_Patient.FinalizedStatus="admitted"`, `ERStatus="finalized"`, `FinalizedOn/By` are set. |
| **Hemodialysis (NEPH)** | Persists `NEPH_HemodialysisRecord` via `POST /HemoDialysisReport`. |
| **Pharmacy / Inventory** | Not directly integrated in the ADT controller. Bed-charge bills are visible through billing transaction items. |
| **Medical Records** | Reads `MR_RecordSummary.MedicalRecordId` for the admission sticker and discharged list. |
| **Authentication / RBAC** | `RbacUser` is read from `HttpContext.Session` for `currentUser.EmployeeId`. View access controlled by `DanpheViewFilter` attributes. |
| **Core** | Reads `CORE_CFG_Parameters` for `MinutesBeforeAutoCancelOfReservedBed`, `ReservePreviousBedDuringTransferFromNursing`, `AutoCancellationOfTransferReserveInMins`, `AutoAddBillingItems` (with subkey `DoAutoAddBedItem`). |
| **Discharge Summary Frontend (separate `discharge-summary` module)** | `DischargeSummaryModule` declares `DischargeSummaryComponent` (root) and `BirthCertificateGenerateComponent`, `DeathCertificateComponent` from `shared/generate-certificate/`. These are part of the same `discharge-summary` Angular module, separate from `ADTModule`. |

---

## 8. Key Business Rules

### 8.1 Bed Reservation Auto-Cancel

- Default `MinutesBeforeAutoCancelOfReservedBed = 15` (overridable via `CORE_CFG_Parameters`).
- If a bed is already reserved and the new admission arrives within that window of `AdmissionStartsOn`, the prior reservation is auto-cancelled (`IsActive=false`, `IsAutoCancelled=true`, `AutoCancelledOn=now`).
- Outside the window, attempting to admit into a reserved bed throws `"Selected Bed is either already Reserved or Occupied !"`.

### 8.2 Transfer Bed-On-Hold

- Default disabled. When `ReservePreviousBedDuringTransferFromNursing=true` and `transferredFrom=nursing`:
  - The previous bed is held (`OnHold=true`, `HoldedOn=StartedOn`).
  - The new bed is also held.
- A separate scheduled job (`UpdateNotReceivedTransferredBed`) auto-cancels holds after `AutoCancellationOfTransferReserveInMins` (default 360 minutes, +2 min buffer).
- `ReceiveTransfer` clears the holds and frees the previous bed.
- `UndoTransfer` rolls back the transfer when the hold is still active.

### 8.3 Auto-Billing Items

- Driven by `ADT_CFG_AutoBillingItem` (Scheme, BedFeature, ServiceItem, MinCharge, UsePercentageOfBedCharges, PercentageOfBedCharges, IsRepeatable).
- On admission, all `IsRepeatable=false` items are skipped (one-time charges). On transfer, items with `IsRepeatable=true` and `ServiceDepartmentName != "Bed Charges"` are added again. Items already in the visit with `IsAutoCalculationStop=false` are first marked stopped so they don't double-accumulate.
- `UsePercentageOfBedCharges=true` items use `(PercentageOfBedCharges / 100) * BedChargeBilItm.Price` to derive their bill price.
- Per-scheme discount / co-payment rules are applied through `BIL_MAP_ServiceItemSchemeSetting` (different % for OP/IP/Registration/Admission contexts).

### 8.4 Deposit Transfer on Admission

- Outpatient deposit balance is transferred to the new inpatient visit (two rows: a `ReturnDeposit` on the OP side, a `Deposit` on the IP side, both `IsTransferTransaction=true`).
- `BIL_MST_DepositHead` default head is read once and reused.
- `EmpCashTransaction` is logged for both directions.

### 8.5 Claim Code Generation

- Determined by `CORE_CFG_Parameters "Insurance" → "ClaimCodeAutoGenerateSettings"` (JSON: `{EnableAutoGenerate, SchemeId}`).
- If the credit organization is `IsClaimCodeAutoGenerate=true` and matches the configured `SchemeId`, the next claim code is generated via `SP_Claim_GenerateNewClaimCode`.
- Otherwise, fallback logic: random 4-digit + minute + second (legacy `GenerateClaimCode`); or the patient's stored `LatestClaimCode` if available.
- After visit is saved, `GovInsuranceBL.UpdateLatestClaimCode` writes the new code back to `PAT_Patient.LatestClaimCode`.

### 8.6 Bed Charge Bill Item Rules

- `ADT.CoreParameter.AutoAddBillingItems.DoAutoAddBedItem` controls whether a new bed-charge bill item is created on transfer. Default `false` (commented out in code).
- A bed-charge bill item is created only if no provisional item exists for the same `BedFeatureId` on the visit.
- `BillingTransactionItem.BillStatus` is forced to `"provisional"`, `BillingType="inpatient"`, `VisitType="inpatient"`.
- `IsAutoBillingItem=true` is set so it can be auto-managed (stopped/replaced) on transfer.

### 8.7 Admission Cancel Bill Item Reassignment

- Bed-charge items: `BillStatus="cancel"`, `CancelledOn`, `CancelledBy`, `CancelRemarks`.
- All other non-cancelled bill items: `PatientVisitId` and `VisitType` reassigned to the latest outpatient/emergency visit of the same day, `BillingType` set accordingly. Lab and imaging requisitions are reassigned in lockstep.

### 8.8 Discharge Cancel Re-Activate

- For each cancelled bill item on the previous visit, a new bill item is added on the same `BillingTransactionId` (status `unpaid` if it was paid, `provisional` if it was provisional).
- Lab and imaging requisitions are re-pointed to the new bill item.
- `ADT_DischargeSummary.IsDischargeCancel=true` and `BIL_TXN_DischargeStatement.IsDischargeCancel=true` to prevent re-printing cancelled summaries.

### 8.9 Unique Visit Code Generation

- `VisitBL.CreateNewPatientVisitCode(visitType, connString)` returns a code like `IP-YY-NNNN`.
- If the SQL insert fails with `SqlException 2627` (unique constraint), `GenerateUniqueVisitCodeAndSaveChanges` recursively retries with a new code. Bounded only by recursion depth (no explicit cap).

### 8.10 Provisional Discharge State

- `AdmissionModel.IsProvisionalDischarge` and `IsProvisionalDischargeCleared` track two-step discharge. Not currently set by the main discharge handlers but exposed on the model for downstream billing workflows.

### 8.11 Nursing-Side Visit Code on Transfer Receive

- `ReceiveTransfer` accepts a `NotesModel` with `PatientVisitId`, `PatientId`, `ReceivedOn`, plus a `FreeText` body. If `PatientId != 0`, a clinical note is inserted alongside the bed-on-hold clearing.

### 8.12 Admission Doctor SMS Notification

- After `CreateAdmissionTransaction` returns successfully, if `AdmittingDoctorId > 0` and the doctor has a `ContactNumber`, an SMS is queued via `Task.Run(() => PostSMS(...))` to the Sparrowsms API.
- The message is built from the doctor's name, patient name, patient code, and bed code.
- Note: in the source the API token is hard-coded (`"1eZClpxXFuZXd7PJ0xmv"`, from `"Demo"`). Treat as demo credentials only.

### 8.13 Free Bed Side-Effects

`FreeBed(int bedInfoId, DateTime endedOn, string outAction)` (referenced from `DischargePatient`, `DischargeFromBilling`, `CancelAdmission`):
- `PatientBedInfo.OutAction = outAction`
- `PatientBedInfo.EndedOn = endedOn`
- `Bed.IsOccupied = false`
- `Bed.OnHold = false`
- `Bed.HoldedOn = null`
- `Bed.IsReserved = false`

### 8.14 Lookup Safety for Null Doctor in `IsPoliceCase` Computation

- `IsPoliceCase = admission.AdmissionCase == "Police Case"` (default false). Computed in `GetDischargedPatientList` with a null-safe ternary.

### 8.15 Active Fiscal Year Computation

- `GetActiveFicalYear` reads the fiscal year whose `[StartYear, EndYear]` window contains `DateTime.Now.Date`. This is the canonical source for admission-time receipt numbers (`GetProvisionalReceiptNo`, `GetDepositReceiptNo`, `GetInvoiceNumber`).

### 8.16 Caretaker / Guarantor

- `AddPatientCareTaker` upserts `PAT_PatientGurantorInfo` using `CareOfPersonName`, `CareOfPersonRelation`, `CareOfPersonPhoneNo` from `CareofPerson_DTO`. Always called after a successful admission create.

### 8.17 Insurance Patient on Bed Allocation

- `AdmissionModel.IsInsurancePatient` is mirrored from the visit's `Ins_HasInsurance` at admission.
- Propagated to `PatientBedInfo.IsInsurancePatient` (NotMapped) so transfer/upgrade handlers can pass it to the bed-charge bill item.

### 8.18 Employee Filter for Doctor List

- `IsAppointmentApplicable=true AND IsActive=true` (cache-backed in `AppointmentApplicableDoctors`).
- For OPD pricing, hardcoded `PriceCategoryId == 1` is used in the legacy `GetDoctorList` query (the `PriceCategoryId=1` "Normal" lookup is a known migration debt).
- Anaesthetists are filtered by `EmployeeRole.EmployeeRoleName == "Anaesthetist"`.

### 8.19 Stored Procedure: `SP_ADT_GetAllAdmittedPatients`

- Used by `GetADTList`. Returns a wide result set mapped by `GetAdmittedList_ResultFromSP_VM.MapDataTableToSingleObject`. Handles both admitted and discharged statuses. `UpdateNotReceivedTransferredBed` is run first to auto-cancel stale transfer holds before reading.

### 8.20 Auto-Deduplication of Invoice Number

- After `CreateAdmissionTransaction` commits, if `IsBillingEnabled=true`, the stored proc `SP_BIL_Update_Duplicate_Invoice_If_Exists` is called to fix any race condition where two admissions landed on the same invoice number. The result is the latest invoice number, which is then re-assigned to `billingTransaction.InvoiceNo`.

---

## 9. Frontend Structure (Angular)

### 9.1 Modules

| Module | Path | Purpose |
|--------|------|---------|
| `ADTModule` | `wwwroot/DanpheApp/src/app/adt/adt.module.ts` | Main ADT module. Declares `ADTMainComponent`, `AdtHomeComponent`, `AdmissionCreateComponent`, `AdmissionSearchPatient`, `AdmittedListComponent`, `DischargedListComponent`, `UpgradeComponent`, `AdmissionPrintStickerComponent`, `PatientBedHistory`, `AdmissionCancelComponent`, `IPWristBandPrintComponent`, `ChangeDoctorComponent`. Imports `ADTRoutingModule`, `ADTSharedModule`, `DischargeSummaryModule`, `BillingSharedModule`, `BillingPrintSharedModule`, `ClinicalSharedModule`, `SettingsSharedModule`, `RegistrationSchemeSharedModule`. |
| `ADTSharedModule` | `wwwroot/DanpheApp/src/app/adt/adt-shared.module.ts` | Exports `TransferComponent` (also re-used by Nursing module) and the admission history component. |
| `ADTRoutingModule` | `wwwroot/DanpheApp/src/app/adt/adt-routing.module.ts` | Routes: `/AdmissionSearchPatient` (default), `/CreateAdmission`, `/AdmittedList`, `/DischargedList`, `/AdtHome`. Guards: `AuthGuardService`, `AdmissionSelectPatientCanActivateGuard`, `ActivateBillingCounterGuardService`. |
| `DischargeSummaryModule` | `wwwroot/DanpheApp/src/app/discharge-summary/discharge-summary.module.ts` | Separate module for discharge summary + birth/death certificate generation. Declares `DischargeSummaryComponent`, `BirthCertificateGenerateComponent`, `DeathCertificateComponent`. |

### 9.2 Components

| Component | Path | Role |
|-----------|------|------|
| `ADTMainComponent` | `adt/adt-main.component.ts` | Layout shell. Reads child routes from `SecurityService.GetChildRoutes("ADTMain")`. |
| `AdtHomeComponent` | `adt/adt-home.component.ts` | Bed-feature dashboard. Pulls from `/api/Helpdesk/BedsInfo` and `/api/Helpdesk/BedOccupancyOfWards` (note: not the ADT controller). Hosts bed-detail, vitals, and transfer views. |
| `AdmissionCreateComponent` | `adt/admission/adm-create/admission-create.component.ts` | Full admission form. Validates uniqueness via `CheckPatientAdmission`. Posts to `/api/Admission/Admission`. |
| `AdmissionSearchPatient` | `adt/admission/search-patient/` | Patient search to start an admission. |
| `AdmittedListComponent` | `adt/admission/adm-list/` | Admitted patient grid. |
| `DischargedListComponent` | `adt/discharge/discharge-list.component.ts` | Discharged patient grid. |
| `TransferComponent` | `adt/transfer/transfer.component.ts` | Transfer form (828 lines). Uses `ADT_BLService.TransferBed`, fetches scheme/price category, auto-billing items, available beds, etc. Emits `transfer` and `notify-adt` events. |
| `UpgradeComponent` | `adt/upgrade/upgrade.component.ts` | Bed feature upgrade form. Uses `ADT_BLService.UpgradeBedFeature`. |
| `ChangeDoctorComponent` | `adt/change-doctor/change-doctor.component.ts` | Change admitting doctor. |
| `AdmissionCancelComponent` | `adt/admission/adm-cancel/` | Cancel an admission. |
| `AdmissionPrintStickerComponent` | `adt/sticker/admission-print-sticker.component.ts` | Print admission sticker. |
| `IPWristBandPrintComponent` | `adt/ip-wrist-band/ip-wrist-band-print.component.ts` | Print IP wrist band. |
| `PatientBedHistory` | `adt/patient-bed-history/` | Patient's bed history timeline. |
| `DischargeSummaryComponent` | `discharge-summary/discharge-summary.component.ts` | Discharge summary root (placeholder; the actual summary editor is `add`/`view-model`/sub-components). |
| `BirthCertificateGenerateComponent` | `discharge-summary/shared/generate-certificate/generate-birth-certificate.component.ts` | Birth certificate generation. |
| `DeathCertificateComponent` | `discharge-summary/shared/generate-certificate/generate-death-certificate.component.ts` | Death certificate generation. |

### 9.3 Services

| Service | Path | Role |
|---------|------|------|
| `ADT_DLService` | `adt/shared/adt.dl.service.ts` | Direct HTTP layer. All `get/post/put` calls to `/api/Admission/*`. |
| `ADT_BLService` | `adt/shared/adt.bl.service.ts` | Business layer over `ADT_DLService` — wrappers, validation, message composition. |
| `AdmissionMasterBlService` | `adt/shared/admission-master.bl.service.ts` | Calls `/api/Admission/AdtAutoBillingItems`, `AdtDepositSettings`, `SchemeAdtAutoBillingItems`, `SchemeAdtDepositSettings`, `BedFeatureSchemePriceCategoryMap`. |
| `AdmissionMasterDlService` | `adt/shared/admission-master.dl.service.ts` | HTTP layer for the master endpoints. |
| `AdmissionSelectPatientCanActivateGuard` | `adt/shared/admission-select-patient-canactivate-guard.ts` | Route guard ensuring a patient is selected before admission. |
| `DischargeSummaryBLService` | `discharge-summary/shared/discharge-summary.bl.service.ts` | Discharge summary business layer. |
| `DischargeSummaryDLService` | `discharge-summary/shared/discharge-summary.dl.service.ts` | Discharge summary HTTP layer. |

### 9.4 Shared Models (TypeScript)

`adt/shared/` contains the TypeScript mirrors of the .NET models. Notable ones:

- `admission.model.ts` — `AdmissionModel` mirror.
- `admission.view.model.ts` — `AdmissionCancelVM`, `AdmissionInfoVM`, `PatientBedInfoVM`, `UpdateAdmittingDoctorVM`, `AdmittingDocInfoVM`, `ADTAutoAddItemParameterVM`, `ADTAutoAddItemVM`.
- `patient-bed-info.model.ts` — `PatientBedInfo` + form validators (`PatientBedInfoValidator`).
- `bed.model.ts` — `Bed`, `BedDisplayModel`, `BedFeatureModel`.
- `bedfeature.model.ts` — `BedFeature` + `BedFeature_DTO`.
- `bedfeature-map.model.ts` — `BedFeaturesMap`.
- `bed-reservation-info.model.ts` — `ADTBedReservation`.
- `bedinformation.model.ts` — embedded bed info.
- `ward.model.ts` — `Ward`.
- `discharge-summary.model.ts` — `DischargeSummary` model with child collections.
- `discharge-summary-consultant.model.ts` — `DischargeSummaryConsultant`.
- `discharge-summary-medication.model.ts` — `DischargeSummaryMedication`.
- `discharge-type.model.ts` — `DischargeType`.
- `dischage-cancel.model.ts` — `DischargeCancel`.
- `discharge-slip-details.dto.ts` — `PatientDischargeSlip_DTO`.
- `baby-birth-details.model.ts` — `BabyBirthDetails`.
- `death.detail.model.ts` — `DeathDetail`.
- `consultant-view-model.ts` — `DischargeSummaryConsultantViewModel`.
- `selectedbed.model.ts` — `selectedbed` shared with `AdtHomeComponent`.
- `role-management.model.ts` — RBAC helpers.
- `DTOs/` — `AdtAutoBillingItem_DTO`, `AdtBedFeatureSchemePriceCategoryMap_DTO`, `AdtSettingDeposit_DTO`, `AdtMinimumDepositSetting_DTO`, `BedFeature_DTO`, `PatientAdmissionSlip_DTO`, `DischargeCancel_DTO`.
- `adt-grid-column-settings.ts` — ag-Grid column definitions.

### 9.5 Admission Search / Create / List Routes (Angular)

```
/adt (root)                              -> AdtHomeComponent (requires counter activation)
/adt/AdmissionSearchPatient              -> AdmissionSearchPatient
/adt/CreateAdmission                     -> AdmissionCreateComponent
/adt/AdmittedList                        -> AdmittedListComponent
/adt/DischargedList                      -> DischargedListComponent
```

### 9.6 Discharge Summary Routes (Angular)

The discharge summary sub-router is defined in `discharge-summary/discharge-summary-routing.ts`. It hosts the summary editor (`add` / `add-view-summary`), the view (`view` / `view-model`), and certificate generation (`shared/generate-certificate/`).

---

## 10. Cross-Cutting Notes

### 10.1 Common Patterns

- **Authorization context** — Every write endpoint pulls the `RbacUser` from session and uses `currentUser.EmployeeId` for `CreatedBy`/`ModifiedBy`. The `HttpContext.Session` reads are done inside the controller method (not via DI).
- **Error handling** — Exceptions thrown inside the private handlers are caught by the `InvokeHttpGetFunction`/`InvokeHttpPostFunction`/`InvokeHttpPutFunction` base class helpers, which produce a `DanpheHTTPResponse<object>` with `Status="Failed"`, `ErrorMessage=ex.Message`, and an HTTP 200 (the status field is the source of truth, not the HTTP status).
- **Transaction boundaries** — `CreateAdmissionTransaction`, `ReserveAdmission`, `TransferPatient`, `DischargeFromBilling`, `CancelAdmission`, `CancelDischargedInPatient`, `DischargeOnZeroItem`, `UpdateAdmissionReservation`, `CancelReservedAdmission`, `UndoTransfer`, `ReceiveTransfer`, `AddDischargeSummary` all use `Database.BeginTransaction()` with explicit commit/rollback.
- **Partial updates** — The pattern `_admissionDbContext.Entry(x).Property(p => p.Foo).IsModified = true;` is used to update a subset of fields without overwriting others. Frequent across the controller.
- **Lazy loading** — `AdmissionDbContext.Configuration.LazyLoadingEnabled = true` (but `ProxyCreationEnabled = false`).

### 10.2 Stored Procedures

- `SP_ADT_GetAllAdmittedPatients` — Used by `GetADTList` to return the unified ADT grid.
- `SP_Claim_GenerateNewClaimCode` — Used by `GetLatestClaimCode` to produce a new claim code for a given scheme.
- `SP_BIL_Update_Duplicate_Invoice_If_Exists` — Used after admission to fix any race in invoice number assignment.

### 10.3 Known Migration Debts / Hardcodes

- `PriceCategoryId=1` is hardcoded as "Normal" in `GetDoctorList`. Multi-price-category logic exists in `AdmissionMasterService` but is not yet threaded into the doctor list query.
- `InsuranceProviderId=1` is hardcoded for insurance billing transactions (only one insurance provider is supported).
- The Sparrowsms API token (`"1eZClpxXFuZXd7PJ0xmv"`) is hardcoded in `PostSMS`. Treat as a placeholder.
- `IsLastClaimCodeUsed` on `AdmissionModel` is `[NotMapped]` and not actively read in the current handler.
- The two deprecated `Transfer` / `AdmittedPatientHistory` components are moved to `ADTSharedModule` so they can be reused by the Nursing module; they are no longer declared in `ADTModule`.
- `GetAllWardBedInfo` lives under the route `~/api/Admission/GetAllWardBedInfo` (with a `~` prefix), making it absolute-pathed.

### 10.4 Security & Audit

- Every write operation stamps `CreatedBy`/`CreatedOn` (and `ModifiedBy`/`ModifiedOn` where applicable).
- SMS notifications are sent via a background `Task.Run` after the admission transaction commits.
- Deposit operations always carry `IsTransferTransaction` or `ModuleName` for downstream reporting.
- `IsActive` flags are used on all transaction rows for soft-delete (e.g. cancelled discharge, cancelled reservation).

### 10.5 Future-Proofing Notes

- The `BIL_MAP_PriceCategoryServiceItem` join is the canonical source for bed pricing per price category; the legacy `BedFeature.BedPrice` is still on the model but is no longer the source of truth.
- `VisitSchemeChangeHistoryModel` (`VIS_LOG_VisitSchemeChangeHistory`) is the audit trail for any price-category change — populated when transfer changes the visit's price category.
- The discharge summary has a `DischargeSummaryTemplateId` field for future template-driven summaries.
- `VisitSchemeChangeHistoryModel.ChangeAction` is an enum (`ENUM_VisitSchemeChangeAction`) — currently only `SystemUpdate` is emitted (during transfer).

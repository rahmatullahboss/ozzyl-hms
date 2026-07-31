# Insurance Module

## 1. Module Overview

The DanpheEMR Insurance module manages three distinct insurance schemes used by the hospital:

1. **Government Insurance (Bima)** – the principal insurance scheme. A Government-funded health insurance programme for Nepalese citizens, identified by a National Social Health Insurance (NSHI) number. Members present a claim code at every visit; the hospital bills the insurer using an "INS" invoice code prefix and posts credit-bill transactions whose amounts are deducted from a running insurance balance held against the patient.
2. **Medicare** – a member/employer-based insurance scheme with per-member OP and IP credit limits. Each member has a `MedicareMemberBalance` record and on billing the credit amount is decremented accordingly. Members can have dependents.
3. **SSF (Social Security Fund)** – frontend shell only; backend routes do not currently exist in the reference.

The module is responsible for:

- Registering patients under a specific insurance scheme.
- Generating, validating and re-using claim codes that group all services provided during a single insurance visit.
- Maintaining a running insurance balance per patient and an audit history of every change.
- Creating OPD, IPD, follow-up and free follow-up visits tied to a claim code.
- Performing insurance billing (with `IsInsuranceBilling=true`, invoice code `INS`) and provisional billing for inpatients.
- Managing package pricing and validity for insurance patients.
- Patient discharge, deposit handling, and reporting (single-claim-code detail, daily muster, income segregation, etc.).

The Insurance module is tightly coupled with the **Patient**, **Billing**, **ADT** and **Accounting** modules.

---

## 2. Backend Files

| File | Purpose |
| --- | --- |
| `Controllers/Insurance/GovInsuranceController.cs` (~7,400 lines) | Main controller. Contains 60+ REST endpoints covering Govt-insurance patient, visit, billing, claim-code, IPD-billing, discharge, follow-up, balance update, and reporting. Has heavy inline business logic. |
| `Controllers/Insurance/GovInsuranceBL.cs` | Static business-logic helpers used by the controller and by other modules. Balance update, billing transaction post, fiscal year/provisional-receipt number, IRD sync, and helper methods (`HasDuplicateVisitWithSameProvider`, `CreateNewPatientVisitCode`, `GetProviderName`, `UpdatePatientInfoFromInsurance`, `IsValidForDischarge`). |
| `Controllers/Insurance/MedicareController.cs` | REST endpoints for the Medicare sub-module: lookup of members, member save/update, list of Medicare patients via stored procedure. |
| `Controllers/Insurance/DTOs/MedicarePatientsDTO.cs` | `MedicarePatientList_DTO` used to deserialize the `SP_INS_Medicare_GetMedicarePatientList` stored-proc result. |
| `Services/Medicare/IMedicareService.cs` | Service interface: `GetMedicarePatientDetails`, `SaveMedicareMemberDetails`, `UpdateMedicareMemberDetails`, `GetDepartments`, `GetDesignations`, `GetMedicareTypes`, `GetAllMedicareInstitutes`, `GetInsuranceProviders`, `GetMedicareMemberByMedicareNo`, `GetMedicareMemberByPatientId`, `GetDependentMedicareMemberByPatientId`. |
| `Services/Medicare/MedicareService.cs` | Implementation. Creates `MedicareMember`, seeds `MedicareMemberBalance` from the chosen `MedicareType` (OP/IP credit amounts), and creates a `SubLedger`, `LedgerMapping` (linked to `ENUM_ACC_LedgerType.MedicareTypes`) and `SubLedgerBalanceHistory` so every Medicare member becomes an accounting sub-ledger. |

### Key Methods on `GovInsuranceController`

| Group | Methods |
| --- | --- |
| Search & Lists | `GovInsurancePatients`, `AllRegisteredPatients`, `AdmittedPatients`, `PatientsVisits`, `PerformerWisePatientVisits`, `TodaysPatientVisit`, `PatientsByNshiNumber`, `PatientsByClaimCode`, `PatientClaimCodes`, `MatchingPatients` |
| Claim codes | `NewClaimCode`, `OldClaimCode`, `AdmissionOldClaimCode`, `LatestClaimCode`, `IsClaimCodeValid`, `PatientClaimDetail` |
| Billing items (price catalogue) | `DoctorNewOpdBillingItems`, `DepartmentNewOpdBillingItems`, `DoctorFollowupBillingItems`, `DepartmentFollowupBillingItems`, `DoctorOldPatientBillingItems`, `DepartmentOldPatientBillingItems`, `InsuranceApplicableBillCfgItems`, `BillCfgItems` |
| Doctor / department / employee lookups | `Doctors`, `AppointmentApplicableDoctors`, `AppointmentApplicableEmployees`, `ActiveEmployees`, `AppointmentApplicableDepartments`, `InsuranceProviders`, `CreditOrganizations` |
| Visit context / billing context | `PatientBillingContext`, `PatientCurrentVisitContext`, `InPatientDetailForPartialBilling`, `PatientPastBillSummary`, `PatientDeposits`, `PatientPendingItems`, `CheckCreditBill`, `VisitInfoForStickerPrint`, `DischargeReceipt`, `OpdTicketInvoiceInfo`, `PatientHealthCardWithBillInfo`, `PatientBalanceHitstory` |
| `POST` write operations | `NewPatient`, `CreateVisit`, `SaveHTMLFile`, `FreeFollowup`, `PaidFollowup`, `BillingTransactionItems`, `CreateBillingVisit`, `NewRequisitions` (Lab), `RequestItems` (Radiology), `PatientDeposit`, `Discharge`, `BillingTransaction`, `insurance-billing`, `insurance-provisional-billing` |
| `PUT` update operations | `Patient`, `AppointmentStatus`, `PrintCount`, `Procedure`, `EditItemPriceQtyDiscAndProvider`, `Discharge` (from billing), `CancelBillingTransactionItems`, `BillingTransactionItems`, `Balance` |
| `GET` Medicare list (stored proc) | `MedicarePatientList` (executes `SP_INS_Medicare_GetMedicarePatientList`) |

### Key Methods on `MedicareController`

- `GET MedicareMemberDetail?patientId=` → Medicare member with OP/IP balance.
- `GET MedicareMemberByPatientId?PatientId=`
- `GET MedicareMemberByMemberNo?medicareNo=`
- `GET DependentMedicareMember?patientId=`
- `GET Departments`, `GET Designations`, `GET MedicareTypes`, `GET MedicareInstitutes`, `GET InsuranceProviders`
- `POST MedicareMemberDetails` → creates a Medicare member (and accounting sub-ledger).
- `PUT MedicareMemberDetails` → updates an existing Medicare member.
- `GET MedicarePatientList` (via `SP_INS_Medicare_GetMedicarePatientList`).

### Key Static Helpers on `GovInsuranceBL`

| Method | Purpose |
| --- | --- |
| `UpdateInsuranceCurrentBalance(connString, patientId, insuranceProviderId, currentUserId, amount, isDeduct, remark)` | Decrements `Patient.Ins_InsuranceBalance` and `Insurance.Ins_InsuranceBalance`, writes a `InsuranceBalanceHistoryModel` row. |
| `SaveInsuranceBalanceAmountHistory(...)` | Inserts audit row in `InsuranceBalanceHistoryModel`. |
| `UpdateLatestClaimCode(connString, patientId, claimCode, currentUserId)` | Sets `Patient.Ins_LatestClaimCode`. |
| `GetGovInsNewClaimCode(DbContext)` | Calls `SP_INS_GetNewClaimCode` and returns `INS_NewClaimCodeDTO { NewClaimCode, IsMaxLimitReached }`. |
| `HasDuplicateVisitWithSameProvider(...)` | Used to prevent same-day duplicate visits with the same provider. |
| `CreateNewPatientVisitCode(visitType, connString)` | Produces visit codes (`V` outpatient, `H` inpatient, `ER` emergency) suffixed with `yy` + 5-digit sequence. |
| `GetProviderName(providerId, connString)` | Resolves employee full-name. |
| `UpdatePatientInfoFromInsurance(...)` | Updates patient fields (name, phone, address, NSHI, balance, etc.) from `GovInsurancePatientVM`. |
| `GetInsuranceModelFromInsPatVM(...)` | Builds `InsuranceModel` from the VM. |
| `PostBillingTransaction(...)` | Inserts `BillingTransaction` with invoice code `INS` (or `BL`), generates invoice number, audits, syncs to IRD. |
| `PostUpdateBillingTransactionItems(...)` | Inserts/updates `BillingTransactionItemModel` rows; updates linked requisition (`Lab/Radiology/Visit`) bill-status. |
| `UpdateRequisitionItemsBillStatus(...)` | Pushes the bill-status change into `LabRequisitions`, `RadiologyImagingRequisitions` or `Visit`. |
| `UpdateTxnItemBillStatus(...)`, `UpdateBillingTransactionItems(...)` | Update flows for items already present. |
| `GetFiscalYear(connString)`, `GetProvisionalReceiptNo(connString)`, `GetInvoiceNumber(connString, isInsuranceBIlling?)`, `GetDepositReceiptNo(connString)` | Numbering helpers. |
| `SyncBillToRemoteServer(billToPost, billType, dbContext)` | Asynchronously posts sale/sale-return bills to IRD Nepal. |
| `PostIRDLog(...)`, `GetInnerMostException(...)` | IRD audit logging. |
| `IsValidForDischarge(patientId, patientVisitId, insDbContext)` | Returns `true` if admission status is still `admitted` for the visit. |

---

## 3. Data Models

### 3.1 `InsuranceModel` (server: `PatientModels/InsuranceModel.cs`)
Maps to `PAT_Insurance` / `Insurances` DbSet on `InsuranceDbContext`.

| Field | Type | Notes |
| --- | --- | --- |
| `PatientInsuranceInfoId` | int (PK) | surrogate key |
| `PatientId` | int | FK to `PAT_Patient` |
| `InsuranceNumber` | string | generic insurance number |
| `InsuranceName` | string | display name |
| `CardNumber` | string | |
| `SubscriberFirstName`, `SubscriberLastName`, `SubscriberGender`, `SubscriberDOB`, `SubscriberIDCardNumber`, `SubscriberIDCardType` | string/DateTime | subscriber info |
| `IMISCode` | string | Insurance Management Information System code |
| `InitialBalance`, `CurrentBalance` | double | running balance |
| `InsuranceProviderId` | int | FK to `MST_InsuranceProvider` |
| `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` | audit | |
| `InsuranceProviderName` | string | `[NotMapped]`, joined in queries |
| `Patient` | navigation | |
| `Ins_HasInsurance` | bool? | also mirrored on `Patient` |
| `Ins_NshiNumber` | string | National Social Health Insurance number |
| `Ins_InsuranceBalance` | double? | current balance mirrored on `Patient` |
| `Ins_InsuranceProviderId` | int? | mirrored provider id |
| `Ins_IsFamilyHead` | bool? | |
| `Ins_FamilyHeadNshi` | string | |
| `Ins_FamilyHeadName` | string | |
| `Ins_IsFirstServicePoint` | bool? | first point of service flag |
| `PatientVisitId`, `AdmittingDoctorId` | int `[NotMapped]` | only used in view layer |

### 3.2 `InsuranceProviderModel` (server: `PatientModels/InsuranceProviderModel.cs`)
Maps to `MST_InsuranceProvider` / `InsuranceProviders`.

| Field | Type | Notes |
| --- | --- | --- |
| `InsuranceProviderId` | int (PK) | |
| `InsuranceProviderName` | string | e.g. `"Government Insurance"`, `"Medicare"` |
| `Description` | string | |
| `CreatedOn`, `CreatedBy`, `ModifiedBy` | audit | |
| `IsActive` | bool | |

### 3.3 `InsuranceBalanceHistoryModel` (server: `InsuranceModels/InsuranceBalanceHistoryModel.cs`)
Maps to `PAT_InsuranceBalanceHistory` / `InsuranceBalanceHistories`. One row per balance mutation.

| Field | Type | Notes |
| --- | --- | --- |
| `HistoryId` | int (PK) | |
| `PatientId` | int? | |
| `PreviousAmount` | decimal? | |
| `UpdatedAmount` | decimal? | |
| `Remark` | string | reason (e.g. "Used in invoice …") |
| `CreatedBy` | int? | |
| `CreatedOn` | DateTime? | |
| `InsuranceProviderId` | int? | `[NotMapped]` (joined at runtime) |

### 3.4 `PatientInsurancePackageTransactionModel` (server: `BillingModels/PatientInsurancePackageTransactionModel.cs`)
Maps to `BIL_PatientInsurancePackageTransaction` / `PatientInsurancePackageTransactions`. Tracks an active insurance package for a patient.

| Field | Type | Notes |
| --- | --- | --- |
| `PatientInsurancePackageId` | int (PK) | |
| `PackageId` | int | FK to `BIL_BillPackage` |
| `PatientId` | int | |
| `StartDate` | DateTime | |
| `EndDate` | DateTime? | |
| `IsCompleted` | bool | package validity |
| `IsActive` | bool | soft delete |
| `CreatedOn`, `ModifiedOn`, `CreatedBy`, `ModifiedBy` | audit | |

### 3.5 `MedicareMember` (server: `MedicareModels/MedicareMembers.cs`)
Maps to `Medicare_Members` / `MedicareMembers`.

| Field | Type | Notes |
| --- | --- | --- |
| `MedicareMemberId` | int (PK) | |
| `MedicareTypeId` | int | FK to `MedicareTypes` (defines credit limit) |
| `FullName` | string | |
| `MedicareInstituteCode` | string | |
| `MemberNo` | string | unique member number |
| `HospitalNo` | string | |
| `PatientId` | int | |
| `IsDependent` | bool | |
| `ParentMedicareMemberId` | int? | if dependent |
| `Relation` | string | |
| `MedicareStartDate` | DateTime | |
| `InsuranceProviderId` | int | |
| `InsurancePolicyNo` | string | |
| `DesignationId` | int | FK to employee role |
| `DepartmentId` | int | FK to department |
| `DateOfBirth` | DateTime | |
| `InActiveDate` | DateTime? | |
| `IsOpLimitExceeded` | bool | |
| `IsIpLimitExceeded` | bool | |
| `IsActive` | bool | |
| `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` | audit | |
| `Remarks` | string | |

### 3.6 `MedicareMemberBalance` (server: `MedicareModels/MedicareMemberBalance.cs`)
Maps to `Medicare_MemberBalance` / `MedicareMemberBalance`.

| Field | Type | Notes |
| --- | --- | --- |
| `MedicareMemberBalanceId` | int (PK) | |
| `MedicareMemberId` | int | FK to `MedicareMember` |
| `OpBalance` | decimal | credit allowance for OP |
| `IpBalance` | decimal | credit allowance for IP |
| `OpUsedAmount` | decimal | consumed |
| `IpUsedAmount` | decimal | consumed |
| `HospitalNo` | string | |
| `PatientId` | int | |
| `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` | audit | |

### 3.7 `MedicareTypes` (server: `MedicareModels/MedicareTypes.cs`)
Maps to `Medicare_Types` / `MedicareTypes`. Defines a credit-category.

| Field | Type | Notes |
| --- | --- | --- |
| `MedicareTypeId` | int (PK) | |
| `LedgerId` | int? | accounting ledger |
| `MedicareTypeName` | string | |
| `OpCreditAmount` | decimal | initial OP credit limit |
| `IpCreditAmount` | decimal | initial IP credit limit |
| `IsActive` | bool | |
| `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` | audit | |

### 3.8 `MedicareInstitutes` (server: `MedicareModels/MedicareInstitutes.cs`)
Maps to `Medicare_Institutes` / `MedicareInstitutes`.

| Field | Type | Notes |
| --- | --- | --- |
| `MedicareInstituteId` | int (PK) | |
| `MedicareInstituteCode` | string | |
| `InstituteName` | string | |
| `IsActive` | bool | |
| `CreatedOn`, `CreatedBy` | audit | |

### 3.9 `MedicarePatientList_DTO` (server: `Controllers/Insurance/DTOs/MedicarePatientsDTO.cs`)
A flat row used to deserialize the result-set of `SP_INS_Medicare_GetMedicarePatientList`. Fields mirror `MedicareMember` plus `MedicareTypeName` and `Category`.

### 3.10 `INS_NewClaimCodeDTO` (server: `InsuranceModels/INS_NewClaimCodeDTO.cs`)

| Field | Type | Notes |
| --- | --- | --- |
| `NewClaimCode` | Int64 | |
| `IsMaxLimitReached` | bool | if true, the range (min/max) in `CFGParameters` is exhausted |

### 3.11 `InsuranceBillingTransactionPostVM` (server: `PatientModels/InsuranceModel.cs`)
Payload sent to `POST /insurance-billing` and `POST /insurance-provisional-billing`.

| Field | Type | Notes |
| --- | --- | --- |
| `LabRequisition` | `List<LabRequisitionModel>` | lab items to be requisitioned in same txn |
| `ImagingItemRequisition` | `List<ImagingRequisitionModel>` | radiology items |
| `VisitItems` | `List<VisitModel>` | new OPD/ER visits to be created in same txn |
| `Txn` | `BillingTransactionModel` | the insurance invoice header + items |

### 3.12 `GovInsurancePatientVM` (referenced in `SaveGovInsurancePatient` / `CreateInsurancePatient`)
A view-model sent from the client during Govt-Insurance patient registration. Contains patient demographics + insurance attributes (NSHI, IMIS code, family-head details, initial balance, etc.). The `InsuranceModel` is built from this VM via `GovInsuranceBL.GetInsuranceModelFromInsPatVM` and the `PatientModel` is built via `GetPatientModelFromPatientVM`.

### 3.13 `MedicareMemberDto`
DTO sent to `POST/PUT /MedicareMemberDetails`. Mirrors `MedicareMember` plus the `LedgerId` of the accounting ledger to use.

### 3.14 Supporting ViewModels
- `MedicareMemberVsBalanceVM` (`ViewModel/Medicare/MedicareMemberVsBalanceVM.cs`) – view model used by `GET MedicareMemberDetail` to return member info + OP/IP balances.
- `GovInsurancePatientVM` – view model for new patient registration.
- `PatientBillingContextVM` – bundle of patient + current visit + insurance + provisional amount.
- `InsuranceVM`, `PatientInsurancePkgTxnVM` – used by `GetPatientBillingContext`.

---

## 4. Database Tables

The Insurance module touches the following EF `DbSet` names on `InsuranceDbContext` (and `MedicareDbContext` for Medicare). The likely SQL Server table names are listed; some are confirmed by the controller code (`Municipalities`, `Patients`, `CountrySubDivisions`, `Insurances`, `InsuranceProviders`, `Admissions`, `BillingDeposits`, `PatientBedInfos`, `Employee`, `Departments`, `BillItemPrice`, `ServiceDepartment`, `BillPriceCategoryServiceItems`, `Wards`, `Beds`, `BedFeatures`, `Visit`, `LabRequisitions`, `RadiologyImagingRequisitions`, `BillItemRequisitions`, `BillingTransactions`, `BillingTransactionItems`, `BillingFiscalYears`, `PatientInsurancePackageTransactions`, `BillingPackages`, `CFGParameters`, `IRDLog`, `Appointments`, `LabTests`, `LabVendors`, `RadiologyImagingTypes`, `RadiologyImagingItems`, `PATHealthCard`, `CreditOrganization`, `SubLedger`, `LedgerMapping`, `SubLedgerBalanceHistory`, `FiscalYears`, `Hospital`).

| Table (likely) | DbSet | Module | Key columns | Purpose |
| --- | --- | --- | --- | --- |
| `PAT_Insurance` | `Insurances` | Gov-Insurance | `PatientInsuranceInfoId` PK, `PatientId`, `IMISCode`, `InsuranceProviderId`, `CurrentBalance`, `Ins_NshiNumber`, `Ins_InsuranceBalance`, `Ins_IsFamilyHead`, `Ins_FamilyHeadNshi`, `Ins_FamilyHeadName`, `Ins_IsFirstServicePoint` | patient ↔ insurance mapping |
| `MST_InsuranceProvider` | `InsuranceProviders` | Insurance | `InsuranceProviderId` PK, `InsuranceProviderName` | e.g. "Government Insurance", "Medicare" |
| `PAT_InsuranceBalanceHistory` | `InsuranceBalanceHistories` | Gov-Insurance | `HistoryId` PK, `PatientId`, `PreviousAmount`, `UpdatedAmount`, `Remark`, `CreatedBy`, `CreatedOn` | immutable audit of every balance change |
| `BIL_PatientInsurancePackageTransaction` | `PatientInsurancePackageTransactions` | Insurance package | `PatientInsurancePackageId` PK, `PackageId`, `PatientId`, `StartDate`, `EndDate`, `IsCompleted`, `IsActive` | active package for an insured patient |
| `BIL_BillPackage` | `BillingPackages` | Billing | reused | price package definitions |
| `Medicare_Members` | `MedicareMembers` (on `MedicareDbContext`) | Medicare | `MedicareMemberId` PK, `MedicareTypeId`, `MemberNo`, `PatientId`, `IsDependent`, `ParentMedicareMemberId`, `InsuranceProviderId`, `DepartmentId`, `DesignationId`, `MedicareStartDate`, `InActiveDate`, `IsOpLimitExceeded`, `IsIpLimitExceeded` | one row per member (or dependent) |
| `Medicare_MemberBalance` | `MedicareMemberBalance` | Medicare | `MedicareMemberBalanceId` PK, `MedicareMemberId` FK, `OpBalance`, `IpBalance`, `OpUsedAmount`, `IpUsedAmount`, `PatientId` | OP/IP credit bucket per member |
| `Medicare_Types` | `MedicareTypes` | Medicare | `MedicareTypeId` PK, `MedicareTypeName`, `OpCreditAmount`, `IpCreditAmount`, `LedgerId`, `IsActive` | credit category with default allowances |
| `Medicare_Institutes` | `MedicareInstitutes` | Medicare | `MedicareInstituteId` PK, `MedicareInstituteCode`, `InstituteName`, `IsActive` | organisation lookup |
| `ACC_SubLedger` | `SubLedger` | Accounting | reused | one row per Medicare member (for accounting) |
| `ACC_LedgerMapping` | `LedgerMapping` | Accounting | reused | maps member → ledger (`LedgerType = ENUM_ACC_LedgerType.MedicareTypes`) |
| `ACC_SubLedgerBalanceHistory` | `SubLedgerBalanceHistory` | Accounting | reused | initial 0-balance ledger history row |
| `PAT_Patient` | `Patients` | Patient | reused; insurance fields added: `Ins_HasInsurance`, `Ins_NshiNumber`, `Ins_InsuranceBalance`, `Ins_LatestClaimCode` | insurance status mirrored on patient |
| `PAT_Visit` | `Visit` | Visit | reused; insurance fields: `Ins_HasInsurance`, `ClaimCode`, `IsInsuranceVisit` | every insurance OPD/IPD/ER visit is a `Visit` row with `ClaimCode` |
| `ADT_Admission` | `Admissions` | ADT | `IsInsurancePatient` flag, admitting doctor | insurance admissions |
| `BIL_TXN_BillingTransaction` | `BillingTransactions` | Billing | `IsInsuranceBilling`, `InsuranceProviderId`, `InvoiceCode = "INS"` for insurance | insurance invoice header |
| `BIL_TXN_BillingTransactionItems` | `BillingTransactionItems` | Billing | `IsInsurance = true` | line items of an insurance invoice |
| `BIL_Deposit` | `BillingDeposits` | Billing | reused | deposits, deductions, returns (mostly non-insurance; insurance uses credit) |
| `LAB_Requisition` | `LabRequisitions` | Lab | reused, `BillingStatus` is updated as part of insurance billing | |
| `RAD_ImagingRequisition` | `RadiologyImagingRequisitions` | Radiology | reused, `BillingStatus` updated | |
| `BIL_BillItemRequisition` | `BillItemRequisitions` | Billing | `BillStatus` | generic requisition join |
| `BIL_CFG_Parameters` | `CFGParameters` | Core | `ParameterGroupName = "Insurance"`, `ParameterName = "ClaimCodeAutoGenerateSettings"` (min/max range) | drives claim-code generation |
| `BIL_BillFiscalYear` | `BillingFiscalYears` | Billing | reused | fiscal year for invoice numbering |
| `MST_Employee` / `MST_Department` / `MST_CountrySubDivision` / `MST_ServiceDepartment` | reused | – | | |
| `MST_PatientHealthCard` | `PATHealthCard` | Patient | reused | health-card printing check |
| `MST_CreditOrganization` | `CreditOrganization` | Billing | reused | credit org list |
| `IRD_Log` | `IRDLog` | IRD sync | reused | logs IRD push attempts |
| `MST_Hospital` | `Hospital` | Core | reused | hospital info (for sub-ledger context) |
| `BIL_FiscalYear` | `FiscalYears` | Billing | reused | for sub-ledger balance history |

### Stored Procedures Used
- `SP_INS_SearchInsurancePatients(@SearchTxt, @RowCounts)` – full-text-ish search across insured patients.
- `SP_INS_GetNewClaimCode` – returns the next available claim code (respects the min/max range in `CFGParameters`).
- `SP_INS_GetVisitListOfValidDays(@SearchTxt, @RowCounts, @DaysLimit)` – recent insured visits within a date window.
- `SP_INS_GetPatientVisitStickerInfo(@PatientVisitId)` – patient/visit info for sticker print.
- `SP_INS_Medicare_GetMedicarePatientList` – flat list of Medicare members.
- `SP_INS_RPT_GetDetailsOfSingleClaimCode(@PatientId, @ClaimCode)` – multi-result-set report: `AdmissionInfo`, `BillingInfo`, `PharmacyInfo`.

---

## 5. Key Workflows

### 5.1 Govt-Insurance Patient Registration
- **Entry:** Receptionist uses the *Insurance → Patient* screen (`/gov-insurance/Patient` route).
- **Flow:**
  1. The client posts `GovInsurancePatientVM` to `POST /api/NewPatient`.
  2. Controller reads body, current user; calls `SaveGovInsurancePatient` → `CreateInsurancePatient`.
  3. `CreateInsurancePatient` builds `PatientModel` and `InsuranceModel`, adds to `InsuranceDbContext.Patients` (with `Insurances` navigation).
  4. On `DbUpdateException` with SQL error 2627 (unique-constraint violation) the function recurses – it regenerates `PatientCode` and tries again.
  5. The `InsuranceModel` is built with `Ins_NshiNumber`, `Ins_InsuranceBalance`, `Ins_InsuranceProviderId`, `IMISCode`, `InitialBalance`, `Ins_IsFamilyHead`, `Ins_FamilyHeadName`, `Ins_FamilyHeadNshi`, `Ins_IsFirstServicePoint`.
- **Update path:** `PUT /api/Patient` → `UpdateGovInsurancePat` → `UpdatePatientInfoFromInsurance` (updates patient demographics + insurance fields).

### 5.2 Medicare Member Registration
- **Entry:** Receptionist uses *Insurance → Medicare* module (`/medicare/registration`).
- **Flow:**
  1. Front-end collects Medicare member info (member no, hospital no, type, dependent flag, etc.) plus `LedgerId` of the accounting ledger to map.
  2. `POST /api/MedicareMemberDetails` → `SaveMedicareMemberDetails(MedicareDbContext, MedicareMemberDto, RbacUser)`.
  3. Persists `MedicareMember`. If `IsDependent == false`, also creates a `MedicareMemberBalance` whose `OpBalance`/`IpBalance` are copied from the chosen `MedicareType`.
  4. Creates an `ACC_SubLedger` (code = `MedicareTypeName-MemberNo` for principals, `MedicareTypeName-MemberNo(n)` for dependents).
  5. Creates `ACC_LedgerMapping` with `LedgerType = ENUM_ACC_LedgerType.MedicareTypes`.
  6. Creates initial `ACC_SubLedgerBalanceHistory` with zero opening/closing balance in the current fiscal year.
- **Lookup helpers:** `GET MedicareMemberByMemberNo` (used in autocomplete), `GET MedicareMemberByPatientId`, `GET DependentMedicareMember`.

### 5.3 Claim Code Generation & Re-use
- **Generate new:** `GET /api/NewClaimCode` → `GetNewGovInsClaimCode` → `SP_INS_GetNewClaimCode` → returns `INS_NewClaimCodeDTO { NewClaimCode, IsMaxLimitReached }`. The min/max range is read from `CFGParameters[Insurance][ClaimCodeAutoGenerateSettings]`.
- **Re-use last:** `GET /api/OldClaimCode?patientId=` → returns the most-recent claim code from `Visit` for the patient (ordered by `PatientVisitId`, excluding returned/cancelled visits).
- **Re-use for admission only:** `GET /api/AdmissionOldClaimCode?patientId=` → same logic but with a validity window (`CoreParameter "Insurance.FollowupValidDays"`); if the last claim code is older than that window, a new one must be generated.
- **Validate manual entry:** `GET /api/IsClaimCodeValid?claimCode=&patientId=` → `CheckIfClaimCodeValid` reads the min/max range from `CFGParameters` and counts any other patient using the same claim code (excluding returned/cancelled). Throws `"Claim code already used for other patient"` if the count is > 0.
- **Persist on visit:** `GovInsuranceBL.UpdateLatestClaimCode` is called when a claim code is attached to a visit; it sets `Patient.Ins_LatestClaimCode`.

### 5.4 Insurance Visit Creation
- `POST /api/CreateVisit` → `PatientVisitTransaction` deserialises the visit payload, creates one or more `Visit` rows, generates a `VisitCode` (`V`/`H`/`ER` prefix + `yy` + 5-digit seq via `GeneratePatientVisitCodeAndSave` and `CreateNewPatientVisitCode`), and persists.
- For IPD/OPD billing combined with visit: `POST /api/insurance-billing` (see 5.6).

### 5.5 Free / Paid Follow-up
- `POST /api/FreeFollowup` → `SaveInsFreeFollowupVisit` → reuses the existing `ClaimCode` (within `FollowupValidDays`).
- `POST /api/PaidFollowup` → `PaidFollowupVisitTransaction` → a new visit/bill is generated but claim code may be retained or new depending on rule.

### 5.6 Insurance Billing (IPD/OPD/ER)
- `POST /api/insurance-billing` → `PostInsuranceBilling`:
  1. Deserialises `InsuranceBillingTransactionPostVM` (lab, imaging, visit, txn).
  2. `AddLabRequisition` creates `LabRequisitionModel` rows in the same `InsuranceDbContext`; `AddImagingRequisition` for radiology; `AddVisitItems` (with auto-generated `VisitCode`) for new OPD/ER visits.
  3. Mapping helpers (`MapLabRequsitionId`, `MapRadiologyRequisitionId`, `MapPatientVisitId`) link the requisition id back into each `BillingTransactionItemModel`.
  4. `PostInsuranceBillingTransaction` → `GovInsuranceBL.PostBillingTransaction` (with `InvoiceCode = "INS"`).
  5. If `IsInsuranceBilling == true`, `UpdateInsuranceCurrentBalance` is called with `isDeduct = true` to debit the patient balance and write a `InsuranceBalanceHistoryModel` row.
  6. If `RealTimeRemoteSyncEnabled`, the bill is asynchronously pushed to the IRD via `SyncBillToRemoteServer`.
- `POST /api/insurance-provisional-billing` → does the same requisition + visit creation but only inserts provisional `BillingTransactionItemModel` rows; does not create a `BillingTransaction` header or affect the insurance balance.

### 5.7 Provisional IPD billing & Discharge
- `POST /api/Discharge` (insurance-discharge bill submission) and `PUT /api/Discharge` (update from billing) build on the same primitives.
- `IsValidForDischarge` is checked before any discharge update.
- `GetPatPendingItems` recalculates bed-charge quantity from `AdmissionDate` to `now`.
- `GetAdditionalInfoDischargeReceipt` returns the patient, admission, billing-txn and any deposit info for printing the discharge receipt.

### 5.8 Insurance Balance Update (manual)
- `PUT /api/Balance` → `UpdateInsuranceBalance` → `GovInsuranceBL.UpdateInsuranceCurrentBalance(connString, patientId, insuranceProviderId, currentUserId, amount, isDeduct=false, remark=...)`:
  1. Loads `Insurance` by `(PatientId, InsuranceProviderId)`.
  2. Reads previous balance, sets new value (`amount` if not deduct, `current-amount` if deduct) on both `Patient.Ins_InsuranceBalance` and `Insurance.Ins_InsuranceBalance`.
  3. Persists changes.
  4. Writes a row to `InsuranceBalanceHistoryModel` with `(previous, updated, remark, currentUserId, now)`.

### 5.9 Patient Past Bill Summary
- `GET /api/PatientPastBillSummary?InputId=` → returns a single object containing: `PaidAmount`, `DiscountAmount`, `CancelAmount`, `ReturnedAmount`, `CreditAmount`, `ProvisionalAmt`, `TotalDue`, `DepositBalance`, `BalanceAmount`. Computed by grouping `BillingDeposits` and `BillingTransactionItems` (non-insurance) for the patient.

### 5.10 Package Pricing (Insurance package)
- A patient may have an active `PatientInsurancePackageTransactionModel` (`IsCompleted=false`, `IsActive=true`).
- `GetPatientBillingContext` joins `PatientInsurancePackageTransactions` ↔ `BillingPackages` and exposes the current package to the client. Only one active package per patient is expected.
- On completion, the application can flip `IsCompleted=true`; the contract is not explicitly defined by the controller but the data model supports it.

### 5.11 Reports
- `GET /api/PatientClaimDetail?patientId=&claimCode=` → `SP_INS_RPT_GetDetailsOfSingleClaimCode` returns a 3-table DataSet (`AdmissionInfo`, `BillingInfo`, `PharmacyInfo`). Front-end renders each.
- The Angular front-end has additional reports (income segregation, patient-wise claims, total items bill) under `ins-reports/gov-*` but those use shared/common endpoints.

---

## 6. API Endpoints

All endpoints are exposed by `GovInsuranceController` unless suffixed **(Medicare)** which means `MedicareController`. The base route is the controller's default (`/api/...`).

| Verb | Route | Method | Purpose |
| --- | --- | --- | --- |
| GET | `GovInsurancePatients?searchText=` | `GovInsurancePatients` | insured-patient search via `SP_INS_SearchInsurancePatients` |
| GET | `AdmittedPatients` | `AdmittedPatients` | list admitted insurance inpatients (with bed & deposit info) |
| GET | `AllRegisteredPatients?searchText=` | `AllRegisteredPatients` | all active registered patients (left-joins insurance info) |
| GET | `NewClaimCode` | `GetNewGovInsClaimCode` | next claim code (calls `SP_INS_GetNewClaimCode`) |
| GET | `OldClaimCode?patientId=` | `GetPatientOldClaimCode` | most-recent valid claim code for patient |
| GET | `AdmissionOldClaimCode?patientId=` | `GetOldClaimCodeForAdmissionOnly` | most-recent claim code within follow-up validity window |
| GET | `LatestClaimCode?patientId=` | `GetLatestVisitClaimCodesome` | latest visit claim code for the patient |
| GET | `IsClaimCodeValid?claimCode=&patientId=` | `CheckIfClaimCodeValid` | validate manual claim-code entry |
| GET | `DoctorNewOpdBillingItems` | `GetDoctorNewOpdBillingItems` | catalogue of OPD items keyed by doctor |
| GET | `DepartmentNewOpdBillingItems` | `GetDepartmentNewOpdBillingItems` | OPD items keyed by department |
| GET | `DoctorFollowupBillingItems` | `GetDoctorFollowupBillingItems` | doctor follow-up items |
| GET | `DepartmentFollowupBillingItems` | `GetDepartmentFollowupBillingItems` | department follow-up items |
| GET | `DepartmentOldPatientBillingItems` | `GetDepartmentOldPatientBillingItems` | dept OPD old-patient items |
| GET | `DoctorOldPatientBillingItems` | `GetDoctorOldPatientBillingItems` | doctor OPD old-patient items |
| GET | `BillCfgItems` | inline | full billable-item list with display sequence, dept, doctor (for billing screen) |
| GET | `InsuranceApplicableBillCfgItems` | inline | active bill items joined to `BillPriceCategoryServiceItems` (price category 1) |
| GET | `Doctors` | inline | active, appointment-applicable doctors |
| GET | `AppointmentApplicableDepartments` | inline | departments where appointments are allowed |
| GET | `AppointmentApplicableDoctors` | `DoctorLists` | full employee list for appointments |
| GET | `ActiveEmployees` | inline | active non-external employees with department/role/type |
| GET | `InsuranceProviders` | inline | list of insurance providers (id + name) |
| GET | `CreditOrganizations?patientId=` | inline | active credit organizations |
| GET | `PatientHealthCardWithBillInfo?patientId=` | `GetPatientHealthCardWithBillInfo` | health-card status (printed + billed) |
| GET | `OpdTicketInvoiceInfo?patientId=&patientVisitId=` | `GetOpdTicketInvoiceInfo` | OPD-ticket invoice + items for a visit |
| GET | `MatchingPatients?firstName=&lastName=&phoneNumber=&age=&gender=` | inline | duplicate-patient detection by name/dob/gender/phone |
| GET | `PatientsByNshiNumber?nshiNumber=` | inline | patients with given NSHI number |
| GET | `PatientBillingContext?patientId=` | `GetPatientBillingContext` | full billing context (admission status + insurance + active package + provisional amount) |
| GET | `PatientCurrentVisitContext?patientId=&visitId=` | `GetPatientCurrentVisitContext` | current ward/bed/visit context |
| GET | `PerformerWisePatientVisits?patientId=` | `GetPatientVisitProviderWise` | visits grouped by doctor |
| GET | `PatientDeposits?patientId=` | inline | deposit in/out totals per transaction type |
| GET | `PatientPastBillSummary?InputId=` | `GetPatientPastBillSummary` | paid/credit/provisional/deposit summary |
| GET | `AppointmentApplicableEmployees` | `GetProviderLists` (cache) | appointment-applicable employees (from master cache) |
| GET | `PatientPendingItems?patientId=&ipVisitId=` | `GetPatPendingItems` | provisional items + bed quantity recalculation + admission info |
| GET | `CheckCreditBill?patientId=` | `GetCheckCreditBill` | whether patient has an unpaid credit bill |
| GET | `DischargeReceipt?ipVisitId=&billingTxnId=` | `GetAdditionalInfoDischargeReceipt` | data for discharge receipt print |
| GET | `PatientBalanceHitstory?patientId=` | inline | `InsuranceBalanceHistory` rows joined to patient/insurance/employee |
| GET | `PatientClaimCodes?patientId=` | inline | distinct claim codes for the patient with first-generated date |
| GET | `PatientClaimDetail?patientId=&claimCode=` | `GetInsuranceSingleClaimCodeDetails` | 3-table report (uses `SP_INS_RPT_GetDetailsOfSingleClaimCode`) |
| GET | `PatientsByClaimCode?claimCode=` | inline | patients (and demographics) for a given claim code |
| GET | `PatientsVisits?dayslimit=&search=` | `GetInsPatientVisitList` | insured visits within `dayslimit` (uses `SP_INS_GetVisitListOfValidDays`) |
| GET | `VisitInfoForStickerPrint?visitID=` | `GetVisitInfoforStickerPrint` | visit data for sticker (uses `SP_INS_GetPatientVisitStickerInfo`) |
| GET | `InPatientDetailForPartialBilling?patVisitId=` | `GetInPatientDetailForPartialBilling` | minimal inpatient header for partial billing |
| GET | `TodaysPatientVisit?patientId=` | `GetPatientVisitHistoryToday` | today's insured visits |
| POST | `NewPatient` | `SaveGovInsurancePatient` | register a new govt-insurance patient |
| POST | `CreateVisit` | `PatientVisitTransaction` | create a visit |
| POST | `SaveHTMLFile?PrinterName=&FilePath=` | `PostHtmlFile` | write HTML receipt to disk for printing |
| POST | `FreeFollowup` | `SaveInsFreeFollowupVisit` | free follow-up (re-uses claim code) |
| POST | `PaidFollowup` | `PaidFollowupVisitTransaction` | paid follow-up visit |
| POST | `BillingTransactionItems` | `SaveBillingTransactionItems` | post bill txn items |
| POST | `CreateBillingVisit` | `SaveBillingVisits` | create a billing visit |
| POST | `Lab/Requisition` | `SaveNewRequisitions` | new lab requisitions |
| POST | `Radiology/Requisition` | `SaveRequestItems` | new radiology requisitions |
| POST | `PatientDeposit` | `SaveDeposit` | patient deposit |
| POST | `Discharge` | `SaveInsDischargeBill` | submit insurance discharge bill |
| POST | `BillingTransaction` | `SaveBillingTransaction` | save billing txn header |
| POST | `insurance-billing` | `PostInsuranceBilling` | full insurance invoice with optional lab/imaging/visit creation |
| POST | `insurance-provisional-billing` | `PostInsuranceProvisionalBilling` | provisional items only (no invoice header, no balance debit) |
| PUT | `Patient` | `UpdateGovInsurancePat` | update patient demographics + insurance fields |
| PUT | `AppointmentStatus?appointmentId=&status=` | `updateAppStatus` | update appointment status |
| PUT | `PrintCount?PrintCount=&billingTransactionId=` | `UpdatePrintCountafterPrint` | increment print-count after receipt print |
| PUT | `Procedure?AdmissionPatientId=&ProcedureType=` | `UpdateProcedure` | update admission procedure type |
| PUT | `EditItemPriceQtyDiscAndProvider` | `UpdateItemPriceQtyDiscProvider` | edit an item's price/qty/discount/provider |
| PUT | `Discharge` | `UpdateDischargeFromBilling` | update discharge from billing screen |
| PUT | `CancelBillingTransactionItems` | `UpdateCancelBillTxnItems` | cancel multiple items (used in provisional cancel) |
| PUT | `BillingTransactionItems` | `UpdateBillTxnItems` | update bill txn item |
| PUT | `Balance` | `UpdateInsuranceBalance` | manual balance update (with audit) |
| GET **(Medicare)** | `MedicareMemberDetail?patientId=` | `GetMedicarePatientDetails` | Medicare member + OP/IP balance |
| GET **(Medicare)** | `Departments` | `GetDepartments` | active departments |
| GET **(Medicare)** | `Designations` | `GetDesignations` | active employee roles |
| GET **(Medicare)** | `MedicareTypes` | `GetMedicareTypes` | Medicare types (with credit limits) |
| GET **(Medicare)** | `MedicareInstitutes` | `GetAllMedicareInstitutes` | active Medicare institutes |
| GET **(Medicare)** | `InsuranceProviders` | `GetInsuranceProviders` | active insurance providers |
| GET **(Medicare)** | `MedicareMemberByPatientId?PatientId=` | `GetMedicareMemberByPatientId` | principal Medicare member for patient |
| GET **(Medicare)** | `MedicareMemberByMemberNo?medicareNo=` | `GetMedicareMemberByMedicareNo` | principal member by member no |
| GET **(Medicare)** | `DependentMedicareMember?patientId=` | `GetDependentMedicareMemberByPatientId` | dependent + parent info |
| GET **(Medicare)** | `MedicarePatientList` | `GetMedicarePatientList` | flat list from `SP_INS_Medicare_GetMedicarePatientList` |
| POST **(Medicare)** | `MedicareMemberDetails` | `SaveMedicareMemberDetails` | register a Medicare member (and accounting sub-ledger) |
| PUT **(Medicare)** | `MedicareMemberDetails` | `UpdateMedicareMemberDetails` | update an existing Medicare member (and re-sync balance if type changed) |

---

## 7. Cross-Module Interactions

- **Patient (`Patients`, `CountrySubDivisions`, `Municipalities`, `PATHealthCard`)**
  - Insurance patient registration extends `PatientModel` with `Ins_HasInsurance`, `Ins_NshiNumber`, `Ins_InsuranceBalance`, `Ins_LatestClaimCode`, and a 1-to-many `Insurances` navigation.
  - `AllRegisteredPatients` left-joins `Insurance` so a registered patient is returned even if not yet insured.
  - `MatchingPatients` uses patient fields only (name/dob/gender/phone) to find duplicates.
  - `GetPatientBillingContext`, `GetPatientCurrentVisitContext`, `GetPatientVisitProviderWise` all start from the patient.

- **Visit (`Visit`)**
  - Every insurance OPD/IPD/ER service is a `Visit` row. `Ins_HasInsurance = true` and `ClaimCode` are the two insurance-specific columns.
  - Follow-up validity logic lives in `OldClaimCode` and `AdmissionOldClaimCode` and uses `FollowupValidDays` from core parameters.
  - `PatientClaimCodes` groups by `(PatientId, ClaimCode)` and returns first-generated date.

- **ADT (`Admissions`, `PatientBedInfos`, `Beds`, `Wards`, `BedFeatures`)**
  - `AdmittedPatients` joins `Admissions` (status = `admitted`, `IsInsurancePatient = true`) with `Insurances`, `BillingDeposits`, `PatientBedInfos`, `Employee`, `Wards`, `Beds`.
  - `GetPatPendingItems` reads the current `PatientBedInfo` to compute bed-charge quantity (using `AdmissionDate` time-of-day and the current `BedFeatureId`).
  - `IsValidForDischarge` is the gate for insurance discharge.

- **Billing (`BillingTransactions`, `BillingTransactionItems`, `BillingDeposits`, `BillingFiscalYears`, `BillItemPrice`, `ServiceDepartment`, `BillPriceCategoryServiceItems`, `BillItemRequisitions`)**
  - Insurance invoices are `BillingTransaction` rows with `InvoiceCode = "INS"`, `IsInsuranceBilling = true`, `InsuranceProviderId` set.
  - `BillingTransactionItemModel` rows for insurance have `IsInsurance = true`.
  - `PostUpdateBillingTransactionItems` pushes `BillStatus` into the related `LabRequisitions`, `RadiologyImagingRequisitions` or `Visit` row via `UpdateRequisitionItemsBillStatus`.
  - `PostBillingTransaction` generates a fiscal-year-scoped invoice number via `GetInvoiceNumber(connString)` (returns `invoiceNo + 1` for the current fiscal year).
  - `GetProvisionalReceiptNo` and `GetDepositReceiptNo` are the numbering helpers for provisional items and deposit receipts.
  - `SyncBillToRemoteServer` posts sales / sales-return bills to the IRD Nepal system (asynchronous, behind `RealTimeRemoteSyncEnabled` config).

- **Lab / Radiology (`LabRequisitions`, `LabTests`, `LabVendors`, `RadiologyImagingRequisitions`, `RadiologyImagingTypes`, `RadiologyImagingItems`)**
  - `AddLabRequisition` and `AddImagingRequisition` create the requisition rows in the same transaction as the insurance billing.
  - Requisitions are linked back to invoice line items via `MapLabRequsitionId` / `MapRadiologyRequisitionId`.

- **Package pricing (`BillingPackages`, `PatientInsurancePackageTransactions`)**
  - `GetPatientBillingContext` returns the active (not completed) package to the client.
  - Packages can be used to bundle services and gate eligibility; the controller exposes the data but the client decides when to attach/detach a package.

- **Accounting (`SubLedger`, `LedgerMapping`, `SubLedgerBalanceHistory`, `Hospital`, `FiscalYears`)**
  - `SaveMedicareMemberDetails` creates a `SubLedger` per Medicare member (named `MedicareTypeName-MemberNo` or `MedicareTypeName-MemberNo(n)` for dependents) and binds it to the chosen `Ledger` via `LedgerMapping(LedgerType = ENUM_ACC_LedgerType.MedicareTypes)`.
  - Initial `SubLedgerBalanceHistory` row with opening/closing balance = 0 is written.
  - On `UpdateMedicareMemberDetails`, if `MedicareTypeId` changes, the OP/IP credit amounts on the balance are refreshed from the new type.

- **Master data (`Employee`, `Departments`, `ServiceDepartment`, `CountrySubDivisions`, `Municipalities`, `BillItemPrice`, `CreditOrganization`, `InsuranceProvider`)**
  - Used in the various lookups (`ActiveEmployees`, `AppointmentApplicableDepartments`, `BillCfgItems`, `CreditOrganizations`, `InsuranceProviders`).

- **Core (`Parameters`, `CFGParameters`)**
  - `CFGParameters[Insurance][ClaimCodeAutoGenerateSettings]` (JSON `min`/`max`) drives claim-code generation and validation.
  - `CoreParameter[Insurance][FollowupValidDays]` drives the admission-only claim-code re-use logic.

- **IRD Nepal (`IRDLog`)**
  - Asynchronous IRD push with audit log entry per attempt.

---

## 8. Key Business Rules

1. **Claim code ranges are configured**, not hard-coded. The min/max values live in `CFGParameters[Insurance][ClaimCodeAutoGenerateSettings]` as JSON. `GetNewClaimCode` calls `SP_INS_GetNewClaimCode`; the stored proc returns `IsMaxLimitReached = true` when no codes remain, and the controller throws.
2. **Claim code is per visit, not per patient.** A patient can have multiple visit rows (OPD, IPD, ER) all sharing the same claim code during one insurance episode. A new claim code is required when the old one is older than `FollowupValidDays` (admission) or after the visit is closed (OPD).
3. **Manual claim-code entry is validated** for both range (min/max) and uniqueness across other patients. Same-patient re-use is allowed (per the commented logic for `existingClaimCode-VisitList`).
4. **Visit code generation** uses prefix `V` (outpatient), `H` (inpatient), `ER` (emergency) + `yy` + 5-digit running counter. On `DbUpdateException` 2627 the controller recurses to re-generate.
5. **Insurance invoice number** is per fiscal year and per `IsInsuranceBilling` flag. `GetInvoiceNumber(connString, isInsuranceBIlling)` returns `max + 1` of invoice numbers for the current fiscal year where the flag matches.
6. **Invoice code is `INS`** for insurance bills and `BL` for normal bills; `IsInsuranceBilling = true` on the header drives the prefix.
7. **Provisional billing** (for IPD) inserts `BillingTransactionItemModel` rows with `BillStatus = "provisional"`, gets a per-fiscal-year `ProvisionalReceiptNo` from `GetProvisionalReceiptNo`, and **does not debit the insurance balance**. Conversion to a final invoice happens through `PostInsuranceBilling` (which then does the balance update).
8. **Insurance balance** is mirrored on both `Patient.Ins_InsuranceBalance` and `Insurance.Ins_InsuranceBalance`. Every change writes a `InsuranceBalanceHistoryModel` row (previous → updated, with remark and current user).
9. **Balance update** is single-direction per call (`isDeduct` parameter). Setting `isDeduct = true` subtracts the amount; setting `false` overwrites the balance with the supplied value.
10. **Duplicate patient prevention** at registration: `CreateInsurancePatient` retries on unique-constraint violation (SQL 2627) by regenerating the `PatientCode`. NSHI duplicate check exists for updates (in commented logic).
11. **Duplicate visit prevention** within the same day: `HasDuplicateVisitWithSameProvider` returns `true` if the patient already has a same-day, same-provider visit that is not `returned`. Department-level appointments (no provider) bypass this check.
12. **OPD ticket info** for a visit: the OPD billing transaction is found by joining `BillingTransactionItems` ↔ `ServiceDepartment.IntegrationName = "OPD"` and using the `PatientVisitId` as `RequisitionId`.
13. **Bed-charge auto-increment** in `GetPatPendingItems` compares the current `DateTime.Now` to `AdmissionDate + todays-date` and increments quantity for the active bed feature.
14. **Discharge validity**: patient must be in `admitted` status. `IsValidForDischarge` checks the `Admission` row.
15. **Deposit balance** is only tracked for non-insurance items in `GetPatientPastBillSummary`. Insurance uses credit instead.
16. **Free follow-up** within `FollowupValidDays` re-uses the claim code; outside that, a new claim code is required.
17. **Medicare credit limits** are seeded from `MedicareTypes` on member creation. Updating a member's type triggers a refresh of `OpBalance`/`IpBalance` on `MedicareMemberBalance` (only for principals, not dependents).
18. **Dependents share the parent's balance**: `GetMedicarePatientDetails` returns the **parent's** `MedicareMemberBalance` to dependents (`ParentMedicareMemberId`), and the dependent's own `IsOpLimitExceeded`/`IsIpLimitExceeded` flags track over-usage.
19. **Sub-ledger per Medicare member**: each principal gets a sub-ledger named `MedicareTypeName-MemberNo`; each dependent gets `MedicareTypeName-MemberNo(n)` where `n` is the dependent count for that parent. The sub-ledger is required because Medicare payments are routed through accounting.
20. **Real-time IRD sync** is gated by `RealTimeRemoteSyncEnabled` config. When enabled, every insurance invoice is asynchronously posted to the IRD after the database transaction commits. Failures are recorded in `IRDLog` but do not roll back the local transaction.
21. **Patient demographics update from insurance** via `UpdatePatientInfoFromInsurance` updates FirstName, MiddleName, LastName, Gender, Age, PhoneNumber, Address, NSHI, balance, etc. Audit is done via `IsModified` flags on the EF change tracker.
22. **Cancellation/return of bill items** is supported via `PUT CancelBillingTransactionItems` and `UpdateTxnItemBillStatus`, which also push the new status to the linked requisition.
23. **Invoice number retry** on unique-constraint violation: `GenerateInvoiceNoAndSaveInvoice` recursively retries if SQL 2627 is raised.
24. **Claim code re-use on `OldClaimCode`** excludes visits with `BillingStatus = returned` or `BillingStatus = cancel`.
25. **PatientPastBillSummary** includes only non-insurance (`IsInsurance = false` or `null`) bill items for deposit/credit/provisional calculations.
26. **PatientBalanceHitstory** only includes patients where `pat.Ins_HasInsurance = true` is in scope, and the result is ordered by `CreatedOn` desc.
27. **Multiple insurance providers per patient** is technically supported (one `Insurance` row per `(PatientId, InsuranceProviderId)`), but the module currently targets a single `Government Insurance` provider per patient (see `GetPatientBillingContext`'s `InsuranceProviderName == "Government Insurance"` filter).
28. **Modules with `IsInsurance` flag**: OPD, Lab, Radiology, Pharmacy, IPD billing items all carry an `IsInsurance` flag so reports can isolate insurance spend.
29. **Package validity**: `IsCompleted = false` indicates an active insurance package. `IsActive = false` indicates soft-deleted. `EndDate` is optional and may represent expiry.
30. **Print-count** is incremented on the `BillingTransaction` row after the receipt is printed (`UpdatePrintCountafterPrint`).

---

## Appendix A: Front-end Structure (Angular)

```
wwwroot/DanpheApp/src/app/insurance/
├── insurance-shared.module.ts
├── medicare/                          # Medicare sub-module
│   ├── registration/
│   │   ├── member/                    # principal member form
│   │   └── dependent/                 # dependent form
│   ├── shared/
│   │   ├── medicare-member.model.ts
│   │   ├── mecicare-patient.model.ts
│   │   ├── medicare.bl.service.ts
│   │   ├── medicare.dl.service.ts
│   │   └── dto/                       # request/response DTOs
│   └── service/                       # shared medicare services
├── nep-gov/                           # Government Insurance (main UI)
│   ├── gov-insurance-main.component.{ts,html,css}
│   ├── gov-insurance.module.ts
│   ├── gov-insurance-routing.module.ts
│   ├── ins-billing-request/           # OPD/ER billing request screen
│   ├── ins-ipd-billing/               # IPD billing patient list + bill request
│   │   ├── ins-edit-item/
│   │   ├── ins-ip-bill-request/
│   │   ├── ins-ip-patient/
│   │   ├── ins-update-item-price/
│   │   └── receipt/
│   ├── ins-patient/                   # Insurance patient list + balance + price history
│   │   ├── ins-patient-registration/
│   │   ├── ins-price-history/
│   │   ├── gov-ins-patient-list.component.{ts,html}
│   │   └── gov-ins-update-balance.component.{ts,html}
│   ├── ins-reports/                   # Reports (income segregation, claim details, …)
│   │   ├── gov-income-segregation/
│   │   ├── gov-patient-wise-claims/
│   │   └── gov-total-items-bill/
│   └── ins-visit/                     # Insurance visit list + new visit + follow-up
│       ├── ins-new-visit/             # new visit (patient, billing, info)
│       └── follow-up/
└── ssf/                               # Social Security Fund (frontend shell only)
    └── shared/
        ├── SSF-Models.ts
        └── ssf-patient-detail.dto.ts
```

### Route Map (`gov-insurance-routing.module.ts`)

| Path | Component | Guards |
| --- | --- | --- |
| `''` | redirect to `Patient` | AuthGuard |
| `Patient` | `GovINSPatientListComponent` | AuthGuard, ActivateBillingCounter |
| `Visit` | `GovINSVisitListComponent` | AuthGuard, ActivateBillingCounter |
| `IPDBilling` | `GovINSIPDBillingComponent` | AuthGuard (ResetPatientcontext on leave) |
| `Reports` | lazy-loads `InsuranceReportsModule` | AuthGuard |
| `InsNewVisit` | `GovInsuranceVisitMainComponent` | – |
| `BillingRequest` | `GovInsBillingRequestComponent` | ResetPatientcontext (on leave) |

---

## Appendix B: Invoice Numbering & Fiscal Year

- `GetInvoiceNumber(connString)` → `GetInvoiceNumber(connString, isInsuranceBIlling)`: fiscal-year-scoped sequential numbering. For insurance the `IsInsuranceBilling` flag is used in the `where` filter to keep the sequence independent.
- `GetProvisionalReceiptNo(connString)`: per-fiscal-year sequential `ProvisionalReceiptNo`.
- `GetDepositReceiptNo(connString)`: per-fiscal-year sequential deposit receipt number.
- `GetFiscalYear(connString)`: reads the fiscal year (`BillingFiscalYears`) where `StartYear ≤ today ≤ EndYear`.

---

## Appendix C: Configuration & Parameters

| Parameter | Path | Purpose |
| --- | --- | --- |
| Claim-code range | `CFGParameters[Insurance][ClaimCodeAutoGenerateSettings]` (JSON `{min, max}`) | Drives claim-code generation/validation |
| Follow-up validity days | `CoreParameter[Insurance][FollowupValidDays]` | Days within which a claim code can be re-used for admission |
| Real-time IRD sync | `MyConfiguration.RealTimeRemoteSyncEnabled` | Enables async IRD push of insurance bills |
| IRD endpoints | `appSettings`: `url_IRDNepal`, `api_SalesIRDNepal`, `api_SalesReturnIRDNepal` | Remote IRD sync targets |
| Hard-coded price category id | `BillPriceCategoryServiceItems.PriceCategoryId == 1` | Normal price (Krishna, 13-Mar-2023, hard-coded) |

---

## Appendix D: Known Limitations / TODOs Visible in Source

- `GetDoctorNewOpdBillingItems` and similar join `BillItemPrice.IntegrationItemId` to `Employee.EmployeeId`; this assumes one-to-one and may misbehave for departments.
- `GetPatientBillingContext` filters `InsuranceProviderName == "Government Insurance"` literally; other providers (Medicare/SSF) are not handled here.
- `CreateInsurancePatient` does not validate NSHI uniqueness on insert (only on update, in commented logic).
- `IsInsurance` flag on `BillingTransactionItems` is set by callers; the controller does not enforce it.
- `GetPatientPastBillSummary` filters out `IsInsurance = true` items, meaning insurance patients see no past-bill summary on this endpoint.
- SSF (Social Security Fund) has no backend code in the reference; it is currently a UI-only module.
- `PrintCount` is stored on `BillingTransaction` but no version field is incremented; concurrency is not handled.
- `GetInsPatientVisitList` returns a `DataTable` rather than a strongly-typed list.
- `CheckIfClaimCodeValid` is marked as needing revision (per inline comment by `sud:23Jan'23`).

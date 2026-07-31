# Medical Records (MR) Module

## 1. Module Overview

The Medical Records (MR) module is the post-discharge clinical documentation and government-reporting layer of the hospital. It captures the formal Medical Record (MR) summary for every admitted patient (discharge-type, condition, delivery, operation, gravida, blood-loss, referred status, ICD-10 diagnosis, lab/radiology tests pulled in from LAB and RAD modules), prints official Birth and Death certificates, records Final Diagnoses for outpatient and emergency visits, and generates the regulatory reports that government health authorities require (inpatient outcome, morbidity, mortality, lab services, ethnic-group statistics).

In the .NET/SQL Server reference implementation the module is exposed through:

- **1 controller**: `MedicalRecordsController.cs` (2,857 lines, 35 endpoints, all clinical + admin + reporting).
- **1 EF `DbContext`**: `MedicalRecordsDbContext` — maps **25 tables** across `MR_*`, `ADT_*`, `MST_*`, `ICD_*`, `LAB_*`, `RAD_*`, `EMP_*`, `BIL_*`, `PAT_*`.
- **1 server-model folder** with 6 dedicated files plus 13 cross-module model references (DischargeType, DeathType, DischargeCondition, DeliveryType, ICD10, Country, Municipality, LabRequisition, ImagingRequisition, Employee, etc.).
- **6 stored procedures**: `SP_Report_OutPateint_Morbidity`, `SP_Report_EmergencyPatient_Morbidity`, `SP_MR_BirthList_FemalePatientsListWithVisitinformation`, `SP_MR_PatientsListWithVisitId`, `SP_MR_GetDischargedPatientInfo`, `SP_MR_EthnicGroupReport`.
- **Angular module** `MedicalRecordsModule` mounted at `/Medical-records/*` with 7 primary child routes and 10+ sub-routes under `ReportList`; 26 declared components.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Medical Record (MR_RecordSummary)** | The formal summary of a patient visit. One row per `PatientVisitId` once the patient is discharged. Carries discharge-type, condition, delivery-type, death-period, operation, gravida, blood-loss, referred-by/to, remarks, ICD-10 list, test list, file number, case-type. |
| **MR Status** | "Added" (green) or "Pending" (yellow) on the inpatient grid — driven by the presence of a `MedicalRecordId > 0` on a discharged patient. |
| **Discharge Type (ADT_DischargeType)** | Master list — e.g. "Cured", "LAMA", "Referred", "Death", "DOR". Each discharge type may own a child list of `DeathType` and `DischargeConditionType`. |
| **Discharge Condition (ADT_MST_DischargeConditionType)** | Mid-level categorization under a Discharge Type — e.g. "Recovered", "Delivered", "Expired". |
| **Delivery Type (ADT_MST_DeliveryType)** | Optional leaf under Discharge Condition — e.g. "Normal", "C/S", "Forceps", "Vacuum", "Breech". |
| **Death Type (ADT_MST_DeathType)** | Optional leaf under Discharge Type — when the discharge type is "Death" or similar. Captures death-period classification (within 48h, after 48h, brought dead, etc.). |
| **Operation Type (MR_MST_OperationType)** | Master list of surgical operations. Optionally linked to a Medical Record. |
| **Baby Birth Condition (ADT_MST_BabyBirthCondition)** | Master — e.g. "Live Birth", "Still Birth", "Premature". |
| **Gravita (ADT_MST_Gravita)** | Master — Gravida 1, 2, 3, ... used in obstetric MR summary. |
| **Baby Birth Details (ADT_BabyBirthDetails)** | One or more rows per mother. Captures BirthDate, BirthTime, Sex, WeightOfBaby, FathersName, CertificateNumber, BirthType, BirthNumberType (single/twin/multiple), IssuedBy, CertifiedBy, BirthConditionId, FiscalYearId, PrintCount. |
| **Death Details (ADT_DeathDeatils)** | One row per deceased patient. Captures DeathDate, DeathTime, CertificateNumber, FatherName, MotherName, SpouseOf, CauseOfDeath, CertifiedBy, PrintedBy, PrintCount, FiscalYearId, Age. |
| **Inpatient Diagnosis (MR_TXN_Inpatient_Diagnosis)** | Per-visit ICD-10 list. Each row carries `MedicalRecordId`, `PatientId`, `PatientVisitId`, `ICD10ID/Code/Name`, `IsActive`. |
| **Outpatient Final Diagnosis (MR_TXN_Outpatient_FinalDiagnosis)** | Per-visit ICD-10 list for OPD visits. Includes `IsPatientReferred` and `ReferredBy`. |
| **Emergency Final Diagnosis (MR_TXN_Emergency_FinalDiagnosis)** | Per-visit list for ER visits. Uses emergency-specific `EMER_DiseaseGroupId` from `ICD_Emergency_DiseaseGroup`. Carries `IsPatientReferred`, `ReferredBy`, `ReferredTo`. |
| **ICD10 Reporting Group (ICD_ReportingGroup)** | Top-level categorization of ICD-10 codes (e.g. "Infectious diseases", "Neoplasms"). |
| **ICD10 Disease Group (ICD_DiseaseGroup)** | Leaf disease group under a reporting group. Carries the actual `ICDCode`. |
| **MR File Number** | Human-assigned identifier (e.g. "MR/2024/0001") for the physical file folder. Enforced unique at MR save time. |
| **Certificate Number (Birth)** | Per-fiscal-year, monotonically increasing, unique across all birth certificates. |
| **Certificate Number (Death)** | Same concept, scoped to the death certificate. |
| **Referred Status** | Whether the patient was referred from another facility (`IsPatientReferred` + `ReferredBy` + `ReferredTo`). Captured at MR-add and at Final-Diagnosis time. |
| **Government Reports** | Regulatory reports generated by MR for submission to health ministries — Inpatient Outcome, Inpatient Morbidity, Outpatient Morbidity, Emergency Patient Morbidity, Hospital Mortality, Lab Services, Summary, Ethnic Group Statistics. |

### State Machines

**MR Add/Update** — strictly transactional (`Database.BeginTransaction`):

```
[Discharged Patient]
   │
   │ (1) AddPatientMedicalRecord  POST /api/MedicalRecords/PatientMedicalRecord
   │     - Inserts MR_RecordSummary
   │     - If ShowBirthCertDetail: inserts N rows into ADT_BabyBirthDetails (one per baby)
   │     - If ICDCodeList not empty: inserts N rows into MR_TXN_Inpatient_Diagnosis
   │     - If ShowDeathCertDetail: inserts 1 row into ADT_DeathDeatils
   │     - All in a single transaction; rolls back on any exception
   ▼
[MR Saved]  --  UpdatePatientMedicalRecord  PUT /api/MedicalRecords/MedicalRecord
                - Three-way diff: New / Unchanged / Removed diagnosis
                - New → insert; Removed → IsActive=false
                - BabyBirthDetails: BabyBirthDetailsId>0 → update, else → insert
                - DeathDetail: DeathId>0 → update, else → insert
                - If checkbox unchecked, existing child rows are soft-deleted
```

**Outpatient Final Diagnosis** — diff-and-merge against existing active rows for `(PatientId, PatientVisitId)`:

```
[POST /api/MedicalRecords/FinalDiagnosis]
   previousData = active rows for (PatientId, PatientVisitId)
   if IsPatientReferred/ReferredBy changed on first prev row:
       update each prev row's ReferredBy + IsPatientReferred
   OnlyNew  = finalDiagnosis - previousData
   Removed  = previousData - finalDiagnosis
   OnlyNew  → insert (CreatedBy, CreatedOn, IsActive=true)
   Removed  → set IsActive=false + propagate new ReferredBy/ReferredTo
   SaveChanges once at the end
```

**Birth Certificate Numbering** — auto-stamped at insert time:

```
GetFiscalYear(BirthDate) → FiscalYearId
   ↓
FiscalYearId stamped on BabyBirthDetails row
   (CertificateNumber is user-entered on the form, validated for uniqueness)
```

**Death Certificate Numbering** — auto-incremented on demand:

```
GET /api/MedicalRecords/LatestDeathCertificateNumber?fiscalYearId=0
   → MAX(CertificateNumber) WHERE FiscalYearId = current OR provided
   → +1
   (Client uses this to suggest the next available number to the user)
```

**Print Counter** — tracked per certificate:

```
[PUT /BirthCertificatePrintCount]   → PrintedBy, PrintCount+1, PrintedOn
[PUT /DeathCertificatePrintCount]   → PrintedBy, PrintCount+1, PrintedOn
[PUT /BirthCertificateDetail]       → updates IssuedBy, CertifiedBy, BirthType, FathersName, BirthNumberType, PrintCount
[PUT /DeathCertificateDetail]       → updates CertifiedBy, FatherName, MotherName, SpouseOf, CauseOfDeath, PrintCount
```

---

## 2. Backend Files

### Controllers

| File | Lines | Routes | Description |
|------|------:|-------:|-------------|
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/MedicalRecords/MedicalRecordsController.cs` | 2,857 | 35 | All MR endpoints: master data, MR details, birth/death lists + certs, outpatient & emergency final diagnosis, file number / certificate number lookups, ethnic group statistics, government-report SP wrappers. |

### Server Models (under `DanpheEMR.ServerModel.MedicalRecords` and `DanpheEMR.ServerModel`)

| File | Description |
|------|-------------|
| `MedicalRecordModel.cs` | `MR_RecordSummary` entity (the central MR document). |
| `FinalDiagnosisModel.cs` | `MR_TXN_Outpatient_FinalDiagnosis` entity. |
| `EMER_FinalDiagnosisModel.cs` | `MR_TXN_Emergency_FinalDiagnosis` entity. |
| `InpatientDiagnosisModel.cs` | `MR_TXN_Inpatient_Diagnosis` entity. |
| `OperationTypeModel.cs` | `MR_MST_OperationType` lookup. |
| `PatLabtestSummaryModel.cs` | `[NotMapped]` view model — joined lab + imaging tests selected for the MR. |

### Cross-Module Server Models (re-used by `MedicalRecordsDbContext`)

| Model | EF Table | Origin |
|-------|----------|--------|
| `DischargeTypeModel` | `ADT_DischargeType` | ADT |
| `DeathTypeModel` | `ADT_MST_DeathType` | ADT |
| `DischargeConditionTypeModel` | `ADT_MST_DischargeConditionType` | ADT |
| `DeliveryTypeModel` | `ADT_MST_DeliveryType` | ADT |
| `BabyBirthConditionModel` | `ADT_MST_BabyBirthCondition` | ADT |
| `BabyBirthDetailsModel` | `ADT_BabyBirthDetails` | ADT |
| `DeathDetailsModel` | `ADT_DeathDeatils` | ADT |
| `GravitaModel` | `ADT_MST_Gravita` | ADT |
| `PatientModel` | `PAT_Patient` | Patient |
| `VisitModel` | `PAT_PatientVisits` | Patient |
| `EmployeeModel` | `EMP_Employee` | Employee |
| `ICD10CodeModel` | `MST_ICD10` | Clinical |
| `ICD10ReportingGroupModel` | `ICD_ReportingGroup` | Clinical |
| `ICD10DiseaseGroupModel` | `ICD_DiseaseGroup` | Clinical |
| `ICDEmergencyReportingGroupModel` | `ICD_Emergency_ReportingGroup` | Clinical |
| `ICDEmergencyDiseaseGroupModel` | `ICD_Emergency_DiseaseGroup` | Clinical |
| `LabRequisitionModel` | `LAB_TestRequisition` | Lab |
| `LabTestModel` | `LAB_LabTests` | Lab |
| `ImagingRequisitionModel` | `RAD_PatientImagingRequisition` | Radiology |
| `RadiologyImagingItemModel` | `RAD_MST_ImagingItem` | Radiology |
| `DepartmentModel` | `MST_Department` | Master |
| `CountryModel` | `MST_Country` | Master |
| `CountrySubDivisionModel` | `MST_CountrySubDivision` | Master |
| `MunicipalityModel` | `MST_Municipality` | Master |
| `BillingFiscalYear` | `BIL_CFG_FiscalYears` | Billing |

### DbContext

| File | Description |
|------|-------------|
| `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/MedicalRecordsDbContext.cs` | EF DbContext with 25 `DbSet<>` mappings plus 2 stored-proc wrappers for the morbidity reports. |

### Stored Procedures

| SP | Purpose | Used by |
|----|---------|--------|
| `SP_Report_OutPateint_Morbidity` | Returns 3 result sets: reporting-group counts, other-ICD counts, total-visit counts. | `OutPatientMorbidityReport(FromDate, ToDate)` → consumed by `GovInpatientOutcomeReportComponent` (note: shares data path with the morbidity screen). |
| `SP_Report_EmergencyPatient_Morbidity` | Returns ER reporting-group counts (single table). | `EmergencyPatientMorbidityReport(FromDate, ToDate)` → consumed by `EmergencyPatientMorbidityReportComponent`. |
| `SP_MR_BirthList_FemalePatientsListWithVisitinformation` | Search female patients with most recent visit info — used by mother-lookup in `AddBirthDetailsSharedComponent`. | `GET /api/MedicalRecords/FemalePatientsVisitDetails/{search}` |
| `SP_MR_PatientsListWithVisitId` | Patient search for death-record lookups. | `GET /api/MedicalRecords/SearchDeadPatient/{searchTxt}` |
| `SP_MR_GetDischargedPatientInfo` | Discharged patient grid data with admission, discharge, doctor, ward, ICD, MR status. | `GET /api/MedicalRecords/DischargedPatients?fromDate=&toDate=` |
| `SP_MR_EthnicGroupReport` | Returns 2 result sets: inpatient and outpatient ethnic-group statistics. | `GET /api/MedicalRecords/EthnicGroupStatisticsReports` |

### Frontend Module

| File | Description |
|------|-------------|
| `wwwroot/DanpheApp/src/app/medical-records/medical-records.module.ts` | Angular module: declares 26 components, provides `MR_BLService`, `MR_DLService`, `ADT_DLService`, `DLService`, `ReportingService`, `MedicalRecordService`. |
| `wwwroot/DanpheApp/src/app/medical-records/medical-records-routing.module.ts` | 7 primary routes + 10 sub-routes under `ReportList`. |
| `wwwroot/DanpheApp/src/app/medical-records/medical-records-main.component.ts` | Top-level shell: loads ICD10 list once at startup, builds primary/secondary nav from `SecurityService.GetChildRoutes("Medical-records")`. |

### Frontend Sub-folders

| Folder | Components / Files | Purpose |
|--------|--------------------|---------|
| `inpatient-list/` | `inpatient-list.component.ts/html/css` | Discharged-patient grid (date-range + all/pending/complete filter). |
| `outpatient-list/` | `outpatient-list.component.ts/html`, `final-diagnosis/add-final-diagnosis.component.ts/html`, `final-diagnosis/final-diagnosis.model.ts` | OPD visits grid with ICD-10 final-diagnosis pop-up. |
| `emergencypatient-list/` | `emergency-patient-list.component.ts/html/css/spec.ts`, `final-diagnosis/emergency-add-final-diagnosis.component.ts/html/css/spec.ts`, `emergency-final-diagnosis.model.ts` | ER visits grid with EMER-ICD final-diagnosis pop-up. |
| `birth-list/` | `birth-list.component.ts/html`, `add-birth-details/add-birth-details.component.ts/html` | Births grid + multi-baby add pop-up. |
| `death-list/` | `death-list.component.ts/html`, `add-death-details/add-death-details.component.ts/html` | Deaths grid + death-record add pop-up. |
| `certificates/` | `birth-certificate.component.ts/html`, `death-certificate.component.ts/html` | Printable certificate templates. |
| `add-birth-details-shared/` | `add-birth-details-shared.component.ts/html` | Reusable baby-detail add/edit (used in MR-Summary and Birth-List). |
| `add-death-details-shared/` | `add-death-details-shared.component.ts/html` | Reusable death-detail add/edit (used in MR-Summary and Death-List). |
| `mr-summary/` | `mr-summary-add.component.ts/html`, `mr-summary-view.component.ts/html`, `MR-summary.css` | MR summary add/edit and view pop-ups. |
| `mr-reports/` | `mr-report-main.ts/html`, `disease-wise-report.ts/html`, `mr-outpatient-services-report.ts/html` | Reports main shell + 2 disease-wise reports. |
| `mr-reports/government/` | 9 sub-folders (see §4 Government Reports) | 9 government report screens. |
| `shared/` | `mr.dl.service.ts`, `mr.bl.service.ts`, `medical-record.service.ts`, `medical-records.model.ts`, `Mr-gridcol.settings.ts`, `DischargeMasterData.model.ts`, `babyBirthConditions.model.ts`, `gravita.model.ts`, `MorbidityReportingGroupVM.ts`, `emer-disease-and-reporting-group-VM.ts`, `ethnic-group-statics-data.model.ts` | Services, master-data VMs, grid column definitions. |

---

## 3. Data Models

### 3.1 `MedicalRecordModel` — the MR document (table `MR_RecordSummary`)

| Field | Type | Notes |
|-------|------|-------|
| `MedicalRecordId` | int (PK) | Identity. Set by DB on Add; used as FK from `InpatientDiagnosis`, `BabyBirthDetails`, `DeathDetails`. |
| `PatientVisitId` | int | Indexed. One MR per visit. |
| `PatientId` | int | Indexed. |
| `DischargeTypeId` | int (FK → `ADT_DischargeType`) | Cured / LAMA / Referred / Death / DOR. |
| `DischargeConditionId` | int? (FK → `ADT_MST_DischargeConditionType`) | Recovered / Delivered / Expired. |
| `DeliveryTypeId` | int? (FK → `ADT_MST_DeliveryType`) | Normal / C/S / Forceps / Vacuum / Breech. |
| `DeathPeriodTypeId` | int? (FK → `ADT_MST_DeathType`) | Within 48h / after 48h / brought dead. |
| `OperationTypeId` | int? (FK → `MR_MST_OperationType`) | Optional surgery. |
| `OperatedByDoctor` | int? (FK → `EMP_Employee.EmployeeId`) | Surgeon. |
| `FileNumber` | string | Unique MR file number (e.g. "MR/2024/0001"). |
| `OperationDiagnosis` | string | Free-text. |
| `OperationDate` | DateTime? | |
| `IsOperationConducted` | bool? | When false, OperationTypeId/OperatedByDoctor/OperationDate are nulled out at update time. |
| `Remarks` | string | Free-text. |
| `AllTests` | string (JSON) | Serialized `List<PatLabtestSummaryModel>` (selected lab + imaging tests for the MR). |
| `ICDCode` | string (JSON) | Legacy — replaced by `MR_TXN_Inpatient_Diagnosis` rows. |
| `CaseMain` | string | "General", "Surgical", "Medical", "Obstetric", "Pediatric", "Ortho", "MedicoLegal", etc. |
| `CaseSub` | string | Sub-case within main case. |
| `GravitaId` | int? (FK → `ADT_MST_Gravita`) | Gravida 1/2/3. |
| `GestationalWeek` | int? | |
| `GestationalDay` | int? | |
| `CreatedBy` / `ModifiedBy` | int? | `EMP_Employee.EmployeeId` from session. |
| `CreatedOn` / `ModifiedOn` | DateTime? | Server-stamped. |
| `ReferredDate` | DateTime? | Added 12-Jul-2021 by Bikash Aryal. |
| `ReferredTime` | TimeSpan? | |
| `NumberOfBabies` | int? | 1, 2, 3+ — drives the "twins / multiple" badge on birth cert. |
| `BloodLost` | int? | ml. |
| `BloodLostUnit` | string | "ml" default. |
| `GestationalUnit` | string | "weeks" default. |
| `BabyBirthDetails` (NotMapped) | `List<BabyBirthDetailsModel>` | Embedded babies — each saved as `ADT_BabyBirthDetails` row. |
| `DeathDetail` (NotMapped) | `DeathDetailsModel` | Embedded death — saved as `ADT_DeathDeatils` row. |
| `AllTestList` (NotMapped) | `List<PatLabtestSummaryModel>` | De-serialized from `AllTests` JSON. |
| `ICDCodeList` (NotMapped) | `List<ICD10CodeModel>` | De-normalized for the form. |
| `ShowBirthCertDetail` (NotMapped) | bool | Frontend flag — controls save of baby rows. |
| `ShowDeathCertDetail` (NotMapped) | bool | Frontend flag — controls save of death row. |

### 3.2 `FinalDiagnosisModel` — outpatient (table `MR_TXN_Outpatient_FinalDiagnosis`)

| Field | Type | Notes |
|-------|------|-------|
| `FinalDiagnosisId` | int (PK) | Identity. |
| `PatientVisitId` | int | Indexed. |
| `PatientId` | int | Indexed. |
| `ICD10ID` | int (FK → `MST_ICD10`) | |
| `CreatedBy` | int | |
| `CreatedOn` | DateTime | |
| `ModifiedBy` | int? | |
| `ModifiedOn` | DateTime? | |
| `IsActive` | bool | Soft-delete flag. |
| `IsPatientReferred` | bool | |
| `ReferredBy` | string | |
| `ReferredTo` | string | (not used by outpatient, kept for symmetry) |

Overrides `GetHashCode()` and `Equals()` on `ICD10ID` so `Except()` works correctly in the controller's diff.

### 3.3 `EmergencyFinalDiagnosisModel` — emergency (table `MR_TXN_Emergency_FinalDiagnosis`)

Identical to `FinalDiagnosisModel` except `EMER_DiseaseGroupId` (FK → `ICD_Emergency_DiseaseGroup`) replaces `ICD10ID`. Adds `ReferredTo`.

### 3.4 `InpatientDiagnosisModel` — per-MR ICD list (table `MR_TXN_Inpatient_Diagnosis`)

| Field | Type | Notes |
|-------|------|-------|
| `DiagnosisId` | int (PK) | |
| `PatientId` | int | |
| `PatientVisitId` | int | |
| `MedicalRecordId` | int | FK back to `MR_RecordSummary`. |
| `ICD10ID` | int | |
| `ICD10Code` | string | Denormalized for fast list view. |
| `ICD10Name` | string | Denormalized for fast list view. |
| `CreatedBy` / `CreatedOn` | | |
| `ModifiedBy` / `ModifiedOn` | | |
| `IsActive` | bool | Soft-delete flag — controller flips to false on diff-removal. |

### 3.5 `OperationTypeModel` — operation master (table `MR_MST_OperationType`)

| Field | Type | Notes |
|-------|------|-------|
| `OperationId` | int (PK) | |
| `OperationName` | string | |

### 3.6 `PatLabtestSummaryModel` — `[NotMapped]` view model

| Field | Type | Notes |
|-------|------|-------|
| `TestId` | int | `LabTestId` or `ImagingItemId`. |
| `RequisitionId` | int | `RequisitionId` or `ImagingRequisitionId`. |
| `TestName` | string | |
| `TestCode` | string | `LabTestCode` or `ProcedureCode`. |
| `Department` | string | `"lab"` or `"radiology"`. |
| `IsSelected` | bool? | Set on form load. |

---

## 4. Database Tables

### 4.1 MR-owned Tables (write-paths in this module)

| Table | Model | Write path |
|-------|-------|-----------|
| `MR_RecordSummary` | `MedicalRecordModel` | `AddPatientMedicalRecord`, `UpdateMedicalRecord` (both in `MedicalRecordsController.cs`) |
| `MR_TXN_Outpatient_FinalDiagnosis` | `FinalDiagnosisModel` | `PostFinalDiagnosis` |
| `MR_TXN_Emergency_FinalDiagnosis` | `EmergencyFinalDiagnosisModel` | `PostFinalDiagnosisForEmergencyPatient` |
| `MR_TXN_Inpatient_Diagnosis` | `InpatientDiagnosisModel` | Inserted/updated inside `AddPatientMedicalRecord` and `UpdateMedicalRecord` |
| `MR_MST_OperationType` | `OperationTypeModel` | Read-only here (managed in Settings). |

### 4.2 Cross-Module Tables (read + light update from this module)

| Table | Module | What MR does |
|-------|--------|--------------|
| `ADT_DischargeType` | ADT | Read in `GetAllDischargeTypeMasterData` (eager-loads DeathTypes + DischargeConditionTypes + DeliveryTypes). |
| `ADT_MST_DeathType` | ADT | Read as part of discharge type. |
| `ADT_MST_DischargeConditionType` | ADT | Read as part of discharge type. |
| `ADT_MST_DeliveryType` | ADT | Read as part of discharge condition (CurrentConditionTypes). |
| `ADT_MST_BabyBirthCondition` | ADT | Read in `GetMRMasterData` and `GetMRDetailsOfPatient`. |
| `ADT_BabyBirthDetails` | ADT | Inserted in `AddPatientMedicalRecord` + `AddBirthDetails`; updated in `UpdateBirthDetail`, `UpdateBirthCertificateDetail`, `UpdateBirthCertificatePrintCount`. |
| `ADT_DeathDeatils` | ADT | Inserted in `AddPatientMedicalRecord` + `AddDeathDetails`; updated in `UpdateDeathDetail`, `UpdateDeathCertificateDetail`, `UpdateDeathCertificatePrintCount`. |
| `ADT_PatientCertificate` | ADT | Read via `PatientCertificate` DbSet. |
| `ADT_MST_Gravita` | ADT | Read in `GetMRMasterData` and `GetMRDetailsOfPatient`. |
| `PAT_Patient` | Patient | Read for `DateOfBirth` (age calc), `CountryId`, `CountrySubDivisionId`, `MunicipalityId`, name composition. |
| `PAT_PatientVisits` | Patient | Read for `VisitDate`, `DepartmentId`, `VisitType`, `BillingStatus`. |
| `MST_ICD10` | Clinical | Read (active only) in `GetICD10List`. |
| `ICD_ReportingGroup` | Clinical | Read in `GetICD10ReportingGroup`. |
| `ICD_DiseaseGroup` | Clinical | Read in `GetICD10DiseaseGroup`. |
| `ICD_Emergency_ReportingGroup` | Clinical | Read in `GetICDReportingGroupForEmergencyPatient`. |
| `ICD_Emergency_DiseaseGroup` | Clinical | Read in `GetICDEmergencyDiseaseGroup`. |
| `LAB_TestRequisition` | Lab | Read in `GetPatientTests` + `GetMRDetailsOfPatient` (joined to `LAB_LabTests`). |
| `LAB_LabTests` | Lab | Read for `LabTestCode`. |
| `RAD_PatientImagingRequisition` | Radiology | Read in `GetPatientTests` + `GetMRDetailsOfPatient` (joined to `RAD_MST_ImagingItem`). |
| `RAD_MST_ImagingItem` | Radiology | Read for `ProcedureCode`, `ImagingItemName`. |
| `MST_Country` / `MST_CountrySubDivision` / `MST_Municipality` | Master | Read for birth/death certificate address composition. |
| `MST_Department` | Master | Read for outpatient & emergency list join. |
| `EMP_Employee` | Employee | Read for `CurrentDischargeType`, `OperatedDoctor`, birth cert signatories. |
| `BIL_CFG_FiscalYears` | Billing | Read in `GetFiscalYear(date)` to stamp `FiscalYearId` on every birth/death row. |

### 4.3 Government Report Tables (consumed by reports)

The government reports are read-heavy cross-cuts of Inpatient, ADT, Clinical, Lab, Radiology, Employee data. They use stored procs + JSON aggregation. The output model classes are:

- `RPT_GOVT_GovtReportSummaryModel` (`fromDate`, `toDate`, `hospitalName`, `OutpatientServices[]`, `DiagnosticServices[]`) — `mr-reports/government/govt-report.models.ts`
- `RPT_GOVT_OutpatientService` (age range, M/F counts)
- `RPT_GOVT_DiagnosticService` (service, unit, count)
- `InpatientMorbidityReportModel` / `InpatientMorbidityModel` (age-band M/F counts + total deaths M/F) — `mr-reports/government/inpatient-morbidity/inpatient-morbidity-report.model.ts`
- `RPT_GOVT_InpatientOutcomeModel` + `InpatientServiceReportModel` (InpatientOutcome + GestationalWeek_Gravda + GestationalWeek_MaternalAge + FreeHealthServiceSummary + FreeHealthServiceSummary_SSP + DeathSummary + SurgerySummary + MedicoLegalCases) — `mr-reports/government/inpatient-outcome/`
- `HospitalMortalityReportModel` (read in `hospital-mortality-report.model.ts`)
- `LabKeysPipe` + `LaboratoryServicesModel` — `mr-reports/government/lab-services/`
- `MorbidityReportingGroupVM` / `MorbidityDiseaseGroupVM` (regular and `EMER…` variants) — `shared/MorbidityReportingGroupVM.ts`
- `EthnicGroupStatisticsInpatient_DTO` / `EthnicGroupStatisticsOutpatient_DTO` — `shared/ethnic-group-statics-data.model.ts`

---

## 5. Key Workflows

### 5.1 Inpatient MR Add / Edit

```
┌─ InpatientList page (inpatient-list.component.ts) ────────────────────┐
│ Loads discharged patients via GET /DischargedPatients?fromDate=&toDate=│
│ (calls SP_MR_GetDischargedPatientInfo).                                  │
│ Grid shows: Adm/Dis Date, Patient No., IP No., Name, Age/Sex,          │
│ Ward, Dept, ICD, Doctor, MR-status (Added/Pending badge),              │
│ Action button (Add MR / View MR based on MedicalRecordId).              │
└────────────────────────────────────────────────────────────────────────┘
                                │
                                │ user clicks "Add MR" or "View MR"
                                ▼
┌─ AddNewMedicalRecordComponent (mr-summary-add.component.ts) ───────────┐
│ 1. Loads master data:                                                  │
│    - GET /MRMasterData (discharge type, op type, gravita, birth cond) │
│    - GET /MRFileNumbers (validates uniqueness of file number)          │
│    - GET /PatientTests?patientId=&patientVisitId=                      │
│      (returns lab + imaging tests + IsPatDead flag)                   │
│ 2. If MedicalRecordId > 0 → load existing via GET /PatientMrDetails.   │
│ 3. Special ICD-10 auto-selection for delivery types:                   │
│    Normal → JB20.Z, CS → JB22.Z, Forceps/Vacuum → JB21, Breech → JB23.1│
│ 4. On Submit: POST /PatientMedicalRecord (full MR + babies + ICD +     │
│    death) inside a server-side transaction.                             │
│ 5. On Update: PUT /MedicalRecord — three-way diff for diagnosis;       │
│    per-baby add/update for births; per-death add/update for death.      │
└────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                          View / Print
                          PrintRecord() opens a new window with
                          patMrRecordDetail innerHTML + Danphe styles,
                          triggers window.print() and emits close.
```

### 5.2 Outpatient Final Diagnosis

```
┌─ OutpatientList page (outpatient-list.component.ts) ───────────────────┐
│ Loads OPD visits via GET /OutPatientsVisitInfo?fromDate=&toDate=        │
│ (joined Patient + Visit + Department; FinalDiagnosisCount + list      │
│ of FinalDiagnosis { ICD10Code, ICD10Description }).                    │
│ Filters: department, doctor, reporting group, ICD code, status         │
│ (all / complete / pending).                                            │
│ Action: "Add Final Diagnosis" or "Edit Final Diagnosis" (green if     │
│ FinalDiagnosisCount > 0).                                              │
└────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─ AddFinalDiagnosisComponent (outpatient-list/final-diagnosis/) ────────┐
│ Inputs: SelectedPatient, MR-service.ICD10 list (from cache).            │
│ Loads ICD10ReportingGroup + ICD10DiseaseGroup on init.                 │
│ ngOnInit: if SelectedPatient present →                                 │
│   GET /OutpatientDiagnosis/{patId}/{patVisitId} → existing list       │
│ Submit:                                                                │
│   - Validate IsPatientReferred implies ReferredBy                      │
│   - Map SelectedICD10List (code+desc) → ICD10ID via master list       │
│   - POST /FinalDiagnosis (full list) → controller diff/merge          │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Emergency Final Diagnosis

Mirrors Outpatient but uses `EMER_DiseaseGroupId` instead of `ICD10ID`, adds `ReferredTo`, and the dropdown shows EMER_DiseaseGroupName (not ICD10Description). Endpoint `PostFinalDiagnosisForEmergencyPatient` lives next to `PostFinalDiagnosis` in the controller.

### 5.4 Birth Certificate Workflow

```
BirthListComponent (date-range filter)
   │ GET /Births?FromDate=&ToDate=
   ▼
BirthList grid (cert-no, mother name, father name, sex, birth date,
   birth time, weight, "Certificate" action)
   │ click "Certificate"
   ▼
BirthCertificateComponent (certificates/birth-certificate.component.ts)
   1. ngOnInit: load hospital, provider list, birth-type lookup, and
      BirthCertificateFooter parameter from coreService.
   2. GET /BirthCertificateDetail?birthDetailId=
      → joins BabyBirthDetails + Patient + BabyBirthConditions + Country +
        SubDivision + Municipality + MR_RecordSummary (left-join for
        NumberOfBabies).
   3. Show / Edit / Print (PUT /BirthCertificateDetail updates
      IssuedBy, CertifiedBy, BirthType, FathersName, BirthNumberType,
      PrintCount; PUT /BirthCertificatePrintCount just bumps PrintCount).
```

Add path:

```
AddBirthDetailsComponent (birth-list/add-birth-details/)
   │ embeds AddBirthDetailsSharedComponent
   ▼
AddBirthDetailsSharedComponent (add-birth-details-shared/)
   - Mother lookup via SP_MR_BirthList_FemalePatientsListWithVisitinformation
     (GET /FemalePatientsVisitDetails/{search}).
   - Loads AllBirthConditions master + AllBirthCertificateNumbers
     (for duplicate check).
   - Validates per-baby fields, supports multi-baby batch.
   - On submit: POST /BirthDetails (array of BabyBirthDetails).
     Server stamps: CreatedBy, CreatedOn, IsActive=true,
     FiscalYearId = GetFiscalYear(BirthDate).FiscalYearId,
     PatientVisitId = MAX(PatientVisits where PatientId = motherId).
```

### 5.5 Death Certificate Workflow

```
DeathListComponent
   │ GET /DeathPatients?FromDate=&ToDate=
   │ (joins DeathDetails + Patient; sorted desc by DeathId;
   │  includes FiscalYearId, CauseOfDeath, IsActive, Age)
   ▼
DeathList grid
   │ click "Certificate"
   ▼
DeathCertificateComponent (certificates/death-certificate.component.ts)
   1. GET /DeathCertificateDetail?deathDetailId= → joins
      DeathDetails + Patient + Country + SubDivision.
   2. If cert is incomplete → "Edit"; otherwise "Print".
   3. PUT /DeathCertificateDetail updates CertifiedBy, FatherName,
      MotherName, SpouseOf, CauseOfDeath, PrintCount.
   4. PUT /DeathCertificatePrintCount bumps PrintCount only.
```

Add path:

```
AddDeathDetailsComponent (death-list/add-death-details/)
   │ embeds AddDeathDetailsSharedComponent
   ▼
AddDeathDetailsSharedComponent (add-death-details-shared/)
   - Patient lookup via SP_MR_PatientsListWithVisitId
     (GET /SearchDeadPatient/{searchTxt}).
   - On select: GET /PatientDeathDetail/{PatientId} → if found, pre-fill
     cert number and dates (IsPatientDead = true → UpdateDeathDetails).
   - GET /LatestDeathCertificateNumber?fiscalYearId=0 → suggest next cert #.
   - Duplicate check against GET /DeathCertificatesNumbers.
   - On submit: POST /AddDeathDetails (server stamps CreatedBy/On,
     IsActive, FiscalYearId, PatientVisitId = MAX visit for patient).
   - On update: PUT /DeathDetail (only DeathTime, DeathDate,
     CertificateNumber, ModifiedBy, ModifiedOn are flagged as modified).
```

### 5.6 Government Reports Workflow

All government reports follow the same shape:

1. User picks date range in a `From-To` component.
2. Component hits a controller SP wrapper (or direct `/Reporting/...`).
3. Result is either:
   - a JSON string of a reporting-group list (morbidity reports), or
   - a multi-table `DataSet` (ethnic-group report), or
   - an `RPT_*` array (mortality, lab services, summary).
4. Component renders printable HTML (with hospital header from
   `CORE_CFG_Parameters.Common.CustomerHeader`).
5. `Print()` opens a new window with the HTML, calls `window.print()`.
6. `ExportToExcel(tableId)` calls
   `CommonFunctions.ConvertHTMLTableToExcelForMedicalRecord` (single table)
   or `ConvertHTMLMultipleTableToExcelForMR` (multi-table).

Per-report endpoints:

| Report | Controller | Method | SP / Path |
|--------|-----------|--------|-----------|
| Inpatient Outcome | `MedicalRecordsController` | `DischargedPatients` (also reads `/GovernmentReporting/GetInpatientOutcome`) | `SP_MR_GetDischargedPatientInfo` |
| Inpatient Services / Outcome | `MedicalRecordsController` | `DischargedPatients` + reporting service | `SP_MR_GetDischargedPatientInfo` + `GetInpatientOutcome` |
| Lab Services | `MedicalRecordsController` | reads `/Reporting/LabServicesReport` and renders by `LabKeysPipe` | n/a |
| Disease-Wise | `MedicalRecordsController` (uses DLService to call `/Reporting/DiagnosisWisePatientReport`) | `GetDiagnosisList` | `RPT_ADT_DiagnosisWisePatientReportModel` |
| Outpatient Services | `MedicalRecordsController` + reporting | `DiagnosisWisePatientReport` | same as above |
| Outpatient Morbidity | `MedicalRecordsDbContext.OutPatientMorbidityReport` | `SP_Report_OutPateint_Morbidity` (3 tables → VM) | `OutpatientMorbidityReportViewModel` |
| Inpatient Morbidity | DLService | `GET /GovernmentReporting/GetInpatientMorbidityReportData` | `InpatientMorbidityReportModel` |
| Hospital Mortality | DLService | `GET /Reporting/HospitalMortality` | `HospitalMortalityReportModel` |
| Emergency Patient Morbidity | `MedicalRecordsDbContext.EmergencyPatientMorbidityReport` | `SP_Report_EmergencyPatient_Morbidity` (1 table → JSON string) | n/a |
| Hospital Service Summary | DLService | `GET /GovernmentReporting/HospitalServiceSummary` | `RPT_GOVT_GovtReportSummaryModel` |
| Ethnic Group Statistics | `MedicalRecordsController` | `EthnicGroupStatisticsReports` | `SP_MR_EthnicGroupReport` (2 tables → InPatient + OutPatient DTOs) |

---

## 6. API Endpoints

All endpoints are mounted under `/api/MedicalRecords/...` (with some legacy
inconsistencies — see notes).

| # | HTTP | Route | Purpose | Notes |
|--:|------|-------|---------|-------|
| 1 | GET | `/MRMasterData` | Discharge types (with death types + conditions + delivery types), operation types, birth conditions, gravita. | Returns `AllDischargeType`, `AllOperationType`, `AllBirthConditions`, `AllGravita`. |
| 2 | GET | `/PatientTests?patientId=&patientVisitId=` | All lab + imaging tests for a patient visit, plus `IsPatDead` and `IsDeadOnDifferentVisit` flags. | Used by `AddNewMedicalRecordComponent` on first load. |
| 3 | GET | `/PatientMrDetails?medicalRecordId=&patientVisitId=` | Full MR document with embedded `DeathDetail`, `BabyBirthDetails`, `AllTestList`, `ICDCodeList` + all master data. | Used to hydrate the add/edit form. |
| 4 | GET | `/Births?FromDate=&ToDate=` | Birth list for date range. | Sorted desc by `CreatedOn`. |
| 5 | GET | `/DeathPatients?FromDate=&ToDate=` | Death list for date range. | Sorted desc by `DeathId`. |
| 6 | GET | `/BirthCertificateDetail?birthDetailId=` | Birth-certificate document (patient, mother, condition, country, sub-division, municipality, fiscal year, number of babies, certificate issue date). | Used by `BirthCertificateComponent`. |
| 7 | GET | `/DeathCertificateDetail?deathDetailId=` | Death-certificate document (patient, country, sub-division, fiscal year, certificate number, age, cause, address, spouse, parents, print count, signatories). | Used by `DeathCertificateComponent`. |
| 8 | GET | `/OutPatientsVisitInfo?fromDate=&toDate=` | OPD visits with department, doctor, `FinalDiagnosisCount`, list of `{ICD10Code, ICD10Description}`. | Filters out `VisitType=inpatient/emergency` and `BillingStatus=returned`. |
| 9 | GET | `/ICD10ReportingGroup` | Active ICD-10 reporting groups (top-level). | Ordered by `ReportingGroupName`. |
| 10 | GET | `/ICD10DiseaseGroup` | Active ICD-10 disease groups. | |
| 11 | GET | `/BirthCertificateNumbers` | Distinct active birth-certificate numbers (used for duplicate check). | |
| 12 | GET | `/MRFileNumbers` | Distinct MR file numbers (used for duplicate check). | |
| 13 | GET | `/DeathCertificatesNumbers` | Distinct active death-certificate numbers. | |
| 14 | GET | `/ICD10List` | Active ICD-10 codes. | |
| 15 | GET | `/OutpatientDiagnosis/{patId}/{patVisitId}` | Active final diagnoses (outpatient) for a visit. | Returns `{ICD10Code, ICD10Description, IsPatientReferred, ReferredBy}`. |
| 16 | GET | `/BabyDetails/{patientId}` | Active baby records for a mother patient, joined to birth condition. | |
| 17 | GET | `/FemalePatientsVisitDetails/{search}` | Search female patients via `SP_MR_BirthList_FemalePatientsListWithVisitinformation`. | |
| 18 | GET | `/SearchDeadPatient/{searchTxt}` | Search patients via `SP_MR_PatientsListWithVisitId`. | |
| 19 | GET | `/DeadPatients` | All active death records (for "is patient already dead?" check). | |
| 20 | GET | `/PatientDeathDetail/{PatientId}` | First active death record for a patient. | |
| 21 | POST | `/PatientMedicalRecord` | Add new MR (with embedded baby + ICD + death rows). | Wrapped in `Database.BeginTransaction`. |
| 22 | POST | `/BirthDetails` | Add multiple baby records (array). | Server stamps CreatedBy/On/IsActive/FiscalYearId/PatientVisitId. |
| 23 | POST | `/AddDeathDetails` | Add single death record. | |
| 24 | POST | `/FinalDiagnosis` | Diff-merge outpatient final diagnoses for a visit. | |
| 25 | POST | `/PostEmergencyFinalDiagnosis` | Diff-merge emergency final diagnoses for a visit. | |
| 26 | PUT | `/Birthdetail` | Update baby record (BirthDate, BirthTime, CertNumber, FathersName, WeightOfBaby, Sex, FiscalYearId, ModifiedBy/On). | |
| 27 | PUT | `/MedicalRecord` | Update MR document (with three-way diff for diagnosis; per-baby/per-death add/update). | Wrapped in transaction. |
| 28 | PUT | `/BirthCertificateDetail` | Update certificate detail (IssuedBy, CertifiedBy, BirthType, FathersName, BirthNumberType, PrintCount). | |
| 29 | PUT | `/DeathCertificateDetail` | Update certificate detail (CertifiedBy, FatherName, MotherName, SpouseOf, CauseOfDeath, PrintCount). | |
| 30 | PUT | `/BirthCertificatePrintCount` | Bump `PrintCount`, stamp `PrintedBy`/`PrintedOn`. | |
| 31 | PUT | `/DeathCertificatePrintCount` | Bump `PrintCount`, stamp `PrintedBy`/`PrintedOn`. | |
| 32 | PUT | `/DeathDetail` | Update DeathTime, DeathDate, CertificateNumber, ModifiedBy/On. | |
| 33 | GET | `/LatestDeathCertificateNumber?fiscalYearId=0` | Suggest next death certificate number. | `MAX(CertificateNumber)+1` for the fiscal year. |
| 34 | GET | `/ICDReportingGroupForEmergencyPatient` | Active emergency reporting groups. | Ordered by `EMER_ReportingGroupName`. |
| 35 | GET | `/ICDDiseaseGroupForEmergencyPatient` | Active emergency disease groups. | |
| 36 | GET | `/EmergencyPatientsListWithVisitInfo/{fromDate}/{toDate}` | ER visits with `FinalDiagnosisCount` and emergency disease group list. | |
| 37 | GET | `/EmergencyPatientDiagnosisDetail/{patId}/{patVisitId}` | Emergency final diagnoses for a visit. | |
| 38 | GET | `/DischargedPatients?fromDate=&toDate=` | Discharged patient grid data via `SP_MR_GetDischargedPatientInfo`. | |
| 39 | GET | `/EthnicGroupStatisticsReports?fromDate=&toDate=` | Two tables: inpatient + outpatient ethnic-group statistics via `SP_MR_EthnicGroupReport`. | Returns object `{InPatientEthnicGroupStatisticsReports, OutPatientEthnicGroupStatisticsReports}`. |

**Helper endpoints called from the `MR_DLService` in the Angular layer** (also
under the same prefix):

| HTTP | Route | Purpose |
|------|-------|---------|
| GET | `/api/MedicalRecords/SearchDeadPatient/{searchTxt}` | (alias of #18) |
| GET | `/api/MedicalRecords/FemalePatientsVisitDetails/{search}` | (alias of #17) |
| GET | `/api/medicalRecords/DeadPatients` | (lowercase prefix — alias of #19) |
| GET | `/api/medicalRecords/PatientDeathDetail/{PatId}` | (lowercase prefix — alias of #20) |
| GET | `/api/MedicalRecords/OutpatientDiagnosis/{patId}/{patVisitId}` | (alias of #15) |
| GET | `/api/MedicalRecords/OutpatientServicesReport` | (services-report data path) |
| GET | `/api/MedicalRecords/OutpatientMorbidityReport` | (morbidity data path) |

**Cross-module endpoints used indirectly** (via DLService from reports):

| Path | Module | Purpose |
|------|--------|---------|
| `/Reporting/DiagnosisWisePatientReport` | Reporting | Disease-wise grid data. |
| `/ReportingNew/ExportToExcelDiagnosisWisePatientReport` | Reporting | Excel export. |
| `/Reporting/GetDiagnosisList` | Reporting | Diagnosis dropdown. |
| `/GovernmentReporting/GetInpatientOutcome` | Reporting | Inpatient outcome SP wrapper. |
| `/GovernmentReporting/GetInpatientMorbidityReportData` | Reporting | Inpatient morbidity SP wrapper. |
| `/Reporting/EmergencyPatientMorbidityReport/{fromDate}/{toDate}` | Reporting | ER morbidity SP wrapper. |
| `/Reporting/HospitalMortality` | Reporting | Hospital mortality SP wrapper. |
| `/GovernmentReporting/HospitalServiceSummary` | Reporting | Summary report SP wrapper. |

---

## 7. Cross-Module

| Module | Relationship | Direction |
|--------|--------------|-----------|
| **Patient** | `MR_RecordSummary.PatientId`, `PatientVisitId` reference `PAT_Patient` and `PAT_PatientVisits`. | Read patient demographics, country, sub-division, municipality, address, DOB (for age at death). |
| **ADT** | Reads/writes `ADT_BabyBirthDetails`, `ADT_DeathDeatils`, `ADT_DischargeType`, `ADT_MST_DeathType`, `ADT_MST_DischargeConditionType`, `ADT_MST_DeliveryType`, `ADT_MST_BabyBirthCondition`, `ADT_MST_Gravita`, `ADT_PatientCertificate`. | MR writes birth/death records; ADT owns the master lists. |
| **Clinical (ICD-10)** | Reads `MST_ICD10`, `ICD_ReportingGroup`, `ICD_DiseaseGroup`, `ICD_Emergency_ReportingGroup`, `ICD_Emergency_DiseaseGroup`. | MR consumes the clinical ICD-10 catalogs. |
| **Lab** | Reads `LAB_TestRequisition` + `LAB_LabTests` for the "All Tests" picker. | Read-only — pulls completed lab tests into the MR. |
| **Radiology** | Reads `RAD_PatientImagingRequisition` + `RAD_MST_ImagingItem` for the "All Tests" picker. | Read-only — pulls completed imaging tests into the MR. |
| **Employee** | `OperatedByDoctor`, `CertifiedBy`, `IssuedBy`, `PrintedBy`, `CreatedBy`, `ModifiedBy` reference `EMP_Employee.EmployeeId`. | Read-only join. |
| **Billing (Fiscal Year)** | Reads `BIL_CFG_FiscalYears` via `GetFiscalYear(date)`. | Required for `FiscalYearId` stamping on birth/death rows. |
| **Settings (Parameters)** | `CORE_CFG_Parameters.Common.IcdVersionDisplayName` (display label), `CORE_CFG_Parameters.Common.CustomerHeader` (hospital header on report print), `CORE_CFG_Parameters.ADT.BirthCertificateFooter` (footer JSON on birth cert). | Read-only. |
| **Reporting (DLService)** | Calls `/Reporting/...` for disease-wise, Excel export, and government-report data. | Read-only consume. |
| **Security (RBAC)** | `btn-mr-add-death-record-button-permission` is the only MR-specific permission check (`DeathListComponent.hasDeathRecordPermission`). All routes guarded by `AuthGuardService`. | Read-only. |
| **Emergency** | `EmergencyFinalDiagnosisModel` mirrors the ER row concept (uses ER's `ICD_Emergency_DiseaseGroup` table). | Read-only consume. |

---

## 8. Business Rules

1. **One MR per visit.** `MR_RecordSummary.PatientVisitId` is the natural key. The add path always inserts; the update path is keyed on `MedicalRecordId`.

2. **Transactional save.** Both `AddPatientMedicalRecord` and `UpdateMedicalRecord` wrap inserts/updates across `MR_RecordSummary` + `MR_TXN_Inpatient_Diagnosis` + `ADT_BabyBirthDetails` + `ADT_DeathDeatils` in a single `Database.BeginTransaction`. Any exception rolls back everything.

3. **MR file number uniqueness.** Enforced client-side in `AddNewMedicalRecordComponent.CheckFileNumberDuplication()` against `GET /MRFileNumbers`. The DB has no unique index on `FileNumber` — enforcement is app-only.

4. **Birth certificate number uniqueness.** Enforced client-side in `AddBirthDetailsSharedComponent.BirthCertificateNumberDuplicationCheck()` against `GET /BirthCertificateNumbers`. Tracks `CertificateNoBeforeEdit` so editing the same record doesn't self-conflict.

5. **Death certificate number uniqueness.** Enforced client-side in `AddDeathDetailsSharedComponent.isDeathCertificateNoDuplicate()` against `GET /DeathCertificatesNumbers`. The `LatestDeathCertificateNumber` endpoint suggests the next available number per fiscal year.

6. **Fiscal year stamping.** `GetFiscalYear(date)` is called on every birth and death insert/update. Throws "Fiscal Year not Set" if the date is outside any `BIL_CFG_FiscalYears` range. This is the only way `FiscalYearId` ever lands on a birth or death row.

7. **Age at death calculation.** `GetAgeBetweenTwoDates(dateOfBirth, deathDate)` returns `"X years"` (year>0), `"X months"` (month>0), or `"X days"`. Stored on `DeathDetails.Age` and recomputed on every update.

8. **Outpatient / Emergency final diagnosis diff/merge.** The controller loads existing active rows for `(PatientId, PatientVisitId)`, then:
   - If `IsPatientReferred` or `ReferredBy` changed on the first prev row → update all prev rows.
   - Computes `OnlyNew = newList.Except(prevList)` and `Removed = prevList.Except(newList)` using `GetHashCode`/`Equals` overrides on `ICD10ID` / `EMER_DiseaseGroupId`.
   - Inserts `OnlyNew`, sets `IsActive=false` on `Removed`, and propagates the latest `ReferredBy`/`ReferredTo` onto the deactivated rows.

9. **MR update — diagnosis three-way diff.** Same `Except`-based pattern: `OnlyNew` is inserted, `Removed` is soft-deleted (sets `IsActive=false` in `MR_TXN_Inpatient_Diagnosis`), unchanged is left alone.

10. **MR update — baby three-way diff.** If `ShowBirthCertDetail=true`: each baby in the payload — if `BabyBirthDetailsId > 0` → update, else → insert. If `ShowBirthCertDetail=false`: each existing baby with `BabyBirthDetailsId > 0` is soft-deleted (`IsActive=false`). Empty `BabyBirthDetails` array is honored (no-op for new babies, soft-delete for existing).

11. **MR update — death three-way diff.** If `ShowDeathCertDetail=true`: if `DeathId > 0` → update; else → insert. If `ShowDeathCertDetail=false`: any existing `DeathId > 0` row is soft-deleted. Age is recomputed on every save.

12. **Operation flag toggle.** When `IsOperationConducted=false` at update time, `OperationTypeId`, `OperatedDoctor`, and `OperationDate` are nulled out client-side before send (see `MR_BLService.PutMedicalRecord`).

13. **Patient-already-dead guard.** Before MR-add, `GET /PatientTests` returns `IsPatDead` and `IsDeadOnDifferentVisit` flags (joined on `MR_RecordSummary` whose `DischargeTypeName='death'`). The form pre-fills the death-detail block accordingly.

14. **Test picker = lab ∪ imaging.** `GetPatientTests` and `GetMRDetailsOfPatient` UNION `LabRequisitions ⊲ LabTests` (`Department='lab'`) with `ImagingRequisitions ⊲ ImagingItems` (`Department='radiology'`) into a single `List<PatLabtestSummaryModel>` for the MR. On save, the entire `AllTests` JSON is rebuilt (the server doesn't diff individual tests).

15. **Death certificate requires either parent OR spouse name.** Front-end guard in `DeathCertificateComponent.UpdateDeathCertificationDetail()`: requires `FatherName` OR `MotherName` OR `SpouseOf` plus `CertifiedBy` plus `CauseOfDeath` before allowing the update + print.

16. **Print counter increments on each certificate print.** `PUT /BirthCertificatePrintCount` and `PUT /DeathCertificatePrintCount` are called after each printable print operation. The `PrintCount` is also incremented in `UpdateBirthCertificateDetail` and `UpdateDeathCertificateDetail` (the "edit + print" path).

17. **Print window uses window.print() in a popup.** Standard Danphe pattern: build a new `<html>` document, include `DanpheStyle.css` + `DanphePrintStyle.css`, set `body onload="window.print()"`, then `window.close()` after a 300–400ms timeout.

18. **Discharge type + condition + delivery type hierarchy.** `GetAllDischargeTypeMasterData` returns `DischargeType → DischargeConditionTypes → CurrentConditionTypes (DeliveryTypes)` as a 3-level nested projection so the form can do cascading dropdowns from a single load.

19. **Auto-mapping of Delivery Type → Birth Type.** Hard-coded in `AddBirthDetailsSharedComponent.AutoSelectDeliveryType()`:
   - `Normal` → `Spontaneous Vaginal Delivery`
   - `C/S` → `Cesarean Section`
   - `Forceps | Vacuum | Breech` → `Instrumental Delivery`
   - any other → `Other`

20. **Auto-mapping of NoOfBabies → BirthNumberType.** Hard-coded in `AddBirthDetailsSharedComponent.AutoSelectBirthType()`:
   - `1` → `single`
   - `2` → `twin` (note: form uses `twins` typo in the helper but server accepts both)
   - `3+` → `multiple`

21. **Special ICD-10 codes for delivery auto-attach.** `AddNewMedicalRecordComponent.AssignDeliveryICD10()`:
   - `JB20.Z` → Normal Delivery
   - `JB22.Z` → CS Delivery
   - `JB21` → Forceps & Vacuum Delivery
   - `JB23.1` → Breech Delivery
   These are looked up from the active `MST_ICD10` list on form init and re-attached when the user picks the delivery type.

22. **Auth + ResetPatientContext guard.** Every MR route is wrapped in `AuthGuardService` + `ResetPatientcontextGuard`. The `MedicalRecordsMainComponent` itself is wrapped in `ResetPatientcontextGuard` on `canDeactivate` so navigating away clears the patient context.

23. **Government reports use Nepali (BS) date conversion on print headers.** All printable reports use `NepaliCalendarService.ConvertEngToNepaliFormatted` to render the date range and print date in both English and Nepali.

24. **Excel export is HTML-table-driven.** `CommonFunctions.ConvertHTMLTableToExcelForMedicalRecord` (single table) and `ConvertHTMLMultipleTableToExcelForMR` (multi-table) accept the rendered `id` of the report `<table>` and serialize it to `.xls`. Headers (hospital name, address, phone) are pulled from `CORE_CFG_Parameters.Common.CustomerHeader`.

25. **Inpatient morbidity report has a footer with column-wise sums.** `ReCalcualteSummaryValuesForFooter` sums every age-band M/F count + total-deaths M/F across all reporting groups to print a grand-total footer row.

26. **Old `BIL_*` death-certificate data migration.** The inpatient outcome report's `Success()` handler merges legacy `DOR` (Discharge on Request) into `LAMA` counts — `a.LAMA_Female = a.LAMA_Female + a.DOR_Female;` — to support historical data that was stored under a separate DOR discriminator.

27. **MR-added badge vs MR-pending badge.** `MRIpStatusRenderer` in `Mr-gridcol.settings.ts` renders a green "Added" chip if `MedicalRecordId > 0`, else a yellow "Pending" chip. The action button toggles between "Add MR" and "View MR" based on the same flag.

28. **Outpatient/Emergency list filtering by diagnosis ICD code.** The grid-level filter walks each visit's `FinalDiagnosis[]` and matches against the selected ICD code. Implemented in `FilterDiagnosisPatientsList` (outpatient) and `FilterDiagnosisPatientsList` (emergency — uses `ICDCode` field from `ICDEmergencyDiseaseGroup`).

29. **Frontend ICD-10 list is module-cached.** `MedicalRecordService` (singleton in the MR module) loads `GET /ICD10List` once on `MedicalRecordsMainComponent` construction and serves it to all child components via `mrService.icd10List`. This avoids repeated loads on the outpatient and emergency add-diagnosis screens.

30. **Reactive forms validation pattern.** Every form-driven component uses `FormControl(...).markAsDirty()` + `updateValueAndValidity()` on submit attempts to surface validation errors (see `ValidateBirthDetails`, `ValidateDeathDetails`, `CheckDeathDetailValidation` in `add-birth-details-shared`, `add-death-details-shared`, and `mr-summary-add` components respectively).

# Master Module

## 1. Module Overview

The Master module is the read-mostly lookup backbone of DanpheEMR. It owns every cross-cutting reference entity that the rest of the application pulls in via cache, dropdown, or autocomplete: ICD-10 codes, departments, service departments, countries / sub-divisions / municipalities, employees, imaging items, reactions, medicines, taxes, parameters, core lookups, payment-mode sub-categories, and a single bulk "give me all the master data I need at boot time" payload.

In the .NET / SQL Server reference implementation, all of this is served by two controllers:

1. **`MasterController`** — a read-only controller (`GET` endpoints only) that fronts everything via `DanpheCache.GetMasterData(...)` and the `MasterDbContext` / `CoreDbContext`. This is the hot path that every feature screen hits.
2. **`SettingsController`** — owns the **CRUD** counterparts (POST / PUT) for the same entities (Department, Country, Sub-Division, Municipality, Reaction, PriceCategory, CoreCfgParameter, Bank, etc.). The full file is 2,269 lines; the master-data portion is the 700–1,300 range.

A single bulk endpoint, `GET /api/Master/GetMasterData`, returns a composite object — `ServiceDepartments`, `Departments`, `Taxes`, `UniqueDataList` (past patient addresses), `PriceCategories`, `ICD10List` — and is intended to be called once at client startup to populate the in-memory cache.

All master tables live inside `MasterDbContext` (and a few inside `CoreDbContext`). On the Cloudflare-native migration target, the same entities become D1 tables scoped by `tenant_id` per `AGENTS.md`; this module's DTOs become Zod schemas in `src/schemas/`, and controllers become Hono routes in `src/routes/master/` and `src/routes/settings/`.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Department** | Clinical or administrative department. Stored in `MST_Department`. Owns 0..N `ServiceDepartment` rows. |
| **Service Department** | A billable sub-unit (OPD, Lab, Radiology, Pharmacy, Bed Charges, OT, etc.). Stored in `BIL_MST_ServiceDepartment`. Bridges a `Department` to billing via `IntegrationName`. |
| **Employee** | A staff member. Stored in `EMP_Employee`. Fields include `IsAppointmentApplicable`, `IsExternal`, `DisplaySequence`, `RadiologySignature`. |
| **Country / Sub-Division / Municipality** | Geographic master data. Used in patient registration. |
| **ICD-10 Code** | International Classification of Diseases code (`MST_ICD10`). Filtered client-side by `ValidForCoding` and `Active`. |
| **ICD-10 Reporting Group** | Top-level morbidity-reporting category (`ICD_ReportingGroup`). |
| **ICD-10 Disease Group** | Sub-category of a reporting group (`ICD_DiseaseGroup`). Each row ties a single ICD code into a reporting bucket. |
| **Reaction** | Allergy / adverse-reaction code (`MST_Reactions`). Searched by `ReactionCode` or `ReactionName`. |
| **Imaging Item** | A radiology study (`RAD_MST_ImagingItem`). Child of an `ImagingType`. |
| **Imaging Type** | A radiology modality (`RAD_MST_ImagingType`). |
| **Tax** | Tax component (VAT 13%, Service Charge). Stored in `MST_Tax`. |
| **Core CFG Parameter** | Key-value runtime parameter (`CORE_CFG_Parameters`). Hospital-wide configuration (e.g. `TaxInfo` free-text). |
| **Core CFG Lookup** | Lookup-table alternative to CFG Parameters. Stores a JSON blob under `LookupDataJson` for an entire module. |
| **Core Lookup Detail** | Hierarchical, parent-child lookup rows used by clinical / emergency modules. |
| **Price Category** | Pricing tier (Normal, EHS, SAARC, Foreigner, Insurance, etc.). Stored in `BIL_CFG_PriceCategory`. Has a boolean `IsDefault`. |
| **Payment Mode** | Payment-method sub-category (`MST_PaymentModes`). E.g. "Cash", "Card – Visa", "Cheque", "FonePay". |
| **Payment Page** | A page that accepts payments (`MST_PaymentPages`). E.g. "Billing – Deposit", "Billing – Settlement", "Pharmacy – Sales". |
| **Payment Mode Setting** | Per-page payment-mode UI configuration (`CFG_PaymentModeSettings`): `ShowPaymentDetails`, `IsRemarksMandatory`, `DisplaySequence`, `IsActive`. |
| **Integration Name** | String discriminator that links a `ServiceDepartment` to its source module. E.g. `"OPD"`, `"Lab"`, `"Radiology"`, `"Bed Charges"`, `"Pharmacy"`. |
| **Unique Past Data** | List of unique addresses that past patients have used, returned to the patient-registration autocomplete. |
| **Ward** | A physical ward (`ADT_MST_Ward`). Served by `MasterController` but not currently consumed client-side. |
| **Signatory** | Active employee mapped to a clinical department; used for report signing. |
| **Integration Name** | Lookup of `IntegrationName` strings used by `ServiceDepartment`. |
| **Service Department** (cached view) | Joins `BIL_MST_ServiceDepartment` to `MST_Department` and adds `DepartmentName` and `Isactive` to the payload. Returned from `GetMasterData`. |

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `MasterController.cs` | `Websites/DanpheEMR/Controllers/Master/MasterController.cs` | Read-only lookups consumed by every feature: Departments, Countries, Sub-Divisions, Municipalities, ICD-10, Employees, Imaging Items, Reactions, Medicines, Wards, Signatories, PriceCategories, CoreLookups, plus the composite `GetMasterData` payload. All reads come from `DanpheCache` or `MasterDbContext` / `CoreDbContext`. | 942 |
| `SettingsController.cs` | `Websites/DanpheEMR/Controllers/Settings/SettingsController.cs` | CRUD counterparts for master data: Department, Country, CountrySubDivision, Municipality, Reaction, CoreCfgParameter, PriceCategory, Bank, PrintExportConfiguration, etc. (The full file is 2,269 lines and also owns ADT Stores, IntegrationNames, Payment-Mode Settings, etc.) | 2,269 |

### 2.2 Frontend Services (Angular)

| File | Path | Purpose |
|------|------|---------|
| `settings.dl.service.ts` | `wwwroot/DanpheApp/src/app/settings-new/shared/settings.dl.service.ts` | All HTTP calls into `/api/Settings/...` and `/api/Master/...`. Wires the Master read endpoints (`Master/Signatories`, `Master/Countries`, `Master/CountrySubDivisions`, etc.) together with the Settings CRUD endpoints (`Settings/Department` POST/PUT, `Settings/Country` POST/PUT, `Settings/PriceCategory` POST/PUT, etc.). |
| `settings.bl.service.ts` | `wwwroot/DanpheApp/src/app/settings-new/shared/settings.bl.service.ts` | Thin business-logic wrapper over the DL service. |
| `settings-service.ts` | `wwwroot/DanpheApp/src/app/settings-new/shared/settings-service.ts` | Grid-column metadata (e.g. `DeptList` for the department-list grid). |

### 2.3 Frontend Components (Angular)

| Component | Path | Purpose |
|-----------|------|---------|
| `DepartmentListComponent` | `wwwroot/DanpheApp/src/app/settings-new/departments/dept-master/department-list.component.ts` | Lists departments in a grid; "Add" and "Edit" actions switch into `DepartmentAddComponent`. |
| `DepartmentAddComponent` | `wwwroot/DanpheApp/src/app/settings-new/departments/dept-master/department-add.component.ts` | Add / edit a single department (code, name, head, parent, room number, OPD service-item mapping, appointment-applicable flag). |
| `ServiceDepartmentListComponent` | `wwwroot/DanpheApp/src/app/settings-new/departments/service-dept/service-department-list.ts` | Lists service departments. |
| `ServiceDepartmentAddComponent` | `wwwroot/DanpheApp/src/app/settings-new/departments/service-dept/service-department-add.component.ts` | Add / edit a service department (name, parent dept, integration name, active flag). |
| `TaxManageComponent` | `wwwroot/DanpheApp/src/app/settings-new/tax/tax-manage.component.ts` | Edits the `TaxInfo` free-text parameter via `CoreCfgParameter` PUT. |
| `ParameterListComponent` / `ParameterEditComponent` | `wwwroot/DanpheApp/src/app/settings-new/core/parameters/` | List / edit `CORE_CFG_Parameters`. |
| `PaymentModeMainComponent` | `wwwroot/DanpheApp/src/app/settings-new/payment-mode-settings/payment-mode.main.component.ts` | Configure payment-mode sub-categories per page. |
| `Countries` / `Subdivisions` / `Municipalities` | `wwwroot/DanpheApp/src/app/settings-new/geolocation/{countries,subdivisions,municipalities}/` | CRUD for geographic master data. |

---

## 3. Data Models

All models live under `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/`.

### 3.1 Department & Service Department

| Model | File | Key Fields |
|-------|------|------------|
| `DepartmentModel` | `MasterModels/DepartmentModel.cs` | `DepartmentId`, `DepartmentCode`, `DepartmentName`, `Description`, `DepartmentHead`, `NoticeText`, `IsActive`, `IsAppointmentApplicable`, `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`, `ParentDepartmentId`, `RoomNumber`, `OpdNewPatientServiceItemId`, `OpdOldPatientServiceItemId`, `FollowupServiceItemId` (not mapped: `ServiceItemsList`, `ParentDepartmentName`). |
| `ServiceDepartmentModel` | `BillingModels/Config/ServiceDepartmentModel.cs` | `ServiceDepartmentId`, `ServiceDepartmentName`, `ServiceDepartmentShortName`, `DepartmentId`, `IntegrationName`, `IsActive`, `ParentServiceDepartmentId` (not mapped: navigation `BillItemPriceList`, `Department`). |

### 3.2 Geography

| Model | File | Key Fields |
|-------|------|------------|
| `CountryModel` | `MasterModels/Country.cs` | `CountryId`, `CountryShortName`, `CountryName`, `ISDCode`, `CountrySubDivisionType` (e.g. "State", "Province"), `IsActive`, audit fields. |
| `CountrySubDivisionModel` | `MasterModels/CountrySubDivision.cs` | `CountrySubDivisionId`, `CountryId`, `CountrySubDivisionName`, `CountrySubDivisionCode`, `MapAreaCode`, `IsActive`, `IMU_CountrySubDivisonId`, `IMU_ProvinceId`. |
| `MunicipalityModel` | `MasterModels/Municipality.cs` | `MunicipalityId`, `MunicipalityName`, `Type` ("Metropolitan", "Sub-Metropolitan", "Municipality", "Rural Municipality"), `CountryId`, `CountrySubDivisionId`, `IsActive`, `IMU_CountrySubDivisionId`, `IMU_MuncipalityId`. |

### 3.3 ICD-10

| Model | File | Key Fields |
|-------|------|------------|
| `ICD10CodeModel` | `MasterModels/ICD10Code.cs` | `ICD10ID`, `ICDShortCode`, `ICD10Code` (the canonical dotted code), `ICD10Description`, `ValidForCoding`, `Active`. Overrides `Equals` / `GetHashCode` on `ICD10ID`. |
| `ICD10ReportingGroupModel` | `MasterModels/ICD10Groups/ICD10ReportingGroupModel.cs` | `ReportingGroupId`, `SerialNumber`, `GroupCode`, `ReportingGroupName`, `IsActive`. |
| `ICD10DiseaseGroupModel` | `MasterModels/ICD10Groups/ICD10DiseaseGroupModel.cs` | `DiseaseGroupId`, `SerialNumber`, `ReportingGroupId`, `ICDCode`, `DiseaseGroupName`, `IsActive`. |
| `MorbidityReportingGroupVM` | `MasterModels/ICD10Groups/MorbidityReportingGroupVM.cs` | View-model for the morbidity report: `ReportingGroupId`, `GroupCode`, `ReportingGroupName`, `SerialNumber`, plus a list of `MorbidityDiseaseGroupVM` with `NumberOfMale / NumberOfFemale / NumberOfOtherGender`. |

### 3.4 Employee

| Model | File | Key Fields |
|-------|------|------------|
| `EmployeeModel` | `EmployeeModels/Employee.cs` | `EmployeeId`, `FirstName`, `LastName`, `DepartmentId`, `IsAppointmentApplicable`, `IsActive`, `IsExternal`, `DisplaySequence`, `RadiologySignature` (image filename). |
| `EmployeeRoleModel` | `EmployeeModels/EmployeeRole.cs` | `EmployeeRoleId`, `EmployeeRoleName`, `Description`, `IsActive`. |

### 3.5 Clinical Lookups

| Model | File | Key Fields |
|-------|------|------------|
| `ReactionModel` | `MasterModels/ReactionModel.cs` | `ReactionId`, `ReactionCode`, `ReactionName`, `IsActive`, audit fields. |
| `RadiologyImagingTypeModel` | `MasterModels/RadiologyImagingTypeModel.cs` | `ImagingTypeId`, `ImagingTypeName`, `ProcedureCoding`, `IsActive`, virtual `ImagingItems` collection. |
| `RadiologyImagingItemModel` | `MasterModels/RadiologyImagingItemModel.cs` | `ImagingItemId`, `ImagingTypeId`, `ImagingItemName`, `ProcedureCode`, `IsValidForReporting`, `TemplateId`, virtual `ImagingTypes` nav. |
| `CoreLookupDetail` | `EmergencyModels/CoreLookupDetail.cs` | `Id`, `Type` (LookUpTypeEnum), `Name`, `Description`, `DisplayName`, `DisplaySequence`, `ParentId`, `IsActive` (not mapped: `ChildLookUpDetails`). Hierarchical — children are loaded recursively by `GetChildLookUpDetailData`. |
| `CoreCFGLookupModel` | `MasterModels/CoreCFGLookupModel.cs` | `LookUpId`, `ModuleName`, `LookUpName`, `LookupDataJson`, `Description`. |

### 3.6 Financial / Configuration

| Model | File | Key Fields |
|-------|------|------------|
| `PriceCategoryModel` | `BillingModels/Config/PriceCategoryModel.cs` | `PriceCategoryId`, `PriceCategoryName`, `PriceCategoryCode`, `Description`, `IsDefault`, `IsActive`, `IsPharmacyRateDifferent`, `ShowInRegistration`, `ShowInAdmission`, `DisplaySequence`. |
| `TaxModel` | `MasterModels/TaxModel.cs` | `TaxId`, `TaxName`, `TaxPercentage`, `TaxLabel`, `Description`. |
| `CfgParameterModel` | `MasterModels/CfgParameterModel.cs` | `ParameterId`, `ParameterGroupName`, `ParameterName`, `ParameterValue`, `ValueDataType`, `Description`, `ParameterType`, `ValueLookUpList`. |
| `PaymentModes` | `MasterModels/PaymentModes.cs` | `PaymentSubCategoryId`, `PaymentSubCategoryName`, `PaymentMode`, `ShowInMultiplePaymentMode`. |
| `PaymentPages` | `MasterModels/PaymentModes.cs` | `PaymentPageId`, `ModuleName`, `PageName`, `Description`. |
| `CfgPaymentModesSettings` | `MasterModels/CfgPaymentModesSettings.cs` | `PaymentModeSettingsId`, `PaymentPageId`, `PaymentModeSubCategoryId`, `PaymentModeSubCategoryName`, `IsActive`, `DisplaySequence`, `ShowPaymentDetails`, `IsRemarksMandatory`. |
| `IntegrationModel` | `MasterModels/ServiceDepartmentIntegrationModel.cs` | `IntegrationName` (PK), `IntegrationNameID`. |
| `UniquePastDataModel` | `MasterModels/UniquePastDataModel.cs` | `UniqueAddressList` (currently the only populated list; first/middle/last are commented out). |
| `PrintExportConfigModel` | `MasterModels/PrintExportConfigModel.cs` | `PrintExportSettingsId`, `SettingName`, `PageHeaderText`, `ReportDescription`, `ModuleName`, `ShowHeader`, `ShowFooter`, `ShowUserName`, `ShowPrintExportDateTime`, `ShowNpDate`, `ShowEnDate`, `ShowFilterDateRange`, `ShowOtherFilterVariables`, `IsActive`. |
| `EmailSendDetailModel` | `MasterModels/EmailSendDetailModel.cs` | `SendId`, `SendBy`, `SendToEmail`, `EmailSubject`, `SendOn`. (Audit of emails actually sent by the system.) |
| `StoreVerificationMapModel` | `MasterModels/StoreVerificationMapModel.cs` | `StoreVerificationMapId`, `StoreId`, `MaxVerificationLevel`, `VerificationLevel`, `PermissionId`, `IsActive` (not mapped: `NewRoleName`, `RoleId`). |
| `WardSubStoresMapModel` | `MasterModels/WardSubStoresMapModel.cs` | `WardSubStoresMapId`, `WardId`, `StoreId`, `IsDefault`, `IsActive`. |
| `CookieAuthInfoModel` | `MasterModels/CookieAuthInfoModel.cs` | `AuthId`, `Selector`, `HashedToken`, `UserId`, `Expires` — the "remember me" persistent-login record. |

### 3.7 Ward (read via Master controller but data lives in ADT context)

| Model | File | Key Fields |
|-------|------|------------|
| `WardModel` | `AdmissionModels/WardModel.cs` | `WardId`, `WardName`, `WardCode`, `IsActive`, etc. |

---

## 4. Database Tables

All table names are mapped in `MasterDbContext.cs` (`DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/MasterDbContext.cs`). The convention is `MST_*` for master, `CFG_*` for configuration, `RAD_*` for radiology, `BIL_*` for billing, `EMP_*` for employee, `ADT_*` for admission, `CORE_*` for core, `ICD_*` for ICD.

| Table | C# `DbSet` | Purpose | Notes |
|-------|------------|---------|-------|
| `MST_Department` | `Departments` | Clinical / admin departments. | `IsAppointmentApplicable` controls whether the department shows up in the appointment dropdown. |
| `BIL_MST_ServiceDepartment` | `ServiceDepartments` | Billable sub-units, bridged to billing via `IntegrationName`. | `ParentServiceDepartmentId` enables hierarchy. |
| `MST_Country` | `Country` | Country list. | `IsActive` filtered. |
| `MST_CountrySubDivision` | `CountrySubDivision` | States / provinces. | `IsActive` filtered. `IMU_*` columns for external integration mapping. |
| `MST_Municipality` | `Municipalities` | Cities / municipalities. | `Type` discriminates Metropolitan / Sub-Metropolitan / Municipality / Rural Municipality. |
| `MST_ICD10` | `ICD10Code` | ICD-10 codes. | `ValidForCoding` excludes codes that exist for indexing but shouldn't be primary diagnoses. `Active` is a soft-delete. |
| `ICD_ReportingGroup` | `ICD10ReportingGroups` | Top-level ICD reporting buckets. | |
| `ICD_DiseaseGroup` | `ICD10DiseaseGroups` | ICD codes grouped into a reporting group. | |
| `EMP_Employee` | `Employees` | Staff directory. | `IsAppointmentApplicable`, `IsExternal`, `DisplaySequence`, `RadiologySignature` are the master-controller-relevant fields. |
| `EMP_EmployeeRole` | `EmployeeRole` | Role names. | `Signatories` filters by `EmployeeRoleName == "doctor"` for some lookups (no longer strictly required because `DisplaySequence` already orders them). |
| `MST_Reactions` | `Reactions` | Allergy / reaction codes. | |
| `RAD_MST_ImagingType` | `ImagingTypes` | Radiology modalities. | |
| `RAD_MST_ImagingItem` | `ImagingItems` | Radiology studies. | `IsValidForReporting` flag — items not valid for reporting are typically the parent categories. |
| `MST_Tax` | `Taxes` | Tax components. | |
| `CORE_CFG_Parameters` | `CFGParameters` | Key-value runtime parameters. | Holds free-text settings like `TaxInfo`, `ReceiptHeader`, etc. |
| `CORE_LookupDetail` | `CoreLookupDetails` | Hierarchical lookups. | Parent-child tree. |
| `BIL_CFG_PriceCategory` | `PriceCategorys` | Pricing tiers. | Exactly one row with `IsDefault = true` is mandatory for the OPD service-item dropdown. |
| `MST_PaymentModes` | `PaymentModes` | Payment-method sub-categories. | `ShowInMultiplePaymentMode` flag enables splitting a bill across multiple methods. |
| `MST_PaymentPages` | `PaymentPages` | Pages that accept payments. | E.g. Billing-Deposit, Billing-Settlement, Pharmacy-Sales. |
| `CFG_PaymentModeSettings` | `CfgPaymentModesSettings` | Per-page payment-mode configuration. | Drives the per-page payment dropdown. |
| `ServiceDepartment_MST_IntegrationName` | `IntegrationName` | Integration-name strings. | |
| `CFG_PrintExportSettings` | `PrintExportConfig` | Per-module print/export flags. | |
| `MSTEmailSendDetail` | `SendEmailDetails` | Audit of emails sent. | |
| `MST_MAP_StoreVerification` | `StoreVerificationMapModel` | Verifier-level mapping for stores. | |
| `NUR_MAP_WardSubStoresMap` | `WardSubStoresMapDetails` | Which sub-stores supply which ward. | |
| `ADT_MST_Ward` | `Ward` | Wards (read via MasterController but managed by ADT). | |
| `MST_Bank` | `Banks` | Banks (used by deposit / payment screens). | |
| `RBAC_CookieAuthInfo` | n/a (separate context) | "Remember me" tokens. | |

### Soft-Delete / Active Pattern

Almost every table follows a soft-delete pattern with `IsActive` (bit). The default query path filters on `IsActive = true`. Some tables (e.g. `ICD_ReportingGroup`, `MST_PaymentModes`) do not have an `IsActive` column on the C# model and are returned as-is.

### Audit Pattern

All editable master rows carry nullable `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` columns. Some (e.g. `MST_Tax`, `CORE_CFG_Parameters`) have non-nullable `CreatedBy` / `CreatedOn`.

---

## 5. Key Workflows

### 5.1 ICD-10 Workflow

1. The client calls `GET /api/Master/ICDCode` once at startup; the server returns the entire cached list (`GetICDCode` → `DanpheCache.GetMasterData(MasterDataEnum.ICD10)`).
2. The patient-encounter screen displays an autocomplete bound to the cached list; the user types into a `dl-search` or equivalent component.
3. The Angular client filters in-memory by `ICD10Code` (dotted code) or `ICD10Description` — the server endpoint does not support a server-side filter. The browser's filter logic mirrors what the (commented-out) server-side `if (type == "icdcode")` branch used to do.
4. On save, the chosen `ICD10ID` is persisted against the patient encounter / discharge summary.
5. For morbidity reporting, `ICD_ReportingGroup` and `ICD_DiseaseGroup` rows map a single `ICDCode` to a reporting bucket; the morbidity report joins these tables and groups by `ReportingGroupName`, summing `NumberOfMale / NumberOfFemale / NumberOfOtherGender` from the encounter table.

Notes:
- `ICD10CodeModel.Equals` and `GetHashCode` are overridden on `ICD10ID` — this is required because the in-memory cache holds a list of ICD rows and the client must deduplicate by id when matching.
- `ValidForCoding = false` rows exist in the table for indexing purposes but are excluded from coding dropdowns client-side.

### 5.2 Department Workflow

1. **Read (cache path):** The client calls `GET /api/Master/Departments?inputValue=...` for the appointment screen; the server reads from `DanpheCache.GetMasterData(MasterDataEnum.Department)` and filters in-memory by `DepartmentName.ToLower().Contains(inputValue.ToLower())`. The "appointment" variant uses `GET /api/Master/AppointmentApplicableDepartments` and returns only `IsAppointmentApplicable == true` rows.
2. **Read (admin path):** The settings UI calls `GET /api/Settings/Departments` to list every department, ordered by `DepartmentName`. The grid binds to `Department.DepartmentList` and a nested loop computes `ParentDepartmentName` client-side (look at `department-list.component.ts:35-41`).
3. **Create / Update:** The settings UI submits to `POST /api/Settings/Department` or `PUT /api/Settings/Department` (route: `SettingsController.cs:747-756` and `:1152-1162`).
4. **Service Department linkage:** A `ServiceDepartmentModel` is the billable child of a `DepartmentModel`. Service departments are managed under `BillSettingsController` (`/api/BillSettings/ServiceDepartments`), and the `GetMasterData` endpoint returns a join of `ServiceDepartments` × `Departments` with `{ ServiceDepartmentId, ServiceDepartmentName, DepartmentId, DepartmentName, IntegrationName, Isactive }`.

### 5.3 Country → Sub-Division → Municipality Workflow

1. **Country list:** `GET /api/Master/Countries` returns all countries with `IsActive = true`. The settings page uses `GET /api/Settings/Countries` (returns every row, no active filter) for the admin grid.
2. **Sub-Divisions:** `GET /api/Master/CountrySubDivisions?countryId=<id>` returns the sub-divisions. If `countryId == 0`, all active sub-divisions are returned; otherwise the result is filtered to that country. The endpoint is also exposed at `GET /api/Settings/CountrySubDivisions` for the settings grid.
3. **Municipalities:** `GET /api/Master/Municipalities` returns a grouped payload: `{ CountryId, CountrySubDivisionId, Municipalities: [...] }` — grouped by `(CountryId, CountrySubDivisionId)`. The settings endpoint at `GET /api/Settings/Municipalities` returns a flat joined list with `CountryName` and `CountrySubDivisionName` denormalized.
4. **Create / Update:** `POST /api/Settings/Country` and `PUT /api/Settings/Country`; same for `CountrySubDivision` and `Municipality`. `PUT /api/Settings/MunicipalityStatus?municipalityId=<id>` is the activate/deactivate path.

This three-level chain is consumed by the patient-registration screen: country → sub-division → municipality cascading dropdowns.

### 5.4 Payment-Mode Workflow

Payment modes are split across three tables (`MST_PaymentModes`, `MST_PaymentPages`, `CFG_PaymentModeSettings`) so that a single payment method (e.g. "Cash", "Card – Visa") can be enabled/disabled per page (e.g. "Billing – Deposit" vs "Pharmacy – Sales") with per-page UI hints.

1. The settings admin configures a payment page (e.g. "Billing – Settlement").
2. The admin assigns payment-mode sub-categories to that page via `CFG_PaymentModeSettings` rows. Each row carries `DisplaySequence`, `ShowPaymentDetails`, `IsRemarksMandatory`, `IsActive`.
3. The client reads the page-specific configuration and renders the payment dropdown.
4. At runtime, a transaction can split a bill across multiple payment modes (e.g. 50% cash + 50% card) — that's what the `ShowInMultiplePaymentMode` flag on `MST_PaymentModes` controls.

### 5.5 Service-Department Workflow

Service departments are the billable sub-units of a clinical department. They carry an `IntegrationName` string that maps them to the source module.

1. **Creation:** An admin creates a service department under `BillSettings` (`POST /api/BillSettings/ServiceDepartment`). The row's `DepartmentId` ties it to a clinical department; `IntegrationName` ties it to the source module.
2. **Activation toggle:** `PUT /api/Settings/UpdateServiceDepartmentStatus` flips the `IsActive` flag (`SettingsController.cs:709-743`).
3. **Boot payload:** `GET /api/Master/GetMasterData` returns a join of active service departments with their parent department — `{ ServiceDepartmentId, ServiceDepartmentName, DepartmentId, DepartmentName, IntegrationName, Isactive }`. The client caches this for the duration of the session.
4. **Cross-module usage:** Billing, Lab, Radiology, Pharmacy, OT — every module's billing items reference the `ServiceDepartment` and the corresponding `IntegrationName`. When a Lab result is entered, the bill is auto-created under the same `ServiceDepartment` (the "Lab" service department).

### 5.6 Signatory Workflow

Used by Lab and Radiology report-signing screens.

1. The report screen calls `GET /api/Master/Signatories?departmentName=<dept>`.
2. The server returns active employees mapped to the requested department (or "lab" / "pathology" for lab, with a special case for "radiology" that also includes employees with a non-empty `RadiologySignature` regardless of department).
3. The result is ordered by `DisplaySequence` (the display order on the report's signature block).
4. The screen binds this list to a signature-picker dropdown; on save, the chosen employee's signature image (`RadiologySignature` filename) is rendered into the PDF.

### 5.7 Core Lookup Workflow

`CoreLookupDetail` is a generic parent-child lookup tree.

1. The client calls `GET /api/Master/CoreLookups?lookUpType=<int>` (the int is `LookUpTypeEnum`).
2. If `lookUpType > 0`, the result is filtered to that type. Otherwise, all types are returned.
3. The server builds a tree: rows with no `ParentId` (or `ParentId == 0`) are roots; each root gets a recursive `ChildLookUpDetails` collection (`GetChildLookUpDetailData` is recursive).
4. The client binds this to a tree-style dropdown for use in clinical templates.

### 5.8 Composite Boot Payload (`GetMasterData`)

`GET /api/Master/GetMasterData` is called once when the SPA boots. It returns:

```json
{
  "ServiceDepartments": [
    { "ServiceDepartmentId": 1, "ServiceDepartmentName": "OPD", "DepartmentId": 5, "DepartmentName": "General Medicine", "IntegrationName": "OPD", "Isactive": true }
  ],
  "Departments": [ /* DepartmentModel[] */ ],
  "Taxes": [ /* TaxModel[] */ ],
  "UniqueDataList": { "UniqueAddressList": [ /* strings */ ] },
  "PriceCategories": [ /* PriceCategoryModel[] */ ],
  "ICD10List": [ /* ICD10CodeModel[] */ ]
}
```

The client stores this in `CoreService.Masters` and reuses it across the entire session — every dropdown, autocomplete, and validation check consults this cache first.

---

## 6. API Endpoints

### 6.1 MasterController (`/api/Master`)

| Method | Route | Source | Description |
|--------|-------|--------|-------------|
| `GET` | `/api/Master/Departments?inputValue=` | `MasterController.cs:30-40` | List departments from cache, filter by name. |
| `GET` | `/api/Master/AppointmentApplicableDepartments` | `MasterController.cs:42-52` | Departments with `IsAppointmentApplicable == true`. |
| `GET` | `/api/Master/CountrySubDivisions?countryId=` | `MasterController.cs:54-62` | Active sub-divisions; if `countryId == 0`, returns all. |
| `GET` | `/api/Master/Municipalities` | `MasterController.cs:64-81` | Municipalities grouped by `(CountryId, CountrySubDivisionId)`. |
| `GET` | `/api/Master/Countries` | `MasterController.cs:83-94` | Active countries. |
| `GET` | `/api/Master/EmployeeDepartment?employeeId=` | `MasterController.cs:97-111` | Single department for an employee (join of `Departments` × `Employees` cache). |
| `GET` | `/api/Master/AppointmentApplicableEmployees` | `MasterController.cs:113-123` | Employees with `IsAppointmentApplicable == true && IsActive == true` (note: the filter `emp.IsAppointmentApplicable == emp.IsActive == true` is a chained-equality, equivalent to `(emp.IsAppointmentApplicable == true) && (emp.IsActive == true)`). |
| `GET` | `/api/Master/DepartmentEmployees?deparmenttId=` | `MasterController.cs:125-135` | All employees in a department. |
| `GET` | `/api/Master/Signatories?departmentName=` | `MasterController.cs:137-144` | Active employees mapped to the requested department; special-cased for "lab" and "radiology". |
| `GET` | `/api/Master/ICDCode` | `MasterController.cs:146-153` | Full cached ICD-10 list. |
| `GET` | `/api/Master/Employees?inputValue=` | `MasterController.cs:155-162` | Cached employees filtered by `FirstName` or `LastName`. |
| `GET` | `/api/Master/Medicines?inputValue=` | `MasterController.cs:164-172` | Cached pharmacy item master filtered by `ItemName`. |
| `GET` | `/api/Master/Reactions?inputValue=` | `MasterController.cs:174-181` | Cached reactions filtered by `ReactionCode` or `ReactionName`. |
| `GET` | `/api/Master/ImagingItems?inputValue=` | `MasterController.cs:182-189` | Cached imaging items. If `inputValue` is an integer, filters by `ImagingTypeId`; otherwise returns all. |
| `GET` | `/api/Master/Wards` | `MasterController.cs:191-198` | All wards. Not consumed by the current client. |
| `GET` | `/api/Master/GetMasterData` | `MasterController.cs:200-208` | Composite boot payload: service depts, departments, taxes, unique addresses, price categories, ICD-10. |
| `GET` | `/api/Master/CoreLookups?lookUpType=` | `MasterController.cs:210-217` | Hierarchical core lookup details. |
| `GET` | `/api/Master/GetPriceCategories` | `MasterController.cs:755-772` | All price categories from `CoreDbContext.PriceCategory`. |

### 6.2 SettingsController (`/api/Settings`) — Master-data CRUD slice

| Method | Route | Source | Description |
|--------|-------|--------|-------------|
| `GET` | `/api/Settings/Departments` | `SettingsController.cs:46-55` | All departments (admin grid, no active filter, ordered by name). |
| `GET` | `/api/Settings/Countries` | `SettingsController.cs:81-93` | All countries. |
| `GET` | `/api/Settings/CountrySubDivisions` | `SettingsController.cs:95-107` | All sub-divisions. |
| `GET` | `/api/Settings/Municipalities` | `SettingsController.cs:109-131` | Joined list with denormalized country and sub-division names. |
| `GET` | `/api/Settings/Reactions` | `SettingsController.cs:132-141` | All reactions. |
| `GET` | `/api/Settings/CoreCfgParameter` | `SettingsController.cs:143-152` | All CFG parameters. |
| `GET` | `/api/Settings/PrintExportConfiguration` | `SettingsController.cs:154-163` | All print/export configs. |
| `GET` | `/api/Settings/OPDServiceItems` | `SettingsController.cs:164-175` | Service items under the default price category. Throws if no default is set. |
| `POST` | `/api/Settings/Department` | `SettingsController.cs:747-756` | Create a department. |
| `PUT` | `/api/Settings/Department` | `SettingsController.cs:1152-1162` | Update a department. |
| `POST` | `/api/Settings/Country` | `SettingsController.cs:774-782` | Create a country. |
| `PUT` | `/api/Settings/Country` | `SettingsController.cs:1186-1194` | Update a country. |
| `POST` | `/api/Settings/CountrySubDivision` | `SettingsController.cs:785-794` | Create a sub-division. |
| `PUT` | `/api/Settings/CountrySubDivision` | `SettingsController.cs:1212-1221` | Update a sub-division. |
| `POST` | `/api/Settings/Municipality` | `SettingsController.cs:797-806` | Create a municipality. |
| `PUT` | `/api/Settings/MunicipalityStatus?municipalityId=` | `SettingsController.cs:1198-1209` | Activate / deactivate a municipality. |
| `POST` | `/api/Settings/Reaction` | `SettingsController.cs:808-816` | Create a reaction. |
| `PUT` | `/api/Settings/Reaction` | `SettingsController.cs:1224-1233` | Update a reaction. |
| `PUT` | `/api/Settings/CoreCfgParameter` | `SettingsController.cs:1237-1246` | Update a CFG parameter. |
| `POST` | `/api/Settings/PriceCategory` | `SettingsController.cs:854-864` | Add a price category. |
| `PUT` | `/api/Settings/PriceCategory` | `SettingsController.cs:1567-1572` | Update a price category. |
| `PUT` | `/api/Settings/PriceCategoryActivation` | `SettingsController.cs:1607-1608` | Activate / deactivate a price category. |
| `POST` | `/api/Settings/PrintExportConfiguration` | `SettingsController.cs:843-853` | Add a print/export config. |
| `PUT` | `/api/Settings/PrintExportConfiguration` | `SettingsController.cs:1261-1271` | Update a print/export config. |
| `PUT` | `/api/Settings/UpdateServiceDepartmentStatus` | `SettingsController.cs:709-743` | Activate / deactivate a service department. |
| `PUT` | `/api/Settings/UpdatePaymentModeSettings` | `SettingsController.cs:600-601` | Update payment-mode settings. |
| `GET` | `/api/Settings/GetPaymentModes` | `SettingsController.cs:660-661` | Payment-mode sub-categories. |
| `GET` | `/api/Settings/GetPaymentModeSettings` | `SettingsController.cs:684-685` | Per-page payment-mode configuration. |
| `GET` | `/api/Settings/IntegrationNames` | `SettingsController.cs:72-80` | Integration-name strings. |
| `GET` | `/api/Settings/PharmacyStores` | `SettingsController.cs:57-70` | Pharmacy stores (`Store.Category == Substore`). |
| `GET` | `/api/Settings/GetStoreVerifiers/{StoreId}` | `SettingsController.cs:446-447` | Verifier mapping for a store. |
| `GET` | `/api/Settings/BillingCreditOrganization` | `SettingsController.cs:475-476` | Billing credit organizations. |
| `GET` | `/api/Settings/PharmacyCreditOrganization` | `SettingsController.cs:514-515` | Pharmacy credit organizations. |
| `POST` | `/api/Settings/Bank` | `SettingsController.cs:830-839` | Create a bank. |
| `PUT` | `/api/Settings/Bank` | `SettingsController.cs:1249-1259` | Update a bank. |
| `POST` | `/api/Settings/NursingWardSupplyMap` | `SettingsController.cs:2153-2154` | Map a ward to a sub-store. |
| `GET` | `/api/Settings/NursingWardSupplyMap` | `SettingsController.cs:2174-2175` | Read ward-sub-store map. |
| `POST` | `/api/Settings/LabTest` | `SettingsController.cs:819-828` | Create a lab test (master record). |
| `GET` | `/api/Settings/IntakeOutputType` | `SettingsController.cs:177-185` | Clinical intake/output type master. |
| `GET` | `/api/Settings/IntakeOutputTypeForGrid` | `SettingsController.cs:186-193` | Intake/output types for the grid view. |
| `POST` | `/api/Settings/PostIntakeOutputVariable` | `SettingsController.cs:194-...` | Create an intake/output variable. |
| `PUT` | `/api/Settings/UpdateIntakeOutputVariable` | `SettingsController.cs:240-...` | Update an intake/output variable. |
| `PUT` | `/api/Settings/activate-deactivate-intakeoutput-variables` | `SettingsController.cs:223-...` | Activate / deactivate an intake/output variable. |

---

## 7. Cross-Module Integration

The Master module is consumed by **every** other module. Concrete call sites:

| Module | What it pulls from Master |
|--------|---------------------------|
| **Appointment** | `GET /api/Master/Departments` and `GET /api/Master/AppointmentApplicableDepartments` for the department dropdown. `GET /api/Master/AppointmentApplicableEmployees` for the doctor dropdown. `GET /api/Master/ICDCode` for chief-complaint / diagnosis. |
| **Patient Registration** | `GET /api/Master/Countries`, `GET /api/Master/CountrySubDivisions?countryId=`, `GET /api/Master/Municipalities` for the cascading address dropdown. `UniquePastDataModel.UniqueAddressList` for address autocomplete. |
| **Billing** | `GET /api/Master/GetMasterData` (price categories, taxes, service departments). `GET /api/Settings/GetPaymentModes` and `GET /api/Settings/GetPaymentModeSettings` for the payment-mode dropdown per page. |
| **Lab** | `GET /api/Master/Signatories?departmentName=lab` for the signature block. `GET /api/Master/Reactions?inputValue=...` for the allergy dropdown. |
| **Radiology** | `GET /api/Master/Signatories?departmentName=radiology` for the signature block. `GET /api/Master/ImagingItems?inputValue=<typeId>` for the imaging-item-by-type autocomplete. The `Employee.RadiologySignature` field is also surfaced here. |
| **Pharmacy** | `GET /api/Master/Medicines?inputValue=...` for the drug autocomplete. |
| **Clinical** | `GET /api/Master/CoreLookups?lookUpType=<int>` for clinical template pickers. `GET /api/Master/ICDCode` for diagnosis entry. |
| **Emergency** | `GET /api/Master/CoreLookups` for triage / disposition pickers. |
| **ADT** | `GET /api/Master/Wards`, `GET /api/Master/DepartmentEmployees?deparmenttId=` for doctor lookup on admission. |
| **Discharge Summary** | `GET /api/Master/ICDCode` for primary / secondary diagnosis at discharge. |
| **Reports / Dynamic Report** | Print/export configuration via `GET /api/Settings/PrintExportConfiguration`. |
| **Employee** (settings) | `GET /api/Master/Departments` for the department dropdown when creating employees. |
| **Inventory / Pharmacy** | `GET /api/Settings/PharmacyStores` for the store dropdown. |
| **Security** | `GET /api/Settings/IntegrationNames` for permission naming. |
| **Vaccination / Nursing** | `GET /api/Settings/NursingWardSupplyMap` to know which sub-stores supply a ward. |
| **Verification / Validation across all transactional modules** | `CoreService.Masters` (the in-memory snapshot of `GetMasterData`) is the universal cache consulted before any dropdown renders. |

The composite `GetMasterData` is the canonical "give me everything" payload that the Angular client uses to avoid round-trips; every other master endpoint is a targeted re-read when a specific subset is needed.

---

## 8. Business Rules

1. **Cache-first reads.** Every `MasterController` read endpoint pulls from `DanpheCache` first; the cache is invalidated on writes (e.g. when a department is updated via `SettingsController.PUT /Department`, the cache entry for `MasterDataEnum.Department` is refreshed). The client also has its own in-memory cache (`CoreService.Masters`) populated from `GetMasterData`.

2. **Soft-delete with `IsActive`.** Most master tables have a bit `IsActive` column. The default read path filters on `IsActive = true`. Some endpoints (e.g. `Settings/Countries`) intentionally do not filter — the admin grid needs to see inactive rows so the admin can re-activate them.

3. **Audit fields.** Every editable row carries nullable `CreatedBy / CreatedOn / ModifiedBy / ModifiedOn`. The system stamps `currentUser.EmployeeId` and `DateTime.Now` on POST and PUT.

4. **Cascading dropdown validation.** Patient registration enforces a strict Country → Sub-Division → Municipality hierarchy. The server enforces this implicitly by joining the tables on the foreign keys; the client enforces it by passing the selected `CountryId` to the sub-divisions endpoint and the selected `CountrySubDivisionId` to the municipalities endpoint.

5. **Department ↔ Service Department relationship.** A service department is *always* the child of a department. The `DepartmentId` foreign key is required. The `IntegrationName` discriminator on the service department determines which billing module owns the resulting bills.

6. **Default price category is mandatory.** `OPDServiceItems` throws `InvalidOperationException("There is no default PriceCategory set in the system, Please set if first")` if no `PriceCategory` row has `IsDefault = true`. The bootstrap path must guarantee exactly one default.

7. **Signatory ordering.** Lab and Radiology signature blocks are ordered by `Employee.DisplaySequence` — the integer field the admin uses to control the order of doctors on the report footer.

8. **Lab signature special case.** When `departmentName == "lab"`, the server includes employees from departments named "lab" **or** "pathology" (to support hospitals that name the department either way).

9. **Radiology signature special case.** When `departmentName == "radiology"`, the server includes employees in the named department **plus** any active employee with a non-empty `RadiologySignature` field — so a radiologist attached to a different department (e.g. "General Medicine") can still sign radiology reports.

10. **ICD-10 deduplication.** `ICD10CodeModel.Equals` and `GetHashCode` are overridden on `ICD10ID`. This is required because the in-memory cached list is shared across screens, and any consumer that does a `List.Contains(...)` (e.g. when checking whether a code is already selected) needs the equality to be by `ICD10ID` rather than reference.

11. **Payment-mode configuration is per-page.** A single payment method (e.g. "Cash", "Card – Visa") can be enabled on one page (e.g. "Billing – Settlement") and disabled on another (e.g. "Pharmacy – Sales") via the `CFG_PaymentModeSettings` join table. `ShowPaymentDetails` and `IsRemarksMandatory` are per-page UI flags; `DisplaySequence` controls the order in the dropdown.

12. **Multiple-payment-mode flag.** `MST_PaymentModes.ShowInMultiplePaymentMode` controls whether the method can be used in a split-payment transaction (e.g. 50% cash + 50% card). Methods without this flag are only available as the single payment method of a transaction.

13. **Appointment applicability.** A department or employee is bookable only if its `IsAppointmentApplicable` flag is true (and the employee must additionally be `IsActive`). The master controller exposes dedicated endpoints (`AppointmentApplicableDepartments`, `AppointmentApplicableEmployees`) so the appointment screen does not need to re-filter.

14. **Department-OPDxServiceItem linkage.** Newer fields on `DepartmentModel` (`OpdNewPatientServiceItemId`, `OpdOldPatientServiceItemId`, `FollowupServiceItemId`) let a department specify which billing service items are auto-applied for new-patient visits, old-patient visits, and follow-ups. This eliminates the need for a separate "department × service item" mapping table.

15. **Ward ↔ Sub-Store mapping.** `NUR_MAP_WardSubStoresMap` (managed via `NursingWardSupplyMap` endpoint) maps a ward to one or more sub-stores. The `IsDefault` flag picks the primary sub-store for that ward. The nursing indents screen uses this map.

16. **Cookie "remember me".** `CookieAuthInfoModel` (table `RBAC_CookieAuthInfo`) stores the persistent-login token: `Selector` (random public id), `HashedToken` (server-side hash of the secret), `UserId`, `Expires`. Validation: the server looks up by `Selector` and verifies the secret against `HashedToken`. This is not exposed via `MasterController` but is a master-table concern.

17. **Print/Export configuration scoping.** Each `PrintExportConfigModel` row scopes to a `ModuleName`. The Angular print/export dialog reads the row for the current module and toggles header/footer/date/etc. flags.

18. **ICD-10 morbidity reporting.** `MorbidityReportingGroupVM` is a view-model built by joining `ICD_ReportingGroup` → `ICD_DiseaseGroup` → encounter / diagnosis tables, then summing male / female / other-gender counts. This is a dedicated read model used by the morbidity report; it is not a persisted table.

19. **Master data is tenant-agnostic in the reference implementation.** In the .NET / SQL Server version, all rows live in a single `MasterDbContext` per database (no `tenant_id`). On the Cloudflare migration target, the same entities must be scoped by `tenant_id` per the project's `AGENTS.md` rules. The Zod schemas in `src/schemas/master.ts` and the corresponding Hono routes in `src/routes/master/` must enforce tenant isolation in the `c.env.DB.prepare(...).bind(...)` call.

20. **Settings-as-Master dual ownership.** A given master entity may have:
   - a **read** endpoint in `MasterController` (cache-backed, used by features), and
   - a **CRUD** set in `SettingsController` (DB-backed, used by admins).
   The two must stay in sync — when a CRUD write occurs, the cache must be invalidated so the next read returns fresh data.

---

## Appendix A — DanpheCache MasterDataEnum

The `MasterDataEnum` enumeration lists every cache slot populated at startup. Each value maps to a `DbSet` in `MasterDbContext` or `CoreDbContext`. Reading any of these via `DanpheCache.GetMasterData(...)` returns the in-memory list, avoiding a DB round-trip.

| Enum value | Source | Populated at |
|------------|--------|--------------|
| `Department` | `MST_Department` | App startup |
| `Employee` | `EMP_Employee` | App startup |
| `ICD10` | `MST_ICD10` | App startup |
| `Reaction` | `MST_Reactions` | App startup |
| `Medicine` | `PHRM_MST_Item` | App startup |
| `ImagingItems` | `RAD_MST_ImagingItem` | App startup |
| `ServiceDepartment` | `BIL_MST_ServiceDepartment` | App startup |
| `PriceCategory` | `BIL_CFG_PriceCategory` | App startup |
| `Taxes` | `MST_Tax` | App startup |
| `PastUniqueData` | `UniquePastDataModel` | App startup |

## Appendix B — Cross-references

- `40-settings.md` — the comprehensive cross-module settings doc (includes ADT settings, Billing settings, Employee settings, Radiology settings, Security settings).
- `36-radiology.md` — consumes `Master/Signatories?departmentName=radiology` and `Master/ImagingItems`.
- `22-lab.md` — consumes `Master/Signatories?departmentName=lab` and `Master/Reactions`.
- `32-patient.md` — consumes `Master/Countries`, `Master/CountrySubDivisions`, `Master/Municipalities`, and `Master/GetMasterData.UniqueDataList`.
- `05-billing.md` — consumes `Master/GetMasterData` (price categories, taxes, service departments).
- `04-appointment.md` — consumes `Master/AppointmentApplicableDepartments` and `Master/AppointmentApplicableEmployees`.
- `34-pharmacy.md` — consumes `Master/Medicines`.

# Core Module

## 1. Module Overview

The Core module is the cross-cutting foundation layer of DanpheEMR. It is **not a feature module** — it contains the runtime plumbing that every other module in the system depends on: base controller behavior, in-memory master-data caching, system-wide parameter / lookup storage, the two generations of dynamic-template configuration, the action-filter pipeline that gates every HTTP call, and the shared `CoreDbContext` that aggregates 30+ entity sets. If a piece of code is required by more than one other module, it lives here.

The module is split into six logical sub-systems:

1. **Lookups** — `CORE_CFG_LookUps`. A module-keyed JSON-blob storage for arbitrary cross-cutting configuration. Surfaced through `CoreController.GetLookups(string inputValue)`.
2. **Parameters** — `CORE_CFG_Parameters`. A typed key-value store (`ParameterGroupName` + `ParameterName` + `ParameterValue` + `ValueDataType`) used by every feature for feature flags, JSON-formatted settings blobs, and tax / billing rate configuration. Surfaced through `ParametersController`.
3. **Application Settings** — limited-scope exposure of the strongly-typed `MyConfiguration` (application version, abnormal-lab highlight flag, cache expiration minutes). Surfaced through `CoreController.GetAppSettings()` so the SPA can read runtime flags without seeing the connection string.
4. **Employee Preferences** — per-user UI preferences (currently the date-format toggle). Backed by `EMP_EmployeePreferences` and accessed through `CoreController.EmployeeDatePreference`.
5. **Dynamic Templates (legacy `CORE_DYNTMP_*`)** — Template → Questionnaire → Question → Option tree used for clinical-psychiatry and other survey-style screens. The pre-2023 dynamic template engine, still in use. Surfaced through `DynTemplatesController`.
6. **Dynamic Templates v2 (`DYNTMP_MST_*`, `DYNTEMP_CFG_*`, `DYNTMP_MAP_*`)** — modern template engine introduced July 2023 with TemplateType → FieldMaster → Template → TemplateFieldMapping, plus `PrintContentHTML` for printable artefacts. Backed by `IDynamicTemplateService` / `DynamicTemplateService` and surfaced through `DynamicTemplateController`.

Two cross-cutting support classes are part of the Core module and consumed by every other controller:

- `CommonController` — base class for all API controllers. Owns the connection strings, the `RequestFormSizeLimit` filter, the `DanpheDataFilter` (JWT auth), and a suite of `InvokeHttp*Function` helpers that wrap every handler in a `DanpheHTTPResponse<T>` envelope and serialize via `DanpheJSONConvert`.
- `DanpheActionFilter` — a single file holding `RequestFormSizeLimitAttribute` (raises form limits for large POSTs), `DanpheViewFilter` (RBAC gating for MVC view actions), and `DanpheDataFilter` (JWT-bearer gating for API actions).

The single most important runtime concern in the Core module is the in-memory **`DanpheCache`** singleton. It caches twelve master datasets (departments, employees, ICD-10, service departments, medicines, reactions, imaging items, taxes, price categories, accounting codes, lab run-number settings, and past-unique patient data) using `System.Runtime.Caching.MemoryCache` with absolute expiration controlled by `appsettings.json:CacheExpirationMinutes`. Over **75 call sites** in 13 different controllers (Master, Billing, Lab, Admission, Scheduling, Radiology, Incentive, Insurance, Accounting, etc.) hit this cache before falling back to SQL. The cache is registered as `services.AddSingleton<DanpheCache>` in `Startup.cs` (see `DanpheEMR reference/Code/Websites/DanpheEMR/Startup.cs:169`).

In the .NET / SQL Server reference implementation the Core module is split between two projects: the **API** project (`Websites/DanpheEMR/Controllers/Core/`) and the **library** project (`Components/DanpheEMR.Core/`). The library project contains `CoreDbContext`, `Caching`, the `Parameters/ParameterModel.cs`, the `Lookups/LookupsModel.cs`, the `DynTemplates/*` models, and the `DynamicTemplate/*` models. The API project contains the four controllers, the `CommonController` base, and the `DanpheActionFilter` / `RequestFormSizeLimit` attributes. On the Cloudflare-native migration target these collapse into a single foundation layer: Hono `src/routes/core/*` routes, Zod schemas in `src/schemas/core/`, and a `cache` module backed by Cloudflare KV instead of in-process `MemoryCache`.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Lookup** | A module-keyed JSON blob stored in `CORE_CFG_LookUps`. Each row is `(LookupId, ModuleName, LookupName, LookupDataJson, Description)`. Used for legacy / irregular lookups; supplanted by Parameters in modern code. |
| **Parameter** | A typed runtime key-value pair stored in `CORE_CFG_Parameters`. Each row is `(ParameterId, ParameterGroupName, ParameterName, ParameterValue, ValueDataType, Description)`. The SPA caches the entire table in `CoreService.Parameters` and resolves values via `find()` lookups. |
| **Application Setting** | A small, fixed set of strongly-typed runtime values exposed by `MyConfiguration` to the SPA: `ApplicationVersionNum`, `highlightAbnormalLabResult`, `CacheExpirationMinutes`. |
| **Employee Preference** | A per-user key-value setting stored in `EMP_EmployeePreferences`. Currently used to persist the date-format toggle (`PreferenceName = "DatePreference"`). |
| **EMPI** (Enterprise Master Patient Index) | 16-character unique patient ID generated by `CommonController.CreateEmpi`: 3-char district prefix + 6-char DOB (DDMMYY) + 3-char name initials (FML, with `X` for missing middle) + 4-digit random. |
| **Master Data Cache** | A read-through in-process cache of the twelve most-frequently-read lookup tables, registered as `DanpheCache` singleton. |
| **Dynamic Template (legacy)** | A tree of `Template → Questionnaire → Question → Option` used for psychiatric assessment and similar survey screens. Stored across `CORE_DYNTMP_Template`, `CORE_DYNTMP_Questionnaire`, `CORE_DYNTMP_Question`, `CORE_DYNTMP_Option`. Supports 3-level question hierarchy. |
| **Dynamic Template v2** | A flat 4-table model: `TemplateType` (category), `FieldMaster` (field definitions), `Template` (concrete template with HTML body), `TemplateFieldMapping` (per-template field rendering config). Supports per-template `PrintContentHTML` and field-level `IsMandatory` / `IsCompulsoryField` / `EnterSequence`. |
| **EMPI Random Range** | 1000–9999 inclusive (4-digit random suffix). |

### MasterDataEnum — Cache Catalog

| Enum | Cache Key | TTL | Source Table | Used By |
|------|-----------|-----|--------------|---------|
| `Department` | `master-departments` | `cacheExpiryMinutes` | `MST_Department` | Master, Scheduling, Incentive, Billing, Admission |
| `ICD10` | `master-icd10` (note: original code never writes here) | `cacheExpiryMinutes` | `MST_ICD10` | Admission, Master |
| `ServiceDepartment` | `master-servicedepartment` | `cacheExpiryMinutes` | `BIL_MST_ServiceDepartment` | Master, Billing |
| `Employee` | `master-employee` | `cacheExpiryMinutes` | `EMP_Employee` | Master, Billing, Scheduling, Radiology, Incentive, Insurance, Admission |
| `Medicine` | `master-medicines` | `cacheExpiryMinutes` | `PHRM_MST_Item` | Master, Pharmacy |
| `Reaction` | `master-reaction` | `cacheExpiryMinutes` | `MST_Reactions` | Master, Clinical |
| `ImagingItems` | `master-imagingitem` | `cacheExpiryMinutes` | `RAD_MST_ImagingItem` | Master, Radiology |
| `Taxes` | `master-taxes` | `cacheExpiryMinutes` | `MST_Tax` | Master, Billing |
| `PastUniqueData` | `past-unique-data` | 24 hours | `PAT_Patient` | Master (autocomplete) |
| `LabRunNumberSettings` | `lab-runnumber-settings` | 20 minutes | `Lab_MST_RunNumberSettings` | Lab |
| `PriceCategory` | `master-pricecategory` | `cacheExpiryMinutes` | `BIL_CFG_PriceCategory` | Master, Billing |
| `AccountingCodes` | `master-accounting-codes` | `cacheExpiryMinutes` | `ACC_MST_CodeDetails` join `ACC_MST_Hospital` (active) | Accounting |

### Request-Response Envelope

Every controller derived from `CommonController` returns responses through `DanpheHTTPResponse<T>`:

```
{
  "Status": "OK" | "Failed",
  "ErrorMessage": string,
  "Results": T
}
```

`Status` uses `ENUM_Danphe_HTTP_ResponseStatus` (string enum with values `OK` and `Failed`). The `InvokeHttpGetFunction` / `InvokeHttpPostFunction` / `InvokeHttpPutFunction` helpers in `CommonController` are responsible for the try/catch + envelope wrapping; controllers only pass a `Func<object>` and the helper takes care of status mapping and serialization.

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers (Core)

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `CoreController.cs` | `Websites/DanpheEMR/Controllers/Core/CoreController.cs` | `api/Core` — Lookups (`inputValue` filter), AppSettings (limited `MyConfiguration`), EmployeeDatePreference (GET + POST). Decorated with `[RequestFormSizeLimit(valueCountLimit: 100000, Order = 1)]`. Inherits from `CommonController`. | 291 |
| `ParametersController.cs` | `Websites/DanpheEMR/Controllers/Core/ParametersController.cs` | `api/Parameters` — read all parameters (GET), update `BILL.TaxInfo` only (PUT `reqType=bill-tax`). Inherits from `CommonController`. | 116 |
| `DynTemplatesController.cs` | `Websites/DanpheEMR/Controllers/Core/DynTemplatesController.cs` | `api/DynTemplates` — legacy dynamic-template CRUD: `getSurveyTemplate`, `addQuestion`, `addQnair`, `updateQnairs`, `updateQtn` (uses RefactorThis.GraphDiff for owned collection). 3-level question hierarchy with `ConfigureTemplate()` filter. | 368 |
| `DynamicTemplateController.cs` | `Websites/DanpheEMR/Controllers/Core/DynamicTemplateController.cs` | `api/DynamicTemplate/*` — modern template engine: TemplateTypes, Templates, TemplateFields, FieldMaster, GetSelectedTemplateData, GetFieldMasterByTemplateId, ActivateDeactivate, UpdateDynamicTemplate, AddNewTemplate, AddUpdateFieldMapping. Delegates all logic to `IDynamicTemplateService`. | 128 |

### 2.2 Common Infrastructure (lives in `Websites/DanpheEMR/Utilities/` and `Websites/DanpheEMR/Controllers/`)

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `CommonController.cs` | `Websites/DanpheEMR/Utilities/CommonController.cs` | Base class for all API controllers. Owns `connString` / `connStringAdmin` / `connStringPACSServer` / `IsAuditEnabled`. Decorated with `[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]`, `[DanpheDataFilter()]`, `[Route("api/[controller]")]`. Provides `ReadQueryStringData`, `ReadPostData`, `ReadFiles`, `ToInt`, `ToBool`, `ToInt64`, `AddAuditField`, `CreateEmpi`, and the full family of `InvokeHttp*Function<T>` helpers (sync + async, GET / POST / PUT, single-transaction-scope variants). | 257 |
| `DanpheActionFilter.cs` | `Websites/DanpheEMR/Controllers/DanpheActionFilter.cs` | Three attributes: `RequestFormSizeLimitAttribute` (raises form limits, implements `IAuthorizationFilter` + `IOrderedFilter`), `DanpheViewFilter : ActionFilterAttribute` (MVC page-level RBAC — checks `PermissionName` against `validpermissionlist` session variable, redirects to `Account/PageNotFound`), `DanpheDataFilter : ActionFilterAttribute` (API-level JWT bearer auth — decodes the `Authorization` header, extracts the `currentUser` claim, populates `HttpContext.Session`, returns JSON 401-style response on failure). Also handles the Dicom listener special case (POST `/api/Dicom` with body-embedded user). | 230 |

### 2.3 Library Project (Components/DanpheEMR.Core/)

| File / Folder | Path | Purpose |
|--------------|------|---------|
| `CoreDbContext.cs` | `Components/DanpheEMR.Core/CoreDbContext.cs` | `AuditDbContext` subclass. 30+ `DbSet<>` registrations, `OnModelCreating` maps every entity to its table. |
| `Caching.cs` | `Components/DanpheEMR.Core/Caching.cs` | `DanpheCache` static class wrapping `MemoryCache.Default`. `MasterDataEnum` defines 12 cache slots. `GetMasterData(MasterDataEnum)` is the read-through entry point. |
| `Parameters/ParameterModel.cs` | `Components/DanpheEMR.Core/Parameters/ParameterModel.cs` | Parameter entity. |
| `Lookups/LookupsModel.cs` | `Components/DanpheEMR.Core/Lookups/LookupsModel.cs` | Lookup entity. |
| `DynTemplates/Template.cs` | `Components/DanpheEMR.Core/DynTemplates/Template.cs` | Legacy template entity. |
| `DynTemplates/Questionnaire.cs` | `Components/DanpheEMR.Core/DynTemplates/Questionnaire.cs` | Legacy questionnaire entity. |
| `DynTemplates/Question.cs` | `Components/DanpheEMR.Core/DynTemplates/Question.cs` | Legacy question entity with self-referencing `ParentQtnId`. |
| `DynTemplates/Option.cs` | `Components/DanpheEMR.Core/DynTemplates/Option.cs` | Legacy option entity. |
| `DynamicTemplate/TemplateTypeModel.cs` | `Components/DanpheEMR.Core/DynamicTemplate/TemplateTypeModel.cs` | Modern template-type entity. |
| `DynamicTemplate/FieldMasterModel.cs` | `Components/DanpheEMR.Core/DynamicTemplate/FieldMasterModel.cs` | Modern field-master entity. |
| `DynamicTemplate/TemplateModel.cs` | `Components/DanpheEMR.Core/DynamicTemplate/TemplateModel.cs` | Modern template entity with `PrintContentHTML`. |
| `DynamicTemplate/TemplateFieldMappingModel.cs` | `Components/DanpheEMR.Core/DynamicTemplate/TemplateFieldMappingModel.cs` | Modern template-field mapping entity. |

### 2.4 Services (Websites/DanpheEMR/Services/DynamicTemplates/)

| File | Path | Purpose |
|------|------|---------|
| `IDynamicTemplateService.cs` | `Services/DynamicTemplates/IDynamicTemplateService.cs` | Interface for the modern dynamic-template service. |
| `DynamicTemplateService.cs` | `Services/DynamicTemplates/DynamicTemplateService.cs` | Implementation. Registered as `AddTransient` in `DependencyInjection/DanpheServicesExtensions.cs:75`. |
| `DTO/TemplateType_DTO.cs` | `Services/DynamicTemplates/DTO/TemplateType_DTO.cs` | TemplateType DTO returned to SPA. |
| `DTO/Template_DTO.cs` | `Services/DynamicTemplates/DTO/Template_DTO.cs` | Template DTO. |
| `DTO/FieldMaster_DTO.cs` | `Services/DynamicTemplates/DTO/FieldMaster_DTO.cs` | FieldMaster DTO. |
| `DTO/TemplateField_DTO.cs` | `Services/DynamicTemplates/DTO/TemplateField_DTO.cs` | TemplateField DTO. |
| `DTO/FieldMappings_DTO.cs` | `Services/DynamicTemplates/DTO/FieldMappings_DTO.cs` | FieldMappings DTO used by AddUpdateFieldMapping. |
| `DTO/HtmlContent_DTO.cs` | `Services/DynamicTemplates/DTO/HtmlContent_DTO.cs` | PrintContentHTML DTO. |

---

## 3. Data Models

### 3.1 ParameterModel (`CORE_CFG_Parameters`)

`Components/DanpheEMR.Core/Parameters/ParameterModel.cs:12`

| Property | Type | Notes |
|----------|------|-------|
| `ParameterId` | `int` | PK, identity. |
| `ParameterGroupName` | `string` | Grouping key (e.g. `"Common"`, `"BILL"`, `"Appointment"`, `"Inventory"`, `"Pharmacy"`, `"Patient"`, `"Procurement"`, `"Reg-Sticker"`, `"BillingReport"`, `"Clinical"`, `"Vaccination"`, `"WardSupply"`, `"SSU"`, `"SchemeRefund"`). |
| `ParameterName` | `string` | Setting key within the group. |
| `ParameterValue` | `string` | Raw string. Often a JSON blob (e.g. receipt header HTML, custom-field configuration). |
| `ValueDataType` | `string` | `"string"`, `"boolean"`, `"JSON"`, etc. (informational). |
| `Description` | `string` | Free-text description. |

**Resolution pattern (Angular side)**: `this.coreService.Parameters.find(p => p.ParameterGroupName === "Common" && p.ParameterName === "EnableEnglishCalendarOnly")`. The full table is loaded once at app boot by `CoreService.InitializeParameters()` and cached in memory.

**Common parameter groups** (observed in source):

| Group | Example parameters |
|-------|-------------------|
| `Common` | `DefaultCountry`, `NepaliReceipt`, `BillingHeader`, `Pharmacy Receipt Header`, `Inventory Receipt Header`, `CalendarTypes`, `EnableEnglishCalendarOnly`, `StickerPrinterSettings`, `CustomerHeader`, `MaximumLastVisitDays`, `ServerSideSearchComponent`, `ServerSideSearchCharLength`, `ShowTimeOptionInFromToDatePicker` |
| `BILL` | `TaxInfo` (only writable via `ParametersController.PUT reqType=bill-tax`) |
| `Appointment` | `RoomNumberInSticker`, `VisitPrintSettings`, `EnableTicketPriceInVisit` |
| `Patient` | `Municipality`, `ImmunizationDeptName` |
| `Inventory` | `ManageStockButton`, `EnableReceivedItemInSubstore`, `SigningPanelConfiguration`, `InventoryFiledCustomization` |
| `Pharmacy` | `SubStoreRequisitionVerificationSetting` |
| `Procurement` | `GRFormCustomization` |
| `BillingReport` | `BillingReportPrintSetting`, `BillingReportGridExportToExcelSetting` |
| `SchemeRefund` | `SchemeWiseFixedAmount` |
| `WardSupply` | (per-ward-supply module configuration) |

### 3.2 LookupsModel (`CORE_CFG_LookUps`)

`Components/DanpheEMR.Core/Lookups/LookupsModel.cs:10`

| Property | Type | Notes |
|----------|------|-------|
| `LookupId` | `int` | PK, identity. |
| `ModuleName` | `string` | The owning module (e.g. `"Lab"`, `"Radiology"`, `"Billing"`). Filterable from the API via `?inputValue=`. |
| `LookupName` | `string` | Logical name of the lookup. |
| `LookupDataJson` | `string` | Raw JSON payload. |
| `Description` | `string` | Free-text. |

The Angular SPA exposes this through `CoreService.GetLookups(moduleName)` (declared in `wwwroot/DanpheApp/src/app/core/shared/core.service.ts:142`) and `CoreDLService.GetLookups(moduleName)` (declared in `core.dl.service.ts:34`) which calls `GET /api/Core/Lookups?inputValue=<moduleName>`.

### 3.3 Legacy Dynamic-Template Models (`CORE_DYNTMP_*`)

#### Template (`CORE_DYNTMP_Template`)

`Components/DanpheEMR.Core/DynTemplates/Template.cs:10`

| Property | Type | Notes |
|----------|------|-------|
| `TemplateId` | `int` | PK. |
| `Code` | `string` | Stable identifier (e.g. `"PsychiatricIntake"`). |
| `Text` | `string` | Display name. |
| `ModuleName` | `string` | Owning module. |
| `Qnairs` | `List<Questionnaire>` | Navigation — child questionnaires. Lazy-loaded. |

#### Questionnaire (`CORE_DYNTMP_Questionnaire`)

`Components/DanpheEMR.Core/DynTemplates/Questionnaire.cs:10`

| Property | Type | Notes |
|----------|------|-------|
| `QnairId` | `int` | PK. |
| `Text` | `string` | Section title. |
| `TemplateId` | `int` | FK. |
| `DisplaySeq` | `int?` | Sort order within template. |
| `ChildQuestions` | `List<Question>` | Root-level questions (`ParentQtnId IS NULL`). |
| `Template` | `Template` | Navigation. |

#### Question (`CORE_DYNTMP_Question`)

`Components/DanpheEMR.Core/DynTemplates/Question.cs:11`

| Property | Type | Notes |
|----------|------|-------|
| `QuestionId` | `int` | PK. |
| `TemplateId` | `int` | FK. |
| `QnairId` | `int` | FK. |
| `Text` | `string` | Question prompt. |
| `Type` | `string` | `"single-select"`, `"multi-select"`, `"text"`, `"number"`, etc. |
| `ParentQtn` | `Question` | Navigation to parent (self-referencing). |
| `ParentQtnId` | `int?` | FK to self. `NULL` = root level. |
| `DisplaySeq` | `int?` | Sort order. |
| `ChildQuestions` | `List<Question>` | Navigation to children. |
| `QtnHRCLevel` | `int` | `[NotMapped]`. Computed by `ConfigureTemplate()`. 0 / 1 / 2 for the 3 levels. |
| `ShowChilds` | `bool?` | `[NotMapped]`. UI flag. |
| `ChildQtnAlignment` | `string` | `[NotMapped]`. `"vertical"` / `"horizontal"`. |
| `SelectedAnswer` | `string` | `[NotMapped]`. Runtime answer. |
| `Options` | `List<Option>` | Navigation. |

#### Option (`CORE_DYNTMP_Option`)

`Components/DanpheEMR.Core/DynTemplates/Option.cs:8`

| Property | Type | Notes |
|----------|------|-------|
| `OptionId` | `int` | PK. |
| `Text` | `string` | Option label. |
| `QuestionId` | `int` | FK. |
| `IsDefault` | `bool` | Pre-selected by default. |
| `IsSelected` | `bool` | `[NotMapped]`. Runtime state. |
| `ShowChildOnSelect` | `bool` | Whether picking this option reveals child questions. |
| `EntityState` | `string` | `[NotMapped]`. Default `"unchanged"`. Used for GraphDiff tracking. |
| `IsActive` | `bool` | Soft delete — when `false` the option is hidden in `view` / `fill` mode but visible in `edit` mode. |

### 3.4 Modern Dynamic-Template Models

#### TemplateTypeModel (`DYNTMP_MST_TemplateType`)

`Components/DanpheEMR.Core/DynamicTemplate/TemplateTypeModel.cs:10`

| Property | Type | Notes |
|----------|------|-------|
| `TemplateTypeId` | `int` | PK. |
| `TemplateTypeCode` | `string` | Short code. |
| `TemplateTypeName` | `string` | Human-readable category name. |
| `Description` | `string` | Free-text. |
| `CreatedBy` / `CreatedOn` | `int` / `DateTime` | Audit. |
| `ModifiedBy` / `ModifiedOn` | `int?` / `DateTime?` | Audit. |
| `IsActive` | `bool` | Soft delete. |

#### FieldMasterModel (`DYNTMP_MST_FieldMaster`)

`Components/DanpheEMR.Core/DynamicTemplate/FieldMasterModel.cs:10`

| Property | Type | Notes |
|----------|------|-------|
| `FieldMasterId` | `int` | PK. |
| `TemplateTypeId` | `int` | FK to `TemplateType`. |
| `FieldName` | `string` | The field identifier. |
| `Description` | `string` | Free-text. |
| `IsActive` | `bool` | Soft delete. |
| `CreatedBy` / `CreatedOn` | `int` / `DateTime` | Audit. |
| `ModifiedBy` / `ModifiedOn` | `int?` / `DateTime?` | Audit. |
| `IsCompulsoryField` | `bool` | If true, this field is required on every template of this type — overrides per-template `IsMandatory = false`. |

#### TemplateModel (`DYNTEMP_CFG_Template`)

`Components/DanpheEMR.Core/DynamicTemplate/TemplateModel.cs:10`

| Property | Type | Notes |
|----------|------|-------|
| `TemplateId` | `int` | PK. |
| `TemplateTypeId` | `int` | FK to `TemplateType`. |
| `TemplateCode` | `string` | Short code. |
| `TemplateName` | `string` | Human-readable name. |
| `Description` | `string` | Free-text. |
| `PrintContentHTML` | `string` | The HTML body used when this template is printed. May contain placeholders that the SPA substitutes. |
| `IsDefaultForThisType` | `bool` | Marks this template as the default choice when the user creates a new artefact of this type. |
| `CreatedBy` / `CreatedOn` | `int` / `DateTime` | Audit. |
| `ModifiedBy` / `ModifiedOn` | `int?` / `DateTime?` | Audit. |
| `IsActive` | `bool` | Soft delete — toggled by `ActivateDeactivate` endpoint. |

#### TemplateFieldMappingModel (`DYNTMP_MAP_TemplateFieldMapping`)

`Components/DanpheEMR.Core/DynamicTemplate/TemplateFieldMappingModel.cs:10`

| Property | Type | Notes |
|----------|------|-------|
| `TemplateFieldMapId` | `int` | PK. |
| `TemplateId` | `int` | FK. |
| `FieldMasterId` | `int` | FK. |
| `DisplayLabel` | `string` | UI label override (vs `FieldMaster.FieldName`). |
| `IsMandatory` | `bool` | Per-template override. `FieldMaster.IsCompulsoryField = true` forces mandatory regardless. |
| `EnterSequence` | `int?` | Tab order. |
| `CreatedBy` / `CreatedOn` | `int` / `DateTime` | Audit. |
| `ModifiedBy` / `ModifiedOn` | `int?` / `DateTime?` | Audit. |
| `IsActive` | `bool` | Soft delete. |

### 3.5 CommonController Created Models

`Utilities/CommonController.cs` produces two notable derived artefacts:

- **EMPI** (Enterprise Master Patient Index) — 16-char string, format `[district3][DOB6][FML3][random4]`. Example: `KAI011290KPO8972`. The `district3` prefix is the first 3 characters of the patient's `CountrySubDivisionName`. `MiddleName` is replaced by `X` when missing. The random suffix is `(new Random()).Next(1000, 10000)`.
- **Audit custom fields** — `ChangedByUserId` and `ChangedByUserName` are pushed into the EF `AuditDbContext` audit log when `IsAuditEnabled = true`.

---

## 4. Database Tables

All Core-module tables live in the EMR database (not the Admin database). EF mappings are declared in `Components/DanpheEMR.Core/CoreDbContext.cs:61`.

### 4.1 `CORE_CFG_Parameters`

Per `OnModelCreating` line 63 — stores all `ParameterModel` rows.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `ParameterId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `ParameterGroupName` | `NVARCHAR(100) NOT NULL` | Indexed in practice. |
| `ParameterName` | `NVARCHAR(200) NOT NULL` | |
| `ParameterValue` | `NVARCHAR(MAX) NULL` | JSON, plain string, or number-as-string. |
| `ValueDataType` | `NVARCHAR(50) NULL` | Informational. |
| `Description` | `NVARCHAR(500) NULL` | |

### 4.2 `CORE_CFG_LookUps`

Per `OnModelCreating` line 64.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `LookupId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `ModuleName` | `NVARCHAR(100) NOT NULL` | Indexed. |
| `LookupName` | `NVARCHAR(200) NOT NULL` | |
| `LookupDataJson` | `NVARCHAR(MAX) NULL` | JSON payload. |
| `Description` | `NVARCHAR(500) NULL` | |

### 4.3 `CORE_DYNTMP_Template`

Per `OnModelCreating` line 90.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `TemplateId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `Code` | `NVARCHAR(100) NOT NULL` | Indexed; e.g. `"PsychiatricIntake"`. |
| `Text` | `NVARCHAR(500) NULL` | Display name. |
| `ModuleName` | `NVARCHAR(100) NULL` | |

### 4.4 `CORE_DYNTMP_Questionnaire`

Per `OnModelCreating` line 91.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `QnairId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `Text` | `NVARCHAR(500) NULL` | |
| `TemplateId` | `INT NOT NULL` | FK → `CORE_DYNTMP_Template.TemplateId`. |
| `DisplaySeq` | `INT NULL` | |

### 4.5 `CORE_DYNTMP_Question`

Per `OnModelCreating` line 92.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `QuestionId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `TemplateId` | `INT NOT NULL` | FK. |
| `QnairId` | `INT NOT NULL` | FK. |
| `Text` | `NVARCHAR(MAX) NULL` | |
| `Type` | `NVARCHAR(50) NULL` | `"single-select"` / `"multi-select"` / `"text"` / `"number"`. |
| `ParentQtnId` | `INT NULL` | Self-FK. `NULL` = root. |
| `DisplaySeq` | `INT NULL` | |

### 4.6 `CORE_DYNTMP_Option`

Per `OnModelCreating` line 93.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `OptionId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `Text` | `NVARCHAR(500) NULL` | |
| `QuestionId` | `INT NOT NULL` | FK. |
| `IsDefault` | `BIT NOT NULL DEFAULT 0` | |
| `ShowChildOnSelect` | `BIT NOT NULL DEFAULT 0` | |
| `IsActive` | `BIT NOT NULL DEFAULT 1` | Soft delete. |

### 4.7 `DYNTMP_MST_TemplateType`

Per `OnModelCreating` line 99.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `TemplateTypeId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `TemplateTypeCode` | `NVARCHAR(50) NOT NULL` | |
| `TemplateTypeName` | `NVARCHAR(100) NOT NULL` | |
| `Description` | `NVARCHAR(500) NULL` | |
| `CreatedBy` | `INT NOT NULL` | |
| `CreatedOn` | `DATETIME NOT NULL` | |
| `ModifiedBy` | `INT NULL` | |
| `ModifiedOn` | `DATETIME NULL` | |
| `IsActive` | `BIT NOT NULL DEFAULT 1` | |

### 4.8 `DYNTMP_MST_FieldMaster`

Per `OnModelCreating` line 100.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `FieldMasterId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `TemplateTypeId` | `INT NOT NULL` | FK. |
| `FieldName` | `NVARCHAR(100) NOT NULL` | |
| `Description` | `NVARCHAR(500) NULL` | |
| `IsActive` | `BIT NOT NULL DEFAULT 1` | |
| `CreatedBy` | `INT NOT NULL` | |
| `CreatedOn` | `DATETIME NOT NULL` | |
| `ModifiedBy` | `INT NULL` | |
| `ModifiedOn` | `DATETIME NULL` | |
| `IsCompulsoryField` | `BIT NOT NULL DEFAULT 0` | |

### 4.9 `DYNTEMP_CFG_Template`

Per `OnModelCreating` line 101.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `TemplateId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `TemplateTypeId` | `INT NOT NULL` | FK. |
| `TemplateCode` | `NVARCHAR(50) NULL` | |
| `TemplateName` | `NVARCHAR(200) NOT NULL` | |
| `Description` | `NVARCHAR(500) NULL` | |
| `PrintContentHTML` | `NVARCHAR(MAX) NULL` | Print body. |
| `IsDefaultForThisType` | `BIT NOT NULL DEFAULT 0` | |
| `CreatedBy` | `INT NOT NULL` | |
| `CreatedOn` | `DATETIME NOT NULL` | |
| `ModifiedBy` | `INT NULL` | |
| `ModifiedOn` | `DATETIME NULL` | |
| `IsActive` | `BIT NOT NULL DEFAULT 1` | |

### 4.10 `DYNTMP_MAP_TemplateFieldMapping`

Per `OnModelCreating` line 102.

| Column | SQL Type | Notes |
|--------|----------|-------|
| `TemplateFieldMapId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `TemplateId` | `INT NOT NULL` | FK. |
| `FieldMasterId` | `INT NOT NULL` | FK. |
| `DisplayLabel` | `NVARCHAR(200) NULL` | |
| `IsMandatory` | `BIT NOT NULL DEFAULT 0` | |
| `EnterSequence` | `INT NULL` | |
| `CreatedBy` | `INT NOT NULL` | |
| `CreatedOn` | `DATETIME NOT NULL` | |
| `ModifiedBy` | `INT NULL` | |
| `ModifiedOn` | `DATETIME NULL` | |
| `IsActive` | `BIT NOT NULL DEFAULT 1` | |

### 4.11 `EMP_EmployeePreferences`

Mapped to `EMP_EmployeePreferences` per `OnModelCreating` line 85. Owned by the Employee module schema, but read/written by `CoreController.EmployeeDatePreference`. Columns:

| Column | SQL Type | Notes |
|--------|----------|-------|
| `EmployeePreferenceId` | `INT IDENTITY(1,1) PRIMARY KEY` | |
| `EmployeeId` | `INT NOT NULL` | FK → `EMP_Employee`. |
| `PreferenceName` | `NVARCHAR(100) NOT NULL` | Currently only `"DatePreference"`. |
| `PreferenceValue` | `NVARCHAR(MAX) NULL` | String or JSON. |
| `IsActive` | `BIT NOT NULL DEFAULT 1` | |
| `CreatedBy` / `CreatedOn` | `INT` / `DATETIME` | |
| `ModifiedBy` / `ModifiedOn` | `INT NULL` / `DATETIME NULL` | |

### 4.12 Stored Procedures

| SP | Purpose | Used By |
|----|---------|---------|
| `SP_DYNTMP_GetFieldMappingByTemplateId` | Returns field mappings for a given template id (consumed by `GetFieldMasterByTemplateId`). | `DynamicTemplateService.GetFieldMasterByTemplateId` |

---

## 5. Key Workflows

### 5.1 Read-Through Master-Data Cache (most common Core workflow)

Triggered by any of the 75+ `DanpheCache.GetMasterData(MasterDataEnum.X)` call sites in 13+ controllers. Pattern:

1. Controller calls `DanpheCache.GetMasterData(MasterDataEnum.Department)` (or any other enum value).
2. `Caching.cs:83` enters a switch on the enum.
3. The cache slot key (e.g. `"master-departments"`) is read from `MemoryCache.Default` via `DanpheCache.Get(key)`.
4. **Cache hit**: return value immediately.
5. **Cache miss**: instantiate `CoreDbContext`, run the LINQ query (`coreDbContext.Departments.OrderBy(a => a.DepartmentName).ToList()`), add to cache with `DanpheCache.Add(key, value, DateTime.Now.AddMinutes(cacheExpiryMinutes))`, return.
6. Subsequent calls within the TTL window skip the database entirely.

**Invalidation**: There is no explicit invalidation. Cached entries expire after the configured TTL. The only soft-invalidation is the read-through pattern — a `PUT` that updates the underlying table does not clear the cache; it will be visible after the TTL expires. This is a known limitation, see §8 Business Rules.

**Special cases**:
- `LabRunNumberSettings` uses a hardcoded 20-minute TTL.
- `PastUniqueData` uses a hardcoded 24-hour TTL (refreshes daily).
- `ICD10` has a bug — the original code reads from cache but never populates it. The `if (returnValue == null)` check is placed *after* the second `coreDbContext.ICD10Codes.ToList()` call, so the result is never null on first call. The cache is therefore not effective for ICD-10.

### 5.2 Parameter Resolution (most common SPA workflow)

Triggered when the Angular SPA needs a configuration value:

1. SPA boot calls `CoreService.InitializeParameters()` which issues `GET /api/Parameters`.
2. `ParametersController.Get` returns the full `List<ParameterModel>` from `coreDbContext.Parameters.ToList()`.
3. `CoreService` caches the array in `this.Parameters` (a public field).
4. Feature code resolves values: `this.coreService.Parameters.find(p => p.ParameterGroupName === "Common" && p.ParameterName === "EnableEnglishCalendarOnly")?.ParameterValue`.
5. Updates are made through `ParametersController.PUT reqType=bill-tax`, which currently supports **only** updating `ParameterGroupName = "BILL" AND ParameterName = "TaxInfo"`. All other parameters are effectively read-only at runtime.

### 5.3 Employee Date Preference (per-user toggle)

Used by the SPA's English/Nepali date-format toggle:

1. **Read**: `GET /api/Core/EmployeeDatePreference` → looks up `EMP_EmployeePreferences` by `EmployeeId = currentUser.EmployeeId AND PreferenceName = "DatePreference"`. Returns the row or `null`.
2. **Write**: `POST /api/Core/EmployeeDatePreference` with body `ipDataStr` (the new value as a string). The handler:
   - Looks up the existing row.
   - If not found: inserts a new row with `CreatedOn = DateTime.Now`, `CreatedBy = currentUser.EmployeeId`, `IsActive = true`.
   - If found: updates `PreferenceValue`, `ModifiedBy`, `ModifiedOn`. Uses explicit `Property(x => ...).IsModified = true` for `CreatedOn`, `CreatedBy`, `PreferenceValue` to preserve untouched audit columns.
3. The read uses `CoreDbContext`; the write uses `AdmissionDbContext` (`EMP_EmployeePreferences` lives in the Admission schema per the EF mapping).

### 5.4 Lookups Fetch (module-keyed JSON)

1. SPA calls `CoreDLService.GetLookups(moduleName)` (e.g. `moduleName = "Lab"`).
2. Issues `GET /api/Core/Lookups?inputValue=Lab`.
3. `CoreController.GetLookups` reads all lookups from `coreDbContext.LookUps.ToList()`, then filters by `ModuleName == inputValue` (case-insensitive).
4. If `inputValue` is empty, returns all lookups.
5. `CoreService` groups the response by `ModuleName` and exposes a `LookUps` array; helper method `GetLookupsByGroupName(moduleName)` filters in-memory.

### 5.5 Dynamic-Template v2 Authoring Workflow

1. **Author Template Type** — POST nothing directly; the type is created in DB out-of-band. `GET /api/DynamicTemplate/TemplateTypes` returns all.
2. **Author Field Master** — out-of-band, but read via `GET /api/DynamicTemplate/FieldMaster?templateTypeId={id}`.
3. **Create Template** — `POST /api/DynamicTemplate/AddNewTemplate` with body:
   ```json
   {
     "TemplateTypeId": 1,
     "TemplateCode": "DISCHARGE-001",
     "TemplateName": "Standard Discharge Summary",
     "Description": "...",
     "PrintContentHTML": "<h1>{{PatientName}}</h1>...",
     "IsDefaultForThisType": true,
     "IsActive": true
   }
   ```
   Server populates `CreatedBy = currentUser.EmployeeId`, `CreatedOn = DateTime.Now`.
4. **Map Fields to Template** — `POST /api/DynamicTemplate/AddUpdateFieldMapping` with a list of `FieldMappings_DTO`. For each entry the service:
   - Loads existing mappings matching `(TemplateId, FieldMasterId)`.
   - Creates new or updates existing (sets `ModifiedBy` / `ModifiedOn`).
   - Single `SaveChanges()` at the end.
5. **Activate / Deactivate** — `PUT /api/DynamicTemplate/ActivateDeactivate?templateId={id}` flips `IsActive`.
6. **Print** — `GET /api/DynamicTemplate/TemplatePrintHtml?templateId={id}` returns the raw `PrintContentHTML`. SPA substitutes placeholders client-side.
7. **Field resolution at runtime** — `GET /api/DynamicTemplate/TemplateFields?templateId={id}` returns active mapped fields, with `IsMandatory` and `IsActive` ORed against `FieldMaster.IsCompulsoryField`. Result: a field is mandatory if either the template mapping OR the field master says so, and is active if either is active.

### 5.6 Legacy Dynamic-Template Workflow (`DynTemplatesController`)

Used for psychiatric intake and similar survey screens. The 3-level question hierarchy is enforced by the controller's `ConfigureTemplate` method:

1. `GET /api/DynTemplates?reqType=getSurveyTemplate&templateCode=PSYCHIATRIC&renderMode=view` loads the template with `.Include("Qnairs.ChildQuestions.Options")` then runs `ConfigureTemplate(template, renderMode)`.
2. `ConfigureTemplate` (Caching.cs equivalent `DynTemplatesController.cs:314`):
   - Walks `template.Qnairs`.
   - For each questionnaire, removes all child questions where `ParentQtnId != null AND != 0` (i.e. keeps only root-level questions).
   - For each root question (`_Lvl0`): removes inactive options unless `renderMode == "edit"`.
   - For each level-1 child (`_Lvl1`): sets `QtnHRCLevel = 1`, removes inactive options unless `renderMode == "edit"`.
   - For each level-2 grandchild (`_Lvl2`): sets `QtnHRCLevel = 2`, removes inactive options unless `renderMode == "edit"`.
   - Maximum 3 levels.
3. `POST /api/DynTemplates?reqType=addQuestion` adds a new question.
4. `POST /api/DynTemplates?reqType=addQnair` adds a new questionnaire and returns the assigned `QnairId`.
5. `PUT /api/DynTemplates?reqType=updateQnairs` renames questionnaires and updates `DisplaySeq`. Sets `ChildQuestions = null` on each to avoid re-adding children.
6. `PUT /api/DynTemplates?reqType=updateQtn` updates a question and its options using `RefactorThis.GraphDiff.UpdateGraph(qtn, map => map.OwnedCollection(a => a.Options))` — owned collection pattern ensures deleted options are removed, new options are inserted, and existing options are updated atomically.

### 5.7 Application Settings Bootstrap

Called by the SPA at app boot:

1. `GET /api/Core/AppSettings` returns a sanitised `MyConfiguration`:
   - `ApplicationVersionNum` (string)
   - `highlightAbnormalLabResult` (bool)
   - `CacheExpirationMinutes` (int)
2. Connection strings, file paths, and PACS credentials are explicitly NOT returned — the controller builds a fresh `MyConfiguration` instance and copies only these three properties.
3. SPA uses the values to configure initial UI state (e.g. which abnormal-lab color to apply, which version banner to show).

### 5.8 JWT Authentication Pipeline (`DanpheDataFilter`)

Applied to every API controller derived from `CommonController` (which is essentially all of them, since `[DanpheDataFilter()]` is on the base class):

1. Request enters the action filter's `OnActionExecuting`.
2. Special case: if the path is `POST /api/Dicom`, the body is read as a string, the `currentuser` JSON field is parsed, and `RBAC.IsValidUser(username, password)` is used for validation. This is the DICOM listener integration.
3. Standard case: the `Authorization` header is read and stripped of its `Bearer ` prefix.
4. The JWT is parsed by `JwtSecurityTokenHandler.ReadJwtToken`.
5. The `ENUM_ClaimTypes.currentUser` claim is extracted and deserialized into an `RbacUser` object.
6. If the claim is missing or invalid, returns `JsonResult(new DanpheHTTPResponse<object> { Status = "Failed", ErrorMessage = "Unauthorized Access", Results = "" })`.
7. The `currentUser` is set on `HttpContext.Session` so downstream filters and controllers can use `HttpContext.Session.Get<RbacUser>("currentuser")`.

### 5.9 MVC View RBAC (`DanpheViewFilter`)

Applied to MVC view actions (e.g. `SettingsViewController`, `AdmissionViewController`):

1. Request enters the action filter.
2. Reads `currentuser` and `validpermissionlist` from session.
3. Looks up the `PermissionName` (constructor arg) in `validpermissionlist`.
4. If not found, redirects to `Account/PageNotFound`.
5. Unlike the data filter, the view filter *does* perform per-permission RBAC; the data filter only checks authentication.

---

## 6. API Endpoints

All endpoints are under `/api/`. All return `DanpheHTTPResponse<T>` envelopes.

### 6.1 `/api/Core/*` (`CoreController`)

| # | Method | Route | Handler | Purpose |
|---|--------|-------|---------|---------|
| 1 | `GET` | `/api/Core/Lookups?inputValue={moduleName}` | `GetLookups` | Returns all `CORE_CFG_LookUps` rows where `ModuleName == inputValue`. If `inputValue` empty, returns all. Case-insensitive match. |
| 2 | `GET` | `/api/Core/AppSettings` | `GetAppSettings` | Returns sanitised `MyConfiguration`: `ApplicationVersionNum`, `highlightAbnormalLabResult`, `CacheExpirationMinutes`. |
| 3 | `GET` | `/api/Core/EmployeeDatePreference` | `GetEmployeeDatePreference` | Returns the current user's `DatePreference` row from `EMP_EmployeePreferences`, or `null` if not set. |
| 4 | `POST` | `/api/Core/EmployeeDatePreference` | `EmployeeDatePreference` | Sets the current user's `DatePreference` value. Body is a raw string. Insert if missing, update if present. |

### 6.2 `/api/Parameters/*` (`ParametersController`)

| # | Method | Route | Handler | Purpose |
|---|--------|-------|---------|---------|
| 5 | `GET` | `/api/Parameters?paramGroup=&paramName=` | `Get` | Currently always returns the full `List<ParameterModel>`. The `paramGroup` / `paramName` query params are accepted but ignored. |
| 6 | `PUT` | `/api/Parameters?reqType=bill-tax` | `Put` | Updates `ParameterValue` for the `BILL.TaxInfo` parameter. Body is the new value as a raw string. Only `reqType = "bill-tax"` is supported. |

### 6.3 `/api/DynTemplates/*` (`DynTemplatesController` — legacy)

| # | Method | Route | Handler | Purpose |
|---|--------|-------|---------|---------|
| 7 | `GET` | `/api/DynTemplates?reqType=getSurveyTemplate&templateCode={code}&renderMode={mode}` | `Get` | Returns a fully-loaded template with questionnaires, questions (3-level), and options. `renderMode` = `"view"` / `"fill"` (default) hides inactive options; `"edit"` shows them. |
| 8 | `POST` | `/api/DynTemplates?reqType=addQuestion` | `Post` | Body: serialized `Question`. Inserts a new question. |
| 9 | `POST` | `/api/DynTemplates?reqType=addQnair` | `Post` | Body: serialized `Questionnaire`. Inserts a new questionnaire; response includes the assigned `QnairId`. |
| 10 | `PUT` | `/api/DynTemplates?reqType=updateQnairs` | `Put` | Body: `List<Questionnaire>`. Renames and reorders questionnaires. |
| 11 | `PUT` | `/api/DynTemplates?reqType=updateQtn` | `Put` | Body: serialized `Question` (with `Options` collection). Uses GraphDiff `UpdateGraph` to atomically add/update/delete options. |

### 6.4 `/api/DynamicTemplate/*` (`DynamicTemplateController` — modern)

| # | Method | Route | Handler | Purpose |
|---|--------|-------|---------|---------|
| 12 | `GET` | `/api/DynamicTemplate/TemplateTypes` | `TemplateType` | Returns all `TemplateType_DTO` (active or not). |
| 13 | `GET` | `/api/DynamicTemplate/TemplatePrintHtml?templateId={id}` | `TemplatePrintHtml` | Returns `{ TemplateId, PrintContentHTML }` for one template. |
| 14 | `GET` | `/api/DynamicTemplate/Templates?templateTypeName={name}` | `Templates` | If `templateTypeName` given, returns active templates of that type as `{ TemplateName, TemplateId, IsDefault }`. If empty, returns all templates with full metadata. |
| 15 | `GET` | `/api/DynamicTemplate/TemplateFields?templateId={id}` | `TemplateFields` | Returns active fields mapped to a template, with `IsMandatory` and `IsActive` ORed against `FieldMaster.IsCompulsoryField`. |
| 16 | `GET` | `/api/DynamicTemplate/FieldMaster?templateTypeId={id}` | `FieldMaster` | Returns all field-masters. If `templateTypeId` is given, filters to that type. Includes inactive rows when no filter. |
| 17 | `GET` | `/api/DynamicTemplate/GetSelectedTemplateData?templateId={id}` | `GetSelectedTemplateData` | Returns the raw `TemplateModel` for a given id. |
| 18 | `GET` | `/api/DynamicTemplate/GetFieldMasterByTemplateId?TemplateId={id}` | `GetFieldMasterByTemplateId` | Calls `SP_DYNTMP_GetFieldMappingByTemplateId` and returns a `DataTable`. |
| 19 | `PUT` | `/api/DynamicTemplate/ActivateDeactivate?templateId={id}` | `ActivateDeactivateTemplate` | Toggles `IsActive`. Stamps `ModifiedBy` / `ModifiedOn`. |
| 20 | `PUT` | `/api/DynamicTemplate/UpdateDynamicTemplate` | `UpdateDynamicTemplate` | Body: `TemplateModel` JSON. Updates `TemplateTypeId`, `TemplateName`, `Description`, `TemplateCode`, `IsDefaultForThisType`, `PrintContentHTML`. Stamps `ModifiedBy` / `ModifiedOn`. |
| 21 | `POST` | `/api/DynamicTemplate/AddNewTemplate` | `AddNewTemplate` | Body: `TemplateModel` JSON. Stamps `CreatedBy` / `CreatedOn`. Returns the new template. |
| 22 | `POST` | `/api/DynamicTemplate/AddUpdateFieldMapping` | `AddUpdateFieldMapping` | Body: `List<FieldMappings_DTO>`. For each, inserts or updates a `TemplateFieldMappingModel` keyed by `(TemplateId, FieldMasterId)`. Single `SaveChanges`. |

### 6.5 Cross-cutting Endpoints Inherited from `CommonController`

Every controller that derives from `CommonController` automatically receives the `[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]` and `[DanpheDataFilter()]` attributes. This means **every** API endpoint:

- Accepts form bodies up to 1,000,000 key/value pairs without throwing.
- Requires a valid `Authorization: Bearer <jwt>` header, with the `currentUser` claim populated. The filter also has a hardcoded special case for `POST /api/Dicom` that accepts body-embedded credentials.

In addition, the `[Route("api/[controller]")]` attribute on the base class means every controller is namespaced under `/api/`.

---

## 7. Cross-Module Integration

The Core module is **uniquely** the most-consumed module in the system. Every other feature module depends on it.

### 7.1 What Every Module Consumes from Core

| Concern | API | Consumed By |
|---------|-----|-------------|
| **HTTP envelope** | `DanpheHTTPResponse<T>` | All controllers. |
| **Error wrapping** | `InvokeHttp*Function<T>` helpers | All controllers. |
| **JWT auth** | `[DanpheDataFilter()]` (on `CommonController`) | All API controllers. |
| **Form size limit** | `[RequestFormSizeLimit]` | All API controllers. |
| **MVC RBAC** | `[DanpheViewFilter(permissionName)]` | All view controllers (SettingsView, AdmissionView, etc.). |
| **EMPI generation** | `CommonController.CreateEmpi(PatientModel)` | Patient registration, visit creation. |
| **Audit fields** | `CommonController.AddAuditField(dbContext)` | All controllers when `IsAuditEnabled = true`. |
| **Master-data cache** | `DanpheCache.GetMasterData(MasterDataEnum.X)` | 75+ call sites in 13+ controllers. |
| **Parameter resolution** | `GET /api/Parameters` + `CoreService.Parameters` | Every Angular feature. |
| **Lookup resolution** | `GET /api/Core/Lookups?inputValue=X` | Lab, Radiology, Billing lookups. |
| **Date preference** | `GET/POST /api/Core/EmployeeDatePreference` | Every Angular screen (calendar toggle). |
| **Print templates** | `/api/DynamicTemplate/TemplatePrintHtml` | Radiology, Lab, Discharge summary printing. |
| **Survey templates** | `/api/DynTemplates?reqType=getSurveyTemplate` | Clinical/Psychiatric screens. |

### 7.2 Per-Module Call Sites for `DanpheCache.GetMasterData`

| Module | MasterDataEnum values used |
|--------|---------------------------|
| `Master` | All 12 |
| `Lab` | `LabRunNumberSettings` (5+ sites) |
| `Billing` | `ServiceDepartment` (via `billItem-srvdept-` keys, separate from enum), `Employee` |
| `Scheduling` | `Department`, `Employee` |
| `Radiology` | `Employee` (2+ sites) |
| `Admission` | `Employee` (read uses cache, write does not invalidate) |
| `Incentive` | `Department`, `Employee` |
| `Insurance` (GovInsurance) | `Employee` |
| `Accounting` | `AccountingCodes` (joined with `Hospitals` where `IsActive = true`) |
| `Pharmacy` | Indirect via `Master` (not direct). |

### 7.3 Master-Data Table Sharing

The `CoreDbContext` aggregates `DbSet<>` registrations for tables that *logically* belong to other modules but are needed by Core. This is a deliberate architectural choice to avoid circular references between `MasterDbContext` and `BillingDbContext` etc. Tables registered in `CoreDbContext.OnModelCreating` include:

- `MST_Country` → `Master`
- `MST_CountrySubDivision` → `Master`
- `MST_ICD10` → `Master`
- `MST_Reactions` → `Master`
- `MST_Tax` → `Master`
- `MST_Department` → `Master`
- `EMP_Employee`, `EMP_EmployeeRole`, `EMP_EmployeeType`, `EMP_EmployeePreferences` → `Employee`
- `RAD_MST_ImagingType`, `RAD_MST_ImagingItem` → `Radiology`
- `BIL_MST_ServiceDepartment`, `BIL_CFG_PriceCategory` → `Billing`
- `ADT_MST_BedFeature`, `ADT_MST_Ward`, `ADT_MAP_BedFeaturesMap`, `ADT_MAP_WardBedType` → `Admission`
- `PAT_Patient` → `Patient`
- `PHRM_MST_Item` → `Pharmacy`
- `Lab_MST_RunNumberSettings` → `Lab`
- `ACC_MST_CodeDetails`, `ACC_MST_Hospital` → `Accounting`
- `HospitalModel` → `Admin`

This means `CoreDbContext` is the *universal read context*. Other contexts (e.g. `MasterDbContext`, `BillingDbContext`) register only the tables they own for write access.

### 7.4 Dependency Injection Registrations

`Startup.cs:169` registers `DanpheCache` as a singleton: `services.AddSingleton<DanpheCache>(new DanpheCache(connString, cacheExpMins))`. The `cacheExpMins` is read from `appsettings.json:CacheExpirationMinutes`.

`DependencyInjection/DanpheServicesExtensions.cs:75` registers the dynamic-template service: `services.AddTransient<IDynamicTemplateService, DynamicTemplateService>()`.

`CommonController` reads `IOptions<MyConfiguration>` via DI, exposing `connString`, `connStringAdmin`, `connStringPACSServer`, and `IsAuditEnabled` to all derived controllers.

---

## 8. Business Rules

### 8.1 Caching

1. **Read-through pattern only** — There is no write-side cache invalidation. If a `PUT` to `MST_Department` modifies a row, the change is invisible to `DanpheCache.GetMasterData(MasterDataEnum.Department)` until the cache TTL expires. This is a known limitation that the codebase documents implicitly through the absence of a `Remove` method.
2. **TTL is module-specific** — `LabRunNumberSettings` uses 20 minutes, `PastUniqueData` uses 24 hours, all others use the configured `cacheExpiryMinutes` (default 5 minutes from `appsettings.json`).
3. **Cache is process-local** — `MemoryCache.Default` is an in-process singleton. In a multi-instance deployment (e.g. Cloudflare Workers, or scaled-out IIS), each instance maintains its own cache. The Cloudflare migration should use Cloudflare KV with read-through and `expiration_ttl` matching the existing TTLs.
4. **`ICD10` cache is effectively unused** — The `if (returnValue == null)` check is mis-placed in `Caching.cs:140-152`. The cache is never populated, so every `GetMasterData(MasterDataEnum.ICD10)` call re-queries the database. This is a latent bug.

### 8.2 Parameter Resolution

1. **Group + Name is the unique key** — `(ParameterGroupName, ParameterName)` must be unique. There is no DB-level constraint enforced; duplicate combinations are prevented by convention only.
2. **Boolean parameters use `"true"` / `"false"` strings** — When the SPA does `ParameterValue == "true"`, the comparison is case-sensitive and against the literal string. JSON-encoded values are common; parsing must be done client-side.
3. **Only `BILL.TaxInfo` is writable via API** — The `ParametersController.PUT` is hardcoded to that one parameter. All other parameters are seeded at install time and updated only via direct SQL or admin tooling.
4. **Boot-time cache** — The SPA calls `GET /api/Parameters` once on app start and stores the full result in `CoreService.Parameters`. Feature code does *not* re-fetch; it relies on the in-memory array for the lifetime of the session. This is fast but means parameter changes require an app reload.

### 8.3 Application Settings (AppSettings endpoint)

1. **Sanitised output** — Only three fields are exposed: `ApplicationVersionNum`, `highlightAbnormalLabResult`, `CacheExpirationMinutes`. Connection strings, file paths, and PACS credentials are explicitly stripped by creating a fresh `MyConfiguration` instance.
2. **The endpoint does not check permissions** — It is decorated only with the inherited `[DanpheDataFilter()]`, which validates JWT but does not enforce per-permission RBAC. The endpoint is therefore safe to call from anonymous boot code that has a valid token.

### 8.4 Employee Preferences

1. **Only `DatePreference` is currently used** — Other `PreferenceName` values may exist in the table but the controller hardcodes the lookup.
2. **Read uses `CoreDbContext`, write uses `AdmissionDbContext`** — The `EMP_EmployeePreferences` table is mapped in both contexts (per their respective `OnModelCreating`). The Core controller's GET uses Core; the POST uses Admission. This works because both contexts point at the same physical table. It is a code smell — the responsibility should belong to a single context.
3. **Concurrent updates are not protected** — There is no optimistic concurrency token. Two simultaneous POSTs from the same user can race, with the second winning.

### 8.5 Dynamic Templates

1. **Legacy (`DynTemplatesController`)** supports a 3-level question hierarchy (`QtnHRCLevel` 0/1/2). Anything deeper is silently dropped by `ConfigureTemplate`.
2. **Modern (`DynamicTemplateController`)** does not enforce a hierarchy — fields are flat per `TemplateFieldMapping` row, ordered by `EnterSequence`.
3. **Field-mandatory logic** — A field is mandatory if **either** `Mapping.IsMandatory` is true **or** `FieldMaster.IsCompulsoryField` is true. Same for `IsActive` — either being true makes the field active.
4. **One default per type** — `Template.IsDefaultForThisType = true` should be unique per `TemplateTypeId`, but the application does not enforce uniqueness at write time. Multiple `true` rows will all be returned by the SPA, and the SPA is responsible for picking one.
5. **Print HTML is opaque** — The server does not parse `PrintContentHTML`. The SPA substitutes placeholders client-side (e.g. `{{PatientName}}`). There is no server-side templating engine.
6. **SP `SP_DYNTMP_GetFieldMappingByTemplateId`** is the only Core stored procedure. It is called from `GetFieldMasterByTemplateId` and returns a `DataTable` (not a strongly-typed list).
7. **GraphDiff for question updates** — `UpdateGraph` with `map.OwnedCollection(a => a.Options)` ensures that removed options are deleted, new options are inserted, and existing options are updated, all in a single `SaveChanges`. This relies on `Option.EntityState = "unchanged"` being the default for unmodified rows.

### 8.6 EMPI Generation

1. **District prefix is 3 chars** — `CountrySubDivisionName.Substring(0, 3)`. If the sub-division name is shorter than 3 characters, this throws.
2. **Middle-name missing = `"X"`** — `string.IsNullOrEmpty(obj.MiddleName) ? "X" : obj.MiddleName.Substring(0, 1)`. Trailing `X` is the canonical placeholder.
3. **Random range is 1000–9999 inclusive** — `(new Random()).Next(1000, 10000)` — `Next(maxValue)` is exclusive on the upper bound, so the actual range is 1000–9999 (4 digits).
4. **Result is uppercased** — `empi.ToUpper()`. Names are typically mixed case in the input; the canonical EMPI is always uppercased.
5. **Length is 16** — 3 (district) + 6 (DOB DDMMYY) + 3 (FML initials) + 4 (random) = 16. There is no length validation; the code assumes all inputs are long enough.

### 8.7 JWT Auth

1. **`Authorization: Bearer <jwt>`** is the only supported auth method for API endpoints. Session-based auth is not supported on the API surface.
2. **`ENUM_ClaimTypes.currentUser`** is the claim type that carries the serialized `RbacUser` JSON. This is the single source of truth for the current user.
3. **Dicom exception** — `POST /api/Dicom` accepts body-embedded credentials because DICOM devices cannot easily add headers. The body must contain a `currentuser` JSON field with `UserName` and `Password`. Validation uses `RBAC.IsValidUser`, which checks the credentials against the `RBAC_*` tables.
4. **Failure response** — On auth failure, the filter returns `JsonResult(new DanpheHTTPResponse<object> { Status = "Failed", ErrorMessage = "Unauthorized Access", Results = "" })` — note this is `JsonResult`, not `Unauthorized()`. The HTTP status code is 200; clients must check the `Status` field. This is a deviation from REST conventions and should be revisited in the migration.

### 8.8 View RBAC

1. **Per-permission gating** — `DanpheViewFilter` enforces a specific permission name passed at decoration time. Unlike the data filter, view filtering does check permissions, not just authentication.
2. **Redirect target is `Account/PageNotFound`** — On missing permission, the filter redirects to a "page not found" page rather than a "forbidden" page. This is a UX choice that hides the existence of the route from unauthorized users.

### 8.9 Cross-Cutting Constraints for the Cloudflare Migration

1. **MemoryCache → Cloudflare KV** — Replace `MemoryCache.Default` with KV reads/writes, using `expiration_ttl` to honor the existing TTLs. Alternatively, use the Workers Cache API for per-isolate caching. The 12 `MasterDataEnum` slots map cleanly to 12 KV keys.
2. **`CommonController.CreateEmpi`** runs server-side at patient registration. The EMPI logic is pure CPU and safe to port as-is.
3. **`DanpheDataFilter`** becomes Hono middleware that validates JWT and populates `c.var.currentUser`. The Dicom special case becomes a dedicated route with its own auth path.
4. **`DanpheViewFilter`** is server-rendering-only and can be dropped on the Cloudflare Pages + API split (the SPA handles RBAC via route guards).
5. **`RequestFormSizeLimit`** is irrelevant on Cloudflare Workers — request bodies are streamed, not buffered. The 1,000,000 entry limit is an IIS-specific safeguard that does not translate.
6. **Tenant scoping** — On the multi-tenant Cloudflare target, every `Parameter` / `Lookup` / `Template` / `Field` row must carry a `tenant_id`. The `CoreDbContext` currently has no tenant concept; this must be added at the EF layer via a global query filter.
7. **`AuditDbContext`** (from `Audit.EntityFramework`) is the parent of `CoreDbContext`. The audit fields `ChangedByUserId` and `ChangedByUserName` are pushed via `dbContext.AddAuditCustomField()`. On the Cloudflare target, audit logging should move to a separate audit log table with structured writes, not EF auto-tracking.

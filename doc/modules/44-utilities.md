# Utilities Module

## 1. Module Overview

The Utilities module is the **horizontal cross-cutting layer** of DanpheEMR. Unlike the other 45 modules, Utilities is split into two distinct roles:

1. **A "service + controller" surface** in `Controllers/Utilities/UtilitiesController.cs` and `Services/Utilities/`. This is the part that exposes HTTP endpoints. The endpoints it owns today are:
   - Scheme Refund — issue a refund against a billing scheme (SSF, Medicare, EHS, etc.) and mirror the cash movement into the `TXN_EmpCashTransaction` ledger.
   - Scheme Refund Lookup — by date range, by receipt number, by patient.
   - Visit Scheme Change — change the active Scheme + PriceCategory on an existing patient visit, log the change, and update the `PAT_MAP_PatientSchemes` table.
   - Organization Deposit — receive / return a credit-organization deposit and post the corresponding Emp Cash transaction.

2. **A "helper library"** in `Utilities/` (top-level folder). Every other controller in DanpheEMR inherits from `CommonController` and reuses:
   - `DanpheJSONConvert` — JSON serialization that ignores reference loops.
   - `SessionExtensions` — `ISession.Get<T>` / `ISession.Set<T>` typed wrappers.
   - `DanpheDateConvertor` / `NepaliDateModel` — English <-> Nepali (Bikram Sambat) date conversion with full year metadata 1950 BS -> 2090 BS.
   - `DanpheStringExtension.Like` — SQL-style `LIKE` (`%`, `_`) matching compiled to a .NET regex.
   - `ExcelExportHelper` — `EPPlus`-driven Excel export with column metadata, freeze panes, date / time formatting, and Excel formulas (`=sum(...)`, `=count(...)`).
   - `FileUploader` / `ImageUploader` — write `IFormFileCollection` / base64 image lists to disk under a configured storage root.
   - `CommonController` — `InvokeHttpGetFunction` / `InvokeHttpPostFunction` / `InvokeHttpPutFunction` wrappers, `CreateEmpi` (16-char Enterprise Master Patient Index), audit field injection.
   - `CommonFunctions` — typed readers for `Core CFG Parameters` (int / string / bool / json-by-key).
   - `SharedEnums` — the single source of truth for every string-coded enum used across the application (billing status, transaction types, scheme change actions, etc.).
   - `MyConfiguration` — strongly-typed wrapper over `appsettings.json` (connection strings, JWT, Google Drive, file storage, audit toggle, PACS).
   - `RewindMiddleWare` — `app.UseMiddleware<RewindMiddleWare>()` to enable `Request.EnableRewind()` so that `Request.Body` can be read twice (for form re-parsing after custom logging).

The `ServerSidePrinter` project in `Code/Utilities/ServerSidePrinter/` is a stand-alone Windows Forms executable that watches a folder for HTML files, fires each one at a configured network printer via the embedded `WebBrowser` control, then deletes the source file. It exists so that OPD stickers, billing receipts, and barcode slips can be printed on a printer that is not on the user's local machine.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Scheme Refund** | A cash refund issued against a billing scheme (SSF, EHS, Medicare, etc.) when the scheme over-collected from a patient. Stored in `BIL_TXN_SchemeRefund`. Mirrored as an out-cash `ENUM_EMP_CashTransactinType.SchemeRefund` in `TXN_EmpCashTransaction`. |
| **Scheme Refund Receipt** | Per-fiscal-year receipt number (`ReceiptNo`) auto-incremented from the max in the current FY. |
| **Visit Scheme Change** | The act of editing the active Scheme + PriceCategory on an existing visit after registration. Audited in `VIS_LOG_VisitSchemeChangeHistory`. Allowed only when a row exists in `BIL_MAP_PriceCategoryVsScheme` for the new pair. |
| **Process Confirmation Authority** | Cross-module matrix that lets designated RBAC roles confirm a high-risk process (e.g. cancel a finalized bill, return a deposit). Stored in `UTL_CFG_ProcessConfirmationAuthority`. |
| **Organization Deposit** | A pre-paid deposit balance held in trust for a credit organization (insurer / corporate). Stored as a `BIL_TXN_Deposit` row with `OrganizationOrPatient = "organization"`. Balance is `SUM(Deposit.InAmount) - SUM(DepositDeduct.OutAmount) - SUM(ReturnDeposit.OutAmount)`. |
| **Employee Cash Transaction** | The cross-module cash ledger (`TXN_EmpCashTransaction`) that tracks every in/out cash movement for the current employee at the current counter. Utilities posts `SchemeRefund`, `Deposit`, and `ReturnDeposit` rows into this ledger. |
| **EMPI** | Enterprise Master Patient Index — a 16-character code: 3 chars country sub-division + 6 chars DOB (`ddMMyy`) + 3 chars name initials (F, M-or-X, L) + 4 random digits. Generated server-side by `CommonController.CreateEmpi`. |
| **Nepali Date** | Bikram Sambat calendar. DanpheEMR uses BS dates everywhere in billing receipts, OPD slips, and visit forms. Year metadata is hard-coded from 1950 BS to 2090 BS. |
| **Common Controller** | The base MVC controller class for every DanpheEMR controller. Provides `connString`, `connStringAdmin`, `connStringPACSServer`, `IsAuditEnabled`, `InvokeHttpGetFunction`, audit field injection, and `CreateEmpi`. |
| **Danphe HTTP Response** | The standard `{ Results, Status, ErrorMessage }` envelope returned by every endpoint. Status is `"OK"` or `"Failed"`. |
| **CommonFunctions** | Static helpers for reading typed values from `Core CFG Parameters` (int / string / bool / nested-json-bool / nested-json-string / nested-json-int). |
| **Shared Enums** | Static classes with `readonly string` constants. Replace .NET `enum` so they round-trip through JSON and LINQ without conversion. |
| **Core CFG Parameter** | A row in `CFG_Parameters` (group + name + value) that lets every module read hospital-wide configuration at runtime without a code deploy. |
| **File Uploader** | Writes `IFormFileCollection` to `<FileStorageRelativeLocation>/<localFolder>`. Folder must end with `/`. |
| **Image Uploader** | Writes base64 image strings (`ImageUploadModel`) to disk and stamps the full path back onto the model. |
| **Excel Export Helper** | Builds an `.xlsx` file from a `DataTable` + `List<ColumnMetaData>`. Supports header, summary, custom column widths, freeze pane, date / time / datetime number formats, and `Sum` / `Count` formulas. |
| **String `Like` Extension** | `myStr.Like("%khadka%")` -> regex `\A.*khadka.*\z`. Mirrors SQL Server `LIKE` semantics including `_` (any single char) and `%` (any sequence). |
| **JSON Convert** | `DanpheJSONConvert.SerializeObject(obj, ignoreLoop=true)` and `DeserializeObject<T>`. Centralizes Newtonsoft settings. |
| **Session Extensions** | `session.Set<T>("key", value)` and `session.Get<T>("key")` — JSON-backed typed accessors. The session stores `RbacUser` under the constant `ENUM_SessionVariables.CurrentUser = "currentuser"`. |
| **Rewind Middleware** | `app.UseMiddleware<RewindMiddleWare>()` enables `EnableRewind()` so request body can be re-read by downstream filters. |
| **Server-Side Printer** | WinForms exe that watches `ServerPath` for `*.html` files and prints them to `OPDSticker` / `BillingPrinter` / `StickerPrinter` (configurable in `App.config`). |
| **MyConfiguration** | `IOptions<MyConfiguration>` injected into every controller. Holds connection strings, JWT settings, Google Drive file-upload credentials, audit enable flag, application version, and PACS connection. |

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `UtilitiesController.cs` | `Websites/DanpheEMR/Controllers/Utilities/UtilitiesController.cs` | Inherits `CommonController`. Injects `IUtilitiesService` + `UtilitiesDbContext`. Exposes Scheme Refund + Visit Scheme Change + Organization Deposit endpoints. | 95 |

### 2.2 Helper / Infrastructure Controllers

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `CommonController.cs` | `Websites/DanpheEMR/Utilities/CommonController.cs` | Base class for every controller. Holds `connString`, `connStringAdmin`, `connStringPACSServer`, `IsAuditEnabled`. Provides `ReadQueryStringData`, `ReadPostData`, `ReadFiles`, `ToInt`, `ToBool`, `ToInt64`, `AddAuditField`, `CreateEmpi`, and seven `InvokeHttp*` / `InvokeHttp*Async` / `InvokeHttp*SingleTransactionScope` wrappers that always return a `DanpheHTTPResponse<T>` envelope. Decorated with `[RequestFormSizeLimit(valueCountLimit: 1000000)]` + `[DanpheDataFilter()]`. Route prefix: `api/[controller]`. | 256 |

### 2.3 Utility Classes

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `CommonFunctions.cs` | `Websites/DanpheEMR/Utilities/CommonFunctions.cs` | `MapMachineResultsToComponentResults` (lab machine -> lab result), `GetDosesNumberArray` (1st-10th ordinal dose numbers for vaccination), and six `GetCoreParameter*` readers (Int / String / Bool / BoolWithKey / ValueByKey_String / ValueByKey_Boolean / ValueByKey_Int / ValueByKey_IntArray) that wrap `coreDbContext.Parameters` lookups with safe defaults. | 181 |
| `CommonTypes.cs` | `Websites/DanpheEMR/Utilities/CommonTypes.cs` | The `DanpheHTTPResponse<T>` envelope (`Results`, `Status`, `ErrorMessage`) plus three `FormatResult` static factories. | 47 |
| `DanpheDateConverter.cs` | `Websites/DanpheEMR/Utilities/DanpheDateConverter.cs` | `DanpheDateConvertor.ConvertNepToEngDate` (12-hr Nepali -> 24-hr English `DateTime`), `ConvertEngToNepDate` (24-hr English -> 12-hr Nepali), `GetTodaysNepDate`. Plus the full `NepaliDateModel` (BS years 1950-2090 with per-month day counts, `calYear` map BS-year -> English-year start/end, `engYearsHash` map English-year -> BS start/end), `NepaliYear` (1950-2089 with Devanagari representations), `NepaliMonth` (Baisakh..Chaitra), `NepaliDay` (1-32 Devanagari), `NepaliHours` (1-12), `NepaliMinutes` (00-59), `NepaliAMPM` (AM/PM), `calYearType`, `engYearsHashType`, `NepaliDateType`. | 1029 |
| `NepaliDate.cs` | `Websites/DanpheEMR/Utilities/NepaliDate.cs` | Database-driven alternative to `DanpheDateConverter`. Reads `d_CalendarMonthInfo` + `d_CalendarYearInfo` + `d_NepaliMonth`. Exposes `EngToNepaliDate`, `NeptoEnglishDate`, `NepaliLongDate`, `getNepaliMonth`, `LongMonth(m)` (returns "Baisakh"..."Chaitra"). Properties `NepaliDay`, `NepaliMonth`, `NepaliYear`. | 335 |
| `DanpheStringExtension.cs` | `Websites/DanpheEMR/Utilities/DanpheStringExtension.cs` | `string.Like(searchKey)` -> SQL-LIKE pattern (`%`, `_`) compiled to a regex. Used by every `GridFilter` to test against the user-typed filter string. | 13 |
| `ExcelExportHelper.cs` | `Websites/DanpheEMR/Utilities/ExcelExportHelper.cs` | `EPPlus`-based Excel writer. `LoadFromDataTable(columnamesIp, dataIp, header, showReportSummary, freezeHeader, removeColNameList, summaryData, summaryHeader)` writes header, table with `Light1` style, optional summary with `Sum` / `Count` formulas, optional custom summary block. `RestructureDatatableByIpColumns` and `MakeColumnsHeader` are static helpers used to apply `ColumnMetaData` ordering. `ColumnMetaData` has `ColName`, `ColDisplayName`, `DisplaySeq`, `Formula` (`ColumnFormulas.{nothing, Sum, Count, Date, Time, DateTime}`), `Color`, `Width` (default 12). | 393 |
| `FileUploader.cs` | `Websites/DanpheEMR/Utilities/FileUploader.cs` | `FileUploader.Upload(IFormFileCollection, localFolder)` writes each `IFormFile` to `<fileStorageLocation>/<localFolder>/<FileName>` via `MemoryStream` -> `FileStream`. Returns a `DanpheHTTPResponse<object>` with `Status = "OK"` and `Results = filePath` on success. | 77 |
| `ImageUploader.cs` | `Websites/DanpheEMR/Utilities/ImageUploader.cs` | `ImageUploader.UploadImages(List<ImageUploadModel>, FolderLocation)` decodes `base64String`, decodes to `System.Drawing.Image`, writes to `<FolderLocation>/<ImageName>`, and stamps `FullPath` back onto the model. `ImageUploader.GetBase64FromLocation(path)` is the reverse operation. | 62 |
| `JSONConvert.cs` | `Websites/DanpheEMR/Utilities/JSONConvert.cs` | `DanpheJSONConvert.SerializeObject(obj, ignoreLoop=true)` (Newtonsoft with `ReferenceLoopHandling.Ignore` and `Formatting.Indented`) and two `DeserializeObject` overloads. Used by every controller when shaping the response. | 39 |
| `MyConfiguration.cs` | `Websites/DanpheEMR/Utilities/MyConfiguration.cs` | Strongly-typed `IOptions<MyConfiguration>` payload: `Connectionstring`, `ConnectionStringAdmin`, `ConnectionStringPACSServer`, `CacheExpirationMinutes`, `FileStorageRelativeLocation`, `highlightAbnormalLabResult`, `RealTimeRemoteSyncEnabled`, `ApplicationVersionNum`, `IsAuditEnable`, `LISDataBaseUrl`, `GoogleDriveConfiguration` (ServiceAccountKey, LoggerFilePath, UploadFileBasePath, FileUrlCommon), `JWTTokenConfiguration` (JwtKey, JwtIssuer, JwtAudience, JwtValidMinutes), `RealTimeSSFClaimBooking`. | 40 |
| `RewindMiddleWare.cs` | `Websites/DanpheEMR/Utilities/RewindMiddleWare.cs` | Middleware that calls `httpContext.Request.EnableRewind()` so the request body can be read multiple times by downstream middleware (logging + form binding). Registered in `Startup.cs` line 252. | 23 |
| `SessionExtensions.cs` | `Websites/DanpheEMR/Utilities/SessionExtensions.cs` | `ISession.Set<T>(key, value)` and `ISession.Get<T>(key)` — JSON-backed typed accessors. The session is used to persist the `RbacUser` under `ENUM_SessionVariables.CurrentUser = "currentuser"`. | 45 |
| `SharedEnums.cs` | `Websites/DanpheEMR/Utilities/SharedEnums.cs` | The single source of truth for every string-coded enum. 50+ static classes with `readonly string` constants. See "Shared Enums" section below for the full list. | 584 |

### 2.4 Service Layer

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `IUtilitiesService.cs` | `Websites/DanpheEMR/Services/Utilities/IUtilitiesService.cs` | Interface for the seven Utilities business operations. | 21 |
| `UtilitiesService.cs` | `Websites/DanpheEMR/Services/Utilities/UtilitiesService.cs` | All seven operations live here. Wraps every write in `dbContextTransaction` + `try/catch` + `Rollback()`. | 390 |

### 2.5 Service-Layer DTOs

| File | Path | Purpose | Fields |
|------|---------|---------|--------|
| `SchemeRefund_DTO.cs` | `Websites/DanpheEMR/Services/Utilities/DTOs/SchemeRefund_DTO.cs` | Inbound payload for `POST /api/Utilities/SchemeRefund`. | `SchemeId`, `PatientId`, `InpatientNumber`, `RefundAmount`, `Remarks`, `CounterId` |
| `VisitSchemeChangeHistory_DTO.cs` | `Websites/DanpheEMR/Services/Utilities/DTOs/VisitSchemeChangeHistory_DTO.cs` | Inbound payload for `POST /api/Utilities/ChangeVisitScheme`. | `ChangeAction`, `PatientId`, `PatientVisitId`, `OldSchemeId`, `OldPriceCategoryId`, `NewSchemeId`, `NewPriceCategoryId`, `Remarks`, `PatientCode`, `PolicyNo`, `LatestClaimCode`, `PriceCategoryName`, `VisitType`, `VisitCode`, `SchemeName` |
| `OrganizationDeposit_DTO.cs` | `Websites/DanpheEMR/Services/Utilities/DTOs/OrganizationDeposit_DTO.cs` | Inbound payload for `POST /api/Utilities/OrganizationDeposit`. | `DepositId`, `PatientId?`, `TransactionType`, `InAmount`, `OutAmount`, `Remarks`, `DepositHeadId`, `CreditOrganizationId`, `ModuleName`, `OrganizationOrPatient`, `PaymentMode`, `PaymentDetails`, `DepositBalance`, `CareOf`, `CreditOrganizationName`, `empCashTransactionModel: List<EmpCashTransactionModel>` |
| `PatientSchemeRefundsList_DTO.cs` | `Websites/DanpheEMR/Services/Utilities/DTOs/PatientSchemeRefundsList_DTO.cs` | Outbound DTO for `GET /api/Utilities/PatientSchemeRefunds?patientId=...`. | `RefundedDate`, `SchemeName`, `RefundAmount`, `FullName`, `Remarks` |

### 2.6 EF DbContext (ServerModel)

| File | Path | Purpose |
|------|------|---------|
| `UtilitiesDbContext.cs` | `Components/DanpheEMR.DalLayer/UtilitiesDbContext.cs` | `DbContext` that owns the 12 entity sets Utilities writes/reads: `SchemeRefunds`, `FiscicalYear`, `VisitSchemeChangeHistory`, `PatientVisitModel`, `PatientSchemeMapModel`, `MapPriceCategoryScheme`, `BillingDepositModel`, `PaymentModes`, `EmpCashTransactionModels`, `CreditOrganizationModels`, `ProcessConfirmationAuthorities`, `BillingSchemeModels`, `EmployeeModels`, `Patient`. Maps each entity to its physical table via `OnModelCreating`. |

### 2.7 Standalone Projects (in `Code/Utilities/`)

| Project | Path | Purpose | LOC |
|---------|------|---------|-----|
| `ServerSidePrinter.sln` | `Code/Utilities/ServerSidePrinter.sln` | Solution file for the server-side printer Windows Forms app. | 4 |
| `ServerSidePrinter` | `Code/Utilities/ServerSidePrinter/` | Standalone .NET WinForms executable. `Program.cs` boots `LoadPrinter`. `ServerPrinter.cs` is the main form: it enumerates `Win32_Printer`, sets `OPDSticker` as the default printer, then runs a 10-second `Timer` that picks up `*.html` files from `App.config` `ServerPath`, prints each through the embedded `WebBrowser` control, and deletes the file when the print job completes. `App.config` exposes `OPDSticker` (default `"Fax"`), `BillingPrinter` (`"Microsoft Print to PDF"`), `StickerPrinter` (`"Deskjet"`), `ServerPath` (`"C:\DanpheHealthInc_PvtLtd_Files\Print"`). `ServerPrinter.Designer.cs` is the WinForms designer file. `Properties\Resources.resx` / `Settings.Designer.cs` are the resource and settings scaffolding. | 22 + 126 + 75 |
| `ServerSidePrinter/ServerSidePrinter.csproj` | `Code/Utilities/ServerSidePrinter/ServerSidePrinter.csproj` | .NET Framework 4.6.1 project file. | — |
| `TestingPlayGroundConsole` | `Code/Utilities/TestingPlayGroundConsole/` | Console scratch-project for Utilities. | — |
| `VitrosConsole.rar` | `Code/Utilities/VitrosConsole.rar` | Archived prototype for integrating a Vitros lab analyzer. | — |

---

## 3. Data Models

| Class | File | Purpose | Key Fields |
|-------|------|---------|------------|
| `DanpheHTTPResponse<T>` | `Utilities/CommonTypes.cs` | The envelope every DanpheEMR endpoint wraps its result in. | `Results`, `Status`, `ErrorMessage` |
| `NepaliDateType` | `Utilities/DanpheDateConverter.cs` | Strongly-typed Nepali date + time. | `Day`, `Month`, `Year`, `Hours`, `Minutes`, `AMPM` |
| `calYearType` | `Utilities/DanpheDateConverter.cs` | Internal row for `NepaliDateModel.calYear` list. | `CYear`, `YearStart`, `YearEnd` |
| `engYearsHashType` | `Utilities/DanpheDateConverter.cs` | Internal row for `NepaliDateModel.engYearsHash` list. | `engYear`, `yStartInBS`, `yEndInBS` |
| `NepaliYear` | `Utilities/DanpheDateConverter.cs` | Static list of BS years with Devanagari rendering. | `YearNumberEng`, `YearNumberNep` |
| `NepaliMonth` | `Utilities/DanpheDateConverter.cs` | Static list of 12 Nepali months. | `MonthNumber`, `MonthName` (Devanagari) |
| `NepaliDay` | `Utilities/DanpheDateConverter.cs` | Static list of 1-32 BS days. | `DayNumberEng`, `DayNumberNep` |
| `NepaliHours` | `Utilities/DanpheDateConverter.cs` | Static list 1-12 BS hours. | `HoursNumberEng`, `HoursNumberNep` |
| `NepaliMinutes` | `Utilities/DanpheDateConverter.cs` | Static list 0-59 BS minutes. | `MinutesNumberEng`, `MinutesNumberNep` |
| `NepaliAMPM` | `Utilities/DanpheDateConverter.cs` | Static list of AM/PM titles. | `Title` |
| `NepaliDate` | `Utilities/NepaliDate.cs` | DB-backed Nepali-date wrapper. | `NepDate`, `NepaliDay`, `NepaliMonth`, `NepaliYear` |
| `ColumnMetaData` | `Utilities/ExcelExportHelper.cs` | Per-column instructions for the Excel exporter. | `ColName`, `DisplaySeq` (default 200), `ColDisplayName`, `Formula`, `Color`, `Width` (default 12) |
| `ColumnFormulas` (enum) | `Utilities/ExcelExportHelper.cs` | What the column footer should compute. | `nothing`, `Sum`, `Count`, `Date`, `Time`, `DateTime` |
| `ExcelExportHelper` | `Utilities/ExcelExportHelper.cs` | The main Excel writer. | `package`, `worksheet`, `EndRow`, `EndRowPrevious` |
| `DanpheJSONConvert` | `Utilities/JSONConvert.cs` | JSON wrapper. | static `SerializeObject`, `DeserializeObject` |
| `FileUploader` | `Utilities/FileUploader.cs` | Disk write of `IFormFileCollection`. | static `fileStorageLocation`, `Upload` |
| `ImageUploader` | `Utilities/ImageUploader.cs` | Disk write of base64 images. | `UploadImages`, `GetBase64FromLocation` |
| `ImageUploadModel` | `Components/DanpheEMR.ServerModel/CommonModels/ImageUploadModel.cs` | Inbound DTO for `ImageUploader.UploadImages`. | `base64String`, `ImageName`, `FullPath` |
| `MyConfiguration` | `Utilities/MyConfiguration.cs` | Strongly-typed `appsettings.json`. | 13 fields + 2 nested configs |
| `GoogleDriveConfiguration` | `Utilities/MyConfiguration.cs` | Google Drive file-upload config. | `ServiceAccountKey`, `LoggerFilePath`, `UploadFileBasePath`, `FileUrlCommon` |
| `JWTTokenConfiguration` | `Utilities/MyConfiguration.cs` | JWT issuer config. | `JwtKey`, `JwtIssuer`, `JwtAudience`, `JwtValidMinutes` |
| `CommonController` | `Utilities/CommonController.cs` | Base class for every controller. | `connString`, `connStringAdmin`, `connStringPACSServer`, `IsAuditEnabled` |
| `CommonFunctions` | `Utilities/CommonFunctions.cs` | Static helper bundle. | 8 static methods (machine-result mapping, dose numbers, core parameter readers) |
| `SessionExtensions` | `Utilities/SessionExtensions.cs` | `ISession.Get<T>` / `Set<T>` extension methods. | — |
| `RewindMiddleWare` | `Utilities/RewindMiddleWare.cs` | ASP.NET Core middleware. | `Invoke(HttpContext)` -> `Request.EnableRewind()` |
| `DanpheStringExtension` | `Utilities/DanpheStringExtension.cs` | String extension. | `Like(searchKey)` |
| `SchemeRefundModel` | `Components/DanpheEMR.ServerModel/Utilities/SchemeRefundModel.cs` | EF entity for `BIL_TXN_SchemeRefund`. | 14 fields including `SchemeRefundId`, `FiscalYearId`, `ReceiptNo`, `SchemeId`, `PatientId`, `InpatientNumber`, `RefundAmount`, `Remarks`, `CreatedBy`, `CounterId`, `CreatedOn`, `ModifedBy`, `ModifiedOn`, `IsActive`, `IsTransferredToAcc` |
| `VisitSchemeChangeHistoryModel` | `Components/DanpheEMR.ServerModel/Utilities/VisitSchemeChangeHistoryModel.cs` | EF entity for `VIS_LOG_VisitSchemeChangeHistory`. | `VisitSchemeChangeHistoryId`, `ChangeAction`, `PatientId`, `PatientVisitId`, `OldSchemeId`, `OldPriceCategoryId`, `NewSchemeId`, `NewPriceCategoryId`, `Remarks`, `CreatedBy`, `CreatedOn` |
| `ProcessConfirmationAuthorityModel` | `Components/DanpheEMR.ServerModel/Utilities/ProcessConfirmationRolesPermissionModel.cs` | EF entity for `UTL_CFG_ProcessConfirmationAuthority`. | `ProcessConfirmationAuthorityId`, `ProcessToConfirm`, `PermissionId`, `RoleId` |
| `SchemeRefund_DTO` | `Websites/DanpheEMR/Services/Utilities/DTOs/SchemeRefund_DTO.cs` | Inbound scheme-refund payload. | 6 fields |
| `VisitSchemeChangeHistory_DTO` | `Websites/DanpheEMR/Services/Utilities/DTOs/VisitSchemeChangeHistory_DTO.cs` | Inbound visit-scheme-change payload. | 14 fields |
| `OrganizationDeposit_DTO` | `Websites/DanpheEMR/Services/Utilities/DTOs/OrganizationDeposit_DTO.cs` | Inbound organization-deposit payload. | 15 fields + nested `List<EmpCashTransactionModel>` |
| `PatientSchemeRefundsList_DTO` | `Websites/DanpheEMR/Services/Utilities/DTOs/PatientSchemeRefundsList_DTO.cs` | Outbound per-patient refund list. | 5 fields |

### Shared Enums (`Utilities/SharedEnums.cs`)

All enums are static classes with `readonly string` (or `int`) constants. They are used everywhere to avoid LINQ-incompatible enums and to keep JSON round-tripping trivial.

| Enum Class | Constants |
|------------|-----------|
| `ENUM_BillingStatus` | `paid`, `unpaid`, `provisional`, `cancel`, `returned`, `free`, `adtCancel`, `discard` |
| `ENUM_BillingType` | `inpatient`, `outpatient` |
| `ENUM_BillPaymentMode` | `cash`, `credit` |
| `ENUM_DepositTransactionType` | `Deposit`, `ReturnDeposit`, `DepositDeduct`, `DepositCancel` |
| `ENUM_EMP_CashTransactinType` | `CollectionFromReceivable`, `CashDiscountGiven`, `CashSales`, `Deposit`, `SalesReturn`, `ReturnDeposit`, `depositdeduct`, `HandoverGiven`, `MaternityAllowance`, `MaternityAllowanceReturn`, `CashDiscountReceived`, `SchemeRefund` |
| `ENUM_InvoiceType` | `inpatientPartial` = `"ip-partial"`, `inpatientDischarge` = `"ip-discharge"`, `outpatient` = `"op-normal"` |
| `ENUM_AdmissionStatus` | `discharged`, `admitted`, `transfer` |
| `ENUM_VisitType` | `inpatient`, `outpatient`, `emergency` |
| `ENUM_AppointmentType` | `New`, `followup`, `transfer`, `referral` |
| `ENUM_VisitStatus` | `initiated`, `cancel`, `concluded`, `checkedin` |
| `ENUM_PriceCategory` | `Normal`, `EHS`, `Foreigner`, `SAARCCitizen`, `SSF` |
| `ENUM_LabOrderStatus` | `Active`, `Pending`, `ResultAdded`, `ReportGenerated` |
| `ENUM_LabTemplateType` | `normal`, `html`, `culture` |
| `ENUM_LabRunNumType` | `histo`, `cyto`, `normal` |
| `ENUM_LabUrgency` | `Urgent`, `Normal`, `STAT` |
| `ENUM_NoteType` | `HAndP`, `ProgressNote`, `ConsultNote`, `DischargeNote`, `EmergencyNote`, `Procedure` |
| `ENUM_StockLocation` | `Dispensary` = 1, `Store` = 2 |
| `ENUM_PHRM_StockTransactionType` | `PurchaseItem`, `PurchaseReturnedItem`, `CancelledGR`, `WriteOffItem`, `SaleItem`, `SaleReturnedItem`, `ManualSaleReturnedItem`, `ProvisionalSaleItem`, `ProvisionalCancelItem`, `ProvisionalToSale`, `PatientConsumptionCancel`, `PatientConsumptionToSale`, `DispatchedItem`, `DispatchedItemReceivingSide`, `TransferItem`, `StockManage`, `DonationItem`, `CancelDonationItem`, `SubStoreDispatchFrom`, `SubStoreDispatchTo`, `PHRMSubStoreConsumption`, `PHRMPatientConsumption`, `PHRMPatientConsumptionReturn` |
| `ENUM_INV_StockTransactionType` | `OpeningItem`, `PurchaseItem`, `PurchaseReturnedItem`, `CancelledGR`, `WriteOffItem`, `DispatchedItem`, `DispatchedItemReceivingSide`, `ReturnedItem`, `ReturnedItemReceivingSide`, `TransferItem`, `ConsumptionItem`, `StockManageItem`, `FiscalYearStockManageItem` |
| `ENUM_BillingOrderStatus` | `Active`, `Pending`, `Final` |
| `ENUM_StoreCategory` | `Store`, `Dispensary`, `Substore`, `Pharmacy` |
| `ENUM_StoreSubCategory` | `Inventory`, `Pharmacy`, `NormalDispensary` = `"normal"`, `InsuranceDispensary` = `"insurance"` |
| `ENUM_DispensarySubCategory` | `Normal`, `Insurance` |
| `ENUM_CssdStatus` | `Pending`, `Finalized`, `Complete` |
| `ENUM_SupplierLedgerTransaction` | `GoodsReceipt`, `CancelledGR`, `ReturnFromSupplier`, `MakePayment` |
| `ENUM_InventoryRequisitionStatus` | `Withdrawn`, `Pending`, `Partial`, `Active`, `Complete` |
| `ENUM_InventoryPurchaseOrderStatus` | `Active`, `Partial`, `Withdrawn`, `Cancelled`, `Complete` |
| `ENUM_PharmacyRequisitionStatus` | `Withdrawn`, `Pending`, `Partial`, `Active`, `Complete`, `Cancel` |
| `ENUM_Danphe_HTTP_ResponseStatus` | `OK`, `Failed` |
| `ENUM_AssignNullValue` | `NA` = `"N/A"` |
| `ENUM_ACC_LedgerType` | `BankReconciliationCategory`, `PaymentMode`, `InventorySubCategory`, `PharmacySupplier`, `InventoryVendor`, `Consultant`, `CreditOrganization`, `BillingIncomeLedger`, `InventoryOtherCharge`, `PharmacyCreditOrganization`, `MedicareTypes`, `InventoryConsumption` |
| `ENUM_ACC_VoucherCode` | `PaymentVoucher` = `"PMTV"`, `ReceiptVoucher` = `"RV"`, `JournalVoucher` = `"JV"`, `PurchaseVoucher` = `"PV"`, `SalesVoucher` = `"SV"`, `ContraVoucher` = `"CV"`, `CreditNote` = `"CN"`, `DebitNote` = `"DN"`, `ReverseVoucher` = `"RVS"` |
| `ENUM_ACC_DefaultCostCenterName` | `Hospital` |
| `ENUM_ACC_TransactionType` | `ManualEntry` |
| `ENUM_SessionValues` | `CurrentHospitalId` = `"AccSelectedHospitalId"` |
| `ENUM_StoredProcedures` | `BankReconciliationReport`, `SubLedgerReport`, `LedgerList`, `EmployeeLedgerList`, `AccountingTransactionDates`, `AccountClosure`, `IncentivePaymentInfoUpdate` |
| `ENUM_HandOverStatus` | `Pending`, `Received` |
| `ENUM_HandOverType` | `User`, `Account` |
| `ENUM_EmpCashTransactionType` | `CashSales`, `Deposit`, `SalesReturn`, `ReturnDeposit`, `DepositDeduct`, `CashDiscountGiven`, `CollectionFromReceivable`, `HandoverGiven`, `MaternityAllowance`, `MaternityAllowanceReturn`, `HandoverReceived` |
| `ENUM_SessionVariables` | `CurrentUser` = `"currentuser"`, `ActiveLabType` = `"activeLabName"` |
| `ENUM_DanpheHttpResponseText` | `OK`, `Failed` |
| `ENUM_ModuleNames` | `Billing`, `Dispensary`, `Pharmacy` |
| `ENUM_ClaimTypes` | `currentUser` = `"currentUser"` |
| `ENUM_PHRM_InvoiceItemBillStatus` | `Paid`, `Unpaid`, `Provisional`, `ProvisionalCancel`, `PatientConsumption` |
| `ENUM_PHRM_DepositTypes` | `Deposit`, `DepositReturn`, `DepositDeduct` |
| `ENUM_PHRM_EmpCashTxnTypes` | `CashSales`, `SalesReturn`, `DepositAdd`, `DepositDeduct`, `DepositReturn`, `ReturnDeposit`, `CashDiscountGiven`, `CashDiscountReceived` |
| `ENUM_ClaimManagement_SettlementStatus` | `Pending`, `Completed` |
| `ENUM_ClaimManagement_CreditModule` | `Billing` = `"billing"`, `Pharmacy` = `"pharmacy"` |
| `ENUM_ClaimManagement_ClaimStatus` | `Initiated`, `InReview`, `PaymentPending`, `PartiallyPaid`, `Settled`, `Denied` |
| `ENUM_FileUpload_SystemFeatureName` | `InsuranceClaim`, `EmployeeProfile`, `PatientProfile`, `EmployeeSignatory`, `ClinicalScannedImage`, `FixedAssetContract`, `InventoryQuotation` |
| `ENUM_FileUpload_ReferenceEntityType` | `InsuranceClaim` |
| `ENUM_ServiceBillingContext` | `Registration`, `Admission`, `OpBilling` = `"op-billing"`, `IpBilling` = `"ip-billing"`, `IpPharmacy` = `"ip-pharmacy"`, `OpPharmacy` = `"op-pharmacy"` |
| `ENUM_SSF_EligibilityType` | `Medical`, `Accident` |
| `ENUM_Scheme_ApiIntegrationNames` | `SSF`, `Medicare` |
| `ENUM_PharmacyPurchaseOrderStatus` | `Pending`, `Active`, `Partial`, `Withdrawn`, `Cancel`, `Complete` |
| `ENUM_ACC_VoucherStatus` | `Draft`, `InReview`, `Verified`, `Canceled` |
| `ENUM_IntegrationNames` | `OPD`, `LAB`, `Radiology` = `"RADIOLOGY"`, `BedCharges` = `"Bed Charges"` |
| `ENUM_VisitSchemeChangeAction` | `ManualUpdate` = `"manual-update"`, `SystemUpdate` = `"system-update"` |
| `ENUM_Deposit_OrganizationOrPatient` | `Organization`, `Patient` |
| `ENUM_SchemeName` | `General` |
| `ENUM_ERStatus` | `New`, `finalized`, `triaged` |
| `ENUM_SSF_ApiEndPoints` | `PatientDetails` = `"Patient/?identifier="`, `CoverageEligibilityRequest` = `"CoverageEligibilityRequest/"`, `EmployeeList` = `"Employee/"`, `Claim` = `"Claim/"`, `ClaimDetail` = `"Claim/"`, `BookingService` = `"BookingService"` |
| `ENUM_SSF_SchemeTypes` | `Accident` = `"1"`, `Medical` = `"2"` |

---

## 4. Database Tables

The Utilities `DbContext` touches 12 physical SQL Server tables. Most are owned by other modules but Utilities reads/writes them. Tables are tracked through `OnModelCreating` in `UtilitiesDbContext.cs`.

| DbSet | Physical Table | Module | Notes |
|-------|----------------|--------|-------|
| `SchemeRefunds` | `BIL_TXN_SchemeRefund` | Billing (Utilities writes) | PK `SchemeRefundId`, FY-scoped `ReceiptNo`, links to `Scheme`, `Patient`, `FiscalYear`. |
| `FiscicalYear` | `BIL_CFG_FiscalYears` | Billing (read-only) | Used to compute the current FY and the next `ReceiptNo`. |
| `VisitSchemeChangeHistory` | `VIS_LOG_VisitSchemeChangeHistory` | Visit (Utilities writes) | PK `VisitSchemeChangeHistoryId`, stores `OldSchemeId`/`NewSchemeId`/`OldPriceCategoryId`/`NewPriceCategoryId` and the `ChangeAction`. |
| `PatientVisitModel` | `PAT_PatientVisits` | Visit (Utilities updates) | The row that is updated with the new `SchemeId` / `PriceCategoryId`. |
| `PatientSchemeMapModel` | `PAT_MAP_PatientSchemes` | Patient (Utilities upserts) | The patient-vs-scheme mapping. The most-recent `LatestPatientVisitId` is updated on scheme change. |
| `MapPriceCategoryScheme` | `BIL_MAP_PriceCategoryVsScheme` | Billing (read-only) | Used as a guard: the new `(PriceCategoryId, SchemeId)` pair must exist. |
| `BillingDepositModel` | `BIL_TXN_Deposit` | Billing (Utilities writes) | Holds organization and patient deposits. Identified by `OrganizationOrPatient = "organization"` for this module. |
| `PaymentModes` | `MST_PaymentModes` | Settings (read-only) | Used to resolve the `PaymentSubCategoryId` for the cash payment mode. |
| `EmpCashTransactionModels` | `TXN_EmpCashTransaction` | Billing (Utilities writes) | Mirror entries posted for `SchemeRefund`, `Deposit`, `ReturnDeposit`. |
| `CreditOrganizationModels` | `BIL_MST_Credit_Organization` | Billing (read-only) | Used to attach the organization name to the deposit detail DTO. |
| `ProcessConfirmationAuthorities` | `UTL_CFG_ProcessConfirmationAuthority` | Utilities (read/write) | The process-confirmation RBAC matrix. |
| `BillingSchemeModels` | `BIL_CFG_Scheme` | Billing (read-only) | Used to look up the scheme name and `DefaultPaymentMode` for a receipt. |
| `EmployeeModels` | `EMP_Employee` | HR (read-only) | Used to look up the `FullName` of the refunding employee. |
| `Patient` | `PAT_Patient` | Patient (read-only) | Used to look up the patient demographics for a refund receipt. |

Two additional legacy DB tables are read by the **old** `NepaliDate` class (kept for reference, no longer in the main path):

| Table | Purpose |
|-------|---------|
| `d_CalendarMonthInfo` | `nNoOfDays` per Nepali month row, used by `EngToNepaliDate` / `NeptoEnglishDate`. |
| `d_CalendarYearInfo` | `YearStart` per Nepali year row. |
| `d_NepaliMonth` | Nepali month code -> month name. |

These were replaced by the in-memory `NepaliDateModel.calYear` / `yr_mth` / `engYearsHash` collections in `DanpheDateConverter.cs`.

---

## 5. Key Workflows

### 5.1 Scheme Refund

A billing counter operator decides to refund a patient who was over-charged by a scheme (SSF, EHS, Medicare, etc.). The flow:

1. **POST** `/api/Utilities/SchemeRefund` with a `SchemeRefund_DTO` body.
2. The controller resolves the `RbacUser` from the session, wraps the call in `InvokeHttpPostFunction`, and delegates to `UtilitiesService.SaveSchemeRefundTransaction`.
3. The service opens a `dbContextTransaction` and:
   a. Resolves `currentFyId` from `BIL_CFG_FiscalYears` where today is between `StartYear` and `EndYear`.
   b. Computes `newReceiptNo = max(ReceiptNo for that FY) + 1` from `BIL_TXN_SchemeRefund`.
   c. Inserts a `SchemeRefundModel` with `IsActive = true`, `CreatedOn = DateTime.Now`, `CreatedBy = currentUser.EmployeeId`.
   d. Looks up the `SchemeName` from `BIL_CFG_Scheme`.
   e. Inserts a corresponding `EmpCashTransactionModel` with `TransactionType = ENUM_EMP_CashTransactinType.SchemeRefund`, `InAmount = 0`, `OutAmount = RefundAmount`, `ModuleName = "Billing"`, `PaymentModeSubCategoryId` resolved via `GetCashPaymentModeSubCategoryId` (matches `PaymentSubCategoryName = "cash"` in `MST_PaymentModes`), `Remarks = "Scheme Refunded against <SchemeName>"`.
   f. Commits the transaction. On exception, rolls back.
4. Response: the inbound DTO echoed back inside `DanpheHTTPResponse<SchemeRefund_DTO>` with `Status = "OK"`.

### 5.2 Visit Scheme Change

Front desk realizes a patient was registered against the wrong scheme. The flow:

1. **POST** `/api/Utilities/ChangeVisitScheme` with a `VisitSchemeChangeHistory_DTO` body containing `PatientId`, `PatientVisitId`, `OldSchemeId`, `OldPriceCategoryId`, `NewSchemeId`, `NewPriceCategoryId`, `Remarks`, `PatientCode`, `PolicyNo`, `LatestClaimCode`.
2. The service first validates the new pair exists in `BIL_MAP_PriceCategoryVsScheme` (throws `Selected Price Category is not available for Selected Scheme` if not).
3. Inside `dbContextTransaction`:
   a. Inserts a `VisitSchemeChangeHistoryModel` with `ChangeAction = ENUM_VisitSchemeChangeAction.ManualUpdate`.
   b. Updates the `PAT_PatientVisits` row with the new `SchemeId` / `PriceCategoryId` + `ModifiedBy` / `ModifiedOn`.
   c. If `NewSchemeId != OldSchemeId`:
      - If the new scheme is **not** already mapped to the patient in `PAT_MAP_PatientSchemes`, insert a new `PatientSchemeMapModel` with `IsActive = true`, `LatestPatientVisitId = <new visit>`, and the new `PriceCategoryId`.
      - If the new scheme **is** already mapped, update the existing `LatestPatientVisitId` and `ModifiedBy` / `ModifiedOn`.
4. Commits the transaction.

The history row is the audit trail — every scheme change can be replayed.

### 5.3 Organization Deposit (in or out)

A credit organization (insurer, corporate) either deposits money with the hospital (advance against future bills) or withdraws an unspent balance.

1. **POST** `/api/Utilities/OrganizationDeposit` with `OrganizationDeposit_DTO` body.
2. The service resolves the current FY + next `ReceiptNo` (FY-scoped, scoped to `BIL_TXN_Deposit`).
3. Builds a `BillingDepositModel`:
   - If `OrganizationOrPatient = "organization"` -> sets `CreditOrganizationId`, leaves `PatientId` null.
   - If `OrganizationOrPatient = "patient"` -> sets `PatientId` (nullable int).
   - Sets `TransactionType`, `DepositHeadId`, `CareOf`, `InAmount`, `OutAmount`, `DepositBalance`, `PaymentMode`, `PaymentDetails`, `ModuleName`, `Remarks`, `IsActive = true`, `CreatedBy`, `CreatedOn`, `FiscalYearId`, `ReceiptNo`.
4. For each entry in `empCashTransactionModel` (the operator can split a single deposit across multiple payment modes), inserts an `EmpCashTransactionModel` with:
   - `TransactionType = "Deposit"` -> `ENUM_EMP_CashTransactinType.Deposit`, `InAmount` from DTO, `OutAmount = 0`.
   - `TransactionType = "ReturnDeposit"` -> `ENUM_EMP_CashTransactinType.ReturnDeposit`, `InAmount = 0`, `OutAmount` from DTO.
   - `PatientId = null` (organization deposit, not patient).
5. Commits the transaction.

To view the current balance: **GET** `/api/Utilities/OrganizationDepositBalance?OrganizationId=...` aggregates `BIL_TXN_Deposit` by `(CreditOrganizationId, TransactionType)`, sums `InAmount` for `Deposit`, sums `OutAmount` for `DepositDeduct` + `ReturnDeposit`, and returns `currentDepositBalance = totalDepositAmt - totalDepositDeductAmt - totalDepositReturnAmt`.

### 5.4 Scheme Refund Lookup

- **GET** `/api/Utilities/SchemeRefund?fromDate=...&toDate=...` runs `[SP_UTL_SchemeRefundTransactions]` and returns a `DataTable`.
- **GET** `/api/Utilities/SchemeRefundById?receiptNo=...` joins `SchemeRefunds` x `BillingScheme` x `Patient` x `FiscicalYear` and returns the printable receipt payload: `PatientName`, `CreatedOn`, `HospitalNo`, `Address`, `Amount`, `Contact`, `SchemeName`, `Remarks`, `ReceiptNo`, `Paymentmode`, `FiscalYear`.
- **GET** `/api/Utilities/PatientSchemeRefunds?patientId=...` returns `List<PatientSchemeRefundsList_DTO>` ordered by `RefundedDate DESC` (used by the patient overview page).

### 5.5 English <-> Nepali Date Conversion

`DanpheDateConvertor` is the in-memory pure-C# converter. No DB hit.

- `ConvertNepToEngDate(NepaliDateType)` takes a 12-hour Nepali date+time and returns a 24-hour English `DateTime`. It uses `NepaliDateModel.calYear[bsYear].YearStart` + `NepaliDateModel.yr_mth[bsYear]` to walk the per-month day counts and then adds `nepDay - 1` days. Hours are converted from 12h + AMPM to 24h.
- `ConvertEngToNepDate(DateTime)` is the reverse. It uses `NepaliDateModel.engYearsHash[engYear].yStartInBS` to seed the BS year, then iterates `NepaliDateModel.GetDaysInMonthOfNext13NepaliMonthsIncludingCurrentMth(bsYr)` to walk through the cross-year boundary. English hours are mapped to BS hours via `NepaliDateModel.NepaliHoursList`.
- `GetTodaysNepDate()` is the convenience `ConvertEngToNepDate(DateTime.Now)`.

The legacy `NepaliDate` class hits SQL Server `d_CalendarMonthInfo` / `d_CalendarYearInfo` / `d_NepaliMonth` tables and exposes `EngToNepaliDate` / `NeptoEnglishDate` / `NepaliLongDate` (which returns e.g. `"2080 Baisakh 15"`) / `getNepaliMonth(code)` / `LongMonth(monthNumber)`.

### 5.6 File Upload (multipart)

`FileUploader.Upload(IFormFileCollection files, string localFolder)` is the simple non-base64 path. It writes each file under `<fileStorageLocation>/<localFolder>/<FileName>` using `MemoryStream` -> `FileStream`. `fileStorageLocation` is set by the controller from `MyConfiguration.FileStorageRelativeLocation`. Used by Employee profile, Signatory image, Clinical scanned image, Insurance claim attachment, etc. (the system feature name is tracked in `ENUM_FileUpload_SystemFeatureName`).

`ImageUploader.UploadImages(List<ImageUploadModel> images, string FolderLocation)` is the base64 path. Each `ImageUploadModel` carries a `base64String` and an `ImageName`; the uploader decodes, writes the image to `<FolderLocation>/<ImageName>`, and stamps `FullPath` back onto the model. The reverse `GetBase64FromLocation(path)` reads the image back to base64 for re-display.

### 5.7 Excel Export

`ExcelExportHelper.LoadFromDataTable(columnamesIp, dataIp, header, showReportSummary, freezeHeader, removeColNameList, summaryData, summaryHeader)`:

1. Calls `MakeColumnsHeader` to align the table columns with the user-supplied `List<ColumnMetaData>` (handles `DisplaySeq` reordering).
2. Calls `RestructureDatatableByIpColumns` to rename + reorder + drop the columns the user marked for removal.
3. Writes a merged `B<row>:H<row>` header in green bold.
4. Optionally freezes the first 3 rows.
5. Calls `worksheet.Cells.LoadFromDataTable(data, true, Light1)` to render the table.
6. If `showReportSummary`, walks `columnames` and writes a `Sum` / `Count` row at the bottom of each column with the formula `=sum(A4:A99)` etc.
7. If `summaryHeader` is non-empty, deserializes `SummaryData` (JSON) and writes a key/value block.
8. Bumps `EndRow` so multiple reports can be stacked on the same sheet.

Used by every reporting page that has a "Download Excel" button (Lab, Radiology, Billing, Inventory, Accounting, etc.).

### 5.8 EMPI Generation

`CommonController.CreateEmpi(PatientModel obj)` is invoked during patient registration when no `EMPI` has been issued yet. Format: 16 chars = `<3-char country sub-division><ddMMyy DOB><F initial><M-or-X initial><L initial><4-digit random>`. Example: `Khadka Prasad Oli`, district `Kailali`, DOB `01-Dec-1990` -> `KAI011290KPO8972`. The middle initial falls back to `X` when no middle name is on file.

### 5.9 Server-Side Printing

`ServerSidePrinter` is a Windows Forms executable that the hospital runs on a server near the printers. The flow:

1. A DanpheEMR page generates a print HTML (sticker / bill / barcode) and writes it to `App.config` `ServerPath` (e.g. `C:\DanpheHealthInc_PvtLtd_Files\Print`).
2. `LoadPrinter` form lists every `Win32_Printer` in the system and sets the configured `OPDSticker` (or `BillingPrinter` / `StickerPrinter`) as the default printer via WMI `SetDefaultPrinter`.
3. A 10-second `Timer` ticks. On each tick:
   a. Pulls all `*.html` files from `ServerPath`.
   b. For each file: sets `myWebBrowser.DocumentText = File.ReadAllText(file)`, waits for `DocumentCompleted` -> `myWebBrowser.Print()`, then deletes the file.
4. Errors are swallowed by `Application.DoEvents()`; printing is single-threaded per file.

### 5.10 CommonController Invoke Wrappers

Every controller in DanpheEMR calls one of the seven `InvokeHttp*` helpers on `CommonController`. The pattern:

```csharp
Func<object> func = () => _IUtilitiesService.GetXyz(...);
return InvokeHttpGetFunction(func);
```

Internally the wrapper:
1. Invokes the delegate inside a `try/catch`.
2. Wraps the result in `DanpheHTTPResponse<T>` with `Status = "OK"` or `Status = "Failed"`.
3. For `Post` / `Put`, re-serializes the envelope via `DanpheJSONConvert.SerializeObject(responseData, true)` (so the response body matches the client-side model exactly).
4. Returns `Ok(...)` so the client always sees HTTP 200 (the failure is inside the envelope, not in the HTTP status).

Variants:
- `InvokeHttpGetFunction<T>(Func<T>, customErrorMsg)` — sync GET.
- `InvokeHttpGetFunctionAsync<T>(Func<Task<T>>, customErrorMsg)` — async GET.
- `InvokeHttpPostFunction<T>(Func<T>)` — sync POST.
- `InvokeHttpPostFunctionAsync<T>(Func<T>, customErrorMsg)` — async POST.
- `InvokeHttpPostFunctionSingleTransactionScope<T>(Func<T>, DbContextTransaction)` — POST inside a caller-supplied EF transaction; commits on success, rolls back on exception.
- `InvokeHttpPutFunction<T>(Func<T>)` — sync PUT.
- `InvokeHttpPutFunctionAsync<T>(Func<T>, customErrorMsg)` — async PUT.
- `InvokeHttpPutFunctionSingleTransactionScope<T>(Func<T>, DbContextTransaction)` — PUT inside a caller-supplied EF transaction.

---

## 6. API Endpoints

Utilities exposes **8 HTTP endpoints** (under `/api/Utilities/*`). The helper layer (`Utilities/CommonController`, `ExcelExportHelper`, `FileUploader`, `ImageUploader`, `DanpheDateConvertor`) does not expose HTTP endpoints of its own — those are invoked in-process from other controllers.

### 6.1 Scheme Refund

| Method | Route | Auth | Body / Query | Returns |
|--------|-------|------|--------------|---------|
| `GET` | `/api/Utilities/SchemeRefund` | Session `currentuser` | `?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD` | `DanpheHTTPResponse<object>` whose `Results` is a `DataTable` from `SP_UTL_SchemeRefundTransactions`. |
| `GET` | `/api/Utilities/SchemeRefundById` | Session `currentuser` | `?receiptNo=<int>` | `DanpheHTTPResponse<object>` whose `Results` is an anonymous record: `PatientName`, `CreatedOn`, `HospitalNo`, `Address`, `Amount`, `Contact`, `SchemeName`, `Remarks`, `ReceiptNo`, `Paymentmode`, `FiscalYear`. |
| `GET` | `/api/Utilities/PatientSchemeRefunds` | Session `currentuser` | `?patientId=<int>` | `DanpheHTTPResponse<object>` whose `Results` is `List<PatientSchemeRefundsList_DTO>` ordered by `RefundedDate DESC`. |
| `POST` | `/api/Utilities/SchemeRefund` | Session `currentuser` | `SchemeRefund_DTO` body | `DanpheHTTPResponse<SchemeRefund_DTO>` (echoes the input + the new `ReceiptNo` if the DTO is updated to include it). |

### 6.2 Visit Scheme Change

| Method | Route | Auth | Body | Returns |
|--------|-------|------|------|---------|
| `POST` | `/api/Utilities/ChangeVisitScheme` | Session `currentuser` | `VisitSchemeChangeHistory_DTO` body | `DanpheHTTPResponse<VisitSchemeChangeHistory_DTO>` on success; `400` with `ErrorMessage = "Selected Price Category is not available for Selected Scheme"` or `"Latest Visit ID is null. Data cannot be saved."` on validation failure. |

### 6.3 Organization Deposit

| Method | Route | Auth | Body / Query | Returns |
|--------|-------|------|--------------|---------|
| `POST` | `/api/Utilities/OrganizationDeposit` | Session `currentuser` | `OrganizationDeposit_DTO` body (with `empCashTransactionModel` list) | `DanpheHTTPResponse<object>` whose `Results` is the newly inserted `DepositId` (int). |
| `GET` | `/api/Utilities/OrganizationDepositBalance` | Session `currentuser` | `?OrganizationId=<int>` | `DanpheHTTPResponse<decimal>` (the current balance). |
| `GET` | `/api/Utilities/OrganizationDepositDetailById` | Session `currentuser` | `?DepositId=<int>` | `DanpheHTTPResponse<OrganizationDeposit_DTO>` populated from `BIL_TXN_Deposit` x `BIL_MST_Credit_Organization`. |

### 6.4 Helper-layer conventions (not HTTP endpoints, used inside every other controller)

| Helper | Invocation | Returns |
|--------|------------|---------|
| `DanpheJSONConvert.SerializeObject(obj, ignoreLoop=true)` | `static` | `string` (Newtonsoft indented JSON, loops ignored). |
| `DanpheJSONConvert.DeserializeObject<T>(json)` | `static` | `T`. |
| `DanpheDateConvertor.ConvertNepToEngDate(NepaliDateType)` | `static` | `DateTime` (24h English). |
| `DanpheDateConvertor.ConvertEngToNepDate(DateTime)` | `static` | `NepaliDateType` (12h Nepali). |
| `DanpheDateConvertor.GetTodaysNepDate()` | `static` | `NepaliDateType` (today). |
| `"search string".Like("%khadka%")` | extension | `bool` (regex). |
| `FileUploader.Upload(IFormFileCollection, localFolder)` | `static` | `DanpheHTTPResponse<object>` with `Results = filePath`. |
| `ImageUploader.UploadImages(List<ImageUploadModel>, FolderLocation)` | `static` | `DanpheHTTPResponse<object>` (no payload; success/fail). |
| `ImageUploader.GetBase64FromLocation(path)` | `static` | `string` (base64). |
| `CommonFunctions.GetCoreParameterIntValue(CoreDbContext, group, name)` | `static` | `int` (0 if not found). |
| `CommonFunctions.GetCoreParameterStringValue(CoreDbContext, group, name)` | `static` | `string` ("" if not found). |
| `CommonFunctions.GetCoreParameterBoolValue(CoreDbContext, group, name)` | `static` | `bool` (false if not found). |
| `CommonFunctions.GetCoreParameterValueByKeyName_String/Bool/Int(IntArray)(CoreDbContext, group, name, key)` | `static` | typed value extracted from a JSON blob stored in `ParameterValue`. |
| `CommonFunctions.MapMachineResultsToComponentResults(List<MachineResultsVM>)` | `static` | `List<LabTestComponentResult>` (lab machine integration). |
| `CommonFunctions.GetDosesNumberArray()` | `static` | `List<DoseNumber>` (vaccination ordinals 1st..10th). |
| `ExcelExportHelper.LoadFromDataTable(...)` | instance | `void` (writes to the in-memory `package`; caller invokes `Save()`). |
| `ExcelExportHelper.RestructureDatatableByIpColumns(dt, colMeta, removeColNames)` | `static` | `DataTable`. |
| `ExcelExportHelper.MakeColumnsHeader(dt, colMetaInput)` | `static` | `List<ColumnMetaData>`. |
| `CommonController.CreateEmpi(PatientModel)` | protected | `string` (the new EMPI, also assigned to `obj.EMPI`). |
| `CommonController.AddAuditField(dynamic dbContext)` | internal | `dynamic` (attaches `ChangedByUserId` / `ChangedByUserName` if `IsAuditEnabled`). |
| `CommonController.ReadQueryStringData(keyname)` | internal | `string`. |
| `CommonController.ReadPostData()` | internal | `string` (raw body, after `EnableRewind`). |
| `CommonController.ReadFiles()` | internal | `IFormFileCollection`. |
| `CommonController.InvokeHttpGetFunction<T>(Func<T>, customErrorMsg)` | protected | `ActionResult` (`200 OK` with `DanpheHTTPResponse<T>`). |
| `CommonController.InvokeHttpGetFunctionAsync<T>(Func<Task<T>>, customErrorMsg)` | protected | `Task<ActionResult>`. |
| `CommonController.InvokeHttpPostFunction<T>(Func<T>)` | protected | `ActionResult`. |
| `CommonController.InvokeHttpPostFunctionAsync<T>(Func<T>, customErrorMsg)` | protected | `Task<ActionResult>`. |
| `CommonController.InvokeHttpPostFunctionSingleTransactionScope<T>(Func<T>, DbContextTransaction)` | protected | `ActionResult` (commits on success, rolls back on failure). |
| `CommonController.InvokeHttpPutFunction<T>(Func<T>)` | protected | `ActionResult`. |
| `CommonController.InvokeHttpPutFunctionAsync<T>(Func<T>, customErrorMsg)` | protected | `Task<ActionResult>`. |
| `CommonController.InvokeHttpPutFunctionSingleTransactionScope<T>(Func<T>, DbContextTransaction)` | protected | `ActionResult`. |
| `SessionExtensions.Set<T>(this ISession, key, value)` | extension | `void` (serializes value to JSON and stores). |
| `SessionExtensions.Get<T>(this ISession, key)` | extension | `T` (or `default(T)` if not set). |
| `RewindMiddleWare.Invoke(HttpContext)` | middleware | `Task` (calls `Request.EnableRewind()`). |
| `MyConfiguration` | injected via `IOptions<MyConfiguration>` | n/a. |

**Total exposed HTTP endpoints: 8** (`/api/Utilities/*`). Helper helpers used across the entire application: ~25 (the seven `Invoke*` variants plus the static helpers above). The Utilities module therefore has the smallest public HTTP surface of any DanpheEMR module, but the largest reuse footprint.

---

## 7. Cross-Module

Utilities is the most cross-cutting module in DanpheEMR. The table below maps every shared helper to the modules that depend on it.

| Helper | Used by (modules / controllers) |
|--------|---------------------------------|
| `CommonController` base class | Every controller in `Websites/DanpheEMR/Controllers/` — Accounting, Admission (ADT), Appointment, Billing, Claim Management, Clinical, CSSD, Dashboard, DICOM, Dispensary, Doctors, Emergency, Employee / HR, External Referral, Fixed Asset, Fraction, Helpdesk, Incentive, Insurance, Inventory, Lab, Maternity, Medical Records, Nursing, Operation Theatre, Patient, Payroll, Pharmacy, Queue, Radiology, Reporting, Scheduling, Social Service Unit, Stickers, Vaccination, Verification, **Utilities**. |
| `DanpheJSONConvert` | Every controller (response shaping), every service that needs to round-trip JSON. |
| `SessionExtensions` (`Get<RbacUser>("currentuser")`) | Every controller that needs the current user — Authorization gate, audit stamping, CreatedBy stamping, counter resolution. |
| `MyConfiguration` (via `IOptions<MyConfiguration>`) | Every controller. Connection strings, JWT, Google Drive, audit toggle, file storage location, PACS, application version, LIS DB URL. |
| `RewindMiddleWare` (`app.UseMiddleware<RewindMiddleWare>()`) | Whole pipeline. Enables `Request.Body` re-read for cross-cutting logging + form binding. |
| `DanpheDateConvertor` | Lab reports, Radiology reports, Billing receipts, OPD stickers, Nursing notes, Admission forms, Visit forms, Discharge summary, Appointment scheduling, Payroll. Anywhere a Nepali date is displayed or captured. |
| `NepaliDate` (legacy) | Same as above; being replaced by `DanpheDateConvertor`. |
| `DanpheStringExtension.Like` | Every `GridFilter` and `DanpheGrid` data-load path (Lab, Radiology, Billing, Inventory, Accounting, Patient, Pharmacy, Employee). |
| `ExcelExportHelper` | Reporting (every report that has an "Export to Excel" button) — Billing reports, Lab reports, Radiology reports, Inventory reports, Accounting reports, Payroll reports, Dispensary reports, HR reports, Inventory stock reports, Purchase orders, Sales registers. |
| `FileUploader` | Employee (profile image + signatory), Patient (profile image), Insurance (claim attachments), Clinical (scanned documents), Fixed Asset (contract uploads), Inventory (quotation uploads). Tracks by `ENUM_FileUpload_SystemFeatureName`. |
| `ImageUploader` | Same surface as `FileUploader` for the base64-encoding path used by clinical scanned images. |
| `CommonFunctions.GetCoreParameter*` | Every module that reads a `CFG_Parameters` row — Billing, Lab, Radiology, Pharmacy, Inventory, Accounting, Admission, Nursing, Vaccination, Clinical, HR, Reporting, DICOM, PACS, LIS integration. |
| `CommonFunctions.MapMachineResultsToComponentResults` | Lab machine-integration (Vitros, etc.) — converts the raw machine payload into `LabTestComponentResult` rows. |
| `CommonFunctions.GetDosesNumberArray` | Vaccination — supplies the ordinal list (1st..10th) for the dose-number dropdown. |
| `SharedEnums` | Literally every module. The constants are the cross-module contract — changing any value here is a coordinated migration. |
| `DanpheHTTPResponse<T>` | Every endpoint. The Angular client decodes this envelope on every response. |
| `CommonController.CreateEmpi` | Patient registration (and the patient merge tool, if any). |
| `CommonController.AddAuditField` | Every controller that opens an EF `DbContext` and is configured with `IsAuditEnable = true` in `appsettings.json`. |
| `UtilitiesController` (this module's HTTP surface) | Billing (scheme refund receipt print, scheme change on visit edit), Claim Management (scheme change reconciliation), Insurance (SSF scheme refund tracking), Accounting (organization deposit GL), Patient (per-patient refund history). |
| `UtilitiesService.SaveSchemeRefundTransaction` | Billing (cash counter), Insurance / SSF claim settlement, Accounting (Emp Cash handover). |
| `UtilitiesService.SaveVisitSchemeChange` | Visit / Registration (reception desk edit), Claim Management (revalidate scheme limits after change), Insurance. |
| `UtilitiesService.SaveOrganizationDeposit` | Billing (organization billing), Insurance (insurer pre-deposit), Accounting (organization deposit GL). |
| `ServerSidePrinter` standalone exe | Printing subsystem — runs on a server near the printers and is fed by every printing flow that targets a server-side printer (OPD stickers, billing receipts, barcode slips). |
| `ProcessConfirmationAuthorityModel` (`UTL_CFG_ProcessConfirmationAuthority`) | Cross-cutting gate — modules like Billing (cancel a finalized bill), Accounting (post a back-dated voucher), Pharmacy (return a narcotic), Lab (release an amended report) all look up `ProcessConfirmationAuthority` to decide whether the current user's role is allowed to confirm the process. |

---

## 8. Business Rules

1. **All HTTP responses are 200 OK** — failure is encoded inside the `DanpheHTTPResponse<T>.Status` field. The client always decodes the envelope, never relies on HTTP status.

2. **All `Post` / `Put` calls are double-serialized** — `CommonController.InvokeHttpPostFunction` (and its siblings) take the `DanpheHTTPResponse<T>` envelope and re-serialize it via `DanpheJSONConvert.SerializeObject(..., true)`. This is the documented workaround for cases where the default MVC serializer lost inheritance metadata (e.g. Settlement > Post).

3. **Receipt numbers are FY-scoped** — Scheme Refund and Organization Deposit both compute `newReceiptNo = max(ReceiptNo in current FY) + 1`. `currentFyId` is the `FiscalYearId` from `BIL_CFG_FiscalYears` where `StartYear <= today <= EndYear`. If no fiscal year matches, `currentFyId = 0` and the next receipt still goes through (no validation guard today).

4. **Visit Scheme Change requires a valid price-category / scheme pair** — before any write, `UtilitiesService.SaveVisitSchemeChange` looks up `BIL_MAP_PriceCategoryVsScheme` for `(NewPriceCategoryId, NewSchemeId)`. Missing pair -> exception `"Selected Price Category is not available for Selected Scheme"`.

5. **Visit Scheme Change keeps the `PAT_MAP_PatientSchemes` row in sync** — if the new scheme is **not** mapped to the patient, a new row is inserted with `IsActive = true`, `LatestPatientVisitId = <current visit>`, and the new `PriceCategoryId`. If the new scheme **is** already mapped, the existing row's `LatestPatientVisitId` / `ModifiedBy` / `ModifiedOn` are updated (no duplicate row). If `NewSchemeId == OldSchemeId`, no map change happens.

6. **Visit Scheme Change audit row is mandatory** — every change writes a `VIS_LOG_VisitSchemeChangeHistory` row with `ChangeAction = "manual-update"` (system-initiated changes use `"system-update"`). The row stores both old and new scheme + price-category so the change can be replayed.

7. **Scheme Refund posts a mirror `EmpCashTransaction`** — the `OutAmount` of the refund is duplicated into `TXN_EmpCashTransaction` with `TransactionType = "SchemeRefund"`, `ModuleName = "Billing"`, and `PaymentModeSubCategoryId` resolved to the cash payment mode (looked up from `MST_PaymentModes` where `PaymentSubCategoryName = "cash"`). The remarks string is `"Scheme Refunded against <SchemeName>"` (note: source uses `$"..."` template syntax with a `$` literal — this is an existing typo, the output is literally `"Scheme Refunded against $SSF"` etc.).

8. **Organization Deposit balance formula** — `currentDepositBalance = SUM(InAmount where TransactionType = "Deposit") - SUM(OutAmount where TransactionType = "depositdeduct") - SUM(OutAmount where TransactionType = "ReturnDeposit")`. The query groups by `(CreditOrganizationId, TransactionType)` and applies each subtotal.

9. **Organization Deposit writes one `EmpCashTransaction` per payment-mode split** — the `OrganizationDeposit_DTO.empCashTransactionModel` list lets the operator record a single deposit funded by multiple payment modes (e.g. 5,000 cash + 5,000 bank). Each entry produces one `TXN_EmpCashTransaction` row.

10. **`PatientSchemeRefundsList_DTO` is ordered by `RefundedDate DESC`** — the most recent refund is on top. Used by the patient overview page.

11. **EMPI is 16 characters, deterministic-but-random** — `CommonController.CreateEmpi(PatientModel obj)`:
    - Chars 1-3: first 3 chars of the country sub-division name.
    - Chars 4-9: `DOB.ToString("ddMMyy")` (or `""` if DOB is null — caller is expected to ensure DOB is set).
    - Chars 10-12: `F + (M or "X") + L` initials (middle name falls back to `"X"`).
    - Chars 13-16: a 4-digit `Random().Next(1000, 10000)` (inclusive-exclusive) suffix.
    - The whole string is upper-cased before being assigned back to `obj.EMPI`.

12. **`Like` extension escapes regex metacharacters** — `DanpheStringExtension.Like(searchExpression, searchKey)` first applies a regex `Replace` over the **search key** to escape `.`, `$`, `^`, `{`, `[`, `(`, `|`, `)`, `*`, `+`, `?`, `\`. Then `_` -> `.`, `%` -> `.*`. The final regex is `\A<replaced-key>\z` with `RegexOptions.Singleline`. Result: `LIKE`-style patterns work, regex injection does not.

13. **Nepali date conversion year range** — `DanpheDateConvertor.ConvertEngToNepDate` only handles English years `1900 < engDate.Year < 2032`. Outside that range the function returns an empty `NepaliDateType` (Year/Month/Day all zero). The verified year range is 1944 AD / 2001 BS onward; pre-2001 BS data is best-effort.

14. **Nepali year data lives in two forms** — `NepaliDateModel.yr_mth` (year -> list of 12 month-day-counts) covers 1950-2090 BS. `NepaliDateModel.calYear` covers 1950-2100 BS. `NepaliDateModel.engYearsHash` covers 1900-2040 AD. The model is a `static` class initialized once in the static constructor (`NepaliDateModel` -> `LoadNepYear_MthHash`).

15. **File upload size limit** — `CommonController` is decorated with `[RequestFormSizeLimit(valueCountLimit: 1000000)]`. The server enforces a per-request 1,000,000-file cap.

16. **Audit field injection is opt-in** — `CommonController.AddAuditField(dbContext)` only adds `ChangedByUserId` + `ChangedByUserName` if `MyConfiguration.IsAuditEnable == true`. The toggle is in `appsettings.json`.

17. **`PACS` connection string is separate** — `MyConfiguration.ConnectionStringPACSServer` is exposed in addition to the main `Connectionstring` and admin `ConnectionStringAdmin` so PACS queries don't compete with the main app pool.

18. **Google Drive is the optional file-storage backend** — `MyConfiguration.GoogleDriveFileUpload` carries the `ServiceAccountKey` JSON, `LoggerFilePath`, `UploadFileBasePath`, and `FileUrlCommon`. If present, files can be uploaded to Google Drive instead of (or in addition to) the local `FileStorageRelativeLocation`. This is configured per deployment.

19. **`ServerSidePrinter` is single-threaded per file** — the `LoadPrinter.FileProcessor` handler sets `timer1.Enabled = false` for the duration of the print loop, then re-enables it. This guarantees only one print job is in flight, but means a hung printer stalls the queue.

20. **`ServerSidePrinter` deletes files after a successful print** — the file's lifetime on disk is "until the next timer tick after the print job completes." A failed print (e.g. printer offline) is retried on the next tick because the file is still on disk.

21. **`UTL_CFG_ProcessConfirmationAuthority` is the matrix-of-trust for high-risk operations** — a row `(ProcessToConfirm, PermissionId, RoleId)` says: "Role `<RoleId>` holding permission `<PermissionId>` may confirm process `<ProcessToConfirm>`." Every cross-module high-risk confirm gate reads this table.

22. **No Scheme Refund <-> Account transfer integration is wired today** — `SchemeRefundModel.IsTransferredToAcc` is a `bool` column reserved for the future accounting hand-off. It is `false` on insert and no scheduled job updates it in the current code base.

23. **Refund / deposit amounts are stored as `decimal` (not `double`)** in the `SchemeRefundModel.RefundAmount`, `BillingDepositModel.InAmount` / `OutAmount` / `DepositBalance` columns. The cash-side mirror `EmpCashTransactionModel.InAmount` / `OutAmount` is `double` — this is a known type mismatch; calculations on the mirror are cast through `(double)` and back.

24. **All write endpoints run inside an EF `dbContextTransaction`** — `UtilitiesService` opens `dbContextTransaction` for every write and explicitly `Commit()` on success / `Rollback()` on exception. The `CommonController.InvokeHttpPostFunctionSingleTransactionScope` wrapper does the same for endpoints that want to commit the transaction inside the controller (not used by Utilities today).

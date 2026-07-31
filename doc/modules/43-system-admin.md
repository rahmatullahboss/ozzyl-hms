# Module 43 — SystemAdmin (Audit Logs, DB Backup/Restore, IRD Reports, Sales Book)

> Reference documentation for the DanpheEMR **SystemAdmin** module. Covers the audit trail subsystem (per-row change tracking via Entity Framework audit middleware), database backup and restore (with version compatibility check and daily frequency limit), SQL Server native audit log readback, IRD (Inland Revenue Department, Nepal) invoice reporting, sales book reports (combined Billing + Pharmacy), login/logout tracking, the admin-database parameters registry, and the export-database feature. The single source of truth for understanding system administration and audit in DanpheEMR without re-reading the .NET source.

---

## 1. Module Overview

The SystemAdmin module is the **cross-cutting operational, compliance, and audit surface** of DanpheEMR. It is not a domain module in the clinical/billing sense — it is the back-office tooling that (a) keeps the database recoverable, (b) records every change made by every user for legal and debugging purposes, (c) produces the tax reports required by the Nepalese Inland Revenue Department (IRD), and (d) tracks who logged in when.

The module is organized around the following sub-domains:

| Sub-domain | Purpose |
|---|---|
| **Database backup** | Take a full `.BAK` of the live EMR database on demand, log the backup into `SysAdmin_DBLog`, and prune old backup files beyond a configurable retention. |
| **Database restore** | Restore the live DB from a previously-taken `.BAK`. Before restoring, a fresh backup is taken automatically, the version compatibility is checked, and the live DB is set to `SINGLE_USER` mode for the duration of the restore. |
| **Per-row audit trail** | Read-only view of every change made to every audited table — by whom, when, on which row, with the previous and new column values. Backed by the Entity Framework `Audit` NuGet which serializes `EntityFrameworkEvent.Entries` to JSON into `DanpheAudit`. |
| **SQL Server native audit log** | Read-only view of DDL/DML events captured by SQL Server's `sys.fn_get_audit_file()` (CREATE, ALTER, DROP, SELECT, INSERT, UPDATE, DELETE, TABLE, VIEW, TRIGGER, STORED_PROCEDURE, LOGIN_INFO, SERVER_ACTIVITY). |
| **Login information** | Every login, logout, and invalid-attempt is recorded with timestamp and employee id. The `LoginInformation` page shows this list filtered by date range. |
| **IRD invoice reporting** | Government-facing tax report. Three endpoints: `IRDInvoiceDetails` (Billing transactions only), `AllIRDInvoiceDetails` (Billing + Pharmacy combined with item breakdown), `PharmacyIRDInvoiceDetails` (Pharmacy transactions only). Each row is a tax-invoice line with PAN, fiscal year, taxable amount, tax, total, sync status, print count, payment method. |
| **Sales book** | Internal counterpart to the IRD report. Two views: an older version (SalesBookReportComponent) that calls both billing and pharmacy endpoints and merges the results client-side, and a newer version (NewSalesBookComponent) that calls the consolidated `AllIRDInvoiceDetails` endpoint and parses the `ItemNameAndQuantity` JSON column for per-line items. |
| **System parameters** | The `SysAdmin_Parameters` table is the system-wide configuration registry. The SystemAdmin view exposes this read-only to the front-end (no UI for editing; managed via SQL). |
| **Database export** | Export every table in the live DB to CSV (via `SP_ExportDBToCSV`), XML (via `SP_ExportDBToXML`), or PDF (one PDF per table, generated server-side via iTextSharp from the CSV files). |

### Key design characteristics

- **Two-database trust model** — the system uses *two* database servers. The **main EMR database** (e.g. `Danphe_EMR_LIVE`) holds all clinical/billing/pharmacy data, the RBAC tables, and the audit-event JSON. The **admin database** (`DanpheAdmin`) holds `SysAdmin_DBLog`, `SysAdmin_Parameters`, `DanpheLogInInformation`, `Danphe_CookieAuthInfo`, `DanpheAudit`, and `tbl_AuditTableDisplayName`. Connection strings come from `MyConfiguration` and are decrypted at startup. The admin connection string is `connStringAdmin`; the main EMR connection string is `connString`. They are passed separately into `SystemAdminController`'s constructor.
- **EF-context per database** — `SystemAdminDbContext` reads/writes admin-DB tables; `ReportingDbContext` reads from the main EMR DB (it is also used by the Reporting module for IRD reads and audit reads). The controller owns both contexts for the lifetime of the request.
- **Stored-procedure-as-action pattern for backup/restore** — the actual `BACKUP DATABASE` TSQL, the `xp_delete_file` cleanup, and the version-check + single-user toggle are all in stored procedures in the admin DB (`SP_SysADM_Backup_Database`, `SP_SysADM_Delete_DatabaseBackup`, `SP_SysADM_Insert_DBLog`). The C# code is a thin RPC wrapper that opens a `SqlConnection`, sets a 5-minute command timeout, and forwards parameters.
- **Audit trail is read-only from this module** — writes happen transparently via the `[AuditApi]` attribute and the `Audit.Net.EntityFramework` interceptor (see `Utilities/DanpheActionFilter.cs` and `App_Start/AuditNet`). The SystemAdmin module only *reads* the audit data and exposes it through a filterable grid.
- **Audit JSON shape** — every audit row in `DanpheAudit` stores a single `nvarchar(max)` `Data` column containing the Audit.NET event JSON. The `Fn_Danphe_Audit` table-valued function flattens this JSON using `JSON_VALUE` and `OPENJSON` to produce one row per changed entity with columns `Table_Name`, `ActionName`, `PrimaryKey`, `ColumnValues` (which is itself a JSON array of `{Name, OldValue, NewValue}`).
- **Audit data is read across two databases** — the audit functions live in `DanpheAdmin` (the admin DB), but they `JOIN` against `RBAC_User` in the *live* EMR DB. The `LiveDBName` parameter from `SysAdmin_Parameters` is used to build a dynamic SQL string, so the same code works across hospitals whose live DB has different names.
- **IRD as a "virtual reporting" surface** — there is no IRD-specific domain table. The IRD report is a stored-procedure projection (`SP_IRD_InvoiceDetails`, `SP_All_IRD_InvoiceDetails`, `SP_IRD_PHRM_InvoiceDetails`) that joins `BIL_TXN_BillingTransaction`, `BIL_TXN_BillingTransactionItems`, `PHRM_TXN_Invoice`, `PHRM_TXN_InvoiceItems`, and the employee master into a flat IRD-shaped row.
- **Daily backup cap enforced server-side** — the parameter `DaillyDBBackupLimit` (default `5`) is checked at the start of every `DatabaseBackup` POST. If the count of today's successful backups already equals the cap, the call fails with `"Today You have already taken {n} DB backup"`.
- **Retention deletion via `xp_delete_file`** — after a successful backup, the system calls `SP_SysADM_Delete_DatabaseBackup`, which reads `DbBackupDays` (default `5`), builds a cutoff date, and invokes the SQL Server extended procedure `master.dbo.xp_delete_file` to physically remove the old `.BAK` files. The corresponding `SysAdmin_DBLog` rows are marked `IsActive=0, DeleteOn=getdate()`.
- **iTextSharp 5.5.13 for PDF export** — the `ExportDatabase(ExportType="PDF")` path does not use SQL Server; it reads `SELECT name FROM sys.tables`, runs `SELECT * FROM <table>` for each one, and emits one PDF per table using iTextSharp with auto-scaling page width (500/1000/1500/2000/2500/3000 based on column count). The CSVs are first generated via `SP_ExportDBToCSV`; the iTextSharp path is the server-side renderer for the CSV-to-PDF step (see comment block at `SystemAdminController.cs:1011-1108`).

### Cross-cutting hooks

The SystemAdmin module touches (or is touched by) virtually every other module:

- **Login/logout hooks** — `AccountController.Login` (5 sites) and `AccountController.Logout` call `adminDbContext.LoginInformation.Add(...)` to record every authentication event. The `LoginInformation` page reads this table.
- **Audit-trail hooks** — every controller that uses `RbacDbContext` (or any other `DbContext`) is wrapped by the Audit.NET EF interceptor (configured in `App_Start/AuditNet`). Every `SaveChanges()` produces one row in `DanpheAudit.Data` with the full `EntityFrameworkEvent` JSON, including the changed table, the action, the primary key, and the column values.
- **DB-backup storage** — the backup folder path is the `DbBackupFolderPath` parameter (default `C:\DanpheHealthInc_PvtLtd_Files\Data\DbBackup\`). The folder is created on demand if missing. The same path is read by the restore flow to locate the `.BAK` file.
- **System parameters** — many other modules read `SysAdmin_Parameters` directly: `BillingHeader` (Billing/Sales Book), `CalendarTypes` (Sales Book), `LiveDBName` (audit dynamic SQL), `SQLAuditFilePath` (SQL audit readback), `DbBackupFolderPath` / `DbBackupDays` / `DatabaseCurrentVersion` / `DaillyDBBackupLimit` (this module).

---

## 2. Backend Files

### 2.1 Controllers

| File | Lines | Route prefix | Purpose |
|---|---|---|---|
| `Controllers/SystemAdmin/SystemAdminController.cs` | 1111 | `/api/SystemAdmin/*` | **Main API surface.** 12 endpoints (9 GET, 3 POST). Owns three DbContexts (`SystemAdminDbContext` for admin DB, `ReportingDbContext` for live DB, `RbacDbContext` for user lookups). Houses the `BackupDatabase` (calls `SP_SysADM_Backup_Database`), `RestoreDatabase` (sets single-user, restores, sets multi-user, logs), `ExportDatabaseToCSVOrXMLOrPDF`, `SaveTablesToPdf` (iTextSharp) private methods. |
| `Controllers/SystemAdmin/SystemAdminViewController.cs` | 46 | `/SystemAdminView/*` | **MVC view surface.** Five actions that return `.cshtml` views: `SystemAdminMain` (default), `DatabaseBackup`, `InvoiceDetails`, `DatabaseAudit`, `SalesBookReport`, `PHRMSalesBookReport`. (No `DanpheViewFilter` is currently applied — the routing is permissioned entirely by Angular `AuthGuardService`.) |
| `Controllers/AccountController.cs` | 635 | `/Account/*`, `/api/Account/*` | **Login hooks into SystemAdmin.** 5 sites (`Login` form + JWT, `Logout`, ForgotPassword, GetLoginJwtToken) write to `LoginInformation` (see `AccountController.cs:224, 267, 300, 569, 606`). This is the only place outside `SystemAdminController` that writes to admin DB. |

### 2.2 Key methods on `SystemAdminController`

| Method | HTTP | Route | Lines | What it does |
|---|---|---|---|---|
| `GetDatabaseBakupLogs` | GET | `DatabaseBakupLogs` | 50-71 | Returns all `SysAdmin_DBLog` rows ordered by `CreatedOn` desc. Anonymous-shaped projection (no model class on the wire). |
| `GetAuditTrialDetails` | GET | `AuditTrialDetails` | 72-81 | Calls `ReportingDbContext.AuditTrails(FromDate, ToDate, Table_Name, UserName, ActionName)` → `SP_Danphe_Audit` → `Fn_Danphe_Audit()` joined with `RBAC_User`. Returns a `DataTable`. |
| `AuditList` | GET | `AuditList` | 84-91 | Returns the filter metadata: `UserList` (from `RbacDbContext.Users`), `TableNameList` (from `SP_Danphe_Audit_List`), `TableDisplayNameMap` (from `tbl_AuditTableDisplayName` filtered by `IsActive=true`). |
| `GetLoginInformation` | GET | `LoginInformation` | 96-103 | Returns `LoginInformation` rows between `fromDate` and `toDate` (truncated to date). |
| `IRDInvoiceDetails` | GET | `IRDInvoiceDetails` | 106-112 | Calls `ReportingDbContext.InvoiceDetails(FromDate, ToDate)` → `SP_IRD_InvoiceDetails`. |
| `AllIRDInvoiceDetails` | GET | `AllIRDInvoiceDetails` | 116-121 | Calls `ReportingDbContext.GetAllInvoiceDetails(FromDate, ToDate)` → `SP_All_IRD_InvoiceDetails` (billing + pharmacy combined with item breakdown). |
| `PharmacyIRDInvoiceDetails` | GET | `PharmacyIRDInvoiceDetails` | 124-130 | Calls `ReportingDbContext.PhrmInvoiceDetails(FromDate, ToDate)` → `SP_IRD_PHRM_InvoiceDetails`. |
| `DatabaseActivity` | GET | `DatabaseActivity` | 133-139 | Calls `ReportingDbContext.SqlAuditDetails(FromDate, ToDate, LogType)` → `SP_Danphe_SQLAudit` with one of 14 LogType values. |
| `GetSystemAdmin` | GET | `SystemAdmin` | 142-158 | Returns all `SysAdmin_Parameters` ordered by `ParameterId`. |
| `DatabaseBackup` | POST | `DatabaseBackup` | 322-329 | Wraps `PostDatabaseBackup()`: checks folder path → checks daily frequency cap → calls `SP_SysADM_Backup_Database` → on success calls `SP_SysADM_Delete_DatabaseBackup` to prune old files. |
| `RestoreDatabase` | POST | `RestoreDatabase` | 332-339 | Wraps `PostRestoreDatabase(ipDataStr)`: validates the .BAK exists, validates version compatibility, takes a fresh backup, sets live DB to `SINGLE_USER`, runs `RESTORE DATABASE ... WITH REPLACE`, sets back to `MULTI_USER`, writes a new `SysAdmin_DBLog` row with `Action='restore'`. |
| `ExportDatabase` | POST | `ExportDatabase?ExportType={csv|xml|pdf}` | 342-350 | Wraps `PostExportDatabase(ExportType)`: reads `DBExportCSVXMLDirPath` parameter, creates the `<type>` sub-folder, deletes old files if PDF, then dispatches to `SP_ExportDBToCSV`, `SP_ExportDBToXML`, or `SaveTablesToPdf`. |

### 2.3 Private helpers (also on `SystemAdminController`)

| Method | Lines | Purpose |
|---|---|---|
| `CheckBackupFolderPath()` | 750-770 | Reads `DbBackupFolderPath` from `SysAdmin_Parameters`, creates the directory if missing, returns true if `Directory.Exists`. |
| `CheckDBBackupFileExist(string filePath)` | 773-783 | (Defined but never called.) Wrapper around `Directory.Exists`. |
| `CheckDBVersionForRestore(string backupFileVersion)` | 786-802 | Reads `DatabaseCurrentVersion` from parameters, returns `dbCurrentVersion == backupFileVersion`. |
| `BackupDatabase(string connStringAdmin)` | 806-833 | Opens a `SqlConnection`, sets `CommandTimeout = 300` (5 minutes), executes `SP_SysADM_Backup_Database` with `@CreatedBy=currentUser.EmployeeId, @ActionType='manual'`, returns `true` if the SP returns the string `"success"`. |
| `RestoreDatabase(string connStringAdmin, DatabaseLogModel logData)` | 836-882 | Opens two connections (admin + live). Runs `ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`, then `USE MASTER; RESTORE DATABASE [{name}] FROM DISK='{path}' WITH REPLACE`, then `ALTER DATABASE [{name}] SET MULTI_USER`. Then sets `logData.IsDBRestorable=false; Action='restore'; ActionType='manual'; Status='success'; MessageDetail='Database restore successfully'; IsActive=false;` and calls `PostDBLog`. |
| `DeleteOldBackupFiles(string connStringAdmin)` | 885-904 | Calls `SP_SysADM_Delete_DatabaseBackup`. |
| `CheckTodaysBackup()` | 907-926 | LINQ query over `SysAdmin_DBLog` filtered to `CreatedOn.Year == now.Year && .Month == now.Month && .Day == now.Day && Action == 'backup' && Status == 'success'`. Returns the count. |
| `PostDBLog(string connStringAdmin, DatabaseLogModel)` | 929-963 | Calls `SP_SysADM_Insert_DBLog` with 11 parameters. Sets `databaseLogModel.CreatedBy = currentUser.EmployeeId` first. |
| `ExportDatabaseToCSVOrXMLOrPDF(string connString, string ExportType, string exportedFilePath)` | 966-1008 | Creates the `<type>` sub-folder, deletes old PDF files (but not CSV/XML), then dispatches to either `SaveTablesToPdf` (for PDF) or `SP_ExportDBToCSV` / `SP_ExportDBToXML`. |
| `SaveTablesToPdf(string connString, string exportedFilePath)` | 1012-1108 | The iTextSharp 5.5.13 PDF renderer. Loops over `SELECT name FROM sys.tables`, runs `SELECT * FROM {name}`, and for each table creates a `PdfPTable` with auto-scaling page width (`width = columnCount <= 9 ? 500 : ...`). Adds a heading row with the table name, then a header row with column names, then a row per record. |

### 2.4 Data layer

| File | Lines | Purpose |
|---|---|---|
| `Components/DanpheEMR.DalLayer/SystemAdminDbContext.cs` | 38 | EF context for the **admin DB**. Exposes 5 DbSets: `DatabaseLog` (`SysAdmin_DBLog`), `AdminParameters` (`SysAdmin_Parameters`), `LoginInformation` (`DanpheLogInInformation`), `CookieInformation` (`Danphe_CookieAuthInfo`), `AuditTableDisplayNames` (`tbl_AuditTableDisplayName`). All table names mapped in `OnModelCreating`. |
| `Components/DanpheEMR.DalLayer/ReportingDbContext.cs` (audit/IRD section) | 85 lines, 1297-1374 | Hosts the IRD and audit-trail methods. `InvoiceDetails` → `SP_IRD_InvoiceDetails`; `GetAllInvoiceDetails` → `SP_All_IRD_InvoiceDetails`; `PhrmInvoiceDetails` → `SP_IRD_PHRM_InvoiceDetails`; `SqlAuditDetails` → `SP_Danphe_SQLAudit`; `AuditTrailList` → `SP_Danphe_Audit_List`; `AuditTrails` → `SP_Danphe_Audit` (returns a `DataTable`). |
| `Components/DanpheEMR.ServerModel/SystemAdminModels/*` | (7 files) | EF model classes — see §3. |
| `Components/DanpheEMR.ServerModel/MasterModels/LoginInformationModel.cs` | 19 | EF model for `DanpheLogInInformation`. `InformationId` (PK), `EmployeeId` (nullable), `UserName`, `ActionName` (`login`/`logout`/`invalid-login-attempt`), `CreatedOn`. |
| `Components/DanpheEMR.ServerModel/MasterModels/CookieAuthInfoModel.cs` | (read elsewhere) | EF model for `Danphe_CookieAuthInfo` (Remember-Me cookie). |

### 2.5 NuGet / project dependencies

| Package | Version | Used by |
|---|---|---|
| `iTextSharp` | 5.5.13 | `SaveTablesToPdf` — PDF generation. |
| `EntityFramework` | 6.x | All DB access via DbContext. |
| `System.Data.SqlClient` | (built-in) | Direct `SqlConnection`/`SqlCommand` for SP-based flows (backup, restore, export, log insert). |
| `Audit.NET.EntityFramework` | (in `App_Start`) | Implicit writes to `DanpheAudit.Data` on every `SaveChanges()`. |

---

## 3. Data Models (EF entity classes)

All under `DanpheEMR.ServerModel` (some under the `SystemAdminModels` sub-namespace).

### 3.1 `DatabaseLogModel` — `SysAdmin_DBLog`

`Components/DanpheEMR.ServerModel/SystemAdminModels/DatabaseLogModel.cs` (29 lines)

| Property | Type | Notes |
|---|---|---|
| `DBLogId` | `int` (PK, IDENTITY) | Surrogate key. |
| `FileName` | `string` | The `.BAK` filename, format `YYYYMMDDHHMMSS_<dbname>.BAK`. |
| `FolderPath` | `string` | Full path of the backup folder, from `DbBackupFolderPath` parameter. |
| `DatabaseName` | `string` | Name of the live DB, from `LiveDBName` parameter. |
| `DatabaseVersion` | `string` | Snapshot of `DatabaseCurrentVersion` at the time of the backup. |
| `IsDBRestorable` | `bool?` | `true` for the most recent successful backup, `false` for all others. |
| `Action` | `string` | `backup` \| `restore`. |
| `ActionType` | `string` | `manual` (always; auto backup is not implemented). |
| `Status` | `string` | `success` \| `failed`. |
| `MessageDetail` | `string` (max) | Free-text, e.g. `"Database backup successfully taken."` or `ERROR_MESSAGE()`. |
| `Remarks` | `string` (300) | User-supplied, required at restore time. |
| `CreatedBy` | `int?` | `RbacUser.EmployeeId` at the time of the action. |
| `CreatedOn` | `DateTime?` | Set by `SP_SysADM_Insert_DBLog` via `getdate()`. |
| `DeleteOn` | `DateTime?` | Set by `SP_SysADM_Delete_DatabaseBackup` when the file is pruned. |
| `IsActive` | `bool?` | `true` for live rows, `false` for restored or pruned. |

### 3.2 `AdminParametersModel` — `SysAdmin_Parameters`

`Components/DanpheEMR.ServerModel/SystemAdminModels/SysAdmin_Parameters.cs` (22 lines)

| Property | Type | Notes |
|---|---|---|
| `ParameterId` | `int` (PK, IDENTITY) | Surrogate key. |
| `ParameterGroupName` | `string` | `Admin`, `Common`, `SysAdmin`, `Billing`, etc. |
| `ParameterName` | `string` (200) | e.g. `DbBackupFolderPath`, `DatabaseCurrentVersion`, `LiveDBName`. |
| `ParameterValue` | `string` (1000) | Free-text value, often JSON. |
| `ValueDataType` | `string` | Hint only — typically `string`, `int`, `bool`. Not enforced. |
| `Description` | `string` (1000) | Human-readable. |
| `ParameterType` | `string` | Optional sub-grouping. |
| `ValueLookUpList` | `string` | Optional comma-separated list of allowed values. |

Unique constraint: `(ParameterGroupName, ParameterName)`.

### 3.3 `AuditTrailModel` — flattened row of `Fn_Danphe_Audit()`

`Components/DanpheEMR.ServerModel/SystemAdminModels/AuditTrailModel.cs` (28 lines)

| Property | Type | Notes |
|---|---|---|
| `AuditId` | `int` (PK) | The `DanpheAudit.AuditId`. |
| `InsertedDate` | `DateTime` | When the row was written. |
| `DbContext` | `string` | Mapped from `$.EventType` in the audit JSON. |
| `MachineUserName` | `string` | From `$.Environment.UserName`. |
| `MachineName` | `string` | From `$.Environment.MachineName`. |
| `DomainName` | `string` | From `$.Environment.DomainName`. |
| `CallingMethodName` | `string` | From `$.Environment.CallingMethodName`. |
| `ChangedByUserId` | `string` | From `$.ChangedByUserId`. |
| `ChangedByUserName` | `string` | From `$.ChangedByUserName`. |
| `Table_Database` | `string` | From `$.EntityFrameworkEvent.Database`. |
| `ActionName` | `string` | From `$.EntityFrameworkEvent.Entries[i].Action` (`Insert`/`Update`/`Delete`). |
| `Table_Name` | `string` | From `$.EntityFrameworkEvent.Entries[i].Table`. |
| `PrimaryKey` | `string` | From `$.EntityFrameworkEvent.Entries[i].PrimaryKey` (rendered as JSON). |
| `ColumnValues` | `string` (max) | From `$.EntityFrameworkEvent.Entries[i].ColumnValues` (rendered as JSON array of `{Name, OldValue, NewValue}`). |

### 3.4 `AuditTableDisplayName` — `tbl_AuditTableDisplayName`

`Components/DanpheEMR.ServerModel/SystemAdminModels/AuditTableDisplayName.cs` (18 lines)

| Property | Type | Notes |
|---|---|---|
| `AuditTableDisplayNameId` | `int` (PK, IDENTITY) | Surrogate key. |
| `DisplayName` | `string` (100) | Human-friendly label shown in the audit-trail table-name dropdown. |
| `TableName` | `string` (100) | The actual SQL table name used by `SP_Danphe_Audit`. |
| `IsActive` | `bool` | Soft-delete flag. Filtered to `true` by `AuditList`. |

Seeded with 4 rows: `Pharmacy Invoice Transaction` → `PHRM_TXN_Invoice`, `Pharmacy Invoice Invoice Items` → `PHRM_TXN_InvoiceItems`, `Billing Transaction` → `BIL_TXN_BillingTransaction`, `Patient` → `PAT_Patient`.

### 3.5 `SqlAuditModel` — row of `sys.fn_get_audit_file()`

`Components/DanpheEMR.ServerModel/SystemAdminModels/SqlAuditModel.cs` (23 lines)

| Property | Type | Notes |
|---|---|---|
| `Event_Time` | `DateTime?` | UTC-offset adjusted by `DATEADD(mi, DATEPART(TZ, SYSDATETIMEOFFSET()), event_time)`. |
| `Server_Instance_Name` | `string` | SQL Server instance. |
| `Database_Name` | `string` | Filtered to the live DB name in the SP. |
| `Statement` | `string` (max) | The TSQL that was run. |
| `Server_Principal_Name` | `string` | The login that ran it. |
| `Action_Id` | `string` | Normalized to `CREATE`/`ALTER`/`DROP`/`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`EXECUTE`/`LOGIN SUCCESSFULLY`/`LOGIN FAILED`/`SERVER STARTED`/`SERVER SHUTDOWN`/etc. inside the SP. |
| `Object_Name` | `string` | Table / view / procedure name. |
| `Session_Id` | `Int16?` | SQL Server `@@SPID`. |
| `Schema_Name` | `string` | `dbo` for most flows. |

### 3.6 `InvoiceDetailsModel` — IRD billing row

`Components/DanpheEMR.ServerModel/SystemAdminModels/InvoiceDetailsModel.cs` (39 lines)

| Property | Type | Notes |
|---|---|---|
| `Fiscal_Year` | `string` | Nepalese fiscal year label. |
| `Bill_No` | `string` | Invoice number. |
| `Customer_name` | `string` | Patient or counterparty name. |
| `PANNumber` | `string` | PAN (Permanent Account Number). |
| `BillDate` | `DateTime` | Invoice date. |
| `Amount` | `double` | Sub-total. |
| `DiscountAmount` | `double` | Discount applied. |
| `Taxable_Amount` | `double` | Base for tax. |
| `Tax_Amount` | `double` | VAT/sales tax. |
| `Total_Amount` | `double` | Grand total. |
| `VAT_Refund_Amount` | `double` | Refundable portion, if any. |
| `SyncedWithIRD` | `string` | `Y`/`N` flag. |
| `Is_Printed` | `string` | `Yes`/`No`. |
| `Printed_Time` | `string` | Timestamp of the last print. |
| `Entered_by` | `string` | User who created the bill. |
| `Printed_by` | `string` | User who last printed it. |
| `Is_Bill_Active` | `string` | Soft-delete indicator. |
| `Is_Realtime` | `string` | `Y` if the bill was pushed to IRD in real time. |
| `Payment_Method` | `string` | Cash / Card / Cheque / Online. |
| `TransactionId` | `string` | Online payment transaction id. |
| `ItemNameAndQuantity` | `string` (max, `[NotMapped]`) | JSON-serialized per-line items — added by `SP_All_IRD_InvoiceDetails` so the new sales book can show item-level breakdown. |

### 3.7 `PhrmInvoiceDetails` — IRD pharmacy row

`Components/DanpheEMR.ServerModel/SystemAdminModels/PhrmInvoiceDetails.cs` (36 lines)

Same shape as `InvoiceDetailsModel` (no `[NotMapped]` field; uses `decimal` instead of `double`; adds `BillType` and `NonTaxable_Amount`).

### 3.8 `LoginInformationModel` — `DanpheLogInInformation`

`Components/DanpheEMR.ServerModel/MasterModels/LoginInformationModel.cs` (19 lines)

| Property | Type | Notes |
|---|---|---|
| `InformationId` | `int` (PK, IDENTITY) | Surrogate key. |
| `EmployeeId` | `int?` | `null` for invalid-attempt rows. |
| `UserName` | `string` | Always set (even for invalid attempts). |
| `ActionName` | `string` | `login` \| `logout` \| `invalid-login-attempt`. |
| `CreatedOn` | `DateTime` | UTC time of the event. |

---

## 4. Database Tables

All admin-DB tables live in the `DanpheAdmin` database (separate from the live EMR DB).

### 4.1 `SysAdmin_DBLog` (admin DB)

Source: `Database/1. Admin-Db/1. DanpheAdmin_CompleteDB.sql:41`

```sql
CREATE TABLE [dbo].[SysAdmin_DBLog](
    [DBLogId]          [int] IDENTITY(1,1) NOT NULL,
    [FileName]         [varchar](50)   NULL,
    [FolderPath]       [varchar](100)  NULL,
    [DatabaseName]     [varchar](50)   NULL,
    [DatabaseVersion]  [varchar](10)   NULL,
    [IsDBRestorable]   [bit]           NULL,
    [Action]           [varchar](20)   NULL,   -- 'backup' | 'restore'
    [ActionType]       [varchar](10)   NULL,   -- 'manual' (always)
    [Status]           [varchar](10)   NULL,   -- 'success' | 'failed'
    [MessageDetail]    [varchar](max)  NULL,
    [Remarks]          [varchar](300)  NULL,
    [CreatedBy]        [int]           NULL,
    [CreatedOn]        [datetime]      NULL,
    [DeleteOn]         [datetime]      NULL,
    [IsActive]         [bit]           NULL,
    CONSTRAINT [PK_SysAdmin_DBLog_DBLogId] PRIMARY KEY CLUSTERED ([DBLogId] ASC)
);
```

One row per backup or restore attempt. After `SP_SysADM_Backup_Database` succeeds, an `UPDATE` sets `IsDBRestorable=1` for the just-inserted row and `IsDBRestorable=0` for all prior rows — so at any time exactly one row has `IsDBRestorable=1` (the most recent successful backup). After `SP_SysADM_Delete_DatabaseBackup` prunes files older than `DbBackupDays`, the corresponding rows get `IsActive=0, DeleteOn=getdate()`.

### 4.2 `SysAdmin_Parameters` (admin DB)

Source: `Database/1. Admin-Db/1. DanpheAdmin_CompleteDB.sql:68`

```sql
CREATE TABLE [dbo].[SysAdmin_Parameters](
    [ParameterId]        [int] IDENTITY(1,1) NOT NULL,
    [ParameterGroupName] [varchar](100)  NULL,
    [ParameterName]      [varchar](200)  NULL,
    [ParameterValue]     [varchar](1000) NULL,
    [ValueDataType]      [varchar](50)   NULL,
    [Description]        [varchar](1000) NULL,
    [CreatedOn]          [datetime]      NULL,
    PRIMARY KEY CLUSTERED ([ParameterId] ASC)
);
ALTER TABLE [dbo].[SysAdmin_Parameters] ADD CONSTRAINT [UK_Core_CFG_Parameters]
    UNIQUE NONCLUSTERED ([ParameterGroupName] ASC, [ParameterName] ASC);
```

Seeded values (line 75-86 of the SQL file):

| ParameterId | Group | Name | Value | DataType | Description |
|---|---|---|---|---|---|
| 1 | Admin | `DbBackupFolderPath` | `C:\DanpheHealthInc_PvtLtd_Files\Data\DbBackup\` | string | Backup destination folder. |
| 2 | Admin | `DbBackupDays` | `5` | string | How many days to keep backup files. |
| 3 | Admin | `DatabaseCurrentVersion` | `2.0` | string | Current DB version (used for restore compatibility). |
| 4 | Admin | `DaillyDBBackupLimit` | `5` | string | Max successful backups per day. |
| 5 | Admin | `LiveDBName` | `Danphe_EMR_LIVE` | string | The actual EMR database name. |
| 6 | Common | `SQLAuditFilePath` | `C:\\DanpheHealthInc_PvtLtd_Files\R2V1_Dev\Data\DbAudit\` | string | Folder for SQL Server `.sqlaudit` files. |

Other parameters (managed outside this SQL file, populated at runtime by other modules): `BillingHeader` (Billing/Sales Book), `CalendarTypes` (Sales Book), `DBExportCSVXMLDirPath` (Export feature).

### 4.3 `DanpheAudit` (admin DB)

Source: `Database/1. Admin-Db/1. DanpheAdmin_CompleteDB.sql` (after line 540)

```sql
CREATE TABLE [dbo].[DanpheAudit](
    [AuditId]         [bigint] IDENTITY(1,1) NOT NULL,
    [InsertedDate]    [datetime]      NOT NULL,
    [LastUpdatedDate] [datetime]      NULL,
    [Data]            [nvarchar](max) NOT NULL,
    CONSTRAINT [PK_DanpheAudit] PRIMARY KEY CLUSTERED ([AuditId] ASC)
);
```

This is the **audit trail storage**. One row per `SaveChanges()` call across any `DbContext` in the live DB. The `Data` column contains the full Audit.NET event JSON (including `EntityFrameworkEvent.Entries[*]` with table, action, primary key, and column values). The `Fn_Danphe_Audit` function (see below) flattens this JSON to produce the rows shown in the audit-trail grid.

### 4.4 `Fn_Danphe_Audit()` (admin DB, table-valued function)

Source: SQL file lines 555-600 (approx). Returns a table with 15 columns matching `AuditTrailModel`. Uses `OPENJSON` to walk `$.EntityFrameworkEvent.Entries`, `JSON_VALUE` for scalar fields, and `JSON_QUERY` for nested arrays.

### 4.5 `SP_Danphe_Audit` (admin DB, stored procedure)

Source: SQL file lines 605-650, then re-defined at line 695 onwards to add the `@Action` parameter.

```sql
ALTER PROCEDURE [dbo].[SP_Danphe_Audit]
    @FromDate   datetime     = null,
    @ToDate     datetime     = null,
    @Table_Name varchar(1000) = null,
    @UserName   varchar(100)  = null,
    @Action     varchar(50)   = null
AS
BEGIN
    DECLARE @databaseName varchar(200);
    SET @databaseName = (SELECT TOP(1) ParameterValue
                         FROM SysAdmin_Parameters
                         WHERE ParameterGroupName = 'Admin'
                           AND ParameterName = 'LiveDBName');

    DECLARE @DynamicQuery varchar(8000)
    SET @DynamicQuery = 'SELECT *
       FROM [dbo].[Fn_Danphe_Audit]() tbl1
       WHERE CONVERT(DATE, tbl1.InsertedDate) BETWEEN CONVERT(DATE, ''' + CONVERT(varchar(20), @FromDate) + ''')
             AND CONVERT(DATE, ''' + CONVERT(varchar(20), @ToDate) + ''')'
    -- @Table_Name, @UserName, @Action are appended when non-null
    EXEC (@DynamicQuery)
END
```

This is the only place the system does **dynamic SQL across databases** — it must, because the `Fn_Danphe_Audit` lives in `DanpheAdmin` but the filter context references data in the live DB.

### 4.6 `SP_Danphe_Audit_List` (admin DB)

Source: SQL file line 660.

```sql
CREATE PROCEDURE [dbo].[SP_Danphe_Audit_List]
AS
BEGIN
    SELECT DISTINCT Table_Name FROM dbo.[Fn_Danphe_Audit]()
END
```

Powers the table-name dropdown in the audit-trail filter.

### 4.7 `DanpheLogInInformation` (admin DB)

Source: SQL file (after `SP_Danphe_Audit_List`).

```sql
CREATE TABLE [dbo].[DanpheLogInInformation](
    [InformationId] [int] IDENTITY(1,1) NOT NULL,
    [EmployeeId]    [int]          NULL,
    [UserName]      [varchar](100) NULL,
    [ActionName]    [varchar](100) NULL,    -- 'login' | 'logout' | 'invalid-login-attempt'
    [CreatedOn]     [datetime]     NULL,
    CONSTRAINT [PK_LogInInformationId] PRIMARY KEY CLUSTERED ([InformationId])
);
```

Written by `AccountController` (5 sites — see `AccountController.cs:224, 267, 300, 569, 606`). Read by `SystemAdminController.GetLoginInformation` and displayed in the `Login Informations` grid at the bottom of the audit-trail page.

### 4.8 `Danphe_CookieAuthInfo` (admin DB)

```sql
CREATE TABLE [dbo].[Danphe_CookieAuthInfo](
    [AuthId]       [int] IDENTITY(1,1) NOT NULL,
    [Selector]     [bigint]        NULL,
    [HashedToken]  [varchar](512)  NULL,
    [UserId]       [int]           NULL,
    [Expires]      [datetime]      NULL,
    CONSTRAINT [PK_CookieAuthId] PRIMARY KEY CLUSTERED ([AuthId])
);
```

Backs the "Remember Me" cookie. Written by `AccountController.SetRememberMeCookieVariable` / `UpdateRememberMeCookie`. Not directly read by the SystemAdmin module.

### 4.9 `tbl_AuditTableDisplayName` (admin DB)

Source: SQL file line 749.

```sql
CREATE TABLE [dbo].[tbl_AuditTableDisplayName](
    [AuditTableDisplayNameId] [int] IDENTITY(1,1) NOT NULL,
    [DisplayName]             [nvarchar](100) NULL,
    [TableName]               [nvarchar](100) NULL,
    [IsActive]                [bit]           NULL,
    CONSTRAINT [PK_tbl_AuditTableDisplayName] PRIMARY KEY CLUSTERED ([AuditTableDisplayNameId] ASC)
);
```

Seeded with 4 rows: `PHRM_TXN_Invoice`, `PHRM_TXN_InvoiceItems`, `BIL_TXN_BillingTransaction`, `PAT_Patient`. The `AuditList` endpoint joins this table with the distinct `Table_Name` list from `SP_Danphe_Audit_List` to produce a user-friendly dropdown.

### 4.10 `Danphe_SQLAuditLog` (admin DB, legacy)

Source: SQL file line 21.

```sql
CREATE TABLE [dbo].[Danphe_SQLAuditLog](
    [ServerName]      [nvarchar](128) NULL,
    [LoginName]       [sysname]       NOT NULL,
    [LoginType]       [varchar](13)   NOT NULL,
    [DatabaseName]    [nvarchar](128) NULL,
    [SelectAccess]    [int]           NULL,
    [InsertAccess]    [int]           NULL,
    [UpdateAccess]    [int]           NULL,
    [DeleteAccess]    [int]           NULL,
    [DBOAccess]       [int]           NULL,
    [SysadminAccess]  [int]           NULL,
    [AuditDate]       [datetime]      NOT NULL  -- DEFAULT (getdate())
);
```

Legacy table from the early implementation. Current SQL audit readback goes through `sys.fn_get_audit_file()` directly via `SP_Danphe_SQLAudit`; this table is no longer written to.

### 4.11 Key stored procedures in admin DB (recap)

| SP | Purpose | Called by |
|---|---|---|
| `SP_SysADM_Backup_Database` | `BACKUP DATABASE {LiveDBName} TO DISK='{path}/{file}.BAK'`, then writes a `SysAdmin_DBLog` row. Returns `'success'` or `'failed'`. | `SystemAdminController.BackupDatabase` |
| `SP_SysADM_Delete_DatabaseBackup` | `master.dbo.xp_delete_file 0, @Path, 'BAK', @CutoffDate` then `UPDATE SysAdmin_DBLog SET IsActive=0, DeleteOn=getdate() WHERE CreatedOn < @CutoffDate`. | `SystemAdminController.DeleteOldBackupFiles` |
| `SP_SysADM_Insert_DBLog` | Plain `INSERT` into `SysAdmin_DBLog`. | `SystemAdminController.PostDBLog`, also called internally by `SP_SysADM_Backup_Database` |
| `SP_Danphe_Audit` | Dynamic-SQL query joining `Fn_Danphe_Audit()` over the live DB. | `SystemAdminController.AuditTrialDetails` |
| `SP_Danphe_Audit_List` | Distinct `Table_Name` from audit. | `SystemAdminController.AuditList` |
| `SP_Danphe_SQLAudit` | Dispatches to one of 14 `CASE` branches, each building a dynamic SQL string over `sys.fn_get_audit_file()`. | `SystemAdminController.DatabaseActivity` |
| `SP_ExportDBToCSV` | Iterates `sys.tables` and writes one CSV per table. | `SystemAdminController.ExportDatabaseToCSVOrXMLOrPDF` |
| `SP_ExportDBToXML` | Iterates `sys.tables` and writes one XML per table. | `SystemAdminController.ExportDatabaseToCSVOrXMLOrPDF` |
| `SP_IRD_InvoiceDetails` (in EMR DB) | Billing IRD report. | `SystemAdminController.IRDInvoiceDetails` |
| `SP_All_IRD_InvoiceDetails` (in EMR DB) | Combined Billing+Pharmacy IRD report with item breakdown (sets `ItemNameAndQuantity`). | `SystemAdminController.AllIRDInvoiceDetails` |
| `SP_IRD_PHRM_InvoiceDetails` (in EMR DB) | Pharmacy IRD report. | `SystemAdminController.PharmacyIRDInvoiceDetails` |

---

## 5. Key Workflows

### 5.1 Manual database backup

1. User clicks "Backup" in the Database Backup page. Front-end calls `POST /api/SystemAdmin/DatabaseBackup` with no body.
2. `SystemAdminController.DatabaseBackup` wraps `PostDatabaseBackup()`.
3. `PostDatabaseBackup()` opens a transaction on `SystemAdminDbContext`:
   - **`CheckBackupFolderPath()`** — reads `DbBackupFolderPath`, creates the directory if missing, throws `"Please create Directory(folder) first for Backup."` if it still doesn't exist.
   - **`CheckTodaysBackup()`** — counts `SysAdmin_DBLog` rows where `CreatedOn.Year/Month/Day == today` and `Action == 'backup'` and `Status == 'success'`.
   - Reads `DaillyDBBackupLimit` from `SysAdmin_Parameters` (default `5`). If `todayCount >= limit`, throws `"Today You have already taken {limit} DB backup"`.
   - **`BackupDatabase(connStringAdmin)`** — opens a `SqlConnection` with 5-minute timeout, executes `SP_SysADM_Backup_Database` with `@CreatedBy=currentUser.EmployeeId, @ActionType='manual'`. The SP runs `BACKUP DATABASE @DatabaseName TO DISK = @BackupFullPath` and inserts a `SysAdmin_DBLog` row with `Action='backup', Status='success', IsDBRestorable=1`. The SP also `UPDATE`s all prior backup rows to `IsDBRestorable=0`. Returns the string `'success'`.
   - If backup succeeded: **`DeleteOldBackupFiles(connStringAdmin)`** — calls `SP_SysADM_Delete_DatabaseBackup`, which deletes `.BAK` files older than `DbBackupDays` via `xp_delete_file` and marks the log rows `IsActive=0`.
   - Commits the transaction. Returns `1` to the front-end.
4. Front-end shows `"Database backup is done successfully."` and refreshes the log grid.

### 5.2 Database restore

1. User clicks "Restore" on the most recent successful backup row. Front-end calls `POST /api/SystemAdmin/RestoreDatabase` with the `DatabaseLogModel` (file name, folder path, version) in the body, after prompting for a `Remarks` (required, max 300 chars).
2. `SystemAdminController.RestoreDatabase` wraps `PostRestoreDatabase(ipDataStr)`.
3. Opens a transaction:
   - Validates the `.BAK` file exists at `FolderPath + FileName`. Throws `"There is no backup file for restore, Please Try again."` if not.
   - **`CheckDBVersionForRestore(backupFileVersion)`** — compares to `DatabaseCurrentVersion` parameter. Throws `"Version is not compatible for Restore."` if mismatch.
   - **`BackupDatabase(connStringAdmin)`** — first takes a fresh backup as a safety net.
   - **`RestoreDatabase(connStringAdmin, logData)`** — opens both admin and live connections:
     1. `ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`
     2. `USE MASTER; RESTORE DATABASE [{name}] FROM DISK='{path}' WITH REPLACE;`
     3. `ALTER DATABASE [{name}] SET MULTI_USER`
     4. Sets `logData.IsDBRestorable=false, Action='restore', ActionType='manual', Status='success', MessageDetail='Database restore successfully', IsActive=false`.
     5. **`PostDBLog(connStringAdmin, logData)`** — calls `SP_SysADM_Insert_DBLog` to record the restore event.
   - Commits the transaction. Returns `1`.
4. Front-end shows `"Database restore successfully."` and refreshes the log grid.

### 5.3 Audit-trail viewing

1. User opens the Audit Trail page. Front-end calls `GET /api/SystemAdmin/AuditList` to populate the User and Table filter dropdowns.
2. `AuditList` returns three pieces:
   - `UserList` — every `RBAC.UserName` (from `RbacDbContext`).
   - `TableNameList` — every distinct `Table_Name` from `SP_Danphe_Audit_List`.
   - `TableDisplayNameMap` — rows from `tbl_AuditTableDisplayName` where `IsActive=true` (DisplayName + TableName).
3. User picks one or more Users (multi-select), one or more Tables, and an Action, then clicks "Show Details".
4. Front-end calls `GET /api/SystemAdmin/AuditTrialDetails?fromDate=...&toDate=...&table_Name=PAT_Patient,BIL_TXN_BillingTransaction&userName=admin,jdoe&actionName=Update`.
5. Controller calls `ReportingDbContext.AuditTrails(fromDate, toDate, table_Name, userName, actionName)` → `SP_Danphe_Audit` → `Fn_Danphe_Audit()` joined with the live DB's `RBAC_User` via dynamic SQL.
6. The result is a `DataTable` flattened into one row per changed entity. The grid shows `InsertedDate`, `TableDisplayName`, `ActionName`, `ChangedByUserName`, `MachineName`, and the `ColumnValues` JSON (expandable).
7. Below the audit grid, the same page shows a `Login Informations` grid sourced from `GET /api/SystemAdmin/LoginInformation?fromDate=...&toDate=...` which reads `DanpheLogInInformation`.

### 5.4 IRD invoice reporting

1. User opens the Invoice Details page, picks a date range, and clicks "Show".
2. Front-end calls `GET /api/SystemAdmin/IRDInvoiceDetails?fromDate=...&toDate=...` (billing only) or `AllIRDInvoiceDetails` (combined) or `PharmacyIRDInvoiceDetails` (pharmacy only).
3. Each maps to a stored procedure that joins `BIL_TXN_BillingTransaction` + items + employee + patient → `SP_IRD_InvoiceDetails`; or `BIL_TXN_BillingTransaction` + `PHRM_TXN_Invoice` combined → `SP_All_IRD_InvoiceDetails`; or `PHRM_TXN_Invoice` + items → `SP_IRD_PHRM_InvoiceDetails`.
4. The grid shows `Bill_No`, `Customer_name`, `PANNumber`, `BillDate` (with B.S. conversion via `npCalService.ConvertEngToNepDateString`), `Amount`, `DiscountAmount`, `Taxable_Amount`, `Tax_Amount`, `Total_Amount`, `VAT_Refund_Amount`, `SyncedWithIRD`, `Is_Printed`, `Printed_Time`, `Entered_by`, `Printed_by`, `Payment_Method`, `TransactionId`.
5. Footer summary: `TotalSales`, `TotalDiscountAmount`, `TotalTaxableAmount`, `TotalTaxAmount`, `TotalAmount` (computed in `InvoiceDetailsComponent.calculateSummary` via `Array.reduce`).
6. Grid can be exported to Excel via the danphe-grid's built-in `gridExportOptions`.

### 5.5 Sales book (combined billing + pharmacy)

Two Angular components implement this:

**Older: `SalesBookReportComponent` (`sales-book/sales-book-report.component.ts`)**
- Calls `GetInvoiceDetails(fromDate, toDate)` → `IRDInvoiceDetails` endpoint (billing only).
- Then calls `callBackBillingInvoiceDetails()` → `PharmacyIRDInvoiceDetails` endpoint.
- Merges the two arrays client-side, sorts by `BillDate` desc, prefixes pharmacy bill numbers with `PH`, computes the same summary totals.

**Newer: `NewSalesBookComponent` (`new-sales-book/new-sales-book.component.ts`)**
- Calls `GetAllInvoiceDetails(fromDate, toDate)` → `AllIRDInvoiceDetails` endpoint (combined, with `ItemNameAndQuantity` JSON).
- Parses `ItemNameAndQuantity` JSON into an `ItemDetails[]` array per row (`ItemName`, `Quantity`, `UOM`).
- Optionally still calls `callBackBillingInvoiceDetails()` to merge with pharmacy for backwards-compatibility.
- Renders the same summary footer plus per-bill item breakdown.

The header is built from the `BillingHeader` parameter (JSON with `CustomerName`, `Address`, `CustomerRegLabel`, `CustomerRegNo`); the calendar type (English/Nepali) is read from the `CalendarTypes` parameter under the `SysAdmin` group.

### 5.6 Database activity log (SQL Server native audit)

1. User opens the Database Audit page, picks a date range and one of 14 `LogType` values:
   `CREATE`, `ALTER`, `DROP`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TABLE`, `VIEW`, `TRIGGER`, `STORED_PROCEDURE`, `SCHEMA`, `LOGIN_INFO`, `SERVER_ACTIVITY`.
2. Front-end calls `GET /api/SystemAdmin/DatabaseActivity?fromDate=...&toDate=...&logType=UPDATE`.
3. `SP_Danphe_SQLAudit` switches on `LogType` and builds a dynamic SQL string that calls `sys.fn_get_audit_file('{SQLAuditFilePath}\*.sqlaudit', DEFAULT, DEFAULT)` with the right `action_id` filter (`UP` for UPDATE, `CR/AL/DR` for DDL, `LGIS/LGIF` for logins, `SVSR/SVSD/SVCN/SVPD` for server lifecycle, etc.). The `database_name` is filtered to the `LiveDBName` parameter, and the timestamp is offset-corrected by `DATEADD(mi, DATEPART(TZ, SYSDATETIMEOFFSET()), event_time)`.
4. Returns a `List<SqlAuditModel>` to the front-end, which displays `Event_Time`, `Server_Instance_Name`, `Database_Name`, `Action_Id`, `Schema_Name`, `Object_Name`, `Session_Id`, and the `Statement` (truncated to a reasonable length).

### 5.7 Login information tracking

Wired into `AccountController` (see cross-module §7.1). The `LoginInformation` endpoint reads from `DanpheLogInInformation` with `DbFunctions.TruncateTime(log.CreatedOn) >= fromDate && <= toDate`. The grid in the bottom of the Audit Trail page shows `UserName`, `ActionName` (login / logout / invalid-login-attempt), `CreatedOn`, and (in newer versions) `EmployeeId`.

### 5.8 Database export (CSV / XML / PDF)

1. User picks a type and clicks Export. Front-end calls `POST /api/SystemAdmin/ExportDatabase?ExportType=PDF` with no body.
2. `PostExportDatabase("PDF")`:
   - Reads `DBExportCSVXMLDirPath` from `CoreDbContext.Parameters` (note: this is the *core* parameters table, not `SysAdmin_Parameters`).
   - Calls `ExportDatabaseToCSVOrXMLOrPDF(connString, "PDF", exportedFilePath)`.
   - Inside: creates `<exportedFilePath>\PDF\` sub-folder, **deletes all old PDF files** in it (this only happens for PDF, not CSV/XML).
   - Calls `SaveTablesToPdf(connString, exportedFilePath)`.
3. `SaveTablesToPdf`:
   - `SELECT name FROM sys.tables` → list of all tables.
   - For each table: `SELECT * FROM {name}` → `DataTable`.
   - Page width auto-scales: `columnCount <= 9 ? 500 : columnCount <= 18 ? 1000 : columnCount <= 27 ? 1500 : columnCount <= 36 ? 2000 : columnCount <= 45 ? 2500 : 3000`.
   - Creates one `iTextSharp.text.Document` per table, writes a heading row with the table name (bold blue), a header row with column names (white on gray), and one cell per data row.
   - File name: `{tablename}.pdf` in `<exportedFilePath>\PDF\`.
4. Returns the `exportedFilePath` to the front-end. The user is shown the path in a success message.

### 5.9 System parameters view

1. `GET /api/SystemAdmin/SystemAdmin` returns all rows from `SysAdmin_Parameters` ordered by `ParameterId`.
2. The Database Backup page calls this in its constructor to populate the `SysAdmin` array (used for displaying parameter metadata, not for editing — there is no PUT endpoint).

---

## 6. API Endpoints

All routes are under `/api/SystemAdmin/*` and inherit the JWT auth filter from `CommonController` (since `SystemAdminController : CommonController`).

### 6.1 GET endpoints (9)

| Route | Query params | Returns | Backed by |
|---|---|---|---|
| `GET /DatabaseBakupLogs` | — | `List<DatabaseLogModel>` ordered by `CreatedOn` desc | `SystemAdminDbContext.DatabaseLog` |
| `GET /AuditTrialDetails` | `fromDate`, `toDate`, `table_Name`, `userName`, `actionName` | `DataTable` (flattened audit rows) | `SP_Danphe_Audit` → `Fn_Danphe_Audit()` joined with `RBAC_User` via dynamic SQL |
| `GET /AuditList` | — | `{UserList, TableNameList, TableDisplayNameMap}` | `RbacDbContext.Users` + `SP_Danphe_Audit_List` + `tbl_AuditTableDisplayName` |
| `GET /LoginInformation` | `fromDate`, `toDate` | `List<LoginInformationModel>` | `SystemAdminDbContext.LoginInformation` |
| `GET /IRDInvoiceDetails` | `fromDate`, `toDate` | `List<InvoiceDetailsModel>` (billing only) | `SP_IRD_InvoiceDetails` |
| `GET /AllIRDInvoiceDetails` | `fromDate`, `toDate` | `List<InvoiceDetailsModel>` (billing + pharmacy combined, with `ItemNameAndQuantity` JSON) | `SP_All_IRD_InvoiceDetails` |
| `GET /PharmacyIRDInvoiceDetails` | `fromDate`, `toDate` | `List<PhrmInvoiceDetails>` | `SP_IRD_PHRM_InvoiceDetails` |
| `GET /DatabaseActivity` | `fromDate`, `toDate`, `logType` | `List<SqlAuditModel>` | `SP_Danphe_SQLAudit` |
| `GET /SystemAdmin` | — | `List<AdminParametersModel>` ordered by `ParameterId` | `SystemAdminDbContext.AdminParameters` |

### 6.2 POST endpoints (3)

| Route | Body | Returns | Backed by |
|---|---|---|---|
| `POST /DatabaseBackup` | (empty) | `1` on success, error otherwise | `SP_SysADM_Backup_Database` + `SP_SysADM_Delete_DatabaseBackup` |
| `POST /RestoreDatabase` | `DatabaseLogModel` (JSON, with `Remarks` required) | `1` on success, error otherwise | Inline `ALTER DATABASE ... SINGLE_USER` + `RESTORE DATABASE` + `SP_SysADM_Insert_DBLog` |
| `POST /ExportDatabase?ExportType={csv\|xml\|pdf}` | (empty) | The exported file folder path on success | `SP_ExportDBToCSV` / `SP_ExportDBToXML` / inline iTextSharp PDF writer |

### 6.3 MVC view endpoints (5, in `SystemAdminViewController`)

| Route | Returns view |
|---|---|
| `GET /SystemAdminView/SystemAdminMain` | `SystemAdminMain.cshtml` |
| `GET /SystemAdminView/DatabaseBackup` | `DatabaseBackup.cshtml` |
| `GET /SystemAdminView/InvoiceDetails` | `InvoiceDetails.cshtml` |
| `GET /SystemAdminView/DatabaseAudit` | `DatabaseAudit.cshtml` |
| `GET /SystemAdminView/SalesBookReport` | `SalesBookReport.cshtml` |
| `GET /SystemAdminView/PHRMSalesBookReport` | default view (`.cshtml` not located in current tree) |

### 6.4 Response envelope

All API endpoints return the standard `DanpheHTTPResponse<T>` shape:

```json
{
  "Status": "OK" | "Failed",
  "Results": <T>,
  "ErrorMessage": "..."
}
```

Handled by the front-end via `res.Status == 'OK'` checks; the `MessageboxService` displays `ErrorMessage` on failure.

---

## 7. Cross-Module Integration

The SystemAdmin module is **the most cross-cutting module in the system** — almost every other module implicitly writes into the admin database through login/audit hooks, and many modules read from `SysAdmin_Parameters`.

### 7.1 Login/logout hooks (AccountController → LoginInformation)

Every authentication-related action in `Controllers/AccountController.cs` writes a `LoginInformationModel` to the admin DB:

| Site | Line | When it writes | `ActionName` |
|---|---|---|---|
| `Login` (MVC form, success) | 224 | Valid credentials, `validUser.IsActive == true` | `"login"` |
| `Login` (MVC form, fail) | 267 | Invalid credentials | `"invalid-login-attempt"` |
| `Logout` | 300 | User logs out (skipped if `currentUser == null`) | `"logout"` |
| `Login` (JWT endpoint, success) | 569 | Valid JWT login | `"login"` |
| `Login` (JWT endpoint, fail) | 606 | Invalid JWT login | `"invalid-login-attempt"` |

The `LoginInformation` page on the audit-trail screen reads from this table.

### 7.2 Audit-trail hooks (every DbContext.SaveChanges → DanpheAudit)

The Audit.NET Entity Framework interceptor is configured in `App_Start/AuditNet` and wraps every `SaveChanges()` across all `DbContext` types (`RbacDbContext`, `BillingDbContext`, `PharmacyDbContext`, `LabDbContext`, etc.). Each save produces one row in `DanpheAudit.Data` with the full event JSON, including the changed tables, actions, primary keys, and column values (old + new).

In other words, **every domain table that is touched by an EF save is automatically audited** — there is no opt-in list. The `tbl_AuditTableDisplayName` table is purely a UI hint (mapping SQL table names to friendly display names); it does not gate which tables are audited.

### 7.3 Backup / restore hooks (SystemAdminController → live DB only)

`SP_SysADM_Backup_Database` reads the `LiveDBName` parameter and runs `BACKUP DATABASE {LiveDBName}`. The restore flow toggles `ALTER DATABASE {LiveDBName} SET SINGLE_USER` / `MULTI_USER` on the same DB. **No other modules are directly involved** — but a restore effectively resets the entire live DB, so all in-flight transactions on other modules are killed by the `WITH ROLLBACK IMMEDIATE` clause.

### 7.4 Parameters read by other modules

`SysAdmin_Parameters` is consulted across the system:

| Module | Parameter | Usage |
|---|---|---|
| Billing | `BillingHeader` (under `Common` or `Billing` group) | Hospital name + address on receipts and sales book. |
| Sales Book | `CalendarTypes` (under `SysAdmin` group, value is JSON `{"IRDSalesBook":"en,np"}`) | English/Nepali calendar display toggle. |
| Audit | `LiveDBName` | Dynamic SQL to join `Fn_Danphe_Audit()` with the live DB's `RBAC_User`. |
| SQL Audit | `SQLAuditFilePath` (under `Common` group) | Folder for `*.sqlaudit` files. |
| Backup/Restore | `DbBackupFolderPath`, `DbBackupDays`, `DatabaseCurrentVersion`, `DaillyDBBackupLimit` (all under `Admin` group) | This module. |
| Export | `DBExportCSVXMLDirPath` (under core, not SysAdmin) | Folder for CSV/XML/PDF export. |

### 7.5 Per-table audit display mapping

The seeded `tbl_AuditTableDisplayName` rows (only 4 as of the current SQL file) cover the most-audited tables:

| DisplayName | TableName |
|---|---|
| Pharmacy Invoice Transaction | `PHRM_TXN_Invoice` |
| Pharmacy Invoice Transaction Items | `PHRM_TXN_InvoiceItems` |
| Billing Transaction | `BIL_TXN_BillingTransaction` |
| Patient | `PAT_Patient` |

To add a new friendly label for an audited table, insert a row with `IsActive=1`. The `AuditList` endpoint will pick it up automatically.

---

## 8. Business Rules

### 8.1 Backup rules

| Rule | Source | Behavior |
|---|---|---|
| Folder must exist | `CheckBackupFolderPath` | If `DbBackupFolderPath` is missing, it is created with `Directory.CreateDirectory`. Throws `"Please create Directory(folder) first for Backup."` only if creation itself fails (e.g. permission denied). |
| Daily frequency cap | `CheckTodaysBackup` + `DaillyDBBackupLimit` | A successful backup today counts against the cap. `todayCount >= limit` throws `"Today You have already taken {limit} DB backup"`. Default cap is `5`. |
| Failed backups count | `SP_SysADM_Backup_Database` | A failed backup still writes a `SysAdmin_DBLog` row with `Status='failed'`, but it is **not** counted toward the daily cap (the cap check is on `Status == 'success'`). |
| File naming | `SP_SysADM_Backup_Database` | Format `{YYYYMMDD}{HHMMSS}_{DatabaseName}.BAK`. |
| Retention | `SP_SysADM_Delete_DatabaseBackup` + `DbBackupDays` | After every successful backup, the SP calls `xp_delete_file` to physically remove `.BAK` files older than `DbBackupDays` (default `5`). The corresponding log rows are marked `IsActive=0, DeleteOn=getdate()`. |
| Single-restorable invariant | `SP_SysADM_Backup_Database` | After each successful backup, `UPDATE SysAdmin_DBLog SET IsDBRestorable = (CASE WHEN DBLogId = (current) THEN 1 ELSE 0 END)`. So exactly one row has `IsDBRestorable=1` at any time. The front-end uses `find(a => a.IsDBRestorable == true)` to pick the restore target. |
| Versioning | `DatabaseCurrentVersion` | The current DB version is `2.0`. The version is captured at backup time into `DatabaseVersion`. A restore is only allowed if `currentVersion == backupVersion`. |

### 8.2 Restore rules

| Rule | Source | Behavior |
|---|---|---|
| File existence | `PostRestoreDatabase` | The `.BAK` file at `FolderPath + FileName` must exist on disk. |
| Version compatibility | `CheckDBVersionForRestore` | `currentVersion == backupVersion` else throws `"Version is not compatible for Restore."`. |
| Auto pre-restore backup | `PostRestoreDatabase` | Always takes a fresh backup before restoring, to ensure recoverability if the restore fails. |
| Single-user mode | `RestoreDatabase` private method | `ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE` kills all in-flight connections. |
| Replace clause | `RestoreDatabase` private method | `RESTORE DATABASE [{name}] FROM DISK='{path}' WITH REPLACE` overwrites the existing DB. |
| Multi-user restoration | `RestoreDatabase` private method | `ALTER DATABASE [{name}] SET MULTI_USER` re-opens the DB. |
| Logging | `PostDBLog` | A new `SysAdmin_DBLog` row is written with `Action='restore', IsDBRestorable=false, IsActive=false`. |
| Remarks required | `DatabaseLogModel.DBLogValidator` (Angular) | Front-end validates `Remarks` is non-empty and ≤ 300 chars before allowing the restore to proceed. |

### 8.3 Audit-trail rules

| Rule | Source | Behavior |
|---|---|---|
| Auto-capture on every save | `Audit.NET.EntityFramework` | Every `DbContext.SaveChanges()` in the live DB writes to `DanpheAudit.Data`. There is no opt-in list. |
| Passwords scrubbed | `AccountController.Login` (lines 250-258) | Before the audit event is written, the `LoginViewModel.Password` is set to `""`, the form variables are nulled, and the request body's `password=...` is replaced with `password=*****` via regex. |
| Login passwords never stored | `RbacUser.Password` | Set to `""` after credential check (line 218 of `AccountController.cs`). |
| Date filter on login info | `GetLoginInformation` | Uses `DbFunctions.TruncateTime(log.CreatedOn) >= fromDate && <= toDate` (date-only compare, no time component). |
| Action filter is read-only | `AuditList` | The endpoint returns the filter metadata, not the audit rows. Audit rows are read only via `AuditTrialDetails`. |
| Display name filter is `IsActive` | `AuditList` | `tbl_AuditTableDisplayName` rows with `IsActive=false` are excluded from the dropdown. |
| Cross-database join is dynamic | `SP_Danphe_Audit` | The join from `Fn_Danphe_Audit()` (admin DB) to `RBAC_User` (live DB) uses dynamic SQL built from `LiveDBName` parameter, so the same code works for any hospital regardless of live-DB name. |

### 8.4 SQL Server audit rules

| Rule | Source | Behavior |
|---|---|---|
| 14 log types | `SP_Danphe_SQLAudit` | `CREATE`, `ALTER`, `DROP`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TABLE`, `VIEW`, `TRIGGER`, `STORED_PROCEDURE`, `SCHEMA`, `LOGIN_INFO`, `SERVER_ACTIVITY`. Each maps to one or more SQL Server `action_id` codes. |
| Action normalization | `SP_Danphe_SQLAudit` | The internal `CR`/`AL`/`DR`/`SL`/`IN`/`UP`/`DL`/`EX`/`LGIS`/`LGIF`/`SVSR`/`SVSD`/`SVCN`/`SVPD` codes are translated to human labels (`CREATE`/`ALTER`/`EXECUTE`/`LOGIN SUCCESSFULLY`/`SERVER STARTED`/etc.) in a `CASE` block. |
| Timezone adjustment | `SP_Danphe_SQLAudit` | `DATEADD(mi, DATEPART(TZ, SYSDATETIMEOFFSET()), event_time)` corrects for the local server's UTC offset. |
| +1 day on upper bound | `SP_Danphe_SQLAudit` | `SET @ToDate = DATEADD(DAY, 1, @ToDate)` because `'2017-01-01'` is interpreted as `'2017-01-01 00:00:00'`, which would otherwise miss the rest of the day. |
| Live-DB filter | `SP_Danphe_SQLAudit` | `database_name = '{LiveDBName}'` is applied to all branches (except `LOGIN_INFO` and `SERVER_ACTIVITY`, which are server-wide). |

### 8.5 IRD / Sales book rules

| Rule | Source | Behavior |
|---|---|---|
| Bilingual date display | `npCalService.ConvertEngToNepDateString` | `BillDate` (English) is converted to `BillDate_BS` / `BillDate_Np` for grid display. |
| Nepali calendar type | `SysAdmin_Parameters.CalendarTypes` | The `IRDSalesBook` key controls whether the date picker shows English, Nepali, or both (`en,np`). |
| Header from parameters | `CoreService.Parameters['BillingHeader']` | Hospital name, address, customer-reg label/number are read from a JSON-encoded parameter; missing → `"Please enter parameter values for BillingHeader"`. |
| Pharmacy bill prefix | `NewSalesBookComponent.ExtractBillNumbers` + prefix `PH` | Pharmacy bill numbers get a `PH` prefix on the sales book (older component). |
| Combined vs separate | `NewSalesBookComponent` uses `AllIRDInvoiceDetails` | The newer sales book uses the consolidated SP and parses `ItemNameAndQuantity` for per-line items; the older one merges two endpoint calls. |
| Footer summary | `calculateSummary` / `Calculation` | `TotalSales`, `TotalDiscountAmount`, `TotalTaxableAmount`, `TotalTaxAmount`, `TotalAmount`, `NonTaxable_Amount` (= `TotalAmount - TaxableAmount`). |
| Print-not-shown rule | `InvoiceDetailsComponent.GetInvoiceDetails` | If `Is_Printed == "No"`, `Printed_Time` and `Printed_by` are blanked out. |

### 8.6 Login tracking rules

| Rule | Source | Behavior |
|---|---|---|
| Three event types | `AccountController` | `login` (success), `logout`, `invalid-login-attempt`. |
| Invalid attempts have null employee | `AccountController.cs:264-266` | For invalid credentials, `EmployeeId` is left null but `UserName` is still recorded (so brute-force attempts against a known username are visible). |
| Logout skips if no current user | `AccountController.Logout:294` | After a session expires, the `currentUser` session variable may be null; the logout handler silently skips the write in that case. |
| Date-only filter | `GetLoginInformation` | `TruncateTime(CreatedOn)` for the date compare. |

### 8.7 Database export rules

| Rule | Source | Behavior |
|---|---|---|
| Path from core parameters | `PostExportDatabase` | Reads `DBExportCSVXMLDirPath` from `CoreDbContext.Parameters` (not `SysAdmin_Parameters`). |
| Sub-folder per type | `ExportDatabaseToCSVOrXMLOrPDF` | Files are written to `<path>\{type}\` — e.g. `<path>\PDF\`, `<path>\CSV\`, `<path>\XML\`. |
| PDF folder is wiped on every export | `ExportDatabaseToCSVOrXMLOrPDF:976-981` | `Directory.GetFiles().ToList().ForEach(f => f.Delete())` — only the PDF sub-folder is cleared; CSV and XML are kept. |
| Auto-width per table | `SaveTablesToPdf:1047` | `width = columnCount <= 9 ? 500 : columnCount <= 18 ? 1000 : ... : 3000`. Height is fixed at `500` regardless. |
| One file per table | `SaveTablesToPdf:1042` | Each table becomes a separate PDF named `{tablename}.pdf`. |
| Heading row | `SaveTablesToPdf:1067-1071` | First row is the table name in bold blue (`TIMES_ROMAN, 8, BOLD, BLUE`). |
| Header row | `SaveTablesToPdf:1074-1083` | Column names in `TIMES_ROMAN, 6, BOLD, WHITE` on gray background, centered. |
| Data row | `SaveTablesToPdf:1086-1097` | `TIMES_ROMAN, 4, NORMAL, BLACK` with `LIGHT_GRAY` border. |
| CSV / XML via SP | `SP_ExportDBToCSV`, `SP_ExportDBToXML` | Native SQL Server bulk-export. |

### 8.8 General conventions

- **Naming typo preserved** — the route `DatabaseBakupLogs` (not `DatabaseBackupLogs`) and the model field `RabacUser` (vs `RbacUser`) are baked into both the front-end (`system-admin.dl.service.ts:21`) and the SPs. They are not bugs to fix without coordinated renames.
- **No PUT / DELETE on any SystemAdmin endpoint** — the module is read-only except for the three POST flows. There is no UI to edit `SysAdmin_Parameters`; that is a deliberate SQL-only operation.
- **Anonymous projection on GETs** — `DatabaseBakupLogs` and `SystemAdmin` return anonymous objects rather than the EF model, so the wire format is decoupled from the entity model.
- **Direct `SqlConnection` for SP-based flows** — backup, restore, export, and log-insert bypass EF and use raw `SqlConnection`/`SqlCommand`. This is intentional: these flows involve server-level operations (`BACKUP DATABASE`, `RESTORE DATABASE`, `xp_delete_file`) that EF does not model, and they run inside their own transactions.

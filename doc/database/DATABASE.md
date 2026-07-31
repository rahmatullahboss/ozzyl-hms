# DanpheEMR — Database Reference

> **Reference for the two SQL Server databases that back the DanpheEMR .NET application.**

## Database Topology

DanpheEMR uses **two distinct SQL Server databases**:

| Database | Purpose | Connection string |
|----------|---------|-------------------|
| **Admin-DB** (e.g. `DanpheAdmin_Dev`) | Configuration, master data, RBAC, audit logs, DB lifecycle, IRD sales book views | `connStringAdmin` |
| **EMR-DB** (e.g. `DanpheEMR_INT1`) | All transactional clinical + financial data | `connString` |

The two databases are managed by two DbContext lineages:
- `SystemAdminDbContext` (admin DB)
- One DbContext per business module (EMR DB) — `PatientDbContext`, `BillingDbContext`, `PharmacyDbContext`, `LabDbContext`, `RadiologyDbContext`, `InventoryDbContext`, `AdmissionDbContext`, `ClinicalDbContext`, `EmployeeDbContext`, `PayrollDbContext`, `AccountingDbContext`, `InsuranceDbContext`, etc.

## Source Files

- `DanpheEMR reference/Database/1. Admin-Db/1. DanpheAdmin_CompleteDB.sql` — full Admin-DB schema (single file, 851 lines)
- `DanpheEMR reference/Database/2. EMR-Db/DanpheInternationalDB/Dev_DanpheEMR_INT1.zip` — full EMR-DB schema (zipped)

## Table Naming Convention

Tables are prefixed by domain. From the Admin-DB schema and the EMR-DB convention:

| Prefix | Domain | Example |
|--------|--------|---------|
| `ADM_` | Admin/audit | `ADM_AuditTrail` |
| `CFG_` | Configuration/parameters | `CFG_Parameters`, `CFG_BillServiceItems` |
| `MST_` | Master data | `MST_Country`, `MST_Department`, `MST_PaymentModes` |
| `PAT_` | Patient | `PAT_Patient`, `PAT_PatientVisits`, `PAT_PatientAddress` |
| `BIL_` | Billing | `BIL_TXN_BillingTransaction`, `BIL_MST_BillingItems` |
| `PHRM_` | Pharmacy | `PHRM_MST_Item`, `PHRM_TXN_Invoice` |
| `INV_` | Inventory | `INV_MST_Item`, `INV_TXN_GoodsReceipt` |
| `LAB_` | Laboratory | `LAB_Test`, `LAB_Requisition` |
| `RAD_` | Radiology | `RAD_Requisition`, `RAD_Report` |
| `ADT_` | Admission/Discharge/Transfer | `ADT_Admission`, `ADT_Bed` |
| `ACC_` | Accounting | `ACC_ChartOfAccounts`, `ACC_Voucher` |
| `HR_` or `EMP_` | Human Resources | `EMP_Employee`, `EMP_EmployeeRole` |
| `PROLL_` | Payroll | `PROLL_TXN_Attendance` |
| `SCH_` | Scheduling | `SCH_Shift` |
| `INCTV_` | Incentive | `INCTV_Profile` |
| `FRC_` | Fraction (revenue share) | `FRC_Percent` |
| `INS_` | Insurance | `INS_InsuranceProvider` |
| `NUR_` | Nursing | `NUR_Vitals` |
| `OT_` | Operation Theatre | `OT_Booking` |
| `ER_` | Emergency | `ER_Patient` |
| `MAT_` | Maternity | `MAT_Patient` |
| `CSSD_` | CSSD | `CSSD_TXN_ItemTransaction` |
| `MR_` | Medical Records | `MR_FileUpload` |
| `FA_` | Fixed Asset | `FA_Asset` |
| `VACC_` | Vaccination | `VACC_Vaccines` |
| `RBAC_` | Role-based access | `RBAC_User`, `RBAC_Role` (lives in admin DB) |
| `CORE_` | Core/shared | `CORE_Notification` |
| `SysAdmin_` | System admin (admin DB) | `SysAdmin_DBLog`, `SysAdmin_Parameters` |
| `TAC_` | Transactional accounting | `TAC_Voucher` |

## Common Columns (Audit Trail)

Almost every table has these columns:

| Column | Type | Purpose |
|--------|------|---------|
| `CreatedBy` | int (FK to `RBAC_User.UserId`) | User who created the record |
| `CreatedOn` | datetime | Timestamp of creation |
| `ModifiedBy` | int (nullable) | User who last modified |
| `ModifiedOn` | datetime (nullable) | Timestamp of last modification |
| `IsActive` | bit | Soft-delete flag (1 = active, 0 = deleted) |
| `IsDeleted` | bit (rare) | Hard-delete flag (some tables) |

## Admin-DB Schema Overview

From `DanpheAdmin_CompleteDB.sql` (key tables):

| Table | Purpose |
|-------|---------|
| `RBAC_User` | Login credentials + linked EmployeeId |
| `RBAC_Role` | Role definitions |
| `RBAC_UserRoleMap` | User → Role mapping |
| `RBAC_Permission` | Permission definitions |
| `RBAC_Route` | Route → Permission mapping |
| `RBAC_RolePermissionMap` | Role → Permission mapping |
| `RBAC_Application` | Multi-app support |
| `SysAdmin_Parameters` | Admin-DB config (backup folder, daily limit, calendar types) |
| `SysAdmin_DBLog` | Backup/restore log |
| `DanpheLogInInformation` | Login/logout audit |
| `tbl_AuditTableDisplayName` | Friendly-name mapping for audit grid |
| `MST_*` | Country, state, payment mode (admin-side) |
| `CFG_Parameters` | Cross-module config |

## EMR-DB Schema Overview

The EMR-DB contains the bulk of operational data. Per-module tables are documented in each module's MD file. Some shared cross-module tables:

- `CFG_Parameters` (operational parameters)
- `MST_Country`, `MST_CountrySubDivision`, `MST_Municipality` (shared lookups)
- `CORE_Notification` (in-app notifications)
- `TXN_Verification` (multi-level approval)
- `TAC_Voucher` (accounting transactions)

## Multi-Tenancy (Hospital Isolation)

- Hospital identification via `HospitalCode` from `CoreDbContext.Parameters`
- All patient/visit/transaction tables have a `HospitalId` or scope by `HospitalCode`
- Some deployments use database-per-hospital; others use shared DB with `HospitalId` column

## Soft Delete Pattern

- Logical delete via `IsActive = 0`
- All list views filter `WHERE IsActive = 1`
- Audit fields preserved forever
- Hard delete only for specific tables (e.g. `RBAC_User` deactivation, not deletion)

## Sequence / Numbering Patterns

- **Patient Code**: `HospitalCode + YY + MM + 6-digit seq` (e.g. `HAMS2506000001`)
- **Invoice Number**: `INV/YY/####` (resets per fiscal year)
- **Lab Requisition Number**: `LAB/YY/####`
- **Radiology Number**: `RAD/YY/####`
- **Pharmacy Invoice**: `PHR/YY/####`
- **Visit Code**: `V/YY/####`
- **Claim Code**: `CL/YY/####`
- **Nepali Fiscal Year** (e.g. 2081/82) used in Nepal deployments

## Database Migrations

- Migrations are managed by SQL Server DACPACs (not EF migrations)
- Major releases ship a fresh `Dev_DanpheEMR_INT1.zip` schema
- `CleanUpScript.sql` drops every table + reseeds the admin DB
- Per-deployment customizations go into separate scripts

## Cloudflare Migration Mapping

| DanpheEMR (SQL Server) | HMS (Cloudflare D1 / SQLite) |
|------------------------|------------------------------|
| Two databases (Admin + EMR) | One D1 instance with `tenant_id` column everywhere |
| Bigint identity columns | Integer primary keys with `AUTOINCREMENT` |
| `datetime` | Unix ms integers or ISO-8601 TEXT |
| `nvarchar(max)` | TEXT |
| `varbinary` for files | R2 object references |
| Stored procs | D1 prepared statements in `services/` |
| `SELECT … FOR XML PATH` for JSON | `json_object()` / `json_extract()` |
| `DbContext` per module | One `tenant-scoped` D1 binding per request |
| Triggers (e.g. `Emergency_PoliceCase_NotificatiONTrigger`) | D1 triggers (limited) or Hono cron jobs |
| `BACKUP DATABASE … TO DISK` | `wrangler d1 backup` (Cloudflare-managed) |

## DDL Reconstruction

For the exact column-level definitions of every table, refer to:
1. The Admin-DB SQL file in this reference
2. The EF model classes in `Components/DanpheEMR.ServerModel/` (each `[Column]` attribute, `[Key]`, `[ForeignKey]`, etc. maps to a column)
3. The DbContext `OnModelCreating` method in each module for relationship definitions
4. The stored procs in `Components/DanpheEMR.DalLayer/ReportingDbContext.cs` (executed against the live DB)

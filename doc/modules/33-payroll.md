# Payroll Module — DanpheEMR Reference

Reference implementation: DanpheEMR (ASP.NET Core / SQL Server / Angular)
Source root: `DanpheEMR reference/Code/`
Target stack (in our HMS): Hono on Cloudflare Workers + D1 + R2 + Angular on Pages.
This document describes the reference .NET behavior so parity work has a single source of truth.

---

## 1. Module Overview

The Payroll module in DanpheEMR is a **lightweight HR operations module** focused on attendance, leave, and holiday policy. It does **not** implement salary computation, payslip generation, payroll runs, or any accounting integration. The scope is intentionally narrow:

- **Daily attendance tracking** via per-employee daily muster grid (present/absent/half-day/off)
- **Biometric / RFID time-record import** from CSV (raw punch data)
- **Holiday calendar** (government / festival holidays)
- **Weekend policy** (which weekdays are off — every, 1st/2nd/3rd/4th occurrence, or combinations)
- **Leave categories** (Sick, Casual, Annual, etc.) with category codes
- **Leave rules per year** (days allowed, pay percentage, active/approved flags)
- **Leave requests** (pending → approved/cancelled workflow, with approval trail)
- **Employee leave pivot summary** (pivot by leave category code)
- **Single-employee leave detail view**

Hospital workflow served:
- HR admin defines leave categories and yearly leave rules
- HR admin defines weekend policy and holiday calendar
- Biometric device exports CSV → admin imports → system builds daily muster
- HR/manager edits attendance on the muster grid (mark absent, half-day, off)
- Employees / HR create leave requests
- HR approves / rejects / cancels leave requests
- HR reviews pivot-table summary of total leaves per category per employee

**Out of scope** (this is a significant gap vs a real payroll system):
- No salary structure (basic, HRA, PF, etc.)
- No payslip generation
- No overtime rules or calculation
- No payroll run / approval workflow
- No employee self-service portal
- No biometric device live API (CSV import only)
- No accounting integration

Key file paths:
- Backend controllers: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Payroll/`
- Server models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/Payroll/`
- DB context: `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/PayrollDbContext.cs`
- Frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/payroll-module/`

---

## 2. Backend Files

### 2.1 Controllers

| File | Purpose |
|------|---------|
| `Controllers/Payroll/PayrollController.cs` | Single REST controller. All payroll endpoints (`GET`, `POST`, `PUT`, `DELETE`). 691 lines. Discriminated by `reqType` query string. |

### 2.2 Key methods in `PayrollController.cs`

| Method | HTTP route | `reqType` | Purpose |
|--------|------------|-----------|---------|
| `Get` | `GET /api/Payroll` | `get-emp-list` | Returns employees + their daily attendance for a given Year/Month. Filtered by `CurrEmpId` (employee self-view) or all employees (HR view). Each employee row contains `empAttend` array of daily muster entries. |
| `Get` | `GET /api/Payroll` | `get-leave-rule-list` | Returns leave rules joined with leave categories for a given `currentYear`. Ordered by `CreatedOn` desc. |
| `Get` | `GET /api/Payroll` | `get-leave-category-list` | Returns leave categories whose IDs are NOT in the supplied `LeaveCategoryIds` CSV (used to populate "available" categories when adding a new rule). |
| `Get` | `GET /api/Payroll` | `leaveCategoriesList` | Returns all leave categories (unfiltered). |
| `Get` | `GET /api/Payroll` | `WeekendHolidaysDetails` | Returns weekend holiday rows for a given `Year`. |
| `Get` | `GET /api/Payroll` | `get-holiday-list` | Returns the full holiday list. |
| `Get` | `GET /api/Payroll` | `get-weekend-policy` | Returns weekend policy rows where `Value != null`. Each row has `DayName`, `Value` (e.g. `"every"`, `"First, Third"`), `Year`, `Description`. |
| `Get` | `GET /api/Payroll` | `getEmployeeLeaves` | Returns leave requests joined with employee + leave rule + leave category, filtered by `status` CSV (e.g. `pending,approved`). Ordered by `EmployeeLeaveId` desc. |
| `Get` | `GET /api/Payroll` | `get-employeeList` | Returns all employees with id, salutation, names. |
| `Get` | `GET /api/Payroll` | `leave-list` | Returns active + approved leave rules joined with leave category (used by Add Leave Request). |
| `Get` | `GET /api/Payroll` | `get-employee-leave-details` | Returns per-employee per-category total leave count for a given `Year`. Used as the source for the pivot table. |
| `Get` | `GET /api/Payroll` | `emp-by-id` | Returns a single employee demographic snapshot (DOB, email, phone, address, gender). |
| `Get` | `GET /api/Payroll` | `leave-details-by-empid` | Returns one employee's full leave history for a `Year` (all leaves with category and description). |
| `Post` | `POST /api/Payroll` | `post-attendance-daily-time-record` | Bulk-inserts raw biometric punch records (`EmployeeId, EmployeeName, RecordDateTime`) into `PROLL_AttendanceDailyTimeRecord`. |
| `Post` | `POST /api/Payroll` | `post-csv-data-to-daily-muster` | Upserts `DailyMuster` rows from the post-processed CSV data. Updates `EmployeeId, Day, Month, Year, TimeIn, TimeOut, AttStatus, Present` if row exists; otherwise inserts. |
| `Post` | `POST /api/Payroll` | `PostWeekendHolidays` | Upserts weekend policy rows. If `DayName + Year` exists, updates `ModifiedBy, Description, Value, ModifiedOn`. Else inserts with `IsApproved=true, CreatedBy=currentUser.EmployeeId`. |
| `Post` | `POST /api/Payroll` | `post-holiday-details` | Inserts a single `HolidayModel` row with `CreatedOn=now`, `ApprovedBy=CreatedBy`. |
| `Post` | `POST /api/Payroll` | `post-leave-rules` | Inserts a `LeaveRuleModel` for a `LeaveCategoryId + Year` combination. Rejects if combination already exists. Sets `CreatedBy, CreatedOn, ApprovedBy` from session. |
| `Post` | `POST /api/Payroll` | `AddLeaveCategory` | Inserts a new `LeaveCategory`. Rejects duplicate `LeaveCategoryName` or `CategoryCode`. |
| `Post` | `POST /api/Payroll` | `post-emp-leave-requests` | Bulk-inserts `EmployeeLeaveModel` rows, each with `LeaveStatus="pending"`, `CreatedOn=now`, `CreatedBy=currentUser.EmployeeId`. |
| `Post` | `POST /api/Payroll` | `post-holiday-list-to-daily-muster` | Same as `post-csv-data-to-daily-muster`; specifically used to push holiday days to the muster. |
| `Put` | `PUT /api/Payroll` | `put-changed-attendance` | Updates one `DailyMuster` row matched by `EmployeeId + Day + Month + Year`. Sets `AttStatus, Present, ColorCode`. Inserts if not found. |
| `Put` | `PUT /api/Payroll` | `put-leave-rules` | Updates a `LeaveRuleModel` by `LeaveRuleId`. Edits `IsActive, ModifiedBy, PayPercent, Days, IsApproved, ModifiedOn`. Preserves `CreatedOn` and `CreatedBy`. |
| `Put` | `PUT /api/Payroll` | `PutLeaveCategory` | Updates a `LeaveCategory` by `LeaveCategoryId`. Edits `IsActive, LeaveCategoryName, CategoryCode, Description`. Rejects duplicate name/code. |
| `Delete` | `DELETE /api/Payroll/{id}` | — | Stub. No implementation (always 200). |

### 2.3 Architectural notes

- The controller uses **classic ASP.NET routing** with `reqType` as a discriminator — a single `Get`/`Post`/`Put` method handles every operation. This is fragile (any typo in `reqType` silently 200s with empty data) and a likely migration target.
- `PayrollDbContext` and `MasterDbContext` are constructed per-request from the connection string — **no DI**, no repository layer, no service layer.
- Authentication reads `RbacUser` from `HttpContext.Session.Get<RbacUser>("currentuser")` for write operations only.
- `ReadPostData()` and `ReadQueryStringData("reqType")` come from `CommonController` base.
- All write payloads are deserialized with `DanpheJSONConvert.DeserializeObject<T>`.

---

## 3. Data Models

All models live in `Code/Components/DanpheEMR.ServerModel/Payroll/`.

### 3.1 `AttendanceDailyTimeRecord` → `PROLL_AttendanceDailyTimeRecord`

Raw biometric punch storage. Imported first, then transformed into daily muster.

| Field | Type | Notes |
|-------|------|-------|
| `ID` | `int` | PK. |
| `EmployeeId` | `int` | FK to `EMP_Employee.EmployeeId`. |
| `EmployeeName` | `string` | Redundant denormalized name from the punch device. |
| `RecordDateTime` | `string` | ISO-like date+time string. Stored as `string` (not `DateTime`) to preserve device format. |

### 3.2 `DailyMuster` → `PROLL_DailyMuster`

One row per (Employee, Day, Month, Year) — the core attendance grid.

| Field | Type | Notes |
|-------|------|-------|
| `DailyMusterId` | `Int64?` | PK. Nullable. |
| `EmployeeId` | `Int64` | FK to `EMP_Employee`. |
| `Present` | `bool` | `true` if present, `false` if absent/off. |
| `AttStatus` | `string` | Single-letter code: `"P"`, `"A"`, `"HL"`, `"OFF"`, `"GH"`. See §7. |
| `ColorCode` | `string` | Hex color for UI grid: `"#4dd84d"` (present), `"#ff0000"` (absent), `"#808080"` (off), `"#ffa500"` (government holiday). |
| `TimeIn` | `TimeSpan?` | First punch of the day (nullable). |
| `TimeOut` | `TimeSpan?` | Last punch of the day (nullable). |
| `Day` | `int` | 1..31. |
| `Month` | `int` | 1..12. |
| `Year` | `Int64` | 4-digit. |
| `HoursInDay` | `decimal?` | Computed work hours. Defaults to 8 when present. |

**No FK relationship defined in the model** — `EmployeeId` is an `Int64` while `EMP_Employee.EmployeeId` is also `Int64`, so the upsert queries in the controller are left-join-safe.

### 3.3 `WeekendHolidays` → `PROLL_MST_WeekendHolidays`

Per-year per-day weekend policy. Up to 7 rows per year (one per weekday).

| Field | Type | Notes |
|-------|------|-------|
| `WeekendHolidayId` | `int` | PK. |
| `Year` | `int` | 4-digit. |
| `DayName` | `string` | `"Sunday"` ... `"Saturday"`. |
| `Value` | `string` | Policy selector: `"every"`, `"First"`, `"Second"`, `"Third"`, `"Fourth"`, or comma-combo like `"First, Third"`. |
| `CreatedBy` | `int` | EmployeeId. |
| `CreatedOn` | `DateTime` | |
| `ApprovedBy` | `int` | |
| `IsActive` | `bool?` | |
| `ModifiedBy` | `int?` | |
| `ModifiedOn` | `DateTime?` | |
| `Description` | `string` | Human-readable: `"Every Sunday is Weekend Holiday for year 2026"`. |
| `IsApproved` | `bool` | Defaults to `true` on new insert. |

### 3.4 `LeaveCategory` → `PROLL_MST_LeaveCategory`

Master table for leave types.

| Field | Type | Notes |
|-------|------|-------|
| `LeaveCategoryId` | `int` | PK. |
| `LeaveCategoryName` | `string` | E.g. `"Sick Leave"`, `"Casual Leave"`. |
| `Description` | `string` | Free text. |
| `CreatedBy` | `int` | |
| `CreatedOn` | `DateTime` | |
| `IsActive` | `bool` | Soft-delete flag. |
| `CategoryCode` | `string` | Short code, e.g. `"SL"`, `"CL"`, `"AL"`. |

### 3.5 `LeaveRuleModel` → `PROLL_MST_LeaveRules`

Per-year leave policy. One row per `(LeaveCategoryId, Year)`.

| Field | Type | Notes |
|-------|------|-------|
| `LeaveRuleId` | `int` | PK. |
| `LeaveCategoryId` | `int?` | FK to `PROLL_MST_LeaveCategory`. |
| `Year` | `int` | 4-digit. |
| `Days` | `int` | Total days allowed for the year. |
| `PayPercent` | `double?` | Pay percentage during this leave (e.g. 100 = full pay, 50 = half pay). |
| `IsActive` | `bool` | |
| `IsApproved` | `bool` | |
| `CreatedBy` | `int` | |
| `CreatedOn` | `DateTime` | |
| `ApprovedBy` | `int?` | |
| `ModifiedBy` | `int?` | |
| `ModifiedOn` | `DateTime?` | |

### 3.6 `HolidayModel` → `PROLL_MST_Holidays`

Government / festival holidays.

| Field | Type | Notes |
|-------|------|-------|
| `HolidayId` | `int` | PK. |
| `FiscalYearId` | `int` | FK to fiscal year (but not enforced in DbContext). |
| `Title` | `string` | E.g. `"Independence Day"`. |
| `Description` | `string` | |
| `Date` | `DateTime?` | Holiday date. |
| `IsActive` | `bool` | |
| `CreatedBy` | `int` | |
| `CreatedOn` | `DateTime?` | |
| `ApprovedBy` | `int` | |
| `ModifiedBy` | `int` | |
| `ModifiedOn` | `DateTime?` | |

### 3.7 `EmployeeLeaveModel` → `PROLL_EmpLeave`

Individual leave requests. One row per (Employee, LeaveRuleId, Date).

| Field | Type | Notes |
|-------|------|-------|
| `EmpLeaveId` | `int` | PK. |
| `LeaveRuleId` | `int` | FK to `PROLL_MST_LeaveRules`. |
| `EmployeeId` | `int` | FK to `EMP_Employee`. |
| `Date` | `DateTime` | The leave date. |
| `CreatedOn` | `DateTime` | |
| `CreatedBy` | `int` | |
| `RequestedTo` | `int` | Approver EmployeeId. |
| `ApprovedBy` | `int?` | |
| `ApprovedOn` | `DateTime?` | |
| `CancelledOn` | `DateTime?` | |
| `CancelledBy` | `int?` | |
| `LeaveStatus` | `string` | `"pending"`, `"approved"`, `"cancelled"`, `"approvedCancel"`. See §7. |

### 3.8 `EmployeeModel` (cross-module)

`PayrollDbContext` also exposes `DbSet<EmployeeModel>` mapped to `EMP_Employee`. The payroll controller joins against it for names — but does not own any employee fields. See `Code/Components/DanpheEMR.ServerModel/EmployeeModels/Employee.cs` for the full model.

---

## 4. Database Tables

The payroll module owns 7 tables, all prefixed `PROLL_`. Mappings are defined in `PayrollDbContext.OnModelCreating`:

| Table | Model | PK | Notes |
|-------|-------|-----|-------|
| `PROLL_AttendanceDailyTimeRecord` | `AttendanceDailyTimeRecord` | `ID` | Raw punch log. One row per punch event. |
| `PROLL_DailyMuster` | `DailyMuster` | `DailyMusterId` | One row per (EmployeeId, Day, Month, Year). Index needed on (EmployeeId, Year, Month) for grid queries. |
| `PROLL_MST_WeekendHolidays` | `WeekendHolidays` | `WeekendHolidayId` | Per-year per-day weekday policy. Up to 7 rows/year. |
| `PROLL_MST_LeaveCategory` | `LeaveCategory` | `LeaveCategoryId` | Master list of leave types. |
| `PROLL_MST_LeaveRules` | `LeaveRuleModel` | `LeaveRuleId` | Per-(category, year) allowance. |
| `PROLL_MST_Holidays` | `HolidayModel` | `HolidayId` | Holiday calendar. |
| `PROLL_EmpLeave` | `EmployeeLeaveModel` | `EmpLeaveId` | Per-employee per-date leave records. |

Read-only references from the same `DbContext`:
- `EMP_Employee` (joins for employee name and demographic data)
- `CORE_CFG_Parameters` (parameter lookup for `PayrollLoadNoOfYears`, `DefaultOfficeTime`)

There is **no unique constraint** defined on `(EmployeeId, Day, Month, Year)` in `PROLL_DailyMuster` even though the controller logic clearly assumes it. The upsert falls back to "first match" which could cause data corruption in race conditions.

---

## 5. Key Workflows

### 5.1 Daily Muster & Attendance Grid

1. HR navigates to `Payroll/Attendance`.
2. Component calls `getWeekendPolicy` to load `PROLL_MST_WeekendHolidays` rows for the selected year. These determine which days are off.
3. Component calls `getHolidayList` to load all holidays (filtered client-side by date).
4. Component calls `get-emp-list` with `Year, Month, CurrEmpId` — controller returns all employees with their muster rows for that month.
5. Frontend builds a calendar grid:
   - Cells colored by `getDateArray`:
     - `#D3D3D3` (light grey) = weekend per policy
     - `#ffa500` (orange) = government holiday
     - `#3598dc` (blue) = normal working day
   - For each (Employee × Day) cell, a button shows `AttStatus` and `ColorCode`.
6. Each cell click opens `EditAttendance` dialog (a `MatDialog`):
   - Options: Present (`P`), Absent (`A`), Half Day (`HL`), Off (`OFF`).
   - `Save()` → `put-changed-attendance` → controller upserts `DailyMuster`.
7. RBAC gates `payroll-attendance-edit-btn` controls whether the edit pencil icon is visible.

The component's `getDateArray` is the **coloring engine**. It handles every day of the month, applying weekend policy logic (every/First/Second/Third/Fourth) and overlaying holidays.

### 5.2 Biometric CSV Import

1. User clicks "Sync Biometric Attendance" → opens file picker popup.
2. Frontend reads CSV with header `EmployeeId, EmployeeName, RecordDateTime` via `CommonPayrollService.getDataRecordsArrayFromCSVFile`.
3. `postAttendanceDailyTimeRecord` POSTs raw punches to `PROLL_AttendanceDailyTimeRecord`.
4. `postCsvDataToDailyMuster` does the client-side post-processing **in the Angular component** (`postCsvDataToDailyMuster` method in `attendance.component.ts`):
   - Pairs punches by date into `timeInData` (first punch) and `timeOutData` (second punch).
   - Matches in/out pairs by `Date + EmployeeId`.
   - Builds `DailyMuster` rows with `AttStatus="P"`, `Present=true`, `ColorCode="#4dd84d"`, `HoursInDay=8`.
5. POST `post-csv-data-to-daily-muster` upserts into `PROLL_DailyMuster`.

**Important caveat:** The client-side pairing logic is naive — it assumes exactly 2 punches per day. Multiple in/out cycles (e.g. lunch break) would be mis-paired.

### 5.3 Holiday Calendar Management

1. HR navigates to `Payroll/Leave/Holiday`.
2. Lists all holidays via `get-holiday-list`.
3. "Add New Holiday" dialog calls `post-holiday-details` with `Title, Date, Description, CreatedBy=currentUser.EmployeeId, CreatedOn=now, ApprovedBy=CreatedBy`.
4. Edit and Delete buttons exist in the grid (`payroll-grid.component.ts`) but **Delete has no handler** and **Update is a no-op** (`UpdateHoliday()` is empty).
5. Holidays are pushed into the daily muster via `post-holiday-list-to-daily-muster` (the post-holiday-list-to-daily-muster endpoint exists but the calling code is **commented out** in `attendance.component.ts`).

### 5.4 Leave Rule Management

1. HR navigates to `Payroll/Leave/LeaveRuleList`.
2. `getLeaveRulelist(currentYear)` returns rules + categories for the selected year.
3. The list of categories already used is computed client-side; `getLeaveCategoryList(LeaveCategoryIds)` fetches the *remaining* unused categories for the "add new" form.
4. Add: `postLeaveRules` — rejected if `(LeaveCategoryId, Year)` already exists.
5. Edit: `putLeaveRules` — updates `Days, PayPercent, IsActive, IsApproved`. Preserves `CreatedBy/CreatedOn`.
6. `PayrollLoadNoOfYears` core parameter controls how many years back the year selector shows (default 3-5).

### 5.5 Leave Category Management

1. HR navigates to `Payroll/Setting/LeaveCategory`.
2. Lists via `leaveCategoriesList`.
3. Add via `AddLeaveCategory` — rejected if name or code duplicates.
4. Edit via `PutLeaveCategory` — only updates `IsActive, LeaveCategoryName, CategoryCode, Description`. Cannot change other fields.
5. Used by `LeaveRuleList` to populate the category dropdown.

### 5.6 Weekend Policy Management

1. HR navigates to `Payroll/Setting/WeekendHoliday`.
2. Selects a year (defaults to current year).
3. UI shows 7 weekday cards. Each card has checkboxes: `every, first, second, third, fourth` — at most one of `every` or any combination of `first-second-third-fourth`.
4. `UpdatePolicy()` builds a `WeekendHolidays` array:
   - For `every=true`: `Value="every"`, `Description="Every {Day} is Weekend Holiday for year {Year}"`
   - For positional: `Value="First, Third"` etc., `Description="First, Third Saturday is Weekend holiday of the month for year {Year}"`
5. `PostWeekendHolidays` upserts. The controller's `updateExistingWeekends` logic also pushes `Value=null` rows for days that were deselected (so old policy rows are soft-cleared).

### 5.7 Leave Request Lifecycle

```
[pending] ──approve──▶ [approved]
[pending] ──cancel ──▶ [cancelled]
[approved] ──cancel ──▶ [approvedCancel]
```

1. HR or employee navigates to `Payroll/Leave/LeaveRequest`.
2. Filters by status: `pending`, `approved`, `all` (=`pending,approved,approvedCancel,cancelled`), `cancelled` (=`cancelled,approvedCancel`).
3. "Create Request" → `AddNewLeaveRequestComponent` modal:
   - Select employee from auto-complete
   - Add one or more leave rows: `(LeaveRuleId, Date, Description, RequestedTo)`
   - Client validation: `IsValidDateCheck` is currently a stub (`return true`).
   - POSTs `post-emp-leave-requests` — each row gets `LeaveStatus="pending"`, `CreatedBy=currentUser.EmployeeId`, `CreatedOn=now`.
4. **Approve / Cancel actions exist in the UI** but the controller has **no endpoint** to update `LeaveStatus`, `ApprovedBy`, `ApprovedOn`, `CancelledBy`, `CancelledOn`. This is a known gap.

### 5.8 Employee Leave Pivot Summary

1. HR navigates to `Payroll/Leave/EmployeeLeaves`.
2. Calls `get-employee-leave-details` with year — returns `[{ EmployeeId, EmployeeName, TotalLeave, CategoryCode }]`.
3. Frontend uses `json-to-pivot-json` / `crossfilter` to pivot rows into a matrix:
   - Rows = employees
   - Columns = category codes (CL, SL, AL, etc.)
   - Cells = total leaves
4. "View" action on a row → `emp-by-id` + `leave-details-by-empid` → shows one employee's full leave history grouped by year/date.

---

## 6. API Endpoints

All endpoints use `reqType` as a query string discriminator. There is no REST resource hierarchy — everything is `GET /api/Payroll?reqType=...`, `POST /api/Payroll?reqType=...`, etc.

| # | HTTP | Route | reqType | Purpose | Auth |
|---|------|-------|---------|---------|------|
| 1 | GET | `/api/Payroll?reqType=get-emp-list&Year=&Month=&CurrEmpId=` | `get-emp-list` | Employees + their daily muster for year/month. | Session |
| 2 | GET | `/api/Payroll?reqType=get-leave-rule-list&currentYear=` | `get-leave-rule-list` | Leave rules + categories for a year. | Session |
| 3 | GET | `/api/Payroll?reqType=get-leave-category-list&LeaveCategoryIds=` | `get-leave-category-list` | Categories NOT in the supplied CSV. | Session |
| 4 | GET | `/api/Payroll?reqType=leaveCategoriesList` | `leaveCategoriesList` | All leave categories. | Session |
| 5 | GET | `/api/Payroll?reqType=WeekendHolidaysDetails&Year=` | `WeekendHolidaysDetails` | Weekend policy for a year. | Session |
| 6 | GET | `/api/Payroll?reqType=get-holiday-list` | `get-holiday-list` | All holidays. | Session |
| 7 | GET | `/api/Payroll?reqType=get-weekend-policy` | `get-weekend-policy` | Weekend policy with non-null `Value`. | Session |
| 8 | GET | `/api/Payroll?reqType=getEmployeeLeaves&currentYear=&status=` | `getEmployeeLeaves` | Leave requests filtered by status CSV. | Session |
| 9 | GET | `/api/Payroll?reqType=get-employeeList` | `get-employeeList` | All employees. | Session |
| 10 | GET | `/api/Payroll?reqType=leave-list` | `leave-list` | Active + approved leave rules. | Session |
| 11 | GET | `/api/Payroll?reqType=get-employee-leave-details&Year=&CurrEmpId=` | `get-employee-leave-details` | Pivot source: per-(employee, category) totals. | Session |
| 12 | GET | `/api/Payroll?reqType=emp-by-id&empId=` | `emp-by-id` | One employee demographic. | Session |
| 13 | GET | `/api/Payroll?reqType=leave-details-by-empid&empId=&Year=` | `leave-details-by-empid` | One employee's leave history. | Session |
| 14 | POST | `/api/Payroll?reqType=post-attendance-daily-time-record` | `post-attendance-daily-time-record` | Bulk-insert raw biometric punches. | Session |
| 15 | POST | `/api/Payroll?reqType=post-csv-data-to-daily-muster` | `post-csv-data-to-daily-muster` | Upsert daily muster from CSV-processed data. | Session |
| 16 | POST | `/api/Payroll?reqType=PostWeekendHolidays` | `PostWeekendHolidays` | Upsert weekend policy. | Session + RBAC |
| 17 | POST | `/api/Payroll?reqType=post-holiday-details` | `post-holiday-details` | Insert one holiday. | Session |
| 18 | POST | `/api/Payroll?reqType=post-leave-rules` | `post-leave-rules` | Insert leave rule (rejects duplicate category+year). | Session |
| 19 | POST | `/api/Payroll?reqType=AddLeaveCategory` | `AddLeaveCategory` | Insert leave category. | Session |
| 20 | POST | `/api/Payroll?reqType=post-emp-leave-requests` | `post-emp-leave-requests` | Bulk-insert leave requests (status=pending). | Session |
| 21 | POST | `/api/Payroll?reqType=post-holiday-list-to-daily-muster` | `post-holiday-list-to-daily-muster` | Push holidays to daily muster. | Session |
| 22 | PUT | `/api/Payroll?reqType=put-changed-attendance` | `put-changed-attendance` | Upsert one muster cell edit. | Session |
| 23 | PUT | `/api/Payroll?reqType=put-leave-rules` | `put-leave-rules` | Update leave rule. | Session |
| 24 | PUT | `/api/Payroll?reqType=PutLeaveCategory` | `PutLeaveCategory` | Update leave category. | Session |
| 25 | DELETE | `/api/Payroll/{id}` | — | No-op stub. | n/a |

**Note:** Endpoint 1 (`get-emp-list`) returns each employee's muster as a nested `empAttend` array — this is an N+1 pattern in the controller. The frontend re-projects to a grid matrix.

**Note:** Endpoint 13 (`leave-details-by-empid`) has a weird structure — it groups by `EmployeeId` then takes `FirstOrDefault()`, so it only returns one row even if multiple match. The full per-day detail is in the `Category` sub-array of that single row.

---

## 7. Key Business Rules

### 7.1 Attendance Status Codes

The `AttStatus` column on `PROLL_DailyMuster` is a single-letter code, paired with a `ColorCode`:

| Code | Meaning | Color | `Present` | `HoursInDay` |
|------|---------|-------|-----------|--------------|
| `P` | Present | `#4dd84d` (green) | `true` | 8 (or actual) |
| `A` | Absent | `#ff0000` (red) | `false` | 0 |
| `HL` | Half Day Leave | `#ff0000` (red) | `true` | 4 |
| `OFF` | Off (weekend per policy) | `#808080` (grey) | `false` | 0 |
| `GH` | Government Holiday | `#ffa500` (orange) | `false` | 0 (inferred — code only appears in commented-out holiday-push flow) |

Color codes are stored alongside the status so the grid renders correctly without re-applying client logic. The `EditAttendance` dialog radio buttons map directly to these codes.

### 7.2 Weekend Policy Values

`Value` is a free-text string field, but the frontend expects specific tokens:

- `"every"` — every occurrence of this weekday is a holiday
- `"First"`, `"Second"`, `"Third"`, `"Fourth"` — ordinal positions in the month
- Comma-separated combinations: `"First, Third"` (note the space after comma)

The `getDateArray` method in `attendance.component.ts` splits `Value` on `, ` and matches against the actual ordinal weekday in the month. Days that are not in the policy and are not holidays default to `#3598dc` (working day blue).

### 7.3 Leave Status Codes

`LeaveStatus` is a free-text field on `EmployeeLeaveModel`:

- `"pending"` — initial state when `post-emp-leave-requests` is called
- `"approved"` — set by approver (no controller endpoint exists to set this — known gap)
- `"cancelled"` — cancelled while still pending
- `"approvedCancel"` — cancelled after approval

The `getEmployeeLeaves` `status` parameter is a CSV: `pending,approved,approvedCancel,cancelled`.

### 7.4 Payroll Cycle

There is **no payroll cycle concept** in this module. Salary, pay period, payroll run, payslip, pay date — none of these exist. The closest thing to a cycle is:

- A fiscal year (used for holidays)
- A calendar year (used for weekend policy + leave rules)
- A month (used for daily muster grouping)

### 7.5 RBAC Permission Strings

Frontend `rbac-permission` directives reference these permission names:

- `payroll-attendance-show-all-employee-btn` — toggles "ALL Employee" radio
- `payroll-attendance-biometric-sync-btn` — toggles "Sync Biometric Attendance" button
- `payroll-attendance-edit-btn` — toggles "Edit Attendance" button

### 7.6 Core Parameters

- `PayrollLoadNoOfYears` — group `Payroll`, how many years back the year selector shows (e.g. `5`)
- `DefaultOfficeTime` — group `Payroll`, JSON `{ "TimeIn": "09:00", "TimeOut": "17:00" }`, used when manually adding a present entry with no punches

---

## 8. Cross-Module Interactions

### 8.1 Employee Module

`PayrollDbContext.Employee` is mapped to `EMP_Employee` (same table as the Employee module). The payroll module **reads but does not write** employee data. Every API response that surfaces an employee name uses the same projection:

```
Salutation + ". " + FirstName + " " + (MiddleName? + " ") + LastName
```

For our HMS parity: the `staff` table in our DB1 schema must supply at least `id, salutation, first_name, middle_name, last_name` and the payroll API must join `staff` rather than maintain a separate employee table.

### 8.2 Scheduling Module

`AttendanceComponent` constructor injects `SchedulingBLService` but only references it indirectly. There is no direct scheduling-API call in the active code paths; the import is dead code.

### 8.3 Accounting Module

**No interaction.** This module does not produce journal entries, expense vouchers, or payment transactions. A future payroll implementation would need an `hr_payroll_runs` → `accounting_events` integration.

### 8.4 Reporting / Dashboard

No dashboard cards. The module is purely operational (CRUD + grid views).

---

## 9. Known Gaps and Migration Notes

| Gap | Impact | Migration target |
|-----|--------|------------------|
| No salary structure / payslip / payroll run | Cannot compute employee pay | Add `hr_salary_heads`, `hr_staff_salary_structure`, `hr_payroll_runs`, `hr_payslips` |
| Approve/Cancel leave request has no backend | Leave requests stuck in `pending` | Add `PUT /api/Payroll?reqType=approve-leave` and `cancel-leave` that set `ApprovedBy, ApprovedOn, LeaveStatus` |
| Holiday Delete is wired in UI but no endpoint | Dead-end delete button | Add `DELETE /api/Payroll?reqType=delete-holiday&id=` |
| Holiday Update is a no-op | Edit doesn't persist | Wire `UpdateHoliday()` to `put-holiday-details` or add a new `put` |
| `IsValidDateCheck` is a stub (`return true`) | Can submit duplicate leave dates | Implement duplicate date check client-side |
| `get-employee-leave-details` groups then takes `FirstOrDefault()` | Loses per-day detail at API level | Restructure to return flat list or nested array |
| `reqType` discriminator is fragile (typos silently 200) | No proper error reporting | Migrate to Hono routes per resource: `/api/payroll/employees/:id/muster`, etc. |
| Client-side CSV punch pairing is naive (2-punch assumption) | Multi-cycle punches mis-paired | Server-side pairing or store all punches |
| No unique constraint on `(EmployeeId, Day, Month, Year)` in `PROLL_DailyMuster` | Race condition can insert duplicates | Add unique index |
| `post-holiday-list-to-daily-muster` calling code is commented out | Holidays don't auto-appear on muster | Uncomment or re-implement as scheduled job |
| `delete-attendance` endpoint does not exist | Cannot remove bad muster rows | Add `DELETE /api/Payroll?reqType=delete-attendance` |
| `fiscalYearList` referenced in `PayrollSettingDLService` but no controller branch | Dead link | Either implement `fiscalYearList` in controller or remove the client call |
| `SchedulingBLService` injected in `AttendanceComponent` but unused | Dead dependency | Remove |

---

## 10. Frontend Component Map

```
PayrollMainModule
├── PayrollMainComponent                  (route shell, RBAC route filter)
├── PayrollRoutingModule
│   ├── ''              → AttendanceComponent
│   ├── 'Payroll'       → PayrollComponent (placeholder)
│   ├── 'Leave'         → LeaveComponent
│   │   ├── 'Holiday'        → HolidayComponent
│   │   ├── 'LeaveRuleList'  → LeaveRuleListComponent
│   │   ├── 'LeaveRequest'   → LeaveRequestComponent
│   │   │   └── AddNewLeaveRequestComponent (modal)
│   │   └── 'EmployeeLeaves' → EmployeeLeaveComponent
│   └── 'Setting'       → (lazy) PayrollSettingsModule
│
└── PayrollSettingsModule
    ├── PayrollSettingComponent
    ├── 'WeekendHoliday' → WeekendHolidayPolicyComponent
    └── 'LeaveCategory'  → LeaveCategoryListComponent
                          └── AddLeaveCategoryComponent (modal)
```

### 10.1 Services

- `PayrollBLService` — wraps DL service with `omit` for validators, `pipe(map)`, etc.
- `PayrollDLService` — direct HTTP client.
- `PayrollSettingBLService` / `PayrollSettingDLService` — leave category + weekend policy specific.
- `CommonPayrollService` — CSV parser (also duplicated logic in `payroll.service.ts`).

### 10.2 Reusable validation (Reactive Forms)

- `EmployeeLeaveModel.EmployeeLeaveValidator` — `LeaveRuleId`, `Date` (required), `Description` (max 100)
- `LeaveRuleList.LeaveRuleValidator` — `LeaveCategoryId`, `Days`, `PayPercent` (all required)
- `LeaveCategories.LeaveCategoryValidator` — `LeaveCategoryName` (required, max 50), `CategoryCode` (required, max 30), `Description` (required, max 200)
- `HolidayModel.holidayValidator` — `holidayTitle` (required), `holidayDate` (required)

### 10.3 Grid columns

- `PayrollGridColumns.HolidayList` — `Title, Date, Description, CreatedOn, ApprovedBy, Actions`
- `GridColumnSettings.LeaveRuleList` — Leave rule grid (defined in shared)
- `GridColumnSettings.EmployeeListwithStatus` — Leave request grid (defined in shared)
- `GridColumnSettings.LeaveCategoryList` — Leave category grid (defined in shared)

### 10.4 Filter pipe

`GrdFilterPipe` in `Attendance/serach-pipe.component.ts` — filters the muster grid by `EmployeeName` or `EmployeeId` (search box on top-left).

---

## 11. End-to-End Examples

### 11.1 First-time setup (HR)

1. Settings → Leave Category → Add (Sick Leave / SL, Casual Leave / CL, Annual Leave / AL).
2. Settings → Weekend Holiday → Set year, mark `Saturday` every, `Sunday` every → Save.
3. Leave → Holiday → Add (Independence Day, 2026-08-15).
4. Leave → Leave Rule List → Add rule for SL: 12 days, 100% pay, year 2026, IsActive, IsApproved.

### 11.2 Monthly attendance flow

1. Daily: biometric device logs punches to its own memory.
2. End of day: export CSV (cols: `EmployeeId, EmployeeName, RecordDateTime`).
3. Daily Muster page → Sync Biometric Attendance → upload CSV.
4. System creates raw punches in `PROLL_AttendanceDailyTimeRecord`, then upserts paired `DailyMuster` rows with `P / #4dd84d / HoursInDay=8`.
5. HR reviews grid, edits cells (e.g. mark someone absent, mark half-day).
6. Holidays are color-coded orange automatically by the grid render.

### 11.3 Leave request

1. HR or employee → Leave → Leave Request → Create Request → select employee.
2. Add leave rows: pick rule (e.g. SL), pick date, set RequestedTo.
3. Submit → `post-emp-leave-requests` inserts rows with `LeaveStatus="pending"`.
4. Approver sees pending request in same view (status filter).
5. **GAP:** No backend to actually approve / cancel.

---

## 12. Reference Implementation vs Our HMS

Our Cloudflare-native HMS has already implemented an extended version of this module with significant additional features:

| Feature | DanpheEMR (this doc) | Our HMS |
|---------|----------------------|---------|
| Daily muster grid | Yes | Yes (`hr_attendance`) |
| Biometric CSV import | Yes (naive pairing) | Yes — biometric/RFID/manual/web/mobile/device sources, plus real-time API ingestion |
| Leave categories + rules per year | Yes | Yes (`hr_leave_categories`, `hr_leave_rules`) |
| Leave balance tracking | No | Yes (`hr_employee_leave_balances`) with carry-forward |
| Leave request workflow | Partial (no approve endpoint) | Full (pending/approved/rejected/cancelled) |
| Holiday calendar | Yes (no delete/update) | Yes (public/optional/restricted) |
| Weekend policy | Yes (4 patterns) | Yes (6 patterns) |
| Shift management | No | Yes (`hr_shifts`) |
| Duty roster | No | Yes (`hr_duty_roster`) with rotation patterns |
| Shift swap | No | Yes |
| Overtime | No | Yes (rules + log + auto-payroll integration) |
| Salary structure | No | Yes (`hr_salary_heads`, `hr_staff_salary_structure`) |
| Payroll runs | No | Yes (draft→locked→approved) |
| Payslips | No | Yes (with breakdown, attendance, leave deduction) |
| Accounting integration | No | Yes (creates expense + accounting event) |
| Biometric device live API | No (CSV only) | Yes (`hr_biometric_devices` with API key auth) |
| Real-time attendance board | No | Yes |
| Multi-tenancy | No (single tenant) | Yes (tenant_id on all tables) |
| Audit logging | CreatedBy/ModifiedBy only | Full audit logs |
| i18n | English | English + Bengali |

The Payroll module in DanpheEMR represents the **bare-minimum HR skeleton** that an open-source hospital might use. Our HMS has evolved it into a full HR + payroll + overtime + duty-roster + biometric platform while keeping the same foundational tables (muster, leave rules, leave category, holiday, weekend policy) and the same `reqType` style of API dispatcher.

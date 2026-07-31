# Scheduling Module

## 1. Module Overview

The Scheduling module manages staff work schedules, shift definitions, and employee working-hour assignments. It exposes two distinct functional surfaces under one Angular module (`SchedulingModule`):

- **Manage Schedules** — week/month grid of which days an employee is supposed to work (`IsWorkingDay` flag per date). Drives roster visibility and feeds into the daily muster of the Payroll module.
- **Manage Working Hours** — assignment of one or more shifts to an employee, with computed `TotalWorkingHrs` and overlap validation. Each (Employee, Shift) pair lives in `SCH_MAP_EmployeeShift`.
- **Setting / Shifts Master** — CRUD on the `SCH_MST_Shifts` table: name, start time, end time, total hours, and a `IsDefault` flag that protects system-defined shifts from inline edit.

The module is intentionally thin: there is no rotation engine, no auto-generation of monthly rosters, no overtime rules, and no shift-swap workflow. Those capabilities exist in our HMS Cloudflare implementation but are not present in this DanpheEMR reference, so this doc serves as a baseline rather than a parity target.

All persistence lives in the `SCH_*` table family inside SQL Server. The `SchedulingDbContext` (Entity Framework) exposes `Employee`, `DayWiseAvailability`, `EmpShifts`, `EmpSchedules`, `ShiftsMaster`, `EmpShiftMAP`, and `EmpRole` as `DbSet` properties. The single API controller (`SchedulingController`) uses a `reqType` query-string switch to dispatch GET requests and a `reqType` switch on POST/PUT for write operations. All write transactions are wrapped in `SchedulingBL.ManageEmpSchedules` and `SchedulingBL.WorkingHrsTxn` with full rollback semantics.

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Shift** | A named time-block (e.g. Morning 08:00-16:00). Stored in `SCH_MST_Shifts`. `IsDefault = true` shifts are protected from inline edit. |
| **Employee Shift Map** | A row assigning an active shift to an employee. Stored in `SCH_MAP_EmployeeShift`. Soft-deletion via `IsActive` flag — no row is ever physically deleted. |
| **Employee Schedule** | A per-date working/non-working flag. Stored in `SCH_EmployeeSchedules`. One row per (Employee, Date). |
| **Day-Wise Availability** | The recurring weekly default for an employee — "Monday is normally a working day". Stored in `SCH_EmpDayWiseAvailability` keyed by `EmployeeId` with one row per `DayId`. |
| **Working Hours** | Derived/display concept: the sum of `TotalHrs` across all active shifts assigned to the employee. Computed at read time; never persisted. |
| **Default Shift** | A shift marked `IsDefault = true`. Used as a pick-list when assigning new shifts to an employee. Cannot be inline-edited from the working-hours screen (its `ShiftValidator` is `.disable()`d on the client). |
| **No-Shift Employee** | An employee that has zero rows in `SCH_MAP_EmployeeShift` with `IsActive = true`. Surfaced in a separate autocomplete so an admin can quickly assign a first shift. |

### Data Model at a Glance

```
SCH_MST_Shifts (1) ──< (N) SCH_MAP_EmployeeShift (N) >── (1) EMP_Employee
                                                       │
                       +───────────────────────────────+
                       │
SCH_EmployeeSchedules (per Employee × Date)
SCH_EmpDayWiseAvailability (per Employee × DayId)
```

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controllers

| File | Path | Purpose |
|------|------|---------|
| `SchedulingController.cs` | `Websites/DanpheEMR/Controllers/Scheduling/SchedulingController.cs` | API controller — all `/api/scheduling` endpoints. 372 lines. Owns `SchedulingDbContext` + `MasterDbContext` and pulls employee/department data from `DanpheCache`. |
| `SchedulingViewController.cs` | `Websites/DanpheEMR/Controllers/Scheduling/SchedulingViewController.cs` | MVC view controller — renders the six Razor pages used by the Angular bootstrap (`SchedulingMain`, `ManageMain`, `ManageSchedules`, `ManageWorkingHours`, `SettingMain`, `ShiftsManage`). 78 lines. |
| `SchedulingBL.cs` | `Websites/DanpheEMR/Controllers/Scheduling/SchedulingBL.cs` | Business-logic static class — transactional wrappers (`ManageEmpSchedules`, `WorkingHrsTxn`) and per-row CRUD helpers (`AddEmpSchedules`, `UpdateEmpSchedules`, `AddShiftMaster`, `UpdateShiftMaster`, `AddEmpShiftMap`, `UpdateEmpShiftMap`). 187 lines. |

### 2.2 SchedulingController.cs — Endpoint Map

The controller is a single `CommonController` subclass with one `[HttpGet]`, one `[HttpPost]`, one `[HttpPut]`, and one empty `[HttpDelete]` method. The HTTP verb is fixed; the actual operation is chosen by `reqType` query string. All write responses are wrapped in `DanpheHTTPResponse<object>`; all write errors are caught and returned with `Status = "Failed"` plus `ErrorMessage`.

#### 2.2.1 HTTP GET endpoints

| `reqType` value | Purpose | Returns |
|-----------------|---------|---------|
| `employeelist` | List of all employees with department, joined from cached `EmployeeModel` + `DepartmentModel`. | `Array<{ EmployeeId, DepartmentId, DepartmentName, EmployeeName }>` |
| `getEmpSchedule` | Per-employee schedule view: combines `SCH_EmpDayWiseAvailability` (default working days) with `SCH_EmployeeSchedules` (overrides for the requested dates). | `Array<{ EmployeeId, EmployeeName, DepartmentName, defSCH, loadSCH }>` |
| `getShiftList` | All shifts in `SCH_MST_Shifts`, ordered by `IsDefault DESC`. | `Array<ShiftsMasterModel>` |
| `getEmpWHList` | Per-employee working-hours summary: number of active shifts, list of shifts, total hours. Includes employees with zero active shifts. | `Array<{ EmployeeId, EmployeeName, DepartmentName, EmployeeRoleName, NoOfShifts, Shifts, TotalWorkingHrs }>` |
| `getDefaultShifts` | All shifts where `IsDefault = true`, ordered by `StartTime`. | `Array<ShiftsMasterModel>` |
| `getEmployeeNoShift` | All employees that have zero active shift mappings. | `Array<EmployeeModel>` |

`getEmpSchedule` accepts two query parameters:

- `EmpIds` — comma-separated `EmployeeId` list.
- `dates` — comma-separated date strings (compared to `SCH_EmployeeSchedules.Date.ToString()`).

#### 2.2.2 HTTP POST endpoints

| `reqType` value | Body | Purpose | Handler |
|-----------------|------|---------|---------|
| `manageEmpSchedules` | `Array<EmpSchedules>` with `TxnType ∈ {Insert, Update}` | Bulk upsert of per-date schedules. | `SchedulingBL.ManageEmpSchedules` |
| `AddShift` | `ShiftsMasterModel` | Insert a new shift. `CreatedOn` is stamped server-side. | Inline `schDbContext.ShiftsMaster.Add` |
| `EmpWokringHours` | `WorkingHoursTxnVM` (`{ Shifts, Maps }`) | Bulk upsert of shifts + employee-shift maps. | `SchedulingBL.WorkingHrsTxn` |

#### 2.2.3 HTTP PUT endpoints

| `reqType` value | Body | Purpose | Handler |
|-----------------|------|---------|---------|
| `UpdateShift` | `ShiftsMasterModel` | Update existing shift. Only `ShiftName`, `StartTime`, `EndTime`, `TotalHrs`, and `ModifiedOn` are flagged as modified; `CreatedOn`/`CreatedBy` are explicitly preserved. | Inline `EntityState.Modified` |

#### 2.2.4 HTTP DELETE endpoint

`DELETE /api/scheduling/{id}` is declared but the body is empty — there is no delete implementation in the controller.

### 2.3 SchedulingBL.cs — Business Logic

`SchedulingBL` is a static class with no instance state. All methods accept the `SchedulingDbContext` as a parameter so the caller controls the connection string and lifetime.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `ManageEmpSchedules` | `(List<EmpSchedules> schedules, SchedulingDbContext ctx) → Boolean` | Opens a transaction, iterates the input list, calls `AddEmpSchedules` for `TxnType == "Insert"` and `UpdateEmpSchedules` for `TxnType == "Update"`, commits on success, rolls back on any exception. |
| `WorkingHrsTxn` | `(WorkingHoursTxnVM vm, SchedulingDbContext ctx) → Boolean` | Opens a transaction. The shift-creation block is currently commented out. Iterates `vm.Maps` and updates existing `EmployeeShiftMap` rows or inserts new ones, copying `ShiftId` from the parallel `vm.Shifts` array by index. Commits or rolls back. |
| `AddEmpSchedules` | `(ctx, EmpSchedules) → void` | EF `Add` + `SaveChanges`. |
| `UpdateEmpSchedules` | `(ctx, EmpSchedules) → void` | EF `Attach` + flag only `IsWorkingDay` as modified (date and day-name are not updated). |
| `AddShiftMaster` | `(ctx, ShiftsMasterModel) → void` | Stamps `CreatedOn`, EF `Add` + `SaveChanges`. |
| `UpdateShiftMaster` | `(ctx, ShiftsMasterModel) → void` | Stamps `ModifiedOn`, EF `Attach` + flag only `ShiftName`, `StartTime`, `EndTime`, `TotalHrs` as modified. |
| `AddEmpShiftMap` | `(ctx, EmployeeShiftMap) → void` | Stamps `CreatedOn`, EF `Add` + `SaveChanges`. |
| `UpdateEmpShiftMap` | `(ctx, EmployeeShiftMap) → void` | Stamps `ModifiedOn`, EF `Attach` + full `EntityState.Modified`, but explicitly preserves `CreatedOn` and `CreatedBy`. |

### 2.4 SchedulingViewController.cs — MVC Pages

Six action methods, each returning a single Razor view path:

| Action | View Path | Used By Angular Route |
|--------|-----------|----------------------|
| `SchedulingMain` | `~/Views/SchedulingView/SchedulingMain.cshtml` | `Scheduling` (lazy module root) |
| `ManageMain` | `~/Views/SchedulingView/Manage/ManageMain.cshtml` | `Scheduling/Manage` |
| `ManageSchedules` | `~/Views/SchedulingView/Manage/ManageSchedules.cshtml` | `Scheduling/Manage/ManageSchedules` |
| `ManageWorkingHours` | `~/Views/SchedulingView/Manage/ManageWorkingHours.cshtml` | `Scheduling/Manage/ManageWorkingHours` |
| `SettingMain` | `~/Views/SchedulingView/Setting/SettingMain.cshtml` | `Scheduling/Setting` |
| `ShiftsManage` | `~/Views/SchedulingView/Setting/ShiftsMaster.cshtml` | `Scheduling/Setting/ShiftsManage` |

Each method simply returns `View(path)` — no auth checks, no data hydration (the Angular client does that via the API).

### 2.5 SchedulingDbContext.cs

Located at `Components/DanpheEMR.DalLayer/SchedulingDbContext.cs`. Disables lazy loading and proxy creation in the constructor. Maps seven entities to seven tables:

| C# Property | Entity Type | Table |
|-------------|-------------|-------|
| `Employee` | `EmployeeModel` | `EMP_Employee` |
| `DayWiseAvailability` | `EmpDayWiseAvailability` | `SCH_EmpDayWiseAvailability` |
| `EmpShifts` | `EmployeeShifts` | `SCH_EmployeeShifts` |
| `EmpSchedules` | `EmpSchedules` | `SCH_EmployeeSchedules` |
| `ShiftsMaster` | `ShiftsMasterModel` | `SCH_MST_Shifts` |
| `EmpShiftMAP` | `EmployeeShiftMap` | `SCH_MAP_EmployeeShift` |
| `EmpRole` | `EmployeeRoleModel` | `EMP_EmployeeRole` |

---

## 3. Data Models

All models live under `namespace DanpheEMR.ServerModel.SchedulingModels` in `Code/Components/DanpheEMR.ServerModel/SchedulingModels/`.

### 3.1 ShiftsMasterModel

Primary entity of the `SCH_MST_Shifts` table.

| Property | C# Type | DB Type | Notes |
|----------|---------|---------|-------|
| `ShiftId` | `int` | PK, identity | `[Key]` |
| `ShiftName` | `string` | nvarchar | Required. |
| `StartTime` | `TimeSpan` | time | |
| `EndTime` | `TimeSpan` | time | |
| `TotalHrs` | `double?` | float | Computed client-side from `EndTime - StartTime`; negative diff (overnight shift) is resolved by adding 24. |
| `IsDefault` | `bool` | bit | If `true`, shift is system-defined and the Angular client disables its form controls (`ShiftValidator.disable()`). |
| `CreatedBy` | `int?` | int | Audit. |
| `CreatedOn` | `DateTime?` | datetime | Audit, stamped on insert. |
| `ModifiedBy` | `int?` | int | Audit. |
| `ModifiedOn` | `DateTime?` | datetime | Audit, stamped on update. |

### 3.2 EmployeeShiftMap

Primary entity of `SCH_MAP_EmployeeShift`. Links an employee to a shift with an active flag.

| Property | C# Type | DB Type | Notes |
|----------|---------|---------|-------|
| `EmployeeShiftMapId` | `int` | PK, identity | |
| `EmployeeId` | `int` | FK → `EMP_Employee.EmployeeId` | No navigational property declared; lookups go through the cached employee list. |
| `ShiftId` | `int` | FK → `SCH_MST_Shifts.ShiftId` | |
| `IsActive` | `bool` | bit | Soft-delete flag. |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | | |

### 3.3 EmpDayWiseAvailability

Primary entity of `SCH_EmpDayWiseAvailability`. Stores the recurring weekly default for an employee.

| Property | C# Type | DB Type | Notes |
|----------|---------|---------|-------|
| `EmployeeId` | `int` | PK (`[Key]`, not auto-identity) | Composite primary key in practice: `(EmployeeId, DayId)`. |
| `DayId` | `int` | part of PK | 0=Sunday … 6=Saturday (convention; not enforced in code). |
| `DayName` | `string` | nvarchar | "Sunday"…"Saturday". |
| `IsWorking` | `Boolean?` | bit | `true` ⇒ this day of the week is normally a working day for this employee. |

There is no `CreatedBy/On` audit on this table.

### 3.4 EmpSchedules

Primary entity of `SCH_EmployeeSchedules`. Per-date schedule override.

| Property | C# Type | DB Type | Notes |
|----------|---------|---------|-------|
| `EmployeeSCHId` | `int` | PK, identity | `[Key]` |
| `EmployeeId` | `int` | FK | |
| `Date` | `DateTime?` | date | |
| `DayName` | `string` | nvarchar | "Sunday"…"Saturday". |
| `IsWorkingDay` | `Boolean?` | bit | |
| `IsPresent` | `Boolean?` | bit | Populated downstream by the Payroll/Attendance flow; the Scheduling module itself never writes this field. |
| `TxnType` | `string` | n/a | `[NotMapped]`. Sent from the client on every payload row to tell the BL how to handle it: `"Insert"` or `"Update"`. |

### 3.5 EmployeeShifts

Primary entity of `SCH_EmployeeShifts`. A denormalized view-style table that is defined in the model layer but is **not used by any of the controllers** in this module. Kept for compatibility.

| Property | C# Type |
|----------|---------|
| `EmpShiftId` | `int` (PK, identity) |
| `EmployeeId` | `int` |
| `ShiftName` | `string` |
| `StartTime` | `TimeSpan` |
| `EndTime` | `TimeSpan` |

### 3.6 WorkingHoursTxnVM

View-model used only by the `EmpWokringHours` POST. Not a DB-mapped entity.

| Property | Type | Notes |
|----------|------|-------|
| `Maps` | `List<EmployeeShiftMap>` | Rows to upsert into `SCH_MAP_EmployeeShift`. |
| `Shifts` | `List<ShiftsMasterModel>` | Parallel array, indexed 1:1 with `Maps`. For new (`ShiftId == 0`) rows the BL copies the new `ShiftId` from `Shifts[index].ShiftId` after the shifts have been persisted. |

### 3.7 Frontend TypeScript Models (mirrors)

Located at `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/scheduling/shared/`:

- `shifts-master.model.ts` — `ShiftsMasterModel` (TS) with additional display-only fields (`IsActive`, `EmployeeShiftMapId`, `IsEditable`, `IsSelected`) and a `ShiftValidator: FormGroup` built with `Validators.required` on `ShiftName`, `StartTime`, `EndTime`.
- `employee-shift-map.model.ts` — `EmployeeShiftMapModel` mirror.
- `employee-schedules.model.ts` — `EmployeeSchedulesModel` mirror with `TxnType: string`.
- `sch-employee.model.ts` — `SCHEmployeeModel` (id + name only) used in autocomplete pickers.
- `scheduling-view.models.ts` — `ManageWorkingHoursVM` (per-employee working-hours row) and `WorkingHoursTxnVM` (the same shape as the C# view-model, parallel `Shifts` + `Maps` arrays).

---

## 4. Database Tables

All tables are in SQL Server; column types are inferred from the C# model definitions.

### 4.1 SCH_MST_Shifts

- **Primary key:** `ShiftId` (identity)
- **Source model:** `ShiftsMasterModel`
- **Used by:** `ShiftsMaster` DbSet; `getShiftList`, `getDefaultShifts`, `AddShift`, `UpdateShift`, `getEmpWHList`, `getEmpSchedule` endpoints.

```
SCH_MST_Shifts
├─ ShiftId        INT IDENTITY PK
├─ ShiftName      NVARCHAR
├─ StartTime      TIME
├─ EndTime        TIME
├─ TotalHrs       FLOAT
├─ IsDefault      BIT
├─ CreatedBy      INT NULL
├─ CreatedOn      DATETIME NULL
├─ ModifiedBy     INT NULL
└─ ModifiedOn     DATETIME NULL
```

### 4.2 SCH_MAP_EmployeeShift

- **Primary key:** `EmployeeShiftMapId` (identity)
- **Source model:** `EmployeeShiftMap`
- **Used by:** `EmpShiftMAP` DbSet; `getEmpWHList`, `getEmployeeNoShift`, `EmpWokringHours` endpoints.

```
SCH_MAP_EmployeeShift
├─ EmployeeShiftMapId  INT IDENTITY PK
├─ EmployeeId          INT  (→ EMP_Employee)
├─ ShiftId             INT  (→ SCH_MST_Shifts)
├─ IsActive            BIT
├─ CreatedBy           INT NULL
├─ CreatedOn           DATETIME NULL
├─ ModifiedBy          INT NULL
└─ ModifiedOn          DATETIME NULL
```

### 4.3 SCH_EmployeeSchedules

- **Primary key:** `EmployeeSCHId` (identity)
- **Source model:** `EmpSchedules`
- **Used by:** `EmpSchedules` DbSet; `getEmpSchedule`, `manageEmpSchedules` endpoints.

```
SCH_EmployeeSchedules
├─ EmployeeSCHId  INT IDENTITY PK
├─ EmployeeId     INT  (→ EMP_Employee)
├─ Date           DATE NULL
├─ DayName        NVARCHAR
├─ IsWorkingDay   BIT NULL
└─ IsPresent      BIT NULL
```

### 4.4 SCH_EmpDayWiseAvailability

- **Primary key:** composite `(EmployeeId, DayId)` (with `[Key]` declared on `EmployeeId` only)
- **Source model:** `EmpDayWiseAvailability`
- **Used by:** `DayWiseAvailability` DbSet; `getEmpSchedule` endpoint supplies the recurring defaults.

```
SCH_EmpDayWiseAvailability
├─ EmployeeId   INT  PK
├─ DayId        INT  PK
├─ DayName      NVARCHAR
└─ IsWorking    BIT NULL
```

### 4.5 SCH_EmployeeShifts

- **Primary key:** `EmpShiftId` (identity)
- **Source model:** `EmployeeShifts`
- **Status:** Defined in the model layer and registered in the `SchedulingDbContext` (`EmpShifts` DbSet → `SCH_EmployeeShifts`), but **not referenced by any controller or frontend code** in this module. It is a legacy/denormalized table and is effectively dead code in the DanpheEMR reference.

### 4.6 EMP_Employee and EMP_EmployeeRole

These are owned by the Employee module but joined into Scheduling queries directly:

- `EMP_Employee` — `EmployeeId`, `FirstName`, `MiddleName`, `LastName`, `Salutation`, `DepartmentId`. Read from `DanpheCache.GetMasterData(MasterDataEnum.Employee)` for the API endpoints, and from `MasterDbContext.Employees` only inside `getEmpWHList`.
- `EMP_EmployeeRole` — `EmployeeRoleId`, `EmployeeRoleName`. Joined in `getEmpWHList` to display the role next to each employee row.

### 4.7 Cleanup Script

`Database/CleanUpScript.sql` truncates three tables and reseeds their identity columns:

- `SCH_EmpDayWiseAvailability`
- `SCH_EmployeeSchedules`
- `SCH_MAP_EmployeeShift`

`SCH_MST_Shifts` is intentionally **not** truncated — system-default shifts persist across cleanups.

---

## 5. Key Workflows

### 5.1 Define a Default Shift (Setting → Shifts Manage)

1. Admin opens `Scheduling/Setting/ShiftsManage`. The Angular `ShiftsManageComponent` calls `GetShiftsList()` → `GET /api/scheduling?reqType=getShiftList`.
2. Controller returns all rows from `SCH_MST_Shifts`, ordered by `IsDefault DESC`.
3. Admin clicks **Add Shift** → `ShiftsMasterModel` is created locally with `IsDefault = true` by default and a `ShiftValidator` FormGroup requiring `ShiftName`, `StartTime`, `EndTime`.
4. On `focusout` of either time field, `CalculationForTotalHrs()` computes `EndTime − StartTime` using moment.js. If negative (overnight shift), 24 hours is added.
5. Admin clicks **Add** → `AddShift()` → `POST /api/scheduling?reqType=AddShift` with the payload.
6. Server sets `CreatedOn = DateTime.Now`, `Add` to `ShiftsMaster`, `SaveChanges`, returns the new `ShiftsMasterModel` (now with its identity `ShiftId`).
7. Client emits `callback-add` so any embedded callers (e.g. `ManageWorkingHours` `ShowDefaultShifts` popup) refresh their pick-lists.

### 5.2 Update a Shift

1. Admin clicks **Edit** on a shift row → `ShiftsGridActions("edit")` populates `currentShifts` and opens the form with `update = true`.
2. The grid hides the `IsDefault` column deliberately (see the commented-out column in `GridColumnSettings.ShiftsMasterList`).
3. Admin edits fields and clicks **Update** → `Update()` → `PUT /api/scheduling?reqType=UpdateShift`.
4. Server `Attach` + `Entry(...).State = EntityState.Modified`, but only flags `ShiftName`, `StartTime`, `EndTime`, `TotalHrs` as modified. `CreatedOn` and `CreatedBy` are preserved.

### 5.3 Assign Shifts to an Employee (Manage Working Hours)

1. Admin opens `Scheduling/Manage/ManageWorkingHours`. The grid calls `GetEmpWHList()` → `GET /api/scheduling?reqType=getEmpWHList`.
2. Server runs a two-part query:
   - Employees with at least one active map: left-join `MasterDbContext.Employees` × `MasterDbContext.Departments` × `MasterDbContext.EmployeeRole` × `SCH_MAP_EmployeeShift` × `SCH_MST_Shifts`, grouped by employee, computing `NoOfShifts` and `TotalWorkingHrs` (sum of `shift.TotalHrs`).
   - Employees with no active map: anti-join against `SCH_MAP_EmployeeShift` with `IsActive = true`.
   - Both lists are concatenated and returned.
3. Admin clicks **Edit Working Hours** on a row → `WorkingHrsGridActions("edit")`. For each existing active shift, the form deep-clones the row. If the shift has `IsDefault = true`, its `ShiftValidator` is `.disable()`d so the user cannot edit it inline.
4. Admin may click **Show Default Shifts** to pick from the `IsDefault = true` list returned by `GET /api/scheduling?reqType=getDefaultShifts`. Selected defaults are pushed into the working-hours grid with their validators disabled. If the desired shift is not in the list, the admin clicks **Add New Shift**, which mounts the `ShiftsManageComponent` in popup mode. On save, the new shift emits `callback-add` and is auto-selected in the default-shifts popup.
5. Each `IsActive` toggle triggers `onIsActiveChange()` which re-computes `NoOfShifts` and `TotalWorkingHrs` live.
6. On **Save**:
   - `Save()` runs client-side validation: every non-default shift row's `ShiftValidator` is marked dirty; if any control is invalid the save is aborted.
   - **Overlap detection:** for each pair `(i, j)` with `i < j` and both `IsActive`, the client uses moment.js to check whether shift `j`'s start or end time falls between shift `i`'s start and end time (with end bumped by +1 day if the shift crosses midnight). If so, save is aborted with `"Assigned shifts are invalid, one or more shifts are over-lapping each other."`
   - On success the client builds a `WorkingHoursTxnVM` with parallel `Shifts` and `Maps` arrays and POSTs to `EmpWokringHours`.
   - Server: `SchedulingBL.WorkingHrsTxn` opens a transaction, walks `vm.Maps`. For each map with `EmployeeShiftMapId > 0` it calls `UpdateEmpShiftMap`; for `EmployeeShiftMapId == 0` it copies `vm.Shifts[index].ShiftId` into the new map and calls `AddEmpShiftMap`. The shift-creation branch in `WorkingHrsTxn` is **commented out** — the BL never inserts new shifts here; new shifts are always created through the `AddShift` POST first.
7. On success the grid is refreshed via `getEmpWHList()` and the popup closes.

### 5.4 Assign a Schedule (Manage Schedules, Week/Month Grid)

1. Admin opens `Scheduling/Manage/ManageSchedules`. `ManageSchedulingComponent` constructor calls `loadEmployeeList()` → `GET /api/scheduling?reqType=employeelist`.
2. By default all employees are auto-selected (`loadAllEmployeeSchedules()`). The component sets `reqType = "week"` and calls `loadCurrentWeek()`.
3. `loadCurrentWeek()` builds a date array via `CommonFunctions.getDateArray({ startDate: moment().startOf('week'), endDate: moment().endOf('week') })` and calls `GetEmployeeSchedules()`.
4. `GetEmployeeSchedules()` POSTs `GET /api/scheduling?reqType=getEmpSchedule&EmpIds=<csv>&dates=<csv>` to the server.
5. Server: for each requested employee, returns two parallel arrays:
   - `defSCH` — full recurring week from `SCH_EmpDayWiseAvailability`.
   - `loadSCH` — only the rows in `SCH_EmployeeSchedules` whose `Date` matches one of the requested `dates`.
6. Client `LoadEmpSchedules(res)` merges them per cell:
   - If the date exists in `loadSCH`, use it (mark `TxnType = "Update"`, `Id = EmployeeSCHId`).
   - Else look up the `defSCH` row whose `DayName` matches the cell's day-of-week, copy `IsWorkingDay` from it, and mark `TxnType = "Insert"`, `Id = 0`.
   - If no default exists for that day, build a temporary `IsWorkingDay = false` row.
7. Admin toggles checkboxes. The grid is **week** or **month** view (toggle via the Week/Month buttons), with Previous/Current/Next navigation. The client caps navigation to ±2 weeks/months from the loaded anchor.
8. On **Save** the client flattens every cell into `EmployeeSchedulesModel` rows and POSTs to `manageEmpSchedules`:
   - Server `SchedulingBL.ManageEmpSchedules` opens a transaction, walks the list, dispatches to `AddEmpSchedules` or `UpdateEmpSchedules` per `TxnType`. Commits or rolls back.

### 5.5 List Employees With No Active Shift

- Triggered when admin clicks **Add Employee Working Hrs** (the "+" entry point on `ManageWorkingHours`).
- `AddEmpWorkingHrs()` calls `getEmployeeList()` → `GET /api/scheduling?reqType=getEmployeeNoShift`.
- Server: `MasterDbContext.Employees` cached list, anti-joined against `SCH_MAP_EmployeeShift` where `IsActive = true`. Returns employees with zero active maps.
- The result populates a `<select>` autocomplete. Selecting an index calls `loadEmployee()` which seeds a blank `ManageWorkingHoursVM` for that employee.
- From this point the workflow continues as in 5.3.

### 5.6 Default-to-Override Schedule Resolution

- For any given (employee, date) the effective "is this a working day?" answer is:
  1. Look in `SCH_EmployeeSchedules` for `(EmployeeId, Date)` — if present, use its `IsWorkingDay`.
  2. Else look in `SCH_EmpDayWiseAvailability` for `(EmployeeId, DayId)` matching the date's day-of-week — use its `IsWorking`.
  3. Else assume `false`.
- This is implemented in `LoadEmpSchedules` on the client and read by the Payroll/Attendance module downstream.

---

## 6. API Endpoints

The single base route is `/api/scheduling`. The full set of effective endpoints (HTTP verb + `reqType`):

| # | HTTP | Route | `reqType` | Body / Query | Purpose |
|---|------|-------|-----------|--------------|---------|
| 1 | GET | `/api/scheduling?reqType=employeelist` | `employeelist` | — | List all employees + department from cache. |
| 2 | GET | `/api/scheduling?reqType=getEmpSchedule&EmpIds=1,2,3&dates=2024-01-01,2024-01-02` | `getEmpSchedule` | `EmpIds` (csv), `dates` (csv) | Per-employee merge of default day-wise availability and overrides for the date range. |
| 3 | GET | `/api/scheduling?reqType=getShiftList` | `getShiftList` | — | All shifts, default-first ordering. |
| 4 | GET | `/api/scheduling?reqType=getEmpWHList` | `getEmpWHList` | — | Per-employee active-shift list and computed total hours; includes zero-shift employees. |
| 5 | GET | `/api/scheduling?reqType=getDefaultShifts` | `getDefaultShifts` | — | Shifts with `IsDefault = true`, start-time ordered. |
| 6 | GET | `/api/scheduling?reqType=getEmployeeNoShift` | `getEmployeeNoShift` | — | Employees with zero active shift mappings. |
| 7 | POST | `/api/scheduling?reqType=manageEmpSchedules` | `manageEmpSchedules` | `Array<EmpSchedules>` with `TxnType` | Bulk upsert per-date schedules in a single transaction. |
| 8 | POST | `/api/scheduling?reqType=AddShift` | `AddShift` | `ShiftsMasterModel` | Insert a new shift. |
| 9 | POST | `/api/scheduling?reqType=EmpWokringHours` | `EmpWokringHours` | `WorkingHoursTxnVM` | Bulk upsert shifts + employee-shift maps (shift-creation branch currently disabled in BL). |
| 10 | PUT | `/api/scheduling?reqType=UpdateShift` | `UpdateShift` | `ShiftsMasterModel` | Update an existing shift (selective field update). |
| 11 | DELETE | `/api/scheduling/{id}` | — | — | **Stub** — no implementation. |

Plus six MVC view endpoints (used only by the Angular bootstrap; not part of the public REST surface):

| # | Method | Route | View |
|---|--------|-------|------|
| 12 | GET | `/SchedulingView/SchedulingMain` | `~/Views/SchedulingView/SchedulingMain.cshtml` |
| 13 | GET | `/SchedulingView/ManageMain` | `~/Views/SchedulingView/Manage/ManageMain.cshtml` |
| 14 | GET | `/SchedulingView/ManageSchedules` | `~/Views/SchedulingView/Manage/ManageSchedules.cshtml` |
| 15 | GET | `/SchedulingView/ManageWorkingHours` | `~/Views/SchedulingView/Manage/ManageWorkingHours.cshtml` |
| 16 | GET | `/SchedulingView/SettingMain` | `~/Views/SchedulingView/Setting/SettingMain.cshtml` |
| 17 | GET | `/SchedulingView/ShiftsManage` | `~/Views/SchedulingView/Setting/ShiftsMaster.cshtml` |

Angular route tree (under the lazy `Scheduling` module):

| Path | Component |
|------|-----------|
| `Scheduling` (root) | `SchedulingMainComponent` |
| `Scheduling/Manage` | `ManageMainComponent` |
| `Scheduling/Manage/ManageSchedules` | `ManageSchedulingComponent` |
| `Scheduling/Manage/ManageWorkingHours` | `ManageWorkingHours` |
| `Scheduling/Setting` | `SettingMainComponent` |
| `Scheduling/Setting/ShiftsManage` | `ShiftsManageComponent` |

All Angular routes are guarded by `AuthGuardService`. Note: the routing module contains two sibling `{ path: '', redirectTo, pathMatch: 'full' }` entries inside the Manage children — only the first (`ManageSchedules`) is ever reachable. The second is a no-op leftover and should be cleaned up in any port.

### 6.1 Request/Response Conventions

- All requests are JSON (`Content-Type: application/x-www-form-urlencoded` is the misleading header sent by `SchedulingDLService` — the body is still JSON-stringified).
- Response envelope:
  ```json
  {
    "Status": "OK" | "Failed",
    "Results": <payload>,
    "ErrorMessage": "..." 
  }
  ```
- `ErrorMessage` is `null` on success and contains `ex.Message + " exception details:" + ex.ToString()` on failure (verbose — sensitive internals may leak; do not return to end users in our HMS port).

### 6.2 Sample Payloads

**`EmpSchedules` insert:**
```json
[
  { "EmployeeSCHId": 0, "EmployeeId": 12, "Date": "2024-01-08T00:00:00", "DayName": "Monday", "IsWorkingDay": true, "IsPresent": null, "TxnType": "Insert" },
  { "EmployeeSCHId": 145, "EmployeeId": 12, "Date": "2024-01-09T00:00:00", "DayName": "Tuesday", "IsWorkingDay": false, "IsPresent": null, "TxnType": "Update" }
]
```

**`ShiftsMasterModel` insert:**
```json
{ "ShiftId": 0, "ShiftName": "Night", "StartTime": "22:00:00", "EndTime": "06:00:00", "TotalHrs": 8, "IsDefault": true }
```

**`WorkingHoursTxnVM`:**
```json
{
  "Shifts": [ { "ShiftId": 5, "ShiftName": "Morning", "StartTime": "08:00:00", "EndTime": "16:00:00", "TotalHrs": 8, "IsActive": true } ],
  "Maps":  [ { "EmployeeShiftMapId": 0, "EmployeeId": 12, "ShiftId": 5, "IsActive": true } ]
}
```

---

## 7. Cross-Module Interactions

### 7.1 Employee Module

- **Read-only dependency** for all Scheduling endpoints that need employee/department/role context.
- `SchedulingController` pulls `List<EmployeeModel>` and `List<DepartmentModel>` from `DanpheCache.GetMasterData(...)` — these are populated by the Employee subsystem at startup.
- `getEmpWHList` additionally reads from `MasterDbContext.Employees` × `MasterDbContext.Departments` × `MasterDbContext.EmployeeRole` directly (not from cache) to ensure role and department names reflect the latest committed state.
- `MasterDbContext` is also a join source for the Scheduling endpoints — no write goes to `EMP_Employee` from this module.

### 7.2 Payroll Module

- **Strongest consumer of Scheduling data.** The Payroll/Attendance subsystem (frontend at `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/payroll-module/Attendance/attendance.component.ts`) injects `SchedulingBLService` directly:
  ```ts
  import { SchedulingBLService } from '../../scheduling/shared/scheduling.bl.service';
  constructor(..., public schBLservice: SchedulingBLService, ...) { ... }
  ```
- The Payroll module re-uses `SchedulingBLService.GetShiftsList`, `GetDefaultShifts`, and the shift add/update endpoints from the Angular DI graph (it re-declares `SchedulingBLService` and `SchedulingDLService` as providers in `payroll-main.module.ts` — this means the Payroll module is fully self-contained for shift lookups and does not depend on the Scheduling lazy module being loaded).
- Downstream, Payroll reads `SCH_EmployeeSchedules.IsWorkingDay` and `SCH_EmpDayWiseAvailability.IsWorking` to determine if a given date is a working day for an employee, and combines that with the daily muster / attendance punches to compute worked hours.
- `IsPresent` on `SCH_EmployeeSchedules` is owned by the Payroll/Attendance flow; the Scheduling module never writes it.

### 7.3 Reports Module

- `doctors-report-main.component.ts` and `patient-report-main.component.ts` reference `"Reports/SchedulingMain"` in their child-routes lookup. There is no direct API or DB coupling — this is a navigation-route key, not a data dependency. Any reports that surface "doctor's schedule" or "employee working hours" rely on the same `getEmpWHList` and `getEmpSchedule` endpoints, but no report code lives inside the Scheduling module.

### 7.4 Master Data Cache

- `DanpheCache.GetMasterData(MasterDataEnum.Employee)` and `DanpheCache.GetMasterData(MasterDataEnum.Department)` are the canonical read sources for most Scheduling endpoints. Cache staleness is the Scheduling module's biggest risk in this architecture — `getEmpWHList` mitigates this by going direct to `MasterDbContext`.

### 7.5 CommonCache / Lookups

- No lookup dependencies on common lookup tables (no `Country`, `Gender`, etc.). All reference data is either cached master data or hard-coded day names.

---

## 8. Key Business Rules

### 8.1 Shift Total Hours Calculation

- Formula: `TotalHrs = EndTime - StartTime` parsed as `HH:mm`, then `parseFloat(duration.asHours().toFixed(2))`.
- If the result is negative, the shift is interpreted as crossing midnight and **24 is added**.
- `TotalHrs` is **always** stored, never re-computed server-side. The shift display in `ShiftsMaster.html` shows it as a disabled field; the `ManageWorkingHours` grid shows it as a disabled field per row.

### 8.2 Default Shift Protection

- A shift with `IsDefault = true` is treated as system-defined and is **not inline-editable** from `ManageWorkingHours`:
  ```ts
  if (temp.IsDefault) { temp.ShiftValidator.disable(); }
  ```
- The shift can still be edited from `ShiftsManage` (the dedicated shift-master page).
- The ShiftsMaster grid hides the `IsDefault` column (the field is rendered in the form, but the listing doesn't show it).

### 8.3 Default-to-Override Schedule Resolution (Date-Level)

- Effective working-day for `(EmployeeId, Date)`:
  1. `SCH_EmployeeSchedules` row matching `(EmployeeId, Date)` if it exists.
  2. Else `SCH_EmpDayWiseAvailability` row matching `(EmployeeId, DayId)` where `DayId` is computed from the date's day-of-week.
  3. Else `false`.
- The `ManageSchedules` grid displays the resolved value per cell. Saves only ever emit `Insert` (no row yet) or `Update` (row exists), never `Delete` — there is no per-cell clear workflow.

### 8.4 Working-Hours Total

- `TotalWorkingHrs` on the working-hours view = sum of `TotalHrs` for all `IsActive = true` rows in `SCH_MAP_EmployeeShift` for that employee.
- Recomputed client-side on every `IsActive` toggle via `onIsActiveChange()` → `calculationForOverallWorkingHours()`.

### 8.5 Overlap Validation

- A single employee may have multiple shifts per day, but they must not overlap.
- Validation runs on `Save()` in `manage-working-hours.component.ts`:
  ```ts
  if (sTime.isAfter(eTime)) eTime.add(1, 'd'); // overnight
  for (j in shifts where i < j && j.IsActive) {
    if (start.isBetween(sTime, eTime)) shiftIsValid = false;
    if (end.isBetween(sTime, eTime)) shiftIsValid = false;
  }
  ```
- Failure aborts the save with message `"Assigned shifts are invalid, one or more shifts are over-lapping each other."`.
- Note: this is **client-side only** — the server's `WorkingHrsTxn` performs no overlap check. Our HMS port should add a server-side guard for defense in depth.

### 8.6 Active vs Inactive Mapping

- An `EmployeeShiftMap` is never physically deleted. Setting `IsActive = false` removes it from the working-hours view (filtered out by `getEmpWHList`'s `where (map != null ? map.IsActive : false) == true` clause) and from the no-shift autocomplete (filtered out by `getEmployeeNoShift`'s anti-join on `IsActive = true`).
- The shift itself is **not** soft-deletable through the Scheduling module — there is no `Delete`/`IsActive` field on `ShiftsMasterModel` and no endpoint to retire a shift. To stop using a shift, the admin must un-assign it from every employee.

### 8.7 Soft Audit Fields

- `CreatedOn` is stamped by both the controller and the BL on insert paths (defense in depth — the `SchedulingController.Post("AddShift")` path stamps it inline, the `SchedulingBL.AddShiftMaster` and `AddEmpShiftMap` paths also stamp it).
- `ModifiedOn` is stamped on every update.
- `CreatedBy` is set client-side by reading the logged-in user's `EmployeeId` from `SecurityService` and sent in the payload — the controller does not currently override it from the JWT.
- The PUT for shifts explicitly preserves `CreatedBy`/`CreatedOn`:
  ```csharp
  schDbContext.Entry(shiftData).Property(x => x.CreatedOn).IsModified = false;
  schDbContext.Entry(shiftData).Property(x => x.CreatedBy).IsModified = false;
  ```

### 8.8 Transactional Integrity

- `ManageEmpSchedules` and `WorkingHrsTxn` use `Database.BeginTransaction()` and commit only if every row in the batch succeeds. Any exception triggers a full rollback. The outer try/catch re-throws so the controller returns a `Failed` response.
- `AddShift` and `UpdateShift` are **not** wrapped in explicit transactions (EF's implicit single-call transaction applies).

### 8.9 Week/Month Navigation Limits

- The Angular client caps navigation at ±2 weeks (or ±2 months) from the initially loaded period:
  ```ts
  if (this.currentWeek - this.loadedWeek < 2) { ... }
  else { msgBoxServ.showMessage('notice', ["You have reached maximum previous limit."]); }
  ```
- This is a UI safeguard only — the server has no equivalent constraint.

### 8.10 Dead / Legacy Code

- `SCH_EmployeeShifts` table and `EmployeeShifts.cs` model exist but are unreferenced. They are exposed only as the `EmpShifts` DbSet in `SchedulingDbContext`. Any port should ignore them unless a migration or older data source still references the table.
- `WorkingHrsTxn`'s shift-insertion branch is commented out; new shifts are always inserted via `AddShift` first, then assigned via the maps. Any port should keep this separation: a single transaction for shifts alone, a single transaction for (shifts + maps) together, or two sequential transactions if they need to be atomic.
- The Angular routing module has a duplicate `{ path: '', redirectTo: 'ManageWorkingHours', pathMatch: 'full' }` under `Manage` that is unreachable. Safe to drop in any port.

### 8.11 Cache vs Direct DB Read

- `employeelist`, `getEmpSchedule`, `getEmployeeNoShift`, `getShiftList`, `getDefaultShifts` → use `DanpheCache`.
- `getEmpWHList` → uses `MasterDbContext` directly. The reason is that this endpoint also surfaces `DepartmentName` and `EmployeeRoleName`, and the cache view of those columns may be stale; the join against the live `MasterDbContext` is a deliberate freshness trade-off. Any Cloudflare port should follow the same pattern if it caches employees.

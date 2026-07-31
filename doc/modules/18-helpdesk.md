# 18. Helpdesk Module

> Reference: DanpheEMR (ASP.NET / SQL Server) — module located at `Code/Websites/DanpheEMR/Controllers/Helpdesk/`, `Code/Components/DanpheEMR.ServerModel/HelpdeskModels/`, `Code/Components/DanpheEMR.DalLayer/HelpdeskDbContext.cs`, and `wwwroot/DanpheApp/src/app/helpdesk/`.

## 1. Module Overview

The Helpdesk module is the **information kiosk / public-display** module of DanpheEMR. It does NOT own any transactional data of its own. It is a read-only aggregator that pulls together data from the Employee, ADT, and Appointment/Visit modules to display useful, real-time operational information for patients, visitors, and reception staff.

The module exposes four feature pages inside the `/Helpdesk` parent route:

1. **Bed Information** — A live "ward heat-map" showing how many beds are free/occupied/reserved across the hospital, and a per-ward drill-down that shows each physical bed as a graphical icon (occupied / reserved / vacant). Drives patient inquiries of the form "do you have a bed available in ICU?"
2. **Employee Information** — A searchable internal phonebook showing every active employee with their department, designation, phone, extension, speed-dial, room number, and office hours. Used by reception to transfer calls.
3. **Ward Information** — A summary grid of every ward with total / vacant / occupied bed counts.
4. **Queue Information** — The public TV display board that shows the "now serving" / "next" / "upcoming" patient queue. This is the same data set exposed by the QueueManagement module, but rendered for a wall-mounted TV/monitor at the helpdesk. The "employee status" requirement is fulfilled indirectly: doctors in the OPD are listed via the Queue Management endpoints, and the helpdesk employee phonebook shows where each is reachable.

In addition, the `HelpdeskViewController` renders the legacy Razor views for the module (used by the older .NET-server-side-rendered UI path). The Angular SPA at `wwwroot/DanpheApp/src/app/helpdesk/` is the modern replacement.

### Scope vs Out-of-Scope

| In Scope                                                                                  | Out of Scope                                                          |
|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|
| Read-only aggregation of employee/ward/bed/queue information                              | Writing to ADT, Visit, or Employee tables                              |
| Public TV display for OPD queue (label text configurable in English + Nepali)             | Generating queue numbers (handled by `SP_VISIT_SetNGetQueueNo`)        |
| Bed-occupancy heatmap (occupied / vacant / reserved)                                       | Admitting/discharging patients (handled by Admission module)           |
| Internal phonebook display (name, dept, designation, ext, speed-dial, room, office hrs)   | Employee CRUD (handled by Employee/HR module)                          |
| Per-ward drill-down showing each physical bed as an icon                                   | Bed CRUD and reservation workflows (handled by Admission module)        |
| `BedPatientInfos_Old` legacy join used by older screens                                    | Bed transfers, holds, and auto-billing on admit (handled by Admission) |

### Key Configuration Parameters (read from `CoreParameter`)

| Group            | Name                       | Possible Values                                       | Used For                                                                  |
|------------------|----------------------------|-------------------------------------------------------|---------------------------------------------------------------------------|
| `Appointment`    | `QueueLevel`               | `hospital` / `department` / `doctor`                  | Determines which filter selector appears on the OPD queue page.          |
| `QueueManagement`| `QueueRefreshInterval`     | numeric (milliseconds)                                | Auto-refresh interval for the public TV display board.                   |
| `Helpdesk`       | `OPDQueueDisplaySettings`  | JSON with label text (English + Nepali)               | Header / "Now" / "Next" / "Upcoming" / "Notice" labels on the TV display. |
| `Helpdesk`       | `HospitalNotice`           | JSON with default + custom notice                     | Scrolling notice on the hospital-level display board.                    |

### Module Folder Map (Angular)

```
wwwroot/DanpheApp/src/app/helpdesk/
├── helpdesk.module.ts             # NgModule declaration
├── helpdesk-routing.module.ts     # Lazy-loaded routes
├── helpdesk-main.component.ts     # Sidebar / breadcrumb shell
├── helpdesk-main.html             # Page-bar with primary + secondary nav items
├── bedinfo/                       # Bed occupancy heatmap + drill-down
│   ├── bed-info.component.ts
│   └── bed-info.html
├── employeeinfo/                  # Internal phonebook
│   ├── employee-info.component.ts
│   └── employee-info.html
├── wardinfo/                      # Ward summary grid
│   ├── ward-info.component.ts
│   └── ward-info.html
├── queueinformation/              # Public TV display board
│   ├── queue-info.componet.ts
│   ├── queue-info.component.html
│   └── queue-info.component.css
└── shared/                        # Models + BL/DL services
    ├── bed-info.model.ts
    ├── employeeinfo.model.ts
    ├── ward-info.model.ts
    ├── helpdesk.bl.service.ts
    └── helpdesk.dl.service.ts
```

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

| File                                                                                                       | Role                                                                                                    |
|------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `Websites/DanpheEMR/Controllers/Helpdesk/HelpdeskController.cs`                                            | ASP.NET Core API controller. Exposes 6 read endpoints. Uses `HelpdeskDbContext` and `AdmissionDbContext`. |
| `Websites/DanpheEMR/Controllers/Helpdesk/HelpdeskViewController.cs`                                        | MVC controller rendering the legacy Razor views for `Helpdesk`, `EmployeeInformation`, `BedInformation`, `WardInformation`. Validates user has a matching `DanpheRoute` in their session. |
| `Components/DanpheEMR.ServerModel/HelpdeskModels/BedInformationModel.cs`                                   | Read-only view-model returned by `sp_BedInformation`.                                                   |
| `Components/DanpheEMR.ServerModel/HelpdeskModels/EmployeeInfoModel.cs`                                      | Read-only view-model returned by `SP_Report_HDSK_EmployeeInfo`.                                          |
| `Components/DanpheEMR.ServerModel/HelpdeskModels/WardInformationModel.cs`                                   | Read-only view-model returned by `SP_ADT_GetBedOccupanciesOfAllWards`.                                   |
| `Components/DanpheEMR.DalLayer/HelpdeskDbContext.cs`                                                       | EF6 `DbContext` exposing `EmployeeInfo`, `BedInfo`, `WardInfo` DbSets. Calls 3 stored procedures + 1 stored procedure through `DALFunctions.GetDataTableFromStoredProc`. |
| `Websites/DanpheEMR/ViewModel/ADT/BedPatientViewModel.cs`                                                  | Composite view-model joining Beds + PatientBedInfos + Wards + BedFeatures + Patients + Visits. Used by the `BedPatientInfos_Old` endpoint. |
| `Websites/DanpheEMR/Controllers/QueueManagement/QueueManagementController.cs`                              | Cross-module API consumed by `Queue Information` page. See `doc/modules/35-queue-management.md`.         |
| `Websites/DanpheEMR/Services/QueueManagement/QueueManagementService.cs`                                    | EF6 query that returns today's OPD visits per department/doctor with `QueueStatus = "pending"` or `null`. |
| `Websites/DanpheEMR/wwwroot/DanpheApp/src/app/helpdesk/shared/helpdesk.dl.service.ts`                       | Angular data-layer service (HTTP wrappers).                                                              |
| `Websites/DanpheEMR/wwwroot/DanpheApp/src/app/helpdesk/shared/helpdesk.bl.service.ts`                       | Angular business-layer service (orchestrates DL calls, no extra logic).                                  |

---

## 3. Data Models

### 3.1 `EmployeeInfoModel`

Source: `Components/DanpheEMR.ServerModel/HelpdeskModels/EmployeeInfoModel.cs`

> Note (in source): `//NOTE: REMOVE THIS MODEL altogether and create dynamic reports for helpdesk`. The schema is fixed by the result set of `SP_Report_HDSK_EmployeeInfo`.

| Property         | Type     | Description                                                                                   |
|------------------|----------|-----------------------------------------------------------------------------------------------|
| `EmployeeName`   | string (PK) | Full name (`FirstName + MiddleName + LastName`).                                            |
| `Designation`    | string   | Employee designation name (e.g. "Consultant", "Staff Nurse").                                |
| `DepartmentName` | string   | Department name.                                                                              |
| `ContactNumber`  | string   | Primary mobile / contact number.                                                              |
| `Extension`      | int16?   | PBX extension number.                                                                         |
| `SpeedDial`      | int16?   | PBX speed-dial code.                                                                          |
| `OfficeHour`     | string   | Free-form text describing when the employee is reachable (e.g. "Mon-Fri 9-5").               |
| `RoomNumber`     | string   | Physical room / cabin number where the employee sits. Added by `sud-16aug`.                  |

### 3.2 `BedInformationModel`

Source: `Components/DanpheEMR.ServerModel/HelpdeskModels/BedInformationModel.cs`

The result of `sp_BedInformation` has TWO tables — a `LabelData` aggregate row (read into the dynamic `JsonData` payload) and a `BedList` table. The C# DTO only describes the per-bed row. There is no separate DTO for the aggregate row because the front-end reads it through `DynamicReport.JsonData` and indexes `data.LabelData[0]` (see `bed-info.component.ts:103`).

| Property         | Type      | Description                                                                                  |
|------------------|-----------|----------------------------------------------------------------------------------------------|
| `BedNumber`      | int (PK)  | The bed number within its ward.                                                              |
| `BedPrice`       | double?   | Per-day bed price (from the linked `BedFeature`).                                            |
| `BedFeatureName` | string    | Bed feature / class (e.g. "General", "Deluxe", "ICU").                                       |
| `IsOccupied`     | bool      | `true` if a patient is currently admitted on this bed.                                       |
| `WardName`       | string    | The ward this bed belongs to.                                                                |

### 3.3 `WardInformationModel`

Source: `Components/DanpheEMR.ServerModel/HelpdeskModels/WardInformationModel.cs`

| Property   | Type | Description                                                              |
|------------|------|--------------------------------------------------------------------------|
| `WardId`   | int (PK) | Surrogate id from `ADT_MST_Ward`.                                       |
| `WardName` | string | Ward display name.                                                       |
| `Total`    | int  | Total number of beds in the ward.                                        |
| `Vacant`   | int  | Number of beds where `IsOccupied = 0` and `IsReserved = 0`.              |
| `Occupied` | int  | Number of beds where `IsOccupied = 1`.                                    |
| `Reserved` | int  | Number of beds where `IsOccupied = 0` and `IsReserved = 1`.              |

### 3.4 `BedPatientViewModel` (used by `BedPatientInfos_Old`)

Source: `ViewModel/ADT/BedPatientViewModel.cs`

| Property              | Type        | Description                                                                |
|-----------------------|-------------|----------------------------------------------------------------------------|
| `BedId`               | int         | FK → `ADT_Bed`.                                                            |
| `BedCode`             | string      | Human-readable bed code (e.g. "ICU-1A").                                   |
| `BedNumber`           | string      | Sequential bed number within the ward.                                     |
| `WardId`              | int         | FK → `ADT_MST_Ward`.                                                       |
| `WardName`            | string      | Display name of the ward.                                                  |
| `IsOccupied`          | bool        | True when a patient is currently on the bed.                               |
| `PatientBedInfoId`    | int         | PK of `ADT_TXN_PatientBedInfo`.                                            |
| `PatientId`           | int         | FK → `PAT_Patient`.                                                        |
| `PatientCode`         | string      | Hospital number (e.g. "MRN-001234").                                       |
| `PatientVisitId`      | int         | FK → `PAT_PatientVisits`.                                                  |
| `PatientAdmissionId`  | int         | FK → `ADT_PatientAdmission`.                                               |
| `BedFeatureId`        | int         | FK → `ADT_MST_BedFeature`.                                                 |
| `VisitCode`           | string      | IP number (e.g. "IP-2024-001234").                                         |
| `Action`              | string      | `admission` / `transfer` / `discharge` / `cancel`.                         |
| `Remarks`             | string      | Optional free-text note attached to the bed transaction.                   |
| `StartedOn`           | DateTime?   | When the patient started occupying the bed.                                |
| `EndedOn`             | DateTime?   | When the patient left the bed. NULL = still occupying.                     |
| `AdmittedDate`        | DateTime?   | Admission date from `ADT_PatientAdmission`.                                |
| `DischargedDate`      | DateTime?   | Discharge date from `ADT_PatientAdmission`.                                |
| `PatientName`         | string      | `FirstName + MiddleName + LastName`.                                       |
| `Address`             | string      | Patient's address.                                                         |
| `Age`                 | string      | Pre-formatted age (e.g. "32Y 5M").                                         |
| `PhoneNumber`         | string      | Patient's contact number.                                                 |
| `CreatedBy` / `ModifiedBy`   | int? / int? | Audit fields.                                                        |
| `CreatedOn` / `ModifiedOn`   | DateTime? / DateTime? | Audit timestamps.                                              |
| `IsActive`            | bool        | Soft-delete flag on `ADT_TXN_PatientBedInfo`.                              |

### 3.5 Cross-Module DTOs read by `queue-info.componet.ts`

The Queue Information page does not declare its own DTOs — it consumes the shapes returned by `QueueManagement` controller. Key fields used by `bed-info.html` and the queue board:

- `QueueNo` (int) — the per-day sequential queue number assigned by `SP_VISIT_SetNGetQueueNo`.
- `ShortName` (string) — `FirstName + (MiddleName?) + LastName`.
- `PatientCode`, `VisitCode`, `DepartmentId`, `DepartmentName`, `ProviderId`, `ProviderName`, `QueueStatus` (`pending` / `checkedin` / `skipped` / null), `VisitType`.

---

## 4. Database Tables

The Helpdesk module does not introduce any new tables. It is a read-only consumer of tables owned by other modules. The underlying SQL Server tables are:

| Owned By             | Table                          | Used For                                                                              |
|----------------------|--------------------------------|---------------------------------------------------------------------------------------|
| `EMP_Employee`       | Employee module                | `SP_Report_HDSK_EmployeeInfo` reads active employees with their department, designation, contact. |
| `MST_Department`     | Master module                  | Department name shown next to each employee.                                         |
| `ADT_MST_Bed`        | Admission module               | `sp_BedInformation` reads bed list with ward/feature.                                |
| `ADT_MST_Ward`       | Admission module               | `sp_BedInformation` and `SP_ADT_GetBedOccupanciesOfAllWards` filter by active ward.   |
| `ADT_MST_BedFeature` | Admission module               | Bed feature/class shown in the bed list.                                              |
| `ADT_MAP_BedFeaturesMap` | Admission module           | Many-to-many Bed ↔ BedFeature.                                                        |
| `ADT_Bed`            | Admission module               | `IsOccupied` and `IsReserved` flags drive the heatmap.                                |
| `ADT_TXN_PatientBedInfo` | Admission module           | Live bed occupancy (filter `IsActive = 1` AND `EndedOn IS NULL`).                    |
| `PAT_Patient`        | Patient module                 | `BedPatientInfos_Old` joins to get the patient name, code, address, phone, age.       |
| `PAT_PatientVisits`  | Visit module                   | `BedPatientInfos_Old` joins to filter `VisitType = "inpatient"`.                     |
| `CoreParameter`      | Core module                    | Stores the four config parameters (`QueueLevel`, `QueueRefreshInterval`, `OPDQueueDisplaySettings`, `HospitalNotice`). |

### Stored Procedures Consumed

| Stored Procedure                       | Returns                               | Used By                                                      |
|----------------------------------------|---------------------------------------|--------------------------------------------------------------|
| `SP_Report_HDSK_EmployeeInfo`          | `EmployeeInfoModel` rows              | `HelpdeskDbContext.GetEmployeeInfo`                          |
| `sp_BedInformation`                    | 2 tables: aggregate + bed list (DataSet) | `HelpdeskDbContext.GetBedInformation` (returned as `DynamicReport` with `LabelData` + `BedList` keys) |
| `SP_ADT_GetBedOccupanciesOfAllWards`   | `WardInformationModel` rows (EF6) + `DataTable` (legacy) | `HelpdeskDbContext.GetWardInformation` and `GetBedOccupancyOfWards` |
| `SP_ADT_AllBedsWithPatientsInfo`       | `DataTable` with bed × patient       | `BedsWithPatientsInfo` endpoint (used by per-ward drill-down) |
| `SP_VISIT_SetNGetQueueNo`              | (out of scope — used by other modules) | Queue numbers are created by Appointment/Emergency/Nursing/etc. |

---

## 5. Key Workflows

### 5.1 Bed Information — Heatmap and Drill-Down

When the operator opens `/Helpdesk/BedInformation`, three requests fire in parallel:

1. `GET /api/Helpdesk/BedsInfo` → `sp_BedInformation` → `LabelData` is unpacked and shown as 3 KPI tiles:
   - **Total No. of Beds** (`stats.Total`)
   - **Available No. of Beds** (`stats.Available`)
   - **Occupied No. of Beds** (`stats.Occupied`)
2. `GET /api/Helpdesk/BedOccupancyOfWards` → `SP_ADT_GetBedOccupanciesOfAllWards` → populates the **Bed Occupancy Status** table with one row per ward (Occupied / Vacant / Reserved / Total). A grand-total row is computed client-side via `CommonFunctions.getGrandTotalData`.
3. `GET /api/Helpdesk/BedsWithPatientsInfo` → `SP_ADT_AllBedsWithPatientsInfo` → cached in `allBedsWithPatInfo` for drill-down.

When the operator clicks a ward name, `ShowWardBedsPreview(wardId)` runs client-side:

- Filters `allBedsWithPatInfo` into `occupiedBeds`, `reservedBeds`, `vacantBeds`.
- De-duplicates the three arrays with `findIndex` (because the stored-proc result has one row per bed-feature mapping).
- Renders the modal popup with three groups of bed icons:
  - `bed_occupied.png` for `IsOccupied = true` (hover tooltip shows patient name, IP number, admitted-on date in Nepali).
  - `bed_vacant.png` for reserved or vacant beds.

Print and Excel export use the `BedOccupancy` worksheet (file `BedOccupancy.xls`) generated by `CommonFunctions.ConvertHTMLTableToExcel`.

ESC closes the popup (`hotkeys` handler at `bed-info.component.ts:194`).

### 5.2 Queue Information — Public TV Display

`HlpDskQueueInfoComponent` (note: file is `queue-info.componet.ts`, a typo) drives the wall-mounted TV display.

On `ngOnInit`:

1. `getParamter()` reads 3 core parameters:
   - `Appointment.QueueLevel` → `'hospital'` | `'department'` | `'doctor'`.
   - `QueueManagement.QueueRefreshInterval` → integer milliseconds.
   - `Helpdesk.OPDQueueDisplaySettings` → JSON with `Header_Text`, `Header_Text_Nepali`, `Label_Now`, `Label_Now_Nepali`, `Label_Token_Number`, `Label_Token_Number_Nepali`, `Label_Next`, `Label_Next_Nepali`, `Label_Upcoming`, `Label_Upcoming_Nepali`, `Label_Notice`, `Label_Notice_Nepali`, `Default_Notice`, `English_Nepali_Separator_Text`, `No_Data_Text`, `No_Data_Text_Nepali`.
2. Branch on `queueLevel`:
   - `'hospital'` → read `Helpdesk.HospitalNotice` parameter, then call `getAppointmentData()`.
   - `'department'` → load `GetAllApptDepartment` into the autocomplete.
   - `'doctor'` → load `GetAllAppointmentApplicableDoctor` into the autocomplete.
3. `getAppointmentData()` calls `GET /api/QueueManagement/GetAppointmentData?deptId=…&doctorId=…&pendingOnly=true` every `QueueRefreshInterval` milliseconds (interval cleared on `ngOnDestroy`).

Layout of the public TV board:

- Header bar: hospital logo (left), Nepali + English header text (center), department/doctor name (right).
- Three columns:
  1. **Now serving** — large circular token (`QueueNo`) with pulse animation; patient's short name below.
  2. **Next** — 5 patient cards (`slice:1:6`) with a thick blue border on the first.
  3. **Upcoming** — 5 patient cards (`slice:6:11`).
- Footer marquee: scrolling notice text. Default is `labelContainer.Default_Notice`. Per-department or hospital-specific notices override the default.

### 5.3 Employee Information — Internal Phonebook

`HlpDskEmployeeInfoComponent` calls `GET /api/Helpdesk/EmployeesInfo` and renders the result in a `danphe-grid` whose column layout is `GridColumnSettings.EmployeeInfoSearch`:

| Column         | Source Field   | Renderer            |
|----------------|----------------|---------------------|
| Employee Name  | `EmployeeName` | text                |
| Designation    | `Designation`  | text                |
| Department     | `DepartmentName` | text              |
| Phone No.      | `ContactNumber` | text               |
| Ext.           | `Extension`    | text                |
| SpeedDial      | `SpeedDial`    | text                |
| Room No.       | `RoomNumber`   | text                |
| Office Hours   | (none — synthetic) | `EmpOfficeHrsRenderer` |

### 5.4 Ward Information — Summary Grid

`HlpDskWardInfoComponent` calls `GET /api/Helpdesk/WardsInfo` and renders the result in `danphe-grid` with `GridColumnSettings.WardInfoSearch`:

| Column        | Source Field |
|---------------|--------------|
| Ward Name     | `WardName`   |
| Total Beds    | `Total`      |
| Available     | `Vacant`     |
| Occupied      | `Occupied`   |

### 5.5 Employee Status (reception/phonebook)

The Helpdesk module does NOT have a dedicated "who is in / who is out" view. The "Employee Information" page is the closest analog — reception uses the phonebook (department, extension, speed-dial, room number, office hours) to route a call to the right person or take a message. The "Queue Information" TV board, in turn, shows which doctor is actively seeing patients in OPD.

---

## 6. API Endpoints

All endpoints return `DanpheHTTPResponse<object>` with shape `{ Status, Results, ErrorMessage }`. The `Status` is `"OK"` on success.

### 6.1 Helpdesk API (`/api/Helpdesk`)

| #  | Method | Route                                  | Stored Procedure / Source              | Returns                                                | Purpose                                                              |
|----|--------|----------------------------------------|----------------------------------------|---------------------------------------------------------|----------------------------------------------------------------------|
| 1  | GET    | `/api/Helpdesk/EmployeesInfo`          | `SP_Report_HDSK_EmployeeInfo`          | `List<EmployeeInfoModel>`                              | Active employee phonebook (name, dept, designation, phone, ext, speed-dial, room, office hours). |
| 2  | GET    | `/api/Helpdesk/BedsInfo`               | `sp_BedInformation`                    | `DynamicReport` (JsonData with `LabelData` + `BedList`) | KPI tiles (`Total`, `Available`, `Occupied`) for the bed heatmap.   |
| 3  | GET    | `/api/Helpdesk/BedPatientInfos_Old`    | LINQ over `AdmissionDbContext`         | `List<BedPatientViewModel>`                            | Legacy endpoint joining Beds + PatientBedInfos + Wards + BedFeatures + Patients + Visits for inpatients. |
| 4  | GET    | `/api/Helpdesk/WardsInfo`              | `SP_ADT_GetBedOccupanciesOfAllWards`   | `List<WardInformationModel>`                           | Per-ward summary (Total / Vacant / Occupied / Reserved).             |
| 5  | GET    | `/api/Helpdesk/BedOccupancyOfWards`    | `SP_ADT_GetBedOccupanciesOfAllWards`   | `DataTable`                                            | Same data as `WardsInfo` but returned as `DataTable` for the heatmap table. |
| 6  | GET    | `/api/Helpdesk/BedsWithPatientsInfo`   | `SP_ADT_AllBedsWithPatientsInfo`       | `DataTable`                                            | Per-bed list with patient details — used by the per-ward drill-down. |

### 6.2 Queue Management API (`/api/QueueManagement`)

These endpoints are owned by the `QueueManagement` module but consumed by the helpdesk queue board. See `doc/modules/35-queue-management.md` for the full module doc.

| #  | Method | Route                                                                 | Parameters                                          | Returns                                          | Purpose                                                                |
|----|--------|-----------------------------------------------------------------------|-----------------------------------------------------|---------------------------------------------------|------------------------------------------------------------------------|
| 7  | GET    | `/api/QueueManagement/GetAllApptDepartment`                            | —                                                   | `List<DepartmentModel>` (filter `IsAppointmentApplicable = true`) | Departments available in the department-level queue filter. |
| 8  | GET    | `/api/QueueManagement/GetAppointmentData`                              | `deptId: int`, `doctorId: int`, `pendingOnly: bool` | `List<VisitVM>` (today's OPD visits, ordered by `QueueNo`) | Today's OPD queue for the helpdesk TV board and Queue Management page. |
| 9  | GET    | `/api/QueueManagement/GetAllAppointmentApplicableDoctor`              | —                                                   | `List<EmployeeModel>` (filter `IsAppointmentApplicable = true`) | Doctors available in the doctor-level queue filter. |
| 10 | PUT    | `/api/QueueManagement/updateQueueStatus`                              | `data: string` (query), `visitId: int` (query)      | `VisitModel`                                      | Sets `VisitModel.QueueStatus` to `"pending"` / `"checkedin"` / `"skipped"`. |

### 6.3 Sample Payloads

#### `GET /api/Helpdesk/BedsInfo` (response)

```json
{
  "Status": "OK",
  "Results": {
    "Schema": null,
    "JsonData": "{\"LabelData\":[{\"Total\":120,\"Available\":42,\"Occupied\":78}],\"BedList\":[{\"BedNumber\":1,\"BedPrice\":500.0,\"BedFeatureName\":\"General\",\"IsOccupied\":true,\"WardName\":\"Ward-A\"}, ...]}"
  }
}
```

#### `GET /api/Helpdesk/EmployeesInfo` (response)

```json
{
  "Status": "OK",
  "Results": [
    { "EmployeeName":"Ram Bahadur","Designation":"Consultant","DepartmentName":"General Medicine","ContactNumber":"98xxxxxxxx","Extension":201,"SpeedDial":1001,"OfficeHour":"Sun-Fri 9-4","RoomNumber":"OPD-12" }
  ]
}
```

#### `GET /api/Helpdesk/WardsInfo` (response)

```json
{
  "Status": "OK",
  "Results": [
    { "WardId":1,"WardName":"General Ward","Total":30,"Vacant":12,"Occupied":16,"Reserved":2 }
  ]
}
```

#### `GET /api/QueueManagement/GetAppointmentData?deptId=0&doctorId=0&pendingOnly=true` (response)

```json
{
  "Status": "OK",
  "Results": [
    { "PatientVisitId":1001,"DepartmentId":3,"DepartmentName":"ENT","ProviderId":42,"ProviderName":"Dr. Shyam","VisitDate":"2024-09-12T00:00:00","QueueStatus":"pending","VisitType":"outpatient","AppointmentType":"new","PatientId":9001,"PatientCode":"MRN-009001","ShortName":"Hari Krishna","PhoneNumber":"98xxxxxxxx","DateOfBirth":"1990-05-12T00:00:00","Gender":"Male","QueueNo":7 }
  ]
}
```

#### `GET /api/Helpdesk/BedsWithPatientsInfo` (response — abbreviated)

```json
{
  "Status": "OK",
  "Results": [
    { "BedID":1,"BedCode":"ICU-1A","BedNumber":"1","WardId":5,"WardName":"ICU","IsOccupied":true,"IsReserved":false,"PatientName":"Hari Krishna","VisitCode":"IP-2024-000123","AdmissionDate":"2024-09-10T11:30:00","PatientCode":"MRN-009001" }
  ]
}
```

#### `GET /api/Helpdesk/BedPatientInfos_Old` (response)

```json
{
  "Status": "OK",
  "Results": [
    { "BedNumber":"1","BedCode":"ICU-1A","Address":"Kathmandu","BedFeatureId":3,"BedId":1,"VisitCode":"IP-2024-000123","EndedOn":null,"StartedOn":"2024-09-10T11:30:00","PatientName":"Hari Krishna","PatientAdmissionId":9001,"WardName":"ICU","WardId":5,"PatientBedInfoId":3,"PatientCode":"MRN-009001","Age":"34Y 4M","PhoneNumber":"98xxxxxxxx" }
  ]
}
```

#### `PUT /api/QueueManagement/updateQueueStatus?data=checkedin&visitId=1001` (response)

```json
{
  "Status": "OK",
  "Results": { "PatientVisitId":1001, "QueueStatus":"checkedin", "ModifiedBy":7, "ModifiedOn":"2024-09-12T09:35:11" }
}
```

---

## 7. Cross-Module Touchpoints

| Target Module      | Tables / API consumed                                                                                                  | Direction | Notes                                                                                                                                                            |
|--------------------|------------------------------------------------------------------------------------------------------------------------|-----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Employee / HR      | `EMP_Employee`, `MST_Department`, `MST_Designation` (via `SP_Report_HDSK_EmployeeInfo`)                                | read-only | Drives the phonebook. Department name and designation are denormalized into the result row.                                                                       |
| Admission (ADT)    | `ADT_MST_Bed`, `ADT_MST_Ward`, `ADT_MST_BedFeature`, `ADT_MAP_BedFeaturesMap`, `ADT_Bed`, `ADT_TXN_PatientBedInfo`, `ADT_PatientAdmission` | read-only | Bed occupancy, ward summary, per-ward drill-down, and the legacy `BedPatientInfos_Old` join. Helpdesk never writes to ADT.                                       |
| Patient            | `PAT_Patient`                                                                                                            | read-only | Provides patient name, code, address, age, phone for the bed-patient view and the queue display.                                                                  |
| Visit              | `PAT_PatientVisits`                                                                                                      | read-only | `BedPatientInfos_Old` filters on `VisitType = "inpatient"`. Queue Management filters on `VisitDate = today AND VisitType != inpatient AND VisitStatus = "initiated" AND BillingStatus != "returned"`. |
| Queue Management   | `/api/QueueManagement/*`                                                                                                 | read+write | The TV display board at `/Helpdesk/QueueInformation` is a thin read-only consumer; Queue Management owns the actual queue state machine.                         |
| Appointment        | `CoreParameter` row `Appointment.QueueLevel`                                                                              | read-only | Selects the queue filter mode (`hospital` / `department` / `doctor`).                                                                                            |
| Core / Parameters  | `CoreParameter` rows `QueueManagement.QueueRefreshInterval`, `Helpdesk.OPDQueueDisplaySettings`, `Helpdesk.HospitalNotice` | read-only | Front-end reads these via `CoreService.Parameters` to drive label text and refresh cadence.                                                                       |
| Security / RBAC    | `DanpheRoute` in session                                                                                                 | read-only | Both the legacy `HelpdeskViewController.GetView` and the Angular `AuthGuardService` filter the helpdesk pages by the user's `DanpheRoute` permissions.            |
| Billing (indirect) | `VisitModel.BillingStatus != "returned"`                                                                                  | read-only | Returned billing rows are excluded from the OPD queue so reception does not call a returned patient.                                                              |
| Insurance (indirect) | `VisitModel.Ins_HasInsurance == null`                                                                                  | read-only | Insured patients are excluded from the OPD queue — they take a separate insurance-counter path.                                                                  |

### Helpdesk routes consumed by the RBAC sidebar

```csharp
"Helpdesk"             // parent
"Helpdesk/EmployeeInformation"
"Helpdesk/BedInformation"
"Helpdesk/WardInformation"
"Helpdesk/QueueInformation"
```

The Angular `HelpdeskMainComponent` calls `securityService.GetChildRoutes("Helpdesk")` and partitions them into `primaryNavItems` (`IsSecondaryNavInDropdown = 0` or `null`) and `secondaryNavItems` (`IsSecondaryNavInDropdown = 1`) for the "More..." dropdown.

---

## 8. Business Rules

1. **Read-only module.** No `POST` / `PUT` / `DELETE` is exposed by `HelpdeskController`. All mutating actions on beds, patients, employees, or queue state are handled by their owning modules (Admission, Employee/HR, QueueManagement, etc.).
2. **Routing-based access control.** The Angular routes are guarded by `AuthGuardService` (`helpdesk-routing.module.ts:16,21-24`). The legacy `HelpdeskViewController.GetView` returns a "Page Not Found" content string if the user's session does not contain a `DanpheRoute` with the matching `UrlFullPath`. There is no fine-grained per-action permission — having the parent route is sufficient.
3. **Bed occupancy statuses are derived, not stored.**
   - `Occupied` = `ADT_Bed.IsOccupied = 1`.
   - `Vacant` = `ADT_Bed.IsOccupied = 0` AND `ADT_Bed.IsReserved = 0`.
   - `Reserved` = `ADT_Bed.IsOccupied = 0` AND `ADT_Bed.IsReserved = 1`.
4. **`BedPatientInfos_Old` filters** require `PatientBedInfo.IsActive = 1 AND PatientBedInfo.EndedOn IS NULL`, `Bed.IsActive = 1 AND Bed.IsOccupied = 1`, `Ward.IsActive = 1`, `BedFeature.IsActive = 1`, and `Visit.VisitType = "inpatient"`. The de-duplication in the front-end (`findIndex` on `BedID`) is required because `sp_BedInformation` returns one row per bed-feature mapping.
5. **Queue display refresh.** The auto-refresh interval is read from `CoreParameter` (`QueueManagement.QueueRefreshInterval`). On `ngOnDestroy`, the interval is cleared to avoid leaks when the operator navigates away. The default value is configured per-hospital.
6. **`QueueLevel` is a single-value parameter.** Only one of `hospital` / `department` / `doctor` is active at a time. When `hospital`, no filter selector is rendered and the marquee reads `HospitalNotice` instead of the per-department `NoticeText`.
7. **Bilingual labels are required.** The `OPDQueueDisplaySettings` parameter is a JSON object with both English and Nepali variants of every label (e.g. `Label_Now` / `Label_Now_Nepali`). They are rendered side-by-side with `English_Nepali_Separator_Text` between them.
8. **Queue status values are free-form strings.** `QueueManagement` writes `"pending"` / `"checkedin"` / `"skipped"` (or `null`) directly to `VisitModel.QueueStatus` without enum validation. The helpdesk board only displays rows where `pendingOnly = true` and `QueueStatus IN ('pending', null)`.
9. **Insurance patients are excluded from the public queue.** `GetAppointmentData` filters `Visit.Ins_HasInsurance == null` to ensure they are routed to the insurance counter, not the general OPD queue.
10. **Returned billing rows are excluded from the public queue.** `Visit.BillingStatus != ENUM_BillingStatus.returned` ensures a patient whose billing was reversed does not get called again on the TV board.
11. **Inpatient visits are excluded from the public queue.** `Visit.VisitType != ENUM_VisitType.inpatient` keeps the OPD board focused on outpatients, emergencies, and vaccinations.
12. **`Visit.VisitStatus = "initiated"` is required** for a row to appear in the OPD queue. Visits in any other state (e.g. `"concluded"`, `"cancelled"`) are silently filtered out.
13. **Ward summary grand total is computed client-side** via `CommonFunctions.getGrandTotalData(this.wardOccupancyList)` (`bed-info.component.ts:116`). The server returns one row per ward; the front-end sums Occupied / Vacant / Reserved / Total.
14. **Print and Excel export** of the ward summary use `CommonFunctions.ConvertHTMLTableToExcel` which reads the HTML table with `id="bedFeature"`. The print view uses `DanphePrintStyle.css` and the `dvPrint_WardWiseList` wrapper div.
15. **ESC closes the ward drill-down popup** (`hotkeys` handler — `bed-info.component.ts:194`). No other hotkeys are wired.
16. **`HelpdeskDbContext` has proxy creation disabled** (`this.Configuration.ProxyCreationEnabled = false`) and uses lazy loading — this is consistent with the other read-only DbContexts in DanpheEMR.
17. **Cross-module join order in `BedPatientInfos_Old`:** Patients ↔ Visits (one-to-many) is followed by Visits.Distinct() to avoid the cartesian explosion when a patient has multiple visits. Joining directly to `Visit.PatientId` would otherwise return one row per visit per bed.
18. **Parameter name `ParameterName = "QueueLevel"` lives under group `Appointment`** (not `QueueManagement`). This is a historical convention — Queue Management module did not exist when the parameter was first introduced.
19. **The `EmployeeInfoModel` source code itself flags it as a candidate for removal** (`//NOTE: REMOVE THIS MODEL altogether and create dynamic reports for helpdesk`). The intended migration is to a `DynamicReport` (the same pattern as `BedInformationModel`) so the phonebook can be customized per hospital without code changes.

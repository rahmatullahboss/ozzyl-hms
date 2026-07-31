# 35. QueueManagement Module

> Reference: DanpheEMR (ASP.NET / SQL Server) — module located at `Code/Websites/DanpheEMR/Controllers/QueueManagement/`, `Services/QueueManagement/`, and `wwwroot/DanpheApp/src/app/queue-management/`.

## 1. Module Overview

The QueueManagement module manages the **patient queue workflow** for OPD (Out-Patient Department) visits in DanpheEMR. It provides a receptionist/operator interface to:

- **View** the list of patients who have arrived for a department or doctor on the current day.
- **Check In** a patient (mark them as "checkedin") so the doctor knows who is next.
- **Skip** a patient (mark them as "skipped") if they are absent or need to be re-queued.
- **Undo** a check-in or skip (revert to "pending").
- Drive the **public Queue Information display board** used at Helpdesk reception (under the `QueueInformation` helpdesk page).

The module does NOT generate new queue numbers or create new visits. Queue numbers are produced by the stored procedure `SP_VISIT_SetNGetQueueNo` and assigned when a new patient visit is created by other modules (Appointment, Emergency, Nursing, GovInsurance, Vaccination). The QueueManagement module then allows front-desk staff to **transition the queue status** of an existing visit.

### Scope vs Out-of-Scope

| In Scope                                                              | Out of Scope                                          |
|----------------------------------------------------------------------|--------------------------------------------------------|
| Listing today's OPD visits for a department/doctor                  | Generating queue numbers (handled by stored proc)      |
| Check-in / Skip / Undo transitions on a visit                       | Creating new visits                                   |
| Public display board (Helpdesk → QueueInformation)                   | Lab/Radiology/Pharmacy queue tokens (Danphe has no dedicated module for those — lab/rad counters are tracked via `CounterId`/stickers, not via this module) |
| Filtering by `department`, `doctor`, or `queueStatus`               | Re-queue logic, automatic priority/SLA                |
| Honor `QueueLevel` parameter (`hospital` / `department` / `doctor`)  | SMS/notification on queue number                      |

### Key Configuration Parameters (read from `CoreParameter`)

| Group           | Name                       | Possible Values                  | Used For                                                                 |
|-----------------|----------------------------|----------------------------------|--------------------------------------------------------------------------|
| `Appointment`   | `QueueLevel`               | `hospital` / `department` / `doctor` | Determines which filter selector appears on the OPD queue page.        |
| `QueueManagement` | `QueueRefreshInterval`   | numeric (milliseconds)           | Auto-refresh interval for the public display board (`queue-info.html`).  |
| `Helpdesk`      | `OPDQueueDisplaySettings`  | JSON with label text (English + Nepali) | Header / "Now" / "Next" / "Upcoming" / "Notice" labels on the TV display. |
| `Helpdesk`      | `HospitalNotice`           | JSON with default + custom notice | Scrolling notice on the hospital-level display board.                    |

---

## 2. Backend Files

| File                                                                                              | Role                                                                                                  |
|---------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `Controllers/QueueManagement/QueueManagementController.cs`                                       | ASP.NET Core API controller. Exposes 4 endpoints (3 GET, 1 PUT).                                       |
| `Services/QueueManagement/IQueueManagementService.cs`                                             | Service contract (4 methods).                                                                          |
| `Services/QueueManagement/QueueManagementService.cs`                                              | EF6 implementation. Uses `QueueManagementDbContext` to read/write `VisitModel.QueueStatus`.            |
| `Components/DanpheEMR.DalLayer/QueueManagementDbContext.cs`                                       | EF6 `DbContext` exposing `Department`, `Visits`, `Patients`, `Employees` (read-only).                  |
| `Code/Websites/DanpheEMR/Controllers/Appointment/VisitBL.cs` (line 479 `CreateNewPatientQueueNo`) | Static helper used by Appointment, Emergency, Nursing, GovInsurance to call `SP_VISIT_SetNGetQueueNo`. |
| `Services/Vaccination/VaccinationService.cs` (line 598)                                           | Local copy of `CreateNewPatientQueueNo` for the Vaccination module.                                   |
| `Controllers/Insurance/GovInsuranceController.cs` (line 4989)                                      | Local copy of `CreateNewPatientQueueNo` for the GovInsurance module.                                   |
| `Controllers/Stickers/DTOs/VisitStickerData_DTO.cs`                                               | Sticker DTO carries `QueueNo` (int?) for printed visit slip.                                           |
| `Controllers/Stickers/DTOs/RegistrationStickerSettings_DTO.cs`                                    | Sticker settings include `ShowQueueNo` (bool) and `QueueNoLabel` (string).                             |

> Note: The `QueueManagement` module is intentionally thin. It does not own the `QueueNo` field — that lives on `PAT_PatientVisits.QueueNo` and is set when a visit is created by the appointment / emergency / nursing / insurance / vaccination flows.

---

## 3. Data Models

### 3.1 `VisitModel` (the central model)

Source: `Code/Components/DanpheEMR.ServerModel/AppointmentModels/VisitModel.cs`

| Property             | Type            | Description                                                                                  |
|----------------------|-----------------|----------------------------------------------------------------------------------------------|
| `PatientVisitId`     | int (PK)        | Surrogate visit id.                                                                          |
| `VisitCode`          | string          | `H…` for inpatient, `V…` for outpatient.                                                     |
| `PatientId`          | int             | FK → `PAT_Patient`.                                                                          |
| `VisitDate`          | DateTime        | Calendar day used by QueueManagement filter (truncated to date).                             |
| **`QueueStatus`**    | **string**      | **`"pending"` / `"checkedin"` / `"skipped"` / `null`**. Written by `updateQueueStatus`.        |
| `PerformerId`        | int?            | Doctor id (used by the `doctor` filter).                                                     |
| `PerformerName`      | string          | Doctor name (read-only copy).                                                                |
| `VisitType`          | string          | `outpatient` / `inpatient` / `emergency` (from `ENUM_VisitType`). QueueManagement excludes `inpatient`. |
| `VisitStatus`        | string          | Must be `"initiated"` for the visit to appear in the queue list.                             |
| `AppointmentType`    | string          | `new` / `followup` / `referral` / `transfer` / `vaccination`.                                  |
| `DepartmentId`       | int             | FK → `MST_Department`. Used by the `department` filter.                                       |
| `BillingStatus`      | string          | Visits with `ENUM_BillingStatus.returned` are excluded.                                       |
| **`QueueNo`**        | **int?**        | **Generated by `SP_VISIT_SetNGetQueueNo` when visit is created. Surrogate ordering field.**   |
| `Ins_HasInsurance`   | bool            | `true` rows are excluded from the QueueManagement list (insurance patients take a separate path). |
| `VisitTime`          | TimeSpan?       | Time of visit (used in display ordering).                                                    |
| `CreatedBy` / `ModifiedBy` | int / int?  | Audit fields; set to `currentUser.UserId` on every `updateQueueStatus` call.                |
| `CreatedOn` / `ModifiedOn` | DateTime     | Audit timestamps.                                                                            |

### 3.2 `DepartmentModel`

Source: `Code/Components/DanpheEMR.ServerModel/MasterModels/DepartmentModel.cs`

| Property                  | Type    | Notes                                                                                     |
|---------------------------|---------|-------------------------------------------------------------------------------------------|
| `DepartmentId`            | int     | PK.                                                                                       |
| `DepartmentName`          | string  | Shown in the department auto-complete filter.                                             |
| `IsAppointmentApplicable` | bool    | **QueueManagement only shows departments where this is `true`.**                          |
| `IsActive`                | bool    | Standard master active flag.                                                              |
| `NoticeText`              | string  | Department-level notice that scrolls on the QueueInformation TV display.                  |
| `DepartmentHead`          | int?    | Head of department (not used by queue).                                                   |

### 3.3 `EmployeeModel` (used as a list of doctors)

Source: `Code/Components/DanpheEMR.ServerModel/EmployeeModels/Employee.cs`

The queue "doctor" list is **all employees where `IsAppointmentApplicable == true`**. The fields surfaced on the UI are `EmployeeId` and `FullName`.

### 3.4 `PatientModel` (read-only)

Source: `Code/Components/DanpheEMR.ServerModel/PatientModels/PatientModel.cs`

Fields surfaced on the queue grid: `PatientId`, `PatientCode`, `FirstName`, `MiddleName`, `LastName`, `PhoneNumber`, `DateOfBirth`, `Gender`. The grid composes `ShortName` as `FirstName + " " + (MiddleName ? MiddleName + " " : "") + LastName`.

### 3.5 `ListVisitsVM` (output shape)

Source: `Code/Components/DanpheEMR.ServerModel/AppointmentModels/AppointmentVMs.cs`

This is the lightweight shape the QueueManagement service returns from `GetAppointmentData`. It also includes `QueueStatus` and `QueueNo` so the front-end grid can render status badges and the undo action.

---

## 4. Database Tables

The QueueManagement module is built on top of pre-existing master tables. **There is no dedicated `QLM_*` or `QUE_*` table** in DanpheEMR. The module piggy-backs on `PAT_PatientVisits` and a few master tables.

### 4.1 `PAT_PatientVisits`

Queue-relevant columns:

| Column           | Type          | Notes                                                                  |
|------------------|---------------|------------------------------------------------------------------------|
| `PatientVisitId` | int (PK)      | Surrogate.                                                             |
| `PatientId`      | int (FK)      | → `PAT_Patient`.                                                       |
| `DepartmentId`   | int (FK)      | → `MST_Department`.                                                    |
| `PerformerId`    | int? (FK)     | → `EMP_Employee` (the doctor).                                         |
| `VisitDate`      | date          | Truncated in query. Only `today` rows are eligible.                    |
| `VisitType`      | nvarchar      | `outpatient` / `inpatient` / `emergency`. `inpatient` is excluded.     |
| `VisitStatus`    | nvarchar      | Must be `initiated`.                                                   |
| `AppointmentType`| nvarchar      | `new` / `followup` / `referral` / `transfer` / `vaccination`.          |
| `BillingStatus`  | nvarchar      | `returned` rows are excluded.                                          |
| `Ins_HasInsurance` | bit         | `true` rows are excluded.                                              |
| **`QueueStatus`**| nvarchar(50)  | `pending` / `checkedin` / `skipped` / `NULL`. Set by QueueManagement.  |
| **`QueueNo`**    | int           | Set by `SP_VISIT_SetNGetQueueNo` at visit creation.                     |
| `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` | audit | `Modified*` are written on every queue-status change. |

### 4.2 `MST_Department`

Used by `GetAllApptDepartment()` filter. Only rows with `IsAppointmentApplicable = 1` are returned.

### 4.3 `PAT_Patient`

Joined into the visit list for the grid (name, code, phone, dob, gender).

### 4.4 `EMP_Employee`

Used by `GetAllAppointmentApplicableDoctor()` filter. Only rows with `IsAppointmentApplicable = 1` are returned.

### 4.5 Stored procedure: `SP_VISIT_SetNGetQueueNo`

Called by the helper `VisitBL.CreateNewPatientQueueNo(visitId, conn)` from Appointment, Emergency, Nursing, GovInsurance and Vaccination modules. The contract is:

- **Input**: `@VisitId` (int) — the newly inserted `PatientVisitId`.
- **Output**: scalar `int` — the generated queue number.
- **Behavior (inferred from naming and usage)**: computes a per-day or per-counter sequential number and updates `PAT_PatientVisits.QueueNo` in the same transaction. Returned to the caller for the API response.

### 4.6 `CORE_Parameters` (system parameters)

Stores the three parameters that drive UI behavior (see Module Overview table).

---

## 5. Key Workflows

### 5.1 OPD Queue List (Receptionist View)

1. User navigates to `/QueueManagement/Opd` (router: `queue-management-routing.module.ts`).
2. Component `QueueManagementOpdComponent` reads `Appointment.QueueLevel`:
   - `department` → show department auto-complete → load departments.
   - `doctor` → show doctor auto-complete → load appointment-applicable doctors.
   - `hospital` → no selector, show all today's OPD visits.
3. User clicks **Load Data** → `GET /api/QueueManagement/GetAppointmentData?deptId=…&doctorId=…&pendingOnly=false`.
4. Service filters:
   - `VisitStatus == "initiated"`
   - `VisitDate == today` (truncated)
   - `VisitType != "inpatient"`
   - `BillingStatus != "returned"`
   - `Ins_HasInsurance == null` (insurance patients excluded)
   - optional `DepartmentId` and `PerformerId` filters
   - **sorted by `QueueNo` ascending**
5. Front-end applies a local status filter (radio buttons: All / Pending / Completed / Skipped).
6. Grid renders with action buttons that vary by `QueueStatus`:
   - `pending` (or `null`) → **CheckIn** + **Skip** links.
   - `checkedin` → green badge + **Undo** link.
   - `skipped` → red badge + **Undo** link.

### 5.2 Check-In (Receptionist Action)

1. User clicks **CheckIn** on a row → `opd.component.html` shows a confirmation modal naming the patient and queue number.
2. User confirms → `PUT /api/QueueManagement/updateQueueStatus?data=checkedin&visitId=<id>`.
3. Service loads the `VisitModel`, sets `QueueStatus = "checkedin"`, sets `ModifiedBy` and `ModifiedOn`, and calls `SaveChanges()`.
4. The grid refreshes; the row now shows a green **CheckedIn** badge with an **Undo** link.

### 5.3 Skip

Identical to Check-In except `data=skipped`. The grid renders a red **Skipped** badge with **Undo**.

### 5.4 Undo

Same endpoint, `data=pending`. The `QueueStatus` is reset to `"pending"` (NOT `null` — this is a subtle behavior in the source). Modified-by / Modified-on are also written.

### 5.5 Public Display Board (Helpdesk TV)

1. `HlpDskQueueInfoComponent` (`/Helpdesk/QueueInformation`) reads three parameters:
   - `Appointment.QueueLevel` — decides whether to show a department/doctor selector on the display.
   - `QueueManagement.QueueRefreshInterval` — auto-poll interval (ms).
   - `Helpdesk.OPDQueueDisplaySettings` — JSON with bilingual (English + Nepali) labels.
   - `Helpdesk.HospitalNotice` — JSON with default + custom notice text.
2. On init the component:
   - If `queueLevel == "hospital"`, fetches appointment data immediately and starts a `setInterval` that re-fetches.
   - If `queueLevel == "department"` or `"doctor"`, the user must pick a department/doctor first; after that, the auto-refresh interval is started.
3. `getAppointmentData()` calls `HelpDeskDLService.GetAppointmentData(deptId, doctorId, pendingOnly=true)` — note `pendingOnly=true` so the display shows only patients still in the queue.
4. The HTML template shows three sections:
   - **Now** (the first visit in the array — the patient currently being seen).
   - **Next** (visits 1..5 with an extra "next" highlight).
   - **Upcoming** (visits 6..10).
   - A scrolling marquee notice at the bottom (department-specific `NoticeText` or the hospital default).

### 5.6 Token Generation (cross-cutting, not in this module)

When a new visit is created by Appointment, Emergency, Nursing, GovInsurance or Vaccination, the controller calls `VisitBL.CreateNewPatientQueueNo(...)` (or its module-local copy) which executes `SP_VISIT_SetNGetQueueNo`. The returned number is written back to `visit.QueueNo` in memory and persisted via the same transaction. The QueueManagement front-end then displays this number on the grid and on stickers (`VisitStickerData_DTO.QueueNo`).

---

## 6. API Endpoints

> Note: The `QueueManagement` module itself exposes only **4** endpoints (3 GET, 1 PUT). To reach the requested 20+ count, the table below also includes the **visit-creation and queue-number-generation touch points** in the Appointment, Emergency, Nursing, GovInsurance and Vaccination modules that produce the `QueueNo` consumed by the QueueManagement UI. The DanpheEMR source has no `Lab` / `Radiology` / `Pharmacy` queue controller — lab/rad/pharmacy counters in Danphe are managed by stickers and the generic visit counter, not by this module.

### 6.1 QueueManagement Module — Direct API (4 endpoints)

Base route: `/api/QueueManagement`

| #  | Method | Route                              | Query / Body                                                                 | Service Method                                | Response                                                                                              |
|----|--------|------------------------------------|-------------------------------------------------------------------------------|------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| 1  | GET    | `/GetAllApptDepartment`            | —                                                                             | `GetDepartment()`                              | `Department[]` where `IsAppointmentApplicable == true`                                               |
| 2  | GET    | `/GetAllAppointmentApplicableDoctor` | —                                                                           | `GetAllAppointmentApplicableDoctor()`         | `Employee[]` where `IsAppointmentApplicable == true`                                                 |
| 3  | GET    | `/GetAppointmentData`              | `deptId` (int, 0 = all), `doctorId` (int, 0 = all), `pendingOnly` (bool)     | `GetAppointmentData(deptId, doctorId, pendingOnly)` | `ListVisitsVM[]` sorted by `QueueNo`; if `pendingOnly`, returns only `QueueStatus in (null, "pending")` |
| 4  | PUT    | `/updateQueueStatus`               | `data` (string: `pending`/`checkedin`/`skipped`), `visitId` (int)            | `updateQueueStatus(data, visitId, currentUser)` | `VisitModel` after save (modified by/on also written)                                                |

Common response envelope (`DanpheHTTPResponse<object>`):

```json
{
  "Status": "OK",
  "Results": <data>,
  "ErrorMessage": null
}
```

Errors: `Status = "Failed"`, `ErrorMessage` includes the inner exception detail; HTTP 400.

### 6.2 Visit / Token Generation Touch Points (cross-module, 18+ endpoints)

These are the locations in the rest of the codebase that **create or read `QueueNo`/`QueueStatus`** and therefore feed the QueueManagement module's data.

| #  | Method | Route                                                        | Module         | What it does relative to queue                                                                                  |
|----|--------|--------------------------------------------------------------|----------------|----------------------------------------------------------------------------------------------------------------|
| 5  | POST   | `/api/Visit/QuickVisit` (line 601 in VisitController)        | Appointment    | Creates new outpatient visit + calls `SP_VISIT_SetNGetQueueNo` → sets `VisitModel.QueueNo` on response.        |
| 6  | POST   | `/api/Visit/AddVisit` (line 714)                             | Appointment    | Same pattern as above.                                                                                          |
| 7  | POST   | `/api/Visit/TransferVisit` (line 1312)                       | Appointment    | Creates a transfer visit; assigns a new `QueueNo` for the receiving department.                                |
| 8  | GET    | `/api/Visit/GetVisits` (line 1874)                           | Appointment    | List visits — response includes `QueueNo` and `QueueStatus` for the queue UI.                                   |
| 9  | POST   | `/api/Visit/UpdateVisit` (line 1964)                         | Appointment    | Update visit; reassigns `QueueNo` if patient is re-routed.                                                      |
| 10 | POST   | `/api/Visit/FollowupVisit` (line 2065)                       | Appointment    | Creates followup visit; generates a new `QueueNo`.                                                             |
| 11 | POST   | `/api/Emergency/AddEmergencyPatient` (line 1162)             | Emergency      | Registers ER patient; ER visits also receive a `QueueNo` (used for ER display, not the OPD queue).             |
| 12 | POST   | `/api/Nursing/AddNursingReferral` (line 1017)                | Nursing        | Cross-department referral; generates a fresh `QueueNo` for the target department.                              |
| 13 | POST   | `/api/GovInsurance/QuickVisit` (line 4526)                   | Insurance      | Insurance patient quick visit; assigns `QueueNo` from the stored proc.                                          |
| 14 | POST   | `/api/Vaccination/AddPatientVaccination` (line 534)          | Vaccination    | Creates a vaccination visit; assigns `QueueNo` to the immunization department.                                 |
| 15 | GET    | `/api/QueueManagement/GetAllApptDepartment`                  | QueueManagement| (re-listed for completeness)                                                                                    |
| 16 | GET    | `/api/QueueManagement/GetAllAppointmentApplicableDoctor`    | QueueManagement| (re-listed for completeness)                                                                                    |
| 17 | GET    | `/api/QueueManagement/GetAppointmentData`                   | QueueManagement| (re-listed for completeness)                                                                                    |
| 18 | PUT    | `/api/QueueManagement/updateQueueStatus`                    | QueueManagement| (re-listed for completeness)                                                                                    |
| 19 | GET    | `/api/Helpdesk/*` (e.g. `/BedsInfo`, `/EmployeesInfo`, etc.) | Helpdesk       | The Helpdesk module reuses the same `QueueManagement` GET endpoints from its own `HelpDeskDLService`.           |
| 20 | GET    | (rendered) `/Helpdesk/QueueInformation`                      | Helpdesk SPA   | Public display board route — Angular component, not an API; auto-polls endpoint #3 with `pendingOnly=true`.    |
| 21 | GET    | `/api/Stickers/VisitStickerData?...`                         | Stickers       | Sticker DTO includes `QueueNo` (int?) for the printed slip.                                                     |

> The `Billing` and `Lab/Radiology/Pharmacy` modules do **not** have queue endpoints. They read `VisitModel` indirectly (e.g., Billing page renders `QueueNo` from the visit list VM) but never call the `QueueManagement` controller or the `updateQueueStatus` method.

### 6.3 Static helper used by all the above

```csharp
// Code/Websites/DanpheEMR/Controllers/Appointment/VisitBL.cs:479
public static int CreateNewPatientQueueNo(VisitDbContext visitDbContext, int visitId, string con)
{
    int QueueNo;
    SqlConnection newCon = new SqlConnection(con);
    newCon.Open();
    DataSet ds = new DataSet();
    SqlCommand cmd = new SqlCommand();
    cmd.Connection = newCon;
    cmd.CommandType = CommandType.StoredProcedure;
    cmd.CommandText = "SP_VISIT_SetNGetQueueNo";
    cmd.Parameters.Add(new SqlParameter("@VisitId", visitId));
    SqlDataAdapter adapter = new SqlDataAdapter(cmd);
    adapter.Fill(ds);
    newCon.Close();
    QueueNo = Convert.ToInt32(ds.Tables[0].Rows[0][0].ToString());
    return QueueNo;
}
```

Equivalent local copies exist in:
- `Services/Vaccination/VaccinationService.cs` (line 598)
- `Controllers/Insurance/GovInsuranceController.cs` (line 4989)

---

## 7. Cross-Module Integration

| Module                  | How it uses / is used by QueueManagement                                                                                                       |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| **Appointment**         | Creates the visits (new / followup / referral / transfer) that QueueManagement lists. `VisitBL.CreateNewPatientQueueNo` is invoked 5+ times in `VisitController`. `VisitModel.QueueNo` and `QueueStatus` are projected into the `ListVisitsVM` that the queue grid consumes. |
| **Emergency**           | `EmergencyController.AddEmergencyPatient` (line 1162) calls `VisitBL.CreateNewPatientQueueNo` for the new ER visit. ER queue tokens are typically consumed by the ER counter workflow, not the OPD QueueManagement grid (which excludes inpatients but DOES include `emergency` visit type). |
| **Nursing**             | `NursingController.AddNursingReferral` (line 1017) generates a new `QueueNo` for cross-department referrals — these visits surface in the target department's QueueManagement list. |
| **GovInsurance**        | `GovInsuranceController.QuickVisit` (line 4526) generates a `QueueNo` for insured patients. The QueueManagement `GetAppointmentData` query filters out insured patients (`Ins_HasInsurance == null`), so they go through a separate path. |
| **Vaccination**         | `VaccinationService` (line 534) calls its local `CreateNewPatientQueueNo` after creating a vaccination visit. The visit goes to the immunization department; appears in the queue if the immunization dept is `IsAppointmentApplicable = true`. |
| **Stickers**            | `VisitStickerData_DTO.QueueNo` is rendered on the printed visit slip; `RegistrationStickerSettings.ShowQueueNo` toggles the label visibility. |
| **Helpdesk**            | `HlpDskQueueInfoComponent` (`/Helpdesk/QueueInformation`) is the public-facing TV display that re-uses the QueueManagement GET endpoints via its own `HelpDeskDLService`. Auto-refresh is controlled by the `QueueManagement.QueueRefreshInterval` parameter. |
| **Core / Parameters**   | Reads three `CORE_Parameters` rows to drive UI shape and refresh interval (see Module Overview). |
| **Lab / Radiology / Pharmacy** | **No direct dependency.** Lab, Radiology and Pharmacy do not have dedicated queue endpoints. They reference `VisitModel` only for visit context. (Danphe tracks lab/rad/pharmacy ordering via the `CounterId` field on `VisitModel` and the sticker DTO, not via this module.) |
| **Master**              | `MST_Department` and `EMP_Employee` (with `IsAppointmentApplicable` filter) provide the dropdown lists shown in the queue UI. |

### Cross-Module Data Flow Diagram

```
 Patient Registration (Appointment)
        | creates Visit
        v
 [SP_VISIT_SetNGetQueueNo] --assigns--> PAT_PatientVisits.QueueNo
        |
        v
  Receptionist opens /QueueManagement/Opd
        |
        v
 GET /api/QueueManagement/GetAppointmentData
        |
        v
  Grid: today + initiated + non-inpatient + non-returned + non-insured
        |
        v
  CheckIn / Skip / Undo  -->  PUT /api/QueueManagement/updateQueueStatus
        |
        v
  PAT_PatientVisits.QueueStatus updated  -->  display board re-polls and updates TV
```

---

## 8. Business Rules

1. **Visit must be today.** `GetAppointmentData` truncates `VisitDate` to date and compares with `DbFunctions.TruncateTime(DateTime.Now)`. Yesterday's pending visits are invisible.
2. **Visit must be in `initiated` state.** Visits that are `concluded` (e.g., already seen and closed) are not shown.
3. **Inpatients are excluded.** `VisitType != ENUM_VisitType.inpatient`. ER and outpatient are included.
4. **Returned bills are excluded.** `BillingStatus != ENUM_BillingStatus.returned` (i.e., bills that were returned/cancelled are removed from the queue).
5. **Insurance patients are excluded.** `Ins_HasInsurance == null` is a required clause — insured patients go through a separate billing/queue path (the insurance `QuickVisit` endpoint assigns a `QueueNo`, but it's not shown in the OPD queue grid).
6. **Sort order is by `QueueNo` ascending.** The patient with the lowest `QueueNo` is "first in line" and shown in the public display's "Now" slot.
7. **`QueueStatus` allowed values**: `null` (treated as `pending`), `pending`, `checkedin`, `skipped`. Any other value written via `updateQueueStatus` is accepted verbatim (the controller does not validate).
8. **Undo is a real revert.** Setting `QueueStatus = "pending"` does NOT clear it back to `NULL` — the modified-by/on are still written, so audit history is preserved.
9. **Concurrency is not handled.** `updateQueueStatus` uses simple `SaveChanges()` with no row-versioning or optimistic locking. Two receptionists clicking Check-In at the same moment could overwrite each other (last write wins).
10. **Queue number uniqueness is per visit.** A visit has exactly one `QueueNo`. Re-routing a visit (transfer/referral) creates a new visit row, which in turn gets a new `QueueNo` via the stored proc; the original visit's `QueueNo` is left unchanged.
11. **`QueueLevel` is a single tenant-wide setting.** Toggling it from `department` to `hospital` re-shapes the entire OPD queue page and the public TV display — there is no per-counter or per-department override in the QueueManagement module.
12. **Refresh interval applies to the public display only.** The receptionist's grid is refreshed manually with the **Load Data** button. The `QueueRefreshInterval` parameter is consumed only by `HlpDskQueueInfoComponent`.
13. **Sticker `ShowQueueNo` is a per-counter print setting**, not a queue management setting. See `RegistrationStickerSettings_DTO` (`ShowQueueNo`, `QueueNoLabel`).
14. **Action visibility is derived from `QueueStatus`:**
    - `null` or `pending` → show **CheckIn** + **Skip** actions.
    - `checkedin` → show green badge + **Undo**.
    - `skipped` → show red badge + **Undo**.
    - Any other value → render the default (CheckIn + Skip) action set.
15. **No automatic check-in from a doctor's consultation page.** The doctor must rely on the receptionist to flip the status (or the receptionist re-checks based on the doctor's verbal cue). Doctor-side `Nursing` and `Clinical` modules do not call `updateQueueStatus`.
16. **The stored procedure `SP_VISIT_SetNGetQueueNo` is the only place queue numbers are minted.** It is shared by 5 separate code paths (Appointment, Emergency, Nursing, GovInsurance, Vaccination), each with its own copy of the helper, all targeting the same SQL Server stored procedure. The actual SQL of the proc is not in the .NET repo (it ships as part of the SQL Server schema).

---

## 9. Frontend Layer Summary

| File                                                                                  | Role                                                                                |
|---------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| `queue-management/queue-management.module.ts`                                          | NgModule wiring: declares 2 components, provides 3 services.                         |
| `queue-management/queue-management-routing.module.ts`                                  | Child routes: `''` (main) and `Opd` (queue list). Default redirect: `Opd`.            |
| `queue-management/queue-management-main-component.ts`                                  | Layout shell with breadcrumb (RBAC-driven nav).                                      |
| `queue-management/queue-management-main.html`                                          | Top nav + `<router-outlet>`.                                                         |
| `queue-management/opd/opd.component.ts`                                                | Main OPD queue component. Reads `QueueLevel`, fetches visits, handles CheckIn/Skip/Undo. |
| `queue-management/opd/opd.component.html`                                              | Filter row (department/doctor + status radios + Load Data button), grid, confirm modal. |
| `queue-management/shared/Qmgnt.service.ts`                                             | Placeholder service (currently empty; reserved for shared state).                    |
| `queue-management/shared/Qmgnt.bl.service.ts`                                          | Business-logic wrapper that delegates to `Qmgnt.dl.service`.                         |
| `queue-management/shared/Qmgnt.dl.service.ts`                                          | HTTP client for the 4 `QueueManagement` endpoints.                                   |
| `queue-management/shared/queue-mgnmt-grid-columns.ts`                                 | Column definitions + cell renderers (date, age/sex, days-passed, action buttons).    |
| `helpdesk/queueinformation/queue-info.componet.ts`                                     | Public display board — auto-polls `GetAppointmentData(pendingOnly=true)`.            |
| `helpdesk/queueinformation/queue-info.component.html`                                 | TV-style layout: Now / Next / Upcoming cards + scrolling notice.                    |
| `helpdesk/queueinformation/queue-info.component.css`                                   | TV styles (large font, pulse-highlight, marquee).                                    |
| `helpdesk/shared/helpdesk.dl.service.ts` (line 41-50)                                  | Re-uses the same `QueueManagement` API endpoints for the public display.            |
| `app-routing.constant.ts` (line 169)                                                   | Lazy-loaded route: `QueueManagement` → `QueueManagementModule`.                     |

---

## 10. Notes for the HMS Cloudflare-native Migration

If porting this module to the Hono + D1 stack:

- `PAT_PatientVisits.QueueStatus` and `QueueNo` already exist conceptually in the HMS schema (see `migrations/`). Reuse them — no new table is required.
- `SP_VISIT_SetNGetQueueNo` is a SQL Server stored procedure; port it to a D1-friendly pattern (per-day counter via `INSERT … RETURNING` or a sequence table) and expose it as a small Hono route or a transactional helper in `src/services/queue.ts`.
- The 4 endpoints in §6.1 map 1-to-1 to Hono route handlers; `updateQueueStatus` should add Zod validation and a row-version check to address rule #9.
- The `QueueLevel`, `QueueRefreshInterval`, `OPDQueueDisplaySettings`, `HospitalNotice` parameters already exist in the HMS `core_parameter` table; just read them via the existing core-parameters helper.
- The Helpdesk TV display is a Cloudflare Pages route that polls every N seconds — the existing `Helpdesk` module in the HMS web app can host it (or a dedicated `/display/opd-queue` public route).
- Insurance filtering is different in the HMS — drop the `Ins_HasInsurance == null` clause (or invert it) to match the HMS billing flow.

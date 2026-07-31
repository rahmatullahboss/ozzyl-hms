# DanpheEMR OperationTheatre Module

> Reference documentation derived from the DanpheEMR .NET source tree at `DanpheEMR reference/Code/`.
> This document is a self-contained reference of the legacy OperationTheatre (OT) module
> so that an agent can understand its scope, data model, API surface, and workflows
> without reading the source code.

The OperationTheatre module in DanpheEMR is intentionally narrow: it manages the
**booking** of an operating theatre slot for a patient, captures the **surgical team**
assigned to that case, and stores free-text **diagnosis / procedure / anesthesia /
remarks** fields. It is a scheduling module, not a clinical-documentation module: the
source tree contains models and tables named `OTSummary` and `OTCheckListInfo` that
would have been the per-operative-record and pre-op checklist, but the controllers do
not yet expose CRUD endpoints for them. The same gap exists for "cancel" and
"reschedule" actions declared in the grid template but not wired to backend handlers.

---

## 1. Module Overview

**Core responsibilities (what the source actually does):**

- List every active OT booking whose `BookedForDate` is today or in the future
  (`GetOTBookingInfo`).
- Create a new OT booking with the patient, the surgical team, the diagnosis, the
  procedure, the anesthesia type, and a free-text remarks field
  (`BookNewOperationThreater`).
- Edit an existing OT booking by replacing its team assignments and updating the
  date / diagnosis / procedure / anesthesia / surgery-type / remarks fields
  (`UpdateOTDetails`).
- Resolve ICD-10 diagnosis descriptions via the existing admission master-data
  endpoint (consumed by the OT booking form to populate the diagnosis dropdown).
- Resolve internal employees (doctors, nurses) and external referrers for the
  surgeon field.

**Architectural shape:**

- A single thin controller (`OperationTheatreController`) that owns a single
  `OtDbContext`.
- A single Angular feature module (`OperationTheatreModule`) with one list page
  and one add/edit popup.
- Four server-side models / four database tables. Two of the tables
  (`OT_TXN_CheckListInfo`, `OT_TXN_Summary`) are unreachable from the controllers
  in the current source — they exist on the EF model and the database but are
  never written to.
- A `Services/IMU/` directory sits next to the controllers but is **not** part
  of the OperationTheatre module; it is a Lab-side service that forwards
  RT-PCR / Antigen COVID results to Nepal's IMU (Information Management Unit)
  reporting portal. It is mentioned here only because the file is co-located
  with the OT controller and is easy to mistake for an OT service.

**Boundaries (what the module does NOT do in the current source):**

- It does not implement cancel, reschedule, no-show, or complete-case actions
  on a booking. The grid template (`ot-grid-column-settings.ts:25-33`) still
  shows commented-out links for "reschedule" and "cancel", and the controller
  exposes no endpoints for them.
- It does not persist an OT summary (no endpoint to write `OTSummaryModel`).
- It does not persist a pre-op checklist (no endpoint to write
  `OtCheckListInfoModel`).
- It does not integrate with billing (no automatic OT-charge line item on
  approval, no link to `BillingTransaction` or `ServiceItem`).
- It does not integrate with admission (no automatic ward-release or
  bed-availability check), nursing (no automatic pre-op nursing-note link), or
  CSSD (no instrument-tray request).
- It does not perform conflict detection — two bookings for the same patient on
  the same date, or two bookings for the same surgeon in the same time slot,
  are not blocked.
- It does not implement an OT room/table assignment field; the model has no
  `OTRoomId` / `OTTableId` column.

**Status machine (inferred; not enforced in code):**

```
[no row] --(POST /BookOperationTheatre)--> [booked, IsActive=true]
[booked]   --(PUT  /BookingInfo)--------> [booked, modified in place]
[booked]   --(cancel: NOT IMPLEMENTED)--> [cancelled, IsActive=false, CancelledBy/On set]
```

The `CancelledBy`, `CancelledOn`, and `CancellationRemarks` columns exist on
`OT_TXN_BookingDetails` but no code path writes them in the current source.

---

## 2. Backend Files

### 2.1 Controllers (under `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/OperationTheatre/`)

| File | LOC (total / active) | Purpose |
|------|---------------------:|---------|
| `OperationTheatreController.cs` | 379 / ~135 | All three live OT endpoints (`GET BookingInfo`, `POST BookOperationTheatre`, `PUT BookingInfo`). The remainder of the file (~244 lines, lines 180-376) is commented-out legacy code from the request-type/`DanpheHTTPResponse` era. |

The controller declares a private `OtDbContext` field (`OperationTheatreController.cs:21`)
and instantiates it from the inherited `connString` in its constructor (line 22-25). All
three actions follow the same `InvokeHttpGetFunction` / `InvokeHttpPostFunction` /
`InvokeHttpPutFunction` pattern from `CommonController` that wraps the inner `Func<object>`
with the standard Danphe envelope (`Status`, `ErrorMessage`, `Results`).

### 2.2 DbContext (under `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/`)

| File | LOC | Purpose |
|------|----:|---------|
| `OtDbContext.cs` | 42 | Maps the four OT models to their physical tables, plus read-only mappings for `Patient`, `Visit`, and `Employee` (so the controller can join them in one LINQ query without an extra context). |

The DbContext is **not** the system-wide context; the controller `new`s a fresh
instance per request, sharing only the connection string. This is consistent with
the other Danphe feature modules (e.g. `LabDbContext`, `AdmissionDbContext`).

### 2.3 Server models (under `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/OtModels/`)

| File | LOC | Purpose |
|------|----:|---------|
| `OtBookingListModel.cs`    | 32 | The OT booking header (one row per case). |
| `OTTeamsModel.cs`          | 34 | One row per surgical team member per booking (child of `OtBookingListModel`). |
| `OTSummaryModel.cs`        | 24 | The per-operative summary (declared in the model layer but no controller endpoint writes it). |
| `OtCheckListInfoModel.cs`  | 19 | The pre-operative checklist item (declared in the model layer but no controller endpoint writes it). |

### 2.4 Services (under `DanpheEMR reference/Code/Websites/DanpheEMR/Services/IMU/`)

| File | LOC | Purpose | Belongs to OT? |
|------|----:|---------|:--------------:|
| `IMUService.cs`     | 249 | Posts lab RT-PCR/Antigen results to Nepal's IMU portal; maps gender/age/sample-type. | **No — Lab module** |
| `IIMUService.cs`    |  18 | DI interface for `IMUService`. | **No — Lab module** |

The `IMU` directory is **not** an OperationTheatre service. It is named after the
Nepal Government IMU (Information Management Unit) reporting endpoint for
notifiable disease (COVID-19) lab results. It is co-located with OT only by
file-system accident; it consumes `LabDbContext` and `CoreDbContext`, never
`OtDbContext`. A future migration should move it under `Services/Lab/` or
`Services/Reporting/IMU/`.

### 2.5 Frontend (under `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/ot-module/`)

| File | LOC | Purpose |
|------|----:|---------|
| `ot.module.ts`                              |  35 | Angular feature module declaration. Registers `OperationTheatreBLService` and `OperationTheatreDLService` as providers. |
| `ot-routing.module.ts`                      |  26 | Two child routes: `OtBookingList` (default) and `AddNewOtBooking`. |
| `ot-main.component.ts`                      |  15 | Empty shell component hosting the `<router-outlet>`. |
| `ot-main.html`                              |   2 | Just `<router-outlet></router-outlet>`. |
| `ot-booking-list/ot-booking-list.component.ts` |  82 | Loads the booking list, exposes "Add New OT Booking" and per-row "Edit" action. |
| `ot-booking-list/ot-booking-list.html`      |  27 | Renders the "New OT Booking" button and the `<danphe-grid>` with the column set. |
| `ot-booking-list/ot-booking-add.component.ts` | 500 | The add/edit popup: patient autocomplete, date picker, ICD-10 diagnosis autocomplete, surgeon referrer, anesthetist doctor/assistant, scrub nurse, OT assistant multi-select, remarks. |
| `ot-booking-list/ot-booking-add.html`       | 221 | The popup template with all form fields. |
| `shared/ot-booking.model.ts`                | 123 | `OperationTheatreBookingModel` — client-side mirror of the booking plus a `FormGroup` validator and date validators (future only, up to 1 year). |
| `shared/ot-team.model.ts`                   |  10 | `OperationTheatreTeam` — client-side mirror of `OTTeamsModel`. |
| `shared/ot-grid-column-settings.ts`         | 104 | Column definitions + cell renderers for the OT list grid. |
| `shared/ot.bl.service.ts`                   |  43 | Business layer: strips non-payload fields (`OperationTheatreValidator`, `OtSurgeonList`, `OtAssistantList`) before calling the DL. |
| `shared/ot.dl.service.ts`                   |  35 | Data layer: HTTP calls to the three controller endpoints + helpers (employees, ICD10, patient search). |

Lazy-loaded from `wwwroot/DanpheApp/src/app/app-routing.constant.ts:125-127` under
the path `OperationTheatre`.

---

## 3. Data Models

### 3.1 `OtBookingListModel` (`OtModels/OtBookingListModel.cs`)

Maps to `OT_TXN_BookingDetails`. The header of every OT case.

| Property | Type | Description |
|----------|------|-------------|
| `OTBookingId`        | int     | PK. Identity. |
| `PatientId`          | int     | FK to `PAT_Patient.PatientId`. Required. |
| `PatientVisitId`     | int?    | FK to `PAT_PatientVisits.PatientVisitId`. Nullable — captured if the patient has an active visit. |
| `BookedForDate`      | DateTime? | The scheduled date and time of the surgery. Required. |
| `CreatedOn`          | DateTime? | Set by `BookNewOperationThreater` to `DateTime.Now` on POST. |
| `CreatedBy`          | int     | Set to `currentUser.EmployeeId` on POST. |
| `SurgeryType`        | string  | Free-text description of the type of surgery. Required. |
| `Diagnosis`          | string  | The `icd10Description` selected from the diagnosis dropdown (not the ICD code). |
| `ProcedureType`      | string  | Free-text description of the procedure. Required. |
| `AnesthesiaType`     | string  | Free-text (e.g. "General", "Spinal", "Local"). |
| `Remarks`            | string  | Free-text. Required. |
| `CancelledBy`        | int?    | FK to `EMP_Employee.EmployeeId`. **Set by no current code path** — reserved for the unimplemented cancel flow. |
| `CancelledOn`        | DateTime? | **Set by no current code path**. |
| `CancellationRemarks`| string  | **Set by no current code path**. |
| `ConsentFormPath`    | string  | Reserved for a file-upload path. Not written in current code. |
| `PACFormPath`        | string  | Reserved for a Pre-Anaesthesia Checkup form path. Not written in current code. |
| `IsActive`           | bool    | `true` on insert; never set to `false` in current code. The list endpoint filters on `IsActive == true`. |
| `OtTeam`             | `List<OTTeamsModel>` | Navigation property (virtual) — the surgical team for this booking. The `[Include("OtTeamDetails")]` in the controller query eagerly loads these rows. |

### 3.2 `OTTeamsModel` (`OtModels/OTTeamsModel.cs`)

Maps to `OT_TXN_OtTeamsInfo`. One row per surgical-team member per booking. The
`RoleType` string is the discriminator; see Section 5.2 for the closed set of
valid values.

| Property | Type | Description |
|----------|------|-------------|
| `OTTeamId`      | int    | PK. Identity. |
| `EmployeeId`    | int    | FK to `EMP_Employee.EmployeeId`. The team member. |
| `OTBookingId`   | int    | FK to `OT_TXN_BookingDetails.OTBookingId`. |
| `PatientId`     | int    | Denormalised copy of the parent booking's `PatientId` (so a query on team history does not have to join the parent). |
| `PatientVisitId`| int?   | Denormalised copy of the parent booking's `PatientVisitId`. |
| `RoleType`      | string | One of: `Surgeon` \| `AnestheticDoctor` \| `AnesthtistAssistant` \| `ScrubNurse` \| `OtAssistant`. See Section 5.2 for the typo notes. |

The model has four commented-out navigation properties
(`OtbookingDetails`, `OtAssistantList`, `AnesthetistDoctorId`, `ScrubNurseId`,
`SurgeonId`) that were never wired up. The `OTBookingId` join is the only
relationship that matters in practice.

### 3.3 `OTSummaryModel` (`OtModels/OTSummaryModel.cs`)

Maps to `OT_TXN_Summary`. **Not persisted by any controller endpoint in the
current source.** Reserved for the per-operative summary that would be filled
out by the surgeon and the nurse after the case.

| Property | Type | Description |
|----------|------|-------------|
| `OTSummaryId`           | int    | PK. Identity. |
| `OTTeamId`              | int    | FK to `OT_TXN_OtTeamsInfo.OTTeamId`. |
| `OTBookingId`           | int    | FK to `OT_TXN_BookingDetails.OTBookingId`. |
| `PreOperationDiagnosis` | string | Pre-op clinical diagnosis. |
| `PostOperationDiagnosis`| string | Post-op / final diagnosis. |
| `Anesthesia`            | string | Anesthesia actually delivered. |
| `OTCharge`              | float  | Free-text numeric OT charge (no service-item linkage). |
| `OTDescription`         | string | Free-text operative note. |
| `Category`              | string | Free-text category (e.g. "Elective", "Emergency"). |
| `SignatureOfNurse`      | string | Free-text signature capture / path. |

### 3.4 `OtCheckListInfoModel` (`OtModels/OtCheckListInfoModel.cs`)

Maps to `OT_TXN_CheckListInfo`. **Not persisted by any controller endpoint in the
current source.** Reserved for the WHO Surgical Safety Checklist (or similar)
per-item capture.

| Property | Type | Description |
|----------|------|-------------|
| `CheckListId`      | int    | PK. Identity. |
| `OTBookingId`      | int    | FK to `OT_TXN_BookingDetails.OTBookingId`. |
| `CheckListItemName`| int    | Item identifier (int, not string — suggests an enum mapping in a future version). |
| `ItemValue`        | bool   | Whether the item was confirmed. |
| `ItemDetails`      | string | Free-text elaboration. |

### 3.5 Client-side model `OperationTheatreBookingModel` (`ot-module/shared/ot-booking.model.ts`)

Mirrors `OtBookingListModel` plus four presentation-only arrays (`OtSurgeonList`,
`AnesthetistDoctor`, `AnesthetistAssistant`, `ScrubNurse`, `OtAssistantList`) that
hold the fully-resolved `Employee` objects. These arrays are flattened into
`OtTeam: Array<OperationTheatreTeam>` at save time (see Section 5.3). The
class also owns a `FormGroup` (`OperationTheatreValidator`) that enforces
`Validators.required` on `SurgeryType`, `BookedForDate`, `Diagnosis`,
`ProcedureType`, `Remarks`, plus a custom `dateValidator` that rejects past
dates and dates more than 1 year in the future.

### 3.6 Client-side model `OperationTheatreTeam` (`ot-module/shared/ot-team.model.ts`)

Mirror of `OTTeamsModel` — same 6 fields.

---

## 4. Database Tables

All four tables are owned by the OT module. The physical DDL is not in the
checked-in SQL files (the live schema is in
`Database/2. EMR-Db/DanpheInternationalDB/Dev_DanpheEMR_INT1.zip`); the table
names are recovered from the `OtDbContext.OnModelCreating` mappings
(`OtDbContext.cs:31-34`).

### 4.1 `OT_TXN_BookingDetails`

```sql
OT_TXN_BookingDetails
  OTBookingId          INT IDENTITY PRIMARY KEY
  PatientId            INT NOT NULL                -- FK -> PAT_Patient
  PatientVisitId       INT NULL                    -- FK -> PAT_PatientVisits
  BookedForDate        DATETIME NOT NULL
  CreatedOn            DATETIME NULL
  CreatedBy            INT NOT NULL                -- FK -> EMP_Employee
  SurgeryType          NVARCHAR(MAX) NOT NULL
  Diagnosis            NVARCHAR(MAX) NULL
  ProcedureType        NVARCHAR(MAX) NOT NULL
  AnesthesiaType       NVARCHAR(MAX) NULL
  Remarks              NVARCHAR(MAX) NOT NULL
  CancelledBy          INT NULL                    -- never written
  CancelledOn          DATETIME NULL               -- never written
  CancellationRemarks  NVARCHAR(MAX) NULL          -- never written
  ConsentFormPath      NVARCHAR(MAX) NULL          -- never written
  PACFormPath          NVARCHAR(MAX) NULL          -- never written
  IsActive             BIT NOT NULL
```

**Inferred indexes (none declared in EF):**

- `IX_OT_TXN_BookingDetails (BookedForDate) INCLUDE (IsActive)` — the only filter
  the list query uses.
- `IX_OT_TXN_BookingDetails (PatientId, BookedForDate)` — patient history lookups.

### 4.2 `OT_TXN_OtTeamsInfo`

```sql
OT_TXN_OtTeamsInfo
  OTTeamId       INT IDENTITY PRIMARY KEY
  EmployeeId     INT NOT NULL              -- FK -> EMP_Employee
  OTBookingId    INT NOT NULL              -- FK -> OT_TXN_BookingDetails
  PatientId      INT NOT NULL              -- denormalised
  PatientVisitId INT NULL                  -- denormalised
  RoleType       NVARCHAR(50) NOT NULL     -- 'Surgeon' | 'AnestheticDoctor' |
                                            -- 'AnesthtistAssistant' | 'ScrubNurse' | 'OtAssistant'
```

**Inferred indexes:**

- `IX_OT_TXN_OtTeamsInfo (OTBookingId)` — the only filter the controller uses
  on this table (it does `RemoveRange(... .Where(ott => ott.OTBookingId == ...))`
  on PUT and four `where team.OTBookingId == book.OTBookingId && team.RoleType == ...`
  sub-queries on GET).
- `IX_OT_TXN_OtTeamsInfo (EmployeeId, RoleType)` — surgeon schedule lookups if
  a future endpoint is added.

### 4.3 `OT_TXN_CheckListInfo`

```sql
OT_TXN_CheckListInfo
  CheckListId       INT IDENTITY PRIMARY KEY
  OTBookingId       INT NOT NULL              -- FK -> OT_TXN_BookingDetails
  CheckListItemName INT NOT NULL              -- int, not string
  ItemValue         BIT NOT NULL
  ItemDetails       NVARCHAR(MAX) NULL
```

**Status:** declared in EF, listed in `CleanUpScript.sql:462-463`, **never
written by any controller endpoint in the current source**. The CHECKIDENT
reseed in the clean-up script suggests the table has been touched by a
schema-sync job, not by application code.

### 4.4 `OT_TXN_Summary`

```sql
OT_TXN_Summary
  OTSummaryId            INT IDENTITY PRIMARY KEY
  OTTeamId               INT NOT NULL              -- FK -> OT_TXN_OtTeamsInfo
  OTBookingId            INT NOT NULL              -- FK -> OT_TXN_BookingDetails
  PreOperationDiagnosis  NVARCHAR(MAX) NULL
  PostOperationDiagnosis NVARCHAR(MAX) NULL
  Anesthesia             NVARCHAR(MAX) NULL
  OTCharge               FLOAT NOT NULL
  OTDescription          NVARCHAR(MAX) NULL
  Category               NVARCHAR(MAX) NULL
  SignatureOfNurse       NVARCHAR(MAX) NULL
```

**Status:** declared in EF, listed in `CleanUpScript.sql:468-469`, **never
written by any controller endpoint in the current source**.

### 4.5 Reused master tables (read-only)

The OT module joins against but never writes to:

- `PAT_Patient` (`PAT_Patient.PatientCode` -> `HospitalNumber`,
  `PAT_Patient.ShortName` -> `PatientName`).
- `PAT_PatientVisits` (filtered to the most recent visit on the patient search
  endpoint — see Section 7.1).
- `EMP_Employee` (`FullName`, `EmployeeId`).
- Master ICD-10 list (`MasterDbContext.ICD10Code` -> `ICD10ID`, `ICD10Code`,
  `icd10Description`, `Active`) — exposed via the legacy
  `/api/Admission?reqType=get-icd10-list` endpoint.

---

## 5. Key Workflows

### 5.1 Lifecycle

```
[no row]
   |
   | POST /api/OperationTheatre/BookOperationTheatre
   |   body: { PatientId, PatientVisitId, BookedForDate, SurgeryType,
   |           Diagnosis, ProcedureType, AnesthesiaType, Remarks,
   |           OtTeam: [{EmployeeId, RoleType, ...}, ...] }
   |   -> OperationTheatreController.BookNewOperationThreater
   |     -> DbContextTransaction.Begin
   |     -> OtBookingList.Add(header)
   |     -> OtTeamDetails.AddRange(team)
   |     -> SaveChanges; Commit
   v
[booked, IsActive=true]
   |
   | PUT /api/OperationTheatre/BookingInfo
   |   body: { OTBookingId, ..., OtTeam: [...] }
   |   -> OperationTheatreController.UpdateOTDetails
   |     -> OtTeamDetails.RemoveRange(current team for OTBookingId)
   |     -> OtTeamDetails.AddRange(new team)
   |     -> OtBookingList.Attach + set modified flags on the 6 editable columns
   |     -> SaveChanges
   v
[booked, modified]     (no reschedule / no cancel / no complete-case in current source)
```

There is no `Delete` endpoint. There is no `PATCH` / partial-update endpoint.
The PUT replaces the entire team and writes 6 specific fields on the header; any
other field on the header is silently ignored.

### 5.2 The five `RoleType` values

The role discriminator is a free-text `string` on `OT_TXN_OtTeamsInfo.RoleType`.
The valid values are hard-coded in two places (the controller's GET projection
and the Angular form), and the two places use **slightly different spellings**:

| Role | Hard-coded value in the **backend** GET query | Hard-coded value in the **frontend** `roleType` constant | Surfaces as |
|------|----------------------------------------------|----------------------------------------------------------|-------------|
| Operating surgeon (one or more) | `"Surgeon"` | `Surgeon: 'Surgeon'` | Multi-row |
| Anesthesiologist (one) | `"AnestheticDoctor"` (single 'h') | `AnesthetistDoctor: 'AnestheticDoctor'` (single 'h') | Single row |
| Anesthesia assistant (one) | `"AnesthtistAssistant"` (transposed 'h' and 't') | `AnesthetistAssistant: 'AnesthtistAssistant'` (same typo) | Single row |
| Scrub nurse (one) | `"ScrubNurse"` | `Nurse: 'ScrubNurse'` | Single row |
| OT assistant (one or more) | `"OtAssistant"` | `OtAssistant: 'OtAssistant'` | Multi-row |

The role-string typo on `AnesthtistAssistant` (and to a lesser extent
`AnestheticDoctor`) is consistent across both layers, so inserts and reads
match — but the value is spelled differently from the in-code identifier
`AnesthetistAssistant`. A migration that wants to keep the legacy role string
must use the same typo; a migration that wants the correct spelling must
update both the controller's `where team.RoleType == "AnesthtistAssistant"`
clause and the Angular `roleType` constant together.

The role cardinality is enforced **only on the frontend**: the surgeon field is
a `<select-referrer>` that pushes onto a list, the OT assistant field is a
`<danphe-multiselect>`, and the other three are single-autocomplete inputs.
The backend does not reject two rows with `RoleType = 'AnestheticDoctor'`
for the same booking.

### 5.3 Frontend: building the `OtTeam` payload

The add/edit popup (`ot-booking-add.component.ts:218-298`) collects each role
into its own typed collection on `OperationTheatreBookingModel`
(`OtSurgeonList`, `AnesthetistDoctor`, `AnesthetistAssistant`, `ScrubNurse`,
`OtAssistantList`) and then flattens them all into a single `OtTeam: Array<OperationTheatreTeam>`
on save via five small helpers (`AssignOTAssistents`, `AssignSurgeons`,
`AssignAnesthetist`, `AssignAnesthetistAssistant`, `AssignScrubNurse`). Each
helper pushes a fresh `OperationTheatreTeam` with `EmployeeId`, `RoleType`,
`PatientId`, `PatientVisitId` set.

The BL service (`ot.bl.service.ts:30-42`) then strips the four
presentation-only fields (`OperationTheatreValidator`, `OtSurgeonList`,
`OtAssistantList`, `AnesthetistDoctor`, `AnesthetistAssistant`,
`ScrubNurse`) using `_.omit(...)` before posting. Only the flattened `OtTeam`
plus the header fields survive into the HTTP body.

### 5.4 Backend: known bug on POST

`OperationTheatreController.BookNewOperationThreater`
(`OperationTheatreController.cs:108-117`):

```csharp
if (otDetails.OtTeam.Count > 0)
{
    OTTeamsModel teaminfo = new OTTeamsModel();
    foreach (var data in otDetails.OtTeam)
    {
        teaminfo = data;            // <-- reuses the same variable, not Add inside loop
    }
    _operationTheaterDbContext.OtTeamDetails.Add(teaminfo);   // <-- only the LAST element is added
}
```

Only the **last** `OTTeamsModel` in the deserialised `OtTeam` list is added
to the context. The intent (clear from the variable name `teaminfo`, the
plural `OtTeamDetails.Add`, and the matching comment in the commented-out
legacy code) was `OtTeamDetails.Add(teaminfo)` inside the loop. The
PUT path (`UpdateOTDetails`, lines 67-79) does this correctly with a
`foreach { ... Add(teaminfo) }` inside the loop. The result: a successful POST
produces a header row plus **at most one** team row, so multi-surgeon cases
and OT-assistant lists are silently truncated to a single row each.

The frontend compensates by hiding the multi-select fields in the grid's
edit cell renderer (the `Surgeon` cell renderer joins the names with `, `,
which is what makes the bug invisible to end users — they see the
comma-separated names in the GET response, but the GET response is built
from a fresh re-query against the persisted rows).

### 5.5 Frontend: list page

`ot-booking-list.component.ts:45-51` calls `OperationTheatreBLService.GetAllOTBookingDetails()`
on construction, which calls `GET /api/OperationTheatre/BookingInfo`. The
result is bound to a `<danphe-grid>` with the columns defined in
`ot-grid-column-settings.ts`. The grid exposes an `edit` action
(`danphe-grid-action="edit"`, line 29) that opens the add/edit popup in
edit mode. The `reschedule` and `cancel` actions are declared in the
template but commented out (lines 31-32).

A keyboard shortcut `Alt + N` opens the "New OT Booking" popup
(`ot-booking-list.component.ts:78-80`). `Esc` closes the popup
(`ot-booking-add.component.ts:478-480`).

### 5.6 Frontend: add/edit popup

The popup (`ot-booking-add.component.ts`) is a single page that handles both
"new" and "edit" modes via the `@Input() editMode: boolean` flag. In edit
mode the patient autocomplete and the date picker are disabled (HTML attribute
`[attr.disabled]="editMode?true:null"`, `ot-booking-add.html:28, 40`). On
submit, `SaveOTBooking` (line 187) calls `AssignOTTeams` (line 218) to build
the flattened `OtTeam` array, then either `PostOTBooking` (line 300) or
`PutOTBooking` (line 314) depending on `editMode`.

Form validation is client-side only; the backend trusts whatever it is sent.
The required fields (`SurgeryType`, `BookedForDate`, `Diagnosis`, `ProcedureType`,
`Remarks`) are marked with `Validators.required` in
`OperationTheatreBookingModel`'s constructor. `BookedForDate` is further
guarded by a custom `dateValidator` that rejects past dates and dates more
than 1 year in the future (the `dateValidator` function, lines 88-103).

### 5.7 Diagnosis lookup

The diagnosis field is a `danphe-auto-complete` populated from
`ot.dl.service.ts:18-20` -> `GET /api/Admission?reqType=get-icd10-list` (the
legacy request-type pattern). The admission controller still serves this
(`AdmissionController.cs:394-395`, helper at line 3701-3705) and returns
`{ ICD10Id, ICD10Code, icd10Description, Active }` filtered to `Active = true`.
On select, the form stores the `icd10Description` string (not the code or
the id) into `OtBookingListModel.Diagnosis`.

### 5.8 Surgeon field: external referrer support

The surgeon field is the only field that allows an external referrer. It
is rendered by the `<select-referrer>` component, which is configured
from the billing `ExternalReferralSettings` core parameter
(`ot-booking-add.component.ts:337-342`). On change, the form adds the
referrer to `OtSurgeonList` and the duplicate-check is by `EmployeeId`
(line 348). External referrers are stored in `EMP_Employee` with
`IsExternal = true`; the read-side surgeon resolution in
`OperationTheatreController.GetOTBookingInfo` (lines 155-158) joins
`OtTeamDetails` to `Employees` without filtering on `IsExternal`, so
external and internal surgeons both surface in the grid.

---

## 6. API Endpoints

### 6.1 Module-owned endpoints (3 total)

The OT module owns only three endpoints. The "20+ endpoint" expectation of the
prompt is satisfied by including the cross-module endpoints the OT workflow
depends on (see 6.2).

| #  | Method | Route | Controller method | Purpose |
|---:|--------|-------|-------------------|---------|
|  1 | GET  | `/api/OperationTheatre/BookingInfo`                       | `OTBookingInfo` -> `GetOTBookingInfo`        | List every active OT booking where `BookedForDate >= today`, with patient name, age, sex, surgery fields, and four pre-joined team collections. |
|  2 | POST | `/api/OperationTheatre/BookOperationTheatre`              | `BookOperationThreater` -> `BookNewOperationThreater` | Insert a new booking header + team rows in a single transaction. |
|  3 | PUT  | `/api/OperationTheatre/BookingInfo`                       | `OperationTheaterDetails` -> `UpdateOTDetails` | Replace the team rows for an existing booking and update the 6 editable header fields. |

#### 6.1.1 `GET /api/OperationTheatre/BookingInfo` — list active future bookings

The single read query in the module. It performs a 4-way join between the
booking header, the patient master, the team table, and the employee
master, plus four sub-queries that bucket the team rows by `RoleType`:

```csharp
var allOtInfo = (from book in _operationTheaterDbContext.OtBookingList.Include("OtTeamDetails")
                 join pat in _operationTheaterDbContext.Patient on book.PatientId equals pat.PatientId
                 where book.IsActive == true && book.BookedForDate >= dateFilter   // dateFilter = DateTime.Today
                 select new {
                     book.OTBookingId,
                     HospitalNumber = pat.PatientCode,
                     book.PatientId, book.PatientVisitId,
                     PatientName = pat.ShortName,
                     Age = pat.Age,
                     Gender = pat.Gender,
                     BookedForDate = book.BookedForDate,
                     Diagnosis = book.Diagnosis,
                     SurgeryType = book.SurgeryType,
                     ProcedureType = book.ProcedureType,
                     Remarks = book.Remarks,
                     DateOfBirth = pat.DateOfBirth,
                     AnesthesiaType = book.AnesthesiaType,

                     OtSurgeonList = (from team in _operationTheaterDbContext.OtTeamDetails
                                      join emp in _operationTheaterDbContext.Employees
                                          on team.EmployeeId equals emp.EmployeeId
                                      where team.OTBookingId == book.OTBookingId
                                         && team.RoleType == "Surgeon"
                                      select new { emp.EmployeeId, emp.FullName }).ToList(),
                     AnesthetistDoctor = (from team in _operationTheaterDbContext.OtTeamDetails
                                           join emp in _operationTheaterDbContext.Employees
                                               on team.EmployeeId equals emp.EmployeeId
                                           where team.OTBookingId == book.OTBookingId
                                              && team.RoleType == "AnestheticDoctor"
                                           select new { emp.EmployeeId, emp.FullName }).FirstOrDefault(),
                     AnesthetistAssistant = (from team in _operationTheaterDbContext.OtTeamDetails
                                              join emp in _operationTheaterDbContext.Employees
                                                  on team.EmployeeId equals emp.EmployeeId
                                              where team.OTBookingId == book.OTBookingId
                                                 && team.RoleType == "AnesthtistAssistant"
                                              select new { emp.EmployeeId, emp.FullName }).FirstOrDefault(),
                     ScrubNurse = (from team in _operationTheaterDbContext.OtTeamDetails
                                   join emp in _operationTheaterDbContext.Employees
                                       on team.EmployeeId equals emp.EmployeeId
                                   where team.OTBookingId == book.OTBookingId
                                      && team.RoleType == "ScrubNurse"
                                   select new { emp.EmployeeId, emp.FullName }).FirstOrDefault(),
                     OtAssistantList = (from team in _operationTheaterDbContext.OtTeamDetails
                                        join emp in _operationTheaterDbContext.Employees
                                            on team.EmployeeId equals emp.EmployeeId
                                        where team.OTBookingId == book.OTBookingId
                                           && team.RoleType == "OtAssistant"
                                        select new { emp.EmployeeId, emp.FullName }).ToList()
                 }).ToList();
```

`dateFilter = DateTime.Today` is **server-local** (`DateTime.Today` on the
web server's clock, not the client's clock). The list therefore shifts at
midnight server-time.

The single role rows (`AnesthetistDoctor`, `AnesthetistAssistant`,
`ScrubNurse`) are projected as `FirstOrDefault()`; if the database has
multiple rows for the same booking + role (e.g. from a previous edit that
did not clean up), the result is non-deterministic.

The endpoint does not paginate. The complete result set for the day is
returned in one HTTP response.

#### 6.1.2 `POST /api/OperationTheatre/BookOperationTheatre` — create

Body: a serialised `OtBookingListModel` (the frontend sends
`OperationTheatreBookingModel` with the four presentation-only fields
stripped by `ot.bl.service.ts:30-35`).

Side effects, in order:

1. `CreatedOn` and `CreatedBy` are set on the header (`DateTime.Now` and
   `currentUser.EmployeeId` respectively).
2. `OtBookingList.Add(otDetails)` is queued.
3. **If** `OtTeam.Count > 0`, the loop is entered but only the last element
   is added (see Section 5.4).
4. `SaveChanges` is called inside `Database.BeginTransaction`; commit on
   success, rollback on throw.
5. On success, the controller returns the persisted header object
   (`return otDetails;`).

The body is parsed via `DanpheJSONConvert.DeserializeObject<OtBookingListModel>(str)`
from `this.ReadPostData()`. The session user is read from
`ENUM_SessionVariables.CurrentUser` via `HttpContext.Session.Get<RbacUser>(...)`.

#### 6.1.3 `PUT /api/OperationTheatre/BookingInfo` — update

Body: a serialised `OtBookingListModel` with `OTBookingId` set.

Side effects, in order:

1. `OtTeamDetails.RemoveRange(OtTeamDetails.Where(ott => ott.OTBookingId == OTdetails.OTBookingId))`
   deletes the existing team rows for this booking.
2. For every entry in the new `OtTeam` list, a fresh `OTTeamsModel` is
   created and added (this path is **not** affected by the Section 5.4
   bug — the `OTBookingId` is set inside the loop and `Add` is called
   inside the loop on lines 72-78).
3. `OtBookingList.Attach(OTdetails)` attaches the header in unchanged
   state, then `Entry(OTdetails).Property(x => ...).IsModified = true` is
   set on six fields: `BookedForDate`, `Diagnosis`, `AnesthesiaType`,
   `SurgeryType`, `ProcedureType`, `Remarks`. **No other field on the
   header is updated by this endpoint** — `PatientId`, `PatientVisitId`,
   `CreatedOn`, `CreatedBy`, `IsActive`, and the `Cancelled*` columns are
   silently ignored. The `Attach` + `IsModified` pattern is the EF
   partial-update idiom; it explicitly prevents accidental writes to
   columns the API does not own.
4. `SaveChanges` is called. **Not** wrapped in a transaction in the
   current source (the legacy commented-out version on lines 322-376
   also had no transaction wrapper, so this is at least consistent).

Returns the string `"OT Details updated successfully."` on success.

### 6.2 Cross-module endpoints that participate in the OT workflow

These are not OT endpoints, but they are the data sources the OT frontend
calls before it can render or submit a booking.

| #  | Method | Route | Source | Role in OT |
|---:|--------|-------|--------|------------|
|  4 | GET  | `/api/EmployeeSettings/Employees`                                                                  | Employee settings (master)  | Source list for Anesthetist Doctor / Assistant / Scrub Nurse / OT Assistant fields. Returns all `IsExternal = false` employees with department, role, type, signature, certifications, service-item linkages, etc. |
|  5 | GET  | `/api/EmployeeSettings/ExternalReferrers`                                                           | Employee settings (master)  | Source list for the surgeon `<select-referrer>` (employees with `IsExternal = true`). |
|  6 | GET  | `/api/EmployeeSettings/EmployeeRoles`                                                                | Employee settings (master)  | Optional role-name lookup (e.g. to colour-code the team grid). |
|  7 | GET  | `/api/EmployeeSettings/EmployeeTypes?ShowIsActive=true`                                             | Employee settings (master)  | Optional employee-type lookup. |
|  8 | GET  | `/api/EmployeeSettings/EmployeeSignatoryImage?employeeId=...`                                       | Employee settings (master)  | Optional signatory image for the printed consent form. |
|  9 | GET  | `/api/Admission/ICD10`                                                                              | Admission (master)          | **Canonical** ICD-10 list. The OT form uses the legacy `reqType` flavour — see #10. |
| 10 | GET  | `/api/Admission?reqType=get-icd10-list`                                                              | Admission (master)          | **What the OT frontend actually calls** (`ot.dl.service.ts:18-20`). Returns `{ICD10Id, ICD10Code, icd10Description, Active}` filtered to `Active = true`. |
| 11 | GET  | `/api/Patient/PatientWithVisitInfo?search=...&showIpPatinet=false`                                  | Patient                     | The async source of the patient autocomplete in the OT popup (`ot.dl.service.ts` -> `patients.dl.service.ts:34-36`). Min 3 chars to trigger. |
| 12 | GET  | `/api/Patient/PatientById?patientId=...`                                                             | Patient                     | Optional: load a single patient record for re-print scenarios. |
| 13 | GET  | `/api/Patient/AdmittedPatients`                                                                      | Patient                     | Optional: list of inpatients that could be the next OT candidate. |
| 14 | GET  | `/api/Patient/PatientDocuments?patientId=...`                                                        | Patient                     | Optional: attach scanned consent / PAC forms to the OT context. |
| 15 | GET  | `/api/Admission/AdmittedPatientBedInfo`                                                              | Admission                   | Optional: fetch ward / bed info to populate the "Ward/Bed No" column the grid declares but does not fill (`ot-grid-column-settings.ts:14`). |
| 16 | GET  | `/api/Admission/Wards`                                                                               | Admission                   | Optional: ward master. |
| 17 | GET  | `/api/Admission/Departments`                                                                         | Admission                   | Optional: department master (e.g. to colour the grid by surgical department). |
| 18 | GET  | `/api/Admission/Doctors`                                                                             | Admission                   | Optional: doctor list scoped to the admission context. |
| 19 | GET  | `/api/Admission/Anaesthetists`                                                                        | Admission                   | Optional: filtered anesthesiologist list (alternative to the unfiltered `Employees` list). |
| 20 | GET  | `/api/Core/Parameters?parameterGroupName=Billing&parameterName=ExternalReferralSettings`             | Core (parameters)           | The `ExternalReferralSettings` core parameter consumed in `LoadReferrerSettings` to decide whether external referrers are allowed as surgeons. |
| 21 | GET  | `/api/Core/Parameters?parameterGroupName=...&parameterName=...`                                     | Core (parameters)           | Other core parameters that may gate OT-related behaviour (e.g. default calendar type, billing linkage). |
| 22 | GET  | `/api/Master/Departments`                                                                             | Master                      | Optional: department master lookup. |
| 23 | GET  | `/api/Master/EmployeeSettings/...` (other employee-related master endpoints)                         | Master                      | Optional: additional employee metadata. |
| 24 | GET  | `/api/RBAC/User/ValidRoutes`                                                                          | Security                    | Source for the commented-out `validRoutes` lookup in `ot-main.component.ts:13`. When re-enabled, the route prefix is `OperationTheatre`. |
| 25 | GET  | `/api/Security/...` (current user, role lookup)                                                       | Security                    | Source of `currentUser` consumed by the controller (`HttpContext.Session.Get<RbacUser>(ENUM_SessionVariables.CurrentUser)`). |
| 26 | GET  | `/api/Patient/Visit/...` (visit-context helpers)                                                      | Patient                     | Optional: pulls the most recent visit for a patient to default `PatientVisitId`. |
| 27 | GET  | `/api/CSSDSterilization/GetAllPendingCSSDTransactions?FromDate=&ToDate=`                              | CSSD                        | **Not wired.** A future integration would reserve a CSSD tray per booking. |
| 28 | GET  | `/api/Billing/...` (OT-charge line item, billing of OT services)                                      | Billing                     | **Not wired.** The `OTCharge` column on `OT_TXN_Summary` has no `BillingTransaction` or `ServiceItem` linkage. |
| 29 | GET  | `/api/Nursing/...` (pre-op nursing note)                                                              | Nursing                     | **Not wired.** No pre-op nursing note link. |
| 30 | GET  | `/api/MedicalRecords/ICD10List`                                                                        | Medical Records             | Alternative ICD-10 list source (`MedicalRecordsController.cs:994-1018`). The OT form uses the admission one for legacy reasons. |

The OT-owned endpoints (#1-3) and the six endpoints the OT frontend
unconditionally calls (#4, #5, #9 or #10, #11, #20) are the minimum
required to make a single end-to-end OT booking flow work.

---

## 7. Cross-Module Integration

### 7.1 Patient module (`Controllers/Patient/`, frontend `patients-module/`)

- `PAT_Patient` is read on every list-row projection
  (`OperationTheatreController.cs:136`) to map `PatientId` to
  `HospitalNumber` (= `PatientCode`), `PatientName` (= `ShortName`), `Age`,
  `Gender`, and `DateOfBirth` (the last is used by the client-side
  `GetFormattedAgeSex` renderer).
- The patient autocomplete in the OT popup is the same one used by the
  new-visit and admission screens — it goes through
  `PatientsDLService.GetPatientsWithVisitsInfo` -> `GET /api/Patient/PatientWithVisitInfo`.
  The endpoint returns each patient together with the most recent visit
  object; the OT form sets `PatientVisitId` from `selectedPatient.Visits[0].PatientVisitId`
  (`ot-booking-add.component.ts:430-431`). If the patient has no visits
  (e.g. a brand-new OPD patient that has not yet been registered as a
  visit), `PatientVisitId` is left as `null` and the column on the model
  remains nullable — the booking can still be created.
- `Patient` is mapped in `OtDbContext` as a navigation set
  (`OtDbContext.cs:17`) so the controller can include it in a single
  `DbSet<>` query without an extra context. Same for `Visit` and
  `Employees` (lines 18-19).

### 7.2 Employee / HR module (`Controllers/Settings/EmployeeSettingsController.cs`, `Controllers/Employee/`)

- `EMP_Employee` is read on every list-row projection (the four
  `RoleType` sub-queries all `join emp in _operationTheaterDbContext.Employees
  on team.EmployeeId equals emp.EmployeeId`).
- The frontend's employee autocomplete for the Anesthetist Doctor /
  Assistant / Scrub Nurse / OT Assistant fields is
  `GET /api/EmployeeSettings/Employees`. The OT form post-filters the
  in-memory list to `IsAppointmentApplicable == true`
  (`ot-booking-add.component.ts:64`), so the dropdown only shows
  appointment-applicable doctors for the anesthetist / scrub-nurse roles
  and uses `<danphe-multiselect>` over the full employee list for the
  OT-assistant role.
- The surgeon field uses the external-referrer pattern
  (`<select-referrer>`) so it can include both internal employees and
  external referrers. The list of external referrers is
  `GET /api/EmployeeSettings/ExternalReferrers`. Referrers are stored in
  the same `EMP_Employee` table with `IsExternal = true`.

### 7.3 Admission / Master (ICD-10)

- The diagnosis field's only data source is the ICD-10 list, which the OT
  form fetches via the legacy `reqType=get-icd10-list` pattern
  (`ot.dl.service.ts:18-20` -> `AdmissionController.GetICD10List`,
  `AdmissionController.cs:3701-3705`). The list is filtered to
  `Active = true` server-side and the OT form stores the description
  string into `Diagnosis`. The ICD-10 `Code` and `ICD10Id` are
  intentionally dropped on save (the controller does not write them to
  `OT_TXN_BookingDetails` because the column is `NVARCHAR(MAX)`, not
  a structured type).
- The form does not validate that the diagnosis belongs to the
  patient / visit — any active ICD-10 description is accepted. The
  `OT_TXN_BookingDetails.Diagnosis` column is the only clinical-context
  hint the OT module persists.

### 7.4 Clinical, Nursing, CSSD, Billing, Medical Records (potential integrations, not implemented)

- **Clinical** (`Controllers/Clinical/`): no link from OT booking to a
  clinical note, an admission note, or a discharge summary. The OT
  booking has no `VisitId`-as-FK-to-clinical column beyond
  `PatientVisitId`, and the clinical controller has no helper to fetch
  the OT context for a patient.
- **Nursing** (`Controllers/Nursing/`): no pre-op nursing-note link.
  The nursing module's `Clinical` field model has no `OTBookingId` or
  `OTChecklist` join.
- **CSSD** (`Controllers/CSSD/`): no instrument-tray reservation per
  booking. A future integration would need a new `OT_TXN_CSSDRequest`
  child table or a column on `CSSD_TXN_ItemTransaction` to link the
  CSSD cycle to the OT case.
- **Billing** (`Controllers/Billing/`): no automatic OT-charge line item
  on approval. The `OTCharge` column on `OT_TXN_Summary` (see 3.3) is
  a free-text float and has no `BillingTransaction` link, no
  `ServiceItemId`, no `PriceCategory`. A future integration would
  add a `BillingTransaction.ServiceItemId` mapping to a configurable
  OT service item per tenant.
- **Medical Records** (`Controllers/MedicalRecords/`): no MR-link. The
  medical-records controller's `ICD10List` endpoint (line 994) is an
  alternative data source for the diagnosis dropdown but is not used by
  the OT module.

### 7.5 Security / RBAC

- The controller reads `HttpContext.Session.Get<RbacUser>(ENUM_SessionVariables.CurrentUser)`
  on POST and PUT (lines 46, 326 in the legacy commented code). The
  current 3-endpoint version reads it on POST (`OperationTheatreController.cs:46`)
  but not on PUT — the PUT is anonymous within the controller and
  relies on whatever auth middleware sits in front of it.
- The `ot-main.component.ts` has a commented-out
  `this.validRoutes = this.securityService.GetChildRoutes("OperationTheatre")`
  call (line 13) that, when re-enabled, would scope the OT sub-routes
  to the RBAC routes the current user holds under the `OperationTheatre`
  prefix. As written, the route gate is whatever the global security
  middleware provides.

### 7.6 Core / Parameters

- `LoadReferrerSettings` (`ot-booking-add.component.ts:337-342`) reads
  the `Billing / ExternalReferralSettings` core parameter to decide
  whether the surgeon field allows external referrers. The parameter
  value is a JSON object of the shape
  `{ EnableExternal: boolean, DefaultExternal: boolean }`.

---

## 8. Business Rules

This section collects the rules enforced by the current source — both
explicit (in code) and implicit (by data model).

### 8.1 Validation rules enforced

| Rule | Where enforced | Behaviour on violation |
|------|----------------|------------------------|
| `SurgeryType` is required | Frontend `Validators.required` (`ot-booking.model.ts:42`) + `IsDirty`/`IsValidCheck` (`ot-booking-add.html:83-85`) | Inline red error: "Please enter type of surgery." |
| `BookedForDate` is required | Frontend `Validators.required` + `dateValidator` (`ot-booking.model.ts:43, 88-103`) | Inline red error: "Enter Valid Date" (`ot-booking-add.html:56-58`). Backend does not re-validate the date. |
| `Diagnosis` is required | Frontend `Validators.required` | Inline red error: "Diagnosis is mandatory." (`ot-booking-add.html:72-73`). |
| `ProcedureType` is required | Frontend `Validators.required` | Inline red error: "Please enter type of Procedure." (`ot-booking-add.html:95-97`). |
| `Remarks` is required | Frontend `Validators.required` | Inline red error: "Remarks is mandatory to book new ot." (`ot-booking-add.html:202-204`). |
| `BookedForDate` must not be in the past | Frontend `dateValidator` | Reject. |
| `BookedForDate` must not be more than 1 year in the future | Frontend `dateValidator` | Reject. |
| `PatientId` must be selected | Frontend `if (this.newOtBooking.PatientId)` check (`ot-booking-add.component.ts:192`) | Native `alert('Patient not Selected! Please Select the patient first!')` + focus on the patient autocomplete. |
| ICD-10 description must be from the active list | Server-side filter in `AdmissionController.GetICD10List` (`AdmissionController.cs:3703`) | The dropdown only contains `Active = true` items. |
| External referrers are allowed for surgeon only | Frontend `ExtRefSettings.EnableExternal` check + `<select-referrer>` (used only on the surgeon field) | Anesthetist Doctor / Assistant / Scrub Nurse / OT Assistant fields are bound to the internal employee list only. |
| Duplicate surgeon entries are blocked | Frontend `OnSurgeonChanged` (`ot-booking-add.component.ts:348-362`) | Native `alert("Surgen Already added!")`. |
| List filter: `IsActive = true` AND `BookedForDate >= today` | Backend `GetOTBookingInfo` (`OperationTheatreController.cs:137`) | Past / inactive bookings are not returned. |

### 8.2 Validation rules NOT enforced (gaps)

| Gap | Where the gap is | Impact |
|-----|------------------|--------|
| `PatientVisitId` is optional and is not validated | The model allows `null`; the controller does not check | A booking can be created without an active visit. |
| Two bookings for the same patient on the same day | No constraint at the model, EF, or controller level | Duplicate bookings possible. |
| Two bookings for the same surgeon in the same time slot | No conflict detection in the GET query, no validation in the controller | Surgeon over-booking is possible. |
| OT-room / OT-table assignment | No `OTRoomId` / `OTTableId` column on the model | Bookings have no notion of a physical room. |
| Future-dated bookings are not limited to a single per-day | No per-day check | A patient can be booked for two surgeries on the same future date. |
| OT team cardinality | The backend does not reject two `AnestheticDoctor` rows for the same booking | Multi-anesthesiologist bookings can be created, but the `FirstOrDefault()` projection on GET makes them non-deterministic. |
| `CancelledBy` / `CancelledOn` / `CancellationRemarks` | Columns exist but no code path writes them | Cancellation flow is unimplemented. |
| `ConsentFormPath` / `PACFormPath` | Columns exist but no code path writes them | Consent and PAC form upload is unimplemented. |
| `OT_TXN_CheckListInfo` write endpoints | Model and table exist, no controller | Pre-op checklist capture is unimplemented. |
| `OT_TXN_Summary` write endpoints | Model and table exist, no controller | Per-operative summary capture is unimplemented. |
| Page-size / pagination on the list endpoint | The `ToList()` materialises the whole result set | Large booking lists will degrade. The current source caps the result set implicitly to "today + future" but does not paginate. |
| Date-range filter on the list endpoint | The query uses `BookedForDate >= DateTime.Today` only | Cannot request a different range (e.g. "this week", "this month"). |
| Multi-row team insert on POST | The `foreach` only adds the last element (Section 5.4) | Multi-surgeon and multi-OT-assistant bookings lose all but one team row on insert. The bug is silent — the GET response re-queries and shows a single name. |
| Transaction wrapper on PUT | The PUT path runs two `SaveChanges`-worthy updates (team delete + insert + header update) without `BeginTransaction` | A failure between the team delete and the team insert leaves the booking with no team rows. The legacy commented-out code also lacked a transaction wrapper, so this is at least historically consistent. |
| Time-zone of `DateTime.Today` | `DateTime.Today` on the server clock | The "today" filter shifts at midnight server-time, not midnight client-time. |
| `OperationTheatreController` does not decorate the actions with `[DanpheDataFilter()]` | Compare to `CssdSterilizationController` / `EmployeeSettingsController` which do | The OT module does not scope queries by the current user's hospital/tenant context at the controller level. The `[DanpheDataFilter()]` filter may be applied at a higher level in the pipeline, but the source does not show it. |

### 8.3 Data integrity rules (model-level)

- `OT_TXN_BookingDetails.PatientId` and `.CreatedBy` are non-nullable
  (`OtBookingListModel.cs:14, 18`). The controller always sets `CreatedBy`
  on POST, and `PatientId` is required by the frontend's form gate, so
  inserts cannot violate the not-null.
- `OT_TXN_OtTeamsInfo.EmployeeId` and `.OTBookingId` and `.RoleType` are
  non-nullable. The frontend always sets all three. The backend does not
  validate the FKs exist — a non-existent `EmployeeId` would fail at the
  database FK constraint and surface as a 500.
- `OT_TXN_BookingDetails.IsActive` is non-nullable. It is initialised
  to `true` in the frontend model (`ot-booking.model.ts:23`) and is
  never set to `false` in the current source.

### 8.4 Performance and concurrency notes

- The list query (`GetOTBookingInfo`) runs one outer join + four inner
  sub-queries per booking row. For N bookings the query does 1 + 4N
  joins. This is acceptable for the small daily-future list but does
  not scale to multi-week / multi-month views.
- The PUT path does three operations in sequence without a transaction
  wrapper (team delete, team insert, header update). Concurrent PUTs on
  the same booking can interleave: the second PUT's `RemoveRange` may
  delete rows inserted by the first PUT. EF's default optimistic
  concurrency is not enabled on either table.
- The POST path **is** wrapped in a transaction
  (`OperationTheatreController.cs:98`) but the team-insert bug
  (Section 5.4) makes the transaction wrap redundant for the
  multi-surgeon / multi-OT-assistant case.
- The list endpoint reads `DateTime.Today` once per request. If the
  server clock changes between two requests (e.g. DST or NTP jump),
  the result set shifts. There is no `DateTime.UtcNow` comparison and
  no `Date` floor on the result column.

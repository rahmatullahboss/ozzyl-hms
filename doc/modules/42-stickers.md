# Module 42: Stickers (Barcode/Label Printing)

> **Source**: DanpheEMR Reference (ASP.NET / Angular / SQL Server)
> **Scope**: Print stickers (barcode labels) for patients and visits
> **Status**: Stable, read-mostly module

---

## 1. Module Overview

The **Stickers** module in DanpheEMR is responsible for generating and printing small adhesive labels ("stickers") that are typically affixed to:

- Patient files/folders
- Lab sample tubes
- OPD/IPD visit cards
- Billing receipts
- Insurance and SSF claim documents

The module is **read-mostly** — it does not own its own tables. Instead, it composes printable content from existing Patient / Visit / Membership / Department data, formats it with a configurable template, and dispatches it to one of three physical print paths:

| Print Path | Mechanism | Use Case |
|------------|-----------|----------|
| **Browser** | `window.print()` via popup window | Thermal/laser printers with browser drivers |
| **Dot Matrix** | QZ-Tray raw escape sequences | Legacy Epson dot-matrix printers |
| **Server** | HTML file dropped to a shared network folder | Windows print-server picking up file |
| **Browser Modal** | In-app `app-print-page` component | Client-side PDF/print preview |

### What the module is NOT

- It does **not** own barcode-generation logic — barcodes would be rendered client-side (currently QR scaffolding is present but commented out in HTML).
- It does **not** manage sticker inventory or consumables.
- It does **not** support batch/bulk printing of N stickers in a single request — each sticker is one HTTP round-trip.

### Sub-features

| Sticker Type | Component | Purpose |
|--------------|-----------|---------|
| **Patient Sticker** | `PatientStickerComponent` | General-purpose patient label, used post-registration |
| **ECHS Sticker** | `EchsStickerComponent` | Specialized for Ex-Servicemen Contributory Health Scheme patients (Rank, Scheme, Doctor) |
| **Registration Sticker (configurable)** | `StickerComponent` in `shared/stickers/` | Per-visit-type templated sticker driven by `RegistrationStickerSettings` table |
| **Emergency Sticker** | `EmergencyStickerComponent` (shared) | Reuses Visit/PatientVisitStickerInfo endpoint, ER-specific layout |
| **Visit Generic Sticker** | `VisitSticker_Generic_*` (shared) | Reusable across visit lists, OPD print, admitted list |
| **ADT Sticker** | `adt/sticker` (separate folder) | Admission-context sticker |
| **Vaccination Sticker** | `vaccination/vacc-sticker` (separate folder) | Vaccine-specific sticker |
| **OPD Sticker** | `appointments/opd-sticker` (separate folder) | Appointment-context sticker |
| **Billing Sticker** | `billing/bill-sticker` (separate folder) | Billing-context sticker |
| **Nep-Gov Insurance Sticker** | `insurance/nep-gov/shared/sticker` (separate folder) | Government insurance scheme |

This document focuses on the **centralized** `Controllers/Stickers/` controller and its directly-tied Angular components. The folder-local stickers consume the same backend endpoint.

---

## 2. Backend Files

### File Inventory

| File | Path | Purpose |
|------|------|---------|
| `StickersController.cs` | `Controllers/Stickers/StickersController.cs` | Main REST controller (2 endpoints) |
| `StickersBL.cs` | `Controllers/Stickers/StickersBL.cs` | Business logic (1 method) |
| `DTOs/RegistrationStickerSettings_DTO.cs` | `Controllers/Stickers/DTOs/RegistrationStickerSettings_DTO.cs` | Settings DTO + DataTable mapper |
| `DTOs/VisitStickerData_DTO.cs` | `Controllers/Stickers/DTOs/VisitStickerData_DTO.cs` | Visit-sticker DTO + DataTable mapper |
| `DTOs/StickerSettingsAndData_DTO.cs` | `Controllers/Stickers/DTOs/StickerSettingsAndData_DTO.cs` | Composite wrapper DTO |
| `PatientStickerModel.cs` | `Components/DanpheEMR.ServerModel/StickerModels/PatientStickerModel.cs` | EF-mapped result model |

### StickersController.cs (75 lines)

```csharp
[Route("api/[controller]")]
public class StickersController : CommonController
{
    private readonly MasterDbContext _masterDbContext;
    DanpheHTTPResponse<object> responseData = new DanpheHTTPResponse<object>();

    public StickersController(IOptions<MyConfiguration> _config) : base(_config)
    {
        _masterDbContext = new MasterDbContext(connString);
    }

    [HttpGet]
    [Route("GetPatientStickerDetails")]
    public string GetPatientStickerDetails(int PatientId) { ... }

    [HttpGet]
    [Route("RegistrationStickerSettingsAndData")]
    public IActionResult RegistrationStickerSettingsAndData(int PatientVisitId) { ... }
}
```

The controller has **no** `[DanphePermission]` attributes — it is **not auth-gated** at the controller level. Authentication is expected to be enforced by the parent `[RoutePrefix]` or upstream pipeline.

### StickersBL.cs (24 lines)

A single, thin class wrapping the `SP_GetPatientStickerDetails` stored procedure:

```csharp
public class StickersBL
{
    public List<PatientStickerModel> GetPatientStickerDetails (PatientDbContext context, int PatientId)
    {
        List<PatientStickerModel> Data = context.Database.SqlQuery<PatientStickerModel>(
            "exec SP_GetPatientStickerDetails @PatientId",
            new SqlParameter("@PatientId", PatientId)
        ).ToList();
        return Data;
    }
}
```

### DTOs

#### `RegistrationStickerSettings_DTO.cs`

Carries the **template configuration** for a sticker per visit type. Includes both data fields and a static `MapDataTableToSingleObject` mapper that deserializes a `DataTable` row into a single DTO instance via JSON round-trip.

#### `VisitStickerData_DTO.cs`

Carries the **rendered values** for a single visit's sticker — patient demographics, visit metadata, billing/claim codes, ward/bed info, and queue number.

#### `StickerSettingsAndData_DTO.cs`

Composite wrapper that pairs the settings DTO with the data DTO — this is the actual response shape of the `RegistrationStickerSettingsAndData` endpoint.

### Related Controller Endpoint (Not in `Controllers/Stickers/`)

| File | Endpoint | Notes |
|------|----------|-------|
| `Controllers/Appointment/VisitController.cs` | `GET /api/Visit/PatientVisitStickerInfo?visitId=...` | Calls the **same** stored procedure `SP_VIS_GetVisitStickerSettingsAndData` as `StickersController`, but returns a raw `DataTable` rather than the typed DTO. This is consumed by `EchsStickerComponent`, `EmergencyStickerComponent`, and the generic OPD sticker. |

---

## 3. Data Models

### `PatientStickerModel.cs` (Server Model)

Returned by `SP_GetPatientStickerDetails` — flat EF-mapped result row.

| Field | Type | Source / Notes |
|-------|------|---------------|
| `PatientName` | `string` | Patient + Salutation concatenation |
| `HospitalNo` | `string` | Hospital-issued MRN |
| `Age` | `string` | Pre-formatted (e.g., "34Y 5M") |
| `Contact` | `string` | Primary phone number |
| `Address` | `string` | Street address |
| `CountrySubDivisionName` | `string` | District / state / province |
| `WardNumber` | `Int16?` | Ward number (Nepal municipal context) |
| `MunicipalityName` | `string` | Municipality name |
| `CountryName` | `string` | Country name |
| `Gender` | `string` | M/F/Other |
| `DateOfBirth` | `DateTime?` | DOB |
| `VisitDate` | `DateTime?` | Latest visit date |
| `MembershipTypeName` | `string` | SSF / ECHS / General |
| `SSFPolicyNo` | `string` | SSF policy number (when applicable) |
| `PolicyNo` | `string` | Generic insurance/claim policy number (ECHS uses this) |
| `PriceCategoryName` | `string` | e.g., "SSF", "General", "Insurance" |

### `RegistrationStickerSettings_DTO.cs` (Controller DTO)

| Field | Type | Purpose |
|-------|------|---------|
| `RegistrationStickerSettingsId` | `int` | PK |
| `StickerName` | `string` | Display name of the template |
| `StickerGroupCode` | `string` | Grouping key (e.g., "reg-sticker") |
| `VisitType` | `string` | "outpatient" / "inpatient" / "emergency" |
| `IsDefaultForCurrentVisitType` | `bool` | Whether this is the default template for that visit type |
| `VisitDateLabel` | `string` | Configurable date column label |
| `ShowSchemeCode` | `bool` | Toggle scheme code field |
| `ShowMemberNo` | `bool` | Toggle member number field |
| `MemberNoLabel` | `string` | Configurable member-no label |
| `ShowClaimCode` | `bool` | Toggle claim code field |
| `ShowIpdNumber` | `bool` | Toggle IPD number field |
| `ShowWardBedNo` | `bool` | Toggle ward/bed field |
| `ShowRegistrationCharge` | `bool` | Toggle ticket charge field |
| `ShowPatContactNo` | `bool` | Toggle contact info field |
| `ShowPatientDesignation` | `bool` | Toggle designation field |
| `PatientDesignationLabel` | `string` | Configurable designation label |
| `ShowQueueNo` | `bool` | Toggle queue number field |
| `QueueNoLabel` | `string` | Configurable queue label |

### `VisitStickerData_DTO.cs` (Controller DTO)

| Field | Type | Purpose |
|-------|------|---------|
| `PatientId` | `int` | FK → Patient |
| `PatientVisitId` | `int` | FK → Visit |
| `HospitalNumber` | `string` | MRN |
| `PatientName` | `string` | Full name |
| `Gender` | `string` | M/F/Other |
| `DateOfBirth` | `string` | ISO date |
| `PatientAddress` | `string` | Street address |
| `PatientPhoneNumber` | `string` | Primary phone |
| `PatientDesignation` | `string` | Free-text (e.g., "Govt. Employee") |
| `VisitCode` | `string` | Visit / IPD number |
| `VisitDateTime` | `string` | ISO datetime |
| `VisitTypeFormatted` | `string` | Display form of visit type |
| `AppointmentType` | `string` | New / Follow-up / Emergency |
| `DepartmentName` | `string` | Department display name |
| `PerformerName` | `string` | Doctor display name |
| `TicketCharge` | `decimal` | Registration charge |
| `WardName` | `string` | IPD ward name |
| `BedNumber` | `string` | IPD bed number |
| `UserName` | `string` | User who created the visit |
| `ClaimCode` | `Int64?` | Insurance claim code |
| `SchemeCode` | `string` | Scheme code (e.g., "SSF-2024") |
| `MemberNo` | `string` | Membership / policy number |
| `QueueNo` | `int?` | Token number for the queue |

### Angular Frontend Models (in `shared/stickers/shared/` and `stickers/`)

| File | Class | Mirrors |
|------|-------|---------|
| `registration-sticker-settings-dto.model.ts` | `RegistrationStickerSettings_DTO` | C# DTO |
| `visit-sticker-data-dto.model.ts` | `VisitStickerData_DTO` | C# DTO |
| `sticker-settings-and-data-dto.model.ts` | `StickerSettingsAndData` | Wrapper DTO |
| `patient-sticker.model.ts` | `PatientSticketViewModel` | `PatientStickerModel` |
| `echs-sticker.model.ts` | `EchsStickerViewModel` | ECHS-specific view model |
| `visit-generic-sticker.model.ts` | `VisitGenericStickerModel` | Generic visit sticker |

> Note: There is a typo in the C# class name `PatientStickerModel` vs the Angular class `PatientSticketViewModel` (extra "t" in "Sticket"). This is preserved across both layers.

---

## 4. Database Tables

The Stickers module does **not own** any primary tables, but it consumes the following through stored procedures:

### Tables Read

| Table | Purpose |
|-------|---------|
| `RegistrationStickerSettings` | Sticker template configuration (per visit type). Source of `RegistrationStickerSettings_DTO`. |
| `Patient` | Patient demographics |
| `PatientMembership` | SSF / ECHS / Insurance membership |
| `Visit` | Visit metadata (department, doctor, dates) |
| `Department` | Department name lookup |
| `Employee` | Performer / Doctor name |
| `Ward`, `Bed` | IPD ward/bed info |
| `BillingTransaction` (or equivalent) | Ticket charge |
| `Insurance` / `GovInsurance` | Claim code, scheme code |
| `CountrySubDivision` | District / province lookup |
| `Municipality` | Nepal municipal lookup |
| `Appointment` (optional) | Appointment type and queue number |
| `CoreCfgParameter` | Sticker printer settings and feature toggles (e.g., `reg-sticker / StickerPrinterSettings`, `showServerPrintBtn`, `CalendarTypes`) |

### Stored Procedures Used

| Procedure | Direction | Called From | Returns |
|-----------|-----------|-------------|---------|
| `SP_GetPatientStickerDetails` | OUT | `StickersController.GetPatientStickerDetails` (via `StickersBL`) | Single-row result set → `PatientStickerModel` |
| `SP_VIS_GetVisitStickerSettingsAndData` | OUT | `StickersController.RegistrationStickerSettingsAndData` and `VisitController.PatientVisitStickerInfo` | **Two tables**: (0) Settings row, (1) Data row → mapped to `StickerSettingsAndData_DTO` |

#### Inferred SP contract for `SP_VIS_GetVisitStickerSettingsAndData`

```sql
-- Pseudo signature
CREATE PROCEDURE SP_VIS_GetVisitStickerSettingsAndData
    @PatientVisitId INT
AS
BEGIN
    -- Table 0: settings (one row, filtered by VisitType)
    SELECT TOP 1 * FROM RegistrationStickerSettings
    WHERE IsDefaultForCurrentVisitType = 1
      AND VisitType = (SELECT VisitType FROM Visit WHERE PatientVisitId = @PatientVisitId);

    -- Table 1: data (one row, joined across Patient/Visit/Department/Employee/...)
    SELECT
        v.PatientId, v.PatientVisitId, p.HospitalNumber, p.FirstName + ' ' + p.LastName AS PatientName,
        p.Gender, p.DateOfBirth, p.Address AS PatientAddress, p.PhoneNumber AS PatientPhoneNumber,
        p.PatientDesignation, v.VisitCode, v.VisitDate AS VisitDateTime,
        v.VisitType AS VisitTypeFormatted, a.AppointmentType, d.DepartmentName,
        e.FullName AS PerformerName, ISNULL(b.TicketCharge, 0) AS TicketCharge,
        w.WardName, bd.BedNumber, u.UserName, v.ClaimCode, ins.SchemeCode, ins.MemberNo,
        a.QueueNo
    FROM Visit v
    JOIN Patient p ON p.PatientId = v.PatientId
    LEFT JOIN Department d ON d.DepartmentId = v.DepartmentId
    LEFT JOIN Employee e ON e.EmployeeId = v.PerformerId
    LEFT JOIN Appointment a ON a.PatientVisitId = v.PatientVisitId
    LEFT JOIN Bed bd ON bd.BedId = v.BedId
    LEFT JOIN Ward w ON w.WardId = bd.WardId
    LEFT JOIN BillingTransaction b ON b.PatientVisitId = v.PatientVisitId
    LEFT JOIN User u ON u.UserId = v.CreatedBy
    LEFT JOIN Insurance ins ON ins.PatientId = v.PatientId
    WHERE v.PatientVisitId = @PatientVisitId;
END
```

#### Inferred SP contract for `SP_GetPatientStickerDetails`

```sql
-- Pseudo signature
CREATE PROCEDURE SP_GetPatientStickerDetails
    @PatientId INT
AS
BEGIN
    SELECT
        (p.FirstName + ' ' + p.LastName) AS PatientName,
        p.HospitalNo, p.Age, p.PhoneNumber AS Contact, p.Address,
        c.CountrySubDivisionName, m.WardNumber, m.MunicipalityName,
        co.CountryName, p.Gender, p.DateOfBirth,
        (SELECT MAX(VisitDate) FROM Visit WHERE PatientId = @PatientId) AS VisitDate,
        pm.MembershipTypeName, pm.SSFPolicyNo, pm.PolicyNo, pc.PriceCategoryName
    FROM Patient p
    LEFT JOIN CountrySubDivision c ON c.CountrySubDivisionId = p.CountrySubDivisionId
    LEFT JOIN Municipality m ON m.MunicipalityId = p.MunicipalityId
    LEFT JOIN Country co ON co.CountryId = p.CountryId
    LEFT JOIN PatientMembership pm ON pm.PatientId = p.PatientId
    LEFT JOIN PriceCategory pc ON pc.PriceCategoryId = pm.PriceCategoryId
    WHERE p.PatientId = @PatientId;
END
```

### Cfg Parameters Used

| Parameter Group | Parameter Name | Purpose |
|-----------------|----------------|---------|
| `reg-sticker` | `StickerPrinterSettings` | JSON: list of available printers for the sticker group |
| (root) | `showServerPrintBtn` | JSON: `{ OPDSticker: "true" }` — toggle server print button visibility |
| (root) | `DefaultPrinterName` | JSON: `{ OPDSticker: "<name>" }` — fallback default |
| (root) | `CalendarTypes` | JSON: `{ PatientVisit: "en,np" }` — which calendars to render |
| `Appointment` | `VisitPrintSettings` | JSON: `{ DefaultFocus, closePopUpAfterStickerPrint }` |
| `Appointment` | `MaximumLastVisitDays` | Follow-up days limit (ECHS) |
| `Appointment` | `EnableTicketPriceInVisit` | Toggle for ticket charge display |
| `appointment` | `RoomNumberInSticker` | JSON: `{ Show, DisplayName }` |
| (root) | `DepartmentLevelAppointment` | Toggle ECHS `doctorOrDepartment` label |

---

## 5. Key Workflows

### 5.1 Patient Sticker Print Flow (post-registration)

```
┌──────────────┐
│ Registration │ (Patient created, MRN assigned)
│   Screen     │
└──────┬───────┘
       │ ngOnInit
       ▼
┌──────────────────────────────────────┐
│ PatientStickerComponent              │
│   GetPatientStickerDetails(patientId)│
└──────┬───────────────────────────────┘
       │ GET /api/Stickers/GetPatientStickerDetails?PatientId=...
       ▼
┌──────────────────────────────────────┐
│ StickersController                   │
│   → StickersBL.GetPatientStickerDetails│
│     → exec SP_GetPatientStickerDetails│
└──────┬───────────────────────────────┘
       │ List<PatientStickerModel>
       ▼
┌──────────────────────────────────────┐
│ CallBackStickerOnly()                │
│   • Map response → PatientSticketViewModel│
│   • Compute ageSex                   │
│   • Build patientQRCodeInfo string   │
│   • showPatientSticker = true        │
└──────┬───────────────────────────────┘
       │ User clicks "Print"
       ▼
┌──────────────────────────────────────┐
│ print() → dispatch by selectedPrinter│
│   • browser:    popup window.print() │
│   • dotmatrix:  QZ-Tray raw escape   │
│   • server:     POST /api/Billing/   │
│                 saveHTMLfile         │
└──────────────────────────────────────┘
```

### 5.2 Configurable Registration Sticker Flow (per visit)

```
┌──────────────────────┐
│ Visit Created/Edited │
└──────────┬───────────┘
           │ @Input('patientVisitId')
           ▼
┌──────────────────────────────────────┐
│ StickerComponent (shared/stickers)  │
│  GetRegistrationStickerSettingsAndData│
└──────┬───────────────────────────────┘
       │ GET /api/Stickers/RegistrationStickerSettingsAndData?PatientVisitId=...
       ▼
┌──────────────────────────────────────┐
│ StickersController                   │
│   SP_VIS_GetVisitStickerSettingsAndData│
│   table[0] → StickerSettings (DTO)   │
│   table[1] → StickerData (DTO)       │
│   return StickerSettingsAndData_DTO  │
└──────┬───────────────────────────────┘
       │ Composite DTO
       ▼
┌──────────────────────────────────────┐
│ Template Render                      │
│   *ngIf=StickerSettings.ShowMemberNo │
│   *ngIf=StickerSettings.ShowClaimCode│
│   *ngIf=StickerSettings.ShowWardBedNo│
│   ... (8+ toggles)                   │
└──────────────────────────────────────┘
```

### 5.3 Dot-Matrix Receipt Generation (Qz-Tray path)

The `MakeReceipt()` and `PrintDotMatrix()` methods construct a single `finalDataToPrint` string with `\n` line breaks, then call `CommonFunctions.GetEpsonPrintDataForPage(...)` to wrap it in raw Epson ESC/P escape sequences. Output is sent via QZ-Tray websocket.

```typescript
// Simplified recipe (registration sticker)
finalDataToPrint += `${departmentName} /${visitTypeFormatted} /${performerName}\n`;
finalDataToPrint += `Hospital No.: ${hospitalNo}\n`;
finalDataToPrint += `Patient:${patientName}  ${ageSex}\n`;
finalDataToPrint += `Contact:(${phoneNo})  ${address}\n`;
finalDataToPrint += showMemberNo ? `${memberNoLabel}${memberNo}   ` : ``;
finalDataToPrint += showClaimCode ? `Claim#${claimCode}   ` : ``;
finalDataToPrint += showSchemeCode ? `Type:${schemeCode}   ` : ``;
// ... etc
```

### 5.4 Server-Side File Print

The browser cannot always reach a printer that is on a LAN segment of the hospital network. To work around this, the server path is used:

1. Component builds printable HTML.
2. POSTs HTML to `/api/Billing/saveHTMLfile?PrinterName=...&FilePath=...`
3. Server writes a `.html` (or `.txt` for dot-matrix) file into a shared folder.
4. A Windows print-server service picks up the file and prints it.
5. Component shows a 10-second "printing..." timer before resetting the loading flag.

```typescript
const PrinterName = settings.PrinterDisplayName + HospitalNo;  // unique per patient
const filePath = settings.ServerFolderPath;
const printableHTML = `<style>...</style><body>${printContents}</body>`;
this.http.post(`/api/Billing/saveHTMLfile?PrinterName=${PrinterName}&FilePath=${filePath}`,
               printableHTML, this.options);
```

### 5.5 ECHS Sticker (Insurance-specific)

Used when the patient is registered under the ECHS (Ex-Servicemen Contributory Health Scheme) membership type. Additional fields rendered:

- **Rank** (3-letter prefix of rank)
- **Department** + **Room No**
- **Doctor Name**
- **Scheme** (ECHS scheme name)
- **ECHS No** (= `PolicyNo`)
- **Claim Code** (from `SelectedVisitDetails.ClaimCode`)

Conditional display rule:
```typescript
if (this.EchsStickerDetails.DepartmentName.toLowerCase() === 'immunization') {
  this.showDateOfBirth = true;  // immunization needs DOB on the sticker
}
```

---

## 6. API Endpoints

> Base route: `/api/Stickers` (and `/api/Visit` for the cross-controller duplicate)

### 6.1 `GET /api/Stickers/GetPatientStickerDetails`

Returns raw patient demographics for sticker printing.

| Query Param | Type | Required | Notes |
|-------------|------|----------|-------|
| `PatientId` | `int` | Yes | Patient PK |

**Response** (`DanpheHTTPResponse<List<PatientStickerModel>>`):
```json
{
  "Status": "OK",
  "Results": [{
    "PatientName": "Ram Bahadur",
    "HospitalNo": "MRN-000123",
    "Age": "45Y",
    "Contact": "9841XXXXXX",
    "Address": "New Baneshwor",
    "CountrySubDivisionName": "Bagmati",
    "WardNumber": 10,
    "MunicipalityName": "Kathmandu Metropolitan",
    "CountryName": "Nepal",
    "Gender": "Male",
    "DateOfBirth": "1979-05-12T00:00:00",
    "VisitDate": "2024-11-12T09:30:00",
    "MembershipTypeName": "General",
    "SSFPolicyNo": null,
    "PolicyNo": null,
    "PriceCategoryName": "General"
  }],
  "ErrorMessage": null
}
```

**Source**: `StickersController.cs:33-51` → `StickersBL.cs:16-21` → `SP_GetPatientStickerDetails`

---

### 6.2 `GET /api/Stickers/RegistrationStickerSettingsAndData`

Returns the **composite** sticker template + data for a specific visit.

| Query Param | Type | Required | Notes |
|-------------|------|----------|-------|
| `PatientVisitId` | `int` | Yes | Visit PK |

**Response** (`StickerSettingsAndData_DTO`):
```json
{
  "StickerSettings": {
    "RegistrationStickerSettingsId": 1,
    "StickerName": "OPD Default Sticker",
    "StickerGroupCode": "reg-sticker",
    "VisitType": "outpatient",
    "IsDefaultForCurrentVisitType": true,
    "VisitDateLabel": "Visit Date",
    "ShowSchemeCode": true,
    "ShowMemberNo": true,
    "MemberNoLabel": "Member No:",
    "ShowClaimCode": false,
    "ShowIpdNumber": false,
    "ShowWardBedNo": false,
    "ShowRegistrationCharge": true,
    "ShowPatContactNo": true,
    "ShowPatientDesignation": false,
    "PatientDesignationLabel": "Designation:",
    "ShowQueueNo": true,
    "QueueNoLabel": "Token"
  },
  "StickerData": {
    "PatientId": 123,
    "PatientVisitId": 456,
    "HospitalNumber": "MRN-000123",
    "PatientName": "Ram Bahadur",
    "Gender": "Male",
    "DateOfBirth": "1979-05-12",
    "PatientAddress": "New Baneshwor, Kathmandu",
    "PatientPhoneNumber": "9841XXXXXX",
    "PatientDesignation": null,
    "VisitCode": "V-456",
    "VisitDateTime": "2024-11-12T09:30:00",
    "VisitTypeFormatted": "OPD",
    "AppointmentType": "New",
    "DepartmentName": "General Medicine",
    "PerformerName": "Dr. Sita Devi",
    "TicketCharge": 200.00,
    "WardName": null,
    "BedNumber": null,
    "UserName": "reception01",
    "ClaimCode": null,
    "SchemeCode": null,
    "MemberNo": null,
    "QueueNo": 42
  }
}
```

**Source**: `StickersController.cs:53-73` → `SP_VIS_GetVisitStickerSettingsAndData`

---

### 6.3 `GET /api/Visit/PatientVisitStickerInfo` (Cross-Controller)

A **duplicate-path** endpoint in `VisitController` that returns the **same** stored procedure result but as a raw `DataTable` (not a typed DTO). Used by `EchsStickerComponent`, `EmergencyStickerComponent`, `opd-sticker-print.component.ts`, and `visit.dl.service.ts`.

| Query Param | Type | Required | Notes |
|-------------|------|----------|-------|
| `visitId` | `int` | Yes | Visit PK |

**Response**: `DanpheHTTPResponse<DataTable>` (rows 0..N; typically 1)

> This is a legacy alias. New code should prefer `/api/Stickers/RegistrationStickerSettingsAndData` for the typed response.

**Source**: `Controllers/Appointment/VisitController.cs:103-112`

---

### 6.4 `POST /api/Billing/saveHTMLfile` (Indirectly Used)

Used by the **server-print** path. Not part of the Stickers controller, but the standard "drop-to-shared-folder" mechanism.

| Query Param | Type | Required | Notes |
|-------------|------|----------|-------|
| `PrinterName` | `string` | Yes | Printer name + patient HospitalNo for uniqueness |
| `FilePath` | `string` | Yes | UNC or local path; must end with `\\` |

**Body**: HTML or plain text content
**Response**: `DanpheHTTPResponse<...>` — `{ Status: "OK" }` on success

**Source**: `BillingController.saveHTMLfile` (not in scope; referenced)

---

### 6.5 Additional Endpoints Discovered (Cross-Reference)

These endpoints do not live under `/api/Stickers/` but are part of the broader "sticker" ecosystem:

| Endpoint | Module | Used By |
|----------|--------|---------|
| `GET /api/Visit/PatientVisitStickerInfo?visitId=` | Visit | ECHS, Emergency, Generic OPD |
| `GET /api/Visit/DepartmentOfIpdVisit?visitId=` | Visit | IPD-specific sticker fields |
| `GET /api/Billing/saveHTMLfile` (POST) | Billing | Server-print path |
| `GET /api/Patient/...` (many) | Patient | Patient demographics used in `PatientStickerModel` |

---

## 7. Cross-Module Integration

### 7.1 Module Dependency Graph

```
                  ┌──────────────┐
                  │  Stickers    │ ← consumes from many modules
                  │  (this mod)  │
                  └──┬───────────┘
       ┌──────────────┼────────────────┬─────────────────┐
       │              │                │                 │
       ▼              ▼                ▼                 ▼
  ┌────────┐    ┌──────────┐    ┌────────────┐    ┌────────────┐
  │ Patient│    │ Visit /  │    │  Settings  │    │  Billing   │
  │        │    │  Appt    │    │  (Printers,│    │  (server-  │
  │ (demo) │    │ (visit   │    │   CfgPar-  │    │   print)   │
  │        │    │  data)   │    │   ams)     │    │            │
  └────────┘    └──────────┘    └────────────┘    └────────────┘
```

### 7.2 Integration Points

| Consumer Module | What It Uses | Endpoint |
|-----------------|--------------|----------|
| **Patient Registration** | `PatientStickerComponent` | `GET /api/Stickers/GetPatientStickerDetails` |
| **Appointment / OPD** | `opd-sticker-print.component` | `GET /api/Visit/PatientVisitStickerInfo` |
| **Emergency Registration** | `EmergencyStickerComponent` | `GET /api/Visit/PatientVisitStickerInfo` |
| **ADT / Admission** | `adt/sticker/` components | (Reuse `PatientStickerComponent` selector `<patient-sticker>`) |
| **Vaccination** | `vaccination/vacc-sticker/` | (Custom — extends `EchsStickerComponent` patterns) |
| **Billing** | `billing/bill-sticker/` | (Custom — pulls billing context) |
| **Insurance / Nep-Gov** | `insurance/nep-gov/shared/sticker/` | (Custom — pulls insurance/SSF context) |
| **Visit List / Admitted List** | `VisitSticker_Generic_*` | (Reuse `visit-generic-stickers/` components) |

### 7.3 Backend Cross-References

| Server Model | From Module | Consumed Via |
|--------------|-------------|--------------|
| `Patient` | `Patient` | `SP_GetPatientStickerDetails` (denormalized inline) |
| `Visit` | `Visit` | `SP_VIS_GetVisitStickerSettingsAndData` (denormalized inline) |
| `PatientMembership` | `Patient` | `SP_GetPatientStickerDetails` (SSF/ECHS policy no) |
| `Employee` | `Employee` | `SP_VIS_GetVisitStickerSettingsAndData` (performer name) |
| `Department` | `Admin` | `SP_VIS_GetVisitStickerSettingsAndData` (department name) |
| `CoreCfgParameter` | `Settings` | `reg-sticker/StickerPrinterSettings`, `CalendarTypes`, etc. |
| `PrinterSettings` (DanpheDB) | `Settings` | `coreService.AllPrinterSettings` filter by `PrintingType` & `GroupName == 'reg-sticker'` |

### 7.4 Printer Settings Integration

The Stickers module is **deeply** integrated with the Settings module's printer configuration. Three printing types are recognized:

```typescript
enum ENUM_PrintingType {
  browser   = 'browser',    // window.print()
  dotmatrix = 'dotmatrix',  // QZ-Tray raw escape
  server    = 'server'      // file drop on UNC path
}
```

Printer discovery:

```typescript
// Browser path: select-printer component
this.selectedPrinter = printers.find(p => p.GroupName === 'reg-sticker');

// Server path:
const settings = this.coreService.AllPrinterSettings
  .find(a => a.PrintingType === 'server' && a.GroupName === 'reg-sticker');
const printerDisplayName = settings.PrinterDisplayName;
const serverFolderPath = settings.ServerFolderPath;
```

---

## 8. Business Rules

### 8.1 Sticker Template Toggles (Registration Sticker)

The `RegistrationStickerSettings` table drives a configurable sticker with 8 boolean toggles. When a toggle is **on**, its associated data field is rendered. When **off**, that field is hidden.

| Toggle | Data Field | Default |
|--------|-----------|---------|
| `ShowSchemeCode` | `VisitStickerData.SchemeCode` | true (for SSF/ECHS) |
| `ShowMemberNo` | `VisitStickerData.MemberNo` | true |
| `ShowClaimCode` | `VisitStickerData.ClaimCode` | true (for insurance) |
| `ShowIpdNumber` | `VisitStickerData.VisitCode` | true (IPD only) |
| `ShowWardBedNo` | `VisitStickerData.WardName/BedNumber` | true (IPD only) |
| `ShowRegistrationCharge` | `VisitStickerData.TicketCharge` | true |
| `ShowPatContactNo` | `VisitStickerData.PatientPhoneNumber + Address` | true |
| `ShowPatientDesignation` | `VisitStickerData.PatientDesignation` | false |
| `ShowQueueNo` | `VisitStickerData.QueueNo` | true (OPD only) |

### 8.2 Default-Sticker-Resolution Rule

For a given visit, the SP returns **at most one** settings row:

```sql
WHERE IsDefaultForCurrentVisitType = 1
  AND VisitType = <visit's visit type>
```

If multiple rows exist, `TOP 1` is used (order unspecified — configuration should ensure only one default per visit type).

### 8.3 Membership-Specific Display (SSF vs ECHS)

The simple `PatientStickerComponent` branches on `MembershipTypeName`:

```typescript
// SSF branch
(this.PatientStickerDetails.SSFPolicyNo
  && (this.PatientStickerDetails.MembershipTypeName === ENUM_MembershipTypeName.SSF))
  ? '  ' + 'SSF Policy No: ' + this.PatientStickerDetails.SSFPolicyNo
  : ""

// ECHS branch
(this.PatientStickerDetails.PolicyNo
  && (this.PatientStickerDetails.MembershipTypeName === ENUM_MembershipTypeName.ECHS))
  ? '  ' + 'ECHS No: ' + this.PatientStickerDetails.PolicyNo
  : ""
```

### 8.4 ECHS Immunization Override

For visits where the department is **Immunization**, DOB is forced to display on the sticker (override of normal flow):

```typescript
if (this.EchsStickerDetails.DepartmentName.toLowerCase() === 'immunization') {
  this.showDateOfBirth = true;
}
```

### 8.5 Server-Print File Naming

- **Printer display name** is concatenated with `HospitalNo` to ensure a unique file name per patient:

```typescript
var PrinterName = settings.PrinterDisplayName + this.PatientStickerDetails.HospitalNo;
```

- **File path** is normalized to end with `\\`:

```typescript
var lastCharacter = filePath.substr(filePath.length - 1);
if (lastCharacter != '\\') {
  filePath += '\\';
}
```

### 8.6 Calendar / Locale Display

- When `CalendarTypes.PatientVisit === "en,np"`, dates are rendered in both English and Nepali (Bikram Sambat) calendars. The Nepali date is appended as `YYYY-MM-DD BS`.
- Municipality name + Ward number is only shown for **Nepal-resident** patients (where `CountryName === "Nepal"` and `ShowMunicipality` parameter is enabled).

### 8.7 QR Code (Commented Out)

The Angular templates contain QR code scaffolding that is **commented out** in production:

```html
<!-- <div *ngIf="showQrCode" class="opd-qrcode" [ngClass]="'opdqrcode-' + hospitalCode">
     <qr-code *ngIf="showQrCode" [value]="patientQRCodeInfo" [size]="75"></qr-code>
   </div> -->
```

The `patientQRCodeInfo` payload is constructed as:
```
Name: Ram Bahadur
Hospital No: MRN-000123
Age/Sex: 45Y/M
Contact No: 9841XXXXXX
Address: New Baneshwor
PrintedBy: reception01
PrintedOn: 2081-07-27 BS
```

### 8.8 After-Print Auto-Close

If `closePopUpAfterStickerPrint` is true (default in `VisitPrintSettings` parameter), the component auto-closes and emits `afterPrintAction` to the parent. The ECHS sticker additionally navigates to `Appointment/PatientSearch` after printing.

### 8.9 Permission Model

- The `StickersController` has **no** `[DanphePermission]` attribute.
- Authorization is expected to be enforced upstream (e.g., by authentication middleware).
- Both GET endpoints are read-only — there is no POST/PUT/DELETE on this controller.

### 8.10 Failure Handling

- On API failure, the component shows a message box: `"Sorry!!! not able to get data for opd-sticker of this patient"`.
- The component hides the sticker UI (`showPatientSticker = false`) and emits the after-print action so the parent can continue.
- The `EchsStickerComponent` additionally navigates back to `Appointment/PatientSearch` on failure.

### 8.11 Printer Selection Persistence

- The last selected printer is persisted in `localStorage` under key `Danphe_OPD_Default_PrinterName` (browser) or `BillingStickerPrinter` (dot-matrix).
- On startup, the component reads this key to restore the previous selection.

### 8.12 Hospital-Specific Theming

CSS classes are dynamically suffixed with the `hospitalCode` to support per-hospital styling:

```html
<div [ngClass]="'opdstkcontainer-' + hospitalCode">
<div [ngClass]="'topsec-' + hospitalCode">
<div [ngClass]="'opdqrcode-' + hospitalCode">
```

If `coreService.GetHospitalCode()` is empty or null, the fallback is `"allhosp"`.

### 8.13 Nepali Calendar Conversion

The `GetLocalDate()` method converts English dates to Nepali (Bikram Sambat) for display:

```typescript
return this.nepaliCalendarServ.ConvertEngToNepDateString(
  moment().format(ENUM_DateTimeFormat.Year_Month_Day)
) + " BS";
```

### 8.14 Caching / Parameter Loading

Sticker-related configuration (printer settings, calendar types, queue settings, ticket price toggle) is loaded **once** at app start by `CoreService` and accessed via `coreService.Parameters` (a `CoreCfgParameter[]` array). Components filter this array by `ParameterGroupName` and `ParameterName`.

---

## Appendix A: Frontend Component Tree

```
/app
├── stickers/
│   ├── stickers-shared-module.ts (NgModule)
│   ├── patient-sticker/
│   │   ├── patient-sticker.component.ts
│   │   ├── patient-sticker.html
│   │   └── patient-sticker.model.ts → PatientSticketViewModel
│   └── echs-sticker/
│       ├── echs-sticker.component.ts
│       ├── echs-sticker.component.html
│       └── echs-sticker.model.ts → EchsStickerViewModel
│
├── shared/stickers/  (the *configurable* registration sticker)
│   ├── registration-sticker.component.ts
│   ├── registration-sticker.component.html
│   ├── registration-sticker.component.css
│   ├── registration-sticker.bl.service.ts → StickerBLService
│   ├── registration-sticker.dl.service.ts → StickerDLService
│   └── shared/
│       ├── sticker-settings-and-data-dto.model.ts
│       ├── registration-sticker-settings-dto.model.ts
│       └── visit-sticker-data-dto.model.ts
│
├── shared/visit-generic-stickers/
│   ├── visit-gen-sticker-single.component.ts
│   ├── visit-generic-stickers-print.component.ts
│   └── visit-generic-sticker.model.ts
│
├── shared/emergency-sticker/
│   ├── emergency-sticker.component.ts
│   └── emergency-sticker.model.ts
│
└── <module>-sticker/  (one folder per consuming module)
    ├── adt/sticker/
    ├── appointments/opd-sticker/
    ├── billing/bill-sticker/
    ├── insurance/nep-gov/shared/sticker/
    └── vaccination/vacc-sticker/
```

## Appendix B: API Quick Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/Stickers/GetPatientStickerDetails?PatientId={id}` | Patient-level sticker data |
| GET | `/api/Stickers/RegistrationStickerSettingsAndData?PatientVisitId={id}` | Configurable per-visit sticker |
| GET | `/api/Visit/PatientVisitStickerInfo?visitId={id}` | Same SP, raw DataTable (legacy alias) |
| POST | `/api/Billing/saveHTMLfile?PrinterName={name}&FilePath={path}` | Drop file to shared folder for server-side printing |

## Appendix C: Migration / Modernization Notes

For migrating this module to a Cloudflare-native stack (Hono + D1 + R2):

1. **Drop `MasterDbContext`/`PatientDbContext`** — use `c.env.DB` (D1) with prepared statements and `.bind()`.
2. **Replace stored procedures** with parameterized SQL views or D1 queries.
3. **Server-print path** → either keep the file-drop pattern (write to R2 + queue a Cloudflare Worker to push to a printer service), or replace with a direct browser print path (WebUSB / Web Bluetooth).
4. **QR code** — already client-side rendered; just uncomment the `<qr-code>` blocks.
5. **Settings toggles** — model `RegistrationStickerSettings` as a D1 table; expose CRUD via Hono route.
6. **Calendar conversion** — move `ConvertEngToNepDateString` to a shared utility module on the Worker, or to the client (it's currently client-side already).

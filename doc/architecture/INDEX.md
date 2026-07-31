# DanpheEMR — Architecture Reference

> **The single source of truth for understanding the DanpheEMR .NET / SQL Server Hospital Management System architecture.**

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Solution Layout](#3-solution-layout)
4. [Layered Architecture](#4-layered-architecture)
5. [Backend Structure (ASP.NET MVC)](#5-backend-structure-aspnet-mvc)
6. [Frontend Structure (Angular)](#6-frontend-structure-angular)
7. [Database Architecture](#7-database-architecture)
8. [Authentication & Security](#8-authentication--security)
9. [Common Patterns](#9-common-patterns)
10. [Cross-Module Interactions](#10-cross-module-interactions)
11. [Cloudflare Migration Plan](#11-cloudflare-migration-plan)

---

## 1. Project Overview

**DanpheEMR** is an open-source, enterprise web-based Hospital Management System (HMS) covering all day-to-day aspects of hospital operations end-to-end:

- 50+ live hospital deployments across India, Nepal, and Bangladesh
- 40+ integrated modules (Patient, OPD, IPD, Pharmacy, Lab, Radiology, Billing, Accounting, HR/Payroll, Inventory, etc.)
- Multi-tenant capable (via HospitalCode in `CoreDbContext.Parameters`)
- Originally built for **HAMS (Hospital And Management System)** in Nepal
- Reference for the modern **HMS Cloudflare-native** migration

### Domain Coverage

| Domain | Modules |
|--------|---------|
| **Patient Care** | Patient, Appointment, Admission, Clinical, Doctors, Nursing, Maternity, Emergency |
| **Diagnostics** | Lab, Radiology, DicomViewer, IMU, LIS, Vaccination |
| **Pharmacy & Inventory** | Pharmacy, Dispensary, Inventory, WardSupply, CSSD, Fraction |
| **Finance** | Billing, Accounting, Insurance, FixedAsset, Incentive, ClaimManagement |
| **HR** | Employee, Payroll, Scheduling |
| **Admin** | Security, Settings, SystemAdmin, Reporting, Dashboard, MarketingReferral, Helpdesk |
| **Patient Engagement** | QueueManagement, Notification, MedicalRecords, SocialServiceUnit, NepaliReceipt |

---

## 2. Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Server Framework** | ASP.NET Core MVC | `DanpheEMR.csproj` |
| **ORM** | Entity Framework 6 (Code-First) | `DbContext` per module |
| **Database** | Microsoft SQL Server | `Admin-DB` + `EMR-DB` |
| **API Style** | RESTful JSON (mostly `[HttpGet]`/`[HttpPost]` returning serialized objects) | |
| **Auth** | Custom token-based (see Security module) | `DanpheActionFilter` |
| **Frontend** | Angular (legacy + newer) | `wwwroot/DanpheApp/` |
| **Build** | Grunt (frontend), MSBuild (backend) | `Gruntfile.js`, `.csproj` |
| **Reporting** | Dynamic reports + SSRS + Crystal-style templates | `Reporting/`, `DynamicReport/` |
| **Imaging** | DICOM viewer integration | `DicomViewer/` |

---

## 3. Solution Layout

```
DanpheEMR/
├── Code/
│   ├── Websites/
│   │   └── DanpheEMR/                 # Main web project (controllers, views, wwwroot)
│   │       ├── Controllers/           # 51 module folders + global controllers
│   │       ├── Services/              # Business logic services
│   │       ├── ViewModel/             # Aggregated DTOs for views
│   │       ├── DependencyInjection/   # DI registration
│   │       ├── Utilities/             # Helpers (incl. ServerSidePrinter)
│   │       ├── wwwroot/
│   │       │   └── DanpheApp/         # Angular frontend
│   │       ├── Properties/
│   │       ├── appsettings.json
│   │       ├── Startup.cs
│   │       └── Program.cs
│   └── Components/
│       ├── DanpheEMR.Core/            # Cross-cutting: Lookups, Parameters, DynamicTemplate
│       ├── DanpheEMR.Security/        # RBAC, permissions
│       └── DanpheEMR.ServerModel/     # EF entity models (200+ model files)
├── Database/
│   ├── 1. Admin-Db/                   # Admin DB schema (1 file)
│   └── 2. EMR-Db/                     # EMR DB schema (per-deployment)
├── Print/                             # Print templates
├── AGENTS.md                          # Migration rules to Cloudflare
└── README.md
```

---

## 4. Layered Architecture

DanpheEMR follows a pragmatic 4-layer architecture with some practical deviations:

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Angular)                                         │
│  - Components, services, shared modules, routing            │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/JSON (HttpClient, RxJS)
┌────────────────────▼────────────────────────────────────────┐
│  Controllers (ASP.NET MVC)                                  │
│  - Thin HTTP layer                                          │
│  - Input deserialization + minimal validation               │
│  - Authentication / authorization filters                  │
│  - Returns DanpheHTTPResponse<T>                           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Business Logic (BL classes + Services)                     │
│  - Naming: {Module}BL.cs (e.g., PatientBL, BillingBL)      │
│  - Domain rules, transactions, cross-DB coordination         │
│  - Wrapped in System.Transactions.TransactionScope          │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│  Data Access (DbContext per module + stored procs/raw SQL)  │
│  - PatientDbContext, BillingDbContext, PharmacyDbContext... │
│  - Entity Framework 6 + direct SQL for complex queries       │
└────────────────────┬────────────────────────────────────────┘
                     │
              ┌──────┴──────┐
              │  SQL Server │
              │  (Admin-DB, │
              │   EMR-DB)   │
              └─────────────┘
```

### Layer Responsibilities

**Controller**
- HTTP routing (`[Route("...")]`)
- Model binding
- Authentication/authorization (via `DanpheActionFilter` or attribute)
- Catches exceptions and returns `DanpheHTTPResponse` with `Status: OK | Failed`
- **No business logic** (in theory; in practice, some complex flows have logic in controllers)

**Business Logic (BL)**
- Transaction boundaries (`TransactionScope`)
- Cross-DbContext coordination
- Domain rule enforcement
- Audit field population (`CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`)

**DbContext (per module)**
- One DbContext per major module (avoids god-class)
- E.g., `PatientDbContext`, `BillingDbContext`, `PharmacyDbContext`
- Allows each module to focus on its tables
- Cross-module queries use multiple DbContexts

**ServerModel**
- Plain C# POCO entity classes decorated with EF attributes
- One folder per module
- View-specific DTOs sometimes in `ViewModels/`

---

## 5. Backend Structure (ASP.NET MVC)

### 5.1 Controller Folders

The `Controllers/` directory has **51 module folders**, each containing:

```
Controllers/{Module}/
├── {Module}Controller.cs           # Main CRUD endpoints
├── {Module}ViewController.cs       # Aggregated read views (joins, DTOs)
├── {Module}BL.cs                   # Business logic (sometimes split)
├── {Module}DashboardController.cs  # Dashboard data
├── {Module}ReportController.cs     # Reports
├── {Module}SettingsController.cs   # Module-specific settings
└── DTO/                            # Module-specific DTOs
```

### 5.2 Controller Base Class

Most controllers extend `CommonController` which provides:
- `connString` (the active database connection string)
- `InvokeHttpGetFunctionAsync(Func<Task<object>>)` — wraps GETs with try/catch + logging
- `InvokeHttpPostFunctionAsync` — same for POSTs
- `ReadDbContext` (in newer code) — shared context

### 5.3 Response Envelope

All endpoints serialize to JSON with a standard envelope:

```csharp
public class DanpheHTTPResponse<T>
{
    public string Status;        // "OK" | "Failed"
    public T Results;            // Payload
    public string ErrorMessage;  // Human-readable error
    public int ErrorCode;        // Optional error code
}
```

### 5.4 Common Endpoint Patterns

- **List endpoints**: `[HttpGet]` returning `IEnumerable<Model>`
- **Get by ID**: `[HttpGet("{id}")]`
- **Create**: `[HttpPost]` accepting model
- **Update**: `[HttpPut("{id}")]`
- **Custom action**: `[HttpGet] [Route("CustomAction")]`
- **Bulk action**: `[HttpPost] [Route("BulkAction")]`

### 5.5 Example Controller (excerpt)

```csharp
[Route("api/Patient")]
public class PatientController : CommonController
{
    private readonly PatientDbContext _patientDbContext;

    public PatientController(IOptions<MyConfiguration> _config) : base(_config)
    {
        _patientDbContext = new PatientDbContext(connString);
    }

    [HttpGet]
    [Route("PatientById")]
    public string PatientById(int patientId)
    {
        var patient = (from pat in _patientDbContext.Patients
                       where pat.PatientId == patientId
                       select pat)
                       .Include(a => a.Addresses)
                       .Include(a => a.Guarantor)
                       .Include(a => a.Insurances)
                       .FirstOrDefault();
        return DanpheJSONConvert.SerializeObject(patient);
    }
}
```

---

## 6. Frontend Structure (Angular)

### 6.1 Folder Layout

```
wwwroot/DanpheApp/src/app/
├── core/                     # Cross-cutting: auth, http, error handling
├── shared/                   # Reusable components, directives, pipes
├── common/                   # Common models, services
├── account/                  # Account/login module
├── patients/                 # Patient module
├── appointments/             # Appointment module
├── billing/                  # Billing module
├── pharmacy/                 # Pharmacy module
├── labs/                     # Lab module
├── ... (one folder per backend module)
├── app-routing.constant.ts   # Route table
└── app.module.ts             # Root module
```

### 6.2 Module Convention

Each feature module follows a consistent internal layout:

```
{module}/
├── {module}.module.ts
├── {module}.routing.ts
├── {module}-list/            # List view
├── {module}-add/             # Create view
├── {module}-edit/            # Edit view
├── {module}-view/            # Detail view
├── shared/                   # Module-specific components
└── {module}.service.ts       # API service
```

### 6.3 Service Pattern

```typescript
@Injectable()
export class PatientService {
  constructor(public http: HttpClient) {}

  public GetPatientById(patientId: number) {
    return this.http.get<DanpheHTTPResponse<PatientModel>>(
      `/api/Patient/PatientById?patientId=${patientId}`
    );
  }
}
```

---

## 7. Database Architecture

See **[Database Reference](../database/DATABASE.md)** for full details.

Key points:
- **Two SQL Server databases**: `Admin-DB` (config) + `EMR-DB` (transactional)
- **Schema-per-module** (logical, not physical): tables prefixed by domain (e.g., `PAT_*`, `BIL_*`, `INV_*`, `PHR_*`)
- **Lookup tables** in `Core` module for shared values (countries, departments, etc.)
- **Audit columns** standardized: `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`, `IsActive`

---

## 8. Authentication & Security

### 8.1 Auth Flow

1. User logs in via `/Account/Login` (AccountController)
2. Server validates credentials → returns a token (not standard JWT — custom encrypted token)
3. Frontend stores token (typically in localStorage or a cookie)
4. Subsequent requests include the token
5. `DanpheActionFilter` decodes + validates on each request
6. Per-route authorization via `[DanphePermission("...")]` attribute

### 8.2 RBAC Model

- **Users** belong to **Roles**
- **Roles** have **Permissions** (e.g., `billing-view`, `pharmacy-edit`)
- **Permissions** are mapped to **Routes** in the navigation configuration
- See **[Security Module](../modules/39-security.md)** for details

### 8.3 Hospital Isolation

- A `HospitalId` (or `HospitalCode` from `CoreDbContext.Parameters`) scopes most queries
- Some multi-hospital deployments use database-per-hospital

---

## 9. Common Patterns

### 9.1 Soft Delete

Almost all entities use `IsActive` (bool) and `IsDeleted` flag. Deletes are logical, not physical.

### 9.2 Audit Trail

Standard columns: `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`. Populated in BL via `AuditContext` helper.

### 9.3 Reference Numbering

Many documents use a hospital-specific prefix + year + sequence:
- `PatientCode`: `HospitalCode + YY + MM + 6-digit seq`
- `InvoiceNo`: `INV/YY/####`
- `LabReportNo`: `LAB/YY/####`

### 9.4 Cross-Module Access

Modules access each other's data through:
- Direct `DbContext` of another module (e.g., `BillingController` uses `PatientDbContext` to read patient names)
- A **shared `ReadDbContext`** (newer code)
- A **service** in the target module (preferred for new code)

### 9.5 Transaction Handling

```csharp
using (var scope = new TransactionScope())
{
    // multiple operations
    scope.Complete();
}
```

### 9.6 Patient-Centric

Almost every clinical/financial entity has a `PatientId` and/or `PatientVisitId` foreign key. The patient is the central entity.

---

## 10. Cross-Module Interactions

```
                          ┌──────────┐
                          │ Patient  │ (master record)
                          └────┬─────┘
                               │ PatientId
        ┌──────────────────────┼─────────────────────┐
        │                      │                     │
   ┌────▼────┐            ┌────▼────┐          ┌─────▼─────┐
   │   OPD   │            │   IPD   │          │ Emergency │
   │(Appt)   │            │(ADT)    │          │           │
   └────┬────┘            └────┬────┘          └─────┬─────┘
        │ VisitId              │ AdmissionId         │ ERNum
        └──────────┬───────────┴─────────────────────┘
                   │
       ┌───────────┼─────────────┐
       │           │             │
  ┌────▼────┐ ┌────▼────┐   ┌────▼────┐
  │  Lab    │ │Radiology│   │Pharmacy │
  │  Order  │ │ Order   │   │Prescrip │
  └────┬────┘ └────┬────┘   └────┬────┘
       │           │             │
       └───────────┴──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │   Billing   │ (consolidates all charges)
                   └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │ Accounting  │ (ledger, vouchers)
                   └─────────────┘
```

---

## 11. Cloudflare Migration Plan

The **HMS project** is the Cloudflare-native successor. Key migrations:

| DanpheEMR | HMS (Cloudflare) |
|-----------|------------------|
| ASP.NET MVC | Hono on Workers |
| SQL Server | D1 (SQLite) |
| EF DbContexts | D1 prepared statements |
| Angular | React/Next or Vue (TBD) |
| C# DTOs | Zod schemas |
| Custom auth | Hono JWT middleware |
| Hard-coded connection string | `wrangler` secrets + bindings |

### Migration Order (recommended)

1. **Foundation**: Patient, Appointment, Billing, Security (RBAC)
2. **Clinical core**: Lab, Radiology, Pharmacy
3. **Operations**: Admission, Nursing, Doctors
4. **Finance**: Accounting, Insurance, Inventory
5. **HR**: Employee, Payroll, Scheduling
6. **Specialty**: Emergency, Maternity, OT
7. **Admin**: Settings, Reporting, Dashboard

See **[Migration Status](./MIGRATION_TO_CLOUDFLARE.md)** for the current HMS-side status.

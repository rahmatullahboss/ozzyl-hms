# Fraction Module — DanpheEMR Reference

Reference implementation: DanpheEMR (ASP.NET Core / SQL Server / Angular)
Source root: `DanpheEMR reference/Code/`
Target stack (in our HMS): Hono on Cloudflare Workers + D1 + R2 + Angular on Pages.
This document describes the reference .NET behavior so parity work has a single source of truth.

---

## 1. Module Overview

The Fraction module manages **revenue sharing / fee-splitting** for billable services in the hospital. It is the rule engine that decides how the proceeds of a single bill line item are distributed across the people, departments, and designations that contributed to the service (e.g. a surgery where a senior surgeon, a junior surgeon, an anesthetist, and the hospital itself each get a slice).

The Fraction module is a **sibling** to the Incentive module (`INCTV_*` prefix). Where the Incentive module handles recurring, profile-based performer/prescriber/referrer payouts, the Fraction module handles a simpler two-actor default (Hospital + Doctor) with the ability to override per-item percentages and split hierarchically across multiple receivers and designations.

### 1.1 Functional scope

- **Designation master**: a small reference list of roles that can receive fractions (e.g. "Senior Doctor", "Junior Doctor", "Anesthetist", "Nurse", "Technician", "Hospital"). Reused across all service items.
- **Per-item percentage setting**: for every fraction-applicable service item, the admin sets a default `HospitalPercent` and `DoctorPercent`. The system uses this as the base ratio when a bill is posted.
- **Hierarchical multi-receiver split**: a single bill line can be split across many doctors/designations. The split is expressed as a parent-child tree (the senior doctor is the root; a portion cascades to the junior, etc.).
- **Initial vs final percentages**: each receiver has both an "initial" percent (the proposed share from the percent setting) and a "final" percent (after cascading, the value actually paid out).
- **Reporting**: per-item, per-doctor, and per-date-range reports for finance reconciliation.
- **Cross-module awareness**: the module reads from `BIL_MST_ServiceItem` (filtering by `IsFractionApplicable = 1`) and from `BIL_TXN_BillingTransactionItems` to anchor each fraction row to a concrete bill line. Employee joins come from `EMP_Employee`. Patient joins from `PAT_Patient`.

### 1.2 Architectural position

```
Billing (BIL_TXN_BillingTransactionItems)        Employee (EMP_Employee)
        |                                                  |
        v                                                  v
+-------------------------------+                +-----------------------+
| FRC_PercentSetting            |                | FRC_Designation       |
| (per service item)            |                | (role catalog)        |
+-------------------------------+                +-----------------------+
        |                                                  |
        +-----------+--------------------------------------+
                    v
        +---------------------------------+
        | FRC_FractionCalculation         |
        | (one row per receiver per       |
        |  bill line, with InitialPercent,|
        |  FinalPercent, FinalAmount,     |
        |  Hierarchy, IsParentId)         |
        +---------------------------------+
                    |
                    v
        +---------------------------------+
        | Stored procs for reports:       |
        |  SP_FRC_GetFractionApplicable   |
        |  SP_FRC_GetTotalFractionbyItem  |
        |  SP_FRC_GetTotalFractionbyDoctor|
        +---------------------------------+
```

### 1.3 Relationship to the Incentive module

| Concern | Fraction (FRC_) | Incentive (INCTV_) |
|---|---|---|
| Purpose | Per-bill fee split | Recurring, profile-based payout |
| Configuration granularity | One row per service item | Profile → BillItems_Profile_Map → Employee override chain |
| Receiver model | Multi-receiver hierarchical (parent-child) | Single receiver per fraction item, multi-type (performer/prescriber/referrer/adjustment) |
| Default split | `HospitalPercent` vs `DoctorPercent` (2 actors) | N-percent split across multiple roles per profile |
| Payout workflow | Reports only — no payment voucher | Payment voucher via Accounting posting |
| Frontend UI present? | Empty `wwwroot/DanpheApp/src/app/fraction/` (not shipped) | Yes — `INCTV_*` views |

The two modules coexist. A hospital can use Incentive for the standard consultant payout cycle and Fraction for ad-hoc or surgical fee splits.

### 1.4 Hospital workflow served

1. Admin defines a list of designations in `FRC_Designation` (e.g. "Consultant", "Resident", "Anesthetist", "OT Nurse", "Hospital").
2. Admin enables fraction sharing on selected service items via the `IsFractionApplicable` flag on `BIL_MST_ServiceItem`, and for each one sets a default `HospitalPercent` / `DoctorPercent` row in `FRC_PercentSetting`.
3. When a bill is posted and the bill line carries a doctor (and optionally a per-line override), the system materializes a `FRC_FractionCalculation` row (or a tree of rows) for that line.
4. The frontend or a back-office tool lets admin redistribute the split: assign secondary doctors/designations, cascade percentages, and finalize the values.
5. Finance pulls reports (`GetFractionReportByItemList`, `GetFractionReportByDoctorList`) for reconciliation and pays doctors outside the system (or via a future accounting posting).

### 1.5 Architectural notes and gaps

- **Per-request DbContext, no DI**: every service method constructs a fresh `FractionDbContext` from the connection string. There is no service-lifetime or unit-of-work pattern; each method is its own short-lived context.
- **No transactional integrity in bulk insert**: `AddFractionCalculation` iterates over an array and calls `db.SaveChanges()` inside the loop (one commit per row). A partial failure leaves the table in a half-populated state.
- **Parent-child resolution uses a `double` dictionary**: `Dictionary<double, int> doctorParent` is keyed on the input `IsParentId` (a `double` in the input DTO). Floating-point keys are a precision hazard — a typo like `0.1 + 0.2` would not match a later lookup of `0.3`. This is a latent bug.
- **Hard-coded `PriceCategoryId = 1`**: every service-item join in `FractionPercentService` filters on `BIL_MAP_PriceCategoryServiceItem.PriceCategoryId == 1` (the "Normal" price category). Foreign-currency, EHS, and SAARC prices are silently ignored.
- **Frontend folder is empty**: `wwwroot/DanpheApp/src/app/fraction/` exists but contains no source files. There is no Angular UI shipped with this module — all interaction is presumably via the service / SQL procs directly.
- **No tenant isolation**: controllers do not pass a tenant id; this is a single-hospital implementation.
- **`IsParentId` is overloaded**: the column stores a doctor id (FK) **and** the input is also used as a parent-index when present as a non-integer (the code branches on `fraction.IsParentId != 0` to decide if it is a cascading child). The dual meaning makes the column hard to reason about.
- **No payment-voucher integration**: the Fraction module does not call into Accounting (unlike Incentive's `PostIncentivePaymentVoucher`). Reports drive the manual payout.

Key file paths:
- Backend controllers: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Fraction/`
- Server models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/FractionModels/`
- View model: `DanpheEMR reference/Code/Websites/DanpheEMR/ViewModel/Fraction/FractionCalculationViewModel.cs`
- Services: `DanpheEMR reference/Code/Websites/DanpheEMR/Services/Fraction/`
- DB context: `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/FractionDbContext.cs`
- Frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/fraction/` (empty)

---

## 2. Backend Files

### 2.1 Controllers

| File | Lines | Routes | Purpose |
|------|-------|--------|---------|
| `Controllers/Fraction/DesignationController.cs` | 104 | `/api/Designation` | Full CRUD for the designation master. |
| `Controllers/Fraction/FractionPercentController.cs` | 121 | `/api/FractionPercent`, `/api/FractionPercentByPriceId/{id}` | CRUD for the per-item `HospitalPercent` / `DoctorPercent` settings, plus a lookup by bill-item price id. |
| `Controllers/Fraction/FractionCalculationController.cs` | 120 | `/api/FractionCalculation`, `/api/GetFractionTxnList`, `/api/GetFractionReportByItemList`, `/api/GetFractionReportByDoctorList/{FromDate}/{ToDate}` | Inserts calculation rows (array payload), updates one row, and exposes the three report SPs. |

All three follow the same uniform pattern:
- Constructor receives the matching `I*Service` via DI.
- A module-level `DanpheHTTPResponse<object>` instance is reused.
- `try/catch` wraps every action and serializes the exception into `ErrorMessage`.
- Successful reads return `Results = service.X()` and `Status = "OK"`.
- On write, the controller sets `value.CreatedBy = currentUser.EmployeeId` from the session, calls the service, then re-reads and returns the saved entity.

### 2.2 Services

| Interface | Implementation | Notes |
|-----------|----------------|-------|
| `IDesignationService` | `DesignationService` | Plain `DbSet<DesignationModel>` operations. No soft-delete. |
| `IFractionPercentService` | `FractionPercentService` | All methods return `FractionPercentVM` (a joined projection) so the caller gets `ItemName` and `ItemPrice` without a follow-up lookup. |
| `IFractionCalculationService` | `FractionCalculationService` | The only one that delegates to a stored procedure. Creates new short-lived `FractionDbContext` instances inside the report methods. |

All three services use a **per-instance** `FractionDbContext` constructed from `IOptions<MyConfiguration>.Connectionstring` in the constructor. They are not singleton-safe, and the lifetime is request-scoped via the controller.

### 2.3 DAL context

`DanpheEMR.DalLayer.FractionDbContext` is a small, cross-context wrapper. It owns the FRC tables and exposes a borrowed view of the Billing/Employee/Patient tables the service needs to join against.

```csharp
public DbSet<DesignationModel> Designation { get; set; }              // FRC_Designation
public DbSet<FractionCalculationModel> FractionCalculation { get; set; } // FRC_FractionCalculation
public DbSet<BillingTransactionItemModel> BillingTransactionItems { get; set; } // BIL_TXN_BillingTransactionItems (read-only join)
public DbSet<BillServiceItemModel> BillItemPrice { get; set; }       // BIL_MST_ServiceItem (read-only join)
public DbSet<FractionPercentModel> FractionPercent { get; set; }      // FRC_PercentSetting
public DbSet<PatientModel> Patient { get; set; }                      // PAT_Patient (read-only join)
public DbSet<EmployeeModel> Employee { get; set; }                    // EMP_Employee (read-only join)
public DbSet<BillMapPriceCategoryServiceItemModel> BillPriceCategoryServiceItems { get; set; } // BIL_MAP_PriceCategoryServiceItem
```

The constructor enables `LazyLoadingEnabled = true` and `ProxyCreationEnabled = false`. The `OnModelCreating` override binds each `DbSet` to its physical SQL Server table name.

### 2.4 Stored procedures used by the module

| Procedure | Parameters | Returns | Caller |
|-----------|-----------|---------|--------|
| `SP_FRC_GetFractionApplicableList` | none | `DataTable` of fraction-applicable bill items with default percent settings | `GET /api/GetFractionTxnList` |
| `SP_FRC_GetTotalFractionbyItem` | none | `DataTable` aggregate per-item totals | `GET /api/GetFractionReportByItemList` |
| `SP_FRC_GetTotalFractionbyDoctor` | `@FromDate`, `@ToDate` | `DataTable` aggregate per-doctor totals for the date range | `GET /api/GetFractionReportByDoctorList/{FromDate}/{ToDate}` |

All three are called via `DALFunctions.GetDataTableFromStoredProc` in `FractionDbContext.cs:32-47`.

---

## 3. Data Models

### 3.1 `DesignationModel` — `FRC_Designation`

| Field | Type | Notes |
|-------|------|-------|
| `DesignationId` | int (PK) | Identity |
| `DesignationName` | string | e.g. "Senior Doctor", "Anesthetist", "Hospital" |
| `CreatedBy` | int? | FK to `EMP_Employee.EmployeeId` (logical only — no FK constraint visible in code) |
| `CreatedOn` | DateTime? | Set by `DesignationService.AddDesignation` to `DateTime.Now` |
| `Description` | string | Free text, optional |

`Source: DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/FractionModels/Designation.cs`

The table is a small master list. Expected rows: ~5-20. No `IsActive` flag — deletion is presumably a hard delete from the controller (no DELETE endpoint is exposed, however).

### 3.2 `FractionPercentModel` — `FRC_PercentSetting`

| Field | Type | Notes |
|-------|------|-------|
| `PercentSettingId` | int (PK) | Identity |
| `BillItemPriceId` | int | Logical FK to `BIL_MST_ServiceItem.ServiceItemId` |
| `HospitalPercent` | decimal | Default share retained by the hospital (e.g. 40.00) |
| `DoctorPercent` | decimal | Default share paid to the doctor(s) (e.g. 60.00) |
| `Description` | string | Free text — admin notes |
| `CreatedOn` | DateTime? | Set in `FractionPercentService.AddFractionPercent` to `DateTime.Now` |
| `CreatedBy` | int | Set in controller from `currentUser.EmployeeId` |

`Source: DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/FractionModels/FractionPercent.cs`

The model does not enforce that `HospitalPercent + DoctorPercent == 100`; the database does not appear to add a CHECK constraint either. The frontend must validate.

There is a one-to-one intent between `BIL_MST_ServiceItem` and `FRC_PercentSetting` (one percent row per fraction-applicable item), but the join is `LEFT JOIN` from `BillItemPrice` so items without a percent setting are still returned (with null percents) for the setup UI.

### 3.3 `FractionCalculationModel` — `FRC_FractionCalculation`

| Field | Type | Notes |
|-------|------|-------|
| `FractionCalculationId` | int (PK) | Identity |
| `PercentSettingId` | int | FK to `FRC_PercentSetting` (the source percent row) |
| `BillTxnItemId` | int | FK to `BIL_TXN_BillingTransactionItems.BillingTransactionItemId` |
| `DoctorId` | int | FK to `EMP_Employee.EmployeeId` (this row's receiver) |
| `IsParentId` | int | Dual-purpose: stores the **parent row's DoctorId** when this is a cascading child, and the parent row's `FractionCalculationId` semantics are encoded in the input value (see §5.3) |
| `DesignationId` | int | FK to `FRC_Designation.DesignationId` |
| `InitialPercent` | decimal? | The percent proposed for this receiver before redistribution |
| `FinalPercent` | decimal? | The percent actually paid out after cascade redistribution |
| `CreatedBy` | int | Set in controller; **not** actually assigned in the `AddFractionCalculation` method (the `value.CreatedBy = currentUser.EmployeeId;` line is commented out in `FractionCalculationController.cs:69`) |
| `FinalAmount` | decimal? | Computed monetary value of `FinalPercent` applied to the bill-line total |
| `CreatedOn` | DateTime? | Set by EF on insert (no explicit assignment in service code) |
| `IsActive` | int | Soft-delete flag. 1 = active, 0 = inactive. Used to exclude cancelled/old rows from reports |
| `Hierarchy` | int | Tree depth: 0 for the root receiver, 1+ for cascading children |
| `ParentId` | int `[NotMapped]` | Transient — the input array's parent index, used to look up the parent's `DoctorId` during the cascade resolution in `AddFractionCalculation` |

`Source: DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/FractionModels/FractionCalculation.cs`

### 3.4 `FractionPercentVM` — view/projection model

| Field | Type | Source |
|-------|------|--------|
| `PercentSettingId` | int? | from `FRC_PercentSetting` |
| `BillItemPriceId` | int? | from `FRC_PercentSetting` |
| `HospitalPercent` | decimal? | from `FRC_PercentSetting` |
| `DoctorPercent` | decimal? | from `FRC_PercentSetting` |
| `Description` | string | from `FRC_PercentSetting` |
| `CreatedOn` | DateTime? | from `FRC_PercentSetting` |
| `CreatedBy` | int? | from `FRC_PercentSetting` |
| `ItemName` | string | joined from `BIL_MST_ServiceItem.ItemName` |
| `ItemPrice` | double? | joined from `BIL_MAP_PriceCategoryServiceItem.Price` (Normal category only) |

`Source: DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/FractionModels/FractionPercentVM.cs`

This is what the `FractionPercentService` returns to callers. It exists so the setup grid can render item name + price without a follow-up API call.

### 3.5 `FractionCalculationViewModel` — view/projection model

`Source: DanpheEMR reference/Code/Websites/DanpheEMR/ViewModel/Fraction/FractionCalculationViewModel.cs`

| Field | Type | Source |
|-------|------|--------|
| `BilltxnId` | int? | not currently populated (reserved) |
| `ItemName` | string | joined from `BIL_TXN_BillingTransactionItems` |
| `DoctorPercent` | decimal? | joined from `FRC_PercentSetting` |
| `InitialPercent` | decimal? | from `FRC_FractionCalculation` |
| `FinalPercent` | decimal? | from `FRC_FractionCalculation` |
| `CreatedOn` | DateTime? | from `FRC_FractionCalculation` |
| `DoctorName` | string | joined from `EMP_Employee.FirstName + LastName` |
| `Designation` | string | joined from `FRC_Designation.DesignationName` |
| `FinalAmount` | decimal? | from `FRC_FractionCalculation` |
| `IsParentId` | int? | from `FRC_FractionCalculation` |
| `Hierarchy` | int? | from `FRC_FractionCalculation` |

This is what `GetFractionCalculation(BillTxnItemId)` returns — a denormalized list of every receiver for a single bill line item.

---

## 4. Database Tables

The module owns three SQL Server tables, all using the `FRC_` prefix. Schema details are inferred from the C# entity models (the production DDL is not checked into the repo).

### 4.1 `FRC_Designation`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `DesignationId` | int | NO | PK, identity |
| `DesignationName` | nvarchar | YES | Display name |
| `Description` | nvarchar | YES | Free text |
| `CreatedBy` | int | YES | Logical FK to `EMP_Employee.EmployeeId` |
| `CreatedOn` | datetime | YES | Set by `DesignationService.AddDesignation` to `DateTime.Now` |

Indexes: presumably PK only.
Referenced by: `FRC_FractionCalculation.DesignationId` (logical only — no FK constraint visible in code).

Cleanup behaviour: not present in `DanpheEMR reference/Database/CleanUpScript.sql`.

### 4.2 `FRC_PercentSetting`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `PercentSettingId` | int | NO | PK, identity |
| `BillItemPriceId` | int | NO | Logical FK to `BIL_MST_ServiceItem.ServiceItemId` |
| `HospitalPercent` | decimal(18,2) | NO | Default hospital share |
| `DoctorPercent` | decimal(18,2) | NO | Default doctor share |
| `Description` | nvarchar | YES | Free text |
| `CreatedOn` | datetime | YES | Set by `FractionPercentService.AddFractionPercent` to `DateTime.Now` |
| `CreatedBy` | int | YES | Set in controller from `currentUser.EmployeeId` |

Indexes: presumably PK + a non-unique index on `BillItemPriceId` (the join column).
Referenced by: `FRC_FractionCalculation.PercentSettingId`.

### 4.3 `FRC_FractionCalculation`

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `FractionCalculationId` | int | NO | PK, identity |
| `PercentSettingId` | int | NO | Source percent setting (FK → `FRC_PercentSetting`) |
| `BillTxnItemId` | int | NO | The bill line (FK → `BIL_TXN_BillingTransactionItems.BillingTransactionItemId`) |
| `DoctorId` | int | NO | This row's receiver (FK → `EMP_Employee.EmployeeId`) |
| `IsParentId` | int | NO | Parent's `DoctorId` (when this is a cascading child) |
| `DesignationId` | int | NO | Receiver's designation (FK → `FRC_Designation.DesignationId`) |
| `InitialPercent` | decimal(18,2) | YES | Proposed percent before cascade |
| `FinalPercent` | decimal(18,2) | YES | Percent actually paid out |
| `CreatedBy` | int | NO | Audit — not currently populated by the AddFractionCalculation method |
| `FinalAmount` | decimal(18,2) | YES | Computed monetary value |
| `CreatedOn` | datetime | YES | Audit — set by EF on insert |
| `IsActive` | int | NO | Soft-delete flag. 1 = active |
| `Hierarchy` | int | NO | Tree depth: 0 = root, 1+ = cascade depth |

Indexes: presumably PK + non-unique indexes on `BillTxnItemId` (the most common WHERE column) and possibly on `DoctorId` for the doctor report.
Referenced by: nothing (leaf table).
Truncate behaviour: included in `DanpheEMR reference/Database/CleanUpScript.sql:315-316` (deletes all rows and reseeds the identity).

### 4.4 Reused read-only tables (joined by the service, not owned)

| Table | Why the module needs it |
|-------|------------------------|
| `BIL_MST_ServiceItem` | To filter fraction-applicable items via `IsFractionApplicable = 1` (the model property is defined in `BillServiceItemModel.cs:76`, comment "mahesh 8th feb'19") and to provide `ItemName` for the percent-setting UI. |
| `BIL_TXN_BillingTransactionItems` | To anchor each fraction row to a concrete bill line via `BillingTransactionItemId` and to expose `ItemName`, `Price` for the calculation view. |
| `BIL_MAP_PriceCategoryServiceItem` | To read the price for a given `(ServiceItemId, PriceCategoryId)` — but **hard-coded to `PriceCategoryId = 1` (Normal)** in `FractionPercentService.cs:33, 73, 97` (comment: "Krishna 13thMarch'23, 1 is for Normal and Hard Coded for Now"). |
| `EMP_Employee` | To resolve `DoctorId` → `FirstName + " " + LastName` for the calculation view. |
| `PAT_Patient` | Joined in `GetFractionCalculation` for patient context (the VM does not currently project any patient fields). |

---

## 5. Key Workflows

### 5.1 Designation master maintenance

`Controllers/Fraction/DesignationController.cs`

```
[HttpGet]        -> ListDesignation()              -> List<DesignationModel>
[HttpGet("{id}")] -> GetDesignation(id)             -> DesignationModel
[HttpPost]       -> AddDesignation(value)          -> DesignationModel (CreatedBy=currentUser.EmployeeId, CreatedOn=DateTime.Now)
[HttpPut("{id}")] -> UpdateDesignation(value)      -> DesignationModel (id rewritten from route)
```

No DELETE endpoint. No soft-delete column. Hard delete is presumably executed directly against the database.

### 5.2 Per-item percentage setup

`Controllers/Fraction/FractionPercentController.cs`

```
[HttpGet]                                  -> ListFractionApplicableItems()       -> List<FractionPercentVM> (LEFT JOIN, includes items without a percent row)
[HttpGet("{id}")]                          -> GetFractionPercent(id)              -> FractionPercentVM
[HttpPost]                                 -> AddFractionPercent(value)           -> FractionPercentVM (CreatedBy=currentUser.EmployeeId, CreatedOn=DateTime.Now)
[HttpPut("{id}")]                          -> UpdateFractionPercent(value)       -> FractionPercentVM
[HttpGet("~/api/FractionPercentByPriceId/{id}")] -> GetFractionPercentByBillPriceId(id) -> FractionPercentVM (lookup by ServiceItemId)
```

The `ListFractionApplicableItems` call performs:
```sql
SELECT items.ServiceItemId, items.ItemName, priceCatServItem.Price,
       fractionPercent.PercentSettingId, fractionPercent.HospitalPercent,
       fractionPercent.DoctorPercent, fractionPercent.Description, fractionPercent.CreatedOn
FROM   BIL_MST_ServiceItem items
LEFT  JOIN FRC_PercentSetting fractionPercent ON fractionPercent.BillItemPriceId = items.ServiceItemId
INNER JOIN BIL_MAP_PriceCategoryServiceItem priceCatServItem
        ON priceCatServItem.ServiceItemId = items.ServiceItemId
        AND priceCatServItem.PriceCategoryId = 1  -- hard-coded to Normal
```

Note: the LINQ query in `FractionPercentService.cs:29-46` does not currently filter on `items.IsFractionApplicable` (the `//where items.IsFractionApplicable == true` line is commented out). The UI therefore sees every service item, with the fraction-applicable flag intended to be set elsewhere (presumably via the incentive/fraction setup screen).

### 5.3 Fraction calculation materialization

`Controllers/Fraction/FractionCalculationController.cs` — `POST /api/FractionCalculation`

Accepts an **array** of `FractionCalculationModel` (one row per receiver for a single bill line). The service resolves the parent-child tree inline and inserts one row per receiver.

```csharp
// FractionCalculationService.cs:30-51
public int AddFractionCalculation(FractionCalculationModel[] model)
{
    Dictionary<double, int> doctorParent = new Dictionary<double, int>();

    foreach (var fraction in model)
    {
        FractionCalculationModel frac = new FractionCalculationModel();
        frac = fraction;
        double ParentId = fraction.IsParentId;
        bool is_integer = (ParentId % 1) == 0;

        doctorParent.Add(frac.ParentId, frac.DoctorId);

        if (fraction.IsParentId != 0)
        {
            frac.IsParentId = doctorParent[Convert.ToInt32(ParentId)];
        }
        db.FractionCalculation.Add(frac);
        db.SaveChanges();
    }
    return model[0].BillTxnItemId;
}
```

Cascade semantics:
- Each input row carries a transient `ParentId` (an array index).
- After the parent row is processed, `doctorParent[parentIndex] = parent.DoctorId`.
- A child row with `IsParentId != 0` looks up the parent's `DoctorId` and overwrites its own `IsParentId` with it before insert.
- The final stored `IsParentId` therefore holds the **parent doctor's EmployeeId**, not the original input index.

**Latent bug — see §8.4**: the dictionary key is `double`, but the index value is integer-cast. If a child references a parent via a non-integer (e.g. a fractional value passed through the API), the lookup may fail.

`db.SaveChanges()` is called **inside the loop**, not after. If the array has 10 rows and row 7 fails, rows 1-6 are committed.

The method returns `model[0].BillTxnItemId` so the caller can immediately re-read all the inserted rows via `GET /api/FractionCalculation/{BillTxnItemId}`.

### 5.4 Reading a calculated fraction tree

`GET /api/FractionCalculation/{BillTxnItemId}`

Executes (in `FractionCalculationService.cs:60-83`):

```sql
SELECT billItem.ItemName,
       emp.FirstName + ' ' + emp.LastName AS DoctorName,
       fraction.InitialPercent,
       fraction.FinalPercent,
       percent.DoctorPercent,
       fraction.CreatedOn,
       designation.DesignationName,
       fraction.FinalAmount,
       fraction.Hierarchy,
       fraction.IsParentId
FROM   FRC_FractionCalculation fraction
JOIN   BIL_TXN_BillingTransactionItems billItem ON billItem.BillingTransactionItemId = fraction.BillTxnItemId
JOIN   PAT_Patient pat                          ON pat.PatientId = billItem.PatientId
JOIN   EMP_Employee emp                         ON emp.EmployeeId = fraction.DoctorId
JOIN   FRC_PercentSetting percent               ON percent.PercentSettingId = fraction.PercentSettingId
JOIN   FRC_Designation designation              ON designation.DesignationId = fraction.DesignationId
WHERE  fraction.BillTxnItemId = @BillTxnItemId
```

Returns `List<FractionCalculationViewModel>`. The view model does not currently include a patient field even though the join is performed (the projection omits `pat.*`).

### 5.5 Update single calculation row

`PUT /api/FractionCalculation/{id}`

Forwards the entire body to `UpdateFractionCalculation`, which marks the entity as `Modified` and saves. Only one row at a time; there is no bulk update.

### 5.6 Reports

| Endpoint | Stored proc | Purpose |
|----------|-------------|---------|
| `GET /api/GetFractionTxnList` | `SP_FRC_GetFractionApplicableList` | List of bill transactions that have at least one fraction-applicable item, used to find candidates for calculation. |
| `GET /api/GetFractionReportByItemList` | `SP_FRC_GetTotalFractionbyItem` | Aggregate of `FinalAmount` grouped by service item. |
| `GET /api/GetFractionReportByDoctorList/{FromDate}/{ToDate}` | `SP_FRC_GetTotalFractionbyDoctor` | Aggregate of `FinalAmount` grouped by doctor, filtered by bill date range. |

All three return raw `DataTable` from `DALFunctions.GetDataTableFromStoredProc`. The `controller` does not project or wrap the result — the call is just `return Ok(_FractionCalculationService.GetFractionTxnList())`.

---

## 6. API Endpoints

Base prefix: `/api`. Authentication: standard Danphe session cookie (no `[Authorize]` attribute is visible in the source — module inherits whatever the global auth filter does).

| # | Method | Path | Controller method | Service method | Returns |
|---|--------|------|-------------------|----------------|---------|
| 1 | GET | `/api/Designation` | `GetAll` | `ListDesignation` | `List<DesignationModel>` |
| 2 | GET | `/api/Designation/{id}` | `Get` | `GetDesignation` | `DesignationModel` |
| 3 | POST | `/api/Designation` | `Post` | `AddDesignation` + `GetDesignation` | `DesignationModel` |
| 4 | PUT | `/api/Designation/{id}` | `Put` | `UpdateDesignation` + `GetDesignation` | `DesignationModel` |
| 5 | GET | `/api/FractionPercent` | `GetAll` | `ListFractionApplicableItems` | `List<FractionPercentVM>` |
| 6 | GET | `/api/FractionPercent/{id}` | `Get` | `GetFractionPercent` | `FractionPercentVM` |
| 7 | POST | `/api/FractionPercent` | `Post` | `AddFractionPercent` + `GetFractionPercent` | `FractionPercentVM` |
| 8 | PUT | `/api/FractionPercent/{id}` | `Put` | `UpdateFractionPercent` + `GetFractionPercent` | `FractionPercentVM` |
| 9 | GET | `/api/FractionPercentByPriceId/{id}` | `GetFractionPercentByBillPriceId` | `GetFractionPercentByBillPriceId` | `FractionPercentVM` |
| 10 | GET | `/api/FractionCalculation` | `GetAll` | `ListFractionCalculation` | `List<FractionCalculationModel>` |
| 11 | GET | `/api/FractionCalculation/{id}` | `Get` | `GetFractionCalculation` | `List<FractionCalculationViewModel>` |
| 12 | POST | `/api/FractionCalculation` | `Post` | `AddFractionCalculation` | `int` (the `BillTxnItemId` of the inserted batch) |
| 13 | PUT | `/api/FractionCalculation/{id}` | `Put` | `UpdateFractionCalculation` + `GetFractionCalculation` | `List<FractionCalculationViewModel>` |
| 14 | GET | `/api/GetFractionTxnList` | `GetFractionTxnList` | `GetFractionTxnList` | `DataTable` (raw SP result) |
| 15 | GET | `/api/GetFractionReportByItemList` | `GetFractionReportByItemList` | `GetFractionReportByItemList` | `DataTable` (raw SP result) |
| 16 | GET | `/api/GetFractionReportByDoctorList/{FromDate}/{ToDate}` | `GetFractionReportByDoctorList` | `GetFractionReportByDoctorList` | `DataTable` (raw SP result) |

All endpoints use the standard Danphe response envelope:

```json
{
  "Status": "OK",
  "ErrorMessage": null,
  "Results": <payload>
}
```

On failure, `Status = "Failed"` and `ErrorMessage = ex.Message + " exception details:" + ex.ToString()` (this leaks the full stack trace to the client — security smell, see §8).

---

## 7. Cross-Module Integration

### 7.1 Billing — `BIL_MST_ServiceItem` / `BIL_TXN_BillingTransactionItems`

- `BillServiceItemModel.IsFractionApplicable` (`bool?`, comment "mahesh 8th feb'19") flags whether a service item participates in fraction sharing. The flag is set in `BillSettingsController.cs:2371` during bill settings configuration.
- The fraction setup UI consumes `BillServiceItem` + `BillPriceCategoryServiceItem` to render the percent-setting grid.
- `BillingTransactionItemModel.BillingTransactionItemId` is the anchor for each `FRC_FractionCalculation.BillTxnItemId`.
- `BillingTransactionItemModel.PerformerId` / `PrescriberId` are the typical sources of the initial `DoctorId` for a fraction row. (The Fraction controller does not read them directly — the calling client is expected to resolve them before posting.)
- The Incentive module reuses the same `IsFractionApplicable` flag and the same `BillingTransactionItem` join keys — the two modules compete for the same conceptual bill lines but store their results in different tables (`FRC_` vs `INCTV_`).

### 7.2 Employee — `EMP_Employee`

- `Employee.EmployeeId` is stored in `FRC_FractionCalculation.DoctorId` and `FRC_FractionCalculation.IsParentId` (when populated by the cascade resolver).
- The calculation view joins `Employee` to render `FirstName + " " + LastName` as `DoctorName`.
- `Designation.CreatedBy` is a logical FK to `Employee.EmployeeId`.
- The module does not filter by employee status, role, or department — any employee can be a receiver.

### 7.3 Patient — `PAT_Patient`

- Joined in `GetFractionCalculation` to anchor the bill item to its patient. The view model does not currently expose patient fields, but the join is in place for future display ("which patient was this fraction for?").

### 7.4 Accounting / Payout

- **No direct integration.** Unlike the Incentive module, Fraction does not call into the Accounting controller to post a payment voucher, does not create `INCTV_TXN_PaymentInfo` rows, and does not debit any employee ledger.
- Reports are the only output. The expectation is that finance will use the SP-driven reports to manually prepare payouts.

### 7.5 Incentive — `INCTV_*` tables

- Sibling module. The two are largely independent but share the same `BillingTransactionItem` join anchor and the same `IsFractionApplicable` flag.
- See the comparison table in §1.3.

### 7.6 Settings — `BIL_MST_ServiceItem` / `BIL_CFG_PriceCategory`

- The `IsFractionApplicable` flag is toggled from the Bill Settings UI (`BillSettingsController.cs:2371`). Comments in `Order` and `Lab` settings controllers suggest the same flag is referenced (mostly commented out) — there is a cross-cutting intent to surface fraction-applicability across modules.

### 7.7 Other tables referenced

- `BIL_MAP_PriceCategoryServiceItem` (joined for the item's Normal price in the percent-setting VM).
- `DALFunctions.GetDataTableFromStoredProc` is the utility used to call the three SPs.

---

## 8. Business Rules

### 8.1 Percent invariants

- `HospitalPercent + DoctorPercent` should sum to `100`. The model and the database do not enforce this — the controller does not validate, and the service passes the value through. An admin could enter `Hospital=30, Doctor=50` and the system would accept it.
- `InitialPercent` and `FinalPercent` for a single `FRC_FractionCalculation` row are not required to be equal — the difference encodes a cascade adjustment.
- Sum of `FinalPercent` across all rows for a single `BillTxnItemId` should be `100` (the post-cascade total). The system does not enforce this; the caller is responsible for balancing.

### 8.2 Hierarchy and parent-child cascade

- A receiver with `Hierarchy = 0` is the root — its `IsParentId` is meaningless (typically 0 or its own `DoctorId`).
- A receiver with `Hierarchy >= 1` is a cascade child — its `IsParentId` holds the parent row's `DoctorId`.
- The service resolves the cascade by indexing a `Dictionary<double, int>` keyed on the input `ParentId` (an array index). The child row overwrites its `IsParentId` with the parent's `DoctorId` before insert.
- There is no enforced limit on cascade depth.

### 8.3 Soft delete and active rows

- `IsActive` is exposed on the entity but is not set in any service method. The default is whatever the SQL Server column default is (likely 1).
- Reports presumably filter on `IsActive = 1` inside the stored procedure.

### 8.4 Latent bugs and correctness issues

- **`Dictionary<double, int>` for parent lookup** (`FractionCalculationService.cs:32, 45`). Floating-point keys collide with precision loss. The cast `Convert.ToInt32(ParentId)` silently truncates fractional input. A safer choice is `Dictionary<int, int>` keyed on the array index, with the parent `DoctorId` looked up after the dictionary contains the integer key. Recommend fixing in the parity port.
- **Per-row `SaveChanges()` inside the loop** (`FractionCalculationService.cs:48`). If the array has N rows and row k fails, rows 1..k-1 are committed. Wrap the loop in a single transaction.
- **`CreatedBy` is never populated** for `FRC_FractionCalculation` rows. The `value.CreatedBy = currentUser.EmployeeId;` line in `FractionCalculationController.cs:69` is commented out. Either re-enable the assignment in the controller (it is commented as `//value.CreatedBy = currentUser.EmployeeId;`) or do it inside the service.
- **Stack-trace leak in `ErrorMessage`** (`DesignationController.cs:36, 56, 77, 99` etc.). `ex.ToString()` includes the full stack and any inner exceptions — including SQL fragments. Drop to `ex.Message` for production parity.
- **Hard-coded `PriceCategoryId = 1`** (three sites in `FractionPercentService.cs`). Foreign-currency and EHS items are invisible. Either parameterize or document the limitation explicitly in the port.
- **Inconsistent return types on POST** (`FractionCalculationController.cs:60, 71`). The `POST` method returns the `BillTxnItemId` (an `int`) but the route also declares it returns `FractionCalculationModel[]` in older docs. The current behaviour is correct (return the id, client re-fetches via GET) but it is a small API contract smell.
- **`DesignationService.UpdateDesignation` does not bump `ModifiedOn`/`ModifiedBy`** because the model has no such columns. Hard to audit who last edited a designation.
- **No validation on `IsActive` flip** — there is no API to deactivate a calculation row, so the flag is effectively write-once.

### 8.5 Audit and soft-state

- `CreatedBy` and `CreatedOn` are populated on `Designation` and `FractionPercent` writes (via service `DateTime.Now`).
- `ModifiedBy` and `ModifiedOn` are **absent** from the design — there is no change history.
- `IsActive` exists on `FractionCalculation` only. The other two tables have no soft-delete column.

### 8.6 Concurrency and locking

- No `RowVersion` / timestamp column. EF's default `EntityState.Modified` will blindly overwrite the row — last writer wins.
- The `AddFractionCalculation` loop has no concurrency token. Two concurrent posts for the same `BillTxnItemId` will produce duplicate cascade trees.

### 8.7 Tenant isolation

- **None.** The controllers do not accept or apply a tenant identifier. The module is single-hospital only. The parity port must inject `tenantId` and filter every query.

### 8.8 Permissions

- No `[Authorize(Roles=...)]` attributes are visible. The endpoints inherit whatever the global Danphe RBAC filter applies.
- The Danphe pattern is to gate write endpoints (`POST`, `PUT`) on roles like "admin" or "fractions-admin", and to allow read endpoints for any authenticated user. The parity port should enforce this explicitly in middleware.

---

## 9. Migration parity checklist

When porting this module to the Cloudflare Hono + D1 stack, the following items need explicit handling:

1. **New tables** `designations`, `fraction_percent_settings`, `fraction_calculations` (snake_case, with `tenant_id` for multi-tenant isolation).
2. **Cross-table joins** (`bill_item_price`, `billing_transaction_items`, `employees`, `patients`, `price_category_service_items`) must respect `tenant_id`. The Fraction module reads but does not write these — every join must filter.
3. **Stored procedures** `SP_FRC_GetFractionApplicableList`, `SP_FRC_GetTotalFractionbyItem`, `SP_FRC_GetTotalFractionbyDoctor` must be rewritten as parameterized SQL queries or D1 views. The doctor report accepts `FromDate` and `ToDate`; pass them as bind parameters.
4. **The parent-child resolver** in `AddFractionCalculation` should be rewritten with an `int`-keyed map (or two passes — first pass assigns stable ids, second pass fills `IsParentId`). Wrap the whole insert in a D1 batch (transaction).
5. **Hard-coded `PriceCategoryId = 1`** should be either parameterized or replaced by joining on the patient visit's `PriceCategoryId`.
6. **Currency rounding**: the `FinalAmount` is `decimal` in the model but is computed and stored as `decimal(18,2)`. D1 has no native decimal; use `INTEGER` for paisa/cents or `REAL` with documented precision.
7. **Soft-delete** via `is_active` integer flag must be carried over for `fraction_calculations`. The `designations` and `fraction_percent_settings` tables can adopt it for consistency.
8. **No DELETE endpoints exist** — preserve that contract. Add an admin-only `DELETE /api/fraction/designations/{id}` only if the parity product requires it.
9. **Audit fields**: `created_by`, `created_on` are populated. Add `modified_by`, `modified_on` to align with the rest of the HMS.
10. **Frontend is absent in the reference.** The parity port will need to design a new UI. The endpoints already return joined VMs (`FractionPercentVM`, `FractionCalculationViewModel`) that are UI-friendly, so the port can keep the same response shape.

---

## 10. Summary

The Fraction module is a small, focused revenue-sharing engine that complements the larger Incentive module. It gives the hospital a way to:

- Define a small catalog of "designation" roles that can receive a share of a billable service.
- Set a default hospital-vs-doctor percent split per service item.
- Capture a hierarchical multi-receiver cascade for a single bill line, with initial and final percentages and a final monetary amount.
- Report on the resulting shares by item or by doctor for a given date range.

It does **not** integrate with Accounting, has no payment-voucher posting, has no Angular UI in the reference, and stores no payment status. The Incentive module is the one that handles recurring, profile-based payouts end-to-end.

The implementation is correct in shape but carries a few rough edges — most importantly, the per-row commit inside the cascade resolver and the `Dictionary<double, int>` parent lookup. The parity port should fix both.

Key file paths (recap):
- Backend controllers: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Fraction/`
- Server models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/FractionModels/`
- View model: `DanpheEMR reference/Code/Websites/DanpheEMR/ViewModel/Fraction/FractionCalculationViewModel.cs`
- Services: `DanpheEMR reference/Code/Websites/DanpheEMR/Services/Fraction/`
- DB context: `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/FractionDbContext.cs`
- Cross-reference: `BIL_MST_ServiceItem` (`IsFractionApplicable` flag), `BIL_TXN_BillingTransactionItems` (anchor for each fraction), `EMP_Employee` (doctor resolution), `PAT_Patient` (patient join), `BIL_MAP_PriceCategoryServiceItem` (price lookup, hard-coded to Normal).
- Frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/fraction/` (empty folder, no shipped UI).

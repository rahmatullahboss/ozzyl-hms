# Marketing Referral Module — DanpheEMR Reference

Reference implementation: DanpheEMR (ASP.NET Core / SQL Server / Angular)
Source root: `DanpheEMR reference/Code/`
Target stack (in our HMS): Hono on Cloudflare Workers + D1 + R2 + Angular on Pages.
This document describes the reference .NET behavior so parity work has a single source of truth.

---

## 1. Module Overview

The Marketing Referral module in DanpheEMR tracks **referral-based patient acquisition** and the resulting **commission payouts** to external referring parties (agents, organizations, doctors, ambulance drivers, etc.). It is a thin, settlement-oriented module that links billed patient invoices to the referring party that brought the patient in, calculates a percentage-based commission, and produces a reportable ledger of referral earnings.

Scope:

- **Referring Organization master** — Hospitals, agencies, and corporate bodies that funnel patients to our hospital (master data with contact info, is-active flag).
- **Referring Party master** — Individual agents / sub-agents / drivers / external doctors that belong to an organization and a party group. Carries vehicle number, area code, PAN number, contact details.
- **Referring Party Group** — A categorization of parties (e.g. "Ambulance Driver", "External Doctor", "Field Agent"). One organization can host parties from many groups.
- **Referral Scheme** — A reusable commission rule with a fixed percentage. Schemes are simple (name + percentage) — there is no per-scheme date range or per-scheme cap.
- **Referral Commission transaction** — A per-invoice line that ties a billed patient visit to a referring party + scheme and stores the computed referral amount. A single invoice can have multiple commission lines (one per scheme-party pair) but the **sum of commission percentages is capped** by a system parameter `MaxMarketingreferralPercentPerInvoice` (parameter group `MarketingReferral`).
- **Marketing Referral Detail Report** — Date-range report of all commissions (optionally filtered by a single referring party) with full invoice context, patient, scheme, amount, and the user who entered the record.
- **Bill-detail lookup** — Given a `BillingTransactionId`, surface the per-item bill summary (item name, net qty, net amount) so the entry screen can show what is being commissioned.
- **Multi-percentage validation** — A single invoice may be split across multiple parties (e.g. ambulance driver 5% + field agent 3%) but the system prevents duplicate scheme-party pairs on the same invoice.

Hospital workflow served:

1. Marketing/admin defines Referring Organizations (hospitals, agencies).
2. Marketing/admin defines Referring Party Groups (Ambulance Driver, Field Agent, External Doctor, etc.).
3. Marketing/admin creates Referring Parties and assigns each one a group and an organization.
4. Marketing/admin defines Referral Schemes (e.g. "Ambulance 5%", "Field Agent 3%").
5. Billing produces a normal patient invoice.
6. Marketing user opens the Transaction page, picks a date range, sees the list of invoices with a "Referral Entered? Yes(N) / No(0)" indicator.
7. For each invoice not yet commissioned, the user opens the Add screen, picks a scheme + party, the system computes `NetAmount × percentage`, the user saves.
8. Multiple scheme/party lines can be added to the same invoice subject to the percentage cap.
9. Reports page generates a date-range (and optional party filter) detail report for accounting / payout.

**Out of scope** (and not in this module):

- No automated trigger from `BIL_TXN_BillingTransactions` (commission is entered manually post-billing).
- No payout / settlement / payable workflow.
- No accounting integration (no `ACC_Transactions` rows are written).
- No notification / SMS to referring party.
- No document management (contracts, IDs, KYC).
- No external referrer onboarding / self-service portal.
- No P&L / tax handling for the commission.
- No per-scheme date-validity (scheme is "as-of-now" snapshot — no expiry).

Key file paths:

- Backend controllers: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/MarketingReferral/`
- Server models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/MarketingReferralModel/`
- Service layer: `DanpheEMR reference/Code/Websites/DanpheEMR/Services/MarketingReferral/`
- DTOs: `DanpheEMR reference/Code/Websites/DanpheEMR/Services/MarketingReferral/DTOs/`
- DB context: `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/MarketingReferralDbContext.cs`
- Frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/mktreferral/`

---

## 2. Backend Files

### 2.1 Controller Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `Controllers/MarketingReferral/MarketingReferralController.cs` | 157 | Single REST controller. Inherits `CommonController`. All marketing-referral endpoints (CRUD on organization, party, party group, scheme, commission, plus three stored-proc-backed reads). |

### 2.2 Service Layer Inventory

| File | Purpose |
|------|---------|
| `Services/MarketingReferral/IMarketingReferralService.cs` | 29 lines. Service interface. |
| `Services/MarketingReferral/MarketingReferralService.cs` | 349 lines. Implementation. Owns all transaction logic; uses raw `DbContext` LINQ and `DALFunctions.GetDataTableFromStoredProc` for reports/invoices. |
| `Services/MarketingReferral/DTOs/ReferralCommission_DTO.cs` | Commission payload (server-side DTO). Adds denormalized display fields (`ReferralSchemeName`, `ReferringPartyName`, `AreaCode`, `ReferringOrganizationName`, `VehicleNumber`) for the add/edit screen. |
| `Services/MarketingReferral/DTOs/ReferralScheme_DTO.cs` | Scheme payload. |
| `Services/MarketingReferral/DTOs/ReferringOrganization_DTO.cs` | Organization payload. |
| `Services/MarketingReferral/DTOs/ReferringPartyGroup_DTO.cs` | Party-group payload. |
| `Services/MarketingReferral/DTOs/ReferringParty_DTO.cs` | Party payload. Adds denormalized `GroupName` and `ReferringOrganizationName` (joined server-side). |

### 2.3 Controller Endpoint Map

All routes are mounted under `/api/MarketingReferral/` (controller route prefix inferred from class location; the frontend DL service hits `/api/MarketingReferral/...`).

| HTTP | Route | Service method | Purpose |
|------|-------|----------------|---------|
| `GET` | `Invoices?fromDate=&toDate=` | `GetInvoice` | Returns the patient-invoice list eligible for referral entry for the date range. Calls stored proc `SP_MKT_Transaction_Invoice`. |
| `GET` | `BillDetails?billTransactionId=` | `GetBillDetails` | Returns the line-items of a single invoice (item name, net qty, net amount). Calls `SP_MKT_Transaction_Bill_Details`. |
| `GET` | `ReferralScheme` | `GetReferralScheme` | Returns all referral schemes (newest first). |
| `GET` | `ReferringParty` | `GetReferringParty` | Returns all parties joined with their party-group name and organization name (newest first). |
| `GET` | `ReferringPartyGroup` | `GetReferringPartyGroup` | Returns all party groups (newest first). |
| `GET` | `AlreadyAddedCommission?BillingTransactionId=` | `GetAlreadyAddedCommission` | Returns the commission lines already saved for the given invoice (joined to scheme, party, org). |
| `GET` | `ReferringOrganization` | `GetReferringOrganizationList` | Returns all referring organizations (newest first). |
| `GET` | `MarketingreferralDetailReport?fromDate=&toDate=&ReferringPartyId=` | `GetMarketingreferralDetailReport` | Detail report of all commissions in the range, optionally filtered to one party. Calls `SP_Marketing_Referral_Detail_Report`. |
| `POST` | `NewReferralComission` | `AddNewReferralComission` | Adds a new commission row (body: `ReferralCommission_DTO`). Wrapped in explicit transaction; commits only after the row is saved. |
| `POST` | `NewReferringOrganization` | `AddNewReferringOrganization` | Adds a new referring organization. |
| `POST` | `NewReferringParty` | `AddNewReferringParty` | Adds a new referring party. |
| `PUT` | `ReferringOrganization` | `UpdateReferringOrganization` | Updates an existing organization. |
| `PUT` | `ReferringParty` | `UpdateReferringParty` | Updates an existing party. |
| `PUT` | `ActivateDeactivateOrganization` | `UpdateActivateDeactivateOrganization` | Toggles `IsActive` on an organization. |
| `PUT` | `ActivateDeactivateParty` | `ActivateDeactivateParty` | Toggles `IsActive` on a party. |
| `DELETE` | `ReferralCommission?ReferralCommissionId=` | `DeleteReferralCommission` | Hard-deletes a commission row by id. No audit log. |

The controller uses `CommonController.InvokeHttpGetFunction` / `InvokeHttpPostFunction` / `InvokeHttpPutFunction` — these return a standardized `DanpheHTTPResponse` envelope. The current user is read from `HttpContext.Session.Get<RbacUser>(ENUM_SessionVariables.CurrentUser)` for write operations.

### 2.4 Architectural notes

- **Single controller, no DI** — `MarketingReferralDbContext` is constructed per-request inside the controller (`new MarketingReferralDbContext(connString)`), and the service interface is also constructed per-request. This matches the older Danphe pattern and is a likely migration target.
- **Read-mostly via stored procs, write via EF** — All list/report/bill-detail reads go through `DALFunctions.GetDataTableFromStoredProc`. All master and commission writes go through EF LINQ.
- **Hard delete for commissions** — `DeleteReferralCommission` calls `.Remove()` followed by `SaveChanges()`. There is no soft-delete column, no audit row, no reversal transaction. This is operationally weak and a likely migration fix.
- **No server-side validation of percentage cap** — The "sum of percentages on one invoice cannot exceed `MaxMarketingreferralPercentPerInvoice`" rule is enforced **client-side only** (`CheckExistingMapping` in `mktreferral-transaction-Add.component.ts`). The server will accept an over-cap commission row.
- **No uniqueness enforcement server-side** — The client guards against duplicate scheme/party combinations on the same invoice, but the server has no DB-level uniqueness constraint and no service-layer pre-check.
- **`UpdateActivateDeactivateOrganization` ignores `currentUser`** — Despite the parameter, the method does not write `ModifiedBy/ModifiedOn`. (Mismatch with `UpdateReferringOrganization` which does.)
- **Transactions wrap the write but no read** — `AddNewReferralComission` opens a `dbContextTransaction` but only the EF insert happens inside it. There is no cross-table consistency.

---

## 3. Data Models

All models live in `Code/Components/DanpheEMR.ServerModel/MarketingReferralModel/`.

### 3.1 `ReferralSchemeModel` → `MKT_MST_ReferralScheme`

A reusable commission rule.

| Field | Type | Notes |
|-------|------|-------|
| `ReferralSchemeId` | `int` (PK, `[Key]`) | Identity. |
| `ReferralSchemeName` | `string` | Display name (e.g. "Ambulance 5%"). |
| `Description` | `string` | Free-text description. |
| `ReferralPercentage` | `decimal` | Percentage value (0–100). C# returns it as `int` in the DTO list response (`(int)refr.ReferralPercentage`). |
| `CreatedBy` | `int` | Employee id. |
| `CreatedOn` | `DateTime` | UTC server time. |
| `ModifiedBy` | `int?` | Nullable. |
| `ModifiedOn` | `DateTime?` | Nullable. |
| `IsActive` | `bool` | Soft-disable flag. |

### 3.2 `ReferringPartyModel` → `MKT_CFG_ReferringParty`

An individual agent / driver / external doctor.

| Field | Type | Notes |
|-------|------|-------|
| `ReferringPartyId` | `int` (PK) | Identity. |
| `ReferringPartyName` | `string` | Required. The agent's name. |
| `ReferringPartyGroupId` | `int` | FK to `MKT_MST_ReferringPartyGroup`. Not a navigation property in the model. |
| `ReferringOrgId` | `int` | FK to `MKT_MST_ReferringOrganization`. |
| `Address` | `string` | Free text. |
| `VehicleNumber` | `string` | For ambulance drivers — the ambulance plate. |
| `ContactNumber` | `string` | Phone. |
| `AreaCode` | `string` | Operational area / region code. |
| `PANNumber` | `string` | Tax id (Indian PAN). |
| `CreatedBy` | `int` | Employee id. |
| `CreatedOn` | `DateTime` | UTC server time. |
| `ModifiedBy` | `int?` | Nullable. |
| `ModifiedOn` | `DateTime?` | Nullable. |
| `IsActive` | `bool` | Soft-disable flag. Frontend entry screen filters to active parties only. |

### 3.3 `ReferringPartyGroupModel` → `MKT_MST_ReferringPartyGroup`

A categorization of parties (e.g. "Ambulance Driver", "Field Agent").

| Field | Type | Notes |
|-------|------|-------|
| `ReferringPartyGroupId` | `int` (PK) | Identity. |
| `GroupName` | `string` | Display name. |
| `Description` | `string` | Free text. |
| `CreatedBy` | `int` | Employee id. |
| `CreatedOn` | `DateTime` | UTC. |
| `ModifiedBy` | `int?` | Nullable. |
| `ModifiedOn` | `DateTime?` | Nullable. |
| `IsActive` | `bool` | Soft-disable flag. |

### 3.4 `ReferringOrganizationModel` → `MKT_MST_ReferringOrganization`

A host organization (hospital, agency, corporate).

| Field | Type | Notes |
|-------|------|-------|
| `ReferringOrganizationId` | `int` (PK) | Identity. |
| `ReferringOrganizationName` | `string` | Required. |
| `Address` | `string` | Free text. |
| `ContactNo` | `string` | Phone. |
| `ContactPersons` | `string` | Free text — comma-separated contact names. |
| `CreatedBy` | `int` | Employee id. |
| `CreatedOn` | `DateTime` | UTC. |
| `ModifiedBy` | `int?` | Nullable. |
| `ModifiedOn` | `DateTime?` | Nullable. |
| `IsActive` | `bool` | Soft-disable flag. |

### 3.5 `ReferralComissionModel` → `MKT_TXN_ReferralCommission`

A single commission line linking a billed invoice to a party + scheme.

| Field | Type | Notes |
|-------|------|-------|
| `ReferralCommissionId` | `int` (PK) | Identity. |
| `FiscalYearId` | `int` | FK to `BIL_CFG_FiscalYears` (fiscal year of the invoice). |
| `BillingTransactionId` | `int` | FK to `BIL_TXN_BillingTransactions`. |
| `InvoiceNoFormatted` | `string` | Denormalized formatted invoice number (e.g. "BL-001-2024"). |
| `InvoiceDate` | `DateTime` | Denormalized invoice date. |
| `PatientId` | `int` | FK to patient. |
| `PatientVisitId` | `int` | FK to visit. |
| `ReferringPartyId` | `int` | FK to `MKT_CFG_ReferringParty`. |
| `ReferralSchemeId` | `int` | FK to `MKT_MST_ReferralScheme`. |
| `InvoiceTotalAmount` | `decimal` | Snapshot of invoice gross at commission time. |
| `ReturnAmount` | `decimal` | Snapshot of returns against this invoice at commission time. |
| `InvoiceNetAmount` | `decimal` | Net = `InvoiceTotalAmount - ReturnAmount`. Used for percentage calculation. |
| `Percentage` | `decimal` | Snapshot of scheme percentage at the time of entry. |
| `ReferralAmount` | `decimal` | Computed: `InvoiceNetAmount × Percentage / 100`. |
| `Remarks` | `string` | Free text. |
| `CreatedBy` | `int` | Employee id. |
| `CreatedOn` | `DateTime` | UTC. |
| `ModifiedBy` | `int?` | Nullable. |
| `ModifiedOn` | `DateTime?` | Nullable. |
| `IsActive` | `bool` | Soft-disable flag (set to `true` on insert; no UI to flip). |

### 3.6 Read-side DTOs (server)

`ReferralCommission_DTO` (server) extends the model with display-only fields that the add/edit screen expects pre-joined:

`ReferralSchemeName`, `ReferringPartyName`, `AreaCode`, `ReferringOrganizationName`, `VehicleNumber`, plus the standard audit fields.

`ReferringParty_DTO` (server) adds `GroupName` and `ReferringOrganizationName` (joined server-side from the related tables).

`ReferringOrganization_DTO`, `ReferralPartyGroup_DTO`, `ReferralScheme_DTO` are 1:1 with their models.

### 3.7 Read-side DTOs (frontend, in `Shared/DTOs/`)

| DTO | Purpose |
|-----|---------|
| `MarketingReferralInvoice_DTO` | Row for the date-range invoice list (`InvoiceDate, InvoiceNo, HospitalNo, PatientName, Age, InvoiceAmount, ReturnAmount, NetAmount`). |
| `TransactionBillDetails_DTO` | Bill line summary (`ItemName, NetQuantity, NetTotalAmount`). |
| `ReferralCommission_DTO` (TS) | Frontend commission payload — extends server DTO with `ReferralPartyGroupName`, `ReferralPercentage`. |
| `ReferralReport_DTO` | Row for the detail report (`InvoiceDate, InvoiceNo, InvoiceNoFormatted, HospitalNo, PatientName, ReferringPartyName, GroupName, ReferringOrganizationName, VehicleNumber, ReferralSchemeName, InvoiceNetAmount, Percentage, ReferralAmount, Remarks, EnteredBy, EnteredOn`). |
| `ReferralParty_DTO` (TS) | Frontend party. |
| `ReferralScheme_DTO` (TS) | Frontend scheme. |
| `ReferralPartyGroup_DTO` (TS) | Frontend party group. |
| `ReferringOrganization_DTO` (TS) | Frontend organization. |

Note the typo **`ReferralComission`** (two `i`s, two `s`s) — used consistently in the model name, DbSet name, table name (`MKT_TXN_ReferralCommission`), and code-behind. Spelling is preserved everywhere in the reference.

---

## 4. Database Tables

Map defined in `MarketingReferralDbContext.OnModelCreating`.

| DbSet | Table | Purpose |
|-------|-------|---------|
| `ReferralScheme` | `MKT_MST_ReferralScheme` | Scheme master. |
| `ReferringParty` | `MKT_CFG_ReferringParty` | Party master. (Note: `CFG` not `MST` — denotes configuration table.) |
| `ReferringPartyGroup` | `MKT_MST_ReferringPartyGroup` | Party-group master. |
| `ReferringOrganization` | `MKT_MST_ReferringOrganization` | Organization master. |
| `ReferralComission` | `MKT_TXN_ReferralCommission` | Commission transactions. (`TXN`.) |
| `BillingTransactionItem` | `BIL_TXN_BillingTransactionItems` | Read-only join for invoice-line breakdown. |
| `BillingFiscalYears` | `BIL_CFG_FiscalYears` | Read-only join for fiscal-year metadata. |

### 4.1 Stored procedures (used by the service layer)

| SP | Purpose | Parameters |
|----|---------|------------|
| `SP_MKT_Transaction_Invoice` | Returns the invoice list with patient header and a `ReferralCount` per invoice (number of `MKT_TXN_ReferralCommission` rows for that `BillingTransactionId`). Used by the Transaction list page. | `@FromDate`, `@ToDate` |
| `SP_MKT_Transaction_Bill_Details` | Returns the per-item breakdown of one invoice. | `@BillingTransactionId` |
| `SP_Marketing_Referral_Detail_Report` | Returns the detail report. Joins commission to scheme, party, group, organization, patient, visit, and the employee who entered the record (`EnteredBy`). | `@FromDate`, `@ToDate`, `@ReferringPartyId` (nullable) |

The reference contains only one C# / TypeScript implementation — there is no separate migration file under `DanpheEMR reference/Database/` for the marketing-referral tables; the `DanpheAdmin_CompleteDB.sql` admin script and the `Dev_DanpheEMR_INT1.zip` EMR backup are the canonical schema sources. This is consistent with the rest of the DanpheEMR reference: stored procs and tables ship inside the SQL Server backup, not as discrete scripts.

### 4.2 Suggested D1/SQLite parity schema (for the migration)

```sql
-- Master tables (mkt_)
CREATE TABLE mkt_referral_scheme (
  referral_scheme_id     INTEGER PRIMARY KEY,
  referral_scheme_name   TEXT NOT NULL,
  description            TEXT,
  referral_percentage    REAL NOT NULL,
  created_by             INTEGER NOT NULL,
  created_on             TEXT NOT NULL,
  modified_by            INTEGER,
  modified_on            TEXT,
  is_active              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE mkt_referring_party_group (
  referring_party_group_id INTEGER PRIMARY KEY,
  group_name               TEXT NOT NULL,
  description              TEXT,
  created_by               INTEGER NOT NULL,
  created_on               TEXT NOT NULL,
  modified_by              INTEGER,
  modified_on              TEXT,
  is_active                INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE mkt_referring_organization (
  referring_organization_id   INTEGER PRIMARY KEY,
  referring_organization_name TEXT NOT NULL,
  address                     TEXT,
  contact_no                  TEXT,
  contact_persons             TEXT,
  created_by                  INTEGER NOT NULL,
  created_on                  TEXT NOT NULL,
  modified_by                 INTEGER,
  modified_on                 TEXT,
  is_active                   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE mkt_referring_party (
  referring_party_id         INTEGER PRIMARY KEY,
  referring_party_name       TEXT NOT NULL,
  referring_party_group_id   INTEGER NOT NULL REFERENCES mkt_referring_party_group(referring_party_group_id),
  referring_org_id           INTEGER NOT NULL REFERENCES mkt_referring_organization(referring_organization_id),
  address                    TEXT,
  vehicle_number             TEXT,
  contact_number             TEXT,
  area_code                  TEXT,
  pan_number                 TEXT,
  created_by                 INTEGER NOT NULL,
  created_on                 TEXT NOT NULL,
  modified_by                INTEGER,
  modified_on                TEXT,
  is_active                  INTEGER NOT NULL DEFAULT 1
);

-- Transaction table
CREATE TABLE mkt_referral_commission (
  referral_commission_id    INTEGER PRIMARY KEY,
  fiscal_year_id            INTEGER NOT NULL,
  billing_transaction_id    INTEGER NOT NULL,
  invoice_no_formatted      TEXT,
  invoice_date              TEXT NOT NULL,
  patient_id                INTEGER NOT NULL,
  patient_visit_id          INTEGER NOT NULL,
  referring_party_id        INTEGER NOT NULL REFERENCES mkt_referring_party(referring_party_id),
  referral_scheme_id        INTEGER NOT NULL REFERENCES mkt_referral_scheme(referral_scheme_id),
  invoice_total_amount      REAL NOT NULL,
  return_amount             REAL NOT NULL DEFAULT 0,
  invoice_net_amount        REAL NOT NULL,
  percentage                REAL NOT NULL,
  referral_amount           REAL NOT NULL,
  remarks                   TEXT,
  created_by                INTEGER NOT NULL,
  created_on                TEXT NOT NULL,
  modified_by               INTEGER,
  modified_on               TEXT,
  is_active                 INTEGER NOT NULL DEFAULT 1
);

-- Indexes
CREATE INDEX idx_mkt_refcomm_billing_txn ON mkt_referral_commission(billing_transaction_id);
CREATE INDEX idx_mkt_refcomm_party        ON mkt_referral_commission(referring_party_id);
CREATE INDEX idx_mkt_refcomm_invoice_date ON mkt_referral_commission(invoice_date);
```

A single invoice can have many commission rows; there is no DB-level uniqueness constraint in the reference, so none is added here. The migration should add an app-level check (Zod schema or service guard) to mirror the client-side rules in §8.

---

## 5. Key Workflows

### 5.1 Master-data setup (one-time / infrequent)

1. Marketing/admin navigates to **MktReferral → Settings → Referring Organization**.
2. Clicks **Add Referring Organization**, fills `ReferringOrganizationName` (required), `Address` (required), `ContactNo`, `ContactPersons`. Saves.
3. Returns to grid. To change status, clicks **Deactivate** / **Activate** in the row. To edit, clicks **Edit**.
4. Same pattern for **Referring Party Group** (although the UI surfaces party-group inside the Party add/edit form via a dropdown — there is no standalone "Party Group" page in the routing; the only way to manage groups today is via the underlying SP/service, not through the UI shipped here).
5. Navigates to **Settings → Referring Party**.
6. Clicks **Add Referring Party**, fills `ReferringPartyName` (required), selects a `Party Group` from a dropdown, picks an `Organization` from the autocomplete, fills `Address` and `ContactNo` (required), and optionally `Vehicle Number`, `Area Code`, `PAN Number`. Saves.
7. Party is now available in the Transaction screen's party autocomplete (active parties only).

There is no separate UI to add a Referral Scheme in the reference frontend — the `ReferralScheme` model exists, the `GET /api/MarketingReferral/ReferralScheme` endpoint exists, the `ReferralScheme_DTO` exists, but no `Add`/`Update` controller action is implemented, and no Settings page is wired. Schemes must be inserted directly into the DB today. This is a known gap.

### 5.2 Commission entry workflow (per invoice)

1. Marketing user opens **MktReferral → Transaction**. The default page is a date-range grid; default range is empty (user picks via the `danphe-grid` date picker).
2. Frontend calls `GET /api/MarketingReferral/Invoices?fromDate=&toDate=` → server invokes `SP_MKT_Transaction_Invoice` and returns rows with: `CreatedOn, InvoiceNoFormatted, PatientCode, ShortName, Age, TotalAmount, ReturnCashAmount, NetAmount, ReferralCount, BillingTransactionId, PatientId, PatientVisitId, FiscalYearId`.
3. The grid's "Entered ?" column renders a `Yes(N)` / `No(0)` cell based on `ReferralCount` (the cell renderer in `grid-column-settings.constant.ts` lines 5643-5656).
4. User clicks **Yes(N)** or **No(0)**. The component (`mktreferral-transaction.component.ts:42-69`) checks `NetAmount === 0` — if so, shows a "All items are already returned, you cannot enter commission" message and refuses to open the Add page. Otherwise it sets `ShowAddPage = true` and passes the selected row.
5. The **Add popup** (`mktreferral-transaction-Add.component.ts`) opens. On `ngOnInit` it:
   - Reads the system parameter `MaxMarketingreferralPercentPerInvoice` from the cached `CoreService.Parameters` (group `MarketingReferral`, name `MaxMarketingreferralPercentPerInvoice`).
   - Reads the display flag `MktReferralTransactionDisplaySettings` (group `MarketingReferral`, name `MktReferralTransactionDisplaySettings`) — controls whether the **Ref %** and **Amount** readout labels are visible to the user.
   - Calls `GET /api/MarketingReferral/BillDetails?billTransactionId=...` to populate the bill-summary table.
   - Calls `GET /api/MarketingReferral/AlreadyAddedCommission?BillingTransactionId=...` to populate the "Already Entered" list.
   - Calls `GET /api/MarketingReferral/ReferralScheme` to populate the scheme dropdown.
   - Calls `GET /api/MarketingReferral/ReferringParty` (filtered to `IsActive === true`) to populate the party autocomplete.
6. The user picks a `Referral Scheme` from the dropdown. `onReferralSchemeSelected` runs `calculateAmount()` which sets `Amount = NetAmount × (percentage / 100)`.
7. The user types at least 3 characters in the party autocomplete (matches against `ReferringPartyName, ReferringOrganizationName, VehicleNumber, GroupName`). Selecting a party populates the read-only `Group`, `Vehicle No`, `Organization`, `Area` fields.
8. The user optionally types `Remarks` and clicks **Save**.
9. `AssignValueToSave` copies the row data + user-selected scheme/party into a `ReferralCommission_DTO` and calls `CheckExistingMapping`. This validator runs three guards against the `alreadyAddedCommissionList`:
   - **Cap guard**: `sumOfExistingPercentages + newPercentage > MaximumReferralPercentagePerInvoice` → block with warning.
   - **Duplicate-scheme guard**: same scheme already exists for a *different* party → block.
   - **Duplicate-party guard**: same party already exists for a *different* scheme → block.
   - **Duplicate-scheme+party guard**: identical scheme+party pair already exists → block.
   - If any guard fails, the form is **not submitted**; no HTTP call is made.
10. If all guards pass, `SaveNewReferral` issues `POST /api/MarketingReferral/NewReferralComission`. On success the popup refreshes its "Already Entered" list with the new row and clears the form.

### 5.3 Edit / delete a commission

The Add popup supports **delete** only (per-row "X" button in the Already-Entered table). It does **not** support editing a row's percentage or amount — to fix a mistake, delete and re-enter.

`DeleteReferralCommission` issues `DELETE /api/MarketingReferral/ReferralCommission?ReferralCommissionId=...` which is a hard delete at the service layer (no soft-delete column update, no reversal entry, no audit row). After deletion the service removes the row in-memory from `alreadyAddedCommissionList`.

### 5.4 Reporting workflow

1. User opens **MktReferral → Reports → MarketingReferralDetailReport** (default tab).
2. Selects a date range and (optionally) a referring party from the autocomplete.
3. Clicks **Show Report**. The component calls `GET /api/MarketingReferral/MarketingreferralDetailReport?fromDate=&toDate=&ReferringPartyId=...`.
4. The server invokes `SP_Marketing_Referral_Detail_Report` and returns a denormalized set with: invoice date/no, hospital no, patient name, party name, group, organization, vehicle, scheme, net amount, percentage, referral amount, remarks, entered-by, entered-on.
5. The grid is configured with `gridExportOptions.fileName = "MarketingReferralDetailReportYYYY-MM-DD.xls"` and `grid-showExport=true`, so the user can export to Excel directly from the toolbar.

### 5.5 Activate/deactivate workflow (settings)

For each organization and each party, the settings grid has an inline **Activate** / **Deactivate** link that toggles the `IsActive` flag via `PUT /api/MarketingReferral/ActivateDeactivateOrganization` or `PUT /api/MarketingReferral/ActivateDeactivateParty`. Both endpoints flip the flag with a server-side `!IsActive` toggle and do not write `ModifiedBy/ModifiedOn`. A confirm dialog guards the action in the UI.

### 5.6 System parameters (in `CORE_CFG_Parameters`)

| ParameterGroupName | ParameterName | Purpose |
|-------------------|---------------|---------|
| `MarketingReferral` | `MaxMarketingreferralPercentPerInvoice` | Numeric cap (JSON-parsed). Enforced **client-side** only — sum of all commission percentages on a single invoice cannot exceed this value. No server enforcement. |
| `MarketingReferral` | `MktReferralTransactionDisplaySettings` | JSON object: `{ ShowPercentage: bool, ShowCommissionAmount: bool }`. Controls whether the **Ref %** and **Amount** read-out labels are shown on the Add popup. Used to hide the actual calculated value from a marketing user who is only supposed to enter scheme/party. |

---

## 6. API Endpoints

Base path: `/api/MarketingReferral/`. All responses are wrapped in `DanpheHTTPResponse` (`{ Status, Results, ErrorMessage }`).

| # | Method | Route | Body / Query | Returns | Auth |
|---|--------|-------|--------------|---------|------|
| 1 | GET | `Invoices?fromDate=&toDate=` | `fromDate, toDate` (ISO date) | `DataTable` from `SP_MKT_Transaction_Invoice` | Session |
| 2 | GET | `BillDetails?billTransactionId=` | `billTransactionId` (int) | `DataTable` from `SP_MKT_Transaction_Bill_Details` | Session |
| 3 | GET | `ReferralScheme` | — | `List<ReferralScheme_DTO>` (id, name, percentage) ordered by `CreatedOn desc` | Session |
| 4 | GET | `ReferringParty` | — | `List<ReferringParty_DTO>` joined with group + org, ordered by `CreatedOn desc` | Session |
| 5 | GET | `ReferringPartyGroup` | — | `List<ReferralPartyGroup_DTO>` ordered by `CreatedOn desc` | Session |
| 6 | GET | `ReferringOrganization` | — | `List<ReferringOrganization_DTO>` ordered by `CreatedOn desc` | Session |
| 7 | GET | `AlreadyAddedCommission?BillingTransactionId=` | `BillingTransactionId` (int) | `List<ReferralCommission_DTO>` for the given txn, joined to scheme/party/org | Session |
| 8 | GET | `MarketingreferralDetailReport?fromDate=&toDate=&ReferringPartyId=` | dates + optional `ReferringPartyId` (int?) | `DataTable` from `SP_Marketing_Referral_Detail_Report` | Session |
| 9 | POST | `NewReferralComission` | `ReferralCommission_DTO` (body) | Echo of the DTO (with `ReferralCommissionId` set if generated — note: the service returns the DTO, not the saved model) | Session + `RbacUser` |
| 10 | POST | `NewReferringOrganization` | `ReferringOrganization_DTO` (body) | Echo of the DTO | Session + `RbacUser` |
| 11 | POST | `NewReferringParty` | `ReferringParty_DTO` (body) | Echo of the DTO | Session + `RbacUser` |
| 12 | PUT | `ReferringOrganization` | `ReferringOrganization_DTO` (body, must include id) | Echo of the DTO, or `Exception` if id not found | Session + `RbacUser` |
| 13 | PUT | `ReferringParty` | `ReferringParty_DTO` (body, must include id) | Echo of the DTO, or `Exception` if id not found | Session + `RbacUser` |
| 14 | PUT | `ActivateDeactivateOrganization` | `ReferringOrganization_DTO` (body, id only required) | The updated organization (with flipped `IsActive`) | Session + `RbacUser` |
| 15 | PUT | `ActivateDeactivateParty` | `ReferringParty_DTO` (body, id only required) | The updated party (with flipped `IsActive`) | Session + `RbacUser` |
| 16 | DELETE | `ReferralCommission?ReferralCommissionId=` | `ReferralCommissionId` (int) | The deleted model row, or `null` if not found | Session |

For Hono/D1 parity, the convention is to use `zValidator` for body and query parsing, and to return `{ Status: "OK", Results: <data> }` for success and `{ Status: "Failed", ErrorMessage: <msg> }` for errors. The `GET` data-table results should be mapped to typed arrays in the Hono handlers (D1 has no `DataTable`).

---

## 7. Cross-Module Integration

The Marketing Referral module is intentionally narrow and integrates with only a handful of other subsystems:

### 7.1 Patient module

- The invoice list (SP `SP_MKT_Transaction_Invoice`) joins against the patient table to surface `HospitalNo` (`PatientCode`), `PatientName` (`ShortName`), `Age`, and `PatientId`. No write goes back to patient records.
- The Transaction list page displays patient name as a read-only header in the Add popup.

### 7.2 Billing module

- The central integration. The commission row stores `BillingTransactionId` to `BIL_TXN_BillingTransactions`. The fiscal year comes from `BIL_CFG_FiscalYears`.
- The invoice is fetched via `SP_MKT_Transaction_Invoice` which joins `BIL_TXN_BillingTransactions` to filter to non-cancelled, non-returned invoices in the date range and computes `NetAmount = TotalAmount - ReturnAmount`.
- When a billing return is processed **after** a commission was entered, the commission row's snapshot of `InvoiceTotalAmount`, `ReturnAmount`, `InvoiceNetAmount` becomes stale — the commission is **not** recomputed. This is a known gap.
- `SP_MKT_Transaction_Bill_Details` reads `BIL_TXN_BillingTransactionItems` to surface the per-item breakdown.
- The "Add commission" UI blocks entries when `NetAmount === 0` (i.e. the invoice is fully returned) but does **not** block on partial returns beyond showing the reduced `NetAmount` in the header.
- The percentage cap (`MaxMarketingreferralPercentPerInvoice`) is also stored in the Billing parameter table (since `CORE_CFG_Parameters` is the cross-cutting config table).

### 7.3 HR / Employee module

- `CreatedBy` / `ModifiedBy` on every master and transaction row reference the employee who performed the action. The Detail Report joins to `EMP_Employee` to render the `EnteredBy` column.

### 7.4 Accounting module

- **None.** No `ACC_Transactions`, no `ACC_Master`, no voucher generation. Commissions are tracked as referral records only; actual payout happens in a manual process outside the system (likely AP / bank transfer done by the accounts team using the Detail Report).

### 7.5 Core / Parameter module

- `CORE_CFG_Parameters` holds the two `MarketingReferral` group parameters described in §5.6.
- The frontend caches all parameters in `CoreService.Parameters` at login; the Add screen reads from the cache, not from a server round-trip per save.

### 7.6 Security / RBAC

- All endpoints go through the standard `CommonController` machinery which requires an authenticated `RbacUser` in `HttpContext.Session`. The `RbacUser.EmployeeId` is the value written into `CreatedBy` / `ModifiedBy`.
- Permission strings (e.g. `btn-mktreferral-transaction-add`) are not enforced in the controller; the frontend hides/disables UI based on `SecurityService.HasPermission()`. The exact permission names are defined in the security seed (in the security module, not in this controller).

### 7.7 Reporting / export

- The frontend renders the Detail Report through `danphe-grid` with `gridExportOptions` set to an `.xls` file named `MarketingReferralDetailReportYYYY-MM-DD.xls`. The actual export uses the shared `DanpheExportService` (server-side, generic) — the controller does not own this.

---

## 8. Business Rules

Enforced in code or by the DB schema:

1. **Invoice must be billable** — only `BIL_TXN_BillingTransactions` rows that are not cancelled, not fully returned, and have a positive `NetAmount` are returned by `SP_MKT_Transaction_Invoice`. (Cancelled or fully-returned rows are excluded at the SP layer.)
2. **Cannot commission a fully-returned invoice** — enforced client-side: `if (NetAmount === 0) → "All items are already returned, you cannot enter the commission details"` and the Add popup does not open.
3. **One scheme per party per invoice (and vice-versa)** — enforced client-side only. Two guards:
   - If the chosen scheme is already present with a different party, block.
   - If the chosen party is already present with a different scheme, block.
   - If the chosen scheme+party pair already exists exactly, block.
4. **Per-invoice percentage cap** — `MaxMarketingreferralPercentPerInvoice` (system parameter) caps the sum of percentages across all commission lines on a single invoice. Enforced client-side only. If exceeded: `Sum of Referral Comission Percentage cannot be more than <cap>`.
5. **Active parties only at entry** — the Add popup filters `referringPartyList` to `IsActive === true` before binding to the autocomplete. The settings page lists all parties regardless of `IsActive` so the user can flip them.
6. **Hard delete of commission rows** — `DELETE` is the only way to remove a commission; there is no soft-delete column flip, no reversal entry, no audit row. This is a known operational weakness.
7. **Snapshot semantics** — `InvoiceTotalAmount`, `ReturnAmount`, `InvoiceNetAmount`, `Percentage`, `ReferralSchemeName`, `ReferringPartyName` are all snapshotted onto the commission row at entry time. Later changes to a scheme's percentage or to the invoice's return amount do **not** propagate to existing commission rows.
8. **No multi-tenant scoping** — the tables do not carry `TenantId` (this is consistent with the rest of DanpheEMR). The Cloudflare/Hono migration must add `tenant_id` to every table since our HMS is multi-tenant.
9. **Fiscal year is mandatory** — every commission row carries `FiscalYearId`, sourced from the invoice's fiscal year at entry time. The frontend reads it from the row data (`selectedRowData.FiscalYearId`).
10. **No updates to a commission** — the API exposes only `Add` and `Delete` for commissions. There is no `PUT /ReferralCommission` endpoint. To modify a commission, delete and re-create.
11. **`UpdateReferringOrganization` and `UpdateReferringParty` always set `IsActive = true`** — even when editing, the service hard-sets `IsActive = true`. This means the only way to deactivate a master record is the dedicated Activate/Deactivate toggle.
12. **Scheme CRUD is incomplete** — there is `GET ReferralScheme` but no `POST/PUT/DELETE` for schemes. Schemes must be inserted into `MKT_MST_ReferralScheme` directly in the database. The reference's intended workflow assumes a one-time setup or DB-side management.
13. **Party-Group CRUD is incomplete** — there is `GET ReferringPartyGroup` but no `POST/PUT/DELETE`. The Settings UI does not surface a standalone Party Group page either. Groups must be inserted into `MKT_MST_ReferringPartyGroup` directly.
14. **Audit gap on Activate/Deactivate** — `UpdateActivateDeactivateOrganization` and `ActivateDeactivateParty` do not write `ModifiedBy/ModifiedOn` even though they take `currentUser` as a parameter. A migration fix should write these.
15. **Empty `Description` is allowed** — `ReferralScheme.Description` and `ReferringPartyGroup.Description` are free text with no required validation. `ReferralSchemeName` and `GroupName` are validated as required by the UI's reactive form.
16. **PAN number is free text** — the `PANNumber` field on `ReferringParty` is stored as a string with no format validation. The UI's column header is configurable via `CoreService.GetFieldLabelParameter().PANNo` (for the "PAN No" vs "PAN Number" label localization).
17. **No maximum parties per invoice** — only the percentage cap and the unique-scheme/unique-party guards limit the number of commission lines. There is no "max N parties" rule.

---

## 9. Frontend Inventory

The frontend is a single Angular module `MktreferralModule` mounted at `/MktReferral`.

### 9.1 Routing

```
/MktReferral
├── /Transaction                  (default)
│   └── /mktreferral-transaction-Add  (popup over list)
├── /Reports
│   └── /MarketingReferralDetailReport
└── /Settings
    ├── /ReferringOrganization    (default)
    └── /ReferringParty
```

Defined in `mktreferral-routing.module.ts`. RBAC-driven: `MarketingreferralMainComponent` reads child routes from `SecurityService.GetChildRoutes("MktReferral")` and only renders the routes the current user has access to.

### 9.2 Components

| Component | Path | Purpose |
|-----------|------|---------|
| `MarketingreferralMainComponent` | `mktreferral-main.component.{ts,html}` | Top-level shell. Renders the breadcrumb-style nav and a `<router-outlet>`. |
| `MarketingReferralTransactionComponent` | `mktreferral-transaction/List-page/` | Date-range invoice list with "Yes(N) / No(0)" commission indicator and the Add popup host. |
| `MarketingReferralAddTransactionComponent` | `mktreferral-transaction/Entry-page/` | Add popup. Hosts the bill summary, the form (scheme, party, remarks), the "Already Entered" list, and per-row delete. |
| `MarketingReferralSettingsComponent` | `mktreferral-settings/` | Settings shell. Renders the secondary nav. |
| `MarketingReferralReferringOrganizationComponent` | `mktreferral-settings/referring-organization/` | Organization grid + add/edit modal + activate/deactivate. |
| `MarketingReferralReferringPartyComponent` | `mktreferral-settings/referring-party/` | Party grid + add/edit modal + activate/deactivate. |
| `MarketingReferralReportMainComponent` | `reports/mktreferral-report-main.component.{ts,html}` | Reports shell. |
| `MarketingReferralDetailReportsComponent` | `reports/mktreferral-reports/` | Date-range + party-filter detail report grid with Excel export. |

### 9.3 Services

| Service | Role |
|---------|------|
| `MarketingReferralService` (`Shared/marketingreferral.service.ts`) | Holds shared grid-column config (`settingsGridCols.InvoiceListGridCols`, `mktreferralReferringOrganizationListGridCols`, `mktreferralReferringPartyListGridCols`, `marketingReferralreportListGridCols`). |
| `MarketingReferralBLService` (`Shared/marketingreferral.bl.service.ts`) | Business-logic facade. Maps `CoreDLService` calls to UI-shaped `Observable<DanpheHTTPResponse>`. |
| `MarketingReferralDLService` (`Shared/marketingreferral.dl.service.ts`) | Data-layer facade. Issues `HttpClient` calls to `/api/MarketingReferral/...`. |
| `MarketingreferralSharedModule` (`Shared/marketingreferral-shared.module.ts`) | Angular `@NgModule` that re-provides the three services. (Currently empty `declarations`; the module is essentially a DI container.) |

### 9.4 Grid columns (defined in `shared/danphe-grid/grid-column-settings.constant.ts`)

- `InvoiceListGridCols` (lines 5613-5628) — date, invoice no, hospital no, patient name, age/sex, invoice amount, return amount, net amount, "Entered ?" with cell renderer `InvoiceEnteredCellRenderer` (lines 5643-5656).
- `mktreferralReferringOrganizationListGridCols` (lines 5657-5671) — name, address, contact no, contact person, is-active, action (Activate/Deactivate/Edit).
- `mktreferralReferringPartyListGridCols` (lines 5686-5704) — name, group, organization, address, vehicle, contact, area, PAN, is-active, action.
- `marketingReferralreportListGridCols` (lines 5720-5737) — 15 columns covering invoice date/no, hospital no, patient, party, group, organization, vehicle, scheme, net amount, percentage, referral amount, remarks, entered-by, entered-on.
- Cell renderer `ActivateDeactivateReferringOrganizationTemplate` (lines 5672-5685) and `ActivateDeactivateReferringPartyTemplate` (lines 5705-5718) render Activate/Deactivate/Edit anchors based on `IsActive`.
- `InvoiceNetAmountRenderer` (lines 5638-5642) and `InvoiceTotalAmountRenderer` (lines 5633-5637) format the numeric amounts to 4 decimal places.
- `InvoiceEnteredCellRenderer` (lines 5643-5656) renders the "Yes(N)" / "No(0)" cell with `danphe-grid-action="Yes"` / `danphe-grid-action="No"` hooks.

### 9.5 Autocomplete matching

The party autocomplete (`danphe-auto-complete`) is configured with:

- `display-property-name="ReferringPartyName"`
- `value-property-name="ReferringPartyName"`
- `match-property-csv="ReferringPartyName,ReferringOrganizationName,VehicleNumber,GroupName"` — search across name + org + vehicle + group.
- `min-chars=3` — at least 3 chars before suggestions appear.
- `max-num-list=15` — cap on suggestions.
- `list-formatter` shows `Name (GROUP) (VehicleNo) Organization`.

The same formatter is reused on the Reports page's party filter.

---

## 10. Gaps vs. a Real Marketing/Referral System

These are not bugs — they're intentional scope decisions in the reference. They are listed here so a migration can decide which to address and which to keep out.

- **No payout workflow.** A commission row is recorded but nothing drives an actual pay-out, no payable account, no batch approval, no bank advice.
- **No accounting integration.** No `ACC_Transactions` row is written. P&L impact of the referral cost is invisible to the books.
- **No tax handling.** PAN is captured but TDS is not computed or withheld.
- **No KYC / contract management.** No document upload, no signed-agreement tracking, no expiry.
- **No scheme CRUD UI.** Schemes are master data without an add/edit screen.
- **No party-group CRUD UI.** Same gap for party groups.
- **No edit on commission rows.** Only delete and re-add.
- **No server-side cap enforcement.** The percentage cap is a client-only check.
- **No server-side uniqueness on (invoice, scheme, party).** A determined client can submit duplicates.
- **No soft-delete on commission rows.** Hard delete only.
- **No audit trail for delete / activate-deactivate.** The audit fields are not written.
- **No reconciliation against billing returns.** If an invoice is partially returned after a commission is entered, the commission's `InvoiceNetAmount` becomes stale.
- **No reporting beyond the detail report.** No party-wise summary, no scheme-wise summary, no monthly trend, no export to accounting sub-system.
- **No multi-tenant scoping.** The migration must add `tenant_id` to every table.
- **No external referrer portal.** All entry is internal-staff only.
- **No notification when a commission is entered.** No SMS / email to the patient or the referrer.

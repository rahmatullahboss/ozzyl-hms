# Incentive Module — DanpheEMR Reference

Reference implementation: DanpheEMR (ASP.NET Core / SQL Server / Angular)
Source root: `DanpheEMR reference/Code/`
Target stack (in our HMS): Hono on Cloudflare Workers + D1 + R2 + Angular on Pages.
This document describes the reference .NET behavior so parity work has a single source of truth.

---

## 1. Module Overview

The Incentive module in DanpheEMR calculates, tracks, and pays financial incentives to doctors and other employees based on the billable services they perform, prescribe, or refer. It is an **overlay** on top of the billing module — incentives are derived from billing transactions, never from a separate financial stream. The module is the most complex piece of consultant-facing financial logic in the system, sitting at the intersection of Billing, Employee, and Accounting.

### 1.1 Functional scope

- **Profile-based incentive rules**: a Profile is a reusable template that maps a set of bill items to performer / prescriber / referrer percentage splits. Hospitals use profiles to standardize incentive policies across many employees (e.g. "All surgeons get X% performer, Y% prescriber on OR procedures").
- **Employee-specific overrides**: each employee has their own per-item mapping (`EmployeeBillItemsMap`) that takes precedence over the profile. Allows fine-grained control.
- **Item group distribution**: a single bill item's incentive can be split among multiple employees (e.g. a surgery where two surgeons and an anesthetist each get a slice).
- **Fraction generation**: a sync job materializes billing transactions into fraction rows (`IncentiveFractionItem`) — one row per (billing line item × receiver employee × incentive type).
- **Per-employee TDS**: each employee has a configurable TDS percentage applied to gross incentive.
- **Payment voucher**: accumulated unpaid fractions are paid out by posting an accounting voucher (Dr Employee Ledger, Cr Cash/Bank Ledger) and marking the fractions as paid.
- **Multiple reports**: transaction report, payment report, patient-vs-service, hospital income, referral summary.

### 1.2 Incentive types

The module recognizes four incentive types. Each fraction item carries exactly one:

| Type | Description | Source |
|------|-------------|--------|
| `performer` | The doctor who actually performed the procedure/service | `BillingTransactionItem.PerformerId` / `AssignedToEmpId` |
| `prescriber` | The doctor who prescribed/ordered the item | `BillingTransactionItem.PrescriberId` / `ReferredByEmpId` |
| `referral` | An external doctor who referred the patient (separate from prescriber) | `EmployeeBillItemsMap.ReferrerPercent` |
| `adjustment` | Manual adjustments by HR to correct prior calculations | Manually entered via UI |

### 1.3 Three-tier configuration model

```
Profile (template)                    Employee (override)               Bill Transaction (runtime)
─────────────────                     ──────────────────                ─────────────────────────
INCTV_MST_Profile                     INCTV_EmployeeIncentiveInfo       BIL_TXN_BillingTransactionItem
   ↓ PriceCategory                       ↓ EmployeeId, TDSPercent         ↓ PerformerId, PrescriberId
INCTV_BillItems_Profile_Map           INCTV_MAP_EmployeeBillItemsMap            ↓
   ↓ ServiceItem, Percents               ↓ ServiceItem, Percents      INCTV_TXN_IncentiveFractionItem
                                            ↓                             ↓ Receiver, Type, Amount
                                      INCTV_CFG_ItemGroupDistribution   INCTV_TXN_PaymentInfo
                                          ↓ Group splits                ↓ Voucher, TDS, NetPay
```

### 1.4 Hospital workflow served

1. Admin creates a Profile per doctor archetype (e.g. "Cardiologist", "General Surgeon") with default percentage splits.
2. Admin configures per-employee mappings, overriding profiles where needed. Optional: split items into group distributions for shared procedures.
3. Reception bills a patient; the bill line carries `PerformerId` and `PrescriberId` from the appointment / EMR entry.
4. Nightly (or on-demand) the BillSync stored proc materializes eligible bill items into `IncentiveFractionItem` rows.
5. HR reviews the fractions, edits/adjusts as needed, and groups them by employee for payment.
6. HR makes a payment: posts an accounting voucher (Dr employee ledger, Cr cash/bank) and marks all included fractions as `IsPaymentProcessed = true`.
7. Reports are pulled for finance reconciliation.

### 1.5 Architectural notes and gaps

- The module reuses billing tables (`BIL_MST_ServiceItem`, `BIL_TXN_BillingTransactionItem`, `BIL_CFG_PriceCategory`) via cross-context DbSets. No billing data is owned by Incentive.
- `IncentiveDbContext` is constructed per-request from the connection string — no DI, no service layer. The only shared logic is in `IncentiveBL.cs` (static methods).
- The "sync" path uses two stored procedures that read from `BIL_TXN_BillingTransactionItem` and write to `INCTV_TXN_IncentiveFractionItem`. This is the closest the module comes to a batch job.
- The module is **dual-purpose**: 50% config UI (profile/employee setup) and 50% transactional UI (fractions, payments, reports). The transactional UI is far less mature — the controller has many commented-out code paths, especially in the legacy `Get`/`Post`/`Put` methods that discriminate by `reqType`.
- **No employee onboarding workflow** — there is no concept of "new consultant triggers incentive setup" or "leave triggers incentive recalc." Configuration is fully manual.
- **No payroll integration** — incentive payments are independent of salary runs. The module does not post to Payroll or interact with `Payroll` controllers in any way.
- **No scheduled jobs** — the sync is always on-demand via a button click. There is no cron/queue.
- **No tenant isolation** — the controllers do not filter by hospital; this is a single-hospital implementation.

Key file paths:
- Backend controllers: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Incentive/`
- Server models: `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/IncentiveModels/`
- DB context: `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/IncentiveDbContext.cs`
- Business logic: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Incentive/IncentiveBL.cs`
- Frontend: `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/incentive/`
- Accounting integration: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Accounting/AccountingController.cs` (`PostIncentivePaymentVoucher`)
- Accounting transfer: `DanpheEMR reference/Code/Components/DanpheEMR.AccTransfer/Accounting/AccountingTransferData.cs` (`IncetiveTxnDateWise`)

---

## 2. Backend Files

### 2.1 Controllers

| File | Purpose |
|------|---------|
| `Controllers/Incentive/IncentiveController.cs` | Primary REST controller. Modern route-based endpoints. 1928 lines. |
| `Controllers/Incentive/IncentiveBL.cs` | Static business-logic helpers (profile creation, item mapping, group distribution, billing item updates). 371 lines. |
| `Controllers/Accounting/AccountingController.cs` | Owns `POST /api/Accounting/IncentivePayment` (voucher posting + `INCTV_TXN_PaymentInfo` insert) and the `SP_INCTV_PaymentInfo_Update` stored proc call. |

The legacy `Get`/`Post`/`Put` methods (lines 880–1924 of `IncentiveController.cs`) that discriminate by `reqType` are mostly **commented out or unused** in production; the new route-based endpoints (lines 30–410) are the canonical API. Both styles exist for backward compatibility with older frontends.

### 2.2 Key methods in `IncentiveController.cs`

| Method | HTTP route | Purpose |
|--------|------------|---------|
| `Profiles` | `GET /api/Incentive/Profiles` | Lists all profiles joined with price category. |
| `Categories` | `GET /api/Incentive/Categories` | Lists active price categories from `BIL_CFG_PriceCategory`. |
| `ProfileItems` | `GET /api/Incentive/ProfileItems` | Lists bill service items (active only) for use in profile mapping. |
| `ProfileItemsMapping` | `GET /api/Incentive/ProfileItemsMapping?profileId=` | Returns a profile with its full item-mapping list. |
| `EmployeesIncentiveInfo` | `GET /api/Incentive/EmployeesIncentiveInfo` | Lists all employees with their TDS and incentive info, joined with employee name. |
| `IncentiveItems` | `GET /api/Incentive/IncentiveItems?priceCategoryId=` | Lists bill items eligible for incentive (filtered by `IsIncentiveApplicable=true` and price category). |
| `EmployeeBillItems` | `GET /api/Incentive/EmployeeBillItems?employeeId=` | Returns one employee's incentive setup (TDS + every mapped bill item + each item's group distribution). |
| `TransactionItems` | `GET /api/Incentive/TransactionItems?fromDate=&toDate=` | Calls `SP_INCTV_GetBillingTxnItems_BetweenDate` — bill line items ready to be fractioned. |
| `TransactionInvoices` | `GET /api/Incentive/TransactionInvoices?fromDate=&toDate=&employeeId=` | Calls `SP_INCTV_ViewTxn_InvoiceLevel` — invoice-level view for the fraction list. |
| `TransactionInvoiceItems` | `GET /api/Incentive/TransactionInvoiceItems?BillingTransactionId=` | Calls `SP_INCTV_ViewTxn_InvoiceItemLevel` — line items of one invoice plus their existing fractions. Returns two result sets. |
| `FractionOfBillTransactionItems` | `GET /api/Incentive/FractionOfBillTransactionItems?billTxnItemId=` | Calls `SP_INCTV_GetFractionItems_ByTxnItemId` — existing fractions for one bill line. |
| `IncentiveApplicableDoctors` | `GET /api/Incentive/IncentiveApplicableDoctors` | Lists employees with `IsActive=true AND IsIncentiveApplicable=true`. |
| `AddProfile` (route `Profile`) | `POST /api/Incentive/Profile` | Creates a new profile; optionally copies items from `AttachedProfileId`. |
| `MapProfileItems` | `POST /api/Incentive/MapProfileItems` | Bulk upserts `INCTV_BillItems_Profile_Map` rows for a profile. |
| `MapEmployeeBillItems` | `POST /api/Incentive/MapEmployeeBillItems` | Creates/updates `EmployeeIncentiveInfo` and its `EmployeeBillItemsMap` children. Wraps in transaction. |
| `ActivateDeactivateEmployeeSetup` | `POST /api/Incentive/ActivateDeactivateEmployeeSetup` | Flips IsActive on employee info + all its mappings + their group distributions. |
| `EmployeeBillItem` (route `EmployeeBillItems`) | `POST /api/Incentive/EmployeeBillItems` | Updates one `EmployeeBillItemsMap` row's percentages and OPD/IPD applicability. |
| `ProfileBillItemMap` | `POST /api/Incentive/ProfileBillItemMap` | Updates one `ProfileItemMap` row's percentages. |
| `RemoveBillItem` | `POST /api/Incentive/RemoveBillItem` | Soft-deletes an employee-bill-item mapping and removes all its group distributions. |
| `RemoveBillItemFromProfileMap` | `POST /api/Incentive/RemoveBillItemFromProfileMap` | Soft-deletes a profile-bill-item mapping. |
| `ItemsGroupDistribution` | `POST /api/Incentive/ItemsGroupDistribution` | Replaces the entire group distribution for one employee-bill-item mapping. |
| `FractionItems` | `POST /api/Incentive/FractionItems` | Bulk insert/update of `INCTV_TXN_IncentiveFractionItem` rows. |
| `Transactions` (route `Transactions`) | `POST /api/Incentive/Transactions?fromDate=&toDate=` | Triggers `SP_INCTV_BulkInsert_FractionItemsFromBillTxnItem_InDateRange` (+ return SP) to materialize fractions. |
| `ActivateDeactivateProfile` | `POST /api/Incentive/ActivateDeactivateProfile` | Flips `IsActive` on a profile. |
| `UpdateProfile` (route `Profile`) | `PUT /api/Incentive/Profile` | Updates profile name and description. |
| `BillTransactionItems` | `PUT /api/Incentive/BillTransactionItems` | Updates `PerformerId`/`PrescriberId` on `BIL_TXN_BillingTransactionItem` so the next sync uses the new values. |
| `IncentivePayment` (Accounting controller) | `POST /api/Accounting/IncentivePayment?transactionObj=` | Posts a payment voucher and creates an `INCTV_TXN_PaymentInfo` row. Triggers `SP_INCTV_PaymentInfo_Update`. |

### 2.3 Key methods in `IncentiveBL.cs`

| Method | Purpose |
|--------|---------|
| `AddEmployeeProfile` | Wraps a new profile insert; if `AttachedProfileId` is set, copies that profile's items into the new one. All in one transaction. |
| `ProfileItemMapping` | Loops `List<ProfileItemMap>` and calls `InsertUpdateProfileItemMap` per item. |
| `InsertUpdateProfileItemMap` | If `BillItemProfileMapId != 0` → update existing. Else → insert. |
| `AddProfileMaster` | Inserts the profile row, returns the new ProfileId. |
| `EmployeeItemMapping` | Loops `List<EmployeeBillItemsMap>` and calls `InsertUpdateEmployeeItemMap` per item. |
| `InsertUpdateEmployeeItemMap` | If `EmployeeBillItemsMapId` exists OR a duplicate `(ServiceItemId, EmployeeId, PriceCategoryId)` is found → update. Else insert. |
| `InsertUpdateItemGroupDistribution` | For each row: if IsActive=false → remove; if new (Id=0) → insert; else update. Then sets `HasGroupDistribution` flag based on row count. |
| `UpdateBillingTransactionItems` | Updates `PerformerId`, `PerformerName`, `PrescriberId` on a `BillingTransactionItemModel`. Wraps in transaction. |

### 2.4 Stored procedures used

| Procedure | Purpose | Caller |
|-----------|---------|--------|
| `SP_INCTV_GetBillingTxnItems_BetweenDate` | Returns bill line items between dates that are eligible for incentive. | `TransactionItems` |
| `SP_INCTV_ViewTxn_InvoiceLevel` | Invoice-level summary for the fraction list. | `TransactionInvoices` |
| `SP_INCTV_ViewTxn_InvoiceItemLevel` | Line items + their fractions for one invoice (two result sets). | `TransactionInvoiceItems` |
| `SP_INCTV_GetFractionItems_ByTxnItemId` | Existing fractions for one bill line. | `FractionOfBillTransactionItems` |
| `SP_INCTV_BulkInsert_FractionItemsFromBillTxnItem_InDateRange` | Materializes bill line items into fraction rows for a date range. | `Transactions` |
| `SP_INCTV_BulkInsert_FractionItemsFromBillTxnItem_Return_InDateRange` | Same for returned bill items. | `Transactions` |
| `SP_INCTV_PaymentInfo_Update` | Marks fractions as paid by `PaymentInfoId` for the given date range + employee. | `PostIncentivePaymentVoucher` |
| `SP_INCTV_ACC_GetTransactionInfoForAccTransfer` | Fetches incentive transactions for accounting daily transfer. | `AccountingTransferData.IncetiveTxnDateWise` |
| `SP_INCTV_Report_Hospital_Income` | Hospital income report data. | `ReportingDbContext` |
| `SP_INCTV_Report_ServiceDepartmentWise_Hospital_Income` | Same, grouped by service department. | `ReportingDbContext` |
| `SP_INCTV_DocterItemSummary` (BillingReports) | Per-doctor item summary for the payment screen. | Frontend |
| `SP_INCTV_ACC_GetTransactionInfoForAccTransfer` | Fetches daily incentive transactions for the daily transfer to accounting. | `AccountingTransferData` |

---

## 3. Data Models

All models live in `Code/Components/DanpheEMR.ServerModel/IncentiveModels/`.

### 3.1 `ProfileModel` → `INCTV_MST_Profile`

Reusable incentive template scoped to a price category.

| Field | Type | Notes |
|-------|------|-------|
| `ProfileId` | `int` | PK. |
| `ProfileName` | `string` | Display name. |
| `PriceCategoryId` | `int` | FK to `BIL_CFG_PriceCategory`. |
| `IsActive` | `bool` | Soft-delete flag. |
| `TDSPercentage` | `double?` | Default TDS for this profile (applied when no employee-level override). |
| `Description` | `string` | Free text. |
| `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` | audit | |
| `PriceCategoryName` | `string` (NotMapped) | Joined display field. |
| `AttachedProfileId` | `int?` (NotMapped) | If set on create, copies items from this source profile. |

### 3.2 `ProfileItemMap` → `INCTV_BillItems_Profile_Map`

Profile → bill item percentage mapping.

| Field | Type | Notes |
|-------|------|-------|
| `BillItemProfileMapId` | `int` | PK. |
| `BillItemPriceId` | `int?` | Legacy link to old `BIL_MST_BillItemPrice`. Nullable now. |
| `ProfileId` | `int` | FK to `INCTV_MST_Profile`. |
| `ServiceItemId` | `int` | FK to `BIL_MST_ServiceItem`. |
| `PerformerPercent` | `double` | % going to the doctor who performs the procedure. |
| `PrescriberPercent` | `double` | % going to the doctor who prescribed it. |
| `ReferrerPercent` | `double?` | % going to the referral doctor. Added 20 Jun 2022. |
| `PriceCategoryId` | `int` | FK to `BIL_CFG_PriceCategory`. |
| `BillingTypesApplicable` | `string` | `"inpatient"`, `"outpatient"`, or `"both"`. |
| `IsActive` | `bool` | |
| `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` | audit | |

### 3.3 `EmployeeIncentiveInfo` → `INCTV_EmployeeIncentiveInfo`

Header record for one employee's incentive setup.

| Field | Type | Notes |
|-------|------|-------|
| `EmployeeIncentiveInfoId` | `int` | PK. |
| `EmployeeId` | `int` | FK to `EMP_Employee`. |
| `TDSPercent` | `double?` | Employee-level TDS override. If null, falls back to the employee record's `TDSPercent`. |
| `CreatedBy` / `CreatedOn` | audit | |
| `IsActive` | `bool` | Master switch — if false, no fractions are generated for this employee. |
| `EmployeeBillItemsMap` | `List<EmployeeBillItemsMap>` (NotMapped) | Eager-loaded children. |

### 3.4 `EmployeeBillItemsMap` → `INCTV_MAP_EmployeeBillItemsMap`

Employee → bill item percentage mapping. Overrides the profile.

| Field | Type | Notes |
|-------|------|-------|
| `EmployeeBillItemsMapId` | `int` | PK. |
| `EmployeeId` | `int` | FK to `EMP_Employee`. |
| `ServiceItemId` | `int` | FK to `BIL_MST_ServiceItem`. |
| `BillItemPriceId` | `int?` | Legacy link. |
| `PerformerPercent` | `double?` | Renamed from `AssignedToPercent` (20 Jun 2022). |
| `PrescriberPercent` | `double?` | Renamed from `ReferredByPercent` (20 Jun 2022). |
| `ReferrerPercent` | `double?` | Added 20 Jun 2022. |
| `PriceCategoryId` | `int` | FK to `BIL_CFG_PriceCategory`. |
| `HasGroupDistribution` | `bool?` | If true, `ItemGroupDistribution` rows exist for this item. |
| `BillingTypesApplicable` | `string` | `"inpatient"` / `"outpatient"` / `"both"`. |
| `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` | audit | |
| `IsActive` | `bool` | |
| `GroupDistribution` | `List<ItemGroupDistribution>` (NotMapped) | Eager-loaded children. |

### 3.5 `ItemGroupDistribution` → `INCTV_CFG_ItemGroupDistribution`

Splits one employee-bill-item's incentive among multiple employees.

| Field | Type | Notes |
|-------|------|-------|
| `ItemGroupDistributionId` | `int` | PK. |
| `IncentiveType` | `string` | `"performer"`, `"prescriber"`, `"referral"`, `"adjustment"`. |
| `BillItemPriceId` | `int` | Legacy link. |
| `ServiceItemId` | `int?` | FK to `BIL_MST_ServiceItem`. |
| `EmployeeBillItemsMapId` | `int` | FK to `INCTV_MAP_EmployeeBillItemsMap`. |
| `FromEmployeeId` | `int` | The "owner" employee whose mapping this distribution belongs to. |
| `DistributeToEmployeeId` | `int` | The actual receiver of this slice. |
| `DistributionPercent` | `double?` | Slice of the employee's total percent. |
| `FixedDistributionAmount` | `double?` | Optional fixed amount override. |
| `IsFixedAmount` | `bool?` | If true, use `FixedDistributionAmount` instead of `DistributionPercent`. |
| `DisplaySeq` | `int?` | UI ordering. |
| `Remarks` | `string` | |
| `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` | audit | |
| `IsActive` | `bool` | |

### 3.6 `IncentiveFractionItemModel` → `INCTV_TXN_IncentiveFractionItem`

A unit of incentive payable to one employee from one bill line item. This is the workhorse table.

| Field | Type | Notes |
|-------|------|-------|
| `InctvTxnItemId` | `int` | PK. |
| `InvoiceNoFormatted` | `string` | Denormalized for display. |
| `TransactionDate` | `DateTime` | Date of the underlying bill. |
| `PriceCategory` | `string` | Denormalized. |
| `BillingTransactionId` | `int?` | FK to `BIL_TXN_BillingTransaction`. |
| `BillingTransactionItemId` | `int` | FK to `BIL_TXN_BillingTransactionItem`. |
| `PatientId` | `int` | |
| `BillItemPriceId` | `int?` | Legacy. |
| `ItemName` | `string` | Denormalized. |
| `TotalBillAmount` | `double?` | The bill line's total. |
| `IncentiveType` | `string` | `"performer"` / `"prescriber"` / `"referral"` / `"adjustment"`. |
| `IncentiveReceiverId` | `int` | The employee to be paid. |
| `IncentiveReceiverName` | `string` | Denormalized. |
| `FinalIncentivePercent` | `double` | % applied to `TotalBillAmount`. |
| `InitialIncentivePercent` | `double` | Snapshot of original % (preserved through edits). |
| `IncentiveAmount` | `double` | `TotalBillAmount * FinalIncentivePercent / 100`. |
| `TDSPercentage` | `double?` | Applied at fraction time, snapshot from employee record. |
| `TDSAmount` | `double?` | `IncentiveAmount * TDSPercentage / 100`. |
| `IsPaymentProcessed` | `bool?` | Set true when included in a payment. |
| `PaymentInfoId` | `int?` | FK to `INCTV_TXN_PaymentInfo` (nullable until paid). |
| `IsMainDoctor` | `bool` | True if this fraction is for the assigned doctor (vs a group-distributed slice). |
| `Quantity` | `double?` | Bill line quantity. |
| `ServiceItemId` | `int?` | |
| `BillReturnItemId` | `int?` | For multiple invoice-item returns handling. |
| `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` | audit | |
| `IsActive` | `bool?` | Soft delete — inactive fractions are not paid and not counted. |

### 3.7 `PaymentInfoModel` → `INCTV_TXN_PaymentInfo`

One row per payment voucher. Groups all fractions paid together.

| Field | Type | Notes |
|-------|------|-------|
| `PaymentInfoId` | `int` | PK. |
| `PaymentDate` | `DateTime` | When the payment was made. |
| `ReceiverId` | `int` | The employee who was paid. |
| `TotalAmount` | `float` | Gross amount (sum of fraction amounts). |
| `TDSAmount` | `float` | Total TDS deducted. |
| `NetPayAmount` | `float` | Net paid (`TotalAmount - TDSAmount`). |
| `AdjustedAmount` | `float` | Voucher amount adjustment (e.g. partial payment). |
| `IsPostedToAccounting` | `bool` | True if the accounting voucher was posted. |
| `AccountingPostedDate` | `DateTime?` | |
| `CreatedBy` / `CreatedOn` | audit | |
| `IsActive` | `bool` | |
| `VoucherNumber` | `string` | Joined from `ACC_Transactions`. |
| `Remarks` | `string` | Voucher narration. |
| `FromDate` / `ToDate` / `EmployeeId` | NotMapped | Filter window for the payment. |

### 3.8 `ConsultantIncentiveModel`

Lightweight model used by some legacy report paths. No corresponding table.

| Field | Type |
|-------|------|
| `ReferenceIds` | `string` |
| `EmployeeId` | `int?` |
| `EmployeeName` | `string` |
| `TransactionDate` | `DateTime?` |
| `TransactionType` | `string` |
| `TotalAmount` | `double?` |
| `TotalTDS` | `double?` |
| `Remarks` | `string` |
| `VoucherId` | `int` |
| `VoucherName` | `string` |

### 3.9 `IncentiveTransactionItemsVM`

View model for the invoice-level fraction list page. Not a table.

| Field | Type |
|-------|------|
| `TransactionDate` | `DateTime` |
| `InvoiceNo` | `string` |
| `PriceCategory` | `string` |
| `BillingTransactionId` | `int` |
| `BillingTransactionItemId` | `int` |
| `PatientId` / `PatientName` / `PatientCode` | denormalized patient |
| `ItemName` | `string` |
| `TotalAmount` | `float?` |
| `ReferredByEmpId` / `ReferredByEmpName` / `ReferredByPercent` / `ReferralAmount` | prescriber split |
| `AssignedToEmpId` / `AssignedToEmpName` / `AssignedToPercent` / `AssignedToAmount` | performer split |
| `ServiceItemId` | `int?` |
| `PriceCategoryId` / `PriceCategoryName` | |

---

## 4. Database Tables

The incentive module owns 8 tables, all prefixed `INCTV_`. Mappings are in `IncentiveDbContext.OnModelCreating` (`DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/IncentiveDbContext.cs:38`).

| Table | Model | PK | Notes |
|-------|-------|-----|-------|
| `INCTV_MST_Profile` | `ProfileModel` | `ProfileId` | Reusable profile template. |
| `INCTV_BillItems_Profile_Map` | `ProfileItemMap` | `BillItemProfileMapId` | Profile → bill item with per-type percentages. |
| `INCTV_EmployeeIncentiveInfo` | `EmployeeIncentiveInfo` | `EmployeeIncentiveInfoId` | One row per employee with incentive active. |
| `INCTV_MAP_EmployeeBillItemsMap` | `EmployeeBillItemsMap` | `EmployeeBillItemsMapId` | Employee → bill item percentages. |
| `INCTV_CFG_ItemGroupDistribution` | `ItemGroupDistribution` | `ItemGroupDistributionId` | Splits within one employee-bill-item mapping. |
| `INCTV_TXN_IncentiveFractionItem` | `IncentiveFractionItemModel` | `InctvTxnItemId` | The workhorse: one row per receiver per bill line. |
| `INCTV_TXN_PaymentInfo` | `PaymentInfoModel` | `PaymentInfoId` | One row per payment voucher. |

Read-only cross-context references used by the module:
- `BIL_MST_ServiceItem` (joined for item names and pricing)
- `BIL_MST_ServiceDepartment` (joined for department names)
- `BIL_CFG_PriceCategory` (price categories)
- `BIL_TXN_BillingTransactionItem` (source of fractions, and updated on `PerformerId`/`PrescriberId` edits)
- `EMP_Employee` (joined for employee name; `IsIncentiveApplicable` and `TDSPercent` come from here)
- `ACC_MST_LedgerGroup`, `ACC_Ledger`, `ACC_Ledger_Mapping` (used by payment posting to identify the employee ledger)

### 4.1 Indexes and constraints

The model classes do not define any explicit indexes or unique constraints. Recommended indexes for parity work (inferred from query patterns):

- `INCTV_MAP_EmployeeBillItemsMap (EmployeeId, ServiceItemId, PriceCategoryId)` — enforces the dedup check in `InsertUpdateEmployeeItemMap` and speeds up `GetEmployeeBillItemsList`.
- `INCTV_TXN_IncentiveFractionItem (BillingTransactionItemId)` — drives `SP_INCTV_GetFractionItems_ByTxnItemId`.
- `INCTV_TXN_IncentiveFractionItem (IsPaymentProcessed, IsActive)` — drives the unpaid-fractions filter for payment.
- `INCTV_TXN_PaymentInfo (ReceiverId, PaymentDate)` — drives the payment report.

---

## 5. Key Workflows

### 5.1 Profile management (admin setup)

1. Admin navigates to `Incentive/Setting/ProfileManage`.
2. `GET /api/Incentive/Profiles` lists existing profiles. Grid actions: Rename, Edit Items Percentage, Activate/Deactivate.
3. **Add Profile**: `POST /api/Incentive/Profile` (route `Profile`). The `IncentiveBL.AddEmployeeProfile` call optionally accepts `AttachedProfileId`; if set, it copies that profile's item mappings into the new one (so a "Cardiologist 2026" can be cloned from "Cardiologist 2025"). The whole thing runs in one transaction.
4. **Edit Items Percent**: `POST /api/Incentive/MapProfileItems` upserts a list of `ProfileItemMap` rows. The frontend allows editing Performer/Prescriber/Referrer percentages and the OPD/IPD/Both applicability flag.
5. **Rename Profile**: `PUT /api/Incentive/Profile` updates `ProfileName` and `Description`. Note: cannot change `PriceCategoryId` or `TDSPercentage` here (those fields' setters are commented out in the controller).
6. **Deactivate Profile**: `POST /api/Incentive/ActivateDeactivateProfile` flips `IsActive` to false. A deactivated profile still exists but no new fractions are generated from it.

### 5.2 Employee incentive setup

1. Admin navigates to `Incentive/Setting/EmployeeItemsSetup`.
2. `GET /api/Incentive/EmployeesIncentiveInfo` lists employees and their `EmployeeIncentiveInfo` row (if any).
3. **Add new employee setup**: Pick an employee, optionally attach a profile (loads its items into the working list), then add/edit item percentages, then save.
4. `POST /api/Incentive/MapEmployeeBillItems` (route) is called. The controller:
   - If `EmployeeIncentiveInfoId != 0` → updates the existing info row's `TDSPercent` and `IsActive`.
   - Else creates a new `EmployeeIncentiveInfo` row.
   - In both cases, calls `IncentiveBL.EmployeeItemMapping` to upsert the `EmployeeBillItemsMap` list.
   - All wrapped in a transaction.
5. **Edit per-item percentages**: `POST /api/Incentive/EmployeeBillItems` updates one mapping.
6. **Group distribution**: When `HasGroupDistribution=true` for an item, the employee can split their performer percent into multiple sub-receivers via `POST /api/Incentive/ItemsGroupDistribution`. The backend replaces the entire group-distribution list atomically. Sum of group distribution percentages cannot exceed 100% (enforced client-side in `SaveItemGroupDistribution`).
7. **Deactivate employee setup**: `POST /api/Incentive/ActivateDeactivateEmployeeSetup` cascades: info row + all bill-item mappings + all their group distributions.
8. **Remove a bill item**: `POST /api/Incentive/RemoveBillItem` soft-deletes (`IsActive=false`) the employee-bill-item mapping and hard-deletes all its group-distribution rows.

### 5.3 Bill sync (fraction generation)

The critical workflow that turns billing data into incentive fractions.

1. Admin/HR navigates to `Incentive/Transactions/BillSync` (`INCTV_LoadFractionFromBilling` component).
2. Picks a `fromDate` and `toDate`.
3. Clicks "Load up-to-date fraction transactions".
4. Frontend calls `POST /api/Incentive/Transactions?fromDate=&toDate=` (no body).
5. Controller calls two stored procs:
   - `SP_INCTV_BulkInsert_FractionItemsFromBillTxnItem_InDateRange` — for sales within the range.
   - `SP_INCTV_BulkInsert_FractionItemsFromBillTxnItem_Return_InDateRange` — for returns within the range.
6. Each proc reads `BIL_TXN_BillingTransactionItem` rows that:
   - Have a `PerformerId` or `PrescriberId`.
   - Are linked to a service item with `IsIncentiveApplicable = true`.
   - Belong to an employee with `IsIncentiveApplicable = true` and an active `EmployeeIncentiveInfo` row.
   - Have an `EmployeeBillItemsMap` entry for that `(ServiceItemId, EmployeeId, PriceCategoryId)` (or fall back to a Profile mapping).
7. The proc materializes `INCTV_TXN_IncentiveFractionItem` rows. For each bill line × receiver × incentive type combination, a fraction row is created. TDS is applied using the employee's `TDSPercent`.
8. **Idempotency**: The procs are designed to not duplicate — but the controller does no client-side guard. Calling sync twice in the same date range may produce duplicates (mitigated only by the stored proc's own logic, which is not visible from the controller).

### 5.4 Fraction review and edit

1. HR navigates to `Incentive/Transactions/InvoiceItemLevel` (`INCTV_BillTxnItemListComponent`).
2. `GET /api/Incentive/TransactionItems?fromDate=&toDate=` calls `SP_INCTV_GetBillingTxnItems_BetweenDate` and shows a grid of bill line items with a "Fraction?" indicator (orange "NO (0)" or green "YES(N)").
3. Clicking a row opens the **Edit Fraction** popup (`INCTV_EditFractionComponent`):
   - Loads existing fractions via `GET /api/Incentive/FractionOfBillTransactionItems?billTxnItemId=`.
   - Shows one row per (receiver × incentive type). Defaults: performer, prescriber; can add referral or adjustment.
   - For each row, the employee selector auto-fills the percentage from the employee's `EmployeeBillItemsMap` (via `GetEmployeeBillItemsList` → `AssignPercentage`). If the item has a group distribution, the percent is taken from the group distribution row matching the selected employee.
4. User edits percentages, optional `ReferralPercent`, adds/removes rows. The `OnIncentivePercentChange` recalculates `IncentiveAmount` (and `RemainingAmount` if referral is enabled).
5. **Save** → `POST /api/Incentive/FractionItems` (route `FractionItems`) → controller upserts each fraction (inserts new, updates existing). Active fractions' total percent must be ≤ 100 (client-side validation).
6. If the user changed the billing item's `PerformerId` or `PrescriberId` in this dialog, the controller also calls `PUT /api/Incentive/BillTransactionItems` to persist the new performer/prescriber on the underlying bill.

### 5.5 Invoice-level fraction list

1. HR navigates to `Incentive/Transactions/InvoiceLevel` (`IncentiveTxnInvoiceListComponent`).
2. `GET /api/Incentive/TransactionInvoices?fromDate=&toDate=` returns invoice-level summary (one row per invoice).
3. Selecting an invoice calls `GET /api/Incentive/TransactionInvoiceItems?BillingTransactionId=` which returns two result sets: line items + their existing fractions.
4. The component shows line items in a grid. Clicking a line item opens the same Edit Fraction popup.

### 5.6 Payment (payout)

1. HR navigates to `Incentive/Transactions/MakePayment` (`INCTV_BIL_IncentivePaymentInfoComponent`).
2. Picks an employee, `fromDate`, `toDate`.
3. Clicks "Load Summary" → calls `/BillingReports/INCTV_DocterItemSummary?FromDate=&ToDate=&employeeId=` (this is a Reporting endpoint, not Incentive) which returns per-item incentive details (performer/prescriber/referral/adjustment) for unpaid fractions.
4. Component shows a summary panel:
   - Performer: total bill amount, total incentive, total TDS, net payable.
   - Prescriber: same.
   - Referral: same.
   - Adjustment: same.
   - Grand totals.
5. User enters a "Voucher Amount" (the actual cash paid). The `adjustedAmount` = `totalNetPayable - voucherAmount` represents carry-forward.
6. User picks a credit ledger (e.g. "Cash", "Bank") and confirms the employee has a debit ledger in accounting (`LoadAllEmployeeLedgerList` → `GetLedgerListOfEmployee`).
7. Clicks Make Payment:
   - Frontend builds a `TransactionModel` with two lines: Dr `Employee Ledger` (amount = `voucherAmount`), Cr `Cash/Bank Ledger` (amount = `voucherAmount`).
   - Frontend builds a `PaymentInfoModel` (PaymentDate, ReceiverId, TotalAmount, TDSAmount, NetPayAmount, AdjustedAmount, FromDate, ToDate, EmployeeId).
   - Calls `POST /api/Accounting/IncentivePayment?transactionObj=<transactionJSON>` with `PaymentInfoModel` in the body.
8. Controller (`PostIncentivePaymentVoucher`):
   - Creates the accounting transaction (`TransactionType = "IncentivePayment"`, `VoucherId` from voucher code `pmtv`, voucher number auto-generated).
   - Inserts an `INCTV_TXN_PaymentInfo` row.
   - Calls `SP_INCTV_PaymentInfo_Update(FromDate, ToDate, EmployeeId, PaymentInfoId)` which marks all matching unpaid fractions as `IsPaymentProcessed = true, PaymentInfoId = newId`.
   - Returns `{ VoucherNumber, FiscalYearId }` to the frontend.

### 5.7 Daily accounting transfer (background)

1. Accounting module has a daily transfer job.
2. `AccountingTransferData.IncetiveTxnDateWise(SelectedDate, HospitalId)` calls `SP_INCTV_ACC_GetTransactionInfoForAccTransfer` which returns incentive transactions for that date.
3. The accounting side consumes these as part of the daily transfer.

### 5.8 OPD/IPD filter (Incentive-specific parameter)

A core parameter `Incentive/IncentiveOpdIpdSettings` controls whether the OPD/IPD selection appears in the employee item setup. When `EnableOpdIpd=true`, the grid shows an extra `BillingTypesApplicable` column and the save form requires OPD/IPD selection per item.

---

## 6. API Endpoints

### 6.1 GET endpoints (read)

| # | Method | Route | Purpose |
|---|--------|-------|---------|
| 1 | `GET` | `/api/Incentive/Profiles` | List all profiles. |
| 2 | `GET` | `/api/Incentive/Categories` | List active price categories. |
| 3 | `GET` | `/api/Incentive/ProfileItems` | List bill items for profile mapping. |
| 4 | `GET` | `/api/Incentive/ProfileItemsMapping?profileId=` | One profile + its mapped items. |
| 5 | `GET` | `/api/Incentive/EmployeesIncentiveInfo` | List employees with incentive info. |
| 6 | `GET` | `/api/Incentive/IncentiveItems?priceCategoryId=` | List incentive-applicable items for a price category. |
| 7 | `GET` | `/api/Incentive/EmployeeBillItems?employeeId=` | One employee's setup with mappings and group distributions. |
| 8 | `GET` | `/api/Incentive/TransactionItems?fromDate=&toDate=` | Bill line items in date range (for fraction list). |
| 9 | `GET` | `/api/Incentive/TransactionInvoices?fromDate=&toDate=&employeeId=` | Invoice-level view. |
| 10 | `GET` | `/api/Incentive/TransactionInvoiceItems?BillingTransactionId=` | Line items + fractions of one invoice. |
| 11 | `GET` | `/api/Incentive/FractionOfBillTransactionItems?billTxnItemId=` | Existing fractions for one bill line. |
| 12 | `GET` | `/api/Incentive/IncentiveApplicableDoctors` | List incentive-applicable employees. |
| 13 | `GET` | `/api/Accounting/EmployeeLedgers` | List employee ledgers (for payment). |
| 14 | `GET` | `/api/Accounting/Ledgers` | List all ledgers (for payment credit). |
| 15 | `GET` | `/api/billing/BillCfgItems` | List bill config items. |
| 16 | `GET` | `/BillingReports/INCTV_DocterItemSummary?FromDate=&ToDate=&employeeId=` | Per-doctor item summary report. |
| 17 | `GET` | `/ReportingNew/ExportToExcel_INCTV_InvoiceItemLevel?FromDate=&ToDate=` | Excel export of invoice-item-level fractions. |
| 18 | `GET` | `/api/Accounting?reqType=acc-get-employee-ledger-list` (legacy) | List employee ledgers. |
| 19 | `GET` | `/api/Incentive?reqType=GetEmpIncentiveInfo` (legacy) | Active employees with TDS. |
| 20 | `GET` | `/api/Incentive?reqType=incentive-applicable-docter-list` (legacy) | Same as #12. |

### 6.2 POST endpoints (write)

| # | Method | Route | Purpose |
|---|--------|-------|---------|
| 1 | `POST` | `/api/Incentive/Profile` | Create profile. |
| 2 | `POST` | `/api/Incentive/MapProfileItems` | Bulk upsert profile-item mappings. |
| 3 | `POST` | `/api/Incentive/MapEmployeeBillItems` | Upsert employee incentive info + items. |
| 4 | `POST` | `/api/Incentive/ActivateDeactivateEmployeeSetup` | Cascade activate/deactivate employee setup. |
| 5 | `POST` | `/api/Incentive/EmployeeBillItems` | Update one employee-bill-item mapping. |
| 6 | `POST` | `/api/Incentive/ProfileBillItemMap` | Update one profile-bill-item mapping. |
| 7 | `POST` | `/api/Incentive/RemoveBillItem` | Soft-delete + cascade remove group distributions. |
| 8 | `POST` | `/api/Incentive/RemoveBillItemFromProfileMap` | Soft-delete profile-bill-item mapping. |
| 9 | `POST` | `/api/Incentive/ItemsGroupDistribution` | Replace group distribution for one mapping. |
| 10 | `POST` | `/api/Incentive/FractionItems` | Bulk insert/update fractions. |
| 11 | `POST` | `/api/Incentive/Transactions?fromDate=&toDate=` | Trigger bill sync (materialize fractions). |
| 12 | `POST` | `/api/Incentive/ActivateDeactivateProfile` | Activate/deactivate a profile. |
| 13 | `POST` | `/api/Accounting/IncentivePayment?transactionObj=` | Post payment voucher + create PaymentInfo. |

### 6.3 PUT endpoints (update)

| # | Method | Route | Purpose |
|---|--------|-------|---------|
| 1 | `PUT` | `/api/Incentive/Profile` | Update profile name + description. |
| 2 | `PUT` | `/api/Incentive/BillTransactionItems` | Update `PerformerId`/`PrescriberId` on bill items. |

### 6.4 Legacy `reqType` endpoints (deprecated, many commented out)

The controller has the following legacy `reqType` discriminators still in the source (lines 880–1924 of `IncentiveController.cs`). They are mostly unused but kept for backward compatibility with older clients:

`profileList`, `categoryList`, `empWithProfileMap`, `empWithoutProfileMap`, `profileListForMapping`, `activeProfileList`, `getItemsforProfile`, `getProfileItemsMapping`, `getEmployeeIncentiveInfo`, `getItemsForIncentive`, `getEmployeeBillItemsList`, `view-txn-items-list`, `view-txn-InvoiceLevel`, `view-txn-InvoiceItemLevel`, `get-fractionof-billtxnitem`, `getInctvSettingByEmpId`, `GetEmpIncentiveInfo`, `acc-get-employee-ledger-list`, `incentive-applicable-docter-list`, `addProfile`, `addEmpProfileMap`, `saveProfileItemMap`, `saveEmployeeBillItemsMap`, `activateDeactivateEmployeeSetup`, `updateEmployeeBillItem`, `updateProfileBillItemMap`, `removeSelectedBillItem`, `removeSelectedBillItemFromProfileMap`, `saveItemGroupDistribution`, `save-fraction-items`, `save-payment-info`, `load-uptodate-transactions`, `activateDeactivateProfile`, `updateProfile`, `update-billtxnItem`.

---

## 7. Cross-Module Integration

The Incentive module is deeply integrated with three other modules: **Billing** (source of truth for billable services), **Employee** (receiver identity and TDS), and **Accounting** (payment voucher posting). Below is a precise map.

### 7.1 Billing (source of fractions)

| Cross-reference | Where | Direction |
|-----------------|-------|-----------|
| `BIL_MST_ServiceItem.ServiceItemId` | Read in `INCTV_MAP_EmployeeBillItemsMap.ServiceItemId`, `INCTV_TXN_IncentiveFractionItem.ServiceItemId` | Incentive reads from Billing |
| `BIL_MST_ServiceItem.IsIncentiveApplicable` | Drives which items are eligible | Billing constrains Incentive |
| `BIL_MST_ServiceItem.Price` | Used in `GetIncentiveItems` to display price | Billing → Incentive |
| `BIL_CFG_PriceCategory.PriceCategoryId` | FK in `ProfileItemMap`, `EmployeeBillItemsMap`, `ItemGroupDistribution` | Bidirectional read |
| `BIL_TXN_BillingTransactionItem.BillingTransactionItemId` | Source of fractions. Has `PerformerId` and `PrescriberId` that the fraction generation reads. | Bidirectional: Billing → Incentive (read for fraction gen), Incentive → Billing (write to update performer/prescriber) |
| `BIL_TXN_BillingTransactionItem.ReturnStatus` | Returned bill items are handled by the second stored proc (`..._Return_InDateRange`). | Billing → Incentive |

The `PUT /api/Incentive/BillTransactionItems` endpoint writes back to Billing — a rare and dangerous pattern. The Incentive module can mutate `BIL_TXN_BillingTransactionItem.PerformerId` and `PrescriberId`, which can change the doctor's name that appears on the patient's invoice. This is intended (consultant corrections) but creates a coupling: any change to incentive percentages can silently change a bill's `PerformerName`.

### 7.2 Employee (receivers)

| Cross-reference | Where | Notes |
|-----------------|-------|-------|
| `EMP_Employee.EmployeeId` | FK in `INCTV_EmployeeIncentiveInfo`, `INCTV_MAP_EmployeeBillItemsMap`, `INCTV_CFG_ItemGroupDistribution.FromEmployeeId` / `DistributeToEmployeeId`, `INCTV_TXN_IncentiveFractionItem.IncentiveReceiverId`, `INCTV_TXN_PaymentInfo.ReceiverId` | Core join. |
| `EMP_Employee.FullName` | Denormalized into `IncentiveReceiverName`, `PaymentInfo.ReceiverId` display | Read-only, denormalized for display. |
| `EMP_Employee.IsIncentiveApplicable` | Filters which employees are eligible for fraction generation. | Read. |
| `EMP_Employee.TDSPercent` | Used as default TDS for an employee if no `EmployeeIncentiveInfo.TDSPercent` is set. | Read with fallback. |
| `EMP_Employee.IsActive` | Filters `IncentiveApplicableDoctors`. | Read. |

There is **no automated sync** from `EMP_Employee` to `INCTV_EmployeeIncentiveInfo`. When a new doctor is hired, an admin must manually create the `EmployeeIncentiveInfo` row before any fractions will be generated for them.

### 7.3 Accounting (payment posting)

The payment flow crosses into the Accounting module:

| Cross-reference | Where | Notes |
|-----------------|-------|-------|
| `ACC_Ledger.LedgerId` (employee sub-ledger) | Used as the Dr leg of the payment voucher. Required for payment — the controller refuses to post if no employee ledger exists. | Must be created in Accounting before incentive payment is possible. |
| `ACC_Ledger.LedgerId` (cash/bank) | Used as the Cr leg. Selected by the user in the payment UI. | Read. |
| `ACC_Transactions` | Created during `PostIncentivePaymentVoucher`. `TransactionType = "IncentivePayment"`, `VoucherId` from voucher code `pmtv`. | Incentive writes. |
| `VoucherNumber` | Generated by accounting, joined back into `INCTV_TXN_PaymentInfo.VoucherNumber` via `SP_INCTV_PaymentInfo_Update`. | Bidirectional. |
| `ACC_MST_Voucher` (voucher code `pmtv`) | Required for voucher number generation. | Read. |
| `SP_INCTV_PaymentInfo_Update` | Called from accounting after voucher is posted; marks fractions as paid. | Bidirectional. |
| `SP_INCTV_ACC_GetTransactionInfoForAccTransfer` | Used by `AccountingTransferData.IncetiveTxnDateWise` for the daily transfer of incentive transactions to accounting. | Read by accounting transfer. |

The Incentive module owns no accounting data of its own, but it owns the **payment info** and the **fraction → payment linkage**. Accounting owns the voucher.

### 7.4 Other dependencies

- **Core parameters**: `Common/CalendarTypes` (drives date picker format in the UI), `Incentive/IncentiveOpdIpdSettings` (drives OPD/IPD selection in employee setup), `Incentive/TDSConfiguration` (default TDS), `Accounting/IsAllowGroupby`, `Accounting/EnableVoucherVerification` (read by the payment controller).
- **RBAC**: Routes are protected by `RbacUser` session for write operations only. Reads are not RBAC-gated at the controller level; security is enforced via the route's menu permission.
- **Reporting** module: hosts `SP_INCTV_Report_Hospital_Income` and `SP_INCTV_Report_ServiceDepartmentWise_Hospital_Income` for the Hospital Income Report.

---

## 8. Business Rules

### 8.1 Percentage rules

- For one bill line item, the **sum of all active fractions' `FinalIncentivePercent` (excluding `adjustment` type) must be ≤ 100**. Enforced client-side in `INCTV_EditFractionComponent.ChekValidation`.
- A single employee can appear in at most one fraction row per bill line item. Duplicate-receiver validation: `validationObj.messageArr.push("One Employee can't be at more than one place.")`.
- A fraction of type `adjustment` is excluded from the 100% sum check.
- For employee bill items, `PerformerPercent + PrescriberPercent + ReferrerPercent` (the employee's own percentages) must be ≤ 100. Enforced client-side in `CheckIfItemPercentValid` and `CheckIfPercentValid` (edit incentive txn item).
- Group distribution: when `HasGroupDistribution=true`, the sum of `DistributionPercent` across rows must be ≤ 100. The first row is auto-populated with the current employee at the performer's full percent. The 0th row's `FinalPercent` is computed as `assignedToPercent - sum(rest)` after every other row is updated.

### 8.2 TDS rules

- TDS is applied per fraction at the time of generation.
- The TDS source is resolved in this order: `EmployeeIncentiveInfo.TDSPercent` → `EMP_Employee.TDSPercent` → core parameter `Incentive/TDSConfiguration.TDSPercent` (default 15%).
- TDS amount: `TDSAmount = IncentiveAmount * TDSPercentage / 100`.
- Net payable: `NetPayAmount = TotalAmount - TDSAmount` (or `IncentiveAmount - TDSAmount` per fraction).
- The `PreviousAdjustedAmount` field on the payment screen lets users carry forward prior period adjustments; the `voucherAmount` is computed as `totalNetPayable - previousAdjustedAmount`.

### 8.3 Eligibility rules

A bill line item becomes a fraction when **all** of these are true:
- The bill item's service item has `IsIncentiveApplicable = true` (`BIL_MST_ServiceItem`).
- The service department is integrated and recognized (e.g. OPD, Lab, Radiology).
- The bill line has a `PerformerId` or `PrescriberId` set.
- The corresponding employee has `IsIncentiveApplicable = true` and `IsActive = true`.
- The corresponding employee has an active `EmployeeIncentiveInfo` row.
- The bill line has an `EmployeeBillItemsMap` entry for `(ServiceItemId, EmployeeId, PriceCategoryId)` (or a fallback profile mapping).
- The bill is not a return (`ReturnStatus != "returned"` for the sales proc; the return proc handles returned items separately).

### 8.4 OPD/IPD applicability

`BillingTypesApplicable` is a string field on `ProfileItemMap` and `EmployeeBillItemsMap`:
- `"inpatient"` — applies only to IPD bills.
- `"outpatient"` — applies only to OPD bills.
- `"both"` — applies to both. Display in grid: "InPatient/OutPatient".
- The `INCTV_BulkInsert...` stored procs check this field; mismatches result in no fraction being generated.

### 8.5 Soft-delete and cascading

- Profile deactivation (`IsActive=false`): profile remains, but its mappings should be considered inactive by the sync proc.
- Employee setup deactivation cascades: `EmployeeIncentiveInfo.IsActive`, all its `EmployeeBillItemsMap.IsActive`, all related `ItemGroupDistribution.IsActive` are flipped together. The SQL update is one-by-one in a single transaction.
- Bill item removal (`RemoveBillItem`): sets `IsActive=false` on the `EmployeeBillItemsMap` row AND hard-deletes all `ItemGroupDistribution` rows for it.
- Fraction soft-delete: setting `IsActive=false` removes the fraction from the unpaid-pool but keeps the audit row.

### 8.6 Payment rules

- Payment requires an **employee ledger** in accounting. The UI loads these via `GetLedgerListOfEmployee` and warns "Ledger of this employee is not created. Please create this employee Ledger." if missing.
- The payment voucher is a 2-leg entry: Dr Employee Ledger, Cr Cash/Bank Ledger. The amount is the user-entered `voucherAmount` (not necessarily equal to the net payable — the difference becomes `AdjustedAmount`).
- The voucher code is `pmtv` (configurable in `ACC_MST_Voucher`).
- `IsPostedToAccounting` and `AccountingPostedDate` are stamped on the `PaymentInfoModel` if and only if the voucher posts successfully.
- The `SP_INCTV_PaymentInfo_Update` proc updates all fractions matching `(ReceiverId, FromDate..ToDate)` to `IsPaymentProcessed=true, PaymentInfoId=newId`. **It is not selective by bill line** — every unpaid fraction in the date range for the employee is marked paid. This is a known limitation: if the user wants to pay only some fractions, they must first deactivate the others (`IsActive=false`).

### 8.7 Sync rules

- The Bill Sync stored proc is called per date range. There is no built-in protection against calling it twice in the same range — the proc is expected to be idempotent (not verified in the controller).
- Returned bill items go through a separate proc that handles `BillReturnItemId` linkage and negative amounts.
- Cancelled bill items are not eligible for fraction generation (enforced in the proc, not in C#).
- Cancelled/adjusted fractions can be undone by setting `IsActive=false`; the user is expected to re-run sync if the original bill changes (e.g. performer correction).

### 8.8 Validation rules

- Profile name is required (UI-level `Validators.required`).
- Profile item mapping requires `BillItemPriceId`, `ProfileId`, `PerformerPercent`, `PrescriberPercent`, `PriceCategoryId` (UI-level validation).
- Employee setup requires a non-zero `EmployeeId` and an active employee.
- Fraction rows require: `IncentiveType` (non-null), `IncentiveReceiverId` (non-null), `FinalIncentivePercent` (≥ 0).
- A doctor must have an `EmployeeBillItemsMap` entry to appear in the fraction row; the edit-fraction UI auto-suggests the percent from this mapping (or from the group distribution if `HasGroupDistribution=true`).

### 8.9 Authorization and audit

- Writes require an authenticated `RbacUser` (read from `HttpContext.Session`). Reads are not gated.
- Every create/update stamps `CreatedBy/ModifiedBy` with `currentUser.EmployeeId` and `CreatedOn/ModifiedOn` with `DateTime.Now`.
- The `SP_INCTV_PaymentInfo_Update` is called outside the C# transaction (after the accounting voucher posts). If it fails, the voucher still exists but the fractions are not marked paid — manual reconciliation is required.
- There is no concept of "approval" or "workflow" for incentive configuration. All admins with the right permission can create/modify any profile or employee setup at any time.

### 8.10 Edge cases and known gaps

- The `GetIncentiveItems` query filters items where `IsIncentiveApplicable=true` but the legacy code path (commented out) also filtered by `IsFractionApplicable=true`. The two flags are different: `IsIncentiveApplicable` is the modern flag, `IsFractionApplicable` was the legacy one.
- `SP_INCTV_BulkInsert_FractionItemsFromBillTxnItem_InDateRange` may produce a `Hospital` fraction row (`IncentiveType = "hospital"`, `IncentiveReceiverId = 0`) for the leftover percentage after performer/prescriber split. The frontend code (`IncentiveService.GetFractionItemsFromTxnItems`) explicitly comments out the hospital calculation: "no need to add hospital amount--sud:16Feb'20-- after incentive ui and logic change.."
- The accounting-side SP `SP_INCTV_PaymentInfo_Update` uses `IsActive=1` (active only) as the filter when marking fractions paid, but does **not** re-check `IsActive=1` after the update — fractions that become inactive between sync and payment are still in the pool until manually removed.
- `INCTV_TXN_PaymentInfo.IsPostedToAccounting` is set when the voucher is created, but there is no polling or webhook to verify posting succeeded in a separate transaction. The whole posting is wrapped in one transaction.
- The incentive calculation does not consider **invoice cancellation** as a separate signal — the controller relies on the bill line's `BillingTransactionItemStatus`. If a bill is cancelled after fractions are generated, the fractions must be manually deactivated.
- **Multi-currency / multi-hospital**: the schema is single-hospital. There is no `HospitalId` on any incentive table. The `IncetiveTxnDateWise` accounting transfer receives `HospitalId` but discards it in the SP call.

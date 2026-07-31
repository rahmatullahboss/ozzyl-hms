# Claim Management Module (DanpheEMR)

> **Source Project:** DanpheEMR (ASP.NET MVC + SQL Server + Angular)
> **Cloud Migration Target:** Hono on Cloudflare Workers + D1 (SQLite) + Angular on Cloudflare Pages
> **Module Slug:** `claim-management`
> **Base URL (legacy):** `/api/ClaimManagement`
> **Scope:** End-to-end insurance / credit-organization claim lifecycle — from bill review through claim submission, review, approval/rejection, and final settlement.

---

## 1. Module Overview

The Claim Management module is the financial bridge between the hospital's credit-based billing (Billing + Pharmacy) and external insurance / credit organizations. It allows authorized billing staff to:

1. Pull settled credit bills (Billing Invoices and Pharmacy Invoices) for a chosen insurance provider within a date range.
2. Mark individual invoices and even individual bill line-items as **claimable** or **non-claimable**.
3. Assign a unique **Claim Code** to a bundle of bills belonging to a single patient visit/episode.
4. Attach supporting documents (investigation reports, discharge summary, etc.) to the claim.
5. Submit claims to the insurance provider (status `payment-pending`) and record approval / rejection amounts after the insurer responds.
6. Track partial / final payments received from the insurer against the claim, including service commission.
7. Conclude claims (`settled`) and reverse claims back to bill-review when needed.
8. Print claim forms (ECHS MRP drug certificate, Medical Claim Form) and run reports.

The module is **multi-credit-organization** aware: only organizations flagged with `IsClaimManagementApplicable = true` appear in the dropdown. A **claim code** can be optional, compulsory, or auto-generated depending on the organization's settings (`IsClaimCodeCompulsory`, `IsClaimCodeAutoGenerate`).

### High-Level Architecture

```
+---------------------+        +-------------------------+        +--------------------+
| BillingCreditBill   |        |  ClaimManagement        |        |  InsuranceClaim    |
| (BIL_TXN_Credit..)  |<------>|  Service (this module)  |<------>|  (INS_TXN_Insur..) |
+---------------------+        +-------------------------+        +--------------------+
        ^                              ^    ^                              ^
        |                              |    |                              |
+---------------------+        +-------+    +-------+              +------------------+
| PharmacyCreditBill  |        |                |               | InsuranceClaim   |
| (PHRM_TXN_Credit..) |        v                v               | Payment          |
+---------------------+   TXN_UploadedFile  Stored Procs        +------------------+
                          (claims, attachments)   (SP_INS_*)
```

---

## 2. Backend Files (Server-Side)

### 2.1 Controller

| File | Purpose |
|------|---------|
| `Controllers/ClaimManagement/ClaimManagementController.cs` | Single thin MVC controller. All endpoints delegate to `IClaimManagementService`. Inherits `CommonController` and uses the standard `InvokeHttpGet/Post/PutFunction` wrappers. |

**Constructor dependencies:**
- `IClaimManagementService _IClaimManagementService` — business logic.
- `IOptions<MyConfiguration> _config` — DB connection string.
- Creates its own `ClaimManagementDbContext` per request using the parent connection string.

**All controller actions follow the pattern:**
```csharp
Func<object> func = () => _IClaimManagementService.SomeMethod(...);
return InvokeHttpGetFunction(func);
```
or `InvokeHttpPostFunction` / `InvokeHttpPutFunction` for the write operations.

### 2.2 Service Layer

| File | Purpose |
|------|---------|
| `Services/ClaimManagement/IClaimManagementService.cs` | Interface — 16 GET, 2 POST, 11 PUT methods. |
| `Services/ClaimManagement/ClaimManagementService.cs` | Concrete implementation. All write methods are wrapped in `dbContextTransaction` with try/catch + rollback. Heavy use of LINQ-to-Entities, raw ADO via `DALFunctions.GetDataTableFromStoredProc` for the stored-proc-backed endpoints, and file I/O for uploads. |
| `Services/ClaimManagement/UploadedFileDTO.cs` | Wire format for uploaded supporting documents (includes base64 `BinaryData`). |

### 2.3 DTOs (Request / Response shapes)

| DTO | File | Purpose |
|-----|------|---------|
| `CreditOrganizationDTO` | `DTOs/CreditOrganizationDTO.cs` | Insurance provider master data exposed to the claim UI. |
| `ClaimBillReviewDTO` | `DTOs/ClaimBillReviewDTO.cs` | One row in the Bill Review grid (billing or pharmacy invoice, claimable flag, totals). |
| `SubmitedClaimDTO` | `DTOs/SubmitedClaimDTO.cs` | Wraps `InsuranceClaim` + `List<UploadedFileDTO>` when submitting a claim. |
| `PendingClaimDTO` | `DTOs/PendingClaimDTO.cs` | Row in the Pending Claims grid (claim totals, approved/rejected/pending amounts). |
| `ClaimPaymentDTO` | `DTOs/ClaimPaymentDTO.cs` | One payment received from the insurer. |
| `BillingCreditBillItemDTO` | `DTOs/BillingCreditBillItemDTO.cs` | Toggle claimable status on a single billing line item. |
| `PharmacyCreditBillItemDTO` | `DTOs/PharmacyCreditBillItemDTO.cs` | Toggle claimable status on a single pharmacy line item. |
| `HeaderDetailsDTO`, `BillingDetailsDTO`, `PharmacyDetailsDTO`, `DocumentDetailsDTO` | `DTOs/ClaimPreviewDetailsDTO.cs` | Result sections returned by `SP_INS_GetClaimDetailsForPreview` (header, billing items, pharmacy items, attached documents). |

### 2.4 Related Services

| Service | Notes |
|---------|-------|
| `Services/Medicare/IMedicareService.cs` / `MedicareService.cs` | Adjacent government-medicare module. Different schema, different DbContext (`MedicareDbContext`). Not part of the claim-management flow but referenced when claim UI surfaces medicare-only fields (e.g. ECHS patient list). |

### 2.5 Stored Procedures Used

| Stored Procedure | Used By | Purpose |
|------------------|---------|---------|
| `SP_INS_InsuranceBillReview` | `GetBillForClaimReview` | Lists settled credit bills for a credit organization between two dates. |
| `SP_INS_PendingClaims` | `GetPendingClaims` | Lists claims currently in `in-review` (scrubbing) state. |
| `SP_INS_PaymentPendingClaims` | `GetPaymentPendingClaims` | Lists claims awaiting payment. |
| `SP_INS_GetClaimDetailsForPreview` | `GetClaimDetailsForPreview` | Returns 4 result sets: header / billing items / pharmacy items / attached documents. |
| `SP_INS_Claim_GetBillingCreditBillItems` | `GetBillingCreditBillItems` | Per-line-item claimable status for a billing transaction. |
| `SP_INS_Claim_GetPharmacyCreditBillItems` | `GetPharmacyCreditBillItems` | Per-line-item claimable status for a pharmacy invoice. |
| `SP_PAT_ECHSPatientsListWithVisitinformation` | `GetECHSPatientWithVisitInformation` | ECHS-patient autocomplete (used by ECHS MRP drug certificate form). |

---

## 3. Data Models (C# POCOs)

All claim-management models live in `Components/DanpheEMR.ServerModel/ClaimManagementModels/`. Foreign modules own some of the tables that claim management reads/mutates — those are referenced from `Components/DanpheEMR.ServerModel/BillingModels/`, `PharmacyModels/`, etc.

### 3.1 `InsuranceClaim` — `INS_TXN_InsuranceClaim`

| Property | Type | Notes |
|----------|------|-------|
| `ClaimSubmissionId` | `int` (PK) | Surrogate key, identity. |
| `ClaimCode` | `Int64?` | External claim number from insurer (auto-generated or manual based on credit org config). |
| `ClaimReferenceNo` | `string` | Optional internal reference. |
| `CreditOrganizationId` | `int` | FK to `BIL_MST_Credit_Organization`. |
| `PatientId` | `int` | FK to patient. |
| `SchemeId` | `int` | FK to `BIL_CFG_Scheme`. |
| `PatientCode` | `string` | Hospital number at submission time (denormalized). |
| `MemberNumber` | `string` | Insurer member number (denormalized from `BIL_TXN_CreditBillStatus`). |
| `ClaimSubmittedOn` | `DateTime` | Submission timestamp. |
| `ClaimSubmittedBy` | `int` | EmployeeId of submitter. |
| `ClaimStatus` | `string` | One of `ENUM_ClaimManagement_ClaimStatus` values. |
| `TotalBillAmount` | `decimal(16,4)` | Sum of all linked invoices. |
| `ClaimableAmount` | `decimal(16,4)` | Total − non-claimable. |
| `NonClaimableAmount` | `decimal(16,4)` | Sum of bill items marked non-claimable. |
| `ClaimedAmount` | `decimal(16,4)` | Amount the hospital demands from insurer. |
| `ClaimRemarks` | `string` | Free-text. |
| `ModifiedBy` / `ModifiedOn` | `int?` / `DateTime?` | Audit. |
| `ApprovedAmount` | `decimal(16,4)` | Filled in during review. |
| `RejectedAmount` | `decimal(16,4)` | Filled in during review. |

### 3.2 `InsuranceClaimPayment` — `INS_TXN_ClaimPayment`

| Property | Type | Notes |
|----------|------|-------|
| `ClaimPaymentId` | `int` (PK) | Identity. |
| `ClaimSubmissionId` | `int` | FK to `INS_TXN_InsuranceClaim`. |
| `ClaimCode` | `Int64` | Denormalized for fast lookup. |
| `CreditOrganizationId` | `int` | FK. |
| `ReceivedAmount` | `decimal` | Net amount received. |
| `ServiceCommission` | `decimal` | Third-party admin / TPA commission deducted. |
| `ReceivedBy` | `int` | EmployeeId. |
| `ReceivedOn` | `DateTime` | Timestamp. |
| `ChequeNumber` | `string` | Optional. |
| `PaymentDetails` | `string` | Free text (UTR, transaction id, etc.). |
| `BankName` | `string` | Optional. |
| `Remarks` | `string` | Optional. |

### 3.3 `TXNUploadedFile` — `TXN_UploadedFile`

A shared, generic upload table also used by other modules (patient documents, etc.). Claim Management uses it with `SystemFeatureName = 'InsuranceClaim'` and `ReferenceEntityType = 'InsuranceClaim'`.

| Property | Type | Notes |
|----------|------|-------|
| `FileId` | `int` (PK) | Identity. |
| `SystemFeatureName` | `string` | e.g. `InsuranceClaim`. |
| `PatientId` | `int` | Owner patient. |
| `PatientVisitId` | `int?` | Optional. |
| `ClaimCode` | `Int64?` | Optional. |
| `ReferenceNumber` | `int` | e.g. `ClaimSubmissionId`. |
| `ReferenceEntityType` | `string` | e.g. `InsuranceClaim`. |
| `FileDisplayName` | `string` | Original user-facing file name. |
| `FileName` | `string` | Generated server-side filename. |
| `FileExtension` | `string` | e.g. `.pdf`, `.jpg`. |
| `FileLocationFullPath` | `string` | Disk path (write happens here). |
| `FileDescription` | `string` | Free text. |
| `UploadedBy` | `int` | EmployeeId. |
| `UploadedOn` | `DateTime` | Timestamp. |
| `IsActive` | `bool` | Soft-delete flag. |
| `Size` | `Int64` | Bytes. |

### 3.4 Foreign / Shared Models Read by This Module

| Model | File | Notes |
|-------|------|-------|
| `BillingTransactionCreditBillStatusModel` | `BillingModels/POS/BillingTransactionCreditBillStatus.cs` | Per-invoice credit status; mutated when a bill is claimed / unclaimed. |
| `PHRMTransactionCreditBillStatus` | `PharmacyModels/PHRMTransactionCreditBillStatus.cs` | Same idea for pharmacy invoices. |
| `BillingTransactionCreditBillItemStatusModel` | `BillingModels/POS/BillingTransactionCreditBillItemStatusModel.cs` | Per-line-item claimable toggle for billing. |
| `PHRMTransactionCreditBillItemStatusModel` | `PharmacyModels/PHRMTransactionCreditBillItemStatusModel.cs` | Per-line-item claimable toggle for pharmacy. |
| `CreditOrganizationModel` | `BillingModels/Config/CreditOrganizationModel.cs` | Insurance provider master — has `IsClaimManagementApplicable`, `IsClaimCodeCompulsory`, `IsClaimCodeAutoGenerate`, `IsDefault`, `DisplayName`. |
| `BillingSchemeModel` | `BillingModels/Config/` | Scheme has `ApiIntegrationName`; surfaced by `GetApiIntegrationNameByOrganizationId`. |

### 3.5 Enum Constants (`Utilities/SharedEnums.cs`)

```csharp
ENUM_ClaimManagement_ClaimStatus = {
    Initiated       = "initiated",
    InReview        = "in-review",
    PaymentPending  = "payment-pending",
    PartiallyPaid   = "partially-paid",
    Settled         = "settled",
    Denied          = "denied"
}

ENUM_ClaimManagement_SettlementStatus = {
    Pending   = "pending",
    Completed = "completed"
}

ENUM_ClaimManagement_CreditModule = {
    Billing  = "billing",
    Pharmacy = "pharmacy"
}
```

---

## 4. Database Tables

| Table | Owner | Purpose |
|-------|-------|---------|
| `INS_TXN_InsuranceClaim` | Claim Management | One row per submitted claim. |
| `INS_TXN_ClaimPayment` | Claim Management | One row per payment received from insurer. |
| `BIL_MST_Credit_Organization` | Billing | Insurance providers (flagged with `IsClaimManagementApplicable` for this module). |
| `BIL_TXN_CreditBillStatus` | Billing | Per-invoice credit status. Has `IsClaimable`, `ClaimSubmissionId`, `ClaimCode`, `SettlementStatus` columns used by claim management. |
| `BIL_TXN_CreditBillItemStatus` | Billing | Per-line-item claimable toggle. |
| `BIL_CFG_Scheme` | Billing | Scheme master (with `ApiIntegrationName`). |
| `BIL_TXN_InvoiceReturn` | Billing | Credit notes (returned items). |
| `PHRM_TXN_CreditBillStatus` | Pharmacy | Pharmacy credit status mirror of `BIL_TXN_CreditBillStatus`. |
| `PHRM_TXN_CreditBillItemStatus` | Pharmacy | Pharmacy line-item claimable toggle. |
| `PHRM_TXN_InvoiceReturn` | Pharmacy | Pharmacy credit notes. |
| `PHRM_TXN_InvoiceItems` | Pharmacy | Per-line items. |
| `BIL_TXN_BillingTransactionItems` | Billing | Per-line items. |
| `TXN_UploadedFile` | Shared | Generic document store. |
| `CORE_CFG_Parameters` | Core | Configuration — used to read `ClaimManagement/InsuranceClaimFileUploadLocation`. |

The `ClaimManagementDbContext` (in `Components/DanpheEMR.DalLayer/`) registers all of the above as `DbSet<>` properties and sets explicit `ToTable(...)` mappings plus `HasPrecision(16, 4)` on monetary columns.

### Key Index / Constraint Conventions (inferred from PK/FK patterns)

- `INS_TXN_InsuranceClaim.ClaimCode` is nullable but effectively unique (validated by `CheckIsClaimCodeAvailable`).
- `BIL_TXN_CreditBillStatus.ClaimSubmissionId` is nullable — only set once the invoice is bundled into a claim.
- `PHRM_TXN_CreditBillStatus.ClaimSubmissionId` follows the same convention.
- All `*_CreditBillStatus` tables carry both a `SettlementStatus` (for the billing/pharmacy settlement workflow) and the claim-management fields; the two workflows coexist.

---

## 5. Key Workflows

### 5.1 Select Insurance Provider
1. Front-end calls `GET /api/ClaimManagement/InsuranceApplicableCreditOrganizations`.
2. Returns credit orgs where `IsClaimManagementApplicable = true` and `IsActive = true`.
3. User picks one; the front-end stores the choice in a shared `ClaimManagementService` so the rest of the module knows which org to scope to.
4. All subsequent navigation is guarded by `InsuranceSelectionGuardService` (redirects to `SelectInsuranceProvider` if no org is active).

### 5.2 Bill Review (Step 1 — gather claimable invoices)
1. User picks a date range + the chosen credit org.
2. `GET /api/ClaimManagement/BillReview?FromDate&ToDate&CreditOrganizationId` invokes `SP_INS_InsuranceBillReview`, returning a flat list of settled credit bills (both billing invoices and pharmacy invoices).
3. User toggles `IsClaimable` per row → `PUT /api/ClaimManagement/ClaimableStatus?claimableStatus=...` calls `UpdateClaimableStatus` (bulk) or `PUT /api/ClaimManagement/Claim/Invoice/ClaimableStatus` (single).
4. For deeper granularity, user opens the invoice preview and toggles **per line item** via `PUT /api/ClaimManagement/BillingCreditItemClaimableStatus` or `PUT /api/ClaimManagement/PharmacyCreditItemClaimableStatus`. These re-compute `NonClaimableAmount` and `NetReceivableAmount` on the parent credit-bill-status row.
5. User assigns a `ClaimCode` to a group of bills belonging to the same patient → `PUT /api/ClaimManagement/ClaimCode`. Validates uniqueness via `IsClaimCodeAvailable`.
6. User clicks **Send for Scrubbing** → `POST /api/ClaimManagement/InsuranceClaim` calls `SaveClaimScrubbing`, which:
   - Creates an `InsuranceClaim` row in `Initiated` status with `TotalBillAmount = SUM(bills.TotalAmount)`, `NonClaimableAmount = SUM(bills.NonClaimableAmount)`, `ClaimableAmount = diff`.
   - For each bill: sets `ClaimSubmissionId` and `SettlementStatus = 'completed'` on the corresponding `*_CreditBillStatus` row.

### 5.3 Claim Scrubbing (Step 2 — internal review)
1. `GET /api/ClaimManagement/PendingClaims?CreditOrganizationId` returns claims in `Initiated` (scrubbing) state, via `SP_INS_PendingClaims`.
2. User opens a claim → `GET /api/ClaimManagement/Claim/Invoices?ClaimSubmissionId` lists every billing + pharmacy invoice attached to it.
3. User can pull invoice previews: `GET /api/ClaimManagement/BillingCreditNotes` (credit notes) and `GET /api/ClaimManagement/PharmacyCreditNotes` (pharmacy credit notes).
4. User can revert an invoice back to Bill Review: `PUT /api/ClaimManagement/RevertToBillReview` (`RevertInvoiceToBillPreview`) — clears `ClaimSubmissionId`, sets `SettlementStatus = 'pending'`, decrements claim totals.
5. User toggles `IsClaimable` on invoices **already attached to a claim** → `PUT /api/ClaimManagement/Claim/Invoice/ClaimableStatus` updates the credit-bill-status row **and** the parent claim's `NonClaimableAmount` / `ClaimableAmount` in the same transaction.
6. User attaches supporting documents (uploaded from the claim preview) — see Section 5.7.
7. **Two submit options:**
   - **Save as draft** → `PUT /api/ClaimManagement/SaveClaimAsDraft` sets `ClaimStatus = in-review`.
   - **Submit claim** → `POST /api/ClaimManagement/SubmitClaim` sets `ClaimStatus = payment-pending` and persists the uploaded documents in the same transaction.

### 5.4 Claim Review / Approval (Step 3 — insurer responds)
1. User opens Payment-Pending Claims list → `GET /api/ClaimManagement/PaymentPendingClaims` (`SP_INS_PaymentPendingClaims`).
2. `GET /api/ClaimManagement/ClaimDetails?ClaimSubmissionId` invokes `SP_INS_GetClaimDetailsForPreview` (4 result sets: header, billing items, pharmacy items, documents).
3. User reviews and enters `ApprovedAmount` / `RejectedAmount` per claim → `PUT /api/ClaimManagement/ClaimApprovedAndRejectedAmount` updates `INS_TXN_InsuranceClaim`.
4. If the claim was sent in error, the user can send it **back to scrubbing** with `PUT /api/ClaimManagement/RevertToClaimScrubbing` (`RevertClaimToBackToClaimScrubbing`). This is blocked if any payment already exists against the claim.

### 5.5 Payment Recording (Step 4 — receive money)
1. Within a payment-pending claim, user clicks **Add Payment** → opens `NewInsurancePaymentComponent` form.
2. `POST /api/ClaimManagement/InsuranceClaimPayment` (call to `InsuranceClaimPayment`):
   - Inserts a row into `INS_TXN_ClaimPayment` with `ReceivedAmount`, `ServiceCommission`, `ChequeNumber`, `BankName`, `PaymentDetails`, `Remarks`.
   - Sets the parent claim `ClaimStatus = 'partially-paid'` (the system does **not** auto-derive `fully-paid` from payment totals; staff run **Conclude Claim** to move to `settled`).
3. `GET /api/ClaimManagement/InsurancePayments?ClaimSubmissionId` lists all payments logged against a claim.
4. Payments can be edited (not deleted) via `PUT /api/ClaimManagement/InsuranceClaimPayment` (`UpdateInsuranceClaimPayment`).

### 5.6 Settlement / Conclusion
1. Once all payments are in, user clicks **Conclude Claim** → `PUT /api/ClaimManagement/ConcludeClaim?ClaimSubmissionId` sets `ClaimStatus = 'settled'`.
2. After conclusion, the claim becomes read-only on the front-end; the linked `*_CreditBillStatus` rows stay at `SettlementStatus = 'completed'`.

### 5.7 Document Upload & Preview
1. **Upload**: handled inside `SubmitClaim` / `SaveClaimAsDraft`. Files are base64 in `UploadedFileDTO.BinaryData`. Server reads `CORE_CFG_Parameters` row where `ParameterGroupName = 'ClaimManagement'` and `ParameterName = 'InsuranceClaimFileUploadLocation'` to get the destination folder, creates it if missing, decodes base64, and writes the file as `<PatientCode>_<ClaimCode>_<yyyyMMddHHmmss>_<n>.<ext>`. The file metadata is persisted in `TXN_UploadedFile` with `SystemFeatureName = InsuranceClaim`, `ReferenceEntityType = InsuranceClaim`, `ReferenceNumber = ClaimSubmissionId`, `ClaimCode = ...`.
2. **Diff behavior**: the service reconciles the new file list against existing rows for that `ClaimCode`:
   - Files in both → keep row, update `FileDescription` if changed.
   - Files only in new list → insert + write to disk.
   - Files in DB but not in new list → remove row + delete file from disk.
3. **List**: `GET /api/ClaimManagement/Claim/Documents?ClaimCode` returns document metadata.
4. **Preview**: `GET /api/ClaimManagement/Claim/PreviewDocument?fileId` reads the file from disk and returns base64 + extension.

### 5.8 Claim Forms & SSF
- `ClaimFormsComponent` is a router shell with two children:
  - `EchsMrpDrugCertificateComponent` — pulls patients via `GetECHSPatientWithVisitInformation` (`SP_PAT_ECHSPatientsListWithVisitinformation`) and prints a certificate.
  - `MedicalClaimFormComponent` — generic medicare claim form.
- `SSFClaimComponent` is a **separate** workflow guarded by `SsfClaimSelectionGuardService`. SSF (Social Security Fund / Social Service Fund) is a Nepal-specific social-security scheme. It has its own `SsfDlService` and route `SSFClaim`. See Section 8.

### 5.9 Reports
- `ReportsComponent` (route `Reports`) is a thin shell that hosts the claim-management summary reports (provider-wise, date-range, status-wise). Backend data is derived from `INS_TXN_InsuranceClaim` joined with `BIL_MST_Credit_Organization`.

---

## 6. API Endpoints

All endpoints live under `/api/ClaimManagement`. Request/response wrapper: `DanpheHTTPResponse<object>`. RBAC: every action pulls the current user from session (`HttpContext.Session.Get<RbacUser>(ENUM_SessionVariables.CurrentUser)`).

### 6.1 GET — Reads

| # | Method & Route | Handler | Purpose |
|---|---------------|---------|---------|
| 1 | `GET /InsuranceApplicableCreditOrganizations` | `InsuranceApplicableCreditOrganizations` | Credit orgs with `IsClaimManagementApplicable = true`. |
| 2 | `GET /BillReview?FromDate&ToDate&CreditOrganizationId` | `GetBillForReview` | Bills available for claim (calls `SP_INS_InsuranceBillReview`). |
| 3 | `GET /IsClaimCodeAvailable?ClaimCode` | `IsClaimCodeAvailable` | Uniqueness check. |
| 4 | `GET /PendingClaims?CreditOrganizationId` | `GetPendingClaims` | Claims in `Initiated` (scrubbing) state (`SP_INS_PendingClaims`). |
| 5 | `GET /Claim/Invoices?ClaimSubmissionId` | `GetInvoicesByClaimId` | All billing + pharmacy invoices attached to a claim. |
| 6 | `GET /Claim/PreviewDocument?fileId` | `GetDocumentForPreviewByFileId` | Returns base64 + extension of a stored document. |
| 7 | `GET /Claim/Documents?ClaimCode` | `GetDocumentsByClaimCode` | Document metadata for a claim. |
| 8 | `GET /PaymentPendingClaims?CreditOrganizationId` | `GetPaymentPendingClaims` | Claims awaiting payment (`SP_INS_PaymentPendingClaims`). |
| 9 | `GET /InsurancePayments?ClaimSubmissionId` | `GetInsurancePayments` | All payments logged against a claim. |
| 10 | `GET /ClaimDetails?ClaimSubmissionId` | `ClaimDetailsForPreview` | Header + billing items + pharmacy items + documents (4 result sets). |
| 11 | `GET /BillingCreditNotes?BillingTransactionId` | `BillingCreditNotes` | Credit notes (returns) for a billing invoice. |
| 12 | `GET /PharmacyCreditNotes?InvoiceId` | `PharmacyCreditNotes` | Credit notes for a pharmacy invoice. |
| 13 | `GET /BillingCreditBillItems?BillingTransactionId` | `BillingCreditBillItems` | Per-line-item claimable status (`SP_INS_Claim_GetBillingCreditBillItems`). |
| 14 | `GET /PharmacyCreditBillItems?PharmacyInvoiceId` | `PharmacyCreditBillItems` | Per-line-item claimable status for pharmacy. |
| 15 | `GET /ApiIntegrationNameByOrganizationId?OrganizationId` | `ApiIntegrationNameByOrganizationId` | Returns the `ApiIntegrationName` from `BIL_CFG_Scheme` for that credit org. |
| 16 | `GET /ECHSPatientWithVisitInformation?search` | `ECHSPatientWithVisitInformation` | ECHS patient autocomplete (`SP_PAT_ECHSPatientsListWithVisitinformation`). |

### 6.2 POST — Creates

| # | Method & Route | Handler | Body | Purpose |
|---|---------------|---------|------|---------|
| 17 | `POST /InsuranceClaim` | `SendClaimForScrubbing` | `List<ClaimBillReviewDTO>` | Bundle selected bills into a new claim row (initiates scrubbing). |
| 18 | `POST /SubmitClaim` | `SubmitClaim` | `SubmitedClaimDTO` (claim + files) | Final submit → status `payment-pending`, persist uploads. |
| 19 | `POST /InsuranceClaimPayment` | `InsuranceClaimPayment` | `ClaimPaymentDTO` | Record a payment from the insurer → status `partially-paid`. |

### 6.3 PUT — Updates

| # | Method & Route | Handler | Body / Query | Purpose |
|---|---------------|---------|--------------|---------|
| 20 | `PUT /ClaimableStatus?claimableStatus=` | `ChangeClaimableStatus` | `List<ClaimBillReviewDTO>` | Bulk toggle `IsClaimable` on credit-bill-status rows during Bill Review. |
| 21 | `PUT /Claim/Invoice/ClaimableStatus?claimableStatus=` | `UpdateClaimableStatusOfClaimedInvoice` | `ClaimBillReviewDTO` | Toggle a single invoice that is **already** attached to a claim; recomputes claim totals. |
| 22 | `PUT /RevertToBillReview` | `RevertInvoiceBackToBillReview` | `ClaimBillReviewDTO` | Detach an invoice from a claim; decrements claim totals. |
| 23 | `PUT /SaveClaimAsDraft` | `SaveClaimAsDraft` | `SubmitedClaimDTO` | Save claim in `in-review` state with files. |
| 24 | `PUT /ClaimCode?claimCode=` | `UpdateClaimCode` | `List<ClaimBillReviewDTO>` | Set / change claim code on selected invoices. |
| 25 | `PUT /ClaimApprovedAndRejectedAmount` | `UpdateApprovedAndRejectedAmount` | `PendingClaimDTO` | Update `ApprovedAmount` / `RejectedAmount` after insurer review. |
| 26 | `PUT /ConcludeClaim?ClaimSubmissionId` | `ConcludeClaim` | — | Move to `settled`. |
| 27 | `PUT /RevertToClaimScrubbing?ClaimSubmissionId` | `RevertClaimToBackToClaimScrubbing` | — | Send back to scrubbing; blocked if any payment exists. |
| 28 | `PUT /BillingCreditItemClaimableStatus` | `BillingCreditItemClaimableStatus` | `BillingCreditBillItemDTO` | Toggle per-line-item claimable + recompute bill and claim totals. |
| 29 | `PUT /PharmacyCreditItemClaimableStatus` | `PharmacyCreditItemClaimableStatus` | `PharmacyCreditBillItemDTO` | Same for pharmacy. |
| 30 | `PUT /InsuranceClaimPayment` | `UpdateInsuranceClaimPayment` | `ClaimPaymentDTO` | Edit an existing payment (no delete). |

### 6.4 Cross-Controller Calls Used by the Front-End

| Endpoint | Owner | Used For |
|----------|-------|----------|
| `GET /api/Billing/Banks` | Billing | Bank dropdown on payment form. |
| `GET /api/PharmacySales/InvoiceReceiptByInvoiceId?InvoiceId=` | Pharmacy | Pharmacy invoice receipt preview. |
| `GET /api/PharmacySalesReturn/CreditNotesInfo?invoiceId=` | Pharmacy | Pharmacy credit notes info. |
| `GET /api/Patient/PatientWithVisitInfo?search=&showIpPatinet=true` | Patient | Patient search inside claim forms. |

---

## 7. Cross-Module Dependencies

| Module | Relationship |
|--------|--------------|
| **Insurance (config)** | `BIL_MST_Credit_Organization` is the insurance provider master; this module reads only those with `IsClaimManagementApplicable = true`. |
| **Billing** | Reads/writes `BIL_TXN_CreditBillStatus` and `BIL_TXN_CreditBillItemStatus`. The settlement pipeline writes `SettlementStatus = 'pending'` on credit bill rows; claim management flips it to `'completed'` once a claim is initiated. |
| **Pharmacy** | Reads/writes `PHRM_TXN_CreditBillStatus` and `PHRM_TXN_CreditBillItemStatus`. Same settlement-status conventions. |
| **Patient** | `PatientId` / `PatientCode` / `MemberNumber` are denormalized into `INS_TXN_InsuranceClaim` at submission time. |
| **Core / Configuration** | Reads `CORE_CFG_Parameters` for upload path. |
| **Document Upload (TXN_UploadedFile)** | Shared file table; this module uses `SystemFeatureName = InsuranceClaim`. |
| **RBAC / Security** | Each endpoint expects a logged-in `RbacUser`; the `Rbac` permission "ClaimManagement" gates menu visibility. |
| **Medicare** | Adjacent; uses separate `MedicareDbContext`. ECHS patient search is shared. |
| **SSF (Social Service Fund)** | Sibling workflow under `ClaimManagement/SSFClaim`, guarded by `SsfClaimSelectionGuardService`. Sends patient visit-level data to an external SSF endpoint. |
| **Claim Forms (printing)** | `BillingPrintSharedModule` provides print styles; `EchsMrpDrugCertificatePrintComponent` and `MedicalClaimFormPrintComponent` render the static form templates. |

---

## 8. Business Rules

1. **Credit organization gating.** Only credit orgs with `IsClaimManagementApplicable = true` are selectable. If none is selected, all claim routes redirect to `SelectInsuranceProvider` (enforced by `InsuranceSelectionGuardService`).
2. **Claim code policy.** Per credit org:
   - `IsClaimCodeCompulsory = true` → user **must** enter a `ClaimCode` before submitting.
   - `IsClaimCodeAutoGenerate = true` → system auto-generates the code (the front-end calls `IsClaimCodeAvailable` to verify and then submits via the same `ClaimCode` endpoint).
   - Both can be off — the code is optional.
3. **Uniqueness of claim code.** Enforced by `CheckIsClaimCodeAvailable` (checks `INS_TXN_InsuranceClaim.ClaimCode`). The original commented-out code suggests the uniqueness was also meant to be checked across `BillingCreditBillStatus` and `PharmacyCreditBillStatus.ClaimCode` columns.
4. **Status state machine.**
   ```
   initiated  ─►  in-review  ─►  payment-pending  ─►  partially-paid  ─►  settled
       │                          │                       │
       │                          └─► (revert to scrubbing, if no payments) ┘
       └─► (in-review can be skipped if user submits directly from bill review)
   ```
   `denied` is defined in the enum but is not currently written by any service method (reserved for future use).
5. **Monetary invariants on `InsuranceClaim`:**
   - `ClaimableAmount = TotalBillAmount − NonClaimableAmount`.
   - On per-line-item toggles, `UpdateBillingCreditItemClaimableStatus` and `UpdatePharmacyCreditItemClaimableStatus` keep both `*_CreditBillStatus` and the parent claim in sync inside one DB transaction.
   - `ApprovedAmount + RejectedAmount` is **not** auto-validated against `ClaimableAmount`; the user enters both manually during review.
6. **Payment lifecycle.**
   - First payment flips claim to `partially-paid`. There is no automatic `fully-paid` derivation; staff use **Conclude Claim** to move to `settled`.
   - Payments are append-only on the table level; the service supports `UpdateInsuranceClaimPayment` (PUT) to correct amounts but does not expose a delete endpoint.
7. **Settlement status vs claim status.** `*_CreditBillStatus.SettlementStatus` reflects the **billing/pharmacy** settlement lifecycle (Pending → Completed). `InsuranceClaim.ClaimStatus` is a **parallel** lifecycle specific to the claim workflow. They are linked but not 1:1: a credit bill is `pending` until it enters a claim, then becomes `completed` and never goes back to `pending` (only `RevertInvoiceToBillPreview` flips it back).
8. **Revert guards.**
   - `RevertToBillReview` (single invoice) is allowed any time before submission.
   - `RevertToClaimScrubbing` (whole claim) is **blocked** if `InsuranceClaimPayment` has any row for the claim — prevents orphaning money.
9. **Document storage.**
   - Files are written to disk (path from `CORE_CFG_Parameters`); there is no blob/Cloud storage. Filename pattern: `<PatientCode>_<ClaimCode>_<yyyyMMddHHmmss>_<n>.<ext>`.
   - Submitting a claim re-conciles the new file list against existing rows: missing files are physically deleted from disk.
10. **Multi-tenant readiness.** The `ClaimManagementDbContext` does not include `tenant_id` columns (legacy single-tenant design). On migration to the Cloudflare-native stack, every claim-related table must be extended with `tenant_id` and scoped via the JWT-derived tenant id.
11. **RBAC.** All endpoints inherit from `CommonController`; menu/route visibility is governed by `securityService.GetChildRoutes("ClaimManagement")`. No endpoint has an explicit `[Authorize]` attribute — RBAC enforcement is at the controller level + the `RbacUser` session read.
12. **File feature tagging.** Files attached to claims use `SystemFeatureName = InsuranceClaim` and `ReferenceEntityType = InsuranceClaim` so the shared `TXN_UploadedFile` table can be filtered per feature.

---

## 9. Frontend Structure (Angular)

```
web/src/app/claim-management/
├── claim-management-main.component.{ts,html}    # router shell + provider-context menu
├── claim-management-routing.module.ts           # route table (see below)
├── claim-management.module.ts                    # registers all declarations + DL/BL services
├── bill-review/
│   ├── ins-bill-list.component.{ts,html}         # Step 1: grid of claimable bills
│   ├── ins-bill-assign-claim-code.component.{ts,html}  # Assign / validate Claim Code
│   └── ins-bill-preview.component.{ts,html,css}  # Invoice-level preview (with line items)
├── scrubbing/
│   ├── ins-claims-list.component.{ts,html}       # Step 2: list of initiated claims
│   ├── ins-claim-scrubbing.component.{ts,html}   # Per-claim scrubbing view
│   └── ins-claim-preview.component.{ts,html,css} # Print-friendly claim preview
├── payment-processing/
│   ├── payment.component.{ts,html}               # Step 4: payment-pending claims list
│   ├── new-payment.component.{ts,html}           # Add a new payment
│   └── view-payment/view-payment.component.{ts,html}  # View / edit payments
├── claim-forms/
│   ├── claim-forms.component.{ts,html}           # Form-selection shell
│   ├── form-selection/form-selection.component.{ts,html}
│   ├── echs-mrp-drug-certificate/echs-mrp-drug-certificate.component.{ts,html}
│   └── medicare-claim-form/medical-claim-form.component.{ts,html}
├── reports/
│   └── reports.component.{ts,html}              # Summary reports
├── select-insurance-provider/
│   └── ins-provider-selection.component.{ts,html}  # Pick the active credit org
├── ssf-claim/
│   ├── ssf-claim.component.{ts,html,css}         # Nepal SSF social-security flow
│   └── ssf-dl.services.ts                        # Ssf-specific DL service
└── shared/
    ├── claim-management.service.ts               # Cross-component state (active org)
    ├── claim-management.bl.service.ts            # Business logic wrappers
    ├── claim-management.dl.service.ts            # HTTP layer (matches Section 6 endpoints)
    ├── insurance-provider-selection-guard.ts     # Route guard
    ├── ssf-claim-selection-guard.ts              # SSF route guard
    ├── document-upload/document-upload.component.{ts,html}
    ├── echs-mrp-drug-certificate-print/...
    ├── medical-claim-form-print/...
    └── DTOs/                                     # TS mirrors of Section 3 DTOs
```

### Routes

| Path | Component | Guard |
|------|-----------|-------|
| `''` | `ClaimManagementMainComponent` | — |
| `''` (default) | redirect → `BillReview` | — |
| `SelectInsuranceProvider` | `InsuranceProviderSelectionComponent` | — |
| `BillReview` | `InsuranceBillListComponent` | `InsuranceSelectionGuardService` |
| `Scrubbing` | `InsuranceClaimsListComponent` | `InsuranceSelectionGuardService` |
| `PaymentProcessing` | `PaymentProcessingComponent` | `InsuranceSelectionGuardService` |
| `Reports` | `ReportsComponent` | `InsuranceSelectionGuardService` |
| `ClaimForms` | `ClaimFormsComponent` | `InsuranceSelectionGuardService` |
| `ClaimForms/FormSelection` | `FormSelectionComponent` | — |
| `ClaimForms/EchsMrpDrugCertificate` | `EchsMrpDrugCertificateComponent` | — |
| `ClaimForms/MedicalClaim` | `MedicalClaimFormComponent` | — |
| `SSFClaim` | `SSFClaimComponent` | `SsfClaimSelectionGuardService` |

### Frontend Service Layer

- `ClaimManagementDLService` — one HTTP call per backend endpoint in Section 6. Pure pass-through.
- `ClaimManagementBLService` — orchestrates multi-step flows (e.g. submit + upload).
- `ClaimManagementService` — holds the **active credit organization** and the **isOrganizationSelected** flag in `BehaviorSubject`s so all child components stay in sync. `DeactivateOrganization()` clears state and navigates back to `SelectInsuranceProvider`.

---

## 10. Cloudflare Migration Notes

When porting this module to Hono + D1, the following are the highest-leverage design decisions:

1. **D1 does not have stored procedures** — port `SP_INS_InsuranceBillReview`, `SP_INS_PendingClaims`, `SP_INS_PaymentPendingClaims`, `SP_INS_GetClaimDetailsForPreview`, `SP_INS_Claim_GetBillingCreditBillItems`, `SP_INS_Claim_GetPharmacyCreditBillItems`, and `SP_PAT_ECHSPatientsListWithVisitinformation` into either:
   - Parameterized SQL views in a migration file, or
   - Inline joins inside the route handler (Hono route), with the route kept thin and the joins extracted into a `services/claim/` file.
2. **File storage** must move from local disk to **R2**. The `CORE_CFG_Parameters.InsuranceClaimFileUploadLocation` setting should be replaced by an R2 binding (`c.env.CLAIM_FILES`). Use a presigned-upload flow (client → Hono presign endpoint → client PUTs to R2 directly) to avoid loading base64 through the worker.
3. **Multi-tenant**: every claim-related table needs `tenant_id` and every query must `WHERE tenant_id = ?` (or join through the JWT-derived tenant scope). The `ClaimManagementDbContext` is single-tenant by design today.
4. **Money precision**: keep `decimal(16, 4)` semantics. In TypeScript, do not use `number` for currency — use a decimal library (e.g. `dinero.js` or string-based BigDecimal helpers) to avoid floating-point drift on `ClaimableAmount`, `ApprovedAmount`, `RejectedAmount`, `ReceivedAmount`, `ServiceCommission`.
5. **Idempotency**: D1's atomic DML + transactions replaces the `dbContextTransaction` wrapper. Add an idempotency key for `SubmitClaim` and `InsuranceClaimPayment` so retries from the client don't double-record.
6. **Validation**: replace DTO manual checks with **Zod** schemas (one per request DTO in Section 2.3). Run them via `zValidator('json', ...)` middleware.
7. **Concurrency on per-line-item claimable toggles** (`UpdateBillingCreditItemClaimableStatus` / `UpdatePharmacyCreditItemClaimableStatus`): the current code mutates parent totals inside the same transaction. In D1, use `INSERT ... ON CONFLICT(...) DO UPDATE` and rely on D1's serializable transaction mode.
8. **Route table mirror** (Cloudflare Workers + Hono):

   ```ts
   app.get("/api/claim-management/insurance-applicable-credit-organizations", ...)
   app.get("/api/claim-management/bill-review", ...)
   app.get("/api/claim-management/is-claim-code-available", ...)
   // ... etc — kebab-case, no camelCase, to follow Cloudflare convention
   ```

9. **No `HttpContext.Session`** — the JWT carries the user/employee/tenant claims. The `RbacUser` becomes the decoded JWT payload.
10. **`TXN_UploadedFile` is a shared table.** Keep one global table in D1 and key off `SystemFeatureName` + `ReferenceEntityType` + `tenant_id` (composite index) so other modules (patient documents, lab reports) can share it.
11. **Reports & SSF**: the SSF workflow calls an external government API. That outbound call should move to a queue (Cloudflare Queues) for reliability — never block a request handler on a slow external API.
12. **Audit fields**: `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` are scattered across the modules. The migration should standardize on `created_at` / `updated_at` (TEXT, ISO-8601) + `created_by` / `updated_by` (INTEGER referencing `Employee`) so the audit story is consistent.

---

## 11. Quick-Reference: Status & Enum Strings

| Concept | Values |
|---------|--------|
| `ClaimStatus` | `initiated`, `in-review`, `payment-pending`, `partially-paid`, `settled`, `denied` |
| `SettlementStatus` (on `*_CreditBillStatus`) | `pending`, `completed` |
| `CreditModule` | `billing`, `pharmacy` |
| `SystemFeatureName` (for claim docs) | `InsuranceClaim` |
| `ReferenceEntityType` (for claim docs) | `InsuranceClaim` |
| File naming pattern | `<PatientCode>_<ClaimCode>_<yyyyMMddHHmmss>_<n>.<ext>` |
| Upload location config | `CORE_CFG_Parameters.ParameterGroupName='ClaimManagement'`, `ParameterName='InsuranceClaimFileUploadLocation'` |
| Rounding precision on money | `decimal(16, 4)` |

---

## 12. See Also

- `doc/modules/05-billing.md` — billing / credit-bill-status source tables
- `doc/modules/34-pharmacy.md` — pharmacy credit-bill-status source tables
- `doc/modules/20-insurance.md` — credit organization / scheme master
- `doc/modules/32-patient.md` — patient and visit information
- `doc/modules/48-ssf.md` — Nepal SSF social-security sub-flow
- `doc/modules/07-core.md` — `CORE_CFG_Parameters` and shared uploads
- `doc/modules/39-security.md` — RBAC user / role / permission model

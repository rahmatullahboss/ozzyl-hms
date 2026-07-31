# Accounting Module Fix — Functional Enough Scope

**Date:** 2026-05-03
**Status:** Approved

---

## Goals

Fix all broken API routes in the accounting module, add missing report types, add translations (EN/BN), and write tests. Do NOT implement bank reconciliation, settings, or advanced features.

---

## Phase 1 — Critical API Fixes

### 1.1 Create `src/routes/admin/accounts.ts`

ChartOfAccounts page calls `/api/accounts` but route doesn't exist.
- `GET /api/accounts` — List all chart of accounts
- `POST /api/accounts` — Create account head
- `GET /api/accounts/:id` — Get single account
- `PUT /api/accounts/:id` — Update account
- `DELETE /api/accounts/:id` — Soft delete account
- Requires: `accounting:write` permission
- Role access: `hospital_admin`, `md`, `director`

### 1.2 Create `src/routes/admin/reports.ts`

Reports page calls `/api/reports/*` but route doesn't exist.
- `GET /api/reports/balance-sheet` — Balance Sheet report
- `GET /api/reports/ledger/:accountId` — Ledger Report by account
- `GET /api/reports/trial-balance` — Trial Balance report
- `GET /api/reports/voucher` — Voucher Report
- `GET /api/reports/pl` — Profit & Loss (already exists, keep)
- `GET /api/reports/income-by-source` — Income by Source (already exists, keep)
- `GET /api/reports/expense-by-category` — Expense by Category (already exists, keep)
- `GET /api/reports/monthly` — Monthly Summary (already exists, keep)
- Requires: `reports:read` permission
- Role access: `hospital_admin`, `md`, `director`, `accountant`

### 1.3 Create `src/routes/admin/profit.ts`

ProfitLoss page calls `/api/profit/*` but route might not exist.
- `GET /api/profit/calculate` — Calculate profit distribution
- `GET /api/profit/history` — Profit distribution history
- `POST /api/profit/distribute` — Distribute profit to shareholders
- Requires: `profit:calculate` permission
- Role access: `hospital_admin`, `md`, `director`

### 1.4 Create `src/routes/admin/shareholders.ts`

ShareholderManagement page calls `/api/shareholders/*`.
- `GET /api/shareholders` — List shareholders
- `POST /api/shareholders` — Create shareholder
- `GET /api/shareholders/:id` — Get shareholder
- `PUT /api/shareholders/:id` — Update shareholder
- `POST /api/shareholders/calculate` — Calculate profit allocation
- `POST /api/shareholders/distribute` — Distribute profit
- Requires: `shareholders:manage` permission
- Role access: `hospital_admin`, `director`

### 1.5 Create `src/routes/admin/journal.ts`

JournalEntries page needs real API.
- `GET /api/journal` — List journal entries
- `POST /api/journal` — Create journal entry (double-entry)
- `GET /api/journal/:id` — Get single entry with line items
- `PUT /api/journal/:id` — Update entry
- `DELETE /api/journal/:id` — Soft delete (director only)
- Requires: `journal:write` permission
- Role access: `hospital_admin`, `md`, `director`, `accountant`

### 1.6 Create `src/routes/admin/voucher-verification.ts`

- `GET /api/voucher/pending` — List pending vouchers
- `POST /api/voucher/:id/verify` — Verify voucher (md/director)
- `POST /api/voucher/:id/reject` — Reject voucher (md/director)
- Requires: `voucher:verify` permission
- Role access: `md`, `director`

---

## Phase 2 — Fix Existing Pages

### 2.1 JournalEntries.tsx

Replace `DEMO_ENTRIES` and `DEMO_ACCOUNTS` placeholder data with real API calls.

### 2.2 ChartOfAccounts.tsx

Ensure it properly calls `/api/accounts` and handles CRUD operations.

### 2.3 Reports.tsx

Connect to `/api/reports/*` endpoints instead of returning static/empty data.

---

## Phase 3 — Translations

### 3.1 Translation Keys

All accounting pages must use i18n keys. Add to `web/src/lib/i18n.ts`:

```
accounting.dashboard = "Accounting Dashboard"
accounting.chartOfAccounts = "Chart of Accounts"
accounting.income = "Income"
accounting.expenses = "Expenses"
accounting.journal = "Journal Entries"
accounting.profitLoss = "Profit & Loss"
accounting.recurringExpenses = "Recurring Expenses"
accounting.reports = "Reports"
accounting.shareholders = "Shareholders"
accounting.auditLogs = "Audit Logs"
accounting.balanceSheet = "Balance Sheet"
accounting.ledger = "Ledger Report"
accounting.trialBalance = "Trial Balance"
accounting.voucherReport = "Voucher Report"
accounting.createAccount = "Create Account"
accounting.editAccount = "Edit Account"
accounting.accountName = "Account Name"
accounting.accountType = "Account Type"
accounting.accountCode = "Account Code"
accounting.parentAccount = "Parent Account"
accounting.approve = "Approve"
accounting.reject = "Reject"
accounting.verify = "Verify"
accounting.pending = "Pending"
accounting.verified = "Verified"
accounting.date = "Date"
accounting.description = "Description"
accounting.amount = "Amount"
accounting.debit = "Debit"
accounting.credit = "Credit"
accounting.balance = "Balance"
accounting.total = "Total"
accounting.actions = "Actions"
accounting.save = "Save"
accounting.cancel = "Cancel"
accounting.delete = "Delete"
accounting.edit = "Edit"
accounting.add = "Add"
accounting.search = "Search"
accounting.filter = "Filter"
accounting.export = "Export"
accounting.print = "Print"
accounting.noData = "No data available"
accounting.loading = "Loading..."
```

All keys also need Bengali translations.

---

## Phase 4 — Tests

### 4.1 API Route Tests

Create `test/accounting-api.test.ts`:
- Test income CRUD with role authorization
- Test expense CRUD with approval workflow
- Test accounts CRUD
- Test journal CRUD
- Test profit calculate and distribute
- Test reports generation
- Test role-based access (hospital_admin passes, doctor fails)

### 4.2 Integration Tests

Create `test/accounting-integration.test.ts`:
- Test ChartOfAccounts page loads
- Test IncomeList page loads with data
- Test ExpenseList page with approval flow
- Test JournalEntries page with real data
- Test Reports page generates each report type
- Test ProfitLoss page calculation
- Test ShareholderManagement page

### 4.3 Translation Tests

Create `test/accounting-i18n.test.ts`:
- Test all translation keys are defined
- Test Bengali number formatting
- Test missing keys return key name as fallback

---

## Acceptance Criteria

1. All 10 accounting pages load without console errors
2. All API routes return proper JSON responses
3. Role-based access is enforced for all endpoints
4. All text on accounting pages uses i18n keys (EN and BN)
5. 80%+ test coverage on accounting API routes
6. Tests pass with `npm test`
7. No placeholder/demo data remains in production pages

---

## File Inventory

**New files to create:**
- `src/routes/admin/accounts.ts`
- `src/routes/admin/reports.ts`
- `src/routes/admin/profit.ts`
- `src/routes/admin/journal.ts`
- `src/routes/admin/voucher-verification.ts`
- `test/accounting-api.test.ts`
- `test/accounting-integration.test.ts`
- `test/accounting-i18n.test.ts`

**Files to modify:**
- `src/schemas/accounting.ts` — Add Zod schemas for new routes
- `web/src/pages/accounting/JournalEntries.tsx` — Remove demo data
- `web/src/pages/accounting/Reports.tsx` — Connect to API
- `web/src/lib/i18n.ts` — Add accounting translation keys

# PDF Generation Center Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Review every configured PDF report, fix inconsistent totals/data mappings/detail toggles/layout risks, and verify all report types render safe printable HTML for A4 and A5.

**Architecture:** Keep report business totals sourced from existing report APIs; do not create browser-side financial truth. Centralize small display helpers in `AdminPdfGenerationPage.tsx`, preserve the existing report registry, and add contract tests that cover every report type, empty data, section toggles, and compact-table column limits.

**Tech Stack:** React, TypeScript, Vitest, HTML/CSS print templates, Cloudflare Worker report APIs.

## Global Constraints

- Total Collection and Net Income in the Daily Closing Pack must use the same server-provided management totals as the Daily Collection PDF.
- Physical cash remains distinct from management collection/net income.
- Expense request approval status comes from `approval_status` with legacy `status` fallback; payment status remains separate.
- The global “Include detail tables” switch must hide detail-level rows while retaining useful summary/category tables.
- A5 tables must use compact columns; wide A4 portrait tables must avoid 8-12-column layouts.
- User/patient values must remain HTML-escaped through `tableRows`/`escapeHtml`.
- No schema or migration change is required.

---

### Task 1: Lock report-wide rendering contracts

**Files:**
- Modify: `web/src/pages/AdminPdfGenerationPage.test.tsx`

**Interfaces:**
- Consumes: `reportOptions`, `buildReportBody`, `buildDailyClosingPackBody`.
- Produces: tests for every report type, empty-data safety, detail-toggle behavior, and compact column counts.

- [x] **Step 1: Write failing tests**
  - Assert the Daily Closing Pack contains `Total Collection`, `Total Expense`, `Net Income`, and `Physical Net Cash` using `collection.summary` values.
  - Assert all report types render without `undefined`, `[object Object]`, or thrown errors with empty data.
  - Assert detail-only headings/rows disappear when `includeDetails=false` for user, invoice, IPD, service-item, patient-detail, doctor, expense-detail, refund, activity-detail, audit, due, and delivery reports.
  - Parse every `<thead><tr>` and assert A5 tables contain at most five columns; assert A4 portrait tables contain at most seven columns.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm --filter web exec vitest run src/pages/AdminPdfGenerationPage.test.tsx`

Expected: failures for stale Daily Closing Pack math, ignored detail toggles, and wide compact layouts.

### Task 2: Fix closing-pack and expense status truth

**Files:**
- Modify: `web/src/pages/AdminPdfGenerationPage.tsx`
- Modify: `web/src/pages/AdminPdfGenerationPage.test.tsx`

**Interfaces:**
- Produces helpers `expenseApprovalStatus(row)` and `expensePaymentStatus(row)`.
- Daily Closing Pack reads `summary.total_collection`, `summary.total_expense`, `summary.net_income`, and `summary.net_cash` instead of recomputing from partial endpoints.

- [x] **Step 1: Implement minimal fixes**
  - Replace the duplicated Daily Receipt Position calculation with a Management Closing Position sourced from `collection.summary`.
  - Normalize approval status from `approval_status ?? status` and show payment status separately.
  - Keep request summaries (submitted/approved/pending/rejected) distinct from paid expense totals.

- [x] **Step 2: Run focused tests and verify GREEN**

Run: `pnpm --filter web exec vitest run src/pages/AdminPdfGenerationPage.test.tsx`

Expected: closing-pack and expense status tests pass; layout/detail tests may remain red.

### Task 3: Honor detail toggles and compact wide reports

**Files:**
- Modify: `web/src/pages/AdminPdfGenerationPage.tsx`
- Modify: `web/src/pages/AdminPdfGenerationPage.test.tsx`

**Interfaces:**
- Produces report-specific compact headers/columns for A5 and wide A4 portrait reports.

- [x] **Step 1: Implement detail-table gates**
  - Wrap detail sections for `userCollection`, `invoiceSummary`, `ipdAdmission`, `serviceItemSales`, `patientRegistration`, `doctorPayout`, `referralReport`, `doctorPerformance`, `expenses`, `refundReport`, `cashActivity`, `auditLog`, `dueBills`, and `reportDelivery`.
  - Preserve summary/category tables where they provide aggregate information.

- [x] **Step 2: Implement compact columns**
  - Use compact columns for invoice, IPD, service item, patient, doctor performance/payout, audit, and shift reports on A5.
  - Use compact columns for test, discount, doctor performance, and shift reports in A4 portrait.
  - Keep full audit/detail columns available in A4 landscape.

- [x] **Step 3: Run focused tests and verify GREEN**

Run: `pnpm --filter web exec vitest run src/pages/AdminPdfGenerationPage.test.tsx`

Expected: all report body contract tests pass.

### Task 4: Regression and release review

**Files:**
- Review: all modified source/test files.

**Interfaces:**
- Produces verified, review-ready changes only; no migration.

- [x] **Step 1: Run verification**

Run:
- `pnpm --filter web exec vitest run src/pages/AdminPdfGenerationPage.test.tsx src/pages/admin/DailyCollectionReport.test.tsx`
- `pnpm --filter web exec tsc --noEmit`
- `pnpm --filter web build`
- `git diff --check`

Expected: all commands exit 0.

- [x] **Step 2: Adversarial review**
  - Confirm no browser-side recomputation overrides server financial truth.
  - Confirm every report option has coverage.
  - Confirm no patient/staff content bypasses HTML escaping.
  - Confirm no unrelated files or migrations changed.

# Dashboard Financial Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dashboard, drilldowns, daily collection reports, and generated PDFs use one reconciled financial contract while adding the requested management KPIs and tenant-level card configuration.

**Architecture:** Keep physical cash control separate from management collection/profit. The dashboard route remains the server source of truth: each displayed card reads the same KPI-breakdown total used by its drilldown. Collections use payment rows, physical cash uses cash payment rows and drawer movements, deposits remain liabilities, and cash-basis expenses include paid operating expenses plus doctor payouts exactly once.

**Tech Stack:** Cloudflare Workers/Hono, D1/SQLite, Drizzle schema, React, TanStack Query, Vitest, Testing Library.

## Global Constraints

- Preserve unrelated working-tree changes.
- Tenant-scope every query and configuration write.
- Do not allow arbitrary SQL or formulas in dashboard configuration.
- `Total Collection` excludes patient deposits.
- `Total Expense` includes paid operating expenses and doctor payouts; approved-but-unpaid requests are not cash-basis expenses.
- `Net Income` is cash-basis collection minus total expense; deposits are excluded.
- `Physical Cash Movement` includes only cash receipts/deposits/refunds/expenses/payouts.
- Card total, source total, and drilldown total must reconcile.

---

### Task 1: Add failing backend reconciliation tests

**Files:**
- Modify: `test/integration/routes/dashboard-cash-movement-kpi.test.ts`
- Modify: `test/integration/routes/collection-report-reconciliation.test.ts`

**Interfaces:**
- Consumes: `GET /dashboard/kpi-breakdown`
- Produces: regression expectations for cash-only movement, payout-inclusive expense, net income, and source/detail reconciliation.

- [ ] Add a test proving non-cash payments are excluded from `cash_movement` SQL/source totals.
- [ ] Add a test proving `accounting_expenses` includes paid operating expense plus doctor payout and excludes approved-unpaid expense.
- [ ] Add a test proving `accounting_profit.total = accounting_income.total - accounting_expenses.total`.
- [ ] Add a test proving daily collection net excludes deposits and includes doctor payout.
- [ ] Run the focused tests and confirm the new assertions fail for the intended reasons.

### Task 2: Reconcile backend KPI calculations

**Files:**
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `src/routes/tenant/dailyCollection.ts`

**Interfaces:**
- Produces KPI metrics: `accounting_income`, `accounting_expenses`, `accounting_profit`, `lab_income`, `other_income`, `total_commission`, `total_visits`, `pending_approvals`, `cash_received`, `cash_movement`, `drawer_cash`.

- [ ] Make physical cash receipt queries filter normalized `payment_method = 'cash'` and remove all-method ledger fallback from physical-cash totals.
- [ ] Build cash-basis expense sources from paid operating expenses plus doctor payout movements, with positive expense totals and signed negative cash-movement rows.
- [ ] Make accounting profit reuse the exact income and expense helpers.
- [ ] Allocate mixed-invoice receipts across invoice items proportionally by active line total; group lab and other income without assigning the entire payment to the first matching bill column.
- [ ] Add doctor-wise commission, doctor-wise visit, pending approval, and lab-test breakdown helpers.
- [ ] Make daily collection summary use collection excluding deposits and expense including payouts.
- [ ] Run focused integration tests until green.

### Task 3: Add tenant dashboard card configuration

**Files:**
- Create: `migrations/0416_dashboard_kpi_configuration.sql`
- Modify: `src/db/schema/schema.ts`
- Modify: `tenant-schema.sql`
- Modify: `src/routes/tenant/dashboard.ts`
- Test: `test/integration/routes/dashboard-kpi-config.test.ts`

**Interfaces:**
- `GET /dashboard/kpi-config`
- `PUT /dashboard/kpi-config`
- Whitelisted fields: `metricKey`, `enabled`, `position`, `labelOverride`.

- [ ] Add the failing route tests for defaults, tenant isolation, validation, and update/read-back.
- [ ] Add the D1 table with a tenant/dashboard/metric primary key and ordering index.
- [ ] Add schema/baseline declarations.
- [ ] Implement admin-guarded GET/PUT with metric whitelist, bounded labels, deterministic ordering, and upsert.
- [ ] Run config tests until green.

### Task 4: Make React cards consume server totals

**Files:**
- Modify: `web/src/components/dashboard/ExecutiveControlKpis.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: `web/src/pages/MDDashboard.tsx`
- Modify: `web/src/lib/kpiLabels.ts`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.test.tsx`
- Modify: `web/src/pages/MDDashboard.test.tsx`

**Interfaces:**
- Consumes `kpi-config` and the same `kpi-breakdown` metric used for each card drilldown.

- [ ] Add failing tests asserting Net Income opens `accounting_profit` and uses its server total.
- [ ] Add failing tests for Total Collection, Total Expense, Lab Income, Other Income, Total Commission, Total Visits, Pending Approvals, and physical drawer cards.
- [ ] Remove duplicated client formulas and derive visible/order/labels from tenant config with safe defaults.
- [ ] Keep physical cash cards in a distinct Cash Control section.
- [ ] Run component tests until green.

### Task 5: Correct report dates and PDF reconciliation

**Files:**
- Modify: `web/src/pages/admin/DailyCollectionReport.tsx`
- Modify: `web/src/pages/admin/DailyCollectionReport.test.tsx`
- Modify: `web/src/pages/AdminPdfGenerationPage.tsx`
- Modify: `web/src/pages/AdminPdfGenerationPage.test.tsx`

**Interfaces:**
- Daily report defaults to Asia/Dhaka local date.
- PDF summary labels reflect collection, deposit liability, total expense, and net income without double counting.

- [ ] Add failing test for Bangladesh date around UTC midnight.
- [ ] Add failing PDF tests proving deposits are displayed separately and not counted twice in collection/net income.
- [ ] Add failing test proving discount report data invalidates the memo and detail toggle controls detail rendering.
- [ ] Implement fixes and compact A5 detail tables.
- [ ] Run focused web tests until green.

### Task 6: Review and verification

**Files:**
- Review all files changed by this plan only.

- [ ] Run backend focused integration tests.
- [ ] Run frontend focused component/PDF tests.
- [ ] Run TypeScript typecheck and relevant lint/build commands.
- [ ] Review the unified diff for tenant leakage, sign mistakes, double counting, pagination mismatch, stale memo dependencies, and accidental unrelated edits.
- [ ] Document any residual limitation with exact evidence.

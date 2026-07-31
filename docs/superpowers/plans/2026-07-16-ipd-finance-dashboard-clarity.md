# IPD Finance Dashboard Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hospital-admin IPD section clearly distinguish today’s IPD charges, finalized bills, actual cash receipts, deposit adjustments, settled bills, and current provisional due, while ensuring every drill-down shows the matching IPD invoice rows.

**Architecture:** Keep financial meanings separate at the data source: provisional items are charges, admission-linked `bills` are finalized invoices, `payments` are cash/receipt events, and `billing_deposits` adjustments are non-cash settlement components. Extend the existing IP billing stats route with a canonical daily snapshot and activity rows, then render those values in the dedicated IPD widget. Add a dedicated `ipd_collection` dashboard breakdown backed by admission-linked bills so the generic cash-source drawer cannot misclassify unrelated OPD/Lab rows through numeric ID collisions.

**Tech Stack:** Cloudflare Workers/Hono, D1/SQLite, TypeScript, React, React Query, react-i18next, Vitest, Testing Library.

## Global Constraints

- Scope every financial query by `tenant_id` and `bills.admission_id IS NOT NULL` for IPD classification.
- Use the payment event date for cash received, bill creation/finalization date for invoices, and provisional item creation date for charges.
- Do not infer IPD from cross-table numeric ID equality such as `invoice_items.reference_id IN (billing_provisional_items.id)`.
- Preserve existing response fields where practical so current consumers do not break.
- Display Bengali and English copy through `tenantAdmin` translations with readable fallbacks.
- Do not add a migration; all required fields already exist in production D1.

---

### Task 1: Reproduce and lock the backend accounting semantics

**Files:**
- Modify: `test/integration/routes/ip-billing.test.ts`
- Modify: `test/integration/routes/dashboard.test.ts` or the existing dashboard KPI breakdown test file that owns `/kpi-breakdown`

**Interfaces:**
- Consumes: existing `/ip-billing/stats` and `/dashboard/kpi-breakdown` routes.
- Produces: failing tests asserting IPD classification requires `bills.admission_id`, charges exclude rows without an admission, cash is sourced from `payments`, and the IPD drill-down returns invoice-capable rows.

- [ ] **Step 1: Add a failing IP billing stats test** that inspects the generated SQL and response contract for `charges_added_today`, `final_billed_today`, `cash_collected_today`, `deposit_applied_today`, `settled_bill_count_today`, `current_provisional_due`, and `today_activity`.
- [ ] **Step 2: Run `pnpm vitest run test/integration/routes/ip-billing.test.ts`** and confirm the new expectations fail because the fields and canonical SQL are absent.
- [ ] **Step 3: Add a failing dashboard breakdown test** for `metric=ipd_collection` that expects admission-linked payment rows and rejects the old `reference_id IN (billing_provisional_items.id)` classification.
- [ ] **Step 4: Run the focused dashboard route test** and confirm it fails because `ipd_collection` is not supported.

### Task 2: Implement canonical IPD daily finance queries

**Files:**
- Create: `src/lib/ipd-finance-reporting.ts`
- Modify: `src/routes/tenant/ipBilling.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Interfaces:**
- Produces: `getIpdDailySnapshot(db, tenantId, date)` and `getIpdCollectionBreakdown(db, tenantId, startDate, endDate, page)`.
- Snapshot fields: `chargesAddedToday`, `finalBilledToday`, `finalBillCountToday`, `cashCollectedToday`, `cashReceiptCountToday`, `settledToday`, `settledBillCountToday`, `discountToday`, `depositAppliedToday`, `currentProvisionalDue`, and `activity`.
- Breakdown fields match `KpiBreakdownData`: source summary plus rows containing bill/invoice, admission/patient context, gross, discount, net, paid, deposit adjustment, due, payment method, counter/user, and service names.

- [ ] **Step 1: Implement charge SQL** using active `billing_provisional_items` with `admission_id IS NOT NULL` and the selected date.
- [ ] **Step 2: Implement finalized-bill SQL** using non-cancelled `bills` with `admission_id IS NOT NULL` and bill date.
- [ ] **Step 3: Implement cash SQL** from `payments JOIN bills` using payment date and `bills.admission_id IS NOT NULL`.
- [ ] **Step 4: Implement deposit-adjustment SQL** from active `billing_deposits` joined through `reference_bill_id` to an IPD bill.
- [ ] **Step 5: Implement settled-bill SQL** as currently paid IPD bills with at least one payment event in the selected period, preventing duplicate bill totals when multiple payment rows exist.
- [ ] **Step 6: Implement current provisional due SQL** as active admitted provisional charges less remaining patient deposit balance, floored at zero.
- [ ] **Step 7: Implement activity rows** with one row per IPD bill and separately aggregated payments/deposit adjustments/items to prevent fan-out multiplication.
- [ ] **Step 8: Replace `/ip-billing/stats` calculations** with the snapshot while retaining legacy aliases such as `total_charges_today` and `settled_today`.
- [ ] **Step 9: Add the `ipd_collection` dashboard metric branch** using the shared breakdown function.
- [ ] **Step 10: Run the focused backend tests** and confirm they pass.

### Task 3: Redesign the dedicated IPD overview for immediate comprehension

**Files:**
- Create: `web/src/pages/admin/widgets/IPDBillingOverview.test.tsx`
- Modify: `web/src/pages/admin/widgets/IPDBillingOverview.tsx`
- Modify: `web/public/locales/en/tenantAdmin.json`
- Modify: `web/public/locales/bn/tenantAdmin.json`

**Interfaces:**
- Consumes: the expanded `/api/ip-billing/stats` response.
- Produces: four primary cards for charges added, finalized bills, cash received, and current provisional due; a settlement equation showing gross minus discount equals net, and cash plus deposit equals settled; an activity table with invoice and admission references.

- [ ] **Step 1: Write a failing component test** using the production-shaped example: gross `35,445`, discount `1,245`, net bill `34,200`, deposit `300`, cash `33,900`, one settled bill.
- [ ] **Step 2: Assert the test displays distinct labels** and does not show raw `adminDashboard.ipdBilling.*` keys.
- [ ] **Step 3: Run the focused widget test** and confirm it fails against the current component.
- [ ] **Step 4: Implement localized copy and the four primary cards.**
- [ ] **Step 5: Implement the settlement equation and today activity table.**
- [ ] **Step 6: Keep the existing operational counts** for admitted, admissions, discharges, package patients, and pending billing.
- [ ] **Step 7: Run the widget test and related admin widget tests** and confirm they pass.

### Task 4: Route the generic Admission/IPD cash source to the correct drill-down

**Files:**
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.test.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`

**Interfaces:**
- Produces: source target `{ metric: 'ipd_collection' }` for `mdDashboard.kpi.cashMovementSourceAdmission`; all other source behavior remains unchanged.

- [ ] **Step 1: Add a failing test** that clicks “Admission/IPD collection” and expects `metric=ipd_collection` with no raw translation-key `sourceLabel` filter.
- [ ] **Step 2: Run the focused test** and verify it fails against the current `billing_collection` mapping.
- [ ] **Step 3: Replace the metric-only mapper with a target mapper** that can override both metric and source label.
- [ ] **Step 4: Run `KPISummaryCards.test.tsx`** and confirm all existing source drill-down tests remain green.

### Task 5: Verification, production evidence, and commit

**Files:**
- Review all changed files.

**Interfaces:**
- Produces: tested code and one local commit; no production deployment without explicit approval.

- [ ] **Step 1: Run focused backend and frontend tests.**
- [ ] **Step 2: Run TypeScript/typecheck and build commands defined by the repository.**
- [ ] **Step 3: Re-run read-only production D1 comparison queries** and confirm the expected example reconciles as `35,445 - 1,245 = 34,200` and `33,900 + 300 = 34,200`.
- [ ] **Step 4: Review `git diff` for unrelated changes and sensitive output.**
- [ ] **Step 5: Commit only task files and the plan** with a descriptive message.

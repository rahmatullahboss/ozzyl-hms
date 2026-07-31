# Admin Command Center — Current-State Product Review

Date: 2026-07-27
Base: local `main` at `a4a4c47ac99412a50a6b07bc00765e67f1fd41e2`
Branch: `design/admin-command-center-specs-20260727`
Status: Reviewed baseline for the Admin Command Center program

## 1. Review objective

Review the hospital-admin dashboard from the actual `main` codebase and define the remaining work required to make management questions answerable without manually reconciling several unrelated screens.

The target user must be able to answer these questions from a predictable drill path:

1. Where did money come from, where did it go, and what remains in physical custody?
2. Which doctor generated which visits, tests, collections, discounts, commissions, waivers, settlements, and outstanding balances?
3. Which test or service produced a displayed total?
4. Which invoice explains a transaction or commission row?
5. What happened on an invoice after creation, including payments, deposits, discounts, commissions, reversals, and audit events?
6. Which patient age groups used which services during the selected reporting period?
7. Which items require management action now?

## 2. Product snapshot

### 2.1 Current admin dashboard shell

`web/src/pages/admin/Dashboard.tsx` already owns a shared reporting range and passes it to:

- `KPISummaryCards`
- `PendingRequestsSection`
- `IPDBillingOverview`

The page also renders these independent widgets:

- `RevenueTrendChart`
- `PaymentMethodBreakdown`
- `ActionRequiredPanel`
- `OperationsSnapshot`
- `LiveCashDrawerWidget`
- `AuditFeedWidget`

Those independent widgets do not currently consume the same selected period. As a result, one page can display a selected historical range above and current/today/live data below without a sufficiently strong visual distinction.

### 2.2 Existing executive analytics foundation

`web/src/pages/admin/widgets/KPISummaryCards.tsx` and the related hooks already provide substantial functionality:

- Shared range presets and custom date ranges
- Configurable KPI cards and panels
- Server-generated KPI totals
- Server-side drilldown and pagination
- Cash source breakdown
- Doctor-performance table and drawer
- Test-performance table and drawer
- Income-by-service panel
- Expense-analysis panel
- Reagent-reconciliation panel
- Doctor-specific commission drilldown
- Invoice opening through `AdminKpiInvoiceModal`

The dashboard backend already exposes:

- `/api/dashboard/kpi-summary`
- `/api/dashboard/kpi-breakdown`
- `/api/dashboard/doctor-performance`
- `/api/dashboard/doctor-performance/details`
- `/api/dashboard/test-performance`
- `/api/dashboard/test-performance/:testId/details`
- `/api/dashboard/income-services`
- `/api/dashboard/expense-analysis`
- `/api/dashboard/reagent-reconciliation`
- `/api/dashboard/stats`
- `/api/dashboard/cash-control`
- `/api/dashboard/security-alerts`

This program must reuse those routes and contracts where their semantics are already correct.

### 2.3 Doctor and compensation reporting

The current doctor contract already separates:

- Visits and visit collection
- Referred tests
- Performed tests
- Test gross and discount
- Test collection
- Referrer commission
- Performer reserve
- Earned commission
- Doctor waiver
- Payable commission
- Paid commission
- Outstanding commission

The current doctor detail drawer also exposes ordering clinician, data-entry user, performing doctor, invoice, accession number, gross, discount, net billed, collection, due, reserve, commission base, earned, waiver, payable, paid, outstanding, settlement, waiver reason, and status.

This is a strong implementation foundation. The remaining issue is not absence of data; it is presentation, navigation, invoice linking, timeline clarity, reason-code completeness, and responsive usability.

### 2.4 Action Center

A full Action Center already exists at `/h/:slug/action`, backed by `/api/action-center/summary`. It owns approvals, exceptions, collections, tasks, and next-best action behavior.

The admin dashboard still renders:

- A local `Exception & risk center` inside `KPISummaryCards`
- A separate `ActionRequiredPanel`
- A separate Pending Requests section

These surfaces overlap with the Action Center and can disagree because they are not governed by one queue contract.

### 2.5 Invoice detail

`AdminKpiInvoiceModal` already displays:

- Patient and invoice identity
- Referral information
- Discount reference and reason
- Invoice items/tests
- Payments
- Deposit adjustments
- Subtotal, discount, total, settled, and due

It does not yet provide a common deep-linkable inspector with:

- Stable URL state
- Full billing-page navigation
- Print/PDF actions
- Doctor/commission allocation
- Audit timeline
- Cancellation/refund/reversal history
- Copyable invoice identity
- Consistent use from every dashboard table

### 2.6 Patient age analytics

`web/src/pages/analytics/PatientAnalytics.tsx` references `/api/admin/analytics/patients`, but the application route currently redirects `analytics/patients` to the Reports dashboard and no matching backend route was found.

The age analytics page therefore cannot be treated as an active product capability. A new supported contract and route are required.

## 3. Confirmed improvement targets

### P0 — Explainability and navigation

1. Convert the long dashboard into a tabbed Admin Command Center with a small Overview.
2. Give every panel an explicit selected-period or live-state label.
3. Consolidate all dashboard action summaries around the existing Action Center.
4. Make invoice references clickable from doctor, test, IPD, collection, payment-method, and commission rows.
5. Replace the narrow invoice modal with a reusable, deep-linkable invoice inspector.
6. Add reconciliation envelopes so every financial summary proves its detail total.
7. Remove ambiguous use of revenue, collection, deposit, drawer cash, and commission in the same visual group.

### P1 — Doctor and patient intelligence

1. Convert doctor detail tables into responsive summary + progressive-detail views.
2. Add doctor activity timeline navigation.
3. Expose commission rule identity/version and explicit zero/no-payable reason codes.
4. Add patient age analytics calculated at service date, not current age.
5. Apply patient-detail permission checks separately from aggregate analytics.

### P2 — Operational polish

1. URL-synchronize filters, selected tab, selected doctor/test, and selected invoice.
2. Add controlled CSV/XLSX/PDF exports after reconciliation is proven.
3. Add previous-period and branch comparison only after the single-period contracts are stable.

## 4. Selected program approach

Use a modular Admin Command Center rather than adding more widgets to the existing long page.

Top-level workspaces:

- Overview
- Money
- Doctors
- Patients
- IPD
- Diagnostics
- Inventory
- Audit

The Overview contains only critical status and links. Detailed tables remain in their relevant workspace and continue to use the existing server-side pagination and source-of-truth routes.

## 5. Architectural decisions

1. Operational and financial tables remain the source of truth.
2. Reporting services assemble read models; they do not create a competing ledger.
3. Existing doctor/test/cash KPI contracts are extended rather than duplicated.
4. The existing Action Center remains the queue source of truth.
5. Shared period state is URL-addressable.
6. Each panel declares its own date basis because one global basis is not semantically valid for every measure.
7. Every money response includes reconciliation metadata.
8. Patient identity is excluded from aggregate age responses and separately permission-gated in details.
9. New reporting logic is placed in focused service modules instead of making `src/routes/tenant/dashboard.ts` larger.
10. Mobile and tablet views use progressive disclosure rather than 1,800–3,000 px tables.

## 6. Program decomposition

The program is split into independently reviewable implementation plans:

1. Shared semantic foundation, metric registry, source health, comparison, and feature-flag contract
2. Dashboard shell, URL state, period propagation, and workspace tabs
3. Financial control and Action Center consolidation
4. Doctor and commission explainability improvements
5. Shared invoice inspector
6. Patient age analytics

Each plan produces usable software without requiring all later plans to be complete.

## 7. Success criteria

The program is complete when:

- The selected reporting range is never silently mixed with today/live data.
- The Overview shows no more than the agreed critical KPI set.
- Revenue, collection, patient deposit, physical cash, doctor liability, and expense are visually and semantically separated.
- Every financial total can show `summaryTotal`, `detailTotal`, and `unexplainedDifference`.
- A doctor row opens the doctor’s visits, referred tests, performed tests, commission ledger, and activity timeline.
- A commission row explains gross, discount, reserve, commission base, rate/rule, earned, waiver, payable, paid, and outstanding.
- Every invoice reference opens the same invoice inspector.
- An invoice inspector can show items, payments, discounts/referrals, doctor compensation, and audit history.
- Age groups are computed using age on the service date and drill into permitted service aggregates.
- Action counts come from the existing Action Center contract rather than duplicate local calculations.
- Responsive layouts remain usable at 375 px, 768 px, 1,024 px, and 1,440 px.

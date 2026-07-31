# Admin Dashboard Current-State Audit

**Date:** 2026-07-22
**Review type:** Read-only product, UX, data-contract, and code-structure review
**Reviewed base:** local `main` at `79b054a199dbc877d0232015dcf9625361b0a08e`
**Production mutation:** None
**Application code changed by this review:** None

## 1. Audit objective

Determine why the hospital admin dashboard can feel shallow or vague despite displaying many values, and define evidence-based improvement priorities without replacing working reporting foundations.

The review tests whether an administrator can answer five questions from the overview:

1. What happened?
2. Compared with what?
3. Why did it happen?
4. Can the number be trusted?
5. What action is required now?

The current dashboard answers the first question in many domains. Coverage of the remaining four is inconsistent.

## 2. Scope reviewed

### Frontend composition

- `web/src/pages/admin/Dashboard.tsx`
- `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- `web/src/hooks/useExecutiveDashboardKpis.ts`
- `web/src/hooks/useExecutiveDashboardAnalytics.ts`
- `web/src/types/executiveDashboard.ts`
- `web/src/components/dashboard/ExecutiveDashboardRangeFilter.tsx`
- `web/src/components/dashboard/KpiBreakdownDrawer.tsx`
- `web/src/components/dashboard/IPDBillingOverview.tsx`
- `web/src/pages/admin/widgets/RevenueTrendChart.tsx`
- `web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx`
- `web/src/pages/admin/widgets/ActionRequiredPanel.tsx`
- `web/src/pages/admin/widgets/OperationsSnapshot.tsx`
- `web/src/pages/admin/widgets/LiveCashDrawerWidget.tsx`
- `web/src/pages/admin/widgets/AuditFeedWidget.tsx`

### Backend composition

- `src/routes/tenant/dashboard.ts`
- Executive KPI registry
- `/api/dashboard/kpi-config`
- `/api/dashboard/kpi-summary`
- `/api/dashboard/kpi-breakdown`
- Executive analytics routes
- `/api/dashboard/stats`
- `/api/dashboard/cash-control`
- `/api/dashboard/active-counters`
- `/api/action-center/summary`
- IPD billing stats route

### Existing documentation

- `docs/HOSPITAL_DASHBOARD_MONITORING_GUIDE.md`
- `docs/operations/manager-dashboard-spec.md`
- `docs/operations/manager-dashboard-plan.md`
- `docs/operations/manager-dashboard-implementation-plan.md`
- Repository architecture, coding, and performance rules

## 3. Research benchmark

The review uses the following principles from official sources:

- WHO routine health information guidance: use a limited standardized set of indicators, recommended visualizations, data-quality assessment, and decision-oriented use of facility data.
- Microsoft dashboard and KPI guidance: establish visual hierarchy, reduce unnecessary visuals, pair a KPI with comparison/target/trend context, and preserve context during drillthrough.
- Microsoft star-schema guidance: maintain a consistent grain for fact-style result sets.
- Microsoft accessibility guidance: provide keyboard access, readable labels, adequate contrast, and non-visual alternatives for charts.
- NHS data-quality guidance: decision-making depends on data being accurate, timely, consistent, and fit for purpose.
- AHRQ measure-selection guidance: prioritize measures deliberately rather than treating every available measure as equally important.

Reference URLs:

- https://www.who.int/publications/i/item/9789240060616
- https://learn.microsoft.com/en-us/power-bi/guidance/report-drillthrough
- https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-kpi
- https://learn.microsoft.com/en-us/power-bi/create-reports/service-dashboards-design-tips
- https://learn.microsoft.com/en-us/power-bi/guidance/star-schema
- https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-accessibility-creating-reports
- https://digital.nhs.uk/data-and-information/data-quality

## 4. What currently works well

The redesign should preserve these foundations.

### 4.1 Shared range filter exists

`Dashboard.tsx` owns an `ExecutiveDashboardFilters` state and passes it to `KPISummaryCards`, pending requests, and IPD billing. The range filter supports today, yesterday, this week, this month, last month, last 7 days, last 30 days, and custom dates.

### 4.2 KPI summary and drilldown share backend calculation paths

The KPI layer requests compact totals from `/api/dashboard/kpi-summary` and fetches detail only when a drilldown opens. This is directionally correct for dashboard performance and summary-to-detail navigation.

### 4.3 Server-side pagination exists

KPI breakdown, doctor performance, test performance, income analysis, expense analysis, reagent reconciliation, and IPD activity provide paginated result sets rather than requiring the browser to load complete history.

### 4.4 IPD semantics have improved

`IPDBillingOverview` receives the selected period, separates charges, finalized bills, direct payments, new deposits, deposit application, provisional due, admissions, discharges, and settlement components. It explicitly labels some values as selected-period flows and others as period-end snapshots.

### 4.5 Persistent Action Center exists

`ActionRequiredPanel` now reads `/api/action-center/summary`, distinguishes persistent and review-only capabilities, and links to filtered workstreams. This is stronger than deriving all alerts from display totals.

### 4.6 Drill rows expose useful evidence

`KpiBreakdownDrawer` can show invoice/reference, patient, discount reference, counter/user, service names, gross, discount, paid, due, amount, status, and invoice action. Inventory rows have a specialized table.

### 4.7 Loading and error states exist

Most widgets provide skeletons, retry actions, or explicit empty states. Keyboard interaction is present on many clickable cards and rows.

## 5. Quantified density

`DEFAULT_EXECUTIVE_KPI_CONFIG` contains 46 items:

- 40 enabled cards
- 5 enabled full analytics panels
- 1 disabled card (`total_visits`)

The page also renders non-registry surfaces:

- pending requests,
- IPD finance overview,
- revenue trend,
- payment method breakdown,
- persistent Action Center,
- operations snapshot,
- live cash drawers,
- audit feed,
- a second frontend risk center,
- a second operations card group,
- cash reconciliation source boxes.

The problem is therefore not insufficient data. It is insufficient prioritization and semantic separation.

## 6. Confirmed gaps

### P0-01 — Shared range does not govern the complete page

`Dashboard.tsx` passes the selected range to KPI/analytics and IPD surfaces, but not to:

- `RevenueTrendChart`
- `PaymentMethodBreakdown`
- `ActionRequiredPanel`
- `OperationsSnapshot`
- `LiveCashDrawerWidget`
- `AuditFeedWidget`

Those widgets use their own today/current/latest queries. Historical filters can therefore coexist with current values on the same page without a universal context label.

**Risk:** The user can compare numbers that do not describe the same time window.

**Decision:** Every surface must declare one of three behaviors:

1. `period` — follows the global range,
2. `as_of` — represents state at the selected period end,
3. `live` — ignores historical selection by design and displays a visible live/current badge.

### P0-02 — Temporal modes and date bases are implicit

The global filter stores only preset, start date, end date, doctor, and test search. It does not represent:

- payment date,
- bill date,
- service date,
- posting date,
- admission/discharge date,
- period flow,
- as-of snapshot,
- live queue.

Examples of mixed semantics on the same page:

- collection: period flow,
- outstanding due: current or period-end balance,
- drawer cash: live state,
- pending approvals: current queue,
- stock SKU counts: current snapshot,
- completed tests: period flow,
- bed occupancy: current snapshot.

**Risk:** Correct values can appear incorrect because their temporal basis is not visible.

### P0-03 — Default dashboard is not an overview

Forty cards and five full data panels are enabled by default. Doctor, test, income, expense, reagent, inventory, radiology, IPD, transaction, live cash, and audit analysis compete in one vertical page.

**Risk:** Important exceptions are visually equivalent to ordinary reference data; scan time and cognitive load increase.

**Decision:** Introduce role presets. Hospital Admin default should contain approximately 8–10 primary signals, one financial reconciliation section, one action queue, and compact operational/domain health summaries. Full panels move behind dedicated report links or optional configuration.

### P0-04 — KPI response lacks a trust envelope

`/api/dashboard/kpi-summary` returns:

```ts
{
  period,
  metrics: [{ metric, title, total, valueType }]
}
```

It does not return:

- `generatedAt`,
- timezone,
- date basis,
- temporal mode,
- source status,
- unavailable sources,
- stale state,
- comparison period and variance,
- target/threshold,
- warnings,
- reconciliation result,
- provider/source mode.

**Risk:** The UI cannot distinguish verified zero from missing source data or prove summary/detail parity.

### P0-05 — Summary/detail reconciliation is not a universal contract

`KpiBreakdownData` includes total, period, sources, rows, and pagination. It has no required reconciliation object. A page can show a plausible total without proving:

```text
summary total = sum(all matching detail rows)
```

**Risk:** Partial source coverage, pagination mistakes, or calculation drift can remain invisible.

**Decision:** All financial dashboard responses expose `summaryTotal`, `detailTotal`, `unexplainedDifference`, `isBalanced`, and `tolerance`.

### P0-06 — Zero, unavailable, partial, and stale are not consistently distinct

`LiveCashDrawerWidget` handles failure of active counters but not failure of the secondary cash-control request. Handover, pending, and variance values default to zero when the secondary response is absent.

Several response normalizers also replace missing numeric fields with zero after a successful response.

**Risk:** A system failure can look like a healthy zero.

**Decision:** UI states are explicit:

- `0` — complete source coverage and verified zero,
- `— / Unavailable` — required source failed,
- `Partial data` — some sources failed or are disabled,
- `Stale` — data age exceeds the domain threshold,
- `Unreconciled` — summary and complete detail differ.

### P0-07 — Persistent Action Center is duplicated by heuristic risk cards

`ActionRequiredPanel` uses the persistent Action Center. `KPISummaryCards` separately calls `riskRows()` and creates:

- receivable exposure,
- discount audit,
- expense evidence.

The thresholds are hardcoded:

- due ≥ BDT 50,000 = critical,
- discount ≥ BDT 10,000 = critical,
- any expense > 0 = watch.

Approved operating expense is normal activity, not inherently an exception.

**Risk:** Duplicate and contradictory queues reduce confidence.

**Decision:** Remove the heuristic section. All actionable exceptions must originate from Action Center rules with server-owned severity, age, amount, owner, status, and action.

### P0-08 — “Uncategorized” is treated as ordinary income

`uncategorized_income` is an enabled management card named “Uncategorized Services.”

**Risk:** Data mapping defects become normalized business categories.

**Decision:** Replace with an exception signal: unmapped amount, transaction count, affected modules, and a mapping action. It must not silently merge into a normal service category.

### P0-09 — Metric names remain semantically ambiguous

Examples:

- `Total Collection`
- `Net Income`
- `Total Doctor Commission`
- `Visit Commission`
- `Test Commission`

The dashboard contract does not specify whether commission means earned, waived, payable, approved, paid, or outstanding. `Net Income` may be an operational collection-minus-expense estimate rather than GL profit.

**Risk:** A mathematically correct value can be financially mislabeled.

**Decision:** Metric registry entries require explicit measure definition, temporal mode, date basis, source of truth, formula, desirable direction, and drill target.

### P1-01 — KPI cards lack comparison and threshold context

`KPICard` supports a trend and tooltip, but management cards generally pass only title, value, icon, loading state, and “Drill down.”

**Missing context:**

- previous comparable period,
- absolute variance,
- percentage variance,
- target/threshold,
- desirable direction,
- formula note on the card,
- freshness/data-health badge.

### P1-02 — Revenue trend is not governed by the global range

`RevenueTrendChart` maintains an independent Today/7D state and calls `/api/dashboard/stats`. It calculates a total from returned chart points in the client.

The chart title says revenue, while the underlying business meaning may be collection-style activity.

**Decision:** Use one server-owned trend endpoint with explicit metric, date basis, granularity, comparison, and exact values. Rename according to the actual measure.

### P1-03 — Payment-method breakdown is fixed to today

`PaymentMethodBreakdown` uses `getTodayGMT6()` and `/api/reports/daily-collection?date=...`, regardless of the selected range. It calculates the total and percentages in the browser.

**Decision:** Period-aware payment mix must follow selected filters. Unknown/blank methods appear as a blocking data-quality warning, not merely a grey legend item.

### P1-04 — Operations mixes flow and current state

`OperationsSnapshot` combines:

- appointments/completed consultations,
- pending/completed tests,
- occupied/available beds,
- pharmacy sales.

These have different grains and temporal meanings but no badges or funnel model.

**Decision:** Use a compact patient-flow funnel for period activity and a separate current-capacity strip for live/as-of state.

### P1-05 — Audit severity is inferred from CRUD verbs

`AuditFeedWidget` maps delete to critical, approve/reject to high, update to medium, and other actions to low. The text is a raw description such as `UPDATE bills #123`.

**Risk:** Business impact and CRUD verb are not equivalent.

**Decision:** Backend emits business event type, severity, subject, amount/field difference, actor, approval state, and target URL. Dashboard shows only high-risk or financially material events.

### P1-06 — “Top counter/user” is derived from the current page

`KpiBreakdownDrawer` calculates top counter/user from `data.rows`, which is only the current paginated page.

**Risk:** A page-local statistic is presented as a report-wide statistic.

**Decision:** Server returns aggregates over the complete filtered result or the UI labels the statistic as “Top in this page.”

### P1-07 — Generic drawer carries too many domain responsibilities

The same drawer handles cash, billing, commission, inventory, reagent, and other metrics. Its base row contract cannot fully explain specialized domains such as commission formula, rule version, reserve, waiver, settlement, or IPD charge lifecycle.

**Decision:** Keep the generic drawer for bounded previews. Use dedicated full pages for doctor, test, commission, IPD, inventory, and reconciliation analysis.

### P1-08 — Initial request fan-out is large

Default loading can initiate:

- KPI configuration,
- KPI summary,
- dashboard stats,
- two breakdown previews,
- five executive analytics panels,
- pending requests,
- IPD stats,
- revenue stats,
- daily collection,
- action-center summary,
- operations stats,
- active counters,
- cash control,
- audit feed.

Some calls are conditional, cached, or duplicate-query deduplicated, but the page still has many independently refreshing domains.

**Risk:** partial loading, timestamp drift, D1 query pressure, and poor perceived stability.

**Decision:** Reduce default surfaces, lazy-load below-fold optional panels, return compact role-oriented bundles, and expose per-domain generated timestamps.

## 7. Root causes

1. **Availability-driven design:** almost every available metric was enabled rather than prioritized by management job.
2. **Fragmented temporal ownership:** each widget chose its own date behavior.
3. **Display contract before semantic contract:** totals and rows were implemented before universal date-basis, source-status, and reconciliation metadata.
4. **Overview/report boundary erosion:** detailed report tables migrated into the dashboard.
5. **Mixed exception ownership:** persistent Action Center and frontend heuristics coexist.
6. **Generic component overreach:** one KPI/card/drawer model is expected to represent unrelated grains and formulas.

## 8. Priority decision

### P0 — Trust foundation

- Shared temporal contract and visible modes
- Source completeness/freshness envelope
- Summary/detail reconciliation
- Explicit metric registry semantics
- Focused role presets
- One persistent Action Center
- Unknown/unmapped handling
- Correct unavailable/partial states

### P1 — Explainability and action

- Comparison and threshold context
- Financial reconciliation bridge
- Dedicated drillthrough workspaces
- Patient-flow and capacity separation
- Business-level audit events
- Full-filter aggregates

### P2 — Optimization and refinement

- Saved views
- Advanced comparison presets
- Export jobs
- virtualization and lazy loading
- optional forecasting only after historical semantics are stable

## 9. Final audit verdict

The current implementation is a strong collection of reporting components but not yet a coherent management control center. The next program must not begin by adding another chart or card. It must establish a common semantic and trust layer, reduce the default surface, and ensure every important number communicates period, meaning, completeness, reconciliation, and action.

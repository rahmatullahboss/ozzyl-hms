# Next-level Admin and MD Dashboard Plan

## Request

Upgrade hospital admin, director, and MD dashboards so the owner can understand the business at a glance. KPI wording must separate bill value, cash received, physical drawer cash, due, advance, expenses, discounts, handovers, and posting queue. Date selection must drive the dashboard and each money KPI should open a breakdown showing where the money came from or where it went.

## Existing state found

- main already contains earlier dashboard improvements: admin date selector, KPI drilldown drawer, admin cash control widgets, doctor daily summaries, and MD dashboard drilldowns.
- Stale worktrees and branches still exist: admin-dashboard-date-ux, admin-dashboard-drilldowns-2, admin-dashboard-review, md-dashboard-clickable-kpis, and md-executive-kpi-clickable. Their diffs against current main include old unrelated reversions and conflict risk, so I will not merge those stale branches directly.
- Current useful endpoints already exist:
  - GET /api/dashboard/stats with date
  - GET /api/dashboard/cash-control with date
  - GET /api/reports/daily-collection with date
  - GET /api/dashboard/kpi-breakdown with metric, date, and range

## KPI language dictionary

Use these labels consistently so the dashboard cannot confuse revenue with cash:

1. Selected-day bill value: invoices or services created or posted for the selected date. This is business activity, not necessarily cash in hand.
2. Selected-day cash received: cash, bank, card, and mobile payments received on the selected date.
3. Physical drawer cash movement: actual cash drawer in or out, refunds, manual adjustments, cash drops, and handovers.
4. Outstanding patient due: receivable exposure still unpaid by patients.
5. Patient advance liability: patient deposits or advance balance still owed as service or refund settlement.
6. Pending handover cash: cashier drawer cash waiting for admin or manager acceptance.
7. Approved operating expense: approved cash or outgoing expense for the selected date.
8. Discount given: discount or waiver value that reduced bill value.
9. Accounting posting queue: journal or accounting events not yet finalized. This is a control risk, not revenue.
10. Estimated operating position: selected-day bill value minus approved expense and discount, for directional owner view.

## Admin dashboard scope

File: web/src/pages/HospitalAdminDashboard.tsx

- Rename ambiguous KPI labels:
  - Today Collection to Selected-day cash received
  - Todays Cash Movement to Physical drawer cash movement
  - Patient Due to Outstanding patient due
  - Patient Advance to Patient advance liability
  - Pending Handovers to Pending handover cash
  - Today Discount to Discount given
  - Today Expense to Approved operating expense
  - Pending Posting Events to Accounting posting queue
  - monthly and weekly bill cards should say bill value, not revenue unless accounting income is clearly shown.
- Add a compact KPI meaning guide explaining bill value, cash received, and drawer cash.
- Add an owner-facing Selected-day finance picture section with bill value, cash received, drawer cash, expense, discount, and estimated operating position.
- Keep all money and control cards clickable through KpiBreakdownDrawer when a backend metric exists.
- Preserve current date selector, Today and Yesterday shortcuts, alert title, cash control, doctor daily summary, and existing navigation.

## MD and Director dashboard scope

File: web/src/pages/MDDashboard.tsx

- Align KPI wording with the same dictionary where practical.
- Make date-scoped executive cash and control labels explicit.
- Preserve existing MD drilldown drawer behavior.
- Add a small explanation that owner KPIs separate bill value, received cash, and physical drawer movement.

## Tests first

Update or add tests before production changes:

- web/src/pages/HospitalAdminDashboard.test.tsx
  - Assert the new wording appears.
  - Assert KPI meaning guide explains bill value versus cash received versus drawer cash.
  - Assert money KPI clicks still open source breakdown with selected date.
- web/src/pages/MDDashboard.test.tsx if present; otherwise add focused coverage around MD wording and drilldown if existing setup supports it.

## Validation

Run in order:

1. Targeted dashboard tests.
2. Dashboard KPI breakdown API tests.
3. pnpm build:migrations before full test, because the fresh worktree initially lacks src/data/schema-migrations.generated.ts.
4. pnpm test.
5. pnpm build.
6. Merge branch into main only after validation passes.

## Safety notes

- No schema changes planned.
- No sensitive patient data should be logged or added to client payloads.
- Avoid heavy new dashboard backend work in hot paths. Prefer existing endpoints and existing breakdown route.
- If a backend drilldown metric is missing, do not fake it in UI. Navigate to the source page or add a tested route in a small follow-up.

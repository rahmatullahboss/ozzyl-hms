# Period-Aware IPD Dashboards and KPI Drilldown Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Admin, MD, Director, and IPD-facing finance panel follow the selected date/range, remove duplicate MD cash control UI, and prove every executive KPI drilldown returns the correct totals and invoice/ledger rows.

**Architecture:** A shared `DashboardPeriod` value is owned by each page-level date selector and passed into reusable dashboard components. The IPD backend accepts an inclusive `from`/`to` period, separates selected-period event metrics from end-date snapshot metrics, and returns paginated activity rows. Admin, MD, and Director reuse one period-aware IPD Billing component and one executive KPI/cash-control implementation; bill-backed drilldown rows open the shared invoice modal.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, React 19, React Query wrapper (`useApiQuery`), Vitest, React Testing Library, pnpm.

## Global Constraints

- Use an isolated git worktree/feature branch created from the intended local baseline; do not modify or clean the dirty review workspace.
- Do not merge to `main`, push, deploy, apply production migrations, or touch production data.
- No IPD component may compute or hard-code `today`; selected page period is the only source of truth.
- All date boundaries use Bangladesh/Dhaka reporting semantics.
- Event metrics use the inclusive selected `startDate`/`endDate`; snapshot metrics are calculated as of `endDate`.
- Preserve tenant isolation, admission-linked IPD classification, active-row rules, and cancelled-record exclusions.
- Preserve unrelated MD/Director accounting, shareholder, staffing, operations, reporting, and handover features.
- Use TDD, small scoped commits, `git diff --check`, targeted regressions, TypeScript checks, and production web build before completion.

---

## File Structure

**Create**
- `web/src/components/dashboard/dashboardPeriod.ts` — shared period type and query-string helpers used by dashboard pages/components.
- `web/src/components/dashboard/IPDBillingOverview.tsx` — reusable period-aware IPD finance/activity panel moved out of the Admin-only widget folder.
- `test/integration/routes/ip-billing-period.test.ts` — backend period, end-date snapshot, pagination, timezone, tenant, and validation tests.
- `test/integration/routes/dashboard-kpi-parity.test.ts` — parameterized executive summary/drilldown parity and category invoice-row tests.
- `web/src/components/dashboard/IPDBillingOverview.test.tsx` — reusable component robustness and period-query tests.
- `web/src/components/dashboard/ExecutiveControlKpis.test.tsx` — shared MD/Director card-to-drawer-to-invoice tests and source routing tests.

**Modify**
- `src/lib/ipd-finance-reporting.ts` — period-aware event queries, end-date snapshot queries, pagination, and period metadata support.
- `src/routes/tenant/ipBilling.ts` — validate/resolve `from`, `to`, `page`, and `pageSize`; expose period-aware response.
- `src/routes/tenant/dashboard.ts` — close KPI parity/category leakage gaps discovered by new tests without duplicating calculation sources.
- `web/src/pages/admin/Dashboard.tsx` — own Admin selected period and pass it to KPI and IPD panels.
- `web/src/pages/admin/widgets/KPISummaryCards.tsx` — consume period props instead of owning a disconnected date; keep KPI, cash, drilldown, and PDF links synchronized.
- `web/src/pages/admin/widgets/IPDBillingOverview.tsx` — remove or convert to a compatibility re-export after moving the component.
- `web/src/pages/MDDashboard.tsx` — pass resolved period to shared executive/IPD components; remove duplicate legacy cash blocks.
- `web/src/pages/DirectorDashboard.tsx` — add shared date/range selection and period wiring for executive, IPD, drilldown, and PDF links.
- `web/src/components/dashboard/ExecutiveControlKpis.tsx` — accept period/query suffix consistently and open `AdminKpiInvoiceModal` for bill-backed rows.
- `web/src/pages/IPDReports.tsx` — ensure existing From/To selection controls IPD summary/report requests if it renders finance summary data.
- Existing tests under `web/src/pages/admin`, `web/src/pages/MDDashboard.test.tsx`, and Director dashboard tests — update expectations and add duplicate/period assertions.

---

### Task 1: Create the Isolated Execution Worktree and Baseline

**Files:**
- No source files.

**Interfaces:**
- Consumes: local repository and approved plan.
- Produces: clean isolated worktree path and feature branch used by every later task.

- [ ] **Step 1: Inspect branch/worktree state without changing the current workspace**

Run:
```bash
git status -sb
git worktree list
git branch --show-current
git log -5 --oneline
```
Expected: current review workspace may contain Playwright-generated changes; record but do not restore or stage them.

- [ ] **Step 2: Create an isolated worktree from the intended local baseline**

Use a unique branch/worktree name, for example:
```bash
git worktree add ../hms-period-aware-ipd -b task/period-aware-ipd local-main-baseline
```
Replace `local-main-baseline` only after verifying the correct local commit that contains the deployed dashboard category split and performer-reserve work.

- [ ] **Step 3: Verify isolation**

Run inside the new worktree:
```bash
git status -sb
git rev-parse HEAD
```
Expected: clean feature branch; original dirty workspace unchanged.

---

### Task 2: Define the Shared Dashboard Period Contract

**Files:**
- Create: `web/src/components/dashboard/dashboardPeriod.ts`
- Test: `web/src/components/dashboard/dashboardPeriod.test.ts`

**Interfaces:**
- Produces:
```ts
export type DashboardPeriod = {
  startDate: string;
  endDate: string;
  label: string;
};

export function singleDayPeriod(date: string): DashboardPeriod;
export function dashboardPeriodQuery(period: DashboardPeriod): string;
export function appendDashboardPeriod(path: string, period: DashboardPeriod): string;
```

- [ ] **Step 1: Write failing helper tests**

Tests must assert:
```ts
expect(singleDayPeriod('2026-07-17')).toEqual({
  startDate: '2026-07-17',
  endDate: '2026-07-17',
  label: '2026-07-17',
});
expect(dashboardPeriodQuery(period)).toBe('?from=2026-07-01&to=2026-07-17');
expect(appendDashboardPeriod('/api/ip-billing/stats?page=2', period))
  .toBe('/api/ip-billing/stats?page=2&from=2026-07-01&to=2026-07-17');
```

- [ ] **Step 2: Run the test and verify RED**

Run:
```bash
pnpm --filter web exec vitest run src/components/dashboard/dashboardPeriod.test.ts
```
Expected: FAIL because module/functions do not exist.

- [ ] **Step 3: Implement the minimal typed helpers**

Validation in the UI helper should require `YYYY-MM-DD` values and throw for reversed periods so malformed local state is not silently sent.

- [ ] **Step 4: Run the helper tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/dashboardPeriod.ts web/src/components/dashboard/dashboardPeriod.test.ts
git commit -m "feat(dashboard): add shared reporting period contract"
```

---

### Task 3: Make IPD Finance Reporting Period-Aware

**Files:**
- Modify: `src/lib/ipd-finance-reporting.ts`
- Modify: `src/routes/tenant/ipBilling.ts`
- Create: `test/integration/routes/ip-billing-period.test.ts`
- Modify: `test/integration/routes/ip-billing.test.ts`

**Interfaces:**
- Update finance API to:
```ts
export interface IpdReportingPeriod {
  startDate: string;
  endDate: string;
}

export interface IpdCollectionPage {
  page: number;
  pageSize: number;
  offset: number;
}

export async function getIpdPeriodSnapshot(
  db: D1Database,
  tenantId: string,
  period: IpdReportingPeriod,
  page: IpdCollectionPage,
): Promise<IpdPeriodSnapshot>;
```
- Keep a compatibility wrapper only when existing internal callers require it:
```ts
getIpdDailySnapshot(db, tenantId, date)
```
should call the period function with identical start/end dates.

- [ ] **Step 1: Write validation and response-contract tests**

Cover requests:
```text
/ip-billing/stats?from=2026-07-01&to=2026-07-17&page=1&pageSize=20
/ip-billing/stats?from=2026-07-17&to=2026-07-17
```
Assert response includes:
```ts
period: { startDate: '2026-07-01', endDate: '2026-07-17' },
page: 1,
pageSize: 20,
totalActivityRows: number,
hasNextPage: boolean,
today_activity: Array,
```
Keep `today_activity` as a backward-compatible field if required, but its contents represent the selected period; optionally add a clearer `activity` alias.

- [ ] **Step 2: Write invalid-period tests**

Assert 400 and zero DB queries for malformed or reversed values:
```text
from=17-07-2026
from=2026-07-18&to=2026-07-17
page=0
pageSize=0
```

- [ ] **Step 3: Write event-period SQL tests**

Assert selected-period filtering for:
- provisional charges;
- final bills;
- payments and receipt counts;
- cash/non-cash split;
- deposit adjustments;
- settled bills;
- admissions/discharges;
- activity rows.

The date predicate must use one shared Dhaka-local expression for UTC-marked timestamps and preserve already-local timestamps.

- [ ] **Step 4: Write end-date snapshot tests**

Use fixtures with admissions opened/closed before, within, and after the range. Assert as-of `endDate` values for:
- `total_inpatients`;
- `pending_billing`;
- `current_provisional_due`;
- `high_due_patients`;
- `package_patients`.

For admissions, as-of-end membership must follow admission/discharge timestamps rather than current `status` alone.

- [ ] **Step 5: Write pagination and tenant tests**

Assert page 1/page 2 return different rows while global totals and `totalActivityRows` remain stable. Seed a second tenant and prove no rows/totals leak.

- [ ] **Step 6: Run RED tests**

```bash
pnpm exec vitest run test/integration/routes/ip-billing-period.test.ts test/integration/routes/ip-billing.test.ts
```
Expected: new tests fail against today-only API and 20-row cap.

- [ ] **Step 7: Implement period parsing and finance queries**

Requirements:
- resolve omitted `from`/`to` to Dhaka today for backward compatibility;
- use inclusive bounds;
- reuse a single local report date helper;
- separate event queries from as-of-end snapshot queries;
- use `LIMIT ? OFFSET ?` only for activity details, never summary totals;
- activity `ORDER BY` must be deterministic, such as timestamp descending then bill/payment id descending.

- [ ] **Step 8: Run tests and existing IPD regression**

```bash
pnpm exec vitest run test/integration/routes/ip-billing-period.test.ts test/integration/routes/ip-billing.test.ts
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/ipd-finance-reporting.ts src/routes/tenant/ipBilling.ts test/integration/routes/ip-billing-period.test.ts test/integration/routes/ip-billing.test.ts
git commit -m "feat(ipd): make finance snapshot period aware"
```

---

### Task 4: Build the Reusable Period-Aware IPD Billing Panel

**Files:**
- Create: `web/src/components/dashboard/IPDBillingOverview.tsx`
- Create: `web/src/components/dashboard/IPDBillingOverview.test.tsx`
- Modify/delete: `web/src/pages/admin/widgets/IPDBillingOverview.tsx`

**Interfaces:**
- Component props:
```ts
interface IPDBillingOverviewProps {
  period: DashboardPeriod;
  queryKeyScope: 'admin' | 'md' | 'director' | string;
  pageSize?: number;
}
```
- Component query:
```text
/api/ip-billing/stats?from=<start>&to=<end>&page=<page>&pageSize=<pageSize>
```

- [ ] **Step 1: Write failing component tests**

Assert:
- period is included in request URL and query key;
- changing period changes URL/query key;
- missing `today_activity`, `activity`, `period`, or optional totals renders zero/empty states without crashing;
- invoice/activity metadata renders when provided;
- pagination controls request the next page without changing summary totals.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter web exec vitest run src/components/dashboard/IPDBillingOverview.test.tsx
```
Expected: FAIL before reusable component exists.

- [ ] **Step 3: Move/refactor the component**

Normalize payload once:
```ts
const activity = Array.isArray(data?.activity)
  ? data.activity
  : Array.isArray(data?.today_activity)
    ? data.today_activity
    : [];
```
Every numeric field must use finite-number normalization. Keep existing visual meanings separate: charges, billed, payment, cash/non-cash, deposit applied, discount, due, admissions/discharges.

- [ ] **Step 4: Keep a compatibility re-export only if imports require it**

```ts
export { default } from '../../../components/dashboard/IPDBillingOverview';
```
Do not maintain two implementations.

- [ ] **Step 5: Run tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/dashboard/IPDBillingOverview.tsx web/src/components/dashboard/IPDBillingOverview.test.tsx web/src/pages/admin/widgets/IPDBillingOverview.tsx
git commit -m "refactor(dashboard): share period-aware IPD billing panel"
```

---

### Task 5: Synchronize the Admin Dashboard Period

**Files:**
- Modify: `web/src/pages/admin/Dashboard.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: `web/src/pages/admin/Dashboard.test.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.test.tsx`

**Interfaces:**
- `KPISummaryCards` props:
```ts
interface KPISummaryCardsProps {
  period: DashboardPeriod;
  onDateChange: (date: string) => void;
}
```
For Admin single-day selection, `period.startDate === period.endDate`.

- [ ] **Step 1: Write failing synchronization tests**

Render Admin Dashboard and change date to `2026-06-20`. Assert calls include the same period for:
```text
/api/dashboard/stats?date=2026-06-20
/api/dashboard/kpi-summary?...date=2026-06-20
/api/dashboard/kpi-breakdown?...date=2026-06-20
/api/ip-billing/stats?from=2026-06-20&to=2026-06-20
```
Assert PDF Center and Daily Pack links use the same date.

- [ ] **Step 2: Run RED tests**

Expected: IPD widget remains disconnected/today-only or date state is trapped inside KPI widget.

- [ ] **Step 3: Lift Admin date state to `Dashboard.tsx`**

Create one `DashboardPeriod` and pass it to `KPISummaryCards` and `IPDBillingOverview`. Keep date input placement unchanged by passing the change callback down.

- [ ] **Step 4: Remove internal date ownership from `KPISummaryCards`**

Use `period.endDate` for Admin's existing date-based endpoints and links. Reset drawer page/selection on parent date change.

- [ ] **Step 5: Run Admin tests**

```bash
pnpm --filter web exec vitest run src/pages/admin/Dashboard.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx src/components/dashboard/IPDBillingOverview.test.tsx
```
Expected: PASS, including prior partial-response crash regression.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/admin/Dashboard.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx web/src/pages/admin/Dashboard.test.tsx web/src/pages/admin/widgets/KPISummaryCards.test.tsx
git commit -m "fix(admin): synchronize IPD and KPI reporting date"
```

---

### Task 6: Consolidate MD Cash Control and Add Period-Aware IPD

**Files:**
- Modify: `web/src/pages/MDDashboard.tsx`
- Modify: `web/src/pages/MDDashboard.helpers.ts`
- Modify: `web/src/pages/MDDashboard.test.tsx`

**Interfaces:**
- Add/extend helper:
```ts
export function periodForDashboardRange(
  range: DashboardRange,
  customEnd: string,
  today?: string,
): DashboardPeriod;
```
Use the same resolved period to produce existing dashboard query suffixes.

- [ ] **Step 1: Write failing MD period tests**

Assert Today, 7d, 30d, and Custom generate exact inclusive periods. For custom behavior, preserve the existing UI semantics; when only an end date exists, document and test the derived start date rather than introducing a hidden second interpretation.

- [ ] **Step 2: Write duplicate-removal tests**

Assert:
- `md-executive-control-kpis` renders once;
- shared cash breakdown renders once;
- the legacy `executive-cash-control` section is absent;
- old duplicate `executive-kpis` cash cards are absent or reduced to truly non-duplicated operational/accounting cards.

- [ ] **Step 3: Write IPD period-query tests**

Change each range selector and assert `IPDBillingOverview` receives/request URL with the same resolved period as ExecutiveControlKpis and PDF links.

- [ ] **Step 4: Run RED tests**

```bash
pnpm --filter web exec vitest run src/pages/MDDashboard.test.tsx
```
Expected: duplicate cash controls and missing IPD panel fail.

- [ ] **Step 5: Implement period resolver and page wiring**

Render shared `IPDBillingOverview` near executive controls. Remove only duplicated cash UI/functions/imports (`ExecutiveCashControlSection`, duplicate cash-movement query/cards) after proving the shared component covers them. Preserve accounting income/expense/profit, action queue, operations, trends, alerts, staff, and links.

- [ ] **Step 6: Run MD tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/MDDashboard.tsx web/src/pages/MDDashboard.helpers.ts web/src/pages/MDDashboard.test.tsx
git commit -m "fix(md): unify cash control and IPD reporting period"
```

---

### Task 7: Add the Shared Period Selector and IPD Panel to Director Dashboard

**Files:**
- Modify: `web/src/pages/DirectorDashboard.tsx`
- Create/modify: `web/src/pages/DirectorDashboard.test.tsx`

**Interfaces:**
- Reuse `DashboardRange`, `periodForDashboardRange`, and `DashboardPeriod` rather than defining another period model.

- [ ] **Step 1: Write failing Director tests**

Assert:
- Today is selected by default;
- Today/7d/30d/custom selector renders;
- ExecutiveControlKpis, IPDBillingOverview, KPI drilldowns, PDF Center, and Daily Pack follow the same selected period;
- no second cash breakdown exists;
- shareholder and profit sections remain present.

- [ ] **Step 2: Run RED tests**

Expected: Director is today-only and has no IPD panel/selector.

- [ ] **Step 3: Implement selector and shared period wiring**

Do not fork MD's selector logic. Pass the resolved query suffix/period to shared components and use the end date/range consistently in links.

- [ ] **Step 4: Run Director tests**

```bash
pnpm --filter web exec vitest run src/pages/DirectorDashboard.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/DirectorDashboard.tsx web/src/pages/DirectorDashboard.test.tsx
git commit -m "feat(director): add period-aware IPD dashboard controls"
```

---

### Task 8: Open Exact Invoices from Shared Executive Drilldowns

**Files:**
- Modify: `web/src/components/dashboard/ExecutiveControlKpis.tsx`
- Create: `web/src/components/dashboard/ExecutiveControlKpis.test.tsx`
- Modify: `web/src/components/dashboard/KpiBreakdownDrawer.test.tsx` only if shared behavior needs an additional regression.

**Interfaces:**
- Add state:
```ts
const [invoiceBillId, setInvoiceBillId] = useState<number | null>(null);
```
- Pass:
```tsx
onRowClick={(row) => {
  if (row.billId) setInvoiceBillId(row.billId);
}}
```
- Render:
```tsx
{invoiceBillId ? (
  <AdminKpiInvoiceModal billId={invoiceBillId} onClose={() => setInvoiceBillId(null)} />
) : null}
```

- [ ] **Step 1: Write failing card-to-invoice tests**

For both `queryKeyScope="md"` and `queryKeyScope="director"`:
- click OPD/Lab/IPD/OT/Pharmacy/Radiology/Uncategorized card;
- verify requested metric and period;
- click a row with `billId: 6548`;
- verify invoice modal requests `/api/billing/bills/6548/details` or the established invoice-detail endpoint.

Also assert a deposit/expense row without `billId` is not offered as an invoice action.

- [ ] **Step 2: Write source-routing tests**

Assert cash source labels map exactly:
- Visit -> `opd_income` or dedicated billing source without mixing categories;
- Test -> `lab_income`;
- Admission -> `ipd_collection`;
- Operation -> `ot_income`;
- Medicine -> `pharmacy_income`;
- Radiology source -> `radiology_income`;
- Other service -> `uncategorized_income`;
- Deposit -> `deposit_collection`;
- Expense -> `accounting_expenses`;
- Payout -> `doctor_payout`.

- [ ] **Step 3: Run RED tests**

Expected: shared component lacks invoice modal/onRowClick and may lack explicit radiology mapping.

- [ ] **Step 4: Implement minimal shared behavior**

Reuse `AdminKpiInvoiceModal`; do not create another invoice viewer. Preserve pagination and close/reset state.

- [ ] **Step 5: Run component tests**

```bash
pnpm --filter web exec vitest run src/components/dashboard/ExecutiveControlKpis.test.tsx src/components/dashboard/KpiBreakdownDrawer.test.tsx src/components/dashboard/AdminKpiInvoiceModal.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/dashboard/ExecutiveControlKpis.tsx web/src/components/dashboard/ExecutiveControlKpis.test.tsx web/src/components/dashboard/KpiBreakdownDrawer.test.tsx
git commit -m "feat(dashboard): open invoices from executive KPI drilldowns"
```

---

### Task 9: Prove Executive KPI Summary and Drilldown Parity

**Files:**
- Create: `test/integration/routes/dashboard-kpi-parity.test.ts`
- Modify: `test/integration/routes/dashboard-management-kpis.test.ts`
- Modify: `test/integration/routes/dashboard-kpi-summary.test.ts`
- Modify: `test/integration/routes/dashboard-cash-movement-kpi.test.ts`
- Modify: `src/routes/tenant/dashboard.ts` only for failures proven by tests.

**Interfaces:**
- Summary endpoint:
```text
/api/dashboard/kpi-summary?from=<start>&to=<end>&metrics=<csv>
```
- Drilldown endpoint:
```text
/api/dashboard/kpi-breakdown?metric=<metric>&from=<start>&to=<end>&page=1&pageSize=50
```
Use existing compatible parameter names if the route standard is `date/range`, but summary and drilldown must resolve the identical period.

- [ ] **Step 1: Build a metric coverage table in the test**

Include all default executive metrics. For each metric declare:
```ts
{
  metric,
  valueType,
  parity: 'total' | 'snapshot-count' | 'inventory-count',
  expectsInvoiceRows: boolean,
}
```
Do not silently omit metrics. A metric that cannot have invoice rows must still prove its correct row/metadata semantics.

- [ ] **Step 2: Write parameterized summary/drilldown parity tests**

For every metric:
- request one-metric summary;
- request drilldown with same period;
- assert metric and `valueType` match;
- assert `summary.total === drilldown.total`;
- assert source amounts/count semantics match the metric;
- assert pagination does not change global total.

- [ ] **Step 3: Write invoice-level category tests**

For OPD, Lab, IPD, OT, Pharmacy, Radiology, and Uncategorized assert rows include:
```ts
{
  billId: expect.any(Number),
  invoiceNo: expect.any(String),
  patientName: expect.any(String),
  patientCode: expect.any(String),
  serviceNames: expect.any(String),
  grossAmount: expect.any(Number),
  discountAmount: expect.any(Number),
  paidAmount: expect.any(Number),
  dueAmount: expect.any(Number),
}
```
Use category-specific fixtures in the same mixed dataset and assert no cross-category invoice appears.

- [ ] **Step 4: Add ledger/non-invoice metric tests**

Assert:
- deposits include ledger reference, patient, amount, payment method/source;
- commission includes doctor and related invoice/service context where available;
- visits use count total but preserve doctor-wise billed amount/source rows;
- approvals include request type/status/reference;
- expenses and payouts remain cash/accounting-correct and are not falsely invoice-clickable.

- [ ] **Step 5: Add mixed-invoice and exclusion tests**

Seed a mixed invoice and partial payment. Assert proportional allocations sum exactly to payment amount, with no duplicate total. Add cancelled invoice/item/payment and inactive deposit fixtures and assert exclusion. Add second tenant fixtures and assert isolation.

- [ ] **Step 6: Add Dhaka boundary tests**

Use UTC-marked timestamps around 18:00 UTC and already-local timestamps around midnight. Assert selected Bangladesh date includes each transaction exactly once.

- [ ] **Step 7: Run RED parity suite**

```bash
pnpm exec vitest run test/integration/routes/dashboard-kpi-parity.test.ts test/integration/routes/dashboard-management-kpis.test.ts test/integration/routes/dashboard-kpi-summary.test.ts test/integration/routes/dashboard-cash-movement-kpi.test.ts
```
Expected: expose any summary/detail source mismatch, missing row metadata, radiology/category leakage, or pagination inconsistency.

- [ ] **Step 8: Fix only proven backend gaps**

Prefer one canonical calculation/query helper per KPI shared by summary and detail. Do not duplicate formulas to make tests pass. Maintain the optimized shared payment-allocation summary query.

- [ ] **Step 9: Run the complete dashboard backend regression**

```bash
pnpm exec vitest run test/integration/routes/dashboard-kpi-breakdown.test.ts test/integration/routes/dashboard-kpi-summary.test.ts test/integration/routes/dashboard-management-kpis.test.ts test/integration/routes/dashboard-cash-movement-kpi.test.ts test/integration/routes/dashboard-control-room-kpi.test.ts test/integration/routes/dashboard-inventory-kpis.test.ts test/integration/routes/dashboard-kpi-config.test.ts test/integration/routes/dashboard-kpi-parity.test.ts
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add test/integration/routes/dashboard-kpi-parity.test.ts test/integration/routes/dashboard-management-kpis.test.ts test/integration/routes/dashboard-kpi-summary.test.ts test/integration/routes/dashboard-cash-movement-kpi.test.ts src/routes/tenant/dashboard.ts
git commit -m "test(dashboard): enforce KPI drilldown parity"
```

---

### Task 10: Synchronize IPD Department/Report Date Selectors

**Files:**
- Modify: `web/src/pages/IPDReports.tsx`
- Modify/create: corresponding `IPDReports` tests.
- Modify other IPD finance-summary page only when code search proves it renders `/api/ip-billing/stats` or equivalent disconnected summary.

**Interfaces:**
- Existing From/To inputs produce a `DashboardPeriod` and use it for report and summary queries.

- [ ] **Step 1: Search all IPD stats consumers**

Run:
```bash
rg "/api/ip-billing/stats|ip-billing/stats|IPDBillingOverview" web/src
```
Record every consumer. Do not broaden scope to clinical date selectors such as birth date or round date.

- [ ] **Step 2: Write failing report-page synchronization tests**

Change From/To and assert every IPD finance request uses those values. Assert reversed ranges show validation and do not query.

- [ ] **Step 3: Implement shared period usage**

Use `DashboardPeriod`; do not define page-specific query concatenation.

- [ ] **Step 4: Run report-page tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/IPDReports.tsx web/src/pages/*IPDReports*.test.tsx
git commit -m "fix(ipd): synchronize report summaries with date range"
```

---

### Task 11: Full Verification and Adversarial Review

**Files:**
- No planned source additions; fixes only when verification proves a scoped defect.

**Interfaces:**
- Produces: reviewed commits, test evidence, remaining-gap report, and clean isolated worktree.

- [ ] **Step 1: Run backend targeted suites**

```bash
pnpm exec vitest run test/integration/routes/ip-billing-period.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/dashboard-kpi-breakdown.test.ts test/integration/routes/dashboard-kpi-summary.test.ts test/integration/routes/dashboard-management-kpis.test.ts test/integration/routes/dashboard-cash-movement-kpi.test.ts test/integration/routes/dashboard-control-room-kpi.test.ts test/integration/routes/dashboard-inventory-kpis.test.ts test/integration/routes/dashboard-kpi-config.test.ts test/integration/routes/dashboard-kpi-parity.test.ts
```
Expected: all pass.

- [ ] **Step 2: Run frontend targeted suites**

```bash
pnpm --filter web exec vitest run src/components/dashboard/dashboardPeriod.test.ts src/components/dashboard/IPDBillingOverview.test.tsx src/components/dashboard/ExecutiveControlKpis.test.tsx src/components/dashboard/KpiBreakdownDrawer.test.tsx src/components/dashboard/AdminKpiInvoiceModal.test.tsx src/pages/admin/Dashboard.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx src/pages/MDDashboard.test.tsx src/pages/DirectorDashboard.test.tsx
```
Expected: all pass.

- [ ] **Step 3: Run type checks**

Use repository scripts discovered in `package.json`, including backend TypeScript check and web type check if separate.
Expected: PASS.

- [ ] **Step 4: Run production web build**

```bash
npm --prefix web run build
```
Expected: successful production build.

- [ ] **Step 5: Run diff hygiene**

```bash
git diff --check
git status -sb
git diff --stat <baseline>...HEAD
```
Expected: no whitespace errors; only scoped files/commits; worktree clean after commits.

- [ ] **Step 6: Perform adversarial review**

Review specifically for:
- any `getTodayGMT6()` or internal date default still used inside IPD UI after a period prop is available;
- event queries using a different date expression than detail rows;
- snapshot queries accidentally using current status instead of as-of end date;
- deposit amounts mixed into service income;
- IPD payments counted in both IPD and another service category;
- mixed invoice rounding/double counting;
- MD duplicate cash cards/sections still rendered;
- MD/Director invoice drawer lacking row click;
- pagination total derived from current page;
- tenant predicates missing from joins/subqueries;
- unrelated generated artifacts or branch changes included.

- [ ] **Step 7: Run final scoped tests after review fixes**

Repeat every suite affected by review fixes, then rerun type checks, build, and `git diff --check`.

- [ ] **Step 8: Final report**

Report:
- isolated worktree path and feature branch;
- exact commit hashes/messages;
- changed files grouped by backend/frontend/tests;
- exact test files and pass counts;
- typecheck/build results;
- explicit confirmation that current review workspace, local `main`, remote, and production were untouched;
- any unresolved gap with a precise reason rather than claiming full coverage.

# Executive Hospital Control Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tenant-configurable executive hospital dashboard that gives Admin, MD, and Director a reliable view of finance, exact income reasons, doctor-wise visits/tests/commissions, test-wise volumes such as CBC, expense sources, approvals, and reagent reconciliation from one page.

**Architecture:** Keep scalar KPI cards on the existing `/api/dashboard/kpi-summary` and `/api/dashboard/kpi-breakdown` contracts, but move multidimensional doctor, test, service, expense, and reagent analytics into focused server modules and dedicated paginated endpoints. Reuse operational tables and existing proportional payment-allocation rules; do not introduce a duplicate reporting warehouse. Reuse one shared frontend control surface across Admin, MD, and Director, with heavy analytics loading only when enabled.

**Tech Stack:** TypeScript, Hono/Cloudflare Workers, Cloudflare D1/SQLite, Drizzle DB wrapper, React, TanStack Query through `useApiQuery`, Vitest, React Testing Library, Playwright production smoke tests.

## Live Implementation Tracker

> **Source of truth:** Maintain this table whenever a task starts, becomes blocked, passes verification, or is committed. The detailed step checkboxes below preserve the original execution plan; this tracker records the verified implementation state.
>
> **Last updated:** 2026-07-13 (Asia/Dhaka) on branch `feature/executive-hospital-control-dashboard` in isolated worktree `.worktrees/lis-main-final`.

| Task | Status | Verified evidence / remaining work |
|---|---|---|
| Task 0 — Documents and safe feature branch | ✅ Complete | Design and plan committed in `b9613bd34`; feature branch/worktree established and remote main merged. |
| Task 1 — Shared executive date range | ✅ Complete | Shared period contract, backend parser, frontend range behavior, and tests committed. |
| Task 2 — Commission split KPIs | ✅ Complete | Visit/test/other/total commission split implemented and committed. |
| Task 3 — Doctor performance analytics | ✅ Complete | Doctor summary and drilldown backend contracts implemented and committed. |
| Task 4 — Test performance analytics | ✅ Complete | Test-wise operational/financial analytics implemented and committed. |
| Task 5 — Income and expense analytics | ✅ Complete | Exact income-service and paid-expense backend analytics implemented and committed. |
| Task 6 — Reagent reconciliation analytics | ✅ Complete | Expected/actual/returned/variance/stock backend analytics implemented and committed. |
| Task 7 — Dashboard configuration | ✅ Complete | Executive analytics panel configuration implemented and committed. |
| Task 8 — Shared filters and hooks | ✅ Complete | Shared filters, query contracts, and conditional analytics loading implemented and committed. |
| Task 9 — Doctor and test UI | ✅ Complete | Doctor/test panels and drawers implemented; focused tests passed; committed in `c896f95ba`. |
| Task 10 — Income, expense, and reagent UI | ✅ Complete | Income, expense, and reagent panels are implemented with loading/error/empty states and server pagination. Host-level pagination regressions were observed failing, then fixed. Focused Task 10 tests and web TypeScript pass; committed in `288d4711`. |
| Task 11 — Real SQLite reconciliation/security | ✅ Complete | Added `test/integration/executive-dashboard-analytics-sqlite.test.ts` with production-shaped SQLite reconciliation, overlapping tenant fixtures, paid/unpaid and cancelled noise, auth/RBAC, bound SQL-like search, unsafe sort rejection, client tenant override protection, valid-future empty results, and `EXPLAIN QUERY PLAN` assertions. Focused file passes 6/6 tests; full integration suite passes 242 files / 5,982 tests. |
| Task 12 — Regression and release readiness | ✅ Complete on feature branch | Fresh focused frontend passes 12 files / 66 tests. A stale production-shaped inventory fixture missing migration `0170`/`0396`'s `lab_test_consumable_map` was updated; its focused file passes 6/6. Fresh full backend passes 837 files / 15,307 tests and integration passes 242 files / 5,982 tests. Full web verification was split deterministically because the connector could not carry a single 531-file run: 528 files passed, 3 skipped; 2,943 tests passed, 3 todo. Root and web TypeScript pass; the 429-file migration manifest and production web build succeed. Adversarial coverage includes future empty periods, 366-day/leap boundaries, refunds, partial mixed-service allocation, approved-but-unpaid expense exclusion, return-greater-than-usage clamping, mixed reagent units, missing optional workflow tables, and 101-row pagination. Query plans for doctor, test, income, expense, and reagent summary families use existing production indexes, so no migration is required. Review found and fixed MD/Director period-change pagination leakage with a RED→GREEN regression test (22/22 MDDashboard tests). `git diff --check` and residue scans pass. Release implementation is committed as `288d4711`; the verified branch is preserved pending the user’s merge/PR/keep/discard choice. |

**Current verified baseline:** full backend suite passes 837 files / 15,307 tests; full integration suite passes 242 files / 5,982 tests; full web verification passes 528 files and 2,943 tests with 3 explicit skipped/todo files/tests. Focused dashboard verification passes 12 files / 66 tests, Task 11 SQLite/security/query-plan verification passes 6/6, and the MD/Director period-reset regression file passes 22/22. Root/web TypeScript, migration-manifest generation, production web build, `git diff --check`, and changed-file conflict/debug-residue scans all exit successfully.

**Progress:** 13 of 13 tasks complete on `feature/executive-hospital-control-dashboard` (100% implementation complete; integration to `main` has not been performed).

## Global Constraints

- Reuse existing operational tables; do not create duplicate transaction or reporting tables.
- Tenant ID must come only from authenticated request context.
- Admin, MD, and Director must use the same server calculation and shared frontend components.
- Total Collection = billing/current collection + due collection + patient deposits received.
- Total Expense = paid operating expenses + doctor payouts/settlements.
- Net Income = Total Collection - Total Expense.
- Refunds remain separate from Total Expense to avoid double deduction.
- Visit Commission = `doctor_commission_accruals.source_type = 'consultation_fee'`.
- Test Commission = `source_type IN ('lab_test', 'referral')`.
- Other Doctor Commission = `source_type IN ('procedure', 'ipd_round')`.
- Total Doctor Commission = Visit Commission + Test Commission + Other Doctor Commission.
- Test business is grouped by Referring Doctor; drilldowns also show Ordering Doctor.
- Completed test count is based on one `lab_order_items` row with completed/resulted/verified/final status.
- Different reagent units must never be summed into one numeric total.
- Disabled cards or panels must not run their domain SQL.
- Inventory, Laboratory Reagent, and Radiology/X-ray monitoring render below executive, doctor, test, finance, cash, and approval sections by default.
- Production code must follow strict RED → GREEN → REFACTOR TDD; every new behavior must be observed failing before implementation.
- No arbitrary SQL, formulas, tenant filters, or source mappings may be accepted from dashboard configuration.
- No schema migration is planned. Add one only after an explicit query-plan review proves an essential index is missing.

---

## File Structure

### Backend files to create

- `src/lib/executive-dashboard-types.ts` — shared analytics pagination, source, detail-row, and response contracts; prevents route-module coupling.
- `src/lib/executive-dashboard-period.ts` — validates and resolves shared Bangladesh-local dashboard date ranges.
- `src/lib/executive-commission-analytics.ts` — scalar and doctor-wise split commission calculations.
- `src/lib/executive-doctor-analytics.ts` — doctor performance summary and visit/test/commission drilldowns.
- `src/lib/executive-test-analytics.ts` — test-wise operational volume and financial allocation.
- `src/lib/executive-income-analytics.ts` — exact service-level income aggregation using existing payment-allocation grain.
- `src/lib/executive-expense-analytics.ts` — paid expense and doctor-payout analysis.
- `src/lib/executive-reagent-analytics.ts` — mapped expected usage, actual movement usage, stock, and exceptions.

### Backend files to modify

- `src/routes/tenant/dashboard.ts` — registry additions, shared period parser usage, five analytics endpoints, scalar KPI routing.
- `src/lib/executive-inventory-kpis.ts` — preserve stock cards and delegate reagent reconciliation metrics where appropriate.

### Backend tests to create

- `test/unit/executive-dashboard-period.test.ts`
- `test/integration/routes/dashboard-commission-split.test.ts`
- `test/integration/routes/dashboard-doctor-performance.test.ts`
- `test/integration/routes/dashboard-test-performance.test.ts`
- `test/integration/routes/dashboard-income-services.test.ts`
- `test/integration/routes/dashboard-expense-analysis.test.ts`
- `test/integration/routes/dashboard-reagent-reconciliation.test.ts`
- `test/integration/executive-dashboard-analytics-sqlite.test.ts`

### Backend tests to modify

- `test/integration/routes/dashboard-kpi-config.test.ts`
- `test/integration/routes/dashboard-kpi-summary.test.ts`
- `test/integration/routes/dashboard-management-kpis.test.ts`
- `test/integration/routes/dashboard-inventory-kpis.test.ts`
- `test/integration/routes/dashboard-kpi-breakdown.test.ts`

### Frontend files to create

- `web/src/types/executiveDashboard.ts` — shared frontend API response, filter, sort, row, and query-state contracts.
- `web/src/hooks/useExecutiveDashboardAnalytics.ts`
- `web/src/components/dashboard/ExecutiveDashboardRangeFilter.tsx`
- `web/src/components/dashboard/DoctorPerformancePanel.tsx`
- `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- `web/src/components/dashboard/TestPerformancePanel.tsx`
- `web/src/components/dashboard/TestPerformanceDrawer.tsx`
- `web/src/components/dashboard/IncomeServicePanel.tsx`
- `web/src/components/dashboard/ExpenseAnalysisPanel.tsx`
- `web/src/components/dashboard/ReagentReconciliationPanel.tsx`
- Matching `.test.tsx` files for each component/hook.

### Frontend files to modify

- `web/src/hooks/useExecutiveDashboardKpis.ts`
- `web/src/components/dashboard/DashboardKpiConfigurator.tsx`
- `web/src/components/dashboard/DashboardKpiConfigurator.test.tsx`
- `web/src/components/dashboard/ExecutiveControlKpis.tsx`
- `web/src/components/dashboard/KpiBreakdownDrawer.tsx`
- `web/src/lib/kpiLabels.ts`
- `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- `web/src/pages/admin/widgets/KPISummaryCards.test.tsx`
- `web/src/pages/MDDashboard.tsx`
- `web/src/pages/MDDashboard.helpers.ts`
- `web/src/pages/MDDashboard-ranges.test.tsx`
- `web/src/pages/DirectorDashboard.tsx`
- `web/src/pages/MDDashboard.test.tsx`

### Documentation to modify

- `docs/superpowers/specs/2026-07-12-executive-hospital-control-dashboard-design.md`
- `docs/superpowers/plans/2026-07-12-executive-hospital-control-dashboard.md`

---

### Task 0: Preserve Approved Documents and Establish a Safe Feature Branch

**Files:**
- Add: `docs/superpowers/specs/2026-07-12-executive-hospital-control-dashboard-design.md`
- Add: `docs/superpowers/plans/2026-07-12-executive-hospital-control-dashboard.md`

**Interfaces:**
- Consumes: approved design specification.
- Produces: a clean feature branch based on current local work plus latest `origin/main`.

- [ ] **Step 1: Confirm current worktree and branch state**

Run:

```bash
git status -sb
git rev-parse --show-toplevel
git rev-parse --git-dir
git rev-parse --git-common-dir
```

Expected: linked worktree path ending in `.worktrees/lis-main-final`; current status may show local `main` ahead of and behind `origin/main`, plus the two untracked documents.

- [ ] **Step 2: Create the feature branch before changing production code**

Run:

```bash
git switch -c feature/executive-hospital-control-dashboard
```

Expected: `Switched to a new branch 'feature/executive-hospital-control-dashboard'`.

- [ ] **Step 3: Commit the approved specification and plan**

Run:

```bash
git add docs/superpowers/specs/2026-07-12-executive-hospital-control-dashboard-design.md docs/superpowers/plans/2026-07-12-executive-hospital-control-dashboard.md
git commit -m "docs: specify executive hospital control dashboard"
```

Expected: one documentation-only commit.

- [ ] **Step 4: Integrate the latest remote main without discarding local history**

Run:

```bash
git fetch origin
git merge origin/main
```

Expected: clean merge or explicit conflicts. Resolve conflicts by preserving current verified financial formulas and latest remote unrelated changes; do not use `git reset --hard` or force push.

- [ ] **Step 5: Run baseline dashboard tests**

Run:

```bash
pnpm test:integration -- test/integration/routes/dashboard-kpi-config.test.ts test/integration/routes/dashboard-kpi-summary.test.ts test/integration/routes/dashboard-management-kpis.test.ts test/integration/routes/dashboard-inventory-kpis.test.ts
pnpm --filter web exec vitest run src/components/dashboard/DashboardKpiConfigurator.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx src/pages/MDDashboard.test.tsx
```

Expected: PASS before feature implementation. Any baseline failure must be investigated before proceeding.

---

### Task 1: Shared Executive Date-Range Contract

**Files:**
- Create: `src/lib/executive-dashboard-types.ts`
- Create: `src/lib/executive-dashboard-period.ts`
- Create: `test/unit/executive-dashboard-period.test.ts`
- Create: `web/src/types/executiveDashboard.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `web/src/pages/MDDashboard.helpers.ts`
- Modify: `web/src/pages/MDDashboard-ranges.test.tsx`

**Interfaces:**
- Produces shared analytics types:

```ts
export interface ExecutiveAnalyticsPage {
  page: number;
  pageSize: number;
  offset: number;
}

export interface ExecutiveAnalyticsSource {
  label: string;
  amount: number;
  count: number;
  direction?: 'in' | 'out';
}

export interface ExecutiveKpiDetailRow {
  id: string;
  occurredAt: string;
  sourceType: string;
  sourceLabel: string;
  referenceNo?: string | null;
  amount: number;
  status?: string | null;
  [key: string]: unknown;
}

export interface PaginatedAnalyticsResponse<TRow, TTotals = Record<string, number>> {
  period: ExecutiveDashboardPeriod;
  totals: TTotals;
  rows: TRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}
```

- Produces backend period types:

```ts
export type ExecutivePeriodPreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | '7d' | '30d' | 'custom';

export interface ExecutiveDashboardPeriod {
  startDate: string;
  endDate: string;
  label: string;
  preset: ExecutivePeriodPreset;
}

export function resolveExecutiveDashboardPeriod(input: {
  preset?: string | null;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  today?: string;
}): ExecutiveDashboardPeriod | null;
```

- Produces frontend date types in `web/src/types/executiveDashboard.ts` and query helpers in `web/src/pages/MDDashboard.helpers.ts`:

```ts
export type DashboardRange = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | '7d' | '30d' | 'custom';
export function executiveDateParams(range: DashboardRange, startDate: string, endDate: string): string;
```

- [ ] **Step 1: Write failing backend date tests**

Add tests covering:

```ts
expect(resolveExecutiveDashboardPeriod({ preset: 'this_month', today: '2026-07-12' })).toEqual({
  startDate: '2026-07-01',
  endDate: '2026-07-12',
  label: '2026-07-01 → 2026-07-12',
  preset: 'this_month',
});

expect(resolveExecutiveDashboardPeriod({ preset: 'last_month', today: '2026-07-12' })).toEqual({
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  label: '2026-06-01 → 2026-06-30',
  preset: 'last_month',
});

expect(resolveExecutiveDashboardPeriod({ preset: 'custom', startDate: '2026-07-01', endDate: '2026-07-31' })?.startDate).toBe('2026-07-01');
expect(resolveExecutiveDashboardPeriod({ preset: 'custom', startDate: '2026-07-31', endDate: '2026-07-01' })).toBeNull();
expect(resolveExecutiveDashboardPeriod({ preset: 'custom', startDate: 'bad', endDate: '2026-07-01' })).toBeNull();
```

- [ ] **Step 2: Run the backend test and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/executive-dashboard-period.test.ts
```

Expected: FAIL because the module/function does not exist.

- [ ] **Step 3: Implement shared analytics types and the minimal period resolver**

Create `executive-dashboard-types.ts` with the exact interfaces above. Import `ExecutiveDashboardPeriod` as a type from `executive-dashboard-period.ts`; the period module must not import the shared response module, avoiding a cycle. Then implement strict `YYYY-MM-DD` parsing, Bangladesh-local date arithmetic using existing GMT+6 helpers, inclusive date bounds, and a maximum custom range of 366 days. Return `null` for invalid input.

Core implementation shape:

```ts
export function resolveExecutiveDashboardPeriod(input: ResolvePeriodInput): ExecutiveDashboardPeriod | null {
  const today = input.today ?? getTodayGMT6();
  const preset = normalizePreset(input.preset);
  if (!isIsoDate(today)) return null;
  if (preset === 'custom') {
    if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) return null;
    if (input.startDate! > input.endDate!) return null;
    if (differenceInCalendarDays(input.startDate!, input.endDate!) > 366) return null;
    return period(input.startDate!, input.endDate!, preset);
  }
  if (preset === 'yesterday') {
    const day = addDaysGMT6(today, -1);
    return period(day, day, preset);
  }
  if (preset === '7d') return period(addDaysGMT6(today, -6), today, preset);
  if (preset === '30d') return period(addDaysGMT6(today, -29), today, preset);
  const utcToday = new Date(`${today}T00:00:00Z`);
  const year = utcToday.getUTCFullYear();
  const month = utcToday.getUTCMonth();
  if (preset === 'this_week') {
    const mondayOffset = (utcToday.getUTCDay() + 6) % 7;
    return period(addDaysGMT6(today, -mondayOffset), today, preset);
  }
  if (preset === 'this_month') {
    return period(`${year}-${String(month + 1).padStart(2, '0')}-01`, today, preset);
  }
  if (preset === 'last_month') {
    const firstOfCurrent = new Date(Date.UTC(year, month, 1));
    const lastOfPrevious = new Date(firstOfCurrent.getTime() - 86_400_000);
    const previousYear = lastOfPrevious.getUTCFullYear();
    const previousMonth = lastOfPrevious.getUTCMonth();
    const previousStart = `${previousYear}-${String(previousMonth + 1).padStart(2, '0')}-01`;
    const previousEnd = lastOfPrevious.toISOString().slice(0, 10);
    return period(previousStart, previousEnd, preset);
  }
  return period(today, today, 'today');
}
```

- [ ] **Step 4: Replace route-local period construction**

In `src/routes/tenant/dashboard.ts`, make `kpi-summary`, `kpi-breakdown`, and all new analytics endpoints use `resolveExecutiveDashboardPeriod`. Return HTTP 400 with `{ error: 'Invalid dashboard date range' }` for `null`.

- [ ] **Step 5: Write failing frontend range tests**

Add exact assertions:

```ts
expect(executiveDateParams('this_month', '', '')).toBe('?preset=this_month');
expect(executiveDateParams('custom', '2026-07-01', '2026-07-31')).toBe('?preset=custom&startDate=2026-07-01&endDate=2026-07-31');
expect(executiveDateParams('custom', '2026-07-31', '2026-07-01')).toBe('');
```

- [ ] **Step 6: Run frontend range tests and verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/pages/MDDashboard-ranges.test.tsx
```

Expected: FAIL on missing presets/helper.

- [ ] **Step 7: Implement frontend query construction**

Use `URLSearchParams`; never concatenate unvalidated raw values. Preserve the existing `dateParamFor` export as a compatibility wrapper until all callers migrate.

- [ ] **Step 8: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run test/unit/executive-dashboard-period.test.ts
pnpm test:integration -- test/integration/routes/dashboard-kpi-summary.test.ts test/integration/routes/dashboard-kpi-breakdown.test.ts
pnpm --filter web exec vitest run src/pages/MDDashboard-ranges.test.tsx
```

Expected: PASS.

Commit:

```bash
git add src/lib/executive-dashboard-types.ts src/lib/executive-dashboard-period.ts src/routes/tenant/dashboard.ts test/unit/executive-dashboard-period.test.ts web/src/types/executiveDashboard.ts web/src/pages/MDDashboard.helpers.ts web/src/pages/MDDashboard-ranges.test.tsx
git commit -m "feat: unify executive dashboard date ranges"
```

---

### Task 2: Split Visit, Test, Other, and Total Doctor Commission

**Files:**
- Create: `src/lib/executive-commission-analytics.ts`
- Create: `test/integration/routes/dashboard-commission-split.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `test/integration/routes/dashboard-kpi-summary.test.ts`
- Modify: `test/integration/routes/dashboard-management-kpis.test.ts`

**Interfaces:**

```ts
export type CommissionMetric = 'visit_commission' | 'test_commission' | 'other_doctor_commission' | 'total_commission';

export interface CommissionBreakdown {
  total: number;
  totalRows: number;
  sources: Array<{ label: string; amount: number; count: number }>;
  rows: ExecutiveKpiDetailRow[];
}

export function commissionSourceTypes(metric: CommissionMetric): readonly string[];
export async function getExecutiveCommissionBreakdown(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  startDate: string;
  endDate: string;
  metric: CommissionMetric;
  page: ExecutiveAnalyticsPage;
  includeDetails?: boolean;
}): Promise<CommissionBreakdown>;
```

- [ ] **Step 1: Write failing integration tests**

Create fixture accruals for one doctor:

```text
consultation_fee = 100
lab_test = 200
referral = 50
procedure = 30
ipd_round = 20
cancelled lab_test = 999
```

Assert:

```ts
expect(summary.visit_commission.total).toBe(100);
expect(summary.test_commission.total).toBe(250);
expect(summary.other_doctor_commission.total).toBe(50);
expect(summary.total_commission.total).toBe(400);
```

Also assert each drilldown excludes the other source types and all queries bind the authenticated tenant ID.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test:integration -- test/integration/routes/dashboard-commission-split.test.ts
```

Expected: FAIL because the metrics are not registered.

- [ ] **Step 3: Implement commission source mapping**

```ts
const COMMISSION_SOURCES: Record<CommissionMetric, readonly string[]> = {
  visit_commission: ['consultation_fee'],
  test_commission: ['lab_test', 'referral'],
  other_doctor_commission: ['procedure', 'ipd_round'],
  total_commission: ['consultation_fee', 'lab_test', 'referral', 'procedure', 'ipd_round'],
};
```

Use the existing earned amount fallback:

```sql
COALESCE(NULLIF(dca.earned_commission_amount, 0), dca.commission_amount, 0)
```

Group sources by doctor name and details by accrual row. Exclude `status = 'cancelled'`.

- [ ] **Step 4: Register scalar metrics**

Add to the server whitelist and frontend-compatible summary contract:

```ts
{ metricKey: 'visit_commission', label: 'Visit Commission', section: 'management', position: 5 },
{ metricKey: 'test_commission', label: 'Test Commission', section: 'management', position: 6 },
{ metricKey: 'total_commission', label: 'Total Doctor Commission', section: 'management', position: 7 },
{ metricKey: 'other_doctor_commission', label: 'Other Doctor Commission', section: 'management', position: 8, defaultEnabled: false },
```

Keep `total_visits` in the whitelist but make it disabled by default.

- [ ] **Step 5: Make summary queries dependency-aware**

Only execute the commission helper when at least one requested commission metric is present. One helper call may calculate all four totals from grouped `source_type` rows; do not run four full scans.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm test:integration -- test/integration/routes/dashboard-commission-split.test.ts test/integration/routes/dashboard-kpi-summary.test.ts test/integration/routes/dashboard-management-kpis.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

```bash
git add src/lib/executive-commission-analytics.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-commission-split.test.ts test/integration/routes/dashboard-kpi-summary.test.ts test/integration/routes/dashboard-management-kpis.test.ts
git commit -m "feat: split doctor visit and test commissions"
```

---

### Task 3: Doctor-Wise Visit and Test Performance Backend

**Files:**
- Create: `src/lib/executive-doctor-analytics.ts`
- Create: `test/integration/routes/dashboard-doctor-performance.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Interfaces:**

```ts
export interface DoctorPerformanceRow {
  doctorId: number | null;
  doctorName: string;
  visits: number;
  visitCollection: number;
  visitCommission: number;
  tests: number;
  testCollection: number;
  testCommission: number;
  otherCommission: number;
  totalCommission: number;
}

export interface DoctorPerformanceResponse {
  period: ExecutiveDashboardPeriod;
  totals: Omit<DoctorPerformanceRow, 'doctorId' | 'doctorName'>;
  rows: DoctorPerformanceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export async function getDoctorPerformance(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  search?: string;
  sortBy?: 'visits' | 'tests' | 'visitCollection' | 'testCollection' | 'totalCommission';
  sortDirection?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}): Promise<DoctorPerformanceResponse>;
```

Drilldown endpoint mode:

```text
GET /api/dashboard/doctor-performance/details?doctorId=<numeric-id|unassigned>&tab=visits|tests|commissions
```

Use the literal `unassigned` sentinel for the summary row whose `doctorId` is `null`; never coerce it to doctor ID `0`.

- [ ] **Step 1: Write failing doctor aggregation tests**

Create production-shaped fixtures where:

- Doctor A has two visit invoice lines and one referred CBC.
- Doctor A is Referring Doctor for CBC but Doctor B is Ordering Doctor.
- Doctor B has one visit.
- One consultation uses legacy `bills.doctor_visit_bill` without invoice items.
- One cancelled bill exists.
- One mixed invoice has visit and test lines with a partial payment.

Assert Doctor A row keeps visit and test counts separate and uses proportional paid allocation. Assert test business belongs to Referring Doctor, while test drilldown exposes both doctors.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test:integration -- test/integration/routes/dashboard-doctor-performance.test.ts
```

Expected: 404 or missing module.

- [ ] **Step 3: Build reusable visit facts**

Create a CTE that uses the current consultation predicate and fallback rule:

```sql
WITH visit_lines AS (
  SELECT ii.id AS line_id, ii.tenant_id, ii.bill_id, ii.description,
         COALESCE(ii.quantity, 1) AS quantity,
         COALESCE(ii.line_total, ii.unit_price * COALESCE(ii.quantity, 1), 0) AS line_total
  FROM invoice_items ii
  WHERE ii.tenant_id = ?
    AND COALESCE(ii.status, 'active') != 'cancelled'
    AND (
      LOWER(TRIM(COALESCE(ii.item_category, ''))) IN ('consultation', 'doctor_visit', 'opd', 'visit')
      OR LOWER(COALESCE(ii.description, '')) LIKE '%consult%'
      OR LOWER(COALESCE(ii.description, '')) LIKE '%doctor%'
    )
  UNION ALL
  SELECT NULL, b.tenant_id, b.id, 'Doctor visit', 1, COALESCE(b.doctor_visit_bill, 0)
  FROM bills b
  WHERE b.tenant_id = ?
    AND COALESCE(b.doctor_visit_bill, 0) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM invoice_items existing
      WHERE existing.tenant_id = b.tenant_id
        AND existing.bill_id = b.id
        AND COALESCE(existing.status, 'active') != 'cancelled'
        AND (
          LOWER(TRIM(COALESCE(existing.item_category, ''))) IN ('consultation', 'doctor_visit', 'opd', 'visit')
          OR LOWER(COALESCE(existing.description, '')) LIKE '%consult%'
          OR LOWER(COALESCE(existing.description, '')) LIKE '%doctor%'
        )
    )
)
```

Resolve visit doctor using `COALESCE(v.doctor_id, b.referring_doctor_id)`.

- [ ] **Step 4: Build test business facts**

Use `lab_order_items` as the operational test-count grain. Link each billed test through the production relationship `invoice_items.item_category = 'test' AND invoice_items.reference_id = lab_order_items.id`; use `lab_orders.bill_id` only as a bill-level fallback for legacy records without a linked invoice item. Resolve Ordering Doctor with `lab_orders.ordered_by -> users.id -> doctors.user_id`; when that mapping is absent, show the ordering user name separately or `Unassigned Ordering Doctor`. Resolve Referring Doctor from the linked bill/prescription/commission attribution already persisted for the test. Never infer Ordering Doctor from Referring Doctor or vice versa.

- [ ] **Step 5: Join commission aggregates without multiplying rows**

Aggregate visit/test/other commission by doctor in separate CTEs before joining the doctor dimension. Do not join raw accruals directly to raw visits/tests.

- [ ] **Step 6: Implement endpoint validation**

Allowed sort fields are a fixed whitelist. Search is trimmed, capped at 80 characters, and bound as a parameter. Page size must be 25, 50, or 100.

- [ ] **Step 7: Add details tabs**

Visits tab returns one visit/consultation fact row. Tests tab returns one lab order item with:

```ts
{
  testName,
  patientName,
  referringDoctorName,
  orderingDoctorName,
  invoiceNo,
  accessionNo,
  status,
  billedAmount,
  collectedAmount,
  dueAmount,
  testCommission,
}
```

Commissions tab returns one accrual row.

- [ ] **Step 8: Verify GREEN and commit**

```bash
pnpm test:integration -- test/integration/routes/dashboard-doctor-performance.test.ts test/integration/routes/dashboard-commission-split.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

```bash
git add src/lib/executive-doctor-analytics.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-doctor-performance.test.ts
git commit -m "feat: add doctor performance analytics"
```

---

### Task 4: Test-Wise Laboratory Performance Backend

**Files:**
- Create: `src/lib/executive-test-analytics.ts`
- Create: `test/integration/routes/dashboard-test-performance.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Interfaces:**

```ts
export interface TestPerformanceRow {
  testId: number;
  testCode: string | null;
  testName: string;
  ordered: number;
  completed: number;
  cancelled: number;
  pending: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
}

export async function getTestPerformance(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  search?: string;
  status?: 'all' | 'completed' | 'pending' | 'cancelled';
  sortBy?: 'completed' | 'ordered' | 'collected' | 'due' | 'testCommission';
  sortDirection?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}): Promise<PaginatedAnalyticsResponse<TestPerformanceRow>>;
```

- [ ] **Step 1: Write failing CBC acceptance tests**

Fixture cases:

1. CBC completed with billed amount ৳500 and collected amount ৳500.
2. CBC completed with billed amount ৳500 and collected amount ৳0.
3. CBC pending with billed amount ৳300 and collected amount ৳300.
4. CBC cancelled with billed and collected amounts excluded.
5. CBC catalog-code (`CBC`) and snapshot/catalog-name search.
6. RBS completed.

Assertions:

```ts
expect(cbc.completed).toBe(2);
expect(cbc.ordered).toBe(4);
expect(cbc.cancelled).toBe(1);
expect(cbc.pending).toBe(1);
expect(cbc.collected).toBe(800);
expect(searchRows.map((row) => row.testName)).toContain('Complete Blood Count');
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test:integration -- test/integration/routes/dashboard-test-performance.test.ts
```

Expected: 404 or missing helper.

- [ ] **Step 3: Implement operational status aggregation**

Use one normalized test identity:

```sql
i.lab_test_id AS resolved_test_id,
COALESCE(NULLIF(TRIM(i.test_name), ''), NULLIF(TRIM(t.name), ''), 'Test #' || i.lab_test_id) AS test_name,
NULLIF(TRIM(t.code), '') AS test_code
```

`lab_order_items.lab_test_id` is required by the production schema, so do not create an artificial test ID `0`. Search only persisted values: catalog code, order-item snapshot name, and catalog name. Use mutually exclusive status buckets. A cancelled row must not also count as pending. Completion date uses `verified_at`, then `completed_at`, then `updated_at`; ordered date uses the parent order/item creation timestamp available in production (`lab_orders.created_at` or item timestamp when present).

- [ ] **Step 4: Implement billed/collected/due facts separately**

Aggregate active laboratory invoice lines by joining `invoice_items.reference_id = lab_order_items.id`, `invoice_items.item_category = 'test'`, and matching `tenant_id`. Allocate each payment proportionally to line value using the same allocation rule as `accountingIncomeAllocationCte`. For legacy test lines without a valid order-item reference, report them only in the service-income analysis; do not fabricate completed-test volume. Calculate row-level due as `MAX(0, billed - collected)` before aggregation.

- [ ] **Step 5: Add test commission aggregate**

Aggregate `lab_test` and `referral` accruals using the persisted `doctor_commission_accruals.lab_order_item_id` or `lab_test_id`. Prefer `lab_order_item_id` when both are present. Accruals without either key remain under `Unassigned Test Commission` in commission details and must not be spread across test rows.

- [ ] **Step 6: Implement test details endpoint**

```text
GET /api/dashboard/test-performance/:testId/details
```

Return patient, accession, invoice, statuses, Referring Doctor, Ordering Doctor, billed, collected, due, and commission. Resolve Ordering Doctor through `lab_orders.ordered_by -> doctors.user_id`; resolve Referring Doctor from the bill/prescription/commission attribution and keep it `Unassigned` when no persisted referrer exists.

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm test:integration -- test/integration/routes/dashboard-test-performance.test.ts test/integration/routes/dashboard-doctor-performance.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

```bash
git add src/lib/executive-test-analytics.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-test-performance.test.ts
git commit -m "feat: add test-wise laboratory analytics"
```

---

### Task 5: Exact Service-Level Income and Paid Expense Analysis

**Files:**
- Create: `src/lib/executive-income-analytics.ts`
- Create: `src/lib/executive-expense-analytics.ts`
- Create: `test/integration/routes/dashboard-income-services.test.ts`
- Create: `test/integration/routes/dashboard-expense-analysis.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Interfaces:**

```ts
export interface IncomeServiceRow {
  serviceName: string;
  category: string;
  transactions: number;
  units: number;
  collection: number;
  share: number;
}

export interface ExpenseAnalysisRow {
  category: string;
  transactions: number;
  paidAmount: number;
  paymentMethods: string[];
  statuses: string[];
}
```

- [ ] **Step 1: Write failing income-service tests**

Create a mixed invoice with Doctor Consultation, Admission Fee, Bed Charge, CBC, and X-Ray Chest, plus a partial payment. Assert rows are exact service names and allocated totals sum to the non-deposit payment amount.

Assert no user-facing row is merely `OPD` or `IPD` when active invoice items contain exact descriptions.

- [ ] **Step 2: Write failing expense-analysis tests**

Create:

- paid electricity expense,
- approved but unpaid salary expense,
- rejected expense,
- cash doctor payout,
- non-cash paid expense.

Assert only paid operating expense and payout contribute to Total Expense; payment method is preserved; pending approval does not count.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm test:integration -- test/integration/routes/dashboard-income-services.test.ts test/integration/routes/dashboard-expense-analysis.test.ts
```

Expected: missing endpoints.

- [ ] **Step 4: Extract income allocation SQL into the focused module**

Move or share the current payment-allocation CTE without changing Total Collection behavior. Provide:

```ts
export function executivePaymentAllocationCte(): string;
export async function getIncomeServiceAnalysis(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  category?: 'all' | 'lab' | 'non_lab';
  search?: string;
  sortBy?: 'collection' | 'transactions' | 'units' | 'serviceName';
  sortDirection?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}): Promise<PaginatedAnalyticsResponse<IncomeServiceRow>>;
```

Keep legacy bill fallback only when no active invoice item allocation base exists.

- [ ] **Step 5: Implement expense analysis from existing paid predicates**

Reuse the same paid-expense predicate and doctor-payout reference types used by `getAccountingExpenseKpiBreakdown`. Aggregate summaries separately, then combine and paginate details globally.

- [ ] **Step 6: Add endpoints**

```text
GET /api/dashboard/income-services
GET /api/dashboard/expense-analysis
```

Both use the shared executive period and fixed sort whitelists.

- [ ] **Step 7: Verify totals reconcile**

Tests must assert:

```ts
sum(incomeServiceRows.collection) === labIncome + otherServiceIncome;
sum(expenseRows.paidAmount) === accounting_expenses;
```

Deposits appear in Total Collection but not in a clinical service row.

- [ ] **Step 8: Verify GREEN and commit**

```bash
pnpm test:integration -- test/integration/routes/dashboard-income-services.test.ts test/integration/routes/dashboard-expense-analysis.test.ts test/integration/routes/dashboard-management-kpis.test.ts test/integration/routes/dashboard-kpi-summary.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

```bash
git add src/lib/executive-income-analytics.ts src/lib/executive-expense-analytics.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-income-services.test.ts test/integration/routes/dashboard-expense-analysis.test.ts
git commit -m "feat: add exact income and expense analysis"
```

---

### Task 6: Reagent Expected-vs-Actual Reconciliation

**Files:**
- Create: `src/lib/executive-reagent-analytics.ts`
- Create: `test/integration/routes/dashboard-reagent-reconciliation.test.ts`
- Modify: `src/lib/executive-inventory-kpis.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `test/integration/routes/dashboard-inventory-kpis.test.ts`

**Interfaces:**

```ts
export interface ReagentReconciliationRow {
  consumableId: number;
  reagentCode: string | null;
  reagentName: string;
  unit: string;
  completedTests: number;
  expectedUsage: number;
  actualUsage: number;
  returnedQuantity: number;
  variance: number;
  currentStock: number;
  reorderLevel: number;
  status: 'ok' | 'unmapped' | 'missing_consumption' | 'over_consumption' | 'low_stock' | 'out_of_stock' | 'qc_blocked';
}
```

- [ ] **Step 1: Write failing reagent tests**

Fixtures:

- CBC mapped to CBC Reagent at `qty_per_test = 1`.
- Two completed CBC tests.
- Actual usage-out of 3 and return of 1.
- One completed RBS with no mapping.
- One reagent in `ml`, one in `test`.
- One quarantined lot.

Assert:

```ts
expect(cbc.expectedUsage).toBe(2);
expect(cbc.actualUsage).toBe(2);
expect(cbc.variance).toBe(0);
expect(response.exceptions.unmappedCompletedTests).toBe(1);
expect(response.quantityTotals).toEqual([
  { unit: 'test', quantity: 2 },
  { unit: 'ml', quantity: expect.any(Number) },
]);
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test:integration -- test/integration/routes/dashboard-reagent-reconciliation.test.ts
```

Expected: missing endpoint/helper.

- [ ] **Step 3: Implement expected usage**

Aggregate completed test items joined to active `lab_test_consumable_map`:

```sql
SUM(completed_test_count * COALESCE(map.qty_per_test, 0)) AS expected_usage
```

Do not invent consumption for unmapped tests. Return them as a separate exception list/count.

- [ ] **Step 4: Implement actual usage and returns**

```sql
SUM(CASE WHEN movement_type = 'usage_out' THEN ABS(quantity) ELSE 0 END) AS usage_out,
SUM(CASE WHEN movement_type = 'return' THEN ABS(quantity) ELSE 0 END) AS returned_quantity
```

`actualUsage = usage_out - returned_quantity`.

- [ ] **Step 5: Attach current stock and QC**

Aggregate available stock by consumable and unit, preserving lot-level QC/expiry in detail rows. A quarantined/rejected/failed lot cannot count as usable stock.

- [ ] **Step 6: Add safe reagent summary metrics and a multi-unit panel**

Register:

- keep existing `lab_reagent_consumed` as the scalar **Reagent Types Used** distinct-SKU count,
- `unmapped_lab_tests` — scalar count,
- `consumption_exceptions` — scalar count,
- `reagent_reconciliation_table` — panel registry entry.

Do not add a numeric `reagent_quantity_used` card because the compact KPI summary contract is scalar and reagent units can differ. The reconciliation endpoint returns `quantityTotals: Array<{ unit: string; quantity: number }>`; the panel header renders separate chips such as `125 test` and `300 ml`, never a combined number.

- [ ] **Step 7: Add endpoint and optional-table isolation**

```text
GET /api/dashboard/reagent-reconciliation
```

If one optional lab movement/mapping table is unavailable, return an `availability` object and keep finance/other dashboard endpoints operational. Do not catch tenant/security errors as zero data.

- [ ] **Step 8: Verify GREEN and commit**

```bash
pnpm test:integration -- test/integration/routes/dashboard-reagent-reconciliation.test.ts test/integration/routes/dashboard-inventory-kpis.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

```bash
git add src/lib/executive-reagent-analytics.ts src/lib/executive-inventory-kpis.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-reagent-reconciliation.test.ts test/integration/routes/dashboard-inventory-kpis.test.ts
git commit -m "feat: reconcile tests with reagent usage"
```

---

### Task 7: Registry, Configuration, and Default Section Order

**Files:**
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `test/integration/routes/dashboard-kpi-config.test.ts`
- Modify: `test/integration/routes/dashboard-kpi-summary.test.ts`
- Modify: `web/src/hooks/useExecutiveDashboardKpis.ts`
- Modify: `web/src/components/dashboard/DashboardKpiConfigurator.tsx`
- Modify: `web/src/components/dashboard/DashboardKpiConfigurator.test.tsx`

**Interfaces:**

Extend section keys:

```ts
export type ExecutiveDashboardSection =
  | 'management'
  | 'doctor_performance'
  | 'test_performance'
  | 'income_analysis'
  | 'expense_analysis'
  | 'cash_control'
  | 'approvals'
  | 'inventory'
  | 'lab_reagent'
  | 'radiology_stock';
```

Define registry defaults separately from the resolved config response:

```ts
export interface ExecutiveDashboardRegistryItem {
  metricKey: ExecutiveDashboardMetric;
  section: ExecutiveDashboardSection;
  kind: 'card' | 'panel';
  defaultEnabled: boolean;
  position: number;
  label: string;
}

export interface ExecutiveDashboardKpiConfigItem
  extends Omit<ExecutiveDashboardRegistryItem, 'defaultEnabled'> {
  enabled: boolean;
  labelOverride: string | null;
}
```

`kind`, section, default label, and default position come from the server registry. The database stores only tenant overrides (`enabled`, `position`, and `label_override`); `mergeExecutiveKpiConfig` returns the resolved item including `kind`.

- [ ] **Step 1: Write failing config tests**

Assert registry contains all new keys, `total_visits` is disabled by default, and ordering places stock domains last. Assert PUT still only accepts `metricKey`, `enabled`, `position`, and `labelOverride`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm test:integration -- test/integration/routes/dashboard-kpi-config.test.ts test/integration/routes/dashboard-kpi-summary.test.ts
pnpm --filter web exec vitest run src/components/dashboard/DashboardKpiConfigurator.test.tsx
```

Expected: failures for missing keys/kind/order.

- [ ] **Step 3: Extend the server whitelist**

Add card and panel registry rows with stable positions:

```text
0–8   management cards
10    doctor_performance_table
20    test_volume_table
30    income_service_breakdown
40    expense_source_breakdown
50–55 cash and approvals
70–79 inventory
80–89 lab reagent
90–99 radiology
```

Position remains within the existing database constraint `0–100`.

- [ ] **Step 4: Preserve existing tenant overrides**

`mergeExecutiveKpiConfig` must combine stored rows with new defaults. Existing stored labels/order stay unchanged; new metrics receive registry defaults.

- [ ] **Step 5: Update configurator UI**

Render cards and panels with type badges. Section master switches update child entries only. Do not add formula editing.

- [ ] **Step 6: Verify disabled metrics do not query**

Summary tests inspect prepared SQL markers and prove disabled commission/reagent domains are not executed.

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm test:integration -- test/integration/routes/dashboard-kpi-config.test.ts test/integration/routes/dashboard-kpi-summary.test.ts
pnpm --filter web exec vitest run src/components/dashboard/DashboardKpiConfigurator.test.tsx
pnpm exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

Expected: PASS.

```bash
git add src/routes/tenant/dashboard.ts test/integration/routes/dashboard-kpi-config.test.ts test/integration/routes/dashboard-kpi-summary.test.ts web/src/hooks/useExecutiveDashboardKpis.ts web/src/components/dashboard/DashboardKpiConfigurator.tsx web/src/components/dashboard/DashboardKpiConfigurator.test.tsx
git commit -m "feat: configure executive analytics panels"
```

---

### Task 8: Shared Frontend Analytics Hook and Global Range Filter

**Files:**
- Modify: `web/src/types/executiveDashboard.ts`
- Create: `web/src/hooks/useExecutiveDashboardAnalytics.ts`
- Create: `web/src/hooks/useExecutiveDashboardAnalytics.test.tsx`
- Create: `web/src/components/dashboard/ExecutiveDashboardRangeFilter.tsx`
- Create: `web/src/components/dashboard/ExecutiveDashboardRangeFilter.test.tsx`
- Modify: `web/src/pages/MDDashboard.tsx`
- Modify: `web/src/pages/DirectorDashboard.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`

**Interfaces:**

```ts
export type DoctorSort = 'visits' | 'tests' | 'visitCollection' | 'testCollection' | 'totalCommission';
export type TestSort = 'completed' | 'ordered' | 'collected' | 'due' | 'testCommission';

export interface ExecutiveDashboardFilters {
  preset: DashboardRange;
  startDate: string;
  endDate: string;
  doctorId?: number;
  testSearch?: string;
}

export interface DoctorPerformanceRow {
  doctorId: number | null;
  doctorName: string;
  visits: number;
  visitCollection: number;
  visitCommission: number;
  tests: number;
  testCollection: number;
  testCommission: number;
  otherCommission: number;
  totalCommission: number;
}

export interface DoctorPerformanceResponse {
  period: { startDate: string; endDate: string; label: string };
  totals: Omit<DoctorPerformanceRow, 'doctorId' | 'doctorName'>;
  rows: DoctorPerformanceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface TestPerformanceRow {
  testId: number;
  testCode: string | null;
  testName: string;
  ordered: number;
  completed: number;
  cancelled: number;
  pending: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
}

export interface IncomeServiceRow {
  serviceName: string;
  category: string;
  transactions: number;
  units: number;
  collection: number;
  share: number;
}

export interface ExpenseAnalysisRow {
  category: string;
  transactions: number;
  paidAmount: number;
  paymentMethods: string[];
  statuses: string[];
}

export interface ReagentReconciliationRow {
  consumableId: number;
  reagentCode: string | null;
  reagentName: string;
  unit: string;
  completedTests: number;
  expectedUsage: number;
  actualUsage: number;
  returnedQuantity: number;
  variance: number;
  currentStock: number;
  reorderLevel: number;
  status: 'ok' | 'unmapped' | 'missing_consumption' | 'over_consumption' | 'low_stock' | 'out_of_stock' | 'qc_blocked';
}

export interface ExecutiveAnalyticsQueryState<T> {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export interface TestPerformanceResponse {
  period: { startDate: string; endDate: string; label: string };
  totals: Omit<TestPerformanceRow, 'testId' | 'testCode' | 'testName'>;
  rows: TestPerformanceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface IncomeServiceResponse {
  period: { startDate: string; endDate: string; label: string };
  totals: { transactions: number; units: number; collection: number };
  rows: IncomeServiceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface ExpenseAnalysisResponse {
  period: { startDate: string; endDate: string; label: string };
  totals: { transactions: number; paidAmount: number };
  rows: ExpenseAnalysisRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface ReagentReconciliationResponse {
  period: { startDate: string; endDate: string; label: string };
  rows: ReagentReconciliationRow[];
  quantityTotals: Array<{ unit: string; quantity: number }>;
  exceptions: { unmappedCompletedTests: number; consumptionExceptions: number };
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export function useExecutiveDashboardAnalytics(args: {
  queryKeyScope: 'admin' | 'md' | 'director';
  filters: ExecutiveDashboardFilters;
  enabledPanels: Set<ExecutiveDashboardMetric>;
}): {
  doctorPerformance: ExecutiveAnalyticsQueryState<DoctorPerformanceResponse>;
  testPerformance: ExecutiveAnalyticsQueryState<TestPerformanceResponse>;
  incomeServices: ExecutiveAnalyticsQueryState<IncomeServiceResponse>;
  expenseAnalysis: ExecutiveAnalyticsQueryState<ExpenseAnalysisResponse>;
  reagentReconciliation: ExecutiveAnalyticsQueryState<ReagentReconciliationResponse>;
};
```

- [ ] **Step 1: Write failing hook tests**

Assert:

- every enabled query receives identical `preset/startDate/endDate` parameters,
- disabled panels have `enabled: false`,
- search is encoded,
- changing range changes query keys.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/hooks/useExecutiveDashboardAnalytics.test.tsx src/components/dashboard/ExecutiveDashboardRangeFilter.test.tsx
```

Expected: missing modules.

- [ ] **Step 3: Implement query parameter builder**

```ts
export function executiveAnalyticsQuery(filters: ExecutiveDashboardFilters): string {
  const params = new URLSearchParams();
  params.set('preset', filters.preset);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.doctorId) params.set('doctorId', String(filters.doctorId));
  if (filters.testSearch?.trim()) params.set('search', filters.testSearch.trim());
  return params.toString();
}
```

- [ ] **Step 4: Implement the shared range filter**

Controls:

- Today
- Yesterday
- This Week
- This Month
- Last Month
- Last 7 Days
- Last 30 Days
- Custom start/end
- Refresh
- Last refreshed time

Custom Apply is disabled unless both dates are valid and start ≤ end.

- [ ] **Step 5: Lift filter state to the shared executive surface**

Admin, MD, and Director should not maintain separate conflicting range semantics. Pass the resolved query suffix into scalar KPI hook and analytics hook.

- [ ] **Step 6: Verify GREEN and commit**

```bash
pnpm --filter web exec vitest run src/hooks/useExecutiveDashboardAnalytics.test.tsx src/components/dashboard/ExecutiveDashboardRangeFilter.test.tsx src/pages/MDDashboard-ranges.test.tsx
pnpm --filter web exec tsc --noEmit
```

Expected: PASS.

```bash
git add web/src/types/executiveDashboard.ts web/src/hooks/useExecutiveDashboardAnalytics.ts web/src/hooks/useExecutiveDashboardAnalytics.test.tsx web/src/components/dashboard/ExecutiveDashboardRangeFilter.tsx web/src/components/dashboard/ExecutiveDashboardRangeFilter.test.tsx web/src/pages/MDDashboard.tsx web/src/pages/DirectorDashboard.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx
git commit -m "feat: add shared executive dashboard filters"
```

---

### Task 9: Doctor and Test Analytics UI

**Files:**
- Create: `web/src/components/dashboard/DoctorPerformancePanel.tsx`
- Create: `web/src/components/dashboard/DoctorPerformancePanel.test.tsx`
- Create: `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- Create: `web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx`
- Create: `web/src/components/dashboard/TestPerformancePanel.tsx`
- Create: `web/src/components/dashboard/TestPerformancePanel.test.tsx`
- Create: `web/src/components/dashboard/TestPerformanceDrawer.tsx`
- Create: `web/src/components/dashboard/TestPerformanceDrawer.test.tsx`
- Modify: `web/src/components/dashboard/ExecutiveControlKpis.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`

**Interfaces:**

```ts
interface DoctorPerformancePanelProps {
  data?: DoctorPerformanceResponse;
  loading: boolean;
  error: boolean;
  onDoctorOpen: (doctor: DoctorPerformanceRow) => void;
  onPageChange: (page: number) => void;
  onSortChange: (sortBy: DoctorSort) => void;
}
```

```ts
interface TestPerformancePanelProps {
  data?: TestPerformanceResponse;
  loading: boolean;
  error: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onTestOpen: (test: TestPerformanceRow) => void;
}
```

- [ ] **Step 1: Write failing doctor-panel tests**

Assert separate columns for Visits, Visit Collection, Visit Commission, Tests, Test Collection, Test Commission, Other Commission, Total Commission. Clicking a row opens drawer tabs.

- [ ] **Step 2: Write failing test-panel tests**

Assert `CBC` search input is accessible, completed is the primary count, and completed-but-unpaid messaging exists in help text.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/TestPerformancePanel.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx
```

Expected: missing components.

- [ ] **Step 4: Implement responsive panels**

Desktop: full table. Small screens: horizontal table with sticky first column or stacked row cards; do not hide commission distinctions. Use semantic `<table>` headers and accessible sort buttons.

- [ ] **Step 5: Implement specialized drawers**

Doctor drawer tabs: Visits, Tests, Commissions. Test drawer displays Referring Doctor and Ordering Doctor separately. Load details only while open.

- [ ] **Step 6: Render panels after management cards**

Render order:

```text
Financial cards
Doctor performance
Test performance
Income services
Expense analysis
Cash/approvals
Inventory/reagent/radiology
```

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/TestPerformancePanel.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx src/pages/MDDashboard.test.tsx
pnpm --filter web exec tsc --noEmit
```

Expected: PASS.

```bash
git add web/src/components/dashboard/DoctorPerformancePanel.tsx web/src/components/dashboard/DoctorPerformancePanel.test.tsx web/src/components/dashboard/DoctorPerformanceDrawer.tsx web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx web/src/components/dashboard/TestPerformancePanel.tsx web/src/components/dashboard/TestPerformancePanel.test.tsx web/src/components/dashboard/TestPerformanceDrawer.tsx web/src/components/dashboard/TestPerformanceDrawer.test.tsx web/src/components/dashboard/ExecutiveControlKpis.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx
git commit -m "feat: add doctor and test dashboard analytics"
```

---

### Task 10: Income, Expense, and Reagent Analysis UI

**Files:**
- Create: `web/src/components/dashboard/IncomeServicePanel.tsx`
- Create: `web/src/components/dashboard/IncomeServicePanel.test.tsx`
- Create: `web/src/components/dashboard/ExpenseAnalysisPanel.tsx`
- Create: `web/src/components/dashboard/ExpenseAnalysisPanel.test.tsx`
- Create: `web/src/components/dashboard/ReagentReconciliationPanel.tsx`
- Create: `web/src/components/dashboard/ReagentReconciliationPanel.test.tsx`
- Modify: `web/src/components/dashboard/ExecutiveControlKpis.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: `web/src/lib/kpiLabels.ts`

- [ ] **Step 1: Write failing income-panel tests**

Assert exact service labels such as `Doctor Consultation`, `Bed Charge`, and `X-Ray Chest`; category appears as secondary context; no coarse-only OPD/IPD output when exact names exist.

- [ ] **Step 2: Write failing expense-panel tests**

Assert category, transaction count, paid amount, payment method, and status. Approved-unpaid rows must not appear as paid expense.

- [ ] **Step 3: Write failing reagent-panel tests**

Assert columns for Expected, Actual, Returned, Variance, Current Stock, Unit, Status. Mixed units render separate values and never a combined numeric total. Unmapped tests display an action-required warning.

- [ ] **Step 4: Run and verify RED**

```bash
pnpm --filter web exec vitest run src/components/dashboard/IncomeServicePanel.test.tsx src/components/dashboard/ExpenseAnalysisPanel.test.tsx src/components/dashboard/ReagentReconciliationPanel.test.tsx
```

Expected: missing components.

- [ ] **Step 5: Implement panels and empty/error states**

Each panel has:

- skeleton loading,
- scoped error with retry,
- zero-data explanation,
- server pagination,
- visible period label,
- no patient data in the summary table.

- [ ] **Step 6: Move stock domains to the bottom**

Both `ExecutiveControlKpis.tsx` and `KPISummaryCards.tsx` must render General Inventory, Laboratory Reagent, and Radiology after Cash/Approvals/Exception sections. Preserve config order within each section.

- [ ] **Step 7: Update formula and source labels**

Add explicit formulas for visit/test/total commission and descriptions for completed tests, exact service collection, and reagent reconciliation.

- [ ] **Step 8: Verify GREEN and commit**

```bash
pnpm --filter web exec vitest run src/components/dashboard/IncomeServicePanel.test.tsx src/components/dashboard/ExpenseAnalysisPanel.test.tsx src/components/dashboard/ReagentReconciliationPanel.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx src/pages/MDDashboard.test.tsx
pnpm --filter web exec tsc --noEmit
```

Expected: PASS.

```bash
git add web/src/components/dashboard/IncomeServicePanel.tsx web/src/components/dashboard/IncomeServicePanel.test.tsx web/src/components/dashboard/ExpenseAnalysisPanel.tsx web/src/components/dashboard/ExpenseAnalysisPanel.test.tsx web/src/components/dashboard/ReagentReconciliationPanel.tsx web/src/components/dashboard/ReagentReconciliationPanel.test.tsx web/src/components/dashboard/ExecutiveControlKpis.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx web/src/lib/kpiLabels.ts
git commit -m "feat: add income expense and reagent panels"
```

---

### Task 11: Real SQLite Contract, Cross-Panel Reconciliation, and Security Tests

**Files:**
- Create: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: all new backend integration tests as required.

- [ ] **Step 1: Build a production-shaped in-memory SQLite fixture**

Create the minimum real schema for:

- tenants/users,
- patients/doctors/visits,
- bills/invoice_items/payments,
- lab orders/items/catalog,
- commission accruals,
- expenses/cash drawer movements,
- reagent mapping/movements/stock.

Use actual production column names copied from migrations/schema, not mock aliases.

- [ ] **Step 2: Write failing real-SQL assertions**

Assert:

```ts
expect(totalCollection).toBe(serviceCollections + deposits);
expect(totalExpense).toBe(paidOperatingExpenses + doctorPayouts);
expect(netIncome).toBe(totalCollection - totalExpense);
expect(totalCommission).toBe(visitCommission + testCommission + otherCommission);
expect(doctorTestTotal).toBe(testRows.reduce((sum, row) => sum + row.completed, 0));
```

Also assert tenant B rows never appear in tenant A responses.

- [ ] **Step 3: Verify RED against any schema mismatch**

```bash
pnpm test:integration -- test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: any wrong column/relationship fails here before release.

- [ ] **Step 4: Fix SQL builders, not fixtures**

Only change fixture schema if it demonstrably differs from repository migrations. Otherwise fix production SQL.

- [ ] **Step 5: Add route security cases**

Verify unauthenticated requests return 401, non-executive roles follow the existing admin dashboard guard contract, unknown sort fields return 400, SQL-like search strings remain bound data, and client-supplied tenant IDs are ignored/rejected.

- [ ] **Step 6: Verify all focused backend contracts**

```bash
pnpm test:integration -- test/integration/routes/dashboard-commission-split.test.ts test/integration/routes/dashboard-doctor-performance.test.ts test/integration/routes/dashboard-test-performance.test.ts test/integration/routes/dashboard-income-services.test.ts test/integration/routes/dashboard-expense-analysis.test.ts test/integration/routes/dashboard-reagent-reconciliation.test.ts
pnpm test:integration -- test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-commission-split.test.ts test/integration/routes/dashboard-doctor-performance.test.ts test/integration/routes/dashboard-test-performance.test.ts test/integration/routes/dashboard-income-services.test.ts test/integration/routes/dashboard-expense-analysis.test.ts test/integration/routes/dashboard-reagent-reconciliation.test.ts
git commit -m "test: validate executive dashboard reconciliation"
```

---

### Task 12: Full Regression, Adversarial Review, and Release Readiness

**Files:**
- Modify only files required by verified findings.
- Update: `docs/superpowers/specs/2026-07-12-executive-hospital-control-dashboard-design.md` if implementation decisions differ.
- Update: `docs/superpowers/plans/2026-07-12-executive-hospital-control-dashboard.md` checkboxes/evidence.

- [x] **Step 1: Run focused frontend accessibility and behavior tests**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DashboardKpiConfigurator.test.tsx src/components/dashboard/KpiBreakdownDrawer.test.tsx src/components/dashboard/ExecutiveDashboardRangeFilter.test.tsx src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/TestPerformancePanel.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx src/components/dashboard/IncomeServicePanel.test.tsx src/components/dashboard/ExpenseAnalysisPanel.test.tsx src/components/dashboard/ReagentReconciliationPanel.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx src/pages/MDDashboard.test.tsx
```

Expected: PASS with no new unhandled React warnings.

- [x] **Step 2: Run full backend unit suite**

```bash
pnpm exec vitest run
```

Expected: zero failures.

- [x] **Step 3: Run dedicated integration suite**

```bash
pnpm test:integration
```

Expected: zero failures.

- [x] **Step 4: Run full web suite**

```bash
pnpm --filter web exec vitest run --reporter=dot --silent
```

Expected: zero failures. Existing explicit todo tests may remain todo.

- [x] **Step 5: Run TypeScript and build gates**

```bash
pnpm exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
pnpm build:migrations
pnpm --filter web build
```

Expected: all exit 0. Migration manifest count should remain unchanged unless a separately justified migration was added.

- [x] **Step 6: Perform adversarial financial review**

Manually verify with test fixtures and SQL traces:

- deposits counted in Total Collection but not assigned to clinical service,
- approved-unpaid expenses excluded,
- doctor payout included once,
- refunds not double deducted,
- partial mixed-invoice allocation sums exactly to payment,
- visit/test/other commission partitions are disjoint and complete,
- unassigned doctor/test rows are visible rather than silently reassigned.

- [x] **Step 7: Perform edge-case review**

Verify:

- empty period,
- future date,
- leap day,
- custom 366-day maximum,
- cancelled/refunded/draft bills,
- duplicate invoice items,
- missing catalog name,
- differing Referring and Ordering Doctor,
- test completed after payment date,
- reagent return greater than usage,
- mixed units,
- quarantined stock,
- optional lab table missing,
- 100-row pagination boundary.

Every confirmed defect receives a failing regression test before a fix.

- [x] **Step 8: Review query plans before deciding on migration**

Run D1/SQLite `EXPLAIN QUERY PLAN` for the five new analytics summaries using production-shaped fixtures. If existing tenant/date/status indexes are used, document “no migration required.” Do not add speculative indexes. If an essential full scan is proven, create the next numbered migration with an index scoped to the exact query and add migration safety tests.

- [x] **Step 9: Request code review**

Review the complete diff against:

```text
docs/superpowers/specs/2026-07-12-executive-hospital-control-dashboard-design.md
```

Fix all Critical and Important findings with TDD, then rerun affected focused tests.

- [x] **Step 10: Final clean-state check and release commit**

```bash
git diff --check
git status -sb
```

Expected: only intended staged changes before final commit; no generated reports, backups, `.ai-bridge` logs, or unrelated clinical changes.

```bash
git add src web/src test docs/superpowers/specs/2026-07-12-executive-hospital-control-dashboard-design.md docs/superpowers/plans/2026-07-12-executive-hospital-control-dashboard.md
git commit -m "feat: deliver executive hospital control dashboard"
```

- [x] **Step 11: Finish the branch using the required workflow**

Use `superpowers:finishing-a-development-branch`. Because the user has previously requested main integration and deployment for completed work, present the standard verified merge/PR choices and do not push, merge, migrate, or deploy until that finishing step confirms the desired action and all required production checks are fresh.

---

## Acceptance Traceability

| Requirement | Tasks |
|---|---|
| Total Collection / Expense / Net Income remain reconciled | 5, 11, 12 |
| Visit commission and test commission separate | 2, 3, 9 |
| Doctor-wise visit/test/collection/commission | 3, 9 |
| Referring and Ordering Doctor both visible | 3, 4, 9 |
| CBC count for selected month | 1, 4, 8, 9 |
| Exact service income instead of OPD/IPD-only | 5, 10 |
| Paid expense source analysis | 5, 10 |
| Reagent expected/actual/stock/variance | 6, 10 |
| Unmapped tests and consumption exceptions | 6, 10 |
| Configurable sections/cards/panels | 7 |
| Inventory/reagent/radiology at bottom | 7, 10 |
| Disabled panels avoid SQL | 7, 8, 11 |
| Tenant isolation/RBAC | 3–7, 11 |
| Full regression and build | 12 |

## Expected Final User Experience

For `This Month`, an MD can search `CBC` and immediately see ordered, completed, cancelled, pending, billed, collected, due, and test commission. The same dashboard shows each doctor’s visits, visit collection, visit commission, referred tests, test collection, test commission, and total commission without mixing those categories. Exact services explain income; exact paid categories explain expense; reagent rows reconcile expected usage against actual movements and current stock. General inventory and radiology remain available at the bottom, and every card or panel can be enabled, disabled, reordered, or renamed without exposing SQL or formulas.
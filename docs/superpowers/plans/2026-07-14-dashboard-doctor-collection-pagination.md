# Dashboard Doctor Collection and Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix doctor-wise visit/test collection attribution in the executive dashboard and show 10 rows per page across the requested dashboard list panels.

**Architecture:** Keep `/api/dashboard/doctor-performance` as the authoritative dashboard endpoint. Extend its existing SQL CTE pipeline so actual `payments` are allocated across bill lines and attributed through bill-level commission, invoice-line, visit, and referring-doctor fallbacks. Keep server pagination intact and change only dashboard callers to request 10 rows.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite SQL, React, TanStack Query, Vitest, Testing Library.

## Global Constraints

- `payments` is the collection source of truth; billed amounts are allocation bases only.
- All joins and fallbacks must remain tenant-scoped.
- Cancelled/refunded/draft bills and cancelled invoice or commission rows stay excluded.
- Visit attribution priority: consultation commission doctor, consultation invoice-line doctor, visit doctor, referring doctor, unassigned.
- Test attribution priority: referring doctor, bill-level lab/referral commission doctor, visit doctor, unassigned.
- Legacy commission rows with `bill_id` and no `lab_order_item_id` must still attribute test collection.
- Dashboard doctor, test, income, expense, and reagent panels request exactly 10 rows per page.
- No database migration.

---

### Task 1: Add regression coverage for legacy bill-level doctor attribution

**Files:**
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `src/lib/executive-doctor-analytics.ts`

**Interfaces:**
- Consumes: `getDoctorPerformance({ dbBinding, tenantId, period, page, pageSize })`.
- Produces: unchanged `DoctorPerformanceResponse`; corrected `visitCollection` and `testCollection` values.

- [ ] **Step 1: Write a failing integration test**

Add a test that inserts two new doctors and two paid mixed-service bills. The visit doctor must be resolved from a `consultation_fee` commission row, and the test doctor must be resolved from a `lab_test` commission row that has `bill_id` but `lab_order_item_id = NULL`.

```ts
it('attributes paid visit and test amounts from bill-level commission doctors when lab item links are absent', async () => {
  const { sqlite, d1 } = createHarness();
  sqlite.exec(`
    INSERT INTO doctors VALUES
      (2, 'tenant-a', 'Dr Visit Commission', NULL),
      (3, 'tenant-a', 'Dr Test Commission', NULL);
    INSERT INTO bills (
      id, tenant_id, invoice_no, patient_id, visit_id, referring_doctor_id, status,
      total, paid, due, test_bill, doctor_visit_bill, created_at, updated_at
    ) VALUES
      (20, 'tenant-a', 'A-INV-20', 1, NULL, NULL, 'paid', 100, 100, 0, 60, 40, '2026-07-12 14:00:00', '2026-07-12 14:05:00');
    INSERT INTO invoice_items VALUES
      (20, 'tenant-a', 20, 'consultation', 'Consultation', NULL, 1, 40, 40, 'active'),
      (21, 'tenant-a', 20, 'test', 'Legacy test', 1, 1, 60, 60, 'active');
    INSERT INTO payments VALUES
      (20, 'tenant-a', 20, 100, 'cash', 'A-R-20', 1, NULL, '2026-07-12 14:05:00', '2026-07-12 14:05:00');
    INSERT INTO doctor_commission_accruals VALUES
      (20, 'tenant-a', 2, 1, 20, NULL, NULL, 'consultation_fee', 4, 4, 40, 0, 4, 'accrued', '2026-07-12', '2026-07-12'),
      (21, 'tenant-a', 3, 1, 20, NULL, 1, 'lab_test', 6, 6, 60, 0, 6, 'accrued', '2026-07-12', '2026-07-12');
  `);

  const result = await getDoctorPerformance({
    dbBinding: d1,
    tenantId: 'tenant-a',
    period: PERIOD,
    page: 1,
    pageSize: 25,
  });

  expect(result.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ doctorId: 2, visitCollection: 40 }),
    expect.objectContaining({ doctorId: 3, testCollection: 60 }),
  ]));
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts -t "attributes paid visit and test amounts"
```

Expected: FAIL because the current summary query resolves visit/test doctors only from visit/referring/lab-item relationships.

- [ ] **Step 3: Extend the payment allocation CTEs**

In `src/lib/executive-doctor-analytics.ts`, keep line allocation but add tenant-scoped bill-level doctor resolution CTEs:

```sql
bill_commission_doctors AS (
  SELECT
    tenant_id,
    bill_id,
    MAX(CASE WHEN source_type = 'consultation_fee' THEN doctor_id END) AS visit_commission_doctor_id,
    MAX(CASE WHEN source_type IN ('lab_test', 'referral') THEN doctor_id END) AS test_commission_doctor_id
  FROM doctor_commission_accruals
  WHERE tenant_id = ?
    AND bill_id IS NOT NULL
    AND COALESCE(status, 'accrued') != 'cancelled'
  GROUP BY tenant_id, bill_id
)
```

Add the bill and tenant identifiers to allocated rows, then aggregate visit/test collection by resolved doctor using the required priority order. Preserve unassigned rows with `NULL` doctor IDs.

- [ ] **Step 4: Update SQL parameter binding**

Add the new tenant parameter to `summaryParams` in the same order as the added CTE placeholder. Ensure the summary query still binds search, limit, and offset last.

- [ ] **Step 5: Run the focused test and full analytics integration file**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts -t "attributes paid visit and test amounts"
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: the focused test passes and the complete file has zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/executive-doctor-analytics.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
git commit -m "fix: attribute dashboard doctor collections from paid bills"
```

---

### Task 2: Keep doctor detail rows consistent with summary attribution

**Files:**
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `src/lib/executive-doctor-analytics.ts`

**Interfaces:**
- Consumes: `getDoctorPerformanceDetails({ dbBinding, tenantId, period, doctorId, tab, page, pageSize })`.
- Produces: unchanged detail response shape with collection rows assigned to the same doctor as the summary.

- [ ] **Step 1: Write failing visit and test detail assertions**

Extend the Task 1 test to call details for doctor 2 (`tab: 'visits'`) and doctor 3 (`tab: 'tests'`) and assert collected amounts of 40 and 60 respectively.

```ts
const visitDetails = await getDoctorPerformanceDetails({
  dbBinding: d1,
  tenantId: 'tenant-a',
  period: PERIOD,
  doctorId: 2,
  tab: 'visits',
  page: 1,
  pageSize: 25,
});
const testDetails = await getDoctorPerformanceDetails({
  dbBinding: d1,
  tenantId: 'tenant-a',
  period: PERIOD,
  doctorId: 3,
  tab: 'tests',
  page: 1,
  pageSize: 25,
});
expect(visitDetails.rows).toEqual(expect.arrayContaining([
  expect.objectContaining({ collectedAmount: 40 }),
]));
expect(testDetails.rows).toEqual(expect.arrayContaining([
  expect.objectContaining({ collectedAmount: 60 }),
]));
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts -t "attributes paid visit and test amounts"
```

Expected: summary assertions pass after Task 1, but one or both detail assertions fail.

- [ ] **Step 3: Reuse the same bill-level doctor resolution in detail SQL**

Add the same tenant-scoped commission-doctor CTE to `visitDetailsSql` and `testDetailsSql`. Resolve visit and test doctor IDs with the same priority used by the summary before applying the selected-doctor filter.

- [ ] **Step 4: Update detail parameter builders**

Bind the added tenant parameter in the visit and test detail execution paths without changing public function signatures.

- [ ] **Step 5: Run focused and full backend tests**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts -t "attributes paid visit and test amounts"
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: all assertions pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/executive-doctor-analytics.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
git commit -m "fix: align doctor drilldowns with collection attribution"
```

---

### Task 3: Request 10-row pages from every dashboard list panel

**Files:**
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `web/src/hooks/useExecutiveDashboardAnalytics.test.tsx`
- Modify: `web/src/hooks/useExecutiveDashboardAnalytics.ts`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: `web/src/components/dashboard/ExecutiveControlKpis.tsx`

**Interfaces:**
- Consumes: `useExecutiveDashboardAnalytics` page-size arguments.
- Produces: query URLs containing `pageSize=10` for doctor, test, income, expense, and reagent endpoints.

- [ ] **Step 1: Write failing route and hook-level pagination tests**

Add a backend route test asserting `pageSize=10` is accepted, then mock `useApiQuery`, render the hook, and assert all five endpoint URLs contain `pageSize=10` by default.

```tsx
expect(useApiQuery).toHaveBeenCalledWith(
  expect.anything(),
  expect.stringContaining('/api/dashboard/doctor-performance?'),
  expect.anything(),
);
const urls = vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]));
expect(urls.filter((url) => url.includes('/api/dashboard/'))).toEqual(expect.arrayContaining([
  expect.stringMatching(/doctor-performance\?.*pageSize=10/),
  expect.stringMatching(/test-performance\?.*pageSize=10/),
  expect.stringMatching(/income-services\?.*pageSize=10/),
  expect.stringMatching(/expense-analysis\?.*pageSize=10/),
  expect.stringMatching(/reagent-reconciliation\?.*pageSize=10/),
]));
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts -t "accepts ten-row pagination"
pnpm --dir web exec vitest run src/hooks/useExecutiveDashboardAnalytics.test.tsx
```

Expected: the backend route test returns 400 before the contract change, and the frontend assertion shows `pageSize=25` before the default changes.

- [ ] **Step 3: Extend page-size types and dashboard caller values**

Change all five optional page-size argument types in `useExecutiveDashboardAnalytics.ts` from:

```ts
25 | 50 | 100
```

to:

```ts
10 | 25 | 50 | 100
```

Add 10 to the executive analytics route’s allowed page-size set and validation message. In both `KPISummaryCards.tsx` and `ExecutiveControlKpis.tsx`, pass 10 for doctor, test, income, expense, and reagent page sizes; make the hook defaults 10 as well.

- [ ] **Step 4: Run hook and panel tests**

```bash
pnpm --dir web exec vitest run src/hooks/useExecutiveDashboardAnalytics.test.tsx src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/TestPerformancePanel.test.tsx src/components/dashboard/IncomeServicePanel.test.tsx src/components/dashboard/ExpenseAnalysisPanel.test.tsx src/components/dashboard/ReagentReconciliationPanel.test.tsx
```

Expected: all tests pass and current previous/next controls remain covered.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/dashboard.ts test/integration/executive-dashboard-analytics-sqlite.test.ts web/src/hooks/useExecutiveDashboardAnalytics.ts web/src/hooks/useExecutiveDashboardAnalytics.test.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx web/src/components/dashboard/ExecutiveControlKpis.tsx
git commit -m "feat: paginate dashboard analysis lists by ten"
```

---

### Task 4: Review, verify, merge local main, push, and deploy

**Files:**
- Review all changed files.
- No migration files.

**Interfaces:**
- Produces: verified commits on local `main`, matching `origin/main`, and a production deployment from local `main`.

- [ ] **Step 1: Run focused verification**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts
pnpm --dir web exec vitest run src/hooks/useExecutiveDashboardAnalytics.test.tsx src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/TestPerformancePanel.test.tsx src/components/dashboard/IncomeServicePanel.test.tsx src/components/dashboard/ExpenseAnalysisPanel.test.tsx src/components/dashboard/ReagentReconciliationPanel.test.tsx
```

- [ ] **Step 2: Run type checks and production build**

```bash
pnpm exec tsc --noEmit
pnpm --dir web exec tsc --noEmit
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 3: Review diff and commit any final test-only corrections**

Use `show_changes` and confirm only the spec/plan, executive doctor analytics, integration tests, analytics hook/test, and dashboard caller page-size files changed.

- [ ] **Step 4: Merge into local main**

Because the primary checkout contains unrelated generated E2E artifacts, preserve them and perform a clean merge without staging or deleting them. Fetch latest `origin/main`, update local `main` safely, merge the feature branch, and verify the resulting local `main` commit graph.

- [ ] **Step 5: Re-run verification on merged local main**

Run the same focused tests, type checks, and build from the merged local `main` state.

- [ ] **Step 6: Push and deploy from local main**

```bash
git push origin main
pnpm deploy:production
```

- [ ] **Step 7: Verify production**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://hms.ozzyl.com/api/health
curl -sS -o /dev/null -w "%{http_code}\n" "https://hms.ozzyl.com/api/dashboard/doctor-performance?preset=custom&startDate=2026-07-13&endDate=2026-07-13&page=1&pageSize=10"
```

Expected: health returns 200 and unauthenticated dashboard route returns 401, proving the new production worker is mounted. Use authenticated browser verification to confirm non-zero doctor collection values and 10-row pagination in the dashboard.

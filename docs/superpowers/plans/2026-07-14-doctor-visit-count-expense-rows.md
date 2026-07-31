# Doctor Visit Count and Expense Transaction Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute visit counts to each consultation doctor correctly and render every paid expense or executed doctor payout as its own paginated dashboard row.

**Architecture:** Keep doctor attribution in the existing executive doctor analytics SQL, but count distinct consultation bills and use bill-first reporting dates. Replace expense category aggregation with a transaction-fact query whose rows are mapped directly into the API and rendered directly by the existing expense panel.

**Tech Stack:** TypeScript, SQLite/D1 SQL, Hono, React, Vitest, Testing Library.

## Global Constraints

- No database migration.
- Expense pagination is 10 transactions per page through the existing dashboard hook.
- Approved-but-unpaid and rejected expenses remain excluded.
- Doctor payouts include only executed `cash_out` movements with `doctor_commission_settlement` or `doctor_payout` references.
- Visit doctor resolution order remains: consultation commission doctor, invoice-line doctor, linked visit doctor, referring doctor, unassigned.

---

### Task 1: Fix doctor visit counting

**Files:**
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `src/lib/executive-doctor-analytics.ts`

**Interfaces:**
- Consumes: `getDoctorPerformance(args): Promise<DoctorPerformanceResponse>`.
- Produces: `DoctorPerformanceRow.visits` counted per distinct consultation bill under the resolved consultation doctor.

- [ ] **Step 1: Write a failing regression test**

Add a test fixture with two paid consultation bills that share the same linked `visits.id` but have different bill-level `consultation_fee` commission doctors. Assert each doctor receives `visits: 1`, and neither doctor receives the combined count.

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts -t "counts consultation bills per resolved doctor"
```

Expected: FAIL because the current query filters with visit-date-first semantics and `GROUP BY doctor_id` can resolve to the joined `visits.doctor_id` column instead of the SELECT alias.

- [ ] **Step 3: Implement the minimal SQL fix**

In `visit_facts`:

```sql
COUNT(DISTINCT b.id) AS visits
```

Use bill-first reporting date:

```sql
AND localDateSql('b.created_at, v.visit_date, b.updated_at') >= date(?)
AND localDateSql('b.created_at, v.visit_date, b.updated_at') <= date(?)
```

Apply the same bill-first date expression in visit details so summary and drawer agree.

- [ ] **Step 4: Run doctor analytics tests and verify GREEN**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: all tests pass.

### Task 2: Return one expense transaction per API row

**Files:**
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify: `src/lib/executive-expense-analytics.ts`
- Modify: `web/src/types/executiveDashboard.ts`

**Interfaces:**
- Produces backend/frontend `ExpenseAnalysisRow`:

```ts
interface ExpenseAnalysisRow {
  id: string;
  occurredAt: string;
  category: string;
  detail: string;
  paidAmount: number;
  paymentMethod: string;
  status: string;
}
```

- [ ] **Step 1: Replace grouped backend assertions with failing line-item assertions**

Assert that the seeded three Utilities expenses and one doctor payout produce four rows, each with its own description and amount. Assert `totalRows === 4`, `totals.transactions === 4`, and unpaid/other-tenant records are absent.

Add a page-size-2 assertion showing two rows on page 1 and `hasNextPage: true`.

- [ ] **Step 2: Run the targeted integration test and verify RED**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts -t "reconciles collection"
```

Expected: FAIL because the current query groups by category and returns `details[]`.

- [ ] **Step 3: Replace category aggregation with transaction facts**

Build `expense_facts` with fields:

```sql
source || '-' || source_id AS id,
occurred_at,
category,
paid_amount,
payment_method,
status,
detail
```

Return filtered facts directly. Use window totals:

```sql
COUNT(*) OVER () AS total_rows,
COUNT(*) OVER () AS overall_transactions,
ROUND(SUM(paid_amount) OVER (), 2) AS overall_paid_amount
```

Search with:

```sql
WHERE LOWER(category) LIKE LOWER(?) OR LOWER(detail) LIKE LOWER(?)
```

Keep the existing public sort names; map `transactions` to `occurred_at` for backward compatibility.

- [ ] **Step 4: Update backend and frontend row types**

Remove aggregated arrays/count from each row and add the transaction fields exactly as specified above.

- [ ] **Step 5: Run backend integration tests and verify GREEN**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: all tests pass.

### Task 3: Render line-by-line expense rows

**Files:**
- Modify: `web/src/components/dashboard/ExpenseAnalysisPanel.test.tsx`
- Modify: `web/src/components/dashboard/ExpenseAnalysisPanel.tsx`

**Interfaces:**
- Consumes: line-item `ExpenseAnalysisResponse.rows` from Task 2.
- Produces: one `<tr>` per expense/payout transaction.

- [ ] **Step 1: Write failing frontend tests**

Use fixture rows for Electricity, Generator fuel, and a doctor payout. Assert:

- three body rows render;
- Date, Category, Details, Paid Amount, Payment Method, and Status headers exist;
- each description appears exactly once;
- no “+ N more” or “Show less” button exists;
- footer reads `Page 1 · 3 transactions`.

- [ ] **Step 2: Run the component test and verify RED**

```bash
pnpm --dir web exec vitest run src/components/dashboard/ExpenseAnalysisPanel.test.tsx
```

Expected: FAIL because the current panel groups descriptions by category.

- [ ] **Step 3: Implement the line-item table**

Remove expansion state and grouped detail lists. Render:

```tsx
<tr key={row.id}>
  <td>{formatted date}</td>
  <td>{row.category}</td>
  <td>{row.detail || 'No description provided'}</td>
  <td>{formatCurrency(row.paidAmount)}</td>
  <td>{row.paymentMethod || '—'}</td>
  <td>{row.status || '—'}</td>
</tr>
```

Change the footer noun from `categories` to `transactions`.

- [ ] **Step 4: Run frontend tests and verify GREEN**

```bash
pnpm --dir web exec vitest run src/components/dashboard/ExpenseAnalysisPanel.test.tsx src/hooks/useExecutiveDashboardAnalytics.test.tsx
```

Expected: all tests pass.

### Task 4: Full verification and integration

**Files:**
- Review all modified files.

- [ ] **Step 1: Run focused backend and frontend suites**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts
pnpm --dir web exec vitest run src/components/dashboard/ExpenseAnalysisPanel.test.tsx src/components/dashboard/DoctorPerformancePanel.test.tsx src/hooks/useExecutiveDashboardAnalytics.test.tsx
```

- [ ] **Step 2: Run typechecks and production build**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm --dir web exec tsc --noEmit
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 3: Adversarial review**

Verify tenant isolation, paid-only expense filtering, stable transaction keys, correct pagination metadata, visit summary/detail consistency, and no cross-bill doctor attribution.

- [ ] **Step 4: Commit implementation**

```bash
git add src/lib/executive-doctor-analytics.ts src/lib/executive-expense-analytics.ts test/integration/executive-dashboard-analytics-sqlite.test.ts web/src/types/executiveDashboard.ts web/src/components/dashboard/ExpenseAnalysisPanel.tsx web/src/components/dashboard/ExpenseAnalysisPanel.test.tsx docs/superpowers/plans/2026-07-14-doctor-visit-count-expense-rows.md
git commit -m "fix: split visit counts and expense rows"
```

- [ ] **Step 5: Merge latest verified branch into local `main`, push, deploy production, and verify `/api/health` plus authenticated-route mounting.**

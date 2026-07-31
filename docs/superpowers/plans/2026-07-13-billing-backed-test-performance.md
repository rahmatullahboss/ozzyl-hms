# Billing-Backed Test Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incomplete lab-order-based Test Performance report with a billing-backed report that shows the full selected-period test quantity, billed amount, collected amount, due, and assignable commission.

**Architecture:** Build summary and detail datasets from `invoice_items` joined to `bills` and `billing_service_items`, allocate selected-period payments proportionally across active bill lines, and map commission only where a specific billed service can be identified. Update the dashboard API contract and React views together so operational lab statuses are no longer exposed as complete historical facts.

**Tech Stack:** Cloudflare Workers, D1/SQLite SQL, TypeScript, Hono, React, TanStack Query, Vitest, Testing Library.

## Global Constraints

- Reagent-management work is out of scope.
- `invoice_items` and `bills` are the authoritative source for quantity and financial totals.
- Do not require `lab_orders` or `lab_order_items` for a row to appear.
- Exclude cancelled invoice lines and draft, cancelled, or refunded bills.
- No database migration.
- Preserve tenant isolation in every query.
- Unassignable commission must not be spread across unrelated tests.

---

### Task 1: Replace the backend summary with billing facts

**Files:**
- Modify: `src/lib/executive-test-analytics.ts`
- Modify: `test/integration/routes/dashboard-test-performance.test.ts`
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts`

**Interfaces:**
- Produces: `TestPerformanceSort = 'quantity' | 'billed' | 'collected' | 'due' | 'testCommission'`
- Produces: `TestPerformanceRow` with `testId`, `testCode`, `testName`, `quantity`, `billed`, `collected`, `due`, `testCommission`
- Produces: `getTestPerformance(args)` without a status argument

- [ ] **Step 1: Rewrite the route integration fixture as a failing billing-backed contract test**

Use a mocked `executive_test:summary` result shaped like:

```ts
{
  test_id: 396,
  test_code: 'CBC_PLT',
  test_name: 'CBC & Platelet Count',
  quantity: 76,
  billed: 27584,
  collected: 26061,
  due: 1523,
  test_commission: 1200,
  total_rows: 2,
  overall_quantity: 136,
  overall_billed: 38244,
  overall_collected: 36170,
  overall_due: 2074,
  overall_test_commission: 1600,
}
```

Assert the SQL contains:

```ts
expect(lower).toContain("ii.item_category = 'test'");
expect(lower).toContain('billing_service_items');
expect(lower).toContain('payment_allocations');
expect(lower).not.toContain('ordered_facts as');
expect(lower).not.toContain('completed_facts as');
expect(lower).not.toContain('ii.reference_id = loi.id');
```

- [ ] **Step 2: Run the focused route test and confirm failure**

Run:

```bash
pnpm exec vitest run test/integration/routes/dashboard-test-performance.test.ts
```

Expected: FAIL because the response still exposes ordered/completed/pending/cancelled and the SQL still depends on lab order items.

- [ ] **Step 3: Add a SQLite regression for billing rows that have no lab-order record**

Create data with one active `bills` row and two `invoice_items` test lines linked to `billing_service_items`, but no `lab_orders` or `lab_order_items`. Assert summary quantity and billed totals include both lines and that a zero `line_total` uses `unit_price * quantity`.

- [ ] **Step 4: Implement billing-backed summary SQL**

In `src/lib/executive-test-analytics.ts`, replace the operational CTEs with:

```sql
billing_lines AS (
  SELECT
    ii.id AS invoice_item_id,
    ii.tenant_id,
    ii.bill_id,
    ii.reference_id AS service_item_id,
    COALESCE(NULLIF(TRIM(bsi.item_code), ''), NULL) AS test_code,
    COALESCE(NULLIF(TRIM(bsi.item_name), ''), NULLIF(TRIM(ii.description), ''), 'Unmapped test') AS test_name,
    MAX(1, COALESCE(ii.quantity, 1)) AS quantity,
    CASE
      WHEN COALESCE(ii.line_total, 0) > 0 THEN ii.line_total
      ELSE MAX(0, COALESCE(ii.unit_price, 0) * MAX(1, COALESCE(ii.quantity, 1)))
    END AS line_amount,
    b.created_at AS billed_at
  FROM invoice_items ii
  JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
  LEFT JOIN billing_service_items bsi ON bsi.id = ii.reference_id AND bsi.tenant_id = ii.tenant_id
  WHERE ii.tenant_id = ?
    AND ii.item_category = 'test'
    AND COALESCE(ii.status, 'active') != 'cancelled'
    AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    AND <local bill date> BETWEEN date(?) AND date(?)
)
```

Group normal rows by service item ID. Preserve an unlinked line with a deterministic negative row key based on its own `invoice_item_id` so it is visible and can open details.

- [ ] **Step 5: Keep proportional payment allocation bill-wide**

Use all active bill lines as the allocation base, then aggregate allocations only for the test lines in `billing_lines`. Calculate:

```sql
ROUND(SUM(line_amount), 2) AS billed,
ROUND(SUM(allocated_amount), 2) AS collected,
ROUND(MAX(0, SUM(line_amount) - SUM(allocated_amount)), 2) AS due
```

- [ ] **Step 6: Map commission to service-item keys without spreading unassigned amounts**

Resolve commission service IDs by:

1. `doctor_commission_accruals.lab_test_id -> lab_test_catalog.billing_service_item_id`
2. directly linked `lab_order_item_id -> lab_order_items.lab_test_id -> lab_test_catalog.billing_service_item_id`
3. catalog code fallback to `billing_service_items.item_code` when the direct catalog link is null

Group only resolved rows; unresolved commission is excluded from per-test and total test commission.

- [ ] **Step 7: Replace backend TypeScript contracts and defaults**

Use:

```ts
export type TestPerformanceSort = 'quantity' | 'billed' | 'collected' | 'due' | 'testCommission';

export interface TestPerformanceRow {
  testId: number;
  testCode: string | null;
  testName: string;
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
}
```

Default sort: `quantity desc`.

- [ ] **Step 8: Run backend tests**

Run:

```bash
pnpm exec vitest run test/integration/routes/dashboard-test-performance.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit backend summary**

```bash
git add src/lib/executive-test-analytics.ts test/integration/routes/dashboard-test-performance.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
git commit -m "fix: source test performance from billing"
```

---

### Task 2: Convert route validation and details to billing lines

**Files:**
- Modify: `src/routes/tenant/dashboard.ts:3831-3925`
- Modify: `src/lib/executive-test-analytics.ts`
- Modify: `test/integration/routes/dashboard-test-performance.test.ts`

**Interfaces:**
- Consumes: billing row key from Task 1
- Produces: `getTestPerformanceDetails({ testId, ... })` where positive IDs identify a billing service and negative IDs identify one fallback invoice line
- Produces: detail rows without ordering doctor, accession, or operational status

- [ ] **Step 1: Write failing validation and billing-only detail tests**

Assert:

```ts
expect((await app.request('/dashboard/test-performance?status=completed')).status).toBe(400);
expect((await app.request('/dashboard/test-performance?sortBy=quantity')).status).toBe(200);
```

For details, mock one invoice line and assert the generated SQL starts from `invoice_items`, joins `bills`, and does not require `lab_order_items`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
pnpm exec vitest run test/integration/routes/dashboard-test-performance.test.ts
```

Expected: FAIL on legacy status handling and lab-order detail SQL.

- [ ] **Step 3: Update dashboard route validation**

Remove `status` parsing. Reject the presence of any `status` query value with:

```ts
if (c.req.query('status') !== undefined) {
  return c.json({ error: 'status is not supported for billing-backed test performance' }, 400);
}
```

Allow only `quantity`, `billed`, `collected`, `due`, and `testCommission`; default to `quantity`.

Allow `:testId` to be any non-zero integer so negative fallback keys can open details:

```ts
if (!/^-?\d+$/.test(testIdParam) || Number(testIdParam) === 0) {
  return c.json({ error: 'testId must be a non-zero integer' }, 400);
}
```

- [ ] **Step 4: Rewrite detail SQL around invoice lines**

Select from `invoice_items ii JOIN bills b`. For positive `testId`, match `ii.reference_id = ?`; for a negative fallback key, match `ii.id = ABS(?) AND ii.reference_id IS NULL`.

Return:

```ts
export interface TestPerformanceDetailRow {
  id: number;
  occurredAt: string;
  testName: string;
  patientName: string | null;
  referringDoctorName: string;
  invoiceNo: string | null;
  billedAmount: number;
  collectedAmount: number;
  dueAmount: number;
  testCommission: number;
}
```

Use the same effective line amount and proportional allocation formulas as the summary.

- [ ] **Step 5: Run route tests**

Run:

```bash
pnpm exec vitest run test/integration/routes/dashboard-test-performance.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit route and details**

```bash
git add src/routes/tenant/dashboard.ts src/lib/executive-test-analytics.ts test/integration/routes/dashboard-test-performance.test.ts
git commit -m "fix: show billing-only test details"
```

---

### Task 3: Update dashboard types, table, drawer, and sort state

**Files:**
- Modify: `web/src/types/executiveDashboard.ts`
- Modify: `web/src/components/dashboard/TestPerformancePanel.tsx`
- Modify: `web/src/components/dashboard/TestPerformancePanel.test.tsx`
- Modify: `web/src/components/dashboard/TestPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/TestPerformanceDrawer.test.tsx`
- Modify: `web/src/components/dashboard/ExecutiveControlKpis.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: relevant tests for those dashboard containers if assertions depend on the default sort

**Interfaces:**
- Consumes: API types from Tasks 1-2
- Produces: six-column billing report and billing-line detail drawer

- [ ] **Step 1: Rewrite component fixtures as failing billing metrics tests**

Use totals and row data shaped like:

```ts
{
  quantity: 76,
  billed: 27584,
  collected: 26061,
  due: 1523,
  testCommission: 1200,
}
```

Assert headers are exactly:

```ts
['Test', 'Quantity', 'Billed', 'Collected', 'Due', 'Test Commission']
```

Assert Completed, Ordered, Pending, Cancelled are absent.

- [ ] **Step 2: Run component tests and confirm failure**

Run:

```bash
pnpm --dir web exec vitest run src/components/dashboard/TestPerformancePanel.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx
```

Expected: FAIL because legacy fields and columns remain.

- [ ] **Step 3: Update shared frontend types**

Change `TestSort` to:

```ts
export type TestSort = 'quantity' | 'billed' | 'collected' | 'due' | 'testCommission';
```

Remove operational fields from summary and detail interfaces as defined in Tasks 1-2.

- [ ] **Step 4: Render the six-column billing table**

Update the title/subtitle to explain the selected-period billing basis. Render Quantity as a sortable column and make Billed sortable. Remove all operational-status cells.

- [ ] **Step 5: Simplify the detail drawer**

Render columns:

```text
Time | Patient | Referring Doctor | Invoice | Billed | Collected | Due | Test Commission
```

Change empty copy from “No orders” to “No billed test lines were found for this test and period.”

- [ ] **Step 6: Change both dashboard container default sorts**

In `ExecutiveControlKpis.tsx` and `KPISummaryCards.tsx`:

```ts
const [testSortBy, setTestSortBy] = useState<TestSort>('quantity');
```

- [ ] **Step 7: Run frontend tests**

Run:

```bash
pnpm --dir web exec vitest run src/components/dashboard/TestPerformancePanel.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit frontend contract**

```bash
git add web/src/types/executiveDashboard.ts web/src/components/dashboard/TestPerformancePanel.tsx web/src/components/dashboard/TestPerformancePanel.test.tsx web/src/components/dashboard/TestPerformanceDrawer.tsx web/src/components/dashboard/TestPerformanceDrawer.test.tsx web/src/components/dashboard/ExecutiveControlKpis.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx
git commit -m "fix: present test billing performance"
```

---

### Task 4: Production-data reconciliation and final verification

**Files:**
- Modify only if verification finds a defect in Tasks 1-3

**Interfaces:**
- Produces: verified branch ready to merge

- [ ] **Step 1: Run the complete focused backend suite**

```bash
pnpm exec vitest run test/integration/routes/dashboard-test-performance.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the focused frontend suite**

```bash
pnpm --dir web exec vitest run src/components/dashboard/TestPerformancePanel.test.tsx src/components/dashboard/TestPerformanceDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript/build verification**

```bash
pnpm typecheck
pnpm --dir web build
```

Expected: both commands exit 0.

- [ ] **Step 4: Run the summary SQL against production read-only data for tenant example and 2026-07-01 through 2026-07-13**

Confirm the result includes billing data before 2026-07-09 and reconciles near the previously audited totals:

```text
Test invoice lines: 584
Billed: 289600
Allocated collected: 274800
Due: 14800
```

Differences are acceptable only if production data changed after the audit; document the fresh query time and values.

- [ ] **Step 5: Review the final diff for forbidden dependencies**

Confirm summary/detail SQL does not require `ii.reference_id = lab_order_items.id`, and no reagent files were changed.

- [ ] **Step 6: Commit any verification fix, then merge according to the user's requested branch workflow**

```bash
git add <verified-files>
git commit -m "test: verify billing-backed test performance"
```

# Admin Doctor Compensation Drilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add doctor-wise discount and compensation lifecycle reporting with complete server-owned drilldown evidence.

**Architecture:** Extend the existing executive doctor analytics SQL and additive response types. Keep performer reserve as a separate authoritative source, aggregate non-performer commission accruals without double-counting, and render a focused doctor table plus a complete-result drawer summary and detailed ledger.

**Tech Stack:** TypeScript, Hono, D1/SQLite SQL, React, TanStack Query through `useApiQuery`, Vitest, Testing Library.

## Global Constraints

- Source branch is current clean `main` at `2353587d8`.
- Operational invoice, commission accrual, performer reserve, and settlement tables remain authoritative.
- Do not create a parallel ledger or calculate full totals from paginated rows.
- Preserve existing response fields for compatibility.
- Exclude cancelled/reversed facts and prevent performer reserve double-counting.
- Use Asia/Dhaka period semantics already provided by `ExecutiveDashboardPeriod`.
- Implement with TDD and commit each verified task.
- Do not merge, push, deploy, or mutate production.

---

### Task 1: Extend Doctor Summary Semantics

**Files:**
- Modify: `src/lib/executive-doctor-analytics.ts`
- Modify: `web/src/types/executiveDashboard.ts`
- Test: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Test: `test/integration/routes/dashboard-doctor-performance.test.ts`

**Interfaces:**
- Produces new `DoctorPerformanceRow` fields: `referredTests`, `discountedTests`, `testGrossAmount`, `testDiscountAmount`, `performedTests`, `earnedCommission`, `doctorWaiver`, `payableCommission`, `paidCommission`, `outstandingCommission`.
- Preserves `tests`, `performerReserveCount`, and `totalCommission` as compatibility aliases.

- [ ] **Step 1: Write failing summary assertions**

Add a fixture with a fully discounted referred test, one paid performer reserve, one unpaid performer reserve, and one full doctor waiver. Assert:

```ts
expect(row).toMatchObject({
  referredTests: 3,
  discountedTests: 1,
  testGrossAmount: 2100,
  testDiscountAmount: 700,
  performedTests: 2,
  earnedCommission: 500,
  doctorWaiver: 100,
  payableCommission: 400,
  paidCommission: 200,
  outstandingCommission: 200,
});
```

- [ ] **Step 2: Run tests and verify missing fields fail**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-doctor-performance.test.ts
```

Expected: FAIL on new fields.

- [ ] **Step 3: Extend backend types and SQL**

Add helpers:

```ts
function earnedCommissionAmountSql(alias: string): string {
  return `(CASE
    WHEN COALESCE(${alias}.earned_commission_amount, 0) > 0 OR COALESCE(${alias}.doctor_waiver_amount, 0) > 0
      THEN MAX(COALESCE(${alias}.earned_commission_amount, 0), ${reconciledCommissionAmountSql(alias)} + COALESCE(${alias}.doctor_waiver_amount, 0))
    ELSE ${reconciledCommissionAmountSql(alias)}
  END)`;
}

function paidCommissionAmountSql(alias: string): string {
  return `MIN(${reconciledCommissionAmountSql(alias)}, MAX(0, COALESCE(${alias}.paid_amount, 0)))`;
}
```

Extend test facts with gross, net, discounted count, and discount. Add a non-performer compensation CTE with earned, waiver, payable, paid, and outstanding. Extend performer reserve facts with earned/payable/paid/outstanding by status. Combine both sources in `doctor_rows` and window totals.

- [ ] **Step 4: Map fields and preserve aliases**

```ts
referredTests: wholeNumber(row.referred_tests),
tests: wholeNumber(row.referred_tests),
performedTests: wholeNumber(row.performed_tests),
performerReserveCount: wholeNumber(row.performed_tests),
payableCommission: roundMoney(row.payable_commission),
totalCommission: roundMoney(row.payable_commission),
```

- [ ] **Step 5: Run tests and commit**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-doctor-performance.test.ts
pnpm exec tsc --noEmit

git add src/lib/executive-doctor-analytics.ts web/src/types/executiveDashboard.ts test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-doctor-performance.test.ts
git commit -m "feat(dashboard): expose doctor compensation lifecycle totals"
```

---

### Task 2: Add Complete Doctor Detail Summary and Calculation Rows

**Files:**
- Modify: `src/lib/executive-doctor-analytics.ts`
- Modify: `web/src/types/executiveDashboard.ts`
- Test: `test/integration/routes/dashboard-doctor-compensation-details.test.ts`
- Test: `test/integration/executive-dashboard-analytics-sqlite.test.ts`

**Interfaces:**
- Produces `DoctorPerformanceDetailsResponse.summary`.
- Extends `DoctorTestDetailRow` and `DoctorCommissionDetailRow` with calculation-chain fields.

- [ ] **Step 1: Write failing detail assertions**

Assert a full-waiver commission row contains:

```ts
expect(row).toMatchObject({
  grossAmount: 700,
  discountAmount: 100,
  performerReserveAmount: 200,
  commissionBaseAmount: 400,
  earnedAmount: 100,
  waiverAmount: 100,
  payableAmount: 0,
  paidAmount: 0,
  outstandingAmount: 0,
});
```

Assert a fully discounted test contains `grossAmount: 700`, `discountAmount: 700`, and `netBilledAmount: 0`. Assert response summary totals are complete-result totals independent of `pageSize`.

- [ ] **Step 2: Run detail tests and verify failure**

```bash
pnpm exec vitest run test/integration/routes/dashboard-doctor-compensation-details.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
```

- [ ] **Step 3: Extend test-detail SQL**

Use:

```sql
MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)) AS gross_amount,
MAX(0, COALESCE(ii.line_total, 0)) AS net_billed_amount,
MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1) - COALESCE(ii.line_total, 0)) AS discount_amount
```

Extend referral attribution with reserve/base/earned/waiver/payable/paid/outstanding aggregates.

- [ ] **Step 4: Extend compensation union**

For accrual rows return explicit calculation fields and settlement metadata. For reserve rows return unit service/discount/net base/rate when available, reserve as earned/payable, and status-based paid/outstanding. Join `doctor_commission_settlements` for settlement number.

Add `doctorDetailSummarySql()` and run summary and page queries through `Promise.all` inside `getDoctorPerformanceDetails()`.

- [ ] **Step 5: Map response and commit**

```bash
pnpm exec vitest run test/integration/routes/dashboard-doctor-compensation-details.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
pnpm exec tsc --noEmit

git add src/lib/executive-doctor-analytics.ts web/src/types/executiveDashboard.ts test/integration/routes/dashboard-doctor-compensation-details.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
git commit -m "feat(dashboard): add doctor compensation calculation drilldown"
```

---

### Task 3: Focus the Doctor Performance Table

**Files:**
- Modify: `web/src/components/dashboard/DoctorPerformancePanel.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformancePanel.test.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: `web/src/components/dashboard/ExecutiveControlKpis.tsx`

**Interfaces:**
- Consumes Task 1 fields.
- Produces a focused table with readable lifecycle labels and sorting.

- [ ] **Step 1: Write failing UI assertions**

Assert visible headers:

```ts
['Referred Tests', 'Discounted Tests', 'Test Discount', 'Performed Tests', 'Earned', 'Doctor Waiver', 'Payable', 'Paid', 'Outstanding']
```

Assert old equal-priority headers such as `Referrer Commission`, `Test Total`, and `Other Commission` are absent from the default table.

- [ ] **Step 2: Run component tests and verify failure**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx
```

- [ ] **Step 3: Replace table columns and money formatting**

Use BDT formatting with two decimals for money and counts without decimals. Keep doctor action accessible and sticky. Extend sort types for `testDiscount`, `earnedCommission`, `payableCommission`, and `outstandingCommission`; default to payable while retaining legacy `totalCommission` query compatibility.

- [ ] **Step 4: Update callers and tests**

Change initial sort state to `payableCommission` in both admin and shared executive components.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/ExecutiveControlKpis.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx
pnpm --filter web build

git add web/src/components/dashboard/DoctorPerformancePanel.tsx web/src/components/dashboard/DoctorPerformancePanel.test.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx web/src/components/dashboard/ExecutiveControlKpis.tsx web/src/types/executiveDashboard.ts src/lib/executive-doctor-analytics.ts
git commit -m "feat(dashboard): focus doctor performance on understandable totals"
```

---

### Task 4: Render Drawer Summary and Detailed Compensation Ledger

**Files:**
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.tsx`
- Modify: `web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx`

**Interfaces:**
- Consumes Task 2 response summary and row fields.
- Produces complete summary cards and detailed referred-test/compensation tables.

- [ ] **Step 1: Write failing drawer assertions**

Assert header summary displays `Earned`, `Doctor Waiver`, `Payable`, `Paid`, `Outstanding`, `Test Discount`, and `Performer Reserve`. Assert compensation table headers include the calculation chain and test table includes Gross/Discount/Net billed.

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformanceDrawer.test.tsx
```

- [ ] **Step 3: Add server-summary cards**

Render compact cards from `query.data.summary`. Do not reduce visible rows to create totals.

- [ ] **Step 4: Expand test and compensation tables**

Rename tabs to `Visits`, `Referred Tests`, and `Compensation Ledger`. Add calculation columns, BDT formatting, rate/settlement/waiver reason, and clear empty/error states. Reset page when the date range changes as well as doctor/tab.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/DoctorPerformancePanel.test.tsx
pnpm --filter web build

git add web/src/components/dashboard/DoctorPerformanceDrawer.tsx web/src/components/dashboard/DoctorPerformanceDrawer.test.tsx
git commit -m "feat(dashboard): explain doctor compensation in drilldown"
```

---

### Task 5: Full Focused Verification and Documentation Evidence

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-admin-doctor-compensation-drilldown-design.md`
- Modify: `_bmad-output/_progress/00-design-log.md`

**Interfaces:**
- Consumes all implementation tasks.
- Produces verification evidence and continuation state.

- [ ] **Step 1: Run backend verification**

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts test/integration/routes/dashboard-doctor-performance.test.ts test/integration/routes/dashboard-doctor-compensation-details.test.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 2: Run frontend verification**

```bash
pnpm --filter web exec vitest run src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/DoctorPerformanceDrawer.test.tsx src/components/dashboard/ExecutiveControlKpis.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx
pnpm --filter web build
```

- [ ] **Step 3: Run whitespace and change review**

```bash
git diff --check
```

Review changed files for double counting, false zero, page-local totals, permission leakage, and unrelated edits.

- [ ] **Step 4: Record evidence**

Append exact commands and pass counts to the design document and design log.

- [ ] **Step 5: Commit final evidence**

```bash
git add docs/superpowers/specs/2026-07-22-admin-doctor-compensation-drilldown-design.md _bmad-output/_progress/00-design-log.md
git commit -m "docs(dashboard): record doctor compensation verification"
```

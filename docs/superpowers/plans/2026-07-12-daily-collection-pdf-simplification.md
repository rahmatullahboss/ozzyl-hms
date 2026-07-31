# Daily Collection PDF Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reconciliation-heavy Daily Collection PDF with a compact report containing Total Collection, Total Expense, Cash in Hand, service-source breakdown, payment-method breakdown, and expense-head breakdown.

**Architecture:** Keep the existing `buildReportBody` report router and print shell. Change only the `dailyCollection` branch to consume normalized fields already returned by `/api/reports/daily-collection`; no browser-side financial recomputation beyond table totals. Preserve every other PDF report path.

**Tech Stack:** React 19, TypeScript, Vitest, existing HTML string report renderer, shared `formatCurrency` helper.

## Global Constraints

- Total Collection must use `collection.finance_summary.total_received`, including deposits/advances.
- Total Expense must use `collection.summary.total_expense`.
- Cash in Hand must use `collection.cash_closing.cash_in_hand` and must preserve negative values.
- Collection source rows must use `collection.collection_sources`.
- Payment method rows must prefer `collection.payment_methods`, with compatibility fallback to `collection.by_payment_method`.
- Expense rows must use `collection.expenses`.
- Do not render bill reconciliation, discount explanation, due metrics, service bill totals, receipt direction, transaction counts, shares, or transaction details.
- Do not modify backend financial queries unless tests expose an API defect.
- Preserve unrelated working-tree changes and make scoped commits only.

---

### Task 1: Add failing Daily Collection PDF behavior tests

**Files:**
- Modify: `web/src/pages/AdminPdfGenerationPage.test.tsx:9-134`
- Modify: `web/src/pages/AdminPdfGenerationPage.test.tsx:356-391`

**Interfaces:**
- Consumes: `buildReportBody(type: ReportType, data: BuildReportBodyData): string`
- Produces: executable expectations for the simplified `dailyCollection` HTML contract.

- [x] **Step 1: Extend the fixture with normalized API fields**

Add the following properties to `collectionFixture`:

```ts
collection_sources: [
  { department: 'Doctor Visit / Consultation', amount: 23_600 },
  { department: 'Diagnostic / Laboratory', amount: 41_600 },
  { department: 'Deposits / Advances', amount: 4_200 },
],
payment_methods: [
  { method: 'Cash', amount: 40_000, percentage: 57.64 },
  { method: 'bKash', amount: 29_400, percentage: 42.36 },
],
expenses: [
  { expense_head: 'Transport', amount: 2_020 },
  { expense_head: 'Doctor payouts', amount: 1_000 },
],
cash_closing: {
  cash_in_hand: 36_480,
},
```

- [x] **Step 2: Replace the legacy reconciliation test with the approved layout test**

Use a focused test that asserts:

```ts
const html = buildReportBody('dailyCollection', reportData);
expect(html).toContain('<span>Total Collection</span>');
expect(html).toContain('<span>Total Expense</span>');
expect(html).toContain('<span>Cash in Hand</span>');
expect(html).toContain('৳69,400.00');
expect(html).toContain('৳3,020.00');
expect(html).toContain('৳36,480.00');
expect(html).toContain('Collection Source Breakdown');
expect(html).toContain('Doctor Visit / Consultation');
expect(html).toContain('Diagnostic / Laboratory');
expect(html).toContain('Deposits / Advances');
expect(html).toContain('Payment Method Breakdown');
expect(html).toContain('Cash');
expect(html).toContain('bKash');
expect(html).toContain('Expense Breakdown');
expect(html).toContain('Doctor payouts');
expect(html).not.toContain('Bill Reconciliation');
expect(html).not.toContain('Management Income Reconciliation');
expect(html).not.toContain('Receipt Collection Summary');
expect(html).not.toContain('Transaction Details');
expect(html).not.toContain('Final Bill Amount');
expect(html).not.toContain('Due Remaining');
```

- [x] **Step 3: Add an authoritative-source and empty-state test**

Create a second test with conflicting legacy values and empty arrays:

```ts
const html = buildReportBody('dailyCollection', {
  includeSummary: true,
  includeDetails: true,
  pageSize: 'a4',
  orientation: 'portrait',
  collection: {
    finance_summary: { total_received: 12_345 },
    summary: { total_collection: 99_999, total_expense: 500, net_cash: 88_888 },
    cash_closing: { cash_in_hand: -250 },
    collection_sources: [],
    payment_methods: [],
    expenses: [],
    details: [{ transaction_type: 'CashSales', amount: 12_345 }],
  },
});
expect(html).toContain('৳12,345.00');
expect(html).toContain('৳500.00');
expect(html).toContain('৳-250.00');
expect(html).not.toContain('৳99,999.00');
expect(html).not.toContain('৳88,888.00');
expect(html).toContain('No collection source data found.');
expect(html).toContain('No payment method data found.');
expect(html).toContain('No expense data found.');
expect(html).not.toContain('Cash sales');
```

- [x] **Step 4: Run the focused test and verify RED**

Run:

```bash
pnpm --filter web test -- AdminPdfGenerationPage.test.tsx
```

Expected: FAIL because the existing renderer still emits legacy reconciliation sections and does not use `cash_closing.cash_in_hand`.

---

### Task 2: Implement the simplified Daily Collection renderer

**Files:**
- Modify: `web/src/pages/AdminPdfGenerationPage.tsx:175-200`
- Modify: `web/src/pages/AdminPdfGenerationPage.tsx:784-845`

**Interfaces:**
- Consumes normalized collection response fields:
  - `finance_summary.total_received: number`
  - `summary.total_expense: number`
  - `cash_closing.cash_in_hand: number`
  - `collection_sources: Array<{ department: string; amount: number }>`
  - `payment_methods: Array<{ method: string; amount: number }>`
  - `expenses: Array<{ expense_head: string; amount: number }>`
- Produces the `dailyCollection` HTML body returned by `buildReportBody`.

- [x] **Step 1: Read normalized arrays and cash closing data near the other collection aliases**

Add:

```ts
const collectionSources = collection?.collection_sources ?? [];
const normalizedPaymentMethods = collection?.payment_methods ?? [];
const collectionExpenses = collection?.expenses ?? [];
const cashClosing = collection?.cash_closing ?? {};
```

- [x] **Step 2: Add a dedicated `dailyCollection` branch before unrelated report branches**

The branch must calculate only presentation totals:

```ts
const totalCollection = num(finance.total_received);
const totalExpense = num(summary.total_expense);
const cashInHand = num(cashClosing.cash_in_hand);
const sourceRows = collectionSources.filter((row: any) => num(row.amount) !== 0);
const paymentRows = (normalizedPaymentMethods.length
  ? normalizedPaymentMethods.map((row: any) => ({ label: row.method, amount: row.amount }))
  : paymentMethods.map((row: any) => ({ label: row.payment_method, amount: row.total_amount ?? row.net_amount ?? row.gross_amount })))
  .filter((row: any) => num(row.amount) !== 0);
const expenseRows = collectionExpenses.filter((row: any) => num(row.amount) !== 0);
```

Return one three-card summary and exactly three tables. Each table must have a bold final total row and a specific empty-state message. Labels must be passed through the existing `tableRows`/`escapeHtml` path.

- [x] **Step 3: Remove the legacy default Daily Collection body**

Delete the old calculations and HTML for:

- `billReconciliation`
- `collectionBreakdown`
- `serviceBillRows`
- `serviceReceiptRows`
- Management Income Reconciliation
- Bill Reconciliation
- Receipt Collection Summary
- Service-wise Bill Amount
- Service-wise Receipt Allocation
- transaction detail rendering for `dailyCollection`

Do not delete shared variables still used by other report types.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter web test -- AdminPdfGenerationPage.test.tsx
```

Expected: PASS for the entire file.

- [x] **Step 5: Refactor only after green**

Keep helper names local to `buildReportBody`; do not introduce a new component or backend route. Re-run the focused test after cleanup.

---

### Task 3: Verify compatibility and commit the implementation

**Files:**
- Verify: `web/src/pages/AdminPdfGenerationPage.tsx`
- Verify: `web/src/pages/AdminPdfGenerationPage.test.tsx`
- Verify: `web/src/pages/ReceptionReportsPage.test.ts`
- Verify: `docs/superpowers/plans/2026-07-12-daily-collection-pdf-simplification.md`

**Interfaces:**
- Consumes: completed renderer and tests.
- Produces: a scoped, verified Git commit.

- [x] **Step 1: Run TypeScript verification**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: PASS with exit code 0.

- [x] **Step 2: Run the complete web test suite**

```bash
pnpm --filter web test
```

Expected: PASS; pre-existing warning output is acceptable only if the command exits 0 and no new Daily Collection failures appear.

- [x] **Step 3: Inspect scoped changes**

Verify only these intended files are included in this task:

```text
docs/superpowers/plans/2026-07-12-daily-collection-pdf-simplification.md
web/src/pages/AdminPdfGenerationPage.tsx
web/src/pages/AdminPdfGenerationPage.test.tsx
web/src/pages/ReceptionReportsPage.test.ts
```

Do not stage unrelated backup/restore or partial-refund work.

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-12-daily-collection-pdf-simplification.md web/src/pages/AdminPdfGenerationPage.tsx web/src/pages/AdminPdfGenerationPage.test.tsx web/src/pages/ReceptionReportsPage.test.ts
git commit -m "fix: simplify daily collection pdf"
```

# Daily Collection PDF Operational Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Daily Collection PDF with the approved earlier operational information while keeping the current normalized API data mapping and deposit-inclusive collection total.

**Architecture:** Keep all financial truth in the existing `/daily-collection` API response and update only the shared PDF renderer plus focused compatibility tests. The renderer will consume normalized fields directly, calculate only presentation-only payment shares, preserve A4/A5 behavior, and restore transaction details only behind the existing `includeDetails` option.

**Tech Stack:** React, TypeScript, Vitest, pnpm, server-rendered HTML strings for print/PDF output.

## Global Constraints

- Do not revert any file or reuse the older incorrect data mapping.
- `Total Collection Today` must use `finance_summary.total_received` and include deposits/advances.
- `Total Deposit Today` is an informational subset and must not be added to Total Collection again.
- `Net Cash Today` must use `cash_closing.net_cash_movement`, falling back to `summary.net_cash` only when missing.
- Do not show `Cash in Hand` in the Daily Collection PDF.
- Preserve negative Net Cash Today values.
- Keep Management Income Reconciliation, Bill Reconciliation, receipt-direction tables, discount explanations, and duplicated service allocation sections removed.
- Preserve existing A4/A5, portrait/landscape, signature, escaping, date, and currency formatting behavior.
- Do not modify unrelated files or existing uncommitted work in the primary checkout.

---

### Task 1: Lock the approved Daily Collection output in focused tests

**Files:**
- Modify: `web/src/pages/AdminPdfGenerationPage.test.tsx:9-92,390-442`
- Modify: `web/src/pages/ReceptionReportsPage.test.ts:377-447`

**Interfaces:**
- Consumes: `buildReportBody(type: ReportType, data: BuildReportBodyData): string`
- Produces: failing behavioral expectations for the six-card summary, operational sections, payment shares, optional transaction details, normalized totals, empty states, and negative net cash.

- [x] **Step 1: Update the primary fixture with authoritative net cash movement**

Add `net_cash_movement: 35_980` to `collectionFixture.cash_closing` while retaining `cash_in_hand: 36_480` so the test can prove the renderer selects the correct field.

```ts
cash_closing: {
  net_cash_movement: 35_980,
  cash_in_hand: 36_480,
},
```

- [x] **Step 2: Replace the simplified-layout test with approved operational expectations**

The test must assert all six cards, deposit-inclusive total, deposit subset, operational summary, department/source rows, payment share, expense rows, and restored details.

```ts
it('renders the approved daily collection operational summary from normalized totals', () => {
  const html = buildReportBody('dailyCollection', reportData);

  expect(html).toContain('<span>Total Billed Today</span>');
  expect(html).toContain('<span>Total Collection Today</span>');
  expect(html).toContain('<span>Total Deposit Today</span>');
  expect(html).toContain('<span>Total Expense</span>');
  expect(html).toContain('<span>Total Due Today</span>');
  expect(html).toContain('<span>Net Cash Today</span>');
  expect(html).not.toContain('<span>Cash in Hand</span>');

  expect(html).toContain('৳67,300.00');
  expect(html).toContain('৳69,400.00');
  expect(html).toContain('৳4,200.00');
  expect(html).toContain('৳3,020.00');
  expect(html).toContain('৳3,500.00');
  expect(html).toContain('৳35,980.00');
  expect(html).not.toContain('৳36,480.00');

  expect(html).toContain('Operational Collection Summary');
  expect(html).toContain('Deposits Included in Total');
  expect(html).toContain('Department-wise Collection');
  expect(html).toContain('Doctor Visit / Consultation');
  expect(html).toContain('Diagnostic / Laboratory');
  expect(html).toContain('Deposits / Advances');
  expect(html).toContain('Payment Method Summary');
  expect(html).toContain('57.6%');
  expect(html).toContain('42.4%');
  expect(html).toContain('<h3>Expense</h3>');
  expect(html).toContain('Doctor payouts');
  expect(html).toContain('Transaction Details');
  expect(html).toContain('Cash sales');
  expect(html).toContain('INV-1001');

  expect(html).not.toContain('Bill Reconciliation');
  expect(html).not.toContain('Management Income Reconciliation');
  expect(html).not.toContain('Receipt Collection Summary');
});
```

- [x] **Step 3: Update the normalized/empty-state test to prove negative Net Cash Today and detail toggling**

Use a negative `cash_closing.net_cash_movement`, a conflicting `cash_in_hand`, and `includeDetails: false`.

```ts
it('uses normalized totals, preserves negative net cash, and renders daily collection empty states', () => {
  const html = buildReportBody('dailyCollection', {
    includeSummary: true,
    includeDetails: false,
    pageSize: 'a4',
    orientation: 'portrait',
    collection: {
      bill_summary: { final_bill_amount: 2_000, due_remaining: 150 },
      finance_summary: { total_received: 12_345, deposit_collection: 345 },
      summary: {
        total_bill: 1_900,
        total_collection: 99_999,
        total_deposit: 999,
        total_expense: 500,
        total_due: 125,
        net_cash: 88_888,
      },
      cash_closing: { net_cash_movement: -250, cash_in_hand: 9_999 },
      collection_sources: [],
      payment_methods: [],
      expenses: [],
      details: [{ transaction_type: 'CashSales', amount: 12_345 }],
    },
  });

  expect(html).toContain('৳1,900.00');
  expect(html).toContain('৳12,345.00');
  expect(html).toContain('৳345.00');
  expect(html).toContain('৳500.00');
  expect(html).toContain('৳125.00');
  expect(html).toContain('৳-250.00');
  expect(html).not.toContain('৳99,999.00');
  expect(html).not.toContain('৳88,888.00');
  expect(html).not.toContain('৳9,999.00');
  expect(html).toContain('No collection source data found.');
  expect(html).toContain('No payment method data found.');
  expect(html).toContain('No expense data found.');
  expect(html).not.toContain('Transaction Details');
  expect(html).not.toContain('Cash sales');
});
```

- [x] **Step 4: Update the Reception compatibility fixture and expectations**

Add normalized summary values and `cash_closing.net_cash_movement`, then assert that `includeDetails: true` restores details while reconciliation clutter remains absent.

```ts
finance_summary: { total_received: 4500, deposit_collection: 500 },
summary: { total_bill: 5000, total_deposit: 500, total_expense: 0, total_due: 500 },
cash_closing: { net_cash_movement: 4400, cash_in_hand: 4500 },
```

```ts
expect(dailyCollectionHtml).toContain('Department-wise Collection');
expect(dailyCollectionHtml).toContain('Payment Method Summary');
expect(dailyCollectionHtml).toContain('Transaction Details');
expect(dailyCollectionHtml).toContain('INV-1');
expect(dailyCollectionHtml).toContain('RCP-1');
expect(dailyCollectionHtml).not.toContain('Discount given');
expect(dailyCollectionHtml).not.toContain('Bill Reconciliation');
```

- [x] **Step 5: Run the focused tests and verify RED**

Run:

```bash
cd web
pnpm test AdminPdfGenerationPage.test.tsx ReceptionReportsPage.test.ts
```

Expected: FAIL because the renderer still shows only Total Collection, Total Expense, and Cash in Hand; lacks the operational summary/share columns; and suppresses transaction details.

---

### Task 2: Implement the operational Daily Collection renderer

**Files:**
- Modify: `web/src/pages/AdminPdfGenerationPage.tsx:169-200,767-818`
- Test: `web/src/pages/AdminPdfGenerationPage.test.tsx`
- Test: `web/src/pages/ReceptionReportsPage.test.ts`

**Interfaces:**
- Consumes: existing normalized API fields on `data.collection`
- Produces: Daily Collection HTML with six summary cards, operational overview, source/payment/expense tables, and optional transaction details.

- [x] **Step 1: Map the six approved values directly from normalized fields**

Replace the three-value setup with:

```ts
const totalBilled = num(summary.total_bill ?? billSummary.final_bill_amount);
const totalCollection = num(finance.total_received);
const totalDeposit = num(finance.deposit_collection ?? summary.total_deposit);
const totalExpense = num(summary.total_expense);
const totalDue = num(summary.total_due ?? billSummary.due_remaining);
const netCashToday = num(cashClosing.net_cash_movement ?? summary.net_cash);
```

- [x] **Step 2: Preserve normalized rows and add display-only payment shares**

Normalize payment rows with an optional percentage. Use the server percentage when present; otherwise calculate from `totalCollection`.

```ts
const paymentRows = (normalizedPaymentMethods.length > 0
  ? normalizedPaymentMethods.map((row: any) => ({
      label: row.method || 'Unknown',
      amount: num(row.amount),
      percentage: row.percentage == null ? null : num(row.percentage),
    }))
  : paymentMethods.map((row: any) => ({
      label: row.payment_method ? transactionTypeLabel(row.payment_method) : 'Unknown',
      amount: num(row.total_amount ?? row.net_amount ?? row.gross_amount),
      percentage: null,
    })))
  .filter((row: any) => row.amount !== 0)
  .map((row: any) => ({
    ...row,
    share: row.percentage == null
      ? (totalCollection > 0 ? (row.amount / totalCollection) * 100 : 0)
      : row.percentage,
  }));
```

- [x] **Step 3: Render the approved six-card summary and operational overview**

Use the existing summary-grid markup and a separate non-arithmetic overview table.

```ts
${data.includeSummary ? `<section class="summary-grid">
  <div class="metric"><span>Total Billed Today</span><strong>${money(totalBilled)}</strong></div>
  <div class="metric"><span>Total Collection Today</span><strong>${money(totalCollection)}</strong></div>
  <div class="metric"><span>Total Deposit Today</span><strong>${money(totalDeposit)}</strong></div>
  <div class="metric"><span>Total Expense</span><strong>${money(totalExpense)}</strong></div>
  <div class="metric"><span>Total Due Today</span><strong>${money(totalDue)}</strong></div>
  <div class="metric"><span>Net Cash Today</span><strong>${money(netCashToday)}</strong></div>
</section>` : ''}

<h3>Operational Collection Summary</h3>
<table><tbody>
  <tr><td>Total Collection Today</td><td class="right">${money(totalCollection)}</td></tr>
  <tr><td>Deposits Included in Total</td><td class="right">${money(totalDeposit)}</td></tr>
  <tr><td>Total Expense</td><td class="right">${money(totalExpense)}</td></tr>
  <tr class="bold border-top"><td><strong>Net Cash Today</strong></td><td class="right"><strong>${money(netCashToday)}</strong></td></tr>
</tbody></table>
```

- [x] **Step 4: Rename and expand the three breakdown tables**

Render:

```ts
<h3>Department-wise Collection</h3>
```

with `Department / Collection Source` and `Amount`; render:

```ts
<h3>Payment Method Summary</h3>
```

with `Payment Method`, `Amount`, and `Share`; render:

```ts
<h3>Expense</h3>
```

with `Expense Head` and `Amount`. Keep authoritative total rows and existing empty-state messages.

Use one-decimal payment shares:

```ts
{ label: 'Share', align: 'right', render: (r: any) => `${r.share.toFixed(1)}%` }
```

- [x] **Step 5: Restore transaction details behind `includeDetails`**

Append the existing responsive transaction table only when `data.includeDetails` is true.

```ts
${data.includeDetails ? `
  <h3>Transaction Details</h3>
  <table>
    <thead><tr>${transactionHeaders}</tr></thead>
    <tbody>${tableRows(transactions.slice(0, detailLimit), transactionColumns)}</tbody>
  </table>
` : ''}
```

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
cd web
pnpm test AdminPdfGenerationPage.test.tsx ReceptionReportsPage.test.ts
```

Expected: both files pass with all Daily Collection and compatibility assertions green.

- [x] **Step 7: Run TypeScript and the full web suite**

Run:

```bash
cd web
pnpm exec tsc --noEmit
pnpm test
```

Expected: TypeScript exits 0 and the full web test suite passes. Existing non-failing warnings may remain, but no new failures are acceptable.

- [x] **Step 8: Review scoped changes and commit**

Review only these files:

```bash
git diff -- docs/superpowers/plans/2026-07-12-daily-collection-pdf-operational-summary.md web/src/pages/AdminPdfGenerationPage.tsx web/src/pages/AdminPdfGenerationPage.test.tsx web/src/pages/ReceptionReportsPage.test.ts
```

Then commit:

```bash
git add docs/superpowers/plans/2026-07-12-daily-collection-pdf-operational-summary.md web/src/pages/AdminPdfGenerationPage.tsx web/src/pages/AdminPdfGenerationPage.test.tsx web/src/pages/ReceptionReportsPage.test.ts
git commit -m "feat: expand daily collection operational PDF"
```

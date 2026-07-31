# Daily Collection PDF Simplification Design

## Purpose

Replace the current reconciliation-heavy Daily Collection PDF with a compact operational report that answers four questions clearly:

1. How much money was received during the selected date range?
2. Which hospital service/source generated that money?
3. Which payment methods were used?
4. How much was spent, under which expense heads, and how much cash is currently in hand?

The report must avoid duplicate totals, accounting jargon, bill reconciliation blocks, discount explanations, due-bill metrics, and transaction-level noise.

## Approved Report Layout

### 1. Header

Keep the existing hospital name, report title, generated date/user, selected date range, and paper information.

### 2. Top Summary

Show exactly three primary summary cards:

- **Total Collection** — all money received through every payment method during the selected period, including patient deposits/advances.
- **Total Expense** — paid operating expenses plus doctor payouts included by the server-side daily collection report.
- **Cash in Hand** — closing physical cash from the server-provided cash closing calculation, including opening cash and actual cash movements.

Do not show Total Bill, Due Remaining, Final Bill Amount, Net Income, Patient Deposit Liability, Total Receipts, Cash-only Receipts, or other overlapping cards in this PDF.

### 3. Collection Source Breakdown

Show a simple two-column table: **Collection Source** and **Amount**.

Use the existing server-provided `collection_sources` data, which allocates received bill payments by service and separately includes deposits. Expected source labels include:

- Doctor Visit / Consultation
- Diagnostic / Laboratory
- Other Services
- Deposits / Advances

Add a final **Total Collection** row. The table total must reconcile with the top Total Collection amount within normal currency rounding.

Do not add a separate Due Collection row when those receipts are already allocated to service sources, because that would double-count the same money.

### 4. Payment Method Breakdown

Keep the cash-source/payment-method section requested by the user.

Show a table with **Payment Method** and **Amount**. Include only methods actually used, such as:

- Cash
- bKash
- Nagad
- Card
- Bank Transfer
- Cheque
- Other/Unknown methods returned by the API

Add a final **Total Collection** row. This total must reconcile with the top Total Collection amount.

### 5. Expense Breakdown

Show a table with **Expense Head** and **Amount**, using the server-provided `expenses` list. It includes paid expense categories and doctor payouts where applicable.

Add a final **Total Expense** row matching the top Total Expense card.

When there are no expenses, show a clear zero-state row instead of an empty table.

## Source of Truth and Data Mapping

The PDF must use server-calculated fields and must not recreate financial formulas in the browser.

| PDF value | API source |
| --- | --- |
| Total Collection | `finance_summary.total_received` |
| Total Expense | `summary.total_expense` |
| Cash in Hand | `cash_closing.cash_in_hand` |
| Collection Source Breakdown | `collection_sources` |
| Payment Method Breakdown | `payment_methods` |
| Expense Breakdown | `expenses` |

`summary.total_collection` must not be used for the top Total Collection card because it intentionally excludes deposits, while the approved PDF total includes deposits/advances.

## Removed Content

Remove the following from the Daily Collection PDF body:

- eleven-card summary grid
- Management Income Reconciliation
- Bill Reconciliation
- Receipt Collection Summary
- Service-wise Bill Amount
- duplicate Service-wise Receipt Allocation block
- discount and due explanations
- Final Bill Amount, Paid Against Bills, and Due Remaining
- transaction detail table
- payment transaction counts and percentage/share columns
- receipt direction labels

These remain available through other dedicated reports where needed; they do not belong in the simplified Daily Collection PDF.

## Rendering Rules

- Keep A4/A5 and portrait/landscape support.
- Use the existing report typography, currency formatting, and print shell.
- Use one compact summary row followed by three clearly titled tables.
- Do not render zero-value collection sources or unused payment methods unless all rows are zero.
- Keep negative cash-in-hand values visible; never clamp them to zero.
- Preserve HTML escaping for all server-returned labels.

## Error and Empty-State Handling

- Missing numeric values render as zero through the existing safe numeric helper.
- Missing arrays render a single “No data found” row.
- The top summary remains authoritative; breakdown totals are calculated only for their final table rows.
- The PDF must not silently substitute billed amount for received amount.

## Testing

Update focused tests for `buildReportBody('dailyCollection', ...)` to verify:

1. exactly the three approved summary metrics are rendered;
2. Total Collection uses `finance_summary.total_received`, including deposits;
3. collection source, payment method, and expense tables render their API data;
4. each table has the correct total row;
5. Cash in Hand uses `cash_closing.cash_in_hand` rather than `summary.net_cash`;
6. legacy reconciliation headings and transaction details are absent;
7. empty expense/source/payment arrays render safely;
8. Bengali currency formatting remains valid through the shared formatter;
9. other PDF report types are unaffected.

## Scope

This change is limited to the Daily Collection PDF rendering and its focused tests. The server endpoint already exposes the required normalized fields, so backend query changes are not planned unless implementation tests prove an API reconciliation defect.
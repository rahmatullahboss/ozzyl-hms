# Daily Collection PDF Operational Summary Design

## Purpose

Expand the simplified Daily Collection PDF so it shows the useful operational information from the earlier report layout without reverting to the earlier data mapping that produced incorrect totals.

The report must use the current normalized API fields as its source of truth. It must preserve the current fixes for deposit-inclusive collection totals and must replace the misleading `Cash in Hand` card with `Net Cash Today`.

## Approved Summary Cards

When summary display is enabled, show these six cards:

1. **Total Billed Today** — total posted bill amount for the selected period.
2. **Total Collection Today** — all money received through every payment method, including deposits/advances.
3. **Total Deposit Today** — the deposit/advance portion already included inside Total Collection Today.
4. **Total Expense** — server-calculated paid expenses and included doctor payouts.
5. **Total Due Today** — due amount created by bills in the selected period.
6. **Net Cash Today** — the selected period's physical cash movement after cash returns and physical cash outflows.

`Total Deposit Today` is informational. It must never be added again to `Total Collection Today`, because the approved total already includes deposits.

Do not show `Cash in Hand` in this PDF. Cash in hand can become zero after drawer handover and the current endpoint does not subtract completed handovers from `cash_closing.cash_in_hand`, so it is not a reliable period summary value here.

## Source of Truth

| PDF value | Primary API source | Fallback |
| --- | --- | --- |
| Total Billed Today | `summary.total_bill` | `bill_summary.final_bill_amount` |
| Total Collection Today | `finance_summary.total_received` | none; render zero if missing |
| Total Deposit Today | `finance_summary.deposit_collection` | `summary.total_deposit` |
| Total Expense | `summary.total_expense` | zero |
| Total Due Today | `summary.total_due` | `bill_summary.due_remaining` |
| Net Cash Today | `cash_closing.net_cash_movement` | `summary.net_cash` |
| Collection source rows | `collection_sources` | empty array |
| Payment method rows | `payment_methods` | normalized `by_payment_method` rows |
| Expense rows | `expenses` | empty array |
| Transaction rows | `details` | empty array |

The browser renderer must not recreate backend financial formulas beyond display-only totals and payment-share percentages.

## Report Sections

### 1. Operational Collection Summary

Show a compact overview table with:

- Total Collection Today — all payment methods, including deposits.
- Deposits Included in Total — informational subset.
- Total Expense.
- Net Cash Today — cash-only period movement.

Do not present these four lines as a single arithmetic equation because Total Collection and Total Expense are all-method/accounting figures while Net Cash Today is a physical-cash movement figure.

### 2. Department-wise Collection

Show a two-column table:

- Department / Collection Source
- Amount

Use `collection_sources`. Expected rows include Doctor Visit / Consultation, Diagnostic / Laboratory, Other Services, and Deposits / Advances. Filter zero-value rows and add a final `Total Collection` row using the authoritative deposit-inclusive total.

Do not create a separate Due Collection source row when due receipts are already allocated to their service source.

### 3. Payment Method Summary

Show:

- Payment Method
- Amount
- Share

Use normalized `payment_methods` when available. Otherwise normalize `by_payment_method`. Include only used methods. Share may use the server-provided percentage; if absent, derive it from the displayed payment amount divided by Total Collection Today. Add a final Total Collection row.

### 4. Expense

Show:

- Expense Head
- Amount

Use `expenses`, filter zero-value rows, and add a final Total Expense row. When there are no expenses, render a clear empty-state row.

### 5. Transaction Details

Restore transaction details only when the existing `includeDetails` option is enabled.

For A4, show:

- Serial
- Transaction Type
- Payment Method
- Invoice / Reference
- Time
- Amount

For compact A5 output, keep the existing reduced-column behavior so the table remains printable.

Transaction labels and references must continue to be HTML-escaped. Empty transaction data must render a safe empty state.

## Rendering Rules

- Keep existing A4/A5 and portrait/landscape support.
- Keep current shared currency and date formatting.
- Preserve negative Net Cash Today values; never clamp deficits to zero.
- Keep the current header, metadata, signature, and print shell.
- Do not restore Management Income Reconciliation, Bill Reconciliation, discount explanations, receipt-direction tables, or service bill-allocation duplication.
- Do not revert backend or frontend files to an old commit.

## Testing

Update focused Daily Collection PDF tests to verify:

1. all six approved summary cards render;
2. Total Collection Today uses `finance_summary.total_received` and includes deposits;
3. Total Deposit Today is displayed separately but not added twice;
4. Net Cash Today uses `cash_closing.net_cash_movement`, not `cash_closing.cash_in_hand`;
5. Total Billed, Total Expense, and Total Due use the approved normalized fields;
6. operational summary, department/source, payment method with share, expense, and transaction sections render correctly;
7. transaction details obey `includeDetails`;
8. empty arrays render safe empty states;
9. negative net cash remains visible;
10. the removed reconciliation-heavy sections remain absent;
11. other PDF report types remain unaffected.

## Scope

The planned implementation is limited to the Daily Collection PDF renderer and its focused compatibility tests. No backend query change is planned because the current endpoint already exposes the approved normalized values. A backend change should be made only if tests reveal that an approved field is missing or semantically incorrect.
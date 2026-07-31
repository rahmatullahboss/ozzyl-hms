# Doctor Visit Count and Expense Transaction Rows Design

## Goal

Fix two dashboard reporting issues:

1. Doctor Performance must show each doctor's own visit count instead of concentrating visits under one doctor.
2. Expense Analysis must show every paid operating expense and executed doctor payout as a separate table row.

## Doctor visit attribution

A visit row is one consultation-bearing bill in the selected reporting period. It is attributed using the same resolved doctor order already used for visit collection:

1. Consultation commission doctor on the bill
2. Doctor referenced by the consultation invoice line
3. Doctor on the linked visit
4. Referring doctor on the bill
5. Unassigned Doctor

The count key is the consultation bill, not the linked `visits.id`. This prevents multiple bills that reuse or incorrectly share a visit record from collapsing into one count. The resolved doctor is first materialized as `resolved_doctor_id` in a dedicated CTE and only then grouped; this avoids SQLite resolving `GROUP BY doctor_id` to the joined `visits.doctor_id` column instead of the SELECT alias, which was concentrating counts under one visit doctor. The reporting date prefers the consultation bill creation date and falls back to the linked visit date, so the count follows the billed visit shown in the dashboard period.

Visit Collection and Visit Count therefore use the same doctor resolution but remain separate metrics: collection is based on payments received in the selected period, while visit count is based on consultation bills created in the selected period.

## Expense transaction rows

The expense API will return one row per paid transaction instead of one aggregated row per category.

Each row contains:

- Stable transaction id/source
- Date/time
- Category
- Detail/description
- Paid amount
- Payment method
- Status

Sources:

- Operating expense: one row per qualifying `expenses` record.
- Doctor payout: one row per qualifying `cash_drawer_movements` record.

Approved-but-unpaid and rejected expenses remain excluded. Doctor payouts remain included only for executed cash-out settlement/payout movements.

The summary header continues to show overall transaction count and paid amount. Pagination is over transactions, 10 rows per page. Search matches category or detail. Sorting remains available by paid amount, category, or transaction date/count-compatible ordering.

## UI

Expense Analysis renders a normal line-by-line table. The grouped details list and “+ N more / Show less” interaction are removed.

Columns:

1. Date
2. Category
3. Details
4. Paid Amount
5. Payment Method
6. Status

The footer reads `Page N · X transactions` and keeps Previous/Next controls.

## Testing

Backend regression tests will verify:

- Two consultation bills assigned to different commission doctors produce one visit for each doctor.
- Reused linked visit ids do not collapse distinct consultation bills.
- Expense rows are returned one transaction per row with correct totals and tenant isolation.
- Unpaid and rejected expenses remain excluded.
- Pagination counts transactions, not categories.

Frontend tests will verify:

- Every expense description renders in its own table row.
- Group expansion controls are absent.
- Date, amount, payment method, and status render per transaction.
- Footer reports transaction count and pagination remains functional.

No database migration is required.

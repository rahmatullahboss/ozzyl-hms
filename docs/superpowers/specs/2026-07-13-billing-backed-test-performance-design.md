# Billing-Backed Test Performance Design

Date: 2026-07-13

## Goal

Make the executive dashboard Test Performance report show the complete selected-period diagnostic billing picture, including historical dates that do not have corresponding `lab_orders` or `lab_order_items` rows.

This change intentionally excludes reagent-management work.

## Source of truth

The report will use billing data as its authoritative source:

- `invoice_items`: test quantity, line amount, item reference, cancellation state
- `bills`: invoice date, patient, invoice number, bill state
- `billing_service_items`: test/service name and code
- `payments`: collected amount for the selected period
- `doctor_commission_accruals`: test-related doctor commission when it can be assigned to the billed service

`lab_orders` and `lab_order_items` will not determine the report's total test quantity or financial totals. They may not exist for older billing records and therefore cannot be the primary source for this report.

## Included billing rows

A row is included when:

- `invoice_items.item_category = 'test'`
- the invoice item belongs to the requested tenant
- the bill date falls inside the selected reporting period
- the invoice item is not cancelled
- the bill is not draft, cancelled, or refunded

Rows with a valid `invoice_items.reference_id` are grouped by that linked `billing_service_items.id`. A historical line with no valid service-item reference remains visible as its own description-based billing row instead of being silently discarded.

## Main table

The table will contain:

1. Test
2. Quantity
3. Billed
4. Collected
5. Due
6. Test Commission

The existing Completed, Ordered, Pending, and Cancelled columns will be removed because billing records do not carry reliable operational lab status for the entire historical period.

### Calculations

- Quantity: `SUM(COALESCE(invoice_items.quantity, 1))`
- Billed: sum of the effective line amount
  - use `line_total` when it is positive
  - otherwise fall back to `unit_price * quantity`
- Collected: allocate each bill's selected-period payment proportionally across its active invoice lines using each line's share of the bill allocation base
- Due: `MAX(0, billed - collected)`
- Test Commission: include only non-cancelled accruals that can be mapped to the billed service through `lab_test_catalog.billing_service_item_id`, the catalog/service code link, or a directly linked lab order item. Commission that cannot be assigned to a specific billed service will not be spread across unrelated tests.

The response totals will be calculated over the full filtered result set, not only the current page.

## Search, sorting, and pagination

Search will match service-item name, service-item code, and historical invoice-line description.

Supported sort fields will be:

- quantity
- billed
- collected
- due
- testCommission

The previous operational status filter and operational sort fields will be removed from the Test Performance API and UI.

## Detail drawer

Clicking a test will open billing-line details for the selected period rather than requiring a lab-order item.

Each detail row will show:

- bill/invoice time
- patient
- referring doctor when available from the bill
- invoice number
- billed amount
- proportionally allocated collected amount
- due amount
- assignable test commission

Ordering doctor, accession number, and lab status will be removed because they are unavailable for historical billing-only rows and would make the detail view incomplete.

For normal rows, the detail lookup uses the billing service item ID. For an exceptional historical row without a valid service-item reference, the detail lookup uses the representative invoice-item key returned by the summary API so the original line remains inspectable.

## API compatibility

The Test Performance response contract will be updated from operational counts to billing metrics:

- `ordered` becomes `quantity`
- `completed`, `pending`, and `cancelled` are removed
- financial fields remain
- the row identifier represents a billing service item for normal rows and an explicit historical fallback key for unlinked rows

The frontend types, table, sort controls, details drawer, and tests will be updated together. This is an internal dashboard contract change; no database migration is required.

## Error and fallback behavior

- Missing optional commission data returns zero commission rather than failing the entire report.
- Missing service-item metadata falls back to invoice-line description and `No code`.
- Invalid sort, page size, or unsupported legacy status parameters return a validation error before database execution.
- Financial rows are never discarded solely because no `lab_order_items` row exists.

## Verification

Automated coverage will prove:

1. Billing rows from dates with no lab-order data still appear.
2. Quantity and billed totals come from `invoice_items`.
3. Zero `line_total` safely falls back to unit price times quantity.
4. Collected payment is allocated proportionally and reconciles to the selected-period bill payment.
5. Cancelled/refunded/draft records are excluded.
6. Historical description fallback rows are retained and can open details.
7. The UI renders only Test, Quantity, Billed, Collected, Due, and Test Commission.
8. Details work for billing-only records.
9. Existing dashboard production build and relevant integration tests pass.

## Out of scope

- Reagent expected/actual usage
- Reagent stock deduction or reconciliation
- Backfilling missing historical `lab_orders`
- Changing lab workflow statuses
- Database schema migrations

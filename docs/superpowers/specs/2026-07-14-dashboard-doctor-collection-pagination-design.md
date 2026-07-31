# Dashboard Doctor Collection and Pagination Design

## Problem

The admin dashboard uses `/api/dashboard/doctor-performance`, while the previous collection fix was applied to `/api/reports/daily-collection`. Production therefore still shows doctor-wise visit and test collection as zero or assigns most collection to `Unassigned Doctor`.

Production data also contains legacy commission rows linked to `bill_id` without `lab_order_item_id`. The current dashboard query depends on invoice-item-to-lab-item linkage for test collection attribution, so those legitimate payments cannot be assigned to the correct doctor.

Several dashboard list panels already support server pagination, but their configured page size is 25. The requested presentation is 10 rows per page with persistent previous/next controls.

## Goals

1. Calculate doctor-wise visit and test collection from actual payment rows.
2. Allocate mixed-invoice payments proportionally across active invoice lines.
3. Attribute collections correctly for both modern line-linked data and legacy bill-linked commission data.
4. Keep visit, test, other, and total commission values separate.
5. Show 10 rows per page in doctor, test, income, expense, and reagent dashboard panels.
6. Preserve server-side pagination, sorting, search, tenant isolation, and existing drilldowns.
7. Merge the verified branch into local `main`, push `origin/main`, and deploy production from the merged local `main` state.

## Collection Source of Truth

`payments` is the collection source of truth. Billed amounts are used only as allocation bases and must not be reported as collected amounts when no payment exists in the selected period.

For every payment:

- Load all active invoice lines for the same tenant and bill.
- Determine each line amount from `line_total`, falling back to `unit_price * quantity` when necessary.
- Allocate the payment proportionally by line amount.
- Aggregate allocated visit and test amounts independently.

Legacy bills without usable invoice lines fall back to `doctor_visit_bill` and `test_bill` as proportional allocation bases.

## Doctor Attribution

### Visit collection priority

1. Consultation commission doctor on the same bill.
2. Doctor explicitly referenced by a consultation invoice line.
3. Visit doctor.
4. Referring doctor.
5. Unassigned.

### Test collection priority

1. Referring doctor on the bill.
2. Lab-test or referral commission doctor on the same bill.
3. Visit doctor.
4. Unassigned.

The bill-level commission fallback is required because production legacy commission rows may have `bill_id` but no `lab_order_item_id`.

## Query Architecture

The existing executive doctor analytics module remains the dashboard API implementation. Its SQL CTEs will be extended rather than creating a second calculation path.

The summary and doctor detail queries will share the same payment allocation and doctor-resolution rules so table totals and drilldowns cannot disagree.

All joins remain tenant-scoped. Cancelled, refunded, and draft bills and cancelled invoice or commission rows remain excluded.

## Pagination

The executive analytics backend page-size contract accepts 10, 25, 50, or 100 rows. Existing clients may continue using 25, 50, or 100, while dashboard callers request 10 rows by default.

The following admin and executive dashboard list panels will use page size 10:

- Doctor performance
- Test performance
- Income by service
- Expense analysis
- Reagent reconciliation

Each panel keeps its current server-side previous/next behavior, total-row count, sorting, and search. Pagination controls remain visible whenever rows exist, including a single-page result.

## Testing

Backend integration coverage will include:

- Actual payment allocation for mixed visit/test invoices.
- Visit attribution through consultation commission doctor.
- Test attribution through bill-level lab commission when `lab_order_item_id` is absent.
- Referring-doctor priority for test collection.
- Unassigned fallback.
- Tenant isolation and excluded bill statuses.
- Summary and doctor-detail collection consistency.

Frontend tests will verify:

- Dashboard analytics requests `pageSize=10` for all requested list panels.
- Previous/next controls and page counters continue to work.
- Filter, search, and sort changes reset their relevant page to 1.

## Deployment and Verification

1. Run focused backend and frontend tests.
2. Run backend and frontend TypeScript checks.
3. Run the production build.
4. Review the complete diff.
5. Commit the feature branch.
6. Merge into local `main` without including unrelated generated E2E artifacts.
7. Push local `main` to `origin/main`.
8. Deploy from local `main`.
9. Verify production health and authenticated route mounting, then verify the dashboard using the custom production domain.

No database migration is expected because the change modifies query and UI behavior only.

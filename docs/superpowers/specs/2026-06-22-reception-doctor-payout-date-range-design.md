# Reception Doctor Payout Date Range Design

## Goal

Let reception staff view and pay doctor commission accruals for a selected date range. The Doctor Payout workspace defaults both dates to the current Dhaka calendar day.

## Behavior

- Show `From` and `To` date inputs in the Reception Cash Operations Doctor Payout workspace.
- Default both inputs to today's date in `Asia/Dhaka`.
- Reload payable doctors when either date changes.
- Filter payable accruals by `doctor_commission_accruals.accrued_date`, inclusively.
- Recalculate doctor count, unpaid item count, category totals, and payable totals from the filtered server response.
- Clear selected payout items when the range changes so hidden accruals cannot remain selected.
- Reject an invalid range where `From` is later than `To` and do not request or submit payout data until corrected.

## API

Extend `GET /api/payment-methods/doctor-payouts/payables` with optional `from` and `to` query parameters in `YYYY-MM-DD` format. Apply tenant-scoped inclusive SQL predicates to `a.accrued_date`. Existing callers without these parameters continue to receive all eligible unpaid accruals.

The payout mutation remains unchanged. It already revalidates selected accrual ownership, status, and paid-bill eligibility at execution time.

## UI Data Flow

The Cash Operations page owns the payable query and passes the filtered doctor groups into `DoctorPayoutWorkspace`. Its query key and URL include the selected range. The workspace exposes the two date controls and notifies the page when they change. Range changes clear local item selection before filtered data is used.

## Validation And Errors

- Inputs use native date controls.
- Invalid ranges show a concise inline message.
- API parameters are validated as calendar-date strings; malformed or reversed ranges return HTTP 400.
- Existing loading, empty, and payout error states remain in place.

## Tests

- Route test: `from` and `to` produce inclusive `accrued_date` predicates and bound parameters.
- Route test: reversed date range returns HTTP 400.
- UI test: defaults to today's Dhaka date and requests the range-scoped payable URL.
- UI test: changing the range clears previously selected items.

## Scope

No schema migration, accounting behavior, settlement calculation, or payout posting logic changes are required.

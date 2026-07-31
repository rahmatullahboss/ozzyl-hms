# Cash Control Ledger Blueprint

## Purpose

The admin Cash Control Ledger is the finance control-room for reception cash. It should answer three questions quickly:

1. Where is the cash right now?
2. Why did cash increase or decrease?
3. Which items need admin review before accounts posting/reconciliation?

## Issues found from the current page

- `cash_drawer_movements.created_at` is stored as a local Bangladesh timestamp in older migrations, but the shared UI formatter treats naive timestamps as UTC and converts to Asia/Dhaka. That double-conversion makes drawer movement rows appear six hours later.
- `Cash statement timeline` mixes patient payment rows and drawer movement rows. Drawer movement timestamps need local-naive formatting, while UTC/ISO rows can keep the shared date-time formatter.
- Handover chain displayed zero-amount, no-recipient rows as `User -> Unassigned`. That looked like a real handover even when the user simply started/kept an active counter with no cash transfer.
- Long movement, statement, handover, and expense sections had no pagination controls, making review harder as volume increases.

## Target page structure

### 1. Header and date scope

Keep date, Today/Yesterday quick actions, and refresh at the top. The selected date must drive both the legacy cash-control endpoint and the cash-ledger overview endpoint.

### 2. Simple cash formula

Show the operator-friendly formula:

`Opening cash + cash collection - refunds/expense/cash drop/transfer = current drawer cash`

Also show active expected cash beside the formula so admin can immediately compare summary with live drawer status.

### 3. Review filters

Filters should stay above all sections:

- Counter
- Operator / user
- Movement type
- Missing receipt only
- Variance handovers only

The filter summary should report visible counts versus total reviewable rows. Handover total should exclude zero-cash no-recipient counter-start rows.

### 4. Summary cards

Use four control-room cards:

- Active counter cash
- Pending / in-transit cash
- Admin / bank custody
- Disputed / variance

These cards should distinguish live drawer cash from custody transfer/bank/admin cash.

### 5. Cash increase/decrease explanation

Keep the two explanation panels:

- Why cash increased: bill/due collection, manual cash add
- Why cash decreased: refund, manual cash out, cash drop, handover, approved expense

This gives non-accountant admins a quick reason map.

### 6. Cash statement timeline

This is the ledger-style chronological list. Each row should show:

- Time
- Direction and label
- Reference number
- Reason/detail
- Operator and counter
- Signed amount
- Running/net movement after

Pagination should be used to keep the page fast and readable.

### 7. Live drawer status

Active counters must stay separate from handovers. A counter that is still active should appear here, not as an unassigned handover.

Each card should show:

- Counter name
- Operator
- Location/code
- Expected cash
- Transaction count
- In/out totals

### 8. Cash movement timeline

This is the audit trail for drawer-level events. Each row should show:

- Correct local movement time
- Cash added/removed/drop/handover badge
- Receipt / no receipt badge where relevant
- Reason and reference
- Operator, counter, created-by user
- Amount

Pagination should be visible when more than one page exists.

### 9. Right-side review rail

Keep high-attention admin review sections on the right:

- Attention needed
- Handover chain
- Expense evidence
- Quick actions

### 10. Handover chain rule

Only show real custody events:

- Amount > 0, due > 0, variance != 0, or a selected receiver exists.
- Hide zero-amount, zero-due, zero-variance, no-recipient rows from the chain because those are not actionable handovers.
- If a real pending handover has no receiver, label it `Receiver not selected` instead of `Unassigned`.

### 11. Pagination defaults

- Main timelines: 10 rows per page.
- Side rail sections: 5 rows per page.
- Reset page to 1 when filters or source data change.

## Implementation completed

- Added local-naive drawer movement time formatting to prevent the extra six-hour shift.
- Kept non-drawer statement rows and handover rows on the existing shared formatter.
- Added reviewable-handover filtering so zero-cash no-recipient rows no longer appear as handovers.
- Replaced `Unassigned` with `Receiver not selected` for real pending handovers without a receiver.
- Added pagination controls for statement, cash movement, handover, and expense sections.
- Added tests covering the six-hour timestamp issue, pagination, and zero-cash handover filtering.

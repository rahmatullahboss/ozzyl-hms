# MD Dashboard Implementation Plan

## Goal
Turn the current Managing Director dashboard from a static display page into an owner-level command dashboard that clearly answers:

1. How much cash came in today?
2. How much cash went out today?
3. What bill value, due, discount, deposit, and expense created those numbers?
4. Which items need MD action now?
5. Can every headline number be drilled into with invoice/patient/user/source details?

## Current problems found in review

- Top KPIs are mostly display-only; most cannot be drilled into.
- Cash and revenue story is split across several sections without a clear reconciliation flow.
- `Today's Profit` is potentially misleading because it currently means income minus approved expense, not true net profit.
- Cash movement card does not clearly separate cash in, cash out, net movement, due collection, and patient deposit.
- Income/expense source sections are old-style label + amount lists and are not actionable.
- Alerts are too limited for MD use; they miss discount reference, high discount, voucher, due, posting, and drawer risks.
- Trend section only shows revenue, not due/discount/expense risk trends.
- Staff section takes space but does not show MD-level workforce risks.

## Implementation rules

- Commit after every completed task.
- Keep this file updated with progress after each task.
- Run targeted tests before each implementation commit where relevant.
- Do not deploy until the final task gate is green.
- Do not fake metrics. If the backend cannot support a number yet, show a clear label or route to an existing drilldown.
- Prefer reusing the existing `KpiBreakdownDrawer` and `/api/dashboard/kpi-breakdown` endpoint before creating new APIs.

## Target dashboard structure

### 1. Executive Control Strip
Cards should be clickable where a drilldown exists.

- Cash received
- Bill / income value
- Expense paid
- Income minus approved expense
- Outstanding due
- Discount given
- Pending handover
- Posting queue

### 2. Executive Cash Control
A clear reconciliation section:

| Source | Direction | Meaning | Drilldown |
|---|---|---|---|
| Same-day bill payments | In | Bills created and collected today | Income drawer |
| Due collections | In | Old invoices paid today | Income drawer |
| Patient deposits | In | Advance/deposit received | Patient advance drawer |
| Operating expenses | Out | Approved operating cash-out | Expense drawer |
| Doctor payouts | Out | Doctor payout cash-out | Cash movement drawer |

### 3. Action Required Queue
Data-driven MD risk buckets:

- Missing discount reference
- High discount bills
- Pending handover cash
- Accounting posting queue
- Outstanding patient due
- Canceled bills
- Low stock

### 4. Income and Expense Drilldowns
Replace static source lists with clickable source cards that show:

- source/category name
- amount
- row count where available
- meaning/explanation
- action hint

### 5. Safer financial labels
Rename or clarify:

- `Today's Profit` -> `Income - Approved Expense`
- Add formula note in the card tooltip or section copy.

### 6. Later phase polish

- Mobile card layout for MD drilldown rows
- Export/print from drawer
- Due aging trend
- Discount trend
- Expense voucher risk drilldown
- Staff risk summary instead of raw staff list

## Task checklist

### Task 1 — Planning and progress tracker
Status: Done

Create this implementation plan and commit it before code changes.

### Task 2 — General MD KPI drilldown framework
Status: Done

- Replace `selectedCashKpi` with a generic `selectedKpi` that supports all existing dashboard breakdown metrics.
- Fetch the selected metric on demand.
- Wire top executive KPI cards to the drawer.
- Keep existing cash movement card behavior working.
- Tests: `MDDashboard.test.tsx` and typecheck.

### Task 3 — Executive KPI label and formula clarity
Status: Done

- Rename `Today's Profit` to `Income - Approved Expense`.
- Add tooltip/formula copy so MD understands it is not full net profit.
- Align daily income/expense cards with selected range labels.
- Tests: MD dashboard targeted tests.

### Task 4 — Executive Cash Control section
Status: Done

- Add a dedicated cash-control section near the top.
- Reuse cash movement sources.
- Show cash in, cash out, and net cash movement.
- Make each source card clickable.
- Show explanations for bill payments, due collections, deposits, expenses, and payouts.
- Tests: MD dashboard targeted tests.

### Task 5 — Action Required Queue V1
Status: Done

- Add MD action queue with existing data sources.
- Include pending handover, posting queue, due risk, high discount, canceled bill, low stock.
- Use links or drawer actions where available.
- Tests: MD dashboard targeted tests.

### Task 6 — Income / Expense source sections upgrade
Status: Done

- Replace static lists with clickable cards.
- Link income rows to income drawer.
- Link expense rows to expense drawer.
- Add meaning text and empty states.
- Tests: MD dashboard targeted tests.

### Task 7 — Final review, build, and deploy
Status: Done

- Run frontend typecheck.
- Run MD dashboard tests.
- Run KPI backend integration tests if backend touched.
- Run web build.
- Review UI behavior and commit final progress update.
- Deploy only after green gate.

## Progress log

- 2026-06-25: Created plan and progress tracker.
- 2026-06-25: Task 2 complete — MD KPI drawer framework is now generic; executive finance/risk cards open existing KPI breakdown drawers. Frontend typecheck and MDDashboard tests passed.
- 2026-06-25: Task 3 complete.
- 2026-06-25: Task 4 complete — added executive cash control with cash in, cash out, net movement, source explanations, and clickable transaction cards.
- 2026-06-25: Task 5 complete — added MD review queue for handover, posting, due, discount, bill review, and stock risk items.
- 2026-06-25: Task 6 complete — income and expense source rows are now clickable cards that open matching drilldown drawers.
- 2026-06-25: Task 7 complete — final MD dashboard test and web production build passed.

# Admin Dashboard V2 Blueprint — Practical Hospital Control Desk

## Why this blueprint exists

The current dashboard improvement is still too presentation-heavy and not operational enough. The visible UI must not say things like "Enterprise control room" or force a big hero box. The enterprise quality should be hidden in the information architecture, auditability, drilldowns, pagination, invoice access, and decision workflow.

## Product principle

The dashboard is the hospital owner's daily control desk. It must answer these questions without making the user think:

1. How much cash was received today, from which source, by which counter/user, and against which invoices?
2. How much discount was given, on which bills, who referenced/approved it, and what was the original bill amount?
3. How much due is outstanding, which invoices/patients, and what has aged or needs follow-up?
4. Which actions require approval or investigation now?
5. What changed since yesterday and what looks abnormal?

## UI rule

Remove marketing language from the dashboard. No "Enterprise", no decorative command-center hero. Start with the date/filter row and KPI strip. Enterprise quality must appear through clean data, reliable drilldowns, action buttons, audit trail, and pagination.

## Target layout

### 1. Top utility row

Compact row only:

- Dashboard date picker
- Today / Yesterday / Last 7 days quick filters
- Refresh status: last updated time
- Optional search: invoice, patient, receipt, counter, user

No big header card.

### 2. KPI strip

Cards should be decision cards, not just numbers.

Required KPI cards:

- Cash received
- Expense paid
- Discount given
- Outstanding due
- Refund / cancellation
- Pending approvals
- OPD patients
- IPD admitted

Each financial KPI card must show:

- main total
- comparison vs previous day where possible
- row count
- mini status label: OK / Review / Critical
- click opens drilldown

### 3. Drilldown drawer V2

The drawer is the most important part. It must be built like a transaction review page.

Header:

- Metric title
- date/range
- total amount
- total matching rows from server, not just visible rows
- loaded rows count
- formula/source-of-truth note
- export CSV / print report button later

Toolbar:

- Search within rows
- Filter by source
- Filter by counter/user
- Filter by status
- Page size selector: 25 / 50 / 100
- Prev / Next pagination

Table columns by metric:

Common columns:

- Time
- Invoice no / receipt no
- Patient
- Counter
- User
- Source
- Gross bill
- Discount
- Paid
- Due
- Amount relevant to current KPI
- Status
- Actions

Actions column:

- View invoice button when billId exists
- View receipt button when payment/receipt exists
- View patient button when patientId exists
- Open audit trail when transaction/audit id exists

Do not rely only on row click. A visible "View invoice" button is required.

### 4. Server-side pagination

Remove hard-coded `LIMIT 50` from KPI detail APIs. Replace with:

- `page`
- `pageSize`
- `offset`
- `totalRows`
- `hasNextPage`

Default page size: 50. Maximum page size: 100. UI must clearly show: "Showing 1–50 of 236".

### 5. Discount KPI drilldown V2

Discount is not just a discount amount. It must show the bill context.

Required server fields:

- billId
- invoiceNo
- patientId
- patientName
- patientCode
- grossBillAmount / subtotal
- discountAmount
- discountPercent
- netBillAmount
- paidAmount
- dueAmount
- discountReferenceName
- discountReason
- discountApprovedBy
- discountApprovedAt
- createdBy
- counterName
- serviceNames
- itemCount

Source grouping for discount should be by real reference/approval/referrer names. If missing, show "Missing reference" as an exception, not just dash.

### 6. Cash received drilldown V2

Cash received must show invoice/payment quality, not only amount.

Required fields:

- paymentId
- receiptNo
- billId
- invoiceNo
- patientName/code
- paymentMethod
- collectedAmount
- grossBillAmount
- discountAmount
- netBillAmount
- paidAmount
- dueAmount after payment if available
- counterName
- receivedBy user
- serviceNames/items
- status

### 7. Outstanding due drilldown V2

Due is a receivable collection page.

Required fields:

- invoiceNo
- patientName/code/mobile
- grossBillAmount
- discountAmount
- totalBillAmount
- paidAmount
- dueAmount
- ageInDays
- lastPaymentAt
- follow-up status later
- View invoice button

Default sort: largest due first or oldest due first, with toggle.

### 8. Source summary redesign

The current source rows feel low quality because they are just label + entries + amount. V2 should use compact analytical source cards:

For each source:

- source name
- amount
- percentage of total
- count
- average amount per row
- visual progress bar
- click source card filters table

Examples:

- Lab bills: ৳18,500 · 38% · 19 rows · avg ৳973
- OPD: ৳7,200 · 15% · 36 rows · avg ৳200
- Missing discount reference: ৳2,000 · 4 rows · needs review

### 9. Action required panel V2

Action required should be real queue-based, not generic text.

Buckets:

- Missing discount reference
- High discount without approval
- Due above threshold
- Expense without voucher/photo
- Pending handover/transfer
- Drawer mismatch
- Cancelled/refunded bills requiring review
- Pending doctor payout approval

Each bucket shows count, amount exposure, priority, and a button to open filtered drilldown.

### 10. Invoice modal V2

The invoice modal must be accessible from every drilldown row with billId.

Required tabs:

- Invoice summary
- Items/tests
- Payments
- Discounts/approvals
- Audit trail

At minimum show:

- invoice no
- patient
- created by
- counter
- gross/subtotal
- discount
- net total
- paid
- due
- items table
- payments table

### 11. Implementation phases

#### Phase 1 — Remove wrong UI and fix critical drilldown quality

- Remove enterprise/hero command-center block.
- Date selector becomes first compact row.
- Add explicit `View invoice` action button in drawer.
- Add server-side pagination params to KPI breakdown endpoint.
- Return `totalRows`, `page`, `pageSize`, `hasNextPage`.
- Add gross/discount/paid/due fields to discount, cash received, and due drilldowns.
- Fix discount reference mapping so missing reference is visible as "Missing reference" and real reference name appears when present.
- Update tests.

#### Phase 2 — Source summary and action queue redesign

- Replace low-quality source rows with analytical source cards.
- Clicking a source filters the table.
- Action required panel uses real bucket cards and links to filtered drilldowns.
- Add threshold rules.

#### Phase 3 — Invoice modal V2

- Add explicit Invoice button.
- Modal tabs: summary, items, payments, discount/audit.
- Support receipt and patient links where IDs exist.

#### Phase 4 — Dashboard analytics polish

- Add previous-day comparison.
- Add aging bands for due.
- Add discount rate = discount / gross bill.
- Add export CSV/print for drilldowns.

## Acceptance tests

### Backend

- KPI endpoint honors page/pageSize and returns totalRows.
- KPI endpoint never silently caps details at 50 without telling UI.
- Cash received rows include bill/payment/invoice context.
- Discount rows include gross bill, discount, net, paid, due, reference.
- Due rows include gross, discount, paid, due, invoice, patient.
- Missing discount reference is grouped as "Missing reference".

### Frontend

- Dashboard starts with date/filter row, no enterprise hero text.
- Drilldown shows Showing X–Y of Z.
- Pagination buttons load next page.
- Page size selector works.
- Invoice number is visible.
- Every row with billId shows a View invoice button.
- Discount drilldown shows gross bill, discount, paid, due, and reference.
- Cash received drilldown shows discount/due context.
- Action required cards open filtered drilldowns.

## Non-goals for Phase 1

- Do not redesign every admin module at once.
- Do not add fake metrics without backend source-of-truth.
- Do not use marketing language in product UI.
- Do not deploy until tests/build pass and UI is reviewed.

# Hospital Admin Command Center Blueprint

## Purpose

The admin dashboard should feel like an enterprise hospital command center, not a simple KPI page. Its primary job is to help hospital owners, admins, and MD-level operators answer five questions quickly:

1. Is today's cash safe and reconciled?
2. Is revenue leaking through discounts, cancellations, dues, refunds, or unposted payments?
3. Are patient operations flowing normally across OPD, IPD, lab, pharmacy, OT, and emergency?
4. Which staff/counter/department needs attention right now?
5. What action should the admin take next?

## Design Principles

- Show decisions, not just numbers.
- Every KPI must explain its formula and source of truth.
- Every KPI must have a drilldown that can prove the number.
- Exceptions and risks should be more visible than normal rows.
- Financial data must reconcile from opening cash to expected drawer cash.
- The dashboard must be role-aware: Admin Daily Control and MD Executive View are not the same.
- No translation keys or internal labels may appear in production UI.
- Time must be shown in hospital-local Bangladesh time consistently.
- Every action should be auditable: who, when, counter, reference, invoice, patient, reason.

## Main Dashboard Layout

### 1. Executive Command Strip

A compact top section with high-signal cards.

Required KPI cards:

- Selected-day cash received
- Net collection
- Cash in drawer / expected drawer cash
- Approved operating expense
- Outstanding patient due
- Discount given
- Pending approvals
- OPD patients
- Lab pending reports
- IPD admitted / bed occupancy
- Cash handover pending
- Critical exceptions

Each KPI card should include:

- Current value
- Trend versus yesterday
- Trend versus last 7-day average
- Status badge: Good / Watch / Critical
- Source row count
- Last updated time
- Drilldown action

### 2. Financial Control Center

The financial section must reconcile cash and surface leakage.

Required panels:

- Cash movement equation:
  - Opening cash
  - Cash received
  - Cash out
  - Handover / bank deposit
  - Expected drawer cash
  - Actual drawer cash
  - Difference
- Cash received by source:
  - OPD bills
  - Lab bills
  - IPD bills
  - Pharmacy sales
  - Deposits / advances
  - Other income
- Cash out by source:
  - Approved operating expense
  - Doctor payout
  - Refund
  - Cash handover
  - Bank deposit
- Counter-wise cash position
- User-wise cash position
- Payment method split: cash, bank, bKash/Nagad/card/other

### 3. Exception & Risk Center

This should be the most action-oriented part of the page.

Required exception cards/rows:

- Discount above threshold
- Discount without reference
- Repeated high discount from same reference
- Bill cancelled after payment
- Refund pending approval
- Expense without receipt image
- Cash drawer mismatch
- Counter not closed
- Pending handover older than SLA
- Due bill above threshold
- Backdated transaction
- Report delayed beyond SLA
- Suspicious staff activity

Each exception row should show:

- Severity
- Type
- Amount / count
- Owner user
- Counter / department
- Age
- Linked invoice/patient if available
- Action button: review, approve, reject, investigate

### 4. Patient Flow & Operations

Required operational panels:

- OPD registered today
- OPD waiting now
- Doctor queue delay
- Lab orders pending sample collection
- Lab reports pending verification
- Lab reports delivered
- IPD admitted today
- Current occupied/vacant beds
- Discharge pending
- Emergency active cases
- OT scheduled/completed

### 5. Department Performance

Required panels:

- Revenue by department
- Patient count by department
- Discount by department
- Due by department
- Top services/tests
- Slowest lab/reporting categories
- Doctor-wise revenue and pending payout

### 6. Staff & Counter Accountability

Required panels:

- Counter-wise billing
- Counter-wise cash in/out
- User-wise discount
- User-wise cancellation/refund
- User-wise expense entry
- Active shifts
- Unclosed counters
- Staff activity timeline

## KPI Drilldown Standard

Every KPI drilldown should use the same enterprise pattern.

### Drilldown Header

Show:

- KPI name
- Total value
- Date range
- Compared value versus yesterday / 7-day average
- Source row count
- Last updated time
- Formula / source of truth note

### Drilldown Tabs

Depending on KPI type, support these tabs:

- Summary
- By source
- By counter
- By user
- By department
- By payment method
- By hour
- Exceptions
- Detail rows

### Drilldown Summary Cards

Show contextual mini cards at the top of drawer:

- Total amount/count
- Number of rows
- Top source
- Top counter/user
- Exception count

### Drilldown Table

Common columns:

- Time
- Invoice / receipt / reference
- Patient
- Department / source
- Service/tests/items
- Counter
- User
- Payment method
- Amount
- Status
- Risk / exception
- Action

Row click should open invoice/patient/detail modal.

### Detail Modal

Invoice or transaction detail modal should show:

- Invoice number
- Patient identity
- Bill items/tests/services
- Payment history
- Discount reference and reason
- Approval info
- Counter and user
- Print count
- Cancellation/refund history
- Audit timeline

## KPI-Specific Drilldown Requirements

### Selected-day Cash Received

Formula:
Posted cash payments and cash-equivalent receipts for selected date, excluding cancelled/refunded/draft records.

Drilldown must show:

- Source: OPD, Lab, IPD, Pharmacy, Deposit, Other
- Receipt number
- Invoice number
- Patient
- Service/tests
- Counter
- User
- Payment method
- Amount
- Handover status

### Outstanding Patient Due

Formula:
Current outstanding due balance for active bills, not limited to selected date unless the user explicitly switches to selected-day due created.

Drilldown must show:

- Patient
- Invoice
- Original bill amount
- Paid amount
- Due amount
- Due age
- Department/source
- Responsible counter/user
- Last payment date
- Follow-up status

### Discount Given

Formula:
Approved/applied discount amount for selected date, excluding cancelled/refunded/draft bills.

Drilldown must show:

- Invoice
- Patient
- Gross bill
- Discount amount
- Discount percent
- Reference name
- Reason
- Approved by / entered by
- Threshold status
- Department/source
- Repeated reference count

### Approved Operating Expense

Drilldown must show:

- Expense head
- Amount
- Paid by
- Approved by
- Receipt image status
- Vendor
- Payment method
- Counter/cash drawer
- Created/approved time

### Pending Approvals

Drilldown must show:

- Approval type
- Requested by
- Amount/risk
- Age
- Current approver
- SLA status
- Quick action buttons

### OPD Patients

Drilldown must show:

- Patient
- Visit number
- Doctor
- Queue status
- Waiting time
- Bill status
- Report pending status

### Lab/Diagnostic

Drilldown must show:

- Test name
- Patient
- Order time
- Sample collection status
- Report status
- Technician
- Machine/manual
- Turnaround time
- Delay status

### IPD/Beds

Drilldown must show:

- Patient
- Admission number
- Bed/ward/cabin
- Consultant
- Running bill
- Due risk
- Length of stay
- Discharge status

## Immediate Phase 1 Scope

Phase 1 should improve the existing dashboard without rebuilding every module.

Deliverables:

1. Remove translation keys from visible UI.
2. Rename "View source" to stronger enterprise labels: Drill down / Review source / Investigate.
3. Add human-readable cash movement labels.
4. Add richer KPI card footer metadata: source count, selected range, status badge where available.
5. Improve KPI drawer header with formula/source-of-truth note.
6. Add summary cards inside drawer.
7. Improve table columns and empty states.
8. Enrich cash and discount drilldown rows with invoice, patient, service/tests, counter, user, and status when data is available.
9. Add tests for labels, drawer rendering, row click, and KPI queries.
10. Keep changes small and safe; no production deploy until tests pass and main merge is done.

## Phase 2 Scope

- Add Exception & Risk Center.
- Add cash reconciliation formula panel.
- Add due aging and collection follow-up.
- Add discount reference analytics.
- Add counter/user accountability dashboard.

## Phase 3 Scope

- Add role-specific Admin Daily Control and MD Executive View.
- Add trend charts, hourly charts, department performance charts.
- Add anomaly/risk scoring.
- Add configurable thresholds and SLA rules.

## Testing Standard

Every dashboard change must include:

- Backend integration tests for KPI formulas and drilldown rows.
- Frontend component tests for card/drawer/modal rendering.
- Regression test that no internal translation keys are visible.
- Build verification.
- `pnpm test:integration` should exclude real-db tests; real-db tests remain under `pnpm test:real` with documented prerequisites.

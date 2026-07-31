# Ozzyl HMS — Admin & MD Dashboard Monitoring Guide

> **Planning status — 2026-07-22:** This document remains a historical/current-operation and demo reference. The controlling current-state audit, target design, semantic/API contract, implementation roadmap, and QA gates are indexed at `docs/admin-dashboard/README.md`. The older “demo-ready” verdict below is not implementation acceptance or production-readiness evidence.

**Last updated:** 2026-06-16  
**Audience:** Hospital owners, MD, directors, admin/manager, accounts/cash-control team  
**Purpose:** Explain what each dashboard shows, where the data comes from, and how hospital management can monitor cash, collection, due, expense, handover and profit/loss.

---

## 1. Simple explanation for hospital management

### Admin Panel = Daily Operational Control Room

The Admin Panel is for day-to-day monitoring. The hospital admin/manager can see:

- Today collection
- Today expense
- Outstanding patient due
- Today discount
- OPD/IPD patient movement
- Active cash counters and expected cash
- High discount / canceled bill / handover mismatch alerts
- Payment method breakdown: cash, bKash, Nagad, card, bank, cheque
- Recent audit activity: who created/updated/deleted/approved/rejected something

Use this sentence in demo:

> “This dashboard gives management a live control room. If any counter is open, cash is moving, bills are cancelled, discounts are high, or handover is pending, admin can see it here.”

### MD Panel = Owner / Managing Director View

The MD Panel is for owner-level summary. The MD can see:

- Today income
- Today expense
- Estimated today profit
- Total staff
- Monthly income, expense and profit
- Alerts/exceptions
- 7-day collection trend
- Bed occupancy
- Staff and department-level summary

Use this sentence in demo:

> “This panel is for owners and directors. It shows whether the hospital is collecting money, spending money, creating dues, using beds properly, and moving toward profit or loss.”

---

## 2. Admin dashboard widgets

## 2.1 KPI Summary Cards

### What it shows

| KPI | Meaning | Why it matters |
|---|---|---|
| Today Collection | Cash/digital collection recorded today | Shows how much money came in today. |
| Today Expense | Approved expenses today | Shows how much money went out today. |
| Outstanding Due | Patient unpaid balance | Shows how much receivable is pending. |
| Today Discount | Discount given today | Helps detect unnecessary or unauthorized discount. |
| OPD Patients | OPD patient count today | Shows outpatient volume. |
| IPD Admitted | Today admitted IPD patients | Shows inpatient movement. |

### Data source

Frontend widget: `web/src/pages/admin/widgets/KPISummaryCards.tsx`  
API: `/api/dashboard/stats`

### How to explain

> “At the top, management can instantly see today’s collection, expense, due, discount and patient count. This is the fastest way to know whether today’s hospital operation is healthy.”

---

## 2.2 Action Required Panel

### What it shows

| Alert | Meaning | Management action |
|---|---|---|
| Pending approvals | Items waiting for approval | Approve/reject quickly. |
| High discount bills | Bills with high discount | Check if discount was justified. |
| Canceled bills | Bills cancelled today | Review if cancellation was valid. |
| Handover discrepancies | Cash handover mismatch | Investigate cashier/counter. |
| Low stock alerts | Stock below threshold | Tell pharmacy/store to reorder. |

### Data source

Frontend widget: `web/src/pages/admin/widgets/ActionRequiredPanel.tsx`  
APIs:
- `/api/approvals/counts`
- `/api/dashboard/security-alerts`

### How to explain

> “This section shows only the things that need management attention. If everything is fine, it stays clean. If something risky happens, it comes up here.”

---

## 2.3 Live Cash Drawers

### What it shows

| Field | Meaning |
|---|---|
| Counter name | Which counter is open |
| Operator name | Which employee is using it |
| Expected cash | How much cash should be in the drawer according to the system |
| Active status | Whether the counter is currently open |

### Data source

Frontend widget: `web/src/pages/admin/widgets/LiveCashDrawerWidget.tsx`  
API: `/api/dashboard/active-counters`  
Refresh: about every 30 seconds

### How to explain

> “Every cashier/counter has an expected cash amount. Admin can see which counters are active and how much cash should be there before closing or handover.”

### What it can monitor

- Open counters
- Current cashier/operator
- Expected drawer cash
- Counter handover status through drill-down pages

### Recommended improvement

Add a small **Cash Control Summary** above or below this widget:

- Bill Cash In
- Refund Cash Out
- Manual Cash In
- Manual Cash Out
- Pending Handover
- Variance / Cash Short or Excess
- Net Cash Position

The backend already has `/api/dashboard/cash-control`, so this is mostly a UI improvement.

---

## 2.4 Payment Method Breakdown

### What it shows

| Payment method | Meaning |
|---|---|
| Cash | Cash received at counter |
| bKash/Nagad/Rocket | Mobile financial service collection |
| Card | Card collection |
| Bank transfer | Bank collection |
| Cheque | Cheque collection |

### Data source

Frontend widget: `web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx`  
API: `/api/reports/daily-collection?date=<today>`

### How to explain

> “This tells management how today’s collection is split. If the cashier says cash is low but bKash is high, admin can verify the breakdown here.”

---

## 2.5 Operations Snapshot

### What it shows

| Section | What it monitors |
|---|---|
| OPD Queue | Today’s appointments and completed consultations |
| Diagnostic | Pending and completed tests |
| IPD | Occupied beds, available beds, occupancy percentage |
| Pharmacy | Today pharmacy sales |

### Data source

Frontend widget: `web/src/pages/admin/widgets/OperationsSnapshot.tsx`  
API: `/api/dashboard/stats`

### How to explain

> “This is not only finance. It also shows patient flow, lab flow, bed usage and pharmacy activity.”

---

## 2.6 Audit Feed

### What it shows

Recent system activity:

- Create
- Update
- Delete
- View
- Login
- Approve
- Reject

### Data source

Frontend widget: `web/src/pages/admin/widgets/AuditFeedWidget.tsx`  
API: `/api/audit?limit=8`  
Refresh: about every 30 seconds

### How to explain

> “If someone changes a bill, approves something, deletes something, or logs in, management can see the audit trail. For details, click the full audit page.”

---

## 3. MD dashboard widgets

## 3.1 Today Income / Expense / Profit / Staff

### What it shows

| KPI | Meaning |
|---|---|
| Today’s Income | Today’s income/collection figure |
| Today’s Expenses | Approved expenses today |
| Today’s Profit | Estimated income minus expenses |
| Total Staff | Staff count |

### Data source

Frontend: `web/src/pages/MDDashboard.tsx`  
APIs:
- `/api/dashboard/daily-income`
- `/api/dashboard/daily-expenses`
- `/api/dashboard/monthly-summary`
- `/api/staff`
- `/api/dashboard/stats`

### How to explain

> “This is the owner summary. It tells the MD if today’s hospital operation is financially positive or negative.”

### Important wording

Use **estimated today profit** for daily dashboard figures. Official monthly profit should come from accounting/GL reports.

---

## 3.2 Monthly Summary

### What it shows

- Monthly Income
- Monthly Expense
- Monthly Profit
- Profit margin

### How to explain

> “This helps owners understand the month’s business performance without opening accounting reports every time.”

---

## 3.3 Alerts & Exceptions

### What it shows

- Canceled bills
- Pending handovers
- Low stock

### How to explain

> “MD does not need to monitor every transaction manually. The system highlights exceptions that need attention.”

---

## 3.4 7-Day Trend

### Current label risk

The chart is currently described as a revenue trend, but the backend builds it from income/deposit-style data. For business clarity, the preferred label is:

> **7-Day Collection Trend**

Recommended subtitle:

> “Income / collection by day.”

### Why change label

Hospital owners often distinguish:

- Bill generated = revenue/gross billing
- Payment received = collection
- Expense deducted = profit/loss impact

Using “Collection Trend” avoids confusion.

---

## 3.5 Bed Occupancy

### What it shows

- Total beds
- Occupied beds
- Available beds
- Cleaning / maintenance / reserved
- Occupancy percentage

### How to explain

> “This tells the MD how well the IPD capacity is being used. Low occupancy means unused capacity; high occupancy means capacity pressure.”

---

## 4. Cash and finance monitoring model

## 4.1 What the system can track

| Item | Can monitor? | Notes |
|---|---:|---|
| Cash collection | Yes | From cash/payment transactions. |
| Digital collection | Yes | Through payment method breakdown. |
| Patient due | Yes | Bill total minus paid, excluding cancelled/refunded/draft. |
| Patient advance/deposit | Yes | Deposit minus refund/adjustment. |
| Cash drawer expected balance | Yes | Active counter/session expected cash. |
| Handover pending | Yes | Pending/partial billing handovers. |
| Cash variance | Yes | Closed session variance. |
| Expenses | Yes | Approved expense totals, receipt status in cash-control. |
| Missing expense receipt | Yes | Available in cash-control endpoint. |
| Unclassified cash out | Yes | Available in cash-control endpoint. |
| Pending/failed posting | Yes | Available in cash-control endpoint. |
| Profit/loss | Yes | Daily estimate + monthly GL-based calculation. |

## 4.2 Cash-control endpoint

API: `/api/dashboard/cash-control`

This endpoint is valuable for finance/admin review. It returns:

- Bill Cash In
- Refund Cash Out
- Manual Cash In
- Manual Cash Out
- Cash Drop
- Handover Collected
- Active Expected Cash
- Active Counter Count
- Pending Handover Amount
- Pending Handover Count
- Closed Variance
- Approved Expense Total
- Missing Receipt Count
- Pending Expense Count
- Unclassified Cash Out Count
- Pending/Failed Posting Event Count
- Latest cash movements
- Latest expenses
- Latest handovers

### Recommended demo explanation

> “The system does not only record bills. It follows the cash lifecycle: collection, refund, manual movement, handover, expense evidence and variance.”

---

## 5. Best demo flow for hospital owner

Use this sequence:

1. Login as hospital admin.
2. Open Admin Dashboard.
3. Show Today Collection / Expense / Due / Discount.
4. Show Action Required panel.
5. Show Live Cash Drawer.
6. Open Daily Collection / Cash Drawer detail page.
7. Show Payment Method Breakdown.
8. Show Audit Feed.
9. Login as MD.
10. Show income/expense/profit/staff cards.
11. Show monthly summary.
12. Show 7-day collection trend.
13. Show bed occupancy.
14. Show quick links to accounting, reports, staff and profit/loss.

---

## 6. Recommended dashboard polish before serious sales demo

### High value, low risk

1. Rename “Revenue Trend” to “Collection Trend”.
2. Add “Last updated” timestamp to auto-refresh widgets.
3. Add Admin “Cash Control Summary” card using `/api/dashboard/cash-control`.
4. Make KPI cards clickable to detail pages:
   - Today Collection → Daily Collection Report
   - Outstanding Due → Due Receivables
   - Today Discount → Discount Review
   - Live Cash Drawer → Cash Drawers
   - Pending Handover → Shift Handover
   - Today Expense → Expense Report
   - Profit → Profit & Loss
5. Improve Header user display name/email.

### Medium priority

1. Add export button for daily collection summary.
2. Add cashier-wise collection card on Admin dashboard.
3. Add “cash short/excess” warning badge when variance is non-zero.
4. Add separate “Gross Billing vs Collection” comparison card.

---

## 7. Final dashboard verdict

### Admin Panel

**Verdict:** Strong for hospital demo.  
**Best message:** “Daily control room for operation, cash and exceptions.”  
**Needs polish:** Cash Control Summary card and clearer drill-downs.

### MD Panel

**Verdict:** Good owner-level summary.  
**Best message:** “Owner view for income, expense, profit, utilization and alerts.”  
**Needs polish:** Rename trend labels and clearly separate collection vs profit.

### Overall

The dashboards can help hospital management monitor the important business questions:

- How much money came in today?
- How much cash should be in each drawer?
- Who is responsible for each counter?
- How much due is pending?
- How much discount was given?
- Are there canceled bills or handover mismatches?
- Are beds and departments active?
- Is the hospital profitable this month?

The system is demo-ready for these management conversations.

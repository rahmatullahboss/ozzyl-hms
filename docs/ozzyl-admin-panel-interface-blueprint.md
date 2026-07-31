# Ozzyl HMS — Complete Admin Panel Interface Blueprint

সবচেয়ে গুরুত্বপূর্ণ design principle হবে:

> Admin যেন এক নজরে বুঝতে পারেন কোথায় সমস্যা হচ্ছে, কোথায় approval প্রয়োজন, কোথায় টাকা আটকে আছে এবং কোন user কী পরিবর্তন করেছেন।

এটি owner, admin এবং developer উভয়েই reference document হিসেবে ব্যবহার করতে পারবেন।

---

## ১. Admin Panel-এর প্রধান উদ্দেশ্য

Admin panel মূলত পাঁচটি কাজ করবে:

1. **Monitor:** হাসপাতালের বর্তমান অবস্থা দেখা
2. **Control:** নিয়ম, limit এবং permission নির্ধারণ করা
3. **Approve:** discount, refund, expense, adjustment ইত্যাদি যাচাই করা
4. **Investigate:** গরমিল, suspicious activity এবং audit history দেখা
5. **Report:** দৈনিক, মাসিক ও বিভাগভিত্তিক হিসাব বিশ্লেষণ করা

Receptionist, doctor, pharmacist বা lab operator তাঁদের নিজস্ব interface থেকে কাজ করবেন। Admin panel তাঁদের operational কাজ repeat করবে না। Admin প্রয়োজন হলে record খুলে detail দেখতে পারবেন, approve করতে পারবেন বা corrective action নিতে পারবেন।

---

## ২. Overall Layout Structure

Desktop admin panel-এর layout হবে তিনটি অংশে বিভক্ত।

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Top Bar: Branch │ Date │ Search │ Quick Action │ Notifications │ Profile   │
├──────────────────┬─────────────────────────────────────────────────────────┤
│                  │                                                         │
│ Sidebar          │ Main Content Area                                       │
│ Navigation       │                                                         │
│                  │ Page Header                                             │
│                  │ Filters                                                 │
│                  │ Cards / Charts / Tables                                 │
│                  │                                                         │
└──────────────────┴─────────────────────────────────────────────────────────┘
```

---

## ২.১ Top Bar

Top bar সব page-এ fixed থাকবে।

### Left Side

- Hospital logo
- Branch selector
- Current branch name
- Date range selector
- Global search

### Global Search দিয়ে খুঁজে পাওয়া যাবে

- Patient name
- Patient ID
- Mobile number
- Invoice number
- Appointment ID
- Admission ID
- Lab invoice
- Prescription
- Doctor
- Employee
- Product
- Batch number
- Cash session
- Refund request
- Discount request

### Right Side

- Quick action button
- Pending approval indicator
- Security alert indicator
- Notification bell
- Help icon
- Admin profile
- Logout

### Quick Action Menu

```
Quick Action
├── Create Announcement
├── Open Approval Center
├── Search Invoice
├── View Live Counters
├── Export Daily Report
└── Create Emergency Override
```

---

## ৩. Sidebar Navigation Structure

Sidebar বেশি বড় করা যাবে না। ৯টি primary section থাকবে। প্রতিটি section expand করলে sub-menu দেখা যাবে।

```
Dashboard

Action Center
├── Pending Approvals
├── Alerts & Exceptions
└── Tasks & Follow-ups

Operations Monitor
├── OPD & Appointments
├── Diagnostic & Lab
├── IPD & Bed Management
├── OT & Procedures
├── Pharmacy
├── Emergency
└── Telemedicine

Cash & Finance
├── Live Cash Drawers
├── Shift Handover
├── Daily Collection Report
├── Refunds
├── Discounts
├── Expenses
├── Doctor Commission
├── Due & Receivables
├── Bank Deposits
└── Financial Reports

Inventory & Procurement
├── Stock Overview
├── Low Stock & Expiry
├── Purchase Requests
├── Suppliers
├── Stock Adjustment
└── Inventory Reports

People & Access
├── Users
├── Roles & Permissions
├── Employees
├── Doctors
├── Attendance & Leave
└── Login Sessions

Audit & Security
├── Audit Explorer
├── Financial Activity
├── Patient Record Access
├── Suspicious Activities
├── Export History
└── Login & Device History

Reports & Analytics
├── Executive Overview
├── Revenue Analytics
├── Patient Analytics
├── Department Performance
├── Doctor Performance
├── Inventory Analytics
└── Custom Report Builder

Settings
├── Hospital Profile
├── Branches & Departments
├── Services & Pricing
├── Approval Policies
├── Discount Rules
├── Payment Methods
├── Invoice & Print Settings
├── Notifications
├── SMS Configuration
└── System Preferences
```

---

## ৪. Dashboard — Command Center

Admin login করার পর প্রথমে Dashboard দেখবেন। Dashboard-এর কাজ সব data দেখানো নয়; বরং দ্রুত সিদ্ধান্ত নেওয়ার মতো গুরুত্বপূর্ণ তথ্য দেখানো।

---

### ৪.১ Dashboard Header

```
Good Morning, Admin
Kaliganj Branch ▼ | Today ▼ | Last updated 30 sec ago
```

ডান পাশে:

- Refresh
- Export Summary
- Customize Dashboard
- Full Screen Mode

---

### ৪.২ Dashboard KPI Cards

প্রথম row-তে ৬টি summary card থাকবে।

| Card | Data | Secondary Information |
|------|------|----------------------|
| Total Collection | আজকের মোট collection | গতকালের তুলনায় কত % বেশি বা কম |
| Total Expense | আজকের approved expense | Pending expense কত |
| Outstanding Due | OPD + IPD + corporate due | আজকে নতুন due কত |
| Refund Amount | আজকের approved refund | Pending request count |
| OPD Patients | আজকের OPD visit | Waiting queue |
| IPD Occupancy | ভর্তি রোগী / total bed | Available bed |

Card clickable হবে। ক্লিক করলে সংশ্লিষ্ট detail page খুলবে।

---

### ৪.৩ Action Required Panel

Dashboard-এর সবচেয়ে গুরুত্বপূর্ণ অংশ।

```
Action Required
────────────────────────────────
🔴 2 Cash Shortage Disputes
🟠 7 Discount Reviews Pending
🟠 3 Refund Requests Pending
🟡 5 Expenses Awaiting Approval
🔴 1 Unusual Invoice Cancellation
🟡 8 Low Stock Alerts
```

প্রতিটি item ক্লিক করলে filtered list খুলবে।

Severity অনুযায়ী color:

- **Red:** immediate attention
- **Orange:** approval required
- **Yellow:** warning
- **Blue:** informational

---

### ৪.৪ Live Cash Drawer Widget

| Counter | Staff | Shift | Expected Cash | Status |
|---------|-------|-------|---------------|--------|
| Reception-01 | Karim | Morning | ৳45,000 | Active |
| Reception-02 | Rina | Morning | ৳20,500 | Disputed |
| Diagnostic | Mitu | Morning | ৳18,000 | Active |
| Pharmacy | Hasan | Morning | ৳32,500 | Handover Pending |

Status badge:

- Active
- Handover Pending
- Disputed
- Closed
- Offline

Widget footer:

`[View All Drawers] [Open Handover Queue]`

---

### ৪.৫ Revenue Trend Chart

Chart toggle:

- Today hourly
- Last 7 days
- Last 30 days
- This year

Chart filters:

- All collection
- OPD
- Diagnostic
- Pharmacy
- IPD
- Emergency
- Other

---

### ৪.৬ Payment Method Breakdown

Donut chart:

- Cash
- bKash
- Nagad
- Card
- Bank
- Corporate credit
- Other MFS

Pie-chart-এর পাশে actual amount দেখাতে হবে। শুধু percentage যথেষ্ট নয়।

---

### ৪.৭ Operations Snapshot

চারটি compact widget:

**OPD Queue**

- Total waiting
- Average waiting time
- Doctor delayed
- Completed consultation

**Diagnostic Load**

- Pending sample collection
- Processing
- Report ready
- Delayed test

**IPD Snapshot**

- Admitted
- Available beds
- Discharge pending
- Critical due warning

**Pharmacy Snapshot**

- Today sales
- Low stock
- Near expiry
- Pending purchase request

---

## ৫. Action Center

Admin যেন বিভিন্ন module ঘুরে approval খুঁজতে না হয়। সব pending decision একটি জায়গায় থাকবে।

---

### ৫.১ Pending Approvals Page

Tabs:

```
All | Discount | Refund | Expense | Bill Cancellation |
Stock Adjustment | Doctor Payout | Manual Adjustment
```

Top summary cards:

| Card | Example |
|------|---------|
| Total Pending | 24 |
| High Priority | 3 |
| Older than 24 Hours | 5 |
| Today Approved | 31 |

Table:

| Request ID | Type | Requested By | Department | Amount | Reason | Submitted At | Risk | Status |
|-----------|------|-------------|-----------|--------|--------|-------------|------|--------|

Row click করলে right-side drawer খুলবে।

---

### ৫.২ Approval Detail Drawer

```
┌───────────────────────────────────────────────┐
│ Discount Request #DS-2026-0182                │
│ Status: Pending Review                        │
├───────────────────────────────────────────────┤
│ Invoice: INV-2026-00891                       │
│ Patient: Rahim Uddin                          │
│ Original Amount: ৳5,000                       │
│ Discount: ৳1,000 — 20%                        │
│ Final Amount: ৳4,000                          │
│ Requested By: Karim, Reception-01             │
│ Referred By: Dr. Hasan                        │
│ Reason: Special consideration                 │
│ Date: 10 Jun 2026, 2:14 PM                    │
├───────────────────────────────────────────────┤
│ Supporting Document                          │
│ [View Uploaded Invoice Photo]                 │
│ [View Patient Bill]                           │
├───────────────────────────────────────────────┤
│ Previous Requests by This User                │
│ 3 approved | 1 rejected | ৳4,500 total        │
├───────────────────────────────────────────────┤
│ Admin Note                                    │
│ [________________________________________]    │
├───────────────────────────────────────────────┤
│ [Reject] [Request Clarification] [Approve]    │
└───────────────────────────────────────────────┘
```

---

## ৬. Discount Management System

আপনার বর্তমান system-এ threshold-এর বেশি discount হলে কে refer করেছেন তার নাম লিখতে হয়। এটি রাখতে হবে, তবে আরও structured করা উচিত।

---

### ৬.১ Discount Entry Flow

Billing screen-এ receptionist discount দিলে:

```
Invoice Total: ৳5,000
Discount Type:
  ( ) Percentage
  ( ) Fixed Amount
Discount Value: 20%
Referred By:
  [ Select Existing Doctor / Staff / External Person ]
  [ + Add Manual Reference ]
Reason:
  [_________________________________]
Supporting Document:
  [ Upload Invoice Photo / Prescription / Approval Note ]
[Apply Discount]
```

---

### ৬.২ Discount Rule Levels

Settings থেকে admin limit নির্ধারণ করবেন।

| Level | Example Rule | System Behaviour |
|-------|-------------|------------------|
| Level 1 | 0%–5% | Receptionist নিজে দিতে পারবেন |
| Level 2 | 5%–10% | Reference name বাধ্যতামূলক |
| Level 3 | 10%–20% | Manager PIN প্রয়োজন |
| Level 4 | 20%-এর বেশি | Admin review queue-তে যাবে |
| Special Case | Custom amount | Supporting document প্রয়োজন |

প্রতিটি hospital নিজের মতো configure করতে পারবে।

---

### ৬.৩ Manager PIN Flow

PIN generic shared code হওয়া উচিত নয়। প্রতিটি manager-এর নিজস্ব PIN থাকবে।

```
Discount exceeds receptionist limit
Manager Authorization Required
Manager: [ Select Manager ▼ ]
PIN:     [ •••••• ]
Reason:  [___________________________]
[Authorize Discount]
```

Record-এ save হবে:

- Authorized manager
- PIN authorization time
- Receptionist
- Counter
- Invoice ID
- Discount before and after amount
- Reference person
- Reason
- Uploaded document
- Device
- Branch

---

### ৬.৪ Discount Review Page

Sidebar path: **Cash & Finance → Discounts**

Tabs:

```
Overview | Pending Review | Approved | Rejected |
High Discount | Reference-wise | Staff-wise Analysis
```

**Discount List Table**

| Invoice | Patient | Original Bill | Discount | Discount % | Reference | Requested By | Authorized By | Photo | Status |
|---------|---------|--------------|----------|-----------|-----------|-------------|--------------|-------|--------|

Filters:

- Date
- Branch
- Department
- Receptionist
- Reference person
- Manager
- Discount percentage range
- Amount range
- Has attachment
- Missing attachment
- Status
- High risk only

**Reference-wise Analysis**

Admin দেখতে পারবেন:

| Referred By | Total Discounts | Discount Amount | Patient Count | Average Discount | High Discount Count |
|------------|----------------|----------------|--------------|-----------------|-------------------|

এতে সহজে বোঝা যাবে কোনো doctor, manager বা employee-এর নামে অস্বাভাবিক discount দেওয়া হচ্ছে কি না।

---

## ৭. Invoice Photo and Supporting Document System

আপনার invoice photo upload feature খুব কার্যকর। এটি একটি central document viewer-এর সঙ্গে যুক্ত করুন।

---

### ৭.১ কোন কোন জায়গায় Photo Upload থাকবে

- Discount request
- Refund request
- Bill cancellation
- Expense voucher
- Doctor payout evidence
- Bank deposit slip
- Stock adjustment
- Purchase invoice
- Corporate billing document

---

### ৭.২ Attachment Viewer

প্রতিটি document viewer-এ থাকবে:

```
Uploaded By: Karim
Uploaded At: 10 Jun 2026, 2:15 PM
Related Invoice: INV-2026-00891
Document Type: Discount Supporting Document
File Type: JPG
```

Actions:

- Preview
- Zoom
- Download
- Rotate
- Open related invoice
- View upload history
- Flag unclear document
- Replace document with reason

Document replace করলে পুরনো file মুছে যাবে না। Version history থাকবে।

---

### ৭.৩ Missing Attachment Alert

Rule configure করা যাবে:

- Discount > 20% → Supporting document required
- Refund > ৳2,000 → Supporting document required
- Expense > ৳1,000 → Voucher required
- Manual adjustment → Supporting document mandatory

---

## ৮. Cash & Collections

---

### ৮.১ Live Cash Drawers Page

Sidebar path: **Cash & Finance → Live Cash Drawers**

Top cards:

- Active counters
- Expected cash total
- Pending handover
- Disputed sessions
- Cash awaiting bank deposit

Main table:

| Counter | Drawer | Current User | Opening Float | Cash In | Cash Out | Expected Cash | Last Counted Cash | Variance | Status |
|---------|--------|-------------|--------------|---------|---------|--------------|------------------|---------|--------|

Row click করলে drawer detail page খুলবে।

---

### ৮.২ Drawer Detail Page

Header:

```
Reception-01 / Drawer-A
Assigned to Karim
Shift: 8:00 AM – 4:00 PM
Status: Active
```

Tabs:

```
Summary | Transactions | Handover History |
Refunds | Discounts | Expenses | Notes | Audit Log
```

Summary panel:

- Opening float
- Patient collection
- Refund
- Expense
- Drawer transfer
- Bank deposit
- Expected closing balance

Timeline:

```
08:02 AM  Shift opened                 +৳5,000
08:14 AM  OPD payment INV-001          +৳800
09:01 AM  Diagnostic INV-108           +৳2,200
10:25 AM  Approved refund RF-018       -৳500
12:40 PM  Cash transfer to vault       -৳6,000
```

---

### ৮.৩ Shift Handover Page

Tabs:

```
Pending Acceptance | Disputed | Completed | All Sessions
```

Table:

| Session | Counter | Outgoing Staff | Incoming Staff | Expected Cash | Declared Cash | Received Cash | Variance | Status |
|---------|---------|---------------|---------------|--------------|--------------|--------------|---------|--------|

Handover Detail:

- Shift opening amount
- Total cash received
- Total cash paid out
- Declared cash
- Denomination breakdown
- Incoming count
- Variance
- Notes
- Approval history
- CCTV reference field optional
- Supervisor resolution

---

### ৮.৪ Daily Collection Report Page

Tabs:

```
Summary | Counter-wise | Department-wise |
Payment Method | User-wise | Reconciliation
```

**Counter-wise Table**

| Counter | Opening Float | Collection | Refund | Expense | Transfer | Expected Closing | Actual Closing | Variance |
|---------|--------------|-----------|--------|---------|---------|-----------------|---------------|---------|

Export:

- PDF
- Excel
- Print
- Email report

---

## ৯. Refund Management

Sidebar path: **Cash & Finance → Refunds**

Tabs:

```
Pending | Approved | Rejected | Completed | Flagged
```

Table:

| Refund ID | Invoice | Patient | Amount | Payment Mode | Reason | Requested By | Approved By | Attachment | Status |
|----------|---------|---------|--------|-------------|--------|-------------|------------|-----------|--------|

**Refund Detail Page**

- Original invoice
- Paid services
- Service delivery status
- Requested refund amount
- Reason
- Uploaded photo
- Patient mobile number
- Requested user
- Counter
- Previous patient refund history
- Previous staff refund history
- Admin note
- Approval actions

Actions:

- Approve
- Reject
- Ask for clarification
- Partial approve
- Escalate
- Flag suspicious

Refund approve হলে original invoice edit হবে না। Reversal entry তৈরি হবে।

---

## ১০. Expense Management

Sidebar path: **Cash & Finance → Expenses**

Tabs:

```
Overview | Pending Approval | Approved |
Rejected | Expense Categories | Recurring Expenses
```

Top cards:

- Today expense
- Monthly expense
- Pending approval
- Expense without voucher
- Budget exceeded

Expense table:

| Expense ID | Category | Department | Amount | Requested By | Paid From | Voucher | Approved By | Date | Status |
|-----------|----------|-----------|--------|-------------|----------|---------|------------|------|--------|

Expense categories:

- Cleaning
- Food and refreshment
- Transport
- Emergency purchase
- Maintenance
- Utility
- Office supply
- Medical supply
- Salary advance
- Other

---

## ১১. Doctor Commission and Payout

Sidebar path: **Cash & Finance → Doctor Commission**

Tabs:

```
Overview | Doctor-wise Earnings | Pending Payout |
Paid History | Commission Rules | Adjustments
```

Doctor-wise table:

| Doctor | OPD Visits | Procedure Income | Diagnostic Share | Total Payable | Paid | Balance |
|--------|-----------|-----------------|-----------------|--------------|------|---------|

Doctor detail:

- Date-wise earnings
- Patient list
- Service-wise commission
- Discount impact
- Tax or deduction
- Previous payout
- Payout attachment
- Manual adjustment history

---

## ১২. Due and Receivables

Sidebar path: **Cash & Finance → Due & Receivables**

Tabs:

```
Patient Due | IPD Due | Corporate Due |
Doctor Due | Aging Report | Collection Follow-up
```

Table:

| Patient / Organization | Type | Invoice | Total | Paid | Due | Days Outstanding | Contact | Status |
|----------------------|------|---------|-------|------|-----|-----------------|---------|--------|

Aging group:

- 0–7 days
- 8–30 days
- 31–60 days
- 60+ days

---

## ১৩. Patient Operations Monitor

Admin clinical কাজ করবেন না। Admin queue, delay, workload এবং exceptions monitor করবেন।

---

### ১৩.১ OPD & Appointments

Sidebar path: **Operations Monitor → OPD & Appointments**

Widgets:

- Today appointments
- Checked-in
- Waiting
- Completed
- Cancelled
- No-show
- Average wait time
- Delayed doctors

Table:

| Token | Patient | Doctor | Appointment Time | Check-in | Waiting Time | Status |
|-------|---------|--------|-----------------|---------|-------------|--------|

---

### ১৩.২ Diagnostic & Lab

Sidebar path: **Operations Monitor → Diagnostic & Lab**

Widgets:

- Total tests today
- Sample pending
- Processing
- Report ready
- Delayed reports
- Critical result alerts

Table:

| Test ID | Patient | Test | Department | Sample Status | Report Status | Expected Time | Delay |
|---------|---------|------|-----------|--------------|--------------|--------------|-------|

---

### ১৩.৩ IPD & Bed Management

Sidebar path: **Operations Monitor → IPD & Bed Management**

Views:

```
Bed Map | Patient List | Admission | Discharge Pending |
Due Alerts | Ward Analytics
```

Bed color:

- **Green:** available
- **Blue:** occupied
- **Yellow:** discharge pending
- **Orange:** cleaning
- **Red:** blocked or maintenance

IPD table:

| Bed | Patient | Admission Date | Consultant | Current Bill | Paid | Due | Status |
|-----|---------|---------------|-----------|-------------|------|-----|--------|

---

### ১৩.৪ OT & Procedures

Sidebar path: **Operations Monitor → OT & Procedures**

Views:

- Calendar
- Timeline
- OT room status
- Upcoming surgery
- Completed procedures
- Cancelled procedures

Table:

| Time | OT Room | Patient | Procedure | Surgeon | Anaesthetist | Status |
|------|---------|---------|----------|---------|-------------|--------|

---

### ১৩.৫ Pharmacy Monitor

Sidebar path: **Operations Monitor → Pharmacy**

Widgets:

- Today sales
- Gross margin
- Low stock
- Expiring products
- Pending purchase
- Return amount

---

## ১৪. Inventory & Procurement

---

### ১৪.১ Stock Overview

Tabs:

```
All Stock | Pharmacy | Diagnostic Reagent |
Consumables | Department Stock | Stock Movement
```

Table:

| Item | Category | Current Stock | Reorder Level | Batch | Expiry | Purchase Price | Selling Price | Status |
|------|----------|--------------|--------------|-------|--------|---------------|--------------|--------|

---

### ১৪.২ Low Stock & Expiry

Tabs:

```
Low Stock | Out of Stock | Expire in 30 Days |
Expire in 90 Days | Expired
```

Actions:

- Create purchase request
- Notify storekeeper
- Adjust threshold
- Mark disposed
- Export

---

### ১৪.৩ Purchase Requests

Table:

| Request ID | Department | Requested Items | Amount | Requested By | Supplier | Attachment | Status |
|-----------|-----------|----------------|--------|-------------|---------|-----------|--------|

---

### ১৪.৪ Stock Adjustment

Stock quantity manually পরিবর্তন করা sensitive action।

Mandatory fields:

- Item
- Batch
- Existing quantity
- New quantity
- Difference
- Reason
- Supporting photo
- Requested user
- Approved user

---

## ১৫. People & Access

---

### ১৫.১ Users Page

Table:

| User | Role | Department | Branch | Mobile | Last Login | Status |
|------|------|-----------|--------|--------|-----------|--------|

Actions:

- Create user
- Reset password
- Reset PIN
- Disable account
- Force logout
- View activity
- Assign branch
- Assign counter
- View permission

---

### ১৫.২ Roles & Permissions

Role templates:

- Super Admin
- Hospital Admin
- Branch Manager
- Accounts Manager
- Reception Supervisor
- Receptionist
- Cashier
- Doctor
- Nurse
- Lab Manager
- Lab Technician
- Pharmacist
- Store Manager
- HR Manager
- Auditor
- Read-only Owner View

Permission matrix:

| Module | View | Create | Edit | Approve | Export | Delete / Reverse |
|--------|------|--------|------|---------|--------|-----------------|

Additional control:

- Branch-specific access
- Department-specific access
- Amount-based limit
- Time-based access
- Sensitive action PIN
- Export permission
- Patient record access
- Audit access

---

### ১৫.৩ Login Sessions

Admin দেখতে পারবেন:

| User | Device | IP | Browser | Login Time | Last Active | Branch | Status |
|------|--------|-----|---------|-----------|------------|--------|--------|

Actions:

- Force logout
- Block device
- Mark trusted device
- Investigate user

---

## ১৬. Audit & Security

---

### ১৬.১ Audit Explorer

Sidebar path: **Audit & Security → Audit Explorer**

Filters:

- Date range
- User
- Role
- Branch
- Department
- Counter
- Event type
- Invoice
- Patient
- Amount range
- IP
- Device
- Severity
- Approval status

Table:

| Time | User | Event | Module | Record ID | Before | After | IP | Severity |
|------|------|-------|--------|----------|--------|-------|-----|---------|

Row expand করলে full detail দেখা যাবে।

---

### ১৬.২ Suspicious Activity Page

Rules:

| Rule | Example |
|------|---------|
| High discount frequency | একই receptionist একদিনে বেশি discount দিয়েছেন |
| Unusual reference person | একই reference name-এর নামে অতিরিক্ত discount |
| Refund spike | shift close-এর আগে বেশি refund |
| Repeated cancellation | user বারবার invoice cancel request করছেন |
| Cash shortage | drawer expected balance কম |
| Shared PIN suspicion | একই manager PIN বিভিন্ন counter-এ দ্রুত ব্যবহার |
| Night export | রাতে sensitive report export |
| Stock manipulation | purchase ছাড়াই stock adjustment |
| Patient record bulk access | অস্বাভাবিক patient record view |

Table:

| Alert ID | Risk Level | Rule | User | Related Record | Detected At | Status |
|---------|-----------|------|------|---------------|------------|--------|

Actions:

- Investigate
- Assign reviewer
- Add note
- Resolve
- Escalate
- Suspend user

---

### ১৬.৩ Export History

Export নিজেই sensitive action।

| Time | User | Report | Format | Filters Used | Rows Exported | Device | IP |
|------|------|--------|--------|-------------|--------------|--------|-----|

---

## ১৭. Reports & Analytics

---

### ১৭.১ Executive Overview

Owner বা director-এর জন্য compact report।

- Revenue
- Expense
- Net collection
- Patient growth
- Department income
- Doctor contribution
- Discount
- Refund
- Due
- Bed occupancy
- Pharmacy sales
- Stock loss
- Branch comparison

---

### ১৭.২ Revenue Analytics

Filters:

- Branch
- Department
- Service
- Doctor
- Date range
- Payment mode
- Counter
- Receptionist

Charts:

- Daily revenue trend
- Department-wise revenue
- Payment mode trend
- Discount vs revenue
- Refund trend
- Average invoice value

---

### ১৭.৩ Custom Report Builder

Admin নিজের report তৈরি করতে পারবেন।

```
Choose Module: [ Billing ▼ ]
Choose Columns:
  ☑ Invoice ID
  ☑ Patient
  ☑ Department
  ☑ Total Amount
  ☑ Discount
  ☑ Referred By
  ☑ Created By
  ☑ Payment Mode
Filters:
  Date: 01 Jun – 10 Jun
  Discount: Greater than 10%
  Department: All
[Preview Report] [Export Excel] [Save Template]
```

---

## ১৮. Settings

---

### ১৮.১ Hospital Profile

- Hospital name
- Logo
- Address
- Hotline
- Email
- Website
- Registration number
- Branch information
- Invoice footer
- Terms and conditions

---

### ১৮.২ Branches & Departments

- Add branch
- Add department
- Department head
- Contact
- Counter setup
- Drawer setup
- Opening hours
- Active / inactive

---

### ১৮.৩ Services & Pricing

- OPD consultation
- Diagnostic test
- Procedure
- Bed charge
- Package
- Emergency service
- Pharmacy pricing rule
- Tax and VAT
- Branch-specific price

Price change হলে audit history থাকবে।

---

### ১৮.৪ Approval Policies

Admin policy builder:

```
Action: Discount
Condition: Percentage > 20%
Required Approval: Hospital Admin
Attachment: Mandatory
PIN: Required
Escalation Time: 30 minutes
```

অন্যান্য rule:

- Refund amount threshold
- Expense threshold
- Stock adjustment threshold
- Doctor payout threshold
- Manual balance adjustment
- Bill cancellation
- Report export

---

### ১৮.৫ Discount Rules

Settings:

- Maximum receptionist discount
- Reference required threshold
- PIN required threshold
- Admin review threshold
- Supporting document threshold
- Allowed reference types
- Department-specific rule
- Doctor-specific rule
- Branch-specific rule
- Package discount restriction

---

### ১৮.৬ Invoice & Print Settings

- A4 invoice
- A5 invoice
- POS receipt
- Appointment invoice
- Diagnostic invoice
- IPD invoice
- Pharmacy receipt
- Prescription template
- Logo
- QR code
- Footer text
- Terms
- Signature area
- Uploaded attachment print option

---

## ১৯. Notification System

Notification categories:

- Cash dispute
- Pending approval
- High discount
- Refund request
- Stock low
- Expiry alert
- IPD due
- Critical diagnostic report
- Failed login
- User permission changed
- Report export
- Bank deposit pending

Notification delivery:

- In-app
- SMS
- Email
- Optional mobile push

Escalation example:

```
Discount review pending
    ↓ 30 minutes
Reception Supervisor notified
    ↓ 2 hours
Accounts Manager notified
    ↓ 6 hours
Hospital Admin notified
```

---

## ২০. Common UI Pattern for Every Page

প্রতিটি admin page একই structure অনুসরণ করবে।

```
Page Title
Small description
Breadcrumb
Summary Cards
Filter Bar
  Search | Date | Branch | Department | Status | More Filters
Tabs
Data Table
  Pagination | Column Customize | Export
Right-side Detail Drawer
  History | Attachment | Notes | Actions
```

প্রতিটি table-এ থাকবে:

- Search
- Sort
- Filter
- Column show / hide
- Saved view
- Export
- Print
- Bulk select
- Pagination
- Date range
- Branch filter

---

## ২১. Admin Role অনুযায়ী Interface Variation

সব admin একই sidebar দেখবেন না।

### Super Admin

- সব branch
- configuration
- permission
- audit
- security
- full financial data

### Hospital Admin

- operations
- finance overview
- approval
- reports
- staff monitoring

### Branch Manager

- নিজের branch
- counters
- queue
- stock
- limited finance
- local approval

### Accounts Manager

- collection
- refund
- expense
- payout
- bank deposit
- reconciliation

### Auditor

- read-only access
- audit logs
- export history
- financial trail
- user activity

### Owner View

- dashboard
- reports
- high-risk alerts
- branch comparison
- no operational editing

---

## ২২. Recommended Development Priority

সব page একসঙ্গে polish করার প্রয়োজন নেই।

### Phase 1 — Core Admin Control

1. Dashboard
2. Action Center
3. Discount Management
4. Refund Management
5. Live Cash Drawers
6. Shift Handover
7. Daily Collection Report
8. Invoice Photo Viewer
9. Users and Permissions
10. Audit Explorer
11. Approval Settings

### Phase 2 — Operations Monitoring

1. OPD monitor
2. Diagnostic monitor
3. IPD bed view
4. OT timeline
5. Pharmacy monitor
6. Due and receivables
7. Doctor commission
8. Expense workflow

### Phase 3 — Advanced Oversight

1. Inventory procurement
2. Suspicious activity engine
3. Export history
4. Custom report builder
5. Owner dashboard
6. Branch comparison
7. Notification escalation
8. Advanced analytics

---

## ২৩. Final Sidebar — Recommended Compact Version

```
Dashboard

Action Center
  Pending Approvals
  Alerts & Exceptions
  Tasks

Operations Monitor
  OPD & Appointments
  Diagnostic & Lab
  IPD & Beds
  OT & Procedures
  Pharmacy
  Emergency

Cash & Finance
  Live Cash Drawers
  Shift Handover
  Collection Reports
  Discounts
  Refunds
  Expenses
  Doctor Commission
  Due & Receivables
  Bank Deposits

Inventory
  Stock Overview
  Low Stock & Expiry
  Purchase Requests
  Stock Adjustments

People & Access
  Users
  Roles & Permissions
  Employees
  Doctors
  Login Sessions

Audit & Security
  Audit Explorer
  Financial Activity
  Suspicious Activities
  Export History

Reports & Analytics
  Executive Overview
  Revenue Analytics
  Department Reports
  Doctor Reports
  Custom Report Builder

Settings
  Hospital Profile
  Branches & Departments
  Services & Pricing
  Approval Policies
  Discount Rules
  Payment Methods
  Print Layouts
  Notifications
```

---

## ২৪. Screen Design Priority

কোন screen-গুলো প্রথমে UI design করা উচিত

UI designer-কে প্রথমে এই ১০টি screen design করতে দিন:

1. Dashboard
2. Pending Approvals
3. Discount Approval Detail
4. Discount Analytics
5. Refund Approval Detail
6. Live Cash Drawers
7. Cash Drawer Detail
8. Shift Handover Detail
9. Audit Explorer
10. Approval Policy Settings

এই screen-গুলো design হয়ে গেলে বাকি admin pages একই component system ব্যবহার করে দ্রুত তৈরি করা যাবে।

আপনার discount system-এর জন্য সবচেয়ে গুরুত্বপূর্ণ সংযোজন হবে reference-wise analytics। অর্থাৎ শুধু invoice অনুযায়ী discount history নয়, কোন doctor, staff বা external reference-এর নামে কত discount দেওয়া হয়েছে সেটি আলাদা table এবং chart-এ দেখাতে হবে। এতে misuse সহজে ধরা পড়বে।

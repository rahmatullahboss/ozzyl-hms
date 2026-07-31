নিচে **Ozzyl HMS Admin Panel-এর সম্পূর্ণ Enterprise-ready Full System Blueprint** দিলাম। আপনার আগের core structure—Global Layout, Dashboard, Finance, Clinical Admin, HR, Inventory, Reports, Settings, RBAC, Export, Drill-down Analytics, Mobile Responsiveness—এসবকে base ধরে এটাকে আরও complete admin architecture হিসেবে সাজানো হলো। 

---

# Ozzyl HMS Admin Panel — Full Enterprise Blueprint

## ১. Admin Panel-এর মূল ধারণা

Ozzyl HMS-এর Admin Panel হবে পুরো হাসপাতালের **Control Room**। এখানে মালিক, চেয়ারম্যান, ডিরেক্টর, অ্যাডমিন, ম্যানেজার বা অপারেশন হেড এক জায়গা থেকে পুরো হাসপাতাল মনিটর ও কন্ট্রোল করতে পারবেন।

Admin Panel-এর কাজ শুধু settings বা reports দেখানো না।
এটা হবে:

* Business control system
* Financial monitoring system
* Security monitoring system
* Hospital operation monitoring system
* Approval and audit system
* Multi-branch management system
* Staff, doctor, pharmacy, lab, ward, billing—সব কিছুর central command center

মূল লক্ষ্য:

> মালিক বা অ্যাডমিন যেন এক স্ক্রিন থেকেই বুঝতে পারেন আজ হাসপাতালের আয় কত, খরচ কত, বকেয়া কত, ক্যাশ শর্ট আছে কি না, কোন বিল এডিট হয়েছে, কোন স্টক শেষ হচ্ছে, কোন ডাক্তার কমিশন পাবেন, কোন বেড খালি, কোন রিপোর্ট পেন্ডিং, কোন ইউজার সন্দেহজনক কাজ করেছে।

---

# ২. Admin Panel Design Philosophy

## ২.১ Exception-first Dashboard

Admin Panel-এ সব ডেটা একসাথে ঠেলে দেওয়া যাবে না।
আগে দেখাতে হবে যেগুলো জরুরি:

* Cash short/excess
* Bill edit/cancel alert
* High discount
* Refund request
* Due collection problem
* Low stock
* Near expiry medicine
* Pending lab report
* Pending approval
* Unclosed shift
* Suspicious user activity
* Failed login
* System backup failed

অ্যাডমিন যেন login করেই বুঝতে পারেন:

> “আজ এই ১০টা জিনিস আগে দেখা দরকার।”

---

## ২.২ Owner-friendly UI

হাসপাতালের মালিক অনেক সময় টেকনিক্যাল না। তাই UI হবে:

* পরিষ্কার
* কম clutter
* বড় বড় summary card
* সহজ filter
* mobile-friendly
* বাংলা/ইংরেজি label support
* chart clickable
* report exportable
* alert actionable

---

## ২.৩ Security-first Design

বাংলাদেশের হাসপাতালে সবচেয়ে sensitive জায়গা:

* Billing
* Discount
* Refund
* Due
* Doctor commission
* Pharmacy stock
* Lab report
* IPD bill
* Cash handover
* User permission

তাই Admin Panel-এ approval, audit trail, role permission, activity log, session control এবং data export log খুব শক্ত হতে হবে।

---

## ২.৪ Modular Architecture

Admin Panel-এ সবকিছু এক জায়গায় থাকলেও structure হবে modular।

মানে:

* Admin সব দেখতে ও কন্ট্রোল করতে পারবেন
* কিন্তু daily operation আলাদা module-এ হবে
* Reception বিল করবে
* Doctor prescription দেবেন
* Nurse vitals/MAR করবে
* Pharmacy sale/stock করবে
* Lab report করবে
* Admin monitor, approve, configure, audit করবেন

---

# ৩. Global Layout

## ৩.১ Left Sidebar

Sidebar collapsible হবে।
ডার্ক/ডিপ ব্লু medical professional theme ভালো হবে।

Final sidebar:

1. Dashboard
2. Approvals
3. Patients
4. Reception & Billing
5. Finance & Accounts
6. OPD & Doctor Admin
7. IPD / Ward Admin
8. Lab & Radiology
9. Pharmacy & Inventory
10. HR & Payroll
11. Doctor Commission
12. CRM & Communication
13. Asset & Maintenance
14. Blood Bank
15. Ambulance
16. Reports
17. Master Setup
18. API Integrations
19. System Health & Backup
20. Settings & Security

MVP-তে সব module active না করলেও sidebar architecture এমন রাখা ভালো যেন future expansion সহজ হয়।

---

## ৩.২ Top Navbar

Top bar সবসময় visible থাকবে।

এখানে থাকবে:

### Global Search

Search করা যাবে:

* Patient name
* Patient ID
* Phone number
* Invoice number
* Admission ID
* Bed number
* Doctor name
* Lab report ID
* Medicine name
* Supplier invoice
* Staff name
* Blood donor
* Ambulance trip ID

Search result categorized হবে:

* Patients
* Invoices
* Admissions
* Lab
* Pharmacy
* Doctors
* Staff
* Reports

### Notification Bell

শুধু important alerts আসবে:

* Cash short
* Bill edit request
* Refund request
* High discount
* Low stock
* Near expiry
* Critical lab value
* Pending discharge
* Backup failed
* Failed login
* Doctor commission pending

### Branch Switcher

Multi-branch hospital হলে branch switcher থাকবে:

* Main hospital
* Diagnostic branch
* Pharmacy branch
* Clinic branch
* Collection center

### Date Filter

Dashboard-level date filter:

* Today
* Yesterday
* Last 7 days
* This month
* Custom date

### User Menu

* Profile
* Change password
* Active session
* Login history
* Logout

---

# ৪. Main Dashboard — Admin Control Room

Admin login করলে প্রথমে Dashboard দেখবেন।

Dashboard হবে ৬ ভাগে:

1. Financial Snapshot
2. Operational Snapshot
3. Clinical Snapshot
4. Inventory Snapshot
5. Visual Analytics
6. Security & Alert Center

---

## ৪.১ Financial Snapshot

Top widget row-তে থাকবে:

### Today’s Collection

আজ মোট আয়।

Breakdown:

* Cash
* bKash
* Nagad
* Rocket
* Card
* Bank transfer
* Cheque
* Corporate due

### Today’s Expense

আজকের মোট খরচ।

### Net Cash in Hand

Expected cash calculation:

Total cash collection
– Refund
– Cash expense
– Bank deposit
= Expected cash in hand

### Total Due

Due breakdown:

* OPD due
* IPD due
* Lab due
* Pharmacy due
* Corporate due
* Patient due

### Total Discount

Discount breakdown:

* OPD discount
* Lab discount
* IPD discount
* Pharmacy discount
* Approved discount
* Unapproved discount

### Refund Today

আজ কত টাকা refund হয়েছে।

### Doctor Commission Payable

আজ/এই মাসে doctor commission payable কত।

### Supplier Payable

Supplier-দের কত টাকা বাকি।

### Staff Salary Payable

Salary pending amount.

---

## ৪.২ Operational Snapshot

এখানে hospital operation-এর live status থাকবে।

Cards:

* OPD patients today
* Emergency patients
* New admissions
* Discharges today
* Bed occupancy
* ICU occupancy
* Active doctors
* Active nurses
* Pending lab reports
* Pharmacy sales
* Pending discharge clearance
* Pending shift closing

---

## ৪.৩ Clinical Snapshot

Admin clinical operation বুঝবেন।

Cards:

* Pending doctor consultation
* Pending nurse vitals
* Critical patients
* Abnormal vitals count
* Lab sample pending
* Lab report ready but not delivered
* IPD patients without round note
* Discharge summaries pending
* Doctor orders pending by nurse

---

## ৪.৪ Inventory Snapshot

Cards:

* Low stock items
* Near expiry medicines
* Expired stock
* Pending purchase order
* Supplier due
* Stock adjustment pending
* Pharmacy return pending
* Lab reagent low stock

---

## ৪.৫ Visual Analytics

Dashboard-এর chart section:

### Revenue Trend

* Last 7 days
* Last 30 days
* This month
* Custom date

### Department-wise Income

* OPD
* IPD
* Lab
* Radiology
* Pharmacy
* OT
* Emergency
* Ambulance

### Payment Method Chart

* Cash
* bKash
* Nagad
* Card
* Bank
* Due

### Doctor-wise Revenue

কোন doctor থেকে কত revenue এসেছে।

### Referral Revenue

Referral doctor-wise test/service revenue.

### Bed Occupancy Chart

Ward-wise bed occupancy.

### Pharmacy Sales Trend

Daily pharmacy sales.

সব chart clickable হবে।
যেমন Pharmacy chart-এ click করলে pharmacy sales report খুলবে।

---

## ৪.৬ Security & Alert Center

এই অংশ Admin Panel-এর সবচেয়ে গুরুত্বপূর্ণ অংশ।

Alerts:

* Bill edited
* Bill cancelled
* Paid invoice changed
* High discount
* Refund issued
* Due sale created
* Cash short/excess
* Stock adjustment
* Backdated entry
* Permission changed
* Failed login
* New device login
* Data export
* Backup failed
* Unclosed shift

প্রতিটি alert actionable হবে:

* View details
* Approve
* Reject
* Investigate
* Assign task
* Mark resolved

---

# ৫. Approval Center

এটা Admin Panel-এর core security module।

Sensitive কাজ সরাসরি করা যাবে না। Approval flow থাকবে।

## Approval Types

### Bill Edit Approval

Paid বা printed bill edit করতে approval লাগবে।

Fields:

* Invoice number
* Patient name
* Old amount
* New amount
* Reason
* Requested by
* Approved/rejected by
* Time

### Bill Cancel / Void Approval

Bill delete হবে না।
Void/cancel হবে reason সহ।

### Discount Approval

Rule-based approval:

* ৫০০ টাকা পর্যন্ত receptionist দিতে পারবে
* ৫০০–২০০০ টাকা manager approval
* ২০০০+ টাকা admin approval

### Refund Approval

Refund করার আগে approval।

### Due Bill Approval

Due sale/create করার permission control।

### Stock Adjustment Approval

Stock কমানো/বাড়ানো approval ছাড়া হবে না।

### Purchase Approval

Medicine, reagent, asset purchase approval।

### Supplier Payment Approval

Supplier payment approval.

### Doctor Commission Payout Approval

Doctor commission payment approval.

### Salary Approval

HR salary finalization approval.

### Asset Maintenance Approval

Repair cost বা service cost approval.

---

# ৬. Patients Module

Patient data হলো পুরো HMS-এর foundation।

## ৬.১ Patient Registry

সব patient-এর central list।

Fields:

* Patient ID
* Name
* Phone
* Age/Gender
* Address
* Guardian name
* Blood group
* NID/Birth ID optional
* Last visit
* Total bill
* Total due
* Health ID
* Status

## ৬.২ Patient Profile

এক patient-এর full history:

* OPD visits
* IPD admissions
* Prescriptions
* Lab reports
* Radiology reports
* Pharmacy purchase
* Billing history
* Due history
* Refund history
* Attachments
* Allergies
* Chronic diseases

## ৬.৩ Duplicate Patient Detection

Duplicate detect:

* Same phone
* Similar name
* Same age
* Same guardian
* Same address

## ৬.৪ Patient Merge

Duplicate patient merge করা যাবে।
এটা শুধু authorized admin করতে পারবেন।

## ৬.৫ Health ID Management

Ozzyl Health ID:

* Unique patient ID
* QR code
* Lifetime medical record
* Patient consent
* Future app integration

---

# ৭. Reception & Billing Control

যদিও reception আলাদা operational module, Admin Panel থেকে পুরো billing control থাকবে।

## ৭.১ All Invoices

সব invoice central list।

Filters:

* Date
* Branch
* Department
* Patient
* Doctor
* User
* Payment method
* Status
* Paid/Due/Refund/Cancelled

Invoice status:

* Draft
* Paid
* Partial paid
* Due
* Refunded
* Cancelled/Void
* Edited

## ৭.২ Invoice Detail

Invoice open করলে দেখা যাবে:

* Patient info
* Services
* Tests
* Medicines
* Discount
* VAT/tax if any
* Payment method
* Created by
* Edited by
* Print count
* Audit history

## ৭.৩ Bill Version History

একবার bill save হলে edit history থাকবে।

* Original version
* Edited version
* Old amount
* New amount
* Reason
* Approved by
* Time

## ৭.৪ Void/Cancel Bill

Hard delete করা যাবে না।
Void status থাকবে।

## ৭.৫ Refund Management

Refund voucher, reason, approval, payment method—সব track হবে।

---

# ৮. Finance & Accounts

Finance module হবে মালিকের জন্য সবচেয়ে গুরুত্বপূর্ণ।

## ৮.১ Daily Collection

আজকের collection:

* User-wise
* Counter-wise
* Department-wise
* Payment method-wise

## ৮.২ User-wise Collection

কোন user কত টাকা নিয়েছে।

Columns:

* User
* Counter
* Shift
* Cash
* bKash
* Nagad
* Card
* Bank
* Due
* Refund
* Expense
* Net cash

## ৮.৩ Shift Closing

প্রতিটি shift close হবে।

Flow:

1. User close shift
2. System expected cash দেখাবে
3. User submitted cash দিবে
4. Short/excess calculate হবে
5. Manager approve করবে
6. PDF closing report generate হবে

## ৮.৪ Cash Book

Daily cash movement:

* Opening cash
* Cash collection
* Cash expense
* Refund
* Bank deposit
* Closing cash

## ৮.৫ Bank Book

Bank transaction:

* Bank deposit
* Card settlement
* Online payment
* Supplier payment
* Salary payment

## ৮.৬ Due Collection

Due list:

* Patient due
* IPD due
* Corporate due
* Pharmacy due
* Old due

Features:

* Call note
* Follow-up date
* Partial payment
* Due aging
* SMS reminder

## ৮.৭ Due Aging

Due age:

* 0–7 days
* 8–15 days
* 16–30 days
* 31–60 days
* 60+ days

## ৮.৮ Expenses & Vouchers

Expense entry:

* Category
* Amount
* Payment method
* Voucher no
* Attachment
* Approved by
* Created by

## ৮.৯ Profit & Loss

Monthly P&L:

* Total income
* Total expense
* Gross profit
* Doctor commission
* Salary
* Supplier payment
* Maintenance cost
* Net profit

## ৮.১০ Corporate Billing

যদি corporate client থাকে:

* Company profile
* Employee patient
* Credit limit
* Monthly bill
* Payment receive
* Corporate due
* Agreement terms

---

# ৯. OPD & Doctor Admin

Doctor operation configure হবে এখানে।

## ৯.১ Doctor Setup

Fields:

* Name
* Department
* Degree
* Designation
* Phone
* BMDC no, optional
* Consultation fee
* Follow-up fee
* Report show fee
* Commission rule
* Schedule
* Status

## ৯.২ Doctor Schedule

* Day-wise chamber
* Time slot
* Room
* Max patient
* Online appointment limit
* Break time
* Off day

## ৯.৩ Chamber Setup

* Room number
* Department
* Doctor assignment
* Token display

## ৯.৪ Serial/Token Setup

* Auto token
* Manual token
* Doctor-wise serial
* Department-wise serial
* Emergency priority
* Follow-up token
* Report show token

## ৯.৫ Visit Fee Setup

* New visit
* Follow-up
* Report show
* Emergency
* Free visit rule

## ৯.৬ Follow-up Validity

Example:

* ৭ দিনের মধ্যে follow-up
* ১৫ দিনের মধ্যে report show
* এরপর new visit fee

## ৯.৭ Doctor Panel Control

Admin configure করবেন:

* Doctor can see financial data or not
* Doctor can view own patient only or all
* Doctor can edit prescription after print or not
* Doctor template sharing permission

---

# ১০. IPD / Ward Admin

IPD hospital-এর বড় revenue area। এখানে strong setup দরকার।

## ১০.১ Ward & Bed Manager

Structure:

* Category
* Ward
* Room
* Bed
* Bed type
* Rate
* Status

Example:

Category: Cabin
Room: 301
Bed: 301-A
Rate: 2500/day

## ১০.২ Bed Status

* Available
* Occupied
* Reserved
* Cleaning
* Maintenance
* Blocked

## ১০.৩ Admission Setup

* Admission fee
* Initial deposit
* Emergency admission
* Required documents
* Guardian info
* Consent form

## ১০.৪ Bed Rent Rules

* Daily
* Hourly
* Half day
* Grace period
* Checkout time rule

## ১০.৫ IPD Service Pricing

* Doctor visit
* Nurse charge
* Oxygen
* Dressing
* Injection
* Procedure
* OT charge
* Ambulance
* Service charge

## ১০.৬ Bed Transfer

Transfer rule:

* Old bed
* New bed
* Transfer time
* Rate change
* Billing auto calculation

## ১০.৭ Discharge Clearance

Discharge flow:

* Doctor discharge order
* Nurse clearance
* Pharmacy clearance
* Lab clearance
* Accounts clearance
* Final bill
* Discharge summary
* Patient release

## ১০.৮ IPD Package

Package setup:

* Normal delivery package
* Surgery package
* Cabin package
* ICU package
* Diagnostic package

---

# ১১. Lab & Radiology Admin

Lab module-এর admin setup।

## ১১.১ Test Category

* Hematology
* Biochemistry
* Microbiology
* Serology
* Radiology
* USG
* ECG
* CT/MRI

## ১১.২ Test Pricing

Fields:

* Test name
* Category
* Price
* Sample type
* Report delivery time
* Commission allowed
* Discount allowed

## ১১.৩ Report Template

Test-wise template:

* Unit
* Reference range
* Result field
* Method
* Interpretation
* Signature

## ১১.৪ Reference Range

Age/gender-based range:

* Male
* Female
* Child
* Adult
* Critical value

## ১১.৫ Sample Workflow

* Ordered
* Paid
* Sample pending
* Collected
* Received
* Processing
* Report entry
* Verified
* Delivered

## ১১.৬ Lab Machine Integration Ready

Future setup:

* Machine name
* Test code mapping
* Result import
* Connection status
* Error log

## ১১.৭ Lab Reports

* Pending sample
* Pending report
* Delivered report
* Department income
* Technician-wise report
* Lab TAT report

---

# ১২. Pharmacy & Inventory

Pharmacy module admin control।

## ১২.১ Item / Medicine Master

Fields:

* Brand name
* Generic name
* Strength
* Dosage form
* Manufacturer
* Purchase price
* Sale price
* MRP
* Reorder level
* Unit
* Category

## ১২.২ Batch-wise Stock

* Batch no
* Expiry date
* Quantity
* Purchase price
* Sale price
* Supplier
* Purchase date

## ১২.৩ Supplier Management

* Supplier name
* Representative
* Phone
* Address
* Due balance
* Payment history

## ১২.৪ Purchase Order

* PO create
* Approval
* Supplier
* Items
* Expected date
* Status

## ১২.৫ GRN / Purchase Receive

* Supplier invoice
* Batch
* Expiry
* Quantity
* Price
* Discount
* Stock update

## ১২.৬ Stock Ledger

Every movement:

* Opening
* Purchase
* Sale
* Return
* Adjustment
* Damage
* Expiry
* Closing

## ১২.৭ Stock Adjustment

Reason required:

* Damage
* Expired
* Lost
* Physical mismatch
* Manual correction

Approval ছাড়া final হবে না।

## ১২.৮ Alerts

* Low stock
* Near expiry
* Expired
* Negative stock
* Fast moving item
* Slow moving item

## ১২.৯ Ward Stock

Nurse/ward stock control:

* Ward requisition
* Issue
* Receive
* Use
* Return

---

# ১৩. HR & Payroll

## ১৩.১ Staff Directory

* Name
* Role
* Department
* Phone
* Address
* Joining date
* Salary
* Documents
* Status

## ১৩.২ Attendance

* Manual
* Biometric ready
* Late
* Absent
* Overtime
* Leave

## ১৩.৩ Duty Roster

* Nurse roster
* Doctor roster
* Reception roster
* Technician roster
* Ward duty

## ১৩.৪ Leave Management

* Leave request
* Approval
* Leave balance

## ১৩.৫ Salary

* Basic salary
* Attendance
* Overtime
* Deduction
* Advance
* Bonus
* Net salary
* Payslip

## ১৩.৬ Staff Performance

* Task completion
* Attendance
* Late count
* Patient feedback
* Error/incident log

---

# ১৪. Doctor Commission

বাংলাদেশের জন্য আলাদা powerful module হওয়া উচিত।

## ১৪.১ Commission Setup

Rule types:

* Doctor-wise
* Test-wise
* Department-wise
* Package-wise
* Percentage
* Fixed amount
* No commission item
* Referral doctor
* Consultant doctor

## ১৪.২ Commission Calculation

Auto calculate from invoice.

Fields:

* Patient
* Invoice
* Test/service
* Amount
* Commission rate
* Commission amount
* Status

## ১৪.৩ Commission Statement

Doctor-wise monthly statement:

* Total patient
* Total service amount
* Commission payable
* Paid
* Unpaid
* Hold

## ১৪.৪ Commission Payment

* Payment voucher
* Approval
* Paid by
* Payment method
* Date

## ১৪.৫ Commission Audit

Commission edit হলে log থাকবে।

---

# ১৫. CRM & Communication

এটা Phase-2 হলেও architecture-এ রাখা উচিত।

## ১৫.১ SMS Panel

SMS integration:

* Welcome SMS
* Appointment confirmation
* Lab report ready
* Due reminder
* Follow-up reminder
* Discharge feedback
* Birthday/health campaign

Admin control:

* SMS gateway setting
* SMS balance
* SMS template
* Sent log
* Failed SMS log

## ১৫.২ Patient Feedback

Feedback channels:

* SMS link
* QR code
* Patient app
* Manual call center entry

Feedback dashboard:

* Rating
* Comment
* Department
* Doctor
* Nurse
* Cleanliness
* Billing experience
* Complaint status

## ১৫.৩ Complaint Management

* Complaint received
* Assigned to
* Priority
* Action taken
* Resolved
* Follow-up

## ১৫.৪ Patient Campaign

* Diabetes camp
* Health checkup offer
* Vaccine reminder
* Follow-up campaign

---

# ১৬. Asset & Maintenance

Enterprise hospital-এর জন্য জরুরি।

## ১৬.১ Asset Register

Assets:

* AC
* Generator
* X-ray machine
* USG machine
* ICU monitor
* Oxygen cylinder
* Bed
* Computer
* Printer
* Lab machine
* Ambulance equipment

Fields:

* Asset ID
* Name
* Serial number
* Purchase date
* Warranty
* Location
* Responsible person
* Status

## ১৬.২ Maintenance Schedule

* Service date
* Next service date
* Vendor
* Cost
* Remarks

## ১৬.৩ Breakdown Ticket

Nurse/staff request করবে:

* AC not working
* Light problem
* Bed broken
* Monitor problem
* Printer problem

Status:

* Open
* Assigned
* In progress
* Completed
* Cancelled

## ১৬.৪ Maintenance Cost Report

কোন asset-এ কত খরচ হচ্ছে।

---

# ১৭. Blood Bank

যদি hospital blood bank চালায়, এই module রাখা যাবে।

## ১৭.১ Blood Inventory

* Blood group
* Bag number
* Collection date
* Expiry date
* Donor
* Screening status
* Available/reserved/issued

## ১৭.২ Donor Database

* Donor name
* Blood group
* Phone
* Last donation date
* Eligibility
* Address

## ১৭.৩ Blood Issue

* Patient
* Doctor order
* Blood group
* Crossmatch
* Issued by
* Used/returned

## ১৭.৪ Blood Alerts

* Low blood stock
* Expiring soon
* Rare blood group needed

---

# ১৮. Ambulance Management

## ১৮.১ Ambulance Register

* Vehicle number
* Driver
* Type
* Status
* Fuel type
* Documents
* Fitness/renewal date

## ১৮.২ Trip Management

* Patient
* Pickup location
* Destination
* Distance
* Fare
* Driver
* Start time
* End time
* Payment status

## ১৮.৩ Fuel & Maintenance

* Fuel cost
* Repair cost
* Driver allowance
* Trip profit

## ১৮.৪ Ambulance Billing

Trip bill auto finance module-এ যাবে।

---

# ১৯. Reports — The Goldmine

Reports হবে Admin Panel-এর সবচেয়ে বেশি ব্যবহৃত অংশ।

প্রতিটি report-এ থাকবে:

* Date filter
* Branch filter
* Department filter
* User filter
* Status filter
* PDF export
* Excel export
* Print
* Permission control
* Export log

## ১৯.১ Financial Reports

* Daily collection
* Monthly collection
* User-wise collection
* Counter-wise collection
* Payment method summary
* Cash book
* Bank book
* Due report
* Due aging
* Discount report
* Refund report
* Cancel bill report
* Edited bill report
* Profit & loss
* Expense report
* Voucher report

## ১৯.২ OPD Reports

* OPD patient count
* Doctor-wise patient
* Visit type report
* Follow-up report
* Report show report
* OPD collection

## ১৯.৩ IPD Reports

* Admission report
* Discharge report
* Bed occupancy
* Bed transfer
* IPD due
* IPD collection
* Discharge pending
* Ward-wise patient

## ১৯.৪ Lab Reports

* Test sales
* Category-wise income
* Pending sample
* Pending report
* Delivered report
* Technician-wise report
* Lab TAT
* Machine error log

## ১৯.৫ Pharmacy Reports

* Daily sales
* Item-wise sales
* Batch-wise stock
* Low stock
* Near expiry
* Expired stock
* Purchase report
* Supplier due
* Stock valuation
* Return report

## ১৯.৬ Doctor Reports

* Doctor-wise revenue
* Doctor referral
* Doctor commission
* Paid/unpaid commission
* Doctor schedule
* Doctor patient count

## ১৯.৭ HR Reports

* Attendance
* Salary
* Leave
* Overtime
* Staff performance
* Duty roster

## ১৯.৮ Security Reports

* Audit trail
* Login history
* Failed login
* Permission change
* Bill edit log
* Bill cancel log
* Export log
* Active session log

## ১৯.৯ Enterprise Reports

* Asset maintenance
* SMS log
* Feedback report
* Ambulance trip
* Blood inventory
* System backup log

---

# ২০. Master Setup

Master Setup আলাদা module রাখা জরুরি।

## ২০.১ Hospital Identity

* Hospital name
* Logo
* Address
* Phone
* Email
* Website
* License info
* Invoice header/footer

## ২০.২ Branch Setup

* Branch name
* Address
* Contact
* Invoice prefix
* Admin user

## ২০.৩ Department Setup

* OPD
* IPD
* Lab
* Pharmacy
* Emergency
* Radiology
* OT
* Accounts

## ২০.৪ Service Setup

* Service name
* Department
* Price
* Commission allowed
* Discount allowed
* Bill category

## ২০.৫ Payment Method Setup

* Cash
* bKash
* Nagad
* Rocket
* Card
* Bank
* Cheque
* Corporate due

## ২০.৬ Invoice Numbering

Branch-wise format:

* OPD-00001
* LAB-00001
* IPD-00001
* PH-00001

## ২০.৭ Print Template

* Invoice
* Money receipt
* Lab report
* Prescription
* Discharge summary
* Salary slip
* Commission statement
* Certificate

## ২০.৮ SMS Template

* Appointment
* Admission
* Lab ready
* Due reminder
* Follow-up
* Discharge feedback

## ২০.৯ QR/Barcode Setup

* Patient QR
* Invoice QR
* Lab sample barcode
* Medicine barcode
* Asset barcode

---

# ২১. API Integrations

Advanced but future-ready module।

## ২১.১ Payment Gateway

Admin securely configure করবেন:

* SSLCommerz
* bKash
* Nagad
* Card gateway
* Bank API

Fields encrypted থাকবে।

## ২১.২ SMS Gateway

* Provider
* API key
* Sender ID
* Balance
* Delivery report

## ২১.৩ Lab Machine Integration

* Machine name
* Connection status
* Test mapping
* Result import
* Error log
* Last sync

## ২১.৪ Accounting Integration

Future:

* Tally
* QuickBooks
* Xero
* Custom API

## ২১.৫ Patient App / Portal API

* Patient login
* Report download
* Appointment
* Payment
* Feedback

## ২১.৬ External Backup Storage

* Google Drive
* S3-compatible storage
* Cloudflare R2
* Local download

---

# ২২. System Health & Backup

Hospital owner-দের জন্য data safety খুব গুরুত্বপূর্ণ।

## ২২.১ Backup Dashboard

দেখাবে:

* Last backup time
* Backup status
* Backup size
* Backup location
* Failed backup alert
* Next backup schedule

## ২২.২ One-click Backup

Admin এক click-এ backup নিতে পারবেন।

Options:

* Database backup
* Files backup
* Reports export
* Full system backup

## ২২.৩ Scheduled Backup

* Daily
* Weekly
* Monthly
* Cloud backup
* Local backup

## ২২.৪ Restore Request

Restore sensitive, তাই approval লাগবে।

## ২২.৫ System Health

* Server status
* Database status
* Storage usage
* API status
* Queue status
* Email/SMS status
* Payment gateway status
* Lab machine status

## ২২.৬ Active Sessions

বর্তমানে কে login আছে:

* User
* Role
* Device
* IP
* Login time
* Last activity

Action:

* Force logout
* Block user
* Reset password

---

# ২৩. Settings & Security

## ২৩.১ Role Management

Roles:

* Super Admin
* Owner
* Director
* Manager
* Accountant
* Receptionist
* Doctor
* Nurse
* Pharmacist
* Lab Technician
* HR
* Inventory Manager
* Maintenance Staff

## ২৩.২ Permission Grid

শুধু View/Create/Edit/Delete যথেষ্ট না।

Permission list:

* View
* Create
* Edit
* Delete/Void
* Print
* Export
* Approve
* Refund
* Discount
* Cancel bill
* Edit paid invoice
* Backdate entry
* Change price
* Change bed rate
* View financial report
* View salary
* View doctor commission
* Stock adjustment
* Data backup
* User management
* Audit log access
* Force logout

## ২৩.৩ Audit Trail

Audit log immutable হবে।

Track:

* User
* Role
* Action
* Module
* Old value
* New value
* Time
* IP
* Device
* Reason
* Approved by

## ২৩.৪ Login Security

* Strong password
* Failed login lock
* Two-factor optional
* New device alert
* Session timeout
* Password reset log

## ২৩.৫ Data Export Security

Export করলে log হবে:

* কে export করেছে
* কোন report
* কোন date range
* কোন format
* কখন

## ২৩.৬ Data Privacy Control

* Patient data access control
* Sensitive field masking
* Role-based data view
* Consent-ready data sharing
* Export restriction

---

# ২৪. Important Workflows

## ২৪.১ Bill Edit Workflow

1. User edit request করবে
2. Reason লিখবে
3. Admin notification পাবে
4. Admin old/new compare করবে
5. Approve/reject করবে
6. Audit trail save হবে

## ২৪.২ Bill Cancel Workflow

1. Cancel request
2. Reason
3. Approval
4. Invoice status cancelled
5. Original bill preserved
6. Audit log

## ২৪.৩ Discount Workflow

1. User discount দিবে
2. Limit check হবে
3. Limit বেশি হলে approval
4. Approved হলে invoice final
5. Report-এ যাবে

## ২৪.৪ Refund Workflow

1. Refund request
2. Invoice verify
3. Reason
4. Approval
5. Payment method
6. Voucher print
7. Finance update

## ২৪.৫ Shift Closing Workflow

1. User shift close
2. Expected cash
3. Submitted cash
4. Short/excess
5. Manager approval
6. Closing report

## ২৪.৬ Purchase Workflow

1. Purchase request
2. Approval
3. Purchase order
4. Goods receive
5. Batch/expiry entry
6. Supplier due
7. Stock update

## ২৪.৭ Discharge Workflow

1. Doctor discharge order
2. Nurse clearance
3. Pharmacy clearance
4. Lab clearance
5. Accounts final bill
6. Due/refund settlement
7. Discharge summary
8. Patient release

## ২৪.৮ Maintenance Workflow

1. Staff issue report
2. Ticket create
3. Maintenance assign
4. Cost entry
5. Complete
6. Asset history update

---

# ২৫. UI/UX Rules

## ২৫.১ Every Table Common Features

* Search
* Filter
* Sort
* Date range
* Column hide/show
* Status badge
* Bulk action
* PDF export
* Excel export
* Print
* Permission control

## ২৫.২ Drill-down Everywhere

Dashboard card click করলে detail page খুলবে।

Example:

* Total due → Due invoice list
* Low stock → Low stock items
* Doctor commission → Commission statement
* Pending approval → Approval center

## ২৫.৩ Mobile Owner Dashboard

Mobile-এ শুধু জরুরি info:

* Today collection
* Expense
* Net cash
* Due
* Discount
* Bed status
* Pending approval
* Alerts
* User-wise collection
* P&L summary

## ২৫.৪ Color + Text Badge

শুধু color না, text badge থাকবে।

* Red + Critical
* Yellow + Pending
* Green + Paid
* Blue + Processing
* Grey + Closed

## ২৫.৫ Fast Filters

প্রতিটি report-এ:

* Today
* Yesterday
* This week
* This month
* Custom
* Branch
* User
* Department
* Payment method

---

# ২৬. Final Development Phases

## Phase 1 — Core Admin MVP

প্রথম release-এ এগুলো বানান:

* Dashboard
* Finance summary
* All invoices
* User-wise collection
* Due collection
* Expenses
* Shift closing
* Role permission
* Audit trail
* Reports
* Master setup
* Bed/ward setup
* Service/test pricing
* Doctor setup
* Basic inventory alert

## Phase 2 — Control & Security

* Approval center
* Bill edit/cancel workflow
* Refund workflow
* Discount approval
* Doctor commission
* Stock adjustment approval
* Patient registry
* Duplicate patient merge
* Advanced reports
* Active sessions
* Backup dashboard

## Phase 3 — Enterprise Operations

* CRM/SMS
* Patient feedback
* Asset maintenance
* Blood bank
* Ambulance
* Corporate billing
* Lab machine integration
* Payment gateway
* Nurse workload
* Staff performance

## Phase 4 — Advanced Intelligence

* AI alert summary
* Predictive low stock
* Revenue forecast
* Due collection risk score
* Suspicious activity detection
* AI-generated owner daily summary
* Multi-branch analytics
* Patient app integration

---

# ২৭. Final Admin Panel Menu Blueprint

সবকিছু মিলিয়ে final sidebar/menu:

## Dashboard

* Owner Dashboard
* Finance Dashboard
* Operation Dashboard
* Clinical Dashboard
* Inventory Dashboard
* Alert Center

## Approvals

* Bill Edit
* Bill Cancel
* Discount
* Refund
* Due Sale
* Stock Adjustment
* Purchase
* Supplier Payment
* Salary
* Doctor Commission

## Patients

* Patient Registry
* Patient Profile
* Duplicate Merge
* Health ID
* Patient Attachments

## Reception & Billing

* All Invoices
* OPD Billing
* IPD Billing
* Lab Billing
* Pharmacy Billing
* Refunds
* Discounts
* Due Bills
* Bill History

## Finance & Accounts

* Daily Collection
* User-wise Collection
* Shift Closing
* Cash Book
* Bank Book
* Expenses
* Vouchers
* Due Collection
* P&L
* Corporate Billing

## OPD & Doctor Admin

* Doctor Setup
* Doctor Schedule
* Chamber Setup
* Token Setup
* Visit Fee
* Follow-up Rule

## IPD / Ward Admin

* Ward Setup
* Bed Manager
* Admission Setup
* Bed Transfer
* IPD Service Pricing
* Discharge Clearance
* IPD Packages

## Lab & Radiology

* Test Setup
* Pricing
* Report Template
* Reference Range
* Sample Workflow
* Machine Integration

## Pharmacy & Inventory

* Item Master
* Suppliers
* Purchase Order
* GRN
* Stock Ledger
* Stock Adjustment
* Expiry Alert
* Ward Stock

## HR & Payroll

* Staff Directory
* Attendance
* Duty Roster
* Leave
* Salary
* Staff Performance

## Doctor Commission

* Commission Setup
* Commission Calculation
* Commission Statement
* Payment
* Audit

## CRM & Communication

* SMS Panel
* SMS Templates
* Patient Feedback
* Complaint Management
* Campaigns

## Asset & Maintenance

* Asset Register
* Maintenance Schedule
* Breakdown Ticket
* Maintenance Cost

## Blood Bank

* Blood Inventory
* Donor Database
* Blood Issue
* Blood Alerts

## Ambulance

* Ambulance List
* Trip Management
* Fuel Cost
* Ambulance Billing

## Reports

* Financial
* OPD
* IPD
* Lab
* Pharmacy
* Doctor
* HR
* Security
* Asset
* CRM
* Ambulance
* Blood Bank

## Master Setup

* Hospital Identity
* Branch
* Department
* Service
* Payment Method
* Invoice Numbering
* Print Template
* SMS Template
* QR/Barcode

## API Integrations

* Payment Gateway
* SMS Gateway
* Lab Machine
* Accounting
* Patient App
* Backup Storage

## System Health & Backup

* System Status
* Backup
* Restore
* Active Sessions
* Server Health
* API Health

## Settings & Security

* Role Management
* Permission Grid
* Audit Trail
* Login History
* Password Policy
* Data Export Log
* Privacy Control

---

# ২৮. Final Summary

Ozzyl HMS Admin Panel এমনভাবে বানাতে হবে যেন এটি শুধু admin settings না হয়ে পুরো হাসপাতালের **Business + Clinical + Finance + Security Control Center** হয়।

Core level-এ থাকবে:

* Dashboard
* Finance
* Billing
* Reports
* Role permission
* Audit trail
* Bed/ward
* Test/service pricing
* Doctor commission
* Inventory alert

Production level-এ যোগ হবে:

* Approval center
* Bill version history
* Shift closing
* Refund/discount control
* Patient registry
* Advanced inventory
* IPD discharge clearance
* Lab workflow
* Pharmacy stock ledger

Enterprise level-এ যোগ হবে:

* CRM/SMS
* Patient feedback
* Asset maintenance
* Blood bank
* Ambulance
* System health
* Backup
* API integration
* Multi-branch analytics
* AI alert summary

সবচেয়ে গুরুত্বপূর্ণ rules:

* Bill hard delete হবে না, void/cancel হবে
* Sensitive action approval ছাড়া হবে না
* Audit trail edit/delete করা যাবে না
* Export permission আলাদা থাকবে
* Cash/shift closing বাধ্যতামূলক হবে
* Doctor commission transparent হবে
* Stock batch/expiry wise হবে
* Dashboard exception-first হবে
* Owner mobile dashboard থাকবে
* Backup ও active session control থাকবে

এই structure follow করলে Ozzyl HMS-এর Admin Panel ছোট ক্লিনিক থেকে শুরু করে মাঝারি হাসপাতাল এবং ভবিষ্যতে বড় multi-branch hospital পর্যন্ত scale করতে পারবে।

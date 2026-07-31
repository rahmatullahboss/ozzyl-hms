নিচে Ozzyl HMS – Cash Management, Collection & Reconciliation Module এর full A–Z blueprint দিলাম। এটা বাংলাদেশের ব্যস্ত hospital/clinic/diagnostic center-এর reality মাথায় রেখে বানানো হয়েছে।

⸻

Ozzyl HMS

Cash Management, Collection & Reconciliation Module

Full A–Z Blueprint

⸻

1. Module Goal

এই module-এর মূল উদ্দেশ্য হলো hospital-এর সব ধরনের টাকা-পয়সার transaction এক জায়গায় control করা:

- Reception counter collection
- OPD/Diagnostic/IPD/Pharmacy/OT payment
- Cash drawer tracking
- Shift-wise accountability
- Digital payment reconciliation
- Discount approval
- Refund control
- Petty cash voucher
- Advance/due collection
- Cash handover
- Bank deposit tracking
- Day-end reconciliation
- Admin audit trail

Final goal:

No hidden cash
No unauthorized discount
No fake refund
No untracked petty cash
No shift-end confusion
Full accountability by user + counter + shift

⸻

2. Core Concept

এই module-এর base concept হবে:

User + Counter + Shift + Cash Drawer + Transaction Ledger

মানে, একজন receptionist/cashier কোন counter-এ, কোন shift-এ, কত opening balance নিয়ে বসলো এবং shift চলাকালীন কী কী transaction করলো—সবকিছু একটি drawer ID-এর অধীনে থাকবে।

Example:

Drawer ID: DR-2026-00045
User: Nusrat Akter
Counter: OPD Counter 1
Shift: Morning Shift
Opening Balance: 5,000 BDT
Opened At: 08:00 AM
Status: Open

⸻

3. Core Users / Roles

3.1 Receptionist / Cashier

যা করতে পারবে:

- Shift open
- Opening balance entry
- Bill payment receive
- Receipt print
- Limited discount apply
- Petty cash voucher create
- Refund request create
- Shift close
- Own shift summary print

যা করতে পারবে না:

- High discount approve
- Posted bill edit
- Backdated transaction
- Own shortage approve
- Locked drawer reopen
- Large refund approve

⸻

3.2 Senior Cashier

যা করতে পারবে:

- Cashier drawer monitor
- Small refund approve
- Cash drop receive
- Shift close verify
- Petty cash approve within limit
- Cash handover receive

⸻

3.3 Accounts Officer

যা করতে পারবে:

- Daily reconciliation
- Bank deposit verify
- Digital payment settlement match
- Discount report review
- Refund report review
- Commission/payment adjustment
- Ledger posting verify

⸻

3.4 Admin / Director

যা করতে পারবে:

- All counters live view
- All drawer audit
- Discount policy setup
- Refund policy setup
- Petty cash category setup
- Cash shortage investigation
- Force close drawer
- Unlock with reason
- User permission control

⸻

3.5 Department User

যেমন Diagnostic, Pharmacy, IPD Billing user।

যা করতে পারবে:

- Department-specific bill collection
- Department-specific refund request
- Department shift close
- Department collection report

⸻

4. Full Cash Management Workflow

User Login
→ Select Counter
→ Open Cash Drawer
→ Enter Opening Balance
→ Start Collection
→ Receive Payments
→ Apply Discount if Allowed
→ Create Refund/Petty Cash if Needed
→ Mid-Shift Cash Drop if Needed
→ Close Shift
→ Enter Physical Cash Count
→ Method-wise Reconciliation
→ Submit Closing
→ Senior Cashier/Admin Verification
→ Bank Deposit / Vault Handover
→ Day-End Final Reconciliation
→ Lock Day

⸻

5. Main Module Sections

Cash Management module-এ এই sections থাকবে:

1. Cashier Dashboard
2. Open Cash Drawer
3. Collection / Payment Receive
4. Discount Approval
5. Refund Management
6. Petty Cash Voucher
7. Cash Drop / Partial Handover
8. Shift Close
9. Reconciliation
10. Bank Deposit
11. Admin Financial Control Room
12. Reports
13. Settings
14. Audit Trail

⸻

6. Cashier Dashboard UI

Cashier login করলে প্রথমে dashboard দেখবে।

6.1 If Drawer Not Open

Screen দেখাবে:

No Active Cash Drawer
To start billing or collection, please open your cash drawer.
[Open Cash Drawer]

Drawer open না করলে cashier cash collection করতে পারবে না।

⸻

6.2 If Drawer Open

Dashboard-এ দেখাবে:

Current Shift: Morning
Counter: OPD Counter 1
Drawer ID: DR-2026-00045
Opening Balance: 5,000 BDT
Cash Collection: 42,000 BDT
Digital Collection: 18,500 BDT
Refund Paid: 1,000 BDT
Petty Cash: 300 BDT
Cash Drop: 20,000 BDT
Expected Cash in Drawer: 25,700 BDT
[Receive Payment] [Create Voucher] [Refund Request] [Cash Drop] [Close Shift]

⸻

7. Cash Drawer Opening

7.1 Drawer Open Form

Fields:

- Counter
- Shift
- Opening balance
- Denomination count optional
- Remarks
- Device/IP auto detect
- Opened by auto detect

Example:

Counter: OPD Counter 1
Shift: Morning Shift
Opening Balance: 5,000
Remarks: Previous petty cash balance
[Open Drawer]

⸻

7.2 Opening Balance Rules

Recommended rules:

- Opening balance mandatory
- Negative opening balance not allowed
- Previous drawer must be closed before same counter opens
- Same user cannot open two drawers at same time unless admin allows
- Admin can set max opening balance warning
- Opening balance edit only before first transaction
- After first transaction, opening balance edit requires admin approval

⸻

8. Counter Management

Hospital-এ multiple counters থাকতে পারে।

Counter Examples

- OPD Counter 1
- OPD Counter 2
- Diagnostic Billing
- IPD Billing
- Emergency Counter
- Pharmacy Counter
- OT Billing Counter
- Discharge Counter
- Information/Registration Counter

Counter Settings

Each counter has:

- Counter name
- Department
- Allowed payment types
- Allowed users
- Cash limit
- Active/inactive status
- Printer mapping
- Receipt template
- Shift policy

⸻

9. Shift Management

9.1 Shift Types

Example:

Morning Shift: 08:00 AM – 02:00 PM
Evening Shift: 02:00 PM – 08:00 PM
Night Shift: 08:00 PM – 08:00 AM
Custom Shift

9.2 Shift Rules

- Shift start/end time configurable
- Late close warning
- Shift cannot close with pending transactions
- Shift cannot close with pending refund approval
- Shift summary print after close
- Admin can force close if user absent

⸻

10. Payment Collection Flow

Cashier invoice open করে payment receive করবে।

10.1 Payment Sources

Payment আসতে পারে:

- OPD bill
- Doctor consultation
- Diagnostic bill
- IPD advance
- IPD due collection
- Pharmacy sale
- OT bill
- Emergency bill
- Package bill
- Corporate bill
- Previous due
- Registration fee

⸻

10.2 Payment Receive Screen

Fields:

- Patient ID
- Invoice ID
- Gross amount
- Discount
- Net payable
- Paid amount
- Payment method
- Transaction reference
- Due amount
- Remarks

Example:

Patient: Rahim Uddin
Invoice: INV-10245
Gross Amount: 3,500
Discount: 200
Net Payable: 3,300
Payment Method: Cash
Paid Amount: 3,300
[Receive Payment & Print Receipt]

⸻

11. Payment Methods

Cash-only thinking করলে হবে না। Bangladesh context-এ multiple payment method support লাগবে।

Supported Payment Methods

Cash
bKash
Nagad
Rocket
Card/POS
Bank Transfer
Cheque
Corporate Credit
Insurance
Advance Adjustment
Mixed Payment

⸻

11.1 Mixed Payment Example

Patient 10,000 টাকা bill দিয়েছে:

Cash: 5,000
bKash: 3,000
Card: 2,000
Total Paid: 10,000

UI:

[+ Add Payment Method]
Cash: 5,000
bKash: 3,000 | TrxID: BK12345
Card: 2,000 | POS Slip: 8845
[Confirm Payment]

⸻

11.2 Digital Payment Required Fields

bKash/Nagad/Rocket

- Mobile number
- Transaction ID
- Amount
- Gateway/manual
- Verification status

Card/POS

- Bank/POS name
- Card type
- Last 4 digits optional
- POS slip number
- Batch number
- Amount

Bank Transfer

- Bank name
- Account name
- Reference number
- Deposit date
- Attachment optional

Cheque

- Cheque number
- Bank name
- Cheque date
- Status: Pending / Cleared / Bounced

⸻

12. Receipt Management

12.1 Receipt Rules

- Receipt number auto-generate
- Receipt linked with invoice and drawer
- Receipt cannot be deleted
- Cancelled receipt remains in audit
- Reprint tracked
- Duplicate copy watermark required

  12.2 Receipt Status

Paid
Partially Paid
Refunded
Partially Refunded
Cancelled
Void
Adjusted

12.3 Reprint Rule

If reprint:

- Reason mandatory
- Reprint count increase
- Printed by logged
- Printed time logged

Watermark:

DUPLICATE COPY

⸻

13. Invoice Payment Status

Every invoice should have clear status.

Unpaid
Partially Paid
Paid
Due
Refunded
Partially Refunded
Cancelled
Void
Written Off

⸻

14. Discount Management

Discount control is one of the most important parts.

14.1 Discount Types

Flat Amount
Percentage
Poor Fund
Doctor Reference
Management Reference
Corporate Discount
Package Discount
Promotional Discount
Special Approval

⸻

14.2 Discount Form

Fields:

- Invoice ID
- Discount type
- Discount amount / percentage
- Reason
- Reference type
- Reference person
- Approval status
- Attachment optional
- Remarks

Example:

Discount Type: Doctor Reference
Reference: Dr. Hasan
Discount Amount: 500
Reason: Doctor requested discount for poor patient
[Apply Discount]

⸻

14.3 Discount Permission Rules

Example:

Role Limit
Receptionist Max 5% or 500 BDT
Senior Cashier Max 10% or 1,500 BDT
Manager Max 20%
Admin/Director Unlimited with reason

⸻

14.4 Discount Approval Flow

Cashier enters discount
→ System checks limit
→ If within limit, apply
→ If above limit, request approval
→ Admin receives alert
→ Admin approves/rejects
→ Bill can be finalized

⸻

14.5 Discount Mandatory Fields

If discount > 0:

- Reason mandatory
- Reference mandatory
- User ID auto
- Time auto
- Invoice link auto

No reason = no discount.

⸻

15. Waiver vs Discount

Discount আর waiver আলাদা হওয়া উচিত।

Discount

Bill তৈরির সময় amount কমানো।

Example:

Diagnostic bill: 2,000
Discount: 200
Payable: 1,800

Waiver

Due/receivable মওকুফ করা।

Example:

IPD bill due: 10,000
Management waived: 5,000
Remaining due: 5,000

Waiver always higher approval required.

⸻

16. Refund Management

Refund সবচেয়ে sensitive। এখানে strict control লাগবে।

16.1 Refund Reasons

- Test cancelled
- Service not delivered
- Duplicate bill
- Wrong patient bill
- Doctor unavailable
- Package changed
- Patient refused
- Overpayment
- Advance return
- Discharge adjustment

⸻

16.2 Refund Status

Requested
Pending Approval
Approved
Paid
Rejected
Cancelled

⸻

16.3 Refund Flow

Cashier creates refund request
→ System checks original payment
→ Approval required based on amount
→ Admin/senior cashier approves
→ Cashier pays refund
→ Refund voucher printed
→ Original invoice marked refunded
→ Drawer cash adjusted

⸻

16.4 Refund Rules

- Original receipt required
- Refund cannot exceed paid amount
- Refund reason mandatory
- Approval required above limit
- Refund method should preferably match original payment method
- Patient/guardian receiver name required
- Phone number required
- Signature/photo attachment optional
- Refund print voucher mandatory
- Refund linked to drawer ID

⸻

16.5 Refund Payment Method

Example:

Original Payment Refund Method
Cash Cash
bKash bKash/manual transfer
Card Card reversal/manual refund
Bank Bank transfer
Mixed Split refund

⸻

17. Void, Cancel, Refund, Adjustment Difference

এইগুলো আলাদা না করলে accounting report নষ্ট হবে।

Action Meaning
Void ভুল entry, service হয়নি, same shift correction
Cancel Bill/service officially বাতিল
Refund টাকা ফেরত দেওয়া হয়েছে
Discount বিল করার সময় ছাড়
Waiver due amount মওকুফ
Adjustment advance/due/credit থেকে balance মিলানো
Write-off long-term due বাদ দেওয়া, admin approval

⸻

18. Petty Cash Management

Petty cash system strict হতে হবে।

18.1 Petty Cash Category

Admin predefined category set করবেন।

Examples:

Tea & Snacks / আপ্যায়ন
Stationery / স্টেশনারি
Cleaning Supplies
Local Transport
Emergency Medicine Purchase
Courier / Parcel
Small Maintenance
Utility Small Payment
Ward Support Expense
Other

⸻

18.2 Petty Cash Category Rules

Each category has:

- Max amount without approval
- Approval required yes/no
- Attachment required yes/no
- Active/inactive
- Allowed counters
- Allowed users

Example:

Category Max Without Approval Attachment
Tea & Snacks 300 Optional
Stationery 500 Optional
Transport 700 Optional
Emergency Purchase 1,000 Required
Maintenance 1,000 Required
Other 0 Required + Approval

⸻

18.3 Petty Cash Voucher Form

Fields:

- Category
- Amount
- Paid to
- Purpose
- Requested by
- Approved by
- Attachment/photo
- Remarks

Example:

Category: Stationery
Amount: 450
Paid To: Local Store
Purpose: Printer paper purchase
Requested By: Reception In-charge
Attachment: Bill photo
[Create Voucher]

⸻

18.4 Petty Cash Flow

Cashier creates voucher
→ System checks category limit
→ If within limit, approved or auto-approved
→ If over limit, admin approval required
→ Cash paid
→ Drawer cash out recorded
→ Voucher appears in shift closing

⸻

19. Cash Drop / Partial Handover

Busy hospital-এ counter-এ বেশি cash রাখা risky। তাই mid-shift cash drop দরকার।

19.1 Cash Drop Meaning

Cashier shift চলাকালীন cash-এর একটা অংশ chief cashier/admin/vault-এ জমা দেবে।

Example:

Opening Balance: 5,000
Cash Collection: 80,000
Cash Drop: 60,000
Expected Drawer Cash: 25,000

⸻

19.2 Cash Drop Form

Fields:

- Drawer ID
- Drop amount
- Received by
- Handover type
- Denomination count
- Remarks
- Receiver PIN/signature
- Print slip

Button:

[Cash Drop / Partial Handover]

⸻

19.3 Cash Drop Status

Requested
Received
Rejected
Cancelled

⸻

20. Shift Closing

Shift close হলো cashier accountability-এর final step।

20.1 Close Shift Screen

System দেখাবে:

Opening Balance: 5,000
Cash Collection: 75,000
Cash Refund: 2,000
Petty Cash: 500
Cash Drop: 50,000
Expected Cash: 27,500

Cashier input করবে:

Physical Cash Count: 27,300
Difference: -200
Explanation: 200 taka note missing, will verify

⸻

20.2 Denomination Count

Cashier denomination দিলে system auto total করবে।

Note Qty Total
1000 20 20,000
500 10 5,000
100 20 2,000
50 5 250
20 2 40
10 1 10

Total physical cash auto-calculate হবে।

⸻

20.3 Method-wise Closing

Cashier শুধু cash না, সব payment method reconcile করবে।

Payment Method System Amount Verified Amount Difference
Cash 27,500 27,300 -200
bKash 12,000 12,000 0
Nagad 4,000 4,000 0
Card 18,000 18,000 0
Bank 5,000 5,000 0

⸻

20.4 Shift Close Rules

- Physical cash entry mandatory
- Difference reason mandatory if mismatch
- Pending refund warning
- Pending petty voucher warning
- Pending discount approval warning
- Digital payment transaction ID missing warning
- Closing slip print available
- After close, no transaction allowed
- Reopen only admin permission

⸻

21. Cash Short / Excess Handling

If difference exists:

Expected Cash: 27,500
Physical Cash: 27,300
Difference: -200
Status: Pending Explanation

Status Options

Pending Explanation
Under Review
Accepted Loss
Recovered From Cashier
Adjusted
Resolved

Admin Action

Admin can:

- Accept explanation
- Mark as shortage
- Recover from cashier
- Adjust from petty
- Investigate transactions
- Escalate

⸻

22. Admin Handover Verification

Cashier shift close করার পর senior cashier/admin verify করবেন।

Verification Screen

Admin দেখবে:

Cashier: Nusrat Akter
Counter: OPD 1
Shift: Morning
Expected Cash: 27,500
Submitted Physical Cash: 27,300
Difference: -200
Cash Drop: 50,000
Petty Cash: 500
Refund: 2,000
[Accept] [Reject] [Send Back] [Mark Shortage]

⸻

23. Bank Deposit / Vault Management

Shift শেষে cash vault বা bank-এ deposit হতে পারে।

23.1 Vault Handover

Cashier → Chief Cashier → Vault

Fields:

- Amount
- Received by
- Time
- Denomination
- Slip number
- Remarks

  23.2 Bank Deposit

Fields:

- Bank name
- Account number
- Deposit amount
- Deposit date
- Deposit slip number
- Attachment
- Deposited by
- Verified by

  23.3 Bank Deposit Status

Pending Deposit
Deposited
Verified
Mismatch
Rejected

⸻

24. Digital Payment Reconciliation

Digital payment-এর জন্য আলাদা settlement process লাগবে।

24.1 bKash/Nagad/Rocket Reconciliation

Match by:

- Transaction ID
- Amount
- Time
- Merchant account
- Patient/invoice reference

Status:

Pending Verification
Matched
Mismatch
Duplicate
Failed
Settled

24.2 Card/POS Reconciliation

Match by:

- POS slip number
- Batch number
- Amount
- Bank settlement
- Date

  24.3 Bank Transfer Reconciliation

Match by:

- Reference number
- Bank statement
- Amount
- Date
- Depositor name

⸻

25. Due & Advance Management

Hospital billing-এ advance/due critical।

25.1 Advance Collection

Example:

Patient admitted
Advance received: 20,000
IPD Ledger Credit: 20,000

25.2 Advance Adjustment

Bill generate হলে:

Total IPD Bill: 55,000
Advance: 20,000
Payable: 35,000

25.3 Due Collection

Discharge-এর পরে due collection হলে:

Previous Due: 10,000
Collected Today: 5,000
Remaining Due: 5,000

25.4 Due Write-off

Write-off only admin/director approval.

⸻

26. Department-wise Collection

Cash module must connect with:

- OPD
- Diagnostic
- IPD
- Pharmacy
- Emergency
- OT
- Blood bank
- Ambulance
- Corporate billing

Department Collection Report

Department Gross Bill Discount Net Collection Due
OPD 50,000 2,000 48,000 0
Diagnostic 120,000 8,000 105,000 7,000
IPD 300,000 15,000 250,000 35,000
Pharmacy 80,000 1,000 79,000 0

⸻

27. Admin Financial Control Room

Admin dashboard হবে live financial control center।

27.1 Top Summary Cards

- Today gross billing
- Today net collection
- Cash in hand
- Digital collection
- Refund total
- Discount total
- Due collection
- Petty cash expense
- Cash shortage/excess
- Pending approvals

⸻

27.2 Live Counter Status

Counter Cashier Shift Expected Cash Status
OPD 1 Nusrat Morning 27,500 Open
Diagnostic Karim Morning 50,000 Open
IPD Rina Day 80,000 Open

⸻

27.3 Discount Monitoring

Admin দেখবে:

- Discount by cashier
- Discount by doctor reference
- Discount by department
- Discount by service
- Discount by approval user
- Discount trend

⸻

27.4 Refund Monitoring

Admin দেখবে:

- Today refund
- High refund alerts
- Refund by cashier
- Refund by department
- Pending refund approvals
- Refund after bill print
- Same patient multiple refund

⸻

27.5 Petty Cash Monitoring

Admin দেখবে:

- Category-wise petty expense
- Counter-wise petty expense
- User-wise petty expense
- Approval pending
- Attachment missing
- “Other” category usage

⸻

28. Alerts & Notifications

Alert Examples

- Cash drawer not opened
- Counter cash limit exceeded
- Discount above limit
- Refund request pending
- High refund amount
- Unusual petty cash
- Cash shortage found
- Digital payment transaction ID missing
- Duplicate transaction ID
- Shift not closed
- Previous drawer still open
- Backdated transaction attempt
- Receipt reprint too many times

⸻

29. Permissions & Role-Based Access

Permission Matrix

Feature Cashier Senior Cashier Accounts Admin
Open drawer Yes Yes Yes Yes
Receive payment Yes Yes Optional Yes
Apply small discount Yes Yes Yes Yes
Approve high discount No Limited Yes Yes
Create refund request Yes Yes Yes Yes
Approve refund No Limited Yes Yes
Create petty voucher Yes Yes Yes Yes
Approve petty voucher No Limited Yes Yes
Cash drop receive No Yes Yes Yes
Shift close Yes Yes Yes Yes
Verify shift close No Yes Yes Yes
Force close drawer No No Limited Yes
Unlock transaction No No Limited Yes
View all counters No Yes Yes Yes
Settings No No No Yes

⸻

30. Settings Module

Cash settings admin panel থেকে configurable হবে।

30.1 Counter Settings

- Counter name
- Department
- Assigned users
- Printer
- Receipt template
- Cash limit
- Active status

  30.2 Shift Settings

- Shift name
- Start time
- End time
- Grace period
- Auto warning
- Allow custom shift yes/no

  30.3 Payment Method Settings

- Cash active/inactive
- bKash merchant account
- Nagad merchant account
- POS bank list
- Bank transfer accounts
- Cheque allowed yes/no

  30.4 Discount Settings

- Role-wise discount limit
- Department-wise discount limit
- Service-wise discount limit
- Approval required threshold
- Mandatory reference yes/no
- Poor fund category

  30.5 Refund Settings

- Role-wise refund limit
- Same-method refund required yes/no
- Attachment required threshold
- Patient signature required yes/no
- Refund approval levels

  30.6 Petty Cash Settings

- Category list
- Category limit
- Attachment requirement
- Approval requirement
- Allowed users/counters

  30.7 Receipt Settings

- Receipt number format
- Duplicate watermark
- Reprint reason mandatory
- Print count visibility
- Thermal/A4 format

⸻

31. Audit Trail

Every important action must be logged.

Track These Actions

- Drawer opened
- Opening balance entered
- Payment received
- Discount applied
- Discount approved/rejected
- Refund requested
- Refund approved/paid
- Petty voucher created
- Petty voucher approved
- Cash drop submitted
- Cash drop received
- Shift closed
- Shift verified
- Bank deposit created
- Bank deposit verified
- Receipt printed/reprinted
- Transaction voided/cancelled
- Drawer force closed
- Settings changed

Audit Fields

user_id
action
module
entity_id
old_value
new_value
reason
ip_address
device_info
created_at

⸻

32. Reports

32.1 Cashier Shift Report

Shows:

- Opening balance
- Total cash collection
- Digital collection
- Refund
- Petty cash
- Cash drop
- Expected cash
- Physical cash
- Difference
- Transaction list

⸻

32.2 Day-End Collection Report

Shows:

- Gross bill
- Discount
- Net collection
- Cash
- Digital
- Refund
- Petty cash
- Due
- Advance
- Bank deposit
- Cash in vault
- Shortage/excess

⸻

32.3 Department-wise Collection Report

- OPD
- Diagnostic
- IPD
- Pharmacy
- OT
- Emergency
- Blood bank
- Ambulance

⸻

32.4 Discount Report

- By cashier
- By approver
- By reference
- By doctor
- By department
- By service
- By date range

⸻

32.5 Refund Report

- Refund by department
- Refund by cashier
- Refund by reason
- Refund by approver
- High refund report
- Same patient refund history

⸻

32.6 Petty Cash Report

- Category-wise
- Counter-wise
- User-wise
- Approval-wise
- Attachment missing
- Other category report

⸻

32.7 Digital Payment Settlement Report

- bKash matched/unmatched
- Nagad matched/unmatched
- POS settlement
- Bank transfer pending
- Cheque pending/cleared/bounced

⸻

32.8 Cash Shortage Report

- User-wise shortage
- Counter-wise shortage
- Shift-wise shortage
- Resolved/unresolved
- Recovered from cashier

⸻

33. Database Blueprint

33.1 cash_counters

id
hospital_id
name
department_id
printer_id
cash_limit
status
created_at
updated_at

⸻

33.2 cash_shifts

id
hospital_id
name
start_time
end_time
grace_minutes
status
created_at
updated_at

⸻

33.3 cash_drawers

id
hospital_id
counter_id
shift_id
user_id
opening_balance
system_cash
physical_cash
cash_difference
status
opened_at
closed_at
verified_by
verified_at
force_closed_by
force_close_reason
created_at
updated_at

Status:

open
closing_submitted
verified
rejected
force_closed
locked

⸻

33.4 cash_transactions

id
hospital_id
drawer_id
counter_id
user_id
patient_id
invoice_id
receipt_id
transaction_type
direction
payment_method
amount
reference_no
description
status
created_at
updated_at

Direction:

cash_in
cash_out
adjustment

Transaction type:

collection
refund
petty_cash
cash_drop
opening_balance
bank_deposit
advance
due_collection
waiver
adjustment

⸻

33.5 payment_collections

id
hospital_id
invoice_id
patient_id
drawer_id
collected_by
gross_amount
discount_amount
net_amount
paid_amount
due_amount
payment_status
collected_at
created_at

⸻

33.6 payment_collection_methods

id
collection_id
payment_method
amount
transaction_id
mobile_number
bank_name
pos_slip_no
cheque_no
reference_no
verification_status
created_at

⸻

33.7 receipts

id
hospital_id
receipt_no
invoice_id
patient_id
drawer_id
amount
status
print_count
created_by
created_at

⸻

33.8 receipt_print_logs

id
receipt_id
printed_by
print_type
reason
ip_address
device_info
printed_at

Print type:

original
duplicate

⸻

33.9 discounts

id
hospital_id
invoice_id
patient_id
discount_type
discount_amount
discount_percent
reason
reference_type
reference_id
approval_status
requested_by
approved_by
approved_at
created_at

⸻

33.10 refund_requests

id
hospital_id
invoice_id
receipt_id
patient_id
drawer_id
refund_amount
refund_method
reason
receiver_name
receiver_phone
approval_status
requested_by
approved_by
paid_by
paid_at
attachment_url
created_at

⸻

33.11 petty_cash_categories

id
hospital_id
name
max_without_approval
attachment_required
approval_required
status
created_at
updated_at

⸻

33.12 petty_cash_vouchers

id
hospital_id
drawer_id
category_id
amount
paid_to
purpose
requested_by
approved_by
approval_status
paid_status
attachment_url
remarks
created_at

⸻

33.13 cash_drops

id
hospital_id
drawer_id
amount
handover_to
received_by
status
denomination_json
remarks
created_at
received_at

⸻

33.14 cash_reconciliations

id
hospital_id
drawer_id
system_cash
physical_cash
difference
denomination_json
explanation
status
submitted_by
verified_by
created_at
verified_at

⸻

33.15 bank_deposits

id
hospital_id
amount
bank_name
account_no
deposit_slip_no
deposit_date
deposited_by
verified_by
status
attachment_url
created_at
verified_at

⸻

33.16 digital_payment_reconciliations

id
hospital_id
payment_method
transaction_id
system_amount
settled_amount
difference
settlement_date
status
verified_by
created_at

⸻

33.17 financial_audit_logs

id
hospital_id
user_id
action
entity_type
entity_id
old_value
new_value
reason
ip_address
device_info
created_at

⸻

34. API Blueprint

34.1 Drawer APIs

POST /api/cash/drawers/open
GET /api/cash/drawers/active
GET /api/cash/drawers/{id}
POST /api/cash/drawers/{id}/close
POST /api/cash/drawers/{id}/verify
POST /api/cash/drawers/{id}/reject
POST /api/cash/drawers/{id}/force-close

⸻

34.2 Collection APIs

POST /api/cash/collections
GET /api/cash/collections
GET /api/cash/collections/{id}
POST /api/cash/collections/{id}/print-receipt
POST /api/cash/receipts/{id}/reprint

⸻

34.3 Discount APIs

POST /api/cash/discounts/request
POST /api/cash/discounts/{id}/approve
POST /api/cash/discounts/{id}/reject
GET /api/cash/discounts

⸻

34.4 Refund APIs

POST /api/cash/refunds/request
POST /api/cash/refunds/{id}/approve
POST /api/cash/refunds/{id}/reject
POST /api/cash/refunds/{id}/pay
GET /api/cash/refunds

⸻

34.5 Petty Cash APIs

POST /api/cash/petty-vouchers
POST /api/cash/petty-vouchers/{id}/approve
POST /api/cash/petty-vouchers/{id}/reject
POST /api/cash/petty-vouchers/{id}/mark-paid
GET /api/cash/petty-vouchers

⸻

34.6 Cash Drop APIs

POST /api/cash/drops
POST /api/cash/drops/{id}/receive
POST /api/cash/drops/{id}/reject
GET /api/cash/drops

⸻

34.7 Bank Deposit APIs

POST /api/cash/bank-deposits
POST /api/cash/bank-deposits/{id}/verify
POST /api/cash/bank-deposits/{id}/reject
GET /api/cash/bank-deposits

⸻

34.8 Reports APIs

GET /api/cash/reports/day-end
GET /api/cash/reports/shift
GET /api/cash/reports/department-wise
GET /api/cash/reports/discounts
GET /api/cash/reports/refunds
GET /api/cash/reports/petty-cash
GET /api/cash/reports/shortage
GET /api/cash/reports/digital-settlement

⸻

34.9 Settings APIs

GET /api/cash/settings
POST /api/cash/settings/counters
POST /api/cash/settings/shifts
POST /api/cash/settings/payment-methods
POST /api/cash/settings/discount-rules
POST /api/cash/settings/refund-rules
POST /api/cash/settings/petty-categories

⸻

35. Frontend Pages

35.1 Cashier Dashboard

Path:

/cash/dashboard

Contains:

- Active drawer
- Today collection
- Expected cash
- Quick actions
- Alerts

⸻

35.2 Open Drawer Page

Path:

/cash/open-drawer

Contains:

- Counter select
- Shift select
- Opening balance
- Denomination

⸻

35.3 Receive Payment Page

Path:

/cash/receive-payment

Contains:

- Invoice search
- Patient info
- Amount
- Discount
- Payment method
- Receipt print

⸻

35.4 Discount Approval Page

Path:

/cash/discount-approvals

Contains:

- Pending discount requests
- Approve/reject
- Reference details

⸻

35.5 Refund Page

Path:

/cash/refunds

Contains:

- Refund requests
- Approval
- Paid status
- Refund voucher

⸻

35.6 Petty Cash Page

Path:

/cash/petty-cash

Contains:

- Voucher create
- Category
- Approval
- Paid status

⸻

35.7 Cash Drop Page

Path:

/cash/cash-drop

Contains:

- Partial handover
- Receiver confirmation
- Slip print

⸻

35.8 Shift Close Page

Path:

/cash/shift-close

Contains:

- System amount
- Physical count
- Denomination
- Difference
- Submit closing

⸻

35.9 Admin Control Room

Path:

/admin/financial-control

Contains:

- Live counters
- Collection summary
- Refund alerts
- Discount alerts
- Cash shortage
- Pending approvals

⸻

35.10 Reports Page

Path:

/cash/reports

Contains:

- Day-end report
- Shift report
- Department report
- Discount report
- Refund report
- Petty cash report

⸻

35.11 Cash Settings Page

Path:

/settings/cash

Contains:

- Counter settings
- Shift settings
- Payment methods
- Discount rules
- Refund rules
- Petty categories
- Receipt settings

⸻

36. UI/UX Guidelines for Bangladesh Hospitals

36.1 Cashier UI

Cashier screen simple হতে হবে:

- Big buttons
- Fast invoice search
- Patient name + ID clearly visible
- Net payable highlighted
- Payment method quick buttons
- One-click receipt print
- Low typing
- Bengali + English labels

⸻

36.2 Admin UI

Admin screen analytical হবে:

- Live cards
- Graphs
- Filters
- Alerts
- Drill-down transaction view
- Export Excel/PDF
- User-wise comparison

⸻

36.3 Important UX Rules

- Red color for mismatch/refund/shortage
- Green for matched/verified
- Yellow for pending approval
- Duplicate receipt clearly marked
- Confirmation for refund/void/discount
- No unnecessary popup during billing
- Auto-save draft for long forms
- Keyboard shortcuts for cashiers

⸻

37. Validation Rules

37.1 Drawer Validation

- No active drawer = no collection
- Counter already occupied = block/warning
- Previous drawer unclosed = block
- Opening balance required
- Opening balance edit locked after first transaction

⸻

37.2 Payment Validation

- Paid amount cannot exceed payable unless advance/overpayment rule enabled
- Digital transaction ID required
- Duplicate transaction ID warning/block
- Cash received cannot be negative
- Mixed payment total must match paid amount

⸻

37.3 Discount Validation

- Reason mandatory
- Reference mandatory
- Permission limit check
- Approval required if above limit
- Discount cannot exceed invoice amount
- Service-wise discount restriction possible

⸻

37.4 Refund Validation

- Original payment exists
- Refund cannot exceed paid amount
- Approval required
- Reason mandatory
- Receiver info required
- Refund method required
- Cannot refund locked/corporate bills without permission

⸻

37.5 Shift Close Validation

- Physical cash count required
- Difference reason required if mismatch
- Pending approvals warning
- Digital mismatch warning
- Cannot close while payment processing
- Drawer locked after close

⸻

38. Security Controls

Must-have Security

- Role-based access control
- IP/device tracking
- Audit logs
- Session timeout
- Two-step approval for high-risk actions
- PIN approval for counter-level admin
- No hard delete
- Soft delete with reason
- Backdated transaction restriction
- Receipt reprint tracking
- Daily lock after reconciliation

⸻

39. High-Risk Scenarios & Controls

Scenario 1: Cashier gives fake discount

Control:

- Discount limit
- Mandatory reference
- Approval above limit
- Discount audit report

⸻

Scenario 2: Fake refund

Control:

- Original receipt required
- Approval required
- Receiver info
- Refund voucher
- Audit trail

⸻

Scenario 3: Cash short at day end

Control:

- Shift drawer
- Denomination count
- Cash drop
- Reconciliation status
- Shortage investigation

⸻

Scenario 4: Digital payment fake transaction ID

Control:

- Duplicate transaction ID check
- Settlement reconciliation
- Payment verification status

⸻

Scenario 5: Petty cash misuse

Control:

- Admin-defined category
- Limit
- Attachment
- Approval
- Other category restricted

⸻

40. Integration With HMS Modules

40.1 OPD

- Consultation bill
- Registration fee
- Doctor fee
- OPD discount
- OPD refund

  40.2 Diagnostic

- Test bill collection
- Test cancel refund
- Discount
- Due collection

  40.3 IPD

- Advance collection
- Interim bill collection
- OT charge collection
- Discharge bill
- Due collection
- Advance adjustment

  40.4 Pharmacy

- Pharmacy sale payment
- Return/refund
- Credit sale
- Stock return link

  40.5 OT

- OT charge posting
- Surgeon fee
- Anesthesia charge
- OT consumable charge

  40.6 Accounts

- Ledger posting
- Bank deposit
- Doctor commission
- Daily closing
- Financial statement

  40.7 Corporate / Insurance

- Corporate credit bill
- Insurance approval
- Co-payment collection
- Receivable tracking

⸻

41. Accounting Impact

প্রতিটি transaction accounting ledger-এ impact করবে।

Example Entries

Cash Collection

Debit: Cash in Hand
Credit: Patient Revenue / Receivable

Digital Payment

Debit: Mobile Banking/Card Receivable
Credit: Patient Revenue / Receivable

Refund

Debit: Refund/Revenue Reversal
Credit: Cash/Bank

Discount

Debit: Discount Allowed
Credit: Patient Receivable

Petty Cash

Debit: Expense Category
Credit: Cash in Hand

Bank Deposit

Debit: Bank
Credit: Cash in Hand

⸻

42. MVP Development Plan

Phase 1 – Must-Have

- Cash drawer open/close
- Payment collection
- Receipt print
- Cash + digital payment method
- Basic discount limit
- Shift summary
- Admin live counter view
- Day-end collection report

⸻

Phase 2 – Control Layer

- Discount approval
- Refund workflow
- Petty cash voucher
- Cash drop
- Denomination count
- Department-wise report
- Audit trail

⸻

Phase 3 – Advanced Finance

- Digital payment reconciliation
- Bank deposit tracking
- Cash shortage investigation
- Waiver/write-off
- Corporate/insurance reconciliation
- Advanced dashboards

⸻

Phase 4 – Automation & AI

- Fraud pattern detection
- Unusual refund alert
- Discount abuse alert
- Cashier performance analysis
- Auto settlement matching
- Daily summary AI report

⸻

43. Final Recommended Workflow

1. Cashier logs in
1. Selects counter and shift
1. Opens cash drawer with opening balance
1. Receives payments during shift
1. System records every transaction under drawer ID
1. Discounts follow permission and approval rules
1. Refunds go through approval workflow
1. Petty cash vouchers are category-based and controlled
1. Cashier can perform cash drop if cash is high
1. At shift end, cashier counts physical cash
1. System compares expected vs physical cash
1. Cashier submits closing
1. Senior cashier/admin verifies
1. Cash is handed to vault or deposited to bank
1. Digital payments are reconciled
1. Day-end report is locked
1. Any mismatch goes to investigation

⸻

44. Final Product Formula

এই module-এর মূল formula হওয়া উচিত:

Every taka must have:
Source + User + Counter + Shift + Reason + Approval + Audit Log

আর final architecture:

Cash Drawer

- Payment Ledger
- Discount Control
- Refund Approval
- Petty Cash Voucher
- Digital Reconciliation
- Bank Deposit
- Audit Trail
  = Zero-Gap Hospital Cash Management

⸻

Final Verdict

Ozzyl HMS-এর cash management module শুধু billing receive করার system না; এটা hospital-এর financial control tower হবে।

এই blueprint অনুযায়ী বানালে hospital admin সহজেই দেখতে পারবে:

- আজকে মোট কত টাকা উঠেছে
- কোন counter-এ কত cash আছে
- কে কত discount দিয়েছে
- কে refund করেছে
- কোথায় cash short হয়েছে
- কত digital payment verified হয়নি
- petty cash কোথায় খরচ হয়েছে
- bank deposit মিলেছে কি না

Bangladesh-এর busy hospital environment-এর জন্য final recommendation:

Cashier UI হবে খুব simple, কিন্তু backend control হবে extremely strict.
Receptionist যেন দ্রুত bill নিতে পারে, আর admin যেন ১ টাকা mismatch হলেও source বের করতে পারে।

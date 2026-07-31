নিচে Ozzyl HMS – Operation Theater (OT) Module এর full A–Z blueprint দিলাম। এটা এমনভাবে সাজানো হয়েছে যাতে তুমি সরাসরি UI/UX designer, backend developer, frontend developer, AI agent বা product team-কে দিতে পারো।

⸻

Ozzyl HMS – Operation Theater Module A–Z Blueprint

1. Module Goal

OT Module-এর মূল লক্ষ্য হলো হাসপাতালে অপারেশন সম্পর্কিত সব কাজ এক জায়গা থেকে নিয়ন্ত্রণ করা:

- Doctor/IPD/OPD থেকে OT request নেওয়া
- OT room, time slot, surgeon, anesthetist, nurse assign করা
- Pre-OT checklist ও consent verify করা
- Operation চলাকালীন notes, anesthesia, vitals, inventory consumption record করা
- OT bill auto-generate করে IPD ledger-এ পাঠানো
- Pharmacy/OT store stock auto-deduct করা
- Surgeon/anesthetist commission auto-calculate করা
- Recovery/PACU handover complete করা
- Full audit trail রাখা

এটা হবে SPA style, reload-free, tablet-friendly, touch-optimized, role-based এবং audit-safe module।

⸻

2. Core Users / Roles

2.1 Surgeon

Surgeon করবেন:

- OT request create
- Surgery/procedure select
- Surgical note লিখবেন বা template select করবেন
- Procedure finalization করবেন
- Post-op instruction দেবেন

  2.2 Anesthetist

Anesthetist করবেন:

- Anesthesia fitness status
- Anesthesia type select
- Anesthesia start/end time
- Anesthesia notes
- Intra-op vitals verification

  2.3 OT Nurse

OT nurse করবেন:

- Patient received confirmation
- Surgical checklist
- Gauze/instrument count
- OT inventory consumption
- Sample/specimen tracking
- Handover preparation

  2.4 OT In-Charge

OT in-charge করবেন:

- OT request approval
- Room assign
- Team assign
- OT schedule management
- Emergency OT override
- Final case close

  2.5 Pharmacy / Store

Pharmacy/store করবেন:

- OT stock issue
- Return item receive
- Wastage approve
- Batch/expiry/serial control

  2.6 Accounts

Accounts করবেন:

- OT charges review
- Surgeon/anesthesia commission verify
- Billing lock/unlock
- Refund/discount approval

  2.7 Admin

Admin করবেন:

- OT settings
- Charge rules
- Commission rules
- Permission settings
- Template settings
- Audit review

⸻

3. Full OT Workflow

Master Workflow

OT Request
→ Pre-OT Clearance
→ OT Scheduling
→ Room & Team Assignment
→ Patient Received in OT
→ Safety Checklist
→ Operation Started
→ Anesthesia Log
→ Intra-Operative Vitals
→ Surgical Notes
→ Inventory Consumption
→ Operation Ended
→ PACU / Recovery Handover
→ Billing Posted
→ Pharmacy Stock Updated
→ Commission Calculated
→ Case Completed & Locked

⸻

4. OT Case Status Flow

প্রতিটি OT case-এর একটি clear status থাকবে।

Recommended Status List

Requested
Pending Clearance
Approved
Scheduled
Patient Received
Ready for Surgery
In Operation
Surgery Ended
In Recovery
Handover Completed
Billing Drafted
Billing Posted
Completed
Cancelled
Postponed
Emergency Override

Status Meaning

Status Meaning
Requested Doctor OT request করেছেন
Pending Clearance Consent, anesthesia, payment, lab pending
Approved OT in-charge request approve করেছেন
Scheduled Room/time/team assign হয়েছে
Patient Received Patient OT area-তে এসেছে
Ready for Surgery Checklist complete
In Operation Surgery চলছে
Surgery Ended Operation শেষ
In Recovery Patient recovery/PACU-তে
Handover Completed Ward/ICU nurse handover নিয়েছে
Billing Drafted OT bill তৈরি হয়েছে
Billing Posted IPD bill-এ charge post হয়েছে
Completed Case locked
Cancelled Case cancel
Postponed Later schedule
Emergency Override Emergency case normal clearance ছাড়া শুরু হয়েছে

⸻

5. Main OT Dashboard UI

Dashboard হবে OT Control Center।

5.1 Top Bar

Top bar-এ থাকবে:

- Date selector
- OT room filter
- Surgeon filter
- Status filter
- Patient search
- Emergency OT button
- Today / Tomorrow / This Week toggle
- Notification bell
- Refresh sync indicator

Example:

[Today: 05 Jun 2026] [All OT Rooms ▼] [All Surgeons ▼] [Search Patient]
[+ Emergency OT] [Pending Clearance: 4] [In Operation: 2]

⸻

5.2 Room Matrix

OT room status visual card আকারে থাকবে।

Room Card Example

OT Room 1
Status: In Operation
Patient: P-10245 | Rahim Uddin
Procedure: Appendectomy
Surgeon: Dr. Hasan
Started: 10:30 AM
Duration: 45 min
[Open Case]

Color System

Color Status
Green Available
Blue In Operation
Yellow Cleaning / Sterilization
Orange Waiting for Patient
Red Emergency / Blocked
Gray Maintenance / Unavailable
Purple Recovery Pending

⸻

5.3 Today’s OT Queue

এই section-এ আজকের operation list থাকবে।

Time OT Room Patient Procedure Surgeon Anesthesia Status Action
09:00 OT 1 P-1001 C-Section Dr. A Spinal Scheduled Open
10:30 OT 2 P-1002 Appendectomy Dr. B General In Operation Continue
12:00 OT 1 P-1003 Cholecystectomy Dr. C General Pending Clearance Check

Action Buttons

- Open Case
- Start Checklist
- Start Operation
- End Surgery
- Add Consumption
- Send to Recovery
- Complete Case
- Postpone
- Cancel

⸻

6. OT Request Flow

OT request সাধারণত OPD/IPD থেকে তৈরি হবে।

6.1 Doctor OT Request Form

Fields:

- Patient ID
- Patient name
- Department
- Admission type: OPD / IPD / Emergency
- Diagnosis
- Proposed surgery/procedure
- Surgery category
- Surgery priority
- Preferred date
- Preferred time
- Estimated duration
- Required anesthesia
- Blood requirement
- ICU required?
- Special equipment required?
- Implant required?
- Surgeon note
- Estimated package/charge

  6.2 Surgery Priority

Elective
Urgent
Emergency
High Risk

6.3 Request Button

[Submit OT Request]

Submit করার পর status হবে:

Requested

⸻

7. Pre-OT Clearance

OT start করার আগে system কিছু clearance check করবে।

7.1 Clearance Checklist

Clearance Item Required? Status
Surgery consent Yes Done/Pending
Anesthesia consent Yes Done/Pending
Anesthesia fitness Yes Done/Pending
Payment/advance clearance Optional/Configurable Done/Pending
Blood arrangement Conditional Done/Pending
Lab reports Conditional Done/Pending
ECG/X-ray/Imaging Conditional Done/Pending
NPO/Fasting status Yes Done/Pending
Allergy check Yes Done/Pending
Surgical site marking Conditional Done/Pending
OT pack ready Yes Done/Pending
ICU bed reserved Conditional Done/Pending

7.2 Clearance UI

Pre-OT Readiness Score: 87%
Consent: Done
Anesthesia Fitness: Done
Blood: Pending
Payment Clearance: Done
OT Pack: Ready
[Approve With Warning] [Hold Case] [Mark Ready]

7.3 Hard Block Rules

System setting থেকে control করা যাবে কোন item pending থাকলে operation start করা যাবে না।

Example:

- Consent missing → hard block
- Anesthesia fitness missing → hard block
- Payment pending → warning অথবা hard block, hospital policy অনুযায়ী
- Blood pending → procedure-specific block

⸻

8. Consent Management

OT module-এ consent management must-have।

Consent Types

- General surgery consent
- Anesthesia consent
- High-risk consent
- Blood transfusion consent
- C-section consent
- Minor patient guardian consent
- Laparoscopic surgery consent
- ICU consent

Consent Fields

- Consent type
- Patient/guardian name
- Relation
- Phone number
- Witness name
- Doctor name
- Date/time
- Upload scanned copy
- Digital signature/photo signature
- Remarks

Consent Status

Not Required
Pending
Uploaded
Signed
Verified
Rejected

⸻

9. OT Scheduling Calendar

OT scheduling screen-এ calendar এবং room timeline থাকবে।

9.1 Views

- Day view
- Week view
- Room-wise timeline
- Surgeon-wise timeline
- Pending request board

  9.2 Timeline Example

Time OT 1 OT 2 OT 3
09:00 C-Section Available Appendectomy
10:00 Cleaning Hernia Repair Ongoing
11:00 Cholecystectomy Available Recovery Pending

9.3 Drag & Drop

OT in-charge চাইলে operation card drag করে অন্য room/time slot-এ নিতে পারবেন।

9.4 Conflict Detection

System automatically warning দেবে:

- Same surgeon already booked
- Same anesthetist already booked
- OT room unavailable
- Estimated duration overlap
- Required equipment unavailable
- ICU bed unavailable
- Blood not arranged

⸻

10. Room & Team Assignment

Fields

- OT room
- Chief surgeon
- Assistant surgeon
- Anesthetist
- OT nurse
- Scrub nurse
- Circulating nurse
- OT technician
- Ward boy/support staff

UI

Grid card style:

Chief Surgeon
[Dr. Hasan ▼]
Anesthetist
[Dr. Karim ▼]
Scrub Nurse
[Nurse A ▼]
OT Room
[OT Room 2 ▼]
[Lock Team Assignment]

Lock Rule

Team locked হলে normal user edit করতে পারবে না। Edit করতে হলে reason লাগবে।

⸻

11. Emergency OT Flow

বাংলাদেশের জন্য Emergency OT mode খুব important।

11.1 Emergency OT Button

Dashboard-এ থাকবে:

[+ Emergency OT]

11.2 Minimal Emergency Form

Fields:

- Patient ID / Unknown patient temporary ID
- Name if available
- Age/gender
- Emergency diagnosis
- Procedure
- Surgeon
- OT room
- Reason for emergency override
- Started by
- Time

  11.3 Emergency Override Rules

Emergency case-এ:

- Consent later upload করা যাবে
- Payment clearance skip করা যাবে
- Minimal patient info দিয়ে start করা যাবে
- Audit log mandatory
- Reason mandatory
- Admin/OT in-charge notification যাবে

  11.4 Status

Emergency Override → In Operation

⸻

12. Patient Received in OT

Patient OT area-তে এলে nurse receive করবেন।

Fields

- Patient received time
- Received from: Ward / ICU / Emergency / Labor room
- Brought by
- Patient identity verified
- Wristband checked
- File received
- Consent file received
- Last vitals checked
- Allergy checked
- NPO checked

Button:

[Confirm Patient Received]

⸻

13. Intra-Operative Canvas

এটাই OT module-এর সবচেয়ে important screen।

Layout

Left 30%: Patient Summary + AI Risk Overview
Right 70%: Operation Data Entry Tabs

⸻

13.1 Left Panel – Patient Summary

Patient Header

Rahim Uddin
Patient ID: P-10245
Age/Gender: 45/M
Blood Group: B+
IPD Bed: Cabin 302
Consultant: Dr. Hasan

Risk Badges

ALLERGY: Penicillin
DIABETIC
HYPERTENSION
CARDIAC HISTORY
HIGH RISK

AI OT Overview

AI summary দেখাবে:

- Drug allergy
- Blood group
- Chronic disease
- Abnormal lab
- Previous surgery
- Current medication
- Anticoagulant use
- Pregnancy status
- Infection risk
- High-risk alerts

Important: AI decision নেবে না, শুধু assist করবে।

UI text:

AI Summary is for assistance only. Verify with clinical file before final decision.

Last Vitals

- BP
- Pulse
- SpO2
- Temperature
- Weight
- Blood sugar

Pre-OT Clearance Summary

- Consent
- Anesthesia fitness
- Blood
- Payment
- Lab
- Imaging

⸻

13.2 Right Panel Tabs

Right panel-এ tabs থাকবে:

Checklist | Anesthesia | Vitals | Surgical Notes | Inventory | Billing | Handover

⸻

14. Surgical Safety Checklist

Checklist ৩ ভাগে ভাগ করা উচিত।

14.1 Sign In — Before Anesthesia

- Patient identity confirmed
- Procedure confirmed
- Consent confirmed
- Site marked
- Allergy checked
- Airway risk checked
- Blood loss risk checked
- Pulse oximeter attached
- Anesthesia machine checked

  14.2 Time Out — Before Incision

- Team introduced
- Patient confirmed
- Procedure confirmed
- Antibiotic given
- Imaging available
- Required equipment ready
- Implant ready
- Expected critical events discussed

  14.3 Sign Out — Before Patient Leaves OT

- Procedure name confirmed
- Instrument count correct
- Gauze count correct
- Needle count correct
- Specimen labeled
- Equipment issue noted
- Recovery plan confirmed
- Post-op instruction recorded

Checklist UI

Big touch-friendly checkbox:

[✓] Patient identity confirmed
[✓] Consent checked
[✓] Allergy checked
[ ] Blood loss risk discussed
[Save Checklist]

⸻

15. Anesthesia Log

Fields

- Anesthesia type
- Anesthetist
- Anesthesia assistant
- Anesthesia start time
- Anesthesia end time
- Airway method
- Intubation status
- Drugs used
- Complications
- Anesthesia notes

Anesthesia Type Options

General
Spinal
Local
Regional
Epidural
Sedation
Combined

UI

Anesthesia Type: [General ▼]
Anesthetist: [Dr. Karim ▼]
Start Time: [Now]
End Time: [Set Time]
[Add Drug] [Add Complication] [Save]

⸻

16. Intra-Operative Vitals

Vitals Fields

- Time
- BP
- Pulse
- SpO2
- Respiration
- Temperature
- Blood sugar
- Urine output
- Fluid input
- Blood loss
- Remarks

Quick Entry UI

[+ Add Vitals]
BP: [120/80]
Pulse: [88]
SpO2: [98]
[Save]

Auto Interval

Settings থেকে প্রতি 5/10/15 মিনিট vitals entry reminder দেওয়া যাবে।

⸻

17. Surgical Notes

Surgical notes medicolegal document। তাই careful design দরকার।

Fields

- Pre-op diagnosis
- Post-op diagnosis
- Procedure performed
- Incision type
- Operative findings
- Steps performed
- Complications
- Specimen sent
- Drain placed
- Blood loss
- Closure method
- Post-op plan
- Surgeon final note

Quick Template System

Surgeon type না করে template use করতে পারবেন।

Example templates:

- Normal appendix removed
- Inflamed gallbladder removed
- C-section completed successfully
- Hernia mesh repair done
- No intra-operative complication
- Specimen sent for histopathology
- Drain placed
- Patient tolerated procedure well

Finalization Rule

Surgical note final হলে:

Locked

Edit করতে হলে:

Addendum required

⸻

18. OT Inventory Consumption

এই অংশ hospital leakage control-এর জন্য সবচেয়ে critical।

18.1 Inventory Sources

- OT sub-store
- Central pharmacy
- Central store
- CSSD sterile store
- Emergency cart
- Department stock

  18.2 Item Flow

Requested
→ Issued to OT
→ Used
→ Returned
→ Wasted/Damaged
→ Billed
→ Stock Adjusted

18.3 Consumption Entry UI

Search bar:

Search item: Syr...
Result:
Syringe 5ml
Syringe 10ml
Surgical suture 2-0

Item select করার পর:

Item: Syringe 5ml
Qty Issued: 5
Qty Used: 2
Qty Returned: 3
Batch: B-2026
Expiry: 12/2027
Billable: Yes
[Add]

18.4 Quick OT Packs

Common surgery অনুযায়ী predefined packs থাকবে।

Examples:

- C-section pack
- Appendectomy pack
- Cholecystectomy pack
- Hernia repair pack
- Major surgery pack
- Minor surgery pack
- Dressing pack

Button:

[Add C-Section Pack]

Click করলে predefined items auto-add হবে।

18.5 High-Value Item Control

এই items-এর জন্য batch/serial mandatory:

- Implant
- Mesh
- Stapler
- Plate
- Screw
- Special suture
- Lens
- Stent
- Prosthesis

⸻

19. Billing Integration

OT billing automatically IPD provisional bill-এ যাবে।

19.1 Billing Heads

- OT room charge
- Surgery charge
- Surgeon fee
- Assistant surgeon fee
- Anesthesia charge
- Anesthetist fee
- OT nurse/service charge
- Equipment charge
- Consumables
- Medicines
- Implant
- CSSD/sterilization charge
- Recovery/PACU charge
- Emergency surcharge
- Miscellaneous

  19.2 Billing Flow

Draft OT Bill
→ OT In-Charge Review
→ Accounts Review, if required
→ Post to IPD Ledger
→ Lock Bill

19.3 Billing UI

OT Room Charge: 8,000
Surgeon Fee: 20,000
Anesthesia Fee: 7,000
Medicine: 4,500
Consumables: 3,200
Implant: 15,000
Total: 57,700
[Save Draft] [Post to IPD Bill]

19.4 Billing Edit Rule

Bill posted হয়ে গেলে edit করা যাবে না।

Edit করতে হলে:

- Unlock permission
- Reason mandatory
- Audit log
- Previous amount history

⸻

20. Pharmacy & Stock Deduction Logic

Better Deduction Flow

Stock সরাসরি Save & Release-এ minus না করে proper flow হওয়া উচিত।

Item issued from OT store → Stock reserved/issued
Item used confirmed → Stock consumed
Unused returned → Stock restored
Wasted item → Stock deducted as wastage
Bill posted → Used billable items added to patient bill

Stock Ledger Entry

প্রতিটি item-এর ledger থাকবে:

- Item ID
- Batch
- Expiry
- Qty issued
- Qty used
- Qty returned
- Qty wasted
- Patient ID
- OT case ID
- User ID
- Time

⸻

21. Surgeon & Anesthetist Commission

Commission Calculation

Rules settings থেকে define হবে।

Examples:

- Fixed amount per surgery
- Percentage of surgery charge
- Percentage after discount
- Department-wise rule
- Doctor-wise rule
- Package-wise rule
- Emergency surcharge included/excluded

Flow

OT Bill Posted
→ Commission Rule Applied
→ Doctor Payable Created
→ Accounts Review
→ Payment Settlement

Commission Ledger

Fields:

- Doctor ID
- OT case ID
- Patient ID
- Procedure
- Gross charge
- Doctor share
- Hospital share
- Tax/deduction
- Payable amount
- Status: Pending / Approved / Paid

⸻

22. PACU / Recovery Handover

Operation শেষ হলে patient recovery/PACU-তে যাবে।

Fields

- Shifted to: Recovery / Ward / ICU
- Shift time
- Consciousness level
- BP
- Pulse
- SpO2
- Pain score
- Drain status
- Catheter status
- Oxygen support
- Post-op medicine
- Special instruction
- Handover nurse
- Receiving nurse
- Remarks

Button:

[Complete Handover]

Status:

In Recovery → Handover Completed

⸻

23. Case Completion & Lock

Case complete করার আগে system verify করবে:

Completion Checklist

- Surgery start/end time given
- Anesthesia log completed
- Safety checklist completed
- Surgical note finalized
- Inventory consumption confirmed
- Bill posted or draft saved
- Stock updated
- Handover completed
- Surgeon finalized
- OT in-charge closed case

Button:

[Complete & Lock OT Case]

Completed case edit করা যাবে না। Correction করতে হলে addendum বা authorized unlock লাগবে।

⸻

24. Audit Trail

OT module-এ audit trail mandatory।

Track করতে হবে

- কে request করেছে
- কে approve করেছে
- কে room assign করেছে
- কে checklist complete করেছে
- কে operation start/end করেছে
- কে note edit করেছে
- কে inventory add/remove করেছে
- কে bill post করেছে
- কে unlock করেছে
- কী change হয়েছে
- previous value
- new value
- time
- device/IP

Audit UI

Admin দেখতে পারবেন:

10:30 AM - Nurse A marked patient received
10:45 AM - Dr. Karim started anesthesia
11:00 AM - Dr. Hasan started surgery
12:05 PM - Nurse B added Syringe 5ml x2
12:30 PM - OT bill posted by Accounts User

⸻

25. Reports

Daily OT Report

- Total scheduled
- Completed
- Cancelled
- Emergency
- Room utilization
- Surgeon-wise cases
- Procedure-wise cases

Financial Report

- OT revenue
- Surgery charge
- Medicine/consumable revenue
- Implant revenue
- Surgeon commission
- Anesthesia commission
- Discount/waiver

Inventory Report

- Item used by OT
- Item used by surgery type
- Wastage report
- Returned item report
- High-value item usage
- Expired/near-expiry item usage warning

Clinical Report

- Surgery outcome
- Complication report
- Infection flag
- Specimen sent report
- Mortality/morbidity review support

Utilization Report

- OT room utilization percentage
- Average surgery duration
- Average cleaning time
- Delay reason report
- Surgeon schedule performance

⸻

26. Notifications & Alerts

Alert Examples

- Consent missing
- Anesthesia fitness pending
- Blood not arranged
- OT room conflict
- Surgeon conflict
- Required equipment unavailable
- High-risk patient
- Allergy alert
- OT stock low
- Surgery delayed
- Recovery handover pending
- Bill not posted
- Case not locked

Notification Channels

- In-app notification
- Dashboard badge
- SMS/WhatsApp optional
- Nurse station alert
- Accounts alert
- Pharmacy alert

⸻

27. OT Settings

Admin settings থেকে সব configure করা যাবে।

27.1 OT Room Settings

- Room name
- Room type
- Floor
- Status
- Cleaning time
- Sterilization time
- Available hours
- Maintenance schedule

  27.2 Procedure Settings

- Procedure name
- Department
- Default duration
- Default charge
- Default anesthesia type
- Required checklist
- Required equipment
- Required OT pack
- High-risk flag

  27.3 Charge Settings

- OT room charge
- Hourly charge
- Surgery package charge
- Emergency surcharge
- Anesthesia charge
- Recovery charge
- Equipment charge

  27.4 Commission Settings

- Surgeon fee rule
- Assistant surgeon rule
- Anesthetist rule
- Package-based commission
- Department-based commission
- Tax/deduction rule

  27.5 Checklist Template Settings

- Pre-OT checklist
- Sign In checklist
- Time Out checklist
- Sign Out checklist
- Handover checklist

  27.6 Inventory Pack Settings

- Surgery pack name
- Item list
- Default quantity
- Billable/non-billable
- Required/optional

  27.7 Permission Settings

- Who can start OT
- Who can end OT
- Who can post bill
- Who can unlock bill
- Who can edit notes
- Who can emergency override
- Who can close case

⸻

28. Database Blueprint

নিচে simplified database structure দিলাম।

28.1 ot_cases

id
hospital_id
patient_id
admission_id
department_id
requested_by_doctor_id
procedure_id
diagnosis
priority
status
requested_date
scheduled_start
scheduled_end
actual_start
actual_end
ot_room_id
chief_surgeon_id
anesthetist_id
is_emergency
emergency_reason
created_by
created_at
updated_at

28.2 ot_rooms

id
hospital_id
name
room_code
floor
status
room_type
cleaning_duration
sterilization_duration
is_active

28.3 ot_team_assignments

id
ot_case_id
role
staff_id
assigned_by
locked_at
created_at

Roles:

chief_surgeon
assistant_surgeon
anesthetist
scrub_nurse
circulating_nurse
technician
support_staff

28.4 ot_clearance_checks

id
ot_case_id
check_type
status
is_required
verified_by
verified_at
remarks
attachment_url

28.5 ot_consents

id
ot_case_id
consent_type
guardian_name
guardian_relation
guardian_phone
witness_name
doctor_id
status
file_url
signed_at
verified_by
created_at

28.6 ot_safety_checklists

id
ot_case_id
section
item_name
status
checked_by
checked_at
remarks

Section:

sign_in
time_out
sign_out

28.7 ot_anesthesia_logs

id
ot_case_id
anesthesia_type
anesthetist_id
start_time
end_time
airway_method
drugs
complications
notes
created_by
created_at

28.8 ot_vitals

id
ot_case_id
recorded_at
bp
pulse
spo2
respiration
temperature
blood_sugar
urine_output
fluid_input
blood_loss
remarks
recorded_by

28.9 ot_surgical_notes

id
ot_case_id
pre_op_diagnosis
post_op_diagnosis
procedure_performed
operative_findings
procedure_steps
complications
specimen_sent
drain_placed
blood_loss
closure_method
post_op_plan
final_note
status
finalized_by
finalized_at

28.10 ot_inventory_consumptions

id
ot_case_id
item_id
batch_id
qty_issued
qty_used
qty_returned
qty_wasted
unit_price
is_billable
status
added_by
created_at

28.11 ot_bills

id
ot_case_id
patient_id
admission_id
gross_amount
discount_amount
net_amount
status
posted_to_ipd_bill
posted_by
posted_at
locked_at
created_at

28.12 ot_bill_items

id
ot_bill_id
charge_head
item_id
description
quantity
unit_price
total
doctor_id
is_commissionable

28.13 ot_commissions

id
ot_case_id
doctor_id
role
gross_amount
commission_rule
commission_amount
deduction
net_payable
status
created_at

28.14 ot_recovery_handovers

id
ot_case_id
shifted_to
shift_time
bp
pulse
spo2
consciousness_level
pain_score
drain_status
catheter_status
oxygen_support
post_op_instruction
handover_by
received_by
remarks
created_at

28.15 ot_audit_logs

id
ot_case_id
user_id
action
old_value
new_value
reason
ip_address
device_info
created_at

⸻

29. API Blueprint

OT Request APIs

POST /api/ot/requests
GET /api/ot/requests
GET /api/ot/requests/{id}
PATCH /api/ot/requests/{id}/approve
PATCH /api/ot/requests/{id}/reject
PATCH /api/ot/requests/{id}/postpone
PATCH /api/ot/requests/{id}/cancel

Scheduling APIs

GET /api/ot/schedule
POST /api/ot/schedule
PATCH /api/ot/cases/{id}/assign-room
PATCH /api/ot/cases/{id}/assign-team
PATCH /api/ot/cases/{id}/reschedule

Operation APIs

PATCH /api/ot/cases/{id}/receive-patient
PATCH /api/ot/cases/{id}/start
PATCH /api/ot/cases/{id}/end-surgery
PATCH /api/ot/cases/{id}/send-recovery
PATCH /api/ot/cases/{id}/complete

Checklist APIs

GET /api/ot/cases/{id}/checklists
POST /api/ot/cases/{id}/checklists
PATCH /api/ot/checklists/{id}

Anesthesia APIs

POST /api/ot/cases/{id}/anesthesia
PATCH /api/ot/anesthesia/{id}

Vitals APIs

POST /api/ot/cases/{id}/vitals
GET /api/ot/cases/{id}/vitals

Surgical Note APIs

POST /api/ot/cases/{id}/surgical-note
PATCH /api/ot/surgical-notes/{id}
PATCH /api/ot/surgical-notes/{id}/finalize
POST /api/ot/surgical-notes/{id}/addendum

Inventory APIs

POST /api/ot/cases/{id}/inventory/issue
POST /api/ot/cases/{id}/inventory/use
POST /api/ot/cases/{id}/inventory/return
POST /api/ot/cases/{id}/inventory/wastage
GET /api/ot/cases/{id}/inventory

Billing APIs

POST /api/ot/cases/{id}/bill/draft
PATCH /api/ot/bills/{id}/review
PATCH /api/ot/bills/{id}/post-to-ipd
PATCH /api/ot/bills/{id}/lock
PATCH /api/ot/bills/{id}/unlock

Reports APIs

GET /api/ot/reports/daily
GET /api/ot/reports/financial
GET /api/ot/reports/inventory
GET /api/ot/reports/utilization
GET /api/ot/reports/doctor-wise

⸻

30. Frontend Pages

30.1 OT Dashboard

Path:

/ot/dashboard

Contains:

- Room matrix
- Today’s queue
- Pending clearance
- Emergency button
- Live status

  30.2 OT Request List

Path:

/ot/requests

Contains:

- Requested cases
- Filter by department/doctor/priority
- Approve/reject/postpone

  30.3 OT Scheduling Calendar

Path:

/ot/schedule

Contains:

- Room timeline
- Calendar
- Drag/drop
- Conflict alert

  30.4 OT Case Canvas

Path:

/ot/cases/:id/canvas

Contains:

- Patient summary
- AI overview
- Checklist
- Anesthesia
- Vitals
- Surgical notes
- Inventory
- Billing
- Handover

  30.5 OT Inventory

Path:

/ot/inventory

Contains:

- OT store stock
- Issue/return/wastage
- Pack management

  30.6 OT Billing

Path:

/ot/billing

Contains:

- Draft bills
- Posted bills
- Pending review
- Commission status

  30.7 OT Reports

Path:

/ot/reports

Contains:

- Daily OT report
- Revenue report
- Utilization report
- Inventory usage report

  30.8 OT Settings

Path:

/settings/ot

Contains:

- Rooms
- Procedures
- Charges
- Commission
- Checklists
- Templates
- Packs
- Permissions

⸻

31. UI/UX Principles for Bangladesh Hospitals

31.1 Touch Friendly

- Button height minimum 48px
- Large action buttons
- Minimal typing
- Template/dropdown based input
- One-click “Now” time button
- Auto-save
- Big status badge

  31.2 Low Training Requirement

- Bengali + English mixed labels
- Simple language
- No complex tables in operation screen
- Color-coded status
- Step-by-step workflow

  31.3 Busy Environment Design

- Critical alerts always visible
- Patient ID and name fixed header
- No unnecessary popup
- Confirmation only for risky actions
- Fast search
- Quick add items
- Recent/favorite items

  31.4 Tablet Mode

Tablet UI must support:

- Landscape mode
- Big buttons
- Swipe tabs
- Sticky patient summary
- Offline draft saving
- Auto sync when internet returns

⸻

32. AI Features

32.1 AI OT Risk Summary

AI will summarize:

- Allergy
- Blood group
- Comorbidity
- Abnormal lab
- Previous surgery
- Current medication
- High-risk factors

  32.2 AI Surgical Note Draft

Surgeon template select করলে AI structured note draft করতে পারে।

Example:

Procedure: Laparoscopic appendectomy
Finding: Inflamed appendix
Complication: None

AI draft করবে, doctor approve করবেন।

32.3 AI Delay Reason Analysis

System detect করতে পারে:

- Consent delay
- Surgeon delay
- Room cleaning delay
- Patient transfer delay
- Payment clearance delay

  32.4 AI Inventory Prediction

Procedure অনুযায়ী probable OT pack suggest করবে।

Example:

For C-section, suggested pack:

- Spinal needle
- Suture
- Gauze
- Syringe
- IV cannula

Safety Rule

AI কোনো clinical decision final করবে না। সব doctor/nurse verify করবে।

⸻

33. Security & Compliance

Must-have

- Role-based access
- Audit logs
- Data encryption
- Session timeout
- Device-based login control
- Emergency override log
- Bill unlock reason
- Note edit history
- IP/device tracking
- Soft delete, not hard delete
- Backup policy

Sensitive Data Rules

- OT notes only authorized clinical users দেখতে পারবে
- Billing accounts দেখতে পারবে, কিন্তু full clinical notes নয়
- Pharmacy inventory দেখতে পারবে, কিন্তু surgical details সীমিত
- Admin audit দেখতে পারবে

⸻

34. Offline / Poor Internet Support

বাংলাদেশের হাসপাতালে internet issue common। তাই:

Offline Draft

Tablet/local browser temporary draft save করবে:

- Vitals
- Inventory quick entries
- Checklist
- Notes draft

Sync Logic

Offline entry saved locally
→ Internet returns
→ Sync queue uploads
→ Conflict detected হলে user review

Critical Data Warning

Offline mode-এ billing post বা final lock করা যাবে না।

⸻

35. Integration With Other HMS Modules

35.1 IPD

- OT charge IPD ledger-এ যাবে
- Patient bed/ward info আসবে
- Discharge bill-এ OT bill visible হবে

  35.2 OPD

- OPD doctor OT request দিতে পারবে
- OPD patient later IPD conversion লাগতে পারে

  35.3 Pharmacy

- Medicine issue/use/return
- Batch/expiry
- Stock deduction

  35.4 Inventory / Store

- Consumables
- OT packs
- Implants
- Equipment

  35.5 Accounts

- OT bill
- Doctor commission
- Discount approval
- Revenue report

  35.6 HR / Duty Roster

- Available nurse
- Available anesthetist
- Surgeon schedule

  35.7 Lab / Radiology

- Lab reports
- Imaging availability
- Blood bank integration

  35.8 CSSD

- Sterile instrument issue
- Sterilization status
- Instrument return

⸻

36. CSSD / Sterilization Integration

OT module-এ CSSD integration দিলে professional হবে।

CSSD Flow

Instrument requested
→ Sterile set issued
→ Used in OT
→ Returned dirty
→ Sent to CSSD
→ Sterilized
→ Available again

Fields

- Instrument set name
- Sterilization batch
- Issued time
- Returned time
- Sterilized by
- Expiry of sterilization
- Status

⸻

37. Cancellation & Postponement Flow

OT cancel/postpone হলে reason mandatory।

Reasons

- Patient not ready
- Payment issue
- Consent missing
- Surgeon unavailable
- Anesthesia clearance failed
- Blood unavailable
- OT room unavailable
- Equipment unavailable
- Emergency case priority
- Patient refused
- Medical instability

Cancel/Postpone UI

Reason: [Blood unavailable ▼]
Remarks: [Optional]
Notify: [Surgeon] [Ward] [Accounts] [Patient Attendant]
[Confirm Postpone]

⸻

38. Delay Tracking

Each OT delay should be recorded.

Delay Fields

- Scheduled start
- Actual start
- Delay minutes
- Delay reason
- Responsible department
- Remarks

Report

- Average delay per OT room
- Surgeon-wise delay
- Department-wise delay
- Most common delay reason

⸻

39. Important Validation Rules

Start Operation Validation

System check করবে:

- Patient received?
- Consent done?
- Anesthesia fitness done?
- Checklist sign-in done?
- Room assigned?
- Surgeon assigned?
- Anesthetist assigned?

End Surgery Validation

- Surgery start time exists
- Anesthesia log exists
- Required notes draft exists
- Sign-out checklist pending warning

Complete Case Validation

- Surgery ended
- Handover done
- Inventory confirmed
- Bill drafted/posted
- Surgical note finalized
- Audit complete

⸻

40. MVP Version

প্রথম version-এ সবকিছু বানালে অনেক বড় হয়ে যাবে। তাই MVP এভাবে করা ভালো।

Phase 1 MVP

- OT request
- OT schedule
- Room matrix
- Team assignment
- Pre-OT checklist
- Operation start/end
- Surgical note
- Basic inventory consumption
- Auto IPD billing
- Basic reports

Phase 2

- Consent management
- Anesthesia log
- Vitals chart
- OT packs
- Inventory issue/return/wastage
- Billing lock/unlock
- Commission calculation
- Recovery handover

Phase 3

- CSSD integration
- AI OT overview
- AI note draft
- Emergency override
- Advanced audit trail
- Offline mode
- Delay analytics
- Utilization analytics

⸻

41. Final Recommended Screen Flow

1. Doctor creates OT Request
1. OT In-charge reviews request
1. Pre-OT clearance checked
1. Room and team assigned
1. Case appears on OT Dashboard
1. Nurse receives patient
1. Sign-in checklist completed
1. Anesthesia started
1. Surgery started
1. Vitals and notes recorded
1. Inventory used/returned/wasted
1. Surgery ended
1. Sign-out checklist completed
1. Patient shifted to recovery/ward/ICU
1. Handover completed
1. OT bill generated
1. Bill posted to IPD ledger
1. Stock deducted
1. Commission generated
1. Case completed and locked

⸻

42. Developer Implementation Priority

Backend First

1. ot_cases
2. ot_rooms
3. ot_team_assignments
4. ot_clearance_checks
5. ot_surgical_notes
6. ot_inventory_consumptions
7. ot_bills
8. ot_audit_logs

Frontend First

1. OT Dashboard
2. OT Request Form
3. OT Schedule Calendar
4. OT Case Canvas
5. Inventory Consumption Panel
6. Billing Panel

Later

1. AI Overview
2. CSSD
3. Offline support
4. Advanced reports

⸻

43. Best Final Architecture

Ozzyl HMS যদি modern SPA হয়, তাহলে OT module architecture হওয়া উচিত:

Frontend:
React / Next.js / Vue SPA
Tablet-friendly responsive UI
Backend:
Laravel / Node.js API
Role-based access
Audit log middleware
Database:
PostgreSQL / MySQL
Realtime:
WebSocket / SSE for OT room live status
Queue:
Billing posting, stock deduction, commission calculation
AI:
Separate AI service for patient summary and note draft
Storage:
Consent files, OT documents, attachments
Security:
RBAC, audit log, encrypted sensitive data

⸻

Final Verdict

এই OT module Ozzyl HMS-এর সবচেয়ে sensitive এবং high-value module হবে। তাই শুধু সুন্দর UI করলেই হবে না; এখানে safety, billing accuracy, inventory control, audit trail, emergency handling এবং clinical handover—সব একসাথে থাকতে হবে।

তোমার final OT module-এর core formula হওয়া উচিত:

Fast UI + Safe Workflow + Accurate Billing + Stock Control + Full Audit Trail

এই blueprint অনুযায়ী বানালে module-টা বাংলাদেশের busy private hospital, clinic, diagnostic-based hospital এবং medium-size general hospital—সব জায়গায় practical হবে।

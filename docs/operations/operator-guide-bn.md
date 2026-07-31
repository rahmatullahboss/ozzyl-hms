# Ozzyl HMS Operator Guide — বাংলা

এই গাইডটি নতুন অপারেটর/রিসেপশন/ম্যানেজার/হাসপাতাল অ্যাডমিনের জন্য। লক্ষ্য হলো: সফটওয়্যারে ঢোকার পর কোন মেনুতে কোন কাজ করতে হবে, দৈনিক রোগী আসলে কীভাবে ফ্লো চালাতে হবে, আর কোথায় সতর্ক থাকতে হবে—এগুলো সহজভাবে বোঝানো।

---

## 1. সফটওয়্যারের মূল ধারণা

Ozzyl HMS হলো হাসপাতালের দৈনিক কাজ চালানোর সফটওয়্যার। এখানে সাধারণত এই কাজগুলো করা হয়:

- রোগী খোঁজা / নতুন রোগী রেজিস্ট্রেশন
- ডাক্তার appointment / OPD serial দেওয়া
- Billing counter থেকে bill তৈরি ও payment নেওয়া
- Lab test order / report tracking
- Admission / bed / IPD billing
- Pharmacy / stock / reagent control
- Cash drawer / shift handover / collection report
- Admin approval / discount / refund / audit review

সহজ ভাষায়: রোগী hospital-এ আসবে → reception রোগী search/register করবে → appointment/queue তৈরি হবে → doctor/lab/pharmacy কাজ করবে → billing/payment হবে → report/receipt print হবে → admin/manager report দেখবে।

---

## 2. Login করার নিয়ম

1. Browser খুলুন।
2. Hospital HMS URL ওপেন করুন।
3. আপনার username/email এবং password দিয়ে login করুন।
4. Login করার পর আপনার role অনুযায়ী dashboard খুলবে।

সাধারণ role:

| Role | কাজ |
|---|---|
| Reception | রোগী registration, appointment, billing intake, payment, queue |
| Billing/Accountant | bill, payment, due, refund/credit note, reports |
| Doctor | patient view, consultation note, prescription, lab order |
| Lab | lab order receive, sample/result/report |
| Pharmacy | medicine stock, invoice, dispensing |
| Nurse | vitals, nursing tasks, ward workflow |
| Manager | daily operations monitor, patient, billing, lab, reports |
| Hospital Admin | staff, settings, approval, audit, reports, access control |
| Director/MD | high-level dashboard, audit, financial/operational report |

> নিরাপত্তা নিয়ম: একই login অনেকজন ব্যবহার করবেন না। প্রত্যেক staff-এর আলাদা account থাকা উচিত।

---

## 3. Dashboard বুঝে নেওয়া

Login করার পর সাধারণত বাম পাশে menu/sidebar থাকবে। উপরে header থাকবে। মাঝের অংশে কাজের page থাকবে।

গুরুত্বপূর্ণ UI অংশ:

- **Sidebar/Menu**: সব module-এর shortcut।
- **Header**: user/role, logout, command/search সুবিধা থাকতে পারে।
- **Breadcrumb**: আপনি কোন page-এ আছেন দেখাবে।
- **Sync/Offline indicator**: data sync বা internet/server সমস্যা থাকলে সতর্কতা দেখাতে পারে।
- **Profile**: নিজের profile/setting দেখার জায়গা।
- **Logout**: কাজ শেষে logout করতে হবে।

---

## 4. Reception Operator-এর দৈনিক কাজ

Reception হলো hospital workflow-এর সবচেয়ে গুরুত্বপূর্ণ জায়গা। সাধারণ daily flow নিচে দেওয়া হলো।

### 4.1 Morning start checklist

প্রতিদিন কাজ শুরু করার আগে:

1. Login করুন।
2. **Reception Dashboard / Daily Desk** খুলুন।
3. Doctor status দেখুন: কোন doctor available, busy, absent।
4. Appointment/OPD queue দেখুন।
5. Printer ঠিক আছে কিনা check করুন।
6. Cash drawer/shift শুরু করা প্রয়োজন হলে **Cash Operations** খুলুন।
7. আগের shift-এর due/handover pending আছে কিনা দেখুন।

### 4.2 নতুন রোগী এলে কী করবেন

**ধাপ 1: আগে search করুন**

- Patient নাম, mobile number, patient code/MRN দিয়ে search করুন।
- একই রোগী আগে থাকলে নতুন করে duplicate করবেন না।
- রোগী পাওয়া গেলে existing profile খুলুন।

**ধাপ 2: রোগী না পেলে নতুন registration করুন**

- Patient name
- Mobile number থাকলে দিন
- Age / date of birth
- Gender
- Address
- Guardian/relative info থাকলে দিন
- Submit/Save করুন

**ধাপ 3: appointment বা service select করুন**

- কোন doctor দেখাবে?
- OPD/consultation fee আছে?
- Lab test লাগবে?
- Emergency/IPD লাগবে?

**ধাপ 4: Billing করুন**

- Billing Counter খুলুন।
- Service select করুন।
- Discount থাকলে policy অনুযায়ী দিন; unauthorized discount দেবেন না।
- Payment method select করুন: Cash / bKash / Nagad / Card / Due ইত্যাদি।
- Bill confirm করুন।
- Receipt print দিন।

**ধাপ 5: Queue/serial দিন**

- Appointment/Queue page থেকে serial confirm করুন।
- রোগীকে token/serial/doctor room জানান।

### 4.3 পুরনো রোগী এলে কী করবেন

1. Search করুন।
2. Patient profile verify করুন: name, mobile, age।
3. নতুন visit/appointment তৈরি করুন।
4. Service bill করুন।
5. Receipt/token print করুন।

### 4.4 ভুল এড়ানোর নিয়ম

- Search না করে নতুন patient বানাবেন না।
- Bill confirm করার আগে service, doctor, amount, patient name মিলিয়ে নিন।
- Payment নেওয়ার আগে due/paid status বুঝুন।
- Discount/Refund/Credit Note নিজের ইচ্ছায় করবেন না; approval লাগতে পারে।
- Patient record, report, bill—কোনো sensitive data অন্যকে দেখাবেন না।

---

## 5. Reception Menu Guide

Reception sidebar-এ সাধারণত নিচের menu থাকবে।

| Menu | কাজ |
|---|---|
| Daily Desk / Reception Dashboard | আজকের কাজের overview |
| OPD Serial / Appointments | doctor appointment, serial/token |
| Billing Counter | দ্রুত bill তৈরি ও payment |
| Cash Operations | shift cash, cash drawer, handover |
| Admissions | IPD patient admission |
| Report Delivery / Reports | report, shift report, collection report |
| Doctor Status | doctor available/busy/absent status |
| Patients | patient list/search/details |
| OPD Queue | queue management |
| Billing | bill list/history |
| Patient Card Scan | QR/card দিয়ে patient খোঁজা |
| Online Approvals | online appointment approval |
| Deposits | advance/deposit নেওয়া |
| Credit Notes | bill correction/credit note |
| Settlements | patient due/settlement |
| Bill Handover | shift/bill handover |
| Provisional Billing | temporary/provisional bill |
| Payments | payment list/collection |
| Insurance | insurance billing |
| Beds | bed status |
| IP Billing | admitted patient running bill |
| Death Records | death record entry |
| Blood Bank | blood bank related কাজ |
| Ambulance | ambulance request/management |
| Help Center | help/support guide |

---

## 6. Billing Counter ব্যবহার করার সহজ নিয়ম

Billing counter-এ কাজ করার সময় এই sequence রাখুন:

1. Patient select/search করুন।
2. Visit/appointment select করুন, অথবা নতুন visit তৈরি করুন।
3. Service item select করুন:
   - Doctor consultation
   - Lab test
   - Procedure
   - Admission/IPD charge
   - Other hospital service
4. Quantity/price check করুন।
5. Discount থাকলে reason select করুন।
6. Payment method select করুন।
7. Paid amount লিখুন।
8. Due থাকলে due reason লিখুন।
9. Bill confirm করুন।
10. Receipt print দিন।

### Billing করার সময় check করবেন

- Patient name ঠিক আছে?
- Doctor/service ঠিক আছে?
- Amount ঠিক আছে?
- Paid/due ঠিক আছে?
- Receipt print হয়েছে?

---

## 7. Cash Operations / Shift Handover

Cash mistake hospital-এর বড় সমস্যা। তাই shift/cash নিয়ম মানা জরুরি।

### Shift শুরু

1. Cash Operations খুলুন।
2. Opening balance দিন।
3. Drawer/Counter select করুন।
4. Shift start করুন।

### Shift চলাকালীন

- সব cash bill system-এ entry দিন।
- Bill ছাড়া cash নেবেন না।
- Manual paper note করলে পরে system-এ entry মিলিয়ে নিন।
- Refund/discount approval ছাড়া করবেন না।

### Shift শেষ

1. Total collection check করুন।
2. Cash count করুন।
3. System amount বনাম হাতে থাকা cash মিলান।
4. Difference থাকলে reason লিখুন।
5. Shift handover করুন।
6. Shift report print/save করুন।

---

## 8. Appointment / OPD Queue Flow

1. Patient search করুন।
2. Doctor select করুন।
3. Date/time বা today slot select করুন।
4. Appointment confirm করুন।
5. Billing complete করুন।
6. Queue/token generate করুন।
7. Patient waiting status set করুন।
8. Doctor দেখা শেষ হলে status update হবে/করুন।

Status বুঝুন:

| Status | মানে |
|---|---|
| Waiting | রোগী অপেক্ষা করছে |
| In Consultation | doctor দেখছেন |
| Completed | consultation শেষ |
| Cancelled/No Show | রোগী আসেনি বা cancel |

---

## 9. Lab Flow — Reception দৃষ্টিকোণ

Reception সাধারণত lab test bill/order তৈরি করবে। Lab team result দেবে।

Flow:

1. Patient select করুন।
2. Billing Counter থেকে lab test select করুন।
3. Bill confirm/payment নিন।
4. Lab order auto-create হলে lab dashboard-এ যাবে।
5. Patient-কে sample collection point জানান।
6. Report ready হলে Report Delivery/Print থেকে report দিন।

সতর্কতা:

- Test name ভুল হলে report ভুল হবে।
- Payment ছাড়া report delivery policy hospital অনুযায়ী follow করুন।
- Reagent/stock issue থাকলে lab/admin exception review করবে।

### 9.1 Analyzer Review Inbox — Lab ও Governance Team

Analyzer থেকে result এলে সেটি সরাসরি patient report-এ publish হয় না। প্রথমে **Lab Machines → Review Inbox**-এ immutable evidence হিসেবে আসে।

Lab staff যা করবে:

1. সঠিক analyzer/machine select করুন।
2. **Review Inbox** tab খুলুন।
3. Patient, order, test, raw value ও normalized value মিলিয়ে দেখুন।
4. Match, QC এবং Validation badge দেখুন।
5. `unmatched`, `ambiguous`, `qc blocked` বা `validation blocked` হলে কারণ resolve না হওয়া পর্যন্ত accept করবেন না।
6. Lab staff evidence দেখতে পারবে, কিন্তু final accept/reject governance role করবে।

Pathologist / Lab Supervisor / Hospital Admin / MD যা করবে:

- **Accept result** শুধু তখনই ব্যবহার করুন যখন match=`exact`, QC=`pass/override`, Validation=`pass/override`।
- **Reject result** দিলে পরিষ্কার কারণ লিখুন; যেমন wrong patient, wrong specimen, analyzer/QC issue বা mapping error।
- একই user result stage করে final decision দিতে পারবে না।
- Accepted বা rejected decision পরে edit করা যায় না। Correction প্রয়োজন হলে নতুন analyzer observation/superseding workflow ব্যবহার করতে হবে।
- Critical result accept হলে critical communication/acknowledgement workflow follow করুন।

Superseding review তৈরি করার নিয়ম — শুধু Pathologist / Lab Supervisor:

1. Evidence detail থেকে **Correct or rematch this evidence** খুলুন।
2. একই lab test-এর সঠিক target order item নির্বাচন করুন।
3. কেন নতুন immutable review row প্রয়োজন—স্পষ্ট clinical reason লিখুন।
4. পুরোনো QC pass না হলে QC override reason বাধ্যতামূলক।
5. Patient পরিবর্তন হলে বা validation pass না হলে validation override reason বাধ্যতামূলক।
6. Original evidence কখনো edit হবে না; নতুন row `supersedes` lineage সহ তৈরি হবে।
7. যিনি superseding row তৈরি করেছেন তিনি সেটি accept করতে পারবেন না; অন্য governance reviewer final decision দেবেন।
8. Accepted result অন্য patient/order item-এ সরানো যাবে না। এটির জন্য formal result retraction workflow প্রয়োজন।

> নিরাপত্তা নিয়ম: raw analyzer evidence, patient identity, specimen এবং unit না মিলিয়ে কোনো result accept করবেন না।

---

## 10. IPD / Admission Basic Flow

যদি রোগী ভর্তি হয়:

1. Patient search/register করুন।
2. Admissions খুলুন।
3. Doctor/department select করুন।
4. Bed select করুন।
5. Admission form fill করুন।
6. Deposit নিন, receipt print করুন।
7. Running bill/IP Billing থেকে charge monitor করুন।
8. Discharge সময় final settlement করুন।

---

## 11. Admin / Manager Guide

Admin/Manager role-এ বেশি control থাকবে। নতুন operator হিসেবে admin menu বুঝতে এইভাবে ধরুন।

### Admin-এর গুরুত্বপূর্ণ menu

| Menu | কাজ |
|---|---|
| Dashboard | hospital overview |
| Pending Approvals | discount/refund/exception approval |
| Billing Counter | bill/payment কাজ দেখা বা করা |
| Cash Control | drawer/cash status |
| Shift Handover | shift handover review |
| Due Collection | due patient follow-up |
| Discount Review | discount audit/review |
| Expenses | expense entry/review |
| Reagent Control | lab reagent/consumption monitoring |
| Stock Control | inventory stock overview |
| Purchase Requests | purchase/requisition |
| Stock Counts | stock count/physical verification |
| Patients | patient list/search |
| Doctors | doctor setup/list |
| Services Pricing | billing service price setup |
| Branches/Departments | department/branch setup |
| Reports | operational reports |
| Collection Reports | cash/collection report |
| Staff | staff management |
| Access Control | role/permission management |
| Payment Methods | cash/bKash/Nagad/card setup |
| Print Layouts | receipt/report print format |
| SMS/Email | notification setting |
| System Preferences | hospital settings |
| Audit Explorer | sensitive action review |

### Admin daily checklist

1. Pending approvals দেখুন।
2. Cash drawer mismatch আছে কিনা দেখুন।
3. Discount/refund abnormal আছে কিনা দেখুন।
4. Due collection report দেখুন।
5. Lab/reagent/stock alert দেখুন।
6. Staff activity/audit log weekly review করুন।
7. Backup/sync/server health check করুন।

---

## 12. Hospital Admin Setup — প্রথমবার চালুর আগে

Hospital go-live করার আগে এগুলো setup করতে হবে:

- Hospital profile/name/logo
- Branch/department
- Doctor list/schedule
- Service price / billing master
- Payment methods
- Print template
- Staff accounts
- Role/permission
- Lab test catalogue
- Pharmacy/inventory item setup
- Cash drawer/counter setup
- SMS/email setting থাকলে configure

---

## 13. Staff Account ও Permission Rule

Minimum policy:

| Role | Allowed | Restricted |
|---|---|---|
| Reception | patient search, registration, appointment, basic billing | patient merge, refund, audit log edit, clinical note edit |
| Doctor | encounter, prescription, clinical view | refund, tenant settings, role management |
| Nurse | vitals, nursing workflow | prescription creation, refund, audit logs |
| Lab | lab order/result/report | billing edit, patient merge, role management |
| Pharmacist | prescription read/dispense | prescription creation, refund, audit logs |
| Accountant/Billing | invoices, payments, deposits, approved refund | clinical notes, patient merge |
| Hospital Admin | staff, settings, approval, audit review | direct clinical decision ownership |
| Director/MD | audit/report/sensitive approval | daily shared login use |

---

## 14. Sensitive কাজ — সবসময় সতর্ক থাকবেন

নিচের কাজগুলো risky, তাই approval/audit দরকার হতে পারে:

- Patient merge/unmerge
- Bill cancel
- Refund
- Credit note
- Deposit refund
- Role/permission change
- Document download/export
- Emergency access
- Consent grant/revoke
- Cash mismatch adjustment
- Stock adjustment/write-off

---

## 15. Report/Print Guide

প্রতিদিন যেসব print/report দরকার হতে পারে:

- Bill receipt
- OPD token/serial
- Lab report
- Shift handover report
- Daily collection report
- Due report
- IPD running bill
- Discharge summary

Print না হলে:

1. Printer on আছে কিনা দেখুন।
2. Same Wi-Fi/LAN network আছে কিনা দেখুন।
3. Browser print popup blocked কিনা দেখুন।
4. Correct printer selected কিনা দেখুন।
5. আবার print দিন।
6. সমস্যা থাকলে admin/IT-কে জানান।

---

## 16. Common Problem & Solution

| সমস্যা | কী করবেন |
|---|---|
| Login হচ্ছে না | username/password check, internet/server check, admin-কে বলুন |
| Menu দেখা যাচ্ছে না | আপনার role/permission কম থাকতে পারে |
| Patient খুঁজে পাচ্ছেন না | mobile/name/patient code দিয়ে আবার search করুন |
| Duplicate patient হয়ে গেছে | নিজে merge করবেন না; admin approval দরকার |
| Bill ভুল হয়েছে | payment confirm করার আগে ঠিক করুন; confirm হয়ে গেলে admin/authorized person |
| Receipt print হচ্ছে না | printer/network/browser print setting check |
| Cash mismatch | shift শেষে reason লিখুন, manager/admin-কে জানান |
| Lab order দেখা যাচ্ছে না | bill/service mapping check করতে lab/admin-কে বলুন |
| System slow | internet/server/local network check করুন |
| Data save হচ্ছে না | error message screenshot নিয়ে admin/IT-কে দিন |

---

## 17. নতুন অপারেটরের ৭ দিনের Training Plan

### Day 1: Basic orientation

- Login/logout
- Sidebar/menu বুঝা
- Patient search
- Patient profile দেখা
- Dashboard overview

### Day 2: Patient registration

- নতুন patient entry
- পুরনো patient খোঁজা
- Duplicate এড়ানো
- Patient card/QR scan বোঝা

### Day 3: Appointment/Queue

- Doctor status দেখা
- OPD appointment তৈরি
- Serial/token
- Queue status update

### Day 4: Billing Counter

- Service select
- Bill create
- Payment receive
- Due handling
- Receipt print

### Day 5: Lab/IPD basic

- Lab test bill/order
- Report delivery
- Admission basic
- Deposit/IP billing overview

### Day 6: Cash/Shift

- Cash drawer start
- Collection tracking
- Shift handover
- Daily report print

### Day 7: Error handling & review

- Wrong bill process
- Discount/refund policy
- Approval flow
- Audit/security basics
- Practical demo test

---

## 18. Daily Operator Checklist — ছোট ভার্সন

প্রতিদিন মনে রাখবেন:

1. Login করুন।
2. Doctor status ও queue দেখুন।
3. Patient আসলে আগে search করুন।
4. না থাকলে registration করুন।
5. Appointment/service select করুন।
6. Bill/payment complete করুন।
7. Receipt/token print দিন।
8. Lab/IPD হলে সংশ্লিষ্ট desk-এ পাঠান।
9. Shift শেষে cash মিলিয়ে handover করুন।
10. Logout করুন।

---

## 19. Operator-এর জন্য সবচেয়ে গুরুত্বপূর্ণ নিয়ম

- আগে search, পরে create।
- Bill confirm করার আগে amount/patient/service check।
- Cash হাতে নিলে system entry বাধ্যতামূলক।
- Approval ছাড়া refund/discount/cancel নয়।
- Patient data private।
- সমস্যা হলে screenshot নিয়ে admin/IT-কে জানান।
- Shared login ব্যবহার করবেন না।

---

## 20. Practical Demo Script — Training-এর জন্য

নতুন operator-কে শেখাতে এই demo করুন:

1. Demo patient search করুন।
2. না পেলে new patient create করুন।
3. Doctor appointment দিন।
4. Consultation bill তৈরি করুন।
5. Payment receive করে receipt print করুন।
6. Queue/token দেখান।
7. Lab test add করে bill করুন।
8. Report delivery page দেখান।
9. Deposit/IPD admission overview দেখান।
10. Shift handover report দেখান।

এই demo একবার হাতে-কলমে করলে operator দ্রুত software বুঝে যাবে।

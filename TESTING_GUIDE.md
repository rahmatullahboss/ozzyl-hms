# Ozzyl HMS - টেস্টিং গাইড

সম্পূর্ণ হসপিটাল ম্যানেজমেন্ট সিস্টেম টেস্টিং ডকুমেন্ট | সংস্করণ ২.০ | মে ২০২৬

> [!TIP]
> **এই ডকুমেন্ট কীভাবে ব্যবহার করবেন**
> প্রথমে **Role-wise UAT** করবেন, তারপর **End-to-End Patient Flow**, শেষে **Financial Reconciliation** করবেন। প্রতিটি টেস্টে expected result না মিললে production go-live করা যাবে না।
>
> **Production URL:** `https://hms-saas-production.rahmatullahzisan.workers.dev` | **Hospital:** `demo-hospital` | **Common password:** `Demo@1234`

> [!CAUTION]
> **Production Ready বলার Minimum Rule**
> একটি দিন শেষে নিচের তিনটি হিসাব অবশ্যই মিলতে হবে: **Invoice Total = Collection + Due + Adjusted/Refunded**, **Daily Cash = Cash Ledger Total**, এবং **Doctor Payable = Approved Commission Entries**। কোনো cancelled/not-done test payable commission-এ থাকবে না।

---

## ১. ইউজার রোল পরিচিতি

| রোল | কোড | Frontend Route | API Endpoints |
| :--- | :--- | :--- | :--- |
| **অ্যাডমিন** | `hospital_admin` | / (main dashboard) | /api/settings, /api/staff, /api/reports, /api/audit |
| **এমডি** | `md` | / (md dashboard) | /api/dashboard, /api/profit, /api/income, /api/expenses |
| **ডাক্তার** | `doctor` | /doctor | /api/patients, /api/prescriptions, /api/lab, /api/visits |
| **নার্স** | `nurse` | /nurse-station | /api/nurse-station, /api/vitals, /api/nursing |
| **রিসেপশনিস্ট** | `reception` | /reception | /api/patients, /api/appointments, /api/billing, /api/visits |
| **ফার্মাসিস্ট** | `pharmacist` | /pharmacy | /api/pharmacy, /api/pharmacy/medicines |
| **ল্যাব** | `laboratory` | /lab | /api/lab, /api/lab/orders, /api/lab/items |
| **অ্যাকাউন্ট্যান্ট** | `accountant` | /accountant | /api/income, /api/expenses, /api/journal |

---

## ২. রোল অনুযায়ী টেস্ট কেস

### ২.১ রিসেপশনিস্ট (Receptionist)
**লগইন:** `/h/demo-hospital/login` → Reception role → Dashboard | **API:** `/api/patients`, `/api/appointments`, `/api/billing`, `/api/admissions`

- [ ] নতুন পেশেন্ট রেজিস্ট্রেশন করো (নাম, ফোন, জন্মতারিখ, লিঙ্গ)
- [ ] ফোন নম্বর দিয়ে পেশেন্ট সার্চ করো
- [ ] ডাক্তারের জন্য অ্যাপয়েন্টমেন্ট বুকিং করো
- [ ] আজকের অ্যাপয়েন্টমেন্ট লিস্ট দেখো
- [ ] OPD পেশেন্টের জন্য বিল তৈরি করো
- [ ] ক্যাশ দিয়ে পেমেন্ট রেকর্ড করো
- [ ] কার্ড দিয়ে পেমেন্ট রেকর্ড করো
- [ ] Ward-A তে Bed #101 তে পেশেন্ট অ্যাডমিট করো
- [ ] বেড অকুপ্যান্সি স্ট্যাটাস দেখো
- [ ] রসিদ প্রিন্ট করো
- [ ] CBC ল্যাব টেস্ট অর্ডার করো
- [ ] নার্স স্টেশনে পেশেন্ট ট্রান্সফার করো

### ২.২ নার্স (Nurse)
**লগইন:** `/h/demo-hospital/login` → Nurse role → Nurse Station | **API:** `/api/nurse-station`, `/api/vitals`

- [ ] অ্যাডমিটেড পেশেন্টসহ ড্যাশবোর্ড দেখো
- [ ] পেশেন্ট vitals রেকর্ড করো (BP: 120/80, Temp: 98.6°F, HR: 72, SpO2: 98%)
- [ ] সময়ের সাথে vital trends দেখো
- [ ] নার্সিং প্রগ্রেস নোট যোগ করো
- [ ] মেডিকেশন দেওয়া রেকর্ড করো (MAR)
- [ ] ফ্লুইড input/output রেকর্ড করো
- [ ] পেশেন্ট অ্যাডমিশন ডিটেলস দেখো
- [ ] পেশেন্ট প্রেসক্রিপশন লিস্ট দেখো
- [ ] abnormal vitals এর জন্য alert চেক করো
- [ ] শিফট হ্যান্ডওভার নোটস লেখো

### ২.৩ ডাক্তার (Doctor)
**লগইন:** `/h/demo-hospital/login` → Doctor role → Doctor Dashboard | **API:** `/api/patients`, `/api/prescriptions`, `/api/lab`, `/api/doctors`

- [ ] আজকের অ্যাপয়েন্টমেন্টসহ ড্যাশবোর্ড দেখো
- [ ] পেশেন্টের সম্পূর্ণ হিস্ট্রি দেখো
- [ ] নতুন প্রেসক্রিপশন লেখো (মেডিকেশন, ডোজেজ)
- [ ] ল্যাব টেস্ট অর্ডার করো (CBC, Lipid Profile)
- [ ] ল্যাব রেজাল্ট দেখো
- [ ] ক্লিনিক্যাল নোটস যোগ করো
- [ ] provisional diagnosis আপডেট করো
- [ ] ডিসচার্জ সামারি লেখো
- [ ] টেলিমেডিসিন ভিডিও কল শুরু করো
- [ ] পেশেন্ট vitals ও নার্সিং নোটস দেখো
- [ ] স্পেশালিস্টে রেফারাল তৈরি করো

### ২.৪ হসপিটাল অ্যাডমিন
**লগইন:** `/h/demo-hospital/login` → Hospital Admin role → Dashboard | **API:** `/api/settings`, `/api/users`, `/api/staff`, `/api/reports`, `/api/audit`

- [ ] KPIs সহ হসপিটাল ড্যাশবোর্ড দেখো
- [ ] রিসেপশন রোলে নতুন ইউজার তৈরি করো
- [ ] নার্স রোলে নতুন ইউজার তৈরি করো
- [ ] ডাক্তার রোলে নতুন ইউজার তৈরি করো
- [ ] রোল পারমিশন মডিফাই করো
- [ ] হসপিটাল ডিটেলস কনফিগার করো (নাম, ঠিকানা, লোগো)
- [ ] অডিট লগ দেখো
- [ ] ডেইলি কালেকশন রিপোর্ট জেনারেট করো

---

## ৩. কোম্প্লিট পেশেন্ট ফ্লো (API সহ)

### ৩.১ OPD ভিজিট ফ্লো
1. রিসেপশন → `POST /api/patients` (রেজিস্ট্রেশন)
2. `POST /api/appointments` (অ্যাপয়েন্টমেন্ট বুকিং)
3. ডাক্তার → `GET /api/visits?date=today`
4. `POST /api/prescriptions` (প্রেসক্রিপশন)
5. `POST /api/billing` (বিল তৈরি)
6. `POST /api/income` (পেমেন্ট)
7. ফার্মেসি → `POST /api/pharmacy/dispense` (ডিসপেন্স)

### ৩.২ IPD অ্যাডমিশন ফ্লো
1. রিসেপশন → `POST /api/admissions` → বেড অ্যালোকেট
2. নার্স → `POST /api/nurse-station/vitals` → `POST /api/nursing`
3. ডাক্তার → `GET /api/patients/:id` → `POST /api/lab/orders` → `POST /api/prescriptions`
4. নার্স → `POST /api/nurse-station/vitals` (MAR)
5. ডাক্তার → `POST /api/discharge`
6. বিলিং → `POST /api/ip-billing` → `POST /api/income`
7. রিসেপশন → পেমেন্ট → Discharge complete

---

## ৪. স্যাম্পল টেস্ট ডেটা

**ইউজার ক্রেডেনশিয়াল:** সব পাসওয়ার্ড: `Demo@1234`
- Hospital: `demo-hospital`
- `admin@demo-hospital.com` (hospital_admin)
- `md@demo-hospital.com` (md)
- `doctor@demo-hospital.com` (doctor)
- `nurse@demo-hospital.com` (nurse)
- `reception@demo-hospital.com` (reception)
- `lab@demo-hospital.com` (laboratory)
- `pharmacy@demo-hospital.com` (pharmacist)
- `accounts@demo-hospital.com` (accountant)

**স্যাম্পল পেশেন্ট:**
- রহিম হাসান, পুরুষ, ৪৫ বছর, ফোন: ০১৭১০০০০০১
- ফাতেমা বেগম, মহিলা, ৩২ বছর, ফোন: ০১৭১০০০০০২

**স্যাম্পল সার্ভিস ও প্রাইস:**
- OPD কনসাল্টেশন: ৫০০ টাকা
- IPD বেড (জেনারেল): ১০০০ টাকা/রাত
- CBC টেস্ট: ৪০০ টাকা

---

## ৫. ফিন্যান্সিয়াল ক্যালকুলেশন ম্যাট্রিক্স

### ৫.১ বিলিং ফর্মুলা
```text
line_subtotal = unit_price × quantity
invoice_subtotal = sum(line_subtotal)
invoice_total = invoice_subtotal - invoice_discount + adjustment
due = invoice_total - paid - deposit_adjusted
```
- [ ] Discount কখনো subtotal-এর বেশি হবে না।
- [ ] Paid কখনো bill total-এর বেশি হবে না।
- [ ] Due কখনো negative হবে না।

### ৫.২ ডেইলি কালেকশন ফর্মুলা
```text
net_collection = CashSales - SalesReturn + DepositDeduct - ReturnDeposit + CollectionFromReceivable - CashDiscountGiven
```
- [ ] Cash payment করলে `payments`, `income`, এবং `emp_cash_transactions` তিন জায়গায় এন্ট্রি থাকবে।
- [ ] Credit note করলে income reverse এবং cash transaction SalesReturn হবে।

---

## ৬. প্রোডাকশন গো-লাইভ চেকলিস্ট

> [!IMPORTANT]
> **Go-live করার আগে এগুলো sign-off না হলে production hospital-এ দিবেন না**
> - [ ] Real hospital master data loaded: doctors, departments, service price list, lab catalog, medicines.
> - [ ] Doctor fee এবং commission rule লিখিতভাবে hospital authority approve করেছে।
> - [ ] Receipt, lab report, prescription printer templates real printer দিয়ে test করা হয়েছে।
> - [ ] All users individual account পেয়েছে; shared password বন্ধ।
> - [ ] Daily closing drill অন্তত ২ দিন real-like data দিয়ে মিলেছে।
> - [ ] SMS/live payment credentials production-এ verified।

---

## ৭. অটোমেশন কমান্ডস (Developer/QA)

```bash
pnpm test
pnpm build
pnpm test:e2e:prod
pnpm test:e2e:prod:auth
# Targeted financial tests
pnpm test test/integration/data-integrity/financial-accuracy.test.ts test/payments.test.ts test/integration/routes/reception-billing.test.ts
```

---

## ৮. লেটেস্ট ভেরিফিকেশন লগ (মে ৫, ২০২৬)

| চেক | স্ট্যাটাস | নোটস |
| :--- | :--- | :--- |
| Financial calculation tests | **PASS** | Targeted finance suite (20 files, 560 tests) passed. |
| Full unit/integration suite | **PASS** | 335 files, 10,551 tests passed. |
| Production smoke/E2E | **PASS** | Deployed version `0595258b`. Authenticated production checks passed. |
| Hospital UAT | **Risk** | Manual sign-off required for real printer and doctor commission policy. |

---

**Ozzyl HMS - Testing Guide** | সংস্করণ ২.০ | মে ২০২৬
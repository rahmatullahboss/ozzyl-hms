# অ্যাডমিন ড্যাশবোর্ড রিভিউ — মালিকপক্ষের সিদ্ধান্ত সারাংশ

**তারিখ:** ২২ জুলাই ২০২৬
**রিভিউ করা ভিত্তি:** clean local `main` commit `79b054a19`
**সিদ্ধান্ত:** বর্তমান dashboard বাতিল করে নতুন করে বানানো হবে না; existing calculation ও drilldown foundation রেখে dashboard-কে একটি পরিষ্কার **Hospital Admin Control Center**-এ রূপান্তর করা হবে।

## বর্তমান অবস্থার সত্যিকারের মূল্যায়ন

বর্তমান dashboard একেবারে shallow নয়। এতে ইতিমধ্যে:

- date-range filter,
- collection/expense/cash KPI,
- doctor ও test performance panel,
- income ও expense analysis,
- IPD finance reconciliation,
- action center,
- inventory/reagent/radiology monitoring,
- invoice drilldown,
- live cash drawer,
- audit feed

আছে। সমস্যা হলো এগুলো একই page-এ অতিরিক্ত পরিমাণে default হিসেবে চালু, এবং সব data একই সময় বা একই অর্থে দেখানো হচ্ছে এমন ধারণা তৈরি করে।

বর্তমান default configuration-এ **৪০টি KPI card এবং ৫টি বড় analytics panel** চালু। এর বাইরেও IPD, pending requests, chart, payment method, action panel, operations, live cash এবং audit widget আছে। ফলে data বেশি হলেও management-এর জন্য কোনটি সবচেয়ে জরুরি তা বোঝা কঠিন।

## সবচেয়ে বড় সমস্যা

### ১. একই page-এ ভিন্ন সময়ের data

Top filter পরিবর্তন করলে KPI, analytics এবং IPD-এর কিছু data পরিবর্তন হয়; কিন্তু revenue chart, payment method, operations, live cash, action center এবং audit feed নিজেদের today/current/latest data দেখায়। এগুলো আলাদা করে চিহ্নিত না থাকায় user মনে করতে পারে সবকিছু selected range অনুযায়ী চলছে।

### ২. Period, snapshot এবং live data মিশে আছে

উদাহরণ:

- Collection = selected period-এর flow
- Outstanding due = period end বা current balance
- Bed occupancy = current snapshot
- Drawer cash = live balance
- Pending approvals = current queue

কিন্তু card-এ এই পার্থক্য সবসময় স্পষ্ট নয়।

### ৩. Card অনেক, সিদ্ধান্ত কম

একটি card সাধারণত শুধু সংখ্যা দেখায়। কিন্তু management-এর দরকার:

- আগের সময়ের তুলনায় কত পরিবর্তন,
- ভালো না খারাপ,
- target বা threshold কত,
- data complete কি না,
- total detail-এর সঙ্গে মিলেছে কি না,
- এখন কী action নিতে হবে।

### ৪. Duplicate exception surface

Persistent Action Center থাকার পরও KPI component-এর মধ্যে আরেকটি frontend-based risk section আছে। সেখানে hardcodedভাবে due, discount এবং যেকোনো expense-কে risk ধরা হয়। Approved normal expense নিজে কোনো exception নয়।

### ৫. Zero এবং unavailable আলাদা নয়

কোনো secondary API fail করলে কিছু জায়গায় `0` দেখা যেতে পারে। Management dashboard-এ `0` মানে verified zero; data না আসলে `Unavailable`, `Partial data`, বা `Stale` দেখাতে হবে।

### ৬. “Uncategorized” normal category হিসেবে আছে

“Uncategorized Services” income card হিসেবে থাকলে system-এর mapping problem normal business income বলে মনে হয়। এটি exception হওয়া উচিত:

> Unmapped services — ৳X · Y transactions · Fix mapping

## নতুন dashboard-এর প্রধান structure

### ১. Global context bar

উপরে স্পষ্ট থাকবে:

- Today / Yesterday / This Month / Custom
- Payment date / Bill date / Service date
- Period activity / As-of snapshot / Live
- Asia/Dhaka timezone
- Last updated
- Data health: Balanced / Warning / Partial / Stale

### ২. Limited management summary

Default Hospital Admin view-তে প্রায় ৮–১০টি decision-grade signal থাকবে, যেমন:

- Cash received
- Net billed amount
- Approved expense paid
- New due created
- Outstanding due as of period end
- Drawer variance
- Critical exceptions
- Current bed occupancy

Doctor, test, inventory, reagent ও radiology detail separate workspace-এ থাকবে; overview-তে শুধু গুরুত্বপূর্ণ exception বা summary থাকবে।

### ৩. Financial reconciliation bridge

শুধু আলাদা আলাদা card না দেখিয়ে calculation bridge দেখানো হবে:

```text
Gross bill
− Discount
= Net bill

Cash collection
+ Non-cash collection
+ Deposit received
− Refund
− Expense paid
− Doctor payout
= Net cash movement

Expected drawer cash
− Handover / cash drop
= Available cash
± Variance
```

প্রতিটি line click করলে underlying transaction দেখা যাবে।

### ৪. একটি Action Center

একটি prioritized queue থাকবে:

- unbalanced closing,
- cash variance,
- unknown payment method,
- unmapped service,
- missing expense receipt,
- pending approval,
- high-aged due,
- cancellation/refund review,
- stock/QC exception।

### ৫. Summary থেকে evidence পর্যন্ত drilldown

```text
KPI
→ source/category
→ transaction/item
→ invoice/admission/settlement
→ audit history
```

## প্রথমে কী করতে হবে

প্রথম phase-এ design সাজানো নয়; নিচের trust foundation করতে হবে:

1. সব widget-এর temporal meaning নির্ধারণ।
2. Shared filter period-aware widget-এ propagate করা।
3. Live/current widget-এ স্পষ্ট badge দেওয়া।
4. API-তে generated time, source status, warning এবং reconciliation যোগ করা।
5. Default cards কমিয়ে role-based preset করা।
6. Duplicate risk section সরিয়ে Action Center একক source করা।
7. `0`, unavailable, partial এবং stale state আলাদা করা।
8. Uncategorized/unknown data-কে exception হিসেবে দেখানো।

## প্রত্যাশিত ফলাফল

পরিবর্তনের পর hospital admin এক screen থেকে স্পষ্টভাবে বুঝতে পারবে:

- কত bill হয়েছে,
- কত collection হয়েছে,
- cash ও non-cash কত,
- deposit আলাদা কত,
- expense ও payout কত,
- drawer-এ কত থাকার কথা,
- হিসাব balanced কি না,
- কোন data incomplete,
- কোন issue সবচেয়ে জরুরি,
- issue-এর transaction evidence কোথায়।

এটাই dashboard-কে “অনেক data আছে কিন্তু vague” অবস্থা থেকে “management decision নেওয়ার মতো বিশ্বাসযোগ্য control center”-এ নিয়ে যাবে।

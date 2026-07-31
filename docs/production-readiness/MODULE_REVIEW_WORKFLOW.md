# HMS Module Review Workflow

এই workflow প্রতিটি module-এর manual, technical এবং production review-এর জন্য ব্যবহার করতে হবে।

## ১. Review শুরু করার আগে

- ClickUp task খুলুন।
- Module ID ও tracker row মিলিয়ে নিন।
- Test tenant, test user ও test data প্রস্তুত করুন।
- Production data ব্যবহার করবেন না।
- Module-এর responsible hospital role ঠিক করুন।
- Review report-এর জন্য `MODULE_REVIEW_TEMPLATE.md` copy করুন।

## ২. Implementation inventory

প্রথমে যাচাই করুন module-এ বাস্তবে কী আছে:

- Backend routes/API
- Services/helpers
- Database tables ও migrations
- Frontend pages/components
- Permissions/roles
- Reports/prints/exports
- Notifications/integrations
- Existing automated tests
- Existing review documents

শুধু filename দেখে capability ধরে নেবেন না। Actual flow ও route mounting যাচাই করুন।

## ৩. Happy-path manual test

একটি বাস্তব hospital workflow শুরু থেকে শেষ পর্যন্ত চালান।

উদাহরণ:

- Reception: appointment → queue → visit
- Lab: order → billing → sample → result → verify → print
- Pharmacy: prescription → dispense → stock deduction → receipt
- Billing: bill → payment → counter → handover → accounting

প্রতিটি ধাপে লিখুন:

- Input
- Expected result
- Actual result
- Screenshot/video/log reference

## ৪. Negative ও edge-case test

প্রযোজ্য ক্ষেত্রে পরীক্ষা করুন:

- Required field missing
- Invalid value
- Duplicate submit
- Refresh/retry
- Cancel/reverse
- Expired/blocked item
- Insufficient stock
- Closed period/session
- Wrong patient/order/visit
- Unauthorized role
- Cross-tenant ID
- Provider/network failure

## ৫. Security ও privacy review

- Authorized role action করতে পারে কি না
- Unauthorized role 403/appropriate rejection পায় কি না
- Cross-tenant data দেখা বা পরিবর্তন করা যায় কি না
- Sensitive data log/cache/export/notification-এ leak হয় কি না
- File/download URL permission check করে কি না
- Audit actor, tenant, time ও action record করে কি না

## ৬. Data integrity ও concurrency review

বিশেষভাবে money, stock, bed, medication, lab result এবং accounting flow-এ:

- একই action retry করলে duplicate effect হয় কি না
- Concurrent request total নষ্ট করে কি না
- Partial failure visible repair state তৈরি করে কি না
- Source document ও ledger মিলছে কি না
- Cancellation/reversal original effect সঠিকভাবে ফেরত দেয় কি না

## ৭. Operational readiness

- Required configuration documented কি না
- Print/report layout usable কি না
- Backup/restore impact জানা আছে কি না
- Monitoring/alert আছে কি না
- Failure হলে staff কী করবে তার SOP আছে কি না
- Hospital role training লাগবে কি না
- External device/provider commissioning দরকার কি না

## ৮. Bug handling

প্রতিটি bug আলাদা ClickUp subtask/task হিসেবে লিখুন। অন্তত রাখুন:

- Clear title
- Environment
- User role
- Preconditions
- Steps to reproduce
- Expected result
- Actual result
- Severity
- Screenshot/video/log
- Related patient/order/bill/test ID — শুধুমাত্র test data
- Fix commit
- Retest result

### Severity rule

- `Critical`: patient safety, privacy, cross-tenant leak, incorrect money/stock/result/medication, unrecoverable data loss
- `High`: core workflow blocked বা major incorrect behavior
- `Medium`: workaround আছে, কিন্তু operational impact আছে
- `Low`: cosmetic, wording বা minor usability issue

Critical বা High bug open থাকলে module `PASS` করা যাবে না, accountable risk approval ছাড়া।

## ৯. Final verdict

শুধু এই চারটির একটি ব্যবহার করুন:

- `PASS`
- `PASS WITH ACCEPTED RISK`
- `FAIL`
- `N/A FOR THIS HOSPITAL`

### PASS-এর minimum evidence

- Required code/UI paths checked
- Automated test evidence recorded
- Manual E2E completed
- Critical negative/security scenarios passed
- Open Critical/High bug নেই
- Operational requirement documented
- Responsible reviewer sign-off আছে

## ১০. Tracker update

Review শেষে:

1. ClickUp task-এ final verdict লিখুন।
2. Evidence links দিন।
3. `HMS_PRODUCTION_READINESS_TRACKER.md`-এর module row update করুন।
4. Review log-এ date, module, status change ও reviewer লিখুন।
5. `CURRENT_NEXT_TASK.md`-এ পরবর্তী কাজ বসান।
6. Material code/schema/permission change হলে module পুনরায় `REVIEW PENDING` করুন।

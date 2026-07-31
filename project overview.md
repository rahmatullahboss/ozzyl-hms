# Project Overview & Enterprise Readiness Review

_Last reviewed: 2026-06-19_

## Executive Summary

This HMS has grown beyond a small hospital billing app. It is now a large healthcare ecosystem covering reception, billing, cash operations, lab, doctor workflows, IPD, pharmacy, admin/MD dashboards, accounting, HR, patient portal, local server deployment, and cloud sync.

Current repository scale observed during review:

```txt
Tenant route files: 274
React page files: 423
Test files: 1165
Migration files: 384
```

Overall verdict: the foundation is strong and feature-rich, but enterprise readiness now depends less on adding more modules and more on stabilization, auditability, financial reconciliation, permissions, and workflow polish.

## Highest-Priority Enterprise Goals

```txt
1. Lock financial source of truth.
2. Finalize cash drawer / shift / handover audit flow.
3. Complete lab report delivery lifecycle.
4. Polish doctor workflow for speed.
5. Clean Admin/MD monitoring dashboard into a control tower.
6. Clean root TypeScript errors.
7. Harden production configuration and deploy gates.
8. Enforce fine-grained permissions across all sensitive routes.
9. Verify local server/cloud sync reliability.
10. Restructure reports into a dedicated enterprise Reports Center.
```

## Architecture Review

### Strengths

- Cloudflare-native Worker architecture is already in place.
- D1, KV, R2, Durable Objects, Vectorize, and AI bindings are configured.
- Tenant middleware exists and resolves tenant by domain/header/query/local-server configuration.
- JWT authentication includes tenant cross-checking.
- RBAC and fine-grained permission utilities exist.
- Local server deployment and cloud sync workflow are documented.
- Production, staging, development, and local server environments are separated.

### Risks

- The system is becoming a large single Worker. This is manageable for now, but long-term modular split should be planned.
- Production configuration still contains placeholder/stub values that must not remain before real rollout.
- Some sensitive modules are protected by role checks but not yet consistently covered by fine-grained permission rules.

### Recommended Future Split

```txt
hms-api-worker        -> core tenant API
hms-jobs-worker       -> cron, reminders, async jobs
hms-sync-worker       -> local/cloud sync jobs
hms-public-worker     -> patient/public portal
hms-realtime-worker   -> dashboard realtime / websocket coordination
```

## Authentication, Tenant, and RBAC Review

### Strengths

- JWT tenant mismatch is blocked.
- Token blacklist uses KV and fails closed.
- Tenant lookup validates active/suspended state.
- RBAC middleware and permission resolution exist.
- Hospital admin and super admin have wildcard permission handling.

### Gaps

The current MVP route permission coverage is limited mainly to patients, visits, billing, lab, pharmacy, and prescriptions. Many enterprise routes still need explicit permission mapping.

### Recommended Permission Expansion

```txt
/api/reports/*          reports:read / reports:financial
/api/cash-operations/*  cash:read / cash:write / cash:approve
/api/expenses/*         expenses:read / expenses:write / expenses:approve
/api/commissions/*      commission:read / commission:write / commission:payout
/api/settings/*         settings:read / settings:write
/api/users/*            users:read / users:write / users:permission
/api/audit/*            audit:read
```

## Reception Workflow Review

Reception already has a strong base:

```txt
Patient search
OPD serial
Billing counter
Report delivery
Cash operations
Doctor status
Shift active indicator
Support/logout actions
```

The current reception UI should be split more clearly:

```txt
Daily Desk
OPD Serial
Billing Counter
Report Delivery
Cash Operations
Reports & Shift
Doctor Status
More / Advanced
```

Report Delivery should focus on lab report delivery only. Shift handover, daily collection, expenses, and doctor report should move into Reports & Shift or Cash Operations.

## Cash Operations Review

Current cash operations now include:

```txt
Doctor Payout
Petty Cash Expense
Cash Transfer
Bank Deposit
Close Shift
Receiver self-transfer block
Counter-to-counter transfer validation
Admin custody separation
Receiver acceptance behavior
```

### Enterprise Improvements Still Needed

```txt
1. Denomination breakdown.
2. Receiver PIN/signature.
3. Pending acceptance dashboard.
4. Bank deposit slip attachment.
5. Expense receipt attachment.
6. Cash variance approval workflow.
7. Immutable accepted transfer log.
8. Reversal entries instead of delete/edit.
9. Shift close snapshot saved permanently.
```

## Shift Handover Report Review

A new shift handover report API and frontend section were implemented. It covers:

```txt
OPD serial count
Doctor seen / patients seen
Doctor visit collection
Test orders / test items / test collection
Total received / cash received / due collection
Refund / discount
Doctor payout
Petty cash expense
Cash transfer out
Bank deposit
Accepted transfer in
Expected drawer cash
Counted cash
Variance
Payment method breakdown
Expense list
Cash transfer list
Report number / audit metadata
```

Frontend now has:

```txt
Shift Handover PDF section
Generate PDF button
Export CSV button
Cash reconciliation panel
Report metadata panel
Signature area for cashier, receiver, admin/accountant
```

### Next Step

The report is currently dynamic. Enterprise audit requires immutable snapshotting when shift is closed.

Recommended table:

```txt
shift_handover_reports
- id
- tenant_id
- session_id
- report_no
- snapshot_json
- generated_by
- generated_at
- finalized_at
- accepted_by
- accepted_at
- status
- report_hash
```

## Billing System Review

Billing is the core system. Important modules already exist:

```txt
billing
billingCounter
billingCancellation
billingHandover
billingReports
billVersions
creditNotes
deposits
settlements
payments
ipBilling
billingInsurance
```

### Main Risk

Financial values can come from multiple places:

```txt
payments
emp_cash_transactions
cash_drawer_movements
bills.paid / bills.due
accounting_posting_events / journal entries
```

This is practical during development, but enterprise audit requires a strict source-of-truth hierarchy.

### Recommended Hierarchy

```txt
Operational invoice source: bills + invoice_items
Payment source: payments
Cash custody source: cash_drawer_movements
Financial posting source: accounting_posting_events / journal entries
Report source: posted ledger + operational reconciliation
```

## Lab and Report Delivery Review

Lab modules are broad and promising:

```txt
lab
labWorkflow
labMachines
labMachineDowntime
labQc
labValidation
labBarcode
labNotifications
labMonitoring
labSettings
lab-results
```

Enterprise report delivery lifecycle should be:

```txt
Ordered
Sample Collected
Sample Received
Processing
Result Entered
Verified
Ready for Delivery
Due Cleared
Printed
Delivered
Reprinted
Corrected / Amended
```

### Missing / Next Features

```txt
1. Mark as Delivered.
2. Delivered by / delivered at.
3. Receiver name/mobile/signature optional.
4. Print count.
5. Reprint reason.
6. Due blocked delivery.
7. Amendment/correction log.
8. Lab TAT report.
```

## Doctor Module Review

Doctor-side foundation exists:

```txt
Doctor dashboard
Consultation notes
Digital prescription
Lab results
Doctor schedule
IPD round notes
Doctor payout/commission-related reporting
```

Doctor workflow must be extremely fast to win hospital adoption.

Recommended improvements:

```txt
1. One-click diagnosis/favorite templates.
2. Favorite medicines.
3. Favorite test panels.
4. Follow-up instruction templates.
5. Previous visit timeline.
6. Patient vitals/lab trend.
7. Quick print prescription.
8. Optional voice/dictation.
```

## Admin/MD Dashboard Review

Admin and MD dashboards should become the hospital control tower.

Required top-level view:

```txt
Today collection
Cash in drawer
Bank deposit pending
Counter-wise cash
Cashier-wise variance
Doctor payout pending
Expense pending
Discount approval pending
Refund/cancellation pending
Due receivable
Lab pending reports
OPD serial load
IPD occupancy
Pharmacy sales
Audit alerts
```

Recommended structure:

```txt
1. Financial Overview
2. Operations Overview
3. Clinical Overview
4. Cash & Audit Alerts
5. Pending Approvals
6. Department Performance
```

## Accounting and Finance Review

Accounting modules already exist:

```txt
accounting
accountingRecovery
accounts
cash-book
bank-book
journal
vouchers
costCenters
subLedgers
profit
inventoryAccounting
```

### Recommendation

Create centralized posting services so route handlers do not manually update multiple financial tables independently.

```txt
postPaymentReceived()
postRefund()
postDoctorPayout()
postExpense()
postBankDeposit()
postCashTransfer()
```

Each service should enforce idempotency, ledger consistency, and audit logging.

## Reports System Review

Reports are currently spread across many places:

```txt
dailyCollection
reports
billingReports
reportLab
reportPharmacy
ipdReports
shiftHandoverReport
NurseReportsPage
OTReports
DueAgingReport
```

Recommended API structure:

```txt
/api/reports/reception/daily
/api/reports/reception/shift-handover
/api/reports/billing/collection
/api/reports/billing/due-aging
/api/reports/lab/delivery
/api/reports/lab/tat
/api/reports/doctor/performance
/api/reports/pharmacy/sales
/api/reports/ipd/occupancy
/api/reports/audit/activity
```

Recommended frontend:

```txt
Reports Center
- Reception Reports
- Finance Reports
- Lab Reports
- Doctor Reports
- IPD Reports
- Pharmacy Reports
- Audit Reports
```

## Patient Portal Review

Patient portal should include:

```txt
Appointment booking
Bill/payment status
Lab report download
Prescription download
Medical history
Insurance info
Notification/SMS
Family member profiles
Consent management
```

Patient portal routes need special security review because patient data leakage risk is highest here.

## Local Server / Cloud Sync Review

The local server concept is strong:

```txt
Hospital LAN local server
Cloud sync
Docker compose
Tailscale target
Local migration scripts
Snapshot import/export
```

Must define clearly:

```txt
1. Local-generated ID strategy.
2. Outbox event idempotency.
3. Cloud acknowledgement.
4. Conflict policy.
5. Offline payment sync.
6. Lab machine local result sync.
7. Patient merge conflict handling.
8. Schema sync safety.
```

Cash/payment events must be immutable and duplicate-safe.

## Testing Review

Test volume is strong. Recently verified tests passed:

```txt
pnpm vitest run --config vitest.config.integration.ts test/integration/routes/shift-handover-report.test.ts
pnpm vitest run --config vitest.config.integration.ts test/integration/routes/shift-handover-report.test.ts test/integration/routes/cash-operations.test.ts
pnpm exec vitest run src/pages/ReceptionReportsPage.test.ts
pnpm exec tsc --noEmit   # from web folder
```

Root TypeScript currently has unrelated existing errors. This is a production readiness blocker.

Known areas with existing type errors from root check:

```txt
patients.ts
queue.ts
patientPortal.ts
accountingRecovery.ts
approvals.ts
doctorCertificates.ts
doctors.ts
```

## Database and Migration Review

There are 384 migrations. This is mature but carries drift risk.

Required checks:

```txt
1. Fresh install schema test.
2. Migration drift check.
3. Production migration checklist.
4. Local server migration smoke test.
5. Destructive migration approval process.
6. Schema snapshot versioning.
```

## UI/UX Review

Current UI is modern, but some pages are too dense. The Report Delivery page currently mixes:

```txt
Lab report delivery
Shift handover
Daily collection
Expense entry
Doctor report
Transaction table
Due bills
```

Recommended split:

```txt
Report Delivery page:
- Invoice lookup
- Ready reports
- Delivered reports
- Pending due reports

Reception Reports page:
- Shift handover PDF
- My daily collection
- Doctor collection
- Test collection
- Expense/cash out
```

## Security and Compliance Review

### Strengths

```txt
Tenant validation
JWT tenant mismatch block
RBAC exists
Audit middleware exists
Token blacklist fail-closed
```

### Needs Work

```txt
1. Fine-grained permission for all financial report routes.
2. Audit log for print/reprint/delivery.
3. Patient portal access audit.
4. Sensitive logs redaction review.
5. Report snapshot immutability.
6. Export CSV/PDF permission checks.
7. Admin impersonation visible marking.
8. R2 signed URL expiry review.
```

## Priority Roadmap

### P0 — Production Blockers

```txt
1. Root TypeScript errors clean.
2. Production placeholder vars remove.
3. All cash/payment reports reconcile from one source.
4. Fine-grained permission for reports/cash/expenses.
5. Shift handover snapshot table.
6. Lab report delivered/reprint audit.
7. Full billing/payment idempotency audit.
```

### P1 — Hospital Adoption Blockers

```txt
1. Reception workflow polish.
2. Doctor prescription speed.
3. Admin control tower dashboard.
4. Daily/shift PDF polish.
5. Due collection workflow.
6. Lab delivery lifecycle complete.
7. Cash variance approval.
```

### P2 — Enterprise Scale

```txt
1. Split jobs worker.
2. Async report generation for large data.
3. Local/cloud sync conflict dashboard.
4. Department-wise KPI.
5. Advanced audit search.
6. Role template builder.
7. BI/export center.
```

## 7-Day Stabilization Plan

```txt
Day 1-2: Root TypeScript errors clean.
Day 3: Shift handover snapshot table + final report lock.
Day 4: Lab report delivered/reprint audit.
Day 5: Reports page split + UI cleanup.
Day 6: Cash variance approval + denomination breakdown.
Day 7: Admin/MD control tower dashboard review.
```

## Implementation Update — 2026-06-19

The shift handover report gap identified in this review has been partially fixed.

Implemented:

```txt
1. Immutable shift handover snapshot table migration: migrations/0365_shift_handover_reports.sql
2. Fresh tenant schema support in tenant-schema.sql
3. Finalize API: POST /api/reports/shift-handover/sessions/:sessionId/finalize
4. GET /api/reports/shift-handover?sessionId=... now returns finalized snapshot when one exists
5. Browser PDF generation now finalizes/saves the snapshot before opening print
6. Snapshot SHA-256 hash is stored for audit verification
7. Existing production bug fixed: report now reads closing_cash_declared / expected_cash / variance instead of non-existent counted_cash / variance_amount columns
```

Remaining next steps:

```txt
1. Add receiver acceptance endpoint for shift_handover_reports.
2. Add report history/list page for finalized handover reports.
3. Add server-side PDF archive to R2 if hard-copy/PDF retention is required.
4. Bind finalization directly into Close Shift flow after counted cash and variance approval.
```

## Final Recommendation

The system is already feature-rich. The next phase should focus on stabilization and trust: billing, cash, accounting, and reports must reconcile perfectly. If these four areas are accurate and auditable, hospital owners/admins will trust the system. New modules should be deprioritized until these foundations are locked.

# HMS Production Readiness Task Catalog

**Worker command format:** Tell one separate worker agent only the task ID and an execution verb, for example `W1-03 করো`. The worker follows `AGENT_TASK_EXECUTION_PROTOCOL.md`, commits a verified isolated branch, and stops at handoff without changing local `main`.

**Integration command format:** After worker handoff, tell one integration agent `W1-03 integrate করো`. Wave-level verification uses `W1 verify করো`. See `MANUAL_MULTI_AGENT_RUNBOOK.md` for manual parallel/serial scheduling.

The detailed code surface must be discovered from the current repository; the scope and completion gates below are mandatory.

## Status vocabulary

- `NOT STARTED`
- `IN PROGRESS`
- `BLOCKED`
- `REVIEW PENDING`
- `READY FOR INTEGRATION`
- `INTEGRATING`
- `PASS`
- `PASS WITH ACCEPTED RISK`
- `FAIL`
- `N/A FOR THIS HOSPITAL`

## Common acceptance gates for every task

Every task must satisfy the applicable parts of `MODULE_REVIEW_WORKFLOW.md`:

- Implementation inventory completed.
- Happy-path workflow verified.
- Invalid, duplicate, retry, cancellation, reversal, and boundary cases verified.
- Authorized, unauthorized, revoked, and cross-tenant behavior tested.
- Integrity, idempotency, concurrency, audit, and reconciliation checked.
- Operational configuration, monitoring, print/export, downtime, and recovery reviewed.
- Confirmed defects reproduced, fixed, tested, reviewed, and retested.
- Run report completed under `docs/production-readiness/runs/`.
- Fresh verification recorded against the final commit.
- Verified branch merged into local `main`.

---

# Wave 0 — Release Foundation

Wave 0 must pass before normal modules can be approved for broad production use.

## W0-01 — Platform, Tenant, Authentication, Session & MFA

**Branch slug:** `auth-session`  
**ClickUp:** https://app.clickup.com/t/86ey8p3dg  
**Modules:** M01, parts of M02/M35  
**Can run in parallel with:** W0-03; audit-only portions of W0-04/W0-05  
**Avoid simultaneous shared-file edits with:** W0-02

### Scope

- Staff and applicable patient/admin login paths
- Logout, refresh, rotation, expiry, revocation, deactivation, and password-change effects
- Tenant routing and tenant-bound identity/session behavior
- MFA enrollment, challenge, recovery, replay protection, and privileged-role policy
- Cookie, CSRF, token storage, rate limiting, lockout, and authentication audit

### Completion gates

- Disabled, deactivated, password-reset, or revoked users cannot keep usable sessions.
- Refresh and session identifiers cannot cross tenants.
- MFA cannot be bypassed, replayed, or recovered without controlled evidence.
- Authentication errors do not leak account or tenant information.
- Focused auth/session/MFA tests, security tests, typecheck, and production build pass.

---

## W0-02 — RBAC, Clinical Write Permission, Approval & Audit

**Branch slug:** `rbac-approval-audit`  
**ClickUp:** https://app.clickup.com/t/86ey8p3ef  
**Modules:** M02, M06 and permission portions of all modules  
**Dependency:** Rebase after W0-01 when shared auth/session files are involved

### Scope

- Permission catalog and route-level enforcement
- Clinical and financial mutation authorization
- Approval segregation, privileged actions, break-glass, and emergency access
- Permission revocation and legacy-role compatibility
- Audit integrity, actor, tenant, timestamp, reason, and before/after evidence
- Hospital role matrix and manual role sign-off

### Completion gates

- Every sensitive write has explicit permission enforcement and negative tests.
- Non-clinical roles cannot mutate clinical data; unauthorized roles cannot approve their own protected actions.
- Cross-tenant reads/writes and guessed identifiers are rejected.
- Audit events are complete, attributable, tenant-bound, and resistant to normal-user alteration.
- Clinical permission sub-gate evidence is preserved and remaining approval/audit/manual gates pass.

---

## W0-03 — Hospital Setup, Master Data, Branch & Settings

**Branch slug:** `hospital-bootstrap`  
**ClickUp:** https://app.clickup.com/t/86ey8p3fp  
**Modules:** M03  
**Can run in parallel with:** W0-01

### Scope

- Clean tenant/hospital creation
- Branches, departments, counters, wards, beds, rooms, service catalogs, units, taxes, roles, and required master data
- Default settings, print templates, numbering, localization, and configuration portability
- First-login/setup flow and required seed/bootstrap behavior

### Completion gates

- A clean environment can create and configure a usable hospital without hidden manual database repair.
- Required masters exist exactly once and retries are idempotent.
- Branch/department boundaries and access are correct.
- Configuration and print settings survive restart/export/import as designed.
- Clean bootstrap and first operational login pass on a fresh database.

---

## W0-04 — Deployment, Migration, CI/CD & Custom-Domain Smoke

**Branch slug:** `release-deployment`  
**ClickUp:** https://app.clickup.com/t/86ey8p3j9  
**Modules:** M35  
**Dependency:** Final verification requires W0-03 clean bootstrap

### Scope

- Migration ordering, repeatability, compatibility, and clean install
- CI quality gates, package scripts, environment selection, and release evidence
- Production-domain-driven E2E and smoke commands
- Health, login, tenant routing, API, web, admin, static asset, and error-path smoke tests
- Observability, rollback, and release/commit traceability

### Completion gates

- No production verification command silently targets a `workers.dev` or wrong environment when the custom domain is required.
- Fresh migrations apply in order to a clean test database and no required migration is pending.
- Focused tests, full required suite, typecheck, and production build are tied to one commit SHA.
- Custom-domain smoke passes for all applicable applications and APIs.
- Rollback/release instructions and observable failure signals exist.

---

## W0-05 — Backup/Restore, Local/Offline & Incident Drill

**Branch slug:** `backup-restore`  
**ClickUp:** https://app.clickup.com/t/86ey8p3kf  
**Modules:** M34 and operational part of M35  
**Dependency:** Final restore drill requires W0-03 representative dataset

### Scope

- Cloud and applicable local-server backup/restore
- Restore integrity, permissions, files, stock, cash, accounting, and clinical reconciliation
- Incident response, alert delivery, ownership, escalation, and rollback
- Local/offline sync, reconnect, conflict, outbox, idempotency, and custody when included in hospital scope

### Completion gates

- A representative dataset restores into a controlled environment and reconciles expected totals and records.
- Recovery procedures do not expose secrets or patient data.
- Incident owners, alert path, severity, communication, and rollback are executable.
- Local/offline mode is either tested and approved or explicitly `N/A FOR THIS HOSPITAL` and disabled.
- Backup and restore evidence includes timestamps, commit/environment, checks, and accountable sign-off.

---

# Wave 1 — First Patient and Revenue Journey

## W1-01 — Patient Registration, UHID, MPI, Duplicate & Merge

**Branch slug:** `patient-registration-mpi`  
**ClickUp:** https://app.clickup.com/t/86ey8p3m9  
**Modules:** M04  
**Dependency:** Wave 0 foundation

### Completion gates

- New, returning, no-mobile, partial-demographic, and emergency registration work.
- UHID/identity generation is tenant-safe and duplicate-safe.
- Duplicate detection, controlled merge, undo/correction policy, and audit are verified.
- Portal/global identity links cannot expose or merge the wrong patient.

---

## W1-02 — Reception, Appointment, Schedule, Queue & Visit

**Branch slug:** `reception-visit`  
**ClickUp:** https://app.clickup.com/t/86ey8p3ng  
**Modules:** M05  
**Dependency:** W1-01

### Completion gates

- Appointment, walk-in, reschedule, cancellation, no-show, queue, and visit creation work.
- Provider schedule/availability and branch restrictions are enforced.
- Duplicate submit and retry do not create duplicate visits or charges.
- Appointment-to-visit-to-bill linkage reconciles.

---

## W1-03 — Doctor OPD, Clinical, Vitals, Diagnosis & Notes

**Branch slug:** `doctor-clinical`  
**ClickUp:** https://app.clickup.com/t/86ey8p3p6  
**Modules:** M06  
**Dependency:** W0-02 and W1-02

### Completion gates

- Consultation, history, vitals, allergies, diagnosis, notes, assessment, and care-plan workflow works.
- Version, correction, ownership, signing, and print behavior are traceable.
- Unauthorized and cross-tenant writes are rejected.
- Critical clinical data cannot be silently overwritten or lost on retry/concurrent edits.

---

## W1-04 — Prescription, ePrescribing & Medication Safety

**Branch slug:** `prescription-safety`  
**ClickUp:** https://app.clickup.com/t/86ey8p3q4  
**Modules:** M07  
**Dependency:** W1-03

### Completion gates

- Prescribe, edit, discontinue, reconcile, print, and fulfilment handoff work.
- Dose, route, frequency, duration, allergy/interaction/duplicate warnings, and override reasons are governed.
- Only authorized roles can prescribe or override safety controls.
- Prescription versions remain linked to the correct patient, encounter, doctor, formulary, and tenant.

---

## W1-05 — Billing, Payment, Deposit, Discount & Refund

**Branch slug:** `billing-payment`  
**ClickUp:** https://app.clickup.com/t/86ey8p3qm  
**Modules:** M17  
**Dependency:** W1-02; integrate with W1-04 where applicable

### Completion gates

- Bill, due, deposit, payment, partial payment, discount, cancellation, refund, and settlement work.
- Duplicate/retried payment cannot double-charge or double-post.
- Approval and segregation rules are enforced.
- Invoice, receipt, source document, cash, and accounting totals reconcile.

---

## W1-06 — Cash Drawer, Shift, Handover & Variance

**Branch slug:** `cash-shift`  
**ClickUp:** https://app.clickup.com/t/86ey8p3re  
**Modules:** M18  
**Dependency:** W1-05

### Completion gates

- Counter opening, collections, expense/adjustment policy, closing, handover, and reopen/reversal work.
- Short/excess variance requires reason and approval.
- Closed shifts reject unauthorized posting.
- Cash totals reconcile to receipts, payment methods, billing, and ledger postings.

---

# Wave 2 — Diagnostics, Medicine, Stock & Books

## W2-01 — Laboratory/LIS End-to-End

**Branch slug:** `laboratory-lis`  
**ClickUp:** https://app.clickup.com/t/86ey8p3te  
**Modules:** M12

### Completion gates

- Order, billing, accession/sample, collection, rejection/recollection, result, validation, correction, print, and delivery work.
- Critical/abnormal values, reference ranges, units, verifier identity, and audit are correct.
- Result release and correction are permissioned and versioned.
- Billing, patient/visit, sample, report, and dashboard states reconcile.

---

## W2-02 — Analyzer, ASTM/HL7, Mapping, QC & Downtime

**Branch slug:** `analyzer-integration`  
**ClickUp:** https://app.clickup.com/t/86ey8p3tw  
**Modules:** M13  
**Dependency:** W2-01

### Completion gates

- Device-specific message parsing, mapping, unmatched queue, duplicate/reprocess, and acknowledgement work.
- QC lockout, analyzer status, downtime/fallback, and reconciliation are safe.
- Wrong patient/sample/result matching is prevented.
- Device failure and malformed messages are visible, recoverable, and audited.

---

## W2-03 — Reagent & Consumption QA

**Branch slug:** `reagent-consumption`  
**ClickUp:** https://app.clickup.com/t/86ey8p3uv  
**Modules:** M14  
**Existing manual QA list:** https://app.clickup.com/90182866612/v/l/li/901819451364

### Completion gates

- Reagent master, lot/batch, stock-in, adjustment, expiry, consumption, reversal, and reconciliation work.
- Test-driven automatic consumption and manual consumption cannot double-deduct.
- Negative stock, duplicate submit, concurrent consumption, and stale balance are prevented.
- Manual ClickUp QA sequence is executed and evidence is attached.

---

## W2-04 — Pharmacy, Dispensary, Stock, Sales & Returns

**Branch slug:** `pharmacy-dispensary`  
**ClickUp:** https://app.clickup.com/t/86ey8p3vg  
**Modules:** M21

### Completion gates

- Purchase/GRN, batch/expiry, prescription dispense, counter sale, return, cancellation, and controlled-drug workflow work.
- FEFO/expiry, quantity, price, discount, tax, and receipt behavior are correct.
- Dispense/sale retries do not duplicate stock or money effects.
- Prescription, pharmacy stock, billing, cash, and accounting reconcile.

---

## W2-05 — Inventory, Procurement, Stores, Assets & Ward Supply

**Branch slug:** `inventory-procurement`  
**ClickUp:** https://app.clickup.com/t/86ey8p3wj  
**Modules:** M22, M23, M24

### Completion gates

- Requisition, approval, purchase order, receipt, transfer, issue, return, count, adjustment, write-off, and ward supply work.
- Stock movement is atomic, idempotent, tenant/branch/store-bound, and auditable.
- Asset allocation, maintenance, depreciation, insurance/contract decisions, and accounting links are reviewed.
- Physical and system stock reconcile with controlled variance handling.

---

## W2-06 — Accounting, Ledger, P&L & Reconciliation

**Branch slug:** `accounting-ledger`  
**ClickUp:** https://app.clickup.com/t/86ey8p3x9  
**Modules:** M19  
**Dependency:** W1-05/W1-06 and applicable W2 source modules

### Completion gates

- Chart of accounts, journal, subledger, source posting, reversal, period close, opening balance, and P&L work.
- Source document-to-ledger traceability is complete.
- Duplicate source events cannot double-post.
- Billing, cash, pharmacy/inventory, payroll/claims where included, and financial reports reconcile.

---

# Wave 3 — Inpatient and Advanced Care

## W3-01 — Admission, IPD, Bed, Transfer & Discharge

**Branch slug:** `ipd-admission`  
**ClickUp:** https://app.clickup.com/t/86ey8p3xy  
**Modules:** M09

### Completion gates

- Admission, bed allocation, transfer, leave, running bill, discharge, cancellation, and readmission work.
- Concurrent allocation cannot double-assign a bed.
- Patient, bed, ward, charge, deposit, bill, and discharge states reconcile.
- Unauthorized transfer/discharge and cross-tenant identifiers are rejected.

---

## W3-02 — Nursing, MAR, I/O, Handover & Ward

**Branch slug:** `nursing-ward`  
**ClickUp:** https://app.clickup.com/t/86ey8p3za  
**Modules:** M10  
**Dependency:** W3-01

### Completion gates

- Nursing assessment, vitals, medication administration, I/O, orders, task list, and handover work.
- MAR prevents wrong-patient/wrong-order/duplicate administration and records exceptions.
- Shift handover preserves outstanding care items and audit ownership.
- Nursing permissions and doctor-order boundaries are enforced.

---

## W3-03 — Operation Theatre, Procedures & CSSD

**Branch slug:** `ot-cssd`  
**ClickUp:** https://app.clickup.com/t/86ey8p405  
**Modules:** M11

### Completion gates

- Scheduling, consent, pre-op checklist, procedure status, anesthesia/notes, team, consumables, implants, and post-op workflow work.
- CSSD instrument/sterilization traceability and release controls work.
- Procedure status changes are authorized, ordered, and audited.
- Billing, stock, clinical record, and sterilization evidence reconcile.

---

## W3-04 — Radiology, RIS, PACS/DICOM & Procedure Safety

**Branch slug:** `radiology-pacs`  
**ClickUp:** https://app.clickup.com/t/86ey8p40z  
**Modules:** M15, M16

### Completion gates

- Order, scheduling, safety checklist, study matching, report, correction, validation, and delivery work.
- PACS/DICOM connectivity, viewer access, identity matching, and downtime are commissioned when included.
- Cross-patient study/report matching is prevented.
- Report, study, billing, patient/visit, and audit data reconcile.

---

# Wave 4 — Workforce, Portal, Insurance & Support

## W4-01 — HR, Attendance, Leave, Roster & Payroll

**Branch slug:** `hr-payroll`  
**ClickUp:** https://app.clickup.com/t/86ey8p41y  
**Modules:** M25

### Completion gates

- Staff master, attendance, biometric/import, leave, roster, salary/payroll, payslip, and approval work.
- Duplicate attendance/payroll and closed-period modification are controlled.
- Payroll posting reconciles to staff, bank/cash, deductions, and accounting when included.
- Sensitive HR/payroll data is least-privilege and audited.

---

## W4-02 — Insurance, Claim, Prior Authorization & Scheme

**Branch slug:** `insurance-claims`  
**ClickUp:** https://app.clickup.com/t/86ey8p42n  
**Modules:** M20

### Completion gates

- Eligibility, scheme/limit, authorization, claim creation, submission, denial, rework, settlement, and patient balance work.
- Duplicate claim and over-limit behavior are prevented.
- Claim, invoice, receivable, settlement, patient due, and accounting reconcile.
- Excluded insurance scope is disabled and documented.

---

## W4-03 — MRD, Documents, MLC, Birth/Death & Retention

**Branch slug:** `medical-records`  
**ClickUp:** https://app.clickup.com/t/86ey8p43b  
**Modules:** M26

### Completion gates

- Chart completion, archive, retrieval, document upload/download, legal record, MLC, and birth/death workflow work.
- Retention, deletion, legal hold, correction, and disclosure are governed.
- Sensitive files require tenant- and role-bound access.
- Record completeness and medico-legal audit are demonstrable.

---

## W4-04 — Portal, PHR, Consent, Identity Proof & Global Health

**Branch slug:** `patient-portal`  
**ClickUp:** https://app.clickup.com/t/86ey8p43r  
**Modules:** M27

### Completion gates

- Patient login/identity proof, records, reports, appointments, links, consent, correction, and revocation work.
- A patient cannot access another patient's data through guessed IDs/URLs or stale links.
- Consent is versioned by purpose and withdrawal effects are clear.
- Portal, hospital record, global identity/link, and audit states reconcile.

---

## W4-05 — Notifications, SMS, Email, WhatsApp, Push & Reminder

**Branch slug:** `notifications`  
**ClickUp:** https://app.clickup.com/t/86ey8p44h  
**Modules:** M28

### Completion gates

- Real configured providers, templates, preferences/consent, retries, receipts, failure alerts, and queue/cron behavior are verified.
- Sensitive content is minimized and sent only to verified destinations.
- Duplicate reminders and silent failures are controlled.
- Provider outage is observable and recoverable.

---

## W4-06 — Specialty Clinical & Hospital Support Scope

**Branch slug:** `specialty-support`  
**ClickUp:** https://app.clickup.com/t/86ey8p45j  
**Modules:** M31, M32

### Completion gates

- Blood bank, maternity, vaccination, dental, eye, psychiatry, housekeeping, laundry, kitchen, waste, mortuary, and other included specialties are explicitly scoped.
- Included modules receive domain-owner safety and workflow validation.
- Excluded modules are disabled or clearly marked `N/A FOR THIS HOSPITAL`.
- Infection-control, traceability, and exception workflows are reviewed where applicable.

---

## W4-07 — Telemedicine, Referral, Marketplace & Public Website

**Branch slug:** `telemedicine-referral`  
**ClickUp:** https://app.clickup.com/t/86ey8p46c  
**Modules:** M30

### Completion gates

- Included booking, referral, provider listing, payment, video/link, consent, and failure paths work.
- Privacy and identity boundaries are enforced.
- Payment/booking retries are idempotent.
- Excluded capabilities are disabled and documented.

---

# Wave 5 — Analytics, Interoperability & AI

## W5-01 — Dashboard, KPI, Reports, Analytics & Export

**Branch slug:** `dashboard-analytics`  
**ClickUp:** https://app.clickup.com/t/86ey8p47e  
**Modules:** M29

### Completion gates

- KPI definitions, source queries, time zones, filters, drill-down, timestamps, print/export, and role visibility are correct.
- Dashboard totals reconcile to source transactions and ledgers.
- Exports enforce privacy, tenant, branch, and role boundaries.
- Stale/incomplete data is visibly identified.

---

## W5-02 — FHIR, C-CDA, Bulk Export & External Integration

**Branch slug:** `interoperability`  
**ClickUp:** https://app.clickup.com/t/86ey8p48c  
**Modules:** M33

### Completion gates

- Resource mapping, validation, pagination, authorization, audit, rate limits, and error behavior are verified.
- Export scope and patient/tenant consent are enforced.
- Conformance tests and representative external-client tests pass.
- Bulk export cannot leak another tenant's or patient's data.

---

## W5-03 — AI Assistant, Prediction, Safety & Governance

**Branch slug:** `ai-governance`  
**ClickUp:** https://app.clickup.com/t/86ey8p48w  
**Modules:** M36

### Completion gates

- Prompt/model/output-schema versions are recorded.
- Role, tenant, patient, and purpose authorization is enforced before retrieval/action.
- Safety classes, human review, override, audit, cost, latency, and failure behavior are measurable.
- AI is not presented as an autonomous medical decision-maker.
- Operational data is not treated as training data without separate explicit rights and consent.

---

# Final Gates

## FINAL-01 — Integrated Hospital Go-Live Simulation

**Branch slug:** `go-live-simulation`  
**ClickUp:** https://app.clickup.com/t/86ey8p49u  
**Dependency:** Included hospital-scope module tasks and all Wave 0 gates

### Completion gates

Execute one representative non-production hospital journey:

1. Hospital/branch/setup and roles
2. Patient registration and duplicate check
3. Appointment/queue/visit
4. Consultation, vitals, diagnosis, and prescription
5. Lab and/or radiology order through report
6. Pharmacy dispense and stock deduction
7. Billing/payment/deposit/due/refund as applicable
8. Cash closing and handover
9. Inventory/reagent movement and reconciliation
10. Accounting and management dashboard reconciliation
11. Portal/report delivery with consent/access controls
12. Backup, simulated failure, restore, and verification
13. End-to-end audit trace

Include at least one cancellation/reversal, retry/idempotency case, unauthorized-role attempt, cross-tenant attempt, and provider/network failure.

---

## FINAL-02 — Production Readiness Sign-off & Release Decision

**Branch slug:** `release-signoff`  
**ClickUp:** https://app.clickup.com/t/86ey8p4ab  
**Dependency:** FINAL-01

### Completion gates

- Engineering, QA, clinical, lab, pharmacy, finance, operations, privacy/security, and backup/incident owners sign applicable evidence.
- No unaccepted P0/Critical/High defect remains.
- Hospital-specific scope, roles, training, SOP, downtime, provider/device commissioning, and rollback are complete.
- Release commit and environment are immutable in the evidence pack.
- Decision is explicitly `GO`, `CONDITIONAL GO`, or `NO-GO` with accountable approvers.

---

## FUTURE-01 — AgentOS & AI Foundry Readiness Gate

**Branch slug:** `agentos-foundry-gate`  
**ClickUp:** https://app.clickup.com/t/86ey8p4at  
**Modules:** M37, M38  
**Dependency:** Stable Core HMS production gates and real controlled-hospital evidence

### Completion gates

- Agent control plane, policies, tools, approvals, rollback, and outcome ledger have an approved architecture.
- Data rights, purpose-specific consent, de-identification, expert QA, provenance, dataset versions, data cards, and export approvals are designed and reviewed.
- Evaluation suites, hidden benchmarks, failure taxonomy, and regression comparison are defined.
- Legal, privacy, clinical-governance, security, residency, and commercial-use reviews are complete.
- No operational hospital data becomes training data automatically.

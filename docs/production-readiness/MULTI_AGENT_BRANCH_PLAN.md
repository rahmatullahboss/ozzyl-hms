# HMS Multi-Agent Branch Execution Plan

**Updated:** 2026-07-12  
**Current phase:** Wave 0 — Release Foundation

> **Authoritative execution rules:** `MANUAL_MULTI_AGENT_RUNBOOK.md`, `AGENT_TASK_EXECUTION_PROTOCOL.md`, `TASK_CATALOG.md`, and root `agents.md`. This environment has no sub-agent assumption: the owner manually assigns one task per worker. Workers stop on a verified branch; a separately instructed integration agent merges one task at a time through the shared merge lock.

## W0-01 নম্বরের অর্থ

`W0-01` মানে:

- `W0` = Wave 0
- `01` = Wave 0-এর ১ নম্বর engineering review task

Task title: **Platform, Tenant, Authentication, Session & MFA Review**  
ClickUp: https://app.clickup.com/t/86ey8p3dg

Master Control ও pilot-scope management action আলাদা coordination কাজ। Engineering task numbering অনুযায়ী W0-01 প্রথম কাজ।

---

## Wave 0-এর সম্পূর্ণ কাজ

| Order | Task | ClickUp | Main dependency |
|---|---|---|---|
| 1 | W0-01 — Platform, Tenant, Authentication, Session & MFA | https://app.clickup.com/t/86ey8p3dg | Clean base branch |
| 2 | W0-02 — RBAC, Clinical Write Permission, Approval & Audit | https://app.clickup.com/t/86ey8p3ef | Clinical permission sub-gate passed; remaining approval/audit must avoid W0-01 file conflicts |
| 3 | W0-03 — Hospital Setup, Master Data, Branch & Settings | https://app.clickup.com/t/86ey8p3fp | Clean test tenant/environment |
| 4 | W0-04 — Deployment, Migration, CI/CD & Custom-Domain Smoke | https://app.clickup.com/t/86ey8p3j9 | Final verification depends on W0-03 bootstrap |
| 5 | W0-05 — Backup/Restore, Local/Offline & Incident Drill | https://app.clickup.com/t/86ey8p3kf | Final restore drill depends on W0-03 dataset/bootstrap |

---

## গুরুত্বপূর্ণ live-workspace warning

এই document-এর branch/commit তথ্যকে live ownership source ধরে নেবেন না। প্রতিটি worker assign করার আগে current branches, worktrees, recent commits, `TASK_STATUS.md`, এবং `runs/<TASK-ID>.md` আবার যাচাই করুন।

একই task বা একই root checkout-এ দ্বিতীয় worker চালাবেন না। প্রতিটি worker-কে latest dependency-complete local `main` থেকে আলাদা worktree/branch দিন। `src/index.ts`, central auth/session middleware, permission catalogs, migration registry, package/lock files, deployment config এবং master readiness docs-এর ownership overlap হলে parallel work বন্ধ করে serial করুন।

---

## Recommended agent ভাগ

### Agent A — W0-01 Auth & Session

**Branch:** `task/w0-01-auth-session`
**Owns:** authentication, session lifecycle, refresh/logout, tenant login isolation, MFA, related tests  
**Temporary shared-file owner:** `src/index.ts`

**Must not touch:** hospital master data, deployment scripts, backup runbooks unless unavoidable.

### Agent B — W0-03 Hospital Bootstrap

**Branch:** `task/w0-03-hospital-bootstrap`
**Owns:** hospital/branch setup, departments, master data, seed/bootstrap, clean-tenant tests, settings portability.

**Must not touch:** auth/session middleware or production-domain scripts.

### Agent C — W0-04 Release & Deployment

**Branch:** `task/w0-04-release-deployment`
**Owns:** migrations execution verification, CI/CD, package scripts, environment-driven production E2E, custom-domain smoke, release evidence template.

**Start gate:** W0-03 local `main`-এ integrate হওয়ার পরে worker শুরু করুন, যাতে clean-bootstrap, migrations এবং smoke evidence একই dependency-complete base থেকে আসে.

### Agent D — W0-05 Backup & Incident

**Branch:** `task/w0-05-backup-restore`
**Owns:** backup/restore runbook, restore verification, data reconciliation checks, incident drill, local/offline scope decision.

**Start gate:** W0-03 local `main`-এ integrate হওয়ার পরে worker শুরু করুন, যাতে representative dataset, restore এবং reconciliation evidence একই stable bootstrap base ব্যবহার করে.

### Agent E — W0-02 Remaining RBAC/Approval/Audit

**Branch:** `task/w0-02-approval-audit`
**Owns:** approval segregation, audit immutability, break-glass/privileged actions, manual role matrix and sign-off.

Clinical route-level permission sub-gate already passed. Agent E যেন W0-01-এর session/auth files edit না করে। Shared file দরকার হলে W0-01 merge হওয়ার পরে rebase করে কাজ করবে.

### QA Agent / Staff — Manual Reagent & Inventory

**Code branch সাধারণত লাগবে না।** Existing test environment ও ClickUp list ব্যবহার করবে:  
https://app.clickup.com/90182866612/v/l/li/901819451364

Bug পাওয়া গেলে প্রতিটি bug-এর জন্য আলাদা branch হবে, যেমন:

- `fix/reagent-stock-duplicate-submit`
- `fix/inventory-negative-balance-guard`

---

## কোন কাজগুলো একসাথে শুরু করা নিরাপদ

### Parallel Batch 1

1. Agent A — W0-01 implementation/review
2. Agent B — W0-03 bootstrap/setup
3. QA Staff — reagent test-environment setup ও manual QA

Workerরা verified branch তৈরি করে থামবে। তারপর integration agent serialভাবে `W0-01 integrate করো` এবং `W0-03 integrate করো` চালাবে।

### Parallel Batch 2 — W0-01 ও W0-03 integration-এর পরে

1. Agent C — W0-02 remaining approval/audit/shared middleware work
2. Agent D — W0-04 clean-bootstrap + migration + custom-domain verification
3. Agent E — W0-05 representative dataset backup/restore drill

তারপর integration agent একবারে একটি করে W0-02, W0-04 এবং W0-05 integrate করবে।

### Sequential final gate

1. W0-01 এবং W0-03 integrated
2. W0-02 approval/audit evidence integrated
3. W0-04 migrations/build/tests/custom-domain smoke passes
4. W0-05 backup/restore reconciliation passes
5. `W0 verify করো`
6. Wave 0 verdict
7. তারপর Wave 1 শুরু

---

## Worktree তৈরি করার recommended pattern

Clean integration base branch নির্ধারণ করার পরে:

```bash
git worktree add .worktrees/w0-01-auth-session -b task/w0-01-auth-session <BASE_COMMIT>
git worktree add .worktrees/w0-03-hospital-bootstrap -b task/w0-03-hospital-bootstrap <BASE_COMMIT>
git worktree add .worktrees/w0-04-release-deployment -b task/w0-04-release-deployment <BASE_COMMIT>
git worktree add .worktrees/w0-05-backup-restore -b task/w0-05-backup-restore <BASE_COMMIT>
```

`<BASE_COMMIT>` একই verified clean commit হবে। `.worktrees/` repository ignore করা আছে কি না আগে যাচাই করতে হবে। প্রতিটি worktree-তে dependency install এবং baseline focused tests চালিয়ে তারপর agent কাজ শুরু করবে।

W0-02 shared-auth worktree W0-01 merge হওয়ার পরে তৈরি করাই safer:

```bash
git worktree add .worktrees/w0-02-approval-audit -b task/w0-02-approval-audit <W0_01_MERGED_COMMIT>
```

---

## প্রতিটি agent-কে যে prompt দেবেন

```text
Task: <TASK ID এবং title>
Branch/worktree: <exact branch এবং path>
Goal: ClickUp task-এর production-readiness requirements evidenceসহ complete করা।
Scope: <owned files/domains>
Do not touch: <other agents' files/domains>
Read first: agents.md, .agent-rules/architecture.md, .agent-rules/coding-rules.md,
            docs/production-readiness/MODULE_REVIEW_WORKFLOW.md,
            সংশ্লিষ্ট ClickUp task এবং existing review docs.
Method:
1. Existing implementation inventory করুন।
2. Missing/unsafe behavior-এর failing test লিখুন।
3. Minimal focused fix করুন।
4. Focused tests, relevant integration tests, typecheck/build চালান।
5. Module review report ও evidence update করুন।
6. Small logical commits করুন।
Output:
- Root cause/findings
- Changed files
- Test commands ও exact result
- Commit SHA
- Remaining risks/blockers
- PASS/FAIL recommendation
Do not merge নিজের branch। Integration owner review করার পরে merge করবে।
```

---

## File ownership rule

একই সময়ে দুই agent একই high-conflict file edit করবে না। বিশেষ করে:

- `src/index.ts`
- central auth/session middleware
- permission catalogs
- shared schema/migration registries
- `package.json`/lockfile
- deployment config
- master tracker/current-next-task

একজন integration/documentation owner master tracker, `CURRENT_NEXT_TASK.md` এবং release evidence update করবে। Module agent নিজের module report update করতে পারবে।

---

## Merge order

Worker agent merge করবে না। Owner আলাদা integration agent-কে একবারে একটি command দেবেন। Recommended local-main integration order:

1. `W0-01 integrate করো` — auth/session foundation
2. `W0-03 integrate করো` — hospital bootstrap/master data
3. `W0-02 integrate করো` — remaining RBAC/approval/audit on latest main
4. `W0-04 integrate করো` — release/deployment after bootstrap
5. `W0-05 integrate করো` — backup/restore after representative dataset
6. `W0 verify করো` — integrated Wave 0 tests and evidence

প্রতিটি integration-এর আগে:

- worker handoff এবং run report review
- changed-file scope review
- dependency ও current local-main check
- shared merge lock acquisition
- focused tests rerun
- conflict resolution by integration agent
- post-merge relevant full suite/build
- ClickUp evidence sync when available

---

## সব কাজের high-level তালিকা

### Wave 1 — Patient & Revenue

- W1-01 Patient Registration/UHID/MPI/Duplicate/Merge
- W1-02 Reception/Appointment/Schedule/Queue/Visit
- W1-03 Doctor OPD/Clinical/Vitals/Diagnosis/Notes
- W1-04 Prescription/ePrescribing/Medication Safety
- W1-05 Billing/Payment/Deposit/Discount/Refund
- W1-06 Cash Drawer/Shift/Handover/Variance

### Wave 2 — Diagnostics, Stock & Books

- W2-01 Laboratory/LIS E2E
- W2-02 Analyzer/ASTM-HL7/Mapping/QC/Downtime
- W2-03 Reagent/Consumption QA
- W2-04 Pharmacy/Dispensary/Stock/Sales/Returns
- W2-05 Inventory/Procurement/Stores/Assets/Ward Supply
- W2-06 Accounting/Ledger/P&L/Reconciliation

### Wave 3 — Inpatient & Advanced Care

- W3-01 Admission/IPD/Bed/Transfer/Discharge
- W3-02 Nursing/MAR/I-O/Handover/Ward
- W3-03 OT/Procedure/CSSD
- W3-04 Radiology/RIS/PACS-DICOM/Procedure Safety

### Wave 4 — Workforce, Portal & Support

- W4-01 HR/Attendance/Leave/Roster/Payroll
- W4-02 Insurance/Claim/Prior Auth/Scheme
- W4-03 MRD/Documents/MLC/Birth-Death/Retention
- W4-04 Portal/PHR/Consent/Identity Proof/Global Health
- W4-05 Notifications/SMS/Email/WhatsApp/Push/Reminder
- W4-06 Specialty Clinical & Hospital Support Scope
- W4-07 Telemedicine/Referral/Marketplace/Public Website

### Wave 5 — Analytics, Interoperability & AI

- W5-01 Dashboard/KPI/Reports/Analytics/Export
- W5-02 FHIR/CCDA/Bulk Export/External Integration
- W5-03 AI Assistant/Prediction/Safety/Governance

### Final gates

- FINAL-01 Integrated Hospital Go-Live Simulation
- FINAL-02 Production Readiness Sign-off & Release Decision
- FUTURE-01 AgentOS & AI Foundry Readiness Gate

---

## Recommended agent count

Wave 0 Batch A-তে সর্বোচ্চ **দুইজন worker + একজন QA/manual agent** রাখুন। W0-01 ও W0-03 integrate হওয়ার পরে Batch B-তে সর্বোচ্চ **তিনজন worker + একজন QA/manual agent** রাখা যাবে। Integration সবসময় একজন agent serialভাবে করবে।

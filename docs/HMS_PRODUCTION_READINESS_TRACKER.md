# Ozzyl HMS Production Readiness & Module Review Tracker

**Document owner:** Product / Engineering / QA
**Created:** 2026-07-12
**Status:** Active review register — post-CDB-V1-071B rebaseline
**Authoritative scope:** Current Ozzyl HMS repository and its deployed hospital workflows
**Related strategy:** `Ozzyl HMS-কে Global Healthcare AI Startup-এ রূপান্তরের পরিকল্পনা` (Google Drive)

> This file is the source of truth for deciding whether Ozzyl HMS is ready for a controlled hospital pilot or a broader production rollout. A route, page, migration, or old review report proves implementation presence; it does **not** by itself prove production readiness.

> **2026-07-31 post-release addendum:** CDB-V1-071B is integrated at `3da958da07e7a20d016dbe08176a629bd6f54b65` and Worker `4ff275b8-f17e-4956-a104-e9083a0a1d57` is active at 100%. This proves the controlled Canonical-compatible Worker release, not unrestricted multi-hospital readiness, broad provider-authority promotion, module commissioning or Legacy retirement. Current work is governed by [Post-Canonical Production Roadmap](./architecture/2026-07-31-post-canonical-production-roadmap.md).

## সহজে কাজ শুরু করার লিংক

- **[Task Catalog](./production-readiness/TASK_CATALOG.md)** — শুধু task ID বলার জন্য সব কাজ, scope, dependency ও completion gate
- **[Autonomous Agent Protocol](./production-readiness/AGENT_TASK_EXECUTION_PROTOCOL.md)** — branch/worktree থেকে verified local-main merge পর্যন্ত বাধ্যতামূলক workflow
- **[Task Status](./production-readiness/TASK_STATUS.md)** — কোন task চলছে, blocked বা complete
- **[Task Run Report Template](./production-readiness/TASK_RUN_REPORT_TEMPLATE.md)** — agent evidence ও integration report
- **[Start Here](./production-readiness/START_HERE.md)** — কোথা থেকে এবং কীভাবে review শুরু করবেন
- **[Current Next Task](./production-readiness/CURRENT_NEXT_TASK.md)** — এই মুহূর্তে owner, engineering ও QA staff-এর পরবর্তী কাজ
- **[Module Review Workflow](./production-readiness/MODULE_REVIEW_WORKFLOW.md)** — প্রতিটি module review করার নিয়ম
- **[Module Review Template](./production-readiness/MODULE_REVIEW_TEMPLATE.md)** — নতুন review report তৈরির template
- **[Documentation Index](./production-readiness/index.md)** — সব readiness document এক জায়গায়

---

## 1. Executive verdict

As of 2026-07-31, Ozzyl HMS has completed the CDB-V1-071B controlled production Worker release for the protected core and remains suitable for a **controlled hospital pilot**. It is **not yet approved for an unrestricted multi-hospital production rollout** because post-release observation, hospital commissioning, module-specific E2E, durable monitoring, provider verification and operational sign-off remain.

### Current release classification

| Decision | Current state |
|---|---|
| Product breadth | Strong: broad clinical, operational, financial, diagnostic, portal, and administrative coverage exists |
| Code-level review | Significant previous review evidence exists, but it is uneven by module and some reports are stale |
| Automated test evidence | Many unit/UI tests exist; a fresh, complete release-candidate run is still required |
| Manual end-to-end review | Incomplete; reagent/inventory has an existing detailed ClickUp QA plan, most other modules need the same treatment |
| Controlled hospital pilot | **Conditional GO** after Wave 0 blockers and selected Wave 1–2 workflows pass |
| Broad production rollout | **NO-GO** until all P0 gates, integrated simulation, operational sign-off, and hospital-specific commissioning are complete |
| AgentOS / AI Foundry | Strategic future phase; it must not distract from Core HMS production gates |

---

## 2. Status definitions

| Status | Meaning |
|---|---|
| `READY` | Code, UI/API, automated verification, manual E2E, operational controls, and accountable sign-off are complete |
| `CONDITIONAL` | Implemented and usable for a controlled pilot, but environment, workflow, training, or residual-risk gates remain |
| `REVIEW PENDING` | Implementation evidence exists, but systematic module review and manual sign-off are incomplete |
| `BLOCKED` | A known release blocker prevents production approval |
| `MISSING / PLANNED` | Required capability is absent or only exists as a roadmap/design |
| `N/A FOR HOSPITAL` | Deliberately excluded for a specific hospital and documented in the rollout scope |

### Evidence codes

- `C` — code/API/schema evidence
- `U` — usable UI evidence
- `A` — automated test evidence
- `M` — manual end-to-end evidence
- `O` — operational readiness evidence: configuration, monitoring, backup, SOP, training
- `S` — accountable sign-off

A module can be marked `READY` only when all evidence required for its risk level is present.

---

## 3. Non-negotiable production gates

### P0 — must close before real multi-role hospital use

- [x] **Clinical mutation route-level authorization:** explicit permission enforcement and negative tests for vitals, allergies, diagnosis, notes, assessments, care plans, medication changes, and other clinical writes. Evidence: [Clinical Write Permission Review](./production-readiness/CLINICAL_WRITE_PERMISSION_REVIEW.md).
- [ ] **Custom-domain release smoke:** health and Worker-version smoke passed on `hms.ozzyl.com`, `app.ozzyl.com`, and `admin.ozzyl.com` during CDB-V1-071B rollout; authenticated login, tenant routing, protected API, web-app and admin E2E evidence remains required.
- [ ] **Production E2E safety/configuration:** replace hardcoded `workers.dev` production test targets with explicit custom-domain/environment-driven execution.
- [ ] **Fresh hospital bootstrap:** create a clean tenant/database, apply migrations in order, seed required master data, and complete first-login/setup smoke.
- [ ] **Current release-candidate verification:** migrations, backend tests, frontend tests, build, typecheck policy, selected E2E, and smoke results recorded against one commit SHA.
- [ ] **Cross-tenant isolation tests:** prove users, IDs, files, reports, searches, portal links, and exports cannot cross tenant boundaries.
- [ ] **Backup and restore drill:** restore a representative hospital dataset and verify integrity, permissions, files, and financial totals.
- [ ] **Production provider verification:** email/SMS/WhatsApp/payment/cron/queue dependencies used by the hospital are real, monitored, and fail visibly.
- [ ] **Data retention, deletion, and consent versioning:** operational consent must be distinguishable from AI/product-improvement/research/commercial-use permission.
- [ ] **Hospital-specific role matrix and SOP sign-off:** named owners, least-privilege access, downtime process, escalation contacts, and staff training completed.

### P1 — required before broad rollout

- [ ] Load and concurrency tests for registration, appointments, payments, stock, bed allocation, lab results, and report generation.
- [ ] Incident alert delivery and on-call drill.
- [ ] Release/rollback rehearsal.
- [ ] Department-by-department data reconciliation and opening-balance approval.
- [ ] Accessibility, localization, print layout, and device/browser acceptance.
- [ ] Security and privacy review by an independent qualified reviewer.

---

## 4. Module inventory and readiness register

> Initial statuses below reflect code/document inspection, not final QA verdicts. Update each row only after its linked ClickUp review task contains evidence and sign-off.

| ID | Module / capability | Implementation evidence | Previous review evidence | Current status | Required next decision |
|---|---|---|---|---|---|
| M01 | Platform, tenant routing, authentication, sessions, MFA | C/U/A | Broad phased review exists | `REVIEW PENDING` | Run W0-01 login/session/MFA, disabled-user and cross-tenant authentication review |
| M02 | Access control, permissions, approvals, audit, break-glass | C/U/A | Clinical route-level authorization passed | `REVIEW PENDING` | Complete approval segregation, immutable audit, privileged-user, break-glass and hospital role-matrix review |
| M03 | Hospital setup, branches, departments, master data, settings, print templates | C/U/A | Partial operational docs | `REVIEW PENDING` | Run clean-hospital setup and configuration portability test |
| M04 | Patient registration, UHID, duplicate detection, MPI, merge, demographics | C/U/A | Portal/MPI hardening reviewed | `CONDITIONAL` | Manual duplicate/merge/identity/cross-tenant and no-mobile workflows |
| M05 | Reception, appointments, doctor schedules, queue, visit creation | C/U/A | Reception review exists | `REVIEW PENDING` | Complete booking-to-visit-to-bill E2E and retry/idempotency tests |
| M06 | Doctor workspace, OPD chart, history, vitals, allergies, diagnosis, notes | C/U/A | Route authorization and tenant-isolation tests passed | `REVIEW PENDING` | Complete manual multi-role OPD workflow, clinical safety, print and accountable sign-off |
| M07 | Prescriptions, e-prescribing, fulfilment, safety override, medication reconciliation | C/U/A | Ownership/safety hardening reviewed | `REVIEW PENDING` | Prescribe-to-dispense E2E, interaction/override governance, version/print checks |
| M08 | Emergency, triage, ambulance | C/U/A | Limited consolidated evidence | `REVIEW PENDING` | Arrival-to-disposition simulation, priority/escalation and downtime workflow |
| M09 | Admission/IPD, bed allocation, transfer, running bill, discharge | C/U/A | IPD/accounting reviews exist | `CONDITIONAL` | Full admit-transfer-charge-discharge simulation and bed concurrency proof |
| M10 | Nursing, MAR, medication orders, I/O, handover, ward workflow | C/U/A | Nursing hardening reviewed | `REVIEW PENDING` | Shift-to-shift patient-care simulation and unauthorized-write tests |
| M11 | Operation theatre, procedures, anesthesia/notes, CSSD | C/U/A | OT/CSSD hardening plus gap report | `REVIEW PENDING` | Verify structured anesthesia/status trail, consent, inventory, sterilization, sign-off |
| M12 | Laboratory/LIS: catalog, orders, sample, result, validation, report | C/U/A/M(partial) | Extensive LIS reviews exist | `CONDITIONAL` | Real order→bill→sample→result→verify→print/deliver commissioning |
| M13 | Analyzer, ASTM/HL7, mapping, unmatched queue, QC, downtime | C/U/A | Extensive design/review evidence | `CONDITIONAL` | Device-specific commissioning, QC lockout, reprocessing, reconciliation and fallback |
| M14 | Lab reagent and consumption inventory | C/U/A/M(plan) | Detailed review and ClickUp manual plan exist | `REVIEW PENDING` | Execute existing ClickUp test sequence and record final QA verdict |
| M15 | Radiology/RIS, catalog, orders, reports | C/U/A | RIS hardening reviewed | `REVIEW PENDING` | Order-to-report E2E, safety checklist, role segregation and correction workflow |
| M16 | PACS/DICOM/OHIF integration | C/U/Config | Operational DICOM docs exist | `CONDITIONAL` | Environment-specific connectivity, study matching, viewer, security and downtime test |
| M17 | Billing, invoices, deposits, discounts, cancellations, refunds, settlements | C/U/A | Strong billing hardening/reviews | `REVIEW PENDING` | Multi-counter E2E, concurrency/idempotency, approval and reconciliation sign-off |
| M18 | Cash drawer, shift closing, handover, variance, collection monitoring | C/U/A | Cash-control reviews exist | `REVIEW PENDING` | Opening-to-closing simulation, short/excess approval, custody and audit proof |
| M19 | Accounting, chart of accounts, journal, P&L, subledgers, shareholders | C/U/A | Accounting production reviews exist | `REVIEW PENDING` | Source-document-to-ledger trace, period close, reversal, opening balance and accountant sign-off |
| M20 | Insurance, claims, prior authorization, scheme limits | C/U/A | Partial review evidence | `REVIEW PENDING` | Eligibility-to-claim-to-settlement E2E and denial/rework workflow |
| M21 | Pharmacy/dispensary, purchase, GRN, batch/expiry, sale, return, narcotics | C/U/A | Pharmacy hardening reviewed | `CONDITIONAL` | Sale→stock→receipt→report, return, controlled-drug and old/new path reconciliation |
| M22 | General inventory, procurement, stores, transfers, count, adjustments, write-off | C/U/A/M(partial) | Extensive inventory reviews exist | `REVIEW PENDING` | Procure-to-pay and stock lifecycle E2E, approvals, atomicity and physical-count sign-off |
| M23 | Fixed assets, maintenance, allocation, depreciation, insurance/contracts | C/U/A | Older gap analysis exists | `REVIEW PENDING` | Confirm insurance/contract gap closure and asset lifecycle/accounting linkage |
| M24 | Ward supply, requisition, dispatch, return, consumption | C/U/A | Inventory/IPD reviews exist | `REVIEW PENDING` | Request-to-consumption E2E, conditional stock, receipt and variance controls |
| M25 | HR, staff, attendance, biometric, leave, roster, payroll | C/U/A | Older operational gap analysis | `REVIEW PENDING` | Payroll-to-accounting, leave rules, attendance summary, approval and payslip checks |
| M26 | Medical records, document manager, discharge archive, MLC, birth/death | C/U/A | Older MRD gap analysis | `REVIEW PENDING` | Chart completion, retention, legal hold, archive and medico-legal linkage review |
| M27 | Patient portal, PHR, hospital links, consent, global health | C/U/A | Privacy hardening reviewed | `CONDITIONAL` | Identity-proof flow, consent versions, link approval, data correction/deletion and portal E2E |
| M28 | Notifications, inbox, reminders, email, SMS, WhatsApp, push | C/U/A/Config | Operational risk noted previously | `CONDITIONAL` | Verify real providers, delivery receipts, retries, consent/preferences, failure alerts |
| M29 | Dashboards, admin/MD monitoring, reports, analytics, exports | C/U/A | Multiple dashboard reviews exist | `REVIEW PENDING` | KPI source reconciliation, role visibility, export privacy, timestamps and owner sign-off |
| M30 | Telemedicine, referrals, marketplace/public website | C/U/A | Limited consolidated evidence | `REVIEW PENDING` | Scope decision and privacy/payment/booking/video failure tests |
| M31 | Blood bank, maternity, vaccination, dental, eye, psychiatry | C/U/A(partial) | Uneven review evidence | `REVIEW PENDING` | Hospital-by-hospital scope; specialist-led workflow and safety validation |
| M32 | Housekeeping, laundry, kitchen, biomedical waste, mortuary | C/U/A(partial) | Uneven review evidence | `REVIEW PENDING` | Operations owner acceptance, traceability, infection-control and exception tests |
| M33 | FHIR R4, C-CDA, bulk export, external APIs | C/Docs/A(partial) | Interoperability docs exist | `REVIEW PENDING` | Conformance, authorization, audit, pagination, export scope and external-client tests |
| M34 | Local server, offline sync, multi-branch, backup/restore | C/U/Docs/A(partial) | Architecture/runbooks exist | `CONDITIONAL` | Offline conflict, reconnect, sync custody, clean restore, branch isolation and failure drills |
| M35 | Deployment, CI/CD, observability, incident response, release operations | C/Docs/A(partial) | Phase 11 review exists | `BLOCKED` | Custom-domain smoke, prod script correction, provider checks and release evidence pack |
| M36 | AI assistant, summaries, suggestions, predictive analytics | C/U/A(partial) | AI roadmap/review exists | `CONDITIONAL` | Strict schemas, model/prompt versions, safety classes, permissions, human review, cost/latency metrics |
| M37 | Ozzyl AgentOS control plane | Design only / partial approval primitives | Roadmap exists | `MISSING / PLANNED` | Build only after Core P0 gates; tool gateway, policy versions, agent runs, approvals, rollback, outcome ledger |
| M38 | Ozzyl Foundry: rights, de-identification, annotation, datasets, evaluation | Roadmap only | Detailed strategy exists | `MISSING / PLANNED` | Separate governed platform after Core/AgentOS; no operational data may become training data automatically |

---

## 5. Must-have gaps and capabilities requiring explicit closure

### Core HMS release gaps

1. Clinical route-level write permissions and evidence of denial for non-clinical roles.
2. Clean-install/new-tenant migration and master-data bootstrap reliability.
3. Custom-domain production smoke and safe production E2E commands.
4. Fresh full test/build evidence tied to a release commit.
5. Cross-tenant isolation, export privacy, and file-access tests.
6. Restore drill and reconciliation of clinical, stock, cash, and accounting totals.
7. Real provider/worker commissioning for notifications and scheduled/background jobs.
8. Versioned consent, retention, deletion/withdrawal, and legal-hold processes.
9. Department-specific SOP, staff training, role mapping, downtime workflow, and sign-off.
10. Integrated patient journey simulation across reception, clinical, diagnostics, pharmacy, billing, cash, stock, and accounting.

### Capabilities that may be intentionally out of scope for the first hospital

These are not universal blockers if formally excluded from the deployment contract and disabled/configured accordingly:

- DICOM/PACS viewer
- Analyzer integration
- Blood bank and specialty clinical modules
- Insurance claims and prior authorization
- Telemedicine/marketplace
- Local-server/offline mode
- Multi-branch operation
- Advanced AI assistance

### AI/AgentOS/Foundry gaps

- Prompt/model/output schema registries
- Agent definitions, runs, steps, tool calls, risk levels, approval gates and rollback
- Executable, versioned hospital policies
- Outcome and cost/latency measurement
- Separate data-rights and consent-purpose model
- De-identification pipeline and manifests
- Expert credentials, double review and adjudication
- Dataset provenance, versioning, data cards and export approvals
- Evaluation suites, hidden benchmarks, failure taxonomy and regression comparison
- Separate secure storage/control plane and regional data-residency design
- Independent legal, privacy, clinical-governance and security review

---

## 6. Required review method for every module

Each module review must cover all applicable items below.

### A. Scope and source of truth

- Routes, services, schema/migrations, UI pages, permissions, reports and integrations identified.
- Canonical write path and deprecated/legacy paths documented.
- Hospital roles and responsible department owner identified.

### B. Functional flow

- Happy path completed from beginning to final operational output.
- Edits, cancellation, correction, reversal and reprint/re-export tested.
- Empty, invalid, duplicate, expired, blocked and boundary cases tested.

### C. Authorization and privacy

- Every read/write action tested with authorized and unauthorized roles.
- Cross-tenant IDs, guessed URLs, exports and file access rejected.
- Sensitive data is minimized in lists, logs, caches, downloads and notifications.

### D. Integrity and concurrency

- Idempotency/retry/refresh does not create duplicate money, stock, result, bed or task effects.
- Concurrent actions preserve totals and ownership.
- Cross-module posting is complete or has a visible repair/reconciliation state.

### E. Operational behavior

- Print/report/export is correct.
- Audit trail includes actor, time, tenant, before/after or reason where required.
- Failure, timeout, offline/reconnect and provider outage are visible and recoverable.
- Monitoring, alert, support escalation and downtime SOP are known.

### F. Evidence and verdict

- Screenshots/video/log/request IDs attached.
- Expected versus actual result recorded.
- Every defect has severity, reproduction, owner, fix status and retest evidence.
- Final verdict is exactly one of: `PASS`, `PASS WITH ACCEPTED RISK`, `FAIL`, `N/A FOR THIS HOSPITAL`.
- Patient-safety, privacy, tenant-isolation, money, stock, medication, result-integrity and backup defects cannot be risk-accepted without an accountable executive/domain sign-off.

---

## 7. Review waves and recommended order

### Wave 0 — release foundation

M01, M02, M03, M34, M35.
**Exit:** authorization blocker closed, clean bootstrap works, release pipeline and restore evidence are green.

### Wave 1 — first patient and revenue journey

M04, M05, M06, M07, M17, M18.
**Exit:** register → appointment/visit → consultation/prescription → bill/payment → cash close is safe and reconciled.

### Wave 2 — diagnostics, medicine, stock and books

M12, M13, M14, M19, M21, M22, M24.
**Exit:** lab/pharmacy/inventory effects reconcile to billing, cash and accounting with no duplicate or silent failure.

### Wave 3 — inpatient and advanced care

M09, M10, M11, M15, M16.
**Exit:** admission-to-discharge and department-specific commissioning pass.

### Wave 4 — workforce, portal, insurance and support operations

M20, M23, M25–M32.
**Exit:** selected hospital scope is fully reviewed; excluded modules are documented and disabled.

### Wave 5 — interoperability and AI

M33, M36.
**Exit:** integrations and AI are permissioned, auditable, safe, and optional without breaking core operations.

### Future phase — international AI startup platform

M37–M38 only after Core HMS release gates are stable in real hospitals. Start with **LabOps AI** and **Revenue Integrity AI**, retain mandatory human approval, then build AgentOS and finally the Foundry governance/evaluation layer.

---

## 8. Integrated hospital go-live simulation

A release cannot receive final approval until one representative, non-production hospital dataset completes this sequence:

1. Hospital/branch/setup and role creation
2. Patient registration and duplicate check
3. Appointment/queue/visit
4. Doctor consultation, vitals, diagnosis, prescription
5. Lab and/or radiology order, billing, sample/study, result/report
6. Pharmacy dispensing and stock deduction
7. Payment, deposit/due/refund as applicable
8. Cash counter closing and handover
9. Inventory/reagent movement and reconciliation
10. Accounting posting and management dashboard reconciliation
11. Portal/report delivery with consent and access controls
12. Backup, simulated failure, restore and verification
13. Audit trace review from beginning to end

The simulation must include at least one cancellation/reversal, one retry/idempotency case, one unauthorized-role attempt, one cross-tenant attempt, and one provider/network failure.

---

## 9. Sign-off register

| Gate | Owner | Evidence link | Verdict | Date |
|---|---|---|---|---|
| Engineering review |  |  |  |  |
| QA/manual review |  |  |  |  |
| Clinical safety |  |  |  |  |
| Laboratory |  |  |  |  |
| Pharmacy |  |  |  |  |
| Finance/accounting |  |  |  |  |
| Hospital operations |  |  |  |  |
| Privacy/security |  |  |  |  |
| Backup/incident readiness |  |  |  |  |
| Final release decision |  |  |  |  |

---

## 10. Review log

| Date | Module/task | Change or evidence added | Status change | Reviewer |
|---|---|---|---|---|
| 2026-07-12 | Initial inventory | Repository, previous reports, Google Drive roadmap, and existing ClickUp reagent QA structure inspected | Tracker created | ChatGPT-assisted review |
| 2026-07-12 | W0-02 clinical mutation authorization | Fine-grained clinical, prescription, medication-reconciliation, safety-check and fulfilment permissions; mandatory enforcement; Managing Director overgrant removed; role-scoped and revocation-safe legacy compatibility; cross-tenant patient/visit/encounter/prescription/formulary guards; 106 focused tests, TypeScript check, 15,310-test full suite and production build recorded | Clinical route-level P0 sub-gate `PASS`; M01 and M06 moved from `BLOCKED` to `REVIEW PENDING` | Engineering review |
| 2026-07-31 | CDB-V1-071B controlled production release | `origin/main` `3da958da...`; Worker `4ff275b8...` promoted through 5%, 50%, 100%; migration `0571`; 38 admissions, 16 bed stays, 54 issue resolutions, 4 waivers, 0 remaining target issues; rollback Worker retained | Protected-core Worker release `PASS`; post-release observation, authenticated E2E, module commissioning, durable monitoring and broad rollout remain open | Engineering/release review |

---

## 11. Maintenance rules

1. This file is the summary register; detailed evidence belongs in the corresponding ClickUp task and module-specific review report.
2. Do not mark `READY` from code inspection alone.
3. Add the release commit SHA and environment to every final test result.
4. Reopen a module when its routes, schema, permissions, money/stock logic, integration, or deployment configuration materially changes.
5. Keep HMS Core readiness separate from AgentOS/Foundry roadmap progress.
6. Operational hospital data, AI interactions, doctor corrections, lab messages, voice, prescriptions, documents, or WhatsApp conversations are **not** training data by default.

# Ozzyl HMS System-Level Review and Improvement Plan

**Date:** 2026-06-22  
**Branch:** `agent/system-level-review`  
**Worktree:** `.worktrees/system-level-review`  
**Scope:** Product readiness, codebase health, hospital workflow coverage, deployment validation, and next improvement priorities.

---

## 1. Executive Assessment

Ozzyl HMS is no longer a small MVP or demo. The inspected codebase is a broad, production-track hospital platform with major modules already present: reception, appointments, queue, OPD/IPD, billing, cash/counter workflows, laboratory, pharmacy, radiology, nursing, HR/payroll, inventory, admin dashboards, patient portal, marketplace, local server deployment, cloud sync, security tests, E2E tests, and migration tooling.

Current level:

| Area | Estimated Level | Notes |
|---|---:|---|
| Feature coverage | 80-90% for a small/mid-size Bangladesh hospital | Very broad module coverage. Needs workflow polishing. |
| Technical foundation | 75-85% | Build/typecheck pass after migration manifest generation. Good test structure exists. |
| Production operations | 65-75% | Local server/cloud sync exists, but needs stronger runbooks, monitoring, backup-restore drills, and deploy gates. |
| UX/workflow readiness | 60-75% | Many pages exist, but high-risk workflows need simplification for real hospital staff. |
| Maintainability | 55-70% | Several very large route/page files create long-term risk. |
| Scale readiness | 60-70% | Cloudflare-native architecture is strong, but hot booking/queue/cash paths need explicit contention controls and load validation. |

**Overall judgment:** The system is feature-rich and sellable for controlled deployments, but before pushing to 50-200 hospitals it needs a focused hardening phase: workflow simplification, permission audit, migration hygiene, performance optimization, and operations discipline.

---

## 2. Inspection Signals

### 2.1 Codebase size signal

Observed from the worktree scan:

- Tenant route TypeScript files: 274
- Top-level route TypeScript files: 22
- Frontend page TSX files: 426
- Page test files: 319
- Unit tests: 98
- Integration tests: 230
- E2E tests: 46
- Migration SQL files: 381
- Migration manifest generated conforming migrations: 372

This is a large system. The positive side is module breadth. The risk is complexity and regression risk if module boundaries are not tightened.

### 2.2 Validation run

Validation commands run from `.worktrees/system-level-review`:

- `pnpm test:production:unit` — passed, 6 files / 27 tests.
- `pnpm exec tsc --noEmit` — initially failed because `src/data/schema-migrations.generated` was missing.
- `pnpm build:migrations` — passed; generated 372 migration entries; skipped 9 non-conforming SQL files.
- `pnpm exec tsc --noEmit` after migration manifest generation — passed.
- `pnpm build:web` — passed, with bundle-size warnings.
- `pnpm build` — passed, with bundle-size/deprecation warnings.

### 2.3 Important warnings

1. Typecheck depends on generated migration manifest. This is acceptable if the build pipeline always runs `pnpm build:migrations` first, but local developer checks should make this obvious.
2. Build reports large chunks:
   - Main web vendor chunk around 1.4 MB minified.
   - Patient app `index` chunk around 3.1 MB minified.
   - ReceptionDashboard chunk around 213 KB minified.
3. Build reports Vite/Rolldown config warning for `chunkSizeWarningLimit` and deprecation warnings around optimizeDeps/React plugin paths.
4. Migration manifest skipped 9 non-conforming SQL files. Some are seed/demo scripts and may be intentionally skipped, but production migration hygiene should clearly separate versioned migrations from utility SQL.
5. Several files are very large and should be gradually split:
   - `src/routes/tenant/patients.ts` ~4334 lines
   - `src/routes/tenant/lab.ts` ~3787 lines
   - `src/routes/tenant/billingCounter.ts` ~3502 lines
   - `src/routes/tenant/ot.ts` ~2999 lines
   - `web/src/pages/ReceptionDashboard.tsx` ~6662 lines

---

## 3. Strengths

### 3.1 Product breadth

The system already covers many modules that typical small hospital software in Bangladesh does not fully cover:

- Reception and patient registration
- Appointment and queue/token flow
- Billing, counter sessions, cash handover, deposits, due aging, cancellations
- OPD/IPD, admissions, beds, discharge, rounds
- Lab, lab QC, lab machine/LIS-related routes, lab reports
- Pharmacy, e-prescribing, stock, invoices, expiry, narcotic register
- Radiology and PACS-related route structure
- Nursing, MAR, notes, wards, handover, care plans
- HR, duty roster, attendance, biometric, payroll
- Inventory, purchase, goods receipt, stock, returns, assets
- Admin/MD dashboards, audit, discounts, suspicious activities
- Patient portal, health card/global identity direction
- Local server + cloud sync/deploy scripts

### 3.2 Technical direction

The project has a strong Cloudflare-native direction:

- Workers/Hono API
- D1 migrations
- Local server deployment path
- Sync routes and schema-sync concepts
- Tests at unit/integration/e2e/load levels
- Build pipeline covering web, patient app, admin panel

### 3.3 Bangladesh hospital fit

The system has realistic local workflow elements:

- Cash/counter handling
- Shift handover
- Discount control
- Multi-role users
- Offline/local server direction
- Appointment/token/queue
- Bengali-friendly patient/reception needs

---

## 4. Main Gaps and Risks

### 4.1 Too many features, not enough workflow sharpness

The project has breadth, but hospital users need simple workflows. A receptionist should not feel they are using an enterprise ERP. The priority should be end-to-end flows, not more modules.

Critical workflows to polish first:

1. Reception open counter -> patient registration -> appointment/test bill -> payment -> print -> cash drawer update.
2. Appointment -> check-in -> queue/token -> doctor call -> complete/no-show/reschedule.
3. Lab order -> sample collection -> machine/manual result -> verification -> report print.
4. IPD admission -> bed assignment -> charges -> deposits -> running bill -> discharge bill.
5. End-of-shift cash close -> handover -> admin verification.

### 4.2 Maintainability risk from large files

Very large route/page files make future agent work risky. They increase merge conflicts and bugs. The biggest priority is not rewriting everything; instead split only active/high-risk modules as work touches them.

Priority refactor targets:

1. `ReceptionDashboard.tsx`
2. `patients.ts`
3. `lab.ts`
4. `billingCounter.ts`
5. `appointments.ts` + `queue.ts` integration layer

### 4.3 Permission and privacy audit still needed

Global auth middleware exists, but route-level permission coverage should be audited systematically for sensitive actions. Healthcare data needs route-by-route authorization, not only login-level protection.

Audit focus:

- Patient records
- Clinical notes
- Lab/radiology reports
- Billing adjustments and cancellations
- Discounts
- Cash handover
- Admin dashboards
- Patient portal claim/access flows
- Sync/local server routes

### 4.4 Hot-path coordination risk

Appointment booking, queue token, cash counter close, and inventory stock updates are hot paths. They need idempotency, locking/serialization, and race-condition tests.

Recommended architecture:

- D1 remains source of truth.
- Durable Objects should coordinate slot locks, queue/session coordination, and hot shared state.
- Notifications/sync should be async and not block the user response.

### 4.5 Performance and bundle size

Build passes, but bundle warnings suggest slow load risk on low-end hospital PCs and mobile networks.

Top improvements:

- Route-level lazy loading.
- Split patient app heavy wellness/chart dependencies.
- Avoid loading PDF/chart libraries on first page load.
- Split ReceptionDashboard into smaller components and hooks.
- Precompute dashboard summaries for admin/reception/MD.

### 4.6 Migration hygiene

There are many migrations and some non-conforming SQL files. This is manageable, but before scaling deployments, migration handling must be boring and predictable.

Needed:

- Separate versioned migrations from seed/demo/repair scripts.
- Add a migration validation script to CI.
- Keep local server schema-sync rules documented and tested.
- Do a backup/restore rehearsal before every real hospital onboarding batch.

### 4.7 Operational readiness

The codebase has local server/cloud sync scripts. The next level is operational playbooks:

- Install checklist
- Upgrade checklist
- Backup checklist
- Restore test checklist
- Offline mode checklist
- Printer/report troubleshooting checklist
- Lab machine troubleshooting checklist
- User training checklist
- Go-live day checklist

---

## 5. Recommended Improvement Plan

### Phase 1 — 7-day hardening sprint: make the first hospital smooth

Goal: make daily reception/billing/lab operation reliable and easy.

1. Reception workflow cleanup
   - Make ReceptionDashboard less crowded.
   - Add clear daily steps: Open Counter, Register Patient, Bill, Payment, Print, Close Counter.
   - Add visible warnings for unpaid/due/discount/cash mismatch.

2. Doctor queue improvement
   - Add doctor-wise capacity/time block settings.
   - Add check-in based active queue.
   - Add no-show/hold/reschedule state.
   - Add estimated wait and doctor delay status.

3. Cash control hardening
   - Verify all cash entry paths go through counter session/ledger logic.
   - Make closing mismatch impossible to ignore.
   - Add admin view for unresolved cash mismatch.

4. Lab MVP hardening
   - Focus on order -> sample -> result -> verify -> print.
   - Keep machine integration behind a separate adapter/service layer.
   - Add manual fallback for every machine result flow.

5. Training/SOP
   - Create 1-page SOP for Reception, Lab, Admin, Doctor.
   - Add demo hospital data for training.

Validation target:

- Run production unit tests.
- Run workflow E2E for reception/billing/queue if local server is available.
- Run full build.

### Phase 2 — 30-day production readiness: reduce risk before adding hospitals

Goal: make the system safe to deploy repeatedly.

1. Route permission matrix
   - Generate route list.
   - Assign required permission for every sensitive route.
   - Add tests for permission enforcement.

2. Migration and deploy discipline
   - Separate seed/demo/repair SQL from versioned migrations.
   - Add migration manifest validation to CI.
   - Document local server migration/sync process.

3. Performance cleanup
   - Fix Vite/Rolldown config warning.
   - Split heavy patient app and main app bundles.
   - Lazy load PDF/chart modules.
   - Split ReceptionDashboard into focused components.

4. File boundary cleanup
   - Extract service modules from `patients.ts`, `lab.ts`, `billingCounter.ts`.
   - Keep handlers thin: validate -> call service -> return response.
   - Add tests around extracted services before refactor.

5. Backup and restore
   - Automate local backup verification.
   - Add restore rehearsal guide.
   - Add admin-facing backup status page if not already complete.

### Phase 3 — 60-90 day hospital scale plan: support 10-25 hospitals

Goal: move from one-off deployments to repeatable SaaS operations.

1. Tenant onboarding factory
   - Hospital profile setup wizard.
   - Default roles/permissions template.
   - Default service catalog/test catalog import.
   - Default print templates.
   - Default billing counters and departments.

2. Monitoring and support
   - Local server health dashboard.
   - Sync lag dashboard.
   - Failed job/sync retry dashboard.
   - Support ticket/helpdesk linked to hospital/tenant.

3. Load and concurrency testing
   - Appointment booking concurrent test.
   - Billing/counter payment concurrent test.
   - Lab result bulk entry test.
   - Dashboard load test.

4. Sales demo package
   - Demo login roles.
   - Demo dataset.
   - 10-minute guided demo script.
   - Printed brochure/SOP.

### Phase 4 — 6-month scale foundation: support 50-200 hospitals

Goal: strong SaaS with predictable maintenance.

1. Durable Object coordination for hot workflows.
2. Feature flags per hospital package.
3. Tenant-level analytics and billing/subscription controls.
4. Automated smoke tests after deployment.
5. Admin security center: sessions, permissions, audit, sensitive access.
6. Standard onboarding/training team process.
7. Support knowledge base and in-app help.

---

## 6. Priority Matrix

| Priority | Work | Why |
|---|---|---|
| P0 | Reception/cash/lab/appointment workflow polish | This determines first-hospital success. |
| P0 | Permission audit for sensitive routes | Healthcare + finance data risk. |
| P0 | Backup/restore and local server runbook | Hospital production safety. |
| P1 | Queue/time-block/no-show/doctor delay | Solves common hospital pain. |
| P1 | Bundle/code-splitting optimization | Improves low-end PC/mobile UX. |
| P1 | Migration hygiene | Prevents deployment surprises. |
| P2 | Large file refactor | Reduces future development risk. |
| P2 | Load/concurrency tests | Needed before many hospitals. |
| P3 | Advanced interoperability/AI | Valuable, but not first-hospital blocker. |

---

## 7. What Not To Do Right Now

- Do not add many new modules before polishing daily workflows.
- Do not rewrite the whole system.
- Do not deploy production changes without migration validation and backup plan.
- Do not make every screen realtime.
- Do not push AI features as medical decision-making; keep AI as summarization/assistant only.
- Do not let hospital staff use admin-level accounts for daily work.

---

## 8. Recommended Next Implementation Slice

The best next slice is:

**Smart Appointment + Queue + Doctor Delay Management**

Why:

- It solves a visible hospital problem.
- It improves patient satisfaction immediately.
- It differentiates the product in demos.
- It uses existing `appointments.ts`, `queue.ts`, `AppointmentScheduler.tsx`, `QueueManagement.tsx`, and `QueueDisplay.tsx` foundations.

Suggested scope:

1. Doctor capacity/time-block settings.
2. Check-in based active queue.
3. No-show/hold/reschedule states.
4. Estimated waiting time.
5. Doctor delay status.
6. Admin report: patients not seen, average wait, no-show count.

Do this with TDD and small commits.

---

## 9. Final Summary

Ozzyl HMS is ahead of a normal MVP. It has enough breadth to impress and enough foundation to deploy carefully. The next winning move is not adding more features; it is making the core hospital workflows clean, fast, permission-safe, and repeatable.

Recommended slogan for internal planning:

> Breadth is built. Now make the daily workflow unbeatable.

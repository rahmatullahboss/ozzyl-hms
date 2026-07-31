# Ozzyl HMS — Current Project Phase Review

> **Historical review — superseded for current execution.** The authoritative post-release state is [Post-Canonical Production Roadmap](./architecture/2026-07-31-post-canonical-production-roadmap.md). CDB-V1-071B is deployed at 100%; do not use this June review to determine the next Canonical, Inventory or Full-MM task.

**Last updated:** 2026-06-16
**Purpose:** Current production/demo readiness addendum after the P0 hardening merge.
**Applies to:** `main` after PR #141 (`fix: merge phased P0 hardening branches`) and the latest dashboard/interface review.

> This document supersedes older “all modules production-ready” wording for go/no-go decisions. Keep the older reports for history, but use this file as the current release decision register.

---

## 1. Executive verdict

Ozzyl HMS is now **demo-ready and close to controlled production pilot**, but it should not be treated as a fully unbounded production rollout until the remaining follow-ups are closed and custom-domain production smoke checks are green.

### Current status

| Area | Status | Notes |
|---|---|---|
| Core HMS workflows | Mostly ready for demo/pilot | Patient, reception, billing, pharmacy, lab, IPD, admin/MD dashboards are functional enough for hospital demos. |
| Security/RBAC hardening | Strongly improved | 41/42 original P0 items were closed by the phased hardening work. |
| Remaining known P0 | Open | P0-09: clinical mutation route RBAC for vitals/allergies/diagnosis/notes still needs explicit follow-up. |
| Cash/revenue monitoring | Good foundation | Admin/MD dashboard + cash-control endpoint support collection, expense, due, handover, variance and audit monitoring. More top-level UI polish recommended. |
| Production deployment | Needs controlled smoke | Use custom domains (`hms.ozzyl.com`, `app.ozzyl.com`, `admin.ozzyl.com`), not workers.dev, for production checks. |
| Full test confidence | Improving, not complete | Unit gates pass per user-reported runs, but full E2E/staging smoke and TypeScript baseline cleanup remain follow-ups. |

### Go/no-go summary

**Green for:**
- Hospital demo with demo tenant/demo credentials.
- Controlled pilot after custom-domain smoke and backup/rollback preparation.
- Explaining Admin/MD dashboards to owners/managers.

**Not green for yet:**
- Broad production rollout across multiple real hospitals without staging/prod smoke.
- Write-heavy automated E2E against production.
- Ignoring P0-09 clinical RBAC.

---

## 2. Current release blockers / follow-ups

### Must do before broad production rollout

1. **Custom-domain production smoke**
   - Do not use `hms-saas-production.rahmatullahzisan.workers.dev` as the production smoke base URL.
   - Production has custom routes and `workers_dev=false`, so use:
     - `https://hms.ozzyl.com`
     - `https://app.ozzyl.com`
     - `https://admin.ozzyl.com`
   - Verify:
     ```bash
     curl -i https://hms.ozzyl.com/api/health
     curl -i https://app.ozzyl.com/api/health
     curl -i https://admin.ozzyl.com/api/health
     ```

2. **Fix production E2E scripts that still reference workers.dev**
   - `package.json` still has `test:e2e:prod` and `test:e2e:prod:auth` pointing to `https://hms-saas-production.rahmatullahzisan.workers.dev`.
   - These scripts should be updated to custom domains or replaced with explicit `BASE_URL=...` instructions.

3. **P0-09 clinical routes RBAC**
   - Add explicit role/permission gates to clinical mutation routes for vitals, allergies, diagnosis, notes, and chart-review style mutations.
   - Add tests proving unauthorized roles cannot mutate clinical data.

4. **Migration-order cleanup**
   - Follow up on the known migration ordering issue around versioned migrations / `tenant-schema.sql` / old index references.
   - This is important before relying on clean fresh deploys or new tenant setup.

5. **Regression test PR / branch**
   - Keep or merge `test/post-merge-smoke-regressions` after confirming branch status.
   - The branch adds source-text guards for schema-sync, patient identity proof, portal link upsert and legacy pharmacy defaults.

### Should do before polished hospital demo

1. Rename dashboard chart wording from **Revenue Trend** to **Collection Trend** where the data source is income/deposits rather than gross bill revenue.
2. Add an Admin **Cash Control Summary** card using `/api/dashboard/cash-control`.
3. Add **Last updated** timestamp to auto-refresh widgets.
4. Improve Dashboard header user display name/email instead of user ID only.
5. Verify Reception Support button is real helpdesk API, not mock toast, on the actual deployed code.

---

## 3. Phase-by-phase review

## Phase 1 — Backend foundation, routing, tenant, auth, RBAC

**Status:** Mostly ready after hardening.

### What is good
- Tenant routes are mounted behind tenant + auth middleware for protected `/api/*` paths.
- Admin routes have a separate auth path and admin route handling.
- Dashboard API is role-gated for hospital admin / MD / director / manager / accountant.
- Many previously weak RBAC paths were closed during the hardening merge.

### Remaining concern
- P0-09 remains open for clinical mutation routes.
- Frontend route protection should not be considered a substitute for backend permissions.

### Decision
- Suitable for demo/pilot.
- Do not call clinical write security fully complete until P0-09 is closed.

---

## Phase 2 — Database, migrations, schema sync, local/cloud sync

**Status:** Improved but needs final migration-order cleanup.

### What is good
- Migration manifest build exists and is part of build/deploy scripts.
- Schema-sync hardening was added before the P0 merge.
- `/sync/apply-approved` route wiring was fixed to use the approved apply handler, not the dry-run/sync handler.

### Remaining concern
- Migration-order cleanup is still a follow-up.
- Fresh database bootstrap / new tenant setup should be tested before broad rollout.

### Required checks
```bash
pnpm build:migrations
```

### Decision
- Good enough for demo and existing pilot if current DB is healthy.
- Before broad production/new-hospital rollout, run fresh setup/migration smoke.

---

## Phase 3 — Clinical core / EMR

**Status:** Functional, but RBAC follow-up remains.

### What is good
- Patient, visit, chart, prescription and clinical modules are broad and integrated.
- Prescription and patient/doctor ownership validation were hardened during the clinical-LIS-RIS work.
- Patient history/timeline concepts are strong.

### Remaining concern
- P0-09: explicit permission gates for clinical mutation routes are still required.
- This is not only cybersecurity; it prevents reception/accounting/non-clinical users from accidentally modifying clinical records.

### Decision
- Demo-ready.
- Clinical mutation protection must be closed before multi-role real use at scale.

---

## Phase 4 — LIS / Laboratory

**Status:** Production-pilot ready after hardening, pending smoke.

### What is good
- Lab catalog/order/result/report workflow is integrated.
- Granular lab permissions were added during hardening.
- Lab order creation now has stronger ownership/transaction concepts.

### Remaining concern
- Real lab workflow smoke still matters: order → billing → sample → result → verify → print/delivery.
- Machine integration/QC workflows should be demo-tested only if the hospital needs them immediately.

### Decision
- Ready for normal demo/pilot.
- Advanced LIS should be activated department-by-department.

---

## Phase 5 — RIS / Radiology / procedure orders

**Status:** Mostly ready for demo/pilot.

### What is good
- Radiology order/report/catalog/PACS concepts exist.
- Hardening removed broad doctor access for sensitive radiology catalog/report actions.

### Remaining concern
- DICOM/OHIF requires environment/config readiness.
- Procedure-order/result mutation gates should be checked again with P0-09 follow-up.

### Decision
- Demo-ready if using normal radiology order/report workflow.
- PACS/DICOM must be separately configured before promising live DICOM viewer.

---

## Phase 6 — Billing, cash drawer, collection, handover, accounting

**Status:** Strongest business-critical area, but UI polish recommended.

### What is good
- Billing, payment, deposit, credit note, cancellation/refund, handover and posting concepts exist.
- Admin dashboard tracks collection, expenses, due, discount, live cash drawers and audit feed.
- `/api/dashboard/cash-control` provides deeper cash-control metrics:
  - bill cash in
  - refund cash out
  - manual cash in/out
  - cash drop
  - handover collected
  - active expected cash
  - pending handover
  - closed variance
  - approved expenses
  - unclassified cash-out count
  - pending/failed posting events

### Remaining concern
- The deep cash-control numbers are not all surfaced clearly on the top Admin/MD dashboards.
- Hospital owners will understand the system better if the top dashboard shows:
  - Bill Cash In
  - Refund / Cash Out
  - Manual Cash Movement
  - Pending Handover
  - Cash Short/Excess Variance
  - Net Cash Position

### Decision
- Good enough for demo/pilot.
- Add Cash Control Summary card for best presentation.

---

## Phase 7 — Pharmacy + inventory

**Status:** Ready for demo/pilot after canonical hardening.

### What is good
- Pharmacy inventory, stock, invoice, prescription, purchase, GRN, returns, narcotics, expiry and stock reports are present.
- Legacy pharmacy `/sales` and `/billing` defaults were fixed to preserve normal cash sale behavior after canonical routing.

### Remaining concern
- Run smoke specifically for sale → stock deduction → receipt → report.
- Verify old and new pharmacy paths do not diverge in live data.

### Decision
- Demo-ready.
- Controlled pilot should start with a small pharmacy dataset and stock audit.

---

## Phase 8 — IPD, OT, nursing, CSSD, ward services

**Status:** Functional, but activate carefully by module.

### What is good
- IPD/admission/bed/billing/nursing/OT/CSSD concepts exist and were hardened significantly.
- Bed allocation and OT/CSSD/nursing governance had P0 fixes.

### Remaining concern
- These are operationally complex modules. Real hospital rollout should be staged:
  1. Reception/OPD/Billing
  2. Pharmacy/Lab
  3. IPD/bed
  4. OT/nursing/CSSD

### Decision
- Demo-ready.
- Do not promise full nurse/OT/CSSD live operation without department-level training and workflow smoke.

---

## Phase 9 — Patient portal, PHR, consent, global identity, MPI

**Status:** Safer after hardening, but proof/claim workflows remain intentionally conservative.

### What is good
- Patient portal and global health architecture exist.
- Hospital link/consent privacy was hardened.
- Patient identity proof promotion was disabled until real server-side proof validation exists.

### Remaining concern
- Patient self-service identity verification is not fully live while proof validation is disabled.
- This is correct for safety, but the demo story should be clear: hospital-linked portal access works only through verified/pending-safe flows.

### Decision
- Demo-ready for controlled patient portal flows.
- Do not market “fully automated patient identity claim” until proof validation is implemented.

---

## Phase 10 — Frontend architecture, role dashboards, PWA/offline/mobile

**Status:** Good architecture; some production polish remains.

### What is good
- React lazy routes, protected routes, dashboard layout, sidebar, mobile bottom nav, sync/offline indicators and command palette exist.
- Role dashboards are broad: admin, reception, doctor, MD, director, pharmacy, lab, nurse, accountant.
- Admin dashboard is modular widget-based.
- MD dashboard has management KPIs, trend, alerts, quick links, bed/staff sections.

### Remaining concern
- Header uses user ID rather than a friendly name/email in some places.
- Some older docs/tests may still reference old page names.
- Reception support button status must be verified against actual `main` / deployed code.

### Decision
- Demo-ready.
- Polish before sales demo if possible.

---

## Phase 11 — Testing, CI/CD, deploy, observability, backup

**Status:** Improved but not complete.

### What is good
- `package.json` has build, migration, production unit, E2E, smoke and deploy scripts.
- `deploy:production` runs build, uploads schema manifest and then deploys production.
- Production unit gate exists.

### Remaining concern
- Production E2E scripts still reference workers.dev in `package.json`; this conflicts with the custom-domain production setup.
- Full TypeScript baseline cleanup remains separate.
- Staging/custom-domain smoke must be the final deploy gate.

### Required minimum gates
```bash
pnpm build:migrations
pnpm test:production:unit
pnpm build
```

### Recommended smoke
```bash
BASE_URL=https://hms.ozzyl.com ALLOW_PROD_E2E=1 pnpm exec playwright test --project=smoke
```

### Decision
- Good enough for controlled demo.
- Fix prod E2E base URL scripts and run custom-domain smoke before full rollout.

---

## Phase 12 — Admin/MD dashboards and hospital-facing monitoring

**Status:** Strong demo point, but improve labels/drill-down for clarity.

### Admin Panel story
The Admin dashboard is the operational control room:
- Today collection
- Today expense
- Outstanding due
- Today discount
- OPD/IPD patient counts
- Action Required alerts
- Live cash drawer/counter monitoring
- Payment method breakdown
- Operations snapshot
- Audit feed

### MD Panel story
The MD dashboard is the owner/management summary:
- Today income
- Today expense
- Estimated today profit
- Total staff
- Monthly income/expense/profit
- Alerts and exceptions
- 7-day collection trend
- Bed occupancy
- Staff/department insights

### Monitoring capability verdict
The system can monitor cash collection, due, expenses, handover and profit/loss at a useful level. For hospital owners, the biggest improvement is making the cash-control endpoint visible as a summary card on the Admin/MD dashboard.

---

## 4. Current recommended work order

1. **Confirm actual deployed support-button state / PR #132**
   - If main still has only mock toast, merge the real helpdesk API wiring.
2. **Fix production E2E scripts away from workers.dev**
   - Replace hardcoded workers.dev with custom-domain instructions or env-driven scripts.
3. **Run custom-domain health + smoke**
   - `hms.ozzyl.com`, `app.ozzyl.com`, `admin.ozzyl.com`.
4. **Add Admin Cash Control Summary card**
   - Use `/api/dashboard/cash-control`.
5. **Close P0-09 clinical RBAC**
   - `fix/clinical-routes-rbac`.
6. **Migration order cleanup**
   - `fix/migrate-order-cleanup`.
7. **TypeScript baseline cleanup**
   - `fix/typescript-baseline-cleanup`.

---

## 5. Final current verdict

**Project is close.** It is not a rough prototype anymore; it is a broad HMS platform with serious operational coverage.

Use this positioning:

> “Ozzyl HMS is ready for controlled hospital demo and pilot. The core daily workflows are usable, and the admin/MD dashboards can monitor collection, due, cash drawers, expenses, audit and profit/loss. Before broad production rollout, we will complete custom-domain smoke, clinical RBAC follow-up, migration-order cleanup and final dashboard polish.”

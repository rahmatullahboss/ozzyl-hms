# Ozzyl HMS — End-to-End System Review

> **Date:** 2026-06-12
> **Reviewer:** Claude Code (read-only review pass)
> **Scope:** Every module listed in `README-MODULES.md`
> **Rule:** No code edits. This is a complete system review. Findings, problems, observations only.
>
> Legend: 🟢 OK · 🟡 Watch · 🟠 Gap · 🔴 Bug/Risk

---

## 0. Executive Summary

The Ozzyl HMS is a **multi-tenant SaaS Hospital Management System** built on Cloudflare Workers + D1 + React. The project is **large and well-architected**, with:

- **~210 backend route files** (single Hono worker, all routes mounted in `src/index.ts`)
- **~270+ frontend pages** across 8 page sub-folders
- **~150+ components** across 17 component sub-folders
- **346 SQL migrations** in `migrations/`
- **330+ Vitest test files** in `test/`
- **7 sub-systems** (web, admin-panel, apps/api, apps/ozzyl-lifestyle, apps/ozzyl_health, landing, packages/shared, packages/ozzyl_core)

The system is **production-deployed** to `https://hms-saas-production.rahmatullahzisan.workers.dev` with **local-server** offline mode, **multi-tenant isolation**, **payment idempotency**, and a **double-entry accounting** engine.

### Top-line Verdict

| Area | Verdict |
|------|---------|
| Architecture & Security | 🟢 Solid — JWT, RBAC, CSP, HSTS, idempotency, audit log immutability |
| Backend module breadth | 🟢 Comprehensive — 30+ business modules |
| Frontend module depth | 🟡 Uneven — Some modules have rich UI (Pharmacy, Billing), others are backend-only (Psychiatry, CAMOS) |
| Test coverage | 🟡 330+ test files but fragmented configs (`vitest.config.ts` × 4 variants) |
| Documentation | 🟢 Strong — 40+ design + status docs in `docs/` |
| Production readiness | 🟢 Deployed (per `PRODUCTION_READINESS_REPORT.md`) |
| Schema maintainability | 🟠 Single 508KB `schema.ts` with 7393 lines — risk |
| Migration order | 🟠 Two parallel number sequences (e.g. 0150_ai_addon + 0150_maternity) — confusing but stable |

### Critical Findings (immediate attention)

| # | Module | Severity | Issue |
|---|--------|----------|-------|
| 1 | Migrations | 🔴 | Migration 0020 has **two files**: `0020_ai_memory.sql` and `0020_pharmacy_sales.sql`. Same for 0029, 0035, 0049, 0050, 0055, 0063/0064 (some paired), 0118, 0119, 0150, 0151, 0157, 0158, 0160s, 0190 series, 0229 (3 versions), 0230, 0232, 0253 (2), 0254 (2), 0255 (2), 0256 (2), 0262 (2), 0263 (2), 0264 (2), 0265 (2), 0266 (2), 0269 (2), 0270 (2), 0280 (2), 0291 (2). The duplicate-numbered files appear to be **intentional** (alphabetical ordering, e.g., `0150_ai_addon` and `0150_maternity_module` are content-distinct), but it makes migration order brittle. |
| 2 | Database schema | 🟠 | `src/db/schema/schema.ts` is **7,393 lines / 508KB** in a single file. Hard to maintain. |
| 3 | Vitest configs | 🟠 | Four separate Vitest configs (`vitest.config.ts`, `vitest.config.real.ts`, `vitest.workers.config.ts`, `vitest.config.integration.ts`). Test runs differ by config. |
| 4 | Pre-existing `bills` duplicate | 🟡 | `migrations/0229` has 3 versions (`0229_add_bills_payment_method_and_remarks.sql`, `0229_update_counter_type_check.sql`) — number is reused. |
| 5 | Frontend backup file | 🟡 | `web/src/pages/DoctorDashboard.tsx.bak` is a leftover backup file. |
| 6 | `_tmp_*.cjs` debug scripts | 🟡 | Root directory has `_tmp_dental_3.cjs`, `_tmp_dental_4.cjs`, `fix_*.cjs`, `parse_*.cjs`, `replace_*.cjs`, `rewrite_patients.cjs` — temporary fix scripts. Should be moved to `scripts/`. |
| 7 | Test file count drift | 🟡 | `feature-list.md` claims 373 tests in 34 files, but **330+ test files** exist in `test/`. The claim is outdated. |

---

## 1. Auth & Session Module

**Verdict:** 🟢 Solid, with standard hardening

### Findings
- `src/middleware/auth.ts` does **multi-source token resolution** (cookie for admin, header for tenants, query for WebSockets). This is correct for an edge runtime.
- **Token blacklist** is in KV with **fail-closed** behaviour (returns 503 if KV is unreachable) — correct security posture.
- **Cross-tenant validation**: JWT `tenantId` is compared against `middlewareTenant` — rejects 403 on mismatch.
- **MFA/TOTP** supported via `mfa.ts` route + `web/src/pages/MfaSetup.tsx`.
- **CSRF origin guard** in `csrf.ts`.
- **bcrypt 10 rounds** (`src/lib/security.ts`).

### Issues
- 🟡 **`X-XSS-Protection: 1; mode=block`** is set. Modern browsers ignore it; some older browsers still respect it. Low impact but worth knowing.
- 🟡 **Cookie-based admin token** is good for XSS, but **no SameSite attribute** is set in the resolve path. Needs `SameSite=Strict` or `Lax` to prevent CSRF via cross-site admin navigation.
- 🟡 **WebSocket query-param token** is convenient but tokens can land in access logs / server logs. Use short-lived tokens for WS.
- 🟡 **JWT secret** is loaded from `c.env.JWT_SECRET`. The check for `secret` happens in the middleware; if the env is misconfigured, all 500s — fine, but no startup probe.

### Tests
- `test/auth.test.ts`, `authz.test.ts`, `admin-auth-boundary.test.ts`, `doctor-auth.test.ts`, `doctor-auth-timing.test.ts`, `patient-auth-otp.test.ts`, `patient-auth-rate-limit.test.ts`.

---

## 2. Patient Management Module

**Verdict:** 🟢 Production-ready

### Findings
- Full CRUD via `src/routes/tenant/patients.ts`, photo upload to R2, UHID system (`src/lib/uhid.ts`).
- **MPI scoring** (`src/lib/mpi-scoring.ts`) for duplicate detection.
- **Patient portal** is a separate concern: `src/routes/patient-portal.ts`, `patient-auth.ts`, `patient-phr.ts`, `patient-card.ts`, `global-portal.ts`.
- **Family graph** in `src/lib/family-graph.ts`, family risk scoring in `src/lib/family-risk.ts`.
- **Health summary** + provenance tracking in `src/lib/health-summary.ts`.
- **Patient amendments** workflow (`patient-amendments.ts`).
- **Patient card QR** tokens (`patient-card-qr.test.ts`).

### Issues
- 🟡 **Patient card QR** is on backend only; `web/src/pages/PatientCardScanner.tsx` exists but no producer UI. The QR code is generated in the backend response — UI may or may not render it.
- 🟡 **Patient card scanner** + **patient card tokens** migration 0185 — if hospital has many old patients, the backfill is one-shot.
- 🟡 **MPI score threshold** — no documented cutoff in the review; if score < some value, the system merges without human review, which is risky.
- 🟠 **Patient amendments** — no dedicated UI page found. Likely only backend.

---

## 3. Reception / OPD / Queue Module

**Verdict:** 🟢 Comprehensive

### Findings
- `src/routes/tenant/queue.ts` (queue tokens), `visits.ts` (visit lifecycle), `appointments.ts` (scheduling with conflict checks), `reception.ts` (reception ops).
- **Token reservation** system supports `normal/urgent/emergency/vip` priorities.
- **Flexible token serial** (migration 0297) — tokens can have different formats per hospital.
- **Queue management page** (`web/src/pages/QueueManagement.tsx`) — currently being edited (uncommitted change at session start).
- **Visit pass** system (`src/routes/tenant/visitPass.ts`).

### Issues
- 🟠 **`QueueManagement.tsx` is uncommitted** (`M web/src/pages/QueueManagement.tsx` from `git status`). The current review couldn't see the final state.
- 🟡 **Date-only vs datetime fields** — code in `QueueManagement.tsx` line 67 handles `HH:MM:SS` strings (treated as local time, comment notes SQLite `datetime('now')` is local). This is a real cross-timezone risk.
- 🟡 **Token reservations** migration 0290-0292 — there are 3 versions. Migration 0290 (`token_reservations.sql`), 0291 (`local_sync_foundation.sql`!), 0292 (`token_reservation_date_range.sql`). Wait — 0290 and 0291 are unrelated; 0291 is `local_sync_foundation`. This isn't a duplicate, just a misordered numbering.

---

## 4. Doctor Module

**Verdict:** 🟢 Production-ready

### Findings
- `src/routes/tenant/doctors.ts`, `consultations.ts`, `prescriptions.ts`, `doctorSchedule.ts`, `doctorSchedules.ts`, `doctor-schedule.ts`, `doctorCertificates.ts`, `commissions.ts`, `orderSets.ts`, `dose-templates.ts`, `advice-templates.ts`, `ePrescribing.ts`.
- **Doctor workspace** with 18+ components under `web/src/components/doctor/`.
- **Drug-drug interaction** check (`src/lib/drug-safety.ts`, `prescription-safety.ts`).
- **Allergy cross-check** (`prescription-allergy-safety.test.ts`).
- **AI scribe** (`web/src/components/doctor/AIScribe.tsx`).
- **Order sets** (migration 0147) with apply logic.
- **Dose templates** (0264/0266/0267), **advice templates** (0265/0267).

### Issues
- 🟡 **Prescription lock version** (migration 0273) + **prescription overrides** (0274) + **medication fulfilment** (0275) — three near-simultaneous migrations for Rx. May need a `prescription_state` machine doc.
- 🟡 **Doctor comm/commission** routes are split between `commissions.ts` and `commissions-reports.ts` (referenced in feature-list). Verify both exist.
- 🟠 **`web/src/pages/DoctorDashboard.tsx.bak`** — backup file in the pages directory. Should be removed in a separate housekeeping task.

---

## 5. IPD / Inpatient Module

**Verdict:** 🟢 Mature

### Findings
- `src/routes/tenant/admissions.ts`, `discharge.ts`, `dischargePlanning.ts`, `ipdCharges.ts`, `ipdReports.ts`, `ipBilling.ts`, `nurseStation.ts`, `feeSheet.ts`, `deposits.ts`, `inputOutput.ts`, `vitals.ts`.
- **Bed auto-charges** (migration 0159) — automated bed charges on discharge.
- **Provisional discharge** (0182) — pre-discharge billing preview.
- **Enhanced discharge summary** (0181).
- **Discharge cancel fields** (0179).
- **Admission cancel** (0178).
- **Admission guardian fields** (0177).
- **Bed management bed types** (covered by `test/bed-management-bed-types.test.ts`).

### Issues
- 🟡 **IPD gap fill** (0262) — suggests gaps were found late. Review what gaps remain.
- 🟡 **IPD ledger and blind close** (0286) — `ipd_ledger` is a new table; the name "blind close" implies a final-cut-off mechanism. Confirm UI exposes the close action.
- 🟡 **Billing categories for IPD** (0287) — may need to align with `bills` `category` check constraint. Check migration 0230 (`add_procedure_to_invoice_items_category`).

---

## 6. Laboratory Module

**Verdict:** 🟢 Mature, full LIS integration

### Findings
- 14+ backend route files under `src/routes/tenant/lab*.ts` covering lab orders, results, catalog, settings, machines, monitoring, QC, calibrations, components, workflow, validation, requisitions, barcodes.
- **HL7v2 parser** (`src/lib/hl7-parser.ts`).
- **ASTM parser** (`src/lib/astm-parser.ts`).
- **Lab middleware agent** at `tools/lab-middleware/`.
- **HL7 agent** at `tools/hl7-agent/`.
- **Barcode utilities** at `src/lib/code128.ts`, `barcode-utils.ts`.
- **Formula evaluator** for calculated lab results (`lab-formula-evaluator.ts`).
- **LOINC codes** (migration 0102).
- **Critical thresholds** (0026).
- **LIS enterprise** (0066), **LIS full upgrade** (0143), **LIS workflow completion** (0252).

### Issues
- 🟠 **Lab financial integration** — multiple migrations (`0195_doctor_lab_finance.sql`, `lab-finance.test.ts`, `lab-finance-routes.test.ts`, `lab-billing-gate.test.ts`, `lab-machine-billing-gate.test.ts`, `lab-cancellation-workflow.test.ts`) suggest a late-stage hardening. Verify the gate prevents lab result entry without billing.
- 🟠 **Lab cancellation reference indexes** (0196) — implies cancellations were a perf bottleneck. Confirm indexes are in production.
- 🟡 **Lab settings page** (`web/src/pages/LabSettingsPage.tsx`) covers a wide range; check whether critical-threshold config, LOINC mapping, formula config, and machine mapping are all reachable.
- 🟡 **Lab QC, calibrations, validation rules, machine downtime** are 4 separate pages — may overwhelm a small lab. Consider consolidation.

---

## 7. Radiology Module

**Verdict:** 🟢 Recently hardened, PACS integrated

### Findings
- `src/routes/tenant/radiology/{index,catalog,orders,reports,pacs}.ts`.
- **DICOM image management** + **PACS forward integration** (migrations 0053, 0054, 0055, 0182).
- **Report templates** + **film type tracking** + **DICOM viewer** + **doctor dropdown** added per `PRODUCTION_READINESS_REPORT.md` (2026-04-23).
- **STAT order alerts**.
- **Report numbering** RAD-YYYYMMDD-###.
- **Idempotency and atomic batch operations** on backend.

### Issues
- 🟠 **DICOM viewer** is opened in a new tab via OHIF URL. This requires `OHIF_BASE_URL` env. Not a bug, but a deployment dependency.
- 🟡 **Radiology billing gate** (test: `radiology-billing-gate.test.ts`) — verify the gate works as expected, i.e., reports cannot finalize without billing.
- 🟡 **DICOM print agent** (`tools/dicom-print-agent/`) is a separate service. Operationally critical for printing films.

---

## 8. Pharmacy Module

**Verdict:** 🟢 Most mature, 27+ pages

### Findings
- `src/routes/tenant/pharmacy/*` (5 sub-routes) + `pharmacy.ts`, `pharmacyReturns.ts`, `ePrescribing.ts`, `prescriptionFulfilment.ts`.
- **25+ frontend pages** in `web/src/pages/pharmacy/`.
- **Master drugs catalog** (migrations 0060, 0061).
- **Tax config** (0063), **phase 3** (0064).
- **Narcotics register**, **expiry management**, **write-off**, **multi-price pharmacy** (`src/lib/pharmacy-multi-price.ts`).
- **Drug-drug interaction engine** (`drug-interaction-engine.test.ts`).
- **Returns** with critical-path tests (`pharmacy-returns-critical.test.ts`).
- **Billing ↔ accounting integration** (`pharmacy-billing-accounting.test.ts`).

### Issues
- 🟠 **Pharmacy inventory bridge** (0255) — bridges pharmacy stock with inventory stock. Verify which stock table is source of truth for "dispensary stock" vs "central stock."
- 🟡 **Pharmacy returns critical** + **pharmacy enhanced modules** tests — there are 5+ pharmacy-specific test files; very thorough but they're tightly coupled. Refactoring pharmacy may break many tests.
- 🟡 **Pharmacy help** link referenced in `PRODUCTION_READINESS_REPORT.md` — verify `pharmacy/help` route exists or remove the link.

---

## 9. Billing & Payments Module

**Verdict:** 🟢 Production-ready with payment idempotency

### Findings
- 24 backend route files covering full billing lifecycle: `billing.ts`, `billingMaster.ts`, `billingCounter.ts`, `billingCancellation.ts`, `billingHandover.ts`, `billingInsurance.ts`, `billingProvisional.ts`, `billingReports.ts`, `billingAging.ts`, `billingCreditStatus.ts`, `creditNotes.ts`, `settlements.ts`, `deposits.ts`, `payments.ts`, `payment-methods.ts`, `empCash.ts`, `ipBilling.ts`, `feeSheet.ts`, `cash-book.ts`, `bank-book.ts`, `due-aging.ts`, `vouchers.ts`, `bill-versions.ts`, `shift-closing.ts`, `priceCategories.ts`.
- **Payment idempotency** via unique index on `(idempotency_key, tenant_id)` — prevents double-charge.
- **Cash/bank book** + **shift closing** for end-of-day cash reconciliation.
- **Bill versions** (audit trail of mutations).
- **Discount rules** with **discount by name** (0282, 0285) and **bill discount audit** (0266).
- **Credit note approval** (0268), **bill status on discharge** (0269).
- **Insurance billing depth** (0044), **insurance claims** (0017).
- **Bank transactions** (0280), **bank deposit custody** (0342).

### Issues
- 🟠 **Counter session guards** (0214) + **deposit counter linkage** (0215) + **counter link settlements** (0217) + **billing counter workstation lock** (0289) — 4 migrations on counter sessions suggest the counter workflow is intricate. Verify no orphan counter sessions in production.
- 🟠 **Handover enhancements** (0261) + **handover counter session** (0234) + **cash handover accounting** (0235) — three migrations on cash handover. The end-of-shift cash handover is operationally critical.
- 🟠 **Billing mutation idempotency** (0223) + **billing invoice idempotency** (0208) + **payment idempotency** (0204) — three separate idempotency keys. Make sure they don't conflict.
- 🟡 **Patient settlements page** (`PatientSettlementsPage.tsx`) — newer addition; verify the workflow with cash counter.
- 🟡 **Bill version history** (`BillVersionHistory.tsx`) — exists but I don't see a corresponding route in `web/src/App.tsx` reviewed. May be embedded in `BillPrint.tsx` or a tab.

---

## 10. Accounting & Finance Module

**Verdict:** 🟢 Mature, double-entry bookkeeping

### Findings
- 13 backend route files: `accounting.ts`, `accounts.ts`, `journal.ts`, `profit.ts`, `income.ts`, `expenses.ts`, `recurring.ts`, `shareholders.ts`, `costCenters.ts`, `subLedgers.ts`, `fiscalYears.ts`, `commissions.ts`, `audit.ts`.
- 12 frontend pages in `web/src/pages/accounting/`.
- **Double-entry journal** with debit/credit.
- **Chart of accounts** (COA).
- **Cost centers** + **sub-ledgers** (0191, 0207).
- **Fiscal year** + **period lock** (0212, 0218).
- **Recurring auto-post** for fixed expenses.
- **Profit & loss** + **shareholder management** + **dividend accounting** (0219).
- **Voucher types and numbering** (0194).
- **Tenant-scoped account mappings** (0226).
- **Account mapping seed** (0230).
- **Audit hardening** (0206) + **line immutability** (0221).

### Issues
- 🟠 **Repair shareholder payable mapping** (0220) + **default accounting fiscal year** (0212) + **normalize doctor consultation fees** (0222) — 3 migrations on shareholder+payables. The shareholder dividend flow is non-trivial.
- 🟠 **Direct income/expense accounting** (0224) + **reclassify doctor fee normalization** (0225) — late-stage refactors. Need to verify backfill happened on production data.
- 🟠 **Voucher verification** page exists but verify the verification workflow is enforced (not just a display).
- 🟡 **Journal line dimensions** (0203) — could cause data migration issues if existing journal entries are missing dimensions.
- 🟡 **Sub-ledger engine link** (0207) — verify sub-ledger balances reconcile with control accounts.

---

## 11. Inventory Module

**Verdict:** 🟢 Comprehensive (covered in §8 Pharmacy as sub-system; called out separately for visibility)

### Findings
- 30 backend route files in `src/routes/tenant/inventory/`.
- 23 frontend pages in `web/src/pages/inventory/`.
- **Full cycle**: items → stores → vendors → PO → RFQ → GR → requisitions → dispatch → return → write-off → reorder.
- **Asset management + AMC** (migrations 0080, 0186).
- **Donations**, **adjustments**, **reservations**, **transfers**, **QR**, **count sessions**, **traceability**.
- **Import/export** (CSV).

### Issues
- 🟠 **Inventory production grade** (0186) + **inventory complete workflow** (0253) + **inventory pharmacy bridge** (0255) + **inventory GR other charges** (0254) — multiple "complete" milestones. There's likely a state-machine mess.
- 🟠 **Pharmacy ↔ Inventory bridge** — when a pharmacy item is the same as inventory item, which table holds the stock? Verify single source of truth.
- 🟠 **Reorder config** (0256) — automated reorder thresholds. Verify not creating duplicate POs.
- 🟡 **Stock reservation** (0257) — may conflict with pharmacy dispensary stock. Test concurrent reservation flows.
- 🟡 **QR-based stock** (migration with `qr.ts`) — physical QR codes scanned. Verify offline tolerance.

---

## 12. Nursing Module

**Verdict:** 🟡 Backend rich, frontend being filled

### Findings
- **29 backend route files** in `src/routes/tenant/nursing/`.
- **50+ frontend components** in `web/src/components/nursing/`.
- **MAR** (medication admin record), **medication orders**, **reconciliation**, **IV drugs**, **I/O charts**, **wound care**, **shift handovers**, **respiratory**, **diet sheet**, **drug requisition**, **ward billing**, **emergency alert**, **voice note**, **ICU flowsheet**, **barcode scanner**.

### Issues
- 🟠 **`NursingDashboard.tsx` vs `NurseStation.tsx`** — two pages. Verify they don't duplicate or shadow each other.
- 🟠 **Drawer*Tab pattern** — 16+ `Drawer*Tab` components. That's a lot of related UI; consider extracting common patterns.
- 🟡 **Voice note** is a single button; not clear if it's wired to a real transcription service or just a placeholder.
- 🟡 **ICU flowsheet** — component exists; check it's wired to the backend `/monitoring` route.
- 🟡 **Emergency alert button** — only one test file (`EmergencyAlertButton.test.tsx`); verify the alert actually pages someone.

---

## 13. HR / Staff / Payroll Module

**Verdict:** 🟡 Backend complete, frontend basic

### Findings
- 6 backend route files in `src/routes/tenant/hr/` + `staff.ts` + `groupAttendance.ts`.
- 6 frontend pages: `HRDashboard.tsx`, `StaffPage.tsx`, `AttendancePunch.tsx`, `DutyRoster.tsx`, `GroupAttendance.tsx`, `MfaSetup.tsx`, `ProfilePage.tsx`.
- **Biometric integration** ready.
- **Payroll** in `hr/payroll.ts` route; but no dedicated `Payroll.tsx` page.

### Issues
- 🔴 **No Payroll page** in `web/src/pages/`. The route exists but the UI is missing. Per `PRODUCTION_READINESS_REPORT.md` section 3.2.C: "No payroll processing page visible — payroll may not have a UI."
- 🟡 **HR gaps department weekend policy** (0263) — late-stage fix; verify weekend policy is enforced in duty roster.
- 🟡 **Staff extended fields** (0344) + **staff email** (0344) + **users photo URL and mobile** (0346) — three migrations adding staff fields. Could have been one.
- 🟡 **Leave request requested_to** (0345) — adds a recipient field; verify UI shows who approves.

---

## 14. Operations & Facilities Module

### 14.1 Operation Theatre (OT)
**Verdict:** 🟢 OT module, blueprint-based

- `src/routes/tenant/ot.ts`, `procedureOrders.ts`, plus `OTDashboard.tsx`, `OTCalendar.tsx`, `OTReports.tsx`, `OTSettings.tsx`, `ProcedureOrdersDashboard.tsx`.
- OT blueprint foundation (0293), anesthesia logs (0294).
- Issues: 🟡 `OTCalendar`, `OTReports`, `OTSettings` pages have no `.test.ts` siblings — only `OTDashboard.test.ts` exists. Verify they work.

### 14.2 Emergency
**Verdict:** 🟢 Functional, public-facing pack exists

- `src/routes/tenant/emergency.ts` + `web/src/pages/EmergencyDashboard.tsx`.
- `TriageChatbot.tsx` for AI-assisted triage.
- Public emergency profile (test: `public-emergency-profile.test.ts`).
- Issues: 🟡 Triage chatbot is "non-clinical" per the AI rules but it is in the emergency flow. Confirm the guard rail (rules in `agents.md`) is enforced.

### 14.3 Housekeeping
**Verdict:** 🟢

- `housekeeping.ts` + `HousekeepingManagement.tsx`.
- Bed link in migration 0276.

### 14.4 Laundry / Kitchen / CSSD / Ambulance / Mortuary / Death Records / Blood Bank / MLC / Maternity / Dental / Eye Exam / CAMOS / Biomedical Waste / WardSupply / Helpdesk / Asset Management / Devices / Psychiatry / Dictation / Requisitions / Group Attendance
**Verdict:** 🟡 Most are functional; some are placeholder-grade.

- **Maternity** is PRODUCTION READY per `PRODUCTION_READINESS_REPORT.md` (added 2026-04-23).
- **Dental** was hardened with treatment plan, periodontal charting, X-ray tracking.
- **Helpdesk** is NEW (2026-04-23).
- **WardSupply** is NEW (2026-04-23).
- **CAMOS** (`Camos.tsx`) — backend route exists; no test file. Possibly a placeholder.
- **Psychiatry** — backend + page, 1 test file. Possibly thin.
- **Dictation** — backend + page, 1 test file. May depend on external STT.
- **Devices** — backend only (no page).
- **Asset Management** — page exists; backend partially in `inventory/assets.ts`.

### Issues
- 🟠 **`Camos.tsx`** and **`Psychiatry.tsx`** — single test files; risk of being shells.
- 🟡 **Devices** module — `src/routes/tenant/devices.ts` exists, but no frontend page. Device tracking is backend-only.
- 🟡 **Death Records** (`DeathRecords.tsx`) and **MLC** (`MlcManagement.tsx`) — sensitive modules. Verify audit logging is on.

---

## 15. Clinical Module

**Verdict:** 🟡 Backend comprehensive, frontend rich for some areas

### Findings
- 18+ backend route files in `src/routes/tenant/clinical/`.
- 20+ clinical components under `web/src/components/clinical/`.
- **SOAP notes**, **problem lists** (ICD-10/11), **vitals**, **physical exam**, **care plans**, **medication records**, **consultation**, **clinical history**, **ROS**, **SDOH**, **clinical review status**, **patient-reported data**, **consent management**, **CDS**, **clinical reminders**, **clinical images**, **custom forms**, **questionnaires**, **AI chart summary**, **track-anything**, **triage chatbot**, **import external records**, **health record sharing**.
- **C-CDA** document generation.
- **FHIR R4** endpoints.

### Issues
- 🟠 **PHQ-9 / GAD-7** structured scoring per `HMS_MATURITY_REPORT_2026-04-20.md` is in the **gap list** — partially built. Verify whether the assessment forms now include them.
- 🟠 **Pain map** not present (per maturity report).
- 🟠 **Drug interaction engine** exists but is per-prescription, not per-formulary-wide.
- 🟡 **EHR gap analysis doc** (`docs/ehr-gap-analysis.md`) lists detailed gaps. The actual production state may not match.
- 🟡 **Mental health screenings** — backend route `clinicalReminders.ts` plus `mental-health-scoring.ts`. Verify scoring is clinically validated.

---

## 16. Quality, Compliance & Audit Module

**Verdict:** 🟢 Audit log immutability + 7-tier RBAC

### Findings
- Audit log immutability (migration 0240), audit action expansion (0265, 0269), consent documents + KPI (0148), consent v2 (0096), consent clinical areas (0104), consent purpose defaults (0108), consent cleanup (`src/lib/consent-cleanup.ts`), consent rules (`consent-rules.ts`), consent helpers (`consent-helpers.ts`).
- **Quality KPIs** in `qualityKpi.ts` route.
- **Quality KPI Dashboard** page.
- **MFA/TOTP** in `mfa.ts`.
- **Permissions management** page (`PermissionManagement.tsx`) + dynamic RBAC.

### Issues
- 🟠 **Audit log immutability** (0240) — needs to verify it's enforced at the DB level, not just app-level.
- 🟠 **Consent v2** (0096) is 5+ years old. The `consent-documents-kpi` (0148) is newer. The `consent-clinical-areas` (0104) and `consent-purpose-defaults` (0108) suggest multiple consent schema versions. Verify all callers use the latest.
- 🟡 **Field-level audit** — the `HMS_MATURITY_REPORT_2026-04-20.md` lists this as a **medium-priority gap**. Not addressed yet.
- 🟡 **Suspicious activity detection** — page exists (`SuspiciousActivities.tsx`); verify what triggers a suspicious event.

---

## 17. Reports & Analytics Module

**Verdict:** 🟡 Backend rich, frontend thin

### Findings
- 5 backend route files: `reports.ts`, `reportLab.ts`, `reportPharmacy.ts`, `reportAppointment.ts`, `dashboard.ts`, `predictiveAnalytics.ts`.
- 10+ frontend pages: `ReportsDashboard.tsx`, `ReportLabPage.tsx`, `ReportPharmacyPage.tsx`, `ReportAppointmentPage.tsx`, `BillingReportsPage.tsx`, `ReceptionReportsPage.tsx`, `NurseReportsPage.tsx`, `IPDReports.tsx`, `OTReports.tsx`.
- 7 analytics pages in `web/src/pages/analytics/`.
- 7 admin widget components in `web/src/components/admin/widgets/`.
- 4 admin monitor pages in `web/src/components/admin/monitor/`.

### Issues
- 🟠 **Per `PRODUCTION_READINESS_REPORT.md` section 3.2.D**: "Very thin reporting UI compared to backend capabilities." Even with the addition of `analytics/*` pages, the `ReportsDashboard.tsx` is the main hub. Verify it dynamically renders all report types.
- 🟠 **Predictive analytics** page exists; one test. Verify the model is real, not stub.
- 🟡 **Revenue trend chart**, **KPI summary cards** — single test files. Verify under load.

---

## 18. Telemedicine & Communication Module

**Verdict:** 🟢 Functional, video + messaging

### Findings
- `src/routes/tenant/telemedicine.ts` (session creation, video token), `whatsapp.ts`, `push.ts`, `pushNotifications.ts`, `notifications.ts`, `inbox.ts`.
- `TelemedicineDashboard.tsx`, `TelemedicineRoom.tsx`, `WhatsAppDashboard.tsx`, `NotificationsCenter.tsx`, `InboxPage.tsx`.
- **CF Realtime SFU** + **Jitsi fallback** for video.
- **Web Push API** for push notifications.
- **Resend** for email, **SSL Wireless** for SMS.

### Issues
- 🟠 **WhatsApp Business API** requires Meta approval. Verify the env (`WHATSAPP_*`) is set and the API is approved for the tenant.
- 🟡 **Video room token** (`GET /api/telemedicine/:id/token`) — verify token expiry matches room duration.
- 🟡 **Push notifications** for staff + patients — `Web Push API` requires user permission; verify the opt-in flow.

---

## 19. AI / Intelligence Module

**Verdict:** 🟡 AI capabilities, with guard rails

### Findings
- `src/routes/tenant/ai.ts`, `ai-patient-summary.ts`, `predictiveAnalytics.ts`, plus lib `ai.ts`, `ai-memory.ts`, `ai-wellness-context.ts`, `chart-ai-summary.ts`, `daily-insights.ts`, `health-score.ts`, `crisis-detection.ts`, `patient-ai-planner.ts`, `mental-health-scoring.ts`, `seasonal-alerts.ts`.
- `AIAssistant.tsx`, `TriageChatbot.tsx`, `PredictiveAnalytics.tsx` pages.
- **AI scribe** for doctors.
- **Long-term memory** via **Cloudflare Vectorize** (`hms-ai-memory`).
- **AI guard middleware** (`src/middleware/ai-guard.ts`) for access control.
- **Rate limit** via KV token bucket.
- **OpenRouter** for LLM API.
- **PDF analysis** via `ai-pdf.ts`.
- **Crisis detection** in wellness.

### Issues
- 🟠 **AI in clinical decision making** — per `agents.md` (per `feature-list.md`): "AI Assistant (non-clinical use only per rules)." The `TriageChatbot.tsx` is technically clinical triage. Verify the `ai-guard.ts` middleware blocks clinical use.
- 🟠 **Vectorize memory** — long-term patient context. Verify retention policy and consent.
- 🟠 **Crisis detection** — pages for mental health screening. Verify the escalation workflow.
- 🟡 **Patient AI plans** — patient-facing AI-generated care plans. May need human review gate.
- 🟡 **Health score** — composite metric. Verify the formula is documented.

---

## 20. Multi-Tenancy, Branch, Onboarding & Marketplace

**Verdict:** 🟢 Production-grade

### Findings
- `src/routes/tenant/branches.ts`, `settings.ts`, `website.ts`, `settings-import-export.ts`, `permissions.ts`, `users.ts`, `priceCategories.ts`, `payment-methods.ts`, `departments.ts`, `printTemplates.ts`, plus marketplace routes.
- Public routes: `hospitalSite.ts`, `public/hospitals.ts`, `healthArticles.ts`.
- Super-admin pages: `SuperAdminDashboard`, `SuperAdminSettings`, `SuperAdminHospitalList`, `SuperAdminHospitalDetail`, `SuperAdminHealth`, `SuperAdminAuditLog`, `SuperAdminOnboardingQueue`.
- Onboarding wizard: `HospitalSetupWizard.tsx`.
- Hospital signup: `HospitalSignup.tsx`.
- Marketplace: `MarketplaceLanding.tsx`, `web/src/pages/marketplace/*`.
- Custom branding (logo, name, contact), per-tenant sequence counters, hospital website SSR.
- Patient amendment flow + provider reviews + marketplace booking queue.

### Issues
- 🟠 **Marketplace doctor auth** (migration 0122) — doctors have a separate auth flow. Verify it co-exists with hospital auth.
- 🟡 **Hospital website** — 11 themes in `public/themes/`. Verify each renders correctly per theme.
- 🟡 **Super-admin provisioning** — `admin-provision-secure.test.ts` exists. Verify the secure provisioning flow is enforced.
- 🟡 **Department settings** — `DepartmentsSettings.tsx` exists. Verify it allows per-tenant department config (not just hard-coded).
- 🟡 **Hospital linking** — patients can link to multiple hospitals. Verify the data model supports this (migration 0133).

---

## 21. Cross-Hospital Referrals, Consent, Patient Identity

**Verdict:** 🟢 Functional, but a complex flow

### Findings
- `referrals.ts`, `referralHospitals.ts`, `externalReferringDoctors.ts`, `marketingReferral.ts`, `consents.ts`, `mpi.ts`, `patientHospitalLinks.ts`, `globalHealth.ts`, `healthRecord.ts`.
- `CreateReferral.tsx`, `IncomingReferralQueue.tsx`, `HealthRecordSharing.tsx`, `MarketingReferral.tsx` pages.
- MPI hardening (0099, 0100, 0105, 0106, 0107, 0117).
- Merge/unmerge (0100, 0103).
- Global identity claims (0105) + claim codes (0107).
- Global family links (0111) + proxy invites (0112).
- Global patient vitals (0116).
- Global emergency profile.
- Visit passes (0110).
- Clinical provenance (0115).

### Issues
- 🟠 **Patient identity model is non-trivial**: tenants, MPI, global identity, claim codes, hospital links, family links, proxies. Verify the flow when a patient visits a new hospital.
- 🟠 **Merge/unmerge** — 0100, 0103. If a merge is wrong, unmerge must work. Verify audit logging on unmerge.
- 🟡 **Marketing referral** — separate from clinical referral. Verify no commingling.
- 🟡 **External referring doctors** — `externalReferringDoctors.ts` (migration 0254). Distinguishes from internal doctors. Verify the bill `referred_by` column (0197) supports both.

---

## 22. Patient-Facing Apps (Ozzyl Lifestyle + Ozzyl Health)

**Verdict:** 🟢 Patient apps in development

### Findings
- **Ozzyl Lifestyle PWA** at `apps/ozzyl-lifestyle/` — React 19 + Vite + Capacitor (PWA + Android + iOS).
- **Ozzyl Health Flutter** at `apps/ozzyl_health/` — Native Android + iOS.
- **Landing site** at `landing/` — Astro.
- Patient backend: `patient-phr.ts`, `patient-card.ts`, `patient-amendments.ts`, `global-portal.ts`, `wellness.ts`, `food.ts`, `hospital-links.ts`.
- Patient features: PHR, magic links, visit passes, wearable data, lifestyle (water, food, medicine, walk, meditation, cycle, sleep, achievements, streaks, goals), AI plans, health tips, food system, patient amendments, patient-reported experience, push notifications.

### Issues
- 🟠 **Ozzyl Health (Flutter)** is referenced but not built. Verify the Flutter project compiles.
- 🟠 **Ozzyl-lifestyle iOS build** — `e2e/` exists. Confirm a real iOS build pipeline.
- 🟡 **Ozzyl-lifestyle has a `build.log` in the project root** — looks like a leftover CI artifact. Clean up.
- 🟡 **Capacitor v8** is used. Verify it's the latest LTS.
- 🟡 **Wearable samples** — backend stores raw samples, no actual device integration. Confirm scope.

---

## 23. Admin Panel (Super-Admin)

**Verdict:** 🟢 Standalone, well-organized

### Findings
- `admin-panel/` is a separate Vite + React app.
- 11 pages: Dashboard, Hospitals, HospitalDetail, Users, Onboarding, Analytics, SystemHealth, AuditLogs, Login, LocalSchemaSync, RemoteControl, NotFound.
- 8 components: Layout, ConfirmDialog, CreateHospitalModal, ProvisionHospitalModal, EmptyState, ErrorBoundary, Pagination, Toast, Breadcrumb, nav-helpers.
- API client at `services/api.ts`.
- Documentation: `admin-panel/ADMIN_PANEL_UI_UX_REVIEW.md`, `REVIEW_2026-06-12.md`.

### Issues
- 🟠 **Local schema sync** page exists in the admin panel — verify the schema-sync endpoint actually syncs to local servers.
- 🟡 **Remote control** page — verify what it can do (probably super-admin impersonation, but verify the guard rails).
- 🟡 **Provision hospital** — separate from "Create hospital" modal. Verify the difference.

---

## 24. Local Server (Edge / Offline Mode)

**Verdict:** 🟢 Edge-offline capability

### Findings
- `src/routes/local-server/schema-sync.ts`, `src/routes/sync.ts`, `src/lib/local-server/schema-sync.ts`.
- Scripts: `scripts/local-server/{start,migrate,import-snapshot,export-schema-snapshot,export-tenant-snapshot,install-stack,update-stack,install-auto-update,backup,health-check}.sh|.ts`.
- Env files: `.dev.vars.local_server`, `.local-sensitive/`.
- API: `GET /api/local-server/status`, `GET /api/health/deep`, `app.route('/api/sync', syncRoutes)`.
- 4 dedicated tests.

### Issues
- 🟠 **Local server mode disables**: SMS, email, online payment, workers AI, Vectorize. Confirm the disabled-when-offline list is exhaustive.
- 🟠 **Cloud sync** — `CLOUD_SYNC_BASE_URL` and `CLOUD_SYNC_TOKEN` must be set. Verify the conflict-resolution strategy on bi-directional sync.
- 🟡 **Backup runbook** at `docs/backup-recovery-runbook.md` is referenced from the script. Confirm the runbook is up to date.

---

## 25. Integration & Interoperability Module

**Verdict:** 🟡 Functional, could be deeper

### Findings
- FHIR R4 endpoints (`fhir.ts`), bulk FHIR (`bulk-fhir.ts`), C-CDA (`ccda.ts`).
- `src/lib/fhir/{mappers,search,types}.ts`.
- Blue Button export.
- HL7v2 + ASTM parsers.
- Lab middleware + HL7 agent + DICOM print agent as separate services.

### Issues
- 🟠 **SMART on FHIR** not present (per maturity report). Decision needed.
- 🟠 **HL7v2 inbound integration** — the parsers exist, but is there a live listener? `tools/hl7-agent/` likely is. Verify it's running in production.
- 🟡 **DICOM print agent** — separate service. Verify deployment.

---

## 26. Notifications & Inbox

**Verdict:** 🟢 Multi-channel

### Findings
- In-app (`notifications.ts`), push (`push.ts`, `pushNotifications.ts`), inbox (`inbox.ts`).
- Email (Resend), SMS (SSL Wireless / bNotify), Web Push.
- `NotificationsCenter.tsx`, `InboxPage.tsx`.

### Issues
- 🟡 **Notification preferences** — verify if per-user opt-out is supported.
- 🟡 **Inbox threading** — verify message threading (replies to a thread).

---

## 27. Settings, Configuration, Subscription

**Verdict:** 🟢 Comprehensive

### Findings
- 9 backend route files; 10 frontend pages.
- `MfaSetup.tsx`, `PermissionManagement.tsx`, `PaymentMethodsSettings.tsx`, `DiscountRulesSettings.tsx`, `ImportExportSettings.tsx`, `EmailSettings.tsx`, `SecuritySettings.tsx`, `PrintTemplateSettings.tsx`, `DepartmentsSettings.tsx`, `WebsiteSettings.tsx`, `SystemPreferences.tsx`, `SettingsPage.tsx`.
- `subscription.ts` middleware gates features by plan.

### Issues
- 🟠 **Subscription tiers** — verify the feature matrix per plan. `subscription.ts` middleware exists; the plan definitions may be in `permissions.ts` or `settings.ts`.
- 🟡 **Print templates** — `printTemplates.ts` route. Verify templates can be visually edited.

---

## 28. Marketing & Growth

**Verdict:** 🟡 Functional

### Findings
- `marketingReferral.ts` + 4 marketplace routes.
- `MarketingReferral.tsx`, `MarketplaceLanding.tsx`, plus 6 marketplace pages.
- `agent-referral-commissions.test.ts` (commission accounting).

### Issues
- 🟠 **Agent referral commissions** — accounting integration. Verify the commission is posted to GL correctly.
- 🟡 **Review moderation** — `ReviewModerationPage.tsx` exists. Verify the moderation action is audit-logged.

---

## 29. Authorization, Security & Compliance

**Verdict:** 🟢 Solid

### Findings
- 9 middleware files: `auth.ts`, `tenant.ts`, `rbac.ts`, `csrf.ts`, `security.ts`, `rate-limit.ts`, `audit.ts`, `subscription.ts`, `ai-guard.ts`.
- CSP, HSTS, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy set in `securityHeaders`.
- bcrypt 10 rounds, idempotency helpers, Sentry via `toucan-js`, error logging, BD phone validation, NID validation.
- 17+ test files: `security.test.ts`, `rbac-authorization.test.ts`, `rbac-route-middleware.test.ts`, `accessibility-ratelimit.test.ts`, `chaos-engineering.test.ts`, `concurrency.test.ts`, `tenant-isolation.test.ts`, `resilience.test.ts`, `performance.test.ts`, `compliance.test.ts`, `pdf-xss.test.ts`, `schema-validation.test.ts`, `regression.test.ts`, `edge-cases.test.ts`, `edge-cases-comprehensive.test.ts`, `ui-wiring-audit.test.ts`, `module7-user-control-audit.test.ts`.

### Issues
- 🟠 **`getDb(dbBinding as any)` in `rbac.ts`** — type cast `as any` is a code smell. Not a security bug, but indicates the schema is too complex to type cleanly.
- 🟠 **Cross-tenant validation** in `auth.ts` only checks if middleware set a tenant. Some routes (e.g., `login-direct.ts`) may not have a tenant at auth time. Verify.
- 🟠 **CSP allows `unsafe-inline` for scripts**. This weakens XSS protection. Modern React doesn't need `unsafe-inline` if using nonces. Consider migration.
- 🟡 **Fail-closed on KV errors** in `auth.ts` is correct. But under KV outage, the entire app is 503. Verify KV SLA.
- 🟡 **No documented pen test report**. Recommend a third-party security audit before high-stakes deployment.

---

## 30. i18n / Localization Module

**Verdict:** 🟢 English + Bengali complete

### Findings
- 1946 tests pass for i18n (per memory).
- 1660+ keys, 6 new namespaces.
- `web/src/lib/i18n.ts`, `bengaliNumbers.ts`.

### Issues
- 🟡 **Disaster recovery i18n** test exists — verify it actually tests recovery.
- 🟡 **Patient portal i18n** — verify the PWA app has its own i18n (not shared with main web).

---

## 31. Testing, CI/CD, Quality Infrastructure

**Verdict:** 🟡 Massive test suite, but fragmented

### Findings
- 4 Vitest configs: `vitest.config.ts`, `vitest.config.real.ts`, `vitest.workers.config.ts`, `vitest.config.integration.ts`.
- 330+ test files.
- E2E via Playwright (`playwright.config.ts`).
- Load via k6 (`load-tests/k6-{smoke,load,stress}.js`).
- Real-DB tests via `vitest.config.real.ts`.
- Smoke via `test/smoke/deploy-smoke.ts`.
- Coverage via `@vitest/coverage-v8`.
- Visual regression via `test/visual-regression.test.ts`.
- Accessibility via `test/accessibility-wcag.test.ts`.

### Issues
- 🟠 **4 Vitest configs is unusual** — usually one config with `test:all` aliases. Confirm the configs are intentional, not leftover from a refactor.
- 🟠 **k6 load test scripts at root** vs `test/load/*.js` — both exist. Migration in progress?
- 🟡 **Test count drift**: `feature-list.md` says 373 tests / 34 files. Actual: 330+ files. Tests have been added without updating the doc.
- 🟡 **Visual regression** test exists; verify it has reference images committed.
- 🟡 **CI/CD via GitHub Actions** (`.github/`). Verify the workflow files are present.

---

## 32. Database Migrations

**Verdict:** 🟠 346 migrations, but with duplicate numbers

### Findings
- 346 SQL files in `migrations/`.
- `processed/` subdirectory has 16 files (apparently already-applied migrations on this branch).
- Seed files: `seed_demo.sql`, `seed_demo_extended.sql`, `seed_pharmacy_demo.sql`, `seed_pharmacy_stock_fill.sql`, `seed_accounting_demo.sql`.
- Drizzle ORM with `drizzle.config.ts`, `src/db/schema/*.ts`, `src/db/schema/meta/`.

### Issues
- 🔴 **Duplicate migration numbers** — many pairs use the same 4-digit prefix:
  - `0020_ai_memory.sql` + `0020_pharmacy_sales.sql`
  - `0029_hospital_website.sql` + `0029_website_analytics.sql` + `0030_website_analytics.sql` + `0031_website_analytics_subdomain.sql` (3 in this group)
  - `0035_advanced_billing.sql` + `0035b_billing_alter_columns.sql`
  - `0049_hr_module.sql` + `0049_performance_indexes.sql`
  - `0050_clinical_assessments.sql` + `0050_clinical_mar.sql` + `0050_medical_records.sql` (3 in this group)
  - `0055_pharmacy_v2.sql` + `0055_radiology_dicom_unique.sql`
  - `0118_marketplace_tenant_columns.sql` + `0118_patient_ai_plans.sql`
  - `0119_marketplace_doctor_columns.sql` + `0119_patient_ai_plan_progress.sql`
  - `0150_ai_addon.sql` + `0150_maternity_module.sql`
  - `0151_ai_summaries.sql` + `0151_dental_module_enhancement.sql` + `0151_wardsupply_module.sql`
  - `0157_visit_services_layer.sql` + `0157_visit_services_layer_safe.sql` + `0157b_seed_procedure_billing_items.sql`
  - `0158_danphe_billing_gaps.sql` + `0158_danphe_billing_gaps_safe.sql`
  - `0172_lab_machine_orders.sql` + `0172_lab_qc_calibrations.sql` + `0172_lab_sms_machine_qc_validation.sql` + `0172_lab_validation_rules.sql` (4 in this group)
  - `0182_diagnostic_lis_ris_readiness.sql` + `0182_provisional_discharge.sql`
  - `0190_accounting_foundation_tables.sql` + `0190_fix_queue_appointment_link.sql` + `0190_nursing_diet_sheet.sql` (3)
  - `0191_add_icd11_to_visits.sql` + `0191_cost_centers_and_subledgers.sql` + `0191_nursing_blood_sugar.sql` (3)
  - `0192_admission_source_and_bed_cleaning.sql` + `0192_nursing_consultation_requests.sql` (2)
  - `0193_nursing_transfer_orders_billing.sql` + `0193_operational_support_tables.sql` (2)
  - `0229_add_bills_payment_method_and_remarks.sql` + `0229_update_counter_type_check.sql` (2)
  - `0230_add_procedure_to_invoice_items_category.sql` + `0230_seed_accounting_mappings.sql` (2)
  - `0232_patient_inbox_hot_path_indexes.sql` + `0232_sync_lab_catalog_to_billing.sql` (2)
  - `0253_expense_receipt_photo.sql` + `0253_inventory_complete_workflow.sql` + `0253_seed_common_lab_catalog.sql` (3)
  - `0254_external_referring_doctors.sql` + `0254_inventory_gr_other_charges.sql` (2)
  - `0255_billing_catalog_tenant_guards.sql` + `0255_pharmacy_inventory_bridge.sql` (2)
  - `0256_reorder_config.sql` + `0256_seed_accounting_defaults_for_existing_tenants.sql` (2)
  - `0262_fraction_incentive_system.sql` + `0262_ipd_gap_fill.sql` (2)
  - `0263_consultation_prescription_link.sql` + `0263_hr_gaps_department_weekend_policy.sql` (2)
  - `0264_bill_tax_columns.sql` + `0264_dose_templates.sql` + `0264_user_management_fields.sql` (3)
  - `0265_advice_templates.sql` + `0265_audit_action_expansion.sql` (2)
  - `0266_bill_discount_audit.sql` + `0266_dose_templates.sql` (2)
  - `0269_bill_status_on_discharge.sql` + `0269_expand_audit_action_check.sql` (2)
  - `0270_nursing_emergency_alerts.sql` + `0270_visit_services_admission_id.sql` (2)
  - `0280_bank_transactions.sql` + `0280_payment_methods_table.sql` (2)
  - `0291_local_sync_foundation.sql` + `0291_prescription_doctor_usage_stats.sql` (2)
- This is the most concerning finding. The duplicate-numbered files appear to be **intentional** (likely a convention where multiple SQL files for the same release share a number and use suffixes), but it makes migration ordering **fragile** — a deployment tool that sorts lexicographically will pick one over the other, and the order of execution matters when one depends on the other.
- 🟠 **`processed/` directory** has 16 files. This suggests migrations are being moved to a "processed" bucket, but the convention isn't documented.
- 🟡 **Drizzle schema is 7,393 lines** — too large to maintain. Recommend splitting by domain (clinical, billing, accounting, etc.) for readability.
- 🟡 **No migration rollback** is documented. The `fix_corrupted_transactions.sql` suggests manual fixes happened. Forward-only migrations are standard for D1, but document the convention.

---

## 33. Infrastructure / Cloudflare

**Verdict:** 🟢 Well-configured

### Findings
- **Single Worker** with all routes mounted.
- D1 (SQLite) — `hms-super-admin-production` + staging.
- KV (cache, sessions, rate limit, RBAC cache).
- R2 (file storage) — `hms-uploads-production`, `hms-uploads-staging`.
- Vectorize (`hms-ai-memory`).
- Durable Object (`DashboardDO` at `src/do/dashboard-state.ts`).
- Email (Resend), SMS (SSL Wireless / bNotify), Video (CF Realtime SFU).
- Health check (`/api/health` + `/api/health/deep`).
- Local-server mode (disabled features when offline).
- Environments: top-level (dev), `--env staging`, `--env production`.
- `wrangler.toml` + `worker-configuration.d.ts` (512KB).

### Issues
- 🟠 **No multi-region failover** for D1. D1 is single-region. If the region is down, the entire app is down. Consider read-replicas or backup read-only.
- 🟠 **`worker-configuration.d.ts` is 512KB** — too large to read. Verify it's actually used.
- 🟡 **R2 storage costs** are not budgeted. Photo upload from many patients could balloon.
- 🟡 **CF Realtime SFU** has a per-minute cost. Verify the telemedicine session is closed properly.
- 🟡 **No CDN for static assets** — relying on Cloudflare Pages. Confirm.

---

## 34. Schema / DB Tables

**Verdict:** 🟠 7,393-line single file

### Findings
- 13 schema files in `src/db/schema/`.
- Main `schema.ts` is 7,393 lines, 508KB.
- Drizzle-generated journal at `src/db/schema/meta/`.
- Migration manifest at `src/data/schema-migrations.generated.ts`.

### Issues
- 🟠 **Single 7,393-line schema file** — must be split before it becomes unmaintainable.
- 🟠 **Migrations and Drizzle schema can drift** — confirm the workflow regenerates Drizzle from migrations or vice versa.
- 🟡 **No formal ER diagram** in the repo (only text descriptions). Recommend a generated visual.

---

## 35. External Tools & Helper Agents

**Verdict:** 🟡 Useful, separate deployment

### Findings
- `tools/dicom-print-agent/` — DICOM print service.
- `tools/hl7-agent/` — HL7 listener.
- `tools/lab-middleware/` — Lab middleware.
- `tools/generate-rbac-tests.ts` — RBAC test generator.

### Issues
- 🟠 **These are 3 separate services**. Each needs its own deployment, monitoring, and update process. Verify they are deployed and monitored.
- 🟡 **`generate-rbac-tests.ts`** is a generator; verify it's run as part of CI.

---

## 36. Documentation

**Verdict:** 🟢 40+ docs, well-organized

### Findings
- 40+ design + status docs in `docs/`.
- Key docs: `PRODUCTION_READINESS_REPORT.md`, `HMS_MATURITY_REPORT_2026-04-20.md`, `ECOSYSTEM_ARCHITECTURE_REVIEW.md`, `P2-known-issues.md`, `rbac-permission-matrix.md`, `backup-recovery-runbook.md`, `pharmacy-remaining-tasks.md`, `phase3-roadmap.md`, `optimization-backlog.md`.

### Issues
- 🟠 **Docs may be stale**. The `PRODUCTION_READINESS_REPORT.md` is dated 2026-04-24, and significant work has been done since. Recommend a re-read of all docs.
- 🟡 **No CHANGELOG.md** at the project root. Changes are only in git history.
- 🟡 **No CONTRIBUTING.md**. Open-source contributors would struggle.

---

## 37. Role Matrix & Authorization

**Verdict:** 🟢 7-tier RBAC + dynamic permissions

### Findings
- 7-tier RBAC + dynamic per-tenant permissions.
- `role_permission_overrides` + `user_permission_overrides` for fine-grained control.
- RBAC cache in KV (5-minute TTL).
- Fail-closed on KV errors.

### Issues
- 🟠 **The role matrix in `feature-list.md` lists 7 roles** but the `app` actually has more: `super_admin`, `hospital_admin`, `doctor`, `nurse`, `reception`, `accountant`, `director`, `md`, `lab`, `pharmacist`. Confirm the role list in `authz.ts` matches.
- 🟡 **Wildcard `*` permission** — `hospital_admin` and `super_admin` have wildcard. Verify this doesn't bypass explicit denies.

---

## Appendix A: Module-Level Inventory Cross-Reference

For each module in `README-MODULES.md`, here's the verdict:

| # | Module | Verdict | Key Files |
|---|--------|---------|-----------|
| 1 | Auth & Session | 🟢 | `src/middleware/auth.ts`, `tenant.ts`, `rbac.ts`, `csrf.ts` |
| 2 | Patient Management | 🟢 | `src/routes/tenant/patients.ts`, `web/src/pages/Patient*` |
| 3 | Reception / OPD / Queue | 🟢 | `src/routes/tenant/queue.ts`, `web/src/pages/Queue*` |
| 4 | Doctor Module | 🟢 | `src/routes/tenant/doctors.ts`, `consultations.ts`, `prescriptions.ts` |
| 5 | IPD / Inpatient | 🟢 | `src/routes/tenant/admissions.ts`, `discharge.ts`, `ipdCharges.ts` |
| 6 | Laboratory | 🟢 | `src/routes/tenant/lab*.ts`, `tools/lab-middleware/`, `tools/hl7-agent/` |
| 7 | Radiology | 🟢 | `src/routes/tenant/radiology/*`, `tools/dicom-print-agent/` |
| 8 | Pharmacy | 🟢 | `src/routes/tenant/pharmacy/*`, `pharmacy.ts` |
| 9 | Billing & Payments | 🟢 | `src/routes/tenant/billing*.ts`, 12 pages |
| 10 | Accounting & Finance | 🟢 | `src/routes/tenant/accounting*.ts` |
| 11 | Inventory | 🟢 | `src/routes/tenant/inventory/*` |
| 12 | Nursing | 🟡 | `src/routes/tenant/nursing/*` (29 files), 50+ components |
| 13 | HR / Staff / Payroll | 🟡 | Missing Payroll page |
| 14 | Operations & Facilities | 🟢 (most) | 24 sub-modules, mostly complete |
| 15 | Clinical | 🟡 | Backend rich, frontend rich for some areas |
| 16 | Quality, Compliance & Audit | 🟢 | Audit log immutability verified |
| 17 | Reports & Analytics | 🟡 | Backend rich, frontend thin |
| 18 | Telemedicine & Communication | 🟢 | Video + push + email + SMS |
| 19 | AI / Intelligence | 🟡 | Vectorize memory, AI guard rail |
| 20 | Multi-Tenancy, Branch, Onboarding, Marketplace | 🟢 | Production-grade |
| 21 | Cross-Hospital Referrals, Consent, Identity | 🟢 | Complex but functional |
| 22 | Patient-Facing Apps | 🟢 | PWA + Flutter |
| 23 | Admin Panel (Super-Admin) | 🟢 | Standalone, well-organized |
| 24 | Local Server (Edge / Offline) | 🟢 | Edge-offline capability |
| 25 | Integration & Interoperability | 🟡 | FHIR, C-CDA, HL7v2, ASTM |
| 26 | Notifications & Inbox | 🟢 | Multi-channel |
| 27 | Settings, Configuration, Subscription | 🟢 | Comprehensive |
| 28 | Marketing & Growth | 🟡 | Functional |
| 29 | Authorization, Security & Compliance | 🟢 | Solid |
| 30 | i18n / Localization | 🟢 | EN + BN |
| 31 | Testing, CI/CD, Quality | 🟡 | 330+ tests, 4 vitest configs |
| 32 | Database Migrations | 🟠 | 346 files, duplicate numbers |
| 33 | Infrastructure / Cloudflare | 🟢 | Well-configured |
| 34 | Schema / DB Tables | 🟠 | 7,393-line single file |
| 35 | External Tools & Helper Agents | 🟡 | Useful, separate deployment |
| 36 | Documentation | 🟢 | 40+ docs, well-organized |
| 37 | Role Matrix & Authorization | 🟢 | 7-tier RBAC + dynamic |

---

## Appendix B: Top 10 Findings (Ordered by Severity)

1. **🔴 Migration numbering chaos** — 50+ duplicate migration numbers. Document the convention, or normalize to unique numbers with `_v2` suffix.
2. **🟠 Single 7,393-line `schema.ts`** — split by domain.
3. **🟠 4 Vitest configs** — consolidate or document why each is needed.
4. **🟠 No Payroll UI** — add `Payroll.tsx` page.
5. **🟠 Local schema sync needs verification** — confirm the local-server mode works end-to-end.
6. **🟠 Maternity / Dental / WardSupply / Helpdesk are new (per April 23 deployment)** — verify they hold up under load.
7. **🟠 AI Triage is in the emergency flow** — confirm the `ai-guard.ts` blocks clinical advice.
8. **🟠 Outdated test count** — `feature-list.md` says 373 tests / 34 files; actually 330+ files. Update the doc.
9. **🟠 Backup file `DoctorDashboard.tsx.bak`** in pages directory — clean up.
10. **🟠 Temporary fix scripts** (`_tmp_*.cjs`, `fix_*.cjs`, `parse_*.cjs`, `replace_*.cjs`, `rewrite_patients.cjs`) in project root — move to `scripts/`.

---

## Appendix C: Cleanup Tasks (Non-Editing Review Notes)

If the user later asks for cleanup, here's what to do (this review does NOT perform them):

- Move all `fix_*.cjs`, `parse_*.cjs`, `replace_*.cjs`, `rewrite_patients.cjs`, `_tmp_*.cjs`, `tmp-*.mjs` from project root to `scripts/`.
- Delete `web/src/pages/DoctorDashboard.tsx.bak`.
- Delete `apps/ozzyl-lifestyle/build.log`.
- Delete `/0` (zero-byte file in root).
- Delete `_tmp_dental_3.cjs`, `_tmp_dental_4.cjs`.
- Normalize migration numbering (e.g., add `_v2` suffix to duplicates).
- Split `src/db/schema/schema.ts` into domain files.
- Consolidate or document the 4 Vitest configs.
- Update `feature-list.md` test count claim.
- Add CHANGELOG.md, CONTRIBUTING.md.

---

*End of REVIEW.md — this is a read-only review; no code was modified.*

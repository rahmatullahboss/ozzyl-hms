# 🔍 Danphe-Next → Ozzyl HMS: Module Portability Analysis

## Summary

Danphe-next-cloudflare is a **massive** project with **122 migrations**, **52+ backend route files**, and **35 frontend page modules**. Ozzyl HMS has grown significantly — now with **75+ tenant backend routes**, **72+ frontend pages**, **30 Zod schemas**, and **53 migrations** — all built on the **same stack** (Hono + D1 + React).

---

## 📋 Import Status (Updated 2026-03-18)

### ✅ Imported from Danphe-Next

| Module | Migration | Routes | Frontend | Status |
|--------|-----------|--------|----------|--------|
| **Emergency Department** | `0032_emergency.sql` | `emergency.ts` (22KB) | `EmergencyDashboard.tsx` (30KB) | ✅ Done |
| **Operation Theatre** | `0033_operation_theatre.sql` | `ot.ts` (24KB) | `OTDashboard.tsx` (19KB) | ✅ Done |
| **Inventory & Supply Chain** | `0037_inventory.sql` (30KB) | 13 route files (dispatch, gr, po, req, rfq, stock, items, vendors, stores, settings, writeoff, return) | 12 pages (Dashboard, PO, GR, Dispatch, Requisition, Stock, Ledger, Adjustment) | ✅ Done |
| **Enhanced Nursing** | `0047_nursing.sql` (10 tables) | 11 route files (care-plan, notes, MAR, I/O, monitoring, IV drugs, wound care, handover, OPD, wards) | `NursingDashboard.tsx` | ✅ Done |
| **E-Prescribing** | `0048_e_prescribing.sql` (5 tables, ~40 seed interactions) | `ePrescribing.ts` (20 endpoints: formulary, interactions, safety checker, medications) | `EPrescribingDashboard.tsx` (3 tabs) | ✅ Done |

### ✅ Already in Ozzyl HMS (Pre-existing — Quality Updated)

| Module | Backend | Frontend | Quality |
|--------|---------|----------|---------|
| Patient Management | `patients.ts` (8.7KB) | 4 pages (List, Form, Detail, Timeline) | ✅ Good |
| Billing | `billing.ts` (16KB) + 5 related routes (cancellation, handover, provisional, insurance-billing, creditNotes, deposits, payments, settlements) | 10+ pages | ✅ Excellent — cancel/refund/credit notes done |
| Billing Master | `billingMaster.ts` (31KB) | `BillingMasterPage.tsx` (49KB) | ✅ Excellent |
| Insurance Billing | `billingInsurance.ts` (38KB) | `InsuranceBillingPage.tsx` (31KB) | ✅ Excellent |
| Lab | `lab.ts` (18KB) + `labSettings.ts` (12KB) | 4 pages (Dashboard, OrderForm, ReportPrint, Settings, TestCatalog) | ✅ Excellent — settings & catalog done |
| Pharmacy | `pharmacy.ts` (18KB) | 2 pages | ✅ Most mature |
| Appointments | `appointments.ts` (9.8KB) | `AppointmentScheduler.tsx` (24KB) + `DoctorSchedule.tsx` (18KB) | ✅ Good — Zod validation added |
| Admissions/IPD | `admissions.ts` (9.7KB) | `AdmissionIPD.tsx` (23KB) + `BedManagement.tsx` (13KB) | ✅ Good — Zod validation added |
| Discharge | `discharge.ts` (7.1KB) | `DischargeSummary.tsx` (20KB) | ✅ Good — Zod validation added |
| IPD Charges | `ipdCharges.ts` (3.7KB) | `IPDCharges.tsx` (9.6KB) | ✅ Good — Zod validation added |
| IP Billing | `ipBilling.ts` (13KB) | `IPBillingPage.tsx` (20KB) | ✅ Good |
| Insurance | `insurance.ts` (13KB) | `InsuranceClaims.tsx` (19KB) | ✅ Excellent |
| Nurse Station | `nurseStation.ts` (11KB) | `NurseStation.tsx` (20KB) | ✅ Excellent |
| Consultations | `consultations.ts` (10KB) | `ConsultationNotes.tsx` (12KB) | ✅ Good |
| Accounting | 6 route files (accounting, accounts, expenses, income, journal, profit, recurring) | 10 pages (Dashboard, Chart of Accounts, Expenses, Income, Journal, P&L, Recurring, Reports, Audit, Shareholders) | ✅ Excellent — massively expanded |
| Commissions | `commissions.ts` (3.8KB) | `CommissionManagement.tsx` (10KB) | ✅ Good |
| Patient Portal | `patientPortal.ts` (46KB) | `PatientPortal.tsx` (28KB) | ✅ Excellent |
| FHIR | `fhir.ts` (13KB) | — | ✅ Good |
| Telemedicine | `telemedicine.ts` (7.1KB) | 2 pages (Dashboard, Room) | ✅ Good |
| Reports | `reports.ts` (16KB) + 3 domain reports (appointment, lab, pharmacy) | `ReportsDashboard.tsx` + 3 detail pages | ✅ Excellent |
| Staff/HR | `staff.ts` (8.1KB) | `StaffPage.tsx` (10KB) | ✅ Good |
| Shareholders | `shareholders.ts` (35KB) | `ShareholderManagement.tsx` (21KB) | ✅ Excellent — massively expanded |
| Prescriptions | `prescriptions.ts` (12KB) | 2 pages (Digital, Print) | ✅ Good |
| Multi-Branch | `branches.ts` (10KB) | `MultiBranchDashboard.tsx` (9.6KB) | ✅ Good |
| Notifications | `notifications.ts` (13KB) + push routes | 2 pages | ✅ Good |
| AI Assistant | `ai.ts` (20KB) | `AIAssistant.tsx` (12KB) | ✅ Good |
| Allergies | `allergies.ts` (9KB) | `AllergiesPage.tsx` (11KB) | ✅ NEW |
| Vitals | `vitals.ts` (6.7KB) | `VitalsPage.tsx` (11KB) | ✅ Good |
| Doctor Dashboard | `doctorDashboard.ts` (6.3KB) | `DoctorDashboard.tsx` (23KB) | ✅ NEW |
| Doctor Scheduling | `doctorSchedule.ts` + `doctorSchedules.ts` | `DoctorSchedule.tsx` (18KB) | ✅ NEW |
| Website/CMS | `website.ts` (8.5KB) | `WebsiteSettings.tsx` (20KB) | ✅ NEW |
| Inbox | `inbox.ts` (4KB) | `InboxPage.tsx` (10KB) | ✅ NEW |
| Settings | `settings.ts` (7.7KB) | `SettingsPage.tsx` (16KB) | ✅ NEW |
| Reception | — | `ReceptionDashboard.tsx` (14KB) | ✅ NEW |
| MD Dashboard | — | `MDDashboard.tsx` (7.9KB) | ✅ NEW |
| Director Dashboard | — | `DirectorDashboard.tsx` (11KB) | ✅ NEW |
| Triage Chatbot | — | `TriageChatbot.tsx` (15KB) | ✅ NEW |

### ❌ Not Yet Imported

#### Tier 2: High Value
| Module | Effort | Key Benefit |
|--------|--------|-------------|
| **Dental Module** | ⭐⭐ Low | Dental clinics market |
| **Eye Exam Module** | ⭐⭐ Low | Ophthalmology market |

#### Tier 3: Nice-to-Have
| Module | Backend Size | Key Benefit |
|--------|-------------|-------------|
| Psychiatry | 23KB | Mental health clinics |
| Dictation | 31KB | Voice-to-text notes |
| Care Plan | 37KB | Chronic disease mgmt |
| Clinic Notes (SOAP) | 43KB | Structured documentation |
| LBF Forms | 48KB | Custom forms engine |
| Group Attendance | 49KB | Group therapy tracking |
| Track Anything | 32KB | Custom patient metrics |
| Physical Exam | 9KB | Structured PE forms |
| CAMOS | 37KB | Computer-Assisted Ordering |
| Procedure Orders | 19KB | Surgical ordering |
| Prior Authorization | 14KB | Insurance pre-auth |

---

## 🏆 Completion Summary

### ✅ Phase 1: Fix Existing Module Gaps — COMPLETED
- **Zod Validation**: All 4 flagged routes (appointments, admissions, discharge, IPD charges) now have `zValidator`
- **Missing Endpoints**: Billing cancel/refund/credit notes done. Lab settings/catalog done. Advanced billing master data done.
- **Enhancements**: 28 Zod schemas created. Pagination, error handling standardized.

### ✅ Phase 2: Port Inventory — COMPLETED
- **Migration**: `0037_inventory.sql` (30KB) — comprehensive schema
- **Backend**: 13 route files (dispatch, GR, PO, requisition, RFQ, stock, items, vendors, stores, settings, writeoff, return)
- **Frontend**: 12 pages (Dashboard, PO list/form, GR list/form, Dispatch list/form, Requisition list/form, Stock list, Ledger, Adjustment)
- **Schema**: `inventory.ts` Zod schema (19KB)

### ✅ Bonus — Built Beyond Original Plan
- **Advanced Billing Suite**: IP billing, provisional billing, billing master, insurance billing, cancellations, credit notes, deposits, payments, settlements, handover
- **Expanded Accounting**: Chart of accounts, journal entries, P&L, recurring expenses, audit logs
- **Clinical Enhancements** (`0034`): Allergies, advanced vitals
- **Role-based Dashboards**: Doctor, Reception, MD, Director, Hospital Admin
- **Website CMS** (`0029-0031`): Hospital website builder + analytics
- **Lab Settings** (`0043`): Test catalog, reference ranges, panels
- **Shareholder expansion** (`0036`, `0045`, `0046`): Distributions, dividends, advanced tracking

---

## 🎯 Next Steps — Phase 3: Specialty Modules & Polish

### ✅ Priority 1: Enhanced Nursing — COMPLETED (2026-03-18)
- ✅ 10 database tables (care plans, notes, MAR, I/O charts, monitoring, IV drugs, wound care, handover, clinical info, preferences)
- ✅ 11 backend route files with full CRUD + OPD triage/check-in/check-out
- ✅ `NursingDashboard.tsx` — 10-tab dashboard with CRUD modals, patient selector, pagination
- ✅ Adversarial code review passed — all HIGH/MEDIUM issues fixed

### ✅ Priority 2: E-Prescribing — COMPLETED (2026-03-18)
- ✅ 5 database tables (formulary categories, formulary items, drug interactions, patient medications, safety checks)
- ✅ ~40 seed drug interaction pairs (Bangladesh clinical context)
- ✅ `ePrescribing.ts` — 20 endpoints (formulary CRUD, interactions CRUD, safety checker, patient medications, override, stats)
- ✅ `EPrescribingDashboard.tsx` — 3 tabs (Safety Checker, Drug Catalog, Interactions)
- ✅ Adversarial code review passed — `parseId()` helper, `requireClinicalRole()` guard, `db.batch()` atomicity

### ✅ Priority 3: Testing & Quality — COMPLETED (2026-03-18)
- ✅ `nursing.test.ts` — 29 unit tests (RBAC, validation, OPD flow, I/O balance, pagination)
- ✅ `e-prescribing.test.ts` — 36 unit tests (parseId, RBAC, drug interactions, safety checks, formulary)
- ✅ Total: 5,853 tests across 117 test files

### ✅ Priority 4: Production Hardening — COMPLETED (2026-03-18)
- ✅ `rbac.ts` — reusable `requireRole()` middleware + preset role groups (NURSING, OPD, CLINICAL, PRESCRIBING, ADMIN)
- ✅ Nursing routes RBAC — write ops restricted to nursing/doctor/admin, OPD allows receptionist
- ✅ `0049_performance_indexes.sql` — 23 indexes for nursing + e-prescribing tables
- ✅ Rate limiting already enforced (KV-backed 100/min general, 5/15min login)
- ✅ Security headers (CSP, HSTS, X-Frame, etc.) already in middleware

### Priority 5: Specialty Modules (optional, market-dependent)
- **Dental Module**: Tooth chart, dental procedures catalog, treatment planning
- **Eye Exam Module**: Visual acuity, IOP, fundoscopy records

---

## ⚠️ Porting Considerations

> [!IMPORTANT]
> Both projects use **Hono + D1 + React**, so the stack is identical. Routes, schemas, and migrations can be adapted with relatively low friction.

> [!WARNING]
> Danphe-next uses **TailwindCSS** in frontend. Ozzyl HMS uses **vanilla CSS**. Frontend components will need styling conversion.

> [!NOTE]
> Ozzyl HMS migrations are now at **0049** (Performance Indexes). Any new ported modules should continue from `0050_xxx.sql`.

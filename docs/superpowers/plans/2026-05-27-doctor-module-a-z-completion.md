# Doctor Module A-Z Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining repository-implementable Doctor Module blueprint flows around report review, visible clinical context, doctor route ownership, audited certificates, and toolkit discoverability while retaining the prescription/fulfilment safety foundation.

**Architecture:** Reuse the existing Doctor dashboard and clinical routes rather than duplicating EMR functionality. Add focused UI around existing report-show and cumulative-lab APIs, tighten referral access, correct doctor route ownership, and introduce a small audited certificate aggregate. Preserve prescriptions as clinical truth and optional fulfilment as a separate operational record.

**Tech Stack:** Cloudflare Workers/Hono, D1 migrations/prepared statements, Zod, React/React Router, TanStack Query helpers, Vitest/Testing Library.

---

### Task 1: Doctor Route Ownership and Toolkit Entry Points

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/DoctorDashboard.tsx`
- Modify: `web/src/pages/doctor/IPDWorkspace.tsx`
- Test: `web/src/pages/DoctorDashboard.test.tsx`
- Test: `web/src/pages/doctor/IPDWorkspace.test.tsx`

- [x] Write failing UI tests asserting the Doctor dashboard links to report review, order sets, dictation, referrals and certificates, and IPD links target doctor-authorised lab/discharge pages.
- [x] Run `cd web && pnpm exec vitest run src/pages/DoctorDashboard.test.tsx src/pages/doctor/IPDWorkspace.test.tsx --reporter=dot` and verify missing/incorrect links fail.
- [x] Add doctor-authorised routes for `doctor/report-review`, `doctor/certificates`, `doctor/referrals`, `doctor/referrals/new`, `doctor/lab-orders`, and `doctor/ipd/:admissionId/discharge`; change dashboard/IPD quick links to those routes.
- [x] Re-run the UI tests and confirm they pass.

### Task 2: Dedicated Report-Show Review Interface

**Files:**
- Create: `web/src/pages/doctor/DoctorReportReview.tsx`
- Create: `web/src/pages/doctor/DoctorReportReview.test.tsx`
- Modify: `web/src/App.tsx`

- [x] Write failing tests that mock `/api/doctors/dashboard/report-show-patients`, render validity/prior prescription/report values, and submit `POST /api/doctors/dashboard/report-show/:appointmentId/review` only after doctor action.
- [x] Run the new test and verify the absent component fails.
- [x] Build the report-show page with date filter, report status cards, prior Rx details, notes input, explicit mark-reviewed button and query invalidation.
- [x] Run the test and confirm the review flow passes.

### Task 3: Consultation Lab Trend Context

**Files:**
- Create: `web/src/components/doctor/PatientLabTrendsPanel.tsx`
- Create: `web/src/components/doctor/PatientLabTrendsPanel.test.tsx`
- Modify: `web/src/components/doctor/DoctorWorkspaceDrawer.tsx`

- [x] Write failing component tests requiring `/api/lab/cumulative/:patientId?limit=24`, grouping repeated test results in descending order and flagging abnormal results.
- [x] Run the tests and confirm no lab-trend panel exists.
- [x] Implement the read-only panel and embed it below the Smart Face Sheet so the doctor can expand trends without leaving consultation.
- [x] Re-run trend and drawer tests.

### Task 4: Audited Doctor Certificates

**Files:**
- Create: `migrations/0276_doctor_certificates.sql`
- Create: `src/routes/tenant/doctorCertificates.ts`
- Modify: `src/index.ts`
- Create: `test/doctor-certificates.test.ts`
- Create: `web/src/pages/doctor/DoctorCertificates.tsx`
- Create: `web/src/pages/doctor/DoctorCertificates.test.tsx`
- Modify: `web/src/App.tsx`

- [x] Write backend tests requiring a doctor-only create endpoint, tenant-scoped reads, active linked-doctor verification, final-content immutability and reason-required cancellation.
- [x] Run `pnpm exec vitest run test/doctor-certificates.test.ts --reporter=dot` and verify it fails before the route/migration exist.
- [x] Add D1 persistence and Hono endpoints: `GET /api/doctor-certificates`, `GET /api/doctor-certificates/:id`, `POST /api/doctor-certificates`, `POST /api/doctor-certificates/:id/cancel`; audit create/cancel with redacted metadata.
- [x] Write failing frontend tests for create, printable final certificate and cancellation action; build the DoctorCertificates screen and route.
- [x] Run backend and frontend certificate tests until green.

### Task 5: Referral Least Privilege and Doctor Navigation

**Files:**
- Modify: `src/routes/tenant/referrals.ts`
- Modify: `web/src/pages/CreateReferral.tsx`
- Modify: `web/src/pages/IncomingReferralQueue.tsx` if navigation requires base-path correction
- Create: `test/referral-clinical-role-guards.test.ts`

- [x] Write failing backend tests showing non-clinical roles cannot read/create/update cross-hospital referrals while doctors can.
- [x] Add `requireRole('doctor', 'md', 'hospital_admin')` to referral operations and keep tenant checks intact.
- [x] Fix referral UI return/navigation URLs to use the hospital slug doctor route when opened from Doctor Module.
- [x] Run targeted referral tests and route UI tests.

### Task 6: Verification, Review and PR

**Files:**
- Modify: `docs/doctor-module-guide-bn.md`

- [x] Update the Bangla guide with completed report-review, trend, toolkit and certificate workflows plus honest deferred external integrations.
- [x] Run `git diff --check`, focused backend/frontend suites, `pnpm exec tsc --noEmit`, full frontend test suite, affected backend suite and `pnpm build` (the full root suite retains three unrelated failures reproduced on clean `origin/main`).
- [x] Run a diff-scoped healthcare security review focused on tenant isolation, doctor/referral authorization, certificate privacy/audit, prescription immutability and fulfilment separation.
- [ ] Stage only Doctor Module scope files, commit, push `codex/doctor-interface-safety`, and open a draft PR documenting completed coverage and deferred legally/external-dependent work.

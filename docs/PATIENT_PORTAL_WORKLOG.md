# Patient Portal Worklog

Date started: 2026-06-20
Branch: `feature/patient-portal-worklog`
Owner: Patient portal / OzzyLife workstream

## Goal

Make the patient portal production-functional so patients can securely manage their own profile, hospital links, appointments, prescriptions, lab results, bills, documents, and follow-up actions.

The product model is:

1. **Global patient identity** — login, profile, family/dependents, global dashboard.
2. **Selected hospital workspace** — appointments, prescriptions, lab results, bills, messages, live queue, visit pass.
3. **Patient-owned records and wellness** — vault, self-reported data, vitals, medicine tracker, wellness/check-ins.

## Current baseline

- Patient app routes exist for `/patient/login`, `/patient/home`, `/patient/care`, `/patient/records`, `/patient/wellness`, `/patient/family`, and `/patient/privacy`.
- Backend exposes patient-facing APIs under `/api/patient-auth`, `/api/global-portal`, `/api/patient-portal`, `/api/patient-phr`, `/api/wellness`, `/api/hospital-links`, and related marketplace/public hospital routes.
- Main HMS app hands off `/patient/*` to the patient app instead of rendering the legacy `web/src/pages/PatientPortal.tsx` directly.

## High-priority gaps

### P0 — Must finish before production

- [x] Confirm one canonical patient login/session model for the portal UI.
- [x] Fix stale E2E/auth assumptions around `/api/patient-portal/request-otp` and `/api/patient-portal/verify-otp` versus current `/api/patient-auth/*` and magic-link/password flows.
- [x] Add a visible hospital selector for every hospital-scoped area.
- [x] Block Care/Prescription/Lab/Bill/Message screens until a verified hospital link and selected `X-Tenant-ID` exist.
- [x] Add empty states for no linked hospital, no verified link, no records, no results, and no prescriptions.
- [x] Ensure lab results show only verified/released reports, never draft or unverified results.
- [x] Ensure prescription list shows only final/non-void prescriptions.
- [x] Add canonical document contract and remove duplicate/inconsistent document response behavior if still present.
- [x] Review `food-diary`/wellness routes for tenant isolation and decide whether they are global PHR data or tenant-hospital data.
- [x] Add audit coverage for every patient access to clinical data.

### P1 — Functional MVP patient value

- [x] Home: global dashboard summary with next appointment, latest prescription, latest result, due bill, and quick actions.
- [x] Care overview: selected hospital header, live visit card, next appointment, recent prescription, latest lab result, bill summary.
- [ ] Appointments: list, detail, book, cancel, reschedule-ready structure, live queue/token status.
- [ ] Prescriptions: list, detail, medicine items, advice, follow-up, print/download/share entry points.
- [ ] Lab results: list, detail, normal range/unit/flag/explanation, report PDF/download, unread/new state.
- [ ] Bills: due list, paid history, receipt download, payment placeholder for bKash/Nagad/card.
- [ ] Documents: vault list, upload, download, categories, source label (`patient_upload` vs `hospital_record`).
- [ ] Messages: conversation list, thread view, send message, unread badge, emergency disclaimer.
- [ ] Profile: edit safe fields only, correction request flow for clinical/identity-sensitive fields.

### P2 — Records and safety polish

- [ ] Timeline: unified appointment/prescription/lab/bill/document events.
- [ ] Medical records: list/detail with diagnoses and attached documents.
- [ ] Vitals: history, trends, patient-entered vitals, hospital-entered vitals separation.
- [ ] Visit pass: QR/card flow connected to selected appointment/hospital.
- [ ] Emergency pack: blood group, allergies, medication list, emergency contacts, conditions, share/export.
- [ ] Consent/privacy page: hospital links, consent matrix, AI access toggle, device/session management.
- [ ] Correction/amendment requests for incorrect patient data or reports.
- [ ] Sensitive module locks for mental health, women's health, and family-managed data.

### P3 — Engagement and advanced features

- [ ] Medicine tracker from prescriptions with reminders and taken/skipped state.
- [ ] Refill request UI and status tracking.
- [ ] Lab result trends for repeated tests such as glucose, CBC, lipid, thyroid.
- [ ] Push notifications for result-ready, appointment reminders, queue updates, refill status.
- [ ] Family/dependent profile switcher and proxy consent.
- [ ] Wellness score, daily check-in, food/water/sleep/activity modules.
- [ ] AI coach with explicit consent, clinical data attribution, and strict safety boundaries.
- [ ] Online payment integration.

## Acceptance checklist

The patient portal is considered MVP-ready only when:

- [ ] A patient can register/login and open the portal home.
- [ ] A patient can see and update safe profile fields.
- [ ] A patient can see linked/available hospitals and select the active hospital.
- [ ] Hospital-scoped pages clearly show the selected hospital.
- [ ] Unverified hospital links cannot reveal hospital data.
- [ ] A patient can view appointments and live queue state.
- [ ] A patient can book and cancel an appointment.
- [ ] A patient can view final prescriptions and prescription items.
- [ ] A patient can view verified/released lab results with unit/range/explanation.
- [ ] A patient can view bills and receipts/history.
- [ ] A patient can upload and download documents.
- [ ] A patient can message a doctor/care team safely.
- [ ] A patient can request prescription refill where supported.
- [ ] Clinical fields cannot be silently edited by patients.
- [ ] Every clinical data view is audit-logged.
- [ ] Empty/error/loading states are present for every major section.

## Progress log

### 2026-06-20

- [x] Created working branch `feature/patient-portal-worklog`.
- [x] Added this worklog to track remaining work, priorities, and acceptance criteria.
- [x] Confirmed the canonical patient auth/session model: standalone patient UI uses `/api/patient-auth/login`, `/api/patient-auth/register`, `/api/patient-auth/me`, and `phr_token`/bearer global patient sessions. The old patient-portal OTP assumptions are not the canonical flow.
- [x] Removed stale `/api/patient-portal/request-otp` and `/api/patient-portal/verify-otp` assumptions from patient portal E2E/integration coverage; patient E2E token setup now validates `/api/patient-auth/me` and logs in through `/api/patient-auth/login` when `PATIENT_PORTAL_E2E_PASSWORD` is provided.
- [x] Enforced explicit selected hospital context in Care and Hospital Services screens. Verified hospitals are shown in selectors, stale `PATIENT_SELECTED_HOSPITAL_STORAGE_KEY` values are cleared, and appointments/prescriptions/labs/bills/messages are not fetched until a verified hospital is selected.
- [x] Added clear no-linked/no-verified/no-selected states and kept the selected hospital visible in the Care, prescription, lab, bill, and message/service workspace UI.
- [x] Protected clinical display with backend and client-side defense-in-depth: prescriptions are limited to final/active/completed/dispensed and labs to verified/released/completed/final; draft/void/unverified records are filtered out before patient display.
- [x] Reviewed `food-diary` ownership. Decision: food diary is global patient-owned PHR/wellness data, not tenant hospital-scoped clinical data. It now uses a global patient-owned middleware and does not require `X-Tenant-ID`; tests document that no tenant header is required.
- [x] Tests run: `pnpm exec vitest run test/patient-portal-ux.test.ts test/patient-food-diary.test.ts test/patient-auth-rate-limit.test.ts test/patient-auth-otp.test.ts` — 33 passed; `pnpm exec vitest run test/integration/routes/precision-coverage.test.ts test/integration/routes/top5-deep.test.ts` — 343 passed; `pnpm --filter ozzyl-lifestyle exec tsc --noEmit --pretty false` — passed; `pnpm exec playwright test test/e2e/api/patient-portal.spec.ts --list` — passed/listed 63 tests.
- [x] Added a canonical tenant patient document response contract. `GET /documents` and `POST /upload-document` now return normalized patient-facing fields (`document_type`/`type`, `file_size`/`fileSize`, `mime_type`/`mimeType`, `source`, `download_url`/`downloadUrl`) without exposing storage keys, and duplicate document middleware registration was removed.
- [x] Completed clinical data access audit pass for this slice: prescription item detail, message thread reads, hospital lab sync, hospital prescription sync, and pre-visit lookup now write patient/hospital-link audit events; tenant lab result reads are also status-filtered to verified/released/completed/final only.
- [x] Tests run: `pnpm exec vitest run test/unit/patient-portal-documents-route.test.ts test/patient-portal-ux.test.ts test/patient-food-diary.test.ts test/integration/routes/precision-coverage.test.ts test/integration/routes/top5-deep.test.ts` — 367 passed; `pnpm --filter ozzyl-lifestyle exec tsc --noEmit --pretty false` — passed; `git diff --check` — passed.
- [x] Built the P1 Home summary slice. Global dashboard now returns verified-link lab reports as `reports`/`labResults`, filters global prescriptions to final only, orders appointments so upcoming visits appear first, and the Home screen shows next appointment, latest final prescription, latest verified/released lab result, due bill, and quick actions.
- [x] Tests run: `pnpm exec vitest run test/patient-portal-ux.test.ts` — 19 passed; `pnpm --filter ozzyl-lifestyle exec tsc --noEmit --pretty false` — passed; `git diff --check` — passed.
- [x] Added patient portal system map and implementation plan docs for backend/frontend mapping, data ownership, storage/session rules, clinical visibility, document contract, priority order, validation matrix, and next recommended slice.
- [x] Added documentation drift guard test for canonical auth, selected hospital context, clinical visibility, document contract, priority roadmap, and validation workflow.
- [x] Completed P1-A Care overview alignment. `ConnectedCareTab` now shows a selected-hospital care snapshot with live visit status when available, next appointment, recent final prescription, latest released lab result, and due bill summary; the data still loads only after a verified hospital is explicitly selected.
- [x] Added `buildSelectedHospitalCareOverview` helper in patient portal UX utilities and covered safe prescription/lab filtering, due bill summary, next appointment selection, and live visit normalization in `test/patient-portal-ux.test.ts`.
- [x] Tests run: `pnpm exec vitest run test/patient-portal-ux.test.ts` — 20 passed; `pnpm --filter ozzyl-lifestyle exec tsc --noEmit` — passed; `git diff --check` — passed.
- [x] Started P1-B Appointments MVP in TDD mode. First added a failing `buildPatientAppointmentMvpState` test for appointment detail, cancel eligibility, disabled reschedule-ready state, and queue/token context; then implemented the helper and wired it into the selected-hospital appointment list/detail panel.
- [x] Appointment UI slice now supports selectable appointment detail, queue/token/counter/ETA display, cancel action through the selected-hospital tenant context, and a disabled reschedule placeholder. Remaining P1-B gap: available slots are still not wired into the booking form.
- [x] Tests run: `pnpm exec vitest test/patient-portal-ux.test.ts` — 21 passed; `pnpm --filter ozzyl-lifestyle exec tsc` — passed.
- [x] Shifted the patient portal plan to an enterprise-grade standard: safe, auditable, tenant-isolated, failure-aware, preflight-validated, and documentation-driven rather than only MVP-complete.
- [x] Continued P1-B Appointments in TDD mode with `buildPatientAppointmentBookingGuard`. The booking form now checks `/available-slots/:doctorId?date=YYYY-MM-DD`, shows booked times, warns when the selected time is already booked, and blocks unsafe submit while slot checks are loading or conflicting.
- [x] Tests run: `pnpm exec vitest test/patient-portal-ux.test.ts` — 22 passed; `pnpm --filter ozzyl-lifestyle exec tsc --project tsconfig.json` — passed.
- [x] Standardized patient-visible dates to `DD-MM-YYYY` with shared helpers `formatPatientDateMonthYear` and `formatPatientDateTimeMonthYear`. Migrated connected care, hospital services, global records, AI planner, vault, wellness tracker, linked hospitals, document vault, allergies, reminders, screening history, cycle dates, pregnancy due date, and daily chart labels. Month-only calendar headers remain month/year labels.
- [x] Tests run: `pnpm exec vitest test/patient-portal-ux.test.ts` — 23 passed; `pnpm --filter ozzyl-lifestyle exec tsc --project tsconfig.json` — passed.
- [x] Continued P1-B Appointments in TDD mode with route-level enterprise guards. Added `test/unit/patient-portal-appointments-route.test.ts` before implementation; backend now validates doctors for `/available-slots`, returns normalized `bookedTimes`, rejects server-side same-time booking conflicts, and lets patients cancel their own `pending_approval`, `scheduled`, `confirmed`, or `booked` appointment states instead of only `scheduled`.
- [x] Continued P1-B Appointments with generated available slots. `/available-slots` now reads active `doctor_schedules` for the requested weekday, generates capacity-based `availableSlots`, returns `scheduleWindows`, and `book-appointment` validates requested times against generated slots when a schedule exists. The hospital services booking form now uses a slot dropdown when server-generated slots are available and keeps safe manual fallback only when no schedule is configured.
- [x] Tests run: `pnpm exec vitest test/patient-portal-ux.test.ts test/unit/patient-portal-appointments-route.test.ts` — 27 passed; `pnpm --filter ozzyl-lifestyle exec tsc` — passed.
- [x] Started P1-C Prescriptions enterprise-grade slice. Added a final-only patient-safe `GET /prescriptions/:id` detail route that returns prescription, safe medicine items, and action URLs for detail/items/PDF/refill/share; the route audits `view_prescription_detail` and filters replaced/void/deleted medicine items. Hospital Services prescription cards now use shared `buildPatientPrescriptionActionState` for DD-MM-YYYY dates, detail link, PDF link, refill eligibility, and share text.
- [x] Tests run: `pnpm exec vitest test/unit/patient-portal-prescriptions-route.test.ts test/patient-portal-ux.test.ts` — 26 passed; `pnpm --filter ozzyl-lifestyle exec tsc` — passed.
- [x] Hardened prescription PDF output for P1-C: prescription PDF now uses DD-MM-YYYY date formatting via `formatPatientPortalDateMonthYear` and filters replaced/void/deleted medicine items with the same patient-safe item filter used by the detail route.
- [x] Tests run: `pnpm exec vitest test/unit/patient-portal-prescriptions-route.test.ts` — 3 passed.
- [x] Completed the next P1-C prescription UI slice: Hospital Services now opens a selected-hospital prescription detail panel from `GET /prescriptions/:id`, shows diagnosis/advice/follow-up/medicine items, supports Download PDF, and adds explicit Share actions with native share plus clipboard fallback.
- [x] Tests run: `pnpm exec vitest test/unit/patient-portal-prescriptions-ui.test.ts test/unit/patient-portal-prescriptions-route.test.ts test/patient-portal-ux.test.ts` — 29 passed; `pnpm --filter ozzyl-lifestyle exec tsc --project tsconfig.json` — passed.
- [x] Marked P1-C Prescriptions functionally complete for the selected-hospital workspace; no separate full-page prescription route is required before P1-D because Hospital Services has list, detail panel, PDF, refill, share, and safe item filtering.
- [x] Started P1-D Lab Results enterprise-grade route slice. Added patient-safe `GET /lab-results/:id` detail route with verified/released/completed/final order guard, unsafe sample-status filtering, unit/range/flag/explanation fields, PDF/share actions, and `view_lab_result_detail` audit. Hardened lab PDF route to use the same released-status/sample-status filters and DD-MM-YYYY date formatting.
- [x] Continued P1-D Lab Results with Hospital Services detail UI/share panel. The selected-hospital lab card now opens `GET /lab-results/:id`, shows value, unit, reference range, severity/explanation, Download PDF, Share, and empty released-item state while preserving selected hospital gating.
- [x] Tests run: `pnpm exec vitest test/unit/patient-portal-lab-results-route.test.ts` — 2 passed; `pnpm exec vitest --run test/unit/patient-portal-lab-results-ui.test.ts` — 2 passed; `pnpm --filter ozzyl-lifestyle exec tsc` — passed.
- [x] Completed P1-D Lab Results for current scope. Result detail, safe PDF, unit/range/flag/explanation, detail panel, and share action are done; no separate new-result badge is shown because the backend has no dedicated lab seen-state field yet.
- [x] Started P1-E Bills enterprise-grade slice. Added patient-safe selected-hospital `GET /bills/:id` detail route with view audit, due/paid totals, disabled online-payment contract, and receipt placeholder. Hospital Services now opens a bill detail panel with total/paid/due, receipt-from-counter state, and disabled Pay online state.
- [x] Tests run: `pnpm exec vitest test/unit/patient-portal-bills-route.test.ts test/unit/patient-portal-bills-ui.test.ts` — 3 passed; `pnpm --filter ozzyl-lifestyle exec tsc` — passed.
- [x] Completed P1-E Bills for current scope. No patient-scoped receipt route exists yet, so the UI keeps counter receipt and disabled online payment placeholders.
- [ ] Known blocker: root tsc still fails on pre-existing unrelated repository errors such as missing schema-migrations.generated, bank-book getDb, and existing patients.ts unknown-type errors. Broader global visit-pass/family graph tests still have pre-existing/mock-related failures; dashboard guidance mock should be updated after the reports query.

## Notes for implementation

- Keep global and selected-hospital data visually separate.
- Do not show hospital-owned clinical data without a verified link and selected hospital context.
- Do not store clinical data in localStorage.
- Use safe patient language for abnormal results. Avoid diagnosis or prescription advice in AI/insight cards.
- Prefer incremental slices: Home + Care first, then Records, then Wellness/Family.

# Patient Portal Implementation Plan

Last updated: 2026-06-20  
Branch: `feature/patient-portal-worklog`  
Related map: `docs/PATIENT_PORTAL_SYSTEM_MAP.md`  
Worklog: `docs/PATIENT_PORTAL_WORKLOG.md`

This plan is the operational checklist for continuing patient portal work without backend/frontend mismatch.

## Enterprise-grade working principles

Enterprise-grade means the portal is not only usable; it must be safe, auditable, tenant-isolated, predictable under failure, and documented enough that backend/frontend contracts do not drift.

1. **One canonical auth path** — standalone patient app uses `/api/patient-auth/*` for login, register, profile, and session.
2. **Global vs hospital context must stay separate** — global dashboard can summarize verified links, but selected-hospital clinical screens must require selected hospital context.
3. **No clinical leakage** — do not fetch or display prescriptions, labs, bills, messages, or hospital-owned documents without a verified selected hospital or explicit verified-link global summary query.
4. **Patient-owned wellness stays global** — food diary and wellness data are global PHR/wellness data unless a future decision explicitly scopes them to tenant.
5. **Document every meaningful change** — update the system map, this plan, and the worklog whenever route contracts or priorities change.
6. **Small testable slices** — each implementation step should include a small test, a relevant frontend TypeScript check if frontend changed, and a worklog entry.
7. **Preflight validation before mutation** — enterprise flows should validate obvious conflicts before submitting mutating requests. Example: appointment booking checks booked slots before POST.
8. **Graceful fallback over silent failure** — when a backend endpoint only returns partial capability, the UI must show what is known, block unsafe actions, and document remaining gaps.
9. **Consistent patient-visible dates** — patient portal UI dates must use `DD-MM-YYYY` via shared helpers such as `formatPatientDateMonthYear`; month-only calendar headers are the only exception.

## Current state summary

### Completed P0

- Canonical patient auth/session model confirmed and stale `/api/patient-portal/request-otp` / `/verify-otp` assumptions removed from current patient portal tests.
- Explicit selected hospital context is enforced in Care and Hospital Services screens.
- `PATIENT_SELECTED_HOSPITAL_STORAGE_KEY` is used consistently for the selected hospital session key.
- Hospital-owned clinical data is blocked until a verified hospital is selected.
- Patient-visible prescriptions and lab results are filtered by safe statuses on backend and frontend helpers.
- Tenant patient document response has a canonical contract.
- Food diary/wellness ownership decision is documented as global patient-owned PHR/wellness data.
- Clinical access audit coverage has been improved for prescription items, messages, sync operations, and pre-visit lookups.

### Completed P1

- Home global dashboard summary now shows:
  - next appointment,
  - latest final prescription,
  - latest verified/released/completed/final lab result,
  - due bill,
  - quick actions.
- Care overview alignment now shows a selected-hospital care snapshot in `ConnectedCareTab` with live visit status when available, next appointment, recent final prescription, latest verified/released lab result, due bill summary, and empty states while preserving selected verified hospital gating.

### Known blockers / repo-wide issues

- Root `pnpm exec tsc --noEmit --pretty false` still fails on unrelated existing repo errors:
  - missing `../data/schema-migrations.generated`,
  - `src/routes/tenant/bank-book.ts` missing `getDb`,
  - existing `src/routes/tenant/patients.ts` unknown-type errors,
  - other unrelated route TypeScript issues.
- Broader `test/global-visit-pass.test.ts` and `test/global-family-graph.test.ts` have mock-related failures in visit-pass/family-manager paths. Dashboard-specific mocks also need updating after global dashboard added the reports query.
- `.jules/palette.md` is an unrelated dirty file in this worktree and should not be included in patient portal commits unless intentionally cleaned up separately.

## Priority roadmap

### P1-A — Care overview alignment

Goal: when a verified hospital is selected, the Care section should show a concise selected-hospital overview that mirrors the Home summary but stays tenant-scoped.

Deliverables:

- Selected hospital header always visible.
- Live visit card visible when available.
- Next appointment card.
- Recent final prescription card.
- Latest verified/released lab result card.
- Bill summary card.
- Empty states when each section has no data.
- CTA to select hospital if none is selected.

Backend/data sources:

- `GET /api/hospital-links`
- `GET /api/hospital-links/:id/data`
- `GET /api/patient-portal/live-visit-status` with `X-Tenant-ID`
- `GET /api/patient-portal/dashboard` with `X-Tenant-ID`

Frontend targets:

- `apps/ozzyl-lifestyle/src/components/patient/ConnectedCareTab.tsx`
- `apps/ozzyl-lifestyle/src/components/patient/PatientHospitalServicesTab.tsx`
- `apps/ozzyl-lifestyle/src/hooks/useConnectedCare.ts`
- `apps/ozzyl-lifestyle/src/lib/patientPortalUx.ts`

Tests:

- Extend `test/patient-portal-ux.test.ts` for any helper/normalization changes.
- Add a component/route guard test if UI fetch behavior changes.
- Run `pnpm --filter ozzyl-lifestyle exec tsc --noEmit --pretty false`.

### P1-B — Appointments MVP

Goal: patient can view, book, and cancel appointments from selected hospital workspace, with reschedule-ready structure and live queue state.

Deliverables:

- Appointment list with status badge and date/time.
- Appointment detail panel/drawer.
- Booking form using available doctors and slots.
- Cancel action with confirmation and reason.
- Reschedule-ready UI placeholder/structure without enabling unsafe partial flow.
- Queue/token/live visit state integrated when available.

Backend/data sources:

- `GET /api/patient-portal/appointments`
- `GET /api/patient-portal/available-doctors`
- `GET /api/patient-portal/available-slots/:doctorId`
- `POST /api/patient-portal/book-appointment`
- `POST /api/patient-portal/cancel-appointment/:id`
- `GET /api/patient-portal/live-visit-status`

Tests:

- Route smoke tests for list/book/cancel where possible.
- Frontend helper tests for status normalization.
- Manual/E2E list can be added to `test/e2e/api/patient-portal.spec.ts` if env supports seed data.

### P1-C — Prescriptions MVP

Goal: patient can view final prescriptions, medicine items, advice, follow-up, and print/download/share entry points. Current status: complete for the Hospital Services patient portal slice.

Deliverables:

- Prescription list filtered to final/non-void.
- Detail view with medicine items.
- Advice/follow-up/chief complaint/diagnosis display only where already patient-safe.
- Print/download entry via existing PDF/HTML endpoint.
- Share entry placeholder with safety copy.
- Refill request entry where supported.

Backend/data sources:

- `GET /api/patient-portal/prescriptions`
- `GET /api/patient-portal/prescriptions/:id/items`
- `GET /api/patient-portal/prescriptions/:id/pdf`
- `POST /api/patient-portal/prescriptions/:id/refill`
- `GET /api/patient-portal/refill-requests`

Tests:

- Ensure draft/void prescriptions are not listed or opened.
- Ensure item route audits reads.
- Update `test/patient-portal-ux.test.ts` if detail normalization helper is added.

### P1-D — Lab results MVP

Goal: patient can view verified/released lab results with unit/range/flag/explanation and report PDF/download entry.

Deliverables:

- Lab result list filtered to verified/released/completed/final.
- Detail view with test name, value, unit, reference range, abnormal flag, explanation.
- Report PDF/download entry.
- New/unread state if backend has enough signal; otherwise add placeholder status only.
- Safe language: explain flags without diagnosis or treatment advice.

Backend/data sources:

- `GET /api/patient-portal/lab-results`
- `GET /api/patient-portal/lab-results/:id/pdf`

Tests:

- Ensure draft/pending/unverified results never appear.
- Test lab explanation helper if extracted.

### P1-E — Bills MVP

Goal: patient can see due bills, paid history, receipt/download entry, and payment placeholders.

Deliverables:

- Due bill list and paid/history list.
- Bill summary totals.
- Receipt/download entry if backend route exists; otherwise documented placeholder.
- Payment placeholder for bKash/Nagad/card with disabled/coming-soon state.

Backend/data sources:

- `GET /api/patient-portal/bills`
- Existing billing/receipt endpoints if safely patient-scoped.

Tests:

- Bill status normalization helper test.
- Ensure no bill is fetched without selected hospital.

### P1-F — Documents MVP

Goal: patient can upload, list, download, and distinguish patient-uploaded documents from hospital records.

Deliverables:

- Vault list and tenant document list align with canonical contract.
- Upload UI validates file type/size before submit.
- Download action uses `download_url` / `downloadUrl`.
- Source badge: `patient_upload` vs `hospital_record`.
- Categories: prescription, lab report, discharge summary, other.

Backend/data sources:

- `POST /api/patient-portal/upload-document`
- `GET /api/patient-portal/documents`
- `GET /api/patient-portal/upload-document/:id/download`
- `/api/patient-phr/*` vault routes for global documents.

Tests:

- Keep `test/unit/patient-portal-documents-route.test.ts` updated.
- Add frontend helper test if a document normalization helper is introduced.

### P1-G — Messages MVP

Goal: patient can safely message a doctor/care team, see unread state, and understand emergency limits.

Deliverables:

- Conversation list.
- Thread view.
- Send message form.
- Unread badge/count if backend supports it.
- Emergency disclaimer: messages are not for emergency/urgent care.

Backend/data sources:

- `GET /api/patient-portal/messages`
- `GET /api/patient-portal/messages/:doctorId`
- `POST /api/patient-portal/messages`

Tests:

- Route tests for send validation if possible.
- UI test or helper guard for emergency disclaimer text if added.

### P1-H — Profile and correction requests

Goal: patient can update safe fields, but sensitive clinical/identity fields must require review/correction flow.

Deliverables:

- Safe profile fields remain editable.
- Sensitive fields show “Request correction” flow.
- Correction request route design documented before implementation.
- Audit any correction request submission.

Backend/data sources:

- `GET /api/patient-auth/me`
- `PATCH /api/patient-auth/me`
- New correction request route if needed.

Tests:

- Safe profile patch validation.
- Correction request validation once route exists.

## P2 roadmap

1. Timeline: selected-hospital unified events from appointment/prescription/lab/bill/document.
2. Medical records: list/detail with diagnoses and attached documents.
3. Vitals: patient-entered vs hospital-entered separation.
4. Visit pass: QR/card flow connected to selected appointment/hospital.
5. Emergency pack: conditions, allergies, meds, contacts, share/export.
6. Consent/privacy page: hospital links, consent matrix, AI toggle, devices/sessions.
7. Correction/amendment flow.
8. Sensitive module locks for mental health, women’s health, family-managed data.

## P3 roadmap

1. Medicine tracker from prescriptions with reminders/taken/skipped state.
2. Refill request UI and status tracking.
3. Lab trends for repeated tests.
4. Push notifications.
5. Family/dependent profile switcher and proxy consent polish.
6. Wellness score, daily check-in, food/water/sleep/activity modules.
7. AI coach with explicit consent and clinical data attribution.
8. Online payments.

## Implementation workflow

For every meaningful implementation slice:

1. Read `docs/PATIENT_PORTAL_SYSTEM_MAP.md` and this plan.
2. Pick the next unchecked priority item from `docs/PATIENT_PORTAL_WORKLOG.md` unless user asks for another slice.
3. Identify backend routes and frontend components from the system map.
4. Make the smallest safe code change.
5. Update tests.
6. Run relevant validation.
7. Update:
   - `docs/PATIENT_PORTAL_WORKLOG.md`,
   - `docs/PATIENT_PORTAL_SYSTEM_MAP.md` when mapping/contract changed,
   - this plan when priority/status changed.
8. Commit only related files. Do not include unrelated `.jules/palette.md` changes.

## Validation matrix

| Change type | Minimum validation |
| --- | --- |
| Frontend patient portal helper | `pnpm exec vitest run test/patient-portal-ux.test.ts` |
| Frontend app component | `pnpm --filter ozzyl-lifestyle exec tsc --noEmit --pretty false` plus relevant unit/component test if present |
| Tenant patient portal route | Specific route/unit test plus `test/integration/routes/precision-coverage.test.ts` or `top5-deep.test.ts` if route list changes |
| Document contract | `pnpm exec vitest run test/unit/patient-portal-documents-route.test.ts` |
| Food diary/wellness ownership | `pnpm exec vitest run test/patient-food-diary.test.ts` |
| Auth/session behavior | `pnpm exec vitest run test/patient-auth-rate-limit.test.ts test/patient-auth-otp.test.ts` plus E2E list check if route names change |
| Documentation contract | `pnpm exec vitest run test/unit/patient-portal-documentation-map.test.ts` |
| Any change | `git diff --check` |

## Do-not-break list

- Do not add another canonical patient login/session flow without updating this plan and tests.
- Do not show hospital clinical data without verified selected hospital context.
- Do not store clinical data in localStorage.
- Do not show draft/void prescriptions.
- Do not show draft/pending/unverified lab results.
- Do not expose raw document storage keys to the patient frontend.
- Do not silently let patients edit clinical or identity-sensitive fields.
- Do not treat food diary as tenant-scoped unless schema/tests are changed and documented.

## Next recommended implementation

Start with **P1-B Appointments MVP** because:

- Home and Care overview now both surface appointment context.
- The backend already has appointment list, available doctors, available slots, booking, cancel, and live visit routes.
- Completing appointment detail/booking/cancel UX will make the selected hospital workspace practically useful.

Current P1-B progress:

- Added `buildPatientAppointmentMvpState` in patient portal UX utilities through TDD.
- Added `buildPatientAppointmentBookingGuard` in patient portal UX utilities through TDD.
- `PatientHospitalServicesTab` now has selectable appointment detail, cancel action, disabled reschedule-ready placeholder, queue/token/counter/ETA display, and booked-slot preflight validation before booking submit.
- Route-level appointment guards now cover available-slot doctor validation, normalized `bookedTimes`, server-side same-time conflict rejection before booking, and cancellable patient-owned appointment states (`pending_approval`, `scheduled`, `confirmed`, `booked`).
- Generated available-slot support is now implemented from active `doctor_schedules` using weekday, start/end window, and `max_patients`; booking validates requested times against generated slots when a schedule exists.
- P1-C Prescriptions is functionally complete for the selected-hospital workspace: final-only list, patient-safe detail panel, safe items, PDF/download, refill, explicit share, DD-MM-YYYY dates, and audit coverage are present.
- P1-D is complete for the current patient portal scope: released lab detail, safe PDF, unit/range/flag/explanation, detail panel, and share action are in place. No lab-read tracking signal exists yet, so no unread badge is shown.
- P1-E Bills is complete for the current patient portal scope: selected-hospital list/detail, audited detail route, due/paid totals, receipt placeholder, disabled payment placeholder, and billing-counter guidance are in place.

Suggested next commit scope:

1. Move to P1-F Documents enterprise-grade upload/list/download/source-badge flow.
2. Then continue P1-G Messages and P1-H Profile/correction requests.
3. Update worklog/map/plan after validation.

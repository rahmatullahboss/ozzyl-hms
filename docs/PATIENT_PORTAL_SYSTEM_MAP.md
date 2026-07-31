# Patient Portal System Map

Last updated: 2026-06-20  
Branch: `feature/patient-portal-worklog`  
Owner: Patient portal / OzzyLife workstream

This document maps the patient portal from backend route to frontend screen, data ownership, session context, storage key, and current test coverage. Keep this file updated whenever a patient portal route, UI section, or data contract changes.

## Product model

The portal has three data domains. Do not mix them silently.

1. **Global patient identity** — login, profile, family/dependent identity, global dashboard, visit pass, emergency pack, and cross-hospital summary.
2. **Selected hospital workspace** — hospital-owned clinical/financial/communication data. This data must not load unless the patient has a verified hospital link and a selected hospital context.
3. **Patient-owned PHR and wellness** — vault, food diary, self-reported data, wellness check-ins, medicine tracker, and patient-generated context.

## Canonical auth and session model

| Concern | Current canonical implementation | Frontend owner | Notes |
| --- | --- | --- | --- |
| Patient login | `POST /api/patient-auth/login` | `apps/ozzyl-lifestyle/src/pages/PatientLoginPage.tsx` | Email/phone + password. This is the canonical login path. |
| Registration | `POST /api/patient-auth/register` | `PatientLoginPage.tsx` | Creates global patient auth account. |
| Google login | `POST /api/patient-auth/google` | `PatientLoginPage.tsx` | Optional social login path. |
| Password reset | `POST /api/patient-auth/forgot-password`, `POST /api/patient-auth/reset-password` | `PatientLoginPage.tsx` | Existing password recovery flow. |
| Session check/profile | `GET /api/patient-auth/me` | `apps/ozzyl-lifestyle/src/hooks/patient-portal/usePatientPortalQueries.ts`, `PatientDashboardPage.tsx` | Source of truth for patient shell session. |
| Profile update | `PATCH /api/patient-auth/me` | `PatientDashboardPage.tsx`, profile section | Safe fields only. Clinical/identity-sensitive corrections should become correction requests, not silent edits. |
| Logout | `POST /api/patient-auth/logout` | `PatientDashboardPage.tsx` | Clears local patient shell state. |
| Legacy tenant auth | `/api/patient-portal/request-login`, `/verify-email`, `/refresh-token` | Legacy/bridge only | Not the canonical standalone patient shell login. Do not reintroduce stale `/request-otp` or `/verify-otp` assumptions under `/api/patient-portal`. |

Session storage/cookie behavior:

- Patient app uses global patient session (`phr_token` cookie or bearer token in tests).
- `global_patient_user` in localStorage is only a UI cache of safe identity/profile data.
- Clinical data must not be stored in localStorage.

## Hospital context contract

| Contract | Current rule |
| --- | --- |
| Verified hospital list | `GET /api/hospital-links` returns `hospitals` for verified links plus `all_hospitals`, `pending_hospitals`, and counts. |
| Active hospital key | `PATIENT_SELECTED_HOSPITAL_STORAGE_KEY = 'ozzyl_patient_selected_hospital'`. |
| Storage location | `window.sessionStorage`, not localStorage. |
| Tenant header | Hospital-scoped tenant bridge APIs require `X-Tenant-ID`. |
| UI rule | Care, appointments, prescriptions, labs, bills, and messages must not fetch/display hospital-owned data until a verified hospital is explicitly selected. |
| Stale selection | If stored selected hospital no longer matches a verified link, clear it and show a selection/CTA state. |

Frontend owners:

- `apps/ozzyl-lifestyle/src/components/patient/ConnectedCareTab.tsx`
- `apps/ozzyl-lifestyle/src/components/patient/PatientHospitalServicesTab.tsx`
- `apps/ozzyl-lifestyle/src/hooks/useConnectedCare.ts`
- `apps/ozzyl-lifestyle/src/lib/patientPortalUx.ts`

Backend owners:

- `src/routes/hospital-links.ts`
- `src/routes/tenant/patientPortal.ts`
- `src/lib/portal-consent-audit.ts`

## Backend route map

### `/api/patient-auth` — global patient account

| Endpoint | Purpose | Current frontend | Test notes |
| --- | --- | --- | --- |
| `POST /register` | Create patient account | Patient login/register page | Patient auth tests cover validation/rate-limit/OTP-related auth paths. |
| `POST /login` | Canonical login | Patient login page, E2E token setup | E2E now validates `/api/patient-auth/me`. |
| `POST /google` | Google login | Patient login page | Optional path. |
| `POST /forgot-password` | Password reset request | Patient login page | Keep email/SMS provider assumptions documented separately. |
| `POST /reset-password` | Complete reset | Patient login page | Token based. |
| `POST /refresh` | Refresh session | Auth route | Keep global scope. |
| `POST /logout` | Logout | Patient dashboard shell | Clears UI state. |
| `GET /me` | Session/profile | `usePatientProfileQuery`, `PatientDashboardPage.tsx` | Must be used by E2E token validation. |
| `PATCH /me` | Safe profile edits | Profile/data section | Clinical fields must not be silently edited. |
| `GET /my-hospitals` | Legacy account hospital discovery | Claim/onboarding flows | Do not use as substitute for selected verified hospital context. |
| `POST /verify-identity`, `/claim-card`, `/onboarding` | Card claim/onboarding | `PatientCardClaimPage.tsx`, `PatientOnboardingPage.tsx` | Part of identity lifecycle. |

### `/api/global-portal` — global dashboard, family, visit pass, AI/wellness summary

| Endpoint | Purpose | Current frontend | Data domain |
| --- | --- | --- | --- |
| `GET /dashboard` | Cross-hospital home summary | `PatientDashboardPage.tsx`, `PatientHomeSection.tsx` | Global summary from verified hospital links only. Returns appointments, final prescriptions, verified/released lab reports as `reports`/`labResults`, bills, and patient guidance. |
| `GET /hospitals` | Global hospital list | `usePatientPortalQueries.ts`, linked hospital UI | Verified/linked hospital view. |
| `GET /ai-plans`, `GET /ai-plans/:id`, `POST /ai-plans/generate`, `POST /ai-plans/:id/refine`, `POST /ai-plans/:id/checklist` | AI health plan lifecycle | AI planner/wellness UI | Must preserve explicit consent/safety copy. |
| `GET /wellness-hub`, `PUT /wellness-hub`, `POST /wellness-hub/checklist` | Wellness hub preferences/checklist | Wellness section | Patient-owned wellness domain. |
| `GET /family`, `POST /family/dependents`, `POST /family/members`, `POST /family/link-existing`, proxy-invite routes | Family/dependent management | Family section | Proxy/managed context must be explicit. |
| `GET /visit-pass`, `POST /visit-pass`, `DELETE /visit-pass/:id` | Global visit pass | Records/global records section | Current broader test suite has mock-related failures to clean up. |
| `GET /emergency-pack`, `POST /emergency-pack` | Emergency summary | Records/global records section | P2 safety polish. |

### `/api/hospital-links` — verified hospital connection and consent

| Endpoint | Purpose | Current frontend | Required behavior |
| --- | --- | --- | --- |
| `GET /` | List verified/pending/all links | `ConnectedCareTab`, `useHospitalLinks` | Return verified `hospitals` for selectable hospital context. |
| `POST /` | Request link | Find care / connected care | Audit link request. |
| `POST /:id/verify` | Verify hospital link | Connected care | Audit approve/reject. |
| `DELETE /:id` | Revoke link | Privacy/connected care | Clear stale selected hospital on frontend. |
| `GET /:id/data` | Pull selected hospital snapshot | `ConnectedCareTab` | Only verified link. Only patient-visible prescriptions/labs. |
| `GET /consents`, `PUT /consents` | Clinical consent matrix | Privacy/connected care | Explicit consent only. |
| `POST /:id/sync-labs` | Sync released labs to PHR context | Connected care | Audit success/denied/no-data. |
| `POST /:id/sync-prescriptions` | Sync final prescriptions to medication context | Connected care | Audit success/denied/no-data. |
| `POST /:id/pre-visit` | Generate pre-visit insight | Connected care | Audit lookup. Do not diagnose. |

### `/api/patient-portal` — selected hospital tenant bridge

This route is hospital-scoped unless explicitly documented as global patient-owned data.

| Endpoint | Purpose | Frontend owner | Current rule/status |
| --- | --- | --- | --- |
| `GET /dashboard` | Selected hospital dashboard summary | Hospital services | Requires global patient auth + `X-Tenant-ID`. Audit logged. |
| `GET /live-visit-status` | Queue/live visit card | Home/Care/Hospital services | Requires selected hospital. |
| `GET /appointments` | Appointment list | `PatientHospitalServicesTab` | Requires selected hospital. |
| `POST /book-appointment` | Book appointment | Hospital services | Requires selected hospital. |
| `POST /cancel-appointment/:id` | Cancel appointment | Hospital services | Requires selected hospital. |
| `GET /available-doctors`, `GET /available-slots/:doctorId` | Booking support | Hospital services | Requires selected hospital. |
| `GET /prescriptions` | Final prescriptions list | Hospital services | Final only. Audit logged. |
| `GET /prescriptions/:id/items` | Medicine items | Hospital services | Final prescription only. Audit logged. |
| `GET /prescriptions/:id/pdf` | Printable prescription | Hospital services | Final prescription only; audit download. |
| `POST /prescriptions/:id/refill`, `GET /refill-requests` | Refill workflow | P3/medicine tracker | Requires selected hospital. |
| `GET /lab-results` | Lab result list | Hospital services | Verified/released/completed/final only. Audit logged. |
| `GET /lab-results/:id/pdf` | Printable lab report | Hospital services | Should remain verified/released/completed/final only. |
| `GET /bills` | Bill list/history | Hospital services | Requires selected hospital. Audit logged. |
| `GET /messages`, `GET /messages/:doctorId`, `POST /messages` | Patient messages | Hospital services | Thread reads and sends are audit logged; add emergency disclaimer in UI. |
| `GET /timeline` | Unified selected-hospital events | P2 records | Requires selected hospital. |
| `GET /medical-records`, `GET /medical-records/:id`, `GET /diagnoses` | Medical records/diagnoses | P2 records | Requires selected hospital. |
| `POST /upload-document`, `GET /documents`, `GET /upload-document/:id/download` | Tenant patient document contract | Vault / hospital services | Canonical document contract with `patient_upload` vs `hospital_record`. |
| `GET /food-diary`, `POST /food-diary` | Food diary | Wellness | Global patient-owned PHR/wellness route. Does not require `X-Tenant-ID`. |
| Intake/reviews/health tips routes | Extra engagement | Later | Keep scoped and audited where clinical. |

### `/api/patient-phr` and `/api/wellness` — patient-owned PHR/wellness

| Area | Backend | Frontend | Data ownership |
| --- | --- | --- | --- |
| Vault documents | `/api/patient-phr/vault-documents` and related upload/update routes | `PatientVaultTab`, `MedicalDocumentVault` | Global patient-owned. |
| Self-reported data | `/api/patient-phr/reported-data`, vitals/ADR/lifestyle sections | `PatientReportedDataTab`, wellness modules | Patient-entered, review status needed for trust. |
| Food diary | `/api/patient-portal/food-diary` legacy route and wellness food UI | Food diary components | Global PHR/wellness; no selected hospital required. |
| Daily check-in/score/streaks | `/api/wellness/*` | `PatientDashboardPage`, wellness section | Patient-owned wellness domain. |

## Frontend route and component map

Patient-visible dates use `DD-MM-YYYY` through shared patient portal helpers (`formatPatientDateMonthYear` / `formatPatientDateTimeMonthYear`). Month-only calendar headers may remain month/year labels.

| App route | Tab id | Primary component(s) | Backend domains |
| --- | --- | --- | --- |
| `/patient/login` | N/A | `PatientLoginPage.tsx`, `PatientAuthTabs`, `PatientAuthRail` | `/api/patient-auth/*` |
| `/patient/home` or `/patient/dashboard` | `overview` | `PatientDashboardPage.tsx`, `PatientHomeSection.tsx` | `/api/patient-auth/me`, `/api/global-portal/dashboard`, selected hospital live visit status when hospital selected |
| `/patient/care` | `find-care`, `hospital-services` | `PatientCareSection`, `ConnectedCareTab`, `PatientFindCareTab`, `PatientHospitalServicesTab` | `/api/hospital-links`, `/api/patient-portal/*`, public marketplace/hospital search |
| `/patient/records` | `global-records`, `vault` | `PatientRecordsSection`, `PatientGlobalRecordsTab`, `PatientVaultTab` | `/api/global-portal/*`, `/api/patient-phr/*`, selected hospital documents where applicable |
| `/patient/wellness` | `trends`, `tips`, `diary-history`, `medicine-tracker`, `wellness` | `PatientWellnessSection`, Food/Activity/Sleep/Medicine modules | `/api/wellness/*`, `/api/patient-phr/*`, global patient-owned data |
| `/patient/family` | `family` | `PatientFamilySection`, `FamilyHealthHub` | `/api/global-portal/family*` |
| `/patient/privacy` | `data`, `privacy` | `PatientProfileSection`, `PatientPrivacyTab`, `PatientReportedDataTab` | `/api/patient-auth/me`, `/api/hospital-links/consents`, `/api/patient-phr/*` |

## Current MVP status

| Priority | Status | Notes |
| --- | --- | --- |
| P0 security/session/hospital context | Complete for current slice | Canonical auth, explicit hospital context, clinical filtering, audit pass, document contract, food diary ownership documented. |
| P1 Home | Complete | Home summary now shows next appointment, latest final prescription, latest verified/released result, due bill, and quick actions. |
| P1 Care overview | Complete | `ConnectedCareTab` shows selected-hospital header, live visit card when available, next appointment, recent final prescription, latest verified/released lab result, due bill summary, and empty states while preserving verified selected-hospital gating. |
| P1 Appointments | In progress / next | TDD slices added appointment detail helper, booking guard helper, and route-level appointment guards. UI now has selectable detail panel, cancel action, queue/token/counter/ETA display, disabled reschedule-ready placeholder, and booked-slot preflight validation before submit. Backend validates doctor slot lookups, returns normalized bookedTimes, generates availableSlots from active doctor_schedules weekday/capacity windows, rejects same-time and outside-schedule booking conflicts server-side, and allows patient-owned pending/confirmed/scheduled/booked cancellations. |
| P1 Prescriptions | Complete | Selected-hospital workspace covers final-only list, patient-safe detail panel, safe medicine items, PDF/download, refill request, explicit share action, DD-MM-YYYY dates, read/download audit, and safe item filtering. A separate full-page prescription route is not required before P1-D. |
| P1 Lab results | Complete | List/PDF exists. This slice added patient-safe detail route with verified/released/completed/final guard, unsafe sample-status filtering, unit/range/flag/explanation items, PDF/share actions, read audit, and PDF route status/date hardening. Hospital Services detail UI/share panel is present. No lab-read tracking signal exists yet, so no unread badge is shown. |
| P1 Bills | Complete | Selected-hospital list/detail flow is patient-safe. Detail route is audited and returns totals, paid, due, receipt placeholder, and disabled payment placeholder. No patient-scoped receipt/download route exists yet, so UI intentionally shows billing-counter receipt/payment guidance. |
| P1 Documents | Partially present | Canonical backend contract exists; vault/hospital UI should align with `source` labels and download actions. |
| P1 Messages | Partially present | Conversation/thread/send exists; unread badge and emergency disclaimer need UI polish. |
| P1 Profile | Partially present | Safe profile update exists; correction request flow remains. |

## Clinical visibility rules

| Data type | Patient-visible statuses | Blocked statuses | Enforcement |
| --- | --- | --- | --- |
| Prescriptions | `final`, `active`, `completed`, `dispensed` | `draft`, `void`, `voided`, `cancelled`, `canceled`, `deleted`, `inactive`, `stopped` | Backend route filters plus `normalizePatientClinicalDataForDisplay`. |
| Lab results | `verified`, `released`, `completed`, `final` | `draft`, `pending`, `unverified`, `preliminary`, `cancelled`, `canceled`, `void`, `voided` | Backend route filters plus `normalizePatientClinicalDataForDisplay`. |
| Bills | Visible when scoped to selected hospital or global verified-link dashboard | N/A | Do not show hospital bills without verified link/context. |
| Messages | Selected hospital only | N/A | Audit read/send, show emergency disclaimer. |
| Documents | Patient-owned vault or selected hospital document contract | N/A | Show `patient_upload` vs `hospital_record`. Do not expose raw storage keys. |

## Document contract

Tenant patient document responses must use the canonical patient-facing shape and may keep compatibility aliases:

```ts
{
  id,
  title,
  description,
  document_type,
  type,
  file_name,
  file_size,
  fileSize,
  mime_type,
  mimeType,
  created_at,
  date,
  source,        // patient_upload | hospital_record
  source_label,  // same as source for compatibility
  download_url,
  downloadUrl
}
```

Do not expose raw `file_key` to patient-facing frontend responses.

## Current tests and guardrails

| Test file | Purpose |
| --- | --- |
| `test/e2e/api/patient-portal.spec.ts` | Patient portal API E2E surface; now aligned to canonical `/api/patient-auth/*` login/session. |
| `test/patient-portal-ux.test.ts` | Frontend helper contracts: dashboard payload, selected-hospital helpers, clinical filtering, live visit normalization. |
| `test/patient-food-diary.test.ts` | Food diary is global patient-owned PHR/wellness; no tenant header required. |
| `test/unit/patient-portal-documents-route.test.ts` | Tenant document route has one canonical contract and no raw storage key leak. |
| `test/patient-auth-rate-limit.test.ts`, `test/patient-auth-otp.test.ts` | Patient auth safety/validation coverage. |
| `test/integration/routes/precision-coverage.test.ts`, `test/integration/routes/top5-deep.test.ts` | Route smoke/coverage lists, stale OTP route assumptions removed. |
| `test/unit/patient-portal-documentation-map.test.ts` | Documentation drift guard for this mapping and plan docs. |

Known validation state:

- Passing: patient portal UX helper tests, food diary tests, document route tests, route smoke tests, `ozzyl-lifestyle` TypeScript check.
- Known broader blockers: root TypeScript still fails on unrelated repo issues such as missing `schema-migrations.generated`, `bank-book` `getDb`, and existing `patients.ts` unknown-type errors. Broader global visit-pass/family graph tests have existing/mock-related failures that need separate cleanup.

## Update protocol

When changing patient portal behavior:

1. Update the backend route or frontend component.
2. Update this map if a route, data owner, storage key, or visibility rule changed.
3. Update `docs/PATIENT_PORTAL_IMPLEMENTATION_PLAN.md` if priority/order/status changed.
4. Update `docs/PATIENT_PORTAL_WORKLOG.md` after each meaningful fix.
5. Add or update tests for the changed contract.
6. Run the smallest relevant test set plus `git diff --check` and, when touching frontend, `pnpm --filter ozzyl-lifestyle exec tsc --noEmit --pretty false`.

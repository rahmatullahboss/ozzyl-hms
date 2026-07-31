# Ozzyl Health Flutter Mobile A-Z Audit Checklist

Date: 2026-05-01
Scope: `apps/ozzyl_health` Flutter patient/wellness app plus shared Dart package `packages/ozzyl_core`

## Product Intent

Ozzyl Health is a patient-owned health and wellness mobile app that can work standalone for daily wellness tracking and can unlock connected hospital features when a patient links to the HMS platform. The mobile app should not become a doctor dashboard or a hospital back office. Doctor/hospital operational workflows belong in the HMS web/staff products, while the mobile app owns patient identity, wellness, personal health records, consent-facing UX, notifications, and hospital connection flows.

## Research Anchors

Implementation and backlog decisions should align with these primary references:

- OWASP MASVS: mobile storage, network, authentication, privacy, and platform control expectations. https://mas.owasp.org/MASVS/
- HHS HIPAA Security Rule technical safeguards: access control, audit controls, integrity, authentication, and transmission security mindset. https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html
- HL7 FHIR R4: interoperability model for patient, observation, medication, document, and diagnostic data exchange. https://hl7.org/fhir/R4/
- Apple HealthKit privacy and permissions: explicit user permission for health data access. https://developer.apple.com/documentation/healthkit
- Android Health Connect: user-granted health permissions and health record APIs. https://developer.android.com/health-and-fitness/guides/health-connect
- Flutter secure storage package: platform keychain/keystore storage for tokens and sensitive profile fragments. https://pub.dev/packages/flutter_secure_storage

## Status Legend

- Done: implemented in the Flutter app or existing backend-facing mobile flow.
- Improved in this branch: implemented or hardened in branch `codex/flutter-health-a-z`.
- Partial: usable foundation exists, but production completeness is missing.
- Gap: not implemented in the Flutter app.
- External dependency: requires hospital contracts, gateway credentials, app store setup, legal approval, or backend contract work before mobile completion can be truthful.

## Current Implementation Snapshot

### 1. User Profile

| Item | Status | Evidence / Next Work |
|---|---|---|
| Basic account identity | Partial | Auth state exposes name/email. Full age, gender, blood group profile edit screen is incomplete. |
| Emergency contact | Improved in this branch | Emergency contacts now use secure storage instead of SharedPreferences. |
| Blood group | Improved in this branch | Emergency blood type persists via secure storage. Needs sync to patient profile endpoint. |
| Chronic disease history | Gap | Needs profile/PHR endpoint mapping and mobile edit/review UI. |
| Allergy list | Partial, improved in this branch | Emergency allergy card exists and now stores locally in secure storage. Server-backed allergy sync is read-only in health records. |

### 2. Medical Records

| Item | Status | Evidence / Next Work |
|---|---|---|
| Allergies, medications, diagnoses, vaccines | Partial | `health_records` page fetches `/api/v1/patient-phr/*` read-only lists. |
| Prescription list | Partial | Prescription list exists. Upload/analyzer/refill completion needs endpoint and UI hardening. |
| Lab report list/detail | Partial | Lab result list/detail exists. Download/view PDF handling still needs signed/protected file handling across all server document types. |
| Document vault upload | Improved in this branch | Added mobile document vault screen, file picker, type/size policy, multipart upload, progress UI, and remote list/open flow. Offline retry queue is still missing. |
| Timeline view | Improved in this branch | Added unified chronological mobile timeline combining diagnoses, vaccines, and vault documents. Prescription/lab timeline mapping still depends on backend payload normalization. |

### 3. Health Tracking

| Item | Status | Evidence / Next Work |
|---|---|---|
| Mood | Done | Mood tracker local feature exists. |
| Water | Done | Water intake local feature exists. |
| Sleep | Partial | Bedtime/wake/quality local logging exists. Wearable sync and score are missing. |
| Exercise | Partial | Manual exercise logging exists. Step sensor/wearable integration needs hardening. |
| Weight/BMI | Improved in this branch | BMI calculator exists and vitals logging now captures weight with recent-history display. Trend charts remain backlog. |
| Blood pressure | Improved in this branch | Added patient-facing BP/pulse log UI with local secure storage and non-diagnostic boundary copy. Server sync remains backlog. |
| Blood sugar | Improved in this branch | Added glucose logging with fasting/post-meal/random context and unit selection. Server sync and clinical thresholds remain backend/product backlog. |
| Wearables | External dependency | Requires HealthKit/Health Connect permissions, store disclosures, and user consent UX. |

### 4. Doctor & Hospital Features

| Item | Status | Evidence / Next Work |
|---|---|---|
| Hospital discovery/profile | Partial | Hospital tab, detail page, and link action exist. |
| Appointments | Improved in this branch | List/book/cancel flows exist and cards now explain pending, confirmed, locked, scheduled, cancelled, and completed states. Real-time confirmation still depends on backend event delivery. |
| Doctor full patient history | External dependency | Belongs in doctor/staff product, not patient app. Patient app should expose consent controls and visit sharing. |
| AI quick summary for doctor | External dependency | Requires backend clinical summary endpoint, consent, audit log, and physician UI. |
| Offline fallback | Partial | Local wellness DB and cache DB exist. Hospital read-cache coverage is inconsistent and needs TTL badges. |

### 5. AI & Smart Features

| Item | Status | Evidence / Next Work |
|---|---|---|
| Symptom checker | Improved in this branch | UI posts to AI endpoint, adds stronger disclaimer, local emergency keyword escalation, and response safety fallback. A structured server contract is still needed. |
| Prescription analyzer | Gap | Must remain educational and safety-focused, not dosing/prescribing. |
| Drug interaction warning | Gap in mobile | Backend has drug-interaction plans/tests; mobile needs read-only warnings from server. |
| Health risk prediction | Partial | BMI/heart risk screens exist. Must be non-diagnostic and transparent. |
| Personalized tips | Partial | Articles/tips exist. Needs preference, clinical-context consent, and explainability. |

### 6. Security & Privacy

| Item | Status | Evidence / Next Work |
|---|---|---|
| Auth route protection | Improved in this branch | Protected routes now redirect unauthenticated users to login via `AuthRoutePolicy`. |
| Token storage | Improved in this branch | `createOzzylSecureStorage()` sets stronger Android algorithms and device-local iOS/macOS keychain access. |
| PHI-safe network logging | Improved in this branch | Dio `LogInterceptor` no longer logs request/response bodies or headers. DI disables logging. |
| Sensitive emergency local data | Improved in this branch | Emergency blood type/allergies/contacts moved from SharedPreferences to secure storage. |
| Consent management | Improved in this branch | Added Privacy & Consent center with local doctor/hospital, AI context, family/proxy, analytics, and emergency-sharing toggles. Backend consent/audit APIs are still required for production truth. |
| Audit log visibility | Partial, improved in this branch | Added patient-facing access/audit placeholder surface that explains when no server events are available. Needs backend audit feed. |
| Data export/delete | Partial, improved in this branch | Added release/privacy screens that surface export/delete requirements. Actual export/delete flow needs backend endpoint and legal workflow. |
| E2E encryption | External dependency | Requires key management and product/legal decision; secure transport and storage are immediate baseline. |

### 7. Integration

| Item | Status | Evidence / Next Work |
|---|---|---|
| Production API base URL | Done | `ApiConstants.prodBaseUrl` points to production Worker URL. |
| JWT/OAuth headers | Partial | Auth and tenant interceptors exist. Refresh-token flow is incomplete. |
| Rate-limit UX | Gap | Mobile should show patient-friendly retry/backoff messages. |
| Conflict handling | Gap | Offline writes need conflict policy and server idempotency keys. Vitals currently store locally only, so no server conflict path exists yet. |
| Hospital middleware compatibility | Partial, improved in this branch | Mobile now shows per-hospital capability status for appointments, labs, prescriptions, documents, and payments. Real compatibility still requires mapping contracts and integration middleware. |

### 8. UI/UX

| Item | Status | Evidence / Next Work |
|---|---|---|
| Simple dashboard | Partial | Home/wellness/hospital/articles/profile shell exists. |
| Bangla + English | Partial | Generated l10n exists, but many screens still use hardcoded English strings. |
| Large font/older user ergonomics | Partial | Needs accessibility pass and scalable text testing. |
| Dark mode | Done | Theme controller and profile toggle exist. |
| Doctor-fast patient load | External dependency | Doctor UI is outside this mobile patient app. |

### 9. Performance & Scalability

| Item | Status | Evidence / Next Work |
|---|---|---|
| Local-first wellness | Done | Drift wellness DB exists. |
| Cache DB for hospital reads | Partial | Cache tables exist; not all repositories fully use offline fallback and TTL states. |
| Image/PDF preprocessing | Gap | Document upload must validate/compress/preview client-side where safe. |
| Heavy work off request path | Backend rule | Mobile must avoid OCR/PDF rendering in synchronous API request paths. |

### 10. Testing

| Item | Status | Evidence / Next Work |
|---|---|---|
| Unit tests | Improved in this branch | Added route policy, API logging, secure storage factory, and emergency profile storage tests. |
| Widget tests | Partial | Smoke widget tests exist. Need screen-level tests for records, hospital linking, uploads, consent, and privacy screens. |
| Security tests | Improved in this branch | Core mobile security tests cover route guards, secure storage settings, PHI-safe logging, AI response safety, and emergency secure storage. Needs mobile deep link/session tests. |
| Integration tests | Gap | Needs API contract tests against staging/production-safe fixtures. |

### 11. Monetization & GTM

| Item | Status | Evidence / Next Work |
|---|---|---|
| Hospital subscription | External dependency | Belongs in backend/web admin. Mobile may show patient-facing plan benefits later. |
| Doctor subscription | External dependency | Staff/doctor product scope. |
| Premium user plan | Gap | Needs pricing, payment gateway, entitlement model, app store policy review. |
| API access pricing | External dependency | Platform/business scope. |
| Local hospital pilot | External dependency | Requires operational onboarding outside code. |

### 12. Legal & Compliance

| Item | Status | Evidence / Next Work |
|---|---|---|
| Terms and privacy policy | Improved in this branch | Added in-app Terms, Privacy Policy, Medical Disclaimer, and release-readiness checklist pages. Legal text must be reviewed before production. |
| Medical disclaimer | Improved in this branch | Added app-wide disclaimer page and stronger symptom checker warning policy. |
| Data ownership clarity | Improved in this branch | Privacy center now states patient control intent and consent boundaries. Backend export/delete policy still needed. |
| AI disclaimer and boundaries | Improved in this branch | Added AI consent toggle, local red-flag escalation, and tests blocking diagnostic/prescriptive language in fallback handling. |

## Implemented In Branch `codex/flutter-health-a-z`

1. Added isolated route policy and wired `GoRouter` redirect so protected health/hospital/profile routes require an auth token.
2. Kept `/emergency` accessible without login/onboarding for emergency use, while storing its local sensitive data securely.
3. Added shared secure-storage factory in `ozzyl_core` with stronger Android crypto options and device-local Apple keychain settings.
4. Disabled production network body/header logging and made even debug logging PHI-safe.
5. Migrated emergency blood type, allergies, and contacts from SharedPreferences to FlutterSecureStorage.
6. Fixed analyzer issues in Drift table constraints and gamification service.
7. Added regression tests for route protection, secure storage settings, safe network logging, and emergency storage parsing.
8. Added Privacy & Consent center with consent toggles, audit/access placeholder, legal pages, and release checklist route.
9. Added patient document vault with file picker, PDF/image/WebP validation, multipart upload, progress state, remote list, and protected open/download path handling.
10. Added Health Records timeline that merges diagnoses, immunizations, and vault documents date-wise.
11. Added vitals logging for blood pressure, pulse, glucose, and weight using secure local storage.
12. Hardened symptom checker with local emergency red-flag detection, safer fallback response handling, and explicit non-diagnostic copy.
13. Added tests for consent storage, document file policy, vitals secure storage, and AI symptom safety.
14. Added hospital integration capability display and appointment status explanations for pending/confirmed/locked states.

## One-by-One Implementation Backlog

Checklist markers: `[x]` mobile-side done in this branch, `[~]` partially done with a named backend/legal/integration dependency, `[ ]` still open.

### Sprint A: Mobile P0 Privacy Completion

- [x] Auth guard for protected routes.
- [x] PHI-safe Dio logging.
- [x] Secure storage factory.
- [x] Emergency local PHI secure storage.
- [x] Add privacy policy, terms, and medical disclaimer screens.
- [x] Add patient consent screen for hospital access, AI context access, and family/proxy access.
- [~] Add audit log screen showing record/document access events. Mobile placeholder exists; server audit feed remains required.
- [ ] Add session timeout/re-auth for sensitive screens.

### Sprint B: Medical Records & Upload

- [x] Add patient document vault list screen under Health Records.
- [x] Add file picker for PDF/JPEG/PNG/WebP only.
- [x] Add client-side file size/type validation before upload.
- [x] Upload to `/api/v1/patient-phr/vault/upload` using multipart form data.
- [~] Show upload progress, failure retry, and offline queue state. Progress and failure state exist; offline retry queue remains backlog.
- [x] Add protected file open/download flow for `/api/v1/patient-phr/vault/:id/file`.
- [~] Add unified date-wise timeline combining prescriptions, labs, diagnoses, vaccines, and vault documents. Diagnoses, vaccines, and vault docs are included; prescriptions/labs need normalized backend date fields.

### Sprint C: Vitals & Wellness Depth

- [x] Add BP log UI with systolic/diastolic/pulse, units, notes, and non-diagnostic warning boundaries.
- [x] Add glucose log UI with fasting/post-meal/random context and mmol/L/mg/dL support.
- [~] Add weight trend logging and BMI trend, not only calculator. Weight logging exists; trend chart/BMI history remains backlog.
- [ ] Add dashboard daily score explanation with sleep/activity/water/mood/goals inputs.
- [ ] Add HealthKit/Health Connect permission UX before any wearable sync.

### Sprint D: AI Safety

- [~] Replace free-form symptom response with structured server contract: urgency, self-care education, red flags, disclaimer. Mobile safety wrapper exists; server contract remains required.
- [x] Add emergency keyword detection and local emergency CTA.
- [x] Add AI context consent toggle.
- [ ] Add prescription/lab explanation screens that are educational only and never prescribe or diagnose.
- [x] Add tests that forbid diagnosis, dosage, medication changes, or emergency reassurance wording.

### Sprint E: Hospital Connectivity

- [~] Add linked hospital account status and patient ID mapping view. Capability display exists; actual linked patient ID mapping needs backend endpoint.
- [x] Add appointment lock/confirmation/pending/cancelled status states.
- [ ] Add stale cache badges for hospital data.
- [ ] Add conflict messages for offline edits.
- [x] Add per-hospital integration capability display: appointments, labs, prescriptions, documents, payments.

### Sprint F: Localization, Accessibility, Release

- [ ] Replace hardcoded strings with ARB keys screen by screen.
- [ ] Add Bangla copy review for non-technical and older users.
- [ ] Test text scale factors and large font layouts.
- [x] Add mobile release checklist: app icon, signing, privacy manifest, permissions rationale.
- [ ] Add production smoke tests against production-safe non-PHI fixtures.

## Definition Of Done

A task is not complete until:

1. Sensitive routes enforce authentication or are explicitly designed public emergency surfaces.
2. No request/response body or health detail is logged by the mobile app.
3. Local sensitive data uses secure storage, not SharedPreferences.
4. Server remains source of truth for auth, consent, audit, bookings, payments, and records.
5. AI features include medical boundary copy and cannot diagnose, prescribe, or provide dosage changes.
6. `flutter test` and `flutter analyze` pass for the app and shared core package.
7. Any external dependency is documented instead of being marked done without real credentials/contracts/legal approval.

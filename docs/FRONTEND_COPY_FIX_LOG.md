# Frontend Copy Fix Log

**Repo:** `rahmatullahboss/ozzyl-hms`  
**Started:** 2026-06-16  
**Purpose:** Keep a running tracker of UI copy/i18n cleanup work.

---

## Done

### Auth
- `web/public/locales/en/auth.json` — `6a069c75aea8dc39222e7da23df0a6f3f285886a`
- `web/public/locales/bn/auth.json` — `efe0414ff44d24b00545ba0042bf2ab39c4ae29d`
- `web/src/pages/AdminLogin.tsx` — `ceebf590747d1346d72272a2b3e74001ba73b59a`

### Patient area
- `web/src/pages/PatientList.tsx` — `9b6a5c160bd9afe23a4af50ac55867b8d934ae68`
- `web/src/components/PatientActivationCodeAction.tsx` — `13497dad85ef7297028790d3bc7f2ef35b8de669`
- `web/src/pages/PatientTimeline.tsx` — `19f9990bbcb691e197d95a1db5cf681b2ab0befe`
- `web/public/locales/bn/common.json` scanner text — `9d68d8f0e5c3510516821ea67a02b78853ce35d5`

### Shared UI
- `web/src/components/HelpButton.tsx` — `bf5cbe3f72dd24f8b90efcfd2b228a22dc8bbf75`
- `web/src/components/HelpPanel.tsx` — `2c1ad618cdedbc0832a9a0aa8112cdb6d3e09015`
- `web/public/locales/en/common.json` help keys — `1d051cfa4d38263533bcb7e6b432efc39c5a9655`
- `web/public/locales/bn/common.json` help keys — `fc6a13f8ead1b5e868428645d62a3d5e0d0ed6aa`
- `web/src/components/ErrorBoundary.tsx` — `0aa381b2edd584b5794c298daafb159be550dc76`
- `web/public/locales/bn/common.json` error fallback keys — `d07c8db81345349eb7c61808dccc4e50c416e0d0`
- `web/public/locales/en/common.json` error fallback keys — `807107edfefa193f24f850ac1ce659f9db15917e`

### Frontend privacy / PWA / offline hardening
- `web/src/lib/tokenStore.ts` (new) — `ba602fb3`
- `web/src/lib/apiClient.ts` + `web/src/lib/apiClient.test.ts` — `ba602fb3`
- `web/src/hooks/useAuth.ts` + `web/src/hooks/usePushNotifications.ts` — `ba602fb3`
- `web/src/pages/AdminLogin.tsx` + `DoctorLogin.tsx` + `DoctorRegister.tsx` — `ba602fb3`
- `web/src/pages/GroupAttendance.tsx` + `SuperAdminHospitalList.tsx` + `SuperAdminHospitalDetail.tsx` — `ba602fb3`
- `web/src/components/ImpersonationBanner.tsx` + `shareholders/PdfImportModal.tsx` — `ba602fb3`
- `web/vite.config.ts` + `web/src/lib/api-paths.ts` (new) + `web/src/main.tsx` — `47016bf7`
- `web/src/lib/secure-store.ts` (new) — `9296cefb`
- `web/src/lib/sync-engine.ts` — `91c6fa77`

### Patient area UI copy
- `web/src/pages/PatientForm.tsx` + `web/public/locales/{en,bn}/patients.json` — `562084c6`
- `web/src/pages/PatientDetail.tsx` + `web/public/locales/{en,bn}/patients.json` — `d435e85b`

### Shared UI
- `web/src/pages/HelpCenterPage.tsx` + `web/public/locales/{en,bn}/helpCenter.json` — `4e584c74`
- `web/src/pages/PatientChartWorkspace.tsx` + `web/public/locales/{en,bn}/clinical.json` — `4637573f`

---

## Inspected / needs careful patch

- `web/src/pages/PatientForm.tsx` — quick-registration and duplicate-warning copy patched (562084c6). Other copy still hardcoded; deeper pass deferred.
- `web/src/pages/PatientDetail.tsx` — table headers patched (d435e85b). Deeper pass for description/body copy deferred.
- `web/src/pages/PatientChartWorkspace.tsx` — section headers + risk score patched (4637573f). Deeper pass for body copy deferred.
- `web/src/pages/PatientCardScanner.tsx` — mostly i18n-based; Bengali locale was polished instead.
- `web/src/pages/HelpCenterPage.tsx` — mostly translation-driven; remaining hardcoded counters/footer labels found, needs full-file-safe patch.

---

## Inspected / no copy change needed

- `web/src/components/LoadingFallback.tsx` — skeleton-only, no visible copy.
- `web/src/components/ProtectedRoute.tsx` — redirect-only, no visible copy.
- `web/src/components/dashboard/KPICard.tsx` — copy is passed in through props.

---

## Blocked update attempts

- `web/src/components/WhatsAppButton.tsx` — update attempt blocked by tool safety check.
- `web/src/components/clinical/TimelineEventExpandable.tsx` — update attempt blocked by tool safety check.
- `web/src/components/clinical/PatientEmrHeader.tsx` — update attempt blocked by tool safety check.

---

## Next queue

1. Patch `PatientForm.tsx` safely.
2. Continue `PatientDetail.tsx`.
3. Continue `PatientChartWorkspace.tsx`.
4. Patch `HelpCenterPage.tsx` safely.
5. Continue remaining module pages and shared UI components.

---

## Main report

The main phased review report remains: `docs/CODE_REVIEW_PHASED_REPORT.md`.

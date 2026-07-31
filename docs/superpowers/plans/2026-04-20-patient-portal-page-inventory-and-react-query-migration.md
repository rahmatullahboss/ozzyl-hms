# Patient Portal Page Inventory And React Query Migration

Date: 2026-04-20
Workspace: `/Users/rahmatullahzisan/Desktop/Dev/hms`

## Goal

Define:

- which current patient-facing pages/components should be kept
- which should be merged
- which should be removed after redesign
- where existing `React Query` hooks can be reused
- what new query hooks are still needed

---

## Existing React Query Coverage

The patient portal already has meaningful `React Query` adoption in these hooks:

- [useConnectedCare.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useConnectedCare.ts)
- [useDeviceSync.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useDeviceSync.ts)
- [useFamilyGraph.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useFamilyGraph.ts)
- [useFoodLog.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useFoodLog.ts)
- [useVisitPass.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useVisitPass.ts)
- [usePatientWellness.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/usePatientWellness.ts)

This means the redesign should **not** replace everything from scratch. It should unify the existing query model and move page-level `useEffect + fetch` code into shared patient portal hooks.

---

## Current Patient Surface Inventory

### Current entry pages

- [PatientLoginPage.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/pages/PatientLoginPage.tsx)
- [PatientOnboardingPage.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/pages/PatientOnboardingPage.tsx)
- [PatientPortal.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/pages/PatientPortal.tsx)
- [PatientDashboardPage.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/pages/PatientDashboardPage.tsx)

### Current patient-heavy components

Notable components currently mixed into the dashboard:

- care:
  - [ConnectedCareTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/ConnectedCareTab.tsx)
  - [LinkedHospitalsList.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/LinkedHospitalsList.tsx)
  - [PatientFindCareTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/PatientFindCareTab.tsx)
  - [PatientHospitalServicesTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/PatientHospitalServicesTab.tsx)
- records:
  - [PatientVaultTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/PatientVaultTab.tsx)
  - [MedicalDocumentVault.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/MedicalDocumentVault.tsx)
  - [PatientGlobalRecordsTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/PatientGlobalRecordsTab.tsx)
  - [PatientReportedDataTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/PatientReportedDataTab.tsx)
  - [VisitPassQR.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/VisitPassQR.tsx)
- wellness:
  - [WellnessTrendsTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/WellnessTrendsTab.tsx)
  - [WellnessScoreCard.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/WellnessScoreCard.tsx)
  - [ScoreTrendChart.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/ScoreTrendChart.tsx)
  - [PatientAIPlannerTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/PatientAIPlannerTab.tsx)
  - [WellnessHubSection.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/WellnessHubSection.tsx)
- family:
  - [FamilyHealthHub.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/FamilyHealthHub.tsx)
- privacy:
  - [PatientPrivacyTab.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/PatientPrivacyTab.tsx)
  - [PrivacyLockPanel.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/PrivacyLockPanel.tsx)
  - [DeviceManagementCard.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/components/patient/DeviceManagementCard.tsx)

---

## Keep / Merge / Remove

## Keep

These should survive the redesign, though often under new layout containers:

- `PatientLoginPage`
- `PatientOnboardingPage`
- `ConnectedCareTab`
- `LinkedHospitalsList`
- `PatientVaultTab`
- `MedicalDocumentVault`
- `PatientReportedDataTab`
- `PatientAIPlannerTab`
- `WellnessHubSection`
- `FamilyHealthHub`
- `VisitPassQR`
- `PatientPrivacyTab`
- `PrivacyLockPanel`

Reason:

- they already map to real backend products
- many are feature modules, not just temporary UI

## Merge

These should be merged into fewer backend-aligned page groups:

- `PatientHospitalServicesTab` + `ConnectedCareTab` + `LinkedHospitalsList`
  - merge into new `Care` tab pages
- `PatientVaultTab` + `MedicalDocumentVault`
  - merge into `Records > Vault`
- `PatientGlobalRecordsTab` + `VisitPassQR`
  - split into `Records > Timeline/Medical Records` and `Records > Visit Pass`
- `WellnessTrendsTab` + `WellnessScoreCard` + `ScoreTrendChart`
  - merge into `Wellness > Overview/Trends`
- `PatientPrivacyTab` + `PrivacyLockPanel` + `DeviceManagementCard`
  - merge into `Privacy & Sharing`

## Remove after migration

These should disappear after the new IA is live:

- [PatientPortal.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/pages/PatientPortal.tsx)
  - currently just legacy redirect glue
- the old mixed 12-tab navigation model inside [PatientDashboardPage.tsx](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/pages/PatientDashboardPage.tsx)
- duplicate shell logic that is now being extracted from `PatientDashboardPage`

Potential remove-or-reassess:

- `PatientMentalHealthTab.tsx`
- `PatientWomensHealthTab.tsx`
- `PatientVisitPass.tsx`

These look like older alternate surfaces and should be checked against the currently used components before deletion.

---

## New Route Model

Recommended route map:

- `/patient/home`
- `/patient/care`
- `/patient/care/appointments`
- `/patient/care/prescriptions`
- `/patient/care/labs`
- `/patient/care/bills`
- `/patient/care/messages`
- `/patient/records`
- `/patient/records/vault`
- `/patient/records/medical-records`
- `/patient/records/self-reported`
- `/patient/records/visit-pass`
- `/patient/records/emergency-pack`
- `/patient/wellness`
- `/patient/wellness/trends`
- `/patient/wellness/goals`
- `/patient/wellness/ai-planner`
- `/patient/wellness/screenings`
- `/patient/family`
- `/patient/privacy`

Migration rule:

- old `/patient/dashboard?tab=*` should temporarily redirect to the new matching route
- only after telemetry/manual verification should old tab-based paths be removed

---

## React Query Reuse Plan

## Reuse as-is or lightly adapt

### Care

Reuse:

- `useConnectedCareHospitals`
- `useConnectedCareData`
- `useHospitalConsents`
- `useUpdateHospitalConsent`
- `useSyncHospitalLabs`

From:

- [useConnectedCare.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useConnectedCare.ts)

### Family

Reuse:

- family proxy invites query/mutations

From:

- [useFamilyGraph.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useFamilyGraph.ts)

### Wellness

Reuse:

- score
- score trend
- streaks
- check-in mutation
- goals
- cycle
- sleep
- adverse reactions
- wellness hub
- AI planner-related supporting data where applicable

From:

- [usePatientWellness.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/usePatientWellness.ts)

### Records

Reuse:

- visit pass query/mutations
- food log queries/mutations

From:

- [useVisitPass.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useVisitPass.ts)
- [useFoodLog.ts](/Users/rahmatullahzisan/Desktop/Dev/hms/apps/ozzyl-lifestyle/src/hooks/useFoodLog.ts)

---

## New Query Hooks Needed

These are the missing shared hooks that should replace page-level manual fetches.

### Identity and global home

- `usePatientProfileQuery`
- `usePatientGlobalDashboardQuery`
- `usePatientHospitalsQuery`

Backends:

- `/api/patient-auth/me`
- `/api/global-portal/dashboard`
- `/api/global-portal/hospitals`

### Hospital workspace

- `usePatientPortalDashboardQuery(tenantId)`
- `usePatientAppointmentsQuery(tenantId, params)`
- `usePatientPrescriptionsQuery(tenantId, params)`
- `usePatientPrescriptionItemsQuery(tenantId, prescriptionId)`
- `usePatientLabResultsQuery(tenantId, params)`
- `usePatientBillsQuery(tenantId, params)`
- `usePatientMessagesQuery(tenantId)`
- `usePatientLiveVisitQuery(tenantId)`
- `useAvailableDoctorsQuery(tenantId, params)`

### Records

- `usePatientVaultQuery`
- `usePatientMedicalRecordsQuery(tenantId, params)`
- `usePatientTimelineQuery(tenantId, params)`
- `usePatientSelfReportedQuery`

### Profile and privacy mutations

- `useUpdatePatientProfileMutation`
- `useLinkHospitalMutation`
- `useUnlinkHospitalMutation`

---

## Query Key Rules

Use stable domain-based keys, not page names.

Recommended keys:

- `['patient-profile']`
- `['patient-global-dashboard', actingIdentityId]`
- `['patient-hospitals', actingIdentityId]`
- `['patient-care-dashboard', tenantId]`
- `['patient-appointments', tenantId, filters]`
- `['patient-prescriptions', tenantId, filters]`
- `['patient-lab-results', tenantId, filters]`
- `['patient-bills', tenantId, filters]`
- `['patient-live-visit', tenantId]`
- `['patient-vault']`
- `['patient-medical-records', tenantId, filters]`
- `['patient-timeline', tenantId, filters]`
- `['wellness-score', date]`
- `['wellness-score-trend', days]`
- `['wellness-streaks']`
- `['wellness-hub']`
- `['visit-pass']`
- `['family-overview']`
- `['family-proxy-invites']`

---

## Migration Execution Order

### Step 1

Create a new patient data access folder:

- `apps/ozzyl-lifestyle/src/hooks/patient-portal/`

### Step 2

Move page-level patient fetches from `PatientDashboardPage.tsx` into shared query hooks.

### Step 3

Build the new route shell with the 5 primary tabs.

### Step 4

Migrate pages in this order:

1. Home
2. Care
3. Records
4. Wellness
5. Family
6. Privacy

### Step 5

After all redirects are stable:

- remove old tab query param routing
- remove `PatientPortal.tsx`
- remove dead patient tab components that are no longer mounted

---

## Decision

Yes, the redesign should use `React Query` as the primary patient data orchestration layer.

But:

- do not rewrite already good hooks
- do not delete old pages before route-by-route replacement
- do not keep patient data fetching inside giant page components

The correct move is a phased migration from:

- page-local `fetch + useEffect`

to:

- shared domain hooks with `useQuery` and `useMutation`

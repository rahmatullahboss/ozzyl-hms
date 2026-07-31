# Unified Patient Portal Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split patient experience with one functional portal that surfaces profile completion, self-reported data, vault, hospital-specific services, visit pass, emergency pack, family graph, and privacy/access history from the main patient dashboard.

**Architecture:** Keep the current global patient auth flow and backend routes. Retire the old tenant patient page as a UI entry point, not as an API, by redirecting it into the main patient dashboard. Extend the dashboard with dedicated tabs and reusable portal data helpers that pull from both global cross-hospital endpoints and tenant-scoped patient portal endpoints for a selected hospital.

**Tech Stack:** React 19, TypeScript, Vite, existing Hono backend routes, Vitest, existing patient/global portal APIs.

---

### Task 1: Add portal hub contracts and regression tests

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts`

- [ ] **Step 1: Add failing tests for new hub behavior**

Extend the test file to assert:
- tenant portal retirement path helper returns `/patient/dashboard`
- hospital service snapshot normalization preserves appointments, lab results, documents, messages, reviews
- dashboard hub action keys include family/emergency/global records when data exists

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: FAIL for missing helper exports and missing normalization behavior.

- [ ] **Step 3: Implement minimal helper contracts**

Add:
- route helper for redirecting legacy patient portal UI into `/patient/dashboard`
- hospital service snapshot types and normalizer
- portal section metadata for overview / hospital / records / family / privacy

- [ ] **Step 4: Re-run tests to verify pass**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts /Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts
git commit -m "test: add patient portal hub contracts"
```

### Task 2: Build hospital services tab from existing tenant APIs

**Files:**
- Create: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/components/patient/PatientHospitalServicesTab.tsx`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts`

- [ ] **Step 1: Write the failing tests**

Add assertions that hospital snapshot normalization supports:
- selected hospital identity
- appointments
- prescriptions
- lab results
- documents
- diagnoses
- message conversations
- review history

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: FAIL because hospital snapshot helper is incomplete.

- [ ] **Step 3: Implement the tab**

Create a component that:
- loads linked hospitals from `/api/global-portal/hospitals`
- keeps selected hospital in `sessionStorage`
- calls tenant portal endpoints using `credentials: 'include'` and `X-Tenant-ID`
- shows:
  - book appointment CTA and doctor list entry point
  - upcoming appointments
  - recent prescriptions
  - recent labs
  - uploaded hospital documents
  - diagnosis list
  - secure messaging summary
  - submitted reviews
- degrades gracefully when the patient has no record in the selected hospital

- [ ] **Step 4: Re-run tests**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/components/patient/PatientHospitalServicesTab.tsx /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts /Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts
git commit -m "feat: add patient hospital services hub"
```

### Task 3: Make the main dashboard the unified patient portal

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/pages/PatientDashboardPage.tsx`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/pages/GlobalHealthPortal.tsx`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts`

- [ ] **Step 1: Write failing tests**

Add assertions that:
- dashboard tab metadata exposes hospital services and global records sections
- quick actions include create emergency pack and manage family when relevant

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: FAIL because new sections are not exposed.

- [ ] **Step 3: Implement dashboard unification**

Update the dashboard to:
- add tabs for `hospital-services` and `global-records`
- embed the new hospital services tab
- add global health cards for linked hospitals, records timeline, visit pass, emergency pack, and family graph
- route deep links into `GlobalHealthPortal` with query-string tab selection
- make empty states instructional instead of silent

Update `GlobalHealthPortal` to read an initial `tab` query param so dashboard deep links land on the exact feature.

- [ ] **Step 4: Re-run tests**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/pages/PatientDashboardPage.tsx /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/pages/GlobalHealthPortal.tsx /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts /Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts
git commit -m "feat: unify patient dashboard hub"
```

### Task 4: Retire the old tenant patient page as a UI entry point

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/pages/PatientPortal.tsx`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/App.tsx`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts`

- [ ] **Step 1: Write the failing test**

Add an assertion for the legacy portal redirect helper and copy contract.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: FAIL if helper or copy contract missing.

- [ ] **Step 3: Implement redirect retirement**

Change the old `PatientPortal` page into a lightweight redirect/notice component that sends users to `/patient/dashboard` and preserves the last tenant slug for hospital services selection.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run test/patient-portal-ux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/pages/PatientPortal.tsx /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/App.tsx /Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts /Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts
git commit -m "feat: retire legacy patient portal ui"
```

### Task 5: Verification and docs sync

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/ozzyl_hms_assessment.md`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/ozzyl-health-ecosystem-vision.md`

- [ ] **Step 1: Update docs**

Mark:
- patient portal unification as complete
- wearables deferred to future phase
- legacy tenant patient UI retired

- [ ] **Step 2: Run focused verification**

Run:
- `pnpm vitest run test/patient-portal-ux.test.ts test/patient-guidance.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm --filter web build`

Expected: all pass

- [ ] **Step 3: Final commit**

```bash
git add /Users/rahmatullahzisan/Desktop/Dev/hms/ozzyl_hms_assessment.md /Users/rahmatullahzisan/Desktop/Dev/hms/ozzyl-health-ecosystem-vision.md
git commit -m "docs: sync unified patient portal status"
```

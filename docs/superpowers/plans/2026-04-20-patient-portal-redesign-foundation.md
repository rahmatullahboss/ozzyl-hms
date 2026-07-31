# Patient Portal Redesign Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a shared patient portal shell/navigation foundation without changing backend contracts.

**Architecture:** Keep the current patient dashboard data flow and tab components intact, but extract navigation metadata into one source of truth and move shell styling toward reusable patient-app classes. This makes later redesign slices safer and reduces cross-portal UI drift.

**Tech Stack:** React 19, React Router, Tailwind v4, Vitest, Cloudflare Workers deployment.

---

### Task 1: Add Shared Patient Portal Navigation Model

**Files:**
- Create: `apps/ozzyl-lifestyle/src/lib/patientPortalNav.ts`
- Test: `test/unit/patient-portal-nav.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  PATIENT_PORTAL_PRIMARY_NAV,
  PATIENT_PORTAL_SECONDARY_NAV,
  PATIENT_PORTAL_BOTTOM_NAV,
} from '../../apps/ozzyl-lifestyle/src/lib/patientPortalNav';

describe('patient portal navigation model', () => {
  it('keeps overview and care sections in stable grouped navigation lists', () => {
    expect(PATIENT_PORTAL_PRIMARY_NAV.map((item) => item.id)).toEqual([
      'overview',
      'trends',
      'tips',
      'diary-history',
      'medicine-tracker',
      'family',
      'wellness',
    ]);
    expect(PATIENT_PORTAL_SECONDARY_NAV.map((item) => item.id)).toEqual([
      'find-care',
      'hospital-services',
      'data',
      'privacy',
      'vault',
      'global-records',
    ]);
    expect(PATIENT_PORTAL_BOTTOM_NAV.map((item) => item.id)).toEqual([
      'home',
      'wellness',
      'care',
      'me',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/patient-portal-nav.test.ts`
Expected: FAIL because `patientPortalNav.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `apps/ozzyl-lifestyle/src/lib/patientPortalNav.ts` with grouped navigation arrays and exported tab ids.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/patient-portal-nav.test.ts`
Expected: PASS

### Task 2: Switch Dashboard And Bottom Nav To Shared Metadata

**Files:**
- Modify: `apps/ozzyl-lifestyle/src/pages/PatientDashboardPage.tsx`
- Modify: `apps/ozzyl-lifestyle/src/components/patient/MobileBottomNav.tsx`
- Test: `test/unit/patient-portal-nav.test.ts`

- [ ] **Step 1: Write the failing test**

Extend the same test file with assertions that the bottom nav labels remain four grouped items and that the dashboard config exposes both primary and secondary nav groups.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/unit/patient-portal-nav.test.ts`
Expected: FAIL until both components import the shared metadata.

- [ ] **Step 3: Write minimal implementation**

Replace duplicated nav label/icon maps in the dashboard and mobile nav with imports from `patientPortalNav.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/unit/patient-portal-nav.test.ts`
Expected: PASS

### Task 3: Add Reusable Patient Shell Styles

**Files:**
- Modify: `apps/ozzyl-lifestyle/src/index.css`
- Modify: `apps/ozzyl-lifestyle/src/pages/PatientDashboardPage.tsx`
- Test: `test/unit/patient-portal-nav.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions for class-driven shell structure only if exposed through pure config/helpers; otherwise use existing regression tests and build verification as the gate.

- [ ] **Step 2: Run verification baseline**

Run: `pnpm vitest run test/unit/patient-portal-nav.test.ts test/unit/pwa-launch.test.ts`
Expected: PASS on current logic before style edits.

- [ ] **Step 3: Write minimal implementation**

Add reusable shell classes for:
- app background
- sidebar surface
- content frame
- mobile drawer surface
- top app bar

Apply those classes in `PatientDashboardPage.tsx` without changing tab content contracts.

- [ ] **Step 4: Run focused verification**

Run: `pnpm vitest run test/unit/patient-portal-nav.test.ts test/unit/pwa-launch.test.ts`
Expected: PASS

### Task 4: Build And Production Verification

**Files:**
- Modify: none required unless build issues appear

- [ ] **Step 1: Run targeted patient portal regression tests**

Run: `pnpm vitest run test/unit/patient-portal-nav.test.ts test/unit/pwa-launch.test.ts test/unit/patient-asset-routing.test.ts test/unit/patient-portal-handoff.test.ts`
Expected: PASS

- [ ] **Step 2: Run full frontend build**

Run: `pnpm build`
Expected: both `web` and `ozzyl-lifestyle` build successfully

- [ ] **Step 3: Deploy to production**

Run: `pnpm wrangler deploy --env production`
Expected: successful deploy with a new worker version id

- [ ] **Step 4: Verify live boundaries**

Run:
`curl -s https://hms-saas-production.rahmatullahzisan.workers.dev/patient/login | rg "Ozzyl Lifestyle|/patient/assets"`

`curl -s https://hms-saas-production.rahmatullahzisan.workers.dev/h/demo-hospital/login | rg "Ozzyl HMS|/assets/index"`

Expected: patient shell on patient path, hospital shell on hospital path

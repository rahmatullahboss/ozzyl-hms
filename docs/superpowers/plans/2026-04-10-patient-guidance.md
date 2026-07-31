# Patient Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, patient-safe guidance card to the patient dashboard using existing global portal and patient-reported data.

**Architecture:** Compose a plain-language guidance object on the backend from profile completion state, review-state counts, dashboard activity, and visit-pass readiness. Return it in the existing global dashboard payload and render it as a trust-aware dashboard card in the patient portal.

**Tech Stack:** Hono, D1, TypeScript, React, Vitest, Vite

---

### Task 1: Guidance Composer Tests

**Files:**
- Create: `test/patient-guidance.test.ts`
- Create: `src/lib/patient-guidance.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, expect, it } from 'vitest';
import { composePatientGuidance } from '../src/lib/patient-guidance';

describe('composePatientGuidance', () => {
  it('prioritizes incomplete identity and pending review items', () => {
    const result = composePatientGuidance({
      hasPhone: false,
      hasNationalId: false,
      upcomingAppointments: 1,
      recentPrescriptions: 1,
      pendingReviewItems: 3,
      verifiedItems: 2,
      vaultDocuments: 0,
      hasActiveVisitPass: false,
      recentLifestyleLog: true,
      recentAdr: true,
    });

    expect(result.status).toBe('attention');
    expect(result.next_steps.some((item) => item.toLowerCase().includes('phone'))).toBe(true);
    expect(result.trust_notes.some((item) => item.toLowerCase().includes('pending review'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/patient-guidance.test.ts`
Expected: FAIL because `src/lib/patient-guidance.ts` or `composePatientGuidance` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function composePatientGuidance(input: {
  hasPhone: boolean;
  hasNationalId: boolean;
  upcomingAppointments: number;
  recentPrescriptions: number;
  pendingReviewItems: number;
  verifiedItems: number;
  vaultDocuments: number;
  hasActiveVisitPass: boolean;
  recentLifestyleLog: boolean;
  recentAdr: boolean;
}) {
  return {
    headline: '',
    status: 'stable' as const,
    summary: '',
    what_changed: [],
    next_steps: [],
    trust_notes: [],
    care_reminders: [],
    counts: {
      pending_review_items: input.pendingReviewItems,
      verified_items: input.verifiedItems,
      vault_documents: input.vaultDocuments,
      active_visit_pass: input.hasActiveVisitPass ? 1 : 0,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes after completing real logic**

Run: `pnpm vitest run test/patient-guidance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/patient-guidance.test.ts src/lib/patient-guidance.ts
git commit -m "feat: add deterministic patient guidance composer"
```

### Task 2: Dashboard Route Contract

**Files:**
- Modify: `src/routes/global-portal.ts`
- Test: `test/global-visit-pass.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
it('includes patient guidance in dashboard payload', async () => {
  // assert body.patient_guidance exists and returns a trust-aware summary
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/global-visit-pass.test.ts`
Expected: FAIL because `patient_guidance` is missing from `/api/global-portal/dashboard`.

- [ ] **Step 3: Implement minimal route aggregation**

```ts
const patientGuidance = composePatientGuidance({
  hasPhone: Boolean(globalUser.phone),
  hasNationalId: Boolean(globalUser.nationalId),
  upcomingAppointments: appointments?.length ?? 0,
  recentPrescriptions: prescriptions?.length ?? 0,
  pendingReviewItems,
  verifiedItems,
  vaultDocuments,
  hasActiveVisitPass,
  recentLifestyleLog,
  recentAdr,
});
```

- [ ] **Step 4: Run route tests**

Run: `pnpm vitest run test/global-visit-pass.test.ts test/patient-guidance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/global-portal.ts test/global-visit-pass.test.ts test/patient-guidance.test.ts
git commit -m "feat: expose patient guidance in dashboard api"
```

### Task 3: Patient Dashboard UI

**Files:**
- Modify: `web/src/pages/PatientDashboardPage.tsx`

- [ ] **Step 1: Add the failing contract usage mentally against current types**

```ts
interface DashboardResponse {
  patient_guidance?: PatientGuidance;
}
```

- [ ] **Step 2: Implement the guidance card**

```tsx
{dashboard.patient_guidance && (
  <section>
    <h2>আজকের গাইডেন্স</h2>
    <p>{dashboard.patient_guidance.headline}</p>
  </section>
)}
```

- [ ] **Step 3: Flesh out the real rendering**

```tsx
// render status pill, summary, next steps, trust notes, reminders, and counts
```

- [ ] **Step 4: Verify frontend compilation**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

Run: `pnpm --filter web build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/PatientDashboardPage.tsx
git commit -m "feat: surface patient guidance in dashboard"
```

### Task 4: Docs Sync

**Files:**
- Modify: `ozzyl_hms_assessment.md`
- Modify: `ozzyl-health-ecosystem-vision.md`

- [ ] **Step 1: Update assessment status**

```md
- patient-facing AI/action surface → strong partial
```

- [ ] **Step 2: Update vision wording**

```md
- patient portal now provides a plain-language action summary instead of raw data only
```

- [ ] **Step 3: Final verification**

Run: `pnpm vitest run test/patient-guidance.test.ts test/global-visit-pass.test.ts`
Expected: PASS

Run: `pnpm exec tsc --noEmit`
Expected: PASS

Run: `pnpm --filter web build`
Expected: PASS

- [ ] **Step 4: Final commit**

```bash
git add ozzyl_hms_assessment.md ozzyl-health-ecosystem-vision.md docs/superpowers/specs/2026-04-10-patient-guidance-design.md docs/superpowers/plans/2026-04-10-patient-guidance.md
git commit -m "docs: sync patient guidance progress"
```

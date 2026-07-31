# AI Physician Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a doctor-facing hybrid chart summary that deterministically ranks clinically relevant signals and optionally uses AI to compress them into a citation-backed snapshot.

**Architecture:** Add a dedicated summary composer that transforms chart aggregates into a structured doctor-summary contract first. Then integrate an AI compression step that can only rewrite whitelisted structured content and falls back to deterministic output when unavailable or invalid.

**Tech Stack:** Hono, TypeScript, Vitest, Cloudflare-style route handlers, OpenRouter JSON calls

---

### Task 1: Add failing tests for deterministic summary composition

**Files:**
- Create: `test/chart-ai-summary.test.ts`
- Modify: `src/lib/chart-ai-summary.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { composeDeterministicChartSummary } from '../src/lib/chart-ai-summary';

describe('composeDeterministicChartSummary', () => {
  it('prioritizes unstable clinical issues and patient-reported context with provenance', () => {
    const result = composeDeterministicChartSummary({
      allergies: [{ allergen: 'Penicillin', severity: 'severe', review_status: 'verified', verified_at: '2026-04-01' }],
      activeProblems: [{ description: 'Type 2 diabetes mellitus', severity: 'moderate', status: 'active' }],
      medications: [{ medication_name: 'Metformin', status: 'active', source: 'prescribed', review_status: 'verified' }],
      adverseReactions: [{ id: 5, medication_name: 'Ibuprofen', reaction: 'Severe acidity', severity: 'severe', review_status: 'pending_review' }],
      lifestyleLogs: [{ id: 7, logged_on: '2026-04-10', sleep_hours: 4, symptom_score: 8, symptoms: 'Headache and fatigue', mood: 'low', review_status: 'pending_review' }],
      abnormalLabs: [{ id: 11, test_name: 'CRP', abnormal_flag: 'critical', result: '18.5' }],
      latestVitals: { systolic: 170, diastolic: 102, blood_sugar: 280, temperature: 101.2 },
      activeConsultation: { id: 3, status: 'in_progress', chief_complaint: 'Fever with uncontrolled diabetes' },
      hasScheduledFollowUp: false,
      hasUnverifiedAllergy: false,
    });

    expect(result.oneLiner).toContain('uncontrolled');
    expect(result.activeIssues[0]?.priority).toBe('critical');
    expect(result.patientContext.some((item) => item.provenance === 'patient_reported')).toBe(true);
    expect(result.cautions.some((item) => item.text.includes('patient-reported'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/chart-ai-summary.test.ts`  
Expected: FAIL because `src/lib/chart-ai-summary.ts` does not yet exist or required exports are missing

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/chart-ai-summary.ts` with typed summary item shapes and a first-pass `composeDeterministicChartSummary()` implementation that:

- ranks critical vitals/labs/allergies first
- emits patient context from poor sleep and severe ADRs
- returns `oneLiner`, `activeIssues`, `patientContext`, `cautions`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/chart-ai-summary.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/chart-ai-summary.test.ts src/lib/chart-ai-summary.ts
git commit -m "feat: add deterministic physician summary composer"
```

### Task 2: Add failing tests for AI sanitization and route fallback

**Files:**
- Modify: `test/integration/routes/patient-chart-workspace.test.ts`
- Modify: `src/routes/tenant/patients.ts`
- Modify: `src/lib/chart-ai-summary.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that assert:

- `GET /patients/1/chart?includeAiSummary=1` returns `status: 'fallback'` when no API key is configured, but still includes structured summary sections
- when AI is configured and returns an item with unknown citation IDs, the route drops invalid citations and keeps only whitelisted IDs
- patient-reported lifestyle/ADR insights appear inside `patientContext`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/routes/patient-chart-workspace.test.ts`  
Expected: FAIL because `aiSummary` contract and sanitization behavior are not implemented

- [ ] **Step 3: Write minimal implementation**

Update route integration so it:

- composes deterministic summary first
- returns fallback summary when AI is unavailable
- validates AI citation IDs against timeline sources
- preserves deterministic sections when AI output is incomplete

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/integration/routes/patient-chart-workspace.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/integration/routes/patient-chart-workspace.test.ts src/routes/tenant/patients.ts src/lib/chart-ai-summary.ts
git commit -m "feat: add hybrid physician summary route integration"
```

### Task 3: Strengthen summary coverage for medication/follow-up risk

**Files:**
- Modify: `test/chart-ai-summary.test.ts`
- Modify: `src/lib/chart-ai-summary.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that assert:

- on-hold medication and recently stopped chronic medication surface in `medicationFocus`
- unstable chronic patient without follow-up surfaces in `followUpRisks`
- summary emits `provenanceFlags` when patient-reported items remain unreviewed

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/chart-ai-summary.test.ts`  
Expected: FAIL on missing sections or wrong prioritization

- [ ] **Step 3: Write minimal implementation**

Extend the composer with:

- `medicationFocus`
- `followUpRisks`
- `provenanceFlags`
- stable priority ordering and capped list lengths

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/chart-ai-summary.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/chart-ai-summary.test.ts src/lib/chart-ai-summary.ts
git commit -m "feat: deepen physician summary risk ranking"
```

### Task 4: Verify and sync docs

**Files:**
- Modify: `ozzyl_hms_assessment.md`

- [ ] **Step 1: Run focused regression**

Run: `pnpm vitest run test/chart-ai-summary.test.ts test/integration/routes/patient-chart-workspace.test.ts test/patient-reported-review.test.ts test/patient-phr-reported-experience.test.ts`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Update assessment**

Mark AI physician summary as partial/stronger partial and note hybrid Layer A + Layer B summary composition.

- [ ] **Step 4: Commit**

```bash
git add ozzyl_hms_assessment.md
git commit -m "docs: update assessment for physician summary"
```

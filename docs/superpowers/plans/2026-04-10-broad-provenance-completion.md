# Broad Provenance Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete provenance coverage for the remaining high-value doctor chart sections so trust is explicit across chart cards, timeline rows, print output, and source drill-downs.

**Architecture:** Extend the existing chart route instead of creating a second provenance service. Normalize remaining data types into a lightweight shared provenance object, reuse that object in chart payloads and source detail responses, then render the same contract in doctor workspace and print surfaces.

**Tech Stack:** Hono, TypeScript, Drizzle/D1, Vitest, React, existing doctor workspace UI

---

### Task 1: Lock Route-Test Expectations

**Files:**
- Modify: `test/integration/routes/patient-chart-workspace.test.ts`
- Test: `test/integration/routes/patient-chart-workspace.test.ts`

- [ ] **Step 1: Write failing tests for new chart provenance coverage**

Add assertions for:
- lab result provenance
- discharge provenance
- document provenance
- referral provenance
- timeline provenance

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/integration/routes/patient-chart-workspace.test.ts`
Expected: FAIL on missing provenance fields and unsupported source ids.

- [ ] **Step 3: Commit the failing-test milestone if desired**

```bash
git add test/integration/routes/patient-chart-workspace.test.ts
git commit -m "test: define broader chart provenance expectations"
```

### Task 2: Add Backend Provenance Normalization

**Files:**
- Modify: `src/routes/tenant/patients.ts`
- Test: `test/integration/routes/patient-chart-workspace.test.ts`

- [ ] **Step 1: Implement shared provenance helpers in the chart route**

Add small helper functions for:
- clinician-entered vs verified
- imported-record defaults
- family-history category reuse
- badge text generation

- [ ] **Step 2: Attach provenance to chart collections**

Decorate:
- labs
- radiology orders
- radiology reports
- discharge summaries
- documents
- referrals
- timeline events

- [ ] **Step 3: Run route test to verify it now reaches green for payload coverage**

Run: `pnpm vitest run test/integration/routes/patient-chart-workspace.test.ts`
Expected: payload provenance assertions pass; source-detail failures may still remain until next task.

### Task 3: Add Source Drill-Down for Remaining Records

**Files:**
- Modify: `src/routes/tenant/patients.ts`
- Test: `test/integration/routes/patient-chart-workspace.test.ts`

- [ ] **Step 1: Add source handlers for `lab-*`, `discharge-*`, `document-*`, `referral-*`**

Each should:
- validate tenant/patient ownership
- return title/date/status/summary
- include provenance sections
- avoid overstating verification when metadata is incomplete

- [ ] **Step 2: Run test to verify source detail behavior passes**

Run: `pnpm vitest run test/integration/routes/patient-chart-workspace.test.ts`
Expected: PASS for newly added source ids.

### Task 4: Surface Trust in Doctor UI

**Files:**
- Modify: `web/src/pages/PatientChartWorkspace.tsx`
- Modify: `web/src/pages/PatientChartPrint.tsx`
- Test: `pnpm --filter web build`

- [ ] **Step 1: Render provenance pills consistently in doctor chart cards and timeline**

Add badges to:
- abnormal labs
- diagnoses if applicable
- discharge summaries
- radiology reports
- documents/referrals if rendered
- timeline rows

- [ ] **Step 2: Mirror the most important trust badges in print view**

Keep print compact; render only the sections that materially affect interpretation.

- [ ] **Step 3: Run web build to verify contract consistency**

Run: `pnpm --filter web build`
Expected: PASS

### Task 5: Sync Docs and Reassess Percentages

**Files:**
- Modify: `ozzyl_hms_assessment.md`
- Modify: `ozzyl-health-ecosystem-vision.md`

- [ ] **Step 1: Update assessment status**

Adjust:
- dual-layered data architecture status
- family-history analytics wording
- wearable sync as future/Phase 3 only
- next remaining gaps after provenance completion

- [ ] **Step 2: Update vision doc**

Clarify:
- what is already live
- what remains for 90%+ parity
- wearables explicitly deferred

### Task 6: Verify and Commit

**Files:**
- Modify: only the provenance/docs slice touched above

- [ ] **Step 1: Run the targeted backend tests**

Run: `pnpm vitest run test/integration/routes/patient-chart-workspace.test.ts test/chart-ai-summary.test.ts test/family-risk.test.ts`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run frontend build**

Run: `pnpm --filter web build`
Expected: PASS

- [ ] **Step 4: Commit only the provenance/docs slice**

```bash
git add src/routes/tenant/patients.ts web/src/pages/PatientChartWorkspace.tsx web/src/pages/PatientChartPrint.tsx test/integration/routes/patient-chart-workspace.test.ts ozzyl_hms_assessment.md ozzyl-health-ecosystem-vision.md docs/superpowers/specs/2026-04-10-broad-provenance-completion-design.md docs/superpowers/plans/2026-04-10-broad-provenance-completion.md
git commit -m "feat: complete chart provenance coverage"
```

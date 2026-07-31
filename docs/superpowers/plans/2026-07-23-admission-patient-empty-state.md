# Admission Patient Empty-State Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight the no-match state in the IPD admission patient search and make the new-patient registration action obvious.

**Architecture:** Preserve the existing admission search and registration handler. Change only the empty-state presentation and reception translations, then protect it with a focused regression assertion.

**Tech Stack:** React, TypeScript, Tailwind CSS, i18next, Vitest.

## Global Constraints

- Work in the isolated branch created from local `main`.
- Preserve the existing click handler, return modal, and name/mobile prefilling.
- Keep the whole empty-state card keyboard accessible as one button.
- Do not change APIs, database schema, canonical authority, or migrations.

---

### Task 1: Highlight the admission no-patient action

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.test.tsx`
- Modify: `web/src/pages/ReceptionDashboard.tsx`
- Modify: `web/public/locales/en/reception.json`
- Modify: `web/public/locales/bn/reception.json`

**Interfaces:**
- Consumes: the existing admission search empty-state click handler and reception translation namespace.
- Produces: an amber highlighted registration card with a clear headline, instruction, and action label.

- [ ] **Step 1: Write the failing regression test**

Assert the source contains the amber highlighted card classes, `UserPlus` icon, and translation keys for the headline, guidance, and action.

- [ ] **Step 2: Run the Reception Dashboard test and verify RED**

Run: `pnpm --filter web exec vitest run src/pages/ReceptionDashboard.test.tsx`

Expected: failure because the highlighted markup and new guidance key do not exist.

- [ ] **Step 3: Implement the highlighted card**

Replace the plain button content with an icon, bold headline, guidance text, and prominent action label while preserving the existing button handler.

- [ ] **Step 4: Add English and Bangla guidance copy**

Add `info.registerPatientToContinueAdmission` to both reception locale files and use existing `btn.noSavedPatientRegister` and `btn.registerNewPatient` labels.

- [ ] **Step 5: Run focused and combined verification**

Run:

```bash
pnpm --filter web exec vitest run src/pages/ReceptionDashboard.test.tsx
pnpm --filter web exec vitest run src/pages/ReceptionDashboard.test.tsx src/components/dashboard/DoctorPerformancePanel.test.tsx src/components/dashboard/ExecutiveControlKpis.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx
pnpm exec tsc --noEmit
```

Expected: all tests and TypeScript validation pass.

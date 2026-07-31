# Patient Reported Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct section-level patient input flows for long-term conditions, current health issues, allergies, and medications in the patient portal.

**Architecture:** Extend the existing patient-reported data enum and reuse the current `/api/patient-phr/reported-data` route. On the frontend, keep the modal flow but add card-level inline forms so patients can add structured data where they are already looking.

**Tech Stack:** Hono, Zod, React, Vitest, i18next

---

### Task 1: Extend backend category support

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/patient-phr.ts`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-phr-reported-experience.test.ts`

- [ ] Add a failing route test for `current_health_issue`
- [ ] Update the Zod schema enum and create flow
- [ ] Run the route test and make it pass

### Task 2: Add inline section input UX

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/components/patient/PatientReportedDataTab.tsx`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts`

- [ ] Add a failing UI/helper assertion for the new section label contract
- [ ] Refactor the card list to include four section cards
- [ ] Add inline expand/collapse forms per card
- [ ] Reuse submit logic for inline and modal paths
- [ ] Run the affected tests

### Task 3: Update copy and placeholders

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/public/locales/en/patients.json`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/public/locales/bn/patients.json`

- [ ] Add locale labels for `current health issue`
- [ ] Add quick-add labels and descriptions
- [ ] Keep EN/BN structures aligned

### Task 4: Verify portal regression safety

**Files:**
- Modify if needed: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/e2e/patient-dashboard.spec.ts`

- [ ] Update mocks only if the new UI contract needs it
- [ ] Run targeted Vitest coverage
- [ ] Run the web build
- [ ] Review git diff for unrelated changes before commit

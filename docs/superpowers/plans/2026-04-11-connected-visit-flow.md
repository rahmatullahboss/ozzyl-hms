# Connected Visit Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a patient-facing live visit flow that connects hospital booking and queue operations to a simple portal experience with token, queue status, ETA, and arrival guidance.

**Architecture:** Add a small backend adapter in tenant patient portal routes that derives live visit state from appointments plus queue entries. Keep queue as the operational source of truth, expose a sanitized patient payload, and render it in the hospital services tab and dashboard overview with polling-friendly UI.

**Tech Stack:** Hono, TypeScript, D1, React, Vitest

---

### Task 1: Add visit-status derivation helper

**Files:**
- Create: `/Users/rahmatullahzisan/Desktop/Dev/hms/src/lib/patient-live-visit.ts`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-live-visit.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement derived status, patients-ahead, and arrival guidance helpers**
- [ ] **Step 4: Run test to verify pass**

### Task 2: Add patient portal live visit endpoint

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/src/routes/tenant/patientPortal.ts`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/integration/routes/patient-live-visit-status.test.ts`

- [ ] **Step 1: Write failing integration test for `GET /live-visit-status`**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement endpoint by combining appointment + queue data**
- [ ] **Step 4: Run test to verify pass**

### Task 3: Surface live visit in hospital services UI

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/components/patient/PatientHospitalServicesTab.tsx`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/public/locales/en/patients.json`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/public/locales/bn/patients.json`

- [ ] **Step 1: Add live visit fetch and state**
- [ ] **Step 2: Render queue status, token, current serving, patients ahead, ETA, and arrival guidance**
- [ ] **Step 3: Keep messaging secondary**
- [ ] **Step 4: Run focused import and JSON checks**

### Task 4: Surface live visit summary on dashboard

**Files:**
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/pages/PatientDashboardPage.tsx`
- Modify: `/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/lib/patientPortalUx.ts`
- Test: `/Users/rahmatullahzisan/Desktop/Dev/hms/test/patient-portal-ux.test.ts`

- [ ] **Step 1: Add quick helper contract or state for live visit summary**
- [ ] **Step 2: Render a compact overview card on dashboard**
- [ ] **Step 3: Re-run helper tests**

### Task 5: Verification

**Files:**
- Test only

- [ ] **Step 1: Run `pnpm vitest run test/patient-live-visit.test.ts test/integration/routes/patient-live-visit-status.test.ts test/patient-portal-ux.test.ts`**
- [ ] **Step 2: Run JSON validation for updated locales**
- [ ] **Step 3: Run import checks for updated patient UI components**

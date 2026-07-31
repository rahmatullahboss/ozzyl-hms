# Doctor Waiver Enterprise Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make doctor-waiver calculation preload before source selection, remain authoritative at invoice submission, preserve performer reserves and protected commission floors, and prevent source-intent drift from creating misclassified discounts.

**Architecture:** Use the same reserve-aware commission quote calculation for both the preview endpoint and invoice submission. The client preloads a zero-discount capacity quote whenever doctor and bill lines are available, stores the full quote, and sends an explicit source intent. The invoice endpoint recalculates from server-resolved items, validates intent/allocation consistency, and constructs the final doctor/hospital split using maximum waiver capacity rather than total earned commission.

**Tech Stack:** TypeScript, Hono, Zod, React, TanStack Query mutation hooks, Vitest, Cloudflare D1.

## Global Constraints

- Start from exact `origin/main` SHA `f9e4cec24fd1e26355a760af2b5b0de621cf7fcf` in the dedicated task worktree.
- Do not perform another production backfill or production deployment.
- Preserve protected commission and diagnostic performer reserve in every preview and submission path.
- Fail closed when doctor-waiver intent cannot be authoritatively verified.
- Implement with red-green TDD and run focused frontend, route, analytics, typecheck, and build verification.

---

### Task 1: Shared authoritative doctor-waiver quote

**Files:**
- Create: `src/lib/doctor-waiver-quote.ts`
- Modify: `src/routes/tenant/discounts.ts`
- Test: `test/doctor-waiver-quote.test.ts`

**Interfaces:**
- Produces: `quoteDoctorWaiver(db, input)` returning earned commission, performer reserve, protected commission, maximum waiver, requested waiver, payable commission, hospital-funded amount, and line rule snapshots.

- [ ] Write a failing test proving reserve hydration and protected-floor calculation are included.
- [ ] Run the test and confirm failure.
- [ ] Implement the shared quote helper and route delegation.
- [ ] Run the test and confirm pass.

### Task 2: Authoritative invoice submission guard

**Files:**
- Modify: `src/schemas/billingCounter.ts`
- Modify: `src/routes/tenant/billingCounter.legacy.ts`
- Test: `test/integration/routes/billing-counter-legacy.test.ts`

**Interfaces:**
- Consumes: `quoteDoctorWaiver`.
- Produces: `discountSourceIntent` validation and server-generated doctor/hospital split.

- [ ] Add failing route tests for performer reserve, protected floor, and source-intent mismatch.
- [ ] Run focused route tests and confirm failure.
- [ ] Add `discountSourceIntent` to the request schema.
- [ ] Recalculate the quote from server-resolved items and cap with `maximumDoctorWaiverAmount`.
- [ ] Reject doctor-waiver intent without a matching doctor-waiver allocation and reject mismatched doctor identity.
- [ ] Run focused route tests and confirm pass.

### Task 3: Modal and billing page preload

**Files:**
- Modify: `web/src/components/reception/DiscountAllocationEditor.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Test: `web/src/components/reception/DiscountAllocationEditor.test.tsx`
- Test: `web/src/components/reception/ReceptionPatientDrawer.test.tsx`
- Test: `web/src/pages/BillingCounterPage.test.ts`

**Interfaces:**
- Consumes: full doctor-waiver quote response.
- Produces: preload state, rule summary UI, explicit source intent, and fail-closed payment controls.

- [ ] Add failing tests proving preview is independent of Doctor Waiver selection and source intent is submitted.
- [ ] Run focused frontend tests and confirm failure.
- [ ] Build zero-discount preload requests whenever doctor and lines are available.
- [ ] Store/display earned, reserve, protected, maximum waiver, and payable values.
- [ ] Disable or block Doctor Waiver/payment while the relevant quote is stale or failed.
- [ ] Send explicit `discountSourceIntent` with invoice payloads.
- [ ] Run focused frontend tests and confirm pass.

### Task 4: Doctor performance aggregation regression

**Files:**
- Test: `test/integration/executive-dashboard-analytics-sqlite.test.ts`
- Modify only if the regression fails: `src/lib/executive-doctor-analytics.ts`

**Interfaces:**
- Produces: date-range totals that sum every eligible paid invoice for a doctor instead of only the latest invoice.

- [ ] Add a regression fixture with multiple same-day diagnostic invoices for one doctor.
- [ ] Assert test commission and waiver totals aggregate all eligible invoices.
- [ ] Fix analytics SQL only if the test exposes a defect.
- [ ] Run the focused analytics suite.

### Task 5: Verification and integration

**Files:**
- Review all task-owned changes only.

- [ ] Run focused backend route and quote tests.
- [ ] Run focused frontend tests.
- [ ] Run analytics regression tests.
- [ ] Run TypeScript checks and production web build.
- [ ] Commit exact task files.
- [ ] Reconcile with latest `origin/main`, integrate through the clean local `main` worktree, rerun verification, push `origin/main`, and clean the task branch/worktree.

# Reception Doctor Payout Date Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inclusive From-To filter to Reception Doctor Payout, defaulted to today's Dhaka date.

**Architecture:** The payables API validates optional calendar dates and filters `doctor_commission_accruals.accrued_date`. `CashOperationsPage` owns the range and range-scoped query; `DoctorPayoutWorkspace` renders controls and clears selection when the range changes.

**Tech Stack:** Hono, D1/SQLite, React, TanStack Query wrapper, Vitest, Testing Library.

---

### Task 1: Filter Doctor Payables API

**Files:**
- Modify: `src/routes/tenant/receptionDoctorPayouts.ts`
- Test: `test/integration/routes/reception-doctor-payouts.test.ts`

- [x] Add a failing route test requesting `?from=2026-06-18&to=2026-06-19` and assert the payables SQL contains `date(a.accrued_date) >= date(?)` and `date(a.accrued_date) <= date(?)` with both values bound.
- [x] Add a failing route test requesting a reversed range and expect HTTP 400.
- [x] Run `pnpm exec vitest run test/integration/routes/reception-doctor-payouts.test.ts` and confirm both tests fail for missing range handling.
- [x] Validate `YYYY-MM-DD`, reject `from > to`, and append inclusive tenant-scoped predicates and parameters.
- [x] Rerun the focused route test and expect all tests to pass.
- [x] Commit `src/routes/tenant/receptionDoctorPayouts.ts` and its test with `fix: filter doctor payables by date`.

### Task 2: Add Today's Date Range To Reception UI

**Files:**
- Modify: `web/src/pages/reception/CashOperationsPage.tsx`
- Modify: `web/src/components/reception/cash-operations/DoctorPayoutWorkspace.tsx`
- Test: `web/src/pages/reception/CashOperationsPage.test.tsx`

- [x] Freeze system time in the page test and assert From and To both default to `2026-06-22` and the payables query URL is `/api/payment-methods/doctor-payouts/payables?from=2026-06-22&to=2026-06-22`.
- [x] Select an item, change From, and assert the selected count returns to zero.
- [x] Run `pnpm exec vitest run src/pages/reception/CashOperationsPage.test.tsx` from `web/` and confirm failures for absent controls/range query.
- [x] Add a Dhaka-date helper, range state, URL/query-key parameters, range validation, and pass controlled date props to `DoctorPayoutWorkspace`.
- [x] Render two native date inputs in the Doctor Payout header and clear `selectedIds` whenever either controlled date changes.
- [x] Rerun the focused page test and expect all tests to pass.
- [x] Commit page, workspace, and test with `feat: add doctor payout date range`.

### Task 3: Verify And Deliver

**Files:**
- Verify all files above and the design/plan documents.

- [x] Run both focused test commands and `pnpm build`.
- [x] Run `git diff --check`, confirm no conflict markers, and ensure the worktree is clean after commits.
- [x] Push the verified integration tip to `origin/main`.
- [x] Deploy with `pnpm build && wrangler deploy --env production`.
- [x] Smoke-check `/api/health` and the Reception Cash Operations route on `https://hms.ozzyl.com`.

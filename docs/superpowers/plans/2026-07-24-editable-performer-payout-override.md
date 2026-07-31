# Editable Performer Payout Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audited row-level final payout amounts for assigned and unassigned diagnostic performers without overwriting calculated reserve/commission values.

**Architecture:** Extend payout request contracts with per-line overrides, persist original/final evidence on settlement items, and teach canonical compensation settlement to reconcile an explicit final payable before settlement. Both payout UIs edit line amounts locally and require a reason only for changed lines.

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare D1/SQLite, React, TanStack Query, Vitest.

## Global Constraints

- Preserve existing reserve/accrual source amounts; never overwrite the calculated amount.
- Existing payout idempotency, paid-bill, active-row, single-doctor, cash-drawer, period-lock, audit, accounting, and reversal guards remain active.
- Every changed line requires a reason of at least 3 characters.
- Final line payout must be positive and must not exceed the line service/gross amount.
- External hospital payable accounting is outside this change.

---

### Task 1: Request contract and line-resolution helper

**Files:**
- Modify: `src/schemas/commission.ts`
- Create: `src/lib/performer-payout-overrides.ts`
- Test: `test/performer-payout-overrides.test.ts`

**Interfaces:**
- Produces `PerformerPayoutLineOverride` and `resolvePayoutLineAmounts(rows, overrides)` returning normalized original/final/difference/reason values.

- [ ] Write failing tests for unchanged, increased, decreased, duplicate, unknown, missing-reason, non-positive, and above-service-amount cases.
- [ ] Run `npx vitest run test/performer-payout-overrides.test.ts` and confirm feature-missing failures.
- [ ] Implement the helper and Zod `lineOverrides` contract.
- [ ] Re-run the targeted test until green.

### Task 2: Immutable settlement-item evidence and canonical override support

**Files:**
- Create: `migrations/0537_editable_performer_payout_overrides.sql`
- Modify: `tenant-schema.sql`
- Modify: `src/db/schema/finance.ts`
- Modify: `src/lib/canonical/live-compensation-settlement.ts`
- Test: `test/editable-performer-payout-migration.test.ts`
- Test: canonical live settlement test file discovered in the repository

**Interfaces:**
- `LiveCompensationSettlementAccrualInput` gains optional `settlementPayableAmount` and `overrideReason`.
- Settlement items store calculated amount plus final override evidence.

- [ ] Write migration-shape tests and canonical upward/downward override tests.
- [ ] Run targeted tests and confirm failures.
- [ ] Add settlement-item evidence columns using an additive migration only.
- [ ] Update canonical settlement logic so decreases use the existing recovery adjustment, increases record source-mapping evidence, the compensation invariant remains valid, and the final amount settles without rebuilding governed tables.
- [ ] Re-run targeted canonical and migration tests until green.

### Task 3: Reserve and assigned payout routes

**Files:**
- Modify: `src/routes/tenant/receptionDoctorPayouts.ts`
- Test: `test/integration/routes/reception-doctor-payouts.test.ts`

**Interfaces:**
- Reserve and assigned payout endpoints consume normalized `lineOverrides`.
- Settlement `gross_commission_amount`, settlement items, cash movement, accounting payload, audit payload, and canonical inputs use final line totals.

- [ ] Add failing route tests for increase, decrease, invalid override, audit evidence, and no-override compatibility.
- [ ] Run the targeted integration test and confirm failures.
- [ ] Resolve line amounts after database row locking/validation and use them in all legacy and canonical writes.
- [ ] Re-run the targeted integration test until green.

### Task 4: Unassigned reserve payout UI

**Files:**
- Modify: `web/src/components/reception/UnassignedPerformerReservePanel.tsx`
- Modify: `web/src/components/reception/UnassignedPerformerReservePanel.test.tsx`

**Interfaces:**
- The component submits `lineOverrides` only for changed selected reserves.

- [ ] Add failing tests for editable final amounts, difference, required reason, and payload.
- [ ] Run `npx vitest run web/src/components/reception/UnassignedPerformerReservePanel.test.tsx` and confirm failures.
- [ ] Add per-reserve amount/reason state, validation, totals, and payload construction.
- [ ] Re-run the component test until green.

### Task 5: Assigned doctor payout UI

**Files:**
- Modify: `web/src/components/reception/cash-operations/DoctorPayoutWorkspace.tsx`
- Modify/create its focused test file.

**Interfaces:**
- The component submits `lineOverrides` only for changed selected accruals.

- [ ] Add failing tests for editing a diagnostic performer line, required reason, final selected total, and payload.
- [ ] Run the focused component test and confirm failures.
- [ ] Add editable payout controls for selected rows while preserving existing selection/group behavior.
- [ ] Re-run the component test until green.

### Task 6: Verification

**Files:**
- Review all changed files.

- [ ] Run all focused tests from Tasks 1–5.
- [ ] Run TypeScript typecheck/build commands used by the repository.
- [ ] Run the broader doctor payout, canonical compensation, accounting, and reception suites.
- [ ] Inspect the final diff for unrelated changes, missing migration mirrors, and accidental source-amount mutation.

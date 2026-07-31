# Lab Test Commission Eligibility Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a permanent per-lab-test Yes/No commission policy, set Cross Matching to No, block every prescriber/referral/performer payout path, then merge, migrate, and deploy through the canonical-shadow-safe production workflow.

**Architecture:** Add `lab_test_catalog.is_commissionable INTEGER NOT NULL DEFAULT 1` through additive migration `0520`. Resolve eligibility by tenant and concrete lab test ID before commission previews, order-time accruals, verification accruals, bill-time accruals, and diagnostic performer reserve creation. Keep legacy financial authority and Tenant 100 canonical strict shadow unchanged; when a test is non-commissionable, neither the legacy commission event nor its canonical shadow projection is produced.

**Tech Stack:** Cloudflare Workers, D1/SQLite, Hono, TypeScript, React, TanStack Query, Vitest, Wrangler versioned deployments.

## Global Constraints

- Release branch/worktree: `release/lab-commission-eligibility-20260721` at `.worktrees/release-lab-commission-eligibility-20260721`.
- Base: exact `origin/main` commit `fa742f4960a4bef35950bdb4c5a6a6f251782f8e` or a later fetched descendant.
- Release HEAD must contain canonical-safe ancestor `95836dc2b7baa6bc8d1cd3fe1264c68d3f696baf`.
- Migration is additive and backward-compatible with the active baseline Worker.
- Tenant 100 `canonical_financial_dual_write_v1` remains `financial/shadow/enabled/version 3/strict`.
- Canonical reads remain off; legacy authority remains active; Tenant 101/102 flags remain unchanged.
- Do not use `wrangler deploy --env production` or `pnpm deploy:production`.
- Do not include `.ai-bridge` or unrelated changes in commits.

---

### Task 1: Persistence and catalog API

**Files:**
- Create: `migrations/0520_lab_test_commission_eligibility.sql`
- Modify: `src/schemas/lab.ts`
- Modify: `src/routes/tenant/lab.ts`
- Test: `test/lab-test-commission-eligibility-schema.test.ts`

**Interfaces:**
- Consumes: existing `lab_test_catalog` CRUD.
- Produces: `is_commissionable: 0 | 1`, omitted values defaulting to `1`.

- [ ] Write a failing contract test requiring migration `0520`, default `1`, Cross Matching backfill to `0`, create persistence, and update persistence.
- [ ] Run `pnpm exec vitest run test/lab-test-commission-eligibility-schema.test.ts` and confirm RED.
- [ ] Add migration:

```sql
ALTER TABLE lab_test_catalog ADD COLUMN is_commissionable INTEGER NOT NULL DEFAULT 1
  CHECK (is_commissionable IN (0, 1));

UPDATE lab_test_catalog
SET is_commissionable = 0
WHERE LOWER(REPLACE(REPLACE(TRIM(name), ' ', ''), '-', '')) IN ('crossmatching', 'crossmatch');
```

- [ ] Add `is_commissionable: activeStatusSchema.optional()` to create/update validation.
- [ ] Persist the field in catalog POST and PUT, using existing active-status normalization with fallback `1`.
- [ ] Re-run the focused test and confirm GREEN.

### Task 2: Commission and performer-reserve enforcement

**Files:**
- Modify: `src/lib/lab-finance.ts`
- Modify: `src/lib/diagnostic-performer-reserve.ts`
- Test: `test/lab-finance.test.ts`
- Test: `test/diagnostic-performer-reserve.test.ts` or the existing reserve test file.

**Interfaces:**
- Produces: `isLabTestCommissionEligible(db, tenantId, labTestId): Promise<boolean>`.
- Non-positive or absent IDs remain eligible for legacy/non-lab lines.

- [ ] Write failing tests proving `is_commissionable = 0` blocks preview, order-time prescriber accrual, verification performer accrual, bill-time prescriber/referral/performer accrual, and performer reserve creation.
- [ ] Run focused tests and confirm RED with commission/reserve rows still created.
- [ ] Add a tenant-scoped eligibility lookup.
- [ ] Short-circuit each concrete lab-test commission entry point before rule lookup or writes.
- [ ] Filter non-commissionable lab items before effective performer payout rules are loaded and before reserve statements are built.
- [ ] Confirm no accounting posting event or canonical shadow event is emitted because no legacy commission accrual is created.
- [ ] Re-run focused tests and confirm GREEN.

### Task 3: Lab Settings Yes/No UI

**Files:**
- Modify: `web/src/pages/LabSettingsPage.tsx`
- Modify: `web/public/locales/en/laboratory.json`
- Modify: `web/public/locales/bn/laboratory.json`
- Test: `web/src/pages/LabSettingsPage.commission.test.ts`

**Interfaces:**
- Create/edit payload sends `is_commissionable: 1 | 0`.
- Catalog list shows an explicit commission status badge.

- [ ] Write a failing focused source-contract test for default Yes, edit hydration, numeric payload, Yes/No control, badge, and bilingual explanatory copy.
- [ ] Run the focused web test and confirm RED.
- [ ] Add form state, create/edit payload handling, table column/badge, and bilingual copy.
- [ ] Re-run the web test and confirm GREEN.

### Task 4: Adversarial review and verification

**Files:**
- Review every application file changed above; exclude generated and `_bmad` artifacts.

- [ ] Review acceptance criteria against actual code.
- [ ] Check tenant scoping, null/default behavior, duplicate joins, N+1 queries, fail-open/fail-closed behavior, old-Worker compatibility, and reserve-path bypasses.
- [ ] Run focused backend/frontend tests.
- [ ] Run `pnpm build:migrations`.
- [ ] Run `pnpm exec tsc --noEmit` and `pnpm --filter web exec tsc --noEmit`.
- [ ] Run `pnpm canonical:check`.
- [ ] Run relevant integration tests and full `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Require clean git status and canonical ancestor check.

### Task 5: Commit, merge, migrate, and canonical-shadow-safe deploy

**Files:**
- Create release evidence under a protected `/tmp/hms-release-*` directory only.

- [ ] Commit only scoped files with a logical message.
- [ ] Push release branch and merge it into `main` without bypassing test gates.
- [ ] Fetch and verify exact merged `origin/main` HEAD and clean status.
- [ ] Capture current production deployment IDs, Tenant 100 flag state, and zero reconciliation.
- [ ] Review production migration status; back up D1; apply only migration `0520` using the approved migration runner; verify column and Cross Matching backfill.
- [ ] Re-run reconciliation and require zero variance/controls/rows written.
- [ ] Upload merged HEAD with `wrangler versions upload` and install at `0%` beside the freshly read `100%` baseline.
- [ ] Verify candidate-bound health, authenticated read-only smoke, lab-settings API/UI availability, Tenant 101 legacy authority, and zero reconciliation.
- [ ] Promote through controlled traffic stages, keeping previous baseline at `0%` for rollback.
- [ ] Reverify deployment, health, exact Tenant 100 shadow flag, zero reconciliation, canonical reads off, legacy authority active, and Tenant 101/102 flags unchanged.

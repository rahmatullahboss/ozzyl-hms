# Lossless Main Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reviewed, verified local `main` containing all safe current work while preserving dirty worktrees, stashes, sensitive artifacts, and deployment state.

**Architecture:** Rebuild safe changes on the clean `integration/all-branches-main` branch from `origin/main`. Integrate independent behavior slices through red-green tests and focused commits, then merge the verified branch into the existing local `main` without rewriting either dirty feature branch.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, React, Vitest, pnpm, Git worktrees

---

### Task 1: Freeze the reviewed integration contract

**Files:**
- Create: `docs/superpowers/specs/2026-06-21-lossless-main-integration-design.md`
- Create: `docs/superpowers/plans/2026-06-21-lossless-main-integration.md`

- [ ] **Step 1: Verify the integration worktree is clean and based on `origin/main`**

Run: `git status --short --branch && git rev-parse HEAD origin/main`
Expected: clean branch and identical commit ids.

- [ ] **Step 2: Review the design against the audited branch/worktree/PR/stash inventory**

Expected: every candidate is either assigned a verified task or explicitly preserved/excluded.

- [ ] **Step 3: Commit the approved design and plan**

Run: `git add docs/superpowers/specs/2026-06-21-lossless-main-integration-design.md docs/superpowers/plans/2026-06-21-lossless-main-integration.md && git commit -m "docs: plan lossless main integration"`
Expected: one documentation-only commit.

### Task 2: Record production legacy-voucher compatibility

**Files:**
- Create: `migrations/0371_legacy_vouchers_compat.sql`
- Test: `test/migration-legacy-vouchers-compat.test.ts`

- [ ] **Step 1: Write a failing migration contract test**

The test must assert that migration 0371 exists, is idempotent, creates the legacy `vouchers` compatibility table, and creates the insert bridge into `accounting_vouchers`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/migration-legacy-vouchers-compat.test.ts`
Expected: FAIL because migration 0371 is absent.

- [ ] **Step 3: Add the audited idempotent migration**

Use SQLite/D1-compatible `CREATE TABLE IF NOT EXISTS` and `CREATE TRIGGER IF NOT EXISTS`; do not modify the conflicting untracked local 0374 file.

- [ ] **Step 4: Run focused test and migration generation**

Run: `pnpm exec vitest run test/migration-legacy-vouchers-compat.test.ts && pnpm build:migrations`
Expected: PASS and successful manifest generation.

- [ ] **Step 5: Commit only migration and test**

Run: `git add migrations/0371_legacy_vouchers_compat.sql test/migration-legacy-vouchers-compat.test.ts && git commit -m "fix: record legacy voucher compatibility migration"`
Expected: focused migration-history commit.

### Task 3: Harden patient-summary generation from PR 168

**Files:**
- Modify: `src/routes/tenant/ai.ts`
- Delete: `src/routes/tenant/ai-patient-summary.ts`
- Test: `test/ai-patient-summary-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Cover unauthorized non-clinical roles, allowed clinical roles, tenant-scoped missing patients, identifier-redacted external prompts, structured generated output, and uncached fallback output.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run test/ai-patient-summary-route.test.ts`
Expected: failures showing missing authorization, redaction, and fallback behavior.

- [ ] **Step 3: Implement the minimum hardened route**

Use existing auth/role patterns, a typed patient-summary system prompt, minimal clinical context, explicit JSON response parsing, and a response metadata flag that prevents fallback caching.

- [ ] **Step 4: Run focused and AI regression tests**

Run: `pnpm exec vitest run test/ai-patient-summary-route.test.ts test/ai.test.ts && pnpm exec tsc --noEmit -p tsconfig.api.json`
Expected: PASS with no API type errors.

- [ ] **Step 5: Commit the patient-summary slice**

Run: `git add src/routes/tenant/ai.ts src/routes/tenant/ai-patient-summary.ts test/ai-patient-summary-route.test.ts && git commit -m "feat: harden AI patient summaries"`
Expected: one tested AI-route commit.

### Task 4: Port billing-counter and reception workflow updates

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts`
- Modify: `src/routes/tenant/reception.ts`
- Modify: existing focused billing-counter and reception tests
- Modify: `web/src/pages/BillingHandoverPage.tsx`
- Modify: `web/src/pages/ReceptionDashboard.tsx`
- Modify: `web/src/pages/ReceptionReportsPage.tsx`
- Modify: focused web tests

- [ ] **Step 1: Add failing backend tests**

Assert rejected variance approvals clear all submitted non-cash settlement data and available-token responses include positive integer booked token numbers.

- [ ] **Step 2: Verify backend tests fail for the intended missing behavior**

Run the exact focused Vitest files discovered beside these routes.

- [ ] **Step 3: Port minimal backend behavior and verify GREEN**

Do not copy unrelated root changes; run focused tests and API typecheck.

- [ ] **Step 4: Add or update failing UI tests for settlement notes, booked-token display, and reception reports**

Verify failures before porting UI changes.

- [ ] **Step 5: Port the minimal UI changes and verify GREEN**

Run focused web Vitest files and web typecheck.

- [ ] **Step 6: Commit backend and UI as separate focused commits**

Expected: commits that do not include generated files, blank migration edits, or unrelated root artifacts.

### Task 5: Add a canonical cash-custody statement

**Files:**
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `web/src/pages/AdminTransactionControlCenter.tsx`
- Modify: `web/src/pages/admin/widgets/RevenueTrendChart.tsx`
- Test: focused cash-control and admin control-center tests

- [x] **Step 1: Write a failing backend test for duplicate-safe custody rows**

The fixture must contain a patient cash transaction and a non-overlapping drawer movement, then assert both appear in a single running statement. Drawer references that mirror patient bill/payment/refund flows must be excluded to prevent duplicate counting.

- [x] **Step 2: Verify RED**

Run the focused dashboard cash-control test and confirm the statement behavior is absent.

- [x] **Step 3: Implement the canonical statement**

Query `emp_cash_transactions` for patient cash collections/refunds and `cash_drawer_movements` for physical/manual custody movements, scope rows to the selected date, calculate `netMovementAfter`, and avoid claiming an actual drawer balance without an opening balance.

- [x] **Step 4: Add failing UI tests**

Assert selected-date scoping remains intact, statement copy says net movement, empty exceptions show an all-clear state, and existing localized relative audit time remains unchanged.

- [x] **Step 5: Port safe UI improvements and verify GREEN**

Keep the cash-ledger query date-scoped. Do not port the absolute-time AuditFeedWidget regression.

- [x] **Step 6: Run focused backend/web tests and typechecks, then commit**

Expected: no duplicate accounting source and no date/localization regression.

### Task 6: Fix the reproduced local-server migration-order CI failure

**Files:**
- Modify: `.github/workflows/ci-cd.yml` or the exact local-server baseline script identified by tracing
- Modify: `scripts/local-server/migrate.sh` only if the root cause is in runtime sequencing
- Test: focused shell/script contract test or CI baseline command

- [ ] **Step 1: Reproduce and trace the current failure**

Capture where `patients` is referenced before the baseline schema creates it; compare normal tenant bootstrap with versioned-debug mode.

- [ ] **Step 2: Write a failing regression check for the intended CI bootstrap path**

The test must exercise the same order as CI, not a simplified mock.

- [ ] **Step 3: Make the smallest sequencing correction**

Preserve production tenant snapshot/schema-sync semantics and do not enable destructive automatic migrations.

- [ ] **Step 4: Run the regression check and relevant local-server tests**

Expected: baseline creation succeeds without changing production migration state.

- [ ] **Step 5: Commit the CI/local-server fix**

Expected: one focused infrastructure commit with evidence in the commit diff.

### Task 7: Preserve session context and repository hygiene

**Files:**
- Modify: `agents.md`
- Modify: `.gitignore`
- Create or modify: `active-context.md`
- Create or modify: `.ai-bridge/current-plan.md`
- Create or modify: `.ai-bridge/project-map.md`
- Create or modify: `.ai-bridge/codex-status.md`
- Create or modify: `.ai-bridge/open-questions.md`
- Create or modify: `.ai-bridge/agent-rules.md`

- [ ] **Step 1: Add `.worktrees/` ignore coverage and correct the skill name to `superpowers:executing-plans`**

- [ ] **Step 2: Copy only redacted session-memory content**

Run: `rg -n "codexpro_token=|CLOUD_SYNC_TOKEN|JWT_SECRET" active-context.md .ai-bridge`
Expected: no secret values.

- [ ] **Step 3: Verify the files reflect the actual branch, commits, tests, blockers, and next step**

- [ ] **Step 4: Commit only the reviewed instructions, ignore rule, and memory files**

Expected: no generated bridge artifacts or secret-bearing files.

### Task 8: Verify and merge into local main

**Files:**
- No production file edits after verification begins

- [ ] **Step 1: Run full integration verification**

Run: `pnpm build:migrations && pnpm exec tsc --noEmit -p tsconfig.api.json && pnpm test && pnpm --dir web test -- --run && pnpm build`
Expected: all newly affected tests pass; any pre-existing baseline failures are reproduced against untouched `origin/main` and documented.

- [ ] **Step 2: Perform an adversarial diff review**

Compare `origin/main...integration/all-branches-main`; verify excluded artifacts and sensitive files are absent.

- [ ] **Step 3: Merge the integration branch into the existing local `main`**

Use a normal merge in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-merge`; do not reset or rebase away its patch-equivalent local commit.

- [ ] **Step 4: Re-run focused tests and build on merged local `main`**

Expected: same result as the integration branch.

- [ ] **Step 5: Verify preservation boundaries**

Recheck root dirty status, patient-portal dirty status, stash count, local/remote branch tips, and production pending migration list without applying anything.

- [ ] **Step 6: Report final local state**

Include local main SHA, commits integrated, exclusions, tests/build evidence, pending production migrations, and explicit confirmation that no push/deploy occurred.

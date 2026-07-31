# Doctor Commission Rounding Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make preview and persisted percentage commission totals reconcile exactly to the rounded bill-level percentage while preserving per-line accrual records.

**Architecture:** Add one deterministic cumulative percentage allocator inside `src/lib/lab-finance.ts`. Key state by doctor, source type, incentive type, and rule ID; percentage lines receive the delta between consecutive cumulative totals, while flat rules keep existing line-level behavior. Use the allocator in preview and bill accrual paths before applying waiver policy.

**Tech Stack:** TypeScript, Cloudflare D1, Vitest, pnpm.

## Global Constraints

- Preserve existing canonical/legacy dual-write and accounting event behavior.
- Do not change flat commission behavior.
- Do not mix allocation state across doctors, commission roles, source types, or rules.
- Use TDD: regression test must fail before implementation.
- Production correction must be narrowly scoped and separately verified.

---

### Task 1: Add the failing reconciliation test

**Files:**
- Modify: `test/lab-finance.test.ts`

**Interfaces:**
- Consumes: `previewDoctorCommissionForItems`, `accrueBillCommissions`.
- Produces: regression expectations for BDT 1,600 at 25% with a 5% protected floor.

- [ ] Add a test using bases `163.64`, `981.82`, and `454.54`, waiver request `400`, and a 25%/5% protected-floor rule.
- [ ] Assert preview earned total `400`, protected total `80`, and maximum waiver `320`.
- [ ] Assert persisted accrual sums earned `400`, waiver `320`, protected/payable `80`.
- [ ] Run `pnpm vitest run test/lab-finance.test.ts` and confirm the new test fails with the current `400.01`/`320.01` drift.

### Task 2: Implement cumulative percentage allocation

**Files:**
- Modify: `src/lib/lab-finance.ts`

**Interfaces:**
- Produces: a local allocator accepting allocation key, base amount, rate type, and rate value, returning a line amount.

- [ ] Add a cumulative allocator that stores prior base by key.
- [ ] For percentage rules, return `roundMoney(cumulative commission after line - cumulative commission before line)`.
- [ ] For flat rules, delegate to the existing `calculateCommissionAmount` behavior.
- [ ] Use a preview allocator keyed by doctor/source/incentive/rule.
- [ ] Use a bill-accrual allocator keyed by doctor/source/incentive/rule for prescriber, referrer, performer, and consultation percentage rules.
- [ ] Pass the cumulative base-before context into canonical dual-write validation and verify the allocated delta there.
- [ ] Run the lab-finance and canonical live doctor-compensation tests and confirm all tests pass.

### Task 3: Verify and commit

**Files:**
- Verify: `src/lib/lab-finance.ts`
- Verify: `test/lab-finance.test.ts`
- Verify: design and plan documents.

- [ ] Run focused tests: `pnpm vitest run test/lab-finance.test.ts`.
- [ ] Run type checking: `pnpm typecheck`.
- [ ] Run build: `pnpm build`.
- [ ] Review the exact diff and stage only task-owned files.
- [ ] Commit with `fix(commissions): reconcile percentage rounding across bill lines`.

### Task 4: Correct the live one-paisa drift

**Files:**
- Create local rollback SQL under `backups/` only if it is an explicit task deliverable; otherwise keep the exact before-values in the execution record.

- [ ] Read tenant example bill 7085 rows 2910–2912 and allocations 394–395 immediately before mutation.
- [ ] Update the final accrual row so total earned is `400.00`, total doctor waiver is `320.00`, and payable remains `80.00`.
- [ ] Update allocation 394 from `320.01` to `320.00` and allocation 395 from `79.99` to `80.00`.
- [ ] Verify exact invoice totals and today's doctor totals with fresh read-only queries.

### Task 5: Integrate into local main

**Files:**
- No source edits during integration.

- [ ] Confirm task branch is clean and single-purpose.
- [ ] Discover the clean worktree checked out on local `main` using `git worktree list --porcelain`.
- [ ] Run `pnpm worktree:check -- --mode=integration` in the clean main worktree.
- [ ] Merge the verified task branch into local `main`.
- [ ] Run fresh focused test, typecheck, and build on `main`.
- [ ] Do not push or deploy without separate authorization.

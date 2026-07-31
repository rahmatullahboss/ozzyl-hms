# Main Worktree Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce a stable `main` root checkout and require isolated task worktrees created from reviewed `main` before implementation.

**Architecture:** Put the mandatory startup contract in `agents.md`, detailed rules in `.agent-rules/git-workflow.md`, and executable validation in `scripts/check-worktree-policy.mjs`. Protect the contract with a focused Vitest file and expose the checker through `package.json`.

**Tech Stack:** Git worktrees, Node.js ESM, Vitest, pnpm.

## Global Constraints

- Work only in `docs/enforce-main-worktree-policy-20260723`, created from local `main`.
- Do not modify `.ai-bridge` files or any unrelated checkout.
- Keep push, deploy, and production migration outside this task.
- Stage exact files only and commit each verified slice.

---

### Task 1: Add the failing governance contract

**Files:**
- Create: `test/repository-worktree-policy.test.ts`

**Interfaces:**
- Consumes: repository files through `node:fs` and the checker through `node:child_process`.
- Produces: regression requirements for instructions, package command, and task-mode checker behavior.

- [ ] **Step 1: Write the failing test**

Create tests that require:

```ts
expect(agents).toContain('.agent-rules/git-workflow.md');
expect(packageJson.scripts['worktree:check']).toBe('node scripts/check-worktree-policy.mjs');
expect(existsSync('scripts/check-worktree-policy.mjs')).toBe(true);
```

Also execute:

```ts
execFileSync(process.execPath, ['scripts/check-worktree-policy.mjs', '--mode=task'], {
  encoding: 'utf8',
});
```

and assert the output identifies a linked task worktree and the current feature branch.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/repository-worktree-policy.test.ts`
Expected: FAIL because the rule file, package command, and checker do not exist.

### Task 2: Implement repository instructions and checker

**Files:**
- Modify: `agents.md`
- Create: `.agent-rules/git-workflow.md`
- Create: `scripts/check-worktree-policy.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Git metadata from `git rev-parse`, `git branch`, and `git status`.
- Produces: `pnpm worktree:check -- --mode=task|root|integration [--allow-dirty]`.

- [ ] **Step 1: Update the mandatory startup contract**

Replace the dated hardcoded main-worktree path with dynamic discovery rules. Require every task to read `.agent-rules/git-workflow.md` and run the matching preflight before changes.

- [ ] **Step 2: Add the detailed Git workflow rule**

Document root ownership, task worktree creation from reviewed `main`, dirty checkout preservation, integration rules, long-running program exceptions, and cleanup.

- [ ] **Step 3: Add the checker**

Implement `task`, `root`, and `integration` modes. Fail with actionable messages when branch identity, linked-worktree state, or cleanliness violates the selected mode. Permit `--allow-dirty` only in task mode.

- [ ] **Step 4: Add the package command**

Add:

```json
"worktree:check": "node scripts/check-worktree-policy.mjs"
```

- [ ] **Step 5: Run the focused test**

Run: `pnpm vitest run test/repository-worktree-policy.test.ts`
Expected: PASS.

### Task 3: Verify and commit

**Files:**
- Review all files from Tasks 1-2.

**Interfaces:**
- Consumes: committed governance contract.
- Produces: one focused implementation commit ready for local `main` integration.

- [ ] **Step 1: Run checker directly**

Run: `pnpm worktree:check -- --mode=task`
Expected: PASS with branch `docs/enforce-main-worktree-policy-20260723` and linked worktree state.

- [ ] **Step 2: Run focused tests and TypeScript-adjacent validation**

Run: `pnpm vitest run test/repository-worktree-policy.test.ts test/authz.test.ts`
Expected: all tests pass.

Run: `node --check scripts/check-worktree-policy.mjs`
Expected: exit code 0.

- [ ] **Step 3: Review exact diff**

Confirm no `.ai-bridge`, generated, dependency, or unrelated files are staged.

- [ ] **Step 4: Commit**

```bash
git add agents.md .agent-rules/git-workflow.md scripts/check-worktree-policy.mjs package.json test/repository-worktree-policy.test.ts docs/superpowers/plans/2026-07-23-main-worktree-governance.md
git commit -m "chore: enforce main worktree workflow"
```

### Task 4: Integrate into local main

**Files:**
- No new source files.

**Interfaces:**
- Consumes: verified branch commits.
- Produces: local `main` containing the governance contract.

- [ ] **Step 1: Confirm the main worktree has no overlapping changes**

Inspect its status and confirm dirty files, if any, are unrelated `.ai-bridge` operational artifacts.

- [ ] **Step 2: Fast-forward local main**

Run from the existing main worktree:

```bash
git merge --ff-only docs/enforce-main-worktree-policy-20260723
```

- [ ] **Step 3: Verify the integrated result**

Run the focused governance test from the main worktree and confirm `git log -1` contains the governance implementation commit.

- [ ] **Step 4: Preserve external-action boundary**

Do not push, deploy, or remove unrelated dirty operational files.

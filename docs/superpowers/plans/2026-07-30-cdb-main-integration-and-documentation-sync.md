# CDB Main Integration and Documentation Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize every active Canonical program control document to CDB-V1-070B, perform an adversarial branch review, and integrate the verified CDB program branch into the latest `origin/main` without performing any production deployment, migration, backfill, traffic, or feature-flag action.

**Architecture:** Keep historical checkpoint evidence immutable while updating only active control surfaces and current next-action instructions. Treat `main` integration as the prerequisite for the Gate A candidate rather than as the final post-production action. Perform integration serially through the clean `main` worktree, verify the merged result, push `origin/main`, then retire the fully merged long-running branch/worktree.

**Tech Stack:** Git worktrees, pnpm, TypeScript, Vitest, YAML/JSON governance artifacts, Cloudflare/D1 repository tooling (repository-only in this plan).

## Global Constraints

- Preserve `.ai-bridge/execution-log.jsonl` and `.ai-bridge/session-log.jsonl`; never reset, clean, stash, overwrite, or commit them.
- Do not deploy a Worker, query or mutate production, apply migrations/backfills, change traffic, activate provider flags, promote Canonical authority, enable local sync, or retire Legacy authority.
- Historical CDB-V1-050, CDB-V1-060, CDB-V1-065, CDB-V1-070A, and CDB-V1-070B evidence remains immutable.
- Active checkpoint is `CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY`.
- Next protected gate is `CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED`.
- Non-production domains may run in parallel only in one dedicated branch/worktree per bounded context; shared governance files remain integration-agent-owned.

---

### Task 1: Synchronize active Canonical control documents

**Files:**
- Modify: `docs/architecture/hms-canonical-parallel-execution-board.yaml`
- Modify: `docs/architecture/canonical-main-continuation-prompt.md`
- Modify: `docs/database/canonical-core-v1-production-cutover-runbook.md`
- Modify: `task-progress.yaml`
- Modify: `.ai-bridge/current-plan.md`
- Modify: `docs/architecture/canonical-program-control-center.md`
- Create: `docs/database/audits/2026-07-30-cdb-main-integration-readiness-review.md`

**Interfaces:**
- Consumes: CDB-V1-070B package and readiness artifacts already committed on `program/cdb-main-continuous-20260725`.
- Produces: one consistent active checkpoint, one consistent next gate, a main-integration prerequisite, and accurate parallel-lane ownership rules.

- [ ] **Step 1: Add a documentation consistency contract**

Create a Vitest contract that reads the active control files and requires:

```ts
expect(board).toContain('current_checkpoint: CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY');
expect(board).toContain('next_task: CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED');
expect(prompt).toContain('CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY');
expect(prompt).toContain('CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED');
expect(tracker).toContain('cdb_to_main_integration: checkpoint_merge_before_gate_a');
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
pnpm exec vitest run test/canonical/cdb-main-integration-documentation-contract.test.ts
```

Expected: failure because the parallel board and continuation prompt still reference older checkpoints.

- [ ] **Step 3: Update only active/current sections**

Update current control fields while retaining historical evidence blocks. Record:

```yaml
current_checkpoint: CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY
next_task: CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED
main_integration_required_before_gate_a: true
cdb_to_main_integration: checkpoint_merge_before_gate_a
```

Update the global action to documentation sync, review, verified main integration, and only then separately authorized Gate A evidence collection.

- [ ] **Step 4: Run the contract and verify GREEN**

Run the focused contract and require all assertions to pass.

- [ ] **Step 5: Commit the synchronized documentation**

Stage exact task-owned files only and commit:

```bash
git commit -m "docs(canonical): synchronize main integration checkpoint"
```

### Task 2: Perform adversarial branch review and merge-readiness verification

**Files:**
- Review: complete `origin/main...program/cdb-main-continuous-20260725` commit and file diff
- Update: `docs/database/audits/2026-07-30-cdb-main-integration-readiness-review.md`

**Interfaces:**
- Consumes: synchronized branch and all Canonical governance/test commands.
- Produces: explicit HIGH/MEDIUM/LOW findings, fixed blockers, merge decision, and verification evidence.

- [ ] **Step 1: Fetch and record exact base/head**

Run:

```bash
git fetch origin main
git rev-parse origin/main
git rev-parse HEAD
git rev-list --left-right --count origin/main...HEAD
```

- [ ] **Step 2: Review complete branch reality**

Inspect commit list, changed-file list, migration range, package scripts, authorization boundaries, production safety flags, shared governance registries, and all active documentation. Exclude `.ai-bridge` logs and `_bmad` implementation internals from application review.

- [ ] **Step 3: Fix every HIGH and MEDIUM finding**

No merge may proceed with unresolved HIGH or MEDIUM findings. Record LOW follow-ups only when they do not affect correctness, safety, integration, or future agent execution.

- [ ] **Step 4: Run full pre-merge verification**

Run fresh:

```bash
pnpm exec tsc --noEmit
pnpm build:migrations
pnpm canonical:check
pnpm exec vitest run test/canonical
pnpm worktree:check -- --mode=task --allow-dirty
```

Expected: exit code 0 for every command; all Canonical tests pass; migration manifest remains 504 unless an explicitly reviewed source migration changes it.

- [ ] **Step 5: Commit review evidence and fixes**

Commit exact reviewed files:

```bash
git commit -m "docs(canonical): record main integration readiness review"
```

### Task 3: Integrate into latest origin/main and push

**Files:**
- Integration worktree: `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-governance-integration-20260723`
- Branches: `main`, `program/cdb-main-continuous-20260725`

**Interfaces:**
- Consumes: clean, fully committed, reviewed CDB branch reconciled with current `origin/main`.
- Produces: verified `origin/main` containing all CDB checkpoint commits.

- [ ] **Step 1: Verify clean integration worktree**

Run from the `main` worktree:

```bash
pnpm worktree:check -- --mode=integration --require-latest-origin-main
```

Expected: integration policy passes and `main` is clean.

- [ ] **Step 2: Reconcile branch with exact current origin/main**

Fetch `origin/main`. If `origin/main` advanced, merge it into the CDB branch, resolve only reviewed conflicts, and rerun Task 2 verification.

- [ ] **Step 3: Merge CDB branch into main**

Use a fast-forward when ancestry permits; otherwise create one reviewed merge commit. Do not squash 249 checkpoint commits because their evidence hashes and history are deliberate.

- [ ] **Step 4: Run post-merge verification on main**

Run TypeScript, migration manifest, full Canonical governance, Canonical tests, and integration worktree policy from merged `main`.

- [ ] **Step 5: Push and confirm origin/main**

Push verified `main` and confirm `origin/main` contains the CDB head/merge commit.

- [ ] **Step 6: Clean up only the fully merged CDB branch/worktree**

After remote confirmation, preserve any intentional logs outside committed history, remove the clean CDB worktree, delete the fully merged local/remote CDB branch if present, prune worktrees, and report exact cleanup status.

## Self-Review

- Spec coverage: documentation sync, full review, merge decision, integration, push, cleanup, production safety, and parallel-agent guidance are all covered.
- Placeholder scan: no TODO/TBD placeholders are present.
- Type consistency: checkpoint and next-gate identifiers match CDB-V1-070B package/readiness artifacts.

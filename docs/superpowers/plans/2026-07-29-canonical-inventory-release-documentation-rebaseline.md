# Canonical, Inventory and Modular-Monolith Release Documentation Rebaseline Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale HMS entry-point guidance with one verified handoff that distinguishes completed Inventory development from unfinished Canonical/Full-MM work and from separately authorized production migration, retirement and deployment.

**Architecture:** Commit one machine-readable current-state record and one human control center on a documentation-only branch based on the latest fetched `origin/main`. Existing production-readiness and deployment entry points will link to these sources rather than duplicating branch-sensitive facts. Migration collision and destructive-retirement rules will live in a dedicated database runbook.

**Tech Stack:** Markdown, YAML, Git worktrees, pnpm repository policy checks.

## Global Constraints

- Base every edit on fetched `origin/main` SHA `849cf757b0b83bf30585112fdaee18db31f2950b`.
- Preserve all existing dirty branches/worktrees; edit only `docs/canonical-inventory-release-handoff-20260729`.
- Do not merge program branches, deploy, query or mutate production, apply migrations, change flags/traffic, or drop legacy tables.
- Treat `feature/inventory-modular-monolith` as development-complete but not `main`-integrated or production-released.
- Treat `program/cdb-main-continuous-20260725` and `program/mm-canonical-inventory-sync-20260727` as active unfinished programs.
- Hold `0558d_retire_legacy_inventory_tables.sql` outside ordinary production migration execution until a separately authorized destructive-retirement gate passes.

---

### Task 1: Create authoritative current-state and control-center documents

**Files:**
- Create: `docs/architecture/canonical-inventory-mm-current-state.yaml`
- Create: `docs/architecture/2026-07-29-canonical-inventory-mm-release-control-center.md`

**Interfaces:**
- Consumes: live Git heads/divergence and the authoritative Inventory, CDB and Full-MM trackers.
- Produces: the first read for every new engineering chat and a machine-readable status source for future updates.

- [ ] Record branch heads, remote synchronization, divergence, completion state, exact next checkpoint and prohibited operations.
- [ ] Document the ordered development, integration, migration and release gates.
- [ ] State uncertainty explicitly where production D1 was not queried.

### Task 2: Create continuation and migration-reconciliation handoffs

**Files:**
- Create: `docs/architecture/2026-07-29-canonical-inventory-mm-continuation-prompt.md`
- Create: `docs/database/2026-07-29-inventory-main-migration-reconciliation.md`
- Modify: `docs/architecture/canonical-main-continuation-prompt.md`

**Interfaces:**
- Consumes: Task 1 status definitions.
- Produces: copy-paste commands for a new chat and the exact 11-prefix migration collision matrix.

- [ ] Route immediate execution to `CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION`.
- [ ] Define a later consolidated integration rehearsal from fresh `origin/main`.
- [ ] Require migration renumbering/reservation after current Canonical migrations.
- [ ] Separate additive migration release from destructive legacy retirement.

### Task 3: Repoint repository entry documents and release runbooks

**Files:**
- Modify: `docs/production-readiness/index.md`
- Modify: `docs/production-readiness/START_HERE.md`
- Modify: `docs/production-readiness/CURRENT_NEXT_TASK.md`
- Modify: `docs/production-readiness/TASK_STATUS.md`
- Modify: `docs/operations/production-deploy-runbook.md`
- Modify: `docs/operations/canonical-shadow-safe-production-deploy.md`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 sources.
- Produces: consistent navigation and fail-closed deployment guidance.

- [ ] Prevent new sessions from starting stale Wave-0 or direct-merge work without current Git reconciliation.
- [ ] State that merge, migration, feature activation, traffic promotion and destructive retirement are distinct approvals.
- [ ] Keep the existing shadow-safe candidate deployment workflow mandatory.

### Task 4: Verify, commit and integrate the documentation task

**Files:**
- Verify all files above.

**Interfaces:**
- Consumes: completed documentation changes.
- Produces: a clean, reviewable documentation commit ready for normal `main` integration.

- [ ] Run `pnpm worktree:check -- --mode=task --allow-dirty`.
- [ ] Run a targeted stale-reference search for obsolete CDB branch/worktree names in the modified entry files.
- [ ] Run `git diff --check` and review the complete diff.
- [ ] Commit exact documentation files.
- [ ] Reconcile with latest fetched `origin/main`, integrate through the clean `main` worktree, run post-merge checks and push `origin/main` under the standing repository integration authorization.

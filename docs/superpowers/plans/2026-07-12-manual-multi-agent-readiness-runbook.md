# Manual Multi-Agent Readiness Runbook Implementation Plan

> **For agentic workers:** Execute this plan inline. This repository workflow does not assume sub-agent support.

**Goal:** Convert the production-readiness workflow from autonomous task-to-main execution into a manual multi-agent model controlled by the owner.

**Architecture:** A worker agent owns exactly one task branch and stops after producing a clean verified branch. A separately instructed integration agent serializes merges into local `main`, updates shared status/evidence, and runs post-merge verification. A wave verifier runs only after the required task branches have been integrated.

**Tech Stack:** Markdown operational documentation, Git worktrees, local Git merge lock.

## Global Constraints

- Keep all existing task IDs and task scopes stable.
- Do not assume the agent platform provides sub-agents.
- Worker agents must not edit shared status/tracker files or merge to `main`.
- Integration must be serial and explicitly requested by the owner.
- No remote push, deployment, or production migration without a separate explicit instruction.

---

### Task 1: Define the manual worker/integrator command contract

**Files:**
- Modify: `agents.md`
- Modify: `docs/production-readiness/AGENT_TASK_EXECUTION_PROTOCOL.md`

- [x] Make `W0-01 করো` default to worker mode.
- [x] Add `W0-01 integrate করো` for the integration agent.
- [x] Add `W0 verify করো` for wave-level verification.
- [x] Remove all assumptions that a worker can dispatch sub-agents.

### Task 2: Create the owner scheduling runbook

**Files:**
- Create: `docs/production-readiness/MANUAL_MULTI_AGENT_RUNBOOK.md`
- Rewrite: `docs/production-readiness/OWNER_TASK_COMMANDS.md`

- [x] Define owner, worker, integration, wave-verification, and manual-QA roles.
- [x] Provide copy-paste prompts.
- [x] Provide parallel and serial batches for W0 through FINAL.
- [x] Define safe maximum concurrency and shared-file rules.

### Task 3: Align existing navigation and branch planning documents

**Files:**
- Modify: `docs/production-readiness/MULTI_AGENT_BRANCH_PLAN.md`
- Modify: `docs/production-readiness/START_HERE.md`
- Modify: `docs/production-readiness/index.md`
- Modify: `docs/production-readiness/TASK_STATUS.md`

- [x] Replace worker self-merge language with explicit integration-agent handoff.
- [x] Add `READY FOR INTEGRATION` and `INTEGRATING` status meanings.
- [x] Link the new runbook from all starting documents.

### Task 4: Review, verify, commit, and integrate locally

- [x] Run Markdown link verification.
- [x] Check task-ID consistency.
- [x] Run adversarial review for contradictory merge instructions.
- [x] Commit the documentation branch.
- [x] Merge into clean local `main` under the shared merge lock.
- [x] Run post-merge documentation verification.

## Completion Evidence

- Documentation commit: `55404f85`
- Local-main merge commit: `8eeeda72a5594264bebdcc2643426ef392597321`
- Task-ID consistency: 34 catalog IDs matched status, owner commands, and manual runbook
- Relative link verification: 25 checked, 0 broken
- Diff check: passed before commit and after merge
- Remote push/deployment: not performed

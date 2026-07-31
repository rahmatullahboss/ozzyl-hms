# HMS Manual Multi-Agent Task Execution Protocol

**Purpose:** The owner manually assigns one task ID to one worker agent. The worker reviews, fixes, tests, documents, and commits that task on an isolated branch, then stops. A separately instructed integration agent reviews and merges verified branches into local `main` one at a time.

This protocol does not assume sub-agent support.

## 1. Command contract

### Worker mode — default

A valid task ID plus an execution verb means worker mode:

```text
W0-01 করো
W2-04 complete করো
FINAL-01 execute করো
```

The worker owns exactly one task and must stop at exactly one handoff status:

- `READY FOR INTEGRATION`
- `BLOCKED`
- `FAIL — EVIDENCE ONLY`
- `N/A FOR THIS HOSPITAL — EVIDENCE ONLY`

A worker must not merge to `main` or update shared status/tracker files.

### Integration mode — explicit

```text
W0-01 integrate করো
```

Only an explicitly instructed integration agent may merge the worker branch into local `main`, update shared status/evidence, and clean up the worktree.

### Wave verification mode — explicit

```text
W0 verify করো
W2 verify করো
FINAL verify করো
```

A wave verifier checks integrated work already present on local `main`. It does not silently implement missing task scope.

### What worker mode authorizes

- Read and inspect the repository.
- Create or continue one dedicated task branch/worktree.
- Run local setup and baseline verification.
- Review task-relevant code, UI, API, schema, permissions, tests, reports, and operations.
- Create failing tests or deterministic reproduction evidence.
- Make focused production-quality fixes.
- Run requirement/safety and code-quality review.
- Update `docs/production-readiness/runs/<TASK-ID>.md`.
- Commit task-owned changes.

### What worker mode does not authorize

- Merging into local `main`.
- Editing `TASK_STATUS.md`, the master tracker, or another task's run report.
- Fetching, pulling, or pushing remote Git state.
- Production deployment or production migration.
- Sending secrets, real patient data, or sensitive logs to external services.
- Accepting patient-safety, privacy, tenant-isolation, medication, money, stock, result-integrity, or backup risk without accountable approval.

Remote Git, deployment, and production migration always require separate explicit instructions.

---

## 2. Manual roles

### Owner / Dispatcher

The owner:

- Assigns one task ID to each separate worker agent.
- Avoids assigning the same task twice.
- Waits for worker branches to become `READY FOR INTEGRATION`.
- Tells one integration agent to integrate tasks serially.
- Starts dependent tasks only after prerequisite integrations are confirmed.
- Requests wave verification after the wave's required tasks are integrated.

### Worker Agent

A worker:

- Owns one task ID, branch, worktree, and run report.
- Does not coordinate or create sub-agents.
- Avoids shared high-conflict files outside task scope.
- Produces a clean verified branch and exact handoff evidence.
- Does not merge to `main`.

### Integration Agent

An integration agent:

- Handles one explicit `<TASK-ID> integrate করো` instruction at a time.
- Reviews the worker branch, diff, run report, and dependencies.
- Uses the shared merge lock.
- Rebases/merges against current local `main`.
- Reruns required tests after conflict resolution and after merge.
- Updates shared status, tracker, and final run-report evidence.
- Cleans up only after successful integration.

### Wave Verification Agent

A wave verifier:

- Confirms every required task is integrated.
- Runs integrated workflow, reconciliation, safety, and operational checks.
- Records the wave verdict and blockers.
- Does not mark missing tasks complete.

### Manual QA Staff

Manual QA staff execute test steps against controlled non-production data, attach evidence, and report bugs. They do not declare engineering tasks `PASS` without integration evidence.

---

## 3. Mandatory documents

Before changing code, a worker must read:

1. `agents.md`
2. `.agent-rules/architecture.md`
3. `.agent-rules/coding-rules.md`
4. Domain-specific `.agent-rules/*` files
5. `docs/production-readiness/MANUAL_MULTI_AGENT_RUNBOOK.md`
6. `docs/production-readiness/TASK_CATALOG.md`
7. `docs/production-readiness/TASK_STATUS.md`
8. `docs/HMS_PRODUCTION_READINESS_TRACKER.md`
9. `docs/production-readiness/MODULE_REVIEW_WORKFLOW.md`
10. Existing task-specific plans, reports, runbooks, and evidence

The repository and current code are the implementation source of truth. Old reports are evidence, not proof of readiness.

If an external connector is unavailable, use repository evidence, record the limitation in the run report, and leave external evidence sync as a named follow-up.

---

## 4. Mandatory skill sequence

Load `using-superpowers` before any action.

### Worker skills

Always use when applicable:

1. `using-git-worktrees`
2. `writing-plans` for multi-step work
3. `systematic-debugging` for defects, failures, and unexpected behavior
4. `test-driven-development` for fixes or new behavior
5. `requesting-code-review` or an equivalent independent review workflow
6. `verification-before-completion`
7. `finishing-a-development-branch` for branch handoff and cleanup decisions

Additional task-specific review/test skills may be used.

### No sub-agent assumption

Do not require or invoke `subagent-driven-development` or `dispatching-parallel-agents` when the platform has no sub-agent system. The owner creates parallelism by opening separate agent sessions.

### Integration skills

An integration agent must use:

- `using-superpowers`
- `receiving-code-review` when evaluating worker findings or review feedback
- `verification-before-completion`
- `finishing-a-development-branch`

---

## 5. Resolve and claim one task

A worker must:

1. Find the exact ID in `TASK_CATALOG.md`.
2. Read scope, dependencies, exclusions, completion gates, and linked evidence.
3. Inspect `TASK_STATUS.md`, worktrees, branches, commits, and `runs/<TASK-ID>.md`.
4. Refuse duplicate implementation if another active worker already owns the task.
5. Confirm prerequisites are integrated into local `main`.
6. If a prerequisite is missing, stop with an exact blocker unless the manual runbook explicitly permits a preparation-only phase.
7. Record branch, worktree, base commit, owner/session note, and start date in the task run report.

The worker must not update the shared `TASK_STATUS.md` claim row, because parallel workers editing the same shared file create avoidable conflicts.

---

## 6. Branch and worktree rules

### Branch naming

```text
task/<lowercase-task-id>-<short-slug>
```

Examples:

```text
task/w0-01-auth-session
task/w2-04-pharmacy-review
task/final-01-go-live-simulation
```

### Worktree naming

```text
.worktrees/<task-id-lowercase>-<short-slug>
```

### Base rules

- Start from the latest clean local `main` containing all required dependencies.
- Do not fetch, pull, or contact a remote without explicit authorization.
- Never reset, clean, stash, or overwrite another person's changes.
- Never work in another task's checkout.
- If local `main` is known to be behind a remote, record that as a release risk.

### Baseline gate

Inside the task worktree:

1. Record the base commit SHA.
2. Install dependencies only when required.
3. Run the smallest reliable relevant baseline tests.
4. Separate pre-existing failures from task-created failures.
5. Do not claim a clean baseline without fresh output.

---

## 7. Task-owned evidence

Create or update:

```text
docs/production-readiness/runs/<TASK-ID>.md
```

Use `TASK_RUN_REPORT_TEMPLATE.md` and record:

- Task ID and title
- Worker role/session label
- Branch/worktree
- Base commit
- Start date
- Scope and exclusions
- Dependency state
- Existing implementation inventory
- Findings and severity
- Tests added or changed
- Fixes and commits
- Verification commands and exact results
- Review findings and resolutions
- Residual risks
- Handoff status
- Integration commit, filled later by the integration agent
- Final verdict, filled after integration

Worker handoff status must be one of:

- `READY FOR INTEGRATION`
- `BLOCKED`
- `FAIL — EVIDENCE ONLY`
- `N/A FOR THIS HOSPITAL — EVIDENCE ONLY`

---

## 8. Review before fixing

For the assigned scope, identify applicable:

- Mounted routes and canonical write paths
- Services and helpers
- Tables, migrations, indexes, constraints, and transactions
- Frontend pages, forms, validation, errors, prints, and exports
- Permissions, approvals, audit, and tenant isolation
- Existing automated and manual tests
- Providers, queues, cron jobs, devices, local-server behavior, and runbooks
- Legacy or duplicate paths

Test applicable categories:

- Happy path
- Invalid and missing input
- Duplicate submit, retry, refresh, and idempotency
- Concurrent action
- Cancellation, reversal, correction, and reprint
- Unauthorized role
- Cross-tenant IDs and guessed URLs
- Provider/network/device failure
- Audit and reconciliation

Create concrete findings before changing code. Avoid unrelated refactoring.

---

## 9. Fix workflow

For each confirmed defect:

1. Reproduce it with a focused failing test or deterministic evidence.
2. Identify the root cause.
3. Implement the smallest architecture-compliant fix.
4. Run the focused test and confirm it passes.
5. Run adjacent regression tests.
6. Update documentation when behavior, schema, permissions, configuration, or operations changed.
7. Commit a logical unit with the task ID.

Recommended commit format:

```text
fix(W0-01): revoke sessions for deactivated staff
test(W0-01): cover cross-tenant refresh rejection
docs(W0-01): record auth review evidence
```

Do not combine unrelated modules in one task branch.

---

## 10. Worker review gate

Before handoff, perform two separate reviews.

### Pass 1 — Requirement and safety

Check every task completion gate and all applicable patient safety, privacy, tenant isolation, money, stock, medication, result integrity, audit, backup, and operational effects.

### Pass 2 — Code quality

Review the complete branch diff for:

- Architecture violations
- Authorization/security gaps
- Missing tests
- Race conditions and idempotency gaps
- Error handling and observability
- Legacy duplication
- Scope expansion
- Secret or sensitive-data leakage

Fix all unaccepted Critical and High findings. Record accepted Medium risks with owner, reason, and follow-up.

---

## 11. Worker verification matrix

Run fresh verification after all fixes and reviews.

| Gate | Required evidence |
|---|---|
| Focused tests | Changed behavior and original defect coverage |
| Adjacent integration | Related routes/services/module flows |
| Authorization | Authorized, unauthorized, revoked, cross-tenant cases |
| Type checking | Relevant TypeScript/typecheck command |
| Build | Production build when code/config changed |
| Database | Migration/schema validation and clean bootstrap when applicable |
| Frontend | Component/page tests and build when UI changed |
| E2E/manual | Representative flow required by the catalog |
| Operations | Smoke, restore, provider, device, queue, cron, incident evidence |
| Full suite | Shared foundation, high-risk changes, and final gates |

Record exact command, exit code, test count, failures, skips, commit SHA, and environment.

---

## 12. Worker handoff

A worker may report `READY FOR INTEGRATION` only when:

- Branch is clean and committed.
- Scope and completion gates have evidence-backed recommendations.
- Required tests and reviews pass on the final worker commit.
- Run report is complete except integration fields.
- No unaccepted Critical or High finding remains.
- The branch does not contain unrelated or shared-status edits.

The worker final response must state:

- Task ID
- Handoff status
- Branch/worktree
- Base and final commit SHAs
- Major findings and fixes
- Exact test summary
- Run-report path
- Remaining risk/blocker
- Explicit statement: `Not merged to local main`
- Explicit statement: `Nothing pushed or deployed`

A worker branch is not a completed task and cannot be marked `PASS`.

---

## 13. Explicit integration workflow

The owner starts integration with:

```text
<TASK-ID> integrate করো
```

### Integration prerequisites

- Worker branch and worktree exist and are clean.
- Run report says `READY FOR INTEGRATION`, or clearly marks evidence-only `FAIL`/`N/A`.
- Required dependencies are already on local `main`.
- Local `main` is clean.
- No other integration agent holds the merge lock.
- Worker scope and changed files match the task.

### Shared merge lock

Use the normalized common Git directory:

```bash
COMMON_GIT_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
LOCK_DIR="$COMMON_GIT_DIR/ozzyl-main-merge.lock"
mkdir "$LOCK_DIR"
printf '%s\n' "task=<TASK-ID> branch=$(git branch --show-current) pid=${BASHPID:-unknown} started=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCK_DIR/owner"
```

If the lock exists, inspect ownership and do not bypass an active integration. Remove a stale lock only with positive evidence that no owning process/session is active, and record the recovery.

Install cleanup immediately:

```bash
cleanup_merge_lock() { rm -rf "$LOCK_DIR"; }
trap cleanup_merge_lock EXIT INT TERM
```

### Integration sequence

1. Read the task catalog, worker run report, branch diff, and commits.
2. Confirm the worker did not change unrelated files or shared status prematurely.
3. Acquire the merge lock.
4. Locate the worktree holding local `main` and confirm it is clean.
5. Rebase the worker branch onto current local `main`, or merge `main` into it when safer.
6. Resolve conflicts within task scope only.
7. Rerun focused and affected tests on the updated worker branch.
8. Merge with a non-fast-forward commit containing the task ID.
9. On local `main`, rerun required post-merge tests, typecheck/build, and applicable operational checks.
10. Update `TASK_STATUS.md`, `docs/HMS_PRODUCTION_READINESS_TRACKER.md`, and the task run report with actual integration commits and verdict.
11. Create an evidence-only follow-up commit when needed to record the merge SHA.
12. Confirm local `main` is clean.
13. Release the merge lock.
14. Remove the merged task worktree and delete the local task branch only after confirming it is integrated.

Suggested merge commit:

```text
merge(W0-01): integrate platform auth and session review
```

### FAIL or N/A integration

Do not merge unsafe or incomplete implementation merely to finish the workflow. Merge only evidence, safe tests, and independently valid hardening changes. Keep the verdict non-PASS and record the blocker or scope decision.

### Integration failure

If post-merge verification fails:

- Do not push or deploy.
- Preserve evidence.
- Revert the local merge or fix under the same controlled integration process.
- Do not leave local `main` knowingly failing.

---

## 14. Shared status meanings

Only the integration agent updates shared status/tracker files.

- `NOT STARTED` — no active task branch
- `IN PROGRESS` — active worker branch observed
- `BLOCKED` — prerequisite or environmental blocker
- `READY FOR INTEGRATION` — verified worker branch exists; not yet merged
- `INTEGRATING` — integration agent currently owns the merge lock
- `PASS` — merged and post-merge verified
- `PASS WITH ACCEPTED RISK` — merged, verified, and accountable risk accepted
- `FAIL` — review complete but acceptance gates failed
- `N/A FOR THIS HOSPITAL` — accountable hospital-scope exclusion and disabling evidence exist

---

## 15. Wave verification

After all required task integrations for a wave, the owner says:

```text
<WAVE> verify করো
```

The wave verifier must:

1. Confirm required task verdicts and merge commits on local `main`.
2. Confirm dependencies from earlier waves.
3. Run integrated user journeys and reconciliation checks.
4. Run shared authorization, tenant-isolation, retry/idempotency, cancellation/reversal, and failure-path checks.
5. Run applicable build, migration, smoke, restore, and operational gates.
6. Create or update `docs/production-readiness/runs/<WAVE>-INTEGRATION.md`.
7. Report `PASS`, `PASS WITH ACCEPTED RISK`, or `FAIL` for the wave.

Wave verification does not replace task integration.

---

## 16. Completion rules

A worker session completes when a clean branch is handed off with `READY FOR INTEGRATION` or an exact blocker.

A task completes only when:

- Safe implementation/evidence is merged into local `main`.
- Post-merge verification passes for what was merged.
- Shared status, tracker, and run report are updated.
- The final verdict is evidence-backed.

A wave completes only after its required tasks are integrated and wave-level verification passes.

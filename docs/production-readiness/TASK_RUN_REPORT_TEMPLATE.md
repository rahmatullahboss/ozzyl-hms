# [TASK-ID] — [Task Title] Run Report

**Worker status:** `IN PROGRESS`

**Worker/session label:**

**Branch:**

**Worktree:**

**Base branch:** `main`

**Base commit:**

**Started:**

**Worker handoff completed:**

**Worker handoff status:** `NOT SET`

**Integration status:** `NOT STARTED`

**Final task verdict:** `NOT SET`

**Merged to local main:** `NO`

**Merge commit:**

**Pushed/deployed:** `NO`

---

## 1. Task resolution

**Catalog section:**  
**ClickUp task:**  
**Modules:**  
**Dependencies checked:**  
**Parallel-work/conflict check:**

### Included scope

- 

### Explicit exclusions

- 

---

## 2. Mandatory context and skills

### Documents read

- [ ] `agents.md`
- [ ] `.agent-rules/architecture.md`
- [ ] `.agent-rules/coding-rules.md`
- [ ] Task-specific rule files
- [ ] `AGENT_TASK_EXECUTION_PROTOCOL.md`
- [ ] `MANUAL_MULTI_AGENT_RUNBOOK.md`
- [ ] `TASK_CATALOG.md`
- [ ] `TASK_STATUS.md`
- [ ] `HMS_PRODUCTION_READINESS_TRACKER.md`
- [ ] `MODULE_REVIEW_WORKFLOW.md`
- [ ] Existing module review/runbook/plan

### Skills loaded and followed

- [ ] `using-superpowers`
- [ ] `using-git-worktrees`
- [ ] `systematic-debugging` when defects/failures occurred
- [ ] `test-driven-development` for fixes/new behavior
- [ ] `requesting-code-review`
- [ ] `verification-before-completion`
- [ ] `finishing-a-development-branch`
- [ ] Other applicable skills:

---

## 3. Baseline

| Item | Evidence |
|---|---|
| Main/base commit |  |
| Working tree clean |  |
| Dependency setup |  |
| Baseline command |  |
| Baseline result |  |
| Pre-existing failures |  |

---

## 4. Implementation inventory

### Backend/API

- 

### Services/helpers

- 

### Database/migrations

- 

### Frontend/UI

- 

### Permissions/approvals/audit

- 

### Reports/prints/exports

- 

### Integrations/queues/cron/devices/operations

- 

### Existing tests and documents

- 

### Canonical and legacy paths

- 

---

## 5. Findings

| ID | Severity | Finding/root cause | Reproduction/evidence | Decision |
|---|---|---|---|---|
| F-01 |  |  |  |  |

Severity: `Critical`, `High`, `Medium`, or `Low`.

---

## 6. Tests created before fixes

| Finding | Test file/case | Red result | Purpose |
|---|---|---|---|
|  |  |  |  |

---

## 7. Fixes and commits

| Finding | Changed files | Fix summary | Commit SHA |
|---|---|---|---|
|  |  |  |  |

---

## 8. Manual and end-to-end evidence

| Step/scenario | Expected | Actual | Evidence reference | Status |
|---|---|---|---|---|
| Happy path |  |  |  |  |
| Invalid/missing input |  |  |  |  |
| Duplicate/retry |  |  |  |  |
| Cancellation/reversal |  |  |  |  |
| Unauthorized role |  |  |  |  |
| Cross-tenant identifier |  |  |  |  |
| Provider/network/device failure |  |  |  |  |
| Reconciliation |  |  |  |  |

Delete non-applicable rows and add task-specific scenarios.

---

## 9. Review passes

### Requirement and safety review

**Reviewer/agent:**  
**Findings:**

- 

**Resolution:**

- 

### Code quality review

**Reviewer/agent:**  
**Findings:**

- 

**Resolution:**

- 

---

## 10. Fresh verification

| Gate | Command/environment | Result | Evidence |
|---|---|---|---|
| Focused tests |  |  |  |
| Adjacent integration tests |  |  |  |
| Authorization/cross-tenant |  |  |  |
| Typecheck |  |  |  |
| Build |  |  |  |
| Database/bootstrap |  |  |  |
| Frontend/UI |  |  |  |
| E2E/manual |  |  |  |
| Operations/NFR |  |  |  |
| Full suite |  |  |  |

**Final verified commit SHA:**

---

## 11. Acceptance-gate traceability

| Catalog acceptance gate | Evidence | Verdict |
|---|---|---|
|  |  |  |

---

## 12. Residual risk

| Risk | Impact | Mitigation | Accepted by | Review/expiry date |
|---|---|---|---|---|
|  |  |  |  |  |

Critical patient-safety, privacy, tenant-isolation, medication, money, stock, result-integrity, or backup risks cannot be accepted by the worker agent alone.

---

## 13. Worker handoff

Choose exactly one:

- [ ] `READY FOR INTEGRATION`
- [ ] `BLOCKED`
- [ ] `FAIL — EVIDENCE ONLY`
- [ ] `N/A FOR THIS HOSPITAL — EVIDENCE ONLY`

**Final worker commit SHA:**

**Branch clean:**

**Run report complete except integration fields:**

**Not merged to local main:** `YES`

**Nothing pushed or deployed:** `YES`

**Exact handoff note:**


---

## 14. Integration — integration agent only

| Step | Result |
|---|---|
| Worker branch clean and committed |  |
| Worker branch reconciled with current local `main` |  |
| Merge lock acquired |  |
| Main worktree clean |  |
| Merge commit |  |
| Post-merge focused tests |  |
| Post-merge build/typecheck |  |
| `TASK_STATUS.md` updated |  |
| Tracker/review log updated |  |
| Worktree removed |  |

---

## 15. Final verdict

Choose exactly one:

- [ ] `PASS`
- [ ] `PASS WITH ACCEPTED RISK`
- [ ] `FAIL`
- [ ] `N/A FOR THIS HOSPITAL`

### Final summary


### Remaining follow-up


### Local-main merge confirmation


### Remote push/deployment confirmation

No remote push or production deployment is authorized unless separately requested.

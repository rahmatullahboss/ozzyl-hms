# Admin Command Center Program Execution Pack

Date: 2026-07-27
Status: Ready for staged implementation
Design branch: `design/admin-command-center-specs-20260727`
Reviewed base: local `main` at `a4a4c47ac99412a50a6b07bc00765e67f1fd41e2`

## 1. Source documents

### Current-state analysis

- `_bmad-output/evolution/analysis/2026-07-27-admin-command-center-current-state-review.md`

### Approved specifications

- `docs/superpowers/specs/2026-07-27-admin-command-center-program-design.md`
- `docs/superpowers/specs/2026-07-27-admin-command-center-reporting-contract-design.md`
- `design-system/hms-saas/pages/admin-command-center.md`

### Implementation plans

- `docs/superpowers/plans/2026-07-27-admin-dashboard-semantic-foundation.md`
- `docs/superpowers/plans/2026-07-27-admin-dashboard-shell-period-contract.md`
- `docs/superpowers/plans/2026-07-27-admin-financial-control-action-center.md`
- `docs/superpowers/plans/2026-07-27-admin-doctor-commission-explainability.md`
- `docs/superpowers/plans/2026-07-27-admin-invoice-inspector.md`
- `docs/superpowers/plans/2026-07-27-admin-patient-age-analytics.md`

## 2. Execution principles

1. Use a dedicated branch/worktree for each implementation plan.
2. Merge or cherry-pick this documentation commit onto the latest reviewed `main`, then create each implementation branch from that updated `main` so every worker has the controlling specs and plans.
3. Preserve dirty worktree changes and never bulk stage unrelated files.
4. Follow TDD: add focused failing tests, verify RED, implement minimally, verify GREEN.
5. Commit at the task checkpoints defined in each plan.
6. Do not proceed past a failed reconciliation invariant.
7. Do not modify production data or run production migrations without separate authorization.
8. Existing operational/financial tables remain source of truth.
9. Existing Action Center remains queue authority.
10. Patient identity is server-permission-gated.

## 3. Dependency graph

```text
ACC-00 Semantic foundation
  └── ACC-01 Shell and period contract
        ├── ACC-02 Financial control and Action Center
        ├── ACC-03 Doctor and commission explainability
        └── ACC-05 Patient age analytics

ACC-03 Doctor and commission explainability
  └── ACC-04 Shared invoice inspector can consume the richer compensation contract

ACC-01 Shell and period contract
  └── ACC-04 Shared invoice inspector uses URL state and workspace adapters

ACC-02 + ACC-03 + ACC-04 + ACC-05
  └── ACC-06 Program-wide reconciliation, responsive, and release evidence
```

ACC-02 and ACC-03 may run in parallel only after ACC-00 and ACC-01 are stable and only in independent worktrees. ACC-04 should begin after ACC-01 and may use the existing compensation contract, but its compensation tab reaches full definition after ACC-03.

## 4. Recommended serial execution order

### Phase ACC-00 — Semantic foundation

Plan: `2026-07-27-admin-dashboard-semantic-foundation.md`

Outcome:

- Shared temporal/source-health/reconciliation types
- Authoritative metric registry and role presets
- Server-resolved comparison periods
- Bounded versioned overview contract
- Feature-flag-safe parity path

Suggested branch:

```text
program/admin-command-center-semantic-foundation-20260727
```

### Phase ACC-01 — Shell and period

Plan: `2026-07-27-admin-dashboard-shell-period-contract.md`

Outcome:

- Modular workspace shell
- URL state
- Active-workspace query gating
- Compact Overview
- Explicit historical/live semantics

Suggested branch:

```text
program/admin-command-center-shell-20260727
```

### Phase ACC-02 — Financial control and Action Center

Plan: `2026-07-27-admin-financial-control-action-center.md`

Outcome:

- Shared reporting/reconciliation contract
- Four financial control blocks
- Range-aware payment methods and trend
- Existing Action Center as the single queue source

Suggested branch:

```text
program/admin-command-center-financial-control-20260727
```

### Phase ACC-03 — Doctor and commission explainability

Plan: `2026-07-27-admin-doctor-commission-explainability.md`

Outcome:

- Reconciled doctor reporting service
- Activity timeline
- Rule/reason explanation
- Responsive doctor UI
- Stable bill links

Suggested branch:

```text
program/admin-command-center-doctor-explainability-20260727
```

### Phase ACC-04 — Shared invoice inspector

Plan: `2026-07-27-admin-invoice-inspector.md`

Outcome:

- Composite read-only invoice endpoint
- Deep-linkable inspector
- Items/payments/discount/compensation/audit tabs
- Unified invoice opening across admin surfaces

Suggested branch:

```text
program/admin-command-center-invoice-inspector-20260727
```

### Phase ACC-05 — Patient age analytics

Plan: `2026-07-27-admin-patient-age-analytics.md`

Outcome:

- Age-at-service reporting
- Aggregate and drill views
- Patient-detail permission boundary
- Supported Patients workspace and route

Suggested branch:

```text
program/admin-command-center-patient-age-20260727
```

### Phase ACC-06 — Program verification and release evidence

Create this plan only after ACC-00 through ACC-05 are merged to the integration branch.

Outcome:

- Full reconciliation matrix
- Cross-workspace invoice navigation tests
- Responsive evidence
- Accessibility evidence
- Security/privacy evidence
- Performance/query evidence
- Release and rollback notes

Suggested branch:

```text
program/admin-command-center-final-verification-20260727
```

## 5. Branch and worktree commands

For each phase, from the repository root:

```bash
git fetch --all --prune
PHASE_WORKTREE=admin-command-center-semantic-foundation-20260727
PHASE_BRANCH=program/admin-command-center-semantic-foundation-20260727
git worktree add ".worktrees/${PHASE_WORKTREE}" -b "${PHASE_BRANCH}" main
cd ".worktrees/${PHASE_WORKTREE}"
node scripts/check-worktree-policy.mjs -- --mode=task
```

Change the two shell variables to the exact phase values listed above before creating another phase worktree.

Use `pnpm worktree:check -- --mode=task` when dependencies are installed normally. The direct Node command is the same policy script and is acceptable for policy-only verification when dependency bootstrap is unavailable.

Do not copy dependency directories into Git or commit symlinks created only for local execution.

## 6. Shared acceptance matrix

| Capability | ACC-00 | ACC-01 | ACC-02 | ACC-03 | ACC-04 | ACC-05 |
|---|---:|---:|---:|---:|---:|---:|
| Semantic registry and role presets | Produce | Consume | Consume | Consume | Consume | Consume |
| Source health and comparison | Produce | Display | Consume | Consume | Consume | Consume |
| URL period/tab state | Define filter contract | Produce | Consume | Consume | Consume | Consume |
| Live/current labeling | Define temporal mode | Produce | Consume | Consume | Consume | Consume |
| Reconciliation envelope | Produce base | Display | Extend/produce | Produce | Produce | Produce for additive measures |
| Action Center authority | Define drill metadata | Link | Consolidate | No duplicate | No duplicate | No duplicate |
| Doctor activity | Define workspace/drill | Route slot | No change | Produce | Link invoices | Doctor aggregates only |
| Commission bridge | Define metric semantics | Route slot | Liability summary | Produce | Display | No change |
| Invoice deep link | Define stable drill identity | State contract | Open adapter | Open adapter | Produce inspector | Optional linked invoices |
| Patient privacy | Define permission metadata | Preserve | Preserve | Redact timeline | Authorize inspector | Produce guarded details |
| Mobile progressive detail | Define page contract | Shell | Money blocks | Doctor rows | Inspector | Age rows |

## 7. Reconciliation gates

No phase may claim completion when a relevant financial response has a hidden non-zero difference.

Required invariants:

```text
KPI summary total = full matching KPI detail total
Financial control block summary = full matching source total
Doctor payable summary = full matching doctor compensation detail total
Invoice net = gross − discount
Invoice settled = payment applied + deposit applied, subject to existing settlement semantics
Patient additive totals = sum of age buckets
```

When an invariant cannot be computed, the response and UI must state `unavailable` with a reason.

## 8. Verification command families

Each plan lists focused commands. Every phase also runs:

```bash
pnpm exec tsc --noEmit
pnpm --dir web exec tsc --noEmit
pnpm --dir web build
```

When schema changes:

```bash
pnpm migrations:build-manifest
```

Before completion:

```bash
git status --short
git diff --check
git diff --stat main...HEAD
```

## 9. Handoff requirements

At every phase checkpoint, record:

- Branch and worktree path
- Base and head commit
- Completed task numbers
- Tests executed and exact results
- Reconciliation evidence
- Known pre-existing failures
- Dirty files, if any
- Exact next task
- Migration and rollback notes when relevant

Do not use a generic “continue” handoff without an exact next action.

## 10. Stop conditions

Stop and create a clean checkpoint when:

- Source-of-truth semantics conflict between existing services
- Summary/detail difference is non-zero and unexplained
- A migration number conflicts
- Patient privacy cannot be enforced server-side
- Canonical/legacy provider selection becomes ambiguous
- A task would require production mutation or authorization
- The current worktree contains unrelated changes that cannot be isolated safely

## 11. Program completion

The program completes only after ACC-06 confirms:

- All six implementation phase plans, ACC-00 through ACC-05, are merged and verified
- No duplicate dashboard action queue remains
- All supported invoice links use the common inspector
- Selected-period and live/current data are never silently mixed
- Doctor compensation displays the full explanation and reason
- Patient age analytics uses service date and enforces privacy
- Financial totals reconcile or visibly report why they do not

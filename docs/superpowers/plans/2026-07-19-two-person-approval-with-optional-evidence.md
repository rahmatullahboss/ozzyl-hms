# Two-Person Approval with Optional Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require two distinct authorized approvers before any approval-controlled business action executes, while treating missing supporting evidence as a visible warning instead of an approval blocker.

**Architecture:** Keep `approval_requests.status` as the single lifecycle authority (`pending`, `partially_approved`, `approved`, `rejected`). Persist each distinct approval decision in an immutable tenant-scoped `approval_decisions` table and derive progress from those rows. Route every approval surface through one central policy service so core requests, bulk/quick review, expenses, cash handovers, refunds, payment reversals, and bill cancellations cannot bypass the two-person rule; execute guarded side effects only after the atomic transition to the second approval.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Drizzle schema definitions, React, TanStack Query, Vitest, Testing Library.

## Global Constraints

- Supporting evidence is optional for authorized approval; missing evidence is a warning, not a hard blocker.
- Exactly two distinct authorized approvers are required for every approval-controlled action.
- Authorized approver roles are `hospital_admin`, `md`, `director`, and future-compatible `ceo`; existing `super_admin` may act only where tenant-scoped middleware already permits it.
- The requester cannot approve their own request.
- The same user cannot contribute both approvals.
- The first approval produces `partially_approved` and must not execute the business side effect.
- The second distinct approval produces `approved` and may execute the business side effect exactly once.
- Reject and Request Info remain available from `pending` and `partially_approved`.
- Bulk and quick approval must call the same central policy and can contribute only one decision per approver.
- Approval decisions and approval events are immutable audit facts.
- Existing historical `approved` rows remain readable as fully approved without inventing approver identities.
- Tenant isolation, concurrency safety, and execution idempotency are mandatory.
- No production migration, deployment, traffic change, feature-flag change, main merge, or push is part of this plan.

---

## File Structure

- Create `migrations/0516_two_person_approval_policy.sql`: additive D1 schema for immutable decisions and approval progress columns; historical compatibility backfill.
- Modify `src/db/schema/approval-requests.ts`: Drizzle representation of new columns and decision table.
- Create `src/services/approvals/two-person-policy.ts`: central policy types, role checks, atomic decision recording, progress projection, and final-transition result.
- Create `test/services/two-person-approval-policy.test.ts`: pure policy and SQL/DB behavior tests, including concurrency and tenant isolation.
- Modify `src/routes/tenant/approvals.ts`: core, bulk, quick-compatible review, reject, Request Info, retry, response enrichment, and exactly-once execution.
- Modify `src/routes/tenant/expenses.ts`: route expense approval through the shared decision service and delay status mutation until 2/2.
- Modify `src/routes/tenant/billingCounter.ts`: route cash-handover admin verification through the same decision service and delay final verification until 2/2.
- Modify `src/services/actionCenter/approvalSummary.ts`: expose approval progress for synthetic/mixed-source rows.
- Modify `web/src/pages/admin/PendingApprovals.tsx`: progress fields, optional-evidence behavior, status labels, quick/bulk semantics, and success feedback.
- Modify `web/src/components/admin/ApprovalDetailDrawer.tsx`: show 0/2, 1/2, 2/2; warning-only evidence; duplicate/self approval reason.
- Modify focused backend and frontend tests.
- Modify `task-progress.yaml`: record implementation/test truth only after verification.

---

### Task 1: Add Additive Approval Decision Schema

**Files:**
- Create: `migrations/0516_two_person_approval_policy.sql`
- Modify: `src/db/schema/approval-requests.ts`
- Test: `test/services/two-person-approval-policy.test.ts`

**Interfaces:**
- Produces table `approval_decisions(tenant_id, approval_source, approval_request_id, approver_id, approver_role, decision, notes, created_at)`.
- Produces request columns `required_approvals`, `approval_count`, `first_approved_at`, `fully_approved_at`.
- Enforces one approval decision per tenant/source/request/approver.

- [ ] **Step 1: Write a failing schema contract test**

Assert that the migration:

```ts
expect(sql).toContain('CREATE TABLE IF NOT EXISTS approval_decisions');
expect(sql).toContain('UNIQUE (tenant_id, approval_source, approval_request_id, approver_id)');
expect(sql).toContain('ADD COLUMN required_approvals INTEGER NOT NULL DEFAULT 2');
expect(sql).toContain("status = 'approved'");
expect(sql).toContain('approval_count = 2');
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run test/services/two-person-approval-policy.test.ts`

Expected: FAIL because migration/service do not exist.

- [ ] **Step 3: Add the migration**

Use additive statements only:

```sql
ALTER TABLE approval_requests ADD COLUMN required_approvals INTEGER NOT NULL DEFAULT 2;
ALTER TABLE approval_requests ADD COLUMN approval_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approval_requests ADD COLUMN first_approved_at TEXT;
ALTER TABLE approval_requests ADD COLUMN fully_approved_at TEXT;

CREATE TABLE IF NOT EXISTS approval_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_source TEXT NOT NULL DEFAULT 'approval_requests',
  approval_request_id INTEGER NOT NULL,
  approver_id INTEGER NOT NULL,
  approver_role TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'approve',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_source, approval_request_id, approver_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_decisions_request
  ON approval_decisions (tenant_id, approval_source, approval_request_id, created_at);

UPDATE approval_requests
SET required_approvals = 2,
    approval_count = 2,
    first_approved_at = COALESCE(first_approved_at, reviewed_at, created_at),
    fully_approved_at = COALESCE(fully_approved_at, reviewed_at, created_at)
WHERE status = 'approved' AND approval_count = 0;
```

Do not create synthetic decision rows for historical approvals.

- [ ] **Step 4: Update the Drizzle schema**

Add matching columns and an `approvalDecisions` table with the same unique/index contract.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run test/services/two-person-approval-policy.test.ts`

Expected: schema contract PASS.

- [ ] **Step 6: Commit**

```bash
git add migrations/0516_two_person_approval_policy.sql src/db/schema/approval-requests.ts test/services/two-person-approval-policy.test.ts
git commit -m "feat(approvals): add two-person decision schema"
```

---

### Task 2: Implement Central Two-Person Policy Service

**Files:**
- Create: `src/services/approvals/two-person-policy.ts`
- Modify: `test/services/two-person-approval-policy.test.ts`

**Interfaces:**
- Produces `isTwoPersonApproverRole(role: string): boolean`.
- Produces `approvalStage(status, approvalCount, requiredApprovals)`.
- Produces `recordApprovalDecision(db, input): Promise<ApprovalDecisionResult>`.
- `ApprovalDecisionResult` includes `status`, `approvalCount`, `requiredApprovals`, `becameFullyApproved`, `alreadyApprovedByActor`, and `decisionId`.

- [ ] **Step 1: Add failing pure-policy tests**

Cover:

```ts
expect(isTwoPersonApproverRole('hospital_admin')).toBe(true);
expect(isTwoPersonApproverRole('md')).toBe(true);
expect(isTwoPersonApproverRole('director')).toBe(true);
expect(isTwoPersonApproverRole('ceo')).toBe(true);
expect(isTwoPersonApproverRole('manager')).toBe(false);
expect(approvalStage('partially_approved', 1, 2).label).toBe('Partially Approved (1/2)');
expect(approvalStage('approved', 2, 2).label).toBe('Fully Approved (2/2)');
```

- [ ] **Step 2: Add failing database behavior tests**

Use a deterministic D1 mock to verify:

- first distinct approval inserts one decision, sets count 1/status `partially_approved`, and returns `becameFullyApproved: false`;
- second distinct approval sets count 2/status `approved` and returns `becameFullyApproved: true`;
- requester approval returns a typed `SELF_APPROVAL_BLOCKED` error;
- duplicate approver returns `DUPLICATE_APPROVER` without changing count;
- wrong tenant cannot see or mutate the request;
- two concurrent second-approval attempts produce one final transition only.

- [ ] **Step 3: Implement pure helpers and typed errors**

Use explicit error codes and no message parsing in routes.

- [ ] **Step 4: Implement atomic decision recording**

Use a single D1 batch containing:

1. conditional immutable insert into `approval_decisions` only when the request belongs to the tenant, is `pending` or `partially_approved`, requester differs, and no actor decision exists;
2. update `approval_requests.approval_count` from the decision count and set status/time columns;
3. re-read request progress and actor decision.

The service must treat zero inserted rows as self, duplicate, terminal, or missing based on read-only follow-up checks. `becameFullyApproved` is true only when this call inserted the actor decision and the request atomically reached exactly the required count.

- [ ] **Step 5: Run focused service tests**

Run: `pnpm vitest run test/services/two-person-approval-policy.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/approvals/two-person-policy.ts test/services/two-person-approval-policy.test.ts
git commit -m "feat(approvals): centralize two-person policy"
```

---

### Task 3: Convert Core Review and Side-Effect Execution

**Files:**
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `test/integration/routes/approvals.test.ts`
- Modify: `test/integration/routes/refund-approval-cash-holds.test.ts`

**Interfaces:**
- Consumes `recordApprovalDecision`.
- API responses expose `approval_count`, `required_approvals`, `approval_stage`, `remaining_approvals`, `current_user_approved`, and `can_current_user_approve`.
- Side effects continue using existing `markApprovalExecutionStarted`/succeeded/failed guards.

- [ ] **Step 1: Add failing route tests**

Cover:

- first approval response is `partially_approved`, 1/2, no execution-start event and no business mutation;
- second distinct approval response is `approved`, 2/2, side effect executed once;
- duplicate actor gets HTTP 409;
- requester gets HTTP 403;
- missing evidence still allows first and second approval;
- reject works from `partially_approved` and releases held refund cash;
- Request Info works from `partially_approved` without deleting prior decisions;
- execution failure leaves approval fully approved with `execution_status='failed'` and supports existing retry semantics;
- historical approved row reports 2/2 even with no decision rows.

- [ ] **Step 2: Run focused integration tests and verify failure**

Run:

```bash
pnpm vitest run test/integration/routes/approvals.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
```

Expected: new two-person tests FAIL.

- [ ] **Step 3: Enrich list/detail responses**

Normalize legacy rows:

```ts
const requiredApprovals = Number(row.required_approvals ?? 2);
const approvalCount = row.status === 'approved'
  ? Math.max(requiredApprovals, Number(row.approval_count ?? 0))
  : Number(row.approval_count ?? 0);
```

Missing evidence remains `evidence_status='missing'` but is not included in `isApprovalDecisionBlocked`.

- [ ] **Step 4: Replace single-approval execution in PUT review**

For approve:

1. validate authorized two-person role;
2. call `recordApprovalDecision`;
3. append immutable approval event with progress metadata;
4. return immediately after 1/2 without execution;
5. only when `becameFullyApproved` is true, claim and execute side effect;
6. keep existing exactly-once execution lock and audit behavior.

For reject/request-info, accept both `pending` and `partially_approved` and never delete decision rows.

- [ ] **Step 5: Convert bulk review**

Each selected request calls the same central service. One bulk action by one user contributes at most one approval per request. No business side effect may run after only 1/2.

- [ ] **Step 6: Run focused integration tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/tenant/approvals.ts test/integration/routes/approvals.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
git commit -m "feat(approvals): require two distinct reviewers"
```

---

### Task 4: Apply the Same Policy to Expenses and Cash Handovers

**Files:**
- Modify: `src/routes/tenant/expenses.ts`
- Modify: `src/routes/tenant/billingCounter.ts`
- Modify: `src/services/actionCenter/approvalSummary.ts`
- Modify: focused expense and billing-counter tests.

**Interfaces:**
- Uses generic `approval_source` values `expenses` and `billing_handovers` in `approval_decisions`.
- Synthetic source progress is keyed by tenant/source/entity ID.

- [ ] **Step 1: Add failing expense tests**

Verify first approver leaves expense in pending operational state and returns 1/2; second distinct approver changes expense approval status to approved; same actor cannot approve twice; requester cannot approve; missing receipt/evidence is warning-only.

- [ ] **Step 2: Add failing cash-handover tests**

Verify first admin verification returns 1/2 and does not finalize custody; second distinct authorized verifier finalizes once; concurrent second approvals cannot double-post accounting/cash events.

- [ ] **Step 3: Implement source-generic decision recording**

For synthetic sources, pass explicit requester ID and current status into the central service while persisting decisions under the source/entity key. The final domain-table mutation remains inside each existing route and runs only when `becameFullyApproved` is true.

- [ ] **Step 4: Expose progress in Action Center rows**

Return the same progress fields for core, expense, and handover sources so the UI does not infer policy from source type.

- [ ] **Step 5: Run focused tests**

Run expense, billing-counter, handover, and Action Center test files.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/expenses.ts src/routes/tenant/billingCounter.ts src/services/actionCenter/approvalSummary.ts test
git commit -m "feat(approvals): enforce dual review across sources"
```

---

### Task 5: Update Approval Center UI

**Files:**
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.test.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.test.tsx`

**Interfaces:**
- Consumes backend progress and eligibility fields.
- Displays exact copy `Pending`, `Partially Approved (1/2)`, and `Fully Approved (2/2)`.

- [ ] **Step 1: Add failing frontend tests**

Cover:

- missing evidence renders a warning and Approve remains available;
- 1/2 status badge and remaining approver message;
- 2/2 final status;
- requester/self and duplicate approver disabled reasons;
- first approval success toast says one more approver is required;
- quick approval with missing evidence still sends one approval through the shared endpoint;
- bulk action does not claim requests are fully approved when it only records first approvals.

- [ ] **Step 2: Remove evidence from hard-block logic**

`isDecisionBlocked` must include only execution failure and active Request Info. Keep missing evidence KPI/filter and warning copy.

- [ ] **Step 3: Add progress fields and labels**

Extend API/UI types with:

```ts
approvalCount?: number;
requiredApprovals?: number;
approvalStage?: string;
remainingApprovals?: number;
currentUserApproved?: boolean;
canCurrentUserApprove?: boolean;
approvalBlockedReason?: string | null;
```

- [ ] **Step 4: Update drawer and list behavior**

Buttons remain visible for missing evidence. Disable only when the API says the current actor is requester, already approved, unauthorized, terminal, or Request Info/execution state blocks the action.

- [ ] **Step 5: Run focused frontend tests**

Run:

```bash
pnpm --dir web vitest run src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/admin/PendingApprovals.tsx web/src/components/admin/ApprovalDetailDrawer.tsx web/src/pages/admin/PendingApprovals.test.tsx web/src/components/admin/ApprovalDetailDrawer.test.tsx
git commit -m "feat(approvals): show two-person approval progress"
```

---

### Task 6: Full Regression, Governance, and Tracker Update

**Files:**
- Modify: `task-progress.yaml`
- Modify documentation only if test results reveal an explicit exception.

- [ ] **Step 1: Run backend focused and regression tests**

```bash
pnpm vitest run test/services/two-person-approval-policy.test.ts test/integration/routes/approvals.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
pnpm test
```

Expected: PASS; no existing test weakened or deleted.

- [ ] **Step 2: Run frontend focused and regression tests**

```bash
pnpm --dir web vitest run src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx
pnpm --dir web test
```

Expected: PASS.

- [ ] **Step 3: Run type checks and production builds**

```bash
pnpm typecheck
pnpm build
pnpm --dir web build
```

Expected: PASS.

- [ ] **Step 4: Run canonical governance only if canonical files were touched**

No canonical files are planned. If any are touched, run the existing canonical governance command before commit.

- [ ] **Step 5: Update tracker truth**

Record implementation commit(s), exact tests, and that no production migration/deployment occurred. Preserve the current CDB-101 reconciliation blocker and manual authorized-action blocker until independently resolved.

- [ ] **Step 6: Review changes**

Use `show_changes` once. Confirm `.ai-bridge/*` and unrelated dirty files are excluded.

- [ ] **Step 7: Final commit**

```bash
git add task-progress.yaml docs/superpowers/plans/2026-07-19-two-person-approval-with-optional-evidence.md
git commit -m "docs(approvals): record dual-review implementation"
```

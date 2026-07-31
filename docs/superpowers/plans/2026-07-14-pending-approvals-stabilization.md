# Pending Approvals Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Keep exact-count cash handovers out of Pending Approval, keep true disputes actionable, and make Approval Center filters/actions match the records they describe.

**Architecture:** `billing_handovers` remains the cash custody source of truth. The receiver-accept write path decides whether a human decision is required: clean counts complete immediately, while variance or explicit disputes remain `pending_admin`. `/api/approvals` stays an adapter over multiple source tables, but its handover adapter will expose only decision-required exceptions in Pending and will treat stored receiver-count facts as system evidence.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Vitest, React, TanStack Query.

## Global Constraints

- Preserve current route boundaries and existing audit/event writes.
- Use conditional D1 updates so stale/concurrent transitions cannot report success.
- Compare cash amounts after monetary rounding; explicit dispute text always requires admin review.
- Do not add a new approval platform or multi-level workflow in this stabilization.
- Do not modify unrelated existing E2E report/auth-state changes in the dirty worktree.

---

### Task 1: Correct cash handover decision eligibility

**Files:**
- Modify: `test/integration/routes/billing-counter-handover-admin-verification.test.ts`
- Modify: `src/routes/tenant/billingCounter.ts`

**Interfaces:**
- Consumes: existing `POST /api/billing-counter/handovers/:handoverId/accept` request `{ receivedAmount, remarks, disputeReason? }`.
- Produces: clean response `{ status: 'received', finalVerificationStatus: 'not_required' }`; disputed response `{ status: 'disputed', finalVerificationStatus: 'pending_admin' }`.

- [x] **Step 1: Write failing clean-count test**

Replace the old zero-variance expectation with assertions that a 1500/1500 count completes immediately, stores `status='received'`, stores a null admin-verification status, and does not mention admin final verification.

- [x] **Step 2: Write failing dispute test**

Add a test submitting `receivedAmount: 1450` and a dispute reason. Assert `status='disputed'`, `finalVerificationStatus='pending_admin'`, and SQL parameters include the `-50` variance.

- [x] **Step 3: Run the focused route test and verify RED**

Run: `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/billing-counter-handover-admin-verification.test.ts`

Expected: the clean-count test fails because current code returns `receiver_verified/pending_admin`; the dispute test should document the branch that must remain pending.

- [x] **Step 4: Implement one state decision in every accept branch**

Use one rounded variance and derive:

```ts
const variance = roundMoney(Number(data.receivedAmount) - expectedReceived);
const hasDispute = variance !== 0 || Boolean(data.disputeReason?.trim());
const receiverStatus = hasDispute ? 'disputed' : 'received';
const adminVerificationStatus = hasDispute ? HANDOVER_ADMIN_VERIFICATION_PENDING : null;
const responseVerificationStatus = hasDispute ? HANDOVER_ADMIN_VERIFICATION_PENDING : 'not_required';
```

Bind `adminVerificationStatus` in all handover update branches and return `responseVerificationStatus`. Keep receiver verification events and general audit logs for both branches.

- [x] **Step 5: Run focused route test and verify GREEN**

Run the same command and expect all tests in the file to pass.

---

### Task 2: Make Pending contain only cash discrepancies and keep clean history visible

**Files:**
- Modify: `test/integration/routes/approvals.test.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Create: `migrations/0423_repair_clean_cash_handover_pending_approvals.sql`

**Interfaces:**
- Consumes: `billing_handovers.status`, `receiver_counted_amount`, `receiver_variance`, `admin_verification_status`.
- Produces: pending adapter rows only for `disputed` or non-zero-variance handovers; approved/history adapter rows for clean completed handovers.

- [x] **Step 1: Write failing adapter tests**

Add/replace tests proving:

```text
receiver_verified + variance 0 + pending_admin -> not returned by status=pending
received + variance 0 + admin_verification_status NULL -> returned by status=approved as completed/no approval required
disputed + variance non-zero + pending_admin -> returned by status=pending
```

- [x] **Step 2: Add failing system-evidence assertion**

For the disputed row assert:

```ts
expect(row.evidence_required).toBe(true);
expect(row.evidence_status).toBe('provided');
expect(row.request_data.variance).toBe(-50);
```

- [x] **Step 3: Run focused approvals tests and verify RED**

Run: `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts`

Expected: clean legacy row is currently pending; completed-null row is not mapped as approved; handover evidence is currently missing.

- [x] **Step 4: Tighten adapter conditions**

Define a reusable SQL discrepancy expression based on rounded/non-zero `receiver_variance` with a counted-minus-expected fallback. Pending condition must require `pending_admin` and either `status='disputed'` or a non-zero discrepancy. Approved/history condition must include admin-verified handovers and clean `status='received'` handovers whose admin verification is null.

- [x] **Step 5: Normalize clean/disputed mapping**

`toFinalHandoverApproval` must map clean received/null rows to `approved` history with reason `Cash handover completed with no variance; admin approval was not required`. Pending rows must use reason `Cash variance/dispute requires admin decision`.

- [x] **Step 6: Recognize system-generated handover evidence**

Add:

```ts
function hasSystemCashHandoverEvidence(requestData: Record<string, unknown>): boolean {
  return firstFiniteNumber(requestData.expectedAmount) !== undefined
    && firstFiniteNumber(requestData.countedAmount) !== undefined
    && firstFiniteNumber(requestData.variance) !== undefined
    && Boolean(requestData.receivedAt || requestData.receivedBy);
}
```

When type is `cash_handover`, return `provided` if this evidence exists; external attachment URLs remain optional.

- [x] **Step 7: Add legacy repair migration**

Create migration `0423` that changes only legacy counter handovers with `receiver_verified`, `pending_admin`, and zero derived variance to `status='received'`, clears `admin_verification_status`, and adds an auto-completion remark. Existing receiver verification events remain the audit record.

- [x] **Step 8: Run focused approvals tests and verify GREEN**

Run the same approvals test command and expect all tests to pass.

---

### Task 3: Remove Approval Center dead ends and make Cash Handover card deterministic

**Files:**
- Modify: `web/src/pages/admin/PendingApprovals.test.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`

**Interfaces:**
- Consumes: normalized `evidence_status`, `request_data.variance`, and current status/type filters.
- Produces: Cash Handover KPI always opens Pending + Cash Handover with conflicting health filters cleared; blocked actions show an explicit recovery message.

- [x] **Step 1: Write failing Cash Handover KPI test**

Start from Approved status with a health filter active, click the Cash Handover KPI, and assert the requested URL becomes:

```text
/api/approvals?status=pending&limit=50&page=1&type=cash_handover
```

- [x] **Step 2: Write failing drawer evidence test**

Render a disputed cash handover with `evidenceStatus='provided'` and assert Approve is enabled. Render a truly missing-evidence handover and assert the blocker says the receiver must recount/reject rather than suggesting an unavailable Request Info action.

- [x] **Step 3: Run focused web tests and verify RED**

Run: `pnpm --filter web exec vitest run src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx`

- [x] **Step 4: Implement one Cash Handover navigation handler**

The handler must call `setStatus('pending')`, clear `kpiFilter`, select `Cash Handover`, clear bulk selection, and reset page to 1.

- [x] **Step 5: Make drawer recovery text type-aware**

For cash handover missing evidence, explain that the item must be rejected for receiver recount/correction. Do not offer Request Info when that action is unavailable.

- [x] **Step 6: Run focused web tests and verify GREEN**

Run the same web test command and expect all tests to pass.

---

### Task 4: Verification gate

**Files:**
- Review only: all files changed by Tasks 1-3.

- [x] **Step 1: Run backend targeted suite**

Run: `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/billing-counter-handover-admin-verification.test.ts test/integration/routes/approvals.test.ts`

- [x] **Step 2: Run frontend targeted suite**

Run: `pnpm --filter web exec vitest run src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx`

- [x] **Step 3: Run TypeScript/build validation**

Run: `pnpm --filter web build`

Run: `pnpm exec tsc --noEmit`

- [x] **Step 4: Review diff and confirm scope**

Confirm no unrelated E2E auth/report artifacts were modified by this implementation and no production completion claim is made unless all fresh verification commands pass.

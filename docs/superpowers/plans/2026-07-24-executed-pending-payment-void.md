# Executed-Pending Payment Void Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reverse cash payments immediately when reception submits a void request, keep the bill collectible as due, and make later approval/rejection review-only while supporting legacy, shadow, and canonical strict modes.

**Architecture:** Extract the payment-reversal mutation into a focused service that accepts additional authoritative statements. The approval request insert joins the reversal statement set so legacy and canonical strict execution remain atomic. Executed-pending requests store `execution_status='succeeded'`; approval performs no financial side effect, while rejection atomically creates an operational payment-void dispute.

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare D1, Vitest, React Query, existing canonical `payment.reverse` command and strict-financial policy.

## Global Constraints

- Start from reviewed local `main` commit `ee2c367a0de92b278a9edc964b0da90c7b275294` in branch `feat/executed-pending-payment-void-20260724`.
- Preserve original positive payment rows; reversals are new negative rows.
- New executed-pending behavior is limited to cash receipts.
- Historical pending payment-void approvals retain approval-time execution compatibility.
- Paid doctor/performer compensation blocks the void instead of creating an unsupported clawback.
- Admin approval/rejection must never create a second payment reversal.
- Rejection keeps the bill due and creates only operational dispute state; it must not create a second accounting receivable.
- Use exact-file staging and checkpoint commits.
- Do not push, deploy, apply production migrations, or change production flags.

---

### Task 1: Payment-void dispute persistence

**Files:**
- Create: `migrations/0536_executed_pending_payment_void.sql`
- Modify: `src/db/schema/schema.ts`
- Modify: `tenant-schema.sql`
- Test: `test/payment-void-dispute-schema.test.ts`

**Interfaces:**
- Produces table `billing_payment_void_disputes` with unique tenant-scoped approval/payment identities.
- Produces statuses `open | resolved | written_off`.

- [ ] **Step 1: Write the failing schema test**

Assert the migration and both schema baselines contain:

```ts
expect(migration).toContain('CREATE TABLE billing_payment_void_disputes');
expect(migration).toContain('UNIQUE (tenant_id, approval_request_id)');
expect(migration).toContain('UNIQUE (tenant_id, payment_id)');
expect(migration).toContain("status IN ('open','resolved','written_off')");
```

- [ ] **Step 2: Run the schema test and verify failure**

Run: `pnpm exec vitest run test/payment-void-dispute-schema.test.ts`
Expected: FAIL because migration/table declarations do not exist.

- [ ] **Step 3: Add the migration and schema declarations**

Create columns:

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT,
tenant_id TEXT NOT NULL,
approval_request_id INTEGER NOT NULL,
payment_id INTEGER NOT NULL,
bill_id INTEGER NOT NULL,
reversal_payment_id INTEGER,
reversal_receipt_no TEXT NOT NULL,
requester_user_id INTEGER NOT NULL,
accountable_employee_id INTEGER NOT NULL,
counter_id INTEGER,
counter_session_id INTEGER,
amount REAL NOT NULL CHECK (amount > 0),
payment_method TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','written_off')),
rejection_reason TEXT NOT NULL,
rejected_by INTEGER NOT NULL,
rejected_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
resolved_by INTEGER,
resolved_at TEXT,
resolution_notes TEXT,
created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
UNIQUE (tenant_id, approval_request_id),
UNIQUE (tenant_id, payment_id)
```

Add tenant/status and accountable-employee/status indexes.

- [ ] **Step 4: Run the schema test and worktree policy**

Run: `pnpm exec vitest run test/payment-void-dispute-schema.test.ts`
Expected: PASS.

Run: `pnpm worktree:check -- --mode=task --allow-dirty`
Expected: `WORKTREE_POLICY_OK`.

- [ ] **Step 5: Commit**

```bash
git add migrations/0536_executed_pending_payment_void.sql src/db/schema/schema.ts tenant-schema.sql test/payment-void-dispute-schema.test.ts
git commit -m "feat(approval): add payment void dispute state"
```

### Task 2: Reusable legacy/canonical payment reversal service

**Files:**
- Create: `src/lib/payment-void-execution.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Test: `test/unit/payment-void-execution.test.ts`
- Test: `test/integration/routes/approvals.test.ts`

**Interfaces:**
- Produces:

```ts
export type PaymentVoidExecutionInput = {
  tenantId: string;
  paymentId: number;
  actorUserId: number;
  reason: string;
  additionalAuthoritativeStatements?: readonly D1PreparedStatement[];
};

export type PaymentVoidExecutionResult = {
  paymentId: number;
  billId: number;
  reversalReceiptNo: string;
  originalAmount: number;
  originalReceivedBy: number;
  counterId: number | null;
  counterSessionId: number | null;
  newPaid: number;
  due: number;
  status: 'paid' | 'partially_paid' | 'open';
  executionMode: 'legacy' | 'shadow' | 'strict';
};

export async function executePaymentVoidReversal(
  env: Env,
  input: PaymentVoidExecutionInput,
): Promise<PaymentVoidExecutionResult>;
```

- Consumes existing `executeStrictFinancialMutation`, `resolveLivePaymentReversalProjection`, `reversePayment`, accounting-period validation, and strict boundary `payment.reverse`.

- [ ] **Step 1: Write failing unit tests**

Cover:

```ts
it('attributes cash reversal to the original payment receiver');
it('passes additional authoritative statements into strict payment reversal');
it('blocks a bill with paid doctor commission or performer reserve');
it('rejects non-cash payment for executed-pending use');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run test/unit/payment-void-execution.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Extract the reversal implementation**

The service must:

```ts
const legacyStatements = [
  ...input.additionalAuthoritativeStatements ?? [],
  reversalPaymentInsert,
  billBalanceUpdate,
  legacyIncomeReversal,
  employeeCashTransactionBoundToOriginalReceivedBy,
];

const mutation = await executeStrictFinancialMutation({
  db: env.DB,
  tenantId: input.tenantId,
  boundary: 'payment.reverse',
  legacyStatements,
  canonical: async (options) => reversePayment(
    env.DB,
    await resolveLivePaymentReversalProjection(env.DB, authority),
    options,
  ),
});
```

Before mutation, query both `diagnostic_performer_reserves` and `doctor_commission_accruals` for `status='paid'`; return `409` when present.

- [ ] **Step 4: Replace old approval-time implementation with the service**

`executePaymentVoidApproval` remains as a compatibility wrapper:

```ts
await executePaymentVoidReversal(env, {
  tenantId,
  paymentId,
  actorUserId: Number(userId),
  reason,
});
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm exec vitest run test/unit/payment-void-execution.test.ts test/integration/routes/approvals.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payment-void-execution.ts src/routes/tenant/approvals.ts test/unit/payment-void-execution.test.ts test/integration/routes/approvals.test.ts
git commit -m "refactor(billing): centralize payment void reversal"
```

### Task 3: Execute payment void during request creation

**Files:**
- Modify: `src/schemas/approval.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Test: `test/integration/routes/approvals.test.ts`

**Interfaces:**
- `payment_void` requires `idempotencyKey`.
- New request data adds:

```ts
{
  executionMode: 'executed_pending',
  financialState: 'reversed_pending_review',
  disputeStatus: 'not_required',
  paymentVoidIdempotencyKey: string,
  paymentVoidRequestHash: string,
  originalPaymentId: number,
  originalReceivedBy: number,
  billId: number,
  reversalReceiptNo: string,
  billPaidAfter: number,
  billDueAfter: number,
  billStatusAfter: string
}
```

- [ ] **Step 1: Add failing request-route tests**

Cover:

```ts
it('executes a cash payment void while creating the pending approval');
it('stores execution_status succeeded and executed_pending request data');
it('returns exact idempotent replay without another reversal');
it('rejects idempotency key reuse with a different payload');
it('rejects non-cash executed-pending payment void');
```

Verify query ordering: approval insert is part of the authoritative mutation statement set and only one negative payment insert occurs.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts`
Expected: FAIL on the new request-time expectations.

- [ ] **Step 3: Require idempotency for payment void**

Extend the schema refinement:

```ts
if (data.type === 'payment_void' && !data.idempotencyKey) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Idempotency key is required for payment void requests',
    path: ['idempotencyKey'],
  });
}
```

- [ ] **Step 4: Add the special request path**

Before the generic duplicate insert:

1. Resolve exact idempotency replay from `request_data.paymentVoidIdempotencyKey`.
2. Validate request hash.
3. Load payment snapshot.
4. Build canonical request data.
5. Create the approval insert with `execution_status='succeeded'`.
6. Call `executePaymentVoidReversal` with the approval insert as an additional authoritative statement.
7. Query the created approval and reversal rows by idempotency/external reference.
8. Record created and execution-succeeded approval events.
9. Return HTTP 201 with `executed: true`, approval, reversal, and bill due state.

- [ ] **Step 5: Run focused tests**

Run: `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/approval.ts src/routes/tenant/approvals.ts test/integration/routes/approvals.test.ts
git commit -m "feat(billing): execute payment void before approval"
```

### Task 4: Make approval review-only and rejection disputed

**Files:**
- Modify: `src/routes/tenant/approvals.ts`
- Test: `test/integration/routes/approvals.test.ts`

**Interfaces:**
- Produces helper:

```ts
function isExecutedPendingPaymentVoid(request: unknown): boolean;
```

- Rejection inserts `billing_payment_void_disputes` and updates request data in one D1 batch.

- [ ] **Step 1: Add failing review tests**

Cover:

```ts
it('approves executed-pending payment void without a second reversal');
it('rejects executed-pending payment void and opens one dispute');
it('keeps execution_status succeeded after rejection');
it('keeps historical payment void approval-time execution');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts`
Expected: FAIL because executed-pending requests still enter the generic execution path and rejection has no dispute behavior.

- [ ] **Step 3: Skip financial execution for executed-pending requests**

Update:

```ts
function approvalRequiresExecution(request: any): boolean {
  if (isExecutedPendingPaymentVoid(request)) return false;
  // existing behavior
}
```

On final approval, update request data to `financialState='approved_reversal'` without changing financial tables.

- [ ] **Step 4: Add rejection dispute batch**

For executed-pending payment void rejection, batch:

```sql
UPDATE approval_requests
SET status='rejected', execution_status='succeeded', request_data=?, reviewed_by=?, reviewed_at=..., review_notes=?
WHERE ... status IN ('pending','partially_approved') AND execution_status='succeeded';

INSERT INTO billing_payment_void_disputes (...)
SELECT ... FROM approval_requests
WHERE tenant_id=? AND id=? AND status='rejected'
ON CONFLICT(tenant_id, approval_request_id) DO NOTHING;
```

Then record approval/audit events and return the dispute identity/status.

- [ ] **Step 5: Run focused tests**

Run: `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/approvals.ts test/integration/routes/approvals.test.ts
git commit -m "feat(approval): review executed payment voids without replay"
```

### Task 5: Reception UI and cache reconciliation

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Modify: `web/src/components/reception/ReceptionPatientDrawer.test.tsx`

**Interfaces:**
- Sends `idempotencyKey: payment-void-<paymentId>-<uuid>`.
- Uses success response `{ executed?: boolean; reversal?: ... }`.

- [ ] **Step 1: Add failing UI source/render tests**

Assert:

```ts
expect(source).toContain('idempotencyKey: `payment-void-${paymentReviewTarget.id}-${crypto.randomUUID()}`');
expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['bills', 'due'] })");
expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] })");
```

- [ ] **Step 2: Run the UI test and verify failure**

Run: `pnpm --filter web exec vitest run src/components/reception/ReceptionPatientDrawer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Update request and success handling**

Send the idempotency key. In the mutation success callback, when `executed` is true:

- show `Payment reversed and sent for admin review`;
- invalidate patient context, billing, active session, pending bills, pending appointments, due bills, and approvals.

Keep the generic approval-submitted message for non-executed approval request types.

- [ ] **Step 4: Run UI tests**

Run: `pnpm --filter web exec vitest run src/components/reception/ReceptionPatientDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/reception/ReceptionPatientDrawer.tsx web/src/components/reception/ReceptionPatientDrawer.test.tsx
git commit -m "feat(reception): show immediate payment void execution"
```

### Task 6: Full verification and documentation alignment

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-07-24-executed-pending-payment-void-design.md`
- Modify if needed: `docs/superpowers/plans/2026-07-24-executed-pending-payment-void.md`

**Interfaces:**
- No new runtime interface.

- [ ] **Step 1: Run focused backend tests**

Run: `pnpm exec vitest run test/payment-void-dispute-schema.test.ts test/unit/payment-void-execution.test.ts`
Expected: PASS.

Run: `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts test/integration/routes/reception-doctor-payouts.test.ts test/integration/routes/reception.test.ts`
Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

Run: `pnpm --filter web exec vitest run src/components/reception/ReceptionPatientDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 3: Run typecheck and builds**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

Run: `pnpm build:web`
Expected: exit 0.

Run: `pnpm build:migrations`
Expected: exit 0.

- [ ] **Step 4: Review task-owned diff**

Run: `git diff main...HEAD --stat`
Expected: only payment-void spec, plan, migration/schema, focused service, approval route/schema, UI, and tests.

- [ ] **Step 5: Final commit if verification required adjustments**

```bash
git add <exact task-owned files>
git commit -m "test(billing): verify executed-pending payment void"
```

- [ ] **Step 6: Run final policy check**

Run: `pnpm worktree:check -- --mode=task`
Expected: clean branch and `WORKTREE_POLICY_OK`.

# Executed-Pending Refund Approval, Revision, and UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing refund/canonical/dispute/approval foundation so cash refunds execute atomically at request time, later two-person approval is review-only, Return for correction starts a new approval revision, rejection creates an explicit canonical/legacy reversal, and Approval Center clearly communicates financial, approval, recovery, and dispute state.

**Architecture:** Keep `/api/approvals` as the operational workflow adapter. Extract the proven held-refund financial mutation into a focused service that can create the approval request inside the same strict financial boundary, add revision-aware approval decisions, and add a canonical credit-note cash-refund reversal command. Reuse existing dispute recovery/write-off services and improve the existing React queue/drawer/dialogs instead of introducing parallel systems.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite, TypeScript, Drizzle schema declarations, Vitest, React, TanStack Query, Tailwind utility classes, i18next, Lucide icons.

## Global Constraints

- Base every change on reviewed local `main` commit `a98cb0152`; treat `program/cdb-main-continuous-20260725` as read-only reference.
- Preserve legacy, shadow, and strict canonical authority semantics through `executeStrictFinancialMutation`.
- Posted financial records and approval decisions are never deleted; corrections use explicit reversal or supersession facts.
- Existing refund calculation, funding, compensation, dispute, recovery, and UI components must be reused where safe.
- New cash refund requests execute at request time; historical held-refund requests retain approval-time execution compatibility.
- Two distinct current-revision approvers are required; requester self-approval and same-revision duplicate approval remain blocked.
- Return for correction may change only notes/evidence; executed amount, item, quantity, funding, counter, and credit-note identity are immutable.
- Cash enters available counter balance only after explicit physical-cash-return confirmation and an eligible active counter is resolved; otherwise rejection opens a dispute.
- Evidence absence remains a warning, not an approval hard blocker, except fields explicitly required by Return/Reject dialogs.
- All financial/revision/rejection paths are tenant-scoped, idempotent, concurrency-safe, and fail closed.
- All interactive targets are at least 44×44px, dialogs are semantic and keyboard-operable, and mobile actions remain reachable.
- No push, deployment, production migration, feature-flag change, canonical promotion, or production mutation.

---

## File Structure

- `migrations/0549_approval_revision_policy.sql`: approval request revision column and revision-aware decision-table rebuild.
- `migrations/0550_canonical_credit_note_cash_refund_reversals.sql`: immutable canonical refund-reversal authority.
- `src/db/schema/approval-requests.ts`: revision-aware approval request/decision declarations.
- `src/db/schema/canonical/billing.ts`: canonical refund-reversal table declaration.
- `tenant-schema.sql`: generated/maintained tenant schema parity.
- `src/data/schema-migrations.generated.ts`: rebuilt migration manifest.
- `src/services/approvals/two-person-policy.ts`: current-revision decision reads, inserts, counts, and return/reset helper.
- `src/lib/canonical/commands/reverse-credit-note-cash-refund.ts`: canonical reversal command.
- `src/lib/canonical/live-credit-note-cash-refund-reversal.ts`: deterministic live projection resolver for legacy refund identities and funding snapshots.
- `src/lib/executed-refund.ts`: focused request-time/refund-reversal orchestration and reusable legacy statement builders.
- `src/routes/tenant/approvals.ts`: route integration, backward compatibility, request/review/return/reject contracts.
- `src/schemas/approval.ts`: reject resolution, revision return, and executed-refund response validation.
- `web/src/components/admin/ApprovalDetailDrawer.tsx`: executed financial state, progress, revision, recovery/dispute context, accessible actions.
- `web/src/components/admin/ApprovalDecisionDialog.tsx`: structured Return/Reject dialogs and focus-safe interaction.
- `web/src/components/admin/DetailDrawer.tsx`: semantic dialog, focus, Escape, scroll lock, and mobile-safe action area.
- `web/src/pages/admin/PendingApprovals.tsx`: queue badges, action labels, dialog payloads, query invalidation.
- Focused schema, canonical, service, route, and frontend tests listed in each task.

---

### Task 1: Add revision-aware approval persistence

**Files:**
- Create: `migrations/0549_approval_revision_policy.sql`
- Modify: `src/db/schema/approval-requests.ts`
- Modify: `tenant-schema.sql`
- Test: `test/approval-revision-schema.test.ts`
- Test: `test/services/two-person-approval-policy.test.ts`

**Interfaces:**
- Produces `approval_requests.approval_revision: number`.
- Produces `approval_decisions.approval_revision`, `superseded_at`, `superseded_by_revision`, and `superseded_reason`.
- Produces uniqueness `(tenant_id, approval_source, approval_request_id, approval_revision, approver_id)`.

- [ ] **Step 1: Write the failing schema migration test**

Create a SQLite test that applies the relevant approval migrations plus `0542`, seeds a revision-1 decision, returns the request to revision 2, and proves the same approver can insert one revision-2 decision while a duplicate revision-2 insert fails.

```ts
expect(columns('approval_requests')).toContain('approval_revision');
expect(columns('approval_decisions')).toEqual(expect.arrayContaining([
  'approval_revision',
  'superseded_at',
  'superseded_by_revision',
  'superseded_reason',
]));
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `pnpm exec vitest run test/approval-revision-schema.test.ts`

Expected: FAIL because migration `0542` and revision columns do not exist.

- [ ] **Step 3: Implement the additive/rebuild migration**

Migration requirements:

```sql
ALTER TABLE approval_requests
  ADD COLUMN approval_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE approval_decisions RENAME TO approval_decisions_legacy_0542;

CREATE TABLE approval_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  approval_source TEXT NOT NULL DEFAULT 'approval_requests',
  approval_request_id INTEGER NOT NULL,
  approval_revision INTEGER NOT NULL DEFAULT 1 CHECK (approval_revision > 0),
  approver_id INTEGER NOT NULL,
  approver_role TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'approve',
  notes TEXT,
  superseded_at TEXT,
  superseded_by_revision INTEGER,
  superseded_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE (tenant_id, approval_source, approval_request_id, approval_revision, approver_id),
  CHECK ((superseded_at IS NULL AND superseded_by_revision IS NULL)
      OR (superseded_at IS NOT NULL AND superseded_by_revision > approval_revision))
);

INSERT INTO approval_decisions (..., approval_revision, ...)
SELECT ..., 1, ... FROM approval_decisions_legacy_0542;

DROP TABLE approval_decisions_legacy_0542;
```

Recreate request and actor indexes, including a current-revision lookup index.

- [ ] **Step 4: Update Drizzle and tenant schema declarations**

Add exact column names and revision-aware unique/index declarations to `src/db/schema/approval-requests.ts`; regenerate or safely patch `tenant-schema.sql` according to repository convention.

- [ ] **Step 5: Run schema and policy tests**

Run: `pnpm exec vitest run test/approval-revision-schema.test.ts test/services/two-person-approval-policy.test.ts`

Expected: schema test PASS; existing policy tests may remain GREEN before behavior changes.

- [ ] **Step 6: Commit**

```bash
git add migrations/0549_approval_revision_policy.sql src/db/schema/approval-requests.ts tenant-schema.sql test/approval-revision-schema.test.ts
git commit -m "feat(approvals): add revision aware decisions"
```

---

### Task 2: Make two-person approval current-revision aware

**Files:**
- Modify: `src/services/approvals/two-person-policy.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/schemas/approval.ts`
- Test: `test/services/two-person-approval-policy.test.ts`
- Test: `test/integration/routes/two-person-approvals.test.ts`
- Test: `test/integration/routes/approvals.test.ts`

**Interfaces:**
- `recordApprovalDecision()` reads `approval_revision` from the request and only considers unsuperseded decisions for that revision.
- New `returnApprovalForCorrection(db, input)` atomically increments revision, supersedes prior decisions, resets progress, and records correction state.

- [ ] **Step 1: Write failing current-revision policy tests**

Add tests for:

```ts
it('counts only unsuperseded decisions from the current revision');
it('allows a prior-revision approver to approve the new revision once');
it('blocks the same approver twice in one revision');
it('returns a 1/2 request to revision 2 at 0/2 without deleting history');
```

Assert old decisions remain queryable with `superseded_at` and the request has `approval_revision=2`, `approval_count=0`, and null approval timestamps.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run test/services/two-person-approval-policy.test.ts test/integration/routes/two-person-approvals.test.ts`

Expected: FAIL because policy SQL ignores revision and no return helper exists.

- [ ] **Step 3: Update request/decision reads and inserts**

Extend the request progress row:

```ts
interface ApprovalRequestProgressRow {
  id: number;
  requested_by: number;
  status: string;
  approval_count: number | null;
  required_approvals: number | null;
  approval_revision: number | null;
}
```

Every decision lookup, insert, duplicate guard, and count subquery must bind the request's current revision and require `superseded_at IS NULL`.

- [ ] **Step 4: Implement atomic Return for correction**

Expose:

```ts
export interface ReturnApprovalForCorrectionInput {
  tenantId: string;
  approvalRequestId: number;
  actorId: number;
  reason: string;
  missingItems?: string[];
}

export interface ReturnApprovalForCorrectionResult {
  previousRevision: number;
  approvalRevision: number;
  approvalCount: 0;
  requiredApprovals: number;
}
```

Batch order:

1. Guarded request update increments revision and resets progress only for pending/partially-approved non-terminal rows.
2. Supersede unsuperseded decisions from the previous revision.
3. Verify exactly one request changed and current revision/progress match.

- [ ] **Step 5: Route Request Info through revision reset**

For approval requests, `POST /approvals/:id/request-info` must call the helper, update `request_data.financialState` for executed refunds, preserve `execution_status`, and record metadata with previous/new revisions and missing items. Historical non-approval-source adapters retain existing behavior.

`submit-info` must preserve immutable refund calculation fields and make the new revision reviewable without changing revision or financial execution.

- [ ] **Step 6: Run policy and route suites**

Run: `pnpm exec vitest run test/services/two-person-approval-policy.test.ts test/integration/routes/two-person-approvals.test.ts test/integration/routes/approvals.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/approvals/two-person-policy.ts src/routes/tenant/approvals.ts src/schemas/approval.ts test/services/two-person-approval-policy.test.ts test/integration/routes/two-person-approvals.test.ts test/integration/routes/approvals.test.ts
git commit -m "feat(approvals): reset decisions by revision"
```

---

### Task 3: Add canonical credit-note cash-refund reversal authority

**Files:**
- Create: `migrations/0550_canonical_credit_note_cash_refund_reversals.sql`
- Modify: `src/db/schema/canonical/billing.ts`
- Create: `src/lib/canonical/commands/reverse-credit-note-cash-refund.ts`
- Create: `src/lib/canonical/live-credit-note-cash-refund-reversal.ts`
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `docs/database/canonical-source-of-truth.yaml`
- Modify: `docs/database/canonical-authority-matrix.yaml`
- Modify: `docs/database/canonical-authority-access-registry.yaml`
- Modify: `docs/database/legacy-table-disposition.yaml`
- Modify: `tenant-schema.sql`
- Test: `test/canonical/credit-note-cash-refund-reversal-schema.test.ts`
- Test: `test/canonical/reverse-credit-note-cash-refund.test.ts`
- Test: `test/canonical/live-credit-note-cash-refund-reversal.test.ts`
- Test: `test/canonical/financial-route-coverage.test.ts`

**Interfaces:**
- `resolveLiveCreditNoteCashRefundReversal(db, input)` resolves immutable canonical IDs, current balances, funding slices, and evidence.
- `reverseCreditNoteCashRefund(db, input, options)` returns deterministic reversal identity and restored balance summary.

- [ ] **Step 1: Write failing schema and command tests**

Cover:

```ts
it('creates one immutable reversal per posted canonical cash refund');
it('restores invoice, receipt, allocation, and tender projections exactly');
it('marks credit note and cash refund reversed without deleting funding slices');
it('is idempotent for the same key and rejects mismatched replay');
it('fails closed when any before-balance changed');
```

- [ ] **Step 2: Run canonical tests and verify RED**

Run: `pnpm exec vitest run test/canonical/credit-note-cash-refund-reversal-schema.test.ts test/canonical/reverse-credit-note-cash-refund.test.ts test/canonical/live-credit-note-cash-refund-reversal.test.ts`

Expected: FAIL because reversal schema/resolver/command do not exist.

- [ ] **Step 3: Add immutable reversal schema**

Create a tenant-scoped table with:

```sql
reversal_public_id TEXT NOT NULL,
idempotency_key TEXT NOT NULL,
refund_public_id TEXT NOT NULL,
credit_note_public_id TEXT NOT NULL,
invoice_public_id TEXT NOT NULL,
amount_minor INTEGER NOT NULL,
currency_code TEXT NOT NULL,
reason_code TEXT NOT NULL,
reversed_at_utc TEXT NOT NULL,
business_date TEXT NOT NULL,
actor_user_id INTEGER NOT NULL,
source_evidence_sha256 TEXT NOT NULL,
reconciliation_guard INTEGER NOT NULL DEFAULT 1
```

Add unique tenant/refund and tenant/idempotency constraints, foreign keys to canonical refund/credit/invoice, amount/date/evidence checks, and useful indexes.

- [ ] **Step 4: Implement live reversal resolver**

Resolve the canonical source mapping created by `legacy_live_held_credit_note_cash_refund:<approvalId>`, load the posted refund, credit note, invoice, receipt slices, allocation slices, tender attributions, current receipt/allocation/tender projections, and canonical compensation reservation state. Return exact before/after values; do not synthesize missing authority.

- [ ] **Step 5: Implement canonical reversal command**

The command must:

1. Check idempotency replay.
2. Validate posted lifecycle and all before balances.
3. Insert immutable reversal header.
4. Restore invoice paid/due/credited/net-due values.
5. Restore receipt refunded/net-received values.
6. Restore allocation reversed/remaining values.
7. Mark cash refund and credit note reversed.
8. Emit accounting and custody reversal outbox events.
9. Write source mappings and command receipt.
10. Verify reconciliation guard and return restored summary.

Keep original slice rows immutable.

- [ ] **Step 6: Register governance and route coverage**

Register the new table and command as canonical authority for `credit_refund_payment_reversal`; mark the legacy route writes as compatibility projections pending promotion, not new authority.

- [ ] **Step 7: Run canonical/governance tests**

Run: `pnpm exec vitest run test/canonical/credit-note-cash-refund-reversal-schema.test.ts test/canonical/reverse-credit-note-cash-refund.test.ts test/canonical/live-credit-note-cash-refund-reversal.test.ts test/canonical/financial-route-coverage.test.ts test/canonical/schema-governance.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add migrations/0550_canonical_credit_note_cash_refund_reversals.sql src/db/schema/canonical/billing.ts src/lib/canonical/commands/reverse-credit-note-cash-refund.ts src/lib/canonical/live-credit-note-cash-refund-reversal.ts src/lib/canonical/financial-route-coverage.ts docs/database tenant-schema.sql test/canonical
git commit -m "feat(canonical): reverse credit note cash refunds"
```

---

### Task 4: Refactor existing refund execution for request-time use

**Files:**
- Create: `src/lib/executed-refund.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/schemas/approval.ts`
- Modify: `src/lib/billing-refund-cash-hold.ts`
- Modify: `src/lib/billing-refund-commission.ts`
- Test: `test/unit/executed-refund.test.ts`
- Test: `test/integration/routes/refund-approval-cash-holds.test.ts`
- Test: `test/integration/routes/held-refund-canonical-cash-refund.test.ts`
- Test: `test/integration/routes/approvals.test.ts`

**Interfaces:**
- `executeRefundAtRequestTime(env, input)` performs the same validated refund mutation currently performed by `executeHeldRefundApproval`, while creating approval/hold/financial facts atomically.
- Historical held requests continue to call a compatibility execution function at final approval.

- [ ] **Step 1: Write failing request-time execution tests**

Add tests asserting a new refund POST:

- returns `executed: true`;
- stores `execution_status='succeeded'` and `executionMode='executed_pending'`;
- creates/consumes the hold in the same financial lifecycle;
- creates the credit note and bill/cash/commission effects immediately;
- invokes `credit-note.cash-refund` strict boundary;
- first and second approval create no second credit note/SalesReturn/canonical refund.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run test/unit/executed-refund.test.ts test/integration/routes/refund-approval-cash-holds.test.ts test/integration/routes/held-refund-canonical-cash-refund.test.ts`

Expected: FAIL because current POST only holds cash and final approval executes the refund.

- [ ] **Step 3: Extract calculation and statement builders**

Move the current `executeHeldRefundApproval` calculation, legacy statement construction, canonical resolver/command call, compensation handling, and result verification into focused functions. Inputs must include the immutable request snapshot and optional additional authoritative approval/hold statements.

Do not duplicate calculation code between request-time and historical approval-time paths.

- [ ] **Step 4: Create approval and financial mutation atomically**

For new refund POST, pass approval insert and hold insert as authoritative statements to the strict mutation. Store:

```ts
executionMode: 'executed_pending',
financialState: 'refunded_pending_review',
cashHoldStatus: 'consumed',
approvalRevision: 1,
creditNoteId,
creditNoteNo,
requestedRefundAmount,
cashRefundAmount,
receivableReduction,
```

Set `execution_status='succeeded'`. Resolve inserted IDs after disabled/shadow/strict execution without assuming batch result shape.

- [ ] **Step 5: Generalize review-only execution detection**

Replace payment-void-only detection with:

```ts
function isExecutedPendingApproval(request: any): boolean {
  const data = parseRequestData(request.request_data);
  return data.executionMode === 'executed_pending'
    && request.execution_status === 'succeeded';
}
```

`approvalRequiresExecution()` returns false for executed-pending payment voids and refunds. Historical requests without this marker retain current final-approval execution.

- [ ] **Step 6: Preserve clinical and cache behavior**

Ensure request-time item refunds complete clinical cancellation only after the strict financial mutation succeeds. API response and reception UI invalidation can identify immediate execution.

- [ ] **Step 7: Run refund and approval suites**

Run: `pnpm exec vitest run test/unit/executed-refund.test.ts test/integration/routes/refund-approval-cash-holds.test.ts test/integration/routes/held-refund-canonical-cash-refund.test.ts test/integration/routes/approvals.test.ts test/integration/routes/two-person-approvals.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/executed-refund.ts src/routes/tenant/approvals.ts src/schemas/approval.ts src/lib/billing-refund-cash-hold.ts src/lib/billing-refund-commission.ts test/unit/executed-refund.test.ts test/integration/routes/refund-approval-cash-holds.test.ts test/integration/routes/held-refund-canonical-cash-refund.test.ts test/integration/routes/approvals.test.ts
git commit -m "feat(refunds): execute cash refunds before review"
```

---

### Task 5: Reverse rejected executed refunds and route cash to recovery or dispute

**Files:**
- Modify: `src/lib/executed-refund.ts`
- Modify: `src/lib/billing-refund-dispute.ts`
- Modify: `src/lib/billing-refund-cash-hold.ts`
- Modify: `src/lib/canonical/live-refund-compensation.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/schemas/approval.ts`
- Test: `test/integration/routes/refund-executed-pending-rejection.test.ts`
- Test: `test/integration/routes/refund-disputes.test.ts`
- Test: `test/unit/billing-refund-dispute.test.ts`
- Test: `test/canonical/live-refund-compensation.test.ts`

**Interfaces:**
- `reverseExecutedRefund(env, input)` performs canonical/legacy reversal and returns restored bill, compensation, cash recovery, or dispute summary.
- Reject payload supports `cashResolution`, `cashReturnedAcknowledged`, and `idempotencyKey`.

- [ ] **Step 1: Write failing rejection tests**

Cover:

```ts
it('reverses executed refund and credits verified returned cash to an eligible active counter');
it('reverses executed refund and opens a dispute when source session is closed');
it('defaults to dispute when physical cash return is not acknowledged');
it('does not create available cash-in for a disputed rejection');
it('replays the same rejection idempotently and blocks conflicting replay');
it('restores commission and bill projections exactly once');
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run test/integration/routes/refund-executed-pending-rejection.test.ts test/integration/routes/refund-disputes.test.ts`

Expected: FAIL because current rejection only converts a held reserve to dispute and does not reverse an executed refund.

- [ ] **Step 3: Extend reject schema and safe defaults**

```ts
cashResolution: z.enum(['cash_returned', 'open_dispute']).default('open_dispute'),
cashReturnedAcknowledged: z.literal(true).optional(),
idempotencyKey: z.string().min(8).max(128),
```

Require acknowledgement for `cash_returned`; reject it when no eligible active counter exists.

- [ ] **Step 4: Build legacy compatibility reversal statements**

Use the immutable execution snapshot to restore bill and category projections, mark credit note reversed, create explicit income/accounting/audit reversal events, reverse legacy commission effects, and transition the consumed hold to settled/disputed without deleting original rows.

- [ ] **Step 5: Execute canonical and compatibility reversal atomically**

Call `executeStrictFinancialMutation` with boundary `credit-note.cash-refund.reverse` and `reverseCreditNoteCashRefund`. Include approval rejection state and either recovery cash-in or dispute creation in the same authoritative statement set.

- [ ] **Step 6: Reuse existing dispute lifecycle**

For `open_dispute`, call existing dispute helpers with executed-refund/reversal metadata. Preserve recovery and write-off endpoints. Prevent double representation as both available cash and open dispute.

- [ ] **Step 7: Verify exact final state and record events**

After commit, verify request rejected, canonical/legacy refund reversed, bill restored, hold settled/disputed, and either one cash-in recovery or one open dispute. Record approval/audit events with reversal and custody identities.

- [ ] **Step 8: Run rejection, dispute, compensation, and canonical suites**

Run: `pnpm exec vitest run test/integration/routes/refund-executed-pending-rejection.test.ts test/integration/routes/refund-disputes.test.ts test/unit/billing-refund-dispute.test.ts test/canonical/live-refund-compensation.test.ts test/canonical/reverse-credit-note-cash-refund.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/executed-refund.ts src/lib/billing-refund-dispute.ts src/lib/billing-refund-cash-hold.ts src/lib/canonical/live-refund-compensation.ts src/routes/tenant/approvals.ts src/schemas/approval.ts test/integration/routes/refund-executed-pending-rejection.test.ts test/integration/routes/refund-disputes.test.ts test/unit/billing-refund-dispute.test.ts test/canonical/live-refund-compensation.test.ts
git commit -m "feat(refunds): reverse rejected executed refunds"
```

---

### Task 6: Improve Approval Center state clarity and dialogs

**Files:**
- Create: `web/src/components/admin/ApprovalDecisionDialog.tsx`
- Create: `web/src/components/admin/ApprovalDecisionDialog.test.tsx`
- Modify: `web/src/components/admin/DetailDrawer.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.test.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.test.tsx`
- Modify: `web/src/locales/en/translation.json`
- Modify: `web/src/locales/bn/translation.json`

**Interfaces:**
- Drawer receives current revision, current-user decision, executed financial state, counter eligibility, and rejection/return callbacks.
- Decision dialog emits structured payloads instead of browser `prompt()`/`confirm()` strings.

- [ ] **Step 1: Write failing UI state and accessibility tests**

Cover:

- executed refund copy `Refund completed — awaiting review`;
- visible 0/2, 1/2, and 2/2 two-step progress;
- revision and `You approved this revision` state;
- Return dialog reset warning and immutable financial fields;
- Reject dialog default dispute, cash-return gating, exact consequence summary;
- one action set only;
- semantic dialog, labelled close button, Escape, focus entry/restoration, scroll lock;
- 44px action targets and sticky mobile action bar.

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `pnpm --filter web exec vitest run src/components/admin/ApprovalDecisionDialog.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx src/pages/admin/PendingApprovals.test.tsx`

Expected: FAIL because structured dialogs, revision states, and accessibility contracts do not exist.

- [ ] **Step 3: Harden shared DetailDrawer**

Implement semantic dialog behavior:

```tsx
<div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
```

Add initial focus, focus trap, Escape close, trigger focus restoration, body scroll lock, labelled close button, and mobile-safe sticky action area. Avoid closing on backdrop while a dirty decision form is open.

- [ ] **Step 4: Build structured decision dialog**

Support modes `return` and `reject` with visible labels, inline errors, loading disablement, safe dismissal, and accessible descriptions. Reject mode displays `cash_returned` only when eligible; acknowledgement is mandatory.

- [ ] **Step 5: Reorder refund drawer information hierarchy**

Above the fold show:

1. financial execution/reversal state;
2. approval step indicator and revision;
3. amount/invoice/patient/requester;
4. cash recovery/dispute owner;
5. collection and commission effect.

Keep allocation, technical IDs, policy, and full timeline under progressive disclosure. Group timeline by revision.

- [ ] **Step 6: Update queue actions and API payloads**

Use labels `Record first approval`, `Give final approval`, `Return for correction`, and `Reject & reverse refund`. Send structured return/reject payloads and invalidate approvals, billing, counter, due, refund-dispute, and patient queries after success.

- [ ] **Step 7: Add bilingual copy**

Add English and Bengali strings for financial state, revision, approval progress, reversal consequences, recovery acknowledgement, dispute ownership, and immutable refund explanation. Parse both locale files in tests/build.

- [ ] **Step 8: Run frontend tests, typecheck, and build**

Run:

```bash
pnpm --filter web exec vitest run src/components/admin/ApprovalDecisionDialog.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx src/pages/admin/PendingApprovals.test.tsx
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/admin/ApprovalDecisionDialog.tsx web/src/components/admin/ApprovalDecisionDialog.test.tsx web/src/components/admin/DetailDrawer.tsx web/src/components/admin/ApprovalDetailDrawer.tsx web/src/components/admin/ApprovalDetailDrawer.test.tsx web/src/pages/admin/PendingApprovals.tsx web/src/pages/admin/PendingApprovals.test.tsx web/src/locales/en/translation.json web/src/locales/bn/translation.json
git commit -m "feat(approvals): clarify executed refund review ux"
```

---

### Task 7: Rebuild migration manifest and run full verification

**Files:**
- Modify: `src/data/schema-migrations.generated.ts`
- Modify: `docs/superpowers/plans/2026-07-26-executed-pending-refund-approval-revision-ux.md`
- Create: `docs/superpowers/progress/2026-07-26-executed-pending-refund-approval-revision-ux-progress.md`

**Interfaces:**
- Produces a reproducible migration manifest and final verification evidence.

- [ ] **Step 1: Rebuild migration manifest**

Run: `pnpm build:migrations`

Expected: generated manifest includes `0549_approval_revision_policy.sql` and `0550_canonical_credit_note_cash_refund_reversals.sql` with updated checksum. Do not upload it.

- [ ] **Step 2: Run backend focused suites**

Run:

```bash
pnpm exec vitest run \
  test/approval-revision-schema.test.ts \
  test/services/two-person-approval-policy.test.ts \
  test/integration/routes/two-person-approvals.test.ts \
  test/integration/routes/approvals.test.ts \
  test/unit/executed-refund.test.ts \
  test/integration/routes/refund-approval-cash-holds.test.ts \
  test/integration/routes/held-refund-canonical-cash-refund.test.ts \
  test/integration/routes/refund-executed-pending-rejection.test.ts \
  test/integration/routes/refund-disputes.test.ts \
  test/canonical/credit-note-cash-refund-reversal-schema.test.ts \
  test/canonical/reverse-credit-note-cash-refund.test.ts \
  test/canonical/live-credit-note-cash-refund-reversal.test.ts \
  test/canonical/live-refund-compensation.test.ts \
  test/canonical/financial-route-coverage.test.ts \
  test/canonical/schema-governance.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run frontend focused suites**

Run:

```bash
pnpm --filter web exec vitest run \
  src/components/admin/ApprovalDecisionDialog.test.tsx \
  src/components/admin/ApprovalDetailDrawer.test.tsx \
  src/pages/admin/PendingApprovals.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run project verification**

Run:

```bash
pnpm typecheck
pnpm --filter web build
pnpm test:schema-drift
pnpm worktree:check -- --mode=task --allow-dirty
git diff --check
```

Expected: PASS with no unexpected warnings or generated-file drift.

- [ ] **Step 5: Adversarial review and fixes**

Review for:

- duplicate financial execution;
- stale balance acceptance;
- revision race conditions;
- cash/dispute double counting;
- wrong accountable user/counter;
- canonical/legacy divergence;
- missing tenant/idempotency guards;
- inaccessible dialogs/actions;
- misleading financial copy.

Add a failing regression test before every code fix found during review.

- [ ] **Step 6: Record progress evidence**

Document exact commits, tests, counts, known limitations, backward compatibility, and explicit confirmation that no production action occurred.

- [ ] **Step 7: Commit verification checkpoint**

```bash
git add src/data/schema-migrations.generated.ts docs/superpowers/plans/2026-07-26-executed-pending-refund-approval-revision-ux.md docs/superpowers/progress/2026-07-26-executed-pending-refund-approval-revision-ux-progress.md
git commit -m "docs(approvals): verify executed refund review flow"
```

- [ ] **Step 8: Integrate locally only after clean review**

From the clean main worktree:

```bash
pnpm worktree:check -- --mode=integration
git cherry-pick <task-commit-range>
```

Re-run focused backend/frontend suites and typecheck on local `main`. Do not push or deploy.

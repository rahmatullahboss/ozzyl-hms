# Executed-Pending Refund Approval, Revision, and UX Design

**Date:** 2026-07-26  
**Branch:** `feature/approval-refund-post-facto-canonical-ux-20260726`  
**Base:** reviewed local `main` at `a98cb0152`  
**Canonical reference:** read-only `program/cdb-main-continuous-20260725`; relevant refund, approval, and canonical command files are identical to this base.

## 1. Purpose

Change cash refund approval from approval-before-execution to executed-pending review while preserving canonical finance, cash custody, compensation, two-person approval, dispute recovery, and immutable audit history.

Reception must complete the refund at request time. Management review may happen later. Approval never pays the refund again. Rejection reverses the financial refund and then either records verified cash recovery into an active counter or opens requester/custody-owned disputed cash when the money is not recovered, including when the originating counter session is already closed.

## 2. Reuse Assessment

The existing implementation is a strong foundation and must be improved rather than rebuilt.

### Reuse without replacement

- `createApprovalRequestSchema`, idempotency hashing, tenant scoping, role checks, and duplicate request protection.
- Refund item selection, proportional amount allocation, cash/receivable impact calculation, counter availability checks, and paid compensation guards.
- `billing_refund_cash_holds` as the compatibility custody link between request, counter, cashier, and refund.
- `issueCreditNoteWithCashRefund`, `resolveLiveCreditNoteProjection`, `resolveLiveCreditNoteCashRefundFunding`, and `executeStrictFinancialMutation` for legacy, shadow, and strict canonical execution.
- Legacy/canonical doctor compensation refund adjustment logic.
- Existing refund dispute table, recovery endpoint, write-off approval, accounting events, and canonical cash-ledger shadow projections.
- Existing two-person approval policy, approval events, queue API, `PendingApprovals`, and `ApprovalDetailDrawer`.
- Existing executed-pending payment-void pattern for request-time mutation and later review-only approval.

### Refactor or extend

- Move the current held-refund approval execution into a reusable request-time refund execution service.
- Generalize executed-pending detection so both payment void and refund approvals skip later financial replay.
- Add an explicit canonical credit-note cash-refund reversal command and immutable reversal authority.
- Add revision-aware approval decisions so Return for correction supersedes current-revision decisions and restarts at 0/2.
- Update rejection behavior to distinguish verified cash recovery from disputed missing cash.
- Update approval UI copy, progress, dialogs, accessibility, and mobile action layout.

### Do not recreate

- No second approval engine.
- No parallel refund API.
- No duplicate cash-dispute model.
- No new calculation engine.
- No direct legacy-only financial workaround.
- No destructive deletion of credit notes, refund records, decisions, or audit history.

## 3. Canonical Financial Invariants

1. Canonical credit note, refund funding, receipt, allocation, tender, invoice, compensation, accounting outbox, and custody changes use canonical commands behind `executeStrictFinancialMutation`.
2. Disabled/legacy mode retains the existing authoritative compatibility writes.
3. Shadow mode commits legacy authority and canonical shadow facts atomically.
4. Strict mode commits canonical authority with required compatibility statements in the same command batch.
5. Posted refund facts are never deleted. Rejection is represented by an explicit reversal fact and guarded projection transitions.
6. Every command is tenant-scoped, deterministic, idempotent, and fails closed on balance or mapping mismatch.
7. The original receipt, allocation, tender attribution, refund, credit note, and approval history remain readable after reversal.
8. No production flag, migration, deployment, or canonical authority promotion is part of this task.

## 4. Request-Time Refund Flow

For `item_partial_refund`, `amount_partial_refund`, and `bill_refund` cash requests:

1. Validate request and idempotency key.
2. Return the existing result for an exact replay; reject a key reused with a different payload.
3. Load finalized bill, refundable items, payments, originating cashier, active workstation counter session, and compensation state.
4. Calculate item allocation, total credit, cash refund, receivable reduction, collection/category changes, and commission impact.
5. Reject invalid, duplicate, unsupported, stale, period-locked, insufficient-cash, or paid-compensation cases.
6. Generate the credit note/refund identities.
7. Execute one atomic financial mutation containing:
   - approval request insert with `status='pending'`, `execution_status='succeeded'`, `approval_revision=1`, and `approval_count=0`;
   - compatibility cash-hold creation and immediate consumption linked to the refund;
   - legacy credit note, credit-note lines, bill projection, income, SalesReturn cash movement, accounting event, audit evidence, clinical cancellation, and compensation adjustment;
   - canonical credit note, cash refund, funding slices, invoice/payment projections, compensation adjustments, accounting outbox, and custody outbox through `issueCreditNoteWithCashRefund`.
8. Store executed-pending request data:
   - `executionMode: 'executed_pending'`
   - `financialState: 'refunded_pending_review'`
   - `cashHoldStatus: 'consumed'`
   - credit note/refund identities
   - immutable requested amount/item snapshot
   - counter/custody identities
   - calculation and commission summaries
9. Record created and execution-succeeded approval events.
10. Return `executed: true` and the refund/credit-note summary.

## 5. Approval Flow

### Initial state

- `status='pending'`
- `approval_revision=1`
- `approval_count=0`
- `required_approvals=2`
- `execution_status='succeeded'`
- `financialState='refunded_pending_review'`

### First distinct approval

- Add one decision for the current revision.
- Set effective progress to 1/2.
- Keep request pending/partially approved.
- Do not run any refund, bill, cash, commission, clinical, accounting, or canonical mutation.

### Second distinct approval

- Add the second current-revision decision.
- Set request fully approved at 2/2.
- Set `financialState='approved_refund'`.
- Do not run the refund again.

### Separation of duties

- Requester cannot approve their own request.
- Same person cannot approve twice in one revision.
- A person who approved an earlier superseded revision may approve a new revision once.
- Approver role and tenant checks remain mandatory.

## 6. Return for Correction and Revision Model

Return for correction is limited to notes, evidence, explanation, and audit metadata. Executed amount, selected items, quantities, payment funding, counter, and credit note are immutable.

When an authorized reviewer returns a pending or 1/2 request:

1. Require a return reason and optional structured missing-item list.
2. Increment `approval_revision`.
3. Mark every approval decision from the previous revision `superseded_at` with the return reason.
4. Reset effective `approval_count=0`, `first_approved_at=NULL`, and `fully_approved_at=NULL`.
5. Keep financial execution and `execution_status='succeeded'` unchanged.
6. Set `info_request_status='requested'` and `financialState='refunded_correction_required'`.
7. Record one revision/return approval event.
8. Requester submits notes/evidence for the new revision; the request becomes reviewable at 0/2.

If amount, item, quantity, payment funding, or refund method must change, the existing executed request cannot be edited. It must be rejected/reversed and a new refund request created.

## 7. Rejection and Financial Reversal

Rejecting an executed-pending refund always reverses the refund's financial authority. It never deletes the original transaction.

### Canonical reversal

Add a canonical command that:

- creates one immutable credit-note cash-refund reversal fact;
- marks the canonical credit note and cash refund `reversed` with UTC evidence;
- restores invoice credited/net-due/paid/due projections;
- restores receipt refunded/net-received projections;
- restores allocation reversed/remaining projections;
- restores tender attributable balance semantics;
- reverses/release canonical compensation refund adjustments;
- emits accounting and custody reversal outbox events;
- validates exact before/after balances and current posted state;
- supports deterministic idempotent replay;
- conflicts if the authority was already reversed or has changed.

### Legacy compatibility reversal

The same strict mutation batch:

- marks the legacy credit note reversed/rejected without deletion;
- restores bill totals, paid, due, status, and category projections from the stored execution snapshot;
- creates explicit positive legacy income/reversal evidence;
- reverses applicable commission adjustments or creates guarded recovery evidence;
- preserves original SalesReturn and creates a separate recovery/dispute custody event;
- records audit and approval events.

### Cash recovered now

Available only when:

- reviewer explicitly confirms physical cash was returned;
- an authorized active counter session is resolved for the accountable custody user;
- the accounting period is open;
- idempotency and row-count guards pass.

Then create one cash-in recovery movement, settle the consumed hold without a dispute, and return the recovered counter/session identity.

### Cash not recovered or originating session closed

- Create/open one requester/custody-owned `billing_refund_cash_disputes` row.
- Keep the missing amount outside available cash.
- Link the dispute to the original refund, reversal, approval, counter, session, and accountable employee.
- Preserve the existing recovery and authorized write-off endpoints.
- The safe default is dispute when no verified cash-return instruction is supplied.

## 8. Data Model Changes

### Approval revision

- Add `approval_requests.approval_revision INTEGER NOT NULL DEFAULT 1`.
- Rebuild `approval_decisions` to add:
  - `approval_revision INTEGER NOT NULL DEFAULT 1`
  - `superseded_at TEXT`
  - `superseded_by_revision INTEGER`
  - `superseded_reason TEXT`
- Replace actor uniqueness with `(tenant_id, approval_source, approval_request_id, approval_revision, approver_id)`.
- Preserve every existing decision as revision 1.

### Canonical refund reversal

Add `canonical_credit_note_cash_refund_reversals` with tenant-scoped:

- reversal public ID and idempotency key;
- credit note, cash refund, and invoice public IDs;
- amount and currency;
- original/reversed timestamps and business date;
- actor/reason metadata;
- exact invoice, receipt, allocation, and custody reconciliation evidence hash;
- unique refund and idempotency constraints.

Update Drizzle schema, generated migration manifest, tenant schema, canonical source-of-truth, authority matrix/access registry as required by governance tests.

## 9. API Contract

### Create refund

Response includes:

- `executed: true`
- approval status/progress/revision
- credit note/refund identity
- cash amount and receivable reduction
- counter/custody identity
- financial state

### Review approve

Response includes current revision, progress, current user's decision state, and `executedAlready: true`.

### Return for correction

Request includes required reason and optional missing items. Response includes new revision and progress 0/2.

### Reject

Request includes:

- required rejection reason;
- `cashResolution: 'cash_returned' | 'open_dispute'`;
- idempotency key;
- explicit cash-return acknowledgement when `cash_returned`.

Response includes reversal identity, restored bill summary, cash recovery or dispute result, and final request state.

## 10. UI/UX Design

The existing Approval Center and refund drawer are improved, not replaced. Existing HMS visual tokens remain authoritative; no unrelated theme redesign is introduced.

### Queue/card state

Show explicit financial and approval state separately:

- `Refund completed`
- `Awaiting review · 0/2`
- `Partially approved · 1/2`
- `Fully approved · 2/2`
- `Correction required · Revision N · 0/2`
- `Rejected · Refund reversed`
- `Cash dispute open`

### Detail header

Prioritize:

1. financial execution state;
2. two-step approval progress;
3. revision number;
4. refund amount, invoice, patient, requester/cashier;
5. cash custody/recovery/dispute state;
6. collection and commission effect.

Use a visible two-step progress indicator with text/icons, not color alone.

### Actions

- `Record first approval` or `Give final approval`
- `Return for correction`
- `Reject & reverse refund`

Only one primary CTA is visually dominant. Reject is spatially separated and destructive.

### Return dialog

- Explain that current-revision approvals will be superseded and progress reset to 0/2.
- Require reason.
- Allow structured missing evidence/items.
- State that refund amount/items cannot be edited because the refund is already executed.

### Reject dialog

- Explain that the refund has already been paid.
- Show the exact amount and invoice.
- Present `Cash returned now` only when an eligible active counter can be resolved.
- Require an explicit physical-cash-return acknowledgement.
- Otherwise default to `Open cash dispute` and show the accountable user.
- State the financial, counter, commission, and patient-balance consequences before confirmation.

### Accessibility and responsive behavior

- Semantic `role='dialog'`, `aria-modal`, labelled title/description, focus trap, Escape close, focus restoration, body scroll lock, and unsaved-form dismissal protection.
- Minimum 44×44px touch targets and at least 8px action spacing.
- Sticky mobile decision bar with safe-area padding.
- Visible focus rings and disabled/loading states.
- Progressive disclosure for technical IDs, allocation rows, and full audit history.
- Revision-grouped timeline.
- No reliance on hover or color alone.

## 11. Testing

### Backend

- Request-time refund executes credit note, cash, bill, compensation, accounting, clinical, approval, and canonical facts atomically.
- Exact replay returns the same result; payload mismatch conflicts.
- Approval 1/2 and 2/2 never replay financial execution.
- 1/2 -> Return resets new revision to 0/2 and supersedes old decision.
- Prior-revision approver can approve the new revision once.
- Same-revision duplicate and requester self-approval are blocked.
- Rejection creates canonical/legacy reversal exactly once.
- Verified cash recovery restores an eligible active counter exactly once.
- Closed/no-recovery rejection opens one dispute and no available cash-in.
- Commission and bill projections reconcile after issue and reversal.
- Concurrent approve/return/reject operations fail closed.
- Historical held-refund approvals retain backward-compatible approval-time execution.

### Frontend

- Executed-pending wording and financial state are visible.
- 0/2, 1/2, 2/2, revision, current-user decision, correction, reversal, and dispute states render correctly.
- Return warning and immutable financial fields are clear.
- Reject dialog gates cash-return confirmation and defaults safely to dispute.
- One action set only; no duplicate buttons.
- Keyboard, focus, Escape, screen-reader labels, 44px targets, and mobile sticky actions are covered.

## 12. Acceptance Criteria

1. Existing refund, canonical, compensation, dispute, approval, and UI foundations are reused.
2. New cash refund requests execute at request time and remain pending 0/2.
3. Approval never creates a second refund.
4. Return after 1/2 creates a new revision at 0/2 without changing executed financial facts.
5. Rejection reverses the financial refund through canonical and compatibility boundaries.
6. Verified recovered cash enters an eligible active counter; otherwise the amount becomes a dispute.
7. Original and reversal facts remain independently auditable.
8. Legacy, shadow, and strict canonical modes preserve their authority contracts.
9. Focused tests, full relevant suites, TypeScript, web build, migration/schema governance, and diff checks pass.
10. No push, deployment, production migration, feature-flag change, or production mutation occurs.

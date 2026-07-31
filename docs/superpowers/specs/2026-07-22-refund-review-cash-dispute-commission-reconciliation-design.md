# Refund Review, Cash Dispute, Collection, and Commission Reconciliation Design

**Date:** 2026-07-22  
**Status:** Approved for implementation planning  
**Target:** Ozzyl HMS tenant billing/refund workflow

## 1. Purpose

Provide one auditable refund workflow where an authorized reviewer can inspect and decide a refund directly from the dashboard, while cash custody, bill totals, department collections, accounting, and doctor commissions remain financially consistent.

The design covers:

- Dashboard-native refund review.
- Refund reason visibility in the dashboard worklist.
- Immediate cash reservation when a cash refund is requested.
- Item-level allocation for amount-based partial refunds.
- Collection and doctor-commission reconciliation on approval.
- Disputed-cash ownership on rejection.
- Dispute settlement by cash recovery or authorized write-off.

## 2. Verified Current State

The current system already provides several useful foundations:

- A refund approval request can create a `billing_refund_cash_holds` row with status `held`.
- Available counter cash is calculated as expected cash minus active held refund cash.
- Approval can create an approved credit note, reduce bill total/paid/due, create a negative income entry, create a `SalesReturn` cash transaction, and consume the hold.
- A shared `ApprovalDetailDrawer` already renders refund items, cash-hold status, reason, evidence, timeline, and review actions.

The gaps are:

- The dashboard Review button navigates to the full approval page instead of opening the shared drawer in place.
- The dashboard card does not show the refund reason or cash state.
- Rejection releases held cash instead of retaining it as requester-owned disputed cash.
- No dedicated refund-dispute liability record exists.
- Amount-based partial refunds do not carry an item allocation.
- Amount-based partial refunds can reduce bill total while leaving category totals and doctor commission unchanged.
- The current live request for bill `INV-D-2026-000703` is a pending ৳400 amount-based refund with cash hold status `held`; its four test-item commission accruals remain unchanged until approval.

## 3. Scope and Boundaries

### In scope

- Cash refunds created through the structured held-refund approval path.
- Item-based, full-bill, and amount-based partial refund requests.
- Dashboard worklist and shared approval drawer.
- Bill/category collection reconciliation.
- Unpaid or unsettled doctor commission reconciliation.
- Dispute recovery and management-authorized write-off.
- Legacy operational records plus canonical shadow projection compatibility.

### Out of scope

- Automatic recovery through payroll deduction.
- Automatic write-off without an approval decision.
- Refund of a doctor commission that has already been fully settled without a separate reversal/settlement workflow.
- Changing tenant example from canonical `shadow` mode.

## 4. State Model

### 4.1 Refund approval state

```text
pending -> partially_approved -> approved
pending/partially_approved -> rejected
```

### 4.2 Cash-reserve state

Extend `billing_refund_cash_holds.status`:

```text
held -> consumed       (refund approved)
held -> disputed       (refund rejected)
disputed -> settled    (cash recovered or authorized write-off completed)
```

Existing historical `released` rows remain readable for backward compatibility. New structured refund rejection must not transition to `released`.

### 4.3 Dispute state

Create a dedicated requester liability record linked one-to-one with the rejected refund hold:

```text
open
-> recovery_pending -> recovered
-> writeoff_pending -> written_off
```

`recovered` and `written_off` are terminal settlement outcomes. The linked cash hold becomes `settled` only after one of these outcomes is posted successfully.

## 5. Data Model

### 5.1 Refund allocation persistence

Persist the approved/requested item allocation in request data and, on approval, in credit-note items.

Canonical request-data fields:

```json
{
  "refundKind": "amount_partial_refund",
  "requestedRefundAmount": 400,
  "allocationMode": "auto_proportional_adjustable",
  "allocationVersion": 1,
  "items": [
    {
      "invoiceItemId": 3058,
      "description": "ECG",
      "refundableAmount": 400,
      "allocatedRefundAmount": 48.48,
      "allocationSource": "auto"
    }
  ]
}
```

When the requester edits an allocation, `allocationSource` becomes `requester_adjusted` for the changed rows. The server always recalculates and validates the final canonical allocation before saving.

### 5.2 Refund dispute table

Add `billing_refund_cash_disputes` with at least:

- `tenant_id`
- `refund_cash_hold_id` — unique
- `approval_request_id`
- `bill_id`
- `requester_user_id`
- `amount`
- `status`
- `rejection_reason`
- `rejected_by`
- `rejected_at`
- `custody_user_id`
- `counter_id`
- `counter_session_id`
- `settlement_method` — `cash_recovery` or `authorized_writeoff`
- `settlement_reference_type`
- `settlement_reference_id`
- `settled_by`
- `settled_at`
- timestamps and idempotency key

Constraints:

- Amount must be positive.
- One dispute per refund hold.
- Requester, bill, approval, and hold must belong to the same tenant.
- Terminal disputes cannot be settled twice.

### 5.3 Hold extensions

Extend hold status validation to include `disputed` and `settled`. The dispute table's unique `refund_cash_hold_id` is the authoritative relation; no circular `dispute_id` column is added to the hold table.

## 6. Auto Allocation Algorithm

Amount-based partial refunds use automatic proportional allocation across all currently refundable bill items.

### 6.1 Eligible item value

For each active refundable item:

```text
refundable item balance
= item net refundable value
- prior approved credit-note allocation
- other pending structured refund allocation
```

Items with zero balance are excluded.

### 6.2 Proportional proposal

```text
raw allocation for item
= requested refund × item refundable balance / total refundable balance
```

Round each value to two decimal places. Any rounding remainder is assigned deterministically to the eligible item with the largest refundable balance; ties use the lowest invoice-item ID.

### 6.3 Requester adjustment

The requester may edit item allocations before submission. Server validation requires:

- Allocation total equals requested refund exactly to two decimals.
- Each allocation is greater than or equal to zero.
- Each allocation does not exceed that item's refundable balance.
- At least one item has a positive allocation.
- Every referenced invoice item belongs to the selected bill and tenant.
- No allocation overlaps another active pending refund beyond the available balance.

The UI provides a `Reset to automatic allocation` action.

### 6.4 Existing pending amount-only requests

For an existing pending request with no saved item allocation, the review API generates an allocation preview from the current refundable balances. Before approval, the server persists and revalidates that allocation. If bill eligibility changed, approval is blocked and the reviewer sees the exact conflict.

## 7. Dashboard Review Experience

### 7.1 Worklist row

The dashboard pending-request row displays:

- Request type.
- Invoice/bill reference.
- Patient name.
- Requester name.
- Refund reason.
- Requested amount.
- Cash state: Held, Disputed, Consumed, or Settled.
- Submitted date/time and risk.
- Review action.

Reason wraps to a reasonable two-line limit on large screens and remains accessible through the drawer on mobile.

### 7.2 In-place review

The dashboard `Review` action opens the existing shared `ApprovalDetailDrawer`; it does not navigate away.

The dashboard fetches or reuses the same approval DTO used by the full Pending Approvals page. The URL may retain a query parameter such as `?approval=<key>` for deep linking, but the drawer remains on the dashboard.

### 7.3 Refund drawer sections

The refund review drawer shows:

1. **Identity** — request, invoice, patient, requester, counter/session.
2. **Reason and evidence** — request reason, notes, supporting evidence, timeline.
3. **Original bill** — total, paid, due, category totals, payment receipt.
4. **Item allocation** — item, refundable balance, allocated refund, allocation source.
5. **Cash impact** — held amount, available-cash impact, custody state.
6. **Collection impact** — before/after bill and category collection.
7. **Commission impact** — doctor, source item, current payable, reversal, remaining payable.
8. **Decision** — Approve, Reject, Request Info.

Approval and rejection require a note for refund requests.

## 8. Pending Request Financial Behaviour

When a structured cash-refund request is submitted:

- Create approval request and hold atomically.
- Mark hold `held`.
- Reduce available counter cash by the cash-refund portion immediately.
- Do not yet create a permanent cash-out transaction; while pending, the hold itself is the reserve deduction.
- Do not yet mutate bill totals, collection totals, credit notes, or commission accruals.
- Project the hold to canonical shadow cash ledger using the existing refund-reserve event pattern.

Pending available cash is therefore calculated as:

```text
available cash = expected cash - active held refund cash
```

This separates cash availability from final revenue/commission recognition while approval is pending.

## 9. Approval Execution

Approval is one idempotent financial operation.

### 9.1 Revalidation

Before mutation:

- Recalculate item refundable balances.
- Validate allocation total and item limits.
- Verify the hold is still `held` and equals the cash-refund portion.
- Verify the bill remains eligible.
- Verify no affected doctor commission has an incompatible paid/settled state.
- Verify accounting period and approval policy.

### 9.2 Bill and collection updates

Create approved credit-note header and item rows from the validated allocation.

Update:

```text
new total = old total - total credit
new paid  = max(0, old paid - cash refund)
new due   = max(0, new total - new paid - valid deposit adjustments)
```

Recalculate category totals from item allocation:

- `test_bill`
- `doctor_visit_bill`
- `admission_bill`
- `operation_bill`
- `medicine_bill`

For mixed bills, each category decreases by the sum of allocations belonging to that category. Category totals must sum to the new bill total, subject only to explicitly modelled non-category adjustments.

Department/test/visit collection reporting must consume the credit-note allocation or reconciled category totals so the refund appears in the correct source category rather than only as generic negative income.

### 9.3 Cash and accounting

- Insert the final `SalesReturn` transaction once.
- Consume the existing hold; do not deduct available cash a second time.
- Post the credit-note accounting event with item/category allocations.
- Mark hold `consumed` and link the credit note.
- Project canonical shadow `REFUND_RESERVE_CONSUMED` and credit-note events with the same allocation metadata.

### 9.4 Commission reconciliation

For every positively allocated item, identify linked commission accruals.

#### Percentage commission

Recompute from the remaining eligible base:

```text
remaining commission base
= max(0, original commission base - item refund allocation affecting that base)

recomputed earned
= remaining commission base × original rate

recomputed payable
= max(0, recomputed earned - applicable waiver/adjustment)

commission reversal
= existing payable - recomputed payable
```

The reversal is capped at the unpaid/unsettled balance.

#### Flat commission

For quantity-based returns, reduce the flat commission according to returned quantity. For an amount-only partial allocation inside an item, reduce the unpaid flat commission proportionally to the allocated refund divided by the item's refundable balance, rounded to two decimals and capped at the unpaid balance.

#### Paid/settled commission

If any required reversal exceeds the unpaid/unsettled commission balance:

- Block refund approval.
- Show the affected doctor, accrual, paid amount, and required reversal.
- Require a separate authorized commission-recovery or settlement reversal workflow.

Do not silently create a negative doctor balance.

#### Audit and accounting

- Preserve original accrual history.
- Create explicit commission-adjustment/cancellation events linked to credit note and invoice item.
- Reduce payable and commission expense through the existing accounting posting queue.
- Make repeated approval execution idempotent.

## 10. Rejection and Disputed Cash

Rejecting a held refund request performs one atomic transition:

- Approval becomes `rejected`.
- Hold becomes `disputed`, not `released`.
- Convert the temporary reserve into one permanent disputed-cash outflow or custody-transfer movement linked to the hold and dispute.
- Remove the row from the active-held deduction only after that disputed movement is verified, preventing double subtraction.
- Create the requester-owned dispute record.
- Record reviewer, rejection note, requester, bill, counter/session, custody, and amount.
- Project a canonical shadow event with cash status `DISPUTED` and current location `disputed`.

The resulting cash calculation is:

```text
expected cash = prior expected cash - disputed-cash outflow
available cash = expected cash - remaining active held refund cash
```

Thus the rejected amount remains unavailable, but it is represented exactly once: as disputed cash rather than both a permanent outflow and an active hold.

The accounting entry recognizes the requester liability without changing the patient's bill:

```text
debit  requester/employee dispute receivable
credit cash or cash-custody account
```

The rejected refund does not change bill totals, collection, credit notes, or doctor commissions because the refund was not approved.

The dispute amount appears in:

- Requester's outstanding dispute balance.
- Cash custody/dispute reporting.
- Admin financial audit and action center.
- Counter close/handover evidence, preventing it from being mistaken for available cash.

## 11. Dispute Settlement

### 11.1 Cash recovery

Authorized operator records recovered cash against the dispute:

- Require active destination counter session.
- Create cash-in movement linked to dispute.
- Post the accounting entry: debit cash, credit requester/employee dispute receivable.
- Post canonical cash-ledger recovery event.
- Mark dispute `recovered` and hold `settled`.
- Clear the requester's outstanding dispute balance.

### 11.2 Authorized write-off

Write-off requires a controlled approval request with:

- Mandatory reason.
- Supporting evidence or explicit evidence warning.
- Distinct requester and approver rules.
- Management-authorized role.
- Open accounting period.

On final approval:

- Post the accounting entry: debit the configured dispute/write-off expense or loss account, credit requester/employee dispute receivable.
- Mark dispute `written_off` and hold `settled`.
- Clear the requester liability operationally while retaining audit history.
- Do not create cash-in or make the written-off amount available in a counter.

A rejected write-off request leaves the original dispute open.

## 12. API Design

Prefer extending existing approval APIs rather than creating a parallel review system.

Required API behaviour:

- Approval list DTO includes reason, patient, bill summary, hold state, and allocation summary.
- Approval detail endpoint returns complete refund review data and calculated impacts.
- Refund creation accepts optional requester-adjusted allocations and returns the server-normalized allocation.
- Refund approval endpoint revalidates allocation and returns credit note, collection impact, commission impact, and hold result.
- Refund rejection endpoint creates a dispute and returns dispute details.
- Dispute endpoints support list/detail, cash recovery, write-off request, and history.

All financial writes require idempotency keys and tenant-scoped authorization.

## 13. Error Handling

Block the action with a clear recoverable message when:

- Refund allocation no longer matches refundable balances.
- Hold is missing or no longer held.
- Counter cash was insufficient at request time.
- Bill status changed.
- Accounting period is closed.
- Affected commission has already been paid/settled.
- The same request, dispute, recovery, or write-off is submitted twice.
- Requester attempts to approve their own controlled action.

No partial financial mutation is allowed. Approval, rejection, recovery, and write-off each use a transaction/batch boundary and verify affected row counts.

## 14. Migration and Existing Request Handling

Migrations must:

- Expand refund-hold status constraints safely.
- Add the dispute table and indexes.
- Preserve all existing `held`, `consumed`, and `released` rows.
- Avoid rewriting historical released holds as disputes.

The live pending request for `INV-D-2026-000703` remains `held`. After deployment, its detail view receives an auto-allocation preview. No production mutation occurs until an authorized reviewer approves or rejects it.

## 15. Security and Audit

- Dashboard review uses the same role and two-person approval rules as the full approval page.
- Requesters cannot approve their own refund or write-off.
- Every state transition records approval events and audit logs.
- Dispute write-off requires controlled approval; no direct admin shortcut.
- Tenant boundaries are enforced in every join and mutation.
- Raw internal IDs are shown only where operationally useful and never replace human-readable invoice, patient, requester, or doctor labels.

## 16. Canonical Compatibility

Tenant 102 remains canonical `shadow` mode.

- Legacy tables remain the operational authority during this change.
- New hold, dispute, recovery, write-off, credit-note, collection, and commission-adjustment events are projected to canonical shadow records where supported.
- Shadow projection failure follows the existing configured policy and must not silently change legacy financial results.
- This feature does not authorize canonical cutover or production-mode change.

## 17. Testing Strategy

### Unit tests

- Proportional allocation and deterministic rounding.
- Requester adjustment validation.
- Category allocation totals.
- Percentage and flat commission reversal calculations.
- Hold/dispute state transitions.

### Integration tests

- Request creates approval and cash hold atomically.
- Available cash decreases immediately.
- Dashboard/detail API returns reason, patient, allocation, and hold state.
- Approval reduces bill/category collection and commission correctly.
- Approval does not double-deduct cash.
- Rejection creates dispute and keeps cash unavailable.
- Cash recovery settles dispute and creates cash-in.
- Approved write-off settles dispute without cash-in.
- Paid commission blocks refund approval.
- Idempotent retries create no duplicates.

### Frontend tests

- Dashboard Review opens the drawer in place.
- Reason and cash state render in each row.
- Patient and requester are not conflated.
- Allocation preview and requester adjustment render correctly.
- Before/after collection and commission impact are visible.
- Approve/reject/request-info actions refresh dashboard and drawer state.

### Regression tests

- Existing item-based refunds continue to work.
- Existing consumed/released hold history remains readable.
- Pending-approval full page and dashboard share identical decision behaviour.
- Doctor payable, performance, dashboard KPI, collection reports, and counter summaries agree after an approved refund.

## 18. Acceptance Criteria

The change is accepted when:

1. A reviewer can fully inspect and decide a refund without leaving the dashboard.
2. The dashboard row shows reason and cash state.
3. Cash becomes unavailable immediately on request.
4. Amount-based refunds receive a server-generated item allocation that the requester can adjust within strict limits.
5. Approval updates bill totals, category collections, accounting, and unpaid doctor commission consistently.
6. Approval consumes the hold without deducting cash twice.
7. Rejection creates requester-owned disputed cash and does not return it to available cash.
8. Disputes can close only through cash recovery or an approved write-off.
9. All transitions are idempotent, tenant-scoped, audited, and canonical-shadow compatible.
10. The live `INV-D-2026-000703` request can be reviewed with an allocation preview and correct projected collection/commission impact before any decision.

# Post-Facto / Executed-Pending Approval System Implementation Plan — 2026-07-05

## Product decision

Small and medium hospitals need speed at reception. The approval system must support two operating modes:

1. **Approval before action** — risky or irreversible work waits for admin approval.
2. **Action before approval** — low/medium operational work is executed immediately, then reviewed later by admin.

For Ozzyl HMS, the second mode is named **executed-pending approval**. The requester completes the operational action first, but the record remains pending admin review. Approval finalizes the record. Rejection never deletes the action; it creates a controlled reversal or recovery workflow.

## Scope for this implementation branch

This branch implements the first complete production slice around **reception petty-cash expenses**, because this is the clearest small-hospital case:

- Receptionist records an expense and pays from drawer cash immediately.
- Cash drawer is deducted immediately.
- Expense remains `approval_status = pending`.
- Admin approves later: no second cash movement happens.
- Admin rejects later: system supports either immediate cash-return reversal or a recovery-required workflow.
- If recovery is required, a later cash recovery endpoint records cash-in and closes/partially closes the recovery.

## State model

### Expense approval states

- `pending`: waiting for admin decision.
- `approved`: admin accepted the executed or non-executed expense.
- `rejected`: admin rejected the expense.

### Expense payment states

- `unpaid`: action has not financially executed yet.
- `paid`: drawer cash already moved or approved expense has been executed.

### Recovery states

- `not_required`: no post-rejection recovery is needed.
- `required`: cash already moved and must be recovered.
- `partially_recovered`: some cash returned, balance remains.
- `recovered`: cash fully returned / reversed.
- `written_off`: future use for management-approved write-off.

## Rejection policies

When a paid drawer expense is rejected, admin chooses:

1. `cash_returned`
   - Record a `cash_in` drawer movement immediately.
   - Create a collected recovery record.
   - Mark expense recovery as `recovered`.

2. `mark_recovery_required`
   - Create an open recovery record.
   - Mark expense recovery as `required`.
   - Later cashier/admin can collect the cash through `/expenses/:id/recover`.

If no body is sent and the expense was already paid, the safe default is `mark_recovery_required`.

## Backend changes

1. Add a migration for recovery tracking columns on `expenses` and a new `expense_recoveries` table.
2. Extend `POST /expenses/:id/reject` to accept recovery policy.
3. Add `POST /expenses/:id/recover` to collect rejected expense cash later.
4. Preserve existing approve behavior: approving paid-pending expenses must not duplicate cash movement.
5. Preserve audit logs for approve, reject, recovery-required, recovery-collected.

## UI implication for a follow-up branch

The approval page should display these lanes:

- Executed Pending
- Recovery Required
- Recovered
- Rejected / No recovery

Reject modal should offer:

- Cash returned now
- Mark recovery required
- Request receipt/info

## Test coverage requirements

- Drawer-paid over-threshold expense is still executed immediately and remains approval-pending.
- Approving the paid-pending expense creates no duplicate cash movement.
- Rejecting a paid-pending expense with no body marks recovery required.
- Rejecting a paid-pending expense with `cash_returned` creates a `cash_in` reversal.
- Recovering a rejected paid expense later creates a `cash_in` recovery and updates recovery status.
- Rejecting an unpaid pending expense does not create recovery.

## Production risk controls

- Never delete or mutate away the original cash-out movement.
- Never silently approve own request.
- Never execute a second cash-out during approval.
- Reversal/recovery must be an explicit new event with audit trail.
- Reports must be able to see original cash-out, recovery-required balance, and cash-in recovery separately.

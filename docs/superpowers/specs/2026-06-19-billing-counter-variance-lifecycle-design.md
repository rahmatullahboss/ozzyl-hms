# Billing Counter Variance Lifecycle Hardening

## Goal

Prevent a high-variance counter close from creating final cash custody records before supervisor approval, while preserving the existing immediate close path for normal variance.

## State Model

The existing `billing_counter_sessions.status` constraint remains unchanged (`active`, `closed`, or `void`). A pending high-variance close is represented as a locked active session:

- `status = 'active'`
- `variance_approval_required = 1`
- `variance_approval_status = 'pending'`

This avoids a table-rebuild migration while making the approval field the source of truth for the temporary lock.

## Close Flow

The close route calculates and validates the close snapshot before branching.

For a variance within the approval threshold, one database batch:

1. Marks the session closed and stores the close snapshot.
2. Creates the approved variance record.
3. Creates the `billing_handovers` row.
4. Creates the handover `cash_drawer_movements` row.

For a variance above the threshold, one database batch:

1. Keeps the session active but marks variance approval pending.
2. Stores the declared cash, expected cash, variance, intended handover recipient, amount, due amount, and remarks on the pending approval record.
3. Creates no `billing_handovers` row.
4. Creates no handover `cash_drawer_movements` row.
5. Emits no final cash-handover accounting event.

Repeated close attempts remain blocked while approval is pending.

## Approval Flow

Supervisor approval reads the persisted close snapshot and, in one database batch:

1. Changes the session from locked active to closed.
2. Marks the variance approval approved with approver metadata.
3. Creates the intended billing handover.
4. Creates the handover drawer movement.

Only after that batch succeeds does the route emit the cash-handover accounting event and final close audit record. An already-approved request remains idempotent and does not duplicate custody records.

## Rejection Flow

Supervisor rejection keeps the session active for recount and re-close. It:

1. Marks the current variance approval rejected with supervisor metadata.
2. Clears the session's pending close snapshot and approval lock.
3. Leaves no handover, handover drawer movement, or final accounting event.

The cashier can then continue using the same session and submit a fresh close attempt, which creates a new approval request if the recalculated variance still exceeds the threshold.

## Data Ownership

The pending approval row owns the intended handover details until approval. This prevents mutable session activity from changing the custody outcome between close request and supervisor decision. The session retains the reconciliation snapshot needed by current reporting and visibility behavior.

An additive migration extends `cash_variance_approvals` with the intended handover recipient, total, immediate handover amount, due amount, status, and close remarks. No sensitive patient data is stored. Existing approval rows remain readable because the new columns are nullable or have safe defaults.

## Error Handling and Concurrency

- Approval and rejection only process a request whose approval status is `pending`.
- Conditional update predicates prevent a second supervisor decision from re-finalizing the session.
- Missing or invalid persisted close data returns a conflict instead of creating partial custody records.
- The existing D1 batch boundary keeps each state transition and its relational records atomic.

## Tests

Route integration tests cover:

1. High-variance close returns pending approval and creates neither handover nor handover drawer movement.
2. Supervisor approval closes the session and creates exactly one handover and movement from the saved snapshot.
3. Supervisor rejection reopens/unlocks the session without custody records and permits recount/re-close.
4. Normal close still closes immediately and creates its handover and movement.

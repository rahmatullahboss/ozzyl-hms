# Executed-Pending Payment Void Design

**Date:** 2026-07-24
**Branch:** `feat/executed-pending-payment-void-20260724`
**Base:** reviewed local `main` at `ee2c367a0de92b278a9edc964b0da90c7b275294`

## 1. Purpose

Change cash payment voiding from approval-before-action to executed-pending review.

When reception submits a payment-void request, the financial correction must happen immediately and atomically:

- preserve the original positive payment;
- create one negative reversal payment;
- reduce the bill paid balance;
- restore the bill due balance and `open`/`partially_paid` status;
- reduce the originating cash/counter balance;
- remove unpaid doctor compensation from the payable worklist by making the linked bill unpaid;
- create an approval request whose financial execution is already complete;
- keep the invoice collectible from the due list.

The later admin decision must not repeat the financial mutation.

## 2. Scope

### Included

- Cash receipts represented by a positive row in `payments`.
- Reception-created `payment_void` approval requests.
- Legacy financial mode.
- Canonical shadow mode.
- Canonical strict mode through the existing `payment.reverse` boundary.
- Backward compatibility for old pending payment-void approvals that have not yet executed.
- Rejection-time operational dispute creation against the accountable employee/account.
- Due-list recollection through the existing `/api/billing/pay` flow.
- Protection against duplicate request/reversal execution.
- Protection against voiding after linked doctor/performer compensation has already been paid.

### Excluded

- Automatic employee cash recovery or write-off settlement UI.
- Automatic closing of an account dispute when the patient later pays.
- Gateway/card/MFS provider refund orchestration. Non-cash receipts keep the existing approval-time path until provider-specific execution is designed.
- Reversal of an already-settled doctor payout. The request is blocked instead of silently creating an unsupported clawback.

## 3. State Model

### Approval request

A newly submitted cash payment void is stored as:

- `status = 'pending'`
- `execution_status = 'succeeded'`
- `request_data.executionMode = 'executed_pending'`
- `request_data.financialState = 'reversed_pending_review'`
- `request_data.disputeStatus = 'not_required'`

The request remains pending for maker-checker review even though the financial action has already happened.

### Approval

When the required approver decision is complete:

- request becomes `approved`;
- `execution_status` remains `succeeded`;
- `financialState` becomes `approved_reversal`;
- no payment, bill, income, cash, accounting, or canonical command runs again.

### Rejection

When admin rejects an executed-pending void:

- the reversal remains effective;
- the bill remains due and collectible;
- request becomes `rejected`;
- `financialState` becomes `reversed_disputed`;
- one `billing_payment_void_disputes` row is created against the original payment receiver/accountable employee;
- no duplicate cash movement and no restoration of the original payment occur.

The dispute is operational accountability evidence. It does not create a second receivable in accounting because the patient invoice is already outstanding after the reversal.

### Legacy requests

A historical request without `request_data.executionMode = 'executed_pending'` keeps the existing behavior: approval executes the payment reversal once.

## 4. Data Model

Create `billing_payment_void_disputes` with:

- tenant and approval identity;
- original payment, bill, and reversal receipt identity;
- requester and accountable employee identity;
- original counter and counter-session identity;
- amount and payment method;
- status (`open`, `resolved`, `written_off`);
- rejection and resolution audit fields;
- unique `(tenant_id, approval_request_id)` and `(tenant_id, payment_id)` constraints.

No canonical financial table is added for the dispute because rejection does not change canonical financial balances. The canonical reversal remains the financial source of truth.

## 5. Request-Time Transaction

For a new cash `payment_void` request:

1. Validate schema and require an idempotency key.
2. Return an existing request for an exact idempotency replay.
3. Reject a different pending request or an existing payment reversal.
4. Load the positive payment, bill, original receiver, counter, and session.
5. Reject non-cash receipts from the executed-pending path.
6. Reject if any linked performer reserve or doctor commission is already paid.
7. Assert that `payment.reverse` is allowed for the tenant policy.
8. Generate the reversal receipt number.
9. Build one statement set containing:
   - approval request insert with `execution_status='succeeded'`;
   - negative reversal payment insert;
   - bill paid/due/status update;
   - legacy income reversal;
   - employee cash transaction against the original receiver, not the later admin approver.
10. Execute through `executeStrictFinancialMutation`:
    - legacy mode: commit the complete legacy statement set;
    - shadow mode: commit legacy authority and project canonical reversal;
    - strict mode: execute the canonical reverse-payment command with the operational legacy statements passed as authoritative statements in the same canonical command batch.
11. Resolve and return the created approval and reversal identities.
12. Record approval/audit events after the successful financial transaction.

## 6. Canonical Compatibility

The existing canonical command `reversePayment` remains authoritative for canonical balances. The new request path calls the existing live projection resolver and command using:

- deterministic canonical source mapping;
- canonical command idempotency;
- payment receipt/tender/allocation validation;
- canonical invoice paid/due update;
- canonical refund and reversal rows;
- canonical outbox events;
- cash custody event for cash tender;
- compensation settlement guard.

The approval insert is supplied as an authoritative statement in strict mode so the canonical reversal and operational review record cannot diverge.

## 7. Doctor Compensation Behavior

Unpaid accruals/reserves are not cancelled. Once the bill becomes unpaid, current payable queries no longer include them. If the patient pays again, the same linked compensation becomes eligible again without recreating it.

If a linked performer reserve or doctor commission has already been paid, the void request returns a conflict. This prevents legacy mode from bypassing the canonical compensation guard and avoids unsupported silent clawbacks.

## 8. Cash Accountability

The reversal transaction is attributed to the original payment receiver in `emp_cash_transactions`. The user submitting the request remains the audit actor and approval requester.

This separation prevents an admin approver from incorrectly becoming the cashier responsible for the original receipt.

## 9. Idempotency and Concurrency

- Client supplies `idempotencyKey` for payment void.
- Exact retries return the previously created approval and reversal state.
- Reusing a key with a different payload returns `409`.
- One original payment can have only one reversal and one payment-void dispute.
- Existing pending request checks remain tenant-scoped.
- Approval of executed-pending requests never enters the execution lock.
- Rejection creates the dispute and changes approval state in one D1 batch.

## 10. UI Behavior

Reception sends an idempotency key and receives a response indicating immediate execution. On success it invalidates:

- patient context;
- billing data;
- active counter/session summary;
- pending bills and appointments;
- due bills;
- approvals.

Success copy must state that the payment has been reversed and sent for admin review, rather than only saying that a request was submitted.

## 11. Error Handling

Return explicit conflicts for:

- payment not found;
- non-positive/original reversal payment;
- non-cash payment in the executed-pending path;
- reversal already exists;
- duplicate pending request;
- idempotency mismatch;
- paid doctor/performer compensation;
- canonical mapping/balance conflict;
- accounting period closed;
- financial policy boundary unavailable;
- atomic mutation verification failure.

No partial success response is allowed.

## 12. Testing

Required automated coverage:

- schema/migration contract for payment-void disputes;
- schema requires idempotency for `payment_void`;
- request creates approval and reversal together;
- request updates bill to due/open;
- cash attribution uses original `received_by`;
- request uses strict boundary and canonical reversal projection;
- idempotent replay returns existing result;
- different retry payload conflicts;
- non-cash request is blocked from immediate execution;
- paid compensation blocks all modes;
- approval does not execute a second reversal;
- rejection creates one dispute and preserves reversed bill/cash state;
- historical pending request still reverses on approval;
- reception UI sends idempotency key and invalidates due/counter data;
- focused integration, unit, typecheck, and build verification.

## 13. Acceptance Criteria

For a ৳700 cash doctor-visit receipt:

1. Reception submits void request.
2. The original ৳700 receipt remains.
3. A -৳700 reversal is created immediately.
4. The bill becomes due ৳700 and appears in the due list.
5. Counter/employee cash is reduced immediately against the original cashier.
6. Unpaid doctor payable is no longer displayed while the bill is unpaid.
7. Admin approval creates no second reversal.
8. Admin rejection creates an open payment-void dispute while the bill remains due.
9. The patient can later pay the ৳700 through the existing due-payment endpoint.
10. The same behavior is valid in legacy, shadow, and strict canonical modes.

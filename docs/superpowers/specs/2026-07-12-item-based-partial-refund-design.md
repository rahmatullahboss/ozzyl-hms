# Item-Based Partial Refund Request Design

Date: 2026-07-12

## 1. Context

The reception patient drawer currently allows staff to request a refund for a paid bill, but the request amount is always the full refundable paid amount. The UI does not allow the receptionist to select specific tests or services.

The existing credit-note module already supports item and quantity based returns. This change connects the reception refund-request workflow to that item-level credit-note capability while preserving the existing full-refund workflow.

## 2. Goals

- Allow reception staff to request either a full bill refund or an item-based partial refund.
- Load the refundable items for the selected bill.
- Calculate the refund amount only from selected invoice items and quantities.
- Prevent manual refund amount entry.
- Prevent refund requests for already returned quantities.
- Block completed or verified diagnostic services by default.
- Reserve the calculated cash refund from the requester's active counter session as soon as the request is submitted.
- Preserve maker-checker approval before the cash hold becomes a final refund or any clinical/accounting side effect occurs.
- Consume the hold on approval without reducing counter cash a second time.
- Release the hold on rejection so the amount becomes available in the counter again.
- Create a credit note containing only the approved items and quantities.
- Keep accounting, cash control, bill balance, clinical order status, commission reversal, and audit history consistent.

## 3. Non-goals

- Free-form manual refund amounts.
- Editing the original invoice after payment.
- Refunding completed or verified diagnostic services through the normal reception flow.
- Replacing the existing Credit Notes page.
- Handing cash to the patient or posting final refund accounting before approval; request submission only reserves the cash amount.

## 4. User Experience

### 4.1 Reception patient drawer

When a paid or partially paid bill is selected, the refund request panel will show:

- Refund type selector:
  - Full refund
  - Partial refund
- Bill summary:
  - invoice number
  - total amount
  - paid amount
  - already refunded amount
  - remaining refundable amount
  - cash amount that will be held from the active counter
- Active counter/session indicator.
- Required reason field.

For a full refund, the existing behavior remains: the request covers all currently refundable invoice items.

For a partial refund, the panel loads invoice items and displays:

- checkbox
- service or test name
- category
- clinical status when applicable
- original quantity
- already refunded quantity
- remaining refundable quantity
- refundable unit amount
- selected quantity
- calculated line refund amount
- block reason when the item is not eligible

The total requested refund is calculated from selected items and cannot be edited manually. Submitting the request creates a cash hold against the requester's active counter session; it does not yet create a final refund or accounting posting.

The submit button remains disabled until:

- at least one eligible item is selected
- every selected quantity is valid
- the reason contains at least three characters
- calculated refund amount is greater than zero
- the requester has an active counter session on the current workstation
- available counter cash, after existing holds, is at least the requested refund amount

### 4.2 Eligibility presentation

Items will be grouped visually into:

- Refundable
- Not refundable

Blocked items remain visible for transparency but cannot be selected.

Examples of block messages:

- Test already completed
- Report already verified
- Item already fully refunded
- Item already cancelled
- No refundable amount remains
- Refund request already pending for this quantity

### 4.3 Cash hold status

After submission, the panel and approval center show the request as `Pending approval — cash held`.

- On approval, the hold is consumed and becomes the final refund without another reduction in available counter cash.
- On rejection, the hold is released and the amount immediately becomes available in the originating counter session again.
- The patient must not receive cash before approval.

## 5. Refund Eligibility Rules

### 5.1 General rules

An invoice item is eligible only when all of the following are true:

- it belongs to the selected tenant and bill
- its invoice-item status is not cancelled or refunded
- remaining refundable quantity is greater than zero
- no pending refund request already reserves the same remaining quantity
- the bill has a positive settled amount available for refund

### 5.2 Diagnostic services

For normal reception requests:

- pending, ordered, scheduled, or collected-but-not-processed services may be refundable
- completed, verified, reported, finalized, or delivered services are blocked

A future exceptional override may be added for authorized administrators, but it is outside this change.

### 5.3 Non-diagnostic services

Non-diagnostic items are refundable when they have not been consumed, delivered, completed, or otherwise finalized according to their source module. Where a reliable source-module status is unavailable, the item remains visible but is blocked instead of being assumed refundable.

### 5.4 Quantity and amount

- Requested quantity must be an integer greater than zero.
- Requested quantity cannot exceed remaining refundable quantity.
- Refund amount is derived from the invoice item net line amount divided by original quantity.
- Existing item-level discount is therefore preserved in the refundable unit amount.
- Rounding occurs to two decimal places per line and again for the request total.

## 6. API Design

### 6.1 Refundable item lookup

Extend the existing credit-note invoice lookup endpoint or add a dedicated reception-safe endpoint that returns the same canonical eligibility calculation.

Recommended response shape:

```json
{
  "bill": {
    "id": 16,
    "invoice_no": "INV-D-2026-000016",
    "patient_id": 10,
    "total": 40000,
    "paid": 40000,
    "refunded": 0,
    "remaining_refundable": 40000
  },
  "items": [
    {
      "invoice_item_id": 101,
      "description": "CBC",
      "category": "test",
      "reference_id": 501,
      "clinical_status": "pending",
      "quantity": 1,
      "already_refunded_quantity": 0,
      "pending_requested_quantity": 0,
      "remaining_refundable_quantity": 1,
      "refundable_unit_amount": 800,
      "eligible": true,
      "block_reason": null
    }
  ]
}
```

The server, not the UI, is the source of truth for eligibility and amount.

### 6.2 Approval request payload

Reception continues to submit through `POST /api/approvals` with type `refund`.

Partial refund request data:

```json
{
  "type": "refund",
  "entityId": 16,
  "entityNo": "INV-D-2026-000016",
  "idempotencyKey": "refund-request-16-550e8400-e29b-41d4-a716-446655440000",
  "requestData": {
    "refundKind": "item_partial_refund",
    "paymentMethod": "cash",
    "reason": "Two tests were not performed",
    "oldValue": {
      "billStatus": "paid",
      "billTotal": 40000,
      "paidAmount": 40000,
      "patientId": 10
    },
    "newValue": {
      "status": "refund_requested",
      "refundKind": "item_partial_refund",
      "requestedRefundAmount": 1600,
      "items": [
        {
          "invoiceItemId": 101,
          "returnQuantity": 1,
          "calculatedAmount": 800
        },
        {
          "invoiceItemId": 102,
          "returnQuantity": 1,
          "calculatedAmount": 800
        }
      ]
    }
  }
}
```

The backend must ignore client-calculated amounts at submission and approval. It recalculates eligibility, quantities, and the refund total from current database state before creating the request and cash hold.

Full refund requests keep `refundKind: bill_refund` and are converted internally to all currently refundable items.

### 6.3 Request submission and cash hold

`POST /api/approvals` creates the pending approval request and its cash hold in one atomic operation.

The server must:

1. Require the requester to have an active billing counter session on the current workstation.
2. Recalculate the canonical refund amount.
3. Calculate available cash as the session's expected cash minus all active refund holds.
4. Reject the request when available cash is lower than the refund amount.
5. Insert a `billing_refund_cash_holds` row with status `held`, linked to the approval request, bill, employee, counter, and counter session.
6. Return the request ID, hold ID, held amount, and remaining available cash.

The hold reduces operationally available cash immediately, but it is not an `emp_cash_transactions` entry and does not affect revenue, bill totals, or accounting before approval.

## 7. Approval, Rejection, and Credit Note Execution

### 7.1 Approval

When an authorized reviewer approves a refund request:

1. Atomically claim the approval request so it cannot execute twice.
2. Reload the held request, bill, and requested invoice items.
3. Recalculate current eligibility, remaining quantities, and amounts.
4. Verify that the recalculated refund amount exactly matches the active hold amount.
5. If the data is stale or an item is no longer eligible, return a conflict and keep the request and hold pending so the reviewer can reject it explicitly.
6. Create one approved credit note containing only the approved invoice items and quantities.
7. Insert the final `SalesReturn` cash transaction for the held amount and originating counter session.
8. Mark the hold `consumed` in the same operation. Because active holds are excluded as soon as the final cash transaction is inserted, available counter cash does not decrease a second time.
9. Execute bill, accounting, commission, and clinical side effects exactly once.
10. Write complete audit records linking approval request, hold, bill, credit note, invoice items, users, quantities, reason, and amounts.

### 7.2 Rejection

When an authorized reviewer rejects a pending refund request:

1. Atomically move the request to `rejected`.
2. Mark the linked active hold `released` with reviewer, timestamp, and rejection reason.
3. Do not create a credit note, `SalesReturn`, income reversal, journal entry, commission reversal, or clinical cancellation.
4. The released amount immediately returns to available counter cash because it is no longer included in active holds.
5. Write audit records for both the request rejection and hold release.

The existing full bill refund helper must not be reused unchanged for partial requests because it currently includes all non-cancelled invoice items.

A new shared service should accept an explicit item selection and be used by both:

- manual credit-note creation
- approved partial refund requests

## 8. Clinical Side Effects

For selected refundable diagnostic items:

- cancel the linked lab or radiology order item when its current status is still cancellable
- reverse mapped consumables only through the existing cancellation service
- recalculate parent order status
- keep completed or verified order items unchanged and block the refund before financial posting

Clinical cancellation and financial refund must share one operation identity so retries do not duplicate either side.

## 9. Bill and Item State

- The original bill remains as the historical invoice.
- Credit notes reduce bill total, paid amount, due amount, and status using the existing credit-note rules.
- Invoice items are not deleted.
- Approved returned quantity is derived only from active credit notes in `approved` status.
- Pending quantity reservation is derived separately from active credit notes in `pending` status and from pending refund approval requests.
- Cash reservation is derived only from `billing_refund_cash_holds` rows in `held` status; consumed or released holds do not reduce available cash.
- An item becomes effectively fully refunded when approved returned quantity equals original quantity.
- UI and reports should expose `active`, `partially_refunded`, `refunded`, and `cancelled` as derived states where useful, without rewriting historical invoice values.

## 10. Accounting and Cash Control

The approved credit note remains the accounting source document. The cash hold is an operational reservation, not an accounting document.

### 10.1 At request submission

- require an active billing counter session on the requester's current workstation
- calculate `available_cash = expected_cash - active_refund_holds`
- create one `held` cash-hold row for the canonical refund amount
- reduce available counter cash immediately through the hold calculation
- do not create an income reversal, journal entry, credit note, or `emp_cash_transactions` row

### 10.2 At approval

- reverse the correct revenue categories
- reduce accounts receivable when unpaid value is removed
- insert one final `SalesReturn` cash transaction against the originating counter session
- mark the hold `consumed` atomically with final refund processing
- ensure the transition from active hold to `SalesReturn` leaves available cash unchanged
- post one idempotent accounting event per credit note
- include hold ID, payment method, cash refund, receivable reduction, and item-category totals in the event payload

### 10.3 At rejection

- mark the hold `released`
- create no refund accounting or cash transaction
- allow available counter cash to increase by the released amount immediately

Cash handover to the patient occurs only after approval. The UI must clearly distinguish `cash held` from `refund approved`.

## 11. Authorization and Audit

- Reception and receptionist roles may submit refund requests only from their own active counter session.
- Only existing admin/accounting reviewer roles may approve or reject pending requests.
- Approval consumes the originating counter's hold; it must not require or debit the reviewer's counter.
- Tenant scope is enforced on every lookup and mutation.
- Every request, hold creation, approval, rejection, hold consumption/release, execution conflict, credit note, clinical cancellation, cash transaction, and accounting event is auditable.
- Logs must not include unnecessary clinical details.

## 12. Concurrency and Idempotency

The implementation must protect against:

- double-click submission creating duplicate requests or duplicate holds
- duplicate pending requests for the same bill and item quantities
- two reviewers approving or rejecting the same request concurrently
- approval and rejection racing against each other
- a direct credit note and an approval request refunding the same item concurrently
- a counter session closing while an active hold exists
- retry after a partial infrastructure failure

Required controls:

- request idempotency key on reception submission
- unique active hold per approval request
- atomic request-and-hold creation
- atomic approval/rejection status transition
- server-side remaining-quantity and hold-amount revalidation
- counter close guard that blocks closure while active holds exist, or requires authorized release/reassignment first
- one canonical credit-note operation key
- unique accounting source-event key
- resumable clinical cancellation where existing services support it

## 13. Data Model Impact

Selected refund items remain in the existing approval request JSON payload. A migration is required for durable cash reservations.

Create `billing_refund_cash_holds` with:

- `id` primary key
- `tenant_id`
- `approval_request_id` with a unique constraint
- `bill_id`
- `patient_id`
- `amount` greater than zero
- `payment_method`, initially `cash`
- `employee_id` for the requesting cashier
- `counter_id`
- `counter_session_id`
- `status` constrained to `held`, `consumed`, or `released`
- `idempotency_key`
- `credit_note_id`, nullable until approval
- `held_at`
- `consumed_at`
- `released_at`
- `resolved_by`
- `resolution_reason`
- `created_at` and `updated_at`

Add indexes for:

- tenant and status
- tenant and counter session and status
- tenant and bill and status
- approval request uniqueness
- idempotency-key uniqueness within a tenant

Update the D1 migration, Drizzle schema, and fresh-install tenant schema. If financial operations are synchronized between local and cloud deployments, emit the existing immutable sync outbox event at hold creation and resolution boundaries without storing unnecessary clinical details.

Pending item reservation is derived from pending refund approval requests and pending direct credit notes. Pending cash reservation is derived only from hold rows in `held` status.

The existing one-pending-request-per-bill/type guard remains in place, so only one pending refund approval request can exist for a bill at a time. Approval and rejection must still revalidate items, hold ownership, status, and amount.

## 14. Error Handling

User-facing errors must explain the corrective action, for example:

- Selected test has already been completed and cannot be refunded.
- Another refund request already includes this item.
- Available refundable quantity changed. Reload the bill and try again.
- Bill no longer has enough settled amount for this refund.
- Activate a billing counter on this workstation before requesting a cash refund.
- Available counter cash is lower than the requested refund amount.
- This refund request does not have an active cash hold.
- The cash hold amount no longer matches the recalculated refund amount; reject the request and submit a new one.
- This counter session has pending refund holds and cannot be closed yet.
- Accounting period is closed for the refund date.

Request-and-hold creation, approval-and-consumption, and rejection-and-release must each be atomic. If any wider clinical/accounting step cannot be fully atomic in D1, persist an operation record and make each step idempotent and resumable. A failed approval must not consume or release the hold automatically; the request stays pending until it is successfully approved or explicitly rejected.

## 15. Testing Strategy

### Backend tests

- load eligible and blocked items
- partial selection amount calculation
- item-level discount preservation
- already refunded quantity calculation
- pending request quantity reservation
- completed or verified test rejection
- full refund request conversion to all refundable items
- request requires an active counter on the current workstation
- request is rejected when available cash is insufficient
- request and hold are created atomically
- duplicate idempotency key replays the same request and hold
- held amount reduces available and expected operational cash exactly once
- partial approval creates only selected credit-note items
- approval consumes the hold and inserts one `SalesReturn`
- approval does not decrease available counter cash a second time
- rejection releases the hold and restores available cash
- rejection creates no credit note, cash transaction, or accounting event
- stale approval revalidation conflict leaves the hold active
- duplicate approval or rejection creates no duplicate side effects
- approval/rejection race has one terminal winner
- counter session cannot close with active holds
- category-level accounting payload includes the hold ID
- linked lab cancellation and consumable reversal
- tenant isolation

### Frontend tests

- full and partial selector behavior
- item list loading
- blocked item display
- checkbox and quantity validation
- calculated total and cash-hold amount update
- active counter and sufficient-cash requirements
- disabled submit conditions
- request payload contains selected item IDs and quantities
- submitted request displays `Pending approval — cash held`
- approval displays final refund state without a second payout action
- rejection displays released-hold state and refreshed available cash
- success and conflict error states

### End-to-end scenario

1. Open a reception billing counter with known expected cash.
2. Create a paid bill containing five tests.
3. Mark three tests completed.
4. Leave two tests pending.
5. Open the reception patient drawer.
6. Select Partial refund.
7. Confirm completed tests are blocked.
8. Select the two pending tests.
9. Submit the request.
10. Verify a `held` cash reservation is created and available counter cash decreases by the selected refund amount.
11. Verify no credit note, `SalesReturn`, income reversal, journal entry, or clinical cancellation exists yet.
12. Approve as admin/accounts.
13. Verify the hold becomes `consumed`, one `SalesReturn` and one approved credit note are created, and available counter cash does not decrease again.
14. Verify only the two selected tests are cancelled/refunded.
15. Verify the remaining three tests and their revenue remain intact.
16. Repeat with a second request and reject it.
17. Verify the second hold becomes `released`, available counter cash returns, and no refund/accounting/clinical side effect is created.
18. Verify bill totals, cash ledger, accounting voucher, hold history, and audit history reconcile.

## 16. Acceptance Criteria

- Reception can submit an item-based partial refund request from the patient drawer.
- Manual refund amount entry is not available.
- Refund total equals the server-calculated total of selected quantities.
- Completed or verified diagnostic items cannot be selected.
- Submission requires the requester's active counter session and sufficient available cash.
- Submission immediately creates one durable cash hold and reduces available counter cash by the held amount.
- Submission does not create final refund accounting, a credit note, or clinical cancellation.
- Approval creates a credit note for only the selected items and quantities, consumes the hold, and does not reduce available cash a second time.
- Rejection releases the hold and restores the amount to available counter cash without refund side effects.
- The same quantity cannot be refunded twice.
- A counter session with active refund holds cannot be closed normally.
- Clinical, billing, cash, accounting, commission, and audit records remain consistent.
- Existing full refund and direct Credit Notes page workflows continue to work.

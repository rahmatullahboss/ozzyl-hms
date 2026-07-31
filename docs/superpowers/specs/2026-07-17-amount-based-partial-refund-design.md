# Amount-Based Partial Refund Design

## Goal

Keep the existing full and item-based refund workflows intact while allowing reception to request a manually entered partial credit amount against a finalized invoice.

## User flow

Reception opens a paid/finalized invoice from the patient drawer and chooses one of three modes:

1. Full refund — all currently eligible invoice items.
2. Item-based partial refund — selected refundable items and whole quantities.
3. Amount-based partial refund — a manually entered credit amount without returning invoice-item quantities.

The screen shows the total credit, the cash portion, any receivable reduction, active-counter cash, and held refund cash before submission. A request that produces no cash is directed to the bill-adjustment workflow.

## Data contract

Amount requests use the existing approval endpoint with:

- `type: "refund"`
- `requestData.refundKind: "amount_partial_refund"`
- `requestData.requestedRefundAmount`: positive two-decimal credit amount
- `requestData.paymentMethod: "cash"`
- no item selections

The server remains the source of truth. It recalculates the financial impact from the current bill state, reserves only the cash portion in `billing_refund_cash_holds`, and stores the canonical amount in the approval request.

## Approval and credit note

Approval revalidates the bill, requested amount, financial impact, and cash hold. It creates an approved credit-note header for the manual amount but creates no `billing_credit_note_items`, so item quantities and clinical orders are not treated as returned. The accounting event has no service-category allocation and therefore reverses `other_revenue`, clearly separating a manual financial adjustment from a service return.

Full and item-based refunds continue to create item rows and trigger existing clinical/commission cancellation side effects.

## Safety rules

- Amount must be finite, greater than zero, and no greater than the bill's current total.
- Reception requests must produce a positive cash refund.
- An active counter on the current workstation is required.
- Available counter cash must cover the cash portion.
- Idempotency and one-pending-refund-per-bill rules remain unchanged.
- Approval must match the originally held cash amount; changed bill state blocks approval and requires resubmission.
- No cash is paid before approval.

## Credit Notes page

The Credit Notes page remains the administrative item-based creation surface. Reception can view and pay ready-for-payout notes but cannot directly create a credit note. The page must hide the create action for roles that the API does not authorize, avoiding a misleading button and a predictable 403 response.

## Verification

Add schema, integration, and UI regression tests for amount request creation, approval, invalid amounts, payload shape, unchanged item quantities, and role-aware Credit Notes actions. Run targeted backend/frontend tests, TypeScript type-checking, and the web production build.

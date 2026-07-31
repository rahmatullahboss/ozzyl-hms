# IPD Discharge CTA Payment Behaviour Design

## Context

The discharge modal currently displays a green action such as `Collect ৳1,00,000 & Discharge`, but normal discharge validation still reads the optional `Total Received Now` input. When that field is blank, the UI treats the received amount as zero and blocks the action even though the button itself is an explicit full-collection command.

The existing backend already supports a partially paid current discharge bill when `discharge_mode` is `credit_pending`. The settlement endpoint also supports partial payment against selected previous invoices.

## Considered approaches

1. Auto-fill the payment input with the total payable. This avoids the blank-field error but makes the full-action meaning depend on mutable input state and can overwrite intentional partial entries.
2. Make the green CTA authoritative for full collection and reserve the input for optional partial collection. This matches the existing button copy and the requested workflow.
3. Remove the payment input and create a separate partial-payment modal. This is clearer but adds unnecessary interaction and duplicates the existing audited due-discharge form.

Approach 2 is selected.

## Required behaviour

### Full collection

- The green `Collect ৳X & Discharge` action always collects the complete `totalPayableBeforeClearance` shown on the button.
- It must work when `Total Received Now` is blank, zero, or contains a smaller amount.
- Previous mapped outstanding invoices are settled first for their full outstanding amount.
- The current IPD discharge bill then receives its full net payable amount.
- The optional payment input never changes the meaning of the full-collection CTA.

### Due or partial collection

- `Discharge with Due` opens the existing audited credit-discharge panel.
- Blank or zero payment input means no money is collected now and the full payable remains outstanding.
- A positive input below the total payable is treated as a partial collection.
- Partial cash is allocated in the same order as normal settlement: mapped previous invoices first, then the current IPD discharge bill.
- The remaining balance is discharged under the existing credit workflow and still requires reason, expected payment date, acknowledgement, user/counter audit, and higher-authority pending approval.
- Entering an amount equal to or above the full payable is not a credit discharge; the user must use the green full-collection action.
- When previous invoices are controlled by a workflow that does not support inline settlement, partial collection through this modal is blocked with a clear instruction to use the canonical collection workflow first. A zero-collection credit discharge remains available.

### Display and actions

- `Total Received Now` is an optional partial-collection input, not a prerequisite for the green action.
- The remaining amount display reacts to the entered partial amount.
- The credit panel states how much will be collected now and how much will remain due.
- Cancel, Discharge with Due, and Collect & Discharge remain on one line in the footer action group on desktop/tablet layouts.

## Data flow

1. Compute `enteredPayment = clamp(parsed input, 0, total payable)`.
2. Full CTA ignores `enteredPayment` and collects the full total.
3. Credit CTA validates the audited due fields.
4. For a partial credit collection, send up to the previous-invoice outstanding amount to `/api/settlements` with all mapped bill IDs.
5. Send any remaining partial amount as `paid_amount` on `/api/ip-billing/discharge-bill` with `discharge_mode: credit_pending`.
6. The discharge endpoint recomputes outstanding balances after the awaited settlement and creates the discharge bill and approval request atomically.

## Error handling

- Pending/unbilled services continue to block both actions.
- Refund safeguards remain unchanged.
- Full collection remains blocked when mapped previous invoices cannot be settled inline.
- Partial credit collection remains blocked when previous invoices cannot be settled inline; zero-collection credit discharge remains permitted.
- External settlement failure prevents the discharge mutation.

## Testing

Component tests will prove that:

- blank input still performs full collection;
- a smaller entered amount does not reduce the green full collection;
- partial credit collection settles previous invoices before the current IPD bill;
- zero-collection credit discharge performs no settlement request;
- full-or-overfull input is rejected from the credit path;
- the three footer actions use a non-wrapping action row.

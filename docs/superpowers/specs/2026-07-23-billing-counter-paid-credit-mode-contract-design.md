# Billing Counter Paid/Credit Mode Contract Design

## Problem

Billing-counter invoice creation currently accepts `billMode: "paid"` with zero cash payment and zero deposit application. The payment calculator correctly produces an open invoice with the full amount due, but the response and audit log retain `mode: "paid"`. This creates a misleading record: the operational workflow is credit/pay-later, while the requested mode says paid.

The system must continue supporting finalized unpaid diagnostic invoices. Those invoices must remain in the unpaid list, create the associated laboratory order, and be collectible later. The fix must not turn them into provisional items or block test processing.

A second inconsistency exists when `billMode: "credit"` carries stale payment or deposit values. Cash is already ignored for credit invoices, but deposit deduction is still applied while the stored bill remains fully due. That can consume a patient deposit without reducing the bill balance.

## Approved Behavior

### Effective invoice mode

The backend remains authoritative and derives an effective mode after server-side pricing and discount calculation:

1. `provisional` remains provisional and creates no final bill or settlement.
2. `credit` always means pay later. Immediate cash and deposit inputs are ignored, the full net total remains due, and status is `open` when the total is positive.
3. `paid` with a positive net total and at least one immediate settlement source (cash/payment or deposit) remains `paid` mode. It may finish as `partially_paid` or `paid` depending on the settled amount.
4. `paid` with a positive net total and zero immediate settlement is normalized to effective mode `credit`. This preserves the current one-click unpaid test workflow while correcting response and audit semantics.
5. `paid` with a zero net total, such as a 100% discount, remains effective mode `paid`, status `paid`, due `0`, and creates no payment row.

### Laboratory workflow

A finalized credit or partially paid diagnostic invoice still creates its lab order. Lab billing status is derived from the effective stored invoice state:

- effective due `0` -> lab bill status `paid`
- effective due greater than `0` -> lab bill status `unpaid`

No change is made to provisional billing behavior.

### Transaction safety

The route calculates one normalized settlement state and uses it consistently for:

- legacy `bills` values
- `payments`
- `emp_cash_transactions`
- `billing_deposits` adjustments
- canonical settlement projection
- strict canonical boundary checks
- lab-order billing status
- response payload
- audit payload

A credit invoice must never write a payment, cash transaction, or deposit adjustment from stale client fields.

### Canonical compatibility

Canonical strict mode currently supports billing-counter credit-only creation and rejects immediate settlement at this boundary. Normalizing zero-settlement paid requests to credit keeps that workflow compatible. Paid/deposit-bearing requests retain the existing strict-boundary behavior; this change does not bypass or weaken canonical policy.

Canonical projection receives the same normalized cash and deposit amounts used by the legacy batch. Therefore legacy and canonical authorities cannot disagree because of the requested UI mode.

### API transparency

Final invoice responses and audit records include:

- `requestedMode`: the client-selected mode
- `mode`: the effective mode
- `modeAdjusted`: whether normalization occurred
- `modeAdjustmentReason`: a stable reason when adjusted

For the known incident pattern, `requestedMode` is `paid`, effective `mode` is `credit`, and the reason is `zero_settlement_normalized_to_credit`.

### Frontend behavior

The Billing Counter UI derives the same effective settlement before sending:

- selected Pay now + positive total + zero cash/deposit -> send zero settlement while retaining requested `paid`; the backend records requested `paid` and effective `credit`
- explicit Credit/pay later -> cash and deposit are treated as zero
- full-discount zero-total Pay now -> remains effective `paid`
- an explicit zero-total Credit selection is settled as effective `paid`, because no receivable exists

Mode selection clears stale settlement fields when switching to Credit or Provisional. Success feedback distinguishes paid, partially paid, and credit invoices.

The Reception Patient Drawer treats deposit application as zero in credit mode and clears stale payment/deposit values when switching to credit.

Both invoice entry points retain the same idempotency key after ambiguous network errors, server errors, or an in-progress replay response. A new key is generated only after success or a definitive client error that requires a corrected request, preventing duplicate invoices when the server commit outcome is unknown.

## Out of Scope

- Enabling immediate payment in canonical strict mode for this boundary
- Changing due-collection API behavior
- Changing provisional billing semantics
- Retrospectively editing historical invoices
- Renaming database status values

## Verification Matrix

| Scenario | Effective mode | Paid | Deposit | Due | Status | Lab order |
|---|---|---:|---:|---:|---|---|
| Positive total, no settlement, requested paid | credit | 0 | 0 | full total | open | created as unpaid |
| Positive total, explicit credit with stale settlement fields | credit | 0 | 0 | full total | open | created as unpaid |
| Positive total, partial cash | paid | partial | 0 | remainder | partially_paid | created as unpaid |
| Positive total, deposit only | paid | 0 | applied | remainder/0 | partially_paid/paid | based on due |
| Positive total, full cash | paid | full | 0 | 0 | paid | created as paid |
| Zero net total after full discount | paid | 0 | 0 | 0 | paid | created as paid |
| Provisional | provisional | 0 | 0 | n/a | provisional | not finalized |

# Editable Performer Payout Override Design

## Goal

Allow reception cash operators to pay each diagnostic performer line at an amount different from its calculated/default reserve, while preserving the original amount, requiring an explanation, and keeping legacy and canonical compensation ledgers reconciled.

## Scope

The feature applies to both existing performer paths:

1. **Unassigned performer reserves** — billing did not select a performer; the payout operator selects the doctor later.
2. **Assigned performer accruals** — billing selected the performer and an accrual already belongs to that doctor.

It does not create or settle an external hospital/partner payable. A reduction caused by an external partner allocation is captured as the performer override reason only; partner accounting remains a separate workflow.

## User experience

Each payable row shows:

- calculated/default amount;
- editable final payout amount;
- increase/decrease difference;
- required reason when final differs from calculated.

Unchanged rows require no reason. Paid rows remain immutable; correction uses the existing settlement reversal flow.

## API contract

Both payout payloads accept a normalized `lineOverrides` array:

```ts
{
  lineOverrides?: Array<{
    lineId: number;
    payoutAmount: number;
    reason?: string;
  }>;
}
```

For reserve payout, `lineId` is a reserve ID. For assigned payout, it is an accrual ID.

Validation rules:

- every override line must be selected in the same request;
- duplicate line IDs are rejected;
- payout amount must be positive and no greater than the line's net/gross service amount;
- a reason of at least 3 characters is mandatory when the amount differs;
- an unchanged amount is normalized as no override;
- the idempotency hash includes normalized line overrides.

## Persistence

Add immutable payout evidence to `doctor_commission_settlement_items`:

- `calculated_commission_amount`: original calculated/default amount;
- `override_amount`: final line amount when changed;
- `override_reason`;
- `overridden_by`;
- `overridden_at`.

The existing `commission_amount` becomes the final amount actually settled for the line. The source reserve/accrual calculated values remain unchanged.

## Financial and canonical behavior

Settlement gross is the sum of final line amounts. Existing settlement-wide deductions remain separate.

Canonical compensation settlement accepts both original expected payable and final settlement payable for each accrual. Before allocation it reconciles the difference without rebuilding governed canonical tables:

- decrease: records an existing `manual_recovery` adjustment with reason `payout_override_decrease`, increasing adjusted amount and reducing payable;
- increase: increases earned/payable on the selected accrual and records immutable source-mapping evidence for the payout override;
- unchanged: no override evidence is required.

Then it settles the final payable amount. The invariant remains:

```text
earned = adjusted + settled + payable
```

Canonical source evidence includes direction, original amount, final amount, and reason.

## Audit and safety

The payout audit record includes every changed line with original amount, final amount, difference, and reason. Cash drawer, settlement, settlement-item, accounting event, and canonical totals all use the final payout amounts. Existing bill-paid, active-row, single-doctor, drawer-cash, accounting-period, idempotency, and reversal guards remain enforced.

## Tests

Cover:

- schema validation and normalization;
- reserve payout increase and decrease;
- assigned accrual payout override;
- missing reason, unknown/duplicate line, zero/excessive amount;
- canonical upward and downward override invariants;
- UI editing, difference display, reason requirement, and payload;
- unchanged legacy behavior when no override is supplied.

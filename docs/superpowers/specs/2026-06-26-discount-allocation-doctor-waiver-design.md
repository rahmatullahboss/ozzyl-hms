# Discount Allocation and Doctor Commission Waiver Design

## Problem

In real hospital billing, poor patients may receive a discount funded by multiple sources. A doctor may waive commission on prescribed tests, while the hospital may also give an additional discount. If the system stores only one discount amount, doctor payout can still calculate the full commission and create a mismatch.

## Product Decision

Keep the receptionist flow simple by default. Do not show separate boxes for every discount source.

Default billing UI:

```text
Discount amount / percent
Reason
Reference or approved by
```

Advanced detail appears only when needed, such as doctor commission waiver or high-discount approval.

## Discount Reasons

- `normal_hospital_discount`
- `poor_patient_charity`
- `doctor_commission_waiver`
- `management_approved`
- `reference_discount`

## Internal Allocation Types

- `hospital_discount`
- `charity_discount`
- `doctor_commission_waiver`
- `management_discount`
- `reference_discount`

The patient receipt can continue showing one total discount. Admin and finance reports can show source breakdown.

## Example

```text
Test bill:                    1000
Doctor eligible commission:    200
Entered discount:              300
Reason: Doctor commission waiver

Internal split:
Doctor waiver:                 200
Hospital funded discount:      100
Patient payable:               700
Doctor payable impact:          -200
```

If the entered doctor-waiver amount exceeds eligible doctor commission, the doctor waiver is capped and the remaining discount is hospital-funded.

## Data Model

Add `bill_discount_allocations` as a source-level discount ledger. Existing bill and settlement discount fields remain unchanged for backward compatibility.

Add optional doctor commission fields to `doctor_commission_accruals` for earned, waived, payable, paid, and balance tracking. Phase 1 does not force payout reports to switch immediately.

## Rollout

Phase 1 is additive and safe:

1. Store discount source allocations.
2. Add utility tests for allocation logic.
3. Add simple billing UI reason selector.
4. Keep existing discount amount and percentage fields working.

Phase 2 can migrate doctor payout reports to payable balance after production validation.

# Doctor Commission Rounding Reconciliation Design

## Problem

Percentage commission is currently rounded independently for every invoice line. For the live three-line case with commission bases BDT 163.64, BDT 981.82, and BDT 454.54 at 25%, the independently rounded earned amounts total BDT 400.01 although the bill-level base is exactly BDT 1,600 and the configured commission is exactly BDT 400. This also makes the doctor-waiver snapshot BDT 320.01 instead of BDT 320 under the 5% protected-floor policy.

## Approved behavior

For percentage rules, allocate each line as the difference between the rounded commission on the cumulative base after the line and the rounded commission on the cumulative base before the line. The allocation key is doctor, source type, incentive type, and commission rule, so unrelated doctors, roles, and rules never share rounding state.

Flat rules remain line-based. Performer reserve remains deducted before commission allocation. Doctor-waiver policy continues to calculate protected commission, maximum waiver, doctor waiver, and payable commission from the allocated earned amount.

The same cumulative percentage allocation must be used by both preview and bill accrual paths so the amount shown before billing matches persisted accruals. Canonical dual-write validation must receive the cumulative base before each line and validate the allocated delta instead of recalculating that line in isolation.

## Expected live-case result

For bases BDT 163.64, BDT 981.82, and BDT 454.54:

- total commission base: BDT 1,600.00
- earned commission at 25%: BDT 400.00
- protected payable at 5%: BDT 80.00
- maximum doctor waiver: BDT 320.00

## Testing

Add a regression test reproducing the three-line protected-floor invoice. The test must fail against the current independent line-rounding implementation and pass after cumulative allocation is introduced. Existing lab-finance tests, TypeScript checks, and build must remain green.

## Production data correction

After code verification, correct only tenant example, bill 7085 (`INV-DEMO-000791`), accrual rows 2910–2912 and allocation rows 394–395 so the aggregate earned commission is BDT 400.00, doctor waiver is BDT 320.00, hospital discount is BDT 80.00, and payable commission remains BDT 80.00. Preserve exact tenant, bill, doctor, and row guards and verify with fresh read-only queries.

# Discount UX and Doctor Waiver Implementation Plan

## Current state
- Scheme / benefit preview is already present in reception billing flows.
- Final pending-service billing already has doctor-waiver preview support.
- Discount allocation exists, but the UX was too hidden and the source choices were too plain.

## Implemented now
- Allocation editor now keeps Advanced / Split visible.
- Source choices now use colored chip buttons.
- Doctor waiver source is capped to the eligible doctor payable amount.
- Doctor waiver is not auto-selected just because a discount exists; it applies only after the user opens Advanced / Split and selects Doctor waiver.
- Any remaining discount automatically falls back to Hospital discount.
- Simple mode remains backward-compatible as Hospital discount.
- Add Service doctor selector was moved into the compact left-side layout.

## Implemented detail
- Doctor-waiver preview is wired into quick bill, add-service, and final-bill flows, but it is only used after Doctor waiver is selected from Advanced / Split.

## Next phase
- Expose lab_test_id from service catalog so test-specific commission rules match exactly.
- Add Billing Master configuration for labels, colors, approval limits, and scheme-to-source defaults.
- Add approval policy integration for Management, Owner, Charity, VIP, Staff, and Shareholder sources.

## Accounting rule
Doctor waiver must only reduce the doctor commission/payable portion. Discount entry alone must not waive doctor commission. Hospital income should only absorb the remaining discount unless another source is explicitly selected.

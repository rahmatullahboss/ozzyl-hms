# Reception Doctor Waiver Quick Action Design

## Goal

Make Hospital discount and Doctor waiver equally easy to select in reception test/service billing while preserving the existing accounting rule that doctor waiver can reduce only the selected doctor's eligible commission.

## Approved Interaction

1. The receptionist enters the total discount amount first.
2. `Hospital` remains the default source.
3. `Doctor waiver` is always visible beside `Advanced / Split`; it is not hidden inside advanced mode.
4. Clicking `Doctor waiver` once immediately enables source allocation and recalculates the entire discount:
   - If eligible doctor commission is greater than or equal to the entered discount, the full discount is funded from doctor commission.
   - If eligible doctor commission is lower than the entered discount, doctor waiver is capped at that commission and the remainder becomes Hospital discount.
5. Selecting Doctor waiver automatically fills `Discount referred by` with the selected internal doctor's name.
6. The auto-filled reference remains a normal editable input. Later waiver-preview refreshes must not overwrite a receptionist's manual edit.
7. Selecting Hospital resets the allocation to a full Hospital discount.
8. Management, Charity, Staff, VIP, Owner, Shareholder, and detailed split controls remain under `Advanced / Split`.

## Shared UX

`DiscountAllocationEditor` is the shared source-of-truth component for F2 quick test billing, Today's Patient Flow add-service billing, and final visit billing. After a discount amount is entered, the same primary-source controls appear in the F2 and add-service flows so the interaction does not drift between screens.

## Accounting Safety

The existing allocation helper remains authoritative:

- `doctorAmount = min(totalDiscount, eligibleDoctorCommission)`
- `hospitalAmount = totalDiscount - doctorAmount`
- No selected internal doctor or no eligible commission means the doctor row carries no amount and the full discount remains Hospital-funded.
- Receipt printing continues to show only the total patient discount; internal source allocation remains an accounting detail.

## State and Events

`DiscountAllocationEditor` exposes an explicit-source callback fired only from a receptionist click. Parent billing flows use that callback to auto-fill the doctor's name. Automatic commission-preview recalculation updates allocation rows only and does not fire the callback, protecting manual reference edits.

## Tests

- Verify a discount smaller than commission is fully doctor-funded.
- Verify a discount larger than commission is split between doctor and hospital.
- Verify Hospital and Doctor waiver are visible before advanced mode opens.
- Verify one Doctor waiver click enables allocation, replaces the full source allocation, and emits the explicit-source callback.
- Verify reception billing flows wire the callback to the appropriate editable reference field.
- Verify the add-service flow renders the shared editor after a discount is entered rather than hiding Doctor waiver behind its separate Advanced button.

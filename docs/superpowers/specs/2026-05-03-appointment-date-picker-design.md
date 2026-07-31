# Spec: Add Date Picker to Book Appointment Modal

## Problem
The Book Appointment modal has no date input. The date is locked to whatever date the user has selected on the main scheduler page before opening the modal. To book for a different date, the user must close the modal, navigate to the new date, then reopen the modal — wasting all filled data.

## Solution
Add a `type="date"` input to the `BookModal` component so the date can be changed directly within the modal without leaving the page.

## Changes

### File: `web/src/pages/AppointmentScheduler.tsx`

**`BookModal` component** (line ~120):
- Add `const [localDate, setLocalDate] = useState(date)` — local state initialized from prop
- Add date input field in the form, placed alongside the time field in the grid layout
- On submit, send `localDate` instead of prop `date`
- Display `fmtDate(localDate)` in the header instead of `fmtDate(date)`

**Layout change:**
```
Row: Doctor (dropdown)   | Date (date input)
Row: Time (opt.)         | Visit Type (dropdown)
Row: Fee
Row: Chief Complaint (textarea)
```

## Behavior
- Date defaults to whatever date the parent scheduler has selected (existing UX preserved)
- User can override to any valid date directly in the modal
- No backend API changes needed — `/api/appointments` POST already accepts `apptDate`
- On successful booking, the modal closes normally (parent's selected date unchanged)

## Files Affected
- `web/src/pages/AppointmentScheduler.tsx` — only file changed
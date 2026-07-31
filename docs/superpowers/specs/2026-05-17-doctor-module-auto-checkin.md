# Doctor Module Auto Check-in Guard

Date: 2026-05-17

## Requirement

If reception forgets to check in or send a patient to the room, the doctor module must still make the patient flow consistent when the doctor opens or starts the visit.

## Required Behavior

- Doctor-side `Start visit`, `Open visit`, or future consultation action must call a backend transition, not only change UI state.
- If the appointment is still `scheduled`, the backend should check it in first.
- If a waiting queue entry exists, the backend should move it to `serving`.
- If a visit exists or is created during check-in, the backend should move it to `engaged`.
- The transition must be idempotent, so repeated doctor clicks do not create duplicate visits, duplicate queue entries, or duplicate billing rows.
- Billing rules stay unchanged: unpaid appointments should not silently bypass required payment unless the appointment type is no-charge, due-approved, or otherwise already allowed by the existing queue eligibility logic.

## Implementation Note

Reuse the appointment check-in transition that supports `sendToRoom: true`. If the doctor module needs a doctor-specific route later, that route should delegate to the same state transition logic instead of duplicating status updates.


# Connected Visit Flow Design

> Date: 2026-04-11
> Scope: Phase 1 of the patient-first platform vision
> Goal: Make booking, queue visibility, doctor readiness, and patient arrival timing work as one connected flow across hospital software and patient portal

## Why This Phase First

The biggest immediate patient pain is not AI, wearables, or advanced privacy. It is:

- not knowing if booking is confirmed
- not knowing when to go to the hospital
- waiting too long without visibility
- not knowing current serial and estimated wait
- not knowing whether the doctor is actually ready to see them

If Ozzyl solves this well, patients feel immediate value and hospitals also benefit from smoother front-desk operations.

## Product Outcome

After this phase:

- a patient books or requests an appointment from the portal
- the hospital system confirms and manages that visit
- the patient can see booking status, token/serial, current queue progress, estimated wait time, and suggested arrival window
- the doctor/reception flow can update queue status from the hospital side
- the patient portal reflects those changes quickly enough to be useful

## Guiding Principles

- patient view must stay simple
- hospital workflow must stay operationally realistic for Bangladesh
- queue data should come from the same source of truth used by reception/front desk
- avoid fake precision; ETA should be approximate and clearly labeled
- do not require doctors to use chat or extra clicks for this phase

## User Experience

## Patient Portal

The patient should see a single visit card for the selected hospital with:

- booking status
- doctor name
- department
- date and time
- token/serial number
- current serving number
- patients ahead
- estimated wait
- arrival guidance:
  - leave now
  - arrive in 15-20 min
  - queue paused / delayed

The patient should also see:

- upcoming appointments
- completed recent visits
- cancelled/no-show history
- quick actions:
  - book appointment
  - reschedule if allowed
  - cancel if allowed
  - view live queue

## Hospital Software

Reception/queue management remains the control surface.

Hospital staff should be able to:

- confirm or adjust appointment status
- issue or update token/serial
- call next patient
- mark called / serving / completed / no-show / transferred
- assign counter/room
- optionally link queue entry to appointment or visit

Doctor workflow does not need a new complex UI in this phase. The main requirement is:

- when a patient is marked `serving`, the doctor-facing system can identify the active patient quickly

## Core Design Decision

Use the queue system as the live operational source of truth and let the patient portal derive its live visit state from:

1. appointment record
2. queue entry
3. doctor/department schedule context

This avoids maintaining two separate real-time visit truths.

## Canonical Visit State

For patient-facing connected visits, the portal will compute a derived status:

- `requested`
- `scheduled`
- `confirmed`
- `checked_in`
- `waiting`
- `called`
- `serving`
- `completed`
- `cancelled`
- `no_show`
- `delayed`

Mapping rules:

- appointment `scheduled` with no queue entry yet -> `scheduled`
- appointment linked to active queue entry with queue status `waiting` -> `waiting`
- queue status `called` -> `called`
- queue status `serving` -> `serving`
- queue status `completed` or visit concluded -> `completed`
- queue status `no_show` -> `no_show`

`delayed` is derived, not stored, when the queue is active but estimated wait exceeds a threshold against original slot time.

## Data Model Changes

This phase should avoid large disruptive schema changes.

### Add to Appointment or Queue Linkage

If missing, add small linkage fields:

- queue entry can reference `appointment_id`
- patient portal appointment payload can expose:
  - `token_no`
  - `queue_status`
  - `patients_ahead`
  - `estimated_wait_minutes`
  - `current_serving_token`
  - `counter_no`
  - `doctor_ready`

### Doctor Readiness

Do not invent a full doctor presence system yet.

For Phase 1, `doctor_ready` should be inferred from practical signals:

- there is active queue movement for that doctor/department today
- or the doctor has an active schedule block for the current period

If inference is weak, show softer copy such as `queue active` rather than claiming doctor presence.

## API Design

## New Patient Portal Endpoint Layer

Add a patient-facing connected visit endpoint under tenant patient portal APIs:

- `GET /api/patient-portal/live-visit-status`

Response:

- selected appointment summary
- linked queue entry summary
- queue progress summary
- arrival guidance

Example fields:

- `appointment`
- `queue`
- `current_serving`
- `patients_ahead`
- `estimated_wait_minutes`
- `suggested_arrival_window`
- `status_label`
- `status_explanation`

## Queue API Reuse

Reuse current queue routes where possible, but do not expose raw staff queue payloads directly to the patient portal.

Instead:

- patient portal adapter reads queue state
- sanitizes it
- returns only patient-appropriate fields

## Refresh Model

For production simplicity:

- use polling first, not websockets
- patient portal live visit card refreshes every 30-60 seconds when visit is active
- hospital queue screen can keep existing frequent refresh behavior

This is sufficient for a first production-ready slice and easier to harden.

## ETA and Arrival Guidance

ETA must be explainable.

Use:

- number of waiting/called patients ahead
- average serve duration from completed entries today
- fallback default when insufficient data

Patient-facing copy should be approximate:

- `About 20 minutes`
- `About 3 patients ahead`
- `Queue is moving slower than usual`

Never promise exact doctor time.

## Permissions and Simplicity

The user explicitly wants simple privacy behavior for Bangladesh market conditions.

So for this phase:

- no complex consent gating inside the live queue flow
- patient can see their own queue and booking information
- patient can see public operational context like current serving token
- no doctor chat requirement

## UI Changes

## Patient Dashboard

Add or upgrade:

- live visit status card on overview
- booking status emphasis
- simple arrival guidance
- one-click path to hospital services tab

## Hospital Services Tab

Upgrade with:

- live queue panel
- token/serial panel
- current serving panel
- estimated wait panel
- appointment actions

Messaging remains secondary and should not dominate the screen.

## Failure Handling

- if queue system is unavailable, still show appointment record
- if ETA is unavailable, show token and queue status only
- if no linked appointment exists, do not show live queue panel
- if patient is not linked to selected hospital, show instructional state

## Testing

Required for this phase:

- helper tests for derived patient visit status
- API contract tests for `live-visit-status`
- UI tests for:
  - waiting state
  - called state
  - serving state
  - delayed state
  - no-queue fallback

## Out of Scope

This phase will not include:

- doctor chat as a primary workflow
- advanced consent workflows
- wearable sync
- AI scheduling optimization
- websocket infrastructure unless polling proves inadequate

## Recommended Implementation Slice

Implement in this order:

1. backend patient-facing `live-visit-status` adapter
2. helper logic for derived visit state and ETA labels
3. patient hospital services live queue UI
4. patient dashboard live visit summary card
5. focused tests and smoke verification

## Success Criteria

This phase is successful when:

1. a patient can see whether a booking is actually active
2. a patient can see their token/serial and current queue movement
3. a patient can estimate when to leave for the hospital
4. hospital queue updates reflect in patient portal without staff doing duplicate work
5. the patient interface remains simple enough for non-technical everyday users

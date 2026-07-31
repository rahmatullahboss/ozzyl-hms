# Reception Flow Bug Fixes — 2026-05-15

## Problem Statement

Three bugs in the Reception Dashboard's "Today's Patient Flow" section and appointment creation flow:

1. **Send to Room button persists** after patient is concluded from doctor's room
2. **"Already has appointment" error** when trying to create a `report_show` appointment for a patient who already has a completed same-day visit
3. **Pending Bill badge** remains after paying at appointment time via "Pay and Print"

---

## Bug 1: Send to Room After Concluded

### Current Behavior

In `ReceptionDashboard.tsx` lines 1334-1355, the action buttons for a visit row are:

- **LogIn (Send to Room):** Always shown when `row.visit` exists (line 1336-1343)
- **LogOut (Out of Room):** Shown when status matches `/engaged|in_room|serving|arrived|checked_in/` (line 1344-1353)

After a patient is marked `concluded`, the status badge updates correctly but the "Send to Room" button remains visible. Reception can incorrectly re-send a concluded patient to a room.

### Fix

1. **Hide "Send to Room" when `status === 'concluded'`**

   Add condition to the LogIn button at line 1336:

   ```tsx
   {row.visit && String(row.status ?? '').toLowerCase() !== 'concluded' && (
     <button
       className="btn-ghost p-2"
       onClick={() => updateVisitStatusMutation.mutate({ visitId: row.visit!.id, status: 'engaged' })}
       disabled={updateVisitStatusMutation.isPending}
       title="Send to Room"
     >
       <LogIn className="h-4 w-4" />
     </button>
   )}
   ```

2. **Show "Report Show" button when `status === 'concluded'`**

   After the LogOut button block (after line 1353), add:

   ```tsx
   {String(row.status ?? '').toLowerCase() === 'concluded' && row.patient && (
     <button
       className="btn-ghost p-2 text-purple-600"
       onClick={() => openAppointmentModal(row.patient, null, 'report_show')}
       title="Report Show"
     >
       <FileText className="h-4 w-4" />
     </button>
   )}
   ```

   The `FileText` icon is already imported at line 7.

---

## Bug 2: Report Show Blocked by Duplicate Check

### Current Behavior

In `src/routes/tenant/appointments.ts` lines 996-1008, the `checkPatientDoctorSameDayAppointment` function is called for all appointment types during creation. If a patient already has any appointment with the same doctor on the same date, it returns a 409 error:

```typescript
if (duplicate.conflictingAppointmentId) {
  return c.json({
    message: 'Patient already has appointment with this doctor on this date',
    conflictingAppointmentId: duplicate.conflictingAppointmentId,
  }, 409);
}
```

`report_show` appointments are meant for patients who already completed their room consultation and are returning to show test results. Blocking them with this duplicate check prevents legitimate use cases.

### Fix

Wrap the duplicate check in a condition that skips it for `report_show` appointment type. In the POST handler (around line 996), add a guard before calling `checkPatientDoctorSameDayAppointment`:

```typescript
// Skip duplicate check for report_show — patient is returning with test results
const appointmentType = normalizeAppointmentType(data.appointmentType ?? null);
if (appointmentType !== 'report_show') {
  const duplicate = await checkPatientDoctorSameDayAppointment(
    db,
    tenantId,
    data.patientId,
    data.doctorId ?? null,
    data.apptDate,
  );
  if (duplicate.conflictingAppointmentId) {
    return c.json({
      message: 'Patient already has appointment with this doctor on this date',
      conflictingAppointmentId: duplicate.conflictingAppointmentId,
    }, 409);
  }
}
```

Also apply the same fix in the PUT (update) handler around line 1139, since updating an existing appointment to `report_show` type could also trigger the duplicate check.

---

## Bug 3: Pending Bill Badge After Pay and Print

### Current Behavior

When a new patient appointment is created and paid immediately via "Pay and Print," the appointment's `billing_status` is correctly set to `paid`. However, the "Today's Patient Flow" list at lines 1249-1258 calculates `needsConsultationPayment` using:

```typescript
const appointmentPendingAmount = Number(
  row.appointment?.final_fee
  ?? row.appointment?.total_amount
  ?? row.appointment?.fee
  ?? row.appointment?.consultation_fee
  ?? 0,
);
const consultationBillingPending = row.appointment
  && ['pending', 'unpaid', 'partial_paid', 'partially_paid'].includes(String(row.billingStatus ?? '').toLowerCase());
const needsConsultationPayment = Boolean(consultationBillingPending && !hasInvoice && appointmentPendingAmount > 0);
```

The `billingStatus` is sourced from `matchingAppointment?.billing_status` at line 795. However, after Pay and Print, the appointment row's `billing_status` may still be `pending` if the backend doesn't immediately update it, or the check at line 1257 may be missing `paid` / `settled` states.

### Fix

**Option A (Recommended):** Add `paid` and `settled` to the negative list in the billing status check at line 1257:

```typescript
const consultationBillingPending = row.appointment
  && ['pending', 'unpaid', 'partial_paid', 'partially_paid', 'partial'].includes(
    String(row.billingStatus ?? '').toLowerCase()
  );
```

**Option B:** Check the appointment's `billing_status` field directly from the API response to confirm it is `paid`. If `billing_status === 'paid'` or `billing_status === 'settled'`, skip the `needsConsultationPayment` flag entirely.

---

## Files to Modify

| File | Change |
|------|--------|
| `web/src/pages/ReceptionDashboard.tsx` | Bug 1: Add `status !== 'concluded'` condition to LogIn button; add Report Show button for concluded status |
| `web/src/pages/ReceptionDashboard.tsx` | Bug 3: Fix `consultationBillingPending` logic to exclude `paid` / `settled` billing_status |
| `src/routes/tenant/appointments.ts` | Bug 2: Skip duplicate check for `report_show` appointment type in POST and PUT handlers |

---

## Acceptance Criteria

1. After a patient is concluded from a doctor's room, the "Send to Room" button is hidden and a "Report Show" button appears instead
2. Creating a `report_show` appointment for a patient who already has a same-day completed visit no longer throws "Already has appointment" error
3. After paying at appointment time via "Pay and Print," the "Pending Bill" badge does NOT appear in the Today's Patient Flow list
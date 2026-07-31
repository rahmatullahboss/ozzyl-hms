# Reception Flow Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 bugs in ReceptionDashboard: (1) hide "Send to Room" button after patient is concluded, show "Report Show" instead; (2) allow `report_show` appointments even when patient already has a same-day visit; (3) don't show "Pending Bill" badge after paying at appointment time.

**Architecture:** 3 independent file changes — ReceptionDashboard.tsx (frontend button logic + billing status), appointments.ts (backend duplicate-check skip for report_show in POST and PUT).

**Tech Stack:** React/TypeScript (frontend), Hono/Drizzle (backend).

---

## Task 1: Bug 1 — Fix Send to Room and add Report Show button

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx:1336-1355`

- [ ] **Step 1: Add `status !== 'concluded'` guard to Send to Room button**

Change line 1336 from:
```tsx
<button
  className="btn-ghost p-2"
  onClick={() => updateVisitStatusMutation.mutate({ visitId: row.visit!.id, status: 'engaged' })}
  disabled={updateVisitStatusMutation.isPending}
  title="Send to Room"
>
  <LogIn className="h-4 w-4" />
</button>
```

To:
```tsx
{String(row.status ?? '').toLowerCase() !== 'concluded' && (
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

- [ ] **Step 2: Add Report Show button for concluded patients**

After line 1353 (after the `</>` closing the LogOut button's conditional), before line 1355 (`) : null}`), add:

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

Note: `FileText` is already imported at line 7, `openAppointmentModal` is available in scope, and `row.patient` is typed as `Patient | null`.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ReceptionDashboard.tsx
git commit -m "fix(reception): hide Send to Room for concluded patients, add Report Show button

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Bug 2 — Skip duplicate check for report_show in POST handler

**Files:**
- Modify: `src/routes/tenant/appointments.ts:996-1008`

- [ ] **Step 1: Wrap duplicate check in report_show guard**

Replace lines 996-1008:

```typescript
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
```

With:

```typescript
    // Skip duplicate check for report_show — patient is returning with test results
    const incomingAppointmentType = normalizeAppointmentType(data.appointmentType ?? null);
    if (incomingAppointmentType !== 'report_show') {
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

Note: `normalizeAppointmentType` is imported at line 25 and `appointmentType` is already defined at line 974 just before this block — use `incomingAppointmentType` to avoid naming conflict with the existing `appointmentType` variable.

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/appointments.ts
git commit -m "fix(reception): skip duplicate check for report_show appointment type

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Bug 2 — Skip duplicate check for report_show in PUT handler

**Files:**
- Modify: `src/routes/tenant/appointments.ts:1139-1152`

- [ ] **Step 1: Wrap duplicate check in report_show guard in update handler**

Replace lines 1139-1152:

```typescript
      const duplicate = await checkPatientDoctorSameDayAppointment(
        db,
        tenantId,
        Number(existing.patientId),
        data.doctorId ?? existing.doctorId,
        data.apptDate ?? existing.apptDate,
        id,
      );
      if (duplicate.conflictingAppointmentId) {
        return c.json({
          message: 'Patient already has appointment with this doctor on this date',
          conflictingAppointmentId: duplicate.conflictingAppointmentId,
        }, 409);
      }
```

With:

```typescript
      // Skip duplicate check for report_show — patient is returning with test results
      const nextAppointmentType = normalizeAppointmentType(data.appointmentType ?? existingAppointmentType ?? existing.visitType);
      if (nextAppointmentType !== 'report_show') {
        const duplicate = await checkPatientDoctorSameDayAppointment(
          db,
          tenantId,
          Number(existing.patientId),
          data.doctorId ?? existing.doctorId,
          data.apptDate ?? existing.apptDate,
          id,
        );
        if (duplicate.conflictingAppointmentId) {
          return c.json({
            message: 'Patient already has appointment with this doctor on this date',
            conflictingAppointmentId: duplicate.conflictingAppointmentId,
          }, 409);
        }
      }
```

Note: `existingAppointmentType` is already defined at line 1170 (before the `recalculatedFee` block), so we reuse it here. `nextAppointmentType` is the same normalization used at line 1171 for fee calculation — this is intentional so the duplicate-check guard uses the same type resolution.

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/appointments.ts
git commit -m "fix(reception): skip duplicate check in update handler for report_show

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Bug 3 — Fix pending bill badge after Pay and Print

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx:1256-1258`

- [ ] **Step 1: Add 'partial' to billing status check**

Change line 1257 from:
```typescript
&& ['pending', 'unpaid', 'partial_paid', 'partially_paid'].includes(String(row.billingStatus ?? '').toLowerCase());
```
To:
```typescript
&& ['pending', 'unpaid', 'partial_paid', 'partially_paid', 'partial'].includes(String(row.billingStatus ?? '').toLowerCase());
```

- [ ] **Step 2: Verify billing status is excluded when paid**

The `needsConsultationPayment` variable at line 1258 checks `consultationBillingPending && !hasInvoice && appointmentPendingAmount > 0`. If `billing_status` is set to `paid` or `settled` after Pay and Print, `'paid'` and `'settled'` are NOT in the list at line 1257, so `consultationBillingPending` becomes `false` and the badge won't show. This is already correct — the bug was the missing `'partial'` variant.

If after testing the badge still shows, the follow-up check should be: confirm the API response for the appointment has `billing_status = 'paid'` after Pay and Print (check the `/api/appointments/:id` or `/api/dashboard/today-work` endpoint). But based on code inspection, the current fix should resolve it.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ReceptionDashboard.tsx
git commit -m "fix(reception): include 'partial' in billing status check for pending badge

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Verification Checklist

After implementing all 4 tasks, test each scenario:

1. **Bug 1:** Conclude a patient from a doctor's room → "Send to Room" button is gone, "Report Show" (FileText) button appears
2. **Bug 2:** Create a `report_show` appointment for a patient who already has a same-day completed visit → no "Already has appointment" error; appointment is created successfully
3. **Bug 3:** Create a new patient appointment and pay immediately via "Pay and Print" → in Today's Patient Flow list, no "Pending Bill" badge appears
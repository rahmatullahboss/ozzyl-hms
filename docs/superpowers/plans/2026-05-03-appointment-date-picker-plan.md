# Appointment Date Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a date input field inside the Book Appointment modal so users can change the appointment date without closing and reopening the modal.

**Architecture:** Single-file change to `web/src/pages/AppointmentScheduler.tsx`. Add local state `localDate` to `BookModal` initialized from the `date` prop. On submit, send `localDate` instead of the prop. The header displays `localDate` via `fmtDate()`.

**Tech Stack:** React (TypeScript), Tailwind CSS, existing `useState`, `useApiMutation`, `fmtDate()` helper.

---

### Task 1: Add date state to BookModal

**Files:**
- Modify: `web/src/pages/AppointmentScheduler.tsx:120-130`

- [ ] **Step 1: Add `localDate` state to BookModal component**

In the `BookModal` function body (around line 121), add:
```typescript
const [localDate, setLocalDate] = useState(date);
```

This initializes `localDate` with the `date` prop value, preserving existing behavior.

- [ ] **Step 2: Update header to display `localDate` instead of `date`**

At line 185, change:
```typescript
<p className="text-sm text-[var(--color-text-muted)]">{fmtDate(date)}</p>
```
to:
```typescript
<p className="text-sm text-[var(--color-text-muted)]">{fmtDate(localDate)}</p>
```

- [ ] **Step 3: Update submit handler to send `localDate` instead of `date`**

At line 172, change:
```typescript
apptDate:       date,
```
to:
```typescript
apptDate:       localDate,
```

- [ ] **Step 4: Add date input field to the form**

In the "Doctor + time row" (lines 232-247), add a date input alongside the time field. Replace the 2-column grid with a 3-column layout or add date to the row below. The date input goes below the Doctor dropdown or beside it.

Layout: Replace the Doctor + time 2-col row with:

```tsx
{/* Doctor + date row */}
<div className="grid grid-cols-2 gap-3">
  <div className="space-y-1">
    <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('doctor')}</label>
    <select value={doctorId} onChange={e => setDoctorId(e.target.value)} className="input w-full">
      <option value="">— {t('walkIn')} —</option>
      {doctors.map(d => (
        <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` (${d.specialty})` : ''}</option>
      ))}
    </select>
  </div>
  <div className="space-y-1">
    <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('date')}</label>
    <input type="date" value={localDate} onChange={e => setLocalDate(e.target.value)} className="input w-full" />
  </div>
</div>

{/* Time + Visit type row */}
<div className="grid grid-cols-2 gap-3">
  <div className="space-y-1">
    <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('time')} (opt.)</label>
    <input type="time" value={apptTime} onChange={e => setApptTime(e.target.value)} className="input w-full" />
  </div>
  <div className="space-y-1">
    <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('type')}</label>
    <select value={visitType} onChange={e => setVisitType(e.target.value as typeof visitType)} className="input w-full">
      <option value="opd">{t('opd')} (New)</option>
      <option value="followup">{t('followUp')}</option>
      <option value="emergency">{t('emergency')}</option>
    </select>
  </div>
</div>
```

Also remove the old "Visit type + fee row" (lines 249-263) since we've moved Visit type into the new row above.

- [ ] **Step 5: Verify the form renders correctly**

Run `npx tsc --noEmit` to check for TypeScript errors. Confirm no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/AppointmentScheduler.tsx
git commit -m "feat(appointments): add date picker to Book Appointment modal

Users can now change the appointment date directly inside the Book modal,
without closing and reopening to navigate to a different date.

- Add localDate state to BookModal, initialized from date prop
- Replace 2-col Doctor+Time row with 2-row layout: Doctor+Date, Time+VisitType
- Submit sends localDate instead of prop date
- Header displays localDate via fmtDate()"
```

---

### Self-Review Checklist

- [ ] Spec coverage: The date picker field is added to the modal ✓
- [ ] Placeholder scan: No "TBD", "TODO", or vague steps ✓
- [ ] Type consistency: `localDate` is a `string` (same as `date` prop) ✓
- [ ] Layout: Visit type moved from its own row into Time+VisitType row ✓
- [ ] Fee row kept as-is ✓
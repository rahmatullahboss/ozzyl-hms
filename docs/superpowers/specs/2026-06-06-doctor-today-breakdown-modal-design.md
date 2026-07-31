# Doctor Today — Clickable Doctor Breakdown Modal

**Date:** 2026-06-06
**Status:** Approved (pending implementation)
**Type:** Frontend-only UX enhancement

---

## Problem

The Hospital Admin Dashboard's "Doctor Today" card (`HospitalAdminDashboard.tsx:1350-1421`) already shows per-doctor totals:

- Patients count
- Tests ordered
- Doctor commission
- Net hospital income

But the **net hospital income** number (e.g. `৳500`) is a derived figure. The dashboard row does not break it down into:
- How much came from patient visits (`doctor_visit_amount`)
- How much came from tests (`test_collection_amount`)
- How much went out as commission
- How the difference produces the net

Hospital admins reviewing today's collection cannot, at a glance, verify the math or see *which* revenue line is dominant. The other report pages (Doctor Performance, Reception Reports) already expose this breakdown, but the at-a-glance dashboard hides it.

## Goal

Make each doctor row in the Doctor Today table clickable. On click, open a modal that breaks down the math behind the net hospital income, using data already aggregated in the existing `DoctorDailySummary` payload.

## Non-Goals

- Adding new server fields or aggregating additional data
- Drill-down to individual visits, bills, or lab orders (the user explicitly asked for summary numbers only)
- Making the "Unassigned / No Doctor" row clickable (no `doctor_id`)
- Adding a "Print" or "Export" action in the modal (the existing Full Report button still handles that)
- Cross-day range or date picker in the modal (Doctor Today is always today)
- I18n of the new strings (the surrounding card uses literal English; we follow the same convention to avoid partial translations)

## Design

### Approach: new component using the shared `Modal`

Create one new file:
- `web/src/components/dashboard/DoctorTodayBreakdownModal.tsx` — receives the selected `DoctorDailySummary` and a `today` date string, renders the shared `Modal` with a key/value breakdown.

`HospitalAdminDashboard.tsx` changes:
- Import the new component and the shared `Modal` is **not** imported here (the child imports it directly).
- Add `const [selectedDoctor, setSelectedDoctor] = useState<DoctorDailySummary | null>(null);`
- Make the doctor `<tr>` clickable: `onClick={() => setSelectedDoctor(doctor)}`, `className="cursor-pointer hover:bg-[var(--color-bg-secondary)]"`.
- Skip the click handler on the "Unassigned / No Doctor" row (it has `doctor_id` 0 or null and the user explicitly said only real doctors drill down).
- Render `<DoctorTodayBreakdownModal doctor={selectedDoctor} onClose={() => setSelectedDoctor(null)} />` next to the card so layout isn't disturbed.

### Modal content

The modal is a single column of right-aligned `key: value` rows. Bold the totals and the net. The structure is:

```
┌─────────────────────────────────────────────┐
│ Dr. Example Three                    ×     │
│ Today — 2026-06-06                          │
├─────────────────────────────────────────────┤
│  Patients seen              1               │
│  Tests ordered              1               │
│                                             │
│  Revenue from patients      ৳1,000         │  ← doctor_visit_amount
│  Revenue from tests         ৳200           │  ← test_collection_amount
│  Total collection           ৳1,200         │  ← sum (bold)
│  ─────────────────────────────────────      │
│  Commission paid out        ৳700           │  ← commission_amount (amber)
│  ─────────────────────────────────────      │
│  Net hospital income        ৳500           │  ← (collection − commission, big emerald)
└─────────────────────────────────────────────┘
```

Colors match the parent card: `text-amber-700` for commission, `text-emerald-700` for the net. `formatCurrency` is reused from the dashboard.

### Edge cases

- `selectedDoctor` is `null` → modal not rendered (no empty-modal flash).
- Missing numeric fields default to `0` via `Number(doctor.x || 0)`, matching the parent's existing pattern.
- Negative net (commission exceeds collection) is **not** floored at 0 in the modal — we show the real number so the admin sees the problem. The parent card still uses `Math.max(…, 0)` for the at-a-glance number.
- ESC and backdrop close the modal (already handled by shared `Modal`).

### Testing

Update `web/src/pages/HospitalAdminDashboard.test.tsx` to:
1. Render the card with two real doctors in `dailyCollectionData`.
2. Click a doctor row → assert modal opens with the doctor's name and the right numbers.
3. Click "Unassigned" row → assert modal does **not** open.
4. Press ESC → assert modal closes.

Reuse the existing `dailyCollectionData` factory from the test if present; otherwise add the smallest possible mock covering all five numeric fields.

## Files Touched

- `web/src/components/dashboard/DoctorTodayBreakdownModal.tsx` (new, ~70 lines)
- `web/src/pages/HospitalAdminDashboard.tsx` (~10 line delta: import, state, onClick, render)
- `web/src/pages/HospitalAdminDashboard.test.tsx` (add ~30 lines of new test cases)

No backend, no migrations, no API changes.

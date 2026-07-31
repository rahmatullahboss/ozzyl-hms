# Clinical Summary Redesign — Nurse Station
> Date: 2026-05-03
> Status: Approved

## Goal

Redesign the clinical-summary tab in NursingDashboard to use card-based UI with visual charts, following healthcare UX best practices:
- **Three-Second Rule**: nurse identifies critical patient within 3 seconds
- **Card-based layouts**: group related data visually
- **Color-coded severity**: red/amber/green with icon reinforcement
- **Progressive disclosure**: show critical info first, expand as needed
- **Trend over snapshot**: sparkline charts for vital signs

## Scope

Redesign only the `clinical-summary` tab in `NursingDashboard.tsx` (lines 768–821).
No changes to API, backend, or other tabs.

---

## Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  Patient Header Card                                │
│  [Avatar] Name · Code · Ward/Bed · Doctor           │
│           Diagnosis · Admission date                 │
└─────────────────────────────────────────────────────┘
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│   BP     │ │   HR     │ │   Temp   │ │   SpO₂   │  │
│  125/82  │ │   78     │ │  99.1°F  │ │   97%    │  │
│ [bar]    │ │ [bar]    │ │ [bar]    │ │ [bar]    │  │
│ Normal   │ │ Normal   │ │ ⚠ Warm   │ │ Normal   │  │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

┌─────────────────────────────────────────────────────┐
│  SpO₂ Trend Chart (24h bar chart)                  │
└─────────────────────────────────────────────────────┘

[ Allergies (2) ] [ Medications ] [ Labs ] [ Diagnoses ]

┌─────────────────┐  ┌─────────────────┐
│ ⚠ Penicillin   │  │ ⚠ Sulfonamides │
│ Severe          │  │ Moderate        │
│ [CONFIRMED]     │  │ [DRUG ALLERGY]  │
└─────────────────┘  └─────────────────┘

┌─────────────────────────────────────────────────────┐
│  Metronidazole 500mg  [Active]                      │
│  💉 IV · Every 8h · Next: 2:00 PM · Dr. Rahman      │
└─────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Patient Header Card
- Left: colored avatar (initials), right: patient info
- Shows: name, patient_code, ward/bed, doctor_name, provisional_diagnosis, admission_date
- Status badge: "Admitted" in blue / "Critical" in red

### 2. Vitals Grid (4 cards)
Each card contains:
- Label (uppercase, muted)
- Large number (font-data, monospace)
- Unit label
- Mini progress bar (color-coded: green=normal, amber=warning, red=critical)
- Status text

Thresholds (client-side):
| Vital | Normal | Warning | Critical |
|-------|--------|---------|----------|
| Systolic | 90–140 | 80–90 or 140–160 | <80 or >160 |
| Diastolic | 60–90 | 50–60 or 90–100 | <50 or >100 |
| Heart Rate | 60–100 | 50–60 or 100–120 | <50 or >120 |
| SpO₂ | ≥95 | 92–94 | <92 |
| Temperature | 97–99 | 96–97 or 99–101 | <96 or >101 |

### 3. SpO₂ Trend Chart
- Bar chart showing last 7-10 readings from `patient_vitals`
- X-axis: time labels (e.g. "2h ago", "Now")
- Y-axis: SpO₂ percentage (90–100%)
- Bar color: green if ≥95, amber if 92-94, red if <92
- Container with header "SpO₂ Trend — Last 24h"

### 4. Section Tabs
- Tabs: Allergies · Medications · Labs · Diagnoses
- Active tab highlighted with primary color
- Each tab content replaces below when selected

### 5. Allergy Cards
- **Severe (red border)**: Red border + red background tint + "⚠ CONFIRMED ALLERGY" banner
- **Moderate (amber border)**: Amber border + amber tint + "⚠ DRUG ALLERGY" banner
- Fields shown: allergen, severity (text), reaction
- Empty state: "No known allergies" with green checkmark

### 6. Medication Cards
- Card with: drug name, generic name, dose, route badge, frequency, next due time, ordering doctor
- Status badge: Active (blue), Completed (green), Held (amber)
- Empty state: "No active medication orders"

### 7. Lab Results Cards
- Shows: test names, ordered date, status (pending/completed)
- Completed results show result values
- Empty state: "No recent lab orders"

### 8. Diagnosis Cards
- Shows: diagnosis text, ICD-10 code, date
- Multiple diagnoses shown as stacked cards
- Empty state: "No diagnoses recorded"

---

## Data Sources (existing API)

The `GET /api/nursing/clinical-summary/:patientId` endpoint already returns:
- `vitals` — last 5 readings (systolic, diastolic, temperature, heart_rate, spo2, recorded_at)
- `recent_medications` — last 10 medication administrations
- `recent_labs` — last 5 lab orders with tests and statuses
- `diagnoses` — last 5 final diagnoses
- `allergies` — all active allergies
- `active_orders` — all active medication orders

---

## Files to Modify

| File | Change |
|------|--------|
| `web/src/pages/NursingDashboard.tsx` | Replace `clinical-summary` tab content (lines 768–821) with new card-based UI |
| `web/src/components/dashboard/KPICard.tsx` | (Read-only reference for card styling patterns) |
| `web/src/lib/apiClient.ts` | (No change) |
| Backend | No changes needed |

---

## Implementation Order

1. **Patient header card** — static patient info display
2. **Vitals grid** — 4 cards with threshold logic + color coding
3. **SpO₂ trend chart** — bar chart from vitals history
4. **Allergy tab** — color-coded allergy cards
5. **Medications tab** — active order cards with status badges
6. **Labs tab** — lab order cards with result values
7. **Diagnoses tab** — diagnosis cards with ICD-10
8. **Empty states** — for each section when no data

---

## Acceptance Criteria

- [ ] Patient header card shows all patient metadata in one glance
- [ ] Vitals cards color-code correctly based on clinical thresholds
- [ ] SpO₂ trend bar chart renders from actual vital history data
- [ ] Allergy cards show red/amber borders and severity banners
- [ ] Active medication orders display with status badges
- [ ] Tab navigation switches section content
- [ ] Empty states display when no data exists per section
- [ ] Layout is responsive (mobile-friendly for bedside tablets)
- [ ] Print-friendly (no overlapping on print media)
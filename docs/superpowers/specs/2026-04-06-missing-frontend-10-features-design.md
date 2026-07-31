co# Design: 10 Missing Frontend Pages (Sprint 7 Frontend Completion)

**Date:** 2026-04-06  
**Approach:** B — Patient-embedded tabs for clinical features, standalone pages for dept/admin

---

## Context

Backend API is fully implemented for 10 features ported from danphe-next-cloudflare. All routes are registered in `src/index.ts`. This spec covers only the **frontend** work needed.

**Design system:** Tailwind CSS v4, custom CSS classes (`.card`, `.btn-primary`, `.input`, etc.), Lucide icons, Figtree font, teal color scheme, `DashboardLayout` wrapper, React Router v7, TanStack Query v5, React Hot Toast, Axios with `authHeader()`.

---

## Group A: Patient Chart Tabs (PatientDetail.tsx additions)

**File:** `web/src/pages/PatientDetail.tsx`  
**Change:** Add 4 new tabs to the existing 7-tab patient chart.

### Tab 8: Physical Exam

- **Route:** Already on `/h/:slug/patients/:id` — new tab only
- **API:** `GET/POST /api/physical-exam?patientId=:id`
- **UI:**
  - Body system accordion: General, HEENT, Respiratory, Cardiovascular, Abdomen, Musculoskeletal, Neurological, Skin, Other
  - Each system: normal/abnormal toggle + free-text findings field
  - "Save Exam" button — creates new exam record
  - Past exams list below with date + examiner, click to expand
- **Data shape:** `{ PatientId, VisitId?, systems: { [system]: { isNormal, findings } }, ExamDate, ExaminedBy }`

### Tab 9: Clinical Images

- **API:** `GET /api/clinical-images?patientId=:id`, `POST /api/clinical-images`
- **UI:**
  - Filter bar by ImageType (Eye / XRay / Dental / Wound / Skin / Other)
  - Thumbnail grid — click opens lightbox overlay
  - "Add Image" button → modal with ImageName, ImageType select, ImagePath (R2 URL input), Notes textarea
  - Delete (soft) on each image card
- **Data shape:** `{ PatientId, ImageName, ImagePath, ImageType, Notes }`

### Tab 10: I/O Chart

- **API:** `GET /api/input-output?patientId=:id`, `POST /api/input-output`
- **UI:**
  - Summary bar at top: **Intake** (blue) / **Output** (orange) / **Balance** (green if +, red if -)
  - Table: RecordedAt, ParameterName, Category, Value + Unit, Type (intake=↑ blue / output=↓ orange), Remarks, delete
  - "Add Record" button → inline form or modal
  - Date range filter
- **Data shape:** `{ PatientId, ParameterName, ParameterCategory?, IntakeOutputValue, Unit?, IntakeOutputType: 'intake'|'output', Contents?, Remarks?, RecordedAt? }`

### Tab 11: Dictation

- **API:** `GET /api/dictation?patientId=:id`, `POST /api/dictation`, `PUT /api/dictation/:id`
- **UI:**
  - Past dictations list: date, title, status badge (draft/transcribed/reviewed/signed)
  - "New Dictation" → textarea for DictationText + title input + EncounterType select
  - Status can be updated from draft → transcribed → reviewed → signed
  - Click past dictation to view/edit

---

## Group B: Department Module Pages

### Dental — `/h/:slug/dental`

- **File:** `web/src/pages/Dental.tsx`
- **API:** `GET/POST /api/dental` with patientId query param
- **UI:**
  - Patient search bar (search by name/code) at top
  - Once selected: dental chart with 32-tooth SVG diagram
    - Upper arch (1-16) + lower arch (17-32)
    - Click tooth → popover: finding type (decay/missing/crown/filling/extraction/bridge), notes, procedure
    - Affected teeth shown in color (red=decay, grey=missing, gold=crown, blue=filling)
  - Findings list below chart: date, teeth, procedure, status, provider
  - "Add Procedure" button for non-chart procedures

### Psychiatry — `/h/:slug/psychiatry`

- **File:** `web/src/pages/Psychiatry.tsx`
- **API:** `GET/POST /api/psychiatry` with patientId query param
- **UI:**
  - Patient search bar
  - Assessments list: date, type (PHQ-9/GAD-7/MSE/other), score, risk level badge (low=green/moderate=amber/high=red)
  - "New Assessment" button → modal:
    - Assessment type select
    - Dynamic form questions based on type (PHQ-9: 9 questions 0-3, GAD-7: 7 questions 0-3)
    - Auto-calculates total score + risk level
    - ClinicalNotes textarea
    - FollowupRequired checkbox

---

## Group C: Admin/Management Pages

### Marketing Referral — `/h/:slug/marketing-referral`

- **File:** `web/src/pages/MarketingReferral.tsx`
- **API:** `/api/marketing-referral/*`
- **UI:** 4-tab layout
  - **Schemes tab:** Table of referral schemes (name, commission %), add/edit inline
  - **Organizations tab:** Table (org name, contact, phone, email), active/inactive toggle, add form
  - **Parties tab:** Table (party name, group, org, commission %), filter by org/group, add form
  - **Commissions tab:** Date-range report — party name, total transactions, total bill, total commission, avg %

### Group Attendance — `/h/:slug/group-attendance`

- **File:** `web/src/pages/GroupAttendance.tsx`
- **API:** `/api/group-attendance/*`
- **UI:**
  - Sessions list: name, type badge, date, facilitator, member count, status
  - "New Session" button → form modal
  - Click session → Session Detail view:
    - Members list with "Mark Attendance" per member (present/absent/late/excused)
    - Mood rating slider (1-10), participation level select
    - Session Notes section (themes, dynamics, observations)
    - Stats at top: present count / absent count / attendance %

### Fee Sheet — `/h/:slug/fee-sheet`

- **File:** `web/src/pages/FeeSheet.tsx`
- **API:** `/api/fee-sheet/*`
- **UI:**
  - Patient search → visit date select
  - Line items table: CPT/HCPCS code search, description, units, unit price, total
  - Diagnosis codes input (ICD-10)
  - Total charges display
  - Billing status badge + update button (pending → billed → paid)
  - Past fee sheets list for selected patient

### CAMOS — `/h/:slug/camos`

- **File:** `web/src/pages/Camos.tsx`
- **API:** `/api/camos/*`
- **UI:**
  - Left panel: Category browser tree (icon + color per category, subcategories below)
  - Right panel: Assessment form
    - Template select or custom title
    - Dynamic form fields per item type (text/number/select/checkbox/textarea/date)
    - Score weights auto-totaled → TotalScore + ScorePercentage
    - Risk level badge: low (green) / moderate (amber) / high (red)
    - Patient search + EncounterId input at top
  - Past assessments tab: date, title, score, risk level

---

## Route Registrations (App.tsx changes)

Add to hospital_admin role routes and relevant clinical roles:

```
/h/:slug/dental               → <Dental role="hospital_admin" />  (also: doctor, md)
/h/:slug/psychiatry           → <Psychiatry role="hospital_admin" /> (also: doctor, md)
/h/:slug/marketing-referral   → <MarketingReferral role="hospital_admin" />
/h/:slug/group-attendance     → <GroupAttendance role="hospital_admin" /> (also: doctor, nurse)
/h/:slug/fee-sheet            → <FeeSheet role="hospital_admin" /> (also: doctor, reception)
/h/:slug/camos                → <Camos role="hospital_admin" /> (also: doctor, nurse)
```

Patient chart tabs (Physical Exam, Clinical Images, I/O Chart, Dictation) require no new routes — embedded in `/h/:slug/patients/:id`.

---

## Sidebar Navigation

Add entries to `DashboardLayout.tsx` sidebar nav:

| Label (EN) | Label (BN) | Route | Icon | Roles |
|---|---|---|---|---|
| Dental | ডেন্টাল | /dental | Smile | hospital_admin, doctor, md |
| Psychiatry | মানসিক স্বাস্থ্য | /psychiatry | Brain | hospital_admin, doctor, md |
| Group Attendance | গ্রুপ উপস্থিতি | /group-attendance | Users | hospital_admin, doctor, nurse |
| Fee Sheet | ফি শিট | /fee-sheet | Receipt | hospital_admin, doctor, reception |
| CAMOS | ক্যামোস | /camos | ClipboardList | hospital_admin, doctor, nurse |
| Marketing Referral | রেফারেল | /marketing-referral | TrendingUp | hospital_admin |

---

## Implementation Order

1. `PatientDetail.tsx` — add 4 tabs (Physical Exam, Clinical Images, I/O Chart, Dictation)
2. `Dental.tsx` + route + sidebar
3. `Psychiatry.tsx` + route + sidebar
4. `MarketingReferral.tsx` + route + sidebar
5. `GroupAttendance.tsx` + route + sidebar
6. `FeeSheet.tsx` + route + sidebar
7. `Camos.tsx` + route + sidebar
8. Build verification: `cd web && npx tsc --noEmit`

---

## Non-Goals

- No PDF export from frontend (backend already has `/api/pdf`)
- No real-time voice transcription for Dictation (text input only)
- No actual file upload UI for Clinical Images (ImagePath = R2 URL entered manually or from upload flow elsewhere)
- No new auth/permission system changes beyond existing role checks

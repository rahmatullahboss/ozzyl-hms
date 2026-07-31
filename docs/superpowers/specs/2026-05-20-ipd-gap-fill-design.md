# IPD Module Gap-Fill Design

## Context

The HMS already has a mature IPD module (admissions, beds, transfers, discharge, nursing, billing). This design covers the remaining gaps identified during review:

- Bed/Ward management UI improvements
- Admission form enhancements
- IPD Reports (new page)
- Discharge summary polish

## Scope

4 phases, each independently deployable. No schema changes required for most features — existing tables already have the columns.

---

## Phase 1: Bed & Ward Management Enhancements

### 1.1 Ward Setup UI

**Problem:** Wards are virtual (derived from `beds.ward_name` string). No CRUD UI for wards.

**Approach:** Add a Ward Management panel inside `BedManagement.tsx` — a sidebar or modal that lists distinct `ward_name` values from the beds table with:
- Rename ward (bulk update all beds with that ward_name)
- Delete ward (only if no beds assigned)
- Ward-level stats (total beds, available, occupied)

**Backend:** New endpoint `GET /api/admissions/wards` returning distinct ward names with counts. `PUT /api/admissions/wards/:name` for rename. `DELETE /api/admissions/wards/:name` for delete (validation: no beds).

No new DB table needed — wards remain virtual.

### 1.2 Bed Form Improvements

**Problem:** Add bed form missing `rate_per_day` and `status`. No edit/delete UI.

**Changes to `BedManagement.tsx`:**
- Add `rate_per_day` (number input) and `status` (dropdown) to Add Bed modal
- Add Edit button on each bed card → opens pre-filled modal with all fields
- Add Delete button (confirmation dialog, only if bed status is `available`)

**Backend:** `updateBedSchema` already supports `rate_per_day`, `status`, `notes`. Just need frontend wiring.

### 1.3 Bed Feature Management UI

**Problem:** Bed features API exists but no UI to assign features to beds.

**Changes:** Add a "Features" tab or section in BedManagement page:
- List all `bed_features`
- For each bed, show assigned features with add/remove toggle
- Create new feature button

**Backend:** Existing endpoints `POST /api/admissions/bed-features` and `POST /api/admissions/bed-features/map` are sufficient.

---

## Phase 2: Admission Form Improvements

### 2.1 Manual Admission Date/Time

**Problem:** `admission_date` is auto-set server-side. No UI to override.

**Changes:**
- Add `admission_date` field to `createAdmissionSchema` (optional, defaults to server time)
- Add date/time picker in admission form (collapsed by default, "Custom date" toggle)
- Backend: use provided date if present, else `datetime('now', '+6 hours')`

### 2.2 Department Selector

**Problem:** No department field in admission form.

**Changes:**
- Add `department` field to `createAdmissionSchema` (optional string)
- Add department dropdown in admission form, populated from `billing_service_departments` table (already exists)
- Store department name as text on `admissions` table (denormalized)

**Migration:** `ALTER TABLE admissions ADD COLUMN department TEXT;`

### 2.3 Transfer History View

**Problem:** No UI to view transfer history per admission.

**Changes:**
- Add "Transfer History" section in admission detail/view
- Query `patient_bed_infos` table for the admission's bed stays
- Show timeline: bed, ward, check-in, check-out, duration, charges

**Backend:** New endpoint `GET /api/admissions/:id/transfers` querying `patient_bed_infos` for that admission.

---

## Phase 3: IPD Reports (New Page)

### New file: `web/src/pages/IPDReports.tsx`

Dedicated reports page with tab-based navigation. Each tab is a report with date range filter, printable view, and CSV export.

### 3.1 Current Admitted Patients

- Query: `GET /api/admissions?status=admitted`
- Display: table with patient name, MRN, ward, bed, doctor, admission date, duration, diagnosis
- Actions: Print, CSV export

### 3.2 Bed Occupancy Report

- Query: `GET /api/admissions/occupancy` (existing endpoint)
- Display: ward-wise summary with total/occupied/available/maintenance/cleaning counts + occupancy %
- Visual: bar chart per ward

### 3.3 Ward-wise Patient Count

- Query: derived from occupancy + admitted patients
- Display: table with ward name, total beds, admitted patients, occupancy %

### 3.4 Admission Report (Date Range)

- Query: `GET /api/ipd-reports/admissions?from=YYYY-MM-DD&to=YYYY-MM-DD`
- New backend endpoint with date range filter
- Display: table with admission details, sortable by date/ward/doctor
- Summary: total admissions, emergency count, ward-wise breakdown

### 3.5 Discharge Report (Date Range)

- Query: `GET /api/ipd-reports/discharges?from=YYYY-MM-DD&to=YYYY-MM-DD`
- New backend endpoint
- Display: table with discharge details, condition, type, duration
- Summary: total discharges, avg stay, mortality count

### 3.6 Bed Transfer Report

- Query: `GET /api/ipd-reports/transfers?from=YYYY-MM-DD&to=YYYY-MM-DD`
- New backend endpoint joining `patient_bed_infos`
- Display: transfer log with patient, from ward/bed, to ward/bed, date, reason

### 3.7 IPD Revenue Report

- Query: `GET /api/ipd-reports/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD`
- New backend endpoint aggregating `ipd_charges` + bed charges
- Display: total revenue, ward-wise breakdown, charge type breakdown (room, nursing, procedure, etc.)
- Chart: revenue trend line

### Backend: New route file `src/routes/tenant/ipdReports.ts`

All report endpoints:
- Require tenant_id
- Accept `from` and `to` date query params
- Return paginated results + summary totals
- Support CSV export via `?format=csv`

---

## Phase 4: Discharge Summary Polish

### 4.1 PDF Download

**Problem:** "Coming soon" toast.

**Approach:** Use browser `window.print()` with a print-optimized CSS layout (same approach as admission slip). Add a dedicated print template in `web/src/lib/print/dischargeSummaryTemplate.ts`.

No server-side PDF generation needed — browser print-to-PDF is sufficient for v1.

### 4.2 Consultant Signature

**Problem:** Only name/role, no signature.

**Changes:**
- Add `signature_url` column to `discharge_summary_consultants` table (migration)
- Add file upload in DischargeSummary page for consultant signatures (store in R2)
- Display signature image in print view

**Migration:** `ALTER TABLE discharge_summary_consultants ADD COLUMN signature_url TEXT;`

---

## Files to Create/Modify

### New Files
- `web/src/pages/IPDReports.tsx` — IPD reports page
- `src/routes/tenant/ipdReports.ts` — IPD report API endpoints
- `web/src/lib/print/dischargeSummaryTemplate.ts` — Print template

### Modified Files
- `web/src/pages/BedManagement.tsx` — Ward UI, bed form improvements, edit/delete
- `web/src/pages/AdmissionIPD.tsx` — Admission date override, department, transfer history
- `web/src/pages/DischargeSummary.tsx` — PDF download, signature upload
- `src/schemas/admission.ts` — Add `admission_date`, `department` to createAdmissionSchema
- `src/routes/tenant/admissions.ts` — New endpoints (wards, transfers, reports)
- `src/index.ts` or route registry — Register new ipdReports route
- `web/src/App.tsx` — Add IPDReports route
- Migration file — `department` column on admissions, `signature_url` on discharge_summary_consultants

---

## Non-Goals

- No new DB tables (except 2 column additions)
- No server-side PDF generation (browser print is sufficient)
- No ward-level settings (floor, nurse assignment) — out of scope
- No digital signature pad — file upload is sufficient for v1

# Doctor Management Module — Full Implementation Design

**Date:** 2026-05-04
**Status:** Approved
**Type:** Feature Implementation

---

## 1. Overview

Build a complete doctor management module for HMS that mirrors key DanpheEMR Angular doctor module functionality. HMS is React-based with React Query + DashboardLayout. Target: full CRUD admin UI, doctor scheduling, doctor dashboard, and OPD visit history.

---

## 2. Scope

### In Scope
- Enhanced doctor database schema with department, bio, photo, availability
- Extended doctor CRUD API routes
- Doctor list admin page (list/add/edit/deactivate)
- Doctor detail/profile page with tabbed sections
- Doctor scheduling page (weekly grid, shift management)
- Doctor dashboard (doctor's own view: today's appointments, stats)
- OPD visit history per doctor
- Sidebar navigation integration
- Route registration

### Out of Scope
- Billing integration (link display only, no billing module changes)
- IPD records (v2)
- Radiologist-specific features
- Employee HR module (payroll, leave — already has basic tables)
- Drag-and-drop scheduling

---

## 3. Database Schema

### New Migration: `0XXX_doctor_module_enhanced.sql`

```sql
-- Enhanced doctors table
ALTER TABLE doctors ADD COLUMN department TEXT;
ALTER TABLE doctors ADD COLUMN department_id INTEGER REFERENCES departments(id);
ALTER TABLE doctors ADD COLUMN bio TEXT;
ALTER TABLE doctors ADD COLUMN photo_key TEXT;
ALTER TABLE doctors ADD COLUMN is_available INTEGER DEFAULT 1;
ALTER TABLE doctors ADD COLUMN display_order INTEGER DEFAULT 0;

-- Doctor shifts
CREATE TABLE IF NOT EXISTS doctor_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, ..., 6=Saturday
  shift_name TEXT NOT NULL, -- Morning, Evening, Night
  start_time TEXT NOT NULL, -- HH:MM format
  end_time TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, day_of_week, shift_name, tenant_id)
);

-- Doctor availability override (leaves, special hours)
CREATE TABLE IF NOT EXISTS doctor_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  date DATE NOT NULL,
  is_available INTEGER DEFAULT 0, -- 0=unavailable, 1=available
  reason TEXT, -- on_leave, special_hours, etc.
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, date, tenant_id)
);

-- Doctor visits (read-only view for now, links existing appointment data)
CREATE TABLE IF NOT EXISTS doctor_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  visit_date DATE NOT NULL,
  visit_type TEXT NOT NULL, -- OPD, IP, EMERGENCY
  diagnosis TEXT,
  notes TEXT,
  tenant_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. API Routes

### `src/routes/tenant/doctors.ts` — Extend Existing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/doctors` | List with filters (specialty, department, search, is_active) |
| GET | `/api/doctors/:id` | Full doctor profile with shifts |
| POST | `/api/doctors` | Create doctor |
| PUT | `/api/doctors/:id` | Update doctor |
| DELETE | `/api/doctors/:id` | Soft deactivate |
| POST | `/api/doctors/:id/publish` | Publish to marketplace (exists) |
| PUT | `/api/doctors/:id/activate` | Reactivate doctor |

### `src/routes/tenant/doctor-schedule.ts` — New

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/doctors/:id/schedule` | Get all shifts for a doctor |
| POST | `/api/doctors/:id/schedule` | Add shift(s) |
| PUT | `/api/doctors/:id/schedule/:shiftId` | Update shift |
| DELETE | `/api/doctors/:id/schedule/:shiftId` | Remove shift |
| GET | `/api/doctors/:id/availability` | Get availability overrides |
| POST | `/api/doctors/:id/availability` | Add availability override |
| DELETE | `/api/doctors/:id/availability/:availId` | Remove override |

### `src/routes/tenant/doctor-dashboard.ts` — Extend Existing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/doctors/dashboard` | Doctor's own dashboard (today's appointments, stats) |
| GET | `/api/doctors/:id/stats` | Admin view: patient counts, revenue summary |

---

## 5. Frontend Pages

### `web/src/pages/doctor/DoctorList.tsx`
**Role:** hospital_admin, doctor (own only)

- Page header: "Doctor Management" + "+ Add Doctor" button
- Filter bar: search input (name/mobile), specialty dropdown, department dropdown, status toggle (active/all)
- DataTable listing: Name, Specialty, Department, BMDC No., Consultation Fee, Status, Actions
- Row actions: Edit (pencil), Deactivate/Activate (toggle), View Schedule (calendar), View Profile (chevron)
- Add/Edit: slide-over drawer (400px right side)
  - Fields: Name*, Mobile*, Email, Specialty*, Department, Consultation Fee*, BMDC Reg No., Qualifications, Bio, Languages, Visiting Hours, Photo upload
- Soft deactivate confirmation dialog

### `web/src/pages/doctor/DoctorDetail.tsx`
**Role:** hospital_admin, doctor (own profile)

- Back link to DoctorList
- Profile header card: avatar, name, specialty, department, fee, BMDC, contact info, status badge
- Tab navigation: Profile | Schedule | Visits
- **Profile tab:** full editable form (same fields as drawer)
- **Schedule tab:** weekly grid, add/edit shift per day
- **Visits tab:** DataTable of past visits (date, patient, type, diagnosis)

### `web/src/pages/doctor/DoctorSchedule.tsx`
**Role:** hospital_admin, doctor

- Weekly calendar grid (Mon-Sun columns, shift rows)
- Color coding: Morning=#22c55e, Evening=#f59e0b, Night=#6366f1, Off=#94a3b8
- Click cell to add/edit shift: time pickers (start/end), shift name dropdown
- Add availability override: date picker + available/unavailable toggle

### `web/src/pages/doctor/DoctorDashboard.tsx`
**Role:** doctor (own view only)

- Welcome header: "Dr. {name}"
- KPI row: Today's Patients, This Week, Pending Tasks, Avg. Consult Time
- Today's Appointment list (table: time, patient name, type, status)
- Patient Queue card
- Auto-refresh every 60 seconds

---

## 6. Sidebar Integration

**File:** `web/src/components/dashboard/Sidebar.tsx`

Add to `hospital_admin` nav group:
```typescript
{
  labelKey: 'sidebar.doctors',
  icon: StethoscopeIcon,
  path: 'doctors',
  requiredPermission: 'doctor:read',
},
```

Add to `doctor` nav group:
```typescript
{
  labelKey: 'sidebar.mySchedule',
  icon: CalendarIcon,
  path: 'doctors/dashboard',
},
```

---

## 7. Route Registration

**File:** `web/src/App.tsx`

Add route group under `/h/:slug/`:
```tsx
{
  path: 'doctors',
  element: <ProtectedRoute allowedRoles={['hospital_admin']}><DashboardLayout /></ProtectedRoute>,
  children: [
    { index: true, element: <Navigate to="list" replace /> },
    { path: 'list', element: <DoctorList /> },
    { path: ':id', element: <DoctorDetail /> },
    { path: 'dashboard', element: <DoctorDashboard />, allowedRoles: ['doctor'] },
  ],
},
```

---

## 8. Implementation Phases

### Phase 1: Infrastructure (Sequential)
1. Write migration `0XXX_doctor_module_enhanced.sql`
2. Update `src/schemas/doctor.ts` with new Zod fields
3. Extend `src/routes/tenant/doctors.ts` with filters, activate/deactivate
4. Create new `src/routes/tenant/doctor-schedule.ts`
5. Create `DoctorList.tsx` frontend page
6. Create slide-over drawer component if not existing

### Phase 2: Detail & Schedule (Parallel)
- Agent A: DoctorDetail page + Profile tab + API updates
- Agent B: DoctorSchedule page + schedule API

### Phase 3: Dashboard & Visits (Parallel)
- Agent C: DoctorDashboard page + dashboard API enhancements
- Agent D: Doctor visits API + Visits tab in DoctorDetail

### Phase 4: Integration
- Sidebar nav items
- Route registration
- i18n string additions

---

## 9. Component Inventory

| Component | Type | Description |
|-----------|------|-------------|
| `DoctorList.tsx` | Page | Master list with filters + drawer |
| `DoctorDetail.tsx` | Page | Profile header + tabbed sections |
| `DoctorSchedule.tsx` | Page | Weekly grid shift management |
| `DoctorDashboard.tsx` | Page | Doctor's personal dashboard |
| `DoctorDrawer.tsx` | Component | Slide-over add/edit form |
| `DoctorForm.tsx` | Component | Shared form fields |
| `ScheduleGrid.tsx` | Component | Weekly calendar grid |
| `ShiftEditor.tsx` | Component | Time picker for single shift |
| `DoctorStats.tsx` | Component | KPI cards row |
| `VisitHistory.tsx` | Component | Visits DataTable |

---

## 10. Dependencies

- React Query hooks (`useApiQuery`, `useApiMutation`) — already in use
- DashboardLayout — existing
- DataTable — existing (`web/src/components/dashboard/DataTable.tsx`)
- react-hot-toast — existing
- react-day-picker or native time inputs for schedule
- i18n — existing (add `sidebar.doctors`, `doctor.*` keys)

---

## 11. Testing Checklist

- Doctor CRUD: create, read, update, soft-delete, reactivate
- Schedule: add shift, edit shift, remove shift
- Dashboard: loads with today's appointments, auto-refresh works
- Permissions: hospital_admin sees all, doctor sees own only
- Filters: specialty, department, search, status work
- Sidebar: nav items appear for correct roles
- Mobile: drawer collapses, schedule grid scrollable

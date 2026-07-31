# Admin Panel HR/Staff/Leave Cleanup — Design

**Date:** 2026-06-12
**Status:** Approved (pending spec review)
**Scope:** Frontend (web/) only — no backend changes

## Problem Statement

The admin panel has three overlapping/duplicated concerns that confuse users:

1. **StaffPage shows doctors.** `StaffPage` merges `/api/staff` and `/api/doctors` into one table, but doctors are also managed in a dedicated `DoctorList` page. Doctors should not appear in the staff roster.

2. **Leave Management exists in two places with two different UIs.**
   - `HRDashboard` has a `LeaveTab` (older, simpler — categories + requests only, no balances, no half-day support).
   - `LeaveManagement` is a standalone page (newer, more complete — categories + requests + balances + half-day + rejection reasons).
   Both pages use the same backend APIs (`/api/hr/leave/*`) but show different controls and have two different setting systems (categories can be created from both). This is a maintenance burden and a UX trap.

3. **Sidebar labels are misleading.** The Bengali `hr.json` translation sets the `HRDashboard` page title to "ছুটি ব্যবস্থাপনা" (Leave Management) — so the page that the sidebar calls "কর্মচারী" (Employees) opens with a heading that says "Leave Management." And "ব্যবহারকারী" (Users) opens a page that calls itself "কর্মী ব্যবস্থাপনা" (Staff Management). The two labels (sidebar + page title) don't match, and there is no clear "HR" home.

## Goals

- Each concept (Staff, HR overview, Leave, Doctors) has exactly one entry point.
- Sidebar labels match the page they open.
- Doctors are managed only in the Doctors page.
- Leave is managed only in the Leave page.
- No backend API changes — only frontend consolidation.
- Existing tests are updated, not silently broken.

## Non-Goals

- Adding new HR features (overtime, payroll, biometric) — these stay inside the HR Dashboard.
- Changing the role/permission strings — they continue to use `staff:read`, `hr:read`, `doctor:read`.
- Changing DoctorList or its routes.
- Migrating any user data.

## Final Sidebar Structure (People & Access group)

| Sidebar key | bn label | en label | Path | Component |
|-------------|----------|----------|------|-----------|
| `staff` (renamed from `users`) | কর্মী | Staff | `staff` | `StaffPage` (staff only, no doctors) |
| `permissions` | Roles & Permissions | Roles & Permissions | `permissions` | `PermissionManagement` |
| `hrDashboard` (renamed from `employees`) | এইচআর ড্যাশবোর্ড | HR Dashboard | `hr` | `HRDashboard` (overview + attendance + payroll; **no leave tab**) |
| `leave` (renamed from `attendanceLeave`) | ছুটি | Leave | `hr/leave` | `LeaveManagement` (primary) |
| `doctors` | ডাক্তার | Doctors | `doctors` | `DoctorList` (unchanged) |

Sidebar `labelKey` values change in `adminSidebarConfig.tsx`; corresponding entries in `web/public/locales/{en,bn}/sidebar.json` get new translations.

## File-by-File Changes

### 1. `web/public/locales/en/sidebar.json` & `web/public/locales/bn/sidebar.json`

- `"users": "Users"` / `"users": "ব্যবহারকারী"` → `"staff": "Staff"` / `"staff": "কর্মী"`
- `"employees": "Employees"` / `"employees": "কর্মচারী"` → `"hrDashboard": "HR Dashboard"` / `"hrDashboard": "এইচআর ড্যাশবোর্ড"`
- `"attendanceLeave": "Attendance & Leave"` / `"attendanceLeave": "উপস্থিতি ও ছুটি"` → `"leave": "Leave"` / `"leave": "ছুটি"`

The old keys are removed; nothing else references them.

### 2. `web/src/components/dashboard/adminSidebarConfig.tsx`

Inside `groupPeopleAccess`, the three affected items change `labelKey`:
- `users` → `staff`
- `employees` → `hrDashboard`
- `attendanceLeave` → `leave`

`requiredPermission` values stay: `staff:read`, `hr:read` (HR dashboard), `hr:read` (leave), `doctor:read` (doctors).

### 3. `web/src/pages/HRDashboard.tsx`

- Remove `'leave'` from the `TABS` tuple (line 70). New tabs: `['overview', 'attendance', 'payroll']`.
- Delete the `LeaveTab` function and its `categoriesQuery`, `requestsQuery`, `saveCategoryMutation`, `submitRequestMutation`, `approveMutation`, and related state (lines 522–746).
- Remove the conditional that renders `LeaveTab` (line 1324).
- Remove `tabIcons.leave` entry.
- Keep `OverviewTab`, `AttendanceTab`, `PayrollTab` unchanged.

### 4. `web/src/pages/HRDashboard.tsx` — title wiring

The page reads `t('hr:title')` for its header. We update `hr.json` so that key now means "HR Dashboard / এইচআর ড্যাশবোর্ড" instead of "Leave Management / ছুটি ব্যবস্থাপনা."

### 5. `web/public/locales/en/hr.json` & `web/public/locales/bn/hr.json`

- Top-level `title`: `Leave Management` → `HR Dashboard`; `ছুটি ব্যবস্থাপনা` → `এইচআর ড্যাশবোর্ড`
- Top-level `subtitle` updated to match the new purpose: "Staff attendance, payroll & overview" / "কর্মীদের উপস্থিতি, বেতন ও সারসংক্ষেপ"
- `tabs.leave` key removed (no longer a tab). `tabs.overview`, `tabs.attendance`, `tabs.payroll` stay.
- Leave-related strings (`categories`, `requests`, `balances`, `modals.*` for leave, etc.) stay in `hr.json` because `LeaveManagement.tsx` continues to read from the same `hr` namespace — they power the standalone Leave page now.

### 6. `web/src/pages/StaffPage.tsx`

- Remove the `useApiQuery<{ doctors: ... }>(...)` block (lines 123–126) and the `doctors` variable.
- Remove `allMembers` combining logic (lines 137–156). The page only renders `staff` from the existing `/api/staff` query.
- Remove `doctorCount` (line 169) and the third KPI card that shows "Doctors" (lines 312–319). KPI grid becomes 2 columns: total staff + active staff.
- Remove all `_type === 'doctor'` conditionals in the table body and the action buttons.
- Remove the `'doctor'` entry from `CATEGORY_OPTIONS` (line 50). Since doctors are managed exclusively in `DoctorList`, the Staff page's role-category dropdown should not offer "Doctor" — keeping it would invite a second path for managing doctors. The remaining categories (`nurse`, `receptionist`, `lab_technician`, `pharmacist`, `accountant`, `cleaner`, `security`, `driver`, `other`) stay.
- Remove the `Stethoscope` import (line 2) — it is no longer used after the doctor UI is gone.
- The drawer form (name, position, department, category, mobile, salary, etc.) is otherwise unchanged.

### 7. `web/src/pages/doctor/DoctorList.tsx`

No change. Already a complete doctor management page.

### 8. `web/src/pages/LeaveManagement.tsx`

No structural change. It is already the more complete page. The only difference is that it is now the **only** entry point for leave. The page title comes from `hr.json`'s `title` which we are rewriting to "HR Dashboard" — so we must give `LeaveManagement` its own header. Two options:

- **Option A (chosen):** Add a new i18n key `hr:leaveTitle` ("Leave Management" / "ছুটি ব্যবস্থাপনা") and use that in `LeaveManagement.tsx` instead of `hr:title`. Keep the legacy `hr:title` for any other consumer (e.g., the `OverviewTab`'s `t('hr:title')` if it exists; verified — no, only the page header uses it after we remove LeaveTab).
- The `LeaveManagement` page is wrapped in `DashboardLayout` and renders `t('hr:title')` in its header. Switch it to `t('hr:leaveTitle', { defaultValue: 'Leave Management' })`.

### 9. Tests

The existing test files in this area are minimal — they verify component exports and structural shape, not content. As a result, **no test rewrites are required** for this change. Listed for completeness:

- `web/src/components/dashboard/adminSidebarConfig.test.ts` — asserts group count, group keys, and item shape. It does not assert any specific `labelKey` string values, so renaming `users` → `staff`, `employees` → `hrDashboard`, `attendanceLeave` → `leave` does not break it. **No change.**
- `web/src/pages/HRDashboard.test.ts` — only an `it.todo` placeholder. **No change.**
- `web/src/pages/StaffPage.test.ts` — only asserts the default export is a function. **No change.**
- `web/src/pages/LeaveManagement.test.ts` — unchanged (file untouched).
- `web/src/pages/doctor/DoctorList.test.ts` — unchanged (file untouched).

If `adminRoleAccess.ts` referenced any renamed `groupKey` values, an edit would be needed; it does not — `groupPeopleAccess` is the unchanged outer key, and only the inner `labelKey` strings are renamed. **No change.**

## Data Flow (unchanged)

```
/api/staff            → StaffPage   (only staff)
/api/doctors          → DoctorList  (only doctors)
/api/hr/leave/*       → LeaveManagement (single entry point)
/api/hr/attendance/*  → HRDashboard > Attendance tab
/api/hr/payroll/*     → HRDashboard > Payroll tab
```

The backend already scopes these correctly. We are only fixing the UI to point at the right thing.

## Error Handling

- If `/api/staff` returns an empty list, `StaffPage` shows the existing empty state — same as today.
- If a previously-rendered doctor row is removed from `StaffPage`, no API is called for doctors from this page; `DoctorList` is unaffected and continues to render doctors from `/api/doctors`.
- If a stale tab in the URL still says `?tab=leave`, the `HRDashboard` ignores it (it no longer knows that tab) and defaults to `overview`. This is acceptable — there are no deep links to that tab in production.

## Verification

1. `pnpm --filter web test` — all updated/new tests pass.
2. `pnpm --filter web typecheck` (or `tsc --noEmit`) — no type errors.
3. `pnpm --filter web build` — production bundle builds.
4. Manual smoke check after build:
   - Sidebar shows: Staff / Roles & Permissions / HR Dashboard / Leave / Doctors
   - Click Staff → page shows only staff, no doctors.
   - Click HR Dashboard → tabs are Overview, Attendance, Payroll (no Leave).
   - Click Leave → shows requests, balances, categories.
   - Click Doctors → shows the doctor list.
5. Deploy to production per AGENTS.md: `pnpm build && wrangler deploy --env production`.
6. Commit per AGENTS.md "MANDATORY: Commit after every task."

## Out of Scope / Future Work

- A future "HR > Leave" deep link from inside the HR Dashboard (e.g., a banner on the Overview tab) is **not** included here; can be added later if the user wants a back-reference.
- Refactoring the `hr.json` namespace to split leave vs. HR-dashboard strings into separate files is **not** part of this change.
- Changing the `hr:title` removal in places like `PendingApprovals` or `ApprovalCenter` (which may also reference it) is a follow-up, if any are affected. Initial scan: only `HRDashboard.tsx` and `LeaveManagement.tsx` use it.

## Risks

- **Stale bookmarks** to `/h/:slug/hr?tab=leave` will land on the Overview tab. Acceptable; no deep links exist today.
- **i18n key rename** (`users` → `staff`): any other code reading `t('sidebar:users')` will get undefined. Initial scan: only `adminSidebarConfig.tsx` uses it. To be verified during implementation.
- **Removing the Leave tab from HR Dashboard** is a UX reduction for users who relied on the "everything in one dashboard" mental model. Mitigated by the sidebar's clear Leave entry point.

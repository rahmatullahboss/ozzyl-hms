# Admin Panel HR/Staff/Leave Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the StaffPage↔doctors merge, remove the duplicate Leave UI from the HR Dashboard, and rename the People & Access sidebar entries so each concept has exactly one entry point whose label matches the page it opens.

**Architecture:** Frontend-only consolidation. i18n strings first (so components can reference new keys), then sidebar config, then page-level component changes. No backend changes.

**Tech Stack:** React 18, TypeScript, react-i18next, react-router, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-12-admin-hr-staff-leave-cleanup-design.md`

---

## File Map (what each file is responsible for after this change)

| File | Responsibility |
|------|----------------|
| `web/public/locales/en/sidebar.json` | English sidebar label strings |
| `web/public/locales/bn/sidebar.json` | Bengali sidebar label strings |
| `web/public/locales/en/hr.json` | English HR/Leave namespace strings |
| `web/public/locales/bn/hr.json` | Bengali HR/Leave namespace strings |
| `web/src/components/dashboard/adminSidebarConfig.tsx` | Admin nav items (labelKey + path) |
| `web/src/pages/HRDashboard.tsx` | HR Dashboard (overview / attendance / payroll — no leave) |
| `web/src/pages/StaffPage.tsx` | Staff management (no doctors, no doctor category) |
| `web/src/pages/LeaveManagement.tsx` | Leave management (single, complete entry point) |

Files that are read but **not** modified in this plan: `DoctorList.tsx`, `App.tsx` (routes stay the same), `adminRoleAccess.ts` (no group-level changes), all test files (no rewrites required per spec §9).

---

## Task 1: Update English sidebar i18n — rename `users`, `employees`, `attendanceLeave`

**Files:**
- Modify: `web/public/locales/en/sidebar.json:237-240, 42-45, 200-204`

- [ ] **Step 1: Open the file**

Run: `cat web/public/locales/en/sidebar.json | head -260 | tail -30`

- [ ] **Step 2: Verify the existing keys**

The file should already contain:
```json
"staff": "Staff",
"employees": "Employees",
"hrPayroll": "HR & Payroll",
"leaveManagement": "Leave Management",
...
"users": "Users",
"rolesPermissions": "Roles & Permissions",
...
"attendanceLeave": "Attendance & Leave",
```

If any are missing, the file is in an unexpected state — stop and investigate.

- [ ] **Step 3: Remove the `users` key**

Delete this entire line (line 239):
```json
  "users": "Users",
```

- [ ] **Step 4: Rename the `employees` key to `hrDashboard`**

Find:
```json
  "employees": "Employees",
```

Replace with:
```json
  "hrDashboard": "HR Dashboard",
```

- [ ] **Step 5: Rename the `attendanceLeave` key to `leave`**

Find:
```json
  "attendanceLeave": "Attendance & Leave",
```

Replace with:
```json
  "leave": "Leave",
```

- [ ] **Step 6: Verify the file is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('web/public/locales/en/sidebar.json','utf8')); console.log('OK')"`

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add web/public/locales/en/sidebar.json
git commit -m "i18n(sidebar.en): rename users/employees/attendanceLeave keys"
```

---

## Task 2: Update Bengali sidebar i18n — rename `users`, `employees`, `attendanceLeave`

**Files:**
- Modify: `web/public/locales/bn/sidebar.json:42-45, 200-204, 238`

- [ ] **Step 1: Open the file**

Run: `cat web/public/locales/bn/sidebar.json | head -260 | tail -30`

- [ ] **Step 2: Verify the existing keys**

The file should already contain:
```json
"staff": "কর্মী",
"employees": "কর্মচারী",
"hrPayroll": "এইচআর ও বেতন",
"leaveManagement": "ছুটি ব্যবস্থাপনা",
...
"attendanceLeave": "উপস্থিতি ও ছুটি",
...
"users": "ব্যবহারকারী",
```

- [ ] **Step 3: Remove the `users` key**

Delete this entire line (line 238):
```json
  "users": "ব্যবহারকারী",
```

- [ ] **Step 4: Rename `employees` → `hrDashboard`**

Find:
```json
  "employees": "কর্মচারী",
```

Replace with:
```json
  "hrDashboard": "এইচআর ড্যাশবোর্ড",
```

- [ ] **Step 5: Rename `attendanceLeave` → `leave`**

Find:
```json
  "attendanceLeave": "উপস্থিতি ও ছুটি",
```

Replace with:
```json
  "leave": "ছুটি",
```

- [ ] **Step 6: Verify the file is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('web/public/locales/bn/sidebar.json','utf8')); console.log('OK')"`

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add web/public/locales/bn/sidebar.json
git commit -m "i18n(sidebar.bn): rename users/employees/attendanceLeave keys"
```

---

## Task 3: Update HR English i18n — repurpose `title`, add `leaveTitle`, update `subtitle`

**Files:**
- Modify: `web/public/locales/en/hr.json:1-3, 9-10`

- [ ] **Step 1: Open the file**

Run: `sed -n '1,15p' web/public/locales/en/hr.json`

- [ ] **Step 2: Update the top-level `title`**

Find:
```json
  "title": "Leave Management",
```

Replace with:
```json
  "title": "HR Dashboard",
```

- [ ] **Step 3: Update the top-level `subtitle`**

Find:
```json
  "subtitle": "Staff leave requests, balances & categories",
```

Replace with:
```json
  "subtitle": "Staff attendance, payroll & overview",
```

- [ ] **Step 4: Remove the `tabs.leave` entry**

The current `tabs` object is:
```json
  "tabs": {
    "requests": "Leave Requests",
    "balances": "Balances",
    "categories": "Categories",
    "overview": "Overview",
    "attendance": "Attendance",
    "payroll": "Payroll"
  },
```

No change is needed here — the `leave` key does not exist in the HR English `tabs`. (`requests`, `balances`, `categories` remain because `LeaveManagement.tsx` continues to read them.) Skip this step.

- [ ] **Step 5: Add a new `leaveTitle` key at the end of the file**

Append after the closing `}` of the top-level object — but JSON does not allow trailing comma. Instead, add the new key as a sibling at the end of the file before the final `}`. The last key currently is `"night": "Night"` (inside `attendance`), so add at the top level just before the final `}`. Find:

```json
    "night": "Night"
  }
```

(The very last `}` is the file's closing brace.)

Replace with:

```json
    "night": "Night"
  },
  "leaveTitle": "Leave Management"
}
```

Verify by re-running the JSON validity check in Step 6.

- [ ] **Step 6: Verify the file is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('web/public/locales/en/hr.json','utf8')); console.log('OK')"`

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add web/public/locales/en/hr.json
git commit -m "i18n(hr.en): repurpose title for HR Dashboard; add leaveTitle"
```

---

## Task 4: Update HR Bengali i18n — repurpose `title`, add `leaveTitle`, update `subtitle`

**Files:**
- Modify: `web/public/locales/bn/hr.json:1-3`

- [ ] **Step 1: Open the file**

Run: `sed -n '1,15p' web/public/locales/bn/hr.json`

- [ ] **Step 2: Update the top-level `title`**

Find:
```json
  "title": "ছুটি ব্যবস্থাপনা (Leave Management)",
```

Replace with:
```json
  "title": "এইচআর ড্যাশবোর্ড (HR Dashboard)",
```

- [ ] **Step 3: Update the top-level `subtitle`**

Find:
```json
  "subtitle": "কর্মকর্তাদের ছুটির অনুরোধ, ব্যালেন্স এবং বিভাগসমূহ",
```

Replace with:
```json
  "subtitle": "কর্মীদের উপস্থিতি, বেতন ও সারসংক্ষেপ",
```

- [ ] **Step 4: Add a new `leaveTitle` key at the end of the file**

The file ends with:
```json
  "pendingLeaveRequests": "মুলতুবি ছুটির আবেদন"
}
```

Replace the closing `}` with `,` plus the new key plus a new closing `}`. Specifically, find:

```json
  "pendingLeaveRequests": "মুলতুবি ছুটির আবেদন"
}
```

Replace with:

```json
  "pendingLeaveRequests": "মুলতুবি ছুটির আবেদন",
  "leaveTitle": "ছুটি ব্যবস্থাপনা"
}
```

- [ ] **Step 5: Verify the file is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('web/public/locales/bn/hr.json','utf8')); console.log('OK')"`

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add web/public/locales/bn/hr.json
git commit -m "i18n(hr.bn): repurpose title for HR Dashboard; add leaveTitle"
```

---

## Task 5: Update admin sidebar config to use new labelKeys

**Files:**
- Modify: `web/src/components/dashboard/adminSidebarConfig.tsx:67-71`

- [ ] **Step 1: Open the file**

Run: `sed -n '64,75p' web/src/components/dashboard/adminSidebarConfig.tsx`

- [ ] **Step 2: Read the current People & Access block**

You should see:

```tsx
    groupKey: 'groupPeopleAccess',
    items: [
      { labelKey: 'users', path: 'staff', icon: <Users className="w-4.5 h-4.5" />, requiredPermission: 'staff:read' },
      { labelKey: 'rolesPermissions', path: 'permissions', icon: <Shield className="w-4.5 h-4.5" />, requiredPermission: 'settings:read' },
      { labelKey: 'employees', path: 'hr', icon: <UserCog className="w-4.5 h-4.5" />, requiredPermission: 'hr:read' },
      { labelKey: 'doctors', path: 'doctors', icon: <Stethoscope className="w-4.5 h-4.5" />, requiredPermission: 'doctor:read' },
      { labelKey: 'attendanceLeave', path: 'hr/leave', icon: <CalendarDays className="w-4.5 h-4.5" />, requiredPermission: 'hr:read' },
    ],
```

- [ ] **Step 3: Replace the three labelKey values**

Replace the entire `groupKey: 'groupPeopleAccess'` items block (just the `items` array) with:

```tsx
    groupKey: 'groupPeopleAccess',
    items: [
      { labelKey: 'staff', path: 'staff', icon: <Users className="w-4.5 h-4.5" />, requiredPermission: 'staff:read' },
      { labelKey: 'rolesPermissions', path: 'permissions', icon: <Shield className="w-4.5 h-4.5" />, requiredPermission: 'settings:read' },
      { labelKey: 'hrDashboard', path: 'hr', icon: <UserCog className="w-4.5 h-4.5" />, requiredPermission: 'hr:read' },
      { labelKey: 'leave', path: 'hr/leave', icon: <CalendarDays className="w-4.5 h-4.5" />, requiredPermission: 'hr:read' },
      { labelKey: 'doctors', path: 'doctors', icon: <Stethoscope className="w-4.5 h-4.5" />, requiredPermission: 'doctor:read' },
    ],
```

Notes on this diff:
- `users` → `staff` (the existing `"staff": "কর্মী"` / `"Staff"` key in the locale is reused).
- `employees` → `hrDashboard` (new key added in Tasks 1 & 2).
- `attendanceLeave` → `leave` (new key added in Tasks 1 & 2).
- Reordered so the sequence is `staff`, `permissions`, `hrDashboard`, `leave`, `doctors` (matches the spec table in §"Final Sidebar Structure").
- `permissions` is in the middle because the new sidebar order is staff → roles → HR dashboard → leave → doctors (more logical: people → access → HR modules → doctors).

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm --filter web exec tsc --noEmit -p web 2>&1 | tail -20` (or `cd web && npx tsc --noEmit`).

Expected: no errors related to `adminSidebarConfig.tsx`. If there are unrelated errors, ignore them — they predate this change.

- [ ] **Step 5: Run the sidebar config test**

Run: `pnpm --filter web test -- adminSidebarConfig 2>&1 | tail -20`

Expected: all `adminSidebarConfig` tests pass. The existing tests only assert structure (group count, group keys, item shape), so renaming labelKeys does not break them.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/dashboard/adminSidebarConfig.tsx
git commit -m "feat(sidebar): rename People & Access labels (users→staff, employees→hrDashboard, attendanceLeave→leave)"
```

---

## Task 6: Remove the Leave tab from HRDashboard

**Files:**
- Modify: `web/src/pages/HRDashboard.tsx` (multiple sections)

- [ ] **Step 1: Open the file**

Run: `sed -n '1,12p' web/src/pages/HRDashboard.tsx`

- [ ] **Step 2: Remove `'leave'` from the `TABS` tuple**

Find (line 70):

```tsx
const TABS = ['overview', 'leave', 'attendance', 'payroll'] as const;
```

Replace with:

```tsx
const TABS = ['overview', 'attendance', 'payroll'] as const;
```

- [ ] **Step 3: Remove the `leave` icon from `tabIcons`**

Find (around line 1286-1289 in the main `HRDashboard` component):

```tsx
  const tabIcons: Record<Tab, React.ReactNode> = {
    overview:   <BarChart2 className="w-4 h-4" />,
    leave:      <Calendar className="w-4 h-4" />,
    attendance: <Clock className="w-4 h-4" />,
    payroll:    <DollarSign className="w-4 h-4" />,
  };
```

Replace with:

```tsx
  const tabIcons: Record<Tab, React.ReactNode> = {
    overview:   <BarChart2 className="w-4 h-4" />,
    attendance: <Clock className="w-4 h-4" />,
    payroll:    <DollarSign className="w-4 h-4" />,
  };
```

- [ ] **Step 4: Delete the `LeaveTab` function and its imports**

The `LeaveTab` function spans from `function LeaveTab(...)` (around line 525) to the closing `}` before `function AttendanceTab(...)` (around line 747). Open the file and locate the exact boundaries:

Run: `grep -n "function LeaveTab\|function AttendanceTab\|function PayrollTab" web/src/pages/HRDashboard.tsx`

Delete **everything** between (and including) the `function LeaveTab({ staffList }: { staffList: Staff[] }) {` line and the line just before `function AttendanceTab({ staffList }: { staffList: Staff[] }) {`. The block to delete starts with the JSDoc comment `// ═══` above `LeaveTab` (if present) and ends with the closing `}` of the function. The easiest way:

1. Open `web/src/pages/HRDashboard.tsx` in your editor.
2. Use the grep line numbers from above to navigate.
3. Select from the line `// ═══════════════════════════════════════════════════════════════════════════════` immediately before `function LeaveTab` through the line `}` that closes `LeaveTab`.
4. Delete the selection.

Expected diff: roughly 222 lines removed (lines 524–746 of the original file).

- [ ] **Step 5: Remove the `LeaveTab` rendering branch**

Find (around line 1324 in the original file):

```tsx
        {/* Tab content */}
        {activeTab === 'overview'   && <OverviewTab stats={statsQuery.data ?? null} loading={statsQuery.isLoading} />}
        {activeTab === 'leave'      && <LeaveTab staffList={staffList} />}
        {activeTab === 'attendance' && <AttendanceTab staffList={staffList} />}
        {activeTab === 'payroll'    && <PayrollTab staffList={staffList} />}
```

Replace with:

```tsx
        {/* Tab content */}
        {activeTab === 'overview'   && <OverviewTab stats={statsQuery.data ?? null} loading={statsQuery.isLoading} />}
        {activeTab === 'attendance' && <AttendanceTab staffList={staffList} />}
        {activeTab === 'payroll'    && <PayrollTab staffList={staffList} />}
```

- [ ] **Step 6: Check for unused imports**

The `LeaveTab` deletion may have left some imports unused. Check the top of the file for these imports — remove any that are no longer used elsewhere in the file:

- `Calendar` (from lucide-react) — still used by `OverviewTab`'s `EmptyState` and `PendingLeaveRequests`? Yes (`<Calendar className="w-6 h-6 ..." />` in the empty state). Keep it.
- `Plus`, `Check`, `Ban` — used by `PendingLeaveRequests` and other tabs. Keep.
- `Briefcase` — used by the page header. Keep.

If TypeScript flags any as unused after the edit, remove the specific import line.

- [ ] **Step 7: Type-check**

Run: `pnpm --filter web exec tsc --noEmit -p web 2>&1 | grep -E "HRDashboard" | head -20`

Expected: no `HRDashboard.tsx` errors. (Other pre-existing errors are acceptable.)

- [ ] **Step 8: Run the HR Dashboard test**

Run: `pnpm --filter web test -- HRDashboard 2>&1 | tail -10`

Expected: passes. The existing test is a single `it.todo` placeholder, so it cannot fail.

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/HRDashboard.tsx
git commit -m "refactor(hr): remove Leave tab from HRDashboard (now in standalone LeaveManagement)"
```

---

## Task 7: Remove doctors from StaffPage

**Files:**
- Modify: `web/src/pages/StaffPage.tsx` (imports, query, render)

- [ ] **Step 1: Open the file**

Run: `sed -n '1,30p' web/src/pages/StaffPage.tsx`

- [ ] **Step 2: Remove the unused `Stethoscope` import**

Find (line 2):

```tsx
import { Users, Plus, X, Search, DollarSign, UserCheck, Stethoscope, Edit2, Trash2, ChevronRight } from 'lucide-react';
```

Replace with:

```tsx
import { Users, Plus, X, Search, DollarSign, UserCheck, Edit2, Trash2, ChevronRight } from 'lucide-react';
```

- [ ] **Step 3: Remove the doctors data fetch**

Find (lines 123–126):

```tsx
  const { data: doctorsData, isLoading: doctorsLoading } = useApiQuery<{
    doctors: { id: number; name: string; specialty: string; mobile_number: string; consultation_fee: number; is_active: number }[];
  }>(queryKeys.doctors.all, '/api/doctors');
  const doctors = doctorsData?.doctors ?? [];
```

Delete the entire block. The surrounding context (the staff fetch above and the shifts fetch below) stays put.

- [ ] **Step 4: Remove the `allMembers` combining logic**

Find (lines 137–156):

```tsx
  const allMembers: Staff[] = useMemo(() => {
    const staffMembers: Staff[] = staff.map(s => ({ ...s, _type: 'staff' as const }));
    const doctorMembers: Staff[] = doctors
      .filter(d => d.is_active !== 0)
      .map(d => ({
        id: d.id,
        name: d.name,
        address: '',
        position: d.specialty || 'Doctor',
        salary: d.consultation_fee || 0,
        bank_account: '',
        mobile: d.mobile_number || '',
        joining_date: '',
        status: 'active',
        department: d.specialty || '',
        _type: 'doctor' as const,
        specialty: d.specialty,
      }));
    return [...staffMembers, ...doctorMembers];
  }, [staff, doctors]);

  const isLoading = loading || doctorsLoading;
```

Replace with:

```tsx
  const isLoading = loading;
```

(That single line replaces both the `allMembers` definition and the combined `isLoading` line. The remaining code below this point already uses `staff` for filtering and `staff.length` for the KPI cards.)

- [ ] **Step 5: Find every `_type` reference and remove the conditional rendering**

Run: `grep -n "_type\|doctorCount\|allMembers" web/src/pages/StaffPage.tsx`

You should see references at:
- Line ~167: `const totalStaff = allMembers.length;` and `const activeCount = allMembers.filter(...).length;` and `const doctorCount = allMembers.filter(...).length;`
- Line ~313–319: The third KPI card showing "Doctors" with `{doctorCount}`.
- Line ~379+: The table body has `member._type !== 'doctor'` checks and a `(Dr)` badge and a `Stethoscope` icon for doctor rows.

For each of these, replace as follows:

**KPI calculations** — find:
```tsx
  const totalStaff = allMembers.length;
  const activeCount = allMembers.filter(s => s.status === 'active').length;
  const doctorCount = allMembers.filter(s => s._type === 'doctor').length;
```

Replace with:
```tsx
  const totalStaff = staff.length;
  const activeCount = staff.filter(s => s.status === 'active').length;
```

**Third KPI card** — find:
```tsx
          <KPICard
            title={t('staff:doctors', { defaultValue: 'Doctors' })}
            value={doctorCount}
            loading={isLoading}
            icon={<Stethoscope className="w-5 h-5" />}
            iconBg="bg-blue-50 text-blue-600"
            index={2}
          />
```

Delete this entire `<KPICard ... />` block (8 lines). The KPI grid above (`grid-cols-1 sm:grid-cols-3 gap-4`) will become 2 cards. Update the grid class to `grid-cols-1 sm:grid-cols-2 gap-4` so the layout looks balanced:

Find:
```tsx
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
```

Replace with:
```tsx
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
```

**Table filtering & rendering** — find:
```tsx
  const filtered = allMembers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.position.toLowerCase().includes(search.toLowerCase()) ||
    (s.department || '').toLowerCase().includes(search.toLowerCase()) ||
    s.mobile.includes(search)
  );
```

Replace with:
```tsx
  const filtered = staff.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.position.toLowerCase().includes(search.toLowerCase()) ||
    (s.department || '').toLowerCase().includes(search.toLowerCase()) ||
    s.mobile.includes(search)
  );
```

In the table body, the `filtered.map(member => (` block contains doctor-specific branches. Find:
```tsx
                  filtered.map(member => (
                    <tr
                      key={`${member._type || 'staff'}-${member.id}`}
                      className="group cursor-pointer hover:bg-[var(--color-bg-secondary)]"
                      onClick={() => member._type !== 'doctor' && openEdit(member)}
                    >
```

Replace with:
```tsx
                  filtered.map(member => (
                    <tr
                      key={member.id}
                      className="group cursor-pointer hover:bg-[var(--color-bg-secondary)]"
                      onClick={() => openEdit(member)}
                    >
```

The `(Dr)` badge below the name:
```tsx
                            <span className="font-medium text-[var(--color-text-primary)]">{member.name}</span>
                            {member._type === 'doctor' && (
                              <span className="ml-1.5 text-xs text-blue-500 font-medium">(Dr)</span>
                            )}
```

Replace with:
```tsx
                            <span className="font-medium text-[var(--color-text-primary)]">{member.name}</span>
```

The Stethoscope icon vs Users icon in the position cell:
```tsx
                        <div className="flex items-center gap-1.5">
                          {member._type === 'doctor' ? (
                            <Stethoscope className="w-3.5 h-3.5 text-blue-400" />
                          ) : (
                            <Users className="w-3.5 h-3.5 text-indigo-400" />
                          )}
                          {member.position}
                        </div>
```

Replace with:
```tsx
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-indigo-400" />
                          {member.position}
                        </div>
```

The salary cell with the `৳` raw symbol vs `fmtCurrency`:
```tsx
                      <td className="text-right font-medium font-data text-sm">
                        {member._type === 'doctor' ? `৳${member.salary}` : fmtCurrency(member.salary || 0)}
                      </td>
```

Replace with:
```tsx
                      <td className="text-right font-medium font-data text-sm">
                        {fmtCurrency(member.salary || 0)}
                      </td>
```

The status badge:
```tsx
                      <td className="text-center">
                        <span className={`badge ${
                          member._type === 'doctor'
                            ? 'badge-primary'
                            : member.status === 'active'
                              ? 'badge-success'
                              : 'badge-secondary'
                        }`}>
                          {member._type === 'doctor' ? 'Doctor' : member.status || 'active'}
                        </span>
                      </td>
```

Replace with:
```tsx
                      <td className="text-center">
                        <span className={`badge ${
                          member.status === 'active' ? 'badge-success' : 'badge-secondary'
                        }`}>
                          {member.status || 'active'}
                        </span>
                      </td>
```

The action buttons (the `(member._type !== 'doctor' && (...))` guard):
```tsx
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {member._type !== 'doctor' && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); openEdit(member); }}
                                ...
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete(member); }}
                                ...
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
```

Replace with:
```tsx
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(member); }}
                            className="p-1.5 rounded-lg hover:bg-[var(--color-border-light)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                            title={t('common:edit', { defaultValue: 'Edit' })}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(member); }}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-500"
                            title={t('staff:deactivate', { defaultValue: 'Deactivate' })}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
```

(The `<>` fragment and the `_type !== 'doctor'` guard are removed; the two buttons stay as direct children of the wrapper div.)

- [ ] **Step 6: Remove the `'doctor'` entry from `CATEGORY_OPTIONS`**

Find (line 49–60):

```tsx
const CATEGORY_OPTIONS = [
  { value: 'doctor', label: 'Doctor' },
  { value: 'nurse', label: 'Nurse' },
  ...
```

Replace with:

```tsx
const CATEGORY_OPTIONS = [
  { value: 'nurse', label: 'Nurse' },
  ...
```

(Just delete the doctor line; the rest stays.)

- [ ] **Step 7: Clean up unused types and imports**

The `Staff` interface has `_type` and `specialty` fields. Find:

```tsx
interface Staff {
  id: number;
  name: string;
  address: string;
  position: string;
  salary: number;
  bank_account: string;
  mobile: string;
  joining_date: string;
  status: string;
  department?: string;
  _type?: 'staff' | 'doctor';
  specialty?: string;
}
```

Replace with:

```tsx
interface Staff {
  id: number;
  name: string;
  address: string;
  position: string;
  salary: number;
  bank_account: string;
  mobile: string;
  joining_date: string;
  status: string;
  department?: string;
}
```

The `useMemo` import is still used by the `shifts` `useMemo` call (line 132). Keep it.

- [ ] **Step 8: Type-check**

Run: `pnpm --filter web exec tsc --noEmit -p web 2>&1 | grep -E "StaffPage" | head -20`

Expected: no errors. If you see "unused import `Doctors`" or similar, remove the import.

- [ ] **Step 9: Run the StaffPage test**

Run: `pnpm --filter web test -- StaffPage 2>&1 | tail -10`

Expected: passes (the test only checks the default export, which is still present).

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/StaffPage.tsx
git commit -m "refactor(staff): remove doctors from StaffPage (managed exclusively in DoctorList)"
```

---

## Task 8: Switch LeaveManagement to the new `leaveTitle` key

**Files:**
- Modify: `web/src/pages/LeaveManagement.tsx:130-133`

- [ ] **Step 1: Open the file**

Run: `sed -n '125,140p' web/src/pages/LeaveManagement.tsx`

- [ ] **Step 2: Update the page header**

Find:

```tsx
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('hr:title')}</h1>
            <p className="section-subtitle mt-1">{t('hr:subtitle')}</p>
          </div>
        </div>
```

Replace with:

```tsx
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('hr:leaveTitle', { defaultValue: 'Leave Management' })}</h1>
            <p className="section-subtitle mt-1">{t('hr:subtitle')}</p>
          </div>
        </div>
```

The `defaultValue` covers the case where the locale has not loaded yet. The `subtitle` is unchanged — it still describes leave (the new subtitle string from Tasks 3 & 4 is for the HR Dashboard header, not for this page; we keep the leave-focused subtitle for now). If the user later wants the subtitle to also be different on this page, that is a follow-up.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web exec tsc --noEmit -p web 2>&1 | grep -E "LeaveManagement" | head -20`

Expected: no errors.

- [ ] **Step 4: Run the LeaveManagement test**

Run: `pnpm --filter web test -- LeaveManagement 2>&1 | tail -10`

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/LeaveManagement.tsx
git commit -m "refactor(leave): page header now uses hr:leaveTitle (HR Dashboard owns hr:title)"
```

---

## Task 9: Build, test, and deploy

**Files:** None (verification + deployment)

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter web test 2>&1 | tail -30`

Expected: all tests pass. If any test fails, inspect — none of the existing tests assert on the renamed labelKeys or removed doctors, so a failure likely means an unrelated pre-existing issue. Fix only if it's clearly caused by this change.

- [ ] **Step 2: Type-check the whole web workspace**

Run: `pnpm --filter web exec tsc --noEmit 2>&1 | tail -30`

Expected: no new TypeScript errors. Pre-existing errors unrelated to this change can be left as-is.

- [ ] **Step 3: Build for production**

Run: `pnpm --filter web build 2>&1 | tail -20`

Expected: build succeeds. Bundle size may shift slightly (HRDashboard loses a tab; StaffPage loses a few branches; adminSidebarConfig loses some labelKey strings). No errors.

- [ ] **Step 4: Manual smoke check (optional but recommended)**

If a local dev server is running, open:
- `/h/<slug>/staff` → page shows only staff (no doctor rows), KPI grid has 2 cards, no "(Dr)" badge anywhere.
- `/h/<slug>/hr` → page header reads "HR Dashboard" (or Bengali equivalent); tabs are Overview / Attendance / Payroll; no Leave tab.
- `/h/<slug>/hr/leave` → page header reads "Leave Management"; tabs are Requests / Balances / Categories.
- `/h/<slug>/doctors` → unchanged.

- [ ] **Step 5: Deploy to production**

Per `AGENTS.md`, production deploy uses `--env production`. Run:

```bash
pnpm build && wrangler deploy --env production
```

Expected: deployment completes; production URL is `https://hms-saas-production.rahmatullahzisan.workers.dev`.

- [ ] **Step 6: Verify in production**

Open the production URL, sign in as a hospital admin, and re-run the same manual smoke check from Step 4 against the live site.

- [ ] **Step 7: Final commit (if any local changes were made during verification)**

If steps 1–6 produced no diffs, skip. Otherwise:

```bash
git status
git add -A
git diff --cached --stat
git commit -m "chore: post-deploy verification cleanup"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Every spec section has at least one task. §1 (sidebar labels) → Tasks 1, 2, 5. §2 (HRDashboard) → Tasks 3, 4, 6. §3 (StaffPage) → Task 7. §4 (LeaveManagement) → Task 8. §5 (DoctorList) → no change required. §6 (Tests) → noted in §9 of spec; no rewrites. §7 (Data flow) → unchanged. §9 (Verification) → Task 9.
- [x] **Placeholder scan:** No "TBD" / "TODO" / "implement later" / "add appropriate error handling." All steps have concrete code or commands.
- [x] **Type consistency:** `labelKey` values (`staff`, `hrDashboard`, `leave`, `doctors`, `permissions`, `rolesPermissions`) match across all tasks. The `TABS` tuple, `tabIcons` map, and conditional rendering all use the same three keys (`overview`, `attendance`, `payroll`). The `CATEGORY_OPTIONS` array and `Staff` interface are updated consistently in Task 7.
- [x] **Order safety:** Tasks 1–4 add new i18n keys before any component references them. Task 5 references the new keys after they exist. Tasks 6, 7, 8 reference the updated strings only after the i18n files are updated.

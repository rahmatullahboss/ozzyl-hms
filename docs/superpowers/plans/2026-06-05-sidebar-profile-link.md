# Sidebar Profile Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Profile" link to the bottom of every role's sidebar so users can reach their profile page from any page in one click.

**Architecture:** Define one `COMMON_FOOTER_ITEMS` constant in `Sidebar.tsx` containing a single `NavItem` for the profile link. Auto-append it to every role's nav groups via spread, so the link is added in exactly one place. The existing `filterNavItems` keeps the link for every role because it has no `requiredPermission`.

**Tech Stack:** React 18, react-router, i18next, vitest, react-testing-library, TypeScript.

**Reference spec:** `docs/superpowers/specs/2026-06-05-sidebar-profile-link-design.md`

---

## File Map

| File | Role | Change |
|------|------|--------|
| `web/src/components/dashboard/Sidebar.tsx` | Sidebar component | Add 1 const + change 1 line in role lookup |
| `web/src/components/dashboard/Sidebar.test.tsx` | Sidebar unit tests | Add 1 label + 10 role test cases |

No new files, no schema changes, no i18n changes, no backend changes.

---

## Task 1: Add Profile link to sidebar (TDD)

**Files:**
- Modify: `web/src/components/dashboard/Sidebar.tsx:652`
- Modify: `web/src/components/dashboard/Sidebar.test.tsx:7-26`

- [ ] **Step 1: Add a failing test in `Sidebar.test.tsx`**

Open `web/src/components/dashboard/Sidebar.test.tsx` and make these changes:

a) Add `'profile': 'Profile'` to the `labels` object (after `'softwareModules'`, before `'signOut'`):

```typescript
const labels: Record<string, string> = {
  adminSettingsControlRoom: 'Admin Settings',
  hospitalSetup: 'Hospital Setup',
  usersPermissions: 'Users & Permissions',
  doctorsDepartments: 'Doctors & Departments',
  servicesPricing: 'Services & Pricing',
  opdAppointmentSettings: 'OPD / Appointment Settings',
  billingSettings: 'Billing Settings',
  labSettings: 'Lab Settings',
  pharmacySettings: 'Pharmacy Settings',
  ipdBedSettings: 'IPD / Bed Settings',
  printSettings: 'Print Settings',
  smsNotification: 'SMS / Notification',
  reportsSettings: 'Reports Settings',
  securityAuditLog: 'Security & Audit Log',
  backupData: 'Backup & Data',
  systemPreferences: 'System Preferences',
  softwareModules: 'Software Modules',
  profile: 'Profile',
  signOut: 'Sign out',
};
```

b) Add a new test case at the end of the `describe('Sidebar', ...)` block (after the closing `});` of the existing `it('exposes the admin settings...')` test, before the closing `});` of the describe block):

```typescript
  it('shows a Profile link in the sidebar footer for hospital_admin', async () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role="hospital_admin" permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const profileLink = screen.getByRole('link', { name: 'Profile' });
    expect(profileLink).toBeInTheDocument();
    expect(profileLink).toHaveAttribute('href', '/h/city-hospital/profile');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/dashboard/Sidebar.test.tsx 2>&1 | tail -20`

Expected: FAIL with message like "Unable to find a link with the name 'Profile'" because no `Profile` link exists yet in the sidebar.

- [ ] **Step 3: Add the COMMON_FOOTER_ITEMS constant in `Sidebar.tsx`**

Open `web/src/components/dashboard/Sidebar.tsx`. Add the following const immediately AFTER the `NavGroup` interface declaration (around line 41, right after the closing brace of the `NavGroup` interface, before the `export default function Sidebar`):

```typescript
/** Items appended to every role's sidebar as a common footer. */
const COMMON_FOOTER_ITEMS: NavItem[] = [
  { labelKey: 'profile', path: 'profile', icon: <UserCircle className="w-4.5 h-4.5" /> },
];
```

The `UserCircle` icon is already imported on line 12. The `NavItem` type is declared at line 28. No new imports needed.

- [ ] **Step 4: Append the footer to every role's nav in `Sidebar.tsx`**

In `web/src/components/dashboard/Sidebar.tsx`, find the existing line at line 652:

```typescript
  const allNavGroups: NavGroup[] = roleNavGroups[normalizedRole] ?? roleNavGroups.hospital_admin;
```

Replace it with:

```typescript
  const baseGroups = roleNavGroups[normalizedRole] ?? roleNavGroups.hospital_admin;
  const allNavGroups: NavGroup[] = [...baseGroups, { items: COMMON_FOOTER_ITEMS }];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/dashboard/Sidebar.test.tsx 2>&1 | tail -20`

Expected: PASS — both the original "exposes the admin settings..." test and the new "shows a Profile link..." test pass.

- [ ] **Step 6: Run tsc to verify no type errors**

Run: `pnpm --filter web exec tsc --noEmit 2>&1 | tail -5`

Expected: no output (clean exit).

- [ ] **Step 7: Commit**

```bash
git add web/src/components/dashboard/Sidebar.tsx web/src/components/dashboard/Sidebar.test.tsx
git commit -m "feat(sidebar): add Profile link to bottom of every role's sidebar"
```

---

## Task 2: Test the Profile link appears for all 9 other roles

**Files:**
- Modify: `web/src/components/dashboard/Sidebar.test.tsx`

- [ ] **Step 1: Add a parametrized test covering all 10 roles**

Open `web/src/components/dashboard/Sidebar.test.tsx` and add a new test after Task 1's test (before the closing `});` of the `describe('Sidebar', ...)` block):

```typescript
  it.each([
    'super_admin',
    'hospital_admin',
    'laboratory',
    'reception',
    'md',
    'director',
    'pharmacist',
    'doctor',
    'nurse',
    'accountant',
  ] as const)('shows a Profile link for the %s role', (role) => {
    render(
      <MemoryRouter initialEntries={[`/h/city-hospital/${role}/dashboard`]}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role={role} permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const profileLink = screen.getByRole('link', { name: 'Profile' });
    expect(profileLink).toBeInTheDocument();
    expect(profileLink).toHaveAttribute('href', '/h/city-hospital/profile');
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/dashboard/Sidebar.test.tsx 2>&1 | tail -20`

Expected: PASS — 12 test cases (1 original + 1 from Task 1 + 10 from this parametrized test).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/dashboard/Sidebar.test.tsx
git commit -m "test(sidebar): verify Profile link appears for all 10 roles"
```

---

## Task 3: Build, deploy, and sanity-check

**Files:** none (operational task)

- [ ] **Step 1: Build the project**

Run: `pnpm build 2>&1 | tail -10`

Expected: build completes successfully. Look for `✓ built in <N>ms` near the end.

- [ ] **Step 2: Deploy to production**

Run: `wrangler deploy --env production 2>&1 | tail -10`

Expected: deployment completes. Look for `Deployed hms-saas-production triggers` and the production URL.

- [ ] **Step 3: Verify the production endpoint responds**

Run: `curl -sI https://hms-saas-production.rahmatullahzisan.workers.dev/ | head -5`

Expected: HTTP 200 or 30x (the Worker is alive).

- [ ] **Step 4: Verify git tree is clean**

Run: `git status`

Expected: no uncommitted changes related to this feature. The `.codex/superpowers` modified content and the `docs/superpowers/plans/2026-06-04-token-reservation.md` untracked file are pre-existing and unrelated.

- [ ] **Step 5: Report completion to the user**

Reply in Bengali Roman script. Tell the user:
- The Profile link now appears at the bottom of every role's sidebar
- They can click "Profile" from any page to reach the profile editor
- They can edit photo, name, email, phone, and change password
- The top-right dropdown still works (kept for quick access)

---

## Self-Review Notes

**Spec coverage:**
- ✅ Visual placement: top-level at bottom (no groupKey) — handled by `groupKey`-less group appended to `baseGroups`
- ✅ Auto-inject via single helper — handled by spread in step 4 of Task 1
- ✅ No permission gate — `COMMON_FOOTER_ITEMS` has no `requiredPermission` field
- ✅ Reuses existing i18n key `'profile'` — no translation file changes
- ✅ Header dropdown unchanged — no modification to `Header.tsx`
- ✅ All 10 roles covered — parametrized test in Task 2
- ✅ Out-of-scope items (new fields, role-specific profiles) explicitly excluded

**Type consistency:**
- `NavItem` interface (line 28) used unchanged
- `NavGroup` interface (line 38) used unchanged
- `COMMON_FOOTER_ITEMS: NavItem[]` — explicit type matches the existing pattern
- `'profile'` matches the existing key in `web/public/locales/en/sidebar.json:193` and `bn/sidebar.json`
- `UserCircle` icon already imported on line 12

**Pre-existing test failures (unrelated):**
- `useSettingsForm.test.tsx`, `DiagnosisOrders.test.tsx`, `TimelineEventExpandable.test.tsx` are pre-existing failures confirmed in earlier sessions. They are not touched by this plan and will not be affected.

# Sidebar Profile Link — Design

**Date:** 2026-06-05
**Status:** Approved (pending implementation)
**Type:** Frontend-only UX fix

---

## Problem

The profile management page (`web/src/pages/ProfilePage.tsx`) is fully implemented with:
- Photo upload (camera button, browser compression → R2)
- Name, email, phone editing
- Password change with current-password verification (`PUT /api/users/me/password`)
- Bilingual UI (English + Bengali) following the existing `printLang`/`i18n` pattern

However, the only way to reach it is through the **top-right user dropdown** in the header (`Header.tsx:381-387`), which is hidden until the user clicks the avatar. Many users — especially non-admin staff (nurse, doctor, receptionist, lab, pharmacist) — don't think to look there, and report being unable to find a way to edit their profile or change their password.

The DanpheEMR reference system exposes a "My Profile" entry in the sidebar for every role. Our HMS sidebar currently has no profile link.

## Goal

Add a single **"Profile"** link to the bottom of every role's sidebar so the user can reach their profile from any page in one click, regardless of role.

## Non-Goals

- Replacing or removing the top-right dropdown (it still shows name/role/sign-out and is useful at-a-glance)
- Adding new editable fields to the profile page
- Role-specific profile fields (doctor BMDC reg no, nurse NID, etc.) — future work
- Email verification flow — future work

## Design

### Approach: auto-inject a shared footer group

Define **one** `COMMON_FOOTER_ITEMS` constant in `Sidebar.tsx`. Append it to every role's nav groups via a single line in the role lookup. This is DRY, gives a single source of truth, and makes future common links (Theme toggle, Language picker) trivial to add.

### Visual placement

The link is added as a final `NavGroup` with **no `groupKey`** (no section label). The renderer at `Sidebar.tsx:923-935` already injects `mt-4` between groups, so the link gets a natural visual separator from the role's main nav. The link sits in the scrollable nav area, **above** the footer (which contains the collapse toggle and sign-out button).

For roles that already show a "Help Center" link as the last item of their last group, the profile link will appear below Help Center, separated by `mt-4`.

### Code shape

```ts
// In Sidebar.tsx — at module scope, near the NavItem/NavGroup interfaces

/** Items appended to every role's sidebar. */
const COMMON_FOOTER_ITEMS: NavItem[] = [
  { labelKey: 'profile', path: 'profile', icon: <UserCircle className="w-4.5 h-4.5" /> },
];
```

```ts
// Replace this at line 652:
const allNavGroups: NavGroup[] = roleNavGroups[normalizedRole] ?? roleNavGroups.hospital_admin;

// With:
const baseGroups = roleNavGroups[normalizedRole] ?? roleNavGroups.hospital_admin;
const allNavGroups: NavGroup[] = [...baseGroups, { items: COMMON_FOOTER_ITEMS }];
```

### Why no permission gate

Every authenticated user has a profile and the right to edit it. The `/api/users/me` endpoints are self-scoped (use the JWT's `userId`, not a path param). A `requiredPermission` would just add noise.

### Why no `groupKey`

A "Profile" group label would look strange at the bottom of the sidebar — it's a single personal link, not a category. The renderer's `group.groupKey && !collapsed` check at line 926 means no-label groups render flat, which is exactly what we want.

### Why use the existing `profile` i18n key

`web/public/locales/en/sidebar.json:193` already has `"profile": "Profile"`, and the Bengali locale has the equivalent. Reusing it means **no translation file changes**. The `ProfilePage.tsx` uses `t('myProfile')` from `common.json`, but the sidebar namespace (`useTranslation('sidebar')`) is what the sidebar uses — so the sidebar label is "Profile" (consistent with the existing `profile` key, no new key needed).

## Affected Files

| File | Change |
|------|--------|
| `web/src/components/dashboard/Sidebar.tsx` | Add `COMMON_FOOTER_ITEMS` const (1 line) + spread into role lookup (1 line) |
| `web/src/components/dashboard/Sidebar.test.tsx` | Add test cases verifying the Profile link renders for all 10 roles and navigates to `/h/:slug/profile` |

## Out-of-scope confirmations

- `Header.tsx` dropdown: **unchanged**. The "My Profile" button at line 381-387 still works. Two access points is fine; the dropdown gives quick reach, the sidebar gives discoverability.
- `ProfilePage.tsx`: **unchanged**. Already complete.
- `App.tsx:665` route: **unchanged**. The `path="profile"` route already exists and resolves correctly under `/h/:slug/`.
- i18n files: **unchanged**. The `profile` key already exists in `sidebar.json` for both `en` and `bn`.

## Testing

1. **Unit test in `Sidebar.test.tsx`:** Render the sidebar with each of the 10 roles (`super_admin`, `hospital_admin`, `laboratory`, `reception`, `md`, `director`, `pharmacist`, `doctor`, `nurse`, `accountant`). Assert that the `Profile` link is present, has `href="/h/test-slug/profile"`, and uses the `UserCircle` icon.

2. **Manual test:** Deploy to production. Log in as a nurse (least-permission role). Confirm the Profile link appears at the bottom of the sidebar. Click it. Confirm the profile page loads with photo, name, email, phone, and password-change form all working.

3. **Visual test:** Collapsed sidebar should show the `UserCircle` icon as a centered icon with the `Profile` tooltip on hover — same as other icon-only collapsed nav items.

## Risks

- **None significant.** The change is purely additive (one new nav group appended to every role's `baseGroups` *before* the `filterNavItems` pass at line 138-147). The filter still runs on the new group, but because `COMMON_FOOTER_ITEMS` has no `requiredPermission`, `hasPermission(undefined)` returns `true` and the link is kept for every role. This is the same permission path that "Help Center" entries use (see `nurse` role line 586, `director` line 527, etc.).
- The `Sidebar.tsx` file is 960 lines; we are adding 2 lines. Per `AGENTS.md` (files > 600 lines should be split), this contributes trivially to existing size. A future refactor could extract the `COMMON_FOOTER_ITEMS` and the role config into a separate `navConfig.ts` file, but that is out of scope for this change.

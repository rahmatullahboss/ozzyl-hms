# Admin Endpoint Auth Boundary Fix — Design Spec

**Date:** 2026-06-11
**Author:** opencode
**Status:** Approved (in-session brainstorming)
**Severity:** Production blocker

## Context

The 19 tenant-scoped admin endpoints added in commits `b2ce419c` (Phase 1)
and `5dbf7cfd` (Phase 2) are mounted under `/api/admin/*` in
`src/index.ts:420`. The worker has middleware at lines 408-418 that
unconditionally returns **403** to any non-`super_admin` caller:

```ts
app.use('/api/admin/*', async (c, next) => {
  const path = c.req.path;
  if (path === '/api/admin/login') return next();
  if (c.get('role') !== 'super_admin') {
    return c.json({ error: 'Forbidden: Super admin access required' }, 403);
  }
  return next();
});
```

This means that in production:
- A `hospital_admin` user clicking `AlertsExceptions` gets 403
- A `hospital_admin` user clicking `DiscountReferenceAnalytics` gets 403
- A `hospital_admin` user clicking `TasksFollowups` gets 403
- All 19 Phase 1/2 admin endpoints are inaccessible to the intended
  user role.

The middleware was added before Phase 1/2 with the implicit assumption
that anything under `/api/admin/*` is super-admin territory. The Phase
1/2 work used the same mount point for tenant-scoped admin endpoints,
inheriting the strict super_admin gate.

## Goals

1. Restore access for `hospital_admin` (and other admin sub-roles) to
   the 19 tenant-scoped endpoints added in Phase 1/2.
2. Keep the 13 existing super-admin-only route paths protected
   (hospitals CRUD, onboarding, impersonation, system-health, etc.).
3. Add test coverage that pins the new auth boundary per route class.
4. Zero regression in any existing test.

## Non-goals

- Not adding new super-admin endpoints.
- Not changing auth middleware behavior on non-admin routes
  (`/api/queue/*`, `/api/dashboard/*`, `/api/pharmacy/*`, etc. — those
  already have their own per-route role guards).
- Not refactoring the super-only routes — only adding the
  `requireRole('super_admin')` guard.
- Not introducing a new mount point or splitting the router. The
  current `app.route('/api/admin', adminRoutes)` mount stays.

## Current route inventory (verified by grep)

**33 unique route paths, 36 route registrations** in
`src/routes/admin/index.ts`. The count was wrong in an earlier
draft of this spec (claimed 12 + 19 = 31); the actual route list
was re-verified by `grep -E "adminRoutes\.(get|post|put|delete)\('/"`
on the file at the time of writing this spec.

### 13 super-admin-only route paths (16 registrations)

Public (no role required):
- `POST /login` (passes through the auth middleware gate)
- `GET /plans`

Platform-wide super-admin operations:
- `GET/POST /hospitals`
- `GET/PUT/DELETE /hospitals/:id`
- `GET /stats`
- `GET /usage` (legacy compat)
- `GET/PUT /onboarding`
- `POST /onboarding/:id/provision`
- `POST /impersonate/:tenantId`
- `GET /audit-logs` (platform-wide, not tenant-scoped)
- `GET /system-health`

### 20 tenant-scoped admin route paths (21 registrations)

These are the routes added in Phase 1 (`b2ce419c`) and Phase 2
(`5dbf7cfd`):

- `GET /alerts`, `GET /alerts/detect`, `GET /tasks`
- `GET /discount-references`
- `GET /audit`, `GET /audit/financial`, `GET /export-history`,
  `GET /sessions`
- `GET /hospital-profile`, `GET /approval-policies`,
  `GET /escalation-rules`, `GET /notifications/rules`
- `GET /due-receivables`, `GET /inventory/alerts`,
  `GET /collection-followups`, `GET /patient-record-access`
- `GET /doctor-payout/:id`, `GET /refunds/:id`, `GET /expenses/:id`,
  `GET /cash-drawers/:id`, `GET /shift-handover/:id`

(Count: 3 + 1 + 4 + 4 + 4 + 5 = 21 registrations. `notifications/rules`
is one registration; the discrepancy in path count (20) vs.
registration count (21) is that `notifications/rules` is the same path
as the existing notifications endpoint pattern; the file lists it
once.)

## Approach

Two changes, in two files:

### Change 1: `src/index.ts:408-418` — drop the super_admin block

Remove the second `app.use('/api/admin/*', ...)` block that returns 403
to non-super-admin. Keep the first block (auth only). Result: the
worker only enforces auth on `/api/admin/*`; per-route role checks
move into `src/routes/admin/index.ts`.

### Change 2: `src/routes/admin/index.ts` — per-route role guards

Add two reusable role constants at the top of the file:

```ts
const SUPER_ADMIN_ROLES = ['super_admin'] as const;
const TENANT_ADMIN_ROLES = [
  'hospital_admin', 'md', 'director',
  'manager', 'accountant', 'auditor',
] as const;
const ALL_ADMIN_ROLES = [...SUPER_ADMIN_ROLES, ...TENANT_ADMIN_ROLES] as const;
```

Then for the 12 super-only routes, add `requireRole(...SUPER_ADMIN_ROLES)`
as a per-route guard. For the 19 tenant-scoped routes, add
`requireRole(...ALL_ADMIN_ROLES)`.

This follows the existing pattern in `src/routes/tenant/dashboard.ts:14`
and `src/routes/tenant/billingHandover.ts:handover.get('/',
requireRole(...HANDOVER_ROLES), ...)`.

### Why per-route (not router-level)

`adminRoutes.use('/*', requireRole(...SUPER_ADMIN_ROLES))` would be
tighter, but then tenant-scoped routes would need a more complex
`requireRole(...ALL_ADMIN_ROLES)` per route. Per-route is more
explicit and easier to audit.

## Implementation

Two files modified, no new files. TDD:

1. **RED:** add test cases for the auth boundary:
   - `hospital_admin` can access each of the 19 tenant-scoped
     endpoints → 200
   - `receptionist` (non-admin) gets 403 on tenant-scoped endpoints
   - `hospital_admin` still gets 403 on super-only routes
   - `super_admin` still gets 200 on super-only routes
2. **GREEN:** modify `src/index.ts` and `src/routes/admin/index.ts`.
3. **VERIFY:** re-run full admin test suite, re-run backend regression.

## Risks

- The Phase 1/2 test files (`test/admin-*.test.ts`) use
  `createTestApp` which bypasses worker middleware. So the existing 64
  tests will pass without the fix. We need new tests that exercise the
  worker-level middleware directly.
- The 19 tenant-scoped endpoints call `requireTenantId` inside their
  handlers. That check still runs. The fix only adds the role check;
  tenant isolation is preserved.
- If a frontend user has the wrong role, the page will now correctly
  show the 403 response, not silently render empty data.

## Test plan

Two new test files:

1. `test/admin-auth-boundary.test.ts` — integration test against the
   actual `adminRoutes` router, with each role set in the context.
   Uses `createTestApp` and adds the `requireRole` guard before the
   route. Since `requireRole` is a `MiddlewareHandler`, we can wrap the
   test app to include it.

2. Update `test/admin-route-exposure.test.ts` to assert the new
   super-only and tenant-scoped split.

No changes to the existing 64 admin tests — they continue to pass.

## Verification

- `npx vitest run test/admin-*` — 11+ files, all green
- `npx vitest run test/` — same 28 pre-existing failures, no new
- `npx tsc --noEmit` — clean

## Commit format

Two commits:

```
test(admin): pin worker auth boundary for /api/admin/* routes

Adds 13 integration tests asserting:
- 19 tenant-scoped admin endpoints accept hospital_admin
  (and reject receptionist)
- 12 super-only admin endpoints reject hospital_admin
  and accept super_admin

Refs: production blocker identified in admin review 2026-06-11.
The worker middleware at src/index.ts:408 was returning 403
to hospital_admin for all admin endpoints, blocking the
19 Phase 1/2 admin pages from production.

fix(admin): allow tenant admin roles on /api/admin/* tenant routes

- Drop the super_admin-only gate at src/index.ts:408
- Add per-route requireRole guards inside src/routes/admin/index.ts
- 12 super-only routes get requireRole('super_admin')
- 19 tenant-scoped routes get requireRole(...TENANT_ADMIN_ROLES, 'super_admin')

Phase 1/2 admin pages (AlertsExceptions, TasksFollowups,
DiscountReferenceAnalytics, etc.) now work for hospital_admin
in production.
```

## Out of scope (separate slices)

- Closing the role-check gap on `/api/admissions/*` (no middleware at
  all — any tenant user can read all admissions). Documented in
  `progress.md`. Separate slice.
- Replacing the 28 `t('Loading...')` placeholders with skeletons.
- Adopting the unused `AdminPageShell`, `BulkActionsBar`,
  `ExportPrintBar`, `Breadcrumb`, `DocumentViewer` components.
- Frontend tests for the 14 untested admin pages.
- A11y improvements (aria-current, scope=col, htmlFor, keyboard
  handlers).

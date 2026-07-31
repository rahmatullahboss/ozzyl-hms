# Platform Staff Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate Ozzyl platform staff accounts so internal setup/support staff can manage assigned hospitals and open short-lived, audited support sessions without sharing a super-admin account.

**Architecture:** Keep hospital users tenant-scoped in `users`; add separate platform staff identity tables so platform staff do not bypass tenant user constraints. Admin routes use capability guards for platform operations, and support impersonation requires either a privileged platform role or an explicit tenant grant.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite migrations, TypeScript, Vitest.

## Global Constraints

- Healthcare security: least privilege, deny-by-default, tenant grant checks, and audit logs for important support actions.
- Preserve existing super-admin behavior and httpOnly `admin_token` cookie contract.
- Do not place platform staff in tenant-scoped `users`; keep staff identities separate from hospital client staff.
- Support impersonation tokens must stay short-lived and include actor/reason/session metadata.
- Existing dangerous remote-control operations remain super-admin only.

---

### Task 1: Platform role catalog and helpers

**Files:**
- Modify: `packages/shared/src/authz.ts`
- Create: `src/lib/platform-staff.ts`
- Test: `test/unit/platform-staff-access.test.ts`

**Interfaces:**
- Produces `PLATFORM_ROLES`, platform role permissions, `requirePlatformCapability()`, `parsePlatformStaffSubjectId()`, and support actor helpers.

- [x] Write failing tests proving platform roles normalize, have only platform permissions, and support role lacks staff-management permission.
- [x] Implement shared role catalog additions and helper middleware.
- [x] Run `pnpm vitest run test/unit/platform-staff-access.test.ts`.

### Task 2: Platform staff storage migration

**Files:**
- Create: `migrations/0402_platform_staff_access.sql`
- Test: `test/unit/platform-staff-migration.test.ts`

**Interfaces:**
- Produces `platform_staff_accounts` and `platform_staff_tenant_grants` tables.

- [x] Write a migration content test checking tables, role checks, grant indexes, and no changes to tenant user table.
- [x] Add D1-compatible SQL migration.
- [x] Run the migration test.

### Task 3: Admin login/refresh supports platform staff

**Files:**
- Modify: `src/routes/admin/index.ts`
- Test: `test/integration/routes/admin-platform-staff.test.ts`

**Interfaces:**
- Consumes platform helper functions and `platform_staff_accounts`.
- Produces admin login for `platform_*` roles with `user.id = staff:<id>`.

- [x] Write failing integration tests for platform staff login and support impersonation behavior.
- [x] Implement separate platform staff login route backed by `platform_staff_accounts`.
- [x] Implement refresh path for `staff:<id>` subjects on the platform-staff route.
- [x] Run focused admin staff tests and existing admin login cookie tests.

### Task 4: Tenant grant-controlled support impersonation

**Files:**
- Modify: `src/routes/admin/index.ts`
- Test: `test/integration/routes/admin-platform-staff.test.ts`

**Interfaces:**
- Consumes `platform_staff_tenant_grants`.
- Produces grant checks around `/api/admin/impersonate/:tenantId`.

- [x] Write tests proving platform support without a tenant grant is denied.
- [x] Write tests proving active grant allows impersonation only for the allowed role.
- [x] Add a new `platform:support:impersonate` route with grant enforcement.
- [x] Keep existing super-admin impersonation route unchanged for compatibility.

### Task 5: Staff management APIs

**Files:**
- Modify: `src/routes/admin/index.ts`
- Test: `test/integration/routes/admin-platform-staff.test.ts`

**Interfaces:**
- Produces `/api/admin/staff`, `/api/admin/staff/:id`, `/api/admin/staff/:id/reset-password`, and `/api/admin/staff/:id/grants`.

- [ ] Add tests proving `platform_support` cannot manage staff and `platform_admin` can create/update grants.
- [x] Add minimal CRUD endpoints for platform staff and tenant grants.
- [ ] Add explicit audit rows for create/update/grant operations.

### Task 6: Verification

**Files:**
- No new files unless fixes are required.

- [x] Run focused tests.
- [x] Run `pnpm build:migrations`.
- [x] Run `pnpm tsc --noEmit`; current failure is pre-existing `src/routes/tenant/inventory/writeoff.ts` Remarks type issue outside this slice.
- [ ] Commit a focused slice if git commands are available in the workspace tool.

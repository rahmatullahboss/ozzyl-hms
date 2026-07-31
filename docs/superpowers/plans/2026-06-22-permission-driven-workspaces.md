# Plan: Permission-Driven Workspaces for Multi-Duty Hospital Staff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Use TDD. Commit after every task. Keep work in a clean worktree/branch. Do not modify unrelated dirty workspace files.

**Date:** 2026-06-22  
**Spec:** `docs/superpowers/specs/2026-06-22-permission-driven-workspaces-design.md`  
**Goal:** Make role/permission/UI work correctly for Bangladesh-style multi-duty hospital staff. A manager with reception permissions should see and open reception UI without being made `hospital_admin`.

## Architecture summary

The implementation converts frontend access from role-first to permission-first while preserving backend API authorization as source of truth.

```text
Primary role → identity/default dashboard
Effective permissions → API + route access
Workspace registry → sidebar, command palette, mobile nav, launcher
Scopes/constraints → branch/counter/shift/self-approval safety
```

## File structure

### Frontend access and navigation

- Modify: `web/src/components/ProtectedRoute.tsx`
- Modify: `web/src/App.tsx`
- Create: `web/src/lib/routeAccess.ts`
- Create: `web/src/lib/workspaceAccess.ts`
- Modify: `web/src/components/dashboard/Sidebar.tsx`
- Modify: `web/src/components/dashboard/CommandPalette.tsx`
- Modify: `web/src/components/dashboard/MobileBottomNav.tsx`
- Modify: `web/src/components/DashboardLayout.tsx`
- Create/modify tests:
  - `web/src/components/ProtectedRoute.permission.test.tsx`
  - `web/src/components/dashboard/Sidebar.permission-workspaces.test.tsx`
  - `web/src/components/dashboard/CommandPalette.permission-workspaces.test.tsx`
  - `web/src/components/dashboard/MobileBottomNav.permission-workspaces.test.tsx`

### Shared authz model

- Modify: `packages/shared/src/authz.ts`
- Modify: `web/src/lib/authSession.ts` if default route logic must use workspace preference.
- Modify tests around shared auth/session if present.

### Backend bundle/scopes

- Create: `migrations/0375_permission_bundles_workspaces.sql` or next available migration number after confirming latest.
- Modify: `tenant-schema.sql`
- Modify: `src/middleware/rbac.ts`
- Modify: `src/routes/tenant/permissions.ts`
- Create: `src/schemas/permission-bundles.ts`
- Create/modify tests:
  - `test/permissions-bundles.test.ts`
  - `test/rbac-effective-permissions.test.ts`

### Sensitive operation constraints

- Modify targeted route modules after bundle and route work are green:
  - `src/routes/tenant/billingCounter.ts`
  - `src/routes/tenant/cashOperations.ts`
  - `src/routes/tenant/billingCancellation.ts`
  - `src/routes/tenant/expenses.ts`
  - `src/routes/tenant/billingHandover.ts`
- Add tests near existing route tests.

## Task 0: Branch and workspace safety

- [x] Create separate worktree/branch for planning docs.
- [ ] For implementation, create a fresh worktree from `main` or the latest integration branch.
- [ ] Verify clean status before editing.

Run:

```bash
git status --short
```

Expected: clean before implementation begins.

## Task 1: Add route permission tests first

**Files:**

- Create: `web/src/components/ProtectedRoute.permission.test.tsx`
- Modify only test utilities if required.

### Step 1.1 — RED tests

Write tests that fail under the current `allowedRoles`-only behavior:

```tsx
it('allows manager with billing permission to open reception billing counter', () => {
  mockAuthUser({ role: 'manager', permissions: ['billing:read'] });
  renderProtectedRoute({ requiredAnyPermissions: ['billing:read'] });
  expect(screen.queryByText(/unauthorized/i)).not.toBeInTheDocument();
});

it('blocks manager without required permission', () => {
  mockAuthUser({ role: 'manager', permissions: ['patients:read'] });
  renderProtectedRoute({ requiredAnyPermissions: ['billing:read'] });
  expect(navigateSpy).toHaveBeenCalledWith('/unauthorized', expect.anything());
});

it('keeps super admin route role-only', () => {
  mockAuthUser({ role: 'hospital_admin', permissions: ['*'] });
  renderProtectedRoute({ allowedRoles: ['super_admin'] });
  expect(navigateSpy).toHaveBeenCalledWith('/unauthorized', expect.anything());
});
```

### Step 1.2 — Commit failing tests

```bash
git add web/src/components/ProtectedRoute.permission.test.tsx
git commit -m "test(authz): pin permission-driven protected routes"
```

## Task 2: Implement permission-aware ProtectedRoute

**Files:**

- Modify: `web/src/components/ProtectedRoute.tsx`

### Step 2.1 — Add props

Add:

```ts
interface ProtectedRouteProps {
  allowedRoles?: string[];
  requiredAllPermissions?: string[];
  requiredAnyPermissions?: string[];
  redirectTo?: string;
}
```

### Step 2.2 — Implement access logic

Rules:

1. Not authenticated → login.
2. `allowedRoles=['super_admin']` → role-only gate.
3. `requiredAllPermissions` → all permissions required unless wildcard `*`.
4. `requiredAnyPermissions` → at least one permission required unless wildcard `*`.
5. If both permission arrays are absent and allowed roles are absent → deny for protected tenant route.
6. Keep existing sensitive path fallback only during migration; mark it deprecated.

### Step 2.3 — Run tests

```bash
pnpm vitest run web/src/components/ProtectedRoute.permission.test.tsx
```

Expected: tests pass.

### Step 2.4 — Commit

```bash
git add web/src/components/ProtectedRoute.tsx
git commit -m "feat(authz): support permission-driven protected routes"
```

## Task 3: Add central frontend route access registry

**Files:**

- Create: `web/src/lib/routeAccess.ts`
- Create: `web/src/lib/routeAccess.test.ts`

### Step 3.1 — RED tests

Test route lookup behavior:

| Path | Expected permission |
|---|---|
| `reception/dashboard` | any of patients/appointments/billing read |
| `reception/billing-counter` | `billing:read` |
| `reception/cash-operations` | cash/counter/accounting read/write permission |
| `permissions` | `roles:manage` or `settings:read` for read-only view if implemented |
| `cash/drawers` | `billing:cash:read` or `accounting:read` |
| `reports` | `reports:read` |

### Step 3.2 — Implement registry

Create route metadata:

```ts
export type RouteAccessRule = {
  pattern: RegExp;
  requiredAllPermissions?: string[];
  requiredAnyPermissions?: string[];
  allowedRoles?: string[];
  workspace: WorkspaceKey;
  labelKey?: string;
};
```

Add lookup:

```ts
export function getRouteAccess(path: string): RouteAccessRule | null;
```

### Step 3.3 — Commit

```bash
git add web/src/lib/routeAccess.ts web/src/lib/routeAccess.test.ts
git commit -m "feat(authz): add frontend route access registry"
```

## Task 4: Convert high-impact App routes from role gates to permission gates

**Files:**

- Modify: `web/src/App.tsx`
- Modify: `web/src/App.nurse-routes.test.tsx` or add new route test file if needed.

### Step 4.1 — Convert first safe slice

Convert reception and cash operations route groups first:

Current:

```tsx
<Route element={<ProtectedRoute allowedRoles={['reception', 'hospital_admin']} />}>
```

Target:

```tsx
<Route element={<ProtectedRoute requiredAnyPermissions={['patients:read', 'appointments:read', 'billing:read']} />}>
```

Cash operations:

```tsx
<ProtectedRoute requiredAnyPermissions={['billing:cash:read', 'billing:counter:handover', 'accounting:read']} />
```

### Step 4.2 — Keep clinical routes conservative

Do not open doctor/nurse clinical pages to generic manager in this slice. Clinical route permission conversion should be separate and doctor/nurse-safe.

### Step 4.3 — Run targeted tests

```bash
pnpm vitest run web/src/App.nurse-routes.test.tsx web/src/components/ProtectedRoute.permission.test.tsx web/src/lib/routeAccess.test.ts
```

### Step 4.4 — Commit

```bash
git add web/src/App.tsx web/src/App.nurse-routes.test.tsx
git commit -m "feat(authz): gate reception and cash routes by permissions"
```

## Task 5: Add workspace access builder

**Files:**

- Create: `web/src/lib/workspaceAccess.ts`
- Create: `web/src/lib/workspaceAccess.test.ts`

### Step 5.1 — RED tests

Test permission-to-workspace mapping:

```ts
expect(getAvailableWorkspaces(['patients:read'])).toContain('reception');
expect(getAvailableWorkspaces(['billing:cash:read'])).toContain('cash_operations');
expect(getAvailableWorkspaces(['reports:read'])).toContain('reports');
expect(getAvailableWorkspaces([])).toEqual([]);
```

### Step 5.2 — Implement workspace definitions

Workspace shape:

```ts
export type WorkspaceDefinition = {
  key: WorkspaceKey;
  labelKey: string;
  defaultPath: string;
  requiredAnyPermissions: string[];
  priority: number;
};
```

### Step 5.3 — Commit

```bash
git add web/src/lib/workspaceAccess.ts web/src/lib/workspaceAccess.test.ts
git commit -m "feat(nav): map permissions to workspaces"
```

## Task 6: Refactor Sidebar to show workspaces by effective permissions

**Files:**

- Modify: `web/src/components/dashboard/Sidebar.tsx`
- Create/modify: `web/src/components/dashboard/Sidebar.permission-workspaces.test.tsx`

### Step 6.1 — RED tests

Test manager composite UI:

```tsx
mockAuthUser({
  role: 'manager',
  permissions: ['patients:read', 'appointments:read', 'billing:read', 'reports:read'],
});
render(<Sidebar role="manager" permissions={user.permissions} />);
expect(screen.getByText(/daily desk/i)).toBeInTheDocument();
expect(screen.getByText(/billing counter/i)).toBeInTheDocument();
expect(screen.getByText(/reports/i)).toBeInTheDocument();
expect(screen.queryByText(/roles.*permissions/i)).not.toBeInTheDocument();
```

### Step 6.2 — Implement shared nav builder

Avoid role-only fallback:

```ts
const rawGroups = buildNavGroups({ role: normalizedRole, permissions });
```

Guidelines:

- Reuse current nav item labels and paths.
- Keep admin nav group filtering, but make it permission-first.
- Do not show empty groups.
- Keep `hospital_admin` wildcard behavior.

### Step 6.3 — Commit

```bash
git add web/src/components/dashboard/Sidebar.tsx web/src/components/dashboard/Sidebar.permission-workspaces.test.tsx
git commit -m "feat(nav): show sidebar workspaces from permissions"
```

## Task 7: Refactor CommandPalette and MobileBottomNav

**Files:**

- Modify: `web/src/components/dashboard/CommandPalette.tsx`
- Modify: `web/src/components/dashboard/MobileBottomNav.tsx`
- Tests:
  - `web/src/components/dashboard/CommandPalette.permission-workspaces.test.tsx`
  - `web/src/components/dashboard/MobileBottomNav.permission-workspaces.test.tsx`

### Step 7.1 — RED tests

Assert sidebar/search/mobile agree:

- Manager with `billing:read` sees Billing Counter in sidebar and command palette.
- Manager without `roles:manage` does not see Permission Management in command palette.
- Mobile bottom nav picks default workspace actions from permissions.

### Step 7.2 — Implement

Both components must use `workspaceAccess` / shared nav registry. Do not maintain separate role-only nav arrays.

### Step 7.3 — Commit

```bash
git add web/src/components/dashboard/CommandPalette.tsx web/src/components/dashboard/MobileBottomNav.tsx web/src/components/dashboard/CommandPalette.permission-workspaces.test.tsx web/src/components/dashboard/MobileBottomNav.permission-workspaces.test.tsx
git commit -m "feat(nav): align command palette and mobile nav with workspace permissions"
```

## Task 8: Add manager role as a primary identity

**Files:**

- Modify: `packages/shared/src/authz.ts`
- Modify: role label locale files if present.
- Modify: user/permission tests.

### Step 8.1 — RED tests

- `normalizeRole('manager')` returns `manager`.
- `manager` is in `VALID_TENANT_ROLES`.
- `manager` has conservative default permissions, not wildcard.
- `getPermissionsForRole('manager')` does not include `roles:manage`, `settings:write`, or `users:delete`.

### Step 8.2 — Implement

Add:

```ts
'manager'
```

as a real tenant role, but keep default permissions minimal:

```ts
manager: [
  'dashboard:read',
  'reports:read',
]
```

The manager becomes useful through bundles, not raw default permissions.

### Step 8.3 — Commit

```bash
git add packages/shared/src/authz.ts
git commit -m "feat(authz): add manager primary role with limited defaults"
```

## Task 9: Permission bundles backend

**Files:**

- Create migration after checking latest number.
- Modify: `tenant-schema.sql`
- Create: `src/schemas/permission-bundles.ts`
- Modify: `src/routes/tenant/permissions.ts`
- Modify: `src/middleware/rbac.ts`
- Tests: `test/permissions-bundles.test.ts`, `test/rbac-effective-permissions.test.ts`

### Step 9.1 — Confirm migration number

```bash
ls migrations | sort | tail -n 20
```

Expected: choose the next unused migration number.

### Step 9.2 — RED backend tests

Cases:

1. Assign `reception_desk` bundle to manager.
2. Effective permissions include bundle items.
3. Expired bundle does not grant permissions.
4. User-level revoke beats bundle grant.
5. Bundle assignment audit log exists.

### Step 9.3 — Implement schema/API/resolution

Implement bundle tables and endpoints from the spec.

### Step 9.4 — Run tests

```bash
pnpm vitest run test/permissions-bundles.test.ts test/rbac-effective-permissions.test.ts
```

### Step 9.5 — Commit

```bash
git add migrations tenant-schema.sql src/schemas/permission-bundles.ts src/routes/tenant/permissions.ts src/middleware/rbac.ts test/permissions-bundles.test.ts test/rbac-effective-permissions.test.ts
git commit -m "feat(authz): add permission bundles and effective access expansion"
```

## Task 10: Permission Management UI for bundles and workspace preview

**Files:**

- Modify: `web/src/pages/PermissionManagement.tsx`
- Possibly create:
  - `web/src/components/permissions/PermissionBundlePicker.tsx`
  - `web/src/components/permissions/UserWorkspacePreview.tsx`
  - `web/src/components/permissions/TemporaryAccessFields.tsx`
- Tests near PermissionManagement.

### Step 10.1 — RED tests

- User access drawer shows Primary Role, Bundles, Temporary Access, Effective Permissions, Workspace Preview.
- Selecting Reception Desk bundle previews Daily Desk, OPD Serial, Billing Counter.
- Selecting System Admin warns about sensitive access.
- Expiry is required for temporary access.

### Step 10.2 — Implement UI

Keep raw permission editor under Advanced. Default flow should use bundles.

### Step 10.3 — Commit

```bash
git add web/src/pages/PermissionManagement.tsx web/src/components/permissions
git commit -m "feat(permissions): add bundle assignment and workspace preview UI"
```

## Task 11: Scope and self-approval constraints

**Files:**

- Modify: `src/routes/tenant/billingCounter.ts`
- Modify: `src/routes/tenant/cashOperations.ts`
- Modify: `src/routes/tenant/billingCancellation.ts`
- Modify: `src/routes/tenant/expenses.ts`
- Modify: `src/routes/tenant/billingHandover.ts`
- Tests near each route.

### Step 11.1 — RED tests

- Manager cannot operate a counter outside assigned scope.
- Cash action without active counter session fails.
- User cannot approve own refund/expense/discount/cancel request.
- User cannot transfer cash to self.

### Step 11.2 — Implement route guards

Add helpers:

```ts
requireActiveCounterSession(...)
assertNotSelfApproval(actorUserId, createdByUserId)
assertScopedAccess(actorUserId, { branchId, counterId })
```

### Step 11.3 — Commit

```bash
git add src/routes/tenant/billingCounter.ts src/routes/tenant/cashOperations.ts src/routes/tenant/billingCancellation.ts src/routes/tenant/expenses.ts src/routes/tenant/billingHandover.ts test
git commit -m "feat(authz): enforce scoped cash and self-approval constraints"
```

## Task 12: End-to-end acceptance flow

**Files:**

- Add/modify Playwright tests if the project has stable e2e helpers.
- Candidate: `web/e2e/manager-workspace.spec.ts`

### Scenario

1. Login as manager with Reception Desk + Billing Counter + Reports Viewer bundles.
2. Sidebar shows Reception Desk, Cash Operations, Reports.
3. Manager opens Reception Dashboard.
4. Manager opens Billing Counter.
5. Manager is blocked from Permission Management.
6. Manager is blocked from Backup/Settings write areas.

### Run

```bash
pnpm playwright test web/e2e/manager-workspace.spec.ts
```

### Commit

```bash
git add web/e2e/manager-workspace.spec.ts
git commit -m "test(e2e): cover manager multi-workspace access"
```

## Task 13: Documentation update

**Files:**

- Modify: `docs/operations/role-matrix.md`
- Create/modify: `docs/operations/manager-multi-duty-access-blueprint.md`
- Modify help content if needed.

### Commit

```bash
git add docs/operations/role-matrix.md docs/operations/manager-multi-duty-access-blueprint.md
git commit -m "docs(authz): document manager multi-duty access model"
```

## Final verification

Run targeted tests:

```bash
pnpm vitest run web/src/components/ProtectedRoute.permission.test.tsx web/src/lib/routeAccess.test.ts web/src/lib/workspaceAccess.test.ts
pnpm vitest run test/permissions-bundles.test.ts test/rbac-effective-permissions.test.ts
```

Run broader checks as practical:

```bash
pnpm lint
pnpm test
```

Expected:

- Route access, sidebar, command palette, mobile nav all agree.
- Manager can see allowed reception/cash/admin-lite UI.
- Manager cannot access system admin/permissions unless explicitly granted.
- API denies unauthorized requests even if UI is manipulated.

## Rollback plan

Each task has a separate commit. If a slice causes regression:

1. Revert the latest slice commit.
2. Keep previous working slices.
3. Do not revert docs/spec unless the product decision changes.

## Done definition

The feature is done when:

- A manager with assigned bundles can log in and see correct UI options.
- Frontend route guards use permissions for converted route groups.
- Sidebar/search/mobile navigation use the same workspace logic.
- Permission bundle assignment has audit logs.
- Sensitive cash/refund/approval flows enforce self-approval and scope rules.
- Automated tests cover the manager use case and denial cases.

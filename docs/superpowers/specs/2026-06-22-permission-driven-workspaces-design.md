# Permission-Driven Workspaces for Multi-Duty Hospital Staff

Date: 2026-06-22  
Status: Planning / design spec  
Context: Bangladesh small and mid-size hospitals where one staff member often works across reception, cash, reporting, and administration.

> Superpowers workflow used: product/codebase analysis + architecture/specification + TDD acceptance planning. This document is intentionally implementation-ready but does not change production code by itself.

## 1. Executive summary

The HMS should not treat `role` as the only source of UI access. In Bangladesh hospitals, a `manager` may need to open the reception desk, collect cash, review reports, and perform limited admin work in the same login session. If we keep the current "one role = one dashboard/sidebar/routes" model, two bad outcomes happen:

1. We give the manager `hospital_admin` just so they can do reception work, which violates least privilege.
2. We grant fine-grained permissions, but the UI still hides or blocks the page because frontend routes are guarded by role names.

The target model is:

```text
User account
  ├─ Primary role: identity + default home only
  ├─ Permission bundles: what work the person can do
  ├─ Workspaces: which UI sections appear in sidebar/search/mobile nav
  ├─ Scopes: where/when the permission applies, e.g. branch/counter/shift
  └─ Constraints: what the person still cannot do, e.g. approve own refund
```

In simple terms: **primary role decides who the user is; permissions decide what the user can do; workspace decides what UI they see.**

## 2. External authorization basis

This design follows three widely accepted authorization principles:

- RBAC is useful because users get one or more roles and roles get permissions, making administration easier than individual ACLs. NIST also notes RBAC software should handle role hierarchies and mutually exclusive role complexity.
- ABAC is needed when access depends on attributes like subject, object, action, and environment. NIST describes ABAC as evaluating subject/object/action/environment attributes and enabling dynamic access decisions.
- OWASP recommends least privilege, deny-by-default, permission validation on every request, periodic privilege review, and automated authorization tests.

References:

- NIST RBAC: https://csrc.nist.gov/projects/role-based-access-control
- NIST ABAC: https://csrc.nist.gov/projects/attribute-based-access-control
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

## 3. Current repo findings

### 3.1 What already exists and should be reused

The project already has a good permission foundation:

- `packages/shared/src/authz.ts`
  - `VALID_TENANT_ROLES`
  - `ROLE_PERMISSIONS`
  - `ALL_PERMISSIONS`
  - `PERMISSION_GROUPS`
  - `DEFAULT_ROLE_ROUTES`
- `src/middleware/rbac.ts`
  - `requirePermission(...)`
  - `resolveUserPermissions(...)`
  - role-level and user-level overrides
- `src/routes/tenant/permissions.ts`
  - role permission matrix
  - user permission overrides
  - permission catalog
- `src/lib/route-permissions.ts`
  - central API route permission matrix
- `web/src/components/dashboard/Sidebar.tsx`
  - nav items already support `requiredPermission`
- `web/src/components/dashboard/CommandPalette.tsx`
  - command results already filter by `requiredPermission`

This means the backend is closer to the target than the frontend route layer.

### 3.2 Main gap

`web/src/components/ProtectedRoute.tsx` still primarily accepts:

```tsx
<ProtectedRoute allowedRoles={['reception', 'hospital_admin']} />
```

`web/src/App.tsx` has many `allowedRoles` blocks for reception, lab, admin, MD, director, pharmacy, accountant, and doctor route groups. This blocks a future `manager` user even if the user has the correct `billing:read`, `appointments:read`, `patients:read`, or cash permissions.

### 3.3 Sidebar is better than route access, but incomplete

`Sidebar.tsx` filters individual nav items by `requiredPermission`, but the chosen nav group still comes from `roleNavGroups[normalizedRole]`. A manager with reception permissions may still fall back to admin groups or miss reception-specific quick actions unless we build workspace-aware nav.

### 3.4 Frontend-only admin subroles are not aligned with backend roles

`web/src/components/dashboard/adminRoleAccess.ts` references `branch_manager`, `accounts_manager`, `auditor`, and `owner_view`, but `VALID_TENANT_ROLES` currently does not include these. This is a design smell: either these should become real tenant roles, or they should become workspace/profile templates instead of roles.

Recommendation: do **not** create too many real roles. Use `manager` as a real primary role if needed, then use permission bundles/workspaces for `accounts manager`, `branch manager`, `auditor`, and `owner view` behavior.

## 4. Goals

1. Let a manager do reception work without becoming `hospital_admin`.
2. Let the UI show all allowed options automatically from effective permissions.
3. Keep sensitive operations restricted by permission + scope + self-approval rules.
4. Reduce role explosion by using permission bundles.
5. Keep API authorization stricter than UI authorization.
6. Preserve auditability for permission changes and sensitive actions.
7. Make this TDD-friendly with route, nav, and API authorization tests.

## 5. Non-goals

- Do not give every manager `hospital_admin` access.
- Do not create a separate role for every possible staff combination.
- Do not rely on hidden UI as security. The API must still enforce permissions.
- Do not rewrite the whole HMS navigation in one large risky change.
- Do not change clinical doctor/nurse safety rules without a separate clinical access spec.

## 6. Target access model

### 6.1 Primary role

Primary role is used for identity, default landing, role label, and broad baseline permissions.

Recommended primary tenant roles:

| Role | Use |
|---|---|
| `hospital_admin` | Owner/system-level tenant admin. Full access should remain rare. |
| `manager` | Operational manager. Default is limited; receives bundles. |
| `reception` | Reception desk/cash desk user. |
| `accountant` | Accounting entry/reporting user. |
| `md` | Management/approval role. |
| `director` | Read-heavy/approval role. |
| `doctor`, `nurse`, `laboratory`, `pharmacist` | Clinical and departmental roles. |

Only add `manager` if the product needs a stable primary identity for hospital managers. Do not add `manager_reception_admin`, `manager_cashier`, etc.

### 6.2 Permission bundles

Permission bundles are named sets of permissions assignable to a user. They are product-friendly and easier for hospital owners to understand than raw permission strings.

Recommended first bundles:

| Bundle | Purpose | Example permissions |
|---|---|---|
| Reception Desk | Patient registration, OPD serial, basic desk work | `patients:read`, `patients:write`, `appointments:read`, `appointments:write` |
| Billing Counter | Create bills, collect payments, print invoices | `billing:read`, `billing:write`, `billing:pay`, `billing:counter:open`, `billing:counter:close` |
| Cash Operations | Doctor payout, petty cash, transfer/deposit visibility | `billing:read`, `billing:cash:read`, `billing:cash:write`, `billing:counter:handover` |
| Cash Supervisor | Monitor drawers, approve/review variances | `billing:cash:read`, `reports:read`, `accounting:read` |
| Admin Lite | Staff/roster/basic admin monitoring | `staff:read`, `hr:read`, `schedule:read`, `settings:read` |
| Accounts Entry | Expenses/income/voucher entry | `income:read`, `income:write`, `expenses:read`, `expenses:write` |
| Accounts Approval | Approve vouchers/expenses/refunds | `accounting:read`, `accounting:write`, `billing:refund` |
| Reports Viewer | Financial and operational reports | `reports:read`, `billing:read`, `income:read`, `expenses:read` |
| System Admin | Users, roles, settings, backup/import/export | `users:read`, `users:write`, `roles:manage`, `settings:write`, `audit:read` |

### 6.3 Workspaces

A workspace is a UI surface that appears when the user has at least one permission needed by that workspace.

| Workspace | UI route group | Visible when user has |
|---|---|---|
| Reception Desk | `/reception/*` | `patients:read` or `appointments:read` or `billing:read` |
| Cash Operations | `/reception/cash-operations` or `/cash/*` | `billing:cash:read` or `billing:counter:handover` or `accounting:read` |
| Admin Control Room | `/dashboard`, `/cash/*`, `/approvals`, `/audit` | management/report/audit permissions |
| Accounts | `/accountant/*`, `/accounting`, `/expenses`, `/income` | `accounting:read` or `expenses:read` or `income:read` |
| Reports | `/reports`, `/billing-reports`, `/ipd-reports` | `reports:read` |
| People & Access | `/staff`, `/permissions`, `/settings/security` | `staff:read`, `users:read`, `roles:manage` |
| Lab/Diagnostic | `/lab/*`, `/tests` | lab/test permissions |
| Pharmacy | `/pharmacy/*` | pharmacy permissions |

The sidebar, command palette, mobile bottom nav, and dashboard cards should all use this same workspace registry.

### 6.4 Scopes

Permissions alone should not always be global. Add scopes for real-world hospital control:

| Scope | Example |
|---|---|
| `tenant_id` | Always required. |
| `branch_id` | Manager can operate only in a selected branch. |
| `department_id` | Lab/reception/ward-specific access. |
| `counter_id` | Cashier can only operate assigned counter. |
| `shift_id` | Cash collection requires active shift/counter session. |
| `valid_from`, `valid_until` | Temporary assignment for substitute work. |
| `max_amount` | Approval limit for discount/refund/expense. |

### 6.5 Constraints

Constraints are rules that reduce risk even when a user has broad permissions.

Required constraints:

| Rule | Required behavior |
|---|---|
| No self-approval | User cannot approve own discount/refund/expense/bill cancel. |
| No self-handover | User cannot transfer cash to self. |
| Shift required | Cash execution requires active counter session unless the user is only monitoring. |
| Approval threshold | High discount/refund/expense requires approver with limit. |
| Reason required | Sensitive action requires reason. |
| Audit required | Permission changes and money-affecting actions must be logged. |
| Expiry required | Temporary grants must have an expiry date/time. |

## 7. Proposed frontend architecture

### 7.1 `ProtectedRoute` must become permission-aware

Current style:

```tsx
<ProtectedRoute allowedRoles={['reception', 'hospital_admin']} />
```

Target style:

```tsx
<ProtectedRoute requiredAnyPermissions={['patients:read', 'appointments:read', 'billing:read']} />
```

Supported props:

```ts
type ProtectedRouteProps = {
  allowedRoles?: string[]; // keep for super_admin-only and temporary backward compatibility
  requiredAllPermissions?: string[];
  requiredAnyPermissions?: string[];
  redirectTo?: string;
};
```

Behavior:

1. If `allowedRoles` is `['super_admin']`, keep strict role gate.
2. If permissions are present, check permissions first.
3. If both role and permission are present, require both only when explicitly configured.
4. Default deny when a protected route has neither role nor permission metadata.
5. Do not treat `hospital_admin` as the only route bypass in frontend; wildcard `*` can bypass, but route config should still declare required permissions.

### 7.2 Add a route access registry

Create a central frontend registry:

```ts
// web/src/lib/routeAccess.ts
export const TENANT_ROUTE_ACCESS = [
  {
    pattern: /^reception\/dashboard$/,
    requiredAnyPermissions: ['patients:read', 'appointments:read', 'billing:read'],
    workspace: 'reception',
  },
  {
    pattern: /^reception\/cash-operations$/,
    requiredAnyPermissions: ['billing:cash:read', 'billing:counter:handover', 'accounting:read'],
    workspace: 'cash_operations',
  },
];
```

This registry should power:

- `ProtectedRoute`
- sidebar visibility
- command palette entries
- mobile bottom nav
- dashboard workspace launcher
- route regression tests

### 7.3 Workspace-aware sidebar

Replace role-only selection:

```ts
const rawGroups = roleNavGroups[normalizedRole] ?? roleNavGroups.hospital_admin;
```

with effective workspace selection:

```ts
const rawGroups = buildNavGroups({ role: normalizedRole, permissions, scopes });
```

`buildNavGroups` should include any group whose children have visible permissions. This means a manager with reception permissions sees reception actions, cash actions, and admin monitoring actions in one clean sidebar.

### 7.4 Workspace switcher

Add a compact switcher in the dashboard/header:

```text
Workspace: Reception Desk ▾
- Reception Desk
- Cash Operations
- Admin Lite
- Reports
```

The switcher does not grant access. It only changes the visible navigation focus. The available workspaces are derived from effective permissions.

### 7.5 Dashboard landing

`DEFAULT_ROLE_ROUTES` should not be the only source of first page. Add user preference:

```text
User default workspace: Reception Desk
Default path: /h/:slug/reception/dashboard
```

For a `manager`, default can be:

1. If currently active cash session: Reception/Cash Operations.
2. Else if admin monitoring permission: Admin Lite dashboard.
3. Else first available workspace.

## 8. Proposed backend/data architecture

### 8.1 Keep existing permission override tables

Do not throw away:

- `role_permission_overrides`
- `user_permission_overrides`

They already support role-level and user-level grants/revokes.

### 8.2 Add permission bundles

Suggested migration:

```sql
CREATE TABLE IF NOT EXISTS permission_bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS permission_bundle_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  bundle_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  UNIQUE(tenant_id, bundle_id, permission)
);

CREATE TABLE IF NOT EXISTS user_permission_bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  bundle_id INTEGER NOT NULL,
  scope_json TEXT,
  valid_from TEXT,
  valid_until TEXT,
  assigned_by INTEGER NOT NULL,
  reason TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, user_id, bundle_id, valid_from)
);
```

### 8.3 Effective permission resolution

`resolveUserPermissions` should become:

```text
static role permissions
+ role_permission_overrides
+ active permission bundle permissions
+ user_permission_overrides where action=grant
- user_permission_overrides where action=revoke
= effective permissions
```

Temporary bundles apply only when:

```text
valid_from <= now <= valid_until
is_active = 1
scope matches request context, if scope is enforced for that action
```

### 8.4 Scope enforcement

Permission resolution answers: “Can the user generally do this?”

Scope enforcement answers: “Can the user do this here and now?”

Example:

```ts
requirePermission('billing:pay')
requireScope({ branchId, counterId, activeShift: true })
```

### 8.5 User and permission APIs

Add or extend endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/permissions/bundles` | List bundle templates. |
| `POST /api/permissions/bundles` | Create custom bundle. |
| `PUT /api/permissions/bundles/:id` | Update bundle. |
| `POST /api/permissions/users/:userId/bundles` | Assign bundle to user. |
| `DELETE /api/permissions/users/:userId/bundles/:assignmentId` | Revoke assignment. |
| `GET /api/permissions/users/:userId/effective-access` | Show role + bundles + overrides + scopes. |
| `GET /api/me/workspaces` | Return available workspaces for logged-in user. |

## 9. Admin UI design

### 9.1 Users & Access page

In user detail drawer/page, show:

1. Primary role
2. Department/branch
3. Default workspace
4. Permission bundles
5. Temporary access
6. Special grants/revokes
7. Approval limits
8. Scope restrictions
9. Self-approval blocked indicator
10. Access review status

### 9.2 Assign access flow

Admin should not need to search raw permission codes first.

Flow:

```text
Select staff → Access tab → Add access
  → Choose bundle: Reception Desk
  → Scope: Branch A, Counter 1, today 8 AM-8 PM
  → Reason: Manager covering receptionist leave
  → Preview permissions
  → Confirm with PIN/OTP if sensitive
```

### 9.3 Workspace preview

Before saving, show:

```text
After saving, Rahim Manager will see:
- Reception Desk
  - Daily Desk
  - OPD Serial
  - Billing Counter
  - Patient Registration
- Cash Operations
  - Cash Transfer
  - Close Shift
Not visible:
- Permission Management
- Billing Master
- Backup/Restore
```

This solves the exact UI concern: the user knows whether assigned permissions will actually show the correct options after login.

## 10. Manager UX example

### Manager with reception + admin-lite bundles

Login result:

```text
Header: Workspace: Reception Desk
Sidebar:
  Reception Desk
    Daily Desk
    OPD Serial
    Billing Counter
    Cash Operations
    Patients
  Admin Lite
    Control Room
    Staff Roster
    Daily Collection
    Reports
  Help
```

Blocked:

```text
Permissions page
Billing master price edit
Backup/import/export
User role change
Own refund approval
Own expense approval
```

### Manager acting as cashier

Allowed only when:

- `billing:counter:open` exists
- assigned branch/counter scope matches
- counter session is active
- no self-handover/self-approval violation

## 11. Rollout strategy

### Phase 1 — Route and nav correctness

- Add permission-aware `ProtectedRoute`.
- Convert reception, cash operations, reports, and key admin monitoring routes first.
- Build shared nav/workspace registry.
- Add tests proving manager + permissions sees the UI.

### Phase 2 — Bundle assignment UI

- Add permission bundle tables and APIs.
- Add bundle assignment UI in Permission Management.
- Add workspace preview.

### Phase 3 — Scope and temporary access

- Add branch/counter/shift/time scopes.
- Enforce scope in billing counter, cash operations, expense execution, refund/cancel, and handover routes.

### Phase 4 — Constraints and audit hardening

- Add self-approval blocks.
- Add monthly access review report.
- Add suspicious access alerts: broad permission grants, expired grants still active, high-risk permission changes.

## 12. TDD acceptance criteria

### Frontend route tests

- A `manager` with `billing:read` can open `/h/demo/reception/billing-counter`.
- A `manager` without `billing:read` is redirected to unauthorized.
- A `manager` with `patients:read` and `appointments:read` can see reception patient/appointment sidebar items.
- A `manager` with `reports:read` can see report workspace items.
- A user with no matching permissions does not see empty workspace groups.
- `super_admin` routes remain super-admin-only.

### Sidebar and command palette tests

- Sidebar and command palette return the same access results for the same permission set.
- Mobile bottom nav uses the same workspace registry, not a separate role-only list.
- Workspace switcher shows only available workspaces.

### Backend permission tests

- Bundle assignment expands effective permissions.
- Expired temporary assignment does not grant permission.
- Revoked user override removes permission even if a bundle grants it.
- Permission changes write audit logs.
- API denies route access even if frontend nav accidentally shows a link.

### Scope/constraint tests

- Cash payment without active shift fails.
- User cannot hand over cash to self.
- User cannot approve own refund, expense, discount, or bill cancellation.
- Manager assigned to Branch A cannot operate Branch B cash counter.

## 13. Key implementation risks

| Risk | Mitigation |
|---|---|
| Role and permission checks disagree | Single route/workspace registry, tests compare sidebar/palette/route behavior. |
| Role explosion | Use bundles instead of many new roles. |
| Manager accidentally gets full admin | `hospital_admin` remains rare; manager gets explicit bundles only. |
| UI shows a link but API denies | Acceptable during rollout, but tests should catch mismatch. API is source of truth. |
| Expired temporary access still works from cached JWT | Keep RBAC cache invalidation and short TTL; refresh effective access on login and sensitive actions. |
| Too complex for small hospitals | Provide simple bundle templates and hide raw permissions behind advanced mode. |

## 14. Product decision

For this HMS, the best production direction is:

```text
Add a real `manager` primary role.
Do not add many combined roles.
Use permission bundles + workspaces + scopes.
Convert frontend route gates from role-first to permission-first.
Keep API authorization and audit as the source of truth.
```

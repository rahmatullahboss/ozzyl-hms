# Simple Access Management Review & Implementation Plan

Date: 2026-07-04
Scope: Ozzyl HMS role and permission management for small hospitals.

## Executive verdict

The current RBAC foundation is strong, but the admin-facing experience is still too technical for small hospitals. It already has role defaults, tenant role overrides, per-user grants/revokes, module visibility, workspace bundles, audit logging, and cache invalidation. However, normal hospital admins should not be forced to understand low-level permission strings like `billing.counter.shift.handover.receive` or large role matrices.

Recommended direction: keep the current permission engine, but add a simpler access-management layer on top:

1. **Simple Mode**: choose a user, assign a primary role, then tick common work areas.
2. **Advanced Mode**: detailed permission matrix and override tools for technical admins only.
3. **Safety Layer**: critical permission warnings, reason requirements, role-change confirmation, and permission impact preview.
4. **Policy Presets**: hospital-size presets such as Small Clinic, Diagnostic Center, Small Hospital, Medium Hospital.

## Best-practice basis

- Apply least privilege: give only what a staff member needs for the job.
- Deny by default: no access unless role/bundle/override explicitly grants it.
- Validate permissions on every request; UI hiding alone is not enough.
- Keep role-based access for simplicity, but use attributes/context for sensitive object-level actions where needed, such as own shift, assigned patient, branch, counter, department, or current tenant.
- Log and review authorization changes.
- Test authorization paths with both positive and negative cases.

## Current implementation reviewed

### Existing strengths

1. **Central role list and defaults**
   - `packages/shared/src/authz.ts` defines `VALID_TENANT_ROLES`, role labels, default routes, default role permissions, all permissions, permission groups, modules, and workspace bundles.

2. **Dynamic tenant role override**
   - `migrations/0146_dynamic_rbac.sql` has `role_permission_overrides`.
   - `src/routes/tenant/permissions.ts` exposes `/api/permissions/role` to replace role permissions per tenant.

3. **Per-user overrides**
   - `user_permission_overrides` supports `grant` and `revoke` per permission.
   - `/api/permissions/user/override` logs reason and enforces critical permission reason checks.

4. **Workspace bundles already exist**
   - `WORKSPACE_BUNDLES` includes Reception Desk, Counter Operator, Management Cash Receiver, Accountant Workspace, Doctor Management, HR, Lab, Pharmacy, Inventory, Reports.
   - The UI can grant/revoke these bundles for a selected user.

5. **Module visibility exists**
   - `role_module_access` plus `/api/permissions/modules` lets admin show/hide modules by role.
   - It also mutates role permissions based on module permission mapping.

6. **Audit and cache invalidation exist**
   - Permission changes create audit logs.
   - Role-level cache invalidation and user-level cache invalidation are implemented.

7. **UI has three tabs**
   - Role Matrix
   - User Overrides
   - Module Visibility

## Main gaps

### 1. The UI is too permission-string driven

Current UI exposes too many raw permission names. This is technically useful, but not friendly for a small hospital owner/admin.

Problem example:

- A hospital admin understands “Reception Counter” or “Can approve discount.”
- They do not understand `billing.counter.shift.handover.receive`.

Required fix:

- Default landing should be **User Access / Simple Mode**.
- Raw permission editor should be hidden behind **Advanced Mode**.
- Bundle cards should use business-language labels and examples.

### 2. Role Matrix is dangerous for normal admins

`PUT /api/permissions/role` replaces the whole role permission list for a tenant. A non-technical admin can accidentally remove important permissions from a role and break workflows for all users under that role.

Required fix:

- Add a confirmation preview that says how many users will be affected.
- Add “Reset to Ozzyl Default.”
- Add “Save as hospital custom role policy.”
- Add a “safe role editor” based on modules/work areas, not raw permissions.

### 3. Module Visibility currently mutates real role permissions

The current module visibility route does not only hide sidebar modules; it also adds/removes permissions from `role_permission_overrides`.

This is powerful, but the naming can mislead admins. “Hide module” sounds visual, but it actually changes access rights.

Required fix:

- Rename UI copy from “Module Visibility” to **Role Work Area Access**.
- Show affected permissions and affected users before saving.
- Provide separate future concept if needed:
  - `menu_visibility` = only sidebar/UI visibility.
  - `role permissions` = actual backend access.

### 4. Hospital Admin wildcard is too broad

`requirePermission` bypasses all checks for `hospital_admin` and `super_admin`.

This is convenient, but for a real hospital it creates a risk because every hospital admin can do all sensitive actions.

Required fix:

- Keep `super_admin` as platform owner wildcard.
- Consider changing `hospital_admin` into a managed role with broad defaults, not unchangeable wildcard.
- Introduce `hospital_owner` or `tenant_owner` as the only tenant-level wildcard role.
- At minimum, sensitive actions should still require an explicit confirmation / second-step approval in workflow, even if the role has wildcard permission.

### 5. No true multi-role assignment yet

Current model has one primary role plus user-level permission overrides. This is acceptable for MVP, but admins will naturally ask: “This person is Reception + Cash + Inventory; can I assign all three?”

Current workaround: workspace bundle grants.

Recommended MVP approach:

- Do **not** add full multi-role table yet.
- Expose bundles as “Additional Work Areas.”
- Internally keep user-level grants/revokes.
- Later add `user_role_assignments` only if bundle-based access becomes difficult to audit.

### 6. Sensitive permission rules are partial

The current critical permission detector uses keywords such as refund, cancel, delete, discount, approve, export, backup. Good start.

Missing / should be reviewed:

- `roles:manage`
- `settings:write`
- `users:delete`
- `staff:delete`
- `pharmacy:narcotics`
- `inventory:adjust`
- `inventory:approve`
- `accounting:write`
- `shareholders:delete`
- patient MPI merge/verify permissions when fully added

Required fix:

- Maintain a structured `CRITICAL_PERMISSIONS` catalog instead of keyword matching only.
- Include severity levels: high, critical.
- Require reason for critical grants and maybe approval for very high-risk grants.

## Recommended target experience

### Main page: Access Management

Tabs should be reorganized:

1. **Staff Access** — default tab for small hospitals.
2. **Roles & Presets** — role-level policies.
3. **Advanced Permissions** — raw permission editor, hidden behind warning.
4. **Audit Log** — recent access changes.

### Staff Access flow

Admin searches/selects staff.

Show one simple card:

- Name, mobile/email, department, login status.
- Primary role dropdown.
- Additional Work Areas checkboxes/cards.
- Access preview: “After login this user can see…”
- Risk summary: “This user can approve discount / refund / delete records.”

Suggested work-area cards:

1. Reception Desk
2. Billing Counter Operator
3. Management Cash Receiver
4. Accountant Workspace
5. Doctor Workspace
6. Nurse Station
7. Laboratory Workspace
8. Pharmacy Workspace
9. Inventory Operator
10. HR & Staff Management
11. Reports & Analytics
12. Settings & User Management — restricted

### Create / invite user flow

For small hospital admin, staff onboarding should ask:

1. Staff name
2. Mobile/email/login username
3. Department
4. Primary job role
5. Work areas
6. Temporary password or invitation

The admin should not need to open Permission Management separately for common cases.

## Recommended data model for MVP

Keep existing tables:

- `users.role` = primary role.
- `role_permission_overrides` = hospital-level customization.
- `user_permission_overrides` = extra work areas or exceptions.
- `role_module_access` = role-level work-area access.

Add later only if needed:

```sql
CREATE TABLE user_role_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  assigned_by INTEGER,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, user_id, role)
);
```

Do not add this now unless there is a clear need. Bundle-based grants are simpler and already implemented.

## Permission policy recommendations

### Role defaults

#### Reception

Should have:

- Patient registration
- Appointment booking
- Bill/invoice creation
- Basic lab order creation if needed
- Counter shift open/close/handover if they collect cash

Should not have by default:

- Accountant dashboard
- Reports export
- Refund approval
- Discount approval
- Force close/takeover counter
- User/role management

#### Accountant

Should have:

- Accounting dashboard
- Income/expense
- Cash handover receive/partial collect
- Reports read/write depending on policy

Should not have by default:

- Patient clinical write
- Doctor prescription write
- Role management
- Settings write

#### Manager

Should have:

- Operations dashboard
- Department status
- Task/alert visibility
- Reports read
- Optional cash receive depending on hospital policy

Should not automatically have:

- Full accounting write
- Role management
- Settings write

#### MD / Director

Should have broad reporting, approvals, and management features.

Should still use workflow-level approvals for:

- Refund approval
- Large discount approval
- Force close cash drawer
- Stock adjustment approval
- Role management

### High-risk permission categories

Mark these as critical in UI and API:

- Money movement: refund, cancel, discount, variance approve, bank deposit approve.
- Data destruction: delete, deactivate, merge.
- Access control: users write/delete, roles manage, settings write.
- Export/backup: reports export, backup download.
- Inventory risk: stock adjustment and approval.
- Controlled medicines: narcotics.

## API improvements to implement

### 1. Access summary endpoint

Add:

`GET /api/permissions/user/:userId/summary`

Return:

```ts
{
  user: { id, name, email, role },
  primary_role: { role, label },
  work_areas: [
    { id, label, granted, missing_permissions, risky_permissions }
  ],
  access_preview: [...],
  effective_permissions_count: number,
  risk_summary: {
    critical_permissions: string[],
    warnings: string[]
  }
}
```

### 2. Apply access profile endpoint

Add:

`POST /api/permissions/user/access-profile`

Body:

```ts
{
  user_id: number,
  primary_role?: string,
  bundle_ids: string[],
  revoke_unselected_bundles?: boolean,
  reason?: string
}
```

This gives the UI one simple save button instead of many per-permission calls.

### 3. Role impact endpoint

Add:

`GET /api/permissions/role/:role/impact`

Return:

```ts
{
  role,
  user_count,
  users_sample: [...],
  changed_permissions_preview: {...}
}
```

Use it before saving role matrix changes.

### 4. Critical permission catalog

Move critical permission detection into shared code:

`packages/shared/src/criticalPermissions.ts`

Use both backend and frontend from this single source of truth.

## UI implementation tasks

### Phase 1 — quick improvement

1. Make **User Access** the default tab instead of Role Matrix.
2. Rename “User Overrides” to **Staff Access**.
3. Rename “Workspace Access Bundles” to **Additional Work Areas**.
4. Hide raw permission chips by default under “Advanced details.”
5. Add Bengali-friendly labels/descriptions for every bundle.
6. Add a “Save Access Setup” button that applies selected bundles in one flow.
7. Add risk badges: Money, Delete, Export, Settings, Role Management.
8. Add affected-user count before saving role-level changes.

### Phase 2 — safety hardening

1. Add structured critical permission catalog.
2. Add reason requirement for all high-risk grants, not only keyword matches.
3. Add approval workflow for selected critical access changes if hospital policy requires it.
4. Add audit log tab on Access Management page.
5. Add role-change confirmation and cache invalidation check.
6. Ensure route permission tests include hospital_admin, md, manager, reception, accountant, lab, nurse, pharmacist.

### Phase 3 — policy presets

Add policy presets:

- Small Clinic
- Diagnostic Center
- Small Hospital
- Medium Hospital
- Pharmacy + Diagnostic

Each preset defines default roles, work areas, and critical restrictions.

## Acceptance criteria

1. A non-technical hospital admin can assign a staff login in under 1 minute.
2. Admin can choose one primary role and multiple additional work areas without seeing raw permission codes.
3. Reception cannot see/open Accountant workspace unless explicitly granted accounting or management-cash access.
4. Role-level edits show affected user count and permission diff before save.
5. Critical access changes require a reason and create audit logs.
6. Backend still validates permissions on every protected API request.
7. Raw permission editor remains available only in Advanced Mode.
8. Test coverage includes grant, revoke, role change, bundle grant, bundle revoke, module/work-area change, cache invalidation, and denied access cases.

## Recommended final structure

```txt
Access Management
├── Staff Access          # default, small-hospital friendly
│   ├── Search staff
│   ├── Primary role
│   ├── Additional work areas
│   ├── Access preview
│   └── Risk summary
├── Roles & Presets
│   ├── Role defaults
│   ├── Hospital custom policy
│   └── Preset templates
├── Advanced Permissions
│   ├── Raw permission matrix
│   ├── Individual grants/revokes
│   └── Module/work-area mapping
└── Audit Log
    ├── Who changed what
    ├── Why changed
    └── Previous/new access
```

## Immediate recommendation

Do not replace the backend RBAC engine. It is usable. Improve the UX layer and safety guardrails first.

The next implementation slice should be:

1. Convert Permission Management default tab to Staff Access.
2. Add a true Simple Mode with primary role + additional work areas.
3. Hide advanced raw permissions under expandable section.
4. Add structured critical permission metadata.
5. Add affected-user and risk preview before saving.

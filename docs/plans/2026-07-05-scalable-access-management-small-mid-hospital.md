# Scalable Access Management Plan — Small to Mid-Level Hospitals

Date: 2026-07-05
Scope: Ozzyl HMS Role & Permission Management UX, policy, and implementation direction.

## Goal

Make Ozzyl HMS access management simple enough for a small hospital owner/admin, but powerful enough for a mid-level hospital with multiple departments, counters, branches, approvals, and managers.

The system should not force normal admins to understand raw permission strings. Admins should think in terms of people, jobs, departments, work areas, and risks.

## Core design principle

Keep one permission engine, but expose different management modes:

1. **Small Hospital Simple Mode**
   - Staff-first access setup.
   - One primary role.
   - Tick additional work areas.
   - Simple access preview.
   - Minimal technical terms.

2. **Mid-Level Hospital Managed Mode**
   - Department/branch/counter-aware access.
   - Role presets and custom hospital policies.
   - Approval workflow for sensitive access.
   - Audit, risk review, and periodic access review.

3. **Advanced Technical Mode**
   - Raw role matrix and individual permission overrides.
   - Only for owner/admin/implementation team.

## Existing system fit

The current codebase already supports the right backend foundation:

- `users.role` for primary role.
- `role_permission_overrides` for hospital-level custom role policies.
- `user_permission_overrides` for extra grants/revokes.
- `role_module_access` for module/work-area level access.
- `WORKSPACE_BUNDLES` for common access groups.
- Audit logs for permission changes.
- RBAC cache invalidation.

Do not replace this engine now. Build a clearer UX layer and stronger safety guardrails on top.

## Access model to expose in UI

### 1. Primary Role

Every user gets one primary role:

- Hospital Admin / Owner
- MD / Director
- Manager
- Reception
- Accountant
- Doctor
- Nurse
- Laboratory
- Pharmacist
- Inventory Operator
- HR / Staff Manager

Primary role controls the default identity and base dashboard.

### 2. Additional Work Areas

A user can receive extra work areas without changing their main role:

- Reception Desk
- Billing Counter Operator
- Management Cash Receiver
- Accountant Workspace
- Doctor Workspace
- Nurse Station
- Laboratory Workspace
- Pharmacy Workspace
- Inventory Operator
- HR & Staff Management
- Reports & Analytics
- Settings & User Management

Internally these remain workspace bundle grants through `user_permission_overrides`.

### 3. Sensitive Powers

Some permissions must be shown separately as high-risk powers:

- Refund payment
- Cancel bill/invoice
- Approve discount
- Force close / takeover counter
- Approve cash variance
- Approve bank deposit
- Adjust inventory stock
- Approve inventory adjustment
- Export reports
- Delete users/staff/data
- Manage roles and permissions
- Change hospital settings
- Narcotics / controlled medicine handling

These should not be silently included in normal work areas unless deliberately designed.

## Small Hospital Simple Mode

### Target users

Small clinic, small diagnostic center, 5–50 staff, usually owner/admin + reception + doctor + lab/pharmacy/accounting combined by few people.

### UX flow

`Access Management -> Staff Access`

1. Search/select staff.
2. Set primary role.
3. Tick additional work areas.
4. See “What this user can do” preview.
5. See “Risky access” warning if selected.
6. Save.

### UI copy should be human-friendly

Use labels like:

- “Can register patients”
- “Can take payment at counter”
- “Can receive cash from reception”
- “Can view reports”
- “Can manage staff”
- “Can approve discount”

Avoid exposing raw permission names by default.

### Small hospital default policy

#### Reception

Allowed by default:

- Patient registration
- Appointment booking
- Basic bill creation
- Counter shift operation if they collect cash
- Lab order creation if hospital enables it

Not allowed by default:

- Refund approval
- Discount approval
- Cash variance approval
- Accountant dashboard
- Report export
- User/role management
- Settings write

#### Owner/Admin

Can manage most operations, but high-risk actions should still show confirmation/reason:

- Role changes
- Refund approval
- Force close cash counter
- Data deletion
- Report export

#### Accountant

Allowed:

- Income/expense
- Accounting dashboard
- Cash receive/partial collect
- Financial reports

Not allowed:

- Clinical write
- Prescription write
- Role management by default

## Mid-Level Hospital Managed Mode

### Target users

Hospitals with 50–300+ staff, multiple departments, multiple counters, shifts, cash handover, branch/floor/department managers, and approval hierarchy.

### Required extra controls

1. **Department-aware access**
   - User can be assigned to department/branch/unit.
   - UI should show department next to role.
   - Permission preview should mention department scope.

2. **Counter/shift-aware cash access**
   - Counter operator can work on assigned counter/shift.
   - Manager/accountant can receive cash handovers.
   - Force-close/takeover requires manager/owner-level approval.

3. **Approval hierarchy**
   - Sensitive grants require reason.
   - Optional second approval for mid-level hospital policy.
   - Examples: refund approval, stock adjustment approval, role management, export data.

4. **Role presets**
   - Hospital can start from default policy presets:
     - Small Clinic
     - Diagnostic Center
     - Small Hospital
     - Mid-Level Hospital
     - Pharmacy + Diagnostic
   - Admin can customize and save as hospital policy.

5. **Access review**
   - Show users with risky access.
   - Show recently changed roles/access.
   - Show inactive staff with active login.
   - Show staff with permission overrides.

6. **Audit-first design**
   - Every access change must log:
     - who changed
     - whose access changed
     - old access
     - new access
     - reason
     - timestamp
     - IP/user agent where available

## Recommended page structure

```txt
Access Management
├── Staff Access
│   ├── Search/select staff
│   ├── Primary role
│   ├── Additional work areas
│   ├── Scope: branch/department/counter (mid-level mode)
│   ├── Access preview
│   ├── Risk summary
│   └── Save access setup
├── Roles & Presets
│   ├── Default Ozzyl roles
│   ├── Hospital custom role policy
│   ├── Small/Mid hospital presets
│   └── Affected user preview before save
├── Approval Rules
│   ├── Discount approval limit
│   ├── Refund approval rules
│   ├── Cash variance approval rules
│   ├── Inventory adjustment approval rules
│   └── Role/settings change approval rules
├── Advanced Permissions
│   ├── Raw role matrix
│   ├── Individual grants/revokes
│   └── Route-level permissions
└── Access Audit
    ├── Permission changes
    ├── Role changes
    ├── Risky access report
    └── Inactive login report
```

## Recommended implementation strategy

### Phase 1 — make current system easy

1. Make `Staff Access` the default tab in `web/src/pages/PermissionManagement.tsx`.
2. Rename:
   - User Overrides -> Staff Access
   - Workspace Access Bundles -> Additional Work Areas
   - Module Visibility -> Role Work Area Access
3. Hide raw effective permissions under an “Advanced details” accordion.
4. Add simple access preview and risk summary.
5. Keep primary role dropdown.
6. Keep workspace bundle grant/revoke, but improve UI labels and descriptions.
7. Add Bengali-friendly labels/descriptions for bundles.

### Phase 2 — add scalable mid-level controls

1. Add structured critical permission catalog in shared code.
2. Add role impact endpoint before role matrix save:
   - affected user count
   - sample affected users
   - added/removed permission diff
3. Add policy preset metadata:
   - Small Clinic
   - Diagnostic Center
   - Small Hospital
   - Mid-Level Hospital
4. Add optional approval rule configuration for sensitive access.
5. Add Access Audit tab or link to filtered audit log.

### Phase 3 — scope-aware access

Add scope controls without breaking current RBAC:

- Branch scope
- Department scope
- Counter scope
- Ward/floor scope
- Doctor/team assignment scope

This should be implemented as contextual checks on top of RBAC, not as thousands of new permission strings.

Example:

RBAC says: user can read nursing station.
Scope says: only Ward A or assigned floor.

## Backend additions recommended

### 1. Access profile endpoint

`POST /api/permissions/user/access-profile`

Purpose: one save action from the simple UI.

Body:

```ts
{
  user_id: number,
  primary_role?: string,
  bundle_ids: string[],
  reason?: string,
  scope?: {
    branch_ids?: string[],
    department_ids?: string[],
    counter_ids?: string[],
    ward_ids?: string[]
  }
}
```

### 2. Access summary endpoint

`GET /api/permissions/user/:userId/summary`

Purpose: simple preview for admin.

Return:

```ts
{
  user,
  primary_role,
  work_areas,
  access_preview,
  risky_permissions,
  scope,
  warnings
}
```

### 3. Role impact endpoint

`GET /api/permissions/role/:role/impact`

Purpose: prevent accidental role-level changes.

Return:

```ts
{
  role,
  user_count,
  users_sample,
  customized,
  warning
}
```

### 4. Critical permission catalog

Create:

`packages/shared/src/criticalPermissions.ts`

Use in both frontend and backend.

## Policy rules

### Small hospital default

- Most users should get primary role + 0–2 work areas.
- Avoid broad manager/accounting write access by default.
- Admin can configure, but risky powers require warning/reason.

### Mid-level hospital default

- Use department/branch/counter scope.
- Use approval workflow for sensitive financial, inventory, and access-control changes.
- Review risky access monthly.
- Keep role presets stable; use per-user work areas only for exceptions.

## Acceptance criteria

1. Small hospital admin can assign staff access without understanding raw permission codes.
2. Mid-level hospital admin can manage role policies, work areas, scopes, and approval rules.
3. One user can practically perform multiple duties using additional work areas.
4. Reception does not receive accountant workspace by default.
5. Sensitive powers are clearly shown and require reason/confirmation.
6. Role-level changes show affected users before save.
7. Backend still enforces every permission server-side.
8. Raw permission editor remains available only as Advanced Mode.
9. Audit logs clearly show all access changes.
10. Future scope-aware access can be added without replacing the RBAC engine.

## Final recommendation

Build access management like this:

- **Small hospitals:** “Who is this staff? What work will they do?”
- **Mid-level hospitals:** “Which role, department, scope, approval power, and audit risk does this staff have?”
- **Backend:** keep one robust RBAC engine, add scope/approval gradually.

This gives Ozzyl HMS a simple onboarding experience now and an enterprise-ready access model later.

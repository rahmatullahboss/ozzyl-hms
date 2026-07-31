# Access Management System Specification

## Purpose

Build a safe, easy, admin-managed access system for Ozzyl HMS where small hospitals can quickly give one person multiple work areas, while still allowing detailed permission control for sensitive hospital, cash, accounting, and clinical functions.

## Best-practice basis

- NIST RBAC: users are assigned one or more roles, and roles are assigned permissions. RBAC reduces per-user access-control administration and maps access to organizational job structure.
- OWASP Authorization guidance: least privilege, deny by default, validate permissions on every request, log authorization changes, and test authorization logic.
- Microsoft RBAC guidance: avoid broad access by default and prefer least-privilege role assignments.

## Current system review

### Existing strengths

1. Central permission catalog exists in `packages/shared/src/authz.ts`.
2. Role-level overrides exist through `role_permission_overrides`.
3. Per-user grant/revoke overrides exist through `user_permission_overrides`.
4. Module visibility is tracked through `role_module_access`.
5. Permission management APIs are guarded by `roles:manage`.
6. Permission changes are audited.
7. Workspace bundles already exist and can grant common permission groups.
8. Staff onboarding supports staff-first invite flow and optional profile fields.
9. Header workspace switching exists for dual-purpose users.

### Key issues found

1. Reception users could see or enter the accountant workspace because the accountant route and switcher treated `income:read` / `expenses:read` as sufficient accountant access.
2. Permission Management user search was staff-profile based but selected `staff.id` instead of linked `user_id`, which could fail when staff ID and user ID differ.
3. Admin could change a user's primary role through backend `/api/users/:id/role`, but Permission Management did not expose this in the user access screen.
4. Existing role, bundle, module, and per-user override features are powerful but too technical for normal hospital admins.
5. Some default roles are still broad and should gradually move toward least-privilege defaults plus explicit bundles.

## Target UX

### Admin access modes

#### 1. Simple Access Mode

Use primary role and workspace bundles:

- Primary Role: Reception, Manager, Accountant, Director, MD, Nurse, Lab, Pharmacist, Doctor.
- Workspace Bundles: Reception Desk, Reception Counter Operator, Management Cash Receiver, Accountant Workspace, Management, Doctor Management, HR and Staff Management, Laboratory Workspace, Pharmacy Workspace, Inventory Operator, Reports and Analytics.

#### 2. Advanced Access Mode

Use permission-level grant/revoke:

- Grant a specific permission.
- Revoke a specific permission from role default.
- See effective permissions.
- See role permissions, user overrides, and dashboard access preview.

## Access rules

### Receptionist default

Receptionists should get reception desk, patient registration, appointment, billing counter, and counter/cash workflow only. They should not get the accountant dashboard by default.

### Accountant workspace access

Accountant dashboard access requires one of:

- user role is `accountant`, `director`, `md`, or `hospital_admin`;
- user has `accounting:read` or `accounting:write`;
- user has `billing.counter.management_cash.read`.

`income:read` or `expenses:read` alone must not open the accountant dashboard.

### High-level user access

Managers, Directors, MDs, and Admins may receive multiple bundles depending on hospital policy. This should be admin-configurable.

## Data model

Use the existing model:

- `users.role`: primary role / default identity.
- `role_permission_overrides`: tenant-level role permission override.
- `user_permission_overrides`: per-user grants/revokes.
- `role_module_access`: role-level module visibility and permission impact.

No new multi-role table is required for the first implementation. Multiple work access is represented by user-level workspace bundle grants.

## Required UI

### Staff Management

- Keep staff-first onboarding.
- Staff profile should show login status and link to access management for linked users.
- Invite role can be selected during onboarding.

### Permission Management

Tabs:

1. Role Matrix: role-level defaults and tenant overrides.
2. User Access: primary role, workspace bundles, advanced overrides, effective permissions.
3. Module Visibility: role/module on-off with permission impact warning.

### Header Workspace Switcher

The switcher must show only workspaces the user is actually allowed to use. Receptionist must not see Accountant Dashboard unless explicitly granted accounting or management-cash access.

## Acceptance criteria

1. Receptionist with only reception/income/expense basic permissions cannot see/open accountant workspace.
2. Accountant/MD/Director/Admin can see accountant workspace by default.
3. A linked staff user can be found in Permission Management and managed using `user_id`.
4. Admin can change a user's primary role from User Access screen.
5. Admin can grant/revoke workspace bundles from User Access screen.
6. Effective permission preview updates after role/bundle/override changes.
7. Build and relevant tests pass.

# Dual-Purpose Accounts, Cash Handover, and Reception Work-Mode Plan

## Goal

Allow one real person to keep a primary designation such as Director, MD, Manager, Accountant, or Receptionist while temporarily operating another workflow such as reception counter, shift handover, management cash collection, or cash supervision.

The account model should not depend only on `users.role`. The role remains the user's designation and default permission source. Actual workflow access is decided by effective permissions, current work mode, and handover purpose.

## External best-practice basis

- OWASP Authorization Cheat Sheet recommends least privilege, deny-by-default, validating permissions on every request, logging, authorization tests, and preferring attribute/relationship based authorization over pure RBAC for complex application logic.
- NIST SP 800-162 defines ABAC as authorization based on subject, object, action, and environmental attributes. For this HMS, useful attributes are user designation, effective permissions, counter session ownership, workstation identity, handover purpose, and cash custody state.
- AWS IAM guidance emphasizes least privilege and granting only the permissions required to perform a task.
- Microsoft identity guidance also recommends least privilege and using built-in/scoped roles rather than broad access.

## Current system reality

Already present:

- Single primary role on `users.role`.
- Static role permissions in `packages/shared/src/authz.ts`.
- Dynamic role and user overrides through `role_permission_overrides` and `user_permission_overrides`.
- `PermissionManagement` can grant/revoke per-user permissions and workspace bundles.
- Billing counter backend already has granular permission strings such as `billing.counter.activate`, `billing.counter.close`, and `billing.counter.handover.receive`.

Current gaps:

- Billing handover UI was still deciding major sections by role only: reception vs admin/md/director/accountant.
- Handover accept auto-open was role based: only reception/receptionist started a shift automatically.
- Management cash endpoints were previously guarded by admin roles only.
- Management pending cash lists used receiver role as a proxy for collection purpose.
- There was no explicit `handover_purpose`, so the same `counter` handover type had to mean both shift transfer and management collection.

## Target model

### 1. Primary role = designation

Examples:

- `director`
- `md`
- `manager`
- `accountant`
- `reception`

This should drive default dashboard and organizational identity, not every operational decision.

### 2. Effective permissions = actual capability

Examples:

- Reception counter operator:
  - `billing.counter.read`
  - `billing.counter.activate`
  - `billing.counter.close`
  - `billing.counter.handover.create`
  - `billing.counter.handover.receive`
  - `billing.counter.shift.auto_open`
  - `billing.counter.invoice.create`

- Management cash receiver:
  - `billing.counter.management_cash.read`
  - `billing.counter.management_cash.receive`
  - `billing.counter.management_cash.partial_collect`
  - `accounting:read`
  - `accounting:write`

- Cash supervisor:
  - `billing.counter.variance.approve`
  - `billing.counter.takeover`
  - `billing.counter.force_close`
  - `billing.counter.bank_deposit.approve`

### 3. Work mode = what the user is doing now

A Director can be:

- Director dashboard user
- Reception counter operator for this shift
- Management cash receiver
- Cash supervisor

The active counter session defines cashier work ownership. A person is treated as cashier only when they open/accept a counter session.

### 4. Handover purpose = explicit business intent

`billing_handovers.handover_purpose`:

- `shift_transfer`: cash is going to a next counter operator and may start/open a counter session.
- `management_collection`: cash is going to management/accounting custody and should not auto-open a reception shift.

## Rollout phases

## Phase 0 — Immediate fallback for tomorrow

If production needs to start before the full permission rollout is fully tested, create a separate account:

- `Person Name - Reception Duty`
- Role: `reception`

This is the safest operational fallback because older role-based logic still behaves correctly.

## Phase 1 — Compatibility patch

Keep legacy roles working, but add permission-aware behavior.

Implemented/target changes:

- Add granular permission codes to the central catalog.
- Add `handover_purpose` migration and backfill existing handovers.
- When creating a handover on counter close, infer purpose from the receiver's effective permissions:
  - receiver can operate a counter shift -> `shift_transfer`
  - otherwise management/accounting receiver -> `management_collection`
- Pending shift handover list only shows `shift_transfer` for the logged-in recipient.
- Management pending handover list only shows `management_collection`.
- Handover accept auto-opens a new session only for `shift_transfer` and only when the receiver has shift capability.
- Management collection endpoints use permission checks instead of only role checks.
- Billing Handover page can show shift section, management section, or both based on permissions with role fallback.
- Cash Operations monitoring mode can be unlocked by accounting/management-cash permissions with role fallback.

## Phase 2 — Workspace bundles

Create/maintain admin-friendly bundles:

### Reception Counter Operator

For Director/Manager/Accountant who will work at reception.

Permissions:

- `dashboard:read`
- `patients:read`
- `patients:write`
- `appointments:read`
- `appointments:write`
- `billing:read`
- `billing:write`
- `billing.counter.read`
- `billing.counter.activate`
- `billing.counter.close`
- `billing.counter.handover.create`
- `billing.counter.handover.receive`
- `billing.counter.shift.auto_open`
- `billing.counter.invoice.create`

### Management Cash Receiver

For someone who receives closed shift cash into management custody.

Permissions:

- `billing.counter.management_cash.read`
- `billing.counter.management_cash.receive`
- `billing.counter.management_cash.partial_collect`
- `accounting:read`
- `accounting:write`
- `audit:read`

### Cash Supervisor

For force-close, takeover, variance and bank deposit approvals.

Permissions:

- `billing.counter.variance.approve`
- `billing.counter.takeover`
- `billing.counter.force_close`
- `billing.counter.bank_deposit.approve`
- `billing.counter.discount.approve`

## Phase 3 — UI/work-mode cleanup

- Add a visible mode switch when a user has both capabilities:
  - Reception Shift
  - Management Collection
- Keep route query state:
  - `/billing-handover?mode=shift`
  - `/billing-handover?mode=management`
- Add a sidebar shortcut such as `Work as Reception` for MD/Director/Manager/Accountant only if they have counter permissions.
- Keep audit display showing both real user and active work mode.

## Phase 4 — Safety and audit hardening

- Self-collection guard: a user should not management-collect their own closed counter cash without a supervisor override.
- Override requires reason and audit log.
- Add workstation/IP/device evidence for sensitive cash flows.
- Add tests for permission-only users, legacy roles, dual-purpose users, and blocked self-collection.

## Phase 5 — Remove legacy assumptions

After production data is stable:

- Remove role-only branching from handover and cash pages.
- Make all sensitive routes permission based.
- Make `handover_purpose` required for new rows.
- Add a one-time data audit report for old handovers.

## Test plan

Backend:

1. Director with reception-counter permissions sees and accepts shift handovers.
2. Director without counter permissions sees only management collection.
3. Receptionist with management cash permissions can collect management cash.
4. Reception-to-reception handovers do not appear in management collection.
5. Management collection handovers do not appear in shift pending list.
6. Existing active drawer receives handover as cash-in, not opening cash.
7. No active drawer + shift transfer auto-opens with opening cash.
8. Self-collection is blocked after Phase 4.

Frontend:

1. Only shift permission -> shift UI visible.
2. Only management permission -> management UI visible.
3. Both permissions -> both sections or tabs visible.
4. No relevant permissions -> no cash-action workspace.
5. Cash Operations monitoring unlocks via accounting/management-cash permissions.

## Rollback plan

- If `handover_purpose` causes a production issue, set all new rows temporarily to legacy-compatible purpose based on receiver role.
- Existing role fallback remains active during Phase 1, so reception/admin behavior can continue even if permission data is incomplete.
- Emergency fallback: create separate `Reception Duty` accounts with role `reception` for next-day operation.

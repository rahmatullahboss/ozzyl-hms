# Manager Multi-Duty Access Blueprint

Date: 2026-06-22  
Audience: Hospital owner, MD, operations manager, implementation team  
Related technical spec: `docs/superpowers/specs/2026-06-22-permission-driven-workspaces-design.md`

## Why this blueprint exists

Small and mid-size hospitals in Bangladesh often do not have one person for one fixed job. The same person may sit at reception, collect cash, check daily reports, supervise staff, and handle limited administration. The HMS must support that reality without giving unsafe full-admin access.

The correct model is:

```text
One user account
+ one primary role
+ multiple permission bundles
+ workspace-based UI
+ branch/counter/shift scopes
+ approval and audit rules
```

Do not create many separate accounts for the same person. Do not make every manager `hospital_admin` only because they need reception access.

## Recommended operational roles

| Person type | Primary role | Access method |
|---|---|---|
| Owner / top admin | `hospital_admin` or `md` | Full or near-full management access, very limited users. |
| Operations manager | `manager` | Receives bundles based on actual duties. |
| Receptionist / cashier | `reception` | Reception and billing/cash bundles. |
| Accountant | `accountant` | Accounts, reports, expense/income bundles. |
| Doctor/nurse/lab/pharmacy | Department role | Clinical/department-specific bundles only. |

## Default manager access policy

A manager should start with limited default access:

Allowed by default:

- Dashboard read
- Reports read, if hospital owner approves
- Staff/roster read, if assigned

Not allowed by default:

- Permission change
- User role change
- Billing master price edit
- Backup/import/export
- Delete/void data
- Own refund/expense/discount approval

The manager becomes powerful only when the owner assigns bundles.

## Permission bundles for real hospital work

| Bundle | Use case | UI workspace shown |
|---|---|---|
| Reception Desk | OPD serial, appointment, patient registration | Reception Desk |
| Billing Counter | Billing, payment, invoice print, counter open/close | Reception Desk, Cash Operations |
| Cash Operations | Cash transfer, doctor payout, bank deposit, close shift | Cash Operations |
| Cash Supervisor | Drawer monitoring, variance review, collection summary | Admin Lite, Cash Operations |
| Admin Lite | Staff list, roster, basic admin monitoring | Admin Lite |
| Accounts Entry | Expense/income entry, voucher upload | Accounts |
| Reports Viewer | Daily collection, due, doctor payout, financial reports | Reports |
| System Admin | Users, roles, settings, backup | People & Access, Settings |

## How UI should behave after access is assigned

When an owner assigns bundles, the HMS should preview the exact UI the user will see.

Example: Manager Rahim gets Reception Desk + Billing Counter + Reports Viewer.

Rahim should see:

```text
Workspace switcher:
- Reception Desk
- Cash Operations
- Reports

Sidebar:
- Reception Desk
  - Daily Desk
  - OPD Serial
  - Billing Counter
  - Patients
- Cash Operations
  - Cash Transfer
  - Close Shift
- Reports
  - Daily Collection
  - Due Report
  - Billing Reports
```

Rahim should not see:

```text
- Permission Management
- User Role Change
- Billing Master Price Edit
- Backup / Import / Export
- Software Module Settings
```

This means permission assignment and UI visibility must be connected. Giving permission without showing UI is incomplete; showing UI without backend permission is unsafe.

## Scope rules

Permission should answer: “Can this person do this type of work?”  
Scope should answer: “Can this person do it here, now, and for this branch/counter?”

Recommended scope controls:

| Scope | Example rule |
|---|---|
| Branch | Manager can operate only Branch A. |
| Counter | Cashier can operate only Counter 1. |
| Shift | Cash payment requires active counter session. |
| Time | Temporary reception access expires after today. |
| Amount limit | Manager can approve discounts up to 10%, MD above that. |

## Approval safety rules

These rules should be mandatory even in small hospitals:

| Sensitive action | Safety rule |
|---|---|
| Bill cancellation | Creator cannot approve own cancellation. |
| Refund | Requester cannot approve own refund. |
| Expense | Entry user cannot approve own expense. |
| High discount | Cashier can request; manager/MD approves. |
| Cash transfer | Sender and receiver cannot be the same user. |
| Permission change | Requires `roles:manage`, audit log, and reason. |
| Temporary access | Must have expiry and reason. |

## Daily example flow

### Morning

1. Manager logs in.
2. HMS opens default workspace based on active duty: Reception Desk or Admin Lite.
3. If manager is covering reception, owner/admin assigns Reception Desk access for the shift.
4. Manager opens counter and enters opening cash.

### During day

1. Manager can register patients and create bills.
2. Cash collection updates the drawer ledger.
3. Manager can view reports allowed by bundle.
4. Manager cannot change permissions or system settings unless explicitly granted.

### End of shift

1. Manager closes counter or transfers cash.
2. HMS blocks transfer to self.
3. Receiver accepts handover.
4. Any mismatch becomes variance for review.
5. Audit log records who did what and under which workspace.

## Implementation priority

For the first production-safe slice:

1. Convert reception and cash routes from role-only to permission-driven access.
2. Make sidebar, command palette, and mobile nav use the same workspace registry.
3. Add manager role with minimal defaults.
4. Add bundle assignment UI with workspace preview.
5. Add temporary access and scope controls.
6. Add self-approval and self-handover blocks.

## Final operational rule

For Bangladesh hospitals, the HMS should allow flexible duties but not flexible accountability.

A staff member may do multiple jobs, but every job must be tied to:

- one logged-in user,
- one effective permission set,
- one workspace context,
- one branch/counter/shift scope when money is involved,
- one audit trail.

# Manager Dashboard Product Plan

Updated: 2026-06-27T13:33:48.542Z
Workspace: /Users/rahmatullahzisan/Desktop/Dev/hms

# Manager Dashboard Interface Spec and Implementation Plan

Date: 2026-06-27
Status: Planning
Owner: Ozzyl HMS

## Current Decision

Manager must not be routed to MD or Director dashboard by default.

For the current release, manager stays in the existing operational workspaces:

- Reception workspace
- Laboratory workspace

A dedicated Manager Dashboard should be introduced as a new operational supervisor interface after the current safe restriction is stable.

## Best-Practice Principles

1. Role-Based Access Control: use role-based permissions instead of giving a manager broad owner-level access.
2. Least Privilege / Minimum Necessary: manager sees enough data to supervise operations, but not full owner-level financial, shareholder, settings, or global administrative data.
3. Separation of Duties: do not let the same manager create, approve, reconcile, and audit sensitive finance workflows alone.
4. Workspace Separation: manager may switch between allowed workspaces, but each workspace keeps its own permission boundary.

## Role Boundary

### Manager Role

Purpose: operational supervisor.

Manager can:

- Monitor reception queue and patient flow
- Monitor lab order status and delays
- Monitor active counters and handovers at a summary level
- View operational alerts
- View staff duty status later only if explicitly permitted
- Assign/follow up operational tasks if task module exists
- Switch into reception and lab workflows when permission allows

Manager should not have by default:

- MD dashboard
- Director dashboard
- Accounting write access
- Full reports access
- Profit calculation or approval
- Shareholder access
- System settings write access
- Staff delete access
- Permission management access
- Final voucher approval
- Final expense approval

### Accountant Role

Use accountant role when the person mainly does হিসাব-নিকাশ.

Accountant can manage income, expenses, cash collection, bank deposit, ledger/vouchers, doctor payout, and financial reports.

### MD / Director Roles

Use MD/Director for owner-level oversight and final approvals: executive dashboard, profit/loss, high-level reports, shareholder/owner information, final approvals, sensitive audit/settings.

## Current Temporary Implementation

Manager is intentionally limited to operational workspaces.

Current temporary access target:

- Default route: `/h/:slug/reception/dashboard`
- Sidebar: Reception actions + Lab actions
- Command palette: Reception actions + Lab actions

Manager should not see MD links in sidebar or command palette.

Manager should not be redirected to `/md/dashboard` even if the role later receives a reporting-like permission.

## Dedicated Manager Dashboard Scope

Route:

- `/h/:slug/manager/dashboard`

Component:

- `web/src/pages/ManagerDashboard.tsx`

Dashboard layout:

1. Header
   - Hospital name
   - Current date/time
   - Workspace switcher: Manager / Reception / Lab
   - Quick actions based on permissions

2. KPI cards
   - Today OPD patients
   - Today appointments
   - Active reception counters
   - Pending lab orders
   - Lab reports ready / pending delivery
   - IPD admissions today if permission exists
   - Bed occupancy if permission exists
   - Cash handover pending count only, not full owner finance

3. Operations board
   - Reception queue status
   - Waiting patients by stage
   - Lab pending by priority
   - Billing/payment pending
   - Discharge pending if IPD module is enabled

4. Alerts panel
   - Long waiting queue
   - Lab report delay
   - Counter not closed
   - Cash mismatch alert summary
   - High discount review summary only if permission exists
   - Low stock alert summary if inventory permission exists

5. Task/follow-up panel
   - Assigned tasks
   - Pending handovers
   - Department follow-ups
   - Notes for reception/lab

6. Quick links
   - Reception dashboard
   - Billing counter
   - Cash operations
   - Lab dashboard
   - Lab orders
   - Patient search

## Data Requirements

Create a manager overview API that returns safe summary data.

Recommended endpoint:

- `GET /api/manager/dashboard-summary?date=YYYY-MM-DD`

Response shape:

```ts
interface ManagerDashboardSummary {
  date: string;
  reception: {
    patientsToday: number;
    appointmentsToday: number;
    waitingQueue: number;
    activeCounters: number;
    pendingHandovers: number;
  };
  lab: {
    ordersToday: number;
    pendingOrders: number;
    readyReports: number;
    delayedReports: number;
  };
  billing: {
    invoicesToday: number;
    dueInvoices: number;
    pendingPayments: number;
    cashMismatchAlerts: number;
  };
  ipd?: {
    admissionsToday: number;
    dischargesPending: number;
    occupiedBeds: number;
    availableBeds: number;
  };
  alerts: Array<{
    id: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    description?: string;
    targetPath?: string;
  }>;
}
```

## Permission Design

Create manager-specific operational permissions over time instead of giving broad MD permissions.

Recommended future permissions:

- `manager.dashboard.read`
- `operations.overview.read`
- `operations.alerts.read`
- `operations.tasks.read`
- `operations.tasks.write`
- `operations.department_status.read`

Current temporary permission mapping can continue using:

- `dashboard:read`
- `patients:read`
- `appointments:read`
- `billing:read`
- `tests:read`
- `tests:write`

Avoid adding these to manager by default:

- `reports:read`
- `accounting:read`
- `accounting:write`
- `profit:calculate`
- `profit:approve`
- `settings:write`
- `shareholders:read`
- `shareholders:write`
- `staff:delete`

## UI/UX Requirements

### Workspace Switcher

Top switcher should show only workspaces the user can access.

For manager now:

- Reception
- Lab

After dedicated dashboard:

- Manager
- Reception
- Lab

The switcher must not expose MD or Director workspace for manager.

### Sidebar

Manager sidebar should contain only operational links:

- Dashboard / Manager Overview
- Patients
- OPD serial / appointments
- Billing counter
- Cash operations
- Lab dashboard
- Lab orders
- Report delivery if needed

No MD/Director links should be present.

### Command Palette

Command palette must mirror sidebar boundaries.

Manager should not be able to search/open:

- `md/dashboard`
- `md/accounting`
- `md/staff`
- `md/reports`
- `director/*`

## Implementation Steps

### Phase 0: Current Safe Fix

Already applied in this session:

- Manager redirect is forced to reception dashboard.
- Manager default permission removed `reports:read`.
- Manager default permission includes lab `tests:read` and `tests:write`.
- Manager sidebar removes MD management links and adds lab links.
- Manager command palette removes MD shortcuts and adds lab shortcuts.

### Phase 1: Add Manager Dashboard Route

Files:

- `web/src/pages/ManagerDashboard.tsx`
- `web/src/App.tsx`
- `web/src/components/dashboard/Sidebar.tsx`
- `web/src/components/dashboard/CommandPalette.tsx`

Tasks:

1. Create `ManagerDashboard` page.
2. Add lazy import in `App.tsx`.
3. Add route `/manager/dashboard` guarded by manager dashboard permission or manager role.
4. Change manager default route from reception dashboard to manager dashboard after page is ready.
5. Add Manager Overview sidebar item.
6. Add Manager Overview command palette item.

### Phase 2: Add Summary API

Files to inspect before implementation:

- Existing dashboard API routes
- Reception dashboard data source
- Lab dashboard data source
- Billing counter / handover API

Tasks:

1. Create manager dashboard summary route.
2. Reuse existing queries where possible.
3. Return only safe operational summaries.
4. Add tenant scoping.
5. Add permission guard.
6. Add tests for manager allowed and non-manager blocked.

### Phase 3: Add Workspace Switcher Rules

Tasks:

1. Ensure workspace switcher reads allowed role/permissions.
2. Manager sees Manager, Reception, Lab only.
3. Accountant sees Accountant only unless explicitly granted operational workspace.
4. MD/Director see their executive workspace and allowed operational shortcuts.

### Phase 4: Tests

Add or update tests:

- Manager does not redirect to MD dashboard.
- Manager default route goes to reception now; later manager dashboard.
- Manager cannot see MD accounting/staff/reports links.
- Manager can see lab dashboard/orders links.
- Manager command palette excludes MD links.
- Manager can access lab routes with tests permission.
- Manager cannot access director routes.

## Acceptance Criteria

Current release acceptance:

- Manager login lands on reception dashboard.
- Manager can switch/use reception and lab allowed pages.
- Manager does not see MD/Director dashboard links.
- Manager does not receive `reports:read` by default.

Future manager dashboard acceptance:

- Manager lands on `/manager/dashboard`.
- Dashboard gives operational summary without owner-level finance.
- Workspace switch shows Manager / Reception / Lab.
- No accounting/profit/shareholder/settings exposure by default.
- API and UI are tenant-scoped and permission-guarded.

## Notes for Future Product Design

If a hospital says their manager handles accounts, do not overload the base manager role. Use one of these:

1. Assign Accountant role.
2. Create a custom role like `finance_manager`.
3. Add explicit finance permissions only after admin confirmation.

Manager should remain an operational supervisor by default.

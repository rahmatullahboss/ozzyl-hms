# Admin Panel Blueprint Transformation Plan

**Goal:** Transform the current cluttered admin panel into a clean, blueprint-aligned Monitoring + Control + Approval + Investigation + Configuration center.

**Date:** 2026-06-11

---

## Current State Analysis

### What Exists (Problems)

| Problem | Details |
|---------|---------|
| **Sidebar: 50+ items** | `hospital_admin` has 5 groups (Operations, Clinical, Finance, Admin, System) with 50+ clickable items. Very confusing. |
| **Dashboard: 1783 lines** | Single monolithic file with everything crammed in. Hard to maintain. |
| **No Action Center** | Approvals scattered — `ApprovalCenter.tsx` exists but not prominent. No severity-coded alerts panel. |
| **No Operations Monitor** | Each module (OPD, Lab, IPD, Pharmacy) is separate. No consolidated admin oversight view. |
| **No Discount Review** | Discount rules exist but no dedicated review page with reference-wise analytics. |
| **No Document Management** | Expense has `receipt_key` but no central document viewer. |
| **No Suspicious Activity** | Fraud alerts exist in dashboard but no dedicated detection engine. |
| **No Notification System** | Header has notification bell with `inbox` but no admin-specific notification categories or escalation. |
| **No Export History** | No tracking of who exported what data. |
| **No Login Sessions** | No tracking of active user sessions. |
| **No Custom Report Builder** | Basic reports exist but no drag-and-drop or column-picker builder. |

### What's Good (Keep)

- `DashboardLayout.tsx` — Clean shell (sidebar + header + content). Keep.
- `Header.tsx` — Has notification bell, global search, theme toggle, language toggle. Enhance.
- `CommandPalette.tsx` — Cmd+K search. Keep.
- `ApprovalCenter.tsx` — Basic approval queue. Enhance.
- `AdminTransactionControlCenter.tsx` — Cash drawer monitoring. Keep.
- RBAC system — 87 permissions, dynamic overrides. Keep.
- All backend APIs — expense, approval, billing, audit, etc. Keep.

---

## Target State (Blueprint-Aligned)

### New Sidebar Structure (9 groups, ~35 items)

```
Dashboard
Action Center
  Pending Approvals
  Alerts & Exceptions
  Tasks & Follow-ups
Operations Monitor
  OPD & Appointments
  Diagnostic & Lab
  IPD & Beds
  OT & Procedures
  Pharmacy
  Emergency
Cash & Finance
  Live Cash Drawers
  Shift Handover
  Collection Reports
  Discounts
  Refunds
  Expenses
  Doctor Commission
  Due & Receivables
  Bank Deposits
Inventory
  Stock Overview
  Low Stock & Expiry
  Purchase Requests
  Stock Adjustments
People & Access
  Users
  Roles & Permissions
  Employees
  Doctors
  Attendance & Leave
  Login Sessions
Audit & Security
  Audit Explorer
  Financial Activity
  Suspicious Activities
  Export History
Reports & Analytics
  Executive Overview
  Revenue Analytics
  Department Reports
  Doctor Reports
  Custom Report Builder
Settings
  Hospital Profile
  Branches & Departments
  Services & Pricing
  Approval Policies
  Discount Rules
  Payment Methods
  Print Layouts
  Notifications
  SMS & Email
  System Preferences
```

---

## Phase 1: Sidebar Restructure + Dashboard Redesign (Week 1-2)

### Task 1.1: Create Admin Sidebar Config

**File:** `web/src/components/dashboard/adminSidebarConfig.ts` (NEW)

Extract the `hospital_admin` nav from `Sidebar.tsx` into a separate config file. Create the new 9-group structure.

```typescript
// adminSidebarConfig.ts
export interface AdminNavItem {
  labelKey: string;
  path?: string;
  icon: React.ReactNode;
  requiredPermission?: string;
  badge?: number; // dynamic count
  children?: AdminNavItem[];
}

export interface AdminNavGroup {
  groupKey?: string;
  items: AdminNavItem[];
}

export const adminNavGroups: AdminNavGroup[] = [
  {
    items: [
      { labelKey: 'dashboard', path: 'dashboard', icon: <LayoutDashboard /> },
    ],
  },
  {
    groupKey: 'groupActionCenter',
    items: [
      { labelKey: 'pendingApprovals', path: 'approvals', icon: <ShieldCheck /> },
      { labelKey: 'alertsExceptions', path: 'alerts', icon: <AlertTriangle /> },
      { labelKey: 'tasksFollowups', path: 'tasks', icon: <ClipboardList /> },
    ],
  },
  {
    groupKey: 'groupOperationsMonitor',
    items: [
      { labelKey: 'opdAppointments', path: 'monitor/opd', icon: <Users /> },
      { labelKey: 'diagnosticLab', path: 'monitor/lab', icon: <FlaskConical /> },
      { labelKey: 'ipdBeds', path: 'monitor/ipd', icon: <BedDouble /> },
      { labelKey: 'otProcedures', path: 'monitor/ot', icon: <Scissors /> },
      { labelKey: 'pharmacyMonitor', path: 'monitor/pharmacy', icon: <Pill /> },
      { labelKey: 'emergencyMonitor', path: 'monitor/emergency', icon: <Siren /> },
    ],
  },
  {
    groupKey: 'groupCashFinance',
    items: [
      { labelKey: 'liveCashDrawers', path: 'cash/drawers', icon: <Wallet /> },
      { labelKey: 'shiftHandover', path: 'cash/handover', icon: <ArrowRightLeft /> },
      { labelKey: 'collectionReports', path: 'cash/collections', icon: <BarChart3 /> },
      { labelKey: 'discounts', path: 'cash/discounts', icon: <Percent /> },
      { labelKey: 'refunds', path: 'cash/refunds', icon: <RefreshCw /> },
      { labelKey: 'expenses', path: 'cash/expenses', icon: <TrendingDown /> },
      { labelKey: 'doctorCommission', path: 'cash/commissions', icon: <DollarSign /> },
      { labelKey: 'dueReceivables', path: 'cash/dues', icon: <HandCoins /> },
      { labelKey: 'bankDeposits', path: 'cash/deposits', icon: <CreditCard /> },
    ],
  },
  {
    groupKey: 'groupInventory',
    items: [
      { labelKey: 'stockOverview', path: 'inventory', icon: <Package /> },
      { labelKey: 'lowStockExpiry', path: 'inventory/alerts', icon: <AlertTriangle /> },
      { labelKey: 'purchaseRequests', path: 'inventory/purchase', icon: <ShoppingCart /> },
      { labelKey: 'stockAdjustments', path: 'inventory/adjustments', icon: <ClipboardCheck /> },
    ],
  },
  {
    groupKey: 'groupPeopleAccess',
    items: [
      { labelKey: 'users', path: 'users', icon: <Users /> },
      { labelKey: 'rolesPermissions', path: 'permissions', icon: <Shield /> },
      { labelKey: 'employees', path: 'staff', icon: <UserCog /> },
      { labelKey: 'doctors', path: 'doctors', icon: <Stethoscope /> },
      { labelKey: 'attendanceLeave', path: 'hr', icon: <CalendarDays /> },
      { labelKey: 'loginSessions', path: 'sessions', icon: <Monitor /> },
    ],
  },
  {
    groupKey: 'groupAuditSecurity',
    items: [
      { labelKey: 'auditExplorer', path: 'system-audit', icon: <Shield /> },
      { labelKey: 'financialActivity', path: 'audit/financial', icon: <DollarSign /> },
      { labelKey: 'suspiciousActivities', path: 'audit/suspicious', icon: <AlertTriangle /> },
      { labelKey: 'exportHistory', path: 'audit/exports', icon: <FileUp /> },
    ],
  },
  {
    groupKey: 'groupReportsAnalytics',
    items: [
      { labelKey: 'executiveOverview', path: 'analytics/executive', icon: <PieChart /> },
      { labelKey: 'revenueAnalytics', path: 'analytics/revenue', icon: <TrendingUp /> },
      { labelKey: 'departmentReports', path: 'analytics/departments', icon: <Building2 /> },
      { labelKey: 'doctorReports', path: 'analytics/doctors', icon: <Stethoscope /> },
      { labelKey: 'customReportBuilder', path: 'analytics/builder', icon: <Layers /> },
    ],
  },
  {
    groupKey: 'groupSettings',
    items: [
      { labelKey: 'hospitalProfile', path: 'settings/hospital-profile', icon: <Building2 /> },
      { labelKey: 'branchesDepartments', path: 'settings/departments', icon: <Building2 /> },
      { labelKey: 'servicesPricing', path: 'billing-master', icon: <Receipt /> },
      { labelKey: 'approvalPolicies', path: 'settings/approval-policies', icon: <ShieldCheck /> },
      { labelKey: 'discountRules', path: 'settings/discounts', icon: <Percent /> },
      { labelKey: 'paymentMethods', path: 'settings/payments', icon: <CreditCard /> },
      { labelKey: 'printLayouts', path: 'print-templates', icon: <Printer /> },
      { labelKey: 'notifications', path: 'settings/notifications', icon: <Bell /> },
      { labelKey: 'smsEmail', path: 'settings/sms', icon: <MessageSquare /> },
      { labelKey: 'systemPreferences', path: 'settings/preferences', icon: <Settings /> },
    ],
  },
];
```

**Modify:** `web/src/components/dashboard/Sidebar.tsx`
- Import `adminNavGroups` from config
- Replace the inline `hospital_admin` block with the imported config
- Keep other roles (reception, doctor, nurse, etc.) unchanged
- Add badge support for pending counts

### Task 1.2: Add Branch Selector to Header

**File:** `web/src/components/dashboard/Header.tsx`

Add branch selector dropdown between hospital name and date. Currently missing.

```tsx
// Add after hospital name
<select
  value={selectedBranch}
  onChange={(e) => setSelectedBranch(e.target.value)}
  className="text-xs border rounded px-2 py-1"
>
  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
</select>
```

### Task 1.3: Add Quick Action Button to Header

**File:** `web/src/components/dashboard/Header.tsx`

Add a "+" button that opens a dropdown with quick actions:
- Create Announcement
- Open Approval Center
- Search Invoice
- View Live Counters
- Export Daily Report

### Task 1.4: Break Down Dashboard into Widgets

**Current:** `HospitalAdminDashboard.tsx` (1783 lines — monolithic)

**New structure:**

```
web/src/pages/admin/
  Dashboard.tsx                    (NEW — orchestrator, ~100 lines)
  widgets/
    KPISummaryCards.tsx            (NEW — 6 cards)
    ActionRequiredPanel.tsx        (NEW — severity-coded alerts)
    LiveCashDrawerWidget.tsx       (NEW — compact drawer table)
    RevenueTrendChart.tsx          (NEW — hourly/7d/30d toggle)
    PaymentMethodBreakdown.tsx     (NEW — donut chart)
    OperationsSnapshot.tsx         (NEW — 4 mini widgets)
    AuditFeedWidget.tsx            (NEW — recent audit entries)
```

**Dashboard.tsx** (orchestrator):
```tsx
export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <DashboardHeader /> {/* Good morning, branch, date */}
      <KPISummaryCards />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ActionRequiredPanel />
          <RevenueTrendChart />
          <OperationsSnapshot />
        </div>
        <div className="space-y-6">
          <LiveCashDrawerWidget />
          <PaymentMethodBreakdown />
          <AuditFeedWidget />
        </div>
      </div>
    </div>
  );
}
```

### Task 1.5: Create Action Required Panel

**File:** `web/src/pages/admin/widgets/ActionRequiredPanel.tsx` (NEW)

Fetch from `/api/approvals/counts` and display severity-coded list:
- 🔴 Red: Cash shortage disputes, unusual cancellations
- 🟠 Orange: Discount reviews, refund requests, expenses awaiting approval
- 🟡 Yellow: Low stock alerts, expiring products

Each item clickable → navigates to filtered list.

---

## Phase 2: Action Center + Discount Review (Week 3-4)

### Task 2.1: Enhance Approval Center

**File:** `web/src/pages/ApprovalCenter.tsx`

Add:
- Summary cards (Total Pending, High Priority, Older than 24h, Today Approved)
- Tabs: All | Discount | Refund | Expense | Bill Cancellation | Stock Adjustment
- Right-side drawer with full context (invoice, patient, history, attachments, risk indicator)
- "Request Clarification" action
- Previous request history per user

### Task 2.2: Create Discount Review Page

**File:** `web/src/pages/admin/DiscountReview.tsx` (NEW)

Tabs: Overview | Pending Review | Approved | Rejected | High Discount | Reference-wise | Staff-wise

Table columns: Invoice, Patient, Original Bill, Discount, Discount %, Reference, Requested By, Authorized By, Photo, Status

Filters: Date, Branch, Department, Receptionist, Reference person, Manager, Discount % range, Amount range, Has attachment, Missing attachment, Status, High risk only

**Reference-wise Analysis sub-page:**
Table: Referred By, Total Discounts, Discount Amount, Patient Count, Average Discount, High Discount Count

**Backend:** New API endpoint `/api/admin/discounts/reference-analysis`

### Task 2.3: Create Alerts & Exceptions Page

**File:** `web/src/pages/admin/AlertsExceptions.tsx` (NEW)

Show auto-detected anomalies:
- High discount frequency by user
- Unusual reference person patterns
- Refund spikes near shift close
- Repeated invoice cancellations
- Cash shortages
- Shared PIN suspicion
- Night exports
- Stock manipulation
- Bulk patient record access

**Backend:** New API endpoint `/api/admin/alerts` with rule engine

### Task 2.4: Create Refund Approval Detail

**File:** `web/src/pages/admin/RefundDetail.tsx` (NEW)

Right-side drawer showing:
- Original invoice with paid services
- Service delivery status
- Requested refund amount + reason
- Uploaded photo
- Patient mobile number
- Previous patient refund history
- Previous staff refund history
- Actions: Approve, Reject, Partial Approve, Flag Suspicious, Ask Clarification

---

## Phase 3: Operations Monitor Views (Week 5-6)

### Task 3.1: Create OPD Monitor

**File:** `web/src/pages/admin/monitor/OPDMonitor.tsx` (NEW)

Widgets:
- Today appointments count
- Checked-in / Waiting / Completed / Cancelled / No-show
- Average wait time
- Delayed doctors list

Table: Token, Patient, Doctor, Appointment Time, Check-in, Waiting Time, Status

### Task 3.2: Create Diagnostic Monitor

**File:** `web/src/pages/admin/monitor/DiagnosticMonitor.tsx` (NEW)

Widgets:
- Total tests today
- Sample pending / Processing / Report ready / Delayed reports
- Critical result alerts

Table: Test ID, Patient, Test, Department, Sample Status, Report Status, Expected Time, Delay

### Task 3.3: Create IPD & Bed Monitor

**File:** `web/src/pages/admin/monitor/IPDMonitor.tsx` (NEW)

Views: Bed Map (color-coded) | Patient List | Discharge Pending | Due Alerts

Bed colors: Green (available), Blue (occupied), Yellow (discharge pending), Orange (cleaning), Red (blocked)

### Task 3.4: Create Pharmacy Monitor

**File:** `web/src/pages/admin/monitor/PharmacyMonitor.tsx` (NEW)

Widgets:
- Today sales + gross margin
- Low stock count
- Near expiry count
- Pending purchase requests
- Return amount

---

## Phase 4: Audit & Security Enhancement (Week 7-8)

### Task 4.1: Enhance Audit Explorer

**File:** `web/src/pages/SystemAuditLog.tsx`

Add filters:
- Counter, Department, Invoice, Patient, Amount range, IP, Device, Severity, Approval status

Add row expand with full before/after detail.

### Task 4.2: Create Export History Page

**File:** `web/src/pages/admin/ExportHistory.tsx` (NEW)

Table: Time, User, Report, Format, Filters Used, Rows Exported, Device, IP

**Backend:** Log every export action to `export_history` table.

### Task 4.3: Create Login Sessions Page

**File:** `web/src/pages/admin/LoginSessions.tsx` (NEW)

Table: User, Device, IP, Browser, Login Time, Last Active, Branch, Status

Actions: Force logout, Block device, Mark trusted, Investigate user

**Backend:** New API `/api/admin/sessions` + session tracking middleware.

### Task 4.4: Create Suspicious Activity Engine

**File:** `web/src/pages/admin/SuspiciousActivities.tsx` (NEW)

Auto-detection rules:
1. High discount frequency (same user, same day)
2. Unusual reference person (too many discounts under one name)
3. Refund spike (near shift close)
4. Repeated cancellations
5. Cash shortage pattern
6. Shared PIN usage
7. Night-time exports
8. Stock manipulation (adjustment without purchase)
9. Bulk patient record access

**Backend:** New `/api/admin/alerts/detect` endpoint with rule engine.

---

## Phase 5: Reports & Analytics (Week 9-10)

### Task 5.1: Create Executive Overview

**File:** `web/src/pages/analytics/ExecutiveOverview.tsx` (NEW)

Compact report for owner/director:
- Revenue, Expense, Net collection
- Patient growth trend
- Department income breakdown
- Doctor contribution ranking
- Discount & refund summary
- Due aging
- Bed occupancy
- Pharmacy sales
- Branch comparison (if multi-branch)

### Task 5.2: Create Revenue Analytics

**File:** `web/src/pages/analytics/RevenueAnalytics.tsx` (NEW)

Charts:
- Daily revenue trend
- Department-wise revenue
- Payment mode trend
- Discount vs revenue correlation
- Refund trend
- Average invoice value

Filters: Branch, Department, Service, Doctor, Date range, Payment mode, Counter, Receptionist

### Task 5.3: Create Custom Report Builder

**File:** `web/src/pages/analytics/CustomReportBuilder.tsx` (NEW)

Step 1: Choose Module (Billing, Patients, Lab, Pharmacy, IPD, Expenses)
Step 2: Choose Columns (checkbox list)
Step 3: Add Filters (date, amount, department, etc.)
Step 4: Preview → Export (PDF/Excel) → Save Template

---

## Phase 6: Notifications & Settings Enhancement (Week 11-12)

### Task 6.1: Build Notification Engine

**Backend:**
- New table `notification_rules` (type, condition, channel, recipients)
- New table `notification_queue` (type, title, message, channel, status)
- New API `/api/admin/notifications/rules` (CRUD)
- Integration points: approval created, cash shortage, stock low, expiry, IPD due

**Frontend:**
- Settings page for notification rules
- Enhanced header bell with categorized notifications

### Task 6.2: Create Approval Policy Builder

**File:** `web/src/pages/admin/ApprovalPolicies.tsx` (NEW)

Visual rule builder:
```
Action: [Discount ▼]
Condition: [Percentage > 20%]
Required Approval: [Hospital Admin ▼]
Attachment: [Mandatory ☑]
PIN: [Required ☑]
Escalation Time: [30 minutes]
```

### Task 6.3: Enhance Settings Pages

Add missing settings:
- Notification configuration page
- Approval policy builder
- Discount rules (detailed, per-department, per-doctor, per-branch)

---

## Implementation Order Summary

| Phase | Duration | Focus | Key Deliverables |
|-------|----------|-------|-----------------|
| 1 | Week 1-2 | Sidebar + Dashboard | New sidebar structure, dashboard widgets, Action Required panel |
| 2 | Week 3-4 | Action Center + Discount | Enhanced approvals, discount review, refund detail, alerts |
| 3 | Week 5-6 | Operations Monitor | OPD, Lab, IPD, Pharmacy monitor pages |
| 4 | Week 7-8 | Audit & Security | Export history, login sessions, suspicious activity engine |
| 5 | Week 9-10 | Reports & Analytics | Executive overview, revenue analytics, custom report builder |
| 6 | Week 11-12 | Notifications & Settings | Notification engine, approval policies, settings enhancement |

---

## Files to Create (New)

| # | File | Purpose |
|---|------|---------|
| 1 | `web/src/components/dashboard/adminSidebarConfig.ts` | Sidebar config for hospital_admin |
| 2 | `web/src/pages/admin/Dashboard.tsx` | New admin dashboard orchestrator |
| 3 | `web/src/pages/admin/widgets/KPISummaryCards.tsx` | 6 KPI cards |
| 4 | `web/src/pages/admin/widgets/ActionRequiredPanel.tsx` | Severity-coded alerts |
| 5 | `web/src/pages/admin/widgets/LiveCashDrawerWidget.tsx` | Compact drawer table |
| 6 | `web/src/pages/admin/widgets/RevenueTrendChart.tsx` | Revenue chart with toggle |
| 7 | `web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx` | Donut chart |
| 8 | `web/src/pages/admin/widgets/OperationsSnapshot.tsx` | 4 mini widgets |
| 9 | `web/src/pages/admin/widgets/AuditFeedWidget.tsx` | Recent audit entries |
| 10 | `web/src/pages/admin/DiscountReview.tsx` | Discount review + analytics |
| 11 | `web/src/pages/admin/RefundDetail.tsx` | Refund approval detail |
| 12 | `web/src/pages/admin/AlertsExceptions.tsx` | Auto-detected anomalies |
| 13 | `web/src/pages/admin/monitor/OPDMonitor.tsx` | OPD queue monitor |
| 14 | `web/src/pages/admin/monitor/DiagnosticMonitor.tsx` | Lab monitor |
| 15 | `web/src/pages/admin/monitor/IPDMonitor.tsx` | Bed map + IPD monitor |
| 16 | `web/src/pages/admin/monitor/PharmacyMonitor.tsx` | Pharmacy monitor |
| 17 | `web/src/pages/admin/ExportHistory.tsx` | Export tracking |
| 18 | `web/src/pages/admin/LoginSessions.tsx` | Active sessions |
| 19 | `web/src/pages/admin/SuspiciousActivities.tsx` | Fraud detection |
| 20 | `web/src/pages/admin/ApprovalPolicies.tsx` | Policy builder |
| 21 | `web/src/pages/analytics/ExecutiveOverview.tsx` | Owner dashboard |
| 22 | `web/src/pages/analytics/RevenueAnalytics.tsx` | Revenue charts |
| 23 | `web/src/pages/analytics/CustomReportBuilder.tsx` | Report builder |

## Files to Modify (Existing)

| # | File | Change |
|---|------|--------|
| 1 | `web/src/components/dashboard/Sidebar.tsx` | Replace hospital_admin block with imported config |
| 2 | `web/src/components/dashboard/Header.tsx` | Add branch selector, quick action button |
| 3 | `web/src/pages/ApprovalCenter.tsx` | Add summary cards, tabs, detail drawer, risk indicator |
| 4 | `web/src/pages/SystemAuditLog.tsx` | Add more filters, row expand |
| 5 | `web/src/App.tsx` | Add new routes for all new pages |
| 6 | `src/routes/tenant/audit.ts` | Add export logging |
| 7 | `src/schemas/audit.ts` | Add export history schema |

## New Backend APIs Needed

| # | Endpoint | Purpose |
|---|----------|---------|
| 1 | `GET /api/admin/discounts/reference-analysis` | Reference-wise discount analytics |
| 2 | `GET /api/admin/alerts` | Suspicious activity alerts |
| 3 | `POST /api/admin/alerts/detect` | Run detection rules |
| 4 | `GET /api/admin/sessions` | Active login sessions |
| 5 | `POST /api/admin/sessions/:id/force-logout` | Force logout user |
| 6 | `GET /api/admin/exports` | Export history |
| 7 | `GET /api/admin/notifications/rules` | Notification rules CRUD |
| 8 | `GET /api/admin/monitor/opd` | OPD monitor data |
| 9 | `GET /api/admin/monitor/lab` | Lab monitor data |
| 10 | `GET /api/admin/monitor/ipd` | IPD monitor data |
| 11 | `GET /api/admin/monitor/pharmacy` | Pharmacy monitor data |

## New Database Tables

| # | Table | Purpose |
|---|-------|---------|
| 1 | `export_history` | Track all data exports |
| 2 | `login_sessions` | Track active sessions |
| 3 | `notification_rules` | Configurable notification rules |
| 4 | `notification_queue` | Pending notification delivery |
| 5 | `approval_policies` | Configurable approval rules |
| 6 | `suspicious_activity_alerts` | Auto-detected anomalies |

---

## Zero-Context Test

Each task above should be executable by an engineer with zero codebase context. Detailed code examples, exact file paths, and verification commands will be added per-task during execution phase.

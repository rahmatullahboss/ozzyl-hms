# Admin Panel — Pending Issues Backlog

Captured 2026-06-11 from the comprehensive admin review. Items are
ordered by severity and grouped by category. The auth boundary fix
(C1) is already shipped (commit `fc0c346e`).

## 🔴 P0 — Security Gaps (open)

### GAP-1. `/api/admissions/*` has no role-check middleware
- **File**: `src/routes/tenant/admissions.ts:45` (no `app.use('/*', requireRole(...))`)
- **Severity**: Important (data leak), not production-blocker
- **Risk**: Any authenticated user (pharmacist, lab_tech, accountant)
  can read all admissions data
- **Affected**: 12 integration tests in `test/integration/routes/admissions.test.ts`
  (idempotency test + others — most don't inject `role` so they may
  start failing once the middleware lands)
- **Affected frontend**: ~6 pages that call admissions API
  (AdmissionIPD, BedManagement (nurse), IPDWorkspace (doctor),
  OTReports, DischargePlanning, possibly more)
- **Suggested fix**: Add `app.use('/*', requireRole('hospital_admin',
  'md', 'director', 'manager', 'receptionist', 'doctor', 'nurse'))`
- **Effort estimate**: 1-2 hours (include test fix-ups)
- **Approach when picked up**: Brainstorming + TDD plan, because the
  test fix-ups need careful auditing (some tests may need role
  injection, some may need to be deleted as outdated)

## 🟡 P1 — UX consistency gaps (open, 28 pages affected)

### UX-1. Bare `t('Loading...')` instead of skeleton
- **Files**: 28 admin pages
- **Pattern**: `if (isLoading) return <DashboardLayout>...{t('Loading...')}</DashboardLayout>`
- **Inconsistent with**: dashboard widgets which use
  `<div className="skeleton h-12" />`
- **Suggested fix**: Add a single `<AdminLoadingState />` or
  `<DetailPageSkeleton />` component, replace all 28 usages
- **Effort**: 1-2 hours

### UX-2. Zero error handling on admin pages
- **Files**: all admin pages
- **Pattern**: only `isLoading` is checked, never `isError` or `error`
- **Result**: API failures show empty arrays silently
- **Suggested fix**: Add `isError` / `error` handling, show error
  toast + retry button
- **Effort**: 3-4 hours (28 pages × ~5 min each)

## 🟠 P2 — Component adoption gaps (open)

### CMP-1. `AdminPageShell` (64 lines, blueprint Section 20) — never imported
- **File**: `web/src/components/admin/AdminPageShell.tsx`
- **Why built**: matches blueprint Section 20 exactly (title, subtitle,
  breadcrumbs, summary cards, tabs, filters, children, export/print)
- **Suggested fix**: Adopt in 19 admin list/detail pages
- **Effort**: 4-6 hours

### CMP-2. `BulkActionsBar` (103 lines) — never imported
### CMP-3. `ExportPrintBar` (36 lines) — never imported
### CMP-4. `Breadcrumb` (33 lines) — never imported
### CMP-5. `DocumentViewer` (185 lines) — never imported (designed for
  document workflows but not wired into any discount/refund/expense
  flow)
- **Total effort for all 4**: 1-2 hours (mostly mechanical)
- **DocumentViewer** is the larger piece (1-2 days) because it
  needs workflow integration, not just adoption

## 🟠 P2 — Test coverage gaps (open, 14 admin pages untested)

### TEST-1. 14 admin pages have no frontend test file
- **Pages**: AuditExplorer, CashDrawerDetail, CollectionFollowup,
  DailyCollectionReport, DiscountReferenceAnalytics,
  DoctorPayoutDetail, EscalationRules, ExpenseDetailPage,
  FinancialReports, PatientRecordAccess, RefundRequestDetail,
  ShiftHandoverDetail, StaffActivityLog, TelemedicineMonitor
- **Frontend tests currently cover**: 19/33 pages (58%)
- **Effort**: 6-8 hours (mock-heavy, 14 × 30-45 min each)

## 🟢 P2 — Accessibility gaps (open, all admin pages affected)

### A11Y-1. No `aria-current` / `aria-selected` on tab buttons
- **Files**: 28 pages with tabs
- **Effort**: 1 hour

### A11Y-2. No `<caption>` / `scope="col"` on tables
- **Files**: most admin pages
- **Effort**: 2 hours

### A11Y-3. No `htmlFor` association on label/input
- **Files**: AuditExplorer (only file with inputs)
- **Effort**: 15 min

### A11Y-4. No `onKeyDown` handlers (only `onClick`)
- **Files**: all admin pages
- **Effort**: 1 hour (mostly mechanical)

### A11Y-5. No `aria-live` regions for polling widgets
- **Files**: 7 dashboard widgets
- **Effort**: 2 hours

## 🟢 P2 — Blueprint gaps (open)

### BLUE-1. Custom Report Builder not routed
- **File**: `web/src/pages/analytics/CustomReportBuilder.tsx` exists
- **Issue**: not in `web/src/App.tsx`
- **Fix**: 10 minutes (just add the route)
- **Routes also wrong**: `/settings/discounts` → `TenantRedirect path="settings/billing"`
  (should be a discount rules page, not billing settings)
- **Wrong SMS route**: `/settings/sms` → `EmailSettings` component
  (should be a separate SMS settings page)

### BLUE-2. 5 missing suspicious-activity rules
- **File**: `src/routes/admin/index.ts:1137-1230`
- **Currently implemented** (3 rules):
  - high_discount_frequency
  - refund_spike
  - stock_manipulation
- **Missing** (5 rules per blueprint):
  - unusual_reference_person
  - repeated_cancellation
  - cash_shortage
  - night_export
  - patient_record_bulk_access
- **Effort**: 4-6 hours

## ✅ Recently shipped (admin slice)

| Commit | What | Tests |
|---|---|---|
| `19caea05` + `2ca07b52` + `dbc50ac5` | IPD monitor /api/admissions/stats 500 fix | 2 new regression tests, 3 missing columns added (discharge_initiated, discharge_initiated_at, discharge_approved) |
| `b2ce419c` | Wire up 5 admin monitor endpoints (Phase 1) | 19 new tests |
| `5dbf7cfd` | Wire up 19 orphan admin pages (Phase 2) | 19 new tests |
| `159a98f8` | Honest progress.md verification entry | doc only |
| `9787944c` | Spec doc for sub-project 1 (boundary tests) | doc only |
| `e443424f` | Plan doc for sub-project 1 | doc only |
| `64134c3c` | IPD monitor boundary tests | 3 new tests |
| `11d507ea` | OPD monitor boundary tests | 3 new tests |
| `4937f309` | Dashboard empty-tenant paths | 3 new tests |
| `d5f7c464` | Diagnostic monitor boundary tests | 2 new tests |
| `86253e00` | Pharmacy monitor boundary tests | 3 new tests |
| `6c4dee62` | Alerts/tasks empty paths | 2 new tests |
| `55c31975` | Discount references boundary tests | 2 new tests |
| `dde27645` | Audit/financial/alerts-detect empty paths | 3 new tests |
| `1ad0262b` | Detail routes boundary tests | 5 new tests |
| `b77604b9` | Sub-project 1 progress entry | doc only |
| `7e655ed1` | Spec for auth boundary fix | doc only |
| `4ac15740` | Spec fix (route counts) | doc only |
| `c1bd2f75` | Plan for auth boundary fix | doc only |
| `707ffbb0` | RED auth boundary tests | 4 new tests |
| `b8b43d8f` | Drop super_admin block | fix |
| `9a97647f` | Add 34 per-route requireRole guards | fix |
| `fc0c346e` | Progress entry for auth fix | doc only |

**Total shipped**: 22 commits, 3 specs, 2 plans, 8 docs, 9 source
fixes. 68/68 admin tests green. 13,645/13,673 backend tests
passing (28 pre-existing failures unchanged).

## Sub-projects 2 & 3 (out of scope, deferred)

- **Sub-project 2**: Frontend mock-data verification (Vitest component
  tests with mocked `useApiQuery`)
- **Sub-project 3**: Playwright E2E (browser-driven admin flow tests)

Both can be done as separate slices per the same plan/spec pattern
when needed.

## How to resume

When picking this up, start with P0 (GAP-1 admissions role-check) and
work down. The recommended next slice is a 1-2 hour focused fix on
GAP-1 with brainstorming + TDD plan.

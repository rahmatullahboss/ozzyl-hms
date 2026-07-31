# Ozzyl HMS Admin Panel Progress

This short checkpoint log tracks implementation work against the canonical specification in [ozzyl-admin-panel-blueprint.md](./ozzyl-admin-panel-blueprint.md).

## Checkpoints

### 2026-05-27 - Blueprint Baseline

- Status: Complete
- Recorded the enterprise Admin Panel blueprint as the implementation source of truth.
- Established this log for future admin-panel audit, implementation, and verification checkpoints.

### 2026-06-05 - Control Room Visibility Slice

- Status: In progress
- Improved the first admin control-room slice in `web/src/pages/HospitalAdminDashboard.tsx`.
- Reception monitoring is now always visible, even when no counter is active, and summarizes active counters, expected cash, pending handover cash, today collection, cash-in, cash-out, and live counter rows.
- Added doctor-wise daily visibility from the daily collection report: patients, tests, commission, and net hospital income.
- Fixed `web/src/pages/SystemAuditLog.tsx` so it consumes the real `/api/audit/logs` `auditLogs` response, removes demo fallback rows, and renders readable action, area, record, and detail summaries.
- Added regression coverage in `web/src/pages/HospitalAdminDashboard.test.tsx` and `web/src/pages/SystemAuditLog.test.ts`.
- Verification note: `pnpm` is not available in the current shell, so targeted web tests were run with the bundled Node runtime via `node ./node_modules/vitest/vitest.mjs run ...`.

Remaining admin-panel A-Z improvement backlog:

- Add handover drill-down cards by cashier, receiver, variance, and unresolved handovers.
- Add doctor commission views for today, yesterday, this month, and doctor-level detail.
- Add test/referrer commission visibility by doctor, test, cashier, and collection status.
- Add hospital net income breakdown by OPD, lab, pharmacy, IPD, expense, discount, due, advance, and commission.
- Add reception activity timeline for bills, cancellations, refunds, due collection, deposits, and handovers.
- Add cleaner security/audit filters for user, module, action, date, and risk type.
- Add admin report shortcuts that land directly on filtered finance, commission, handover, and reception reports.

### 2026-06-05 - Admin Transaction Control Center

- Status: Complete
- Added `web/src/pages/AdminTransactionControlCenter.tsx` and routed it at `/h/:slug/transaction-control`.
- Dashboard now includes a direct `Transaction Control` admin quick action.
- The control center consolidates existing transaction sources without adding new storage: dashboard finance, active counters, pending handovers, doctor commission payables, security alerts, and daily collection.
- Admin can now monitor cash in hand, pending handover cash, doctor commission payable, net hospital income, patient due, patient advance, posting queue, cancellation risk, and audit risk from one page.
- Management actions route directly to operational pages: pending handovers, live counters, commission settlement, billing due, deposits, billing cancellation, accounting queue, and system audit.
- Added regression coverage in `web/src/pages/AdminTransactionControlCenter.test.tsx` and extended `web/src/pages/HospitalAdminDashboard.test.tsx`.
- Verification: targeted Vitest suite passed for transaction control, admin dashboard, and system audit; `tsc --noEmit --project web/tsconfig.json` passed.

### 2026-06-11 - Tenant-Safe Admin Command Center

- Status: Core release ready; full blueprint remains in progress.
- Made the new command-center dashboard the default landing page for `hospital_admin`.
- Added role-aware dashboard routing so doctor, nurse, and MD users are redirected to their own workspaces instead of seeing the hospital-admin dashboard.
- Replaced super-admin-only `/api/admin/*` calls used by exposed admin screens with tenant-scoped APIs.
- Connected pending approval approve/reject actions to the real approval review endpoint.
- Preserved separation of duties: a requester cannot approve their own request.
- Corrected dashboard financial contracts:
  - Today expense includes approved expenses only.
  - Discount, OPD, refund, payment-method, revenue, and audit widgets consume their real backend response shapes.
  - Audit links preserve the active tenant slug.
- Removed unsupported prototype pages from the sidebar and redirected old deep links to the closest working canonical page.
- Kept the sidebar at nine compact primary groups.
- Commit: `50a1fe11 fix(admin): wire control center to tenant APIs`.
- Verification:
  - Admin frontend tests: 67 passed.
  - Approval/refund/dashboard backend contract tests: 33 passed.
  - Additional billing/refund/approval regression tests: 56 passed.
  - `pnpm --filter web build` passed.
  - Production Wrangler normal and strict dry-runs passed with the existing `sqlite_classes` configuration warning.
  - Unauthenticated browser smoke test confirmed protected admin routes redirect to `/login` without console errors.

### 2026-06-11 - Admin Monitor Wire-Up (Phase 1 fixes)

- Status: Complete.
- TDD-driven fixes for the 5 admin monitor pages that loaded but displayed zeros because
  the backend response shape did not match what the frontend expected. Commit:
  `b2ce419c fix(admin): wire up admin monitor endpoints with frontend contract`.
- `/api/admissions/stats` — wrapped response in `{stats, wards[], admissions[], dischargePending[]}`,
  added bed-status-by-ward mapping and active-admission join. `IPDMonitor.tsx` now renders
  Total Beds, Occupied, Available, Occupancy %, Discharges Today, Avg Stay, Bed Map, Patient List,
  and Discharge Pending.
- `/api/queue/tokens/overview` — unwrapped `{Results: {...}}` to root-level `{tokens, stats, delayedDoctors}`,
  remapped snake_case stats to camelCase, added delayed-doctors query (waiting > 30 min). `OPDMonitor.tsx`
  now shows live tokens and delayed doctor cards.
- `/api/lab/orders/queue/today` — wrapped the existing `{queue, date}` payload in
  `{stats, items, criticalAlerts}` and aggregated status counters. `DiagnosticMonitor.tsx`
  now shows test counts, queue items, and critical alerts.
- `/api/pharmacy/summary` — extended existing payload with `todaySales`, `todaySalesCount`,
  `grossMargin` so `PharmacyMonitor.tsx` renders real pharmacy KPIs.
- `/api/admin/alerts` (NEW, tenant-scoped) — exception alerts grouped from canceled bills,
  high-discount bills, and low-stock medicines, with severity summary. Wires up
  `AlertsExceptions.tsx` which was previously orphaned.
- `/api/admin/tasks` (NEW, tenant-scoped) — operational follow-ups aggregated from
  pending patient due, pending refund (credit note) requests, and pending expense requests,
  with overdue detection (>3 days). Wires up `TasksFollowups.tsx` which was previously orphaned.
- `/web/src/App.tsx` — registered `AlertsExceptions` and `TasksFollowups` routes; the previous
  `TenantRedirect path="dashboard"` sent both to the dashboard so users could never reach them.
- Tests added (6 new files, 19 tests, all green):
  - `test/admin-ipd-monitor-stats.test.ts` (4)
  - `test/admin-opd-monitor-queue.test.ts` (2)
  - `test/admin-dashboard-stats.test.ts` (7) — pins the existing contract
  - `test/admin-pharmacy-monitor.test.ts` (1)
  - `test/admin-diagnostic-monitor.test.ts` (2)
  - `test/admin-alerts-tasks.test.ts` (2)
- Updated `test/integration/routes/admissions.test.ts` to assert the new nested stats shape.
- Verification:
  - `npx vitest run test/admin-*` — 7 files, 19/19 passed.
  - `npx tsc --noEmit` (web) — clean.
  - `npx vitest run web/src/pages/admin/AlertsExceptions.test.tsx web/src/pages/admin/TasksFollowups.test.tsx` — 16/16 passed.
  - Full backend suite: 13,596 passed / 28 pre-existing failures (idempotency, bed-charges, schemas) — none caused by this slice. (Subsequent Phase 2 entry re-ran the same suite and saw 13,615 passed — the extra 19 are the new Phase 2 backend tests.)

### 2026-06-11 - Admin Orphan-Page Wire-Up (Phase 2)

- Status: Complete.
- 19 admin pages were orphaned in `web/src/pages/admin/` (buildable but not registered
  in `web/src/App.tsx`, so users could not reach them via the sidebar). Commit:
  `5dbf7cfd fix(admin): wire up 19 orphan admin pages + remove PIN requirement`.
- Replaced `TenantRedirect` stubs with real page components and added matching
  tenant-scoped backend endpoints with TDD coverage:
  - `DiscountReferenceAnalytics` → `/api/admin/discount-references`
    (reference-wise + staff-wise aggregation of `bills.discount_by_name`,
    last 90 days, supports the "no-PIN, monitor only" model).
  - `AuditExplorer` → `/api/admin/audit`
  - `FinancialAudit` → `/api/admin/audit/financial`
  - `ExportHistory` → `/api/admin/export-history`
  - `LoginSessions` → `/api/admin/sessions`
  - `SuspiciousActivities` → `/api/admin/alerts/detect` (high-discount-frequency,
    refund-spike, stock-manipulation rules)
  - `HospitalProfileAdmin` → `/api/admin/hospital-profile`
  - `ApprovalPolicies` → `/api/admin/approval-policies`
  - `EscalationRules` → `/api/admin/escalation-rules`
  - `NotificationSettings` → `/api/admin/notifications/rules`
  - `DueReceivables` → `/api/admin/due-receivables` (with aging buckets)
  - `InventoryAlerts` → `/api/admin/inventory/alerts` (out-of-stock / low /
    near-expiry / expiring-soon)
  - `CollectionFollowup` → `/api/admin/collection-followups`
  - `PatientRecordAccess` → `/api/admin/patient-record-access`
  - `DoctorPayoutDetail` → `/api/admin/doctor-payout/:id`
  - `RefundRequestDetail` → `/api/admin/refunds/:id`
  - `ExpenseDetailPage` → `/api/admin/expenses/:id`
  - `CashDrawerDetail` → `/api/admin/cash-drawers/:id`
  - `ShiftHandoverDetail` → `/api/admin/shift-handover/:id`
- Renamed admin `HospitalProfile` to `HospitalProfileAdmin` to avoid collision
  with the marketplace `HospitalProfile` component.
- Progress doc updated: removed "per-manager authorization PINs" and "dual
  approval" items from P0; the discount authorization model is explicitly
  **reference-based only** — admin monitors the reference field, not a PIN flow.
- Tests added: `test/admin-discount-references.test.ts` (1),
  `test/admin-audit-explorer-routes.test.ts` (5),
  `test/admin-detail-routes.test.ts` (13) — all 19 green.
- Verification:
  - `npx vitest run test/admin-*` — 10 files, 38/38 passed.
  - `npx tsc --noEmit` (web) — clean.
  - `npx vitest run web/src/pages/admin` — 211/212 passed
    (1 pre-existing failure in `AdminTransactionControlCenter.test.tsx`,
    unrelated to this slice).
  - Full backend suite: 13,615 passed / 28 pre-existing failures (idempotency,
    bed-charges, collection-report-reconciliation, race-condition, inventory
    FIFO, schemas, tenant-states, schema-boundaries, financial-accuracy,
    patient-ai-planner, pharmacy-bridge, local-schema-sync) — none caused
    by this slice, verified by stashing the work and re-running.

### 2026-06-11 - Admin Endpoint Boundary Test Coverage (Sub-project 1 of 3)

- Status: Complete. Spec:
  `docs/superpowers/specs/2026-06-11-admin-integration-coverage-design.md`.
  Plan: `docs/superpowers/plans/2026-06-11-admin-integration-coverage.md`.
- Expanded the 19 admin endpoint tests from 38 happy-path tests to **64
  boundary + error-path tests** across the 9 existing admin test files.
  No new test files; the 9 files were extended in place.
- Test categories added per endpoint: empty-data, tenant auth boundary
  (empty tenantId → 401/403 from `requireTenantId`), invalid ID format
  (non-numeric `:id` returns 200/400, not 500), date filter (explicit
  `?date=` returns 200), and single-row boundary.
- Surfaced and noted real-world observations:
  - `createMockDB` `universalFallback: true` mode returns a generic row
    for `.first()`/`.all()` on empty tables, so summary counts may be
    1 instead of 0 in tests that use this mode. The tests pin the
    contract shape (key presence, type) rather than asserting strict
    zero counts.
  - The pre-existing security gap — `src/routes/tenant/admissions.ts`
    has no role-check middleware, so unauthenticated requests with a
    valid tenant pass — is **out of scope** for this slice. The tenant
    boundary (no `tenantId`) is what is actually enforced via
    `requireTenantId`. Closing the role-check gap is a separate slice.
- Verification:
  - `npx vitest run test/admin-*` — 10 files, 64/64 passed.
  - `npx vitest run test/` — 13,641 passed / 28 pre-existing failures
    (none caused by this slice, verified by stashing the work and
    re-running).
  - `npx tsc --noEmit` (project root + `web/`) — no new errors.
- Sub-projects 2 (frontend mock-data verification) and 3 (Playwright
  E2E) remain as separate slices per the spec.

### 2026-06-11 - Admin Auth Boundary Fix (Production Blocker)

- Status: Complete. Spec:
  `docs/superpowers/specs/2026-06-11-admin-auth-boundary-fix-design.md`.
  Plan:
  `docs/superpowers/plans/2026-06-11-admin-auth-boundary-fix.md`.
- Resolved the production blocker identified in the 2026-06-11 admin
  review: the worker middleware at `src/index.ts:408` was returning 403
  to all non-super_admin callers for `/api/admin/*`, blocking the 21
  Phase 1/2 tenant-scoped admin endpoints from hospital_admin users.
- Two-file change:
  1. `src/index.ts` — dropped the blanket super_admin block (worker
     middleware now only enforces auth on `/api/admin/*`). The first
     app.use still enforces auth (login) and the per-route
     `requireRole` guards (added below) enforce role.
  2. `src/routes/admin/index.ts` — added 34 per-route
     `requireRole(...)` guards. 13 super-only routes
     (`/hospitals/*`, `/onboarding/*`, `/impersonate/*`,
     `/audit-logs`, `/system-health`, `/stats`, `/usage`)
     get `requireRole('super_admin')`. 21 tenant-scoped
     route registrations get
     `requireRole('super_admin', 'hospital_admin', 'md',
     'director', 'manager', 'accountant', 'auditor')`.
  - Public routes (`/login`, `/plans`) stay unguarded.
- Risk note: the two commits were applied back-to-back (no
  intermediate deploy) so there was no window in which admin
  endpoints were open without per-route guards.
- Verification:
  - `npx vitest run test/admin-*` — 11 files, 68/68 passed
    (added `test/admin-auth-boundary.test.ts` with 4 boundary tests).
  - `npx vitest run test/` — 13,645 passed / 28 pre-existing
    failures unchanged (no regression from this slice).
  - `npx tsc --noEmit` (project root + `web/`) — clean.
- Pre-existing role-check gaps still out of scope:
  `src/routes/tenant/admissions.ts` has no role middleware; any
  tenant user with a valid JWT can read all admissions data.
  Documented earlier; separate slice needed.

### 2026-06-11 - Production Deployment + Performance Fix

- Status: Deployed to production.
- Commit: `e775ae95` — batch IPD monitor stats queries.
  Replaced 6 sequential `db.$client.prepare().bind().first()/all()`
  calls with a single `db.$client.batch([...])` call in
  `/api/admissions/stats`. All 7 queries now execute in one
  round-trip instead of 6.
- Deploy: `pnpm build && wrangler deploy --env production`
  Version ID: `2a533335-6f4c-4f17-ac54-dd053577f8e4`.
  Production URL: `https://hms-saas-production.rahmatullahzisan.workers.dev`.
- Health check: `GET /api/health` → `{"status":"ok","version":"1.0.0"}`.
- Verification:
  - 7/7 IPD monitor tests pass.
  - 68/68 admin tests pass.
  - 48/49 admissions integration tests pass (1 pre-existing
    idempotency failure, unrelated).
  - Full backend: 13,645/13,673 passing (28 pre-existing).

## Remaining Blueprint Work

The current implementation is a deployable core admin panel, not a claim that every blueprint capability is complete. A page should only be exposed in the sidebar after its tenant API, authorization, audit trail, error handling, and regression tests are working.

### P0 - Financial Safety and Approval Integrity

- [ ] Expand the approval backend beyond `bill_edit`, `bill_cancel`, `discount`, and `refund` to support:
  - Expense approval.
  - Stock adjustment approval.
  - Doctor payout approval.
  - Manual balance adjustment approval.
- [ ] Keep approval types in one shared frontend/backend contract so UI tabs cannot advertise unsupported workflows.
- [ ] Add configurable approval policies by action, branch, department, amount, percentage, and escalation time.
- [ ] Add approval clarification, escalation, partial approval, and suspicious-flag states only after the backend state machine supports them.
- [ ] Replace frontend-derived approval risk levels with backend policy evaluation and persisted risk reasons.
- [ ] Return real approval summary values, including `todayApproved`, high priority, and overdue counts.
- [ ] Enforce reversal-only accounting for posted bills, refunds, expenses, payouts, deposits, and manual adjustments.
- [ ] Require idempotency keys for money-moving approval execution so retries cannot duplicate entries.
- [ ] Enforce accounting-period locks before approval side effects are posted.
- [ ] Verify every approved action updates the business record, accounting event, cash ledger, and audit log atomically or through a recoverable queued workflow.
- [ ] Add reconciliation tests proving dashboard, daily report, cash drawer, accounting, and printed totals remain equal.

### P0 - Discount and Authorization Controls

**Authorization model: reference-based only (no PIN).** Decision confirmed 2026-06-11:
discount authorization relies on a required reference (doctor / staff / external person) above
the configured percentage threshold. The admin panel is read-and-monitor only over this flow;
it does not introduce a per-manager PIN, shared generic PIN, or device-bound authorization.

- [ ] Implement hospital-configurable discount levels:
  - Receptionist self-service limit.
  - Reference-required threshold (receptionist must capture the referring doctor / staff / external person).
  - Admin-review threshold (admin can see and act on the request).
  - Supporting-document threshold.
- [ ] Persist reference, reason, supporting document, receptionist, counter, device, branch, invoice, before/after amount, and request time on every discount row.
- [ ] Support department-, doctor-, package-, and branch-specific discount restrictions.
- [ ] Complete reference-wise and staff-wise discount anomaly analysis using real tenant data.
- [ ] Add regression tests for threshold boundaries, missing references above threshold, and missing attachments above threshold.

### P0 - Supporting Documents and Auditability

- [ ] Connect the existing `DocumentViewer` to discount, refund, bill cancellation, expense, payout, bank deposit, stock adjustment, purchase invoice, and corporate billing workflows.
- [ ] Store sensitive files in R2 and serve them through short-lived signed or authorized download routes.
- [ ] Add immutable document version history; replacing a file must not delete the previous version.
- [ ] Record uploader, upload time, document type, related record, replacement reason, device, and branch.
- [ ] Add attachment preview, zoom, rotate, download, related-record navigation, unclear-document flagging, and upload history.
- [ ] Enforce configurable missing-attachment rules on the backend, not only in the UI.
- [ ] Prevent logs and audit metadata from exposing document URLs, tokens, or patient-sensitive content.

### P1 - Dashboard Blueprint Completion

- [ ] Align the six KPI cards with the blueprint:
  - Total Collection.
  - Approved Expense.
  - Outstanding Due.
  - Approved Refund Amount.
  - OPD Patients.
  - IPD Occupancy and available beds.
- [ ] Add secondary KPI information such as yesterday comparison, pending expense/refund count, new due, waiting queue, and available beds.
- [ ] Make every KPI card open the correct filtered detail page.
- [ ] Add branch and date-range controls with the selected scope applied consistently to every widget.
- [ ] Add dashboard refresh time, manual refresh, export summary, dashboard customization, and fullscreen controls.
- [ ] Expand revenue trends to today-hourly, 7 days, 30 days, and yearly views.
- [ ] Add revenue filters for OPD, diagnostic, pharmacy, IPD, emergency, and other collection.
- [ ] Complete payment-method groups for corporate credit and other MFS.
- [ ] Expand Action Required into separate filtered counts for discount, refund, expense, cancellation, shortage/dispute, and low-stock workflows.
- [ ] Add actionable cash-drawer dispute and handover drill-downs from the dashboard.

### P1 - Cash, Refund, Expense, and Commission Workflows

- [ ] Add cash drawer detail tabs for transactions, handover history, refunds, discounts, expenses, notes, and audit history.
- [ ] Add shift-handover detail with denomination count, outgoing/incoming staff, variance, dispute notes, supervisor resolution, and acceptance history.
- [ ] Complete daily collection reconciliation by counter, department, payment method, and user.
- [ ] Add PDF, Excel, print, and email exports with export audit records.
- [ ] Complete refund detail with service-delivery status, prior patient/staff refund history, attachment, partial approval, escalation, and reversal linkage.
- [ ] Add expense overview, pending/approved/rejected tabs, voucher exceptions, categories, recurring expenses, and budget-exceeded controls.
- [ ] Add doctor commission period summaries, doctor detail, patient/service breakdown, discount impact, deduction, payout evidence, and adjustment history.
- [ ] Add patient, IPD, corporate, and doctor due aging with follow-up status.

### P1 - Access, Security, and Investigation

- [ ] Add branch-manager, accounts-manager, auditor, and read-only owner interface variants with least-privilege menus and actions.
- [ ] Add branch-, department-, amount-, time-, export-, audit-, and patient-record-specific permission constraints.
- [ ] Complete login session management: force logout, block device, trust device, and investigate user.
- [ ] Add purpose-based patient-record access controls and a dedicated access history view.
- [ ] Complete Audit Explorer filters for date, user, role, branch, department, counter, event, invoice, patient, amount, IP, device, severity, and approval status.
- [ ] Add before/after detail views with sensitive-field redaction.
- [ ] Implement a configurable suspicious-activity engine for high discount frequency, unusual references, refund spikes, repeated cancellation, cash shortages, night export, stock manipulation, and bulk patient access.
- [ ] Add alert assignment, investigation notes, resolution, escalation, and audited user suspension.
- [ ] Add export history containing report, format, filters, row count, user, device, and IP.

### P2 - Operations, Reports, and Settings

- [ ] Complete overdue and exception views for OPD, lab, IPD, OT, pharmacy, emergency, and telemedicine monitoring.
- [ ] Add inventory low-stock/expiry workflows, disposal evidence, purchase requests, supplier context, and stock-movement history.
- [ ] Complete executive, revenue, department, doctor, patient, inventory, and branch analytics with consistent filters.
- [ ] Add a custom report builder with preview, column selection, saved templates, and audited export.
- [ ] Complete hospital profile and branch/counter/drawer configuration.
- [ ] Add price-change audit history for services, tests, packages, beds, emergency services, tax, and branch-specific prices.
- [ ] Complete notification categories, delivery channels, escalation timing, and failure/retry visibility.
- [ ] Add common admin-page capabilities where operationally needed: breadcrumb, saved filters, column visibility, pagination, export, print, bulk selection, and right-side history/detail drawer.

### Deployment and Maintenance

- [ ] Push the local `main` commits before production deployment so the deployed revision is recoverable from the remote repository.
- [ ] Resolve the Wrangler `sqlite_classes` warning and verify the existing Durable Object migration history before changing migration configuration.
- [ ] Update Wrangler from `4.93.0` only after confirming compatibility with the current production bindings and Durable Object migration state.
- [ ] After production deployment, smoke-test dashboard, approvals, audit, cash drawers, refunds, discounts, expenses, reports, and role redirects using non-sensitive test records.
- [ ] Verify production logs contain no tokens, signed URLs, patient details, or financial request payloads.
- [ ] Update this progress document after each completed slice with files changed, tests run, deployment status, and remaining gaps.

## Verification Notes and Caveats

### 2026-06-11 - Re-verification of earlier 2026-06-11 Tenant-Safe entry claims

The earlier checkpoint (commit `50a1fe11`, "Tenant-Safe Admin Command Center") recorded
the following verification lines (verbatim from line 60-65):

> - Admin frontend tests: 67 passed.
> - Approval/refund/dashboard backend contract tests: 33 passed.
> - Additional billing/refund/approval regression tests: 56 passed.
> - `pnpm --filter web build` passed.
> - Production Wrangler normal and strict dry-runs passed with the existing `sqlite_classes` configuration warning.
> - Unauthenticated browser smoke test confirmed protected admin routes redirect to `/login` without console errors.

**Caveats discovered during the Phase 1 / Phase 2 wire-up work on the same day (2026-06-11):**

- The "Additional billing/refund/approval regression tests: 56 passed" claim is
  **likely over-reported** for the current `main` revision. As of
  2026-06-11 (post-Phase-2), the following tests in the billing/refund/approval
  surface area are failing and were already failing before any wire-up work:
  - `test/unit/bed-charges.test.ts` — 7 failures (`calculatePackageBedCharge`
    rate boundaries, `calculateAdmissionPackageBilling` package-plus-bed math).
  - `test/integration/routes/collection-report-reconciliation.test.ts` —
    3 failures (orphan-commission accruals, payment-method label
    normalization, payments-vs-cash-ledger shares).
  - `test/integration/routes/admissions.test.ts` — 1 failure (idempotency
    replay returns 409 instead of 201).
  - `test/integration/routes/audit-action-allowlist.test.ts` — 1 failure
    (canonical audit-action values not enforced at all `createAuditLog` sites).
  - `test/race-condition-fixes.test.ts` — 1 failure (payment re-read guard
    and atomic `WHERE paid = ?` check on bill update not yet implemented).
  The original author of `50a1fe11` should re-run these tests against that
  commit to confirm whether they were already broken or regressed in a later
  commit.
- The "Production Wrangler normal and strict dry-runs passed" claim was **not
  independently re-verified** by the Phase 1 / Phase 2 wire-up work. Only
  code-level verification (`vitest`, `tsc --noEmit`) was performed; no
  `wrangler deploy --env production` was executed.
- The "Unauthenticated browser smoke test" line refers to manual / external
  verification, not a vitest assertion. The Phase 1 / Phase 2 work did not
  re-run a browser-based smoke test.
- The "Admin frontend tests: 67 passed" and "Approval/refund/dashboard
  backend contract tests: 33 passed" numbers were likewise not independently
  re-counted during Phase 1 / Phase 2; they are taken on trust from the
  prior entry. The new admin test files added by Phase 1 / Phase 2 do
  bring the count up — see the "Verification" sub-list in the Phase 1
  and Phase 2 checkpoint entries above for the actual numbers observed.

**Net current test status on `main` (2026-06-11, post-Phase-2):**

| Surface | Passed | Failed | Notes |
|---|---|---|---|
| `test/admin-*` (this slice) | 38 | 0 | 10 files, all green |
| `web/src/pages/admin` | 211 | 1 | 1 pre-existing failure in `AdminTransactionControlCenter.test.tsx` |
| Full backend suite | 13,615 | 28 | 14 pre-existing files; none caused by Phase 1 / Phase 2 |

The 28 pre-existing backend failures are explicitly listed in the
"## Remaining Blueprint Work → Pre-existing test failures not yet addressed"
section below.

### Pre-existing test failures not yet addressed (as of 2026-06-11)

These were failing before Phase 1 / Phase 2 and remain failing afterwards.
Fixing them is a separate, larger slice of work and is **out of scope** for
the admin wire-up PRs:

- `test/integration/routes/admissions.test.ts` — 1: idempotency replay
  returns 409 instead of 201 (replay-path middleware missing).
- `test/integration/routes/audit-action-allowlist.test.ts` — 1: some
  `createAuditLog` call sites use non-canonical action values.
- `test/integration/routes/collection-report-reconciliation.test.ts` — 3:
  collection report needs commission-accrual cleanup, payment-method label
  normalization, and cash-ledger vs payments join fix.
- `test/integration/routes/inventory/inventory-dispatch-fifo.test.ts` — 3:
  FEFO multi-batch allocation not implemented; explicit `StockId` should
  bypass FEFO.
- `test/integration/routes/inventory/inventory-transfer-fifo.test.ts` — 2:
  same FEFO gap as dispatch.
- `test/integration/routes/inventory/pharmacyBridge.test.ts` — 1:
  `unified-low-stock` returns rows where mock expected empty.
- `test/integration/routes/patient-ai-planner.test.ts` — 1: tracker-item
  suggestions not surfacing the latest AI plan to the wellness hub.
- `test/integration/data-integrity/financial-accuracy.test.ts` — 1: bill
  total with multiple items off by some tax/quantity combination.
- `test/integration/edge-cases/schema-boundaries.test.ts` — 2: billing and
  patient validation boundaries.
- `test/integration/edge-cases/tenant-states.test.ts` — 1: empty
  `tenantId` on patient creation should be 403.
- `test/local-schema-sync-cloud-routes.test.ts` — 1: sync schema manifest
  endpoint not returning migrations list.
- `test/race-condition-fixes.test.ts` — 1: payment race-condition guard
  (re-read + atomic `WHERE paid = ?`).
- `test/unit/bed-charges.test.ts` — 7: bed-charge package math, per-day
  rate, included-day boundaries.
- `test/unit/schemas.test.ts` — 2: patient schema validation boundaries
  (optional `bloodGroup` not honored, valid-patient data rejected).


# Admin Dashboard Shell and Period Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Follow TDD and preserve unrelated work.

**Goal:** Replace the long, always-loaded admin dashboard with a URL-addressable Admin Command Center shell whose workspace, reporting period, and open drill context survive refresh and browser navigation; ensure every visible panel clearly follows the selected period or declares itself live/current.

**Architecture:** Keep `/h/:slug/dashboard` as the route. Move shared filter ownership into a small command-center state hook backed by URL query parameters. Split the 875-line `KPISummaryCards.tsx` into workspace compositions that reuse existing KPI and analytics components. Load only the active workspace. Do not change source-of-truth financial formulas in this plan.

**Tech Stack:** React, React Router, React Query hooks, TypeScript, Vitest, Testing Library.

## Global constraints

- ACC-00 semantic foundation must be merged first; this plan consumes its shared types, metric registry, source-health semantics, and `admin_command_center_v2` feature flag.
- Start from reviewed local `main` in a dedicated worktree.
- Preserve all unrelated changes and do not reset, clean, or stash another task.
- No backend financial formula changes in this plan.
- Existing URLs without query parameters must continue to open Today/Overview.
- Existing MD and Director dashboards are not migrated in this plan.
- Existing `DashboardKpiConfigurator` data remains valid.
- Active-workspace queries only; hidden workspaces must not fetch their heavy panel endpoints.
- The shell must distinguish selected-period and live/current panels.
- All tab and drawer state must be accessible by URL and browser Back.

---

## Task 1: Add URL-state contract tests

**Files:**

- Create: `web/src/pages/admin/command-center/commandCenterUrlState.test.ts`
- Create: `web/src/pages/admin/command-center/commandCenterUrlState.ts`

**Interfaces:**

```ts
export type CommandCenterTab =
  | 'overview'
  | 'money'
  | 'doctors'
  | 'patients'
  | 'ipd'
  | 'diagnostics'
  | 'inventory'
  | 'audit';

export interface CommandCenterUrlState {
  tab: CommandCenterTab;
  filters: ExecutiveDashboardFilters;
  dateBasis?: ReportingDateBasis;
  doctorId?: number;
  testId?: number;
  invoiceId?: number;
}
```

- [ ] Write tests for an empty query resolving to `overview` and Today.
- [ ] Write tests for all supported tabs.
- [ ] Write tests for custom `from` and `to` dates.
- [ ] Write tests rejecting an invalid date pair and falling back to Today.
- [ ] Write tests rejecting zero, negative, fractional, and non-numeric IDs.
- [ ] Write tests preserving unknown query keys during updates.
- [ ] Write tests that opening an invoice adds only `invoiceId`.
- [ ] Write tests that closing an invoice removes only `invoiceId`.
- [ ] Write tests that opening doctor 17 sets `tab=doctors&doctorId=17`.
- [ ] Run and verify RED:

```bash
pnpm --dir web exec vitest run src/pages/admin/command-center/commandCenterUrlState.test.ts
```

- [ ] Implement pure parsing and serialization helpers.
- [ ] Run and verify GREEN.

**Commit:**

```bash
git add web/src/pages/admin/command-center/commandCenterUrlState.ts web/src/pages/admin/command-center/commandCenterUrlState.test.ts
git commit -m "feat(admin-dashboard): define command center URL state"
```

---

## Task 2: Introduce the command-center shell and workspace tabs

**Files:**

- Create: `web/src/pages/admin/command-center/AdminCommandCenter.tsx`
- Create: `web/src/pages/admin/command-center/CommandCenterTabs.tsx`
- Create: `web/src/pages/admin/command-center/CommandCenterHeader.tsx`
- Create: `web/src/pages/admin/command-center/AdminCommandCenter.test.tsx`
- Modify: `web/src/pages/admin/Dashboard.tsx`

**Interfaces:**

```ts
interface CommandCenterWorkspaceProps {
  filters: ExecutiveDashboardFilters;
  onFiltersChange: (filters: ExecutiveDashboardFilters) => void;
  openInvoice: (billId: number) => void;
}
```

- [ ] Write a flag-off test that the existing admin dashboard composition remains active.
- [ ] Write a flag-on test that `/dashboard` renders the new Overview.
- [ ] Write a test that `?tab=doctors` renders Doctors and does not render Money.
- [ ] Write a test that selecting a tab updates the URL without dropping period filters.
- [ ] Write a test that browser navigation restores the previous tab.
- [ ] Write keyboard navigation tests for the tab list.
- [ ] Write a mobile rendering test that workspace navigation remains labeled.
- [ ] Run and verify RED.
- [ ] Implement the page shell using the existing `DashboardLayout`.
- [ ] Keep the current dashboard as the flag-off fallback until parity and pilot evidence are approved.
- [ ] Keep `Dashboard.tsx` as a thin flag-aware route component that selects the current composition or `AdminCommandCenter`.
- [ ] Use lazy components or active-tab conditionals so hidden workspaces are not mounted.
- [ ] Add a visible selected-period label in the header.
- [ ] Add a visible Live indicator area for current-state widgets.
- [ ] Run and verify GREEN.

**Commit:**

```bash
git add web/src/pages/admin/Dashboard.tsx web/src/pages/admin/command-center
git commit -m "feat(admin-dashboard): add modular command center shell"
```

---

## Task 3: Extract the Overview workspace

**Files:**

- Create: `web/src/pages/admin/command-center/workspaces/OverviewWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/OverviewWorkspace.test.tsx`
- Create: `web/src/pages/admin/command-center/components/OverviewKpiGrid.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`

**Interfaces:**

The Overview requests only its enabled KPI card metrics and renders no more than ten primary cards.

- [ ] Write a test that the default Overview has at most ten KPI cards.
- [ ] Write a test that doctor, test, income, expense, reagent, inventory, and radiology detail panels are not mounted in Overview.
- [ ] Write a test that KPI drilldown remains functional.
- [ ] Write a test that the existing PDF Center and Daily Pack actions remain available.
- [ ] Run and verify RED.
- [ ] Extract reusable KPI query/drill state from `KPISummaryCards` into focused hooks/components.
- [ ] Keep the existing KPI summary and breakdown endpoints.
- [ ] Preserve `DashboardKpiConfigurator`; map configured metrics to their appropriate workspace.
- [ ] Remove only code made obsolete by the workspace extraction.
- [ ] Run and verify GREEN.

**Commit:**

```bash
git add web/src/pages/admin/command-center/workspaces/OverviewWorkspace.tsx web/src/pages/admin/command-center/workspaces/OverviewWorkspace.test.tsx web/src/pages/admin/command-center/components/OverviewKpiGrid.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx
git commit -m "refactor(admin-dashboard): extract compact overview workspace"
```

---

## Task 4: Create remaining workspace compositions

**Files:**

- Create: `web/src/pages/admin/command-center/workspaces/MoneyWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/DoctorsWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/PatientsWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/IPDWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/DiagnosticsWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/InventoryWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/AuditWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/workspaces.test.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`

**Workspace ownership:**

- Money: management financial cards, income, expense, cash control, cash breakdown, trend, payment methods
- Doctors: doctor performance and doctor detail
- Patients: placeholder route-safe workspace until the patient-age plan completes; it links to existing Reports rather than calling a nonexistent API
- IPD: `IPDBillingOverview` and existing due controls
- Diagnostics: test performance, lab income, reagent reconciliation
- Inventory: inventory and radiology stock controls
- Audit: audit feed, staff activity links, financial reconciliation warnings

- [ ] Write tests that each configured panel appears only in its assigned workspace.
- [ ] Write tests that inactive workspaces do not call their panel endpoints.
- [ ] Write tests that switching back restores the period and page-level filters.
- [ ] Write tests that Patients does not request `/api/admin/analytics/patients`.
- [ ] Run and verify RED.
- [ ] Move compositions without copying business logic.
- [ ] Keep shared drawer state at the shell where necessary.
- [ ] Keep doctor/test local pagination inside their workspace.
- [ ] Run and verify GREEN.

**Commit:**

```bash
git add web/src/pages/admin/command-center/workspaces web/src/pages/admin/widgets/KPISummaryCards.tsx
git commit -m "refactor(admin-dashboard): split command center workspaces"
```

---

## Task 5: Propagate the selected period and label live widgets

**Files:**

- Modify: `web/src/pages/admin/widgets/RevenueTrendChart.tsx`
- Modify: `web/src/pages/admin/widgets/RevenueTrendChart.test.tsx`
- Modify: `web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx`
- Create or modify: `web/src/pages/admin/widgets/PaymentMethodBreakdown.test.tsx`
- Modify: `web/src/pages/admin/widgets/OperationsSnapshot.tsx`
- Modify: `web/src/pages/admin/widgets/LiveCashDrawerWidget.tsx`
- Modify: `web/src/pages/admin/widgets/AuditFeedWidget.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/MoneyWorkspace.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/OverviewWorkspace.tsx`

**Rules:**

- Revenue trend and payment methods receive the shared selected period.
- Current drawer cash, current stock, active counters, and latest audit feed remain live and display `Live/current state`.
- A historical selected period never changes a current-state balance into a historical claim.

- [ ] Write tests that Revenue Trend receives `startDate` and `endDate` in its request.
- [ ] Write tests that Payment Method Breakdown receives the selected range.
- [ ] Write tests that live widgets display a Live/current-state label.
- [ ] Write tests that the header clearly distinguishes selected-period panels from live widgets.
- [ ] Run and verify RED.
- [ ] Change widget props and query keys to include the selected range.
- [ ] Do not add new SQL in this task; use temporary existing range-capable routes only where verified. When a route lacks range support, render the widget as Today-only with an explicit Today label until the financial-control plan adds the endpoint.
- [ ] Run and verify GREEN.

**Commit:**

```bash
git add web/src/pages/admin/widgets web/src/pages/admin/command-center/workspaces
git commit -m "feat(admin-dashboard): align period and live widget semantics"
```

---

## Task 6: Responsive and accessibility hardening

**Files:**

- Modify: `web/src/pages/admin/command-center/CommandCenterTabs.tsx`
- Modify: `web/src/pages/admin/command-center/AdminCommandCenter.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/*.tsx`
- Create: `web/src/pages/admin/command-center/AdminCommandCenter.a11y.test.tsx`
- Modify: `web/src/index.css` only if existing utility classes cannot satisfy the page override

- [ ] Test visible labels and focus states for every workspace control.
- [ ] Test no icon-only top-level navigation.
- [ ] Test active tab semantics.
- [ ] Test focus moves to the workspace heading after keyboard tab change.
- [ ] Test 375 px composition does not require a page-level horizontal scroll.
- [ ] Respect reduced motion.
- [ ] Run focused accessibility tests.

**Commit:**

```bash
git add web/src/pages/admin/command-center web/src/index.css
git commit -m "fix(admin-dashboard): harden command center accessibility"
```

---

## Task 7: Regression verification

- [ ] Run focused frontend tests:

```bash
pnpm --dir web exec vitest run \
  src/pages/admin/command-center \
  src/components/dashboard/ExecutiveDashboardRangeFilter.test.tsx \
  src/pages/admin/widgets/KPISummaryCards.test.tsx \
  src/pages/admin/widgets/RevenueTrendChart.test.tsx
```

- [ ] Run dashboard route/render tests:

```bash
pnpm --dir web exec vitest run src/pages/admin/Dashboard.test.tsx src/pages/MDDashboard.test.tsx src/pages/DirectorDashboard.render.test.tsx
```

- [ ] Run web typecheck and build:

```bash
pnpm --dir web exec tsc --noEmit
pnpm --dir web build
```

- [ ] Inspect all requests in tests and confirm inactive workspaces do not fetch.
- [ ] Inspect the branch diff for unrelated changes.
- [ ] Record any pre-existing failures separately.

If verification requires a task-owned fix, stage only the exact modified command-center or test files shown by `git status`, then commit with `test(admin-dashboard): verify command center shell`.

## Completion evidence

- URL state tests pass.
- Active workspace controls data fetching.
- Today/selected-period/live semantics are visible.
- Overview contains no more than ten primary KPI cards.
- Browser refresh and Back restore state.
- Existing KPI and doctor/test drilldowns remain available.

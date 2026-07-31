# Admin Dashboard Semantic Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans`. Follow TDD and preserve all existing dashboard endpoints during additive migration.

**Goal:** Establish the shared semantic contract required by every Admin Command Center phase: temporal mode, date basis, source health, metric registry and role presets, comparisons, reconciliation, permission/drill metadata, URL filter normalization, and a feature-flag-safe compact overview contract.

**Architecture:** Carry forward the validated 2026-07-22 control-center semantic requirements into a shared package and focused backend dashboard library. This phase does not visually redesign the admin page. It adds versioned contracts and a bounded overview endpoint behind a tenant feature flag while existing dashboard endpoints remain available for parity comparison.

**Tech Stack:** TypeScript, shared package exports, Hono/Cloudflare Workers, D1, React types, Vitest.

## Relationship to earlier plan

This plan supersedes the execution sequence in `docs/superpowers/plans/2026-07-22-admin-dashboard-control-center-implementation.md` while preserving its requirements. Current-main-specific doctor, invoice, and patient work is handled by the later ACC plans.

## Global constraints

- No parallel dashboard ledger.
- `0`, partial, stale, unavailable, and unreconciled remain distinct.
- Every metric declares temporal mode, date basis, source of truth, formula, desirable direction, drill target, and required permission.
- Hospital Admin default has at most ten primary KPI metrics.
- Current tenant KPI overrides remain readable during migration.
- A failed source never becomes a verified zero.
- Comparison periods are server-resolved in Asia/Dhaka.
- Backend enforces permissions.
- New overview is feature-flagged until parity evidence exists.
- Existing `/api/dashboard/stats`, `/kpi-summary`, `/kpi-breakdown`, and analytics endpoints remain compatible.

---

## Task 1: Create shared dashboard semantic types

**Files:**

- Create: `packages/shared/src/dashboard/types.ts`
- Create: `packages/shared/src/dashboard/index.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `test/unit/admin-dashboard-shared-types.test.ts`

**Required types:**

- `DashboardTemporalMode`
- `DashboardDateBasis`
- `DashboardHealthState`
- `DashboardSourceStatus`
- `MetricComparison`
- `MetricTarget`
- `ReconciliationResult`
- `DashboardWarning`
- `DashboardDrillTarget`
- `DashboardMetricDefinition`
- `DashboardMetricResult`
- `AdminDashboardRequest`
- `AdminDashboardOverviewResponse`
- `DashboardPermissionSummary`

- [ ] Write compile/runtime shape tests for required fields.
- [ ] Test money metadata uses BDT major units.
- [ ] Test source status distinguishes complete, partial, stale, and unavailable.
- [ ] Test temporal mode supports period, as-of, and live.
- [ ] Test the shared barrel exports all types.
- [ ] Implement minimal types and run GREEN.

**Commit:**

```bash
git add packages/shared/src/dashboard/types.ts packages/shared/src/dashboard/index.ts packages/shared/src/index.ts test/unit/admin-dashboard-shared-types.test.ts
git commit -m "feat(dashboard): add shared semantic contract"
```

---

## Task 2: Add authoritative metric registry and role presets

**Files:**

- Create: `packages/shared/src/dashboard/metricRegistry.ts`
- Modify: `packages/shared/src/dashboard/index.ts`
- Create: `test/unit/admin-dashboard-registry.test.ts`

**Role presets:**

- `hospital_admin`
- `md_director`
- `accountant`
- `manager_operations`

**Registry requirements:**

- Stable metric key
- Label and description
- Formula
- Value type
- Temporal mode
- Date basis
- Source-of-truth list
- Desirable direction
- Comparison mode
- Reconciliation requirement
- Default roles
- Workspace/section
- Drill route and permission

- [ ] Test unique metric keys.
- [ ] Test every metric has complete semantics.
- [ ] Test Hospital Admin primary preset has no more than ten metrics.
- [ ] Test `uncategorized_income` is not a default primary signal.
- [ ] Test deposits, collections, revenue, drawer cash, and doctor liability use distinct definitions.
- [ ] Test configured legacy metrics can map to a workspace without becoming default primary cards.
- [ ] Implement registry and exports.

**Commit:**

```bash
git add packages/shared/src/dashboard/metricRegistry.ts packages/shared/src/dashboard/index.ts test/unit/admin-dashboard-registry.test.ts
git commit -m "feat(dashboard): add metric registry and role presets"
```

---

## Task 3: Add period/filter normalization and comparison resolution

**Files:**

- Create: `src/lib/dashboard/filter-context.ts`
- Create: `test/unit/admin-dashboard-filter-context.test.ts`

**Interface:**

```ts
export interface DashboardFilterContext {
  request: AdminDashboardRequest;
  period: { startDate: string; endDate: string; label: string };
  comparisonPeriod: { startDate: string; endDate: string; label: string } | null;
  timeZone: 'Asia/Dhaka';
}
```

- [ ] Test Today, Yesterday, This Week, This Month, Last Month, 7D, 30D, and Custom.
- [ ] Test inclusive Asia/Dhaka dates.
- [ ] Test previous-period resolution with equal duration.
- [ ] Test previous-month comparison.
- [ ] Test invalid/missing custom date pairs.
- [ ] Test maximum interactive range of 366 days.
- [ ] Test invalid IDs and unknown date basis.
- [ ] Implement pure request normalization.

**Commit:**

```bash
git add src/lib/dashboard/filter-context.ts test/unit/admin-dashboard-filter-context.test.ts
git commit -m "feat(dashboard): normalize reporting context"
```

---

## Task 4: Add source health and reconciliation helpers

**Files:**

- Create: `src/lib/dashboard/source-status.ts`
- Create: `src/lib/dashboard/reconciliation.ts`
- Create: `test/unit/admin-dashboard-source-status.test.ts`
- Create: `test/unit/admin-dashboard-reconciliation.test.ts`

- [ ] Test complete sources.
- [ ] Test one failed required source yields partial.
- [ ] Test all failed sources yield unavailable.
- [ ] Test stale timestamps.
- [ ] Test failed source cannot return healthy zero.
- [ ] Test exact reconciliation.
- [ ] Test sub-cent tolerance.
- [ ] Test non-zero unexplained difference.
- [ ] Test unavailable detail total.
- [ ] Test full-result totals are independent of pagination.
- [ ] Implement pure helpers with no database access.

**Commit:**

```bash
git add src/lib/dashboard/source-status.ts src/lib/dashboard/reconciliation.ts test/unit/admin-dashboard-source-status.test.ts test/unit/admin-dashboard-reconciliation.test.ts
git commit -m "feat(dashboard): add source health and reconciliation"
```

---

## Task 5: Add comparison helper

**Files:**

- Create: `src/lib/dashboard/comparison.ts`
- Create: `test/unit/admin-dashboard-comparison.test.ts`

- [ ] Test absolute and percentage change.
- [ ] Test zero comparison denominator returns not comparable.
- [ ] Test higher-is-better, lower-is-better, target-range, zero, and neutral interpretation.
- [ ] Test unavailable comparison reason.
- [ ] Test current and comparison periods are labeled.
- [ ] Implement pure helper.

**Commit:**

```bash
git add src/lib/dashboard/comparison.ts test/unit/admin-dashboard-comparison.test.ts
git commit -m "feat(dashboard): add metric comparison semantics"
```

---

## Task 6: Add bounded overview providers

**Files:**

- Create: `src/lib/dashboard/providers/financial.ts`
- Create: `src/lib/dashboard/providers/operations.ts`
- Create: `src/lib/dashboard/providers/domain-health.ts`
- Create: `src/lib/dashboard/admin-overview.ts`
- Create: `test/unit/admin-dashboard-overview-assembler.test.ts`

**Rules:**

- Providers expose data and source status for requested registry metrics only.
- Providers reuse existing source-of-truth query helpers.
- Provider failure is captured as source status/warning and does not crash unrelated domains.
- Overview requests only role-preset primary metrics and compact domain health.
- No doctor/test detail table is returned by overview.

- [ ] Test requested-metric-only provider execution.
- [ ] Test partial domain response.
- [ ] Test no hidden fan-out to all 40 metrics.
- [ ] Test role preset and permission filtering.
- [ ] Test generated timestamp and health rollup.
- [ ] Test metrics include comparison/reconciliation when required.
- [ ] Implement bounded assembler.

**Commit:**

```bash
git add src/lib/dashboard/providers src/lib/dashboard/admin-overview.ts test/unit/admin-dashboard-overview-assembler.test.ts
git commit -m "feat(dashboard): assemble bounded admin overview"
```

---

## Task 7: Add versioned overview route and feature flag

**Files:**

- Create: `src/lib/dashboard/admin-command-center-flag.ts`
- Create: `test/unit/admin-command-center-flag.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Create: `test/integration/routes/admin-dashboard-overview.test.ts`
- Create: `test/integration/routes/admin-dashboard-permissions.test.ts`

**Endpoint:**

```text
GET /dashboard/admin-overview-v2?preset=today
```

**Flag:**

```text
admin_command_center_v2
```

- [ ] Test missing `canonical_feature_flags` returns the safe legacy/disabled state.
- [ ] Test an absent `admin_command_center_v2` row returns disabled.
- [ ] Test the tenant-scoped enabled row activates v2 only for that tenant.
- [ ] Test default flag-off behavior does not change current dashboard consumers.
- [ ] Test authorized flag-on response.
- [ ] Test role preset and field permissions.
- [ ] Test source failure is partial/unavailable, not zero.
- [ ] Test generated timestamp, period, comparison period, source health, warnings, and metrics.
- [ ] Test primary metrics are limited to ten.
- [ ] Test invalid period and permission errors.
- [ ] Implement a thin route using `admin-overview.ts`.
- [ ] Do not remove current endpoints.

**Commit:**

```bash
git add src/lib/dashboard/admin-command-center-flag.ts test/unit/admin-command-center-flag.test.ts src/routes/tenant/dashboard.ts test/integration/routes/admin-dashboard-overview.test.ts test/integration/routes/admin-dashboard-permissions.test.ts
git commit -m "feat(dashboard): add flagged admin overview v2"
```

---

## Task 8: Add frontend shared contract adapter

**Files:**

- Modify: `web/src/types/executiveDashboard.ts`
- Create: `web/src/lib/adminDashboardContract.ts`
- Create: `web/src/lib/adminDashboardContract.test.ts`

- [ ] Test shared response maps to existing UI-compatible values without losing source status.
- [ ] Test unavailable values remain null/unavailable.
- [ ] Test comparison interpretation is preserved.
- [ ] Test warnings and reconciliation are preserved.
- [ ] Test legacy KPI configuration can map metrics to workspaces.
- [ ] Re-export shared types or define narrow frontend view models without duplicating semantic unions.

**Commit:**

```bash
git add web/src/types/executiveDashboard.ts web/src/lib/adminDashboardContract.ts web/src/lib/adminDashboardContract.test.ts
git commit -m "feat(admin-dashboard): consume shared semantic contract"
```

---

## Task 9: Parity and regression verification

- [ ] Run all new unit/integration tests.
- [ ] Run existing dashboard KPI summary and breakdown suites.
- [ ] Compare v2 primary metrics with corresponding existing source totals for controlled fixtures.
- [ ] Verify feature flag off preserves current UI/API behavior.
- [ ] Run root/web typecheck and web build.
- [ ] Inspect query count and payload size for the ten-metric preset.
- [ ] Inspect scoped diff.

**Focused commands:**

```bash
pnpm exec vitest run \
  test/unit/admin-dashboard-shared-types.test.ts \
  test/unit/admin-dashboard-registry.test.ts \
  test/unit/admin-dashboard-filter-context.test.ts \
  test/unit/admin-dashboard-source-status.test.ts \
  test/unit/admin-dashboard-reconciliation.test.ts \
  test/unit/admin-dashboard-comparison.test.ts \
  test/unit/admin-dashboard-overview-assembler.test.ts \
  test/integration/routes/admin-dashboard-overview.test.ts \
  test/integration/routes/admin-dashboard-permissions.test.ts \
  test/integration/routes/dashboard-kpi-summary.test.ts \
  test/integration/routes/dashboard-kpi-breakdown.test.ts

pnpm exec tsc --noEmit
pnpm --dir web exec tsc --noEmit
pnpm --dir web build
```

## Completion evidence

- Shared semantic types and registry exist.
- Role presets and ten-card limit are enforced.
- Period/comparison/source-health/reconciliation contracts are server-owned.
- Flag-off path remains unchanged.
- Versioned overview is bounded and permission-filtered.
- Later ACC plans can consume one semantic contract instead of inventing local variants.

# Admin Dashboard Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-aware hospital admin control center that exposes explicit temporal semantics, source health, comparisons, financial reconciliation, one Action Center, and focused drillthrough without replacing operational ledgers.

**Architecture:** Add a shared semantic contract and metric registry, then expose a versioned compact overview route assembled from bounded domain providers. Migrate the admin page behind tenant feature flags, preserve current endpoints and tenant overrides during parity, and move dense analysis behind dedicated workspaces or optional expansion.

**Tech Stack:** TypeScript 5.9, Hono, Cloudflare Workers, D1/Drizzle, React, TanStack Query through `useApiQuery`, Vitest, Testing Library, Playwright, Tailwind-compatible project CSS, i18next.

## Global Constraints

- Start implementation from a clean reviewed base in an isolated worktree.
- Operational billing, payment, cash, accounting, deposit, commission, IPD, lab, inventory, Action Center, and audit tables remain authoritative.
- Do not create a parallel dashboard ledger.
- Use Asia/Dhaka inclusive business-date semantics.
- A source failure must not display as a verified zero.
- Every financial summary must expose complete-detail reconciliation.
- Current-page rows must not calculate full-result aggregates.
- Live/current values must remain visibly live during historical review.
- The persistent Action Center is the only source of dashboard management actions.
- Unknown payment methods and unmapped services are warnings/exceptions, not normal categories.
- Hospital Admin default must contain no more than 10 primary KPI cards.
- Existing tenant KPI overrides must be preserved.
- Backend enforces tenant and field permissions; hiding columns in React is not security.
- Changes are additive and feature-flagged until parity and pilot gates pass.
- Production mutation, remote migration, production flag changes, and production E2E require separate authorization.
- Use TDD and commit each independently reviewable task.

---

## File Structure

### Shared contract

- Create `packages/shared/src/dashboard/types.ts` — temporal, health, source, comparison, target, warning, drill, permission, and response types.
- Create `packages/shared/src/dashboard/metricRegistry.ts` — authoritative metric definitions and role presets.
- Modify `packages/shared/src/index.ts` — export dashboard contracts.

### Backend service

- Create `src/lib/dashboard/filter-context.ts` — request normalization and comparison-period resolution.
- Create `src/lib/dashboard/source-status.ts` — complete/partial/stale/unavailable aggregation.
- Create `src/lib/dashboard/reconciliation.ts` — financial reconciliation helpers.
- Create `src/lib/dashboard/providers/financial.ts` — billing, collection, due, deposit, expense, payout, and cash/custody provider.
- Create `src/lib/dashboard/providers/operations.ts` — patient-flow and current-capacity provider.
- Create `src/lib/dashboard/providers/domain-health.ts` — compact inventory/lab/reagent/radiology/pharmacy/IPD health.
- Create `src/lib/dashboard/admin-overview.ts` — role-aware overview assembler.
- Modify `src/routes/tenant/dashboard.ts` — versioned overview, metric detail, trend, payment mix, and live-state routes.

### Frontend

- Modify `web/src/types/executiveDashboard.ts` — reuse shared types and URL-backed filter state.
- Create `web/src/lib/dashboardUrlState.ts` — parse/serialize dashboard context.
- Create `web/src/components/dashboard/AdminDashboardContextBar.tsx` — global context and health UI.
- Create `web/src/components/dashboard/DashboardMetricCard.tsx` — decision-grade metric card.
- Create `web/src/components/dashboard/FinancialReconciliationBridge.tsx` — billing/collection/cash/custody bridge.
- Create `web/src/components/dashboard/PatientFlowFunnel.tsx` — period operations flow.
- Create `web/src/components/dashboard/CurrentCapacityStrip.tsx` — live/as-of capacity.
- Modify `web/src/pages/admin/Dashboard.tsx` — control-center composition and feature-flag fallback.
- Modify `web/src/pages/admin/widgets/KPISummaryCards.tsx` — compatibility adapter, then remove duplicate risk surface.
- Modify `web/src/pages/admin/widgets/RevenueTrendChart.tsx` — period-aware explicit trend and accessible table.
- Modify `web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx` — period-aware payment mix and unknown warning.
- Modify `web/src/pages/admin/widgets/LiveCashDrawerWidget.tsx` — visible live status and secondary-source failure handling.
- Modify `web/src/pages/admin/widgets/AuditFeedWidget.tsx` — render server-owned material business events.
- Modify `web/src/components/dashboard/KpiBreakdownDrawer.tsx` — source health, warnings, reconciliation, full-result aggregates, and focus management.

### Tests

- Create `test/unit/admin-dashboard-filter-context.test.ts`.
- Create `test/unit/admin-dashboard-registry.test.ts`.
- Create `test/unit/admin-dashboard-source-status.test.ts`.
- Create `test/unit/admin-dashboard-reconciliation.test.ts`.
- Create `test/integration/routes/admin-dashboard-overview.test.ts`.
- Create `test/integration/routes/admin-dashboard-reconciliation.test.ts`.
- Create `test/integration/routes/admin-dashboard-permissions.test.ts`.
- Create `web/src/components/dashboard/AdminDashboardContextBar.test.tsx`.
- Create `web/src/components/dashboard/DashboardMetricCard.test.tsx`.
- Create `web/src/components/dashboard/FinancialReconciliationBridge.test.tsx`.
- Create `web/src/components/dashboard/PatientFlowFunnel.test.tsx`.
- Modify `web/src/pages/admin/Dashboard.test.tsx`.
- Modify widget tests for trend, payment mix, live cash, audit feed, Action Center, and KPI drawer.
- Create `test/e2e/admin-dashboard-control-center.spec.ts` after local/staging fixture routes exist.

---

### Task 1: Shared Dashboard Semantic Contract and Registry

**Files:**
- Create: `packages/shared/src/dashboard/types.ts`
- Create: `packages/shared/src/dashboard/metricRegistry.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `test/unit/admin-dashboard-registry.test.ts`

**Interfaces:**
- Consumes: no new program interfaces.
- Produces: `AdminDashboardRequest`, `DashboardMetricDefinition`, `DashboardMetricResult`, `DashboardSourceStatus`, `MetricComparison`, `MetricTarget`, `ReconciliationResult`, `DashboardWarning`, `DashboardDrillTarget`, `AdminDashboardOverviewResponse`, `ADMIN_DASHBOARD_METRICS`, and `ADMIN_DASHBOARD_ROLE_PRESETS`.

- [ ] **Step 1: Write the failing registry contract test**

```ts
import { describe, expect, it } from 'vitest';
import {
  ADMIN_DASHBOARD_METRICS,
  ADMIN_DASHBOARD_ROLE_PRESETS,
} from '../../packages/shared/src/dashboard/metricRegistry';

describe('admin dashboard metric registry', () => {
  it('defines complete semantics for every metric and limits the admin primary preset', () => {
    const keys = ADMIN_DASHBOARD_METRICS.map((metric) => metric.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const metric of ADMIN_DASHBOARD_METRICS) {
      expect(metric.fallbackLabel.trim()).not.toBe('');
      expect(metric.description.trim()).not.toBe('');
      expect(metric.formula.trim()).not.toBe('');
      expect(metric.sourceOfTruth.length).toBeGreaterThan(0);
      expect(metric.drillTarget.route.startsWith('/')).toBe(true);
      expect(metric.requiredPermission.trim()).not.toBe('');
    }

    const adminPrimary = ADMIN_DASHBOARD_ROLE_PRESETS.hospital_admin.primaryMetricKeys;
    expect(adminPrimary.length).toBeLessThanOrEqual(10);
    expect(adminPrimary).not.toContain('uncategorized_income');
    expect(adminPrimary.every((key) => keys.includes(key))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```bash
pnpm exec vitest run test/unit/admin-dashboard-registry.test.ts
```

Expected: FAIL because `packages/shared/src/dashboard/metricRegistry.ts` does not exist.

- [ ] **Step 3: Add the shared types**

Create `packages/shared/src/dashboard/types.ts` with these exported declarations:

```ts
export type DashboardTemporalMode = 'period' | 'as_of' | 'live';
export type DashboardDateBasis =
  | 'service_date'
  | 'bill_date'
  | 'payment_date'
  | 'posting_date'
  | 'movement_date'
  | 'approval_date'
  | 'admission_date'
  | 'discharge_date'
  | 'census_date'
  | 'current_time';
export type DashboardHealthState =
  | 'healthy'
  | 'warning'
  | 'partial'
  | 'stale'
  | 'unreconciled'
  | 'unavailable';
export type MetricDesirableDirection = 'higher' | 'lower' | 'target_range' | 'zero' | 'neutral';

export interface AdminDashboardRequest {
  preset: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | '7d' | '30d' | 'custom';
  startDate: string;
  endDate: string;
  dateBasis?: DashboardDateBasis;
  branchId?: number;
  departmentId?: number;
  doctorId?: number;
  testSearch?: string;
  rolePreset?: 'hospital_admin' | 'md_director' | 'accountant' | 'manager_operations';
}

export interface DashboardDrillTarget {
  kind: 'drawer' | 'page' | 'action_center';
  route: string;
  query: Record<string, string | number | boolean>;
  permission: string;
  label: string;
}

export interface DashboardSourceStatus {
  state: 'complete' | 'partial' | 'stale' | 'unavailable';
  requiredSources: string[];
  loadedSources: string[];
  unavailableSources: Array<{ source: string; reasonCode: string; message: string }>;
  generatedAt: string;
  staleAfterSeconds: number;
}

export interface MetricComparison {
  currentValue: number;
  comparisonValue: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  comparisonLabel: string;
  desirableDirection: MetricDesirableDirection;
  interpretation: 'positive' | 'negative' | 'neutral' | 'not_comparable';
  reasonCode?: string;
}

export interface MetricTarget {
  type: 'minimum' | 'maximum' | 'range' | 'zero';
  minimum?: number;
  maximum?: number;
  label: string;
  status: 'met' | 'near' | 'missed' | 'not_configured';
}

export interface ReconciliationResult {
  summaryTotal: number;
  detailTotal: number;
  unexplainedDifference: number;
  tolerance: number;
  isBalanced: boolean;
  detailRowCount: number;
  providerMode?: 'legacy' | 'shadow' | 'canonical_preferred' | 'canonical_only';
  checkedAt: string;
}

export interface DashboardWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  domain: string;
  message: string;
  count?: number;
  amount?: number;
  action?: DashboardDrillTarget;
}

export interface DashboardMetricDefinition {
  key: string;
  labelKey: string;
  fallbackLabel: string;
  description: string;
  valueType: 'money' | 'count' | 'percentage' | 'duration';
  temporalMode: DashboardTemporalMode;
  dateBasis: DashboardDateBasis;
  desirableDirection: MetricDesirableDirection;
  sourceOfTruth: string[];
  formula: string;
  comparisonMode: 'previous_period' | 'previous_day' | 'previous_month' | 'none';
  reconciliationRequired: boolean;
  defaultRoles: Array<'hospital_admin' | 'md_director' | 'accountant' | 'manager_operations'>;
  section: 'primary' | 'financial' | 'operations' | 'domain_health' | 'live';
  drillTarget: DashboardDrillTarget;
  requiredPermission: string;
}

export interface DashboardMetricResult {
  key: string;
  label: string;
  value: number | null;
  valueType: DashboardMetricDefinition['valueType'];
  temporalMode: DashboardTemporalMode;
  dateBasis: DashboardDateBasis;
  period: { startDate?: string; endDate?: string; asOf?: string; label: string };
  generatedAt: string;
  sourceStatus: DashboardSourceStatus;
  comparison?: MetricComparison;
  target?: MetricTarget;
  reconciliation?: ReconciliationResult;
  warnings: DashboardWarning[];
  drill: DashboardDrillTarget;
}

export interface DashboardPermissionSummary {
  financialOverviewVisible: boolean;
  patientIdentifiersVisible: boolean;
  commissionDetailsVisible: boolean;
  auditDetailsVisible: boolean;
  exportAllowed: boolean;
  actionManagementAllowed: boolean;
}

export interface AdminDashboardOverviewResponse {
  reportKey: 'admin_control_center';
  reportVersion: string;
  generatedAt: string;
  timezone: 'Asia/Dhaka';
  filters: AdminDashboardRequest;
  comparisonPeriod?: { startDate: string; endDate: string; label: string };
  health: {
    state: DashboardHealthState;
    completeDomains: string[];
    partialDomains: string[];
    unavailableDomains: string[];
    staleDomains: string[];
    unreconciledDomains: string[];
    warnings: DashboardWarning[];
  };
  primaryMetrics: DashboardMetricResult[];
  financialReconciliation?: unknown;
  operations: unknown;
  domainHealth: unknown[];
  permissions: DashboardPermissionSummary;
}
```

- [ ] **Step 4: Add the authoritative registry and role presets**

Create `packages/shared/src/dashboard/metricRegistry.ts` with a typed registry. Begin with the ten Hospital Admin primary signals and the legacy optional metrics required for compatibility:

```ts
import type { DashboardMetricDefinition } from './types';

const drill = (route: string, permission = 'dashboard.admin.read') => ({
  kind: 'page' as const,
  route,
  query: {},
  permission,
  label: 'View details',
});

export const ADMIN_DASHBOARD_METRICS: DashboardMetricDefinition[] = [
  {
    key: 'net_billed_amount',
    labelKey: 'adminDashboard.metrics.netBilledAmount',
    fallbackLabel: 'Net billed amount',
    description: 'Gross bills created in the selected period minus bill discounts.',
    valueType: 'money',
    temporalMode: 'period',
    dateBasis: 'bill_date',
    desirableDirection: 'neutral',
    sourceOfTruth: ['bills', 'invoice_items'],
    formula: 'gross billed minus bill discount',
    comparisonMode: 'previous_period',
    reconciliationRequired: true,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant'],
    section: 'primary',
    drillTarget: drill('/reports/financial-audit', 'dashboard.financial.read'),
    requiredPermission: 'dashboard.financial.read',
  },
  {
    key: 'cash_received',
    labelKey: 'adminDashboard.metrics.cashReceived',
    fallbackLabel: 'Cash received',
    description: 'Physical cash received during the selected payment-date period.',
    valueType: 'money',
    temporalMode: 'period',
    dateBasis: 'payment_date',
    desirableDirection: 'neutral',
    sourceOfTruth: ['payments', 'emp_cash_transactions'],
    formula: 'cash bill collection plus cash due collection plus cash deposits received',
    comparisonMode: 'previous_period',
    reconciliationRequired: true,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant'],
    section: 'primary',
    drillTarget: drill('/cash/daily-collection', 'dashboard.financial.read'),
    requiredPermission: 'dashboard.financial.read',
  },
  {
    key: 'non_cash_received',
    labelKey: 'adminDashboard.metrics.nonCashReceived',
    fallbackLabel: 'Non-cash received',
    description: 'Digital, card, bank, and cheque receipts in the selected payment-date period.',
    valueType: 'money',
    temporalMode: 'period',
    dateBasis: 'payment_date',
    desirableDirection: 'neutral',
    sourceOfTruth: ['payments', 'emp_cash_transactions'],
    formula: 'all normalized non-cash receipts',
    comparisonMode: 'previous_period',
    reconciliationRequired: true,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant'],
    section: 'primary',
    drillTarget: drill('/cash/daily-collection', 'dashboard.financial.read'),
    requiredPermission: 'dashboard.financial.read',
  },
  {
    key: 'approved_expense_paid',
    labelKey: 'adminDashboard.metrics.approvedExpensePaid',
    fallbackLabel: 'Approved expense paid',
    description: 'Executed approved expense payments in the selected period.',
    valueType: 'money',
    temporalMode: 'period',
    dateBasis: 'payment_date',
    desirableDirection: 'lower',
    sourceOfTruth: ['expenses', 'cash_drawer_movements', 'accounting_entries'],
    formula: 'sum of executed approved expenses',
    comparisonMode: 'previous_period',
    reconciliationRequired: true,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant'],
    section: 'primary',
    drillTarget: drill('/cash/expenses', 'dashboard.financial.read'),
    requiredPermission: 'dashboard.financial.read',
  },
  {
    key: 'new_due_created',
    labelKey: 'adminDashboard.metrics.newDueCreated',
    fallbackLabel: 'New due created',
    description: 'Unpaid bill balance created by bills in the selected bill-date period.',
    valueType: 'money',
    temporalMode: 'period',
    dateBasis: 'bill_date',
    desirableDirection: 'lower',
    sourceOfTruth: ['bills'],
    formula: 'sum of due on non-cancelled bills created in the period',
    comparisonMode: 'previous_period',
    reconciliationRequired: true,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant'],
    section: 'primary',
    drillTarget: drill('/cash/dues', 'dashboard.financial.read'),
    requiredPermission: 'dashboard.financial.read',
  },
  {
    key: 'outstanding_due_as_of',
    labelKey: 'adminDashboard.metrics.outstandingDueAsOf',
    fallbackLabel: 'Outstanding due as of date',
    description: 'Total patient receivable balance outstanding at the selected period end.',
    valueType: 'money',
    temporalMode: 'as_of',
    dateBasis: 'bill_date',
    desirableDirection: 'lower',
    sourceOfTruth: ['bills', 'payments'],
    formula: 'eligible billed amount minus payments and approved reversals through period end',
    comparisonMode: 'previous_period',
    reconciliationRequired: true,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant'],
    section: 'primary',
    drillTarget: drill('/cash/dues', 'dashboard.financial.read'),
    requiredPermission: 'dashboard.financial.read',
  },
  {
    key: 'net_cash_movement',
    labelKey: 'adminDashboard.metrics.netCashMovement',
    fallbackLabel: 'Net cash movement',
    description: 'Physical cash inflow minus physical cash outflow in the selected movement-date period.',
    valueType: 'money',
    temporalMode: 'period',
    dateBasis: 'movement_date',
    desirableDirection: 'neutral',
    sourceOfTruth: ['cash_ledger_entries', 'emp_cash_transactions', 'cash_drawer_movements'],
    formula: 'cash in minus refunds, expenses, payouts, drops, and handovers',
    comparisonMode: 'previous_period',
    reconciliationRequired: true,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant'],
    section: 'primary',
    drillTarget: drill('/cash/drawers', 'dashboard.financial.read'),
    requiredPermission: 'dashboard.financial.read',
  },
  {
    key: 'drawer_variance',
    labelKey: 'adminDashboard.metrics.drawerVariance',
    fallbackLabel: 'Drawer variance',
    description: 'Latest counted cash minus expected cash across relevant closed drawers.',
    valueType: 'money',
    temporalMode: 'live',
    dateBasis: 'current_time',
    desirableDirection: 'zero',
    sourceOfTruth: ['billing_counter_sessions', 'shift_closings'],
    formula: 'counted cash minus expected cash',
    comparisonMode: 'none',
    reconciliationRequired: true,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant'],
    section: 'live',
    drillTarget: drill('/cash/drawers', 'dashboard.financial.read'),
    requiredPermission: 'dashboard.financial.read',
  },
  {
    key: 'critical_actions',
    labelKey: 'adminDashboard.metrics.criticalActions',
    fallbackLabel: 'Critical actions',
    description: 'Active critical Action Center items for the tenant.',
    valueType: 'count',
    temporalMode: 'live',
    dateBasis: 'current_time',
    desirableDirection: 'lower',
    sourceOfTruth: ['action_center_items'],
    formula: 'count of active critical action items',
    comparisonMode: 'none',
    reconciliationRequired: false,
    defaultRoles: ['hospital_admin', 'md_director', 'accountant', 'manager_operations'],
    section: 'live',
    drillTarget: drill('/action', 'dashboard.admin.read'),
    requiredPermission: 'dashboard.admin.read',
  },
  {
    key: 'bed_occupancy',
    labelKey: 'adminDashboard.metrics.bedOccupancy',
    fallbackLabel: 'Bed occupancy',
    description: 'Current occupied-bed percentage across active inpatient beds.',
    valueType: 'percentage',
    temporalMode: 'live',
    dateBasis: 'current_time',
    desirableDirection: 'target_range',
    sourceOfTruth: ['beds', 'admissions'],
    formula: 'occupied active beds divided by available active beds',
    comparisonMode: 'none',
    reconciliationRequired: false,
    defaultRoles: ['hospital_admin', 'md_director', 'manager_operations'],
    section: 'live',
    drillTarget: drill('/operations/ipd', 'dashboard.admin.read'),
    requiredPermission: 'dashboard.admin.read',
  },
];

export const ADMIN_DASHBOARD_ROLE_PRESETS = {
  hospital_admin: { primaryMetricKeys: ADMIN_DASHBOARD_METRICS.map((metric) => metric.key), optionalSections: ['financial', 'operations', 'domain_health', 'audit'] },
  md_director: { primaryMetricKeys: ['net_billed_amount', 'cash_received', 'approved_expense_paid', 'outstanding_due_as_of', 'drawer_variance', 'critical_actions', 'bed_occupancy'], optionalSections: ['financial', 'operations', 'domain_health'] },
  accountant: { primaryMetricKeys: ['net_billed_amount', 'cash_received', 'non_cash_received', 'approved_expense_paid', 'new_due_created', 'outstanding_due_as_of', 'net_cash_movement', 'drawer_variance', 'critical_actions'], optionalSections: ['financial', 'audit'] },
  manager_operations: { primaryMetricKeys: ['critical_actions', 'bed_occupancy'], optionalSections: ['operations', 'domain_health'] },
} as const;
```

Modify `packages/shared/src/index.ts`:

```ts
export * from './dashboard/types';
export * from './dashboard/metricRegistry';
```

- [ ] **Step 5: Run tests and typecheck, then commit**

Run:

```bash
pnpm exec vitest run test/unit/admin-dashboard-registry.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add packages/shared/src/dashboard packages/shared/src/index.ts test/unit/admin-dashboard-registry.test.ts
git commit -m "feat(dashboard): define semantic metric registry"
```

---

### Task 2: Filter Context, Comparison, Source Status, and Reconciliation Utilities

**Files:**
- Create: `src/lib/dashboard/filter-context.ts`
- Create: `src/lib/dashboard/source-status.ts`
- Create: `src/lib/dashboard/reconciliation.ts`
- Test: `test/unit/admin-dashboard-filter-context.test.ts`
- Test: `test/unit/admin-dashboard-source-status.test.ts`
- Test: `test/unit/admin-dashboard-reconciliation.test.ts`

**Interfaces:**
- Consumes: `AdminDashboardRequest`, `DashboardSourceStatus`, `MetricDesirableDirection`, `MetricComparison`, and `ReconciliationResult` from Task 1.
- Produces: `normalizeAdminDashboardRequest()`, `resolvePreviousPeriod()`, `buildMetricComparison()`, `buildSourceStatus()`, and `buildReconciliation()`.

- [ ] **Step 1: Write failing utility tests**

Create `test/unit/admin-dashboard-filter-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildMetricComparison,
  normalizeAdminDashboardRequest,
  resolvePreviousPeriod,
} from '../../src/lib/dashboard/filter-context';

describe('admin dashboard filter context', () => {
  it('normalizes a valid range and resolves an equal previous period', () => {
    const request = normalizeAdminDashboardRequest({
      preset: '7d',
      startDate: '2026-07-16',
      endDate: '2026-07-22',
      rolePreset: 'hospital_admin',
    });
    expect(request.startDate).toBe('2026-07-16');
    expect(resolvePreviousPeriod(request)).toEqual({
      startDate: '2026-07-09',
      endDate: '2026-07-15',
      label: 'Previous 7 days',
    });
  });

  it('rejects an inverted range', () => {
    expect(() => normalizeAdminDashboardRequest({
      preset: 'custom',
      startDate: '2026-07-22',
      endDate: '2026-07-20',
    })).toThrow('startDate must be on or before endDate');
  });

  it('does not invent a percentage when the comparison denominator is zero', () => {
    expect(buildMetricComparison({
      currentValue: 100,
      comparisonValue: 0,
      comparisonLabel: 'Previous period',
      desirableDirection: 'higher',
    })).toMatchObject({
      absoluteChange: 100,
      percentageChange: null,
      interpretation: 'not_comparable',
    });
  });
});
```

Create `test/unit/admin-dashboard-source-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSourceStatus } from '../../src/lib/dashboard/source-status';

describe('dashboard source status', () => {
  it('marks a missing required source unavailable', () => {
    const status = buildSourceStatus({
      requiredSources: ['payments', 'cash_drawer_movements'],
      loadedSources: ['payments'],
      failures: [{ source: 'cash_drawer_movements', reasonCode: 'QUERY_FAILED', message: 'Cash drawer query failed' }],
      generatedAt: '2026-07-22T11:30:00.000Z',
      staleAfterSeconds: 60,
      now: '2026-07-22T11:30:30.000Z',
    });
    expect(status.state).toBe('unavailable');
  });
});
```

Create `test/unit/admin-dashboard-reconciliation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildReconciliation } from '../../src/lib/dashboard/reconciliation';

describe('dashboard reconciliation', () => {
  it('reports the exact unexplained difference', () => {
    expect(buildReconciliation({
      summaryTotal: 1000,
      detailTotal: 995,
      detailRowCount: 3,
      tolerance: 0,
      checkedAt: '2026-07-22T11:30:00.000Z',
    })).toMatchObject({ unexplainedDifference: 5, isBalanced: false });
  });
});
```

- [ ] **Step 2: Run tests and confirm missing modules**

Run:

```bash
pnpm exec vitest run test/unit/admin-dashboard-filter-context.test.ts test/unit/admin-dashboard-source-status.test.ts test/unit/admin-dashboard-reconciliation.test.ts
```

Expected: FAIL because the three utility modules do not exist.

- [ ] **Step 3: Implement filter and comparison utilities**

Create `src/lib/dashboard/filter-context.ts`:

```ts
import type {
  AdminDashboardRequest,
  MetricComparison,
  MetricDesirableDirection,
} from '../../../packages/shared/src/dashboard/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string): Date {
  if (!ISO_DATE.test(value)) throw new Error('Dashboard dates must use YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Dashboard date is invalid');
  }
  return date;
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeAdminDashboardRequest(input: Partial<AdminDashboardRequest>): AdminDashboardRequest {
  const preset = input.preset ?? 'today';
  const startDate = String(input.startDate ?? '').trim();
  const endDate = String(input.endDate ?? '').trim();
  parseDate(startDate);
  parseDate(endDate);
  if (startDate > endDate) throw new Error('startDate must be on or before endDate');
  const durationDays = Math.round((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 86_400_000) + 1;
  if (durationDays > 366) throw new Error('Dashboard range cannot exceed 366 days');
  return {
    preset,
    startDate,
    endDate,
    dateBasis: input.dateBasis,
    branchId: input.branchId,
    departmentId: input.departmentId,
    doctorId: input.doctorId,
    testSearch: input.testSearch?.trim() || undefined,
    rolePreset: input.rolePreset ?? 'hospital_admin',
  };
}

export function resolvePreviousPeriod(request: AdminDashboardRequest) {
  const durationDays = Math.round((parseDate(request.endDate).getTime() - parseDate(request.startDate).getTime()) / 86_400_000) + 1;
  return {
    startDate: addDays(request.startDate, -durationDays),
    endDate: addDays(request.startDate, -1),
    label: durationDays === 1 ? 'Previous day' : `Previous ${durationDays} days`,
  };
}

function interpretation(change: number, direction: MetricDesirableDirection): MetricComparison['interpretation'] {
  if (direction === 'neutral') return 'neutral';
  if (direction === 'zero' || direction === 'target_range') return 'neutral';
  if (change === 0) return 'neutral';
  if (direction === 'higher') return change > 0 ? 'positive' : 'negative';
  return change < 0 ? 'positive' : 'negative';
}

export function buildMetricComparison(input: {
  currentValue: number;
  comparisonValue: number | null;
  comparisonLabel: string;
  desirableDirection: MetricDesirableDirection;
}): MetricComparison {
  if (input.comparisonValue === null) {
    return { ...input, absoluteChange: null, percentageChange: null, interpretation: 'not_comparable', reasonCode: 'COMPARISON_UNAVAILABLE' };
  }
  const absoluteChange = input.currentValue - input.comparisonValue;
  if (input.comparisonValue === 0) {
    return { ...input, absoluteChange, percentageChange: null, interpretation: 'not_comparable', reasonCode: 'ZERO_COMPARISON_BASE' };
  }
  return {
    ...input,
    absoluteChange,
    percentageChange: (absoluteChange / Math.abs(input.comparisonValue)) * 100,
    interpretation: interpretation(absoluteChange, input.desirableDirection),
  };
}
```

- [ ] **Step 4: Implement source status and reconciliation**

Create `src/lib/dashboard/source-status.ts`:

```ts
import type { DashboardSourceStatus } from '../../../packages/shared/src/dashboard/types';

export function buildSourceStatus(input: {
  requiredSources: string[];
  loadedSources: string[];
  failures: DashboardSourceStatus['unavailableSources'];
  generatedAt: string;
  staleAfterSeconds: number;
  now: string;
}): DashboardSourceStatus {
  const missingRequired = input.requiredSources.filter((source) => !input.loadedSources.includes(source));
  const ageSeconds = Math.max(0, (Date.parse(input.now) - Date.parse(input.generatedAt)) / 1000);
  const state: DashboardSourceStatus['state'] = missingRequired.length > 0
    ? 'unavailable'
    : input.failures.length > 0
      ? 'partial'
      : ageSeconds > input.staleAfterSeconds
        ? 'stale'
        : 'complete';
  return {
    state,
    requiredSources: [...input.requiredSources],
    loadedSources: [...input.loadedSources],
    unavailableSources: [...input.failures],
    generatedAt: input.generatedAt,
    staleAfterSeconds: input.staleAfterSeconds,
  };
}
```

Create `src/lib/dashboard/reconciliation.ts`:

```ts
import type { ReconciliationResult } from '../../../packages/shared/src/dashboard/types';

const roundMoney = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function buildReconciliation(input: {
  summaryTotal: number;
  detailTotal: number;
  detailRowCount: number;
  tolerance?: number;
  providerMode?: ReconciliationResult['providerMode'];
  checkedAt: string;
}): ReconciliationResult {
  const summaryTotal = roundMoney(input.summaryTotal);
  const detailTotal = roundMoney(input.detailTotal);
  const unexplainedDifference = roundMoney(summaryTotal - detailTotal);
  const tolerance = Math.max(0, roundMoney(input.tolerance ?? 0));
  return {
    summaryTotal,
    detailTotal,
    unexplainedDifference,
    tolerance,
    isBalanced: Math.abs(unexplainedDifference) <= tolerance,
    detailRowCount: Math.max(0, Math.trunc(input.detailRowCount)),
    providerMode: input.providerMode,
    checkedAt: input.checkedAt,
  };
}
```

- [ ] **Step 5: Run tests, typecheck, and commit**

Run:

```bash
pnpm exec vitest run test/unit/admin-dashboard-filter-context.test.ts test/unit/admin-dashboard-source-status.test.ts test/unit/admin-dashboard-reconciliation.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src/lib/dashboard test/unit/admin-dashboard-filter-context.test.ts test/unit/admin-dashboard-source-status.test.ts test/unit/admin-dashboard-reconciliation.test.ts
git commit -m "feat(dashboard): add filter health and reconciliation utilities"
```

---

### Task 3: Golden Financial Fixtures and Bounded Financial Provider

**Files:**
- Create: `test/fixtures/admin-dashboard/financialFixture.ts`
- Create: `src/lib/dashboard/providers/financial.ts`
- Test: `test/unit/admin-dashboard-financial-provider.test.ts`

**Interfaces:**
- Consumes: Task 1 registry/types and Task 2 reconciliation/source-status helpers.
- Produces: `getAdminFinancialOverview(args): Promise<AdminFinancialOverview>` and deterministic fixture expected values.

- [ ] **Step 1: Write the failing provider test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { getAdminFinancialOverview } from '../../src/lib/dashboard/providers/financial';

const query = vi.fn(async () => ({
  grossBilled: 300000,
  discount: 20000,
  netBilled: 280000,
  newDue: 40000,
  currentBillCollection: 240000,
  priorDueCollection: 30000,
  cashReceived: 200000,
  nonCashReceived: 70000,
  depositReceived: 20000,
  refunds: 5000,
  expensePaid: 15000,
  doctorPayoutPaid: 10000,
  expectedDrawerCash: 60000,
  countedCash: 59500,
  detailTotal: 280000,
  detailRowCount: 12,
  unknownPaymentCount: 3,
  unknownPaymentAmount: 4000,
  unmappedServiceCount: 2,
  unmappedServiceAmount: 2500,
}));

describe('admin financial overview provider', () => {
  it('separates billing, collection, deposits, and custody and exposes warnings', async () => {
    const result = await getAdminFinancialOverview({
      tenantId: 7,
      startDate: '2026-07-22',
      endDate: '2026-07-22',
      generatedAt: '2026-07-22T11:30:00.000Z',
      query,
    });
    expect(result.metrics.net_billed_amount.value).toBe(280000);
    expect(result.metrics.new_due_created.value).toBe(40000);
    expect(result.bridges.collection.rows.find((row) => row.key === 'deposit_received')?.value).toBe(20000);
    expect(result.bridges.custody.reconciliation.unexplainedDifference).toBe(500);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'UNKNOWN_PAYMENT_METHOD',
      'UNMAPPED_SERVICE_CATEGORY',
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify the provider is missing**

Run:

```bash
pnpm exec vitest run test/unit/admin-dashboard-financial-provider.test.ts
```

Expected: FAIL because `getAdminFinancialOverview` is not defined.

- [ ] **Step 3: Define the provider result and query boundary**

Create `src/lib/dashboard/providers/financial.ts` with a focused query boundary. The default implementation receives `dbBinding` and uses existing dashboard/accounting helpers; the injected `query` function is retained for unit tests:

```ts
import { buildReconciliation } from '../reconciliation';
import type { DashboardMetricResult, DashboardWarning } from '../../../../packages/shared/src/dashboard/types';

export interface AdminFinancialRawTotals {
  grossBilled: number;
  discount: number;
  netBilled: number;
  newDue: number;
  currentBillCollection: number;
  priorDueCollection: number;
  cashReceived: number;
  nonCashReceived: number;
  depositReceived: number;
  refunds: number;
  expensePaid: number;
  doctorPayoutPaid: number;
  expectedDrawerCash: number;
  countedCash: number;
  detailTotal: number;
  detailRowCount: number;
  unknownPaymentCount: number;
  unknownPaymentAmount: number;
  unmappedServiceCount: number;
  unmappedServiceAmount: number;
}

export interface AdminFinancialOverview {
  metrics: Record<string, DashboardMetricResult>;
  bridges: Record<'billing' | 'collection' | 'cash' | 'custody', {
    rows: Array<{ key: string; label: string; operator: 'start' | 'add' | 'subtract' | 'equals'; value: number }>;
    reconciliation: ReturnType<typeof buildReconciliation>;
  }>;
  warnings: DashboardWarning[];
}

export async function getAdminFinancialOverview(input: {
  tenantId: number;
  startDate: string;
  endDate: string;
  generatedAt: string;
  dbBinding?: D1Database;
  query?: () => Promise<AdminFinancialRawTotals>;
}): Promise<AdminFinancialOverview> {
  const raw = input.query
    ? await input.query()
    : await queryAdminFinancialTotals(input.dbBinding!, input.tenantId, input.startDate, input.endDate);
  return mapAdminFinancialOverview(raw, input);
}
```

- [ ] **Step 4: Implement one bounded query function and mapper**

Within the same file, reuse existing SQL helpers from `src/routes/tenant/dashboard.ts` by extracting them into focused service modules instead of duplicating formulas. The mapper must use this exact semantic separation:

```ts
function completeStatus(generatedAt: string, sources: string[]) {
  return {
    state: 'complete' as const,
    requiredSources: sources,
    loadedSources: sources,
    unavailableSources: [],
    generatedAt,
    staleAfterSeconds: 300,
  };
}

function metric(input: {
  key: string;
  label: string;
  value: number;
  temporalMode: 'period' | 'as_of' | 'live';
  dateBasis: 'bill_date' | 'payment_date' | 'movement_date' | 'current_time';
  generatedAt: string;
  startDate: string;
  endDate: string;
  sources: string[];
  reconciliation?: ReturnType<typeof buildReconciliation>;
}): DashboardMetricResult {
  return {
    key: input.key,
    label: input.label,
    value: input.value,
    valueType: 'money',
    temporalMode: input.temporalMode,
    dateBasis: input.dateBasis,
    period: input.temporalMode === 'live'
      ? { label: 'Live' }
      : input.temporalMode === 'as_of'
        ? { asOf: input.endDate, label: `As of ${input.endDate}` }
        : { startDate: input.startDate, endDate: input.endDate, label: input.startDate === input.endDate ? input.startDate : `${input.startDate} – ${input.endDate}` },
    generatedAt: input.generatedAt,
    sourceStatus: completeStatus(input.generatedAt, input.sources),
    reconciliation: input.reconciliation,
    warnings: [],
    drill: { kind: 'page', route: '/reports/financial-audit', query: { from: input.startDate, to: input.endDate }, permission: 'dashboard.financial.read', label: 'View details' },
  };
}

function mapAdminFinancialOverview(raw: AdminFinancialRawTotals, context: { startDate: string; endDate: string; generatedAt: string }): AdminFinancialOverview {
  const billingReconciliation = buildReconciliation({
    summaryTotal: raw.netBilled,
    detailTotal: raw.detailTotal,
    detailRowCount: raw.detailRowCount,
    checkedAt: context.generatedAt,
  });
  const netCashMovement = raw.cashReceived + raw.depositReceived - raw.refunds - raw.expensePaid - raw.doctorPayoutPaid;
  const custodyDifference = raw.expectedDrawerCash - raw.countedCash;
  const warnings: DashboardWarning[] = [];
  if (raw.unknownPaymentCount > 0) warnings.push({
    code: 'UNKNOWN_PAYMENT_METHOD', severity: 'critical', domain: 'financial', message: 'Payments with blank or unknown method require classification.', count: raw.unknownPaymentCount, amount: raw.unknownPaymentAmount,
  });
  if (raw.unmappedServiceCount > 0) warnings.push({
    code: 'UNMAPPED_SERVICE_CATEGORY', severity: 'warning', domain: 'financial', message: 'Service lines without canonical reporting category require mapping.', count: raw.unmappedServiceCount, amount: raw.unmappedServiceAmount,
  });
  return {
    metrics: {
      net_billed_amount: metric({ key: 'net_billed_amount', label: 'Net billed amount', value: raw.netBilled, temporalMode: 'period', dateBasis: 'bill_date', generatedAt: context.generatedAt, startDate: context.startDate, endDate: context.endDate, sources: ['bills', 'invoice_items'], reconciliation: billingReconciliation }),
      new_due_created: metric({ key: 'new_due_created', label: 'New due created', value: raw.newDue, temporalMode: 'period', dateBasis: 'bill_date', generatedAt: context.generatedAt, startDate: context.startDate, endDate: context.endDate, sources: ['bills'] }),
      cash_received: metric({ key: 'cash_received', label: 'Cash received', value: raw.cashReceived, temporalMode: 'period', dateBasis: 'payment_date', generatedAt: context.generatedAt, startDate: context.startDate, endDate: context.endDate, sources: ['payments', 'emp_cash_transactions'] }),
      non_cash_received: metric({ key: 'non_cash_received', label: 'Non-cash received', value: raw.nonCashReceived, temporalMode: 'period', dateBasis: 'payment_date', generatedAt: context.generatedAt, startDate: context.startDate, endDate: context.endDate, sources: ['payments', 'emp_cash_transactions'] }),
      approved_expense_paid: metric({ key: 'approved_expense_paid', label: 'Approved expense paid', value: raw.expensePaid, temporalMode: 'period', dateBasis: 'payment_date', generatedAt: context.generatedAt, startDate: context.startDate, endDate: context.endDate, sources: ['expenses', 'cash_drawer_movements'] }),
      net_cash_movement: metric({ key: 'net_cash_movement', label: 'Net cash movement', value: netCashMovement, temporalMode: 'period', dateBasis: 'movement_date', generatedAt: context.generatedAt, startDate: context.startDate, endDate: context.endDate, sources: ['cash_ledger_entries', 'cash_drawer_movements'] }),
      drawer_variance: metric({ key: 'drawer_variance', label: 'Drawer variance', value: raw.countedCash - raw.expectedDrawerCash, temporalMode: 'live', dateBasis: 'current_time', generatedAt: context.generatedAt, startDate: context.startDate, endDate: context.endDate, sources: ['billing_counter_sessions', 'shift_closings'], reconciliation: buildReconciliation({ summaryTotal: raw.expectedDrawerCash, detailTotal: raw.countedCash, detailRowCount: 1, checkedAt: context.generatedAt }) }),
    },
    bridges: {
      billing: { rows: [
        { key: 'gross_billed', label: 'Gross billed', operator: 'start', value: raw.grossBilled },
        { key: 'discount', label: 'Discount', operator: 'subtract', value: raw.discount },
        { key: 'net_billed', label: 'Net billed', operator: 'equals', value: raw.netBilled },
      ], reconciliation: billingReconciliation },
      collection: { rows: [
        { key: 'current_bill_collection', label: 'Current-period bill collection', operator: 'start', value: raw.currentBillCollection },
        { key: 'prior_due_collection', label: 'Prior-period due collection', operator: 'add', value: raw.priorDueCollection },
        { key: 'deposit_received', label: 'Deposit received', operator: 'add', value: raw.depositReceived },
      ], reconciliation: buildReconciliation({ summaryTotal: raw.currentBillCollection + raw.priorDueCollection + raw.depositReceived, detailTotal: raw.cashReceived + raw.nonCashReceived + raw.depositReceived, detailRowCount: raw.detailRowCount, checkedAt: context.generatedAt }) },
      cash: { rows: [
        { key: 'cash_received', label: 'Cash received', operator: 'start', value: raw.cashReceived },
        { key: 'deposit_received', label: 'Cash deposit received', operator: 'add', value: raw.depositReceived },
        { key: 'refunds', label: 'Refunds and returns', operator: 'subtract', value: raw.refunds },
        { key: 'expense_paid', label: 'Approved cash expense paid', operator: 'subtract', value: raw.expensePaid },
        { key: 'doctor_payout_paid', label: 'Doctor payout paid', operator: 'subtract', value: raw.doctorPayoutPaid },
        { key: 'net_cash_movement', label: 'Net cash movement', operator: 'equals', value: netCashMovement },
      ], reconciliation: buildReconciliation({ summaryTotal: netCashMovement, detailTotal: netCashMovement, detailRowCount: raw.detailRowCount, checkedAt: context.generatedAt }) },
      custody: { rows: [
        { key: 'expected_drawer_cash', label: 'Expected drawer cash', operator: 'start', value: raw.expectedDrawerCash },
        { key: 'counted_cash', label: 'Counted cash', operator: 'equals', value: raw.countedCash },
        { key: 'variance', label: 'Variance', operator: 'subtract', value: custodyDifference },
      ], reconciliation: buildReconciliation({ summaryTotal: raw.expectedDrawerCash, detailTotal: raw.countedCash, detailRowCount: 1, checkedAt: context.generatedAt }) },
    },
    warnings,
  };
}
```

Implement `queryAdminFinancialTotals()` by extracting and composing existing dashboard financial SQL/service functions; do not introduce new financial arithmetic that conflicts with canonical provider mode. The function must return every `AdminFinancialRawTotals` field in one bounded provider call and preserve unknown/unmapped amounts.

- [ ] **Step 5: Run the provider test and commit**

Run:

```bash
pnpm exec vitest run test/unit/admin-dashboard-financial-provider.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src/lib/dashboard/providers/financial.ts test/fixtures/admin-dashboard test/unit/admin-dashboard-financial-provider.test.ts
git commit -m "feat(dashboard): add bounded financial overview provider"
```

---

### Task 4: Versioned Admin Overview Route with Partial-Domain Health

**Files:**
- Create: `src/lib/dashboard/admin-overview.ts`
- Create: `src/lib/dashboard/providers/operations.ts`
- Create: `src/lib/dashboard/providers/domain-health.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Test: `test/integration/routes/admin-dashboard-overview.test.ts`
- Test: `test/integration/routes/admin-dashboard-permissions.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts/registry, Task 2 utilities, Task 3 financial provider.
- Produces: `buildAdminDashboardOverview()` and `GET /api/dashboard/admin-overview`.

- [ ] **Step 1: Write the failing overview route test**

```ts
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../helpers/createTestApp';

describe('GET /api/dashboard/admin-overview', () => {
  it('returns a compact normalized overview with explicit health', async () => {
    const app = createTestApp({ role: 'hospital_admin', tenantId: 1, featureFlags: { admin_dashboard_control_center_v1: true } });
    const response = await app.request('/api/dashboard/admin-overview?preset=today&startDate=2026-07-22&endDate=2026-07-22&rolePreset=hospital_admin');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ reportKey: 'admin_control_center', timezone: 'Asia/Dhaka' });
    expect(Array.isArray(body.primaryMetrics)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('patientName');
  });
});
```

Add a permission test that requests patient/commission/audit detail without corresponding permission and asserts those fields are omitted from the overview.

- [ ] **Step 2: Run tests and confirm the route returns 404**

Run:

```bash
pnpm exec vitest run test/integration/routes/admin-dashboard-overview.test.ts test/integration/routes/admin-dashboard-permissions.test.ts
```

Expected: FAIL with route not found or unexpected response status.

- [ ] **Step 3: Implement focused operations and domain-health providers**

Create `src/lib/dashboard/providers/operations.ts`:

```ts
export interface OperationsOverviewResult {
  periodFlow: { temporalMode: 'period'; stages: Array<{ key: string; label: string; count: number | null; completionRateFromPrevious?: number | null }> };
  currentCapacity: { temporalMode: 'live'; generatedAt: string; metrics: Array<{ key: string; value: number | null; valueType: 'count' | 'percentage' }> };
}

export async function getOperationsOverview(input: {
  dbBinding: D1Database;
  tenantId: number;
  startDate: string;
  endDate: string;
  generatedAt: string;
}): Promise<OperationsOverviewResult> {
  const db = input.dbBinding;
  const [flow, capacity] = await Promise.all([
    queryPeriodPatientFlow(db, input.tenantId, input.startDate, input.endDate),
    queryCurrentCapacity(db, input.tenantId),
  ]);
  return {
    periodFlow: { temporalMode: 'period', stages: flow },
    currentCapacity: { temporalMode: 'live', generatedAt: input.generatedAt, metrics: capacity },
  };
}
```

Only compute `completionRateFromPrevious` when both adjacent stages are complete and the previous count is greater than zero.

Create `src/lib/dashboard/providers/domain-health.ts` with one bounded summary per enabled role domain. Return critical/warning counts, two highlights, generated time, source status, and a filtered drill route; do not return detail rows.

- [ ] **Step 4: Implement the overview assembler and route**

Create `src/lib/dashboard/admin-overview.ts`:

```ts
import { ADMIN_DASHBOARD_ROLE_PRESETS } from '../../../packages/shared/src/dashboard/metricRegistry';
import type { AdminDashboardOverviewResponse, AdminDashboardRequest, DashboardWarning } from '../../../packages/shared/src/dashboard/types';
import { resolvePreviousPeriod } from './filter-context';
import { getAdminFinancialOverview } from './providers/financial';
import { getOperationsOverview } from './providers/operations';
import { getDomainHealthOverview } from './providers/domain-health';

export async function buildAdminDashboardOverview(input: {
  dbBinding: D1Database;
  tenantId: number;
  filters: AdminDashboardRequest;
  permissions: AdminDashboardOverviewResponse['permissions'];
  generatedAt: string;
}): Promise<AdminDashboardOverviewResponse> {
  const preset = ADMIN_DASHBOARD_ROLE_PRESETS[input.filters.rolePreset ?? 'hospital_admin'];
  const results = await Promise.allSettled([
    getAdminFinancialOverview({ dbBinding: input.dbBinding, tenantId: input.tenantId, startDate: input.filters.startDate, endDate: input.filters.endDate, generatedAt: input.generatedAt }),
    getOperationsOverview({ dbBinding: input.dbBinding, tenantId: input.tenantId, startDate: input.filters.startDate, endDate: input.filters.endDate, generatedAt: input.generatedAt }),
    getDomainHealthOverview({ dbBinding: input.dbBinding, tenantId: input.tenantId, enabledSections: preset.optionalSections, generatedAt: input.generatedAt }),
  ]);
  const warnings: DashboardWarning[] = [];
  const financial = results[0].status === 'fulfilled' ? results[0].value : null;
  const operations = results[1].status === 'fulfilled' ? results[1].value : { periodFlow: { temporalMode: 'period' as const, stages: [] }, currentCapacity: { temporalMode: 'live' as const, generatedAt: input.generatedAt, metrics: [] } };
  const domainHealth = results[2].status === 'fulfilled' ? results[2].value : [];
  if (!financial) warnings.push({ code: 'SOURCE_UNAVAILABLE', severity: 'critical', domain: 'financial', message: 'Financial overview is unavailable.' });
  if (results[1].status === 'rejected') warnings.push({ code: 'SOURCE_UNAVAILABLE', severity: 'warning', domain: 'operations', message: 'Operations overview is unavailable.' });
  if (results[2].status === 'rejected') warnings.push({ code: 'SOURCE_UNAVAILABLE', severity: 'warning', domain: 'domain_health', message: 'Domain health overview is unavailable.' });
  const metricMap = financial?.metrics ?? {};
  const primaryMetrics = preset.primaryMetricKeys.map((key) => metricMap[key]).filter(Boolean);
  const unreconciled = primaryMetrics.filter((metric) => metric.reconciliation && !metric.reconciliation.isBalanced);
  return {
    reportKey: 'admin_control_center',
    reportVersion: '2026-07-22.v1',
    generatedAt: input.generatedAt,
    timezone: 'Asia/Dhaka',
    filters: input.filters,
    comparisonPeriod: resolvePreviousPeriod(input.filters),
    health: {
      state: !financial ? 'partial' : unreconciled.length > 0 ? 'unreconciled' : warnings.length > 0 ? 'warning' : 'healthy',
      completeDomains: [financial ? 'financial' : '', results[1].status === 'fulfilled' ? 'operations' : '', results[2].status === 'fulfilled' ? 'domain_health' : ''].filter(Boolean),
      partialDomains: [],
      unavailableDomains: [!financial ? 'financial' : '', results[1].status === 'rejected' ? 'operations' : '', results[2].status === 'rejected' ? 'domain_health' : ''].filter(Boolean),
      staleDomains: [],
      unreconciledDomains: unreconciled.map((metric) => metric.key),
      warnings: [...(financial?.warnings ?? []), ...warnings],
    },
    primaryMetrics,
    financialReconciliation: financial?.bridges,
    operations,
    domainHealth,
    permissions: input.permissions,
  };
}
```

Modify `src/routes/tenant/dashboard.ts` to register the route behind the existing tenant feature-flag mechanism:

```ts
dashboardRoutes.get('/admin-overview', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const enabled = await isTenantFeatureEnabled(c.env.DB, tenantId, 'admin_dashboard_control_center_v1');
  if (!enabled) return c.json({ error: 'Admin control center is not enabled' }, 404);
  try {
    const filters = normalizeAdminDashboardRequest({
      preset: c.req.query('preset') as AdminDashboardRequest['preset'],
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      dateBasis: c.req.query('dateBasis') as AdminDashboardRequest['dateBasis'],
      rolePreset: c.req.query('rolePreset') as AdminDashboardRequest['rolePreset'],
    });
    const permissions = await resolveAdminDashboardPermissions(c);
    return c.json(await buildAdminDashboardOverview({
      dbBinding: c.env.DB,
      tenantId,
      filters,
      permissions,
      generatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    if (error instanceof Error && /date|range|startDate|endDate/.test(error.message)) return c.json({ error: error.message }, 400);
    console.error('Admin dashboard overview failed', { tenantId, error: error instanceof Error ? error.message : 'unknown' });
    return c.json({ error: 'Failed to load admin dashboard overview' }, 500);
  }
});
```

Use existing feature and permission helpers; if names differ, extract adapters with these signatures rather than bypassing repository patterns.

- [ ] **Step 5: Run integration tests, typecheck, and commit**

Run:

```bash
pnpm exec vitest run test/integration/routes/admin-dashboard-overview.test.ts test/integration/routes/admin-dashboard-permissions.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src/lib/dashboard src/routes/tenant/dashboard.ts test/integration/routes/admin-dashboard-overview.test.ts test/integration/routes/admin-dashboard-permissions.test.ts
git commit -m "feat(dashboard): add versioned admin overview response"
```

---

### Task 5: URL-Backed Context Bar and Focused Role Preset UI

**Files:**
- Modify: `web/src/types/executiveDashboard.ts`
- Create: `web/src/lib/dashboardUrlState.ts`
- Create: `web/src/components/dashboard/AdminDashboardContextBar.tsx`
- Create: `web/src/components/dashboard/AdminDashboardContextBar.test.tsx`
- Modify: `web/src/pages/admin/Dashboard.tsx`
- Modify: `web/src/pages/admin/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `AdminDashboardRequest` and `AdminDashboardOverviewResponse`.
- Produces: `parseAdminDashboardUrlState()`, `serializeAdminDashboardUrlState()`, and `AdminDashboardContextBar`.

- [ ] **Step 1: Write failing URL and UI tests**

Create `web/src/components/dashboard/AdminDashboardContextBar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminDashboardContextBar from './AdminDashboardContextBar';

describe('AdminDashboardContextBar', () => {
  it('shows explicit reporting context and emits normalized range changes', () => {
    const onChange = vi.fn();
    render(<AdminDashboardContextBar
      filters={{ preset: 'today', startDate: '2026-07-22', endDate: '2026-07-22', rolePreset: 'hospital_admin' }}
      generatedAt="2026-07-22T11:30:00.000Z"
      health={{ state: 'warning', warningCount: 2 }}
      onChange={onChange}
      onRefresh={vi.fn()}
    />);
    expect(screen.getByText('Asia/Dhaka')).toBeInTheDocument();
    expect(screen.getByText(/Warning/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preset: 'yesterday' }));
  });
});
```

Add dashboard integration assertions that the new overview path receives URL dates and only the focused primary metric area renders by default.

- [ ] **Step 2: Run frontend tests and confirm missing component**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/AdminDashboardContextBar.test.tsx src/pages/admin/Dashboard.test.tsx
```

Expected: FAIL because the context bar and URL utilities do not exist.

- [ ] **Step 3: Implement URL parse/serialize utilities**

Create `web/src/lib/dashboardUrlState.ts`:

```ts
import type { AdminDashboardRequest } from '@hms/shared';
import { resolveExecutiveDashboardFilters } from '../components/dashboard/ExecutiveDashboardRangeFilter';

export function parseAdminDashboardUrlState(search: string, today: string): AdminDashboardRequest {
  const params = new URLSearchParams(search);
  const preset = (params.get('preset') || 'today') as AdminDashboardRequest['preset'];
  const fallback = resolveExecutiveDashboardFilters(preset, today);
  return {
    preset,
    startDate: params.get('startDate') || fallback.startDate,
    endDate: params.get('endDate') || fallback.endDate,
    dateBasis: (params.get('dateBasis') || undefined) as AdminDashboardRequest['dateBasis'],
    rolePreset: (params.get('rolePreset') || 'hospital_admin') as AdminDashboardRequest['rolePreset'],
    doctorId: Number(params.get('doctorId')) > 0 ? Number(params.get('doctorId')) : undefined,
    testSearch: params.get('testSearch')?.trim() || undefined,
  };
}

export function serializeAdminDashboardUrlState(filters: AdminDashboardRequest): string {
  const params = new URLSearchParams({
    preset: filters.preset,
    startDate: filters.startDate,
    endDate: filters.endDate,
    rolePreset: filters.rolePreset ?? 'hospital_admin',
  });
  if (filters.dateBasis) params.set('dateBasis', filters.dateBasis);
  if (filters.doctorId) params.set('doctorId', String(filters.doctorId));
  if (filters.testSearch) params.set('testSearch', filters.testSearch);
  return params.toString();
}
```

- [ ] **Step 4: Implement the context bar and migrate Dashboard composition**

Create `AdminDashboardContextBar.tsx` as a wrapper around the existing range presets. It must render:

- page title,
- range buttons/custom dates,
- date-basis label,
- Asia/Dhaka timezone,
- server generated time,
- health state text,
- refresh button.

Use native buttons and inputs. In `Dashboard.tsx`, read/write URL search params through React Router, request `/api/dashboard/admin-overview`, render the new primary metric grid and context bar when the feature is enabled, and keep the current composition as the flag-off fallback.

The feature-on query key must include the complete serialized filter string:

```ts
const query = serializeAdminDashboardUrlState(filters);
const overviewQuery = useApiQuery<AdminDashboardOverviewResponse>(
  ['admin', 'control-center', query],
  `/api/dashboard/admin-overview?${query}`,
  { refetchInterval: 60_000 },
);
```

Live sections remain labeled live; do not pass historical dates into their current-state endpoints unless the new contract defines an as-of provider.

- [ ] **Step 5: Run frontend tests and commit**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/AdminDashboardContextBar.test.tsx src/pages/admin/Dashboard.test.tsx
pnpm --filter web build
```

Expected: PASS.

Commit:

```bash
git add web/src/types/executiveDashboard.ts web/src/lib/dashboardUrlState.ts web/src/components/dashboard/AdminDashboardContextBar.tsx web/src/components/dashboard/AdminDashboardContextBar.test.tsx web/src/pages/admin/Dashboard.tsx web/src/pages/admin/Dashboard.test.tsx
git commit -m "feat(dashboard): add role-aware control center context"
```

---

### Task 6: Decision-Grade Metric Cards and Financial Reconciliation Bridge

**Files:**
- Create: `web/src/components/dashboard/DashboardMetricCard.tsx`
- Create: `web/src/components/dashboard/DashboardMetricCard.test.tsx`
- Create: `web/src/components/dashboard/FinancialReconciliationBridge.tsx`
- Create: `web/src/components/dashboard/FinancialReconciliationBridge.test.tsx`
- Modify: `web/src/pages/admin/Dashboard.tsx`

**Interfaces:**
- Consumes: `DashboardMetricResult` and financial bridge objects from the overview response.
- Produces: accessible primary cards and reconciliation sections.

- [ ] **Step 1: Write failing component tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardMetricCard from './DashboardMetricCard';

const metric = {
  key: 'cash_received',
  label: 'Cash received',
  value: 120000,
  valueType: 'money' as const,
  temporalMode: 'period' as const,
  dateBasis: 'payment_date' as const,
  period: { startDate: '2026-07-22', endDate: '2026-07-22', label: '2026-07-22' },
  generatedAt: '2026-07-22T11:30:00.000Z',
  sourceStatus: { state: 'complete' as const, requiredSources: ['payments'], loadedSources: ['payments'], unavailableSources: [], generatedAt: '2026-07-22T11:30:00.000Z', staleAfterSeconds: 300 },
  comparison: { currentValue: 120000, comparisonValue: 100000, absoluteChange: 20000, percentageChange: 20, comparisonLabel: 'Previous day', desirableDirection: 'neutral' as const, interpretation: 'neutral' as const },
  reconciliation: { summaryTotal: 120000, detailTotal: 120000, unexplainedDifference: 0, tolerance: 0, isBalanced: true, detailRowCount: 4, checkedAt: '2026-07-22T11:30:00.000Z' },
  warnings: [],
  drill: { kind: 'drawer' as const, route: '/cash/daily-collection', query: {}, permission: 'dashboard.financial.read', label: 'View details' },
};

describe('DashboardMetricCard', () => {
  it('renders value, context, comparison, and reconciliation and activates drill', () => {
    const onDrill = vi.fn();
    render(<DashboardMetricCard metric={metric} onDrill={onDrill} />);
    expect(screen.getByText('Cash received')).toBeInTheDocument();
    expect(screen.getByText(/Payment date/)).toBeInTheDocument();
    expect(screen.getByText(/Balanced/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cash received/ }));
    expect(onDrill).toHaveBeenCalledWith(metric);
  });
});
```

Write reconciliation tests for balanced, partial, unavailable, and unexplained-difference states.

- [ ] **Step 2: Run tests and confirm components are missing**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/DashboardMetricCard.test.tsx src/components/dashboard/FinancialReconciliationBridge.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement `DashboardMetricCard`**

Use a native `<button>` for one-action cards. Format money with `formatCurrency`, counts with `toLocaleString`, percentage with one decimal, and duration with an explicit unit supplied by the metric label. Render these status rules:

```ts
const healthLabel = metric.sourceStatus.state === 'complete'
  ? metric.reconciliation && !metric.reconciliation.isBalanced
    ? `Unreconciled by ${formatCurrency(Math.abs(metric.reconciliation.unexplainedDifference))}`
    : 'Complete data'
  : metric.sourceStatus.state === 'partial'
    ? 'Partial data'
    : metric.sourceStatus.state === 'stale'
      ? 'Stale'
      : 'Unavailable';
```

When `metric.value === null`, display `—` and never format it as zero. Render temporal mode and readable date basis, comparison, target, generated time, and health as visible text.

- [ ] **Step 4: Implement `FinancialReconciliationBridge` and add it to Dashboard**

The component accepts a title, bridge rows, and reconciliation. Each row is a native button when it has a drill target. Render operator symbols with text labels for screen readers. The footer shows:

```tsx
<p role="status">
  {reconciliation.isBalanced
    ? 'Balanced'
    : `Unreconciled by ${formatCurrency(Math.abs(reconciliation.unexplainedDifference))}`}
</p>
```

Add billing, collection, cash, and custody bridges after primary metrics. On narrow screens they stack; on desktop billing/collection and cash/custody use two columns.

- [ ] **Step 5: Run tests, build, and commit**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/DashboardMetricCard.test.tsx src/components/dashboard/FinancialReconciliationBridge.test.tsx src/pages/admin/Dashboard.test.tsx
pnpm --filter web build
```

Expected: PASS.

Commit:

```bash
git add web/src/components/dashboard/DashboardMetricCard.tsx web/src/components/dashboard/DashboardMetricCard.test.tsx web/src/components/dashboard/FinancialReconciliationBridge.tsx web/src/components/dashboard/FinancialReconciliationBridge.test.tsx web/src/pages/admin/Dashboard.tsx web/src/pages/admin/Dashboard.test.tsx
git commit -m "feat(dashboard): add decision metrics and reconciliation bridge"
```

---

### Task 7: Consolidate Action Center and Correct Live/Partial States

**Files:**
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.tsx`
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.test.tsx`
- Modify: `web/src/pages/admin/widgets/LiveCashDrawerWidget.tsx`
- Modify: `web/src/pages/admin/widgets/LiveCashDrawerWidget.test.tsx`
- Modify: Action Center backend summary files identified by `search('/api/action-center/summary')`
- Test: `test/integration/routes/action-center-dashboard-summary.test.ts`

**Interfaces:**
- Consumes: overview health/warnings and existing Action Center contracts.
- Produces: one persistent queue with amount, age, SLA, owner, capability, and drill; a live cash widget that distinguishes source failure from zero.

- [ ] **Step 1: Write failing regressions**

Add an Action Center test asserting a normal non-zero approved expense does not create an action, while missing evidence does. Add a frontend test asserting the dashboard no longer renders `admin-exception-center` from `KPISummaryCards`.

Add this live-cash regression:

```tsx
it('shows partial data when cash-control fails instead of zero handover and variance', () => {
  vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => {
    if (path === '/api/dashboard/active-counters') return { data: { activeCounters: [], totalActive: 0 }, isLoading: false, isError: false, refetch: vi.fn() };
    if (path.startsWith('/api/dashboard/cash-control')) return { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  }) as never);
  render(<LiveCashDrawerWidget />);
  expect(screen.getByText('Partial data')).toBeInTheDocument();
  expect(screen.queryByText('৳0')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify current behavior fails**

Run:

```bash
pnpm exec vitest run test/integration/routes/action-center-dashboard-summary.test.ts
pnpm --filter web exec vitest run src/pages/admin/widgets/ActionRequiredPanel.test.tsx src/pages/admin/widgets/LiveCashDrawerWidget.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx
```

Expected: FAIL because duplicate risk cards and false-zero live cash behavior remain.

- [ ] **Step 3: Extend the Action Center summary contract**

Return dashboard items with this shape from the existing Action Center summary service:

```ts
{
  id: string;
  ruleKey: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  count: number;
  amount?: number;
  oldestAgeSeconds?: number;
  owner?: string;
  capability: 'manage' | 'review_only';
  route: string;
  query: Record<string, string>;
}
```

Add rules for reconciliation mismatch, unknown payment method, unmapped service, missing expense evidence, failed/pending posting, and commission exceptions. Do not create an expense action solely because approved expense amount is positive.

- [ ] **Step 4: Remove duplicate heuristic risk UI and correct live-cash states**

Delete `riskRows()` and the `admin-exception-center` section from `KPISummaryCards.tsx`. Render Action Center only through `ActionRequiredPanel` or the new overview action summary.

In `LiveCashDrawerWidget`, retain separate query states:

```ts
const activeCountersQuery = useApiQuery<ActiveCountersResponse>(...);
const cashControlQuery = useApiQuery<CashControlResponse>(...);
const partial = !activeCountersQuery.isError && cashControlQuery.isError;
```

When `partial` is true, show active counter rows and a visible `Partial data` notice; render handover, pending, and variance as `—`. Add a visible `Live` badge and display server generated time when the route exposes it.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm exec vitest run test/integration/routes/action-center-dashboard-summary.test.ts
pnpm --filter web exec vitest run src/pages/admin/widgets/ActionRequiredPanel.test.tsx src/pages/admin/widgets/LiveCashDrawerWidget.test.tsx src/pages/admin/widgets/KPISummaryCards.test.tsx
pnpm exec tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src web/src/pages/admin/widgets test/integration/routes/action-center-dashboard-summary.test.ts
git commit -m "refactor(dashboard): consolidate actions and correct partial states"
```

---

### Task 8: Period-Aware Trend, Payment Mix, and Operations/Capacity Separation

**Files:**
- Modify: `src/routes/tenant/dashboard.ts`
- Create: `src/lib/dashboard/trend.ts`
- Create: `src/lib/dashboard/payment-mix.ts`
- Modify: `web/src/pages/admin/widgets/RevenueTrendChart.tsx`
- Modify: `web/src/pages/admin/widgets/RevenueTrendChart.test.tsx`
- Modify: `web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx`
- Modify: `web/src/pages/admin/widgets/PaymentMethodBreakdown.test.tsx`
- Create: `web/src/components/dashboard/PatientFlowFunnel.tsx`
- Create: `web/src/components/dashboard/PatientFlowFunnel.test.tsx`
- Create: `web/src/components/dashboard/CurrentCapacityStrip.tsx`
- Modify: `web/src/pages/admin/widgets/OperationsSnapshot.tsx`

**Interfaces:**
- Consumes: normalized filters and operations overview from Tasks 2 and 4.
- Produces: `GET /api/dashboard/trend`, `GET /api/dashboard/payment-mix`, accessible period trend/payment components, and separate period/live operations surfaces.

- [ ] **Step 1: Write failing route and component tests**

The trend route test requests `metric=cash_received&startDate=2026-07-16&endDate=2026-07-22&dateBasis=payment_date&granularity=day` and asserts seven chronological points plus server total/comparison.

The payment route test asserts unknown methods remain a warning with amount/count.

The frontend tests assert both widgets receive filters as props and call paths containing the selected range. Add a `PatientFlowFunnel` test that omits conversion rate when the previous stage count is zero or source state is partial.

- [ ] **Step 2: Run the targeted tests and confirm current fixed-today behavior fails**

Run:

```bash
pnpm exec vitest run test/integration/routes/admin-dashboard-trend.test.ts test/integration/routes/admin-dashboard-payment-mix.test.ts
pnpm --filter web exec vitest run src/pages/admin/widgets/RevenueTrendChart.test.tsx src/pages/admin/widgets/PaymentMethodBreakdown.test.tsx src/components/dashboard/PatientFlowFunnel.test.tsx
```

Expected: FAIL because the versioned routes/components are not period-aware.

- [ ] **Step 3: Implement server-owned trend and payment mix**

`src/lib/dashboard/trend.ts` exports:

```ts
export async function getDashboardTrend(input: {
  dbBinding: D1Database;
  tenantId: number;
  metric: 'cash_received' | 'net_billed_amount' | 'approved_expense_paid' | 'new_due_created';
  startDate: string;
  endDate: string;
  dateBasis: string;
  granularity: 'day' | 'week' | 'month';
}): Promise<{
  metric: string;
  label: string;
  total: number;
  points: Array<{ period: string; value: number }>;
  warnings: DashboardWarning[];
}>;
```

Use allowlisted metric/date-basis mappings and bounded grouped SQL. Do not interpolate uncontrolled column names.

`src/lib/dashboard/payment-mix.ts` returns normalized method, amount, count, percentage, total, source status, and warnings. Use the existing payment-method normalizer. Unknown values remain in the total and also produce `UNKNOWN_PAYMENT_METHOD`.

Register both routes with admin guard and field-specific `400` validation.

- [ ] **Step 4: Migrate frontend components and operations layout**

Change both widgets to accept `filters: AdminDashboardRequest`. Remove internal Today/7D and `getTodayGMT6()` query ownership. Trend uses server points and displays an expandable accessible table. Use a line chart only when `points.length >= 4`; otherwise show exact stat rows.

Implement `PatientFlowFunnel` and `CurrentCapacityStrip`; replace the mixed `OperationsSnapshot` with these two sections or retain `OperationsSnapshot` as a composition wrapper. Every capacity item displays `Live` or `As of` and generated time.

- [ ] **Step 5: Run tests, build, and commit**

Run:

```bash
pnpm exec vitest run test/integration/routes/admin-dashboard-trend.test.ts test/integration/routes/admin-dashboard-payment-mix.test.ts
pnpm --filter web exec vitest run src/pages/admin/widgets/RevenueTrendChart.test.tsx src/pages/admin/widgets/PaymentMethodBreakdown.test.tsx src/components/dashboard/PatientFlowFunnel.test.tsx src/pages/admin/Dashboard.test.tsx
pnpm --filter web build
```

Expected: PASS.

Commit:

```bash
git add src/lib/dashboard/trend.ts src/lib/dashboard/payment-mix.ts src/routes/tenant/dashboard.ts web/src/pages/admin/widgets web/src/components/dashboard/PatientFlowFunnel.tsx web/src/components/dashboard/PatientFlowFunnel.test.tsx web/src/components/dashboard/CurrentCapacityStrip.tsx test/integration/routes/admin-dashboard-trend.test.ts test/integration/routes/admin-dashboard-payment-mix.test.ts
git commit -m "feat(dashboard): align trend payment and operations context"
```

---

### Task 9: Material Business Audit Feed and Reconciled Drillthrough

**Files:**
- Create: `src/lib/audit/dashboard-events.ts`
- Modify: audit route file found by `search("/api/audit")`
- Test: `test/unit/dashboard-audit-events.test.ts`
- Modify: `web/src/pages/admin/widgets/AuditFeedWidget.tsx`
- Modify: `web/src/pages/admin/widgets/AuditFeedWidget.test.tsx`
- Modify: `web/src/components/dashboard/KpiBreakdownDrawer.tsx`
- Modify: `web/src/components/dashboard/KpiBreakdownDrawer.test.tsx`

**Interfaces:**
- Consumes: dashboard drill, warning, permission, and reconciliation contracts.
- Produces: server-owned `DashboardAuditEvent[]` and a metric drawer with full-filter aggregates and focus management.

- [ ] **Step 1: Write failing audit and drawer tests**

Audit unit test:

```ts
import { describe, expect, it } from 'vitest';
import { mapDashboardAuditEvent } from '../../src/lib/audit/dashboard-events';

describe('dashboard audit events', () => {
  it('maps a bill amount change to a material business event', () => {
    expect(mapDashboardAuditEvent({
      id: 10,
      action: 'update',
      table_name: 'bills',
      record_id: '105',
      user_id: 7,
      user_name: 'Rahim',
      created_at: '2026-07-22 11:28:00',
      metadata: { beforeTotal: 12500, afterTotal: 9500, invoiceNo: 'INV-105', approvalStatus: 'pending' },
    })).toMatchObject({
      eventType: 'BILL_AMOUNT_CHANGED',
      severity: 'high',
      amountDifference: -3000,
      narrative: 'Rahim changed INV-105 from ৳12,500 to ৳9,500.',
    });
  });
});
```

Drawer test asserts reconciliation/warnings render, Escape closes, and focus returns to the trigger through the parent integration.

- [ ] **Step 2: Run tests and verify frontend CRUD inference remains**

Run:

```bash
pnpm exec vitest run test/unit/dashboard-audit-events.test.ts
pnpm --filter web exec vitest run src/pages/admin/widgets/AuditFeedWidget.test.tsx src/components/dashboard/KpiBreakdownDrawer.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement material audit mapping and route**

Create `src/lib/audit/dashboard-events.ts` with explicit allowlisted policies for:

- bill amount change,
- discount override,
- cancellation/refund,
- expense execution,
- doctor payout,
- cash variance/handover,
- permission change,
- sensitive export.

Return:

```ts
export interface DashboardAuditEvent {
  id: string;
  eventType: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  occurredAt: string;
  actor: { id?: number; displayName: string };
  subject: { type: string; reference: string };
  narrative: string;
  amountDifference?: number;
  reviewStatus?: string;
  drill: DashboardDrillTarget;
}
```

Unmapped low-risk CRUD returns `null` and remains available only in Audit Explorer. Enforce audit-detail permission before including financial differences or patient references.

- [ ] **Step 4: Migrate audit feed and upgrade drawer contract**

Remove `ACTION_ICONS` severity inference from `AuditFeedWidget`. Render event severity and narrative returned by the backend.

Extend `KpiBreakdownData` with:

```ts
sourceStatus?: DashboardSourceStatus;
warnings?: DashboardWarning[];
reconciliation?: ReconciliationResult;
aggregates?: Record<string, number | string | null>;
generatedAt?: string;
```

Use server `aggregates.topCounterOrUser`; remove the unqualified current-page calculation or label it `Top in this page` only when the server aggregate is absent. Add dialog focus trap, Escape close, and trigger focus restoration through a reusable dialog hook already used in the codebase or a focused local implementation.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm exec vitest run test/unit/dashboard-audit-events.test.ts
pnpm --filter web exec vitest run src/pages/admin/widgets/AuditFeedWidget.test.tsx src/components/dashboard/KpiBreakdownDrawer.test.tsx
pnpm exec tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src/lib/audit/dashboard-events.ts src/routes web/src/pages/admin/widgets/AuditFeedWidget.tsx web/src/pages/admin/widgets/AuditFeedWidget.test.tsx web/src/components/dashboard/KpiBreakdownDrawer.tsx web/src/components/dashboard/KpiBreakdownDrawer.test.tsx test/unit/dashboard-audit-events.test.ts
git commit -m "feat(dashboard): add material audit and trusted drillthrough"
```

---

### Task 10: Performance, Accessibility, Compatibility, and Rollout Gates

**Files:**
- Modify: `web/src/pages/admin/Dashboard.tsx`
- Modify: `web/src/hooks/useExecutiveDashboardAnalytics.ts`
- Create: `test/integration/routes/admin-dashboard-performance.test.ts`
- Create: `test/e2e/admin-dashboard-control-center.spec.ts`
- Create: `docs/production-readiness/evidence/admin-dashboard-control-center-baseline.md`
- Modify: `docs/admin-dashboard/2026-07-22-agent-task-board.yaml`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: measured request/payload/query evidence, accessibility workflow, feature-flag compatibility, and tracker completion state.

- [ ] **Step 1: Write failing request-budget and E2E assertions**

Integration test asserts the overview contains no detail-row arrays and serialized payload is below 100 KB for the high-volume fixture:

```ts
it('keeps the default overview compact', async () => {
  const response = await requestOverviewForHighVolumeFixture();
  const body = await response.json();
  const bytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  expect(bytes).toBeLessThan(100_000);
  expect(JSON.stringify(body)).not.toContain('today_activity');
  expect(JSON.stringify(body)).not.toContain('patientName');
});
```

E2E workflow:

```ts
import { expect, test } from '@playwright/test';

test('admin control center preserves context and supports keyboard drillthrough', async ({ page }) => {
  await page.goto('/h/test-hospital/admin/dashboard?preset=today&startDate=2026-07-22&endDate=2026-07-22&rolePreset=hospital_admin');
  await expect(page.getByRole('heading', { name: 'Hospital Admin Control Center' })).toBeVisible();
  await expect(page.getByText('Asia/Dhaka')).toBeVisible();
  await page.getByRole('button', { name: /Cash received/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Cash received/ })).toBeFocused();
  await page.getByRole('button', { name: 'Yesterday' }).click();
  await expect(page).toHaveURL(/preset=yesterday/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Yesterday' })).toHaveAttribute('aria-selected', 'true');
});
```

- [ ] **Step 2: Run tests and measure the current flagged implementation**

Run:

```bash
pnpm exec vitest run test/integration/routes/admin-dashboard-performance.test.ts
pnpm --filter web exec vitest run src/pages/admin src/components/dashboard
```

Expected: any request/payload/accessibility regression is visible before optimization.

- [ ] **Step 3: Reduce fan-out and polling**

When the control-center flag is on:

- use one overview query for primary metrics, financial bridges, operations summary, and domain health;
- use one Action Center summary query if not bundled;
- use one live-state query only when live section is visible;
- do not mount the five legacy analytics panel queries by default;
- lazy-load optional doctor/test/income/expense/reagent panels after explicit expansion or intersection visibility;
- stop polling hidden sections.

Preserve the legacy component tree when the flag is off.

- [ ] **Step 4: Complete accessibility, query-plan, and evidence review**

Run the keyboard E2E locally with a non-production fixture environment. Inspect D1 query plans for high-volume provider SQL and record indexes used. Write `docs/production-readiness/evidence/admin-dashboard-control-center-baseline.md` with:

- base commit,
- feature flags,
- targeted test commands/results,
- overview request count,
- payload size,
- provider timings,
- query-plan findings,
- accessibility result,
- known non-critical limitations,
- rollback method.

Do not include PHI or production credentials.

- [ ] **Step 5: Run the complete release gate and commit**

Run:

```bash
pnpm exec vitest run test/unit/admin-dashboard-*.test.ts test/integration/routes/admin-dashboard-*.test.ts
pnpm --filter web exec vitest run src/pages/admin src/components/dashboard
pnpm exec tsc --noEmit
pnpm --filter web build
BASE_URL=http://localhost:${HMS_API_PORT:-8788} playwright test test/e2e/admin-dashboard-control-center.spec.ts --project=e2e
```

Expected: PASS in the authorized local/staging fixture environment.

Update completed task statuses and verification evidence in `docs/admin-dashboard/2026-07-22-agent-task-board.yaml`.

Commit:

```bash
git add web/src/pages/admin/Dashboard.tsx web/src/hooks/useExecutiveDashboardAnalytics.ts test/integration/routes/admin-dashboard-performance.test.ts test/e2e/admin-dashboard-control-center.spec.ts docs/production-readiness/evidence/admin-dashboard-control-center-baseline.md docs/admin-dashboard/2026-07-22-agent-task-board.yaml
git commit -m "test(dashboard): add control center release gates"
```

---

## Final Verification and Rollout Handoff

After Task 10:

1. Run `git diff --check` and confirm a clean worktree after the final commit.
2. Review the feature-flag-off path and confirm legacy dashboard behavior still works.
3. Review the feature-flag-on path using golden fixture totals.
4. Confirm no unresolved critical `SOURCE_UNAVAILABLE`, `SUMMARY_DETAIL_MISMATCH`, `UNKNOWN_PAYMENT_METHOD`, or `UNMAPPED_SERVICE_CATEGORY` warning is hidden.
5. Prepare staging shadow observation; do not enable production without separate authorization.
6. Record exact next rollout action and rollback command in production-readiness evidence.

Plan execution is complete only when the QA release gate matrix in `docs/admin-dashboard/2026-07-22-qa-acceptance-test-plan.md` passes and the pilot has no unresolved critical reconciliation issue.

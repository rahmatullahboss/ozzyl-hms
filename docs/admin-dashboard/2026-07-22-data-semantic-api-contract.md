# Admin Dashboard Control Center — Data Semantics and API Contract

**Date:** 2026-07-22
**Status:** Controlling technical design
**Architecture:** Cloudflare Workers + D1, operational sources remain authoritative

## 1. Architecture decision

The dashboard must not create a second financial or operational ledger. Existing billing, payment, cash, accounting, deposit, commission, IPD, lab, inventory, action-center, and audit records remain the sources of truth.

A shared dashboard reporting service will:

- normalize filter semantics,
- call bounded domain providers,
- assemble explicit metrics,
- expose source completeness,
- calculate comparison context,
- expose reconciliation evidence,
- enforce field permissions,
- return compact role-oriented read models.

## 2. Core semantic types

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

export type MetricDesirableDirection =
  | 'higher'
  | 'lower'
  | 'target_range'
  | 'zero'
  | 'neutral';
```

## 3. Normalized request contract

```ts
export interface AdminDashboardRequest {
  preset:
    | 'today'
    | 'yesterday'
    | 'this_week'
    | 'this_month'
    | 'last_month'
    | '7d'
    | '30d'
    | 'custom';
  startDate: string; // YYYY-MM-DD, Asia/Dhaka business date
  endDate: string;   // YYYY-MM-DD, inclusive
  dateBasis?: DashboardDateBasis;
  branchId?: number;
  departmentId?: number;
  doctorId?: number;
  testSearch?: string;
  rolePreset?: 'hospital_admin' | 'md_director' | 'accountant' | 'manager_operations';
}
```

Rules:

1. Server validates ISO dates and `startDate <= endDate`.
2. Server echoes normalized filters.
3. Date-only filtering uses Asia/Dhaka business-date boundaries consistently.
4. Maximum synchronous range defaults to 366 days unless a domain sets a lower documented limit.
5. Unsupported date basis for a metric returns a field-specific `400` response.
6. Live metrics ignore historical range but explicitly declare `temporalMode: 'live'` and `dateBasis: 'current_time'`.

## 4. Metric registry contract

Frontend and backend must use one shared registry or a generated contract derived from one authoritative definition.

```ts
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
  drillTarget: string;
  requiredPermission: string;
}
```

### 4.1 Required registry decisions

The registry must resolve the current ambiguous measures.

| Current key/label | Required explicit replacement or definition |
|---|---|
| `accounting_income` / Total Collection | Define whether payment-date collection or GL-posted revenue; do not use both meanings |
| `accounting_profit` / Net Income | Rename operational estimate or calculate from authoritative GL period result |
| `patient_due` | Split new due created from outstanding due as-of date |
| `deposit_collection` | Rename deposit received; separate deposit applied/refunded/liability |
| `total_commission` | Split earned, waived, payable, paid, outstanding |
| `uncategorized_income` | Move to unmapped-service exception |
| `drawer_cash` | Declare live current balance, not period flow |
| `pending_approvals` | Declare current queue, not selected-period total |

## 5. Overview response contract

```ts
export interface AdminDashboardOverviewResponse {
  reportKey: 'admin_control_center';
  reportVersion: string;
  generatedAt: string; // ISO timestamp
  timezone: 'Asia/Dhaka';
  filters: AdminDashboardRequest;
  comparisonPeriod?: {
    startDate: string;
    endDate: string;
    label: string;
  };
  health: DashboardHealthSummary;
  primaryMetrics: DashboardMetricResult[];
  financialReconciliation?: FinancialReconciliationView;
  operations: OperationsOverview;
  domainHealth: DomainHealthSummary[];
  permissions: DashboardPermissionSummary;
}

export interface DashboardHealthSummary {
  state: DashboardHealthState;
  completeDomains: string[];
  partialDomains: string[];
  unavailableDomains: string[];
  staleDomains: string[];
  unreconciledDomains: string[];
  warnings: DashboardWarning[];
}

export interface DashboardMetricResult {
  key: string;
  label: string;
  value: number | null;
  valueType: 'money' | 'count' | 'percentage' | 'duration';
  temporalMode: DashboardTemporalMode;
  dateBasis: DashboardDateBasis;
  period: {
    startDate?: string;
    endDate?: string;
    asOf?: string;
    label: string;
  };
  generatedAt: string;
  sourceStatus: DashboardSourceStatus;
  comparison?: MetricComparison;
  target?: MetricTarget;
  reconciliation?: ReconciliationResult;
  warnings: DashboardWarning[];
  drill: DashboardDrillTarget;
}
```

## 6. Source status contract

```ts
export interface DashboardSourceStatus {
  state: 'complete' | 'partial' | 'stale' | 'unavailable';
  requiredSources: string[];
  loadedSources: string[];
  unavailableSources: Array<{
    source: string;
    reasonCode: string;
    message: string;
  }>;
  generatedAt: string;
  staleAfterSeconds: number;
}
```

Rules:

- `value: 0` is allowed only when `sourceStatus.state === 'complete'` and the authoritative query returned zero.
- Required-source failure sets `value: null`; the frontend displays unavailable rather than zero.
- Optional-source failure may retain a partial value only when the response clearly marks it partial and lists exclusions.
- Browser request completion time is not a substitute for server `generatedAt`.

## 7. Comparison contract

```ts
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
```

Rules:

1. Percentage is `null` when comparison value is zero and no meaningful denominator exists.
2. Interpretation is metric-specific and server-owned.
3. Target-range metrics use target evaluation rather than sign-based interpretation.
4. Comparison periods use equal-duration preceding periods unless a registry definition specifies previous day/month.

## 8. Target contract

```ts
export interface MetricTarget {
  type: 'minimum' | 'maximum' | 'range' | 'zero';
  minimum?: number;
  maximum?: number;
  label: string;
  status: 'met' | 'near' | 'missed' | 'not_configured';
}
```

Tenant-configurable targets require audited configuration and safe defaults. A missing target must display `No target configured`, not a fabricated benchmark.

## 9. Reconciliation contract

```ts
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
```

Rules:

1. Financial metrics require complete-detail aggregation independent of current pagination.
2. UI does not calculate `detailTotal` from the visible page.
3. Default BDT tolerance is zero unless an explicit rounding policy exists.
4. A non-zero unexplained difference creates or links an Action Center exception.
5. Mirrored legacy and canonical records are compared, never added together.
6. Provider mode is visible during financial cutover or shadow operation.

## 10. Warning and exception contract

```ts
export interface DashboardWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  domain: string;
  message: string;
  count?: number;
  amount?: number;
  action?: DashboardDrillTarget;
}
```

Minimum codes:

- `UNKNOWN_PAYMENT_METHOD`
- `UNMAPPED_SERVICE_CATEGORY`
- `UNMAPPED_LAB_TEST`
- `MISSING_DOCTOR_ATTRIBUTION`
- `SOURCE_UNAVAILABLE`
- `SOURCE_STALE`
- `SUMMARY_DETAIL_MISMATCH`
- `MISSING_DISCOUNT_REFERENCE`
- `MISSING_EXPENSE_EVIDENCE`
- `PENDING_ACCOUNTING_POSTING`
- `FAILED_ACCOUNTING_POSTING`
- `COMMISSION_CALCULATION_EXCEPTION`
- `CASH_VARIANCE`

Warnings are not generic UI strings. They preserve reason codes for tests, logs, exports, and routing.

## 11. Drill contract

```ts
export interface DashboardDrillTarget {
  kind: 'drawer' | 'page' | 'action_center';
  route: string;
  query: Record<string, string | number | boolean>;
  permission: string;
  label: string;
}
```

The target includes normalized context. A category source group must open only matching rows.

## 12. KPI detail response

```ts
export interface DashboardDetailResponse<TRow> {
  reportKey: string;
  reportVersion: string;
  generatedAt: string;
  timezone: 'Asia/Dhaka';
  metric: DashboardMetricDefinitionSummary;
  filters: AdminDashboardRequest & Record<string, unknown>;
  sourceStatus: DashboardSourceStatus;
  summary: {
    total: number | null;
    rowCount: number;
    aggregates: Record<string, number | string | null>;
  };
  groups: Array<{
    key: string;
    label: string;
    count: number;
    amount?: number;
  }>;
  reconciliation?: ReconciliationResult;
  warnings: DashboardWarning[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    hasNextPage: boolean;
  };
  rows: TRow[];
  permissions: DashboardPermissionSummary;
}
```

The current generic `KpiBreakdownData` should be extended or replaced through an additive versioned migration. Legacy callers remain supported until all dashboard consumers move.

## 13. Financial reconciliation view

```ts
export interface FinancialReconciliationView {
  period: {
    startDate: string;
    endDate: string;
  };
  billing: ReconciliationBridge;
  collection: ReconciliationBridge;
  cash: ReconciliationBridge;
  custody: ReconciliationBridge;
  overall: ReconciliationResult;
  warnings: DashboardWarning[];
}

export interface ReconciliationBridge {
  title: string;
  rows: Array<{
    key: string;
    label: string;
    operator: 'start' | 'add' | 'subtract' | 'equals';
    value: number | null;
    temporalMode: DashboardTemporalMode;
    dateBasis: DashboardDateBasis;
    sourceStatus: DashboardSourceStatus;
    drill: DashboardDrillTarget;
  }>;
  reconciliation: ReconciliationResult;
}
```

## 14. Operations contract

```ts
export interface OperationsOverview {
  periodFlow: {
    temporalMode: 'period';
    stages: Array<{
      key: string;
      label: string;
      count: number | null;
      completionRateFromPrevious?: number | null;
      sourceStatus: DashboardSourceStatus;
      drill: DashboardDrillTarget;
    }>;
  };
  currentCapacity: {
    temporalMode: 'live' | 'as_of';
    generatedAt: string;
    metrics: DashboardMetricResult[];
  };
}
```

Do not calculate conversion rates between stages with incompatible grains or incomplete attribution.

## 15. Domain health contract

```ts
export interface DomainHealthSummary {
  domain: 'laboratory' | 'inventory' | 'reagent' | 'radiology' | 'pharmacy' | 'ipd';
  state: DashboardHealthState;
  criticalCount: number;
  warningCount: number;
  highlights: Array<{
    label: string;
    value: number | string;
  }>;
  generatedAt: string;
  sourceStatus: DashboardSourceStatus;
  drill: DashboardDrillTarget;
}
```

## 16. Action Center integration

The dashboard overview reads only summarized queue state. Action detail and mutation remain under Action Center routes.

```ts
export interface DashboardActionSummary {
  generatedAt: string;
  state: DashboardHealthState;
  critical: number;
  warning: number;
  info: number;
  slaBreached: number;
  items: Array<{
    id: string;
    ruleKey: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    count: number;
    amount?: number;
    oldestAgeSeconds?: number;
    owner?: string;
    capability: 'manage' | 'review_only';
    drill: DashboardDrillTarget;
  }>;
}
```

Frontend must remove duplicate heuristic exception generation after this contract is adopted.

## 17. Audit event contract

```ts
export interface DashboardAuditEvent {
  id: string;
  eventType: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  occurredAt: string;
  actor: {
    id?: number;
    displayName: string;
  };
  subject: {
    type: string;
    reference: string;
  };
  narrative: string;
  amountDifference?: number;
  reviewStatus?: string;
  drill: DashboardDrillTarget;
}
```

Severity is generated by business policy, not by mapping `create/update/delete` in the browser.

## 18. Permission contract

```ts
export interface DashboardPermissionSummary {
  financialOverviewVisible: boolean;
  patientIdentifiersVisible: boolean;
  commissionDetailsVisible: boolean;
  auditDetailsVisible: boolean;
  exportAllowed: boolean;
  actionManagementAllowed: boolean;
}
```

Rules:

- Server omits or masks denied fields.
- Hidden frontend columns are not treated as security.
- Every endpoint enforces tenant and permission scope.
- Detail and export permissions may be stricter than summary permissions.

Suggested permission names:

- `dashboard.admin.read`
- `dashboard.financial.read`
- `dashboard.patient_details.read`
- `dashboard.commission_details.read`
- `dashboard.audit_details.read`
- `dashboard.export`
- `action_center.manage`

## 19. Endpoint architecture

### 19.1 Recommended endpoints

- `GET /api/dashboard/admin-overview`
- `GET /api/dashboard/metric-detail`
- `GET /api/dashboard/trend`
- `GET /api/dashboard/payment-mix`
- `GET /api/dashboard/live-state`
- Existing dedicated analytics routes for full pages during migration

### 19.2 Overview provider pattern

Implement small domain providers behind a service layer:

```text
Admin overview route
→ normalize filters and permissions
→ resolve role preset/metric definitions
→ call only required providers
→ assemble health/reconciliation
→ return compact response
```

Providers may include:

- billing and collection,
- expense and payout,
- due and deposit,
- cash/custody,
- operations/capacity,
- Action Center,
- domain health.

### 19.3 Hot-path constraints

- Avoid one query per card.
- Group compatible measures in bounded queries.
- Do not load detail rows for overview.
- Do not request disabled domains.
- Limit synchronous provider concurrency.
- Use indexed tenant + business-date access paths.
- Return partial domain status rather than failing unrelated domains.
- Heavy exports use queue/R2 patterns, not dashboard requests.

## 20. Versioning and migration

### Additive phase

1. Add shared semantic types and registry fields.
2. Add versioned overview response alongside current endpoints.
3. Add response adapters for current KPI cards.
4. Add reconciliation and source status without removing legacy fields.
5. Migrate admin dashboard consumers.
6. Migrate MD/director consumers where appropriate.
7. Remove unused legacy ambiguity only after parity tests pass.

### Feature flags

Suggested flags:

- `admin_dashboard_control_center_v1`
- `admin_dashboard_role_presets_v1`
- `admin_dashboard_reconciliation_v1`
- `admin_dashboard_business_audit_v1`

Flags are tenant-aware and do not authorize data access.

## 21. Invariants

1. `summaryTotal === detailTotal + unexplainedDifference` within defined rounding semantics.
2. A complete zero has complete required-source coverage.
3. A partial metric never claims healthy/balanced status.
4. A live metric never claims to follow a historical period.
5. Unknown/unmapped amounts are never silently dropped.
6. Current page rows are never used to calculate full-result aggregates.
7. Screen and export use the same normalized filters and report version.
8. Provider-mode mirrored events are compared, not double-counted.
9. Patient identifiers are not returned without permission.
10. Every drill target preserves the metric context.

## 22. API acceptance criteria

- Invalid dates and unsupported date bases return `400` with field-specific errors.
- Response echoes normalized filters and Asia/Dhaka timezone.
- Every metric returns temporal mode, date basis, generatedAt, source status, warnings, and drill target.
- Financial metrics return reconciliation.
- Comparison interpretation follows registry direction.
- Source failure produces null/partial state, not a false zero.
- Role preset requests call only required providers.
- Detail totals reconcile independently of pagination.
- Tenant/permission tests reject cross-scope access.
- Response size and latency budgets are measured in integration tests.

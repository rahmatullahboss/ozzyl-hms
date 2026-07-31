export const DASHBOARD_TEMPORAL_MODES = ['period', 'as_of', 'live'] as const;
export type DashboardTemporalMode = (typeof DASHBOARD_TEMPORAL_MODES)[number];

export const DASHBOARD_DATE_BASES = [
  'service_date',
  'bill_date',
  'payment_date',
  'posting_date',
  'movement_date',
  'approval_date',
  'admission_date',
  'discharge_date',
  'census_date',
  'commission_accrual_date',
  'commission_settlement_date',
  'business_date',
  'current_state',
] as const;
export type DashboardDateBasis = (typeof DASHBOARD_DATE_BASES)[number];

export const DASHBOARD_HEALTH_STATES = [
  'healthy',
  'warning',
  'partial',
  'stale',
  'unreconciled',
  'unavailable',
] as const;
export type DashboardHealthState = (typeof DASHBOARD_HEALTH_STATES)[number];

export const DASHBOARD_SOURCE_STATES = ['complete', 'partial', 'stale', 'unavailable'] as const;
export type DashboardSourceState = (typeof DASHBOARD_SOURCE_STATES)[number];

export const DASHBOARD_MONEY_METADATA = {
  currencyCode: 'BDT',
  moneyUnit: 'major',
} as const;

export type MetricDesirableDirection = 'higher' | 'lower' | 'target_range' | 'zero' | 'neutral';
export type DashboardComparisonMode = 'previous_period' | 'previous_day' | 'previous_month' | 'none';
export type DashboardRolePreset = 'hospital_admin' | 'md_director' | 'accountant' | 'manager_operations';
export type DashboardSection =
  | 'primary'
  | 'financial'
  | 'operations'
  | 'domain_health'
  | 'live'
  | 'money'
  | 'doctors'
  | 'patients'
  | 'ipd'
  | 'diagnostics'
  | 'inventory'
  | 'audit';

export interface AdminDashboardRequest {
  preset: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | '7d' | '30d' | 'custom';
  startDate: string;
  endDate: string;
  dateBasis?: DashboardDateBasis;
  branchId?: number;
  departmentId?: number;
  doctorId?: number;
  testSearch?: string;
  rolePreset?: DashboardRolePreset;
}

export interface DashboardDrillTarget {
  kind: 'drawer' | 'page' | 'action_center';
  route: string;
  query: Record<string, string | number | boolean>;
  permission: string;
  label: string;
}

export interface DashboardSourceFailure {
  source: string;
  reasonCode: string;
  message: string;
}

export interface DashboardSourceStatus {
  state: DashboardSourceState;
  requiredSources: string[];
  loadedSources: string[];
  unavailableSources: DashboardSourceFailure[];
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
  detailTotal: number | null;
  unexplainedDifference: number | null;
  tolerance: number;
  isBalanced: boolean | null;
  detailRowCount: number;
  providerMode?: 'legacy' | 'shadow' | 'canonical_preferred' | 'canonical_only';
  checkedAt: string;
}

export interface FinancialReconciliationEnvelope extends ReconciliationResult {
  detailGrain: string;
  status: 'reconciled' | 'warning' | 'unavailable';
  warnings: string[];
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
  formula: string;
  valueType: 'money' | 'count' | 'percentage' | 'duration';
  temporalMode: DashboardTemporalMode;
  dateBasis: DashboardDateBasis;
  desirableDirection: MetricDesirableDirection;
  sourceOfTruth: string[];
  comparisonMode: DashboardComparisonMode;
  reconciliationRequired: boolean;
  defaultRoles: DashboardRolePreset[];
  section: DashboardSection;
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
  currencyCode?: typeof DASHBOARD_MONEY_METADATA.currencyCode;
  moneyUnit?: typeof DASHBOARD_MONEY_METADATA.moneyUnit;
  filters: AdminDashboardRequest;
  comparisonPeriod?: {
    startDate: string;
    endDate: string;
    label: string;
  };
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

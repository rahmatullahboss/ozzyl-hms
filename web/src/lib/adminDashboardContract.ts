import {
  dashboardWorkspaceForMetric,
  type AdminDashboardOverviewResponse,
  type DashboardMetricResult,
  type DashboardSourceState,
  type DashboardWorkspace,
} from '../../../packages/shared/src/dashboard';

export interface AdminDashboardMetricViewModel extends DashboardMetricResult {
  isAvailable: boolean;
  sourceState: DashboardSourceState;
}

export interface AdminDashboardViewModel {
  reportKey: AdminDashboardOverviewResponse['reportKey'];
  reportVersion: string;
  generatedAt: string;
  timezone: AdminDashboardOverviewResponse['timezone'];
  currencyCode: 'BDT';
  moneyUnit: 'major';
  filters: AdminDashboardOverviewResponse['filters'];
  comparisonPeriod?: AdminDashboardOverviewResponse['comparisonPeriod'];
  health: AdminDashboardOverviewResponse['health'];
  metrics: AdminDashboardMetricViewModel[];
  operations: unknown;
  domainHealth: unknown[];
  permissions: AdminDashboardOverviewResponse['permissions'];
}

function metricAvailable(metric: DashboardMetricResult): boolean {
  return metric.value !== null
    && metric.sourceStatus.state !== 'partial'
    && metric.sourceStatus.state !== 'unavailable';
}

export function mapAdminDashboardOverview(
  response: AdminDashboardOverviewResponse,
): AdminDashboardViewModel {
  return {
    reportKey: response.reportKey,
    reportVersion: response.reportVersion,
    generatedAt: response.generatedAt,
    timezone: response.timezone,
    currencyCode: response.currencyCode ?? 'BDT',
    moneyUnit: response.moneyUnit ?? 'major',
    filters: response.filters,
    comparisonPeriod: response.comparisonPeriod,
    health: response.health,
    metrics: response.primaryMetrics.map((metric) => ({
      ...metric,
      isAvailable: metricAvailable(metric),
      sourceState: metric.sourceStatus.state,
    })),
    operations: response.operations,
    domainHealth: response.domainHealth,
    permissions: response.permissions,
  };
}

export function workspaceForConfiguredMetric(metricKey: string): DashboardWorkspace {
  return dashboardWorkspaceForMetric(metricKey);
}

import {
  ADMIN_DASHBOARD_METRICS,
  ADMIN_DASHBOARD_ROLE_PRESETS,
  DASHBOARD_MONEY_METADATA,
  type AdminDashboardOverviewResponse,
  type DashboardHealthState,
  type DashboardMetricDefinition,
  type DashboardMetricResult,
  type DashboardPermissionSummary,
  type DashboardRolePreset,
  type DashboardWarning,
} from '../../../packages/shared/src/dashboard';
import type { DashboardFilterContext } from './filter-context';

export type DashboardProviderDomain = 'financial' | 'operations' | 'domain_health';

export interface DashboardOverviewProviderInput {
  context: DashboardFilterContext;
  metrics: DashboardMetricDefinition[];
  generatedAt: string;
}

export interface DashboardOverviewProviderResult {
  domain: string;
  metrics: DashboardMetricResult[];
  warnings: DashboardWarning[];
  operations?: unknown;
  domainHealth?: unknown[];
}

export type DashboardOverviewProvider = (
  input: DashboardOverviewProviderInput,
) => Promise<DashboardOverviewProviderResult>;

export interface DashboardOverviewProviders {
  financial: DashboardOverviewProvider;
  operations: DashboardOverviewProvider;
  domainHealth: DashboardOverviewProvider;
}

export interface AssembleAdminDashboardOverviewInput {
  context: DashboardFilterContext;
  rolePreset: DashboardRolePreset;
  permissions: string[];
  generatedAt?: string;
  providers: DashboardOverviewProviders;
}

function hasPermission(permissions: string[], required: string): boolean {
  return permissions.includes('*') || permissions.includes(required);
}

function providerDomainForMetric(metric: DashboardMetricDefinition): DashboardProviderDomain {
  if (metric.key === 'pending_approvals' || metric.section === 'operations') return 'operations';
  if (metric.key === 'critical_inventory_exceptions' || metric.section === 'domain_health' || metric.section === 'inventory') {
    return 'domain_health';
  }
  return 'financial';
}

function permissionSummary(permissions: string[]): DashboardPermissionSummary {
  const can = (permission: string) => hasPermission(permissions, permission);
  return {
    financialOverviewVisible: can('billing:report:read'),
    patientIdentifiersVisible: can('patients:read') || can('mpi:read'),
    commissionDetailsVisible: can('billing:report:read'),
    auditDetailsVisible: can('billing:report:read'),
    exportAllowed: can('billing:report:read'),
    actionManagementAllowed: can('billing:report:read'),
  };
}

function overallHealth(args: {
  completed: string[];
  partial: string[];
  unavailable: string[];
  stale: string[];
  unreconciled: string[];
  warnings: DashboardWarning[];
  metricCount: number;
}): DashboardHealthState {
  if (args.metricCount === 0 && args.unavailable.length > 0) return 'unavailable';
  if (args.partial.length > 0 || args.unavailable.length > 0) return 'partial';
  if (args.unreconciled.length > 0) return 'unreconciled';
  if (args.stale.length > 0) return 'stale';
  if (args.warnings.length > 0) return 'warning';
  return 'healthy';
}

export async function assembleAdminDashboardOverview(
  input: AssembleAdminDashboardOverviewInput,
): Promise<AdminDashboardOverviewResponse> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const preset = ADMIN_DASHBOARD_ROLE_PRESETS[input.rolePreset];
  const registryByKey = new Map(ADMIN_DASHBOARD_METRICS.map((metric) => [metric.key, metric]));
  const requestedMetrics = preset.primaryMetricKeys
    .map((key) => registryByKey.get(key))
    .filter((metric): metric is DashboardMetricDefinition => Boolean(metric))
    .filter((metric) => hasPermission(input.permissions, metric.requiredPermission));

  const grouped: Record<DashboardProviderDomain, DashboardMetricDefinition[]> = {
    financial: [],
    operations: [],
    domain_health: [],
  };
  for (const metric of requestedMetrics) grouped[providerDomainForMetric(metric)].push(metric);

  const providerEntries: Array<[DashboardProviderDomain, DashboardOverviewProvider, DashboardMetricDefinition[]]> = [
    ['financial', input.providers.financial, grouped.financial],
    ['operations', input.providers.operations, grouped.operations],
    ['domain_health', input.providers.domainHealth, grouped.domain_health],
  ].filter((entry) => entry[2].length > 0) as Array<[DashboardProviderDomain, DashboardOverviewProvider, DashboardMetricDefinition[]]>;

  const settled = await Promise.allSettled(providerEntries.map(async ([domain, provider, metrics]) => ({
    domain,
    result: await provider({ context: input.context, metrics, generatedAt }),
  })));

  const metrics: DashboardMetricResult[] = [];
  const warnings: DashboardWarning[] = [];
  const completeDomains: string[] = [];
  const partialDomains: string[] = [];
  const unavailableDomains: string[] = [];
  const staleDomains: string[] = [];
  const unreconciledDomains: string[] = [];
  let operations: unknown = null;
  const domainHealth: unknown[] = [];

  settled.forEach((entry, index) => {
    const domain = providerEntries[index][0];
    if (entry.status === 'rejected') {
      unavailableDomains.push(domain);
      warnings.push({
        code: 'DASHBOARD_PROVIDER_UNAVAILABLE',
        severity: 'warning',
        domain,
        message: entry.reason instanceof Error ? entry.reason.message : 'Dashboard provider unavailable',
      });
      return;
    }

    const result = entry.value.result;
    metrics.push(...result.metrics);
    warnings.push(...result.warnings);
    if (result.operations !== undefined) operations = result.operations;
    if (result.domainHealth) domainHealth.push(...result.domainHealth);

    const states = new Set(result.metrics.map((metric) => metric.sourceStatus.state));
    if (states.has('unavailable')) unavailableDomains.push(domain);
    else if (states.has('partial')) partialDomains.push(domain);
    else if (states.has('stale')) staleDomains.push(domain);
    else completeDomains.push(domain);

    if (result.metrics.some((metric) => metric.reconciliation?.isBalanced === false)) {
      unreconciledDomains.push(domain);
    }
  });

  const order = new Map(preset.primaryMetricKeys.map((key, index) => [key, index]));
  metrics.sort((a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER));

  return {
    reportKey: 'admin_control_center',
    reportVersion: '2.0.0',
    generatedAt,
    timezone: 'Asia/Dhaka',
    currencyCode: DASHBOARD_MONEY_METADATA.currencyCode,
    moneyUnit: DASHBOARD_MONEY_METADATA.moneyUnit,
    filters: { ...input.context.request, rolePreset: input.rolePreset },
    comparisonPeriod: input.context.comparisonPeriod ?? undefined,
    health: {
      state: overallHealth({
        completed: completeDomains,
        partial: partialDomains,
        unavailable: unavailableDomains,
        stale: staleDomains,
        unreconciled: unreconciledDomains,
        warnings,
        metricCount: metrics.length,
      }),
      completeDomains,
      partialDomains,
      unavailableDomains,
      staleDomains,
      unreconciledDomains,
      warnings,
    },
    primaryMetrics: metrics,
    operations,
    domainHealth,
    permissions: permissionSummary(input.permissions),
  };
}

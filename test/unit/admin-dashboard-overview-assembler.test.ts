import { describe, expect, it, vi } from 'vitest';
import { ADMIN_DASHBOARD_ROLE_PRESETS } from '../../packages/shared/src/dashboard';
import {
  assembleAdminDashboardOverview,
  type DashboardOverviewProvider,
} from '../../src/lib/dashboard/admin-overview';
import { resolveDashboardFilterContext } from '../../src/lib/dashboard/filter-context';

const generatedAt = '2026-07-27T12:00:00.000Z';
const context = resolveDashboardFilterContext({ preset: 'today', today: '2026-07-27' });
if (!context) throw new Error('expected dashboard context');

function metricProvider(domain: string, calls: string[][]): DashboardOverviewProvider {
  return async ({ metrics }) => {
    calls.push(metrics.map((metric) => metric.key));
    return {
      domain,
      metrics: metrics.map((metric) => ({
        key: metric.key,
        label: metric.fallbackLabel,
        value: 100,
        valueType: metric.valueType,
        temporalMode: metric.temporalMode,
        dateBasis: metric.dateBasis,
        period: { ...context.period },
        generatedAt,
        sourceStatus: {
          state: 'complete',
          requiredSources: metric.sourceOfTruth,
          loadedSources: metric.sourceOfTruth,
          unavailableSources: [],
          generatedAt,
          staleAfterSeconds: 60,
        },
        comparison: metric.comparisonMode === 'none' ? undefined : {
          currentValue: 100,
          comparisonValue: 90,
          absoluteChange: 10,
          percentageChange: 11.11,
          comparisonLabel: 'Previous period',
          desirableDirection: metric.desirableDirection,
          interpretation: 'neutral',
        },
        reconciliation: metric.reconciliationRequired ? {
          summaryTotal: 100,
          detailTotal: 100,
          unexplainedDifference: 0,
          tolerance: 0.01,
          isBalanced: true,
          detailRowCount: 1,
          checkedAt: generatedAt,
        } : undefined,
        warnings: [],
        drill: metric.drillTarget,
      })),
      warnings: [],
    };
  };
}

describe('admin dashboard overview assembler', () => {
  it('executes providers only for requested role-preset metrics', async () => {
    const financialCalls: string[][] = [];
    const operationsCalls: string[][] = [];
    const domainCalls: string[][] = [];

    const result = await assembleAdminDashboardOverview({
      context,
      rolePreset: 'hospital_admin',
      permissions: ['*'],
      generatedAt,
      providers: {
        financial: metricProvider('financial', financialCalls),
        operations: metricProvider('operations', operationsCalls),
        domainHealth: metricProvider('domain_health', domainCalls),
      },
    });

    const requested = ADMIN_DASHBOARD_ROLE_PRESETS.hospital_admin.primaryMetricKeys;
    expect(result.primaryMetrics.map((metric) => metric.key).sort()).toEqual([...requested].sort());
    expect([...financialCalls, ...operationsCalls, ...domainCalls].flat().sort()).toEqual([...requested].sort());
  });

  it('captures one provider failure without crashing healthy domains', async () => {
    const result = await assembleAdminDashboardOverview({
      context,
      rolePreset: 'hospital_admin',
      permissions: ['*'],
      generatedAt,
      providers: {
        financial: vi.fn(async () => { throw new Error('financial source failed'); }),
        operations: metricProvider('operations', []),
        domainHealth: metricProvider('domain_health', []),
      },
    });

    expect(result.health.state).toBe('partial');
    expect(result.health.unavailableDomains).toContain('financial');
    expect(result.health.warnings.some((warning) => warning.code === 'DASHBOARD_PROVIDER_UNAVAILABLE')).toBe(true);
    expect(result.primaryMetrics.some((metric) => metric.key === 'pending_approvals')).toBe(true);
  });

  it('does not fan out beyond the bounded primary preset', async () => {
    const calls: string[][] = [];
    await assembleAdminDashboardOverview({
      context,
      rolePreset: 'hospital_admin',
      permissions: ['*'],
      generatedAt,
      providers: {
        financial: metricProvider('financial', calls),
        operations: metricProvider('operations', calls),
        domainHealth: metricProvider('domain_health', calls),
      },
    });

    expect(calls.flat().length).toBeLessThanOrEqual(10);
  });

  it('filters metrics by required permission before provider execution', async () => {
    const calls: string[][] = [];
    const result = await assembleAdminDashboardOverview({
      context,
      rolePreset: 'hospital_admin',
      permissions: ['billing:report:read'],
      generatedAt,
      providers: {
        financial: metricProvider('financial', calls),
        operations: metricProvider('operations', calls),
        domainHealth: metricProvider('domain_health', calls),
      },
    });

    expect(result.primaryMetrics.every((metric) => ['total_collection', 'operating_result', 'doctor_payable_outstanding', 'pending_approvals'].includes(metric.key))).toBe(true);
    expect(calls.flat()).not.toContain('available_drawer_cash');
    expect(calls.flat()).not.toContain('critical_inventory_exceptions');
  });

  it('preserves generated time, source health, comparison, and reconciliation', async () => {
    const result = await assembleAdminDashboardOverview({
      context,
      rolePreset: 'accountant',
      permissions: ['*'],
      generatedAt,
      providers: {
        financial: metricProvider('financial', []),
        operations: metricProvider('operations', []),
        domainHealth: metricProvider('domain_health', []),
      },
    });

    expect(result.generatedAt).toBe(generatedAt);
    expect(result.health.state).toBe('healthy');
    expect(result.primaryMetrics.some((metric) => metric.comparison)).toBe(true);
    expect(result.primaryMetrics.some((metric) => metric.reconciliation?.isBalanced)).toBe(true);
  });
});

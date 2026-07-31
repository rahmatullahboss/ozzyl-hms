import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_DATE_BASES,
  DASHBOARD_HEALTH_STATES,
  DASHBOARD_MONEY_METADATA,
  DASHBOARD_SOURCE_STATES,
  DASHBOARD_TEMPORAL_MODES,
  type AdminDashboardOverviewResponse,
  type DashboardMetricDefinition,
  type DashboardSourceStatus,
} from '../../packages/shared/src';

describe('admin dashboard shared semantic contract', () => {
  it('exports the supported temporal, date, health, and source states', () => {
    expect(DASHBOARD_TEMPORAL_MODES).toEqual(['period', 'as_of', 'live']);
    expect(DASHBOARD_DATE_BASES).toContain('service_date');
    expect(DASHBOARD_DATE_BASES).toContain('payment_date');
    expect(DASHBOARD_DATE_BASES).toContain('current_state');
    expect(DASHBOARD_HEALTH_STATES).toEqual([
      'healthy',
      'warning',
      'partial',
      'stale',
      'unreconciled',
      'unavailable',
    ]);
    expect(DASHBOARD_SOURCE_STATES).toEqual(['complete', 'partial', 'stale', 'unavailable']);
  });

  it('uses BDT major units for dashboard money metadata', () => {
    expect(DASHBOARD_MONEY_METADATA).toEqual({ currencyCode: 'BDT', moneyUnit: 'major' });
  });

  it('supports complete, partial, stale, and unavailable source status shapes', () => {
    const status: DashboardSourceStatus = {
      state: 'partial',
      requiredSources: ['bills', 'payments'],
      loadedSources: ['bills'],
      unavailableSources: [{ source: 'payments', reasonCode: 'QUERY_FAILED', message: 'Payments unavailable' }],
      generatedAt: '2026-07-27T12:00:00.000Z',
      staleAfterSeconds: 60,
    };

    expect(status.state).toBe('partial');
    expect(status.unavailableSources).toHaveLength(1);
  });

  it('defines complete metric and overview shapes through the shared barrel', () => {
    const metric: DashboardMetricDefinition = {
      key: 'total_collection',
      labelKey: 'adminDashboard.metrics.totalCollection',
      fallbackLabel: 'Total collection',
      description: 'Payments received during the selected period.',
      formula: 'sum of eligible payment receipts',
      valueType: 'money',
      temporalMode: 'period',
      dateBasis: 'payment_date',
      desirableDirection: 'neutral',
      sourceOfTruth: ['payments'],
      comparisonMode: 'previous_period',
      reconciliationRequired: true,
      defaultRoles: ['hospital_admin'],
      section: 'primary',
      drillTarget: {
        kind: 'page',
        route: '/cash/daily-collection',
        query: {},
        permission: 'billing:report:read',
        label: 'View details',
      },
      requiredPermission: 'billing:report:read',
    };

    const overview: AdminDashboardOverviewResponse = {
      reportKey: 'admin_control_center',
      reportVersion: '2.0.0',
      generatedAt: '2026-07-27T12:00:00.000Z',
      timezone: 'Asia/Dhaka',
      filters: {
        preset: 'today',
        startDate: '2026-07-27',
        endDate: '2026-07-27',
        rolePreset: 'hospital_admin',
      },
      health: {
        state: 'healthy',
        completeDomains: ['financial'],
        partialDomains: [],
        unavailableDomains: [],
        staleDomains: [],
        unreconciledDomains: [],
        warnings: [],
      },
      primaryMetrics: [],
      operations: null,
      domainHealth: [],
      permissions: {
        financialOverviewVisible: true,
        patientIdentifiersVisible: false,
        commissionDetailsVisible: true,
        auditDetailsVisible: true,
        exportAllowed: false,
        actionManagementAllowed: true,
      },
    };

    expect(metric.temporalMode).toBe('period');
    expect(overview.reportKey).toBe('admin_control_center');
  });
});

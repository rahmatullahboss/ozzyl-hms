import { describe, expect, it } from 'vitest';
import type { AdminDashboardOverviewResponse } from '../../../packages/shared/src/dashboard';
import {
  mapAdminDashboardOverview,
  workspaceForConfiguredMetric,
} from './adminDashboardContract';

const response: AdminDashboardOverviewResponse = {
  reportKey: 'admin_control_center',
  reportVersion: '2.0.0',
  generatedAt: '2026-07-27T12:00:00.000Z',
  timezone: 'Asia/Dhaka',
  currencyCode: 'BDT',
  moneyUnit: 'major',
  filters: {
    preset: 'today',
    startDate: '2026-07-27',
    endDate: '2026-07-27',
    rolePreset: 'hospital_admin',
  },
  health: {
    state: 'partial',
    completeDomains: ['operations'],
    partialDomains: [],
    unavailableDomains: ['financial'],
    staleDomains: [],
    unreconciledDomains: [],
    warnings: [{
      code: 'DASHBOARD_PROVIDER_UNAVAILABLE',
      severity: 'warning',
      domain: 'financial',
      message: 'Financial source unavailable',
    }],
  },
  primaryMetrics: [{
    key: 'doctor_payable_outstanding',
    label: 'Doctor payable outstanding',
    value: null,
    valueType: 'money',
    temporalMode: 'as_of',
    dateBasis: 'commission_accrual_date',
    period: { asOf: '2026-07-27', label: 'As of 2026-07-27' },
    generatedAt: '2026-07-27T12:00:00.000Z',
    sourceStatus: {
      state: 'unavailable',
      requiredSources: ['doctor_commission_accruals'],
      loadedSources: [],
      unavailableSources: [{
        source: 'doctor_commission_accruals',
        reasonCode: 'SOURCE_UNAVAILABLE',
        message: 'Unavailable',
      }],
      generatedAt: '2026-07-27T12:00:00.000Z',
      staleAfterSeconds: 60,
    },
    comparison: {
      currentValue: 0,
      comparisonValue: null,
      absoluteChange: null,
      percentageChange: null,
      comparisonLabel: 'Previous period',
      desirableDirection: 'lower',
      interpretation: 'not_comparable',
      reasonCode: 'COMPARISON_UNAVAILABLE',
    },
    reconciliation: {
      summaryTotal: 0,
      detailTotal: null,
      unexplainedDifference: null,
      tolerance: 0.01,
      isBalanced: null,
      detailRowCount: 0,
      checkedAt: '2026-07-27T12:00:00.000Z',
    },
    warnings: [{
      code: 'SOURCE_UNAVAILABLE',
      severity: 'warning',
      domain: 'doctors',
      message: 'Unavailable',
    }],
    drill: {
      kind: 'page',
      route: '/commissions',
      query: {},
      permission: 'billing:report:read',
      label: 'View details',
    },
  }],
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

describe('admin dashboard frontend contract adapter', () => {
  it('preserves unavailable values as null instead of zero', () => {
    const view = mapAdminDashboardOverview(response);
    expect(view.metrics[0]).toMatchObject({
      value: null,
      isAvailable: false,
      sourceState: 'unavailable',
    });
  });

  it('preserves comparison, reconciliation, source failures, and warnings', () => {
    const metric = mapAdminDashboardOverview(response).metrics[0];
    expect(metric.comparison?.reasonCode).toBe('COMPARISON_UNAVAILABLE');
    expect(metric.reconciliation?.detailTotal).toBeNull();
    expect(metric.sourceStatus.unavailableSources).toHaveLength(1);
    expect(metric.warnings).toHaveLength(1);
  });

  it('preserves overview health and permissions', () => {
    const view = mapAdminDashboardOverview(response);
    expect(view.health.state).toBe('partial');
    expect(view.permissions.patientIdentifiersVisible).toBe(false);
  });

  it('maps legacy configured metrics into command-center workspaces', () => {
    expect(workspaceForConfiguredMetric('cash_movement')).toBe('money');
    expect(workspaceForConfiguredMetric('total_commission')).toBe('doctors');
    expect(workspaceForConfiguredMetric('lab_income')).toBe('diagnostics');
    expect(workspaceForConfiguredMetric('inventory_low_stock')).toBe('inventory');
    expect(workspaceForConfiguredMetric('uncategorized_income')).toBe('audit');
  });
});

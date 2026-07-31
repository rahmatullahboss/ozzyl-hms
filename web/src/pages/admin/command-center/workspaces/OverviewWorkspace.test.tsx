import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type {
  AdminDashboardOverviewResponse,
  DashboardMetricResult,
} from '../../../../../../packages/shared/src/dashboard';
import OverviewWorkspace from './OverviewWorkspace';

vi.mock('../components/ActionCenterSummaryPanel', () => ({
  default: () => <section data-testid="action-center-summary-panel" />,
}));

function metric(index: number): DashboardMetricResult {
  return {
    key: `metric_${index}`,
    label: `Metric ${index}`,
    value: index * 100,
    valueType: 'money',
    temporalMode: 'period',
    dateBasis: 'payment_date',
    period: { startDate: '2026-07-21', endDate: '2026-07-27', label: '2026-07-21 → 2026-07-27' },
    generatedAt: '2026-07-27T12:00:00.000Z',
    sourceStatus: {
      state: 'complete',
      requiredSources: ['payments'],
      loadedSources: ['payments'],
      unavailableSources: [],
      generatedAt: '2026-07-27T12:00:00.000Z',
      staleAfterSeconds: 60,
    },
    reconciliation: {
      summaryTotal: index * 100,
      detailTotal: index * 100,
      unexplainedDifference: 0,
      tolerance: 0.01,
      isBalanced: true,
      detailRowCount: index,
      checkedAt: '2026-07-27T12:00:00.000Z',
    },
    warnings: [],
    drill: {
      kind: 'page',
      route: `/reports/metric-${index}`,
      query: { metric: index },
      permission: 'billing:report:read',
      label: 'View details',
    },
  };
}

const overview: AdminDashboardOverviewResponse = {
  reportKey: 'admin_control_center',
  reportVersion: '2.0.0',
  generatedAt: '2026-07-27T12:00:00.000Z',
  timezone: 'Asia/Dhaka',
  currencyCode: 'BDT',
  moneyUnit: 'major',
  filters: {
    preset: '7d',
    startDate: '2026-07-21',
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
  primaryMetrics: Array.from({ length: 12 }, (_, index) => metric(index + 1)),
  operations: null,
  domainHealth: [],
  permissions: {
    financialOverviewVisible: true,
    patientIdentifiersVisible: false,
    commissionDetailsVisible: true,
    auditDetailsVisible: true,
    exportAllowed: true,
    actionManagementAllowed: true,
  },
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}{useLocation().search}</output>;
}

function renderWorkspace(data = overview) {
  render(
    <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
      <OverviewWorkspace
        overview={data}
        basePath="/h/city-hospital"
        filters={{ preset: '7d', startDate: '2026-07-21', endDate: '2026-07-27' }}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('OverviewWorkspace', () => {
  it('renders no more than ten primary KPI cards', () => {
    renderWorkspace();
    expect(screen.getAllByTestId('command-center-kpi')).toHaveLength(10);
    expect(screen.getByTestId('action-center-summary-panel')).toBeInTheDocument();
  });

  it('does not mount dense doctor, test, income, expense, reagent, inventory, or radiology panels', () => {
    renderWorkspace();
    for (const testId of [
      'doctor-performance-panel',
      'test-performance-panel',
      'income-service-panel',
      'expense-analysis-panel',
      'reagent-reconciliation-panel',
      'admin-inventory-overview',
      'admin-radiology-stock-overview',
    ]) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  });

  it('opens the metric drill route with its query', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Metric 1 details' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/h/city-hospital/reports/metric-1?metric=1');
  });

  it('keeps PDF Center and Daily Pack actions for the selected range', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF Center for selected dashboard range' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/h/city-hospital/reports/pdf?from=2026-07-21&to=2026-07-27');

    renderWorkspace();
    const dailyButtons = screen.getAllByRole('button', { name: 'Print daily closing PDF pack for selected dashboard range' });
    fireEvent.click(dailyButtons[dailyButtons.length - 1]);
    const locations = screen.getAllByTestId('location');
    expect(locations[locations.length - 1]).toHaveTextContent('/h/city-hospital/reports/pdf?pack=daily-closing&from=2026-07-21&to=2026-07-27&autoprint=1');
  });

  it('shows unavailable values as unavailable rather than zero', () => {
    const unavailable = {
      ...overview,
      primaryMetrics: [{
        ...metric(1),
        value: null,
        sourceStatus: {
          ...metric(1).sourceStatus,
          state: 'unavailable' as const,
          loadedSources: [],
          unavailableSources: [{ source: 'payments', reasonCode: 'FAILED', message: 'Unavailable' }],
        },
      }],
    };
    renderWorkspace(unavailable);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});

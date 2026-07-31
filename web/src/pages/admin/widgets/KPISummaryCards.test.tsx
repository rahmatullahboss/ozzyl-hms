import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import KPISummaryCards from './KPISummaryCards';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));

vi.mock('../../../components/dashboard/KPICard', () => ({
  default: ({
    title,
    value,
    loading,
    onClick,
    detailHint,
  }: {
    title: string;
    value: string | number;
    loading?: boolean;
    onClick?: () => void;
    detailHint?: string;
  }) => (
    <button type="button" data-testid="kpi-card" onClick={onClick} disabled={!onClick}>
      <span>{title}</span>
      <span>{loading ? 'Loading...' : String(value)}</span>
      {detailHint ? <span>{detailHint}</span> : null}
    </button>
  ),
}));

vi.mock('../../../components/dashboard/KpiBreakdownDrawer', () => ({
  default: ({ title, data, labels, onClose, onRowClick, onSourceClick, onClearSourceFilter }: any) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <p>{labels.sources}</p>
      {data?.sources?.map((source: any) => onSourceClick && (source.doctorId || source.key) ? (
        <button key={source.label} type="button" onClick={() => onSourceClick(source)}>{source.label}</button>
      ) : <span key={source.label}>{source.label}</span>)}
      {data?.rows?.filter((row: any) => row.billId).map((row: any) => (
        <button key={row.id} type="button" onClick={() => onRowClick?.(row)}>Open invoice {row.invoiceNo}</button>
      ))}
      {onClearSourceFilter ? <button type="button" onClick={onClearSourceFilter}>{labels.showAllDoctors}</button> : null}
      <button type="button" onClick={onClose}>{labels.close}</button>
    </div>
  ),
}));

vi.mock('../../../components/dashboard/AdminKpiInvoiceModal', () => ({
  default: ({ billId, onClose }: { billId: number; onClose: () => void }) => (
    <div role="dialog" aria-label={`Invoice ${billId}`} data-testid="admin-kpi-invoice-modal">
      {billId}
      <button type="button" onClick={onClose}>Close invoice</button>
    </div>
  ),
}));

vi.mock('../../../lib/i18n', () => ({
  default: { get language() { return 'en'; } },
}));

const dashboardData = {
  finance: { todayCollection: 50000, todayExpense: 10000, patientDue: 5000, todayDeposit: 7000 },
  todaySummary: { newPatients: 25, admittedPatients: 8, totalDiscount: 2000 },
  patientSummary: { opdPatients: 31 },
};

const cashMovementBreakdown = {
  metric: 'cash_movement',
  title: "Today's Cash Movement",
  total: 45000,
  period: { startDate: '2026-06-24', endDate: '2026-06-24', label: '2026-06-24' },
  sources: [
    { label: 'mdDashboard.kpi.cashMovementSourceVisit', amount: 18000, count: 8 },
    { label: 'mdDashboard.kpi.cashMovementSourceTest', amount: 10000, count: 4 },
    { label: 'mdDashboard.kpi.cashMovementSourceAdmission', amount: 33900, count: 1 },
    { label: 'mdDashboard.kpi.cashMovementSourceDueCollection', amount: 15000, count: 4 },
    { label: 'mdDashboard.kpi.cashMovementSourceDeposit', amount: 7000, count: 2 },
    { label: 'mdDashboard.kpi.cashMovementSourcePayout', amount: -5000, count: 2 },
  ],
  rows: [],
};

const expenseBreakdown = {
  metric: 'accounting_expenses',
  title: 'Accounting Expenses',
  total: 10000,
  period: { startDate: '2026-06-24', endDate: '2026-06-24', label: '2026-06-24' },
  sources: [
    { label: 'Utilities', amount: 6000, count: 2 },
    { label: 'Office supplies', amount: 4000, count: 1 },
  ],
  rows: [],
};

const reagentReconciliation = {
  period: { startDate: '2026-06-24', endDate: '2026-06-24', label: '2026-06-24' },
  rows: [{
    consumableId: 1,
    reagentCode: 'CBC-R1',
    reagentName: 'CBC Reagent',
    unit: 'ml',
    completedTests: 20,
    expectedUsage: 40,
    actualUsage: 42,
    returnedQuantity: 1,
    variance: 1,
    currentStock: 120,
    reorderLevel: 50,
    status: 'ok',
  }],
  quantityTotals: [{ unit: 'ml', quantity: 42 }],
  exceptions: { unmappedCompletedTests: 0, consumptionExceptions: 0, unmappedTests: [] },
  availability: { mapping: true, movements: true, stock: true },
  page: 1,
  pageSize: 25,
  totalRows: 26,
  hasNextPage: true,
};

function StatefulKpis() {
  const [filters, setFilters] = useState({
    preset: 'today' as const,
    startDate: '2026-06-24',
    endDate: '2026-06-24',
  });
  return <KPISummaryCards filters={filters} onFiltersChange={setFilters} />;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderKpis() {
  return render(
    <MemoryRouter initialEntries={["/h/demo/admin?range=7d"]}>
      <StatefulKpis />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function mockDashboardWithBreakdowns() {
  const metricTotals: Record<string, number> = {
    accounting_income: 50000,
    accounting_expenses: 10000,
    accounting_profit: 40000,
    opd_income: 18000,
    lab_income: 12000,
    ipd_collection: 7000,
    ot_income: 3000,
    pharmacy_income: 2500,
    radiology_income: 1500,
    deposit_collection: 6000,
    uncategorized_income: 500,
    test_commission: 4000,
    total_commission: 4000,
    total_visits: 31,
    pending_approvals: 5,
    cash_received: 50000,
    cash_movement: 45000,
    drawer_cash: 5301,
  };

  vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => {
    if (path.includes('/api/dashboard/kpi-config')) {
      return { data: undefined, isLoading: false, isError: false };
    }
    if (path.includes('/api/dashboard/kpi-summary')) {
      return {
        data: {
          period: cashMovementBreakdown.period,
          metrics: Object.entries(metricTotals).map(([metric, total]) => ({
            metric,
            title: metric,
            total,
            valueType: metric === 'total_visits' || metric === 'pending_approvals' ? 'count' : 'money',
          })),
        },
        isLoading: false,
        isError: false,
      };
    }
    const metricMatch = path.match(/metric=([^&]+)/);
    const metric = metricMatch?.[1];
    if (metric === 'cash_movement') {
      return { data: cashMovementBreakdown, isLoading: false, isError: false };
    }
    if (metric === 'accounting_expenses') {
      return { data: expenseBreakdown, isLoading: false, isError: false };
    }
    if (metric === 'doctor_payout') {
      return { data: { ...cashMovementBreakdown, metric: 'doctor_payout', title: 'Doctor Payouts' }, isLoading: false, isError: false };
    }
    if (metric && Object.hasOwn(metricTotals, metric)) {
      return {
        data: {
          ...cashMovementBreakdown,
          metric,
          title: metric,
          total: metricTotals[metric],
          sources: metric === 'cash_received'
            ? cashMovementBreakdown.sources.filter((source) => !String(source.label).includes('Payout'))
            : metric === 'test_commission'
              ? [{ label: 'Dr. Example Four', amount: 4000, count: 11, key: '17', doctorId: 17 }]
              : [],
          rows: metric === 'ot_income'
            ? [{
                id: 'ot-admin-1',
                occurredAt: '2026-06-24 10:00:00',
                sourceType: 'payment',
                sourceLabel: 'OT',
                referenceNo: 'R-OT',
                amount: 3000,
                status: 'paid',
                billId: 777,
                invoiceNo: 'INV-OT-777',
                patientName: 'Admin Patient',
                patientCode: 'P-777',
                serviceNames: 'OT package',
                grossAmount: 3200,
                discountAmount: 200,
                paidAmount: 3000,
                dueAmount: 0,
              }]
            : metric === 'test_commission' && path.includes('doctorId=17')
              ? [{
                  id: 'commission-invoice-17-bill-91',
                  occurredAt: '2026-06-24 11:00:00',
                  sourceType: 'commission',
                  sourceLabel: 'Dr. Example Four',
                  referenceNo: 'INV-91',
                  amount: 4000,
                  status: 'approved',
                  billId: 91,
                  invoiceNo: 'INV-91',
                  patientName: 'Commission Patient',
                  patientCode: 'P-91',
                  serviceNames: 'CBC, Lipid Profile',
                  itemCount: 2,
                }]
              : [],
        },
        isLoading: false,
        isError: false,
      };
    }
    return { data: dashboardData, isLoading: false, isError: false, refetch: vi.fn() };
  }) as never);
}

describe('KPISummaryCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders cash-control and operations KPI cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    renderKpis();
    const cards = screen.getAllByTestId('kpi-card');
    expect(cards).toHaveLength(44);
    expect(screen.getByTestId('admin-management-overview')).toBeInTheDocument();
    expect(screen.getByTestId('admin-cash-control-overview')).toBeInTheDocument();
    expect(screen.getByTestId('admin-test-performance-overview')).toBeInTheDocument();
    expect(screen.getByTestId('admin-approvals-overview')).toBeInTheDocument();
    expect(screen.getByTestId('admin-inventory-overview')).toBeInTheDocument();
    expect(screen.getByTestId('admin-lab-reagent-overview')).toBeInTheDocument();
    expect(screen.getByTestId('admin-radiology-stock-overview')).toBeInTheDocument();
    expect(screen.getByTestId('admin-operations-summary')).toBeInTheDocument();
  });

  it('requests the next reagent reconciliation page from the dashboard host', async () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => {
      const baseState = { isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
      if (path.includes('/api/dashboard/kpi-config')) {
        return {
          ...baseState,
          data: {
            dashboardKey: 'executive',
            items: [{
              metricKey: 'reagent_reconciliation_table',
              section: 'lab_reagent',
              kind: 'panel',
              enabled: true,
              position: 89,
              label: 'Reagent Reconciliation',
              labelOverride: null,
            }],
          },
        };
      }
      if (path.includes('/api/dashboard/kpi-summary')) {
        return { ...baseState, data: { period: cashMovementBreakdown.period, metrics: [] } };
      }
      if (path.includes('/api/dashboard/reagent-reconciliation')) {
        const page = path.includes('page=2') ? 2 : 1;
        return { ...baseState, data: { ...reagentReconciliation, page, hasNextPage: page === 1 } };
      }
      if (path.includes('/api/dashboard/kpi-breakdown')) {
        return { ...baseState, data: cashMovementBreakdown };
      }
      return { ...baseState, data: dashboardData };
    }) as never);

    renderKpis();
    fireEvent.click(screen.getByRole('button', { name: 'Next reagent page' }));

    await waitFor(() => {
      expect(vi.mocked(useApiQuery).mock.calls.some((call) => {
        const path = String(call[1]);
        return path.includes('/api/dashboard/reagent-reconciliation') && path.includes('page=2');
      })).toBe(true);
    });
  });

  it('shows loading state when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    renderKpis();
    expect(screen.getAllByText('Loading...')).toHaveLength(44);
  });

  it('displays finance data when loaded', () => {
    mockDashboardWithBreakdowns();
    renderKpis();
    expect(screen.getAllByText('৳50,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('৳40,000.00')).toBeInTheDocument();
    expect(screen.getByText('৳12,000.00')).toBeInTheDocument();
    expect(screen.getByText('৳3,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('৳4,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳45,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('৳5,301.00')).toBeInTheDocument();
    expect(screen.getAllByText('৳10,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('৳5,000.00')).toBeInTheDocument();
    expect(screen.getByText('৳2,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('31').length).toBeGreaterThan(0);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows zero values when data has no finance', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { finance: undefined, todaySummary: undefined },
      isLoading: false,
    } as never);
    renderKpis();
    expect(screen.getAllByText('৳0.00')).toHaveLength(20);
  });

  it('renders human-readable card titles instead of raw i18n keys', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    renderKpis();
    expect(screen.getByText('Total Collection')).toBeTruthy();
    expect(screen.getByText('Total Expense')).toBeTruthy();
    expect(screen.getByText('Net Income')).toBeTruthy();
    expect(screen.getByText('OPD / Doctor Visit Collection')).toBeTruthy();
    expect(screen.getByText('Diagnostic / Laboratory Collection')).toBeTruthy();
    expect(screen.getByText('IPD / Admitted Patient Collection')).toBeTruthy();
    expect(screen.getByText('OT / Procedure Collection')).toBeTruthy();
    expect(screen.getByText('Pharmacy / Medicine Collection')).toBeTruthy();
    expect(screen.getByText('Radiology / Imaging Collection')).toBeTruthy();
    expect(screen.getByText('Deposits / Advances')).toBeTruthy();
    expect(screen.getByText('Uncategorized Services')).toBeTruthy();
    expect(screen.queryByText('Other Income')).toBeNull();
    expect(screen.getByText('Visit Commission')).toBeTruthy();
    expect(screen.getByText('Test Commission')).toBeTruthy();
    expect(screen.getByText('Other Doctor Commission')).toBeTruthy();
    expect(screen.getByText('Total Doctor Commission')).toBeTruthy();
    expect(screen.queryByText('Total Visits')).not.toBeInTheDocument();
    expect(screen.getByText('Tests Completed')).toBeTruthy();
    expect(screen.getByText('Pending Approvals')).toBeTruthy();
    expect(screen.getByText('Physical Cash In')).toBeTruthy();
    expect(screen.getByText('Net Cash Movement')).toBeTruthy();
    expect(screen.getByText('Available Drawer Cash')).toBeTruthy();
    expect(screen.getByText('Outstanding patient due')).toBeTruthy();
    expect(screen.getByText('Discount given')).toBeTruthy();
    expect(screen.getByText('OPD patients')).toBeTruthy();
    expect(screen.getByText('IPD admitted')).toBeTruthy();
  });

  it('opens a KPI source drawer when a financial KPI is clicked', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    fireEvent.click(screen.getByText('Net Income'));
    expect(screen.getAllByText('Drill down').length).toBeGreaterThanOrEqual(1);

    expect(screen.getByRole('dialog', { name: 'Net Income' })).toBeInTheDocument();
    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('metric=accounting_profit'))).toBe(true);
    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('opens dedicated management and physical cash drilldowns', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    for (const [title, metric] of [
      ['Total Collection', 'accounting_income'],
      ['Total Expense', 'accounting_expenses'],
      ['OPD / Doctor Visit Collection', 'opd_income'],
      ['Diagnostic / Laboratory Collection', 'lab_income'],
      ['IPD / Admitted Patient Collection', 'ipd_collection'],
      ['OT / Procedure Collection', 'ot_income'],
      ['Pharmacy / Medicine Collection', 'pharmacy_income'],
      ['Radiology / Imaging Collection', 'radiology_income'],
      ['Deposits / Advances', 'deposit_collection'],
      ['Uncategorized Services', 'uncategorized_income'],
      ['Visit Commission', 'visit_commission'],
      ['Test Commission', 'test_commission'],
      ['Other Doctor Commission', 'other_doctor_commission'],
      ['Total Doctor Commission', 'total_commission'],
      ['Tests Completed', 'lab_tests_completed'],
      ['Pending Approvals', 'pending_approvals'],
      ['Physical Cash In', 'cash_received'],
      ['Net Cash Movement', 'cash_movement'],
      ['Available Drawer Cash', 'drawer_cash'],
    ]) {
      fireEvent.click(screen.getByText(title));
      expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes(`metric=${metric}`))).toBe(true);
      fireEvent.click(screen.getByText('Close'));
    }
  });

  it('filters Test Commission by doctor and opens the selected invoice', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    fireEvent.click(screen.getByText('Test Commission'));
    fireEvent.click(screen.getByRole('button', { name: 'Dr. Example Four' }));

    const calledPaths = vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]));
    expect(calledPaths.some((path) => path.includes('metric=test_commission') && path.includes('doctorId=17'))).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Dr. Example Four — Test Commission' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-91' }));
    expect(screen.getByTestId('admin-kpi-invoice-modal')).toHaveTextContent('91');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
    expect(screen.getByTestId('location')).toHaveTextContent('invoiceId=91');
    fireEvent.click(screen.getByRole('button', { name: 'Close invoice' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');

    fireEvent.click(screen.getByRole('button', { name: 'Show all doctors' }));
    expect(screen.getByRole('dialog', { name: 'Test Commission' })).toBeInTheDocument();
  });

  it('opens the exact invoice from an admin KPI drilldown row', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    fireEvent.click(screen.getByText('OT / Procedure Collection'));
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-OT-777' }));

    expect(screen.getByTestId('admin-kpi-invoice-modal')).toHaveTextContent('777');
    expect(screen.getByTestId('location')).toHaveTextContent('invoiceId=777');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
  });

  it('renders a cash breakdown box with collection sources and expense categories', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    expect(screen.getByTestId('admin-cash-breakdown-box')).toBeInTheDocument();
    expect(screen.getByText('Cash reconciliation snapshot')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-exception-center')).not.toBeInTheDocument();
    expect(screen.queryByText('Exception & risk center')).not.toBeInTheDocument();
    expect(screen.getByText('Doctor visit collection')).toBeInTheDocument();
    expect(screen.getByText('Test collection')).toBeInTheDocument();
    expect(screen.getByText('Due collections')).toBeInTheDocument();
    expect(screen.getByText('Utilities')).toBeInTheDocument();
    expect(screen.getByText('Office supplies')).toBeInTheDocument();
  });



  it('opens split cash source drilldown with a sourceLabel filter', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    fireEvent.click(screen.getByText('Doctor visit collection'));

    const calledPaths = vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]));
    expect(calledPaths.some((path) => path.includes('metric=billing_collection'))).toBe(true);
    expect(calledPaths.some((path) => path.includes(`sourceLabel=${encodeURIComponent('mdDashboard.kpi.cashMovementSourceVisit')}`))).toBe(true);
  });

  it('opens Admission/IPD collection with the dedicated admission-linked invoice metric', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    fireEvent.click(screen.getByText('Admission/IPD collection'));

    const calledPaths = vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]));
    expect(calledPaths.some((path) => path.includes('metric=ipd_collection'))).toBe(true);
    expect(calledPaths.some((path) => path.includes(`sourceLabel=${encodeURIComponent('mdDashboard.kpi.cashMovementSourceAdmission')}`))).toBe(false);
  });

  it('opens doctor payout source with the dedicated payout metric', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    fireEvent.click(screen.getByText('Doctor payouts'));

    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('metric=doctor_payout'))).toBe(true);
    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('metric=cash_movement&date=2026-06-24&page=1&pageSize=50'))).toBe(false);
  });

  it('reloads KPI and breakdown queries for the selected dashboard range', () => {
    mockDashboardWithBreakdowns();
    renderKpis();

    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom start date'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.change(screen.getByLabelText('Custom end date'), {
      target: { value: '2026-06-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }));

    const calledPaths = vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]));
    const period = 'preset=custom&startDate=2026-06-01&endDate=2026-06-20';
    expect(calledPaths).toContain('/api/dashboard/stats?date=2026-06-20');
    expect(calledPaths.some((path) => path.startsWith(`/api/dashboard/kpi-summary?${period}&metrics=`) && path.includes('inventory_low_stock'))).toBe(true);
    expect(calledPaths).toContain(`/api/dashboard/kpi-breakdown?metric=cash_movement&${period}&pageSize=50`);
    expect(calledPaths).toContain(`/api/dashboard/kpi-breakdown?metric=accounting_expenses&${period}&pageSize=50`);
  });

  describe('error handling', () => {
    it('renders an accessible error state when the dashboard query fails', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() } as never);
      renderKpis();
      const alert = screen.getByRole('alert');
      expect(alert).toBeTruthy();
      expect(alert).toHaveTextContent('Unable to load dashboard data');
    });

    it('renders a retry button when the dashboard query fails', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() } as never);
      renderKpis();
      expect(screen.getByText('Retry')).toBeTruthy();
    });

    it('invokes refetch when the retry button is clicked', async () => {
      const refetch = vi.fn();
      vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch } as never);
      renderKpis();
      fireEvent.click(screen.getByText('Retry'));
      await waitFor(() => expect(refetch).toHaveBeenCalled());
    });

    it('does not render error state when isError is false even if data is missing', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true, isError: false } as never);
      renderKpis();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});

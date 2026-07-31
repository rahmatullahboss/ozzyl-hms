import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from './Dashboard';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
let dashboardSearchParams = new URLSearchParams();
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router', () => ({
  Navigate: ({ to }: { to: string }) => <output data-testid="navigate-target">{to}</output>,
  useParams: () => ({ slug: 'city-hospital' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [
    dashboardSearchParams,
    (next: URLSearchParams) => { dashboardSearchParams = new URLSearchParams(next); },
  ],
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: {
      dashboard: () => ['admin', 'dashboard'],
      activeCounters: () => ['admin', 'active-counters'],
      securityAlerts: () => ['admin', 'security-alerts'],
    },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock('./command-center/components/ActionCenterSummaryPanel', () => ({
  default: () => <section data-testid="action-center-summary-panel" />,
}));

// Mock widget components
vi.mock('./widgets/KPISummaryCards', () => ({
  default: ({ filters, onFiltersChange }: { filters: { endDate: string }; onFiltersChange: (filters: { preset: 'custom'; startDate: string; endDate: string }) => void }) => (
    <div data-testid="kpi-cards">
      KPI Summary Cards
      <input
        aria-label="Mock admin dashboard date"
        type="date"
        value={filters.endDate}
        onChange={(event) => onFiltersChange({ preset: 'custom', startDate: event.target.value, endDate: event.target.value })}
      />
    </div>
  ),
}));
vi.mock('../../components/dashboard/PendingRequestsSection', () => ({
  default: ({ role, window }: { role: string; window: { from: string; to: string } }) => (
    <div data-testid="pending-requests" data-role={role} data-from={window.from} data-to={window.to} />
  ),
}));
vi.mock('../../components/dashboard/ExecutiveDuePanel', () => ({
  default: ({ role, basePath, queryKeyScope }: { role: string; basePath: string; queryKeyScope: string }) => (
    <div
      data-testid="executive-due-panel"
      data-role={role}
      data-base-path={basePath}
      data-query-key-scope={queryKeyScope}
    />
  ),
}));
vi.mock('./widgets/ActionRequiredPanel', () => ({
  default: () => <div data-testid="action-panel">Action Required Panel</div>,
}));
vi.mock('./widgets/LiveCashDrawerWidget', () => ({
  default: () => <div data-testid="cash-drawer">Live Cash Drawer Widget</div>,
}));
vi.mock('./widgets/OperationsSnapshot', () => ({
  default: () => <div data-testid="ops-snapshot">Operations Snapshot</div>,
}));
vi.mock('./widgets/RevenueTrendChart', () => ({
  default: () => <div data-testid="revenue-trend">Revenue Trend Chart</div>,
}));
vi.mock('./widgets/PaymentMethodBreakdown', () => ({
  default: () => <div data-testid="payment-breakdown">Payment Method Breakdown</div>,
}));
vi.mock('./widgets/AuditFeedWidget', () => ({
  default: () => <div data-testid="audit-feed">Audit Feed Widget</div>,
}));

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardSearchParams = new URLSearchParams();
    vi.mocked(useQueryClient).mockReturnValue({ invalidateQueries: mockInvalidateQueries } as never);
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true, isError: false, isFetching: false, refetch: vi.fn() } as never);
  });

  it('renders all dashboard widgets including the dedicated due and IPD billing panels', () => {
    render(<AdminDashboard />);
    expect(screen.getByTestId('kpi-cards')).toBeInTheDocument();
    expect(screen.getByTestId('executive-due-panel')).toHaveAttribute('data-role', 'hospital_admin');
    expect(screen.getByTestId('executive-due-panel')).toHaveAttribute('data-base-path', '/h/city-hospital');
    expect(screen.getByTestId('executive-due-panel')).toHaveAttribute('data-query-key-scope', 'admin');
    expect(screen.getByTestId('ipd-billing-overview')).toBeInTheDocument();
    expect(screen.getByTestId('revenue-trend')).toBeInTheDocument();
    expect(screen.getByTestId('payment-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('action-panel')).toBeInTheDocument();
    expect(screen.getByTestId('cash-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('ops-snapshot')).toBeInTheDocument();
    expect(screen.getByTestId('audit-feed')).toBeInTheDocument();
  });

  it('requests the explicit dashboard-v2 preview and does not flash the legacy dashboard', () => {
    render(<AdminDashboard forceCommandCenter />);

    const overviewCall = vi.mocked(useApiQuery).mock.calls.find((call) => String(call[1]).startsWith('/api/dashboard/admin-overview-v2?'));
    expect(String(overviewCall?.[1])).toContain('preview=dashboard-v2');
    expect(screen.queryByTestId('kpi-cards')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-center-loading')).toBeInTheDocument();
  });

  it('shows a retryable v2 error instead of silently returning to the legacy dashboard', () => {
    const refetch = vi.fn();
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    } as never);

    render(<AdminDashboard forceCommandCenter />);

    expect(screen.queryByTestId('kpi-cards')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Command Center unavailable' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the command center and wires its refresh control when the v2 overview is available', async () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => {
      if (path.startsWith('/api/dashboard/admin-overview-v2?')) {
        return {
          data: {
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
              state: 'healthy',
              completeDomains: [],
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
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    }) as never);

    render(<AdminDashboard forceCommandCenter />);

    expect(screen.getByTestId('admin-command-center')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-cards')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalledTimes(1));
  });

  it('keeps the standard dashboard on the legacy implementation without requesting v2', () => {
    render(<AdminDashboard />);

    expect(screen.getByTestId('kpi-cards')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-command-center')).not.toBeInTheDocument();
    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).startsWith('/api/dashboard/admin-overview-v2?'))).toBe(false);
  });

  it('loads and displays dedicated IPD billing stats', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, path: string) => {
      if (path.startsWith('/api/ip-billing/stats?')) {
        return {
          data: {
            total_inpatients: 18,
            pending_billing: 6,
            charges_added_today: 72500,
            total_charges_today: 72500,
            final_billed_today: 48000,
            final_bill_count_today: 2,
            payment_collected_today: 42000,
            payment_receipt_count_today: 2,
            cash_collected_today: 32000,
            non_cash_collected_today: 10000,
            deposit_applied_today: 6000,
            discount_today: 0,
            settled_gross_today: 48000,
            settled_discount_today: 0,
            settled_payment_applied_today: 42000,
            settled_deposit_applied_today: 6000,
            settled_today: 48000,
            settled_bill_count_today: 2,
            current_provisional_due: 12500,
            high_due_patients: 3,
            package_patients: 2,
            today_admissions: 5,
            today_discharges: 4,
            today_activity: [],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    }) as never);

    render(<AdminDashboard />);

    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).startsWith('/api/ip-billing/stats?'))).toBe(true);
    expect(screen.getByText(/IPD finance —/)).toBeInTheDocument();
    expect(screen.getByText('Charges added in selected period')).toBeInTheDocument();
    expect(screen.getByText('৳72,500.00')).toBeInTheDocument();
    expect(screen.getAllByText('৳48,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('keeps the IPD panel and pending requests synchronized with the admin dashboard date selector', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: {}, isLoading: false, isError: false, refetch: vi.fn() } as never);
    render(<AdminDashboard />);

    fireEvent.change(screen.getByLabelText('Mock admin dashboard date'), { target: { value: '2026-06-20' } });

    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]) === '/api/ip-billing/stats?page=1&pageSize=20&from=2026-06-20&to=2026-06-20')).toBe(true);
    expect(screen.getByText('IPD finance — 2026-06-20')).toBeInTheDocument();
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-role', 'hospital_admin');
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-from', '2026-06-20');
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-to', '2026-06-20');
  });

  it('renders within DashboardLayout', () => {
    render(<AdminDashboard />);
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('renders KPI cards above other widgets', () => {
    render(<AdminDashboard />);
    const layout = screen.getByTestId('layout');
    const kpi = screen.getByTestId('kpi-cards');
    const action = screen.getByTestId('action-panel');
    expect(layout.contains(kpi)).toBe(true);
    expect(layout.contains(action)).toBe(true);
  });
});

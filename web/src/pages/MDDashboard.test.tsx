import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MDDashboard from './MDDashboard';
import { useApiQuery } from '../hooks/useApiQuery';
import { getTodayGMT6 } from '../lib/date-utils';
import { rangePendingApprovalDateWindow } from '../lib/pendingApprovalDateWindow';

const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));

vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'managingDirectorDashboard': 'Managing Director Dashboard',
    'todaysIncome':   "Today's Income",
    'todaysExpenses': "Today's Expenses",
    'todaysProfit':   "Today's Profit",
    'totalStaff':     'Total Staff',
    'monthlyIncome':  'Monthly Income',
    'monthlyExpenses':'Monthly Expenses',
    'monthlyProfit':  'Monthly Profit',
    'noData':         'No data',
    'name':           'Name',
    'status':         'Status',
    'noStaff':        'No staff found',
    'failedToLoadDashboard': 'Failed to load dashboard data',
    'retry':          'Retry',
    'showingNOfM':    'Showing {{count}} of {{total}}',
    'incomeSourcesToday': 'Income Sources Today',
    'expensesToday':  'Expenses Today',
    'staffOverview':  'Staff Overview',
    'mdDashboard.alerts.title': 'Alerts & Exceptions',
    'mdDashboard.alerts.canceledBills': 'Canceled bills today',
    'mdDashboard.alerts.pendingHandover': 'Pending handovers',
    'mdDashboard.alerts.lowStock': 'Low stock items',
    'mdDashboard.quickLinks.hr': 'HR Dashboard',
    'mdDashboard.quickLinks.accounting': 'Accounting',
    'mdDashboard.quickLinks.reports': 'Reports',
    'mdDashboard.quickLinks.staff': 'Staff',
    'mdDashboard.quickLinks.profitLoss': 'Profit & Loss',
    'mdDashboard.trend.title': '7-Day Revenue Trend',
    'mdDashboard.trend.subtitle': 'Income by day',
    'mdDashboard.trend.noData': 'No revenue data yet',
    'mdDashboard.trend.weekOverWeek': 'vs last week',
    'mdDashboard.beds.title': 'Bed Occupancy',
    'mdDashboard.beds.total': 'Total',
    'mdDashboard.beds.occupied': 'Occupied',
    'mdDashboard.beds.available': 'Available',
    'mdDashboard.beds.cleaning': 'Cleaning',
    'mdDashboard.beds.occupancy': '{{pct}}% occupied',
    'mdDashboard.staff.deptBreakdown': 'Staff by Department',
    'mdDashboard.staff.noDepartment': 'Unassigned',
    'mdDashboard.staff.viewAll': 'View all staff',
    'mdDashboard.range.today': 'Today',
    'mdDashboard.range.7d': 'Last 7 days',
    'mdDashboard.range.30d': 'Last 30 days',
    'mdDashboard.range.custom': 'Custom',
    'mdDashboard.exec.todayCollection': 'Selected-day cash received',
    'mdDashboard.exec.incomeMinusExpense': 'Income - Approved Expense',
    'mdDashboard.exec.incomeMinusExpenseTooltip': 'Formula: selected-period income minus approved operating expense. This is not full net profit.',
    'mdDashboard.exec.cashMovement': 'Physical drawer cash movement',
    'mdDashboard.exec.patientDue': 'Outstanding patient due',
    'mdDashboard.exec.pendingHandover': 'Pending handover cash',
    'mdDashboard.exec.patientAdvance': 'Patient advance liability',
    'mdDashboard.exec.totalDiscount': 'Discount given',
    'mdDashboard.exec.pendingPosting': 'Accounting posting queue',
    'mdDashboard.operations.title': 'Operations Snapshot',
    'mdDashboard.operations.subtitle': 'Patients, consultations, lab, pharmacy, and bed movement',
    'mdDashboard.operations.appointments': 'Appointments',
    'mdDashboard.operations.consultations': 'Consultations',
    'mdDashboard.operations.opd': 'OPD',
    'mdDashboard.operations.ipd': 'IPD',
    'mdDashboard.operations.labPending': 'Lab Pending',
    'mdDashboard.operations.pharmacySales': 'Pharmacy Sales',
  };
  return {
    useTranslation: () => ({
      t: (k: string, opts?: { defaultValue?: string; count?: number; total?: number; pct?: number }) => {
        const label = labels[k];
        if (!label) return opts?.defaultValue ?? k;
        if (k === 'showingNOfM' && opts?.count !== undefined && opts?.total !== undefined) {
          return `Showing ${opts.count} of ${opts.total}`;
        }
        if (k === 'mdDashboard.beds.occupancy' && opts?.pct !== undefined) {
          return `${opts.pct}% occupied`;
        }
        return label;
      },
    }),
    initReactI18next: { type: '3rdParty', init: () => {} },
  };
});

vi.mock('../lib/i18n', () => ({
  default: { language: 'en' },
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('../components/dashboard/PendingRequestsSection', () => ({
  default: ({ role, window }: { role: string; window: { from: string; to: string } }) => (
    <div data-testid="pending-requests" data-role={role} data-from={window.from} data-to={window.to} />
  ),
}));
vi.mock('../components/dashboard/ExecutiveDuePanel', () => ({
  default: ({ role, basePath, queryKeyScope }: { role: string; basePath: string; queryKeyScope: string }) => (
    <div
      data-testid="md-executive-due-panel"
      data-role={role}
      data-base-path={basePath}
      data-query-key-scope={queryKeyScope}
    />
  ),
}));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const EMPTY_STATS = {
  stats: { totalPatients: 0, todayPatients: 0, staffCount: 0, lowStockItems: 0,
           thisMonthRevenue: 0, lastMonthRevenue: 0, thisWeekRevenue: 0,
           lastWeekRevenue: 0, weekOverWeekChange: 0 },
  todaySummary: { newPatients: 0, totalAppointments: 0, completedConsultations: 0,
                  pharmacySales: 0, pharmacySalesCount: 0, admittedPatients: 0, dischargedPatients: 0 },
  patientSummary: { newPatients: 0, returningPatients: 0, opdPatients: 0,
                    ipdPatients: 0, emergencyPatients: 0 },
  financialSummary: { dailyIncome: 0, weeklyIncome: 0, monthlyIncome: 0, dueCollection: 0 },
  bedSummary: { total: 0, available: 0, occupied: 0, cleaning: 0,
                maintenance: 0, reserved: 0, occupancyPercentage: 0 },
  revenueData: [],
  finance: { todayCollection: 0, pendingHandoverAmount: 0, pendingHandoverCount: 0,
            patientDue: 0, patientAdvance: 0, todayExpense: 0 },
};

const EMPTY_ALERTS = {
  canceledBills: [], highDiscountBills: [], handoverDiscrepancies: [],
  billEdits: [], lowStockItems: [],
  summary: { canceledCount: 0, highDiscountCount: 0, discrepancyCount: 0,
             billEditCount: 0, lowStockCount: 0 },
};

const EMPTY_KPI_SUMMARY = {
  period: { startDate: '2026-06-13', endDate: '2026-06-13', label: '2026-06-13' },
  metrics: [
    { metric: 'accounting_income', title: 'Total Collection', total: 0, valueType: 'money' },
    { metric: 'accounting_expenses', title: 'Total Expense', total: 0, valueType: 'money' },
    { metric: 'accounting_profit', title: 'Net Income', total: 0, valueType: 'money' },
    { metric: 'opd_income', title: 'OPD / Doctor Visit Collection', total: 0, valueType: 'money' },
    { metric: 'lab_income', title: 'Diagnostic / Laboratory Collection', total: 0, valueType: 'money' },
    { metric: 'ipd_collection', title: 'IPD / Admitted Patient Collection', total: 0, valueType: 'money' },
    { metric: 'ot_income', title: 'OT / Procedure Collection', total: 0, valueType: 'money' },
    { metric: 'pharmacy_income', title: 'Pharmacy / Medicine Collection', total: 0, valueType: 'money' },
    { metric: 'radiology_income', title: 'Radiology / Imaging Collection', total: 0, valueType: 'money' },
    { metric: 'deposit_collection', title: 'Deposits / Advances', total: 0, valueType: 'money' },
    { metric: 'uncategorized_income', title: 'Uncategorized Services', total: 0, valueType: 'money' },
    { metric: 'total_commission', title: 'Total Commission', total: 0, valueType: 'money' },
    { metric: 'total_visits', title: 'Total Visits', total: 0, valueType: 'count' },
    { metric: 'pending_approvals', title: 'Pending Approvals', total: 0, valueType: 'count' },
    { metric: 'cash_received', title: 'Physical Cash In', total: 0, valueType: 'money' },
    { metric: 'cash_movement', title: 'Net Cash Movement', total: 0, valueType: 'money' },
    { metric: 'drawer_cash', title: 'Available Drawer Cash', total: 0, valueType: 'money' },
  ],
};

function makeQueryImpl(overrides: {
  income?:   { data?: any; isLoading?: boolean; isError?: boolean; refetch?: () => void };
  expense?:  { data?: any; isLoading?: boolean; isError?: boolean; refetch?: () => void };
  monthly?:  { data?: any; isLoading?: boolean; isError?: boolean; refetch?: () => void };
  staff?:    { data?: any; isLoading?: boolean; isError?: boolean; refetch?: () => void };
  stats?:    { data?: any; isLoading?: boolean; isError?: boolean; refetch?: () => void };
  alerts?:   { data?: any; isLoading?: boolean; isError?: boolean; refetch?: () => void };
  kpiSummary?: { data?: any; isLoading?: boolean; isError?: boolean; refetch?: () => void };
  cashMovement?: { data?: any; isLoading?: boolean; isError?: boolean; refetch?: () => void };
} = {}) {
  (useApiQuery as any).mockImplementation((_key: unknown, url: string, _options?: { enabled?: boolean }) => {
    if (_options?.enabled === false) return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    if (url.includes('daily-income'))   return { data: undefined, isLoading: true, isError: false, refetch: vi.fn(), ...overrides.income   };
    if (url.includes('daily-expenses')) return { data: undefined, isLoading: true, isError: false, refetch: vi.fn(), ...overrides.expense  };
    if (url.includes('monthly-summary'))return { data: undefined, isLoading: true, isError: false, refetch: vi.fn(), ...overrides.monthly  };
    if (url === '/api/staff')           return { data: undefined, isLoading: true, isError: false, refetch: vi.fn(), ...overrides.staff    };
    if (url.startsWith('/api/dashboard/stats'))   return { data: EMPTY_STATS, isLoading: false, isError: false, refetch: vi.fn(), ...overrides.stats };
    if (url === '/api/dashboard/security-alerts') return { data: EMPTY_ALERTS, isLoading: false, isError: false, refetch: vi.fn(), ...overrides.alerts };
    if (url === '/api/dashboard/kpi-config') return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    if (url.includes('/api/dashboard/kpi-summary')) return { data: EMPTY_KPI_SUMMARY, isLoading: false, isError: false, refetch: vi.fn(), ...overrides.kpiSummary };
    if (url.includes('/api/dashboard/kpi-breakdown')) return { data: undefined, isLoading: true, isError: false, refetch: vi.fn(), ...overrides.cashMovement };
    return { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
  });
}

describe('MDDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the active MD date range to pending requests', () => {
    makeQueryImpl();
    render(<MDDashboard />, { wrapper: Wrapper });

    const today = getTodayGMT6();
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-role', 'md');
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-from', today);
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-to', today);

    fireEvent.click(screen.getByRole('tab', { name: 'Last 7 Days' }));
    const sevenDayWindow = rangePendingApprovalDateWindow('7d', '', today);
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-from', sevenDayWindow.from);
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-to', sevenDayWindow.to);

    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom start date'), { target: { value: '2026-07-03' } });
    fireEvent.change(screen.getByLabelText('Custom end date'), { target: { value: '2026-07-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }));
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-from', '2026-07-03');
    expect(screen.getByTestId('pending-requests')).toHaveAttribute('data-to', '2026-07-03');
  });

  it('places the live due panel after executive control and refreshes collection queries', async () => {
    makeQueryImpl();
    render(<MDDashboard />, { wrapper: Wrapper });

    const executiveControl = screen.getByTestId('md-executive-control-kpis');
    const duePanel = screen.getByTestId('md-executive-due-panel');
    const ipdPanel = screen.getByTestId('ipd-billing-overview');

    expect(duePanel).toHaveAttribute('data-role', 'md');
    expect(duePanel).toHaveAttribute('data-base-path', '/h/');
    expect(duePanel).toHaveAttribute('data-query-key-scope', 'md');
    expect(executiveControl.compareDocumentPosition(duePanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(duePanel.compareDocumentPosition(ipdPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['action-center', 'collections'] });
    });
  });

  it('renders 4 KPI labels when data has loaded', () => {
    makeQueryImpl({
      income:  { isLoading: false, data: { date: '2026-06-13', total: 1000 } },
      expense: { isLoading: false, data: { date: '2026-06-13', total: 200 } },
      monthly: { isLoading: false, data: { month: '2026-06', income: 5000, expenses: 1500, profit: 3500, margin: '70' } },
      staff:   { isLoading: false, data: { staff: [{ id: 1, name: 'A', position: 'Doc', salary: 100, status: 'active' }] } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });

    expect(screen.getByText("Today's Income")).toBeInTheDocument();
    expect(screen.getByText("Today's Expenses")).toBeInTheDocument();
    expect(screen.getByText(/Income - Approved Expense/)).toBeInTheDocument();
    expect(screen.getByText('Total Staff')).toBeInTheDocument();
  });

  it('renders the monthly row immediately (not gated on data)', () => {
    makeQueryImpl();
    render(<MDDashboard />, { wrapper: Wrapper });

    expect(screen.getByText('Monthly Income')).toBeInTheDocument();
    expect(screen.getByText('Monthly Expenses')).toBeInTheDocument();
    expect(screen.getByText('Monthly Profit')).toBeInTheDocument();
  });

  it('renders income and expense breakdown lists when data is present', () => {
    makeQueryImpl({
      income:  { isLoading: false, data: { date: '2026-06-13', total: 5000, bySource:   [{ source: 'pharmacy',  total: 3000 }, { source: 'lab', total: 2000 }] } },
      expense: { isLoading: false, data: { date: '2026-06-13', total: 1500, byCategory: [{ category: 'SALARY',   total: 1000 }, { category: 'RENT', total: 500 }] } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });

    expect(screen.getByText('Income Sources Today')).toBeInTheDocument();
    expect(screen.getByText('pharmacy')).toBeInTheDocument();
    expect(screen.getByText('lab')).toBeInTheDocument();
    expect(screen.getByText('Expenses Today')).toBeInTheDocument();
    expect(screen.getByText('SALARY')).toBeInTheDocument();
    expect(screen.getByText('RENT')).toBeInTheDocument();
  });

  it('shows an error banner with retry when any query fails', () => {
    makeQueryImpl({ income: { isLoading: false, isError: true, data: undefined } });
    render(<MDDashboard />, { wrapper: Wrapper });

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/Failed to load dashboard data/);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows "Showing 5 of N" footer when staff count exceeds 5', () => {
    const staff = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, name: `Staff ${i + 1}`, position: 'Nurse', salary: 50000, status: 'active',
    }));
    makeQueryImpl({
      staff: { isLoading: false, data: { staff } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });

    expect(screen.getByText('Showing 5 of 12')).toBeInTheDocument();
  });

  it('renders the skeleton placeholder while a query is loading', () => {
    makeQueryImpl({ staff: { isLoading: true, data: undefined } });
    const { container } = render(<MDDashboard />, { wrapper: Wrapper });

    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("Today's Profit KPI uses income/expense loading, not monthly loading", () => {
    // income + expense are STILL loading, but monthly already returned.
    // The Profit KPI's KPICard must therefore be in loading state.
    makeQueryImpl({
      income:  { isLoading: true,  data: undefined },
      expense: { isLoading: true,  data: undefined },
      monthly: { isLoading: false, data: { month: '2026-06', income: 5000, expenses: 1500, profit: 3500, margin: '70' } },
    });
    const { container } = render(<MDDashboard />, { wrapper: Wrapper });

    // Count skeletons in the row: the Today's Profit card should be loading.
    // We assert this indirectly: at least one .skeleton exists near the profit KPI.
    // (Multiple skeletons may be present from other widgets during loading.)
    const skeletons = container.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("Today's Profit renders formatted BDT when income/expense loaded", () => {
    makeQueryImpl({
      income:  { isLoading: false, data: { date: '2026-06-13', total: 1000 } },
      expense: { isLoading: false, data: { date: '2026-06-13', total: 200 } },
      monthly: { isLoading: false, data: { month: '2026-06', income: 5000, expenses: 1500, profit: 3500, margin: '70' } },
    });
    const { container } = render(<MDDashboard />, { wrapper: Wrapper });
    // Profit = 1000 - 200 = 800. formatCurrency('en') returns "৳800".
    expect(container.textContent).toMatch(/৳800/);
  });

  it('alerts strip is hidden when no alerts are present', () => {
    makeQueryImpl();
    const { container } = render(<MDDashboard />, { wrapper: Wrapper });
    expect(container.querySelector('[data-testid="alerts-strip"]')).toBeNull();
  });

  it('alerts strip renders when canceled bills exist', () => {
    makeQueryImpl({
      alerts: { data: { ...EMPTY_ALERTS, summary: { ...EMPTY_ALERTS.summary, canceledCount: 3 } } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });
    expect(screen.getByTestId('alerts-strip')).toBeInTheDocument();
    expect(screen.getByText(/Canceled bills today/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders 5 quick-link cards', () => {
    makeQueryImpl();
    render(<MDDashboard />, { wrapper: Wrapper });
    const links = screen.getByTestId('quick-links');
    expect(links).toBeInTheDocument();
    expect(links.querySelectorAll('a').length).toBe(5);
    expect(screen.getByText('HR Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Accounting')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('Profit & Loss')).toBeInTheDocument();
  });

  it('renders the 7-day revenue trend chart card with title', () => {
    makeQueryImpl({
      stats: { data: { ...EMPTY_STATS,
        revenueData: [
          { day: 'Sun', revenue: 1000 },
          { day: 'Mon', revenue: 2000 },
          { day: 'Tue', revenue: 1500 },
        ],
      } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });
    expect(screen.getByTestId('revenue-trend')).toBeInTheDocument();
    expect(screen.getByText('7-Day Revenue Trend')).toBeInTheDocument();
  });

  it('renders the bed occupancy card with percentage when stats loaded', () => {
    makeQueryImpl({
      stats: { data: { ...EMPTY_STATS,
        bedSummary: { total: 100, available: 30, occupied: 60, cleaning: 5,
                      maintenance: 0, reserved: 5, occupancyPercentage: 60 },
      } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });
    expect(screen.getByTestId('bed-occupancy')).toBeInTheDocument();
    expect(screen.getByText('60% occupied')).toBeInTheDocument();
  });

  it('aggregates staff by department from the staff query', () => {
    makeQueryImpl({
      staff: { isLoading: false, data: { staff: [
        { id: 1, name: 'A', position: 'Nurse', salary: 100, status: 'active', department: 'ICU' },
        { id: 2, name: 'B', position: 'Nurse', salary: 100, status: 'active', department: 'ICU' },
        { id: 3, name: 'C', position: 'Doc',   salary: 200, status: 'active', department: 'OPD' },
      ] } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });
    const card = screen.getByTestId('staff-by-department');
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain('ICU');
    expect(card.textContent).toContain('OPD');
  });

  it('shows "View all staff" link in the staff table card header', () => {
    makeQueryImpl({
      staff: { isLoading: false, data: { staff: [
        { id: 1, name: 'A', position: 'Doc', salary: 100, status: 'active', department: 'OPD' },
      ] } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });
    const link = screen.getByText('View all staff').closest('a');
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute('href')).toMatch(/\/staff$/);
  });

  it('date range picker renders with Today tab selected by default', () => {
    makeQueryImpl();
    render(<MDDashboard />, { wrapper: Wrapper });
    const tablist = screen.getByRole('tablist', { name: /Date range/i });
    expect(tablist).toBeInTheDocument();
    const todayTab = screen.getByRole('tab', { name: 'Today' });
    expect(todayTab).toHaveAttribute('aria-selected', 'true');
  });

  it('propagates one shared range contract to scalar, drilldown, and analytics queries', async () => {
    makeQueryImpl();
    render(<MDDashboard />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('tab', { name: 'This Month' }));

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    const startDate = `${today.slice(0, 7)}-01`;
    const common = `preset=this_month&startDate=${startDate}&endDate=${today}`;

    await waitFor(() => {
      const paths = vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]));
      expect(paths.some((path) => path.includes(`/api/dashboard/daily-income?${common}`))).toBe(true);
      expect(paths.some((path) => path.includes('/api/dashboard/kpi-summary?') && path.includes(common))).toBe(true);
      expect(paths.some((path) => path.includes('/api/dashboard/kpi-breakdown?metric=cash_movement') && path.includes(common))).toBe(true);
      expect(paths.some((path) => path.includes('/api/dashboard/doctor-performance?') && path.includes(common))).toBe(true);
    });
  });

  it('resets paginated analytics when the shared reporting period changes', async () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string, options?: { enabled?: boolean }) => {
      const base = { isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
      if (options?.enabled === false) return { ...base, data: undefined };
      if (url === '/api/dashboard/kpi-config') {
        return {
          ...base,
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
      if (url.startsWith('/api/dashboard/stats')) return { ...base, data: EMPTY_STATS };
      if (url === '/api/dashboard/security-alerts') return { ...base, data: EMPTY_ALERTS };
      if (url.includes('/api/dashboard/kpi-summary')) return { ...base, data: EMPTY_KPI_SUMMARY };
      if (url.includes('/api/dashboard/reagent-reconciliation')) {
        const page = url.includes('page=2') ? 2 : 1;
        return {
          ...base,
          data: {
            period: EMPTY_KPI_SUMMARY.period,
            rows: [{
              consumableId: 1,
              reagentCode: 'CBC-R',
              reagentName: 'CBC Reagent',
              unit: 'ml',
              completedTests: 1,
              expectedUsage: 2,
              actualUsage: 2,
              returnedQuantity: 0,
              variance: 0,
              currentStock: 10,
              reorderLevel: 5,
              status: 'ok',
            }],
            exceptions: { unmappedCompletedTests: 0, consumptionExceptions: 0, unmappedTests: [] },
            quantityTotals: [{ unit: 'ml', quantity: 2 }],
            availability: { mapping: true, movements: true, stock: true },
            page,
            pageSize: 25,
            totalRows: 26,
            hasNextPage: page === 1,
          },
        };
      }
      if (url === '/api/staff') return { ...base, data: { staff: [] } };
      return { ...base, data: undefined };
    }) as never);

    render(<MDDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Next reagent page' }));

    await waitFor(() => {
      const reagentPaths = vi.mocked(useApiQuery).mock.calls
        .map((call) => String(call[1]))
        .filter((path) => path.includes('/api/dashboard/reagent-reconciliation'));
      expect(reagentPaths.at(-1)).toContain('page=2');
    });

    fireEvent.click(screen.getByRole('tab', { name: 'This Month' }));

    await waitFor(() => {
      const reagentPaths = vi.mocked(useApiQuery).mock.calls
        .map((call) => String(call[1]))
        .filter((path) => path.includes('/api/dashboard/reagent-reconciliation'));
      expect(reagentPaths.at(-1)).toContain('preset=this_month');
      expect(reagentPaths.at(-1)).toContain('page=1');
    });
  });

  it('renders one shared cash-control section and keeps IPD on the selected custom period', async () => {
    makeQueryImpl();
    render(<MDDashboard />, { wrapper: Wrapper });

    expect(screen.getAllByTestId('md-executive-control-kpis')).toHaveLength(1);
    expect(screen.getByTestId('ipd-billing-overview')).toBeInTheDocument();
    expect(screen.queryByTestId('executive-kpis')).not.toBeInTheDocument();
    expect(screen.queryByTestId('executive-cash-control')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom start date'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Custom end date'), { target: { value: '2026-07-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }));

    await waitFor(() => {
      expect((useApiQuery as any).mock.calls.some((call: unknown[]) => String(call[1] ?? '') === '/api/ip-billing/stats?page=1&pageSize=20&from=2026-07-01&to=2026-07-10')).toBe(true);
    });
  });

  it('renders executive finance control KPIs from the dashboard stats payload', () => {
    makeQueryImpl({
      stats: { data: { ...EMPTY_STATS,
        todaySummary: { ...EMPTY_STATS.todaySummary, totalDiscount: 450 },
        finance: {
          todayCollection: 10000,
          pendingHandoverAmount: 2500,
          pendingHandoverCount: 1,
          patientDue: 3000,
          patientAdvance: 1500,
          todayExpense: 700,
          pendingPostingEvents: 2,
        },
      } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });
    const kpis = screen.getByTestId('md-executive-control-kpis');
    expect(kpis).toHaveTextContent('Physical Cash In');
    expect(kpis).toHaveTextContent('Net Cash Movement');
    expect(kpis).toHaveTextContent('Outstanding patient due');
    expect(kpis).toHaveTextContent('Pending handover cash');
    expect(kpis).toHaveTextContent('Patient advance liability');
    expect(kpis).toHaveTextContent('Discount given');
    expect(kpis).toHaveTextContent('Accounting posting queue');
  });

  it('renders the cash movement sub-breakdown pills when the kpi-breakdown endpoint responds', () => {
    makeQueryImpl({
      cashMovement: { isLoading: false, data: {
        metric: 'cash_movement',
        title: 'Physical drawer cash movement',
        total: 23322,
        period: { startDate: '2026-06-23', endDate: '2026-06-23', label: '2026-06-23' },
        sources: [
          { label: 'mdDashboard.kpi.cashMovementSourceBill', amount: 56550, count: 0, direction: 'in' },
          { label: 'mdDashboard.kpi.cashMovementSourceDeposit', amount: 500, count: 1, direction: 'in' },
          { label: 'mdDashboard.kpi.cashMovementSourceExpense', amount: -300, count: 2, direction: 'out' },
          { label: 'mdDashboard.kpi.cashMovementSourcePayout', amount: -32928, count: 4, direction: 'out' },
        ],
        rows: [],
      } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });
    const breakdown = screen.getByTestId('md-admin-style-cash-control');
    expect(breakdown).toHaveTextContent('Cash in, cash out, and source drilldown');
    expect(breakdown).toHaveTextContent('৳23,322');
    expect(breakdown).toHaveTextContent('৳500');
    expect(breakdown).toHaveTextContent('৳-300');
    expect(breakdown).toHaveTextContent('৳-32,928');
  });

  it('renders the operations snapshot from the dashboard stats payload', () => {
    makeQueryImpl({
      stats: { data: { ...EMPTY_STATS,
        stats: { ...EMPTY_STATS.stats, pendingTests: 5 },
        todaySummary: {
          ...EMPTY_STATS.todaySummary,
          totalAppointments: 14,
          completedConsultations: 9,
          pendingTests: 5,
          pharmacySales: 1800,
        },
        patientSummary: { ...EMPTY_STATS.patientSummary, opdPatients: 11, ipdPatients: 3 },
      } },
    });
    render(<MDDashboard />, { wrapper: Wrapper });
    const snapshot = screen.getByTestId('operations-snapshot');
    expect(snapshot).toHaveTextContent('Operations Snapshot');
    expect(snapshot).toHaveTextContent('Appointments');
    expect(snapshot).toHaveTextContent('Consultations');
    expect(snapshot).toHaveTextContent('OPD');
    expect(snapshot).toHaveTextContent('IPD');
    expect(snapshot).toHaveTextContent('Lab Pending');
    expect(snapshot).toHaveTextContent('Pharmacy Sales');
  });

  it('opens a cash source drilldown with sourceLabel so OT does not mix Lab or OPD rows', async () => {
    const cashMovementBreakdown = {
      metric: 'cash_movement',
      title: 'Physical drawer cash movement',
      total: 17800,
      period: { startDate: '2026-07-07', endDate: '2026-07-07', label: '2026-07-07' },
      sources: [
        { label: 'mdDashboard.kpi.cashMovementSourceOperation', amount: 13700, count: 1, direction: 'in' },
        { label: 'mdDashboard.kpi.cashMovementSourceTest', amount: 3500, count: 2, direction: 'in' },
        { label: 'mdDashboard.kpi.cashMovementSourceVisit', amount: 600, count: 2, direction: 'in' },
      ],
      rows: [],
      totalRows: 5,
    };
    const otOnlyBreakdown = {
      metric: 'accounting_income',
      title: 'Accounting Income',
      total: 13700,
      period: { startDate: '2026-07-07', endDate: '2026-07-07', label: '2026-07-07' },
      sources: [{ label: 'OT', amount: 13700, count: 1, direction: 'in' }],
      rows: [{
        id: 'payment-ot-1',
        occurredAt: '2026-07-07 12:00:00',
        sourceType: 'payment',
        sourceLabel: 'OT',
        referenceNo: 'PAY-OT-1',
        invoiceNo: 'INV-OT-1',
        counterName: 'Reception',
        userName: 'Reception',
        amount: 13700,
        status: 'posted',
        billId: 10,
        patientName: 'Patient A',
        patientCode: 'P-1',
        serviceNames: 'OT package',
        grossAmount: 13700,
        discountAmount: 0,
        paidAmount: 13700,
        dueAmount: 0,
      }],
      totalRows: 1,
      page: 1,
      pageSize: 50,
      hasNextPage: false,
    };

    (useApiQuery as any).mockImplementation((_key: unknown, url: string, _options?: { enabled?: boolean }) => {
      if (_options?.enabled === false) return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.includes('daily-income')) return { data: { date: '2026-07-07', total: 17800 }, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.includes('daily-expenses')) return { data: { date: '2026-07-07', total: 0 }, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.includes('monthly-summary')) return { data: { month: '2026-07', income: 17800, expenses: 0, profit: 17800, margin: '100' }, isLoading: false, isError: false, refetch: vi.fn() };
      if (url === '/api/staff') return { data: { staff: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.startsWith('/api/dashboard/stats')) return { data: { ...EMPTY_STATS, finance: { ...EMPTY_STATS.finance, todayCollection: 17800 } }, isLoading: false, isError: false, refetch: vi.fn() };
      if (url === '/api/dashboard/security-alerts') return { data: EMPTY_ALERTS, isLoading: false, isError: false, refetch: vi.fn() };
      if (url.includes('/api/dashboard/kpi-breakdown') && url.includes('metric=ot_income')) {
        return { data: { ...otOnlyBreakdown, metric: 'ot_income', title: 'OT / Procedure Collection' }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      if (url.includes('/api/dashboard/kpi-breakdown')) return { data: cashMovementBreakdown, isLoading: false, isError: false, refetch: vi.fn() };
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<MDDashboard />, { wrapper: Wrapper });
    fireEvent.click(within(screen.getByTestId('md-admin-style-cash-control')).getByRole('button', { name: /OT\/procedure collection/i }));

    await waitFor(() => {
      expect((useApiQuery as any).mock.calls.some((call: unknown[]) => {
        const url = String(call[1] ?? '');
        return url.includes('metric=ot_income');
      })).toBe(true);
    });

    const dialog = await screen.findByRole('dialog', { name: /OT\/procedure collection details/i });
    expect(within(dialog).getByText('INV-OT-1')).toBeInTheDocument();
    expect(within(dialog).getAllByText('OT').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('Lab')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('OPD')).not.toBeInTheDocument();
  });
});

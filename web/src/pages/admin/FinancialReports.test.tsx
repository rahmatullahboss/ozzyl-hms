import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinancialReports from './FinancialReports';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { admin: { executiveOverview: () => ['admin', 'exec-overview'] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockData = {
  revenue: {
    total: 500000,
    byDepartment: [
      { name: 'OPD', amount: 200000 },
      { name: 'IPD', amount: 250000 },
      { name: 'Diagnostic', amount: 50000 },
    ],
    byPaymentMode: [
      { name: 'Cash', amount: 300000 },
      { name: 'bKash', amount: 150000 },
      { name: 'Card', amount: 50000 },
    ],
  },
  expenses: {
    total: 200000,
    byCategory: [
      { name: 'Salary', amount: 150000 },
      { name: 'Supplies', amount: 50000 },
    ],
  },
  netIncome: 300000,
  grossMargin: 60,
  outstandingDue: 25000,
  refundTotal: 5000,
  discountTotal: 15000,
  period: 'month',
};

describe('FinancialReports', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders page title and subtitle', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<FinancialReports />);
    expect(screen.getByText('financialReports.title')).toBeInTheDocument();
    expect(screen.getByText('financialReports.subtitle')).toBeInTheDocument();
  });

  it('renders 5 period options', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<FinancialReports />);
    expect(screen.getByText('financialReports.periods.today')).toBeInTheDocument();
    expect(screen.getByText('financialReports.periods.week')).toBeInTheDocument();
    expect(screen.getByText('financialReports.periods.month')).toBeInTheDocument();
    expect(screen.getByText('financialReports.periods.quarter')).toBeInTheDocument();
    expect(screen.getByText('financialReports.periods.year')).toBeInTheDocument();
  });

  it('renders 7 P&L summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    const { container } = render(<FinancialReports />);
    expect(container.textContent).toContain('financialReports.summary.revenue');
    expect(container.textContent).toContain('financialReports.summary.expenses');
    expect(container.textContent).toContain('financialReports.summary.netIncome');
    expect(container.textContent).toContain('financialReports.summary.grossMargin');
    expect(container.textContent).toContain('financialReports.summary.outstandingDue');
    expect(container.textContent).toContain('financialReports.summary.refunds');
    expect(container.textContent).toContain('financialReports.summary.discounts');
    expect(container.textContent).toContain('৳500,000');
    expect(container.textContent).toContain('60%');
  });

  it('renders revenue by department breakdown', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    render(<FinancialReports />);
    expect(screen.getByText('financialReports.revenueByDepartment')).toBeInTheDocument();
    expect(screen.getByText('OPD')).toBeInTheDocument();
    expect(screen.getByText('IPD')).toBeInTheDocument();
    expect(screen.getByText('Diagnostic')).toBeInTheDocument();
  });

  it('renders revenue by payment mode breakdown', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    render(<FinancialReports />);
    expect(screen.getByText('financialReports.revenueByPaymentMode')).toBeInTheDocument();
    expect(screen.getByText('bKash')).toBeInTheDocument();
  });

  it('renders expenses by category breakdown', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockData, isLoading: false } as never);
    render(<FinancialReports />);
    expect(screen.getByText('financialReports.expensesByCategory')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
    expect(screen.getByText('Supplies')).toBeInTheDocument();
  });

  it('handles missing revenue/expense data', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    const { container } = render(<FinancialReports />);
    expect(container.textContent).toContain('৳0');
  });
});

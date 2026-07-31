import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RevenueAnalytics from './RevenueAnalytics';
import { useApiQuery } from '../../hooks/useApiQuery';

const raTMap: Record<string, string> = {
  'revenueAnalytics.title': 'Revenue Analytics',
  'revenueAnalytics.filters': 'Filters',
  'revenueAnalytics.dateRange': 'Date Range',
  'revenueAnalytics.department': 'Department',
  'revenueAnalytics.paymentMode': 'Payment Mode',
  'revenueAnalytics.doctor': 'Doctor',
  'revenueAnalytics.allDepartments': 'All Departments',
  'revenueAnalytics.allModes': 'All Modes',
  'revenueAnalytics.allDoctors': 'All Doctors',
  'revenueAnalytics.totalRevenue': 'Total Revenue',
  'revenueAnalytics.avgInvoice': 'Avg Invoice',
  'revenueAnalytics.totalInvoices': 'Total Invoices',
  'revenueAnalytics.discount': 'Discount',
  'revenueAnalytics.refund': 'Refund',
  'revenueAnalytics.emptyState': 'No revenue data available',
  'revenueAnalytics.dailyTrend': 'Daily Revenue Trend',
  'revenueAnalytics.noTrendData': 'No trend data',
  'revenueAnalytics.departmentRevenue': 'Department Revenue',
  'revenueAnalytics.noDepartmentData': 'No department data',
  'revenueAnalytics.paymentModeBreakdown': 'Payment Mode',
  'revenueAnalytics.noPaymentData': 'No payment data',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.loading': 'Loading…',
  'common.back': 'Back',
  'common.next': 'Next',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => raTMap[k] ?? opts?.defaultValue ?? k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { revenueAnalytics: () => ['admin', 'revenue-analytics'] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('RevenueAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<RevenueAnalytics />);
    expect(screen.getByText('Revenue Analytics')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<RevenueAnalytics />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalRevenue: 5000000, avgInvoiceValue: 1250, totalInvoices: 4000, totalDiscount: 150000, totalRefund: 45000 },
        dailyTrend: [],
        departmentRevenue: [],
        paymentModeTrend: [],
      },
      isLoading: false,
    } as never);
    render(<RevenueAnalytics />);
    expect(screen.getByText('50,00,000')).toBeInTheDocument();
    expect(screen.getByText('1,250')).toBeInTheDocument();
    expect(screen.getByText('4,000')).toBeInTheDocument();
  });

  it('renders chart sections', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalRevenue: 0, avgInvoiceValue: 0, totalInvoices: 0, totalDiscount: 0, totalRefund: 0 },
        dailyTrend: [{ date: '2026-06-01', revenue: 150000 }],
        departmentRevenue: [{ name: 'Medicine', revenue: 1500000 }],
        paymentModeTrend: [{ mode: 'Cash', amount: 2000000 }],
      },
      isLoading: false,
    } as never);
    render(<RevenueAnalytics />);
    expect(screen.getByText('Daily Revenue Trend')).toBeInTheDocument();
    expect(screen.getByText('Department Revenue')).toBeInTheDocument();
    const paymentModes = screen.getAllByText('Payment Mode');
    expect(paymentModes.length).toBeGreaterThanOrEqual(2);
  });

  it('renders filter section', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalRevenue: 0, avgInvoiceValue: 0, totalInvoices: 0, totalDiscount: 0, totalRefund: 0 },
        dailyTrend: [],
        departmentRevenue: [],
        paymentModeTrend: [],
      },
      isLoading: false,
    } as never);
    render(<RevenueAnalytics />);
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('shows empty state when no data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalRevenue: 0, avgInvoiceValue: 0, totalInvoices: 0, totalDiscount: 0, totalRefund: 0 },
        dailyTrend: [],
        departmentRevenue: [],
        paymentModeTrend: [],
      },
      isLoading: false,
    } as never);
    render(<RevenueAnalytics />);
    expect(screen.getByText('No revenue data available')).toBeInTheDocument();
  });
});

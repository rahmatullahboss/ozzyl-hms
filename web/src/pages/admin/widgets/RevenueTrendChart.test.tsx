import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RevenueTrendChart from './RevenueTrendChart';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('../../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../../lib/queryKeys', () => ({ queryKeys: { admin: { revenueTrend: () => ['admin', 'revenue-trend'] } } }));

describe('RevenueTrendChart', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading skeleton when loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: null, isLoading: true } as ReturnType<typeof useApiQuery>);
    const { container } = render(<RevenueTrendChart />);
    expect(container.querySelector('.skeleton')).toBeTruthy();
  });

  it('preserves the legacy dashboard endpoint and period controls without command-center filters', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { revenueData: [] }, isLoading: false } as ReturnType<typeof useApiQuery>);
    render(<RevenueTrendChart />);
    expect(useApiQuery).toHaveBeenCalledWith(
      ['admin', 'revenue-trend'],
      '/api/dashboard/stats',
      undefined,
    );
    expect(screen.getByText('adminDashboard.revenueTrend.periodToday')).toBeInTheDocument();
    fireEvent.click(screen.getByText('adminDashboard.revenueTrend.period7d'));
  });

  it('renders legacy revenue data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { revenueData: [
        { day: '01 Jun', revenue: 45_000 },
        { day: '02 Jun', revenue: 52_000 },
        { day: '03 Jun', revenue: 38_000 },
      ] },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);
    render(<RevenueTrendChart />);
    expect(screen.getByText('৳135,000.00')).toBeInTheDocument();
    expect(screen.getByText('01 Jun')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'adminDashboard.revenueTrend.title' })).toBeInTheDocument();
  });

  it('requests the complete selected command-center range', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { points: [], totals: { collection: 0, expense: 0, result: 0 }, granularity: 'daily' },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);
    render(<RevenueTrendChart filters={{ preset: 'custom', startDate: '2026-07-01', endDate: '2026-07-20' }} />);
    expect(useApiQuery).toHaveBeenCalledWith(
      ['admin', 'revenue-trend', '2026-07-01', '2026-07-20'],
      '/api/dashboard/financial-trend?startDate=2026-07-01&endDate=2026-07-20&series=collection%2Cexpense%2Cresult',
      undefined,
    );
    expect(screen.getByText('2026-07-01 – 2026-07-20 · daily')).toBeInTheDocument();
  });

  it('renders reconciled collection, expense, and result totals from the server', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        points: [
          { bucket: '2026-07-01', label: '2026-07-01', collection: 600, expense: 100, result: 500 },
          { bucket: '2026-07-02', label: '2026-07-02', collection: 400, expense: 50, result: 350 },
        ],
        totals: { collection: 1_000, expense: 150, result: 850 },
        granularity: 'daily',
        reconciliation: {
          collection: { status: 'reconciled' },
          expense: { status: 'reconciled' },
          result: { status: 'reconciled' },
        },
      },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);

    render(<RevenueTrendChart filters={{ preset: '7d', startDate: '2026-07-01', endDate: '2026-07-07' }} />);
    expect(screen.getAllByText('Collection')).toHaveLength(2);
    expect(screen.getAllByText('Paid expense')).toHaveLength(2);
    expect(screen.getAllByText('Result')).toHaveLength(2);
    expect(screen.getByText('৳1,000.00')).toBeInTheDocument();
    expect(screen.getByText('৳150.00')).toBeInTheDocument();
    expect(screen.getByText('৳850.00')).toBeInTheDocument();
  });

  it('provides an accessible table alternative for every trend point', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        points: [{ bucket: '2026-07-01', label: '2026-07-01', collection: 600, expense: 100, result: 500 }],
        totals: { collection: 600, expense: 100, result: 500 },
        granularity: 'daily',
      },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);

    render(<RevenueTrendChart filters={{ preset: 'today', startDate: '2026-07-01', endDate: '2026-07-01' }} />);
    const table = screen.getByRole('table', { name: 'Financial trend data' });
    expect(table).toHaveTextContent('2026-07-01');
    expect(table).toHaveTextContent('৳600.00');
    expect(table).toHaveTextContent('৳100.00');
    expect(table).toHaveTextContent('৳500.00');
  });

  it('shows empty state when the selected period has no points', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { points: [], totals: { collection: 0, expense: 0, result: 0 }, granularity: 'daily' },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);
    render(<RevenueTrendChart filters={{ preset: 'today', startDate: '2026-07-01', endDate: '2026-07-01' }} />);
    expect(screen.getByText('adminDashboard.revenueTrend.noData')).toBeInTheDocument();
  });

  describe('error handling', () => {
    it('renders an accessible error and retries', () => {
      const refetch = vi.fn();
      vi.mocked(useApiQuery).mockReturnValue({ data: null, isLoading: false, isError: true, refetch } as ReturnType<typeof useApiQuery>);
      render(<RevenueTrendChart />);
      expect(screen.getByRole('alert')).toHaveTextContent('adminDashboard.errors.loadFailed');
      fireEvent.click(screen.getByText('adminDashboard.errors.retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });
});

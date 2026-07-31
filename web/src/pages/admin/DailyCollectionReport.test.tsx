import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DailyCollectionReport from './DailyCollectionReport';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/daily-collection-report', search: '', hash: '', state: null, key: 'default' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()] as ReturnType<typeof actual.useSearchParams>,
  };
});
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { admin: { dailyCollection: (date: string) => ['admin', 'daily-collection', date] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const summary = {
  total_bill: 52_000,
  total_collection: 50_000,
  total_deposit: 1_500,
  total_expense: 2_000,
  total_due: 2_000,
  net_income: 48_000,
  net_cash: 31_500,
};

const loadedData = {
  summary,
  collection_sources: [
    { department: 'OPD', amount: 30_000 },
    { department: 'Lab', amount: 20_000 },
  ],
  payment_methods: [
    { method: 'Cash', amount: 30_000, percentage: 60 },
    { method: 'bKash', amount: 20_000, percentage: 40 },
  ],
  expenses: [
    { expense_head: 'Utilities', amount: 1_200 },
    { expense_head: 'Doctor payouts', amount: 800 },
  ],
  expense_details: [
    { id: 'expense-11', date: '2026-07-13', category: 'Utilities', details: 'Electrolyte purchase', amount: 700, payment_method: 'cash', status: 'paid' },
    { id: 'expense-12', date: '2026-07-13', category: 'Utilities', details: 'Drinking water', amount: 500, payment_method: 'bkash', status: 'paid' },
    { id: 'payout-3', date: '2026-07-13', category: 'Doctor payouts', details: 'Dr. Example Three', amount: 800, payment_method: 'cash', status: 'paid' },
  ],
};

describe('DailyCollectionReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<DailyCollectionReport />);
    expect(screen.getByText('Loading report data...')).toBeInTheDocument();
  });

  it('renders the report heading and actions', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: loadedData, isLoading: false } as never);
    render(<DailyCollectionReport />);
    expect(screen.getByRole('heading', { name: 'Daily Cash Closing Report' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/i })).toBeInTheDocument();
  });

  it('renders seven reconciled summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: loadedData, isLoading: false } as never);
    render(<DailyCollectionReport />);

    for (const label of [
      'Total Billed Today',
      'Total Collection Today',
      'Total Deposit Today',
      'Total Expense Today',
      'Total Due Today',
      'Net Income',
      'Physical Net Cash',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('৳50,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳48,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳31,500.00').length).toBeGreaterThan(0);
  });

  it('shows patient deposits as part of management Total Collection', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: loadedData, isLoading: false } as never);
    render(<DailyCollectionReport />);

    expect(screen.getByRole('heading', { name: 'Management & Cash Reconciliation' })).toBeInTheDocument();
    expect(screen.getByText('Total Collection (Includes Deposits)')).toBeInTheDocument();
    expect(screen.getByText('Total Expense (Paid + Doctor Payouts)')).toBeInTheDocument();
    expect(screen.getByText('Deposit Included in Total Collection')).toBeInTheDocument();
    expect(screen.queryByText('Total Billing Collection (Current & Due)')).not.toBeInTheDocument();
  });

  it('switches to department-wise collection', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: loadedData, isLoading: false } as never);
    render(<DailyCollectionReport />);
    fireEvent.click(screen.getByRole('button', { name: 'Department-wise' }));
    expect(screen.getByText('OPD')).toBeInTheDocument();
    expect(screen.getByText('Lab')).toBeInTheDocument();
  });

  it('switches to payment method and expense details', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: loadedData, isLoading: false } as never);
    render(<DailyCollectionReport />);

    fireEvent.click(screen.getByRole('button', { name: 'Payment Method' }));
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('bKash')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    expect(screen.getAllByText('Utilities')).toHaveLength(2);
    expect(screen.getByText('Doctor payouts')).toBeInTheDocument();
    expect(screen.getByText('Electrolyte purchase')).toBeInTheDocument();
    expect(screen.getByText('Drinking water')).toBeInTheDocument();
    expect(screen.getByText('Dr. Example Three')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Payment Method' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('does not fall back to aggregate expense rows when line details are explicitly empty', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        ...loadedData,
        expenses: [{ expense_head: 'Utilities', amount: 1_200 }],
        expense_details: [],
      },
      isLoading: false,
    } as never);
    render(<DailyCollectionReport />);

    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    expect(screen.getByText('No drawer expenses logged today.')).toBeInTheDocument();
    expect(screen.queryByText('Utilities')).not.toBeInTheDocument();
  });

  it('shows current empty states for every detail tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { collection_sources: [], payment_methods: [], expenses: [] },
      isLoading: false,
    } as never);
    render(<DailyCollectionReport />);

    expect(screen.getByText('No collection summary data found.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Department-wise' }));
    expect(screen.getByText('No department revenue recorded today.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Payment Method' }));
    expect(screen.getByText('No payments recorded today.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    expect(screen.getByText('No drawer expenses logged today.')).toBeInTheDocument();
  });
});

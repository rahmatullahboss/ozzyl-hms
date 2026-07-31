import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import DueAgingReport from '../DueAgingReport';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const dueTMap: Record<string, string> = {
  'dueAgingReport.title': 'Due Aging Report',
  'dueAgingReport.subtitle': 'Outstanding dues categorized by age buckets',
  'dueAgingReport.kpi.totalOutstanding': 'Total Outstanding Due',
  'dueAgingReport.kpi.totalInvoices': 'Total Invoices with Due',
  'dueAgingReport.distributionTitle': 'Aging Distribution',
  'dueAgingReport.empty.title': 'No outstanding dues',
  'dueAgingReport.empty.description': 'All invoices are fully paid or there are no bills with due amounts.',
  'dueAgingReport.invoiceCount_one': '{{count}} invoice',
  'dueAgingReport.invoiceCount_other': '{{count}} invoices',
  'dueAgingReport.bucket.0-7 days': '0-7 days',
  'dueAgingReport.bucket.8-15 days': '8-15 days',
  'dueAgingReport.bucket.16-30 days': '16-30 days',
  'dueAgingReport.bucket.31-60 days': '31-60 days',
  'dueAgingReport.bucket.60+ days': '60+ days',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (dueTMap[key]) {
        let str = dueTMap[key];
        if (opts?.count !== undefined) str = str.replace('{{count}}', String(opts.count));
        return str;
      }
      return opts?.defaultValue ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

import { useApiQuery } from '../../hooks/useApiQuery';

const mockAgingData = {
  data: {
    asOfDate: '2026-05-27',
    totalDue: 23000,
    buckets: [
      { label: '0-7 days', amount: 3000, count: 1 },
      { label: '8-15 days', amount: 2000, count: 1 },
      { label: '16-30 days', amount: 8000, count: 1 },
      { label: '31-60 days', amount: 0, count: 0 },
      { label: '60+ days', amount: 10000, count: 1 },
    ],
  },
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DueAgingReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: mockAgingData, isLoading: false });
  });

  it('renders the report title', () => {
    renderWithProviders(<DueAgingReport />);
    expect(screen.getByText('Due Aging Report')).toBeTruthy();
  });

  it('renders the subtitle', () => {
    renderWithProviders(<DueAgingReport />);
    expect(screen.getByText('Outstanding dues categorized by age buckets')).toBeTruthy();
  });

  it('displays Total Outstanding Due KPI card', () => {
    renderWithProviders(<DueAgingReport />);
    expect(screen.getByText('Total Outstanding Due')).toBeTruthy();
  });

  it('displays Total Invoices with Due KPI card', () => {
    renderWithProviders(<DueAgingReport />);
    expect(screen.getByText('Total Invoices with Due')).toBeTruthy();
  });

  it('displays total due amount with Taka symbol', () => {
    renderWithProviders(<DueAgingReport />);
    expect(screen.getByText(/\u09F323,000/)).toBeTruthy();
  });

  it('displays all 5 bucket labels (each appears in both card and chart)', () => {
    renderWithProviders(<DueAgingReport />);
    expect(screen.getAllByText('0-7 days').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('8-15 days').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('16-30 days').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('31-60 days').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('60+ days').length).toBeGreaterThanOrEqual(1);
  });

  it('displays bucket amounts (each appears in both card and chart)', () => {
    renderWithProviders(<DueAgingReport />);
    expect(screen.getAllByText(/\u09F33,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F32,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F38,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F310,000/).length).toBeGreaterThanOrEqual(1);
  });

  it('displays invoice counts per bucket', () => {
    renderWithProviders(<DueAgingReport />);
    const invoiceTexts = screen.getAllByText(/invoice/);
    expect(invoiceTexts.length).toBeGreaterThanOrEqual(5);
  });

  it('shows date picker input', () => {
    renderWithProviders(<DueAgingReport />);
    const dateInput = document.querySelector('input[type="date"]');
    expect(dateInput).toBeTruthy();
  });

  it('renders Aging Distribution chart section', () => {
    renderWithProviders(<DueAgingReport />);
    expect(screen.getByText('Aging Distribution')).toBeTruthy();
  });

  it('shows loading skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: undefined, isLoading: true });
    renderWithProviders(<DueAgingReport />);
    const skeletons = document.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no outstanding dues', () => {
    (useApiQuery as any).mockReturnValue({
      data: { data: { totalDue: 0, buckets: [] } },
      isLoading: false,
    });
    renderWithProviders(<DueAgingReport />);
    expect(screen.getByText('No outstanding dues')).toBeTruthy();
  });

  it('shows total invoice count across all buckets', () => {
    renderWithProviders(<DueAgingReport />);
    // 1+1+1+0+1 = 4 total invoices
    expect(screen.getByText('4')).toBeTruthy();
  });
});

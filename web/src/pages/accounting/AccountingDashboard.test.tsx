import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountingDashboard from './AccountingDashboard';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'accounting.todaysAccrualRevenue': "Today's Revenue (Accrual)",
    'accounting.todaysPostedExpense': "Today's Posted Expense",
    'accounting.todaysAccrualProfit': "Today's Profit (Accrual)",
    'accounting.accrualRevenueExplanation': 'Revenue is recognized when an invoice is finalized. Deposit adjustments and outstanding due settle receivables; actual money received today is shown separately under Today Collection.',
    'accounting.todayCollection': 'Today Collection',
    'accounting.pendingHandovers': 'Pending Handovers',
    'accounting.patientDue': 'Patient Due',
    'accounting.patientAdvance': 'Patient Advance',
    'accounting.doctorPayable': 'Doctor Payable',
    'accounting.supplierPayable': 'Supplier Payable',
    'accounting.pendingPostingEvents': 'Pending Posting Events',
    'accounting.pending': 'pending',
    'accounting.dashboardTitle': 'Accounting Dashboard',
    'accounting.lastUpdated': 'Last Updated',
    'accounting.noIncomeData': 'No income data today',
    'accounting.noExpenseData': 'No expense data today',
    'accounting.profitTrend': 'Profit Trend',
    'accounting.noTrendData': 'No trend data available',
    'accounting.incomeBySource': 'Income by Source',
    'accounting.expenseByCategory': 'Expense by Category',
  };
  return { useTranslation: () => ({ t: (k: string, opts?: any) => labels[k] ?? opts?.defaultValue ?? k }) };
});
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('AccountingDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    (useApiQuery as any).mockImplementation((_key: unknown, url: string) => {
      if (url === '/api/accounting/summary') {
        return {
          data: {
            today: { income: 1000, expense: 200, profit: 800 },
            mtd: { income: 5000, expense: 1500, profit: 3500 },
            operations: {
              todayCollection: 1200,
              pendingHandoverAmount: 700,
              pendingHandoverCount: 2,
              patientDue: 650,
              patientAdvance: 950,
              todayRefunds: 100,
              todayDiscounts: 50,
              doctorPayable: 300,
              supplierPayable: 400,
              pendingPostingEvents: 4,
            },
            lastUpdated: '2026-05-13T06:00:00.000Z',
          },
          isLoading: false,
        };
      }
      if (url.includes('income-breakdown')) return { data: { breakdown: [] }, isLoading: false };
      if (url.includes('expense-breakdown')) return { data: { breakdown: [] }, isLoading: false };
      if (url.includes('trends')) return { data: { trends: [] }, isLoading: false };
      return { data: null, isLoading: false };
    });
  });

  it('renders accountant operational finance metrics from the summary endpoint', () => {
    render(<AccountingDashboard role="accountant" />, { wrapper: Wrapper });

    expect(screen.getByText("Today's Revenue (Accrual)")).toBeInTheDocument();
    expect(screen.getByText("Today's Posted Expense")).toBeInTheDocument();
    expect(screen.getByText("Today's Profit (Accrual)")).toBeInTheDocument();
    expect(screen.getByText(/Revenue is recognized when an invoice is finalized/)).toBeInTheDocument();
    expect(screen.getByText('Today Collection')).toBeInTheDocument();
    expect(screen.getByText('Pending Handovers')).toBeInTheDocument();
    expect(screen.getByText('Patient Due')).toBeInTheDocument();
    expect(screen.getByText('Patient Advance')).toBeInTheDocument();
    expect(screen.getByText('Doctor Payable')).toBeInTheDocument();
    expect(screen.getByText('Supplier Payable')).toBeInTheDocument();
    expect(screen.getByText('Pending Posting Events')).toBeInTheDocument();
    expect(screen.getByText('2 pending')).toBeInTheDocument();
  });
});

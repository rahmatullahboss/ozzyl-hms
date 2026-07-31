import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import PayrollGeneration from './PayrollGeneration';

vi.mock('../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getToken: vi.fn(() => 't'),
  getWorkstationId: vi.fn(() => 'w'),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      const map: Record<string, string> = {
        'hr:payroll.title': 'Payroll Management',
        'hr:subtitle': 'Staff attendance, payroll & overview',
        'hr:payroll.tabs.overview': 'Overview',
        'hr:payroll.tabs.heads': 'Salary Heads',
        'hr:payroll.tabs.structure': 'Salary Structure',
        'hr:payroll.tabs.runs': 'Runs History',
      };
      return map[k] ?? k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn().mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() }),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock('../hooks/useFmt', () => ({
  useFmt: () => ({
    fmtCurrency: (n: number) => `৳${n}`,
    fmtDate: (d: string) => d,
    fmtMonth: (m: string) => m,
    fmtTime: (t: string) => t,
    fmtDateTime: (dt: string) => dt,
  }),
}));

vi.mock('./payroll/OverviewTab', () => ({ default: () => <div data-testid="tab-overview" /> }));
vi.mock('./payroll/SalaryHeadsTab', () => ({ default: () => <div data-testid="tab-heads" /> }));
vi.mock('./payroll/SalaryStructureTab', () => ({ default: () => <div data-testid="tab-structure" /> }));
vi.mock('./payroll/RunsHistoryTab', () => ({ default: () => <div data-testid="tab-runs" /> }));

function wrapper(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="*" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PayrollGeneration page', () => {
  it('renders 4 tabs and defaults to Overview', () => {
    render(<PayrollGeneration />, { wrapper: wrapper('/h/x/payroll-generation') });
    expect(screen.getByRole('tab', { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Salary Heads/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Salary Structure/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Runs History/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Overview/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('reads ?tab=heads on mount and selects that tab', () => {
    render(<PayrollGeneration />, { wrapper: wrapper('/h/x/payroll-generation?tab=heads') });
    expect(screen.getByRole('tab', { name: /Salary Heads/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('updates the URL when a different tab is clicked', async () => {
    render(<PayrollGeneration />, { wrapper: wrapper('/h/x/payroll-generation') });
    fireEvent.click(screen.getByRole('tab', { name: /Runs History/i }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Runs History/i })).toHaveAttribute('aria-selected', 'true');
    });
  });
});

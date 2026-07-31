import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepositsPage from './DepositsPage';
import { useApiMutation, useApiQuery } from '../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('../components/HelpButton', () => ({ default: ({ onClick }: any) => <button onClick={onClick}>help</button> }));
vi.mock('../components/HelpPanel', () => ({ default: () => null }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('DepositsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    (useApiQuery as any).mockImplementation((_key: unknown, url: string) => {
      if (url.startsWith('/api/deposits/advance-report')) {
        return {
          data: {
            rows: [
              {
                patient_id: 10,
                patient_name: 'Rahin',
                patient_code: 'P-001',
                total_deposits: 1000,
                total_refunds: 100,
                total_adjustments: 250,
                balance: 650,
              },
            ],
            summary: {
              patient_count: 1,
              total_deposits: 1000,
              total_refunds: 100,
              total_adjustments: 250,
              balance: 650,
              advanceLiabilityLedgerTotal: 650,
              ledgerDifference: 0,
              hasLedgerMismatch: false,
              ledgerStatus: 'balanced',
            },
          },
          isLoading: false,
        };
      }
      if (url.startsWith('/api/deposits')) {
        return { data: { deposits: [] }, isLoading: false };
      }
      return { data: { patients: [] }, isLoading: false };
    });
  });

  it('uses the consolidated advance report for the utilization view', () => {
    render(<DepositsPage role="accountant" />, { wrapper: Wrapper });

    expect(useApiQuery).toHaveBeenCalledWith(
      ['deposits', 'advance-report', { includeZero: true }],
      '/api/deposits/advance-report?include_zero=true',
    );

    fireEvent.click(screen.getByText('depositsPage.depositUtilization'));

    expect(screen.getByText('Rahin')).toBeInTheDocument();
    expect(screen.getByText('P-001')).toBeInTheDocument();
    expect(screen.getAllByText('common.currencySymbol650').length).toBeGreaterThan(0);
  });

  it('shows a ledger mismatch warning in the utilization view', () => {
    (useApiQuery as any).mockImplementation((_key: unknown, url: string) => {
      if (url.startsWith('/api/deposits/advance-report')) {
        return {
          data: {
            rows: [],
            summary: {
              patient_count: 0,
              total_deposits: 1000,
              total_refunds: 0,
              total_adjustments: 0,
              balance: 1000,
              advanceLiabilityLedgerTotal: 900,
              ledgerDifference: 100,
              hasLedgerMismatch: true,
              ledgerStatus: 'mismatch',
            },
          },
          isLoading: false,
        };
      }
      if (url.startsWith('/api/deposits')) return { data: { deposits: [] }, isLoading: false };
      return { data: { patients: [] }, isLoading: false };
    });

    render(<DepositsPage role="accountant" />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('depositsPage.depositUtilization'));

    expect(screen.getByText('depositsPage.ledgerMismatchTitle')).toBeInTheDocument();
  });
});

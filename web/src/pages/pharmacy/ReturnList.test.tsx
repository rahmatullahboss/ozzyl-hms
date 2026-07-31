import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import PharmReturnList from './ReturnList';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn(), useApiMutation: vi.fn(), useQueryClient: vi.fn() }));
vi.mock('../../components/DashboardLayout', () => ({ default: ({ children, role }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useApiQuery, useApiMutation } from '../../hooks/useApiQuery';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('PharmReturnList', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders title and empty state', () => {
    (useApiQuery as any).mockReturnValue({ data: { data: [] }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<PharmReturnList />, { wrapper: Wrapper });
    expect(screen.getByText('returns.title')).toBeInTheDocument();
    expect(screen.getByText('returns.none')).toBeInTheDocument();
  });

  it('displays return records when data exists', () => {
    (useApiQuery as any).mockReturnValue({
      data: { data: [{ id: 1, return_no: 'RTN-001', patient_name: 'John', saleInvoiceId: 100, return_date: '2025-01-01', total_amount: 150, status: 'pending', items: [{ id: 1, saleItemId: 1, medicineId: 5, medicine_name: 'Paracetamol', returnedQty: 2, unitPrice: 10, batchNo: 'B001', reason: 'Expired' }] }] },
      isLoading: false,
    });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<PharmReturnList />, { wrapper: Wrapper });
    expect(screen.getByText('RTN-001')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('shows approve button for pending returns', () => {
    (useApiQuery as any).mockReturnValue({
      data: { data: [{ id: 1, return_no: 'RTN-001', patient_name: 'John', saleInvoiceId: 100, return_date: '2025-01-01', total_amount: 150, status: 'pending' }] },
      isLoading: false,
    });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<PharmReturnList />, { wrapper: Wrapper });
    const approveBtn = screen.getByTitle('returns.approve');
    expect(approveBtn).toBeInTheDocument();
  });
});

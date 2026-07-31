import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import InventoryAccounting from './InventoryAccounting';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../hooks/useApiQuery', () => ({ useApiQuery: vi.fn(), useApiMutation: vi.fn(), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children, role }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useApiQuery } from '../hooks/useApiQuery';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('InventoryAccounting', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders title and tabs', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: false });
    render(<InventoryAccounting />, { wrapper: Wrapper });
    expect(screen.getByText('inventoryAccounting.title')).toBeInTheDocument();
    expect(screen.getByText('inventoryAccounting.summary')).toBeInTheDocument();
    expect(screen.getByText('inventoryAccounting.transactions')).toBeInTheDocument();
    expect(screen.getByText('inventoryAccounting.valuation')).toBeInTheDocument();
  });

  it('shows summary KPIs when data loaded', () => {
    (useApiQuery as any).mockReturnValue({ data: { totalStockValue: 50000, totalPurchases: 12000, totalIssued: 8000, totalWrittenOff: 500, netChange: 3500 }, isLoading: false });
    render(<InventoryAccounting />, { wrapper: Wrapper });
    expect(screen.getByText('50000.00')).toBeInTheDocument();
    expect(screen.getByText('12000.00')).toBeInTheDocument();
    expect(screen.getByText('8000.00')).toBeInTheDocument();
  });

  it('shows empty valuation state', () => {
    (useApiQuery as any).mockReturnValue({ data: { data: [] }, isLoading: false });
    render(<InventoryAccounting />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('inventoryAccounting.valuation'));
    expect(screen.getByText('inventoryAccounting.noValuation')).toBeInTheDocument();
  });

  it('shows transactions with data', () => {
    (useApiQuery as any).mockReturnValue({ data: { data: [{ id: 1, transaction_type: 'purchase', item_name: 'Gloves', quantity: 100, unit_price: 5, total_amount: 500, transaction_date: '2025-01-01', store_name: 'Main', reference_no: 'PO-001' }] }, isLoading: false });
    render(<InventoryAccounting />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('inventoryAccounting.transactions'));
    expect(screen.getByText('Gloves')).toBeInTheDocument();
  });
});

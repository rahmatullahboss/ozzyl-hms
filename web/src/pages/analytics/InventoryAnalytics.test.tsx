import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryAnalytics from './InventoryAnalytics';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({ queryKeys: { admin: { inventoryAnalytics: () => ['admin', 'inventory-analytics'] } } }));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('InventoryAnalytics', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<InventoryAnalytics />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<InventoryAnalytics />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<InventoryAnalytics />);
    expect(screen.getByText('Inventory Analytics')).toBeTruthy();
  });

  it('shows summary cards', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { totalItems: 1200, totalValue: 5000000, lowStockCount: 15, outOfStockCount: 3, expiringSoonCount: 8, expiredCount: 2, pendingPOCount: 5, topCategories: [], recentAdjustments: 10 },
      isLoading: false,
    });
    render(<InventoryAnalytics />);
    expect(screen.getByText('Total Items')).toBeTruthy();
    expect(screen.getByText('Stock Value')).toBeTruthy();
    expect(screen.getByText('1,200')).toBeTruthy();
  });

  it('shows category table', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { totalItems: 1200, totalValue: 5000000, lowStockCount: 15, outOfStockCount: 3, expiringSoonCount: 8, expiredCount: 2, pendingPOCount: 5, topCategories: [
        { name: 'Medicine', value: 3000000, count: 800 },
        { name: 'Consumable', value: 1500000, count: 300 },
      ], recentAdjustments: 10 },
      isLoading: false,
    });
    render(<InventoryAnalytics />);
    expect(screen.getByText('Top Categories by Value')).toBeTruthy();
    expect(screen.getByText('Medicine')).toBeTruthy();
    expect(screen.getByText('Consumable')).toBeTruthy();
  });
});

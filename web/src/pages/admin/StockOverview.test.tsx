import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StockOverview from './StockOverview';

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/stock-overview', search: params.toString(), hash: '', state: null, key: 'default' }),
    useSearchParams: () => {
      const setParams = (next: Record<string, string> | ((p: URLSearchParams) => URLSearchParams)) => {
        if (typeof next === 'function') {
          params = next(params);
        } else {
          params = new URLSearchParams(next);
        }
      };
      return [params, setParams] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({ queryKeys: { inventory: { stock: () => ['inventory', 'stock'] } } }));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

import { useApiQuery } from '../../hooks/useApiQuery';
const mockUseApiQuery = useApiQuery as unknown as ReturnType<typeof vi.fn>;

const mockData = {
  items: [
    { id: 1, itemName: 'Paracetamol', category: 'Medicine', currentStock: 500, reorderLevel: 100, unit: 'pcs', batchNumber: 'B001', expiryDate: '2027-01-01', purchasePrice: 5, sellingPrice: 10, status: 'ok' },
    { id: 2, itemName: 'Bandage', category: 'Consumable', currentStock: 20, reorderLevel: 50, unit: 'pcs', batchNumber: 'B002', expiryDate: '2026-12-01', purchasePrice: 15, sellingPrice: 25, status: 'low' },
    { id: 3, itemName: 'Syringe', category: 'Consumable', currentStock: 0, reorderLevel: 200, unit: 'pcs', batchNumber: 'B003', expiryDate: null, purchasePrice: 3, sellingPrice: 8, status: 'out' },
  ],
  summary: { totalItems: 3, totalValue: 10000, lowStock: 1, outOfStock: 1, nearExpiry: 0, expired: 0 },
};

describe('StockOverview', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders loading state', () => {
    mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: true });
    render(<StockOverview />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(1);
  });

  it('renders summary cards with values', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockOverview />);
    expect(screen.getByText('stockOverview.summary.totalItems')).toBeDefined();
    expect(screen.getByText('stockOverview.summary.stockValue')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('৳10,000.00')).toBeDefined();
  });

  it('renders stock table', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockOverview />);
    expect(screen.getByText('Paracetamol')).toBeDefined();
    expect(screen.getByText('Bandage')).toBeDefined();
    expect(screen.getByText('Syringe')).toBeDefined();
  });

  it('filters by Low Stock tab', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockOverview />);
    const lowStockTab = screen.getAllByText('stockOverview.tabs.low').find(el => el.classList.contains('px-4'))!;
    fireEvent.click(lowStockTab);
    expect(screen.getByText('Bandage')).toBeDefined();
    expect(screen.queryByText('Paracetamol')).toBeNull();
  });

  it('shows OK status badge', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockOverview />);
    expect(screen.getByText('stockOverview.statusBadges.ok')).toBeDefined();
  });

  it('renders tab buttons', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockOverview />);
    const allStockBtn = screen.getAllByText('stockOverview.tabs.all').find(el => el.tagName === 'BUTTON');
    expect(allStockBtn).toBeDefined();
  });

  it('calls stock overview API and renders backend data shape', () => {
    mockUseApiQuery.mockReturnValue({
      data: {
        data: [
          { StockId: 101, ItemName: 'CBC Reagent', CategoryName: 'Reagent', AvailableQuantity: 8, ReOrderLevel: 10, UnitName: 'ml', LotNumber: 'LOT-CBC-001', BatchNo: 'CBC-01', ExpiryDate: '2026-12-31', CostPrice: 120, SellingPrice: 0, Status: 'low_stock' },
          { StockId: 102, ItemName: 'Glucose Strip', CategoryName: 'Kit', AvailableQuantity: 0, ReOrderLevel: 20, Unit: 'pcs', BatchNo: 'GLU-02', ExpiryDate: null, CostPrice: 15, SellingPrice: 0, Status: 'out_of_stock' },
          { StockId: 103, ItemName: 'Plain Tube', CategoryName: 'Tube', AvailableQuantity: 100, ReOrderLevel: 25, Unit: 'pcs', BatchNo: 'TUBE-03', ExpiryDate: '2027-03-01', StockValue: 300, CostPrice: 3, SellingPrice: 0, Status: 'available' },
        ],
        pagination: { page: 1, limit: 1000, total: 3 },
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<StockOverview />);

    expect(mockUseApiQuery.mock.calls[0][1]).toBe('/api/inventory/stock/overview?limit=1000');
    expect(screen.getByText('CBC Reagent')).toBeDefined();
    expect(screen.getByText('LOT-CBC-001')).toBeDefined();
    expect(screen.getByText('Glucose Strip')).toBeDefined();
    expect(screen.getByText('Plain Tube')).toBeDefined();
    expect(screen.getByText('৳1,260.00')).toBeDefined();
  });
});

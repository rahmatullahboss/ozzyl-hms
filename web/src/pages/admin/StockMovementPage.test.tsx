import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StockMovementPage from './StockMovementPage';

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/stock-movement', search: params.toString(), hash: '', state: null, key: 'default' }),
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
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { inventoryLedger: { transactions: (f?: Record<string, unknown>) => ['inventoryLedger', 'transactions', f] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

import { useApiQuery } from '../../hooks/useApiQuery';
const mockUseApiQuery = useApiQuery as unknown as ReturnType<typeof vi.fn>;

const mockData = {
  movements: [
    { id: 1, date: '2026-06-10', itemName: 'Paracetamol', category: 'Medicine', type: 'purchase', quantity: 500, unit: 'pcs', batchNumber: 'B001', fromLocation: null, toLocation: 'Main Store', reference: 'PO-001', performedBy: 'Admin', notes: null },
    { id: 2, date: '2026-06-10', itemName: 'Bandage', category: 'Consumable', type: 'issue', quantity: -50, unit: 'pcs', batchNumber: 'B002', fromLocation: 'Main Store', toLocation: 'Pharmacy', reference: 'ISS-001', performedBy: 'Hasan', notes: null },
  ],
  summary: { totalIn: 500, totalOut: 50, netMovement: 450, transactionCount: 2 },
};

describe('StockMovementPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders loading state', () => {
    mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: true });
    render(<StockMovementPage />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(1);
  });

  it('renders summary cards', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockMovementPage />);
    expect(screen.getByText('stockMovementPage.summary.totalIn')).toBeDefined();
    expect(screen.getByText('stockMovementPage.summary.totalOut')).toBeDefined();
    expect(screen.getByText('stockMovementPage.summary.netMovement')).toBeDefined();
    expect(screen.getByText('stockMovementPage.summary.transactions')).toBeDefined();
  });

  it('renders movement table with items', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockMovementPage />);
    expect(screen.getByText('PO-001')).toBeDefined();
    expect(screen.getByText('ISS-001')).toBeDefined();
    expect(screen.getByText('Admin')).toBeDefined();
    expect(screen.getByText('Hasan')).toBeDefined();
  });

  it('shows positive and negative quantities', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockMovementPage />);
    expect(screen.getByText('+500 pcs')).toBeDefined();
    expect(screen.getByText('-50 pcs')).toBeDefined();
  });

  it('renders type filter tabs', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockMovementPage />);
    const allBtn = screen.getAllByText('stockMovementPage.filters.all').find(el => el.tagName === 'BUTTON');
    expect(allBtn).toBeDefined();
  });

  it('filters by type tab', () => {
    mockUseApiQuery.mockReturnValue({ data: mockData, isLoading: false });
    render(<StockMovementPage />);
    const purchaseTab = screen.getAllByText('stockMovementPage.filters.purchase').find(el => el.tagName === 'BUTTON' && el.className.includes('px-4'))!;
    fireEvent.click(purchaseTab);
    expect(purchaseTab.className).toContain('bg-[var(--color-primary)]');
  });
});

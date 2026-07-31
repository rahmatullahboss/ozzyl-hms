import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryAlerts from './InventoryAlerts';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({ queryKeys: { admin: { inventoryAlerts: () => ['admin', 'inventory-alerts'] } } }));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('InventoryAlerts', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<InventoryAlerts />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading skeleton when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<InventoryAlerts />);
    expect(screen.getByText('inventoryAlerts.loading')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<InventoryAlerts />);
    expect(screen.getByText('inventoryAlerts.title')).toBeTruthy();
  });

  it('renders tabs: All, Low Stock, Out of Stock, Expiring Soon, Expired', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<InventoryAlerts />);
    expect(screen.getByText('inventoryAlerts.tabs.all')).toBeTruthy();
    expect(screen.getAllByText('inventoryAlerts.tabs.low').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('inventoryAlerts.tabs.out').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('inventoryAlerts.tabs.expiring')).toBeTruthy();
    expect(screen.getAllByText('inventoryAlerts.tabs.expired').length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no alerts', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { alerts: [] }, isLoading: false });
    render(<InventoryAlerts />);
    expect(screen.getByText('inventoryAlerts.empty')).toBeTruthy();
  });

  it('shows alerts table with data', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { alerts: [
        { id: '1', item: 'Paracetamol 500mg', category: 'Medicine', currentStock: 10, reorderLevel: 50, batch: 'B001', expiry: '2026-12-01', status: 'low' },
        { id: '2', item: 'Gauze Roll', category: 'Consumable', currentStock: 0, reorderLevel: 20, batch: 'B002', expiry: '2027-01-01', status: 'out' },
      ] },
      isLoading: false,
    });
    render(<InventoryAlerts />);
    expect(screen.getByText('Paracetamol 500mg')).toBeTruthy();
    expect(screen.getByText('Gauze Roll')).toBeTruthy();
  });

  it('shows summary cards', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { alerts: [], summary: { lowStock: 15, outOfStock: 3, expiring30: 8, expiring90: 12, expired: 2 } },
      isLoading: false,
    });
    render(<InventoryAlerts />);
    expect(screen.getAllByText('inventoryAlerts.summary.lowStock').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('inventoryAlerts.summary.outOfStock').length).toBeGreaterThanOrEqual(1);
  });
});

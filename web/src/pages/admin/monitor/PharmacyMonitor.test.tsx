import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PharmacyMonitor from './PharmacyMonitor';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string, opts?: { count?: number; batch?: string; qty?: number }) => {
    if (opts && typeof opts.count === 'number') {
      if (k === 'adminMonitor.pharmacy.summary.todayInvoices') return `${opts.count} invoices`;
      if (k === 'adminMonitor.pharmacy.days') return `${opts.count} days`;
    }
    if (opts && opts.batch !== undefined) {
      if (k === 'adminMonitor.pharmacy.batchQty') return `Batch: ${opts.batch} | Qty: ${opts.qty}`;
    }
    return k;
  } }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
}));
vi.mock('../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { pharmacyMonitor: () => ['admin', 'pharmacy-monitor'] },
    pharmacy: { summary: () => ['pharmacy', 'summary'], lowStock: () => ['pharmacy', 'low-stock'], expiring: () => ['pharmacy', 'expiring'] },
  },
}));
vi.mock('../../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('PharmacyMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<PharmacyMonitor />);
    expect(screen.getByText('adminMonitor.pharmacy.title')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<PharmacyMonitor />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders summary cards with stats', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: {
          todaySales: 45000,
          todaySalesCount: 28,
          grossMargin: 32,
          totalInvestment: 500000,
          totalIncome: 650000,
          grossProfit: 150000,
          totalMedicines: 1200,
          lowStockCount: 15,
          expiringCount: 8,
        },
        lowStockItems: [],
        expiringItems: [],
        pendingPurchaseRequests: 3,
        todayReturns: 2500,
      },
      isLoading: false,
    } as never);
    render(<PharmacyMonitor />);
    expect(screen.getByText('45,000')).toBeInTheDocument();
    expect(screen.getByText('28 invoices')).toBeInTheDocument();
    expect(screen.getByText('32%')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders low stock items list', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { todaySales: 0, todaySalesCount: 0, grossMargin: 0, totalInvestment: 0, totalIncome: 0, grossProfit: 0, totalMedicines: 0, lowStockCount: 2, expiringCount: 0 },
        lowStockItems: [
          { id: 'M1', name: 'Paracetamol 500mg', currentStock: 5, reorderLevel: 50, category: 'Tablet' },
          { id: 'M2', name: 'Amoxicillin 250mg', currentStock: 2, reorderLevel: 30, category: 'Capsule' },
        ],
        expiringItems: [],
        pendingPurchaseRequests: 0,
        todayReturns: 0,
      },
      isLoading: false,
    } as never);
    render(<PharmacyMonitor />);
    expect(screen.getByText('adminMonitor.pharmacy.lowStockAlert')).toBeInTheDocument();
    expect(screen.getByText('Paracetamol 500mg')).toBeInTheDocument();
    expect(screen.getByText('Amoxicillin 250mg')).toBeInTheDocument();
    expect(screen.getByText('5 / 50')).toBeInTheDocument();
  });

  it('renders expiring items list', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { todaySales: 0, todaySalesCount: 0, grossMargin: 0, totalInvestment: 0, totalIncome: 0, grossProfit: 0, totalMedicines: 0, lowStockCount: 0, expiringCount: 2 },
        lowStockItems: [],
        expiringItems: [
          { id: 'M1', name: 'Cough Syrup', expiryDate: '2026-07-15', daysUntilExpiry: 34, batchNumber: 'B001', quantity: 20 },
          { id: 'M2', name: 'Insulin', expiryDate: '2026-06-25', daysUntilExpiry: 14, batchNumber: 'B002', quantity: 5 },
        ],
        pendingPurchaseRequests: 0,
        todayReturns: 0,
      },
      isLoading: false,
    } as never);
    render(<PharmacyMonitor />);
    expect(screen.getByText('adminMonitor.pharmacy.nearExpiryAlert')).toBeInTheDocument();
    expect(screen.getByText('Cough Syrup')).toBeInTheDocument();
    expect(screen.getByText('Insulin')).toBeInTheDocument();
  });

  it('shows empty state when no low stock or expiring', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { todaySales: 45000, todaySalesCount: 28, grossMargin: 32, totalInvestment: 500000, totalIncome: 650000, grossProfit: 150000, totalMedicines: 1200, lowStockCount: 0, expiringCount: 0 },
        lowStockItems: [],
        expiringItems: [],
        pendingPurchaseRequests: 0,
        todayReturns: 0,
      },
      isLoading: false,
    } as never);
    render(<PharmacyMonitor />);
    expect(screen.getByText('adminMonitor.pharmacy.noLowStock')).toBeInTheDocument();
    expect(screen.getByText('adminMonitor.pharmacy.noExpiring')).toBeInTheDocument();
  });

  it('renders today returns in summary', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { todaySales: 45000, todaySalesCount: 28, grossMargin: 32, totalInvestment: 500000, totalIncome: 650000, grossProfit: 150000, totalMedicines: 1200, lowStockCount: 0, expiringCount: 0 },
        lowStockItems: [],
        expiringItems: [],
        pendingPurchaseRequests: 0,
        todayReturns: 2500,
      },
      isLoading: false,
    } as never);
    render(<PharmacyMonitor />);
    expect(screen.getByText('2,500')).toBeInTheDocument();
  });
});

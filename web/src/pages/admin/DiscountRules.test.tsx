import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiscountRules from './DiscountRules';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { discountRules: () => ['admin', 'discount-rules'] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('DiscountRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<DiscountRules />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading skeleton when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<DiscountRules />);
    expect(screen.getByText('discountRules.loading')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<DiscountRules />);
    expect(screen.getByText('discountRules.title')).toBeTruthy();
  });

  it('renders scope tabs: Global, Per-Department, Per-Doctor, Per-Branch', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<DiscountRules />);
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.getByText('Per-Department')).toBeTruthy();
    expect(screen.getByText('Per-Doctor')).toBeTruthy();
    expect(screen.getByText('Per-Branch')).toBeTruthy();
  });

  it('shows empty state when no rules', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { rules: [] }, isLoading: false });
    render(<DiscountRules />);
    expect(screen.getByText('discountRules.empty')).toBeTruthy();
  });

  it('shows rules table with data', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        rules: [
          { id: '1', name: 'Senior Citizen Discount', scope: 'global', type: 'percentage', value: 10, maxAmount: 500, conditions: 'Age >= 60', enabled: true },
          { id: '2', name: 'Cardiology Promo', scope: 'department', type: 'percentage', value: 15, maxAmount: 1000, conditions: 'Cardiology only', enabled: true },
        ],
      },
      isLoading: false,
    });
    render(<DiscountRules />);
    expect(screen.getByText('Senior Citizen Discount')).toBeTruthy();
    expect(screen.getByText('Cardiology Promo')).toBeTruthy();
  });

  it('filters by scope tab', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        rules: [
          { id: '1', name: 'Senior Citizen Discount', scope: 'global', type: 'percentage', value: 10, maxAmount: 500, conditions: 'Age >= 60', enabled: true },
          { id: '2', name: 'Cardiology Promo', scope: 'department', type: 'percentage', value: 15, maxAmount: 1000, conditions: 'Cardiology only', enabled: true },
        ],
      },
      isLoading: false,
    });
    render(<DiscountRules />);
    fireEvent.click(screen.getByText('Per-Department'));
    expect(screen.getByText('Cardiology Promo')).toBeTruthy();
  });

  it('shows summary cards', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        rules: [
          { id: '1', name: 'Senior Citizen Discount', scope: 'global', type: 'percentage', value: 10, maxAmount: 500, conditions: 'Age >= 60', enabled: true },
        ],
        summary: { totalRules: 5, activeRules: 3, avgDiscount: 12 },
      },
      isLoading: false,
    });
    render(<DiscountRules />);
    expect(screen.getByText('discountRules.summary.totalRules')).toBeTruthy();
    expect(screen.getByText('discountRules.summary.activeRules')).toBeTruthy();
    expect(screen.getByText('discountRules.summary.avgDiscountPct')).toBeTruthy();
  });
});

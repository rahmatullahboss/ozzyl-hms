import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiscountReferenceAnalytics from './DiscountReferenceAnalytics';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/discount-reference-analytics', search: params.toString(), hash: '', state: null, key: 'default' }),
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
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { admin: { discountReferenceAnalytics: () => ['admin', 'discount-ref-analytics'] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockSummary = {
  totalReferences: 12,
  totalStaff: 8,
  totalDiscountAmount: 25000,
  highDiscountCount: 3,
};

const mockReferences = [
  { name: 'Dr. Hasan', type: 'doctor', totalDiscounts: 8, discountAmount: 12000, patientCount: 8, avgDiscount: 1500, highDiscountCount: 2 },
  { name: 'External: ABC Pharma', type: 'external', totalDiscounts: 5, discountAmount: 8000, patientCount: 5, avgDiscount: 1600, highDiscountCount: 1 },
];

const mockStaff = [
  { name: 'Karim', role: 'Receptionist', totalDiscounts: 5, discountAmount: 5000, avgDiscount: 1000, highDiscountCount: 0 },
  { name: 'Rina', role: 'Cashier', totalDiscounts: 3, discountAmount: 3000, avgDiscount: 1000, highDiscountCount: 0 },
];

describe('DiscountReferenceAnalytics', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<DiscountReferenceAnalytics />);
    expect(screen.getByText('discountReferenceAnalytics.loading')).toBeInTheDocument();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { references: [], staff: [] }, isLoading: false } as never);
    render(<DiscountReferenceAnalytics />);
    expect(screen.getByText('discountReferenceAnalytics.title')).toBeInTheDocument();
  });

  it('renders 4 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { references: [], staff: [], summary: mockSummary },
      isLoading: false,
    } as never);
    render(<DiscountReferenceAnalytics />);
    expect(screen.getByText('discountReferenceAnalytics.summary.totalReferences')).toBeInTheDocument();
    expect(screen.getByText('discountReferenceAnalytics.summary.totalStaff')).toBeInTheDocument();
    expect(screen.getByText('discountReferenceAnalytics.summary.totalDiscountAmount')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('৳25,000.00')).toBeInTheDocument();
  });

  it('shows empty state for references', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { references: [], staff: [] }, isLoading: false } as never);
    render(<DiscountReferenceAnalytics />);
    expect(screen.getByText('discountReferenceAnalytics.empty.reference')).toBeInTheDocument();
  });

  it('shows empty state for staff', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { references: [], staff: [] }, isLoading: false } as never);
    render(<DiscountReferenceAnalytics />);
    fireEvent.click(screen.getByText('Staff-wise'));
    expect(screen.getByText('discountReferenceAnalytics.empty.staff')).toBeInTheDocument();
  });
});

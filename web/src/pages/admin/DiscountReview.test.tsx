import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiscountReview from './DiscountReview';
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
    useLocation: () => ({ pathname: '/admin/discount-review', search: params.toString(), hash: '', state: null, key: 'default' }),
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
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { securityAlerts: (date?: string) => ['admin', 'security-alerts', date] },
    billPrint: { detail: (billId: string) => ['billPrint', 'detail', billId] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('DiscountReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<DiscountReview />);
    expect(screen.getByText('discountReview.title')).toBeInTheDocument();
  });

  it('filters security alerts by selected date', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { highDiscountBills: [], summary: { highDiscountCount: 0, totalDiscountCount: 0 } },
      isLoading: false,
    } as never);

    render(<DiscountReview />);

    const dateInput = screen.getByLabelText('discountReview.date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-06-11' } });

    expect(dateInput.value).toBe('2026-06-11');
    expect(vi.mocked(useApiQuery)).toHaveBeenCalledWith(
      ['admin', 'security-alerts', '2026-06-11'],
      '/api/dashboard/security-alerts?date=2026-06-11',
      { refetchInterval: 60000 },
    );
  });

  it('renders all 7 tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<DiscountReview />);
    expect(screen.getByText('discountReview.tabs.overview')).toBeInTheDocument();
    expect(screen.getByText('discountReview.tabs.pending')).toBeInTheDocument();
    expect(screen.getByText('discountReview.tabs.approved')).toBeInTheDocument();
    expect(screen.getByText('discountReview.tabs.rejected')).toBeInTheDocument();
    expect(screen.getByText('discountReview.tabs.high')).toBeInTheDocument();
    expect(screen.getByText('discountReview.tabs.reference')).toBeInTheDocument();
    expect(screen.getByText('discountReview.tabs.staff')).toBeInTheDocument();
  });

  it('renders summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<DiscountReview />);
    expect(screen.getByText('discountReview.totalDiscounts')).toBeInTheDocument();
    expect(screen.getByText('discountReview.needsReview')).toBeInTheDocument();
    expect(screen.getByText('discountReview.totalDiscountAmount')).toBeInTheDocument();
    expect(screen.getByText('discountReview.uniqueReferences')).toBeInTheDocument();
  });


  it('shows all discounted bills in overview, not only high discounts', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        discountBills: [
          { id: 1, invoiceNo: 'INV-LOW', total: 1000, discount: 100, discountPct: 10, discountByName: 'Staff Ref', createdBy: 'Karim', createdAt: '2026-06-11T10:00:00Z' },
          { id: 2, invoiceNo: 'INV-HIGH', total: 1000, discount: 300, discountPct: 30, discountByName: 'Doctor Ref', createdBy: 'Rina', createdAt: '2026-06-11T11:00:00Z' },
        ],
        highDiscountBills: [
          { id: 2, invoiceNo: 'INV-HIGH', total: 1000, discount: 300, discountPct: 30, discountByName: 'Doctor Ref', createdBy: 'Rina', createdAt: '2026-06-11T11:00:00Z' },
        ],
        summary: { totalDiscountCount: 2, highDiscountCount: 1 },
      },
      isLoading: false,
    } as never);
    render(<DiscountReview />);
    expect(screen.getByText('INV-LOW')).toBeInTheDocument();
    expect(screen.getByText('INV-HIGH')).toBeInTheDocument();
    fireEvent.click(screen.getByText('discountReview.tabs.high'));
    expect(screen.queryByText('INV-LOW')).not.toBeInTheDocument();
    expect(screen.getByText('INV-HIGH')).toBeInTheDocument();
  });

  it('shows high discount bills in overview tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        highDiscountBills: [
          { id: 1, invoiceNo: 'INV-001', total: 5000, discount: 1000, discountPct: 20, discountByName: 'Dr. Hasan', createdBy: 'Karim', createdAt: '2026-06-11T10:00:00Z' },
          { id: 2, invoiceNo: 'INV-002', total: 8000, discount: 2400, discountPct: 30, discountByName: null, createdBy: 'Rina', createdAt: '2026-06-11T11:00:00Z' },
        ],
        summary: { highDiscountCount: 2, totalDiscountCount: 2 },
      },
      isLoading: false,
    } as never);
    render(<DiscountReview />);
    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByText('INV-002')).toBeInTheDocument();
    expect(screen.getByText('Dr. Hasan')).toBeInTheDocument();
  });

  it('shows "No high discount bills" when empty', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { highDiscountBills: [], summary: { highDiscountCount: 0, totalDiscountCount: 0 } },
      isLoading: false,
    } as never);
    render(<DiscountReview />);
    expect(screen.getByText('discountReview.noData')).toBeInTheDocument();
  });

  it('switches to reference tab and shows analysis', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        highDiscountBills: [
          { id: 1, invoiceNo: 'INV-001', total: 5000, discount: 1000, discountPct: 20, discountByName: 'Dr. Hasan', createdBy: 'Karim', createdAt: '2026-06-11T10:00:00Z' },
          { id: 2, invoiceNo: 'INV-002', total: 8000, discount: 2400, discountPct: 30, discountByName: 'Dr. Hasan', createdBy: 'Rina', createdAt: '2026-06-11T11:00:00Z' },
        ],
        summary: { highDiscountCount: 2, totalDiscountCount: 2 },
      },
      isLoading: false,
    } as never);
    render(<DiscountReview />);
    fireEvent.click(screen.getByText('discountReview.tabs.reference'));
    expect(screen.getByText('discountReview.referenceAnalysis')).toBeInTheDocument();
    expect(screen.getByText('Dr. Hasan')).toBeInTheDocument();
  });

  it('switches to staff tab and shows analysis', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        highDiscountBills: [
          { id: 1, invoiceNo: 'INV-001', total: 5000, discount: 1000, discountPct: 20, discountByName: 'Dr. Hasan', createdBy: 'Karim', createdAt: '2026-06-11T10:00:00Z' },
          { id: 2, invoiceNo: 'INV-002', total: 8000, discount: 2400, discountPct: 30, discountByName: 'Dr. Hasan', createdBy: 'Karim', createdAt: '2026-06-11T11:00:00Z' },
        ],
        summary: { highDiscountCount: 2, totalDiscountCount: 2 },
      },
      isLoading: false,
    } as never);
    render(<DiscountReview />);
    fireEvent.click(screen.getByText('discountReview.tabs.staff'));
    expect(screen.getByText('discountReview.staffAnalysis')).toBeInTheDocument();
    expect(screen.getByText('Karim')).toBeInTheDocument();
  });

  it('renders overview tab without crashing when discountBills has no discountPct (defensive fallback to highDiscountBills)', () => {
    // Production scenario: the API may return `discountBills` (newer all-discounted
    // list) WITHOUT the `discountPct` / `discountByName` fields. The page must
    // fall back gracefully instead of throwing "Cannot read properties of
    // undefined (reading 'toFixed')".
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        highDiscountBills: [
          { id: 1, invoiceNo: 'INV-001', total: 5000, discount: 1000, discountPct: 20, discountByName: 'Dr. Hasan', createdBy: 'Karim', createdAt: '2026-06-11T10:00:00Z' },
        ],
        summary: { highDiscountCount: 1, totalDiscountCount: 1 },
      },
      isLoading: false,
    } as never);
    expect(() => render(<DiscountReview />)).not.toThrow();
    expect(screen.getByText('INV-001')).toBeInTheDocument();
  });

  it('does not throw when discountBills entries are missing discountPct (the bug from the field report)', () => {
    // Reproduces the original error: the API's `discountBills` array carries
    // entries without `discountPct`. Before the fix, this threw
    // "Cannot read properties of undefined (reading 'toFixed')" on the
    // overview tab when the row tried to render `{bill.discountPct.toFixed(1)}%`.
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        highDiscountBills: [],
        // The API's newer `discountBills` field — note no `discountPct` /
        // `discountByName` fields. Even with the API fix that adds them, the
        // page must be defensive against an empty payload.
        discountBills: [
          { id: 9, invoiceNo: 'INV-009', total: 2000, discount: 200, createdBy: 'Karim', createdAt: '2026-06-11T09:00:00Z' },
        ] as never,
        summary: { highDiscountCount: 0, totalDiscountCount: 1 },
      },
      isLoading: false,
    } as never);
    expect(() => render(<DiscountReview />)).not.toThrow();
    expect(screen.getByText('INV-009')).toBeInTheDocument();
  });

  it('opens bill details with item breakdown when an invoice row is clicked', async () => {
    vi.mocked(useApiQuery).mockImplementation(((_queryKey: unknown, path: string) => {
      if (path.startsWith('/api/dashboard/security-alerts')) {
        return {
          data: {
            highDiscountBills: [
              { id: 2, invoiceNo: 'INV-002', total: 600, subtotal: 800, discount: 240, discountPct: 30, discountByName: null, createdBy: 'Rina', createdAt: '2026-06-11T11:00:00Z' },
            ],
            summary: { highDiscountCount: 1, totalDiscountCount: 1 },
          },
          isLoading: false,
        };
      }
      if (path === '/api/billing/2') {
        return {
          data: {
            bill: {
              id: 2,
              invoice_no: 'INV-002',
              patient_name: 'Rahim Uddin',
              subtotal: 800,
              discount: 240,
              discount_by_name: null,
              total_amount: 560,
              discount_reason: 'Director approved',
            },
            items: [{ id: 1, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 560 }],
            payments: [],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    }) as never);

    render(<DiscountReview />);
    fireEvent.click(screen.getByText('INV-002'));

    expect(await screen.findByText('Bill Details: INV-002')).toBeInTheDocument();
    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('CBC')).toBeInTheDocument();
    expect(screen.getByText('Director approved')).toBeInTheDocument();
  });
});

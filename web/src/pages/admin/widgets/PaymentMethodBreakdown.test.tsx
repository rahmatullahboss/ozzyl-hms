import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentMethodBreakdown from './PaymentMethodBreakdown';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('../../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../../lib/queryKeys', () => ({ queryKeys: { admin: { paymentBreakdown: () => ['admin', 'payment-breakdown'] } } }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>;
}

function renderWidget(
  props: React.ComponentProps<typeof PaymentMethodBreakdown> = {},
  entry = '/h/city-hospital/dashboard',
) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/h/:slug/*"
          element={(
            <>
              <PaymentMethodBreakdown {...props} />
              <LocationProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PaymentMethodBreakdown', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading skeleton when loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: null, isLoading: true } as ReturnType<typeof useApiQuery>);
    const { container } = renderWidget();
    expect(container.querySelector('.skeleton')).toBeTruthy();
  });

  it('renders legacy daily collection data when no command-center filters are supplied', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { by_payment_method: [
        { payment_method: 'cash', total_amount: 45_000 },
        { payment_method: 'bkash', total_amount: 15_000 },
        { payment_method: 'card', total_amount: 10_000 },
        { payment_method: 'nagad', total_amount: 5_000 },
      ] },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);

    renderWidget();
    expect(screen.getByText('adminDashboard.paymentMethods.cash')).toBeInTheDocument();
    expect(screen.getByText('৳45,000')).toBeInTheDocument();
    expect(screen.getByText('৳75,000.00')).toBeInTheDocument();
    expect(useApiQuery).toHaveBeenCalledWith(
      ['admin', 'payment-breakdown'],
      expect.stringMatching(/^\/api\/reports\/daily-collection\?date=\d{4}-\d{2}-\d{2}$/),
      undefined,
    );
  });

  it('requests the full selected command-center range', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { methods: [], depositMethods: [], totalCollection: 0, depositReceipts: 0 },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);

    renderWidget({ filters: { preset: '7d', startDate: '2026-07-21', endDate: '2026-07-27' } });
    expect(useApiQuery).toHaveBeenCalledWith(
      ['admin', 'payment-breakdown', '2026-07-21', '2026-07-27'],
      '/api/dashboard/payment-methods?startDate=2026-07-21&endDate=2026-07-27',
      undefined,
    );
    expect(screen.getByText('2026-07-21 – 2026-07-27 · payment date')).toBeInTheDocument();
  });

  it('renders operational collection and patient deposits as separate flows', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        totalCollection: 750,
        methods: [
          { key: 'cash', label: 'Cash', amount: 500, count: 2, percentage: 66.67 },
          { key: 'bkash', label: 'bKash', amount: 250, count: 1, percentage: 33.33 },
        ],
        depositReceipts: 300,
        depositMethods: [{ key: 'cash', label: 'Cash', amount: 300, count: 1 }],
        depositTreatment: 'separate_liability_flow',
        reconciliation: { status: 'reconciled' },
      },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);

    renderWidget({ filters: { preset: '7d', startDate: '2026-07-21', endDate: '2026-07-27' } });
    expect(screen.getByText('Operational collection')).toBeInTheDocument();
    expect(screen.getByText('Patient deposits — separate liability flow')).toBeInTheDocument();
    expect(screen.getByText('৳750.00')).toBeInTheDocument();
    expect(screen.getByText('৳300.00')).toBeInTheDocument();
  });

  it('opens the selected payment method detail filter', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        totalCollection: 500,
        methods: [{ key: 'cash', label: 'Cash', amount: 500, count: 2, percentage: 100 }],
        depositReceipts: 0,
        depositMethods: [],
        reconciliation: { status: 'reconciled' },
      },
      isLoading: false,
    } as ReturnType<typeof useApiQuery>);

    renderWidget({ filters: { preset: '7d', startDate: '2026-07-21', endDate: '2026-07-27' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Cash payment details' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/h/city-hospital/cash/collections?from=2026-07-21&to=2026-07-27&paymentMethod=cash#daily-collection-snapshot',
    );
    expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');
  });

  it('shows an empty state when no payment methods exist', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { methods: [] }, isLoading: false } as ReturnType<typeof useApiQuery>);
    renderWidget({ filters: { preset: 'today', startDate: '2026-07-27', endDate: '2026-07-27' } });
    expect(screen.getByText('adminDashboard.paymentMethods.noData')).toBeInTheDocument();
  });

  describe('error handling', () => {
    it('renders an accessible error state', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: null, isLoading: false, isError: true, refetch: vi.fn() } as ReturnType<typeof useApiQuery>);
      renderWidget();
      expect(screen.getByRole('alert')).toHaveTextContent('adminDashboard.errors.loadFailed');
    });

    it('retries the failed query', () => {
      const refetch = vi.fn();
      vi.mocked(useApiQuery).mockReturnValue({ data: null, isLoading: false, isError: true, refetch } as ReturnType<typeof useApiQuery>);
      renderWidget();
      fireEvent.click(screen.getByText('adminDashboard.errors.retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });
});

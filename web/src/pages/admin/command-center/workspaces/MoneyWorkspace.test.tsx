import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MoneyWorkspace from './MoneyWorkspace';
import { useApiQuery } from '../../../../hooks/useApiQuery';

vi.mock('../../../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../../../hooks/useExecutiveDashboardAnalytics', () => ({
  useExecutiveDashboardAnalytics: vi.fn(() => ({
    incomeServices: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
    expenseAnalysis: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
  })),
}));
vi.mock('../../../../lib/queryKeys', () => ({
  queryKeys: {
    admin: {
      financialControl: (startDate: string, endDate: string) => ['admin', 'financial-control', startDate, endDate],
    },
  },
}));
vi.mock('../../../../components/dashboard/IncomeServicePanel', () => ({ default: () => <div data-testid="income-service-panel" /> }));
vi.mock('../../../../components/dashboard/ExpenseAnalysisPanel', () => ({ default: () => <div data-testid="expense-analysis-panel" /> }));
vi.mock('../../widgets/RevenueTrendChart', () => ({ default: () => <div data-testid="revenue-trend" /> }));
vi.mock('../../widgets/PaymentMethodBreakdown', () => ({ default: () => <div data-testid="payment-method-breakdown" /> }));

const reconciled = {
  summaryTotal: 0,
  detailTotal: 0,
  unexplainedDifference: 0,
  tolerance: 0.01,
  isBalanced: true,
  detailRowCount: 2,
  providerMode: 'legacy',
  checkedAt: '2026-07-27T12:00:00.000Z',
  detailGrain: 'one source row',
  status: 'reconciled',
  warnings: [],
};

const response = {
  businessPerformance: {
    recognizedIncome: 1_000,
    approvedExpensePaid: 200,
    operatingResult: 800,
    depositReceipts: 300,
    depositTreatment: 'liability_not_revenue',
    reconciliation: { ...reconciled, summaryTotal: 800, detailTotal: 790, unexplainedDifference: 10, isBalanced: false, status: 'warning', warnings: ['Summary and detail totals differ by BDT 10.00.'] },
  },
  collectionFlow: {
    currentInvoiceCollection: 600,
    priorDueCollection: 400,
    totalCollection: 1_000,
    depositReceipts: 300,
    depositIncludedInTotalCollection: false,
    transactionCount: 8,
    reconciliation: { ...reconciled, summaryTotal: 1_000, detailTotal: 1_000 },
  },
  cashCustody: {
    physicalCashIn: 800,
    physicalCashOut: 175,
    netCashMovement: 625,
    nonCashCollection: 300,
    currentDrawerBalance: 2_400,
    currentDrawerTemporalMode: 'current_state',
    reconciliation: { ...reconciled, summaryTotal: 625, detailTotal: 625 },
  },
  doctorLiability: {
    earned: 500,
    waiver: 100,
    payable: 400,
    paid: 150,
    outstanding: 250,
    rowCount: 4,
    providerMode: 'legacy',
    reconciliation: { ...reconciled, summaryTotal: 250, detailTotal: 250 },
  },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>;
}

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/h/city-hospital/dashboard?tab=money']}>
      <Routes>
        <Route
          path="/h/:slug/*"
          element={(
            <>
              <MoneyWorkspace filters={{ preset: '7d', startDate: '2026-07-21', endDate: '2026-07-27' }} />
              <LocationProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MoneyWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({ data: response, isLoading: false, isError: false, refetch: vi.fn() } as ReturnType<typeof useApiQuery>);
  });

  it('requests one reconciled financial-control response for the selected period', () => {
    renderWorkspace();
    expect(useApiQuery).toHaveBeenCalledWith(
      ['admin', 'financial-control', '2026-07-21', '2026-07-27'],
      '/api/dashboard/financial-control?startDate=2026-07-21&endDate=2026-07-27',
    );
  });

  it('renders four separate financial blocks with server formulas', () => {
    renderWorkspace();
    expect(screen.getByTestId('financial-block-business-performance')).toHaveTextContent('Recognised income − paid expense = operating result');
    expect(screen.getByTestId('financial-block-collection-flow')).toHaveTextContent('Current invoice collection + prior-due collection = total collection');
    expect(screen.getByTestId('financial-block-cash-custody')).toHaveTextContent('Physical cash in − physical cash out = net cash movement');
    expect(screen.getByTestId('financial-block-doctor-liability')).toHaveTextContent('Earned − waiver = payable; payable − paid = outstanding');
  });

  it('keeps deposits, non-cash collection, and current drawer balance visually separate', () => {
    renderWorkspace();
    const business = within(screen.getByTestId('financial-block-business-performance'));
    expect(business.getByText('Patient deposits (liability, not revenue)')).toBeInTheDocument();
    expect(business.getByText('৳300.00')).toBeInTheDocument();

    const cash = within(screen.getByTestId('financial-block-cash-custody'));
    expect(cash.getByText('Non-cash collection')).toBeInTheDocument();
    expect(cash.getByText('Current drawer balance')).toBeInTheDocument();
    expect(cash.getByText('Live/current state')).toBeInTheDocument();
  });

  it('shows the full doctor liability bridge without recalculating it', () => {
    renderWorkspace();
    const block = within(screen.getByTestId('financial-block-doctor-liability'));
    for (const label of ['Earned', 'Waiver', 'Payable', 'Paid', 'Outstanding']) {
      expect(block.getByText(label)).toBeInTheDocument();
    }
    for (const amount of ['৳500.00', '৳100.00', '৳400.00', '৳150.00', '৳250.00']) {
      expect(block.getByText(amount)).toBeInTheDocument();
    }
  });

  it('shows the exact reconciliation difference and does not hide the warning', () => {
    renderWorkspace();
    const business = within(screen.getByTestId('financial-block-business-performance'));
    expect(business.getByText('Reconciliation warning')).toBeInTheDocument();
    expect(business.getByText('Difference: ৳10.00')).toBeInTheDocument();
  });

  it('opens the existing detail destination for each control block', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open cash custody details' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/h/city-hospital/cash/drawers?from=2026-07-21&to=2026-07-27');
  });
});

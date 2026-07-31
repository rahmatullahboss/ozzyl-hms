import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DoctorPerformancePanel from './DoctorPerformancePanel';
import type { DoctorPerformanceResponse } from '../../types/executiveDashboard';

const data: DoctorPerformanceResponse = {
  period: { startDate: '2026-07-01', endDate: '2026-07-12', label: '2026-07-01 → 2026-07-12' },
  queryContract: {
    contractVersion: 'doctor-compensation-v1',
    dataSource: 'legacy',
    moneyUnit: 'major',
    currencyCode: 'BDT',
    dateBasis: 'tenant-business-date-asia-dhaka',
    cutoverPolicy: 'explicit-provider-switch',
  },
  totals: {
    visits: 12,
    visitCollection: 12000,
    visitCommission: 1200,
    tests: 8,
    referredTests: 8,
    discountedTests: 2,
    testGrossAmount: 10000,
    testDiscountAmount: 2000,
    testCollection: 8000,
    referrerCommission: 600,
    performerReserveCount: 3,
    performedTests: 3,
    performerReserve: 500,
    testCommission: 1100,
    otherCommission: 200,
    earnedCommission: 2500,
    doctorWaiver: 300,
    payableCommission: 2200,
    paidCommission: 1200,
    outstandingCommission: 1000,
    totalCommission: 2200,
    lastActivityAt: null,
    lastActivityType: null,
  },
  rows: [{
    doctorId: 7,
    doctorName: 'Dr. Amina Rahman',
    visits: 12,
    visitCollection: 12000,
    visitCommission: 1200,
    tests: 8,
    referredTests: 8,
    discountedTests: 2,
    testGrossAmount: 10000,
    testDiscountAmount: 2000,
    testCollection: 8000,
    referrerCommission: 600,
    performerReserveCount: 3,
    performedTests: 3,
    performerReserve: 500,
    testCommission: 1100,
    otherCommission: 200,
    earnedCommission: 2500,
    doctorWaiver: 300,
    payableCommission: 2200,
    paidCommission: 1200,
    outstandingCommission: 1000,
    totalCommission: 2200,
    lastActivityAt: '2026-07-12 14:30:00',
    lastActivityType: 'commission_accrued',
  }],
  page: 1,
  pageSize: 10,
  totalRows: 1,
  hasNextPage: false,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof DoctorPerformancePanel>> = {}) {
  const props: React.ComponentProps<typeof DoctorPerformancePanel> = {
    data,
    loading: false,
    error: false,
    sortBy: 'payableCommission',
    onDoctorOpen: vi.fn(),
    onPageChange: vi.fn(),
    onSortChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<DoctorPerformancePanel {...props} />), props };
}

describe('DoctorPerformancePanel', () => {
  it('renders only priority desktop columns and removes the 1800px table constraint', () => {
    renderPanel();

    const desktopTable = screen.getByTestId('doctor-performance-desktop-table');
    const headers = within(desktopTable).getAllByRole('columnheader').map((header) => header.textContent?.trim());
    expect(headers).toEqual([
      'Doctor',
      'Visits',
      'Referred',
      'Performed',
      'Collection',
      'Payable',
      'Paid',
      'Outstanding',
      'Last activity',
    ]);
    expect(desktopTable).not.toHaveClass('min-w-[1800px]');
    expect(screen.getAllByText('Dr. Amina Rahman').length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳20,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Commission accrued').length).toBeGreaterThan(0);
  });

  it('exposes server-sort state with aria-sort and preserves callbacks', () => {
    const onDoctorOpen = vi.fn();
    const onSortChange = vi.fn();
    renderPanel({ onDoctorOpen, onSortChange });

    expect(screen.getByRole('columnheader', { name: 'Payable' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: 'Visits' })).toHaveAttribute('aria-sort', 'none');

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Dr. Amina Rahman details' })[0]);
    expect(onDoctorOpen).toHaveBeenCalledWith(data.rows[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Sort by visits' }));
    expect(onSortChange).toHaveBeenCalledWith('visits');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by payable' }));
    expect(onSortChange).toHaveBeenCalledWith('payableCommission');
  });

  it('uses mobile cards and progressive disclosure for secondary values', () => {
    renderPanel();

    const mobileList = screen.getByTestId('doctor-performance-mobile-list');
    expect(within(mobileList).getByText('Visits')).toBeInTheDocument();
    expect(within(mobileList).getByText('Referred')).toBeInTheDocument();
    expect(within(mobileList).getByText('Payable')).toBeInTheDocument();
    expect(within(mobileList).queryByText('Doctor waiver')).not.toBeInTheDocument();

    fireEvent.click(within(mobileList).getByRole('button', { name: 'Show more metrics for Dr. Amina Rahman' }));
    expect(within(mobileList).getByText('Doctor waiver')).toBeInTheDocument();
    expect(within(mobileList).getByText('Test discount')).toBeInTheDocument();
    expect(within(mobileList).getByText('Performer reserve')).toBeInTheDocument();
  });

  it('keeps server pagination controls', () => {
    const onPageChange = vi.fn();
    renderPanel({
      data: { ...data, page: 2, totalRows: 21, hasNextPage: true },
      onPageChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous doctor page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next doctor page' }));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
  });

  it('renders scoped loading, error, and empty states', () => {
    const { rerender } = render(
      <DoctorPerformancePanel
        loading
        error={false}
        sortBy="visits"
        onDoctorOpen={vi.fn()}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Loading doctor performance')).toBeInTheDocument();

    rerender(
      <DoctorPerformancePanel
        loading={false}
        error
        sortBy="visits"
        onDoctorOpen={vi.fn()}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load doctor performance');

    rerender(
      <DoctorPerformancePanel
        data={{ ...data, rows: [], totalRows: 0 }}
        loading={false}
        error={false}
        sortBy="visits"
        onDoctorOpen={vi.fn()}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No doctor activity was found for this period.')).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UnassignedPerformerReservePanel from './UnassignedPerformerReservePanel';

const mockMutate = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockRefetch = vi.fn();
const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockUseApiMutation = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: (...args: unknown[]) => mockUseApiMutation(...args),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const reserves = {
  groups: [
    {
      billingServiceItemId: 501,
      testCode: 'RAD-USG-WA',
      testName: 'USG Whole Abdomen',
      diagnosticKind: 'radiology',
      eligibleQuantity: 2,
      waitingPaymentQuantity: 1,
      eligibleAmount: 400,
      waitingPaymentAmount: 200,
      rateSummary: '৳200/unit',
      reserves: [
        { reserveId: 701, serviceDate: '2026-07-13 09:00:00', patientId: 11, patientName: 'Karim', patientCode: 'P-11', billId: 501, invoiceNo: 'INV-501', netUnitServiceAmount: 1000, payoutMaximumAmount: 1000, reservedAmount: 200, billIsPaid: true },
        { reserveId: 704, serviceDate: '2026-07-13 10:00:00', patientId: 14, patientName: 'Salma', patientCode: 'P-14', billId: 504, invoiceNo: 'INV-504', netUnitServiceAmount: 900, payoutMaximumAmount: 900, reservedAmount: 200, billIsPaid: true },
        { reserveId: 702, serviceDate: '2026-07-13 11:00:00', patientId: 12, patientName: 'Rahima', patientCode: 'P-12', billId: 502, invoiceNo: 'INV-502', netUnitServiceAmount: 900, payoutMaximumAmount: 900, reservedAmount: 200, billIsPaid: false },
      ],
    },
  ],
  summary: {
    testCount: 1,
    eligibleQuantity: 2,
    waitingPaymentQuantity: 1,
    eligibleAmount: 400,
    waitingPaymentAmount: 200,
  },
};

beforeEach(() => {
  mockMutate.mockReset();
  mockInvalidateQueries.mockReset();
  mockRefetch.mockReset();
  mockUseApiMutation.mockReset();
  mockUseApiQuery.mockReset();
  mockUseApiQuery.mockImplementation((_key: unknown, path: string) => {
    if (path.includes('unassigned-performer-reserves')) {
      return { data: reserves, isLoading: false, refetch: mockRefetch };
    }
    if (path.startsWith('/api/doctors')) {
      return { data: { doctors: [{ id: 7, name: 'Dr. Aminul Islam', specialty: 'Radiology' }] }, isLoading: false, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, refetch: vi.fn() };
  });
  mockUseApiMutation.mockReturnValue({ mutate: mockMutate, isPending: false });
});

describe('UnassignedPerformerReservePanel', () => {
  it('shows eligible/waiting quantities and selects the oldest eligible rows by quantity', () => {
    render(<UnassignedPerformerReservePanel activeCounterId={1} expectedCash={1000} enabled />);

    expect(screen.getByText('Unassigned Test Performer Reserves')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for payment: 1/)).toBeInTheDocument();
    const quantity = screen.getByLabelText('USG Whole Abdomen payout quantity');
    fireEvent.change(quantity, { target: { value: '2' } });

    expect(screen.getByText('Selected 2 units · ৳400')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show reserve details/i }));
    expect(screen.getByLabelText('Select reserve 701')).toBeChecked();
    expect(screen.getByLabelText('Select reserve 704')).toBeChecked();
    expect(screen.getByLabelText('Select reserve 702')).toBeDisabled();
  });

  it('exposes a group payout-per-unit editor after quantity selection and submits overrides for every selected reserve', () => {
    render(<UnassignedPerformerReservePanel activeCounterId={1} expectedCash={5000} enabled />);

    fireEvent.change(screen.getByLabelText('USG Whole Abdomen payout quantity'), { target: { value: '2' } });

    const payoutPerUnit = screen.getByLabelText('USG Whole Abdomen payout per unit');
    expect(payoutPerUnit).toHaveValue(200);
    fireEvent.change(payoutPerUnit, { target: { value: '800' } });

    expect(screen.getByText('Selected 2 units · ৳1,600')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('USG Whole Abdomen payout override reason'), {
      target: { value: 'Senior performer rate' },
    });
    fireEvent.change(screen.getByLabelText('Performer doctor'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /pay performer/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      reserveIds: [701, 704],
      lineOverrides: [
        { lineId: 701, payoutAmount: 800, reason: 'Senior performer rate' },
        { lineId: 704, payoutAmount: 800, reason: 'Senior performer rate' },
      ],
    }));
  });

  it('loads performer reserves for the selected date range and exposes date controls', () => {
    const onDateRangeChange = vi.fn();
    render(
      <UnassignedPerformerReservePanel
        activeCounterId={1}
        expectedCash={1000}
        enabled
        dateFrom="2026-07-13"
        dateTo="2026-07-13"
        onDateRangeChange={onDateRangeChange}
      />,
    );

    expect(mockUseApiQuery.mock.calls).toContainEqual(expect.arrayContaining([
      ['doctor-payouts', 'unassigned-performer-reserves', 1, '2026-07-13', '2026-07-13'],
      '/api/payment-methods/doctor-payouts/unassigned-performer-reserves?includeWaitingPayment=true&from=2026-07-13&to=2026-07-13',
    ]));
    expect(screen.getByLabelText('Reserve from date')).toHaveValue('2026-07-13');
    expect(screen.getByLabelText('Reserve to date')).toHaveValue('2026-07-13');

    fireEvent.change(screen.getByLabelText('Reserve from date'), { target: { value: '2026-07-12' } });
    expect(onDateRangeChange).toHaveBeenCalledWith('2026-07-12', '2026-07-13');
  });

  it('clears selected reserve rows when the date range changes', () => {
    const { rerender } = render(
      <UnassignedPerformerReservePanel
        activeCounterId={1}
        expectedCash={1000}
        enabled
        dateFrom="2026-07-13"
        dateTo="2026-07-13"
        onDateRangeChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('USG Whole Abdomen payout quantity'), { target: { value: '2' } });
    expect(screen.getByText('Selected 2 units · ৳400')).toBeInTheDocument();

    rerender(
      <UnassignedPerformerReservePanel
        activeCounterId={1}
        expectedCash={1000}
        enabled
        dateFrom="2026-07-12"
        dateTo="2026-07-12"
        onDateRangeChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Selected 0 units · ৳0')).toBeInTheDocument();
  });

  it('requires a doctor and blocks payout above current drawer cash', () => {
    render(<UnassignedPerformerReservePanel activeCounterId={1} expectedCash={100} enabled />);

    fireEvent.change(screen.getByLabelText('USG Whole Abdomen payout quantity'), { target: { value: '1' } });
    expect(screen.getByRole('button', { name: /pay performer/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Performer doctor'), { target: { value: '7' } });
    expect(screen.getByText('Selected payout is greater than current drawer cash.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pay performer/i })).toBeDisabled();
  });

  it('edits a reserve payout amount, requires a reason, and submits a line override', () => {
    render(<UnassignedPerformerReservePanel activeCounterId={1} expectedCash={2000} enabled />);

    fireEvent.change(screen.getByLabelText('USG Whole Abdomen payout quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /show reserve details/i }));
    const finalAmount = screen.getByLabelText('Final payout for reserve 701');
    fireEvent.change(finalAmount, { target: { value: '800' } });

    expect(screen.getByText('Difference +৳600')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Performer doctor'), { target: { value: '7' } });
    expect(screen.getByRole('button', { name: /pay performer/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Override reason for reserve 701'), { target: { value: 'Senior performer fee' } });
    expect(screen.getByText('Selected 1 units · ৳800')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pay performer/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      reserveIds: [701],
      lineOverrides: [{ lineId: 701, payoutAmount: 800, reason: 'Senior performer fee' }],
    }));
  });

  it('allows a full-discount reserve payout using the original service cap', () => {
    const fullDiscountReserves = {
      ...reserves,
      groups: reserves.groups.map((group) => ({
        ...group,
        reserves: group.reserves.map((reserve) => reserve.reserveId === 701
          ? { ...reserve, netUnitServiceAmount: 0, payoutMaximumAmount: 1000 }
          : reserve),
      })),
    };
    mockUseApiQuery.mockImplementation((_key: unknown, path: string) => {
      if (path.includes('unassigned-performer-reserves')) {
        return { data: fullDiscountReserves, isLoading: false, refetch: mockRefetch };
      }
      if (path.startsWith('/api/doctors')) {
        return { data: { doctors: [{ id: 7, name: 'Dr. Aminul Islam', specialty: 'Radiology' }] }, isLoading: false, refetch: vi.fn() };
      }
      return { data: undefined, isLoading: false, refetch: vi.fn() };
    });

    render(<UnassignedPerformerReservePanel activeCounterId={1} expectedCash={2000} enabled />);
    fireEvent.change(screen.getByLabelText('USG Whole Abdomen payout quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /show reserve details/i }));
    fireEvent.change(screen.getByLabelText('Final payout for reserve 701'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Override reason for reserve 701'), { target: { value: 'Full-discount senior performer fee' } });
    fireEvent.change(screen.getByLabelText('Performer doctor'), { target: { value: '7' } });

    expect(screen.queryByText('Each payout must be positive and cannot exceed the service amount.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pay performer/i })).toBeEnabled();
  });

  it('submits exact reserve IDs and resets through the success callback', () => {
    const onRecorded = vi.fn();
    render(<UnassignedPerformerReservePanel activeCounterId={1} expectedCash={1000} enabled onRecorded={onRecorded} />);

    fireEvent.change(screen.getByLabelText('USG Whole Abdomen payout quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Performer doctor'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Performer payout note'), { target: { value: 'USG envelope' } });
    fireEvent.click(screen.getByRole('button', { name: /pay performer/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      doctorId: 7,
      reserveIds: [701, 704],
      receiverName: 'Dr. Aminul Islam',
      paymentMethod: 'cash',
      adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
      note: 'USG envelope',
      idempotencyKey: expect.any(String),
    }));

    const mutationOptions = mockUseApiMutation.mock.calls[0][2] as { onSuccess: (response: unknown) => void };
    act(() => {
      mutationOptions.onSuccess({ amount: 400, doctorName: 'Dr. Aminul Islam' });
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['doctor-payouts'] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['billing-counter'] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['daily-collection'] });
    expect(onRecorded).toHaveBeenCalled();
  });
});

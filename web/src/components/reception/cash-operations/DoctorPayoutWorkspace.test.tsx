import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorPayoutWorkspace from './DoctorPayoutWorkspace';

const mockMutate = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockUseApiMutation = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (_key: string, options?: Record<string, unknown>) => options?.defaultValue ?? _key,
    }),
  };
});

vi.mock('../../../hooks/useApiQuery', () => ({
  useApiMutation: (...args: unknown[]) => mockUseApiMutation(...args),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const doctors = [{
  doctorId: 7,
  doctorName: 'Dr. Aminul Islam',
  payableAmount: 150,
  eligibleItemCount: 1,
  items: [{
    accrualId: 102,
    serviceDate: '2026-07-24',
    sourceType: 'lab_test',
    serviceName: 'Echo',
    patientName: 'Karim Ali',
    invoiceNo: 'INV-502',
    grossAmount: 1500,
    commissionAmount: 150,
  }],
}];

beforeEach(() => {
  mockMutate.mockReset();
  mockInvalidateQueries.mockReset();
  mockUseApiMutation.mockReset();
  mockUseApiMutation.mockReturnValue({ mutate: mockMutate, isPending: false });
});

describe('DoctorPayoutWorkspace', () => {
  it('filters zero-balance items and excludes them from select all payout', () => {
    const doctorsWithZeroBalance = [{
      ...doctors[0],
      payableAmount: 150,
      eligibleItemCount: 2,
      items: [
        ...doctors[0].items,
        {
          accrualId: 103,
          serviceDate: '2026-07-24',
          sourceType: 'lab_test',
          serviceName: 'Zero Commission Test',
          patientName: 'Rahima Begum',
          invoiceNo: 'INV-503',
          grossAmount: 1000,
          commissionAmount: 150,
          payableAmount: 0,
        },
      ],
    }];

    render(
      <DoctorPayoutWorkspace
        doctors={doctorsWithZeroBalance}
        sessionId={1}
        dateFrom="2026-07-24"
        dateTo="2026-07-24"
        availableCash={2000}
        onDateRangeChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Zero Commission Test')).not.toBeInTheDocument();
    expect(screen.getByText('1 unpaid items')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm payout ৳150.00/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      accrualIds: [102],
      lineOverrides: [],
    }));
  });

  it('prunes a selected accrual when refreshed data no longer has a positive payable balance', () => {
    const secondDoctor = {
      doctorId: 8,
      doctorName: 'Dr. Nusrat Jahan',
      payableAmount: 200,
      eligibleItemCount: 1,
      items: [{
        accrualId: 202,
        serviceDate: '2026-07-24',
        sourceType: 'consultation_fee',
        serviceName: 'Consultation',
        patientName: 'Salma Begum',
        invoiceNo: 'INV-602',
        grossAmount: 800,
        commissionAmount: 200,
        payableAmount: 200,
      }],
    };
    const { rerender } = render(
      <DoctorPayoutWorkspace
        doctors={[...doctors, secondDoctor]}
        sessionId={1}
        dateFrom="2026-07-24"
        dateTo="2026-07-24"
        availableCash={2000}
        onDateRangeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: /Confirm payout ৳150.00/i })).toBeEnabled();

    rerender(
      <DoctorPayoutWorkspace
        doctors={[
          {
            ...doctors[0],
            payableAmount: 0,
            items: [{ ...doctors[0].items[0], payableAmount: 0 }],
          },
          secondDoctor,
        ]}
        sessionId={1}
        dateFrom="2026-07-24"
        dateTo="2026-07-24"
        availableCash={2000}
        onDateRangeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Confirm payout ৳0.00/i })).toBeDisabled();
    expect(screen.getByLabelText('Receiver name')).toHaveValue('Dr. Nusrat Jahan');
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('edits an assigned performer payout and submits audited line override evidence', () => {
    render(
      <DoctorPayoutWorkspace
        doctors={doctors}
        sessionId={1}
        dateFrom="2026-07-24"
        dateTo="2026-07-24"
        availableCash={2000}
        onDateRangeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Echo/i }));
    fireEvent.change(screen.getByLabelText('Final payout for accrual 102'), { target: { value: '800' } });

    expect(screen.getByText('Difference +৳650.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm payout/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Override reason for accrual 102'), { target: { value: 'Senior echo performer rate' } });
    expect(screen.getByText('Pay now:')).toBeInTheDocument();
    expect(screen.getAllByText('৳800.00').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Confirm payout ৳800.00/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      accrualIds: [102],
      lineOverrides: [{ lineId: 102, payoutAmount: 800, reason: 'Senior echo performer rate' }],
      receiverName: 'Dr. Aminul Islam',
      paymentMethod: 'cash',
    }));
  });
});

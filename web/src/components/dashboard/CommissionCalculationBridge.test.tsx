import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CommissionCalculationBridge from './CommissionCalculationBridge';
import type { DoctorCommissionDetailRow } from '../../types/executiveDashboard';

const row: DoctorCommissionDetailRow = {
  id: 3,
  occurredAt: '2026-07-10',
  sourceType: 'lab_test',
  incentiveType: 'prescriber',
  doctorName: 'Dr. Amina Rahman',
  detailName: 'CBC',
  referenceNo: 'INV-2',
  billId: 92,
  commissionRuleId: 77,
  commissionRuleVersion: 4,
  grossAmount: 1200,
  discountAmount: 200,
  netBilledAmount: 1000,
  performerReserveAmount: 200,
  commissionBaseAmount: 800,
  rateLabel: '12.50%',
  earnedAmount: 100,
  waiverAmount: 20,
  adjustmentAmount: -5,
  payableAmount: 75,
  paidAmount: 30,
  outstandingAmount: 45,
  settlementNo: 'SET-7',
  waiverReason: 'Patient support',
  reasonCode: 'doctor_waived',
  reasonLabel: 'Doctor waived commission',
  amount: 75,
  status: 'partially_paid',
};

describe('CommissionCalculationBridge', () => {
  it('displays every server-provided commission bridge field without recalculating it', () => {
    render(<CommissionCalculationBridge row={row} />);

    for (const label of [
      'Gross',
      'Discount',
      'Performer reserve',
      'Eligible base',
      'Rate',
      'Rule',
      'Earned',
      'Doctor waiver',
      'Adjustment',
      'Payable',
      'Paid',
      'Outstanding',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Rule 77 · version 4')).toBeInTheDocument();
    expect(screen.getByText('Doctor waived commission')).toBeInTheDocument();
    expect(screen.getByText('doctor_waived')).toBeInTheDocument();
    expect(screen.getByText('৳-5.00')).toBeInTheDocument();
    expect(screen.getByText('৳75.00')).toBeInTheDocument();
    expect(screen.getByText('৳45.00')).toBeInTheDocument();
  });

  it('shows the historical limitation instead of guessing a missing rule version', () => {
    render(<CommissionCalculationBridge row={{ ...row, commissionRuleVersion: null }} />);
    expect(screen.getByText('Historical rule version not recorded')).toBeInTheDocument();
    expect(screen.queryByText(/version 4/i)).not.toBeInTheDocument();
  });

  it('opens the common invoice callback only for rows with a bill ID', () => {
    const onInvoiceOpen = vi.fn();
    const { rerender } = render(<CommissionCalculationBridge row={row} onInvoiceOpen={onInvoiceOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice INV-2' }));
    expect(onInvoiceOpen).toHaveBeenCalledWith(92);

    rerender(<CommissionCalculationBridge row={{ ...row, billId: null }} onInvoiceOpen={onInvoiceOpen} />);
    expect(screen.queryByRole('button', { name: 'Open invoice INV-2' })).not.toBeInTheDocument();
  });
});

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InvoiceTotalsPayment from './InvoiceTotalsPayment';

const labels = {
  paymentMethod: 'Payment Method',
  subtotal: 'Subtotal',
  discount: 'Discount',
  discountReason: 'Reason',
  discountReference: 'Reference',
  approvedBy: 'Approved By',
  tax: 'Tax',
  totalAmount: 'Total Amount',
  paid: 'Paid',
  depositAdjusted: 'Deposit Adjusted',
  due: 'Due',
  paidStatus: 'PAID',
  partialStatus: 'PARTIAL',
  unpaidStatus: 'UNPAID',
  unpaidAmount: 'Unpaid',
  paymentHistory: 'Payment Ledger',
  paymentReceived: 'Payment Received',
  dischargeSettlement: 'Final Payment',
  ledgerDepositAdjusted: 'Deposit Received',
  receipt: 'Receipt',
};

const baseProps = {
  identifier: <span>INV-1</span>,
  subtotal: 35_445,
  discount: 1_245,
  tax: 0,
  total: 34_200,
  paid: 34_200,
  depositAdjusted: 300,
  outstanding: 0,
  status: 'paid',
  money: (amount: number) => `৳${amount}`,
  labels,
};

describe('InvoiceTotalsPayment', () => {
  it('renders the original deposit and final payment as ledger rows without a duplicate settlement summary', () => {
    render(
      <InvoiceTotalsPayment
        {...baseProps}
        paymentLedger={[
          {
            id: 'deposit-1',
            kind: 'deposit',
            amount: 300,
            paymentMethod: 'Cash',
            reference: 'DEP-1',
            createdAt: '2026-07-09T12:45:54Z',
            isDischargeSettlement: false,
          },
          {
            id: 'payment-2',
            kind: 'payment',
            amount: 33_900,
            paymentMethod: 'Cash',
            reference: 'RCP-2',
            createdAt: '2026-07-16T15:50:49+06:00',
            isDischargeSettlement: true,
          },
        ]}
        formatLedgerDateTime={(value) => value.slice(0, 10)}
      />,
    );

    const ledger = screen.getByTestId('invoice-payment-ledger');
    expect(ledger.closest('.invoice-payment-compact')).toHaveClass('has-ledger');
    expect(within(ledger).getByText('Payment Ledger')).toBeInTheDocument();
    expect(within(ledger).getByText('PAID')).toBeInTheDocument();
    expect(within(ledger).getByText('Deposit Received')).toBeInTheDocument();
    expect(within(ledger).getByText('Final Payment')).toBeInTheDocument();
    expect(within(ledger).queryByText('Settled at discharge')).not.toBeInTheDocument();
    expect(within(ledger).getByText('৳300')).toBeInTheDocument();
    expect(within(ledger).getAllByText('৳33900')).toHaveLength(1);
    expect(within(ledger).getByText(/2026-07-09.*Cash.*DEP-1/)).toBeInTheDocument();
  });

  it('shows PARTIAL and does not invent a final payment', () => {
    render(
      <InvoiceTotalsPayment
        {...baseProps}
        paid={1_000}
        depositAdjusted={0}
        outstanding={33_200}
        status="partial"
        paymentLedger={[
          {
            id: 'payment-1',
            kind: 'payment',
            amount: 1_000,
            createdAt: '2026-07-16T09:00:00+06:00',
            isDischargeSettlement: false,
          },
        ]}
      />,
    );

    const ledger = screen.getByTestId('invoice-payment-ledger');
    expect(within(ledger).getByText('PARTIAL')).toBeInTheDocument();
    expect(within(ledger).getByText('Payment Received')).toBeInTheDocument();
    expect(within(ledger).queryByText('Final Payment')).not.toBeInTheDocument();
  });

  it('falls back to the existing compact status block when ledger is empty', () => {
    const { container } = render(
      <InvoiceTotalsPayment {...baseProps} paymentMethodLabel="Cash" paymentLedger={[]} />,
    );

    expect(container.querySelector('.invoice-payment-ledger')).not.toBeInTheDocument();
    expect(container.querySelector('.invoice-payment-compact-status')).toBeInTheDocument();
    expect(screen.getByText('Payment Method')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });

  it('uses one compact payment summary instead of two large payment cards', async () => {
    const source = await import('./InvoiceTotalsPayment?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('invoice-payment-compact');
    expect(text).not.toContain('invoice-payment-grid');
    expect(text).not.toContain('paymentSuccessfulNote');
    expect(text).not.toContain('transactionId:');
    expect(text).not.toContain('paymentDate:');
    expect(text).not.toContain('receivedBy:');
  });

  it('shows paid, unpaid, and partial status with the remaining due amount', async () => {
    const source = await import('./InvoiceTotalsPayment?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('labels.paidStatus');
    expect(text).toContain('labels.unpaidStatus');
    expect(text).toContain('labels.partialStatus');
    expect(text).toContain('money(outstanding)');
    expect(text).toContain('paymentMethodLabel');
  });

  it('marks subtotal row for bold emphasis', async () => {
    const source = await import('./InvoiceTotalsPayment?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('className="invoice-subtotal-row"');
  });
});

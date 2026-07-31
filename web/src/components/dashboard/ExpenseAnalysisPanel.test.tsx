import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExpenseAnalysisPanel from './ExpenseAnalysisPanel';
import type { ExpenseAnalysisResponse } from '../../types/executiveDashboard';

const data: ExpenseAnalysisResponse = {
  period: { startDate: '2026-07-01', endDate: '2026-07-12', label: '2026-07-01 → 2026-07-12' },
  totals: { transactions: 3, paidAmount: 14500 },
  rows: [
    {
      id: 'expense-1',
      occurredAt: '2026-07-12',
      category: 'Utilities',
      detail: 'Electricity bill',
      paidAmount: 3500,
      paymentMethod: 'cash',
      status: 'paid',
    },
    {
      id: 'expense-2',
      occurredAt: '2026-07-11',
      category: 'Utilities',
      detail: 'Generator fuel',
      paidAmount: 3000,
      paymentMethod: 'bank',
      status: 'paid',
    },
    {
      id: 'doctor-payout-1',
      occurredAt: '2026-07-10 10:30:00',
      category: 'Doctor payouts',
      detail: 'July doctor settlement',
      paidAmount: 8000,
      paymentMethod: 'cash',
      status: 'paid',
    },
  ],
  page: 1,
  pageSize: 10,
  totalRows: 3,
  hasNextPage: false,
};

describe('ExpenseAnalysisPanel', () => {
  it('renders every expense transaction as a separate table row', () => {
    render(<ExpenseAnalysisPanel data={data} loading={false} error={false} onRetry={vi.fn()} onPageChange={vi.fn()} />);

    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Paid Amount' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Payment Method' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();

    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByText('Electricity bill')).toBeInTheDocument();
    expect(screen.getByText('Generator fuel')).toBeInTheDocument();
    expect(screen.getByText('July doctor settlement')).toBeInTheDocument();
    expect(screen.getAllByText('Utilities')).toHaveLength(2);
    expect(screen.getByText('Doctor payouts')).toBeInTheDocument();
    expect(screen.getByText('bank')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more detail|fewer detail/i })).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 · 3 transactions')).toBeInTheDocument();
  });

  it('shows a fallback when a transaction has no returned description', () => {
    render(
      <ExpenseAnalysisPanel
        data={{
          ...data,
          rows: [{
            id: 'expense-3',
            occurredAt: '2026-07-12',
            category: 'Misc',
            detail: '',
            paidAmount: 100,
            paymentMethod: 'cash',
            status: 'paid',
          }],
          totals: { transactions: 1, paidAmount: 100 },
          totalRows: 1,
        }}
        loading={false}
        error={false}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByText('No description provided')).toBeInTheDocument();
  });

  it('supports scoped retry, loading, empty, and pagination states', () => {
    const onRetry = vi.fn();
    const onPageChange = vi.fn();
    const { rerender } = render(<ExpenseAnalysisPanel loading error={false} onRetry={onRetry} onPageChange={onPageChange} />);
    expect(screen.getByLabelText('Loading expense analysis')).toBeInTheDocument();

    rerender(<ExpenseAnalysisPanel loading={false} error onRetry={onRetry} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry expense analysis' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ExpenseAnalysisPanel data={{ ...data, hasNextPage: true }} loading={false} error={false} onRetry={onRetry} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next expense page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(<ExpenseAnalysisPanel data={{ ...data, rows: [], totalRows: 0 }} loading={false} error={false} onRetry={onRetry} onPageChange={onPageChange} />);
    expect(screen.getByText('No paid expenses were found for this period.')).toBeInTheDocument();
  });
});

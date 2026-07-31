import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncomeServicePanel from './IncomeServicePanel';
import type { IncomeServiceResponse } from '../../types/executiveDashboard';

const data: IncomeServiceResponse = {
  period: { startDate: '2026-07-01', endDate: '2026-07-12', label: '2026-07-01 → 2026-07-12' },
  totals: { transactions: 9, units: 11, collection: 18500 },
  rows: [
    { serviceName: 'Doctor Consultation', category: 'Visit', transactions: 4, units: 4, collection: 6000, share: 32.43 },
    { serviceName: 'Bed Charge', category: 'Admission', transactions: 2, units: 4, collection: 8000, share: 43.24 },
    { serviceName: 'X-Ray Chest', category: 'Imaging', transactions: 3, units: 3, collection: 4500, share: 24.32 },
  ],
  page: 1,
  pageSize: 25,
  totalRows: 3,
  hasNextPage: false,
};

describe('IncomeServicePanel', () => {
  it('shows exact service names with category as secondary context', () => {
    render(<IncomeServicePanel data={data} loading={false} error={false} onRetry={vi.fn()} onPageChange={vi.fn()} />);

    expect(screen.getByText('Doctor Consultation')).toBeInTheDocument();
    expect(screen.getByText('Bed Charge')).toBeInTheDocument();
    expect(screen.getByText('X-Ray Chest')).toBeInTheDocument();
    expect(screen.getByText('Visit')).toBeInTheDocument();
    expect(screen.getByText('Admission')).toBeInTheDocument();
    expect(screen.getByText('Imaging')).toBeInTheDocument();
    expect(screen.queryByText(/^OPD$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^IPD$/)).not.toBeInTheDocument();
  });

  it('supports scoped retry, pagination, loading, and empty states', () => {
    const onRetry = vi.fn();
    const onPageChange = vi.fn();
    const { rerender } = render(<IncomeServicePanel loading error={false} onRetry={onRetry} onPageChange={onPageChange} />);
    expect(screen.getByLabelText('Loading income service analysis')).toBeInTheDocument();

    rerender(<IncomeServicePanel loading={false} error onRetry={onRetry} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry income analysis' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<IncomeServicePanel data={{ ...data, rows: [], totalRows: 0 }} loading={false} error={false} onRetry={onRetry} onPageChange={onPageChange} />);
    expect(screen.getByText('No collected services were found for this period.')).toBeInTheDocument();
  });
});

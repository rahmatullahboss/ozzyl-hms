import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TestPerformancePanel from './TestPerformancePanel';
import type { TestPerformanceResponse } from '../../types/executiveDashboard';

const data: TestPerformanceResponse = {
  period: { startDate: '2026-07-01', endDate: '2026-07-12', label: '2026-07-01 → 2026-07-12' },
  totals: {
    quantity: 76,
    billed: 27584,
    collected: 26061,
    due: 1523,
    testCommission: 1200,
  },
  rows: [{
    testId: 396,
    testCode: 'CBC_PLT',
    testName: 'CBC & Platelet Count',
    quantity: 76,
    billed: 27584,
    collected: 26061,
    due: 1523,
    testCommission: 1200,
  }],
  page: 1,
  pageSize: 25,
  totalRows: 1,
  hasNextPage: false,
};

describe('TestPerformancePanel', () => {
  it('renders only the billing-backed test performance columns', () => {
    const onSearchChange = vi.fn();
    render(
      <TestPerformancePanel
        data={data}
        loading={false}
        error={false}
        search=""
        sortBy="quantity"
        onSearchChange={onSearchChange}
        onTestOpen={vi.fn()}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent?.trim());
    expect(headers).toEqual(['Test', 'Quantity', 'Billed', 'Collected', 'Due', 'Test Commission']);
    expect(screen.queryByRole('columnheader', { name: 'Completed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Ordered' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Pending' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Cancelled' })).not.toBeInTheDocument();
    expect(screen.getByText('76')).toBeInTheDocument();
    expect(screen.getByText('CBC_PLT')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search tests' });
    fireEvent.change(search, { target: { value: 'CBC' } });
    expect(onSearchChange).toHaveBeenCalledWith('CBC');
  });

  it('describes the report as selected-period billing data and opens details', () => {
    const onTestOpen = vi.fn();
    render(
      <TestPerformancePanel
        data={data}
        loading={false}
        error={false}
        search="CBC"
        sortBy="quantity"
        onSearchChange={vi.fn()}
        onTestOpen={onTestOpen}
        onPageChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/billed test lines in the selected period/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open CBC & Platelet Count details' }));
    expect(onTestOpen).toHaveBeenCalledWith(data.rows[0]);
  });

  it('renders scoped loading, error, and empty states', () => {
    const baseProps = {
      search: '',
      sortBy: 'quantity' as const,
      onSearchChange: vi.fn(),
      onTestOpen: vi.fn(),
      onPageChange: vi.fn(),
      onSortChange: vi.fn(),
    };
    const { rerender } = render(<TestPerformancePanel {...baseProps} loading error={false} />);
    expect(screen.getByLabelText('Loading test performance')).toBeInTheDocument();

    rerender(<TestPerformancePanel {...baseProps} loading={false} error />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load test performance');

    rerender(<TestPerformancePanel {...baseProps} data={{ ...data, rows: [], totalRows: 0 }} loading={false} error={false} />);
    expect(screen.getByText('No tests matched this period and search.')).toBeInTheDocument();
  });
});

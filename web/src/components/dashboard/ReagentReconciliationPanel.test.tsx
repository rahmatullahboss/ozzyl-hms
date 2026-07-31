import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReagentReconciliationPanel from './ReagentReconciliationPanel';
import type { ReagentReconciliationResponse } from '../../types/executiveDashboard';

const data: ReagentReconciliationResponse = {
  period: { startDate: '2026-07-01', endDate: '2026-07-12', label: '2026-07-01 → 2026-07-12' },
  rows: [
    { consumableId: 1, reagentCode: 'CBC-R', reagentName: 'CBC Reagent', unit: 'ml', completedTests: 20, expectedUsage: 100, actualUsage: 110, returnedQuantity: 5, variance: 5, currentStock: 80, reorderLevel: 50, status: 'over_consumption' },
    { consumableId: 2, reagentCode: 'RBS-S', reagentName: 'RBS Strip', unit: 'test', completedTests: 12, expectedUsage: 12, actualUsage: 10, returnedQuantity: 0, variance: -2, currentStock: 4, reorderLevel: 10, status: 'low_stock' },
  ],
  quantityTotals: [
    { unit: 'ml', quantity: 110 },
    { unit: 'test', quantity: 10 },
  ],
  exceptions: {
    unmappedCompletedTests: 3,
    consumptionExceptions: 2,
    unmappedTests: [{ testId: 99, testName: 'HbA1c', completedTests: 3 }],
  },
  availability: { mapping: true, movements: true, stock: true },
  page: 1,
  pageSize: 25,
  totalRows: 2,
  hasNextPage: false,
};

describe('ReagentReconciliationPanel', () => {
  it('keeps expected, actual, returned, variance, stock, unit, and status visible', () => {
    render(<ReagentReconciliationPanel data={data} loading={false} error={false} onRetry={vi.fn()} onPageChange={vi.fn()} />);

    for (const header of ['Expected', 'Actual', 'Returned', 'Variance', 'Current Stock', 'Unit', 'Status']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(screen.getByText('CBC Reagent')).toBeInTheDocument();
    expect(screen.getByText('RBS Strip')).toBeInTheDocument();
    expect(screen.getByText('over consumption')).toBeInTheDocument();
    expect(screen.getByText('low stock')).toBeInTheDocument();
  });

  it('renders mixed units separately and shows unmapped tests as action-required', () => {
    render(<ReagentReconciliationPanel data={data} loading={false} error={false} onRetry={vi.fn()} onPageChange={vi.fn()} />);

    expect(screen.getByText('110 ml')).toBeInTheDocument();
    expect(screen.getByText('10 test')).toBeInTheDocument();
    expect(screen.queryByText('120')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('3 completed tests are not mapped to any reagent');
    expect(screen.getByText(/HbA1c/)).toBeInTheDocument();
  });

  it('supports scoped retry, loading, and empty states', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ReagentReconciliationPanel loading error={false} onRetry={onRetry} onPageChange={vi.fn()} />);
    expect(screen.getByLabelText('Loading reagent reconciliation')).toBeInTheDocument();

    rerender(<ReagentReconciliationPanel loading={false} error onRetry={onRetry} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry reagent reconciliation' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ReagentReconciliationPanel data={{ ...data, rows: [], exceptions: { ...data.exceptions, unmappedCompletedTests: 0, unmappedTests: [] } }} loading={false} error={false} onRetry={onRetry} onPageChange={vi.fn()} />);
    expect(screen.getByText('No reagent usage was found for this period.')).toBeInTheDocument();
  });
});

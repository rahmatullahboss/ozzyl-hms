import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReconciliationStrip from './ReconciliationStrip';

const base = {
  summaryTotal: 100,
  detailTotal: 100,
  unexplainedDifference: 0,
  tolerance: 0.01,
  isBalanced: true,
  detailRowCount: 2,
  providerMode: 'legacy' as const,
  checkedAt: '2026-07-27T12:00:00.000Z',
  detailGrain: 'one row per payment',
  warnings: [],
};

describe('ReconciliationStrip', () => {
  it('shows a reconciled state only for a balanced envelope', () => {
    render(<ReconciliationStrip reconciliation={{ ...base, status: 'reconciled' }} />);
    expect(screen.getByText('Reconciled')).toBeInTheDocument();
    expect(screen.getByText('2 detail rows · one row per payment')).toBeInTheDocument();
  });

  it('shows the exact unexplained difference for warnings', () => {
    render(<ReconciliationStrip reconciliation={{
      ...base,
      status: 'warning',
      detailTotal: 90,
      unexplainedDifference: 10,
      isBalanced: false,
      warnings: ['Summary and detail totals differ by BDT 10.00.'],
    }} />);
    expect(screen.getByText('Reconciliation warning')).toBeInTheDocument();
    expect(screen.getByText('Difference: ৳10.00')).toBeInTheDocument();
  });

  it('does not display success when reconciliation is unavailable', () => {
    render(<ReconciliationStrip reconciliation={{
      ...base,
      status: 'unavailable',
      detailTotal: null,
      unexplainedDifference: null,
      isBalanced: null,
      detailRowCount: 0,
      warnings: ['Full-detail source unavailable.'],
    }} />);
    expect(screen.getByText('Reconciliation unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Reconciled')).not.toBeInTheDocument();
    expect(screen.getByText('Full-detail source unavailable.')).toBeInTheDocument();
  });
});

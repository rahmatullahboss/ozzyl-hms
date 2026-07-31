import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReagentControlIssues from './ReagentControlIssues';

const exceptions = [
  { id: 1, reason: 'missing_test_mapping', message: 'CBC has no reagent recipe', severity: 'warning', status: 'open', source_event: 'billing', lab_order_id: 10 },
  { id: 2, reason: 'missing_stock', message: 'No usable glucose reagent stock', severity: 'error', status: 'open', source_event: 'billing', lab_order_id: 11 },
  { id: 3, reason: 'qc_failed_usable_lot', message: 'Selected lot failed QC', severity: 'error', status: 'open', source_event: 'result', lab_order_id: 12 },
];

const reconciliation = [
  { lab_order_item_id: 20, test_name: 'LFT', status: 'missing', status_meaning: 'Expected deduction is missing', expected_quantity: 1, consumed_quantity: 0, consumed_cost: 0, exception_count: 1 },
];

describe('ReagentControlIssues', () => {
  it('summarizes issues by actionable hospital-language category', () => {
    render(
      <ReagentControlIssues
        exceptions={exceptions}
        reconciliationRows={reconciliation}
        onOpenRecipes={() => undefined}
        onOpenStock={() => undefined}
        onRetry={() => undefined}
        onReview={() => undefined}
      />,
    );

    expect(screen.getByText('Missing recipe')).toBeInTheDocument();
    expect(screen.getByText('Stock shortage')).toBeInTheDocument();
    expect(screen.getByText('QC or blocked lot')).toBeInTheDocument();
    expect(screen.getByText('Reconciliation mismatch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up recipe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add stock' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review lot' })).toBeInTheDocument();
  });

  it('keeps technical source information collapsed by default', () => {
    render(
      <ReagentControlIssues
        exceptions={exceptions}
        reconciliationRows={reconciliation}
        onOpenRecipes={() => undefined}
        onOpenStock={() => undefined}
        onRetry={() => undefined}
        onReview={() => undefined}
      />,
    );

    expect(screen.getAllByText('Technical details')[0].closest('details')).not.toHaveAttribute('open');
    expect(screen.getAllByText('Source event: billing').every(element => !element.closest('details')?.hasAttribute('open'))).toBe(true);
  });

  it('routes direct fix and retry actions', () => {
    const onOpenRecipes = vi.fn();
    const onOpenStock = vi.fn();
    const onRetry = vi.fn();
    const onReview = vi.fn();
    render(
      <ReagentControlIssues
        exceptions={exceptions}
        reconciliationRows={reconciliation}
        onOpenRecipes={onOpenRecipes}
        onOpenStock={onOpenStock}
        onRetry={onRetry}
        onReview={onReview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set up recipe' }));
    expect(onOpenRecipes).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Add stock' }));
    expect(onOpenStock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry deduction for issue 1' }));
    expect(onRetry).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mark issue 1 resolved' }));
    expect(onReview).toHaveBeenCalledWith(1, 'resolved');
  });

  it('shows a calm empty state when there are no open issues', () => {
    render(
      <ReagentControlIssues
        exceptions={[]}
        reconciliationRows={[]}
        onOpenRecipes={() => undefined}
        onOpenStock={() => undefined}
        onRetry={() => undefined}
        onReview={() => undefined}
      />,
    );

    expect(screen.getByText('No reagent issues need action')).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExecutiveDashboardRangeFilter, {
  resolveExecutiveDashboardFilters,
} from './ExecutiveDashboardRangeFilter';

describe('ExecutiveDashboardRangeFilter', () => {
  it('renders every supported preset and resolves dates with backend-compatible semantics', () => {
    const onChange = vi.fn();
    render(
      <ExecutiveDashboardRangeFilter
        filters={resolveExecutiveDashboardFilters('today', '2026-07-12')}
        onChange={onChange}
        onRefresh={vi.fn()}
        lastRefreshedAt={new Date('2026-07-12T12:00:00Z')}
        today="2026-07-12"
      />,
    );

    for (const label of [
      'Today',
      'Yesterday',
      'This Week',
      'This Month',
      'Last Month',
      'Last 7 Days',
      'Last 30 Days',
      'Custom',
    ]) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Yesterday' }));
    expect(onChange).toHaveBeenCalledWith({
      preset: 'yesterday',
      startDate: '2026-07-11',
      endDate: '2026-07-11',
    });

    fireEvent.click(screen.getByRole('tab', { name: 'This Week' }));
    expect(onChange).toHaveBeenLastCalledWith({
      preset: 'this_week',
      startDate: '2026-07-06',
      endDate: '2026-07-12',
    });
    expect(screen.getByText(/Last refreshed/)).toBeInTheDocument();
  });

  it('keeps custom Apply disabled until both ISO dates are valid and ordered', () => {
    const onChange = vi.fn();
    render(
      <ExecutiveDashboardRangeFilter
        filters={resolveExecutiveDashboardFilters('today', '2026-07-12')}
        onChange={onChange}
        onRefresh={vi.fn()}
        today="2026-07-12"
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    const start = screen.getByLabelText('Custom start date');
    const end = screen.getByLabelText('Custom end date');
    const apply = screen.getByRole('button', { name: 'Apply custom range' });

    fireEvent.change(start, { target: { value: '2026-07-10' } });
    fireEvent.change(end, { target: { value: '' } });
    expect(apply).toBeDisabled();

    fireEvent.change(end, { target: { value: '2026-07-09' } });
    expect(apply).toBeDisabled();

    fireEvent.change(end, { target: { value: '2026-07-12' } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    expect(onChange).toHaveBeenCalledWith({
      preset: 'custom',
      startDate: '2026-07-10',
      endDate: '2026-07-12',
    });
  });

  it('invokes manual refresh without mutating the active range', () => {
    const onChange = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ExecutiveDashboardRangeFilter
        filters={resolveExecutiveDashboardFilters('30d', '2026-07-12')}
        onChange={onChange}
        onRefresh={onRefresh}
        refreshing
        today="2026-07-12"
      />,
    );

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh).toHaveTextContent('Refreshing…');
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

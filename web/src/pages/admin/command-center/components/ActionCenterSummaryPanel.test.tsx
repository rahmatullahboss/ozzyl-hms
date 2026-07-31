import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiQuery } from '../../../../hooks/useApiQuery';
import ActionCenterSummaryPanel from './ActionCenterSummaryPanel';

vi.mock('../../../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../../../lib/queryKeys', () => ({
  queryKeys: { actionCenter: { summary: () => ['action-center', 'summary'] } },
}));

const response = {
  data: {
    approvals: { totalPending: 7 },
    exceptions: { open: 5, critical: 2, slaBreached: 1 },
    collections: { open: 4, exposureMinor: 125_000, currencyCode: 'BDT' },
    tasks: { open: 6, overdue: 3, assignedToMe: 2 },
    nextBestAction: {
      workstream: 'exceptions',
      href: '/action/exceptions?priority=critical',
      label: 'Review critical exceptions',
      priority: 'critical',
    },
  },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
      <Routes>
        <Route path="/h/:slug/*" element={<><ActionCenterSummaryPanel /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ActionCenterSummaryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({ data: response, isLoading: false, isError: false, refetch: vi.fn() } as ReturnType<typeof useApiQuery>);
  });

  it('uses the authoritative Action Center summary only', () => {
    renderPanel();
    expect(useApiQuery).toHaveBeenCalledTimes(1);
    expect(useApiQuery).toHaveBeenCalledWith(
      ['action-center', 'summary'],
      '/api/action-center/summary',
      { staleTime: 30_000 },
    );
  });

  it('shows approvals, critical exceptions, receivables, overdue tasks, and next-best action', () => {
    renderPanel();
    expect(screen.getByText('Pending approvals')).toBeInTheDocument();
    expect(screen.getByTestId('action-summary-approvals')).toHaveTextContent('7');
    expect(screen.getByTestId('action-summary-critical')).toHaveTextContent('2');
    expect(screen.getByTestId('action-summary-receivables')).toHaveTextContent('4');
    expect(screen.getByTestId('action-summary-overdue')).toHaveTextContent('3');
    expect(screen.getByText(/BDT.*1,250\.00/)).toBeInTheDocument();
    expect(screen.getByText('Review critical exceptions')).toBeInTheDocument();
  });

  it('preserves the tenant slug for workstream and next-action links', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Open pending approvals' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/h/city-hospital/action/approvals?status=pending');

    fireEvent.click(screen.getByRole('button', { name: 'Review critical exceptions' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/h/city-hospital/action/exceptions?priority=critical');
  });

  it('renders a compact healthy state when no action is pending', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { data: { approvals: {}, exceptions: {}, collections: {}, tasks: {}, nextBestAction: null } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useApiQuery>);
    renderPanel();
    expect(screen.getByText('No management action is currently pending.')).toBeInTheDocument();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LiveCashDrawerWidget from './LiveCashDrawerWidget';
import { useApiQuery } from '../../../hooks/useApiQuery';

const navigateMock = vi.fn();

vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
  useNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string, opts?: { count?: number }) => {
    if (opts && typeof opts.count === 'number') {
      if (k.endsWith('moreCount')) return `+${opts.count} more`;
    }
    return k;
  } }),
  initReactI18next: { type: '3rdParty' },
}));

vi.mock('../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('../../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { activeCounters: () => ['admin', 'active-counters'] },
  },
}));

describe('LiveCashDrawerWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<LiveCashDrawerWidget />);
    expect(screen.getByText('adminDashboard.liveCashDrawers.title')).toBeInTheDocument();
    expect(document.querySelectorAll('.skeleton')).toHaveLength(3);
  });

  it('shows "No active drawers" when empty', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { activeCounters: [], totalActive: 0 },
      isLoading: false,
    } as never);
    render(<LiveCashDrawerWidget />);
    expect(screen.getByText('adminDashboard.liveCashDrawers.noActiveDrawers')).toBeInTheDocument();
  });

  it('renders drawer list when data exists', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        activeCounters: [
          { sessionId: 1, counterName: 'Reception-01', operatorName: 'Karim', expectedCash: 45000, openedAt: '2026-06-11T08:00:00Z' },
          { sessionId: 2, counterName: 'Reception-02', operatorName: 'Rina', expectedCash: 20500, openedAt: '2026-06-11T08:00:00Z' },
        ],
        totalActive: 2,
      },
      isLoading: false,
    } as never);
    render(<LiveCashDrawerWidget />);
    expect(screen.getByText('Reception-01')).toBeInTheDocument();
    expect(screen.getByText(/Karim/)).toBeInTheDocument();
    expect(screen.getByText('৳45,000')).toBeInTheDocument();
    expect(screen.getByText('Reception-02')).toBeInTheDocument();
    expect(screen.getByText(/Rina/)).toBeInTheDocument();
    expect(screen.getByText('৳20,500')).toBeInTheDocument();
  });

  it('shows Active badge for each drawer', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        activeCounters: [
          { sessionId: 1, counterName: 'Counter-01', operatorName: 'User1', expectedCash: 10000, openedAt: '2026-06-11T08:00:00Z' },
        ],
        totalActive: 1,
      },
      isLoading: false,
    } as never);
    render(<LiveCashDrawerWidget />);
    expect(screen.getByText('adminDashboard.liveCashDrawers.active')).toBeInTheDocument();
  });

  it('shows "+N more" when more than 5 drawers', () => {
    const counters = Array.from({ length: 7 }, (_, i) => ({
      sessionId: i + 1,
      counterName: `Counter-${i + 1}`,
      operatorName: `User${i + 1}`,
      expectedCash: 10000 * (i + 1),
      openedAt: '2026-06-11T08:00:00Z',
    }));
    vi.mocked(useApiQuery).mockReturnValue({
      data: { activeCounters: counters, totalActive: 7 },
      isLoading: false,
    } as never);
    render(<LiveCashDrawerWidget />);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('has a "View All" link', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { activeCounters: [], totalActive: 0 },
      isLoading: false,
    } as never);
    render(<LiveCashDrawerWidget />);
    expect(screen.getByText('adminDashboard.liveCashDrawers.viewAll')).toBeInTheDocument();
  });

  describe('error handling', () => {
    it('renders accessible error state when the active-counters query fails', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() } as never);
      render(<LiveCashDrawerWidget />);
      const alert = screen.getByRole('alert');
      expect(alert).toBeTruthy();
      expect(alert).toHaveTextContent('adminDashboard.errors.loadFailed');
    });

    it('renders a retry button on error and invokes refetch on click', () => {
      const refetch = vi.fn();
      vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch } as never);
      render(<LiveCashDrawerWidget />);
      fireEvent.click(screen.getByText('adminDashboard.errors.retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });
});

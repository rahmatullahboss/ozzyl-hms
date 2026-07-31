import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperationsSnapshot from './OperationsSnapshot';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));

vi.mock('../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('../../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { dashboard: () => ['admin', 'dashboard'] },
  },
}));

describe('OperationsSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeletons when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<OperationsSnapshot />);
    expect(screen.getByText('adminDashboard.operationsSnapshot.title')).toBeInTheDocument();
    expect(document.querySelectorAll('.skeleton')).toHaveLength(4);
  });

  it('renders 4 operation widgets', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        todaySummary: { totalAppointments: 30, completedConsultations: 20, pendingTests: 5, completedTests: 15, pharmacySales: 25000 },
        bedSummary: { total: 50, available: 20, occupied: 30, occupancyPercentage: 60 },
        pharmacySummary: { todaySales: 25000, todaySalesCount: 10, lowStockItems: 3 },
      },
      isLoading: false,
    } as never);
    render(<OperationsSnapshot />);
    expect(screen.getByText('adminDashboard.operationsSnapshot.opdQueue')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.operationsSnapshot.diagnostic')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.operationsSnapshot.ipd')).toBeInTheDocument();
    expect(screen.getByText('adminDashboard.operationsSnapshot.pharmacy')).toBeInTheDocument();
  });

  it('displays correct stats for each widget', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        todaySummary: { totalAppointments: 30, completedConsultations: 20, pendingTests: 5, completedTests: 15, pharmacySales: 25000 },
        bedSummary: { total: 50, available: 12, occupied: 38, occupancyPercentage: 76 },
        pharmacySummary: { todaySales: 25000, todaySalesCount: 10, lowStockItems: 3 },
      },
      isLoading: false,
    } as never);
    render(<OperationsSnapshot />);
    expect(screen.getByText('30')).toBeInTheDocument(); // Appointments
    expect(screen.getByText('20')).toBeInTheDocument(); // Completed consultations
    expect(screen.getByText('5')).toBeInTheDocument(); // Pending tests
    expect(screen.getByText('15')).toBeInTheDocument(); // Completed tests
    expect(screen.getByText('38')).toBeInTheDocument(); // Occupied beds
    expect(screen.getByText('12')).toBeInTheDocument(); // Available beds
    expect(screen.getByText('76%')).toBeInTheDocument(); // Occupancy
    expect(screen.getByText('৳25,000')).toBeInTheDocument(); // Pharmacy sales
  });

  it('shows zero values when data is undefined', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { todaySummary: undefined, bedSummary: undefined, pharmacySummary: undefined },
      isLoading: false,
    } as never);
    render(<OperationsSnapshot />);
    expect(screen.getByText('adminDashboard.operationsSnapshot.opdQueue')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toBeTruthy();
  });

  describe('error handling', () => {
    it('renders accessible error state when the dashboard query fails', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() } as never);
      render(<OperationsSnapshot />);
      const alert = screen.getByRole('alert');
      expect(alert).toBeTruthy();
      expect(alert).toHaveTextContent('adminDashboard.errors.loadFailed');
    });

    it('renders a retry button on error and invokes refetch on click', () => {
      const refetch = vi.fn();
      vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch } as never);
      render(<OperationsSnapshot />);
      fireEvent.click(screen.getByText('adminDashboard.errors.retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });
});

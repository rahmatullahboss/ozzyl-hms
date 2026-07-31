import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import LabQcDashboard from './LabQcDashboard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../hooks/useApiQuery', () => ({ useApiQuery: vi.fn(), useApiMutation: vi.fn(), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children, role }: any) => <div data-testid="layout">{children}</div> }));

import { useApiQuery, useApiMutation } from '../hooks/useApiQuery';

const mockUseApiQuery = useApiQuery as ReturnType<typeof vi.fn>;

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('LabQcDashboard', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders title and all tab buttons', () => {
    mockUseApiQuery.mockReturnValue({ data: null, isLoading: false });
    useApiMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<LabQcDashboard />, { wrapper: Wrapper });
    expect(screen.getByText('qc.title')).toBeInTheDocument();
    expect(screen.getAllByText('qc.controls').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('qc.ranges')).toBeInTheDocument();
    expect(screen.getByText('qc.results')).toBeInTheDocument();
    expect(screen.getByText('qc.calibrations')).toBeInTheDocument();
  });

  it('shows empty state when no controls', () => {
    mockUseApiQuery.mockReturnValue({ data: { data: [] }, isLoading: false });
    useApiMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<LabQcDashboard />, { wrapper: Wrapper });
    expect(screen.getByText('qc.noControls')).toBeInTheDocument();
  });

  it('switches to ranges tab and shows empty state', () => {
    mockUseApiQuery.mockReturnValue({ data: { data: [] }, isLoading: false });
    useApiMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<LabQcDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('qc.ranges'));
    expect(screen.getByText('qc.noRanges')).toBeInTheDocument();
  });

  it('shows calibration stats when data loaded', () => {
    mockUseApiQuery.mockImplementation((queryKey: any) => {
      const key = Array.isArray(queryKey) ? queryKey.join(',') : '';
      if (key.includes('calibrations')) return { data: { data: [{ id: 1, machine_name: 'Analyzer', calibration_type: 'full', scheduled_date: '2025-01-01', result_status: 'pass' }] }, isLoading: false };
      return { data: { data: [] }, isLoading: false };
    });
    useApiMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<LabQcDashboard />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('qc.calibrations'));
    expect(screen.getByText('Analyzer')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DeptAnalytics from './DeptAnalytics';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({ queryKeys: { admin: { deptAnalytics: () => ['admin', 'dept-analytics'] } } }));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('DeptAnalytics', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<DeptAnalytics />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<DeptAnalytics />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<DeptAnalytics />);
    expect(screen.getByText('Department Performance')).toBeTruthy();
  });

  it('shows summary cards', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { departments: [], summary: { totalRevenue: 500000, totalPatients: 200, topDepartment: 'Cardiology', avgBillValue: 2500 } },
      isLoading: false,
    });
    render(<DeptAnalytics />);
    expect(screen.getByText('Total Revenue')).toBeTruthy();
    expect(screen.getByText('Total Patients')).toBeTruthy();
    expect(screen.getByText('Cardiology')).toBeTruthy();
  });

  it('shows empty state when no departments', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { departments: [] }, isLoading: false });
    render(<DeptAnalytics />);
    expect(screen.getByText('No department data found')).toBeTruthy();
  });

  it('shows departments table', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { departments: [
        { id: '1', name: 'Cardiology', revenue: 200000, patientCount: 80, avgBillValue: 2500, discount: 10000, refund: 5000, netRevenue: 185000 },
        { id: '2', name: 'Orthopedics', revenue: 150000, patientCount: 60, avgBillValue: 2500, discount: 8000, refund: 3000, netRevenue: 139000 },
      ] },
      isLoading: false,
    });
    render(<DeptAnalytics />);
    expect(screen.getByText('Cardiology')).toBeTruthy();
    expect(screen.getByText('Orthopedics')).toBeTruthy();
  });
});

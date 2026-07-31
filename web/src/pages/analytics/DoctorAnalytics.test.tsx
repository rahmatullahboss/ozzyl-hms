import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorAnalytics from './DoctorAnalytics';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({ queryKeys: { admin: { doctorAnalytics: () => ['admin', 'doctor-analytics'] } } }));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('DoctorAnalytics', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<DoctorAnalytics />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<DoctorAnalytics />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<DoctorAnalytics />);
    expect(screen.getByText('Doctor Performance')).toBeTruthy();
  });

  it('shows summary cards', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { doctors: [], summary: { totalDoctors: 15, totalRevenue: 800000, topDoctor: 'Dr. Rahman', avgVisitsPerDoctor: 20 } },
      isLoading: false,
    });
    render(<DoctorAnalytics />);
    expect(screen.getByText('Total Doctors')).toBeTruthy();
    expect(screen.getByText('Dr. Rahman')).toBeTruthy();
  });

  it('shows empty state when no doctors', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { doctors: [] }, isLoading: false });
    render(<DoctorAnalytics />);
    expect(screen.getByText('No doctor data found')).toBeTruthy();
  });

  it('shows doctors table', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { doctors: [
        { id: '1', name: 'Dr. Rahman', department: 'Cardiology', opdVisits: 25, procedures: 10, revenue: 200000, avgBillValue: 5714, patientSatisfaction: 4.5 },
        { id: '2', name: 'Dr. Begum', department: 'Orthopedics', opdVisits: 18, procedures: 8, revenue: 150000, avgBillValue: 5769, patientSatisfaction: 4.2 },
      ] },
      isLoading: false,
    });
    render(<DoctorAnalytics />);
    expect(screen.getByText('Dr. Rahman')).toBeTruthy();
    expect(screen.getByText('Dr. Begum')).toBeTruthy();
  });
});

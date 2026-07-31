import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExecutiveOverview from './ExecutiveOverview';
import { useApiQuery } from '../../hooks/useApiQuery';

const eoTMap: Record<string, string> = {
  'executiveOverview.title': 'Executive Overview',
  'executiveOverview.revenue': 'Revenue',
  'executiveOverview.expense': 'Expense',
  'executiveOverview.netCollection': 'Net Collection',
  'executiveOverview.discount': 'Discount',
  'executiveOverview.refund': 'Refund',
  'executiveOverview.totalPatients': 'Total Patients',
  'executiveOverview.growthPercent': '+{{percent}}% growth',
  'executiveOverview.newThisMonth': 'New This Month',
  'executiveOverview.bedOccupancy': 'Bed Occupancy',
  'executiveOverview.bedsCount': '{{occupied}}/{{total}} beds',
  'executiveOverview.pharmacyMonthly': 'Pharmacy (Monthly)',
  'executiveOverview.departmentRevenue': 'Department Revenue',
  'executiveOverview.noDepartmentData': 'No department data',
  'executiveOverview.topDoctors': 'Top Doctors',
  'executiveOverview.noDoctorData': 'No doctor data',
  'executiveOverview.patientsCount_one': '{{count}} patient',
  'executiveOverview.patientsCount_other': '{{count}} patients',
  'executiveOverview.dueAging': 'Due Aging',
  'executiveOverview.dueCurrent': 'Current',
  'executiveOverview.due30': '30 Days',
  'executiveOverview.due60': '60 Days',
  'executiveOverview.due90': '90+ Days',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.loading': 'Loading…',
  'common.back': 'Back',
  'common.next': 'Next',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => {
      if (eoTMap[k]) {
        let str = eoTMap[k];
        if (opts?.count !== undefined) str = str.replace('{{count}}', String(opts.count));
        if (opts?.percent !== undefined) str = str.replace('{{percent}}', String(opts.percent));
        if (opts?.occupied !== undefined) str = str.replace('{{occupied}}', String(opts.occupied));
        if (opts?.total !== undefined) str = str.replace('{{total}}', String(opts.total));
        return str;
      }
      return opts?.defaultValue ?? k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { executiveOverview: () => ['admin', 'executive-overview'] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('ExecutiveOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<ExecutiveOverview />);
    expect(screen.getByText('Executive Overview')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<ExecutiveOverview />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders financial summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        financial: { revenue: 5000000, expense: 3200000, netCollection: 1800000, discount: 150000, refund: 45000 },
        patients: { total: 1250, newThisMonth: 180, growthPercent: 12 },
        departments: [
          { name: 'Medicine', revenue: 1500000 },
          { name: 'Surgery', revenue: 1200000 },
          { name: 'Orthopedics', revenue: 800000 },
        ],
        doctors: [
          { name: 'Dr. Karim', revenue: 900000, patients: 120 },
          { name: 'Dr. Rahim', revenue: 750000, patients: 95 },
        ],
        bedOccupancy: { total: 100, occupied: 72, percentage: 72 },
        pharmacy: { todaySales: 85000, monthlySales: 2100000 },
        dueAging: { current: 200000, thirtyDays: 150000, sixtyDays: 80000, ninetyPlus: 40000 },
      },
      isLoading: false,
    } as never);
    render(<ExecutiveOverview />);
    expect(screen.getByText('50,00,000')).toBeInTheDocument();
    expect(screen.getByText('32,00,000')).toBeInTheDocument();
    expect(screen.getByText('18,00,000')).toBeInTheDocument();
    expect(screen.getByText('1,250')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('renders department income breakdown', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        financial: { revenue: 0, expense: 0, netCollection: 0, discount: 0, refund: 0 },
        patients: { total: 0, newThisMonth: 0, growthPercent: 0 },
        departments: [
          { name: 'Medicine', revenue: 1500000 },
          { name: 'Surgery', revenue: 1200000 },
        ],
        doctors: [],
        bedOccupancy: { total: 0, occupied: 0, percentage: 0 },
        pharmacy: { todaySales: 0, monthlySales: 0 },
        dueAging: { current: 0, thirtyDays: 0, sixtyDays: 0, ninetyPlus: 0 },
      },
      isLoading: false,
    } as never);
    render(<ExecutiveOverview />);
    expect(screen.getByText('Department Revenue')).toBeInTheDocument();
    expect(screen.getByText('Medicine')).toBeInTheDocument();
    expect(screen.getByText('Surgery')).toBeInTheDocument();
  });

  it('renders doctor contribution ranking', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        financial: { revenue: 0, expense: 0, netCollection: 0, discount: 0, refund: 0 },
        patients: { total: 0, newThisMonth: 0, growthPercent: 0 },
        departments: [],
        doctors: [
          { name: 'Dr. Karim', revenue: 900000, patients: 120 },
          { name: 'Dr. Rahim', revenue: 750000, patients: 95 },
        ],
        bedOccupancy: { total: 0, occupied: 0, percentage: 0 },
        pharmacy: { todaySales: 0, monthlySales: 0 },
        dueAging: { current: 0, thirtyDays: 0, sixtyDays: 0, ninetyPlus: 0 },
      },
      isLoading: false,
    } as never);
    render(<ExecutiveOverview />);
    expect(screen.getByText('Top Doctors')).toBeInTheDocument();
    expect(screen.getByText('Dr. Karim')).toBeInTheDocument();
    expect(screen.getByText('Dr. Rahim')).toBeInTheDocument();
  });

  it('renders due aging section', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        financial: { revenue: 0, expense: 0, netCollection: 0, discount: 0, refund: 0 },
        patients: { total: 0, newThisMonth: 0, growthPercent: 0 },
        departments: [],
        doctors: [],
        bedOccupancy: { total: 0, occupied: 0, percentage: 0 },
        pharmacy: { todaySales: 0, monthlySales: 0 },
        dueAging: { current: 200000, thirtyDays: 150000, sixtyDays: 80000, ninetyPlus: 40000 },
      },
      isLoading: false,
    } as never);
    render(<ExecutiveOverview />);
    expect(screen.getByText('Due Aging')).toBeInTheDocument();
    expect(screen.getByText('2,00,000')).toBeInTheDocument();
  });

  it('shows empty state when no data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        financial: { revenue: 0, expense: 0, netCollection: 0, discount: 0, refund: 0 },
        patients: { total: 0, newThisMonth: 0, growthPercent: 0 },
        departments: [],
        doctors: [],
        bedOccupancy: { total: 0, occupied: 0, percentage: 0 },
        pharmacy: { todaySales: 0, monthlySales: 0 },
        dueAging: { current: 0, thirtyDays: 0, sixtyDays: 0, ninetyPlus: 0 },
      },
      isLoading: false,
    } as never);
    render(<ExecutiveOverview />);
    expect(screen.getByText('No department data')).toBeInTheDocument();
    expect(screen.getByText('No doctor data')).toBeInTheDocument();
  });
});

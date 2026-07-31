import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IPDMonitor from './IPDMonitor';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string, opts?: { count?: number; percent?: number; days?: number }) => {
    if (opts && typeof opts.count === 'number') {
      if (k === 'adminMonitor.ipd.overview.dischargesCount') return `${opts.count} discharges`;
    }
    if (opts && typeof opts.percent === 'number') {
      if (k === 'adminMonitor.ipd.overview.occupied') return `${opts.percent}% occupied`;
    }
    if (opts && typeof opts.days === 'number') {
      if (k === 'adminMonitor.ipd.overview.avgStayValue') return `Avg stay: ${opts.days} days`;
    }
    return k;
  } }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
}));
vi.mock('../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { ipdMonitor: () => ['admin', 'ipd-monitor'] },
    admissions: { stats: () => ['admissions', 'stats'], occupancy: () => ['admissions', 'occupancy'] },
  },
}));
vi.mock('../../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('IPDMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<IPDMonitor />);
    expect(screen.getByText('adminMonitor.ipd.title')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<IPDMonitor />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders summary cards with stats', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: {
          totalBeds: 100,
          occupied: 65,
          available: 25,
          cleaning: 5,
          maintenance: 3,
          reserved: 2,
          occupancyPercentage: 65,
          dischargesToday: 8,
          avgStayDays: 4.5,
        },
        wards: [],
        admissions: [],
      },
      isLoading: false,
    } as never);
    render(<IPDMonitor />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('65')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders bed map with color-coded beds', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { totalBeds: 4, occupied: 2, available: 1, cleaning: 1, maintenance: 0, reserved: 0, occupancyPercentage: 50, dischargesToday: 0, avgStayDays: 3 },
        wards: [
          {
            name: 'General Ward',
            beds: [
              { id: 'B1', number: 'G-01', status: 'available', patientName: null },
              { id: 'B2', number: 'G-02', status: 'occupied', patientName: 'Rahim Uddin' },
              { id: 'B3', number: 'G-03', status: 'occupied', patientName: 'Fatima Begum' },
              { id: 'B4', number: 'G-04', status: 'cleaning', patientName: null },
            ],
          },
        ],
        admissions: [],
      },
      isLoading: false,
    } as never);
    render(<IPDMonitor />);
    // Switch to Bed Map tab
    const bedMapTab = screen.getByText('adminMonitor.ipd.viewTabs.bedMap');
    fireEvent.click(bedMapTab);
    expect(screen.getByText('G-01')).toBeInTheDocument();
    expect(screen.getByText('G-02')).toBeInTheDocument();
    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('General Ward')).toBeInTheDocument();
  });

  it('renders patient list view', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { totalBeds: 2, occupied: 2, available: 0, cleaning: 0, maintenance: 0, reserved: 0, occupancyPercentage: 100, dischargesToday: 0, avgStayDays: 5 },
        wards: [],
        admissions: [
          { id: 'A1', patientName: 'Rahim Uddin', bedNumber: 'G-01', wardName: 'General Ward', doctorName: 'Dr. Karim', admissionDate: '2026-06-08T10:00:00Z', diagnosis: 'Pneumonia', daysAdmitted: 3 },
          { id: 'A2', patientName: 'Fatima Begum', bedNumber: 'G-02', wardName: 'General Ward', doctorName: 'Dr. Rahim', admissionDate: '2026-06-09T14:00:00Z', diagnosis: 'Fracture', daysAdmitted: 2 },
        ],
      },
      isLoading: false,
    } as never);
    render(<IPDMonitor />);
    const patientListTab = screen.getByText('adminMonitor.ipd.viewTabs.patientList');
    fireEvent.click(patientListTab);
    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('Fatima Begum')).toBeInTheDocument();
    expect(screen.getByText('Dr. Karim')).toBeInTheDocument();
    expect(screen.getByText('Pneumonia')).toBeInTheDocument();
  });

  it('renders discharge pending view', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { totalBeds: 3, occupied: 3, available: 0, cleaning: 0, maintenance: 0, reserved: 0, occupancyPercentage: 100, dischargesToday: 1, avgStayDays: 4 },
        wards: [],
        admissions: [],
        dischargePending: [
          { id: 'DP1', patientName: 'Abdul Karim', bedNumber: 'G-05', wardName: 'General Ward', doctorName: 'Dr. Ali', dischargeApproved: true, pendingBill: true },
        ],
      },
      isLoading: false,
    } as never);
    render(<IPDMonitor />);
    const dischargeTab = screen.getByText('adminMonitor.ipd.viewTabs.dischargePending');
    fireEvent.click(dischargeTab);
    expect(screen.getByText('Abdul Karim')).toBeInTheDocument();
    expect(screen.getByText('G-05')).toBeInTheDocument();
  });

  it('shows empty state when no admissions', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { totalBeds: 50, occupied: 0, available: 50, cleaning: 0, maintenance: 0, reserved: 0, occupancyPercentage: 0, dischargesToday: 0, avgStayDays: 0 },
        wards: [],
        admissions: [],
      },
      isLoading: false,
    } as never);
    render(<IPDMonitor />);
    const patientListTab = screen.getByText('adminMonitor.ipd.viewTabs.patientList');
    fireEvent.click(patientListTab);
    expect(screen.getByText('adminMonitor.ipd.noAdmissions')).toBeInTheDocument();
  });
});

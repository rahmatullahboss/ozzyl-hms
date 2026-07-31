import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorDashboard from './DoctorDashboard';
import { useApiQuery } from '../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, optsOrDefault?: any) => {
      if (typeof optsOrDefault === 'string') return optsOrDefault;
      return optsOrDefault?.defaultValue ?? k;
    },
  }),
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ slug: 'demo-hospital' }),
  };
});
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('../components/doctor/PatientAIWidget', () => ({ PatientAIWidget: () => <div data-testid="ai-widget" /> }));
vi.mock('../components/doctor/KpiCard', () => ({ KpiCard: ({ label }: any) => <div>{label}</div> }));
vi.mock('../components/doctor/QueueTable', () => ({ QueueTable: () => <div data-testid="queue-table" /> }));
vi.mock('../components/doctor/RightPanel', () => ({ RightPanel: () => <div data-testid="right-panel" /> }));
vi.mock('../components/doctor/ScheduleTimeline', () => ({ ScheduleTimeline: () => <div data-testid="schedule-timeline" /> }));
vi.mock('../components/doctor/QuickActions', () => ({ QuickActions: () => <div data-testid="quick-actions" /> }));
vi.mock('../components/doctor/DoctorWorkspaceDrawer', () => ({ DoctorWorkspaceDrawer: () => <div data-testid="workspace-drawer" /> }));
vi.mock('../lib/date-utils', () => ({
  getTodayGMT6: () => '2024-06-01',
  getNowGMT6: () => new Date('2024-06-01T10:00:00Z'),
  formatDateTimeGMT6: (d: string) => d,
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DoctorDashboard />
    </MemoryRouter>,
  );
}

describe('DoctorDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockImplementation((_key: unknown, _path: unknown) => ({
      data: {
        doctor: { id: 1, name: 'Dr. Ahmed', specialty: 'Cardiology' },
        today: '2024-06-01',
        kpi: { total: 8, completed: 3, waiting: 4, in_progress: 1, yesterday: 6 },
        queue: [],
        visitTypes: [],
        recentRx: [],
        followUps: [],
        availableDoctors: [],
        pendingOrders: [],
        inpatients: [],
      },
      isLoading: false,
      refetch: vi.fn(),
    }));
  });

  it('renders with DashboardLayout wrapper', () => {
    renderDashboard();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('shows doctor name and greeting', () => {
    renderDashboard();
    expect(screen.getByText(/Dr\. Ahmed/)).toBeInTheDocument();
    expect(screen.getByText('Cardiology')).toBeInTheDocument();
  });

  it('renders KPI cards', () => {
    renderDashboard();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('In room')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('renders queue table and right panel', () => {
    renderDashboard();
    expect(screen.getByTestId('queue-table')).toBeInTheDocument();
    expect(screen.getByTestId('right-panel')).toBeInTheDocument();
  });

  it('links doctors to their own report review and clinical toolkit workflows', () => {
    renderDashboard();

    expect(screen.getByRole('link', { name: /report review/i })).toHaveAttribute(
      'href',
      '/h/demo-hospital/doctor/report-review',
    );
    expect(screen.getByRole('link', { name: /order sets/i })).toHaveAttribute(
      'href',
      '/h/demo-hospital/order-sets',
    );
    expect(screen.getByRole('link', { name: /dictation/i })).toHaveAttribute(
      'href',
      '/h/demo-hospital/dictation',
    );
    expect(screen.getByRole('link', { name: /referral/i })).toHaveAttribute(
      'href',
      '/h/demo-hospital/doctor/referrals/new',
    );
    expect(screen.getByRole('link', { name: /certificates/i })).toHaveAttribute(
      'href',
      '/h/demo-hospital/doctor/certificates',
    );
  });

  it('loading state is wrapped in DashboardLayout', () => {
    (useApiQuery as any).mockReturnValue({
      data: undefined,
      isLoading: true,
      refetch: vi.fn(),
    });
    renderDashboard();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(screen.getByText('Loading your dashboard…')).toBeInTheDocument();
  });

  it('error state is wrapped in DashboardLayout', () => {
    (useApiQuery as any).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderDashboard();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(screen.getByText('Doctor profile not linked to this account.')).toBeInTheDocument();
  });

  it('routes critical consultation actions to the doctor OPD workspace', () => {
    (useApiQuery as any).mockReturnValue({
      data: {
        doctor: { id: 1, name: 'Dr. Ahmed', specialty: 'Cardiology' },
        today: '2024-06-01',
        kpi: { total: 1, completed: 0, waiting: 1, in_progress: 0, yesterday: 0 },
        queue: [{
          id: 44,
          appointment_id: 44,
          patient_id: 10,
          patient_name: 'Critical Patient',
          token_no: 7,
          status: 'waiting',
          vitals_bp_systolic: 190,
          vitals_bp_diastolic: 80,
        }],
        visitTypes: [],
        recentRx: [],
        followUps: [],
        availableDoctors: [],
        pendingOrders: [],
        inpatients: [],
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    renderDashboard();

    expect(screen.getByRole('link', { name: /start consultation/i })).toHaveAttribute(
      'href',
      '/h/demo-hospital/doctor/opd/10/44',
    );
  });

  it('does not offer Fast Rx for a closed queue row', () => {
    (useApiQuery as any).mockReturnValue({
      data: {
        doctor: { id: 1, name: 'Dr. Ahmed', specialty: 'Cardiology' },
        today: '2024-06-01',
        kpi: { total: 1, completed: 1, waiting: 0, in_progress: 0, yesterday: 0 },
        queue: [{
          id: 45,
          appointment_id: 45,
          patient_id: 11,
          patient_name: 'Completed Patient',
          token_no: 8,
          status: 'completed',
        }],
        visitTypes: [],
        recentRx: [],
        followUps: [],
        availableDoctors: [],
        pendingOrders: [],
        inpatients: [],
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    renderDashboard();

    expect(screen.getByRole('button', { name: /fast rx/i })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /fast rx/i })).not.toBeInTheDocument();
  });

  it('does not fall back to a queue row id for critical consultation links', () => {
    (useApiQuery as any).mockReturnValue({
      data: {
        doctor: { id: 1, name: 'Dr. Ahmed', specialty: 'Cardiology' },
        today: '2024-06-01',
        kpi: { total: 1, completed: 0, waiting: 1, in_progress: 0, yesterday: 0 },
        queue: [{
          id: 99,
          patient_id: 12,
          patient_name: 'Missing Appointment Patient',
          token_no: 9,
          status: 'waiting',
          vitals_bp_systolic: 190,
          vitals_bp_diastolic: 80,
        }],
        visitTypes: [],
        recentRx: [],
        followUps: [],
        availableDoctors: [],
        pendingOrders: [],
        inpatients: [],
      },
      isLoading: false,
      refetch: vi.fn(),
    });

    renderDashboard();

    expect(screen.getByRole('button', { name: /start consultation/i })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /start consultation/i })).not.toBeInTheDocument();
  });

  it('uses critical blood pressure OR logic in alert reason rendering', () => {
    const source = readFileSync('src/pages/DoctorDashboard.tsx', 'utf8');

    expect(source).toContain('(sys != null && sys >= 180) || (dia != null && dia >= 120)');
    expect(source).toContain('(item.vitals_bp_systolic != null && item.vitals_bp_systolic >= 180) ||');
    expect(source).not.toContain('item.vitals_bp_systolic >= 180 && item.vitals_bp_diastolic >= 120');
  });

  it('shows IPD Ward Rounds card with critical patient badge and round link', () => {
    // The dashboard has two useApiQuery hooks (main + ipd-rounds). The second
    // hook is given the IPD-rounds summary.
    (useApiQuery as any)
      .mockImplementationOnce(() => ({
        data: {
          doctor: { id: 1, name: 'Dr. Ahmed', specialty: 'Cardiology' },
          today: '2024-06-01',
          kpi: { total: 0, completed: 0, waiting: 0, in_progress: 0, yesterday: 0 },
          queue: [],
          visitTypes: [],
          recentRx: [],
          followUps: [],
          availableDoctors: [],
          pendingOrders: [],
          inpatients: [],
        },
        isLoading: false,
        refetch: vi.fn(),
      }))
      .mockImplementationOnce(() => ({
        data: {
          date: '2024-06-01',
          summary: { total_inpatients: 1, not_rounded_today: 1, pending_clinical_note: 1, deteriorating: 0, critical: 1 },
          inpatients: [
            {
              admission_id: 88,
              patient_id: 21,
              patient_name: 'Runa Begum',
              patient_code: 'PT-021',
              admission_no: 'ADM-2024-088',
              bed_number: 'B-12',
              diagnosis: 'Sepsis with hypotension',
              today_round_id: null,
              today_round_clinical_status: null,
              last_patient_condition: 'critical',
              needs_round_note: true,
              not_rounded_today: true,
            },
          ],
        },
        isLoading: false,
        refetch: vi.fn(),
      }));

    renderDashboard();

    expect(screen.getByText(/IPD Ward Rounds/i)).toBeInTheDocument();
    // The patient must have a Round action that links to the IPD workspace round tab.
    const tabLink = screen.getByRole('link', { name: /^Round$/i });
    expect(tabLink).toHaveAttribute('href', '/h/demo-hospital/doctor/ipd/88?tab=round');
  });
});

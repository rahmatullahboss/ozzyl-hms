import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OPDMonitor from './OPDMonitor';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string, opts?: { count?: number }) => {
    if (opts && typeof opts.count === 'number') {
      if (k === 'adminMonitor.opd.delayMinutes') return `${opts.count} min`;
      if (k === 'adminMonitor.opd.patientsWaiting') return `${opts.count} patients waiting`;
    }
    return k;
  } }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/opd-monitor', search: params.toString(), hash: '', state: null, key: 'default' }),
    useSearchParams: () => {
      const setParams = (next: Record<string, string> | ((p: URLSearchParams) => URLSearchParams)) => {
        if (typeof next === 'function') {
          params = next(params);
        } else {
          params = new URLSearchParams(next);
        }
      };
      return [params, setParams] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
vi.mock('../../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { opdMonitor: () => ['admin', 'opd-monitor'] },
    queue: { tokensOverview: () => ['queue', 'tokens-overview'] },
  },
}));
vi.mock('../../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('OPDMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<OPDMonitor />);
    expect(screen.getByText('adminMonitor.opd.title')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<OPDMonitor />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders summary cards with stats', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: {
          total: 45,
          waiting: 12,
          serving: 5,
          completed: 25,
          noShow: 2,
          cancelled: 1,
        },
        tokens: [],
      },
      isLoading: false,
    } as never);
    render(<OPDMonitor />);
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders token table with data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { total: 3, waiting: 1, serving: 1, completed: 1, noShow: 0, cancelled: 0 },
        tokens: [
          {
            id: 'T1',
            tokenNumber: 'A001',
            patientName: 'Rahim Uddin',
            doctorName: 'Dr. Karim',
            departmentName: 'Medicine',
            appointmentTime: '2026-06-11T09:00:00Z',
            checkinTime: '2026-06-11T09:05:00Z',
            waitingMinutes: 15,
            status: 'waiting',
          },
          {
            id: 'T2',
            tokenNumber: 'A002',
            patientName: 'Fatima Begum',
            doctorName: 'Dr. Rahim',
            departmentName: 'Gynecology',
            appointmentTime: '2026-06-11T09:30:00Z',
            checkinTime: '2026-06-11T09:25:00Z',
            waitingMinutes: 0,
            status: 'serving',
          },
        ],
      },
      isLoading: false,
    } as never);
    render(<OPDMonitor />);
    expect(screen.getByText('A001')).toBeInTheDocument();
    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('Dr. Karim')).toBeInTheDocument();
    expect(screen.getByText('A002')).toBeInTheDocument();
    expect(screen.getByText('Fatima Begum')).toBeInTheDocument();
  });

  it('shows empty state when no tokens', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { total: 0, waiting: 0, serving: 0, completed: 0, noShow: 0, cancelled: 0 },
        tokens: [],
      },
      isLoading: false,
    } as never);
    render(<OPDMonitor />);
    expect(screen.getByText('adminMonitor.opd.noTokens')).toBeInTheDocument();
  });

  it('renders delayed doctors section', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { total: 5, waiting: 2, serving: 1, completed: 2, noShow: 0, cancelled: 0 },
        tokens: [],
        delayedDoctors: [
          { doctorName: 'Dr. Late', departmentName: 'Surgery', delayMinutes: 30, waitingPatients: 5 },
        ],
      },
      isLoading: false,
    } as never);
    render(<OPDMonitor />);
    expect(screen.getByText('adminMonitor.opd.delayedDoctors')).toBeInTheDocument();
    expect(screen.getByText('Dr. Late')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
  });

  it('filters tokens by status tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { total: 3, waiting: 1, serving: 1, completed: 1, noShow: 0, cancelled: 0 },
        tokens: [
          { id: 'T1', tokenNumber: 'A001', patientName: 'Patient A', doctorName: 'Dr. A', departmentName: 'Med', appointmentTime: '2026-06-11T09:00:00Z', status: 'waiting', waitingMinutes: 10 },
          { id: 'T2', tokenNumber: 'A002', patientName: 'Patient B', doctorName: 'Dr. B', departmentName: 'Med', appointmentTime: '2026-06-11T09:30:00Z', status: 'completed', waitingMinutes: 0 },
        ],
      },
      isLoading: false,
    } as never);
    render(<OPDMonitor />);
    const completedTab = screen.getAllByText('adminMonitor.opd.statusTabs.completed').find(el => el.tagName === 'BUTTON');
    fireEvent.click(completedTab!);
    expect(screen.getByText('A002')).toBeInTheDocument();
    expect(screen.queryByText('A001')).not.toBeInTheDocument();
  });
});

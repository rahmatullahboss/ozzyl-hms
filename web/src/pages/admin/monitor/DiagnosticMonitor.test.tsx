import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiagnosticMonitor from './DiagnosticMonitor';
import { useApiQuery } from '../../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string, opts?: { count?: number }) => {
    if (opts && typeof opts.count === 'number') {
      if (k === 'adminMonitor.opd.delayMinutes') return `${opts.count} min`;
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
    useLocation: () => ({ pathname: '/admin/diagnostic-monitor', search: params.toString(), hash: '', state: null, key: 'default' }),
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
    admin: { diagnosticMonitor: () => ['admin', 'diagnostic-monitor'] },
    lab: { queueToday: () => ['lab', 'queue-today'] },
  },
}));
vi.mock('../../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('DiagnosticMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<DiagnosticMonitor />);
    expect(screen.getByText('adminMonitor.diagnostic.title')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<DiagnosticMonitor />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders summary cards with stats', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: {
          totalToday: 65,
          samplePending: 12,
          processing: 8,
          reportReady: 40,
          delayed: 3,
          critical: 2,
        },
        items: [],
      },
      isLoading: false,
    } as never);
    render(<DiagnosticMonitor />);
    expect(screen.getByText('65')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders lab items table with data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { totalToday: 2, samplePending: 0, processing: 1, reportReady: 1, delayed: 0, critical: 0 },
        items: [
          {
            id: 'L1',
            orderId: 'ORD-001',
            patientName: 'Rahim Uddin',
            testName: 'Complete Blood Count',
            departmentName: 'Hematology',
            sampleStatus: 'collected',
            reportStatus: 'processing',
            expectedTime: '2026-06-11T11:00:00Z',
            delayMinutes: 0,
          },
          {
            id: 'L2',
            orderId: 'ORD-002',
            patientName: 'Fatima Begum',
            testName: 'Blood Sugar',
            departmentName: 'Biochemistry',
            sampleStatus: 'completed',
            reportStatus: 'report_ready',
            expectedTime: '2026-06-11T10:30:00Z',
            delayMinutes: 0,
          },
        ],
      },
      isLoading: false,
    } as never);
    render(<DiagnosticMonitor />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('Complete Blood Count')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.getByText('Fatima Begum')).toBeInTheDocument();
  });

  it('shows empty state when no lab items', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { totalToday: 0, samplePending: 0, processing: 0, reportReady: 0, delayed: 0, critical: 0 },
        items: [],
      },
      isLoading: false,
    } as never);
    render(<DiagnosticMonitor />);
    expect(screen.getByText('adminMonitor.diagnostic.noLabOrders')).toBeInTheDocument();
  });

  it('renders critical result alerts', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { totalToday: 3, samplePending: 0, processing: 0, reportReady: 3, delayed: 0, critical: 1 },
        items: [],
        criticalAlerts: [
          { id: 'C1', patientName: 'Emergency Patient', testName: 'Troponin I', result: 'Positive', severity: 'critical' },
        ],
      },
      isLoading: false,
    } as never);
    render(<DiagnosticMonitor />);
    expect(screen.getByText('adminMonitor.diagnostic.criticalResults')).toBeInTheDocument();
    expect(screen.getByText('Emergency Patient')).toBeInTheDocument();
    expect(screen.getByText('Troponin I')).toBeInTheDocument();
  });

  it('filters items by status tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        stats: { totalToday: 2, samplePending: 1, processing: 0, reportReady: 1, delayed: 0, critical: 0 },
        items: [
          { id: 'L1', orderId: 'ORD-001', patientName: 'Patient A', testName: 'Test A', departmentName: 'Dept A', sampleStatus: 'pending', reportStatus: 'pending', expectedTime: '2026-06-11T11:00:00Z', delayMinutes: 0 },
          { id: 'L2', orderId: 'ORD-002', patientName: 'Patient B', testName: 'Test B', departmentName: 'Dept B', sampleStatus: 'completed', reportStatus: 'report_ready', expectedTime: '2026-06-11T10:30:00Z', delayMinutes: 0 },
        ],
      },
      isLoading: false,
    } as never);
    render(<DiagnosticMonitor />);
    const readyTab = screen.getAllByText('adminMonitor.diagnostic.statusTabs.reportReady').find(el => el.tagName === 'BUTTON');
    fireEvent.click(readyTab!);
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument();
  });
});

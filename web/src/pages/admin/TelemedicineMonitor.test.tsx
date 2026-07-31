import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TelemedicineMonitor from './TelemedicineMonitor';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { telemedicine: { consultations: () => ['telemed', 'consultations'] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockSessions = [
  { id: 'S1', patientName: 'Rahim', doctorName: 'Dr. Hasan', department: 'Cardiology', scheduledAt: '2026-06-11T10:00:00Z', startedAt: '2026-06-11T10:05:00Z', endedAt: null, status: 'in_progress', duration: 15 },
  { id: 'S2', patientName: 'Karim', doctorName: 'Dr. Rina', department: 'Medicine', scheduledAt: '2026-06-11T11:00:00Z', startedAt: '2026-06-11T11:00:00Z', endedAt: '2026-06-11T11:30:00Z', status: 'completed', duration: 30 },
];

const mockStats = {
  totalToday: 12,
  inProgress: 2,
  scheduled: 3,
  completed: 5,
  cancelled: 1,
  noShow: 1,
  avgDuration: 22,
};

describe('TelemedicineMonitor', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders page title and subtitle', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { sessions: [], stats: undefined }, isLoading: false } as never);
    render(<TelemedicineMonitor />);
    expect(screen.getByText('telemedicineMonitor.title')).toBeInTheDocument();
    expect(screen.getByText('telemedicineMonitor.subtitle')).toBeInTheDocument();
  });

  it('renders 7 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { sessions: [], stats: mockStats }, isLoading: false } as never);
    const { container } = render(<TelemedicineMonitor />);
    expect(container.textContent).toContain('telemedicineMonitor.summary.totalToday');
    expect(container.textContent).toContain('telemedicineMonitor.summary.inProgress');
    expect(container.textContent).toContain('telemedicineMonitor.summary.scheduled');
    expect(container.textContent).toContain('telemedicineMonitor.summary.completed');
    expect(container.textContent).toContain('telemedicineMonitor.summary.cancelled');
    expect(container.textContent).toContain('telemedicineMonitor.summary.noShow');
    expect(container.textContent).toContain('telemedicineMonitor.summary.avgDuration');
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('22m');
  });

  it('renders 5 status tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { sessions: [], stats: mockStats }, isLoading: false } as never);
    render(<TelemedicineMonitor />);
    expect(screen.getByText('telemedicineMonitor.tabs.all')).toBeInTheDocument();
    expect(screen.getByText('telemedicineMonitor.tabs.inProgress')).toBeInTheDocument();
    expect(screen.getByText('telemedicineMonitor.tabs.scheduled')).toBeInTheDocument();
    expect(screen.getByText('telemedicineMonitor.tabs.completed')).toBeInTheDocument();
    expect(screen.getByText('telemedicineMonitor.tabs.cancelled')).toBeInTheDocument();
  });

  it('renders sessions table with all data by default', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { sessions: mockSessions, stats: mockStats }, isLoading: false } as never);
    render(<TelemedicineMonitor />);
    expect(screen.getByText('Rahim')).toBeInTheDocument();
    expect(screen.getByText('Karim')).toBeInTheDocument();
    expect(screen.getByText('Dr. Hasan')).toBeInTheDocument();
    expect(screen.getByText('Cardiology')).toBeInTheDocument();
  });

  it('filters by In Progress tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { sessions: mockSessions, stats: mockStats }, isLoading: false } as never);
    render(<TelemedicineMonitor />);
    fireEvent.click(screen.getByText('telemedicineMonitor.tabs.inProgress'));
    expect(screen.getByText('Rahim')).toBeInTheDocument();
    expect(screen.queryByText('Karim')).not.toBeInTheDocument();
  });

  it('filters by Completed tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { sessions: mockSessions, stats: mockStats }, isLoading: false } as never);
    render(<TelemedicineMonitor />);
    fireEvent.click(screen.getByText('telemedicineMonitor.tabs.completed'));
    expect(screen.getByText('Karim')).toBeInTheDocument();
    expect(screen.queryByText('Rahim')).not.toBeInTheDocument();
  });

  it('shows empty state when no sessions', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { sessions: [], stats: mockStats }, isLoading: false } as never);
    render(<TelemedicineMonitor />);
    expect(screen.getByText('telemedicineMonitor.noData')).toBeInTheDocument();
  });

  it('shows status badges for sessions', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { sessions: mockSessions, stats: mockStats }, isLoading: false } as never);
    const { container } = render(<TelemedicineMonitor />);
    expect(container.textContent).toContain('telemedicineMonitor.summary.inProgress');
    expect(container.textContent).toContain('telemedicineMonitor.summary.completed');
  });
});

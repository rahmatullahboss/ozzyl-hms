import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AlertsExceptions from './AlertsExceptions';
import { useApiQuery } from '../../hooks/useApiQuery';

const setSearchParamsMock = vi.fn();
const refetchMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty' },
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useSearchParams: () => [searchParams, setSearchParamsMock],
  };
});

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: '77', role: 'hospital_admin', permissions: [] } }),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    actionCenter: {
      summary: () => ['action-center', 'summary'],
      exceptions: {
        list: (filters: Record<string, unknown>) => ['action-center', 'exceptions', 'list', filters],
      },
    },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));
vi.mock('../../components/action-center/ActionCenterShell', () => ({
  default: ({ children, title, primaryAction }: { children: React.ReactNode; title: string; primaryAction?: React.ReactNode }) => (
    <section data-testid="action-center-shell">
      <h1>{title}</h1>
      {primaryAction}
      {children}
    </section>
  ),
}));
vi.mock('../../components/action-center/ExceptionDetailDrawer', () => ({
  default: ({ caseId, open }: { caseId: number | null; open: boolean }) => (
    open ? <div data-testid="exception-drawer">case:{caseId}</div> : null
  ),
}));

const item = {
  id: 42,
  ruleKey: 'cash.stale_handover',
  fingerprint: 'handover:42',
  sourceType: 'cash_handover',
  sourceId: '42',
  module: 'cash',
  severity: 'warning',
  title: 'Stale cash handover',
  description: 'Pending handover is older than 24 hours.',
  sourceHref: '/cash/handover/42',
  status: 'open',
  assignedTo: null,
  assignedToName: null,
  firstDetectedAt: '2026-07-13 08:00:00',
  lastDetectedAt: '2026-07-14 09:00:00',
  snoozedUntil: null,
  slaAgeHours: 28,
  createdAt: '2026-07-13 08:00:00',
  updatedAt: '2026-07-14 09:00:00',
};

function mockList(overrides: Record<string, unknown> = {}) {
  vi.mocked(useApiQuery).mockReturnValue({
    data: {
      data: {
        items: [item],
        summary: {
          total: 9,
          open: 4,
          acknowledged: 2,
          in_progress: 1,
          snoozed: 1,
          resolved: 1,
          dismissed: 0,
          critical: 2,
          warning: 5,
          info: 2,
        },
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      },
    },
    isLoading: false,
    isError: false,
    refetch: refetchMock,
    ...overrides,
  } as never);
}

describe('AlertsExceptions persistent queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
    mockList();
  });

  it('renders inside the dashboard and canonical Action Center shell', () => {
    render(<AlertsExceptions />);
    expect(screen.getByTestId('layout')).toBeInTheDocument();
    expect(screen.getByTestId('action-center-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'alerts.title' })).toBeInTheDocument();
  });

  it('builds the server query from URL-backed status, severity, type, assignee, search, and page filters', () => {
    searchParams = new URLSearchParams({
      status: 'acknowledged',
      severity: 'critical',
      type: 'cash.stale_handover',
      assignee: '77',
      search: 'cash shortage',
      page: '2',
    });

    render(<AlertsExceptions />);

    expect(useApiQuery).toHaveBeenCalledWith(
      expect.any(Array),
      '/api/action-center/exceptions?status=acknowledged&severity=critical&type=cash.stale_handover&assignee=77&search=cash+shortage&page=2&limit=50',
      expect.objectContaining({ placeholderData: expect.any(Function) }),
    );
  });

  it('updates URL filters and resets pagination', () => {
    searchParams = new URLSearchParams({ page: '3', status: 'open' });
    render(<AlertsExceptions />);

    fireEvent.change(screen.getByLabelText('alerts.filters.severity'), { target: { value: 'critical' } });

    expect(setSearchParamsMock).toHaveBeenCalledTimes(1);
    const next = setSearchParamsMock.mock.calls[0]?.[0] as URLSearchParams;
    expect(next.get('severity')).toBe('critical');
    expect(next.get('status')).toBe('open');
    expect(next.get('page')).toBeNull();
  });

  it('shows persistent lifecycle and severity count badges', () => {
    render(<AlertsExceptions />);
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getAllByText('alerts.status.open').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('alerts.severity.critical').length).toBeGreaterThanOrEqual(1);
  });

  it('renders loading, error with retry, and empty queue states', () => {
    vi.mocked(useApiQuery).mockReturnValueOnce({ data: undefined, isLoading: true, isError: false } as never);
    const { rerender } = render(<AlertsExceptions />);
    expect(screen.getByRole('status')).toHaveTextContent('alerts.loading');

    vi.mocked(useApiQuery).mockReturnValueOnce({ data: undefined, isLoading: false, isError: true, refetch: refetchMock } as never);
    rerender(<AlertsExceptions />);
    expect(screen.getByRole('alert')).toHaveTextContent('alerts.error');
    fireEvent.click(screen.getByRole('button', { name: 'alerts.retry' }));
    expect(refetchMock).toHaveBeenCalled();

    vi.mocked(useApiQuery).mockReturnValueOnce({
      data: { data: { items: [], summary: {}, pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } } },
      isLoading: false,
      isError: false,
    } as never);
    rerender(<AlertsExceptions />);
    expect(screen.getByText('alerts.emptyTitle')).toBeInTheDocument();
  });

  it('opens the selected case drawer and preserves an accessible source link', () => {
    render(<AlertsExceptions />);

    const sourceLink = screen.getByRole('link', { name: 'alerts.openSource' });
    expect(sourceLink).toHaveAttribute('href', '/h/city-hospital/cash/handover/42');

    fireEvent.click(screen.getByRole('button', { name: /Stale cash handover/i }));
    expect(screen.getByTestId('exception-drawer')).toHaveTextContent('case:42');
  });

  it('moves through server pages through URL state', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { data: { items: [item], summary: {}, pagination: { page: 1, limit: 50, total: 80, totalPages: 2 } } },
      isLoading: false,
      isError: false,
    } as never);
    render(<AlertsExceptions />);

    fireEvent.click(screen.getByRole('button', { name: 'alerts.pagination.next' }));
    const next = setSearchParamsMock.mock.calls[0]?.[0] as URLSearchParams;
    expect(next.get('page')).toBe('2');
  });
});

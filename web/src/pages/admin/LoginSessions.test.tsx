import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginSessions from './LoginSessions';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/login-sessions', search: params.toString(), hash: '', state: null, key: 'default' }),
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
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: { loginSessions: () => ['admin', 'login-sessions'] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('LoginSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<LoginSessions />);
    expect(screen.getByText('loginSessions.title')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<LoginSessions />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { activeSessions: 12, todayLogins: 45, uniqueUsers: 8, suspiciousLogins: 2 },
        sessions: [],
      },
      isLoading: false,
    } as never);
    render(<LoginSessions />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders sessions table with data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { activeSessions: 2, todayLogins: 2, uniqueUsers: 2, suspiciousLogins: 0 },
        sessions: [
          {
            id: 'S1',
            userName: 'admin',
            device: 'Chrome/Windows',
            ipAddress: '192.168.1.100',
            browser: 'Chrome 120',
            loginTime: '2026-06-11T09:00:00Z',
            lastActive: '2026-06-11T10:30:00Z',
            branch: 'Main Branch',
            status: 'active',
          },
          {
            id: 'S2',
            userName: 'receptionist1',
            device: 'Safari/Mac',
            ipAddress: '192.168.1.101',
            browser: 'Safari 17',
            loginTime: '2026-06-11T08:30:00Z',
            lastActive: '2026-06-11T10:25:00Z',
            branch: 'Main Branch',
            status: 'active',
          },
        ],
      },
      isLoading: false,
    } as never);
    render(<LoginSessions />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('receptionist1')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    expect(screen.getByText('Chrome 120')).toBeInTheDocument();
  });

  it('shows empty state when no sessions', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { activeSessions: 0, todayLogins: 0, uniqueUsers: 0, suspiciousLogins: 0 },
        sessions: [],
      },
      isLoading: false,
    } as never);
    render(<LoginSessions />);
    expect(screen.getByText('loginSessions.noData')).toBeInTheDocument();
  });

  it('renders session status badges', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { activeSessions: 2, todayLogins: 2, uniqueUsers: 2, suspiciousLogins: 1 },
        sessions: [
          { id: 'S1', userName: 'admin', device: 'Chrome', ipAddress: '10.0.0.1', browser: 'Chrome', loginTime: '2026-06-11T09:00:00Z', lastActive: '2026-06-11T10:30:00Z', branch: 'Main', status: 'active' },
          { id: 'S2', userName: 'user1', device: 'Firefox', ipAddress: '10.0.0.2', browser: 'Firefox', loginTime: '2026-06-11T09:00:00Z', lastActive: '2026-06-11T09:05:00Z', branch: 'Main', status: 'suspicious' },
        ],
      },
      isLoading: false,
    } as never);
    render(<LoginSessions />);
    expect(screen.getByText('loginSessions.statusLabels.active')).toBeInTheDocument();
    expect(screen.getByText('loginSessions.statusLabels.suspicious')).toBeInTheDocument();
  });

  it('filters sessions by status tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { activeSessions: 1, todayLogins: 2, uniqueUsers: 2, suspiciousLogins: 1 },
        sessions: [
          { id: 'S1', userName: 'admin', device: 'Chrome', ipAddress: '10.0.0.1', browser: 'Chrome', loginTime: '2026-06-11T09:00:00Z', lastActive: '2026-06-11T10:30:00Z', branch: 'Main', status: 'active' },
          { id: 'S2', userName: 'user1', device: 'Firefox', ipAddress: '10.0.0.2', browser: 'Firefox', loginTime: '2026-06-11T09:00:00Z', lastActive: '2026-06-11T09:05:00Z', branch: 'Main', status: 'suspicious' },
        ],
      },
      isLoading: false,
    } as never);
    render(<LoginSessions />);
    const suspiciousTab = screen.getAllByText('loginSessions.suspicious').find(el => el.tagName === 'BUTTON');
    fireEvent.click(suspiciousTab!);
    expect(screen.getByText('user1')).toBeInTheDocument();
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });
});

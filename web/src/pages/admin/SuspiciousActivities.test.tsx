import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SuspiciousActivities from './SuspiciousActivities';
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
    useLocation: () => ({ pathname: '/admin/suspicious-activities', search: params.toString(), hash: '', state: null, key: 'default' }),
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
    admin: { suspiciousActivities: () => ['admin', 'suspicious-activities'], securityAlerts: () => ['admin', 'security-alerts'] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe('SuspiciousActivities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<SuspiciousActivities />);
    expect(screen.getByText('suspiciousActivities.title')).toBeInTheDocument();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<SuspiciousActivities />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalAlerts: 15, critical: 3, high: 5, medium: 4, low: 3, resolved: 8 },
        alerts: [],
      },
      isLoading: false,
    } as never);
    render(<SuspiciousActivities />);
    expect(screen.getByText('15')).toBeInTheDocument();
    const threes = screen.getAllByText('3');
    expect(threes.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders alerts table with data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalAlerts: 2, critical: 1, high: 1, medium: 0, low: 0, resolved: 0 },
        alerts: [
          {
            id: 'A1',
            ruleName: 'High discount frequency',
            description: 'User admin issued 8 discounts in 2 hours',
            severity: 'critical',
            userName: 'admin',
            detectedAt: '2026-06-11T10:00:00Z',
            status: 'open',
            evidence: { count: 8, timeframe: '2 hours', totalAmount: 12000 },
          },
          {
            id: 'A2',
            ruleName: 'Refund spike near shift close',
            description: '3 refunds issued within 30 minutes of shift close',
            severity: 'high',
            userName: 'receptionist1',
            detectedAt: '2026-06-11T16:45:00Z',
            status: 'investigating',
            evidence: { count: 3, timeframe: '30 minutes' },
          },
        ],
      },
      isLoading: false,
    } as never);
    render(<SuspiciousActivities />);
    expect(screen.getByText('High discount frequency')).toBeInTheDocument();
    expect(screen.getByText('Refund spike near shift close')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('receptionist1')).toBeInTheDocument();
  });

  it('shows empty state when no alerts', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalAlerts: 0, critical: 0, high: 0, medium: 0, low: 0, resolved: 0 },
        alerts: [],
      },
      isLoading: false,
    } as never);
    render(<SuspiciousActivities />);
    expect(screen.getByText('suspiciousActivities.noData')).toBeInTheDocument();
  });

  it('renders severity badges', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalAlerts: 3, critical: 1, high: 1, medium: 1, low: 0, resolved: 0 },
        alerts: [
          { id: 'A1', ruleName: 'Rule 1', description: 'Desc 1', severity: 'critical', userName: 'user1', detectedAt: '2026-06-11T10:00:00Z', status: 'open', evidence: {} },
          { id: 'A2', ruleName: 'Rule 2', description: 'Desc 2', severity: 'high', userName: 'user2', detectedAt: '2026-06-11T10:00:00Z', status: 'open', evidence: {} },
          { id: 'A3', ruleName: 'Rule 3', description: 'Desc 3', severity: 'medium', userName: 'user3', detectedAt: '2026-06-11T10:00:00Z', status: 'resolved', evidence: {} },
        ],
      },
      isLoading: false,
    } as never);
    render(<SuspiciousActivities />);
    expect(screen.getByText('suspiciousActivities.severityLabels.critical')).toBeInTheDocument();
    expect(screen.getByText('suspiciousActivities.severityLabels.high')).toBeInTheDocument();
    expect(screen.getByText('suspiciousActivities.severityLabels.medium')).toBeInTheDocument();
  });

  it('filters alerts by severity tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        summary: { totalAlerts: 2, critical: 1, high: 1, medium: 0, low: 0, resolved: 0 },
        alerts: [
          { id: 'A1', ruleName: 'Critical Rule', description: 'Desc', severity: 'critical', userName: 'user1', detectedAt: '2026-06-11T10:00:00Z', status: 'open', evidence: {} },
          { id: 'A2', ruleName: 'High Rule', description: 'Desc', severity: 'high', userName: 'user2', detectedAt: '2026-06-11T10:00:00Z', status: 'open', evidence: {} },
        ],
      },
      isLoading: false,
    } as never);
    render(<SuspiciousActivities />);
    const criticalTab = screen.getAllByText('suspiciousActivities.summary.critical').find(el => el.tagName === 'BUTTON');
    fireEvent.click(criticalTab!);
    expect(screen.getByText('Critical Rule')).toBeInTheDocument();
    expect(screen.queryByText('High Rule')).not.toBeInTheDocument();
  });
});

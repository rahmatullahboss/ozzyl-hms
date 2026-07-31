import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuditExplorer from './AuditExplorer';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/audit-explorer', search: params.toString(), hash: '', state: null, key: 'default' }),
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
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { admin: { auditExplorer: () => ['admin', 'audit-explorer'] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('AuditExplorer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<AuditExplorer />);
    expect(screen.getByText('auditExplorer.loading')).toBeInTheDocument();
  });

  it('renders page title and subtitle', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { events: [], summary: undefined }, isLoading: false } as never);
    render(<AuditExplorer />);
    expect(screen.getByText('auditExplorer.title')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.subtitle')).toBeInTheDocument();
  });

  it('renders 4 severity tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { events: [] }, isLoading: false } as never);
    render(<AuditExplorer />);
    expect(screen.getByText('auditExplorer.tabs.all')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.tabs.high')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.tabs.medium')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.tabs.low')).toBeInTheDocument();
  });

  it('renders summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { events: [], summary: { total: 100, high: 10, medium: 30, low: 60 } },
      isLoading: false,
    } as never);
    render(<AuditExplorer />);
    expect(screen.getByText('auditExplorer.summary.totalEvents')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.summary.highSeverity')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.summary.mediumSeverity')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.summary.lowSeverity')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders audit events table with data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        events: [
          { id: 'E1', timestamp: '2026-06-11T10:00:00Z', user: 'admin', role: 'super_admin', event: 'login', module: 'auth', recordId: '1', ip: '10.0.0.1', severity: 'low' },
          { id: 'E2', timestamp: '2026-06-11T10:05:00Z', user: 'doctor1', role: 'doctor', event: 'prescribe', module: 'pharmacy', recordId: '42', ip: '10.0.0.2', severity: 'medium' },
        ],
        summary: { total: 2, high: 0, medium: 1, low: 1 },
      },
      isLoading: false,
    } as never);
    render(<AuditExplorer />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('doctor1')).toBeInTheDocument();
    expect(screen.getByText('prescribe')).toBeInTheDocument();
  });

  it('filters by High severity tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        events: [
          { id: 'E1', timestamp: '2026-06-11T10:00:00Z', user: 'admin', role: 'admin', event: 'login', module: 'auth', recordId: '1', ip: '10.0.0.1', severity: 'low' },
          { id: 'E2', timestamp: '2026-06-11T10:05:00Z', user: 'doctor1', role: 'doctor', event: 'prescribe', module: 'pharmacy', recordId: '42', ip: '10.0.0.2', severity: 'high' },
        ],
      },
      isLoading: false,
    } as never);
    render(<AuditExplorer />);
    fireEvent.click(screen.getByText('auditExplorer.tabs.high'));
    expect(screen.getByText('doctor1')).toBeInTheDocument();
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });

  it('expands row on click to show before/after', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        events: [
          { id: 'E1', timestamp: '2026-06-11T10:00:00Z', user: 'admin', role: 'admin', event: 'update_bill', module: 'billing', recordId: '100', ip: '10.0.0.1', severity: 'medium', before: '{"total":1000}', after: '{"total":500}' },
        ],
      },
      isLoading: false,
    } as never);
    render(<AuditExplorer />);
    expect(screen.queryByText('auditExplorer.diff.before')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('update_bill'));
    expect(screen.getByText('auditExplorer.diff.before')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.diff.after')).toBeInTheDocument();
  });

  it('toggles filter panel', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { events: [] }, isLoading: false } as never);
    render(<AuditExplorer />);
    expect(screen.queryByText('auditExplorer.filterPanel.dateRange')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('auditExplorer.filters'));
    expect(screen.getByText('auditExplorer.filterPanel.dateRange')).toBeInTheDocument();
    expect(screen.getByText('auditExplorer.filterPanel.user')).toBeInTheDocument();
  });

  it('shows empty state when no events', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { events: [] }, isLoading: false } as never);
    render(<AuditExplorer />);
    expect(screen.getByText('auditExplorer.empty')).toBeInTheDocument();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StaffActivityLog from './StaffActivityLog';
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
  queryKeys: { auditLog: { logs: () => ['auditLog', 'logs'] } },
}));
vi.mock('../../components/admin/AdminDataTable', () => ({
  default: ({ columns, data, loading, emptyMessage }: any) => (
    <div data-testid="data-table">
      {loading ? (
        <div data-testid="loading">Loading...</div>
      ) : data.length === 0 ? (
        <div data-testid="empty">{emptyMessage}</div>
      ) : (
        <table>
          <thead>
            <tr>{columns.map((c: any) => <th key={c.key}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((row: any) => (
              <tr key={row.id}>
                {columns.map((c: any) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ),
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockLogs = [
  { id: 1, timestamp: '2026-06-11T10:00:00Z', userId: 1, userName: 'admin', userRole: 'super_admin', action: 'create', module: 'patient', description: 'Created patient #100', ipAddress: '10.0.0.1', device: 'Chrome' },
  { id: 2, timestamp: '2026-06-11T10:30:00Z', userId: 2, userName: 'doctor1', userRole: 'doctor', action: 'update', module: 'prescription', description: 'Updated prescription #50', ipAddress: '10.0.0.2', device: 'Firefox' },
];

const mockSummary = {
  totalActions: 150,
  activeUsers: 12,
  topAction: 'create',
  topModule: 'patient',
};

describe('StaffActivityLog', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders page title and subtitle', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { logs: [], summary: undefined }, isLoading: false } as never);
    render(<StaffActivityLog />);
    expect(screen.getByText('staffActivityLog.title')).toBeInTheDocument();
    expect(screen.getByText('staffActivityLog.subtitle')).toBeInTheDocument();
  });

  it('renders 4 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { logs: mockLogs, summary: mockSummary },
      isLoading: false,
    } as never);
    const { container } = render(<StaffActivityLog />);
    expect(container.textContent).toContain('staffActivityLog.summary.totalActions');
    expect(container.textContent).toContain('staffActivityLog.summary.activeUsers');
    expect(container.textContent).toContain('staffActivityLog.summary.topAction');
    expect(container.textContent).toContain('staffActivityLog.summary.topModule');
    expect(container.textContent).toContain('150');
    expect(container.textContent).toContain('12');
  });

  it('passes logs to AdminDataTable', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { logs: mockLogs, summary: mockSummary },
      isLoading: false,
    } as never);
    render(<StaffActivityLog />);
    expect(screen.getByTestId('data-table')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('doctor1')).toBeInTheDocument();
  });

  it('shows empty message when no logs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { logs: [] }, isLoading: false } as never);
    render(<StaffActivityLog />);
    expect(screen.getByTestId('empty')).toBeInTheDocument();
    expect(screen.getByText('staffActivityLog.emptyMessage')).toBeInTheDocument();
  });

  it('refresh button calls refetch', () => {
    const refetch = vi.fn();
    vi.mocked(useApiQuery).mockReturnValue({
      data: { logs: [] },
      isLoading: false,
      refetch,
    } as never);
    render(<StaffActivityLog />);
    const refreshButton = screen.getByTitle('staffActivityLog.refresh');
    fireEvent.click(refreshButton);
    expect(refetch).toHaveBeenCalled();
  });

  it('shows loading state in table when loading', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<StaffActivityLog />);
    expect(screen.getByTestId('loading')).toBeInTheDocument();
  });
});

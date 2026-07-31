import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AuditFeedWidget from './AuditFeedWidget';

const mockNavigate = vi.fn();
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ slug: 'city-hospital' }),
}));
vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string, opts?: { count?: number }) => {
    if (opts && typeof opts.count === 'number') {
      if (k === 'adminDashboard.auditFeed.timeAgo.minutesAgo') return `${opts.count}m ago`;
      if (k === 'adminDashboard.auditFeed.timeAgo.hoursAgo') return `${opts.count}h ago`;
      if (k === 'adminDashboard.auditFeed.timeAgo.daysAgo') return `${opts.count}d ago`;
      if (k === 'adminDashboard.auditFeed.showingEntries') return `Showing ${opts.count} entries`;
    }
    return k;
  } }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('../../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../../lib/queryKeys', () => ({ queryKeys: { auditLog: { logs: () => ['auditLog', 'logs'] } } }));

import { useApiQuery } from '../../../hooks/useApiQuery';
const mockUseApiQuery = useApiQuery as unknown as ReturnType<typeof vi.fn>;

const mockLogs = [
  {
    id: 1,
    created_at: new Date(Date.now() - 120000).toISOString(),
    user_id: 1,
    user_name: 'Karim',
    action: 'UPDATE',
    table_name: 'bills',
    record_id: 'INV-001',
    ip_address: '192.168.1.10',
    new_value: '{"discount":20}',
  },
  {
    id: 2,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    user_id: 2,
    user_name: 'Admin',
    action: 'APPROVE',
    table_name: 'billing_credit_notes',
    record_id: 'RF-018',
    ip_address: '192.168.1.1',
  },
  {
    id: 3,
    created_at: new Date(Date.now() - 7200000).toISOString(),
    user_id: 3,
    user_name: 'Rina',
    action: 'DELETE',
    table_name: 'bills',
    record_id: 'INV-045',
    ip_address: '192.168.1.11',
  },
];

function renderWidget() {
  return render(<AuditFeedWidget />);
}

describe('AuditFeedWidget', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders loading skeleton', () => {
    mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: true });
    renderWidget();
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(1);
  });

  it('renders empty state', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: [] }, isLoading: false });
    renderWidget();
    expect(screen.getByText('adminDashboard.auditFeed.noEntries')).toBeDefined();
  });

  it('renders audit log entries', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: mockLogs }, isLoading: false });
    renderWidget();
    expect(screen.getByText('Karim')).toBeDefined();
    expect(screen.getByText('Admin')).toBeDefined();
    expect(screen.getByText('Rina')).toBeDefined();
  });

  it('displays severity badges', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: mockLogs }, isLoading: false });
    renderWidget();
    expect(screen.getByText('adminDashboard.auditFeed.severity.medium')).toBeDefined();
    expect(screen.getByText('adminDashboard.auditFeed.severity.high')).toBeDefined();
    expect(screen.getByText('adminDashboard.auditFeed.severity.critical')).toBeDefined();
  });

  it('displays descriptions', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: mockLogs }, isLoading: false });
    renderWidget();
    expect(screen.getByText('UPDATE bills #INV-001')).toBeDefined();
    expect(screen.getByText('APPROVE billing_credit_notes #RF-018')).toBeDefined();
  });

  it('formats UTC audit timestamps in Bangladesh time', () => {
    mockUseApiQuery.mockReturnValue({
      data: {
        auditLogs: [
          {
            id: 99,
            created_at: '2026-06-22 14:28:00',
            user_id: 4,
            user_name: 'Safaoat Ullah',
            action: 'LOGIN',
            table_name: 'users',
            record_id: '116',
          },
        ],
      },
      isLoading: false,
    });
    renderWidget();
    expect(screen.getByText('8:28 pm')).toBeDefined();
  });

  it('shows entry count', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: mockLogs }, isLoading: false });
    renderWidget();
    expect(screen.getByText('Showing 3 entries')).toBeDefined();
  });

  it('navigates to audit explorer on row click', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: mockLogs }, isLoading: false });
    renderWidget();
    const row = screen.getByText('UPDATE bills #INV-001').closest('[class*="cursor-pointer"]')!;
    fireEvent.click(row);
    expect(mockNavigate).toHaveBeenCalledWith('/h/city-hospital/system-audit');
  });

  it('navigates to audit explorer via View All link', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: mockLogs }, isLoading: false });
    renderWidget();
    fireEvent.click(screen.getByText('adminDashboard.auditFeed.viewAll'));
    expect(mockNavigate).toHaveBeenCalledWith('/h/city-hospital/system-audit');
  });

  it('shows auto-refresh indicator', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: mockLogs }, isLoading: false });
    renderWidget();
    expect(screen.getByText('adminDashboard.auditFeed.autoRefresh')).toBeDefined();
  });

  it('uses the tenant audit endpoint', () => {
    mockUseApiQuery.mockReturnValue({ data: { auditLogs: [] }, isLoading: false });
    renderWidget();
    expect(mockUseApiQuery).toHaveBeenCalledWith(
      ['auditLog', 'logs'],
      '/api/audit?limit=8',
      { refetchInterval: 30000 },
    );
  });

  describe('error handling', () => {
    it('renders accessible error state when the audit query fails', () => {
      mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
      renderWidget();
      const alert = screen.getByRole('alert');
      expect(alert).toBeTruthy();
      expect(alert).toHaveTextContent('adminDashboard.errors.loadFailed');
    });

    it('renders a retry button on error and invokes refetch on click', () => {
      const refetch = vi.fn();
      mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
      renderWidget();
      fireEvent.click(screen.getByText('adminDashboard.errors.retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });
});

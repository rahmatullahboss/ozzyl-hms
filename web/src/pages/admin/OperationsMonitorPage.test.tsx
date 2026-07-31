import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperationsMonitorPage from './OperationsMonitorPage';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="mock-layout">{children}</div>,
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

const snapshot = {
  date: '2026-06-23',
  generatedAt: '2026-06-23T09:30:00+06:00',
  unavailableModules: [],
  summary: {
    pending: 7,
    inProgress: 2,
    overdue: 4,
    proofMissing: 1,
    verificationPending: 3,
    critical: 1,
  },
  attendance: {
    scheduled: 12,
    checkedIn: 10,
    present: 8,
    late: 2,
    absent: 2,
    noCheckIn: 1,
    checkedInWithoutRoster: 0,
  },
  modules: {
    housekeeping: { total: 4, pending: 1, inProgress: 1, completed: 1, verified: 1, verificationPending: 1, overdue: 1 },
    helpdesk: { open: 1, inProgress: 1, escalated: 0, critical: 1, overdue: 1 },
    mrd: { pending: 1, inProgress: 0, overdue: 1 },
    discharge: { inProgress: 1, ready: 0, pendingChecklistItems: 2, overdue: 0 },
    cash: { expenses: 2, pendingExpenses: 1, proofMissing: 1, pendingHandovers: 1, pendingHandoverAmount: 5000 },
  },
  attentionItems: [
    {
      id: 'attendance:no-check-in:1',
      source: 'attendance',
      sourceId: 1,
      title: 'Nurse Fatima has no check-in for Morning',
      department: 'Nursing',
      assignedTo: 'Nurse Fatima',
      priority: 'high',
      status: 'no_check_in',
      dueAt: '2026-06-23T08:00:00+06:00',
      isOverdue: true,
    },
    {
      id: 'cash:expense-receipt:81',
      source: 'cash',
      sourceId: 81,
      title: 'Expense receipt missing — Generator fuel',
      department: 'Accounts',
      assignedTo: 90,
      priority: 'high',
      status: 'pending',
      dueAt: '2026-06-23',
      proofMissing: true,
      requiresProof: true,
    },
  ],
};

describe('OperationsMonitorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({ data: snapshot, isLoading: false, isError: false, refetch: vi.fn() } as never);
  });

  it('renders duty monitor summary cards and attention items', () => {
    render(<OperationsMonitorPage />);

    expect(screen.getByTestId('operations-monitor-page')).toBeInTheDocument();
    expect(screen.getByText('Operations Duty Monitor')).toBeInTheDocument();
    expect(screen.getByTestId('operations-card-overdue')).toHaveTextContent('4');
    expect(screen.getByTestId('operations-card-proof-missing')).toHaveTextContent('1');
    expect(screen.getByTestId('operations-risk-banner')).toHaveTextContent('Critical operations watch');
    expect(screen.getByTestId('operations-risk-banner')).toHaveTextContent('83%');
    expect(screen.getByText('Attendance: 1')).toBeInTheDocument();
    expect(screen.getByText('Cash: 1')).toBeInTheDocument();
    expect(screen.getByText('Nurse Fatima has no check-in for Morning')).toBeInTheDocument();
    expect(screen.getByText('Expense receipt missing — Generator fuel')).toBeInTheDocument();
    expect(screen.getAllByText('No check-in').length).toBeGreaterThan(0);
    expect(screen.getByText('Proof')).toBeInTheDocument();
  });

  it('filters attention items by source', () => {
    render(<OperationsMonitorPage />);

    fireEvent.change(screen.getByLabelText('Filter attention items by source'), { target: { value: 'cash' } });

    expect(screen.queryByText('Nurse Fatima has no check-in for Morning')).not.toBeInTheDocument();
    expect(screen.getByText('Expense receipt missing — Generator fuel')).toBeInTheDocument();
    expect(screen.getByTestId('operations-risk-banner')).toHaveTextContent('Visible issues');
  });

  it('shows direct action links for attention items that provide a route', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        ...snapshot,
        attentionItems: [
          { ...snapshot.attentionItems[0], link: '/hr/attendance' },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);

    render(<OperationsMonitorPage />);

    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute('href', '/hr/attendance');
  });

  it('shows a stable empty state when there are no operational risks', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        ...snapshot,
        summary: { pending: 0, inProgress: 0, overdue: 0, proofMissing: 0, verificationPending: 0, critical: 0 },
        attendance: { scheduled: 4, checkedIn: 4, present: 4, late: 0, absent: 0, noCheckIn: 0, checkedInWithoutRoster: 0 },
        modules: {
          housekeeping: { total: 0, pending: 0, inProgress: 0, completed: 0, verified: 0, verificationPending: 0, overdue: 0 },
          helpdesk: { open: 0, inProgress: 0, escalated: 0, critical: 0, overdue: 0 },
          mrd: { pending: 0, inProgress: 0, overdue: 0 },
          discharge: { inProgress: 0, ready: 0, pendingChecklistItems: 0, overdue: 0 },
          cash: { expenses: 0, pendingExpenses: 0, proofMissing: 0, pendingHandovers: 0, pendingHandoverAmount: 0 },
        },
        attentionItems: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);

    render(<OperationsMonitorPage />);

    expect(screen.getByTestId('operations-risk-banner')).toHaveTextContent('Operations look stable');
    expect(screen.getByTestId('operations-risk-banner')).toHaveTextContent('100%');
    expect(screen.getByText('No attention items for this filter.')).toBeInTheDocument();
  });

  it('shows an error state with retry action', () => {
    const refetch = vi.fn();
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch } as never);

    render(<OperationsMonitorPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load operations monitor');
    fireEvent.click(screen.getByText('Try again'));
    expect(refetch).toHaveBeenCalled();
  });
});

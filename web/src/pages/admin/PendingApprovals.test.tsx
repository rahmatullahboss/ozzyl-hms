import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import PendingApprovals from './PendingApprovals';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';

const mockMutate = vi.fn();
const mockBulkMutate = vi.fn();
const mockInvalidateQueries = vi.fn();

let mutationImpl: ((vars: any) => void) | null = null;
let bulkMutationImpl: ((vars: any) => void) | null = null;
let mutationRegistrations: Array<{ method: string; pathOrFn: string | ((vars: any) => string) }> = [];
let mutationInvocations: Array<{ path: string; vars: any }> = [];

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  let testRender: (() => void) | null = null;
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/admin/pending-approvals', search: params.toString(), hash: '', state: null, key: 'default' }),
    useSearchParams: () => {
      const setParams = (next: Record<string, string> | ((p: URLSearchParams) => URLSearchParams)) => {
        if (typeof next === 'function') {
          params = next(params);
        } else {
          params = new URLSearchParams(next);
        }
        // Force re-render by triggering a state update via the test environment
        if (testRender) {
          // No-op; React will re-render on the next state update
        }
      };
      return [params, setParams] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k }),
  initReactI18next: { type: '3rdParty' },
}))
vi.mock('../../lib/i18n', () => ({
  default: { get language() { return 'en'; } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children, role }: { children: React.ReactNode; role: string }) => <div data-testid="layout" data-role={role}>{children}</div>,
}));
vi.mock('../../components/action-center/ActionCenterShell', () => ({
  default: ({ children, title, primaryAction }: { children: React.ReactNode; title: string; primaryAction?: React.ReactNode }) => (
    <section data-testid="action-center-shell">
      <nav aria-label="Action Center"><span>Approvals</span></nav>
      <h1>{title}</h1>
      {primaryAction}
      {children}
    </section>
  ),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: {
    admin: {
      pendingApprovals: () => ['admin', 'pending-approvals'],
      pendingApprovalsSummary: () => ['admin', 'pending-approvals', 'summary'],
    },
    approvals: {
      all: ['approvals'],
      counts: () => ['approvals', 'counts'],
      list: (_type?: string, status?: string) => ['approvals', 'list', status ?? 'pending'],
    },
  },
}));

const mockData = {
  approvals: [
    { id: 'AP-001', type: 'discount', requestedBy: 'Karim', department: 'Reception', amount: 1000, reason: 'Patient hardship', submittedAt: '2026-06-11T10:30:00Z', risk: 'low', status: 'pending' },
    { id: 'AP-002', type: 'refund', requestedBy: 'Rina', department: 'Billing', amount: 2500, reason: 'Service not rendered', submittedAt: '2026-06-11T09:00:00Z', risk: 'medium', status: 'pending' },
    { id: 'AP-003', type: 'expense', requestedBy: 'Mitu', department: 'Admin', amount: 5000, reason: 'Emergency purchase', submittedAt: '2026-06-10T16:00:00Z', risk: 'high', status: 'pending' },
    { id: 'AP-004', type: 'discount', requestedBy: 'Hasan', department: 'Pharmacy', amount: 500, reason: 'Staff discount', submittedAt: '2026-06-11T11:00:00Z', risk: 'low', status: 'pending' },
    { id: 'AP-005', type: 'bill_cancellation', requestedBy: 'Admin', department: 'Billing', amount: 8000, reason: 'Duplicate invoice', submittedAt: '2026-06-10T14:00:00Z', risk: 'high', status: 'pending' },
    { id: 'AP-006', type: 'stock_adjustment', requestedBy: 'Store', department: 'Inventory', amount: 3000, reason: 'Damaged goods', submittedAt: '2026-06-11T08:00:00Z', risk: 'medium', status: 'pending' },
    { id: 'AP-007', type: 'doctor_payout', requestedBy: 'Accounts', department: 'Finance', amount: 15000, reason: 'Monthly commission', submittedAt: '2026-06-10T10:00:00Z', risk: 'low', status: 'pending' },
  ],
  summary: { totalPending: 7, highPriority: 2, olderThan24h: 2, todayApproved: 12 },
};

describe('PendingApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationImpl = null;
    bulkMutationImpl = null;
    mutationRegistrations = [];
    mutationInvocations = [];
    vi.mocked(useApiMutation).mockImplementation(((method: string, pathOrFn: any, opts: any) => {
      mutationRegistrations.push({ method, pathOrFn });
      const previewPath = typeof pathOrFn === 'function' ? pathOrFn({ id: 'preview', action: 'approve', ids: [] }) : pathOrFn;
      const isBulk = method === 'post' && previewPath === '/api/approvals/bulk-review';
      const mutate = isBulk
        ? (vars: any) => {
            bulkMutationImpl = vars;
            mockBulkMutate(vars);
            if (opts?.onSuccess) opts.onSuccess({ data: { requested: vars.ids.length, succeeded: vars.ids.length, failed: 0, failedIds: [], status: vars.action === 'approve' ? 'approved' : 'rejected' } });
          }
        : (vars: any) => {
            mutationImpl = vars;
            const path = typeof pathOrFn === 'function' ? pathOrFn(vars) : pathOrFn;
            mutationInvocations.push({ path, vars });
            mockMutate(vars);
            if (opts?.onSuccess) opts.onSuccess({});
          };
      return { mutate, isPending: false };
    }) as never);
  });

  it('renders embedded inside the Action Center shell without a nested dashboard layout', () => {
    vi.mocked(useApiQuery).mockImplementation((_key: unknown, path: string) => {
      if (path === '/api/approvals/summary') {
        return {
          data: {
            data: {
              totalPending: 0,
              highPriority: 0,
              olderThan24h: 0,
              dueSoon: 0,
              todayApproved: 0,
              rejectedToday: 0,
              cashHandoverPending: 0,
              expensePending: 0,
              missingEvidence: 0,
              executionFailed: 0,
              infoRequested: 0,
              infoSubmitted: 0,
              blocked: 0,
              actionable: 0,
              totalPendingAmount: 0,
              averageAgeMinutes: 0,
              oldestPendingMinutes: 0,
              oldestPendingAt: null,
              pendingByType: {},
            },
          },
          isLoading: false,
        } as never;
      }
      if (path.endsWith('/events')) {
        return { data: { data: [] }, isLoading: false } as never;
      }
      return {
        data: { data: [], pagination: { page: 1, limit: 50, total: 0 } },
        isLoading: false,
      } as never;
    });

    render(<PendingApprovals embedded />);

    expect(screen.getByRole('navigation', { name: /action center/i })).toBeInTheDocument();
    expect(screen.getByTestId('action-center-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('layout')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Status: Pending/i })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1, name: /Approval Center|Pending Approvals|Approvals/i })).toHaveLength(1);
  });

  it('opens the failed-execution recovery queue across pending and approved requests', () => {
    const requestedPaths: string[] = [];
    vi.mocked(useApiQuery).mockImplementation((_key: unknown, path: string) => {
      requestedPaths.push(path);
      if (path === '/api/approvals/summary') {
        return {
          data: {
            data: {
              totalPending: 0,
              highPriority: 0,
              olderThan24h: 0,
              dueSoon: 0,
              todayApproved: 0,
              rejectedToday: 0,
              cashHandoverPending: 0,
              expensePending: 0,
              missingEvidence: 0,
              executionFailed: 1,
              infoRequested: 0,
              infoSubmitted: 0,
              blocked: 0,
              actionable: 0,
              totalPendingAmount: 0,
              averageAgeMinutes: 0,
              oldestPendingMinutes: 0,
              oldestPendingAt: null,
              pendingByType: {},
            },
          },
          isLoading: false,
        } as never;
      }
      if (path.endsWith('/events')) return { data: { data: [] }, isLoading: false } as never;
      return { data: { data: [], pagination: { page: 1, limit: 50, total: 0 } }, isLoading: false } as never;
    });

    render(<PendingApprovals embedded />);
    fireEvent.click(screen.getByRole('button', { name: 'Failed execution (1)' }));

    expect(requestedPaths.some((path) => path.includes('status=all') && path.includes('executionStatus=failed'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Failed execution (1)' }));
    const latestListPath = requestedPaths.filter((path) => path.startsWith('/api/approvals?')).at(-1) ?? '';
    expect(latestListPath).toContain('status=pending');
    expect(latestListPath).not.toContain('executionStatus=failed');
  });

  it.each([
    [undefined, 'hospital_admin'],
    ['md', 'md'],
    ['director', 'director'],
  ] as const)('renders inside the expected dashboard layout for %s', (role, expectedRole) => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { data: [], pagination: { total: 0 } },
      isLoading: false,
    } as never);

    render(<PendingApprovals role={role} />);

    expect(screen.getByTestId('layout')).toHaveAttribute('data-role', expectedRole);
  });

  it('uses the tenant approval endpoint and maps its response', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 17,
          type: 'refund',
          entity_id: 9,
          entity_no: 'CN-009',
          requested_by: 4,
          request_data: { amount: 750, reason: 'Duplicate payment', department: 'Billing' },
          status: 'pending',
          created_at: '2026-06-11T09:00:00Z',
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);

    expect(useApiQuery).toHaveBeenCalledWith(
      ['approvals', 'list', 'pending:1:'],
      '/api/approvals?status=pending&limit=50&page=1',
    );
    expect(useApiQuery).toHaveBeenCalledWith(
      ['admin', 'pending-approvals', 'summary'],
      '/api/approvals/summary',
    );
    // entityNo is used as a hint in requestData but row id is the canonical id
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('৳750.00')).toBeInTheDocument();
    expect(screen.getByText('Duplicate payment')).toBeInTheDocument();
  });


  it('maps refund cash-hold and item details into the reviewer drawer', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 0, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 0, pendingByType: { refund: 1 } } }, isLoading: false };
      }
      if (url.includes('/events')) return { data: { data: [] }, isLoading: false };
      return {
        data: {
          data: [{
            id: 55,
            type: 'refund',
            entity_id: 75,
            entity_no: 'INV-75',
            requested_by: 4,
            requested_by_name: 'Rina • reception',
            request_data: {
              refundKind: 'item_partial_refund',
              requestedRefundAmount: 800,
              reason: 'CBC was not performed',
              items: [{ invoiceItemId: 101, description: 'CBC Test', returnQuantity: 1, calculatedAmount: 800 }],
            },
            cash_hold: {
              id: 9,
              amount: 800,
              status: 'held',
              counter_session_id: 17,
              held_at: '2026-07-12 10:00:00',
              consumed_at: null,
              released_at: null,
              credit_note_id: null,
            },
            status: 'pending',
            created_at: '2026-07-12T10:00:00Z',
            approval_note_required: true,
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByRole('button', { name: 'Review approval 55' }));

    expect(screen.getByText('Pending approval — cash held')).toBeInTheDocument();
    expect(screen.queryByText('CBC Test')).not.toBeInTheDocument();
    expect(screen.queryByText(/Counter session #17/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /more details/i }));

    expect(screen.getByText('CBC Test')).toBeInTheDocument();
    expect(screen.getByText(/Counter session #17/i)).toBeInTheDocument();
  });

  it('uses source-safe row keys when different approval sources share the same numeric id', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 2, highPriority: 1, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 1 } }, isLoading: false };
      }
      return {
        data: {
          data: [
            {
              id: 77,
              approval_key: 'approval_requests:77',
              approval_source: 'approval_requests',
              type: 'discount',
              entity_id: 177,
              requested_by: 4,
              request_data: { amount: 500, reason: 'Core approval' },
              status: 'pending',
              created_at: '2026-06-11T09:00:00Z',
            },
            {
              id: 77,
              approval_key: 'billing_handovers:77',
              approval_source: 'billing_handovers',
              type: 'cash_handover',
              entity_id: 77,
              requested_by: 5,
              request_data: { amount: 1450, expectedAmount: 1500, countedAmount: 1450, variance: -50, receivedBy: 5, reason: 'Cash variance' },
              status: 'pending',
              created_at: '2026-06-11T10:00:00Z',
              evidence_status: 'provided',
            },
          ],
          pagination: { total: 2 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(consoleError.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    consoleError.mockRestore();
  });

  it('shows visible row actions and quick-approves a low-risk pending request', async () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 0, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 0 } }, isLoading: false };
      }
      return {
        data: {
          data: [{
            id: 88,
            type: 'discount',
            entity_id: 188,
            entity_no: 'INV-88',
            requested_by: 4,
            request_data: { amount: 500, reason: 'Approved policy discount', requestedBy: 'Nusrat' },
            status: 'pending',
            created_at: '2026-06-11T09:00:00Z',
            bulk_approve_allowed: true,
            approval_note_required: false,
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    expect(screen.getByRole('button', { name: 'Review approval 88' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quick approve approval 88' }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ id: '88', action: 'approve', notes: '' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['approvals'] });
  });

  it('allows quick approval and shows a warning when evidence is missing', async () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 0, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 0, missingEvidence: 1, executionFailed: 0 } }, isLoading: false };
      }
      return {
        data: {
          data: [{
            id: 188,
            type: 'discount',
            entity_id: 188,
            entity_no: 'INV-188',
            requested_by: 4,
            request_data: { amount: 500, reason: 'Reference discount', requestedBy: 'Nusrat' },
            status: 'pending',
            created_at: '2026-06-11T09:00:00Z',
            bulk_approve_allowed: true,
            approval_note_required: false,
            evidence_required: true,
            evidence_status: 'missing',
            policy_reason: 'High discount requires evidence',
            sla_due_at: '2026-06-11T13:00:00Z',
            assigned_role: 'manager',
            can_current_user_approve: true,
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    const quickApprove = screen.getByRole('button', { name: 'Quick approve approval 188' });
    expect(quickApprove).not.toBeDisabled();
    expect(screen.getAllByText(/Missing evidence/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('High discount requires evidence')).toBeInTheDocument();

    fireEvent.click(quickApprove);
    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({ id: '188', action: 'approve', notes: '' }));

    fireEvent.click(screen.getByRole('button', { name: 'Review approval 188' }));
    expect(screen.getByText('Policy & Evidence')).toBeInTheDocument();
    expect(screen.getAllByText(/warning, not an approval blocker/i).length).toBeGreaterThanOrEqual(1);
    const approveButtons = screen.getAllByRole('button', { name: 'Record first approval' });
    expect(approveButtons.every((button) => !button.hasAttribute('disabled'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Please upload reference evidence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return and start revision 2' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockMutate).toHaveBeenCalledWith({
      id: '188',
      type: 'discount',
      notes: 'Please upload reference evidence',
      missingItems: [],
    });
  });

  it('shows 1/2 progress and prevents the same reviewer from approving twice', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 0, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 0, missingEvidence: 0, executionFailed: 0 } }, isLoading: false };
      }
      return {
        data: {
          data: [{
            id: 190,
            type: 'discount',
            entity_id: 190,
            entity_no: 'INV-190',
            requested_by: 4,
            request_data: { amount: 500, reason: 'First reviewer completed', requestedBy: 'Nusrat' },
            status: 'partially_approved',
            created_at: '2026-06-11T09:00:00Z',
            bulk_approve_allowed: true,
            approval_note_required: false,
            approval_count: 1,
            required_approvals: 2,
            remaining_approvals: 1,
            approval_stage: 'Partially Approved (1/2)',
            current_user_approved: true,
            can_current_user_approve: false,
            approval_blocked_reason: 'You already approved this request',
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    expect(screen.getAllByText('Partially Approved (1/2)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('You already approved this request').length).toBeGreaterThanOrEqual(1);
    const quickApprove = screen.getByRole('button', { name: 'Quick approve approval 190' });
    expect(quickApprove).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Review approval 190' }));
    expect(screen.getAllByText('Partially Approved (1/2)').length).toBeGreaterThanOrEqual(1);
    const approveButtons = screen.queryAllByRole('button', { name: 'Approve' });
    expect(approveButtons.length === 0 || approveButtons.every((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('maps receivable write-off minor-unit evidence and enforces requester separation', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 1, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 0, missingEvidence: 0, executionFailed: 0 } }, isLoading: false };
      }
      if (url.endsWith('/events')) return { data: { data: [] }, isLoading: false };
      return {
        data: {
          data: [{
            id: 191,
            type: 'receivable_write_off',
            entity_id: 44,
            entity_no: 'INV-101',
            requested_by: 7,
            requested_by_name: 'Collection Manager',
            request_data: {
              amountMinor: 3000,
              currencyCode: 'BDT',
              liveDueMinorAtRequest: 8000,
              authorityModeAtRequest: 'legacy',
              reasonCode: 'uncollectible',
              note: 'Repeated documented follow-ups did not produce payment.',
              evidenceUrls: ['https://evidence.example/write-off/191'],
              sourceEvidence: {
                sourceKey: 'legacy-bill:101',
                invoiceNumber: 'INV-101',
                patientId: 1,
                totalMinor: 10000,
                paidMinor: 2000,
                creditedMinor: 0,
                dueMinor: 8000,
                financialStatus: 'open',
              },
            },
            status: 'pending',
            created_at: '2026-07-23T04:00:00Z',
            approval_risk: 'high',
            bulk_approve_allowed: false,
            approval_note_required: true,
            approval_count: 0,
            required_approvals: 2,
            remaining_approvals: 2,
            approval_stage: 'Pending (0/2)',
            current_user_approved: false,
            can_current_user_approve: false,
            approval_blocked_reason: 'The requester cannot approve their own write-off request',
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    expect(screen.getAllByText(/BDT.*30\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Collections')).toBeInTheDocument();
    expect(screen.getAllByText(/requester cannot approve/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Quick approve approval 191' })).toBeDisabled();
  });

  it('blocks approval when execution failed and surfaces recovery guidance', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 0, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 0, missingEvidence: 0, executionFailed: 1 } }, isLoading: false };
      }
      return {
        data: {
          data: [{
            id: 189,
            type: 'discount',
            entity_id: 189,
            entity_no: 'INV-189',
            requested_by: 4,
            request_data: { amount: 800, reason: 'Wrong receipt', requestedBy: 'Nusrat' },
            status: 'pending',
            created_at: '2026-06-11T09:00:00Z',
            approval_note_required: false,
            execution_status: 'failed',
            execution_error: 'Payment already reconciled',
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    const quickApprove = screen.getByRole('button', { name: 'Quick approve approval 189' });
    expect(quickApprove).toBeDisabled();
    expect(screen.getByText('Review: Execution failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review approval 189' }));
    expect(screen.getByText('Retry or investigate the failed execution before making a new decision.')).toBeInTheDocument();
    expect(screen.getAllByText('Execution failed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Record first approval' })).toBeDisabled();
  });

  it('requires drawer review instead of quick-approve for cash handover approvals', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 0, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 1 } }, isLoading: false };
      }
      return {
        data: {
          data: [{
            id: 77,
            type: 'cash_closing',
            entity_id: 77,
            entity_no: 'HND-77',
            requested_by: 4,
            request_data: { amount: 1500, expectedAmount: 1500, countedAmount: 1500, reason: 'Final cash handover review' },
            status: 'pending',
            created_at: '2026-06-11T09:00:00Z',
            bulk_approve_allowed: false,
            approval_note_required: true,
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    const quickApprove = screen.getByRole('button', { name: 'Quick approve approval 77' });
    expect(quickApprove).toBeDisabled();
    fireEvent.click(quickApprove);
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('Review: Note required')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review approval 77' }));
    expect(screen.getByText('Decision Checklist')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Return for correction' }).length).toBeGreaterThan(0);
  });

  it('opens the drawer from the visible review action without changing approval status', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 89,
          type: 'refund',
          entity_id: 189,
          entity_no: 'RCP-89',
          requested_by: 4,
          request_data: { amount: 900, reason: 'Refund needs admin note' },
          status: 'pending',
          created_at: '2026-06-11T09:00:00Z',
          approval_note_required: true,
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByRole('button', { name: 'Review approval 89' }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /more details/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByText('Refund needs admin note')).toHaveLength(2);
    expect(screen.getByText('Collection reduction')).toBeInTheDocument();
  });

  it('uses the backend summary endpoint for KPI totals when available', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return {
          data: { data: { totalPending: 9, highPriority: 4, olderThan24h: 3, todayApproved: 2, rejectedToday: 1, cashHandoverPending: 5 } },
          isLoading: false,
        };
      }
      return {
        data: { data: [], pagination: { total: 0 } },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    expect(screen.getByRole('button', { name: /pendingApprovals.summary.totalPending/i })).toHaveTextContent('9');
    expect(screen.getByRole('button', { name: /pendingApprovals.summary.highPriority/i })).toHaveTextContent('4');
    expect(screen.getAllByRole('button', { name: /SLA Breached/i })[0]).toHaveTextContent('3');
  });

  it('maps legacy approval amounts from nested request_data values', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [
          {
            id: 41,
            type: 'bill_cancel',
            entity_id: 141,
            entity_no: 'BILL-141',
            requested_by: 7,
            request_data: { reason: 'Wrong bill', oldValue: { totalAmount: 2450 } },
            status: 'pending',
            created_at: '2026-06-11T09:00:00Z',
          },
          {
            id: 42,
            type: 'refund',
            entity_id: 142,
            entity_no: 'RCP-142',
            requested_by: 8,
            request_data: { reason: 'Wrong payment', oldValue: { amount: 900 } },
            status: 'pending',
            created_at: '2026-06-11T09:05:00Z',
          },
        ],
        pagination: { total: 2 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);

    expect(screen.getByText('৳2,450.00')).toBeInTheDocument();
    expect(screen.getByText('৳900.00')).toBeInTheDocument();
  });

  it('maps credit discharge minor-unit evidence into a dedicated individual-review row', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 501,
          type: 'credit_discharge',
          entity_id: 22,
          entity_no: 'ADM-000022',
          requested_by: 7,
          requested_by_name: 'Reception User',
          request_data: {
            patientName: 'Marufa Begum',
            admissionNo: 'ADM-000022',
            currentInvoiceNo: 'BL-000090',
            totalDueMinor: 670000,
            creditReason: 'Guardian will pay after salary',
            expectedPaymentDate: '2026-07-25',
            actionState: 'executed_pending_review',
          },
          status: 'pending',
          approval_note_required: true,
          bulk_approve_allowed: false,
          created_at: '2026-07-19T06:00:00Z',
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);

    expect(screen.getByRole('button', { name: /^Credit Discharge$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Credit Discharge/i).length).toBeGreaterThan(0);
    expect(screen.getByText('৳6,700.00')).toBeInTheDocument();
    expect(screen.getAllByText('Marufa Begum').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Guardian will pay after salary').length).toBeGreaterThan(0);
    expect(screen.queryByRole('checkbox', { name: /select approval/i })).not.toBeInTheDocument();
  });

  it('keeps pending KPI counts stable when switching to today approved rows', () => {
    const pendingData = {
      data: [
        { id: 1, type: 'refund', entity_id: 1, requested_by: 4, request_data: { amount: 100, reason: 'Pending 1' }, status: 'pending', created_at: '2026-06-11T09:00:00Z' },
        { id: 2, type: 'bill_cancel', entity_id: 2, requested_by: 4, request_data: { amount: 12000, reason: 'Pending 2' }, status: 'pending', created_at: '2026-06-10T09:00:00Z' },
        { id: 3, type: 'discount', entity_id: 3, requested_by: 4, request_data: { amount: 300, reason: 'Pending 3' }, status: 'pending', created_at: '2026-06-11T10:00:00Z' },
      ],
      pagination: { total: 3 },
    };
    const approvedData = {
      data: [
        { id: 4, type: 'refund', entity_id: 4, requested_by: 4, request_data: { amount: 500, reason: 'Approved today' }, status: 'approved', created_at: '2026-06-11T11:00:00Z' },
      ],
      pagination: { total: 1 },
    };
    vi.mocked(useApiQuery).mockImplementation(((_key: any, url: any) => ({
      data: String(url).includes('status=approved') ? approvedData : pendingData,
      isLoading: false,
    })) as never);

    render(<PendingApprovals />);
    expect(screen.getByRole('button', { name: /totalPending/i })).toHaveTextContent('3');

    fireEvent.click(screen.getByRole('button', { name: /todayApproved/i }));

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /totalPending/i })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /todayApproved/i })).toHaveTextContent('1');
  });



  it('renders approval center status views and queries approved rejected and history statuses', () => {
    const calls: string[] = [];
    vi.mocked(useApiQuery).mockImplementation(((_key: any, url: any) => {
      calls.push(String(url));
      return {
        data: {
          data: [{ id: 11, type: 'discount', entity_id: 11, entity_no: 'INV-11', requested_by: 4, request_data: { amount: 100, reason: 'Status check' }, status: String(url).includes('rejected') ? 'rejected' : 'pending', created_at: '2026-06-11T09:00:00Z' }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);

    expect(screen.getByRole('button', { name: 'Status: Pending' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Status: Approved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Status: Rejected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Status: All History' }));

    expect(calls).toContain('/api/approvals?status=pending&limit=50&page=1');
    expect(calls).toContain('/api/approvals?status=approved&limit=50&page=1');
    expect(calls).toContain('/api/approvals?status=rejected&limit=50&page=1');
    expect(calls).toContain('/api/approvals?status=all&limit=50&page=1');
  });

  it('shows rich approval references and cash handover context in the table', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 77,
          type: 'cash_closing',
          entity_id: 77,
          entity_no: 'HND-77',
          requested_by: 2,
          request_data: {
            expectedAmount: 5000,
            countedAmount: 4800,
            variance: -200,
            cashierName: 'Rina Cashier',
            receiverName: 'Admin Sir',
            reason: 'Shift close handover',
            department: 'Cash Control',
          },
          status: 'pending',
          created_at: '2026-06-23T10:15:00Z',
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);

    expect(screen.getAllByText('Cash Handover').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('HND-77')).toBeInTheDocument();
    expect(screen.getByText(/Expected ৳5,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/Counted ৳4,800.00/)).toBeInTheDocument();
    expect(screen.getByText(/Variance -৳200.00|Variance ৳-200.00/)).toBeInTheDocument();
  });

  it('opens a rich drawer with before after values and read-only history state', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 88,
          type: 'bill_cancel',
          entity_id: 188,
          entity_no: 'BILL-188',
          requested_by: 7,
          request_data: {
            reason: 'Wrong duplicate bill',
            patientName: 'Abdul Karim',
            oldValue: { status: 'paid', totalAmount: 2450 },
            newValue: { status: 'cancel_requested' },
          },
          status: 'approved',
          created_at: '2026-06-11T09:00:00Z',
          reviewed_at: '2026-06-11T10:00:00Z',
          reviewed_by: 3,
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByText('88'));

    expect(screen.getAllByText('BILL-188').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Abdul Karim').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Before/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/paid/i)).toBeInTheDocument();
    expect(screen.getByText(/cancel_requested/i)).toBeInTheDocument();
    expect(screen.getByText(/Read-only history/i)).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('submits approval decisions through the audited review endpoint', async () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 17,
          type: 'refund',
          entity_id: 9,
          entity_no: 'CN-009',
          requested_by: 4,
          request_data: { amount: 750, reason: 'Duplicate payment' },
          status: 'pending',
          created_at: '2026-06-11T09:00:00Z',
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByText('17'));
    fireEvent.click(screen.getByRole('button', { name: 'Record first approval' }));
    fireEvent.change(screen.getByLabelText('Approval note'), { target: { value: 'Verified duplicate payment evidence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm record first approval' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockMutate).toHaveBeenCalledWith({
      id: '17',
      type: 'refund',
      action: 'approve',
      notes: 'Verified duplicate payment evidence',
      decision: 'approve',
      remarks: 'Verified duplicate payment evidence',
    });
  });

  it('submits executed refund rejection with dispute resolution and a revision-stable idempotency key', async () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 83,
          type: 'refund',
          entity_id: 75,
          entity_no: 'INV-83',
          requested_by: 4,
          request_data: {
            amount: 400,
            reason: 'Duplicate service refund',
            executionMode: 'executed_pending',
            financialState: 'refunded_pending_review',
            approvalRevision: 3,
          },
          cash_hold: {
            id: 10,
            amount: 400,
            status: 'consumed',
            counter_session_id: 17,
            cash_return_eligible: true,
          },
          status: 'partially_approved',
          execution_status: 'succeeded',
          approval_revision: 3,
          approval_count: 1,
          required_approvals: 2,
          remaining_approvals: 1,
          created_at: '2026-07-26T10:00:00Z',
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByText('83'));
    expect(screen.getByText('Refund completed — awaiting review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject & reverse refund' }));
    expect(screen.getByRole('radio', { name: /cash already returned/i })).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Refund evidence is invalid.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject and reverse refund' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mutationInvocations.at(-1)).toEqual({
      path: '/api/approvals/83/review',
      vars: {
        id: '83',
        type: 'refund',
        action: 'reject',
        notes: 'Refund evidence is invalid.',
        decision: 'reject',
        remarks: 'Refund evidence is invalid.',
        cashResolution: 'open_dispute',
        cashReturnedAcknowledged: false,
        idempotencyKey: 'refund-reject:83:r3',
      },
    });
  });

  it('routes cash handover approvals to the billing counter final verification endpoint', async () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 700,
          approval_source: 'billing_handovers',
          type: 'cash_handover',
          entity_id: 77,
          entity_no: 'Cash handover #77',
          requested_by: 2,
          request_data: { amount: 1500, reason: 'Cash handover waiting for admin final verification', department: 'Cash Control' },
          status: 'pending',
          created_at: '2026-06-23T10:15:00Z',
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);
    const handoverRegistration = mutationRegistrations.find((registration) => (
      registration.method === 'post'
      && typeof registration.pathOrFn === 'function'
      && registration.pathOrFn({ id: '77' }) === '/api/billing-counter/handovers/77/admin-verify'
    ));
    expect(handoverRegistration).toBeTruthy();

    fireEvent.click(screen.getByText('700'));
    fireEvent.click(screen.getByRole('button', { name: 'Record first approval' }));
    fireEvent.change(screen.getByLabelText('Approval note'), { target: { value: 'Receiver count verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm record first approval' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockMutate).toHaveBeenCalledWith({
      id: '77',
      type: 'cash_handover',
      source: 'billing_handovers',
      action: 'approve',
      notes: 'Receiver count verified',
      decision: 'approve',
      remarks: 'Receiver count verified',
    });
    expect(mutationInvocations.at(-1)?.path).toBe('/api/billing-counter/handovers/77/admin-verify');
  });

  it('loads and displays the structured handover verification timeline', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 1, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 1 } }, isLoading: false };
      }
      if (url === '/api/approvals/handovers/77/events') {
        return {
          data: {
            data: [{
              id: 1,
              action: 'receiver_disputed',
              actor_id: 5,
              actor_name: 'Receiver User',
              new_status: 'pending',
              notes: 'Cash is short',
              metadata: { actorRole: 'reception', expectedAmount: 1500, countedAmount: 1450, variance: -50, decision: 'dispute' },
              created_at: '2026-07-14T02:30:00Z',
            }],
          },
          isLoading: false,
        };
      }
      return {
        data: {
          data: [{
            id: 700,
            approval_key: 'billing_handovers:700',
            approval_source: 'billing_handovers',
            type: 'cash_handover',
            entity_id: 77,
            entity_no: 'Cash handover #77',
            requested_by: 2,
            request_data: { amount: 1450, expectedAmount: 1500, countedAmount: 1450, variance: -50, receivedBy: 5, reason: 'Cash variance/dispute requires admin decision', department: 'Cash Control' },
            status: 'pending',
            created_at: '2026-07-14T02:15:00Z',
            evidence_status: 'provided',
            approval_note_required: true,
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByText('700'));

    expect(vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]))).toContain('/api/approvals/handovers/77/events');
    expect(screen.getByText(/receiver disputed: Cash is short.*Expected.*Counted.*Variance/i)).toBeInTheDocument();
    expect(screen.getByText(/Receiver User.*reception/i)).toBeInTheDocument();
  });

  it('routes a core cash-closing approval through the approval request endpoint', async () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url === '/api/approvals/summary') {
        return { data: { data: { totalPending: 1, highPriority: 1, olderThan24h: 0, todayApproved: 0, rejectedToday: 0, cashHandoverPending: 1 } }, isLoading: false };
      }
      return {
        data: {
          data: [{
            id: 707,
            approval_source: 'approval_requests',
            type: 'cash_closing',
            entity_id: 77,
            entity_no: 'CASH-707',
            requested_by: 2,
            request_data: { amount: 1500, reason: 'Legacy cash closing variance approval', department: 'Cash Control' },
            status: 'pending',
            created_at: '2026-06-23T10:15:00Z',
            approval_risk: 'high',
            evidence_status: 'provided',
            approval_note_required: true,
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
    }) as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByText('707'));
    fireEvent.click(screen.getByRole('button', { name: 'Record first approval' }));
    fireEvent.change(screen.getByLabelText('Approval note'), { target: { value: 'Legacy approval verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm record first approval' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mutationInvocations.at(-1)).toEqual({
      path: '/api/approvals/707/review',
      vars: {
        id: '707',
        type: 'cash_handover',
        source: 'approval_requests',
        action: 'approve',
        notes: 'Legacy approval verified',
        decision: 'approve',
        remarks: 'Legacy approval verified',
      },
    });
  });

  it('routes expense approvals to the expense approval endpoint', async () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 501,
          type: 'expense',
          entity_id: 501,
          entity_no: 'EXP-501',
          requested_by: 4,
          request_data: { source: 'expenses', amount: 1500, reason: 'Ambulance fuel', category: 'Fuel', department: 'Cash & Finance' },
          status: 'pending',
          created_at: '2026-06-11T09:00:00Z',
          approval_note_required: true,
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);
    expect(screen.getByText('EXP-501 - expense')).toBeInTheDocument();
    fireEvent.click(screen.getByText('501'));
    fireEvent.click(screen.getByRole('button', { name: 'Record first approval' }));
    fireEvent.change(screen.getByLabelText('Approval note'), { target: { value: 'Receipt verified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm record first approval' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockMutate).toHaveBeenCalledWith({ id: '501', type: 'expense', action: 'approve', notes: 'Receipt verified' });
  });

  it('does not request approval_events for expense-source approvals', () => {
    vi.mocked(useApiQuery).mockImplementation(((key: any, url: any, options?: any) => {
      if (String(url).startsWith('/api/approvals?')) return {
        data: {
          data: [{
            id: 501,
            type: 'expense',
            entity_id: 501,
            entity_no: 'EXP-501',
            requested_by: 4,
            request_data: { source: 'expenses', amount: 1500, reason: 'Ambulance fuel', category: 'Fuel', department: 'Cash & Finance' },
            status: 'pending',
            created_at: '2026-06-11T09:00:00Z',
          }],
          pagination: { total: 1 },
        },
        isLoading: false,
      };
      if (String(url).includes('/events')) return { data: { data: [] }, isLoading: false, options };
      return { data: undefined, isLoading: false };
    }) as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByText('501'));

    const eventCall = vi.mocked(useApiQuery).mock.calls.find((call) => String(call[1]).includes('/events'));
    expect(eventCall?.[2]).toMatchObject({ enabled: false });
  });

  it('renders with layout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('shows page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    expect(screen.getByText('Approval Center')).toBeInTheDocument();
  });

  it('renders the approval cockpit with status, value, and session sections', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);

    expect(screen.getByText('Approval Status')).toBeInTheDocument();
    expect(screen.getByText('Queue health at a glance')).toBeInTheDocument();
    expect(screen.getByText('Pending Value')).toBeInTheDocument();
    expect(screen.getByText('Financial exposure by approval type')).toBeInTheDocument();
    expect(screen.getByText('This Session')).toBeInTheDocument();
    expect(screen.getByText('Resolved vs remaining')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review queue/i })).toBeInTheDocument();
    const pendingValueCard = screen.getByText('Pending Value').closest('section');
    expect(pendingValueCard).toBeTruthy();
    expect(within(pendingValueCard as HTMLElement).getByText(/Value ৳35,000.00/i)).toBeInTheDocument();
  });

  it('filters the worklist from the approval cockpit type distribution', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);

    const pendingValueCard = screen.getByText('Pending Value').closest('section');
    expect(pendingValueCard).toBeTruthy();
    fireEvent.click(within(pendingValueCard as HTMLElement).getByRole('button', { name: /Refund/i }));

    expect(screen.getByText('AP-002')).toBeInTheDocument();
    expect(screen.queryByText('AP-001')).not.toBeInTheDocument();
    expect(screen.queryByText('AP-003')).not.toBeInTheDocument();
  });

  it('shows clickable summary cards', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    expect(screen.getByRole('button', { name: /pendingApprovals.summary.totalPending/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pendingApprovals.summary.totalPending/i })).toHaveTextContent('7');
    expect(screen.getByRole('button', { name: /pendingApprovals.summary.highPriority/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /SLA Breached/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Missing Evidence/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /Failed Execution/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /pendingApprovals.summary.todayApproved/i })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('keeps the five primary decision cards on a responsive grid', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);

    const totalPendingCard = screen.getByRole('button', { name: /pendingApprovals.summary.totalPending/i });
    const summaryGrid = totalPendingCard.parentElement;

    expect(summaryGrid).toBeTruthy();
    expect(summaryGrid?.className).toContain('grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]');
    expect(summaryGrid?.querySelectorAll('[role="button"]')).toHaveLength(5);
    expect(screen.getByRole('button', { name: /pendingApprovals.summary.totalPending/i })).toHaveTextContent('7');
    expect(screen.getByRole('button', { name: /SLA breached \(2\)/i })).toBeInTheDocument();
  });

  it('filters details when a summary KPI is clicked', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    fireEvent.click(screen.getByRole('button', { name: /pendingApprovals.summary.highPriority/i }));
    expect(screen.getByText('AP-003')).toBeInTheDocument();
    expect(screen.getByText('AP-005')).toBeInTheDocument();
    expect(screen.queryByText('AP-001')).not.toBeInTheDocument();
  });

  it('shows human-readable type tabs instead of raw translation keys', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discount' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refund' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expense' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bill Cancel' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cash Handover' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Stock Adjustment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Doctor Payout' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Credit Note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manual Adjustment' })).toBeInTheDocument();
    expect(screen.queryByText('pendingApprovals.tabs.cashHandover')).not.toBeInTheDocument();
  });

  it('shows all approval rows by default', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    expect(screen.getByText('AP-001')).toBeInTheDocument();
    expect(screen.getByText('AP-002')).toBeInTheDocument();
    expect(screen.getByText('AP-003')).toBeInTheDocument();
    expect(screen.getByText('AP-004')).toBeInTheDocument();
    expect(screen.getByText('AP-005')).toBeInTheDocument();
    expect(screen.getByText('AP-006')).toBeInTheDocument();
    expect(screen.getByText('AP-007')).toBeInTheDocument();
  });

  it('filters by type when tab clicked', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }));
    expect(screen.getByText('AP-002')).toBeInTheDocument();
    expect(screen.queryByText('AP-001')).not.toBeInTheDocument();
    expect(screen.queryByText('AP-003')).not.toBeInTheDocument();
  });

  it('filters stock adjustment tab', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    fireEvent.click(screen.getByRole('button', { name: 'Stock Adjustment' }));
    expect(screen.getByText('AP-006')).toBeInTheDocument();
    expect(screen.queryByText('AP-001')).not.toBeInTheDocument();
  });

  it('filters doctor payout tab', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    fireEvent.click(screen.getByRole('button', { name: 'Doctor Payout' }));
    expect(screen.getByText('AP-007')).toBeInTheDocument();
    expect(screen.queryByText('AP-001')).not.toBeInTheDocument();
  });

  it('filters credit note tab and requires drawer review', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 301,
          type: 'credit_note',
          entity_id: 301,
          entity_no: 'CN-301',
          requested_by: 4,
          request_data: { amount: 1200, reason: 'Advance payment write-off', requestedBy: 'Accounts' },
          status: 'pending',
          created_at: '2026-06-11T09:00:00Z',
          approval_risk: 'low',
          approval_note_required: true,
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);
    fireEvent.click(screen.getByRole('button', { name: 'Credit Note' }));

    expect(vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]))).toContain('/api/approvals?status=pending&limit=50&page=1&type=credit_note');
    expect(screen.getByText('301')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick approve approval 301' })).toBeDisabled();
    expect(screen.getByText('Review: Note required')).toBeInTheDocument();
  });

  it('shows and filters needs-info approvals', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 401,
          type: 'discount',
          entity_id: 401,
          entity_no: 'INV-401',
          requested_by: 4,
          request_data: { amount: 900, reason: 'Needs proof', requestedBy: 'Reception' },
          status: 'pending',
          created_at: '2026-06-11T09:00:00Z',
          approval_risk: 'low',
          approval_note_required: false,
          info_request_status: 'requested',
          info_requested_at: '2026-06-11T10:00:00Z',
          info_requested_by: 9,
          info_request_note: 'Please upload discount reference',
          info_missing_items: ['reference document'],
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
    } as never);

    render(<PendingApprovals />);

    expect(screen.getByRole('button', { name: /Needs info \(1\)/i })).toBeInTheDocument();
    expect(screen.getAllByText('Needs info').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Quick approve approval 401' })).toBeDisabled();
    expect(screen.getByText('Review: Needs info')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review approval 401' }));
    expect(screen.getByText('Information Request')).toBeInTheDocument();
    expect(screen.getByText('Please upload discount reference')).toBeInTheDocument();
    expect(screen.getByText('User #9')).toBeInTheDocument();
    expect(screen.getByText('reference document')).toBeInTheDocument();
  });

  it('shows risk badges', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    expect(screen.getAllByText('low').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('medium').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('high').length).toBeGreaterThanOrEqual(1);
  });

  it('shows table columns', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    expect(screen.getByText('pendingApprovals.table.requestId')).toBeInTheDocument();
    expect(screen.getByText('pendingApprovals.table.type')).toBeInTheDocument();
    expect(screen.getByText('pendingApprovals.table.requestedBy')).toBeInTheDocument();
    expect(screen.getByText('pendingApprovals.table.department')).toBeInTheDocument();
    expect(screen.getByText('pendingApprovals.table.amount')).toBeInTheDocument();
    expect(screen.getByText('pendingApprovals.table.reason')).toBeInTheDocument();
    expect(screen.getByText('pendingApprovals.table.submittedAt')).toBeInTheDocument();
    expect(screen.getByText('pendingApprovals.table.risk')).toBeInTheDocument();
    expect(screen.getByText('pendingApprovals.table.status')).toBeInTheDocument();
  });

  it('opens drawer on row click', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
    render(<PendingApprovals />);
    fireEvent.click(screen.getByText('AP-001'));
    expect(screen.getByText('Request Summary')).toBeInTheDocument();
    expect(screen.getByText('Financial / Cash Context')).toBeInTheDocument();
  });

  it('shows empty state when no data', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: { approvals: [], summary: { totalPending: 0, highPriority: 0, olderThan24h: 0, todayApproved: 0 } }, isLoading: false });
    render(<PendingApprovals />);
    expect(screen.getByText('pendingApprovals.empty')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    render(<PendingApprovals />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(1);
  });

  describe('Bulk selection', () => {
    const apiRows = {
      data: [
        { id: 1, type: 'discount', entity_id: 100, entity_no: 'AP-001', requested_by: 4, request_data: { amount: 1000, reason: 'Test 1' }, status: 'pending', created_at: '2026-06-11T10:00:00Z' },
        { id: 2, type: 'refund', entity_id: 101, entity_no: 'AP-002', requested_by: 5, request_data: { amount: 2500, reason: 'Test 2' }, status: 'pending', created_at: '2026-06-11T10:00:00Z' },
        { id: 3, type: 'discount', entity_id: 102, entity_no: 'AP-003', requested_by: 6, request_data: { amount: 500, reason: 'Test 3' }, status: 'pending', created_at: '2026-06-11T10:00:00Z' },
      ],
      pagination: { total: 3 },
    };

    it('renders a checkbox column for each row', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: apiRows, isLoading: false } as never);
      render(<PendingApprovals />);
      const checkboxes = document.querySelectorAll('tbody input[type="checkbox"]');
      expect(checkboxes.length).toBe(2);
    });

    it('renders the bulk actions bar only when at least one row is selected', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: apiRows, isLoading: false } as never);
      const { container } = render(<PendingApprovals />);
      // Bulk bar should not be in DOM when 0 selected (it returns null)
      expect(container.querySelector('.fixed.bottom-6')).toBeNull();

      // Select one row
      const firstCheckbox = document.querySelectorAll('tbody input[type="checkbox"]')[0] as HTMLInputElement;
      fireEvent.click(firstCheckbox);
      expect(container.querySelector('.fixed.bottom-6')).toBeTruthy();
      expect(screen.getByText(/1\s+selected/)).toBeInTheDocument();
    });

    it('selecting all rows via header checkbox enables the bulk bar with full count', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: apiRows, isLoading: false } as never);
      render(<PendingApprovals />);
      const headerCheckbox = document.querySelector('thead input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(headerCheckbox);
      expect(screen.getByText(/2\s+selected/)).toBeInTheDocument();
    });

    it('clears selection when Clear button is clicked', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: apiRows, isLoading: false } as never);
      render(<PendingApprovals />);
      const checkboxes = document.querySelectorAll('tbody input[type="checkbox"]');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      expect(screen.getByText(/2\s+selected/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('Clear'));
      expect(screen.queryByText(/2\s+selected/)).toBeNull();
    });

    it('invokes bulk-review mutation with selected ids when Approve Selected is confirmed', async () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: apiRows, isLoading: false } as never);
      render(<PendingApprovals />);
      const checkboxes = document.querySelectorAll('tbody input[type="checkbox"]');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);

      fireEvent.click(screen.getByText('pendingApprovals.bulk.approveSelected'));
      fireEvent.click(screen.getByText('Confirm'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockBulkMutate).toHaveBeenCalledWith({
        ids: [1, 3],
        action: 'approve',
        notes: undefined,
      });
    });

    it('invokes bulk-review mutation with notes when Reject Selected is confirmed', async () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: apiRows, isLoading: false } as never);
      render(<PendingApprovals />);
      const checkboxes = document.querySelectorAll('tbody input[type="checkbox"]');
      fireEvent.click(checkboxes[0]);

      fireEvent.click(screen.getByText('pendingApprovals.bulk.rejectSelected'));
      fireEvent.click(screen.getByText('Confirm'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockBulkMutate).toHaveBeenCalledWith({
        ids: [1],
        action: 'reject',
        notes: 'Bulk rejection',
      });
    });

    it('does not call bulk-review when nothing is selected', () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: apiRows, isLoading: false } as never);
      render(<PendingApprovals />);
      expect(screen.queryByText('pendingApprovals.bulk.approveSelected')).toBeNull();
      expect(mockBulkMutate).not.toHaveBeenCalled();
    });

    it('invalidates queries and resets selection after successful bulk approval', async () => {
      vi.mocked(useApiQuery).mockReturnValue({ data: apiRows, isLoading: false } as never);
      render(<PendingApprovals />);
      const checkboxes = document.querySelectorAll('tbody input[type="checkbox"]');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(screen.getByText('pendingApprovals.bulk.approveSelected'));
      fireEvent.click(screen.getByText('Confirm'));

      expect(mockBulkMutate).toHaveBeenCalled();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(mockInvalidateQueries).toHaveBeenCalled();
      expect(screen.queryByText(/1\s+selected/)).toBeNull();
    });
  });

  describe('KPI drill-down', () => {
    const recentApprovalDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const staleApprovalDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const kpiPendingRows = [
      { id: 101, type: 'discount', entity_id: 101, entity_no: 'INV-101', requested_by: 4, request_data: { amount: 600, reason: 'Normal discount', requestedBy: 'Karim' }, status: 'pending', created_at: recentApprovalDate, approval_risk: 'low' },
      { id: 102, type: 'expense', entity_id: 102, entity_no: 'EXP-102', requested_by: 5, request_data: { amount: 15000, reason: 'Large emergency purchase', requestedBy: 'Rina' }, status: 'pending', created_at: staleApprovalDate, approval_risk: 'high' },
      { id: 103, type: 'cash_closing', entity_id: 103, entity_no: 'CASH-103', requested_by: 6, request_data: { amount: 2500, expectedAmount: 2500, countedAmount: 2500, reason: 'Counter close verification', requestedBy: 'Mitu' }, status: 'pending', created_at: recentApprovalDate, approval_risk: 'medium', approval_note_required: true },
      { id: 104, type: 'doctor_payout', entity_id: 104, entity_no: 'PAY-104', requested_by: 7, request_data: { amount: 9000, reason: 'Doctor payout review', requestedBy: 'Hasan' }, status: 'pending', created_at: staleApprovalDate, approval_risk: 'high' },
    ];
    const kpiApprovedRows = [
      { id: 201, type: 'discount', entity_id: 201, entity_no: 'INV-201', requested_by: 4, request_data: { amount: 400, reason: 'Approved discount', requestedBy: 'Karim' }, status: 'approved', created_at: '2026-06-26T08:00:00Z', reviewed_at: '2026-06-27T09:00:00Z', approval_risk: 'low' },
      { id: 202, type: 'refund', entity_id: 202, entity_no: 'REF-202', requested_by: 5, request_data: { amount: 800, reason: 'Approved refund', requestedBy: 'Rina' }, status: 'approved', created_at: '2026-06-26T09:00:00Z', reviewed_at: '2026-06-27T10:00:00Z', approval_risk: 'medium' },
    ];
    const kpiSummary = {
      totalPending: 4,
      highPriority: 2,
      olderThan24h: 2,
      cashHandoverPending: 1,
      todayApproved: 2,
      rejectedToday: 0,
    };

    function mockKpiQueries() {
      vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
        if (url === '/api/approvals/summary') return { data: { data: kpiSummary }, isLoading: false };
        const rows = url.includes('status=approved') ? kpiApprovedRows : kpiPendingRows;
        return { data: { data: rows, pagination: { total: rows.length, page: 1, limit: 50, totalPages: 1 } }, isLoading: false };
      }) as never);
    }

    function tableRowCount() {
      return document.querySelectorAll('tbody tr').length;
    }

    function kpiButton(name: RegExp) {
      return screen.getAllByRole('button', { name }).find((element) => String(element.getAttribute('class') ?? '').includes('card')) as HTMLElement;
    }

    function kpiValueFromButton(name: RegExp) {
      const card = kpiButton(name);
      return Number(card.querySelector('p[title]')?.textContent?.replace(/,/g, '') ?? NaN);
    }

    it('keeps primary decision cards and secondary filters in sync with drill-down rows', () => {
      mockKpiQueries();
      render(<PendingApprovals />);

      expect(kpiValueFromButton(/totalPending/i)).toBe(4);
      expect(tableRowCount()).toBe(4);

      fireEvent.click(screen.getByRole('button', { name: /highPriority/i }));
      expect(kpiValueFromButton(/highPriority/i)).toBe(2);
      expect(tableRowCount()).toBe(2);
      expect(Array.from(document.querySelectorAll('tbody tr')).every((row) => row.textContent?.toLowerCase().includes('high'))).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /totalPending/i }));
      expect(tableRowCount()).toBe(4);

      fireEvent.click(screen.getByRole('button', { name: /SLA breached \(2\)/i }));
      expect(tableRowCount()).toBe(2);
      expect(screen.getByText('102')).toBeInTheDocument();
      expect(screen.getByText('104')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /totalPending/i }));
      expect(tableRowCount()).toBe(4);

      fireEvent.click(kpiButton(/Cash (?:Handover|Variance)/i));
      expect(kpiValueFromButton(/Cash (?:Handover|Variance)/i)).toBe(1);
      expect(tableRowCount()).toBe(1);
      expect(screen.getByText('103')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /totalPending/i }));
      expect(tableRowCount()).toBe(4);

      fireEvent.click(screen.getByRole('button', { name: /todayApproved/i }));
      expect(kpiValueFromButton(/todayApproved/i)).toBe(2);
      expect(tableRowCount()).toBe(2);
      expect(screen.getByText('201')).toBeInTheDocument();
      expect(screen.getByText('202')).toBeInTheDocument();
    });

    it('sends KPI health filters to the server before paginating results', () => {
      mockKpiQueries();
      render(<PendingApprovals />);

      fireEvent.click(screen.getByRole('button', { name: /highPriority/i }));
      expect(vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]))).toContain('/api/approvals?status=pending&limit=50&page=1&queueFilter=high');

      fireEvent.click(screen.getByRole('button', { name: /totalPending/i }));
      fireEvent.click(screen.getAllByRole('button', { name: /SLA Breached/i })[0]);
      expect(vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]))).toContain('/api/approvals?status=pending&limit=50&page=1&queueFilter=sla_breached');

      fireEvent.click(screen.getByRole('button', { name: /totalPending/i }));
      fireEvent.click(screen.getAllByRole('button', { name: /Decision Blocked/i })[0]);
      expect(vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]))).toContain('/api/approvals?status=pending&limit=50&page=1&queueFilter=blocked');

      fireEvent.click(screen.getByRole('button', { name: /todayApproved/i }));
      expect(vi.mocked(useApiQuery).mock.calls.map((call) => String(call[1]))).toContain('/api/approvals?status=approved&limit=50&page=1&reviewedDate=today');
    });

    it('opens Cash Handover KPI as the unfiltered pending cash queue from any view', () => {
      mockKpiQueries();
      render(<PendingApprovals />);

      fireEvent.click(screen.getByRole('button', { name: /todayApproved/i }));
      expect(tableRowCount()).toBe(2);

      fireEvent.click(kpiButton(/Cash (?:Handover|Variance)/i));
      expect(tableRowCount()).toBe(1);
      expect(screen.getByText('103')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /totalPending/i }));
      fireEvent.click(screen.getByRole('button', { name: /highPriority/i }));
      expect(tableRowCount()).toBe(2);

      fireEvent.click(kpiButton(/Cash (?:Handover|Variance)/i));
      expect(tableRowCount()).toBe(1);
      expect(screen.getByText('103')).toBeInTheDocument();
    });

    it('renders the four summary cards as clickable buttons with aria-labels', () => {
      (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
      render(<PendingApprovals />);
      const totalBtn = screen.getByRole('button', { name: /pendingApprovals\.summary\.totalPending/i });
      const highBtn = screen.getByRole('button', { name: /pendingApprovals\.summary\.highPriority/i });
      const staleBtn = screen.getAllByRole('button', { name: /SLA Breached/i })[0];
      const approvedBtn = screen.getByRole('button', { name: /pendingApprovals\.summary\.todayApproved/i });
      expect(totalBtn).toBeInTheDocument();
      expect(highBtn).toBeInTheDocument();
      expect(staleBtn).toBeInTheDocument();
      expect(approvedBtn).toBeInTheDocument();
      // aria-pressed reflects active state — Total Pending starts active
      expect(totalBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('clicking the high-priority card filters the table to high-risk rows only', () => {
      (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
      render(<PendingApprovals />);
      fireEvent.click(screen.getByRole('button', { name: /highPriority/i }));
      // Active filter banner is shown
      expect(screen.getByText(/high-priority|SLA-breached/i)).toBeInTheDocument();
      // Only high-risk rows remain
      const rows = document.querySelectorAll('tbody tr');
      rows.forEach((row) => {
        expect(row.textContent?.toLowerCase()).toContain('high');
      });
    });

    it('clicking the stale card filters to requests older than 24 hours', () => {
      // Use stale-friendly mock data: all rows older than 24h
      (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
        data: {
          approvals: mockData.approvals.map((a) => ({ ...a, submittedAt: '2026-01-01T00:00:00Z' })),
          summary: { totalPending: 7, highPriority: 2, olderThan24h: 7, todayApproved: 0 },
        },
        isLoading: false,
      });
      render(<PendingApprovals />);
      fireEvent.click(screen.getAllByRole('button', { name: /SLA Breached/i })[0]);
      // All rows are stale, so the table is non-empty and the banner is up
      expect(screen.getByText(/high-priority|SLA-breached/i)).toBeInTheDocument();
      const rows = document.querySelectorAll('tbody tr');
      expect(rows.length).toBeGreaterThan(0);
    });

    it('clear-filter button resets the KPI drill-down', () => {
      (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockData, isLoading: false });
      render(<PendingApprovals />);
      fireEvent.click(screen.getByRole('button', { name: /highPriority/i }));
      expect(screen.getByText(/high-priority/i)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Clear filter'));
      expect(screen.queryByText(/high-priority/i)).toBeNull();
    });

    it('clicking the today-approved card applies and then clears the reviewed-today filter', () => {
      const calls: string[] = [];
      vi.mocked(useApiQuery).mockImplementation(((_key: any, url: any) => {
        if (typeof url === 'string') calls.push(url);
        return { data: mockData, isLoading: false };
      }) as never);
      render(<PendingApprovals />);
      expect(calls[0]).toContain('status=pending');

      const todayApproved = screen.getByRole('button', { name: /todayApproved/i });
      fireEvent.click(todayApproved);
      expect(calls.some((call) => call.includes('status=approved') && call.includes('reviewedDate=today'))).toBe(true);

      fireEvent.click(todayApproved);
      const latestPendingCall = calls.filter((call) => call.includes('status=pending')).at(-1);
      expect(latestPendingCall).toBeDefined();
      expect(latestPendingCall).not.toContain('reviewedDate=today');
    });

    it('manual status switching clears an active KPI filter', () => {
      const calls: string[] = [];
      vi.mocked(useApiQuery).mockImplementation(((_key: any, url: any) => {
        if (typeof url === 'string') calls.push(url);
        return { data: mockData, isLoading: false };
      }) as never);
      render(<PendingApprovals />);

      fireEvent.click(screen.getByRole('button', { name: /highPriority/i }));
      expect(calls.some((call) => call.includes('queueFilter=high'))).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'Status: Approved' }));
      const approvedCall = calls.filter((call) => call.includes('status=approved')).at(-1);
      expect(approvedCall).toBeDefined();
      expect(approvedCall).not.toContain('queueFilter=high');
    });
  });
});

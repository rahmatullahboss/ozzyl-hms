import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PendingRequestsSection from './PendingRequestsSection';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; count?: number }) => {
      const value = options?.defaultValue ?? _key;
      return value.replace('{{count}}', String(options?.count ?? ''));
    },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('../../lib/i18n', () => ({
  default: { language: 'en' },
}));

function renderSection(
  role: 'hospital_admin' | 'md' | 'director' = 'hospital_admin',
  window = { from: '2026-07-18', to: '2026-07-18' },
) {
  return render(
    <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
      <Routes>
        <Route path="/h/:slug/*" element={<PendingRequestsSection role={role} window={window} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PendingRequestsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({
      data: { data: [], pagination: { total: 0 } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useApiMutation).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    } as never);
  });

  it('queries pending requests created inside the selected window', () => {
    renderSection();

    expect(useApiQuery).toHaveBeenCalledWith(
      expect.arrayContaining(['pending-requests', 'hospital_admin', 'selected', '2026-07-18', '2026-07-18']),
      '/api/approvals?status=pending&page=1&limit=6&createdFrom=2026-07-18&createdTo=2026-07-18',
    );
  });

  it('switches to older pending requests', async () => {
    const user = userEvent.setup();
    renderSection('md', { from: '2026-07-12', to: '2026-07-18' });

    await user.click(screen.getByRole('button', { name: 'Past Pending Requests' }));

    expect(useApiQuery).toHaveBeenCalledWith(
      expect.arrayContaining(['pending-requests', 'md', 'past', '2026-07-12', '2026-07-18']),
      '/api/approvals?status=pending&page=1&limit=6&createdBefore=2026-07-12',
    );
  });

  it.each([
    ['hospital_admin', '/h/city-hospital/action/pending-approvals'],
    ['md', '/h/city-hospital/md/pending-approvals'],
    ['director', '/h/city-hospital/director/pending-approvals'],
  ] as const)('builds the %s full-page link', (role, href) => {
    renderSection(role);
    expect(screen.getByRole('link', { name: 'View Full Pending Review Page' })).toHaveAttribute('href', href);
  });

  it('renders pending request details, reason, and dashboard review action', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        data: [{
          id: 51,
          approval_key: 'expenses:51',
          type: 'expense',
          entity_no: 'EXP-51',
          requested_by: 7,
          requested_by_name: 'Rahim',
          created_at: '2026-07-18 09:30:00',
          approval_amount: 3500,
          approval_risk: 'medium',
          request_data: { reason: 'Office supplies' },
        }],
        pagination: { total: 1 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);

    renderSection('director');

    expect(screen.getByText('expense')).toBeInTheDocument();
    expect(screen.getByText(/EXP-51/)).toBeInTheDocument();
    expect(screen.getByText(/Rahim/)).toBeInTheDocument();
    expect(screen.getByText(/medium risk/i)).toBeInTheDocument();
    expect(screen.getByText('Office supplies')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument();
  });

  it('opens synthetic expense details from the list row without requesting an approval-request ID', async () => {
    const user = userEvent.setup();
    const expenseItem = {
      id: 7374,
      approval_key: 'expenses:7374',
      approval_source: 'expenses',
      type: 'expense',
      entity_id: 7374,
      entity_no: 'EXP-7374',
      requested_by: 7,
      requested_by_name: 'Safaat Ullah',
      created_at: '2026-07-28 12:01:00',
      approval_amount: 2100,
      approval_risk: 'low',
      status: 'pending',
      can_current_user_approve: true,
      request_data: {
        source: 'expenses',
        reason: 'Asique Sir Bazar',
        description: 'Asique Sir Bazar',
        amount: 2100,
      },
    };
    vi.mocked(useApiQuery).mockImplementation((...args: any[]) => {
      const path = String(args[1]);
      if (path.startsWith('/api/approvals?')) {
        return {
          data: { data: [expenseItem], pagination: { total: 1 } },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        } as never;
      }
      if (path === '/api/approvals/7374') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: vi.fn(),
        } as never;
      }
      return {
        data: undefined,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as never;
    });

    renderSection('hospital_admin');
    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(await screen.findByText('Expense Approval #7374')).toBeInTheDocument();
    expect(screen.getAllByText('Asique Sir Bazar').length).toBeGreaterThan(0);
    expect(screen.queryByText('Unable to load approval details.')).not.toBeInTheDocument();
    expect(vi.mocked(useApiQuery).mock.calls.some((call) => call[1] === '/api/approvals/7374')).toBe(false);

    const expensePathBuilder = vi.mocked(useApiMutation).mock.calls
      .filter((call) => call[0] === 'post' && typeof call[1] === 'function')
      .map((call) => call[1] as (variables: { id: number; action: 'approve' | 'reject' }) => string)
      .find((builder) => builder({ id: 7374, action: 'approve' }).startsWith('/api/expenses/'));
    expect(expensePathBuilder?.({ id: 7374, action: 'approve' })).toBe('/api/expenses/7374/approve');
    expect(expensePathBuilder?.({ id: 7374, action: 'reject' })).toBe('/api/expenses/7374/reject');
  });

  it('keeps the selected approval source when numeric IDs collide', async () => {
    const user = userEvent.setup();
    const approvalRequest = {
      id: 55,
      approval_key: 'approval_requests:55',
      approval_source: 'approval_requests',
      type: 'refund',
      entity_no: 'INV-55',
      requested_by: 3,
      requested_by_name: 'Requester One',
      created_at: '2026-07-28 11:00:00',
      approval_amount: 400,
      status: 'pending',
      request_data: { source: 'approval_requests', reason: 'Refund row' },
    };
    const expense = {
      id: 55,
      approval_key: 'expenses:55',
      approval_source: 'expenses',
      entity_id: 55,
      type: 'expense',
      entity_no: 'EXP-55',
      requested_by: 7,
      requested_by_name: 'Requester Two',
      created_at: '2026-07-28 12:00:00',
      approval_amount: 2100,
      status: 'pending',
      can_current_user_approve: true,
      request_data: { source: 'expenses', reason: 'Expense row', amount: 2100 },
    };
    vi.mocked(useApiQuery).mockImplementation((...args: any[]) => {
      const path = String(args[1]);
      if (path.startsWith('/api/approvals?')) {
        return {
          data: { data: [approvalRequest, expense], pagination: { total: 2 } },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        } as never;
      }
      if (path === '/api/approvals/55') {
        return {
          data: { data: { ...approvalRequest, events: [] } },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        } as never;
      }
      return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() } as never;
    });

    renderSection('hospital_admin');
    const reviewButtons = screen.getAllByRole('button', { name: 'Review' });
    await user.click(reviewButtons[1]);

    expect(await screen.findByText('Expense Approval #55')).toBeInTheDocument();
    expect(screen.getAllByText('Expense row').length).toBeGreaterThan(0);
  });

  it('opens the full refund review inside the dashboard', async () => {
    const user = userEvent.setup();
    const listItem = {
      id: 55,
      approval_key: 'approval_requests:55',
      type: 'refund',
      entity_no: 'INV-D-2026-000703',
      requested_by: 3,
      requested_by_name: 'Nusrat Jahan Sony',
      created_at: '2026-07-22 17:24:01',
      approval_amount: 400,
      approval_risk: 'medium',
      status: 'pending',
      request_data: { reason: 'Discount entered after payment', requestedRefundAmount: 400 },
    };
    vi.mocked(useApiQuery).mockImplementation((...args: any[]) => {
      const path = args[1] as string;
      if (path === '/api/approvals/55') {
        return {
          data: {
            data: {
              ...listItem,
              approval_count: 0,
              required_approvals: 2,
              can_current_user_approve: true,
              evidence_status: 'provided',
              execution_status: 'pending',
              cash_hold: { id: 9, amount: 400, status: 'held', counter_session_id: 17 },
              refund_review: {
                bill: { invoice_no: 'INV-D-2026-000703', patient_name: 'Tania', total: 3300, paid: 3300, due: 0 },
                allocationMode: 'auto_proportional_adjustable',
                allocations: [{
                  invoiceItemId: 101,
                  description: 'ECG',
                  itemCategory: 'test',
                  refundableBalance: 400,
                  allocatedRefundAmount: 48.48,
                  allocationSource: 'auto',
                }],
                collectionImpact: {
                  before: { total: 3300, testBill: 3300 },
                  reduction: { testBill: 400 },
                  after: { total: 2900, testBill: 2900 },
                },
                commissionImpact: { totalReversal: 100, blocked: false, rows: [] },
              },
              events: [],
            },
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        } as never;
      }
      return {
        data: { data: [listItem], pagination: { total: 1 } },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as never;
    });

    renderSection('director');
    await user.click(screen.getByRole('button', { name: 'Review' }));

    const detailsButton = await screen.findByRole('button', { name: /more details/i });
    expect(detailsButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByText('Tania').length).toBeGreaterThan(0);
    expect(screen.getByText('Collection reduction')).toBeInTheDocument();
    expect(screen.getByText('Doctor commission')).toBeInTheDocument();
    expect(screen.queryByText('ECG')).not.toBeInTheDocument();

    await user.click(detailsButton);

    expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ECG')).toBeInTheDocument();
  });

  it('shows a compact loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() } as never);

    renderSection();

    expect(screen.getByLabelText('Loading pending requests')).toBeInTheDocument();
  });

  it('shows different empty copy for selected and Past Pending modes', async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByText('There are no pending requests created in this selected period.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Past Pending Requests' }));

    expect(screen.getByText('There are no older pending requests before this period.')).toBeInTheDocument();
  });

  it('keeps full-page navigation visible when loading fails and retries inline', async () => {
    const refetch = vi.fn();
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch } as never);
    const user = userEvent.setup();

    renderSection();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'View Full Pending Review Page' })).toBeInTheDocument();
  });
});

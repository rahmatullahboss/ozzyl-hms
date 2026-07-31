import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RefundDetail from './RefundDetail';
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
    useLocation: () => ({ pathname: '/admin/refund-detail', search: params.toString(), hash: '', state: null, key: 'default' }),
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
    billing: { list: (opts: any) => ['billing', 'list', opts] },
  },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('RefundDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<RefundDetail />);
    expect(screen.getByText('refundDetail.title')).toBeInTheDocument();
  });

  it('renders summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<RefundDetail />);
    expect(screen.getByText('refundDetail.summary.totalRequests')).toBeInTheDocument();
    expect(screen.getByText('refundDetail.summary.totalAmount')).toBeInTheDocument();
  });

  it('renders all 5 tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<RefundDetail />);
    expect(screen.getByText('refundDetail.tabs.pending')).toBeInTheDocument();
    expect(screen.getByText('refundDetail.tabs.approved')).toBeInTheDocument();
    expect(screen.getByText('refundDetail.tabs.rejected')).toBeInTheDocument();
    expect(screen.getByText('refundDetail.tabs.completed')).toBeInTheDocument();
    expect(screen.getByText('refundDetail.tabs.flagged')).toBeInTheDocument();
  });

  it('shows refund table with data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        credit_notes: [
          { id: 1, credit_note_no: 'CN-001', bill_id: 100, patient_name: 'Rahim', refund_amount: 500, reason: 'Service not rendered', status: 'pending', created_at: '2026-06-11T10:00:00Z', created_by: 8 },
          { id: 2, credit_note_no: 'CN-002', bill_id: 101, patient_name: 'Salam', refund_amount: 1000, reason: 'Duplicate charge', status: 'pending', created_at: '2026-06-11T11:00:00Z', created_by: 9 },
        ],
        summary: { totalRefundAmount: 1500 },
      },
      isLoading: false,
    } as never);
    render(<RefundDetail />);
    expect(screen.getByText('CN-001')).toBeInTheDocument();
    expect(screen.getByText('Rahim')).toBeInTheDocument();
    expect(screen.getByText('৳500.00')).toBeInTheDocument();
    expect(screen.getByText('CN-002')).toBeInTheDocument();
    expect(screen.getByText('Salam')).toBeInTheDocument();
    expect(screen.getByText('৳1,500')).toBeInTheDocument();
  });

  it('filters by pending tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        credit_notes: [
          { id: 1, credit_note_no: 'CN-001', bill_id: 100, patient_name: 'Rahim', refund_amount: 500, reason: 'Test', status: 'pending', created_at: '2026-06-11T10:00:00Z', created_by: 1 },
          { id: 2, credit_note_no: 'CN-002', bill_id: 101, patient_name: 'Salam', refund_amount: 1000, reason: 'Test', status: 'approved', created_at: '2026-06-11T11:00:00Z', created_by: 2 },
        ],
      },
      isLoading: false,
    } as never);
    render(<RefundDetail />);
    // Default tab is pending
    expect(screen.getByText('CN-001')).toBeInTheDocument();
    expect(screen.queryByText('CN-002')).not.toBeInTheDocument();
  });

  it('switches to approved tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        credit_notes: [
          { id: 1, credit_note_no: 'CN-001', bill_id: 100, patient_name: 'Rahim', refund_amount: 500, reason: 'Test', status: 'pending', created_at: '2026-06-11T10:00:00Z', created_by: 1 },
          { id: 2, credit_note_no: 'CN-002', bill_id: 101, patient_name: 'Salam', refund_amount: 1000, reason: 'Test', status: 'approved', created_at: '2026-06-11T11:00:00Z', created_by: 2 },
        ],
      },
      isLoading: false,
    } as never);
    render(<RefundDetail />);
    const tabButtons = screen.getAllByText('refundDetail.tabs.approved');
    const tabButton = tabButtons.find(el => el.tagName === 'BUTTON');
    expect(tabButton).toBeTruthy();
    fireEvent.click(tabButton!);
    expect(screen.getByText('CN-002')).toBeInTheDocument();
    expect(screen.queryByText('CN-001')).not.toBeInTheDocument();
  });

  it('shows empty state when no refunds', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { credit_notes: [] },
      isLoading: false,
    } as never);
    render(<RefundDetail />);
    expect(screen.getByText(/refundDetail\.noData/)).toBeInTheDocument();
  });

  it('shows correct status badges', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        credit_notes: [
          { id: 1, credit_note_no: 'CN-001', bill_id: 100, patient_name: 'Rahim', refund_amount: 500, reason: 'Test', status: 'pending', created_at: '2026-06-11T10:00:00Z', created_by: 1 },
        ],
      },
      isLoading: false,
    } as never);
    render(<RefundDetail />);
    expect(screen.getByText('refundDetail.statusLabels.pending')).toBeInTheDocument();
  });
});

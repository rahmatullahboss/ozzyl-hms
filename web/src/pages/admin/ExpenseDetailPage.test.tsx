import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExpenseDetailPage from './ExpenseDetailPage';
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
    useLocation: () => ({ pathname: '/admin/expense-detail', search: params.toString(), hash: '', state: null, key: 'default' }),
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
  queryKeys: { admin: { expenseDetail: (id: string) => ['admin', 'expense', id] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockExpense = {
  id: 'EXP-001',
  expenseNo: 'E-2026-001',
  category: 'Medical Supplies',
  department: 'OPD',
  amount: 15000,
  requestedBy: 'Karim',
  requestedAt: '2026-06-11T09:00:00Z',
  paidFrom: 'Petty Cash',
  voucherNo: 'V-100',
  status: 'pending',
  description: 'Purchase of emergency medical supplies',
  attachmentUrl: 'https://example.com/voucher.pdf',
};

describe('ExpenseDetailPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<ExpenseDetailPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows not found when no data', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: false } as never);
    render(<ExpenseDetailPage />);
    expect(screen.getByText('Expense not found')).toBeInTheDocument();
  });

  it('renders expense header with number and category', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockExpense, isLoading: false } as never);
    const { container } = render(<ExpenseDetailPage />);
    expect(container.textContent).toContain('E-2026-001');
    expect(container.textContent).toContain('Medical Supplies');
    expect(container.textContent).toContain('OPD');
    expect(container.textContent).toContain('pending');
  });

  it('renders 4 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockExpense, isLoading: false } as never);
    const { container } = render(<ExpenseDetailPage />);
    expect(container.textContent).toContain('Amount');
    expect(container.textContent).toContain('Category');
    expect(container.textContent).toContain('Requested By');
    expect(container.textContent).toContain('Paid From');
    expect(container.textContent).toContain('৳15,000.00');
    expect(container.textContent).toContain('Petty Cash');
  });

  it('renders description and voucher', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockExpense, isLoading: false } as never);
    const { container } = render(<ExpenseDetailPage />);
    expect(container.textContent).toContain('Description');
    expect(container.textContent).toContain('Purchase of emergency medical supplies');
    expect(container.textContent).toContain('V-100');
    expect(container.textContent).toContain('View Voucher');
  });

  it('renders 2 detail tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockExpense, isLoading: false } as never);
    render(<ExpenseDetailPage />);
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Approval History')).toBeInTheDocument();
  });

  it('shows expense details in Details tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockExpense, isLoading: false } as never);
    render(<ExpenseDetailPage />);
    expect(screen.getByText('Expense No:')).toBeInTheDocument();
    expect(screen.getByText('Department:')).toBeInTheDocument();
    expect(screen.getByText('Requested:')).toBeInTheDocument();
  });

  it('shows approval history placeholder', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockExpense, isLoading: false } as never);
    render(<ExpenseDetailPage />);
    fireEvent.click(screen.getByText('Approval History'));
    expect(screen.getByText('Approval history will be shown here')).toBeInTheDocument();
  });

  it('shows Approve/Reject buttons for pending expenses', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: mockExpense, isLoading: false } as never);
    render(<ExpenseDetailPage />);
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('hides Approve/Reject buttons for approved expenses', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { ...mockExpense, status: 'approved' }, isLoading: false } as never);
    render(<ExpenseDetailPage />);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
  });
});

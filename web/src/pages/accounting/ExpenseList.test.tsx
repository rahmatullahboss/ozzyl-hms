import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import ExpenseList from './ExpenseList';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));

const SAMPLE = [
  { id: 1, date: '2026-06-04', category: 'MISC',     amount: 1600,  description: 'adjust',     status: 'pending',  receipt_key: null, created_by: 7,    created_by_name: 'Rina',  approved_by_name: null,      created_at: '2026-06-04T08:30:00Z', approved_at: null },
  { id: 2, date: '2026-06-03', category: 'SALARY',   amount: 9000,  description: 'May payroll', status: 'approved', receipt_key: null, created_by: 8,    created_by_name: 'Karim', approved_by_name: 'Dr. Anil', created_at: '2026-06-03T11:00:00Z', approved_at: '2026-06-03T11:15:00Z' },
  { id: 3, date: '2026-06-02', category: 'RENT',     amount: 25000, description: 'broken ac',  status: 'rejected', receipt_key: null, created_by: null, created_by_name: null,   approved_by_name: 'Dr. Anil', created_at: null, approved_at: '2026-06-02T15:00:00Z' },
  { id: 4, date: '2026-06-01', category: 'MARKETING', amount: 4500, description: 'fb ads',    status: 'approved', receipt_key: 'voucher.webp', receipt_status: 'uploaded', created_by: 9, created_by_name: 'Maya', approved_by_name: 'Dr. Anil', created_at: '2026-06-01T10:00:00Z', approved_at: '2026-06-01T10:30:00Z' },
  { id: 5, date: '2026-05-31', category: 'SUPPLIES', amount: 800, description: 'verified expense', status: 'approved', receipt_key: 'verified.webp', receipt_status: 'verified', created_by: 9, created_by_name: 'Maya', approved_by_name: 'Dr. Anil', created_at: '2026-05-31T10:00:00Z', approved_at: '2026-05-31T10:30:00Z' },
  { id: 6, date: '2026-05-30', category: 'SUPPLIES', amount: 700, description: 'rejected expense', status: 'approved', receipt_key: 'rejected.webp', receipt_status: 'rejected', receipt_rejection_reason: 'Voucher belongs to another expense', created_by: 9, created_by_name: 'Maya', approved_by_name: 'Dr. Anil', created_at: '2026-05-30T10:00:00Z', approved_at: '2026-05-30T10:30:00Z' },
];

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('ExpenseList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    (useAuth as any).mockReturnValue({ isAuthenticated: true, token: 'test-token', user: { role: 'hospital_admin', permissions: [] } });
    (useApiQuery as any).mockReturnValue({ data: { expenses: SAMPLE }, isLoading: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('admin role: shows both Created By and Approved By columns', () => {
    render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });
    expect(screen.getByText('Created By')).toBeInTheDocument();
    expect(screen.getByText('Approved By')).toBeInTheDocument();
  });

  it('md role: shows both audit columns', () => {
    render(<ExpenseList role="md" />, { wrapper: Wrapper });
    expect(screen.getByText('Created By')).toBeInTheDocument();
    expect(screen.getByText('Approved By')).toBeInTheDocument();
  });

  it('director role: shows both audit columns', () => {
    render(<ExpenseList role="director" />, { wrapper: Wrapper });
    expect(screen.getByText('Created By')).toBeInTheDocument();
    expect(screen.getByText('Approved By')).toBeInTheDocument();
  });

  it.each(['hospital_admin', 'md', 'director'])('%s role can approve pending expenses', (role) => {
    render(<ExpenseList role={role} />, { wrapper: Wrapper });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('accountant role cannot approve pending expenses', () => {
    render(<ExpenseList role="accountant" />, { wrapper: Wrapper });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('accountant role: shows Created By but hides Approved By', () => {
    render(<ExpenseList role="accountant" />, { wrapper: Wrapper });
    expect(screen.getByText('Created By')).toBeInTheDocument();
    expect(screen.queryByText('Approved By')).toBeNull();
  });

  it('reception role: hides both audit columns', () => {
    render(<ExpenseList role="reception" />, { wrapper: Wrapper });
    expect(screen.queryByText('Created By')).toBeNull();
    expect(screen.queryByText('Approved By')).toBeNull();
  });

  it('renders Unknown when created_by_name is null', () => {
    render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(1);
  });

  it('renders — for a pending expense with no approver', () => {
    render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders category pill with short label and full label in title', () => {
    render(<ExpenseList role="reception" />, { wrapper: Wrapper });
    const salaryPill = screen.getAllByText('Salary')[0];
    expect(salaryPill).toBeInTheDocument();
    expect(salaryPill.getAttribute('title')).toBe('Staff Salary');
  });

  it('renders Marketing category pill (not the Misc default)', () => {
    const { container } = render(<ExpenseList role="reception" />, { wrapper: Wrapper });
    const pill = container.querySelector('tbody span[title="Marketing"]');
    expect(pill).toBeTruthy();
    expect(pill.textContent).toBe('Marketing');
  });

  it('offers Doctor as an expense category and warns against duplicate commission entry', async () => {
    const user = userEvent.setup();
    render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });

    expect(screen.getAllByRole('option', { name: 'Doctor' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Add Expense' }));
    const categorySelect = screen.getByLabelText('category');
    expect(within(categorySelect).getByRole('option', { name: 'expenses.categories.doctor' })).toHaveValue('DOCTOR');

    await user.selectOptions(categorySelect, 'DOCTOR');
    expect(screen.getByText('expenses.doctorExpenseHint')).toBeInTheDocument();
  });

  it('rejected approver is rendered in red', () => {
    const { container } = render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });
    const approverNames = container.querySelectorAll('span.font-medium.block');
    const redOne = Array.from(approverNames).find(
      (el) => (el.parentElement?.className ?? '').includes('text-red-600'),
    );
    expect(redOne).toBeTruthy();
    expect(redOne.parentElement.className).toContain('text-red-600');
  });

  it('management roles can verify or reject an uploaded voucher', () => {
    render(<ExpenseList role="director" />, { wrapper: Wrapper });
    expect(screen.getAllByRole('button', { name: 'Verify voucher' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Reject voucher' }).length).toBeGreaterThan(0);
  });

  it('manager with delegated receipt upload permission uses the limited queue without approval controls', () => {
    (useAuth as any).mockReturnValue({
      isAuthenticated: true,
      token: 'test-token',
      user: { role: 'manager', permissions: ['expenses.receipts.upload'] },
    });

    render(<ExpenseList role="manager" />, { wrapper: Wrapper });

    expect(useApiQuery).toHaveBeenCalledWith(expect.anything(), '/api/expenses/receipt-queue');
    expect(screen.queryByRole('button', { name: 'Add Expense' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Edit' })).toHaveLength(0);
    expect(screen.getAllByText('Upload').length).toBeGreaterThan(0);
  });

  it('accountants can upload but cannot verify vouchers', () => {
    render(<ExpenseList role="accountant" />, { wrapper: Wrapper });
    expect(screen.getAllByText('Replace').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Verify voucher' })).toBeNull();
  });

  it('uses expense translation keys in the create modal instead of raw accounting-prefixed keys', async () => {
    const user = userEvent.setup();
    render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });
    await user.click(screen.getByRole('button', { name: 'Add Expense' }));

    expect(screen.getByRole('heading', { name: 'expenses.newExpenseTitle' })).toBeInTheDocument();
    expect(screen.getByLabelText('date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('category')).toBeInTheDocument();
    expect(screen.getByLabelText('amountBdt')).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('description')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('expenses.voucherPhotoOptional')).toHaveAttribute('type', 'file');
    expect(screen.queryByText(/accounting\./)).toBeNull();
  });

  it('submits expense amount as a number for backend validation', async () => {
    const user = userEvent.setup();
    const saveMutate = vi.fn();
    (useApiMutation as any).mockImplementation((_method: string, pathOrFn: string | Function) => (
      pathOrFn === '/api/expenses'
        ? { mutate: saveMutate, isPending: false }
        : { mutate: vi.fn(), isPending: false }
    ));

    render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });
    await user.click(screen.getByRole('button', { name: 'Add Expense' }));
    await user.type(screen.getByLabelText('amountBdt'), '500');
    await user.type(screen.getByLabelText('description'), 'Dr. Example One');
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(saveMutate).toHaveBeenCalledWith(expect.objectContaining({
      amount: 500,
      description: 'Dr. Example One',
    }));
  });

  it('shows View and Reject but not Replace or Verify for a verified voucher', () => {
    render(<ExpenseList role="director" />, { wrapper: Wrapper });
    const row = screen.getByText('verified expense').closest('tr');
    expect(row).not.toBeNull();
    const voucher = within(row!);
    expect(voucher.getByRole('button', { name: 'View receipt' })).toBeInTheDocument();
    expect(voucher.getByRole('button', { name: 'Reject voucher' })).toBeInTheDocument();
    expect(voucher.queryByText('Replace')).toBeNull();
    expect(voucher.queryByRole('button', { name: 'Verify voucher' })).toBeNull();
  });

  it('shows the rejection reason and allows replacement after rejection', () => {
    render(<ExpenseList role="director" />, { wrapper: Wrapper });
    const row = screen.getByText('rejected expense').closest('tr');
    expect(row).not.toBeNull();
    const voucher = within(row!);
    expect(voucher.getByText('Voucher belongs to another expense')).toBeInTheDocument();
    expect(voucher.getByText('Replace')).toBeInTheDocument();
    expect(voucher.queryByRole('button', { name: 'Verify voucher' })).toBeNull();
  });

  it('uses approval_status instead of legacy status for badges and approval actions', () => {
    (useApiQuery as any).mockReturnValue({
      data: {
        expenses: [{
          id: 20,
          date: '2026-06-04',
          category: 'MISC',
          amount: 15000,
          description: 'legacy mismatch',
          status: 'pending',
          approval_status: 'approved',
          payment_status: 'paid',
          receipt_key: null,
          created_by: 7,
          created_by_name: 'Rina',
          approved_by_name: null,
          created_at: '2026-06-04T08:30:00Z',
          approved_at: null,
        }],
      },
      isLoading: false,
    });

    render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });

    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('shows a user-friendly error when the rejection reason is too short', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'prompt').mockReturnValue('no');
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    render(<ExpenseList role="director" />, { wrapper: Wrapper });
    const row = screen.getByText('verified expense').closest('tr');

    await user.click(within(row!).getByRole('button', { name: 'Reject voucher' }));

    expect(alert).toHaveBeenCalledWith('Please enter a rejection reason of at least 3 characters.');
  });

  it('treats database timestamps without timezone as UTC before Dhaka display', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T08:31:00Z'));
    (useApiQuery as any).mockReturnValue({
      data: {
        expenses: [{
          id: 10,
          date: '2026-06-04',
          category: 'MISC',
          amount: 120,
          description: 'timezone check',
          status: 'approved',
          receipt_key: null,
          created_by: 7,
          created_by_name: 'Rina',
          approved_by_name: 'Dr. Anil',
          created_at: '2026-06-04 08:30:00',
          approved_at: '2026-06-04 08:30:00',
        }],
      },
      isLoading: false,
    });

    render(<ExpenseList role="hospital_admin" />, { wrapper: Wrapper });

    expect(screen.getAllByText('1m ago').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTitle('04-06-2026, 02:30 PM').length).toBeGreaterThanOrEqual(1);
  });
});

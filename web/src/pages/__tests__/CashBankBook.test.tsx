import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import CashBankBook from '../CashBankBook';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const tMap: Record<string, string> = {
  'cashBankBook.title': 'Cash & Bank Book',
  'cashBankBook.subtitle': 'Daily cash and bank transaction summaries',
  'cashBankBook.tab.cash': 'Cash Book',
  'cashBankBook.tab.bank': 'Bank Book',
  'cashBankBook.kpi.cashCollection': 'Cash Collection',
  'cashBankBook.kpi.cashExpense': 'Cash Expense',
  'cashBankBook.kpi.cashRefund': 'Cash Refund',
  'cashBankBook.kpi.netCash': 'Net Cash',
  'cashBankBook.kpi.manualCashOut': 'Manual Cash Out',
  'cashBankBook.kpi.manualCashIn': 'Manual Cash In',
  'cashBankBook.kpi.handoverCash': 'Handover Cash',
  'cashBankBook.kpi.cashDrop': 'Cash Drop',
  'cashBankBook.kpi.totalDeposits': 'Total Deposits',
  'cashBankBook.kpi.cardSettlements': 'Card Settlements',
  'cashBankBook.kpi.supplierPayments': 'Supplier Payments',
  'cashBankBook.kpi.netBankMovement': 'Net Bank Movement',
  'cashBankBook.section.collections': 'Cash Collections',
  'cashBankBook.section.expenses': 'Cash Expenses',
  'cashBankBook.section.manualMovements': 'Manual Drawer Movements',
  'cashBankBook.section.refunds': 'Cash Refunds',
  'cashBankBook.column.type': 'Type',
  'cashBankBook.column.amount': 'Amount',
  'cashBankBook.column.time': 'Time',
  'cashBankBook.column.category': 'Category',
  'cashBankBook.column.receipt': 'Receipt',
  'cashBankBook.column.movement': 'Movement',
  'cashBankBook.column.reason': 'Reason',
  'cashBankBook.column.operator': 'Operator',
  'cashBankBook.column.counter': 'Counter',
  'cashBankBook.column.bank': 'Bank',
  'cashBankBook.receiptAttached': 'Receipt attached',
  'cashBankBook.missing': 'Missing',
  'cashBankBook.noReceipt': 'No receipt',
  'cashBankBook.empty.title': 'No cash transactions',
  'cashBankBook.empty.description': 'No cash transactions recorded for this date.',
  'cashBankBook.empty.depositTitle': 'No pending bank deposit requests',
  'cashBankBook.empty.depositDescription': 'Reception cash drops will appear here before finance confirms the bank deposit.',
  'cashBankBook.empty.bankTitle': 'No bank transactions',
  'cashBankBook.empty.bankDescription': 'No bank transactions recorded for this date.',
  'cashBankBook.bank.depositRequests': 'Bank Deposit Requests',
  'cashBankBook.bank.depositRequestsDescription': 'Cash dropped from reception counters and waiting for bank confirmation.',
  'cashBankBook.bank.transactions': 'Bank Transactions',
  'cashBankBook.bank.confirmDeposit': 'Confirm Deposit',
  'cashBankBook.bank.reject': 'Reject',
  'cashBankBook.bank.field.amount': 'Amount',
  'cashBankBook.bank.field.counter': 'Counter',
  'cashBankBook.bank.field.cashier': 'Cashier',
  'cashBankBook.bank.field.requested': 'Requested',
  'cashBankBook.bank.form.bankName': 'Bank name',
  'cashBankBook.bank.form.referenceNo': 'Reference no',
  'cashBankBook.bank.form.depositDate': 'Deposit date',
  'cashBankBook.bank.form.confirmedAmount': 'Confirmed amount',
  'cashBankBook.bank.form.rejectReason': 'Reject reason',
  'cashBankBook.bank.form.rejectReasonPlaceholder': 'Required if rejecting',
  'cashBankBook.toast.depositConfirmed': 'Bank deposit confirmed',
  'cashBankBook.toast.depositRejected': 'Bank deposit rejected',
  'common.loading': 'Loading…',
  'common.back': 'Back',
  'common.next': 'Next',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => tMap[key] ?? opts?.defaultValue ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

import { useApiQuery } from '../../hooks/useApiQuery';

const mockCashData = {
  data: {
    date: '2026-05-27',
    openingCash: 5000,
    cashCollection: 8000,
    cashExpense: 1500,
    cashRefund: 200,
    manualCashIn: 0,
    manualCashOut: 1600,
    cashDrop: 0,
    handoverCash: 5301,
    closingCash: 11300,
  },
};

const mockCashTransactions = {
    data: {
    date: '2026-05-27',
    collections: [
      { transaction_type: 'OPD Payment', amount: 5000, transaction_date: '2026-05-27 10:00' },
    ],
    expenses: [
      { id: 1, category: 'Office Supplies', amount: 1500, created_at: '2026-05-27 14:00', receipt_key: 'expenses/tenant-1/1/photo.webp' },
    ],
    refunds: [
      { transaction_type: 'Refund', amount: 200, transaction_date: '2026-05-27 16:00' },
    ],
    manualMovements: [
      {
        id: 42,
        movementType: 'cash_out',
        amount: 1600,
        reason: 'adjust',
        createdAt: '2026-05-27 12:59',
        counterName: 'Reception',
        operatorName: 'Nusrat Jahan Sony',
        receiptAvailable: true,
        referenceType: 'expense',
        referenceId: '1',
      },
    ],
  },
};

const mockBankData = {
  data: {
    date: '2026-05-27',
    totalDeposits: 50000,
    totalSettlements: 15000,
    totalPayments: 20000,
    netBankMovement: 30000,
  },
};

const mockBankTransactions = {
  data: [
    { id: 1, type: 'deposit', amount: 50000, bank_name: 'DBBL', created_at: '2026-05-27 09:00' },
    { id: 2, type: 'card_settlement', amount: 15000, bank_name: 'VISA', created_at: '2026-05-27 11:00' },
  ],
};

const mockBankDepositRequests = {
  requests: [
    {
      id: 11,
      requestNo: 'BDR-0001',
      amount: 12500,
      status: 'pending',
      proposedBankName: 'DBBL',
      counterName: 'Reception Counter',
      cashierName: 'Nusrat Jahan Sony',
      requestedAt: '2026-05-27 12:00',
    },
  ],
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CashBankBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockImplementation((key: unknown[], url: string) => {
      if (url.includes('cash-book/transactions')) return { data: mockCashTransactions, isLoading: false };
      if (url.includes('cash-book')) return { data: mockCashData, isLoading: false };
      if (url.includes('bank-book/deposit-requests')) return { data: mockBankDepositRequests, isLoading: false };
      if (url.includes('bank-book/transactions')) return { data: mockBankTransactions, isLoading: false };
      if (url.includes('bank-book')) return { data: mockBankData, isLoading: false };
      return { data: undefined, isLoading: false };
    });
  });

  it('renders the page title', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('Cash & Bank Book')).toBeTruthy();
  });

  it('renders the subtitle', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('Daily cash and bank transaction summaries')).toBeTruthy();
  });

  it('shows Cash Book tab active by default', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('Cash Collection')).toBeTruthy();
    expect(screen.getByText('Cash Expense')).toBeTruthy();
    expect(screen.getByText('Cash Refund')).toBeTruthy();
    expect(screen.getByText('Net Cash')).toBeTruthy();
  });

  it('displays cash amounts with Taka symbol', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getAllByText(/\u09F38,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F31,500/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F3200/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F311,300/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows date picker', () => {
    renderWithProviders(<CashBankBook />);
    const dateInput = document.querySelector('input[type="date"]');
    expect(dateInput).toBeTruthy();
  });

  it('renders both tabs', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('Cash Book')).toBeTruthy();
    expect(screen.getByText('Bank Book')).toBeTruthy();
  });

  it('switches to Bank Book tab on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CashBankBook />);

    await user.click(screen.getByText('Bank Book'));

    expect(screen.getByText('Total Deposits')).toBeTruthy();
    expect(screen.getByText('Card Settlements')).toBeTruthy();
    expect(screen.getByText('Supplier Payments')).toBeTruthy();
    expect(screen.getByText('Net Bank Movement')).toBeTruthy();
  });

  it('displays bank amounts after tab switch', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CashBankBook />);

    await user.click(screen.getByText('Bank Book'));

    expect(screen.getAllByText(/\u09F350,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F315,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F320,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\u09F330,000/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows cash collections table', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('Cash Collections')).toBeTruthy();
    expect(screen.getByText('OPD Payment')).toBeTruthy();
  });

  it('shows cash expenses table', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('Cash Expenses')).toBeTruthy();
    expect(screen.getByText('Office Supplies')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View voucher for expense 1' })).toBeTruthy();
  });

  it('shows cash refunds table', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('Cash Refunds')).toBeTruthy();
  });

  it('shows manual drawer movements with reason and receipt evidence', () => {
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('Manual Drawer Movements')).toBeTruthy();
    expect(screen.getByText('adjust')).toBeTruthy();
    expect(screen.getByText('Nusrat Jahan Sony')).toBeTruthy();
    expect(screen.getAllByText('Receipt attached').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'View voucher for manual expense 1' })).toBeTruthy();
  });

  it('shows Bank Transactions section on bank tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CashBankBook />);

    await user.click(screen.getByText('Bank Book'));

    expect(screen.getByText('Bank Transactions')).toBeTruthy();
    expect(screen.getByText('DBBL')).toBeTruthy();
  });

  it('shows bank deposit request approval queue on bank tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CashBankBook />);

    await user.click(screen.getByText('Bank Book'));

    expect(screen.getByText('Bank Deposit Requests')).toBeTruthy();
    expect(screen.getByText('BDR-0001')).toBeTruthy();
    expect(screen.getByText('Reception Counter')).toBeTruthy();
    expect(screen.getByText('Confirm Deposit')).toBeTruthy();
    expect(screen.getByText('Reject')).toBeTruthy();
  });

  it('wires CashBankBook into admin and accountant routes', async () => {
    const source = await import('../../App?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/const CashBankBook = lazy\(\(\) => import\('\.\/pages\/CashBankBook'\)\)/);
    expect(text).toMatch(/path="cash-bank-book" element=\{<CashBankBook role="hospital_admin" \/>\}/);
    expect(text).toMatch(/path="accountant\/cash-bank-book" element=\{<RoleAwareRoute component=\{CashBankBook\} \/>\}/);
  });

  it('shows loading skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: undefined, isLoading: true });
    renderWithProviders(<CashBankBook />);
    const skeletons = document.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no cash transactions', () => {
    (useApiQuery as any).mockImplementation((key: unknown[], url: string) => {
      if (url.includes('cash-book/transactions')) return {
        data: { data: { collections: [], expenses: [], refunds: [], manualMovements: [] } },
        isLoading: false,
      };
      if (url.includes('cash-book')) return { data: mockCashData, isLoading: false };
      return { data: undefined, isLoading: false };
    });
    renderWithProviders(<CashBankBook />);
    expect(screen.getByText('No cash transactions')).toBeTruthy();
  });

  it('switches back to Cash tab from Bank tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CashBankBook />);

    await user.click(screen.getByText('Bank Book'));
    expect(screen.getByText('Total Deposits')).toBeTruthy();

    await user.click(screen.getByText('Cash Book'));
    expect(screen.getByText('Cash Collection')).toBeTruthy();
  });
});

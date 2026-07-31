import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminTransactionControlCenter from './AdminTransactionControlCenter';
import { useApiQuery } from '../hooks/useApiQuery';

const navigateMock = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ slug: 'city-hospital' }),
  };
});

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> & { defaultValue?: string }) => {
      const text = opts?.defaultValue ?? key;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(opts?.[token] ?? ''));
    },
  }),
}));

const source = () => readFileSync(resolve(__dirname, './AdminTransactionControlCenter.tsx'), 'utf8');

const cashControlResponse = {
  date: '2026-06-18',
  totals: {
    billCashIn: 12000,
    refundCashOut: 500,
    manualCashIn: 1000,
    manualCashOut: 750,
    cashDrop: 2000,
    handoverCollected: 3500,
    activeExpectedCash: 15250,
    activeCounterCount: 2,
    pendingHandoverAmount: 4200,
    pendingHandoverCount: 1,
    closedVariance: 100,
    closedSessionCount: 2,
    approvedExpenseTotal: 750,
    unclassifiedCashOutCount: 1,
    pendingPostingEventCount: 2,
    failedPostingEventCount: 1,
  },
  receiptSummary: {
    expenseCount: 2,
    withReceiptCount: 1,
    missingReceiptCount: 1,
    pendingExpenseCount: 0,
  },
  latestMovements: [
    {
      id: 1,
      movementType: 'cash_in',
      amount: 5000,
      reason: 'OPD bill collection',
      createdAt: '2026-06-18T04:00:00Z',
      counterName: 'Front Desk',
      counterCode: 'FD',
      operatorName: 'Nusrat',
      createdByName: 'Nusrat',
      referenceType: 'invoice',
      referenceId: 'INV-001',
      receiptAvailable: true,
    },
    {
      id: 2,
      movementType: 'cash_out',
      amount: 750,
      reason: 'Tea expense',
      createdAt: '2026-06-18T05:00:00Z',
      counterName: 'Side Desk',
      counterCode: 'SD',
      operatorName: 'Rahim',
      createdByName: 'Rahim',
      referenceType: 'expense',
      referenceId: 'EXP-01',
      expenseCategory: 'Refreshment',
      receiptAvailable: false,
    },
    {
      id: 3,
      movementType: 'cash_drop',
      amount: 2000,
      reason: 'MD collection',
      createdAt: '2026-06-18T06:00:00Z',
      counterName: 'Front Desk',
      counterCode: 'FD',
      operatorName: 'Nusrat',
      createdByName: 'Admin',
      referenceType: 'handover',
      referenceId: 'HO-7',
      receiptAvailable: true,
    },
  ],
  cashStatement: [
    {
      id: 'drawer_movement-1',
      createdAt: '2026-06-18T04:00:00Z',
      label: 'Drawer cash received',
      detail: 'OPD bill collection',
      counterName: 'Front Desk',
      operatorName: 'Nusrat',
      amount: 5000,
      signedAmount: 5000,
      netMovementAfter: 5000,
      direction: 'in',
      sourceType: 'drawer_movement',
      referenceNo: 'INV-001',
    },
  ],
  latestExpenses: [
    {
      id: 1,
      date: '2026-06-18',
      category: 'Refreshment',
      amount: 750,
      description: 'Tea expense',
      status: 'approved',
      createdByName: 'Rahim',
      approvedByName: 'Admin',
      hasReceipt: false,
    },
    {
      id: 2,
      date: '2026-06-18',
      category: 'Stationery',
      amount: 300,
      description: 'Printer paper',
      status: 'approved',
      createdByName: 'Nusrat',
      approvedByName: 'Admin',
      hasReceipt: true,
    },
  ],
  latestHandovers: [
    {
      id: 1,
      amount: 3500,
      dueAmount: 0,
      status: 'collected',
      createdAt: '2026-06-18T07:00:00Z',
      fromName: 'Nusrat',
      toName: 'Accounts',
      counterName: 'Front Desk',
      variance: 0,
    },
    {
      id: 2,
      amount: 1500,
      dueAmount: 100,
      status: 'partial',
      createdAt: '2026-06-18T08:00:00Z',
      fromName: 'Rahim',
      toName: 'Accounts',
      counterName: 'Side Desk',
      variance: 100,
    },
  ],
};

const activeCountersResponse = {
  activeCounters: [
    {
      sessionId: 9,
      counterId: 2,
      counterName: 'Front Desk',
      counterCode: 'FD',
      location: 'Reception',
      operatorName: 'Nusrat',
      openingCash: 1000,
      cashIn: 9000,
      cashOut: 500,
      manualCashIn: 0,
      manualCashOut: 0,
      cashDrop: 2000,
      expectedCash: 10500,
      transactionCount: 17,
      openedAt: '2026-06-18T08:00:00Z',
    },
    {
      sessionId: 10,
      counterId: 3,
      counterName: 'Side Desk',
      counterCode: 'SD',
      location: 'Lab reception',
      operatorName: 'Rahim',
      openingCash: 500,
      cashIn: 3000,
      cashOut: 750,
      manualCashIn: 0,
      manualCashOut: 750,
      cashDrop: 0,
      expectedCash: 2750,
      transactionCount: 8,
      openedAt: '2026-06-18T08:15:00Z',
    },
  ],
  totalActive: 2,
};

function sectionByTitle(title: string): HTMLElement {
  const section = screen.getByText(title).closest('.card');
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

describe('AdminTransactionControlCenter', () => {
  it('routes visible cash ledger copy through adminCash translations', () => {
    const src = source();

    expect(src).toContain("useTranslation('adminCash')");
    expect(src).toContain('cashControlLedger.${key}');
    expect(src).toContain("tr('title', 'Cash Control Ledger')");
    expect(src).toContain("tr('filters.title', 'Review filters')");
    expect(src).toContain("tr('summaryCards.activeCounterCash.label', 'Active counter cash')");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((_key: unknown, path: string) => ({
      data: path.startsWith('/api/dashboard/cash-control')
        ? cashControlResponse
        : path === '/api/dashboard/active-counters'
          ? activeCountersResponse
          : path === '/api/dashboard/fraud-alerts'
            ? { alerts: [], summary: { total: 2, critical: 0, warning: 2, info: 0 } }
            : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));
  });

  it('renders the cash control ledger with source, custody, evidence, and exception sections', () => {
    render(<AdminTransactionControlCenter role="hospital_admin" />);

    expect(screen.getByRole('heading', { name: 'Cash Control Ledger' })).toBeInTheDocument();
    expect(screen.getByText('Live counter cash, handover, expense, receipt, variance, and cash movement in one place.')).toBeInTheDocument();
    expect(screen.getByText('Active counter cash')).toBeInTheDocument();
    expect(screen.getByText('৳15,250')).toBeInTheDocument();
    expect(screen.getByText('Operational cash in')).toBeInTheDocument();
    expect(screen.getByText('Operational cash out')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Custody transfer' })).toBeInTheDocument();
    expect(within(sectionByTitle('Cash movement timeline')).getByText(/OPD bill collection/)).toBeInTheDocument();
    expect(within(sectionByTitle('Cash movement timeline')).getByText(/Tea expense/)).toBeInTheDocument();
    expect(within(sectionByTitle('Cash statement timeline')).getByText(/OPD bill collection/)).toBeInTheDocument();
    expect(within(sectionByTitle('Cash statement timeline')).getByText(/Running net/)).toBeInTheDocument();
    expect(screen.getByText('Attention needed')).toBeInTheDocument();
    expect(screen.getByText('Handover chain')).toBeInTheDocument();
    expect(screen.getByText('Expense evidence')).toBeInTheDocument();
  });

  it('keeps live custody review aligned with the selected report date', () => {
    const expectedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    render(<AdminTransactionControlCenter role="hospital_admin" />);

    expect(useApiQuery).toHaveBeenCalledWith(
      ['cash-ledger', 'overview', expectedDate],
      `/api/cash-ledger/overview?date=${expectedDate}&includeResolved=true&limit=1000`,
      expect.any(Object),
    );
  });

  it('refreshes cash ledger overview with the rest of cash control data', () => {
    const expectedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    const refetchByPath = new Map<string, ReturnType<typeof vi.fn>>();
    (useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((_key: unknown, path: string) => {
      const refetch = vi.fn();
      refetchByPath.set(path, refetch);
      return {
        data: path.startsWith('/api/dashboard/cash-control')
          ? cashControlResponse
          : path === '/api/dashboard/active-counters'
            ? activeCountersResponse
            : path === '/api/dashboard/fraud-alerts'
              ? { alerts: [], summary: { total: 2, critical: 0, warning: 2, info: 0 } }
              : undefined,
        isLoading: false,
        isError: false,
        refetch,
      };
    });

    render(<AdminTransactionControlCenter role="hospital_admin" />);
    fireEvent.click(screen.getByLabelText('Refresh cash control ledger'));

    expect(refetchByPath.get(`/api/dashboard/cash-control?date=${expectedDate}`)).toHaveBeenCalled();
    expect(refetchByPath.get('/api/dashboard/active-counters')).toHaveBeenCalled();
    expect(refetchByPath.get('/api/dashboard/fraud-alerts')).toHaveBeenCalled();
    expect(refetchByPath.get(`/api/cash-ledger/overview?date=${expectedDate}&includeResolved=true&limit=1000`)).toHaveBeenCalled();
  });

  it('filters ledger review by counter, movement type, missing receipt, and variance', () => {
    render(<AdminTransactionControlCenter role="hospital_admin" />);

    fireEvent.change(screen.getByLabelText('Counter'), { target: { value: 'Front Desk' } });
    expect(within(sectionByTitle('Cash movement timeline')).getByText(/OPD bill collection/)).toBeInTheDocument();
    expect(within(sectionByTitle('Cash movement timeline')).queryByText(/Tea expense/)).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 3 movements, 1 of 2 active counters, 1 of 2 handovers/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    fireEvent.change(screen.getByLabelText('Movement type'), { target: { value: 'cash_out' } });
    expect(within(sectionByTitle('Cash movement timeline')).getByText(/Tea expense/)).toBeInTheDocument();
    expect(within(sectionByTitle('Cash movement timeline')).queryByText(/MD collection/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    fireEvent.click(screen.getByLabelText('Missing receipt only'));
    expect(within(sectionByTitle('Cash movement timeline')).getByText(/Tea expense/)).toBeInTheDocument();
    expect(within(sectionByTitle('Expense evidence')).queryByText(/Printer paper/)).not.toBeInTheDocument();
    expect(within(sectionByTitle('Cash movement timeline')).queryByText(/OPD bill collection/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    fireEvent.click(screen.getByLabelText('Variance handovers only'));
    const handoverSection = sectionByTitle('Handover chain');
    expect(within(handoverSection).getByText(/Rahim → Accounts/)).toBeInTheDocument();
    expect(within(handoverSection).queryByText(/Nusrat → Accounts/)).not.toBeInTheDocument();
  });

  it('formats local drawer timestamps without adding another six hours', () => {
    const localTimeResponse = {
      ...cashControlResponse,
      latestMovements: [{
        ...cashControlResponse.latestMovements[0],
        id: 51,
        reason: 'Local drawer movement',
        createdAt: '2026-06-18 18:45:00',
      }],
      cashStatement: [{
        ...cashControlResponse.cashStatement[0],
        id: 'drawer_movement-51',
        detail: 'Local statement row',
        createdAt: '2026-06-18 18:45:00',
        sourceType: 'drawer_movement',
      }],
      latestHandovers: [{
        ...cashControlResponse.latestHandovers[0],
        createdAt: '2026-06-18T07:00:00Z',
      }],
    };
    (useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((_key: unknown, path: string) => ({
      data: path.startsWith('/api/dashboard/cash-control')
        ? localTimeResponse
        : path === '/api/dashboard/active-counters'
          ? activeCountersResponse
          : path === '/api/dashboard/fraud-alerts'
            ? { alerts: [], summary: { total: 0, critical: 0, warning: 0, info: 0 } }
            : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    render(<AdminTransactionControlCenter role="hospital_admin" />);

    expect(within(sectionByTitle('Cash movement timeline')).getByText('18-06-2026, 6:45 PM')).toBeInTheDocument();
    expect(within(sectionByTitle('Cash statement timeline')).getByText('18-06-2026, 6:45 PM')).toBeInTheDocument();
    expect(within(sectionByTitle('Handover chain')).getByText(/18-06-2026, 1:00 PM/)).toBeInTheDocument();
  });

  it('paginates long transaction sections instead of rendering every row at once', () => {
    const manyMovements = Array.from({ length: 12 }, (_, index) => ({
      ...cashControlResponse.latestMovements[0],
      id: index + 100,
      reason: `Movement ${index + 1}`,
      createdAt: `2026-06-18T${String(index).padStart(2, '0')}:00:00Z`,
    }));
    const paginatedResponse = { ...cashControlResponse, latestMovements: manyMovements };
    (useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((_key: unknown, path: string) => ({
      data: path.startsWith('/api/dashboard/cash-control')
        ? paginatedResponse
        : path === '/api/dashboard/active-counters'
          ? activeCountersResponse
          : path === '/api/dashboard/fraud-alerts'
            ? { alerts: [], summary: { total: 0, critical: 0, warning: 0, info: 0 } }
            : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    render(<AdminTransactionControlCenter role="hospital_admin" />);

    const movementSection = sectionByTitle('Cash movement timeline');
    expect(within(movementSection).getByText(/Movement 1 ·/)).toBeInTheDocument();
    expect(within(movementSection).queryByText(/Movement 11 ·/)).not.toBeInTheDocument();

    fireEvent.click(within(movementSection).getByRole('button', { name: /Next page/i }));

    expect(within(movementSection).getByText(/Movement 11 ·/)).toBeInTheDocument();
    expect(within(movementSection).queryByText(/Movement 1 ·/)).not.toBeInTheDocument();
  });

  it('does not show zero-cash unassigned counter starts as handovers', () => {
    const handoverResponse = {
      ...cashControlResponse,
      latestHandovers: [
        {
          id: 99,
          amount: 0,
          dueAmount: 0,
          status: 'pending',
          createdAt: '2026-06-18T03:00:00Z',
          fromName: 'Safaoat Ullah',
          toName: null,
          counterName: 'Reception',
          variance: 0,
          sourceType: 'counter_handover',
        },
        {
          id: 100,
          amount: 500,
          dueAmount: 500,
          status: 'pending',
          createdAt: '2026-06-18T04:00:00Z',
          fromName: 'Safaoat Ullah',
          toName: null,
          counterName: 'Reception',
          variance: 0,
          sourceType: 'counter_handover',
        },
      ],
    };
    (useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((_key: unknown, path: string) => ({
      data: path.startsWith('/api/dashboard/cash-control')
        ? handoverResponse
        : path === '/api/dashboard/active-counters'
          ? activeCountersResponse
          : path === '/api/dashboard/fraud-alerts'
            ? { alerts: [], summary: { total: 0, critical: 0, warning: 0, info: 0 } }
            : undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }));

    render(<AdminTransactionControlCenter role="hospital_admin" />);

    const handoverSection = sectionByTitle('Handover chain');
    expect(within(handoverSection).queryAllByText(/Safaoat Ullah → Unassigned/)).toHaveLength(0);
    expect(within(handoverSection).getByText(/Safaoat Ullah → Receiver not selected/)).toBeInTheDocument();
  });

  it('routes quick actions and drawer cards to operational pages', () => {
    render(<AdminTransactionControlCenter role="hospital_admin" />);

    fireEvent.click(screen.getByRole('button', { name: /Front Desk/ }));
    expect(navigateMock).toHaveBeenCalledWith('/h/city-hospital/cash/drawers/9');

    fireEvent.click(screen.getByRole('button', { name: /Review handovers/ }));
    expect(navigateMock).toHaveBeenCalledWith('/h/city-hospital/cash/handover');

    fireEvent.click(screen.getByRole('button', { name: /Open audit log/ }));
    expect(navigateMock).toHaveBeenCalledWith('/h/city-hospital/system-audit');
  });
});

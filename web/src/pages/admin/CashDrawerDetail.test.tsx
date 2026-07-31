import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CashDrawerDetail from './CashDrawerDetail';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', async () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useParams: () => ({ slug: 'city-hospital', drawerId: '8' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
}));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const activeCounter = {
  sessionId: 8,
  counterId: 9,
  counterName: 'Reception 2',
  counterCode: 'REC-2',
  operatorName: 'Safaoat Ullah',
  openingCash: 0,
  cashIn: 24400,
  cashOut: 0,
  manualCashIn: 0,
  manualCashOut: 50,
  cashDrop: 18450,
  expectedCash: 5900,
  transactionCount: 32,
  openedAt: '2026-06-19 08:00:00',
};

const transferEvent = {
  id: 'cash_custody_transfer:2',
  sourceType: 'cash_custody_transfer',
  sourceId: '2',
  sourceNo: 'CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a',
  eventType: 'CASH_CUSTODY_TRANSFER_PENDING',
  status: 'pending',
  cashStatus: 'PENDING_RECEIVE',
  movementDirection: 'out',
  amount: 18450,
  dueAmount: 18450,
  varianceAmount: null,
  fromUserName: 'Safaoat Ullah',
  toUserName: 'Dr. Nazmus Sakib',
  counterSessionId: 8,
  counterId: 9,
  counterName: 'Reception 2',
  currentLocationLabel: 'In transit to Dr. Nazmus Sakib',
  referenceType: 'cash_custody_transfer',
  referenceId: '2',
  note: 'Drawer custody to Dr. Nazmus Sakib',
  createdAt: '2026-06-19 22:23:36',
  receivedAt: null,
};

function mockQueries({ includeActiveSession }: { includeActiveSession: boolean }) {
  vi.mocked(useApiQuery).mockImplementation((_key: unknown, url: string) => {
    if (url === '/api/dashboard/active-counters') {
      return { data: { activeCounters: includeActiveSession ? [activeCounter] : [] }, isLoading: false, isError: false } as never;
    }
    if (url.startsWith('/api/dashboard/cash-control')) {
      return { data: { latestMovements: [], latestExpenses: [], latestHandovers: [] }, isLoading: false, isError: false } as never;
    }
    if (url.startsWith('/api/cash-ledger/sessions/8/trail')) {
      return { data: { sessionId: 8, events: [transferEvent] }, isLoading: false, isError: false } as never;
    }
    return { data: undefined, isLoading: false, isError: false } as never;
  });
}

describe('CashDrawerDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders active drawer session with unified ledger trail query', () => {
    mockQueries({ includeActiveSession: true });

    render(<CashDrawerDetail />);

    expect(screen.getByText('Reception 2')).toBeInTheDocument();
    expect(screen.getByText('Active session')).toBeInTheDocument();
    expect(screen.getAllByText('৳5,900').length).toBeGreaterThan(0);
    expect(useApiQuery).toHaveBeenCalledWith(
      ['cash-drawer-detail', '8', 'ledger-trail'],
      '/api/cash-ledger/sessions/8/trail?includeResolved=true&limit=500',
      { refetchInterval: 30000 },
    );
  });

  it('shows closed or inactive sessions from the unified ledger trail', () => {
    mockQueries({ includeActiveSession: false });

    render(<CashDrawerDetail />);

    expect(screen.getByText('Reception 2')).toBeInTheDocument();
    expect(screen.getByText('Ledger trail available')).toBeInTheDocument();
    expect(screen.queryByText('কাউন্টার সেশন পাওয়া যায়নি')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Transactions/ })[0]);
    expect(screen.getByText(/Drawer custody to Dr\. Nazmus Sakib/)).toBeInTheDocument();
    expect(screen.getByText(/Ref CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a/)).toBeInTheDocument();
    expect(screen.getByText(/Pending Receive/)).toBeInTheDocument();
  });
});

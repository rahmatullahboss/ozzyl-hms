import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  FileImage,
  FileWarning,
  HandCoins,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { addDays, getTodayGMT6 } from '../lib/date-utils';
import { formatCurrency, formatDateTime } from '../lib/format';

interface ActiveCounter {
  sessionId: number;
  counterId?: number;
  counterName: string;
  counterCode?: string | null;
  location?: string | null;
  operatorName: string;
  openingCash?: number;
  cashIn?: number;
  cashOut?: number;
  manualCashIn?: number;
  manualCashOut?: number;
  cashDrop?: number;
  expectedCash: number;
  transactionCount: number;
  openedAt: string;
}

interface ActiveCountersResponse {
  activeCounters?: ActiveCounter[];
  totalActive?: number;
}

interface CashControlTotals {
  billCashIn?: number;
  refundCashOut?: number;
  manualCashIn?: number;
  manualCashOut?: number;
  cashDrop?: number;
  handoverCollected?: number;
  activeExpectedCash?: number;
  activeCounterCount?: number;
  pendingHandoverAmount?: number;
  pendingHandoverCount?: number;
  closedVariance?: number;
  closedSessionCount?: number;
  approvedExpenseTotal?: number;
  netCashPosition?: number;
  unclassifiedCashOutCount?: number;
  pendingPostingEventCount?: number;
  failedPostingEventCount?: number;
}

interface CashControlResponse {
  date: string;
  totals?: CashControlTotals;
  receiptSummary?: {
    expenseCount?: number;
    withReceiptCount?: number;
    missingReceiptCount?: number;
    pendingExpenseCount?: number;
  };
  latestMovements?: Array<{
    id: number;
    movementType: string;
    amount: number;
    reason: string;
    createdAt: string;
    counterName: string | null;
    counterCode?: string | null;
    operatorName: string | null;
    createdByName?: string | null;
    referenceType: string | null;
    referenceId: string | null;
    expenseCategory?: string | null;
    receiptAvailable: boolean;
  }>;
  cashStatement?: Array<{
    id: string;
    createdAt: string;
    label: string;
    detail?: string | null;
    counterName?: string | null;
    operatorName?: string | null;
    amount: number;
    signedAmount: number;
    netMovementAfter?: number;
    balanceAfter?: number;
    direction: 'in' | 'out';
    sourceType?: string | null;
    referenceType?: string | null;
    referenceNo?: string | null;
  }>;
  latestExpenses?: Array<{
    id: number;
    date: string;
    category: string;
    amount: number;
    description: string | null;
    status: string;
    createdByName: string | null;
    approvedByName: string | null;
    hasReceipt: boolean;
  }>;
  latestHandovers?: Array<{
    id: number;
    sourceType?: string | null;
    amount: number;
    dueAmount: number;
    status: string;
    createdAt: string;
    fromName: string | null;
    toName: string | null;
    counterName: string | null;
    variance: number;
  }>;
}


interface CashLedgerOverview {
  activeDrawerCash?: number;
  pendingTransferCash?: number;
  adminCustodyCash?: number;
  counterCustodyCash?: number;
  bankDepositPendingCash?: number;
  bankedCash?: number;
  disputedCash?: number;
  expensePaidCash?: number;
  payoutPaidCash?: number;
  refundedCash?: number;
  totalCashAccountedFor?: number;
  unresolvedCount?: number;
  eventCount?: number;
}

interface CashLedgerOverviewResponse {
  overview?: CashLedgerOverview;
}

interface FraudAlertsResponse {
  alerts?: Array<{ type: string; severity: string; message: string }>;
  summary?: { total?: number; critical?: number; warning?: number; info?: number };
}

type MovementTone = 'in' | 'out' | 'handover' | 'neutral';
type MovementRow = NonNullable<CashControlResponse['latestMovements']>[number];
type CashStatementRow = NonNullable<CashControlResponse['cashStatement']>[number];
type HandoverRow = NonNullable<CashControlResponse['latestHandovers']>[number];

const TRANSACTION_PAGE_SIZE = 10;
const SIDEBAR_PAGE_SIZE = 5;

const EMPTY_CASH_CONTROL: Required<Pick<CashControlResponse, 'latestMovements' | 'latestExpenses' | 'latestHandovers' | 'cashStatement'>> & {
  totals: Required<CashControlTotals>;
  receiptSummary: Required<NonNullable<CashControlResponse['receiptSummary']>>;
} = {
  totals: {
    billCashIn: 0,
    refundCashOut: 0,
    manualCashIn: 0,
    manualCashOut: 0,
    cashDrop: 0,
    handoverCollected: 0,
    activeExpectedCash: 0,
    activeCounterCount: 0,
    pendingHandoverAmount: 0,
    pendingHandoverCount: 0,
    closedVariance: 0,
    closedSessionCount: 0,
    approvedExpenseTotal: 0,
    netCashPosition: 0,
    unclassifiedCashOutCount: 0,
    pendingPostingEventCount: 0,
    failedPostingEventCount: 0,
  },
  receiptSummary: {
    expenseCount: 0,
    withReceiptCount: 0,
    missingReceiptCount: 0,
    pendingExpenseCount: 0,
  },
  latestMovements: [],
  cashStatement: [],
  latestExpenses: [],
  latestHandovers: [],
};

function money(amount: number | null | undefined): string {
  return formatCurrency(amount ?? 0, { fractionDigits: 0 });
}

function statusText(status: string | null | undefined): string {
  const raw = String(status ?? '').trim();
  if (!raw) return '—';
  return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function movementTone(type: string): MovementTone {
  if (type === 'cash_in') return 'in';
  if (type === 'cash_out') return 'out';
  if (type === 'cash_drop' || type === 'handover') return 'handover';
  return 'neutral';
}

function movementLabel(type: string): string {
  if (type === 'cash_in') return 'Cash received';
  if (type === 'cash_out') return 'Expense / payout';
  if (type === 'cash_drop') return 'Custody transfer';
  if (type === 'handover') return 'Shift handover';
  return statusText(type);
}

function toneClasses(tone: MovementTone): { badge: string; text: string; icon: ReactElement } {
  if (tone === 'in') {
    return { badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', text: 'text-emerald-700', icon: <ArrowUpRight className="h-4 w-4" /> };
  }
  if (tone === 'out') {
    return { badge: 'bg-red-50 text-red-700 border-red-100', text: 'text-red-700', icon: <ArrowDownRight className="h-4 w-4" /> };
  }
  if (tone === 'handover') {
    return { badge: 'bg-blue-50 text-blue-700 border-blue-100', text: 'text-blue-700', icon: <ArrowRightLeft className="h-4 w-4" /> };
  }
  return { badge: 'bg-slate-50 text-slate-700 border-slate-100', text: 'text-[var(--color-text-primary)]', icon: <Wallet className="h-4 w-4" /> };
}

function buildMovementReason(row: MovementRow): string {
  const reason = row.reason?.trim();
  const reference = row.referenceType ? `${statusText(row.referenceType)}${row.referenceId ? ` #${row.referenceId}` : ''}` : '';
  if (reason && reference) return `${reason} · ${reference}`;
  if (reason) return reason;
  if (reference) return reference;
  return 'No reason recorded';
}

function formatLocalNaiveDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const [, year, month, day, hourRaw, minute] = match;
  const hour24 = Number(hourRaw);
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return null;
  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  return `${day}-${month}-${year}, ${hour12}:${minute} ${period}`;
}

function formatDrawerMovementDateTime(value: string | null | undefined): string {
  return formatLocalNaiveDateTime(value) ?? formatDateTime(value);
}

function formatStatementDateTime(entry: CashStatementRow): string {
  if (entry.sourceType === 'drawer_movement') return formatDrawerMovementDateTime(entry.createdAt);
  return formatDateTime(entry.createdAt);
}

function isStatementTransfer(entry: CashStatementRow): boolean {
  const label = `${entry.label ?? ''} ${entry.referenceType ?? ''}`.toLowerCase();
  return label.includes('handover') || label.includes('transfer') || label.includes('deposit') || label.includes('cash_drop');
}

function statementTone(entry: CashStatementRow): MovementTone {
  if (isStatementTransfer(entry)) return 'handover';
  return entry.direction === 'in' ? 'in' : 'out';
}

function statementBalanceAfter(entry: CashStatementRow): number {
  return Number(entry.netMovementAfter ?? entry.balanceAfter ?? 0);
}

function movementAmountText(type: string, amount: number): string {
  const tone = movementTone(type);
  if (tone === 'in') return `+${money(amount)}`;
  if (tone === 'out') return `-${money(amount)}`;
  if (tone === 'handover') return `${money(amount)} moved`;
  return money(amount);
}

function statementAmountText(entry: CashStatementRow): string {
  if (isStatementTransfer(entry)) return `${money(entry.amount)} moved`;
  if (entry.signedAmount >= 0) return `+${money(entry.amount)}`;
  return `-${money(entry.amount)}`;
}

function isReviewableHandover(handover: HandoverRow): boolean {
  return Math.abs(Number(handover.amount || 0)) > 0
    || Math.abs(Number(handover.dueAmount || 0)) > 0
    || Math.abs(Number(handover.variance || 0)) > 0
    || Boolean(handover.toName);
}

function handoverTargetLabel(handover: HandoverRow): string {
  if (handover.toName) return handover.toName;
  if (isReviewableHandover(handover)) return 'Receiver not selected';
  return 'No cash handover';
}

function handoverSourceLabel(handover: HandoverRow): string {
  if (handover.sourceType === 'cash_custody_transfer') return 'Custody transfer';
  return 'Counter handover';
}

function totalPages(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

function pageItems<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

function PaginationControls({
  page,
  totalItems,
  pageSize,
  onPageChange,
  compact = false,
}: {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  if (totalItems <= pageSize) return null;
  const pages = totalPages(totalItems, pageSize);
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  const wrapperClass = compact
    ? 'mt-3 flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-text-muted)] sm:flex-row sm:items-center sm:justify-between'
    : 'flex flex-col gap-2 border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-text-muted)] sm:flex-row sm:items-center sm:justify-between';

  return (
    <div className={wrapperClass}>
      <span>Showing {start.toLocaleString()}-{end.toLocaleString()} of {totalItems.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page">Previous</button>
        <span className="font-medium text-[var(--color-text-primary)]">Page {page} / {pages}</span>
        <button type="button" className="btn-ghost text-xs" onClick={() => onPageChange(Math.min(pages, page + 1))} disabled={page >= pages} aria-label="Next page">Next</button>
      </div>
    </div>
  );
}

export default function AdminTransactionControlCenter({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const { slug = '' } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const { t } = useTranslation('adminCash');
  const tr = (key: string, defaultValue: string, options?: Record<string, unknown>) =>
    t(`cashControlLedger.${key}`, { defaultValue, ...(options ?? {}) });
  const today = getTodayGMT6();
  const [selectedDate, setSelectedDate] = useState(today);
  const [counterFilter, setCounterFilter] = useState('all');
  const [operatorFilter, setOperatorFilter] = useState('all');
  const [movementTypeFilter, setMovementTypeFilter] = useState('all');
  const [missingReceiptOnly, setMissingReceiptOnly] = useState(false);
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [statementPage, setStatementPage] = useState(1);
  const [movementPage, setMovementPage] = useState(1);
  const [handoverPage, setHandoverPage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);

  const { data: cashControlData, isLoading, isError, refetch: refetchCashControl } = useApiQuery<CashControlResponse>(
    queryKeys.admin.cashControl(selectedDate),
    `/api/dashboard/cash-control?date=${selectedDate}`,
    { refetchInterval: 30000 },
  );

  const { data: activeCountersData, refetch: refetchCounters } = useApiQuery<ActiveCountersResponse>(
    queryKeys.admin.activeCounters(),
    '/api/dashboard/active-counters',
    { refetchInterval: 30000 },
  );

  const { data: fraudAlertsData, refetch: refetchFraudAlerts } = useApiQuery<FraudAlertsResponse>(
    queryKeys.admin.fraudAlerts(),
    '/api/dashboard/fraud-alerts',
    { refetchInterval: 60000 },
  );

  const { data: cashLedgerOverviewData, refetch: refetchCashLedger } = useApiQuery<CashLedgerOverviewResponse>(
    ['cash-ledger', 'overview', selectedDate] as const,
    `/api/cash-ledger/overview?date=${selectedDate}&includeResolved=true&limit=1000`,
    { refetchInterval: 30000 },
  );

  const totals = { ...EMPTY_CASH_CONTROL.totals, ...(cashControlData?.totals ?? {}) };
  const ledgerOverview = cashLedgerOverviewData?.overview ?? {};
  const ledgerPendingCash = Number(ledgerOverview.pendingTransferCash || 0) + Number(ledgerOverview.bankDepositPendingCash || 0);
  const ledgerCustodyCash = Number(ledgerOverview.adminCustodyCash || 0) + Number(ledgerOverview.counterCustodyCash || 0) + Number(ledgerOverview.bankedCash || 0);
  const ledgerDisputedCash = Number(ledgerOverview.disputedCash || 0);
  const receiptSummary = { ...EMPTY_CASH_CONTROL.receiptSummary, ...(cashControlData?.receiptSummary ?? {}) };
  const latestMovements = cashControlData?.latestMovements ?? EMPTY_CASH_CONTROL.latestMovements;
  const cashStatement = cashControlData?.cashStatement ?? EMPTY_CASH_CONTROL.cashStatement;
  const latestExpenses = cashControlData?.latestExpenses ?? EMPTY_CASH_CONTROL.latestExpenses;
  const latestHandovers = cashControlData?.latestHandovers ?? EMPTY_CASH_CONTROL.latestHandovers;
  const activeCounters = activeCountersData?.activeCounters ?? [];
  const reviewableHandovers = useMemo(() => latestHandovers.filter(isReviewableHandover), [latestHandovers]);

  const counterOptions = useMemo(
    () => uniqueSorted([
      ...activeCounters.map((counter) => counter.counterName),
      ...latestMovements.map((movement) => movement.counterName),
      ...reviewableHandovers.map((handover) => handover.counterName),
    ]),
    [activeCounters, latestMovements, reviewableHandovers],
  );

  const operatorOptions = useMemo(
    () => uniqueSorted([
      ...activeCounters.map((counter) => counter.operatorName),
      ...latestMovements.map((movement) => movement.operatorName),
      ...latestMovements.map((movement) => movement.createdByName),
      ...reviewableHandovers.map((handover) => handover.fromName),
      ...reviewableHandovers.map((handover) => handover.toName),
      ...latestExpenses.map((expense) => expense.createdByName),
    ]),
    [activeCounters, latestExpenses, latestMovements, reviewableHandovers],
  );

  const movementTypeOptions = useMemo(
    () => uniqueSorted(latestMovements.map((movement) => movement.movementType)),
    [latestMovements],
  );

  const filteredActiveCounters = useMemo(() => activeCounters.filter((counter) => {
    if (counterFilter !== 'all' && counter.counterName !== counterFilter) return false;
    if (operatorFilter !== 'all' && counter.operatorName !== operatorFilter) return false;
    return true;
  }), [activeCounters, counterFilter, operatorFilter]);

  const filteredMovements = useMemo(() => latestMovements.filter((movement) => {
    if (counterFilter !== 'all' && movement.counterName !== counterFilter) return false;
    if (operatorFilter !== 'all' && movement.operatorName !== operatorFilter && movement.createdByName !== operatorFilter) return false;
    if (movementTypeFilter !== 'all' && movement.movementType !== movementTypeFilter) return false;
    if (missingReceiptOnly && !(movement.referenceType === 'expense' && !movement.receiptAvailable)) return false;
    return true;
  }), [counterFilter, latestMovements, missingReceiptOnly, movementTypeFilter, operatorFilter]);

  const filteredStatement = useMemo(() => cashStatement.filter((entry) => {
    if (counterFilter !== 'all' && entry.counterName !== counterFilter) return false;
    if (operatorFilter !== 'all' && entry.operatorName !== operatorFilter) return false;
    return true;
  }), [cashStatement, counterFilter, operatorFilter]);

  const filteredHandovers = useMemo(() => reviewableHandovers.filter((handover) => {
    if (counterFilter !== 'all' && handover.counterName !== counterFilter) return false;
    if (operatorFilter !== 'all' && handover.fromName !== operatorFilter && handover.toName !== operatorFilter) return false;
    if (varianceOnly && Number(handover.variance || 0) === 0) return false;
    return true;
  }), [counterFilter, operatorFilter, reviewableHandovers, varianceOnly]);

  const filteredExpenses = useMemo(() => latestExpenses.filter((expense) => {
    if (operatorFilter !== 'all' && expense.createdByName !== operatorFilter && expense.approvedByName !== operatorFilter) return false;
    if (missingReceiptOnly && expense.hasReceipt) return false;
    return true;
  }), [latestExpenses, missingReceiptOnly, operatorFilter]);

  useEffect(() => { setStatementPage(1); }, [cashStatement, counterFilter, operatorFilter]);
  useEffect(() => { setMovementPage(1); }, [counterFilter, latestMovements, missingReceiptOnly, movementTypeFilter, operatorFilter]);
  useEffect(() => { setHandoverPage(1); }, [counterFilter, operatorFilter, reviewableHandovers, varianceOnly]);
  useEffect(() => { setExpensePage(1); }, [latestExpenses, missingReceiptOnly, operatorFilter]);

  const visibleStatement = useMemo(() => pageItems(filteredStatement, statementPage, TRANSACTION_PAGE_SIZE), [filteredStatement, statementPage]);
  const visibleMovements = useMemo(() => pageItems(filteredMovements, movementPage, TRANSACTION_PAGE_SIZE), [filteredMovements, movementPage]);
  const visibleHandovers = useMemo(() => pageItems(filteredHandovers, handoverPage, SIDEBAR_PAGE_SIZE), [filteredHandovers, handoverPage]);
  const visibleExpenses = useMemo(() => pageItems(filteredExpenses, expensePage, SIDEBAR_PAGE_SIZE), [filteredExpenses, expensePage]);

  const legacyActiveExpectedCash = Number(totals.activeExpectedCash || 0) || activeCounters.reduce((sum, counter) => sum + Number(counter.expectedCash || 0), 0);
  const activeExpectedCash = cashLedgerOverviewData?.overview ? Number(ledgerOverview.activeDrawerCash || 0) : legacyActiveExpectedCash;
  const operationalCashIn = Number(totals.billCashIn || 0) + Number(totals.manualCashIn || 0);
  const operationalCashOut = Number(totals.refundCashOut || 0) + Number(totals.manualCashOut || 0);
  const custodyTransferCash = Number(totals.cashDrop || 0) + Number(totals.handoverCollected || 0);
  const unresolvedIssueCount = Number(totals.unclassifiedCashOutCount || 0)
    + Number(totals.failedPostingEventCount || 0)
    + Number(totals.pendingPostingEventCount || 0)
    + Number(receiptSummary.missingReceiptCount || 0)
    + Math.abs(Number(totals.closedVariance || 0) !== 0 ? 1 : 0)
    + Number(fraudAlertsData?.summary?.total || 0)
    + Number(ledgerOverview.unresolvedCount || 0);

  const hasFilters = counterFilter !== 'all' || operatorFilter !== 'all' || movementTypeFilter !== 'all' || missingReceiptOnly || varianceOnly;

  const clearFilters = () => {
    setCounterFilter('all');
    setOperatorFilter('all');
    setMovementTypeFilter('all');
    setMissingReceiptOnly(false);
    setVarianceOnly(false);
  };

  const summaryCards = [
    {
      label: tr('summaryCards.activeCounterCash.label', 'Active counter cash'),
      value: money(activeExpectedCash),
      detail: tr('summaryCards.activeCounterCash.detail', '{{count}} active counters', { count: activeCounters.length.toLocaleString() }),
      icon: <Wallet className="h-5 w-5" />,
      tone: 'text-emerald-700',
    },
    {
      label: tr('summaryCards.pendingCash.label', 'Pending / in-transit cash'),
      value: money(cashLedgerOverviewData?.overview ? ledgerPendingCash : totals.pendingHandoverAmount),
      detail: cashLedgerOverviewData?.overview
        ? tr('summaryCards.pendingCash.ledgerDetail', 'Unreceived transfer / bank deposit pending')
        : tr('summaryCards.pendingCash.legacyDetail', '{{count}} handovers waiting', { count: Number(totals.pendingHandoverCount || 0).toLocaleString() }),
      icon: <HandCoins className="h-5 w-5" />,
      tone: 'text-amber-700',
    },
    {
      label: tr('summaryCards.custody.label', 'Admin / bank custody'),
      value: money(cashLedgerOverviewData?.overview ? ledgerCustodyCash : totals.handoverCollected),
      detail: tr('summaryCards.custody.detail', 'Received by admin/counter/bank'),
      icon: <ArrowRightLeft className="h-5 w-5" />,
      tone: 'text-blue-700',
    },
    {
      label: tr('summaryCards.disputed.label', 'Disputed / variance'),
      value: money(cashLedgerOverviewData?.overview ? ledgerDisputedCash : totals.closedVariance),
      detail: cashLedgerOverviewData?.overview
        ? tr('summaryCards.disputed.ledgerDetail', '{{count}} unresolved cash items', { count: Number(ledgerOverview.unresolvedCount || 0).toLocaleString() })
        : tr('summaryCards.disputed.legacyDetail', '{{count}} closed sessions', { count: Number(totals.closedSessionCount || 0).toLocaleString() }),
      icon: <ShieldCheck className="h-5 w-5" />,
      tone: Number(cashLedgerOverviewData?.overview ? ledgerDisputedCash : totals.closedVariance || 0) === 0 ? 'text-emerald-700' : 'text-red-700',
    },
  ];

  const cashInItems = [
    { label: tr('cashIn.patientBill', 'Patient bill / due collection'), amount: totals.billCashIn },
    { label: tr('cashIn.manualDrawerReceive', 'Manual drawer cash received'), amount: totals.manualCashIn },
  ];

  const operationalOutItems = [
    { label: tr('cashOut.refund', 'Refund / return to patient'), amount: totals.refundCashOut },
    { label: tr('cashOut.expensePayout', 'Expense / payout from drawer'), amount: totals.manualCashOut },
  ];

  const custodyTransferItems = [
    { label: tr('custody.counterHandoverReceived', 'Counter handover received'), amount: totals.handoverCollected },
    { label: tr('custody.cashDrop', 'Cash drop / MD / bank custody'), amount: totals.cashDrop },
  ];

  const exceptionItems = useMemo(() => [
    { label: 'Unresolved ledger cash items', value: Number(ledgerOverview.unresolvedCount || 0), detail: 'Cash ledger-এ pending/disputed/unresolved item আছে', path: `${base}/cash/drawers`, urgent: Number(ledgerOverview.unresolvedCount || 0) > 0 },
    { label: 'Variance found in closed shift', value: Math.abs(Number(totals.closedVariance || 0)) > 0 ? 1 : 0, detail: `${money(totals.closedVariance)} variance review করা দরকার`, path: `${base}/cash/handover`, urgent: Math.abs(Number(totals.closedVariance || 0)) > 0 },
    { label: 'Unclassified cash out', value: Number(totals.unclassifiedCashOutCount || 0), detail: 'কোন expense/handover reference ছাড়া cash বের হয়েছে', path: `${base}/cash/expenses`, urgent: Number(totals.unclassifiedCashOutCount || 0) > 0 },
    { label: 'Receipt missing', value: Number(receiptSummary.missingReceiptCount || 0), detail: 'Expense আছে, কিন্তু receipt/proof attach করা হয়নি', path: `${base}/cash/expenses`, urgent: Number(receiptSummary.missingReceiptCount || 0) > 0 },
    { label: 'Posting issue', value: Number(totals.pendingPostingEventCount || 0) + Number(totals.failedPostingEventCount || 0), detail: 'Ledger posting pending/failed আছে', path: `${base}/accounting?queue=pending`, urgent: Number(totals.failedPostingEventCount || 0) > 0 },
    { label: 'Fraud/risk alerts', value: Number(fraudAlertsData?.summary?.total || 0), detail: 'High void, large transaction, stale handover etc.', path: `${base}/alerts`, urgent: Number(fraudAlertsData?.summary?.critical || 0) > 0 || Number(fraudAlertsData?.summary?.warning || 0) > 0 },
  ].filter((item) => item.value > 0 || item.urgent), [base, fraudAlertsData?.summary?.critical, fraudAlertsData?.summary?.total, fraudAlertsData?.summary?.warning, ledgerOverview.unresolvedCount, receiptSummary.missingReceiptCount, totals.closedVariance, totals.failedPostingEventCount, totals.pendingPostingEventCount, totals.unclassifiedCashOutCount]);

  const refreshAll = () => {
    refetchCashControl();
    refetchCounters();
    refetchFraudAlerts();
    refetchCashLedger();
  };

  return (
    <DashboardLayout role={role}>
      <div className="mx-auto max-w-screen-2xl space-y-5">
        <div className="page-header">
          <div>
            <h1 className="page-title">{tr('title', 'Cash Control Ledger')}</h1>
            <p className="section-subtitle">{tr('subtitle', 'Live counter cash, handover, expense, receipt, variance, and cash movement in one place.')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setSelectedDate(today)}>{tr('actions.today', 'Today')}</button>
            <button type="button" className="btn-secondary" onClick={() => setSelectedDate(addDays(today, -1))}>{tr('actions.yesterday', 'Yesterday')}</button>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || today)} className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)]" />
            <button type="button" className="btn-ghost" onClick={refreshAll} aria-label={tr('actions.refreshAria', 'Refresh cash control ledger')}><RefreshCw className="h-4 w-4" /></button>
          </div>
        </div>

        {isError && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{tr('errors.loadFailed', 'Cash control data could not be loaded. Please refresh again.')}</div>}


        <div className="card p-4">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="section-title">{tr('filters.title', 'Review filters')}</h2>
              <p className="section-subtitle mt-1">{tr('filters.subtitle', 'Quickly review by counter, operator, movement type, missing receipt, or variance.')}</p>
            </div>
            {hasFilters && (
              <button type="button" className="btn-ghost text-sm" onClick={clearFilters}>
                <X className="h-4 w-4" /> {tr('filters.clear', 'Clear filters')}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-1 text-xs font-medium text-[var(--color-text-muted)]">
              {tr('filters.counter', 'Counter')}
              <select value={counterFilter} onChange={(event) => setCounterFilter(event.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)]">
                <option value="all">{tr('filters.allCounters', 'All counters')}</option>
                {counterOptions.map((counter) => <option key={counter} value={counter}>{counter}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-[var(--color-text-muted)]">
              {tr('filters.operator', 'Operator / user')}
              <select value={operatorFilter} onChange={(event) => setOperatorFilter(event.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)]">
                <option value="all">{tr('filters.allUsers', 'All users')}</option>
                {operatorOptions.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-[var(--color-text-muted)]">
              {tr('filters.movementType', 'Movement type')}
              <select value={movementTypeFilter} onChange={(event) => setMovementTypeFilter(event.target.value)} className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)]">
                <option value="all">{tr('filters.allMovements', 'All movements')}</option>
                {movementTypeOptions.map((type) => <option key={type} value={type}>{movementLabel(type)}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
              <input type="checkbox" checked={missingReceiptOnly} onChange={(event) => setMissingReceiptOnly(event.target.checked)} className="h-4 w-4 rounded border-[var(--color-border)]" />
              {tr('filters.missingReceiptOnly', 'Missing receipt only')}
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
              <input type="checkbox" checked={varianceOnly} onChange={(event) => setVarianceOnly(event.target.checked)} className="h-4 w-4 rounded border-[var(--color-border)]" />
              {tr('filters.varianceHandoversOnly', 'Variance handovers only')}
            </label>
          </div>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            {tr('filters.showingSummary', 'Showing {{visibleMovements}} of {{totalMovements}} movements, {{visibleCounters}} of {{totalCounters}} active counters, {{visibleHandovers}} of {{totalHandovers}} handovers.', {
              visibleMovements: filteredMovements.length.toLocaleString(),
              totalMovements: latestMovements.length.toLocaleString(),
              visibleCounters: filteredActiveCounters.length.toLocaleString(),
              totalCounters: activeCounters.length.toLocaleString(),
              visibleHandovers: filteredHandovers.length.toLocaleString(),
              totalHandovers: reviewableHandovers.length.toLocaleString(),
            })}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-muted)]">{card.label}</p>
                  <p className={`mt-2 font-data text-[clamp(1.35rem,2vw,1.9rem)] font-bold leading-tight ${card.tone}`}>{card.value}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{card.detail}</p>
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-bg-subtle)] text-[var(--color-primary)]">{card.icon}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-5">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <div className="card p-5">
                <div className="mb-4 flex items-center gap-2"><ArrowUpRight className="h-5 w-5 text-emerald-600" /><div><h2 className="section-title">{tr('sections.operationalCashIn.title', 'Operational cash in')}</h2><p className="section-subtitle">{tr('sections.operationalCashIn.subtitle', 'Patient collection and drawer cash receive')}</p></div></div>
                <div className="space-y-3">
                  {cashInItems.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2"><span className="text-sm text-emerald-900">{item.label}</span><span className="font-data font-bold text-emerald-700">+{money(item.amount)}</span></div>)}
                  <div className="flex items-center justify-between border-t border-emerald-100 pt-3"><span className="font-semibold text-[var(--color-text-primary)]">{tr('sections.operationalCashIn.total', 'Total operational in')}</span><span className="font-data text-lg font-bold text-emerald-700">+{money(operationalCashIn)}</span></div>
                </div>
              </div>

              <div className="card p-5">
                <div className="mb-4 flex items-center gap-2"><ArrowDownRight className="h-5 w-5 text-red-600" /><div><h2 className="section-title">{tr('sections.operationalCashOut.title', 'Operational cash out')}</h2><p className="section-subtitle">{tr('sections.operationalCashOut.subtitle', 'Refund, expense, and payout only')}</p></div></div>
                <div className="space-y-3">
                  {operationalOutItems.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2"><span className="text-sm text-red-900">{item.label}</span><span className="font-data font-bold text-red-700">-{money(item.amount)}</span></div>)}
                  <div className="flex items-center justify-between border-t border-red-100 pt-3"><span className="font-semibold text-[var(--color-text-primary)]">{tr('sections.operationalCashOut.total', 'Total operational out')}</span><span className="font-data text-lg font-bold text-red-700">-{money(operationalCashOut)}</span></div>
                </div>
              </div>

              <div className="card p-5">
                <div className="mb-4 flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-blue-600" /><div><h2 className="section-title">{tr('sections.custodyTransfer.title', 'Custody transfer')}</h2><p className="section-subtitle">{tr('sections.custodyTransfer.subtitle', 'Handover/transfer; this will not be counted as expense')}</p></div></div>
                <div className="space-y-3">
                  {custodyTransferItems.map((item) => <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 px-3 py-2"><span className="text-sm text-blue-900">{item.label}</span><span className="font-data font-bold text-blue-700">{money(item.amount)}</span></div>)}
                  <div className="flex items-center justify-between border-t border-blue-100 pt-3"><span className="font-semibold text-[var(--color-text-primary)]">{tr('sections.custodyTransfer.total', 'Total custody moved')}</span><span className="font-data text-lg font-bold text-blue-700">{money(custodyTransferCash)}</span></div>
                </div>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="section-title flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-[var(--color-primary)]" />Cash statement timeline</h2>
                  <p className="section-subtitle mt-1">Operational in/out এবং custody transfer আলাদা করে দেখানো হচ্ছে।</p>
                </div>
                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                  <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800"><span className="block text-[10px] uppercase tracking-wide">Operational in</span><span className="font-data text-base font-bold">+{money(operationalCashIn)}</span></div>
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-red-800"><span className="block text-[10px] uppercase tracking-wide">Operational out</span><span className="font-data text-base font-bold">-{money(operationalCashOut)}</span></div>
                  <div className="rounded-lg bg-blue-50 px-3 py-2 text-blue-800"><span className="block text-[10px] uppercase tracking-wide">Custody transfer</span><span className="font-data text-base font-bold">{money(custodyTransferCash)}</span></div>
                </div>
              </div>
              {filteredStatement.length === 0 ? <div className="p-6 text-sm text-[var(--color-text-muted)]">No cash statement entry found for selected filters.</div> : (
                <>
                  <div className="divide-y divide-[var(--color-border)]">
                    {visibleStatement.map((entry) => {
                      const tone = toneClasses(statementTone(entry));
                      return (
                        <div key={entry.id} className="grid gap-3 p-4 md:grid-cols-[155px_minmax(0,1fr)_180px] md:items-start">
                          <div className="text-xs text-[var(--color-text-muted)]">{formatStatementDateTime(entry)}</div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone.badge}`}>{tone.icon}{entry.label}</span>
                              {entry.referenceNo ? <span className="rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">{entry.referenceNo}</span> : null}
                            </div>
                            <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)] break-words">{entry.detail || 'Cash movement'}</p>
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{entry.operatorName || 'Unknown operator'} · {entry.counterName || 'No counter'}</p>
                          </div>
                          <div className="rounded-lg bg-[var(--color-bg-subtle)] px-3 py-2 md:text-right">
                            <p className={`font-data text-lg font-bold ${tone.text}`}>{statementAmountText(entry)}</p>
                            <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Running net {money(statementBalanceAfter(entry))}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <PaginationControls page={statementPage} totalItems={filteredStatement.length} pageSize={TRANSACTION_PAGE_SIZE} onPageChange={setStatementPage} />
                </>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-[var(--color-border)] p-4"><h2 className="section-title flex items-center gap-2"><Wallet className="h-5 w-5 text-[var(--color-primary)]" />Live drawer status</h2><p className="section-subtitle mt-1">কোন counter-এ কত cash expected আছে এবং কে operate করছে।</p></div>
              {isLoading ? <div className="space-y-3 p-4">{[1, 2, 3].map((item) => <div key={item} className="skeleton h-24 rounded-lg" />)}</div> : filteredActiveCounters.length === 0 ? <div className="p-6 text-sm text-[var(--color-text-muted)]">No active counter sessions match the current filters.</div> : (
                <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
                  {filteredActiveCounters.map((counter) => (
                    <button key={counter.sessionId} type="button" onClick={() => navigate(`${base}/cash/drawers/${counter.sessionId}`)} className="rounded-xl border border-[var(--color-border)] p-4 text-left transition hover:border-[var(--color-primary)] hover:shadow-md">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-[var(--color-text-primary)] truncate">{counter.counterName}</p><p className="mt-1 text-xs text-[var(--color-text-muted)] truncate">{counter.operatorName} · {counter.location || counter.counterCode || 'No location'}</p></div><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Active</span></div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs xl:grid-cols-5"><div className="rounded-lg bg-[var(--color-bg-subtle)] p-2"><p className="text-[var(--color-text-muted)]">Expected cash</p><p className="font-data text-sm font-bold text-emerald-700">{money(counter.expectedCash)}</p></div><div className="rounded-lg bg-[var(--color-bg-subtle)] p-2"><p className="text-[var(--color-text-muted)]">Transactions</p><p className="font-data text-sm font-bold text-[var(--color-text-primary)]">{Number(counter.transactionCount || 0).toLocaleString()}</p></div><div className="rounded-lg bg-emerald-50 p-2 text-emerald-800">Cash in {money(Number(counter.cashIn || 0) + Number(counter.manualCashIn || 0))}</div><div className="rounded-lg bg-red-50 p-2 text-red-800">Cash out {money(Number(counter.cashOut || 0) + Number(counter.manualCashOut || 0))}</div><div className="rounded-lg bg-blue-50 p-2 text-blue-800">Transfer {money(Number(counter.cashDrop || 0))}</div></div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-[var(--color-border)] p-4"><h2 className="section-title flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-[var(--color-primary)]" />Cash movement timeline</h2><p className="section-subtitle mt-1">Drawer receive, expense/payout এবং handover/custody transfer আলাদা tone-এ দেখানো হচ্ছে।</p></div>
              {filteredMovements.length === 0 ? <div className="p-6 text-sm text-[var(--color-text-muted)]">No movement found for selected filters.</div> : (
                <>
                  <div className="divide-y divide-[var(--color-border)]">
                  {visibleMovements.map((movement) => {
                    const tone = toneClasses(movementTone(movement.movementType));
                    return (
                      <div key={movement.id} className="grid gap-3 p-4 md:grid-cols-[155px_minmax(0,1fr)_180px] md:items-start">
                        <div className="text-xs text-[var(--color-text-muted)]">{formatDrawerMovementDateTime(movement.createdAt)}</div>
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone.badge}`}>{tone.icon}{movementLabel(movement.movementType)}</span>{movement.receiptAvailable ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Receipt</span> : movement.referenceType === 'expense' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">No receipt</span> : null}</div><p className="mt-2 font-medium text-[var(--color-text-primary)] break-words">{buildMovementReason(movement)}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{movement.operatorName || 'Unknown operator'} · {movement.counterName || 'No counter'} · created by {movement.createdByName || 'System'}</p></div>
                        <div className={`rounded-lg bg-[var(--color-bg-subtle)] px-3 py-2 font-data text-lg font-bold md:text-right ${tone.text}`}>{movementAmountText(movement.movementType, movement.amount)}</div>
                      </div>
                    );
                  })}
                  </div>
                  <PaginationControls page={movementPage} totalItems={filteredMovements.length} pageSize={TRANSACTION_PAGE_SIZE} onPageChange={setMovementPage} />
                </>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="section-title flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" /> Attention needed</h2><p className="section-subtitle mt-1">যেগুলো admin/MD আগে দেখবে</p></div><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${unresolvedIssueCount > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{unresolvedIssueCount > 0 ? `${unresolvedIssueCount} issues` : 'All clear'}</span></div>
              <div className="space-y-2">{exceptionItems.length === 0 ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">No issue needs attention right now.</div> : exceptionItems.map((item) => <button key={item.label} type="button" onClick={() => navigate(item.path)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3 text-left hover:bg-[var(--color-bg-subtle)]"><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.label}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{item.detail}</p></div><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.urgent || item.value > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{item.value.toLocaleString()}</span></button>)}</div>
            </div>

            <div className="card p-5">
              <h2 className="section-title flex items-center gap-2"><HandCoins className="h-5 w-5 text-blue-600" /> Handover chain</h2><p className="section-subtitle mt-1">শুধু real cash handover / custody transfer দেখায়; zero-cash counter start আলাদা রাখা হয়েছে।</p>
              <div className="mt-4 space-y-3">
                {filteredHandovers.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">No handover found.</p> : visibleHandovers.map((handover) => <div key={handover.id} className="rounded-lg border border-[var(--color-border)] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--color-text-primary)]">{handover.fromName || 'Unknown'} → {handoverTargetLabel(handover)}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{handoverSourceLabel(handover)} · {handover.counterName || 'No counter'} · {formatDateTime(handover.createdAt)}</p></div><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${handover.status === 'pending' || handover.status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{statusText(handover.status)}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><p className="text-[var(--color-text-muted)]">Amount</p><p className="font-data font-bold">{money(handover.amount)}</p></div><div><p className="text-[var(--color-text-muted)]">Due</p><p className="font-data font-bold text-amber-700">{money(handover.dueAmount)}</p></div><div><p className="text-[var(--color-text-muted)]">Variance</p><p className={`font-data font-bold ${Number(handover.variance || 0) === 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money(handover.variance)}</p></div></div></div>)}
                <PaginationControls compact page={handoverPage} totalItems={filteredHandovers.length} pageSize={SIDEBAR_PAGE_SIZE} onPageChange={setHandoverPage} />
              </div>
            </div>

            <div className="card p-5">
              <h2 className="section-title flex items-center gap-2"><FileImage className="h-5 w-5 text-purple-600" /> Expense evidence</h2><p className="section-subtitle mt-1">Expense reason এবং receipt status</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><div className="rounded-lg bg-[var(--color-bg-subtle)] p-2"><p className="text-[var(--color-text-muted)]">Total</p><p className="font-data font-bold">{receiptSummary.expenseCount.toLocaleString()}</p></div><div className="rounded-lg bg-emerald-50 p-2 text-emerald-800"><p>With receipt</p><p className="font-data font-bold">{receiptSummary.withReceiptCount.toLocaleString()}</p></div><div className="rounded-lg bg-red-50 p-2 text-red-800"><p>Missing</p><p className="font-data font-bold">{receiptSummary.missingReceiptCount.toLocaleString()}</p></div></div>
              <div className="mt-4 space-y-3">{filteredExpenses.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">No expense found.</p> : visibleExpenses.map((expense) => <div key={expense.id} className="rounded-lg border border-[var(--color-border)] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{expense.category}</p><p className="mt-1 text-xs text-[var(--color-text-muted)] break-words">{expense.description || 'No description'} · {expense.createdByName || 'Unknown'}</p></div><span className="font-data text-sm font-bold text-red-700">{money(expense.amount)}</span></div><div className="mt-2 flex items-center justify-between gap-3 text-xs"><span className="text-[var(--color-text-muted)]">{statusText(expense.status)} · approved by {expense.approvedByName || 'N/A'}</span>{expense.hasReceipt ? <span className="text-emerald-700">Receipt attached</span> : <span className="text-red-700">Receipt missing</span>}</div></div>)}
                <PaginationControls compact page={expensePage} totalItems={filteredExpenses.length} pageSize={SIDEBAR_PAGE_SIZE} onPageChange={setExpensePage} />
              </div>
            </div>

            <div className="card p-5">
              <h2 className="section-title flex items-center gap-2"><FileWarning className="h-5 w-5 text-orange-600" /> Quick actions</h2>
              <div className="mt-4 grid grid-cols-1 gap-2"><button type="button" className="btn-secondary justify-start" onClick={() => navigate(`${base}/billing-counter`)}><Banknote className="h-4 w-4" /> Open counter module</button><button type="button" className="btn-secondary justify-start" onClick={() => navigate(`${base}/cash/handover`)}><HandCoins className="h-4 w-4" /> Review handovers</button><button type="button" className="btn-secondary justify-start" onClick={() => navigate(`${base}/cash/expenses`)}><FileImage className="h-4 w-4" /> Check expenses</button><button type="button" className="btn-secondary justify-start" onClick={() => navigate(`${base}/system-audit`)}><ShieldCheck className="h-4 w-4" /> Open audit log</button></div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

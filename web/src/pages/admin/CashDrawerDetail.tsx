import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileImage,
  HandCoins,
  Wallet,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { getTodayGMT6 } from '../../lib/date-utils';
import { formatCurrency, formatDateTime } from '../../lib/format';

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

interface CashControlResponse {
  latestMovements?: Array<{
    id: number | string;
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
    receiptAvailable: boolean;
    cashStatus?: string | null;
    sourceNo?: string | null;
    currentLocationLabel?: string | null;
    movementDirection?: 'in' | 'out' | 'transfer' | 'neutral';
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


interface CashLedgerEvent {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  eventType: string;
  status: string;
  cashStatus: string;
  movementDirection: 'in' | 'out' | 'transfer' | 'neutral';
  amount: number;
  dueAmount?: number | null;
  varianceAmount?: number | null;
  fromUserName?: string | null;
  toUserName?: string | null;
  counterSessionId?: number | null;
  counterId?: number | null;
  counterName?: string | null;
  currentLocationLabel?: string | null;
  accountingVoucherId?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  note?: string | null;
  createdAt: string;
  receivedAt?: string | null;
}

interface CashLedgerTrailResponse {
  sessionId: number;
  events?: CashLedgerEvent[];
}

const DETAIL_TABS = ['Summary', 'Transactions', 'Handover History'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

function money(value: number | null | undefined): string {
  return formatCurrency(Number(value ?? 0), { fractionDigits: 0 });
}

function statusText(status: string | null | undefined): string {
  const raw = String(status ?? '').trim();
  if (!raw) return '—';
  return raw.replace(/[_-]+/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function movementLabel(type: string): string {
  if (type === 'cash_in') return 'Cash added';
  if (type === 'cash_out') return 'Cash removed';
  if (type === 'cash_drop') return 'Cash drop';
  if (type === 'handover') return 'Handover';
  if (type === 'opening') return 'Opening cash';
  return statusText(type);
}

function movementAmount(row: NonNullable<CashControlResponse['latestMovements']>[number]): number {
  const amount = Number(row.amount ?? 0);
  if (row.movementDirection === 'out') return -Math.abs(amount);
  if (row.movementDirection === 'in') return Math.abs(amount);
  return row.movementType === 'cash_out' || row.movementType === 'cash_drop' ? -Math.abs(amount) : Math.abs(amount);
}

function movementBadgeClass(type: string): string {
  if (type === 'cash_in' || type === 'opening') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (type === 'cash_out' || type === 'cash_drop') return 'bg-red-50 text-red-700 border-red-100';
  if (type === 'handover') return 'bg-blue-50 text-blue-700 border-blue-100';
  return 'bg-slate-50 text-slate-700 border-slate-100';
}

function reasonText(row: NonNullable<CashControlResponse['latestMovements']>[number]): string {
  const reason = row.reason?.trim();
  const source = row.sourceNo ? `Ref ${row.sourceNo}` : '';
  const status = row.cashStatus ? statusText(row.cashStatus) : '';
  const location = row.currentLocationLabel ? row.currentLocationLabel : '';
  const reference = row.referenceType ? `${statusText(row.referenceType)}${row.referenceId ? ` #${row.referenceId}` : ''}` : '';
  const parts = [reason, source, status, location, reference].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No reason recorded';
}

function normalizeCounters(data: ActiveCountersResponse | ActiveCounter[] | undefined): ActiveCounter[] {
  if (Array.isArray(data)) return data;
  return data?.activeCounters ?? [];
}

export default function CashDrawerDetail() {
  const { drawerId = '' } = useParams<{ drawerId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DetailTab | null;
  const isValidTab = (value: string | null): value is DetailTab => value !== null && DETAIL_TABS.includes(value as DetailTab);
  const [activeTab, setActiveTabRaw] = useState<DetailTab>(() => (isValidTab(tabParam) ? tabParam : 'Summary'));
  const today = getTodayGMT6();

  const { data: activeCountersData, isLoading: countersLoading, isError: countersError } = useApiQuery<ActiveCountersResponse | ActiveCounter[]>(
    ['cash-drawer-detail', drawerId, 'active-counters'],
    '/api/dashboard/active-counters',
    { refetchInterval: 30000 },
  );

  const { data: cashControlData, isLoading: cashLoading, isError: cashError } = useApiQuery<CashControlResponse>(
    ['cash-drawer-detail', drawerId, 'cash-control', today],
    `/api/dashboard/cash-control?date=${today}`,
    { refetchInterval: 30000 },
  );

  const { data: ledgerTrailData, isLoading: ledgerLoading, isError: ledgerError } = useApiQuery<CashLedgerTrailResponse>(
    ['cash-drawer-detail', drawerId, 'ledger-trail'],
    `/api/cash-ledger/sessions/${drawerId}/trail?includeResolved=true&limit=500`,
    { refetchInterval: 30000 },
  );

  const activeCounters = normalizeCounters(activeCountersData);
  const session = activeCounters.find((counter) => String(counter.sessionId) === drawerId) ?? null;
  const ledgerEvents = ledgerTrailData?.events ?? [];
  const firstLedgerEvent = ledgerEvents[0] ?? null;
  const counterName = session?.counterName ?? firstLedgerEvent?.counterName ?? null;

  const ledgerMovements = useMemo(() => ledgerEvents.map((event) => ({
    id: event.id,
    movementType: event.movementDirection === 'out' ? 'cash_out' : event.movementDirection === 'in' ? 'cash_in' : event.sourceType === 'cash_custody_transfer' ? 'cash_drop' : 'handover',
    amount: Number(event.amount ?? 0),
    reason: event.note || event.eventType || event.sourceType,
    createdAt: event.createdAt,
    counterName: event.counterName ?? null,
    operatorName: event.fromUserName || event.toUserName || null,
    createdByName: event.fromUserName || 'System',
    referenceType: event.sourceType,
    referenceId: event.sourceId,
    receiptAvailable: Boolean(event.accountingVoucherId),
    cashStatus: event.cashStatus,
    sourceNo: event.sourceNo ?? null,
    currentLocationLabel: event.currentLocationLabel ?? null,
    movementDirection: event.movementDirection,
  })), [ledgerEvents]);

  const sessionMovements = useMemo(() => {
    if (ledgerMovements.length > 0) return ledgerMovements;
    const rows = cashControlData?.latestMovements ?? [];
    if (!counterName) return [];
    return rows.filter((row) => row.counterName === counterName);
  }, [cashControlData?.latestMovements, counterName, ledgerMovements]);

  const sessionHandovers = useMemo(() => {
    const rows = cashControlData?.latestHandovers ?? [];
    if (!counterName) return [];
    return rows.filter((row) => row.counterName === counterName);
  }, [cashControlData?.latestHandovers, counterName]);

  const sessionExpenses = useMemo(() => {
    const operatorName = session?.operatorName;
    const rows = cashControlData?.latestExpenses ?? [];
    if (!operatorName) return [];
    return rows.filter((row) => row.createdByName === operatorName || row.approvedByName === operatorName);
  }, [cashControlData?.latestExpenses, session?.operatorName]);

  const setActiveTab = (tab: DetailTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const hasLedgerTrail = ledgerEvents.length > 0;
  const isLoading = countersLoading || cashLoading || ledgerLoading;
  const hasError = countersError || cashError || ledgerError;
  const cashIn = session ? Number(session.cashIn ?? 0) + Number(session.manualCashIn ?? 0) : ledgerEvents.filter((event) => event.movementDirection === 'in').reduce((sum, event) => sum + Number(event.amount ?? 0), 0);
  const cashOut = session ? Number(session.cashOut ?? 0) + Number(session.manualCashOut ?? 0) + Number(session.cashDrop ?? 0) : ledgerEvents.filter((event) => event.movementDirection === 'out').reduce((sum, event) => sum + Number(event.amount ?? 0), 0);
  const openingCash = Number(session?.openingCash ?? ledgerEvents.filter((event) => event.eventType === 'DRAWER_OPENING').reduce((sum, event) => sum + Number(event.amount ?? 0), 0));
  const expectedCash = Number(session?.expectedCash ?? openingCash + cashIn - cashOut);
  const transactionCount = Number(session?.transactionCount ?? ledgerEvents.length);
  const displayOperatorName = session?.operatorName ?? firstLedgerEvent?.fromUserName ?? firstLedgerEvent?.toUserName ?? 'Unknown operator';
  const displayLocation = session?.location || session?.counterCode || firstLedgerEvent?.currentLocationLabel || 'Ledger trail';

  return (
    <DashboardLayout role="hospital_admin">
      <div className="mx-auto max-w-screen-2xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="../cash/drawers" relative="path" className="mb-3 inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)]">
              <ArrowLeft className="h-4 w-4" /> Back to Cash Control Ledger
            </Link>
            <h1 className="page-title">{counterName ?? `Cash drawer session #${drawerId}`}</h1>
            <p className="section-subtitle mt-1">
              {session
                ? `${session.operatorName} · ${session.location || session.counterCode || 'No location'} · opened ${formatDateTime(session.openedAt)}`
                : hasLedgerTrail
                  ? `${displayOperatorName} · ${displayLocation} · ledger trail from ${formatDateTime(firstLedgerEvent?.createdAt)}`
                  : 'Session detail is loaded from tenant cash-control data and the unified cash ledger trail.'}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${session ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {session ? 'Active session' : hasLedgerTrail ? 'Ledger trail available' : 'Session not active / not found'}
          </span>
        </div>

        {hasError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Cash drawer detail load করা যায়নি। Ledger page থেকে আবার চেষ্টা করুন।
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            <div className="skeleton h-28 rounded-xl" />
            <div className="skeleton h-64 rounded-xl" />
          </div>
        ) : !session && !hasLedgerTrail ? (
          <div className="card p-6">
            <h2 className="section-title">কাউন্টার সেশন পাওয়া যায়নি</h2>
            <p className="section-subtitle mt-2">
              এই session active counter API-তে নেই এবং unified cash ledger trail-ও পাওয়া যায়নি। Cash Control Ledger থেকে date/counter filter দিয়ে movement ও handover review করুন।
            </p>
            <Link to="../cash/drawers" relative="path" className="btn-primary mt-4 inline-flex">Open Cash Control Ledger</Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              {[
                { label: 'Opening cash', value: money(openingCash), tone: 'text-[var(--color-text-primary)]', icon: <Wallet className="h-4 w-4" /> },
                { label: 'Cash in', value: money(cashIn), tone: 'text-emerald-700', icon: <ArrowUpRight className="h-4 w-4" /> },
                { label: 'Cash out / drop', value: money(cashOut), tone: 'text-red-700', icon: <ArrowDownRight className="h-4 w-4" /> },
                { label: 'Expected cash', value: money(expectedCash), tone: 'text-blue-700', icon: <Wallet className="h-4 w-4" /> },
                { label: 'Transactions', value: transactionCount.toLocaleString(), tone: 'text-[var(--color-text-primary)]', icon: <Clock className="h-4 w-4" /> },
                { label: 'Cash movements', value: sessionMovements.length.toLocaleString(), tone: 'text-purple-700', icon: <ArrowRightLeft className="h-4 w-4" /> },
              ].map((card) => (
                <div key={card.label} className="card p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">{card.icon}{card.label}</div>
                  <p className={`font-data text-xl font-bold ${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {DETAIL_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${activeTab === tab ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'}`}
                >
                  {tab === 'Summary' && <Wallet className="h-4 w-4" />}
                  {tab === 'Transactions' && <Clock className="h-4 w-4" />}
                  {tab === 'Handover History' && <ArrowRightLeft className="h-4 w-4" />}
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'Summary' && (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="card p-5">
                  <h2 className="section-title">Cash calculation</h2>
                  <p className="section-subtitle mt-1">Opening cash + cash in - cash out/drop = expected drawer cash.</p>
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between border-b border-[var(--color-border)] pb-2"><span>Opening cash</span><strong>{money(openingCash)}</strong></div>
                    <div className="flex justify-between border-b border-[var(--color-border)] pb-2 text-emerald-700"><span>Cash sales / due collection</span><strong>+{money(session?.cashIn ?? cashIn)}</strong></div>
                    <div className="flex justify-between border-b border-[var(--color-border)] pb-2 text-emerald-700"><span>Manual cash added</span><strong>+{money(session?.manualCashIn ?? 0)}</strong></div>
                    <div className="flex justify-between border-b border-[var(--color-border)] pb-2 text-red-700"><span>Refund / return</span><strong>-{money(session?.cashOut ?? 0)}</strong></div>
                    <div className="flex justify-between border-b border-[var(--color-border)] pb-2 text-red-700"><span>Manual cash out</span><strong>-{money(session?.manualCashOut ?? 0)}</strong></div>
                    <div className="flex justify-between border-b border-[var(--color-border)] pb-2 text-red-700"><span>Cash drop / MD collection</span><strong>-{money(session?.cashDrop ?? cashOut)}</strong></div>
                    <div className="flex justify-between rounded-lg bg-blue-50 px-4 py-3 text-blue-800"><span className="font-semibold">Expected cash now</span><strong className="font-data text-lg">{money(expectedCash)}</strong></div>
                  </div>
                </div>

                <div className="card p-5">
                  <h2 className="section-title flex items-center gap-2"><FileImage className="h-5 w-5 text-purple-600" /> Expense evidence</h2>
                  <p className="section-subtitle mt-1">এই operator-এর latest expense/proof status.</p>
                  <div className="mt-4 space-y-3">
                    {sessionExpenses.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">No expense evidence found for this operator today.</p>
                    ) : sessionExpenses.map((expense) => (
                      <div key={expense.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div><p className="font-semibold">{expense.category}</p><p className="text-xs text-[var(--color-text-muted)]">{expense.description || 'No description'}</p></div>
                          <strong className="font-data text-red-700">{money(expense.amount)}</strong>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span>{statusText(expense.status)} · {expense.createdByName || 'Unknown'}</span>
                          <span className={expense.hasReceipt ? 'text-emerald-700' : 'text-red-700'}>{expense.hasReceipt ? 'Receipt attached' : 'Receipt missing'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'Transactions' && (
              <div className="card overflow-hidden">
                <div className="border-b border-[var(--color-border)] p-4">
                  <h2 className="section-title">Cash movement timeline</h2>
                  <p className="section-subtitle mt-1">Manual cash movement, cash drop, expense/handover reference এবং receipt status.</p>
                </div>
                {sessionMovements.length === 0 ? (
                  <div className="p-6 text-sm text-[var(--color-text-muted)]">No cash movement found for this counter today.</div>
                ) : (
                  <div className="divide-y divide-[var(--color-border)]">
                    {sessionMovements.map((movement) => {
                      const signedAmount = movementAmount(movement);
                      return (
                        <div key={movement.id} className="grid gap-3 p-4 lg:grid-cols-[160px_minmax(0,1fr)_160px] lg:items-center">
                          <div className="text-xs text-[var(--color-text-muted)]">{formatDateTime(movement.createdAt)}</div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${movementBadgeClass(movement.movementType)}`}>{movementLabel(movement.movementType)}</span>
                              {movement.receiptAvailable && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Receipt</span>}
                              {!movement.receiptAvailable && movement.referenceType === 'expense' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">No receipt</span>}
                            </div>
                            <p className="mt-2 font-medium text-[var(--color-text-primary)]">{reasonText(movement)}</p>
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{movement.operatorName || 'Unknown operator'} · created by {movement.createdByName || 'System'}</p>
                          </div>
                          <div className={`font-data text-lg font-bold lg:text-right ${signedAmount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{signedAmount < 0 ? '-' : '+'}{money(Math.abs(signedAmount))}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'Handover History' && (
              <div className="card overflow-hidden">
                <div className="border-b border-[var(--color-border)] p-4">
                  <h2 className="section-title flex items-center gap-2"><HandCoins className="h-5 w-5 text-blue-600" /> Handover history</h2>
                  <p className="section-subtitle mt-1">এই counter থেকে handover status, due এবং variance.</p>
                </div>
                {sessionHandovers.length === 0 ? (
                  <div className="p-6 text-sm text-[var(--color-text-muted)]">No handover found for this counter today.</div>
                ) : (
                  <div className="divide-y divide-[var(--color-border)]">
                    {sessionHandovers.map((handover) => (
                      <div key={handover.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_120px_120px_120px] lg:items-center">
                        <div>
                          <p className="font-semibold text-[var(--color-text-primary)]">{handover.fromName || 'Unknown'} → {handover.toName || 'Unassigned'}</p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{formatDateTime(handover.createdAt)} · {statusText(handover.status)}</p>
                        </div>
                        <div><p className="text-xs text-[var(--color-text-muted)]">Amount</p><p className="font-data font-bold">{money(handover.amount)}</p></div>
                        <div><p className="text-xs text-[var(--color-text-muted)]">Due</p><p className="font-data font-bold text-amber-700">{money(handover.dueAmount)}</p></div>
                        <div><p className="text-xs text-[var(--color-text-muted)]">Variance</p><p className={`font-data font-bold ${Number(handover.variance || 0) === 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money(handover.variance)}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

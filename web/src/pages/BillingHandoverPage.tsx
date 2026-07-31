import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, ArrowRightLeft, Banknote, CheckCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../hooks/useAuth';

const HANDOVER_ACTIVE_STALE_MS = 10 * 60_000;
const HANDOVER_STATIC_STALE_MS = 30 * 60_000;

interface Handover {
  id: number;
  handover_by?: number;
  handover_to?: number;
  handover_by_name?: string;
  handover_to_name?: string;
  handover_amount?: number;
  due_amount?: number;
  handover_type?: string;
  from_user?: string;
  to_user?: string;
  total_amount?: number;
  amount?: number;
  handover_date?: string;
  status?: 'pending' | 'partial' | 'disputed' | 'collected' | 'received' | 'verified';
  remarks?: string;
  created_at: string;
}

interface CounterPendingHandover {
  id: number;
  counterSessionId: number;
  handoverAmount: number;
  dueAmount?: number | null;
  status: 'pending' | 'partial' | 'disputed' | 'received' | 'verified' | 'collected';
  rowKey?: string;
  sourceType?: 'counter_handover' | 'cash_custody_transfer' | 'bank_deposit_request';
  sourceId?: string;
  sourceNo?: string | null;
  currentLocationLabel?: string | null;
  handoverDate?: string;
  handoverRemarks?: string | null;
  sessionNo?: string | null;
  counterName?: string | null;
  counterCode?: string | null;
  cashierName?: string | null;
  handoverToName?: string | null;
  closingCashDeclared?: number | null;
  expectedCash?: number | null;
  variance?: number | null;
  closedAt?: string | null;
}

export function getRemainingAdminCashAmount(
  item: Pick<CounterPendingHandover, 'status' | 'handoverAmount' | 'dueAmount'>,
): number {
  const total = Number(item.handoverAmount ?? 0);
  const due = Number(item.dueAmount ?? 0);
  if (['partial', 'disputed'].includes(item.status)) return Math.max(0, due);
  return due > 0 ? due : Math.max(0, total);
}

interface PendingCounterHandoversResponse {
  handovers: CounterPendingHandover[];
  totalPending: number;
  count: number;
}

interface CashLedgerTransfer {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  status: string;
  cashStatus?: string;
  amount: number;
  receivedAmount?: number | null;
  dueAmount?: number | null;
  fromUserName?: string | null;
  toUserName?: string | null;
  counterSessionId?: number | null;
  counterId?: number | null;
  counterName?: string | null;
  currentLocationType?: string | null;
  currentLocationLabel?: string | null;
  note?: string | null;
  createdAt: string;
  receivedAt?: string | null;
}

interface CashLedgerTransfersResponse {
  transfers: CashLedgerTransfer[];
}

interface AdminCollectionSummary {
  date: string;
  todayCollection: number;
  pendingCount: number;
  pendingAmount: number;
  counterBreakdown: Array<{
    counter_name?: string | null;
    counter_code?: string | null;
    session_count?: number;
    total_collected?: number;
  }>;
}

interface ActiveCounterResponse {
  active: boolean;
  session?: {
    id?: number;
    counterName?: string;
    counterCode?: string | null;
    expectedCash?: number;
    heldRefundCash?: number;
    availableCash?: number;
  } | null;
}

interface HandoverRecipient {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
}

interface MyPendingHandover {
  id: number;
  handover_amount: number;
  due_amount?: number | null;
  created_at?: string | null;
  handover_by_name?: string | null;
  counter_name?: string | null;
  counter_code?: string | null;
}

type HandoverPurpose = 'shift_transfer' | 'management_collection';
type HandoverWorkMode = 'shift' | 'management';

function normalizeWorkMode(value: string | null): HandoverWorkMode | null {
  return value === 'shift' || value === 'management' ? value : null;
}

function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}

function hasAnyPermission(permissions: readonly string[], values: readonly string[]): boolean {
  return values.some((permission) => hasPermission(permissions, permission));
}

export default function BillingHandoverPage({ role = 'hospital_admin' }: { role?: string }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const normalizeStatusFilter = (value: string | null) => (
    value === 'pending' || value === 'verified' || value === 'all' ? value : 'all'
  );
  const [statusFilter, setStatusFilterState] = useState(() => normalizeStatusFilter(searchParams.get('status')));
  const [partialCollect, setPartialCollect] = useState<Record<string, { amount: string; remarks: string }>>({});
  const [physicalCash, setPhysicalCash] = useState('');
  const [handoverTo, setHandoverTo] = useState('');
  const [handoverPurpose, setHandoverPurpose] = useState<HandoverPurpose>('shift_transfer');
  const [handoverRemarks, setHandoverRemarks] = useState('');
  const [acceptForms, setAcceptForms] = useState<Record<number, { amount: string; remarks: string; disputeReason: string }>>({});
  const { t } = useTranslation(['billing', 'common']);
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const normalizedRole = (user?.role ?? role) === 'receptionist' ? 'reception' : (user?.role ?? role);
  const legacyCounterShiftRole = ['reception', 'receptionist'].includes(normalizedRole);
  const legacyManagementRole = ['hospital_admin', 'md', 'director', 'accountant'].includes(normalizedRole);
  const isCounterShiftRole = legacyCounterShiftRole || hasAnyPermission(permissions, [
    'billing.counter.shift.read',
    'billing.counter.shift.auto_open',
    'billing.counter.shift.handover.receive',
    'billing.counter.handover.receive',
    'billing.counter.activate',
  ]);
  const managementCollectionAllowed = legacyManagementRole || hasAnyPermission(permissions, [
    'billing.counter.management_cash.read',
    'billing.counter.management_cash.receive',
    'accounting:read',
    'accounting:write',
  ]);
  const hasBothHandoverModes = isCounterShiftRole && managementCollectionAllowed;
  const requestedMode = normalizeWorkMode(searchParams.get('mode'));
  const defaultMode: HandoverWorkMode = legacyCounterShiftRole && !legacyManagementRole ? 'shift' : 'management';
  const activeMode: HandoverWorkMode = hasBothHandoverModes
    ? (requestedMode ?? defaultMode)
    : isCounterShiftRole
      ? 'shift'
      : 'management';
  const showShiftHandover = isCounterShiftRole && (!hasBothHandoverModes || activeMode === 'shift');
  const showManagementCollection = managementCollectionAllowed && (!hasBothHandoverModes || activeMode === 'management');
  const setActiveMode = (nextMode: HandoverWorkMode) => {
    const params = new URLSearchParams(searchParams);
    params.set('mode', nextMode);
    setSearchParams(params);
  };
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setHandoverRemarks(''); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  useEffect(() => {
    setStatusFilterState(normalizeStatusFilter(searchParams.get('status')));
  }, [searchParams]);

  const setStatusFilter = (next: string) => {
    const normalized = normalizeStatusFilter(next);
    setStatusFilterState(normalized);
    const params = new URLSearchParams(searchParams);
    if (normalized === 'all') params.delete('status'); else params.set('status', normalized);
    setSearchParams(params);
  };

  const queryParams = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
  const { data, isLoading: loading } = useApiQuery<{ handovers: Handover[] }>(
    queryKeys.billingHandover.list({ status: statusFilter }),
    `/api/billing-handover${queryParams}`,
  );

  const legacyHandovers = data?.handovers ?? [];
  const { data: cashLedgerTransfersData, isLoading: loadingCashLedgerTransfers } = useApiQuery<CashLedgerTransfersResponse>(
    ['cash-ledger', 'handover-transfers'],
    '/api/cash-ledger/transfers?includeResolved=true&limit=500',
    { staleTime: HANDOVER_ACTIVE_STALE_MS },
  );
  const cashLedgerTransfers = cashLedgerTransfersData?.transfers ?? [];
  const { data: adminSummary, isLoading: loadingAdminSummary } = useApiQuery<AdminCollectionSummary>(
    ['billing-counter', 'admin', 'collection-summary', today],
    `/api/billing-counter/admin/collection-summary?date=${today}`,
    { enabled: showManagementCollection },
  );
  const { data: counterHandoversData, isLoading: loadingCounterHandovers } = useApiQuery<PendingCounterHandoversResponse>(
    ['billing-counter', 'admin', 'pending-handovers'],
    '/api/billing-counter/admin/pending-handovers',
    { enabled: showManagementCollection },
  );
  const { data: activeCounterData, isLoading: loadingActiveCounter } = useApiQuery<ActiveCounterResponse>(
    ['billing-counter', 'active-session', 'handover-page'],
    '/api/billing-counter/sessions/active',
    { enabled: showShiftHandover, staleTime: HANDOVER_ACTIVE_STALE_MS },
  );
  const { data: recipientsData } = useApiQuery<{ recipients: HandoverRecipient[] }>(
    ['billing-counter', 'handover-recipients', 'handover-page', handoverPurpose],
    `/api/billing-counter/handover-recipients?purpose=${handoverPurpose}`,
    { enabled: showShiftHandover, staleTime: HANDOVER_STATIC_STALE_MS },
  );
  const { data: myPendingHandoversData } = useApiQuery<{ handovers: MyPendingHandover[] }>(
    ['billing-counter', 'pending-handovers', 'handover-page'],
    '/api/billing-counter/handovers/pending',
    { enabled: showShiftHandover, staleTime: HANDOVER_ACTIVE_STALE_MS },
  );
  const activeCounter = activeCounterData?.session ?? null;
  const expectedCash = Number(activeCounter?.expectedCash ?? 0);
  const heldRefundCash = Number(activeCounter?.heldRefundCash ?? 0);
  const availableCash = Number(activeCounter?.availableCash ?? Math.max(0, expectedCash - heldRefundCash));
  const declaredCash = physicalCash === '' ? availableCash : Number(physicalCash);
  const variance = declaredCash - availableCash;
  const myPendingHandovers = myPendingHandoversData?.handovers ?? [];
  const isLedgerResolved = (transfer: CashLedgerTransfer) => ['received', 'verified', 'collected'].includes(transfer.status) || ['ADMIN_CUSTODY', 'COUNTER_CUSTODY', 'BANKED'].includes(transfer.cashStatus ?? '');
  const isSuccessStatus = (status: string | null | undefined) => ['verified', 'collected', 'received'].includes(status ?? '');
  const shouldUseCashLedgerTransfers = Array.isArray(cashLedgerTransfersData?.transfers);
  const ledgerHandovers: Handover[] = cashLedgerTransfers
    .filter((transfer) => {
      if (statusFilter === 'verified') return isLedgerResolved(transfer);
      if (statusFilter === 'pending') return !isLedgerResolved(transfer);
      return true;
    })
    .map((transfer, index) => ({
      id: Number(transfer.sourceId) || index + 1,
      handover_by_name: transfer.fromUserName ?? undefined,
      handover_to_name: transfer.toUserName ?? undefined,
      handover_amount: Number(transfer.amount ?? 0),
      due_amount: Number(transfer.dueAmount ?? 0),
      handover_type: transfer.sourceType,
      from_user: transfer.fromUserName ?? undefined,
      to_user: transfer.toUserName ?? undefined,
      amount: Number(transfer.amount ?? 0),
      handover_date: transfer.createdAt?.slice(0, 10),
      status: (isLedgerResolved(transfer) ? 'verified' : transfer.status || 'pending') as Handover['status'],
      remarks: transfer.sourceNo || transfer.note || transfer.currentLocationLabel || undefined,
      created_at: transfer.createdAt,
    }));
  const handovers = shouldUseCashLedgerTransfers ? ledgerHandovers : legacyHandovers;
  const pendingCounterHandovers = counterHandoversData?.handovers ?? [];
  const adminPendingAmount = pendingCounterHandovers.reduce((sum, item) => sum + getRemainingAdminCashAmount(item), 0);  const adminPendingCount = pendingCounterHandovers.length;
  const adminCashToday = Number(adminSummary?.todayCollection ?? 0);

  const amountFor = (h: Handover) => Number(h.handover_amount ?? h.total_amount ?? h.amount ?? 0);
  const dueFor = (h: Handover) => Number(h.due_amount ?? 0);
  const total    = handovers.reduce((s, h) => s + amountFor(h), 0);
  const verified = handovers.filter(h => isSuccessStatus(h.status)).length;
  const pending  = handovers.filter(h => !isSuccessStatus(h.status)).length;

  const verifyMutation = useApiMutation<unknown, number>(
    'put',
    (id) => `/api/billing-handover/${id}/verify`,
    {
      onSuccess: () => {
        toast.success(t('handoverVerified', { defaultValue: 'Handover verified' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.billingHandover.all });
      },
      onError: () => { toast.error(t('failed', { ns: 'common', defaultValue: 'Failed' })); },
    },
  );

  const refreshAdminCollection = () => {
    queryClient.invalidateQueries({ queryKey: ['billing-counter', 'admin'] });
    queryClient.invalidateQueries({ queryKey: ['billing-counter', 'admin', 'pending-handovers'] });
    queryClient.invalidateQueries({ queryKey: ['billing-counter', 'admin', 'collection-summary'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.billingHandover.all });
    queryClient.invalidateQueries({ queryKey: ['cash-ledger'] });
  };

  const refreshHandoverState = () => {
    refreshAdminCollection();
    queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
  };

  const closeCounter = useApiMutation<unknown, { closingCash: number; handoverTo: number; handoverAmount: number; handoverPurpose?: HandoverPurpose; remarks?: string }>(
    'post',
    () => `/api/billing-counter/sessions/${activeCounter?.id ?? 0}/close`,
    {
      onSuccess: () => {
        toast.success(t('shiftHandoverInitiated', { defaultValue: 'Shift handover initiated' }));
        setPhysicalCash('');
        setHandoverTo('');
        setHandoverPurpose('shift_transfer');
        setHandoverRemarks('');
        refreshHandoverState();
      },
      onError: (err) => toast.error(err.message || t('failedHandoverShift', { defaultValue: 'Failed to handover shift' })),
    },
  );

  const acceptHandover = useApiMutation<unknown, { handoverId: number; receivedAmount: number; remarks?: string; disputeReason?: string }>(
    'post',
    (vars) => `/api/billing-counter/handovers/${vars.handoverId}/accept`,
    {
      onSuccess: (_res, vars) => {
        toast.success(vars.disputeReason ? t('handoverAcceptedWithDispute', { defaultValue: 'Handover accepted with dispute' }) : t('shiftStartedFromHandover', { defaultValue: 'Shift started from handover' }));
        setAcceptForms((current) => ({ ...current, [vars.handoverId]: { amount: '', remarks: '', disputeReason: '' } }));
        refreshHandoverState();
      },
      onError: (err) => toast.error(err.message || t('failedAcceptHandover', { defaultValue: 'Failed to accept handover' })),
    },
  );

  const collectMutation = useApiMutation<unknown, { id: number }>(
    'post',
    (vars) => `/api/billing-counter/admin/collect/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('adminCashCollected', { defaultValue: 'Admin cash collection recorded' }));
        refreshAdminCollection();
      },
      onError: (err) => toast.error(err.message || t('failed', { ns: 'common', defaultValue: 'Failed' })),
    },
  );

  const partialCollectMutation = useApiMutation<unknown, { id: number; collectedAmount: number; remarks?: string }>(
    'post',
    (vars) => `/api/billing-counter/admin/partial-collect/${vars.id}`,
    {
      onSuccess: (_res, vars) => {
        toast.success(t('partialCashCollected', { defaultValue: 'Partial cash collection recorded' }));
        setPartialCollect((current) => ({ ...current, [String(vars.id)]: { amount: '', remarks: '' } }));
        refreshAdminCollection();
      },
      onError: (err) => toast.error(err.message || t('failed', { ns: 'common', defaultValue: 'Failed' })),
    },
  );

  const receiveCustodyTransferMutation = useApiMutation<unknown, { id: number; receivedAmount: number; note?: string }>(
    'post',
    (vars) => `/api/payment-methods/drawer-custody/transfers/${vars.id}/receive`,
    {
      onSuccess: () => {
        toast.success(t('adminCashCollected', { defaultValue: 'Admin cash collection recorded' }));
        refreshAdminCollection();
      },
      onError: (err) => toast.error(err.message || t('failed', { ns: 'common', defaultValue: 'Failed' })),
    },
  );

  const handleVerify = (id: number) => {
    verifyMutation.mutate(id);
  };

  const pendingAmountFor = (h: CounterPendingHandover) => (
    getRemainingAdminCashAmount(h)  );

  const rowKeyFor = (handover: CounterPendingHandover) => handover.rowKey ?? String(handover.id);

  const submitPartialCollect = (handover: CounterPendingHandover) => {
    const rowKey = rowKeyFor(handover);
    const state = partialCollect[rowKey] ?? { amount: '', remarks: '' };
    const amount = Number(state.amount);
    const pendingAmount = pendingAmountFor(handover);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t('enterCollectionAmountGreaterThanZero', { defaultValue: 'Enter a collection amount greater than zero' }));
      return;
    }
    if (amount > pendingAmount) {
      toast.error(t('collectionAmountCannotExceedPending', { defaultValue: 'Collection amount cannot exceed pending cash' }));
      return;
    }
    if (handover.sourceType === 'cash_custody_transfer') {
      receiveCustodyTransferMutation.mutate({
        id: Number(handover.sourceId ?? handover.id),
        receivedAmount: amount,
        note: state.remarks || undefined,
      });
      return;
    }
    partialCollectMutation.mutate({
      id: handover.id,
      collectedAmount: amount,
      remarks: state.remarks || undefined,
    });
  };

  const submitFullCollect = (handover: CounterPendingHandover) => {
    const pendingAmount = pendingAmountFor(handover);
    if (handover.sourceType === 'cash_custody_transfer') {
      receiveCustodyTransferMutation.mutate({
        id: Number(handover.sourceId ?? handover.id),
        receivedAmount: pendingAmount,
        note: 'Admin cash collection confirmed',
      });
      return;
    }
    collectMutation.mutate({ id: handover.id });
  };

  const expectedForMyHandover = (handover: MyPendingHandover) => (
    Math.max(0, Number(handover.handover_amount ?? 0) - Number(handover.due_amount ?? 0))
  );

  const updateAcceptForm = (handoverId: number, patch: Partial<{ amount: string; remarks: string; disputeReason: string }>) => {
    setAcceptForms((current) => {
      const existing = current[handoverId] ?? { amount: '', remarks: '', disputeReason: '' };
      return {
        ...current,
        [handoverId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <ArrowRightLeft className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('handoverTitle', { defaultValue: 'Billing Handover' })}</h1>
              <p className="section-subtitle">{t('handoverSubtitle', { defaultValue: 'Shift handover & cash transfer records' })}</p>
            </div>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
            {t('handoverCounterSessionControlled', { defaultValue: 'Counter-session controlled' })}
          </span>
        </div>

        {hasBothHandoverModes ? (
          <div className="card p-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeMode === 'shift' ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
              onClick={() => setActiveMode('shift')}
            >
              {t('receptionShiftMode', { defaultValue: 'Reception Shift' })}
            </button>
            <button
              type="button"
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeMode === 'management' ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
              onClick={() => setActiveMode('management')}
            >
              {t('managementCollectionMode', { defaultValue: 'Management Collection' })}
            </button>
          </div>
        ) : null}

        {showShiftHandover ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KPICard title={t('totalTransferred', { defaultValue: 'Total Transferred' })} value={`৳${total.toLocaleString()}`} loading={loading || loadingCashLedgerTransfers} icon={<ArrowRightLeft className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
            <KPICard title={t('verified', { ns: 'billing', defaultValue: 'Verified' })} value={verified} loading={loading || loadingCashLedgerTransfers} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
            <KPICard title={t('pendingVerify', { defaultValue: 'Pending Verify' })} value={pending} loading={loading || loadingCashLedgerTransfers} icon={<ArrowRightLeft className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={2} />
          </div>
        ) : null}

        {showShiftHandover ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="card p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{t('shiftHandoverTitle', { defaultValue: 'Shift Handover' })}</h2>
                <p className="text-sm text-[var(--color-text-muted)]">{t('shiftHandoverDesc', { defaultValue: 'Close the active counter and hand cash to the next user. Manual amount-only handovers are disabled.' })}</p>
              </div>
              <Banknote className="h-5 w-5 text-emerald-600" />
            </div>
            {loadingActiveCounter ? (
              <div className="skeleton h-36 rounded-xl" />
            ) : !activeCounter ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {t('noActiveCounterSession', { defaultValue: 'No active counter session found. Open a billing counter before creating a shift handover.' })}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                    <div className="text-xs text-[var(--color-text-muted)]">{t('counter', { defaultValue: 'Counter' })}</div>
                    <div className="font-semibold text-[var(--color-text-primary)]">{activeCounter.counterName ?? activeCounter.counterCode ?? `#${activeCounter.id}`}</div>
                  </div>
                  <div className="rounded-xl bg-blue-50 p-3">
                    <div className="text-xs text-blue-700">Expected drawer cash</div>
                    <div className="font-data text-xl font-semibold text-blue-900">৳{money(expectedCash)}</div>
                  </div>
                  <div className="rounded-xl bg-amber-50 p-3">
                    <div className="text-xs text-amber-700">Pending refund reserve</div>
                    <div className="font-data text-xl font-semibold text-amber-900">৳{money(heldRefundCash)}</div>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3">
                    <div className="text-xs text-emerald-700">Available handover cash</div>
                    <div className="font-data text-xl font-semibold text-emerald-900">৳{money(availableCash)}</div>
                  </div>
                  <div>
                    <label className="label">Available cash counted *</label>
                    <input aria-label="Available cash counted for handover" className="input" type="number" min={0} value={physicalCash} onChange={(e) => setPhysicalCash(e.target.value)} placeholder={String(availableCash)} />
                  </div>
                </div>
                {variance !== 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <AlertTriangle className="h-4 w-4" /> {t('varianceAmount', { defaultValue: 'Variance {{amount}}', amount: formatSignedMoney(variance) })}
                    </div>
                    <label className="label mt-2">{t('varianceReasonRequired', { defaultValue: 'Shortage / excess reason *' })}</label>
                    <textarea className="input min-h-20" value={handoverRemarks} onChange={(e) => setHandoverRemarks(e.target.value)} placeholder={t('varianceReasonPlaceholder', { defaultValue: 'Explain why physical cash does not match system cash.' })} />
                  </div>
                ) : (
                  <div>
                    <label className="label">{t('remarks', { ns: 'billing', defaultValue: 'Remarks' })}</label>
                    <input className="input" value={handoverRemarks} onChange={(e) => setHandoverRemarks(e.target.value)} placeholder={t('handoverNotePlaceholder', { defaultValue: 'Optional handover note' })} />
                  </div>
                )}
                <div>
                  <label className="label">{t('handoverPurpose', { defaultValue: 'Handover purpose' })}</label>
                  <select className="input" value={handoverPurpose} onChange={(e) => { setHandoverPurpose(e.target.value as HandoverPurpose); setHandoverTo(''); }}>
                    <option value="shift_transfer">{t('shiftTransferPurpose', { defaultValue: 'Reception shift transfer' })}</option>
                    <option value="management_collection">{t('managementCollectionPurpose', { defaultValue: 'Management cash collection' })}</option>
                  </select>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{handoverPurpose === 'shift_transfer' ? t('shiftTransferPurposeHint', { defaultValue: 'Receiver will count cash and start/continue a counter shift.' }) : t('managementCollectionPurposeHint', { defaultValue: 'Receiver will collect cash as management custody without starting a shift.' })}</p>
                </div>
                <div>
                  <label className="label">{t('handoverToRequired', { defaultValue: 'Handover to *' })}</label>
                  <select className="input" value={handoverTo} onChange={(e) => setHandoverTo(e.target.value)}>
                    <option value="">{t('selectNextRecipient', { defaultValue: 'Select next receptionist/admin' })}</option>
                    {(recipientsData?.recipients ?? []).map((user) => (
                      <option key={user.id} value={user.id}>{user.name}{user.role ? ` - ${user.role}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={closeCounter.isPending || !activeCounter?.id || !handoverTo || physicalCash === '' || (variance !== 0 && !handoverRemarks.trim())}
                    onClick={() => closeCounter.mutate({
                      closingCash: declaredCash,
                      handoverAmount: declaredCash,
                      handoverTo: Number(handoverTo),
                      handoverPurpose,
                      remarks: handoverRemarks.trim() || undefined,
                    })}
                  >
                    {closeCounter.isPending ? t('submitting', { ns: 'common', defaultValue: 'Submitting...' }) : t('initiateShiftHandover', { defaultValue: 'Initiate Shift Handover' })}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{t('pendingForMe', { defaultValue: 'Pending For Me' })}</h2>
                <p className="text-sm text-[var(--color-text-muted)]">{t('pendingForMeDesc', { defaultValue: 'Count received cash. If it does not match, record dispute before starting the counter.' })}</p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-sky-600" />
            </div>
            {myPendingHandovers.length === 0 ? (
              <div className="rounded-xl border border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-text-muted)]">
                {t('noPendingHandoverToAccept', { defaultValue: 'No pending handover to accept.' })}
              </div>
            ) : (
              <div className="space-y-3">
                {myPendingHandovers.map((handover) => {
                  const expected = expectedForMyHandover(handover);
                  const state = acceptForms[handover.id] ?? { amount: '', remarks: '', disputeReason: '' };
                  const received = Number(state.amount);
                  const hasMismatch = state.amount !== '' && received !== expected;
                  return (
                    <div key={handover.id} className="rounded-xl border border-[var(--color-border)] p-3">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{handover.handover_by_name ?? t('previousUser', { defaultValue: 'Previous user' })}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{handover.counter_name ?? handover.counter_code ?? `Handover #${handover.id}`}</div>
                        </div>
                        <div className="font-data text-lg font-semibold text-emerald-700">৳{money(expected)}</div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="label">{t('cashCountedRequired', { defaultValue: 'Cash counted *' })}</label>
                          <input className="input" type="number" min={0} value={state.amount} onChange={(e) => updateAcceptForm(handover.id, { amount: e.target.value })} placeholder={String(expected)} />
                        </div>
                        <div>
                          <label className="label">{t('acceptanceRemarks', { defaultValue: 'Acceptance remarks' })}</label>
                          <input className="input" value={state.remarks} onChange={(e) => updateAcceptForm(handover.id, { remarks: e.target.value })} placeholder={t('optionalNote', { defaultValue: 'Optional note' })} />
                        </div>
                      </div>
                      {hasMismatch ? (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
                          <div className="text-sm font-semibold text-red-800">{t('mismatchAmount', { defaultValue: 'Mismatch {{amount}}', amount: formatSignedMoney(received - expected) })}</div>
                          <label className="label mt-2">{t('disputeNoteRequired', { defaultValue: 'Dispute / shortage note *' })}</label>
                          <textarea className="input min-h-16" value={state.disputeReason} onChange={(e) => updateAcceptForm(handover.id, { disputeReason: e.target.value })} />
                        </div>
                      ) : null}
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={acceptHandover.isPending || state.amount === '' || (hasMismatch && !state.disputeReason.trim())}
                          onClick={() => acceptHandover.mutate({
                            handoverId: handover.id,
                            receivedAmount: Number(state.amount),
                            remarks: state.remarks.trim() || undefined,
                            disputeReason: state.disputeReason.trim() || undefined,
                          })}
                        >
                          {hasMismatch ? t('disputeAndStartShift', { defaultValue: 'Dispute & Start Shift' }) : t('acceptAndStartShift', { defaultValue: 'Accept & Start Shift' })}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
        ) : managementCollectionAllowed ? (
          <section className="card p-5">
            <h2 className="font-semibold">{t('managementCashReceivingTitle', { defaultValue: 'Management cash receiving' })}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t('managementCashReceivingDesc', { defaultValue: 'Admin, MD, director and accountant accounts do not start reception shifts from this page. Use Management Cash Collection below to receive counter cash assigned to management.' })}
            </p>
          </section>
        ) : null}

        {showManagementCollection && (
          <section className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KPICard title={t('adminTodayCollection', { defaultValue: 'Management cash today' })} value={`৳${adminCashToday.toLocaleString()}`} loading={loadingAdminSummary} icon={<Banknote className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={0} />
              <KPICard title={t('adminPendingCash', { defaultValue: 'Pending management cash' })} value={`৳${adminPendingAmount.toLocaleString()}`} loading={loadingCounterHandovers} icon={<ArrowRightLeft className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={1} />
              <KPICard title={t('adminPendingHandovers', { defaultValue: 'Pending management handovers' })} value={adminPendingCount} loading={loadingCounterHandovers} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-sky-50 text-sky-600" index={2} />
            </div>

            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
                <div>
                  <h2 className="font-semibold">{t('adminCashCollection', { defaultValue: 'Management Cash Collection' })}</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">{t('adminCashCollectionDesc', { defaultValue: 'Receive cash assigned to admin, MD, director or accountant. Reception-to-reception shift transfers stay out of this collection list.' })}</p>
                </div>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">৳{adminPendingAmount.toLocaleString()}</span>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {loadingCounterHandovers ? [...Array(3)].map((_, i) => (
                  <div key={i} className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr_1fr_1.5fr_auto]">
                    {[...Array(5)].map((_, j) => <div key={j} className="skeleton h-12 rounded-xl" />)}
                  </div>
                ))
                : pendingCounterHandovers.length === 0
                ? <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">{t('noPendingAdminCash', { defaultValue: 'No pending counter cash handover.' })}</div>
                : pendingCounterHandovers.map((h) => {
                    const pendingCash = pendingAmountFor(h);
                    const rowKey = rowKeyFor(h);
                    const state = partialCollect[rowKey] ?? { amount: '', remarks: '' };
                    return (
                      <div key={rowKey} className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr_1fr_1.6fr_auto] lg:items-center">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('sourceLabel', { defaultValue: 'Source' })}</p>
                          <div className="mt-1 truncate font-semibold text-[var(--color-text-primary)]">{h.counterName ?? h.currentLocationLabel ?? `#${h.counterSessionId}`}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{h.counterCode ?? h.sourceNo ?? h.sessionNo ?? `Session ${h.counterSessionId}`}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="badge badge-info">{h.sourceType === 'cash_custody_transfer' ? t('cashCustodyTransfer', { defaultValue: 'Cash transfer' }) : t('counterShiftHandover', { defaultValue: 'Counter shift handover' })}</span>
                            {h.handoverToName ? <span className="badge badge-neutral">{t('assignedTo', { defaultValue: 'Assigned to' })}: {h.handoverToName}</span> : null}
                          </div>
                        </div>

                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('fromStaff', { defaultValue: 'From' })}</p>
                          <div className="mt-1 truncate font-medium text-[var(--color-text-primary)]">{h.cashierName ?? '—'}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{t('cashReceiverHint', { defaultValue: 'Management collection only' })}</div>
                        </div>

                        <div className="font-data">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('amountLabel', { defaultValue: 'Amount (৳)' })}</p>
                          <div className="mt-1 text-lg font-bold text-[var(--color-text-primary)]">৳{Number(h.handoverAmount ?? 0).toLocaleString()}</div>
                          {pendingCash > 0 ? <div className="text-xs font-semibold text-amber-700">Pending ৳{pendingCash.toLocaleString()}</div> : null}
                          {Number(h.variance ?? 0) !== 0 ? <div className="text-xs text-red-600">Variance ৳{Number(h.variance ?? 0).toLocaleString()}</div> : null}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('partialCollection', { defaultValue: 'Partial collection' })}</p>
                            <span className="badge badge-warning">{h.status}</span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                            <input
                              aria-label={`Collect amount for handover ${h.id}`}
                              className="input h-10"
                              type="number"
                              min="0"
                              step="0.01"
                              value={state.amount}
                              onChange={(e) => setPartialCollect((current) => ({ ...current, [rowKey]: { ...state, amount: e.target.value } }))}
                              placeholder={String(pendingCash)}
                            />
                            <button type="button" className="btn-secondary h-10 whitespace-nowrap" onClick={() => submitPartialCollect(h)} disabled={partialCollectMutation.isPending || receiveCustodyTransferMutation.isPending}>
                              {t('partialCollect', { defaultValue: 'Partial' })}
                            </button>
                          </div>
                          <input
                            aria-label={`Collection remarks for handover ${h.id}`}
                            className="input h-10"
                            value={state.remarks}
                            onChange={(e) => setPartialCollect((current) => ({ ...current, [rowKey]: { ...state, remarks: e.target.value } }))}
                            placeholder={t('remarks', { ns: 'billing', defaultValue: 'Remarks' })}
                          />
                        </div>

                        <div className="flex lg:justify-end">
                          <button type="button" className="btn-primary w-full whitespace-nowrap lg:w-auto" onClick={() => submitFullCollect(h)} disabled={collectMutation.isPending || receiveCustodyTransferMutation.isPending}>
                            <Banknote className="w-4 h-4" />
                            {['partial', 'disputed'].includes(h.status) ? t('collectRemaining', { defaultValue: 'Collect remaining' }) : t('receiveCash', { defaultValue: 'Receive cash' })}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </section>
        )}

        <div className="card p-3 flex gap-2">
          {['all', 'pending', 'verified'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${statusFilter === s ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{t(`handoverFilter_${s}`, { defaultValue: s === 'all' ? 'All' : s })}</button>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('fromStaff', { defaultValue: 'From' })}</th><th>{t('toStaff', { defaultValue: 'To' })}</th><th>{t('amountLabel', { defaultValue: 'Amount (৳)' })}</th><th>{t('date', { ns: 'common', defaultValue: 'Date' })}</th><th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th><th>{t('remarks', { ns: 'billing', defaultValue: 'Remarks' })}</th><th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th></tr></thead>
              <tbody>
                {(loading || loadingCashLedgerTransfers) ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                : handovers.length === 0
                ? <tr><td colSpan={7}><EmptyState icon={<ArrowRightLeft className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noHandoverRecords', { defaultValue: 'No handover records' })} description={t('noHandoverRecordsDesc', { defaultValue: 'No records found. Close an active counter to create a handover.' })} /></td></tr>
                : handovers.map(h => (
                    <tr key={`${h.handover_type ?? 'legacy'}:${h.id}`}>
                      <td className="font-medium">{h.handover_by_name ?? h.from_user ?? (h.handover_by ? `#${h.handover_by}` : '—')}</td>
                      <td>{h.handover_to_name ?? h.to_user ?? (h.handover_to ? `#${h.handover_to}` : '—')}</td>
                      <td className="text-right">
                        <div className="font-data font-medium">৳{amountFor(h).toLocaleString()}</div>
                        {dueFor(h) > 0 ? <div className="text-xs text-amber-700">Due ৳{dueFor(h).toLocaleString()}</div> : null}
                      </td>
                      <td className="font-data text-sm">{formatDateTime(h.created_at ?? h.handover_date)}</td>
                      <td><span className={`badge ${isSuccessStatus(h.status) ? 'badge-success' : 'badge-warning'}`}>{h.status ?? 'pending'}</span></td>
                      <td className="text-[var(--color-text-secondary)]">{h.remarks ?? '—'}</td>
                      <td>{!shouldUseCashLedgerTransfers && !isSuccessStatus(h.status) && <button onClick={() => handleVerify(h.id)} className="btn-ghost p-1.5 text-emerald-600" title="Verify"><CheckCircle className="w-4 h-4" /></button>}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </DashboardLayout>
  );
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}

function formatSignedMoney(value: number) {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}৳${money(value)}`;
}

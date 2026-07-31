import { useEffect, useState } from 'react';
import { Calendar, DollarSign, TrendingUp, TrendingDown, ArrowRightLeft, Landmark, Wallet, HandCoins, FileImage, CheckCircle2, Eye, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiMutation, useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6 } from '../lib/date-utils';
import { formatDateTime } from '../lib/format';
import { apiBlob } from '../lib/blobFetch';
import { api } from '../lib/apiClient';

interface CashSummary {
  date: string;
  openingCash: number;
  cashCollection: number;
  cashExpense: number;
  cashRefund: number;
  manualCashIn: number;
  manualCashOut: number;
  cashDrop: number;
  handoverCash: number;
  closingCash: number;
}

interface CashTransactions {
  date: string;
  collections: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  refunds: Record<string, unknown>[];
  manualMovements: Array<{
    id: number;
    movementType: string;
    amount: number;
    reason: string;
    createdAt: string;
    counterName: string | null;
    operatorName: string | null;
    receiptAvailable: boolean;
    referenceType: string | null;
    referenceId: string | null;
  }>;
}

interface BankSummary {
  date: string;
  totalDeposits: number;
  totalSettlements: number;
  totalPayments: number;
  netBankMovement: number;
}

interface BankTransaction {
  id: number;
  type: string;
  amount: number;
  bank_name?: string;
  date: string;
  created_at: string;
}

interface CashLedgerBalance {
  key: string;
  label: string;
  amount: number;
}

interface CashLedgerBalancesResponse {
  balances: CashLedgerBalance[];
}


interface CashLedgerReconciliationCheck {
  key: string;
  label: string;
  status: 'pass' | 'warning' | 'fail';
  expectedAmount?: number;
  actualAmount?: number;
  details: string;
}

interface CashLedgerReconciliationResponse {
  status: 'pass' | 'warning' | 'fail';
  generatedAt: string;
  checks: CashLedgerReconciliationCheck[];
}

interface CashLedgerShadowRow {
  key: string;
  label: string;
  status: 'pass' | 'warning' | 'fail' | 'blocked';
  sourceAvailable: boolean;
  sourceCount: number;
  sourceAmount: number;
  shadowCount: number;
  shadowAmount: number;
  differenceCount: number;
  differenceAmount: number;
  details: string;
}

interface CashLedgerShadowBlockedFlow {
  key: string;
  label: string;
  reason: string;
}

interface CashLedgerShadowReconciliationResponse {
  status: 'pass' | 'warning' | 'fail';
  generatedAt: string;
  rows: CashLedgerShadowRow[];
  blockedFlows: CashLedgerShadowBlockedFlow[];
}

interface CashLedgerHistoricalRow {
  key: string;
  label: string;
  eventType: string;
  sourceTable: string;
  status: 'ready' | 'warning' | 'fail';
  sourceCount: number;
  sourceAmount: number;
  existingShadowCount: number;
  existingShadowAmount: number;
  missingCount: number;
  missingAmount: number;
  duplicateRisk: boolean;
  details: string;
}

interface CashLedgerHistoricalReportResponse {
  status: 'ready' | 'warning' | 'fail';
  generatedAt: string;
  rows: CashLedgerHistoricalRow[];
  totals: {
    sourceCount: number;
    sourceAmount: number;
    existingShadowCount: number;
    existingShadowAmount: number;
    missingCount: number;
    missingAmount: number;
  };
  blockedFlows: CashLedgerShadowBlockedFlow[];
}

interface CashLedgerShadowLogEntry {
  id: number;
  sourceType: string;
  sourceId: string;
  eventType: string;
  idempotencyKey: string | null;
  issueMessage: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface CashLedgerShadowLogResponse {
  issues: CashLedgerShadowLogEntry[];
}

interface CashLedgerReadinessCheck {
  key: string;
  label: string;
  status: 'pass' | 'warning' | 'fail';
  details: string;
}

interface CashLedgerReadinessResponse {
  status: string;
  ready: boolean;
  generatedAt: string;
  checks: CashLedgerReadinessCheck[];
  pendingItems: CashLedgerShadowBlockedFlow[];
}

interface BankDepositRequest {
  id: number;
  requestNo: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'resolved' | string;
  proposedBankName?: string | null;
  confirmedBankName?: string | null;
  confirmedReferenceNo?: string | null;
  depositProofUrl?: string | null;
  depositProofNote?: string | null;
  depositProofKey?: string | null;
  depositProofUploadedAt?: string | null;
  createdAt?: string | null;
  cashierName?: string | null;
  counterName?: string | null;
  rejectionReason?: string | null;
}

interface ConfirmDepositForm {
  bankName: string;
  referenceNo: string;
  depositDate: string;
  confirmedAmount: string;
  proofUrl: string;
  proofNote: string;
}

function fmt(n: number) {
  return `\u09F3${n.toLocaleString('en-BD')}`;
}

type Tab = 'cash' | 'bank';

export default function CashBankBook({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantBilling']);
  const queryClient = useQueryClient();
  const [date, setDate] = useState(getTodayGMT6());
  const [activeTab, setActiveTab] = useState<Tab>('cash');
  const [confirmForms, setConfirmForms] = useState<Record<number, ConfirmDepositForm>>({});
  const [rejectReasons, setRejectReasons] = useState<Record<number, string>>({});
  const [expenseReceiptUrl, setExpenseReceiptUrl] = useState<string | null>(null);
  const [uploadingProofId, setUploadingProofId] = useState<number | null>(null);

  const { data: cashData, isLoading: cashLoading } = useApiQuery<{ data: CashSummary }>(
    queryKeys.cashBook.summary(date),
    `/api/cash-book?date=${date}`,
    { enabled: activeTab === 'cash' },
  );

  const { data: txnData, isLoading: txnLoading } = useApiQuery<{ data: CashTransactions }>(
    queryKeys.cashBook.transactions(date),
    `/api/cash-book/transactions?date=${date}`,
    { enabled: activeTab === 'cash' },
  );

  const { data: cashLedgerBalancesData, isLoading: cashLedgerBalancesLoading } = useApiQuery<CashLedgerBalancesResponse>(
    ['cash-ledger', 'balances', date],
    `/api/cash-ledger/balances?date=${date}&includeResolved=true&limit=1000`,
    { enabled: activeTab === 'cash' },
  );

  const { data: cashLedgerReconciliationData, isLoading: cashLedgerReconciliationLoading } = useApiQuery<CashLedgerReconciliationResponse>(
    ['cash-ledger', 'reconciliation', date],
    `/api/cash-ledger/reconciliation?date=${date}&includeResolved=true&limit=1000`,
    { enabled: activeTab === 'cash' },
  );

  const { data: shadowReconciliationData, isLoading: shadowReconciliationLoading } = useApiQuery<CashLedgerShadowReconciliationResponse>(
    ['cash-ledger', 'shadow-reconciliation', date],
    `/api/cash-ledger/shadow-reconciliation?date=${date}&includeResolved=true&limit=1000`,
    { enabled: activeTab === 'cash' },
  );

  const { data: historicalReportData, isLoading: historicalReportLoading } = useApiQuery<CashLedgerHistoricalReportResponse>(
    ['cash-ledger', 'historical-report', date],
    `/api/cash-ledger/historical-report?date=${date}&includeResolved=true&limit=1000`,
    { enabled: activeTab === 'cash' },
  );

  const { data: readinessData, isLoading: readinessLoading } = useApiQuery<CashLedgerReadinessResponse>(
    ['cash-ledger', 'ready-check', date],
    `/api/cash-ledger/readiness?date=${date}&includeResolved=true&limit=1000`,
    { enabled: activeTab === 'cash' },
  );

  const { data: shadowLogData, isLoading: shadowLogLoading } = useApiQuery<CashLedgerShadowLogResponse>(
    ['cash-ledger', 'shadow-log', date],
    `/api/cash-ledger/shadow-log?date=${date}&limit=50`,
    { enabled: activeTab === 'cash' },
  );

  const { data: bankData, isLoading: bankLoading } = useApiQuery<{ data: BankSummary }>(
    queryKeys.bankBook.summary(date),
    `/api/bank-book?date=${date}`,
    { enabled: activeTab === 'bank' },
  );

  const { data: bankTxnData, isLoading: bankTxnLoading } = useApiQuery<{ data: BankTransaction[] }>(
    queryKeys.bankBook.transactions(date),
    `/api/bank-book/transactions?date=${date}`,
    { enabled: activeTab === 'bank' },
  );

  const { data: bankDepositRequestData, isLoading: bankDepositRequestsLoading } = useApiQuery<{ requests: BankDepositRequest[] }>(
    ['bank-book', 'deposit-requests', 'pending'],
    '/api/bank-book/deposit-requests?status=pending',
    { enabled: activeTab === 'bank' },
  );

  async function handleBankDepositProofUpload(requestId: number, file: File | undefined, inputEl: HTMLInputElement | null) {
    if (!file) return;
    setUploadingProofId(requestId);
    try {
      const uploadData = new FormData();
      uploadData.append('proof', file);
      const response = await api.post<{ depositProofUrl?: string }>(`/api/bank-book/deposit-requests/${requestId}/proof`, uploadData);
      if (response.depositProofUrl) updateConfirmForm({ id: requestId, amount: 0 } as BankDepositRequest, { proofUrl: response.depositProofUrl });
      toast.success('Bank deposit proof uploaded');
      queryClient.invalidateQueries({ queryKey: ['bank-book', 'deposit-requests'] });
    } catch (error: any) {
      toast.error(error?.message || 'Failed to upload deposit proof');
    } finally {
      setUploadingProofId(null);
      if (inputEl) inputEl.value = '';
    }
  }

  const confirmBankDeposit = useApiMutation<
    { request: BankDepositRequest },
    { id: number; bankName: string; referenceNo: string; depositDate: string; confirmedAmount: number; proofUrl?: string; proofNote?: string }
  >(
    'post',
    (vars) => `/api/bank-book/deposit-requests/${vars.id}/confirm`,
    {
      onSuccess: () => {
        toast.success(t('cashBankBook.toast.depositConfirmed'));
        queryClient.invalidateQueries({ queryKey: ['bank-book', 'deposit-requests'] });
        queryClient.invalidateQueries({ queryKey: queryKeys.bankBook.summary(date) });
        queryClient.invalidateQueries({ queryKey: queryKeys.bankBook.transactions(date) });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const rejectBankDeposit = useApiMutation<
    { request: BankDepositRequest },
    { id: number; reason: string }
  >(
    'post',
    (vars) => `/api/bank-book/deposit-requests/${vars.id}/reject`,
    {
      onSuccess: () => {
        toast.success(t('cashBankBook.toast.depositRejected'));
        queryClient.invalidateQueries({ queryKey: ['bank-book', 'deposit-requests'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const cash = cashData?.data;
  const cashTxns = txnData?.data;
  const cashLedgerBalances = cashLedgerBalancesData?.balances ?? [];
  const cashLedgerAmount = (key: string) => Number(cashLedgerBalances.find((item) => item.key === key)?.amount ?? 0);
  const activeDrawerCash = cashLedgerAmount('active_drawer_cash');
  const pendingTransferCash = cashLedgerAmount('pending_transfer_cash') + cashLedgerAmount('bank_deposit_pending_cash');
  const custodyCash = cashLedgerAmount('admin_custody_cash') + cashLedgerAmount('counter_custody_cash') + cashLedgerAmount('banked_cash');
  const disputedCash = cashLedgerAmount('disputed_cash');
  const reconciliationStatus = cashLedgerReconciliationData?.status ?? 'pass';
  const reconciliationChecks = cashLedgerReconciliationData?.checks ?? [];
  const reconciliationTone = reconciliationStatus === 'fail' ? 'red' : reconciliationStatus === 'warning' ? 'amber' : 'emerald';
  const shadowStatus = shadowReconciliationData?.status ?? 'pass';
  const shadowRows = shadowReconciliationData?.rows ?? [];
  const shadowBlockedFlows = shadowReconciliationData?.blockedFlows ?? [];
  const shadowTone = shadowStatus === 'fail' ? 'red' : shadowStatus === 'warning' ? 'amber' : 'emerald';
  const historicalStatus = historicalReportData?.status ?? 'ready';
  const historicalRows = historicalReportData?.rows ?? [];
  const historicalTotals = historicalReportData?.totals;
  const historicalBlockedFlows = historicalReportData?.blockedFlows ?? [];
  const historicalTone = historicalStatus === 'fail' ? 'red' : historicalStatus === 'warning' ? 'amber' : 'emerald';
  const readinessStatus = readinessData?.status ?? 'attention';
  const readinessChecks = readinessData?.checks ?? [];
  const readinessPendingItems = readinessData?.pendingItems ?? [];
  const readinessTone = readinessData?.ready ? 'emerald' : readinessStatus === 'action_required' ? 'red' : 'amber';
  const shadowLogEntries = shadowLogData?.issues ?? [];
  const bank = bankData?.data;
  const bankTxns = bankTxnData?.data ?? [];
  const bankDepositRequests = bankDepositRequestData?.requests ?? [];

  const getConfirmForm = (request: BankDepositRequest): ConfirmDepositForm => confirmForms[request.id] ?? {
    bankName: request.proposedBankName ?? '',
    referenceNo: request.confirmedReferenceNo ?? '',
    depositDate: date,
    confirmedAmount: String(request.amount),
    proofUrl: request.depositProofUrl ?? '',
    proofNote: request.depositProofNote ?? '',
  };

  const updateConfirmForm = (request: BankDepositRequest, patch: Partial<ConfirmDepositForm>) => {
    setConfirmForms((current) => ({
      ...current,
      [request.id]: { ...getConfirmForm(request), ...patch },
    }));
  };

  const openExpenseReceipt = async (expenseId: number) => {
    try {
      setExpenseReceiptUrl(URL.createObjectURL(await apiBlob(`/api/expenses/${expenseId}/receipt`)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load voucher');
    }
  };

  useEffect(() => () => {
    if (expenseReceiptUrl?.startsWith('blob:')) URL.revokeObjectURL(expenseReceiptUrl);
  }, [expenseReceiptUrl]);

  const TABS = [
    { key: 'cash' as Tab, label: t('cashBankBook.tab.cash'), icon: <Wallet className="w-4 h-4" /> },
    { key: 'bank' as Tab, label: t('cashBankBook.tab.bank'), icon: <Landmark className="w-4 h-4" /> },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('cashBankBook.title')}</h1>
              <p className="section-subtitle">{t('cashBankBook.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="date"
              className="input w-40"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto border-b border-[var(--color-border)] p-2 hide-scrollbar">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
              }`}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Cash Book Tab */}
        {activeTab === 'cash' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title={t('cashBankBook.kpi.cashCollection')}
                value={cashLoading ? '' : fmt(cash?.cashCollection ?? 0)}
                icon={<TrendingUp className="w-5 h-5" />}
                iconBg="bg-emerald-50 text-emerald-600"
                loading={cashLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.cashExpense')}
                value={cashLoading ? '' : fmt(cash?.cashExpense ?? 0)}
                icon={<TrendingDown className="w-5 h-5" />}
                iconBg="bg-red-50 text-red-600"
                loading={cashLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.cashRefund')}
                value={cashLoading ? '' : fmt(cash?.cashRefund ?? 0)}
                icon={<ArrowRightLeft className="w-5 h-5" />}
                iconBg="bg-amber-50 text-amber-600"
                loading={cashLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.netCash')}
                value={cashLoading ? '' : fmt(cash?.closingCash ?? 0)}
                icon={<DollarSign className="w-5 h-5" />}
                iconBg="bg-blue-50 text-blue-600"
                loading={cashLoading}
              />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title={t('cashBankBook.kpi.manualCashOut')}
                value={cashLoading ? '' : fmt(cash?.manualCashOut ?? 0)}
                icon={<TrendingDown className="w-5 h-5" />}
                iconBg="bg-orange-50 text-orange-600"
                loading={cashLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.manualCashIn')}
                value={cashLoading ? '' : fmt(cash?.manualCashIn ?? 0)}
                icon={<TrendingUp className="w-5 h-5" />}
                iconBg="bg-sky-50 text-sky-600"
                loading={cashLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.handoverCash')}
                value={cashLoading ? '' : fmt(cash?.handoverCash ?? 0)}
                icon={<HandCoins className="w-5 h-5" />}
                iconBg="bg-amber-50 text-amber-600"
                loading={cashLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.cashDrop')}
                value={cashLoading ? '' : fmt(cash?.cashDrop ?? 0)}
                icon={<Wallet className="w-5 h-5" />}
                iconBg="bg-slate-100 text-slate-600"
                loading={cashLoading}
              />
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-title">Cash ledger readiness</h2>
                  <p className="section-subtitle mt-1">Combined status for shadow reconciliation, historical dry-run, write log, and pending flow decisions.</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${readinessTone === 'red' ? 'bg-red-50 text-red-700' : readinessTone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}
                >
                  {readinessLoading ? 'Checking...' : readinessData?.ready ? 'READY' : readinessStatus.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
              {readinessLoading ? (
                <div className="skeleton h-24 w-full rounded-lg" />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    {readinessChecks.map((check) => (
                      <div key={check.key} className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-[var(--color-text-primary)]">{check.label}</p>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${check.status === 'fail' ? 'bg-red-50 text-red-700' : check.status === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{check.status.toUpperCase()}</span>
                        </div>
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">{check.details}</p>
                      </div>
                    ))}
                  </div>
                  {readinessPendingItems.length > 0 && (
                    <p className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">{readinessPendingItems.length} pending flow decision(s) still block full canonical cutover.</p>
                  )}
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-title">Cash custody position</h2>
                  <p className="section-subtitle mt-1">Drawer, pending transfer, received custody, and dispute buckets from the unified cash ledger.</p>
                </div>
                <Wallet className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-xs font-medium text-emerald-700">Active drawer cash</p>
                  <p className="mt-2 font-data text-xl font-bold text-emerald-900">{cashLedgerBalancesLoading ? '...' : fmt(activeDrawerCash)}</p>
                </div>
                <div className="rounded-xl bg-amber-50 p-4">
                  <p className="text-xs font-medium text-amber-700">Pending / in transit</p>
                  <p className="mt-2 font-data text-xl font-bold text-amber-900">{cashLedgerBalancesLoading ? '...' : fmt(pendingTransferCash)}</p>
                </div>
                <div className="rounded-xl bg-blue-50 p-4">
                  <p className="text-xs font-medium text-blue-700">Admin / bank custody</p>
                  <p className="mt-2 font-data text-xl font-bold text-blue-900">{cashLedgerBalancesLoading ? '...' : fmt(custodyCash)}</p>
                </div>
                <div className="rounded-xl bg-red-50 p-4">
                  <p className="text-xs font-medium text-red-700">Disputed / short</p>
                  <p className="mt-2 font-data text-xl font-bold text-red-900">{cashLedgerBalancesLoading ? '...' : fmt(disputedCash)}</p>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-title">Cash reconciliation checks</h2>
                  <p className="section-subtitle mt-1">Enterprise guardrails from the unified cash ledger reconciliation endpoint.</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${reconciliationTone === 'red' ? 'bg-red-50 text-red-700' : reconciliationTone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {cashLedgerReconciliationLoading ? 'Checking...' : reconciliationStatus.toUpperCase()}
                </span>
              </div>
              {cashLedgerReconciliationLoading ? (
                <div className="skeleton h-24 w-full rounded-lg" />
              ) : reconciliationChecks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">No reconciliation checks returned for this date.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {reconciliationChecks.map((check) => (
                    <div key={check.key} className={`rounded-xl border p-4 ${check.status === 'fail' ? 'border-red-100 bg-red-50' : check.status === 'warning' ? 'border-amber-100 bg-amber-50' : 'border-emerald-100 bg-emerald-50'}`}>
                      <div className="flex items-start gap-2">
                        {check.status === 'pass' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" /> : <X className={`mt-0.5 h-4 w-4 ${check.status === 'fail' ? 'text-red-700' : 'text-amber-700'}`} />}
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{check.label}</p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{check.details}</p>
                          {(check.expectedAmount !== undefined || check.actualAmount !== undefined) && (
                            <p className="mt-2 font-data text-xs text-[var(--color-text-muted)]">
                              {check.expectedAmount !== undefined ? `Expected ${fmt(Number(check.expectedAmount))}` : ''}
                              {check.expectedAmount !== undefined && check.actualAmount !== undefined ? ' · ' : ''}
                              {check.actualAmount !== undefined ? `Actual ${fmt(Number(check.actualAmount))}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-title">Shadow ledger coverage</h2>
                  <p className="section-subtitle mt-1">Compares old source tables with cash_ledger_entries before any cutover decision.</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${shadowTone === 'red' ? 'bg-red-50 text-red-700' : shadowTone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {shadowReconciliationLoading ? 'Checking...' : shadowStatus.toUpperCase()}
                </span>
              </div>
              {shadowReconciliationLoading ? (
                <div className="skeleton h-28 w-full rounded-lg" />
              ) : shadowRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">No shadow reconciliation rows returned for this date.</p>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="table-base text-sm">
                      <thead>
                        <tr>
                          <th>Flow</th>
                          <th>Status</th>
                          <th className="text-right">Source</th>
                          <th className="text-right">Shadow</th>
                          <th className="text-right">Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shadowRows.map((row) => (
                          <tr key={row.key}>
                            <td>
                              <p className="font-medium text-[var(--color-text-primary)]">{row.label}</p>
                              <p className="mt-1 max-w-xl text-xs text-[var(--color-text-muted)]">{row.details}</p>
                            </td>
                            <td>
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'fail' ? 'bg-red-50 text-red-700' : row.status === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                {row.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="text-right font-data">{fmt(Number(row.sourceAmount))}<br /><span className="text-xs text-[var(--color-text-muted)]">{row.sourceCount} rows</span></td>
                            <td className="text-right font-data">{fmt(Number(row.shadowAmount))}<br /><span className="text-xs text-[var(--color-text-muted)]">{row.shadowCount} rows</span></td>
                            <td className={`text-right font-data ${Number(row.differenceAmount) === 0 && Number(row.differenceCount) === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                              {fmt(Math.abs(Number(row.differenceAmount)))}<br />
                              <span className="text-xs text-[var(--color-text-muted)]">{row.differenceCount} rows</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {shadowBlockedFlows.length > 0 && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                      <p className="text-sm font-semibold text-amber-800">Blocked before cutover</p>
                      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {shadowBlockedFlows.map((flow) => (
                          <div key={flow.key} className="rounded-lg bg-white/70 p-3">
                            <p className="text-sm font-medium text-[var(--color-text-primary)]">{flow.label}</p>
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{flow.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-title">Historical ledger dry-run</h2>
                  <p className="section-subtitle mt-1">Read-only estimate of old cash rows that still need canonical ledger entries before cutover.</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${historicalTone === 'red' ? 'bg-red-50 text-red-700' : historicalTone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {historicalReportLoading ? 'Checking...' : historicalStatus.toUpperCase()}
                </span>
              </div>
              {historicalReportLoading ? (
                <div className="skeleton h-28 w-full rounded-lg" />
              ) : historicalRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">No historical ledger dry-run rows returned for this date.</p>
              ) : (
                <div className="space-y-4">
                  {historicalTotals && (
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <div className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
                        <p className="text-xs text-[var(--color-text-muted)]">Source total</p>
                        <p className="mt-1 font-data text-lg font-semibold">{fmt(Number(historicalTotals.sourceAmount))}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{historicalTotals.sourceCount} rows</p>
                      </div>
                      <div className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
                        <p className="text-xs text-[var(--color-text-muted)]">Existing ledger</p>
                        <p className="mt-1 font-data text-lg font-semibold">{fmt(Number(historicalTotals.existingShadowAmount))}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{historicalTotals.existingShadowCount} rows</p>
                      </div>
                      <div className="rounded-xl bg-amber-50 p-3">
                        <p className="text-xs text-amber-700">Missing estimate</p>
                        <p className="mt-1 font-data text-lg font-semibold text-amber-800">{fmt(Number(historicalTotals.missingAmount))}</p>
                        <p className="text-xs text-amber-700">{historicalTotals.missingCount} rows</p>
                      </div>
                      <div className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
                        <p className="text-xs text-[var(--color-text-muted)]">Mode</p>
                        <p className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">Read-only</p>
                        <p className="text-xs text-[var(--color-text-muted)]">No write/backfill action</p>
                      </div>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="table-base text-sm">
                      <thead>
                        <tr>
                          <th>Flow</th>
                          <th>Status</th>
                          <th className="text-right">Source</th>
                          <th className="text-right">Existing ledger</th>
                          <th className="text-right">Missing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historicalRows.map((row) => (
                          <tr key={row.key}>
                            <td>
                              <p className="font-medium text-[var(--color-text-primary)]">{row.label}</p>
                              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.sourceTable} → {row.eventType}</p>
                              <p className="mt-1 max-w-xl text-xs text-[var(--color-text-muted)]">{row.details}</p>
                            </td>
                            <td>
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === 'fail' ? 'bg-red-50 text-red-700' : row.status === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                {row.status.toUpperCase()}
                              </span>
                              {row.duplicateRisk && <p className="mt-1 text-xs text-red-700">Duplicate risk</p>}
                            </td>
                            <td className="text-right font-data">{fmt(Number(row.sourceAmount))}<br /><span className="text-xs text-[var(--color-text-muted)]">{row.sourceCount} rows</span></td>
                            <td className="text-right font-data">{fmt(Number(row.existingShadowAmount))}<br /><span className="text-xs text-[var(--color-text-muted)]">{row.existingShadowCount} rows</span></td>
                            <td className={`text-right font-data ${Number(row.missingAmount) > 0 || Number(row.missingCount) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                              {fmt(Number(row.missingAmount))}<br />
                              <span className="text-xs text-[var(--color-text-muted)]">{row.missingCount} rows</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {historicalBlockedFlows.length > 0 && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                      <p className="text-sm font-semibold text-amber-800">Backfill blocked flows</p>
                      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {historicalBlockedFlows.map((flow) => (
                          <div key={flow.key} className="rounded-lg bg-white/70 p-3">
                            <p className="text-sm font-medium text-[var(--color-text-primary)]">{flow.label}</p>
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{flow.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-title">Shadow write log</h2>
                  <p className="section-subtitle mt-1">Recent non-blocking canonical ledger write issues for this date.</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${shadowLogEntries.length > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {shadowLogLoading ? 'Checking...' : shadowLogEntries.length > 0 ? `${shadowLogEntries.length} OPEN` : 'CLEAR'}
                </span>
              </div>
              {shadowLogLoading ? (
                <div className="skeleton h-24 w-full rounded-lg" />
              ) : shadowLogEntries.length === 0 ? (
                <p className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">No shadow write issues found for this date.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base text-sm">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Source</th>
                        <th>Event</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shadowLogEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="text-xs text-[var(--color-text-muted)]">{formatDateTime(entry.createdAt)}</td>
                          <td>
                            <p className="font-medium text-[var(--color-text-primary)]">{entry.sourceType}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">#{entry.sourceId}</p>
                          </td>
                          <td>
                            <p className="text-sm text-[var(--color-text-primary)]">{entry.eventType}</p>
                            {entry.idempotencyKey && <p className="mt-1 max-w-xs truncate text-xs text-[var(--color-text-muted)]">{entry.idempotencyKey}</p>}
                          </td>
                          <td className="max-w-md text-xs text-amber-700">{entry.issueMessage}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Transactions */}
            {txnLoading ? (
              <div className="card p-5">
                <div className="skeleton h-32 w-full rounded-lg" />
              </div>
            ) : cashTxns ? (
              <div className="space-y-4">
                {/* Collections */}
                {cashTxns.collections.length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-[var(--color-border)] bg-emerald-50/50 dark:bg-emerald-500/5">
                      <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{t('cashBankBook.section.collections')}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="table-base text-sm">
                        <thead>
                          <tr>
                            <th>{t('cashBankBook.column.type')}</th>
                            <th className="text-right">{t('cashBankBook.column.amount')}</th>
                            <th>{t('cashBankBook.column.time')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashTxns.collections.map((txn: Record<string, unknown>, i: number) => (
                            <tr key={i}>
                              <td>{txn.transaction_type as string}</td>
                              <td className="text-right font-data">{fmt(Number(txn.amount) || 0)}</td>
                              <td className="text-xs text-[var(--color-text-muted)]">{formatDateTime(txn.transaction_date as string)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Expenses */}
                {cashTxns.expenses.length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-[var(--color-border)] bg-red-50/50 dark:bg-red-500/5">
                      <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">{t('cashBankBook.section.expenses')}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="table-base text-sm">
                        <thead>
                          <tr>
                            <th>{t('cashBankBook.column.category')}</th>
                            <th className="text-right">{t('cashBankBook.column.amount')}</th>
                            <th>{t('cashBankBook.column.receipt')}</th>
                            <th>{t('cashBankBook.column.time')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashTxns.expenses.map((txn: Record<string, unknown>, i: number) => (
                            <tr key={i}>
                              <td>{txn.category as string}</td>
                              <td className="text-right font-data">{fmt(Number(txn.amount) || 0)}</td>
                              <td>
                                {txn.receipt_key ? (
                                  <button
                                    type="button"
                                    aria-label={`View voucher for expense ${txn.id}`}
                                    onClick={() => openExpenseReceipt(Number(txn.id))}
                                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    {t('cashBankBook.receiptAttached')}
                                    <Eye className="w-3 h-3" />
                                  </button>
                                ) : (
                                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{t('cashBankBook.missing')}</span>
                                )}
                              </td>
                              <td className="text-xs text-[var(--color-text-muted)]">{formatDateTime(txn.created_at as string)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Manual Drawer Movements */}
                {(cashTxns.manualMovements ?? []).length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-[var(--color-border)] bg-sky-50/50 dark:bg-sky-500/5">
                      <h3 className="text-sm font-semibold text-sky-700 dark:text-sky-400">{t('cashBankBook.section.manualMovements')}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="table-base text-sm">
                        <thead>
                          <tr>
                            <th>{t('cashBankBook.column.movement')}</th>
                            <th>{t('cashBankBook.column.reason')}</th>
                            <th>{t('cashBankBook.column.operator')}</th>
                            <th>{t('cashBankBook.column.counter')}</th>
                            <th>{t('cashBankBook.column.receipt')}</th>
                            <th className="text-right">{t('cashBankBook.column.amount')}</th>
                            <th>{t('cashBankBook.column.time')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashTxns.manualMovements.map((txn) => (
                            <tr key={txn.id}>
                              <td>{txn.movementType.replace(/_/g, ' ')}</td>
                              <td className="font-medium">{txn.reason || '-'}</td>
                              <td>{txn.operatorName || '-'}</td>
                              <td>{txn.counterName || '-'}</td>
                              <td>
                                {txn.receiptAvailable ? (
                                  txn.referenceId && ['expense', 'expense_pending'].includes(txn.referenceType ?? '') ? (
                                    <button
                                      type="button"
                                      aria-label={`View voucher for manual expense ${txn.referenceId}`}
                                      onClick={() => openExpenseReceipt(Number(txn.referenceId))}
                                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                                    >
                                      <FileImage className="w-3 h-3" />
                                      {t('cashBankBook.receiptAttached')}
                                      <Eye className="w-3 h-3" />
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                      <FileImage className="w-3 h-3" />
                                      {t('cashBankBook.receiptAttached')}
                                    </span>
                                  )
                                ) : (
                                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{t('cashBankBook.noReceipt')}</span>
                                )}
                              </td>
                              <td className="text-right font-data">{fmt(Number(txn.amount) || 0)}</td>
                              <td className="text-xs text-[var(--color-text-muted)]">{formatDateTime(txn.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Refunds */}
                {cashTxns.refunds.length > 0 && (
                  <div className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-[var(--color-border)] bg-amber-50/50 dark:bg-amber-500/5">
                      <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">{t('cashBankBook.section.refunds')}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="table-base text-sm">
                        <thead>
                          <tr>
                            <th>{t('cashBankBook.column.type')}</th>
                            <th className="text-right">{t('cashBankBook.column.amount')}</th>
                            <th>{t('cashBankBook.column.time')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cashTxns.refunds.map((txn: Record<string, unknown>, i: number) => (
                            <tr key={i}>
                              <td>{txn.transaction_type as string}</td>
                              <td className="text-right font-data">{fmt(Number(txn.amount) || 0)}</td>
                              <td className="text-xs text-[var(--color-text-muted)]">{formatDateTime(txn.transaction_date as string)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {cashTxns.collections.length === 0 && cashTxns.expenses.length === 0 && cashTxns.refunds.length === 0 && (cashTxns.manualMovements ?? []).length === 0 && (
                  <EmptyState
                    icon={<ArrowRightLeft className="w-8 h-8 text-[var(--color-text-muted)]" />}
                    title={t('cashBankBook.empty.title')}
                    description={t('cashBankBook.empty.description')}
                  />
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Bank Book Tab */}
        {activeTab === 'bank' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title={t('cashBankBook.kpi.totalDeposits')}
                value={bankLoading ? '' : fmt(bank?.totalDeposits ?? 0)}
                icon={<TrendingUp className="w-5 h-5" />}
                iconBg="bg-emerald-50 text-emerald-600"
                loading={bankLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.cardSettlements')}
                value={bankLoading ? '' : fmt(bank?.totalSettlements ?? 0)}
                icon={<ArrowRightLeft className="w-5 h-5" />}
                iconBg="bg-blue-50 text-blue-600"
                loading={bankLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.supplierPayments')}
                value={bankLoading ? '' : fmt(bank?.totalPayments ?? 0)}
                icon={<TrendingDown className="w-5 h-5" />}
                iconBg="bg-red-50 text-red-600"
                loading={bankLoading}
              />
              <KPICard
                title={t('cashBankBook.kpi.netBankMovement')}
                value={bankLoading ? '' : fmt(bank?.netBankMovement ?? 0)}
                icon={<Landmark className="w-5 h-5" />}
                iconBg="bg-violet-50 text-violet-600"
                loading={bankLoading}
              />
            </div>

            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="section-title">{t('cashBankBook.bank.depositRequests')}</h2>
                <p className="text-sm text-[var(--color-text-muted)]">{t('cashBankBook.bank.depositRequestsDescription')}</p>
              </div>
              {bankDepositRequestsLoading ? (
                <div className="p-5">
                  <div className="skeleton h-24 w-full rounded-lg" />
                </div>
              ) : bankDepositRequests.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<HandCoins className="w-8 h-8 text-[var(--color-text-muted)]" />}
                    title={t('cashBankBook.empty.depositTitle')}
                    description={t('cashBankBook.empty.depositDescription')}
                  />
                </div>
              ) : (
                <div className="divide-y divide-[var(--color-border)]">
                  {bankDepositRequests.map((request) => {
                    const form = getConfirmForm(request);
                    const rejectReason = rejectReasons[request.id] ?? '';
                    const hasProof = Boolean(request.depositProofUrl || request.depositProofKey || form.proofUrl.trim());
                    return (
                      <div key={request.id} className="grid gap-4 p-5 xl:grid-cols-[1fr_2fr]">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{request.requestNo}</span>
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold capitalize text-amber-700">{request.status}</span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <div className="text-xs text-[var(--color-text-muted)]">{t('cashBankBook.bank.field.amount')}</div>
                              <div className="font-data font-semibold">{fmt(Number(request.amount) || 0)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-[var(--color-text-muted)]">{t('cashBankBook.bank.field.counter')}</div>
                              <div>{request.counterName || '-'}</div>
                            </div>
                            <div>
                              <div className="text-xs text-[var(--color-text-muted)]">{t('cashBankBook.bank.field.cashier')}</div>
                              <div>{request.cashierName || '-'}</div>
                            </div>
                            <div>
                              <div className="text-xs text-[var(--color-text-muted)]">{t('cashBankBook.bank.field.requested')}</div>
                              <div>{formatDateTime(request.createdAt)}</div>
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[1fr_1fr_140px_140px_auto] md:items-end">
                          <div>
                            <label className="label">{t('cashBankBook.bank.form.bankName')}</label>
                            <input
                              aria-label={t('cashBankBook.bank.form.bankNameAria', { requestNo: request.requestNo })}
                              className="input"
                              value={form.bankName}
                              onChange={(event) => updateConfirmForm(request, { bankName: event.target.value })}
                            />
                          </div>
                          <div>
                            <label className="label">{t('cashBankBook.bank.form.referenceNo')}</label>
                            <input
                              aria-label={t('cashBankBook.bank.form.referenceNoAria', { requestNo: request.requestNo })}
                              className="input"
                              value={form.referenceNo}
                              onChange={(event) => updateConfirmForm(request, { referenceNo: event.target.value })}
                            />
                          </div>
                          <div>
                            <label className="label">{t('cashBankBook.bank.form.depositDate')}</label>
                            <input
                              aria-label={t('cashBankBook.bank.form.depositDateAria', { requestNo: request.requestNo })}
                              className="input"
                              type="date"
                              value={form.depositDate}
                              onChange={(event) => updateConfirmForm(request, { depositDate: event.target.value })}
                            />
                          </div>
                          <div>
                            <label className="label">{t('cashBankBook.bank.form.confirmedAmount')}</label>
                            <input
                              aria-label={t('cashBankBook.bank.form.confirmedAmountAria', { requestNo: request.requestNo })}
                              className="input"
                              type="number"
                              min="0"
                              value={form.confirmedAmount}
                              onChange={(event) => updateConfirmForm(request, { confirmedAmount: event.target.value })}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn-primary justify-center"
                            disabled={confirmBankDeposit.isPending || !form.bankName.trim() || !form.referenceNo.trim() || Number(form.confirmedAmount) <= 0 || !hasProof}
                            onClick={() => confirmBankDeposit.mutate({
                              id: request.id,
                              bankName: form.bankName.trim(),
                              referenceNo: form.referenceNo.trim(),
                              depositDate: form.depositDate,
                              confirmedAmount: Number(form.confirmedAmount),
                              proofUrl: form.proofUrl.trim() || undefined,
                              proofNote: form.proofNote.trim() || undefined,
                            })}
                          >
                            {t('cashBankBook.bank.confirmDeposit')}
                          </button>
                          <div className="md:col-span-2">
                            <label className="label">Upload deposit proof</label>
                            <div className="flex flex-wrap items-center gap-2">
                              <label className={`btn-secondary cursor-pointer ${uploadingProofId === request.id ? 'opacity-60 pointer-events-none' : ''}`}>
                                {uploadingProofId === request.id ? 'Uploading…' : request.depositProofUrl || request.depositProofKey ? 'Replace proof' : 'Upload proof'}
                                <input
                                  type="file"
                                  className="hidden"
                                  accept="image/jpeg,image/png,image/webp,application/pdf"
                                  onChange={(event) => handleBankDepositProofUpload(request.id, event.target.files?.[0], event.target)}
                                />
                              </label>
                              {request.depositProofUrl || form.proofUrl ? (
                                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Proof attached</span>
                              ) : (
                                <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">Proof required</span>
                              )}
                            </div>
                          </div>
                          <div className="md:col-span-2">
                            <label className="label">Deposit proof link</label>
                            <input
                              aria-label={`Deposit proof link for ${request.requestNo}`}
                              className="input"
                              value={form.proofUrl}
                              onChange={(event) => updateConfirmForm(request, { proofUrl: event.target.value })}
                              placeholder="Slip image/PDF URL or reference"
                            />
                          </div>
                          <div className="md:col-span-3">
                            <label className="label">Proof note</label>
                            <input
                              aria-label={`Deposit proof note for ${request.requestNo}`}
                              className="input"
                              value={form.proofNote}
                              onChange={(event) => updateConfirmForm(request, { proofNote: event.target.value })}
                              placeholder="Slip no, uploader, or verification note"
                            />
                          </div>
                          <div className="md:col-span-4">
                            <label className="label">{t('cashBankBook.bank.form.rejectReason')}</label>
                            <input
                              aria-label={t('cashBankBook.bank.form.rejectReasonAria', { requestNo: request.requestNo })}
                              className="input"
                              value={rejectReason}
                              onChange={(event) => setRejectReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                              placeholder={t('cashBankBook.bank.form.rejectReasonPlaceholder')}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn-ghost justify-center text-red-600"
                            disabled={rejectBankDeposit.isPending || rejectReason.trim().length < 3}
                            onClick={() => rejectBankDeposit.mutate({ id: request.id, reason: rejectReason.trim() })}
                          >
                            {t('cashBankBook.bank.reject')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bank Transactions */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--color-border)]">
                <h2 className="section-title">{t('cashBankBook.bank.transactions')}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('cashBankBook.column.type')}</th>
                      <th>{t('cashBankBook.column.bank')}</th>
                      <th className="text-right">{t('cashBankBook.column.amount')}</th>
                      <th>{t('cashBankBook.column.time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankTxnLoading ? (
                      [...Array(3)].map((_, i) => (
                        <tr key={i}>
                          {[...Array(4)].map((__, j) => (
                            <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                          ))}
                        </tr>
                      ))
                    ) : bankTxns.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-8">
                          <EmptyState
                            icon={<Landmark className="w-8 h-8 text-[var(--color-text-muted)]" />}
                            title={t('cashBankBook.empty.bankTitle')}
                            description={t('cashBankBook.empty.bankDescription')}
                          />
                        </td>
                      </tr>
                    ) : (
                      bankTxns.map((txn) => (
                        <tr key={txn.id}>
                          <td>
                            <span className={`badge text-xs ${
                              txn.type === 'deposit' ? 'bg-emerald-100 text-emerald-700'
                              : txn.type === 'card_settlement' ? 'bg-blue-100 text-blue-700'
                              : 'bg-red-100 text-red-700'
                            }`}>
                              {txn.type.replace('_', ' ')}
                            </span>
                          </td>
                          <td>{txn.bank_name || '-'}</td>
                          <td className="text-right font-data">{fmt(txn.amount)}</td>
                          <td className="text-xs text-[var(--color-text-muted)]">{formatDateTime(txn.created_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {expenseReceiptUrl && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={() => setExpenseReceiptUrl(null)}>
            <div className="relative max-h-[90vh] max-w-3xl" onClick={(event) => event.stopPropagation()}>
              <button type="button" aria-label="Close voucher" className="absolute -top-10 right-0 text-white" onClick={() => setExpenseReceiptUrl(null)}>
                <X className="h-6 w-6" />
              </button>
              <img src={expenseReceiptUrl} alt="Expense voucher" className="max-h-[85vh] max-w-full rounded-lg object-contain" />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

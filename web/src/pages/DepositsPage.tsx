import { useState, useEffect, useMemo } from 'react';
import { Wallet, Plus, X, Search, ArrowDownCircle, ArrowUpCircle, RefreshCw, PieChart, Eye, Undo2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { formatDateTimeGMT6 } from '../lib/date-utils';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';

interface PatientOption {
  id: number;
  name: string;
  patient_code?: string;
  mobile?: string;
}

interface Deposit {
  id: number;
  patient_id?: number;
  patient_name?: string;
  patient_code?: string;
  deposit_receipt_no?: string;
  amount: number;
  transaction_type: 'deposit' | 'refund' | 'adjustment';
  payment_method?: string;
  remarks?: string;
  created_at: string;
  status?: string;
}

interface AdvanceReportRow {
  patient_id: number;
  patient_name?: string | null;
  patient_code?: string | null;
  total_deposits: number;
  total_refunds: number;
  total_adjustments: number;
  balance: number;
}

interface AdvanceReportSummary {
  patient_count: number;
  total_deposits: number;
  total_refunds: number;
  total_adjustments: number;
  balance: number;
  advanceLiabilityLedgerTotal?: number;
  ledgerDifference?: number;
  hasLedgerMismatch?: boolean;
  ledgerStatus?: 'balanced' | 'mismatch';
}

interface AdvanceReportResponse {
  rows: AdvanceReportRow[];
  summary: AdvanceReportSummary;
}

function fmtTaka(n: number, t: (k: string) => string) {
  const symbol = t('common.currencySymbol') || '৳';
  return `${symbol}${(n || 0).toLocaleString('en-BD')}`;
}

export default function DepositsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('billing');
  const TYPE_CFG = {
    deposit:    { label: t('depositsPage.deposit'),    cls: 'badge-success' },
    refund:     { label: t('depositsPage.refund'),     cls: 'badge-warning' },
    adjustment: { label: t('depositsPage.adjust'),     cls: 'badge-info' },
  };
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'transactions' | 'utilization'>('transactions');
  const [patientFilter, setPatientFilter] = useState('');

  // Collect deposit modal
  const [showCollect, setShowCollect] = useState(false);
  const [collectForm, setCollectForm] = useState({
    patient_id: '', amount: '', payment_method: 'Cash', remarks: '',
  });
  const [collectPatientSearch, setCollectPatientSearch] = useState('');
  const [collectPatientSearchDebounced, setCollectPatientSearchDebounced] = useState('');
  const [showCollectPatientDropdown, setShowCollectPatientDropdown] = useState(false);

  // Refund modal
  const [showRefund, setShowRefund]   = useState(false);
  const [refundForm, setRefundForm]   = useState({
    patient_id: '', amount: '', remarks: '',
  });
  const [refundPatientSearch, setRefundPatientSearch] = useState('');
  const [refundPatientSearchDebounced, setRefundPatientSearchDebounced] = useState('');
  const [showRefundPatientDropdown, setShowRefundPatientDropdown] = useState(false);

  // Balance lookup
  const [balancePatientId, setBalancePatientId] = useState('');
  const [balancePatientSearch, setBalancePatientSearch] = useState('');
  const [balancePatientSearchDebounced, setBalancePatientSearchDebounced] = useState('');
  const [showBalancePatientDropdown, setShowBalancePatientDropdown] = useState(false);
  const [balance, setBalance]                   = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance]   = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Debounce patient searches
  useEffect(() => {
    const t = setTimeout(() => setCollectPatientSearchDebounced(collectPatientSearch), 300);
    return () => clearTimeout(t);
  }, [collectPatientSearch]);
  useEffect(() => {
    const t = setTimeout(() => setRefundPatientSearchDebounced(refundPatientSearch), 300);
    return () => clearTimeout(t);
  }, [refundPatientSearch]);
  useEffect(() => {
    const t = setTimeout(() => setBalancePatientSearchDebounced(balancePatientSearch), 300);
    return () => clearTimeout(t);
  }, [balancePatientSearch]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCollect(false); setShowRefund(false); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const queryParams = new URLSearchParams();
  if (typeFilter !== 'all') queryParams.set('type', typeFilter);
  const qs = queryParams.toString();
  const filters = { type: typeFilter };

  const { data: rawData, isLoading: loading } = useApiQuery<any>(
    queryKeys.deposits.list(filters),
    `/api/deposits${qs ? `?${qs}` : ''}`,
  );
  const { data: advanceReportData, isLoading: advanceReportLoading } = useApiQuery<AdvanceReportResponse>(
    queryKeys.deposits.advanceReport({ includeZero: true }),
    '/api/deposits/advance-report?include_zero=true',
  );
  const deposits: Deposit[] = rawData?.deposits ?? [];
  const advanceRows = advanceReportData?.rows ?? [];

  // Patient search queries for name-based selection
  const { data: collectPatientsData } = useApiQuery<{ patients: PatientOption[] }>(
    [...queryKeys.patients.all, 'deposit-collect', collectPatientSearchDebounced],
    `/api/patients?search=${encodeURIComponent(collectPatientSearchDebounced)}&limit=8`,
    { enabled: collectPatientSearchDebounced.length >= 2 && showCollect },
  );
  const { data: refundPatientsData } = useApiQuery<{ patients: PatientOption[] }>(
    [...queryKeys.patients.all, 'deposit-refund', refundPatientSearchDebounced],
    `/api/patients?search=${encodeURIComponent(refundPatientSearchDebounced)}&limit=8`,
    { enabled: refundPatientSearchDebounced.length >= 2 && showRefund },
  );
  const { data: balancePatientsData } = useApiQuery<{ patients: PatientOption[] }>(
    [...queryKeys.patients.all, 'deposit-balance', balancePatientSearchDebounced],
    `/api/patients?search=${encodeURIComponent(balancePatientSearchDebounced)}&limit=8`,
    { enabled: balancePatientSearchDebounced.length >= 2 },
  );
  const collectPatients = collectPatientsData?.patients ?? [];
  const refundPatients = refundPatientsData?.patients ?? [];
  const balancePatients = balancePatientsData?.patients ?? [];

  const totalDeposits    = deposits.filter(d => d.transaction_type === 'deposit').reduce((s, d) => s + d.amount, 0);
  const totalRefunds     = deposits.filter(d => d.transaction_type === 'refund').reduce((s, d) => s + d.amount, 0);
  const totalAdjustments = deposits.filter(d => d.transaction_type === 'adjustment').reduce((s, d) => s + d.amount, 0);

  const handleCheckBalance = async () => {
    if (!balancePatientId) return;
    setCheckingBalance(true);
    try {
      const data = await api.get<any>(`/api/deposits/balance/${balancePatientId}`);
      setBalance(data.balance ?? 0);
    } catch { toast.error(t('depositsPage.failedToFetchBalance')); setBalance(null); }
    finally { setCheckingBalance(false); }
  };

  const handleRefundForPatient = (p: { patient_id: number; patient_name: string; patient_code: string }) => {
    setRefundForm({ patient_id: String(p.patient_id), amount: '', remarks: '' });
    setRefundPatientSearch(`${p.patient_name} (${p.patient_code || ''})`);
    setShowRefund(true);
  };

  const patientUtilization = useMemo(() => {
    if (advanceReportData) {
      return advanceRows.map(row => ({
        patient_id: row.patient_id,
        patient_name: row.patient_name ?? 'Unknown',
        patient_code: row.patient_code ?? '',
        deposited: row.total_deposits,
        refunded: row.total_refunds,
        adjusted: row.total_adjustments,
        consumed: row.total_refunds + row.total_adjustments,
        remaining: row.balance,
      }));
    }

    const grouped = new Map<string, {
      patient_id: number;
      patient_name: string;
      patient_code: string;
      deposited: number;
      refunded: number;
      adjusted: number;
    }>();
    for (const d of deposits) {
      const key = d.patient_name ?? `id-${d.patient_id ?? 'unknown'}`;
      if (!key || key === 'unknown' || key.startsWith('id-undefined')) continue;
      const existing = grouped.get(key);
      if (existing) {
        if (d.transaction_type === 'deposit') existing.deposited += d.amount;
        else if (d.transaction_type === 'refund') existing.refunded += d.amount;
        else existing.adjusted += d.amount;
      } else {
        grouped.set(key, {
          patient_id: d.patient_id ?? 0,
          patient_name: d.patient_name ?? 'Unknown',
          patient_code: d.patient_code ?? '',
          deposited: d.transaction_type === 'deposit' ? d.amount : 0,
          refunded: d.transaction_type === 'refund' ? d.amount : 0,
          adjusted: d.transaction_type === 'adjustment' ? d.amount : 0,
        });
      }
    }
    return Array.from(grouped.values()).map(p => ({
      ...p,
      consumed: p.refunded + p.adjusted,
      remaining: p.deposited - p.refunded - p.adjusted,
    }));
  }, [advanceReportData, advanceRows, deposits]);

  const utilTotalDeposited = advanceReportData?.summary?.total_deposits ?? patientUtilization.reduce((s, p) => s + p.deposited, 0);
  const utilTotalConsumed = advanceReportData?.summary
    ? advanceReportData.summary.total_refunds + advanceReportData.summary.total_adjustments
    : patientUtilization.reduce((s, p) => s + p.consumed, 0);
  const utilRemaining = advanceReportData?.summary?.balance ?? utilTotalDeposited - utilTotalConsumed;
  const ledgerDifference = Number(advanceReportData?.summary?.ledgerDifference ?? 0);
  const hasLedgerMismatch = Boolean(advanceReportData?.summary?.hasLedgerMismatch) || Math.abs(ledgerDifference) >= 0.01;
  const utilizationLoading = loading || advanceReportLoading;

  const filteredDeposits = patientFilter
    ? deposits.filter(d => d.patient_name === patientFilter)
    : deposits;

  const collectMutation = useApiMutation<any, any>('post', '/api/deposits', {
    onSuccess: () => {
      toast.success(t('depositsPage.depositCollected'));
      setShowCollect(false);
      setCollectForm({ patient_id: '', amount: '', payment_method: 'Cash', remarks: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.deposits.all });
    },
    onError: (err) => { toast.error(err.message || t('common.saveFailed')); },
  });

  const refundMutation = useApiMutation<any, any>('post', '/api/deposits/refund', {
    onSuccess: () => {
      toast.success(t('depositsPage.refundProcessed'));
      setShowRefund(false);
      setRefundForm({ patient_id: '', amount: '', remarks: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.deposits.all });
    },
    onError: (err) => { toast.error(err.message || t('common.saveFailed')); },
  });

  const handleCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    collectMutation.mutate({
      patient_id: parseInt(collectForm.patient_id),
      amount: parseFloat(collectForm.amount),
      payment_method: collectForm.payment_method || undefined,
      remarks: collectForm.remarks || undefined,
      idempotencyKey: `patient-deposit-${crypto.randomUUID()}`,
    });
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    refundMutation.mutate({
      patient_id: parseInt(refundForm.patient_id),
      amount: parseFloat(refundForm.amount),
      remarks: refundForm.remarks || undefined,
      idempotencyKey: `patient-deposit-refund-${crypto.randomUUID()}`,
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('depositsPage.title')}</h1>
              <p className="section-subtitle">{t('depositsPage.advancePaymentsSubtitle')}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowRefund(true)} className="btn-secondary">
              <ArrowUpCircle className="w-4 h-4" /> {t('depositsPage.refunded')}
            </button>
            <button onClick={() => setShowCollect(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> {t('depositsPage.newDeposit')}
            </button>
            <HelpButton onClick={() => setHelpOpen(true)} />
            <WhatsAppButton />
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('depositsPage.totalDeposits')} value={fmtTaka(totalDeposits, t)}    loading={loading} icon={<ArrowDownCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={0} />
          <KPICard title={t('depositsPage.refunded')}      value={fmtTaka(totalRefunds, t)}     loading={loading} icon={<ArrowUpCircle className="w-5 h-5" />}   iconBg="bg-amber-50 text-amber-600"   index={1} />
          <KPICard title={t('depositsPage.remainingBalance')} value={fmtTaka(totalDeposits - totalRefunds - totalAdjustments, t)} loading={loading} icon={<Wallet className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={2} />
        </div>

        {/* Balance Checker */}
        <div className="card p-4">
          <p className="text-sm font-medium mb-2 text-[var(--color-text-secondary)]">{t('depositsPage.quickBalanceCheck')}</p>
          <div className="flex gap-2 flex-wrap items-start">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder={t('depositsPage.searchPatientNameCode')}
                value={balancePatientId ? (balancePatients.find(p => String(p.id) === balancePatientId)?.name ?? balancePatientSearch) : balancePatientSearch}
                onChange={e => { setBalancePatientSearch(e.target.value); setBalancePatientId(''); setBalance(null); setShowBalancePatientDropdown(true); }}
                onFocus={() => setShowBalancePatientDropdown(true)}
                className="input pl-9 w-full"
              />
              {showBalancePatientDropdown && balancePatients.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {balancePatients.map(p => (
                    <button key={p.id} onClick={() => { setBalancePatientId(String(p.id)); setBalancePatientSearch(`${p.name} (${p.patient_code})`); setShowBalancePatientDropdown(false); }}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)] transition-colors">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}{p.mobile ? ` · ${p.mobile}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={handleCheckBalance} disabled={checkingBalance || !balancePatientId} className="btn-secondary">
              <RefreshCw className={`w-4 h-4 ${checkingBalance ? 'animate-spin' : ''}`} /> {t('common.check')}
            </button>
            {balance !== null && (
              <span className={`font-bold font-data text-lg ml-2 ${balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {t('depositsPage.remainingBalance')}: {fmtTaka(balance, t)}
              </span>
            )}
          </div>
        </div>

        {/* View Toggle + Type Filters */}
        <div className="card p-3 flex gap-2 flex-wrap items-center">
          <button onClick={() => { setViewMode('transactions'); setPatientFilter(''); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${viewMode === 'transactions' ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
          >{t('depositsPage.transactions')}</button>
          <button onClick={() => setViewMode('utilization')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${viewMode === 'utilization' ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
          ><PieChart className="w-3.5 h-3.5 inline mr-1" />{t('depositsPage.depositUtilization')}</button>
          <span className="w-px h-6 bg-[var(--color-border)] mx-1" />
          {viewMode === 'transactions' && ['all', 'deposit', 'refund', 'adjustment'].map(type => (
            <button key={type} onClick={() => setTypeFilter(type)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${typeFilter === type ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            >{type === 'all' ? t('depositsPage.all') : t(`depositsPage.${type}`)}</button>
          ))}
          {patientFilter && (
            <button onClick={() => setPatientFilter('')} className="ml-auto px-2 py-1 rounded text-xs font-medium bg-[var(--color-primary-light)] text-[var(--color-primary)]">
              {t('depositsPage.filterBy', { name: patientFilter })} <X className="w-3 h-3 inline ml-1" />
            </button>
          )}
        </div>

        {/* Utilization View */}
        {viewMode === 'utilization' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KPICard title={t('depositsPage.totalDepositsReceived')} value={fmtTaka(utilTotalDeposited, t)} loading={utilizationLoading} icon={<ArrowDownCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={0} />
              <KPICard title={t('depositsPage.totalDepositsConsumed')} value={fmtTaka(utilTotalConsumed, t)} loading={utilizationLoading} icon={<ArrowUpCircle className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={1} />
              <KPICard title={t('depositsPage.remainingBalance')} value={fmtTaka(utilRemaining, t)} loading={utilizationLoading} icon={<Wallet className="w-5 h-5" />} iconBg={utilRemaining >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'} index={2} />
            </div>
            {hasLedgerMismatch && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">{t('depositsPage.ledgerMismatchTitle', { defaultValue: 'Deposit ledger mismatch' })}</p>
                  <p className="text-xs mt-1">
                    {t('depositsPage.ledgerMismatchBody', {
                      defaultValue: 'Patient advance balance and accounting ledger differ by {{amount}}. Review the accounting audit before accepting this report.',
                      amount: fmtTaka(Math.abs(ledgerDifference), t),
                    })}
                  </p>
                </div>
              </div>
            )}
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>{t('depositsPage.patient')}</th><th>{t('master.patientCode')}</th><th>{t('depositsPage.totalDeposited')}</th><th>{t('depositsPage.consumed')}</th><th>{t('depositsPage.remaining')}</th><th>{t('depositsPage.actions')}</th></tr></thead>
                  <tbody>
                    {patientUtilization.length === 0
                      ? <tr><td colSpan={6}><EmptyState icon={<PieChart className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('depositsPage.noUtilizationData')} description={t('depositsPage.noPatientDepositData')} /></td></tr>
                      : patientUtilization.map(p => (
                          <tr key={p.patient_name}>
                            <td className="font-medium">{p.patient_name}</td>
                            <td className="font-data">{p.patient_code || '—'}</td>
                            <td className="font-data font-medium text-right">{fmtTaka(p.deposited, t)}</td>
                            <td className="font-data text-right">{fmtTaka(p.consumed, t)}</td>
                            <td className={`font-data font-medium text-right ${p.remaining >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTaka(p.remaining, t)}</td>
                            <td>
                              <div className="flex gap-1.5">
                                <button onClick={() => handleRefundForPatient(p)} className="px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"><Undo2 className="w-3 h-3 inline mr-0.5" />{t('depositsPage.refund')}</button>
                                <button onClick={() => { setViewMode('transactions'); setPatientFilter(p.patient_name); setTypeFilter('all'); }} className="px-2 py-1 rounded text-xs font-medium hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)] transition-colors"><Eye className="w-3 h-3 inline mr-0.5" />{t('depositsPage.details')}</button>
                              </div>
                            </td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Transactions Table */}
        {viewMode === 'transactions' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>{t('depositsPage.receiptNo')}</th><th>{t('depositsPage.patient')}</th><th>{t('depositsPage.type')}</th><th>{t('depositsPage.amount')}</th><th>{t('depositsPage.method')}</th><th>{t('depositsPage.remarks')}</th><th>{t('depositsPage.date')}</th></tr></thead>
                <tbody>
                  {loading
                    ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    : filteredDeposits.length === 0
                    ? <tr><td colSpan={7}><EmptyState icon={<Wallet className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('depositsPage.noDeposits')} description={patientFilter ? t('depositsPage.noTransactionsForPatient', { name: patientFilter }) : t('depositsPage.noTransactionsMatch')} action={<button onClick={() => setShowCollect(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('depositsPage.newDeposit')}</button>} /></td></tr>
                    : filteredDeposits.map(d => (
                        <tr key={d.id}>
                          <td className="font-data">{d.deposit_receipt_no ?? `DEP-${d.id}`}</td>
                          <td className="font-medium">
                            {d.patient_name ?? '—'}
                            {d.patient_code && <span className="text-xs text-[var(--color-text-muted)] ml-2">({d.patient_code})</span>}
                          </td>
                          <td><span className={`badge ${TYPE_CFG[d.transaction_type]?.cls ?? 'badge-info'}`}>{TYPE_CFG[d.transaction_type]?.label ?? d.transaction_type}</span></td>
                          <td className="font-data font-medium text-right">{fmtTaka(d.amount, t)}</td>
                          <td>{d.payment_method ? t(`depositsPage.${d.payment_method.toLowerCase().replace(/\s+/g, '')}`) : '—'}</td>
                          <td className="text-[var(--color-text-secondary)]">{d.remarks ?? '—'}</td>
                          <td className="font-data text-xs leading-tight whitespace-nowrap">
                            {formatDateTimeGMT6(d.created_at)}
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Collect Modal */}
      {showCollect && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('depositsPage.newDeposit')}</h3>
              <button onClick={() => setShowCollect(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCollect} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <label className="label">{t('depositsPage.patient_')}</label>
                  <input className="input w-full" type="text" required
                    placeholder={t('depositsPage.searchPatientNameCode')}
                    value={collectForm.patient_id ? (collectPatients.find(p => String(p.id) === collectForm.patient_id)?.name ?? collectPatientSearch) : collectPatientSearch}
                    onChange={e => { setCollectPatientSearch(e.target.value); setCollectForm(f => ({ ...f, patient_id: '' })); setShowCollectPatientDropdown(true); }}
                    onFocus={() => setShowCollectPatientDropdown(true)}
                  />
                  {showCollectPatientDropdown && collectPatients.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {collectPatients.map(p => (
                        <button key={p.id} type="button" onClick={() => { setCollectForm(f => ({ ...f, patient_id: String(p.id) })); setCollectPatientSearch(`${p.name} (${p.patient_code})`); setShowCollectPatientDropdown(false); }}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)] transition-colors">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}{p.mobile ? ` · ${p.mobile}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div><label className="label">{t('depositsPage.amount_')}</label><input className="input" type="number" required min="0.01" step="0.01" value={collectForm.amount} onChange={e => setCollectForm(f => ({ ...f, amount: e.target.value }))} /></div>
              </div>
              <div><label className="label">{t('depositsPage.payment_method')}</label><select className="input" value={collectForm.payment_method} onChange={e => setCollectForm(f => ({ ...f, payment_method: e.target.value }))}><option value="Cash">{t('depositsPage.cash')}</option><option value="Card">{t('depositsPage.card')}</option><option value="Mobile Banking">{t('depositsPage.mobilebanking')}</option><option value="Cheque">{t('depositsPage.cheque')}</option></select></div>
              <div><label className="label">{t('depositsPage.remarks')}</label><input className="input" value={collectForm.remarks} onChange={e => setCollectForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCollect(false)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={collectMutation.isPending} className="btn-primary">{collectMutation.isPending ? t('common.saving') : t('depositsPage.newDeposit')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {showRefund && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('depositsPage.processRefund')}</h3>
              <button onClick={() => setShowRefund(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRefund} className="p-5 space-y-4">
              <p className="text-sm text-[var(--color-text-muted)]">{t('depositsPage.refundAPIHint')}</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <label className="label">{t('depositsPage.patient_')}</label>
                  <input className="input w-full" type="text" required
                    placeholder={t('depositsPage.searchPatientNameCode')}
                    value={refundForm.patient_id ? (refundPatients.find(p => String(p.id) === refundForm.patient_id)?.name ?? refundPatientSearch) : refundPatientSearch}
                    onChange={e => { setRefundPatientSearch(e.target.value); setRefundForm(f => ({ ...f, patient_id: '' })); setShowRefundPatientDropdown(true); }}
                    onFocus={() => setShowRefundPatientDropdown(true)}
                  />
                  {showRefundPatientDropdown && refundPatients.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {refundPatients.map(p => (
                        <button key={p.id} type="button" onClick={() => { setRefundForm(f => ({ ...f, patient_id: String(p.id) })); setRefundPatientSearch(`${p.name} (${p.patient_code})`); setShowRefundPatientDropdown(false); }}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)] transition-colors">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}{p.mobile ? ` · ${p.mobile}` : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div><label className="label">{t('depositsPage.amount_')}</label><input className="input" type="number" required min="0.01" step="0.01" value={refundForm.amount} onChange={e => setRefundForm(f => ({ ...f, amount: e.target.value }))} /></div>
              </div>
              <div><label className="label">{t('depositsPage.remarks')}</label><input className="input" value={refundForm.remarks} onChange={e => setRefundForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowRefund(false)} className="btn-secondary">{t('common.cancel')}</button>
                <button type="submit" disabled={refundMutation.isPending} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">{refundMutation.isPending ? t('depositsPage.processing') : t('depositsPage.processRefund')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <HelpPanel pageKey="billing" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </DashboardLayout>
  );
}

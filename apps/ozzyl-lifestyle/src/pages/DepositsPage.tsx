import { useState, useEffect, useCallback } from 'react';
import { Wallet, Plus, X, Search, ArrowDownCircle, ArrowUpCircle, RefreshCw } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';

interface Deposit {
  id: number;
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

import { authHeader } from '../utils/auth';

const TYPE_CFG = {
  deposit:    { label: 'Deposit',    cls: 'badge-success' },
  refund:     { label: 'Refund',     cls: 'badge-warning' },
  adjustment: { label: 'Adjust',     cls: 'badge-info' },
};

export default function DepositsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['billing', 'common']);
  const [deposits, setDeposits]   = useState<Deposit[]>([]);
  const [loading, setLoading]     = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');

  // Collect deposit modal
  const [showCollect, setShowCollect] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [collectForm, setCollectForm] = useState({
    patient_id: '', amount: '', payment_method: 'Cash', remarks: '',
  });

  // Refund modal
  const [showRefund, setShowRefund]   = useState(false);
  const [refunding, setRefunding]     = useState(false);
  const [refundForm, setRefundForm]   = useState({
    patient_id: '', amount: '', remarks: '',
  });

  // Balance lookup
  const [balancePatientId, setBalancePatientId] = useState('');
  const [balance, setBalance]                   = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance]   = useState(false);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCollect(false); setShowRefund(false); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fetchDeposits = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (typeFilter !== 'all') params.type = typeFilter;
      const { data } = await axios.get('/api/deposits', { params, headers: authHeader() });
      setDeposits(data.deposits ?? []);
    } catch { setDeposits([]); } finally { setLoading(false); }
  }, [typeFilter]);

  useEffect(() => { fetchDeposits(); }, [fetchDeposits]);

  const totalDeposits    = deposits.filter(d => d.transaction_type === 'deposit').reduce((s, d) => s + d.amount, 0);
  const totalRefunds     = deposits.filter(d => d.transaction_type === 'refund').reduce((s, d) => s + d.amount, 0);
  const totalAdjustments = deposits.filter(d => d.transaction_type === 'adjustment').reduce((s, d) => s + d.amount, 0);

  const handleCheckBalance = async () => {
    if (!balancePatientId) return;
    setCheckingBalance(true);
    try {
      const { data } = await axios.get(`/api/deposits/balance/${balancePatientId}`, { headers: authHeader() });
      setBalance(data.balance ?? 0);
    } catch { toast.error(t('billing.failed_to_fetch_balance')); setBalance(null); }
    finally { setCheckingBalance(false); }
  };

  const handleCollect = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/deposits', {
        patient_id: parseInt(collectForm.patient_id),
        amount: parseFloat(collectForm.amount),
        payment_method: collectForm.payment_method || undefined,
        remarks: collectForm.remarks || undefined,
      }, { headers: authHeader() });
      toast.success(t('billing.deposit_collected'));
      setShowCollect(false);
      setCollectForm({ patient_id: '', amount: '', payment_method: 'Cash', remarks: '' });
      fetchDeposits();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setSaving(false); }
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault(); setRefunding(true);
    try {
      await axios.post('/api/deposits/refund', {
        patient_id: parseInt(refundForm.patient_id),
        amount: parseFloat(refundForm.amount),
        remarks: refundForm.remarks || undefined,
      }, { headers: authHeader() });
      toast.success(t('billing.refund_processed'));
      setShowRefund(false);
      setRefundForm({ patient_id: '', amount: '', remarks: '' });
      fetchDeposits();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setRefunding(false); }
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
              <h1 className="page-title">{t('deposits', { ns: 'billing' })}</h1>
              <p className="section-subtitle">Advance payments, refunds &amp; adjustments</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowRefund(true)} className="btn-secondary">
              <ArrowUpCircle className="w-4 h-4" /> {t('refunded', { ns: 'billing' })}
            </button>
            <button onClick={() => setShowCollect(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> {t('newDeposit', { ns: 'billing' })}
            </button>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('totalDeposits', { ns: 'billing' })} value={`৳${totalDeposits.toLocaleString()}`}    loading={loading} icon={<ArrowDownCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={0} />
          <KPICard title={t('refunded', { ns: 'billing' })}      value={`৳${totalRefunds.toLocaleString()}`}     loading={loading} icon={<ArrowUpCircle className="w-5 h-5" />}   iconBg="bg-amber-50 text-amber-600"   index={1} />
          <KPICard title={t('remainingBalance', { ns: 'billing' })} value={`৳${(totalDeposits - totalRefunds - totalAdjustments).toLocaleString()}`} loading={loading} icon={<Wallet className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={2} />
        </div>

        {/* Balance Checker */}
        <div className="card p-4">
          <p className="text-sm font-medium mb-2 text-[var(--color-text-secondary)]">Quick Balance Check</p>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                type="number"
                placeholder={t("billing.patient_id")}
                value={balancePatientId}
                onChange={e => { setBalancePatientId(e.target.value); setBalance(null); }}
                className="input pl-9 w-40"
              />
            </div>
            <button onClick={handleCheckBalance} disabled={checkingBalance || !balancePatientId} className="btn-secondary">
              <RefreshCw className={`w-4 h-4 ${checkingBalance ? 'animate-spin' : ''}`} /> {t('check', { ns: 'common' })}
            </button>
            {balance !== null && (
              <span className={`font-bold font-data text-lg ml-2 ${balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                Balance: ৳{balance.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Type Filter */}
        <div className="card p-3 flex gap-2 flex-wrap">
          {['all', 'deposit', 'refund', 'adjustment'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${typeFilter === t ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            >{t === 'all' ? 'All' : t}</button>
          ))}
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Receipt #</th><th>Patient</th><th>Type</th><th>Amount (৳)</th><th>Method</th><th>Remarks</th><th>Date</th></tr></thead>
              <tbody>
                {loading
                  ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : deposits.length === 0
                  ? <tr><td colSpan={7}><EmptyState icon={<Wallet className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noDeposits', { ns: 'billing' })} description="No transactions match the current filter." action={<button onClick={() => setShowCollect(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('newDeposit', { ns: 'billing' })}</button>} /></td></tr>
                  : deposits.map(d => (
                      <tr key={d.id}>
                        <td className="font-data">{d.deposit_receipt_no ?? `DEP-${d.id}`}</td>
                        <td className="font-medium">{d.patient_name ?? '—'}</td>
                        <td><span className={`badge ${TYPE_CFG[d.transaction_type]?.cls ?? 'badge-info'}`}>{TYPE_CFG[d.transaction_type]?.label ?? d.transaction_type}</span></td>
                        <td className="font-data font-medium text-right">৳{d.amount.toLocaleString()}</td>
                        <td className="capitalize">{d.payment_method ?? '—'}</td>
                        <td className="text-[var(--color-text-secondary)]">{d.remarks ?? '—'}</td>
                        <td className="font-data text-sm">{d.created_at?.split('T')[0]}</td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Collect Modal */}
      {showCollect && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('newDeposit', { ns: 'billing' })}</h3>
              <button onClick={() => setShowCollect(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCollect} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('billing.patient_id_')}</label><input className="input" type="number" required value={collectForm.patient_id} onChange={e => setCollectForm(f => ({ ...f, patient_id: e.target.value }))} /></div>
                <div><label className="label">{t('billing.amount_')}</label><input className="input" type="number" required min="0.01" step="0.01" value={collectForm.amount} onChange={e => setCollectForm(f => ({ ...f, amount: e.target.value }))} /></div>
              </div>
              <div><label className="label">{t('billing.payment_method')}</label><select className="input" value={collectForm.payment_method} onChange={e => setCollectForm(f => ({ ...f, payment_method: e.target.value }))}><option>Cash</option><option>Card</option><option>Mobile Banking</option><option>Cheque</option></select></div>
              <div><label className="label">{t('billing.remarks')}</label><input className="input" value={collectForm.remarks} onChange={e => setCollectForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCollect(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving', { ns: 'billing' }) : t('newDeposit', { ns: 'billing' })}</button>
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
              <h3 className="font-semibold">Process Refund</h3>
              <button onClick={() => setShowRefund(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRefund} className="p-5 space-y-4">
              <p className="text-sm text-[var(--color-text-muted)]">The API will verify the patient has sufficient balance before processing.</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('billing.patient_id_')}</label><input className="input" type="number" required value={refundForm.patient_id} onChange={e => setRefundForm(f => ({ ...f, patient_id: e.target.value }))} /></div>
                <div><label className="label">{t('billing.amount_')}</label><input className="input" type="number" required min="0.01" step="0.01" value={refundForm.amount} onChange={e => setRefundForm(f => ({ ...f, amount: e.target.value }))} /></div>
              </div>
              <div><label className="label">{t('billing.remarks')}</label><input className="input" value={refundForm.remarks} onChange={e => setRefundForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowRefund(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={refunding} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">{refunding ? 'Processing…' : 'Process Refund'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

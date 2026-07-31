import { useState, useEffect, useCallback } from 'react';
import { Handshake, Plus, X, CheckCircle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';

interface Settlement {
  id: number;
  party_name?: string;
  doctor_name?: string;
  amount: number;
  settlement_type?: string;
  settlement_date?: string;
  status?: 'pending' | 'paid';
  remarks?: string;
  created_at: string;
}

import { authHeader } from '../utils/auth';

export default function SettlementsPage({ role = 'hospital_admin' }: { role?: string }) {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm] = useState({
    party_name: '', amount: '', settlement_type: 'doctor',
    settlement_date: new Date().toISOString().split('T')[0], remarks: '',
  });
  const { t } = useTranslation(['billing', 'common']);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fetchSettlements = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const { data } = await axios.get('/api/settlements', { params, headers: authHeader() });
      setSettlements(data.settlements ?? []);
    } catch { setSettlements([]); } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchSettlements(); }, [fetchSettlements]);

  const total   = settlements.reduce((s, x) => s + x.amount, 0);
  const paid    = settlements.filter(s => s.status === 'paid').length;
  const pending = settlements.filter(s => s.status !== 'paid').length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/settlements', {
        party_name: form.party_name,
        amount: parseFloat(form.amount),
        settlement_type: form.settlement_type,
        settlement_date: form.settlement_date,
        remarks: form.remarks || undefined,
      }, { headers: authHeader() });
      toast.success(t('settlementsPage.settlementCreated'));
      setShowCreate(false);
      setForm({ party_name: '', amount: '', settlement_type: 'doctor', settlement_date: new Date().toISOString().split('T')[0], remarks: '' });
      fetchSettlements();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('settlementsPage.failed') : t('settlementsPage.failed'));
    } finally { setSaving(false); }
  };

  const handleMarkPaid = async (id: number) => {
    try {
      await axios.put(`/api/settlements/${id}/pay`, {}, { headers: authHeader() });
      toast.success(t('settlementsPage.markedAsPaid'));
      fetchSettlements();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('settlementsPage.failed') : t('settlementsPage.failed'));
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Handshake className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('settlementsPage.title')}</h1>
              <p className="section-subtitle">{t('settlementsPage.subtitle')}</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('settlementsPage.newSettlement')}</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('settlementsPage.totalAmount')} value={`৳${total.toLocaleString()}`} loading={loading} icon={<Handshake className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('settlementsPage.paid')}         value={paid}                         loading={loading} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
          <KPICard title={t('settlementsPage.pending')}      value={pending}                      loading={loading} icon={<Handshake className="w-5 h-5" />}   iconBg="bg-amber-50 text-amber-600"   index={2} />
        </div>

        <div className="card p-3 flex gap-2 flex-wrap">
          {['all', 'pending', 'paid'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${statusFilter === s ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            >{t(`settlementsPage.${s}`)}</button>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('settlementsPage.party')}</th><th>{t('settlementsPage.type')}</th><th>{t('settlementsPage.amount')}</th><th>{t('settlementsPage.date')}</th><th>{t('settlementsPage.status')}</th><th>{t('settlementsPage.remarks')}</th><th>{t('settlementsPage.actions')}</th></tr></thead>
              <tbody>
                {loading
                  ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : settlements.length === 0
                  ? <tr><td colSpan={7}><EmptyState icon={<Handshake className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('settlementsPage.noSettlements')} description={t('settlementsPage.noSettlementsDesc')} action={<button onClick={() => setShowCreate(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('settlementsPage.createSettlement')}</button>} /></td></tr>
                  : settlements.map(s => (
                      <tr key={s.id}>
                        <td className="font-medium">{s.party_name ?? s.doctor_name ?? '—'}</td>
                        <td className="capitalize">{s.settlement_type ?? t('settlementsPage.general')}</td>
                        <td className="font-data font-medium text-right">৳{s.amount.toLocaleString()}</td>
                        <td className="font-data text-sm">{s.settlement_date ?? s.created_at?.split('T')[0]}</td>
                        <td><span className={`badge ${s.status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{s.status ?? t('settlementsPage.pending')}</span></td>
                        <td className="text-[var(--color-text-secondary)]">{s.remarks ?? '—'}</td>
                        <td>
                          {s.status !== 'paid' && (
                            <button onClick={() => handleMarkPaid(s.id)} className="btn-ghost p-1.5 text-emerald-600 text-xs" title={t('settlementsPage.markAsPaid')}>
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('settlementsPage.newSettlementModal')}</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div><label className="label">{t('settlementsPage.partyName')}</label><input className="input" required value={form.party_name} onChange={e => setForm(f => ({ ...f, party_name: e.target.value }))} placeholder={t('settlementsPage.partyNamePlaceholder')} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('settlementsPage.amountLabel')}</label><input className="input" type="number" required min="0.01" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div><label className="label">{t('settlementsPage.dateLabel')}</label><input className="input" type="date" required value={form.settlement_date} onChange={e => setForm(f => ({ ...f, settlement_date: e.target.value }))} /></div>
              </div>
              <div><label className="label">{t('settlementsPage.typeLabel')}</label><select className="input" value={form.settlement_type} onChange={e => setForm(f => ({ ...f, settlement_type: e.target.value }))}><option value="doctor">{t('settlementsPage.doctor')}</option><option value="vendor">{t('settlementsPage.vendor')}</option><option value="commission">{t('settlementsPage.commission')}</option><option value="general">{t('settlementsPage.general')}</option></select></div>
              <div><label className="label">{t('settlementsPage.remarksLabel')}</label><input className="input" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('settlementsPage.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('settlementsPage.saving') : t('settlementsPage.createSettlementBtn')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

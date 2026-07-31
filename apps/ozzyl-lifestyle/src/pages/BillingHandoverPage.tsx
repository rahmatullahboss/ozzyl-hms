import { useState, useEffect, useCallback } from 'react';
import { ArrowRightLeft, Plus, X, CheckCircle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';

interface Handover {
  id: number;
  from_user?: string;
  to_user?: string;
  total_amount?: number;
  amount?: number;
  handover_date?: string;
  status?: 'pending' | 'verified';
  remarks?: string;
  created_at: string;
}

import { authHeader } from '../utils/auth';

export default function BillingHandoverPage({ role = 'hospital_admin' }: { role?: string }) {
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm] = useState({
    from_user: '', to_user: '', total_amount: '',
    handover_date: new Date().toISOString().split('T')[0], remarks: '',
  });
  const { t } = useTranslation(['billing', 'common']);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fetchHandovers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const { data } = await axios.get('/api/billing-handover', { params, headers: authHeader() });
      setHandovers(data.handovers ?? []);
    } catch { setHandovers([]); } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchHandovers(); }, [fetchHandovers]);

  const total    = handovers.reduce((s, h) => s + (h.total_amount ?? h.amount ?? 0), 0);
  const verified = handovers.filter(h => h.status === 'verified').length;
  const pending  = handovers.filter(h => h.status !== 'verified').length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/billing-handover', {
        from_user: form.from_user, to_user: form.to_user,
        total_amount: parseFloat(form.total_amount),
        handover_date: form.handover_date, remarks: form.remarks || undefined,
      }, { headers: authHeader() });
      toast.success(t('handoverCreated', { defaultValue: 'Handover created' }));
      setShowCreate(false);
      setForm({ from_user: '', to_user: '', total_amount: '', handover_date: new Date().toISOString().split('T')[0], remarks: '' });
      fetchHandovers();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setSaving(false); }
  };

  const handleVerify = async (id: number) => {
    try {
      await axios.put(`/api/billing-handover/${id}/verify`, {}, { headers: authHeader() });
      toast.success(t('handoverVerified', { defaultValue: 'Handover verified' }));
      fetchHandovers();
    } catch { toast.error(t('failed', { ns: 'common', defaultValue: 'Failed' })); }
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
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('newHandoverBtn', { defaultValue: 'New Handover' })}</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('totalTransferred', { defaultValue: 'Total Transferred' })} value={`৳${total.toLocaleString()}`} loading={loading} icon={<ArrowRightLeft className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('verified', { ns: 'billing', defaultValue: 'Verified' })} value={verified} loading={loading} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
          <KPICard title={t('pendingVerify', { defaultValue: 'Pending Verify' })} value={pending} loading={loading} icon={<ArrowRightLeft className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={2} />
        </div>

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
                {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                : handovers.length === 0
                ? <tr><td colSpan={7}><EmptyState icon={<ArrowRightLeft className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noHandoverRecords', { defaultValue: 'No handover records' })} description={t('noHandoverRecordsDesc', { defaultValue: 'No records found.' })} action={<button onClick={() => setShowCreate(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('createHandover', { defaultValue: 'Create Handover' })}</button>} /></td></tr>
                : handovers.map(h => (
                    <tr key={h.id}>
                      <td className="font-medium">{h.from_user ?? '—'}</td>
                      <td>{h.to_user ?? '—'}</td>
                      <td className="font-data font-medium text-right">৳{(h.total_amount ?? h.amount ?? 0).toLocaleString()}</td>
                      <td className="font-data text-sm">{h.handover_date ?? h.created_at?.split('T')[0]}</td>
                      <td><span className={`badge ${h.status === 'verified' ? 'badge-success' : 'badge-warning'}`}>{h.status ?? 'pending'}</span></td>
                      <td className="text-[var(--color-text-secondary)]">{h.remarks ?? '—'}</td>
                      <td>{h.status !== 'verified' && <button onClick={() => handleVerify(h.id)} className="btn-ghost p-1.5 text-emerald-600" title="Verify"><CheckCircle className="w-4 h-4" /></button>}</td>
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
              <h3 className="font-semibold">{t('newBillingHandover', { defaultValue: 'New Billing Handover' })}</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('fromStaffLabel', { defaultValue: 'From (Staff) *' })}</label><input className="input" required value={form.from_user} onChange={e => setForm(f => ({ ...f, from_user: e.target.value }))} placeholder={t('outgoingStaff', { defaultValue: 'Outgoing staff' })} /></div>
                <div><label className="label">{t('toStaffLabel', { defaultValue: 'To (Staff) *' })}</label><input className="input" required value={form.to_user} onChange={e => setForm(f => ({ ...f, to_user: e.target.value }))} placeholder={t('incomingStaff', { defaultValue: 'Incoming staff' })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('amountLabel', { defaultValue: 'Amount (৳) *' })}</label><input className="input" type="number" required min="0" step="0.01" value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} /></div>
                <div><label className="label">{t('dateLabel', { defaultValue: 'Date *' })}</label><input className="input" type="date" required value={form.handover_date} onChange={e => setForm(f => ({ ...f, handover_date: e.target.value }))} /></div>
              </div>
              <div><label className="label">{t('remarks', { ns: 'billing', defaultValue: 'Remarks' })}</label><textarea className="input resize-none" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving', { ns: 'billing', defaultValue: 'Saving…' }) : t('createHandoverBtn', { defaultValue: 'Create Handover' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

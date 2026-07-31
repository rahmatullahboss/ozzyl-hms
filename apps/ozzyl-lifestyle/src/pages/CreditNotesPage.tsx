import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, X, CheckCircle, XCircle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';

interface CreditNote {
  id: number;
  credit_note_no?: string;
  patient_name?: string;
  amount: number;
  reason?: string;
  status?: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

import { authHeader } from '../utils/auth';

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Pending',  cls: 'badge-warning' },
  approved: { label: 'Approved', cls: 'badge-success' },
  rejected: { label: 'Rejected', cls: 'badge-error' },
};

export default function CreditNotesPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['billing', 'common']);
  const [notes, setNotes]       = useState<CreditNote[]>([]);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [form, setForm] = useState({ patient_id: '', bill_id: '', amount: '', reason: '' });

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const { data } = await axios.get('/api/credit-notes', { params, headers: authHeader() });
      setNotes(data.creditNotes ?? data.credit_notes ?? []);
    } catch { setNotes([]); } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const total   = notes.reduce((s, n) => s + n.amount, 0);
  const pending  = notes.filter(n => n.status === 'pending').length;
  const approved = notes.filter(n => n.status === 'approved').length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/credit-notes', {
        patient_id: parseInt(form.patient_id),
        bill_id: parseInt(form.bill_id),
        amount: parseFloat(form.amount),
        reason: form.reason || undefined,
      }, { headers: authHeader() });
      toast.success(t('billing.credit_note_created'));
      setShowCreate(false);
      setForm({ patient_id: '', bill_id: '', amount: '', reason: '' });
      fetchNotes();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setSaving(false); }
  };

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    try {
      await axios.put(`/api/credit-notes/${id}/${action}`, {}, { headers: authHeader() });
      toast.success(t('billing.creditNoteAction', { action }));
      fetchNotes();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('creditNotes', { ns: 'billing' })}</h1>
              <p className="section-subtitle">Manage refunds &amp; billing adjustments</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('newCreditNote', { ns: 'billing' })}</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('totalAmount', { ns: 'billing' })}  value={`৳${total.toLocaleString()}`} loading={loading} icon={<FileText className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('pending', { ns: 'billing' })}       value={pending}                       loading={loading} icon={<FileText className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600"  index={1} />
          <KPICard title={t('approved', { ns: 'billing' })}      value={approved}                      loading={loading} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={2} />
        </div>

        <div className="card p-3 flex gap-2 flex-wrap">
          {['all', 'pending', 'approved', 'rejected'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${statusFilter === s ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            >{s === 'all' ? 'All' : s}</button>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>CN #</th><th>Patient</th><th>Amount (৳)</th><th>Reason</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {loading
                  ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : notes.length === 0
                  ? <tr><td colSpan={7}><EmptyState icon={<FileText className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noCreditNotes', { ns: 'billing' })} description={t('noCreditNotesDesc', { ns: 'billing' })} action={<button onClick={() => setShowCreate(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('createCreditNote', { ns: 'billing' })}</button>} /></td></tr>
                  : notes.map(n => (
                      <tr key={n.id}>
                        <td className="font-data font-medium">{n.credit_note_no ?? `CN-${n.id}`}</td>
                        <td>{n.patient_name ?? '—'}</td>
                        <td className="font-data font-medium text-right">৳{n.amount.toLocaleString()}</td>
                        <td className="text-[var(--color-text-secondary)] max-w-xs truncate">{n.reason ?? '—'}</td>
                        <td><span className={`badge ${STATUS_CFG[n.status ?? 'pending']?.cls ?? 'badge-info'}`}>{STATUS_CFG[n.status ?? 'pending']?.label}</span></td>
                        <td className="font-data text-sm">{n.created_at?.split('T')[0]}</td>
                        <td>
                          {n.status === 'pending' && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleAction(n.id, 'approve')} className="btn-ghost p-1.5 text-emerald-600" title="Approve"><CheckCircle className="w-4 h-4" /></button>
                              <button onClick={() => handleAction(n.id, 'reject')} className="btn-ghost p-1.5 text-red-500" title="Reject"><XCircle className="w-4 h-4" /></button>
                            </div>
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
              <h3 className="font-semibold">{t('newCreditNote', { ns: 'billing' })}</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('ot.patient_id_')}</label><input className="input" type="number" required value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} /></div>
                <div><label className="label">{t('ot.bill_id_')}</label><input className="input" type="number" required value={form.bill_id} onChange={e => setForm(f => ({ ...f, bill_id: e.target.value }))} /></div>
              </div>
              <div><label className="label">{t('ot.amount_')}</label><input className="input" type="number" required min="0.01" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><label className="label">{t('ot.reason')}</label><textarea className="input resize-none" rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving', { ns: 'billing' }) : t('createCreditNote', { ns: 'billing' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

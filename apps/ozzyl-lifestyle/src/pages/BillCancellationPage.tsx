import { useState, useEffect, useCallback } from 'react';
import { Ban, Plus, X, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';

interface Cancellation {
  id: number;
  invoice_no?: string;
  bill_id?: number;
  patient_name?: string;
  amount?: number;
  bill_amount?: number;
  reason?: string;
  cancelled_by?: string;
  created_at: string;
}

import { authHeader } from '../utils/auth';

export default function BillCancellationPage({ role = 'hospital_admin' }: { role?: string }) {
  const [cancellations, setCancellations] = useState<Cancellation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ bill_id: '', reason: '', remarks: '' });
  const { t } = useTranslation(['billing', 'common']);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fetchCancellations = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/billing-cancellation', { headers: authHeader() });
      setCancellations(data.cancellations ?? []);
    } catch { setCancellations([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCancellations(); }, [fetchCancellations]);

  const totalAmount = cancellations.reduce((s, c) => s + (c.amount ?? c.bill_amount ?? 0), 0);
  const todayCount  = cancellations.filter(c => c.created_at?.split('T')[0] === new Date().toISOString().split('T')[0]).length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/billing-cancellation', {
        bill_id: parseInt(form.bill_id),
        reason: form.reason,
        remarks: form.remarks || undefined,
      }, { headers: authHeader() });
      toast.success(t('billing.bill_cancelled'));
      setShowCreate(false);
      setForm({ bill_id: '', reason: '', remarks: '' });
      fetchCancellations();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Ban className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Bill Cancellation</h1>
              <p className="section-subtitle">Cancel &amp; void billing records</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus className="w-4 h-4" /> Cancel Bill
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title="Total Cancellations" value={cancellations.length}                      loading={loading} icon={<Ban className="w-5 h-5" />}           iconBg="bg-rose-50 text-rose-600"     index={0} />
          <KPICard title="Today"               value={todayCount}                               loading={loading} icon={<AlertTriangle className="w-5 h-5" />}  iconBg="bg-amber-50 text-amber-600"   index={1} />
          <KPICard title="Amount Cancelled"    value={`৳${totalAmount.toLocaleString()}`}       loading={loading} icon={<Ban className="w-5 h-5" />}            iconBg="bg-red-50 text-red-600"       index={2} />
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Invoice #</th><th>Patient</th><th>Amount (৳)</th><th>Reason</th><th>Cancelled By</th><th>Date</th></tr></thead>
              <tbody>
                {loading
                  ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : cancellations.length === 0
                  ? <tr><td colSpan={6}><EmptyState icon={<Ban className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No cancellations" description="No billing cancellations found." /></td></tr>
                  : cancellations.map(c => (
                      <tr key={c.id}>
                        <td className="font-data font-medium">{c.invoice_no ?? `BILL-${c.bill_id ?? c.id}`}</td>
                        <td>{c.patient_name ?? '—'}</td>
                        <td className="font-data text-right">৳{(c.amount ?? c.bill_amount ?? 0).toLocaleString()}</td>
                        <td className="text-[var(--color-text-secondary)]">{c.reason ?? '—'}</td>
                        <td>{c.cancelled_by ?? '—'}</td>
                        <td className="font-data text-sm">{c.created_at?.split('T')[0]}</td>
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
              <h3 className="font-semibold flex items-center gap-2 text-red-600"><AlertTriangle className="w-5 h-5" /> Cancel Bill</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-300">
                ⚠️ This action is irreversible. The bill will be voided permanently.
              </div>
              <div><label className="label">Bill ID *</label><input className="input" type="number" required value={form.bill_id} onChange={e => setForm(f => ({ ...f, bill_id: e.target.value }))} placeholder={t("common.enter_the_bill_id_to_cancel")} /></div>
              <div><label className="label">Reason *</label><input className="input" required value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder={t("common.eg_duplicate_entry_patient_request")} /></div>
              <div><label className="label">{t('common.additional_remarks')}</label><textarea className="input resize-none" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {saving ? 'Cancelling…' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

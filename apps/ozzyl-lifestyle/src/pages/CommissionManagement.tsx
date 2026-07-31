import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, X, Search, Check, DollarSign, Clock, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

interface Commission {
  id: number; marketing_person: string; mobile?: string; patient_id?: number; bill_id?: number;
  commission_amount: number; paid_status: string; paid_date?: string; notes?: string;
  created_at: string; patient_name?: string; patient_code?: string;
}


export default function CommissionManagement({ role = 'hospital_admin' }: { role?: string }) {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ marketingPerson: '', mobile: '', patientId: '', billId: '', commissionAmount: '', notes: '' });
  const { t } = useTranslation(['common']);

  // ESC-to-close modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowCreate(false); setForm({ marketingPerson: '', mobile: '', patientId: '', billId: '', commissionAmount: '', notes: '' }); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (search) params.person = search;
      const { data } = await axios.get('/api/commissions', { params, headers: authHeader() });
      setCommissions(data.commissions ?? []);
    } catch { setCommissions([]); } finally { setLoading(false); }
  }, [statusFilter, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalUnpaid = commissions.filter(c => c.paid_status === 'unpaid').reduce((s, c) => s + c.commission_amount, 0);
  const totalPaid = commissions.filter(c => c.paid_status === 'paid').reduce((s, c) => s + c.commission_amount, 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/commissions', {
        marketingPerson: form.marketingPerson, mobile: form.mobile || undefined,
        patientId: form.patientId ? parseInt(form.patientId) : undefined,
        billId: form.billId ? parseInt(form.billId) : undefined,
        commissionAmount: Number(form.commissionAmount) || 0, notes: form.notes || undefined,
      }, { headers: authHeader() });
      toast.success(t('accounting.commission_recorded')); setShowCreate(false); fetchData();
      setForm({ marketingPerson: '', mobile: '', patientId: '', billId: '', commissionAmount: '', notes: '' });
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed'); } finally { setSaving(false); }
  };

  const markPaid = async (id: number) => {
    if (!confirm('Mark this commission as paid?')) return;
    try {
      await axios.post(`/api/commissions/${id}/pay`, {}, { headers: authHeader() });
      toast.success(t('accounting.marked_as_paid')); fetchData();
    } catch { toast.error(t('accounting.failed_to_mark_paid')); }
  };

  const displayed = commissions.filter(c =>
    (!search || c.marketing_person.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || c.paid_status === statusFilter)
  );

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">Commission Management</h1><p className="section-subtitle mt-1">Track marketing commissions and payments</p></div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> Record Commission</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="Total Commissions" value={commissions.length} loading={loading} icon={<Users className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title="Unpaid Amount" value={`৳${totalUnpaid.toLocaleString()}`} loading={loading} icon={<Clock className="w-5 h-5"/>} iconBg="bg-red-50 text-red-600" />
          <KPICard title="Paid Amount" value={`৳${totalPaid.toLocaleString()}`} loading={loading} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title="Total Value" value={`৳${(totalPaid + totalUnpaid).toLocaleString()}`} loading={loading} icon={<FileText className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t("common.search_marketing_person")} value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" /></div>
          <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
            {[['', 'All'], ['unpaid', 'Unpaid'], ['paid', 'Paid']].map(([val, label]) => (
              <button key={val} onClick={() => setStatusFilter(val)} className={`px-3 py-2 font-medium transition-colors ${statusFilter === val ? 'bg-[var(--color-primary)] text-white' : 'bg-white hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>#</th><th>Person</th><th>Mobile</th><th>Patient</th><th className="text-right">Amount (৳)</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>
          {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
          : displayed.length === 0 ? <tr><td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]">No commissions</td></tr>
          : displayed.map((com, idx) => (
              <tr key={com.id}>
                <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                <td className="font-medium">{com.marketing_person}</td>
                <td className="text-[var(--color-text-secondary)] font-data">{com.mobile || '—'}</td>
                <td>{com.patient_name ? <><span className="font-medium">{com.patient_name}</span><span className="text-xs text-[var(--color-text-muted)] ml-1">{com.patient_code}</span></> : '—'}</td>
                <td className="text-right font-data font-medium">৳{com.commission_amount.toLocaleString()}</td>
                <td><span className={`badge ${com.paid_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{com.paid_status === 'paid' ? 'Paid' : 'Unpaid'}</span></td>
                <td className="font-data text-sm text-[var(--color-text-muted)]">{com.paid_date || com.created_at?.split('T')[0]}</td>
                <td>{com.paid_status !== 'paid' && <button onClick={() => markPaid(com.id)} className="btn-ghost p-1.5 text-emerald-600" title="Mark Paid"><Check className="w-4 h-4" /></button>}</td>
              </tr>
            ))}
        </tbody></table></div></div>

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">Record Commission</h3><button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                <div><label className="label">{t('common.marketing_person_')}</label><input className="input" required value={form.marketingPerson} onChange={e => setForm({ ...form, marketingPerson: e.target.value })} /></div>
                <div><label className="label">{t('common.mobile')}</label><input className="input" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('common.patient_id')}</label><input className="input" type="number" value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })} /></div>
                  <div><label className="label">{t('common.bill_id')}</label><input className="input" type="number" value={form.billId} onChange={e => setForm({ ...form, billId: e.target.value })} /></div>
                </div>
                <div><label className="label">{t('common.amount_')}</label><input className="input" type="number" required min="1" value={form.commissionAmount} onChange={e => setForm({ ...form, commissionAmount: e.target.value })} /></div>
                <div><label className="label">{t('common.notes')}</label><textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Record'}</button></div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

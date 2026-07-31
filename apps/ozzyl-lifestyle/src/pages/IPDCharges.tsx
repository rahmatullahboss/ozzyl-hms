import { useState, useEffect, useCallback } from 'react';
import { BedDouble, Plus, X, Search, Trash2, DollarSign, Calendar } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';

interface Charge {
  id: number; admission_id: number; patient_id: number; charge_date: string;
  charge_type: string; description?: string; amount: number; posted_by?: number;
}

const TYPE_LABELS: Record<string, string> = { room: 'Room/Ward', nursing: 'Nursing', other: 'Other' };

const DEMO: Charge[] = [
  { id: 1, admission_id: 1, patient_id: 1, charge_date: '2026-03-13', charge_type: 'room', description: 'General Ward - Day 3', amount: 1500 },
  { id: 2, admission_id: 1, patient_id: 1, charge_date: '2026-03-13', charge_type: 'nursing', description: 'IV drip monitoring', amount: 500 },
  { id: 3, admission_id: 1, patient_id: 1, charge_date: '2026-03-12', charge_type: 'room', description: 'General Ward - Day 2', amount: 1500 },
  { id: 4, admission_id: 1, patient_id: 1, charge_date: '2026-03-12', charge_type: 'other', description: 'Oxygen supply', amount: 800 },
];

export default function IPDCharges({ role = 'hospital_admin' }: { role?: string }) {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [admissionId, setAdmissionId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ admissionId: '', patientId: '', chargeDate: new Date().toISOString().split('T')[0], chargeType: 'room', description: '', amount: '' });
  const { t } = useTranslation(['common']);

  // ESC-to-close modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fetchCharges = useCallback(async () => {
    if (!admissionId) { setCharges(DEMO); setLoading(false); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/ipd-charges', { params: { admission_id: admissionId }, headers: { Authorization: `Bearer ${token}` } });
      setCharges(data.charges ?? []);
    } catch { setCharges(DEMO); } finally { setLoading(false); }
  }, [admissionId]);

  useEffect(() => { fetchCharges(); }, [fetchCharges]);

  const total = charges.reduce((s, c) => s + c.amount, 0);
  const roomTotal = charges.filter(c => c.charge_type === 'room').reduce((s, c) => s + c.amount, 0);
  const nursingTotal = charges.filter(c => c.charge_type === 'nursing').reduce((s, c) => s + c.amount, 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/ipd-charges', {
        admission_id: parseInt(form.admissionId), patient_id: parseInt(form.patientId),
        charge_date: form.chargeDate, charge_type: form.chargeType,
        description: form.description || undefined, amount: parseFloat(form.amount),
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('ipd.charge_added')); setShowCreate(false);
      if (admissionId === form.admissionId) fetchCharges();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed'); } finally { setSaving(false); }
  };

  const handleDelete = async (chargeId: number) => {
    if (!confirm('Delete this charge? This cannot be undone.')) return;
    try {
      const token = localStorage.getItem('hms_token');
      await axios.delete(`/api/ipd-charges/${chargeId}`, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('ipd.charge_deleted')); fetchCharges();
    } catch { toast.error(t('ipd.failed_to_delete')); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">IPD Daily Charges</h1><p className="section-subtitle mt-1">Manage ward charges, nursing fees, and other IPD costs</p></div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> Add Charge</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="Total Charges" value={`৳${total.toLocaleString()}`} loading={loading} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title="Room/Ward" value={`৳${roomTotal.toLocaleString()}`} loading={loading} icon={<BedDouble className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title="Nursing" value={`৳${nursingTotal.toLocaleString()}`} loading={loading} icon={<BedDouble className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title="Entries" value={charges.length} loading={loading} icon={<Calendar className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="number" placeholder={t("ipd.enterAdmissionId")} value={admissionId} onChange={e => setAdmissionId(e.target.value)} className="input pl-9" />
          </div>
        </div>

        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th className="text-right">Amount (৳)</th><th>Actions</th></tr></thead><tbody>
          {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
          : charges.length === 0 ? <tr><td colSpan={5} className="py-16 text-center text-[var(--color-text-muted)]">No charges found. Enter an admission ID above.</td></tr>
          : charges.map(ch => (
              <tr key={ch.id}>
                <td className="font-data">{ch.charge_date}</td>
                <td><span className={`badge ${ch.charge_type === 'room' ? 'badge-primary' : ch.charge_type === 'nursing' ? 'badge-success' : 'badge-warning'}`}>{TYPE_LABELS[ch.charge_type] || ch.charge_type}</span></td>
                <td>{ch.description || '—'}</td>
                <td className="text-right font-data font-medium">৳{ch.amount.toLocaleString()}</td>
                <td><button onClick={() => handleDelete(ch.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></td>
              </tr>
            ))}
        </tbody></table></div></div>

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">Add IPD Charge</h3><button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('ipd.admission_id_')}</label><input className="input" type="number" required value={form.admissionId} onChange={e => setForm({ ...form, admissionId: e.target.value })} /></div>
                  <div><label className="label">{t('ipd.patient_id_')}</label><input className="input" type="number" required value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('ipd.date_')}</label><input className="input" type="date" required value={form.chargeDate} onChange={e => setForm({ ...form, chargeDate: e.target.value })} /></div>
                  <div><label className="label">{t('ipd.type_')}</label><select className="input" value={form.chargeType} onChange={e => setForm({ ...form, chargeType: e.target.value })}><option value="room">Room/Ward</option><option value="nursing">Nursing</option><option value="other">Other</option></select></div>
                </div>
                <div><label className="label">{t('ipd.description')}</label><input className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t("ipd.descriptionExample")} /></div>
                <div><label className="label">{t('ipd.amount_')}</label><input className="input" type="number" required min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Add Charge'}</button></div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Skull, Plus, X, Search, RefreshCw, CheckCircle, Shield, FileText, Users } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface MortRecord {
  id: number; record_number: string; deceased_name: string; age?: number; gender?: string;
  date_of_death: string; cause_of_death?: string; place_of_death?: string;
  storage_unit?: string; is_mlc: number; status: string;
  handover_to?: string; handover_date?: string;
  postmortem_required: number; postmortem_done: number;
  police_noc_received: number;
}
interface Stats { total: number; currently_held: number; handed_over: number; mlc_cases: number; pending_postmortem: number; awaiting_noc: number; }

const STATUS_BADGE: Record<string, string> = { received: 'bg-gray-100 text-gray-600', preserved: 'bg-blue-100 text-blue-700', awaiting_noc: 'bg-amber-100 text-amber-700', awaiting_postmortem: 'bg-purple-100 text-purple-700', ready_for_handover: 'badge-success', handed_over: 'bg-green-100 text-green-700', transferred: 'badge-neutral' };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation('inventory');
  return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"><div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto"><div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4">{children}</div></div></div>);
}

export default function MortuaryManagement({ role }: { role?: string }) {
  const [items, setItems] = useState<MortRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHandover, setShowHandover] = useState<number | null>(null);
  const [handoverForm, setHandoverForm] = useState({ handover_to: '', handover_relation: '', handover_id_number: '', handover_phone: '', handover_witnessed_by: '' });
  const [form, setForm] = useState({ deceased_name: '', age: '', gender: 'Male', date_of_death: new Date().toISOString().split('T')[0], time_of_death: '', cause_of_death: '', place_of_death: '', storage_unit: '', is_mlc: false, preservation_type: 'refrigeration', postmortem_required: false, remarks: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const [rRes, sRes] = await Promise.all([axios.get('/api/mortuary', { params, headers: authHeader() }), axios.get('/api/mortuary/stats', { headers: authHeader() })]);
      setItems(rRes.data?.data ?? []); setStats(sRes.data ?? null);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [search, statusFilter]);
  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/mortuary', { ...form, age: form.age ? Number(form.age) : undefined, is_mlc: form.is_mlc, postmortem_required: form.postmortem_required }, { headers: authHeader() });
      toast.success(t('inventory.record_created')); setShowForm(false); load();
    } catch { toast.error(t('inventory.failed')); } finally { setSaving(false); }
  };

  const updateStatus = async (id: number, status: string) => {
    try { await axios.put(`/api/mortuary/${id}/status`, { status }, { headers: authHeader() }); toast.success(`→ ${status.replace('_', ' ')}`); load(); } catch { toast.error(t('inventory.failed')); }
  };

  const handover = async () => {
    if (!showHandover || !handoverForm.handover_to) { toast.error(t('inventory.recipient_name_required')); return; }
    try { await axios.put(`/api/mortuary/${showHandover}/handover`, handoverForm, { headers: authHeader() }); toast.success(t('inventory.body_handed_over')); setShowHandover(null); load(); } catch { toast.error(t('inventory.failed')); }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center shadow-lg shadow-gray-500/20"><Skull className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">Mortuary</h1><p className="section-subtitle">Body intake, preservation, post-mortem & handover</p></div>
        </div><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> New Record</button></div>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { l: 'Total', v: stats.total }, { l: 'Currently Held', v: stats.currently_held, c: 'text-blue-600' },
              { l: 'Handed Over', v: stats.handed_over, c: 'text-green-600' }, { l: 'MLC Cases', v: stats.mlc_cases, c: 'text-red-500' },
              { l: 'Pending PM', v: stats.pending_postmortem, c: 'text-purple-600' }, { l: 'Awaiting NOC', v: stats.awaiting_noc, c: 'text-amber-600' },
            ].map(k => <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-xl font-bold mt-1 ${k.c ?? ''}`}>{k.v}</p></div>)}
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end">
          <input className="input flex-1 min-w-48" placeholder={t("common.search_name_or_record")} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="input w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="received">Received</option><option value="preserved">Preserved</option>
            <option value="awaiting_noc">Awaiting NOC</option><option value="awaiting_postmortem">Awaiting PM</option>
            <option value="ready_for_handover">Ready</option><option value="handed_over">Handed Over</option>
          </select>
          <button onClick={load} className="btn-ghost"><RefreshCw className="w-4 h-4" /></button>
        </div>

        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Record #</th><th>Deceased</th><th>Age/Gender</th><th>Death Date</th><th>Cause</th><th>Place</th><th>MLC</th><th>PM</th><th>Status</th><th></th></tr></thead><tbody>
          {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(10)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
          : items.length === 0 ? <tr><td colSpan={10} className="text-center py-8 text-[var(--color-text-muted)]">No records</td></tr>
          : items.map(r => (
            <tr key={r.id}>
              <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{r.record_number}</td>
              <td className="font-medium">{r.deceased_name}</td>
              <td className="text-sm text-[var(--color-text-muted)]">{r.age ? `${r.age}y` : '—'}{r.gender ? `, ${r.gender}` : ''}</td>
              <td className="text-sm">{r.date_of_death}</td>
              <td className="text-xs text-[var(--color-text-muted)] max-w-32 truncate">{r.cause_of_death ?? '—'}</td>
              <td className="text-xs">{r.place_of_death ?? '—'}</td>
              <td>{r.is_mlc ? <Shield className="w-4 h-4 text-red-500" /> : '—'}</td>
              <td>{r.postmortem_required ? (r.postmortem_done ? <CheckCircle className="w-4 h-4 text-green-500" /> : <span className="text-xs text-amber-600">Pending</span>) : '—'}</td>
              <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status] ?? 'badge-neutral'}`}>{r.status.replace(/_/g, ' ')}</span></td>
              <td><div className="flex gap-1">
                {r.status === 'received' && <button onClick={() => updateStatus(r.id, 'preserved')} className="btn-ghost text-xs p-1" title="Mark Preserved"><CheckCircle className="w-3.5 h-3.5 text-blue-600" /></button>}
                {r.status === 'ready_for_handover' && <button onClick={() => setShowHandover(r.id)} className="btn-ghost text-xs p-1" title="Handover"><Users className="w-3.5 h-3.5 text-green-600" /></button>}
              </div></td>
            </tr>
          ))}
        </tbody></table></div></div>

        {showForm && (
          <Modal title="New Mortuary Record" onClose={() => setShowForm(false)}>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div><label className="label">{t('common.deceased_name_')}</label><input className="input w-full" required value={form.deceased_name} onChange={e => setForm({...form, deceased_name: e.target.value})} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('common.age')}</label><input className="input w-full" type="number" value={form.age} onChange={e => setForm({...form, age: e.target.value})} /></div>
                <div><label className="label">{t('common.gender')}</label><select className="input w-full" value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}><option>Male</option><option>Female</option><option>Other</option></select></div>
                <div><label className="label">{t('common.death_date_')}</label><input type="date" className="input w-full" required value={form.date_of_death} onChange={e => setForm({...form, date_of_death: e.target.value})} /></div>
              </div>
              <div><label className="label">{t('common.cause_of_death')}</label><input className="input w-full" value={form.cause_of_death} onChange={e => setForm({...form, cause_of_death: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Place of Death</label><input className="input w-full" value={form.place_of_death} onChange={e => setForm({...form, place_of_death: e.target.value})} placeholder={t("common.ward_a_icu")} /></div>
                <div><label className="label">Storage Unit</label><input className="input w-full" value={form.storage_unit} onChange={e => setForm({...form, storage_unit: e.target.value})} placeholder={t("common.freezer_1")} /></div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_mlc} onChange={e => setForm({...form, is_mlc: e.target.checked})} /><span className="text-sm">Medico-Legal Case</span></label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.postmortem_required} onChange={e => setForm({...form, postmortem_required: e.target.checked})} /><span className="text-sm">Post-mortem Required</span></label>
              </div>
              <div><label className="label">{t('common.remarks')}</label><textarea className="input w-full" rows={2} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
              <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Create'}</button></div>
            </form>
          </Modal>
        )}

        {showHandover !== null && (
          <Modal title="Body Handover" onClose={() => setShowHandover(null)}>
            <div className="space-y-3">
              <div><label className="label">{t('common.receiving_person_')}</label><input className="input w-full" value={handoverForm.handover_to} onChange={e => setHandoverForm({...handoverForm, handover_to: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Relation</label><input className="input w-full" value={handoverForm.handover_relation} onChange={e => setHandoverForm({...handoverForm, handover_relation: e.target.value})} placeholder={t("common.son_brother")} /></div>
                <div><label className="label">{t('common.id_number')}</label><input className="input w-full" value={handoverForm.handover_id_number} onChange={e => setHandoverForm({...handoverForm, handover_id_number: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('common.phone')}</label><input className="input w-full" value={handoverForm.handover_phone} onChange={e => setHandoverForm({...handoverForm, handover_phone: e.target.value})} /></div>
                <div><label className="label">{t('common.witnessed_by')}</label><input className="input w-full" value={handoverForm.handover_witnessed_by} onChange={e => setHandoverForm({...handoverForm, handover_witnessed_by: e.target.value})} /></div>
              </div>
              <div className="flex justify-end gap-3 pt-2"><button onClick={() => setShowHandover(null)} className="btn-secondary">Cancel</button><button onClick={handover} className="btn-primary">Confirm Handover</button></div>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert, Plus, X, Search, RefreshCw, FileText, Eye,
  AlertTriangle, Clock, ChevronRight,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface MlcCase {
  id: number; mlc_number: string; patient_name?: string; patient_code?: string;
  case_type: string; case_date: string; status: string; police_station?: string;
  fir_number?: string; nature_of_injury?: string; general_condition?: string;
  brought_by?: string; examining_doctor_name?: string;
}
interface MlcDetail extends MlcCase {
  patient_address?: string; patient_phone?: string; gender?: string; age?: number;
  incident_place?: string; incident_description?: string; injury_description?: string;
  provisional_opinion?: string; final_opinion?: string;
  injuries: { id: number; injury_number: number; body_part: string; injury_type?: string; size_cm?: string; description?: string }[];
  notes: { id: number; note_type: string; note_text: string; noted_at: string }[];
}

const CASE_TYPES = ['accident','assault','poisoning','burns','sexual_assault','suicide_attempt','snake_bite','dog_bite','industrial','drowning','hanging','firearm','stabbing','other'];
const CASE_BADGE: Record<string, string> = { accident: 'bg-amber-100 text-amber-700', assault: 'bg-red-100 text-red-700', poisoning: 'bg-purple-100 text-purple-700', burns: 'bg-orange-100 text-orange-700', sexual_assault: 'bg-red-200 text-red-800', suicide_attempt: 'bg-pink-100 text-pink-700', snake_bite: 'bg-green-100 text-green-700', firearm: 'bg-red-100 text-red-700', stabbing: 'bg-red-100 text-red-600' };
const STATUS_BADGE: Record<string, string> = { active: 'badge-warning', discharged: 'badge-success', referred: 'bg-blue-100 text-blue-700', absconded: 'bg-orange-100 text-orange-700', expired: 'bg-gray-200 text-gray-600', closed: 'badge-neutral' };
const NATURE_BADGE: Record<string, string> = { simple: 'badge-success', grievous: 'badge-warning', dangerous: 'bg-orange-100 text-orange-700', fatal: 'bg-red-100 text-red-700' };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation('clinical');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export default function MlcManagement({ role }: { role?: string }) {
  const [cases, setCases] = useState<MlcCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<MlcDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [stats, setStats] = useState<{ total: number; active: number; closed: number } | null>(null);

  const [form, setForm] = useState({
    patient_id: '', case_type: 'accident', case_date: new Date().toISOString().split('T')[0],
    case_time: '', brought_by: '', police_station: '', fir_number: '',
    police_officer_name: '', informant_name: '', informant_phone: '',
    incident_place: '', incident_description: '',
    general_condition: 'conscious', injury_description: '',
    alcohol_smell: false, provisional_opinion: '', examining_doctor_name: '',
    nature_of_injury: '',
  });

  // Note form
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState('progress');
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (typeFilter) params.case_type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const [cRes, sRes] = await Promise.all([
        axios.get('/api/mlc', { params, headers: authHeader() }),
        axios.get('/api/mlc/stats', { headers: authHeader() }),
      ]);
      setCases(cRes.data?.data ?? []);
      setStats(sRes.data?.stats ?? null);
    } catch { setCases([]); }
    finally { setLoading(false); }
  }, [search, typeFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (id: number) => {
    try {
      const { data } = await axios.get(`/api/mlc/${id}`, { headers: authHeader() });
      setDetail(data);
      setShowDetail(true);
    } catch { toast.error(t('clinical.failed_to_load_details')); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patient_id) { toast.error(t('clinical.patient_id_required')); return; }
    setSaving(true);
    try {
      const { data } = await axios.post('/api/mlc', {
        ...form, patient_id: Number(form.patient_id),
        alcohol_smell: form.alcohol_smell,
        nature_of_injury: form.nature_of_injury || undefined,
      }, { headers: authHeader() });
      toast.success(t('clinical.mlcRegistered', { mlcNumber: data.mlc_number }));
      setShowForm(false); load();
    } catch { toast.error(t('clinical.failed')); }
    finally { setSaving(false); }
  };

  const addNote = async () => {
    if (!detail || !noteText) return;
    setSavingNote(true);
    try {
      await axios.post(`/api/mlc/${detail.id}/notes`, { note_type: noteType, note_text: noteText }, { headers: authHeader() });
      toast.success(t('clinical.note_added'));
      setNoteText('');
      loadDetail(detail.id);
    } catch { toast.error(t('clinical.failed')); }
    finally { setSavingNote(false); }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/20">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Medico-Legal Cases</h1>
              <p className="section-subtitle">MLC register, injury documentation & police liaison</p>
            </div>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> New MLC</button>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">Total Cases</p><p className="text-2xl font-bold">{stats.total}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">Active</p><p className="text-2xl font-bold text-amber-600">{stats.active}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">Closed</p><p className="text-2xl font-bold text-green-600">{stats.closed}</p></div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end">
          <input className="input flex-1 min-w-48" placeholder={t("common.search_mlc_patient_fir")} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="input w-36" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {CASE_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <select className="input w-32" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option><option value="closed">Closed</option>
            <option value="discharged">Discharged</option><option value="expired">Expired</option>
          </select>
          <button onClick={load} className="btn-ghost"><RefreshCw className="w-4 h-4" /></button>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>MLC #</th><th>Patient</th><th>Type</th><th>Date</th><th>Police Station</th><th>FIR #</th><th>Nature</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                : cases.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">No MLC cases found</td></tr>
                : cases.map(c => (
                  <tr key={c.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => loadDetail(c.id)}>
                    <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{c.mlc_number}</td>
                    <td><span className="font-medium">{c.patient_name ?? '—'}</span><br /><span className="text-xs text-[var(--color-text-muted)]">{c.patient_code}</span></td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CASE_BADGE[c.case_type] ?? 'badge-neutral'}`}>{c.case_type.replace('_', ' ')}</span></td>
                    <td className="text-sm">{c.case_date?.slice(0, 10)}</td>
                    <td className="text-sm text-[var(--color-text-muted)]">{c.police_station ?? '—'}</td>
                    <td className="text-sm font-mono">{c.fir_number ?? '—'}</td>
                    <td>{c.nature_of_injury ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${NATURE_BADGE[c.nature_of_injury] ?? ''}`}>{c.nature_of_injury}</span> : '—'}</td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[c.status] ?? 'badge-neutral'}`}>{c.status}</span></td>
                    <td><Eye className="w-4 h-4 text-[var(--color-text-muted)]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* New MLC Form */}
        {showForm && (
          <Modal title="Register New MLC Case" onClose={() => setShowForm(false)}>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('common.patient_id_')}</label><input className="input w-full" required type="number" value={form.patient_id} onChange={e => setForm({...form, patient_id: e.target.value})} /></div>
                <div><label className="label">{t('common.case_type_')}</label>
                  <select className="input w-full" value={form.case_type} onChange={e => setForm({...form, case_type: e.target.value})}>
                    {CASE_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('common.date_')}</label><input type="date" className="input w-full" required value={form.case_date} onChange={e => setForm({...form, case_date: e.target.value})} /></div>
                <div><label className="label">{t('common.time')}</label><input type="time" className="input w-full" value={form.case_time} onChange={e => setForm({...form, case_time: e.target.value})} /></div>
                <div><label className="label">Brought By</label><input className="input w-full" value={form.brought_by} onChange={e => setForm({...form, brought_by: e.target.value})} placeholder={t("common.police_relative")} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('common.police_station')}</label><input className="input w-full" value={form.police_station} onChange={e => setForm({...form, police_station: e.target.value})} /></div>
                <div><label className="label">{t('common.fir_number')}</label><input className="input w-full" value={form.fir_number} onChange={e => setForm({...form, fir_number: e.target.value})} /></div>
                <div><label className="label">{t('common.officer_name')}</label><input className="input w-full" value={form.police_officer_name} onChange={e => setForm({...form, police_officer_name: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('common.informant_name')}</label><input className="input w-full" value={form.informant_name} onChange={e => setForm({...form, informant_name: e.target.value})} /></div>
                <div><label className="label">{t('common.informant_phone')}</label><input className="input w-full" value={form.informant_phone} onChange={e => setForm({...form, informant_phone: e.target.value})} /></div>
              </div>
              <div><label className="label">{t('common.incident_place')}</label><input className="input w-full" value={form.incident_place} onChange={e => setForm({...form, incident_place: e.target.value})} /></div>
              <div><label className="label">{t('common.incident_description')}</label><textarea className="input w-full" rows={2} value={form.incident_description} onChange={e => setForm({...form, incident_description: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('common.general_condition')}</label>
                  <select className="input w-full" value={form.general_condition} onChange={e => setForm({...form, general_condition: e.target.value})}>
                    <option value="conscious">Conscious</option><option value="semiconscious">Semi-conscious</option>
                    <option value="unconscious">Unconscious</option><option value="dead">Dead</option>
                  </select>
                </div>
                <div><label className="label">{t('common.nature_of_injury')}</label>
                  <select className="input w-full" value={form.nature_of_injury} onChange={e => setForm({...form, nature_of_injury: e.target.value})}>
                    <option value="">Not determined</option>
                    <option value="simple">Simple</option><option value="grievous">Grievous</option>
                    <option value="dangerous">Dangerous</option><option value="fatal">Fatal</option>
                  </select>
                </div>
              </div>
              <div><label className="label">{t('common.injury_description')}</label><textarea className="input w-full" rows={2} value={form.injury_description} onChange={e => setForm({...form, injury_description: e.target.value})} /></div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.alcohol_smell} onChange={e => setForm({...form, alcohol_smell: e.target.checked})} /><span className="text-sm">Smell of alcohol</span></label>
              <div><label className="label">{t('common.examining_doctor')}</label><input className="input w-full" value={form.examining_doctor_name} onChange={e => setForm({...form, examining_doctor_name: e.target.value})} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Register MLC'}</button>
              </div>
            </form>
          </Modal>
        )}

        {/* Detail Modal */}
        {showDetail && detail && (
          <Modal title={`MLC ${detail.mlc_number}`} onClose={() => setShowDetail(false)}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-[var(--color-text-muted)] text-xs">Patient</span><p className="font-medium">{detail.patient_name}</p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">Type</span><p><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CASE_BADGE[detail.case_type] ?? ''}`}>{detail.case_type.replace('_', ' ')}</span></p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">Date</span><p>{detail.case_date}</p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">Status</span><p><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[detail.status] ?? ''}`}>{detail.status}</span></p></div>
                {detail.police_station && <div><span className="text-[var(--color-text-muted)] text-xs">Police Station</span><p>{detail.police_station}</p></div>}
                {detail.fir_number && <div><span className="text-[var(--color-text-muted)] text-xs">FIR #</span><p className="font-mono">{detail.fir_number}</p></div>}
              </div>

              {detail.incident_description && (
                <div className="bg-[var(--color-bg-secondary)] rounded-lg p-3">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">Incident</p>
                  <p className="text-sm">{detail.incident_description}</p>
                </div>
              )}

              {detail.injuries.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Injuries ({detail.injuries.length})</p>
                  <div className="space-y-1">
                    {detail.injuries.map(inj => (
                      <div key={inj.id} className="flex items-start gap-2 p-2 rounded bg-red-50 dark:bg-red-950/20 text-sm">
                        <span className="font-bold text-red-600 shrink-0">#{inj.injury_number}</span>
                        <div><span className="font-medium">{inj.body_part}</span>{inj.injury_type && ` — ${inj.injury_type}`}{inj.size_cm && ` (${inj.size_cm})`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.notes.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Notes & Timeline</p>
                  <div className="space-y-1.5">
                    {detail.notes.map(n => (
                      <div key={n.id} className="flex items-start gap-2 p-2 rounded border border-[var(--color-border)] text-sm">
                        <span className="badge-neutral text-xs shrink-0">{n.note_type}</span>
                        <div className="flex-1"><p>{n.note_text}</p><p className="text-xs text-[var(--color-text-muted)] mt-0.5">{n.noted_at?.slice(0, 16).replace('T', ' ')}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-[var(--color-border)] pt-3">
                <p className="text-sm font-semibold mb-2">Add Note</p>
                <div className="flex gap-2">
                  <select className="input w-36 text-sm" value={noteType} onChange={e => setNoteType(e.target.value)}>
                    <option value="progress">Progress</option><option value="police_visit">Police Visit</option>
                    <option value="court_order">Court Order</option><option value="sample_sent">Sample Sent</option>
                    <option value="opinion_given">Opinion Given</option><option value="discharge">Discharge</option>
                  </select>
                  <input className="input flex-1 text-sm" placeholder="Note text..." value={noteText} onChange={e => setNoteText(e.target.value)} />
                  <button onClick={addNote} disabled={savingNote || !noteText} className="btn-primary text-sm">{savingNote ? '...' : 'Add'}</button>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}

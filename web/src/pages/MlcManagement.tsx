import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert, Plus, X, Search, RefreshCw, FileText, Eye,
  AlertTriangle, Clock, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';

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
  const { t } = useTranslation(['mlc', 'common', 'clinical']);
  const queryClient = useQueryClient();
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
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (typeFilter) params.set('case_type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const [cRes, sRes] = await Promise.all([
        api.get<{ data?: MlcCase[] }>(`/api/mlc${qs}`),
        api.get<{ stats?: { total: number; active: number; closed: number } }>('/api/mlc/stats'),
      ]);
      setCases((cRes as any)?.data ?? []);
      setStats((sRes as any)?.stats ?? null);
    } catch { setCases([]); }
    finally { setLoading(false); }
  }, [search, typeFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = async (id: number) => {
    try {
      const data = await api.get<MlcDetail>(`/api/mlc/${id}`);
      setDetail(data);
      setShowDetail(true);
    } catch { toast.error(t('notification.failedToLoadDetails', { ns: 'mlc' })); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patient_id) { toast.error(t('notification.patientIdRequired', { ns: 'mlc' })); return; }
    setSaving(true);
    try {
      const data = await api.post<{ mlc_number?: string }>('/api/mlc', {
        ...form, patient_id: Number(form.patient_id),
        alcohol_smell: form.alcohol_smell,
        nature_of_injury: form.nature_of_injury || undefined,
      });
      toast.success(t('notification.mlcRegistered', { ns: 'mlc', mlcNumber: (data as any).mlc_number }));
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.mlc.all });
      load();
    } catch { toast.error(t('notification.failed', { ns: 'mlc' })); }
    finally { setSaving(false); }
  };

  const addNote = async () => {
    if (!detail || !noteText) return;
    setSavingNote(true);
    try {
      await api.post(`/api/mlc/${detail.id}/notes`, { note_type: noteType, note_text: noteText });
      toast.success(t('notification.noteAdded', { ns: 'mlc' }));
      setNoteText('');
      queryClient.invalidateQueries({ queryKey: queryKeys.mlc.detail(detail.id) });
      loadDetail(detail.id);
    } catch { toast.error(t('notification.failed', { ns: 'mlc' })); }
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
              <h1 className="page-title">{t('title', { ns: 'mlc' })}</h1>
              <p className="section-subtitle">{t('subtitle', { ns: 'mlc' })}</p>
            </div>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('newMlc', { ns: 'mlc' })}</button>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{t('total', { ns: 'mlc' })}</p><p className="text-2xl font-bold">{stats.total}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{t('active', { ns: 'mlc' })}</p><p className="text-2xl font-bold text-amber-600">{stats.active}</p></div>
            <div className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{t('closed', { ns: 'mlc' })}</p><p className="text-2xl font-bold text-green-600">{stats.closed}</p></div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end">
          <input className="input flex-1 min-w-48" placeholder={t("search_mlc_patient_fir", { ns: 'common' })} value={search} onChange={e => setSearch(e.target.value)} />
          <select className="input w-36" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">{t('allTypes', { ns: 'mlc' })}</option>
            {CASE_TYPES.map(ct => <option key={ct} value={ct}>{t(`types.${ct}`, { ns: 'mlc', defaultValue: ct.replace('_', ' ') })}</option>)}
          </select>
          <select className="input w-32" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('allStatus', { ns: 'mlc' })}</option>
            <option value="active">{t('status.active', { ns: 'mlc' })}</option>
            <option value="closed">{t('status.closed', { ns: 'mlc' })}</option>
            <option value="discharged">{t('status.discharged', { ns: 'mlc' })}</option>
            <option value="expired">{t('status.expired', { ns: 'mlc' })}</option>
          </select>
          <button onClick={load} className="btn-ghost"><RefreshCw className="w-4 h-4" /></button>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr>
                <th>{t('table.mlcNumber', { ns: 'mlc' })}</th>
                <th>{t('table.patient', { ns: 'mlc' })}</th>
                <th>{t('table.type', { ns: 'mlc' })}</th>
                <th>{t('table.date', { ns: 'mlc' })}</th>
                <th>{t('table.policeStation', { ns: 'mlc' })}</th>
                <th>{t('table.firNumber', { ns: 'mlc' })}</th>
                <th>{t('table.nature', { ns: 'mlc' })}</th>
                <th>{t('table.status', { ns: 'mlc' })}</th>
                <th></th>
              </tr></thead>
              <tbody>
                {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                : cases.length === 0 ? <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">{t('noCases', { ns: 'mlc' })}</td></tr>
                : cases.map(c => (
                  <tr key={c.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => loadDetail(c.id)}>
                    <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{c.mlc_number}</td>
                    <td><span className="font-medium">{c.patient_name ?? '—'}</span><br /><span className="text-xs text-[var(--color-text-muted)]">{c.patient_code}</span></td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CASE_BADGE[c.case_type] ?? 'badge-neutral'}`}>{t(`types.${c.case_type}`, { ns: 'mlc', defaultValue: c.case_type.replace('_', ' ') })}</span></td>
                    <td className="text-sm">{c.case_date?.slice(0, 10)}</td>
                    <td className="text-sm text-[var(--color-text-muted)]">{c.police_station ?? '—'}</td>
                    <td className="text-sm font-mono">{c.fir_number ?? '—'}</td>
                    <td>{c.nature_of_injury ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${NATURE_BADGE[c.nature_of_injury] ?? ''}`}>{t(`nature.${c.nature_of_injury}`, { ns: 'mlc', defaultValue: c.nature_of_injury })}</span> : '—'}</td>
                    <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[c.status] ?? 'badge-neutral'}`}>{t(`status.${c.status}`, { ns: 'mlc', defaultValue: c.status })}</span></td>
                    <td><Eye className="w-4 h-4 text-[var(--color-text-muted)]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* New MLC Form */}
        {showForm && (
          <Modal title={t('form.registerTitle', { ns: 'mlc' })} onClose={() => setShowForm(false)}>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('patientId', { ns: 'common' })}</label><input className="input w-full" required type="number" value={form.patient_id} onChange={e => setForm({...form, patient_id: e.target.value})} /></div>
                <div><label className="label">{t('table.type', { ns: 'mlc' })}</label>
                  <select className="input w-full" value={form.case_type} onChange={e => setForm({...form, case_type: e.target.value})}>
                    {CASE_TYPES.map(ct => <option key={ct} value={ct}>{t(`types.${ct}`, { ns: 'mlc', defaultValue: ct.replace('_', ' ') })}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('date', { ns: 'common' })}</label><input type="date" className="input w-full" required value={form.case_date} onChange={e => setForm({...form, case_date: e.target.value})} /></div>
                <div><label className="label">{t('time', { ns: 'common' })}</label><input type="time" className="input w-full" value={form.case_time} onChange={e => setForm({...form, case_time: e.target.value})} /></div>
                <div><label className="label">{t('form.broughtBy', { ns: 'mlc' })}</label><input className="input w-full" value={form.brought_by} onChange={e => setForm({...form, brought_by: e.target.value})} placeholder={t("form.policeRelativePlaceholder", { ns: 'mlc' })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('form.policeStation', { ns: 'mlc' })}</label><input className="input w-full" value={form.police_station} onChange={e => setForm({...form, police_station: e.target.value})} /></div>
                <div><label className="label">{t('form.firNumber', { ns: 'mlc' })}</label><input className="input w-full" value={form.fir_number} onChange={e => setForm({...form, fir_number: e.target.value})} /></div>
                <div><label className="label">{t('form.officerName', { ns: 'mlc' })}</label><input className="input w-full" value={form.police_officer_name} onChange={e => setForm({...form, police_officer_name: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('form.informantName', { ns: 'mlc' })}</label><input className="input w-full" value={form.informant_name} onChange={e => setForm({...form, informant_name: e.target.value})} /></div>
                <div><label className="label">{t('form.informantPhone', { ns: 'mlc' })}</label><input className="input w-full" value={form.informant_phone} onChange={e => setForm({...form, informant_phone: e.target.value})} /></div>
              </div>
              <div><label className="label">{t('form.incidentPlace', { ns: 'mlc' })}</label><input className="input w-full" value={form.incident_place} onChange={e => setForm({...form, incident_place: e.target.value})} /></div>
              <div><label className="label">{t('form.incidentDescription', { ns: 'mlc' })}</label><textarea className="input w-full" rows={2} value={form.incident_description} onChange={e => setForm({...form, incident_description: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('form.generalCondition', { ns: 'mlc' })}</label>
                  <select className="input w-full" value={form.general_condition} onChange={e => setForm({...form, general_condition: e.target.value})}>
                    <option value="conscious">{t('conditions.conscious', { ns: 'mlc' })}</option>
                    <option value="semiconscious">{t('conditions.semiconscious', { ns: 'mlc' })}</option>
                    <option value="unconscious">{t('conditions.unconscious', { ns: 'mlc' })}</option>
                    <option value="dead">{t('conditions.dead', { ns: 'mlc' })}</option>
                  </select>
                </div>
                <div><label className="label">{t('form.natureOfInjury', { ns: 'mlc' })}</label>
                  <select className="input w-full" value={form.nature_of_injury} onChange={e => setForm({...form, nature_of_injury: e.target.value})}>
                    <option value="">{t('common.notSpecified', { ns: 'clinical' })}</option>
                    <option value="simple">{t('nature.simple', { ns: 'mlc' })}</option>
                    <option value="grievous">{t('nature.grievous', { ns: 'mlc' })}</option>
                    <option value="dangerous">{t('nature.dangerous', { ns: 'mlc' })}</option>
                    <option value="fatal">{t('nature.fatal', { ns: 'mlc' })}</option>
                  </select>
                </div>
              </div>
              <div><label className="label">{t('form.injuryDescription', { ns: 'mlc' })}</label><textarea className="input w-full" rows={2} value={form.injury_description} onChange={e => setForm({...form, injury_description: e.target.value})} /></div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.alcohol_smell} onChange={e => setForm({...form, alcohol_smell: e.target.checked})} />
                <span className="text-sm">{t('form.alcoholSmell', { ns: 'mlc' })}</span>
              </label>
              <div><label className="label">{t('form.examiningDoctor', { ns: 'mlc' })}</label><input className="input w-full" value={form.examining_doctor_name} onChange={e => setForm({...form, examining_doctor_name: e.target.value})} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? t('form.saving', { ns: 'mlc' }) : t('form.registerBtn', { ns: 'mlc' })}</button>
              </div>
            </form>
          </Modal>
        )}

        {/* Detail Modal */}
        {showDetail && detail && (
          <Modal title={t('detail.title', { ns: 'mlc', mlcNumber: detail.mlc_number })} onClose={() => setShowDetail(false)}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-[var(--color-text-muted)] text-xs">{t('table.patient', { ns: 'mlc' })}</span><p className="font-medium">{detail.patient_name}</p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">{t('table.type', { ns: 'mlc' })}</span><p><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CASE_BADGE[detail.case_type] ?? ''}`}>{t(`types.${detail.case_type}`, { ns: 'mlc', defaultValue: detail.case_type.replace('_', ' ') })}</span></p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">{t('table.date', { ns: 'mlc' })}</span><p>{detail.case_date}</p></div>
                <div><span className="text-[var(--color-text-muted)] text-xs">{t('table.status', { ns: 'mlc' })}</span><p><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[detail.status] ?? ''}`}>{t(`status.${detail.status}`, { ns: 'mlc', defaultValue: detail.status })}</span></p></div>
                {detail.police_station && <div><span className="text-[var(--color-text-muted)] text-xs">{t('form.policeStation', { ns: 'mlc' })}</span><p>{detail.police_station}</p></div>}
                {detail.fir_number && <div><span className="text-[var(--color-text-muted)] text-xs">{t('form.firNumber', { ns: 'mlc' })}</span><p className="font-mono">{detail.fir_number}</p></div>}
              </div>

              {detail.incident_description && (
                <div className="bg-[var(--color-bg-secondary)] rounded-lg p-3">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-1">{t('detail.incident', { ns: 'mlc' })}</p>
                  <p className="text-sm">{detail.incident_description}</p>
                </div>
              )}

              {detail.injuries.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">{t('detail.injuries', { ns: 'mlc' })} ({detail.injuries.length})</p>
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
                  <p className="text-sm font-semibold mb-2">{t('detail.notesTimeline', { ns: 'mlc' })}</p>
                  <div className="space-y-1.5">
                    {detail.notes.map(n => (
                      <div key={n.id} className="flex items-start gap-2 p-2 rounded border border-[var(--color-border)] text-sm">
                        <span className="badge-neutral text-xs shrink-0">{t(`note_types.${n.note_type}`, { ns: 'mlc', defaultValue: n.note_type })}</span>
                        <div className="flex-1"><p>{n.note_text}</p><p className="text-xs text-[var(--color-text-muted)] mt-0.5">{n.noted_at?.slice(0, 16).replace('T', ' ')}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-[var(--color-border)] pt-3">
                <p className="text-sm font-semibold mb-2">{t('detail.addNote', { ns: 'mlc' })}</p>
                <div className="flex gap-2">
                  <select className="input w-36 text-sm" value={noteType} onChange={e => setNoteType(e.target.value)}>
                    <option value="progress">{t('note_types.progress', { ns: 'mlc' })}</option>
                    <option value="police_visit">{t('note_types.police_visit', { ns: 'mlc' })}</option>
                    <option value="court_order">{t('note_types.court_order', { ns: 'mlc' })}</option>
                    <option value="sample_sent">{t('note_types.sample_sent', { ns: 'mlc' })}</option>
                    <option value="opinion_given">{t('note_types.opinion_given', { ns: 'mlc' })}</option>
                    <option value="discharge">{t('note_types.discharge', { ns: 'mlc' })}</option>
                  </select>
                  <input className="input flex-1 text-sm" placeholder={t('detail.notePlaceholder', { ns: 'mlc' })} value={noteText} onChange={e => setNoteText(e.target.value)} />
                  <button onClick={addNote} disabled={savingNote || !noteText} className="btn-primary text-sm">{savingNote ? '...' : t('detail.add', { ns: 'mlc' })}</button>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}

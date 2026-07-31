import { useState, useEffect, useCallback } from 'react';
import { Stethoscope, Plus, X, Search, Eye, Calendar, Clock, Video, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

interface Consultation {
  id: number; doctor_id: number; patient_id: number; scheduled_at: string; duration_min: number;
  status: string; chief_complaint?: string; notes?: string; room_url?: string;
  doctor_name: string; doctor_specialty?: string; patient_name: string; patient_code: string;
  prescription?: string; followup_date?: string;
}

const STATUS_BADGE: Record<string, { label: string; badge: string }> = {
  scheduled: { label: 'Scheduled', badge: 'badge-primary' }, in_progress: { label: 'In Progress', badge: 'badge-warning' },
  completed: { label: 'Completed', badge: 'badge-success' }, cancelled: { label: 'Cancelled', badge: 'badge-danger' },
};



export default function ConsultationNotes({ role = 'hospital_admin' }: { role?: string }) {
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [selected, setSelected] = useState<Consultation | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ doctorId: '', patientId: '', scheduledAt: '', durationMin: '30', chiefComplaint: '', notes: '' });
  const { t } = useTranslation(['common']);

  // ESC-to-close modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowCreate(false); setShowDetail(false); setForm({ doctorId: '', patientId: '', scheduledAt: '', durationMin: '30', chiefComplaint: '', notes: '' }); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await axios.get('/api/consultations', { params, headers: authHeader() });
      setConsultations(data.consultations ?? []);
    } catch { setConsultations([]); } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  const todayCount = consultations.filter(c => c.scheduled_at.startsWith(new Date().toISOString().split('T')[0])).length;
  const displayed = consultations.filter(c =>
    (!search || c.patient_name.toLowerCase().includes(search.toLowerCase()) || c.doctor_name.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || c.status === statusFilter)
  );

  const viewDetail = async (con: Consultation) => {
    try { const { data } = await axios.get(`/api/consultations/${con.id}`, { headers: authHeader() }); setSelected(data.consultation ?? con); } catch { setSelected(con); }
    setShowDetail(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/consultations', { doctorId: Number(form.doctorId), patientId: Number(form.patientId), scheduledAt: form.scheduledAt, durationMin: Number(form.durationMin) || 30, chiefComplaint: form.chiefComplaint || undefined, notes: form.notes || undefined }, { headers: authHeader() });
      toast.success(t('clinical.consultation_booked')); setShowCreate(false); setForm({ doctorId: '', patientId: '', scheduledAt: '', durationMin: '30', chiefComplaint: '', notes: '' }); fetch();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed'); } finally { setSaving(false); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">Consultation Notes</h1><p className="section-subtitle mt-1">Manage teleconsultations and records</p></div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> Book Consultation</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="Total" value={consultations.length} loading={loading} icon={<Stethoscope className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title="Today" value={todayCount} loading={loading} icon={<Calendar className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title="Scheduled" value={consultations.filter(c => c.status === 'scheduled').length} loading={loading} icon={<Clock className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
          <KPICard title="Completed" value={consultations.filter(c => c.status === 'completed').length} loading={loading} icon={<FileText className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t("ot.search_doctor_or_patient")} value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" /></div>
          <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
            {[['', 'All'], ['scheduled', 'Scheduled'], ['completed', 'Done'], ['cancelled', 'Cancelled']].map(([val, label]) => (
              <button key={val} onClick={() => setStatusFilter(val)} className={`px-3 py-2 font-medium transition-colors ${statusFilter === val ? 'bg-[var(--color-primary)] text-white' : 'bg-white hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Date/Time</th><th>Patient</th><th>Doctor</th><th>Duration</th><th>Complaint</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
          : displayed.length === 0 ? <tr><td colSpan={7} className="py-16 text-center text-[var(--color-text-muted)]">No consultations</td></tr>
          : displayed.map(con => {
              const st = STATUS_BADGE[con.status] ?? STATUS_BADGE.scheduled; const dt = new Date(con.scheduled_at);
              return (<tr key={con.id}>
                <td className="font-data text-sm"><div>{dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div><div className="text-[var(--color-text-muted)]">{dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div></td>
                <td><div className="font-medium">{con.patient_name}</div><div className="text-xs text-[var(--color-text-muted)]">{con.patient_code}</div></td>
                <td className="font-medium">{con.doctor_name}</td>
                <td className="font-data text-sm">{con.duration_min}min</td>
                <td className="text-sm max-w-[200px] truncate">{con.chief_complaint || '—'}</td>
                <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                <td><div className="flex gap-1.5"><button onClick={() => viewDetail(con)} className="btn-ghost p-1.5"><Eye className="w-4 h-4" /></button>
                  {con.status === 'scheduled' && con.room_url && <a href={con.room_url} target="_blank" rel="noopener" className="btn-ghost p-1.5 text-emerald-600"><Video className="w-4 h-4" /></a>}
                </div></td>
              </tr>);
            })}
        </tbody></table></div></div>

        {showDetail && selected && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><div><h3 className="font-semibold">Consultation #{selected.id}</h3><p className="text-sm text-[var(--color-text-muted)]">{selected.patient_name} • {selected.doctor_name}</p></div><button onClick={() => setShowDetail(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
              <div className="p-5 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-[var(--color-text-muted)]">Date:</span> {new Date(selected.scheduled_at).toLocaleString()}</div>
                  <div><span className="text-[var(--color-text-muted)]">Duration:</span> {selected.duration_min}min</div>
                </div>
                {selected.chief_complaint && <div className="bg-[var(--color-surface)] p-3 rounded-lg"><p className="text-xs text-[var(--color-text-muted)] mb-1">Chief Complaint</p><p>{selected.chief_complaint}</p></div>}
                {selected.notes && <div className="bg-[var(--color-surface)] p-3 rounded-lg"><p className="text-xs text-[var(--color-text-muted)] mb-1">Notes</p><p>{selected.notes}</p></div>}
                {selected.prescription && <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200"><p className="text-xs text-emerald-600 mb-1 font-medium">Prescription</p><p className="text-emerald-800">{selected.prescription}</p></div>}
                {selected.followup_date && <p className="text-[var(--color-text-muted)]">Follow-up: <span className="font-medium">{selected.followup_date}</span></p>}
              </div>
            </div>
          </div>
        )}

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">Book Consultation</h3><button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                <div><label className="label">{t('ot.doctor_id_')}</label><input className="input" type="number" required value={form.doctorId} onChange={e => setForm({ ...form, doctorId: e.target.value })} /></div>
                <div><label className="label">{t('ot.patient_id_')}</label><input className="input" type="number" required value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4"><div><label className="label">{t('ot.date_time_')}</label><input className="input" type="datetime-local" required value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })} /></div><div><label className="label">{t('ot.duration')}</label><input className="input" type="number" min="5" value={form.durationMin} onChange={e => setForm({ ...form, durationMin: e.target.value })} /></div></div>
                <div><label className="label">{t('ot.chief_complaint')}</label><input className="input" value={form.chiefComplaint} onChange={e => setForm({ ...form, chiefComplaint: e.target.value })} /></div>
                <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Booking…' : 'Book'}</button></div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

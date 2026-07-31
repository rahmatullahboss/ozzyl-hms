import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Plus, X, Edit2, Trash2, Calendar } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Doctor {
  id: number;
  name: string;
  specialty?: string;
  bmdc_reg_no?: string;
  qualifications?: string;
  visiting_hours?: string;
  schedule_count: number;
}

type DayOfWeek = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
type SessionType = 'morning' | 'afternoon' | 'evening' | 'night';

interface Schedule {
  id: number;
  doctor_id: number;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
  session_type: SessionType;
  chamber?: string;
  max_patients: number;
  notes?: string;
}

const DAYS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS: Record<DayOfWeek, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};
const SESSION_COLORS: Record<SessionType, string> = {
  morning:   'bg-teal-100 text-teal-800 border-teal-200',
  afternoon: 'bg-blue-100 text-blue-800 border-blue-200',
  evening:   'bg-amber-100 text-amber-800 border-amber-200',
  night:     'bg-slate-100 text-slate-700 border-slate-200',
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

const DEFAULT_FORM = {
  day_of_week: 'sun' as DayOfWeek,
  start_time: '09:00', end_time: '12:00',
  session_type: 'morning' as SessionType,
  chamber: '', max_patients: 20, notes: '',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function DoctorSchedule({
 role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['appointments', 'common']);

  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Load doctors
  useEffect(() => {
    axios.get('/api/doctor-schedules/doctors', { headers: authHeaders() })
      .then(r => {
        const docs: Doctor[] = r.data.doctors ?? [];
        setDoctors(docs);
        if (docs.length > 0 && !selectedDoctor) setSelectedDoctor(docs[0]);
      })
      .catch(() => {
        // Demo fallback
        const demo: Doctor[] = [
          { id: 1, name: 'Dr. Aminur Rahman', specialty: 'Internal Medicine', bmdc_reg_no: 'A-12345', qualifications: 'MBBS, FCPS', schedule_count: 5 },
          { id: 2, name: 'Dr. Nasreen Akter', specialty: 'Gynecology', schedule_count: 3 },
          { id: 3, name: 'Dr. Kamal Hossain', specialty: 'Surgery', schedule_count: 4 },
          { id: 4, name: 'Dr. Rabeya Khatun', specialty: 'Pediatrics', schedule_count: 2 },
        ];
        setDoctors(demo);
        setSelectedDoctor(demo[0]);
      });
  }, []);

  // Load schedules when doctor changes
  useEffect(() => {
    if (!selectedDoctor) return;
    axios.get(`/api/doctor-schedules?doctor_id=${selectedDoctor.id}`, { headers: authHeaders() })
      .then(r => setSchedules(r.data.schedules ?? []))
      .catch(() => {
        // Demo schedules
        setSchedules([
          { id: 1, doctor_id: selectedDoctor.id, day_of_week: 'sun', start_time: '09:00', end_time: '12:00', session_type: 'morning', chamber: 'Chamber 3', max_patients: 20 },
          { id: 2, doctor_id: selectedDoctor.id, day_of_week: 'sun', start_time: '16:00', end_time: '18:00', session_type: 'evening', chamber: 'Chamber 1', max_patients: 10 },
          { id: 3, doctor_id: selectedDoctor.id, day_of_week: 'tue', start_time: '09:00', end_time: '12:00', session_type: 'morning', chamber: 'Chamber 3', max_patients: 20 },
          { id: 4, doctor_id: selectedDoctor.id, day_of_week: 'tue', start_time: '14:00', end_time: '17:00', session_type: 'afternoon', chamber: 'OPD-2', max_patients: 15 },
          { id: 5, doctor_id: selectedDoctor.id, day_of_week: 'sat', start_time: '10:00', end_time: '13:00', session_type: 'morning', chamber: 'Chamber 3', max_patients: 25 },
        ]);
      });
  }, [selectedDoctor]);

  const openAdd = () => { setEditingId(null); setForm(DEFAULT_FORM); setShowModal(true); };
  const openEdit = (s: Schedule) => {
    setEditingId(s.id);
    setForm({ day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time,
               session_type: s.session_type, chamber: s.chamber ?? '', max_patients: s.max_patients, notes: s.notes ?? '' });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!selectedDoctor) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await axios.put(`/api/doctor-schedules/${editingId}`, form, { headers: authHeaders() });
        toast.success(t('appointments.schedule_updated'));
      } else {
        await axios.post('/api/doctor-schedules', { ...form, doctor_id: selectedDoctor.id }, { headers: authHeaders() });
        toast.success(t('appointments.schedule_added'));
      }
      setShowModal(false);
      // Refresh
      const r = await axios.get(`/api/doctor-schedules?doctor_id=${selectedDoctor.id}`, { headers: authHeaders() });
      setSchedules(r.data.schedules ?? []);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message : 'Failed to save schedule';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!selectedDoctor) return;
    if (!confirm('Remove this schedule slot?')) return;
    try {
      await axios.delete(`/api/doctor-schedules/${id}`, { headers: authHeaders() });
      toast.success(t('appointments.schedule_removed'));
      setSchedules(prev => prev.filter(s => s.id !== id));
    } catch {
      toast.error(t('appointments.failed_to_remove_schedule'));
    }
  };

  const schedulesByDay = (day: DayOfWeek) => schedules.filter(s => s.day_of_week === day);
  const totalSlots = schedules.length;
  const totalMaxPatients = schedules.reduce((sum, s) => sum + s.max_patients, 0);
  const avgPerSlot = totalSlots > 0 ? Math.round(totalMaxPatients / totalSlots) : 0;

  function initials(name: string) {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  }

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/doctors`} className="hover:underline">Doctors</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('schedule', { defaultValue: 'Schedule' })}</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">Doctor Schedule / Roster</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Manage doctor availability and consultation hours</p>
          </div>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add Schedule
          </button>
        </div>

        {/* Doctor Selector */}
        <div className="flex gap-3 overflow-x-auto pb-2">
          {doctors.map(doc => (
            <button key={doc.id}
              onClick={() => setSelectedDoctor(doc)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all whitespace-nowrap min-w-[200px] text-left ${
                selectedDoctor?.id === doc.id
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 shadow-sm'
                  : 'card hover:border-[var(--color-primary)]/40'
              }`}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                   style={{ background: 'var(--color-primary)' }}>
                {initials(doc.name)}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-[var(--color-text)] truncate">{doc.name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{doc.specialty ?? 'General'}</p>
                <span className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                  {doc.schedule_count} slot{doc.schedule_count !== 1 ? 's' : ''}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Weekly Grid */}
        {selectedDoctor && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
              <h2 className="font-semibold text-[var(--color-text)] text-sm">
                Weekly Schedule — {selectedDoctor.name}
              </h2>
              {selectedDoctor.bmdc_reg_no && (
                <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                  BMDC: {selectedDoctor.bmdc_reg_no}
                </span>
              )}
            </div>
            <div className="grid grid-cols-7 divide-x divide-[var(--color-border)]">
              {DAYS.map(day => {
                const daySlots = schedulesByDay(day);
                return (
                  <div key={day} className="flex flex-col min-h-[160px]">
                    <div className={`text-center text-xs font-medium py-2 border-b border-[var(--color-border)] ${
                      day === 'fri' ? 'bg-red-50 text-red-700' : 'bg-[var(--color-bg)] text-[var(--color-text-muted)]'
                    }`}>
                      {DAY_LABELS[day].slice(0, 3).toUpperCase()}
                    </div>
                    <div className="flex-1 p-2 space-y-2">
                      {daySlots.length === 0 ? (
                        <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-3 text-center">
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {day === 'fri' ? 'Holiday' : 'Off'}
                          </p>
                          <button onClick={() => { setForm(f => ({ ...f, day_of_week: day })); setEditingId(null); setShowModal(true); }}
                            className="text-[var(--color-primary)] mt-1">
                            <Plus className="w-4 h-4 mx-auto" />
                          </button>
                        </div>
                      ) : (
                        daySlots.map(slot => (
                          <div key={slot.id} className={`rounded-lg border p-2 text-xs group relative ${SESSION_COLORS[slot.session_type]}`}>
                            <p className="font-semibold">{slot.start_time}–{slot.end_time}</p>
                            <p className="capitalize">{slot.session_type}</p>
                            {slot.chamber && <p className="truncate opacity-80">{slot.chamber}</p>}
                            <p className="opacity-70">Max: {slot.max_patients}</p>
                            <div className="absolute top-1 right-1 hidden group-hover:flex gap-1">
                              <button aria-label="Edit schedule" onClick={() => openEdit(slot)} className="p-0.5 rounded hover:bg-black/10">
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button aria-label="Delete schedule" onClick={() => handleDelete(slot.id)} className="p-0.5 rounded hover:bg-red-200 text-red-600">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Weekly Slots', value: totalSlots },
            { label: 'Max Patients/Week', value: totalMaxPatients },
            { label: 'Avg Per Slot', value: avgPerSlot },
          ].map(({ label, value }) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>{value}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Add/Edit Modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">{editingId ? 'Edit Schedule' : 'Add Schedule Slot'}</h2>
              <button aria-label="Close modal" onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Day of Week</label>
                  <select value={form.day_of_week} onChange={e => setForm(f => ({ ...f, day_of_week: e.target.value as DayOfWeek }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
                    {DAYS.map(d => <option key={d} value={d}>{DAY_LABELS[d]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Session</label>
                  <select value={form.session_type} onChange={e => setForm(f => ({ ...f, session_type: e.target.value as SessionType }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
                    {(['morning','afternoon','evening','night'] as SessionType[]).map(s => (
                      <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Start Time</label>
                  <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">End Time</label>
                  <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Chamber / Room</label>
                  <input type="text" value={form.chamber} placeholder={t("appointments.eg_chamber_3")} onChange={e => setForm(f => ({ ...f, chamber: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Max Patients</label>
                  <input type="number" min={1} max={200} value={form.max_patients} onChange={e => setForm(f => ({ ...f, max_patients: parseInt(e.target.value) || 20 }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Notes</label>
                <input type="text" value={form.notes} placeholder={t("appointments.optional_notes")} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : editingId ? 'Update Slot' : 'Add Slot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

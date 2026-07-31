import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router';
import {
  Calendar, Clock, Plus, Search, CheckCircle2, XCircle,
  AlertCircle, User, Stethoscope, Hash, ChevronLeft, ChevronRight,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Appointment {
  id: number;
  appt_no: string;
  token_no: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  patient_mobile: string;
  doctor_id: number | null;
  doctor_name: string | null;
  doctor_specialty: string | null;
  appt_date: string;
  appt_time: string | null;
  visit_type: 'opd' | 'followup' | 'emergency';
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  chief_complaint: string | null;
  notes: string | null;
  fee: number;
  source?: string;
}

interface Doctor {
  id: number;
  name: string;
  specialty: string | null;
  consultation_fee: number;
}

interface Patient {
  id: number;
  name: string;
  patient_code: string;
  mobile: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function addDays(date: string, delta: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d.toISOString().split('T')[0];
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  completed:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled:  'bg-gray-100 text-gray-500 border-gray-200 line-through',
  no_show:    'bg-amber-50 text-amber-700 border-amber-200',
};
const STATUS_ICON: Record<string, React.ReactNode> = {
  scheduled:  <Clock className="w-3.5 h-3.5" />,
  completed:  <CheckCircle2 className="w-3.5 h-3.5" />,
  cancelled:  <XCircle className="w-3.5 h-3.5" />,
  no_show:    <AlertCircle className="w-3.5 h-3.5" />,
};
const VISIT_BADGE: Record<string, string> = {
  opd:       'bg-sky-100 text-sky-700',
  followup:  'bg-purple-100 text-purple-700',
  emergency: 'bg-red-100 text-red-700',
};

// ─── Book Appointment Modal ───────────────────────────────────────────────────

interface BookModalProps {
  date: string;
  doctors: Doctor[];
  onClose: () => void;
  onBooked: () => void;
}

function BookModal({ date, doctors, onClose, onBooked }: BookModalProps) {
  const [patientQuery, setPatientQuery] = useState('');
  const [patients, setPatients]         = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [doctorId, setDoctorId]   = useState('');
  const [apptTime, setApptTime]   = useState('');
  const [visitType, setVisitType] = useState<'opd' | 'followup' | 'emergency'>('opd');
  const [complaint, setComplaint] = useState('');
  const [fee, setFee]             = useState('');
  const [saving, setSaving]       = useState(false);

  // Search patients (debounced)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (patientQuery.length < 2) { setPatients([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const token = localStorage.getItem('hms_token');
      axios.get(`/api/patients?search=${encodeURIComponent(patientQuery)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => setPatients(r.data.patients ?? [])).catch(() => setPatients([]));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [patientQuery]);

  // Auto-fill fee from doctor
  useEffect(() => {
    const doc = doctors.find(d => String(d.id) === doctorId);
    if (doc) setFee(String(Math.round(doc.consultation_fee / 100))); // paisa → taka
  }, [doctorId, doctors]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) { toast.error(t('appointments.please_select_a_patient')); return; }

    setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      const res = await axios.post('/api/appointments', {
        patientId:      selectedPatient.id,
        doctorId:       doctorId ? Number(doctorId) : undefined,
        apptDate:       date,
        apptTime:       apptTime || undefined,
        visitType,
        chiefComplaint: complaint || undefined,
        fee:            fee ? Number(fee) : 0,
      }, { headers: { Authorization: `Bearer ${token}` } });

      toast.success(t('appointments.appointmentBooked', { tokenNo: res.data.tokenNo }));
      onBooked();
      onClose();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? (err.response?.data?.error ?? err.message) : 'Failed to book';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Book Appointment</h2>
          <p className="text-sm text-[var(--color-text-muted)]">{fmtDate(date)}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Patient search */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">Patient *</label>
            {selectedPatient ? (
              <div className="flex items-center justify-between p-2 rounded-lg border border-[var(--color-primary)] bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[var(--color-primary)]" />
                  <div>
                    <p className="text-sm font-medium">{selectedPatient.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{selectedPatient.patient_code} · {selectedPatient.mobile}</p>
                  </div>
                </div>
                <button type="button" onClick={() => { setSelectedPatient(null); setPatientQuery(''); }}
                  className="text-xs text-[var(--color-text-muted)] hover:text-red-500">Change</button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  value={patientQuery}
                  onChange={e => setPatientQuery(e.target.value)}
                  placeholder={t("appointments.search_by_name_id_or_mobile")}
                  className="input pl-9 w-full"
                />
                {patients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {patients.map(p => (
                      <button key={p.id} type="button"
                        onClick={() => { setSelectedPatient(p); setPatientQuery(''); setPatients([]); }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--color-bg-secondary)] text-left">
                        <User className="w-4 h-4 text-[var(--color-text-muted)]" />
                        <div>
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{p.patient_code} · {p.mobile}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Doctor + time row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">Doctor</label>
              <select value={doctorId} onChange={e => setDoctorId(e.target.value)} className="input w-full">
                <option value="">— Walk-in —</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` (${d.specialty})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">Time (opt.)</label>
              <input type="time" value={apptTime} onChange={e => setApptTime(e.target.value)} className="input w-full" />
            </div>
          </div>

          {/* Visit type + fee row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">Visit Type</label>
              <select value={visitType} onChange={e => setVisitType(e.target.value as typeof visitType)} className="input w-full">
                <option value="opd">OPD (New)</option>
                <option value="followup">Follow-up</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">Fee (৳)</label>
              <input type="number" value={fee} onChange={e => setFee(e.target.value)} placeholder={t("appointments.0")} min={0} className="input w-full" />
            </div>
          </div>

          {/* Chief complaint */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">Chief Complaint</label>
            <textarea value={complaint} onChange={e => setComplaint(e.target.value)}
              rows={2} placeholder={t("appointments.patients_main_concern")} className="input w-full resize-none" />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving || !selectedPatient} className="btn-primary flex-1">
              {saving ? 'Booking…' : 'Book Appointment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AppointmentScheduler({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t } = useTranslation(['appointments', 'common']);
  const [selectedDate, setSelectedDate]     = useState(isoToday());
  const [appointments, setAppointments]     = useState<Appointment[]>([]);
  const [doctors, setDoctors]               = useState<Doctor[]>([]);
  const [filterDoctorId, setFilterDoctorId] = useState('');
  const [filterStatus, setFilterStatus]     = useState('');
  const [filterSource, setFilterSource]     = useState('');
  const [loading, setLoading]               = useState(true);
  const [showBook, setShowBook]             = useState(false);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem('hms_token');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const params = new URLSearchParams({ date: selectedDate });
      if (filterDoctorId) params.set('doctorId', filterDoctorId);
      if (filterStatus)   params.set('status',   filterStatus);
      if (filterSource)   params.set('source',   filterSource);

      const [apptRes, docRes] = await Promise.all([
        axios.get(`/api/appointments?${params}`, { headers }),
        axios.get('/api/doctors', { headers }),
      ]);
      setAppointments(apptRes.data.appointments ?? []);
      setDoctors(docRes.data.doctors ?? []);
    } catch {
      // Deterministic demo data
      setAppointments([
        { id: 1, appt_no: 'APT-000001', token_no: 1, patient_id: 1, patient_name: 'Mohammad Karim', patient_code: 'P-00012', patient_mobile: '01711-234567', doctor_id: 1, doctor_name: 'Dr. Rahman', doctor_specialty: 'Medicine', appt_date: selectedDate, appt_time: '09:00', visit_type: 'opd', status: 'scheduled', chief_complaint: 'Fever and cough', notes: null, fee: 500, source: 'reception' },
        { id: 2, appt_no: 'APT-000002', token_no: 2, patient_id: 2, patient_name: 'Fatema Begum', patient_code: 'P-00013', patient_mobile: '01812-345678', doctor_id: 1, doctor_name: 'Dr. Rahman', doctor_specialty: 'Medicine', appt_date: selectedDate, appt_time: '09:30', visit_type: 'followup', status: 'completed', chief_complaint: 'Diabetes follow-up', notes: null, fee: 300, source: 'marketplace' },
        { id: 3, appt_no: 'APT-000003', token_no: 3, patient_id: 3, patient_name: 'Rahim Uddin', patient_code: 'P-00014', patient_mobile: '01912-345678', doctor_id: 2, doctor_name: 'Dr. Hossain', doctor_specialty: 'Cardiology', appt_date: selectedDate, appt_time: '10:00', visit_type: 'emergency', status: 'scheduled', chief_complaint: 'Chest pain', notes: null, fee: 800, source: 'reception' },
      ]);
      setDoctors([
        { id: 1, name: 'Dr. Rahman', specialty: 'Medicine', consultation_fee: 50000 },
        { id: 2, name: 'Dr. Hossain', specialty: 'Cardiology', consultation_fee: 80000 },
      ]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, filterDoctorId, filterStatus, filterSource]);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

  const updateStatus = async (id: number, status: string) => {
    const tok = localStorage.getItem('hms_token');
    try {
      await axios.put(`/api/appointments/${id}`, { status }, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      toast.success(t('appointments.status_updated'));
      fetchAppointments();
    } catch {
      toast.error(t('appointments.failed_to_update'));
    }
  };

  // Daily stats
  const stats = {
    total:     appointments.length,
    scheduled: appointments.filter(a => a.status === 'scheduled').length,
    completed: appointments.filter(a => a.status === 'completed').length,
    noShow:    appointments.filter(a => a.status === 'no_show').length,
  };

  const basePath = `/h/${slug}`;

  return (
    <DashboardLayout role={role}>
      {showBook && (
        <BookModal
          date={selectedDate}
          doctors={doctors}
          onClose={() => setShowBook(false)}
          onBooked={fetchAppointments}
        />
      )}

      <div className="space-y-4">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title', { defaultValue: 'Appointment Scheduler' })}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{fmtDate(selectedDate)}</p>
          </div>
          <button onClick={() => setShowBook(true)} className="btn-primary self-start sm:self-auto">
            <Plus className="w-4 h-4" /> {t('bookAppointment', { defaultValue: 'Book Appointment' })}
          </button>
        </div>

        {/* ── Date Nav ── */}
        <div className="card p-3 flex items-center gap-3">
          <button onClick={() => setSelectedDate(d => addDays(d, -1))} className="btn-secondary p-2">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="input flex-1 text-center font-medium"
          />
          <button onClick={() => setSelectedDate(d => addDays(d, +1))} className="btn-secondary p-2">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => setSelectedDate(isoToday())} className="btn-secondary text-sm px-3">
            Today
          </button>
        </div>

        {/* ── Stats Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total',     value: stats.total,     color: 'text-[var(--color-primary)]',  icon: <Calendar className="w-5 h-5" /> },
            { label: 'Scheduled', value: stats.scheduled, color: 'text-blue-600',                icon: <Clock className="w-5 h-5" /> },
            { label: 'Completed', value: stats.completed, color: 'text-emerald-600',             icon: <CheckCircle2 className="w-5 h-5" /> },
            { label: 'No Show',   value: stats.noShow,    color: 'text-amber-600',               icon: <AlertCircle className="w-5 h-5" /> },
          ].map(s => (
            <div key={s.label} className="card p-4 flex items-center gap-3">
              <div className={s.color}>{s.icon}</div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="card p-3 flex flex-wrap gap-2">
          <select value={filterDoctorId} onChange={e => setFilterDoctorId(e.target.value)} className="input text-sm">
            <option value="">All Doctors</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input text-sm">
            <option value="">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="no_show">No Show</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="input text-sm">
            <option value="">All Sources</option>
            <option value="marketplace">Marketplace</option>
            <option value="reception">Reception</option>
            <option value="telemedicine">Telemedicine</option>
          </select>
        </div>

        {/* ── Appointment Queue ── */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-4">
              {[1,2,3].map(i => <div key={i} className="skeleton h-16 rounded-lg" />)}
            </div>
          ) : appointments.length === 0 ? (
            <div className="py-16 text-center">
              <Calendar className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-[var(--color-text-muted)]">{t('noAppointments', { defaultValue: 'No appointments for this date.' })}</p>
              <button onClick={() => setShowBook(true)} className="btn-primary mt-4">
                <Plus className="w-4 h-4" /> Book First Appointment
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {appointments.map(appt => (
                <div key={appt.id} className={`flex items-start gap-4 p-4 transition-colors hover:bg-[var(--color-bg-secondary)] ${appt.status === 'cancelled' ? 'opacity-50' : ''}`}>

                  {/* Token Badge */}
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-[var(--color-bg-secondary)] flex flex-col items-center justify-center border border-[var(--color-border)]">
                    <Hash className="w-3 h-3 text-[var(--color-text-muted)]" />
                    <span className="text-lg font-bold text-[var(--color-primary)] leading-none">{appt.token_no}</span>
                  </div>

                  {/* Patient Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[var(--color-text-primary)]">{appt.patient_name}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">{appt.patient_code}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VISIT_BADGE[appt.visit_type]}`}>
                        {appt.visit_type === 'opd' ? 'OPD' : appt.visit_type === 'followup' ? 'Follow-up' : '🚨 Emergency'}
                      </span>
                      {appt.source === 'marketplace' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 text-purple-700 border border-purple-200">
                          Marketplace
                        </span>
                      )}
                      {appt.source === 'telemedicine' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-cyan-100 text-cyan-700 border border-cyan-200">
                          Telemedicine
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-[var(--color-text-muted)] flex-wrap">
                      {appt.doctor_name && (
                        <span className="flex items-center gap-1">
                          <Stethoscope className="w-3.5 h-3.5" /> {appt.doctor_name}
                        </span>
                      )}
                      {appt.appt_time && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> {appt.appt_time}
                        </span>
                      )}
                      {appt.chief_complaint && (
                        <span className="italic truncate max-w-[200px]">"{appt.chief_complaint}"</span>
                      )}
                    </div>
                  </div>

                  {/* Right: Status + Actions */}
                  <div className="flex-shrink-0 flex flex-col items-end gap-2">
                    <span className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_STYLE[appt.status]}`}>
                      {STATUS_ICON[appt.status]} {appt.status.replace(/_/g, ' ')}
                    </span>
                    {appt.fee > 0 && (
                      <span className="text-xs text-[var(--color-text-muted)]">৳{appt.fee}</span>
                    )}
                    {/* Quick action buttons */}
                    {appt.status === 'scheduled' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => updateStatus(appt.id, 'completed')}
                          title="Mark Completed"
                          className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => updateStatus(appt.id, 'no_show')}
                          title="Mark No Show"
                          className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 border border-amber-200">
                          <AlertCircle className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Cancel this appointment?')) updateStatus(appt.id, 'cancelled');
                          }}
                          title="Cancel"
                          className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 border border-red-200">
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {/* Link to patient detail */}
                    <Link
                      to={`${basePath}/${role === 'reception' ? 'reception/' : ''}patients/${appt.patient_id}`}
                      className="text-xs text-[var(--color-primary)] hover:underline">
                      View Patient →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

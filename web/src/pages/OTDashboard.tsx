import { useState, useEffect, Fragment } from 'react';
import { useNavigate } from 'react-router';
import {
  Scissors, Plus, X, Search, Calendar, Clock, CheckCircle,
  AlertCircle, XCircle, ChevronDown, ChevronUp, Maximize2, Siren
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import RoomMatrix from '../components/ot/RoomMatrix';
import BookingDetailDrawer from '../components/ot/BookingDetailDrawer';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OTBooking {
  id: number;
  patient_name?: string;
  patient_code?: string;
  booked_for_date: string;
  surgery_type?: string;
  diagnosis?: string;
  anesthesia_type?: string;
  is_active: number;
  finalized?: boolean;
  surgeons?: { staff_name: string }[];
  anesthetist?: { staff_name: string } | null;
  scrub_nurse?: { staff_name: string } | null;
}

interface OTStats {
  today_bookings: number;
  this_week: number;
  total_upcoming: number;
  cancelled: number;
}

interface OTBookingsResponse {
  bookings: OTBooking[];
}

const today = () => new Date().toISOString().split('T')[0];

const ANESTHESIA_TYPES = ['General', 'Spinal', 'Epidural', 'Local', 'Regional', 'IV Sedation'];
const SURGERY_TYPES = [
  'Appendectomy', 'Cholecystectomy', 'Hernia Repair', 'C-Section',
  'Hysterectomy', 'Laparotomy', 'TURP', 'Cataract', 'Other',
];

export default function OTDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['ot', 'common']);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [dateFilter, setDateFilter]   = useState(today());
  const [search, setSearch]           = useState('');
  const [expandedId, setExpandedId]   = useState<number | null>(null);

  // Create booking modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    patient_id: '', booked_for_date: today(),
    surgery_type: '', anesthesia_type: '', diagnosis: '', remarks: '',
  });

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState<OTBooking | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState('');

  // Emergency OT modal
  const [showEmergency, setShowEmergency] = useState(false);
  const [emergencyForm, setEmergencyForm] = useState({
    patient_id: '', name: '', age: '', gender: '',
    diagnosis: '', surgery_type: '', remarks: '',
  });

  // Booking detail drawer
  const [selectedBooking, setSelectedBooking] = useState<OTBooking | null>(null);

  // ESC to close
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreate(false); setCancelTarget(null); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  // ── Build query path with date filter ──
  const buildBookingsPath = () => {
    const params = new URLSearchParams();
    if (dateFilter) params.set('date', dateFilter);
    const qs = params.toString();
    return qs ? `/api/ot/bookings?${qs}` : '/api/ot/bookings';
  };

  // ── Fetch bookings via React Query ──
  const {
    data: bookingsData,
    isLoading: loading,
  } = useApiQuery<OTBookingsResponse>(
    queryKeys.ot.bookings({ date: dateFilter }),
    buildBookingsPath(),
    {
      placeholderData: (prev) => prev,
    },
  );
  const bookings = bookingsData?.bookings ?? [];

  // ── Fetch stats via React Query ──
  const {
    data: stats,
    isLoading: statsLoading,
  } = useApiQuery<OTStats>(
    queryKeys.ot.stats(),
    '/api/ot/stats',
  );

  // ── Create booking mutation ──
  const createMutation = useApiMutation<unknown, {
    patient_id: number;
    booked_for_date: string;
    surgery_type?: string;
    anesthesia_type?: string;
    diagnosis?: string;
    remarks?: string;
  }>(
    'post',
    '/api/ot/bookings',
    {
      onSuccess: () => {
        toast.success(t('ot.ot_booking_created'));
        setShowCreate(false);
        setForm({ patient_id: '', booked_for_date: today(), surgery_type: '', anesthesia_type: '', diagnosis: '', remarks: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.all });
      },
      onError: (err) => {
        toast.error(err.message || 'Failed');
      },
    },
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patient_id) { toast.error(t('ot.patient_id_is_required')); return; }
    createMutation.mutate({
      patient_id: parseInt(form.patient_id),
      booked_for_date: form.booked_for_date,
      surgery_type: form.surgery_type || undefined,
      anesthesia_type: form.anesthesia_type || undefined,
      diagnosis: form.diagnosis || undefined,
      remarks: form.remarks || undefined,
    });
  };

  // ── Cancel booking mutation ──
  const cancelMutation = useApiMutation<unknown, { id: number; cancellation_remarks?: string }>(
    'put',
    (vars) => `/api/ot/bookings/${vars.id}/cancel`,
    {
      onSuccess: () => {
        toast.success(t('ot.ot_booking_cancelled'));
        setCancelTarget(null);
        setCancelRemarks('');
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.all });
      },
      onError: (err) => {
        toast.error(err.message || 'Failed');
      },
    },
  );

  // ── Emergency OT mutation ──
  const emergencyMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/ot/bookings',
    {
      onSuccess: () => {
        toast.success('Emergency OT booking created');
        setShowEmergency(false);
        setEmergencyForm({ patient_id: '', name: '', age: '', gender: '', diagnosis: '', surgery_type: '', remarks: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.all });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const handleEmergency = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emergencyForm.patient_id && !emergencyForm.name) { toast.error('Patient ID or name required'); return; }
    const body: Record<string, unknown> = {
      patient_id: parseInt(emergencyForm.patient_id) || 0,
      booked_for_date: today(),
      is_emergency: 1,
      surgery_type: emergencyForm.surgery_type || undefined,
      diagnosis: emergencyForm.diagnosis || undefined,
      remarks: `EMERGENCY: ${emergencyForm.remarks || 'Emergency OT'}`,
    };
    emergencyMutation.mutate(body);
  };

  const handleCancel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    cancelMutation.mutate({
      id: cancelTarget.id,
      cancellation_remarks: cancelRemarks || undefined,
    });
  };

  const filtered = bookings.filter(b =>
    !search ||
    b.patient_name?.toLowerCase().includes(search.toLowerCase()) ||
    b.patient_code?.toLowerCase().includes(search.toLowerCase()) ||
    b.surgery_type?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Scissors className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title', { ns: 'ot' })}</h1>
              <p className="section-subtitle">{t('subtitle', { ns: 'ot' })}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowEmergency(true)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-red-500/20">
              <Siren className="w-4 h-4" /> Emergency OT
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> {t('scheduleBooking', { ns: 'ot' })}
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard title={t('today', { ns: 'ot' })}    value={stats?.today_bookings ?? '—'} loading={statsLoading} icon={<Calendar className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('thisWeek', { ns: 'ot' })} value={stats?.this_week ?? '—'}     loading={statsLoading} icon={<Clock className="w-5 h-5" />}    iconBg="bg-blue-50 text-blue-600"    index={1} />
          <KPICard title={t('upcoming', { ns: 'ot' })} value={stats?.total_upcoming ?? '—'} loading={statsLoading} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={2} />
          <KPICard title={t('cancelled', { ns: 'ot' })} value={stats?.cancelled ?? '—'}     loading={statsLoading} icon={<XCircle className="w-5 h-5" />}   iconBg="bg-rose-50 text-rose-600"    index={3} />
        </div>

        {/* Room Matrix */}
        <RoomMatrix />

        {/* Filters */}
        <div className="card p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="input py-1.5"
            />
          </div>
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('searchPlaceholder', { ns: 'ot' })}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <button onClick={() => setDateFilter(today())} className="btn-ghost text-sm">{t('today', { ns: 'ot' })}</button>
        </div>

        {/* Bookings Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('patient', { ns: 'ot' })}</th>
                  <th>{t('surgery', { ns: 'ot' })}</th>
                  <th>{t('date', { ns: 'ot' })}</th>
                  <th>{t('anesthesia', { ns: 'ot' })}</th>
                  <th>{t('diagnosis', { ns: 'ot' })}</th>
                  <th>{t('status', { ns: 'common' })}</th>
                  <th>{t('actions', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [...Array(4)].map((_, i) => (
                      <tr key={i}>
                        {[...Array(7)].map((_, j) => (
                          <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                        ))}
                      </tr>
                    ))
                  : filtered.length === 0
                  ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState
                            icon={<Scissors className="w-8 h-8 text-[var(--color-text-muted)]" />}
                            title={t('noBookings', { ns: 'ot' })}
                            description={t('noBookingsDesc', { ns: 'ot' })}
                            action={
                              <button onClick={() => setShowCreate(true)} className="btn-primary mt-2">
                                <Plus className="w-4 h-4" /> {t('scheduleFirst', { ns: 'ot' })}
                              </button>
                            }
                          />
                        </td>
                      </tr>
                    )
                  : filtered.map(b => (
                      <Fragment key={b.id}>
                        <tr className={b.is_active === 0 ? 'opacity-50' : ''}>
                          <td>
                            <p className="font-medium">{b.patient_name ?? '—'}</p>
                            {b.patient_code && <p className="text-xs text-[var(--color-text-muted)]">{b.patient_code}</p>}
                          </td>
                          <td>{b.surgery_type ?? '—'}</td>
                          <td className="font-data">{b.booked_for_date}</td>
                          <td>{b.anesthesia_type ?? '—'}</td>
                          <td className="max-w-xs truncate">{b.diagnosis ?? '—'}</td>
                          <td>
                            <span className={`badge ${b.is_active === 0 ? 'badge-error' : 'badge-success'}`}>
                              {b.is_active === 0 ? t('cancelled', { ns: 'ot' }) : t('scheduled', { ns: 'ot' })}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                                className="btn-ghost p-1.5 text-[var(--color-text-secondary)]"
                                title={t('viewDetails', { ns: 'ot' })}
                              >
                                {expandedId === b.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => setSelectedBooking(b)}
                                className="btn-ghost p-1.5 text-[var(--color-primary)]"
                                title="Open case"
                              >
                                <Scissors className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => navigate(`/ot/case/${b.id}`)}
                                className="btn-ghost p-1.5 text-[var(--color-text-secondary)]"
                                title="Full screen canvas"
                              >
                                <Maximize2 className="w-4 h-4" />
                              </button>
                              {b.is_active !== 0 && (
                                <button
                                  onClick={() => { setCancelTarget(b); setCancelRemarks(''); }}
                                  className="btn-ghost p-1.5 text-red-500"
                                  title={t('cancelBooking', { ns: 'ot' })}
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedId === b.id && (
                          <tr key={`${b.id}-detail`} className="bg-[var(--color-border-light)]">
                            <td colSpan={7} className="p-4">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                                <div>
                                  <p className="label mb-1">{t('surgeons', { ns: 'ot' })}</p>
                                  {b.surgeons && b.surgeons.length > 0
                                    ? b.surgeons.map((s, i) => <p key={i} className="font-medium">{s.staff_name}</p>)
                                    : <p className="text-[var(--color-text-muted)]">{t('notAssigned', { ns: 'ot' })}</p>}
                                </div>
                                <div>
                                  <p className="label mb-1">{t('anesthetist', { ns: 'ot' })}</p>
                                  <p className="font-medium">{b.anesthetist?.staff_name ?? t('notAssigned', { ns: 'ot' })}</p>
                                </div>
                                <div>
                                  <p className="label mb-1">{t('scrubNurse', { ns: 'ot' })}</p>
                                  <p className="font-medium">{b.scrub_nurse?.staff_name ?? t('notAssigned', { ns: 'ot' })}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─────────────── CREATE BOOKING MODAL ─────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
              <h3 className="font-semibold">{t('scheduleBooking', { ns: 'ot' })}</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('patientId', { ns: 'ot' })} *</label>
                  <input className="input" type="number" required value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} placeholder={t("ot.eg_42")} />
                </div>
                <div>
                  <label className="label">{t('date', { ns: 'ot' })} *</label>
                  <input className="input" type="date" required value={form.booked_for_date} onChange={e => setForm(f => ({ ...f, booked_for_date: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('surgeryType', { ns: 'ot' })}</label>
                  <select className="input" value={form.surgery_type} onChange={e => setForm(f => ({ ...f, surgery_type: e.target.value }))}>
                    <option value="">{t('select', { ns: 'common' })}…</option>
                    {SURGERY_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('anesthesia', { ns: 'ot' })}</label>
                  <select className="input" value={form.anesthesia_type} onChange={e => setForm(f => ({ ...f, anesthesia_type: e.target.value }))}>
                    <option value="">Select…</option>
                    {ANESTHESIA_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">{t('diagnosis', { ns: 'ot' })}</label>
                <input className="input" value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} placeholder={t("ot.eg_acute_appendicitis")} />
              </div>
              <div>
                <label className="label">{t('remarks', { ns: 'ot' })}</label>
                <textarea className="input resize-none" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('saving', { ns: 'ot' }) : t('createBooking', { ns: 'ot' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────── CANCEL MODAL ─────────────── */}
      {cancelTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold flex items-center gap-2 text-red-600"><AlertCircle className="w-5 h-5" /> {t('cancelBooking', { ns: 'ot' })}</h3>
              <button onClick={() => setCancelTarget(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCancel} className="p-5 space-y-4">
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t('cancelFor', { ns: 'ot' })} <span className="font-semibold">{cancelTarget.patient_name}</span> {t('on', { ns: 'ot' })} {cancelTarget.booked_for_date}?
              </p>
              <div>
                <label className="label">{t('cancellationReason', { ns: 'ot' })}</label>
                <textarea className="input resize-none" rows={2} value={cancelRemarks} onChange={e => setCancelRemarks(e.target.value)} placeholder={t("ot.optional_reason")} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setCancelTarget(null)} className="btn-secondary">{t('back', { ns: 'common' })}</button>
                <button type="submit" disabled={cancelMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {cancelMutation.isPending ? t('cancelling', { ns: 'ot' }) : t('confirmCancel', { ns: 'ot' })}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ─────────────── EMERGENCY OT MODAL ─────────────── */}
      {showEmergency && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto border-2 border-red-500">
            <div className="flex items-center justify-between p-5 border-b border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 sticky top-0">
              <h3 className="font-semibold flex items-center gap-2 text-red-700 dark:text-red-400">
                <Siren className="w-5 h-5" /> Emergency OT
              </h3>
              <button onClick={() => setShowEmergency(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleEmergency} className="p-5 space-y-4">
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300">
                Emergency mode bypasses clearance hard blocks. Consent and payment can be recorded later. Audit log is mandatory.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Patient ID *</label>
                  <input className="input" type="number" required value={emergencyForm.patient_id} onChange={e => setEmergencyForm(f => ({ ...f, patient_id: e.target.value }))} placeholder="Patient ID" />
                </div>
                <div>
                  <label className="label">Name (if available)</label>
                  <input className="input" value={emergencyForm.name} onChange={e => setEmergencyForm(f => ({ ...f, name: e.target.value }))} placeholder="Patient name" />
                </div>
                <div>
                  <label className="label">Age</label>
                  <input className="input" type="number" value={emergencyForm.age} onChange={e => setEmergencyForm(f => ({ ...f, age: e.target.value }))} placeholder="Age" />
                </div>
                <div>
                  <label className="label">Gender</label>
                  <select className="input" value={emergencyForm.gender} onChange={e => setEmergencyForm(f => ({ ...f, gender: e.target.value }))}>
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Emergency Diagnosis *</label>
                <input className="input" required value={emergencyForm.diagnosis} onChange={e => setEmergencyForm(f => ({ ...f, diagnosis: e.target.value }))} placeholder="e.g. Acute appendicitis with perforation" />
              </div>
              <div>
                <label className="label">Procedure</label>
                <input className="input" value={emergencyForm.surgery_type} onChange={e => setEmergencyForm(f => ({ ...f, surgery_type: e.target.value }))} placeholder="e.g. Appendectomy" />
              </div>
              <div>
                <label className="label">Reason for Emergency Override *</label>
                <textarea className="input resize-none" rows={2} required value={emergencyForm.remarks} onChange={e => setEmergencyForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Why is this an emergency?" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEmergency(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={emergencyMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {emergencyMutation.isPending ? 'Creating…' : 'Create Emergency OT'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────── BOOKING DETAIL DRAWER ─────────────── */}
      {selectedBooking && (
        <BookingDetailDrawer
          bookingId={selectedBooking.id}
          patientName={selectedBooking.patient_name}
          onClose={() => setSelectedBooking(null)}
        />
      )}
    </DashboardLayout>
  );
}

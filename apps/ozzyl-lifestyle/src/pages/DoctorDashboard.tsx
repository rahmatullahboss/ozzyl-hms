import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import {
  CalendarDays, CheckCircle2, Clock, Users,
  TrendingUp, TrendingDown, Minus,
  FlaskConical, Stethoscope, ArrowRight,
  Bell, CalendarCheck
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { formatDoctorName } from '../lib/doctor-display';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Doctor {
  id: number;
  name: string;
  specialty?: string;
  qualifications?: string;
  consultation_fee?: number;
}

interface Kpi {
  total: number;
  completed: number;
  waiting: number;
  in_progress: number;
  yesterday: number;
}

interface QueueItem {
  id: number;
  patient_id: number;
  token_no: number;
  appt_time: string;
  visit_type: string;
  status: string;
  patient_name: string;
  patient_code: string;
  date_of_birth?: string;
  gender?: string;
  chief_complaint?: string;
}

interface VisitType {
  visit_type: string;
  count: number;
}

interface RecentRx {
  id: number;
  rx_no: string;
  created_at: string;
  status: string;
  patient_name: string;
  patient_code: string;
}

interface FollowUp {
  rx_id: number;
  follow_up_date: string;
  patient_name: string;
  patient_code: string;
  mobile?: string;
}

interface DashData {
  doctor:     Doctor;
  today:      string;
  kpi:        Kpi;
  queue:      QueueItem[];
  visitTypes: VisitType[];
  recentRx:   RecentRx[];
  followUps:  FollowUp[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

function calcAge(dob?: string): string {
  if (!dob) return '?';
  const diff = Date.now() - new Date(dob).getTime();
  return `${Math.floor(diff / (365.25 * 24 * 3600 * 1000))}y`;
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now    = Date.now();
  return Math.ceil((target - now) / (1000 * 3600 * 24));
}

function formatTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

const STATUS_COLOR: Record<string, string> = {
  waiting:     'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-green-100 text-green-700',
  paid:        'bg-green-100 text-green-700',
  cancelled:   'bg-red-100 text-red-700',
};

const VISIT_COLOR: Record<string, string> = {
  opd:          'bg-teal-100 text-teal-700',
  telemedicine: 'bg-purple-100 text-purple-700',
  emergency:    'bg-red-100 text-red-700',
  followup:     'bg-indigo-100 text-indigo-700',
};

const SCHEDULE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon: Icon, trend }: {
  label: string; value: number; icon: React.ElementType; trend?: 'up' | 'down' | 'same'
}) {
  return (
    <div className="card p-4 flex items-center gap-4 border-l-4 border-l-[var(--color-primary)]">
      <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-[var(--color-primary)]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-2xl font-bold text-[var(--color-text)]">{value}</div>
        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{label}</div>
      </div>
      {trend && (
        <div className={`text-xs flex items-center gap-0.5 ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-gray-400'}`}>
          {trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : trend === 'down' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DoctorDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const { t } = useTranslation(['dashboard', 'common']);

  const [data,    setData]    = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/doctors/dashboard', { headers: authHeaders() })
      .then(r => setData(r.data))
      .catch(() => toast.error(t('dashboard.failed_to_load_dashboard')))
      .finally(() => setLoading(false));
  }, []);

  // Greet by time of day (BST)
  const hour = new Date(Date.now() + 6 * 3600 * 1000).getUTCHours();
  const greeting = hour < 12 ? t('goodMorning', { defaultValue: 'Good Morning' }) : hour < 17 ? t('goodAfternoon', { defaultValue: 'Good Afternoon' }) : t('goodEvening', { defaultValue: 'Good Evening' });

  const todayLabel = new Date().toLocaleDateString('en-BD', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--color-text-muted)]">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <div className="text-center text-[var(--color-text-muted)]">
          <Stethoscope className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Doctor profile not linked to this account.</p>
          <p className="text-sm mt-1">Please contact admin to link your doctor profile.</p>
        </div>
      </div>
    );
  }

  const { doctor, kpi, queue, visitTypes, recentRx, followUps } = data;
  const totalVisits = visitTypes.reduce((s, v) => s + Number(v.count), 0);

  // Trend
  const trend = kpi.total > kpi.yesterday ? 'up' : kpi.total < kpi.yesterday ? 'down' : 'same';

  // Build timeline slot map
  const slotMap: Record<number, QueueItem[]> = {};
  queue.forEach(q => {
    if (q.appt_time) {
      const h = parseInt(q.appt_time.split(':')[0]);
      if (!slotMap[h]) slotMap[h] = [];
      slotMap[h].push(q);
    }
  });

  const updateStatus = useCallback(async (apptId: number, newStatus: string) => {
    try {
      await axios.put(`/api/appointments/${apptId}`, { status: newStatus }, { headers: authHeaders() });
      setData(prev => {
        if (!prev) return prev;
        // Find the old status to decrement its KPI counter
        const oldItem = prev.queue.find(q => q.id === apptId);
        const oldStatus = oldItem?.status;
        const kpiCopy = { ...prev.kpi };
        // Decrement old status
        if (oldStatus === 'waiting')     kpiCopy.waiting     = Math.max(0, kpiCopy.waiting - 1);
        if (oldStatus === 'in_progress') kpiCopy.in_progress = Math.max(0, kpiCopy.in_progress - 1);
        // Increment new status
        if (newStatus === 'completed')   kpiCopy.completed   += 1;
        if (newStatus === 'in_progress') kpiCopy.in_progress += 1;
        if (newStatus === 'waiting')     kpiCopy.waiting     += 1;
        return {
          ...prev,
          queue: prev.queue.map(q => q.id === apptId ? { ...q, status: newStatus } : q),
          kpi: kpiCopy,
        };
      });
      toast.success(t('dashboard.status_updated'));
    } catch {
      toast.error(t('dashboard.failed_to_update_status'));
    }
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <div className="max-w-8xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">

        {/* ── Welcome Header ──────────────────────────────────────── */}
        <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
              {greeting}, {formatDoctorName(doctor.name)}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{todayLabel}</p>
            {doctor.specialty && (
              <p className="text-xs text-[var(--color-primary)] mt-1 font-medium">{doctor.specialty}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-green-100 text-green-700 text-sm font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              On Duty
            </span>
            <span className="bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-sm font-semibold px-3 py-1.5 rounded-full">
              {kpi.total} Patients Today
            </span>
          </div>
        </div>

        {/* ── KPI Row ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Today's Appointments" value={kpi.total}      icon={CalendarDays}  trend={trend} />
          <KpiCard label="Completed"             value={kpi.completed}  icon={CheckCircle2} />
          <KpiCard label="Waiting"               value={kpi.waiting}    icon={Clock} />
          <KpiCard label="In Progress"           value={kpi.in_progress} icon={Users} />
        </div>

        {/* ── Main 2-col ──────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-5 gap-6">

          {/* LEFT — Patient Queue (3/5) */}
          <div className="lg:col-span-3">
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
                <h2 className="font-semibold text-[var(--color-text)] flex items-center gap-2">
                  <Users className="w-4 h-4 text-[var(--color-primary)]" />
                  Today's Patient Queue
                </h2>
                <Link to={`${basePath}/appointments`}
                  className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1">
                  View All <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {queue.length === 0 ? (
                <div className="text-center py-12 text-[var(--color-text-muted)]">
                  <CalendarCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p>{t('noAppointments', { defaultValue: 'No appointments scheduled today' })}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-bg)]">
                      <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                        <th className="text-left px-4 py-2.5 font-medium w-12">Token</th>
                        <th className="text-left px-4 py-2.5 font-medium">Patient</th>
                        <th className="text-left px-4 py-2.5 font-medium w-20">Time</th>
                        <th className="text-left px-4 py-2.5 font-medium w-24">Type</th>
                        <th className="text-left px-4 py-2.5 font-medium w-28">Status</th>
                        <th className="text-left px-4 py-2.5 font-medium w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {queue.map((q, idx) => (
                        <tr key={q.id} className={idx % 2 === 0 ? 'bg-[var(--color-surface)]' : 'bg-[var(--color-bg)]'}>
                          <td className="px-4 py-3">
                            <span className="font-mono font-bold text-[var(--color-primary)] text-base">#{q.token_no}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-[var(--color-text)] truncate max-w-[160px]">{q.patient_name}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {q.patient_code} · {calcAge(q.date_of_birth)} · {q.gender ?? '?'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs">{formatTime(q.appt_time)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${VISIT_COLOR[q.visit_type] ?? 'bg-gray-100 text-gray-600'}`}>
                              {q.visit_type?.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {q.status?.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Link
                                to={`/h/${slug}/patients/${q.patient_id}/chart`}
                                className="btn-ghost text-xs">
                                Chart
                              </Link>
                              <Link
                                to={`${basePath}/prescriptions/new?patient=${q.patient_id}&appt=${q.id}`}
                                className="btn-primary text-xs">
                                Start Rx
                              </Link>
                              {q.status === 'waiting' && (
                                <button onClick={() => updateStatus(q.id, 'in_progress')}
                                  className="btn-ghost text-xs py-1 px-2 text-blue-600">
                                  Start
                                </button>
                              )}
                              {q.status === 'in_progress' && (
                                <button onClick={() => updateStatus(q.id, 'completed')}
                                  className="btn-ghost text-xs py-1 px-2 text-emerald-600">
                                  Done
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Stats + Rx + Follow-ups (2/5) */}
          <div className="lg:col-span-2 space-y-4">

            {/* Visit-type breakdown */}
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-[var(--color-text)] mb-4 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                Visit Type Breakdown
              </h3>
              {visitTypes.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-4">{t('noData', { defaultValue: 'No data today' })}</p>
              ) : (
                <div className="space-y-3">
                  {visitTypes.map(v => {
                    const pct = totalVisits > 0 ? Math.round((Number(v.count) / totalVisits) * 100) : 0;
                    return (
                      <div key={v.visit_type}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[var(--color-text)] capitalize font-medium">{v.visit_type?.replace(/_/g, ' ')}</span>
                          <span className="text-[var(--color-text-muted)]">{v.count} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-[var(--color-bg)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Prescriptions */}
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
                {t('recentPrescriptions', { defaultValue: 'Recent Prescriptions' })}
              </h3>
              {recentRx.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-3">No prescriptions yet</p>
              ) : (
                <div className="space-y-2">
                  {recentRx.map(rx => (
                    <div key={rx.id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                      <div>
                        <div className="text-sm font-medium text-[var(--color-text)]">{rx.patient_name}</div>
                        <div className="text-xs text-[var(--color-text-muted)] font-mono">{rx.rx_no}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${rx.status === 'final' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {rx.status}
                        </span>
                        <Link to={`${basePath}/prescriptions/${rx.id}`}
                          className="text-xs text-[var(--color-primary)] hover:underline">View</Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Link to={`${basePath}/prescriptions`}
                className="text-xs text-[var(--color-primary)] hover:underline mt-2 flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>

            {/* Upcoming Follow-ups */}
            <div className="card p-4">
              <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3 flex items-center gap-2">
                <Bell className="w-4 h-4 text-[var(--color-primary)]" />
                Upcoming Follow-ups
              </h3>
              {followUps.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] text-center py-3">No follow-ups in next 7 days</p>
              ) : (
                <div className="space-y-2">
                  {followUps.map((f, i) => {
                    const days = daysUntil(f.follow_up_date);
                    return (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                        <div>
                          <div className="text-sm font-medium text-[var(--color-text)]">{f.patient_name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{f.follow_up_date}</div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          days === 0 ? 'bg-red-100 text-red-700' :
                          days === 1 ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days}d`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Schedule Timeline ────────────────────────────────────── */}
        <div className="card p-5">
          <h2 className="font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-[var(--color-primary)]" />
            Today's Schedule
          </h2>
          <div className="overflow-x-auto">
            <div className="flex gap-2 min-w-max">
              {SCHEDULE_HOURS.map(h => {
                const slots = slotMap[h] ?? [];
                const label = `${h > 12 ? h - 12 : h}${h >= 12 ? 'PM' : 'AM'}`;
                return (
                  <div key={h} className="flex flex-col items-center gap-1 w-24">
                    <div className="text-xs text-[var(--color-text-muted)] font-medium">{label}</div>
                    <div className={`w-full rounded-lg p-2 min-h-[60px] text-xs flex flex-col gap-1 transition-colors ${
                      slots.length > 0
                        ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30'
                        : 'border-2 border-dashed border-[var(--color-border)]'
                    }`}>
                      {slots.length > 0 ? slots.map((s, i) => (
                        <div key={i} className="text-[var(--color-primary)] font-medium truncate">
                          #{s.token_no} {s.patient_name.split(' ')[0]}
                        </div>
                      )) : (
                        <span className="text-[var(--color-text-muted)] text-center mt-1 text-[10px]">Free</span>
                      )}
                    </div>
                    {slots.length > 0 && (
                      <div className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        slots.some(s => s.status === 'in_progress') ? 'bg-blue-100 text-blue-600' :
                        slots.every(s => ['completed','paid'].includes(s.status)) ? 'bg-green-100 text-green-600' :
                        'bg-amber-100 text-amber-600'
                      }`}>
                        {slots.length} pt{slots.length > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

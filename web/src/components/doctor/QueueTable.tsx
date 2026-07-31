import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import {
  Activity,
  AlertTriangle,
  Brain,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileText,
  FlaskConical as Conical,
  Heart,
  PauseCircle,
  PhoneCall,
  Play,
  Search,
  Stethoscope,
  UserRound,
  Users,
  XCircle,
  WalletCards,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatAgeFromDateOfBirth } from '../../lib/age';
import type { Doctor, QueueItem } from './types';

export { type QueueItem };

interface QueueTableProps {
  queue: QueueItem[];
  basePath: string;
  availableDoctors?: Doctor[];
  onUpdateStatus: (apptId: number, status: string) => void;
  onOpenAiSummary: (patientId: number) => void;
  onOpenWorkspace?: (item: QueueItem) => void;
  onReassign?: (apptId: number, doctorId: number, reason?: string) => void;
}

const VISIT_COLOR: Record<string, string> = {
  opd: 'bg-teal-100 text-teal-700',
  new_patient: 'bg-teal-100 text-teal-700',
  old_patient: 'bg-sky-100 text-sky-700',
  follow_up: 'bg-indigo-100 text-indigo-700',
  followup: 'bg-indigo-100 text-indigo-700',
  report_show: 'bg-amber-100 text-amber-700',
  free_visit: 'bg-emerald-100 text-emerald-700',
  discounted_visit: 'bg-lime-100 text-lime-700',
  emergency: 'bg-red-100 text-red-700',
  telemedicine: 'bg-purple-100 text-purple-700',
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'bg-slate-100 text-slate-700',
  checked_in: 'bg-blue-100 text-blue-700',
  waiting: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  paid: 'bg-green-100 text-green-700',
  no_show: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-red-100 text-red-700',
  pending_approval: 'bg-amber-100 text-amber-700',
};

function calcAge(dob?: string, patientAge?: number | string | null): string {
  const age = formatAgeFromDateOfBirth(dob);
  if (age !== '—') return age;
  if (patientAge !== undefined && patientAge !== null && String(patientAge).trim()) return `${patientAge}Y`;
  return '?';
}

function formatTime(t?: string): string {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function humanLabel(value?: string | null, fallback = 'Visit'): string {
  const normalized = String(value ?? '').toLowerCase();
  return normalized ? normalized.replace(/_/g, ' ') : fallback;
}

function billingTone(value?: string | null): string {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'paid') return 'bg-emerald-50 text-emerald-700';
  if (normalized === 'due_approved' || normalized === 'no_charge') return 'bg-sky-50 text-sky-700';
  if (normalized.includes('pending') || normalized.includes('unpaid') || normalized.includes('partial')) return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

function bpTone(systolic?: number | null, diastolic?: number | null): string {
  if (!systolic || !diastolic) return 'text-[var(--color-text)]';
  if (systolic >= 180 || diastolic >= 120) return 'text-red-600 font-bold';
  if (systolic >= 140 || diastolic >= 90) return 'text-red-500 font-semibold';
  if (systolic >= 130 || diastolic >= 80) return 'text-amber-600';
  if (systolic < 90 || diastolic < 60) return 'text-blue-500';
  return 'text-[var(--color-text)]';
}

function tempTone(temp?: number | null): string {
  if (!temp) return 'text-[var(--color-text)]';
  if (temp >= 39) return 'text-red-600 font-bold';
  if (temp >= 37.5) return 'text-amber-600';
  if (temp < 35) return 'text-blue-500';
  return 'text-[var(--color-text)]';
}

function spo2Tone(spo2?: number | null): string {
  if (!spo2) return 'text-[var(--color-text)]';
  if (spo2 < 90) return 'text-red-600 font-bold';
  if (spo2 < 94) return 'text-amber-600';
  return 'text-[var(--color-text)]';
}

const PRIORITY_BADGE: Record<string, string> = {
  red: 'bg-red-100 text-red-700 border-red-300',
  amber: 'bg-amber-100 text-amber-700 border-amber-300',
  blue: 'bg-blue-100 text-blue-700 border-blue-300',
  pink: 'bg-pink-100 text-pink-700 border-pink-300',
};

function statusLabel(value?: string | null): string {
  return String(value ?? 'waiting').replace(/_/g, ' ');
}

function hba1cColor(val?: string | null): string {
  if (!val) return '';
  const n = parseFloat(val);
  if (Number.isNaN(n)) return '';
  if (n < 7) return 'text-emerald-600';
  if (n <= 8) return 'text-amber-600';
  return 'text-red-600 font-semibold';
}

function lastVisitLabel(value?: string | null): string {
  if (!value) return 'No previous visit';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusFilterLabel(value: string): string {
  const labels: Record<string, string> = {
    all: 'All',
    waiting: 'Waiting',
    in_progress: 'In room',
    completed: 'Completed',
    priority: 'Priority',
    report_show: 'Report show',
    followup: 'Follow up',
    emergency: 'Emergency',
    no_show: 'No show',
    cancelled: 'Cancelled',
  };
  return labels[value] ?? value.replace(/_/g, ' ');
}

function visitTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    follow_up: 'Follow up',
    followup: 'Follow up',
    report_show: 'Report show',
  };
  return labels[value] ?? humanLabel(value);
}

function validityBadgeLabel(value?: QueueItem['validity_badge']): string | null {
  const labels: Record<NonNullable<QueueItem['validity_badge']>, string> = {
    valid_follow_up: 'Valid Follow-up',
    follow_up_expired: 'Follow-up Expired',
    valid_report_show: 'Valid Report Show',
    report_show_expired: 'Report Show Expired',
  };
  return value ? labels[value] ?? null : null;
}

export function QueueTable({
  queue,
  basePath,
  availableDoctors = [],
  onUpdateStatus,
  onOpenAiSummary,
  onOpenWorkspace,
  onReassign,
}: QueueTableProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const [search, setSearch] = useState('');
  const [visitFilter, setVisitFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedSnapshots, setExpandedSnapshots] = useState<Set<number>>(new Set());
  const [hoveredSnapshot, setHoveredSnapshot] = useState<number | null>(null);

  const visitTypes = useMemo(() => Array.from(new Set(queue.map(q => q.visit_type).filter(Boolean))), [queue]);
  const statusTabs = useMemo(() => {
    const values = new Set(queue.map(q => q.status).filter(Boolean));
    return ['all', 'waiting', 'in_progress', 'completed', 'priority', ...Array.from(values).filter(status => !['waiting', 'in_progress', 'completed'].includes(status))];
  }, [queue]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return queue.filter(q => {
      const status = String(q.status ?? '');
      if (statusFilter === 'priority') {
        if (!q.clinical_priority?.level || q.clinical_priority.level === 'normal') return false;
      } else if (statusFilter !== 'active' && statusFilter !== 'all' && status !== statusFilter) {
        return false;
      }
      if (visitFilter !== 'all' && q.visit_type !== visitFilter) return false;
      if (!term) return true;
      return (
        q.patient_name.toLowerCase().includes(term) ||
        q.patient_code.toLowerCase().includes(term) ||
        String(q.token_no).includes(term) ||
        String(q.patient_mobile ?? '').includes(term) ||
        q.visit_type.toLowerCase().includes(term)
      );
    });
  }, [queue, search, statusFilter, visitFilter]);

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--color-border)] space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-[var(--color-text)] flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--color-primary)]" />
            {t('todayQueue', { defaultValue: "Today's Queue" })}
          </h2>
          <Link to={`${basePath}/appointments`} className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1">
            {t('viewAll')}
          </Link>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1">
          {statusTabs.map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors ${
                statusFilter === status
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                  : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]'
              }`}
            >
              {statusFilterLabel(status)}
              <span className="ml-1 opacity-75">
                {status === 'all' ? queue.length : status === 'priority' ? queue.filter(item => item.clinical_priority?.level && item.clinical_priority.level !== 'normal').length : queue.filter(item => item.status === status).length}
              </span>
            </button>
          ))}
        </div>

        {visitTypes.length > 0 && (
          <div className="flex gap-1 overflow-x-auto pb-1">
            {['all', ...visitTypes].map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setVisitFilter(type)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors ${
                  visitFilter === type
                    ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                    : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text)]'
                }`}
              >
                {type === 'all' ? t('allVisitTypes', { defaultValue: 'All visit types' }) : visitTypeLabel(type)}
                <span className="ml-1 opacity-75">
                  {type === 'all' ? queue.length : queue.filter(item => item.visit_type === type).length}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('searchPatients', { defaultValue: 'Search patients...' })}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs pl-8 pr-8 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] w-full focus:outline-none focus:border-[var(--color-primary)]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="w-3 h-3 text-[var(--color-text-muted)]" />
              </button>
            )}
          </div>
          <select value={visitFilter} onChange={(e) => setVisitFilter(e.target.value)} className="input text-xs py-1.5 w-36">
            <option value="all">{t('allVisitTypes', { defaultValue: 'All visit types' })}</option>
            {visitTypes.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-muted)]">
          <CalendarCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>{t('noAppointments', { defaultValue: 'No appointments scheduled today' })}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-muted)]">
          <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p>{t('noResults', { defaultValue: 'No matching patients found' })}</p>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {filtered.map((q) => {
            // Queue rows may have either an appointment_id (preferred) or only a
            // queue row id. We must not silently substitute the queue id for the
            // appointment id — the wrong target would either 404 or, worse,
            // mutate a different patient's appointment. Surface a clear error
            // to the doctor instead.
            const apptId = q.appointment_id ?? null;
            const missingAppointmentId = apptId == null;
            const inRoom = q.status === 'in_progress';
            const isClosed = ['completed', 'cancelled', 'no_show'].includes(q.status);
            const highRisk = (q.allergy_count ?? 0) > 0 || Boolean(q.latest_abnormal_lab_summary);
            const isCriticalVitals = q.clinical_priority?.level === 'vitals_abnormal'
              || (q.vitals_bp_systolic != null && q.vitals_bp_diastolic != null && q.vitals_bp_systolic >= 180 && q.vitals_bp_diastolic >= 120)
              || (q.vitals_spo2 != null && q.vitals_spo2 < 90)
              || (q.vitals_temperature != null && q.vitals_temperature >= 40);
            const missingAppointmentMessage = t('missingAppointmentId', {
              defaultValue: 'Cannot update status: this queue entry has no appointment id. Re-create the appointment.',
            });
            const notifyMissingAppointment = () => toast.error(missingAppointmentMessage);
            const onUpdateStatusSafely = (status: string) => {
              if (missingAppointmentId || apptId == null) {
                notifyMissingAppointment();
                return;
              }
              onUpdateStatus(apptId, status);
            };
            return (
              <div
                key={q.id}
                className={`rounded-lg border p-4 transition-colors ${
                  isCriticalVitals
                    ? 'border-l-4 border-l-red-500 border-red-200 bg-red-50/40'
                    : inRoom
                      ? 'border-blue-200 bg-blue-50/70'
                      : highRisk
                        ? 'border-amber-200 bg-amber-50/40'
                        : 'border-[var(--color-border)] bg-[var(--color-bg)]'
                }`}
              >
                <div className="flex flex-col xl:flex-row xl:items-start gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-14 h-14 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold uppercase">Serial</span>
                      <span className="font-mono text-lg font-bold leading-none">{q.token_no}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-[var(--color-text)] truncate flex items-center gap-1.5">
                          {isCriticalVitals && (
                            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                            </span>
                          )}
                          {q.patient_name}
                        </h3>
                        {q.clinical_priority?.level && q.clinical_priority.level !== 'normal' && (
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${PRIORITY_BADGE[q.clinical_priority.color ?? ''] ?? 'bg-gray-100 text-gray-600 border-gray-300'} ${q.clinical_priority.level === 'vitals_abnormal' ? 'animate-pulse' : ''}`}
                          >
                            {q.clinical_priority.label ?? q.clinical_priority.level.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${STATUS_COLOR[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {statusLabel(q.status)}
                        </span>
                        {highRisk && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-semibold inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Alert
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-text-muted)] flex flex-wrap gap-x-2 gap-y-1">
                        <span>{calcAge(q.date_of_birth, q.patient_age)} {q.gender ?? ''}</span>
                        <span>{q.patient_code}</span>
                        {q.patient_mobile && <span>{q.patient_mobile}</span>}
                        {q.appt_time && <span>{formatTime(q.appt_time)}</span>}
                      </div>
                      {q.medical_snapshot && (() => {
                        const snap = q.medical_snapshot;
                        const isExpanded = hoveredSnapshot === q.patient_id || expandedSnapshots.has(q.patient_id);
                        const hasChronic = (snap.chronicConditions?.length ?? 0) > 0;
                        const allergyCount = snap.allergies?.length ?? 0;
                        const hasHba1c = !!snap.lastHbA1c;
                        const hasDx = !!snap.lastDiagnosis;
                        const hasMore = hasChronic || hasHba1c || hasDx;
                        return (
                          <div
                            className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-tight cursor-pointer select-none"
                            onMouseEnter={() => setHoveredSnapshot(q.patient_id)}
                            onMouseLeave={() => setHoveredSnapshot(null)}
                            onClick={() => {
                              setExpandedSnapshots(prev => {
                                const next = new Set(prev);
                                if (next.has(q.patient_id)) next.delete(q.patient_id);
                                else next.add(q.patient_id);
                                return next;
                              });
                            }}
                            title="Click to expand/collapse"
                          >
                            {snap.bloodGroup && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 font-semibold">
                                {snap.bloodGroup}
                              </span>
                            )}
                            {allergyCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-red-600 font-medium">
                                <AlertTriangle className="w-3 h-3" />
                                {allergyCount} {allergyCount === 1 ? 'allergy' : 'allergies'}
                              </span>
                            )}
                            {isExpanded && hasChronic && (
                              <span className="text-amber-700 font-medium">
                                {snap.chronicConditions!.join(', ')}
                              </span>
                            )}
                            {isExpanded && hasHba1c && (
                              <span className={`font-medium ${hba1cColor(snap.lastHbA1c)}`}>
                                HbA1c: {snap.lastHbA1c}
                              </span>
                            )}
                            {isExpanded && hasDx && (
                              <span className="text-[var(--color-text-muted)] italic truncate max-w-[180px]">
                                {snap.lastDiagnosis!.length > 30 ? snap.lastDiagnosis!.slice(0, 30) + '…' : snap.lastDiagnosis}
                              </span>
                            )}
                            {!isExpanded && hasMore && (
                              <span className="text-[var(--color-text-muted)] opacity-60">+more</span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="mt-3 grid sm:grid-cols-2 gap-2 text-xs">
                        <div className="rounded-md bg-[var(--color-surface)] px-3 py-2">
                          <div className="text-[var(--color-text-muted)]">Chief complaint</div>
                          <div className="font-medium text-[var(--color-text)] truncate">{q.chief_complaint || q.notes || 'Not recorded'}</div>
                        </div>
                        <div className="rounded-md bg-[var(--color-surface)] px-3 py-2">
                          <div className="text-[var(--color-text-muted)]">Vitals</div>
                          {q.latest_vitals_summary ? (
                            <div className="font-medium text-xs flex flex-wrap gap-x-1.5">
                              {(q.vitals_bp_systolic != null && q.vitals_bp_diastolic != null) && (
                                <span className={bpTone(q.vitals_bp_systolic, q.vitals_bp_diastolic)}>
                                  {q.vitals_bp_systolic}/{q.vitals_bp_diastolic}
                                </span>
                              )}
                              {q.vitals_pulse != null && <span className="text-[var(--color-text)]">P{q.vitals_pulse}</span>}
                              {q.vitals_temperature != null && (
                                <span className={tempTone(q.vitals_temperature)}>T{q.vitals_temperature}</span>
                              )}
                              {q.vitals_spo2 != null && (
                                <span className={spo2Tone(q.vitals_spo2)}>SpO2 {q.vitals_spo2}</span>
                              )}
                              {!q.vitals_bp_systolic && <span className="text-[var(--color-text)] truncate">{q.latest_vitals_summary}</span>}
                            </div>
                          ) : (
                            <div className="font-medium text-[var(--color-text-muted)]">Vitals not taken</div>
                          )}
                        </div>
                        <div className="rounded-md bg-[var(--color-surface)] px-3 py-2">
                          <div className="text-[var(--color-text-muted)]">Last visit</div>
                          <div className="font-medium text-[var(--color-text)] truncate">{lastVisitLabel(q.last_visit_at)}</div>
                        </div>
                        <div className="rounded-md bg-[var(--color-surface)] px-3 py-2">
                          <div className="text-[var(--color-text-muted)]">Last diagnosis</div>
                          <div className="font-medium text-[var(--color-text)] truncate">{q.last_diagnosis || 'No diagnosis recorded'}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${VISIT_COLOR[q.visit_type] ?? (q.appointment_type ? VISIT_COLOR[q.appointment_type] : undefined) ?? 'bg-gray-100 text-gray-600'}`}>
                          {q.appointment_type_label ?? humanLabel(q.appointment_type ?? q.visit_type)}
                        </span>
                        {(() => {
                          const validityLabel = validityBadgeLabel(q.validity_badge);
                          if (!validityLabel && !q.is_expired_report_show) return null;
                          return (
                            <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 font-medium" title={t('dashboard.expiredReportShowTooltip', { defaultValue: 'This visit has passed its configured validity window. Consider charging as a new visit.' })}>
                              {validityLabel ?? t('dashboard.expiredReportShow', { defaultValue: 'Visit window ended' })}
                            </span>
                          );
                        })()}
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${billingTone(q.billing_status)}`}>
                          <WalletCards className="w-3 h-3 inline mr-1" />
                          {q.billing_status_label ?? humanLabel(q.billing_status, 'Billing')}
                        </span>
                        {(q.allergy_count ?? 0) > 0 && <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700 font-medium"><Conical className="w-3 h-3 inline mr-1" />Allergy {q.allergy_count}</span>}
                        {(q.active_rx_count ?? 0) > 0 && <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 font-medium"><Activity className="w-3 h-3 inline mr-1" />Rx {q.active_rx_count}</span>}
                        {(q.pending_lab_count ?? 0) > 0 && <span className="text-xs px-2 py-1 rounded-full bg-purple-50 text-purple-700 font-medium"><Stethoscope className="w-3 h-3 inline mr-1" />Lab {q.pending_lab_count}</span>}
                        {q.created_by_name && <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">By {q.created_by_name}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="xl:w-56 flex xl:flex-col gap-2">
                    {onOpenWorkspace && (
                      <button
                        type="button"
                        onClick={() => {
                          if (missingAppointmentId) {
                            notifyMissingAppointment();
                            return;
                          }
                          onOpenWorkspace(q);
                        }}
                        className="btn-primary text-xs flex-1 xl:flex-none justify-center"
                        title={missingAppointmentId ? missingAppointmentMessage : undefined}
                      >
                        <Play className="w-3.5 h-3.5" />
                        {isClosed ? 'Review Visit' : 'Start Consultation'}
                      </button>
                    )}
                    <div className="grid grid-cols-3 xl:grid-cols-2 gap-2 flex-1 xl:flex-none">
                      <Link to={`${basePath}/patients/${q.patient_id}/overview`} className="btn-ghost text-xs justify-center" title="History">
                        <UserRound className="w-3.5 h-3.5" />
                      </Link>
                      {missingAppointmentId ? (
                        <button
                          type="button"
                          disabled
                          className="btn-ghost text-xs justify-center text-emerald-700 opacity-40"
                          title={missingAppointmentMessage}
                          aria-label="Create prescription unavailable"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <Link
                          to={`${basePath}/prescriptions/new?patient=${q.patient_id}&appt=${apptId}&from=doctor/dashboard`}
                          className="btn-ghost text-xs justify-center text-emerald-700"
                          title="Rx"
                          aria-label="Create prescription"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </Link>
                      )}
                      {q.status === 'waiting' ? (
                        <button onClick={() => onUpdateStatusSafely('in_progress')} disabled={missingAppointmentId} className="btn-ghost text-xs justify-center text-blue-700 disabled:opacity-40" title={missingAppointmentId ? 'No appointment id' : 'Call'}>
                          <PhoneCall className="w-3.5 h-3.5" />
                        </button>
                      ) : q.status === 'in_progress' ? (
                        <button onClick={() => onUpdateStatusSafely('waiting')} disabled={missingAppointmentId} className="btn-ghost text-xs justify-center text-amber-700 disabled:opacity-40" title={missingAppointmentId ? 'No appointment id' : 'Hold'}>
                          <PauseCircle className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button disabled className="btn-ghost text-xs justify-center opacity-50" title="Closed">
                          <Clock className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {q.status === 'in_progress' && onOpenWorkspace && (
                        <button onClick={() => onOpenWorkspace(q)} className="btn-ghost text-xs justify-center text-emerald-700" title="Complete from consultation workspace">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!isClosed && q.status !== 'no_show' && (
                        <button
                          onClick={() => {
                            if (window.confirm(t('dashboard.confirmNoShow', { defaultValue: 'Mark this patient as no-show? This will free their slot.' }))) {
                              onUpdateStatusSafely('no_show');
                            }
                          }}
                          disabled={missingAppointmentId}
                          className="btn-ghost text-xs justify-center text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                          title={missingAppointmentId ? 'No appointment id' : t('dashboard.markNoShow', { defaultValue: 'No-show' })}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => onOpenAiSummary(q.patient_id)} className="btn-ghost text-xs justify-center text-purple-700" title={t('aiSummary', { defaultValue: 'AI Clinical Overview' })}>
                        <Brain className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {onReassign && availableDoctors.length > 0 && !isClosed && (
                      <select
                        className="input text-xs py-1.5 w-full"
                        defaultValue=""
                        disabled={missingAppointmentId}
                        title={missingAppointmentId ? missingAppointmentMessage : undefined}
                        onChange={(event) => {
                          const nextDoctorId = Number(event.target.value);
                          if (missingAppointmentId || apptId == null) {
                            notifyMissingAppointment();
                            event.currentTarget.value = '';
                            return;
                          }
                          if (nextDoctorId) onReassign(apptId, nextDoctorId);
                          event.currentTarget.value = '';
                        }}
                      >
                        <option value="">Reassign</option>
                        {availableDoctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { AlertTriangle, Bed, Brain, Calendar, CheckCircle2, Clock, FileText, FlaskConical, PhoneCall, RotateCw, Stethoscope, Timer, Users, X, Zap, CircleDashed, NotebookPen } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6, getNowGMT6 } from '../lib/date-utils';
import DashboardLayout from '../components/DashboardLayout';
import { formatDoctorName } from '../lib/doctor-display';
import { PatientAIWidget } from '../components/doctor/PatientAIWidget';
import { QueueTable } from '../components/doctor/QueueTable';
import { RightPanel } from '../components/doctor/RightPanel';
import { ScheduleTimeline } from '../components/doctor/ScheduleTimeline';
import { DoctorWorkspaceDrawer } from '../components/doctor/DoctorWorkspaceDrawer';
import { DoctorPresenceCard } from '../components/doctor/DoctorPresenceCard';
import type { DashData, Inpatient, QueueItem } from '../components/doctor/types';

const CLOSED_QUEUE_STATUSES = new Set(['completed', 'cancelled', 'no_show']);

function countQueue(queue: QueueItem[], predicate: (item: QueueItem) => boolean): number {
  return queue.filter(predicate).length;
}

function isOpenQueueItem(item: QueueItem): boolean {
  return !CLOSED_QUEUE_STATUSES.has(item.status);
}

function getQueueAppointmentId(item: QueueItem | null | undefined): number | null {
  return item?.appointment_id ?? null;
}

export default function DoctorDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const { t } = useTranslation(['dashboard', 'common']);
  const queryClient = useQueryClient();

  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => getTodayGMT6());
  const [workspaceItem, setWorkspaceItem] = useState<QueueItem | null>(null);

  const openAiSummary = useCallback((patientId: number) => {
    setSelectedPatientId(patientId);
    setShowAiModal(true);
  }, []);

  const closeAiModal = useCallback(() => {
    setSelectedPatientId(null);
    setShowAiModal(false);
  }, []);

  const queryPath = selectedDate
    ? `/api/doctors/dashboard?date=${selectedDate}`
    : '/api/doctors/dashboard';

  const { data, isLoading, isError } = useApiQuery<DashData>(
    [...queryKeys.doctors.dashboard(), selectedDate],
    queryPath,
    { refetchInterval: 30000 },
  );

  const ipdRoundsQuery = useApiQuery<{
    date: string;
    summary: { total_inpatients: number; not_rounded_today: number; pending_clinical_note: number; deteriorating: number; critical: number };
    inpatients: Inpatient[];
  }>(
    queryKeys.doctors.ipdRounds(selectedDate),
    `/api/doctors/dashboard/ipd-rounds?date=${selectedDate}`,
    { refetchInterval: 30000 },
  );
  const ipdRoundsSummary = ipdRoundsQuery.data?.summary;
  const ipdRoundsList = ipdRoundsQuery.data?.inpatients ?? [];

  const statusMutation = useApiMutation<unknown, { apptId: number; status: string }>(
    'put',
    (vars) => `/api/doctors/dashboard/appointments/${vars.apptId}/status`,
    {
      onSuccess: () => {
        toast.success(t('dashboard.status_updated'));
        queryClient.invalidateQueries({ queryKey: [...queryKeys.doctors.dashboard(), selectedDate] });
      },
      onError: () => {
        toast.error(t('dashboard.failed_to_update_status'));
      },
    },
  );

  const updateStatus = useCallback((apptId: number, newStatus: string) => {
    statusMutation.mutate({ apptId, status: newStatus });
  }, [statusMutation]);

  const reassignMutation = useApiMutation<unknown, { apptId: number; doctorId: number; reason?: string }>(
    'put',
    (vars) => `/api/doctors/dashboard/appointments/${vars.apptId}/reassign`,
    {
      onSuccess: () => {
        toast.success(t('dashboard.reassigned', { defaultValue: 'Appointment reassigned' }));
        setWorkspaceItem(null);
        queryClient.invalidateQueries({ queryKey: [...queryKeys.doctors.dashboard(), selectedDate] });
      },
      onError: () => toast.error(t('dashboard.reassign_failed', { defaultValue: 'Failed to reassign appointment' })),
    },
  );

  const reassignAppointment = useCallback((apptId: number, doctorId: number, reason?: string) => {
    reassignMutation.mutate({ apptId, doctorId, reason });
  }, [reassignMutation]);

  const hour = getNowGMT6().getUTCHours();
  const greeting = hour < 12 ? t('goodMorning', { defaultValue: 'Good Morning' }) : hour < 17 ? t('goodAfternoon', { defaultValue: 'Good Afternoon' }) : t('goodEvening', { defaultValue: 'Good Evening' });

  const todayLabel = new Date().toLocaleDateString('en-BD', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const isToday = selectedDate === getTodayGMT6();

  if (isLoading) {
    return (
      <DashboardLayout role="doctor">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[var(--color-text-muted)]">Loading your dashboard…</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !data) {
    return (
      <DashboardLayout role="doctor">
        <div className="flex items-center justify-center h-64">
          <div className="text-center text-[var(--color-text-muted)]">
            <Stethoscope className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>Doctor profile not linked to this account.</p>
            <p className="text-sm mt-1">Please contact admin to link your doctor profile.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const { doctor, kpi, queue = [], visitTypes = [], recentRx = [], followUps = [], availableDoctors = [], pendingOrders = [], inpatients = [], labInbox } = data;

  const criticalPatients = queue.filter((item) => {
    if (item.clinical_priority?.level === 'vitals_abnormal') return true;
    const sys = item.vitals_bp_systolic;
    const dia = item.vitals_bp_diastolic;
    if ((sys != null && sys >= 180) || (dia != null && dia >= 120)) return true;
    if (item.vitals_spo2 != null && item.vitals_spo2 < 90) return true;
    if (item.vitals_temperature != null && item.vitals_temperature >= 40) return true;
    return false;
  });

  const waitingCount = kpi.waiting;
  const inRoomCount = kpi.in_progress;
  const completedCount = kpi.completed;
  const reportShowCount = countQueue(queue, item => (item.appointment_type ?? item.visit_type) === 'report_show');
  const followUpCount = countQueue(queue, item => ['follow_up', 'followup'].includes(String(item.appointment_type ?? item.visit_type)));
  const emergencyCount = countQueue(queue, item => String(item.appointment_type ?? item.visit_type).includes('emergency') || item.queue_priority === 'emergency');
  const nextPatient = queue.find(isOpenQueueItem) ?? null;
  const nextPatientApptId = getQueueAppointmentId(nextPatient);

  return (
    <DashboardLayout role="doctor">
      <div className="max-w-8xl mx-auto space-y-4">
        <div className="card overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[var(--color-border)]">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)]">
                    {greeting}, {formatDoctorName(doctor.name, t('doctor.doctorPrefix', 'Dr.'))}
                  </h1>
                  <span className="bg-green-100 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    {t('onDuty')}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap text-sm text-[var(--color-text-muted)]">
                  <span>{doctor.department ?? doctor.specialty ?? 'Department'}</span>
                  <span>{todayLabel}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 bg-[var(--color-surface)] rounded-lg px-3 py-2">
                  <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="text-sm bg-transparent border-none text-[var(--color-text)] focus:outline-none cursor-pointer"
                  />
                </div>
                {!isToday && (
                  <button onClick={() => setSelectedDate(getTodayGMT6())} className="btn-ghost text-xs">
                    Today
                  </button>
                )}
                <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                  <RotateCw className="w-3.5 h-3.5" />
                  30s
                </span>
              </div>
            </div>

            <div className="mt-5">
              <DoctorPresenceCard />
            </div>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-8 gap-2">
              {[
                { label: 'Waiting', value: waitingCount, icon: Clock, tone: 'bg-amber-50 text-amber-700', primary: true },
                { label: 'In room', value: inRoomCount, icon: Users, tone: 'bg-blue-50 text-blue-700', primary: true },
                { label: 'Completed', value: completedCount, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700', primary: false },
                { label: 'Report show', value: reportShowCount, icon: FileText, tone: 'bg-indigo-50 text-indigo-700', primary: false },
                { label: 'Follow up', value: followUpCount, icon: RotateCw, tone: 'bg-sky-50 text-sky-700', primary: false },
                { label: 'Emergency', value: emergencyCount, icon: AlertTriangle, tone: 'bg-red-50 text-red-700', primary: true },
                { label: 'Avg time', value: kpi.avg_consult_time_min != null ? `${kpi.avg_consult_time_min}m` : '—', icon: Timer, tone: 'bg-violet-50 text-violet-700', primary: false },
                { label: 'Total', value: kpi.total, icon: Stethoscope, tone: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]', primary: true },
              ]
                .map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 flex items-center gap-2 min-w-0"
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${item.tone}`}>
                      <item.icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-lg font-bold leading-tight text-[var(--color-text)]">{item.value}</span>
                      <span className="block text-[11px] text-[var(--color-text-muted)] truncate">{item.label}</span>
                    </span>
                  </div>
                ))}
            </div>
          </div>

          <div className="px-4 py-3 bg-[var(--color-bg)] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Zap className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" />
              <div className="text-sm min-w-0">
                <span className="font-semibold text-[var(--color-text)]">{t('doctorDashboard.next', { defaultValue: 'Next: ' })}</span>
                <span className="text-[var(--color-text)]">{nextPatient ? `${nextPatient.token_no}. ${nextPatient.patient_name}` : t('doctorDashboard.noPatientInQueue', { defaultValue: 'No patient in queue' })}</span>
                {nextPatient?.chief_complaint && <span className="text-[var(--color-text-muted)]"> · {nextPatient.chief_complaint}</span>}
              </div>
              {nextPatient && isOpenQueueItem(nextPatient) && (
                <button
                  onClick={() => {
                    if (!nextPatient) return;
                    if (!nextPatientApptId) {
                      toast.error(t('dashboard.missingAppointmentId', {
                        defaultValue: 'Cannot open consultation: appointment id is missing. Please ask reception to refresh or recreate this queue entry.',
                      }));
                      return;
                    }
                    if (nextPatient.status === 'waiting') {
                      updateStatus(nextPatientApptId, 'in_progress');
                    }
                    setWorkspaceItem(nextPatient);
                  }}
                  className="btn-primary text-xs"
                  title={t('dashboard.callNextPatient', { defaultValue: 'Call next patient and open consultation' })}
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  {t('dashboard.callNext', { defaultValue: 'Call Next' })}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link to={inpatients[0] ? `${basePath}/doctor/ipd/${inpatients[0].id}` : `${basePath}/patients`} className="btn-ghost text-xs">
                <Bed className="w-3.5 h-3.5" />
                {t('doctorDashboard.ipd', { defaultValue: 'IPD' })}
              </Link>
              <Link to={`${basePath}/doctor/report-review`} className="btn-ghost text-xs">
                <FlaskConical className="w-3.5 h-3.5" />
                {t('doctorDashboard.reportReview', { defaultValue: 'Report Review' })}
              </Link>
              <Link to={`${basePath}/doctor-schedule`} className="btn-ghost text-xs">
                <Clock className="w-3.5 h-3.5" />
                {t('doctorDashboard.schedule', { defaultValue: 'Schedule' })}
              </Link>
              {nextPatient && nextPatientApptId ? (
                <Link to={`${basePath}/prescriptions/new?patient=${nextPatient.patient_id}&appt=${nextPatientApptId}&from=doctor/dashboard`} className="btn-primary text-xs">
                  <FileText className="w-3.5 h-3.5" />
                  {t('doctorDashboard.fastRx', { defaultValue: 'Fast Rx' })}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="btn-primary text-xs opacity-50"
                  title={nextPatient
                    ? t('dashboard.missingAppointmentId', { defaultValue: 'Appointment id missing for this queue entry' })
                    : t('doctorDashboard.noPatientInQueue', { defaultValue: 'No patient in queue' })}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {t('doctorDashboard.fastRx', { defaultValue: 'Fast Rx' })}
                </button>
              )}
            </div>
          </div>
          {(labInbox?.needs_review ?? 0) > 0 || (labInbox?.critical ?? 0) > 0 ? (
            <div className="px-4 py-3 border-t border-amber-200 bg-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <FlaskConical className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <span className="font-semibold">{t('doctorDashboard.resultsInbox', { defaultValue: 'Results inbox: ' })}</span>
                  {(labInbox?.critical ?? 0) > 0 && <span>{t('doctorDashboard.criticalCount', { count: labInbox?.critical ?? 0, defaultValue: `${labInbox?.critical} critical` })}</span>}
                  {(labInbox?.critical ?? 0) > 0 && (labInbox?.needs_review ?? 0) > 0 && <span> · </span>}
                  {(labInbox?.needs_review ?? 0) > 0 && <span>{t('doctorDashboard.needReviewCount', { count: labInbox?.needs_review ?? 0, defaultValue: `${labInbox?.needs_review} need review` })}</span>}
                </div>
              </div>
              <Link
                to={`${basePath}/doctor/lab-results?tab=needs_review`}
                className="btn-primary text-xs self-start sm:self-auto"
              >
                {t('doctorDashboard.openResultsInbox', { defaultValue: 'Open Results Inbox' })}
              </Link>
            </div>
          ) : null}

          <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-2">
            <Link to={`${basePath}/doctor/lab-results`} className="btn-ghost text-xs">
              <FlaskConical className="w-3.5 h-3.5" />
              {t('doctorDashboard.labResults', { defaultValue: 'Lab Results' })}
            </Link>
            <Link to={`${basePath}/order-sets`} className="btn-ghost text-xs">{t('doctorDashboard.orderSets', { defaultValue: 'Order sets' })}</Link>
            <Link to={`${basePath}/dictation`} className="btn-ghost text-xs">{t('doctorDashboard.dictation', { defaultValue: 'Dictation' })}</Link>
            <Link to={`${basePath}/doctor/referrals/new`} className="btn-ghost text-xs">{t('doctorDashboard.referral', { defaultValue: 'Referral' })}</Link>
            <Link to={`${basePath}/doctor/certificates`} className="btn-ghost text-xs">{t('doctorDashboard.certificates', { defaultValue: 'Certificates' })}</Link>
          </div>
        </div>

        {criticalPatients.length > 0 && (
          <div className="space-y-2">
            {criticalPatients.map((item) => {
              const reasons: string[] = [];
              if ((item.vitals_bp_systolic != null && item.vitals_bp_systolic >= 180) || (item.vitals_bp_diastolic != null && item.vitals_bp_diastolic >= 120)) {
                reasons.push(`BP ${item.vitals_bp_systolic}/${item.vitals_bp_diastolic}`);
              }
              if (item.vitals_spo2 != null && item.vitals_spo2 < 90) {
                reasons.push(`SpO2 ${item.vitals_spo2}%`);
              }
              if (item.vitals_temperature != null && item.vitals_temperature >= 40) {
                reasons.push(`Temp ${item.vitals_temperature}°C`);
              }
              if (item.clinical_priority?.reason) {
                reasons.push(item.clinical_priority.reason);
              }
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-red-800">{item.patient_name}</span>
                      <span className="text-xs text-red-600 ml-2">#{item.token_no}</span>
                      {reasons.length > 0 && (
                        <span className="text-xs text-red-700 ml-2">— {reasons.join(', ')}</span>
                      )}
                    </div>
                  </div>
                  {item.appointment_id ? (
                    <Link
                      to={`${basePath}/doctor/opd/${item.patient_id}/${item.appointment_id}`}
                      className="text-xs font-semibold text-red-700 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors"
                    >
                      {t('doctorDashboard.startConsultation', { defaultValue: 'Start Consultation' })}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="text-xs font-semibold text-red-700 bg-red-100 px-3 py-1.5 rounded-lg flex-shrink-0 opacity-50"
                      title={t('dashboard.missingAppointmentId', { defaultValue: 'Appointment id missing for this queue entry' })}
                    >
                      {t('doctorDashboard.startConsultation', { defaultValue: 'Start Consultation' })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="grid xl:grid-cols-12 gap-4">
          <div className="xl:col-span-8">
            <QueueTable
              queue={queue}
              basePath={basePath}
              onUpdateStatus={updateStatus}
              onOpenAiSummary={openAiSummary}
              onOpenWorkspace={setWorkspaceItem}
              availableDoctors={availableDoctors}
              onReassign={reassignAppointment}
            />
          </div>

          <div className="xl:col-span-4">
            <RightPanel
              visitTypes={visitTypes}
              recentRx={recentRx}
              followUps={followUps}
              pendingOrders={pendingOrders}
              inpatients={inpatients}
              basePath={basePath}
            />
          </div>
        </div>

        <ScheduleTimeline queue={queue} />

        <div className="card p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-[var(--color-text)] flex items-center gap-2">
                <Bed className="w-4 h-4 text-[var(--color-primary)]" />
                {t('doctorDashboard.ipdRoundsTitle', { defaultValue: 'IPD Ward Rounds' })}
              </h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {t('doctorDashboard.ipdRoundsSubtitle', {
                  defaultValue: "Today's inpatients, round status, and pending clinical notes",
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)]">
                {t('doctorDashboard.ipdTotal', { defaultValue: 'Total' })}: <strong>{ipdRoundsSummary?.total_inpatients ?? ipdRoundsList.length}</strong>
              </span>
              <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1">
                <CircleDashed className="w-3 h-3" />
                {t('doctorDashboard.ipdUnrounded', { defaultValue: 'Not rounded' })}: <strong>{ipdRoundsSummary?.not_rounded_today ?? 0}</strong>
              </span>
              <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 inline-flex items-center gap-1">
                <NotebookPen className="w-3 h-3" />
                {t('doctorDashboard.ipdPendingNote', { defaultValue: 'Note pending' })}: <strong>{ipdRoundsSummary?.pending_clinical_note ?? 0}</strong>
              </span>
              {((ipdRoundsSummary?.critical ?? 0) + (ipdRoundsSummary?.deteriorating ?? 0)) > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {t('doctorDashboard.ipdCritical', { defaultValue: 'Critical/Deteriorating' })}: <strong>{(ipdRoundsSummary?.critical ?? 0) + (ipdRoundsSummary?.deteriorating ?? 0)}</strong>
                </span>
              )}
            </div>
          </div>
          {ipdRoundsList.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-6">
              {t('doctorDashboard.noIpdAssigned', { defaultValue: 'No active inpatients assigned to you.' })}
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {ipdRoundsList.map((p) => {
                const admissionId = p.admission_id ?? p.id;
                const condition = (p.last_patient_condition ?? '').toString();
                const isCritical = condition === 'critical';
                const isDeteriorating = condition === 'deteriorating';
                const needsNote = p.needs_round_note ?? false;
                const statusLabel = needsNote
                  ? (p.today_round_id
                    ? t('round.notePending', { defaultValue: 'Note pending' })
                    : t('round.notRounded', { defaultValue: 'Not rounded' }))
                  : t('round.roundedToday', { defaultValue: 'Rounded today' });
                const statusTone = needsNote
                  ? isCritical || isDeteriorating
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700';
                const StatusIcon = needsNote ? (isCritical || isDeteriorating ? AlertTriangle : CircleDashed) : CheckCircle2;
                return (
                  <div key={admissionId} className="border border-[var(--color-border)] rounded-lg p-3 flex flex-col gap-2 bg-[var(--color-bg)]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate text-[var(--color-text)]">{p.patient_name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {p.admission_no} · {p.bed_number ?? p.ward ?? '—'}
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusTone}`}>
                        <StatusIcon className="w-3 h-3" />
                        {statusLabel}
                      </span>
                    </div>
                    {p.diagnosis && (
                      <p className="text-xs text-[var(--color-text-muted)] line-clamp-2">{p.diagnosis}</p>
                    )}
                    {p.latest_vitals_summary && (
                      <p className="text-[11px] text-[var(--color-text-muted)]">Vitals: {p.latest_vitals_summary}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {isCritical && (
                        <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                          {t('round.critical', { defaultValue: 'Critical' })}
                        </span>
                      )}
                      {isDeteriorating && (
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                          {t('round.deteriorating', { defaultValue: 'Deteriorating' })}
                        </span>
                      )}
                      {p.today_round_clinical_status === 'signed' && !needsNote && (
                        <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium inline-flex items-center gap-1">
                          <NotebookPen className="w-3 h-3" />
                          {t('round.signed', { defaultValue: 'Note signed' })}
                        </span>
                      )}
                    </div>
                    <Link
                      to={`${basePath}/doctor/ipd/${admissionId}?tab=round`}
                      className="btn-primary text-xs self-start"
                    >
                      {needsNote ? t('round.openRound', { defaultValue: 'Round' }) : t('round.viewNote', { defaultValue: 'View note' })}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* AI Summary Modal */}
      {showAiModal && selectedPatientId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-bg)] rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
              <h3 className="font-semibold text-[var(--color-text)] flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-600" />
                {t('aiSummary', { defaultValue: 'AI Clinical Overview' })}
              </h3>
              <button onClick={closeAiModal} className="btn-ghost p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <PatientAIWidget patientId={selectedPatientId} tenantHasAi={true} />
            </div>
          </div>
        </div>
      )}

      {workspaceItem && (
        <DoctorWorkspaceDrawer
          item={workspaceItem}
          basePath={basePath}
          currentDoctor={doctor}
          availableDoctors={availableDoctors}
          onClose={() => setWorkspaceItem(null)}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: [...queryKeys.doctors.dashboard(), selectedDate] })}
          onComplete={() => {
            queryClient.invalidateQueries({ queryKey: [...queryKeys.doctors.dashboard(), selectedDate] }).then(() => {
              queryClient.refetchQueries({ queryKey: [...queryKeys.doctors.dashboard(), selectedDate] }).then(() => {
                const freshData = queryClient.getQueryData<DashData>([...queryKeys.doctors.dashboard(), selectedDate]);
                if (freshData?.queue) {
                  const next = freshData.queue.find((q) => isOpenQueueItem(q) && q.appointment_id != null);
                  if (next) setWorkspaceItem(next);
                  else setWorkspaceItem(null);
                }
              });
            });
          }}
          onUpdateStatus={updateStatus}
          onReassign={reassignAppointment}
        />
      )}
    </DashboardLayout>
  );
}

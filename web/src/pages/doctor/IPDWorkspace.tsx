import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router';
import { Bed, Calendar, User, Stethoscope, FileText, ClipboardCheck, Heart, Pill, FlaskConical, CheckCircle, Clock, ChevronRight, Activity, NotebookPen, AlertTriangle, CircleDollarSign } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTimeGMT6 } from '../../lib/date-utils';
import VitalsTrend from '../../components/VitalsTrend';
import MedicationReconciliationPanel from '../../components/doctor/MedicationReconciliationPanel';
import IPDMedicationOrderComposer from '../../components/doctor/IPDMedicationOrderComposer';

/* ─── Types ───────────────────────────────────────────────────────────────── */

interface Admission {
  id: number;
  admission_no: string;
  patient_id: number;
  patient_name: string;
  patient_code?: string;
  age?: number;
  gender?: string;
  bed_number?: string;
  ward_name?: string;
  admission_date: string;
  diagnosis?: string;
  provisional_diagnosis?: string;
  admitting_doctor?: string;
  doctor_name?: string;
  doctor_id?: number;
  ipd_visit_id?: number | null;
  status: string;
}

interface ClinicalNote {
  id: number;
  note_type: string;
  title?: string;
  content: string;
  doctor_name?: string;
  created_at: string;
  is_signed?: number;
}

interface VitalRecord {
  id: number;
  systolic?: number;
  diastolic?: number;
  heart_rate?: number;
  temperature?: number;
  spo2?: number;
  respiratory_rate?: number;
  recorded_at: string;
}

interface Medication {
  id: number;
  medication_name: string;
  dosage: string;
  frequency: string;
  route?: string;
  start_date: string;
  end_date?: string;
  status: string;
}

interface PendingOrder {
  id: number;
  order_type: string;
  item_name: string;
  status: string;
  ordered_at: string;
}

interface DischargePlan {
  id: number;
  status: string;
  planned_discharge_date?: string;
  discharge_type?: string;
  checklist_progress?: { done: number; total: number; percent: number };
  checklist?: Record<string, boolean>;
}

interface RoundRecord {
  id: number;
  admission_id: number;
  patient_id: number;
  doctor_id: number;
  doctor_name_snapshot: string;
  rounded_at: string;
  round_fee_snapshot: number;
  entry_source: string;
  entered_by_name?: string | null;
  bill_status?: string | null;
  clinical_note_id?: number | null;
  clinical_status?: string | null;
  clinical_note_title?: string | null;
  clinical_note_signed?: number | null;
  round_summary?: string | null;
  patient_condition?: string | null;
  signed_at?: string | null;
}

interface AdmissionResponse {
  admission: Admission;
  pendingOrders?: PendingOrder[];
}

function displayTemperatureF(temperature: number): string {
  const fahrenheit = temperature <= 45 ? (temperature * 9) / 5 + 32 : temperature;
  return `${fahrenheit.toFixed(1)} °F`;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const DISCHARGE_CHECKLIST_ITEMS: Record<string, string> = {
  vitals_stable: 'Vitals Stable',
  medications_reconciled: 'Medications Reconciled',
  prescriptions_printed: 'Prescriptions Printed',
  lab_results_reviewed: 'Lab Results Reviewed',
  pending_tests_cleared: 'Pending Tests Cleared',
  diet_instructions_given: 'Diet Instructions Given',
  wound_care_instructions: 'Wound Care Instructions',
  follow_up_scheduled: 'Follow-up Scheduled',
  referrals_arranged: 'Referrals Arranged',
  insurance_clearance: 'Insurance Clearance',
  billing_cleared: 'Billing Cleared',
  transport_arranged: 'Transport Arranged',
  patient_education_done: 'Patient Education Done',
  consent_forms_signed: 'Consent Forms Signed',
};

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function IPDWorkspace({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('ipd');
  const { slug = '', admissionId = '' } = useParams<{ slug: string; admissionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'round' ? 'round' : 'notes';
  const [activeTab, setActiveTab] = useState<'notes' | 'round'>(initialTab);
  const queryClient = useQueryClient();
  const basePath = `/h/${slug}`;

  const [noteContent, setNoteContent] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [patientCondition, setPatientCondition] = useState('');

  // Round Note form state
  const [roundCondition, setRoundCondition] = useState<'improving' | 'stable' | 'deteriorating' | 'critical'>('stable');
  const [roundSubjective, setRoundSubjective] = useState('');
  const [roundObjective, setRoundObjective] = useState('');
  const [roundAssessment, setRoundAssessment] = useState('');
  const [roundPlan, setRoundPlan] = useState('');
  const [roundSummary, setRoundSummary] = useState('');
  const [roundCreateBilling, setRoundCreateBilling] = useState(false);
  const [roundDate, setRoundDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [roundTime, setRoundTime] = useState(() => new Date().toTimeString().slice(0, 5));

  useEffect(() => {
    const tab = searchParams.get('tab') === 'round' ? 'round' : 'notes';
    setActiveTab(tab);
  }, [searchParams]);

  const switchTab = (tab: 'notes' | 'round') => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'round') next.set('tab', 'round');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  /* ── Data Fetching ─────────────────────────────────────────────────────── */

  const admissionQuery = useApiQuery<AdmissionResponse>(
    ['admissions', 'detail', admissionId],
    `/api/admissions/${admissionId}/detail`,
    { enabled: !!admissionId },
  );
  const admission = admissionQuery.data?.admission;
  const pendingOrders = admissionQuery.data?.pendingOrders ?? [];
  const patientId = admission?.patient_id;

  const notesQuery = useApiQuery<{ notes: ClinicalNote[] }>(
    queryKeys.patientChart.detail(String(patientId ?? ''), false),
    `/api/clinical/notes?patientId=${patientId}&noteType=progress`,
    { enabled: !!patientId },
  );
  const notes = notesQuery.data?.notes ?? [];

  const vitalsQuery = useApiQuery<{ vitals: VitalRecord[] }>(
    queryKeys.vitals.list(String(patientId ?? '')),
    `/api/clinical/vitals?patientId=${patientId}&limit=7`,
    { enabled: !!patientId },
  );
  const vitals = vitalsQuery.data?.vitals ?? [];

  const medsQuery = useApiQuery<{ medications: Medication[] }>(
    queryKeys.prescriptions.list({ patientId, status: 'active' }),
    `/api/clinical/medications?patientId=${patientId}&status=active`,
    { enabled: !!patientId },
  );
  const medications = medsQuery.data?.medications ?? [];

  const dischargeQuery = useApiQuery<{ data: DischargePlan }>(
    queryKeys.dischargePlanning.detail(Number(admissionId)),
    `/api/discharge-planning/admission/${admissionId}`,
    { enabled: !!admissionId },
  );
  const dischargePlan = dischargeQuery.data?.data;

  const roundsQuery = useApiQuery<{ rounds: RoundRecord[] }>(
    queryKeys.ipdDoctorRounds.list(Number(admissionId)),
    `/api/ipd-doctor-rounds?admission_id=${admissionId}`,
    { enabled: !!admissionId && role === 'doctor' },
  );
  const rounds = roundsQuery.data?.rounds ?? [];

  const roundFeeQuery = useApiQuery<{ fee: number; configured: boolean }>(
    [...queryKeys.doctors.detail(Number(admission?.doctor_id ?? 0))],
    admission?.doctor_id
      ? `/api/doctors/${admission.doctor_id}/ipd-round-fee`
      : '/api/doctors/0/ipd-round-fee',
    { enabled: !!admission?.doctor_id },
  );
  const roundFeeConfigured = roundFeeQuery.data?.configured ?? false;
  const roundFeeAmount = roundFeeQuery.data?.fee ?? 0;

  /* ── Mutations ─────────────────────────────────────────────────────────── */

  const createNoteMutation = useApiMutation<{ note: ClinicalNote }, { patientId: number; noteType: string; title: string; content: string }>(
    'post',
    '/api/clinical/notes',
    {
      onSuccess: () => {
        toast.success(t('ipd.noteCreated', { defaultValue: 'Progress note saved' }));
        setNoteContent('');
        setNoteTitle('');
        queryClient.invalidateQueries({ queryKey: queryKeys.patientChart.detail(String(patientId ?? ''), false) });
      },
      onError: () => toast.error(t('ipd.noteCreateFailed', { defaultValue: 'Failed to save note' })),
    },
  );

  const roundMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/ipd-doctor-rounds/clinical',
    {
      onSuccess: () => {
        toast.success(t('ipd.roundSigned', { defaultValue: 'Round note signed' }));
        setRoundSubjective('');
        setRoundObjective('');
        setRoundAssessment('');
        setRoundPlan('');
        setRoundSummary('');
        queryClient.invalidateQueries({ queryKey: queryKeys.ipdDoctorRounds.list(Number(admissionId)) });
        queryClient.invalidateQueries({ queryKey: queryKeys.doctors.dashboard() });
        queryClient.invalidateQueries({ queryKey: queryKeys.doctors.ipdRounds() });
        queryClient.invalidateQueries({ queryKey: queryKeys.patientChart.detail(String(patientId ?? ''), false) });
      },
      onError: (err: Error | unknown) => {
        const message = (err as { data?: { message?: string } })?.data?.message
          || (err as { message?: string })?.message
          || t('ipd.roundSignFailed', { defaultValue: 'Failed to sign round note' });
        toast.error(message);
      },
    },
  );

  /* ── Handlers ──────────────────────────────────────────────────────────── */

  const handleCreateNote = () => {
    if (!noteContent.trim() || !patientId) return;
    const conditionPrefix = patientCondition ? `[${patientCondition}] ` : '';
    createNoteMutation.mutate({
      patientId,
      noteType: 'progress',
      title: noteTitle.trim() || 'Progress Note',
      content: conditionPrefix + noteContent.trim(),
    }, {
      onSuccess: () => {
        setNoteContent('');
        setNoteTitle('');
        setPatientCondition('');
      },
    });
  };

  const handleSignRound = () => {
    if (!patientId || !admissionId) return;
    if (!roundSubjective.trim() && !roundObjective.trim() && !roundAssessment.trim() && !roundPlan.trim() && !roundSummary.trim()) {
      toast.error(t('ipd.roundEmpty', { defaultValue: 'Add at least one SOAP field or summary before signing.' }));
      return;
    }
    const idempotencyKey = `${admissionId}-${roundDate}-${roundTime}-${Date.now().toString(36)}`;
    roundMutation.mutate({
      admissionId: Number(admissionId),
      patientId,
      roundDate,
      roundTime,
      patientCondition: roundCondition,
      title: `IPD Round Note · ${roundDate} ${roundTime}`,
      subjective: roundSubjective,
      objective: roundObjective,
      assessment: roundAssessment,
      plan: roundPlan,
      roundSummary,
      createBillingRound: roundCreateBilling && roundFeeConfigured,
      idempotencyKey,
    });
  };

  /* ── Loading / Error States ────────────────────────────────────────────── */

  if (admissionQuery.isLoading) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[var(--color-text-muted)]">{t('ipd.loading', { defaultValue: 'Loading admission data...' })}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (admissionQuery.isError || !admission) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <div className="text-center text-[var(--color-text-muted)]">
            <Bed className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>{t('ipd.notFound', { defaultValue: 'Admission not found' })}</p>
            <Link to={`${basePath}/admissions`} className="btn-primary mt-4 inline-block">
              {t('ipd.backToAdmissions', { defaultValue: 'Back to Admissions' })}
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  /* ── Latest Vitals for Display ─────────────────────────────────────────── */

  const latestVitals = vitals.length > 0 ? vitals[0] : null;

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <DashboardLayout role={role}>
      <div className="max-w-[1600px] mx-auto space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Link to={`${basePath}/admissions`} className="hover:text-[var(--color-primary)]">
            {t('ipd.admissions', { defaultValue: 'Admissions' })}
          </Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[var(--color-text)] font-medium">{admission.admission_no}</span>
        </div>

        {/* 3-Column Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">

          {/* ─── LEFT COLUMN: Patient Banner ─────────────────────────── */}
          <div className="xl:col-span-3 space-y-5">
            {/* Patient Banner */}
            <div className="card p-5 border-l-4 border-l-[var(--color-primary)]">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center shrink-0">
                  <User className="w-6 h-6 text-[var(--color-primary)]" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-[var(--color-text)] truncate">
                    {admission.patient_name}
                  </h2>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {admission.age ? `${admission.age}y` : ''} {admission.gender ? `/ ${admission.gender}` : ''}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2.5 text-sm">
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <Bed className="w-4 h-4 shrink-0" />
                  <span>{admission.bed_number || '—'} {admission.ward_name ? `(${admission.ward_name})` : ''}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <Calendar className="w-4 h-4 shrink-0" />
                  <span>{formatDateTimeGMT6(admission.admission_date)}</span>
                </div>
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <Stethoscope className="w-4 h-4 shrink-0" />
                  <span>{admission.admitting_doctor || '—'}</span>
                </div>
              </div>

              {(admission.provisional_diagnosis || admission.diagnosis) && (
                <div className="mt-4 p-3 rounded-lg bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/10">
                  <p className="text-xs font-medium text-[var(--color-primary)] mb-1">
                    {t('ipd.diagnosis', { defaultValue: 'Diagnosis' })}
                  </p>
                  <p className="text-sm text-[var(--color-text)]">{admission.provisional_diagnosis || admission.diagnosis}</p>
                </div>
              )}

              <div className="mt-4">
                <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${
                  admission.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                  admission.status === 'discharged' ? 'bg-slate-100 text-slate-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {admission.status}
                </span>
              </div>
            </div>

            {/* Latest Vitals Summary */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Heart className="w-4 h-4 text-[var(--color-primary)]" />
                {t('ipd.latestVitals', { defaultValue: 'Latest Vitals' })}
              </h3>
              {latestVitals ? (
                <div className="grid grid-cols-2 gap-3">
                  {latestVitals.systolic != null && (
                    <div className="p-2 rounded-lg bg-[var(--color-surface)]">
                      <p className="text-xs text-[var(--color-text-muted)]">BP</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">
                        {latestVitals.systolic}/{latestVitals.diastolic}
                      </p>
                    </div>
                  )}
                  {latestVitals.heart_rate != null && (
                    <div className="p-2 rounded-lg bg-[var(--color-surface)]">
                      <p className="text-xs text-[var(--color-text-muted)]">HR</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{latestVitals.heart_rate} bpm</p>
                    </div>
                  )}
                  {latestVitals.temperature != null && (
                    <div className="p-2 rounded-lg bg-[var(--color-surface)]">
                      <p className="text-xs text-[var(--color-text-muted)]">Temp</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{displayTemperatureF(latestVitals.temperature)}</p>
                    </div>
                  )}
                  {latestVitals.spo2 != null && (
                    <div className="p-2 rounded-lg bg-[var(--color-surface)]">
                      <p className="text-xs text-[var(--color-text-muted)]">SpO2</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{latestVitals.spo2}%</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 text-[var(--color-text-muted)]">
                  <Activity className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">{t('ipd.noVitals', { defaultValue: 'No vitals recorded' })}</p>
                </div>
              )}
            </div>

            {/* Discharge Readiness */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[var(--color-primary)]" />
                {t('ipd.dischargeReadiness', { defaultValue: 'Discharge Readiness' })}
              </h3>
              {dischargePlan ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {dischargePlan.checklist_progress
                        ? `${dischargePlan.checklist_progress.done}/${dischargePlan.checklist_progress.total}`
                        : '—'}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      dischargePlan.status === 'ready' ? 'bg-emerald-100 text-emerald-700' :
                      dischargePlan.status === 'approved' ? 'bg-green-100 text-green-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {dischargePlan.status}
                    </span>
                  </div>
                  {dischargePlan.checklist_progress && (
                    <div className="w-full h-2 rounded-full bg-[var(--color-surface)] mb-3">
                      <div
                        className="h-2 rounded-full bg-[var(--color-primary)] transition-all"
                        style={{ width: `${dischargePlan.checklist_progress.percent}%` }}
                      />
                    </div>
                  )}
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {Object.entries(DISCHARGE_CHECKLIST_ITEMS).map(([key, label]) => {
                      const checked = dischargePlan.checklist?.[key] ?? false;
                      return (
                        <div key={key} className="flex items-center gap-2 text-xs">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            checked
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-[var(--color-border)]'
                          }`}>
                            {checked && <CheckCircle className="w-3 h-3" />}
                          </div>
                          <span className={checked ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text)]'}>
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-[var(--color-text-muted)]">
                  <CheckCircle className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">{t('ipd.noDischargePlan', { defaultValue: 'No discharge plan yet' })}</p>
                </div>
              )}
            </div>
          </div>

          {/* ─── CENTER COLUMN: Progress Notes + Vitals Trend ───────── */}
          <div className="xl:col-span-5 space-y-5">
            {/* Tab switcher */}
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2">
              <button
                type="button"
                onClick={() => switchTab('notes')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  activeTab === 'notes'
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'
                }`}
              >
                <FileText className="w-3.5 h-3.5 inline mr-1" />
                {t('ipd.notesTab', { defaultValue: 'Progress Notes' })}
              </button>
              <button
                type="button"
                onClick={() => switchTab('round')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  activeTab === 'round'
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'
                }`}
                data-testid="ipd-round-tab"
              >
                <NotebookPen className="w-3.5 h-3.5 inline mr-1" />
                {t('ipd.roundTab', { defaultValue: 'Round Note' })}
              </button>
            </div>

            {activeTab === 'round' && role === 'doctor' && (
              <div className="card p-4 space-y-4 border-l-4 border-l-[var(--color-primary)]" data-testid="ipd-round-form">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <NotebookPen className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('ipd.roundFormTitle', { defaultValue: 'Doctor Round Note' })}
                  </h3>
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {t('ipd.roundSignedBy', { defaultValue: 'Signed by you' })}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('ipd.roundDate', { defaultValue: 'Date' })}</label>
                    <input type="date" className="input" value={roundDate} onChange={(e) => setRoundDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">{t('ipd.roundTime', { defaultValue: 'Time' })}</label>
                    <input type="time" className="input" value={roundTime} onChange={(e) => setRoundTime(e.target.value)} />
                  </div>
                </div>

                <div>
                  <label className="label">{t('ipd.roundCondition', { defaultValue: 'Patient condition' })}</label>
                  <div className="flex flex-wrap gap-2" role="radiogroup" data-testid="ipd-round-condition">
                    {[
                      { value: 'improving' as const, label: t('ipd.conditionImproving', { defaultValue: 'Improving' }), tone: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
                      { value: 'stable' as const, label: t('ipd.conditionStable', { defaultValue: 'Stable' }), tone: 'bg-sky-100 text-sky-700 border-sky-300' },
                      { value: 'deteriorating' as const, label: t('ipd.conditionDeteriorating', { defaultValue: 'Deteriorating' }), tone: 'bg-amber-100 text-amber-700 border-amber-300' },
                      { value: 'critical' as const, label: t('ipd.conditionCritical', { defaultValue: 'Critical' }), tone: 'bg-red-100 text-red-700 border-red-300' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={roundCondition === opt.value}
                        onClick={() => setRoundCondition(opt.value)}
                        className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                          roundCondition === opt.value
                            ? `${opt.tone} ring-2 ring-offset-1`
                            : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)]'
                        }`}
                        data-testid={`ipd-round-condition-${opt.value}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('ipd.roundSubjective', { defaultValue: 'Subjective' })}</label>
                    <textarea
                      className="input min-h-[80px]"
                      value={roundSubjective}
                      onChange={(e) => setRoundSubjective(e.target.value)}
                      data-testid="ipd-round-subjective"
                    />
                  </div>
                  <div>
                    <label className="label">{t('ipd.roundObjective', { defaultValue: 'Objective' })}</label>
                    <textarea
                      className="input min-h-[80px]"
                      value={roundObjective}
                      onChange={(e) => setRoundObjective(e.target.value)}
                      data-testid="ipd-round-objective"
                    />
                  </div>
                  <div>
                    <label className="label">{t('ipd.roundAssessment', { defaultValue: 'Assessment' })}</label>
                    <textarea
                      className="input min-h-[80px]"
                      value={roundAssessment}
                      onChange={(e) => setRoundAssessment(e.target.value)}
                      data-testid="ipd-round-assessment"
                    />
                  </div>
                  <div>
                    <label className="label">{t('ipd.roundPlan', { defaultValue: 'Plan' })}</label>
                    <textarea
                      className="input min-h-[80px]"
                      value={roundPlan}
                      onChange={(e) => setRoundPlan(e.target.value)}
                      data-testid="ipd-round-plan"
                    />
                  </div>
                </div>

                <div>
                  <label className="label">{t('ipd.roundSummary', { defaultValue: 'Round summary' })}</label>
                  <input
                    type="text"
                    className="input"
                    value={roundSummary}
                    onChange={(e) => setRoundSummary(e.target.value)}
                    placeholder={t('ipd.roundSummaryPlaceholder', { defaultValue: 'One-line summary of this round' })}
                    data-testid="ipd-round-summary"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="ipd-round-billing">
                  <input
                    type="checkbox"
                    checked={roundCreateBilling && roundFeeConfigured}
                    onChange={(e) => setRoundCreateBilling(e.target.checked && roundFeeConfigured)}
                    disabled={!roundFeeConfigured}
                    className="w-4 h-4"
                  />
                  <span className="font-medium">
                    {t('ipd.roundCreateBilling', { defaultValue: 'Create billable doctor round' })}
                  </span>
                  {roundCreateBilling && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                      <CircleDollarSign className="w-3.5 h-3.5" />
                      {roundFeeConfigured
                        ? t('ipd.roundFeeLabel', {
                            defaultValue: `Fee: ৳${roundFeeAmount.toLocaleString()}`,
                          })
                        : t('ipd.roundFeeNotConfigured', { defaultValue: 'Doctor fee not configured' })}
                    </span>
                  )}
                </label>

                {!roundFeeConfigured && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-xs">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>
                      {t('ipd.roundFeeWarning', {
                        defaultValue:
                          'Doctor IPD round fee is not configured. You can sign the clinical note, but billable doctor round creation is disabled until an admin sets the fee.',
                      })}
                    </span>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleSignRound}
                    disabled={roundMutation.isPending}
                    data-testid="ipd-round-submit"
                  >
                    {roundMutation.isPending
                      ? t('ipd.roundSigning', { defaultValue: 'Signing…' })
                      : t('ipd.roundSign', { defaultValue: 'Sign Round Note' })}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'round' && role !== 'doctor' && (
              <div className="card p-4 text-sm text-[var(--color-text-muted)]">
                {t('ipd.roundDoctorOnly', {
                  defaultValue: 'Round note sign-off is restricted to the assigned doctor.',
                })}
              </div>
            )}

            {activeTab === 'round' && (
              <div className="card p-4" data-testid="ipd-round-history">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('ipd.roundHistory', { defaultValue: 'Round history' })}
                </h3>
                {roundsQuery.isLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
                  </div>
                ) : rounds.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] text-center py-6">
                    {t('ipd.roundHistoryEmpty', { defaultValue: 'No rounds recorded for this admission yet.' })}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {rounds.map((round) => {
                      const cs = (round.clinical_status ?? 'billing_only') as string;
                      const csTone =
                        cs === 'signed' ? 'bg-emerald-100 text-emerald-700'
                        : cs === 'documented' ? 'bg-sky-100 text-sky-700'
                        : cs === 'cancelled' ? 'bg-slate-100 text-slate-600'
                        : 'bg-amber-100 text-amber-700';
                      return (
                        <div key={round.id} className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-sm font-medium text-[var(--color-text)]">
                              {formatDateTimeGMT6(round.rounded_at)}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="px-1.5 py-0.5 rounded-full bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)] uppercase">
                                {round.entry_source.replace('_', ' ')}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded-full font-medium ${csTone}`}>
                                {cs === 'billing_only'
                                  ? t('ipd.roundClinicalBillingOnly', { defaultValue: 'Billing only' })
                                  : cs === 'documented'
                                  ? t('ipd.roundClinicalDocumented', { defaultValue: 'Documented' })
                                  : cs === 'signed'
                                  ? t('ipd.roundClinicalSigned', { defaultValue: 'Signed' })
                                  : cs}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                                round.bill_status === 'provisional' ? 'bg-amber-100 text-amber-700'
                                : round.bill_status === 'finalized' ? 'bg-emerald-100 text-emerald-700'
                                : round.bill_status === 'cancelled' ? 'bg-slate-100 text-slate-600'
                                : 'bg-slate-100 text-slate-600'
                              }`}>
                                {round.bill_status ?? '—'}
                              </span>
                              {round.patient_condition && (
                                <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                                  {round.patient_condition}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                            {t('ipd.roundDoctorLabel', { defaultValue: 'Doctor' })}: {round.doctor_name_snapshot}
                            {round.entered_by_name && ` · ${t('ipd.roundEnteredBy', { defaultValue: 'Entered by' })}: ${round.entered_by_name}`}
                            {' · '}
                            {t('ipd.roundFeeLabel', { defaultValue: `Fee: ৳${Number(round.round_fee_snapshot ?? 0).toLocaleString()}` })}
                          </div>
                          {round.clinical_note_title && (
                            <div className="mt-1 text-xs text-[var(--color-text)]">
                              {t('ipd.roundNoteTitle', { defaultValue: 'Note' })}: {round.clinical_note_title}
                            </div>
                          )}
                          {round.round_summary && (
                            <div className="mt-1 text-xs text-[var(--color-text-muted)] italic">
                              {round.round_summary}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'notes' && (
            <>
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                {t('ipd.newProgressNote', { defaultValue: 'New Progress Note' })}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="label">{t('ipd.noteTitle', { defaultValue: 'Title' })}</label>
                  <input
                    type="text"
                    className="input"
                    value={noteTitle}
                    onChange={e => setNoteTitle(e.target.value)}
                    placeholder={t('ipd.noteTitlePlaceholder', { defaultValue: 'Round Note, Post-Op Note, etc.' })}
                  />
                </div>
                <div>
                  <label className="label">{t('ipd.patientCondition', { defaultValue: 'Patient Condition' })}</label>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { value: 'Improving', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
                      { value: 'Stable', color: 'bg-sky-100 text-sky-700 border-sky-300' },
                      { value: 'Deteriorating', color: 'bg-red-100 text-red-700 border-red-300' },
                      { value: 'Critical', color: 'bg-orange-100 text-orange-700 border-orange-300' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPatientCondition(patientCondition === opt.value ? '' : opt.value)}
                        className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                          patientCondition === opt.value ? opt.color + ' ring-2 ring-offset-1' : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)]'
                        }`}
                      >
                        {opt.value}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">{t('ipd.noteContent', { defaultValue: 'Content' })}</label>
                  <textarea
                    className="input min-h-[100px]"
                    value={noteContent}
                    onChange={e => setNoteContent(e.target.value)}
                    placeholder={t('ipd.noteContentPlaceholder', { defaultValue: 'Document your clinical findings, assessment, and plan...' })}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    className="btn-primary"
                    onClick={handleCreateNote}
                    disabled={!noteContent.trim() || createNoteMutation.isPending}
                  >
                    {createNoteMutation.isPending ? t('ipd.saving', { defaultValue: 'Saving...' }) : t('ipd.saveNote', { defaultValue: 'Save Note' })}
                  </button>
                </div>
              </div>
            </div>

            {/* Progress Notes List */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                {t('ipd.progressNotes', { defaultValue: 'Progress Notes' })}
              </h3>
              {notesQuery.isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="skeleton h-20 rounded-lg" />
                  ))}
                </div>
              ) : notes.length > 0 ? (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {notes.map(note => (
                    <div key={note.id} className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-[var(--color-text)]">
                          {note.title || note.note_type}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {formatDateTimeGMT6(note.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">{note.content}</p>
                      {note.doctor_name && (
                        <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                          {t('ipd.byDoctor', { defaultValue: 'By' })}: {note.doctor_name}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-[var(--color-text-muted)]">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">{t('ipd.noNotes', { defaultValue: 'No progress notes yet' })}</p>
                </div>
              )}
            </div>

            {/* Vitals Trend */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--color-primary)]" />
                {t('ipd.vitalsTrend', { defaultValue: 'Vitals Trend (Last 7 Days)' })}
              </h3>
              {patientId ? (
                <VitalsTrend patientId={patientId} days={7} />
              ) : (
                <div className="text-center py-8 text-[var(--color-text-muted)]">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">{t('ipd.noVitalsData', { defaultValue: 'No vitals data available' })}</p>
                </div>
              )}
            </div>
            </>
            )}
          </div>

          {/* ─── RIGHT COLUMN: Medications, Orders ──────────────────── */}
          <div className="xl:col-span-4 space-y-5">
            {/* Active Medications */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Pill className="w-4 h-4 text-[var(--color-primary)]" />
                {t('ipd.activeMedications', { defaultValue: 'Active Medications' })}
              </h3>
              {medsQuery.isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
                </div>
              ) : medications.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {medications.map(med => (
                    <div key={med.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--color-surface)]">
                      <Pill className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text)] truncate">{med.medication_name}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {med.dosage} {med.frequency} {med.route ? `(${med.route})` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-[var(--color-text-muted)]">
                  <Pill className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">{t('ipd.noMedications', { defaultValue: 'No active medications' })}</p>
                </div>
              )}
            </div>

            {role === 'doctor' && patientId && (
              <>
                <IPDMedicationOrderComposer
                  patientId={patientId}
                  visitId={admission.ipd_visit_id}
                  admissionId={Number(admissionId)}
                />
                <MedicationReconciliationPanel
                  patientId={patientId}
                  visitId={admission.ipd_visit_id}
                  admissionId={Number(admissionId)}
                  basePath={basePath}
                  defaultType="discharge"
                  onCompleted={() => {
                    queryClient.invalidateQueries({ queryKey: queryKeys.dischargePlanning.detail(Number(admissionId)) });
                  }}
                />
              </>
            )}

            {/* Pending Orders */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
                {t('ipd.pendingOrders', { defaultValue: 'Pending Orders' })}
              </h3>
              {admissionQuery.isLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => <div key={i} className="skeleton h-12 rounded-lg" />)}
                </div>
              ) : pendingOrders.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {pendingOrders.map(order => (
                    <div key={order.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--color-surface)]">
                      {order.order_type === 'lab' ? (
                        <FlaskConical className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      ) : (
                        <Activity className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text)] truncate">{order.item_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            order.order_type === 'lab' ? 'bg-amber-50 text-amber-700' : 'bg-purple-50 text-purple-700'
                          }`}>
                            {order.order_type}
                          </span>
                          <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDateTimeGMT6(order.ordered_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-[var(--color-text-muted)]">
                  <FlaskConical className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">{t('ipd.noPendingOrders', { defaultValue: 'No pending orders' })}</p>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                {t('ipd.quickActions', { defaultValue: 'Quick Actions' })}
              </h3>
              <div className="space-y-2">
                <Link
                  to={`${basePath}/patients/${patientId}/chart`}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-primary)]/5 transition-colors text-sm"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('ipd.patientChart', { defaultValue: 'Patient Chart' })}
                  </span>
                  <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                </Link>
                <Link
                  to={`${basePath}/doctor/lab-orders?patient=${patientId}&admission=${admissionId}&from=doctor/ipd/${admissionId}`}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-primary)]/5 transition-colors text-sm"
                >
                  <span className="flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-amber-500" />
                    {t('ipd.orderLab', { defaultValue: 'Order Lab Test' })}
                  </span>
                  <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                </Link>
                <Link
                  to={`${basePath}/prescriptions/new?patient=${patientId}&admission=${admissionId}&from=doctor/ipd/${admissionId}`}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-primary)]/5 transition-colors text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Pill className="w-4 h-4 text-blue-500" />
                    {t('ipd.newPrescription', { defaultValue: 'New Prescription' })}
                  </span>
                  <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                </Link>
                <Link
                  to={`${basePath}/doctor/ipd/${admissionId}/discharge`}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-primary)]/5 transition-colors text-sm"
                >
                  <span className="flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-emerald-500" />
                    {t('ipd.dischargeSummary', { defaultValue: 'Discharge Summary' })}
                  </span>
                  <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

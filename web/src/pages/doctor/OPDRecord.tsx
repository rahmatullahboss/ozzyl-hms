import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { User, Heart, AlertTriangle, FileText, FlaskConical, Pill, Calendar, Stethoscope, ChevronRight, Activity, Search, Plus, Clock, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTimeGMT6 } from '../../lib/date-utils';

/* ─── Types ───────────────────────────────────────────────────────────────── */

interface Patient {
  id: number;
  patient_code: string;
  name: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  mobile?: string;
  date_of_birth?: string;
  address?: string;
}

interface Appointment {
  id: number;
  appointment_date: string;
  appointment_time?: string;
  visit_type?: string;
  status: string;
  doctor_name?: string;
  reason?: string;
}

interface Vitals {
  systolic?: number;
  diastolic?: number;
  heart_rate?: number;
  temperature?: number;
  spo2?: number;
  respiratory_rate?: number;
  weight?: number;
  height?: number;
  recorded_at: string;
}

interface Allergy {
  id: number;
  allergen: string;
  severity: string;
  reaction?: string;
  status: string;
}

interface Problem {
  id: number;
  diagnosis: string;
  status: string;
  onset_date?: string;
  notes?: string;
}

interface ClinicalNote {
  id: number;
  note_type: string;
  title?: string;
  content: string;
  doctor_name?: string;
  created_at: string;
}

interface LabCatalogItem {
  id: number;
  code?: string;
  name: string;
  category?: string;
  price?: number;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function OPDRecord({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('clinical');
  const { slug = '', patientId = '', apptId = '' } = useParams<{ slug: string; patientId: string; apptId: string }>();
  const queryClient = useQueryClient();
  const basePath = `/h/${slug}`;

  /* ── Form State ────────────────────────────────────────────────────────── */

  const [soapForm, setSoapForm] = useState({
    chiefComplaint: '',
    subjective: '',
    objective: '',
    assessment: '',
    plan: '',
  });

  const [labSearch, setLabSearch] = useState('');
  const [selectedLabs, setSelectedLabs] = useState<LabCatalogItem[]>([]);
  const [imagingType, setImagingType] = useState('');
  const [imagingNotes, setImagingNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpReason, setFollowUpReason] = useState('');

  const [activeTab, setActiveTab] = useState<'soap' | 'notes' | 'diagnosis' | 'timeline'>('soap');

  /* ── Data Fetching ─────────────────────────────────────────────────────── */

  const patientQuery = useApiQuery<{ patient: Patient }>(
    queryKeys.patients.detail(Number(patientId)),
    `/api/patients/${patientId}`,
    { enabled: !!patientId },
  );
  const patient = patientQuery.data?.patient;

  const apptQuery = useApiQuery<{ appointment: Appointment }>(
    queryKeys.appointments.detail(Number(apptId)),
    `/api/appointments/${apptId}`,
    { enabled: !!apptId },
  );
  const appointment = apptQuery.data?.appointment;

  const vitalsQuery = useApiQuery<{ vitals: Vitals[] }>(
    queryKeys.vitals.list(patientId),
    `/api/clinical/vitals?patientId=${patientId}&limit=1`,
    { enabled: !!patientId },
  );
  const latestVitals = vitalsQuery.data?.vitals?.[0];

  const allergiesQuery = useApiQuery<{ allergies: Allergy[] }>(
    queryKeys.allergies.list(patientId),
    `/api/clinical/allergies?patientId=${patientId}`,
    { enabled: !!patientId },
  );
  const allergies = allergiesQuery.data?.allergies ?? [];
  const severeAllergies = allergies.filter(a => a.severity === 'severe' || a.severity === 'life_threatening');

  const problemsQuery = useApiQuery<{ problems: Problem[] }>(
    ['clinical', 'problems', patientId],
    `/api/clinical/problems?patientId=${patientId}&status=active`,
    { enabled: !!patientId },
  );
  const activeProblems = problemsQuery.data?.problems ?? [];

  const notesQuery = useApiQuery<{ notes: ClinicalNote[] }>(
    queryKeys.patientChart.detail(patientId, false),
    `/api/clinical/notes?patientId=${patientId}`,
    { enabled: !!patientId },
  );
  const clinicalNotes = notesQuery.data?.notes ?? [];

  const labCatalogQuery = useApiQuery<{ items: LabCatalogItem[] }>(
    queryKeys.patientChart.labCatalog(labSearch),
    `/api/patients/${patientId}/chart/lab-catalog?search=${encodeURIComponent(labSearch)}`,
    { enabled: labSearch.length >= 2 },
  );
  const labCatalogItems = labCatalogQuery.data?.items ?? [];

  const timelineQuery = useApiQuery<{ timeline: Array<{ type: string; date: string; title: string; subtitle?: string; id: number }> }>(
    queryKeys.patientChart.timeline(String(patientId ?? '')),
    `/api/patients/${patientId}/timeline`,
    { enabled: !!patientId && activeTab === 'timeline' },
  );
  const timelineItems = timelineQuery.data?.timeline ?? [];

  /* ── Mutations ─────────────────────────────────────────────────────────── */

  const soapMutation = useApiMutation<unknown, typeof soapForm>(
    'post',
    `/api/patients/${patientId}/chart/soap`,
    {
      onSuccess: () => {
        toast.success(t('clinical.soapSaved', { defaultValue: 'SOAP note saved' }));
        setSoapForm({ chiefComplaint: '', subjective: '', objective: '', assessment: '', plan: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.patientChart.detail(patientId, false) });
      },
      onError: () => toast.error(t('clinical.soapFailed', { defaultValue: 'Failed to save SOAP note' })),
    },
  );

  const labOrderMutation = useApiMutation<unknown, { tests: number[]; priority: string; notes?: string }>(
    'post',
    `/api/patients/${patientId}/chart/lab-order`,
    {
      onSuccess: () => {
        toast.success(t('clinical.labOrdered', { defaultValue: 'Lab order placed' }));
        setSelectedLabs([]);
        setLabSearch('');
      },
      onError: () => toast.error(t('clinical.labOrderFailed', { defaultValue: 'Failed to place lab order' })),
    },
  );

  const imagingMutation = useApiMutation<unknown, { type: string; notes?: string }>(
    'post',
    `/api/patients/${patientId}/chart/radiology-order`,
    {
      onSuccess: () => {
        toast.success(t('clinical.imagingOrdered', { defaultValue: 'Imaging order placed' }));
        setImagingType('');
        setImagingNotes('');
      },
      onError: () => toast.error(t('clinical.imagingOrderFailed', { defaultValue: 'Failed to place imaging order' })),
    },
  );

  const followUpMutation = useApiMutation<unknown, { apptDate: string; notes?: string }>(
    'post',
    `/api/patients/${patientId}/chart/follow-up`,
    {
      onSuccess: () => {
        toast.success(t('clinical.followUpScheduled', { defaultValue: 'Follow-up scheduled' }));
        setFollowUpDate('');
        setFollowUpReason('');
      },
      onError: () => toast.error(t('clinical.followUpFailed', { defaultValue: 'Failed to schedule follow-up' })),
    },
  );

  /* ── Handlers ──────────────────────────────────────────────────────────── */

  const handleSoapSubmit = () => {
    if (!soapForm.chiefComplaint.trim() && !soapForm.assessment.trim()) {
      toast.error(t('clinical.soapRequired', { defaultValue: 'Please fill at least Chief Complaint or Assessment' }));
      return;
    }
    soapMutation.mutate(soapForm);
  };

  const handleLabOrder = () => {
    if (selectedLabs.length === 0) {
      toast.error(t('clinical.selectLabTest', { defaultValue: 'Please select at least one test' }));
      return;
    }
    labOrderMutation.mutate({
      tests: selectedLabs.map(l => l.id),
      priority: 'routine',
    });
  };

  const handleImagingOrder = () => {
    if (!imagingType.trim()) {
      toast.error(t('clinical.imagingTypeRequired', { defaultValue: 'Please enter imaging type' }));
      return;
    }
    imagingMutation.mutate({ type: imagingType, notes: imagingNotes || undefined });
  };

  const handleFollowUp = () => {
    if (!followUpDate) {
      toast.error(t('clinical.followUpDateRequired', { defaultValue: 'Please select a follow-up date' }));
      return;
    }
    followUpMutation.mutate({ apptDate: followUpDate, notes: followUpReason || undefined });
  };

  const addLabTest = (item: LabCatalogItem) => {
    if (!selectedLabs.find(l => l.id === item.id)) {
      setSelectedLabs(prev => [...prev, item]);
    }
    setLabSearch('');
  };

  const removeLabTest = (id: number) => {
    setSelectedLabs(prev => prev.filter(l => l.id !== id));
  };

  /* ── Loading / Error States ────────────────────────────────────────────── */

  if (patientQuery.isLoading) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[var(--color-text-muted)]">{t('clinical.loading', { defaultValue: 'Loading patient data...' })}</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (patientQuery.isError || !patient) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <div className="text-center text-[var(--color-text-muted)]">
            <User className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>{t('clinical.patientNotFound', { defaultValue: 'Patient not found' })}</p>
            <Link to={`${basePath}/patients`} className="btn-primary mt-4 inline-block">
              {t('clinical.backToPatients', { defaultValue: 'Back to Patients' })}
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  /* ── Patient Age Helper ────────────────────────────────────────────────── */

  const patientAgeStr = patient.age
    ? `${patient.age}y`
    : patient.date_of_birth
      ? `${Math.max(0, Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)))}y`
      : '—';

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <DashboardLayout role={role}>
      <div className="max-w-[1600px] mx-auto space-y-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Link to={`${basePath}/patients`} className="hover:text-[var(--color-primary)]">
            {t('clinical.patients', { defaultValue: 'Patients' })}
          </Link>
          <ChevronRight className="w-4 h-4" />
          <Link to={`${basePath}/patients/${patientId}`} className="hover:text-[var(--color-primary)]">
            {patient.name}
          </Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-[var(--color-text)] font-medium">
            {t('clinical.opdVisit', { defaultValue: 'OPD Visit' })}
            {appointment ? ` #${appointment.id}` : ''}
          </span>
        </div>

        {/* Appointment Header */}
        {appointment && (
          <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-[var(--color-primary)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">
                  {appointment.visit_type || 'Consultation'} &middot; {formatDateTimeGMT6(appointment.appointment_date)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {appointment.doctor_name || '—'} &middot; Status: {appointment.status}
                </p>
              </div>
            </div>
            {appointment.reason && (
              <p className="text-sm text-[var(--color-text-muted)] max-w-md truncate">
                {appointment.reason}
              </p>
            )}
          </div>
        )}

        {/* 3-Column Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">

          {/* ─── LEFT COLUMN (col-span-3) ───────────────────────────── */}
          <div className="xl:col-span-3 space-y-5">
            {/* Patient Demographics */}
            <div className="card p-5 border-l-4 border-l-[var(--color-primary)]">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center shrink-0">
                  <User className="w-6 h-6 text-[var(--color-primary)]" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-[var(--color-text)] truncate">{patient.name}</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {patientAgeStr} / {patient.gender || '—'}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <User className="w-4 h-4 shrink-0" />
                  <span>{patient.patient_code}</span>
                </div>
                {patient.mobile && (
                  <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    <Stethoscope className="w-4 h-4 shrink-0" />
                    <span>{patient.mobile}</span>
                  </div>
                )}
                {patient.blood_group && (
                  <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    <Heart className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{patient.blood_group}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Latest Vitals */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Heart className="w-4 h-4 text-[var(--color-primary)]" />
                {t('clinical.latestVitals', { defaultValue: 'Latest Vitals' })}
              </h3>
              {vitalsQuery.isLoading ? (
                <div className="skeleton h-24 rounded-lg" />
              ) : latestVitals ? (
                <div className="grid grid-cols-2 gap-2.5">
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
                      <p className="text-sm font-semibold text-[var(--color-text)]">{latestVitals.temperature} C</p>
                    </div>
                  )}
                  {latestVitals.spo2 != null && (
                    <div className="p-2 rounded-lg bg-[var(--color-surface)]">
                      <p className="text-xs text-[var(--color-text-muted)]">SpO2</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{latestVitals.spo2}%</p>
                    </div>
                  )}
                  {latestVitals.weight != null && (
                    <div className="p-2 rounded-lg bg-[var(--color-surface)]">
                      <p className="text-xs text-[var(--color-text-muted)]">Weight</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{latestVitals.weight} kg</p>
                    </div>
                  )}
                  {latestVitals.respiratory_rate != null && (
                    <div className="p-2 rounded-lg bg-[var(--color-surface)]">
                      <p className="text-xs text-[var(--color-text-muted)]">RR</p>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{latestVitals.respiratory_rate}/min</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 text-[var(--color-text-muted)]">
                  <Activity className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">{t('clinical.noVitals', { defaultValue: 'No vitals recorded' })}</p>
                </div>
              )}
              <Link
                to={`${basePath}/vitals?patientId=${patientId}`}
                className="text-xs text-[var(--color-primary)] hover:underline mt-3 inline-block"
              >
                {t('clinical.recordVitals', { defaultValue: 'Record Vitals' })}
              </Link>
            </div>

            {/* Allergy Alerts */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--color-primary)]" />
                {t('clinical.allergies', { defaultValue: 'Allergies' })}
              </h3>
              {allergiesQuery.isLoading ? (
                <div className="skeleton h-16 rounded-lg" />
              ) : severeAllergies.length > 0 ? (
                <div className="space-y-2">
                  {severeAllergies.map(allergy => (
                    <div key={allergy.id} className="p-2.5 rounded-lg bg-red-50 border border-red-200">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                        <span className="text-sm font-medium text-red-700">{allergy.allergen}</span>
                      </div>
                      {allergy.reaction && (
                        <p className="text-xs text-red-600 mt-1 ml-6">{allergy.reaction}</p>
                      )}
                    </div>
                  ))}
                  {allergies.length > severeAllergies.length && (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      +{allergies.length - severeAllergies.length} {t('clinical.moreAllergies', { defaultValue: 'more' })}
                    </p>
                  )}
                </div>
              ) : allergies.length > 0 ? (
                <div className="space-y-1.5">
                  {allergies.slice(0, 4).map(allergy => (
                    <div key={allergy.id} className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="text-[var(--color-text)]">{allergy.allergen}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">({allergy.severity})</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-[var(--color-text-muted)]">
                  <p className="text-xs">{t('clinical.noAllergies', { defaultValue: 'No known allergies' })}</p>
                </div>
              )}
            </div>

            {/* Active Problems */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                {t('clinical.activeProblems', { defaultValue: 'Active Problems' })}
              </h3>
              {problemsQuery.isLoading ? (
                <div className="skeleton h-16 rounded-lg" />
              ) : activeProblems.length > 0 ? (
                <div className="space-y-1.5">
                  {activeProblems.map(problem => (
                    <div key={problem.id} className="flex items-start gap-2 text-sm p-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <div>
                        <p className="text-[var(--color-text)]">{problem.diagnosis}</p>
                        {problem.onset_date && (
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {t('clinical.since', { defaultValue: 'Since' })}: {problem.onset_date}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-[var(--color-text-muted)]">
                  <p className="text-xs">{t('clinical.noProblems', { defaultValue: 'No active problems' })}</p>
                </div>
              )}
            </div>
          </div>

          {/* ─── CENTER COLUMN (col-span-5) ─────────────────────────── */}
          <div className="xl:col-span-5 space-y-5">
            {/* Tab Navigation */}
            <div className="card p-0 overflow-hidden">
              <div className="flex border-b border-[var(--color-border)]">
                {[
                  { key: 'soap' as const, label: t('clinical.soapNote', { defaultValue: 'SOAP Note' }), icon: FileText },
                  { key: 'notes' as const, label: t('clinical.notes', { defaultValue: 'Clinical Notes' }), icon: FileText },
                  { key: 'diagnosis' as const, label: t('clinical.diagnosis', { defaultValue: 'Diagnosis' }), icon: Stethoscope },
                  { key: 'timeline' as const, label: t('clinical.timeline', { defaultValue: 'Timeline' }), icon: Clock },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === tab.key
                        ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                        : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {/* SOAP Note Tab */}
                {activeTab === 'soap' && (
                  <div className="space-y-4">
                    <div>
                      <label className="label">{t('clinical.chiefComplaint', { defaultValue: 'Chief Complaint' })}</label>
                      <input
                        type="text"
                        className="input"
                        value={soapForm.chiefComplaint}
                        onChange={e => setSoapForm(prev => ({ ...prev, chiefComplaint: e.target.value }))}
                        placeholder={t('clinical.chiefComplaintPlaceholder', { defaultValue: 'Main reason for visit...' })}
                      />
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-[var(--color-text-muted)] self-center">{t('clinical.duration', { defaultValue: 'Duration' })}:</span>
                        {['1 day', '3 days', '7 days', '14 days', '1 month'].map(d => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              const current = soapForm.chiefComplaint.trim();
                              const withoutDuration = current.replace(/\s+\d+\s+(day|days|week|weeks|month|months)s?$/i, '');
                              setSoapForm(prev => ({ ...prev, chiefComplaint: `${withoutDuration} ${d}`.trim() }));
                            }}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="label">{t('clinical.subjective', { defaultValue: 'Subjective' })}</label>
                      <textarea
                        className="input min-h-[80px]"
                        value={soapForm.subjective}
                        onChange={e => setSoapForm(prev => ({ ...prev, subjective: e.target.value }))}
                        placeholder={t('clinical.subjectivePlaceholder', { defaultValue: 'Patient description of symptoms...' })}
                      />
                    </div>
                    <div>
                      <label className="label">{t('clinical.objective', { defaultValue: 'Objective' })}</label>
                      <textarea
                        className="input min-h-[80px]"
                        value={soapForm.objective}
                        onChange={e => setSoapForm(prev => ({ ...prev, objective: e.target.value }))}
                        placeholder={t('clinical.objectivePlaceholder', { defaultValue: 'Physical examination findings...' })}
                      />
                    </div>
                    <div>
                      <label className="label">{t('clinical.assessment', { defaultValue: 'Assessment' })}</label>
                      <textarea
                        className="input min-h-[80px]"
                        value={soapForm.assessment}
                        onChange={e => setSoapForm(prev => ({ ...prev, assessment: e.target.value }))}
                        placeholder={t('clinical.assessmentPlaceholder', { defaultValue: 'Diagnosis and clinical impression...' })}
                      />
                    </div>
                    <div>
                      <label className="label">{t('clinical.plan', { defaultValue: 'Plan' })}</label>
                      <textarea
                        className="input min-h-[80px]"
                        value={soapForm.plan}
                        onChange={e => setSoapForm(prev => ({ ...prev, plan: e.target.value }))}
                        placeholder={t('clinical.planPlaceholder', { defaultValue: 'Treatment plan, medications, follow-up...' })}
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        className="btn-primary"
                        onClick={handleSoapSubmit}
                        disabled={soapMutation.isPending}
                      >
                        {soapMutation.isPending
                          ? t('clinical.saving', { defaultValue: 'Saving...' })
                          : t('clinical.saveSoap', { defaultValue: 'Save SOAP Note' })}
                      </button>
                    </div>
                  </div>
                )}

                {/* Clinical Notes Tab */}
                {activeTab === 'notes' && (
                  <div>
                    {notesQuery.isLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map(i => <div key={i} className="skeleton h-20 rounded-lg" />)}
                      </div>
                    ) : clinicalNotes.length > 0 ? (
                      <div className="space-y-3 max-h-[500px] overflow-y-auto">
                        {clinicalNotes.map(note => (
                          <div key={note.id} className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium px-2 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                                  {note.note_type}
                                </span>
                                <span className="text-sm font-medium text-[var(--color-text)]">
                                  {note.title || ''}
                                </span>
                              </div>
                              <span className="text-xs text-[var(--color-text-muted)]">
                                {formatDateTimeGMT6(note.created_at)}
                              </span>
                            </div>
                            <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">{note.content}</p>
                            {note.doctor_name && (
                              <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
                                {t('clinical.byDoctor', { defaultValue: 'By' })}: {note.doctor_name}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-[var(--color-text-muted)]">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">{t('clinical.noNotes', { defaultValue: 'No clinical notes yet' })}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Diagnosis Tab */}
                {activeTab === 'diagnosis' && (
                  <div>
                    <p className="text-sm text-[var(--color-text-muted)] mb-3">
                      {t('clinical.diagnosisHint', { defaultValue: 'Search and assign ICD-10 diagnosis codes to this visit.' })}
                    </p>
                    <div className="relative mb-4">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                      <input
                        type="text"
                        className="input pl-10"
                        placeholder={t('clinical.icd10Search', { defaultValue: 'Search ICD-10 codes...' })}
                      />
                    </div>
                    <div className="text-center py-8 text-[var(--color-text-muted)]">
                      <Stethoscope className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">{t('clinical.diagnosisFromAssessment', { defaultValue: 'Diagnosis codes will be extracted from Assessment field' })}</p>
                    </div>
                  </div>
                )}

                {/* Timeline Tab */}
                {activeTab === 'timeline' && (
                  <div>
                    {timelineQuery.isLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-lg" />)}
                      </div>
                    ) : timelineItems.length > 0 ? (
                      <div className="space-y-2 max-h-[500px] overflow-y-auto">
                        {timelineItems.map((item, idx) => (
                          <div key={`${item.type}-${item.id}-${idx}`} className="flex gap-3 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-primary)] transition-colors">
                            <div className="flex-shrink-0 mt-0.5">
                              {item.type === 'prescription' && <Pill className="w-4 h-4 text-emerald-500" />}
                              {item.type === 'lab' && <FlaskConical className="w-4 h-4 text-purple-500" />}
                              {item.type === 'visit' && <Stethoscope className="w-4 h-4 text-blue-500" />}
                              {item.type === 'soap' && <FileText className="w-4 h-4 text-amber-500" />}
                              {item.type === 'admission' && <Activity className="w-4 h-4 text-red-500" />}
                              {!['prescription', 'lab', 'visit', 'soap', 'admission'].includes(item.type) && <Clock className="w-4 h-4 text-gray-400" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-[var(--color-text)] truncate">{item.title}</span>
                                <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">
                                  {item.date ? new Date(item.date).toLocaleDateString('en-BD', { day: '2-digit', month: 'short' }) : ''}
                                </span>
                              </div>
                              {item.subtitle && <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{item.subtitle}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-[var(--color-text-muted)]">
                        <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">{t('clinical.noTimeline', { defaultValue: 'No timeline data yet' })}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── RIGHT COLUMN (col-span-4) ──────────────────────────── */}
          <div className="xl:col-span-4 space-y-5">
            {/* Lab Order Panel */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
                {t('clinical.orderLab', { defaultValue: 'Order Lab Tests' })}
              </h3>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  className="input pl-10"
                  value={labSearch}
                  onChange={e => setLabSearch(e.target.value)}
                  placeholder={t('clinical.searchTests', { defaultValue: 'Search tests...' })}
                />
              </div>
              {labSearch.length >= 2 && labCatalogQuery.isLoading && (
                <div className="text-xs text-[var(--color-text-muted)] mb-2">
                  {t('clinical.searching', { defaultValue: 'Searching...' })}
                </div>
              )}
              {labCatalogItems.length > 0 && (
                <div className="mb-3 max-h-32 overflow-y-auto border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
                  {labCatalogItems.slice(0, 5).map(item => (
                    <button
                      key={item.id}
                      onClick={() => addLabTest(item)}
                      className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-[var(--color-surface)] text-left"
                    >
                      <span className="text-[var(--color-text)]">{item.name}</span>
                      <Plus className="w-4 h-4 text-[var(--color-primary)]" />
                    </button>
                  ))}
                </div>
              )}
              {selectedLabs.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {selectedLabs.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-2 rounded bg-[var(--color-surface)] text-sm">
                      <span className="text-[var(--color-text)]">{item.name}</span>
                      <button
                        onClick={() => removeLabTest(item.id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        {t('clinical.remove', { defaultValue: 'Remove' })}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="btn-primary w-full"
                onClick={handleLabOrder}
                disabled={selectedLabs.length === 0 || labOrderMutation.isPending}
              >
                {labOrderMutation.isPending
                  ? t('clinical.ordering', { defaultValue: 'Ordering...' })
                  : t('clinical.placeOrder', { defaultValue: 'Place Lab Order' })}
              </button>
            </div>

            {/* Imaging Order Panel */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--color-primary)]" />
                {t('clinical.orderImaging', { defaultValue: 'Order Imaging' })}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="label">{t('clinical.imagingType', { defaultValue: 'Type' })}</label>
                  <select
                    className="input"
                    value={imagingType}
                    onChange={e => setImagingType(e.target.value)}
                  >
                    <option value="">{t('clinical.selectType', { defaultValue: 'Select...' })}</option>
                    <option value="xray">X-Ray</option>
                    <option value="ultrasound">Ultrasound</option>
                    <option value="ct">CT Scan</option>
                    <option value="mri">MRI</option>
                    <option value="ecg">ECG</option>
                    <option value="echocardiogram">Echocardiogram</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('clinical.notes', { defaultValue: 'Notes' })}</label>
                  <textarea
                    className="input min-h-[60px]"
                    value={imagingNotes}
                    onChange={e => setImagingNotes(e.target.value)}
                    placeholder={t('clinical.imagingNotesPlaceholder', { defaultValue: 'Clinical indication, body part...' })}
                  />
                </div>
                <button
                  className="btn-primary w-full"
                  onClick={handleImagingOrder}
                  disabled={!imagingType || imagingMutation.isPending}
                >
                  {imagingMutation.isPending
                    ? t('clinical.ordering', { defaultValue: 'Ordering...' })
                    : t('clinical.placeImagingOrder', { defaultValue: 'Place Imaging Order' })}
                </button>
              </div>
            </div>

            {/* Prescription Panel */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Pill className="w-4 h-4 text-[var(--color-primary)]" />
                {t('clinical.prescriptions', { defaultValue: 'Prescriptions' })}
              </h3>
              <p className="text-sm text-[var(--color-text-muted)] mb-3">
                {t('clinical.prescriptionHint', { defaultValue: 'Create a new prescription for this patient.' })}
              </p>
              <Link
                to={`${basePath}/prescriptions/new?patient=${patientId}&appt=${apptId}&from=doctor/opd/${patientId}/${apptId}`}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {t('clinical.newPrescription', { defaultValue: 'New Prescription' })}
              </Link>
            </div>

            {/* Follow-up Scheduler */}
            <div className="card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
                {t('clinical.followUp', { defaultValue: 'Schedule Follow-up' })}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="label">{t('clinical.followUpDate', { defaultValue: 'Date' })}</label>
                  <input
                    type="date"
                    className="input"
                    value={followUpDate}
                    onChange={e => setFollowUpDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">{t('clinical.followUpReason', { defaultValue: 'Reason' })}</label>
                  <input
                    type="text"
                    className="input"
                    value={followUpReason}
                    onChange={e => setFollowUpReason(e.target.value)}
                    placeholder={t('clinical.followUpReasonPlaceholder', { defaultValue: 'Review lab results, check progress...' })}
                  />
                </div>
                <button
                  className="btn-primary w-full"
                  onClick={handleFollowUp}
                  disabled={!followUpDate || followUpMutation.isPending}
                >
                  {followUpMutation.isPending
                    ? t('clinical.scheduling', { defaultValue: 'Scheduling...' })
                    : t('clinical.scheduleFollowUp', { defaultValue: 'Schedule Follow-up' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

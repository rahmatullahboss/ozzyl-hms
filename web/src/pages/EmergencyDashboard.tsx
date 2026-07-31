import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Siren, Plus, X, Search, AlertTriangle, CheckCircle,
  Activity, Clock, UserPlus, Tag, BedDouble,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';
import {
  buildEmergencyAdmissionPayload,
  createEmergencyAdmissionIdempotencyKey,
  emergencyPatientDetailsPath,
} from './emergency/emergencyAdmissionFlow';
import EmergencyPatientActions from './emergency/EmergencyPatientActions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ERPatient {
  id: number;
  er_patient_number: string;
  patient_id?: number | null;
  visit_id?: number | null;
  first_name: string;
  last_name: string;
  patient_name?: string;
  gender?: string;
  age?: string;
  contact_no?: string;
  condition_on_arrival?: string | null;
  triage_code?: 'red' | 'yellow' | 'green' | null;
  er_status: 'new' | 'triaged' | 'finalized';
  finalized_status?: string;
  mode_of_arrival_name?: string;
  visit_datetime?: string;
  active_admission_id?: number | null;
  active_admission_public_id?: string | null;
  active_admission_no?: string | null;
  active_admission_provider_mode?: 'legacy' | 'shadow' | 'canonical' | null;
  profile_incomplete?: boolean | number;
  created_at: string;
}

interface AdmissionResponse {
  admission_no: string;
  admission_id: number | null;
  idempotent?: boolean;
}

interface ERStats {
  new_patients: number;
  triaged_patients: number;
  admitted_today: number;
  discharged_today: number;
  lama_count: number;
  total_today: number;
}

interface PatientSearchResult {
  id: number;
  name: string;
  patient_code: string;
  mobile?: string;
}

interface ERPatientsResponse {
  er_patients: ERPatient[];
}

interface PatientSearchResponse {
  patients: PatientSearchResult[];
}

const STATUS_TAB_KEYS = [
  { key: 'all',       tKey: 'filterAll' },
  { key: 'new',       tKey: 'filterNew' },
  { key: 'triaged',   tKey: 'filterTriaged' },
  { key: 'admitted',  tKey: 'filterAdmitted' },
  { key: 'discharged',tKey: 'filterDischarged' },
];

const TRIAGE_CONFIG = {
  red:    { labelKey: 'redCritical',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  yellow: { labelKey: 'yellowUrgent',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  green:  { labelKey: 'greenStandard',  cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
};

const FINALIZE_OPTION_KEYS = [
  { value: 'discharged',  tKey: 'discharge' },
  { value: 'transferred', tKey: 'transfer' },
  { value: 'lama',        tKey: 'lamaFull' },
  { value: 'dor',         tKey: 'dor' },
  { value: 'death',       tKey: 'death' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmergencyDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['emergency', 'common']);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Register patient modal
  const [showRegister, setShowRegister]       = useState(false);
  const [patientQuery, setPatientQuery]       = useState('');
  const [patientResults, setPatientResults]   = useState<PatientSearchResult[]>([]);
  const [searchingPt, setSearchingPt]         = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [isExisting, setIsExisting]           = useState(false);
  const [registerForm, setRegisterForm] = useState({
    first_name: '', last_name: '', gender: '', age: '',
    contact_no: '', address: '', condition_on_arrival: '',
    case_type: 'medical',
  });

  // Triage modal
  const [triageTarget, setTriageTarget] = useState<ERPatient | null>(null);

  // Finalize modal
  const [finalizeTarget, setFinalizeTarget] = useState<ERPatient | null>(null);
  const [finalizeForm, setFinalizeForm] = useState({ finalized_status: 'discharged', finalized_remarks: '' });

  // Emergency → IPD admission modal
  const [admitTarget, setAdmitTarget] = useState<ERPatient | null>(null);
  const [admitForm, setAdmitForm] = useState({ admission_reason: '', department: '', notes: '' });
  const [admissionIdempotencyKey, setAdmissionIdempotencyKey] = useState('');
  const [admitting, setAdmitting] = useState(false);

  const resetRegisterForm = () => {
    setShowRegister(false);
    setSelectedPatient(null);
    setPatientQuery('');
    setRegisterForm({ first_name: '', last_name: '', gender: '', age: '', contact_no: '', address: '', condition_on_arrival: '', case_type: 'medical' });
    setIsExisting(false);
  };

  const resetFinalizeForm = () => {
    setFinalizeTarget(null);
    setFinalizeForm({ finalized_status: 'discharged', finalized_remarks: '' });
  };

  const resetAdmissionForm = () => {
    setAdmitTarget(null);
    setAdmitForm({ admission_reason: '', department: '', notes: '' });
    setAdmissionIdempotencyKey('');
  };

  // ESC to close modals (with form reset)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        resetRegisterForm();
        setTriageTarget(null);
        resetFinalizeForm();
        resetAdmissionForm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Build query path with filters ──
  const buildPatientsPath = () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (search) params.set('search', search);
    const qs = params.toString();
    return qs ? `/api/emergency?${qs}` : '/api/emergency';
  };

  // ── Fetch ER patients via React Query ──
  const {
    data: patientsData,
    isLoading: loading,
  } = useApiQuery<ERPatientsResponse>(
    queryKeys.emergency.patients({ status: statusFilter, search }),
    buildPatientsPath(),
    {
      placeholderData: (prev) => prev,
    },
  );
  const patients = patientsData?.er_patients ?? [];

  // ── Fetch stats via React Query ──
  const {
    data: stats,
    isLoading: statsLoading,
  } = useApiQuery<ERStats>(
    queryKeys.emergency.stats(),
    '/api/emergency/stats',
  );

  // ── Patient search (existing patient lookup — debounced, non-hook) ──
  useEffect(() => {
    if (patientQuery.length < 2) { setPatientResults([]); return; }
    setSearchingPt(true);
    const t = setTimeout(async () => {
      try {
        const data = await api.get<PatientSearchResponse>('/api/emergency/search-patients?q=' + encodeURIComponent(patientQuery));
        setPatientResults(data.patients ?? []);
      } catch { setPatientResults([]); }
      finally { setSearchingPt(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [patientQuery]);

  // ── Register ER patient mutation ──
  const registerMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/emergency',
    {
      onSuccess: () => {
        toast.success(t('registeredSuccess', { ns: 'emergency' }));
        setShowRegister(false);
        setSelectedPatient(null);
        setPatientQuery('');
        setRegisterForm({ first_name: '', last_name: '', gender: '', age: '', contact_no: '', address: '', condition_on_arrival: '', case_type: 'medical' });
        queryClient.invalidateQueries({ queryKey: queryKeys.emergency.all });
      },
      onError: (err) => {
        toast.error(err.message || 'Failed');
      },
    },
  );

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = isExisting && selectedPatient
      ? { ...registerForm, is_existing_patient: true, patient_id: selectedPatient.id }
      : { ...registerForm, is_existing_patient: false };
    registerMutation.mutate(payload);
  };

  // ── Triage mutation ──
  const triageMutation = useApiMutation<unknown, { id: number; triage_code: string }>(
    'put',
    (vars) => `/api/emergency/${vars.id}/triage`,
    {
      onSuccess: (_data, vars) => {
        toast.success(t('triageSet', { ns: 'emergency', level: t(TRIAGE_CONFIG[vars.triage_code as keyof typeof TRIAGE_CONFIG].labelKey, { ns: 'emergency' }) }));
        setTriageTarget(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.emergency.all });
      },
      onError: (err) => {
        toast.error(err.message || 'Triage failed');
      },
    },
  );

  const handleTriage = (patient: ERPatient, code: 'red' | 'yellow' | 'green') => {
    triageMutation.mutate({ id: patient.id, triage_code: code });
  };

  // ── Finalize mutation ──
  const finalizeMutation = useApiMutation<unknown, { id: number; finalized_status: string; finalized_remarks: string }>(
    'put',
    (vars) => `/api/emergency/${vars.id}/finalize`,
    {
      onSuccess: (_data, vars) => {
        toast.success(t('patientStatusUpdated', { ns: 'emergency', status: t(vars.finalized_status, { ns: 'emergency' }) }));
        setFinalizeTarget(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.emergency.all });
      },
      onError: (err) => {
        toast.error(err.message || 'Failed');
      },
    },
  );

  const handleFinalize = (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalizeTarget) return;
    finalizeMutation.mutate({
      id: finalizeTarget.id,
      finalized_status: finalizeForm.finalized_status,
      finalized_remarks: finalizeForm.finalized_remarks,
    });
  };

  const openAdmission = (patient: ERPatient) => {
    if (!patient.patient_id) {
      toast.error('This emergency case is not linked to a patient record');
      return;
    }
    setAdmitTarget(patient);
    setAdmitForm({
      admission_reason: patient.condition_on_arrival ?? '',
      department: '',
      notes: '',
    });
    setAdmissionIdempotencyKey(createEmergencyAdmissionIdempotencyKey(patient.id));
  };

  const handleAdmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admitTarget?.patient_id || !admissionIdempotencyKey || admitting) return;

    setAdmitting(true);
    try {
      let admissionNo = admitTarget.active_admission_no ?? null;
      const hasActiveAdmission = Boolean(
        admitTarget.active_admission_id
          || admitTarget.active_admission_public_id
          || admitTarget.active_admission_no,
      );

      if (!hasActiveAdmission) {
        const admission = await api.post<AdmissionResponse>(
          '/api/admissions',
          buildEmergencyAdmissionPayload({
            patientId: admitTarget.patient_id,
            erPatientNumber: admitTarget.er_patient_number,
            conditionOnArrival: admitTarget.condition_on_arrival,
            admissionReason: admitForm.admission_reason,
            department: admitForm.department,
            notes: admitForm.notes,
            idempotencyKey: admissionIdempotencyKey,
          }),
        );
        admissionNo = admission.admission_no;
        setAdmitTarget(current => current?.id === admitTarget.id
          ? {
              ...current,
              active_admission_id: admission.admission_id,
              active_admission_no: admission.admission_no,
            }
          : current);
        await queryClient.invalidateQueries({ queryKey: queryKeys.emergency.all });
      }

      await api.put(`/api/emergency/${admitTarget.id}/finalize`, {
        finalized_status: 'admitted',
        finalized_remarks: admissionNo
          ? `Admitted to IPD (${admissionNo})`
          : 'Admitted to IPD',
      });

      toast.success(admissionNo ? `IPD admission created: ${admissionNo}` : 'IPD admission linked');
      queryClient.invalidateQueries({ queryKey: queryKeys.emergency.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      resetAdmissionForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Emergency admission failed');
    } finally {
      setAdmitting(false);
    }
  };

  const patientFullName = (p: ERPatient) =>
    p.patient_name ?? `${p.first_name} ${p.last_name}`.trim();

  // ── Render ──
  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Siren className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title', { ns: 'emergency' })}</h1>
              <p className="section-subtitle">{t('subtitle', { ns: 'emergency' })}</p>
            </div>
          </div>
          <button onClick={() => setShowRegister(true)} className="btn-primary">
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('registerPatient', { ns: 'emergency' })}</span>
          </button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard title={t('totalToday', { ns: 'emergency' })}  value={stats?.total_today ?? '—'}       loading={statsLoading} icon={<Activity className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('new', { ns: 'emergency' })}          value={stats?.new_patients ?? '—'}       loading={statsLoading} icon={<Clock className="w-5 h-5" />}    iconBg="bg-blue-50 text-blue-600"   index={1} />
          <KPICard title={t('triaged', { ns: 'emergency' })}      value={stats?.triaged_patients ?? '—'}   loading={statsLoading} icon={<Tag className="w-5 h-5" />}      iconBg="bg-amber-50 text-amber-600" index={2} />
          <KPICard title={t('admitted', { ns: 'emergency' })}     value={stats?.admitted_today ?? '—'}     loading={statsLoading} icon={<Plus className="w-5 h-5" />}     iconBg="bg-purple-50 text-purple-600" index={3} />
          <KPICard title={t('discharged', { ns: 'emergency' })}   value={stats?.discharged_today ?? '—'}   loading={statsLoading} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={4} />
          <KPICard title={t('lama', { ns: 'emergency' })}         value={stats?.lama_count ?? '—'}         loading={statsLoading} icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-rose-50 text-rose-600" index={5} />
        </div>

        {/* Filter & Search */}
        <div className="card p-3 flex flex-wrap items-center gap-3">
          {/* Status tabs */}
          <div className="flex gap-1 flex-wrap">
            {STATUS_TAB_KEYS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}
              >
                {t(tab.tKey, { ns: 'emergency' })}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('searchByName', { ns: 'emergency' })}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setSearch(searchInput); }}
              className="input pl-9"
            />
          </div>
          <button onClick={() => setSearch(searchInput)} className="btn-secondary">{t('search', { ns: 'common' })}</button>
          {search && (
            <button onClick={() => { setSearch(''); setSearchInput(''); }} className="btn-ghost text-sm">
              {t('close', { ns: 'common' })}
            </button>
          )}
        </div>

        {/* ER Patient List */}
        <div className="card overflow-hidden">

          {/* Mobile card list */}
          <div className="sm:hidden divide-y divide-[var(--color-border)]">
            {loading
              ? [...Array(4)].map((_, i) => (
                  <div key={i} className="flex gap-3 p-4">
                    <div className="flex-1 space-y-2"><div className="skeleton h-4 w-32" /><div className="skeleton h-3 w-20" /></div>
                    <div className="skeleton h-5 w-14 rounded-full" />
                  </div>
                ))
              : patients.length === 0
                ? <div className="py-10 flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                    <Siren className="w-8 h-8 opacity-30" />
                    <p className="text-sm">{t('noERPatients', { ns: 'emergency', defaultValue: 'No ER patients found' })}</p>
                    <button onClick={() => setShowRegister(true)} className="btn-primary text-sm"><UserPlus className="w-4 h-4" /></button>
                  </div>
                : patients.map(p => (
                    <div key={p.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{patientFullName(p)}</p>
                          <p className="text-xs text-[var(--color-text-muted)] font-data">{p.er_patient_number}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {p.triage_code
                            ? <span className={`badge ${TRIAGE_CONFIG[p.triage_code].cls}`}>{p.triage_code}</span>
                            : <span className="badge badge-neutral">—</span>
                          }
                          <span className={`badge ${
                            p.er_status === 'new' ? 'badge-info' :
                            p.er_status === 'triaged' ? 'badge-warning' :
                            p.finalized_status === 'admitted' ? 'badge-primary' :
                            p.finalized_status === 'discharged' ? 'badge-success' :
                            'badge-error'
                          }`}>
                            {p.er_status === 'finalized' ? (p.finalized_status ?? 'Finalized') : p.er_status}
                          </span>
                        </div>
                      </div>
                      <EmergencyPatientActions
                        patient={p}
                        onEdit={() => p.patient_id && navigate(emergencyPatientDetailsPath(p.patient_id))}
                        onAdmit={() => openAdmission(p)}
                        onTriage={() => setTriageTarget(p)}
                        onFinalize={() => {
                          setFinalizeTarget(p);
                          setFinalizeForm({ finalized_status: 'discharged', finalized_remarks: '' });
                        }}
                      />
                    </div>
                  ))
            }
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>ER #</th>
                  <th>Patient</th>
                  <th>Age / Gender</th>
                  <th>Arrival</th>
                  <th>Triage</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        {[...Array(7)].map((_, j) => (
                          <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                        ))}
                      </tr>
                    ))
                  : patients.length === 0
                  ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState
                            icon={<Siren className="w-8 h-8 text-[var(--color-text-muted)]" />}
                            title={t('noPatients', { ns: 'emergency', defaultValue: 'No ER patients' })}
                            description={t('noPatientsDesc', { ns: 'emergency', defaultValue: 'No emergency patients found for the current filters.' })}
                            action={
                              <button onClick={() => setShowRegister(true)} className="btn-primary mt-2">
                                <UserPlus className="w-4 h-4" /> {t('registerFirst', { ns: 'emergency', defaultValue: 'Register First Patient' })}
                              </button>
                            }
                          />
                        </td>
                      </tr>
                    )
                  : patients.map(p => (
                      <tr key={p.id}>
                        <td className="font-data font-medium">{p.er_patient_number}</td>
                        <td className="font-medium">{patientFullName(p)}</td>
                        <td className="text-[var(--color-text-secondary)]">
                          {p.age ? `${p.age}y` : '—'} {p.gender ? `/ ${p.gender}` : ''}
                        </td>
                        <td className="font-data text-sm text-[var(--color-text-secondary)]">
                          {p.visit_datetime ? new Date(p.visit_datetime).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}
                        </td>
                        <td>
                          {p.triage_code
                            ? <span className={`badge ${TRIAGE_CONFIG[p.triage_code].cls}`}>{t(TRIAGE_CONFIG[p.triage_code].labelKey, { ns: 'emergency' })}</span>
                            : <span className="text-[var(--color-text-muted)] text-sm">{t('notTriaged', { ns: 'emergency' })}</span>}
                        </td>
                        <td>
                          <span className={`badge ${
                            p.er_status === 'new'      ? 'badge-info' :
                            p.er_status === 'triaged'  ? 'badge-warning' :
                            p.finalized_status === 'admitted'   ? 'badge-primary' :
                            p.finalized_status === 'discharged' ? 'badge-success' :
                            'badge-error'
                          }`}>
                            {p.er_status === 'finalized' ? (p.finalized_status ?? 'Finalized') : p.er_status}
                          </span>
                        </td>
                        <td>
                          <EmergencyPatientActions
                            patient={p}
                            onEdit={() => p.patient_id && navigate(emergencyPatientDetailsPath(p.patient_id))}
                            onAdmit={() => openAdmission(p)}
                            onTriage={() => setTriageTarget(p)}
                            onFinalize={() => {
                              setFinalizeTarget(p);
                              setFinalizeForm({ finalized_status: 'discharged', finalized_remarks: '' });
                            }}
                          />
                        </td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─────────────── REGISTER PATIENT MODAL ─────────────── */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
              <h3 className="font-semibold">{t('registerPatient', { ns: 'emergency' })}</h3>
              <button onClick={() => setShowRegister(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Existing / New toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setIsExisting(false); setSelectedPatient(null); setPatientQuery(''); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${!isExisting ? 'bg-[var(--color-primary)] text-white' : 'btn-secondary'}`}
                >
                  {t('newPatient', { ns: 'emergency' })}
                </button>
                <button
                  type="button"
                  onClick={() => setIsExisting(true)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${isExisting ? 'bg-[var(--color-primary)] text-white' : 'btn-secondary'}`}
                >
                  {t('existingPatient', { ns: 'emergency' })}
                </button>
              </div>

              {/* Existing patient search */}
              {isExisting && (
                <div className="relative">
                  <label className="label">{t('searchPatient', { ns: 'emergency' })}</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                      className="input pl-9"
                      placeholder={t('searchPlaceholder', { ns: 'emergency' })}
                      value={patientQuery}
                      onChange={e => { setPatientQuery(e.target.value); setSelectedPatient(null); }}
                    />
                  </div>
                  {(searchingPt || patientResults.length > 0) && !selectedPatient && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-slate-700 border border-[var(--color-border)] rounded-xl shadow-lg overflow-hidden">
                      {searchingPt && <p className="p-3 text-sm text-[var(--color-text-muted)]">Searching…</p>}
                      {patientResults.map(pt => (
                        <button
                          key={pt.id}
                          type="button"
                          onClick={() => { setSelectedPatient(pt); setPatientQuery(pt.name); setRegisterForm(f => ({ ...f, first_name: pt.name.split(' ')[0], last_name: pt.name.split(' ').slice(1).join(' ') })); }}
                          className="w-full text-left px-4 py-2 hover:bg-[var(--color-border-light)] text-sm"
                        >
                          <span className="font-medium">{pt.name}</span>
                          <span className="ml-2 text-[var(--color-text-muted)]">{pt.patient_code}</span>
                          {pt.mobile && <span className="ml-2 text-[var(--color-text-muted)]">{pt.mobile}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedPatient && (
                    <p className="mt-1 text-sm text-emerald-600 font-medium">✓ Selected: {selectedPatient.name} ({selectedPatient.patient_code})</p>
                  )}
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('firstName', { ns: 'emergency' })}</label>
                    <input className="input" required value={registerForm.first_name} onChange={e => setRegisterForm(f => ({ ...f, first_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">{t('lastName', { ns: 'emergency' })}</label>
                    <input className="input" required value={registerForm.last_name} onChange={e => setRegisterForm(f => ({ ...f, last_name: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('age', { ns: 'emergency' })}</label>
                    <input className="input" type="number" min="0" max="150" value={registerForm.age} onChange={e => setRegisterForm(f => ({ ...f, age: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">{t('gender', { ns: 'emergency' })}</label>
                    <select className="input" value={registerForm.gender} onChange={e => setRegisterForm(f => ({ ...f, gender: e.target.value }))}>
                      <option value="">{t('common:select')}</option>
                      <option value="male">{t('common:male')}</option>
                      <option value="female">{t('common:female')}</option>
                      <option value="other">{t('common:other')}</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('contactNo', { ns: 'emergency' })}</label>
                    <input className="input" value={registerForm.contact_no} onChange={e => setRegisterForm(f => ({ ...f, contact_no: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">{t('caseType', { ns: 'emergency' })}</label>
                    <select className="input" value={registerForm.case_type} onChange={e => setRegisterForm(f => ({ ...f, case_type: e.target.value }))}>
                      <option value="medical">Medical</option>
                      <option value="surgical">Surgical</option>
                      <option value="obstetric">Obstetric</option>
                      <option value="trauma">Trauma</option>
                      <option value="poisoning">Poisoning</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">{t('conditionOnArrival', { ns: 'emergency' })}</label>
                  <input className="input" placeholder={t("conditionOnArrivalPlaceholder", { ns: 'emergency' })} value={registerForm.condition_on_arrival} onChange={e => setRegisterForm(f => ({ ...f, condition_on_arrival: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('address', { ns: 'emergency' })}</label>
                  <input className="input" value={registerForm.address} onChange={e => setRegisterForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowRegister(false)} className="btn-secondary">{t('cancel', { ns: 'emergency' })}</button>
                  <button type="submit" disabled={registerMutation.isPending || (isExisting && !selectedPatient)} className="btn-primary">
                    {registerMutation.isPending ? t('registering', { ns: 'emergency' }) : t('register', { ns: 'emergency' })}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────── TRIAGE MODAL ─────────────── */}
      {triageTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('assignTriage', { ns: 'emergency' })}</h3>
              <button onClick={() => setTriageTarget(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Patient: <span className="font-semibold text-[var(--color-text-primary)]">{patientFullName(triageTarget)}</span>
              </p>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">{t('selectTriage', { ns: 'emergency' })}</p>
              <div className="space-y-2">
                <button
                  onClick={() => handleTriage(triageTarget, 'red')}
                  className="w-full py-3 rounded-xl font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                >
                  🔴 {t('redCritical', { ns: 'emergency', defaultValue: 'Red — Critical (Immediate)' })}
                </button>
                <button
                  onClick={() => handleTriage(triageTarget, 'yellow')}
                  className="w-full py-3 rounded-xl font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                >
                  🟡 {t('yellowUrgent', { ns: 'emergency', defaultValue: 'Yellow — Urgent (Delayed)' })}
                </button>
                <button
                  onClick={() => handleTriage(triageTarget, 'green')}
                  className="w-full py-3 rounded-xl font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                >
                  🟢 {t('greenStandard', { ns: 'emergency', defaultValue: 'Green — Standard (Minor)' })}
                </button>
              </div>
              <button onClick={() => setTriageTarget(null)} className="btn-ghost w-full mt-2 text-sm">{t('cancel', { ns: 'common' })}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────── ADMIT TO IPD MODAL ─────────────── */}
      {admitTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <div>
                <h3 className="font-semibold">Admit Emergency Patient to IPD</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">
                  {patientFullName(admitTarget)} · {admitTarget.er_patient_number}
                </p>
              </div>
              <button onClick={resetAdmissionForm} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAdmission} className="p-5 space-y-4">
              {Boolean(admitTarget.profile_incomplete) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  Patient details are incomplete. Admission can continue now; use Edit / Complete Patient Details afterward to update the same patient record.
                </div>
              )}
              {admitTarget.active_admission_no && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                  Active admission {admitTarget.active_admission_no} already exists. This action will safely complete the ER linkage without creating a duplicate admission.
                </div>
              )}
              <div>
                <label className="label">Admission reason</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  value={admitForm.admission_reason}
                  onChange={e => setAdmitForm(form => ({ ...form, admission_reason: e.target.value }))}
                  placeholder="Clinical reason for inpatient admission"
                />
              </div>
              <div>
                <label className="label">Department / ward preference</label>
                <input
                  className="input"
                  value={admitForm.department}
                  onChange={e => setAdmitForm(form => ({ ...form, department: e.target.value }))}
                  placeholder="e.g. Medicine, Surgery, ICU"
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">A bed can be assigned or transferred later from IPD Admissions.</p>
              </div>
              <div>
                <label className="label">Admission notes</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  value={admitForm.notes}
                  onChange={e => setAdmitForm(form => ({ ...form, notes: e.target.value }))}
                  placeholder="ER treatment, handover, or special precautions"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={resetAdmissionForm} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={admitting || !admitTarget.patient_id} className="btn-primary">
                  <BedDouble className="w-4 h-4" />
                  {admitting
                    ? 'Creating admission…'
                    : (admitTarget.active_admission_id
                        || admitTarget.active_admission_public_id
                        || admitTarget.active_admission_no)
                      ? 'Complete Admission Link'
                      : 'Admit to IPD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────── FINALIZE MODAL ─────────────── */}
      {finalizeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('finalizePatient', { ns: 'emergency' })}</h3>
              <button onClick={() => setFinalizeTarget(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleFinalize} className="p-5 space-y-4">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Patient: <span className="font-semibold text-[var(--color-text-primary)]">{patientFullName(finalizeTarget)}</span>
              </p>
              <div>
                <label className="label">{t('outcome', { ns: 'emergency' })} *</label>
                <select
                  className="input"
                  value={finalizeForm.finalized_status}
                  onChange={e => setFinalizeForm(f => ({ ...f, finalized_status: e.target.value }))}
                  required
                >
                  {FINALIZE_OPTION_KEYS.map(opt => (
                    <option key={opt.value} value={opt.value}>{t(opt.tKey, { ns: 'emergency' })}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('remarks', { ns: 'emergency' })}</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  placeholder={t("emergency.optional_notes")}
                  value={finalizeForm.finalized_remarks}
                  onChange={e => setFinalizeForm(f => ({ ...f, finalized_remarks: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setFinalizeTarget(null)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={finalizeMutation.isPending} className="btn-primary">
                  {finalizeMutation.isPending ? t('finalizing', { ns: 'emergency', defaultValue: 'Saving…' }) : t('finalize', { ns: 'emergency', defaultValue: 'Finalize Patient' })}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

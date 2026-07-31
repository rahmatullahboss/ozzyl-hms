import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  Activity, Heart, AlertTriangle, Pill, FileText,
  ChevronRight, User, Phone, MapPin, Droplets, RefreshCw,
  FlaskConical, ClipboardList, Clock, Stethoscope, Image,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import VitalsPanel from '../../components/clinical/VitalsPanel';
import AllergyPanel from '../../components/clinical/AllergyPanel';
import ProblemListPanel from '../../components/clinical/ProblemListPanel';
import MedicationsPanel from '../../components/clinical/MedicationsPanel';
import { apiFetch } from '../../lib/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Patient {
  id: number;
  patient_code: string;
  uhid?: string | null;
  name: string;
  father_husband?: string;
  address: string;
  mobile: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  date_of_birth?: string;
  email?: string;
  created_at: string;
}

interface PatientResponse {
  patient: Patient;
}

interface Vital {
  id: number;
  temperature?: number;
  pulse?: number;
  systolic?: number;
  diastolic?: number;
  spo2?: number;
  recorded_at: string;
}

interface Allergy {
  id: number;
  allergen: string;
  severity: string;
  allergy_type: string;
}

interface Problem {
  id: number;
  description: string;
  icd10_code?: string;
  severity?: string;
  status: string;
}

interface Medication {
  id: number;
  medication_name: string;
  strength?: string;
  frequency?: string;
  status: string;
}

interface Prescription {
  id: number;
  rx_no: string;
  doctor_name?: string;
  status: string;
  created_at: string;
  item_count: number;
}

interface ClinicalNote {
  id: number;
  note_type: string;
  content: string;
  created_at: string;
  created_by?: string;
}

interface LabOrder {
  order_no: string;
  order_date: string;
  total_items: number;
  pending_items: number;
}

interface FamilyHistory {
  id: number;
  relationship: string;
  icd10_code?: string;
  note?: string;
}

interface SocialHistory {
  id: number;
  smoking_history?: string;
  alcohol_history?: string;
  drug_history?: string;
  occupation?: string;
}

interface SurgicalHistory {
  id: number;
  surgery_type: string;
  surgery_date?: string;
  icd10_code?: string;
}

interface ClinicalImage {
  ScannedImageId: number;
  ImageName: string;
  ImagePath: string;
  ImageType?: string;
}

// ─── Tab type ────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'clinical' | 'notes' | 'orders' | 'history' | 'documents';

// ─── Component ───────────────────────────────────────────────────────────────

export default function PatientOverview({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['clinical', 'patients', 'common']);
  const { id = '', slug = '' } = useParams<{ id: string; slug: string }>();

  const [tab, setTab] = useState<Tab>('overview');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);

  // Overview tab data
  const [latestVitals, setLatestVitals] = useState<Vital | null>(null);
  const [allergyCount, setAllergyCount] = useState(0);
  const [activeProblemCount, setActiveProblemCount] = useState(0);
  const [recentPrescriptions, setRecentPrescriptions] = useState<Prescription[]>([]);

  // Notes tab data
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteTypeFilter, setNoteTypeFilter] = useState('');

  // Orders tab data
  const [labOrders, setLabOrders] = useState<LabOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // History tab data
  const [familyHistory, setFamilyHistory] = useState<FamilyHistory[]>([]);
  const [socialHistory, setSocialHistory] = useState<SocialHistory[]>([]);
  const [surgicalHistory, setSurgicalHistory] = useState<SurgicalHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTab, setHistoryTab] = useState<'family' | 'social' | 'surgical'>('family');

  // Documents tab data
  const [clinicalImages, setClinicalImages] = useState<ClinicalImage[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);

  // ── Fetch patient data ──────────────────────────────────────────────

  const fetchPatient = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PatientResponse>(`/api/patients/${id}`);
      setPatient(data.patient);
    } catch {
      toast.error(t('toast.patientLoadFailed', { defaultValue: 'Failed to load patient' }));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchOverviewData = useCallback(async () => {
    if (!id) return;
    try {
      const [vitalsRes, allergiesRes, problemsRes, rxRes] = await Promise.allSettled([
        apiFetch<{ vitals?: Vital[] }>(`/api/clinical/vitals?patientId=${id}&limit=1`),
        apiFetch<{ allergies?: Allergy[] }>(`/api/clinical/allergies?patientId=${id}`),
        apiFetch<{ problems?: Problem[] }>(`/api/clinical/problems?patientId=${id}`),
        apiFetch<{ prescriptions?: Prescription[] }>(`/api/prescriptions?patient=${id}`),
      ]);
      if (vitalsRes.status === 'fulfilled') setLatestVitals(vitalsRes.value.vitals?.[0] ?? null);
      if (allergiesRes.status === 'fulfilled') setAllergyCount(allergiesRes.value.allergies?.length ?? 0);
      if (problemsRes.status === 'fulfilled') setActiveProblemCount(problemsRes.value.problems?.filter(p => p.status === 'active').length ?? 0);
      if (rxRes.status === 'fulfilled') setRecentPrescriptions((rxRes.value.prescriptions ?? []).slice(0, 5) as Prescription[]);
    } catch {
      // silent fail for overview
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchPatient();
      fetchOverviewData();
    }
  }, [fetchPatient, fetchOverviewData, id]);

  // ── Fetch tab-specific data ─────────────────────────────────────────

  const fetchNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      let url = `/api/clinical/notes?patientId=${id}`;
      if (noteTypeFilter) url += `&type=${noteTypeFilter}`;
      const data = await apiFetch<{ notes?: ClinicalNote[] }>(url);
      setNotes(data.notes || []);
    } catch {
      toast.error(t('toast.notesLoadFailed', { defaultValue: 'Failed to load notes' }));
    } finally {
      setNotesLoading(false);
    }
  }, [id, noteTypeFilter]);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const data = await apiFetch<{ orders?: LabOrder[] }>(`/api/lab/orders?patientId=${id}`);
      setLabOrders(data.orders || []);
    } catch {
      toast.error(t('toast.ordersLoadFailed', { defaultValue: 'Failed to load orders' }));
    } finally {
      setOrdersLoading(false);
    }
  }, [id]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [familyRes, socialRes, surgicalRes] = await Promise.allSettled([
        apiFetch<{ history?: FamilyHistory[] }>(`/api/clinical/history/family?patientId=${id}`),
        apiFetch<{ history?: SocialHistory[] }>(`/api/clinical/history/social?patientId=${id}`),
        apiFetch<{ history?: SurgicalHistory[] }>(`/api/clinical/history/surgical?patientId=${id}`),
      ]);
      if (familyRes.status === 'fulfilled') setFamilyHistory(familyRes.value.history || []);
      if (socialRes.status === 'fulfilled') setSocialHistory(socialRes.value.history || []);
      if (surgicalRes.status === 'fulfilled') setSurgicalHistory(surgicalRes.value.history || []);
    } catch {
      toast.error(t('toast.historyLoadFailed', { defaultValue: 'Failed to load history' }));
    } finally {
      setHistoryLoading(false);
    }
  }, [id]);

  const fetchDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    try {
      const data = await apiFetch<{ Results?: ClinicalImage[] }>(`/api/clinical-images?patientId=${id}`);
      setClinicalImages(data.Results || []);
    } catch {
      toast.error(t('toast.documentsLoadFailed', { defaultValue: 'Failed to load documents' }));
    } finally {
      setDocumentsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    if (tab === 'notes') fetchNotes();
    if (tab === 'orders') fetchOrders();
    if (tab === 'history') fetchHistory();
    if (tab === 'documents') fetchDocuments();
  }, [tab, id, fetchNotes, fetchOrders, fetchHistory, fetchDocuments]);

  // ── Helpers ─────────────────────────────────────────────────────────

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  function fmt(date: string | null | undefined) {
    if (!date) return '\u2014';
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? '\u2014' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ── Tab definitions ─────────────────────────────────────────────────

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: t('tabs.overview', { defaultValue: 'Overview' }), icon: <Activity className="w-4 h-4" /> },
    { id: 'clinical', label: t('tabs.clinical', { defaultValue: 'Clinical' }), icon: <Stethoscope className="w-4 h-4" /> },
    { id: 'notes', label: t('tabs.notes', { defaultValue: 'Notes' }), icon: <FileText className="w-4 h-4" /> },
    { id: 'orders', label: t('tabs.orders', { defaultValue: 'Orders' }), icon: <FlaskConical className="w-4 h-4" /> },
    { id: 'history', label: t('tabs.history', { defaultValue: 'History' }), icon: <Clock className="w-4 h-4" /> },
    { id: 'documents', label: t('tabs.documents', { defaultValue: 'Documents' }), icon: <Image className="w-4 h-4" /> },
  ];

  // ── Loading / Not found ─────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout role={role}>
        <div className="space-y-4 max-w-5xl mx-auto">
          <div className="skeleton h-10 w-64 rounded-lg" />
          <div className="skeleton h-44 w-full rounded-xl" />
          <div className="skeleton h-64 w-full rounded-xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (!patient) {
    return (
      <DashboardLayout role={role}>
        <div className="card p-12 text-center max-w-md mx-auto">
          <User className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-[var(--color-text-muted)]">{t('patientNotFound', { defaultValue: 'Patient not found.' })}</p>
          <Link to={`/h/${slug}/doctor/dashboard`} className="btn-primary mt-4 inline-block">&larr; {t('common.back', { defaultValue: 'Back' })}</Link>
        </div>
      </DashboardLayout>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  const v = latestVitals;

  return (
    <DashboardLayout role={role}>
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Breadcrumb */}
        <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
          <Link to={`/h/${slug}/doctor/dashboard`} className="hover:underline">{t('common.dashboard', { defaultValue: 'Dashboard' })}</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to={`/h/${slug}/doctor/queue`} className="hover:underline">{t('common.queue', { defaultValue: 'Queue' })}</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-[var(--color-text)] font-medium">{patient.name}</span>
        </div>

        {/* Patient Profile Card */}
        <div className="card p-5 border-l-4 border-l-[var(--color-primary)]">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-[var(--color-primary)] flex items-center justify-center shrink-0 text-white text-xl font-bold">
              {getInitials(patient.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-[var(--color-text)]">{patient.name}</h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  {patient.patient_code}
                </span>
                {patient.uhid && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                    UID: {patient.uhid}
                  </span>
                )}
                {patient.blood_group && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                    <Droplets className="w-3 h-3" /> {patient.blood_group}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3 text-sm">
                {patient.age && patient.gender && (
                  <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span>{patient.age}y &middot; {patient.gender}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <Phone className="w-3.5 h-3.5 shrink-0" />
                  <span>{patient.mobile}</span>
                </div>
                {patient.address && (
                  <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{patient.address}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => { fetchPatient(); fetchOverviewData(); }} className="btn-ghost p-2" aria-label="Refresh">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto border-b border-[var(--color-border)] -mb-px">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                tab === t.id
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="min-h-[300px]">

          {/* ═══ Overview ═══ */}
          {tab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              {/* Left: Demographics + Latest Vitals */}
              <div className="lg:col-span-3 space-y-5">
                {/* Demographics */}
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('sections.personalDetails', { defaultValue: 'Personal Details' })}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    {[
                      { label: t('fields.dateOfBirth', { defaultValue: 'Date of Birth' }), value: patient.date_of_birth ? fmt(patient.date_of_birth) : '\u2014' },
                      { label: t('fields.fatherHusband', { defaultValue: 'Father/Husband' }), value: patient.father_husband || '\u2014' },
                      { label: t('fields.address', { defaultValue: 'Address' }), value: patient.address || '\u2014' },
                      { label: t('fields.email', { defaultValue: 'Email' }), value: patient.email || '\u2014' },
                      { label: t('fields.registered', { defaultValue: 'Registered' }), value: fmt(patient.created_at) },
                    ].map(d => (
                      <div key={d.label}>
                        <span className="text-[var(--color-text-muted)] text-xs">{d.label}</span>
                        <p className="text-[var(--color-text)] font-medium">{d.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Latest Vitals */}
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                    <Heart className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('sections.latestVitals', { defaultValue: 'Latest Vitals' })}
                  </h3>
                  {v ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {v.temperature != null && (
                        <div className="text-center py-3 rounded-xl bg-[var(--color-bg)]">
                          <p className="text-xl font-bold text-[var(--color-text)]">{v.temperature}&deg;C</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{t('vitals.temperature', { defaultValue: 'Temperature' })}</p>
                        </div>
                      )}
                      {v.pulse != null && (
                        <div className="text-center py-3 rounded-xl bg-[var(--color-bg)]">
                          <p className="text-xl font-bold text-[var(--color-text)]">{v.pulse}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{t('vitals.pulse', { defaultValue: 'Pulse (bpm)' })}</p>
                        </div>
                      )}
                      {v.systolic != null && v.diastolic != null && (
                        <div className="text-center py-3 rounded-xl bg-[var(--color-bg)]">
                          <p className="text-xl font-bold text-[var(--color-text)]">{v.systolic}/{v.diastolic}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{t('vitals.bp', { defaultValue: 'BP (mmHg)' })}</p>
                        </div>
                      )}
                      {v.spo2 != null && (
                        <div className="text-center py-3 rounded-xl bg-[var(--color-bg)]">
                          <p className="text-xl font-bold text-[var(--color-text)]">{v.spo2}%</p>
                          <p className="text-xs text-[var(--color-text-muted)]">SpO&#x2082;</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-text-muted)]">{t('vitals.none', { defaultValue: 'No vitals recorded' })}</p>
                  )}
                </div>
              </div>

              {/* Right: Badges + Recent Prescriptions */}
              <div className="lg:col-span-2 space-y-5">
                {/* Quick Badges */}
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('sections.quickStats', { defaultValue: 'Quick Stats' })}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setTab('clinical')}
                      className="text-center py-3 rounded-xl bg-[var(--color-bg)] hover:ring-2 hover:ring-[var(--color-primary)] transition-all cursor-pointer"
                    >
                      <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                      <p className="text-xl font-bold text-[var(--color-text)]">{allergyCount}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('sections.allergies', { defaultValue: 'Allergies' })}</p>
                    </button>
                    <button
                      onClick={() => setTab('clinical')}
                      className="text-center py-3 rounded-xl bg-[var(--color-bg)] hover:ring-2 hover:ring-[var(--color-primary)] transition-all cursor-pointer"
                    >
                      <ClipboardList className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                      <p className="text-xl font-bold text-[var(--color-text)]">{activeProblemCount}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('sections.activeProblems', { defaultValue: 'Active Problems' })}</p>
                    </button>
                  </div>
                </div>

                {/* Recent Prescriptions */}
                {recentPrescriptions.length > 0 && (
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                      <Pill className="w-4 h-4 text-[var(--color-primary)]" />
                      {t('sections.recentPrescriptions', { defaultValue: 'Recent Prescriptions' })}
                    </h3>
                    <div className="space-y-2">
                      {recentPrescriptions.map(rx => (
                        <Link key={rx.id} to={`/h/${slug}/doctor/prescriptions/${rx.id}`}
                          className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--color-bg)] transition-colors">
                          <div>
                            <p className="text-sm font-mono font-medium text-[var(--color-primary)]">{rx.rx_no}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{rx.doctor_name || '\u2014'}</p>
                          </div>
                          <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                            rx.status === 'final' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {rx.status}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ Clinical ═══ */}
          {tab === 'clinical' && (
            <div className="space-y-8">
              <VitalsPanel patientId={id} />
              <AllergyPanel patientId={id} />
              <ProblemListPanel patientId={id} />
              <MedicationsPanel patientId={id} />
            </div>
          )}

          {/* ═══ Notes ═══ */}
          {tab === 'notes' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="section-title flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('notes.title', { defaultValue: 'Clinical Notes' })}
                </h3>
                <div className="flex gap-2">
                  <select value={noteTypeFilter} onChange={e => setNoteTypeFilter(e.target.value)} className="input text-sm w-36">
                    <option value="">{t('notes.allTypes', { defaultValue: 'All Types' })}</option>
                    <option value="progress">{t('notes.progress', { defaultValue: 'Progress' })}</option>
                    <option value="admission">{t('notes.admission', { defaultValue: 'Admission' })}</option>
                    <option value="discharge">{t('notes.discharge', { defaultValue: 'Discharge' })}</option>
                    <option value="consultation">{t('notes.consultation', { defaultValue: 'Consultation' })}</option>
                    <option value="procedure">{t('notes.procedure', { defaultValue: 'Procedure' })}</option>
                  </select>
                  <button onClick={fetchNotes} className="btn-ghost" title={t('common.refresh', { defaultValue: 'Refresh' })}>
                    <RefreshCw className={`w-4 h-4 ${notesLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {notesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="skeleton h-24 w-full rounded-lg" />)}
                </div>
              ) : notes.length === 0 ? (
                <div className="card p-12 text-center">
                  <FileText className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                  <p className="text-[var(--color-text-muted)]">{t('notes.none', { defaultValue: 'No clinical notes' })}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('notes.createHint', { defaultValue: 'Notes can be created from the chart workspace (Phase 2)' })}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {notes.map(n => (
                    <div key={n.id} className="card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="badge bg-blue-100 text-blue-700 capitalize">{n.note_type}</span>
                          <span className="text-xs text-[var(--color-text-muted)]">{fmt(n.created_at)}</span>
                        </div>
                        {n.created_by && <span className="text-xs text-[var(--color-text-muted)]">{n.created_by}</span>}
                      </div>
                      <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{n.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Orders ═══ */}
          {tab === 'orders' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="section-title flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('orders.title', { defaultValue: 'Orders' })}
                </h3>
                <button onClick={fetchOrders} className="btn-ghost" title={t('common.refresh', { defaultValue: 'Refresh' })}>
                  <RefreshCw className={`w-4 h-4 ${ordersLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {ordersLoading ? (
                <div className="skeleton h-64 w-full rounded-xl" />
              ) : labOrders.length === 0 ? (
                <div className="card p-12 text-center">
                  <FlaskConical className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                  <p className="text-[var(--color-text-muted)]">{t('orders.none', { defaultValue: 'No orders found' })}</p>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-bg)]">
                      <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                        <th className="text-left px-4 py-3 font-medium">{t('orders.orderNo', { defaultValue: 'Order #' })}</th>
                        <th className="text-left px-4 py-3 font-medium">{t('orders.tests', { defaultValue: 'Tests' })}</th>
                        <th className="text-left px-4 py-3 font-medium">{t('orders.date', { defaultValue: 'Date' })}</th>
                        <th className="text-center px-4 py-3 font-medium">{t('orders.status', { defaultValue: 'Status' })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {labOrders.map(o => (
                        <tr key={o.order_no} className="hover:bg-[var(--color-bg)] transition-colors">
                          <td className="px-4 py-3 font-mono font-medium text-[var(--color-primary)]">{o.order_no}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{o.total_items} test(s)</span>
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs">{fmt(o.order_date)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                              o.pending_items === 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {o.pending_items === 0 ? t('orders.completed', { defaultValue: 'Completed' }) : `${o.pending_items} pending`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ═══ History ═══ */}
          {tab === 'history' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="section-title flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('history.title', { defaultValue: 'Patient History' })}
                </h3>
                <button onClick={fetchHistory} className="btn-ghost" title={t('common.refresh', { defaultValue: 'Refresh' })}>
                  <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Sub-tabs */}
              <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
                {(['family', 'social', 'surgical'] as const).map((ht) => (
                  <button
                    key={ht}
                    onClick={() => setHistoryTab(ht)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize ${
                      historyTab === ht
                        ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {t(`history.${ht}`, { defaultValue: ht })}
                  </button>
                ))}
              </div>

              {historyLoading ? (
                <div className="skeleton h-48 w-full rounded-xl" />
              ) : (
                <>
                  {/* Family History */}
                  {historyTab === 'family' && (
                    <div className="card overflow-hidden">
                      {familyHistory.length === 0 ? (
                        <div className="p-8 text-center text-[var(--color-text-muted)]">{t('history.none', { defaultValue: 'No records' })}</div>
                      ) : (
                        <table className="table-base">
                          <thead>
                            <tr>
                              <th>{t('history.relationship', { defaultValue: 'Relationship' })}</th>
                              <th>{t('problems.icd10', { defaultValue: 'ICD-10' })}</th>
                              <th>{t('history.notes', { defaultValue: 'Notes' })}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {familyHistory.map(r => (
                              <tr key={r.id}>
                                <td className="font-medium">{r.relationship}</td>
                                <td className="font-mono text-xs">{r.icd10_code || '\u2014'}</td>
                                <td className="text-[var(--color-text-muted)]">{r.note || '\u2014'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* Social History */}
                  {historyTab === 'social' && (
                    <div className="card overflow-hidden">
                      {socialHistory.length === 0 ? (
                        <div className="p-8 text-center text-[var(--color-text-muted)]">{t('history.none', { defaultValue: 'No records' })}</div>
                      ) : (
                        <table className="table-base">
                          <thead>
                            <tr>
                              <th>{t('history.smoking', { defaultValue: 'Smoking' })}</th>
                              <th>{t('history.alcohol', { defaultValue: 'Alcohol' })}</th>
                              <th>{t('history.drug', { defaultValue: 'Drug' })}</th>
                              <th>{t('history.occupation', { defaultValue: 'Occupation' })}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {socialHistory.map(r => (
                              <tr key={r.id}>
                                <td>{r.smoking_history || '\u2014'}</td>
                                <td>{r.alcohol_history || '\u2014'}</td>
                                <td>{r.drug_history || '\u2014'}</td>
                                <td>{r.occupation || '\u2014'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {/* Surgical History */}
                  {historyTab === 'surgical' && (
                    <div className="card overflow-hidden">
                      {surgicalHistory.length === 0 ? (
                        <div className="p-8 text-center text-[var(--color-text-muted)]">{t('history.none', { defaultValue: 'No records' })}</div>
                      ) : (
                        <table className="table-base">
                          <thead>
                            <tr>
                              <th>{t('history.surgeryType', { defaultValue: 'Surgery' })}</th>
                              <th>{t('history.surgeryDate', { defaultValue: 'Date' })}</th>
                              <th>{t('problems.icd10', { defaultValue: 'ICD-10' })}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {surgicalHistory.map(r => (
                              <tr key={r.id}>
                                <td className="font-medium">{r.surgery_type}</td>
                                <td>{r.surgery_date ? fmt(r.surgery_date) : '\u2014'}</td>
                                <td className="font-mono text-xs">{r.icd10_code || '\u2014'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══ Documents ═══ */}
          {tab === 'documents' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="section-title flex items-center gap-2">
                  <Image className="w-4 h-4 text-[var(--color-primary)]" />
                  {t('documents.title', { defaultValue: 'Clinical Images' })}
                </h3>
                <button onClick={fetchDocuments} className="btn-ghost" title={t('common.refresh', { defaultValue: 'Refresh' })}>
                  <RefreshCw className={`w-4 h-4 ${documentsLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {documentsLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map(i => <div key={i} className="skeleton aspect-square rounded-lg" />)}
                </div>
              ) : clinicalImages.length === 0 ? (
                <div className="card p-12 text-center">
                  <Image className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                  <p className="text-[var(--color-text-muted)]">{t('documents.none', { defaultValue: 'No clinical images' })}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {clinicalImages.map(img => (
                    <div key={img.ScannedImageId} className="card overflow-hidden">
                      <div className="aspect-square bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                        <img src={img.ImagePath} alt={img.ImageName} className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium truncate">{img.ImageName}</p>
                        {img.ImageType && <span className="text-xs text-[var(--color-text-muted)]">{img.ImageType}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </DashboardLayout>
  );
}

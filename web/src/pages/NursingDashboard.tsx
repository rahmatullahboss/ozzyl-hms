import { useState, useEffect } from 'react';
import {
  Stethoscope, Plus, X, Search, RefreshCw, Trash2, Edit3,
  ClipboardList, FileText, Pill, Droplets, Activity, Syringe, Heart,
  ArrowRightLeft, Users, ChevronRight, CheckCircle, Clock, AlertCircle,
  BedDouble, Star, Bell, Zap, Clipboard,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { TFunction } from 'i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import MARTab from '../components/nursing/MARTab';
import MedicationOrdersTab from '../components/nursing/MedicationOrdersTab';
import ReconciliationTab from '../components/nursing/ReconciliationTab';
import IOChartsTab from '../components/nursing/IOChartsTab';
import ClinicalSummaryTab from '../components/nursing/ClinicalSummaryTab';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Patient {
  patient_id: number;
  patient_code: string;
  name: string;
  gender?: string;
  mobile?: string;
  admission_id: number;
  admission_date: string;
  admission_status: string;
  visit_id?: number;
  doctor_name?: string;
}

interface Ward {
  id: number;
  name: string;
  ward_type?: string;
  floor?: string;
  total_beds: number;
  occupied_beds: number;
}

interface NursingRecord {
  id: number;
  patient_id: number;
  visit_id?: number;
  created_at: string;
  created_by?: number;
  [key: string]: unknown;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
}

interface OPDVisit {
  id: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  doctor_name?: string;
  visit_date: string;
  status: string;
}

interface PatientsResponse {
  Results: Patient[];
}

interface RecordsResponse {
  Results: NursingRecord[];
  pagination?: Pagination;
}

interface OPDResponse {
  Results: OPDVisit[];
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { key: 'overview',           labelKey: 'tabs.overview',       icon: <Users className="w-4 h-4" /> },
  { key: 'care-plan',          labelKey: 'tabs.care-plan',     icon: <ClipboardList className="w-4 h-4" /> },
  { key: 'notes',              labelKey: 'tabs.notes',          icon: <FileText className="w-4 h-4" /> },
  { key: 'mar',                labelKey: 'tabs.mar',            icon: <Pill className="w-4 h-4" /> },
  { key: 'medication-orders',  labelKey: 'tabs.medication-orders',     icon: <ClipboardList className="w-4 h-4" /> },
  { key: 'reconciliation',     labelKey: 'tabs.reconciliation', icon: <ArrowRightLeft className="w-4 h-4" /> },
  { key: 'io',                 labelKey: 'tabs.io',            icon: <Droplets className="w-4 h-4" /> },
  { key: 'monitoring',         labelKey: 'tabs.monitoring',     icon: <Activity className="w-4 h-4" /> },
  { key: 'iv-drugs',           labelKey: 'tabs.iv-drugs',       icon: <Syringe className="w-4 h-4" /> },
  { key: 'wound-care',         labelKey: 'tabs.wound-care',     icon: <Heart className="w-4 h-4" /> },
  { key: 'handover',           labelKey: 'tabs.handover',       icon: <ArrowRightLeft className="w-4 h-4" /> },
  { key: 'clinical-summary',   labelKey: 'tabs.clinicalSummary', icon: <Clipboard className="w-4 h-4" /> },
  { key: 'wards',              labelKey: 'tabs.wards',          icon: <BedDouble className="w-4 h-4" /> },
  { key: 'opd',                labelKey: 'tabs.opd',            icon: <Stethoscope className="w-4 h-4" /> },
] as const;

type TabKey = typeof TABS[number]['key'];

// ─── Field config for CRUD tabs ───────────────────────────────────────────────

interface FieldDef {
  key: string;
  labelKey: string;
  type: 'text' | 'number' | 'textarea' | 'select';
  required?: boolean;
  options?: string[];
  placeholderKey?: string;
  optionLabelPrefix?: string;
}

const TAB_FIELDS: Record<string, { createFields: FieldDef[]; displayCols: string[] }> = {
  'care-plan': {
    createFields: [
      { key: 'problem', labelKey: 'problem', type: 'textarea', required: true, placeholderKey: 'placeholders.problem' },
      { key: 'goal', labelKey: 'goal', type: 'textarea', placeholderKey: 'placeholders.goal' },
      { key: 'intervention', labelKey: 'intervention', type: 'textarea', placeholderKey: 'placeholders.intervention' },
      { key: 'evaluation', labelKey: 'evaluation', type: 'textarea', placeholderKey: 'placeholders.evaluation' },
    ],
    displayCols: ['problem', 'goal', 'intervention', 'evaluation'],
  },
  'notes': {
    createFields: [
      { key: 'note_type', labelKey: 'note_type', type: 'select', options: ['general', 'assessment', 'progress', 'procedure'], required: true, optionLabelPrefix: 'options.note_type' },
      { key: 'note', labelKey: 'content', type: 'textarea', required: true, placeholderKey: 'placeholders.content' },
    ],
    displayCols: ['note_type', 'note'],
  },
  'mar': {
    createFields: [
      { key: 'drug_name', labelKey: 'drug_name', type: 'text', required: true, placeholderKey: 'placeholders.drug_name' },
      { key: 'dose', labelKey: 'dose', type: 'text', required: true, placeholderKey: 'placeholders.dose' },
      { key: 'route', labelKey: 'route', type: 'select', options: ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation'], required: true, optionLabelPrefix: 'routes' },
      { key: 'frequency', labelKey: 'frequency', type: 'text', placeholderKey: 'placeholders.frequency' },
      { key: 'administered_at', labelKey: 'mar.actualTime', type: 'text', placeholderKey: 'placeholders.administered_at' },
      { key: 'status', labelKey: 'mar.status', type: 'select', options: ['given', 'late', 'withheld', 'refused', 'hold', 'not_available', 'cancelled', 'pending'], optionLabelPrefix: 'options.mar_status' },
    ],
    displayCols: ['drug_name', 'dose', 'route', 'status'],
  },
  'io': {
    createFields: [
      { key: 'io_type', labelKey: 'io_type', type: 'select', options: ['intake', 'output'], required: true, optionLabelPrefix: 'io' },
      { key: 'item_name', labelKey: 'item_name', type: 'text', required: true, placeholderKey: 'placeholders.item_name' },
      { key: 'quantity_ml', labelKey: 'quantity_ml', type: 'number', required: true, placeholderKey: 'placeholders.quantity_ml' },
      { key: 'remarks', labelKey: 'remarks', type: 'text', placeholderKey: 'placeholders.remarks' },
    ],
    displayCols: ['io_type', 'item_name', 'quantity_ml', 'remarks'],
  },
  'monitoring': {
    createFields: [
      { key: 'temperature', labelKey: 'temp_f', type: 'number', placeholderKey: '986' },
      { key: 'pulse', labelKey: 'pulse', type: 'number', placeholderKey: '72' },
      { key: 'bp_systolic', labelKey: 'systolic', type: 'number', placeholderKey: '120' },
      { key: 'bp_diastolic', labelKey: 'diastolic', type: 'number', placeholderKey: '80' },
      { key: 'spo2', labelKey: 'spo2', type: 'number', placeholderKey: '98' },
      { key: 'remarks', labelKey: 'remarks', type: 'text', placeholderKey: 'placeholders.monitoring_remarks' },
    ],
    displayCols: ['temperature', 'pulse', 'bp_systolic', 'bp_diastolic', 'spo2'],
  },
  'iv-drugs': {
    createFields: [
      { key: 'drug_name', labelKey: 'drug_name', type: 'text', required: true, placeholderKey: 'placeholders.iv_drug_name' },
      { key: 'dosing', labelKey: 'dose', type: 'text', required: true, placeholderKey: 'placeholders.iv_dose' },
      { key: 'rate', labelKey: 'rate', type: 'text', placeholderKey: 'placeholders.iv_rate' },
      { key: 'start_time', labelKey: 'started_at', type: 'text', placeholderKey: 'placeholders.started_at' },
      { key: 'status', labelKey: 'mar.status', type: 'select', options: ['running', 'completed', 'stopped'], optionLabelPrefix: 'options.iv_status' },
    ],
    displayCols: ['drug_name', 'dosing', 'rate', 'status'],
  },
  'wound-care': {
    createFields: [
      { key: 'wound_site', labelKey: 'wound_location', type: 'text', required: true, placeholderKey: 'placeholders.wound_location' },
      { key: 'wound_type', labelKey: 'wound_type', type: 'select', options: ['surgical', 'pressure', 'traumatic', 'burn', 'diabetic', 'other'], required: true, optionLabelPrefix: 'options.wound_type' },
      { key: 'size', labelKey: 'wound_size', type: 'text', placeholderKey: 'placeholders.wound_size' },
      { key: 'treatment', labelKey: 'dressing_type', type: 'text', placeholderKey: 'placeholders.dressing_type' },
      { key: 'remarks', labelKey: 'remarks', type: 'textarea', placeholderKey: 'placeholders.remarks' },
    ],
    displayCols: ['wound_site', 'wound_type', 'size', 'treatment'],
  },
  'handover': {
    createFields: [
      { key: 'shift', labelKey: 'shift', type: 'select', options: ['morning', 'evening', 'night'], required: true, optionLabelPrefix: 'options.shift' },
      { key: 'given_by', labelKey: 'given_by', type: 'number', placeholderKey: 'nurse' },
      { key: 'taken_by', labelKey: 'taken_by', type: 'number', placeholderKey: 'nurse' },
      { key: 'situation', labelKey: 'sbar.situation', type: 'textarea', required: true, placeholderKey: 'sbar.situationHint' },
      { key: 'background', labelKey: 'sbar.background', type: 'textarea', placeholderKey: 'sbar.backgroundHint' },
      { key: 'assessment', labelKey: 'sbar.assessment', type: 'textarea', placeholderKey: 'sbar.assessmentHint' },
      { key: 'recommendation', labelKey: 'sbar.recommendation', type: 'textarea', placeholderKey: 'sbar.recommendationHint' },
      { key: 'content', labelKey: 'sbar.additionalNotes', type: 'textarea', placeholderKey: 'placeholders.handover_notes' },
    ],
    displayCols: ['shift', 'situation', 'assessment', 'content'],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(t: TFunction, dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('time.justNow', { ns: 'nursing' });
  if (mins < 60) return t('time.mAgo', { ns: 'nursing', count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('time.hAgo', { ns: 'nursing', count: hrs });
  return t('time.dAgo', { ns: 'nursing', count: Math.floor(hrs / 24) });
}

function truncate(s: unknown, n = 50): string {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ─── Clinical MAR tabs have their own internal fetching ──
const CLINICAL_TABS = ['mar', 'medication-orders', 'reconciliation', 'io', 'clinical-summary'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NursingDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [selectedPatient, setSelectedPatient] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  // OPD state
  const [opdDates, setOpdDates] = useState({
    from_date: new Date().toISOString().split('T')[0],
    to_date: new Date().toISOString().split('T')[0],
  });

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});

  // Check-in chief complaint modal
  const [checkInVisitId, setCheckInVisitId] = useState<number | null>(null);
  const [chiefComplaint, setChiefComplaint] = useState('');

  // Reset page when tab or patient filter changes
  useEffect(() => {
    setPage(1);
  }, [activeTab, selectedPatient]);

  // ── Determine which CRUD tab is active (non-clinical, has TAB_FIELDS) ──
  const isCrudTab = !!TAB_FIELDS[activeTab] && !CLINICAL_TABS.includes(activeTab);

  // ── Queries ──

  // Patients — needed for overview, CRUD tabs, and clinical tabs (patient selector)
  const patientsQuery = useApiQuery<PatientsResponse>(
    queryKeys.nursing.patients(),
    '/api/nursing/patients',
    { enabled: activeTab !== 'opd' },
  );
  const patients = patientsQuery.data?.Results ?? [];

  // Records — only for CRUD tabs (care-plan, notes, io, monitoring, iv-drugs, wound-care, handover)
  const recordsParams = new URLSearchParams({ page: String(page), limit: '20' });
  if (selectedPatient) recordsParams.set('patient_id', String(selectedPatient));
  const recordsQuery = useApiQuery<RecordsResponse>(
    queryKeys.nursing.records(activeTab, selectedPatient ?? undefined),
    `/api/nursing/${activeTab}?${recordsParams.toString()}`,
    { enabled: isCrudTab },
  );
  const records = recordsQuery.data?.Results ?? [];
  const pagination: Pagination = recordsQuery.data?.pagination ?? { page, limit: 20, total: records.length };

  // OPD visits
  const opdParams = new URLSearchParams({ from_date: opdDates.from_date, to_date: opdDates.to_date, limit: '50' });
  const opdQuery = useApiQuery<OPDResponse>(
    [...queryKeys.nursing.opd(), opdDates.from_date, opdDates.to_date],
    `/api/nursing/opd/visits?${opdParams.toString()}`,
    { enabled: activeTab === 'opd' },
  );
  const opdVisits = opdQuery.data?.Results ?? [];

  // Wards
  const wardsQuery = useApiQuery<{ Results: Ward[] }>(
    queryKeys.nursing.wards(),
    '/api/nursing/wards',
    { enabled: activeTab === 'wards' },
  );
  const wards = wardsQuery.data?.Results ?? [];

  // Favourites
  const favouritesQuery = useApiQuery<{ Results: { patient_id: number; patient_name: string; patient_code: string }[] }>(
    queryKeys.nursing.favourites(),
    '/api/nursing/favourites',
  );
  const favouriteIds = new Set((favouritesQuery.data?.Results ?? []).map(f => f.patient_id));

  // Clinical summary
  const clinicalSummaryQuery = useApiQuery<{ Results: Record<string, unknown> }>(
    queryKeys.nursing.clinicalSummary(selectedPatient ?? 0),
    `/api/nursing/clinical-summary/${selectedPatient}`,
    { enabled: activeTab === 'clinical-summary' && !!selectedPatient },
  );
  const clinicalData = clinicalSummaryQuery.data?.Results;

  // Medication due reminders
  const medDueQuery = useApiQuery<{ Results: Record<string, unknown>[]; summary: { overdue: number; upcoming: number; total: number } }>(
    queryKeys.nursing.medicationDue(),
    '/api/nursing/medication-due',
  );
  const medDueSummary = medDueQuery.data?.summary ?? { overdue: 0, upcoming: 0, total: 0 };
  const medDueList = medDueQuery.data?.Results ?? [];

  // ── Derived loading states ──
  const loading =
    (activeTab === 'overview' && patientsQuery.isLoading) ||
    (isCrudTab && recordsQuery.isLoading) ||
    (activeTab === 'opd' && opdQuery.isLoading) ||
    (activeTab === 'wards' && wardsQuery.isLoading);

  // ── Mutations ──

  // Create record
  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    `/api/nursing/${activeTab}`,
    {
      onSuccess: () => {
        toast.success(t('createdSuccessfully', { ns: 'nursing', defaultValue: 'Created successfully' }));
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.records(activeTab, selectedPatient ?? undefined) });
      },
      onError: (err) => {
        toast.error(err.message || 'Failed');
      },
    },
  );

  // Update record
  const updateMutation = useApiMutation<unknown, Record<string, unknown> & { _id: number }>(
    'put',
    (vars) => `/api/nursing/${activeTab}/${vars._id}`,
    {
      onSuccess: () => {
        toast.success(t('updatedSuccessfully', { ns: 'nursing', defaultValue: 'Updated successfully' }));
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.records(activeTab, selectedPatient ?? undefined) });
      },
      onError: (err) => {
        toast.error(err.message || 'Failed');
      },
    },
  );

  // Delete record
  const deleteMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/nursing/${activeTab}/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('deleted', { ns: 'nursing', defaultValue: 'Deleted' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.records(activeTab, selectedPatient ?? undefined) });
      },
      onError: () => {
        toast.error(t('deleteFailed', { ns: 'nursing', defaultValue: 'Delete failed' }));
      },
    },
  );

  // OPD check-in
  const checkInMutation = useApiMutation<unknown, { visit_id: number; chief_complaint?: string }>(
    'put',
    '/api/nursing/opd/check-in',
    {
      onSuccess: () => {
        toast.success(t('checkedIn', { ns: 'nursing', defaultValue: 'Checked in' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.opd() });
      },
      onError: (err) => {
        toast.error(err.message || t('checkInFailed', { ns: 'nursing', defaultValue: 'Check-in failed' }));
      },
    },
  );

  // OPD check-out
  const checkOutMutation = useApiMutation<unknown, { visit_id: number }>(
    'put',
    '/api/nursing/opd/check-out',
    {
      onSuccess: () => {
        toast.success(t('checkedOut', { ns: 'nursing', defaultValue: 'Checked out' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.opd() });
      },
      onError: (err) => {
        toast.error(err.message || t('checkOutFailed', { ns: 'nursing', defaultValue: 'Check-out failed' }));
      },
    },
  );

  // Add favourite
  const addFavMutation = useApiMutation<unknown, { patient_id: number }>(
    'post', '/api/nursing/favourites',
    { onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.nursing.favourites() }); } },
  );
  // Remove favourite
  const removeFavMutation = useApiMutation<unknown, { _patientId: number }>(
    'delete', (v) => `/api/nursing/favourites/${v._patientId}`,
    { onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.nursing.favourites() }); } },
  );

  const finalDiagnosisMutation = useApiMutation<unknown, { visit_id: number; patient_id: number; final_diagnosis: string; icd10_code?: string }>(
    'post',
    '/api/nursing/final-diagnosis',
    { onSuccess: () => toast.success('Final diagnosis saved'), onError: (err) => toast.error(err.message || 'Failed to save diagnosis') },
  );

  const referMutation = useApiMutation<unknown, { visit_id: number; to_doctor_id?: number; to_department_id?: number; reason?: string }>(
    'post',
    '/api/nursing/opd/refer',
    { onSuccess: () => { toast.success('Patient referred'); queryClient.invalidateQueries({ queryKey: queryKeys.nursing.opd() }); }, onError: (err) => toast.error(err.message || 'Failed to refer patient') },
  );

  const toggleFavourite = (patientId: number) => {
    if (favouriteIds.has(patientId)) {
      removeFavMutation.mutate({ _patientId: patientId });
    } else {
      addFavMutation.mutate({ patient_id: patientId });
    }
  };

  const handleFinalDiagnosis = (visit: OPDVisit) => {
    const diagnosis = window.prompt('Final diagnosis');
    if (!diagnosis?.trim()) return;
    finalDiagnosisMutation.mutate({ visit_id: visit.id, patient_id: visit.patient_id, final_diagnosis: diagnosis.trim() });
  };

  const handleRefer = (visit: OPDVisit) => {
    const departmentId = window.prompt('Refer to department ID');
    if (!departmentId) return;
    const reason = window.prompt('Referral reason') ?? undefined;
    referMutation.mutate({ visit_id: visit.id, to_department_id: Number(departmentId), reason });
  };

  // ── CRUD handlers ──
  const handleCreate = () => {
    setEditingId(null);
    setFormData({});
    setShowModal(true);
  };

  const handleEdit = (record: NursingRecord) => {
    setEditingId(record.id);
    const fields = TAB_FIELDS[activeTab]?.createFields ?? [];
    const data: Record<string, string> = {};
    fields.forEach(f => { data[f.key] = String(record[f.key] ?? ''); });
    setFormData(data);
    setShowModal(true);
  };

  const handleSave = () => {
    if (!selectedPatient && activeTab !== 'handover') {
      toast.error(t('selectPatientFirst', { ns: 'nursing', defaultValue: 'Select a patient first' }));
      return;
    }

    const payload: Record<string, unknown> = {};
    // M4 fix: coerce numeric fields to numbers, keep others as strings
    const fields = TAB_FIELDS[activeTab]?.createFields ?? [];
    for (const [key, val] of Object.entries(formData)) {
      const fieldDef = fields.find(f => f.key === key);
      payload[key] = fieldDef?.type === 'number' && val !== '' ? Number(val) : val;
    }
    if (activeTab === 'handover' && !payload.content) {
      payload.content = [
        formData.situation ? `Situation: ${formData.situation}` : '',
        formData.background ? `Background: ${formData.background}` : '',
        formData.assessment ? `Assessment: ${formData.assessment}` : '',
        formData.recommendation ? `Recommendation: ${formData.recommendation}` : '',
      ].filter(Boolean).join('\n') || 'SBAR handover';
    }
    if (selectedPatient) payload.patient_id = selectedPatient;
    // Find visit_id from selected patient
    const pt = patients.find(p => p.patient_id === selectedPatient);
    if (pt?.visit_id) payload.visit_id = pt.visit_id;

    if (editingId) {
      updateMutation.mutate({ ...payload, _id: editingId });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (id: number) => {
    if (!confirm(t('confirmDelete', { ns: 'nursing', defaultValue: 'Delete this record?' }))) return;
    deleteMutation.mutate({ id });
  };

  // ── OPD actions ──
  const handleCheckIn = (visitId: number) => {
    setCheckInVisitId(visitId);
    setChiefComplaint('');
  };

  const submitCheckIn = () => {
    if (!checkInVisitId) return;
    checkInMutation.mutate(
      { visit_id: checkInVisitId, chief_complaint: chiefComplaint || undefined },
      {
        onSuccess: () => {
          setCheckInVisitId(null);
          setChiefComplaint('');
        },
      },
    );
  };

  const handleCheckOut = (visitId: number) => {
    checkOutMutation.mutate({ visit_id: visitId });
  };

  // ── Refresh handler ──
  const handleRefresh = () => {
    if (activeTab === 'overview') {
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.patients() });
    } else if (activeTab === 'opd') {
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.opd() });
    } else {
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.records(activeTab, selectedPatient ?? undefined) });
    }
  };

  // ── Saving state from mutations ──
  const saving = createMutation.isPending || updateMutation.isPending;

  // ── KPIs ──
  const kpis = [
    { title: t('admittedPatients', { ns: 'nursing' }), value: patients.length, icon: <Users className="w-5 h-5" />, iconBg: 'bg-blue-50 text-blue-600' },
    { title: t('critical', { ns: 'nursing' }), value: patients.filter(p => p.admission_status === 'critical').length, icon: <AlertCircle className="w-5 h-5" />, iconBg: 'bg-red-50 text-red-600' },
    { title: t('activeRecords', { ns: 'nursing' }), value: records.length > 0 ? pagination.total : '—', icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-purple-50 text-purple-600' },
    { title: t('todayOpd', { ns: 'nursing' }), value: opdVisits.length || '—', icon: <Stethoscope className="w-5 h-5" />, iconBg: 'bg-emerald-50 text-emerald-600' },
  ];

  const tabConfig = TAB_FIELDS[activeTab];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('enhancedNursing', { ns: 'nursing' })}</h1>
              <p className="section-subtitle">{t('enhancedNursingSubtitle', { ns: 'nursing' })}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab !== 'overview' && activeTab !== 'opd' && (
              <button onClick={handleCreate} className="btn-primary">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{t('newRecord')}</span>
              </button>
            )}
            <button
              onClick={handleRefresh}
              className="btn-ghost p-2"
              aria-label={t('medicationOrders.refresh')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((k, i) => (
            <KPICard key={k.title} title={k.title} value={k.value} icon={k.icon} iconBg={k.iconBg} loading={loading && activeTab === 'overview'} index={i} />
          ))}
        </div>

        {/* ── Tab Bar ── */}
        <div className="card p-1.5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}
              >
                {tab.icon} {t(`tabs.${tab.key}` as any)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Patient Selector (for CRUD tabs) ── */}
        {activeTab !== 'overview' && activeTab !== 'opd' && (
          <div className="card p-3 flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('medicationOrders.patient')}:</label>
            <select
              value={selectedPatient ?? ''}
              onChange={e => {
                const val = e.target.value ? parseInt(e.target.value) : null;
                setSelectedPatient(val);
              }}
              className="input max-w-xs"
            >
              <option value="">{t('medicationOrders.allPatients', { defaultValue: 'All Patients' })}</option>
              {patients.map(p => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.name} ({p.patient_code})
                </option>
              ))}
            </select>
            {selectedPatient && (
              <button onClick={() => setSelectedPatient(null)} className="btn-ghost text-xs">{t('common:reset')}</button>
            )}
          </div>
        )}

        {/* ────────────── OVERVIEW TAB ────────────── */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="card overflow-hidden xl:col-span-2">
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('admittedPatients')}</h2>
              <span className="text-xs text-[var(--color-text-muted)]">
                My Patients: {(favouritesQuery.data?.Results ?? []).length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('patient')}</th>
                    <th>{t('dashboard:patientId')}</th>
                    <th>{t('common:gender')}</th>
                    <th>{t('common:doctor')}</th>
                    <th>{t('common:admitted')}</th>
                    <th>{t('status')}</th>
                    <th>{t('common:actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        {[...Array(7)].map((_, j) => (
                          <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                        ))}
                      </tr>
                    ))
                  ) : patients.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          icon={<Users className="w-8 h-8 text-[var(--color-text-muted)]" />}
                          title={t('noInpatients')}
                          description={t('noInpatientsDesc', { defaultValue: 'No patients currently admitted.' })}
                        />
                      </td>
                    </tr>
                  ) : (
                    patients.map(p => (
                      <tr key={p.admission_id}>
                        <td className="font-medium">{p.name}</td>
                        <td className="font-data text-sm">{p.patient_code}</td>
                        <td className="text-[var(--color-text-secondary)]">{p.gender || '—'}</td>
                        <td className="text-[var(--color-text-secondary)]">{p.doctor_name || '—'}</td>
                        <td className="font-data text-sm text-[var(--color-text-secondary)]">
                          {p.admission_date ? new Date(p.admission_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td>
                          <span className={`badge ${p.admission_status === 'critical' ? 'badge-error' : 'badge-success'}`}>
                            {t(p.admission_status)}
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => toggleFavourite(p.patient_id)}
                            className={`btn-ghost p-1.5 ${favouriteIds.has(p.patient_id) ? 'text-amber-500' : 'text-[var(--color-text-muted)]'}`}
                            title={favouriteIds.has(p.patient_id) ? 'Remove from My Patients' : 'Add to My Patients'}
                          >
                            <Star className={`w-4 h-4 ${favouriteIds.has(p.patient_id) ? 'fill-current' : ''}`} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
                <Bell className="w-4 h-4 text-red-500" /> Medication Due
              </h2>
              <span className="badge badge-warning text-xs">{medDueSummary.total}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-red-50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-red-700">{medDueSummary.overdue}</p>
                <p className="text-xs text-red-600">Overdue</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-amber-700">{medDueSummary.upcoming}</p>
                <p className="text-xs text-amber-600">Due today</p>
              </div>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {medDueList.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No pending medication due</p>
              ) : medDueList.slice(0, 10).map((m, idx) => (
                <div key={String(m.schedule_id ?? idx)} className="border border-[var(--color-border)] rounded-lg p-2 text-sm">
                  <p className="font-medium">{String(m.patient_name ?? 'Patient')}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{String(m.medication_name ?? '')} · {String(m.scheduled_time ?? '')}</p>
                  {!!m.is_overdue && <span className="text-xs text-red-600">Overdue</span>}
                </div>
              ))}
            </div>
          </div>
          </div>
        )}

        {/* ── Clinical MAR Tab ── */}
        {activeTab === 'mar' && (
          <MARTab
            patients={patients}
            selectedPatient={selectedPatient}
            onSelectPatient={setSelectedPatient}
          />
        )}

        {/* ── Medication Orders Tab ── */}
        {activeTab === 'medication-orders' && (
          <MedicationOrdersTab
            patients={patients}
            selectedPatient={selectedPatient}
            onSelectPatient={setSelectedPatient}
          />
        )}

        {/* ── Reconciliation Tab ── */}
        {activeTab === 'reconciliation' && (
          <ReconciliationTab
            patients={patients}
            selectedPatient={selectedPatient}
            onSelectPatient={setSelectedPatient}
          />
        )}

        {/* ── I/O Charts Tab ── */}
        {activeTab === 'io' && (
          <IOChartsTab
            patients={patients}
            selectedPatient={selectedPatient}
            onSelectPatient={setSelectedPatient}
          />
        )}

        {activeTab === 'clinical-summary' && (
          <ClinicalSummaryTab
            patients={patients}
            selectedPatient={selectedPatient}
            onSelectPatient={setSelectedPatient}
          />
        )}

        {/* ────────────── CRUD TABS (care-plan, notes, monitoring, iv-drugs, wound-care, handover) ────────────── */}
        {tabConfig && !CLINICAL_TABS.includes(activeTab) && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {t(TABS.find(t => t.key === activeTab)?.labelKey as any)} {t('common:record', { count: 2 })}
                {pagination.total > 0 && <span className="ml-2 text-[var(--color-text-muted)] font-normal">({pagination.total})</span>}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>#</th>
                    {tabConfig.displayCols.map(col => (
                      <th key={col} className="capitalize">{t(col)}</th>
                    ))}
                    <th>{t('common:created')}</th>
                    <th>{t('common:actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        {[...Array(tabConfig.displayCols.length + 3)].map((_, j) => (
                          <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                        ))}
                      </tr>
                    ))
                  ) : records.length === 0 ? (
                    <tr>
                      <td colSpan={tabConfig.displayCols.length + 3}>
                        <EmptyState
                          icon={<ClipboardList className="w-8 h-8 text-[var(--color-text-muted)]" />}
                          title={t('common:recordNotFound')}
                          description={t('common:createFirstRecord')}
                          action={
                            <button onClick={handleCreate} className="btn-primary mt-2">
                              <Plus className="w-4 h-4" /> {t('common:addRecord')}
                            </button>
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    records.map((r, idx) => (
                      <tr key={r.id}>
                        <td className="font-data text-sm text-[var(--color-text-muted)]">{(pagination.page - 1) * pagination.limit + idx + 1}</td>
                        {tabConfig.displayCols.map(col => (
                          <td key={col} className="text-sm max-w-48 truncate">{truncate(r[col])}</td>
                        ))}
                        <td className="font-data text-xs text-[var(--color-text-muted)]">
                          {r.created_at ? timeAgo(t, r.created_at) : '—'}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleEdit(r)} className="btn-ghost p-1.5 text-blue-600" title={t('common:edit')}>
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(r.id)} className="btn-ghost p-1.5 text-red-600" title={t('common:delete')}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.total > pagination.limit && (
              <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">
                  {t('common:pageOf', { current: pagination.page, total: Math.ceil(pagination.total / pagination.limit) })}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={pagination.page <= 1}
                    className="btn-secondary text-xs"
                  >
                    {t('common:previous')}
                  </button>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={pagination.page >= Math.ceil(pagination.total / pagination.limit)}
                    className="btn-secondary text-xs"
                  >
                    {t('common:next')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ────────────── WARDS TAB ────────────── */}
        {activeTab === 'wards' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {wards.map(w => (
                <div key={w.id} className="card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{w.name}</h3>
                    <span className="badge badge-primary text-xs">{w.ward_type || t('options.general')}</span>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)]">{w.floor ? t('wards.floor', { ns: 'nursing', number: w.floor }) : '—'}</p>
                  <div className="flex gap-3 mt-2">
                    <div className="flex-1 bg-blue-50 rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-blue-700">{w.total_beds}</p>
                      <p className="text-xs text-blue-600">{t('ipd:bedManagement.totalBeds')}</p>
                    </div>
                    <div className={`flex-1 rounded-lg p-2 text-center ${w.occupied_beds >= w.total_beds ? 'bg-red-50' : 'bg-emerald-50'}`}>
                      <p className={`text-lg font-bold ${w.occupied_beds >= w.total_beds ? 'text-red-700' : 'text-emerald-700'}`}>{w.occupied_beds}</p>
                      <p className={`text-xs ${w.occupied_beds >= w.total_beds ? 'text-red-600' : 'text-emerald-600'}`}>{t('ipd:bedManagement.occupied')}</p>
                    </div>
                    <div className="flex-1 bg-amber-50 rounded-lg p-2 text-center">
                      <p className="text-lg font-bold text-amber-700">{w.total_beds - w.occupied_beds}</p>
                      <p className="text-xs text-amber-600">{t('ipd:available')}</p>
                    </div>
                  </div>
                  <div className="w-full bg-[var(--color-border-light)] rounded-full h-2 mt-1">
                    <div
                      className={`h-2 rounded-full transition-all ${w.occupied_beds >= w.total_beds ? 'bg-red-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, (w.occupied_beds / Math.max(1, w.total_beds)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {wards.length === 0 && !loading && (
              <EmptyState
                icon={<BedDouble className="w-8 h-8 text-[var(--color-text-muted)]" />}
                title={t('noWards')}
                description={t('noWardsDesc')}
              />
            )}
          </div>
        )}

        {/* ────────────── OPD TAB ────────────── */}
        {activeTab === 'opd' && (
          <div className="space-y-4">
            {/* Date filter */}
            <div className="card p-3 flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('common:from')}:</label>
              <input
                type="date"
                value={opdDates.from_date}
                onChange={e => setOpdDates(d => ({ ...d, from_date: e.target.value }))}
                className="input max-w-40"
              />
              <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('common:to')}:</label>
              <input
                type="date"
                value={opdDates.to_date}
                onChange={e => setOpdDates(d => ({ ...d, to_date: e.target.value }))}
                className="input max-w-40"
              />
              <button onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.nursing.opd() })} className="btn-secondary">
                <Search className="w-4 h-4" /> {t('common:search')}
              </button>
            </div>

            {/* OPD Table */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('tabs.opd')}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('patient')}</th>
                      <th>{t('patient_code', { ns: 'common', defaultValue: 'Code' })}</th>
                      <th>{t('common:doctor')}</th>
                      <th>{t('common:date')}</th>
                      <th>{t('status')}</th>
                      <th>{t('common:actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      [...Array(5)].map((_, i) => (
                        <tr key={i}>
                          {[...Array(6)].map((_, j) => (
                            <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                          ))}
                        </tr>
                      ))
                    ) : opdVisits.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <EmptyState
                            icon={<Stethoscope className="w-8 h-8 text-[var(--color-text-muted)]" />}
                            title={t('noOpdVisits')}
                            description={t('noOpdVisitsDesc')}
                          />
                        </td>
                      </tr>
                    ) : (
                      opdVisits.map(v => (
                        <tr key={v.id}>
                          <td className="font-medium">{v.patient_name}</td>
                          <td className="font-data text-sm">{v.patient_code}</td>
                          <td className="text-[var(--color-text-secondary)]">{v.doctor_name || '—'}</td>
                          <td className="font-data text-sm text-[var(--color-text-secondary)]">
                            {v.visit_date ? new Date(v.visit_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
                          </td>
                          <td>
                            <span className={`badge ${
                              v.status === 'checked-in' ? 'badge-success' :
                              v.status === 'concluded' ? 'badge-info' :
                              v.status === 'initiated' ? 'badge-warning' :
                              'badge-primary'
                            }`}>
                              {t(v.status)}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              {v.status === 'initiated' && (
                                <button
                                  onClick={() => handleCheckIn(v.id)}
                                  className="btn-ghost p-1.5 text-emerald-600 text-xs"
                                  title={t('checkIn')}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                              )}
                              {v.status === 'checked-in' && (
                                <>
                                  <button
                                    onClick={() => handleFinalDiagnosis(v)}
                                    className="btn-ghost p-1.5 text-emerald-600 text-xs"
                                    title="Final diagnosis"
                                  >
                                    <Zap className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleRefer(v)}
                                    className="btn-ghost p-1.5 text-amber-600 text-xs"
                                    title="Refer"
                                  >
                                    <ArrowRightLeft className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleCheckOut(v.id)}
                                    className="btn-ghost p-1.5 text-blue-600 text-xs"
                                    title={t('checkOut')}
                                  >
                                    <Clock className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ────────────── CREATE/EDIT MODAL ────────────── */}
      {showModal && tabConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
              <h3 className="font-semibold">
                {editingId ? t('common:edit') : t('common:new')} {t(`tabs.${activeTab}` as any)} {t('common:record', { defaultValue: 'Record' })}
              </h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Patient selector in modal */}
              <div>
                <label className="label">{t('medicationOrders.patient')}</label>
                <select
                  value={selectedPatient ?? ''}
                  onChange={e => setSelectedPatient(parseInt(e.target.value) || null)}
                  className="input"
                  required
                >
                  <option value="">{t('medicationOrders.selectPatient')}</option>
                  {patients.map(p => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.name} ({p.patient_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Dynamic fields */}
              {tabConfig.createFields.map(field => (
                <div key={field.key}>
                  <label className="label">
                    {t(field.labelKey)} {field.required && <span className="text-[var(--color-error)]">*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      value={formData[field.key] ?? ''}
                      onChange={e => setFormData(f => ({ ...f, [field.key]: e.target.value }))}
                      rows={3}
                      placeholder={field.placeholderKey ? t(field.placeholderKey) : ''}
                      className="input resize-none"
                      required={field.required}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      value={formData[field.key] ?? ''}
                      onChange={e => setFormData(f => ({ ...f, [field.key]: e.target.value }))}
                      className="input"
                      required={field.required}
                    >
                      <option value="">{t('common:select')}</option>
                      {field.options?.map(o => (
                        <option key={o} value={o}>
                          {field.optionLabelPrefix ? t(`${field.optionLabelPrefix}.${o}` as any) : o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={formData[field.key] ?? ''}
                      onChange={e => setFormData(f => ({ ...f, [field.key]: e.target.value }))}
                      placeholder={field.placeholderKey ? t(field.placeholderKey) : ''}
                      className="input"
                      required={field.required}
                    />
                  )}
                </div>
              ))}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                  {t('common:cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !selectedPatient}
                  className="btn-primary"
                >
                  {saving ? t('common:saving') : editingId ? t('common:update') : t('common:create', { defaultValue: 'Create' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {checkInVisitId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">OPD Check-in</h3>
              <button onClick={() => setCheckInVisitId(null)} className="btn-ghost p-1.5">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Chief complaint</label>
                <textarea
                  value={chiefComplaint}
                  onChange={e => setChiefComplaint(e.target.value)}
                  rows={4}
                  className="input resize-none"
                  placeholder="Patient's main complaint at nursing check-in"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setCheckInVisitId(null)} className="btn-secondary">Cancel</button>
                <button onClick={submitCheckIn} disabled={checkInMutation.isPending} className="btn-primary">
                  {checkInMutation.isPending ? 'Checking in...' : 'Check in'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

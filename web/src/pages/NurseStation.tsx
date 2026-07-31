import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import {
  Stethoscope, Users, HeartPulse, Thermometer, Activity,
  ChevronRight, RefreshCw, AlertCircle, CheckCircle, Pill, NotebookPen, Printer,
  X, Search, Clock, BedDouble,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import WardBedGrid from '../components/nursing/WardBedGrid';
import type { BedGridItem } from '../components/nursing/WardBedGrid';
import PatientDrawer from '../components/nursing/PatientDrawer';
import DoctorRoundForm from '../components/ipd/DoctorRoundForm';

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PatientWithVitals {
  admission_id: number;
  admission_no: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  ward_name?: string;
  bed_number?: string;
  doctor_name?: string;
  provisional_diagnosis?: string;
  admission_status: string;
  latestVitals: {
    systolic?: number;
    diastolic?: number;
    temperature?: number;
    heart_rate?: number;
    spo2?: number;
    recorded_at: string;
  } | null;
}

interface VitalLog {
  id: number;
  patient_name: string;
  systolic?: number;
  diastolic?: number;
  temperature?: number;
  heart_rate?: number;
  spo2?: number;
  recorded_by: string;
  recorded_at: string;
}

interface Stats {
  activePatients: number;
  pendingVitals: number;
  roundsCompleted: number;
  totalRounds: number;
}

interface DashboardData {
  patients: PatientWithVitals[];
  stats: Stats & { activeAlerts?: number };
}

interface VitalsData {
  vitals: VitalLog[];
}

interface MedicationDueItem {
  patient_id: number;
  medication_name?: string;
  scheduled_time?: string;
  is_overdue?: boolean;
  minutes_until_due?: number;
}

type QuickAction = 'medication' | 'note';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function vitalStatus(v: PatientWithVitals['latestVitals'], t: TFunction): { label: string; color: string } {
  if (!v) return { label: t('vitalStatus.pending'), color: 'text-amber-600' };
  if (v.spo2 && v.spo2 < 92) return { label: t('vitalStatus.critical'), color: 'text-red-600' };
  if (v.heart_rate && (v.heart_rate > 120 || v.heart_rate < 50)) return { label: t('vitalStatus.warning'), color: 'text-amber-600' };
  if (v.systolic && (v.systolic > 160 || v.systolic < 80)) return { label: t('vitalStatus.warning'), color: 'text-amber-600' };
  if (v.temperature && (v.temperature > 101 || v.temperature < 96)) return { label: t('vitalStatus.warning'), color: 'text-amber-600' };
  return { label: t('vitalStatus.normal'), color: 'text-emerald-600' };
}

function timeAgo(dateStr: string, t: TFunction): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('time.justNow');
  if (mins < 60) return t('time.mAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('time.hAgo', { count: hrs });
  return t('time.dAgo', { count: Math.floor(hrs / 24) });
}

// ─── Demo data ───────────────────────────────────────────────────────────────

const DEMO_PATIENTS: PatientWithVitals[] = [
  { admission_id: 1, admission_no: 'ADM-00001', patient_id: 1, patient_name: 'Mohammad Karim', patient_code: 'P-00001', ward_name: 'Ward A', bed_number: 'A-1', doctor_name: 'Dr. Rahman', provisional_diagnosis: 'Acute appendicitis', admission_status: 'admitted', latestVitals: { systolic: 125, diastolic: 82, temperature: 99.1, heart_rate: 78, spo2: 97, recorded_at: new Date(Date.now() - 3600000).toISOString() } },
  { admission_id: 2, admission_no: 'ADM-00002', patient_id: 2, patient_name: 'Fatima Begum', patient_code: 'P-00002', ward_name: 'ICU', bed_number: 'ICU-1', doctor_name: 'Dr. Hossain', provisional_diagnosis: 'Severe pneumonia', admission_status: 'critical', latestVitals: { systolic: 95, diastolic: 60, temperature: 102.4, heart_rate: 110, spo2: 89, recorded_at: new Date(Date.now() - 1800000).toISOString() } },
  { admission_id: 3, admission_no: 'ADM-00004', patient_id: 4, patient_name: 'Rahim Uddin', patient_code: 'P-00004', ward_name: 'Ward B', bed_number: 'B-1', doctor_name: 'Dr. Akter', provisional_diagnosis: 'Fracture repair', admission_status: 'admitted', latestVitals: null },
  { admission_id: 4, admission_no: 'ADM-00005', patient_id: 5, patient_name: 'Sultana Khatun', patient_code: 'P-00005', ward_name: 'Ward A', bed_number: 'A-3', doctor_name: 'Dr. Rahman', provisional_diagnosis: 'Post-op monitoring', admission_status: 'admitted', latestVitals: { systolic: 118, diastolic: 76, temperature: 98.6, heart_rate: 72, spo2: 99, recorded_at: new Date(Date.now() - 7200000).toISOString() } },
];

const DEMO_VITALS_LOG: VitalLog[] = [
  { id: 1, patient_name: 'Fatima Begum', systolic: 95, diastolic: 60, temperature: 102.4, heart_rate: 110, spo2: 89, recorded_by: 'Nurse Rina', recorded_at: new Date(Date.now() - 1800000).toISOString() },
  { id: 2, patient_name: 'Mohammad Karim', systolic: 125, diastolic: 82, temperature: 99.1, heart_rate: 78, spo2: 97, recorded_by: 'Nurse Rina', recorded_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 3, patient_name: 'Sultana Khatun', systolic: 118, diastolic: 76, temperature: 98.6, heart_rate: 72, spo2: 99, recorded_by: 'Nurse Afia', recorded_at: new Date(Date.now() - 7200000).toISOString() },
];

const DEMO_STATS: Stats = { activePatients: 4, pendingVitals: 1, roundsCompleted: 3, totalRounds: 4 };
const EMPTY_STATS: Stats = { activePatients: 0, pendingVitals: 0, roundsCompleted: 0, totalRounds: 0 };

// ─── Component ───────────────────────────────────────────────────────────────

export default function NurseStation({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const { t } = useTranslation(['nursing', 'dashboard', 'common']);
  const queryClient = useQueryClient();

  // ── Data fetching via React Query ──────────────────────────────────────────

  const {
    data: dashData,
    isLoading: dashLoading,
  } = useApiQuery<DashboardData>(
    queryKeys.nurseStation.dashboard(),
    '/api/nurse-station/dashboard',
  );

  const {
    data: vitalsData,
    isLoading: vitalsLoading,
  } = useApiQuery<VitalsData>(
    queryKeys.nurseStation.vitals(),
    '/api/nurse-station/vitals?limit=10',
  );

  const medDueQuery = useApiQuery<{ Results: Record<string, unknown>[]; summary: { overdue: number; upcoming: number; total: number } }>(
    queryKeys.nursing.medicationDue(),
    '/api/nursing/medication-due',
  );

  const alertsQuery = useApiQuery<{ alerts: Record<string, unknown>[] }>(
    [...queryKeys.nurseStation.all, 'active-alerts'],
    '/api/nurse-station/active-alerts?limit=10',
  );

  // ── Bed Grid data ──────────────────────────────────────────────────────────
  const bedGridQuery = useApiQuery<{ Results: BedGridItem[] }>(
    [...queryKeys.nurseStation.all, 'bed-grid'],
    '/api/nursing/wards/bed-grid',
  );
  const bedGridData = bedGridQuery.data?.Results ?? [];

  // ── Patient Drawer state ───────────────────────────────────────────────────
  const [selectedBed, setSelectedBed] = useState<BedGridItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const openDrawer = (bed: BedGridItem) => {
    if (!bed.patient_id) return; // Don't open for empty beds
    setSelectedBed(bed);
    setDrawerOpen(true);
  };

  // ── Shift detection ────────────────────────────────────────────────────────
  const currentHour = new Date().getHours();
  const shift = currentHour < 14 ? 'morning' : currentHour < 22 ? 'evening' : 'night';

  // ── Filter bed grid by search ──────────────────────────────────────────────
  const filteredBeds = useMemo(() => {
    if (!searchQuery.trim()) return bedGridData;
    const q = searchQuery.toLowerCase();
    return bedGridData.filter(b =>
      (b.patient_name?.toLowerCase().includes(q)) ||
      (b.bed_number?.toLowerCase().includes(q)) ||
      (b.ward_name?.toLowerCase().includes(q))
    );
  }, [bedGridData, searchQuery]);

  const loading = dashLoading || vitalsLoading;

  // Fallback to demo data when the API returns nothing (mirrors original catch behaviour)
  const patients = dashData?.patients ?? DEMO_PATIENTS;
  const stats = dashData?.stats ?? (dashData ? EMPTY_STATS : DEMO_STATS);
  const vitalsLog = vitalsData?.vitals ?? DEMO_VITALS_LOG;
  const medicationDue = medDueQuery.data?.summary ?? { overdue: 0, upcoming: 0, total: 0 };
  const medicationDueList = (medDueQuery.data?.Results ?? []) as unknown as MedicationDueItem[];
  const activeAlerts = alertsQuery.data?.alerts ?? [];

  // ── Mutation for recording vitals ──────────────────────────────────────────

  const vitalsMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/nurse-station/vitals',
    {
      onSuccess: () => {
        toast.success(t('vitals_recorded'));
        setVitalsForm({ patient_id: 0, admission_id: 0, systolic: '', diastolic: '', temperature: '', heart_rate: '', spo2: '', respiratory_rate: '', weight: '', notes: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.all });
      },
      onError: () => {
        toast.error(t('failed_to_record_vitals'));
      },
    },
  );

  const bulkVitalsMutation = useApiMutation<unknown, { entries: Record<string, unknown>[] }>(
    'post',
    '/api/nurse-station/vitals/bulk',
    {
      onSuccess: () => {
        toast.success('Round vitals saved');
        setBulkRows({});
        queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.all });
      },
      onError: (err) => toast.error(err.message || 'Failed to save round vitals'),
    },
  );

  // ── Local form state ───────────────────────────────────────────────────────

  const [vitalsForm, setVitalsForm] = useState({
    patient_id: 0,
    admission_id: 0,
    systolic: '',
    diastolic: '',
    temperature: '',
    heart_rate: '',
    spo2: '',
    respiratory_rate: '',
    weight: '',
    notes: '',
  });
  const [showRoundEntry, setShowRoundEntry] = useState(false);
  const [showDoctorRound, setShowDoctorRound] = useState(false);
  const [doctorRoundPatientId, setDoctorRoundPatientId] = useState(0);
  const [bulkRows, setBulkRows] = useState<Record<number, { systolic: string; diastolic: string; temperature: string; heart_rate: string; spo2: string }>>({});
  const [quickAction, setQuickAction] = useState<QuickAction | null>(null);
  const [quickActionPatient, setQuickActionPatient] = useState<PatientWithVitals | null>(null);
  const [medicationForm, setMedicationForm] = useState({
    medication_name: '',
    dose: '',
    route: 'oral',
    frequency: '',
    status: 'given',
    remarks: '',
  });
  const [noteForm, setNoteForm] = useState({
    note_type: 'general',
    note: '',
  });

  const quickMedicationMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/nursing/mar',
    {
      onSuccess: () => {
        toast.success('Medication entry saved');
        closeQuickAction();
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.medicationDue() });
      },
      onError: (err) => toast.error(err.message || 'Failed to save medication entry'),
    },
  );

  const quickNoteMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/nursing/notes',
    {
      onSuccess: () => {
        toast.success('Nursing note saved');
        closeQuickAction();
      },
      onError: (err) => toast.error(err.message || 'Failed to save nursing note'),
    },
  );

  function closeQuickAction() {
    setQuickAction(null);
    setQuickActionPatient(null);
  }

  const openQuickAction = (action: QuickAction, patient: PatientWithVitals) => {
    setQuickAction(action);
    setQuickActionPatient(patient);
    if (action === 'medication') {
      setMedicationForm({ medication_name: '', dose: '', route: 'oral', frequency: '', status: 'given', remarks: '' });
    } else {
      setNoteForm({ note_type: 'general', note: '' });
    }
  };

  const saveQuickMedication = () => {
    if (!quickActionPatient) return;
    if (!medicationForm.medication_name.trim()) {
      toast.error('Medication name is required');
      return;
    }
    quickMedicationMutation.mutate({
      patient_id: quickActionPatient.patient_id,
      visit_id: quickActionPatient.admission_id,
      medication_name: medicationForm.medication_name.trim(),
      dose: medicationForm.dose.trim() || undefined,
      route: medicationForm.route || undefined,
      frequency: medicationForm.frequency.trim() || undefined,
      status: medicationForm.status,
      administered_on: new Date().toISOString(),
      remarks: medicationForm.remarks.trim() || undefined,
    });
  };

  const saveQuickNote = () => {
    if (!quickActionPatient) return;
    if (!noteForm.note.trim()) {
      toast.error('Nursing note is required');
      return;
    }
    quickNoteMutation.mutate({
      patient_id: quickActionPatient.patient_id,
      visit_id: quickActionPatient.admission_id,
      note_type: noteForm.note_type,
      note: noteForm.note.trim(),
    });
  };

  const handleRecordVitals = () => {
    if (!vitalsForm.patient_id) { toast.error(t('select_a_patient')); return; }

    const body: Record<string, unknown> = { patient_id: vitalsForm.patient_id };
    if (vitalsForm.admission_id) body.admission_id = vitalsForm.admission_id;
    if (vitalsForm.systolic) body.systolic = parseInt(vitalsForm.systolic);
    if (vitalsForm.diastolic) body.diastolic = parseInt(vitalsForm.diastolic);
    if (vitalsForm.temperature) body.temperature = parseFloat(vitalsForm.temperature);
    if (vitalsForm.heart_rate) body.heart_rate = parseInt(vitalsForm.heart_rate);
    if (vitalsForm.spo2) body.spo2 = parseInt(vitalsForm.spo2);
    if (vitalsForm.respiratory_rate) body.respiratory_rate = parseInt(vitalsForm.respiratory_rate);
    if (vitalsForm.weight) body.weight = parseFloat(vitalsForm.weight);
    if (vitalsForm.notes) body.notes = vitalsForm.notes;

    vitalsMutation.mutate(body);
  };

  const updateBulkRow = (patientId: number, field: string, value: string) => {
    setBulkRows(rows => ({
      ...rows,
      [patientId]: {
        ...(rows[patientId] ?? {}),
        systolic: rows[patientId]?.systolic ?? '',
        diastolic: rows[patientId]?.diastolic ?? '',
        temperature: rows[patientId]?.temperature ?? '',
        heart_rate: rows[patientId]?.heart_rate ?? '',
        spo2: rows[patientId]?.spo2 ?? '',
        [field]: value,
      },
    }));
  };

  const handleBulkVitals = () => {
    const entries = patients.map(p => {
      const row = bulkRows[p.patient_id];
      if (!row) return null;
      const hasAny = Object.values(row).some(Boolean);
      if (!hasAny) return null;
      return {
        patient_id: p.patient_id,
        admission_id: p.admission_id,
        systolic: row.systolic ? Number(row.systolic) : undefined,
        diastolic: row.diastolic ? Number(row.diastolic) : undefined,
        temperature: row.temperature ? Number(row.temperature) : undefined,
        heart_rate: row.heart_rate ? Number(row.heart_rate) : undefined,
        spo2: row.spo2 ? Number(row.spo2) : undefined,
      };
    }).filter(Boolean) as Record<string, unknown>[];
    if (entries.length === 0) { toast.error('Enter at least one set of vitals'); return; }
    bulkVitalsMutation.mutate({ entries });
  };

  const printNursingSheet = (title: string, body: string) => {
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>${title}</title><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #bbb;padding:6px;text-align:left}
      h1{font-size:18px}
      @media print{button{display:none}}
    </style></head><body><h1>${title}</h1>${body}<button onclick="window.print()">Print</button></body></html>`);
    win.document.close();
  };

  const printVitalsSheet = () => printNursingSheet('Vitals Chart', `<table><thead><tr><th>Time</th><th>Patient</th><th>BP</th><th>Temp</th><th>HR</th><th>SpO2</th><th>Nurse</th></tr></thead><tbody>${vitalsLog.map(v => `<tr><td>${escapeHtml(v.recorded_at)}</td><td>${escapeHtml(v.patient_name)}</td><td>${escapeHtml(v.systolic)}/${escapeHtml(v.diastolic)}</td><td>${escapeHtml(v.temperature)}</td><td>${escapeHtml(v.heart_rate)}</td><td>${escapeHtml(v.spo2)}</td><td>${escapeHtml(v.recorded_by)}</td></tr>`).join('')}</tbody></table>`);
  const printMedicationSheet = () => printNursingSheet('MAR 24-hour Sheet', `<table><thead><tr><th>Patient</th><th>Medication</th><th>Due Time</th><th>Status</th></tr></thead><tbody>${medicationDueList.map(m => `<tr><td>${escapeHtml(m.patient_id)}</td><td>${escapeHtml(m.medication_name)}</td><td>${escapeHtml(m.scheduled_time)}</td><td>${m.is_overdue ? 'Overdue' : 'Due'}</td></tr>`).join('')}</tbody></table>`);
  const printIOSheet = () => printNursingSheet('I/O Chart', '<table><thead><tr><th>Time</th><th>Patient</th><th>Intake</th><th>Output</th><th>Balance</th><th>Remarks</th></tr></thead><tbody><tr><td colspan="6">Use Nursing Dashboard I/O tab for live entries; this sheet is ready for ward printing.</td></tr></tbody></table>');
  const printHandoverSheet = () => printNursingSheet('Nursing Handover Report', `<table><thead><tr><th>Patient</th><th>Ward/Bed</th><th>Diagnosis</th><th>Latest Vitals</th></tr></thead><tbody>${patients.map(p => `<tr><td>${escapeHtml(p.patient_name)}</td><td>${escapeHtml(p.ward_name)}/${escapeHtml(p.bed_number)}</td><td>${escapeHtml(p.provisional_diagnosis)}</td><td>${p.latestVitals ? `${escapeHtml(p.latestVitals.systolic)}/${escapeHtml(p.latestVitals.diastolic)}, T ${escapeHtml(p.latestVitals.temperature)}, SpO2 ${escapeHtml(p.latestVitals.spo2)}` : 'Pending'}</td></tr>`).join('')}</tbody></table>`);

  // ── Refresh handler ────────────────────────────────────────────────────────

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.all });
  };

  const kpis = [
    { label: t('stats.activePatients'), value: stats.activePatients, icon: <Users className="w-5 h-5 text-blue-500" />, bg: 'bg-blue-50' },
    { label: t('stats.pendingVitals'), value: stats.pendingVitals, icon: <AlertCircle className="w-5 h-5 text-amber-500" />, bg: 'bg-amber-50' },
    { label: t('stats.medicationsDue'), value: medicationDue.total, icon: <Activity className="w-5 h-5 text-red-500" />, bg: 'bg-red-50' },
    { label: t('stats.rounds'), value: `${stats.roundsCompleted}/${stats.totalRounds}`, icon: <CheckCircle className="w-5 h-5 text-emerald-500" />, bg: 'bg-emerald-50' },
  ];
  const doctorRoundPatient = patients.find((patient) => patient.admission_id === doctorRoundPatientId) ?? null;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">

        {/* ── Top Bar ───────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <Stethoscope className="w-6 h-6" /> {t('wardDashboard.title', { defaultValue: 'Ward Dashboard' })}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-text-muted)]">
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {shift === 'morning' ? t('wardDashboard.morning', { defaultValue: 'Morning' }) : shift === 'evening' ? t('wardDashboard.evening', { defaultValue: 'Evening' }) : t('wardDashboard.night', { defaultValue: 'Night' })} Shift</span>
              <span>·</span>
              <span>{new Date().toLocaleDateString('en-BD', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {stats.activePatients} {t('wardDashboard.myPatients', { defaultValue: 'patients' })}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3 text-amber-500" /> {medicationDue.total} {t('wardDashboard.pendingTasks', { defaultValue: 'pending' })}</span>
              {activeAlerts.length > 0 && <><span>·</span><span className="flex items-center gap-1 text-red-500"><AlertCircle className="w-3 h-3" /> {activeAlerts.length} {t('wardDashboard.alerts', { defaultValue: 'alerts' })}</span></>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowRoundEntry((open) => !open)} className="btn-secondary text-sm">Vitals Round Entry</button>
            <button onClick={() => setShowDoctorRound(true)} className="btn-primary text-sm">
              <Stethoscope className="w-4 h-4" /> {t('doctorRound.title', { defaultValue: 'Doctor Round' })}
            </button>
            <button onClick={printMedicationSheet} className="btn-secondary text-sm"><Printer className="w-4 h-4" /> MAR</button>
            <button onClick={printIOSheet} className="btn-secondary text-sm"><Printer className="w-4 h-4" /> I/O</button>
            <button onClick={printVitalsSheet} className="btn-secondary text-sm"><Printer className="w-4 h-4" /> Vitals</button>
            <button onClick={printHandoverSheet} className="btn-secondary text-sm"><Printer className="w-4 h-4" /> Handover</button>
            <button onClick={handleRefresh} className="btn-ghost p-2" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
          </div>
        </div>

        {/* ── Search ─────────────────────────────────────────────────────────── */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('wardDashboard.searchPatient', { defaultValue: 'Search patient or bed...' })}
            className="input pl-9 w-full"
          />
        </div>

        {/* ── KPIs ───────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(k => (
            <div key={k.label} className="card p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.bg}`}>{k.icon}</div>
              <div>
                <p className="text-2xl font-bold text-[var(--color-text)]">{k.value}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{k.label}</p>
              </div>
            </div>
          ))}
        </div>

        {showRoundEntry && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Vitals Round Entry</h2>
              <button onClick={handleBulkVitals} disabled={bulkVitalsMutation.isPending} className="btn-primary text-sm">
                {bulkVitalsMutation.isPending ? 'Saving...' : 'Submit All'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base text-sm">
                <thead><tr><th>Patient</th><th>BP Sys</th><th>BP Dia</th><th>Temp</th><th>Pulse</th><th>SpO2</th></tr></thead>
                <tbody>
                  {patients.map(p => {
                    const row = bulkRows[p.patient_id] ?? { systolic: '', diastolic: '', temperature: '', heart_rate: '', spo2: '' };
                    return (
                      <tr key={p.patient_id}>
                        <td className="font-medium">{p.patient_name}<p className="text-xs text-[var(--color-text-muted)]">{p.ward_name}/{p.bed_number}</p></td>
                        {(['systolic', 'diastolic', 'temperature', 'heart_rate', 'spo2'] as const).map(field => (
                          <td key={field}><input className="input text-xs w-24" value={row[field]} onChange={e => updateBulkRow(p.patient_id, field, e.target.value)} /></td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showDoctorRound && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-xl rounded-2xl bg-white shadow-modal dark:bg-slate-800">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] p-5">
                <h2 className="font-semibold">{t('doctorRound.title', { defaultValue: 'Doctor Round' })}</h2>
                <button type="button" className="btn-ghost p-1.5" onClick={() => setShowDoctorRound(false)} aria-label="Close doctor round">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <label className="label" htmlFor="doctor-round-patient">Doctor round patient</label>
                  <select
                    id="doctor-round-patient"
                    className="input"
                    value={doctorRoundPatientId}
                    onChange={(event) => setDoctorRoundPatientId(Number(event.target.value))}
                  >
                    <option value={0}>Select patient</option>
                    {patients.map((patient) => (
                      <option key={patient.admission_id} value={patient.admission_id}>
                        {patient.patient_name} - {patient.admission_no}
                      </option>
                    ))}
                  </select>
                </div>
                {doctorRoundPatient && (
                  <DoctorRoundForm
                    patientId={doctorRoundPatient.patient_id}
                    patientName={doctorRoundPatient.patient_name}
                    admissionId={doctorRoundPatient.admission_id}
                    admissionNo={doctorRoundPatient.admission_no}
                    entrySource="nurse_station"
                    onCancel={() => setShowDoctorRound(false)}
                    onSuccess={() => {
                      toast.success(t('doctorRound.saved'));
                      setShowDoctorRound(false);
                      setDoctorRoundPatientId(0);
                      queryClient.invalidateQueries({ queryKey: queryKeys.nurseStation.all });
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {activeAlerts.length > 0 && (
          <div className="card p-4 border-l-4 border-l-red-500">
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" /> Active Alerts
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {activeAlerts.slice(0, 4).map((alert, idx) => (
                <div key={String(alert.id ?? idx)} className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm">
                  <p className="font-medium text-red-800">{String(alert.patient_name ?? 'Patient')} · {String(alert.vital_type ?? 'vital')}</p>
                  <p className="text-xs text-red-600">
                    {String(alert.recorded_value ?? '')} outside {String(alert.threshold_min ?? '')}-{String(alert.threshold_max ?? '')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Bed Grid ───────────────────────────────────────────────────────── */}
        <WardBedGrid beds={filteredBeds} onBedClick={openDrawer} />

        {/* ── Patient Drawer ─────────────────────────────────────────────────── */}
        {drawerOpen && selectedBed && (
          <PatientDrawer bed={selectedBed} onClose={() => { setDrawerOpen(false); setSelectedBed(null); }} />
        )}

        {/* Vitals Log */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--color-primary)]" /> {t('recentVitals', { defaultValue: 'Recent Vitals' })}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <th>{t('time', { ns: 'common' })}</th>
                  <th>{t('patient', { ns: 'common' })}</th>
                  <th className="text-center">{t('bp', { ns: 'common' })}</th>
                  <th className="text-center">{t('temp', { ns: 'common' })}</th>
                  <th className="text-center">{t('heart_rate')}</th>
                  <th className="text-center">{t('spo₂_')}</th>
                  <th>{t('nurse')}</th>
                </tr>
              </thead>
              <tbody>
                {vitalsLog.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-[var(--color-text-muted)]">{t('nursing.no_vitals_recorded', { defaultValue: 'No vitals recorded' })}</td></tr>
                ) : (
                  vitalsLog.map(v => (
                    <tr key={v.id}>
                      <td className="text-xs text-[var(--color-text-muted)]">{timeAgo(v.recorded_at, t)}</td>
                      <td className="font-medium">{v.patient_name}</td>
                      <td className="text-center">{v.systolic ?? '-'}/{v.diastolic ?? '-'}</td>
                      <td className="text-center">{v.temperature ?? '-'}°F</td>
                      <td className="text-center">{v.heart_rate ?? '-'}</td>
                      <td className="text-center">{v.spo2 ?? '-'}%</td>
                      <td className="text-[var(--color-text-muted)]">{v.recorded_by}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}

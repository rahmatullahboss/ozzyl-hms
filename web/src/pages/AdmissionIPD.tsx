import { useState, useEffect, Fragment } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  BedDouble, Users, Clock, TrendingUp, Search, RefreshCw,
  ChevronRight, AlertTriangle, X, UserPlus, LogOut, Printer, ClipboardCheck,
  Baby, Droplets, Settings, MessageSquare, UserCog, ShieldAlert, Undo2, CheckCircle, Wallet,
  MoreVertical,
  CalendarClock, History,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getAdmissionSlipPrintPath } from '../lib/admissionPrint';
import { printDischargeSlip } from '../lib/print/dischargeSlipTemplate';
import { printDepositReceipt } from '../lib/print/depositReceiptTemplate';
import { api } from '../lib/apiClient';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';
import ReceptionTopBar from '../components/reception/ReceptionTopBar';
import DischargeModal from '../components/reception/DischargeModal';
import EmergencyAdmissionPatientEditAction from './emergency/EmergencyAdmissionPatientEditAction';
import {
  buildDischargeFinancial,
  type IpdFinancialClearanceApi,
  type IpdPendingSummary,
} from '../lib/ipdDischargeFinancial';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Admission {
  id: number;
  admission_no: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  ward_name: string;
  bed_number: string;
  doctor_name: string;
  admission_type: string;
  admit_source?: string;
  referral_doctor?: string;
  admission_reason?: string;
  is_emergency?: number;
  admission_date: string;
  discharge_date?: string;
  provisional_diagnosis?: string;
  is_provisional_discharge?: number;
  status: string;
}

interface Bed {
  id: number;
  ward_name: string;
  bed_number: string;
  bed_type: string;
  status: string;
  feature_names?: string;
  effective_rate?: number;
  rate_per_day?: number;
}

interface DischargeCondition {
  id: number;
  name: string;
  description?: string;
}

interface TransferInfo extends Admission {
  receiving_ward?: string;
  receiving_bed?: string;
  previous_ward?: string;
  previous_bed?: string;
}

interface ProvisionalDischarge {
  id: number;
  admission_id: number;
  patient_name: string;
  patient_code: string;
  admission_no: string;
  ward_name?: string;
  bed_number?: string;
  billing_status?: string;
}

interface BirthCondition { id: number; name: string; }

interface Patient {
  id: number;
  name: string;
  patient_code: string;
}

interface Stats {
  currentAdmissions: number;
  totalBeds: number;
  availableBeds: number;
  dischargesToday: number;
  avgStayDays: number;
}

interface AdmissionStatsApiResponse extends Partial<Stats> {
  stats?: Partial<Stats> & {
    occupied?: number;
    available?: number;
  };
  admissions?: unknown[];
}

interface AdmissionsResponse {
  admissions: Admission[];
  total?: number;
  page?: number;
  perPage?: number;
}

interface BedsResponse {
  beds: Bed[];
}

interface PatientsResponse {
  patients: Patient[];
}

interface AdmitPayload {
  patient_id: number;
  admission_type: string;
  bed_id?: number;
  doctor_id?: number;
  provisional_diagnosis?: string;
  admit_source?: string;
  referral_doctor?: string;
  admission_reason?: string;
  is_emergency?: boolean;
  notes?: string;
  care_of_name?: string;
  care_of_phone?: string;
  care_of_relation?: string;
  idempotencyKey?: string;
  admission_date?: string;
  department?: string;
}

interface Department {
  id: number;
  name: string;
}

interface TransferHistoryEntry {
  id: number;
  from_ward?: string;
  from_bed?: string;
  to_ward?: string;
  to_bed?: string;
  transfer_date: string;
  received_date?: string;
  duration_minutes?: number;
}

interface DischargePayload {
  id: number;
  status: string;
  discharge_condition_id?: number;
  discharge_type?: string;
}

interface TransferBedPayload {
  id: number;
  new_bed_id: number;
  reason?: string;
  pending_receive?: boolean;
}

type StatusFilter = 'all' | 'admitted' | 'discharged' | 'transferred' | 'critical';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  admitted: 'bg-blue-100 text-blue-700',
  discharged: 'bg-green-100 text-green-700',
  transferred: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
  lama: 'bg-orange-100 text-orange-700',
};

const TYPE_LABELS: Record<string, string> = {
  planned: 'planned', // These will be localized in-situ or I should use a getter
  emergency: 'emergency',
  general: 'general',
  transfer: 'transfer',
};

const SOURCE_LABELS: Record<string, string> = {
  opd_referral: 'OPD referral',
  emergency: 'Emergency',
  planned: 'Planned',
  doctor_referral: 'Doctor referral',
  self: 'Self / walk-in',
  transfer: 'Transfer',
  walk_in: 'Walk-in',
  other: 'Other',
};

const FALLBACK_STATS: Stats = {
  currentAdmissions: 0,
  totalBeds: 0,
  availableBeds: 0,
  dischargesToday: 0,
  avgStayDays: 0,
};

const FALLBACK_ADMISSIONS: Admission[] = [
  { id: 1, admission_no: 'ADM-00001', patient_id: 1, patient_name: 'Mohammad Karim', patient_code: 'P-00001', ward_name: 'Ward A', bed_number: 'A-1', doctor_name: 'Dr. Rahman', admission_type: 'emergency', admission_date: new Date().toISOString(), provisional_diagnosis: 'Acute appendicitis', status: 'admitted' },
  { id: 2, admission_no: 'ADM-00002', patient_id: 2, patient_name: 'Fatima Begum', patient_code: 'P-00002', ward_name: 'ICU', bed_number: 'ICU-1', doctor_name: 'Dr. Hossain', admission_type: 'emergency', admission_date: new Date(Date.now() - 86400000 * 2).toISOString(), provisional_diagnosis: 'Severe pneumonia', status: 'critical' },
  { id: 3, admission_no: 'ADM-00003', patient_id: 3, patient_name: 'Abdul Hashem', patient_code: 'P-00003', ward_name: 'Ward B', bed_number: 'B-2', doctor_name: 'Dr. Akter', admission_type: 'planned', admission_date: new Date(Date.now() - 86400000 * 5).toISOString(), discharge_date: new Date().toISOString(), provisional_diagnosis: 'Knee replacement', status: 'discharged' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function printHtml(title: string, body: string) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111}
    .label{border:1px solid #111;padding:12px;display:inline-block}
    .wrist{width:520px;height:96px;display:flex;align-items:center;gap:16px}
    .barcode{font-family:monospace;border:1px dashed #333;padding:8px}
    h1{font-size:18px;margin:0 0 8px}
    p{margin:3px 0;font-size:13px}
    @media print{button{display:none}}
  </style></head><body>${body}<button onclick="window.print()">Print</button></body></html>`);
  win.document.close();
  win.focus();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdmissionIPD({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const basePath = `/h/${slug}`;
  const admissionBasePath = role === 'reception' || role === 'receptionist'
    ? `${basePath}/reception`
    : basePath;
  const { t } = useTranslation(['ipd', 'common']);
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<StatusFilter>('admitted');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 20;
  const [showDischargedSection, setShowDischargedSection] = useState(false);
  const [dischargedPage, setDischargedPage] = useState(1);
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [showDischargeModal, setShowDischargeModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showCancelDischargeModal, setShowCancelDischargeModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  // Danphe-style: quick deposit modal from admissions list
  const [showQuickDepositModal, setShowQuickDepositModal] = useState(false);
  const [quickDepositForm, setQuickDepositForm] = useState({ patient_id: 0, amount: '', payment_method: 'cash', remarks: '' });
  const [dischargeForm, setDischargeForm] = useState({ discharge_condition_id: 0, discharge_type: 'Normal' });
  const [transferForm, setTransferForm] = useState({ new_bed_id: 0, reason: '', pending_receive: true });
  const [advancedAdmissionId, setAdvancedAdmissionId] = useState('');
  const [doctorUpdate, setDoctorUpdate] = useState('');
  const [procedureType, setProcedureType] = useState('medical');
  const [policeCase, setPoliceCase] = useState(false);
  const [remarkText, setRemarkText] = useState('');
  const [birthForm, setBirthForm] = useState({
    admission_id: '',
    patient_id: '',
    birth_condition_id: '',
    baby_name: '',
    sex: '',
    weight_kg: '',
    birth_date: new Date().toISOString().split('T')[0],
    birth_time: '',
    birth_type: '',
    delivery_type: '',
    apgar_score: '',
    remarks: '',
  });
  const [hemoForm, setHemoForm] = useState({
    admission_id: '',
    patient_id: '',
    report_date: new Date().toISOString().split('T')[0],
    pre_weight: '',
    post_weight: '',
    pre_bp: '',
    post_bp: '',
    dialysis_duration_min: '',
    access_type: '',
    blood_flow_rate: '',
    dialysate_flow_rate: '',
    complications: '',
  });
  const [adtForm, setAdtForm] = useState({
    bed_feature_id: '',
    billing_item_id: '',
    price: '',
    admission_type: 'planned',
    min_deposit_amount: '',
    is_mandatory: true,
    scheme_id: '',
    price_category_id: '',
  });
  const [selectedAdmission, setSelectedAdmission] = useState<Admission | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Admit form
  const [admitForm, setAdmitForm] = useState({
    patient_id: 0,
    bed_id: 0,
    doctor_id: 0,
    care_of_name: '',
    care_of_phone: '',
    care_of_relation: '',
    admission_type: 'planned' as 'planned' | 'emergency' | 'transfer',
    admit_source: 'planned',
    referral_doctor: '',
    admission_reason: '',
    is_emergency: false,
    provisional_diagnosis: '',
    notes: '',
    department: '',
  });

  const [patientSearch, setPatientSearch] = useState('');
  const [debouncedPatientSearch, setDebouncedPatientSearch] = useState('');
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);

  // Danphe-style: deposit on admission
  const [admitDeposit, setAdmitDeposit] = useState({ amount: '', payment_method: 'cash', collect_deposit: false });

  // Custom admission date
  const [customAdmitDate, setCustomAdmitDate] = useState(false);
  const [admitDateValue, setAdmitDateValue] = useState('');

  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveMenuId(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => {
      window.removeEventListener('click', handleOutsideClick);
    };
  }, []);

  // Debounce the patient search term
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPatientSearch(patientSearch), 300);
    return () => clearTimeout(timer);
  }, [patientSearch]);

  // Debounce the main admissions search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page when filter or search changes
  useEffect(() => {
    setPage(1);
  }, [filter, debouncedSearch]);

  // ─── Queries ────────────────────────────────────────────────────────────────

  const admissionsQuery = useApiQuery<AdmissionsResponse>(
    queryKeys.admissions.list({ filter, search: debouncedSearch, page }),
    `/api/admissions?status=${filter}&search=${encodeURIComponent(debouncedSearch)}&page=${page}&perPage=${perPage}`,
  );

  // Discharged patients query (always fetches discharged, independent of main filter)
  const dischargedQuery = useApiQuery<AdmissionsResponse>(
    [...queryKeys.admissions.all, 'discharged', dischargedPage],
    `/api/admissions?status=discharged&page=${dischargedPage}&perPage=10`,
    { enabled: showDischargedSection },
  );

  const statsQuery = useApiQuery<Stats>(
    queryKeys.admissions.stats(),
    '/api/admissions/stats',
  );

  const bedsQuery = useApiQuery<BedsResponse>(
    [...queryKeys.admissions.beds({ status: 'available' }), 'pricing'],
    '/api/admissions/available-beds-with-pricing',
  );

  const dischargeConditionsQuery = useApiQuery<{ conditions: DischargeCondition[] }>(
    [...queryKeys.admissions.all, 'discharge-conditions'],
    '/api/admissions/discharge-conditions',
  );

  const pendingTransfersQuery = useApiQuery<{ transfers: TransferInfo[] }>(
    [...queryKeys.admissions.all, 'pending-transfers'],
    '/api/admissions/pending-transfers',
  );

  const provisionalClearanceQuery = useApiQuery<{ provisional_discharges: ProvisionalDischarge[] }>(
    [...queryKeys.admissions.all, 'provisional-discharges'],
    '/api/admissions/provisional-discharges',
  );

  const birthConditionsQuery = useApiQuery<{ birth_conditions: BirthCondition[] }>(
    [...queryKeys.admissions.all, 'birth-conditions'],
    '/api/admissions/birth-conditions',
  );

  const patientSearchQuery = useApiQuery<PatientsResponse>(
    queryKeys.patients.list({ search: debouncedPatientSearch, limit: 8 }),
    `/api/patients?search=${encodeURIComponent(debouncedPatientSearch)}&limit=8`,
    { enabled: debouncedPatientSearch.length >= 2 },
  );

  const departmentsQuery = useApiQuery<{ departments: Department[] }>(
    ['departments'],
    '/api/billing/departments',
  );

  const transferHistoryQuery = useApiQuery<{ transfers: TransferHistoryEntry[] }>(
    ['admissions', selectedAdmission?.id, 'transfers'],
    `/api/admissions/${selectedAdmission?.id}/transfers`,
    { enabled: !!selectedAdmission?.id },
  );

  // Danphe-style: today's OPD visits for quick admission
  const todayStr = new Date().toISOString().split('T')[0];
  interface TodayVisit { id: number; patient_id: number; patient_name: string; patient_code?: string; doctor_id?: number; doctor_name?: string; visit_type?: string; }
  const todayVisitsQuery = useApiQuery<{ visits: TodayVisit[] }>(
    [...queryKeys.reception.visits(todayStr), 'admit-modal'],
    `/api/reception/visits?date=${todayStr}`,
    { enabled: showAdmitModal },
  );

  // Billing status for discharge modal
  const billingDetailQuery = useApiQuery<{
    bill_status_on_discharge: string;
    pending: { provisional_amount: number; pending_service_amount: number; due_amount: number; total: number };
    deposit_balance: number;
    net_payable: number;
  }>(
    ['admissions', selectedAdmission?.id, 'billing-status'],
    `/api/admissions/${selectedAdmission?.id}/billing-status`,
    { enabled: !!selectedAdmission?.id && showDischargeModal },
  );

  const ipdPendingBillingQuery = useApiQuery<{
    summary?: IpdPendingSummary;
    financial_clearance?: IpdFinancialClearanceApi;
  }>(
    ['ip-billing', 'pending', selectedAdmission?.id, 'discharge-modal'],
    `/api/ip-billing/pending/${selectedAdmission?.id}`,
    { enabled: !!selectedAdmission?.id && showDischargeModal },
  );

  // Derived data with fallback for demo
  const loading = admissionsQuery.isLoading;
  const admissions = admissionsQuery.data?.admissions ?? [];
  const totalAdmissions = admissionsQuery.data?.total ?? 0;
  const currentPage = admissionsQuery.data?.page ?? page;
  const totalPages = Math.max(1, Math.ceil(totalAdmissions / perPage));
  const statsPayload = statsQuery.data as AdmissionStatsApiResponse | undefined;
  const statsNested = statsPayload?.stats ?? {};
  const stats: Stats = statsQuery.isError ? FALLBACK_STATS : {
    currentAdmissions: Number(statsPayload?.currentAdmissions ?? statsNested.currentAdmissions ?? statsNested.occupied ?? statsPayload?.admissions?.length ?? 0),
    totalBeds: Number(statsPayload?.totalBeds ?? statsNested.totalBeds ?? 0),
    availableBeds: Number(statsPayload?.availableBeds ?? statsNested.availableBeds ?? statsNested.available ?? 0),
    dischargesToday: Number(statsPayload?.dischargesToday ?? statsNested.dischargesToday ?? 0),
    avgStayDays: Number(statsPayload?.avgStayDays ?? statsNested.avgStayDays ?? 0),
  };
  const beds = bedsQuery.data?.beds ?? [];
  const dischargeConditions = dischargeConditionsQuery.data?.conditions ?? [];
  const pendingTransfers = pendingTransfersQuery.data?.transfers ?? [];
  const provisionalClearances = provisionalClearanceQuery.data?.provisional_discharges ?? [];
  const birthConditions = birthConditionsQuery.data?.birth_conditions ?? [];
  const patients = patientSearchQuery.data?.patients ?? [];
  const todayVisits = todayVisitsQuery.data?.visits ?? [];
  const departments = departmentsQuery.data?.departments ?? [];
  const transferHistory = transferHistoryQuery.data?.transfers ?? [];

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const admitMutation = useApiMutation<{ admission_no: string; admission_id: number }, AdmitPayload>(
    'post',
    '/api/admissions',
    {
      onSuccess: (data) => {
        toast.success(t('ipd.patientAdmitted', { admissionNo: data.admission_no }));
        setShowAdmitModal(false);
        setAdmitForm({ patient_id: 0, bed_id: 0, doctor_id: 0, care_of_name: '', care_of_phone: '', care_of_relation: '', admission_type: 'planned', admit_source: 'planned', referral_doctor: '', admission_reason: '', is_emergency: false, provisional_diagnosis: '', notes: '', department: '' });
        setPatientSearch('');
        setCustomAdmitDate(false);
        setAdmitDateValue('');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => {
        toast.error(err.message || t('toast.failedToAdmit'));
      },
    },
  );

  const dischargeMutation = useApiMutation<unknown, DischargePayload>(
    'put',
    (vars) => `/api/admissions/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('ipd.patientDischarged', { admissionNo: selectedAdmission?.admission_no }));
        setShowDischargeModal(false);
        if (isExpiredDischarge) {
          navigate(`${basePath}/death-records`);
        }
        setSelectedAdmission(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: () => {
        toast.error(t('ipd.failed_to_discharge_patient'));
      },
    },
  );

  const creditDischargeMutation = useApiMutation<unknown, { id: number; discharge_condition_id?: number; discharge_type?: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/credit-discharge`,
    {
      onSuccess: () => {
        toast.success(t('ipd.creditDischargeSuccess', { defaultValue: 'Patient discharged on credit' }));
        setShowDischargeModal(false);
        setSelectedAdmission(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: () => {
        toast.error(t('ipd.creditDischargeFailed', { defaultValue: 'Failed to discharge on credit' }));
      },
    },
  );

  // Cancel admission
  const cancelAdmissionMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/cancel`,
    {
      onSuccess: () => {
        toast.success(t('admissionCancelled', { defaultValue: 'Admission cancelled' }));
        setShowCancelModal(false);
        setSelectedAdmission(null);
        setCancelReason('');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => {
        toast.error(err.message || t('toast.failedToCancelAdmission'));
      },
    },
  );

  // Cancel discharge (re-admit)
  const cancelDischargeMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/cancel-discharge`,
    {
      onSuccess: () => {
        toast.success(t('dischargeCancelled', { defaultValue: 'Discharge cancelled, patient re-admitted' }));
        setShowCancelDischargeModal(false);
        setSelectedAdmission(null);
        setCancelReason('');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => {
        toast.error(err.message || t('toast.failedToCancelDischarge'));
      },
    },
  );

  // Provisional discharge
  const provisionalDischargeMutation = useApiMutation<unknown, { id: number; note?: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/provisional-discharge`,
    {
      onSuccess: () => {
        toast.success(t('provisionalDischargeMarked', { defaultValue: 'Patient marked for provisional discharge' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => {
        toast.error(err.message || t('toast.failedToMarkProvisional'));
      },
    },
  );

  const undoProvisionalDischargeMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/undo-provisional-discharge`,
    {
      onSuccess: () => {
        toast.success(t('provisionalDischargeUndone', { defaultValue: 'Provisional discharge undone' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => {
        toast.error(err.message || t('toast.failedToUndoProvisional'));
      },
    },
  );

  const receiveTransferMutation = useApiMutation<unknown, { id: number; reason?: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/receive-transfer`,
    {
      onSuccess: () => {
        toast.success(t('transferReceived', { defaultValue: 'Transfer received' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToReceiveTransfer')),
    },
  );

  const undoTransferMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/undo-transfer`,
    {
      onSuccess: () => {
        toast.success(t('transferUndone', { defaultValue: 'Transfer undone' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToUndoTransfer')),
    },
  );

  const transferBedMutation = useApiMutation<unknown, TransferBedPayload>(
    'put',
    (vars) => `/api/admissions/${vars.id}/transfer`,
    {
      onSuccess: () => {
        toast.success(transferForm.pending_receive
          ? t('transferRequested', { defaultValue: 'Bed transfer requested' })
          : t('transferCompleted', { defaultValue: 'Bed transfer completed' }));
        setShowTransferModal(false);
        setSelectedAdmission(null);
        setTransferForm({ new_bed_id: 0, reason: '', pending_receive: true });
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.beds({ status: 'available' }) });
        queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToTransferBed', { defaultValue: 'Failed to transfer bed' })),
    },
  );

  const clearProvisionalMutation = useApiMutation<unknown, { id: number; reason?: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/clear-provisional`,
    {
      onSuccess: () => {
        toast.success(t('provisionalCleared', { defaultValue: 'Provisional discharge cleared' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToClearProvisional')),
    },
  );

  const billingDischargeMutation = useApiMutation<unknown, { id: number; reason?: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/billing-discharge`,
    {
      onSuccess: () => {
        toast.success(t('billingDischargeMarked', { defaultValue: 'Billing discharge marked' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToMarkBillingDischarge')),
    },
  );

  const clearDueMutation = useApiMutation<unknown, { id: number; reason?: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/clear-due`,
    {
      onSuccess: () => toast.success(t('dueCleared', { defaultValue: 'Due amount cleared' })),
      onError: (err) => toast.error(err.message || t('toast.failedToClearDue')),
    },
  );

  const doctorMutation = useApiMutation<unknown, { id: number; doctor_id: number }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/doctor`,
    { onSuccess: () => { toast.success(t('toast.doctorUpdated')); queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all }); }, onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const procedureMutation = useApiMutation<unknown, { id: number; procedure_type: string }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/procedure`,
    { onSuccess: () => { toast.success(t('toast.procedureUpdated')); queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all }); }, onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const policeCaseMutation = useApiMutation<unknown, { id: number; is_police_case: boolean }>(
    'put',
    (vars) => `/api/admissions/${vars.id}/police-case`,
    { onSuccess: () => { toast.success(t('toast.policeCaseUpdated')); queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all }); }, onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const remarkMutation = useApiMutation<unknown, { id: number; remark: string }>(
    'post',
    (vars) => `/api/admissions/${vars.id}/remark`,
    { onSuccess: () => { toast.success(t('toast.remarkAdded')); setRemarkText(''); }, onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const birthMutation = useApiMutation<unknown, Record<string, unknown> & { id: number }>(
    'post',
    (vars) => `/api/admissions/${vars.id}/birth-details`,
    { onSuccess: () => toast.success(t('toast.birthDetailsRecorded')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const hemoMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/admissions/hemodialysis-reports',
    { onSuccess: () => toast.success(t('toast.hemodialysisReportSaved')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const autoBillingMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/admissions/adt/auto-billing-items',
    { onSuccess: () => toast.success(t('toast.autoBillingItemSaved')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const depositMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/admissions/adt/deposit-settings',
    { onSuccess: () => toast.success(t('toast.depositSettingSaved')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const schemeMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/admissions/adt/scheme-price-maps',
    { onSuccess: () => toast.success(t('toast.schemePriceMapSaved')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  // Danphe-style: collect deposit on admission
  const collectDepositMutation = useApiMutation<{ receiptNo: string; balance: number }, { patient_id: number; admission_id?: number; amount: number; payment_method: string; remarks?: string }>(
    'post',
    '/api/deposits',
    { onSuccess: (data) => {
      toast.success(t('toast.depositCollected', { receiptNo: data.receiptNo }));
      queryClient.invalidateQueries({ queryKey: queryKeys.deposits.all });
      queryClient.invalidateQueries({ queryKey: ['admissions'] });
    }, onError: (err) => toast.error(err.message || t('toast.failedToCollectDeposit')) },
  );

  const submitting = admitMutation.isPending || dischargeMutation.isPending || creditDischargeMutation.isPending || cancelAdmissionMutation.isPending || cancelDischargeMutation.isPending || provisionalDischargeMutation.isPending || undoProvisionalDischargeMutation.isPending || receiveTransferMutation.isPending || undoTransferMutation.isPending || transferBedMutation.isPending || clearProvisionalMutation.isPending || collectDepositMutation.isPending;

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
  };

  const openTransferModal = (admission: Admission) => {
    setSelectedAdmission(admission);
    setTransferForm({ new_bed_id: 0, reason: '', pending_receive: true });
    setShowTransferModal(true);
  };

  const handleTransferBed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmission) return;
    if (!transferForm.new_bed_id) {
      toast.error(t('selectNewBed', { defaultValue: 'Select a new available bed' }));
      return;
    }
    transferBedMutation.mutate({
      id: selectedAdmission.id,
      new_bed_id: Number(transferForm.new_bed_id),
      reason: transferForm.reason.trim() || undefined,
      pending_receive: transferForm.pending_receive,
    });
  };

  const handleQuickDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickDepositForm.patient_id || !quickDepositForm.amount) {
      toast.error(t('toast.patientAndAmountRequired'));
      return;
    }
    collectDepositMutation.mutate({
      patient_id: quickDepositForm.patient_id,
      admission_id: selectedAdmission?.id,
      amount: Number(quickDepositForm.amount),
      payment_method: quickDepositForm.payment_method,
      remarks: quickDepositForm.remarks || `Deposit from admissions list`,
    }, {
      onSuccess: (data) => {
        setShowQuickDepositModal(false);
        setQuickDepositForm({ patient_id: 0, amount: '', payment_method: 'cash', remarks: '' });
        // Print deposit receipt
        printDepositReceipt({
          receiptNo: data.receiptNo,
          date: new Date().toISOString(),
          patientName: selectedAdmission?.patient_name ?? 'Patient',
          patientCode: selectedAdmission?.patient_code,
          amount: Number(quickDepositForm.amount),
          paymentMethod: quickDepositForm.payment_method,
          remarks: quickDepositForm.remarks || undefined,
        });
      },
    });
  };

  const handleAdmit = () => {
    if (!admitForm.patient_id) {
      toast.error(t('ipd.please_select_a_patient'));
      return;
    }
    const body: AdmitPayload = {
      patient_id: admitForm.patient_id,
      admission_type: admitForm.admission_type,
      admit_source: admitForm.admit_source,
      is_emergency: admitForm.is_emergency,
      idempotencyKey: `ipd-admission-${admitForm.patient_id}-${crypto.randomUUID()}`,
    };
    if (admitForm.bed_id) body.bed_id = admitForm.bed_id;
    if (admitForm.doctor_id) body.doctor_id = admitForm.doctor_id;
    if (admitForm.provisional_diagnosis) body.provisional_diagnosis = admitForm.provisional_diagnosis;
    if (admitForm.referral_doctor) body.referral_doctor = admitForm.referral_doctor;
    if (admitForm.admission_reason) body.admission_reason = admitForm.admission_reason;
    if (admitForm.notes) body.notes = admitForm.notes;
    if (admitForm.care_of_name) body.care_of_name = admitForm.care_of_name;
    if (admitForm.care_of_phone) body.care_of_phone = admitForm.care_of_phone;
    if (admitForm.care_of_relation) body.care_of_relation = admitForm.care_of_relation;
    if (customAdmitDate && admitDateValue) body.admission_date = new Date(admitDateValue).toISOString();
    if (admitForm.department) body.department = admitForm.department;

    admitMutation.mutate(body, {
      onSuccess: (data) => {
        toast.success(t('ipd.patientAdmitted', { admissionNo: data.admission_no }));
        const admissionSlipPath = getAdmissionSlipPrintPath(admissionBasePath, data.admission_id);
        const shouldCollectDeposit = admitDeposit.collect_deposit && Number(admitDeposit.amount) > 0;
        // Danphe-style: collect deposit on admission
        if (shouldCollectDeposit) {
          const admittedPatient = patients.find(p => p.id === admitForm.patient_id);
          collectDepositMutation.mutate({
            patient_id: admitForm.patient_id,
            admission_id: data.admission_id,
            amount: Number(admitDeposit.amount),
            payment_method: admitDeposit.payment_method,
            remarks: `Admission deposit for ${data.admission_no}`,
          }, {
            onSuccess: (depData) => {
              queryClient.invalidateQueries({ queryKey: queryKeys.deposits.all });
              queryClient.invalidateQueries({ queryKey: ['admissions'] });
              printDepositReceipt({
                receiptNo: depData.receiptNo,
                date: new Date().toISOString(),
                patientName: admittedPatient?.name ?? 'Patient',
                patientCode: admittedPatient?.patient_code,
                amount: Number(admitDeposit.amount),
                paymentMethod: admitDeposit.payment_method,
                remarks: `Admission deposit for ${data.admission_no}`,
              });
            },
            onError: (err) => {
              toast.error(t('toast.depositCollectionFailed', { admissionNo: data.admission_no }));
              console.error(`[AdmissionIPD] Deposit collection failed for admission ${data.admission_no}:`, err.message);
              queryClient.invalidateQueries({ queryKey: queryKeys.deposits.all });
              queryClient.invalidateQueries({ queryKey: ['admissions'] });
            },
            onSettled: () => navigate(admissionSlipPath),
          });
        }
        setShowAdmitModal(false);
        setAdmitForm({ patient_id: 0, bed_id: 0, doctor_id: 0, care_of_name: '', care_of_phone: '', care_of_relation: '', admission_type: 'planned', admit_source: 'planned', referral_doctor: '', admission_reason: '', is_emergency: false, provisional_diagnosis: '', notes: '', department: '' });
        setPatientSearch('');
        setAdmitDeposit({ amount: '', payment_method: 'cash', collect_deposit: false });
        setCustomAdmitDate(false);
        setAdmitDateValue('');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
        if (!shouldCollectDeposit) {
          navigate(admissionSlipPath);
        }
      },
    });
  };

  const handleDischarge = () => {
    if (!selectedAdmission) return;
    if (!dischargeForm.discharge_condition_id) {
      toast.error(t('dischargeConditionRequired', { defaultValue: 'Select discharge condition' }));
      return;
    }
    // Block discharge if billing is not cleared
    if ((billingDetailQuery.data?.pending?.total ?? 0) > 0) {
      toast.error(t('billingNotCleared', { defaultValue: 'Cannot discharge: billing not cleared. Outstanding balance must be settled.' }));
      return;
    }
    dischargeMutation.mutate({
      id: selectedAdmission.id,
      status: 'discharged',
      discharge_condition_id: dischargeForm.discharge_condition_id,
      discharge_type: dischargeForm.discharge_type,
    });
  };

  const handlePrintAdmissionSlip = (a: Admission) => {
    navigate(getAdmissionSlipPrintPath(admissionBasePath, a.id));
  };

  const handlePrintDischargeSlip = async (a: Admission) => {
    try {
      const res = await api.get<{ slip: Record<string, any> }>(`/api/discharge/${a.id}/slip`);
      const s = res.slip;
      const admDate = new Date(s.admission_date ?? a.admission_date);
      const disDate = new Date(s.discharge_date ?? a.discharge_date ?? new Date());
      const los = Math.max(1, Math.ceil((disDate.getTime() - admDate.getTime()) / 86400000));
      printDischargeSlip({
        admissionNo: s.admission_no ?? a.admission_no,
        admissionDate: s.admission_date ?? a.admission_date,
        dischargeDate: s.discharge_date ?? a.discharge_date ?? new Date().toISOString(),
        lengthOfStay: los,
        dischargeCondition: s.discharge_condition_name ?? s.discharge_condition ?? s.summary_discharge_type ?? s.discharge_type,
        patient: {
          name: s.patient_name ?? a.patient_name,
          patientCode: s.patient_code ?? a.patient_code,
          gender: s.gender,
          dateOfBirth: s.date_of_birth,
          mobile: s.mobile,
          bloodGroup: s.blood_group,
          address: s.address,
        },
        ward: s.ward_name ?? a.ward_name,
        bed: s.bed_number ?? a.bed_number,
        doctor: s.doctor_name ?? a.doctor_name,
        provisionalDiagnosis: s.provisional_diagnosis ?? a.provisional_diagnosis,
        finalDiagnosis: s.final_diagnosis,
        guardian: { name: s.care_of_name, phone: s.care_of_phone, relation: s.care_of_relation },
      });
    } catch {
      toast.error(t('printFailed', { defaultValue: 'Failed to load slip data' }));
    }
  };

  const handlePrintWristband = async (a: Admission) => {
    try {
      const res = await api.get<{ wristband: Record<string, any> }>(`/api/admissions/${a.id}/wristband`);
      const w = res.wristband;
      printHtml('IP Wristband', `
        <div class="label wrist">
          <div>
            <h1>${escapeHtml(w.patient_name ?? a.patient_name)}</h1>
            <p>${escapeHtml(w.patient_code ?? a.patient_code)} · ${escapeHtml(w.gender ?? '')} · Blood: ${escapeHtml(w.blood_group ?? '-')}</p>
            <p>${escapeHtml(w.ward_name ?? a.ward_name)} / ${escapeHtml(w.bed_number ?? a.bed_number)} · ${escapeHtml(w.admission_no ?? a.admission_no)}</p>
            <p>Allergies: ${escapeHtml(w.allergies ?? 'NKA')}</p>
          </div>
          <div class="barcode">${escapeHtml(w.barcode ?? a.admission_no)}</div>
        </div>
      `);
    } catch {
      toast.error(t('printFailed', { defaultValue: 'Failed to load print data' }));
    }
  };

  const handlePrintSticker = async (a: Admission) => {
    try {
      const res = await api.get<{ sticker: Record<string, any> }>(`/api/admissions/${a.id}/sticker`);
      const s = res.sticker;
      printHtml('Admission Sticker', `
        <div class="label">
          <h1>${escapeHtml(s.patient_name ?? a.patient_name)}</h1>
          <p>${escapeHtml(s.patient_code ?? a.patient_code)} · ${escapeHtml(s.gender ?? '')} · ${escapeHtml(s.blood_group ?? '')}</p>
          <p>${escapeHtml(s.admission_no ?? a.admission_no)} · ${escapeHtml(s.ward_name ?? a.ward_name)}/${escapeHtml(s.bed_number ?? a.bed_number)}</p>
          <p>${escapeHtml(s.doctor_name ?? a.doctor_name ?? '')}</p>
        </div>
      `);
    } catch {
      toast.error(t('printFailed', { defaultValue: 'Failed to load print data' }));
    }
  };

  const selectedDischargeCondition = dischargeConditions.find(c => c.id === dischargeForm.discharge_condition_id);
  const isExpiredDischarge = /expired|death/i.test(selectedDischargeCondition?.name ?? dischargeForm.discharge_type);

  const parseMaybeNumber = (value: string) => value === '' ? undefined : Number(value);

  const handleBirthSubmit = () => {
    const admissionId = Number(birthForm.admission_id);
    const patientId = Number(birthForm.patient_id);
    if (!admissionId || !patientId || !birthForm.birth_date) {
      toast.error(t('toast.birthFieldsRequired'));
      return;
    }
    birthMutation.mutate({
      id: admissionId,
      admission_id: admissionId,
      patient_id: patientId,
      birth_condition_id: birthForm.birth_condition_id ? Number(birthForm.birth_condition_id) : undefined,
      baby_name: birthForm.baby_name || undefined,
      sex: birthForm.sex || undefined,
      weight_kg: parseMaybeNumber(birthForm.weight_kg),
      birth_date: birthForm.birth_date,
      birth_time: birthForm.birth_time || undefined,
      birth_type: birthForm.birth_type || undefined,
      delivery_type: birthForm.delivery_type || undefined,
      apgar_score: birthForm.apgar_score || undefined,
      remarks: birthForm.remarks || undefined,
    });
  };

  const handleHemoSubmit = () => {
    const admissionId = Number(hemoForm.admission_id);
    const patientId = Number(hemoForm.patient_id);
    if (!admissionId || !patientId) {
      toast.error(t('toast.admissionAndPatientRequired'));
      return;
    }
    hemoMutation.mutate({
      admission_id: admissionId,
      patient_id: patientId,
      report_date: hemoForm.report_date,
      pre_weight: parseMaybeNumber(hemoForm.pre_weight),
      post_weight: parseMaybeNumber(hemoForm.post_weight),
      pre_bp: hemoForm.pre_bp || undefined,
      post_bp: hemoForm.post_bp || undefined,
      dialysis_duration_min: hemoForm.dialysis_duration_min ? Number(hemoForm.dialysis_duration_min) : undefined,
      access_type: hemoForm.access_type || undefined,
      blood_flow_rate: parseMaybeNumber(hemoForm.blood_flow_rate),
      dialysate_flow_rate: parseMaybeNumber(hemoForm.dialysate_flow_rate),
      complications: hemoForm.complications || undefined,
    });
  };

  const handleCertificatePrint = async (admissionId: string, type: 'birth' | 'death') => {
    if (!admissionId) { toast.error(t('toast.admissionIdRequired')); return; }
    try {
      const res = await api.get<Record<string, Record<string, any>>>(`/api/admissions/${admissionId}/${type}-certificate`);
      const data = res[`${type}_certificate`] ?? res;
      printHtml(`${type} certificate`, `
        <div class="label">
          <h1>${type === 'birth' ? 'Birth Certificate' : 'Death Certificate'}</h1>
          <p>Admission: ${escapeHtml(data.admission_no ?? admissionId)}</p>
          <p>Patient: ${escapeHtml(data.patient_name ?? '')} (${escapeHtml(data.patient_code ?? '')})</p>
          <p>${type === 'birth' ? 'Baby' : 'Cause'}: ${escapeHtml(data.baby_name ?? data.cause_of_death ?? '')}</p>
          <p>Date: ${escapeHtml(data.birth_date ?? data.date_of_death ?? '')} ${escapeHtml(data.birth_time ?? data.time_of_death ?? '')}</p>
          <p>Certificate No: ${escapeHtml(data.certificate_number ?? data.death_certificate_no ?? '')}</p>
        </div>
      `);
    } catch {
      toast.error(type === 'birth' ? t('toast.failedToLoadBirthCert') : t('toast.failedToLoadDeathCert'));
    }
  };

  // KPI data
  const kpis = [
    { label: t('currentAdmissions'), value: stats.currentAdmissions, icon: <Users className="w-5 h-5 text-blue-500" />, bg: 'bg-blue-50' },
    { label: t('availableBeds'), value: `${stats.availableBeds}/${stats.totalBeds}`, icon: <BedDouble className="w-5 h-5 text-green-500" />, bg: 'bg-green-50' },
    { label: t('avgStayDays', { defaultValue: 'Avg Stay (days)' }), value: typeof stats.avgStayDays === 'number' && !isNaN(stats.avgStayDays) ? stats.avgStayDays.toFixed(1) : '0.0', icon: <Clock className="w-5 h-5 text-amber-500" />, bg: 'bg-amber-50' },
    { label: t('dischargesToday', { defaultValue: 'Discharges Today' }), value: stats.dischargesToday, icon: <TrendingUp className="w-5 h-5 text-purple-500" />, bg: 'bg-purple-50' },
  ];

  const FILTERS: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: t('all', { ns: 'common' }) },
    { id: 'admitted', label: t('admitted') },
    { id: 'critical', label: t('critical', { defaultValue: 'Critical' }) },
    { id: 'discharged', label: t('discharged') },
    { id: 'transferred', label: t('transferred', { defaultValue: 'Transferred' }) },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {role === 'reception' ? <ReceptionTopBar role={role} /> : null}

        {/* Breadcrumb + Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('dashboard', { ns: 'common' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('title')}</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{role === 'reception' ? t('heading.admissionDesk') : t('title')}</h1>
            {role === 'reception' ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('info.deskDescription')}</p> : null}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdmitModal(true)} className="btn-primary">
              <UserPlus className="w-4 h-4" /> {t('admitPatient', { defaultValue: 'Admit Patient' })}
            </button>
            <button onClick={handleRefresh} className="btn-ghost p-2" aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <HelpButton onClick={() => setHelpOpen(true)} />
            <WhatsAppButton />
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(k => (
            <div key={k.label} className="card p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.bg}`}>
                {k.icon}
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--color-text)]">{k.value}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{k.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters + Search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden text-sm">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 transition-colors ${filter === f.id
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t("searchPatientBedAdmission")}
              value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
        </div>

        {admissionsQuery.isError && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mb-3" />
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('heading.failedToLoadAdmissions')}</h3>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">{t('info.couldNotConnect')}</p>
            <button onClick={() => admissionsQuery.refetch()} className="mt-4 btn btn-primary">{t('btn.retry')}</button>
          </div>
        )}

        {/* Admissions Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[var(--color-text-muted)]">{t('loading', { ns: 'common' })}</div>
          ) : admissions.length === 0 ? (
            <div className="p-12 text-center">
              <BedDouble className="w-10 h-10 mx-auto mb-2 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-[var(--color-text-muted)]">{t('noAdmissions', { defaultValue: 'No admissions found' })}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg)]">
                  <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                    <th className="text-left px-4 py-3 font-medium">{t('admissionNo')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('patient', { ns: 'common' })}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('wardBed')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('doctor', { ns: 'common' })}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admitted')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('admissionType')}</th>
                    <th className="text-left px-4 py-3 font-medium">{t('provisionalDiagnosis')}</th>
                    <th className="text-center px-4 py-3 font-medium">{t('status', { ns: 'common' })}</th>
                    <th className="text-center px-4 py-3 font-medium">{t('actions', { ns: 'common' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {admissions.map((a, index) => {
                    const isLastRows = index >= admissions.length - 2 && admissions.length > 2;
                    const isFirstDischarged = a.status === 'discharged' && (index === 0 || admissions[index - 1].status !== 'discharged');
                    return (
                      <Fragment key={a.id}>
                        {filter === 'all' && isFirstDischarged && (
                          <tr className="bg-slate-50/50">
                            <td colSpan={9} className="px-4 py-2 border-y border-gray-200">
                              <div className="flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                  {t('dischargedPatientsSection', { defaultValue: 'Discharged Patients / ছাড়প্রাপ্ত রোগী' })}
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-[var(--color-bg)] transition-colors">
                      <td className="px-4 py-3 font-mono font-medium text-[var(--color-primary)]">{a.admission_no}</td>
                      <td className="px-4 py-3">
                        <Link to={`${basePath}/patients/${a.patient_id}`} className="text-[var(--color-text)] font-medium hover:text-[var(--color-primary)]">
                          {a.patient_name}
                        </Link>
                        <p className="text-xs text-[var(--color-text-muted)]">{a.patient_code}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {a.ward_name && a.bed_number ? `${a.ward_name} — ${a.bed_number}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{a.doctor_name || '—'}</td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{fmt(a.admission_date)}</td>
	                      <td className="px-4 py-3">
	                        <div className="flex flex-col gap-1">
	                          <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5 w-fit">{TYPE_LABELS[a.admission_type] ?? a.admission_type}</span>
	                          {a.admit_source && (
	                            <span className="text-[10px] text-[var(--color-text-muted)]">{SOURCE_LABELS[a.admit_source] ?? a.admit_source}</span>
	                          )}
	                        </div>
	                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)] max-w-[150px] truncate" title={a.provisional_diagnosis ?? ''}>
                        {a.provisional_diagnosis || '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`text-xs rounded-full px-2 py-0.5 font-medium capitalize ${STATUS_STYLES[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {a.status}
                          </span>
                          {a.is_provisional_discharge === 1 && (
                            <span className="text-[10px] rounded-full px-1.5 py-0.5 font-medium bg-violet-100 text-violet-700">
                              {t('status.provDischarge')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 relative">
                        <div className="flex items-center justify-center gap-1.5">
                          <EmergencyAdmissionPatientEditAction
                            admission={{
                              patientId: a.patient_id,
                              admissionType: a.admission_type,
                              admitSource: a.admit_source,
                              isEmergency: a.is_emergency,
                            }}
                            onEdit={(patientId) => navigate(`${basePath}/patients/${patientId}`)}
                          />
                          {/* State-specific primary actions */}
                          {(a.status === 'admitted' || a.status === 'critical') && (
                            <>
                              <button onClick={() => { setSelectedAdmission(a); setQuickDepositForm({ patient_id: a.patient_id, amount: '', payment_method: 'cash', remarks: '' }); setShowQuickDepositModal(true); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 hover:border-teal-300 transition-colors shadow-xs cursor-pointer"
                                title={t('collectDeposit', { defaultValue: 'Collect Deposit' })}>
                                <Wallet className="w-3.5 h-3.5" /> {t('deposit', { defaultValue: 'Deposit' })}
                              </button>
                              <button onClick={() => openTransferModal(a)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-colors shadow-xs cursor-pointer">
                                <RefreshCw className="w-3.5 h-3.5" /> {t('transferBed', { defaultValue: 'Transfer Bed' })}
                              </button>
                              <button onClick={() => { setSelectedAdmission(a); setDischargeForm({ discharge_condition_id: 0, discharge_type: 'Normal' }); setShowDischargeModal(true); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 transition-colors shadow-xs cursor-pointer">
                                <LogOut className="w-3.5 h-3.5" /> {t('dischargePatient')}
                              </button>
                            </>
                          )}
                          {a.status === 'discharged' && (
                            <>
                              <button onClick={() => handlePrintDischargeSlip(a)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 hover:border-green-300 transition-colors shadow-xs cursor-pointer"
                                title={t('printDischargeSlip', { defaultValue: 'Print Discharge Slip' })}>
                                <Printer className="w-3.5 h-3.5" /> {t('slip', { defaultValue: 'Slip' })}
                              </button>
                              <button onClick={() => { setSelectedAdmission(a); setShowCancelDischargeModal(true); setCancelReason(''); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors shadow-xs cursor-pointer">
                                <RefreshCw className="w-3.5 h-3.5" /> {t('undoDischarge', { defaultValue: 'Undo Discharge' })}
                              </button>
                            </>
                          )}

                          {/* More actions dropdown toggle */}
                          <button 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setActiveMenuId(activeMenuId === a.id ? null : a.id); 
                            }}
                            className="p-1 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 border border-gray-250 transition-all cursor-pointer flex items-center justify-center"
                            title={t('more', { defaultValue: 'More Actions' })}
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>

                          {/* Dropdown Menu */}
                          {activeMenuId === a.id && (
                            <div 
                              className={`absolute right-4 ${isLastRows ? 'bottom-full mb-1' : 'top-full mt-1'} w-56 rounded-xl bg-white border border-gray-200 shadow-xl z-50 divide-y divide-gray-100 py-1`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="py-1">
                                <button 
                                  onClick={() => { setActiveMenuId(null); handlePrintAdmissionSlip(a); }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                                >
                                  <Printer className="w-3.5 h-3.5 text-gray-455" />
                                  {t('printAdmissionSlip', { defaultValue: 'Print Admission Slip' })}
                                </button>
                                <button 
                                  onClick={() => { setActiveMenuId(null); handlePrintSticker(a); }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                                >
                                  <Printer className="w-3.5 h-3.5 text-gray-455" />
                                  {t('printSticker', { defaultValue: 'Print Sticker' })}
                                </button>
                                <button 
                                  onClick={() => { setActiveMenuId(null); handlePrintWristband(a); }}
                                  className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors text-left cursor-pointer"
                                >
                                  <Printer className="w-3.5 h-3.5 text-gray-455" />
                                  {t('printWristband', { defaultValue: 'Print Wristband' })}
                                </button>
                              </div>

                              {(a.status === 'admitted' || a.status === 'critical') && (
                                <div className="py-1">
                                  <button
                                    onClick={() => { setActiveMenuId(null); openTransferModal(a); }}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50 transition-colors text-left cursor-pointer"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                                    {t('transferBed', { defaultValue: 'Transfer Bed' })}
                                  </button>

                                  {!a.is_provisional_discharge ? (
                                    <button 
                                      onClick={() => { setActiveMenuId(null); provisionalDischargeMutation.mutate({ id: a.id }); }}
                                      className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors text-left cursor-pointer"
                                    >
                                      <ClipboardCheck className="w-3.5 h-3.5 text-violet-500" />
                                      {t('provDischarge', { defaultValue: 'Provisional Discharge' })}
                                    </button>
                                  ) : (
                                    <button 
                                      onClick={() => { setActiveMenuId(null); undoProvisionalDischargeMutation.mutate({ id: a.id, reason: 'Undo by user' }); }}
                                      className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-violet-650 hover:bg-violet-50 transition-colors text-left cursor-pointer"
                                    >
                                      <ClipboardCheck className="w-3.5 h-3.5 text-violet-400" />
                                      {t('undoProv', { defaultValue: 'Undo Provisional' })}
                                    </button>
                                  )}
                                  
                                  <button 
                                    onClick={() => { setActiveMenuId(null); setSelectedAdmission(a); setShowCancelModal(true); setCancelReason(''); }}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors text-left cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5 text-red-500" />
                                    {t('cancelAdmission', { defaultValue: 'Cancel Admission' })}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
                </tbody>
              </table>
              {/* Pagination */}
              {!loading && admissions.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
                  <span className="text-sm text-[var(--color-text-muted)]">
                    {t('showing', { defaultValue: 'Showing' })} {(page - 1) * perPage + 1}–{Math.min(page * perPage, totalAdmissions)} {t('of', { defaultValue: 'of' })} {totalAdmissions.toLocaleString()} {t('admissions', { defaultValue: 'admissions' })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage(p => p - 1)}
                      className="btn-ghost text-sm disabled:opacity-40"
                    >← {t('prev', { ns: 'common', defaultValue: 'Prev' })}</button>
                    {[...Array(Math.min(5, totalPages))].map((_, i) => {
                      const pg = i + 1;
                      return (
                        <button key={pg} onClick={() => setPage(pg)}
                          className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                            pg === page ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                          }`}>
                          {pg}
                        </button>
                      );
                    })}
                    <button
                      disabled={page === totalPages}
                      onClick={() => setPage(p => p + 1)}
                      className="btn-ghost text-sm disabled:opacity-40"
                    >{t('next', { ns: 'common', defaultValue: 'Next' })} →</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Discharged Patients Section */}
        <div className="card overflow-hidden">
          <button
            onClick={() => setShowDischargedSection(!showDischargedSection)}
            className="w-full flex items-center justify-between p-4 hover:bg-[var(--color-bg)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {t('dischargedPatients', { defaultValue: 'Discharged Patients' })}
              </h2>
              {dischargedQuery.data && (
                <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                  {dischargedQuery.data.total ?? 0}
                </span>
              )}
            </div>
            <ChevronRight className={`w-4 h-4 transition-transform ${showDischargedSection ? 'rotate-90' : ''}`} />
          </button>

          {showDischargedSection && (
            <div className="border-t border-[var(--color-border)]">
              {dischargedQuery.isLoading ? (
                <div className="p-8 text-center text-[var(--color-text-muted)]">{t('loading', { ns: 'common' })}</div>
              ) : (dischargedQuery.data?.admissions ?? []).length === 0 ? (
                <div className="p-8 text-center text-[var(--color-text-muted)]">
                  {t('noDischargedPatients', { defaultValue: 'No discharged patients' })}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-green-50/50">
                        <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                          <th className="text-left px-4 py-2 font-medium">{t('admissionNo')}</th>
                          <th className="text-left px-4 py-2 font-medium">{t('patient', { ns: 'common' })}</th>
                          <th className="text-left px-4 py-2 font-medium">{t('doctor', { ns: 'common' })}</th>
                          <th className="text-left px-4 py-2 font-medium">{t('admitted')}</th>
                          <th className="text-left px-4 py-2 font-medium">{t('discharged', { defaultValue: 'Discharged' })}</th>
                          <th className="text-center px-4 py-2 font-medium">{t('actions', { ns: 'common' })}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border)]">
                        {(dischargedQuery.data?.admissions ?? []).map((a) => (
                          <tr key={a.id} className="hover:bg-[var(--color-bg)] transition-colors">
                            <td className="px-4 py-2 font-mono font-medium text-[var(--color-primary)]">{a.admission_no}</td>
                            <td className="px-4 py-2">
                              <Link to={`${basePath}/patients/${a.patient_id}`} className="text-[var(--color-text)] font-medium hover:text-[var(--color-primary)]">
                                {a.patient_name}
                              </Link>
                              <p className="text-xs text-[var(--color-text-muted)]">{a.patient_code}</p>
                            </td>
                            <td className="px-4 py-2 text-[var(--color-text-muted)]">{a.doctor_name || '—'}</td>
                            <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">{fmt(a.admission_date)}</td>
                            <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">{a.discharge_date ? fmt(a.discharge_date) : '—'}</td>
                            <td className="px-4 py-2">
                              <div className="flex items-center justify-center gap-1.5">
                                <button onClick={() => handlePrintDischargeSlip(a)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors">
                                  <Printer className="w-3 h-3" /> {t('slip', { defaultValue: 'Slip' })}
                                </button>
                                <button onClick={() => { setSelectedAdmission(a); setShowCancelDischargeModal(true); setCancelReason(''); }}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors">
                                  <RefreshCw className="w-3 h-3" /> {t('undoDischarge', { defaultValue: 'Undo' })}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Discharged Pagination */}
                  {(dischargedQuery.data?.total ?? 0) > 10 && (
                    <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-border)]">
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {t('showing', { defaultValue: 'Showing' })} {(dischargedPage - 1) * 10 + 1}–{Math.min(dischargedPage * 10, dischargedQuery.data?.total ?? 0)} {t('of', { defaultValue: 'of' })} {(dischargedQuery.data?.total ?? 0).toLocaleString()}
                      </span>
                      <div className="flex items-center gap-1">
                        <button disabled={dischargedPage === 1} onClick={() => setDischargedPage(p => p - 1)}
                          className="btn-ghost text-xs disabled:opacity-40">← {t('prev', { ns: 'common', defaultValue: 'Prev' })}</button>
                        <button disabled={(dischargedQuery.data?.total ?? 0) <= dischargedPage * 10} onClick={() => setDischargedPage(p => p + 1)}
                          className="btn-ghost text-xs disabled:opacity-40">{t('next', { ns: 'common', defaultValue: 'Next' })} →</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Pending Transfers + Billing Clearance */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
              <Undo2 className="w-4 h-4 text-amber-600" /> {t('pendingTransfers', { defaultValue: 'Pending Transfers' })}
            </h2>
            {pendingTransfers.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">{t('noPendingTransfers', { defaultValue: 'No pending transfers' })}</p>
            ) : pendingTransfers.map(tr => (
              <div key={tr.id} className="flex items-center justify-between gap-3 py-2 border-b border-[var(--color-border)] last:border-0">
                <div>
                  <p className="text-sm font-medium">{tr.patient_name} · {tr.admission_no}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {tr.previous_ward}/{tr.previous_bed} → {tr.receiving_ward}/{tr.receiving_bed}
                  </p>
                </div>
                <button onClick={() => receiveTransferMutation.mutate({ id: tr.id, reason: 'Received by ward' })}
                  className="btn-primary text-xs">
                  <CheckCircle className="w-3 h-3" /> {t('receive', { defaultValue: 'Receive' })}
                </button>
              </div>
            ))}
          </div>

          <div className="card p-4">
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-violet-600" /> {t('pendingClearance', { defaultValue: 'Pending Provisional Clearance' })}
            </h2>
            {provisionalClearances.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">{t('noPendingClearance', { defaultValue: 'No pending clearance' })}</p>
            ) : provisionalClearances.map(pd => (
              <div key={pd.id} className="flex items-center justify-between gap-3 py-2 border-b border-[var(--color-border)] last:border-0">
                <div>
                  <p className="text-sm font-medium">{pd.patient_name} · {pd.admission_no}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{pd.ward_name}/{pd.bed_number} · {pd.billing_status ?? 'pending'}</p>
                </div>
                <button onClick={() => clearProvisionalMutation.mutate({ id: pd.admission_id, reason: 'Billing cleared' })}
                  className="btn-primary text-xs">
                  <CheckCircle className="w-3 h-3" /> {t('clear', { defaultValue: 'Clear' })}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Transfer History */}
        {selectedAdmission && transferHistory.length > 0 && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" /> {t('transferHistory', { defaultValue: 'Transfer History' })} — {selectedAdmission.patient_name} ({selectedAdmission.admission_no})
            </h2>
            <div className="relative pl-4 border-l-2 border-[var(--color-border)] space-y-4">
              {transferHistory.map((tr) => (
                <div key={tr.id} className="relative">
                  <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text)]">
                        {tr.from_ward && tr.from_bed ? `${tr.from_ward} / ${tr.from_bed}` : t('admission', { defaultValue: 'Admission' })}
                        {' → '}
                        {tr.to_ward && tr.to_bed ? `${tr.to_ward} / ${tr.to_bed}` : '—'}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {t('transferredAt', { defaultValue: 'Transferred' })}: {fmt(tr.transfer_date)}
                        {tr.received_date && ` · ${t('receivedAt', { defaultValue: 'Received' })}: ${fmt(tr.received_date)}`}
                      </p>
                    </div>
                    {tr.duration_minutes != null && (
                      <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-2 py-0.5 font-medium">
                        {tr.duration_minutes >= 1440
                          ? `${Math.floor(tr.duration_minutes / 1440)}d ${Math.floor((tr.duration_minutes % 1440) / 60)}h`
                          : tr.duration_minutes >= 60
                            ? `${Math.floor(tr.duration_minutes / 60)}h ${tr.duration_minutes % 60}m`
                            : `${tr.duration_minutes}m`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Advanced ADT Actions */}
        <div className="card p-4 space-y-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
            <Settings className="w-4 h-4 text-[var(--color-primary)]" /> {t('advancedAdt', { defaultValue: 'Advanced ADT Actions' })}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <input className="input text-sm" placeholder={t('label.admissionId')} value={advancedAdmissionId} onChange={e => setAdvancedAdmissionId(e.target.value)} />
            <input className="input text-sm" placeholder={t('label.doctorId')} value={doctorUpdate} onChange={e => setDoctorUpdate(e.target.value)} />
            <select className="input text-sm" value={procedureType} onChange={e => setProcedureType(e.target.value)}>
              <option value="medical">{t('select.medical')}</option>
              <option value="surgical">{t('select.surgical')}</option>
              <option value="obs_gyn">{t('select.obsGyn')}</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input type="checkbox" checked={policeCase} onChange={e => setPoliceCase(e.target.checked)} />
              <ShieldAlert className="w-4 h-4 text-red-500" /> {t('label.policeCase')}
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary text-xs" onClick={() => doctorMutation.mutate({ id: Number(advancedAdmissionId), doctor_id: Number(doctorUpdate) })} disabled={!advancedAdmissionId || !doctorUpdate}>
              <UserCog className="w-3 h-3" /> {t('btn.updateDoctor')}
            </button>
            <button className="btn-secondary text-xs" onClick={() => procedureMutation.mutate({ id: Number(advancedAdmissionId), procedure_type: procedureType })} disabled={!advancedAdmissionId}>
              {t('btn.updateProcedure')}
            </button>
            <button className="btn-secondary text-xs" onClick={() => policeCaseMutation.mutate({ id: Number(advancedAdmissionId), is_police_case: policeCase })} disabled={!advancedAdmissionId}>
              {t('btn.policeCase')}
            </button>
            <button className="btn-secondary text-xs" onClick={() => undoTransferMutation.mutate({ id: Number(advancedAdmissionId), reason: 'Undo transfer from ADT dashboard' })} disabled={!advancedAdmissionId}>
              <Undo2 className="w-3 h-3" /> {t('btn.undoTransfer')}
            </button>
            <button className="btn-secondary text-xs" onClick={() => clearDueMutation.mutate({ id: Number(advancedAdmissionId), reason: 'Due cleared' })} disabled={!advancedAdmissionId}>
              {t('btn.clearDue')}
            </button>
            <button className="btn-secondary text-xs" onClick={() => billingDischargeMutation.mutate({ id: Number(advancedAdmissionId), reason: 'Billing discharge requested' })} disabled={!advancedAdmissionId}>
              {t('btn.billingDischarge')}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
            <textarea className="input text-sm" rows={2} placeholder={t('label.admissionRemark')} value={remarkText} onChange={e => setRemarkText(e.target.value)} />
            <button className="btn-primary text-xs" onClick={() => remarkMutation.mutate({ id: Number(advancedAdmissionId), remark: remarkText })} disabled={!advancedAdmissionId || !remarkText.trim()}>
              <MessageSquare className="w-3 h-3" /> {t('btn.addRemark')}
            </button>
          </div>
        </div>

        {/* Birth, Hemodialysis and ADT Config */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Baby className="w-4 h-4 text-pink-600" /> {t('heading.birthDetails')}</h2>
            <div className="grid grid-cols-2 gap-2">
              <input className="input text-xs" placeholder={t('label.admissionId')} value={birthForm.admission_id} onChange={e => setBirthForm(f => ({ ...f, admission_id: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.motherPatientId')} value={birthForm.patient_id} onChange={e => setBirthForm(f => ({ ...f, patient_id: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.babyName')} value={birthForm.baby_name} onChange={e => setBirthForm(f => ({ ...f, baby_name: e.target.value }))} />
              <select className="input text-xs" value={birthForm.sex} onChange={e => setBirthForm(f => ({ ...f, sex: e.target.value }))}><option value="">{t('label.sex')}</option><option>{t('select.male')}</option><option>{t('select.female')}</option><option>{t('select.other')}</option></select>
              <input className="input text-xs" type="date" value={birthForm.birth_date} onChange={e => setBirthForm(f => ({ ...f, birth_date: e.target.value }))} />
              <input className="input text-xs" type="time" value={birthForm.birth_time} onChange={e => setBirthForm(f => ({ ...f, birth_time: e.target.value }))} />
              <select className="input text-xs" value={birthForm.birth_condition_id} onChange={e => setBirthForm(f => ({ ...f, birth_condition_id: e.target.value }))}>
                <option value="">{t('label.condition')}</option>
                {birthConditions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="input text-xs" placeholder={t('label.weightKg')} value={birthForm.weight_kg} onChange={e => setBirthForm(f => ({ ...f, weight_kg: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.birthType')} value={birthForm.birth_type} onChange={e => setBirthForm(f => ({ ...f, birth_type: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.apgarScore')} value={birthForm.apgar_score} onChange={e => setBirthForm(f => ({ ...f, apgar_score: e.target.value }))} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary text-xs" onClick={handleBirthSubmit}>{t('btn.saveBirth')}</button>
              <button className="btn-secondary text-xs" onClick={() => handleCertificatePrint(birthForm.admission_id, 'birth')}>{t('btn.printBirthCert')}</button>
              <button className="btn-secondary text-xs" onClick={() => handleCertificatePrint(advancedAdmissionId, 'death')} disabled={!advancedAdmissionId}>{t('btn.printDeathCert')}</button>
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Droplets className="w-4 h-4 text-blue-600" /> {t('heading.hemodialysisReport')}</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['admission_id', t('label.admissionId')], ['patient_id', t('label.patientId')], ['pre_weight', t('label.preWeight')], ['post_weight', t('label.postWeight')],
                ['pre_bp', t('label.preBp')], ['post_bp', t('label.postBp')], ['dialysis_duration_min', t('label.durationMin')], ['access_type', t('label.accessType')],
                ['blood_flow_rate', t('label.bloodFlow')], ['dialysate_flow_rate', t('label.dialysateFlow')],
              ].map(([key, label]) => (
                <input key={key} className="input text-xs" placeholder={label} value={(hemoForm as any)[key]} onChange={e => setHemoForm(f => ({ ...f, [key]: e.target.value }))} />
              ))}
            </div>
            <textarea className="input text-xs" rows={2} placeholder={t('label.complicationsNotes')} value={hemoForm.complications} onChange={e => setHemoForm(f => ({ ...f, complications: e.target.value }))} />
            <button className="btn-primary text-xs" onClick={handleHemoSubmit}>{t('btn.saveHemodialysis')}</button>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Settings className="w-4 h-4 text-slate-600" /> {t('heading.adtBillingConfig')}</h2>
            <div className="grid grid-cols-2 gap-2">
              <input className="input text-xs" placeholder={t('label.bedFeatureId')} value={adtForm.bed_feature_id} onChange={e => setAdtForm(f => ({ ...f, bed_feature_id: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.billingItemId')} value={adtForm.billing_item_id} onChange={e => setAdtForm(f => ({ ...f, billing_item_id: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.price')} value={adtForm.price} onChange={e => setAdtForm(f => ({ ...f, price: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.minDeposit')} value={adtForm.min_deposit_amount} onChange={e => setAdtForm(f => ({ ...f, min_deposit_amount: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.schemeId')} value={adtForm.scheme_id} onChange={e => setAdtForm(f => ({ ...f, scheme_id: e.target.value }))} />
              <input className="input text-xs" placeholder={t('label.priceCategoryId')} value={adtForm.price_category_id} onChange={e => setAdtForm(f => ({ ...f, price_category_id: e.target.value }))} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary text-xs" onClick={() => autoBillingMutation.mutate({ bed_feature_id: Number(adtForm.bed_feature_id), billing_item_id: Number(adtForm.billing_item_id), price: Number(adtForm.price || 0) })}>{t('btn.saveAutoBilling')}</button>
              <button className="btn-secondary text-xs" onClick={() => depositMutation.mutate({ admission_type: adtForm.admission_type, min_deposit_amount: Number(adtForm.min_deposit_amount || 0), is_mandatory: adtForm.is_mandatory })}>{t('btn.saveDeposit')}</button>
              <button className="btn-secondary text-xs" onClick={() => schemeMutation.mutate({ bed_feature_id: Number(adtForm.bed_feature_id), scheme_id: Number(adtForm.scheme_id), price_category_id: Number(adtForm.price_category_id), price: Number(adtForm.price || 0) })}>{t('btn.saveSchemeMap')}</button>
            </div>
          </div>
        </div>

        {/* ── Admit Patient Modal ── */}
        {showAdmitModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAdmitModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-[var(--color-text)]">{t('admitPatient')}</h2>
                <button onClick={() => setShowAdmitModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* ── Left: Admission Form ── */}
                <div className="lg:col-span-2 space-y-4">
                {/* Patient Search */}
                <div className="relative">
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("patientRequired")}</label>
                  <input type="text" placeholder={t("searchPatientNameCode")}
                    value={patientSearch}
                    onChange={e => { setPatientSearch(e.target.value); setShowPatientDropdown(true); }}
                    onFocus={() => setShowPatientDropdown(true)}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                  />
                  {showPatientDropdown && patients.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {patients.map(p => (
                        <button key={p.id} onClick={() => {
                          setAdmitForm(f => ({ ...f, patient_id: p.id }));
                          setPatientSearch(`${p.name}${p.patient_code ? ` (${p.patient_code})` : ''}`);
                          setShowPatientDropdown(false);
                        }}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)] transition-colors">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code || ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Danphe-style: Today's OPD Visits quick admit */}
                {todayVisitsQuery.isLoading ? (
                  <div className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-bg)] flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
                    <span className="ml-2 text-sm text-[var(--color-text-muted)]">{t('info.loadingTodayVisits')}</span>
                  </div>
                ) : todayVisits.length > 0 && (
                  <div className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-bg)]">
                    <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                      {t('todaysOpdVisits', { defaultValue: "Today's OPD Visits" })}
                    </p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
	                      {todayVisits.map(v => (
	                        <button key={v.id} onClick={() => {
	                          const isEmergencyVisit = v.visit_type === 'emergency';
	                          setAdmitForm(f => ({
	                            ...f,
	                            patient_id: v.patient_id,
	                            doctor_id: v.doctor_id ?? 0,
	                            admission_type: isEmergencyVisit ? 'emergency' : 'planned',
	                            admit_source: isEmergencyVisit ? 'emergency' : 'opd_referral',
	                            referral_doctor: v.doctor_name || f.referral_doctor,
	                            is_emergency: isEmergencyVisit,
	                          }));
	                          setPatientSearch(`${v.patient_name}${v.patient_code ? ` (${v.patient_code})` : ''}`);
	                        }}
                          className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[var(--color-primary-light)] transition-colors flex justify-between items-center ${admitForm.patient_id === v.patient_id ? 'bg-[var(--color-primary-light)] ring-1 ring-[var(--color-primary)]' : ''}`}>
                          <span className="font-medium">{v.patient_name}</span>
                          <span className="text-[var(--color-text-muted)] text-xs">{v.visit_type} · {v.doctor_name || t('label.noDoctor')}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Admission Type */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("admissionType")}</label>
	                  <select value={admitForm.admission_type}
	                    onChange={e => {
	                      const admissionType = e.target.value as 'planned' | 'emergency' | 'transfer';
	                      setAdmitForm(f => ({
	                        ...f,
	                        admission_type: admissionType,
	                        admit_source: admissionType === 'emergency' ? 'emergency' : admissionType === 'transfer' ? 'transfer' : f.admit_source,
	                        is_emergency: admissionType === 'emergency' ? true : f.is_emergency,
	                      }));
	                    }}
	                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                    <option value="planned">{TYPE_LABELS.planned}</option>
                    <option value="emergency">{TYPE_LABELS.emergency}</option>
                    <option value="transfer">{TYPE_LABELS.transfer}</option>
	                  </select>
	                </div>

	                <div className="grid grid-cols-2 gap-3">
	                  <div>
	                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('admitSource', { defaultValue: 'Admit Source' })}</label>
	                    <select value={admitForm.admit_source}
	                      onChange={e => setAdmitForm(f => ({ ...f, admit_source: e.target.value }))}
	                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
	                      {Object.entries(SOURCE_LABELS).map(([value, label]) => (
	                        <option key={value} value={value}>{label}</option>
	                      ))}
	                    </select>
	                  </div>
	                  <label className="flex items-center gap-2 pt-7 text-sm font-medium text-[var(--color-text)]">
	                    <input type="checkbox" checked={admitForm.is_emergency}
	                      onChange={e => setAdmitForm(f => ({
	                        ...f,
	                        is_emergency: e.target.checked,
	                        admission_type: e.target.checked ? 'emergency' : f.admission_type,
	                        admit_source: e.target.checked ? 'emergency' : f.admit_source,
	                      }))}
	                      className="accent-[var(--color-primary)] w-4 h-4" />
	                    {t('emergencyFlag', { defaultValue: 'Emergency case' })}
	                  </label>
	                </div>

	                {/* Custom Admission Date */}
	                <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-3 bg-[var(--color-bg)]">
	                  <label className="flex items-center gap-2 cursor-pointer">
	                    <input type="checkbox" checked={customAdmitDate}
	                      onChange={e => setCustomAdmitDate(e.target.checked)}
	                      className="accent-[var(--color-primary)] w-4 h-4" />
	                    <CalendarClock className="w-4 h-4 text-[var(--color-text-muted)]" />
	                    <span className="text-sm font-medium text-[var(--color-text)]">{t('customAdmitDate', { defaultValue: 'Custom Admission Date' })}</span>
	                  </label>
	                  {customAdmitDate && (
	                    <input type="datetime-local" value={admitDateValue}
	                      onChange={e => setAdmitDateValue(e.target.value)}
	                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
	                    />
	                  )}
	                </div>

	                {/* Bed — ward grouped */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("wardBed")}</label>
                  <select value={admitForm.bed_id}
                    onChange={e => setAdmitForm(f => ({ ...f, bed_id: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                    <option value={0}>— {t('bedManagement.selectBed')} —</option>
                    {Array.from(new Set(beds.map(b => b.ward_name))).map(ward => (
                      <optgroup key={ward} label={ward}>
                        {beds.filter(b => b.ward_name === ward).map(b => (
                          <option key={b.id} value={b.id}>
                            {b.bed_number} ({b.feature_names || b.bed_type}) · ৳{Number(b.effective_rate ?? b.rate_per_day ?? 0).toLocaleString()}/day
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Department */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('department', { defaultValue: 'Department' })}</label>
                  <select value={admitForm.department}
                    onChange={e => setAdmitForm(f => ({ ...f, department: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                    <option value="">{t('selectDepartment', { defaultValue: '— Select Department —' })}</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>

	                {/* Diagnosis */}
	                <div className="grid grid-cols-2 gap-3">
	                  <div>
	                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('referralDoctor', { defaultValue: 'Referral Doctor' })}</label>
	                    <input type="text" value={admitForm.referral_doctor}
	                      onChange={e => setAdmitForm(f => ({ ...f, referral_doctor: e.target.value }))}
	                      placeholder={t('referralDoctorPlaceholder', { defaultValue: 'Doctor name or referral source' })}
	                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
	                    />
	                  </div>
	                  <div>
	                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('admissionReason', { defaultValue: 'Admission Reason' })}</label>
	                    <input type="text" value={admitForm.admission_reason}
	                      onChange={e => setAdmitForm(f => ({ ...f, admission_reason: e.target.value }))}
	                      placeholder={t('admissionReasonPlaceholder', { defaultValue: 'Reason for admission' })}
	                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
	                    />
	                  </div>
	                </div>

	                <div>
	                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("provisionalDiagnosis")}</label>
                  <textarea value={admitForm.provisional_diagnosis}
                    onChange={e => setAdmitForm(f => ({ ...f, provisional_diagnosis: e.target.value }))}
                    rows={2} placeholder={t("provisionalDiagnosisPlaceholder")}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none"
                  />
                </div>

                {/* Guardian / Care-of-Person */}
                <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-3 bg-[var(--color-bg)]">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('guardianInfo', { defaultValue: 'Guardian / Care-of Person' })}</p>
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('guardianName', { defaultValue: 'Guardian Name' })}</label>
                    <input type="text" value={admitForm.care_of_name}
                      onChange={e => setAdmitForm(f => ({ ...f, care_of_name: e.target.value }))}
                      placeholder={t('guardianNamePlaceholder', { defaultValue: 'Full name of guardian' })}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('guardianPhone', { defaultValue: 'Phone' })}</label>
                      <input type="tel" value={admitForm.care_of_phone}
                        onChange={e => setAdmitForm(f => ({ ...f, care_of_phone: e.target.value }))}
                        placeholder="01XXXXXXXXX"
                        className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('guardianRelation', { defaultValue: 'Relation' })}</label>
                      <select value={admitForm.care_of_relation}
                        onChange={e => setAdmitForm(f => ({ ...f, care_of_relation: e.target.value }))}
                        className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                        <option value="">{t('select', { ns: 'common', defaultValue: 'Select' })}</option>
                        <option value="father">{t('relations.father', { defaultValue: 'Father' })}</option>
                        <option value="mother">{t('relations.mother', { defaultValue: 'Mother' })}</option>
                        <option value="spouse">{t('relations.spouse', { defaultValue: 'Spouse' })}</option>
                        <option value="son">{t('relations.son', { defaultValue: 'Son' })}</option>
                        <option value="daughter">{t('relations.daughter', { defaultValue: 'Daughter' })}</option>
                        <option value="brother">{t('relations.brother', { defaultValue: 'Brother' })}</option>
                        <option value="sister">{t('relations.sister', { defaultValue: 'Sister' })}</option>
                        <option value="relative">{t('relations.relative', { defaultValue: 'Relative' })}</option>
                        <option value="friend">{t('relations.friend', { defaultValue: 'Friend' })}</option>
                        <option value="other">{t('relations.other', { defaultValue: 'Other' })}</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("notes")}</label>
                  <textarea value={admitForm.notes}
                    onChange={e => setAdmitForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2} placeholder={t("additionalNotesPlaceholder")}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none"
                  />
                </div>
                </div>

                {/* ── Right: Advance Collection ── */}
                <div className="space-y-4">
                  <div className="border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-3 bg-emerald-50 dark:bg-emerald-900/10">
                    <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                      <Wallet className="w-4 h-4" />
                      {t('advanceCollection', { defaultValue: 'Advance Collection' })}
                    </h3>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={admitDeposit.collect_deposit}
                        onChange={e => setAdmitDeposit(d => ({ ...d, collect_deposit: e.target.checked }))}
                        className="accent-emerald-600 w-4 h-4" />
                      <span className="text-sm font-medium text-[var(--color-text)]">{t('collectDeposit', { defaultValue: 'Collect admission deposit' })}</span>
                    </label>
                    {admitDeposit.collect_deposit && (
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('depositAmount', { defaultValue: 'Deposit Amount (৳)' })}</label>
                          <input type="number" min={0} className="w-full px-3 py-2 border border-emerald-300 dark:border-emerald-700 rounded-lg text-sm bg-white dark:bg-slate-800"
                            value={admitDeposit.amount} onChange={e => setAdmitDeposit(d => ({ ...d, amount: e.target.value }))}
                            placeholder="e.g. 5000" />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('paymentMethod', { defaultValue: 'Payment Method' })}</label>
                          <select className="w-full px-3 py-2 border border-emerald-300 dark:border-emerald-700 rounded-lg text-sm bg-white dark:bg-slate-800"
                            value={admitDeposit.payment_method} onChange={e => setAdmitDeposit(d => ({ ...d, payment_method: e.target.value }))}>
                            <option value="cash">{t('select.cash')}</option>
                            <option value="card">{t('select.card')}</option>
                            <option value="bkash">{t('select.bkash')}</option>
                            <option value="nagad">{t('select.nagad')}</option>
                            <option value="bank_transfer">{t('select.bankTransfer')}</option>
                          </select>
                        </div>
                        {admitDeposit.amount && Number(admitDeposit.amount) > 0 && (
                          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                            <div className="text-xs text-emerald-600 dark:text-emerald-400">Will collect</div>
                            <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">৳{Number(admitDeposit.amount).toLocaleString('en-BD')}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {!admitDeposit.collect_deposit && (
                      <p className="text-xs text-emerald-600/60 dark:text-emerald-400/60">
                        {t('depositHint', { defaultValue: 'ভর্তির সময় অগ্রিম জমা নিলে পরে বিলিং সহজ হয়' })}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setShowAdmitModal(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button onClick={handleAdmit} disabled={submitting || !admitForm.patient_id} className="btn-primary">
                  {submitting ? t('loading', { ns: 'common' }) : t('confirmAdmission')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Bed Transfer Modal ── */}
        {showTransferModal && selectedAdmission && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowTransferModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)] flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 text-indigo-600" />
                    {t('transferBed', { defaultValue: 'Transfer Bed' })}
                  </h2>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {selectedAdmission.patient_name} · {selectedAdmission.admission_no}
                  </p>
                </div>
                <button onClick={() => setShowTransferModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleTransferBed} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('currentBed', { defaultValue: 'Current Bed' })}</label>
                    <div className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm bg-[var(--color-bg)]">
                      {selectedAdmission.ward_name || '—'} / {selectedAdmission.bed_number || '—'}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('newBed', { defaultValue: 'New Bed' })} *</label>
                    <select required
                      value={transferForm.new_bed_id || ''}
                      onChange={e => setTransferForm(f => ({ ...f, new_bed_id: Number(e.target.value) }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                      <option value="">{t('selectAvailableBed', { defaultValue: 'Select available bed' })}</option>
                      {beds.map((bed) => (
                        <option key={bed.id} value={bed.id}>
                          {bed.ward_name} / {bed.bed_number} · {bed.bed_type}{bed.effective_rate != null ? ` · ৳${Number(bed.effective_rate).toLocaleString('en-BD')}/day` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('reason', { defaultValue: 'Reason' })}</label>
                  <textarea rows={3}
                    value={transferForm.reason}
                    onChange={e => setTransferForm(f => ({ ...f, reason: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none"
                    placeholder={t('transferReasonPlaceholder', { defaultValue: 'Example: shifted to cabin / ICU / ward change...' })} />
                </div>

                <label className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={transferForm.pending_receive}
                    onChange={e => setTransferForm(f => ({ ...f, pending_receive: e.target.checked }))} />
                  <span>
                    <span className="font-medium text-[var(--color-text)]">{t('receivingWardConfirmation', { defaultValue: 'Receiving ward confirmation required' })}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {t('receivingWardConfirmationHelp', { defaultValue: 'Recommended: request transfer first, then receiving ward clicks Receive from Pending Transfers.' })}
                    </span>
                  </span>
                </label>

                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                  {t('transferBillingHelp', { defaultValue: 'Billing note: the old bed charge segment will close and a new bed charge segment will start from transfer time.' })}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShowTransferModal(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                  <button type="submit" disabled={transferBedMutation.isPending || !transferForm.new_bed_id} className="btn-primary">
                    {transferBedMutation.isPending ? t('loading', { ns: 'common' }) : t('confirmTransfer', { defaultValue: 'Confirm Transfer' })}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Discharge Confirmation Modal (Danphe-style) ── */}
        {showDischargeModal && selectedAdmission && (
          <DischargeModal
            admission={{
              admissionId: selectedAdmission.id,
              admissionNo: selectedAdmission.admission_no,
              patientName: selectedAdmission.patient_name,
              patientId: selectedAdmission.patient_id,
              wardName: selectedAdmission.ward_name,
              bedNumber: selectedAdmission.bed_number,
            }}
            financial={buildDischargeFinancial({
              pendingSummary: ipdPendingBillingQuery.data?.summary ?? null,
              billingStatus: billingDetailQuery.data ?? null,
              financialClearance: ipdPendingBillingQuery.data?.financial_clearance ?? null,
            })}
            financialLoading={ipdPendingBillingQuery.isLoading && !ipdPendingBillingQuery.data}
            billPrintBasePath={basePath}
            onClose={() => setShowDischargeModal(false)}
            onSuccess={() => {
              setShowDischargeModal(false);
              setSelectedAdmission(null);
              queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
            }}
          />
        )}

        {/* ── Cancel Admission Modal ── */}
        {showCancelModal && selectedAdmission && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCancelModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <X className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">{t('cancelAdmission', { defaultValue: 'Cancel Admission' })}</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {selectedAdmission.patient_name} ({selectedAdmission.admission_no})
                  </p>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('cancellationReason', { defaultValue: 'Reason for cancellation' })} *</label>
                <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  rows={3} placeholder={t('cancelReasonPlaceholder', { defaultValue: 'Please provide a reason for cancelling this admission...' })}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCancelModal(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button onClick={() => { if (!window.confirm(t('confirm.cancelAdmission'))) return; cancelAdmissionMutation.mutate({ id: selectedAdmission.id, reason: cancelReason }); }}
                  disabled={submitting || !cancelReason.trim()} className="btn-primary bg-red-600 hover:bg-red-700">
                  {cancelAdmissionMutation.isPending ? t('loading', { ns: 'common' }) : t('confirmCancel', { defaultValue: 'Confirm Cancellation' })}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Cancel Discharge Modal ── */}
        {showCancelDischargeModal && selectedAdmission && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCancelDischargeModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">{t('undoDischarge', { defaultValue: 'Undo Discharge' })}</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {t('reAdmitPatient', { defaultValue: 'Re-admit' })} {selectedAdmission.patient_name} ({selectedAdmission.admission_no})
                  </p>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('reason', { defaultValue: 'Reason' })} *</label>
                <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  rows={3} placeholder={t('undoDischargeReasonPlaceholder', { defaultValue: 'Reason for cancelling discharge (e.g. accidental discharge, patient condition worsened)...' })}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCancelDischargeModal(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button onClick={() => { if (!window.confirm(t('confirm.undoDischarge'))) return; cancelDischargeMutation.mutate({ id: selectedAdmission.id, reason: cancelReason }); }}
                  disabled={submitting || !cancelReason.trim()} className="btn-primary">
                  {cancelDischargeMutation.isPending ? t('loading', { ns: 'common' }) : t('confirmUndoDischarge', { defaultValue: 'Re-admit Patient' })}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Quick Deposit Modal ── */}
        {showQuickDepositModal && selectedAdmission && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowQuickDepositModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-[var(--color-text)]">{t('collectDeposit', { defaultValue: 'Collect Deposit' })}</h2>
                <button onClick={() => setShowQuickDepositModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleQuickDeposit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('patient', { ns: 'common' })}</label>
                  <div className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm bg-[var(--color-bg)]">
                    {selectedAdmission.patient_name} ({selectedAdmission.patient_code})
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('depositAmount', { defaultValue: 'Amount (৳)' })}</label>
                    <input type="number" min={0} step={0.01} required
                      value={quickDepositForm.amount} onChange={e => setQuickDepositForm(f => ({ ...f, amount: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" placeholder="e.g. 5000" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('paymentMethod', { defaultValue: 'Payment Method' })}</label>
                    <select value={quickDepositForm.payment_method} onChange={e => setQuickDepositForm(f => ({ ...f, payment_method: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                      <option value="cash">{t('select.cash')}</option>
                      <option value="card">{t('select.card')}</option>
                      <option value="bkash">{t('select.bkash')}</option>
                      <option value="nagad">{t('select.nagad')}</option>
                      <option value="bank_transfer">{t('select.bankTransfer')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t('common:remarks')}</label>
                  <input type="text" value={quickDepositForm.remarks} onChange={e => setQuickDepositForm(f => ({ ...f, remarks: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" placeholder="Optional remarks" />
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button type="button" onClick={() => setShowQuickDepositModal(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                  <button type="submit" disabled={collectDepositMutation.isPending} className="btn-primary">
                    {collectDepositMutation.isPending ? t('loading', { ns: 'common' }) : t('collectDeposit', { defaultValue: 'Collect Deposit' })}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
      <HelpPanel pageKey="ipd" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </DashboardLayout>
  );
}

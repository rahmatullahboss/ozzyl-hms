import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  User, Phone, MapPin, Droplets, Calendar, FlaskConical,
  Receipt, Edit, Printer, RefreshCw, Pill, Clock, FileText,
  Activity, ChevronRight, AlertTriangle, Heart, HeartPulse, Stethoscope,
  Scan, Trash2, UserX, CreditCard, BedDouble,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import PatientEmrHeader from '../components/clinical/PatientEmrHeader';
import VitalsTrend from '../components/VitalsTrend';
import TransposedVitalsTable from '../components/clinical/TransposedVitalsTable';
import LabFlowsheet from '../components/clinical/LabFlowsheet';
import { getTodayGMT6, formatDateTimeGMT6 } from '../lib/date-utils';
import { getRoleBasePath } from '../lib/handover';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';
import { PatientActivationCodeAction } from '../components/PatientActivationCodeAction';
import { buildPrintableHealthCardHtml } from '../lib/printableHealthCard';
import PrescriptionRepeatButton from '../components/clinical/PrescriptionRepeatButton';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Patient {
  id: number;
  patient_code: string;
  uhid?: string | null;
  name: string;
  father_husband: string;
  address: string;
  mobile: string;
  guardian_mobile?: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  date_of_birth?: string;
  email?: string;
  created_at: string;
}

interface PatientCardQrTokenResponse {
  qr_payload?: string;
  token_available?: boolean;
  reused?: boolean;
  message?: string;
}

interface LabOrder {
  item_id: number;
  test_name: string;
  category?: string;
  result?: string;
  status: 'pending' | 'completed';
  order_no: string;
  order_date: string;
  unit_price: number;
}

interface Bill {
  id: number;
  invoice_no: string;
  total_amount: number;
  paid_amount: number;
  status: 'open' | 'partially_paid' | 'paid';
  created_at: string;
}

interface Deposit {
  id: number;
  deposit_receipt_no: string;
  amount: number;
  transaction_type: 'deposit' | 'refund' | 'adjustment';
  payment_method?: string;
  remarks?: string;
  created_at: string;
}

interface DepositBalanceResponse {
  balance: number;
  total_deposits: number;
  total_refunds: number;
  total_adjustments: number;
}

interface DepositsResponse {
  deposits: Deposit[];
}

interface Prescription {
  id: number;
  rx_no: string;
  doctor_name?: string;
  status: string;
  created_at: string;
  item_count: number;
}

interface Appointment {
  id: number;
  doctor_name?: string;
  appointment_date: string;
  time_slot?: string;
  status: string;
}

type Tab = 'overview' | 'prescriptions' | 'tests' | 'appointments' | 'bills' | 'timeline' | 'vitals' | 'admission-history' | 'physical-exam' | 'clinical-images' | 'io-chart' | 'dictation';

// ─── API response types ─────────────────────────────────────────────────────

interface PatientResponse { patient: Patient }
interface BillsResponse { bills: Bill[] }
interface OrderSummary { order_no: string; order_date: string; total_items: number; pending_items: number }
interface LabOrdersResponse { orders: OrderSummary[] }
interface PrescriptionsResponse { prescriptions: Record<string, unknown>[] }
interface AppointmentsResponse { appointments: Record<string, unknown>[] }
interface PhysLinesResponse { Results: Record<string, unknown>[] }
interface PhysExamsResponse { Results: Record<string, unknown>[] }
interface ClinImagesResponse { Results: Record<string, unknown>[] }
interface IOResponse { Results: Record<string, unknown>[]; Summary: { totalIntake: number; totalOutput: number; balance: number } }
interface DictationsResponse { Results: Record<string, unknown>[] }
interface AdmissionHistoryResponse { admissions: Record<string, unknown>[] }

// ─── Constants ───────────────────────────────────────────────────────────────

const BILL_STATUS: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700', partially_paid: 'bg-blue-100 text-blue-700', paid: 'bg-green-100 text-green-700',
};
const BILL_LABEL: Record<string, string> = {
  open: 'unpaid', partially_paid: 'partial', paid: 'paid',
};

const RX_STATUS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', final: 'bg-green-100 text-green-700',
};

const APPT_STATUS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  checked_in: 'bg-teal-100 text-teal-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-amber-100 text-amber-700',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(date: string | null | undefined) {
  if (!date) return '—';
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMoney(n: number) {
  return `৳${n.toLocaleString('en-BD')}`;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function daysSince(date: string, t: any): string {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return t('today', { defaultValue: 'Today' });
  if (days === 1) return t('yesterday', { defaultValue: 'Yesterday' });
  return t('daysAgo', { count: days, defaultValue: `${days} days ago` });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PatientDetail({
 role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['patients', 'common']);

  const { slug = '', id = '' } = useParams<{ slug: string; id: string }>();
  const navigate = useNavigate();
  const basePath = getRoleBasePath(slug, role);
  const queryClient = useQueryClient();

  const [tab,           setTab]           = useState<Tab>('overview');

  // ── Physical Exam form state ──
  const [physForm,      setPhysForm]      = useState<{ lineCode: string; status: 'wnl' | 'abn'; notes: string }[]>([]);
  const [physNotes,     setPhysNotes]     = useState('');
  const [physDate,      setPhysDate]      = useState(getTodayGMT6());

  // ── Clinical Images UI state ──
  const [imgFilter,     setImgFilter]     = useState('');
  const [imgModal,      setImgModal]      = useState(false);
  const [imgForm,       setImgForm]       = useState({ ImageName: '', ImagePath: '', ImageType: '', Notes: '' });
  const [lightboxImg,   setLightboxImg]   = useState<string | null>(null);

  // ── I/O Chart form/filter state ──
  const [ioForm,        setIoForm]        = useState({ ParameterName: '', ParameterCategory: '', IntakeOutputValue: '', Unit: 'mL', IntakeOutputType: 'intake' as 'intake' | 'output', Remarks: '' });
  const [ioFromDate,    setIoFromDate]    = useState('');
  const [ioToDate,      setIoToDate]      = useState('');

  // ── Dictation form state ──
  const [dictForm,      setDictForm]      = useState({ DictationText: '', AdditionalNotes: '', Priority: 'normal' as 'normal' | 'urgent' | 'stat' });

  // ── Queries: main patient data (always fetched) ──────────────────────

  const patientQuery = useApiQuery<PatientResponse>(
    queryKeys.patients.detail(Number(id)),
    `/api/patients/${id}`,
  );

  const summaryQuery = useApiQuery<{
    patient: { id: number; name: string; patient_code?: string; gender?: string; blood_group?: string; date_of_birth?: string };
    allergies: { id: number; allergen: string; severity: string; allergy_type: string }[];
    recent_visits: { id: number; visit_type?: string; created_at?: string }[];
    recent_diagnoses: { id: number; Diagnosis?: string; ICD10Description?: string; IsActive?: boolean }[];
    recent_lab_results: { test_name: string | null; result: string | null; abnormal_flag: string | null; unit: string | null; normal_range: string | null; completed_at: string | null }[];
  }>(
    queryKeys.patients.summary(Number(id)),
    `/api/patients/${id}/summary`,
  );

  const billsQuery = useApiQuery<BillsResponse>(
    ['billing', 'patient', id],
    `/api/billing/patient/${id}`,
  );

  const labOrdersQuery = useApiQuery<LabOrdersResponse>(
    ['laboratory', 'orders', { patientId: id }],
    `/api/lab/orders?patientId=${id}`,
  );

  const prescriptionsQuery = useApiQuery<PrescriptionsResponse>(
    ['prescriptions', { patient: id }],
    `/api/prescriptions?patient=${id}`,
  );

  const appointmentsQuery = useApiQuery<AppointmentsResponse>(
    ['appointments', { patientId: id }],
    `/api/appointments?patientId=${id}`,
  );

  const depositBalanceQuery = useApiQuery<DepositBalanceResponse>(
    queryKeys.deposits.balance(id),
    `/api/deposits/balance/${id}`,
    { enabled: tab === 'bills' || tab === 'overview' }
  );

  const depositsListQuery = useApiQuery<DepositsResponse>(
    queryKeys.deposits.list({ patient_id: id }),
    `/api/deposits?patient_id=${id}`,
    { enabled: tab === 'bills' }
  );

  // ── Queries: tab-specific (enabled when tab is active) ──────────────

  const physLinesQuery = useApiQuery<PhysLinesResponse>(
    ['physical-exam', 'lines'],
    '/api/physical-exam/lines',
    { enabled: tab === 'physical-exam' },
  );

  const physExamsQuery = useApiQuery<PhysExamsResponse>(
    ['physical-exam', 'patient', id],
    `/api/physical-exam/patient/${id}?limit=10`,
    { enabled: tab === 'physical-exam' },
  );

  const clinImagesQuery = useApiQuery<ClinImagesResponse>(
    ['clinical-images', { patientId: id }],
    `/api/clinical-images?patientId=${id}`,
    { enabled: tab === 'clinical-images' },
  );

  const ioPath = (() => {
    let url = `/api/input-output?patientId=${id}`;
    if (ioFromDate) url += `&fromDate=${ioFromDate}`;
    if (ioToDate) url += `&toDate=${ioToDate}`;
    return url;
  })();

  const ioQuery = useApiQuery<IOResponse>(
    ['input-output', { patientId: id, fromDate: ioFromDate, toDate: ioToDate }],
    ioPath,
    { enabled: tab === 'io-chart' },
  );

  const dictationsQuery = useApiQuery<DictationsResponse>(
    ['dictation', { patientId: id }],
    `/api/dictation?patientId=${id}`,
    { enabled: tab === 'dictation' },
  );

  const admissionHistoryQuery = useApiQuery<AdmissionHistoryResponse>(
    ['admissions', 'history', id],
    `/api/admissions/history/${id}`,
    { enabled: tab === 'admission-history' },
  );

  const vitalsListQuery = useApiQuery<{ vitals: { id: number; temperature?: number; pulse?: number; systolic?: number; diastolic?: number; spo2?: number; respiratory_rate?: number; weight?: number; bmi?: number; blood_sugar?: number; pain_scale?: number; recorded_at: string }[] }>(
    ['clinical', 'vitals', { patientId: id }],
    `/api/clinical/vitals?patientId=${id}&limit=20`,
    { enabled: tab === 'vitals' },
  );

  // ── Derive data from queries ────────────────────────────────────────

  const patient = patientQuery.data?.patient ?? null;

  const bills: Bill[] = billsQuery.data?.bills ?? [];

  const labOrders: LabOrder[] = (labOrdersQuery.data?.orders ?? []).map((o, idx) => ({
    item_id: idx + 1,
    test_name: `Order ${o.order_no}`,
    category: `${o.total_items} test(s)`,
    result: o.pending_items === 0 ? t('testStatus.allCompleted', { defaultValue: 'All completed' }) : t('testStatus.pendingItems', { count: o.pending_items, defaultValue: `${o.pending_items} pending` }),
    status: (o.pending_items === 0 ? 'completed' : 'pending') as 'completed' | 'pending',
    order_no: o.order_no,
    order_date: o.order_date,
    unit_price: 0,
  }));

  const prescriptions: Prescription[] = (prescriptionsQuery.data?.prescriptions ?? []).map((rx) => ({
    id: rx.id as number,
    rx_no: rx.rx_no as string,
    doctor_name: (rx.doctor_name as string) ?? '',
    status: rx.status as string,
    created_at: rx.created_at as string,
    item_count: Number(rx.item_count ?? 0),
  }));

  const appointments: Appointment[] = (appointmentsQuery.data?.appointments ?? []).map((a) => ({
    id: a.id as number,
    doctor_name: (a.doctor_name as string) ?? '',
    appointment_date: (a.appt_date as string) ?? '',
    time_slot: (a.appt_time as string) ?? undefined,
    status: a.status as string,
  }));

  const physLines: Record<string, unknown>[] = physLinesQuery.data?.Results ?? [];
  const physExams: Record<string, unknown>[] = physExamsQuery.data?.Results ?? [];
  const clinImages: Record<string, unknown>[] = clinImagesQuery.data?.Results ?? [];
  const ioRecords: Record<string, unknown>[] = ioQuery.data?.Results ?? [];
  const ioSummary = ioQuery.data?.Summary ?? { totalIntake: 0, totalOutput: 0, balance: 0 };
  const dictations: Record<string, unknown>[] = dictationsQuery.data?.Results ?? [];
  const admissionHistory: Record<string, unknown>[] = admissionHistoryQuery.data?.admissions ?? [];
  const vitalsList = vitalsListQuery.data?.vitals ?? [];

  const depositBalance = depositBalanceQuery.data?.balance ?? 0;
  const deposits = depositsListQuery.data?.deposits ?? [];

  const labFlowsheetResults = (summaryQuery.data?.recent_lab_results ?? [])
    .filter((r) => r.test_name && r.result && r.completed_at)
    .map((r) => ({
      test_name: r.test_name!,
      result_value: isNaN(Number(r.result)) ? r.result! : Number(r.result),
      unit: r.unit ?? undefined,
      normal_range: r.normal_range ?? undefined,
      abnormal_flag: (r.abnormal_flag as 'normal' | 'high' | 'low' | 'critical_high' | 'critical_low' | null) ?? null,
      collected_at: r.completed_at!.slice(0, 10),
    }));

  const loading = patientQuery.isLoading;

  // Initialize physForm when physLines data arrives
  useEffect(() => {
    if (physLines.length > 0 && physForm.length === 0) {
      setPhysForm(physLines.map((l) => ({ lineCode: l.LineCode as string, status: 'wnl', notes: '' })));
    }
  }, [physLines, physForm.length]);

  // ── Mutations ───────────────────────────────────────────────────────

  const savePhysExamMutation = useApiMutation<unknown, unknown>(
    'post',
    '/api/physical-exam',
    {
      onSuccess: () => {
        toast.success(t('toast.success.physicalExamSaved', { defaultValue: 'Physical exam saved' }));
        queryClient.invalidateQueries({ queryKey: ['physical-exam', 'patient', id] });
      },
      onError: () => {
        toast.error(t('toast.error.saveExamFailed', { defaultValue: 'Failed to save exam' }));
      },
    },
  );

  const saveClinImageMutation = useApiMutation<unknown, unknown>(
    'post',
    '/api/clinical-images',
    {
      onSuccess: () => {
        toast.success(t('toast.success.imageAdded', { defaultValue: 'Image added' }));
        setImgModal(false);
        setImgForm({ ImageName: '', ImagePath: '', ImageType: '', Notes: '' });
        queryClient.invalidateQueries({ queryKey: ['clinical-images', { patientId: id }] });
      },
      onError: () => {
        toast.error(t('toast.error.addImageFailed', { defaultValue: 'Failed to add image' }));
      },
    },
  );

  const deleteClinImageMutation = useApiMutation<unknown, number>(
    'delete',
    (imgId) => `/api/clinical-images/${imgId}`,
    {
      onSuccess: () => {
        toast.success(t('toast.success.imageRemoved', { defaultValue: 'Image removed' }));
        queryClient.invalidateQueries({ queryKey: ['clinical-images', { patientId: id }] });
      },
      onError: () => {
        toast.error(t('toast.error.deleteFailed', { defaultValue: 'Delete failed' }));
      },
    },
  );

  const saveIOMutation = useApiMutation<unknown, unknown>(
    'post',
    '/api/input-output',
    {
      onSuccess: () => {
        toast.success(t('toast.success.recordAdded', { defaultValue: 'Record added' }));
        setIoForm({ ParameterName: '', ParameterCategory: '', IntakeOutputValue: '', Unit: 'mL', IntakeOutputType: 'intake', Remarks: '' });
        queryClient.invalidateQueries({ queryKey: ['input-output'] });
      },
      onError: () => {
        toast.error(t('toast.error.addRecordFailed', { defaultValue: 'Failed to add record' }));
      },
    },
  );

  const deleteIOMutation = useApiMutation<unknown, number>(
    'delete',
    (ioId) => `/api/input-output/${ioId}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['input-output'] });
      },
      onError: () => {
        toast.error(t('toast.error.deleteFailed', { defaultValue: 'Delete failed' }));
      },
    },
  );

  const saveDictationMutation = useApiMutation<unknown, unknown>(
    'post',
    '/api/dictation',
    {
      onSuccess: () => {
        toast.success(t('toast.success.dictationSaved', { defaultValue: 'Dictation saved' }));
        setDictForm({ DictationText: '', AdditionalNotes: '', Priority: 'normal' });
        queryClient.invalidateQueries({ queryKey: ['dictation', { patientId: id }] });
      },
      onError: () => {
        toast.error(t('toast.error.saveFailed', { defaultValue: 'Failed to save' }));
      },
    },
  );

  const updateDictStatusMutation = useApiMutation<unknown, { dictId: number; status: string }>(
    'put',
    (vars) => `/api/dictation/${vars.dictId}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['dictation', { patientId: id }] });
      },
      onError: () => {
        toast.error(t('toast.error.updateFailed', { defaultValue: 'Update failed' }));
      },
    },
  );

  // ── Action handlers (thin wrappers around mutations) ────────────────

  const savePhysExam = () => {
    savePhysExamMutation.mutate({
      PatientId: Number(id), ExamDate: physDate,
      Findings: physForm.map((f) => ({ lineCode: f.lineCode, status: f.status, notes: f.notes || undefined })),
      GeneralNotes: physNotes || undefined,
    });
  };

  const saveClinImage = () => {
    if (!imgForm.ImageName || !imgForm.ImagePath) { toast.error(t('toast.error.imageRequired', { defaultValue: 'Name and path required' })); return; }
    saveClinImageMutation.mutate({ ...imgForm, PatientId: Number(id), ImageType: imgForm.ImageType || undefined });
  };

  const deleteClinImage = (imgId: number) => {
    deleteClinImageMutation.mutate(imgId);
  };

  const saveIORecord = () => {
    if (!ioForm.ParameterName || !ioForm.IntakeOutputValue) { toast.error(t('toast.error.ioRequired', { defaultValue: 'Name and value required' })); return; }
    saveIOMutation.mutate({
      PatientId: Number(id), ParameterName: ioForm.ParameterName,
      ParameterCategory: ioForm.ParameterCategory || undefined,
      IntakeOutputValue: Number(ioForm.IntakeOutputValue), Unit: ioForm.Unit,
      IntakeOutputType: ioForm.IntakeOutputType, Remarks: ioForm.Remarks || undefined,
    });
  };

  const deleteIORecord = (ioId: number) => {
    deleteIOMutation.mutate(ioId);
  };

  const saveDictation = () => {
    if (!dictForm.DictationText) { toast.error(t('toast.error.dictationRequired', { defaultValue: 'Dictation text required' })); return; }
    saveDictationMutation.mutate({ PatientId: Number(id), ...dictForm });
  };

  const updateDictStatus = (dictId: number, status: string) => {
    updateDictStatusMutation.mutate({ dictId, status });
  };

  // ── Refresh all patient data ────────────────────────────────────────

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.patients.detail(Number(id)) });
    queryClient.invalidateQueries({ queryKey: ['billing', 'patient', id] });
    queryClient.invalidateQueries({ queryKey: ['laboratory', 'orders', { patientId: id }] });
    queryClient.invalidateQueries({ queryKey: ['prescriptions', { patient: id }] });
    queryClient.invalidateQueries({ queryKey: ['appointments', { patientId: id }] });
    queryClient.invalidateQueries({ queryKey: queryKeys.deposits.balance(id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.deposits.list({ patient_id: id }) });
  };

  const totalBilled = bills.reduce((s, b) => s + b.total_amount, 0);
  const totalPaid   = bills.reduce((s, b) => s + b.paid_amount, 0);
  const totalDue    = totalBilled - totalPaid;
  const pendingLab  = labOrders.filter(l => l.status === 'pending').length;
  const totalVisits = prescriptions.length + appointments.filter(a => a.status === 'completed').length;
  const noShowCount = appointments.filter(a => a.status === 'no_show').length;

  // Print summary
  const escapeHtml = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const handlePrintSummary = () => {
    if (!patient) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast.error(t('toast.error.popupBlocked', { defaultValue: 'Pop-up blocked' })); return; }
    const doc = printWindow.document;
    doc.open();
    const html = [
      '<html><head><title>Patient Summary — ', escapeHtml(patient.name), '</title>',
      '<style>body{font-family:Inter,sans-serif;padding:2rem;} h1{font-size:1.4rem;} table{width:100%;border-collapse:collapse;margin-top:1rem;} td,th{border:1px solid #ccc;padding:8px;} th{background:#f5f5f5;}</style>',
      '</head><body><h1>', t('patient_summary', { defaultValue: 'Patient Summary' }), '</h1>',
      '<p><strong>', escapeHtml(patient.name), '</strong> | ', escapeHtml(patient.patient_code), ' | ', escapeHtml(patient.mobile), '</p>',
      '<p>', escapeHtml(patient.address), '</p>',
      '<table><thead><tr><th>Invoice</th><th>Total</th><th>Paid</th><th>Status</th><th>Date</th></tr></thead><tbody>',
      ...bills.map(b => ['<tr><td>', escapeHtml(b.invoice_no), '</td><td>৳', String(b.total_amount), '</td><td>৳', String(b.paid_amount), '</td><td>', t('billing:' + BILL_LABEL[b.status]), '</td><td>', fmt(b.created_at), '</td></tr>'].join('')),
      '</tbody></table>',
      '<p><strong>', t('total', { ns: 'common' }), ': ', fmtMoney(totalBilled), ' | ', t('paid', { ns: 'common' }), ': ', fmtMoney(totalPaid), ' | ', t('due', { ns: 'common' }), ': ', fmtMoney(totalDue), '</strong></p>',
      '</body></html>',
    ].join('');
    doc.write(html);
    doc.close();
    printWindow.print();
  };

  // Print health card
  const handlePrintHealthCard = async () => {
    if (!patient) return;
    const w = window.open('', '_blank');
    if (!w) { toast.error(t('toast.error.popupBlocked', { defaultValue: 'Pop-up blocked' })); return; }
    let qrSvg: string | null = null;
    try {
      const qr = await api.post<PatientCardQrTokenResponse>(`/api/health-record/patients/${id}/card-qr-token`, { reissue: true });
      if (qr.qr_payload) {
        qrSvg = renderToStaticMarkup(
          <QRCodeSVG value={qr.qr_payload} size={160} level="M" marginSize={2} />,
        );
      } else if (qr.reused) {
        toast.error(qr.message ?? 'This patient already has an active QR token. Reissue the card to print a fresh QR.');
      }
    } catch (err) {
      toast.error((err as { message?: string })?.message ?? 'Failed to issue card QR');
    }
    w.document.open();
    w.document.write(buildPrintableHealthCardHtml({
      name: patient.name,
      patientCode: patient.patient_code,
      uhid: patient.uhid,
      age: patient.age ?? null,
      gender: patient.gender ?? null,
      mobile: patient.mobile,
      address: patient.address,
      bloodGroup: patient.blood_group ?? null,
      guardianMobile: patient.guardian_mobile ?? null,
      qrSvg,
    }));
    w.document.close();
    setTimeout(() => { w.print(); }, 200);
  };

  // Build timeline from all events
  const timeline = [
    ...prescriptions.map(rx => ({ date: rx.created_at, type: 'prescription' as const, title: `${t('patients:categories.prescription', { defaultValue: 'Prescription' })} ${rx.rx_no}`, subtitle: rx.doctor_name || '', status: rx.status })),
    ...labOrders.map(lo => ({ date: lo.order_date, type: 'lab' as const, title: lo.order_no, subtitle: lo.category || '', status: lo.status })),
    ...bills.map(b => ({ date: b.created_at, type: 'billing' as const, title: b.invoice_no, subtitle: fmtMoney(b.total_amount), status: b.status })),
    ...appointments.map(a => ({ date: a.appointment_date, type: 'appointment' as const, title: `${t('patients:hospitalServices.hospitalVisit', { defaultValue: 'Appointment' })} ${t('common:with', { defaultValue: 'with' })} ${a.doctor_name || t('common:doctor')}`, subtitle: a.time_slot || '', status: a.status })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const TIMELINE_ICON: Record<string, React.ReactNode> = {
    prescription: <Pill className="w-4 h-4" />,
    lab: <FlaskConical className="w-4 h-4" />,
    billing: <Receipt className="w-4 h-4" />,
    appointment: <Calendar className="w-4 h-4" />,
  };

  const TIMELINE_COLOR: Record<string, string> = {
    prescription: 'bg-purple-100 text-purple-600',
    lab: 'bg-blue-100 text-blue-600',
    billing: 'bg-green-100 text-green-600',
    appointment: 'bg-amber-100 text-amber-600',
  };

  const isReception = role === 'reception';
  const RECEPTION_TABS: Set<Tab> = new Set(['overview', 'appointments', 'bills', 'timeline']);

  // Tab definitions with counts
  const ALL_TABS: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'overview',      label: t('tabs.overview', { defaultValue: 'Overview' }),      icon: <Activity className="w-4 h-4" /> },
    { id: 'prescriptions', label: t('tabs.prescriptions', { defaultValue: 'Prescriptions' }), icon: <Pill className="w-4 h-4" />,        count: prescriptions.length },
    { id: 'tests',         label: t('tabs.labResults', { defaultValue: 'Lab Results' }),   icon: <FlaskConical className="w-4 h-4" />, count: labOrders.length },
    { id: 'appointments',  label: t('tabs.appointments', { defaultValue: 'Appointments' }),  icon: <Calendar className="w-4 h-4" />,     count: appointments.length },
    { id: 'bills',         label: t('tabs.billing', { defaultValue: 'Billing' }),       icon: <Receipt className="w-4 h-4" />,      count: bills.length },
    { id: 'vitals',        label: t('tabs.vitals', { defaultValue: 'Vitals' }),        icon: <HeartPulse className="w-4 h-4" /> },
    { id: 'admission-history', label: t('tabs.admissionHistory', { defaultValue: 'Admission History' }), icon: <BedDouble className="w-4 h-4" />, count: admissionHistory.length },
    { id: 'timeline',      label: t('tabs.timeline', { defaultValue: 'Timeline' }),      icon: <Clock className="w-4 h-4" />,        count: timeline.length },
    { id: 'physical-exam', label: t('tabs.physicalExam', { defaultValue: 'Physical Exam' }), icon: <Stethoscope className="w-4 h-4" /> },
    { id: 'clinical-images', label: t('tabs.images', { defaultValue: 'Images' }),      icon: <Scan className="w-4 h-4" /> },
    { id: 'io-chart',      label: t('tabs.ioChart', { defaultValue: 'I/O Chart' }),     icon: <Activity className="w-4 h-4" /> },
    { id: 'dictation',     label: t('tabs.dictation', { defaultValue: 'Dictation' }),     icon: <FileText className="w-4 h-4" /> },
  ];

  const TABS = isReception ? ALL_TABS.filter(t => RECEPTION_TABS.has(t.id)) : ALL_TABS;

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
          <button onClick={() => navigate(`${basePath}/patients`)} className="btn-primary mt-4">&larr; {t('common:back', { defaultValue: 'Back' })}</button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={role}>
      <div className="max-w-5xl mx-auto space-y-5">

        {/* ── Breadcrumb ── */}
        <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
          <Link to={`${basePath}/dashboard`} className="hover:underline">{t('common:dashboard', { defaultValue: 'Dashboard' })}</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to={`${basePath}/patients`} className="hover:underline">{t('common:patients', { defaultValue: 'Patients' })}</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-[var(--color-text)] font-medium">{patient.name}</span>
        </div>

        <PatientEmrHeader
          patient={patient}
          allergies={summaryQuery.data?.allergies?.map(a => ({ id: a.id, allergen: a.allergen, severity: a.severity as 'mild' | 'moderate' | 'severe', allergy_type: a.allergy_type }))}
          chronicConditions={summaryQuery.data?.recent_diagnoses?.filter(d => d.IsActive !== false).map(d => d.Diagnosis ?? d.ICD10Description ?? '').filter(Boolean)}
          visitType={summaryQuery.data?.recent_visits?.[0]?.visit_type}
          lastVisitDate={summaryQuery.data?.recent_visits?.[0]?.created_at ?? patient.created_at}
        />

        {/* ── Patient Profile Card ── */}
        <div className="card p-5 border-l-4 border-l-[var(--color-primary)]">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {/* Avatar */}
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
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  {t('status.active', { defaultValue: 'Active' })}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3 text-sm">
                {patient.age && patient.gender && (
                  <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span>{patient.age}y · {patient.gender}</span>
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

            {/* Actions */}
            <div className="flex gap-2 shrink-0">
              <button onClick={() => navigate(`${basePath}/patients/new?edit=${id}`)} className="btn-ghost">
                <Edit className="w-4 h-4" />
                <span className="hidden sm:inline">{t('actions.edit', { defaultValue: 'Edit' })}</span>
              </button>
              {!isReception && (
                <>
                  <Link to={`${basePath}/prescriptions/new?patient=${id}`} className="btn-primary">
                    <Pill className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('actions.newRx', { defaultValue: 'New Rx' })}</span>
                  </Link>
                  <Link to={`/h/${slug}/patients/${id}/chart`} className="btn-ghost">
                    <Stethoscope className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('actions.chart', { defaultValue: 'Chart' })}</span>
                  </Link>
                </>
              )}
              <button onClick={handlePrintHealthCard} className="btn-ghost p-2" aria-label="Health Card" title="Print Health Card">
                <CreditCard className="w-4 h-4" />
              </button>
              <PatientActivationCodeAction patientId={Number(id)} uhid={patient.uhid} />
              <button onClick={handlePrintSummary} className="btn-ghost p-2" aria-label="Print">
                <Printer className="w-4 h-4" />
              </button>
              <button onClick={refreshAll} className="btn-ghost p-2" aria-label="Refresh">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Tab Navigation ── */}
        <div className="flex overflow-x-auto border-b border-[var(--color-border)] -mb-px">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                tab === t.id
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}>
              {t.icon} {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="min-h-[300px]">

          {/* ═══ Overview ═══ */}
          {tab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              {/* Left 60% */}
              <div className="lg:col-span-3 space-y-5">

                {/* Personal Details */}
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[var(--color-primary)]" /> {t('sections.personalDetails', { defaultValue: 'Personal Details' })}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    {[
                      { label: t('fields.dateOfBirth', { defaultValue: 'Date of Birth' }), value: patient.date_of_birth ? fmt(patient.date_of_birth) : '—' },
                      { label: t('fields.fatherHusband', { defaultValue: 'Father/Husband' }), value: patient.father_husband || '—' },
                      { label: t('fields.address', { defaultValue: 'Address' }), value: patient.address || '—' },
                      { label: t('fields.guardianMobile', { defaultValue: 'Guardian Mobile' }), value: patient.guardian_mobile || '—' },
                      { label: t('fields.registered', { defaultValue: 'Registered' }), value: fmt(patient.created_at) },
                      { label: t('fields.email', { defaultValue: 'Email' }), value: patient.email || '—' },
                    ].map(d => (
                      <div key={d.label}>
                        <span className="text-[var(--color-text-muted)] text-xs">{d.label}</span>
                        <p className="text-[var(--color-text)] font-medium">{d.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Bills */}
                {bills.length > 0 && (
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-[var(--color-primary)]" /> {t('sections.recentBills', { defaultValue: 'Recent Bills' })}
                    </h3>
                    <div className="space-y-2">
                      {bills.slice(0, 3).map(b => (
                        <div key={b.id} className="flex items-center justify-between py-2.5 border-b border-[var(--color-border)] last:border-0">
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text)]">{b.invoice_no}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{fmt(b.created_at)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">{fmtMoney(b.total_amount)}</p>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${BILL_STATUS[b.status]}`}>
                              {BILL_LABEL[b.status]}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right 40% */}
              <div className="lg:col-span-2 space-y-5">
                {/* Quick Stats */}
                <div className="card p-5">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[var(--color-primary)]" /> {t('sections.quickStats', { defaultValue: 'Quick Stats' })}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: t('stats.totalVisits', { defaultValue: 'Total Visits' }), value: totalVisits, icon: <Heart className="w-4 h-4 text-pink-500" /> },
                      { label: t('stats.pendingLab', { defaultValue: 'Pending Lab' }), value: pendingLab, icon: <FlaskConical className="w-4 h-4 text-blue-500" /> },
                      { label: t('stats.totalBilled', { defaultValue: 'Total Billed' }), value: fmtMoney(totalBilled), icon: <Receipt className="w-4 h-4 text-green-500" /> },
                      { label: t('stats.pendingDue', { defaultValue: 'Pending Due' }), value: fmtMoney(totalDue), icon: <AlertTriangle className="w-4 h-4 text-amber-500" /> },
                      ...(depositBalance > 0 ? [{ label: t('stats.deposit', { defaultValue: 'Deposit' }), value: fmtMoney(depositBalance), icon: <CreditCard className="w-4 h-4 text-blue-500" /> }] : []),
                      ...(noShowCount > 0 ? [{ label: t('stats.noShows', { defaultValue: 'No Shows' }), value: noShowCount, icon: <UserX className="w-4 h-4 text-red-500" /> }] : []),
                    ].map(s => (
                      <div key={s.label} className="text-center py-3 rounded-xl bg-[var(--color-bg)]">
                        <div className="flex justify-center mb-1">{s.icon}</div>
                        <p className="text-xl font-bold text-[var(--color-text)]">{s.value}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Prescriptions */}
                {prescriptions.length > 0 && (
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                      <Pill className="w-4 h-4 text-[var(--color-primary)]" /> {t('sections.recentPrescriptions', { defaultValue: 'Recent Prescriptions' })}
                    </h3>
                    <div className="space-y-2">
                      {prescriptions.slice(0, 3).map(rx => (
                        <Link key={rx.id} to={`${basePath}/prescriptions/${rx.id}`}
                          className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--color-bg)] transition-colors">
                          <div>
                            <p className="text-sm font-mono font-medium text-[var(--color-primary)]">{rx.rx_no}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{rx.doctor_name} · {daysSince(rx.created_at, t)}</p>
                          </div>
                          <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${RX_STATUS[rx.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {rx.status}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Upcoming Appointments */}
                {appointments.filter(a => a.status === 'scheduled').length > 0 && (
                  <div className="card p-5">
                    <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[var(--color-primary)]" /> {t('sections.upcoming', { defaultValue: 'Upcoming' })}
                    </h3>
                    {appointments.filter(a => a.status === 'scheduled').slice(0, 2).map(a => (
                      <div key={a.id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                        <div>
                          <p className="text-sm font-medium text-[var(--color-text)]">{a.doctor_name || 'Doctor'}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{fmt(a.appointment_date)} {a.time_slot && `· ${a.time_slot}`}</p>
                        </div>
                        <span className="text-xs rounded-full px-2 py-0.5 bg-blue-100 text-blue-700 font-medium">{t('status.scheduled', { defaultValue: 'Scheduled' })}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ Prescriptions ═══ */}
          {tab === 'prescriptions' && (
            <div className="card overflow-hidden overflow-x-auto">
              {prescriptions.length === 0 ? (
                <div className="p-12 text-center">
                  <Pill className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                  <p className="text-[var(--color-text-muted)]">{t('empty.prescriptions', { defaultValue: 'No prescriptions yet' })}</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-bg)]">
                    <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                      <th className="text-left px-4 py-3 font-medium">{t('patients:rx_no', { defaultValue: 'Rx #' })}</th>
                      <th className="text-left px-4 py-3 font-medium">{t('common:doctor', { defaultValue: 'Doctor' })}</th>
                      <th className="text-left px-4 py-3 font-medium">{t('common:date', { defaultValue: 'Date' })}</th>
                      <th className="text-center px-4 py-3 font-medium">{t('common:items', { defaultValue: 'Items' })}</th>
                      <th className="text-center px-4 py-3 font-medium">{t('common:status', { defaultValue: 'Status' })}</th>
                      <th className="text-center px-4 py-3 font-medium">{t('common:actions', { defaultValue: 'Action' })}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {prescriptions.map(rx => (
                      <tr key={rx.id} className="hover:bg-[var(--color-bg)] transition-colors">
                        <td className="px-4 py-3 font-mono font-medium text-[var(--color-primary)]">{rx.rx_no}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{rx.doctor_name || '—'}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs">{fmt(rx.created_at)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{rx.item_count} {t('items.count', { defaultValue: 'items' })}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${RX_STATUS[rx.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {rx.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Link to={`${basePath}/prescriptions/${rx.id}`} className="text-[var(--color-primary)] hover:underline text-xs font-medium">
                              {t('actions.view', { defaultValue: 'View' })}
                            </Link>
                            <PrescriptionRepeatButton prescriptionId={rx.id} patientId={Number(id)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ═══ Lab Results ═══ */}
          {tab === 'tests' && (
            <div className="space-y-4">
              <div className="card overflow-hidden overflow-x-auto">
                {labOrders.length === 0 ? (
                  <div className="p-12 text-center">
                    <FlaskConical className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                    <p className="text-[var(--color-text-muted)]">{t('empty.labTests', { defaultValue: 'No lab tests ordered yet' })}</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-bg)]">
                      <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                        <th className="text-left px-4 py-3 font-medium">{t('lab_orders.orderNo', { defaultValue: 'Order #' })}</th>
                        <th className="text-left px-4 py-3 font-medium">{t('lab_orders.tests', { defaultValue: 'Tests' })}</th>
                        <th className="text-left px-4 py-3 font-medium">{t('tableHeaders.date')}</th>
                        <th className="text-left px-4 py-3 font-medium">{t('lab_orders.result', { defaultValue: 'Result' })}</th>
                        <th className="text-center px-4 py-3 font-medium">{t('tableHeaders.status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {labOrders.map(lo => (
                        <tr key={lo.item_id} className="hover:bg-[var(--color-bg)] transition-colors">
                          <td className="px-4 py-3 font-mono font-medium text-[var(--color-primary)]">{lo.order_no}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{lo.category}</span>
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs">{fmt(lo.order_date)}</td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)]">{lo.result || '—'}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${lo.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {lo.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {labFlowsheetResults.length > 0 && (
                <LabFlowsheet results={labFlowsheetResults} />
              )}
            </div>
          )}

          {/* ═══ Appointments ═══ */}
          {tab === 'appointments' && (
            <div className="card overflow-hidden overflow-x-auto">
              {appointments.length === 0 ? (
                <div className="p-12 text-center">
                  <Calendar className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                  <p className="text-[var(--color-text-muted)]">{t('empty.appointments', { defaultValue: 'No appointments yet' })}</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[var(--color-bg)]">
                    <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                      <th className="text-left px-4 py-3 font-medium">{t('appointments.doctor', { defaultValue: 'Doctor' })}</th>
                      <th className="text-left px-4 py-3 font-medium">{t('tableHeaders.date')}</th>
                      <th className="text-left px-4 py-3 font-medium">{t('appointments.time', { defaultValue: 'Time' })}</th>
                      <th className="text-center px-4 py-3 font-medium">{t('tableHeaders.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {appointments.map(a => (
                      <tr key={a.id} className="hover:bg-[var(--color-bg)] transition-colors">
                        <td className="px-4 py-3 text-[var(--color-text)] font-medium">{a.doctor_name || '—'}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs">{fmt(a.appointment_date)}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{a.time_slot || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs rounded-full px-2 py-0.5 font-medium capitalize ${APPT_STATUS[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {a.status.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ═══ Billing ═══ */}
          {tab === 'bills' && (
            <div className="card overflow-hidden">
              {bills.length === 0 ? (
                <div className="p-12 text-center">
                  <Receipt className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                  <p className="text-[var(--color-text-muted)]">{t('empty.bills', { defaultValue: 'No bills yet' })}</p>
                </div>
              ) : (
                <>
                  {/* Finance summary strip */}
                  <div className={`grid gap-4 p-4 bg-[var(--color-bg)] border-b border-[var(--color-border)] ${depositBalance > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                    <div className="text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('billing.totalBilled', { defaultValue: 'Total Billed' })}</p>
                      <p className="text-lg font-bold text-[var(--color-text)]">{fmtMoney(totalBilled)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('billing.paid', { defaultValue: 'Paid' })}</p>
                      <p className="text-lg font-bold text-green-600">{fmtMoney(totalPaid)}</p>
                    </div>
                    {depositBalance > 0 ? (
                      <div className="text-center border-l border-[var(--color-border)]">
                        <p className="text-xs text-[var(--color-text-muted)]">{t('billing.deposit', { defaultValue: 'Deposit' })}</p>
                        <p className="text-lg font-bold text-blue-600">{fmtMoney(depositBalance)}</p>
                      </div>
                    ) : null}
                    <div className="text-center border-l border-[var(--color-border)]">
                      <p className="text-xs text-[var(--color-text-muted)]">{t('billing.netPayable', { defaultValue: 'Net Payable' })}</p>
                      <p className={`text-lg font-bold ${totalDue > depositBalance ? 'text-amber-600' : 'text-green-600'}`}>
                        {fmtMoney(Math.max(0, totalDue - depositBalance))}
                      </p>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--color-bg)]">
                      <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                        <th className="text-left px-4 py-3 font-medium">{t('billing.invoiceNo', { defaultValue: 'Invoice #' })}</th>
                        <th className="text-left px-4 py-3 font-medium">{t('common:date', { defaultValue: 'Date' })}</th>
                        <th className="text-right px-4 py-3 font-medium">{t('billing.total', { defaultValue: 'Total' })}</th>
                        <th className="text-right px-4 py-3 font-medium">{t('billing.paid', { defaultValue: 'Paid' })}</th>
                        <th className="text-right px-4 py-3 font-medium">{t('billing.due', { defaultValue: 'Due' })}</th>
                        <th className="text-center px-4 py-3 font-medium">{t('tableHeaders.status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {bills.map(b => (
                        <tr key={b.id} className="hover:bg-[var(--color-bg)] transition-colors">
                          <td className="px-4 py-3 font-mono font-medium">{b.invoice_no}</td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs">{fmt(b.created_at)}</td>
                          <td className="px-4 py-3 text-right">{fmtMoney(b.total_amount)}</td>
                          <td className="px-4 py-3 text-right text-green-600">{fmtMoney(b.paid_amount)}</td>
                          <td className={`px-4 py-3 text-right ${b.total_amount - b.paid_amount > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                            {fmtMoney(b.total_amount - b.paid_amount)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${BILL_STATUS[b.status]}`}>
                              {BILL_LABEL[b.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Deposit History */}
                  {deposits.length > 0 && (
                    <div className="mt-6 border-t border-[var(--color-border)]">
                      <div className="px-4 py-2 bg-[var(--color-bg)] border-b border-[var(--color-border)] flex items-center justify-between">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                          {t('billing.depositHistory', { defaultValue: 'Deposit History' })}
                        </h4>
                        <span className="text-xs font-medium text-blue-600">
                          {t('billing.balance', { defaultValue: 'Balance' })}: {fmtMoney(depositBalance)}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[10px] text-[var(--color-text-muted)] uppercase bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]">
                              <th className="text-left px-4 py-2 font-medium">{t('tableHeaders.date')}</th>
                              <th className="text-left px-4 py-2 font-medium">{t('tableHeaders.receiptNo')}</th>
                              <th className="text-left px-4 py-2 font-medium">{t('tableHeaders.type')}</th>
                              <th className="text-left px-4 py-2 font-medium">{t('tableHeaders.method')}</th>
                              <th className="text-right px-4 py-2 font-medium">{t('tableHeaders.amount')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)]">
                            {deposits.map(d => (
                              <tr key={d.id} className="hover:bg-[var(--color-bg)] transition-colors">
                                <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">{fmt(d.created_at)}</td>
                                <td className="px-4 py-2.5 font-mono text-xs">{d.deposit_receipt_no}</td>
                                <td className="px-4 py-2.5 text-xs">
                                  <span className={`px-1.5 py-0.5 rounded uppercase text-[10px] font-bold ${
                                    d.transaction_type === 'deposit' ? 'bg-green-50 text-green-700' :
                                    d.transaction_type === 'refund' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
                                  }`}>
                                    {d.transaction_type}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">{d.payment_method || '—'}</td>
                                <td className={`px-4 py-2.5 text-right font-medium ${d.transaction_type === 'deposit' ? 'text-green-600' : 'text-amber-600'}`}>
                                  {d.transaction_type === 'deposit' ? '+' : '-'}{fmtMoney(d.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══ Timeline ═══ */}
          {tab === 'timeline' && (
            <div className="card p-5">
              {timeline.length === 0 ? (
                <div className="p-8 text-center">
                  <Clock className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2 opacity-40" />
                  <p className="text-[var(--color-text-muted)]">{t('empty.noActivity', { defaultValue: 'No activity yet' })}</p>
                </div>
              ) : (
                <div className="relative space-y-0">
                  <div className="absolute left-5 top-0 bottom-0 w-px bg-[var(--color-border)]" />
                  {timeline.map((ev, idx) => (
                    <div key={`${ev.type}-${ev.title}-${idx}`} className="relative flex items-start gap-4 py-3">
                      <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${TIMELINE_COLOR[ev.type]}`}>
                        {TIMELINE_ICON[ev.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[var(--color-text)]">{ev.title}</p>
                          <span className="text-xs text-[var(--color-text-muted)]">{daysSince(ev.date, t)}</span>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)]">{ev.subtitle}</p>
                      </div>
                      <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">{fmt(ev.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Admission History ═══ */}
          {tab === 'admission-history' && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
                <BedDouble className="w-4 h-4 text-[var(--color-primary)]" />
                <h3 className="section-title">{t('tabs.admissionHistory', { defaultValue: 'Admission History' })}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="table-base text-sm">
                  <thead>
                    <tr><th>{t('admissions.admissionNo')}</th><th>{t('admissions.admitted')}</th><th>{t('admissions.discharged')}</th><th>{t('admissions.wardBed')}</th><th>{t('admissions.doctor')}</th><th>{t('admissions.status')}</th></tr>
                  </thead>
                  <tbody>
                    {admissionHistory.length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-muted)]">No admission history</td></tr>
                    ) : admissionHistory.map((adm) => (
                      <tr key={String(adm.id)}>
                        <td className="font-mono text-[var(--color-primary)]">{String(adm.admission_no ?? '')}</td>
                        <td>{fmt(String(adm.admission_date ?? ''))}</td>
                        <td>{fmt(String(adm.discharge_date ?? ''))}</td>
                        <td>{[adm.ward_name, adm.bed_number].filter(Boolean).join(' / ') || '—'}</td>
                        <td>{String(adm.doctor_name ?? '—')}</td>
                        <td><span className="badge badge-secondary">{String(adm.status ?? '')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ Vitals ═══ */}
          {tab === 'vitals' && (
            <div className="space-y-4">
              <VitalsTrend patientId={Number(id)} />
              <TransposedVitalsTable vitals={vitalsList} />
            </div>
          )}

          {/* ═══ Physical Exam ═══ */}
          {tab === 'physical-exam' && (
            <div className="space-y-4">
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title">{t('physicalExam.title', { defaultValue: 'Physical Examination' })}</h3>
                  <input type="date" value={physDate} onChange={(e) => setPhysDate(e.target.value)} className="input w-40 text-sm" />
                </div>
                {physLines.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{t('physicalExam.loadingLines', { defaultValue: 'Loading exam lines…' })}</p>
                ) : (
                  <div className="space-y-2">
                    {physForm.map((row, i) => (
                      <div key={row.lineCode} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                        <p className="text-sm font-medium flex-1">{row.lineCode}</p>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => setPhysForm((f) => f.map((r, j) => j === i ? { ...r, status: 'wnl' } : r))}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${row.status === 'wnl' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-emerald-50'}`}>{t('physicalExam.wnl', { defaultValue: 'WNL' })}</button>
                          <button onClick={() => setPhysForm((f) => f.map((r, j) => j === i ? { ...r, status: 'abn' } : r))}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${row.status === 'abn' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500 hover:bg-red-50'}`}>{t('physicalExam.abn', { defaultValue: 'ABN' })}</button>
                        </div>
                        {row.status === 'abn' && (
                          <input placeholder={t('physicalExam.findingsPlaceholder', { defaultValue: 'Findings…' })} value={row.notes}
                            onChange={(e) => setPhysForm((f) => f.map((r, j) => j === i ? { ...r, notes: e.target.value } : r))}
                            className="input text-sm w-48" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <textarea placeholder={t('physicalExam.generalNotes', { defaultValue: 'General notes…' })} value={physNotes} onChange={(e) => setPhysNotes(e.target.value)} rows={3} className="input w-full mt-4 text-sm" />
                <div className="flex justify-end mt-3">
                  <button onClick={savePhysExam} disabled={savePhysExamMutation.isPending} className="btn btn-primary text-sm">{savePhysExamMutation.isPending ? t('common:saving', { defaultValue: 'Saving…' }) : t('physicalExam.saveExam', { defaultValue: 'Save Exam' })}</button>
                </div>
              </div>
              {physExams.length > 0 && (
                <div className="card p-5">
                  <h3 className="section-title mb-3">{t('physicalExam.pastExams', { defaultValue: 'Past Exams' })}</h3>
                  <div className="space-y-2">
                    {physExams.map((exam) => (
                      <div key={String(exam.ExamId)} className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]">
                        <div>
                          <p className="text-sm font-medium">{String(exam.ExamDate ?? '').slice(0, 10)}</p>
                          {!!exam.GeneralNotes && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{String(exam.GeneralNotes ?? '').slice(0, 80)}</p>}
                        </div>
                        <span className="text-xs text-[var(--color-text-muted)]">{String(exam.FindingCount ?? 0)} {t('physicalExam.findings', { defaultValue: 'findings' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ Clinical Images ═══ */}
          {tab === 'clinical-images' && (
            <div className="space-y-4">
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title">{t('clinicalImages.title', { defaultValue: 'Clinical Images' })}</h3>
                  <div className="flex gap-2">
                    <select value={imgFilter} onChange={(e) => setImgFilter(e.target.value)} className="input text-sm w-32">
                      <option value="">{t('clinicalImages.allTypes', { defaultValue: 'All Types' })}</option>
                      {['Eye','XRay','Dental','Wound','Skin','Other'].map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button onClick={() => setImgModal(true)} className="btn btn-primary text-sm">+ {t('actions.add', { defaultValue: 'Add' })}</button>
                  </div>
                </div>
                {clinImages.filter((img) => !imgFilter || img.ImageType === imgFilter).length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('empty.noImages', { defaultValue: 'No images recorded' })}</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {clinImages.filter((img) => !imgFilter || img.ImageType === imgFilter).map((img) => (
                      <div key={String(img.ScannedImageId)} className="relative group rounded-lg overflow-hidden border border-[var(--color-border)]">
                        <div className="aspect-square bg-slate-100 dark:bg-slate-800 flex items-center justify-center cursor-pointer"
                          onClick={() => setLightboxImg(String(img.ImagePath))}>
                          <img src={String(img.ImagePath)} alt={String(img.ImageName)} className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                        </div>
                        <div className="p-2">
                          <p className="text-xs font-medium truncate">{String(img.ImageName)}</p>
                          {!!img.ImageType && <span className="text-xs text-[var(--color-text-muted)]">{String(img.ImageType ?? '')}</span>}
                        </div>
                        <button onClick={() => deleteClinImage(Number(img.ScannedImageId))}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-500 text-white rounded p-0.5 transition-opacity">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {imgModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                  <div className="card p-6 w-full max-w-md space-y-3">
                    <h4 className="font-semibold">{t('clinicalImages.addTitle', { defaultValue: 'Add Clinical Image' })}</h4>
                    <input placeholder={t('clinicalImages.imageNamePlaceholder', { defaultValue: 'Image Name *' })} value={imgForm.ImageName} onChange={(e) => setImgForm((f) => ({ ...f, ImageName: e.target.value }))} className="input w-full text-sm" />
                    <input placeholder={t('clinicalImages.imagePathPlaceholder', { defaultValue: 'Image URL / R2 Path *' })} value={imgForm.ImagePath} onChange={(e) => setImgForm((f) => ({ ...f, ImagePath: e.target.value }))} className="input w-full text-sm" />
                    <select value={imgForm.ImageType} onChange={(e) => setImgForm((f) => ({ ...f, ImageType: e.target.value }))} className="input w-full text-sm">
                      <option value="">{t('clinicalImages.typeOptional', { defaultValue: 'Type (optional)' })}</option>
                      {['Eye','XRay','Dental','Wound','Skin','Other'].map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <textarea placeholder={t('clinicalImages.notesOptional', { defaultValue: 'Notes (optional)' })} value={imgForm.Notes} onChange={(e) => setImgForm((f) => ({ ...f, Notes: e.target.value }))} rows={2} className="input w-full text-sm" />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setImgModal(false)} className="btn btn-secondary text-sm">{t('common:cancel', { defaultValue: 'Cancel' })}</button>
                      <button onClick={saveClinImage} disabled={saveClinImageMutation.isPending} className="btn btn-primary text-sm">{saveClinImageMutation.isPending ? t('common:saving', { defaultValue: 'Saving…' }) : t('actions.add', { defaultValue: 'Add' })}</button>
                    </div>
                  </div>
                </div>
              )}
              {lightboxImg && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setLightboxImg(null)}>
                  <img src={lightboxImg} alt="Clinical image" className="max-w-full max-h-full object-contain rounded-lg" />
                </div>
              )}
            </div>
          )}

          {/* ═══ I/O Chart ═══ */}
          {tab === 'io-chart' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-4 text-center border-l-4 border-blue-400">
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">{t('io.intake', { defaultValue: 'Intake' })}</p>
                  <p className="text-2xl font-bold text-blue-600 mt-1">{ioSummary.totalIntake.toFixed(0)} <span className="text-sm font-normal">mL</span></p>
                </div>
                <div className="card p-4 text-center border-l-4 border-orange-400">
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">{t('io.output', { defaultValue: 'Output' })}</p>
                  <p className="text-2xl font-bold text-orange-500 mt-1">{ioSummary.totalOutput.toFixed(0)} <span className="text-sm font-normal">mL</span></p>
                </div>
                <div className={`card p-4 text-center border-l-4 ${ioSummary.balance >= 0 ? 'border-emerald-400' : 'border-red-400'}`}>
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">{t('io.balance', { defaultValue: 'Balance' })}</p>
                  <p className={`text-2xl font-bold mt-1 ${ioSummary.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{ioSummary.balance >= 0 ? '+' : ''}{ioSummary.balance.toFixed(0)} <span className="text-sm font-normal">mL</span></p>
                </div>
              </div>
              <div className="card p-5">
                <h3 className="section-title mb-3">{t('io.addRecord', { defaultValue: 'Add Record' })}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <input placeholder={t('io.parameterPlaceholder', { defaultValue: 'Parameter (e.g. IV Fluid)' })} value={ioForm.ParameterName} onChange={(e) => setIoForm((f) => ({ ...f, ParameterName: e.target.value }))} className="input text-sm" />
                  <input placeholder={t('io.categoryOptional', { defaultValue: 'Category (optional)' })} value={ioForm.ParameterCategory} onChange={(e) => setIoForm((f) => ({ ...f, ParameterCategory: e.target.value }))} className="input text-sm" />
                  <input type="number" placeholder={t('io.valuePlaceholder', { defaultValue: 'Value' })} value={ioForm.IntakeOutputValue} onChange={(e) => setIoForm((f) => ({ ...f, IntakeOutputValue: e.target.value }))} className="input text-sm" />
                  <input placeholder={t('io.unit', { defaultValue: 'Unit' })} value={ioForm.Unit} onChange={(e) => setIoForm((f) => ({ ...f, Unit: e.target.value }))} className="input text-sm" />
                  <select value={ioForm.IntakeOutputType} onChange={(e) => setIoForm((f) => ({ ...f, IntakeOutputType: e.target.value as 'intake' | 'output' }))} className="input text-sm">
                    <option value="intake">{t('io.intakeArrow', { defaultValue: '↑ Intake' })}</option>
                    <option value="output">{t('io.outputArrow', { defaultValue: '↓ Output' })}</option>
                  </select>
                  <input placeholder={t('io.remarksOptional', { defaultValue: 'Remarks (optional)' })} value={ioForm.Remarks} onChange={(e) => setIoForm((f) => ({ ...f, Remarks: e.target.value }))} className="input text-sm" />
                </div>
                <div className="flex justify-end mt-3">
                  <button onClick={saveIORecord} disabled={saveIOMutation.isPending} className="btn btn-primary text-sm">{saveIOMutation.isPending ? t('common:saving', { defaultValue: 'Saving…' }) : t('io.addRecordBtn', { defaultValue: 'Add Record' })}</button>
                </div>
              </div>
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="section-title flex-1">{t('io.records', { defaultValue: 'Records' })}</h3>
                  <input type="date" value={ioFromDate} onChange={(e) => { setIoFromDate(e.target.value); }} className="input text-sm w-36" />
                  <input type="date" value={ioToDate} onChange={(e) => { setIoToDate(e.target.value); }} className="input text-sm w-36" />
                  <button onClick={() => queryClient.invalidateQueries({ queryKey: ['input-output'] })} className="btn btn-secondary text-sm">{t('actions.filter', { defaultValue: 'Filter' })}</button>
                </div>
                {ioRecords.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('empty.noIORecords', { defaultValue: 'No I/O records' })}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table-base w-full text-sm">
                      <thead><tr>
                        <th>{t('io.time', { defaultValue: 'Time' })}</th>
                        <th>{t('io.parameter', { defaultValue: 'Parameter' })}</th>
                        <th>{t('io.value', { defaultValue: 'Value' })}</th>
                        <th>{t('io.type', { defaultValue: 'Type' })}</th>
                        <th>{t('io.remarks', { defaultValue: 'Remarks' })}</th>
                        <th></th>
                      </tr></thead>
                      <tbody>
                        {ioRecords.map((r) => (
                          <tr key={String(r.InputOutputId)}>
                            <td className="whitespace-nowrap">{String(r.RecordedAt ?? '').slice(0,16).replace('T',' ')}</td>
                            <td>{String(r.ParameterName)}</td>
                            <td className="font-medium">{String(r.IntakeOutputValue)} {String(r.Unit ?? 'mL')}</td>
                            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.IntakeOutputType === 'intake' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{r.IntakeOutputType === 'intake' ? t('io.intakeShort', { defaultValue: '↑ Intake' }) : t('io.outputShort', { defaultValue: '↓ Output' })}</span></td>
                            <td className="text-[var(--color-text-muted)]">{String(r.Remarks ?? '—')}</td>
                            <td><button onClick={() => deleteIORecord(Number(r.InputOutputId))} className="text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ Dictation ═══ */}
          {tab === 'dictation' && (
            <div className="space-y-4">
              <div className="card p-5">
                <h3 className="section-title mb-3">{t('dictation.newTitle', { defaultValue: 'New Dictation' })}</h3>
                <textarea placeholder={t('dictation.textPlaceholder', { defaultValue: 'Dictation text…' })} value={dictForm.DictationText} onChange={(e) => setDictForm((f) => ({ ...f, DictationText: e.target.value }))} rows={5} className="input w-full text-sm font-mono" />
                <textarea placeholder={t('dictation.notesOptional', { defaultValue: 'Additional notes (optional)…' })} value={dictForm.AdditionalNotes} onChange={(e) => setDictForm((f) => ({ ...f, AdditionalNotes: e.target.value }))} rows={2} className="input w-full mt-2 text-sm" />
                <div className="flex items-center justify-between mt-3">
                  <select value={dictForm.Priority} onChange={(e) => setDictForm((f) => ({ ...f, Priority: e.target.value as typeof dictForm.Priority }))} className="input text-sm w-32">
                    <option value="normal">{t('dictation.priority.normal', { defaultValue: 'Normal' })}</option>
                    <option value="urgent">{t('dictation.priority.urgent', { defaultValue: 'Urgent' })}</option>
                    <option value="stat">{t('dictation.priority.stat', { defaultValue: 'STAT' })}</option>
                  </select>
                  <button onClick={saveDictation} disabled={saveDictationMutation.isPending} className="btn btn-primary text-sm">{saveDictationMutation.isPending ? t('common:saving', { defaultValue: 'Saving…' }) : t('dictation.saveBtn', { defaultValue: 'Save Dictation' })}</button>
                </div>
              </div>
              <div className="card p-5">
                <h3 className="section-title mb-3">{t('dictation.pastTitle', { defaultValue: 'Past Dictations' })}</h3>
                {dictations.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('empty.noDictations', { defaultValue: 'No dictations' })}</p>
                ) : (
                  <div className="space-y-2">
                    {dictations.map((d) => {
                      const statusColor: Record<string,string> = { draft:'bg-gray-100 text-gray-600', transcribed:'bg-blue-100 text-blue-700', reviewed:'bg-amber-100 text-amber-700', signed:'bg-emerald-100 text-emerald-700' };
                      const nextStatus: Record<string,string> = { draft:'transcribed', transcribed:'reviewed', reviewed:'signed' };
                      const status = String(d.Status ?? 'draft');
                      return (
                        <div key={String(d.DictationId)} className="border border-[var(--color-border)] rounded-lg p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-[var(--color-text-muted)]">{String(d.CreatedOn ?? '').slice(0,16).replace('T',' ')}</p>
                              <p className="text-sm mt-1 line-clamp-2">{String(d.DictationText ?? '')}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[status] ?? 'bg-gray-100 text-gray-600'}`}>{status}</span>
                              {nextStatus[status] && (
                                <button onClick={() => updateDictStatus(Number(d.DictationId), nextStatus[status])} className="text-xs text-[var(--color-primary)] hover:underline">&rarr; {t(`dictation.status.${nextStatus[status]}`, { defaultValue: nextStatus[status] })}</button>
                              )}
                            </div>
                          </div>
                          {d.Priority !== 'normal' && (
                            <span className={`mt-1.5 inline-block px-2 py-0.5 rounded text-xs font-medium ${d.Priority === 'stat' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{String(d.Priority).toUpperCase()}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

      </div>
    </DashboardLayout>
  );
}

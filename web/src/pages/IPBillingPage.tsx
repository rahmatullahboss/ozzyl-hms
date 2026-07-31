import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  BedDouble, Search, FileText, DollarSign, Clock, CheckCircle,
  X, Plus, Printer, Eye, LogOut, ArrowLeft, CreditCard,
  Calculator, Pencil, User, Calendar, Hash, Stethoscope, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import ExecutiveDashboardRangeFilter, { resolveExecutiveDashboardFilters } from '../components/dashboard/ExecutiveDashboardRangeFilter';
import { appendDashboardPeriod, type DashboardPeriod } from '../components/dashboard/dashboardPeriod';
import EmptyState from '../components/dashboard/EmptyState';
import { api, ApiClientError } from '../lib/apiClient';
import { getIpdRunningBillPrintPath, getRoleBasePath } from '../lib/handover';
import { redirectToReceptionBillPrint } from '../lib/receptionBilling';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';
import { ProvisionalBillingModal } from '../components/reception/ProvisionalBillingModal';
import DoctorRoundForm from '../components/ipd/DoctorRoundForm';
import { formatAdmissionDisplay } from '../lib/admissionDisplay';
import { formatAgeFromDateOfBirth } from '../lib/age';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IPPatient {
  admission_id: number;
  admission_number: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  date_of_birth?: string | null;
  patient_address?: string | null;
  ward_name?: string;
  bed_number?: string;
  doctor_name?: string;
  admitted_date: string;
  admitted_at_utc?: string | null;
  billing_status: 'pending' | 'partial' | 'settled';
  total_charges: number;
  total_paid: number;
  balance: number;
  deposit_balance?: number;
}

interface IPStats {
  total_inpatients: number;
  pending_billing: number;
  total_charges_today: number;
  settled_today: number;
  high_due_patients: number;
  package_patients: number;
  today_admissions: number;
  today_discharges: number;
}

interface PendingItem {
  id: number;
  item_name: string;
  item_category: string;
  department?: string;
  reference_id?: number | null;
  unit_price: number;
  quantity: number;
  discount_percent: number;
  discount_amount: number;
  total_amount: number;
  doctor_name?: string;
  created_at: string;
  bill_status: string;
}

interface BedChargeSegment {
  id: number;
  ward_name?: string;
  bed_number?: string;
  bed_type?: string;
  rate_per_day: number;
  started_on: string;
  ended_on?: string;
  days: number;
  charge_amount: number;
}

interface AvailableBed {
  id: number;
  ward_name: string;
  bed_number: string;
  bed_type: string;
  rate_per_day?: number;
  effective_rate?: number;
  feature_names?: string;
}

interface PendingResponse {
  items: PendingItem[];
  bed_charges: {
    segments: BedChargeSegment[];
    bed_total: number;
  };
  summary: {
    provisional_total: number;
    bed_total: number;
    grand_total: number;
    deposit_balance: number;
    net_payable: number;
  };
}

interface AdmissionDetail {
  id: number;
  admission_no: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  date_of_birth?: string | null;
  patient_address?: string | null;
  ward_name?: string;
  bed_number?: string;
  bed_type?: string;
  doctor_name?: string;
  admission_date: string;
  admitted_at_utc?: string | null;
  admission_type: string;
  status: string;
  provisional_diagnosis?: string;
  deposit_balance?: number;
}

interface DepositBalance {
  patient_id: number;
  total_deposits: number;
  total_refunds: number;
  total_adjustments: number;
  balance: number;
}

interface DoctorRound {
  id: number;
  doctor_name_snapshot: string;
  rounded_at: string;
  round_fee_snapshot: number;
  entry_source: 'nurse_station' | 'ipd_billing';
  entered_by_name?: string | null;
  bill_status?: string | null;
  status: 'active' | 'cancelled';
}

const STATUS_TABS = ['all', 'pending', 'partial', 'settled'] as const;

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit' },
];

function fmtTaka(n: number) {
  return `৳${(n || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactPatientAge(dateOfBirth?: string | null): string | null {
  const age = formatAgeFromDateOfBirth(dateOfBirth, 'en-GB');
  return age === '—' ? null : age;
}

function fmtDhakaRoundDateTime(value?: string | null) {
  if (!value) return '—';
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}+06:00`;
  return new Intl.DateTimeFormat('en-BD', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(normalized));
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IPBillingPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['common', 'sidebar', 'billing']);
  const navigate = useNavigate();
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = getRoleBasePath(slug, role);

  // View: 'list' shows admitted patients; 'detail' shows billing detail for one patient
  const [view, setView] = useState<'list' | 'detail'>('list');

  // ─── List State ─────────────────────────────────────────────────────────
  const [patients, setPatients] = useState<IPPatient[]>([]);
  const [stats, setStats] = useState<IPStats | null>(null);
  const [reportingFilters, setReportingFilters] = useState(() => resolveExecutiveDashboardFilters('today'));
  const reportingPeriod = useMemo<DashboardPeriod>(() => ({
    startDate: reportingFilters.startDate,
    endDate: reportingFilters.endDate,
    label: reportingFilters.startDate === reportingFilters.endDate
      ? reportingFilters.endDate
      : `${reportingFilters.startDate} – ${reportingFilters.endDate}`,
  }), [reportingFilters.endDate, reportingFilters.startDate]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // ─── Detail State ───────────────────────────────────────────────────────
  const [selectedAdmission, setSelectedAdmission] = useState<AdmissionDetail | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [bedCharges, setBedCharges] = useState<BedChargeSegment[]>([]);
  const [pendingSummary, setPendingSummary] = useState<PendingResponse['summary'] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [depositBalance, setDepositBalance] = useState<DepositBalance | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [billingTimeline, setBillingTimeline] = useState<Array<{ type: string; description: string; category: string; amount: number; created_at: string; payment_method?: string | null; receipt_no?: string | null }>>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [doctorRounds, setDoctorRounds] = useState<DoctorRound[]>([]);
  const [doctorRoundsLoading, setDoctorRoundsLoading] = useState(false);

  // Billing calculation state
  const [discountPercent, setDiscountPercent] = useState('0');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [discountByName, setDiscountByName] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [tender, setTender] = useState('');
  const [billingRemarks, setBillingRemarks] = useState('');
  const [useDeposit, setUseDeposit] = useState(true);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [refundNote, setRefundNote] = useState('');

  // ─── Modal State ────────────────────────────────────────────────────────
  const [showNewItem, setShowNewItem] = useState(false);
  const [showDoctorRound, setShowDoctorRound] = useState(false);
  const [showDischarge, setShowDischarge] = useState(false);
  const [showTransferBed, setShowTransferBed] = useState(false);
  const [showEditItems, setShowEditItems] = useState(false);
  const [editItem, setEditItem] = useState<PendingItem | null>(null);
  const [editForm, setEditForm] = useState({ quantity: '', unit_price: '', discount_percent: '' });
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [availableBeds, setAvailableBeds] = useState<AvailableBed[]>([]);
  const [transferBedForm, setTransferBedForm] = useState({ new_bed_id: '', reason: '', pending_receive: false });

  // ─── New Item Modal State ───────────────────────────────────────────────
  const [depositAmount, setDepositAmount] = useState('');
  const [depositPaymentMethod, setDepositPaymentMethod] = useState('cash');
  const [depositRemarks, setDepositRemarks] = useState('');

  // ─── API Calls ──────────────────────────────────────────────────────────────

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('billing_status', statusFilter);
      if (search) params.set('search', search);
      const q = params.toString();
      const data = await api.get<{ data: IPPatient[] }>(`/api/ip-billing/patients${q ? `?${q}` : ''}`);
      setPatients(data.data ?? []);
    } catch {
      toast.error('Failed to load patients');
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<IPStats>(appendDashboardPeriod('/api/ip-billing/stats', reportingPeriod));
      setStats(data);
    } catch { setStats(null); }
  }, [reportingPeriod]);

  const fetchPendingItems = useCallback(async (admissionId: number) => {
    setDetailLoading(true);
    try {
      const data = await api.get<PendingResponse>(`/api/ip-billing/pending/${admissionId}`);
      setPendingItems(data.items ?? []);
      setBedCharges(data.bed_charges?.segments ?? []);
      setPendingSummary(data.summary ?? null);
    } catch {
      toast.error('Failed to load billing details');
      setPendingItems([]);
      setBedCharges([]);
      setPendingSummary(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const fetchAdmissionDetail = useCallback(async (admissionId: number) => {
    try {
      const data = await api.get<{ admission: AdmissionDetail }>(`/api/admissions/${admissionId}/detail`);
      setSelectedAdmission(data.admission);
    } catch {
      toast.error('Failed to load admission details');
    }
  }, []);

  const fetchAvailableBeds = useCallback(async () => {
    try {
      const data = await api.get<{ beds: AvailableBed[] }>('/api/admissions/available-beds-with-pricing');
      setAvailableBeds(data.beds ?? []);
    } catch {
      setAvailableBeds([]);
      toast.error('Failed to load available beds');
    }
  }, []);

  const fetchDepositBalance = useCallback(async (patientId: number) => {
    try {
      const data = await api.get<DepositBalance>(`/api/deposits/balance/${patientId}`);
      setDepositBalance(data);
    } catch {
      setDepositBalance(null);
    }
  }, []);

  const fetchBillingTimeline = useCallback(async (patientId: number) => {
    setTimelineLoading(true);
    try {
      const data = await api.get<{ timeline: typeof billingTimeline }>(`/api/ip-billing/timeline/${patientId}`);
      setBillingTimeline(data.timeline ?? []);
    } catch {
      setBillingTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  const fetchDoctorRounds = useCallback(async (admissionId: number) => {
    setDoctorRoundsLoading(true);
    try {
      const data = await api.get<{ rounds: DoctorRound[] }>(`/api/ipd-doctor-rounds?admission_id=${admissionId}`);
      setDoctorRounds(data.rounds ?? []);
    } catch {
      setDoctorRounds([]);
    } finally {
      setDoctorRoundsLoading(false);
    }
  }, []);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ─── Open Patient Detail ────────────────────────────────────────────────────

  const openDetail = async (p: IPPatient) => {
    setView('detail');
    await fetchAdmissionDetail(p.admission_id);
    await fetchPendingItems(p.admission_id);
    await fetchDepositBalance(p.patient_id);
    await fetchBillingTimeline(p.patient_id);
    await fetchDoctorRounds(p.admission_id);
    setDiscountPercent('0');
    setDiscountAmount('0');
    setDiscountByName('');
    setPaymentMode('cash');
    setTender('');
    setBillingRemarks('');
    setUseDeposit(true);
    setCategoryFilter('all');
  };

  const backToList = () => {
    setView('list');
    setSelectedAdmission(null);
    setPendingItems([]);
    setBedCharges([]);
    setPendingSummary(null);
    setDepositBalance(null);
    setDoctorRounds([]);
    fetchPatients();
    fetchStats();
  };

  const openTransferBed = async () => {
    if (!selectedAdmission) return;
    setTransferBedForm({ new_bed_id: '', reason: '', pending_receive: false });
    setShowTransferBed(true);
    await fetchAvailableBeds();
  };

  const openAuthenticatedHtmlPrint = async (path: string, title: string) => {
    try {
      const html = await api.text(path);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        toast.error(`Popup blocked. Please allow popups to open ${title}.`);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : `Failed to open ${title}`);
    }
  };

  const handleTransferBed = async () => {
    if (!selectedAdmission) return;
    const newBedId = Number(transferBedForm.new_bed_id);
    if (!newBedId) {
      toast.error('Select a new available bed');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/api/admissions/${selectedAdmission.id}/transfer`, {
        new_bed_id: newBedId,
        reason: transferBedForm.reason.trim() || 'Bed transfer from IPD billing',
        pending_receive: transferBedForm.pending_receive,
      });
      toast.success(transferBedForm.pending_receive ? 'Bed transfer requested' : 'Bed transfer completed');
      setShowTransferBed(false);
      setTransferBedForm({ new_bed_id: '', reason: '', pending_receive: false });
      await fetchAdmissionDetail(selectedAdmission.id);
      await fetchPendingItems(selectedAdmission.id);
      await fetchPatients();
      await fetchStats();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to transfer bed');
    } finally {
      setSaving(false);
    }
  };

  // ─── Billing Calculations ───────────────────────────────────────────────────

  const allPendingTotal = pendingItems.reduce((s, i) => s + (i.total_amount || 0), 0);
  const bedTotal = bedCharges.reduce((s, b) => s + (b.charge_amount || 0), 0);
  const subTotal = allPendingTotal + bedTotal;
  const discAmt = subTotal * (parseFloat(discountPercent) / 100) || parseFloat(discountAmount) || 0;
  const billingTotal = Math.max(0, subTotal - discAmt);
  const depBalance = depositBalance?.balance ?? 0;
  const effectiveDeposit = useDeposit ? depBalance : 0;
  const toBePaid = Math.max(0, billingTotal - effectiveDeposit);
  const refundAmount = Math.max(0, effectiveDeposit - billingTotal);
  const refundBlockedByMissingCharge = refundAmount > 0 && subTotal <= 0;
  const tenderNum = parseFloat(tender) || 0;
  const changeAmount = Math.max(0, tenderNum >= toBePaid ? tenderNum - toBePaid : 0);

  // ─── Deposit ─────────────────────────────────────────────────────────────────

  const handleAddDeposit = async () => {
    const amt = parseFloat(depositAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!selectedAdmission) return;

    setSaving(true);
    try {
      await api.post('/api/deposits', {
        patient_id: selectedAdmission.patient_id,
        admission_id: selectedAdmission.id,
        amount: amt,
        payment_method: depositPaymentMethod,
        remarks: depositRemarks || 'IPD deposit',
      });
      toast.success('Deposit added');
      setDepositAmount('');
      setDepositRemarks('');
      fetchDepositBalance(selectedAdmission.patient_id);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to add deposit');
    } finally {
      setSaving(false);
    }
  };

  // ─── Edit Item ───────────────────────────────────────────────────────────────

  const openEditItem = (item: PendingItem) => {
    if (item.item_category === 'doctor_round') {
      toast.error('Doctor round charges must be managed from Doctor Rounds.');
      return;
    }
    setEditItem(item);
    setEditForm({
      quantity: String(item.quantity),
      unit_price: String(item.unit_price),
      discount_percent: String(item.discount_percent),
    });
    setShowEditItems(true);
  };

  const handleEditItem = async () => {
    if (!editItem || !selectedAdmission) return;
    if (!editItem.reference_id) {
      toast.error('This legacy item has no catalog service reference. Cancel it and add a catalog item.');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/api/billing-provisional/${editItem.id}/cancel`, {
        cancel_reason: 'Edited and superseded from IP billing screen',
      });
      await api.post('/api/billing-provisional', {
        patient_id: selectedAdmission.patient_id,
        admission_id: selectedAdmission.id,
        items: [{
          service_item_id: editItem.reference_id,
          quantity: parseInt(editForm.quantity) || 1,
          discount_percent: parseFloat(editForm.discount_percent) || 0,
          department: editItem.department,
        }],
      });
      toast.success('Item updated');
      setShowEditItems(false);
      setEditItem(null);
      fetchPendingItems(selectedAdmission.id);
      fetchPatients();
      fetchStats();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to update item');
    } finally {
      setSaving(false);
    }
  };

  // ─── Finalize Discharge ─────────────────────────────────────────────────────

  const handleDischarge = async () => {
    if (!selectedAdmission) return;

    if (refundBlockedByMissingCharge) {
      toast.error('Deposit refund is blocked because no bill charge was added. Add the missing charge first.');
      return;
    }
    if (refundAmount > 0 && !confirmRefund) {
      toast.error('Confirm the deposit refund before discharge.');
      return;
    }
    if (refundAmount > 0 && !refundNote.trim()) {
      toast.error('Refund note is required for deposit refunds.');
      return;
    }
    if (billingTotal > 0 && paymentMode !== 'credit' && tenderNum < toBePaid) {
      toast.error('Tender must be >= amount to be paid');
      return;
    }
    const effectiveDiscountPercent = subTotal > 0 ? (discAmt / subTotal) * 100 : 0;
    if (effectiveDiscountPercent > 20 && !discountByName.trim()) {
      toast.error('Discount referred by name is required when discount is above 20%.');
      return;
    }

    setFinalizing(true);
    try {
      const result = await api.post<{
        bill_id?: number;
        invoice_no?: string;
        deposit_refunded?: number;
        refund_receipt_no?: string;
        message?: string;
      }>('/api/ip-billing/discharge-bill', {
        admission_id: selectedAdmission.id,
        discount_percent: parseFloat(discountPercent) || 0,
        discount_amount: parseFloat(discountAmount) || undefined,
        discount_by_name: discountByName.trim() || undefined,
        deposit_deducted: useDeposit ? depBalance : 0,
        payment_mode: paymentMode,
        paid_amount: paymentMode === 'credit' ? 0 : toBePaid,
        confirm_excess_deposit_refund: refundAmount > 0 ? confirmRefund : undefined,
        refund_note: refundAmount > 0 ? refundNote.trim() : undefined,
        remarks: billingRemarks || undefined,
      });
      if (result.deposit_refunded && result.deposit_refunded > 0) {
        toast.success(`Discharged! ৳${result.deposit_refunded.toLocaleString()} refunded (${result.refund_receipt_no})`, { duration: 5000 });
      } else if (result.invoice_no) {
        toast.success(`Patient discharged successfully. Bill ${result.invoice_no} created.`);
      } else {
        toast.success('Patient discharged successfully');
      }
      setShowDischarge(false);
      if (redirectToReceptionBillPrint(navigate, basePath, result.bill_id)) {
        return;
      }
      backToList();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to discharge patient');
    } finally {
      setFinalizing(false);
    }
  };

  // ─── RENDER: Patient List View ──────────────────────────────────────────────

  const billingStatusClass = (s: string) => {
    if (s === 'settled') return 'badge-success';
    if (s === 'partial') return 'badge-warning';
    return 'badge-info';
  };

  if (view === 'list') {
    return (
      <DashboardLayout role={role}>
        <div className="space-y-5 max-w-screen-2xl mx-auto">
          {/* Header */}
          <div className="page-header">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <BedDouble className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="page-title">IP Billing</h1>
                <p className="section-subtitle">Inpatient billing management</p>
              </div>
              <HelpButton onClick={() => setHelpOpen(true)} />
              <WhatsAppButton />
            </div>
          </div>

          <ExecutiveDashboardRangeFilter
            filters={reportingFilters}
            onChange={setReportingFilters}
            onRefresh={fetchStats}
            refreshing={false}
          />
          <p className="text-xs font-medium text-[var(--color-text-muted)]" data-testid="ipd-reporting-period">
            Finance period: {reportingPeriod.label}
          </p>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard title="Total Inpatients" value={stats?.total_inpatients ?? '—'} loading={!stats} icon={<BedDouble className="w-5 h-5" />} iconBg="bg-indigo-50 text-indigo-600" index={0} />
            <KPICard title="Admissions in Period" value={stats?.today_admissions ?? '—'} loading={!stats} icon={<Plus className="w-5 h-5" />} iconBg="bg-green-50 text-green-600" index={1} />
            <KPICard title="Discharges in Period" value={stats?.today_discharges ?? '—'} loading={!stats} icon={<LogOut className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={2} />
            <KPICard title="Pending Billing" value={stats?.pending_billing ?? '—'} loading={!stats} icon={<Clock className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={3} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard title="Charges in Period" value={fmtTaka(stats?.total_charges_today ?? 0)} loading={!stats} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600" index={4} />
            <KPICard title="Settled in Period" value={fmtTaka(stats?.settled_today ?? 0)} loading={!stats} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={5} />
            <KPICard title="High Due (>10K)" value={stats?.high_due_patients ?? '—'} loading={!stats} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" index={6} />
            <KPICard title="Package Patients" value={stats?.package_patients ?? '—'} loading={!stats} icon={<FileText className="w-5 h-5" />} iconBg="bg-purple-50 text-purple-600" index={7} />
          </div>

          {/* Filters */}
          <div className="card p-3 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 flex-wrap">
              {STATUS_TABS.map(key => (
                <button key={key} onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === key ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
                  {key === 'all' ? 'All' : key.charAt(0).toUpperCase() + key.slice(1)}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input type="text" placeholder="Search patient name or code" value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setSearch(searchInput); }}
                className="input pl-9" />
            </div>
            <button onClick={() => setSearch(searchInput)} className="btn-secondary">Search</button>
            {search && <button onClick={() => { setSearch(''); setSearchInput(''); }} className="btn-ghost text-sm">Clear</button>}
          </div>

          {/* Patients Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Admission No</th>
                    <th>Patient</th>
                    <th>Ward/Bed</th>
                    <th>Doctor</th>
                    <th>Admitted</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Deposit</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? [...Array(5)].map((_, i) => (
                      <tr key={i}>{[...Array(9)].map((_, j) => (<td key={j}><div className="skeleton h-4 w-full rounded" /></td>))}</tr>
                    ))
                    : patients.length === 0
                      ? (<tr><td colSpan={10}><EmptyState icon={<BedDouble className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No inpatients" description="No admitted patients found" /></td></tr>)
                      : patients.map(p => {
                        const dueAmount = p.balance ?? 0;
                        const rowBg = dueAmount > 15000 ? 'bg-red-50 dark:bg-red-900/10' : dueAmount > 10000 ? 'bg-yellow-50 dark:bg-yellow-900/10' : '';
                        return (
                        <tr key={p.admission_id} className={rowBg}>
                          <td className="font-data font-medium">{p.admission_number}</td>
                          <td className="min-w-48">
                            <div className="font-medium">{p.patient_name}</div>
                            {compactPatientAge(p.date_of_birth) ? (
                              <div className="text-xs font-semibold text-slate-600 dark:text-slate-200">{compactPatientAge(p.date_of_birth)}</div>
                            ) : null}
                            {p.patient_address?.trim() ? (
                              <div className="truncate text-xs text-[var(--color-text-muted)]" title={p.patient_address}>{p.patient_address}</div>
                            ) : null}
                            <div className="text-xs text-[var(--color-text-muted)]">{p.patient_code}</div>
                          </td>
                          <td className="text-sm">{p.ward_name ?? '—'} {p.bed_number ? `/ ${p.bed_number}` : ''}</td>
                          <td className="text-sm">{p.doctor_name ?? '—'}</td>
                          <td className="font-data text-sm">{formatAdmissionDisplay(p.admitted_at_utc ?? p.admitted_date)}</td>
                          <td className="text-right font-medium">{fmtTaka(p.total_charges)}</td>
                          <td className="text-right text-emerald-600">{fmtTaka(p.deposit_balance ?? 0)}</td>
                          <td className="text-right text-sm">
                            {p.balance > 0 && <span className="text-red-600 font-semibold">{fmtTaka(p.balance)}</span>}
                            {p.balance < 0 && <span className="text-emerald-600">Credit: {fmtTaka(Math.abs(p.balance))}</span>}
                            {p.balance === 0 && <span className="text-gray-400">—</span>}
                          </td>
                          <td><span className={`badge ${billingStatusClass(p.billing_status)}`}>{p.billing_status}</span></td>
                          <td>
                            <button onClick={() => openDetail(p)} className="btn-ghost p-1.5 text-[var(--color-primary)]" title="View billing detail">
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <HelpPanel pageKey="billing" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      </DashboardLayout>
    );
  }

  // ─── RENDER: Patient Billing Detail View ─────────────────────────────────────

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Action Bar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={backToList} className="btn-ghost flex items-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div>
              <h1 className="page-title text-lg">
                <BedDouble className="w-5 h-5 inline mr-2 text-indigo-500" />
                IP Billing — {selectedAdmission?.patient_name}
              </h1>
              {compactPatientAge(selectedAdmission?.date_of_birth) ? (
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-200">{compactPatientAge(selectedAdmission?.date_of_birth)}</p>
              ) : null}
              {selectedAdmission?.patient_address?.trim() ? (
                <p className="max-w-xl truncate text-xs text-[var(--color-text-muted)]" title={selectedAdmission.patient_address}>{selectedAdmission.patient_address}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowDoctorRound(true)} className="btn-secondary text-sm">
              <Stethoscope className="w-4 h-4" /> Doctor Round
            </button>
            <button onClick={openTransferBed} className="btn-secondary text-sm">
              <RefreshCw className="w-4 h-4" /> Transfer Bed
            </button>
            <button onClick={() => setShowNewItem(true)} className="btn-primary text-sm">
              <Plus className="w-4 h-4" /> New Item
            </button>
            <button onClick={() => selectedAdmission?.id && openAuthenticatedHtmlPrint(`/api/ip-billing/${selectedAdmission.id}/discharge-clearance`, 'clearance slip')} className="btn-secondary text-sm">
              <Printer className="w-4 h-4" /> Clearance Slip
            </button>
            {pendingItems.length > 0 && (
              <button onClick={() => setShowDischarge(true)} className="btn-primary bg-emerald-600 hover:bg-emerald-700 text-sm">
                <LogOut className="w-4 h-4" /> Discharge
              </button>
            )}
          </div>
        </div>

        {/* ── Patient Info Bar ── */}
        {selectedAdmission && (
          <div className="card p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
              <div>
                <div className="text-xs text-[var(--color-text-muted)] mb-0.5"><Hash className="w-3 h-3 inline" /> IP Number</div>
                <div className="font-semibold">{selectedAdmission.admission_no}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-muted)] mb-0.5"><BedDouble className="w-3 h-3 inline" /> Ward / Bed</div>
                <div className="font-semibold">{selectedAdmission.ward_name ?? '—'} / {selectedAdmission.bed_number ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-muted)] mb-0.5"><User className="w-3 h-3 inline" /> Admitting Doctor</div>
                <div className="font-semibold">{selectedAdmission.doctor_name ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-muted)] mb-0.5"><Calendar className="w-3 h-3 inline" /> Admission Date</div>
                <div className="font-semibold">{formatAdmissionDisplay(selectedAdmission.admitted_at_utc ?? selectedAdmission.admission_date)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-muted)] mb-0.5">Type</div>
                <div className="font-semibold capitalize">{selectedAdmission.admission_type ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-muted)] mb-0.5">Diagnosis</div>
                <div className="font-semibold">{selectedAdmission.provisional_diagnosis || '—'}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Main Content Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* ── Left: Pending Items + Bed Charges ── */}
          <div className="lg:col-span-2 space-y-5">
            {detailLoading ? (
              <div className="card p-8 text-center">
                <div className="skeleton h-6 w-48 mx-auto mb-2 rounded" />
                <div className="skeleton h-4 w-64 mx-auto rounded" />
              </div>
            ) : (
              <>
                {/* Pending Bill Items */}
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
                    <h3 className="font-semibold flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[var(--color-primary)]" />
                      Provisional Items ({pendingItems.length})
                    </h3>
                    <button onClick={() => setShowNewItem(true)} className="btn-primary text-xs px-2 py-1">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>

                  {/* Category-wise Bill Breakdown */}
                  {pendingItems.length > 0 && (
                    <div className="p-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const categories: Record<string, number> = {};
                          pendingItems.forEach(item => {
                            const cat = item.item_category || 'other';
                            categories[cat] = (categories[cat] || 0) + item.total_amount;
                          });
                          if (bedCharges.length > 0) {
                            categories['bed_charge'] = bedCharges.reduce((sum, b) => sum + b.charge_amount, 0);
                          }
                          return Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => (
                            <div key={cat} className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs dark:bg-slate-800">
                              <span className="font-medium capitalize">{cat.replace('_', ' ')}</span>
                              <span className="ml-1.5 font-data font-semibold">{fmtTaka(amount)}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Category Filters */}
                  {pendingItems.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 p-3 border-b border-[var(--color-border)]">
                      <button
                        onClick={() => setCategoryFilter('all')}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${categoryFilter === 'all' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)]'}`}
                      >
                        All ({pendingItems.length + bedCharges.length})
                      </button>
                      {(() => {
                        const categories = new Set(pendingItems.map(i => i.item_category));
                        if (bedCharges.length > 0) categories.add('bed_charge');
                        return Array.from(categories).map(cat => {
                          const count = cat === 'bed_charge'
                            ? bedCharges.length
                            : pendingItems.filter(i => i.item_category === cat).length;
                          return (
                            <button
                              key={cat}
                              onClick={() => setCategoryFilter(cat)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium transition capitalize ${categoryFilter === cat ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)]'}`}
                            >
                              {cat.replace('_', ' ')} ({count})
                            </button>
                          );
                        });
                      })()}
                    </div>
                  )}

                  {pendingItems.length === 0 && bedCharges.length === 0 ? (
                    <div className="p-8 text-center">
                      <FileText className="w-8 h-8 text-[var(--color-text-muted)] opacity-40 mx-auto mb-2" />
                      <p className="text-sm text-[var(--color-text-secondary)] mb-3">No items yet</p>
                      <button onClick={() => setShowNewItem(true)} className="btn-primary text-sm">
                        <Plus className="w-4 h-4" /> Add First Item
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-base">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Item Name</th>
                            <th>Department</th>
                            <th>Category</th>
                            <th className="text-right">Qty</th>
                            <th className="text-right">Price</th>
                            <th className="text-right">Disc %</th>
                            <th className="text-right">Total</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Provisional items (filtered) */}
                          {pendingItems
                            .filter(item => categoryFilter === 'all' || item.item_category === categoryFilter)
                            .map((item, idx) => (
                            <tr key={item.id}>
                              <td className="text-xs text-[var(--color-text-muted)]">{idx + 1}</td>
                              <td className="font-medium text-sm">{item.item_name}</td>
                              <td className="text-sm">{item.department || '—'}</td>
                              <td><span className="badge badge-info text-xs">{item.item_category}</span></td>
                              <td className="text-right text-sm">{item.quantity}</td>
                              <td className="text-right text-sm">{fmtTaka(item.unit_price)}</td>
                              <td className="text-right text-sm">{item.discount_percent}%</td>
                              <td className="text-right font-semibold text-sm">{fmtTaka(item.total_amount)}</td>
                              <td>
                                {item.item_category === 'doctor_round' ? (
                                  <span className="text-xs text-[var(--color-text-muted)]">
                                    Managed via Doctor Rounds
                                  </span>
                                ) : (
                                  <button onClick={() => openEditItem(item)} className="btn-ghost p-1 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]" title="Edit">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                          {/* Bed charge rows (filtered) */}
                          {(categoryFilter === 'all' || categoryFilter === 'bed_charge') && bedCharges.map((bed, idx) => (
                            <tr key={`bed-${bed.id}`} className="bg-[var(--color-border-light)]">
                              <td className="text-xs text-[var(--color-text-muted)]">{pendingItems.length + idx + 1}</td>
                              <td className="font-medium text-sm">{bed.ward_name} — Bed {bed.bed_number} ({bed.bed_type})</td>
                              <td className="text-sm">Ward</td>
                              <td><span className="badge badge-warning text-xs">bed_charge</span></td>
                              <td className="text-right text-sm">{bed.days} days</td>
                              <td className="text-right text-sm">{fmtTaka(bed.rate_per_day)}/day</td>
                              <td className="text-right text-sm">0%</td>
                              <td className="text-right font-semibold text-sm">{fmtTaka(bed.charge_amount)}</td>
                              <td></td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-[var(--color-border-light)] font-semibold">
                            <td colSpan={7} className="text-right pr-4">Sub Total</td>
                            <td className="text-right">{fmtTaka(subTotal)}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {/* Doctor Round History */}
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Stethoscope className="h-4 w-4 text-[var(--color-primary)]" /> Doctor Rounds
                    </h3>
                    <button onClick={() => selectedAdmission && fetchDoctorRounds(selectedAdmission.id)} className="btn-ghost px-2 py-1 text-xs">Refresh</button>
                  </div>
                  {doctorRoundsLoading ? (
                    <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
                  ) : doctorRounds.length === 0 ? (
                    <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">No doctor rounds recorded</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="table-base text-sm">
                        <thead>
                          <tr><th>Doctor</th><th>Round time</th><th>Fee</th><th>Source</th><th>Entered by</th><th>Billing</th></tr>
                        </thead>
                        <tbody>
                          {doctorRounds.map((round) => (
                            <tr key={round.id}>
                              <td className="font-medium">{round.doctor_name_snapshot}</td>
                              <td>{fmtDhakaRoundDateTime(round.rounded_at)}</td>
                              <td className="font-data">{fmtTaka(round.round_fee_snapshot)}</td>
                              <td className="capitalize">{round.entry_source.replace('_', ' ')}</td>
                              <td>{round.entered_by_name || '—'}</td>
                              <td><span className="badge badge-info">{round.bill_status || round.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Billing Timeline */}
                <div className="card overflow-hidden">
                  <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[var(--color-primary)]" />
                      Billing Timeline
                    </h3>
                    <button onClick={() => selectedAdmission && fetchBillingTimeline(selectedAdmission.patient_id)} className="btn-ghost text-xs px-2 py-1">
                      Refresh
                    </button>
                  </div>
                  {timelineLoading ? (
                    <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">Loading...</div>
                  ) : billingTimeline.length === 0 ? (
                    <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">No billing activity yet</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto divide-y divide-[var(--color-border)]">
                      {billingTimeline.map((entry, idx) => {
                        const isCharge = entry.type === 'charge';
                        const isPayment = entry.type === 'payment';
                        return (
                          <div key={idx} className="flex items-start gap-3 p-3">
                            <div className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${isCharge ? 'bg-red-500' : isPayment ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">{entry.description}</div>
                                  <div className="text-xs text-[var(--color-text-muted)]">
                                    {entry.category.replace('_', ' ')}
                                    {entry.payment_method ? ` · ${entry.payment_method}` : ''}
                                    {entry.receipt_no ? ` · ${entry.receipt_no}` : ''}
                                  </div>
                                </div>
                                <div className={`text-sm font-data font-semibold whitespace-nowrap ${isCharge ? 'text-red-600' : 'text-emerald-600'}`}>
                                  {isCharge ? '+' : '-'}{fmtTaka(entry.amount)}
                                </div>
                              </div>
                              <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{formatAdmissionDisplay(entry.created_at)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Print & Estimation */}
                {pendingItems.length > 0 && (
                  <button onClick={() => selectedAdmission?.id && window.open(getIpdRunningBillPrintPath(basePath, selectedAdmission.id), '_blank', 'noopener,noreferrer')} className="btn-secondary text-sm flex-1">
                    <Printer className="w-4 h-4" /> Print Bill
                  </button>
                )}
              </>
            )}
          </div>

          {/* ── Right: Billing Detail Sidebar ── */}
          <div className="space-y-5">
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border)]">
                <h3 className="font-semibold flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-[var(--color-primary)]" />
                  Billing Detail
                </h3>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {/* Sub Total */}
                <div className="flex justify-between p-3 text-sm">
                  <span className="text-[var(--color-text-secondary)]">Sub Total</span>
                  <span className="font-semibold">{fmtTaka(subTotal)}</span>
                </div>
                {/* Discount % */}
                <div className="flex items-center justify-between p-3 text-sm">
                  <span className="text-[var(--color-text-secondary)]">Discount %</span>
                  <input type="number" min="0" max="100" step="0.01" value={discountPercent}
                    onChange={e => { setDiscountPercent(e.target.value); setDiscountAmount(''); }}
                    className="input w-24 text-right text-sm" />
                </div>
                {/* Discount Amt */}
                <div className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="text-[var(--color-text-secondary)]">Discount Amt</span>
                  <input
                    type="number"
                    min="0"
                    max={subTotal}
                    step="0.01"
                    value={discountAmount}
                    onChange={e => { setDiscountAmount(e.target.value); setDiscountPercent('0'); }}
                    className="input w-28 text-right text-sm"
                  />
                </div>
                {/* Discount By Name */}
                {discAmt > 0 && (
                  <div className="p-3 text-sm">
                    <label className="text-[var(--color-text-secondary)] text-xs block mb-1">Discount referred by</label>
                    <input type="text" value={discountByName}
                      onChange={e => setDiscountByName(e.target.value)}
                      className="input w-full text-sm"
                      placeholder="কে দিয়েছে (optional)"
                      maxLength={200} />
                  </div>
                )}
                {/* Billing Total */}
                <div className="flex justify-between p-3 text-sm bg-[var(--color-border-light)]">
                  <span className="font-semibold">Billing Total</span>
                  <span className="font-bold">{fmtTaka(billingTotal)}</span>
                </div>
                {/* Deposit Balance */}
                {depBalance > 0 && (
                  <div className="flex items-center justify-between p-3 text-sm">
                    <span className="text-[var(--color-text-secondary)]">Deposit Balance</span>
                    <span className="font-semibold text-emerald-600">{fmtTaka(depBalance)}</span>
                  </div>
                )}
                {/* Use Deposit toggle */}
                {depBalance > 0 && (
                  <div className="flex items-center justify-between p-3 text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={useDeposit} onChange={e => setUseDeposit(e.target.checked)} className="accent-[var(--color-primary)] w-4 h-4" />
                      <span>Use Deposit?</span>
                    </label>
                  </div>
                )}
                {/* To Be Paid */}
                {toBePaid > 0 && (
                  <div className="flex justify-between p-3 text-sm bg-red-50 dark:bg-red-900/10">
                    <span className="font-semibold text-red-700 dark:text-red-400">To Be Paid</span>
                    <span className="font-bold text-red-700 dark:text-red-400">{fmtTaka(toBePaid)}</span>
                  </div>
                )}
                {/* Payment Mode */}
                {billingTotal > 0 && (
                  <div className="flex items-center justify-between p-3 text-sm">
                    <span className="text-[var(--color-text-secondary)]">Payment Mode</span>
                    <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}
                      className="input w-36 text-sm">
                      {PAYMENT_MODES.map(pm => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
                    </select>
                  </div>
                )}
                {/* Tender */}
                {paymentMode !== 'credit' && toBePaid > 0 && (
                  <div className="flex items-center justify-between p-3 text-sm">
                    <span className="text-[var(--color-text-secondary)]">Tender</span>
                    <input type="number" min="0" step="0.01" value={tender}
                      onChange={e => setTender(e.target.value)}
                      className="input w-36 text-right text-sm" placeholder="0.00" />
                  </div>
                )}
                {/* Change */}
                {paymentMode !== 'credit' && tender && changeAmount > 0 && (
                  <div className="flex justify-between p-3 text-sm bg-emerald-50 dark:bg-emerald-900/10">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">Change / Return</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmtTaka(changeAmount)}</span>
                  </div>
                )}
                {/* Remarks */}
                <div className="p-3 text-sm">
                  <label className="text-[var(--color-text-secondary)] block mb-1">Remarks</label>
                  <textarea value={billingRemarks} onChange={e => setBillingRemarks(e.target.value)}
                    className="input w-full text-sm" rows={2} placeholder="Billing remarks..." maxLength={200} />
                </div>
                {/* Transfer Bed Button */}
                <div className="p-3">
                  <button
                    onClick={openTransferBed}
                    className="btn-secondary w-full">
                    <RefreshCw className="w-4 h-4" /> Transfer Bed
                  </button>
                </div>
                {/* Discharge Button */}
                <div className="p-3 pt-0">
                  <button
                    onClick={() => setShowDischarge(true)}
                    disabled={pendingItems.length === 0 && bedCharges.length === 0}
                    className="btn-primary bg-emerald-600 hover:bg-emerald-700 w-full disabled:opacity-50 disabled:cursor-not-allowed">
                    <LogOut className="w-4 h-4" /> Discharge Patient
                  </button>
                </div>
              </div>
            </div>

            {/* ── Advance Collection (Inline) ── */}
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border)]">
                <h3 className="font-semibold flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  Advance Collection
                </h3>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex justify-between items-center p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800">
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Current Deposit</span>
                  <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{fmtTaka(depBalance)}</span>
                </div>
                <div>
                  <label className="label text-xs">Amount *</label>
                  <input type="number" min="0.01" step="0.01" className="input text-sm"
                    value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                    placeholder="0.00" />
                </div>
                <div>
                  <label className="label text-xs">Payment Method</label>
                  <select className="input text-sm" value={depositPaymentMethod}
                    onChange={e => setDepositPaymentMethod(e.target.value)}>
                    {PAYMENT_MODES.filter(pm => pm.value !== 'credit').map(pm => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Remarks</label>
                  <input type="text" className="input text-sm" value={depositRemarks}
                    onChange={e => setDepositRemarks(e.target.value)} placeholder="Optional" />
                </div>
                <button onClick={handleAddDeposit} disabled={saving || !depositAmount} className="btn-primary w-full text-sm">
                  {saving ? 'Adding...' : 'Collect Advance'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ BED TRANSFER MODAL ═══════ */}
      {showTransferBed && selectedAdmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowTransferBed(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-modal dark:bg-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] p-5">
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><RefreshCw className="h-5 w-5 text-indigo-600" /> Transfer Bed</h3>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">{selectedAdmission.patient_name} · {selectedAdmission.admission_no}</p>
              </div>
              <button className="btn-ghost p-1.5" onClick={() => setShowTransferBed(false)} aria-label="Close transfer bed"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Current Bed</label>
                  <div className="input bg-[var(--color-border-light)] text-sm">{selectedAdmission.ward_name ?? '—'} / {selectedAdmission.bed_number ?? '—'}</div>
                </div>
                <div>
                  <label className="label">New Bed *</label>
                  <select className="input text-sm" value={transferBedForm.new_bed_id}
                    onChange={e => setTransferBedForm(f => ({ ...f, new_bed_id: e.target.value }))}>
                    <option value="">Select available bed</option>
                    {availableBeds.map((bed) => (
                      <option key={bed.id} value={bed.id}>
                        {bed.ward_name} / {bed.bed_number} · {bed.bed_type}{bed.effective_rate != null ? ` · ${fmtTaka(Number(bed.effective_rate))}/day` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Reason</label>
                <textarea className="input text-sm min-h-20" rows={3}
                  value={transferBedForm.reason}
                  onChange={e => setTransferBedForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="Example: Patient shifted to cabin / ICU / different ward" />
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm">
                <input type="checkbox" className="mt-1" checked={transferBedForm.pending_receive}
                  onChange={e => setTransferBedForm(f => ({ ...f, pending_receive: e.target.checked }))} />
                <span>
                  <span className="font-medium">Require receiving ward confirmation</span>
                  <span className="block text-xs text-[var(--color-text-muted)]">Unchecked means transfer completes immediately and IPD bed charge starts on the new bed now.</span>
                </span>
              </label>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Billing: current bed charge segment will close and a new segment will be created when the transfer is completed.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowTransferBed(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleTransferBed} disabled={saving || !transferBedForm.new_bed_id} className="btn-primary">
                  {saving ? 'Saving...' : 'Confirm Transfer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ PROVISIONAL BILLING MODAL (shared) ═══════ */}
      {showDoctorRound && selectedAdmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-modal dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] p-5">
              <h3 className="flex items-center gap-2 font-semibold"><Stethoscope className="h-5 w-5" /> Doctor Round</h3>
              <button className="btn-ghost p-1.5" onClick={() => setShowDoctorRound(false)} aria-label="Close doctor round"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5">
              <DoctorRoundForm
                patientId={selectedAdmission.patient_id}
                patientName={selectedAdmission.patient_name}
                admissionId={selectedAdmission.id}
                admissionNo={selectedAdmission.admission_no}
                entrySource="ipd_billing"
                onCancel={() => setShowDoctorRound(false)}
                onSuccess={() => {
                  toast.success(t('doctorRound.saved', { ns: 'billing' }));
                  setShowDoctorRound(false);
                  fetchPendingItems(selectedAdmission.id);
                  fetchDoctorRounds(selectedAdmission.id);
                  fetchBillingTimeline(selectedAdmission.patient_id);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {showNewItem && selectedAdmission && (
        <ProvisionalBillingModal
          onClose={() => {
            setShowNewItem(false);
            if (selectedAdmission) {
              fetchPendingItems(selectedAdmission.id);
              fetchPatients();
              fetchStats();
            }
          }}
          formatBDT={fmtTaka}
          basePath={basePath}
          initialAdmissionId={selectedAdmission.id}
          initialPatientId={selectedAdmission.patient_id}
        />
      )}


      {/* ═══════ EDIT ITEM MODAL ═══════ */}
      {showEditItems && editItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold flex items-center gap-2">
                <Pencil className="w-5 h-5 text-[var(--color-primary)]" />
                Edit Item: {editItem.item_name}
              </h3>
              <button onClick={() => setShowEditItems(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Quantity</label>
                  <input type="number" min="1" className="input" value={editForm.quantity}
                    onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Unit Price</label>
                  <input type="number" min="0" step="0.01" className="input bg-[var(--color-border-light)]" value={editForm.unit_price}
                    readOnly />
                </div>
              </div>
              <div>
                <label className="label">Discount %</label>
                <input type="number" min="0" max="100" className="input" value={editForm.discount_percent}
                  onChange={e => setEditForm(f => ({ ...f, discount_percent: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowEditItems(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleEditItem} disabled={saving} className="btn-primary">
                  {saving ? 'Updating...' : 'Update Item'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ DISCHARGE CONFIRMATION MODAL ═══════ */}
      {showDischarge && selectedAdmission && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <LogOut className="w-5 h-5 text-red-600" />
                <h3 className="font-semibold">Confirm Discharge — {selectedAdmission.patient_name}</h3>
              </div>
              <button onClick={() => setShowDischarge(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-300">
                <strong>Warning:</strong> This will close inpatient billing and discharge the patient. This action cannot be undone.
              </div>

              {/* Summary */}
              <div className="grid grid-cols-2 gap-px bg-[var(--color-border)] rounded-lg overflow-hidden">
                {[
                  { label: 'IP Number', value: selectedAdmission.admission_no },
                  { label: 'Ward/Bed', value: `${selectedAdmission.ward_name ?? 'N/A'} / ${selectedAdmission.bed_number ?? 'N/A'}` },
                  { label: 'Billing Total', value: fmtTaka(billingTotal) },
                  { label: 'Deposit Balance', value: fmtTaka(depBalance) },
                  ...(depBalance > billingTotal
                    ? [
                        { label: 'Deposit Adjustment', value: fmtTaka(billingTotal) },
                        { label: 'Refund Amount', value: fmtTaka(refundAmount), highlight: true },
                      ]
                    : [
                        { label: 'To Be Paid', value: fmtTaka(toBePaid) },
                        { label: 'Payment Mode', value: paymentMode.toUpperCase() },
                      ]),
                ].map((item, i) => (
                  <div key={i} className={`bg-[var(--color-surface)] p-3 ${'highlight' in item && item.highlight ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
                    <div className="text-xs text-[var(--color-text-muted)]">{item.label}</div>
                    <div className={`font-semibold text-sm ${'highlight' in item && item.highlight ? 'text-green-600 dark:text-green-400' : ''}`}>{item.value}</div>
                  </div>
                ))}
              </div>

              {refundAmount > 0 && (
                <div className={`${refundBlockedByMissingCharge ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300'} border rounded-lg p-3 text-sm space-y-3`}>
                  <div>
                    <strong>Refund:</strong> {fmtTaka(refundAmount)} will be returned to the patient from deposit. Counter cash will be reduced.
                  </div>
                  {refundBlockedByMissingCharge ? (
                    <div className="font-semibold">Bill charge is ৳0. Add the missing charge before discharge; system refund is blocked.</div>
                  ) : (
                    <>
                      <label className="flex items-start gap-2 font-semibold">
                        <input type="checkbox" className="mt-1" checked={confirmRefund} onChange={e => setConfirmRefund(e.target.checked)} />
                        <span>I confirm this cash refund will be returned to the patient/guardian now.</span>
                      </label>
                      <input className="input h-10 bg-white" value={refundNote} onChange={e => setRefundNote(e.target.value)} placeholder="Refund reason / approver / receiver signature note" />
                    </>
                  )}
                </div>
              )}

              {paymentMode !== 'credit' && toBePaid > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Tender</label>
                    <input type="number" min="0" step="0.01" className="input"
                      value={tender} onChange={e => setTender(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Change</label>
                    <div className="input bg-[var(--color-border-light)] text-emerald-600 font-semibold flex items-center">
                      {fmtTaka(changeAmount)}
                    </div>
                  </div>
                </div>
              )}

              {discAmt > 0 && (
                <div>
                  <label className="label">Discount referred by (কে দিয়েছে)</label>
                  <input type="text" className="input w-full"
                    value={discountByName} onChange={e => setDiscountByName(e.target.value)}
                    placeholder="Name of person who referred the discount" maxLength={200} />
                </div>
              )}

              <div>
                <label className="label">Discharge Remarks</label>
                <textarea className="input w-full" rows={2} value={billingRemarks}
                  onChange={e => setBillingRemarks(e.target.value)} placeholder="Remarks..." maxLength={200} />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowDischarge(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleDischarge} disabled={finalizing} className="btn-primary bg-emerald-600 hover:bg-emerald-700">
                  {finalizing ? 'Discharging...' : refundAmount > 0 ? 'Confirm Refund & Discharge' : 'Confirm Discharge'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <HelpPanel pageKey="billing" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </DashboardLayout>
  );
}

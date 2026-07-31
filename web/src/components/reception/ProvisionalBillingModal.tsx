import { useState, useEffect, useCallback, useId } from 'react';
import { X, Search, Printer, Banknote, Trash2, LogOut, Stethoscope, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/apiClient';
import { getIpdRunningBillPrintPath } from '../../lib/handover';
import { useQueryClient } from '../../hooks/useApiQuery';
import DischargeModal from './DischargeModal';
import DoctorRoundForm from '../ipd/DoctorRoundForm';
import { formatAgeFromDateOfBirth } from '../../lib/age';
import { formatDoctorDisplayName } from '../../lib/doctorName';
import { formatAdmissionDisplay } from '../../lib/admissionDisplay';
import { buildDischargeFinancial, type IpdFinancialClearanceApi } from '../../lib/ipdDischargeFinancial';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PBAdmittedPatient {
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
  total_charges: number;
  total_paid: number;
  balance: number;
  deposit_balance?: number;
}

interface PBPendingItem {
  id: number;
  item_name: string;
  item_category: string;
  unit_price: number;
  quantity: number;
  total_amount: number;
  created_at: string;
  bill_status: string;
}

interface PBBedCharge {
  id: number;
  ward_name?: string | null;
  bed_number?: string | null;
  bed_type?: string | null;
  rate_per_day: number;
  days: number;
  charge_amount: number;
  started_on?: string | null;
}

interface PBAvailableBed {
  id: number;
  ward_name: string;
  bed_number: string;
  bed_type: string;
  rate_per_day?: number;
  effective_rate?: number;
  feature_names?: string;
}

interface PBSettledBill {
  id: number;
  invoice_no?: string | null;
  created_at?: string | null;
  total?: number | null;
  paid?: number | null;
  deposit_deducted?: number | null;
  due?: number | null;
  status?: string | null;
}

interface PBPendingSummary {
  provisional_total: number;
  package_total?: number;
  bed_total?: number;
  grand_total?: number;
  running_total?: number;
  settled_total?: number;
  settled_cash_paid?: number;
  settled_deposit_used?: number;
  deposit_balance: number;
  deposit_total?: number;
  deposit_used?: number;
  net_payable: number;
  refund_available?: number;
  pending_service_amount?: number;
}

interface PBPackageInfo {
  id: number;
  package_name: string;
  package_code?: string;
  description?: string;
  total_price: number;
  included_bed_days: number;
  extra_bed_rate: number;
  package_type: string;
  items?: Array<{ id: number; item_name: string; quantity?: number; price?: number }>;
}

interface PBDepartment { id: number; department_name: string; }
interface PBServiceItem { id: number; item_name: string; price?: number; unit_price?: number; service_department_id: number; }
interface PBDoctorOption { id: number; name: string; specialty?: string | null; }

type ChargeMode = 'catalog' | 'manual' | 'doctor_round';

interface ProvisionalChargePayloadInput {
  mode: ChargeMode;
  item?: PBServiceItem;
  departmentName?: string;
  manualCategory?: string;
  manualDescription?: string;
  manualDepartment?: string;
  quantity: string;
  unitPrice?: string;
  doctorId?: number;
  doctorName?: string;
  doctorPayableAmount?: number;
}

export function buildProvisionalChargePayload(input: ProvisionalChargePayloadInput) {
  const quantity = Math.max(1, parseInt(input.quantity, 10) || 1);

  if (input.mode === 'manual') {
    return {
      is_manual: true,
      item_category: (input.manualCategory || 'service').trim(),
      item_name: (input.manualDescription || '').trim(),
      department: (input.manualDepartment || 'Manual').trim(),
      quantity,
      unit_price: Number(input.unitPrice) || 0,
      discount_percent: 0,
      ...(input.doctorId ? { doctor_id: input.doctorId, doctor_name: input.doctorName, doctor_payable_amount: input.doctorPayableAmount } : {}),
    };
  }

  if (!input.item) return null;
  return {
    service_item_id: input.item.id,
    item_name: input.item.item_name,
    quantity,
    discount_percent: 0,
    department: input.departmentName ?? '',
  };
}

export function getIpdProvisionalDisplayTotal(summary?: { provisional_total?: number; package_total?: number; bed_total?: number; grand_total?: number } | null) {
  if (!summary) return 0;
  const grandTotal = Number(summary.grand_total ?? 0);
  if (grandTotal > 0) return grandTotal;
  return Number(summary.provisional_total ?? 0) + Number(summary.package_total ?? 0) + Number(summary.bed_total ?? 0);
}

export function getCompactPatientAge(dateOfBirth?: string | null): string | null {
  const age = formatAgeFromDateOfBirth(dateOfBirth, 'en-GB');
  return age === '—' ? null : age;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProvisionalBillingModal({
  onClose,
  formatBDT,
  basePath,
  initialAdmissionId,
  initialPatientId,
}: {
  onClose: () => void;
  formatBDT: (n: number) => string;
  basePath: string;
  initialAdmissionId?: number;
  initialPatientId?: number;
}) {
  const { t } = useTranslation(['reception', 'billing', 'common', 'patients', 'sidebar']);
  const titleId = useId();
  const depositTitleId = useId();
  const queryClient = useQueryClient();

  // Patient search
  const [patientSearch, setPatientSearch] = useState('');
  const [patients, setPatients] = useState<PBAdmittedPatient[]>([]);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PBAdmittedPatient | null>(null);

  // Pending items
  const [pendingItems, setPendingItems] = useState<PBPendingItem[]>([]);
  const [bedCharges, setBedCharges] = useState<PBBedCharge[]>([]);
  const [settledBills, setSettledBills] = useState<PBSettledBill[]>([]);
  const [summary, setSummary] = useState<PBPendingSummary | null>(null);
  const [financialClearance, setFinancialClearance] = useState<IpdFinancialClearanceApi | null>(null);
  const [packageInfo, setPackageInfo] = useState<PBPackageInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'running' | 'settled'>('running');

  // Add items
  const [departments, setDepartments] = useState<PBDepartment[]>([]);
  const [serviceItems, setServiceItems] = useState<PBServiceItem[]>([]);
  const [doctors, setDoctors] = useState<PBDoctorOption[]>([]);
  const [chargeMode, setChargeMode] = useState<ChargeMode>('catalog');
  const [newDept, setNewDept] = useState('');
  const [newItem, setNewItem] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [newPrice, setNewPrice] = useState('');
  const [manualCategory, setManualCategory] = useState('service');
  const [manualDescription, setManualDescription] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [doctorPayableEnabled, setDoctorPayableEnabled] = useState(false);
  const [payableDoctorId, setPayableDoctorId] = useState('');
  const [doctorPayableAmount, setDoctorPayableAmount] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [deptSearch, setDeptSearch] = useState('');
  const [showDeptDropdown, setShowDeptDropdown] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [showItemDropdown, setShowItemDropdown] = useState(false);

  // Deposit
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmt, setDepositAmt] = useState('');
  const [depositMethod, setDepositMethod] = useState('cash');
  const [depositRemarks, setDepositRemarks] = useState('');
  const [depositSaving, setDepositSaving] = useState(false);

  // Discharge
  const [showDischarge, setShowDischarge] = useState(false);

  // Bed transfer
  const [showTransferBed, setShowTransferBed] = useState(false);
  const [availableBeds, setAvailableBeds] = useState<PBAvailableBed[]>([]);
  const [transferBedForm, setTransferBedForm] = useState({ new_bed_id: '', reason: '', pending_receive: false });
  const [transferSaving, setTransferSaving] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showTransferBed) {
        setShowTransferBed(false);
        return;
      }
      if (showDeposit) {
        setShowDeposit(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showDeposit, showTransferBed]);

  // Fetch admitted patients
  const fetchPatients = useCallback(async (search: string) => {
    setPatientsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const q = params.toString();
      const data = await api.get<{ data: PBAdmittedPatient[] }>(`/api/ip-billing/patients${q ? `?${q}` : ''}`);
      setPatients(data.data ?? []);
    } catch { setPatients([]); }
    finally { setPatientsLoading(false); }
  }, []);

  // Fetch pending items for selected patient
  const fetchPending = useCallback(async (admissionId: number) => {
    setDetailLoading(true);
    try {
      const data = await api.get<{
        items: PBPendingItem[];
        bed_charges?: { segments?: PBBedCharge[]; bed_total?: number };
        settled_bills?: PBSettledBill[];
        summary: PBPendingSummary;
        financial_clearance?: IpdFinancialClearanceApi;
        package?: PBPackageInfo | null;
      }>(`/api/ip-billing/pending/${admissionId}`);
      setPendingItems(data.items ?? []);
      setBedCharges(data.bed_charges?.segments ?? []);
      setSettledBills(data.settled_bills ?? []);
      setSummary(data.summary ?? null);
      setFinancialClearance(data.financial_clearance ?? null);
      setPackageInfo(data.package ?? null);
    } catch {
      setPendingItems([]);
      setBedCharges([]);
      setSettledBills([]);
      setSummary(null);
      setFinancialClearance(null);
      setPackageInfo(null);
    }
    finally { setDetailLoading(false); }
  }, []);

  const fetchAvailableBeds = useCallback(async () => {
    try {
      const data = await api.get<{ beds: PBAvailableBed[] }>('/api/admissions/available-beds-with-pricing');
      setAvailableBeds(data.beds ?? []);
    } catch {
      setAvailableBeds([]);
      toast.error(t('toast.failedToLoadAvailableBeds', { ns: 'reception', defaultValue: 'Failed to load available beds' }));
    }
  }, [t]);

  const fetchDoctors = useCallback(async () => {
    try {
      const data = await api.get<{ doctors: PBDoctorOption[] }>('/api/doctors');
      setDoctors(data.doctors ?? []);
    } catch {
      setDoctors([]);
    }
  }, []);

  // Fetch departments
  const fetchDepartments = useCallback(async () => {
    try {
      const data = await api.get<{ data: PBDepartment[] }>('/api/billing-master/service-departments');
      setDepartments(data.data ?? []);
    } catch { /* silent */ }
  }, []);

  // Fetch service items by department
  const fetchServiceItems = useCallback(async (deptId?: string) => {
    try {
      const params = new URLSearchParams();
      if (deptId) params.set('department_id', deptId);
      params.set('per_page', '200');
      const q = params.toString();
      const data = await api.get<{ data: PBServiceItem[] }>(`/api/billing-master/service-items${q ? `?${q}` : ''}`);
      setServiceItems(data.data ?? []);
    } catch { setServiceItems([]); }
  }, []);

  useEffect(() => { fetchPatients(''); fetchDepartments(); fetchDoctors(); }, [fetchPatients, fetchDepartments, fetchDoctors]);

  // Debounced patient search
  useEffect(() => {
    const t = window.setTimeout(() => fetchPatients(patientSearch), 400);
    return () => window.clearTimeout(t);
  }, [patientSearch, fetchPatients]);

  // When department changes, fetch items
  useEffect(() => { fetchServiceItems(newDept || undefined); }, [newDept, fetchServiceItems]);

  // Select patient
  const selectPatient = async (p: PBAdmittedPatient) => {
    setSelectedPatient(p);
    await fetchPending(p.admission_id);
  };

  useEffect(() => {
    if (!initialAdmissionId || selectedPatient || patients.length === 0) return;
    const match = patients.find((patient) =>
      Number(patient.admission_id) === Number(initialAdmissionId)
      || (initialPatientId ? Number(patient.patient_id) === Number(initialPatientId) : false)
    );
    if (!match) return;
    setSelectedPatient(match);
    void fetchPending(match.admission_id);
  }, [fetchPending, initialAdmissionId, initialPatientId, patients, selectedPatient]);

  // Add item
  const handleAddItem = async () => {
    if (!selectedPatient) return;

    const item = chargeMode === 'catalog'
      ? serviceItems.find(si => String(si.id) === newItem || si.item_name === newItem)
      : undefined;

    if (chargeMode === 'catalog' && !item) { toast.error(t('toast.invalidItem', { ns: 'reception' })); return; }
    if (chargeMode === 'manual' && manualDescription.trim().length < 3) { toast.error(t('toast.enterChargeDescription', { ns: 'reception', defaultValue: 'Enter charge description' })); return; }
    if (chargeMode === 'manual' && (!Number(manualPrice) || Number(manualPrice) <= 0)) { toast.error(t('toast.enterValidAmount', { ns: 'reception' })); return; }

    if (chargeMode === 'manual' && doctorPayableEnabled && !payableDoctorId) { toast.error(t('toast.selectDoctorForPayable', { ns: 'reception', defaultValue: 'Select doctor for payable' })); return; }
    const payableDoctor = doctors.find((doctor) => String(doctor.id) === payableDoctorId);
    const payableAmount = doctorPayableEnabled ? Number(doctorPayableAmount || manualPrice || 0) : undefined;
    if (chargeMode === 'manual' && doctorPayableEnabled && (!payableAmount || payableAmount <= 0)) { toast.error(t('toast.enterDoctorPayableAmount', { ns: 'reception', defaultValue: 'Enter doctor payable amount' })); return; }

    const payloadItem = buildProvisionalChargePayload({
      mode: chargeMode,
      item,
      departmentName: departments.find(d => String(d.id) === newDept)?.department_name ?? '',
      manualCategory,
      manualDescription,
      manualDepartment: 'Manual',
      quantity: newQty,
      unitPrice: manualPrice,
      doctorId: doctorPayableEnabled && payableDoctor ? Number(payableDoctor.id) : undefined,
      doctorName: doctorPayableEnabled ? payableDoctor?.name : undefined,
      doctorPayableAmount: doctorPayableEnabled ? payableAmount : undefined,
    });
    if (!payloadItem) { toast.error(t('toast.selectAnItem', { ns: 'reception' })); return; }

    setAddingItem(true);
    try {
      await api.post('/api/billing-provisional', {
        patient_id: selectedPatient.patient_id,
        admission_id: selectedPatient.admission_id,
        items: [payloadItem],
      });
      toast.success(t('toast.itemAdded', { ns: 'reception' }));
      setNewItem('');
      setNewQty('1');
      setNewPrice('');
      setManualDescription('');
      setManualPrice('');
      setDoctorPayableEnabled(false);
      setPayableDoctorId('');
      setDoctorPayableAmount('');
      await fetchPending(selectedPatient.admission_id);
      queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.failedToAddItem', { ns: 'reception' }));
    } finally { setAddingItem(false); }
  };

  const isDoctorRoundItem = (item: Pick<PBPendingItem, 'item_category'>) => String(item.item_category ?? '').toLowerCase() === 'doctor_round';

  const handleDeleteBedCharge = async (bed: PBBedCharge) => {
    if (!selectedPatient) return;
    const confirmed = window.confirm(t('confirm.removeAutoBedCharge', {
      ns: 'reception',
      defaultValue: 'Remove this auto bed charge from the running bill? Bed history will remain, but this charge will not be billed.',
    }));
    if (!confirmed) return;
    try {
      await api.delete(`/api/ip-billing/pending/${selectedPatient.admission_id}/bed-charges/${bed.id}`);
      toast.success(t('toast.autoBedChargeRemoved', { ns: 'reception', defaultValue: 'Auto bed charge removed' }));
      await fetchPending(selectedPatient.admission_id);
      queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.failedToRemoveBedCharge', { ns: 'reception', defaultValue: 'Failed to remove bed charge' }));
    }
  };

  // Delete item
  const handleDeleteItem = async (item: PBPendingItem) => {
    if (!selectedPatient) return;
    if (isDoctorRoundItem(item)) {
      toast.error(t('toast.doctorRoundManagedSeparately', { ns: 'reception', defaultValue: 'Doctor round charges must be managed from Doctor Rounds.' }));
      return;
    }
    try {
      await api.patch(`/api/billing-provisional/${item.id}/cancel`, { cancel_reason: 'Removed from provisional billing modal' });
      toast.success(t('toast.itemRemoved', { ns: 'reception' }));
      await fetchPending(selectedPatient.admission_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.failedToRemoveItem', { ns: 'reception' }));
    }
  };

  // Add deposit
  const handleAddDeposit = async () => {
    if (!selectedPatient) return;
    const amt = parseFloat(depositAmt);
    if (!amt || amt <= 0) { toast.error(t('toast.enterValidAmount', { ns: 'reception' })); return; }
    setDepositSaving(true);
    try {
      await api.post('/api/deposits', {
        patient_id: selectedPatient.patient_id,
        admission_id: selectedPatient.admission_id,
        amount: amt,
        payment_method: depositMethod,
        remarks: depositRemarks || 'IPD deposit from provisional billing',
      });
      toast.success(t('toast.depositAdded', { ns: 'reception' }));
      setShowDeposit(false);
      setDepositAmt('');
      setDepositRemarks('');
      await fetchPending(selectedPatient.admission_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.failedToAddDeposit', { ns: 'reception' }));
    } finally { setDepositSaving(false); }
  };

  const openTransferBedModal = async () => {
    if (!selectedPatient) return;
    setTransferBedForm({ new_bed_id: '', reason: '', pending_receive: false });
    setShowTransferBed(true);
    await fetchAvailableBeds();
  };

  const handleTransferBed = async () => {
    if (!selectedPatient) return;
    const newBedId = Number(transferBedForm.new_bed_id);
    if (!newBedId) {
      toast.error(t('toast.selectNewBed', { ns: 'reception', defaultValue: 'Select a new available bed' }));
      return;
    }
    const selectedBed = availableBeds.find((bed) => Number(bed.id) === newBedId);
    setTransferSaving(true);
    try {
      await api.put(`/api/admissions/${selectedPatient.admission_id}/transfer`, {
        new_bed_id: newBedId,
        reason: transferBedForm.reason.trim() || 'Bed transfer from reception IPD billing modal',
        pending_receive: transferBedForm.pending_receive,
      });
      toast.success(transferBedForm.pending_receive
        ? t('toast.bedTransferRequested', { ns: 'reception', defaultValue: 'Bed transfer requested' })
        : t('toast.bedTransferCompleted', { ns: 'reception', defaultValue: 'Bed transfer completed' }));
      setShowTransferBed(false);
      setTransferBedForm({ new_bed_id: '', reason: '', pending_receive: false });
      if (!transferBedForm.pending_receive && selectedBed) {
        setSelectedPatient((current) => current ? {
          ...current,
          ward_name: selectedBed.ward_name,
          bed_number: selectedBed.bed_number,
        } : current);
      }
      await fetchPending(selectedPatient.admission_id);
      await fetchPatients(patientSearch);
      queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
      queryClient.invalidateQueries({ queryKey: ['admissions'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.failedToTransferBed', { ns: 'reception', defaultValue: 'Failed to transfer bed' }));
    } finally {
      setTransferSaving(false);
    }
  };

  // Selected service item price
  useEffect(() => {
    if (chargeMode !== 'catalog') return;
    const item = serviceItems.find(si => si.item_name === newItem || String(si.id) === newItem);
    if (item) setNewPrice(String(item.price ?? item.unit_price ?? 0));
  }, [chargeMode, newItem, serviceItems]);

  const totalBilled = getIpdProvisionalDisplayTotal(summary);
  const packageTotal = Number(summary?.package_total ?? packageInfo?.total_price ?? 0);
  const depositBalance = summary?.deposit_balance ?? 0;
  const depositTotal = summary?.deposit_total ?? 0;
  const depositUsed = summary?.deposit_used ?? 0;
  const refundAvailable = summary?.refund_available ?? Math.max(0, depositBalance - totalBilled);
  const netPayable = summary?.net_payable ?? Math.max(0, totalBilled - depositBalance);

  function getCategoryBadgeClass(category: string): string {
    const lower = category.toLowerCase();
    if (/bed|room/.test(lower)) return 'bg-blue-50 text-blue-700';
    if (/lab|invest/.test(lower)) return 'bg-purple-50 text-purple-700';
    if (/ot|operation|surgery/.test(lower)) return 'bg-red-50 text-red-700';
    if (/nurs/.test(lower)) return 'bg-green-50 text-green-700';
    if (/pharm|medicine/.test(lower)) return 'bg-orange-50 text-orange-700';
    if (/consum/.test(lower)) return 'bg-yellow-50 text-yellow-700';
    if (/ambu|transport/.test(lower)) return 'bg-cyan-50 text-cyan-700';
    if (/blood/.test(lower)) return 'bg-pink-50 text-pink-700';
    if (/consult/.test(lower)) return 'bg-indigo-50 text-indigo-700';
    if (/service/.test(lower)) return 'bg-gray-50 text-gray-700';
    return 'bg-blue-50 text-blue-700';
  }

  const filteredDepartments = departments.filter(d =>
    d.department_name.toLowerCase().includes(deptSearch.toLowerCase())
  );

  const selectedDeptName = departments.find(d => String(d.id) === newDept)?.department_name ?? '';

  const filteredServiceItems = serviceItems.filter(si =>
    si.item_name.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const selectedItemName = serviceItems.find(si => String(si.id) === newItem)?.item_name ?? '';
  const manualChargeReady = manualDescription.trim().length >= 3 && Number(manualPrice) > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 pt-8 z-50 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-5xl mb-8" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 id={titleId} className="font-semibold text-lg">{t('modal.ipdProvisionalBilling', { ns: 'reception' })}</h3>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label={t('close', { ns: 'common', defaultValue: 'Close' })}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Section A: Patient Search */}
          {!selectedPatient ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
                <input
                  className="input h-11 pl-9 text-base"
                  type="search"
                  name="ipdProvisionalPatientSearch"
                  autoComplete="off"
                  aria-label={t('form.searchAdmittedPatient', { ns: 'reception', defaultValue: 'Search bed / name / mobile / PID' })}
                  value={patientSearch}
                  onChange={e => setPatientSearch(e.target.value)}
                  placeholder={t('form.searchAdmittedPatient', { ns: 'reception', defaultValue: 'Search bed / name / mobile / PID' })}
                  autoFocus
                />
              </div>
              {patientsLoading ? (
                <div className="skeleton h-24 rounded-lg" />
              ) : patients.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">
                  {t('form.noAdmittedPatients', { ns: 'reception' })}
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                  {patients.map(p => (
                    <button
                      key={p.admission_id}
                      className="flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 text-left text-sm last:border-0 hover:bg-[var(--color-bg-secondary)]"
                      onClick={() => selectPatient(p)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap text-sm font-semibold text-slate-800 dark:text-slate-100">
                          <span className="shrink-0">{p.patient_name}</span>
                          {getCompactPatientAge(p.date_of_birth) ? (
                            <>
                              <span className="shrink-0" aria-hidden="true">•</span>
                              <span className="shrink-0">{getCompactPatientAge(p.date_of_birth)}</span>
                            </>
                          ) : null}
                          {p.patient_address?.trim() ? (
                            <>
                              <span className="shrink-0" aria-hidden="true">•</span>
                              <span className="truncate" title={p.patient_address}>{p.patient_address}</span>
                            </>
                          ) : null}
                        </div>
                        <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                          {p.patient_code} {p.ward_name ? `| ${p.ward_name}` : ''} {p.bed_number ? `- Bed ${p.bed_number}` : ''} {formatDoctorDisplayName(p.doctor_name) ? `| ${formatDoctorDisplayName(p.doctor_name)}` : ''}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="font-data text-sm font-semibold">{formatBDT(p.total_charges)}</span>
                        <span className="block whitespace-nowrap text-sm font-medium text-slate-700 dark:text-slate-200">Admitted {formatAdmissionDisplay(p.admitted_at_utc ?? p.admitted_date)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Patient Info Strip */}
              <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-semibold text-sm">
                    {selectedPatient.patient_name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-1 overflow-hidden whitespace-nowrap text-sm font-semibold text-slate-800 dark:text-slate-100">
                      <span className="shrink-0">{selectedPatient.patient_name}</span>
                      {getCompactPatientAge(selectedPatient.date_of_birth) ? (
                        <>
                          <span className="shrink-0" aria-hidden="true">•</span>
                          <span className="shrink-0">{getCompactPatientAge(selectedPatient.date_of_birth)}</span>
                        </>
                      ) : null}
                      {selectedPatient.patient_address?.trim() ? (
                        <>
                          <span className="shrink-0" aria-hidden="true">•</span>
                          <span className="truncate" title={selectedPatient.patient_address}>{selectedPatient.patient_address}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                      {selectedPatient.patient_code} | {selectedPatient.ward_name ?? 'Ward'} - Bed {selectedPatient.bed_number ?? '-'} | {formatDoctorDisplayName(selectedPatient.doctor_name) ?? 'No doctor'}
                    </div>
                    <div className="whitespace-nowrap text-sm font-medium text-slate-700 dark:text-slate-200">
                      Admitted {formatAdmissionDisplay(selectedPatient.admitted_at_utc ?? selectedPatient.admitted_date)}
                    </div>
                  </div>
                </div>
                <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setSelectedPatient(null); setPendingItems([]); setBedCharges([]); setSettledBills([]); setSummary(null); setPackageInfo(null); }}>{t('btn.changePatient', { ns: 'reception' })}</button>
              </div>

              {/* Section 1B: Package Info */}
              {packageInfo && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Package</span>
                      <p className="text-sm font-medium text-blue-900 mt-0.5">{packageInfo.package_name}</p>
                      {packageInfo.description && <p className="text-xs text-blue-700 mt-0.5">{packageInfo.description}</p>}
                    </div>
                    <div className="text-right">
                      <div className="font-data text-lg font-bold text-blue-800">{formatBDT(packageInfo.total_price)}</div>
                    </div>
                  </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-blue-800">
                      {packageInfo.package_type === 'package_included_days' ? (
                        <span className="inline-flex items-center gap-1 bg-blue-100 rounded px-2 py-0.5">
                          Bed included in package
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-blue-100 rounded px-2 py-0.5">
                          Bed charged by selected bed rate
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 bg-blue-100 rounded px-2 py-0.5 capitalize">
                        Type: {packageInfo.package_type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {packageInfo.items && packageInfo.items.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-blue-200">
                        <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider mb-1">Included Items</div>
                        <div className="flex flex-wrap gap-1.5">
                          {packageInfo.items.map((item) => (
                            <span key={item.id} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 text-[11px] text-blue-800">
                              ✓ {item.item_name}
                              {item.quantity && item.quantity > 1 && <span className="text-blue-500">×{item.quantity}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}

              {/* Section 2: Magic Cards */}
              <div className="grid grid-cols-3 gap-3">
                {/* Total Deposit Card */}
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <div className="text-xs font-medium text-emerald-600 mb-1">
                    {t('heading.depositBalance', { ns: 'reception', defaultValue: 'Deposit balance' })}
                  </div>
                  <div className="font-data text-xl font-bold text-emerald-700">
                    {formatBDT(depositBalance)}
                  </div>
                  {depositTotal > 0 && depositUsed > 0 && (
                    <div className="mt-1 text-[10px] text-emerald-600">
                      {t('info.depositReceived', { ns: 'reception', defaultValue: 'Deposit received' })}: {formatBDT(depositTotal)} |{' '}
                      {t('info.depositUsed', { ns: 'reception', defaultValue: 'Deposit used' })}: {formatBDT(depositUsed)}
                    </div>
                  )}
                </div>

                {/* Total Cost Card */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                  <div className="text-xs font-medium text-gray-500 mb-1">
                    {t('heading.runningCharges', { ns: 'reception', defaultValue: 'Running charges' })}
                  </div>
                  <div className="font-data text-xl font-bold text-gray-700">
                    {formatBDT(totalBilled)}
                  </div>
                </div>

                {/* Net Balance Card */}
                <div className={`rounded-lg border p-3 text-center ${
                  netPayable > 0 
                    ? 'border-red-200 bg-red-50' 
                    : 'border-emerald-200 bg-emerald-50'
                }`}>
                  <div className="text-xs font-medium text-gray-500 mb-1">
                    {netPayable > 0
                      ? t('heading.netPayable', { ns: 'reception', defaultValue: 'Net payable' })
                      : t('heading.refundAvailable', { ns: 'reception', defaultValue: 'Refund available' })}
                  </div>
                  <div className={`font-data text-xl font-bold ${
                    netPayable > 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}>
                    {formatBDT(netPayable > 0 ? netPayable : refundAvailable)}
                  </div>
                  {netPayable > 0 && (
                    <div className="mt-1 text-[10px] text-red-600 animate-pulse">
                      {t('info.urgentCollectDeposit', { defaultValue: 'জরুরি ভিত্তিতে অ্যাডভান্স কালেক্ট করুন' })}
                    </div>
                  )}
                </div>
              </div>

              {/* Section C: Add New Items */}
              <div className="rounded-lg border border-[var(--color-border)] p-4">
                <h4 className="font-semibold mb-3">{t('heading.addNewCharge', { ns: 'reception' })}</h4>
                <div className="mb-3 inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-1">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${chargeMode === 'catalog' ? 'bg-white text-[var(--color-primary)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                    onClick={() => setChargeMode('catalog')}
                  >
                    {t('btn.catalogItem', { ns: 'reception', defaultValue: 'Catalog item' })}
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${chargeMode === 'manual' ? 'bg-white text-[var(--color-primary)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                    onClick={() => setChargeMode('manual')}
                  >
                    {t('btn.manualCharge', { ns: 'reception', defaultValue: 'Manual charge' })}
                  </button>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${chargeMode === 'doctor_round' ? 'bg-white text-[var(--color-primary)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                    onClick={() => setChargeMode('doctor_round')}
                  >
                    <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('btn.doctorRound', { ns: 'reception', defaultValue: 'Doctor round' })}
                  </button>
                </div>
                {chargeMode === 'doctor_round' ? (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                    <div className="mb-2 rounded-md border border-indigo-100 bg-white/70 px-3 py-2 text-xs text-indigo-700">
                      {t('info.doctorRoundFeeFromProfile', {
                        ns: 'reception',
                        defaultValue: 'Select round doctor. Fee auto-loads from profile.',
                      })}
                    </div>
                    <DoctorRoundForm
                      patientId={selectedPatient.patient_id}
                      patientName={selectedPatient.patient_name}
                      admissionId={selectedPatient.admission_id}
                      admissionNo={selectedPatient.admission_number}
                      entrySource="ipd_billing"
                      onCancel={() => setChargeMode('catalog')}
                      onSuccess={() => {
                        toast.success(t('toast.doctorRoundAdded', { ns: 'reception', defaultValue: 'Doctor round charge added' }));
                        void fetchPending(selectedPatient.admission_id);
                        queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
                      }}
                    />
                  </div>
                ) : (
                <div className="grid grid-cols-12 gap-2 items-end">
                  {chargeMode === 'catalog' ? (
                    <>
                      <div className="col-span-3 relative">
                        <label className="label text-xs">{t('table.category', { ns: 'reception' })}</label>
                        <input
                          className="input h-9 text-sm"
                          type="text"
                          value={showDeptDropdown ? deptSearch : selectedDeptName}
                          onChange={e => { setDeptSearch(e.target.value); setShowDeptDropdown(true); }}
                          onFocus={() => { setShowDeptDropdown(true); setDeptSearch(''); }}
                          onBlur={() => { window.setTimeout(() => setShowDeptDropdown(false), 200); }}
                          placeholder={t('select.selectCategory', { ns: 'reception' })}
                        />
                        {showDeptDropdown && (
                          <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white shadow-lg">
                            {filteredDepartments.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No matching category</div>
                            ) : (
                              filteredDepartments.map(d => (
                                <div
                                  key={d.id}
                                  className="cursor-pointer px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)]"
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    setNewDept(String(d.id));
                                    setNewItem('');
                                    setNewPrice('');
                                    setDeptSearch('');
                                    setShowDeptDropdown(false);
                                  }}
                                >
                                  {d.department_name}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                      <div className="col-span-4 relative">
                        <label className="label text-xs">{t('table.item', { ns: 'reception' })}</label>
                        <input
                          className="input h-9 text-sm"
                          type="text"
                          value={showItemDropdown ? itemSearch : selectedItemName}
                          onChange={e => { setItemSearch(e.target.value); setShowItemDropdown(true); }}
                          onFocus={() => { if (newDept) { setShowItemDropdown(true); setItemSearch(''); } }}
                          onBlur={() => { window.setTimeout(() => setShowItemDropdown(false), 200); }}
                          placeholder={newDept ? t('select.searchOrSelectItem', { ns: 'reception' }) : t('select.selectCategory', { ns: 'reception' })}
                          disabled={!newDept}
                        />
                        {showItemDropdown && newDept && (
                          <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white shadow-lg">
                            {filteredServiceItems.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No matching item</div>
                            ) : (
                              filteredServiceItems.map(si => (
                                <div
                                  key={si.id}
                                  className="cursor-pointer px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)]"
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    setNewItem(String(si.id));
                                    setNewPrice(String(si.price ?? si.unit_price ?? 0));
                                    setItemSearch('');
                                    setShowItemDropdown(false);
                                  }}
                                >
                                  {si.item_name} - {formatBDT(si.price ?? si.unit_price ?? 0)}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="col-span-3">
                        <label className="label text-xs">{t('table.category', { ns: 'reception' })}</label>
                        <select
                          className="input h-9 text-sm"
                          value={manualCategory}
                          onChange={e => setManualCategory(e.target.value)}
                        >
                          <option value="service">{t('billing:categories.service', { defaultValue: 'Service' })}</option>
                          <option value="procedure">{t('billing:categories.procedure', { defaultValue: 'Procedure' })}</option>
                          <option value="admission">{t('billing:categories.admission', { defaultValue: 'Admission' })}</option>
                          <option value="medicine">{t('billing:categories.medicine', { defaultValue: 'Medicine' })}</option>
                          <option value="operation">{t('billing:categories.operation', { defaultValue: 'Operation' })}</option>
                          <option value="test">{t('billing:categories.test', { defaultValue: 'Test' })}</option>
                        </select>
                      </div>
                      <div className="col-span-4">
                        <label className="label text-xs">{t('table.item', { ns: 'reception' })}</label>
                        <input
                          className="input h-9 text-sm"
                          type="text"
                          value={manualDescription}
                          onChange={e => setManualDescription(e.target.value)}
                          placeholder={t('form.manualChargeDescription', { ns: 'reception', defaultValue: 'Charge description' })}
                        />
                      </div>
                    </>
                  )}
                  <div className="col-span-1">
                    <label className="label text-xs">{t('table.qty', { ns: 'reception' })}</label>
                    <input className="input h-9 text-sm text-center" type="number" min={1} value={newQty} onChange={e => setNewQty(e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className="label text-xs">{t('form.unitPrice', { ns: 'reception', defaultValue: 'Unit Price' })}</label>
                    {chargeMode === 'catalog' ? (
                      <input className="input h-9 text-sm font-data bg-gray-50" value={newPrice ? formatBDT(Number(newPrice)) : '-'} readOnly />
                    ) : (
                      <input
                        className="input h-9 text-sm font-data"
                        type="number"
                        min={0}
                        step="1"
                        value={manualPrice}
                        onChange={e => setManualPrice(e.target.value)}
                        placeholder="0"
                      />
                    )}
                  </div>
                  {chargeMode === 'manual' && (
                    <div className="col-span-12 rounded-lg border border-dashed border-blue-200 bg-blue-50/60 p-3">
                      <label className="flex items-center gap-2 text-sm font-medium text-blue-900">
                        <input
                          type="checkbox"
                          checked={doctorPayableEnabled}
                          onChange={e => {
                            setDoctorPayableEnabled(e.target.checked);
                            if (e.target.checked && !doctorPayableAmount) setDoctorPayableAmount(manualPrice);
                          }}
                        />
                        {t('form.createDoctorPayable', { ns: 'reception', defaultValue: 'Create doctor payable for this charge' })}
                      </label>
                      {doctorPayableEnabled && (
                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div>
                            <label className="label text-xs">{t('form.payableDoctor', { ns: 'reception', defaultValue: 'Payable doctor' })}</label>
                            <select aria-label={t("form.payableDoctor", { ns: "reception", defaultValue: "Payable doctor" })} className="input h-9 text-sm" value={payableDoctorId} onChange={e => setPayableDoctorId(e.target.value)}>
                              <option value="">{t('select.selectDoctor', { ns: 'reception', defaultValue: 'Select doctor' })}</option>
                              {doctors.map((doctor) => (
                                <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` · ${doctor.specialty}` : ''}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="label text-xs">{t('form.payableAmount', { ns: 'reception', defaultValue: 'Payable amount' })}</label>
                            <input aria-label={t("form.payableAmount", { ns: "reception", defaultValue: "Payable amount" })} className="input h-9 text-sm font-data" type="number" min={0} value={doctorPayableAmount} onChange={e => setDoctorPayableAmount(e.target.value)} placeholder={manualPrice || '0'} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="col-span-2">
                    <button
                      className="btn-primary h-9 w-full text-sm"
                      onClick={handleAddItem}
                      disabled={addingItem || (chargeMode === 'catalog' ? !newItem : !manualChargeReady)}
                    >
                      {addingItem ? t('btn.adding', { ns: 'reception', defaultValue: 'Adding...' }) : t('btn.addCharge', { ns: 'reception' })}
                    </button>
                  </div>
                </div>
                )}
              </div>

              {/* Section 4: Ledger Table */}
              <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                {/* Tab Headers */}
                <div className="flex border-b border-[var(--color-border)]">
                  <button
                    className={`flex-1 px-4 py-2.5 text-sm font-medium ${
                      activeTab === 'running' 
                        ? 'bg-white border-b-2 border-blue-500 text-blue-600' 
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                    }`}
                    onClick={() => setActiveTab('running')}
                  >
                    {t('tab.runningCharges', { defaultValue: 'Running Charges' })}
                  </button>
                  <button
                    className={`flex-1 px-4 py-2.5 text-sm font-medium ${
                      activeTab === 'settled' 
                        ? 'bg-white border-b-2 border-blue-500 text-blue-600' 
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                    }`}
                    onClick={() => setActiveTab('settled')}
                  >
                    {t('tab.settledBills', { defaultValue: 'Settled Bills' })}
                  </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'running' ? (
                  detailLoading ? (
                    <div className="skeleton h-32" />
                  ) : pendingItems.length === 0 && bedCharges.length === 0 && packageTotal <= 0 ? (
                    <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">{t('form.noChargesAdded', { ns: 'reception', defaultValue: 'No charges added yet' })}</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-[var(--color-bg-secondary)]">
                          <tr className="text-xs text-[var(--color-text-muted)]">
                            <th className="px-4 py-2 text-left">{t('table.dateTime', { ns: 'reception' })}</th>
                            <th className="px-4 py-2 text-left">{t('table.category', { ns: 'reception' })}</th>
                            <th className="px-4 py-2 text-left">{t('table.item', { ns: 'reception' })}</th>
                            <th className="px-4 py-2 text-right">{t('table.qty', { ns: 'reception' })}</th>
                            <th className="px-4 py-2 text-right">{t('table.total', { ns: 'reception' })}</th>
                            <th className="px-4 py-2 text-center">{t('table.action', { ns: 'reception' })}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {packageInfo && packageTotal > 0 && (
                            <tr className="border-t border-[var(--color-border)] bg-blue-50/70 hover:bg-blue-50">
                              <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">{selectedPatient.admitted_date ? formatAdmissionDisplay(selectedPatient.admitted_date) : '-'}</td>
                              <td className="px-4 py-2">
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">admission_package</span>
                              </td>
                              <td className="px-4 py-2 font-medium">{packageInfo.package_name}</td>
                              <td className="px-4 py-2 text-right font-data">1</td>
                              <td className="px-4 py-2 text-right font-data font-semibold">{formatBDT(packageTotal)}</td>
                              <td className="px-4 py-2 text-center">
                                <span className="text-[10px] text-[var(--color-text-muted)]">auto</span>
                              </td>
                            </tr>
                          )}
                          {pendingItems.map(item => (
                            <tr key={item.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]">
                              <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">{formatAdmissionDisplay(item.created_at)}</td>
                              <td className="px-4 py-2">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getCategoryBadgeClass(item.item_category)}`}>{item.item_category}</span>
                              </td>
                              <td className="px-4 py-2 font-medium">{item.item_name}</td>
                              <td className="px-4 py-2 text-right font-data">{item.quantity}</td>
                              <td className="px-4 py-2 text-right font-data font-semibold">{formatBDT(item.total_amount)}</td>
                              <td className="px-4 py-2 text-center">
                                {isDoctorRoundItem(item) ? (
                                  <span className="text-[10px] text-[var(--color-text-muted)]">
                                    {t('info.managedViaDoctorRounds', { ns: 'reception', defaultValue: 'Managed via Doctor Rounds' })}
                                  </span>
                                ) : item.bill_status === 'provisional' ? (
                                  <button
                                    className="rounded p-1 text-red-500 hover:bg-red-50"
                                    onClick={() => handleDeleteItem(item)}
                                    title="Remove item"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                          {bedCharges.map(bed => (
                            <tr key={`bed-${bed.id}`} className="border-t border-[var(--color-border)] bg-amber-50/60 hover:bg-amber-50">
                              <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">{bed.started_on ? formatAdmissionDisplay(bed.started_on) : '-'}</td>
                              <td className="px-4 py-2">
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">bed_charge</span>
                              </td>
                              <td className="px-4 py-2 font-medium">
                                <div>{bed.ward_name ?? 'Ward'} - Bed {bed.bed_number ?? bed.id} {bed.bed_type ? `(${bed.bed_type})` : ''}</div>
                                {packageInfo?.package_type === 'package_included_days' && (bed as any).included_days_used !== undefined && (
                                  <div className="text-[10px] text-blue-600 mt-0.5">
                                    {(bed as any).included_days_used > 0 && <span>✓ {(bed as any).included_days_used} days covered by package</span>}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right font-data">{bed.days}</td>
                              <td className="px-4 py-2 text-right font-data font-semibold">{formatBDT(Number(bed.charge_amount ?? 0))}</td>
                              <td className="px-4 py-2 text-center">
                                <button
                                  className="rounded p-1 text-red-500 hover:bg-red-50"
                                  onClick={() => handleDeleteBedCharge(bed)}
                                  title={t('btn.removeAutoCharge', { ns: 'reception', defaultValue: 'Remove auto charge' })}
                                  aria-label={t('btn.removeAutoCharge', { ns: 'reception', defaultValue: 'Remove auto charge' })}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : detailLoading ? (
                  <div className="skeleton h-32" />
                ) : settledBills.length === 0 ? (
                    <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">
                      {t('info.noSettledBills', { ns: 'reception', defaultValue: 'No settled bills yet' })}
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-[var(--color-bg-secondary)]">
                          <tr className="text-xs text-[var(--color-text-muted)]">
                            <th className="px-4 py-2 text-left">{t('table.dateTime', { ns: 'reception' })}</th>
                            <th className="px-4 py-2 text-left">{t('table.invoice', { ns: 'reception', defaultValue: 'Invoice' })}</th>
                            <th className="px-4 py-2 text-right">{t('table.total', { ns: 'reception' })}</th>
                            <th className="px-4 py-2 text-right">{t('table.cashPaid', { ns: 'reception', defaultValue: 'Cash paid' })}</th>
                            <th className="px-4 py-2 text-right">{t('table.depositUsed', { ns: 'reception', defaultValue: 'Deposit used' })}</th>
                            <th className="px-4 py-2 text-right">{t('table.due', { ns: 'reception', defaultValue: 'Due' })}</th>
                            <th className="px-4 py-2 text-center">{t('table.source', { ns: 'reception', defaultValue: 'Source' })}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {settledBills.map((bill) => {
                            const cashPaid = Number(bill.paid ?? 0);
                            const depositDeducted = Number(bill.deposit_deducted ?? 0);
                            return (
                              <tr key={bill.id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]">
                                <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                                  {bill.created_at ? formatAdmissionDisplay(bill.created_at) : '-'}
                                </td>
                                <td className="px-4 py-2 font-data font-medium">{bill.invoice_no ?? `Bill #${bill.id}`}</td>
                                <td className="px-4 py-2 text-right font-data font-semibold">{formatBDT(Number(bill.total ?? 0))}</td>
                                <td className="px-4 py-2 text-right font-data">{formatBDT(cashPaid)}</td>
                                <td className="px-4 py-2 text-right font-data">{formatBDT(depositDeducted)}</td>
                                <td className="px-4 py-2 text-right font-data">{formatBDT(Number(bill.due ?? 0))}</td>
                                <td className="px-4 py-2 text-center">
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                    {depositDeducted > 0 && cashPaid <= 0
                                      ? t('payment.deposit', { ns: 'reception', defaultValue: 'Deposit' })
                                      : t('payment.mixed', { ns: 'reception', defaultValue: 'Mixed' })}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                )}

                {/* Summary row */}
                {(pendingItems.length > 0 || bedCharges.length > 0) && (
                  <div className="flex justify-between items-center px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                    <span className="text-sm font-medium">{t('heading.totalCharges', { ns: 'reception' })}</span>
                    <span className="font-data text-lg font-bold">{formatBDT(totalBilled)}</span>
                  </div>
                )}
              </div>

              {/* Section E: Footer Actions */}
              <div className="flex items-center justify-between pt-2">
                <button
                  className="btn-secondary"
                  onClick={() => selectedPatient && window.open(getIpdRunningBillPrintPath(basePath, selectedPatient.admission_id), '_blank', 'noopener,noreferrer')}
                >
                  <Printer className="h-4 w-4 mr-2" />
                  {t('btn.printRunningBill', { ns: 'reception' })}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-colors shadow-xs cursor-pointer"
                    onClick={openTransferBedModal}
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t('btn.transferBed', { ns: 'reception', defaultValue: 'Transfer Bed' })}
                  </button>
                  <button
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 transition-colors shadow-xs cursor-pointer"
                    onClick={() => setShowDischarge(true)}
                  >
                    <LogOut className="h-4 w-4" />
                    {t('btn.discharge', { ns: 'reception', defaultValue: 'Discharge' })}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => setShowDeposit(true)}
                  >
                    <Banknote className="h-4 w-4 mr-2" />
                    {t('btn.collectDeposit', { ns: 'reception' })}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Bed Transfer Modal */}
        {showTransferBed && selectedPatient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowTransferBed(false)}>
            <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl dark:bg-slate-800" onClick={event => event.stopPropagation()}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h4 className="flex items-center gap-2 font-semibold">
                    <RefreshCw className="h-4 w-4 text-indigo-600" />
                    {t('modal.transferBed', { ns: 'reception', defaultValue: 'Transfer Bed' })}
                  </h4>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{selectedPatient.patient_name} · {selectedPatient.admission_number}</p>
                </div>
                <button type="button" onClick={() => setShowTransferBed(false)} className="btn-ghost p-1" aria-label={t('close', { ns: 'common', defaultValue: 'Close' })}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="label text-xs">{t('form.currentBed', { ns: 'reception', defaultValue: 'Current bed' })}</label>
                    <div className="input h-10 bg-gray-50 text-sm">{selectedPatient.ward_name ?? 'Ward'} / Bed {selectedPatient.bed_number ?? '-'}</div>
                  </div>
                  <div>
                    <label className="label text-xs">{t('form.newBed', { ns: 'reception', defaultValue: 'New bed' })} *</label>
                    <select className="input h-10 text-sm" value={transferBedForm.new_bed_id} onChange={e => setTransferBedForm(form => ({ ...form, new_bed_id: e.target.value }))}>
                      <option value="">{t('select.selectAvailableBed', { ns: 'reception', defaultValue: 'Select available bed' })}</option>
                      {availableBeds.map((bed) => (
                        <option key={bed.id} value={bed.id}>
                          {bed.ward_name} / {bed.bed_number} · {bed.bed_type}{bed.effective_rate != null ? ` · ${formatBDT(Number(bed.effective_rate))}/day` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label text-xs">{t('form.reason', { ns: 'reception', defaultValue: 'Reason' })}</label>
                  <textarea className="input min-h-20 text-sm" rows={3} value={transferBedForm.reason} onChange={e => setTransferBedForm(form => ({ ...form, reason: e.target.value }))} placeholder={t('form.transferReasonPlaceholder', { ns: 'reception', defaultValue: 'Example: shifted to cabin / ICU / ward change...' })} />
                </div>
                <label className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={transferBedForm.pending_receive} onChange={e => setTransferBedForm(form => ({ ...form, pending_receive: e.target.checked }))} />
                  <span>
                    <span className="font-medium">{t('form.requireReceivingConfirmation', { ns: 'reception', defaultValue: 'Require receiving ward confirmation' })}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">{t('info.transferImmediateBilling', { ns: 'reception', defaultValue: 'Unchecked means transfer completes now and the new bed charge starts immediately.' })}</span>
                  </span>
                </label>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {t('info.transferBillingSplit', { ns: 'reception', defaultValue: 'Billing note: current bed charge will close and a new bed charge segment will start when the transfer is completed.' })}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setShowTransferBed(false)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
                  <button type="button" onClick={handleTransferBed} disabled={transferSaving || !transferBedForm.new_bed_id} className="btn-primary">
                    {transferSaving ? t('btn.saving', { ns: 'reception', defaultValue: 'Saving...' }) : t('btn.confirmTransfer', { ns: 'reception', defaultValue: 'Confirm Transfer' })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Deposit Modal */}
        {showDeposit && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4" role="dialog" aria-modal="true" aria-labelledby={depositTitleId}>
              <div className="flex items-center justify-between">
                <h4 id={depositTitleId} className="font-semibold">{t('modal.collectDeposit', { ns: 'reception' })}</h4>
                <button type="button" onClick={() => setShowDeposit(false)} className="btn-ghost p-1" aria-label={t('close', { ns: 'common', defaultValue: 'Close' })}>
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div>
                <label className="label text-xs">{t('form.amount', { ns: 'reception', defaultValue: 'Amount' })}</label>
                <input className="input h-10 text-lg font-data" type="number" min={0} value={depositAmt} onChange={e => setDepositAmt(e.target.value)} placeholder="0" autoFocus />
              </div>
              <div>
                <label className="label text-xs">{t('form.paymentMethod', { ns: 'reception' })}</label>
                <select className="input h-9" value={depositMethod} onChange={e => setDepositMethod(e.target.value)}>
                  <option value="cash">{t('select.cash', { ns: 'reception' })}</option>
                  <option value="bkash">{t('select.bkash', { ns: 'reception' })}</option>
                  <option value="nagad">{t('select.nagad', { ns: 'reception' })}</option>
                  <option value="card">{t('select.card', { ns: 'reception' })}</option>
                  <option value="bank">{t('select.bankTransfer', { ns: 'reception' })}</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">{t('form.remarks', { ns: 'reception', defaultValue: 'Remarks' })}</label>
                <input className="input h-9" value={depositRemarks} onChange={e => setDepositRemarks(e.target.value)} placeholder={t('form.optionalNote', { ns: 'reception', defaultValue: 'Optional note...' })} />
              </div>
              <button
                className="btn-primary w-full"
                onClick={handleAddDeposit}
                disabled={depositSaving}
              >
                {depositSaving ? t('btn.saving', { ns: 'reception', defaultValue: 'Saving...' }) : `${t('btn.collect', { ns: 'reception', defaultValue: 'Collect' })} ${depositAmt ? formatBDT(Number(depositAmt)) : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* Discharge Modal */}
        {showDischarge && selectedPatient && (
          <DischargeModal
            admission={{
              admissionId: selectedPatient.admission_id,
              admissionNo: selectedPatient.admission_number,
              patientName: selectedPatient.patient_name,
              patientId: selectedPatient.patient_id,
              wardName: selectedPatient.ward_name,
              bedNumber: selectedPatient.bed_number,
            }}
            financial={buildDischargeFinancial({
              pendingSummary: summary,
              billingStatus: {
                pending: { total: totalBilled },
                deposit_balance: depositBalance,
                net_payable: netPayable,
              },
              financialClearance,
            })}
            billPrintBasePath={basePath}
            onClose={() => setShowDischarge(false)}
            onSuccess={() => {
              setShowDischarge(false);
              setSelectedPatient(null);
              setPendingItems([]);
              setBedCharges([]);
              setSettledBills([]);
              setSummary(null);
              setFinancialClearance(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

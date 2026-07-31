import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Users, Plus, X, Search, Check, DollarSign, Clock, FileText, Stethoscope, Settings, Percent, ClipboardList, Printer, Trash2, HelpCircle, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import SettlementSlipModal from '../components/accounting/SettlementSlipModal';
import HelpPanel from '../components/HelpPanel';
import { HelpPageKey } from '../data/helpContent';
import {
  applyDoctorCommissionRulePreset,
  buildDoctorCommissionRulePayload,
  doctorCommissionRuleToForm,
  getInitialDoctorCommissionRuleForm,
  getMaximumDoctorWaiverValue,
  setDoctorCommissionRuleRateType,
  type DoctorCommissionRuleFormState,
} from '../lib/commissionRuleForm';

interface Commission {
  id: number; marketing_person: string; mobile?: string; patient_id?: number; bill_id?: number;
  commission_amount: number; paid_status: string; paid_date?: string; notes?: string;
  created_at: string; patient_name?: string; patient_code?: string;
}

interface Doctor {
  id: number;
  name: string;
  specialization?: string;
  specialty?: string;
}

interface LabTest {
  id: number;
  name: string;
  code?: string;
  category?: string;
}

interface DoctorRule {
  id: number;
  doctor_id: number;
  doctor_name?: string;
  service_type: 'lab_test' | 'consultation_fee' | 'referral' | 'procedure' | 'ipd_round';
  lab_test_id?: number | null;
  lab_test_name?: string | null;
  category?: string | null;
  rate_type: 'percent' | 'flat';
  rate_value: number;
  waiver_policy?: 'full_earned' | 'protected_floor' | 'no_doctor_waiver' | null;
  protected_rate_bps?: number | null;
  protected_flat_amount?: number | null;
  incentive_type: 'performer' | 'prescriber' | 'referrer';
  effective_from?: string | null;
  effective_to?: string | null;
  is_active: number;
  notes?: string | null;
}

interface DoctorAccrual {
  id: number;
  doctor_id: number;
  doctor_name?: string;
  patient_name?: string;
  patient_code?: string;
  bill_id?: number | null;
  visit_id?: number | null;
  lab_order_id?: number | null;
  lab_order_item_id?: number | null;
  lab_test_name?: string;
  lab_test_code?: string;
  invoice_no?: string;
  source_type: string;
  incentive_type?: string;
  gross_amount: number;
  commission_amount: number;
  commission_rate_bps?: number | null;
  commission_flat_amount?: number | null;
  status: string;
  accrued_date?: string;
  bill_is_paid?: number | null;
}

interface DoctorPayableLedger {
  doctor_id: number;
  doctor_name?: string;
  doctor_specialization?: string | null;
  payable_gross_amount: number;
  payable_amount: number;
  paid_amount: number;
  cancelled_amount: number;
  outstanding_count: number;
  paid_count: number;
  cancelled_count: number;
  settlement_count: number;
  settled_amount: number;
  last_accrued_date?: string | null;
  last_settlement_date?: string | null;
}

interface DoctorPayablesResponse {
  payables: DoctorPayableLedger[];
  summary: {
    payableAmount: number;
    paidAmount: number;
    cancelledAmount: number;
    settledAmount: number;
    doctorCount: number;
    outstandingCount: number;
  };
}

type AccrualViewMode = 'invoice' | 'doctor' | 'item';

interface DoctorAccrualGroup {
  id: string;
  doctor_id: number;
  doctor_name?: string;
  patient_name?: string;
  patient_code?: string;
  invoice_no?: string | null;
  source_type: string;
  status: string;
  item_count: number;
  gross_amount: number;
  commission_amount: number;
  accrual_ids: number[];
  items: DoctorAccrual[];
  latest_accrued_date?: string;
}

function money(value: number | undefined | null, currencySymbol = '৳') {
  return `${currencySymbol}${Math.round(value ?? 0).toLocaleString()}`;
}

interface Settlement {
  id: number;
  doctor_id: number;
  doctor_name: string;
  settlement_date: string;
  total_amount: number;
  payment_mode: string;
  reference_no?: string;
  notes?: string;
  voucher_id?: number;
}

function displayRuleRate(rule: DoctorRule, t: any) {
  if (rule.rate_type === 'percent') {
    const val = (rule.rate_value / 100).toFixed(2);
    return `${parseFloat(val)}%`;
  }
  return money(rule.rate_value, t('common:currencySymbol', '৳'));
}

function displayRuleWaiverPolicy(rule: DoctorRule, t: any) {
  if (rule.waiver_policy === 'no_doctor_waiver') {
    return t('accounting:commission.noDoctorWaiver', 'No doctor waiver');
  }
  if (rule.waiver_policy === 'protected_floor') {
    const protectedValue = rule.rate_type === 'percent'
      ? `${Number(rule.protected_rate_bps ?? 0) / 100}%`
      : money(rule.protected_flat_amount ?? 0, t('common:currencySymbol', '৳'));
    return t('accounting:commission.protectedFloorValue', {
      value: protectedValue,
      defaultValue: `Protected ${protectedValue}`,
    });
  }
  return t('accounting:commission.fullEarnedWaiver', 'Full earned waiver');
}

function displayServiceType(rule: DoctorRule, t: ReturnType<typeof useTranslation>['t']) {
  if (rule.service_type === 'lab_test') return t('accounting.commission.labTest', 'Lab Test');
  if (rule.service_type === 'referral') return t('accounting.referral', 'Referral');
  if (rule.service_type === 'procedure') return t('accounting:commission.procedure', 'Procedure');
  if (rule.service_type === 'ipd_round') return t('accounting:commission.ipdRound', 'IPD Round');
  return t('accounting.commission.consultationFee', 'Consultation');
}

export default function CommissionManagement({ role = 'hospital_admin' }: { role?: string }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [accrualStatus, setAccrualStatus] = useState('accrued');
  const [accrualView, setAccrualView] = useState<AccrualViewMode>('invoice');
  const [accrualSearch, setAccrualSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ marketingPerson: '', mobile: '', patientId: '', billId: '', commissionAmount: '', notes: '' });
  const [ruleForm, setRuleForm] = useState<DoctorCommissionRuleFormState>(getInitialDoctorCommissionRuleForm);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const ruleFormRef = useRef<HTMLFormElement>(null);

  const commissionRulePreset = `${ruleForm.serviceType}:${ruleForm.incentiveType}`;
  const maximumDoctorWaiverValue = getMaximumDoctorWaiverValue(ruleForm);
  const protectedDoctorCommissionValue = Math.max(0, (Number(ruleForm.rateValue) || 0) - maximumDoctorWaiverValue);
  const applyCommissionRulePreset = (preset: string) => {
    setRuleForm(prev => applyDoctorCommissionRulePreset(prev, preset));
  };
  const [selectedAccruals, setSelectedAccruals] = useState<number[]>([]);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [settlementForm, setSettlementForm] = useState({
    doctorId: '',
    paymentMode: 'cash',
    referenceNo: '',
    notes: '',
    settlementDate: new Date().toISOString().split('T')[0],
  });
  const [selectedSettlementId, setSelectedSettlementId] = useState<number | null>(null);
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ show: boolean; title: string; onConfirm: () => void } | null>(null);
  const [activeTab, setActiveTab] = useState<'accruals' | 'rules' | 'settlements'>('accruals');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPage, setHelpPage] = useState<HelpPageKey>('commissions');
  const { t } = useTranslation(['common', 'accounting']);
  const queryClient = useQueryClient();

  const resetRuleEditor = () => {
    setEditingRuleId(null);
    setRuleForm(getInitialDoctorCommissionRuleForm());
  };

  const handleOpenHelp = (pageKey: HelpPageKey = 'commissions') => {
    setHelpPage(pageKey);
    setHelpOpen(true);
  };

  const currencySymbol = t('common:currencySymbol', '৳');

  const getIncentiveLabel = (type: string | undefined) => {
    if (!type) return '—';
    return t(`accounting:commission.${type}`, type.charAt(0).toUpperCase() + type.slice(1));
  };

  const getStatusLabel = (status: string | undefined) => {
    if (!status) return '—';
    return t(`accounting:commission.${status}`, status.charAt(0).toUpperCase() + status.slice(1));
  };

  const getSourceLabel = (source: string | undefined) => {
    if (!source) return '—';
    if (source === 'consultation_fee') return t('accounting:commission.consultationFee', 'Consultation Fee');
    if (source === 'lab_test') return t('accounting:commission.labTest', 'Lab Test');
    if (source === 'referral') return t('accounting:commission.referral', 'Referral');
    if (source === 'mixed') return t('accounting:commission.mixedSources', 'Mixed sources');
    return t(`accounting:commission.${source}`, source.replace(/_/g, ' '));
  };

  const formatAccrualRate = (row: DoctorAccrual) => {
    const bps = Number(row.commission_rate_bps ?? 0);
    if (bps > 0) return `${Number((bps / 100).toFixed(2)).toLocaleString()}%`;
    const flat = Number(row.commission_flat_amount ?? 0);
    if (flat > 0) return money(flat, currencySymbol);
    const gross = Number(row.gross_amount ?? 0);
    const commission = Number(row.commission_amount ?? 0);
    if (gross > 0 && commission > 0) return `${Number(((commission / gross) * 100).toFixed(2)).toLocaleString()}%`;
    return '—';
  };

  // ESC-to-close modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowCreate(false); setForm({ marketingPerson: '', mobile: '', patientId: '', billId: '', commissionAmount: '', notes: '' }); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setSelectedAccruals([]);
  }, [accrualStatus, accrualView]);

  const queryParams = new URLSearchParams();
  if (statusFilter) queryParams.set('status', statusFilter);
  if (search) queryParams.set('person', search);
  const qs = queryParams.toString();
  const filters = { status: statusFilter, person: search };

  const { data: rawData, isLoading: loading } = useApiQuery<any>(
    queryKeys.commissions.list(filters),
    `/api/commissions${qs ? `?${qs}` : ''}`,
  );
  const commissions: Commission[] = rawData?.commissions ?? [];
  const { data: doctorsData } = useApiQuery<{ doctors: Doctor[] }>(
    queryKeys.doctors.list(),
    '/api/doctors',
  );
  const doctors = doctorsData?.doctors ?? [];
  const { data: labTestsData } = useApiQuery<{ tests: LabTest[] }>(
    queryKeys.laboratory.tests(),
    '/api/lab',
  );
  const labTests = labTestsData?.tests ?? [];
  const { data: ruleData, isLoading: rulesLoading } = useApiQuery<{ rules: DoctorRule[] }>(
    queryKeys.commissions.doctorRules({}),
    '/api/commissions/doctor-rules',
  );
  const doctorRules = ruleData?.rules ?? [];
  const { data: accrualData, isLoading: accrualsLoading } = useApiQuery<{ accruals: DoctorAccrual[] }>(
    queryKeys.commissions.doctorAccruals({ status: accrualStatus }),
    `/api/commissions/doctor-accruals${accrualStatus ? `?status=${accrualStatus}` : ''}`,
  );
  const accruals = accrualData?.accruals ?? [];
  const { data: payablesData, isLoading: payablesLoading } = useApiQuery<DoctorPayablesResponse>(
    queryKeys.commissions.doctorPayables({}),
    '/api/commissions/doctor-payables',
  );
  const doctorPayables = payablesData?.payables ?? [];
  const payableSummary = payablesData?.summary;

  const { data: settlementsData, isLoading: settlementsLoading } = useApiQuery<{ settlements: Settlement[] }>(
    queryKeys.commissions.settlements({}),
    '/api/commissions/settlements',
  );
  const settlements = settlementsData?.settlements ?? [];

  const totalUnpaid = commissions.filter(c => c.paid_status === 'unpaid').reduce((s, c) => s + c.commission_amount, 0);
  const totalPaid = commissions.filter(c => c.paid_status === 'paid').reduce((s, c) => s + c.commission_amount, 0);
  const doctorCommissionDue = payableSummary?.payableAmount ?? accruals.filter(a => a.status !== 'paid').reduce((s, a) => s + (a.commission_amount ?? 0), 0);

  const createMutation = useApiMutation<any, any>('post', '/api/commissions', {
    onSuccess: () => {
      toast.success(t('accounting:commission.commissionRecorded', 'Commission recorded'));
      setShowCreate(false);
      setForm({ marketingPerson: '', mobile: '', patientId: '', billId: '', commissionAmount: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: queryKeys.commissions.all });
    },
    onError: (err) => { toast.error(err.message || t('accounting:commission.failedToSave', 'Failed to save')); },
  });

  const markPaidMutation = useApiMutation<any, { id: number }>('post', (vars) => `/api/commissions/${vars.id}/pay`, {
    onSuccess: () => {
      toast.success(t('accounting:commission.markedAsPaid', 'Marked as paid'));
      queryClient.invalidateQueries({ queryKey: queryKeys.commissions.all });
    },
    onError: () => { toast.error(t('accounting:commission.failedToMarkPaid', 'Failed to mark paid')); },
  });

  const createRuleMutation = useApiMutation<any, any>('post', '/api/commissions/doctor-rules', {
    onSuccess: () => {
      toast.success(t('accounting:commission.ruleSaved', 'Doctor commission rule saved'));
      resetRuleEditor();
      queryClient.invalidateQueries({ queryKey: queryKeys.commissions.all });
    },
    onError: (err) => { toast.error(err.message || t('accounting:commission.failedToSaveRule', 'Failed to save doctor rule')); },
  });

  const updateRuleMutation = useApiMutation<any, { id: number; [key: string]: unknown }>(
    'put',
    (vars) => `/api/commissions/doctor-rules/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('accounting:commission.ruleUpdated', 'Doctor commission rule updated'));
        resetRuleEditor();
        queryClient.invalidateQueries({ queryKey: queryKeys.commissions.all });
      },
      onError: (err) => { toast.error(err.message || t('accounting:commission.failedToUpdateRule', 'Failed to update doctor rule')); },
    },
  );

  const approveAccrualsMutation = useApiMutation<any, { accrualIds: number[] }>('post', '/api/commissions/doctor-accruals/approve', {
    onSuccess: () => {
      toast.success(t('accounting:commission.doctorCommissionApproved', 'Doctor commission approved'));
      setSelectedAccruals([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.commissions.all });
    },
    onError: (err) => { toast.error(err.message || t('accounting:commission.failedToApproveDoctorCommission', 'Failed to approve doctor commission')); },
  });

  const markAccrualPaidMutation = useApiMutation<any, { id: number }>('post', (vars) => `/api/commissions/doctor-accruals/${vars.id}/pay`, {
    onSuccess: () => {
      toast.success(t('accounting:commission.doctorCommissionPaid', 'Doctor commission marked as paid'));
      queryClient.invalidateQueries({ queryKey: queryKeys.commissions.all });
    },
    onError: () => { toast.error(t('accounting:commission.failedToMarkDoctorPaid', 'Failed to mark doctor commission paid')); },
  });

  const settleMutation = useApiMutation<any, any>('post', '/api/commissions/settle', {
    onSuccess: () => {
      toast.success(t('accounting:commission.settlementCompleted', 'Settlement completed successfully'));
      setShowSettlementModal(false);
      setSelectedAccruals([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.commissions.all });
    },
    onError: (err) => { toast.error(err.message || t('accounting:commission.failedToSettle', 'Failed to complete settlement')); },
  });

  const deleteRuleMutation = useApiMutation<any, number>('delete', (id) => `/api/commissions/doctor-rules/${id}`, {
    onSuccess: () => {
      toast.success(t('accounting:commission.ruleDeleted', 'Rule deleted successfully'));
      queryClient.invalidateQueries({ queryKey: queryKeys.commissions.all });
    },
    onError: () => toast.error(t('accounting:commission.failedToDeleteRule', 'Failed to delete rule')),
  });

  const deleteRule = (id: number) => {
    setConfirmModal({
      show: true,
      title: t('accounting:commission.confirmDeleteRule', 'Are you sure you want to delete this rule?'),
      onConfirm: () => {
        if (editingRuleId === id) resetRuleEditor();
        deleteRuleMutation.mutate(id);
        setConfirmModal(null);
      }
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      marketingPerson: form.marketingPerson, mobile: form.mobile || undefined,
      patientId: form.patientId ? parseInt(form.patientId) : undefined,
      billId: form.billId ? parseInt(form.billId) : undefined,
      commissionAmount: Number(form.commissionAmount) || 0, notes: form.notes || undefined,
    });
  };

  const markPaid = async (id: number) => {
    setConfirmModal({
      show: true,
      title: t('accounting:commission.confirmMarkPaid', 'Mark this commission as paid?'),
      onConfirm: () => {
        markPaidMutation.mutate({ id });
        setConfirmModal(null);
      }
    });
  };

  const startEditingRule = (rule: DoctorRule) => {
    setEditingRuleId(rule.id);
    setRuleForm(doctorCommissionRuleToForm(rule));
    window.requestAnimationFrame(() => {
      ruleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    const rawRate = Number(ruleForm.rateValue) || 0;
    const protectedValue = ruleForm.rateType === 'percent'
      ? Number(ruleForm.protectedRate) || 0
      : Number(ruleForm.protectedFlatAmount) || 0;
    if (ruleForm.waiverPolicy === 'protected_floor' && protectedValue > rawRate) {
      toast.error(t('accounting:commission.protectedFloorTooHigh', 'Protected commission cannot exceed the commission rate.'));
      return;
    }

    const isEditing = editingRuleId != null;
    const payload = buildDoctorCommissionRulePayload(ruleForm, { forUpdate: isEditing });

    if (isEditing) {
      updateRuleMutation.mutate({ id: editingRuleId, ...payload });
      return;
    }

    createRuleMutation.mutate(payload);
  };

  const approveAccrualIds = (accrualIds: number[]) => {
    if (accrualIds.length === 0) return;
    setConfirmModal({
      show: true,
      title: t('accounting:commission.confirmApproveDoctorCommission', 'Approve selected doctor commission for payout?'),
      onConfirm: () => {
        approveAccrualsMutation.mutate({ accrualIds });
        setConfirmModal(null);
      }
    });
  };

  const markAccrualPaid = (id: number) => {
    setConfirmModal({
      show: true,
      title: t('accounting:commission.confirmMarkPaid', 'Mark this doctor commission as paid?'),
      onConfirm: () => {
        markAccrualPaidMutation.mutate({ id });
        setConfirmModal(null);
      }
    });
  };

  const toggleAccrualSelection = (id: number) => {
    setSelectedAccruals(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSettle = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAccruals.length === 0) return;

    // Get the doctor ID from the first selected accrual (they should all be for the same doctor)
    const firstAccrual = accruals.find(a => a.id === selectedAccruals[0]);
    if (!firstAccrual) return;

    settleMutation.mutate({
      doctorId: firstAccrual.doctor_id,
      accrualIds: selectedAccruals,
      paymentMode: settlementForm.paymentMode,
      referenceNo: settlementForm.referenceNo || undefined,
      notes: settlementForm.notes || undefined,
      settlementDate: settlementForm.settlementDate || undefined,
    });
  };

  const openSettlementModal = (ids: number[] = selectedAccruals) => {
    if (ids.length === 0) {
      toast.error(t('accounting:commission.selectAtLeastOne', 'Please select at least one accrual'));
      return;
    }

    const selectedRows = accruals.filter(a => ids.includes(a.id));
    const doctorIds = new Set(selectedRows.map(r => r.doctor_id));

    if (doctorIds.size > 1) {
      toast.error(t('accounting:commission.differentDoctorsSelected', 'Please select accruals for only one doctor at a time'));
      return;
    }

    if (selectedRows.some(row => row.status !== 'approved')) {
      toast.error(t('accounting:commission.approveBeforePayment', 'Approve doctor commissions before settling them'));
      return;
    }

    setSelectedAccruals(ids);
    setSettlementForm(prev => ({
      ...prev,
      doctorId: String(selectedRows[0].doctor_id),
    }));
    setShowSettlementModal(true);
  };

  const displayed = commissions.filter(c =>
    (!search || c.marketing_person.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || c.paid_status === statusFilter)
  );

  const canApproveAccrual = (row: DoctorAccrual) => row.status === 'accrued' && Number(row.bill_is_paid ?? 0) === 1;
  const canSettleAccrual = (row: DoctorAccrual) => row.status === 'approved';
  const canSelectAccrual = canSettleAccrual;
  const hasUnpaidBill = (row: DoctorAccrual) => row.bill_id != null && Number(row.bill_is_paid ?? 0) !== 1;
  const accrualSearchTerm = accrualSearch.trim().toLowerCase();
  const filteredAccruals = accruals.filter(row => {
    if (!accrualSearchTerm) return true;
    return [row.doctor_name, row.patient_name, row.patient_code, row.invoice_no, row.lab_test_name, row.lab_test_code, row.source_type, row.incentive_type]
      .some(value => String(value ?? '').toLowerCase().includes(accrualSearchTerm));
  });

  const getAccrualGroupKey = (row: DoctorAccrual) => {
    const statusKey = row.status || 'unknown';
    if (accrualView === 'doctor') return ['doctor', row.doctor_id, statusKey].join(':');
    const invoiceKey = row.bill_id ? `bill:${row.bill_id}` : row.invoice_no ? `invoice:${row.invoice_no}` : row.lab_order_id ? `lab:${row.lab_order_id}` : row.visit_id ? `visit:${row.visit_id}` : `accrual:${row.id}`;
    return ['doctor', row.doctor_id, invoiceKey, row.source_type || 'unknown', statusKey].join(':');
  };

  const accrualGroups = Array.from(filteredAccruals.reduce((map, row) => {
    const id = getAccrualGroupKey(row);
    const existing = map.get(id);
    const group: DoctorAccrualGroup = existing ?? {
      id,
      doctor_id: row.doctor_id,
      doctor_name: row.doctor_name,
      patient_name: accrualView === 'doctor' ? undefined : row.patient_name,
      patient_code: accrualView === 'doctor' ? undefined : row.patient_code,
      invoice_no: accrualView === 'doctor' ? null : row.invoice_no,
      source_type: accrualView === 'doctor' ? 'mixed' : row.source_type,
      status: row.status,
      item_count: 0,
      gross_amount: 0,
      commission_amount: 0,
      accrual_ids: [],
      items: [],
      latest_accrued_date: row.accrued_date,
    };
    group.item_count += 1;
    group.gross_amount += Number(row.gross_amount ?? 0);
    group.commission_amount += Number(row.commission_amount ?? 0);
    group.accrual_ids.push(row.id);
    group.items.push(row);
    if (!group.latest_accrued_date || (row.accrued_date && row.accrued_date > group.latest_accrued_date)) group.latest_accrued_date = row.accrued_date;
    if (accrualView === 'doctor') {
      const sourceTypes = new Set(group.items.map(item => item.source_type));
      group.source_type = sourceTypes.size > 1 ? 'mixed' : row.source_type;
    }
    map.set(id, group);
    return map;
  }, new Map<string, DoctorAccrualGroup>()).values()).sort((a, b) => b.commission_amount - a.commission_amount);

  const visibleSelectableAccrualIds = filteredAccruals.filter(canSelectAccrual).map(row => row.id);
  const allVisibleAccrualsSelected = visibleSelectableAccrualIds.length > 0 && visibleSelectableAccrualIds.every(id => selectedAccruals.includes(id));

  const toggleAccrualIds = (ids: number[]) => {
    const selectableIds = ids.filter(id => filteredAccruals.some(row => row.id === id && canSelectAccrual(row)));
    if (selectableIds.length === 0) return;
    setSelectedAccruals(prev => {
      const allSelected = selectableIds.every(id => prev.includes(id));
      return allSelected ? prev.filter(id => !selectableIds.includes(id)) : Array.from(new Set([...prev, ...selectableIds]));
    });
  };

  const getGroupSourceSummary = (group: DoctorAccrualGroup) => {
    if (group.source_type !== 'mixed') return getSourceLabel(group.source_type);
    return Array.from(new Set(group.items.map(item => item.source_type))).map(getSourceLabel).join(', ');
  };

  const renderItemAccrualTable = () => (
    <div className="overflow-x-auto"><table className="table-base"><thead><tr><th><input type="checkbox" checked={allVisibleAccrualsSelected} onChange={() => toggleAccrualIds(visibleSelectableAccrualIds)} disabled={visibleSelectableAccrualIds.length === 0} /></th><th>{t('accounting:commission.doctorName', 'Doctor')}</th><th>{t('accounting:commission.patientName', 'Patient')}</th><th>{t('accounting:commission.source', 'Source')}</th><th>{t('accounting:commission.invoice', 'Invoice')}</th><th className="text-right">{t('accounting:commission.gross', 'Gross')}</th><th className="text-right">{t('accounting:commission.rate', 'Rate')}</th><th className="text-right">{t('accounting:commission.commission', 'Commission')}</th><th>{t('common:status', 'Status')}</th><th>{t('common:actions', 'Actions')}</th></tr></thead><tbody>
      {accrualsLoading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(10)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : filteredAccruals.length === 0 ? <tr><td colSpan={10} className="py-12 text-center text-[var(--color-text-muted)]">{t('accounting:commission.noAccruals', 'No doctor commission accruals')}</td></tr>
        : filteredAccruals.map(row => (
          <tr key={row.id} className={selectedAccruals.includes(row.id) ? 'bg-[var(--color-primary-light)]/10' : ''}>
            <td><input type="checkbox" checked={selectedAccruals.includes(row.id)} onChange={() => toggleAccrualSelection(row.id)} disabled={!canSelectAccrual(row)} /></td>
            <td className="font-medium">{row.doctor_name ?? `${t('accounting:commission.doctor', 'Doctor')} #${row.doctor_id}`}</td>
            <td>{row.patient_name ? <><span>{row.patient_name}</span><span className="text-xs text-[var(--color-text-muted)] ml-1">{row.patient_code}</span></> : '—'}</td>
            <td><div className="font-medium">{row.lab_test_name ?? getSourceLabel(row.source_type)}</div>{row.incentive_type && <div className="text-[10px] uppercase font-bold text-[var(--color-primary)]">{getIncentiveLabel(row.incentive_type)}</div>}</td>
            <td className="font-data text-sm">{row.invoice_no ?? '—'}</td>
            <td className="font-data text-right">{money(row.gross_amount, currencySymbol)}</td>
            <td className="font-data text-right text-xs text-[var(--color-text-muted)]">{formatAccrualRate(row)}</td>
            <td className="font-data text-right font-semibold">{money(row.commission_amount, currencySymbol)}</td>
            <td className="space-x-1"><span className={`badge ${row.status === 'paid' ? 'badge-success' : row.status === 'cancelled' ? 'badge-danger' : 'badge-warning'}`}>{getStatusLabel(row.status)}</span>{hasUnpaidBill(row) && <span className="badge badge-danger" title={t('accounting:commission.invoiceDueTooltip', 'Linked bill is not fully paid; approve and pay actions are blocked until bill settles.')}>{t('accounting:commission.invoiceDue', 'Invoice due')}</span>}</td>
            <td>{canApproveAccrual(row) ? <button onClick={() => approveAccrualIds([row.id])} className="btn-ghost p-1.5 text-blue-600" title={t('accounting:commission.approve', 'Approve')}><Check className="w-4 h-4" /></button> : canSettleAccrual(row) ? <button onClick={() => markAccrualPaid(row.id)} className="btn-ghost p-1.5 text-emerald-600" title={t('accounting:commission.markPaid', 'Mark Paid')}><DollarSign className="w-4 h-4" /></button> : hasUnpaidBill(row) ? <span className="text-xs text-[var(--color-text-muted)]" title={t('accounting:commission.invoiceDueTooltip', 'Linked bill is not fully paid; approve and pay actions are blocked until bill settles.')}>—</span> : null}</td>
          </tr>
        ))}
    </tbody></table></div>
  );

  const renderGroupedAccrualTable = () => (
    <div className="overflow-x-auto"><table className="table-base"><thead><tr><th><input type="checkbox" checked={allVisibleAccrualsSelected} onChange={() => toggleAccrualIds(visibleSelectableAccrualIds)} disabled={visibleSelectableAccrualIds.length === 0} /></th><th>{t('accounting:commission.group', 'Group')}</th><th>{t('accounting:commission.doctorName', 'Doctor')}</th><th>{t('accounting:commission.patientName', 'Patient')}</th><th>{t('accounting:commission.source', 'Source')}</th><th className="text-center">{t('accounting:commission.items', 'Items')}</th><th className="text-right">{t('accounting:commission.gross', 'Gross')}</th><th className="text-right">{t('accounting:commission.commission', 'Commission')}</th><th>{t('common:status', 'Status')}</th><th>{t('common:actions', 'Actions')}</th></tr></thead><tbody>
      {accrualsLoading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(10)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : accrualGroups.length === 0 ? <tr><td colSpan={10} className="py-12 text-center text-[var(--color-text-muted)]">{t('accounting:commission.noAccruals', 'No doctor commission accruals')}</td></tr>
        : accrualGroups.map(group => {
          const approvableIds = group.items.filter(canApproveAccrual).map(item => item.id);
          const settleIds = group.items.filter(canSettleAccrual).map(item => item.id);
          const allGroupSelected = settleIds.length > 0 && settleIds.every(id => selectedAccruals.includes(id));
          const unpaidItems = group.items.filter(hasUnpaidBill);
          return <tr key={group.id} className={allGroupSelected ? 'bg-[var(--color-primary-light)]/10' : ''}><td><input type="checkbox" checked={allGroupSelected} onChange={() => toggleAccrualIds(settleIds)} disabled={settleIds.length === 0} /></td><td><div className="font-medium font-data">{accrualView === 'doctor' ? t('accounting:commission.doctorSummary', 'Doctor summary') : (group.invoice_no ?? '—')}</div><div className="text-xs text-[var(--color-text-muted)]">{group.latest_accrued_date ?? '—'}</div></td><td className="font-medium">{group.doctor_name ?? `${t('accounting:commission.doctor', 'Doctor')} #${group.doctor_id}`}</td><td>{group.patient_name ?? '—'}</td><td>{getGroupSourceSummary(group)}</td><td className="font-data text-center">{group.item_count}</td><td className="font-data text-right">{money(group.gross_amount, currencySymbol)}</td><td className="font-data text-right font-semibold">{money(group.commission_amount, currencySymbol)}</td><td className="space-x-1"><span className={`badge ${group.status === 'paid' ? 'badge-success' : group.status === 'cancelled' ? 'badge-danger' : 'badge-warning'}`}>{getStatusLabel(group.status)}</span>{unpaidItems.length > 0 && <span className="badge badge-danger" title={t('accounting:commission.invoiceDueTooltip', 'Linked bill is not fully paid; approve and pay actions are blocked until bill settles.')}>{t('accounting:commission.invoiceDue', 'Invoice due')}</span>}</td><td className="space-x-1">{approvableIds.length > 0 && <button onClick={() => approveAccrualIds(approvableIds)} className="btn-ghost p-1.5 text-blue-600" title={t('accounting:commission.approve', 'Approve')}><Check className="w-4 h-4" /></button>}{settleIds.length > 0 && <button onClick={() => openSettlementModal(settleIds)} className="btn-ghost p-1.5 text-emerald-600" title={t('accounting:commission.settleSelected', 'Settle Selected')}><DollarSign className="w-4 h-4" /></button>}</td></tr>;
        })}
    </tbody></table></div>
  );

  const renderAccrualTable = () => accrualView === 'item' ? renderItemAccrualTable() : renderGroupedAccrualTable();

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="page-title">{t('accounting:commission.title', 'Commission Management')}</h1>
              <button
                type="button"
                onClick={() => handleOpenHelp()}
                className="btn-ghost p-1.5 text-[var(--color-primary)] rounded-full hover:bg-[var(--color-primary-light)]"
                title={t('common:help', 'Help')}
              >
                <HelpCircle className="w-5 h-5" />
              </button>
            </div>
            <p className="section-subtitle mt-1">{t('accounting:commission.subtitle', 'Track marketing commissions and payments')}</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('accounting:commission.recordCommission', 'Record Commission')}</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard title={t('accounting:commission.totalCommissions', 'Total Commissions')} value={commissions.length} loading={loading} icon={<Users className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('accounting:commission.unpaidAmount', 'Unpaid Amount')} value={`${currencySymbol}${totalUnpaid.toLocaleString()}`} loading={loading} icon={<Clock className="w-5 h-5"/>} iconBg="bg-red-50 text-red-600" />
          <KPICard title={t('accounting:commission.paidAmount', 'Paid Amount')} value={`${currencySymbol}${totalPaid.toLocaleString()}`} loading={loading} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title={t('accounting:commission.totalValue', 'Total Value')} value={`${currencySymbol}${(totalPaid + totalUnpaid).toLocaleString()}`} loading={loading} icon={<FileText className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title={t('accounting:commission.doctorDue', 'Doctor Due')} value={money(doctorCommissionDue, currencySymbol)} loading={accrualsLoading} icon={<Stethoscope className="w-5 h-5"/>} iconBg="bg-cyan-50 text-cyan-600" />
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t('accounting:searchMarketingPerson', 'Search marketing person...')} value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" /></div>
          <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
            {[['', t('accounting:commission.all', 'All')], ['unpaid', t('accounting:commission.unpaid', 'Unpaid')], ['paid', t('accounting:commission.paid', 'Paid')]].map(([val, label]) => (
              <button key={val} onClick={() => setStatusFilter(val)} className={`px-3 py-2 font-medium transition-colors ${statusFilter === val ? 'bg-[var(--color-primary)] text-white' : 'bg-white hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{label}</button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>#</th><th>{t('accounting:commission.person', 'Person')}</th><th>{t('accounting:commission.mobile', 'Mobile')}</th><th>{t('accounting:commission.patient', 'Patient')}</th><th className="text-right">{t('accounting:commission.amount', 'Amount')} (৳)</th><th>{t('accounting:commission.status', 'Status')}</th><th>{t('accounting:commission.date', 'Date')}</th><th>{t('accounting:commission.actions', 'Actions')}</th></tr></thead><tbody>
          {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
          : displayed.length === 0 ? <tr><td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]">{t('accounting:commission.noCommissions', 'No commissions')}</td></tr>
          : displayed.map((com, idx) => (
              <tr key={com.id}>
                <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                <td className="font-medium">{com.marketing_person}</td>
                <td className="text-[var(--color-text-secondary)] font-data">{com.mobile || '—'}</td>
                <td>{com.patient_name ? <><span className="font-medium">{com.patient_name}</span><span className="text-xs text-[var(--color-text-muted)] ml-1">{com.patient_code}</span></> : '—'}</td>
                <td className="text-right font-data font-medium">{currencySymbol}{com.commission_amount.toLocaleString()}</td>
                <td><span className={`badge ${com.paid_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{com.paid_status === 'paid' ? t('accounting:commission.paid', 'Paid') : t('accounting:commission.unpaid', 'Unpaid')}</span></td>
                <td className="font-data text-sm text-[var(--color-text-muted)]">{com.paid_date || com.created_at?.split('T')[0]}</td>
                <td>{com.paid_status !== 'paid' && <button onClick={() => markPaid(com.id)} className="btn-ghost p-1.5 text-emerald-600" title={t('accounting:commission.markPaid', 'Mark Paid')}><Check className="w-4 h-4" /></button>}</td>
              </tr>
            ))}
        </tbody></table></div></div>

        <div className="flex border-b border-[var(--color-border)] mb-4">
          {[
            { id: 'accruals', label: t('accounting:commission.accruals', 'Accruals'), icon: <ClipboardList className="w-4 h-4" /> },
            { id: 'rules', label: t('accounting:commission.rules', 'Rules'), icon: <Settings className="w-4 h-4" /> },
            { id: 'settlements', label: t('accounting:commission.settlements', 'Settlements'), icon: <Check className="w-4 h-4" /> },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-3 font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light)]/10' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-alt)]'}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'accruals' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex flex-wrap gap-3 items-center justify-between">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-cyan-600" />
                <h2 className="section-title">{t('accounting:commission.doctorPayableLedger', 'Doctor Payable Ledger')}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="badge badge-info">{money(payableSummary?.payableAmount, currencySymbol)} {t('accounting:commission.outstanding', 'outstanding')}</span>
                <span className="badge badge-success">{money(payableSummary?.paidAmount, currencySymbol)} {t('accounting:commission.paid', 'paid')}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('accounting:commission.doctorName', 'Doctor')}</th>
                    <th className="text-right">{t('accounting:commission.gross', 'Gross')}</th>
                    <th className="text-right">{t('accounting:commission.outstanding', 'Outstanding')}</th>
                    <th className="text-right">{t('accounting:commission.paid', 'Paid')}</th>
                    <th className="text-right">{t('accounting:commission.cancelled', 'Cancelled')}</th>
                    <th className="text-center">{t('accounting:commission.pendingItems', 'Pending Items')}</th>
                    <th>{t('accounting:commission.lastAccrued', 'Last Accrued')}</th>
                    <th>{t('accounting:commission.lastSettlement', 'Last Settlement')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payablesLoading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    : doctorPayables.length === 0 ? <tr><td colSpan={8} className="py-10 text-center text-[var(--color-text-muted)]">{t('accounting:commission.noDoctorPayables', 'No doctor payable ledger rows')}</td></tr>
                    : doctorPayables.map(row => (
                      <tr key={row.doctor_id}>
                        <td>
                          <div className="font-medium">{row.doctor_name ?? `${t('accounting:commission.doctor', 'Doctor')} #${row.doctor_id}`}</div>
                          {row.doctor_specialization && <div className="text-xs text-[var(--color-text-muted)]">{row.doctor_specialization}</div>}
                        </td>
                        <td className="font-data text-right">{money(row.payable_gross_amount, currencySymbol)}</td>
                        <td className="font-data text-right font-semibold text-amber-700">{money(row.payable_amount, currencySymbol)}</td>
                        <td className="font-data text-right text-emerald-700">{money(row.paid_amount, currencySymbol)}</td>
                        <td className="font-data text-right text-rose-700">{money(row.cancelled_amount, currencySymbol)}</td>
                        <td className="font-data text-center">{row.outstanding_count}</td>
                        <td className="font-data text-sm">{row.last_accrued_date ?? '—'}</td>
                        <td className="font-data text-sm">{row.last_settlement_date ?? '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] space-y-3">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-[var(--color-primary)]" />
                  <div>
                    <h2 className="section-title">{t('accounting:commission.doctorCommissionAccruals', 'Doctor Commission Accruals')}</h2>
                    <p className="text-xs text-[var(--color-text-muted)]">{t('accounting:commission.groupedAccrualHint', 'Invoice view groups multiple item rows into one payable row. Expand for audit details.')}</p>
                  </div>
                </div>
                {selectedAccruals.length > 0 && (
                  <button onClick={() => openSettlementModal()} className="btn-primary py-1.5 px-4 text-sm">
                    <DollarSign className="w-4 h-4 mr-1.5" />
                    {t('accounting.commission.settleSelected', 'Settle Selected')} ({selectedAccruals.length})
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <input className="input pl-9" value={accrualSearch} onChange={e => setAccrualSearch(e.target.value)} placeholder={t('accounting:commission.searchAccruals', 'Search invoice, patient, doctor or test...')} />
                </div>
                <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
                  {(['invoice', 'doctor', 'item'] as AccrualViewMode[]).map(view => (
                    <button key={view} onClick={() => setAccrualView(view)} className={`px-3 py-2 font-medium transition-colors ${accrualView === view ? 'bg-[var(--color-primary)] text-white' : 'bg-white hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
                      {view === 'invoice' ? t('accounting:commission.invoiceView', 'Invoice View') : view === 'doctor' ? t('accounting:commission.doctorView', 'Doctor View') : t('accounting:commission.auditView', 'Item / Audit View')}
                    </button>
                  ))}
                </div>
                <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
                  {[['', t('accounting:commission.all', 'All')], ['accrued', t('accounting:commission.accrued', 'Accrued')], ['approved', t('accounting:commission.approved', 'Approved')], ['paid', t('accounting:commission.paid', 'Paid')]].map(([val, label]) => (
                    <button key={val} onClick={() => setAccrualStatus(val)} className={`px-3 py-2 font-medium transition-colors ${accrualStatus === val ? 'bg-[var(--color-primary)] text-white' : 'bg-white hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
            {renderAccrualTable()}
          </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <form ref={ruleFormRef} onSubmit={handleSaveRule} className="card p-4 space-y-4 scroll-mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-[var(--color-primary)]" />
                <h2 className="section-title">
                  {editingRuleId != null
                    ? t('accounting:commission.editDoctorCommissionRule', 'Edit Doctor Commission Rule')
                    : t('accounting:commission.doctorCommissionRules', 'Doctor Commission Rules')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => handleOpenHelp('commission_rules')}
                className="btn-ghost p-1.5 text-[var(--color-primary)] rounded-full hover:bg-[var(--color-primary-light)]"
                title={t('common:help', 'Help')}
              >
                <HelpCircle className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="label">{t('accounting:commission.doctor', 'Doctor')}</label>
              <select className="input" required value={ruleForm.doctorId} onChange={e => setRuleForm({ ...ruleForm, doctorId: e.target.value })}>
                <option value="">{t('accounting:commission.selectDoctor', 'Select doctor')}</option>
                {doctors.map(d => <option key={d.id} value={d.id}>{d.name} {d.specialization || d.specialty ? `(${d.specialization ?? d.specialty})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('accounting:commission.ruleType', 'Rule Type')}</label>
              <select className="input" value={commissionRulePreset} onChange={e => applyCommissionRulePreset(e.target.value)}>
                <option value="lab_test:prescriber">{t('accounting:commission.diagnosticPrescriber', 'Diagnostic/Test commission for ordering/referring doctor')}</option>
                <option value="lab_test:performer">{t('accounting:commission.diagnosticPerformer', 'Diagnostic/Test commission for result verifying doctor')}</option>
                <option value="consultation_fee:performer">{t('accounting:commission.consultationPerformer', 'Consultation fee commission for visiting doctor')}</option>
                <option value="procedure:performer">{t('accounting:commission.procedurePerformer', 'Procedure commission for performing doctor')}</option>
                <option value="ipd_round:performer">{t('accounting:commission.ipdRoundPerformer', 'IPD round commission for visiting doctor')}</option>
                <option value="referral:referrer">{t('accounting:commission.externalReferral', 'External referral commission')}</option>
              </select>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {t('accounting:commission.ruleTypeHint', 'Choose the role that should earn this commission. Prescriber = ordering/referring doctor on test order; Performer = doctor/pathologist who verifies the result; Referrer = external referral.')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('accounting:commission.rateType', 'Rate Type')}</label>
                <select className="input" value={ruleForm.rateType} onChange={e => setRuleForm(prev => setDoctorCommissionRuleRateType(prev, e.target.value as DoctorCommissionRuleFormState['rateType']))}>
                  <option value="percent">{t('accounting:commission.percent', 'Percent')}</option>
                  <option value="flat">{t('accounting:commission.flat', 'Flat')}</option>
                </select>
              </div>
              <div>
                <label className="label">{ruleForm.rateType === 'percent' ? t('accounting:commission.percent', 'Percent') : t('accounting:commission.flat', 'Flat Amount') + ` (${currencySymbol})`}</label>
                <input className="input" type="number" min="0" step={ruleForm.rateType === 'percent' ? '0.01' : '1'} required value={ruleForm.rateValue} onChange={e => setRuleForm({ ...ruleForm, rateValue: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">{t('accounting:commission.doctorWaiverPolicy', 'Doctor Waiver Policy')}</label>
              <select
                className="input"
                value={ruleForm.waiverPolicy}
                onChange={e => setRuleForm({
                  ...ruleForm,
                  waiverPolicy: e.target.value as DoctorCommissionRuleFormState['waiverPolicy'],
                })}
              >
                <option value="full_earned">{t('accounting:commission.fullEarnedWaiver', 'Full earned commission can be waived')}</option>
                <option value="protected_floor">{t('accounting:commission.protectedFloor', 'Protect a minimum doctor commission')}</option>
                <option value="no_doctor_waiver">{t('accounting:commission.noDoctorWaiver', 'Doctor commission cannot fund discount')}</option>
              </select>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {t('accounting:commission.waiverPolicyHint', 'Any patient discount above the doctor waiver capacity is funded by the hospital.')}
              </p>
            </div>
            {ruleForm.waiverPolicy === 'protected_floor' && (
              <div>
                <label className="label">
                  {ruleForm.rateType === 'percent'
                    ? t('accounting:commission.protectedRate', 'Protected Commission (%)')
                    : `${t('accounting:commission.protectedAmount', 'Protected Commission Amount')} (${currencySymbol})`}
                </label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={ruleForm.rateValue || undefined}
                  step={ruleForm.rateType === 'percent' ? '0.01' : '1'}
                  required
                  value={ruleForm.rateType === 'percent' ? ruleForm.protectedRate : ruleForm.protectedFlatAmount}
                  onChange={e => setRuleForm({
                    ...ruleForm,
                    protectedRate: ruleForm.rateType === 'percent' ? e.target.value : '',
                    protectedFlatAmount: ruleForm.rateType === 'flat' ? e.target.value : '',
                  })}
                />
              </div>
            )}
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm space-y-1">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">{t('accounting:commission.maximumDoctorWaiver', 'Maximum doctor-funded waiver')}</span>
                <strong className="font-data">
                  {ruleForm.rateType === 'percent' ? `${maximumDoctorWaiverValue}%` : money(maximumDoctorWaiverValue, currencySymbol)}
                </strong>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">{t('accounting:commission.guaranteedPayable', 'Protected doctor payable')}</span>
                <strong className="font-data text-emerald-700">
                  {ruleForm.rateType === 'percent' ? `${protectedDoctorCommissionValue}%` : money(protectedDoctorCommissionValue, currencySymbol)}
                </strong>
              </div>
            </div>
            {ruleForm.serviceType === 'lab_test' && (
              <div>
                <label className="label">{t('accounting:commission.specificLabTest', 'Specific Lab Test')}</label>
                <select className="input" value={ruleForm.labTestId} onChange={e => {
                  const test = labTests.find(tst => String(tst.id) === e.target.value);
                  setRuleForm({ ...ruleForm, labTestId: e.target.value, category: test?.category ?? ruleForm.category });
                }}>
                  <option value="">{t('accounting:commission.allTestsOrCategory', 'All tests or category rule')}</option>
                  {labTests.map(test => <option key={test.id} value={test.id}>{test.name} {test.code ? `(${test.code})` : ''}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">{t('common:category', 'Category')}</label>
              <input className="input" value={ruleForm.category} onChange={e => setRuleForm({ ...ruleForm, category: e.target.value })} placeholder={t('accounting:commission.categoryPlaceholder', 'e.g. hematology')} />
            </div>
            <div>
              <label className="label">{t('accounting:commission.effectiveFrom', 'Effective From')}</label>
              <input className="input" type="date" value={ruleForm.effectiveFrom} onChange={e => setRuleForm({ ...ruleForm, effectiveFrom: e.target.value })} />
            </div>
            <div>
              <label className="label">{t('accounting.notes', 'Notes')}</label>
              <textarea className="input" rows={2} value={ruleForm.notes} onChange={e => setRuleForm({ ...ruleForm, notes: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createRuleMutation.isPending || updateRuleMutation.isPending}
                className="btn-primary flex-1"
              >
                <Percent className="w-4 h-4" />
                {editingRuleId != null
                  ? (updateRuleMutation.isPending
                    ? t('accounting:commission.updating', 'Updating…')
                    : t('accounting:commission.updateRule', 'Update Rule'))
                  : (createRuleMutation.isPending
                    ? t('accounting.saving', 'Saving…')
                    : t('accounting.commission.saveRule', 'Save Rule'))}
              </button>
              {editingRuleId != null && (
                <button type="button" onClick={resetRuleEditor} className="btn-secondary">
                  {t('accounting:commission.cancelEdit', 'Cancel Edit')}
                </button>
              )}
            </div>
          </form>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <h2 className="section-title">{t('accounting.commission.activeRules', 'Active Rules')}</h2>
              <span className="badge badge-info">{t('accounting:commission.rulesCount', { count: doctorRules.length, defaultValue: '{{count}} rules' })}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('accounting.commission.doctor', 'Doctor')}</th>
                    <th>{t('accounting.commission.serviceType', 'Service')}</th>
                    <th>{t('accounting.category', 'Category')}</th>
                    <th>{t('accounting.commission.role', 'Role')}</th>
                    <th>{t('accounting.commission.rate', 'Rate')}</th>
                    <th>{t('accounting:commission.waiverPolicy', 'Waiver Policy')}</th>
                    <th>{t('accounting.commission.effectiveFrom', 'Effective From')}</th>
                    <th>{t('accounting.status', 'Status')}</th>
                    <th className="text-right">{t('common:actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                {rulesLoading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                : doctorRules.length === 0 ? <tr><td colSpan={9} className="py-12 text-center text-[var(--color-text-muted)]">{t('accounting.commission.noRules', 'No doctor commission rules')}</td></tr>
                : doctorRules.map(rule => (
                  <tr key={rule.id}>
                    <td className="font-medium">{rule.doctor_name ?? `${t('accounting.commission.doctor', 'Doctor')} #${rule.doctor_id}`}</td>
                    <td>{displayServiceType(rule, t)}</td>
                    <td>{rule.lab_test_name ?? rule.category ?? t('accounting:commission.allServices', 'All services')}</td>
                    <td><span className="badge badge-outline text-[10px] uppercase font-bold">{getIncentiveLabel(rule.incentive_type)}</span></td>
                    <td className="font-data font-semibold">{displayRuleRate(rule, t)}</td>
                    <td className="text-xs">{displayRuleWaiverPolicy(rule, t)}</td>
                    <td className="font-data text-sm">{rule.effective_from ?? '—'}</td>
                    <td><span className={`badge ${rule.is_active ? 'badge-success' : 'badge-warning'}`}>{rule.is_active ? t('accounting.active', 'Active') : t('accounting.inactive', 'Inactive')}</span></td>
                    <td className="text-right whitespace-nowrap">
                      <button
                        onClick={() => startEditingRule(rule)}
                        className="btn-ghost p-1.5 text-[var(--color-primary)]"
                        title={t('common:edit', 'Edit')}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="btn-ghost p-1.5 text-rose-600"
                        title={t('common:delete', 'Delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        )}

        {activeTab === 'settlements' && (
          <div className="card overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-emerald-600" />
                <h2 className="section-title">{t('accounting.commission.pastSettlements', 'Past Settlements')}</h2>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('accounting.date', 'Date')}</th>
                    <th>{t('accounting.commission.doctor', 'Doctor')}</th>
                    <th className="text-right">{t('accounting.amount', 'Amount')}</th>
                    <th>{t('accounting.paymentMode', 'Mode')}</th>
                    <th>{t('accounting.reference', 'Reference')}</th>
                    <th>{t('accounting.notes', 'Notes')}</th>
                    <th className="text-right">{t('common.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {settlementsLoading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    : settlements.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-[var(--color-text-muted)]">{t('accounting.noSettlements', 'No settlements found')}</td></tr>
                    : settlements.map(s => (
                      <tr key={s.id}>
                        <td className="font-data">{s.settlement_date}</td>
                        <td className="font-medium">{s.doctor_name}</td>
                        <td className="font-data text-right font-semibold">{money(s.total_amount, currencySymbol)}</td>
                        <td><span className="badge badge-outline">{t(`accounting.paymentMode.${s.payment_mode}`, s.payment_mode)}</span></td>
                        <td className="font-data text-sm">{s.reference_no || '—'}</td>
                        <td className="text-sm text-[var(--color-text-muted)] truncate max-w-xs">{s.notes || '—'}</td>
                        <td className="text-right">
                          <button
                            onClick={() => {
                              setSelectedSettlementId(s.id);
                              setShowSlipModal(true);
                            }}
                            className="btn-ghost p-1.5 text-[var(--color-primary)]"
                            title={t('common:viewSlip', 'View Slip')}
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('accounting:commission.recordCommission', 'Record Commission')}</h3>
                <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                <div>
                  <label className="label">{t('accounting:commission.marketingPerson', 'Marketing Person')}</label>
                  <input className="input" required value={form.marketingPerson} onChange={e => setForm({ ...form, marketingPerson: e.target.value })} />
                </div>
                <div>
                  <label className="label">{t('common:mobile', 'Mobile')}</label>
                  <input className="input" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('common:patientId', 'Patient ID')}</label>
                    <input className="input" type="number" value={form.patientId} onChange={e => setForm({ ...form, patientId: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">{t('common:billId', 'Bill ID')}</label>
                    <input className="input" type="number" value={form.billId} onChange={e => setForm({ ...form, billId: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="label">{t('common:amount', 'Amount')}</label>
                  <input className="input" type="number" required min="1" value={form.commissionAmount} onChange={e => setForm({ ...form, commissionAmount: e.target.value })} />
                </div>
                <div>
                  <label className="label">{t('common:notes', 'Notes')}</label>
                  <textarea className="input" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('common:cancel', 'Cancel')}</button>
                  <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                    {createMutation.isPending ? t('common:saving', 'Saving…') : t('accounting:commission.record', 'Record')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showSettlementModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('accounting:commission.completeSettlement', 'Complete Settlement')}</h3>
                <button onClick={() => setShowSettlementModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSettle} className="p-5 space-y-4">
                <div className="bg-[var(--color-primary-light)]/10 p-4 rounded-xl border border-[var(--color-primary-light)]">
                  <p className="text-sm text-[var(--color-text-muted)] mb-1">{t('accounting:commission.settlingFor', 'Settling for')}</p>
                  <p className="font-semibold text-lg">{accruals.find(a => String(a.doctor_id) === settlementForm.doctorId)?.doctor_name}</p>
                  <div className="flex justify-between items-end mt-2">
                    <span className="text-sm font-medium">{selectedAccruals.length} {t('common:items', 'items')}</span>
                    <span className="text-xl font-bold text-[var(--color-primary)]">
                      {money(accruals.filter(a => selectedAccruals.includes(a.id)).reduce((sum, a) => sum + a.commission_amount, 0), currencySymbol)}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="label">{t('accounting:paymentModeLabel', 'Payment Mode')}</label>
                  <select className="input" required value={settlementForm.paymentMode} onChange={e => setSettlementForm({ ...settlementForm, paymentMode: e.target.value })}>
                    <option value="cash">{t('accounting:paymentMode.cash', 'Cash')}</option>
                    <option value="bank">{t('accounting:paymentMode.bank', 'Bank Transfer')}</option>
                    <option value="mobile_banking">{t('accounting:paymentMode.mobile', 'Mobile Banking')}</option>
                    <option value="cheque">{t('accounting:paymentMode.cheque', 'Cheque')}</option>
                  </select>
                </div>

                <div>
                  <label className="label">{t('accounting:referenceNo', 'Reference No')}</label>
                  <input className="input" value={settlementForm.referenceNo} onChange={e => setSettlementForm({ ...settlementForm, referenceNo: e.target.value })} placeholder={t('accounting:referencePlaceholder', 'Trx ID / Cheque No')} />
                </div>

                <div>
                  <label className="label">{t('accounting:settlementDate', 'Settlement Date')}</label>
                  <input className="input" type="date" value={settlementForm.settlementDate} onChange={e => setSettlementForm({ ...settlementForm, settlementDate: e.target.value })} />
                </div>

                <div>
                  <label className="label">{t('common:notes', 'Notes')}</label>
                  <textarea className="input" rows={2} value={settlementForm.notes} onChange={e => setSettlementForm({ ...settlementForm, notes: e.target.value })} />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowSettlementModal(false)} className="btn-secondary">{t('common:cancel', 'Cancel')}</button>
                  <button type="submit" disabled={settleMutation.isPending} className="btn-primary">
                    <Check className="w-4 h-4 mr-1.5" />
                    {settleMutation.isPending ? t('accounting:processing', 'Processing…') : t('accounting:commission.confirmSettlement', 'Confirm Settlement')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {showSlipModal && selectedSettlementId && (
          <SettlementSlipModal
            settlementId={selectedSettlementId}
            onClose={() => {
              setShowSlipModal(false);
              setSelectedSettlementId(null);
            }}
          />
        )}
        {confirmModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200">
              <h3 className="text-lg font-bold mb-2">{confirmModal.title}</h3>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setConfirmModal(null)} className="btn-ghost px-4">{t('common:cancel', 'Cancel')}</button>
                <button onClick={confirmModal.onConfirm} className="btn-primary bg-red-600 border-red-600 px-4">{t('common:confirm', 'Confirm')}</button>
              </div>
            </div>
          </div>
        )}



        <HelpPanel
          pageKey={helpPage}
          isOpen={helpOpen}
          onClose={() => setHelpOpen(false)}
        />
      </div>
    </DashboardLayout>
  );
}

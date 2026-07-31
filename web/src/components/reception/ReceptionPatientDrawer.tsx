import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  FileText,
  ListChecks,
  Plus,
  Receipt,
  Search,
  ShieldAlert,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { getBillCashPaidAmount, getBillDepositAdjustedAmount, getBillOutstandingAmount, getBillSettledAmount, getBillTotalAmount } from '../../lib/billAmounts';
import { getIpdRunningBillPrintPath } from '../../lib/handover';
import { redirectToReceptionBillPrint } from '../../lib/receptionBilling';
import { shouldRotateInvoiceAttemptKey } from '../../lib/invoiceIdempotency';
import { getTodayGMT6 } from '../../lib/date-utils';
import { normalizeExternalTransactionId, requiresPaymentReference } from '../../lib/paymentReference';
import { isRetryableApiTransportError } from '../../lib/apiClient';
import DischargeModal from './DischargeModal';
import DiscountAllocationEditor, {
  createDefaultDiscountAllocations,
  getDiscountAllocationPayload,
  hasBalancedDiscountAllocations,
  resolveDoctorWaiverPreviewStatus,
  type DiscountAllocationReason,
  type DiscountAllocationRow,
} from './DiscountAllocationEditor';
import { buildDischargeFinancial, type IpdFinancialClearanceApi } from '../../lib/ipdDischargeFinancial';


type DoctorWaiverPreviewResponse = {
  doctorId: number;
  eligibleCommissionAmount: number;
  performerReserveAmount: number;
  protectedCommissionAmount: number;
  maximumDoctorWaiverAmount: number;
  doctorWaiverAmount: number;
  payableCommissionAmount: number;
  hospitalFundedAmount: number;
};

type DoctorWaiverPreviewRequest = {
  doctorId: number;
  totalDiscount: number;
  items: Array<{
    itemCategory: string;
    description?: string | null;
    lineTotal: number;
    grossLineTotal: number;
    quantity: number;
    referenceId?: number | null;
  }>;
};

type DrawerSchemePreview = {
  eligible: boolean;
  scheme_id: number | null;
  scheme_name: string | null;
  scheme_code?: string | null;
  discount_value: number;
  suggested_discount: number;
  allocation_type: string;
  requires_reference: boolean;
  matched_member_id?: number | null;
  matched_member_code?: string | null;
  matched_member_name?: string | null;
  service_category?: string | null;
  blockers: string[];
};

function previewItemCategory(item: { item_category?: string | null; department_name?: string | null; item_name?: string | null }): string {
  if (item.item_category) return item.item_category;
  const text = `${item.department_name ?? ''} ${item.item_name ?? ''}`.toLowerCase();
  return /lab|pathology|diagnostic|radiology|imaging|x-?ray|usg|ultra|ecg|cbc/.test(text) ? 'test' : 'other';
}

function reasonForDiscountSource(source?: string | null): DiscountAllocationReason {
  switch (source) {
    case 'charity_discount': return 'poor_patient_charity';
    case 'management_discount': return 'management_approved';
    case 'staff_benefit_discount':
    case 'vip_benefit_discount':
    case 'owner_benefit_discount':
    case 'shareholder_benefit_discount':
    case 'corporate_contract_discount':
    case 'campaign_discount':
    case 'rounding_adjustment':
    case 'doctor_commission_waiver':
    case 'reference_discount':
      return source;
    default:
      return 'normal_hospital_discount';
  }
}

type TimelineEntry = {
  type: string;
  description: string;
  category: string;
  amount: number;
  created_at: string;
  created_by?: string | null;
  payment_method?: string | null;
  receipt_no?: string | null;
};

type DrawerVisit = {
  id: number;
  doctor_id?: number | null;
  visit_no?: string | null;
  visit_type?: string | null;
  visit_date?: string | null;
  status?: string | null;
  doctor_name?: string | null;
};

export function resolveTodayVisitReferringDoctorId(visits: DrawerVisit[], today: string): number | '' {
  const visit = visits.find((candidate) => {
    const visitDate = String(candidate.visit_date ?? '').slice(0, 10);
    const status = String(candidate.status ?? '').trim().toLowerCase();
    const doctorId = Number(candidate.doctor_id ?? 0);
    return visitDate === today
      && !['cancelled', 'canceled'].includes(status)
      && Number.isInteger(doctorId)
      && doctorId > 0;
  });
  return visit?.doctor_id ? Number(visit.doctor_id) : '';
}

type PatientContext = {
  patient: {
    id: number;
    patient_code?: string | null;
    name: string;
    mobile?: string | null;
    age?: number | null;
    gender?: string | null;
    address?: string | null;
  };
  visits: DrawerVisit[];
  bills: Array<{ id: number; invoice_no?: string | null; total_amount?: number; paid_amount?: number; cash_paid_amount?: number | null; paid?: number; due?: number; outstanding?: number | null; settled_amount?: number | null; deposit_adjusted?: number | null; status?: string | null; created_at?: string | null }>;
  dueBills?: Array<{ id: number; invoice_no?: string | null; total_amount?: number; paid_amount?: number; cash_paid_amount?: number | null; paid?: number; due?: number; outstanding?: number | null; settled_amount?: number | null; deposit_adjusted?: number | null; status?: string | null; created_at?: string | null }>;
  activeAdmission?: { id: number; admission_no?: string | null; status?: string | null; ward_name?: string | null; bed_number?: string | null; doctor_name?: string | null } | null;
  pastAdmissions?: Array<{
    id: number;
    admission_no?: string | null;
    admission_date?: string | null;
    discharge_date?: string | null;
    ward_name?: string | null;
    bed_number?: string | null;
    doctor_name?: string | null;
    status?: string | null;
  }>;
  deposits?: { balance?: number; raw_balance?: number; total_deposits?: number; total_refunds?: number; total_adjustments?: number };
  payments?: Array<{ id: number; receipt_no?: string | null; amount?: number; payment_method?: string | null; payment_type?: string | null; date?: string | null; created_at?: string | null; invoice_no?: string | null }>;
  depositLedger?: Array<{ id: number; deposit_receipt_no?: string | null; amount?: number; transaction_type?: string | null; payment_method?: string | null; remarks?: string | null; created_at?: string | null }>;
  ipdPending?: { admissionId?: number; provisionalTotal?: number; bedTotal?: number; total?: number; due?: number } | null;
  ipdBillingSummary?: {
    admission_id?: number;
    patient_id?: number;
    provisional_total?: number;
    bed_total?: number;
    running_total?: number;
    grand_total?: number;
    settled_total?: number;
    settled_cash_paid?: number;
    settled_deposit_used?: number;
    deposit_total?: number;
    deposit_used?: number;
    deposit_refunded?: number;
    deposit_balance?: number;
    net_payable?: number;
    refund_available?: number;
    current_balance?: number;
  } | null;
  reports: Array<{ id: number; order_no?: string | null; status?: string | null; item_count?: number; ready_count?: number }>;
  visitBills?: Array<{
    visit_id: number;
    bills: Array<{
      id: number;
      invoice_no?: string | null;
      total_amount: number;
      paid_amount: number;
      cash_paid_amount?: number | null;
      due: number;
      outstanding?: number | null;
      settled_amount?: number | null;
      deposit_adjusted?: number | null;
      status?: string | null;
      bill_type: string;
    }>;
  }>;
  billingTimeline?: TimelineEntry[];
  refundRequests?: Array<{
    id: number;
    billId: number;
    invoiceNo: string | null;
    status: string;
    executionStatus: string;
    createdAt: string | null;
    refundKind: string;
    requestedRefundAmount: number;
    cashRefundAmount: number;
    receivableReduction: number;
    itemCount: number;
    items: Array<{ invoiceItemId: number; returnQuantity: number; allocatedRefundAmount: number; description: string | null }>;
  }>;
  totalPaid?: number;
};

type DrawerBill = PatientContext['bills'][number];

type RefundMode = 'full' | 'partial' | 'amount';

type RefundModeCardProps = {
  mode: RefundMode;
  selected: boolean;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tone: 'amber' | 'blue' | 'violet';
  onSelect: () => void;
};

const refundModeToneClasses = {
  amber: {
    selected: 'border-amber-400 bg-amber-50 ring-2 ring-amber-200 dark:border-amber-600 dark:bg-amber-950/40 dark:ring-amber-900/70',
    idle: 'border-amber-100 bg-white hover:border-amber-300 hover:bg-amber-50/70 dark:border-amber-900/70 dark:bg-slate-900 dark:hover:bg-amber-950/20',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200',
    title: 'text-amber-950 dark:text-amber-100',
    check: 'text-amber-700 dark:text-amber-300',
  },
  blue: {
    selected: 'border-blue-400 bg-blue-50 ring-2 ring-blue-200 dark:border-blue-600 dark:bg-blue-950/40 dark:ring-blue-900/70',
    idle: 'border-blue-100 bg-white hover:border-blue-300 hover:bg-blue-50/70 dark:border-blue-900/70 dark:bg-slate-900 dark:hover:bg-blue-950/20',
    icon: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200',
    title: 'text-blue-950 dark:text-blue-100',
    check: 'text-blue-700 dark:text-blue-300',
  },
  violet: {
    selected: 'border-violet-400 bg-violet-50 ring-2 ring-violet-200 dark:border-violet-600 dark:bg-violet-950/40 dark:ring-violet-900/70',
    idle: 'border-violet-100 bg-white hover:border-violet-300 hover:bg-violet-50/70 dark:border-violet-900/70 dark:bg-slate-900 dark:hover:bg-violet-950/20',
    icon: 'bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200',
    title: 'text-violet-950 dark:text-violet-100',
    check: 'text-violet-700 dark:text-violet-300',
  },
} as const;

function RefundModeCard({ mode, selected, title, description, icon: Icon, tone, onSelect }: RefundModeCardProps) {
  const classes = refundModeToneClasses[tone];
  return (
    <button
      type="button"
      data-refund-mode={mode}
      aria-pressed={selected}
      className={`relative min-h-[118px] rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${selected ? classes.selected : classes.idle}`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${classes.icon}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-bold leading-5 ${classes.title}`}>{title}</span>
          <span className="mt-1 block text-xs leading-5 text-[var(--color-text-muted)]">{description}</span>
        </span>
        <CheckCircle2 className={`h-5 w-5 shrink-0 transition-opacity ${classes.check} ${selected ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
      </div>
    </button>
  );
}

type CashMetricCardProps = {
  metric: 'expected' | 'held' | 'available';
  label: string;
  amount: string;
  icon: ComponentType<{ className?: string }>;
  tone: 'blue' | 'amber' | 'emerald';
};

const cashMetricToneClasses = {
  blue: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100',
} as const;

const cashMetricIconClasses = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200',
} as const;

function CashMetricCard({ metric, label, amount, icon: Icon, tone }: CashMetricCardProps) {
  return (
    <div data-cash-metric={metric} className={`rounded-xl border p-3 ${cashMetricToneClasses[tone]}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cashMetricIconClasses[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-medium opacity-75">{label}</div>
          <div className="mt-0.5 truncate font-data text-xl font-bold leading-none">{amount}</div>
        </div>
      </div>
    </div>
  );
}

type RefundableBillItem = {
  id: number;
  description: string;
  item_category: string;
  quantity: number;
  returned_qty: number;
  pending_qty: number;
  available_qty: number;
  refundable_unit_amount: number;
  clinical_status: string | null;
  eligible: boolean;
  block_reason: string | null;
};

type RefundInvoiceResponse = {
  bill: Record<string, unknown>;
  items: RefundableBillItem[];
};

function calculateAutomaticRefundAllocation(
  items: RefundableBillItem[],
  refundAmount: number,
): Record<number, number> {
  const eligible = items
    .filter((item) => item.eligible && Number(item.available_qty ?? 0) > 0)
    .map((item) => ({
      id: item.id,
      balance: Math.round(Number(item.refundable_unit_amount ?? 0) * Number(item.available_qty ?? 0) * 100) / 100,
    }))
    .filter((item) => item.balance > 0);
  const totalBalance = eligible.reduce((sum, item) => sum + item.balance, 0);
  const amount = Math.round(Math.max(0, refundAmount) * 100) / 100;
  if (amount <= 0 || totalBalance <= 0 || amount > totalBalance) return {};

  const allocations: Record<number, number> = {};
  let allocated = 0;
  for (const item of eligible) {
    const value = Math.round((amount * item.balance / totalBalance) * 100) / 100;
    allocations[item.id] = Math.min(item.balance, value);
    allocated += allocations[item.id];
  }
  const remainder = Math.round((amount - allocated) * 100) / 100;
  if (remainder !== 0) {
    const target = [...eligible].sort((a, b) => b.balance - a.balance || a.id - b.id)[0];
    allocations[target.id] = Math.round((allocations[target.id] + remainder) * 100) / 100;
  }
  return allocations;
}

type DrawerTab = 'overview' | 'opd' | 'ipd' | 'financials';

type IpdPendingItem = {
  id: number;
  item_name: string;
  item_category: string;
  department?: string;
  unit_price: number;
  quantity: number;
  discount_percent: number;
  discount_amount: number;
  total_amount: number;
  created_at: string;
  bill_status: string;
};

type IpdBedCharge = {
  id: number;
  ward_name?: string;
  bed_number?: string;
  bed_type?: string;
  rate_per_day: number;
  days: number;
  charge_amount: number;
};

type IpdPendingResponse = {
  items: IpdPendingItem[];
  bed_charges: { segments: IpdBedCharge[]; bed_total: number };
  financial_clearance?: IpdFinancialClearanceApi;
  summary: {
    provisional_total: number;
    bed_total: number;
    grand_total: number;
    running_total?: number;
    settled_total?: number;
    settled_cash_paid?: number;
    settled_deposit_used?: number;
    deposit_total?: number;
    deposit_used?: number;
    deposit_refunded?: number;
    deposit_balance: number;
    net_payable: number;
    refund_available?: number;
    pending_service_amount?: number;
    current_balance?: number;
  };
};

type Doctor = {
  id: number;
  name: string;
  specialty?: string | null;
};

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getBillDue(bill: DrawerBill) {
  return getBillOutstandingAmount(bill);
}

function newDrawerInvoiceAttemptKey(patientId: number | null): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `drawer-bill-${patientId ?? 'none'}-${suffix}`;
}

export default function ReceptionPatientDrawer({
  patientId,
  basePath,
  onClose,
  onManageIpdBilling,
}: {
  patientId: number | null;
  basePath: string;
  onClose: () => void;
  onManageIpdBilling?: (admission: { patientId: number; admissionId: number }) => void;
}) {
  const { t } = useTranslation(['reception', 'common']);
  const navigate = useNavigate();
  const open = Boolean(patientId);
  const queryClient = useQueryClient();
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview');
  const [actionMode, setActionMode] = useState<'bill' | 'deposit' | 'payment' | 'discharge' | 'cancelRequest' | 'refundRequest' | 'paymentCorrectionRequest' | null>(null);
  const [serviceSearch, setServiceSearch] = useState('');
  const [cart, setCart] = useState<Array<{ id: number; item_name: string; item_code?: string | null; department_name?: string | null; price: number; quantity: number; discountAmount: number }>>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [billPaymentReference, setBillPaymentReference] = useState('');
  const [duePaymentMethod, setDuePaymentMethod] = useState('cash');
  const [duePaymentReference, setDuePaymentReference] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [duePaymentAmount, setDuePaymentAmount] = useState('');
  const [selectedDueBill, setSelectedDueBill] = useState<DrawerBill | null>(null);
  const [showDueDetails, setShowDueDetails] = useState(false);
  const [depositDeducted, setDepositDeducted] = useState('');
  const [referringDoctorId, setReferringDoctorId] = useState<number | ''>('');
  const [referringDoctorTouched, setReferringDoctorTouched] = useState(false);
  const [billMode, setBillMode] = useState<'paid' | 'credit'>('paid');
  const [invoiceAttemptKey, setInvoiceAttemptKey] = useState(() => newDrawerInvoiceAttemptKey(patientId));
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState('cash');
  const [depositRemarks, setDepositRemarks] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountByName, setDiscountByName] = useState('');
  const [schemeCodeInput, setSchemeCodeInput] = useState('');
  const [memberCodeInput, setMemberCodeInput] = useState('');
  const [schemePreview, setSchemePreview] = useState<DrawerSchemePreview | null>(null);
  const [discountAllocationEnabled, setDiscountAllocationEnabled] = useState(false);
  const [discountAllocationRows, setDiscountAllocationRows] = useState<DiscountAllocationRow[]>([]);
  const [discountSourceIntent, setDiscountSourceIntent] = useState<DiscountAllocationReason | null>(null);
  const [doctorWaiverQuote, setDoctorWaiverQuote] = useState<DoctorWaiverPreviewResponse | null>(null);
  const [doctorAvailableWaiverAmount, setDoctorAvailableWaiverAmount] = useState(0);
  const [doctorWaiverVerifiedPreviewKey, setDoctorWaiverVerifiedPreviewKey] = useState<string | null>(null);
  const [billReviewTarget, setBillReviewTarget] = useState<PatientContext['bills'][number] | null>(null);
  const [paymentReviewTarget, setPaymentReviewTarget] = useState<NonNullable<PatientContext['payments']>[number] | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [refundMode, setRefundMode] = useState<RefundMode>('full');
  const [refundSelections, setRefundSelections] = useState<Record<number, number>>({});
  const [manualRefundAmount, setManualRefundAmount] = useState('');
  const [refundAllocationOverrides, setRefundAllocationOverrides] = useState<Record<number, string>>({});

  useEffect(() => {
    setInvoiceAttemptKey(newDrawerInvoiceAttemptKey(patientId));
  }, [patientId]);

  const { data, isLoading, error } = useApiQuery<PatientContext>(
    ['reception', 'patient-context', patientId],
    `/api/reception/patients/${patientId}/context`,
    { enabled: open && Boolean(patientId) },
  );
  const { data: servicesData, isFetching: servicesLoading } = useApiQuery<{ data: Array<{ id: number; item_name: string; item_code?: string | null; department_name?: string | null; price: number }> }>(
    ['reception', 'drawer', 'services', serviceSearch],
    `/api/billing-counter/service-items?search=${encodeURIComponent(serviceSearch)}&limit=12`,
    { enabled: open && actionMode === 'bill' },
  );
  const { data: doctorsData } = useApiQuery<{ doctors: Doctor[] }>(
    ['reception', 'drawer', 'doctors'],
    '/api/doctors',
    { enabled: open && actionMode === 'bill' },
  );
  const { data: activeCounterData } = useApiQuery<{
    active: boolean;
    session: {
      id: number;
      counterName?: string;
      counter_name?: string;
      expectedCash?: number;
      heldRefundCash?: number;
      availableCash?: number;
    } | null;
  }>(
    ['billing-counter', 'active-session', 'drawer'],
    '/api/billing-counter/sessions/active',
    { enabled: open },
  );
  const { data: refundInvoiceData, isLoading: refundItemsLoading } = useApiQuery<RefundInvoiceResponse>(
    ['credit-notes', 'invoice', billReviewTarget?.id],
    `/api/credit-notes/invoice/${billReviewTarget?.id}`,
    { enabled: open && actionMode === 'refundRequest' && Boolean(billReviewTarget?.id) },
  );
  const { data: ipdPendingData, isLoading: ipdPendingLoading } = useApiQuery<IpdPendingResponse>(
    ['reception', 'drawer', 'ipd-pending', data?.activeAdmission?.id],
    `/api/ip-billing/pending/${data?.activeAdmission?.id}`,
    { enabled: open && actionMode === 'discharge' && Boolean(data?.activeAdmission?.id) },
  );

  const dueBills = useMemo(
    () => (data?.dueBills ?? data?.bills ?? []).filter((bill) => getBillDue(bill) > 0),
    [data?.bills, data?.dueBills],
  );
  const invoiceDueTotal = dueBills.reduce((sum, bill) => sum + getBillDue(bill), 0);
  const ipdPendingDue = Math.max(0, Number(data?.ipdPending?.due ?? 0));
  const totalPaid = Number(data?.totalPaid ?? 0);
  const dueTotal = invoiceDueTotal + ipdPendingDue;
  const patient = data?.patient;
  const receptionBasePath = basePath.endsWith('/reception') ? basePath : `${basePath}/reception`;
  const getBillPrintPath = (billId: number) => `${basePath}/billing/${billId}/print`;
  const services = servicesData?.data ?? [];
  const doctors = doctorsData?.doctors ?? [];
  const activeSession = activeCounterData?.session ?? null;
  const refundableBillItems = useMemo(() => refundInvoiceData?.items ?? [], [refundInvoiceData?.items]);
  const refundBillTotal = useMemo(() => {
    const canonicalBill = refundInvoiceData?.bill;
    return Math.max(0, Number(
      canonicalBill?.total
      ?? canonicalBill?.total_amount
      ?? getBillTotalAmount(billReviewTarget),
    ));
  }, [billReviewTarget, refundInvoiceData?.bill]);
  const refundBillPaid = useMemo(() => {
    const canonicalBill = refundInvoiceData?.bill;
    return Math.min(refundBillTotal, Math.max(0, Number(
      canonicalBill?.paid
      ?? canonicalBill?.paid_amount
      ?? getBillSettledAmount(billReviewTarget),
    )));
  }, [billReviewTarget, refundBillTotal, refundInvoiceData?.bill]);
  const manualRefundValue = useMemo(() => {
    const parsed = Number(manualRefundAmount);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
  }, [manualRefundAmount]);
  const amountRefundRequiresFullFlow = refundMode === 'amount'
    && refundBillTotal > 0
    && manualRefundValue >= refundBillTotal;
  const automaticRefundAllocations = useMemo(
    () => calculateAutomaticRefundAllocation(refundableBillItems, manualRefundValue),
    [manualRefundValue, refundableBillItems],
  );
  const amountRefundAllocationRows = useMemo(() => refundableBillItems
    .filter((item) => item.eligible && Number(item.available_qty ?? 0) > 0)
    .map((item) => {
      const balance = Math.round(Number(item.refundable_unit_amount ?? 0) * Number(item.available_qty ?? 0) * 100) / 100;
      const hasOverride = Object.prototype.hasOwnProperty.call(refundAllocationOverrides, item.id);
      const override = Number(refundAllocationOverrides[item.id]);
      const allocatedRefundAmount = hasOverride && Number.isFinite(override)
        ? Math.round(Math.max(0, override) * 100) / 100
        : Number(automaticRefundAllocations[item.id] ?? 0);
      return {
        item,
        balance,
        allocatedRefundAmount,
        allocationSource: hasOverride ? 'requester_adjusted' as const : 'auto' as const,
      };
    })
    .filter((row) => row.balance > 0), [automaticRefundAllocations, refundableBillItems, refundAllocationOverrides]);
  const amountRefundAllocationTotal = useMemo(
    () => Math.round(amountRefundAllocationRows.reduce((sum, row) => sum + row.allocatedRefundAmount, 0) * 100) / 100,
    [amountRefundAllocationRows],
  );
  const amountRefundAllocationInvalid = refundMode === 'amount' && manualRefundValue > 0 && (
    amountRefundAllocationRows.length === 0
    || Math.abs(amountRefundAllocationTotal - manualRefundValue) >= 0.01
    || amountRefundAllocationRows.some((row) => row.allocatedRefundAmount < 0 || row.allocatedRefundAmount > row.balance)
  );
  const selectedRefundItems = useMemo(() => {
    if (refundMode === 'amount') return [];
    if (refundMode === 'full') {
      return refundableBillItems
        .filter((item) => item.eligible && Number(item.available_qty ?? 0) > 0)
        .map((item) => ({
          id: item.id,
          description: item.description,
          quantity: Number(item.available_qty),
          amount: Math.round(Number(item.refundable_unit_amount ?? 0) * Number(item.available_qty) * 100) / 100,
        }));
    }

    return refundableBillItems
      .filter((item) => item.eligible)
      .map((item) => ({
        id: item.id,
        description: item.description,
        quantity: Math.max(0, Math.min(Number(item.available_qty ?? 0), Number(refundSelections[item.id] ?? 0))),
        amount: 0,
      }))
      .filter((item) => item.quantity > 0)
      .map((item) => {
        const source = refundableBillItems.find((candidate) => candidate.id === item.id)!;
        return {
          ...item,
          amount: Math.round(Number(source.refundable_unit_amount ?? 0) * item.quantity * 100) / 100,
        };
      });
  }, [refundMode, refundableBillItems, refundSelections]);
  const selectedRefundTotal = useMemo(
    () => refundMode === 'amount'
      ? manualRefundValue
      : Math.round(selectedRefundItems.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
    [manualRefundValue, refundMode, selectedRefundItems],
  );
  const selectedRefundFinancialImpact = useMemo(() => {
    const newTotal = Math.max(0, refundBillTotal - selectedRefundTotal);
    const newPaid = Math.min(refundBillPaid, newTotal);
    const cashRefund = Math.round(Math.max(0, refundBillPaid - newPaid) * 100) / 100;
    const receivableReduction = Math.round(Math.max(0, selectedRefundTotal - cashRefund) * 100) / 100;
    return { cashRefund, receivableReduction };
  }, [refundBillPaid, refundBillTotal, selectedRefundTotal]);
  const selectedCashHoldAmount = selectedRefundFinancialImpact.cashRefund;
  const selectedReceivableReduction = selectedRefundFinancialImpact.receivableReduction;
  const availableCounterCash = Number(activeSession?.availableCash ?? activeSession?.expectedCash ?? 0);
  const insufficientRefundCash = selectedCashHoldAmount > availableCounterCash;
  const refundProducesNoCash = selectedRefundTotal > 0 && selectedCashHoldAmount <= 0;
  const cartTotal = useMemo(() => cart.reduce((sum, line) => {
    const gross = Number(line.price ?? 0) * line.quantity;
    return sum + Math.max(0, gross - Number(line.discountAmount ?? 0));
  }, 0), [cart]);
  const rawDepositBalance = Number(data?.deposits?.raw_balance ?? data?.deposits?.balance ?? 0);
  const hasDepositLedgerMismatch = rawDepositBalance < 0;
  const depositLedgerMismatchAmount = Math.abs(Math.min(0, rawDepositBalance));
  const depositBalance = Number(data?.deposits?.balance ?? Math.max(0, rawDepositBalance));
  const totalDepositReceived = Number(data?.deposits?.total_deposits ?? depositBalance);
  const ipdSummary = data?.ipdBillingSummary ?? null;
  const activeAdmissionLabel = data?.activeAdmission
    ? [data.activeAdmission.ward_name, data.activeAdmission.bed_number].filter(Boolean).join('-')
    : '';
  const ipdCurrentCost = Number(ipdSummary?.running_total ?? data?.ipdPending?.total ?? 0);
  const ipdDepositReceived = Number(ipdSummary?.deposit_total ?? totalDepositReceived);
  const ipdDepositUsed = Number(ipdSummary?.deposit_used ?? Number(data?.deposits?.total_adjustments ?? 0));
  const ipdDepositBalance = Number(ipdSummary?.deposit_balance ?? depositBalance);
  const ipdCurrentDue = Math.max(0, Number(ipdSummary?.net_payable ?? data?.ipdPending?.due ?? 0));
  const ipdRefundAvailable = Math.max(0, Number(ipdSummary?.refund_available ?? Math.max(0, ipdDepositBalance - ipdCurrentCost)));
  const hasMixedDues = Boolean(data?.activeAdmission && invoiceDueTotal > 0 && ipdPendingDue > 0);
  const patientDueLabel = hasMixedDues
    ? t('info.totalDueLabel', { defaultValue: 'মোট বাকি (IPD+OPD)' })
    : t('info.dueLabel', { defaultValue: 'বাকি আছে' });
  const afterDiscount = Math.max(0, cartTotal - Number(discountAmount || 0));
  const requiresDiscountByName = cartTotal > 0
    && Number(discountAmount || 0) > 0
    && (Number(discountAmount || 0) / cartTotal) * 100 > 20;
  const suggestedSchemeDiscount = Math.min(Number(schemePreview?.suggested_discount ?? 0), cartTotal);
  const depositApplied = billMode === 'credit'
    ? 0
    : Math.min(depositBalance, afterDiscount, Math.max(0, Number(depositDeducted || 0)));
  const payableNow = Math.max(0, afterDiscount - depositApplied);
  const cashPaidNow = billMode === 'credit' ? 0 : Math.min(payableNow, Math.max(0, Number(paidAmount || payableNow)));
  const dueAfterPayment = Math.max(0, afterDiscount - depositApplied - cashPaidNow);
  const depositAfterCollection = depositBalance + Math.max(0, Number(depositAmount || 0));
  const defaultReferringDoctorId = useMemo(
    () => resolveTodayVisitReferringDoctorId(data?.visits ?? [], getTodayGMT6()),
    [data?.visits],
  );

  const openDuePayment = (bill: DrawerBill) => {
    const due = getBillDue(bill);
    if (due <= 0) {
      toast.error(t('info.noDueAmount', { defaultValue: 'This invoice has no due amount' }));
      return;
    }
    setSelectedDueBill(bill);
    setDuePaymentAmount(String(due));
    setDuePaymentMethod('cash');
    setDuePaymentReference('');
    setActionMode('payment');
    setShowDueDetails(true);
  };

  useEffect(() => {
    if (actionMode !== 'bill' || referringDoctorTouched || !defaultReferringDoctorId) return;
    setReferringDoctorId(defaultReferringDoctorId);
  }, [actionMode, defaultReferringDoctorId, referringDoctorTouched]);

  const resetBillForm = (renewAttemptKey = false) => {
    setCart([]);
    setServiceSearch('');
    setPaymentMethod('cash');
    setBillPaymentReference('');
    setPaidAmount('');
    setDepositDeducted('');
    setReferringDoctorId(defaultReferringDoctorId);
    setReferringDoctorTouched(false);
    setBillMode('paid');
    setDiscountAmount('');
    setDiscountPercent('');
    setDiscountByName('');
    setSchemeCodeInput('');
    setMemberCodeInput('');
    setSchemePreview(null);
    setDiscountAllocationEnabled(false);
    setDiscountAllocationRows([]);
    setDiscountSourceIntent(null);
    setDoctorWaiverQuote(null);
    setDoctorAvailableWaiverAmount(0);
    setDoctorWaiverVerifiedPreviewKey(null);
    if (renewAttemptKey) {
      setInvoiceAttemptKey(newDrawerInvoiceAttemptKey(patientId));
    }
  };

  const handleBillModeChange = (mode: 'paid' | 'credit') => {
    setBillMode(mode);
    if (mode === 'credit') {
      setPaidAmount('');
      setDepositDeducted('');
    }
  };

  const depositMutation = useApiMutation<{ receipt_no?: string; deposit_receipt_no?: string }, unknown>(
    'post',
    '/api/deposits',
    {
      onSuccess: () => {
        toast.success(t('toast.depositCollected', { defaultValue: 'Deposit collected' }));
        setDepositAmount('');
        setDepositRemarks('');
        setActionMode(null);
        queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context', patientId] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
      },
      onError: (depositError) => toast.error(depositError.message || t('toast.failedCollectDeposit', { defaultValue: 'Failed to collect deposit' })),
    },
  );

  const schemePreviewMutation = useApiMutation<DrawerSchemePreview, { patient_id?: number; scheme_code?: string; member_code?: string; service_category?: string; subtotal: number }>(
    'post',
    '/api/billing-master/apply-scheme-preview',
    {
      onSuccess: (preview) => {
        setSchemePreview(preview);
        if (preview.eligible) toast.success(`Eligible: ${preview.scheme_name ?? 'scheme'} benefit`);
        else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
      },
      onError: (schemeError) => toast.error(schemeError.message || 'Failed to check scheme benefit'),
    },
  );

  const doctorWaiverPreviewMutation = useApiMutation<DoctorWaiverPreviewResponse, DoctorWaiverPreviewRequest>(
    'post',
    '/api/discounts/doctor-waiver-preview',
    {
      onSuccess: (preview, variables) => {
        setDoctorWaiverQuote(preview);
        setDoctorAvailableWaiverAmount(Number(preview.maximumDoctorWaiverAmount ?? preview.doctorWaiverAmount ?? 0));
        setDoctorWaiverVerifiedPreviewKey(JSON.stringify(variables));
      },
      onError: () => {
        setDoctorWaiverQuote(null);
        setDoctorAvailableWaiverAmount(0);
        setDoctorWaiverVerifiedPreviewKey(null);
      },
    },
  );

  const invoiceMutation = useApiMutation<{ invoiceNo?: string; total?: number; billId?: number }, unknown>(
    'post',
    '/api/billing-counter/invoices',
    {
      onSuccess: (res) => {
        toast.success(res.invoiceNo ? `Bill created: ${res.invoiceNo}` : t('toast.billCreated', { defaultValue: 'Bill created' }));
        resetBillForm(true);
        setActionMode(null);
        queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context', patientId] });
        queryClient.invalidateQueries({ queryKey: ['billing'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
        redirectToReceptionBillPrint(navigate, basePath, res.billId);
      },
      onError: (invoiceError) => {
        if (shouldRotateInvoiceAttemptKey(invoiceError)) {
          setInvoiceAttemptKey(newDrawerInvoiceAttemptKey(patientId));
        }
        toast.error(invoiceError.message || t('toast.failedCreateBill', { defaultValue: 'Failed to create bill' }));
      },
    },
  );

  const submitSchemeCheck = () => {
    const schemeCode = schemeCodeInput.trim();
    const memberCode = memberCodeInput.trim();
    if (!schemeCode && !memberCode) {
      toast.error('Enter a scheme or member code.');
      return;
    }
    if (!patient) return;
    if (cartTotal <= 0) {
      toast.error(t('empty.selectItemsToAdd', { defaultValue: 'Add services from the left panel to create a bill' }));
      return;
    }
    schemePreviewMutation.mutate({
      patient_id: patient.id,
      scheme_code: schemeCode || undefined,
      member_code: memberCode || undefined,
      service_category: 'patient_drawer_quick_bill',
      subtotal: cartTotal,
    });
  };

  const applySchemeDiscount = () => {
    if (!schemePreview?.eligible || suggestedSchemeDiscount <= 0) {
      toast.error(schemePreview?.blockers?.[0] || 'No eligible scheme benefit to apply.');
      return;
    }
    setDiscountAmount(String(suggestedSchemeDiscount));
    setDiscountPercent(cartTotal > 0 ? String(Math.round((suggestedSchemeDiscount / cartTotal) * 100)) : '0');
    if (schemePreview.requires_reference && !discountByName.trim()) {
      setDiscountByName(
        schemePreview.matched_member_name
        || schemePreview.matched_member_code
        || schemePreview.scheme_name
        || 'Scheme benefit',
      );
    }
  };

  const duePaymentMutation = useApiMutation<{ receiptNo?: string; outstanding?: number; status?: string; billId?: number }, unknown>(
    'post',
    '/api/billing/pay',
    {
      onSuccess: (res) => {
        toast.success(res.receiptNo ? `Payment collected: ${res.receiptNo}` : t('toast.paymentCollected', { defaultValue: 'Payment collected' }));
        setSelectedDueBill(null);
        setDuePaymentAmount('');
        setActionMode(null);
        queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context', patientId] });
        queryClient.invalidateQueries({ queryKey: ['billing'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
        queryClient.invalidateQueries({ queryKey: ['bills', 'due'] });
        redirectToReceptionBillPrint(navigate, basePath, res.billId ?? selectedDueBill?.id);
      },
      onError: (paymentError) => toast.error(paymentError.message || t('toast.failedCollectPayment', { defaultValue: 'Failed to collect payment' })),
    },
  );


  const billReviewRequestMutation = useApiMutation<{ executed?: boolean }, Record<string, unknown>>(
    'post',
    '/api/approvals',
    {
      onSuccess: (res) => {
        toast.success(res.executed
          ? t('toast.paymentVoidExecuted', { defaultValue: 'Payment reversed and sent for admin review' })
          : t('toast.approvalRequestSubmitted', { defaultValue: 'Request sent for admin review' }));
        setActionMode(null);
        setBillReviewTarget(null);
        setPaymentReviewTarget(null);
        setReviewReason('');
        setRefundMode('full');
        setRefundSelections({});
        setManualRefundAmount('');
        setRefundAllocationOverrides({});
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context', patientId] });
        if (res.executed) {
          queryClient.invalidateQueries({ queryKey: ['billing'] });
          queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-bills'] });
          queryClient.invalidateQueries({ queryKey: ['billing-counter', 'pending-appointments'] });
          queryClient.invalidateQueries({ queryKey: ['bills', 'due'] });
        }
      },
      onError: (approvalError) => toast.error(approvalError.message || t('toast.failedApprovalRequest', { defaultValue: 'Failed to send request' })),
    },
  );

  const refundRequestMutation = useApiMutation<{ executed?: boolean }, Record<string, unknown>>(
    'post',
    '/api/approvals',
    {
      timeoutMs: 15_000,
      retry: (failureCount, error) => failureCount < 1 && isRetryableApiTransportError(error),
      retryDelay: 250,
      onSuccess: () => {
        toast.success(t('toast.refundCashHeld', { defaultValue: 'Pending approval — cash held' }));
        setActionMode(null);
        setBillReviewTarget(null);
        setPaymentReviewTarget(null);
        setReviewReason('');
        setRefundMode('full');
        setRefundSelections({});
        setManualRefundAmount('');
        setRefundAllocationOverrides({});
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
        queryClient.invalidateQueries({ queryKey: ['billing-counter', 'active-session'] });
        queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context', patientId] });
      },
      onError: (approvalError) => toast.error(approvalError.message || t('toast.failedApprovalRequest', { defaultValue: 'Failed to send request' })),
    },
  );

  const reviewRequestPending = actionMode === 'refundRequest'
    ? refundRequestMutation.isPending
    : billReviewRequestMutation.isPending;
  const anyReviewRequestPending = refundRequestMutation.isPending || billReviewRequestMutation.isPending;

  const getRefundRequestAmount = (bill: DrawerBill) => Math.min(getBillTotalAmount(bill), getBillSettledAmount(bill));

  const canRequestBillRefund = (bill: DrawerBill) => {
    const status = String(bill.status ?? '').toLowerCase();
    if (['cancelled', 'refunded', 'draft'].includes(status)) return false;
    return getRefundRequestAmount(bill) > 0;
  };

  const openBillCancelRequest = (bill: DrawerBill) => {
    if (String(bill.status ?? '').toLowerCase() === 'cancelled') {
      toast.error(t('toast.billAlreadyCancelled', { defaultValue: 'This bill is already cancelled' }));
      return;
    }
    if (canRequestBillRefund(bill)) {
      openBillRefundRequest(bill);
      return;
    }
    setBillReviewTarget(bill);
    setPaymentReviewTarget(null);
    setReviewReason('');
    setActionMode('cancelRequest');
    setDrawerTab('overview');
  };

  const openBillRefundRequest = (bill: DrawerBill) => {
    if (!canRequestBillRefund(bill)) {
      toast.error(t('toast.billRefundNotAvailable', { defaultValue: 'This bill has no paid amount available for refund' }));
      return;
    }
    setBillReviewTarget(bill);
    setPaymentReviewTarget(null);
    setReviewReason('');
    setRefundMode('full');
    setRefundSelections({});
    setManualRefundAmount('');
    setRefundAllocationOverrides({});
    setActionMode('refundRequest');
    setDrawerTab('overview');
  };

  const openPaymentCorrectionRequest = (payment: NonNullable<PatientContext['payments']>[number]) => {
    if (Number(payment.amount ?? 0) <= 0) {
      toast.error(t('toast.paymentNotReversible', { defaultValue: 'This payment cannot be reversed' }));
      return;
    }
    setPaymentReviewTarget(payment);
    setBillReviewTarget(null);
    setReviewReason('');
    setActionMode('paymentCorrectionRequest');
    setDrawerTab('overview');
  };

  const closeReviewPanel = () => {
    setActionMode(null);
    setBillReviewTarget(null);
    setPaymentReviewTarget(null);
    setReviewReason('');
    setRefundMode('full');
    setRefundSelections({});
    setManualRefundAmount('');
    setRefundAllocationOverrides({});
  };

  const submitBillReviewRequest = () => {
    if (!billReviewTarget) return;
    const reason = reviewReason.trim();
    if (reason.length < 3) {
      toast.error(t('toast.cancelReasonRequired', { defaultValue: 'কারণ লিখে বিল বাতিলের অনুরোধ পাঠান' }));
      return;
    }
    billReviewRequestMutation.mutate({
      type: 'bill_cancel',
      entityId: billReviewTarget.id,
      entityNo: billReviewTarget.invoice_no ?? `Bill #${billReviewTarget.id}`,
      requestData: {
        oldValue: {
          status: billReviewTarget.status ?? null,
          totalAmount: Number(billReviewTarget.total_amount ?? 0),
          paidAmount: getBillSettledAmount(billReviewTarget),
          dueAmount: getBillDue(billReviewTarget),
          patientId: patient?.id ?? null,
        },
        newValue: { status: 'cancel_requested' },
        reason,
      },
    });
  };

  const submitBillRefundRequest = () => {
    if (!billReviewTarget) return;
    const reason = reviewReason.trim();
    if (reason.length < 3) {
      toast.error(t('toast.refundReasonRequired', { defaultValue: 'কারণ লিখে রিফান্ড অনুরোধ পাঠান' }));
      return;
    }
    if (refundItemsLoading || !refundInvoiceData?.bill) {
      toast.error(t('toast.refundInvoiceLoading', { defaultValue: 'Wait for the current invoice details to finish loading.' }));
      return;
    }
    if (!activeSession) {
      toast.error(t('toast.activeCounterRequired', { defaultValue: 'Activate a billing counter on this workstation before requesting a refund.' }));
      return;
    }
    if (refundMode === 'amount') {
      if (selectedRefundTotal <= 0) {
        toast.error(t('toast.refundAmountRequired', { defaultValue: 'Enter a refund amount greater than zero.' }));
        return;
      }
      if (amountRefundRequiresFullFlow) {
        toast.error(t('toast.refundAmountRequiresFullFlow', { defaultValue: `Amount-based partial refund must be less than ৳${money(refundBillTotal)}. Use Full refund for the entire bill.` }));
        return;
      }
      if (amountRefundAllocationInvalid) {
        toast.error(t('toast.refundAllocationInvalid', { defaultValue: 'Item allocations must equal the refund amount and stay within each item balance.' }));
        return;
      }
    } else if (selectedRefundItems.length === 0 || selectedRefundTotal <= 0) {
      toast.error(t('toast.refundItemsRequired', { defaultValue: 'Select at least one refundable item.' }));
      return;
    }
    if (refundProducesNoCash) {
      toast.error(t('toast.refundProducesNoCash', { defaultValue: 'This selection only reduces unpaid receivable. Use the bill-adjustment workflow.' }));
      return;
    }
    if (insufficientRefundCash) {
      toast.error(t('toast.insufficientRefundCash', { defaultValue: 'Available counter cash is lower than the requested refund amount.' }));
      return;
    }

    const requestData: Record<string, unknown> = {
      refundKind: refundMode === 'full'
        ? 'bill_refund'
        : refundMode === 'amount'
          ? 'amount_partial_refund'
          : 'item_partial_refund',
      paymentMethod: 'cash',
      reason,
      oldValue: {
        status: billReviewTarget.status ?? null,
        totalAmount: Number(billReviewTarget.total_amount ?? 0),
        cashPaidAmount: getBillCashPaidAmount(billReviewTarget),
        paidAmount: getBillSettledAmount(billReviewTarget),
        dueAmount: getBillDue(billReviewTarget),
        patientId: patient?.id ?? null,
        patientName: patient?.name ?? null,
      },
      newValue: { status: 'refund_requested' },
    };
    if (refundMode === 'amount') {
      requestData.requestedRefundAmount = selectedRefundTotal;
      requestData.allocationMode = 'auto_proportional_adjustable';
      requestData.allocationVersion = 1;
      requestData.items = amountRefundAllocationRows
        .filter((row) => row.allocatedRefundAmount > 0)
        .map((row) => ({
          invoiceItemId: row.item.id,
          allocatedRefundAmount: row.allocatedRefundAmount,
          allocationSource: row.allocationSource,
        }));
    } else {
      requestData.items = selectedRefundItems.map((item) => ({
        invoiceItemId: item.id,
        returnQuantity: item.quantity,
      }));
    }

    refundRequestMutation.mutate({
      type: 'refund',
      entityId: billReviewTarget.id,
      entityNo: billReviewTarget.invoice_no ?? `Bill #${billReviewTarget.id}`,
      idempotencyKey: `refund-request-${billReviewTarget.id}-${crypto.randomUUID()}`,
      requestData,
    });
  };

  const submitPaymentReviewRequest = () => {
    if (!paymentReviewTarget) return;
    const reason = reviewReason.trim();
    if (reason.length < 3) {
      toast.error(t('toast.paymentVoidReasonRequired', { defaultValue: 'কারণ লিখে পেমেন্ট ভয়েডের অনুরোধ পাঠান' }));
      return;
    }
    billReviewRequestMutation.mutate({
      type: 'payment_void',
      entityId: paymentReviewTarget.id,
      entityNo: paymentReviewTarget.receipt_no ?? `Payment #${paymentReviewTarget.id}`,
      idempotencyKey: `payment-void-${paymentReviewTarget.id}-${crypto.randomUUID()}`,
      requestData: {
        correctionType: 'payment_void',
        amount: Number(paymentReviewTarget.amount ?? 0),
        patientName: patient?.name ?? undefined,
        oldValue: {
          receiptNo: paymentReviewTarget.receipt_no ?? null,
          amount: Number(paymentReviewTarget.amount ?? 0),
          paymentMethod: paymentReviewTarget.payment_method ?? null,
          invoiceNo: paymentReviewTarget.invoice_no ?? null,
          patientId: patient?.id ?? null,
        },
        newValue: { status: 'payment_void_requested' },
        reason,
      },
    });
  };

  const cartLinesWithGlobalDiscount = () => {
    const requested = Math.min(cartTotal, Math.max(0, Number(discountAmount || 0)));
    if (requested <= 0 || cart.length === 0) return cart;
    const baseRows = cart.map((line) => {
      const gross = Number(line.price ?? 0) * line.quantity;
      const existingDiscount = Math.min(gross, Math.max(0, Number(line.discountAmount ?? 0)));
      return { line, gross, existingDiscount, remaining: Math.max(0, gross - existingDiscount) };
    }).filter((row) => row.remaining > 0);
    const remainingTotal = baseRows.reduce((sum, row) => sum + row.remaining, 0);
    if (remainingTotal <= 0) return cart;
    let allocated = 0;
    const byId = new Map<number, number>();
    baseRows.forEach((row, index) => {
      const extra = index === baseRows.length - 1
        ? Math.round((requested - allocated) * 100) / 100
        : Math.min(row.remaining, Math.round((requested * row.remaining / remainingTotal) * 100) / 100);
      allocated = Math.round((allocated + extra) * 100) / 100;
      byId.set(row.line.id, Math.min(row.gross, row.existingDiscount + Math.max(0, extra)));
    });
    return cart.map((line) => byId.has(line.id) ? { ...line, discountAmount: byId.get(line.id) ?? line.discountAmount } : line);
  };

  const doctorWaiverPreviewRequest = useMemo<DoctorWaiverPreviewRequest | null>(() => {
    if (!referringDoctorId || cart.length === 0 || schemePreview?.eligible) return null;
    return {
      doctorId: Number(referringDoctorId),
      totalDiscount: 0,
      items: cartLinesWithGlobalDiscount().map((line) => ({
        itemCategory: previewItemCategory(line),
        description: line.item_name,
        lineTotal: Math.max(0, Number(line.price ?? 0) * line.quantity - Number(line.discountAmount ?? 0)),
        grossLineTotal: Math.max(0, Number(line.price ?? 0) * line.quantity),
        quantity: line.quantity,
        referenceId: line.id,
      })),
    };
  }, [cart, cartTotal, discountAmount, referringDoctorId, schemePreview?.eligible]);
  const doctorWaiverPreviewKey = useMemo(
    () => doctorWaiverPreviewRequest ? JSON.stringify(doctorWaiverPreviewRequest) : null,
    [doctorWaiverPreviewRequest],
  );
  const hasDoctorWaiverAllocation = !schemePreview?.eligible
    && discountAllocationRows.some((row) => row.reason === 'doctor_commission_waiver');
  const doctorWaiverPreviewStatus = resolveDoctorWaiverPreviewStatus({
    hasDoctorWaiverAllocation,
    previewKey: doctorWaiverPreviewKey,
    verifiedPreviewKey: doctorWaiverVerifiedPreviewKey,
    mutationPending: doctorWaiverPreviewMutation.isPending,
    mutationFailed: doctorWaiverPreviewMutation.isError,
  });
  const doctorWaiverPreviewPending = doctorWaiverPreviewStatus.pending;
  const doctorWaiverPreviewFailed = doctorWaiverPreviewStatus.failed;
  const doctorWaiverPaymentBlocked = doctorWaiverPreviewStatus.paymentBlocked;

  useEffect(() => {
    const totalDiscount = Math.max(0, Number(discountAmount || 0));
    if (totalDiscount > 0) return;
    if (discountAllocationEnabled) setDiscountAllocationEnabled(false);
    if (discountAllocationRows.length > 0) setDiscountAllocationRows([]);
    if (discountSourceIntent !== null) setDiscountSourceIntent(null);
  }, [discountAllocationEnabled, discountAllocationRows.length, discountAmount, discountSourceIntent]);

  useEffect(() => {
    if (!doctorWaiverPreviewRequest || !doctorWaiverPreviewKey) {
      if (doctorWaiverQuote !== null) setDoctorWaiverQuote(null);
      if (doctorAvailableWaiverAmount !== 0) setDoctorAvailableWaiverAmount(0);
      if (doctorWaiverVerifiedPreviewKey !== null) setDoctorWaiverVerifiedPreviewKey(null);
      return;
    }
    if (doctorWaiverVerifiedPreviewKey === doctorWaiverPreviewKey) return;
    if (doctorWaiverPreviewMutation.isPending || doctorWaiverPreviewMutation.isError) return;
    setDoctorWaiverQuote(null);
    setDoctorAvailableWaiverAmount(0);
    doctorWaiverPreviewMutation.mutate(doctorWaiverPreviewRequest);
  }, [
    doctorAvailableWaiverAmount,
    doctorWaiverPreviewKey,
    doctorWaiverPreviewMutation.isError,
    doctorWaiverPreviewMutation.isPending,
    doctorWaiverPreviewRequest,
    doctorWaiverQuote,
    doctorWaiverVerifiedPreviewKey,
  ]);

  const addToCart = (item: { id: number; item_name: string; item_code?: string | null; department_name?: string | null; price: number; allow_multiple_qty?: number | null; allow_discount?: number | null }) => {
    setCart((current) => {
      const existing = current.find((line) => line.id === item.id);
      const updated = existing
        ? current.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...current, { ...item, quantity: 1, discountAmount: 0 }];
      const newCartTotal = updated.reduce((sum, line) => {
        const gross = Number(line.price ?? 0) * line.quantity;
        return sum + Math.max(0, gross - Number(line.discountAmount ?? 0));
      }, 0);
      const newAfterDiscount = Math.max(0, newCartTotal - Number(discountAmount || 0));
      const newDepositApplied = billMode === 'credit'
        ? 0
        : depositBalance > 0 ? Math.min(depositBalance, newAfterDiscount) : 0;
      const newPayable = Math.max(0, newAfterDiscount - newDepositApplied);
      if (billMode === 'credit') {
        setDepositDeducted('');
        setPaidAmount('');
      } else {
        if (depositBalance > 0) {
          setDepositDeducted(String(newDepositApplied));
        }
        setPaidAmount(String(newPayable));
      }
      return updated;
    });
  };

  useEffect(() => {
    if (billMode === 'credit') {
      setDepositDeducted('');
      return;
    }
    if (depositBalance > 0 && cart.length > 0) {
      const currentAfterDiscount = Math.max(0, cartTotal - Number(discountAmount || 0));
      setDepositDeducted(String(Math.min(depositBalance, currentAfterDiscount)));
    }
  }, [billMode, cart, cartTotal, depositBalance, discountAmount]);

  useEffect(() => {
    if (data?.activeAdmission) {
      setDrawerTab('ipd');
    } else {
      setDrawerTab('overview');
    }
  }, [data?.activeAdmission?.id, patientId]);

  return (
    <>
      {open ? <button type="button" className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-label="Close patient drawer backdrop" /> : null}
      <aside className={`fixed right-0 top-0 z-50 h-full w-full max-w-4xl transform overflow-y-auto border-l border-[var(--color-border)] bg-white shadow-2xl transition-transform duration-200 dark:bg-slate-900 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-border)] bg-white/95 p-4 backdrop-blur dark:bg-slate-900/95">
          <div>
            <h2 className="text-lg font-semibold">{t('patientDrawer.title', { defaultValue: 'Patient context' })}</h2>
            <p className="text-sm text-[var(--color-text-muted)]">{t('patientDrawer.subtitle', { defaultValue: 'Visits, dues, reports, and IPD actions' })}</p>
          </div>
          <button type="button" className="btn-ghost p-2" onClick={onClose} aria-label="Close patient drawer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {isLoading ? <div className="card p-4 text-sm text-[var(--color-text-muted)]">{t('empty.loadingPatient', { defaultValue: 'Loading patient...' })}</div> : null}
          {error ? <div className="card p-4 text-sm text-red-600">{error.message}</div> : null}
          {patient ? (
            <>
              <section className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-lg font-bold text-[var(--color-primary)]">
                      {patient.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </div>
                    <div>
                      <div className="text-xl font-semibold">{patient.name}</div>
                      <div className="text-sm text-[var(--color-text-muted)]">
                        {patient.patient_code ?? `Patient #${patient.id}`}
                        {patient.mobile ? ` · ${patient.mobile}` : ''}
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {patient.age ? `${patient.age} ${t('info.yrs', { defaultValue: 'yrs' })}` : ''}
                        {patient.gender ? ` · ${patient.gender}` : ''}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`badge ${dueTotal > 10000 ? 'bg-red-100 text-red-800 hover:ring-2 hover:ring-red-300' : dueTotal > 0 ? 'badge-warning hover:ring-2 hover:ring-amber-300' : depositBalance > 0 ? 'bg-emerald-100 text-emerald-800' : 'badge-success'} transition`}
                    onClick={() => dueTotal > 0 && setShowDueDetails((current) => !current)}
                    disabled={dueTotal <= 0}
                    title={dueTotal > 0 ? t('info.showDueInvoices', { defaultValue: 'Show due invoices' }) : depositBalance > 0 ? t('info.advanceBalance', { defaultValue: 'Advance balance' }) : t('info.noInvoiceDue', { defaultValue: 'No invoice due' })}
                  >
                    {dueTotal > 0 ? `${patientDueLabel} ৳${money(dueTotal)}` : depositBalance !== 0 ? `${t('info.advanceLabel', { defaultValue: depositBalance > 0 ? 'অতিরিক্ত জমা' : 'বাকি আছে' })} ৳${money(Math.abs(depositBalance))}` : t('info.paidUp', { defaultValue: 'পরিশোধিত' })}
                  </button>
                </div>

                {/* Financial Snapshot Cards */}
                {(data?.activeAdmission || dueTotal > 0 || depositBalance > 0) ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-red-50 border border-red-100 p-2 text-center">
                      <div className="text-[10px] text-red-600 uppercase">{patientDueLabel}</div>
                      <div className="text-sm font-bold font-data text-red-700">৳{money(Math.abs(dueTotal))}</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-center">
                      <div className="text-[10px] text-blue-600 uppercase">{t('info.paidLabel', { defaultValue: 'মোট পরিশোধ' })}</div>
                      <div className="text-sm font-bold font-data text-blue-700">৳{money(totalPaid)}</div>
                    </div>
                    <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2 text-center">
                      <div className="text-[10px] text-emerald-600 uppercase">{t('info.depositLabel', { defaultValue: 'মোট জমা' })}</div>
                      <div className="text-sm font-bold font-data text-emerald-700">৳{money(Math.abs(totalDepositReceived))}</div>
                    </div>
                  </div>
                ) : null}

                {hasDepositLedgerMismatch ? <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Deposit ledger mismatch: adjustment exceeds active deposit by {money(depositLedgerMismatchAmount)}</div> : null}

                {data?.activeAdmission && dueTotal > 0 ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
                    <div className="rounded-lg border border-[var(--color-border)] px-2 py-1">Current IPD due: ৳{money(ipdCurrentDue || ipdPendingDue)}</div>
                    <div className="rounded-lg border border-[var(--color-border)] px-2 py-1">Previous/OPD due: ৳{money(invoiceDueTotal)}</div>
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="btn-secondary justify-center"
                    onClick={() => {
                      setActionMode(actionMode === 'bill' ? null : 'bill');
                      if (actionMode !== 'bill') resetBillForm();
                      setDrawerTab('overview');
                    }}
                  >
                    <Receipt className="h-4 w-4" /> {t('btn.addBill', { defaultValue: 'Add bill' })}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary justify-center"
                    onClick={() => {
                      setActionMode(actionMode === 'deposit' ? null : 'deposit');
                      setDrawerTab('overview');
                    }}
                  >
                    <CreditCard className="h-4 w-4" /> {t('btn.deposit', { defaultValue: 'Deposit' })}
                  </button>
                </div>
              </section>

              {/* Drawer Tabs */}
              <div className="flex border-b border-[var(--color-border)]">
                <button
                  type="button"
                  className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition ${drawerTab === 'overview' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                  onClick={() => setDrawerTab('overview')}
                >
                  {t('tab.overview', { defaultValue: 'Overview' })}
                </button>
                <button
                  type="button"
                  className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition ${drawerTab === 'opd' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                  onClick={() => setDrawerTab('opd')}
                >
                  {t('tab.opdHistory', { defaultValue: 'OPD History' })}
                </button>
                <button
                  type="button"
                  className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition ${drawerTab === 'ipd' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                  onClick={() => setDrawerTab('ipd')}
                >
                  {t('tab.ipdAdmissions', { defaultValue: 'IPD & Admissions' })}
                </button>
                <button
                  type="button"
                  className={`flex-1 px-2 py-2 text-sm font-medium border-b-2 transition ${drawerTab === 'financials' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
                  onClick={() => setDrawerTab('financials')}
                >
                  {t('tab.totalFinancials', { defaultValue: 'Total Financials' })}
                </button>
              </div>

              {/* OPD Visits Tab */}
              {drawerTab === 'opd' ? (
                <section className="card p-4">
                  <h3 className="mb-3 font-semibold">{t('patientDrawer.opdHistory', { defaultValue: 'OPD Visit History' })}</h3>
                  {(data?.visits ?? []).length === 0 ? (
                    <div className="text-sm text-[var(--color-text-muted)] text-center py-4">{t('empty.noVisits', { defaultValue: 'No OPD visits found.' })}</div>
                  ) : (
                    <div className="space-y-3">
                      {(data?.visits ?? []).map((visit) => {
                        const visitBillList = (data?.visitBills ?? []).find((vb) => vb.visit_id === visit.id)?.bills ?? [];
                        return (
                          <div key={visit.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium">{visit.visit_no ?? `Visit #${visit.id}`}</div>
                                <div className="text-xs text-[var(--color-text-muted)]">
                                  {visit.doctor_name ?? t('info.doctorNA', { defaultValue: 'Doctor N/A' })} · {visit.visit_type ?? t('info.opdVisit', { defaultValue: 'OPD visit' })}
                                </div>
                              </div>
                              <span className="text-xs text-[var(--color-text-muted)]">{formatDate(visit.visit_date) ?? t('info.dateNA', { defaultValue: 'Date N/A' })}</span>
                            </div>
                            {visitBillList.length > 0 ? (
                              <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
                                {visitBillList.map((bill) => (
                                  <div key={bill.id} className="flex items-center justify-between gap-2 text-xs">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[var(--color-text-muted)]">{bill.invoice_no ?? `Bill #${bill.id}`}</span>
                                      <span className={`badge text-[10px] ${bill.due > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                        {bill.due > 0 ? `Due ৳${money(bill.due)}` : 'Paid'}
                                      </span>
                                    </div>
                                    <span className="font-data">৳{money(bill.total_amount)}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <div className="mt-2 flex gap-2">
                              <a
                                href={`${basePath}/patients/${patient?.id}`}
                                className="btn-ghost px-2 py-1 text-xs"
                              >
                                {t('btn.viewPrescription', { defaultValue: 'View Prescription' })}
                              </a>
                              <a
                                href={`${basePath}/patients/${patient?.id}`}
                                className="btn-ghost px-2 py-1 text-xs"
                              >
                                {t('btn.labReports', { defaultValue: 'Lab Reports' })}
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : null}

              {/* Total Financials Tab */}
              {drawerTab === 'financials' ? (
                <section className="card p-4">
                  <h3 className="mb-3 font-semibold">{t('patientDrawer.allInvoices', { defaultValue: 'All Invoices' })}</h3>
                  {(data?.bills ?? []).length === 0 ? (
                    <div className="text-sm text-[var(--color-text-muted)] text-center py-4">{t('empty.noInvoices', { defaultValue: 'No invoices yet' })}</div>
                  ) : (
                    <div className="space-y-2">
                      {(data?.bills ?? []).map((bill) => {
                        const billType = (bill as Record<string, unknown>).bill_type as string ?? 'opd';
                        const due = getBillDue(bill);
                        const paid = getBillSettledAmount(bill);
                        const isPaid = due <= 0;
                        return (
                          <div key={bill.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{bill.invoice_no ?? `Bill #${bill.id}`}</span>
                                  <span className={`badge text-[10px] ${billType === 'ipd' ? 'bg-orange-100 text-orange-700' : billType === 'pharmacy' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {billType === 'ipd' ? 'IPD' : billType === 'pharmacy' ? 'Pharmacy' : 'OPD'}
                                  </span>
                                  <span className={`badge text-[10px] ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                    {isPaid ? 'Paid' : `Due ৳${money(due)}`}
                                  </span>
                                </div>
                                <div className="text-xs text-[var(--color-text-muted)] mt-1">
                                  {formatDate(bill.created_at)} · Total ৳{money(bill.total_amount)} · Paid ৳{money(paid)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <a
                                  href={getBillPrintPath(bill.id)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn-ghost px-3 py-2 text-xs"
                                >
                                  {isPaid ? t('btn.receipt', { defaultValue: 'Receipt' }) : t('btn.print', { defaultValue: 'Print' })}
                                </a>
                                {!isPaid ? (
                                  <button
                                    type="button"
                                    className="btn-primary px-3 py-2 text-xs"
                                    disabled={!activeSession}
                                    onClick={() => openDuePayment(bill)}
                                  >
                                    {t('btn.collect', { defaultValue: 'Collect' })}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Deposit Ledger */}
                  {(data?.depositLedger ?? []).length > 0 ? (
                    <div className="mt-4">
                      <h4 className="mb-2 text-sm font-semibold">{t('patientDrawer.depositLedger', { defaultValue: 'Deposit Ledger' })}</h4>
                      <div className="space-y-2">
                        {(data?.depositLedger ?? []).map((d) => (
                          <div key={d.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3 text-sm">
                            <div>
                              <div className="font-medium">৳{money(d.amount)}</div>
                              <div className="text-xs text-[var(--color-text-muted)]">
                                {d.transaction_type} · {d.payment_method ?? 'cash'}
                              </div>
                              <div className="text-xs text-[var(--color-text-muted)]">{formatDate(d.created_at)}</div>
                            </div>
                            {d.deposit_receipt_no ? <span className="badge text-xs">{d.deposit_receipt_no}</span> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Billing Timeline */}
                  <div className="mt-4">
                    <h4 className="mb-2 text-sm font-semibold">{t('patientDrawer.billingTimeline', { defaultValue: 'Billing Timeline' })}</h4>
                    {(data?.billingTimeline ?? []).length === 0 ? (
                      <div className="text-xs text-[var(--color-text-muted)] text-center py-2">{t('empty.noTimeline', { defaultValue: 'No billing activity yet' })}</div>
                    ) : (
                      <div className="space-y-3">
                        {(data?.billingTimeline ?? []).map((entry, idx) => {
                          const isCharge = entry.type === 'charge';
                          const isPayment = entry.type === 'payment';
                          return (
                            <div key={idx} className="flex gap-3">
                              <div className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${isCharge ? 'bg-red-500' : isPayment ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium truncate">{entry.description}</div>
                                    <div className="text-[10px] text-[var(--color-text-muted)]">
                                      {entry.category}
                                      {entry.payment_method ? ` · ${entry.payment_method}` : ''}
                                    </div>
                                  </div>
                                  <div className={`text-xs font-data font-semibold whitespace-nowrap ${isCharge ? 'text-red-600' : 'text-emerald-600'}`}>
                                    {isCharge ? '+' : '-'}৳{money(entry.amount)}
                                  </div>
                                </div>
                                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                                  {formatDate(entry.created_at)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {/* IPD Admissions Tab */}
              {drawerTab === 'ipd' ? (
                <section className="card p-4">
                  <h3 className="mb-3 font-semibold">{t('patientDrawer.ipdAdmissions', { defaultValue: 'IPD Admissions' })}</h3>
                  {data?.activeAdmission ? (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{t('patientDrawer.activeAdmission', { defaultValue: 'Active Admission' })}</div>
                            <div className="text-sm text-[var(--color-text-muted)]">
                              {data.activeAdmission.admission_no ?? `Admission #${data.activeAdmission.id}`} · {activeAdmissionLabel || t('info.bedNA', { defaultValue: 'Bed N/A' })}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {data.activeAdmission.doctor_name ?? t('info.doctorNA', { defaultValue: 'Doctor N/A' })}
                            </div>
                          </div>
                          <span className="badge badge-success">{t('status.active', { defaultValue: 'Active' })}</span>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-5">
                          <div className="rounded-lg border border-emerald-100 bg-white p-2 text-center">
                            <div className="text-[10px] font-medium uppercase text-emerald-700">{t('patientDrawer.depositReceived', { defaultValue: 'Deposit received' })}</div>
                            <div className="font-data text-sm font-bold text-emerald-700">৳{money(ipdDepositReceived)}</div>
                          </div>
                          <div className="rounded-lg border border-amber-100 bg-white p-2 text-center">
                            <div className="text-[10px] font-medium uppercase text-amber-700">{t('patientDrawer.depositUsed', { defaultValue: 'Deposit used' })}</div>
                            <div className="font-data text-sm font-bold text-amber-700">৳{money(ipdDepositUsed)}</div>
                          </div>
                          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2 text-center">
                            <div className="text-[10px] font-medium uppercase text-emerald-700">{t('patientDrawer.depositBalance', { defaultValue: 'Deposit balance' })}</div>
                            <div className="font-data text-sm font-bold text-emerald-700">৳{money(ipdDepositBalance)}</div>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white p-2 text-center">
                            <div className="text-[10px] font-medium uppercase text-slate-600">{t('patientDrawer.runningCharges', { defaultValue: 'Running charges' })}</div>
                            <div className="font-data text-sm font-bold text-slate-800">৳{money(ipdCurrentCost)}</div>
                          </div>
                          <div className={`rounded-lg border p-2 text-center ${ipdCurrentDue > 0 ? 'border-red-100 bg-red-50' : 'border-emerald-100 bg-emerald-50'}`}>
                            <div className={`text-[10px] font-medium uppercase ${ipdCurrentDue > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                              {ipdCurrentDue > 0 ? t('patientDrawer.netDue', { defaultValue: 'Net due' }) : t('patientDrawer.refundAvailable', { defaultValue: 'Refund available' })}
                            </div>
                            <div className={`font-data text-sm font-bold ${ipdCurrentDue > 0 ? 'text-red-700' : 'text-emerald-700'}`}>৳{money(ipdCurrentDue > 0 ? ipdCurrentDue : ipdRefundAvailable)}</div>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2" data-testid="ipd-admission-actions">
                          <button
                            type="button"
                            className="btn-primary w-full justify-center"
                            onClick={() => {
                              if (onManageIpdBilling && patient) {
                                onManageIpdBilling({ patientId: patient.id, admissionId: data.activeAdmission!.id });
                              } else {
                                // Fallback: navigate to IPD billing page
                                window.open(`${receptionBasePath}/ip-billing?admissionId=${data.activeAdmission!.id}`, '_blank');
                              }
                            }}
                          >
                            <Receipt className="h-4 w-4" /> {t('btn.manageProvisionalBill', { defaultValue: 'Manage Provisional Bill' })}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary w-full justify-center"
                            onClick={() => {
                              setActionMode('discharge');
                              setDrawerTab('overview');
                            }}
                          >
                            {t('btn.discharge', { defaultValue: 'Discharge' })}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--color-text-muted)] text-center py-4">{t('empty.noActiveAdmission', { defaultValue: 'No active admission found.' })}</div>
                  )}

                  {/* Past Admissions */}
                  <div className="mt-4">
                    <h4 className="mb-2 text-sm font-semibold text-[var(--color-text-muted)]">{t('patientDrawer.pastAdmissions', { defaultValue: 'Past Admissions' })}</h4>
                    {(data?.pastAdmissions ?? []).length === 0 ? (
                      <div className="text-xs text-[var(--color-text-muted)] text-center py-2">{t('empty.noPastAdmissions', { defaultValue: 'No past admissions.' })}</div>
                    ) : (
                      <div className="space-y-2">
                        {(data?.pastAdmissions ?? []).map((adm) => (
                          <div key={adm.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium">{adm.admission_no ?? `Admission #${adm.id}`}</div>
                                <div className="text-xs text-[var(--color-text-muted)]">
                                  {adm.ward_name && adm.bed_number ? `${adm.ward_name}-${adm.bed_number}` : t('info.bedNA', { defaultValue: 'Bed N/A' })}
                                  {adm.doctor_name ? ` · ${adm.doctor_name}` : ''}
                                </div>
                              </div>
                              <span className="badge text-xs">{t('status.discharged', { defaultValue: 'Discharged' })}</span>
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)] mt-1">
                              {formatDate(adm.admission_date)}{adm.discharge_date ? ` — ${formatDate(adm.discharge_date)}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {/* Overview Tab Content */}
              {drawerTab === 'overview' ? (
              <>
              {showDueDetails || dueBills.length > 0 || ipdPendingDue > 0 ? (
                <section className="card border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-amber-900 dark:text-amber-200">{t('patientDrawer.outstandingDues', { defaultValue: 'Outstanding dues' })}</h3>
                      <p className="text-xs text-amber-800/80 dark:text-amber-200/75">
                        {dueBills.length + (ipdPendingDue > 0 ? 1 : 0)} item{dueBills.length + (ipdPendingDue > 0 ? 1 : 0) === 1 ? '' : 's'} pending - total ৳{money(dueTotal)}
                      </p>
                    </div>
                    {!activeSession && dueBills.length > 0 ? (
                      <span className="badge badge-warning">{t('status.openCounterFirst', { defaultValue: 'Open counter first' })}</span>
                    ) : null}
                  </div>
                  {dueBills.length === 0 && ipdPendingDue <= 0 ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      {t('patientDrawer.noPendingDues', { defaultValue: 'No pending invoice dues for this patient.' })}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ipdPendingDue > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3 text-sm shadow-sm dark:border-amber-900 dark:bg-slate-900">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="badge text-xs bg-orange-100 text-orange-700">IPD</span>
                              <span className="font-medium">{t('patientDrawer.ipdRunningBill', { defaultValue: 'IPD running bill' })}</span>
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {t('form.pendingCharges', { defaultValue: 'Pending charges' })} ৳{money(data?.ipdPending?.provisionalTotal ?? 0)} - {t('form.bedCharges', { defaultValue: 'Bed charges' })} ৳{money(data?.ipdPending?.bedTotal ?? 0)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-xs text-[var(--color-text-muted)]">{t('info.due', { defaultValue: 'Due' })}</div>
                              <div className="font-data font-semibold text-red-600">৳{money(ipdPendingDue)}</div>
                            </div>
                            <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => {
                              if (onManageIpdBilling && patient && data?.activeAdmission) {
                                onManageIpdBilling({ patientId: patient.id, admissionId: data.activeAdmission.id });
                              } else if (data?.activeAdmission?.id) {
                                window.open(`${receptionBasePath}/ip-billing?admissionId=${data.activeAdmission.id}`, '_blank');
                              }
                            }}>
                              {t('btn.open', { defaultValue: 'Open' })}
                            </button>
                            {data?.activeAdmission?.id ? (
                              <a className="btn-ghost px-3 py-2 text-xs" href={getIpdRunningBillPrintPath(receptionBasePath, data.activeAdmission.id)} target="_blank" rel="noreferrer">
                                {t('btn.print', { defaultValue: 'Print' })}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {dueBills.map((bill) => {
                        const due = getBillDue(bill);
                        const paid = getBillSettledAmount(bill);
                        return (
                          <div key={bill.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3 text-sm shadow-sm dark:border-amber-900 dark:bg-slate-900">
                            <div>
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const billType = (bill as Record<string, unknown>).bill_type as string ?? 'opd';
                                  return (
                                    <span className={`badge text-xs ${billType === 'ipd' ? 'bg-orange-100 text-orange-700' : billType === 'pharmacy' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                      {billType === 'ipd' ? 'IPD' : billType === 'pharmacy' ? 'Pharmacy' : 'OPD'}
                                    </span>
                                  );
                                })()}
                                <span className="font-medium">{bill.invoice_no ?? `Bill #${bill.id}`}</span>
                              </div>
                              <div className="text-xs text-[var(--color-text-muted)]">
                                {formatDate(bill.created_at) ?? t('info.dateNA', { defaultValue: 'Date N/A' })} - {bill.status ?? 'pending'} - Paid ৳{money(paid)} / Total ৳{money(bill.total_amount)}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className="text-xs text-[var(--color-text-muted)]">{t('info.due', { defaultValue: 'Due' })}</div>
                                <div className="font-data font-semibold text-red-600">৳{money(due)}</div>
                              </div>
                              <a
                                href={getBillPrintPath(bill.id)}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-ghost px-3 py-2 text-xs"
                              >
                                {t('btn.print', { defaultValue: 'Print' })}
                              </a>
                              <button
                                type="button"
                                className="btn-primary px-3 py-2 text-xs"
                                disabled={!activeSession}
                                onClick={() => openDuePayment(bill)}
                              >
                                {t('btn.collect', { defaultValue: 'Collect' })}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : null}

              {actionMode === 'payment' && selectedDueBill ? (
                <section className="card p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{t('patientDrawer.collectDuePayment', { defaultValue: 'Collect due payment' })}</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {selectedDueBill.invoice_no ?? `Bill #${selectedDueBill.id}`} - outstanding ৳{money(getBillDue(selectedDueBill))}
                      </p>
                    </div>
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => {
                      setActionMode(null);
                      setSelectedDueBill(null);
                      setDuePaymentAmount('');
                    }}>
                      {t('btn.close', { defaultValue: 'Close' })}
                    </button>
                  </div>
                  <div className="mb-3 rounded-lg bg-[var(--color-bg-secondary)] p-3 text-sm">
                    <div className="flex justify-between"><span>Total</span><span className="font-data">৳{money(selectedDueBill.total_amount)}</span></div>
                    <div className="flex justify-between"><span>{getBillDepositAdjustedAmount(selectedDueBill) > 0 ? 'Cash paid' : 'Already paid'}</span><span className="font-data text-emerald-700">৳{money(getBillCashPaidAmount(selectedDueBill))}</span></div>
                    {getBillDepositAdjustedAmount(selectedDueBill) > 0 ? (
                      <>
                        <div className="flex justify-between"><span>Deposit adjusted</span><span className="font-data text-emerald-700">৳{money(getBillDepositAdjustedAmount(selectedDueBill))}</span></div>
                        <div className="flex justify-between"><span>Already settled</span><span className="font-data text-emerald-700">৳{money(getBillSettledAmount(selectedDueBill))}</span></div>
                      </>
                    ) : null}
                    <div className="flex justify-between font-semibold text-red-600"><span>Due now</span><span className="font-data">৳{money(getBillDue(selectedDueBill))}</span></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">{t('form.paymentAmount', { defaultValue: 'Payment amount' })}</label>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={getBillDue(selectedDueBill)}
                        value={duePaymentAmount}
                        onChange={(event) => setDuePaymentAmount(String(Math.min(getBillDue(selectedDueBill), Math.max(0, Number(event.target.value) || 0))))}
                      />
                    </div>
                    <div>
                      <label className="label">{t('form.paymentMethod', { defaultValue: 'Payment method' })}</label>
                      <select className="input" value={duePaymentMethod} onChange={(event) => {
                        setDuePaymentMethod(event.target.value);
                        if (event.target.value === 'cash') setDuePaymentReference('');
                      }}>
                        <option value="cash">{t('select.cash', { defaultValue: 'Cash' })}</option>
                        <option value="bkash">{t('select.bkash', { defaultValue: 'bKash' })}</option>
                        <option value="nagad">{t('select.nagad', { defaultValue: 'Nagad' })}</option>
                        <option value="card">{t('select.card', { defaultValue: 'Card' })}</option>
                        <option value="bank">{t('select.bank', { defaultValue: 'Bank' })}</option>
                        <option value="cheque">{t('select.cheque', { defaultValue: 'Cheque' })}</option>
                      </select>
                    </div>
                  </div>
                  {requiresPaymentReference(duePaymentMethod, Number(duePaymentAmount)) ? (
                    <div className="mt-3">
                      <label className="label">{t('form.transactionReference', { defaultValue: 'Transaction / reference number' })}</label>
                      <input
                        className="input"
                        value={duePaymentReference}
                        onChange={(event) => setDuePaymentReference(event.target.value)}
                        placeholder={t('placeholder.transactionReference', { defaultValue: 'bKash/Nagad/card/bank reference' })}
                      />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="btn-primary mt-3 w-full justify-center"
                    disabled={duePaymentMutation.isPending || !activeSession || Number(duePaymentAmount) <= 0 || Number(duePaymentAmount) > getBillDue(selectedDueBill)}
                    onClick={() => {
                      if (requiresPaymentReference(duePaymentMethod, Number(duePaymentAmount)) && !duePaymentReference.trim()) {
                        toast.error('Transaction/reference number is required for non-cash payments.');
                        return;
                      }
                      duePaymentMutation.mutate({
                        billId: selectedDueBill.id,
                        amount: Number(duePaymentAmount),
                        type: 'due',
                        paymentMethod: duePaymentMethod,
                        externalTransactionId: normalizeExternalTransactionId(duePaymentMethod, Number(duePaymentAmount), duePaymentReference),
                        idempotencyKey: `drawer-due-${selectedDueBill.id}-${crypto.randomUUID()}`,
                      });
                    }}
                  >
                    {duePaymentMutation.isPending ? t('btn.collecting', { defaultValue: 'Collecting...' }) : t('btn.collectPayment', { defaultValue: 'Collect payment' })}
                  </button>
                  {!activeSession ? <div className="mt-2 text-xs text-amber-700">{t('info.counterRequired', { defaultValue: 'Activate a billing counter before collecting payments.' })}</div> : null}
                </section>
              ) : null}

              {actionMode === 'bill' ? (
                <section className="card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{t('patientDrawer.quickBill', { defaultValue: 'Quick bill' })}</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('patientDrawer.quickBillDesc', { defaultValue: 'Add service, test, procedure, or nursing item without leaving this drawer.' })}</p>
                    </div>
                    <span className={`badge ${activeSession ? 'badge-success' : 'badge-warning'}`}>
                      {activeSession ? t('status.counterActive', { defaultValue: 'Counter active' }) : t('status.openCounterFirst', { defaultValue: 'Open counter first' })}
                    </span>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                    {/* Left: Service catalog + deposit */}
                    <div className="space-y-3">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--color-text-muted)]" />
                        <input className="input pl-9" value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} placeholder={t('placeholder.searchItemExamples', { defaultValue: 'Search test, dressing, injection, cannula...' })} />
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)]">
                        {servicesLoading ? <div className="p-3 text-sm text-[var(--color-text-muted)]">{t('empty.loadingServices', { defaultValue: 'Loading services...' })}</div> : null}
                        {!servicesLoading && services.length === 0 ? <div className="p-3 text-sm text-[var(--color-text-muted)]">{t('empty.noServicesFound', { defaultValue: 'No service found.' })}</div> : null}
                        {services.map((service) => (
                          <button
                            key={service.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--color-bg-secondary)]"
                            onClick={() => addToCart(service)}
                          >
                            <span>
                              <span className="block font-medium">{service.item_name}</span>
                              <span className="text-xs text-[var(--color-text-muted)]">{service.department_name ?? service.item_code ?? t('info.service', { defaultValue: 'Service' })}</span>
                            </span>
                            <span className="flex items-center gap-2 font-data font-semibold">
                              ৳{money(service.price)}
                              <Plus className="h-3.5 w-3.5" />
                            </span>
                          </button>
                        ))}
                      </div>
                      {depositBalance > 0 ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span>{t('form.availableDeposit', { defaultValue: 'Available deposit' })}</span>
                            <span className="font-data font-semibold text-emerald-600">৳{money(depositBalance)}</span>
                          </div>
                          {cartTotal > 0 ? (
                            <button
                              type="button"
                              className="mt-2 text-xs font-medium text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={billMode === 'credit'}
                              onClick={() => setDepositDeducted(String(Math.min(depositBalance, cartTotal)))}
                            >
                              {t('btn.useMaximumAvailable', { defaultValue: 'Use maximum available' })}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {/* Right: Billing cart + controls */}
                    <div>
                      {cart.length > 0 ? (
                        <div className="space-y-2">
                          {cart.map((line) => {
                            const gross = Number(line.price ?? 0) * line.quantity;
                            return (
                              <div key={line.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                                <div className="min-w-0 flex-1">
                                  <span className="block truncate font-medium">{line.item_name}</span>
                                  <span className="text-xs text-[var(--color-text-muted)]">৳{money(line.price)} × {line.quantity}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-data font-semibold whitespace-nowrap">৳{money(Math.max(0, gross - line.discountAmount))}</span>
                                  <button type="button" className="btn-ghost p-1 text-red-600" onClick={() => setCart((current) => current.filter((item) => item.id !== line.id))}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}

                          <div>
                            <label className="label">{t('form.referringDoctor', { defaultValue: 'Referring doctor' })}</label>
                            <select
                              className="input"
                              value={referringDoctorId}
                              onChange={(event) => {
                                setReferringDoctorTouched(true);
                                setReferringDoctorId(Number(event.target.value) || '');
                              }}
                            >
                              <option value="">{t('select.none', { defaultValue: 'None' })}</option>
                              {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.specialty ? ` - ${doctor.specialty}` : ''}</option>)}
                            </select>
                            {!referringDoctorTouched && referringDoctorId ? (
                              <div className="mt-1 text-xs text-[var(--color-text-muted)]">{t('info.autoSelectedOpd', { defaultValue: 'Using today visit doctor by default.' })}</div>
                            ) : null}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <div>
                              <label className="label">{t('form.billMode', { defaultValue: 'Bill mode' })}</label>
                              <select className="input" value={billMode} onChange={(event) => handleBillModeChange(event.target.value as 'paid' | 'credit')}>
                                <option value="paid">{t('btn.collectNow', { defaultValue: 'Collect now' })}</option>
                                <option value="credit">{t('btn.dueCredit', { defaultValue: 'Due / credit' })}</option>
                              </select>
                            </div>
                            {depositBalance > 0 ? (
                              <div>
                                <label className="label">{t('form.useDeposit', { defaultValue: 'Deposit use' })}</label>
                                <input
                                  className="input"
                                  type="number"
                                  min={0}
                                  max={Math.min(depositBalance, afterDiscount)}
                                  value={depositDeducted}
                                  onChange={(event) => setDepositDeducted(String(Math.min(depositBalance, afterDiscount, Math.max(0, Number(event.target.value) || 0))))}
                                  disabled={billMode === 'credit'}
                                  placeholder={`Available ৳${money(depositBalance)}`}
                                />
                              </div>
                            ) : null}
                            <div>
                              <label className="label">{t('form.paidNow', { defaultValue: 'Paid amount' })}</label>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                max={payableNow}
                                value={paidAmount}
                                onChange={(event) => setPaidAmount(String(Math.min(payableNow, Math.max(0, Number(event.target.value) || 0))))}
                                disabled={billMode === 'credit'}
                                placeholder={String(payableNow)}
                              />
                            </div>
                          </div>
                          <div>
                            <label className="label">{t('form.paymentMethod', { defaultValue: 'Payment method' })}</label>
                            <select className="input" value={paymentMethod} onChange={(event) => {
                              setPaymentMethod(event.target.value);
                              if (event.target.value === 'cash') setBillPaymentReference('');
                            }} disabled={billMode === 'credit'}>
                              <option value="cash">{t('select.cash', { defaultValue: 'Cash' })}</option>
                              <option value="bkash">{t('select.bkash', { defaultValue: 'bKash' })}</option>
                              <option value="nagad">{t('select.nagad', { defaultValue: 'Nagad' })}</option>
                              <option value="card">{t('select.card', { defaultValue: 'Card' })}</option>
                              <option value="bank">{t('select.bank', { defaultValue: 'Bank' })}</option>
                              <option value="cheque">{t('select.cheque', { defaultValue: 'Cheque' })}</option>
                            </select>
                          </div>
                          {requiresPaymentReference(paymentMethod, cashPaidNow) ? (
                            <div>
                              <label className="label">{t('form.transactionReference', { defaultValue: 'Transaction / reference number' })}</label>
                              <input
                                className="input"
                                value={billPaymentReference}
                                onChange={(event) => setBillPaymentReference(event.target.value)}
                                placeholder={t('placeholder.transactionReference', { defaultValue: 'bKash/Nagad/card/bank reference' })}
                              />
                            </div>
                          ) : null}
                          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 text-xs">
                            <div className="mb-2 font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</div>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <input className="input h-8 bg-white" value={schemeCodeInput} onChange={(event) => { setSchemeCodeInput(event.target.value); setSchemePreview(null); }} placeholder="Scheme code" />
                              <input className="input h-8 bg-white" value={memberCodeInput} onChange={(event) => { setMemberCodeInput(event.target.value); setSchemePreview(null); }} placeholder="Member code" />
                              <button type="button" className="btn-secondary h-8 justify-center px-2 text-xs" disabled={schemePreviewMutation.isPending || cartTotal <= 0 || !patient} onClick={submitSchemeCheck}>
                                {schemePreviewMutation.isPending ? 'Checking…' : 'Check'}
                              </button>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
                              <span>{schemePreview?.eligible ? `${schemePreview.scheme_name ?? 'Scheme'} · ${schemePreview.discount_value}% · suggested ৳${money(suggestedSchemeDiscount)}` : schemePreview?.blockers?.join(', ') || 'Optional: check staff/VIP/member benefit for drawer bill.'}</span>
                              <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!schemePreview?.eligible || suggestedSchemeDiscount <= 0} onClick={applySchemeDiscount}>Apply</button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="label whitespace-nowrap">{t('form.discount', { defaultValue: 'Discount' })}</label>
                            <div className="flex items-center gap-1 flex-1">
                              <input
                                className="input w-20"
                                type="number"
                                min={0}
                                max={cartTotal}
                                value={discountAmount}
                                onChange={(event) => {
                                  const val = Math.min(cartTotal, Math.max(0, Number(event.target.value) || 0));
                                  setDiscountAmount(String(val));
                                  setDiscountPercent(cartTotal > 0 ? String(Math.round(val / cartTotal * 100)) : '0');
                                }}
                                placeholder="৳0"
                              />
                              <span className="text-xs text-[var(--color-text-muted)]">{t('common.or', { defaultValue: 'or' })}</span>
                              <input
                                className="input w-16"
                                type="number"
                                min={0}
                                max={100}
                                value={discountPercent}
                                onChange={(event) => {
                                  const pct = Math.min(100, Math.max(0, Number(event.target.value) || 0));
                                  setDiscountPercent(String(pct));
                                  setDiscountAmount(String(Math.round(cartTotal * pct / 100)));
                                }}
                                placeholder="%"
                              />
                            </div>
                          </div>
                          {requiresDiscountByName ? (
                            <div>
                              <label className="label">{t('form.discountApprovedBy', { defaultValue: 'Discount approved / referred by' })}</label>
                              <input
                                className="input"
                                value={discountByName}
                                onChange={(event) => setDiscountByName(event.target.value)}
                                placeholder={t('placeholder.discountApprovedBy', { defaultValue: 'Manager, director, doctor, or scheme member' })}
                              />
                            </div>
                          ) : null}
                          {Number(discountAmount || 0) > 0 && !schemePreview?.eligible ? (
                            <DiscountAllocationEditor
                              totalDiscount={Number(discountAmount || 0)}
                              enabled={discountAllocationEnabled}
                              rows={discountAllocationRows}
                              compact
                              context={{
                                selectedDoctorId: referringDoctorId ? Number(referringDoctorId) : null,
                                doctorAvailableWaiverAmount,
                                eligibleCommissionAmount: doctorWaiverQuote?.eligibleCommissionAmount,
                                performerReserveAmount: doctorWaiverQuote?.performerReserveAmount,
                                protectedCommissionAmount: doctorWaiverQuote?.protectedCommissionAmount,
                                payableCommissionAmount: doctorWaiverQuote?.payableCommissionAmount,
                                doctorWaiverLoading: doctorWaiverPreviewPending,
                                doctorWaiverPreviewFailed,
                              }}
                              onEnabledChange={(enabled) => {
                                setDiscountAllocationEnabled(enabled);
                                if (enabled && discountAllocationRows.length === 0) {
                                  setDiscountAllocationRows(createDefaultDiscountAllocations(Number(discountAmount || 0), {
                                    selectedDoctorId: referringDoctorId ? Number(referringDoctorId) : null,
                                    doctorAvailableWaiverAmount,
                                    doctorWaiverLoading: doctorWaiverPreviewPending,
                                    doctorWaiverPreviewFailed,
                                  }));
                                }
                              }}
                              onRowsChange={setDiscountAllocationRows}
                              onQuickSourceSelected={(reason) => {
                                setDiscountSourceIntent(reason);
                                if (reason === 'doctor_commission_waiver' && doctorWaiverPreviewMutation.isError) {
                                  setDoctorWaiverVerifiedPreviewKey(null);
                                  doctorWaiverPreviewMutation.reset();
                                }
                              }}
                            />
                          ) : null}
                          <div className="rounded-lg bg-[var(--color-bg-secondary)] p-3 text-sm">
                            <div className="flex justify-between"><span>{t('form.total', { defaultValue: 'Total' })}</span><span className="font-data">৳{money(cartTotal)}</span></div>
                            {Number(discountAmount || 0) > 0 ? <div className="flex justify-between"><span>{t('form.discount', { defaultValue: 'Discount' })}</span><span className="font-data text-red-600">-৳{money(discountAmount)}</span></div> : null}
                            {Number(discountAmount || 0) > 0 ? <div className="flex justify-between"><span>{t('form.afterDiscount', { defaultValue: 'After Discount' })}</span><span className="font-data">৳{money(afterDiscount)}</span></div> : null}
                            {depositApplied > 0 ? (
                              <div className="flex justify-between"><span>{t('form.depositAdjusted', { defaultValue: 'Deposit adjusted' })}</span><span className="font-data">৳{money(depositApplied)}</span></div>
                            ) : null}
                            <div className="flex justify-between"><span>{t('form.paidNow', { defaultValue: 'Paid now' })}</span><span className="font-data">৳{money(cashPaidNow)}</span></div>
                            <div className={`flex justify-between font-semibold ${dueAfterPayment > 0 ? 'text-red-600' : ''}`}><span>{t('form.remainingDue', { defaultValue: 'Remaining due' })}</span><span className="font-data">৳{money(dueAfterPayment)}</span></div>
                          </div>
                          <button
                            type="button"
                            className="btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={invoiceMutation.isPending || doctorWaiverPaymentBlocked || cart.length === 0 || !activeSession}
                            onClick={() => {
                              if (!patient) return;
                              const totalDiscount = Number(discountAmount || 0);
                              if (requiresDiscountByName && !discountByName.trim()) {
                                toast.error('Discount referred by name is required when discount is above 20%.');
                                return;
                              }
                              if (requiresPaymentReference(paymentMethod, cashPaidNow) && !billPaymentReference.trim()) {
                                toast.error('Transaction/reference number is required for non-cash payments.');
                                return;
                              }
                              if (doctorWaiverPreviewPending) {
                                toast.error('Doctor waiver verification is still in progress.');
                                return;
                              }
                              if (doctorWaiverPreviewFailed) {
                                toast.error('Doctor waiver could not be verified. Select Doctor waiver again to retry.');
                                return;
                              }
                              if (doctorWaiverPaymentBlocked) {
                                toast.error('Doctor waiver must be verified before payment.');
                                return;
                              }
                              if (!schemePreview?.eligible && totalDiscount > 0 && discountAllocationEnabled
                                && !hasBalancedDiscountAllocations(totalDiscount, discountAllocationRows)) {
                                toast.error('Discount source amounts must match the total discount.');
                                return;
                              }
                              if (!schemePreview?.eligible
                                && discountAllocationRows.some((row) => row.reason === 'doctor_commission_waiver')
                                && !referringDoctorId) {
                                toast.error('Select the referring doctor before applying Doctor Waiver.');
                                return;
                              }
                              invoiceMutation.mutate({
                                patientId: patient.id,
                                createWalkInVisit: true,
                                billMode,
                                referringDoctorId: referringDoctorId ? Number(referringDoctorId) : undefined,
                                discountByName: discountByName.trim() || undefined,
                                discountSourceIntent: schemePreview?.eligible && totalDiscount > 0
                                  ? reasonForDiscountSource(schemePreview.allocation_type)
                                  : discountSourceIntent ?? undefined,
                                idempotencyKey: invoiceAttemptKey,
                                items: cartLinesWithGlobalDiscount().map((line) => ({
                                  serviceItemId: line.id,
                                  quantity: line.quantity,
                                  discountAmount: line.discountAmount,
                                })),
                                discountAmount: Number(discountAmount || 0),
                                schemeApplication: schemePreview?.eligible && Number(discountAmount || 0) > 0 ? {
                                  schemeId: schemePreview.scheme_id ?? undefined,
                                  schemeCode: (schemePreview.scheme_code ?? schemeCodeInput.trim()) || undefined,
                                  memberCode: (schemePreview.matched_member_code ?? memberCodeInput.trim()) || undefined,
                                  memberId: schemePreview.matched_member_id ?? undefined,
                                  serviceCategory: schemePreview.service_category ?? 'patient_drawer_quick_bill',
                                  allocationType: reasonForDiscountSource(schemePreview.allocation_type),
                                  suggestedDiscount: schemePreview.suggested_discount,
                                } : undefined,
                                discountAllocations: schemePreview?.eligible && totalDiscount > 0
                                  ? [{ reason: reasonForDiscountSource(schemePreview.allocation_type), amount: totalDiscount, note: 'Scheme: ' + (schemePreview.scheme_name ?? 'Benefit') }]
                                  : getDiscountAllocationPayload(totalDiscount, discountAllocationEnabled, discountAllocationRows),
                                payment: {
                                  paymentMethod,
                                  paidAmount: cashPaidNow,
                                  depositDeducted: depositApplied,
                                  creditAmount: dueAfterPayment,
                                  externalTransactionId: normalizeExternalTransactionId(paymentMethod, cashPaidNow, billPaymentReference),
                                },
                              });
                            }}
                          >
                            {invoiceMutation.isPending ? t('btn.creating', { defaultValue: 'Creating bill...' }) : t('btn.confirmBill', { defaultValue: 'Confirm bill' })}
                          </button>
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] p-6 text-sm text-[var(--color-text-muted)]">
                          {t('empty.selectItemsToAdd', { defaultValue: 'Add services from the left panel to create a bill' })}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {actionMode === 'deposit' ? (
                <section className="card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{t('btn.collectDeposit', { defaultValue: 'Collect deposit' })}</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('patientDrawer.currentBalance', { defaultValue: 'Current balance' })} ৳{money(depositBalance)}</p>
                    </div>
                    <WalletCards className="h-5 w-5 text-[var(--color-primary)]" />
                  </div>
                  <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm">
                    <div className="flex justify-between"><span>{t('patientDrawer.previousDeposit', { defaultValue: 'Previous deposit' })}</span><span className="font-data">৳{money(depositBalance)}</span></div>
                    <div className="flex justify-between"><span>{t('patientDrawer.receivingNow', { defaultValue: 'Receiving now' })}</span><span className="font-data text-emerald-700">৳{money(depositAmount || 0)}</span></div>
                    <div className="mt-2 flex justify-between border-t border-[var(--color-border)] pt-2 font-semibold">
                      <span>{t('patientDrawer.balanceAfterCollection', { defaultValue: 'Balance after collection' })}</span>
                      <span className="font-data">৳{money(depositAfterCollection)}</span>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">{t('form.amount', { defaultValue: 'Amount' })} *</label>
                      <input className="input" type="number" min={1} value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} />
                    </div>
                    <div>
                      <label className="label">{t('form.paymentMethodLabel', { defaultValue: 'Method' })}</label>
                      <select className="input" value={depositMethod} onChange={(event) => setDepositMethod(event.target.value)}>
                        <option value="cash">{t('select.cash', { defaultValue: 'Cash' })}</option>
                        <option value="bkash">{t('select.bkash', { defaultValue: 'bKash' })}</option>
                        <option value="nagad">{t('select.nagad', { defaultValue: 'Nagad' })}</option>
                        <option value="card">{t('select.card', { defaultValue: 'Card' })}</option>
                        <option value="bank">{t('select.bank', { defaultValue: 'Bank' })}</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">{t('form.remarks', { defaultValue: 'Remarks' })}</label>
                      <input className="input" value={depositRemarks} onChange={(event) => setDepositRemarks(event.target.value)} placeholder={t('placeholder.depositRemarks', { defaultValue: 'Admission advance, IPD deposit...' })} />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary mt-3 w-full justify-center"
                    disabled={depositMutation.isPending || Number(depositAmount) <= 0 || !activeSession}
                    onClick={() => {
                      if (!patient) return;
                      depositMutation.mutate({
                        patient_id: patient.id,
                        amount: Number(depositAmount),
                        payment_method: depositMethod,
                        remarks: depositRemarks || undefined,
                        idempotencyKey: `drawer-deposit-${patient.id}-${crypto.randomUUID()}`,
                      });
                    }}
                  >
                    {depositMutation.isPending ? t('btn.collecting', { defaultValue: 'Collecting...' }) : t('btn.collectDeposit', { defaultValue: 'Collect deposit' })}
                  </button>
                  {!activeSession ? <div className="mt-2 text-xs text-amber-700">{t('info.counterRequiredForDeposit', { defaultValue: 'Activate a billing counter before collecting deposits.' })}</div> : null}
                </section>
              ) : null}

              {/* Discharge Modal */}
              {actionMode === 'discharge' && data?.activeAdmission ? (
                <DischargeModal
                  admission={{
                    admissionId: data.activeAdmission.id,
                    admissionNo: data.activeAdmission.admission_no,
                    patientName: patient?.name,
                    patientId: patient?.id ?? 0,
                    wardName: data.activeAdmission.ward_name,
                    bedNumber: data.activeAdmission.bed_number,
                  }}
                  financial={buildDischargeFinancial({
                    pendingSummary: ipdPendingData?.summary ?? null,
                    billingStatus: null,
                    financialClearance: ipdPendingData?.financial_clearance ?? null,
                  })}
                  billPrintBasePath={basePath}
                  onClose={() => setActionMode(null)}
                  onSuccess={() => {
                    setActionMode(null);
                    queryClient.invalidateQueries({ queryKey: ['reception', 'patient-context', patientId] });
                  }}
                />
              ) : null}

              {((actionMode === 'cancelRequest' || actionMode === 'refundRequest') && billReviewTarget) || (actionMode === 'paymentCorrectionRequest' && paymentReviewTarget) ? (
                <section className="card overflow-hidden border-amber-200 bg-amber-50/60 p-0 dark:border-amber-900 dark:bg-amber-950/20">
                  <div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-white/70 p-4 dark:border-amber-900 dark:bg-slate-900/70">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        {t('patientDrawer.adminReviewRequired', { defaultValue: 'Admin review required' })}
                      </p>
                      <h3 className="mt-1 font-semibold text-[var(--color-text-primary)]">
                        {actionMode === 'refundRequest'
                          ? t('patientDrawer.billRefundRequestTitle', { defaultValue: 'Request bill refund' })
                          : actionMode === 'cancelRequest'
                            ? t('patientDrawer.billCancelRequestTitle', { defaultValue: 'Request invoice cancellation' })
                            : t('patientDrawer.paymentCorrectionTitle', { defaultValue: 'Request payment correction' })}
                      </h3>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {actionMode === 'refundRequest'
                          ? t('patientDrawer.billRefundRequestHelp', { defaultValue: 'Paid bills are not cancelled directly. Send a refund request so admin/accounts can review and create a credit note.' })
                          : actionMode === 'cancelRequest'
                            ? t('patientDrawer.billCancelRequestHelp', { defaultValue: 'Reception will only send a request. Admin/accounts can approve or reject it.' })
                            : t('patientDrawer.paymentCorrectionHelp', { defaultValue: 'Use this when an invoice was marked paid by mistake. Approval will reverse the receipt and make the bill unpaid/due again.' })}
                      </p>
                    </div>
                    <button type="button" className="btn-ghost p-1.5" onClick={closeReviewPanel} aria-label="Close review request">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="rounded-xl border border-amber-100 bg-white p-3 text-sm dark:border-amber-900 dark:bg-slate-900">
                      {(actionMode === 'cancelRequest' || actionMode === 'refundRequest') && billReviewTarget ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-[var(--color-text-primary)]">{billReviewTarget.invoice_no ?? `Bill #${billReviewTarget.id}`}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{formatDate(billReviewTarget.created_at) ?? t('info.dateNA', { defaultValue: 'Date N/A' })} · {billReviewTarget.status ?? 'pending'} · Paid ৳{money(getBillSettledAmount(billReviewTarget))}</div>
                            {actionMode === 'refundRequest' ? <div className="mt-1 text-xs text-amber-700">{t('patientDrawer.refundRequestAmount', { defaultValue: 'Selected refund amount' })}: ৳{money(selectedRefundTotal)}</div> : null}
                          </div>
                          <div className="font-data text-lg font-semibold text-[var(--color-text-primary)]">৳{money(billReviewTarget.total_amount)}</div>
                        </div>
                      ) : paymentReviewTarget ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-[var(--color-text-primary)]">{paymentReviewTarget.receipt_no ?? `Payment #${paymentReviewTarget.id}`}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{formatDate(paymentReviewTarget.date ?? paymentReviewTarget.created_at) ?? t('info.dateNA', { defaultValue: 'Date N/A' })} · {paymentReviewTarget.invoice_no ?? t('info.invoiceNA', { defaultValue: 'Invoice N/A' })} · {paymentReviewTarget.payment_method ?? 'cash'}</div>
                          </div>
                          <div className="font-data text-lg font-semibold text-[var(--color-text-primary)]">৳{money(paymentReviewTarget.amount)}</div>
                        </div>
                      ) : null}
                    </div>
                    {actionMode === 'paymentCorrectionRequest' ? (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200">
                            <AlertTriangle className="h-4 w-4" />
                          </span>
                          <div>
                            <div className="font-semibold">{t('patientDrawer.paymentVoidConsequenceTitle', { defaultValue: 'What approval will do' })}</div>
                            <div className="mt-1 text-xs leading-5 text-red-800 dark:text-red-200">
                              {t('patientDrawer.paymentVoidConsequence', { defaultValue: 'Approval reverses this receipt, makes the invoice unpaid/due again, and reconciles affected commission and financial records.' })}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {actionMode === 'refundRequest' ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <RefundModeCard
                            mode="full"
                            selected={refundMode === 'full'}
                            tone="amber"
                            icon={Receipt}
                            title={t('patientDrawer.fullRefund', { defaultValue: 'Full refund' })}
                            description={t('patientDrawer.fullRefundShortHelp', { defaultValue: 'Return the full refundable amount. Eligible items are selected automatically.' })}
                            onSelect={() => {
                              setRefundMode('full');
                              setRefundSelections({});
                              setManualRefundAmount('');
                              setRefundAllocationOverrides({});
                            }}
                          />
                          <RefundModeCard
                            mode="partial"
                            selected={refundMode === 'partial'}
                            tone="blue"
                            icon={ListChecks}
                            title={t('patientDrawer.partialRefund', { defaultValue: 'Item-based refund' })}
                            description={t('patientDrawer.partialRefundShortHelp', { defaultValue: 'Choose the services or quantities that should be refunded.' })}
                            onSelect={() => {
                              setRefundMode('partial');
                              setRefundSelections({});
                              setManualRefundAmount('');
                              setRefundAllocationOverrides({});
                            }}
                          />
                          <RefundModeCard
                            mode="amount"
                            selected={refundMode === 'amount'}
                            tone="violet"
                            icon={CircleDollarSign}
                            title={t('patientDrawer.amountRefund', { defaultValue: 'Amount-based refund' })}
                            description={t('patientDrawer.amountRefundShortHelp', { defaultValue: 'Enter a specific amount. The system allocates it across eligible items.' })}
                            onSelect={() => {
                              setRefundMode('amount');
                              setRefundSelections({});
                              setManualRefundAmount('');
                              setRefundAllocationOverrides({});
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <CashMetricCard
                            metric="expected"
                            tone="blue"
                            icon={WalletCards}
                            label={t('patientDrawer.expectedCash', { defaultValue: 'Expected cash' })}
                            amount={`৳${money(activeSession?.expectedCash ?? 0)}`}
                          />
                          <CashMetricCard
                            metric="held"
                            tone="amber"
                            icon={ShieldAlert}
                            label={t('patientDrawer.heldRefunds', { defaultValue: 'Held refunds' })}
                            amount={`৳${money(activeSession?.heldRefundCash ?? 0)}`}
                          />
                          <CashMetricCard
                            metric="available"
                            tone="emerald"
                            icon={Banknote}
                            label={t('patientDrawer.availableCash', { defaultValue: 'Available cash' })}
                            amount={`৳${money(availableCounterCash)}`}
                          />
                        </div>

                        {refundMode === 'amount' ? (
                          <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900 dark:bg-violet-950/25">
                            <div className="flex items-start gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200">
                                <CircleDollarSign className="h-5 w-5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <label className="block text-sm font-bold text-violet-950 dark:text-violet-100" htmlFor="manual-refund-amount">
                                  {t('patientDrawer.manualRefundAmount', { defaultValue: 'Refund amount' })} *
                                </label>
                                <div className="mt-1 text-xs leading-5 text-violet-800/80 dark:text-violet-200/80">
                                  {t('patientDrawer.amountRefundHelp', { defaultValue: `Enter less than ৳${money(refundBillTotal)}. For the whole bill, select Full refund.` })}
                                </div>
                                <div className="relative mt-3">
                                  <span className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center justify-center border-r border-violet-200 text-lg font-bold text-violet-700 dark:border-violet-900 dark:text-violet-200">৳</span>
                                  <input
                                    id="manual-refund-amount"
                                    aria-label={t('patientDrawer.manualRefundAmount', { defaultValue: 'Refund amount' })}
                                    className="input h-12 border-violet-200 bg-white pl-16 text-right font-data text-xl font-bold focus:border-violet-400 focus:ring-violet-200 dark:border-violet-900 dark:bg-slate-900"
                                    type="number"
                                    min="0.01"
                                    max={refundBillTotal >= 0.02 ? Math.round((refundBillTotal - 0.01) * 100) / 100 : undefined}
                                    step="0.01"
                                    value={manualRefundAmount}
                                    onChange={(event) => {
                                      setManualRefundAmount(event.target.value);
                                      setRefundAllocationOverrides({});
                                    }}
                                    placeholder="0.00"
                                  />
                                </div>
                                {amountRefundRequiresFullFlow ? (
                                  <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span>{t('patientDrawer.amountRefundRequiresFullFlow', { defaultValue: `Amount-based partial refund must be less than ৳${money(refundBillTotal)}. Use Full refund for the entire bill.` })}</span>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                                    {t('patientDrawer.amountRefundAllocation', { defaultValue: 'Automatic item allocation' })}
                                  </div>
                                  <div className="text-xs text-[var(--color-text-muted)]">
                                    {t('patientDrawer.amountRefundAllocationHelp', { defaultValue: 'The system distributes the amount proportionally. You can adjust the amounts, but the total must match the refund.' })}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="btn-secondary px-2 py-1 text-xs"
                                  onClick={() => setRefundAllocationOverrides({})}
                                >
                                  {t('patientDrawer.resetAutomaticAllocation', { defaultValue: 'Reset automatic' })}
                                </button>
                              </div>

                              {manualRefundValue <= 0 ? (
                                <div className="mt-3 text-xs text-[var(--color-text-muted)]">
                                  {t('patientDrawer.enterAmountForAllocation', { defaultValue: 'Enter a refund amount to generate the item allocation.' })}
                                </div>
                              ) : amountRefundAllocationRows.length === 0 ? (
                                <div className="mt-3 text-xs font-medium text-red-600">
                                  {t('patientDrawer.noAllocationItems', { defaultValue: 'No refundable item balance is available for allocation.' })}
                                </div>
                              ) : (
                                <div className="mt-3 space-y-2">
                                  {amountRefundAllocationRows.map((row) => (
                                    <div key={`amount-allocation-${row.item.id}`} className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-white p-2 sm:grid-cols-[1fr_130px] sm:items-center dark:bg-slate-900">
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{row.item.description}</div>
                                        <div className="text-xs text-[var(--color-text-muted)]">
                                          {row.item.item_category.replace(/_/g, ' ')} · {t('patientDrawer.refundableBalance', { defaultValue: 'Refundable' })} ৳{money(row.balance)} · {row.allocationSource === 'auto' ? 'Auto' : 'Adjusted'}
                                        </div>
                                      </div>
                                      <input
                                        className="input h-9 py-1 text-right font-data text-sm"
                                        type="number"
                                        min="0"
                                        max={row.balance}
                                        step="0.01"
                                        aria-label={`Refund allocation for ${row.item.description}`}
                                        value={Object.prototype.hasOwnProperty.call(refundAllocationOverrides, row.item.id)
                                          ? refundAllocationOverrides[row.item.id]
                                          : row.allocatedRefundAmount.toFixed(2)}
                                        onChange={(event) => setRefundAllocationOverrides((current) => ({
                                          ...current,
                                          [row.item.id]: event.target.value,
                                        }))}
                                      />
                                    </div>
                                  ))}
                                  <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold ${amountRefundAllocationInvalid ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
                                    <span>{t('patientDrawer.allocatedTotal', { defaultValue: 'Allocated total' })}</span>
                                    <span className="font-data">৳{money(amountRefundAllocationTotal)} / ৳{money(manualRefundValue)}</span>
                                  </div>
                                </div>
                              )}

                              <div className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                                {t('patientDrawer.amountRefundNoItems', { defaultValue: 'This allocation changes financial collection and commission; invoice-item quantities and clinical status remain unchanged.' })}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {refundMode !== 'amount' ? (
                        <div className="rounded-xl border border-amber-100 bg-white p-3 dark:border-amber-900 dark:bg-slate-900">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">{t('patientDrawer.refundItems', { defaultValue: 'Refund items' })}</div>
                              <div className="text-xs text-[var(--color-text-muted)]">
                                {refundMode === 'full'
                                  ? t('patientDrawer.allEligibleSelected', { defaultValue: 'All eligible items are selected automatically.' })
                                  : t('patientDrawer.selectItems', { defaultValue: 'Select only services that were not provided.' })}
                              </div>
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">{activeSession?.counterName ?? activeSession?.counter_name ?? t('patientDrawer.activeCounter', { defaultValue: 'Active counter' })}</div>
                          </div>

                          {refundItemsLoading ? (
                            <div className="py-4 text-center text-sm text-[var(--color-text-muted)]">{t('loading', { ns: 'common', defaultValue: 'Loading...' })}</div>
                          ) : refundableBillItems.length === 0 ? (
                            <div className="py-4 text-center text-sm text-[var(--color-text-muted)]">{t('patientDrawer.noRefundableItems', { defaultValue: 'No refundable invoice items found.' })}</div>
                          ) : (
                            <div className="space-y-2">
                              {refundableBillItems.map((item) => {
                                const partialQuantity = Number(refundSelections[item.id] ?? 0);
                                const selected = refundMode === 'full'
                                  ? item.eligible && Number(item.available_qty ?? 0) > 0
                                  : partialQuantity > 0;
                                const selectedQuantity = refundMode === 'full' ? Number(item.available_qty ?? 0) : partialQuantity;
                                const lineAmount = Math.round(Number(item.refundable_unit_amount ?? 0) * selectedQuantity * 100) / 100;
                                return (
                                  <div key={item.id} className={`rounded-xl border p-3 transition ${!item.eligible ? 'border-slate-200 bg-slate-50 opacity-75 dark:border-slate-800 dark:bg-slate-950/40' : selected ? refundMode === 'full' ? 'border-amber-300 bg-amber-50/80 ring-1 ring-amber-200 dark:border-amber-800 dark:bg-amber-950/25 dark:ring-amber-900' : 'border-blue-300 bg-blue-50/80 ring-1 ring-blue-200 dark:border-blue-800 dark:bg-blue-950/25 dark:ring-blue-900' : 'border-[var(--color-border)] bg-white hover:border-blue-200 hover:bg-blue-50/30 dark:bg-slate-900 dark:hover:bg-blue-950/10'}`}>
                                    <div className="flex items-start gap-3">
                                      <input
                                        type="checkbox"
                                        className={`mt-0.5 h-5 w-5 shrink-0 ${refundMode === 'full' ? 'accent-amber-600' : 'accent-blue-600'}`}
                                        aria-label={`Select ${item.description} for refund`}
                                        checked={selected}
                                        disabled={!item.eligible || refundMode === 'full'}
                                        onChange={(event) => {
                                          setRefundSelections((current) => ({
                                            ...current,
                                            [item.id]: event.target.checked ? 1 : 0,
                                          }));
                                        }}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                          <div>
                                            <div className="font-medium text-[var(--color-text-primary)]">{item.description}</div>
                                            <div className="text-xs text-[var(--color-text-muted)]">
                                              {item.clinical_status ?? 'pending'} · {t('patientDrawer.availableQuantity', { defaultValue: 'Available' })} {item.available_qty}
                                            </div>
                                          </div>
                                          <div className="font-data text-sm font-semibold">৳{money(lineAmount)}</div>
                                        </div>
                                        {!item.eligible && item.block_reason ? (
                                          <div className="mt-1 text-xs text-red-600">{item.block_reason}</div>
                                        ) : null}
                                        {refundMode === 'partial' && item.eligible && selected ? (
                                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-white/80 p-2 dark:border-blue-900 dark:bg-slate-900/70">
                                            <div>
                                              <label className="block text-xs font-semibold text-blue-900 dark:text-blue-100" htmlFor={`refund-qty-${item.id}`}>{t('patientDrawer.quantityToRefund', { defaultValue: 'Quantity to refund' })}</label>
                                              <span className="text-[11px] text-[var(--color-text-muted)]">{t('patientDrawer.maximumRefundQuantity', { defaultValue: `Maximum ${item.available_qty}` })}</span>
                                            </div>
                                            <input
                                              id={`refund-qty-${item.id}`}
                                              aria-label={`Refund quantity for ${item.description}`}
                                              className="input h-10 w-28 border-blue-200 py-1 text-center font-data text-base font-bold focus:border-blue-400 focus:ring-blue-200 dark:border-blue-900"
                                              type="number"
                                              min={1}
                                              max={Math.max(1, Number(item.available_qty ?? 1))}
                                              value={selectedQuantity}
                                              onChange={(event) => {
                                                const next = Math.max(1, Math.min(Number(item.available_qty ?? 1), Number(event.target.value || 1)));
                                                setRefundSelections((current) => ({ ...current, [item.id]: next }));
                                              }}
                                            />
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        ) : null}

                        <div className={`rounded-xl border p-3 ${(insufficientRefundCash || refundProducesNoCash || amountRefundRequiresFullFlow) ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'}`}>
                          <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                            <span>{t('patientDrawer.refundTotal', { defaultValue: 'Refund total' })}</span>
                            <span className="font-data">৳{money(selectedRefundTotal)}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                            <span>{t('patientDrawer.cashToHold', { defaultValue: 'Cash to hold' })}</span>
                            <span className="font-data font-semibold">৳{money(selectedCashHoldAmount)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                            <span>{t('patientDrawer.receivableReduction', { defaultValue: 'Receivable reduction' })}</span>
                            <span className="font-data font-semibold">৳{money(selectedReceivableReduction)}</span>
                          </div>
                          <div className="mt-2 text-xs">
                            {amountRefundRequiresFullFlow
                              ? t('patientDrawer.amountRefundInvalidSummary', { defaultValue: 'Use Full refund when refunding the entire current bill.' })
                              : refundProducesNoCash
                                ? t('patientDrawer.refundProducesNoCash', { defaultValue: 'This selection only reduces unpaid receivable. Use the bill-adjustment workflow.' })
                                : insufficientRefundCash
                                  ? t('patientDrawer.insufficientRefundCash', { defaultValue: 'Available counter cash is lower than the cash portion of this refund.' })
                                  : t('patientDrawer.cashWillBeHeld', { defaultValue: 'The cash portion will be held after request submission.' })}
                          </div>
                          <div className="mt-1 text-xs font-semibold">{t('patientDrawer.noCashBeforeApproval', { defaultValue: 'Do not hand cash to the patient until approval.' })}</div>
                        </div>
                        {!activeSession ? (
                          <div className="text-xs text-red-600">{t('patientDrawer.counterRequiredForRefund', { defaultValue: 'Activate a billing counter on this workstation before requesting a refund.' })}</div>
                        ) : null}
                      </div>
                    ) : null}
                    <div>
                      <label className="label">{t('form.reason', { defaultValue: 'Reason' })} *</label>
                      <textarea
                        className="input min-h-[96px] resize-none"
                        value={reviewReason}
                        onChange={(event) => setReviewReason(event.target.value)}
                        placeholder={actionMode === 'refundRequest'
                          ? t('placeholder.billRefundReason', { defaultValue: 'Example: duplicate paid invoice, wrong patient bill, service was not provided...' })
                          : actionMode === 'cancelRequest'
                            ? t('placeholder.billCancelReason', { defaultValue: 'Example: duplicate invoice, wrong patient invoice, wrong service billed...' })
                            : t('placeholder.paymentCorrectionReason', { defaultValue: 'Example: cash was not received, wrong invoice payment, duplicate payment entry...' })}
                      />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" className="btn-secondary justify-center" onClick={closeReviewPanel}>
                        {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
                      </button>
                      <button
                        type="button"
                        className="btn-primary justify-center"
                        disabled={reviewRequestPending
                          || reviewReason.trim().length < 3
                          || (actionMode === 'refundRequest' && (
                            refundItemsLoading
                            || !refundInvoiceData?.bill
                            || !activeSession
                            || selectedRefundTotal <= 0
                            || amountRefundRequiresFullFlow
                            || (refundMode !== 'amount' && selectedRefundItems.length === 0)
                            || refundProducesNoCash
                            || insufficientRefundCash
                          ))}
                        onClick={actionMode === 'refundRequest' ? submitBillRefundRequest : actionMode === 'cancelRequest' ? submitBillReviewRequest : submitPaymentReviewRequest}
                      >
                        {reviewRequestPending ? t('btn.sending', { defaultValue: 'Sending...' }) : t('btn.sendReviewRequest', { defaultValue: 'Send review request' })}
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-[var(--color-primary)]" />
                  <h3 className="font-semibold">{t('patientDrawer.recentBills', { defaultValue: 'Recent bills' })}</h3>
                </div>
                <div className="space-y-2">
	                  {(data?.bills ?? []).slice(0, 5).map((bill) => {
                      const due = getBillDue(bill);
                      const canRefund = canRequestBillRefund(bill);
                      return (
	                    <div key={bill.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm">
	                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => window.open(getBillPrintPath(bill.id), '_blank', 'noopener,noreferrer')}>
	                        <div className="font-medium">{bill.invoice_no ?? `Bill #${bill.id}`}</div>
	                        <div className="text-xs text-[var(--color-text-muted)]">
	                          {formatDate(bill.created_at) ?? t('info.dateNA', { defaultValue: 'Date N/A' })} - {bill.status ?? 'pending'} - Paid ৳{money(getBillSettledAmount(bill))}
	                        </div>
	                      </button>
	                      <div className="flex items-center gap-3 text-right">
                          <div>
	                          <div className="font-data">৳{money(bill.total_amount)}</div>
	                          {due > 0 ? <div className="text-xs text-red-600">{t('info.due', { defaultValue: 'Due' })} ৳{money(due)}</div> : null}
                          </div>
                          {due > 0 ? (
                            <button type="button" className="btn-secondary px-3 py-2 text-xs" disabled={!activeSession} onClick={() => openDuePayment(bill)}>
                              {t('btn.pay', { defaultValue: 'Pay' })}
                            </button>
                          ) : null}
                          <a className="btn-ghost px-3 py-2 text-xs" href={getBillPrintPath(bill.id)} target="_blank" rel="noreferrer">
                            {t('btn.print', { defaultValue: 'Print' })}
                          </a>
                          <button
                            type="button"
                            className={`btn-ghost px-3 py-2 text-xs ${canRefund ? 'text-amber-700 hover:bg-amber-50' : 'text-red-600 hover:bg-red-50'}`}
                            disabled={anyReviewRequestPending}
                            onClick={() => canRefund ? openBillRefundRequest(bill) : openBillCancelRequest(bill)}
                          >
                            {canRefund
                              ? t('btn.requestBillRefund', { defaultValue: 'রিফান্ড অনুরোধ' })
                              : t('btn.requestBillCancellation', { defaultValue: 'বিল বাতিলের অনুরোধ' })}
                          </button>
	                      </div>
	                    </div>
                      );
                    })}
                  {(data?.bills ?? []).length === 0 ? <div className="text-sm text-[var(--color-text-muted)]">{t('empty.noRecentBills', { defaultValue: 'No recent bills.' })}</div> : null}
                </div>
              </section>

              {(data?.refundRequests ?? []).length > 0 ? (
                <section className="card border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/20" data-testid="refund-request-history">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{t('patientDrawer.refundRequests', { defaultValue: 'Refund requests' })}</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">{t('patientDrawer.refundRequestsDesc', { defaultValue: 'Submitted refunds and their current approval status.' })}</p>
                    </div>
                    <span className="badge badge-warning">{(data?.refundRequests ?? []).length}</span>
                  </div>
                  <div className="space-y-2">
                    {(data?.refundRequests ?? []).slice(0, 8).map((request) => {
                      const amount = Number(request.requestedRefundAmount || request.cashRefundAmount + request.receivableReduction || 0);
                      const requestStatus = request.status.toLowerCase();
                      const financiallyExecuted = request.executionStatus === 'succeeded';
                      const approvalPending = financiallyExecuted
                        && ['pending', 'partially_approved'].includes(requestStatus);
                      const statusLabel = approvalPending
                        ? t('status.refundedApprovalPending', { defaultValue: 'Refunded — approval pending' })
                        : financiallyExecuted && requestStatus === 'approved'
                          ? t('status.refunded', { defaultValue: 'Refunded' })
                          : request.status.replace(/_/g, ' ');
                      const itemNames = request.items.map((item) => item.description).filter(Boolean).join(', ');
                      return (
                        <div key={request.id} className="rounded-xl border border-amber-200 bg-white p-3 text-sm dark:border-amber-900 dark:bg-slate-900">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold">{request.invoiceNo ?? `Bill #${request.billId}`}</div>
                              <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                                {formatDate(request.createdAt)}{itemNames ? ` · ${itemNames}` : request.itemCount ? ` · ${request.itemCount} item(s)` : ''}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-data font-bold text-amber-800 dark:text-amber-200">৳{money(amount)}</div>
                              <span className={`badge mt-1 text-[10px] ${approvalPending ? 'badge-warning' : requestStatus === 'rejected' ? 'bg-red-100 text-red-700' : 'badge-success'}`}>
                                {statusLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="card p-4">
                  <h3 className="mb-2 font-semibold">{t('heading.payments', { defaultValue: 'Payments' })}</h3>
                  <div className="space-y-2 text-sm">
                    {(data?.payments ?? []).slice(0, 5).map((payment) => (
                      <div key={payment.id} className="rounded-lg border border-[var(--color-border)] p-2">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{payment.receipt_no ?? `Payment #${payment.id}`}</span>
                          <span className="font-data">৳{money(payment.amount)}</span>
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {formatDate(payment.date ?? payment.created_at) ?? t('info.dateNA', { defaultValue: 'Date N/A' })} - {payment.invoice_no ?? t('info.invoiceNA', { defaultValue: 'Invoice N/A' })} - {payment.payment_method ?? 'cash'}
                        </div>
                        {Number(payment.amount ?? 0) > 0 ? (
                          <button type="button" className="mt-2 btn-ghost px-2 py-1 text-xs text-amber-700 hover:bg-amber-50" disabled={anyReviewRequestPending} onClick={() => openPaymentCorrectionRequest(payment)}>
                            {t('btn.requestPaymentVoid', { defaultValue: 'পেমেন্ট ভয়েডের অনুরোধ' })}
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {(data?.payments ?? []).length === 0 ? <div className="text-sm text-[var(--color-text-muted)]">{t('empty.noPayments', { defaultValue: 'No payment history.' })}</div> : null}
                  </div>
                </div>
                <div className="card p-4">
                  <h3 className="mb-2 font-semibold">{t('patientDrawer.depositLedger', { defaultValue: 'Deposit ledger' })}</h3>
                  <div className="space-y-2 text-sm">
                    {(data?.depositLedger ?? []).slice(0, 5).map((deposit) => (
                      <div key={deposit.id} className="rounded-lg border border-[var(--color-border)] p-2">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{deposit.deposit_receipt_no ?? `Deposit #${deposit.id}`}</span>
                          <span className="font-data">৳{money(deposit.amount)}</span>
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {formatDate(deposit.created_at) ?? t('info.dateNA', { defaultValue: 'Date N/A' })} - {deposit.transaction_type ?? 'deposit'} - {deposit.payment_method ?? 'cash'}
                        </div>
                        {deposit.remarks ? <div className="mt-1 text-xs text-[var(--color-text-muted)]">{deposit.remarks}</div> : null}
                      </div>
                    ))}
                    {(data?.depositLedger ?? []).length === 0 ? <div className="text-sm text-[var(--color-text-muted)]">{t('empty.noDepositHistory', { defaultValue: 'No deposit history.' })}</div> : null}
                  </div>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="card p-4">
                  <h3 className="mb-2 font-semibold">{t('heading.visits', { defaultValue: 'Visits' })}</h3>
                  <div className="space-y-2 text-sm">
                    {(data?.visits ?? []).slice(0, 4).map((visit) => (
                      <div key={visit.id} className="rounded-lg bg-[var(--color-bg-secondary)] p-2">
                        <div className="font-medium">{visit.visit_no ?? `Visit #${visit.id}`}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{formatDate(visit.visit_date) ?? t('info.dateNA', { defaultValue: 'Date N/A' })} - {visit.doctor_name ?? t('info.doctorNA', { defaultValue: 'Doctor N/A' })} - {visit.status ?? 'open'}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card p-4">
                  <h3 className="mb-2 font-semibold">{t('heading.reports', { defaultValue: 'Reports' })}</h3>
                  <div className="space-y-2 text-sm">
                    {(data?.reports ?? []).slice(0, 4).map((report) => (
                      <div key={report.id} className="rounded-lg bg-[var(--color-bg-secondary)] p-2">
                        <div className="font-medium">{report.order_no ?? `Order #${report.id}`}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{report.ready_count ?? 0}/{report.item_count ?? 0} ready - {report.status ?? 'open'}</div>
                      </div>
                    ))}
                    <a className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--color-primary)]" href={`${receptionBasePath}/reports`}>
                      <FileText className="h-3.5 w-3.5" /> {t('btn.reportDelivery', { defaultValue: 'Report delivery' })}
                    </a>
                  </div>
                </div>
              </section>
              </>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}

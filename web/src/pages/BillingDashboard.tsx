import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Receipt, Search, Plus, X, DollarSign, AlertTriangle,
  CreditCard, Printer, Eye, ChevronLeft, ChevronRight, FileText, Banknote
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6, formatDateTimeGMT6 } from '../lib/date-utils';
import { normalizeExternalTransactionId, requiresPaymentReference } from '../lib/paymentReference';
import {
  getBillDepositAdjustedAmount,
  getBillOutstandingAmount,
  getBillSettledAmount,
  getBillTotalAmount,
} from '../lib/billAmounts';

/* ─── Helpers ─────────────────────────────────────────────────── */
const fmtCur = (amount: number, lang: string) => {
  return new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
};

const fmtDt = (dateStr: string, _lang: string) => {
  return formatDateTimeGMT6(dateStr).split(' ')[0]; // Just the date part from GMT+6 string
};

/* ─── Types ─────────────────────────────────────────────────────── */
interface BillItem {
  itemCategory: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface BillPayment {
  id: number;
  amount: number;
  payment_type?: string | null;
  payment_method?: string | null;
  receipt_no?: string | null;
  date?: string | null;
}

interface DepositAdjustment {
  id: number;
  deposit_receipt_no: string;
  amount: number;
  payment_method?: string | null;
  remarks?: string | null;
  created_at?: string | null;
}

interface Bill {
  id: number;
  invoice_no: string;
  patient_name: string;
  patient_code: string;
  patient_mobile?: string;
  subtotal: number;
  discount: number;
  total_amount: number;
  paid_amount: number;
  status: 'open' | 'partially_paid' | 'paid';
  created_at: string;
  outstanding?: number;
  settled_amount?: number;
  deposit_adjusted?: number;
  due?: number;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface BillsResponse {
  bills: Bill[];
  meta?: PaginationMeta;
  summary?: {
    totalCount: number;
    totalPaid: number;
    totalAmount: number;
  };
}

interface BillDetailResponse {
  items: BillItem[];
  payments?: BillPayment[];
  deposit_adjustments?: DepositAdjustment[];
}

interface PatientOption {
  id: number;
  name: string;
  patient_code?: string;
  mobile?: string;
}

interface BillingServiceItem {
  id: number;
  item_name: string;
  item_code?: string;
  price: number;
  department_name?: string;
}

interface CreateBillLineItem {
  category: string;
  description: string;
  qty: string;
  price: string;
  serviceItemId?: string;
}

interface PatientBillingContext {
  deposit_balance: number;
  provisional_amount: number;
  outstanding_amount: number;
}

export const inferBillCategoryFromServiceItem = (item: Pick<BillingServiceItem, 'item_name' | 'department_name'>) => {
  const haystack = `${item.department_name ?? ''} ${item.item_name}`.toLowerCase();
  if (/(lab|laboratory|pathology|test|diagnostic|radiology|x-?ray|ultra|scan)/.test(haystack)) return 'test';
  if (/(consult|doctor|opd|physician)/.test(haystack)) return 'doctor_visit';
  if (/(medicine|pharmacy|drug)/.test(haystack)) return 'medicine';
  if (/(admission|ipd|bed|cabin|icu|ward)/.test(haystack)) return 'admission';
  if (/(operation|procedure|surgery|ot|delivery|dressing|suture)/.test(haystack)) return 'operation';
  return 'other';
};

export const applyDoctorFeeToBillLine = (line: CreateBillLineItem, consultationFee: number): CreateBillLineItem => {
  if (line.category !== 'doctor_visit' || line.price || consultationFee <= 0) return line;
  return { ...line, price: String(Math.round(consultationFee)) };
};

export const applyServiceItemToBillLine = (
  line: CreateBillLineItem,
  item: BillingServiceItem,
): CreateBillLineItem => ({
  ...line,
  category: inferBillCategoryFromServiceItem(item),
  description: item.item_name,
  price: String(Math.round(Number(item.price) || 0)),
  serviceItemId: String(item.id),
});

export const toCreateBillItems = (lineItems: CreateBillLineItem[]) => lineItems
  .map(li => ({
    itemCategory: li.category,
    description: li.description || undefined,
    quantity: Number(li.qty) || 1,
    unitPrice: Number(li.price) || 0,
    serviceItemId: li.serviceItemId ? Number(li.serviceItemId) : undefined,
  }))
  .filter(i => i.unitPrice > 0);

export const findInvalidManualBillLine = (lineItems: CreateBillLineItem[], selectedDoctorId?: string) => lineItems.find((li) => {
  if (li.serviceItemId) return false;
  if (li.category === 'doctor_visit' && selectedDoctorId) return false;
  return true;
});

export function buildDirectBillDiscountPayload(input: {
  discount: number;
  discountReason: string;
  discountByName: string;
}): { discount: number; discountReason?: string; discountByName?: string } | null {
  const discount = Math.max(0, Number(input.discount) || 0);
  if (discount <= 0) return { discount: 0 };
  const discountReason = input.discountReason.trim();
  const discountByName = input.discountByName.trim();
  if (!discountReason || !discountByName) return null;
  return { discount, discountReason, discountByName };
}

export const findCollectPaymentBill = <T extends { id: number }>(
  rawBillId: string | null,
  currentBills: readonly T[],
  dueBills: readonly T[],
): T | null => {
  const billId = Number(rawBillId);
  if (!Number.isSafeInteger(billId) || billId <= 0) return null;
  return currentBills.find((bill) => bill.id === billId)
    ?? dueBills.find((bill) => bill.id === billId)
    ?? null;
};

/* ─── Constants ────────────────────────────────────────────────── */
const STATUS_BADGE: Record<string, { labelKey: string; badge: string }> = {
  open:           { labelKey: 'open',    badge: 'badge-danger' },
  partially_paid: { labelKey: 'partial', badge: 'badge-warning' },
  paid:           { labelKey: 'paid',    badge: 'badge-success' },
};


/* ─── Component ────────────────────────────────────────────────── */
export default function BillingDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const normalizedRole = role === 'receptionist' ? 'reception' : role;
  const canApplyDiscount = ['hospital_admin', 'md', 'director', 'accountant'].includes(normalizedRole);
  const [search,     setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [page,       setPage]       = useState(1);
  const [activeTab,  setActiveTab]  = useState<'bills' | 'dues'>('bills');
  const [helpOpen,   setHelpOpen]   = useState(false);

  // Create Bill modal
  const [showCreate,  setShowCreate]  = useState(false);
  const [createForm,  setCreateForm]  = useState({
    discount: '0',
    discountReason: 'Management approved',
    discountByName: '',
  });
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientSearchDebounced, setPatientSearchDebounced] = useState('');
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [patientContext, setPatientContext] = useState<PatientBillingContext | null>(null);
  const [lineItems,   setLineItems]   = useState<CreateBillLineItem[]>([
    { category: 'doctor_visit', description: '', qty: '1', price: '' },
  ]);

  // Referring Doctor selection
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedDoctorFee, setSelectedDoctorFee] = useState<number>(0);
  const [doctorSearch, setDoctorSearch] = useState('');
  const [doctorSearchDebounced, setDoctorSearchDebounced] = useState('');
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);

  // Pay modal
  const [showPay,     setShowPay]     = useState(false);
  const [payBill,     setPayBill]     = useState<Bill | null>(null);
  const [payForm,     setPayForm]     = useState({ amount: '', method: 'cash', type: 'current' });
  const [payReference, setPayReference] = useState('');

  // Bill detail modal
  const [showDetail,  setShowDetail]  = useState(false);
  const [detailBill,  setDetailBill]  = useState<Bill | null>(null);
  const [detailItems, setDetailItems] = useState<BillItem[]>([]);
  const [detailPayments, setDetailPayments] = useState<BillPayment[]>([]);
  const [detailDepositAdjustments, setDetailDepositAdjustments] = useState<DepositAdjustment[]>([]);

  const { t, i18n } = useTranslation(['billing', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [urlSearchParams, setUrlSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  /* ─── Localized Constants ───────────────────────────────────── */
  const ITEM_CATEGORIES = [
    { value: 'test',          label: t('billing:category_test') },
    { value: 'doctor_visit',  label: t('billing:category_doctor_visit') },
    { value: 'operation',     label: t('billing:category_operation') },
    { value: 'medicine',      label: t('billing:category_medicine') },
    { value: 'admission',     label: t('billing:category_admission') },
    { value: 'fire_service',  label: t('billing:category_fire_service') },
    { value: 'other',         label: t('billing:category_other') },
  ];

  const PAYMENT_METHODS = [
    { value: 'cash',  label: t('billing:payMethod_cash'),  icon: '💵' },
    { value: 'bkash', label: t('billing:payMethod_bkash'), icon: '📱' },
    { value: 'bank',  label: t('billing:payMethod_bank'),  icon: '🏦' },
    { value: 'other', label: t('billing:payMethod_other'), icon: '💳' },
  ];

  const categoryLabel = (key: string) => {
    const found = ITEM_CATEGORIES.find(c => c.value === key);
    return found ? found.label : t(`billing:category_${key}`, { defaultValue: key });
  };

  // ESC-to-close modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreate(false); setShowPay(false); setShowDetail(false); setPayBill(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounce patient search for create bill
  useEffect(() => {
    const t = setTimeout(() => setPatientSearchDebounced(patientSearch), 300);
    return () => clearTimeout(t);
  }, [patientSearch]);

  const { data: patientSearchData } = useApiQuery<{ patients: PatientOption[] }>(
    [...queryKeys.patients.all, 'bill-create', patientSearchDebounced],
    `/api/patients?search=${encodeURIComponent(patientSearchDebounced)}&limit=8`,
    { enabled: patientSearchDebounced.length >= 2 && showCreate },
  );
  const searchPatients = patientSearchData?.patients ?? [];

  // Debounce doctor search
  useEffect(() => {
    const t = setTimeout(() => setDoctorSearchDebounced(doctorSearch), 300);
    return () => clearTimeout(t);
  }, [doctorSearch]);

  const { data: doctorSearchData } = useApiQuery<{ doctors: any[] }>(
    [...queryKeys.doctors.all, 'referral-search', doctorSearchDebounced],
    `/api/doctors?search=${encodeURIComponent(doctorSearchDebounced)}&limit=8`,
    { enabled: doctorSearchDebounced.length >= 2 && showCreate },
  );
  const searchDoctors = doctorSearchData?.doctors ?? [];

  const { data: serviceItemsData } = useApiQuery<{ data: BillingServiceItem[] }>(
    [...queryKeys.billingMaster.all, 'bill-create-service-items'],
    '/api/billing-master/service-items?page=1&per_page=200',
    { enabled: showCreate },
  );
  const serviceItems = serviceItemsData?.data ?? [];

  // Group service items by department for grouped dropdown
  const groupedServiceItems = useMemo(() => {
    if (!serviceItems.length) return [];
    const groups = new Map<string, BillingServiceItem[]>();
    for (const item of serviceItems) {
      const dept = item.department_name ?? 'Other';
      if (!groups.has(dept)) groups.set(dept, []);
      groups.get(dept)!.push(item);
    }
    return Array.from(groups.entries()).map(([dept, items]) => ({ dept, items }));
  }, [serviceItems]);

  // Fetch patient billing context when patient is selected
  useEffect(() => {
    if (!selectedPatientId) { setPatientContext(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const [depositRes, provRes] = await Promise.all([
          api.get<{ balance: number }>(`/api/deposits/balance/${selectedPatientId}`),
          api.get<{ data: { pending_amount: number } }>(`/api/billing-provisional/patient/${selectedPatientId}/summary`),
        ]);
        if (cancelled) return;
        setPatientContext({
          deposit_balance: depositRes?.balance ?? 0,
          provisional_amount: provRes?.data?.pending_amount ?? 0,
          outstanding_amount: 0,
        });
      } catch { if (!cancelled) setPatientContext(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedPatientId]);

  /* ─── Data Fetching ─────────────────────────────────────────── */
  const billFilters = useMemo(() => ({ page, status: statusFilter, from: dateFrom, to: dateTo, search }), [page, statusFilter, dateFrom, dateTo, search]);

  const buildBillUrl = () => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '20');
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (search) params.set('search', search);
    return `/api/billing?${params}`;
  };

  const { data: billsData, isLoading: loading } = useApiQuery<BillsResponse>(
    queryKeys.billing.list(billFilters),
    buildBillUrl(),
  );

  const { data: duesData } = useApiQuery<BillsResponse>(
    queryKeys.billing.dues(),
    '/api/billing/due',
  );

  const bills = billsData?.bills ?? [];
  const meta = billsData?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 };
  const dueBills = duesData?.bills ?? [];

  /* ─── KPI Calculations ──────────────────────────────────────── */
  const todayStr = getTodayGMT6();
  const isFiltered = !!(dateFrom || dateTo || search || statusFilter);
  const summary = billsData?.summary;

  const totalRevenue  = (isFiltered && summary) ? summary.totalPaid : bills.filter(b => b.created_at.startsWith(todayStr)).reduce((s, b) => s + getBillSettledAmount(b), 0);
  const totalDues     = dueBills.reduce((s, b) => s + getBillOutstandingAmount(b), 0);
  const billsToday    = (isFiltered && summary) ? summary.totalCount : bills.filter(b => b.created_at.startsWith(todayStr)).length;
  const paidCount     = bills.filter(b => b.status === 'paid').length;
  const collectionRate = bills.length > 0 ? Math.round((paidCount / bills.length) * 100) : 0;

  /* ─── Create Bill ───────────────────────────────────────────── */
  const createMutation = useApiMutation<{ invoiceNo: string }, unknown>(
    'post',
    '/api/billing',
    {
      onSuccess: (data) => {
        toast.success(t('billCreated', { invoiceNo: data.invoiceNo, defaultValue: `Bill created: ${data.invoiceNo}` }));
        setShowCreate(false);
        resetCreateForm();
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
      },
      onError: (err) => {
        toast.error(err.message || t('failedToCreate', { defaultValue: 'Failed to create bill' }));
      },
    },
  );

  const handleCreateBill = (e: React.FormEvent) => {
    e.preventDefault();
    const patientId = parseInt(selectedPatientId);
    if (!patientId) return toast.error(t('patientIdRequired', { defaultValue: 'Patient ID is required' }));
    const invalidManualLine = findInvalidManualBillLine(lineItems, selectedDoctorId);
    if (invalidManualLine) {
      const message = invalidManualLine.category === 'doctor_visit'
        ? t('billing:selectDoctorForConsultation', { defaultValue: 'Select a doctor before adding a consultation fee.' })
        : t('billing:selectCatalogItemForLine', { defaultValue: 'Select a service item for every bill line.' });
      return toast.error(message);
    }
    const items = toCreateBillItems(lineItems);
    if (items.length === 0) return toast.error(t('addItemRequired', { defaultValue: 'Add at least one item with a price' }));
    const discountPayload = buildDirectBillDiscountPayload({
      discount: canApplyDiscount ? Number(createForm.discount) || 0 : 0,
      discountReason: createForm.discountReason,
      discountByName: createForm.discountByName,
    });
    if (!discountPayload) {
      return toast.error(t('billing:discountApprovalRequired', { defaultValue: 'Discount reason and approved/referred by name are required.' }));
    }

    createMutation.mutate({
      patientId,
      items,
      ...discountPayload,
      referringDoctorId: parseInt(selectedDoctorId) || undefined,
    });
  };

  const resetCreateForm = () => {
    setCreateForm({ discount: '0', discountReason: 'Management approved', discountByName: '' });
    setSelectedPatientId('');
    setPatientSearch('');
    setPatientSearchDebounced('');
    setSelectedDoctorId('');
    setSelectedDoctorFee(0);
    setDoctorSearch('');
    setDoctorSearchDebounced('');
    setLineItems([{ category: 'doctor_visit', description: '', qty: '1', price: '' }]);
    setPatientContext(null);
  };

  const addLineItem = () => setLineItems(prev => [...prev, { category: 'other', description: '', qty: '1', price: '' }]);
  const removeLineItem = (idx: number) => setLineItems(prev => prev.filter((_, i) => i !== idx));
  const updateLineItem = (idx: number, field: string, value: string) => {
    setLineItems(prev => prev.map((li, i) => {
      if (i !== idx) return li;
      const updated = { ...li, [field]: value };

      // If category changed to doctor_visit, and we have a selected doctor, fill price if empty
      if (field === 'category' && value === 'doctor_visit') {
        return applyDoctorFeeToBillLine(updated, selectedDoctorFee);
      }

      return updated;
    }));
  };

  const subtotal = lineItems.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.price) || 0), 0);
  const grandTotal = Math.max(0, subtotal - (canApplyDiscount ? Number(createForm.discount) || 0 : 0));

  /* ─── Collect Payment ───────────────────────────────────────── */
  const openPayModal = (bill: Bill) => {
    const outstanding = getBillOutstandingAmount(bill);
    setPayBill(bill);
    setPayForm({ amount: String(outstanding), method: 'cash', type: 'current' });
    setPayReference('');
    setShowPay(true);
  };

  const collectBillId = urlSearchParams.get('collectBillId');
  useEffect(() => {
    if (!collectBillId || showPay) return;
    const target = findCollectPaymentBill(collectBillId, bills, dueBills);
    if (!target) return;

    openPayModal(target);
    const next = new URLSearchParams(urlSearchParams);
    next.delete('collectBillId');
    setUrlSearchParams(next, { replace: true });
  }, [collectBillId, bills, dueBills, showPay, setUrlSearchParams, urlSearchParams]);

  const payMutation = useApiMutation<{ receiptNo: string }, unknown>(
    'post',
    '/api/billing/pay',
    {
      onSuccess: (data) => {
        toast.success(t('paymentRecorded', { receiptNo: data.receiptNo, defaultValue: `Payment recorded — Receipt: ${data.receiptNo}` }));
        setShowPay(false);
        setPayBill(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.all });
      },
      onError: (err) => {
        toast.error(err.message || t('paymentFailed', { defaultValue: 'Payment failed' }));
      },
    },
  );

  const handlePay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payBill) return;
    const amount = parseFloat(payForm.amount);
    if (!amount || amount <= 0) return toast.error(t('invalidAmount', { defaultValue: 'Invalid amount' }));
    if (requiresPaymentReference(payForm.method, amount) && !payReference.trim()) {
      return toast.error(t('billing:paymentReferenceRequired', { defaultValue: 'Transaction/reference number is required for non-cash payments.' }));
    }

    payMutation.mutate({
      billId: payBill.id,
      amount,
      type: payForm.type,
      paymentMethod: payForm.method,
      externalTransactionId: normalizeExternalTransactionId(payForm.method, amount, payReference),
      idempotencyKey: `billing-dashboard-payment-${payBill.id}-${crypto.randomUUID()}`,
    });
  };

  /* ─── View Bill Detail ──────────────────────────────────────── */
  const viewBillDetail = async (bill: Bill) => {
    setDetailBill(bill);
    setDetailItems([]);
    setDetailPayments([]);
    setDetailDepositAdjustments([]);
    setShowDetail(true);
    try {
      const data = await api.get<BillDetailResponse>(`/api/billing/${bill.id}`);
      setDetailItems(data.items ?? []);
      setDetailPayments(data.payments ?? []);
      setDetailDepositAdjustments(data.deposit_adjustments ?? []);
    } catch {
      toast.error(t('billing.loadItemsFailed', { defaultValue: 'Failed to load bill items' }));
      setShowDetail(false);
      setDetailBill(null);
      setDetailPayments([]);
      setDetailDepositAdjustments([]);
    }
  };

  /* ─── Display list ──────────────────────────────────────────── */
  const displayedBills = activeTab === 'dues' ? dueBills : bills;
  const detailItemSubtotal = detailItems.reduce((s, item) => s + (Number(item.lineTotal) || 0), 0);
  const detailPaymentTotal = detailPayments.reduce((s, payment) => s + (Number(payment.amount) || 0), 0);
  const detailDepositTotal = detailDepositAdjustments.reduce((s, adjustment) => s + (Number(adjustment.amount) || 0), 0);
  const detailTracedPaid = detailPaymentTotal + detailDepositTotal;
  const detailUntracedPaid = detailBill ? Math.max(0, getBillSettledAmount(detailBill) - detailTracedPaid) : 0;

  return (
    <DashboardLayout role={role}>
      <HelpPanel pageKey="billing" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('billing:billingDashboard')}</h1>
            <p className="section-subtitle mt-1">{t('billing:subtitle')}</p>

          </div>
          <div className="flex items-center gap-2">
            <HelpButton onClick={() => setHelpOpen(true)} />
            <WhatsAppButton />
            <button
              onClick={() => navigate(`/h/${slug}/${role === 'reception' ? 'reception/billing-counter' : 'billing-counter'}`)}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('createBill', { defaultValue: 'Create Bill' })}</span>
            </button>
          </div>
        </div>

        {/* ── Alert: Outstanding Dues ── */}
        {totalDues > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span className="text-sm font-medium">
              ৳{fmtCur(totalDues, i18n.language)} {t('billing:outstandingAcross')} {fmtCur(dueBills.length, i18n.language)} {t('billing:billCount', { count: dueBills.length })} —{' '}
              <button onClick={() => setActiveTab('dues')} className="underline font-semibold">{t('billing:viewDues')}</button>
            </span>
          </div>
        )}

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t(isFiltered ? 'billing:periodRevenue' : 'billing:todayRevenue')} value={`৳${fmtCur(totalRevenue, i18n.language)}`} loading={loading} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title={t('billing:outstandingDues')} value={`৳${fmtCur(totalDues, i18n.language)}`} loading={loading} icon={<AlertTriangle className="w-5 h-5"/>} iconBg="bg-red-50 text-red-600" />
          <KPICard title={t(isFiltered ? 'billing:periodBills' : 'billing:billsToday')} value={fmtCur(billsToday, i18n.language)} loading={loading} icon={<Receipt className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('billing:collectionRate')} value={`${fmtCur(collectionRate, i18n.language)}%`} loading={loading} icon={<CreditCard className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
        </div>


        {/* ── Tabs ── */}
        <div className="flex border-b border-[var(--color-border)]">
          {([['bills', t('billing:allBills')], ['dues', t('billing:outstandingDues')]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Search & Filters (All Bills tab only) ── */}
        {activeTab === 'bills' && (
          <div className="card p-3 sm:p-4">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input type="text" placeholder={t('billing:searchPlaceholder')}
                  value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="input pl-9" />
              </div>
            </div>
            {/* Status filter + date — horizontal scroll on mobile */}
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1 scrollbar-none">
              <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm shrink-0">
                {[['', 'all'], ['open', 'open'], ['partially_paid', 'partial'], ['paid', 'paid']].map(([val, key]) => (
                  <button key={val} onClick={() => { setStatusFilter(val); setPage(1); }}
                    className={`px-3 py-2 font-medium transition-colors whitespace-nowrap ${statusFilter === val ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
                    {t(`billing:${key === 'all' ? 'all' : key}`)}
                  </button>
                ))}
              </div>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                className="input w-36 text-sm shrink-0" aria-label={t('billing:dateFrom')} />
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
                className="input w-36 text-sm shrink-0" aria-label={t('billing:dateTo')} />
            </div>
          </div>
        )}


        {/* ── Bills ── */}
        <div className="card overflow-hidden">

          {/* Mobile card list — visible on small screens */}
          <div className="sm:hidden divide-y divide-[var(--color-border)]">
            {loading
              ? [...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <div className="flex-1 space-y-2"><div className="skeleton h-4 w-36" /><div className="skeleton h-3 w-24" /></div>
                    <div className="skeleton h-5 w-14 rounded-full" />
                  </div>
                ))
              : displayedBills.length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                    <FileText className="w-10 h-10 opacity-30" />
                    <p>{activeTab === 'dues' ? t('billing:noOutstandingDues') : t('billing:noBillsFound')}</p>
                  </div>
                )
              : displayedBills.map(bill => {
                  const st = STATUS_BADGE[bill.status] ?? STATUS_BADGE.open;
                  const outstanding = getBillOutstandingAmount(bill);
                  const settled = getBillSettledAmount(bill);
                  return (
                    <div key={bill.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{bill.patient_name}</p>
                          <p className="text-xs text-[var(--color-text-muted)] font-data">{bill.invoice_no} · {new Date(bill.created_at).toLocaleDateString(i18n.language === 'bn' ? 'bn-BD' : 'en-GB', { day: '2-digit', month: 'short' })}</p>
                        </div>
                        <span className={`badge ${st.badge} shrink-0`}>{t(`billing:${st.labelKey}`)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div className="space-x-3 font-data">
                          <span>{t('billing:total')}: <span className="font-medium">৳{fmtCur(bill.total_amount, i18n.language)}</span></span>
                          <span className="text-emerald-600">{t('billing:paid')}: ৳{fmtCur(settled, i18n.language)}</span>
                          {activeTab === 'dues' && outstanding > 0 && (
                            <span className="text-red-600 font-semibold">{t('billing:due')}: ৳{fmtCur(outstanding, i18n.language)}</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {bill.status !== 'paid' && (
                            <button onClick={() => openPayModal(bill)} className="btn-ghost p-1.5 text-emerald-600" title={t('billing:pay')}><Banknote className="w-4 h-4" /></button>
                          )}
                          <button onClick={() => viewBillDetail(bill)} className="btn-ghost p-1.5" title={t('common:view')}><Eye className="w-4 h-4" /></button>
                          <button onClick={() => window.open(`/h/${slug}/billing/${bill.id}/print`, '_blank')} className="btn-ghost p-1.5" title={t('common:print')}><Printer className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                  );
                })

            }
          </div>

          {/* Desktop table — hidden on mobile */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('billing:invoice')}</th>
                  <th>{t('billing:patientName')}</th>
                  <th>{t('billing:code')}</th>
                  <th>{t('common:date')}</th>
                  <th>{t('billing:total')} (৳)</th>
                  <th>{t('billing:paid')} (৳)</th>
                  {activeTab === 'dues' && <th>{t('billing:outstanding')} (৳)</th>}
                  <th>{t('common:status')}</th>
                  <th>{t('common:actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => <tr key={i}>{[...Array(activeTab === 'dues' ? 9 : 8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : displayedBills.length === 0 ? (
                  <tr><td colSpan={activeTab === 'dues' ? 9 : 8} className="py-16 text-center text-[var(--color-text-muted)]">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    {activeTab === 'dues' ? t('billing:noOutstandingDues') : t('billing:noBillsFound')}
                  </td></tr>
                ) : (
                  displayedBills.map(bill => {
                    const st = STATUS_BADGE[bill.status] ?? STATUS_BADGE.open;
                    const outstanding = getBillOutstandingAmount(bill);
                    const settled = getBillSettledAmount(bill);
                    return (
                      <tr key={bill.id}>
                        <td className="font-medium font-data">{bill.invoice_no}</td>
                        <td className="font-medium">{bill.patient_name}</td>
                        <td className="text-[var(--color-text-muted)] font-data">{bill.patient_code}</td>
                        <td className="text-[var(--color-text-secondary)] font-data">{formatDateTimeGMT6(bill.created_at)}</td>
                        <td className="font-data font-medium">৳{fmtCur(bill.total_amount ?? 0, i18n.language)}</td>
                        <td className="font-data text-emerald-600">৳{fmtCur(settled, i18n.language)}</td>
                        {activeTab === 'dues' && <td className="font-data text-red-600 font-semibold">৳{fmtCur(outstanding, i18n.language)}</td>}
                        <td><span className={`badge ${st.badge}`}>{t(`billing:${st.labelKey}`)}</span></td>

                        <td>
                          <div className="flex gap-1.5">
                            {bill.status !== 'paid' && (
                              <button onClick={() => openPayModal(bill)} className="btn-ghost p-1.5 text-emerald-600" title={t('collectPayment', { defaultValue: 'Collect Payment' })}>
                                <Banknote className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => viewBillDetail(bill)} className="btn-ghost p-1.5" title={t('view', { ns: 'common' })}><Eye className="w-4 h-4" /></button>
                            <button onClick={() => window.open(`/h/${slug}/billing/${bill.id}/print`, '_blank')} className="btn-ghost p-1.5" title={t('print', { ns: 'common' })}><Printer className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {activeTab === 'bills' && meta.totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-[var(--color-border)]">
              <span className="text-sm text-[var(--color-text-muted)]">
                {t('common:pageOf')} {fmtCur(meta.page, i18n.language)} {t('common:of')} {fmtCur(meta.totalPages, i18n.language)} ({fmtCur(meta.total, i18n.language)} {t('billing:bills')})
              </span>

              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-ghost p-1.5"><ChevronLeft className="w-4 h-4" /></button>
                <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)} className="btn-ghost p-1.5"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>

        {/* ─── Create Bill Modal ────────────────────────────────── */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold text-lg">{t('billing:createBill')}</h3>
                <button onClick={() => { setShowCreate(false); resetCreateForm(); }} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleCreateBill} className="p-5 space-y-5">
                {/* Patient */}
                <div>
                  <label className="label">{t('billing:searchPatient', { defaultValue: 'Search Patient *' })}</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                      className="input pl-9 w-full"
                      type="text"
                      required
                      placeholder={t('billing:searchPatientPlaceholder', { defaultValue: 'Name, mobile or patient code' })}
                      value={selectedPatientId ? (searchPatients.find(p => String(p.id) === selectedPatientId)?.name ?? patientSearch) : patientSearch}
                      onChange={e => {
                        setPatientSearch(e.target.value);
                        setSelectedPatientId('');
                        setShowPatientDropdown(true);
                      }}
                      onFocus={() => { if (searchPatients.length > 0) setShowPatientDropdown(true); }}
                    />
                    {showPatientDropdown && searchPatients.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {searchPatients.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPatientId(String(p.id));
                              setPatientSearch(`${p.name} (${p.patient_code || ''})${p.mobile ? ' · ' + p.mobile : ''}`);
                              setShowPatientDropdown(false);
                            }}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)] transition-colors"
                          >
                            <span className="font-medium">{p.name}</span>
                            <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}{p.mobile ? ' · ' + p.mobile : ''}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedPatientId && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('billing:patientId')}: {selectedPatientId}</p>
                  )}
                </div>

                {/* Patient Billing Context — deposit, provisional, outstanding */}
                {selectedPatientId && (
                  <div className="grid grid-cols-3 gap-3 p-3 bg-[var(--color-surface)] rounded-lg text-xs">
                    <div className="text-center">
                      <div className="text-[var(--color-text-muted)]">{t('billing:depositBalance', { defaultValue: 'Deposit Balance' })}</div>
                      <div className="font-semibold font-data text-emerald-600">৳{fmtCur(patientContext?.deposit_balance ?? 0, i18n.language)}</div>
                    </div>
                    <div className="text-center border-l border-[var(--color-border)]">
                      <div className="text-[var(--color-text-muted)]">{t('billing:provisionalPending', { defaultValue: 'Provisional Pending' })}</div>
                      <div className="font-semibold font-data text-amber-600">৳{fmtCur(patientContext?.provisional_amount ?? 0, i18n.language)}</div>
                    </div>
                    <div className="text-center border-l border-[var(--color-border)]">
                      <div className="text-[var(--color-text-muted)]">{t('billing:creditLimit', { defaultValue: 'Credit Limit' })}</div>
                      <div className="font-semibold font-data">—</div>
                    </div>
                  </div>
                )}

                {/* Referring Doctor */}
                <div>
                  <label className="label">{t('billing:referringDoctor', { defaultValue: 'Referring Doctor' })}</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                      className="input pl-9 w-full"
                      type="text"
                      placeholder={t('billing:searchDoctorPlaceholder', { defaultValue: 'Search doctor by name or mobile' })}
                      value={selectedDoctorId ? (searchDoctors.find(d => String(d.id) === selectedDoctorId)?.name ?? doctorSearch) : doctorSearch}
                      onChange={e => {
                        setDoctorSearch(e.target.value);
                        setSelectedDoctorId('');
                        setShowDoctorDropdown(true);
                      }}
                      onFocus={() => { if (searchDoctors.length > 0) setShowDoctorDropdown(true); }}
                    />
                    {showDoctorDropdown && searchDoctors.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {searchDoctors.map(d => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              setSelectedDoctorId(String(d.id));
                              setSelectedDoctorFee(d.consultation_fee || 0);
                              setDoctorSearch(d.name + (d.specialty ? ` (${d.specialty})` : ''));
                              setShowDoctorDropdown(false);

                              // Auto-fill fee if a doctor_visit item exists and has no price
                              if (d.consultation_fee) {
                                setLineItems(prev => prev.map(li => applyDoctorFeeToBillLine(li, d.consultation_fee)));
                              }
                            }}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)] transition-colors"
                          >
                            <span className="font-medium">{d.name}</span>
                            {d.specialty && <span className="text-[var(--color-text-muted)] ml-2">{d.specialty}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Line Items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="label mb-0">{t('billing:items')}</label>
                    <button type="button" onClick={addLineItem} className="text-sm text-[var(--color-primary)] font-medium hover:underline">
                      + {t('billing:addItem')}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {lineItems.map((li, idx) => (
                      <div key={idx} className="flex gap-2 items-start bg-[var(--color-surface)] p-3 rounded-lg">
                        <select className="input flex-shrink-0 w-40" value={li.category}
                          onChange={e => updateLineItem(idx, 'category', e.target.value)}>
                          {ITEM_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                        <select
                          className="input flex-shrink-0 w-56"
                          value={li.serviceItemId ?? ''}
                          onChange={e => {
                            const item = serviceItems.find(s => String(s.id) === e.target.value);
                            setLineItems(prev => prev.map((current, i) => (
                              i === idx
                                ? item ? applyServiceItemToBillLine(current, item) : { ...current, serviceItemId: undefined }
                                : current
                            )));
                          }}
                        >
                          <option value="">{t('billing:selectServiceItem', { defaultValue: 'Select service/test' })}</option>
                          {groupedServiceItems.map(group => (
                            <optgroup key={group.dept} label={group.dept}>
                              {group.items.map(item => (
                                <option key={item.id} value={item.id}>
                                  {item.item_name} — ৳{fmtCur(Number(item.price) || 0, i18n.language)}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <input className="input flex-1" placeholder={t('billing:descriptionPlaceholder')}
                          value={li.description} onChange={e => updateLineItem(idx, 'description', e.target.value)} />
                        <input className="input w-16 text-center" type="number" min="1" placeholder={t('billing:quantity')}
                          value={li.qty} onChange={e => updateLineItem(idx, 'qty', e.target.value)} />
                        <input className="input w-24 bg-[var(--color-border-light)]" type="number" min="0" placeholder={t('billing:unitPricePlaceholder')}
                          value={li.price} readOnly />
                        <span className="w-20 text-right font-data text-sm py-2">
                          ৳{fmtCur((Number(li.qty) || 0) * (Number(li.price) || 0), i18n.language)}
                        </span>
                        {lineItems.length > 1 && (
                          <button type="button" onClick={() => removeLineItem(idx)} className="btn-ghost p-1.5 text-red-500"><X className="w-4 h-4" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="flex justify-end gap-6 text-sm pt-2 border-t border-[var(--color-border)]">
                  <div className="text-right space-y-1 pt-3">
                    <div className="text-[var(--color-text-muted)]">{t('billing:subtotal')}: <span className="font-data font-medium text-[var(--color-text)]">৳{fmtCur(subtotal, i18n.language)}</span></div>
                    {canApplyDiscount ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-[var(--color-text-muted)]">{t('billing:discount')}:</span>
                          <input className="input w-24 text-right" type="number" min="0" placeholder="0"
                            value={createForm.discount} onChange={e => setCreateForm({ ...createForm, discount: e.target.value })} />
                        </div>
                        {Number(createForm.discount) > 0 ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            <input
                              className="input"
                              value={createForm.discountReason}
                              onChange={e => setCreateForm({ ...createForm, discountReason: e.target.value })}
                              placeholder={t('billing:discountReason', { defaultValue: 'Discount reason' })}
                            />
                            <input
                              className="input"
                              value={createForm.discountByName}
                              onChange={e => setCreateForm({ ...createForm, discountByName: e.target.value })}
                              placeholder={t('billing:approvedByName', { defaultValue: 'Approved / referred by' })}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="text-lg font-semibold pt-1 border-t border-dashed border-[var(--color-border)] mt-1">
                      {t('billing:grandTotal')}: <span className="text-[var(--color-primary)]">৳{fmtCur(grandTotal, i18n.language)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => { setShowCreate(false); resetCreateForm(); }} className="btn-secondary">{t('common:cancel')}</button>
                  <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                    {createMutation.isPending ? t('billing:creating') : t('billing:createBill')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ─── Payment Modal ───────────────────────────────────── */}
        {showPay && payBill && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('billing:collectPayment')} — {payBill.invoice_no}</h3>
                <button onClick={() => { setShowPay(false); setPayBill(null); }} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handlePay} className="p-5 space-y-4">
                <div className="bg-[var(--color-surface)] p-3 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('billing:patientName')}:</span> <span className="font-medium">{payBill.patient_name}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('billing:total')}:</span> <span className="font-data">৳{fmtCur(getBillTotalAmount(payBill), i18n.language)}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('billing:paid')}:</span> <span className="font-data text-emerald-600">৳{fmtCur(getBillSettledAmount(payBill), i18n.language)}</span></div>
                  {getBillDepositAdjustedAmount(payBill) > 0 ? (
                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('billing:depositAdjusted', { defaultValue: 'Deposit adjusted' })}:</span> <span className="font-data text-emerald-600">৳{fmtCur(getBillDepositAdjustedAmount(payBill), i18n.language)}</span></div>
                  ) : null}
                  <div className="flex justify-between font-semibold border-t border-dashed border-[var(--color-border)] pt-1">
                    <span>{t('billing:outstandingAmount')}:</span> <span className="text-red-600">৳{fmtCur(getBillOutstandingAmount(payBill), i18n.language)}</span>
                  </div>
                </div>

                <div>
                  <label className="label">{t('billing:paymentAmount')}</label>
                  <input className="input" type="number" required min="1" max={getBillOutstandingAmount(payBill)}
                    value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} />
                </div>

                <div>
                  <label className="label">{t('billing:paymentMethod')}</label>
                  <div className="grid grid-cols-4 gap-2">
                    {PAYMENT_METHODS.map(pm => (
                      <button key={pm.value} type="button" onClick={() => {
                        setPayForm({ ...payForm, method: pm.value });
                        if (pm.value === 'cash') setPayReference('');
                      }}
                        className={`p-2 rounded-lg border text-center text-sm transition-colors ${
                          payForm.method === pm.value ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'border-[var(--color-border)] hover:bg-[var(--color-surface)]'
                        }`}>
                        <span className="text-lg">{pm.icon}</span>
                        <div className="text-xs mt-0.5">{pm.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {requiresPaymentReference(payForm.method, Number(payForm.amount)) ? (
                  <div>
                    <label className="label">{t('billing:transactionReference', { defaultValue: 'Transaction / reference number' })}</label>
                    <input
                      className="input"
                      value={payReference}
                      onChange={(event) => setPayReference(event.target.value)}
                      placeholder={t('billing:transactionReferencePlaceholder', { defaultValue: 'bKash/Nagad/card/bank reference' })}
                    />
                  </div>
                ) : null}

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => { setShowPay(false); setPayBill(null); setPayReference(''); }} className="btn-secondary">{t('common:cancel')}</button>
                  <button type="submit" disabled={payMutation.isPending} className="btn-primary">
                    {payMutation.isPending ? t('billing:paying') : `${t('billing:payNow')} ৳${Number(payForm.amount) > 0 ? fmtCur(Number(payForm.amount), i18n.language) : fmtCur(0, i18n.language)}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ─── Bill Detail Modal ───────────────────────────────── */}
        {showDetail && detailBill && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <div>
                  <h3 className="font-semibold">{detailBill.invoice_no}</h3>
                  <p className="text-sm text-[var(--color-text-muted)]">{detailBill.patient_name} ({detailBill.patient_code})</p>
                </div>
                <button onClick={() => setShowDetail(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-4">
                {detailItems.length > 0 ? (
                  <table className="table-base text-sm">
                    <thead>
                      <tr><th>{t('billing:category')}</th><th>{t('billing:description')}</th><th className="text-right">{t('billing:quantity')}</th><th className="text-right">{t('billing:unitPrice')}</th><th className="text-right">{t('billing:total')}</th></tr>
                    </thead>
                    <tbody>
                      {detailItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="capitalize">{categoryLabel(item.itemCategory)}</td>
                          <td>{item.description || '—'}</td>
                          <td className="text-right font-data">{fmtCur(item.quantity, i18n.language)}</td>
                          <td className="text-right font-data">৳{fmtCur(item.unitPrice ?? 0, i18n.language)}</td>
                          <td className="text-right font-data font-medium">৳{fmtCur(item.lineTotal ?? 0, i18n.language)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-6 text-[var(--color-text-muted)]">{t('billing:loadingItems')}</div>
                )}
                <div className="border-t border-[var(--color-border)] pt-4">
                  <h4 className="text-sm font-semibold mb-2">{t('billing:paidBy', { defaultValue: 'Paid by' })}</h4>
                  {detailPayments.length === 0 && detailDepositAdjustments.length === 0 && detailUntracedPaid <= 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">{t('billing:noPaymentLedger', { defaultValue: 'No payment records found for this invoice.' })}</p>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {detailPayments.map(payment => (
                        <div key={`payment-${payment.id}`} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium capitalize">{payment.payment_method || t('billing:unknownMethod', { defaultValue: 'Unknown method' })}</p>
                            <p className="text-xs text-[var(--color-text-muted)] truncate">
                              {payment.receipt_no || t('billing:payment', { defaultValue: 'Payment' })}
                              {payment.payment_type ? ` · ${payment.payment_type}` : ''}
                              {payment.date ? ` · ${fmtDt(payment.date, i18n.language)}` : ''}
                            </p>
                          </div>
                          <span className="font-data font-medium text-emerald-600">৳{fmtCur(payment.amount ?? 0, i18n.language)}</span>
                        </div>
                      ))}
                      {detailDepositAdjustments.map(adjustment => (
                        <div key={`deposit-${adjustment.id}`} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium">{t('billing:depositUsed', { defaultValue: 'Deposit used' })}</p>
                            <p className="text-xs text-[var(--color-text-muted)] truncate">
                              {adjustment.deposit_receipt_no}
                              {adjustment.remarks ? ` · ${adjustment.remarks}` : ''}
                              {adjustment.created_at ? ` · ${fmtDt(adjustment.created_at, i18n.language)}` : ''}
                            </p>
                          </div>
                          <span className="font-data font-medium text-blue-600">৳{fmtCur(adjustment.amount ?? 0, i18n.language)}</span>
                        </div>
                      ))}
                      {detailUntracedPaid > 0 && (
                        <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                          <div className="min-w-0">
                            <p className="font-medium">{t('billing:untracedPaid', { defaultValue: 'Legacy/untraced paid amount' })}</p>
                            <p className="text-xs">{t('billing:untracedPaidHint', { defaultValue: 'Bill paid total is higher than linked payments and deposit adjustments.' })}</p>
                          </div>
                          <span className="font-data font-semibold">৳{fmtCur(detailUntracedPaid, i18n.language)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-right space-y-1 text-sm border-t border-[var(--color-border)] pt-3">
                  <div>{t('billing:subtotal')}: <span className="font-data">৳{fmtCur(detailItemSubtotal || detailBill.subtotal || 0, i18n.language)}</span></div>
                  <div>{t('billing:discount')}: <span className="font-data text-amber-600">-৳{fmtCur(detailBill.discount ?? 0, i18n.language)}</span></div>
                  <div className="font-semibold text-base pt-1">{t('billing:total')}: ৳{fmtCur(getBillTotalAmount(detailBill), i18n.language)}</div>
                  <div className="text-emerald-600">{t('billing:paid')}: ৳{fmtCur(getBillSettledAmount(detailBill), i18n.language)}</div>
                  {detailBill.status !== 'paid' && (
                    <div className="text-red-600 font-semibold">{t('billing:due')}: ৳{fmtCur(getBillOutstandingAmount(detailBill), i18n.language)}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import {
  Receipt, Search, Plus, X, DollarSign, AlertTriangle,
  CreditCard, Printer, Eye, ChevronLeft, ChevronRight, FileText, Banknote
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import HelpButton from '../components/HelpButton';
import HelpPanel from '../components/HelpPanel';
import { useTranslation } from 'react-i18next';

/* ─── Types ─────────────────────────────────────────────────────── */
interface BillItem {
  itemCategory: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
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
}

interface PatientOption {
  id: number;
  name: string;
  patient_code?: string;
  mobile?: string;
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* ─── Constants ────────────────────────────────────────────────── */
const ITEM_CATEGORIES = [
  { value: 'test',          label: 'Lab Test' },
  { value: 'doctor_visit',  label: 'Doctor Visit / Consultation' },
  { value: 'operation',     label: 'Operation / Surgery' },
  { value: 'medicine',      label: 'Medicine' },
  { value: 'admission',     label: 'Admission / Ward Charge' },
  { value: 'fire_service',  label: 'Fire Service' },
  { value: 'other',         label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: 'cash',  label: 'Cash',  icon: '💵' },
  { value: 'bkash', label: 'bKash', icon: '📱' },
  { value: 'bank',  label: 'Bank',  icon: '🏦' },
  { value: 'other', label: 'Other', icon: '💳' },
];

// Helper to get translated category label
const categoryLabel = (key: string) => {
  const map: Record<string, string> = {
    test: 'Lab Test',
    doctor_visit: 'Doctor Visit / Consultation',
    operation: 'Operation / Surgery',
    medicine: 'Medicine',
    admission: 'Admission / Ward Charge',
    fire_service: 'Fire Service',
    other: 'Other',
  };
  return map[key] || key;
};

const STATUS_BADGE: Record<string, { labelKey: string; badge: string }> = {
  open:           { labelKey: 'open',    badge: 'badge-danger' },
  partially_paid: { labelKey: 'partial', badge: 'badge-warning' },
  paid:           { labelKey: 'paid',    badge: 'badge-success' },
};

const DEMO_BILLS: Bill[] = [
  { id: 1, invoice_no: 'INV-2026-0097', patient_name: 'রহিম উদ্দিন',   patient_code: 'PT-001234', subtotal: 1500, discount: 0, total_amount: 1500, paid_amount: 1500, status: 'paid',           created_at: new Date().toISOString() },
  { id: 2, invoice_no: 'INV-2026-0096', patient_name: 'সাবিনা আক্তার',  patient_code: 'PT-001235', subtotal: 2800, discount: 0, total_amount: 2800, paid_amount: 1000, status: 'partially_paid', created_at: new Date().toISOString() },
  { id: 3, invoice_no: 'INV-2026-0095', patient_name: 'মোহাম্মদ করিম',  patient_code: 'PT-001236', subtotal: 12500, discount: 500, total_amount: 12000, paid_amount: 0, status: 'open',     created_at: new Date().toISOString() },
  { id: 4, invoice_no: 'INV-2026-0094', patient_name: 'ফাতেমা বেগম',    patient_code: 'PT-001237', subtotal: 3500, discount: 200, total_amount: 3300, paid_amount: 3300, status: 'paid',      created_at: new Date().toISOString() },
  { id: 5, invoice_no: 'INV-2026-0093', patient_name: 'আবদুল হক',      patient_code: 'PT-001238', subtotal: 8000, discount: 0, total_amount: 8000, paid_amount: 4000, status: 'partially_paid', created_at: new Date().toISOString() },
  { id: 6, invoice_no: 'INV-2026-0092', patient_name: 'নুরুল ইসলাম',    patient_code: 'PT-001239', subtotal: 1200, discount: 0, total_amount: 1200, paid_amount: 0, status: 'open',           created_at: new Date().toISOString() },
];

/* ─── Component ────────────────────────────────────────────────── */
export default function BillingDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const [bills,      setBills]      = useState<Bill[]>([]);
  const [dueBills,   setDueBills]   = useState<Bill[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [page,       setPage]       = useState(1);
  const [meta,       setMeta]       = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [activeTab,  setActiveTab]  = useState<'bills' | 'dues'>('bills');
  const [helpOpen,   setHelpOpen]   = useState(false);

  // Create Bill modal
  const [showCreate,  setShowCreate]  = useState(false);
  const [createForm,  setCreateForm]  = useState({ discount: '0' });
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientSearchDebounced, setPatientSearchDebounced] = useState('');
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [searchPatients, setSearchPatients] = useState<PatientOption[]>([]);
  const [lineItems,   setLineItems]   = useState<{ category: string; description: string; qty: string; price: string }[]>([
    { category: 'doctor_visit', description: '', qty: '1', price: '' },
  ]);
  const [saving,      setSaving]      = useState(false);

  // Pay modal
  const [showPay,     setShowPay]     = useState(false);
  const [payBill,     setPayBill]     = useState<Bill | null>(null);
  const [payForm,     setPayForm]     = useState({ amount: '', method: 'cash', type: 'current' });
  const [paying,      setPaying]      = useState(false);

  // Bill detail modal
  const [showDetail,  setShowDetail]  = useState(false);
  const [detailBill,  setDetailBill]  = useState<Bill | null>(null);
  const [detailItems, setDetailItems] = useState<BillItem[]>([]);

  const { t } = useTranslation(['billing', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();

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

  useEffect(() => {
    if (patientSearchDebounced.length < 2 || !showCreate) { setSearchPatients([]); return; }
    const fetchPatients = async () => {
      try {
        const token = localStorage.getItem('hms_token');
        const { data } = await axios.get('/api/patients', {
          params: { search: patientSearchDebounced, limit: 8 },
          headers: { Authorization: `Bearer ${token}` },
        });
        setSearchPatients(data.patients ?? []);
      } catch {
        setSearchPatients([]);
      }
    };
    fetchPatients();
  }, [patientSearchDebounced, showCreate]);

  /* ─── Data Fetching ─────────────────────────────────────────── */
  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const params: Record<string, string | number> = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (search) params.search = search;

      const { data } = await axios.get('/api/billing', {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
      setBills(data.bills ?? []);
      if (data.meta) setMeta(data.meta);
    } catch {
      console.error('[Billing] Fetch failed, using demo data');
      setBills(DEMO_BILLS);
      setMeta({ page: 1, limit: 20, total: DEMO_BILLS.length, totalPages: 1 });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo, search]);

  const fetchDues = useCallback(async () => {
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/billing/due', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDueBills(data.bills ?? []);
    } catch {
      setDueBills(DEMO_BILLS.filter(b => b.status !== 'paid'));
    }
  }, []);

  useEffect(() => { fetchBills(); }, [fetchBills]);
  useEffect(() => { fetchDues(); }, [fetchDues]);

  /* ─── KPI Calculations ──────────────────────────────────────── */
  const totalRevenue  = bills.reduce((s, b) => s + b.paid_amount, 0);
  const totalDues     = dueBills.reduce((s, b) => s + (b.total_amount - b.paid_amount), 0);
  const billsToday    = bills.filter(b => b.created_at.startsWith(new Date().toISOString().split('T')[0])).length;
  const paidCount     = bills.filter(b => b.status === 'paid').length;
  const collectionRate = bills.length > 0 ? Math.round((paidCount / bills.length) * 100) : 0;

  /* ─── Create Bill ───────────────────────────────────────────── */
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    const patientId = parseInt(selectedPatientId);
    if (!patientId) return toast.error(t('patientIdRequired', { defaultValue: 'Patient ID is required' }));
    const items = lineItems.map(li => ({
      itemCategory: li.category,
      description: li.description || undefined,
      quantity: Number(li.qty) || 1,
      unitPrice: Number(li.price) || 0,
    })).filter(i => i.unitPrice > 0);
    if (items.length === 0) return toast.error(t('addItemRequired', { defaultValue: 'Add at least one item with a price' }));

    setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.post('/api/billing', {
        patientId,
        items,
        discount: Number(createForm.discount) || 0,
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('billCreated', { invoiceNo: data.invoiceNo, defaultValue: `Bill created: ${data.invoiceNo}` }));
      setShowCreate(false);
      resetCreateForm();
      fetchBills();
      fetchDues();
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : t('failedToCreate', { defaultValue: 'Failed to create bill' });
      toast.error(msg ?? t('failedToCreate', { defaultValue: 'Failed to create bill' }));
    } finally {
      setSaving(false);
    }
  };

  const resetCreateForm = () => {
    setCreateForm({ discount: '0' });
    setSelectedPatientId('');
    setPatientSearch('');
    setPatientSearchDebounced('');
    setLineItems([{ category: 'doctor_visit', description: '', qty: '1', price: '' }]);
  };

  const addLineItem = () => setLineItems(prev => [...prev, { category: 'other', description: '', qty: '1', price: '' }]);
  const removeLineItem = (idx: number) => setLineItems(prev => prev.filter((_, i) => i !== idx));
  const updateLineItem = (idx: number, field: string, value: string) =>
    setLineItems(prev => prev.map((li, i) => i === idx ? { ...li, [field]: value } : li));

  const subtotal = lineItems.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.price) || 0), 0);
  const grandTotal = Math.max(0, subtotal - (Number(createForm.discount) || 0));

  /* ─── Collect Payment ───────────────────────────────────────── */
  const openPayModal = (bill: Bill) => {
    setPayBill(bill);
    setPayForm({ amount: String(bill.total_amount - bill.paid_amount), method: 'cash', type: 'current' });
    setShowPay(true);
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payBill) return;
    const amount = parseInt(payForm.amount);
    if (!amount || amount <= 0) return toast.error(t('invalidAmount', { defaultValue: 'Invalid amount' }));

    setPaying(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.post('/api/billing/pay', {
        billId: payBill.id,
        amount,
        type: payForm.type,
        paymentMethod: payForm.method,
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('paymentRecorded', { receiptNo: data.receiptNo, defaultValue: `Payment recorded — Receipt: ${data.receiptNo}` }));
      setShowPay(false);
      setPayBill(null);
      fetchBills();
      fetchDues();
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : t('paymentFailed', { defaultValue: 'Payment failed' });
      toast.error(msg ?? t('paymentFailed', { defaultValue: 'Payment failed' }));
    } finally {
      setPaying(false);
    }
  };

  /* ─── View Bill Detail ──────────────────────────────────────── */
  const viewBillDetail = async (bill: Bill) => {
    setDetailBill(bill);
    setDetailItems([]);
    setShowDetail(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get(`/api/billing/${bill.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDetailItems(data.items ?? []);
    } catch {
      setDetailItems([
        { itemCategory: 'doctor_visit', description: 'OPD Consultation', quantity: 1, unitPrice: 500, lineTotal: 500 },
        { itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: 1000, lineTotal: 1000 },
      ]);
    }
  };

  /* ─── Display list ──────────────────────────────────────────── */
  const displayedBills = activeTab === 'dues' ? dueBills : bills;

  return (
    <DashboardLayout role={role}>
      <HelpPanel pageKey="billing" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title', { defaultValue: 'Billing & Payments' })}</h1>
            <p className="section-subtitle mt-1">{t('subtitle', { defaultValue: 'Create bills, collect payments, track outstanding dues' })}</p>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton onClick={() => setHelpOpen(true)} />
            <button onClick={() => setShowCreate(true)} className="btn-primary">
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
              ৳{totalDues.toLocaleString()} {t('outstandingAcross', { defaultValue: 'outstanding across' })} {dueBills.length} {t('billCount', { defaultValue: 'bill', count: dueBills.length })}{dueBills.length > 1 ? 's' : ''} —{' '}
              <button onClick={() => setActiveTab('dues')} className="underline font-semibold">{t('viewDues', { defaultValue: 'View Dues' })}</button>
            </span>
          </div>
        )}

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('todayRevenue', { defaultValue: "Today's Revenue" })} value={`৳${totalRevenue.toLocaleString()}`} loading={loading} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title={t('outstandingDues', { defaultValue: 'Outstanding Dues' })} value={`৳${totalDues.toLocaleString()}`} loading={loading} icon={<AlertTriangle className="w-5 h-5"/>} iconBg="bg-red-50 text-red-600" />
          <KPICard title={t('billsToday', { defaultValue: 'Bills Today' })} value={billsToday} loading={loading} icon={<Receipt className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('collectionRate', { defaultValue: 'Collection Rate' })} value={`${collectionRate}%`} loading={loading} icon={<CreditCard className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-[var(--color-border)]">
          {([['bills', 'All Bills'], ['dues', 'Outstanding Dues']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}>
              {t(key === 'bills' ? 'allBills' : 'outstandingDues', { defaultValue: label })}
            </button>
          ))}
        </div>

        {/* ── Search & Filters (All Bills tab only) ── */}
        {activeTab === 'bills' && (
          <div className="card p-3 sm:p-4">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input type="text" placeholder={t('searchPlaceholder', { defaultValue: 'Search invoice, patient name or code…' })}
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
                    {t(key, { ns: 'billing', defaultValue: key === 'all' ? 'All' : key })}
                  </button>
                ))}
              </div>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                className="input w-36 text-sm shrink-0" aria-label={t('dateFrom', { defaultValue: 'From' })} />
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
                className="input w-36 text-sm shrink-0" aria-label={t('dateTo', { defaultValue: 'To' })} />
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
                    <p>{activeTab === 'dues' ? t('noOutstandingDues', { defaultValue: 'No outstanding dues' }) : t('noBillsFound', { defaultValue: 'No bills found' })}</p>
                  </div>
                )
              : displayedBills.map(bill => {
                  const st = STATUS_BADGE[bill.status] ?? STATUS_BADGE.open;
                  const outstanding = bill.total_amount - bill.paid_amount;
                  return (
                    <div key={bill.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{bill.patient_name}</p>
                          <p className="text-xs text-[var(--color-text-muted)] font-data">{bill.invoice_no} · {new Date(bill.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</p>
                        </div>
                        <span className={`badge ${st.badge} shrink-0`}>{t(st.labelKey, { defaultValue: st.labelKey })}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div className="space-x-3 font-data">
                          <span>{t('total', { defaultValue: 'Total' })}: <span className="font-medium">৳{bill.total_amount.toLocaleString()}</span></span>
                          <span className="text-emerald-600">{t('paid', { defaultValue: 'Paid' })}: ৳{bill.paid_amount.toLocaleString()}</span>
                          {activeTab === 'dues' && outstanding > 0 && (
                            <span className="text-red-600 font-semibold">{t('due', { defaultValue: 'Due' })}: ৳{outstanding.toLocaleString()}</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {bill.status !== 'paid' && (
                            <button onClick={() => openPayModal(bill)} className="btn-ghost p-1.5 text-emerald-600" title={t('pay', { defaultValue: 'Pay' })}><Banknote className="w-4 h-4" /></button>
                          )}
                          <button onClick={() => viewBillDetail(bill)} className="btn-ghost p-1.5" title={t('view', { ns: 'common' })}><Eye className="w-4 h-4" /></button>
                          <button onClick={() => window.open(`/h/${slug}/billing/${bill.id}/print`, '_blank')} className="btn-ghost p-1.5" title={t('print', { ns: 'common' })}><Printer className="w-4 h-4" /></button>
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
                  <th>{t('invoice', { defaultValue: 'Invoice#' })}</th>
                  <th>{t('patientName', { defaultValue: 'Patient' })}</th>
                  <th>{t('code', { defaultValue: 'Code' })}</th>
                  <th>{t('date', { ns: 'common', defaultValue: 'Date' })}</th>
                  <th>{t('total', { defaultValue: 'Total (৳)' })}</th>
                  <th>{t('paid', { defaultValue: 'Paid (৳)' })}</th>
                  {activeTab === 'dues' && <th>{t('outstanding', { defaultValue: 'Due (৳)' })}</th>}
                  <th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th>
                  <th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => <tr key={i}>{[...Array(activeTab === 'dues' ? 9 : 8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : displayedBills.length === 0 ? (
                  <tr><td colSpan={activeTab === 'dues' ? 9 : 8} className="py-16 text-center text-[var(--color-text-muted)]">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    {activeTab === 'dues' ? t('noOutstandingDues', { defaultValue: 'No outstanding dues' }) : t('noBillsFound', { defaultValue: 'No bills found' })}
                  </td></tr>
                ) : (
                  displayedBills.map(bill => {
                    const st = STATUS_BADGE[bill.status] ?? STATUS_BADGE.open;
                    const outstanding = bill.total_amount - bill.paid_amount;
                    return (
                      <tr key={bill.id}>
                        <td className="font-medium font-data">{bill.invoice_no}</td>
                        <td className="font-medium">{bill.patient_name}</td>
                        <td className="text-[var(--color-text-muted)] font-data">{bill.patient_code}</td>
                        <td className="text-[var(--color-text-secondary)] font-data">{new Date(bill.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                        <td className="font-data font-medium">৳{(bill.total_amount ?? 0).toLocaleString()}</td>
                        <td className="font-data text-emerald-600">৳{(bill.paid_amount ?? 0).toLocaleString()}</td>
                        {activeTab === 'dues' && <td className="font-data text-red-600 font-semibold">৳{outstanding.toLocaleString()}</td>}
                        <td><span className={`badge ${st.badge}`}>{t(st.labelKey, { defaultValue: st.labelKey })}</span></td>
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
                {t('pageOf', { defaultValue: 'Page' })} {meta.page} {t('of', { defaultValue: 'of' })} {meta.totalPages} ({meta.total} {t('bills', { defaultValue: 'bills' })})
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
                <h3 className="font-semibold text-lg">{t('createBill', { defaultValue: 'Create New Bill' })}</h3>
                <button onClick={() => { setShowCreate(false); resetCreateForm(); }} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleCreateBill} className="p-5 space-y-5">
                {/* Patient */}
                <div>
                  <label className="label">{t('searchPatient', { defaultValue: 'Search Patient *' })}</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                      className="input pl-9 w-full"
                      type="text"
                      required
                      placeholder={t('searchPatientPlaceholder', { defaultValue: 'Name, mobile or patient code' })}
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
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('patientId', { defaultValue: 'Patient ID' })}: {selectedPatientId}</p>
                  )}
                </div>

                {/* Line Items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="label mb-0">{t('items', { defaultValue: 'Line Items *' })}</label>
                    <button type="button" onClick={addLineItem} className="text-sm text-[var(--color-primary)] font-medium hover:underline">
                      + {t('addLineItem', { defaultValue: 'Add Item' })}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {lineItems.map((li, idx) => (
                      <div key={idx} className="flex gap-2 items-start bg-[var(--color-surface)] p-3 rounded-lg">
                        <select className="input flex-shrink-0 w-40" value={li.category}
                          onChange={e => updateLineItem(idx, 'category', e.target.value)}>
                          {ITEM_CATEGORIES.map(c => <option key={c.value} value={c.value}>{t(`category_${c.value}`, { defaultValue: c.label })}</option>)}
                        </select>
                        <input className="input flex-1" placeholder={t('descriptionPlaceholder', { defaultValue: 'Description' })}
                          value={li.description} onChange={e => updateLineItem(idx, 'description', e.target.value)} />
                        <input className="input w-16 text-center" type="number" min="1" placeholder={t('quantity', { defaultValue: 'Qty' })}
                          value={li.qty} onChange={e => updateLineItem(idx, 'qty', e.target.value)} />
                        <input className="input w-24" type="number" min="0" placeholder={t('unitPricePlaceholder', { defaultValue: 'Price (৳)' })}
                          value={li.price} onChange={e => updateLineItem(idx, 'price', e.target.value)} />
                        <span className="w-20 text-right font-data text-sm py-2">
                          ৳{((Number(li.qty) || 0) * (Number(li.price) || 0)).toLocaleString()}
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
                    <div className="text-[var(--color-text-muted)]">{t('subtotal', { defaultValue: 'Subtotal' })}: <span className="font-data font-medium text-[var(--color-text)]">৳{subtotal.toLocaleString()}</span></div>
                    <div className="flex items-center gap-2 justify-end">
                      <span className="text-[var(--color-text-muted)]">{t('discount', { defaultValue: 'Discount' })}:</span>
                      <input className="input w-24 text-right" type="number" min="0" placeholder={t("billing.0")}
                        value={createForm.discount} onChange={e => setCreateForm({ ...createForm, discount: e.target.value })} />
                    </div>
                    <div className="text-lg font-semibold pt-1 border-t border-dashed border-[var(--color-border)] mt-1">
                      {t('grandTotal', { defaultValue: 'Grand Total' })}: <span className="text-[var(--color-primary)]">৳{grandTotal.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => { setShowCreate(false); resetCreateForm(); }} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? t('creating', { defaultValue: 'Creating…' }) : t('createBillBtn', { defaultValue: 'Create Bill' })}
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
                <h3 className="font-semibold">{t('collectPayment', { defaultValue: 'Collect Payment' })} — {payBill.invoice_no}</h3>
                <button onClick={() => { setShowPay(false); setPayBill(null); }} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handlePay} className="p-5 space-y-4">
                <div className="bg-[var(--color-surface)] p-3 rounded-lg text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('patientName', { defaultValue: 'Patient' })}:</span> <span className="font-medium">{payBill.patient_name}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('total', { defaultValue: 'Total' })}:</span> <span className="font-data">৳{payBill.total_amount.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('paid', { defaultValue: 'Paid' })}:</span> <span className="font-data text-emerald-600">৳{payBill.paid_amount.toLocaleString()}</span></div>
                  <div className="flex justify-between font-semibold border-t border-dashed border-[var(--color-border)] pt-1">
                    <span>{t('outstandingAmount', { defaultValue: 'Outstanding' })}:</span> <span className="text-red-600">৳{(payBill.total_amount - payBill.paid_amount).toLocaleString()}</span>
                  </div>
                </div>

                <div>
                  <label className="label">{t('paymentAmount', { defaultValue: 'Amount (৳) *' })}</label>
                  <input className="input" type="number" required min="1" max={payBill.total_amount - payBill.paid_amount}
                    value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} />
                </div>

                <div>
                  <label className="label">{t('paymentMethod', { defaultValue: 'Payment Method' })}</label>
                  <div className="grid grid-cols-4 gap-2">
                    {PAYMENT_METHODS.map(pm => (
                      <button key={pm.value} type="button" onClick={() => setPayForm({ ...payForm, method: pm.value })}
                        className={`p-2 rounded-lg border text-center text-sm transition-colors ${
                          payForm.method === pm.value ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'border-[var(--color-border)] hover:bg-[var(--color-surface)]'
                        }`}>
                        <span className="text-lg">{pm.icon}</span>
                        <div className="text-xs mt-0.5">{t(`payMethod_${pm.value}`, { defaultValue: pm.label })}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => { setShowPay(false); setPayBill(null); }} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                  <button type="submit" disabled={paying} className="btn-primary">
                    {paying ? t('paying', { defaultValue: 'Paying…' }) : `${t('payNow', { defaultValue: 'Pay' })} ৳${Number(payForm.amount) > 0 ? Number(payForm.amount).toLocaleString() : '0'}`}
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
                      <tr><th>{t('category', { defaultValue: 'Category' })}</th><th>{t('description', { defaultValue: 'Description' })}</th><th className="text-right">{t('quantity', { defaultValue: 'Qty' })}</th><th className="text-right">{t('unitPrice', { defaultValue: 'Price' })}</th><th className="text-right">{t('total', { defaultValue: 'Total' })}</th></tr>
                    </thead>
                    <tbody>
                      {detailItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="capitalize">{categoryLabel(item.itemCategory)}</td>
                          <td>{item.description || '—'}</td>
                          <td className="text-right font-data">{item.quantity}</td>
                          <td className="text-right font-data">৳{(item.unitPrice ?? 0).toLocaleString()}</td>
                          <td className="text-right font-data font-medium">৳{(item.lineTotal ?? 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-6 text-[var(--color-text-muted)]">{t('loadingItems', { defaultValue: 'Loading items…' })}</div>
                )}
                <div className="text-right space-y-1 text-sm border-t border-[var(--color-border)] pt-3">
                  <div>{t('subtotal', { defaultValue: 'Subtotal' })}: <span className="font-data">৳{(detailBill.subtotal ?? 0).toLocaleString()}</span></div>
                  <div>{t('discount', { defaultValue: 'Discount' })}: <span className="font-data text-amber-600">-৳{(detailBill.discount ?? 0).toLocaleString()}</span></div>
                  <div className="font-semibold text-base pt-1">{t('total', { defaultValue: 'Total' })}: ৳{(detailBill.total_amount ?? 0).toLocaleString()}</div>
                  <div className="text-emerald-600">{t('paid', { defaultValue: 'Paid' })}: ৳{(detailBill.paid_amount ?? 0).toLocaleString()}</div>
                  {detailBill.status !== 'paid' && (
                    <div className="text-red-600 font-semibold">{t('due', { defaultValue: 'Due' })}: ৳{((detailBill.total_amount ?? 0) - (detailBill.paid_amount ?? 0)).toLocaleString()}</div>
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

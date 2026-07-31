import { useState, useEffect } from 'react';
import { FileText, Plus, X, XCircle, CheckCircle, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface ProvisionalItem {
  id: number;
  patient_id: number;
  patient_name?: string;
  service_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  total_amount: number;
  bill_status: 'provisional' | 'billed' | 'cancelled';
  created_at: string;
  cancel_reason?: string;
  billed_bill_id?: number;
}

interface Summary { total_items: number; total_amount: number; billed_count: number; cancelled_count: number; provisional_count: number; }

const PAGE_SIZE = 25;

interface ServiceItemOption {
  id: number;
  item_name: string;
  item_code?: string | null;
  price?: number;
  unit_price?: number;
  department_name?: string | null;
}

interface PatientOption {
  id: number;
  name: string;
  patient_code?: string | null;
  mobile?: string | null;
  age?: number | null;
  gender?: string | null;
}

interface DraftRow {
  service_item_id: string;
  service_name: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
}

interface SchemePreviewResponse {
  eligible: boolean;
  scheme_id: number | null;
  scheme_name: string | null;
  scheme_code?: string | null;
  suggested_discount: number;
  allocation_type: string;
  matched_member_id?: number | null;
  matched_member_code?: string | null;
  service_category?: string | null;
  blockers: string[];
}

function servicePrice(item: ServiceItemOption) {
  return Number(item.price ?? item.unit_price ?? 0);
}

const emptyDraftRow = (): DraftRow => ({
  service_item_id: '',
  service_name: '',
  quantity: '1',
  unit_price: '',
  discount_amount: '0',
});

export default function ProvisionalBillingPage({ role = 'hospital_admin' }: { role?: string }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [patientIdFilter, setPatientIdFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const { t } = useTranslation(['billing', 'common']);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, patientIdFilter, debouncedSearch]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([emptyDraftRow()]);
  const [createPatientSearch, setCreatePatientSearch] = useState('');
  const [debouncedCreatePatientSearch, setDebouncedCreatePatientSearch] = useState('');
  const [selectedCreatePatient, setSelectedCreatePatient] = useState<PatientOption | null>(null);
  const [showCreatePatientDropdown, setShowCreatePatientDropdown] = useState(false);

  // Cancel modal
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // Pay modal
  const [payPatientId, setPayPatientId] = useState<number | null>(null);
  const [payItemCount, setPayItemCount] = useState(0);
  const [payForm, setPayForm] = useState({ payment_method: 'Cash', remarks: '', discount_amount: '0' });
  const [paySchemeCode, setPaySchemeCode] = useState('');
  const [payMemberCode, setPayMemberCode] = useState('');
  const [paySchemePreview, setPaySchemePreview] = useState<SchemePreviewResponse | null>(null);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowCreate(false); setCancelId(null); setPayPatientId(null); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCreatePatientSearch(createPatientSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [createPatientSearch]);

  const listParams = new URLSearchParams();
  listParams.set('limit', String(PAGE_SIZE));
  listParams.set('offset', String((page - 1) * PAGE_SIZE));
  if (statusFilter !== 'all') listParams.set('status', statusFilter);
  if (patientIdFilter) listParams.set('patientId', patientIdFilter);
  if (debouncedSearch) listParams.set('search', debouncedSearch);

  const summaryParams = new URLSearchParams();
  if (statusFilter !== 'all') summaryParams.set('status', statusFilter);

  const listFilters = { status: statusFilter, patientId: patientIdFilter, search: debouncedSearch, page };
  const summaryFilters = { status: statusFilter };

  const { data: listRaw, isLoading: listLoading } = useApiQuery<any>(
    queryKeys.provisional.list(listFilters),
    `/api/billing-provisional?${listParams.toString()}`,
  );
  const { data: summaryRaw, isLoading: summaryLoading } = useApiQuery<any>(
    queryKeys.provisional.summary(summaryFilters),
    `/api/billing-provisional/summary${summaryParams.toString() ? `?${summaryParams.toString()}` : ''}`,
  );
  const { data: serviceItemsRaw } = useApiQuery<{ data: ServiceItemOption[] }>(
    ['provisional', 'service-items'],
    '/api/billing-master/service-items?per_page=200',
  );
  const { data: createPatientsRaw, isLoading: loadingCreatePatients } = useApiQuery<{ patients: PatientOption[] }>(
    ['provisional', 'patient-search', debouncedCreatePatientSearch],
    `/api/patients?search=${encodeURIComponent(debouncedCreatePatientSearch)}&limit=8`,
    { enabled: showCreate && debouncedCreatePatientSearch.length >= 2, staleTime: 15_000 },
  );

  const items: ProvisionalItem[] = listRaw?.data ?? [];
  const serviceItems = serviceItemsRaw?.data ?? [];
  const createPatients = createPatientsRaw?.patients ?? [];
  const total = listRaw?.total ?? listRaw?.data?.length ?? 0;
  const paySubtotal = payPatientId
    ? items.filter((item) => item.patient_id === payPatientId && item.bill_status === 'provisional').reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0)
    : 0;
  const summary: Summary | null = summaryRaw ?? null;
  const loading = listLoading || summaryLoading;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.provisional.all });
  };

  const createMutation = useApiMutation<any, any>('post', '/api/billing-provisional/batch', {
    onSuccess: () => {
      toast.success(t('provisionalCreated', { defaultValue: 'Provisional items created' }));
      setShowCreate(false);
      setRows([emptyDraftRow()]);
      setCreatePatientSearch('');
      setDebouncedCreatePatientSearch('');
      setSelectedCreatePatient(null);
      setShowCreatePatientDropdown(false);
      invalidateAll();
    },
    onError: (err) => { toast.error(err.message || 'Failed'); },
  });

  const cancelMutation = useApiMutation<any, { id: number; cancel_reason?: string }>('put', (vars) => `/api/billing-provisional/${vars.id}/cancel`, {
    onSuccess: () => {
      toast.success(t('cancelled', { defaultValue: 'Cancelled' }));
      setCancelId(null); setCancelReason('');
      invalidateAll();
    },
    onError: (err) => { toast.error(err.message || t('failed', { defaultValue: 'Failed' })); },
  });

  const checkPaySchemePreviewMutation = useApiMutation<SchemePreviewResponse, { patient_id?: number; scheme_code?: string; member_code?: string; service_category?: string; subtotal: number }>('post', '/api/billing-master/apply-scheme-preview', {
    onSuccess: (preview) => {
      setPaySchemePreview(preview);
      if (preview.eligible) toast.success('Eligible scheme benefit');
      else toast.error(preview.blockers?.[0] ?? 'Scheme is not eligible.');
    },
    onError: (err) => { toast.error(err.message || 'Failed to check provisional benefit'); },
  });

  const payMutation = useApiMutation<any, any>('post', '/api/billing-provisional/pay', {
    onSuccess: () => {
      toast.success(t('invoiceCreated', { defaultValue: 'Invoice created' }));
      setPayPatientId(null);
      setPaySchemeCode('');
      setPayMemberCode('');
      setPaySchemePreview(null);
      invalidateAll();
    },
    onError: (err) => { toast.error(err.message || t('failed', { defaultValue: 'Failed' })); },
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCreatePatient?.id) {
      toast.error(t('selectPatientRequired', { defaultValue: 'Select a patient from search first' }));
      return;
    }
    const validRows = rows.filter(r => r.service_item_id);
    if (validRows.length === 0) { toast.error(t('addServiceRequired', { defaultValue: 'Add at least one service item' })); return; }
    createMutation.mutate({
      patient_id: selectedCreatePatient.id,
      items: validRows.map(r => ({
        service_item_id: Number(r.service_item_id),
        quantity: parseInt(r.quantity) || 1,
        discount_amount: parseFloat(r.discount_amount) || 0,
      })),
    });
  };

  const handleCancel = async () => {
    if (!cancelId) return;
    if (!confirm(t('confirmCancelProvisional', { defaultValue: 'Are you sure you want to cancel this provisional item?' }))) return;
    cancelMutation.mutate({ id: cancelId, cancel_reason: cancelReason || undefined });
  };

  const openPayModal = (patientId: number) => {
    const count = items.filter(i => i.patient_id === patientId && i.bill_status === 'provisional').length;
    setPayPatientId(patientId);
    setPayItemCount(count);
    setPayForm({ payment_method: 'Cash', remarks: '', discount_amount: '0' });
    setPaySchemeCode('');
    setPayMemberCode('');
    setPaySchemePreview(null);
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault(); if (!payPatientId) return;
    const discountAmount = parseFloat(payForm.discount_amount) || 0;
    payMutation.mutate({
      patient_id: payPatientId,
      ...payForm,
      discount_amount: discountAmount,
      schemeApplication: paySchemePreview?.eligible && discountAmount > 0 ? {
        schemeId: paySchemePreview.scheme_id ?? undefined,
        schemeCode: (paySchemePreview.scheme_code ?? paySchemeCode.trim()) || undefined,
        memberCode: (paySchemePreview.matched_member_code ?? payMemberCode.trim()) || undefined,
        memberId: paySchemePreview.matched_member_id ?? undefined,
        serviceCategory: paySchemePreview.service_category ?? 'provisional_bill',
        allocationType: paySchemePreview.allocation_type,
        suggestedDiscount: paySchemePreview.suggested_discount,
      } : undefined,
    });
  };

  const STATUS_CFG: Record<string, { labelKey: string; cls: string }> = {
    provisional: { labelKey: 'provisional', cls: 'badge-warning' },
    billed:      { labelKey: 'billed',      cls: 'badge-success' },
    cancelled:   { labelKey: 'cancelled',   cls: 'badge-error'   },
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('provisionalTitle', { defaultValue: 'Provisional Billing' })}</h1>
              <p className="section-subtitle">{t('provisionalSubtitle', { defaultValue: 'Manage pre-billing items before final invoice' })}</p>
            </div>
          </div>
          <button onClick={() => { setShowCreate(true); setShowCreatePatientDropdown(false); }} className="btn-primary"><Plus className="w-4 h-4" />{t('addItems', { defaultValue: 'Add Items' })}</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <KPICard title={t('totalItems', { defaultValue: 'Total Items' })}     value={summary?.total_items ?? 0}               loading={loading} icon={<FileText className="w-5 h-5" />}    iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('totalAmount', { defaultValue: 'Total Amount' })}    value={`৳${(summary?.total_amount ?? 0).toLocaleString()}`} loading={loading} icon={<FileText className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={1} />
          <KPICard title={t('provisional', { defaultValue: 'Provisional' })}     value={summary?.provisional_count ?? 0}          loading={loading} icon={<Clock className="w-5 h-5" />}        iconBg="bg-orange-50 text-orange-600"  index={2} />
          <KPICard title={t('billed', { defaultValue: 'Billed' })}          value={summary?.billed_count ?? 0}               loading={loading} icon={<CheckCircle className="w-5 h-5" />}  iconBg="bg-emerald-50 text-emerald-600" index={3} />
        </div>

        {/* Filters */}
        <div className="card p-3 flex gap-3 flex-wrap items-center">
          {['all', 'provisional', 'billed', 'cancelled'].map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${statusFilter === s ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            >{t(`provFilter_${s}`, { defaultValue: s === 'all' ? 'All' : s })}</button>
          ))}
          <input className="input" placeholder={t('searchByNameCode', { defaultValue: 'Search by item/patient name…' })} value={search} onChange={e => setSearch(e.target.value)} />
          <input className="input w-44" placeholder={t('filterByPatientId', { defaultValue: 'Filter by Patient ID…' })} value={patientIdFilter} onChange={e => { setPatientIdFilter(e.target.value); setPage(1); }} type="number" />
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('patient', { ns: 'billing', defaultValue: 'Patient' })}</th><th>{t('service', { defaultValue: 'Service' })}</th><th>{t('qty', { defaultValue: 'Qty' })}</th><th>{t('unitPrice', { ns: 'billing', defaultValue: 'Unit Price' })}</th><th>{t('discount', { ns: 'billing', defaultValue: 'Discount' })}</th><th>{t('total', { ns: 'billing', defaultValue: 'Total' })}</th><th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th><th>{t('date', { ns: 'common', defaultValue: 'Date' })}</th><th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th></tr></thead>
              <tbody>
                {loading
                  ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : items.length === 0
                  ? <tr><td colSpan={9}><EmptyState icon={<FileText className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noProvisionalItems', { defaultValue: 'No provisional items' })} description={t('noProvisionalItemsDesc', { defaultValue: 'Add items before creating the final invoice.' })} action={<button onClick={() => setShowCreate(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('addItems', { defaultValue: 'Add Items' })}</button>} /></td></tr>
                  : items.map(item => (
                    <tr key={item.id}>
                      <td className="font-data">{item.patient_name ?? `#${item.patient_id}`}</td>
                      <td className="font-medium">{item.service_name}</td>
                      <td className="font-data text-center">{item.quantity}</td>
                      <td className="font-data text-right">৳{(item.unit_price ?? 0).toLocaleString()}</td>
                      <td className="font-data text-right text-amber-600">৳{(item.discount_amount ?? 0).toLocaleString()}</td>
                      <td className="font-data font-semibold text-right">৳{(item.total_amount ?? 0).toLocaleString()}</td>
                      <td><span className={`badge ${STATUS_CFG[item.bill_status]?.cls ?? 'badge-info'}`}>{t(STATUS_CFG[item.bill_status]?.labelKey ?? item.bill_status, { defaultValue: item.bill_status })}</span></td>
                      <td className="font-data text-sm">{item.created_at?.split('T')[0]}</td>
                      <td>
                        {item.bill_status === 'provisional' && (
                          <div className="flex gap-1">
                            <button onClick={() => openPayModal(item.patient_id)} className="btn-ghost p-1.5 text-emerald-600" title={t('convertToInvoice', { defaultValue: 'Convert to Invoice' })}><CheckCircle className="w-4 h-4" /></button>
                            <button onClick={() => setCancelId(item.id)} className="btn-ghost p-1.5 text-red-500" title={t('cancel', { ns: 'common' })}><XCircle className="w-4 h-4" /></button>
                          </div>
                        )}
                        {item.billed_bill_id && <span className="text-xs text-[var(--color-text-muted)]">Bill #{item.billed_bill_id}</span>}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t border-[var(--color-border)]">
              <span className="text-sm text-[var(--color-text-muted)]">{t('recordsPage', { total, page, totalPages, defaultValue: `${total} records · Page ${page} of ${totalPages}` })}</span>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
              <h3 className="font-semibold">{t('addProvisionalItems', { defaultValue: 'Add Provisional Items' })}</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="relative">
                <label className="label">{t('patient', { ns: 'billing', defaultValue: 'Patient' })} *</label>
                <input
                  className="input w-full"
                  type="text"
                  required
                  placeholder={t('searchPatientNameMobileCode', { defaultValue: 'Search by name, mobile, or patient ID' })}
                  value={selectedCreatePatient ? `${selectedCreatePatient.name} (${selectedCreatePatient.patient_code ?? selectedCreatePatient.id})` : createPatientSearch}
                  onChange={(e) => {
                    setCreatePatientSearch(e.target.value);
                    setSelectedCreatePatient(null);
                    setShowCreatePatientDropdown(true);
                  }}
                  onFocus={() => setShowCreatePatientDropdown(true)}
                />
                {showCreatePatientDropdown && !selectedCreatePatient && createPatientSearch.trim().length >= 2 ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
                    {loadingCreatePatients ? (
                      <div className="px-3 py-3 text-sm text-[var(--color-text-muted)]">Searching patients...</div>
                    ) : createPatients.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-amber-700">No patient found for this search.</div>
                    ) : createPatients.map((patient) => (
                      <button
                        key={patient.id}
                        type="button"
                        className="block w-full border-b border-[var(--color-border)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--color-bg)]"
                        onClick={() => {
                          setSelectedCreatePatient(patient);
                          setCreatePatientSearch(`${patient.name} (${patient.patient_code ?? patient.id})`);
                          setShowCreatePatientDropdown(false);
                        }}
                      >
                        <span className="block font-medium">{patient.name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {patient.patient_code ?? `#${patient.id}`}{patient.mobile ? ` · ${patient.mobile}` : ''}{patient.gender ? ` · ${patient.gender}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {selectedCreatePatient ? (
                  <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Selected: {selectedCreatePatient.name} · {selectedCreatePatient.patient_code ?? `#${selectedCreatePatient.id}`}{selectedCreatePatient.mobile ? ` · ${selectedCreatePatient.mobile}` : ''}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <label className="label">{t('serviceItems', { defaultValue: 'Service Items' })}</label>
                {rows.map((row, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      className="input col-span-4"
                      value={row.service_item_id}
                      onChange={e => {
                        const item = serviceItems.find(si => String(si.id) === e.target.value);
                        const r = [...rows];
                        r[i] = {
                          ...r[i],
                          service_item_id: item ? String(item.id) : '',
                          service_name: item?.item_name ?? '',
                          unit_price: item ? String(servicePrice(item)) : '',
                        };
                        setRows(r);
                      }}
                      required
                    >
                      <option value="">{t('selectServiceItem', { defaultValue: 'Select service item *' })}</option>
                      {serviceItems.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.item_name}{item.department_name ? ` - ${item.department_name}` : ''} · ৳{servicePrice(item).toLocaleString()}
                        </option>
                      ))}
                    </select>
                    <input className="input col-span-2" type="number" placeholder={t('qty', { defaultValue: 'Qty' })} min="1" value={row.quantity} onChange={e => { const r = [...rows]; r[i].quantity = e.target.value; setRows(r); }} />
                    <input className="input col-span-3 bg-[var(--color-border-light)]" type="number" placeholder={t('unitPriceLabel', { defaultValue: 'Unit price *' })} min="0" step="0.01" value={row.unit_price} readOnly required />
                    <input className="input col-span-2" type="number" placeholder={t('discount', { ns: 'billing', defaultValue: 'Discount' })} min="0" step="0.01" value={row.discount_amount} onChange={e => { const r = [...rows]; r[i].discount_amount = e.target.value; setRows(r); }} />
                    {rows.length > 1 && <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="btn-ghost p-1.5 text-red-500"><X className="w-4 h-4" /></button>}
                  </div>
                ))}
                <button type="button" onClick={() => setRows([...rows, emptyDraftRow()])} className="btn-secondary text-sm"><Plus className="w-3.5 h-3.5" />{t('addRow', { defaultValue: 'Add Row' })}</button>
              </div>
              <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('saving', { ns: 'billing', defaultValue: 'Saving…' }) : t('createItems', { defaultValue: 'Create Items' })}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('cancelProvisionalItem', { defaultValue: 'Cancel Provisional Item' })}</h3>
              <button onClick={() => setCancelId(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="label">{t('cancelReason', { defaultValue: 'Cancel Reason' })}</label><input className="input" value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder={t('optionalReason', { defaultValue: 'Optional reason…' })} /></div>
              <div className="flex justify-end gap-3"><button onClick={() => setCancelId(null)} className="btn-secondary">{t('back', { ns: 'common' })}</button><button onClick={handleCancel} disabled={cancelMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">{cancelMutation.isPending ? t('cancelling', { defaultValue: 'Cancelling…' }) : t('confirmCancel', { defaultValue: 'Confirm Cancel' })}</button></div>
            </div>
          </div>
        </div>
      )}

      {/* Pay / Convert to Invoice Modal */}
      {payPatientId !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('convertToInvoiceTitle', { defaultValue: 'Convert to Invoice — Patient #{{payPatientId}}', payPatientId })}</h3>
              <button onClick={() => setPayPatientId(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handlePay} className="p-5 space-y-4">
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {t('convertWarning', { defaultValue: 'You are about to convert ' })}
                  <strong>{payItemCount}</strong>
                  {' '}{t('provisionalItemPlural', { defaultValue: payItemCount !== 1 ? 'provisional items' : 'provisional item' })}
                  {' '}{t('forPatient', { defaultValue: 'for Patient #' })}
                  {payPatientId}
                  {' '}{t('intoInvoice', { defaultValue: 'into a final invoice.' })}
                </p>
              </div>
              <div><label className="label">{t('paymentMethod', { ns: 'billing', defaultValue: 'Payment Method' })}</label><select className="input" value={payForm.payment_method} onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}><option>{t('cash', { ns: 'billing', defaultValue: 'Cash' })}</option><option>{t('card', { ns: 'billing', defaultValue: 'Card' })}</option><option>{t('mobile', { ns: 'billing', defaultValue: 'Mobile Banking' })}</option><option>{t('cheque', { defaultValue: 'Cheque' })}</option><option>{t('credit', { defaultValue: 'Credit' })}</option></select></div>
              <div><label className="label">{t('additionalDiscount', { defaultValue: 'Additional Discount (৳)' })}</label><input className="input" type="number" min="0" step="0.01" value={payForm.discount_amount} onChange={e => { setPayForm(f => ({ ...f, discount_amount: e.target.value })); setPaySchemePreview(null); }} /></div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs">
                <div className="mb-2 font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Scheme / Benefit</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input className="input h-8 text-xs" value={paySchemeCode} onChange={(e) => { setPaySchemeCode(e.target.value); setPaySchemePreview(null); }} placeholder="Scheme code" />
                  <input className="input h-8 text-xs" value={payMemberCode} onChange={(e) => { setPayMemberCode(e.target.value); setPaySchemePreview(null); }} placeholder="Member code" />
                  <button type="button" className="btn-secondary h-8 justify-center px-2 text-xs" disabled={checkPaySchemePreviewMutation.isPending || (!paySchemeCode.trim() && !payMemberCode.trim()) || paySubtotal <= 0} onClick={() => checkPaySchemePreviewMutation.mutate({ patient_id: payPatientId ?? undefined, scheme_code: paySchemeCode.trim() || undefined, member_code: payMemberCode.trim() || undefined, service_category: 'provisional_bill', subtotal: paySubtotal })}>{checkPaySchemePreviewMutation.isPending ? 'Checking…' : 'Check'}</button>
                </div>
                <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">{paySchemePreview?.eligible ? `${paySchemePreview.scheme_name ?? 'Scheme'} · suggested ৳${Math.min(Number(paySchemePreview.suggested_discount ?? 0), paySubtotal)}` : paySchemePreview?.blockers?.join(', ') || 'Optional: leave empty for normal provisional conversion.'}</div>
              </div>
              <div><label className="label">{t('remarks', { ns: 'billing', defaultValue: 'Remarks' })}</label><input className="input" value={payForm.remarks} onChange={e => setPayForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3"><button type="button" onClick={() => setPayPatientId(null)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={payMutation.isPending} className="btn-primary">{payMutation.isPending ? t('processing', { defaultValue: 'Processing…' }) : t('createInvoice', { defaultValue: 'Create Invoice' })}</button></div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

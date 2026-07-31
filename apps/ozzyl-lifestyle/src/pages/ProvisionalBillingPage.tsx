import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, X, XCircle, CheckCircle, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

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

export default function ProvisionalBillingPage({ role = 'hospital_admin' }: { role?: string }) {
  const [items, setItems] = useState<ProvisionalItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [patientIdFilter, setPatientIdFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const { t } = useTranslation(['billing', 'common']);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([{ service_name: '', quantity: '1', unit_price: '', discount_amount: '0' }]);

  // Cancel modal
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Pay modal
  const [payPatientId, setPayPatientId] = useState<number | null>(null);
  const [payItemCount, setPayItemCount] = useState(0);
  const [paying, setPaying] = useState(false);
  const [payForm, setPayForm] = useState({ payment_method: 'Cash', remarks: '', discount_amount: '0' });

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowCreate(false); setCancelId(null); setPayPatientId(null); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (patientIdFilter) params.patientId = patientIdFilter;
      const [listRes, sumRes] = await Promise.all([
        axios.get('/api/billing-provisional', { params, headers: authHeader() }),
        axios.get('/api/billing-provisional/summary', {
          params: statusFilter !== 'all' ? { status: statusFilter } : {},
          headers: authHeader(),
        }),
      ]);
      setItems(listRes.data.data ?? []);
      setTotal(listRes.data.total ?? listRes.data.data?.length ?? 0);
      setSummary(sumRes.data);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [statusFilter, patientIdFilter, page]);

  useEffect(() => { const t = setTimeout(loadData, 300); return () => clearTimeout(t); }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const validRows = rows.filter(r => r.service_name && r.unit_price);
      if (validRows.length === 0) { toast.error(t('addServiceRequired', { defaultValue: 'Add at least one service item' })); setSaving(false); return; }
      await axios.post('/api/billing-provisional/batch', {
        patient_id: parseInt((e.currentTarget as any).patient_id.value),
        items: validRows.map(r => ({ service_name: r.service_name, quantity: parseInt(r.quantity) || 1, unit_price: parseFloat(r.unit_price), discount_amount: parseFloat(r.discount_amount) || 0 })),
      }, { headers: authHeader() });
      toast.success(t('provisionalCreated', { defaultValue: 'Provisional items created' })); setShowCreate(false);
      setRows([{ service_name: '', quantity: '1', unit_price: '', discount_amount: '0' }]);
      loadData();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed'); }
    finally { setSaving(false); }
  };

  const handleCancel = async () => {
    if (!cancelId) return; setCancelling(true);
    try {
      await axios.put(`/api/billing-provisional/${cancelId}/cancel`, { cancel_reason: cancelReason || undefined }, { headers: authHeader() });
      toast.success(t('cancelled', { defaultValue: 'Cancelled' })); setCancelId(null); setCancelReason(''); loadData();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('failed', { defaultValue: 'Failed' }) : t('failed', { defaultValue: 'Failed' })); }
    finally { setCancelling(false); }
  };

  const openPayModal = (patientId: number) => {
    const count = items.filter(i => i.patient_id === patientId && i.bill_status === 'provisional').length;
    setPayPatientId(patientId);
    setPayItemCount(count);
    setPayForm({ payment_method: 'Cash', remarks: '', discount_amount: '0' });
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault(); if (!payPatientId) return; setPaying(true);
    try {
      await axios.post('/api/billing-provisional/pay', { patient_id: payPatientId, ...payForm, discount_amount: parseFloat(payForm.discount_amount) || 0 }, { headers: authHeader() });
      toast.success(t('invoiceCreated', { defaultValue: 'Invoice created' })); setPayPatientId(null); loadData();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? t('failed', { defaultValue: 'Failed' }) : t('failed', { defaultValue: 'Failed' })); }
    finally { setPaying(false); }
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
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('addItems', { defaultValue: 'Add Items' })}</button>
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
          <input className="input ml-auto w-44" placeholder={t('filterByPatientId', { defaultValue: 'Filter by Patient ID…' })} value={patientIdFilter} onChange={e => { setPatientIdFilter(e.target.value); setPage(1); }} type="number" />
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
              <div><label className="label">{t('patientIdLabel', { defaultValue: 'Patient ID *' })}</label><input name="patient_id" className="input" type="number" required /></div>
              <div className="space-y-2">
                <label className="label">{t('serviceItems', { defaultValue: 'Service Items' })}</label>
                {rows.map((row, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="input col-span-4" placeholder={t('serviceNamePlaceholder', { defaultValue: 'Service name *' })} value={row.service_name} onChange={e => { const r = [...rows]; r[i].service_name = e.target.value; setRows(r); }} required />
                    <input className="input col-span-2" type="number" placeholder={t('qty', { defaultValue: 'Qty' })} min="1" value={row.quantity} onChange={e => { const r = [...rows]; r[i].quantity = e.target.value; setRows(r); }} />
                    <input className="input col-span-3" type="number" placeholder={t('unitPriceLabel', { defaultValue: 'Unit price *' })} min="0" step="0.01" value={row.unit_price} onChange={e => { const r = [...rows]; r[i].unit_price = e.target.value; setRows(r); }} required />
                    <input className="input col-span-2" type="number" placeholder={t('discount', { ns: 'billing', defaultValue: 'Discount' })} min="0" step="0.01" value={row.discount_amount} onChange={e => { const r = [...rows]; r[i].discount_amount = e.target.value; setRows(r); }} />
                    {rows.length > 1 && <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="btn-ghost p-1.5 text-red-500"><X className="w-4 h-4" /></button>}
                  </div>
                ))}
                <button type="button" onClick={() => setRows([...rows, { service_name: '', quantity: '1', unit_price: '', discount_amount: '0' }])} className="btn-secondary text-sm"><Plus className="w-3.5 h-3.5" />{t('addRow', { defaultValue: 'Add Row' })}</button>
              </div>
              <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving', { ns: 'billing', defaultValue: 'Saving…' }) : t('createItems', { defaultValue: 'Create Items' })}</button></div>
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
              <div className="flex justify-end gap-3"><button onClick={() => setCancelId(null)} className="btn-secondary">{t('back', { ns: 'common' })}</button><button onClick={handleCancel} disabled={cancelling} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">{cancelling ? t('cancelling', { defaultValue: 'Cancelling…' }) : t('confirmCancel', { defaultValue: 'Confirm Cancel' })}</button></div>
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
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">⚠ {t('convertWarning', { defaultValue: 'You are about to convert <strong>{{count}}</strong> provisional item{{plural}} for Patient #{{patientId}} into a final invoice.', count: payItemCount, plural: payItemCount !== 1 ? 's' : '', patientId: payPatientId })}</p>
              </div>
              <div><label className="label">{t('paymentMethod', { ns: 'billing', defaultValue: 'Payment Method' })}</label><select className="input" value={payForm.payment_method} onChange={e => setPayForm(f => ({ ...f, payment_method: e.target.value }))}><option>{t('cash', { ns: 'billing', defaultValue: 'Cash' })}</option><option>{t('card', { ns: 'billing', defaultValue: 'Card' })}</option><option>{t('mobile', { ns: 'billing', defaultValue: 'Mobile Banking' })}</option><option>{t('cheque', { defaultValue: 'Cheque' })}</option><option>{t('credit', { defaultValue: 'Credit' })}</option></select></div>
              <div><label className="label">{t('additionalDiscount', { defaultValue: 'Additional Discount (৳)' })}</label><input className="input" type="number" min="0" step="0.01" value={payForm.discount_amount} onChange={e => setPayForm(f => ({ ...f, discount_amount: e.target.value }))} /></div>
              <div><label className="label">{t('remarks', { ns: 'billing', defaultValue: 'Remarks' })}</label><input className="input" value={payForm.remarks} onChange={e => setPayForm(f => ({ ...f, remarks: e.target.value }))} /></div>
              <div className="flex justify-end gap-3"><button type="button" onClick={() => setPayPatientId(null)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={paying} className="btn-primary">{paying ? t('processing', { defaultValue: 'Processing…' }) : t('createInvoice', { defaultValue: 'Create Invoice' })}</button></div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

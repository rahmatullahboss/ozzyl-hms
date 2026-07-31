import { useState, useEffect } from 'react';
import { CheckCircle, FileText, Plus, X, LoaderCircle, Check, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api, ApiClientError } from '../lib/apiClient';

interface CreditNote {
  id: number;
  credit_note_no?: string;
  patient_name?: string;
  amount?: number;
  total_amount?: number;
  refund_amount?: number;
  reason?: string;
  status?: string;
  approved_by?: number;
  approved_at?: string;
  created_at: string;
}

interface CreditNoteInvoiceItem {
  id: number;
  description?: string;
  quantity?: number;
  returned_qty?: number;
  available_qty?: number;
  unit_price?: number;
  line_total?: number;
}

interface CreditNoteInvoiceResponse {
  bill: {
    id: number;
    patient_id: number;
    invoice_no?: string;
    patient_name?: string;
    total?: number;
    paid?: number;
  };
  items: CreditNoteInvoiceItem[];
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Pending',  cls: 'badge-warning' },
  ready_for_payout: { label: "Ready for payout", cls: "badge-info" },
  approved: { label: 'Approved', cls: 'badge-success' },
  rejected: { label: 'Rejected', cls: 'badge-error' },
  issued:   { label: 'Issued',   cls: 'badge-info' },
};

const CREDIT_NOTE_PAYOUT_ROLES = ["hospital_admin", "md", "director", "accountant", "reception", "receptionist"];
const CREDIT_NOTE_WRITE_ROLES = ['hospital_admin', 'md', 'director', 'accountant'];

export default function CreditNotesPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['billing', 'common']);
  const [searchParams] = useSearchParams();
  const initialBillId = searchParams.get('billId') ?? '';
  const shouldOpenCreateFromUrl = searchParams.get('new') === '1' || initialBillId.length > 0;
  const queryClient = useQueryClient();
  const canPayout = CREDIT_NOTE_PAYOUT_ROLES.includes(role);
  const [statusFilter, setStatusFilter] = useState('all');
  const canApprove = CREDIT_NOTE_WRITE_ROLES.includes(role);

  const [showCreate, setShowCreate] = useState(shouldOpenCreateFromUrl);
  const [form, setForm] = useState({ patient_id: '', bill_id: initialBillId, reason: '', payment_mode: 'cash' });
  const [invoice, setInvoice] = useState<CreditNoteInvoiceResponse | null>(null);
  const [returnQtyByItem, setReturnQtyByItem] = useState<Record<number, string>>({});
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const queryParams = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
  const { data, isLoading: loading } = useApiQuery<{ creditNotes?: CreditNote[]; credit_notes?: CreditNote[] }>(
    queryKeys.creditNotes.list({ status: statusFilter }),
    `/api/credit-notes${queryParams}`,
  );

  const notes = data?.creditNotes ?? data?.credit_notes ?? [];

  const noteAmount = (note: CreditNote) => Number(note.refund_amount ?? note.amount ?? note.total_amount ?? 0);
  const total   = notes.reduce((s, n) => s + noteAmount(n), 0);
  const pending  = notes.filter(n => n.status === 'pending' || n.status === 'ready_for_payout').length;
  const approved = notes.filter(n => !n.status || n.status === 'approved').length;

  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/credit-notes',
    {
      onSuccess: () => {
        toast.success(t('billing.credit_note_created'));
        setShowCreate(false);
        setForm({ patient_id: '', bill_id: '', reason: '', payment_mode: 'cash' });
        setInvoice(null);
        setReturnQtyByItem({});
        queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all });
      },
      onError: (err) => { toast.error(err.message || 'Failed'); },
    },
  );

  const approveMutation = useApiMutation<unknown, number>(
    'post',
    (id) => `/api/credit-notes/${id}/approve`,
    {
      onSuccess: () => {
        toast.success('Credit note approved');
        queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all });
      },
      onError: (err) => { toast.error(err.message || 'Failed to approve'); },
    },
  );

  const rejectMutation = useApiMutation<unknown, number>(
    'post',
    (id) => `/api/credit-notes/${id}/reject`,
    {
      onSuccess: () => {
        toast.success('Credit note rejected');
        queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all });
      },
      onError: (err) => { toast.error(err.message || 'Failed to reject'); },
    },
  );

  const handleApprove = (id: number) => {
    approveMutation.mutate(id);
  };

  const handleReject = (id: number) => {
    rejectMutation.mutate(id);
  };

  const loadInvoice = async () => {
    const billId = Number(form.bill_id);
    if (!billId) {
      toast.error('Enter a bill ID first');
      return;
    }
    setLoadingInvoice(true);
    try {
      const data = await api.get<CreditNoteInvoiceResponse>(`/api/credit-notes/invoice/${billId}`);
      setInvoice(data);
      setForm((current) => ({
        ...current,
        patient_id: String(data.bill.patient_id),
      }));
      setReturnQtyByItem({});
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Failed to load invoice');
      setInvoice(null);
      setReturnQtyByItem({});
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const selectedItems = invoice?.items
      .map((item) => ({
        invoice_item_id: item.id,
        return_quantity: Number(returnQtyByItem[item.id] || 0),
      }))
      .filter((item) => item.return_quantity > 0) ?? [];

    if (!invoice || selectedItems.length === 0) {
      toast.error('Select at least one invoice item to return');
      return;
    }

    createMutation.mutate({
      patient_id: parseInt(form.patient_id),
      bill_id: parseInt(form.bill_id),
      reason: form.reason || undefined,
      payment_mode: form.payment_mode,
      items: selectedItems,
      idempotencyKey: `credit-note-${crypto.randomUUID()}`,
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('creditNotes', { ns: 'billing' })}</h1>
              <p className="section-subtitle">{t('creditNotesSubtitle')}</p>
            </div>
          </div>
          {canApprove ? (
            <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('newCreditNote', { ns: 'billing' })}</button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('totalAmount')}  value={`৳${total.toLocaleString()}`} loading={loading} icon={<FileText className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('creditNotePending')}       value={pending}                       loading={loading} icon={<FileText className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600"  index={1} />
          <KPICard title={t('creditNoteApproved')}      value={approved}                      loading={loading} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={2} />
        </div>

        <div className="card p-3 flex gap-2 flex-wrap">
          {['all', 'pending', 'ready_for_payout', 'approved', 'rejected'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${statusFilter === s ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            >{s === 'all' ? t('all') : t(s === 'pending' ? 'creditNotePending' : s === 'ready_for_payout' ? 'Ready for payout' : s === 'approved' ? 'creditNoteApproved' : 'creditNoteRejected')}</button>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('creditNoteNo')}</th><th>{t('creditNotePatient')}</th><th>{t('creditNoteAmount')}</th><th>{t('reason')}</th><th>{t('creditNoteStatus')}</th><th>{t('creditNoteDate')}</th><th>{t('creditNoteActions')}</th></tr></thead>
              <tbody>
                {loading
                  ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : notes.length === 0
                  ? <tr><td colSpan={7}><EmptyState icon={<FileText className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noCreditNotes', { ns: 'billing' })} description={t('noCreditNotesDesc', { ns: 'billing' })} action={canApprove ? <button onClick={() => setShowCreate(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('createCreditNote', { ns: 'billing' })}</button> : undefined} /></td></tr>
                  : notes.map(n => (
                      <tr key={n.id}>
                        <td className="font-data font-medium">{n.credit_note_no ?? `CN-${n.id}`}</td>
                        <td>{n.patient_name ?? '—'}</td>
                        <td className="font-data font-medium text-right">৳{noteAmount(n).toLocaleString()}</td>
                        <td className="text-[var(--color-text-secondary)] max-w-xs truncate">{n.reason ?? '—'}</td>
                        <td><span className={`badge ${STATUS_CFG[n.status ?? 'issued']?.cls ?? 'badge-info'}`}>{STATUS_CFG[n.status ?? 'issued']?.label}</span></td>
                        <td className="font-data text-sm">{n.created_at?.split('T')[0]}</td>
                        <td>
                          {n.status === 'pending' && canApprove ? (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => handleApprove(n.id)}
                                disabled={approveMutation.isPending}
                                className="btn-ghost p-1.5 text-emerald-600 hover:bg-emerald-50"
                                title="Approve"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleReject(n.id)}
                                disabled={rejectMutation.isPending}
                                className="btn-ghost p-1.5 text-red-600 hover:bg-red-50"
                                title="Reject"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>
                          ) : n.status === 'ready_for_payout' && canPayout ? (
                            <button
                              onClick={() => handleApprove(n.id)}
                              disabled={approveMutation.isPending}
                              className="btn-secondary px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
                              title="Pay from active counter"
                            >
                              Pay
                            </button>
                          ) : n.approved_at ? (
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {n.status === 'approved' ? 'Approved' : 'Rejected'} {n.approved_at?.split('T')[0]}
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {canApprove && showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('newCreditNote', { ns: 'billing' })}</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('ot.patient_id_')}</label><input className="input" type="number" required value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} /></div>
                <div><label className="label">{t('ot.bill_id_')}</label><input className="input" type="number" required value={form.bill_id} onChange={e => setForm(f => ({ ...f, bill_id: e.target.value }))} /></div>
              </div>
              <button type="button" onClick={loadInvoice} disabled={loadingInvoice} className="btn-secondary w-full">
                {loadingInvoice ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Load invoice items
              </button>
              {invoice && (
                <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-[var(--color-border-light)] text-sm font-medium">
                    {invoice.bill.invoice_no ?? `Bill #${invoice.bill.id}`} · Paid ৳{Number(invoice.bill.paid ?? 0).toLocaleString()}
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-[var(--color-border)]">
                    {invoice.items.map((item) => {
                      const maxQty = Number(item.available_qty ?? item.quantity ?? 1);
                      const unitAmount = Number(item.line_total ?? item.unit_price ?? 0) / Math.max(1, Number(item.quantity ?? 1));
                      return (
                        <div key={item.id} className="grid grid-cols-[1fr_84px] gap-3 px-3 py-2 items-center">
                          <div>
                            <div className="text-sm font-medium">{item.description ?? `Item #${item.id}`}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              Available {maxQty} · ৳{unitAmount.toLocaleString()} each
                            </div>
                          </div>
                          <input
                            className="input h-9 text-right"
                            type="number"
                            min="0"
                            max={maxQty}
                            step="1"
                            value={returnQtyByItem[item.id] ?? ''}
                            onChange={e => setReturnQtyByItem(qty => ({ ...qty, [item.id]: e.target.value }))}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <label className="label">Payment mode</label>
                <select className="input" value={form.payment_mode} onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value }))}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bkash">bKash</option>
                  <option value="nagad">Nagad</option>
                  <option value="bank_transfer">Bank transfer</option>
                </select>
              </div>
              <div><label className="label">{t('ot.reason')}</label><textarea className="input resize-none" rows={2} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('saving', { ns: 'billing' }) : t('createCreditNote', { ns: 'billing' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

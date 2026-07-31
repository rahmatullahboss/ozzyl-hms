import { useState, useEffect } from 'react';
import { Ban, Plus, X, AlertTriangle, FileText, LoaderCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6 } from '../lib/date-utils';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { api, ApiClientError } from '../lib/apiClient';


interface BillLookupResponse {
  bill?: {
    id?: number;
    invoice_no?: string;
    paid?: number;
    paid_amount?: number;
    cash_paid_amount?: number;
    settled_amount?: number;
    total?: number;
    total_amount?: number;
  };
}

const paidAmountForBill = (bill?: BillLookupResponse['bill'] | null) => Math.max(
  0,
  Number(bill?.paid_amount ?? bill?.settled_amount ?? bill?.paid ?? bill?.cash_paid_amount ?? 0),
);

interface Cancellation {
  id: number;
  invoice_no?: string;
  bill_id?: number;
  patient_name?: string;
  amount?: number;
  bill_amount?: number;
  reason?: string;
  cancelled_by?: string;
  created_at: string;
}

export default function BillCancellationPage({ role = 'hospital_admin' }: { role?: string }) {
  const queryClient = useQueryClient();
  const { slug } = useParams();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ bill_id: '', reason: '', remarks: '' });
  const [checkedBillId, setCheckedBillId] = useState('');
  const [checkedBill, setCheckedBill] = useState<BillLookupResponse['bill'] | null>(null);
  const [checkingBill, setCheckingBill] = useState(false);
  const { t } = useTranslation(['billing', 'common']);
  const normalizedRole = role.toLowerCase();
  const canCancelBill = ['hospital_admin', 'md', 'director', 'accountant'].includes(normalizedRole);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const { data, isLoading: loading } = useApiQuery<{ cancellations: Cancellation[] }>(
    queryKeys.billCancellation.list(),
    '/api/billing-cancellation',
  );

  const cancellations = data?.cancellations ?? [];
  const totalAmount = cancellations.reduce((s, c) => s + (c.amount ?? c.bill_amount ?? 0), 0);
  const checkedPaidAmount = paidAmountForBill(checkedBill);
  const isCheckedPaidBill = checkedBillId === form.bill_id && checkedPaidAmount > 0;
  const creditNoteHref = slug
    ? `/h/${slug}/credit-notes?billId=${encodeURIComponent(form.bill_id)}&new=1`
    : `/credit-notes?billId=${encodeURIComponent(form.bill_id)}&new=1`;
  const gmt6Today = getTodayGMT6();
  const todayCount  = cancellations.filter(c => c.created_at?.split('T')[0] === gmt6Today).length;

  useEffect(() => {
    setCheckedBillId('');
    setCheckedBill(null);
  }, [form.bill_id]);

  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/billing-cancellation',
    {
      onSuccess: () => {
        toast.success(t('billing.bill_cancelled'));
        setShowCreate(false);
        setForm({ bill_id: '', reason: '', remarks: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.billCancellation.all });
      },
      onError: (err) => { toast.error(err.message || 'Failed'); },
    },
  );

  const loadBillForCancellation = async () => {
    const billId = Number(form.bill_id);
    if (!billId) {
      toast.error(t('enterBillIdFirst'));
      return null;
    }

    setCheckingBill(true);
    try {
      const data = await api.get<BillLookupResponse>(`/api/billing/${billId}`);
      const bill = data.bill ?? null;
      setCheckedBillId(form.bill_id);
      setCheckedBill(bill);
      return bill;
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('failedToLoadBill'));
      setCheckedBillId('');
      setCheckedBill(null);
      return null;
    } finally {
      setCheckingBill(false);
    }
  };

  const handleCheckBill = async () => {
    await loadBillForCancellation();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const bill = checkedBillId === form.bill_id ? checkedBill : await loadBillForCancellation();
    if (!bill) {
      return;
    }
    if (paidAmountForBill(bill) > 0) {
      toast.error(t('paidBillUseCreditNote'));
      return;
    }

    createMutation.mutate({
      bill_id: parseInt(form.bill_id),
      reason: form.reason,
      remarks: form.remarks || undefined,
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Ban className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('billCancellation')}</h1>
              <p className="section-subtitle">{t('cancelVoidBillingRecords')}</p>
            </div>
          </div>
          {canCancelBill && (
            <button onClick={() => setShowCreate(true)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
              <Plus className="w-4 h-4" /> {t('cancelBill')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('totalCancellations')} value={cancellations.length}                      loading={loading} icon={<Ban className="w-5 h-5" />}           iconBg="bg-rose-50 text-rose-600"     index={0} />
          <KPICard title={t('today')}               value={todayCount}                               loading={loading} icon={<AlertTriangle className="w-5 h-5" />}  iconBg="bg-amber-50 text-amber-600"   index={1} />
          <KPICard title={t('amountCancelled')}    value={`৳${totalAmount.toLocaleString()}`}       loading={loading} icon={<Ban className="w-5 h-5" />}            iconBg="bg-red-50 text-red-600"       index={2} />
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('invoice')}</th><th>{t('patient')}</th><th>{t('amount')} (৳)</th><th>{t('cancellationReason')}</th><th>{t('cancelledBy')}</th><th>{t('date')}</th></tr></thead>
              <tbody>
                {loading
                  ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  : cancellations.length === 0
                  ? <tr><td colSpan={6}><EmptyState icon={<Ban className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noCancellations')} description={t('noCancellationsDesc')} /></td></tr>
                  : cancellations.map(c => (
                      <tr key={c.id}>
                        <td className="font-data font-medium">{c.invoice_no ?? `BILL-${c.bill_id ?? c.id}`}</td>
                        <td>{c.patient_name ?? '—'}</td>
                        <td className="font-data text-right">৳{(c.amount ?? c.bill_amount ?? 0).toLocaleString()}</td>
                        <td className="text-[var(--color-text-secondary)]">{c.reason ?? '—'}</td>
                        <td>{c.cancelled_by ?? '—'}</td>
                        <td className="font-data text-sm">{c.created_at?.split('T')[0]}</td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {canCancelBill && showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold flex items-center gap-2 text-red-600"><AlertTriangle className="w-5 h-5" /> {t('cancelBill')}</h3>
              <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-4">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-300">
                ⚠️ {t('warningIrreversible')}
              </div>
              <div>
                  <label className="label" htmlFor="bill-cancel-bill-id">{t('billIdRequired')} *</label>
                  <div className="flex gap-2">
                    <input id="bill-cancel-bill-id" className="input" type="number" required value={form.bill_id} onChange={e => setForm(f => ({ ...f, bill_id: e.target.value }))} placeholder={t('billIdPlaceholder')} />
                    <button type="button" onClick={handleCheckBill} disabled={checkingBill || !form.bill_id} className="btn-secondary whitespace-nowrap disabled:opacity-50">
                      {checkingBill ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      {checkingBill ? t('checkingBill') : t('checkBill')}
                    </button>
                  </div>
                </div>
              {isCheckedPaidBill && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-sm text-amber-800 dark:text-amber-200 space-y-2">
                  <div className="font-semibold">{t('paidBillCreditNoteTitle')}</div>
                  <div>{t('paidBillCreditNoteDesc')}</div>
                  <div className="text-xs font-data">
                    {checkedBill?.invoice_no ?? `Bill #${checkedBill?.id ?? form.bill_id}`} · Paid ৳{checkedPaidAmount.toLocaleString()}
                  </div>
                  <a href={creditNoteHref} className="btn-primary inline-flex mt-1">
                    <FileText className="w-4 h-4" /> {t('issueCreditNote')}
                  </a>
                </div>
              )}
              {!isCheckedPaidBill && <div><label className="label">{t('reason')} *</label><input className="input" required value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder={t('reasonPlaceholder')} /></div>}
              {!isCheckedPaidBill && <div><label className="label">{t('additionalRemarks')}</label><textarea className="input resize-none" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} /></div>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                {!isCheckedPaidBill && (
                  <button type="submit" disabled={createMutation.isPending || checkingBill} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                    {createMutation.isPending ? t('cancelling') : t('confirmCancellation')}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

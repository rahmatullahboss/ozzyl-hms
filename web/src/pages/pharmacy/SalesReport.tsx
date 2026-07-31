import { useState, useCallback } from 'react';
import { Download, Filter, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/apiClient';

interface SalesRow { id: number; invoice_no: number; patient_name?: string; total_amount: number; paid_amount: number; credit_amount: number; discount_amount: number; payment_mode: string; status: string; created_at: string; }
interface SalesSummary { total_invoices: number; total_sales: number; total_paid: number; total_credit: number; total_discount: number; cash_sales: number; card_sales: number; credit_sales: number; }

const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' });

function statusBadge(status: string) {
  const map: Record<string, string> = { paid: 'badge-success', credit: 'badge-warning', unpaid: 'badge-error', return: 'badge-secondary' };
  return <span className={`badge ${map[status] ?? 'badge-secondary'}`}>{status}</span>;
}

export default function SalesReport({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ from_date: thirtyAgo, to_date: today, payment_mode: '', status: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.from_date) params.set('from_date', filters.from_date);
      if (filters.to_date) params.set('to_date', filters.to_date);
      if (filters.payment_mode) params.set('payment_mode', filters.payment_mode);
      if (filters.status) params.set('status', filters.status);
      const data = await api.get<{ data?: SalesRow[]; summary?: SalesSummary }>(`/api/pharmacy/reports/sales?${params}`);
      setRows(data.data ?? []);
      setSummary(data.summary ?? null);
      setLoaded(true);
    } catch { toast.error(t('failedLoadSalesReport')); }
    finally { setLoading(false); }
  }, [filters]);

  const handleExportCsv = () => {
    const header = `${t('invoiceNo')},${t('common:date')},${t('patient')},${t('common:total')},${t('paid')},${t('credit')},${t('common:discount')},${t('mode')},${t('common:status')}\n`;
    const body = rows.map(r => `${r.invoice_no},"${fmtDate(r.created_at)}","${r.patient_name||t('cashPatient')}",${r.total_amount/100},${r.paid_amount/100},${r.credit_amount/100},${r.discount_amount/100},${t(`paymentModes.${r.payment_mode}`)},${t(`invoiceStatus.${r.status}`, { defaultValue: r.status })}`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `sales-report-${filters.from_date}-to-${filters.to_date}.csv`; a.click();
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header"><div><h1 className="page-title">{t('salesReport')}</h1><p className="page-subtitle">{t('salesReportSubtitle')}</p></div>{loaded && (<button className="btn btn-outline btn-sm" onClick={handleExportCsv}><Download className="h-4 w-4 mr-1" /> {t('exportCsv')}</button>)}</div>
        <div className="card p-4"><div className="flex flex-wrap gap-3 items-end"><div><label className="form-label">{t('fromDate')}</label><input type="date" className="form-control" value={filters.from_date} onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))} /></div><div><label className="form-label">{t('toDate')}</label><input type="date" className="form-control" value={filters.to_date} onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))} /></div><div><label className="form-label">{t('paymentMode')}</label><select className="form-control" value={filters.payment_mode} onChange={e => setFilters(f => ({ ...f, payment_mode: e.target.value }))}><option value="">{t('common:all')}</option><option value="cash">{t('paymentModes.cash')}</option><option value="card">{t('paymentModes.card')}</option><option value="mobile">{t('paymentModes.mobile')}</option><option value="credit">{t('paymentModes.credit')}</option><option value="deposit">{t('paymentModes.deposit')}</option></select></div><div><label className="form-label">{t('common:status')}</label><select className="form-control" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}><option value="">{t('common:all')}</option><option value="paid">{t('invoiceStatus.paid')}</option><option value="credit">{t('invoiceStatus.credit')}</option><option value="unpaid">{t('invoiceStatus.unpaid')}</option></select></div><button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}<span className="ml-1">{loading ? t('common:loading') : t('generate')}</span></button></div></div>
        {summary && (<div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[{ label: t('totalInvoices'), value: summary.total_invoices, color: 'text-blue-600' },{ label: t('totalSales'), value: fmt(summary.total_sales), color: 'text-gray-800' },{ label: t('collected'), value: fmt(summary.total_paid), color: 'text-green-600' },{ label: t('creditOutstanding'), value: fmt(summary.total_credit), color: 'text-orange-500' }].map(({ label, value, color }) => (<div key={label} className="card p-4 text-center"><p className={`text-2xl font-bold ${color}`}>{value}</p><p className="text-xs text-gray-500 mt-1">{label}</p></div>))}</div>)}
        {summary && (<div className="card p-4"><h3 className="text-sm font-semibold text-gray-600 mb-3">{t('breakdownPaymentMode')}</h3><div className="flex flex-wrap gap-4">{[{ label: t('paymentModes.cash'), value: fmt(summary.cash_sales), color: 'text-green-600' },{ label: t('paymentModes.card'), value: fmt(summary.card_sales), color: 'text-blue-600' },{ label: t('paymentModes.credit'), value: fmt(summary.credit_sales), color: 'text-orange-500' },{ label: t('common:discount'), value: fmt(summary.total_discount), color: 'text-red-500' }].map(({ label, value, color }) => (<div key={label} className="text-sm"><span className="text-gray-500">{label}: </span><span className={`font-semibold ${color}`}>{value}</span></div>))}</div></div>)}
        {loaded && (<div className="card"><div className="table-responsive"><table className="table"><thead><tr><th>{t('invoiceNo')}</th><th>{t('common:date')}</th><th>{t('patient')}</th><th className="text-right">{t('common:total')}</th><th className="text-right">{t('paid')}</th><th className="text-right">{t('credit')}</th><th className="text-right">{t('common:discount')}</th><th>{t('mode')}</th><th>{t('common:status')}</th></tr></thead><tbody>{rows.length === 0 && (<tr><td colSpan={9} className="text-center py-8 text-gray-400">{t('noSalesFound')}</td></tr>)}{rows.map(r => (<tr key={r.id}><td className="font-mono text-sm">#{r.invoice_no}</td><td className="text-sm">{fmtDate(r.created_at)}</td><td className="text-sm">{r.patient_name || t('cashPatient')}</td><td className="text-right">{fmt(r.total_amount)}</td><td className="text-right text-green-600">{fmt(r.paid_amount)}</td><td className="text-right text-orange-500">{fmt(r.credit_amount)}</td><td className="text-right text-red-500">{fmt(r.discount_amount)}</td><td className="capitalize text-sm">{t(`paymentModes.${r.payment_mode}`, { defaultValue: r.payment_mode })}</td><td>{statusBadge(r.status)}</td></tr>))}</tbody></table></div></div>)}
        {!loaded && !loading && (<div className="card p-12 text-center text-gray-400"><p>{t('salesReportSelectRange')}</p></div>)}
      </div>
    </DashboardLayout>
  );
}

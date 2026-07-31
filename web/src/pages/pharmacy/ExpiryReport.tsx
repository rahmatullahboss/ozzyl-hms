import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Filter, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { api } from '../../lib/apiClient';

interface ExpiryRow { id: number; item_name: string; generic_name?: string; batch_no?: string; expiry_date?: string; available_qty: number; cost_price: number; mrp: number; days_until_expiry: number; }

const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function expiryBadge(days: number) {
  if (days < 0)  return <span className="badge badge-error">Expired</span>;
  if (days <= 30) return <span className="badge badge-error">{days}d</span>;
  if (days <= 90) return <span className="badge badge-warning">{days}d</span>;
  return <span className="badge badge-success">{days}d</span>;
}

function rowColor(days: number) { if (days < 0) return 'bg-red-50'; if (days <= 30) return 'bg-orange-50'; if (days <= 90) return 'bg-yellow-50'; return ''; }

export default function ExpiryReport({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('pharmacy');
  const [rows, setRows] = useState<ExpiryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState({ expired: 0, within_30: 0, within_90: 0, total_value: 0 });
  const [filters, setFilters] = useState({ days: '90', search: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.days) params.set('days', filters.days);
      if (filters.search) params.set('search', filters.search);
      const data = await api.get<{ data?: ExpiryRow[]; summary?: typeof summary }>(`/api/pharmacy/reports/expiry?${params}`);
      setRows(data.data ?? []);
      setSummary(data.summary ?? { expired: 0, within_30: 0, within_90: 0, total_value: 0 });
      setLoaded(true);
    } catch { toast.error(t('pharmacy.failed_to_load_expiry_report')); }
    finally { setLoading(false); }
  }, [filters]);

  const handleExportCsv = () => {
    const header = 'Item,Generic,Batch,Expiry,Days,Qty,Cost,MRP\n';
    const body = rows.map(r => `"${r.item_name}","${r.generic_name||''}","${r.batch_no||''}","${r.expiry_date||''}",${r.days_until_expiry},${r.available_qty},${r.cost_price/100},${r.mrp/100}`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `expiry-report-${Date.now()}.csv`; a.click();
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header"><div><h1 className="page-title">Expiry Report</h1><p className="page-subtitle">Track items nearing expiry or already expired</p></div>{loaded && (<button className="btn btn-outline btn-sm" onClick={handleExportCsv}><Download className="h-4 w-4 mr-1" /> Export CSV</button>)}</div>
        <div className="card p-4"><div className="flex flex-wrap gap-3 items-end"><div><label className="form-label">{t('pharmacy.showExpiringWithin')}</label><select className="form-control" value={filters.days} onChange={e => setFilters(f => ({ ...f, days: e.target.value }))}><option value="0">Already Expired</option><option value="30">30 Days</option><option value="60">60 Days</option><option value="90">90 Days</option><option value="180">180 Days</option><option value="365">1 Year</option></select></div><div className="flex-1 min-w-36"><label className="form-label">{t("pharmacy.searchItem")}</label><input className="form-control" placeholder={t("pharmacy.searchItemOrBatch")} value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} /></div><button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}<span className="ml-1">{loading ? 'Loading...' : 'Generate'}</span></button></div></div>
        {loaded && (<div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[{ label: 'Already Expired', value: summary.expired, color: 'text-red-600 bg-red-50' },{ label: '≤ 30 Days', value: summary.within_30, color: 'text-orange-500 bg-orange-50' },{ label: '≤ 90 Days', value: summary.within_90, color: 'text-yellow-600 bg-yellow-50' },{ label: 'Expiring Stock Value', value: fmt(summary.total_value), color: 'text-gray-700 bg-gray-50' }].map(({ label, value, color }) => (<div key={label} className={`card p-4 text-center ${color.split(' ')[1]}`}><p className={`text-2xl font-bold ${color.split(' ')[0]}`}>{value}</p><p className="text-xs text-gray-500 mt-1">{label}</p></div>))}</div>)}
        {loaded && (<div className="flex items-center gap-4 text-xs text-gray-500"><AlertTriangle className="h-4 w-4 text-yellow-500" /><span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 inline-block" /> Expired or ≤ 30 days</span><span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-50 inline-block" /> 31–90 days</span><span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-white border inline-block" /> &gt; 90 days</span></div>)}
        {loaded && (<div className="card"><div className="table-responsive"><table className="table"><thead><tr><th>Item</th><th>Generic</th><th>Batch</th><th>Expiry Date</th><th>Status</th><th className="text-right">Qty</th><th className="text-right">Cost</th><th className="text-right">MRP</th></tr></thead><tbody>{rows.length === 0 && (<tr><td colSpan={8} className="text-center py-8 text-gray-400">No items found expiring within {filters.days} days</td></tr>)}{rows.map(r => (<tr key={r.id} className={rowColor(r.days_until_expiry)}><td className="font-medium text-sm">{r.item_name}</td><td className="text-sm text-gray-500">{r.generic_name || '—'}</td><td className="font-mono text-xs">{r.batch_no || '—'}</td><td className="text-sm">{fmtDate(r.expiry_date)}</td><td>{expiryBadge(r.days_until_expiry)}</td><td className="text-right">{r.available_qty}</td><td className="text-right text-sm">{fmt(r.cost_price)}</td><td className="text-right text-sm">{fmt(r.mrp)}</td></tr>))}</tbody></table></div></div>)}
        {!loaded && !loading && (<div className="card p-12 text-center text-gray-400"><AlertTriangle className="h-10 w-10 mx-auto mb-3 opacity-30" /><p>Select expiry window and click <strong>Generate</strong> to view expiring stock</p></div>)}
      </div>
    </DashboardLayout>
  );
}

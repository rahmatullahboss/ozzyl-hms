import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Filter, Loader2 } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';

interface StockRow {
  id: number;
  item_name: string;
  generic_name?: string;
  category_name?: string;
  batch_no?: string;
  expiry_date?: string;
  available_qty: number;
  cost_price: number;
  mrp: number;
  stock_value: number;
}

const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const isExpired = (d?: string) => d ? new Date(d) < new Date() : false;
const isExpiringSoon = (d?: string) => {
  if (!d) return false;
  const diff = (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 90;
};

export default function StockReport({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('pharmacy');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState({ items: 0, total_value: 0, low_stock: 0, expiring: 0 });

  const [filters, setFilters] = useState({
    search: '', category: '', expiryFilter: 'all',
  });

  const token = () => localStorage.getItem('hms_token');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/pharmacy/reports/stock', {
        params: { ...filters },
        headers: { Authorization: `Bearer ${token()}` },
      });
      setRows(data.data ?? []);
      setSummary(data.summary ?? { items: 0, total_value: 0, low_stock: 0, expiring: 0 });
      setLoaded(true);
    } catch { toast.error(t('pharmacy.failed_to_load_stock_report')); }
    finally { setLoading(false); }
  }, [filters]);

  const handleExportCsv = () => {
    const header = 'Item,Generic,Category,Batch,Expiry,Qty,Cost,MRP,Value\n';
    const body = rows.map(r =>
      `"${r.item_name}","${r.generic_name||''}","${r.category_name||''}","${r.batch_no||''}","${r.expiry_date||''}",${r.available_qty},${r.cost_price/100},${r.mrp/100},${r.stock_value/100}`
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `stock-report-${Date.now()}.csv`; a.click();
  };

  const expiryColor = (d?: string) => {
    if (isExpired(d)) return 'text-red-600 font-medium';
    if (isExpiringSoon(d)) return 'text-orange-500';
    return '';
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">

        <div className="page-header">
          <div>
            <h1 className="page-title">Stock Report</h1>
            <p className="page-subtitle">Current stock levels, values, and expiry status</p>
          </div>
          {loaded && (
            <button className="btn btn-outline btn-sm" onClick={handleExportCsv}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-36">
              <label className="form-label">{t("pharmacy.search")}</label>
              <input className="form-control" placeholder={t("pharmacy.searchItemBatchGeneric")}
                value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
            </div>
            <div className="min-w-40">
              <label className="form-label">{t("pharmacy.expiryFilter")}</label>
              <select className="form-control" value={filters.expiryFilter}
                onChange={e => setFilters(f => ({ ...f, expiryFilter: e.target.value }))}>
                <option value="all">All Stock</option>
                <option value="expired">Expired</option>
                <option value="expiring30">Expiring ≤ 30 days</option>
                <option value="expiring90">Expiring ≤ 90 days</option>
                <option value="ok">OK (&gt; 90 days)</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
              <span className="ml-1">{loading ? 'Loading…' : 'Generate Report'}</span>
            </button>
          </div>
        </div>

        {/* Summary */}
        {loaded && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Items', value: summary.items, color: 'text-blue-600' },
              { label: 'Total Value', value: fmt(summary.total_value), color: 'text-green-600' },
              { label: 'Low Stock', value: summary.low_stock, color: 'text-orange-500' },
              { label: 'Expiring', value: summary.expiring, color: 'text-red-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card p-4 text-center">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-500 mt-1">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        {loaded && (
          <div className="card">
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Generic</th>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">MRP</th>
                    <th className="text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-400">No stock data found</td></tr>
                  )}
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td>
                        <p className="font-medium text-sm">{r.item_name}</p>
                        {r.category_name && <p className="text-xs text-gray-400">{r.category_name}</p>}
                      </td>
                      <td className="text-sm text-gray-500">{r.generic_name || '—'}</td>
                      <td className="font-mono text-xs">{r.batch_no || '—'}</td>
                      <td className={`text-sm ${expiryColor(r.expiry_date)}`}>{fmtDate(r.expiry_date)}</td>
                      <td className="text-right">{r.available_qty}</td>
                      <td className="text-right text-sm">{fmt(r.cost_price)}</td>
                      <td className="text-right text-sm">{fmt(r.mrp)}</td>
                      <td className="text-right font-medium">{fmt(r.stock_value)}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold">
                      <td colSpan={7} className="text-right">Total Value</td>
                      <td className="text-right text-green-600">{fmt(summary.total_value)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}

        {!loaded && !loading && (
          <div className="card p-12 text-center text-gray-400">
            <p>Set your filters and click <strong>Generate Report</strong> to view stock data</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

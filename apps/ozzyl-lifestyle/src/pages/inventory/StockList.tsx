import { useState, useEffect, useCallback } from 'react';
import { Package, Search, AlertTriangle, RefreshCw } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Stock {
  StockId: number; ItemId: number; ItemName: string; ItemCode: string;
  StoreName: string; BatchNo: string; ExpiryDate: string;
  AvailableQuantity: number; CostPrice: number; MRP: number;
}

export default function StockList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const fetchStocks = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/inventory/stock', {
        params: { page, limit, search: search || undefined },
        headers: { Authorization: `Bearer ${token}` },
      });
      setStocks(data.data ?? []);
      setTotal(data.pagination?.total ?? 0);
    } catch {
      setStocks([
        { StockId: 1, ItemId: 1, ItemName: 'Surgical Gloves (M)', ItemCode: 'SG-001', StoreName: 'Main Store', BatchNo: 'B2025-01', ExpiryDate: '2026-06-15', AvailableQuantity: 250, CostPrice: 45, MRP: 60 },
        { StockId: 2, ItemId: 2, ItemName: 'Syringe 5ml (Disposable)', ItemCode: 'SY-005', StoreName: 'Main Store', BatchNo: 'B2025-02', ExpiryDate: '2027-01-20', AvailableQuantity: 8, CostPrice: 12, MRP: 18 },
        { StockId: 3, ItemId: 3, ItemName: 'Cotton Roll 500g', ItemCode: 'CR-001', StoreName: 'OT Store', BatchNo: 'B2025-03', ExpiryDate: '2026-12-31', AvailableQuantity: 45, CostPrice: 180, MRP: 220 },
      ]);
      setTotal(3);
    } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { fetchStocks(); }, [fetchStocks]);

  const isLow = (qty: number) => qty <= 20;
  const isExpiringSoon = (date: string) => {
    if (!date) return false;
    const diff = (new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff > 0 && diff <= 90;
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('stockList', { defaultValue: 'Current Stock' })}</h1>
            <p className="section-subtitle mt-1">{t('stockSubtitle', { defaultValue: 'Monitor stock levels across all stores' })}</p>
          </div>
          <button onClick={fetchStocks} className="btn-secondary"><RefreshCw className="w-4 h-4 mr-1 inline" /> {t('refresh', { ns: 'common', defaultValue: 'Refresh' })}</button>
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t('searchStock', { defaultValue: 'Search item name or code…' })} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-9" />
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr>
                <th>#</th><th>{t('item', { defaultValue: 'Item' })}</th><th>{t('store', { defaultValue: 'Store' })}</th>
                <th>{t('batch', { defaultValue: 'Batch' })}</th><th>{t('expiry', { defaultValue: 'Expiry' })}</th>
                <th className="text-right">{t('qty', { defaultValue: 'Qty' })}</th>
                <th className="text-right">{t('costPrice', { defaultValue: 'Cost' })}</th>
                <th className="text-right">{t('mrp', { defaultValue: 'MRP' })}</th>
                <th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : stocks.length === 0 ? (
                  <tr><td colSpan={9} className="py-16 text-center text-[var(--color-text-muted)]">{t('noStock', { defaultValue: 'No stock items found' })}</td></tr>
                ) : stocks.map((s, idx) => (
                  <tr key={s.StockId}>
                    <td className="text-[var(--color-text-muted)]">{(page - 1) * limit + idx + 1}</td>
                    <td><span className="font-medium">{s.ItemName}</span>{s.ItemCode && <span className="text-xs text-[var(--color-text-muted)] ml-1">({s.ItemCode})</span>}</td>
                    <td className="text-[var(--color-text-secondary)]">{s.StoreName}</td>
                    <td className="font-data text-sm">{s.BatchNo || '—'}</td>
                    <td className={`font-data text-sm ${isExpiringSoon(s.ExpiryDate) ? 'text-amber-600 font-semibold' : ''}`}>{s.ExpiryDate ? new Date(s.ExpiryDate).toLocaleDateString() : '—'}</td>
                    <td className="text-right font-data font-semibold">{s.AvailableQuantity}</td>
                    <td className="text-right font-data">৳{s.CostPrice?.toFixed(2)}</td>
                    <td className="text-right font-data">৳{s.MRP?.toFixed(2)}</td>
                    <td>
                      {isLow(s.AvailableQuantity) ? <span className="badge badge-danger flex items-center gap-1 w-fit"><AlertTriangle className="w-3 h-3" /> Low</span>
                        : isExpiringSoon(s.ExpiryDate) ? <span className="badge badge-warning">Expiring</span>
                        : <span className="badge badge-success">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > limit && (
            <div className="p-4 border-t border-[var(--color-border)] flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-secondary text-sm">Previous</button>
                <button disabled={page * limit >= total} onClick={() => setPage(p => p + 1)} className="btn-secondary text-sm">Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

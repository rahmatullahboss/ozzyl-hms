import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search, AlertTriangle, Loader2, Package, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { api } from '../../lib/apiClient';

interface StockItem {
  item_id: number;
  item_name: string;
  item_code?: string;
  generic_name?: string;
  category_name?: string;
  reorder_level?: number;
  total_qty: number;
  nearest_expiry?: string;
  mrp: number;
  cost_price: number;
  batch_count: number;
}

interface StockResponse {
  data: StockItem[];
  pagination?: { total: number };
}

const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function StockStatus({ qty, reorder }: { qty: number; reorder?: number }) {
  if (qty === 0) return <span className="badge badge-error">Out of Stock</span>;
  if (reorder != null && qty <= reorder) return <span className="badge badge-warning">Low Stock</span>;
  return <span className="badge badge-success">In Stock</span>;
}

export default function DispensaryStock({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('pharmacy');
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async (pg = 1, q = search, low = lowStockOnly) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(LIMIT) });
      if (q) params.set('search', q);
      if (low) params.set('low_stock_only', 'true');
      const data = await api.get<StockResponse>(`/api/pharmacy/dispensary-stock?${params.toString()}`);
      setItems(data.data ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(pg);
    } catch { toast.error(t('pharmacy.failed_to_load_stock')); }
    finally { setLoading(false); }
  }, [search, lowStockOnly, t]);

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (v: string) => {
    setSearch(v);
    const timer = setTimeout(() => load(1, v, lowStockOnly), 400);
    return () => clearTimeout(timer);
  };

  const handleLowStockToggle = (v: boolean) => {
    setLowStockOnly(v);
    load(1, search, v);
  };

  const outOfStock = items.filter(i => i.total_qty === 0).length;
  const lowStock   = items.filter(i => i.reorder_level != null && i.total_qty > 0 && i.total_qty <= i.reorder_level).length;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">

        <div className="page-header">
          <div>
            <h1 className="page-title">Dispensary Stock View</h1>
            <p className="page-subtitle">Real-time item availability for dispensing</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => load(1, search, lowStockOnly)}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="card p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{total}</p>
            <p className="text-xs text-gray-500 mt-1">Total Items</p>
          </div>
          <div className="card p-4 text-center bg-orange-50">
            <p className="text-2xl font-bold text-orange-500">{lowStock}</p>
            <p className="text-xs text-gray-500 mt-1">Low Stock</p>
          </div>
          <div className="card p-4 text-center bg-red-50">
            <p className="text-2xl font-bold text-red-600">{outOfStock}</p>
            <p className="text-xs text-gray-500 mt-1">Out of Stock</p>
          </div>
        </div>

        {/* Search + Filter */}
        <div className="card p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="input-group flex-1 min-w-[220px]">
              <span className="input-group-text">
                <Search className="h-4 w-4" />
              </span>
              <input
                type="text" className="form-control"
                placeholder={t("pharmacy.searchItemCodeGeneric")}
                value={search} onChange={e => handleSearch(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox" className="checkbox"
                checked={lowStockOnly}
                onChange={e => handleLowStockToggle(e.target.checked)}
              />
              <span className="text-sm font-medium">Show Low / Out of Stock Only</span>
              {lowStockOnly && <AlertTriangle className="h-4 w-4 text-orange-500" />}
            </label>
          </div>
        </div>

        {/* Table */}
        <div className="card">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Generic</th>
                      <th>Category</th>
                      <th className="text-right">Stock Qty</th>
                      <th className="text-right">Reorder Level</th>
                      <th>Nearest Expiry</th>
                      <th className="text-right">MRP</th>
                      <th>Batches</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={9}>
                          <div className="flex flex-col items-center py-12 text-gray-400">
                            <Package className="h-10 w-10 mb-2 opacity-30" />
                            <p>No items found</p>
                          </div>
                        </td>
                      </tr>
                    )}
                    {items.map(item => {
                      const isLow = item.reorder_level != null && item.total_qty > 0 && item.total_qty <= item.reorder_level;
                      const isOut = item.total_qty === 0;
                      return (
                        <tr key={item.item_id} className={isOut ? 'bg-red-50' : isLow ? 'bg-orange-50' : ''}>
                          <td>
                            <p className="font-medium text-sm">{item.item_name}</p>
                            {item.item_code && <p className="text-xs text-gray-400 font-mono">{item.item_code}</p>}
                          </td>
                          <td className="text-sm text-gray-500">{item.generic_name || '—'}</td>
                          <td className="text-sm text-gray-500">{item.category_name || '—'}</td>
                          <td className={`text-right font-semibold ${isOut ? 'text-red-600' : isLow ? 'text-orange-500' : ''}`}>
                            {item.total_qty}
                          </td>
                          <td className="text-right text-sm text-gray-500">
                            {item.reorder_level ?? '—'}
                          </td>
                          <td className={`text-sm ${item.nearest_expiry && new Date(item.nearest_expiry) < new Date() ? 'text-red-500 font-medium' : ''}`}>
                            {fmtDate(item.nearest_expiry)}
                          </td>
                          <td className="text-right text-sm">{fmt(item.mrp)}</td>
                          <td className="text-center text-sm">{item.batch_count}</td>
                          <td><StockStatus qty={item.total_qty} reorder={item.reorder_level} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {total > LIMIT && (
                <div className="flex items-center justify-between p-4 text-sm text-gray-500">
                  <span>Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}</span>
                  <div className="flex gap-1">
                    <button className="btn btn-sm btn-ghost" disabled={page === 1} onClick={() => load(page - 1)}>Prev</button>
                    <button className="btn btn-sm btn-ghost" disabled={page * LIMIT >= total} onClick={() => load(page + 1)}>Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

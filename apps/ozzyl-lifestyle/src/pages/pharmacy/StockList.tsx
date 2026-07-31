import { useState, useEffect, useCallback } from 'react';
import { Search, Package, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import HelpButton from '../../components/HelpButton';
import HelpPanel from '../../components/HelpPanel';
import { useTranslation } from 'react-i18next';

interface Stock {
  id: number; item_id: number; item_name?: string; generic_name?: string;
  batch_no: string; available_qty: number; expiry_date?: string;
  cost_price: number; mrp: number; sale_price: number; reorder_level?: number;
}

function expiryStatus(expiry?: string) {
  if (!expiry) return null;
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: 'Expired', cls: 'badge-danger' };
  if (days <= 30) return { label: `${days}d`, cls: 'badge-danger' };
  if (days <= 90) return { label: `${days}d`, cls: 'badge-warning' };
  return { label: `${days}d`, cls: 'badge-success' };
}

export default function PharmacyStockList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [allStock, setAllStock] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'low' | 'expiring'>('all');

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      // F5: Backend /stock only supports itemId, expireBefore, expireAfter — no text search
      const { data } = await axios.get('/api/pharmacy/stock', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAllStock(data.stock ?? []);
    } catch { setAllStock([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStock(); }, [fetchStock]);

  // Client-side filtering for search and stock type
  const displayed = allStock.filter(s => {
    // Text search (client-side since backend doesn't support it)
    if (search.trim()) {
      const q = search.toLowerCase();
      const matches = (s.item_name ?? '').toLowerCase().includes(q)
        || (s.generic_name ?? '').toLowerCase().includes(q)
        || (s.batch_no ?? '').toLowerCase().includes(q);
      if (!matches) return false;
    }
    // Filter tabs
    if (filter === 'low') return s.available_qty <= (s.reorder_level ?? 10);
    if (filter === 'expiring') {
      if (!s.expiry_date) return false;
      const days = Math.floor((new Date(s.expiry_date).getTime() - Date.now()) / 86400000);
      return days <= 90;
    }
    return true;
  });

  return (
    <DashboardLayout role={role}>
      <HelpPanel pageKey="pharmacy_stock" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('stock', { defaultValue: 'Stock Ledger' })}</h1>
            <p className="section-subtitle mt-1">{t('stockSubtitle', { defaultValue: 'Batch-level inventory — FEFO order' })}</p>
          </div>
          <HelpButton onClick={() => setHelpOpen(true)} />
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t('searchStockPlaceholder', { defaultValue: 'Search item or batch…' })} value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" />
          </div>
          <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
            {([['all', 'All'], ['low', 'Low Stock'], ['expiring', 'Expiring']] as const).map(([f, l]) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-2 font-medium transition-colors ${filter === f ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{t(f === 'all' ? 'all' : f === 'low' ? 'lowStock' : 'expiring', { defaultValue: l })}</button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr>
                <th>{t('item', { defaultValue: 'Item' })}</th>
                <th>{t('batch', { defaultValue: 'Batch' })}</th>
                <th>{t('expiry', { defaultValue: 'Expiry' })}</th>
                <th className="text-right">{t('available', { defaultValue: 'Available' })}</th>
                <th className="text-right">{t('costPrice', { defaultValue: 'Cost ৳' })}</th>
                <th className="text-right">MRP ৳</th>
                <th>{t('stockStatus', { defaultValue: 'Status' })}</th>
              </tr></thead>
              <tbody>
                {loading ? ([...Array(8)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : displayed.length === 0 ? (<tr><td colSpan={7} className="py-16 text-center text-[var(--color-text-muted)]">{t('noStock', { defaultValue: 'No stock found' })}</td></tr>)
                : displayed.map(s => {
                  const exp = expiryStatus(s.expiry_date);
                  const isLow = s.available_qty <= (s.reorder_level ?? 10);
                  return (
                    <tr key={s.id}>
                      <td className="font-medium">{s.item_name || s.generic_name}</td>
                      <td className="font-mono text-xs">{s.batch_no}</td>
                      <td>{s.expiry_date ? new Date(s.expiry_date).toLocaleDateString() : '—'}</td>
                      <td className="text-right font-data"><span className={isLow ? 'text-amber-600 font-semibold' : ''}>{s.available_qty}</span></td>
                      <td className="text-right font-data">৳{((s.cost_price ?? 0) / 100).toFixed(2)}</td>
                      <td className="text-right font-data">৳{((s.mrp ?? 0) / 100).toFixed(2)}</td>
                      <td>
                        {isLow && <span className="badge badge-warning flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {t('low', { defaultValue: 'Low' })}</span>}
                        {exp && <span className={`badge ${exp.cls} ml-1`}>{exp.label}</span>}
                        {!isLow && !exp && <span className="badge badge-success flex items-center gap-1"><Package className="w-3 h-3" /> OK</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

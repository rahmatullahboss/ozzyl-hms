import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Filter, Package, Printer, QrCode, RefreshCw, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { api } from '../../lib/apiClient';
import DashboardLayout from '../../components/DashboardLayout';
import EmptyState from '../../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';

interface Stock {
  StockId: number;
  ItemId: number;
  ItemName: string;
  ItemCode?: string;
  ItemType?: string;
  CategoryName?: string;
  StoreName?: string;
  VendorName?: string;
  BatchNo?: string;
  ExpiryDate?: string;
  AvailableQuantity: number;
  ReservedQuantity?: number;
  DamagedQuantity?: number;
  BlockedQuantity?: number;
  RackShelf?: string;
  CostPrice: number;
  MRP?: number;
  StockValue: number;
  Status: 'available' | 'low_stock' | 'out_of_stock' | 'expiring_soon' | 'expired' | 'blocked' | 'damaged';
}

interface StockResponse {
  data: Stock[];
  pagination?: { total: number };
}

export type Filters = {
  search: string;
  ItemType: string;
  StoreId: string;
  ExpiryTo: string;
  LowStock: boolean;
  OutOfStock: boolean;
};

const STATUS_BADGE: Record<string, string> = {
  available: 'badge-success',
  low_stock: 'badge-warning',
  out_of_stock: 'badge-danger',
  expiring_soon: 'badge-warning',
  expired: 'badge-danger',
  blocked: 'badge-secondary',
  damaged: 'badge-danger',
};

const ITEM_TYPES = [
  ['medicine', 'Medicine'],
  ['consumable', 'Consumable'],
  ['lab_reagent', 'Lab reagent'],
  ['ot_item', 'OT item'],
  ['ward_item', 'Ward item'],
  ['asset', 'Asset'],
  ['equipment', 'Equipment'],
  ['general', 'General'],
] as const;

export function statusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildPath(page: number, limit: number, filters: Filters) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.search) params.set('search', filters.search);
  if (filters.ItemType) params.set('ItemType', filters.ItemType);
  if (filters.StoreId) params.set('StoreId', filters.StoreId);
  if (filters.ExpiryTo) params.set('ExpiryTo', filters.ExpiryTo);
  if (filters.LowStock) params.set('LowStock', 'true');
  if (filters.OutOfStock) params.set('OutOfStock', 'true');
  return `/api/inventory/stock/overview?${params.toString()}`;
}

export default function StockList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Stock | null>(null);
  const [filters, setFilters] = useState<Filters>({
    search: '',
    ItemType: '',
    StoreId: '',
    ExpiryTo: '',
    LowStock: false,
    OutOfStock: false,
  });
  const limit = 25;

  const path = useMemo(() => buildPath(page, limit, filters), [page, filters]);
  const { data: raw, isLoading, refetch, isFetching } = useApiQuery<StockResponse>(
    queryKeys.inventory.stock({ page, limit, ...filters }),
    path,
    { placeholderData: (prev) => prev },
  );

  const stocks = raw?.data ?? [];
  const total = raw?.pagination?.total ?? 0;

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleScan = async (code: string) => {
    const normalized = code.trim();
    if (!normalized) return;
    try {
      const result = await api.get<{ tag: { EntityType: string; EntityId: number }; entity?: any }>(`/api/inventory/qr/scan/${encodeURIComponent(normalized)}?purpose=stock_overview`);
      if (result.tag?.EntityType === 'stock' && result.entity) {
        setSelected({
          ...result.entity,
          StockValue: Number(result.entity.AvailableQuantity || 0) * Number(result.entity.CostPrice || 0),
          Status: 'available',
        });
      } else if (result.tag?.EntityType === 'item') {
        updateFilter('search', result.entity?.ItemName || result.entity?.ItemCode || normalized);
      } else {
        toast.success('QR resolved');
      }
    } catch (error: any) {
      toast.error(error.message || 'QR not found');
    }
  };

  const printQr = async (stock: Stock) => {
    try {
      const generated = await api.post<{ tagCode: string }>('/api/inventory/qr/generate', {
        EntityType: 'stock',
        EntityId: stock.StockId,
        HumanLabel: `${stock.ItemName}${stock.BatchNo ? ` · ${stock.BatchNo}` : ''}`,
      });
      const label = await api.post<{ svg: string; tagCode: string }>(`/api/inventory/qr/${generated.tagCode}/print`, {});
      const printWindow = window.open('', '_blank', 'width=380,height=520');
      if (printWindow) {
        const itemName = escapeHtml(stock.ItemName);
        const batchNo = escapeHtml(stock.BatchNo || '-');
        const expiryDate = escapeHtml(stock.ExpiryDate || '-');
        const rackShelf = escapeHtml(stock.RackShelf || '-');
        const tagCode = escapeHtml(label.tagCode);
        printWindow.document.write(`
          <html><head><title>${tagCode}</title><style>
            body{font-family:Arial,sans-serif;margin:12px;color:#111}
            .label{width:52mm;border:1px solid #111;padding:6px;text-align:center}
            .item{font-weight:700;font-size:12px;margin-bottom:4px}
            .meta{font-size:10px;margin:2px 0}
            svg{width:34mm;height:34mm}
          </style></head><body>
          <div class="label">
            <div class="item">${itemName}</div>
            <div class="meta">Batch: ${batchNo}</div>
            <div class="meta">Expiry: ${expiryDate}</div>
            <div class="meta">Rack: ${rackShelf}</div>
            ${label.svg}
            <div class="meta">${tagCode}</div>
          </div>
          <script>window.print();</script></body></html>
        `);
        printWindow.document.close();
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to print QR');
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('stockList', { defaultValue: 'Stock Overview' })}</h1>
            <p className="section-subtitle mt-1">Batch, expiry, rack, valuation, QR, and store-wise availability.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => refetch()} className="btn-secondary" disabled={isFetching}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={() => window.print()} className="btn-secondary">
              <Download className="w-4 h-4" /> Export view
            </button>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                type="text"
                placeholder="Search item, code, batch"
                value={filters.search}
                onChange={e => updateFilter('search', e.target.value)}
                className="input pl-9"
              />
            </div>
            <div className="relative min-w-52">
              <QrCode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                className="input pl-9"
                placeholder="Scan then Enter"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleScan((event.target as HTMLInputElement).value);
                    (event.target as HTMLInputElement).value = '';
                  }
                }}
              />
            </div>
            <select className="input w-44" value={filters.ItemType} onChange={e => updateFilter('ItemType', e.target.value)}>
              <option value="">All item types</option>
              {ITEM_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className="input w-36" type="number" min="1" placeholder="Store ID" value={filters.StoreId} onChange={e => updateFilter('StoreId', e.target.value)} />
            <input className="input w-40" type="date" value={filters.ExpiryTo} onChange={e => updateFilter('ExpiryTo', e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={`btn-secondary text-sm ${filters.LowStock ? 'ring-2 ring-amber-300' : ''}`} onClick={() => updateFilter('LowStock', !filters.LowStock)}>
              <Filter className="w-4 h-4" /> Low stock
            </button>
            <button className={`btn-secondary text-sm ${filters.OutOfStock ? 'ring-2 ring-red-300' : ''}`} onClick={() => updateFilter('OutOfStock', !filters.OutOfStock)}>
              <AlertTriangle className="w-4 h-4" /> Out of stock
            </button>
            {(filters.search || filters.ItemType || filters.StoreId || filters.ExpiryTo || filters.LowStock || filters.OutOfStock) && (
              <button className="btn-ghost text-sm" onClick={() => { setFilters({ search: '', ItemType: '', StoreId: '', ExpiryTo: '', LowStock: false, OutOfStock: false }); setPage(1); }}>
                <X className="w-4 h-4" /> Clear
              </button>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Store</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th>Rack</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Value</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(6)].map((_, i) => <tr key={i}>{[...Array(11)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : stocks.length === 0 ? (
                  <tr><td colSpan={11} className="py-16"><EmptyState icon={<Package className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No stock found" description="" /></td></tr>
                ) : stocks.map(stock => (
                  <tr key={stock.StockId} onClick={() => setSelected(stock)} className="cursor-pointer">
                    <td>
                      <p className="font-medium">{stock.ItemName}</p>
                      {stock.ItemCode && <p className="text-xs text-[var(--color-text-muted)]">{stock.ItemCode}</p>}
                    </td>
                    <td className="capitalize">{statusLabel(stock.ItemType || 'general')}</td>
                    <td>{stock.StoreName || '—'}</td>
                    <td className="font-data text-sm">{stock.BatchNo || '—'}</td>
                    <td className="font-data text-sm">{stock.ExpiryDate || '—'}</td>
                    <td>{stock.RackShelf || '—'}</td>
                    <td className="text-right font-data font-semibold">{stock.AvailableQuantity}</td>
                    <td className="text-right font-data">{stock.ReservedQuantity || 0}</td>
                    <td className="text-right font-data">৳{Number(stock.StockValue || 0).toLocaleString()}</td>
                    <td><span className={`badge ${STATUS_BADGE[stock.Status] || 'badge-secondary'} capitalize`}>{statusLabel(stock.Status)}</span></td>
                    <td>
                      <button
                        className="btn-ghost p-1.5"
                        title="Print QR label"
                        onClick={(event) => { event.stopPropagation(); printQr(stock); }}
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > limit && (
            <div className="p-4 border-t border-[var(--color-border)] flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">
                Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-secondary text-sm">Previous</button>
                <button disabled={page * limit >= total} onClick={() => setPage(p => p + 1)} className="btn-secondary text-sm">Next</button>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={() => setSelected(null)}>
            <aside className="w-full max-w-xl h-full bg-[var(--color-surface)] shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-[var(--color-border)] flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{selected.ItemName}</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">{selected.ItemCode || selected.BatchNo || `Stock #${selected.StockId}`}</p>
                </div>
                <button className="btn-ghost p-1.5" onClick={() => setSelected(null)}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Available', selected.AvailableQuantity],
                    ['Reserved', selected.ReservedQuantity || 0],
                    ['Damaged', selected.DamagedQuantity || 0],
                    ['Blocked', selected.BlockedQuantity || 0],
                    ['Cost', `৳${Number(selected.CostPrice || 0).toFixed(2)}`],
                    ['Value', `৳${Number(selected.StockValue || 0).toLocaleString()}`],
                  ].map(([label, value]) => (
                    <div key={label} className="border border-[var(--color-border)] rounded-lg p-3">
                      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                      <p className="font-data font-semibold mt-1">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 text-sm">
                  <p><span className="text-[var(--color-text-muted)]">Store:</span> {selected.StoreName || '—'}</p>
                  <p><span className="text-[var(--color-text-muted)]">Category:</span> {selected.CategoryName || '—'}</p>
                  <p><span className="text-[var(--color-text-muted)]">Supplier:</span> {selected.VendorName || '—'}</p>
                  <p><span className="text-[var(--color-text-muted)]">Batch:</span> {selected.BatchNo || '—'}</p>
                  <p><span className="text-[var(--color-text-muted)]">Expiry:</span> {selected.ExpiryDate || '—'}</p>
                  <p><span className="text-[var(--color-text-muted)]">Rack:</span> {selected.RackShelf || '—'}</p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={() => printQr(selected)}><Printer className="w-4 h-4" /> Print QR</button>
                  <button className="btn-secondary" onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() })}><RefreshCw className="w-4 h-4" /> Refresh stock</button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

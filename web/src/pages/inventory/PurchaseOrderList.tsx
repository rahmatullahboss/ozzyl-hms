import { useState } from 'react';
import { Link } from 'react-router';
import { ShoppingCart, Search, Plus, Eye } from 'lucide-react';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { formatDisplayDate } from '../../lib/date-utils';

interface PO {
  PurchaseOrderId: number; PONumber: string; PODate: string; VendorName: string;
  POStatus: string; TotalAmount: number; CreatedOn: string;
}

interface POResponse {
  data: PO[];
  pagination?: { total: number };
}

const statusMap: Record<string, string> = { pending: 'badge-warning', partial: 'badge-info', complete: 'badge-success', cancelled: 'badge-danger' };

const FALLBACK: PO[] = [
  { PurchaseOrderId: 1, PONumber: 'PO-2025-001', PODate: '2025-03-10', VendorName: 'MedSupply Ltd', POStatus: 'pending', TotalAmount: 45000, CreatedOn: new Date().toISOString() },
  { PurchaseOrderId: 2, PONumber: 'PO-2025-002', PODate: '2025-03-08', VendorName: 'SurgEquip Co', POStatus: 'complete', TotalAmount: 125000, CreatedOn: new Date().toISOString() },
];

export default function PurchaseOrderList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const filters = { page, limit, search: search || undefined, POStatus: statusFilter || undefined };

  const { data: raw, isLoading: loading } = useApiQuery<POResponse>(
    queryKeys.inventory.purchaseOrders(filters),
    `/api/inventory/purchase-orders?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}${statusFilter ? `&POStatus=${statusFilter}` : ''}`,
    { placeholderData: (prev) => prev },
  );

  const orders = raw?.data ?? (loading ? [] : FALLBACK);
  const total = raw?.pagination?.total ?? (loading ? 0 : FALLBACK.length);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('purchaseOrders', { defaultValue: 'Purchase Orders' })}</h1>
            <p className="section-subtitle mt-1">{t('poSubtitle', { defaultValue: 'Manage purchase orders to vendors' })}</p>
          </div>
          <Link to="/inventory/po/new"><button className="btn-primary"><Plus className="w-4 h-4 mr-1 inline" /> {t('createPO', { defaultValue: 'Create PO' })}</button></Link>
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t("inventory.search_po_number_or_vendor")} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-9" />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input w-40">
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="partial">Partial</option>
            <option value="complete">Complete</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr>
                <th>PO #</th><th>Date</th><th>Vendor</th><th className="text-right">Amount</th><th>Status</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : orders.length === 0 ? (
                  <tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No purchase orders found</td></tr>
                ) : orders.map(o => (
                  <tr key={o.PurchaseOrderId}>
                    <td className="font-medium text-[var(--color-primary)]">{o.PONumber}</td>
                    <td className="text-[var(--color-text-secondary)]">{o.PODate ? formatDisplayDate(o.PODate) : '—'}</td>
                    <td>{o.VendorName || '—'}</td>
                    <td className="text-right font-data font-semibold">৳{o.TotalAmount?.toLocaleString()}</td>
                    <td><span className={`badge ${statusMap[o.POStatus] || 'badge-secondary'}`}>{o.POStatus}</span></td>
                    <td>
                      <Link to={`/inventory/po/${o.PurchaseOrderId}`} className="btn-ghost p-1.5" title="View"><Eye className="w-4 h-4" /></Link>
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

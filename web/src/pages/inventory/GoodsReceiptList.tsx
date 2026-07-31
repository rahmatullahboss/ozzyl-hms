import { useState } from 'react';
import { Link } from 'react-router';
import { ClipboardList, Search, Plus, Eye } from 'lucide-react';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { formatDisplayDate } from '../../lib/date-utils';

interface GR { GoodsReceiptId: number; GRNumber: string; GRDate: string; VendorName: string; PONumber: string; PaymentStatus: string; TotalAmount: number; }

interface GRResponse {
  data: GR[];
  pagination?: { total: number };
}

const paymentBadge: Record<string, string> = { pending: 'badge-warning', partial: 'badge-info', paid: 'badge-success' };

const FALLBACK: GR[] = [
  { GoodsReceiptId: 1, GRNumber: 'GRN-001', GRDate: '2025-03-12', VendorName: 'MedSupply Ltd', PONumber: 'PO-2025-001', PaymentStatus: 'pending', TotalAmount: 45000 },
];

export default function GoodsReceiptList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const filters = { page, limit, search: search || undefined };

  const { data: raw, isLoading: loading } = useApiQuery<GRResponse>(
    queryKeys.inventory.goodsReceipts(filters),
    `/api/inventory/goods-receipts?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { placeholderData: (prev) => prev },
  );

  const grns = raw?.data ?? (loading ? [] : FALLBACK);
  const total = raw?.pagination?.total ?? (loading ? 0 : FALLBACK.length);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">Goods Receipt Notes</h1><p className="section-subtitle mt-1">Track incoming goods from vendors</p></div>
          <Link to="/inventory/gr/new"><button className="btn-primary"><Plus className="w-4 h-4 mr-1 inline" /> New GRN</button></Link>
        </div>
        <div className="card p-4"><div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t("inventory.search_grn")} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-9 w-full" /></div></div>
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>GRN #</th><th>Date</th><th>Vendor</th><th>PO #</th><th className="text-right">Amount</th><th>Payment</th><th>Actions</th></tr></thead><tbody>
          {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>) :
          grns.length === 0 ? <tr><td colSpan={7} className="py-16 text-center text-[var(--color-text-muted)]">No goods receipts found</td></tr> :
          grns.map(g => <tr key={g.GoodsReceiptId}><td className="font-medium text-[var(--color-primary)]">{g.GRNumber}</td><td className="text-[var(--color-text-secondary)]">{g.GRDate ? formatDisplayDate(g.GRDate) : '—'}</td><td>{g.VendorName}</td><td>{g.PONumber || '—'}</td><td className="text-right font-data font-semibold">৳{g.TotalAmount?.toLocaleString()}</td><td><span className={`badge ${paymentBadge[g.PaymentStatus] || 'badge-secondary'}`}>{g.PaymentStatus}</span></td><td><Link to={`/inventory/gr/${g.GoodsReceiptId}`} className="btn-ghost p-1.5"><Eye className="w-4 h-4" /></Link></td></tr>)}
        </tbody></table></div>
        {total > limit && <div className="p-4 border-t border-[var(--color-border)] flex justify-between"><span className="text-sm text-[var(--color-text-muted)]">Page {page}</span><div className="flex gap-2"><button disabled={page<=1} onClick={() => setPage(p=>p-1)} className="btn-secondary text-sm">Prev</button><button disabled={page*limit>=total} onClick={() => setPage(p=>p+1)} className="btn-secondary text-sm">Next</button></div></div>}
        </div>
      </div>
    </DashboardLayout>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Search, Plus, Eye } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { formatDisplayDate } from '../../lib/date-utils';

interface Req { RequisitionId: number; RequisitionNo: string; RequisitionDate: string; RequestingStoreName: string; RequisitionStatus: string; Priority: string; }

interface ReqResponse {
  data: Req[];
  pagination?: { total: number };
}

const statusBadge: Record<string, string> = { pending: 'badge-warning', approved: 'badge-success', partial: 'badge-info', complete: 'badge-success', cancelled: 'badge-danger' };
const priorityBadge: Record<string, string> = { urgent: 'badge-danger', high: 'badge-warning', normal: 'badge-info', low: 'badge-secondary' };

export default function RequisitionList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const filters = { page, limit, search: search || undefined };

  const { data: raw, isLoading: loading } = useApiQuery<ReqResponse>(
    queryKeys.inventory.requisitions(filters),
    `/api/inventory/requisitions?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { placeholderData: (prev) => prev },
  );

  const reqs = raw?.data ?? [];
  const total = raw?.pagination?.total ?? 0;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">Requisitions</h1><p className="section-subtitle mt-1">Internal stock requests from departments</p></div>
          <Link to={`${base}/inventory/requisitions/new`}><button className="btn-primary"><Plus className="w-4 h-4 mr-1 inline" /> New Requisition</button></Link>
        </div>
        <div className="card p-4"><div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t("inventory.search_requisition")} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-9 w-full" /></div></div>
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Req #</th><th>Date</th><th>Store</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>) :
          reqs.length === 0 ? <tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No requisitions found</td></tr> :
          reqs.map(r => <tr key={r.RequisitionId}><td className="font-medium text-[var(--color-primary)]"><Link to={`${base}/inventory/requisitions/${r.RequisitionId}`}>{r.RequisitionNo}</Link></td><td className="text-[var(--color-text-secondary)]">{r.RequisitionDate ? formatDisplayDate(r.RequisitionDate) : '—'}</td><td>{r.RequestingStoreName}</td><td><span className={`badge ${priorityBadge[r.Priority]||'badge-secondary'}`}>{r.Priority}</span></td><td><span className={`badge ${statusBadge[r.RequisitionStatus]||'badge-secondary'}`}>{r.RequisitionStatus}</span></td><td><Link to={`${base}/inventory/requisitions/${r.RequisitionId}`} className="btn-ghost p-1.5"><Eye className="w-4 h-4" /></Link></td></tr>)}
        </tbody></table></div>
        {total > limit && <div className="p-4 border-t border-[var(--color-border)] flex justify-between"><span className="text-sm text-[var(--color-text-muted)]">Page {page}</span><div className="flex gap-2"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="btn-secondary text-sm">Prev</button><button disabled={page*limit>=total} onClick={()=>setPage(p=>p+1)} className="btn-secondary text-sm">Next</button></div></div>}
        </div>
      </div>
    </DashboardLayout>
  );
}

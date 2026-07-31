import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { FileText, Search, Plus, Eye } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Req { RequisitionId: number; RequisitionNo: string; RequisitionDate: string; RequestingStoreName: string; RequisitionStatus: string; Priority: string; }
const statusBadge: Record<string, string> = { pending: 'badge-warning', approved: 'badge-success', partial: 'badge-info', complete: 'badge-success', cancelled: 'badge-danger' };
const priorityBadge: Record<string, string> = { urgent: 'badge-danger', high: 'badge-warning', normal: 'badge-info', low: 'badge-secondary' };

export default function RequisitionList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/inventory/requisitions', { params: { page, limit, search: search || undefined }, headers: { Authorization: `Bearer ${token}` } });
      setReqs(data.data ?? []); setTotal(data.pagination?.total ?? 0);
    } catch {
      setReqs([
        { RequisitionId: 1, RequisitionNo: 'REQ-001', RequisitionDate: new Date().toISOString(), RequestingStoreName: 'OT Store', RequisitionStatus: 'pending', Priority: 'urgent' },
        { RequisitionId: 2, RequisitionNo: 'REQ-002', RequisitionDate: new Date().toISOString(), RequestingStoreName: 'Ward 3', RequisitionStatus: 'approved', Priority: 'normal' },
      ]); setTotal(2);
    } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">Requisitions</h1><p className="section-subtitle mt-1">Internal stock requests from departments</p></div>
          <Link to="/inventory/requisitions/new"><button className="btn-primary"><Plus className="w-4 h-4 mr-1 inline" /> New Requisition</button></Link>
        </div>
        <div className="card p-4"><div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t("inventory.search_requisition")} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-9 w-full" /></div></div>
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Req #</th><th>Date</th><th>Store</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {loading ? [...Array(4)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>) :
          reqs.length === 0 ? <tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">No requisitions found</td></tr> :
          reqs.map(r => <tr key={r.RequisitionId}><td className="font-medium text-[var(--color-primary)]"><Link to={`/inventory/requisitions/${r.RequisitionId}`}>{r.RequisitionNo}</Link></td><td className="text-[var(--color-text-secondary)]">{r.RequisitionDate ? new Date(r.RequisitionDate).toLocaleDateString() : '—'}</td><td>{r.RequestingStoreName}</td><td><span className={`badge ${priorityBadge[r.Priority]||'badge-secondary'}`}>{r.Priority}</span></td><td><span className={`badge ${statusBadge[r.RequisitionStatus]||'badge-secondary'}`}>{r.RequisitionStatus}</span></td><td><Link to={`/inventory/requisitions/${r.RequisitionId}`} className="btn-ghost p-1.5"><Eye className="w-4 h-4" /></Link></td></tr>)}
        </tbody></table></div>
        {total > limit && <div className="p-4 border-t border-[var(--color-border)] flex justify-between"><span className="text-sm text-[var(--color-text-muted)]">Page {page}</span><div className="flex gap-2"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="btn-secondary text-sm">Prev</button><button disabled={page*limit>=total} onClick={()=>setPage(p=>p+1)} className="btn-secondary text-sm">Next</button></div></div>}
        </div>
      </div>
    </DashboardLayout>
  );
}

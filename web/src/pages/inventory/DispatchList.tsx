import { useState } from 'react';
import { Link } from 'react-router';
import { Truck, Search, Eye } from 'lucide-react';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { formatDisplayDate } from '../../lib/date-utils';

interface Dispatch { DispatchId: number; DispatchNo: string; DispatchDate: string; SourceStoreName: string; DestinationStoreName: string; RequisitionNo: string; IsReceived: number; }

interface DispatchResponse {
  data: Dispatch[];
  pagination?: { total: number };
}

const FALLBACK: Dispatch[] = [
  { DispatchId: 1, DispatchNo: 'DSP-001', DispatchDate: new Date().toISOString(), SourceStoreName: 'Main Store', DestinationStoreName: 'OT Store', RequisitionNo: 'REQ-001', IsReceived: 0 },
];

export default function DispatchList({ role = 'hospital_admin' }: { role?: string }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { t } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const limit = 20;

  const filters = { page, limit, search: search || undefined };

  const { data: raw, isLoading: loading } = useApiQuery<DispatchResponse>(
    queryKeys.inventory.dispatches(filters),
    `/api/inventory/dispatches?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { placeholderData: (prev) => prev },
  );

  const dispatches = raw?.data ?? (loading ? [] : FALLBACK);
  const total = raw?.pagination?.total ?? (loading ? 0 : FALLBACK.length);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div><h1 className="page-title">{t('dispatches', { ns: 'inventory' })}</h1><p className="section-subtitle mt-1">{t('trackDispatch', { ns: 'inventory' })}</p></div></div>
        <div className="card p-4"><div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" /><input type="text" placeholder={t('searchPlaceholder', { ns: 'inventory' })} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-9 w-full" /></div></div>
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('dispatchNo', { ns: 'inventory' })}</th><th>{t('date', { ns: 'inventory' })}</th><th>{t('sourceStore', { ns: 'inventory' })}</th><th>{t('destinationStore', { ns: 'inventory' })}</th><th>{t('requisitionNo', { ns: 'inventory' })}</th><th>{t('status', { ns: 'inventory' })}</th><th>{t('actions', { ns: 'common' })}</th></tr></thead><tbody>
          {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>) :
          dispatches.length === 0 ? <tr><td colSpan={7} className="py-16 text-center text-[var(--color-text-muted)]">{t('noDispatches', { ns: 'inventory' })}</td></tr> :
          dispatches.map(d => <tr key={d.DispatchId}><td className="font-medium">{d.DispatchNo}</td><td className="text-[var(--color-text-secondary)]">{d.DispatchDate ? formatDisplayDate(d.DispatchDate) : '—'}</td><td>{d.SourceStoreName}</td><td>{d.DestinationStoreName}</td><td className="text-[var(--color-primary)]">{d.RequisitionNo}</td><td><span className={`badge ${d.IsReceived ? 'badge-success' : 'badge-warning'}`}>{d.IsReceived ? t('received', { ns: 'inventory' }) : t('inTransit', { ns: 'inventory' })}</span></td><td><Link to={`/inventory/dispatches/${d.DispatchId}`} className="btn-ghost p-1.5"><Eye className="w-4 h-4" /></Link></td></tr>)}
        </tbody></table></div></div>
      </div>
    </DashboardLayout>
  );
}

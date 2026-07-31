import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { Plus, Eye } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface PO {
  id: number; po_no: string; po_date: string;
  supplier_name?: string; total_amount: number;
  status: string; remarks?: string;
}

function statusBadge(s: string) {
  const m: Record<string, string> = { draft: 'badge-secondary', pending: 'badge-warning', partial: 'badge-info', complete: 'badge-success', cancelled: 'badge-danger' };
  return m[s] ?? 'badge-secondary';
}

export default function PurchaseOrderList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [pos, setPOs] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/purchase-orders', {
        params: { status: statusFilter === 'all' ? undefined : statusFilter },
        headers: { Authorization: `Bearer ${token}` },
      });
      setPOs(data.purchaseOrders ?? []);
    } catch { setPOs([]); } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">{t('purchaseOrders', { defaultValue: 'Purchase Orders' })}</h1></div>
          <Link to={`${base}/pharmacy/po/new`}><button className="btn-primary"><Plus className="w-4 h-4" /> {t('createPO', { defaultValue: 'Create PO' })}</button></Link>
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div role="tablist" aria-label="Filter Purchase Orders by Status" className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
            {(['all', 'pending', 'partial', 'complete', 'cancelled'] as const).map(s => (
              <button key={s} role="tab" aria-selected={statusFilter === s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 font-medium transition-colors capitalize ${statusFilter === s ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{s}</button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>PO #</th><th>{t('date', { defaultValue: 'Date' })}</th><th>{t('supplier', { defaultValue: 'Supplier' })}</th><th className="text-right">{t('total', { defaultValue: 'Amount (৳)' })}</th><th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th><th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th></tr></thead>
              <tbody>
                {loading ? ([...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : pos.length === 0 ? (<tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]">{t('noPurchaseOrders', { defaultValue: 'No purchase orders' })}</td></tr>)
                : pos.map(po => (
                  <tr key={po.id}>
                    <td className="font-medium font-mono text-sm">{po.po_no}</td>
                    <td className="text-[var(--color-text-secondary)]">{new Date(po.po_date).toLocaleDateString()}</td>
                    <td>{po.supplier_name || '—'}</td>
                    <td className="text-right font-data">৳{((po.total_amount ?? 0) / 100).toLocaleString()}</td>
                    <td><span className={`badge ${statusBadge(po.status)}`}>{po.status}</span></td>
                    <td><div className="flex gap-1.5">
                      <button className="btn-ghost p-1.5 text-xs" title="View"><Eye className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
import { Package, ShoppingCart, AlertTriangle, FileText, TrendingDown, Activity, ArrowRight } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import KPICard from '../../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';

interface StockAlert {
  StockId: number;
  ItemId: number;
  ItemName: string;
  ItemCode: string;
  StoreName: string;
  AvailableQuantity: number;
  ReOrderLevel: number;
}

interface RecentRequisition {
  RequisitionId: number;
  RequisitionNo: string;
  RequisitionDate: string;
  RequestingStoreName: string;
  RequisitionStatus: string;
  Priority: string;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'badge-warning', approved: 'badge-success', partial: 'badge-info',
    complete: 'badge-success', cancelled: 'badge-danger',
  };
  return map[status] || 'badge-secondary';
}

function priorityBadge(priority: string) {
  const map: Record<string, string> = {
    urgent: 'badge-danger', high: 'badge-warning', normal: 'badge-info', low: 'badge-secondary',
  };
  return map[priority] || 'badge-secondary';
}

export default function InventoryDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalItems: 0, lowStock: 0, pendingPO: 0, pendingReq: 0 });
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [requisitions, setRequisitions] = useState<RecentRequisition[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const headers = { Authorization: `Bearer ${token}` };
      const [stockRes, reqRes, itemsRes, poRes] = await Promise.allSettled([
        axios.get('/api/inventory/stock', { params: { LowStock: true, limit: 10 }, headers }),
        axios.get('/api/inventory/requisitions', { params: { limit: 5 }, headers }),
        axios.get('/api/inventory/items', { params: { page: 1, limit: 1 }, headers }),
        axios.get('/api/inventory/purchase-orders', { params: { POStatus: 'pending', page: 1, limit: 1 }, headers }),
      ]);

      if (stockRes.status === 'fulfilled') setStockAlerts(stockRes.value.data.data ?? []);
      if (reqRes.status === 'fulfilled') setRequisitions(reqRes.value.data.data ?? []);

      setStats({
        totalItems: itemsRes.status === 'fulfilled' ? itemsRes.value.data.pagination?.total ?? 0 : 0,
        lowStock: stockRes.status === 'fulfilled' ? stockRes.value.data.pagination?.total ?? 0 : 0,
        pendingPO: poRes.status === 'fulfilled' ? poRes.value.data.pagination?.total ?? 0 : 0,
        pendingReq: reqRes.status === 'fulfilled' ? reqRes.value.data.pagination?.total ?? 0 : 0,
      });
    } catch (err) {
      console.error('Failed to fetch inventory dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title', { defaultValue: 'Inventory Management' })}</h1>
            <p className="section-subtitle mt-1">{t('subtitle', { defaultValue: 'Monitor stock levels, purchase orders and requisitions' })}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/inventory/requisitions/new">
              <button className="btn-secondary text-sm"><FileText className="w-4 h-4 mr-1 inline" /> {t('newRequisition', { defaultValue: 'New Requisition' })}</button>
            </Link>
            <Link to="/inventory/po/new">
              <button className="btn-primary"><ShoppingCart className="w-4 h-4 mr-1 inline" /> {t('createPO', { defaultValue: 'Create PO' })}</button>
            </Link>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('totalItems', { defaultValue: 'Total Items' })} value={stats.totalItems} loading={loading} icon={<Package className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('lowStock', { defaultValue: 'Low Stock Alerts' })} value={stats.lowStock} loading={loading} icon={<AlertTriangle className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
          <KPICard title={t('pendingPO', { defaultValue: 'Pending POs' })} value={stats.pendingPO} loading={loading} icon={<ShoppingCart className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title={t('pendingRequisitions', { defaultValue: 'Pending Requisitions' })} value={stats.pendingReq} loading={loading} icon={<FileText className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
        </div>

        {/* Two-column panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Critical Stock Alerts */}
          <div className="card">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-500" />
                <h3 className="font-semibold">{t('criticalStock', { defaultValue: 'Critical Stock Alerts' })}</h3>
              </div>
              <Link to="/inventory/stock" className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
                {t('viewAll', { ns: 'common', defaultValue: 'View All' })} <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr>
                  <th>{t('item', { defaultValue: 'Item' })}</th>
                  <th className="text-right">{t('available', { defaultValue: 'Available' })}</th>
                  <th className="text-right">{t('reorderLevel', { defaultValue: 'Reorder Level' })}</th>
                  <th>{t('store', { defaultValue: 'Store' })}</th>
                </tr></thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  ) : stockAlerts.length === 0 ? (
                    <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">{t('noAlerts', { defaultValue: 'All stock levels healthy ✓' })}</td></tr>
                  ) : (
                    stockAlerts.map(s => (
                      <tr key={s.StockId}>
                        <td>
                          <div className="flex items-center gap-2">
                            <TrendingDown className="w-3.5 h-3.5 text-amber-500" />
                            <div>
                              <p className="font-medium">{s.ItemName}</p>
                              {s.ItemCode && <p className="text-xs text-[var(--color-text-muted)]">{s.ItemCode}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="text-right font-data"><span className="text-red-600 font-semibold">{s.AvailableQuantity}</span></td>
                        <td className="text-right font-data text-[var(--color-text-secondary)]">{s.ReOrderLevel}</td>
                        <td className="text-[var(--color-text-secondary)]">{s.StoreName}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Requisitions */}
          <div className="card">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-500" />
                <h3 className="font-semibold">{t('recentRequisitions', { defaultValue: 'Recent Requisitions' })}</h3>
              </div>
              <Link to="/inventory/requisitions" className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
                {t('viewAll', { ns: 'common', defaultValue: 'View All' })} <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr>
                  <th>{t('reqNo', { defaultValue: 'Req #' })}</th>
                  <th>{t('store', { defaultValue: 'Store' })}</th>
                  <th>{t('priority', { defaultValue: 'Priority' })}</th>
                  <th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th>
                </tr></thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  ) : requisitions.length === 0 ? (
                    <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">{t('noRequisitions', { defaultValue: 'No recent requisitions' })}</td></tr>
                  ) : (
                    requisitions.map(r => (
                      <tr key={r.RequisitionId}>
                        <td><Link to={`/inventory/requisitions/${r.RequisitionId}`} className="font-medium text-[var(--color-primary)] hover:underline">{r.RequisitionNo}</Link></td>
                        <td className="text-[var(--color-text-secondary)]">{r.RequestingStoreName}</td>
                        <td><span className={`badge ${priorityBadge(r.Priority)}`}>{r.Priority}</span></td>
                        <td><span className={`badge ${statusBadge(r.RequisitionStatus)}`}>{r.RequisitionStatus}</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

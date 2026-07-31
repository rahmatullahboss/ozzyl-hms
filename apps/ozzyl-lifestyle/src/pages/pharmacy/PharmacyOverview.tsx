import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import {
  Pill, ShoppingCart, AlertTriangle, TrendingDown, FileText,
  Package, ArrowRight, Activity, DollarSign,
} from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import KPICard from '../../components/dashboard/KPICard';
import HelpButton from '../../components/HelpButton';
import HelpPanel from '../../components/HelpPanel';
import { useTranslation } from 'react-i18next';

interface LowStockAlert {
  id: number; name: string; reorder_level: number; stock_qty: number;
}

interface ExpiringAlert {
  id: number; item_id: number; item_name?: string;
  batch_no: string; available_qty: number; expiry_date?: string;
}

export default function PharmacyOverview({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;

  const [loading, setLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [summary, setSummary] = useState({
    totalInvestment: 0, totalIncome: 0, totalCostOfGoodsSold: 0, grossProfit: 0,
  });
  const [lowStock, setLowStock] = useState<LowStockAlert[]>([]);
  const [expiring, setExpiring] = useState<ExpiringAlert[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const headers = { Authorization: `Bearer ${token}` };
      const [sumRes, lowRes, expRes] = await Promise.allSettled([
        axios.get('/api/pharmacy/summary', { headers }),
        axios.get('/api/pharmacy/alerts/low-stock', { headers }),
        axios.get('/api/pharmacy/alerts/expiring', { params: { days: 30 }, headers }),
      ]);
      // Backend returns flat object, not wrapped in 'summary' key
      if (sumRes.status === 'fulfilled') setSummary(sumRes.value.data ?? {});
      // Backend returns { alerts: [...] }, not { batches: [...] }
      if (lowRes.status === 'fulfilled') setLowStock((lowRes.value.data.alerts ?? []).slice(0, 8));
      if (expRes.status === 'fulfilled') setExpiring((expRes.value.data.alerts ?? []).slice(0, 8));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <DashboardLayout role={role}>
      <HelpPanel pageKey="pharmacy" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title', { defaultValue: 'Pharmacy' })}</h1>
            <p className="section-subtitle mt-1">{t('subtitle', { defaultValue: 'Stock monitoring, dispensing, and procurement' })}</p>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton onClick={() => setHelpOpen(true)} />
            <Link to={`${base}/pharmacy/invoices/new`}>
              <button className="btn-primary"><Pill className="w-4 h-4 mr-1 inline" /> {t('newInvoice', { defaultValue: 'New Invoice' })}</button>
            </Link>
            <Link to={`${base}/pharmacy/po/new`}>
              <button className="btn-secondary text-sm"><ShoppingCart className="w-4 h-4 mr-1 inline" /> {t('createPO', { defaultValue: 'Create PO' })}</button>
            </Link>
          </div>
        </div>

        {/* KPI Cards — match actual backend summary fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('totalInvestment', { defaultValue: 'Total Investment' })} value={`৳${((summary.totalInvestment ?? 0) / 100).toLocaleString()}`} loading={loading} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('totalIncome', { defaultValue: 'Total Income' })} value={`৳${((summary.totalIncome ?? 0) / 100).toLocaleString()}`} loading={loading} icon={<Activity className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title={t('grossProfit', { defaultValue: 'Gross Profit' })} value={`৳${((summary.grossProfit ?? 0) / 100).toLocaleString()}`} loading={loading} icon={<TrendingDown className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title={t('lowStockAlerts', { defaultValue: 'Low Stock Alerts' })} value={lowStock.length} loading={loading} icon={<AlertTriangle className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: t('items', { defaultValue: 'Items' }), path: 'pharmacy/items', icon: <Pill className="w-5 h-5" />, color: 'bg-[var(--color-primary-light)] text-[var(--color-primary)]' },
            { label: t('stock', { defaultValue: 'Stock' }), path: 'pharmacy/stock', icon: <Package className="w-5 h-5" />, color: 'bg-emerald-50 text-emerald-600' },
            { label: t('invoices', { defaultValue: 'Invoices' }), path: 'pharmacy/invoices', icon: <FileText className="w-5 h-5" />, color: 'bg-blue-50 text-blue-600' },
            { label: t('purchaseOrders', { defaultValue: 'Purchase Orders' }), path: 'pharmacy/po', icon: <ShoppingCart className="w-5 h-5" />, color: 'bg-purple-50 text-purple-600' },
          ].map(q => (
            <Link key={q.path} to={`${base}/${q.path}`}>
              <div className="card p-4 flex flex-col items-center gap-2 hover:shadow-md transition-shadow cursor-pointer text-center">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${q.color}`}>{q.icon}</div>
                <span className="text-sm font-medium">{q.label}</span>
              </div>
            </Link>
          ))}
        </div>

        {/* Low Stock & Expiring panels */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Low Stock */}
          <div className="card">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-amber-500" />
                <h3 className="font-semibold">{t('lowStockAlerts', { defaultValue: 'Low Stock Alerts' })}</h3>
              </div>
              <Link to={`${base}/pharmacy/stock`} className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
                {t('viewAll', { ns: 'common', defaultValue: 'View All' })} <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr>
                  <th>{t('item', { defaultValue: 'Item' })}</th>
                  <th className="text-right">{t('stock', { defaultValue: 'Stock' })}</th>
                  <th className="text-right">{t('reorderLevel', { defaultValue: 'Reorder' })}</th>
                </tr></thead>
                <tbody>
                  {loading ? (
                    [...Array(4)].map((_, i) => <tr key={i}>{[...Array(3)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  ) : lowStock.length === 0 ? (
                    <tr><td colSpan={3} className="py-12 text-center text-[var(--color-text-muted)]">✓ {t('allStockHealthy', { defaultValue: 'All stock levels healthy' })}</td></tr>
                  ) : lowStock.map(s => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.name}</td>
                      <td className="text-right font-data"><span className="text-amber-600 font-semibold">{s.stock_qty}</span></td>
                      <td className="text-right font-data text-[var(--color-text-muted)]">{s.reorder_level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Expiring Soon */}
          <div className="card">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <h3 className="font-semibold">{t('expiringSoon', { defaultValue: 'Expiring Within 30 Days' })}</h3>
              </div>
              <Link to={`${base}/pharmacy/stock`} className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
                {t('viewAll', { ns: 'common', defaultValue: 'View All' })} <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr>
                  <th>{t('item', { defaultValue: 'Item' })}</th>
                  <th>{t('batch', { defaultValue: 'Batch' })}</th>
                  <th>{t('expiryDate', { defaultValue: 'Expiry' })}</th>
                  <th className="text-right">{t('qty', { defaultValue: 'Qty' })}</th>
                </tr></thead>
                <tbody>
                  {loading ? (
                    [...Array(4)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  ) : expiring.length === 0 ? (
                    <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">✓ {t('noExpiring', { defaultValue: 'No items expiring soon' })}</td></tr>
                  ) : expiring.map(s => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.item_name ?? '—'}</td>
                      <td className="text-[var(--color-text-secondary)] font-mono text-xs">{s.batch_no}</td>
                      <td className="text-[var(--color-text-secondary)] text-sm">{s.expiry_date ? new Date(s.expiry_date).toLocaleDateString() : '—'}</td>
                      <td className="text-right font-data"><span className="text-red-600 font-semibold">{s.available_qty}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

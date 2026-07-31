import { useState, useEffect, useCallback } from 'react';
import { Pill, BarChart3, Archive, AlertTriangle, Star } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

const TODAY = new Date().toISOString().split('T')[0];
const MONTH_AGO = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
const TABS = [
  { key: 'dispensing', label: 'Dispensing Summary', icon: BarChart3     },
  { key: 'stock',      label: 'Stock Value',         icon: Archive       },
  { key: 'expiry',     label: 'Expiry Alerts',       icon: AlertTriangle },
  { key: 'top',        label: 'Top Dispensed',       icon: Star          },
];

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(5)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function DispensingTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data: d } = await axios.get('/api/reports/pharmacy/dispensing-summary', { params: { startDate: start, endDate: end }, headers: authHeader() }); setData(d.data ?? []); }
    catch { setData([]); } finally { setLoading(false); }
  }, [start, end]);
  useEffect(() => { loadData(); }, [loadData]);
  const totalQty = data.reduce((s, r) => s + (r.total_quantity ?? 0), 0);
  const totalRev  = data.reduce((s, r) => s + (r.total_revenue ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 flex-wrap items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">Date Range:</span>
        <input className="input w-36" type="date" value={start} onChange={e => setStart(e.target.value)} />
        <span className="text-sm text-[var(--color-text-muted)]">to</span>
        <input className="input w-36" type="date" value={end} onChange={e => setEnd(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title="Total Items"    value={data.length}                                  loading={loading} icon={<Pill className="w-5 h-5" />}      iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title="Total Qty"      value={totalQty}                                     loading={loading} icon={<Archive className="w-5 h-5" />}    iconBg="bg-violet-50 text-violet-600" index={1} />
        <KPICard title="Total Revenue"  value={`৳${totalRev.toLocaleString()}`}              loading={loading} icon={<BarChart3 className="w-5 h-5" />}  iconBg="bg-emerald-50 text-emerald-600" index={2} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Medicine</th><th>Qty Dispensed</th><th>Prescriptions</th><th>Revenue (৳)</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<BarChart3 className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No dispensing data" description="No dispensing records for this period." /></td></tr>
            : data.map((r, i) => <tr key={i}><td className="font-medium">{r.medicine_name}</td><td className="font-data text-center">{r.total_quantity}</td><td className="font-data text-center">{r.prescription_count ?? '—'}</td><td className="font-data font-medium text-right">৳{(r.total_revenue ?? 0).toLocaleString()}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function StockValueTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data: d } = await axios.get('/api/reports/pharmacy/stock-value', { headers: authHeader() }); setData(d.data ?? []); }
    catch { setData([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadData(); }, [loadData]);
  const totalValue = data.reduce((s, r) => s + (r.stock_value ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KPICard title="Total Stock Value" value={`৳${totalValue.toLocaleString()}`} loading={loading} icon={<Archive className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={0} />
        <KPICard title="SKUs Tracked"      value={data.length}                        loading={loading} icon={<Pill className="w-5 h-5" />}    iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={1} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Medicine Category</th><th>SKUs</th><th>Total Qty</th><th>Stock Value (৳)</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<Archive className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No stock data" description="No inventory records found." /></td></tr>
            : data.map((r, i) => <tr key={i}><td className="font-medium">{r.category ?? 'General'}</td><td className="font-data text-center">{r.sku_count}</td><td className="font-data text-center">{r.total_quantity}</td><td className="font-data font-semibold text-right">৳{(r.stock_value ?? 0).toLocaleString()}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function ExpiryTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('90');
  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data: d } = await axios.get('/api/reports/pharmacy/expiry-alerts', { params: { days }, headers: authHeader() }); setData(d.data ?? []); }
    catch { setData([]); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { loadData(); }, [loadData]);
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">Expiring within:</span>
        <select className="input w-28" value={days} onChange={e => setDays(e.target.value)}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="180">180 days</option></select>
        {data.length > 0 && <span className="ml-auto text-sm font-semibold text-amber-600">{data.length} items at risk</span>}
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Medicine</th><th>Batch</th><th>Qty</th><th>Expiry Date</th><th>Days Left</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : data.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<AlertTriangle className="w-8 h-8 text-emerald-500" />} title="No expiry alerts" description={`No medicines expiring within ${days} days.`} /></td></tr>
            : data.map((r, i) => {
              const daysLeft = r.days_to_expiry ?? 0;
              const cls = daysLeft <= 30 ? 'text-red-600 font-semibold' : daysLeft <= 60 ? 'text-amber-600' : 'text-[var(--color-text-secondary)]';
              return <tr key={i}><td className="font-medium">{r.medicine_name}</td><td className="font-data text-sm">{r.batch_no ?? '—'}</td><td className="font-data text-center">{r.quantity}</td><td className="font-data text-sm">{r.expiry_date}</td><td className={`font-data font-semibold ${cls}`}>{daysLeft}d</td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TopDispensedTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const [limit, setLimit] = useState('10');
  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data: d } = await axios.get('/api/reports/pharmacy/top-dispensed', { params: { startDate: start, endDate: end, limit }, headers: authHeader() }); setData(d.data ?? []); }
    catch { setData([]); } finally { setLoading(false); }
  }, [start, end, limit]);
  useEffect(() => { loadData(); }, [loadData]);
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 flex-wrap items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">Date Range:</span>
        <input className="input w-36" type="date" value={start} onChange={e => setStart(e.target.value)} />
        <span className="text-sm text-[var(--color-text-muted)]">to</span>
        <input className="input w-36" type="date" value={end} onChange={e => setEnd(e.target.value)} />
        <div className="ml-auto flex items-center gap-2"><span className="text-sm text-[var(--color-text-secondary)]">Show top:</span><select className="input w-24" value={limit} onChange={e => setLimit(e.target.value)}><option value="5">5</option><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></div>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>#</th><th>Medicine</th><th>Qty Dispensed</th><th>Revenue (৳)</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<Star className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No data" description="No dispensing records for this period." /></td></tr>
            : data.map((r, i) => <tr key={i}><td className="font-data font-semibold text-[var(--color-primary)]">{i + 1}</td><td className="font-medium">{r.medicine_name}</td><td className="font-data text-center">{r.total_quantity}</td><td className="font-data font-medium text-right">৳{(r.total_revenue ?? 0).toLocaleString()}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

const TAB_MAP: Record<string, React.ComponentType> = {
  dispensing: DispensingTab, stock: StockValueTab, expiry: ExpiryTab, top: TopDispensedTab,
};

export default function ReportPharmacyPage({ role = 'hospital_admin' }: { role?: string }) {
  const [activeTab, setActiveTab] = useState('dispensing');
  const TabComponent = TAB_MAP[activeTab];
  const { t } = useTranslation(['pharmacy', 'common']);
  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20">
              <Pill className="w-5 h-5 text-white" />
            </div>
            <div><h1 className="page-title">Pharmacy Reports</h1><p className="section-subtitle">Dispensing summary, stock value, expiry alerts, and top medicines</p></div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => { const Icon = tab.icon; return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            ><Icon className="w-4 h-4" />{tab.label}</button>
          ); })}
        </div>
        <TabComponent />
      </div>
    </DashboardLayout>
  );
}

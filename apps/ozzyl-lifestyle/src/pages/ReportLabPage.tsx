import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, BarChart3, Clock, Star, TrendingUp } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

const TODAY = new Date().toISOString().split('T')[0];
const MONTH_AGO = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

const TABS = [
  { key: 'by-category', label: 'By Category',   icon: BarChart3  },
  { key: 'tat',         label: 'Turn-Around',    icon: Clock      },
  { key: 'top-tests',   label: 'Top Tests',      icon: Star       },
  { key: 'trend',       label: 'Trend',          icon: TrendingUp },
];

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(5)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function DateRangeBar({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div className="card p-3 flex gap-3 flex-wrap items-center">
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">Date Range:</span>
      <input className="input w-36" type="date" value={start} onChange={e => onStart(e.target.value)} />
      <span className="text-sm text-[var(--color-text-muted)]">to</span>
      <input className="input w-36" type="date" value={end} onChange={e => onEnd(e.target.value)} />
    </div>
  );
}

function ByCategoryTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data: d } = await axios.get('/api/reports/lab/by-category', { params: { startDate: start, endDate: end }, headers: authHeader() }); setData(d.data ?? []); }
    catch { setData([]); } finally { setLoading(false); }
  }, [start, end]);
  useEffect(() => { loadData(); }, [loadData]);
  const total = data.reduce((s, r) => s + (r.total_orders ?? 0), 0);
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title="Total Orders" value={total} loading={loading} icon={<BarChart3 className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title="Categories"   value={data.length} loading={loading} icon={<Star className="w-5 h-5" />} iconBg="bg-cyan-50 text-cyan-600" index={1} />
        <KPICard title="Period"       value={`${start} → ${end}`} loading={loading} icon={<Clock className="w-5 h-5" />} iconBg="bg-violet-50 text-violet-600" index={2} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Category</th><th>Total Orders</th><th>Completed</th><th>Pending</th><th>Completion %</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : data.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<BarChart3 className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No data" description="No lab orders for selected period." /></td></tr>
            : data.map((r, i) => {
              const pct = r.total_orders ? Math.round((r.completed_orders ?? 0) / r.total_orders * 100) : 0;
              return <tr key={i}><td className="font-medium">{r.category_name ?? 'Uncategorized'}</td><td className="font-data text-center">{r.total_orders}</td><td className="font-data text-center text-emerald-600">{r.completed_orders ?? 0}</td><td className="font-data text-center text-amber-600">{r.pending_orders ?? 0}</td><td><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--color-border-light)] rounded-full h-1.5"><div className="bg-[var(--color-primary)] h-1.5 rounded-full" style={{ width: `${pct}%` }} /></div><span className="font-data text-sm w-10">{pct}%</span></div></td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TATTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data: d } = await axios.get('/api/reports/lab/tat', { params: { startDate: start, endDate: end }, headers: authHeader() }); setData(d.data ?? []); }
    catch { setData([]); } finally { setLoading(false); }
  }, [start, end]);
  useEffect(() => { loadData(); }, [loadData]);
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Test Name</th><th>Orders</th><th>Avg TAT (hrs)</th><th>Min TAT</th><th>Max TAT</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : data.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<Clock className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No TAT data" description="No completed lab orders for this period." /></td></tr>
            : data.map((r, i) => <tr key={i}><td className="font-medium">{r.test_name}</td><td className="font-data text-center">{r.order_count}</td><td className="font-data text-center font-semibold">{r.avg_tat_hours?.toFixed(1) ?? '—'}</td><td className="font-data text-center text-emerald-600">{r.min_tat_hours?.toFixed(1) ?? '—'}</td><td className="font-data text-center text-red-500">{r.max_tat_hours?.toFixed(1) ?? '—'}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TopTestsTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const [limit, setLimit] = useState('10');
  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data: d } = await axios.get('/api/reports/lab/top-tests', { params: { startDate: start, endDate: end, limit }, headers: authHeader() }); setData(d.data ?? []); }
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
        <thead><tr><th>#</th><th>Test Name</th><th>Total Orders</th><th>Revenue (৳)</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<Star className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No data" description="No orders in selected period." /></td></tr>
            : data.map((r, i) => <tr key={i}><td className="font-data font-semibold text-[var(--color-primary)]">{i + 1}</td><td className="font-medium">{r.test_name}</td><td className="font-data text-center">{r.total_orders}</td><td className="font-data font-medium text-right">৳{(r.total_revenue ?? 0).toLocaleString()}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TrendTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('30');
  const loadData = useCallback(async () => {
    setLoading(true);
    try { const { data: d } = await axios.get('/api/reports/lab/trend', { params: { days }, headers: authHeader() }); setData(d.data ?? []); }
    catch { setData([]); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { loadData(); }, [loadData]);
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">Last</span>
        <select className="input w-24" value={days} onChange={e => setDays(e.target.value)}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Date</th><th>Total Orders</th><th>Completed</th><th>Pending</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<TrendingUp className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No trend data" description="No lab data for the selected period." /></td></tr>
            : data.map((r, i) => <tr key={i}><td className="font-data">{r.order_date}</td><td className="font-data text-center">{r.total_orders}</td><td className="font-data text-center text-emerald-600">{r.completed_orders ?? 0}</td><td className="font-data text-center text-amber-600">{r.pending_orders ?? 0}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

const TAB_MAP: Record<string, React.ComponentType> = {
  'by-category': ByCategoryTab, tat: TATTab, 'top-tests': TopTestsTab, trend: TrendTab,
};

export default function ReportLabPage({ role = 'hospital_admin' }: { role?: string }) {
  const [activeTab, setActiveTab] = useState('by-category');
  const TabComponent = TAB_MAP[activeTab];
  const { t } = useTranslation(['laboratory', 'common']);
  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <FlaskConical className="w-5 h-5 text-white" />
            </div>
            <div><h1 className="page-title">Lab Reports</h1><p className="section-subtitle">Analysis by category, TAT, top tests, and trends</p></div>
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

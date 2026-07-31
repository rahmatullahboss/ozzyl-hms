import { useState } from 'react';
import { FlaskConical, BarChart3, Clock, Star, TrendingUp, DollarSign, UserRound } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6, formatToTodayGMT6 } from '../lib/date-utils';

const TODAY = getTodayGMT6();
const MONTH_AGO = formatToTodayGMT6(new Date(Date.now() - 30 * 86400000));

const TABS = [
  { key: 'by-category', label: 'By Category',   icon: BarChart3  },
  { key: 'tat',         label: 'Turn-Around',    icon: Clock      },
  { key: 'top-tests',   label: 'Top Tests',      icon: Star       },
  { key: 'trend',       label: 'Trend',          icon: TrendingUp },
  { key: 'profitability', label: 'Profitability', icon: DollarSign },
  { key: 'doctor-summary', label: 'Doctor Wise', icon: UserRound },
];

function money(value: number | undefined | null) {
  return `৳${Math.round(value ?? 0).toLocaleString()}`;
}

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
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.labByCategory({ startDate: start, endDate: end }),
    `/api/reports/lab/by-category?startDate=${start}&endDate=${end}`
  );
  const data = resData?.data ?? (resData as any)?.categories ?? [];
  const total = data.reduce((s: number, r: any) => s + (r.total_orders ?? 0), 0);
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title="Total Orders" value={total} loading={loading} icon={<BarChart3 className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title="Categories"   value={data.length} loading={loading} icon={<Star className="w-5 h-5" />} iconBg="bg-cyan-50 text-cyan-600" index={1} />
        <KPICard title="Period"       value={`${start} → ${end}`} loading={loading} icon={<Clock className="w-5 h-5" />} iconBg="bg-violet-50 text-violet-600" index={2} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Category</th><th>Total Orders</th><th>Completed</th><th>Pending</th><th>Revenue</th><th>Completion %</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={6} />
            : data.length === 0 ? <tr><td colSpan={6}><EmptyState icon={<BarChart3 className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No data" description="No lab orders for selected period." /></td></tr>
            : data.map((r: any, i: number) => {
              const pct = r.total_orders ? Math.round((r.completed_orders ?? 0) / r.total_orders * 100) : 0;
              return <tr key={i}><td className="font-medium">{r.category_name ?? r.category ?? 'Uncategorized'}</td><td className="font-data text-center">{r.total_orders ?? r.testCount ?? 0}</td><td className="font-data text-center text-emerald-600">{r.completed_orders ?? r.completed ?? 0}</td><td className="font-data text-center text-amber-600">{r.pending_orders ?? r.pending ?? 0}</td><td className="font-data text-right">{money(r.total_revenue ?? r.revenue)}</td><td><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--color-border-light)] rounded-full h-1.5"><div className="bg-[var(--color-primary)] h-1.5 rounded-full" style={{ width: `${pct}%` }} /></div><span className="font-data text-sm w-10">{pct}%</span></div></td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TATTab() {
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.labTat({ startDate: start, endDate: end }),
    `/api/reports/lab/tat?startDate=${start}&endDate=${end}`
  );
  const data = resData?.data ?? (resData as any)?.tests ?? [];
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Test Name</th><th>Orders</th><th>Avg TAT (hrs)</th><th>Min TAT</th><th>Max TAT</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : data.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<Clock className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No TAT data" description="No completed lab orders for this period." /></td></tr>
            : data.map((r: any, i: number) => <tr key={i}><td className="font-medium">{r.test_name ?? r.testName}</td><td className="font-data text-center">{r.order_count ?? r.testCount ?? 0}</td><td className="font-data text-center font-semibold">{(r.avg_tat_hours ?? r.avgHours)?.toFixed(1) ?? '—'}</td><td className="font-data text-center text-emerald-600">{r.min_tat_hours?.toFixed(1) ?? '—'}</td><td className="font-data text-center text-red-500">{r.max_tat_hours?.toFixed(1) ?? '—'}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TopTestsTab() {
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const [limit, setLimit] = useState('10');

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.labTopTests({ startDate: start, endDate: end, limit }),
    `/api/reports/lab/top-tests?startDate=${start}&endDate=${end}&limit=${limit}`
  );
  const data = resData?.data ?? (resData as any)?.tests ?? [];
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
            : data.map((r: any, i: number) => <tr key={i}><td className="font-data font-semibold text-[var(--color-primary)]">{i + 1}</td><td className="font-medium">{r.test_name ?? r.testName}</td><td className="font-data text-center">{r.total_orders ?? r.orderCount ?? 0}</td><td className="font-data font-medium text-right">{money(r.total_revenue ?? r.revenue)}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TrendTab() {
  const [days, setDays] = useState('30');

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.labTrend(days),
    `/api/reports/lab/trend?days=${days}`
  );
  const data = resData?.data ?? (resData as any)?.trend ?? [];
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
            : data.map((r: any, i: number) => <tr key={i}><td className="font-data">{r.order_date ?? r.date}</td><td className="font-data text-center">{r.total_orders ?? r.total ?? 0}</td><td className="font-data text-center text-emerald-600">{r.completed_orders ?? r.completed ?? 0}</td><td className="font-data text-center text-amber-600">{r.pending_orders ?? r.pending ?? 0}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function ProfitabilityTab() {
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[]; totals?: any }>(
    queryKeys.reports.labProfitability({ startDate: start, endDate: end }),
    `/api/reports/lab/profitability?startDate=${start}&endDate=${end}`
  );
  const data = resData?.data ?? [];
  const totals = resData?.totals ?? data.reduce((acc: any, r: any) => {
    acc.revenue += r.revenue ?? 0;
    acc.consumableCost += r.consumableCost ?? 0;
    acc.doctorCommission += r.doctorCommission ?? 0;
    acc.grossProfit += r.grossProfit ?? 0;
    return acc;
  }, { revenue: 0, consumableCost: 0, doctorCommission: 0, grossProfit: 0 });

  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Lab Revenue" value={money(totals.revenue)} loading={loading} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" />
        <KPICard title="Consumable Cost" value={money(totals.consumableCost)} loading={loading} icon={<FlaskConical className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" />
        <KPICard title="Doctor Commission" value={money(totals.doctorCommission)} loading={loading} icon={<UserRound className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600" />
        <KPICard title="Gross Profit" value={money(totals.grossProfit)} loading={loading} icon={<TrendingUp className="w-5 h-5" />} iconBg="bg-cyan-50 text-cyan-600" />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Test</th><th>Category</th><th className="text-center">Qty</th><th className="text-right">Revenue</th><th className="text-right">Consumables</th><th className="text-right">Doctor Commission</th><th className="text-right">Gross Profit</th><th className="text-right">Margin</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={8} />
            : data.length === 0 ? <tr><td colSpan={8}><EmptyState icon={<DollarSign className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No profitability data" description="Complete lab results after mapping consumables to see profit." /></td></tr>
            : data.map((r: any) => <tr key={r.labTestId ?? r.lab_test_id}><td className="font-medium">{r.testName ?? r.test_name}</td><td>{r.category ?? 'Uncategorized'}</td><td className="font-data text-center">{r.totalTests ?? r.total_tests ?? 0}</td><td className="font-data text-right">{money(r.revenue)}</td><td className="font-data text-right text-amber-600">{money(r.consumableCost ?? r.consumable_cost)}</td><td className="font-data text-right text-blue-600">{money(r.doctorCommission ?? r.doctor_commission)}</td><td className="font-data text-right font-semibold">{money(r.grossProfit ?? r.gross_profit)}</td><td className="font-data text-right">{r.marginPercent ?? r.margin_percent ?? 0}%</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function DoctorSummaryTab() {
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.labDoctorSummary({ startDate: start, endDate: end }),
    `/api/reports/lab/doctor-summary?startDate=${start}&endDate=${end}`
  );
  const data = resData?.data ?? [];
  const totalCommission = data.reduce((s: number, r: any) => s + (r.testCommission ?? 0), 0);
  const totalProfit = data.reduce((s: number, r: any) => s + (r.grossProfit ?? 0), 0);

  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title="Active Doctors" value={data.length} loading={loading} icon={<UserRound className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600" />
        <KPICard title="Test Commission" value={money(totalCommission)} loading={loading} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" />
        <KPICard title="Lab Gross Profit" value={money(totalProfit)} loading={loading} icon={<TrendingUp className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Doctor</th><th>Visits</th><th>Tests</th><th className="text-right">Consultation Fees</th><th className="text-right">Lab Revenue</th><th className="text-right">Consumables</th><th className="text-right">Test Commission</th><th className="text-right">Lab Profit</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={8} />
            : data.length === 0 ? <tr><td colSpan={8}><EmptyState icon={<UserRound className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No doctor finance data" description="Link lab orders to visits and configure doctor rules to see this report." /></td></tr>
            : data.map((r: any) => <tr key={r.doctorId ?? r.doctor_id}><td><div className="font-medium">{r.doctorName ?? r.doctor_name}</div><div className="text-xs text-[var(--color-text-muted)]">{r.specialty ?? 'General'}</div></td><td className="font-data text-center">{r.visitCount ?? r.visit_count ?? 0}</td><td className="font-data text-center">{r.labTestCount ?? r.lab_test_count ?? 0}</td><td className="font-data text-right">{money(r.consultationFeeRevenue ?? r.consultation_fee_revenue)}</td><td className="font-data text-right">{money(r.labRevenue ?? r.lab_revenue)}</td><td className="font-data text-right text-amber-600">{money(r.consumableCost ?? r.consumable_cost)}</td><td className="font-data text-right text-blue-600">{money(r.testCommission ?? r.test_commission)}</td><td className="font-data text-right font-semibold">{money(r.grossProfit ?? r.gross_profit)}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

const TAB_MAP: Record<string, React.ComponentType> = {
  'by-category': ByCategoryTab,
  tat: TATTab,
  'top-tests': TopTestsTab,
  trend: TrendTab,
  profitability: ProfitabilityTab,
  'doctor-summary': DoctorSummaryTab,
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
            <div><h1 className="page-title">Lab Reports</h1><p className="section-subtitle">Operational volume, doctor-wise revenue, reagent cost, commissions, and profit</p></div>
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

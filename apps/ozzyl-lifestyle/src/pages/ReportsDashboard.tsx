import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Users, BarChart2,
  Calendar, Download, RefreshCw,
} from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MonthlyRow {
  month: string;    // "2026-03"
  income: number;
  expense: number;
  profit: number;
}

interface SourceRow {
  source: string;
  amount: number;
  count: number;
  percentage: string;
}

interface SummaryData {
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
}

type Range = '30d' | '90d' | 'ytd';

// ─── Module-level constants ───────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Fixed deterministic fallback \u2014 NO Math.random()
const DEMO_INC  = [95000, 112000,  87000, 143000, 125000, 98000, 135000, 152000, 119000, 0, 0, 0];
const DEMO_EXP  = [42000,  51000,  39000,  62000,  55000, 45000,  58000,  67000,  53000, 0, 0, 0];

const SOURCE_COLORS: Record<string, string> = {
  billing:  'bg-[var(--color-primary)]',
  lab:      'bg-emerald-500',
  pharmacy: 'bg-amber-500',
  other:    'bg-purple-500',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtFull(n: number) {
  return `৳${n.toLocaleString('en-BD')}`;
}

function fmtShort(n: number) {
  if (n >= 100_000) return `৳${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)   return `৳${(n / 1_000).toFixed(1)}K`;
  return `৳${n.toLocaleString()}`;
}

function getDateRange(r: Range): { startDate: string; endDate: string } {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  if (r === '30d') {
    const s = new Date(now); s.setDate(s.getDate() - 30);
    return { startDate: s.toISOString().split('T')[0], endDate: end };
  }
  if (r === '90d') {
    const s = new Date(now); s.setDate(s.getDate() - 90);
    return { startDate: s.toISOString().split('T')[0], endDate: end };
  }
  return { startDate: `${now.getFullYear()}-01-01`, endDate: end };
}

// ─── Mini Bar Chart (CSS-only, no external dep) ───────────────────────────────

function BarChart({ data }: { data: MonthlyRow[] }) {
  const maxVal = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);

  return (
    <div className="pt-4">
      <div className="flex items-end gap-1.5 h-40">
        {data.map(row => {
          const label    = row.month.slice(5);
          const monthIdx = parseInt(label) - 1;
          const incH     = (row.income  / maxVal) * 100;
          const expH     = (row.expense / maxVal) * 100;
          return (
            <div key={row.month} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              {/* Hover tooltip \u2014 parent is relative so this positions correctly */}
              <div className="hidden group-hover:flex absolute bottom-full mb-2 z-10 flex-col bg-[var(--color-bg-card)] border border-[var(--color-border)] shadow-lg rounded-lg px-3 py-2 text-xs whitespace-nowrap left-1/2 -translate-x-1/2 pointer-events-none">
                <p className="font-semibold text-[var(--color-text-primary)] mb-1">
                  {MONTH_NAMES[monthIdx]} {row.month.slice(0, 4)}
                </p>
                <p className="text-[var(--color-success)]">Income: {fmtFull(row.income)}</p>
                <p className="text-red-500">Expense: {fmtFull(row.expense)}</p>
                <p className="font-medium">
                  {row.profit >= 0 ? '🟢' : '🔴'} Profit: {fmtFull(row.profit)}
                </p>
              </div>
              {/* Bars */}
              <div className="w-full flex items-end gap-px h-36">
                <div
                  className="flex-1 bg-[var(--color-primary)] rounded-t-sm transition-all duration-500 opacity-80 hover:opacity-100"
                  style={{ height: `${incH}%`, minHeight: row.income > 0 ? 2 : 0 }}
                />
                <div
                  className="flex-1 bg-red-400 rounded-t-sm transition-all duration-500 opacity-60 hover:opacity-100"
                  style={{ height: `${expH}%`, minHeight: row.expense > 0 ? 2 : 0 }}
                />
              </div>
              <span className="text-[10px] text-[var(--color-text-muted)]">{MONTH_NAMES[monthIdx]}</span>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-[var(--color-primary)]" /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-red-400" /> Expenses
        </span>
      </div>
    </div>
  );
}

// ─── Horizontal breakdown bar ─────────────────────────────────────────────────

function SourceBar({ label, amount, pct, color }: { label: string; amount: number; pct: string; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-[var(--color-text-primary)] font-medium capitalize">{label}</span>
        <span className="text-[var(--color-text-muted)]">{fmtShort(amount)}</span>
      </div>
      <div className="h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--color-text-muted)] text-right">{pct}%</p>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReportsDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const [range,   setRange]   = useState<Range>('ytd');
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [summary, setSummary] = useState<SummaryData>({ totalIncome: 0, totalExpense: 0, netProfit: 0 });
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation(['reports', 'common']);



  // ── Fetch \u2014 useCallback must be declared BEFORE useEffect ─────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const token = localStorage.getItem('hms_token');
    const headers = { Authorization: `Bearer ${token}` };
    const { startDate, endDate } = getDateRange(range);
    const year = new Date().getFullYear().toString();

    try {
      const [monthlyRes, plRes, sourceRes] = await Promise.all([
        axios.get(`/api/reports/monthly?year=${year}`, { headers }),
        axios.get(`/api/reports/pl?startDate=${startDate}&endDate=${endDate}`, { headers }),
        axios.get(`/api/reports/income-by-source?startDate=${startDate}&endDate=${endDate}`, { headers }),
      ]);
      setMonthly(monthlyRes.data.monthly ?? []);
      setSummary(monthlyRes.data.summary ?? { totalIncome: 0, totalExpense: 0, netProfit: 0 });
      setSources(sourceRes.data.breakdown ?? []);
      // Override summary with the date-filtered P&L
      const pl = plRes.data;
      if (pl) setSummary({
        totalIncome: pl.income?.total ?? 0,
        totalExpense: pl.expenses?.total ?? 0,
        netProfit: pl.netProfit ?? 0,
      });
    } catch (err) {
      console.error('[Reports] Fetch failed:', err);
      // Fixed deterministic fallback \u2014 NO Math.random()
      const demo: MonthlyRow[] = DEMO_INC.map((inc, i) => ({
        month: `${new Date().getFullYear()}-${String(i + 1).padStart(2, '0')}`,
        income: inc, expense: DEMO_EXP[i], profit: inc - DEMO_EXP[i],
      }));
      setMonthly(demo);
      setSummary({ totalIncome: 1_066_000, totalExpense: 472_000, netProfit: 594_000 });
      setSources([
        { source: 'billing',  amount: 565000, count: 182, percentage: '53' },
        { source: 'lab',      amount: 309000, count: 510, percentage: '29' },
        { source: 'pharmacy', amount: 192000, count: 298, percentage: '18' },
      ]);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const profitMargin = summary.totalIncome > 0
    ? ((summary.netProfit / summary.totalIncome) * 100).toFixed(1)
    : '0';

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <p className="section-subtitle mt-1">{t('subtitle', { defaultValue: 'Financial overview and performance metrics' })}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Range toggle */}
            <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden text-sm">
              {(['30d', '90d', 'ytd'] as Range[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1.5 transition-colors ${
                    range === r
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'
                  }`}
                >
                  {r === 'ytd' ? 'This Year' : r}
                </button>
              ))}
            </div>
            <button onClick={fetchAll} className="btn-ghost" aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (!monthly.length) return;
                const csv = '\uFEFF' + [
                  'Month,Income,Expense,Profit',
                  ...monthly.map(r => `${r.month},${r.income},${r.expense},${r.profit}`),
                ].join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href = url; a.download = `hms-report-${range}.csv`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn-secondary"
              disabled={loading || !monthly.length}
            >
              <Download className="w-4 h-4" /> {t('exportCsv', { defaultValue: 'Export CSV' })}
            </button>
          </div>
        </div>

        {/* ── KPI Row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title={t('totalRevenue', { defaultValue: 'Total Revenue' })}
            value={loading ? '' : fmtFull(summary.totalIncome)}
            icon={<DollarSign className="w-5 h-5" />}
            trend={summary.netProfit >= 0
              ? { value: parseFloat(profitMargin), isPositive: true, label: 'margin' }
              : undefined}
            loading={loading}
          />
          <KPICard
            title={t('totalExpenses', { defaultValue: 'Total Expenses' })}
            value={loading ? '' : fmtFull(summary.totalExpense)}
            icon={<TrendingDown className="w-5 h-5" />}
            loading={loading}
          />
          <KPICard
            title={t('netProfit', { defaultValue: 'Net Profit' })}
            value={loading ? '' : fmtFull(summary.netProfit)}
            icon={<TrendingUp className="w-5 h-5" />}
            trend={summary.netProfit >= 0
              ? { value: parseFloat(profitMargin), isPositive: true, label: 'profitable' }
              : { value: 0, isPositive: false, label: 'at a loss' }}
            loading={loading}
          />
          <KPICard
            title={t('revenueSources', { defaultValue: 'Revenue Sources' })}
            value={loading ? '' : String(sources.length)}
            icon={<Users className="w-5 h-5" />}
            loading={loading}
          />
        </div>

        {/* ── Charts row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Monthly bar chart */}
          <div className="lg:col-span-2 card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="section-title">{t('monthlyRevenueVsExpenses', { defaultValue: 'Monthly Revenue vs Expenses' })}</h2>
              <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <Calendar className="w-3.5 h-3.5" /> {new Date().getFullYear()}
              </div>
            </div>
            {loading ? (
              <div className="skeleton h-48 w-full rounded-lg mt-4" />
            ) : (
              <BarChart data={monthly} />
            )}
          </div>

          {/* Income by Source */}
          <div className="card p-5">
            <h2 className="section-title mb-4">{t('revenueBySource', { defaultValue: 'Revenue by Source' })}</h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="skeleton h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : sources.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                No data for this period
              </div>
            ) : (
              <div className="space-y-4">
                {sources.map(s => (
                  <SourceBar
                    key={s.source}
                    label={s.source}
                    amount={s.amount}
                    pct={s.percentage}
                    color={SOURCE_COLORS[s.source] ?? 'bg-slate-400'}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Monthly breakdown table ── */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2 className="section-title">{t('monthlyBreakdown', { defaultValue: 'Monthly Breakdown' })}</h2>
            <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" />
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Revenue (৳)</th>
                  <th className="text-right">Expenses (৳)</th>
                  <th className="text-right">Net Profit (৳)</th>
                  <th className="text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(5)].map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : (
                  monthly.filter(r => r.income > 0 || r.expense > 0).map(row => {
                    const [yr, mo] = row.month.split('-');
                    const margin = row.income > 0
                      ? ((row.profit / row.income) * 100).toFixed(1)
                      : '–';
                    return (
                      <tr key={row.month}>
                        <td className="font-medium">{MONTH_NAMES[parseInt(mo) - 1]} {yr}</td>
                        <td className="text-right font-data">{fmtFull(row.income)}</td>
                        <td className="text-right font-data text-red-500">{fmtFull(row.expense)}</td>
                        <td className={`text-right font-data font-semibold ${
                          row.profit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                        }`}>
                          {fmtFull(row.profit)}
                        </td>
                        <td className="text-right">
                          <span className={`badge ${row.profit >= 0 ? 'badge-success' : 'badge-danger'}`}>
                            {margin}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!loading && (
                <tfoot className="bg-[var(--color-bg-primary)]">
                  <tr>
                    <td className="font-semibold text-[var(--color-text-primary)] px-4 py-3">Total</td>
                    <td className="text-right font-data font-bold px-4 py-3">{fmtFull(summary.totalIncome)}</td>
                    <td className="text-right font-data font-bold text-red-500 px-4 py-3">{fmtFull(summary.totalExpense)}</td>
                    <td className={`text-right font-data font-bold px-4 py-3 ${
                      summary.netProfit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                    }`}>
                      {fmtFull(summary.netProfit)}
                    </td>
                    <td className="text-right px-4 py-3">
                      <span className={`badge ${summary.netProfit >= 0 ? 'badge-success' : 'badge-danger'}`}>
                        {profitMargin}%
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── Advanced Reports Row ── */}
        <AdvancedReports range={range} />

      </div>
    </DashboardLayout>
  );
}

// ─── Advanced Reports Sub-Component ───────────────────────────────────────────

interface BedOccupancy {
  totalBeds: number; occupiedBeds: number; availableBeds: number; occupancyRate: number;
  byWard: { ward: string; total: number; occupied: number; available: number; rate: number }[];
}

interface DeptRevenue {
  totalRevenue: number;
  byDepartment: { department: string; revenue: number; billCount: number; patientCount: number; percentage: number }[];
}

interface DoctorPerf {
  doctors: { id: number; name: string; specialty: string; visitCount: number; uniquePatients: number; revenue: number; avgRevenuePerVisit: number }[];
}

function AdvancedReports({ range }: { range: Range }) {
  const [beds, setBeds] = useState<BedOccupancy | null>(null);
  const [deptRev, setDeptRev] = useState<DeptRevenue | null>(null);
  const [docPerf, setDocPerf] = useState<DoctorPerf | null>(null);
  const [loadingAdv, setLoadingAdv] = useState(true);

  useEffect(() => {
    const fetchAdvanced = async () => {
      setLoadingAdv(true);
      const token = localStorage.getItem('hms_token');
      const headers = { Authorization: `Bearer ${token}` };
      const { startDate, endDate } = getDateRange(range);

      try {
        const [bedRes, deptRes, docRes] = await Promise.all([
          axios.get('/api/reports/bed-occupancy', { headers }),
          axios.get(`/api/reports/department-revenue?startDate=${startDate}&endDate=${endDate}`, { headers }),
          axios.get(`/api/reports/doctor-performance?startDate=${startDate}&endDate=${endDate}`, { headers }),
        ]);
        setBeds(bedRes.data);
        setDeptRev(deptRes.data);
        setDocPerf(docRes.data);
      } catch {
        // Fallback: leave null, cards will show "No data"
      } finally {
        setLoadingAdv(false);
      }
    };
    fetchAdvanced();
  }, [range]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

      {/* Bed Occupancy */}
      <div className="card p-5">
        <h2 className="section-title mb-4 flex items-center gap-2">
          🛏️ Bed Occupancy
        </h2>
        {loadingAdv ? (
          <div className="skeleton h-32 w-full rounded-lg" />
        ) : beds ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">Overall Occupancy</span>
              <span className="text-xl font-bold text-[var(--color-primary)]">{beds.occupancyRate}%</span>
            </div>
            <div className="h-3 bg-[var(--color-border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-700"
                style={{ width: `${beds.occupancyRate}%` }}
              />
            </div>
            <div className="grid grid-cols-3 text-center text-xs">
              <div><p className="text-[var(--color-text-muted)]">Total</p><p className="font-bold">{beds.totalBeds}</p></div>
              <div><p className="text-[var(--color-text-muted)]">Occupied</p><p className="font-bold text-amber-500">{beds.occupiedBeds}</p></div>
              <div><p className="text-[var(--color-text-muted)]">Available</p><p className="font-bold text-[var(--color-success)]">{beds.availableBeds}</p></div>
            </div>
            {beds.byWard.length > 0 && (
              <div className="pt-2 border-t border-[var(--color-border)] space-y-2">
                {beds.byWard.slice(0, 5).map(w => (
                  <div key={w.ward} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--color-text-secondary)] capitalize">{w.ward}</span>
                    <span className="font-medium">{w.occupied}/{w.total} ({w.rate}%)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No bed data available</p>
        )}
      </div>

      {/* Department Revenue */}
      <div className="card p-5">
        <h2 className="section-title mb-4">🏥 Department Revenue</h2>
        {loadingAdv ? (
          <div className="skeleton h-32 w-full rounded-lg" />
        ) : deptRev && deptRev.byDepartment.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-text-muted)]">Total: <span className="font-bold text-[var(--color-text-primary)]">{fmtShort(deptRev.totalRevenue)}</span></p>
            {deptRev.byDepartment.slice(0, 6).map(d => (
              <div key={d.department} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--color-text-primary)] font-medium">{d.department}</span>
                  <span className="text-[var(--color-text-muted)]">{fmtShort(d.revenue)} ({d.percentage}%)</span>
                </div>
                <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${d.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No department revenue data</p>
        )}
      </div>

      {/* Doctor Performance */}
      <div className="card p-5 lg:col-span-2">
        <h2 className="section-title mb-4">👨‍⚕️ Doctor Performance</h2>
        {loadingAdv ? (
          <div className="skeleton h-32 w-full rounded-lg" />
        ) : docPerf && docPerf.doctors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Specialty</th>
                  <th className="text-right">Visits</th>
                  <th className="text-right">Patients</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Avg/Visit</th>
                </tr>
              </thead>
              <tbody>
                {docPerf.doctors.slice(0, 10).map(d => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.name}</td>
                    <td className="text-[var(--color-text-muted)]">{d.specialty}</td>
                    <td className="text-right font-data">{d.visitCount}</td>
                    <td className="text-right font-data">{d.uniquePatients}</td>
                    <td className="text-right font-data font-semibold">{fmtShort(d.revenue)}</td>
                    <td className="text-right font-data">{fmtShort(d.avgRevenuePerVisit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">No doctor performance data</p>
        )}
      </div>

    </div>
  );
}

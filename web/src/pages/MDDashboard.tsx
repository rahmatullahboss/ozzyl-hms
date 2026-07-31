import { AlertTriangle, DollarSign, RefreshCw, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  BarChart3,
  BookOpen,
  Briefcase,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Package,
  Printer,
  Stethoscope,
  Wallet,
  XCircle,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import KpiBreakdownDrawer, { type KpiBreakdownData } from '../components/dashboard/KpiBreakdownDrawer';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { useAuth } from '../hooks/useAuth';
import { formatCurrency } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import ExecutiveControlKpis from '../components/dashboard/ExecutiveControlKpis';
import ExecutiveDuePanel from '../components/dashboard/ExecutiveDuePanel';
import IPDBillingOverview from '../components/dashboard/IPDBillingOverview';
import type { DashboardPeriod } from '../components/dashboard/dashboardPeriod';
import ExecutiveDashboardRangeFilter, { resolveExecutiveDashboardFilters } from '../components/dashboard/ExecutiveDashboardRangeFilter';
import PendingRequestsSection from '../components/dashboard/PendingRequestsSection';
import { executiveAnalyticsQuery } from '../hooks/useExecutiveDashboardAnalytics';
import type { ExecutiveDashboardFilters } from '../types/executiveDashboard';

/* ── Types ────────────────────────────────────────────────────────── */

interface DailyData {
  date: string;
  total: number;
  bySource?:   { source?: string;   total: number }[];
  byCategory?: { category?: string; total: number }[];
}

/** Unified breakdown row used in either income or expense list. */
type BreakdownRow = { source?: string; category?: string; total: number };

interface MonthlyData {
  month:     string;
  income:    number;
  expenses:  number;
  profit:    number;
  margin:    string;
}

interface Staff {
  id:         number;
  name:       string;
  position:   string;
  salary:     number;
  status:     string;
  department?: string;
}

interface StaffResponse { staff?: Staff[] }

/* Shape of GET /api/dashboard/stats (subset consumed by the MD dashboard). */
interface DashboardStats {
  stats: {
    totalPatients: number;
    todayPatients: number;
    staffCount: number;
    lowStockItems: number;
    thisMonthRevenue: number;
    lastMonthRevenue: number;
    thisWeekRevenue: number;
    lastWeekRevenue: number;
    weekOverWeekChange: number;
    activeDoctorsToday?: number;
    pendingTests?: number;
    completedTests?: number;
  };
  todaySummary: {
    newPatients: number;
    totalAppointments: number;
    completedConsultations: number;
    pendingTests?: number;
    completedTests?: number;
    pharmacySales: number;
    pharmacySalesCount: number;
    totalCollection?: number;
    totalDue?: number;
    totalDiscount?: number;
    admittedPatients: number;
    dischargedPatients: number;
  };
  patientSummary: {
    newPatients: number;
    returningPatients: number;
    opdPatients: number;
    ipdPatients: number;
    emergencyPatients: number;
  };
  financialSummary: {
    dailyIncome: number;
    weeklyIncome: number;
    monthlyIncome: number;
    dueCollection: number;
    cashierCollection?: { cashierName: string; amount: number }[];
  };
  labSummary?: {
    dailyIncome: number;
    pendingTests: number;
    completedTests: number;
  };
  pharmacySummary?: {
    todaySales: number;
    todaySalesCount: number;
    lowStockItems: number;
  };
  bedSummary: {
    total: number;
    available: number;
    occupied: number;
    cleaning: number;
    maintenance: number;
    reserved: number;
    occupancyPercentage: number;
  };
  revenueData: { day: string; revenue: number }[];
  departmentRevenue?: { name: string; value: number }[];
  finance: {
    todayCollection: number;
    pendingHandoverAmount: number;
    pendingHandoverCount: number;
    patientDue: number;
    patientAdvance: number;
    todayExpense: number;
    pendingPostingEvents?: number;
  };
}

interface SecurityAlertsSummary {
  canceledBills: unknown[];
  highDiscountBills: unknown[];
  handoverDiscrepancies: unknown[];
  billEdits: unknown[];
  lowStockItems: unknown[];
  summary: {
    canceledCount: number;
    highDiscountCount: number;
    discrepancyCount: number;
    billEditCount: number;
    lowStockCount: number;
  };
}

/* ── Constants ────────────────────────────────────────────────────── */

const EMPTY_DAILY:  DailyData  = { date: '', total: 0 };
const EMPTY_MONTHLY: MonthlyData = { month: '', income: 0, expenses: 0, profit: 0, margin: '0' };
const EMPTY_STATS: DashboardStats = {
  stats: { totalPatients: 0, todayPatients: 0, staffCount: 0, lowStockItems: 0,
           thisMonthRevenue: 0, lastMonthRevenue: 0, thisWeekRevenue: 0,
           lastWeekRevenue: 0, weekOverWeekChange: 0 },
  todaySummary: { newPatients: 0, totalAppointments: 0, completedConsultations: 0,
                  pharmacySales: 0, pharmacySalesCount: 0, admittedPatients: 0, dischargedPatients: 0 },
  patientSummary: { newPatients: 0, returningPatients: 0, opdPatients: 0,
                    ipdPatients: 0, emergencyPatients: 0 },
  financialSummary: { dailyIncome: 0, weeklyIncome: 0, monthlyIncome: 0, dueCollection: 0 },
  bedSummary: { total: 0, available: 0, occupied: 0, cleaning: 0,
                maintenance: 0, reserved: 0, occupancyPercentage: 0 },
  revenueData: [],
  finance: { todayCollection: 0, pendingHandoverAmount: 0, pendingHandoverCount: 0,
            patientDue: 0, patientAdvance: 0, todayExpense: 0 },
};
const EMPTY_ALERTS: SecurityAlertsSummary = {
  canceledBills: [], highDiscountBills: [], handoverDiscrepancies: [],
  billEdits: [], lowStockItems: [],
  summary: { canceledCount: 0, highDiscountCount: 0, discrepancyCount: 0,
             billEditCount: 0, lowStockCount: 0 },
};

const STAFF_VISIBLE = 5;

const fmtBDT = (n: number) => formatCurrency(n, { fractionDigits: 0 });

/* Range type lives in MDDashboard.helpers — re-exported here so callers
 *  can import the full dashboard API from one place. */
export { dateParamFor, pendingRequestWindowFor, aggregateStaffByDepartment, computeTodayProfit, profitColor, formatMonthlyProfit, UNASSIGNED_KEY } from './MDDashboard.helpers';
import { aggregateStaffByDepartment, computeTodayProfit, profitColor, formatMonthlyProfit, UNASSIGNED_KEY } from './MDDashboard.helpers';

type MDDashboardKpiMetric =
  | 'cash_movement'
  | 'accounting_income'
  | 'billing_collection'
  | 'due_collection'
  | 'deposit_collection'
  | 'accounting_expenses'
  | 'accounting_profit'
  | 'patient_due'
  | 'patient_advance'
  | 'pending_handover'
  | 'total_discount'
  | 'pending_posting'
  | 'doctor_payout'
  | 'gl_income'
  | 'gl_expenses'
  | 'gl_profit'
  | 'doctor_payout'
  | 'cash_received'
  | 'billing_collection'
  | 'due_collection'
  | 'deposit_collection'
  | 'drawer_cash';

type SelectedKpi = { metric: MDDashboardKpiMetric; title: string; valueType?: 'money' | 'count'; sourceLabel?: string };

function appendDashboardQuery(path: string, dashboardQuery: string): string {
  if (!dashboardQuery) return path;
  return `${path}${dashboardQuery.replace(/^\?/, '&')}`;
}

/* ── Component ────────────────────────────────────────────────────── */

export default function MDDashboard() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { user } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const base = `/h/${slug ?? ''}`;
  const userPermissions = user?.permissions ?? [];
  const canWorkAsReception = userPermissions.includes('*')
    || userPermissions.includes('billing.counter.shift.auto_open')
    || userPermissions.includes('billing.counter.activate')
    || userPermissions.includes('billing.counter.handover.receive');

  const [filters, setFilters] = useState<ExecutiveDashboardFilters>(() => resolveExecutiveDashboardFilters('today'));
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(() => new Date());
  const [selectedKpi, setSelectedKpi] = useState<SelectedKpi | null>(null);
  const period = useMemo<DashboardPeriod>(() => ({
    startDate: filters.startDate,
    endDate: filters.endDate,
    label: filters.startDate === filters.endDate ? filters.endDate : `${filters.startDate} – ${filters.endDate}`,
  }), [filters.endDate, filters.startDate]);

  const analyticsQuery = executiveAnalyticsQuery(filters);
  const dashboardQuery = `?${analyticsQuery}`;
  const rangeKey = analyticsQuery;
  const legacySnapshotQuery = `?date=${encodeURIComponent(filters.endDate)}`;
  const pendingRequestWindow = { from: filters.startDate, to: filters.endDate };

  const incomeQ   = useApiQuery<DailyData>([...queryKeys.md.dailyIncome(), rangeKey],   `/api/dashboard/daily-income${dashboardQuery}`);
  const expenseQ  = useApiQuery<DailyData>([...queryKeys.md.dailyExpenses(), rangeKey], `/api/dashboard/daily-expenses${dashboardQuery}`);
  const monthlyQ  = useApiQuery<MonthlyData>(queryKeys.md.monthlySummary(), '/api/dashboard/monthly-summary');
  const staffQ    = useApiQuery<StaffResponse>(queryKeys.staff.list(),   '/api/staff');

  // New (Phase 2): consolidated /stats + security alerts. The picked range/date
  // changes the URL and query key so react-query refetches.
  const statsPath     = `/api/dashboard/stats${legacySnapshotQuery}`;
  const statsQ        = useApiQuery<DashboardStats>(queryKeys.md.stats(rangeKey), statsPath);
  const securityAlertsQ = useApiQuery<SecurityAlertsSummary>(queryKeys.md.securityAlerts(), '/api/dashboard/security-alerts');

  const kpiBreakdownPathFor = (metric: MDDashboardKpiMetric) => appendDashboardQuery(
    `/api/dashboard/kpi-breakdown?metric=${encodeURIComponent(metric)}`,
    dashboardQuery,
  );

  const selectedMetric = selectedKpi?.metric ?? 'cash_movement';
  const selectedSourceLabel = selectedKpi?.sourceLabel?.trim() || '';
  const selectedSourceQuery = selectedSourceLabel ? `&sourceLabel=${encodeURIComponent(selectedSourceLabel)}` : '';
  const selectedBreakdownPath = appendDashboardQuery(
    `/api/dashboard/kpi-breakdown?metric=${encodeURIComponent(selectedMetric)}${selectedSourceQuery}`,
    dashboardQuery,
  );
  const selectedBreakdownQ = useApiQuery<KpiBreakdownData>(
    [...queryKeys.md.kpiBreakdown(selectedMetric, rangeKey), 'drawer', selectedSourceLabel || 'all'],
    selectedBreakdownPath,
    { enabled: Boolean(selectedKpi) },
  );

  const dailyIncome   = incomeQ.data   ?? EMPTY_DAILY;
  const dailyExpenses = expenseQ.data  ?? EMPTY_DAILY;
  const monthly       = monthlyQ.data  ?? EMPTY_MONTHLY;
  const staff         = staffQ.data?.staff ?? [];
  const stats         = statsQ.data    ?? EMPTY_STATS;
  const alerts        = securityAlertsQ.data ?? EMPTY_ALERTS;

  const hasError = incomeQ.isError || expenseQ.isError || monthlyQ.isError
                || staffQ.isError || statsQ.isError || securityAlertsQ.isError;

  const refreshAll = async () => {
    await Promise.all([
      incomeQ.refetch(),
      expenseQ.refetch(),
      monthlyQ.refetch(),
      staffQ.refetch(),
      statsQ.refetch(),
      securityAlertsQ.refetch(),
      queryClient.invalidateQueries({ queryKey: ['md', 'executive-control'] }),
      queryClient.invalidateQueries({ queryKey: ['md', 'executive-kpis'] }),
      queryClient.invalidateQueries({ queryKey: ['md', 'executive-analytics'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.actionCenter.collections.all }),
    ]);
    setLastRefreshedAt(new Date());
  };
  const retryAll = () => { void refreshAll(); };

  const todayProfit = computeTodayProfit(dailyIncome.total, dailyExpenses.total);
  const expenseBreakdown: BreakdownRow[] = dailyExpenses.byCategory ?? dailyExpenses.bySource ?? [];
  const staffVisible = staff.slice(0, STAFF_VISIBLE);
  const pendingHandoverPath = `${base}/md/handover?status=pending`;
  const pdfCenterPath = `${base}/md/reports/pdf?from=${filters.startDate}&to=${filters.endDate}`;
  const dailyClosingPackPath = `${base}/md/reports/pdf?pack=daily-closing&from=${filters.startDate}&to=${filters.endDate}&autoprint=1`;
  const openKpi = (metric: MDDashboardKpiMetric, title: string, valueType?: 'money' | 'count') => {
    setSelectedKpi({ metric, title, valueType });
  };

  return (
    <DashboardLayout role="md">
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Page title + Date range picker ── */}
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="page-title mb-0">{t('managingDirectorDashboard', { defaultValue: 'Managing Director Dashboard' })}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={pdfCenterPath}
                className="btn-secondary text-xs"
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                PDF Center
              </Link>
              <Link
                to={dailyClosingPackPath}
                className="btn-secondary text-xs"
              >
                <Printer className="w-4 h-4" aria-hidden="true" />
                Daily Pack
              </Link>
              {canWorkAsReception ? (
                <Link
                  to={`${base}/reception/dashboard`}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                  <ClipboardList className="h-4 w-4" />
                  {t('mdDashboard.workAsReception', { defaultValue: 'Work as Reception' })}
                </Link>
              ) : null}
            </div>
          </div>

          {hasError && (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {t('failedToLoadDashboard', { defaultValue: 'Failed to load dashboard data. Some numbers may be outdated.' })}
              </span>
              <button
                type="button"
                onClick={retryAll}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t('retry', { ns: 'dashboard', defaultValue: 'Retry' })}
              </button>
            </div>
          )}

          <ExecutiveDashboardRangeFilter
            filters={filters}
            onChange={setFilters}
            onRefresh={() => { void refreshAll(); }}
            refreshing={Boolean(
              incomeQ.isFetching
              || expenseQ.isFetching
              || statsQ.isFetching
            )}
            lastRefreshedAt={lastRefreshedAt}
            className="mb-4"
          />

          <ExecutiveControlKpis
            queryKeyScope="md"
            querySuffix={dashboardQuery}
            filters={filters}
            snapshotDate={filters.endDate}
            title="MD cash-control KPIs"
            subtitle="Admin dashboard cash KPIs with the same drilldown, transaction details, and cash source breakdown."
            handoverPath={`${base}/md/handover?status=pending&mode=management`}
          />

          <ExecutiveDuePanel
            role="md"
            basePath={base}
            queryKeyScope="md"
          />

          <IPDBillingOverview period={period} queryKeyScope="md" />
          <PendingRequestsSection role="md" window={pendingRequestWindow} />

          <div aria-live="polite" aria-busy={incomeQ.isLoading || expenseQ.isLoading || monthlyQ.isLoading || staffQ.isLoading} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard title={t('todaysIncome',   { defaultValue: "Today's Income" })}     value={fmtBDT(dailyIncome.total)}  loading={incomeQ.isLoading}   icon={<TrendingUp className="w-5 h-5" />}   iconBg="bg-emerald-50 text-emerald-600" index={0} onClick={() => setSelectedKpi({ metric: 'gl_income', title: t('todaysIncome', { defaultValue: "Today's Income" }) })} detailHint={t('mdDashboard.kpi.viewDetails', { defaultValue: 'View details' })} />
            <KPICard title={t('todaysExpenses', { defaultValue: "Today's Expenses" })}   value={fmtBDT(dailyExpenses.total)} loading={expenseQ.isLoading} icon={<TrendingDown className="w-5 h-5" />} iconBg="bg-red-50 text-red-600"          index={1} onClick={() => setSelectedKpi({ metric: 'gl_expenses', title: t('todaysExpenses', { defaultValue: "Today's Expenses" }) })} detailHint={t('mdDashboard.kpi.viewDetails', { defaultValue: 'View details' })} />
            <KPICard title={t('mdDashboard.exec.incomeMinusExpense',   { defaultValue: 'Income - Approved Expense' })}      value={fmtBDT(todayProfit)}         loading={incomeQ.isLoading || expenseQ.isLoading} icon={<DollarSign className="w-5 h-5" />}  iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={2} onClick={() => setSelectedKpi({ metric: 'gl_profit', title: t('mdDashboard.exec.incomeMinusExpense', { defaultValue: 'Income - Approved Expense' }) })} tooltip={t('mdDashboard.exec.incomeMinusExpenseTooltip', { defaultValue: 'Formula: selected-period income minus approved operating expense. This is not full net profit.' })} detailHint={t('mdDashboard.kpi.viewDetails', { defaultValue: 'View details' })} />
            <KPICard title={t('totalStaff',     { ns: 'staff', defaultValue: 'Total Staff' })} value={staff.length}          loading={staffQ.isLoading}    icon={<Users className="w-5 h-5" />}      iconBg="bg-blue-50 text-blue-600"           index={3} />
          </div>

        </div>

        <ExecutiveActionQueue stats={stats} alerts={alerts} loading={statsQ.isLoading || securityAlertsQ.isLoading} base={base} onOpenMetric={(metric, title) => setSelectedKpi({ metric, title })} />

        {/* ── Monthly Summary (always rendered — skeleton during isLoading) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: t('monthlyIncome',   { ns: 'common', defaultValue: 'Monthly Income' }),   value: fmtBDT(monthly.income),   color: 'text-emerald-600' },
            { label: t('monthlyExpenses', { ns: 'common', defaultValue: 'Monthly Expenses' }), value: fmtBDT(monthly.expenses), color: 'text-red-600' },
            { label: t('monthlyProfit',   { ns: 'common', defaultValue: 'Monthly Profit' }),   value: formatMonthlyProfit(monthly.profit, monthly.margin), color: profitColor(monthly.profit) },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-5">
              <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
              {monthlyQ.isLoading ? (
                <div className="skeleton h-7 w-28 rounded" />
              ) : (
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              )}
            </div>
          ))}
        </div>

        {/* ── Alerts & exceptions strip (only when something to show) ── */}
        {(() => {
          const canceled = alerts.summary.canceledCount;
          const handovers = stats.finance.pendingHandoverCount;
          const lowStock = alerts.summary.lowStockCount + stats.stats.lowStockItems;
          const hasAny = canceled > 0 || handovers > 0 || lowStock > 0;
          if (!hasAny && !securityAlertsQ.isLoading) return null;
          return (
            <div className="card p-4 sm:p-5" data-testid="alerts-strip">
              <h3 className="section-title mb-3">
                {t('mdDashboard.alerts.title', { defaultValue: 'Alerts & Exceptions' })}
              </h3>
              {securityAlertsQ.isLoading ? (
                <div className="flex gap-2 flex-wrap">
                  {[0, 1, 2].map((i) => <div key={i} className="skeleton h-7 w-36 rounded-full" />)}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {canceled > 0 && (
                    <Link to={`${base}/md/audit`}
                      className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-sm text-red-700 hover:bg-red-100">
                      <XCircle className="w-4 h-4" />
                      {t('mdDashboard.alerts.canceledBills', { defaultValue: 'Canceled bills today' })}: <strong>{canceled}</strong>
                    </Link>
                  )}
                  {handovers > 0 && (
                    <Link to={pendingHandoverPath}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-700 hover:bg-amber-100">
                      <Clock className="w-4 h-4" />
                      {t('mdDashboard.alerts.pendingHandover', { defaultValue: 'Pending handovers' })}: <strong>{handovers}</strong>
                    </Link>
                  )}
                  {lowStock > 0 && (
                    <Link to={`${base}/md/reports`}
                      className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-sm text-orange-700 hover:bg-orange-100">
                      <Package className="w-4 h-4" />
                      {t('mdDashboard.alerts.lowStock', { defaultValue: 'Low stock items' })}: <strong>{lowStock}</strong>
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Operations snapshot ── */}
        <div className="card p-5" data-testid="operations-snapshot">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h3 className="section-title">{t('mdDashboard.operations.title', { defaultValue: 'Operations Snapshot' })}</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {t('mdDashboard.operations.subtitle', { defaultValue: 'Patients, consultations, lab, pharmacy, and bed movement' })}
              </p>
            </div>
          </div>
          {statsQ.isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-16 rounded" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              {[
                { label: t('mdDashboard.operations.appointments', { defaultValue: 'Appointments' }), value: stats.todaySummary.totalAppointments, icon: <Clock className="w-4 h-4" /> },
                { label: t('mdDashboard.operations.consultations', { defaultValue: 'Consultations' }), value: stats.todaySummary.completedConsultations, icon: <Stethoscope className="w-4 h-4" /> },
                { label: t('mdDashboard.operations.opd', { defaultValue: 'OPD' }), value: stats.patientSummary.opdPatients, icon: <Users className="w-4 h-4" /> },
                { label: t('mdDashboard.operations.ipd', { defaultValue: 'IPD' }), value: stats.patientSummary.ipdPatients, icon: <Briefcase className="w-4 h-4" /> },
                { label: t('mdDashboard.operations.labPending', { defaultValue: 'Lab Pending' }), value: stats.todaySummary.pendingTests ?? stats.stats.pendingTests ?? 0, icon: <ClipboardList className="w-4 h-4" /> },
                { label: t('mdDashboard.operations.pharmacySales', { defaultValue: 'Pharmacy Sales' }), value: fmtBDT(stats.pharmacySummary?.todaySales ?? stats.todaySummary.pharmacySales), icon: <Package className="w-4 h-4" /> },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-[var(--color-bg-secondary)] p-3">
                  <div className="mb-2 flex items-center gap-2 text-[var(--color-text-muted)]">
                    {item.icon}
                    <span className="text-[11px] uppercase tracking-wide">{item.label}</span>
                  </div>
                  <p className="text-xl font-semibold text-[var(--color-text-primary)]">{item.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Quick links row (5 cards) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="quick-links">
          {[
            { key: 'hr',         labelKey: 'mdDashboard.quickLinks.hr',         icon: Briefcase, path: `${base}/md/hr` },
            { key: 'accounting', labelKey: 'mdDashboard.quickLinks.accounting', icon: Wallet,    path: `${base}/md/accounting` },
            { key: 'reports',    labelKey: 'mdDashboard.quickLinks.reports',    icon: BarChart3, path: `${base}/md/reports` },
            { key: 'staff',      labelKey: 'mdDashboard.quickLinks.staff',      icon: Users,     path: `${base}/md/staff` },
            { key: 'profitLoss', labelKey: 'mdDashboard.quickLinks.profitLoss', icon: BookOpen,  path: `${base}/md/profit` },
          ].map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.key}
                to={link.path}
                className="card p-4 flex items-center justify-between hover:shadow-md transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="rounded-lg p-2 bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-medium truncate">
                    {t(link.labelKey, { defaultValue: link.key })}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
              </Link>
            );
          })}
        </div>

        {/* ── 7-day revenue trend ── */}
        <div className="card p-5" data-testid="revenue-trend">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h3 className="section-title">
                {t('mdDashboard.trend.title', { defaultValue: '7-Day Revenue Trend' })}
              </h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {t('mdDashboard.trend.subtitle', { defaultValue: 'Income (cash + deposits) by day' })}
              </p>
            </div>
            {!statsQ.isLoading && stats.stats.weekOverWeekChange !== 0 && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                stats.stats.weekOverWeekChange >= 0
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              }`}>
                {stats.stats.weekOverWeekChange >= 0 ? '↑' : '↓'}
                {Math.abs(stats.stats.weekOverWeekChange).toFixed(1)}%
                <span className="text-[var(--color-text-muted)] font-normal">
                  {t('mdDashboard.trend.weekOverWeek', { defaultValue: 'vs last week' })}
                </span>
              </span>
            )}
          </div>
          {statsQ.isLoading ? (
            <div className="skeleton h-48 w-full rounded" />
          ) : stats.revenueData.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] py-8 text-center">
              {t('mdDashboard.trend.noData', { defaultValue: 'No revenue data yet' })}
            </p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%" minHeight={0} minWidth={0}>
                <LineChart data={stats.revenueData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="day" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => `৳${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    formatter={(v: unknown) => [fmtBDT(Number(v)), ''] as [string, string]}
                    contentStyle={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: '10px', fontSize: '13px' }}
                  />
                  <Line type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2.5}
                    dot={{ fill: 'var(--color-primary)', r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Income + Expense Sources ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="card p-5">
            <h3 className="section-title mb-4">{t('incomeSourcesToday', { defaultValue: 'Income Sources Today' })}</h3>
            {dailyIncome.bySource?.length ? (
              <div className="space-y-2">
                {dailyIncome.bySource.map((item, i) => (
                  <button key={`${item.source ?? 'unknown'}-${i}`} type="button" onClick={() => setSelectedKpi({ metric: 'gl_income', title: `${item.source ?? 'Income'} details` })} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-left transition hover:border-[var(--color-primary)] hover:shadow-sm">
                    <span className="flex justify-between text-sm">
                      <span className="capitalize text-[var(--color-text-secondary)]">{item.source}</span>
                      <span className="font-medium text-emerald-600">{fmtBDT(item.total || 0)}</span>
                    </span>
                    <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Open detail rows</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">{t('noData', { ns: 'common', defaultValue: 'No data' })}</p>
            )}
          </div>

          <div className="card p-5">
            <h3 className="section-title mb-4">{t('expensesToday', { defaultValue: 'Expenses Today' })}</h3>
            {expenseBreakdown.length ? (
              <div className="space-y-2">
                {expenseBreakdown.map((item, i) => (
                  <button key={`${item.category ?? item.source ?? 'unknown'}-${i}`} type="button" onClick={() => setSelectedKpi({ metric: 'gl_expenses', title: `${item.category ?? item.source ?? 'Expense'} details` })} className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-left transition hover:border-[var(--color-primary)] hover:shadow-sm">
                    <span className="flex justify-between text-sm">
                      <span className="capitalize text-[var(--color-text-secondary)]">{item.category ?? item.source ?? 'other'}</span>
                      <span className="font-medium text-red-600">{fmtBDT(item.total || 0)}</span>
                    </span>
                    <span className="mt-1 block text-xs text-[var(--color-text-muted)]">Open detail rows</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">{t('noData', { ns: 'common', defaultValue: 'No data' })}</p>
            )}
          </div>
        </div>

        {/* ── Bed occupancy + Staff by department (2-col on lg) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Bed occupancy */}
          <div className="card p-5" data-testid="bed-occupancy">
            <h3 className="section-title mb-4">
              {t('mdDashboard.beds.title', { defaultValue: 'Bed Occupancy' })}
            </h3>
            {statsQ.isLoading ? (
              <div className="space-y-3">
                <div className="skeleton h-7 w-40 rounded" />
                <div className="skeleton h-2 w-full rounded-full" />
                <div className="grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded" />)}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-2xl font-bold text-[var(--color-primary)]">
                    {t('mdDashboard.beds.occupancy', {
                      pct: stats.bedSummary.occupancyPercentage,
                      defaultValue: `${stats.bedSummary.occupancyPercentage}% occupied`,
                    })}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[var(--color-border-light)] overflow-hidden mb-4">
                  <div
                    className="h-full bg-[var(--color-primary)] transition-all"
                    style={{ width: `${Math.min(100, stats.bedSummary.occupancyPercentage)}%` }}
                    role="progressbar"
                    aria-valuenow={stats.bedSummary.occupancyPercentage}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: t('mdDashboard.beds.total',     { defaultValue: 'Total' }),     v: stats.bedSummary.total },
                    { label: t('mdDashboard.beds.occupied',  { defaultValue: 'Occupied' }),  v: stats.bedSummary.occupied, c: 'text-amber-600' },
                    { label: t('mdDashboard.beds.available', { defaultValue: 'Available' }), v: stats.bedSummary.available, c: 'text-emerald-600' },
                    { label: t('mdDashboard.beds.cleaning',  { defaultValue: 'Cleaning' }),  v: stats.bedSummary.cleaning,  c: 'text-blue-600' },
                  ].map(({ label, v, c }) => (
                    <div key={label} className="rounded-md bg-[var(--color-bg-secondary)] p-2">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
                      <p className={`text-lg font-semibold ${c ?? ''}`}>{v}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Staff by department */}
          <div className="card p-5" data-testid="staff-by-department">
            <h3 className="section-title mb-4">
              {t('mdDashboard.staff.deptBreakdown', { defaultValue: 'Staff by Department' })}
            </h3>
            {(() => {
              if (staffQ.isLoading) {
                return (
                  <div className="space-y-2">
                    {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-5 rounded" />)}
                  </div>
                );
              }
              // Translate the aggregator's __unassigned__ sentinel to the
              // user-facing label via i18n. All other keys are passed through.
              const UNASSIGNED_LABEL = t('mdDashboard.staff.noDepartment', { defaultValue: 'Unassigned' });
              const rows = aggregateStaffByDepartment(
                staff.map((s) => ({ id: s.id, department: s.department })),
                5,
              ).map(([key, count]) => [key === UNASSIGNED_KEY ? UNASSIGNED_LABEL : key, count] as [string, number]);
              if (rows.length === 0) {
                return <p className="text-sm text-[var(--color-text-muted)] py-4 text-center">{t('noData', { ns: 'common', defaultValue: 'No data' })}</p>;
              }
              const max = Math.max(...rows.map((r) => r[1]));
              return (
                <div className="space-y-2">
                  {rows.map(([dept, count]) => {
                    const pct = Math.round((count / staff.length) * 100);
                    return (
                      <div key={dept} className="flex items-center gap-3 text-sm">
                        <span className="w-28 truncate text-[var(--color-text-secondary)]">{dept}</span>
                        <div className="flex-1 h-2 rounded-full bg-[var(--color-border-light)] overflow-hidden">
                          <div className="h-full bg-[var(--color-primary)]" style={{ width: `${(count / max) * 100}%` }} />
                        </div>
                        <span className="w-12 text-right font-data text-xs">{count} <span className="text-[var(--color-text-muted)]">({pct}%)</span></span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── Staff Overview ── */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h3 className="section-title">{t('staffOverview', { defaultValue: 'Staff Overview' })}</h3>
            <Link to={`${base}/md/staff`} className="text-sm text-[var(--color-primary)] hover:underline inline-flex items-center gap-1">
              {t('mdDashboard.staff.viewAll', { defaultValue: 'View all staff' })}
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('name', { ns: 'common' })}</th><th>{t('position', { defaultValue: 'Position' })}</th><th>{t('salary', { defaultValue: 'Salary' })}</th><th>{t('status', { ns: 'common' })}</th></tr></thead>
              <tbody>
                {staffQ.isLoading ? (
                  [...Array(STAFF_VISIBLE)].map((_, i) => <tr key={i}>{[...Array(4)].map((_, j) => <td key={j}><div className="skeleton h-4 rounded" /></td>)}</tr>)
                ) : staff.length === 0 ? (
                  <tr><td colSpan={4} className="py-12 text-center text-[var(--color-text-muted)]">{t('noStaff', { ns: 'staff', defaultValue: 'No staff found' })}</td></tr>
                ) : (
                  staffVisible.map(m => (
                    <tr key={m.id}>
                      <td className="font-medium">{m.name}</td>
                      <td className="text-sm text-[var(--color-text-secondary)]">{m.position}</td>
                      <td className="font-data text-sm">{fmtBDT(m.salary)}</td>
                      <td><span className={`badge ${m.status === 'active' ? 'badge-success' : 'badge-secondary'}`}>{m.status}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
              {staff.length > STAFF_VISIBLE && !staffQ.isLoading && (
                <tfoot>
                  <tr>
                    <td colSpan={4} className="text-xs text-[var(--color-text-muted)] px-5 py-2 border-t border-[var(--color-border)]">
                      {t('showingNOfM', { count: STAFF_VISIBLE, total: staff.length, defaultValue: `Showing ${STAFF_VISIBLE} of ${staff.length}` })}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

      </div>

      {selectedKpi !== null && (
        <KpiBreakdownDrawer
          onClose={() => setSelectedKpi(null)}
          title={selectedKpi.title}
          data={selectedBreakdownQ.data}
          loading={selectedBreakdownQ.isLoading}
          error={selectedBreakdownQ.isError}
          action={selectedKpi.metric === 'pending_handover' ? {
            label: t('mdDashboard.kpi.openHandoverCollection', { defaultValue: 'Open handover collection' }),
            href: pendingHandoverPath,
            help: t('mdDashboard.kpi.pendingHandoverActionHelp', { defaultValue: 'Use Confirm collected, Partial, or Accept & Start Shift from the handover page.' }),
          } : undefined}
          labels={{
            close: t('common:close', { defaultValue: 'Close' }),
            sources: t('mdDashboard.kpi.sourcesHeading', { defaultValue: 'Sources' }),
            details: t('mdDashboard.kpi.detailsHeading', { defaultValue: 'Transaction details' }),
            noRows: t('mdDashboard.kpi.noRows', { defaultValue: 'No transactions found for this period.' }),
          }}
        />
      )}
    </DashboardLayout>
  );
}


function ExecutiveActionQueue({ stats, alerts, loading, base, onOpenMetric }: { stats: DashboardStats; alerts: SecurityAlertsSummary; loading: boolean; base: string; onOpenMetric: (metric: MDDashboardKpiMetric, title: string) => void }) {
  const rows = [
    { id: 'handover', title: 'Pending handover cash', count: stats.finance.pendingHandoverCount, amount: stats.finance.pendingHandoverAmount, metric: 'pending_handover' as MDDashboardKpiMetric },
    { id: 'posting', title: 'Accounting posting queue', count: Number(stats.finance.pendingPostingEvents || 0), metric: 'pending_posting' as MDDashboardKpiMetric },
    { id: 'due', title: 'Outstanding patient due', count: stats.finance.patientDue > 0 ? 1 : 0, amount: stats.finance.patientDue, metric: 'patient_due' as MDDashboardKpiMetric },
    { id: 'discount', title: 'High discount bills', count: alerts.summary.highDiscountCount, metric: 'total_discount' as MDDashboardKpiMetric },
    { id: 'bill-review', title: 'Bill review', count: alerts.summary.canceledCount, href: `${base}/md/audit` },
    { id: 'stock', title: 'Low stock items', count: alerts.summary.lowStockCount + stats.stats.lowStockItems, href: `${base}/md/reports` },
  ].filter((row) => Number(row.count || 0) > 0);

  return (
    <div className="card p-5" data-testid="md-action-queue">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="section-title">MD review queue</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Review handover, posting, due, discount and stock risks.</p>
        </div>
        <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">{rows.length} active</span>
      </div>
      {loading ? <div className="mt-4 skeleton h-24 rounded-xl" /> : rows.length === 0 ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">No items for this period.</p> : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const content = <><p className="font-semibold text-[var(--color-text-primary)]">{row.title}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.count.toLocaleString()} item{row.count === 1 ? '' : 's'} need review.</p>{row.amount ? <p className="mt-3 font-data text-lg font-bold text-[var(--color-text-primary)]">{fmtBDT(row.amount)}</p> : null}<p className="mt-3 text-xs font-semibold text-[var(--color-primary)]">Review →</p></>;
            if ('metric' in row && row.metric) return <button key={row.id} type="button" onClick={() => onOpenMetric(row.metric, row.title)} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 text-left transition hover:border-[var(--color-primary)] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2">{content}</button>;
            return <Link key={row.id} to={row.href || base} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 text-left transition hover:border-[var(--color-primary)] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2">{content}</Link>;
          })}
        </div>
      )}
    </div>
  );
}

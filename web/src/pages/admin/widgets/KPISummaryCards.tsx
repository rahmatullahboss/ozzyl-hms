import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Banknote, TrendingDown, TrendingUp, HandCoins, RefreshCw, Users, BedDouble, Clock, ShieldAlert, Monitor, WalletCards, FileText, Printer, FlaskConical, ClipboardList, Stethoscope, Wallet, DollarSign } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import KPICard from '../../../components/dashboard/KPICard';
import KpiBreakdownDrawer, { type KpiBreakdownData, type KpiBreakdownSource, type KpiBreakdownRow } from '../../../components/dashboard/KpiBreakdownDrawer';
import AdminKpiInvoiceModal from '../../../components/dashboard/AdminKpiInvoiceModal';
import { useInvoiceInspectorState } from '../../../components/invoice-inspector/useInvoiceInspectorState';
import DashboardKpiConfigurator from '../../../components/dashboard/DashboardKpiConfigurator';
import DoctorPerformancePanel from '../../../components/dashboard/DoctorPerformancePanel';
import DoctorPerformanceDrawer from '../../../components/dashboard/DoctorPerformanceDrawer';
import TestPerformancePanel from '../../../components/dashboard/TestPerformancePanel';
import TestPerformanceDrawer from '../../../components/dashboard/TestPerformanceDrawer';
import IncomeServicePanel from '../../../components/dashboard/IncomeServicePanel';
import ExpenseAnalysisPanel from '../../../components/dashboard/ExpenseAnalysisPanel';
import ReagentReconciliationPanel from '../../../components/dashboard/ReagentReconciliationPanel';
import ExecutiveDashboardRangeFilter from '../../../components/dashboard/ExecutiveDashboardRangeFilter';
import { useApiQuery, useQueryClient } from '../../../hooks/useApiQuery';
import { executiveAnalyticsQuery, useExecutiveDashboardAnalytics } from '../../../hooks/useExecutiveDashboardAnalytics';
import { executiveDashboardMetricValueType, useExecutiveDashboardKpis, type ExecutiveDashboardCardMetric, type ExecutiveDashboardMetric } from '../../../hooks/useExecutiveDashboardKpis';
import type {
  DoctorPerformanceRow,
  DoctorSort,
  ExecutiveDashboardFilters,
  TestPerformanceRow,
  TestSort,
} from '../../../types/executiveDashboard';
import { queryKeys } from '../../../lib/queryKeys';
import { formatCurrency } from '../../../lib/format';
import { displayKpiSourceLabel, kpiFormulaNote, safeT } from '../../../lib/kpiLabels';

interface DashboardStats {
  todayPatients: number;
}

interface TodaySummary {
  newPatients: number;
  admittedPatients: number;
  totalDiscount: number;
}

interface DashboardFinance {
  todayCollection: number;
  todayExpense: number;
  patientDue: number;
  todayDeposit?: number;
}

interface ActiveCounterResponse {
  activeCounters: Array<{ expectedCash: number }>;
  totalActive: number;
}

interface PatientSummary {
  opdPatients: number;
}

interface DashboardResponse {
  stats: DashboardStats;
  todaySummary: TodaySummary;
  finance: DashboardFinance;
  patientSummary: PatientSummary;
}

type AdminKpiBreakdownMetric =
  | ExecutiveDashboardCardMetric
  | 'patient_due'
  | 'total_discount'
  | 'cash_received'
  | 'billing_collection'
  | 'ipd_collection'
  | 'due_collection'
  | 'deposit_collection'
  | 'drawer_cash'
  | 'cash_movement'
  | 'doctor_payout'
  | 'patient_advance';

type SelectedKpi = {
  metric: AdminKpiBreakdownMetric;
  title: string;
  sourceLabel?: string;
  doctorId?: number;
  doctorLabel?: string;
};

const COMMISSION_BREAKDOWN_METRICS = new Set<AdminKpiBreakdownMetric>([
  'visit_commission',
  'test_commission',
  'other_doctor_commission',
  'total_commission',
]);

function isCommissionBreakdownMetric(metric: AdminKpiBreakdownMetric): boolean {
  return COMMISSION_BREAKDOWN_METRICS.has(metric);
}

interface CashBreakdownBoxProps {
  cashData?: KpiBreakdownData;
  expenseData?: KpiBreakdownData;
  cashLoading?: boolean;
  expenseLoading?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  onOpenMetric: (metric: AdminKpiBreakdownMetric, title: string, sourceLabel?: string) => void;
}

function breakdownSources(data?: KpiBreakdownData): KpiBreakdownSource[] {
  if (!Array.isArray(data?.sources)) return [];
  return data.sources;
}

function isCashOutSource(source: KpiBreakdownSource): boolean {
  return source.direction === 'out' || Number(source.amount || 0) < 0;
}

function executiveMetricVisual(metric: ExecutiveDashboardCardMetric) {
  switch (metric) {
    case 'accounting_income': return { icon: <Banknote className="w-5 h-5" />, iconBg: 'bg-emerald-50 text-emerald-600' };
    case 'accounting_expenses': return { icon: <TrendingDown className="w-5 h-5" />, iconBg: 'bg-red-50 text-red-600' };
    case 'accounting_profit': return { icon: <TrendingUp className="w-5 h-5" />, iconBg: 'bg-sky-50 text-sky-600' };
    case 'opd_income': return { icon: <Stethoscope className="w-5 h-5" />, iconBg: 'bg-cyan-50 text-cyan-600' };
    case 'lab_income': return { icon: <FlaskConical className="w-5 h-5" />, iconBg: 'bg-violet-50 text-violet-600' };
    case 'ipd_collection': return { icon: <BedDouble className="w-5 h-5" />, iconBg: 'bg-blue-50 text-blue-600' };
    case 'ot_income': return { icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-orange-50 text-orange-600' };
    case 'pharmacy_income': return { icon: <WalletCards className="w-5 h-5" />, iconBg: 'bg-emerald-50 text-emerald-600' };
    case 'radiology_income': return { icon: <Monitor className="w-5 h-5" />, iconBg: 'bg-indigo-50 text-indigo-600' };
    case 'deposit_collection': return { icon: <Wallet className="w-5 h-5" />, iconBg: 'bg-teal-50 text-teal-600' };
    case 'uncategorized_income': return { icon: <ShieldAlert className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-700' };
    case 'visit_commission': return { icon: <Stethoscope className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-700' };
    case 'test_commission': return { icon: <FlaskConical className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-700' };
    case 'other_doctor_commission': return { icon: <HandCoins className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-700' };
    case 'total_commission': return { icon: <DollarSign className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-600' };
    case 'total_visits': return { icon: <Stethoscope className="w-5 h-5" />, iconBg: 'bg-cyan-50 text-cyan-600' };
    case 'pending_approvals': return { icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-orange-50 text-orange-600' };
    case 'cash_received': return { icon: <Banknote className="w-5 h-5" />, iconBg: 'bg-emerald-50 text-emerald-600' };
    case 'cash_movement': return { icon: <Monitor className="w-5 h-5" />, iconBg: 'bg-sky-50 text-sky-600' };
    case 'drawer_cash': return { icon: <Wallet className="w-5 h-5" />, iconBg: 'bg-blue-50 text-blue-600' };
    case 'inventory_stock_skus': return { icon: <WalletCards className="w-5 h-5" />, iconBg: 'bg-slate-50 text-slate-600' };
    case 'inventory_low_stock': return { icon: <TrendingDown className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-700' };
    case 'inventory_out_of_stock': return { icon: <TrendingDown className="w-5 h-5" />, iconBg: 'bg-red-50 text-red-700' };
    case 'inventory_expiring_soon': return { icon: <Clock className="w-5 h-5" />, iconBg: 'bg-orange-50 text-orange-700' };
    case 'inventory_expired': return { icon: <Clock className="w-5 h-5" />, iconBg: 'bg-red-50 text-red-700' };
    case 'inventory_pending_purchase': return { icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-indigo-50 text-indigo-600' };
    case 'lab_tests_completed': return { icon: <FlaskConical className="w-5 h-5" />, iconBg: 'bg-emerald-50 text-emerald-600' };
    case 'lab_reagent_consumed': return { icon: <FlaskConical className="w-5 h-5" />, iconBg: 'bg-violet-50 text-violet-600' };
    case 'lab_reagent_stock_skus': return { icon: <FlaskConical className="w-5 h-5" />, iconBg: 'bg-cyan-50 text-cyan-600' };
    case 'lab_reagent_low_stock': return { icon: <TrendingDown className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-700' };
    case 'lab_reagent_out_of_stock': return { icon: <TrendingDown className="w-5 h-5" />, iconBg: 'bg-red-50 text-red-700' };
    case 'lab_reagent_expiring_soon': return { icon: <Clock className="w-5 h-5" />, iconBg: 'bg-orange-50 text-orange-700' };
    case 'lab_reagent_qc_issues': return { icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-rose-50 text-rose-700' };
    case 'unmapped_lab_tests': return { icon: <FlaskConical className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-700' };
    case 'consumption_exceptions': return { icon: <ShieldAlert className="w-5 h-5" />, iconBg: 'bg-rose-50 text-rose-700' };
    case 'radiology_exams_completed': return { icon: <Monitor className="w-5 h-5" />, iconBg: 'bg-emerald-50 text-emerald-600' };
    case 'radiology_stock_skus': return { icon: <Monitor className="w-5 h-5" />, iconBg: 'bg-sky-50 text-sky-600' };
    case 'radiology_low_stock': return { icon: <TrendingDown className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-700' };
    case 'radiology_out_of_stock': return { icon: <TrendingDown className="w-5 h-5" />, iconBg: 'bg-red-50 text-red-700' };
    case 'radiology_expiring_soon': return { icon: <Clock className="w-5 h-5" />, iconBg: 'bg-orange-50 text-orange-700' };
    case 'radiology_issue_lines': return { icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-indigo-50 text-indigo-600' };
  }
}

function formatExecutiveMetricValue(metric: ExecutiveDashboardCardMetric, data?: KpiBreakdownData): string {
  const total = Number(data?.total ?? 0);
  const valueType = data?.valueType ?? executiveDashboardMetricValueType(metric);
  return valueType === 'count' ? total.toLocaleString() : formatCurrency(total);
}

function CashBreakdownBox({ cashData, expenseData, cashLoading, expenseLoading, t, onOpenMetric }: CashBreakdownBoxProps) {
  const cashSources = breakdownSources(cashData);
  const cashInSources = cashSources.filter((source) => !isCashOutSource(source));
  const cashOutSources = cashSources.filter(isCashOutSource);
  const expenseSources = breakdownSources(expenseData);
  const loading = Boolean(cashLoading || expenseLoading);
  const hasContent = loading || cashInSources.length > 0 || cashOutSources.length > 0 || expenseSources.length > 0;

  if (!hasContent) return null;

  return (
    <section className="card p-4 sm:p-5" data-testid="admin-cash-breakdown-box">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Financial control center</p>
          <h2 className="section-title mt-1">{safeT(t, 'adminDashboard.cashBreakdown.title', 'Cash reconciliation snapshot')}</h2>
          <p className="section-subtitle mt-1">
            {safeT(t, 'adminDashboard.cashBreakdown.subtitle', 'Track where cash came from, where it went, and which rows need verification.')}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {safeT(t, 'adminDashboard.cashBreakdown.totalCashMovement', 'Net drawer movement')}
          </p>
          <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">
            {loading ? '—' : formatCurrency(cashData?.total ?? 0)}
          </p>
          <p className="mt-1 text-[0.7rem] text-[var(--color-text-muted)]">Selected-day source rows</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {safeT(t, 'adminDashboard.cashBreakdown.moneyInSources', 'Money received from')}
          </h3>
          <div className="mt-3 space-y-2">
            {loading ? (
              <div className="skeleton h-16 rounded-lg" />
            ) : cashInSources.length ? (
              cashInSources.map((source) => <BreakdownSourceRow key={source.label} source={source} context="money-in" onOpenMetric={onOpenMetric} />)
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                {safeT(t, 'adminDashboard.cashBreakdown.noSources', 'No source data yet')}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {safeT(t, 'adminDashboard.cashBreakdown.expenseCategories', 'Cash out / expenses')}
          </h3>
          <div className="mt-3 space-y-3">
            {loading ? (
              <div className="skeleton h-16 rounded-lg" />
            ) : cashOutSources.length || expenseSources.length ? (
              <>
                {cashOutSources.length ? (
                  <div className="space-y-2">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Physical drawer cash-out</p>
                    {cashOutSources.map((source) => <BreakdownSourceRow key={source.label} source={source} context="money-out" onOpenMetric={onOpenMetric} />)}
                  </div>
                ) : null}
                {expenseSources.length ? (
                  <div className="space-y-2">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Cash-paid expense categories</p>
                    {expenseSources.map((source) => <BreakdownSourceRow key={source.label} source={source} context="money-out" metricOverride="accounting_expenses" onOpenMetric={onOpenMetric} />)}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                {safeT(t, 'adminDashboard.cashBreakdown.noSources', 'No source data yet')}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function cashSourceDetail(label: string, context: 'money-in' | 'money-out'): string {
  if (label.includes('DueCollection')) return 'Old invoices paid today. Open to see invoice, patient, receipt, collector, and remaining due.';
  if (label.includes('SourceVisit')) return 'Doctor visit bills collected today. Open to see invoice, patient, discount, paid and due.';
  if (label.includes('SourceTest')) return 'Lab/test bills collected today. Open to see invoice, patient, tests, discount, paid and due.';
  if (label.includes('SourceAdmission')) return 'Admission/IPD bills collected today. Open to see invoice, patient, discount, paid and due.';
  if (label.includes('SourceOperation')) return 'OT/procedure bills collected today. Open to see invoice, patient, discount, paid and due.';
  if (label.includes('SourceMedicine')) return 'Medicine bills collected today. Open to see invoice, patient, discount, paid and due.';
  if (label.includes('SourceOtherService')) return 'Other service charges collected today. Open to see invoice, patient, discount, paid and due.';
  if (label.includes('SourceBill')) return 'Bills collected today. Open to see invoice, patient, service/tests, discount, paid and due.';
  if (label.includes('SourceDeposit')) return 'Patient advance/deposit cash. Open to see deposit rows and who received them.';
  if (label.includes('SourceExpense')) return 'Cash paid out as operating expense. Open to see expense head/category, voucher, and user.';
  if (label.includes('SourcePayout')) return 'Doctor payout cash movement. Open to review payout rows.';
  return context === 'money-in' ? 'Open to see the cash receipt rows behind this source.' : 'Open to see the cash-out rows behind this source.';
}

function cashSourceMetric(label: string, context: 'money-in' | 'money-out'): AdminKpiBreakdownMetric {
  const lower = label.toLowerCase();
  if (label.includes('SourceDeposit') || lower.includes('deposit')) return 'deposit_collection';
  if (label.includes('SourceExpense') || lower.includes('expense')) return 'accounting_expenses';
  if (label.includes('SourcePayout') || lower.includes('payout')) return 'doctor_payout';
  if (label.includes('DueCollection') || lower.includes('due collection')) return 'due_collection';
  if (label.includes('SourceAdmission') || lower.includes('admission/ipd')) return 'ipd_collection';
  if (
    label.includes('SourceBill')
    || label.includes('SourceVisit')
    || label.includes('SourceTest')
    || label.includes('SourceAdmission')
    || label.includes('SourceOperation')
    || label.includes('SourceMedicine')
    || label.includes('SourceOtherService')
    || lower.includes('bill collection')
  ) return 'billing_collection';
  return context === 'money-out' ? 'cash_movement' : 'accounting_income';
}

function BreakdownSourceRow({ source, context, onOpenMetric, metricOverride }: { source: KpiBreakdownSource; context: 'money-in' | 'money-out'; onOpenMetric: (metric: AdminKpiBreakdownMetric, title: string, sourceLabel?: string) => void; metricOverride?: AdminKpiBreakdownMetric }) {
  const label = displayKpiSourceLabel(source.label);
  const disabled = Number(source.count || 0) <= 0 && Number(source.amount || 0) === 0;
  const metric = metricOverride ?? cashSourceMetric(source.label, context);
  const sourceDrilldownLabel = metricOverride || metric === 'ipd_collection' ? undefined : source.label;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onOpenMetric(metric, `${label} details`, sourceDrilldownLabel)}
      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-left text-sm transition hover:border-[var(--color-primary)] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--color-text-primary)]">{label}</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{source.count.toLocaleString()} rows · {cashSourceDetail(source.label, context)}</p>
        </div>
        <p className="shrink-0 font-data font-semibold text-[var(--color-text-primary)]">
          {formatCurrency(source.amount)}
        </p>
      </div>
      {!disabled ? <p className="mt-2 text-[0.7rem] font-semibold text-[var(--color-primary)]">Open transaction details →</p> : null}
    </button>
  );
}

interface KPISummaryCardsProps {
  filters: ExecutiveDashboardFilters;
  onFiltersChange: Dispatch<SetStateAction<ExecutiveDashboardFilters>>;
}

export default function KPISummaryCards({ filters, onFiltersChange }: KPISummaryCardsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { slug = '' } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const [selectedKpi, setSelectedKpi] = useState<SelectedKpi | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(() => new Date());
  const [drilldownPage, setDrilldownPage] = useState(1);
  const [drilldownPageSize, setDrilldownPageSize] = useState(50);
  const invoiceInspector = useInvoiceInspectorState();
  const [doctorPage, setDoctorPage] = useState(1);
  const [doctorSortBy, setDoctorSortBy] = useState<DoctorSort>('payableCommission');
  const [testPage, setTestPage] = useState(1);
  const [testSortBy, setTestSortBy] = useState<TestSort>('quantity');
  const [incomePage, setIncomePage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const [reagentPage, setReagentPage] = useState(1);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorPerformanceRow | null>(null);
  const [selectedTest, setSelectedTest] = useState<TestPerformanceRow | null>(null);
  const analyticsQuery = executiveAnalyticsQuery(filters);
  const dashboardQuery = `?${analyticsQuery}`;
  const rangeKey = `${filters.preset}:${filters.startDate}:${filters.endDate}`;
  const pdfCenterPath = `${base}/reports/pdf?from=${filters.startDate}&to=${filters.endDate}`;
  const dailyClosingPackPath = `${base}/reports/pdf?pack=daily-closing&from=${filters.startDate}&to=${filters.endDate}&autoprint=1`;

  const { data, isLoading, isError, isFetching, refetch } = useApiQuery<DashboardResponse>(
    queryKeys.admin.dashboard(rangeKey),
    `/api/dashboard/stats?date=${encodeURIComponent(filters.endDate)}`,
    { refetchInterval: 60_000 },
  );

  const executiveKpis = useExecutiveDashboardKpis('admin', dashboardQuery);
  const enabledPanels = useMemo<Set<ExecutiveDashboardMetric>>(
    () => new Set(executiveKpis.panelItems.map((item) => item.metricKey)),
    [executiveKpis.panelItems],
  );
  const executiveAnalytics = useExecutiveDashboardAnalytics({
    queryKeyScope: 'admin',
    filters,
    enabledPanels,
    doctorPage,
    doctorPageSize: 10,
    doctorSortBy,
    testPage,
    testPageSize: 10,
    testSortBy,
    incomePage,
    incomePageSize: 10,
    expensePage,
    expensePageSize: 10,
    reagentPage,
    reagentPageSize: 10,
  });
  const {
    data: cashBreakdownData,
    isLoading: cashBreakdownLoading,
    isFetching: cashBreakdownFetching,
    refetch: refetchCashBreakdown,
  } = useApiQuery<KpiBreakdownData>(
    ['admin', 'kpiBreakdown', 'cash_movement', rangeKey, 'overview'],
    `/api/dashboard/kpi-breakdown?metric=cash_movement&${analyticsQuery}&pageSize=50`,
    { refetchInterval: 60_000 },
  );
  const {
    data: expenseBreakdownData,
    isLoading: expenseBreakdownLoading,
    isFetching: expenseBreakdownFetching,
    refetch: refetchExpenseBreakdown,
  } = useApiQuery<KpiBreakdownData>(
    ['admin', 'kpiBreakdown', 'accounting_expenses', rangeKey, 'overview'],
    `/api/dashboard/kpi-breakdown?metric=accounting_expenses&${analyticsQuery}&pageSize=50`,
    { refetchInterval: 60_000 },
  );

  const selectedBreakdownMetric = selectedKpi?.metric ?? 'accounting_income';
  const selectedBreakdownSourceLabel = selectedKpi?.sourceLabel;
  const selectedBreakdownSourceParam = selectedBreakdownSourceLabel ? `&sourceLabel=${encodeURIComponent(selectedBreakdownSourceLabel)}` : '';
  const selectedBreakdownDoctorId = selectedKpi && isCommissionBreakdownMetric(selectedKpi.metric) ? selectedKpi.doctorId : undefined;
  const selectedBreakdownDoctorParam = selectedBreakdownDoctorId ? `&doctorId=${selectedBreakdownDoctorId}` : '';
  const selectedBreakdownQuery = useApiQuery<KpiBreakdownData>(
    ['admin', 'kpiBreakdown', selectedBreakdownMetric, rangeKey, drilldownPage, drilldownPageSize, selectedBreakdownSourceLabel ?? 'all', selectedBreakdownDoctorId ?? 'all-doctors', 'drawer'],
    `/api/dashboard/kpi-breakdown?metric=${encodeURIComponent(selectedBreakdownMetric)}&${analyticsQuery}&page=${drilldownPage}&pageSize=${drilldownPageSize}${selectedBreakdownSourceParam}${selectedBreakdownDoctorParam}`,
    { enabled: Boolean(selectedKpi) },
  );

  const refreshAll = async () => {
    await Promise.all([
      refetch(),
      refetchCashBreakdown(),
      refetchExpenseBreakdown(),
      executiveKpis.summaryQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['admin', 'executive-analytics'] }),
    ]);
    setLastRefreshedAt(new Date());
  };

  if (isError) {
    return (
      <div
        className="col-span-full card p-5 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
          <p className="text-sm font-medium">{safeT(t, 'adminDashboard.errors.loadFailed', 'Unable to load dashboard data')}</p>
        </div>
        <button
          onClick={() => { void refreshAll(); }}
          className="mt-3 text-xs text-red-700 dark:text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
        >
          {safeT(t, 'adminDashboard.errors.retry', 'Retry')}
        </button>
      </div>
    );
  }

  const managementCards = executiveKpis.managementItems.map((item) => {
    const query = executiveKpis.queries[item.metricKey];
    return {
      ...item,
      ...executiveMetricVisual(item.metricKey),
      value: formatExecutiveMetricValue(item.metricKey, query.data),
      loading: query.isLoading,
      valueType: query.data?.valueType ?? executiveDashboardMetricValueType(item.metricKey),
    };
  });

  const cashControlCards = executiveKpis.cashControlItems.map((item) => {
    const query = executiveKpis.queries[item.metricKey];
    return {
      ...item,
      ...executiveMetricVisual(item.metricKey),
      value: formatExecutiveMetricValue(item.metricKey, query.data),
      loading: query.isLoading,
      valueType: query.data?.valueType ?? executiveDashboardMetricValueType(item.metricKey),
    };
  });

  const configuredSections = executiveKpis.sections
    .filter((section) => section.key !== 'management' && section.key !== 'cash_control')
    .filter((section) => section.items.length > 0)
    .map((section) => ({
      ...section,
      cards: section.items.map((item) => {
        const query = executiveKpis.queries[item.metricKey];
        return {
          ...item,
          ...executiveMetricVisual(item.metricKey),
          value: formatExecutiveMetricValue(item.metricKey, query.data),
          loading: query.isLoading,
          valueType: query.data?.valueType ?? executiveDashboardMetricValueType(item.metricKey),
        };
      }),
    }));
  const stockSectionKeys = new Set(['inventory', 'lab_reagent', 'radiology_stock']);
  const operationalSections = configuredSections.filter((section) => !stockSectionKeys.has(section.key));
  const stockSections = configuredSections.filter((section) => stockSectionKeys.has(section.key));

  const operationsCards = [
    {
      title: safeT(t, 'adminDashboard.kpi.outstandingDue', 'Outstanding patient due'),
      value: formatCurrency(data?.finance?.patientDue ?? 0),
      icon: <HandCoins className="w-5 h-5" />,
      iconBg: 'bg-amber-50 text-amber-600',
      metric: 'patient_due' as const,
    },
    {
      title: safeT(t, 'adminDashboard.kpi.todayDiscount', 'Discount given'),
      value: formatCurrency(data?.todaySummary?.totalDiscount ?? 0),
      icon: <RefreshCw className="w-5 h-5" />,
      iconBg: 'bg-purple-50 text-purple-600',
      metric: 'total_discount' as const,
    },
    {
      title: safeT(t, 'adminDashboard.kpi.opdPatients', 'OPD patients'),
      value: data?.patientSummary?.opdPatients ?? 0,
      icon: <Users className="w-5 h-5" />,
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: safeT(t, 'adminDashboard.kpi.ipdAdmitted', 'IPD admitted'),
      value: data?.todaySummary?.admittedPatients ?? 0,
      icon: <BedDouble className="w-5 h-5" />,
      iconBg: 'bg-cyan-50 text-cyan-600',
    },
  ];

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
              {safeT(t, 'adminDashboard.dateFilter.title', 'Dashboard range')}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {safeT(t, 'adminDashboard.dateFilter.subtitle', 'KPI, cash, and analytics panels follow one shared reporting period.')}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => navigate(pdfCenterPath)}
              className="btn-secondary text-xs"
              aria-label="Open PDF Center for selected dashboard range"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              PDF Center
            </button>
            <button
              type="button"
              onClick={() => navigate(dailyClosingPackPath)}
              className="btn-primary text-xs"
              aria-label="Print daily closing PDF pack for selected dashboard range"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Daily Pack
            </button>
          </div>
        </div>
        <ExecutiveDashboardRangeFilter
          filters={filters}
          onChange={(nextFilters) => {
            onFiltersChange(nextFilters);
            setSelectedKpi(null);
            setSelectedDoctor(null);
            setSelectedTest(null);
            setDrilldownPage(1);
            setDoctorPage(1);
            setTestPage(1);
            setIncomePage(1);
            setExpensePage(1);
            setReagentPage(1);
          }}
          onRefresh={() => { void refreshAll(); }}
          refreshing={Boolean(
            isFetching
            || cashBreakdownFetching
            || expenseBreakdownFetching
            || executiveKpis.summaryQuery.isFetching
            || executiveAnalytics.doctorPerformance.isFetching
            || executiveAnalytics.testPerformance.isFetching
            || executiveAnalytics.incomeServices.isFetching
            || executiveAnalytics.expenseAnalysis.isFetching
            || executiveAnalytics.reagentReconciliation.isFetching
          )}
          lastRefreshedAt={lastRefreshedAt}
        />
      </div>

      <section className="card p-4 sm:p-5" data-testid="admin-management-overview">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Management dashboard</p>
            <h2 className="section-title mt-1">Income, expense, and doctor commission controls</h2>
            <p className="section-subtitle mt-1">Every card total is loaded from the same server calculation used by its drilldown.</p>
          </div>
          <DashboardKpiConfigurator items={executiveKpis.allItems} queryKeyScope="admin" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {managementCards.map((card, index) => (
            <KPICard
              key={card.metricKey}
              title={card.label}
              value={card.value}
              icon={card.icon}
              iconBg={card.iconBg}
              loading={card.loading || executiveKpis.configQuery.isLoading}
              index={index}
              onClick={() => { setSelectedKpi({ metric: card.metricKey, title: card.label }); setDrilldownPage(1); }}
              active={selectedKpi?.metric === card.metricKey}
              ariaLabel={`Open ${card.label} drilldown`}
              detailHint="Drill down"
              testId={`kpi-${card.metricKey.replace(/_/g, '-')}`}
            />
          ))}
        </div>
      </section>

      {executiveKpis.doctorPerformancePanels.length > 0 ? (
        <DoctorPerformancePanel
          data={executiveAnalytics.doctorPerformance.data}
          loading={executiveAnalytics.doctorPerformance.isLoading}
          error={executiveAnalytics.doctorPerformance.isError}
          sortBy={doctorSortBy}
          onDoctorOpen={setSelectedDoctor}
          onPageChange={setDoctorPage}
          onSortChange={(value) => { setDoctorSortBy(value); setDoctorPage(1); }}
        />
      ) : null}

      {executiveKpis.testPerformancePanels.length > 0 ? (
        <TestPerformancePanel
          data={executiveAnalytics.testPerformance.data}
          loading={executiveAnalytics.testPerformance.isLoading}
          error={executiveAnalytics.testPerformance.isError}
          search={filters.testSearch ?? ''}
          sortBy={testSortBy}
          onSearchChange={(value) => { onFiltersChange((current) => ({ ...current, testSearch: value })); setTestPage(1); }}
          onTestOpen={setSelectedTest}
          onPageChange={setTestPage}
          onSortChange={(value) => { setTestSortBy(value); setTestPage(1); }}
        />
      ) : null}

      {executiveKpis.incomeAnalysisPanels.length > 0 ? (
        <IncomeServicePanel
          data={executiveAnalytics.incomeServices.data}
          loading={executiveAnalytics.incomeServices.isLoading}
          error={executiveAnalytics.incomeServices.isError}
          onRetry={() => { void executiveAnalytics.incomeServices.refetch(); }}
          onPageChange={setIncomePage}
        />
      ) : null}

      {executiveKpis.expenseAnalysisPanels.length > 0 ? (
        <ExpenseAnalysisPanel
          data={executiveAnalytics.expenseAnalysis.data}
          loading={executiveAnalytics.expenseAnalysis.isLoading}
          error={executiveAnalytics.expenseAnalysis.isError}
          onRetry={() => { void executiveAnalytics.expenseAnalysis.refetch(); }}
          onPageChange={setExpensePage}
        />
      ) : null}

      <section className="card p-4 sm:p-5" data-testid="admin-cash-control-overview">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Cash control</p>
          <h2 className="section-title mt-1">Physical cash position</h2>
          <p className="section-subtitle mt-1">Cash in, net drawer movement, and available drawer cash are kept separate from accounting income.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {cashControlCards.map((card, index) => (
            <KPICard
              key={card.metricKey}
              title={card.label}
              value={card.value}
              icon={card.icon}
              iconBg={card.iconBg}
              loading={card.loading || executiveKpis.configQuery.isLoading}
              index={index}
              onClick={() => { setSelectedKpi({ metric: card.metricKey, title: card.label }); setDrilldownPage(1); }}
              active={selectedKpi?.metric === card.metricKey}
              ariaLabel={`Open ${card.label} drilldown`}
              detailHint="Drill down"
              testId={`kpi-${card.metricKey.replace(/_/g, '-')}`}
            />
          ))}
        </div>
      </section>

      {operationalSections.map((section) => (
        <section key={section.key} className="card p-4 sm:p-5" data-testid={`admin-${section.key.replace(/_/g, '-')}-overview`}>
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Operational monitoring</p>
            <h2 className="section-title mt-1">{section.title}</h2>
            <p className="section-subtitle mt-1">{section.description}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {section.cards.map((card, index) => (
              <KPICard
                key={card.metricKey}
                title={card.label}
                value={card.value}
                icon={card.icon}
                iconBg={card.iconBg}
                loading={card.loading || executiveKpis.configQuery.isLoading}
                index={index}
                onClick={() => { setSelectedKpi({ metric: card.metricKey, title: card.label }); setDrilldownPage(1); }}
                active={selectedKpi?.metric === card.metricKey}
                ariaLabel={`Open ${card.label} drilldown`}
                detailHint="Drill down"
                testId={`kpi-${card.metricKey.replace(/_/g, '-')}`}
              />
            ))}
          </div>
        </section>
      ))}

      <section className="card p-4 sm:p-5" data-testid="admin-operations-summary">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Operations monitor</p>
          <h2 className="section-title mt-1">Patient and activity summary</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {operationsCards.map((card, index) => (
            <KPICard
              key={card.title}
              title={card.title}
              value={card.value}
              icon={card.icon}
              iconBg={card.iconBg}
              loading={isLoading}
              index={index}
              onClick={card.metric ? () => { setSelectedKpi({ metric: card.metric, title: card.title }); setDrilldownPage(1); } : undefined}
              active={selectedKpi?.metric === card.metric}
              ariaLabel={card.metric ? `Open ${card.title} drilldown` : card.title}
              detailHint={card.metric ? 'Drill down' : undefined}
            />
          ))}
        </div>
      </section>

      <CashBreakdownBox
        cashData={cashBreakdownData}
        expenseData={expenseBreakdownData}
        cashLoading={cashBreakdownLoading}
        expenseLoading={expenseBreakdownLoading}
        t={t}
        onOpenMetric={(metric, title, sourceLabel) => { setSelectedKpi({ metric, title, sourceLabel }); setDrilldownPage(1); }}
      />

      {executiveKpis.labReagentPanels.length > 0 ? (
        <ReagentReconciliationPanel
          data={executiveAnalytics.reagentReconciliation.data}
          loading={executiveAnalytics.reagentReconciliation.isLoading}
          error={executiveAnalytics.reagentReconciliation.isError}
          onRetry={() => { void executiveAnalytics.reagentReconciliation.refetch(); }}
          onPageChange={setReagentPage}
        />
      ) : null}

      {stockSections.map((section) => (
        <section key={section.key} className="card p-4 sm:p-5" data-testid={`admin-${section.key.replace(/_/g, '-')}-overview`}>
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Stock monitoring</p>
            <h2 className="section-title mt-1">{section.title}</h2>
            <p className="section-subtitle mt-1">{section.description}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {section.cards.map((card, index) => (
              <KPICard
                key={card.metricKey}
                title={card.label}
                value={card.value}
                icon={card.icon}
                iconBg={card.iconBg}
                loading={card.loading || executiveKpis.configQuery.isLoading}
                index={index}
                onClick={() => { setSelectedKpi({ metric: card.metricKey, title: card.label }); setDrilldownPage(1); }}
                active={selectedKpi?.metric === card.metricKey}
                ariaLabel={`Open ${card.label} drilldown`}
                detailHint="Drill down"
                testId={`kpi-${card.metricKey.replace(/_/g, '-')}`}
              />
            ))}
          </div>
        </section>
      ))}

      <DoctorPerformanceDrawer
        doctor={selectedDoctor}
        filters={filters}
        queryKeyScope="admin"
        onClose={() => setSelectedDoctor(null)}
      />
      <TestPerformanceDrawer
        test={selectedTest}
        filters={filters}
        queryKeyScope="admin"
        onClose={() => setSelectedTest(null)}
      />

      {selectedKpi ? (
        <KpiBreakdownDrawer
          title={selectedKpi.doctorLabel ? `${selectedKpi.doctorLabel} — ${selectedKpi.title}` : selectedKpi.title}
          data={selectedBreakdownQuery.data}
          loading={selectedBreakdownQuery.isLoading}
          error={selectedBreakdownQuery.isError}
          formulaNote={kpiFormulaNote(selectedKpi.metric)}
          labels={{
            close: safeT(t, 'adminDashboard.kpi.closeBreakdown', 'Close'),
            sources: safeT(t, 'adminDashboard.kpi.breakdownSources', 'Sources'),
            details: safeT(t, 'adminDashboard.kpi.breakdownDetails', 'Details'),
            noRows: safeT(t, 'adminDashboard.kpi.breakdownEmpty', 'No rows found'),
            rows: safeT(t, 'adminDashboard.kpi.rows', 'rows'),
            invoiceRows: safeT(t, 'adminDashboard.kpi.invoiceRows', 'invoices'),
            viewInvoices: safeT(t, 'adminDashboard.kpi.viewInvoices', 'View invoices'),
            showAllDoctors: safeT(t, 'adminDashboard.kpi.showAllDoctors', 'Show all doctors'),
          }}
          onClose={() => setSelectedKpi(null)}
          onSourceClick={isCommissionBreakdownMetric(selectedKpi.metric) && !selectedKpi.doctorId ? (source: KpiBreakdownSource) => {
            const doctorId = Number(source.doctorId ?? source.key);
            if (!Number.isInteger(doctorId) || doctorId <= 0) return;
            setSelectedKpi({
              metric: selectedKpi.metric,
              title: selectedKpi.title,
              doctorId,
              doctorLabel: source.label,
            });
            setDrilldownPage(1);
          } : undefined}
          onClearSourceFilter={selectedKpi.doctorId ? () => {
            setSelectedKpi({ metric: selectedKpi.metric, title: selectedKpi.title });
            setDrilldownPage(1);
          } : undefined}
          onRowClick={(row: KpiBreakdownRow) => { if (row.billId) invoiceInspector.openInvoice(row.billId); }}
          onPageChange={(page, pageSize) => { setDrilldownPage(page); setDrilldownPageSize(pageSize); }}
        />
      ) : null}
      {invoiceInspector.billId ? (
        <AdminKpiInvoiceModal billId={invoiceInspector.billId} onClose={invoiceInspector.closeInvoice} />
      ) : null}
    </>
  );
}

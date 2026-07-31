import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Banknote, BedDouble, Clock, HandCoins, Monitor, Percent, ShieldAlert, TrendingUp, Wallet, WalletCards, ClipboardList, DollarSign, FlaskConical, Stethoscope, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import KPICard from './KPICard';
import KpiBreakdownDrawer, { type KpiBreakdownData, type KpiBreakdownRow } from './KpiBreakdownDrawer';
import AdminKpiInvoiceModal from './AdminKpiInvoiceModal';
import { useInvoiceInspectorState } from '../invoice-inspector/useInvoiceInspectorState';
import DashboardKpiConfigurator from './DashboardKpiConfigurator';
import DoctorPerformancePanel from './DoctorPerformancePanel';
import DoctorPerformanceDrawer from './DoctorPerformanceDrawer';
import TestPerformancePanel from './TestPerformancePanel';
import TestPerformanceDrawer from './TestPerformanceDrawer';
import IncomeServicePanel from './IncomeServicePanel';
import ExpenseAnalysisPanel from './ExpenseAnalysisPanel';
import ReagentReconciliationPanel from './ReagentReconciliationPanel';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useExecutiveDashboardAnalytics } from '../../hooks/useExecutiveDashboardAnalytics';
import { executiveDashboardMetricValueType, useExecutiveDashboardKpis, type ExecutiveDashboardCardMetric, type ExecutiveDashboardMetric } from '../../hooks/useExecutiveDashboardKpis';
import type {
  DoctorPerformanceRow,
  DoctorSort,
  ExecutiveDashboardFilters,
  TestPerformanceRow,
  TestSort,
} from '../../types/executiveDashboard';
import { formatCurrency } from '../../lib/format';
import { displayKpiSourceLabel, kpiFormulaNote, safeT } from '../../lib/kpiLabels';

export type ExecutiveKpiMetric =
  | ExecutiveDashboardCardMetric
  | 'billing_collection'
  | 'due_collection'
  | 'deposit_collection'
  | 'accounting_expenses'
  | 'patient_due'
  | 'total_discount'
  | 'pending_handover'
  | 'patient_advance'
  | 'pending_posting'
  | 'cash_movement'
  | 'doctor_payout';

type SelectedKpi = { metric: ExecutiveKpiMetric; title: string; valueType?: 'money' | 'count'; sourceLabel?: string };
type KpiSource = KpiBreakdownData['sources'][number];

interface DashboardStatsResponse {
  todaySummary?: {
    totalDiscount?: number;
    admittedPatients?: number;
  };
  patientSummary?: {
    opdPatients?: number;
  };
  finance?: {
    todayCollection?: number;
    todayExpense?: number;
    todayDeposit?: number;
    pendingHandoverAmount?: number;
    pendingHandoverCount?: number;
    patientDue?: number;
    patientAdvance?: number;
    pendingPostingEvents?: number;
  };
}

interface Props {
  querySuffix?: string;
  queryKeyScope: 'md' | 'director';
  filters: ExecutiveDashboardFilters;
  snapshotDate?: string;
  title?: string;
  subtitle?: string;
  handoverPath?: string;
}

const fmtBDT = (n: number) => formatCurrency(n, { fractionDigits: 0 });

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
    case 'consumption_exceptions': return { icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-rose-50 text-rose-700' };
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
  return valueType === 'count' ? total.toLocaleString() : fmtBDT(total);
}

function appendQuery(path: string, suffix = ''): string {
  if (!suffix) return path;
  return `${path}${suffix.replace(/^\?/, '&')}`;
}

function sourceDetailTarget(source: KpiSource): { metric: ExecutiveKpiMetric; sourceLabel?: string } {
  const label = source.label;
  if (label === 'mdDashboard.kpi.cashMovementSourceVisit') return { metric: 'opd_income' };
  if (label === 'mdDashboard.kpi.cashMovementSourceTest') return { metric: 'lab_income' };
  if (label === 'mdDashboard.kpi.cashMovementSourceRadiology') return { metric: 'radiology_income' };
  if (label === 'mdDashboard.kpi.cashMovementSourceAdmission') return { metric: 'ipd_collection' };
  if (label === 'mdDashboard.kpi.cashMovementSourceOperation') return { metric: 'ot_income' };
  if (label === 'mdDashboard.kpi.cashMovementSourceMedicine') return { metric: 'pharmacy_income' };
  if (label === 'mdDashboard.kpi.cashMovementSourceOtherService') return { metric: 'uncategorized_income' };
  if (label.includes('DueCollection')) return { metric: 'due_collection' };
  if (label.includes('Deposit')) return { metric: 'deposit_collection' };
  if (label.includes('Expense')) return { metric: 'accounting_expenses' };
  if (label.includes('Payout')) return { metric: 'doctor_payout' };
  return { metric: source.amount < 0 ? 'accounting_expenses' : 'billing_collection' };
}

function sourceMeaning(source: KpiSource): string {
  const label = source.label;
  if (label.includes('DueCollection')) return 'Old invoice cash collected in this period.';
  if (label.includes('Deposit')) return 'Patient advance/deposit cash received.';
  if (label.includes('Expense')) return 'Approved operating cash paid out.';
  if (label.includes('Payout')) return 'Doctor payout or similar cash-out movement.';
  if (label.includes('SourceTest')) return 'Lab/test bill collection.';
  if (label.includes('SourceVisit')) return 'Doctor visit bill collection.';
  if (label.includes('SourceAdmission')) return 'Admission/IPD bill collection.';
  if (label.includes('SourceOperation')) return 'OT/procedure bill collection.';
  if (label.includes('SourceMedicine')) return 'Medicine bill collection.';
  return source.amount < 0 ? 'Cash-out transaction source.' : 'Cash-in transaction source.';
}

export default function ExecutiveControlKpis({ querySuffix = '', queryKeyScope, filters, snapshotDate, title, subtitle, handoverPath }: Props) {
  const { t } = useTranslation(['dashboard', 'common']);
  const [selectedKpi, setSelectedKpi] = useState<SelectedKpi | null>(null);
  const invoiceInspector = useInvoiceInspectorState();
  const [doctorPage, setDoctorPage] = useState(1);
  const [doctorSortBy, setDoctorSortBy] = useState<DoctorSort>('payableCommission');
  const [testPage, setTestPage] = useState(1);
  const [testSortBy, setTestSortBy] = useState<TestSort>('quantity');
  const [testSearch, setTestSearch] = useState('');
  const [incomePage, setIncomePage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const [reagentPage, setReagentPage] = useState(1);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorPerformanceRow | null>(null);
  const [selectedTest, setSelectedTest] = useState<TestPerformanceRow | null>(null);

  useEffect(() => {
    setDoctorPage(1);
    setTestPage(1);
    setIncomePage(1);
    setExpensePage(1);
    setReagentPage(1);
  }, [filters.preset, filters.startDate, filters.endDate]);

  const analyticsFilters = useMemo(() => ({ ...filters, testSearch }), [filters, testSearch]);
  const statsDate = snapshotDate ?? filters.endDate;
  const statsPath = `/api/dashboard/stats?date=${encodeURIComponent(statsDate)}`;
  const statsQ = useApiQuery<DashboardStatsResponse>([queryKeyScope, 'executive-control', 'stats', statsDate], statsPath, { refetchInterval: 60_000 });
  const executiveKpis = useExecutiveDashboardKpis(queryKeyScope, querySuffix);
  const enabledPanels = useMemo<Set<ExecutiveDashboardMetric>>(
    () => new Set(executiveKpis.panelItems.map((item) => item.metricKey)),
    [executiveKpis.panelItems],
  );
  const executiveAnalytics = useExecutiveDashboardAnalytics({
    queryKeyScope,
    filters: analyticsFilters,
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
  const analyticsLoading = executiveAnalytics.doctorPerformance.isLoading
    || executiveAnalytics.testPerformance.isLoading
    || executiveAnalytics.incomeServices.isLoading
    || executiveAnalytics.expenseAnalysis.isLoading
    || executiveAnalytics.reagentReconciliation.isLoading;
  const cashMovementQ = useApiQuery<KpiBreakdownData>(
    [queryKeyScope, 'executive-control', 'cash-movement', querySuffix || 'today'],
    appendQuery('/api/dashboard/kpi-breakdown?metric=cash_movement&pageSize=50', querySuffix),
    { refetchInterval: 60_000 },
  );

  const selectedMetric = selectedKpi?.metric ?? 'cash_received';
  const selectedSourceQuery = selectedKpi?.sourceLabel ? `&sourceLabel=${encodeURIComponent(selectedKpi.sourceLabel)}` : '';
  const selectedBreakdownPath = appendQuery(`/api/dashboard/kpi-breakdown?metric=${encodeURIComponent(selectedMetric)}${selectedSourceQuery}`, querySuffix);
  const selectedBreakdownQ = useApiQuery<KpiBreakdownData>(
    [queryKeyScope, 'executive-control', 'drilldown', selectedMetric, selectedKpi?.sourceLabel ?? 'all', querySuffix || 'today'],
    selectedBreakdownPath,
    { enabled: Boolean(selectedKpi) },
  );

  const stats = statsQ.data;
  const cashSources = cashMovementQ.data?.sources ?? [];
  const cashIn = cashSources.reduce((sum, source) => sum + Math.max(0, Number(source.amount ?? 0)), 0);
  const cashOut = cashSources.reduce((sum, source) => sum + Math.abs(Math.min(0, Number(source.amount ?? 0))), 0);
  const netCashMovement = Number(cashMovementQ.data?.total ?? cashIn - cashOut);

  const openKpi = (metric: ExecutiveKpiMetric, kpiTitle: string, valueType?: 'money' | 'count', sourceLabel?: string) => {
    setSelectedKpi({ metric, title: kpiTitle, valueType, sourceLabel });
  };

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

  const actionCards = useMemo(() => [
    { title: safeT(t, 'adminDashboard.kpi.outstandingDue', 'Outstanding patient due'), value: fmtBDT(stats?.finance?.patientDue ?? 0), icon: <Wallet className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-600', metric: 'patient_due' as const },
    { title: safeT(t, 'adminDashboard.kpi.todayDiscount', 'Discount given'), value: fmtBDT(stats?.todaySummary?.totalDiscount ?? 0), icon: <Percent className="w-5 h-5" />, iconBg: 'bg-purple-50 text-purple-600', metric: 'total_discount' as const },
    { title: safeT(t, 'mdDashboard.exec.pendingHandover', 'Pending handover cash'), value: fmtBDT(stats?.finance?.pendingHandoverAmount ?? 0), icon: <Clock className="w-5 h-5" />, iconBg: 'bg-orange-50 text-orange-600', metric: 'pending_handover' as const },
    { title: safeT(t, 'mdDashboard.exec.patientAdvance', 'Patient advance liability'), value: fmtBDT(stats?.finance?.patientAdvance ?? 0), icon: <TrendingUp className="w-5 h-5" />, iconBg: 'bg-blue-50 text-blue-600', metric: 'patient_advance' as const },
    { title: safeT(t, 'mdDashboard.exec.pendingPosting', 'Accounting posting queue'), value: stats?.finance?.pendingPostingEvents ?? 0, icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-purple-50 text-purple-600', metric: 'pending_posting' as const, valueType: 'count' as const },
  ], [stats?.finance?.patientAdvance, stats?.finance?.patientDue, stats?.finance?.pendingHandoverAmount, stats?.finance?.pendingPostingEvents, stats?.todaySummary?.totalDiscount, t]);
  const pendingHandoverAmount = Number(stats?.finance?.pendingHandoverAmount ?? 0);
  const pendingHandoverCount = Number(stats?.finance?.pendingHandoverCount ?? 0);

  return (
    <section
      className="space-y-4"
      data-testid={`${queryKeyScope}-executive-control-kpis`}
      data-analytics-loading={analyticsLoading ? 'true' : 'false'}
    >
      <div className="card p-4 sm:p-5" data-testid={`${queryKeyScope}-admin-style-executive-kpis`}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Management dashboard</p>
            <h2 className="section-title mt-1">{title ?? 'Executive management KPIs'}</h2>
            <p className="section-subtitle mt-1">{subtitle ?? 'Collection, expense, net income, lab, and doctor commission cards use reconciled server totals.'}</p>
          </div>
          <DashboardKpiConfigurator items={executiveKpis.allItems} queryKeyScope={queryKeyScope} />
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
              onClick={() => openKpi(card.metricKey, card.label, card.valueType)}
              active={selectedKpi?.metric === card.metricKey}
              ariaLabel={`Open ${card.label} drilldown`}
              detailHint="Drill down"
              testId={`kpi-${card.metricKey.replace(/_/g, '-')}`}
            />
          ))}
        </div>
      </div>

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
          search={testSearch}
          sortBy={testSortBy}
          onSearchChange={(value) => { setTestSearch(value); setTestPage(1); }}
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

      <div className="card p-4 sm:p-5" data-testid={`${queryKeyScope}-cash-control-kpis`}>
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Cash control</p>
          <h2 className="section-title mt-1">Physical cash position</h2>
          <p className="section-subtitle mt-1">Physical cash in, net drawer movement, and available drawer cash remain separate from accounting income.</p>
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
              onClick={() => openKpi(card.metricKey, card.label)}
              active={selectedKpi?.metric === card.metricKey}
              ariaLabel={`Open ${card.label} drilldown`}
              detailHint="Drill down"
              testId={`kpi-${card.metricKey.replace(/_/g, '-')}`}
            />
          ))}
        </div>
      </div>

      {operationalSections.map((section) => (
        <div key={section.key} className="card p-4 sm:p-5" data-testid={`${queryKeyScope}-${section.key.replace(/_/g, '-')}-kpis`}>
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
                onClick={() => openKpi(card.metricKey, card.label, card.valueType)}
                active={selectedKpi?.metric === card.metricKey}
                ariaLabel={`Open ${card.label} drilldown`}
                detailHint="Drill down"
                testId={`kpi-${card.metricKey.replace(/_/g, '-')}`}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="card border-amber-200 bg-amber-50/40 p-4 sm:p-5" data-testid={`${queryKeyScope}-handover-receive-panel`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-100 p-2 text-amber-700"><HandCoins className="h-5 w-5" aria-hidden="true" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Handover receive</p>
              <h3 className="mt-1 text-lg font-bold text-[var(--color-text-primary)]">Pending receptionist cash handover</h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Receiver should count physical cash, receive full or partial amount, record remarks/dispute, then verify custody.</p>
            </div>
          </div>
          <div className="grid min-w-full grid-cols-2 gap-3 text-right sm:min-w-[320px]">
            <div className="rounded-xl border border-amber-200 bg-white/70 p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Pending amount</p>
              <p className="mt-1 font-data text-xl font-bold text-amber-800">{statsQ.isLoading ? '—' : fmtBDT(pendingHandoverAmount)}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white/70 p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Pending handovers</p>
              <p className="mt-1 font-data text-xl font-bold text-amber-800">{statsQ.isLoading ? '—' : pendingHandoverCount.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={() => openKpi('pending_handover', 'Pending handover cash')}>Open drilldown</button>
          {handoverPath ? <Link to={handoverPath} className="btn-primary">Receive cash handover</Link> : null}
          <span className="text-xs text-[var(--color-text-muted)]">Best practice: no handover is complete without receiver confirmation, amount evidence, and variance reason.</span>
        </div>
      </div>

      <div className="card p-4 sm:p-5" data-testid={`${queryKeyScope}-admin-style-cash-control`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Cash breakdown</p>
            <h3 className="section-title mt-1">Cash in, cash out, and source drilldown</h3>
            <p className="section-subtitle mt-1">Click any source to open invoice, patient, collector, expense, payout, or deposit details.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right text-xs">
            <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2"><p className="text-[var(--color-text-muted)]">Cash in</p><p className="font-data font-bold text-emerald-700">{fmtBDT(cashIn)}</p></div>
            <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2"><p className="text-[var(--color-text-muted)]">Cash out</p><p className="font-data font-bold text-red-700">{fmtBDT(cashOut)}</p></div>
            <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2"><p className="text-[var(--color-text-muted)]">Net</p><p className="font-data font-bold text-[var(--color-text-primary)]">{fmtBDT(netCashMovement)}</p></div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {cashMovementQ.isLoading ? (
            <><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-24 rounded-xl" /></>
          ) : cashSources.length ? cashSources.map((source) => {
            const target = sourceDetailTarget(source);
            const label = displayKpiSourceLabel(source.label);
            return (
              <button
                key={source.label}
                type="button"
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-left transition hover:border-[var(--color-primary)] hover:shadow-sm"
                onClick={() => openKpi(target.metric, `${label} details`, 'money', target.sourceLabel)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--color-text-primary)]">{label}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{source.count.toLocaleString()} rows · {sourceMeaning(source)}</p>
                  </div>
                  <p className="shrink-0 font-data font-bold text-[var(--color-text-primary)]">{fmtBDT(source.amount)}</p>
                </div>
                <p className="mt-2 text-[0.7rem] font-semibold text-[var(--color-primary)]">Open transaction details →</p>
              </button>
            );
          }) : (
            <p className="rounded-xl border border-dashed border-[var(--color-border)] p-4 text-center text-sm text-[var(--color-text-muted)] lg:col-span-2">No cash movement found for this period.</p>
          )}
        </div>
      </div>

      <div className="card p-4 sm:p-5" data-testid="executive-accounting-kpis">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Accounting & review queue</p>
          <h3 className="section-title mt-1">Accounting-specific KPIs</h3>
          <p className="section-subtitle mt-1">These stay below the main cash-control KPIs so the top dashboard remains operationally clear.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {actionCards.map((card, index) => (
            <KPICard
              key={card.metric}
              title={card.title}
              value={card.value}
              icon={card.icon}
              iconBg={card.iconBg}
              loading={statsQ.isLoading}
              index={index}
              onClick={() => openKpi(card.metric, card.title, card.valueType)}
              active={selectedKpi?.metric === card.metric}
              ariaLabel={`Open ${card.title} drilldown`}
              detailHint="Drill down"
              testId={`kpi-${card.metric.replace(/_/g, '-')}`}
            />
          ))}
        </div>
      </div>

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
        <div key={section.key} className="card p-4 sm:p-5" data-testid={`${queryKeyScope}-${section.key.replace(/_/g, '-')}-kpis`}>
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
                onClick={() => openKpi(card.metricKey, card.label, card.valueType)}
                active={selectedKpi?.metric === card.metricKey}
                ariaLabel={`Open ${card.label} drilldown`}
                detailHint="Drill down"
                testId={`kpi-${card.metricKey.replace(/_/g, '-')}`}
              />
            ))}
          </div>
        </div>
      ))}

      <DoctorPerformanceDrawer
        doctor={selectedDoctor}
        filters={filters}
        queryKeyScope={queryKeyScope}
        onClose={() => setSelectedDoctor(null)}
        onInvoiceOpen={invoiceInspector.openInvoice}
      />
      <TestPerformanceDrawer
        test={selectedTest}
        filters={filters}
        queryKeyScope={queryKeyScope}
        onClose={() => setSelectedTest(null)}
        onInvoiceOpen={invoiceInspector.openInvoice}
      />

      {selectedKpi ? (
        <KpiBreakdownDrawer
          title={selectedKpi.title}
          data={selectedBreakdownQ.data}
          loading={selectedBreakdownQ.isLoading}
          error={selectedBreakdownQ.isError}
          formulaNote={kpiFormulaNote(selectedKpi.metric)}
          labels={{
            close: safeT(t, 'adminDashboard.kpi.closeBreakdown', 'Close'),
            sources: safeT(t, 'adminDashboard.kpi.breakdownSources', 'Sources'),
            details: safeT(t, 'adminDashboard.kpi.breakdownDetails', 'Details'),
            noRows: safeT(t, 'adminDashboard.kpi.breakdownEmpty', 'No rows found'),
          }}
          onClose={() => setSelectedKpi(null)}
          onRowClick={(row: KpiBreakdownRow) => {
            if (row.billId) invoiceInspector.openInvoice(row.billId);
          }}
        />
      ) : null}
      {invoiceInspector.billId ? (
        <AdminKpiInvoiceModal billId={invoiceInspector.billId} onClose={invoiceInspector.closeInvoice} />
      ) : null}
    </section>
  );
}

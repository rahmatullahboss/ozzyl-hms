import { Hono } from 'hono';
import { requireTenantId } from '../../lib/context-helpers';
import { getPermissionsForRole } from '../../lib/authz';
import { getDb } from '../../db';
import type { Env, Variables } from '../../types';
import { getGlBreakdown, getGlIncomeExpenseTotals } from '../../lib/accounting-reporting';
import { getTodayGMT6 } from '../../lib/date-utils';
import { resolveExecutiveDashboardPeriod } from '../../lib/executive-dashboard-period';
import {
  getExecutiveCommissionBreakdown,
  getExecutiveCommissionTotals,
  isExecutiveCommissionMetric,
} from '../../lib/executive-commission-analytics';
import {
  getDoctorPerformance,
  getDoctorPerformanceDetails,
  type DoctorPerformanceDetailsTab,
  type DoctorPerformanceSort,
  type DoctorPerformanceSortDirection,
} from '../../services/dashboard/doctorPerformance';
import { getDoctorActivity } from '../../services/dashboard/doctorActivity';
import {
  getTestPerformance,
  getTestPerformanceDetails,
  type TestPerformanceDetailView,
  type TestPerformanceSort,
  type TestPerformanceSortDirection,
} from '../../lib/executive-test-analytics';
import {
  executivePaymentAllocationCte,
  getIncomeServiceAnalysis,
  type IncomeServiceCategory,
  type IncomeServiceSort,
  type IncomeServiceSortDirection,
} from '../../lib/executive-income-analytics';
import {
  getExpenseAnalysis,
  type ExpenseAnalysisSort,
  type ExpenseAnalysisSortDirection,
} from '../../lib/executive-expense-analytics';
import { getReagentReconciliation } from '../../lib/executive-reagent-analytics';
import { getIpdCollectionBreakdown } from '../../lib/ipd-finance-reporting';
import { requireRole } from '../../middleware/rbac';
import { buildAuditBillStateSelect } from '../../lib/audit-bill-state';
import {
  getExecutiveInventoryKpiBreakdown,
  getExecutiveInventoryKpiSummary,
  isExecutiveInventoryMetric,
  type ExecutiveInventoryDetailRow,
  type ExecutiveInventoryMetric,
} from '../../lib/executive-inventory-kpis';
import { assembleAdminDashboardOverview, type DashboardOverviewProvider } from '../../lib/dashboard/admin-overview';
import {
  isAdminCommandCenterEnabled,
  isAdminCommandCenterPreviewHostname,
  isAdminCommandCenterPreviewMode,
} from '../../lib/dashboard/admin-command-center-flag';
import { resolveDashboardFilterContext } from '../../lib/dashboard/filter-context';
import { buildDashboardReconciliation } from '../../lib/dashboard/reconciliation';
import { resolveDashboardSourceStatus } from '../../lib/dashboard/source-status';
import {
  assembleFinancialControl,
  loadFinancialCollectionSplit,
} from '../../services/dashboard/financialControl';
import { getDashboardPaymentMethodBreakdown } from '../../services/dashboard/paymentMethodBreakdown';
import { PATIENT_AGE_BUCKET_ORDER, type PatientAgeBucket } from '../../services/dashboard/patientAge';
import {
  getPatientAgeAggregateDetails,
  getPatientAgeAnalytics,
  getPatientAgePatientDetails,
  type PatientAgeAggregateDetailView,
  type PatientAgeDetailSort,
  type PatientAgeDetailSortDirection,
} from '../../services/dashboard/patientAgeAnalytics';
import {
  getDashboardFinancialTrend,
  type FinancialTrendSeries,
} from '../../services/dashboard/financialTrend';
import type {
  DashboardComparisonMode,
  DashboardMetricDefinition,
  DashboardMetricResult,
  DashboardRolePreset,
  DashboardWarning,
} from '../../../packages/shared/src/dashboard';


const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const ADMIN_DASHBOARD_ROLES = ['hospital_admin', 'md', 'director', 'manager', 'accountant'] as const;
const adminGuard = requireRole(...ADMIN_DASHBOARD_ROLES);
const dashboardConfigWriteGuard = requireRole('hospital_admin', 'md', 'director');
const DOCTOR_PERFORMANCE_SORTS = new Set<DoctorPerformanceSort>([
  'visits',
  'tests',
  'visitCollection',
  'testCollection',
  'testDiscount',
  'earnedCommission',
  'payableCommission',
  'outstandingCommission',
  'totalCommission',
]);
const DOCTOR_PERFORMANCE_DIRECTIONS = new Set<DoctorPerformanceSortDirection>(['asc', 'desc']);
const DOCTOR_PERFORMANCE_TABS = new Set<DoctorPerformanceDetailsTab>([
  'visits',
  'tests',
  'referred-tests',
  'performed-tests',
  'commissions',
]);
const DOCTOR_PERFORMANCE_PAGE_SIZES = new Set([10, 25, 50, 100]);
const TEST_PERFORMANCE_SORTS = new Set<TestPerformanceSort>(['quantity', 'billed', 'collected', 'due', 'testCommission']);
const TEST_PERFORMANCE_DIRECTIONS = new Set<TestPerformanceSortDirection>(['asc', 'desc']);
const TEST_PERFORMANCE_DETAIL_VIEWS = new Set<TestPerformanceDetailView>(['lines', 'referred', 'performed']);
const INCOME_SERVICE_CATEGORIES = new Set<IncomeServiceCategory>(['all', 'lab', 'non_lab']);
const INCOME_SERVICE_SORTS = new Set<IncomeServiceSort>(['collection', 'transactions', 'units', 'serviceName']);
const INCOME_SERVICE_DIRECTIONS = new Set<IncomeServiceSortDirection>(['asc', 'desc']);
const EXPENSE_ANALYSIS_SORTS = new Set<ExpenseAnalysisSort>(['paidAmount', 'transactions', 'category']);
const EXPENSE_ANALYSIS_DIRECTIONS = new Set<ExpenseAnalysisSortDirection>(['asc', 'desc']);

const EXECUTIVE_DASHBOARD_KEY = 'executive';
type ExecutiveDashboardSection =
  | 'management'
  | 'doctor_performance'
  | 'test_performance'
  | 'income_analysis'
  | 'expense_analysis'
  | 'cash_control'
  | 'approvals'
  | 'inventory'
  | 'lab_reagent'
  | 'radiology_stock';
type ExecutivePanelMetric =
  | 'doctor_performance_table'
  | 'test_volume_table'
  | 'income_service_breakdown'
  | 'expense_source_breakdown'
  | 'reagent_reconciliation_table';
type ExecutiveDashboardMetricKey = KpiBreakdownMetric | ExecutivePanelMetric;
type ExecutiveDashboardRegistryItem = {
  metricKey: ExecutiveDashboardMetricKey;
  label: string;
  section: ExecutiveDashboardSection;
  kind: 'card' | 'panel';
  defaultEnabled: boolean;
  position: number;
};

const EXECUTIVE_KPI_REGISTRY = [
  { metricKey: 'accounting_income', label: 'Total Collection', section: 'management', kind: 'card', defaultEnabled: true, position: 0 },
  { metricKey: 'accounting_expenses', label: 'Total Expense', section: 'management', kind: 'card', defaultEnabled: true, position: 1 },
  { metricKey: 'accounting_profit', label: 'Net Income', section: 'management', kind: 'card', defaultEnabled: true, position: 2 },
  { metricKey: 'opd_income', label: 'OPD / Doctor Visit Collection', section: 'management', kind: 'card', defaultEnabled: true, position: 3 },
  { metricKey: 'lab_income', label: 'Diagnostic / Laboratory Collection', section: 'management', kind: 'card', defaultEnabled: true, position: 4 },
  { metricKey: 'ipd_collection', label: 'IPD / Admitted Patient Collection', section: 'management', kind: 'card', defaultEnabled: true, position: 5 },
  { metricKey: 'ot_income', label: 'OT / Procedure Collection', section: 'management', kind: 'card', defaultEnabled: true, position: 6 },
  { metricKey: 'pharmacy_income', label: 'Pharmacy / Medicine Collection', section: 'management', kind: 'card', defaultEnabled: true, position: 7 },
  { metricKey: 'radiology_income', label: 'Radiology / Imaging Collection', section: 'management', kind: 'card', defaultEnabled: true, position: 8 },
  { metricKey: 'deposit_collection', label: 'Deposits / Advances', section: 'management', kind: 'card', defaultEnabled: true, position: 9 },
  { metricKey: 'uncategorized_income', label: 'Uncategorized Services', section: 'management', kind: 'card', defaultEnabled: true, position: 10 },
  { metricKey: 'visit_commission', label: 'Visit Commission', section: 'management', kind: 'card', defaultEnabled: true, position: 11 },
  { metricKey: 'test_commission', label: 'Test Commission', section: 'management', kind: 'card', defaultEnabled: true, position: 12 },
  { metricKey: 'total_commission', label: 'Total Doctor Commission', section: 'management', kind: 'card', defaultEnabled: true, position: 13 },
  { metricKey: 'other_doctor_commission', label: 'Other Doctor Commission', section: 'management', kind: 'card', defaultEnabled: true, position: 14 },
  { metricKey: 'doctor_performance_table', label: 'Doctor Performance', section: 'doctor_performance', kind: 'panel', defaultEnabled: true, position: 10 },
  { metricKey: 'total_visits', label: 'Total Visits', section: 'doctor_performance', kind: 'card', defaultEnabled: false, position: 11 },
  { metricKey: 'test_volume_table', label: 'Test Performance', section: 'test_performance', kind: 'panel', defaultEnabled: true, position: 20 },
  { metricKey: 'lab_tests_completed', label: 'Tests Completed', section: 'test_performance', kind: 'card', defaultEnabled: true, position: 21 },
  { metricKey: 'income_service_breakdown', label: 'Income by Service', section: 'income_analysis', kind: 'panel', defaultEnabled: true, position: 30 },
  { metricKey: 'expense_source_breakdown', label: 'Expense Analysis', section: 'expense_analysis', kind: 'panel', defaultEnabled: true, position: 40 },
  { metricKey: 'cash_received', label: 'Physical Cash In', section: 'cash_control', kind: 'card', defaultEnabled: true, position: 50 },
  { metricKey: 'cash_movement', label: 'Net Cash Movement', section: 'cash_control', kind: 'card', defaultEnabled: true, position: 51 },
  { metricKey: 'drawer_cash', label: 'Available Drawer Cash', section: 'cash_control', kind: 'card', defaultEnabled: true, position: 52 },
  { metricKey: 'pending_approvals', label: 'Pending Approvals', section: 'approvals', kind: 'card', defaultEnabled: true, position: 55 },
  { metricKey: 'inventory_stock_skus', label: 'Active Stock SKUs', section: 'inventory', kind: 'card', defaultEnabled: true, position: 70 },
  { metricKey: 'inventory_low_stock', label: 'Low-stock SKUs', section: 'inventory', kind: 'card', defaultEnabled: true, position: 71 },
  { metricKey: 'inventory_out_of_stock', label: 'Out-of-stock SKUs', section: 'inventory', kind: 'card', defaultEnabled: true, position: 72 },
  { metricKey: 'inventory_expiring_soon', label: 'Expiring Soon', section: 'inventory', kind: 'card', defaultEnabled: true, position: 73 },
  { metricKey: 'inventory_expired', label: 'Expired Lots', section: 'inventory', kind: 'card', defaultEnabled: true, position: 74 },
  { metricKey: 'inventory_pending_purchase', label: 'Pending Purchase Requests', section: 'inventory', kind: 'card', defaultEnabled: true, position: 75 },
  { metricKey: 'lab_reagent_consumed', label: 'Reagent Types Used', section: 'lab_reagent', kind: 'card', defaultEnabled: true, position: 80 },
  { metricKey: 'lab_reagent_stock_skus', label: 'Available Reagent SKUs', section: 'lab_reagent', kind: 'card', defaultEnabled: true, position: 81 },
  { metricKey: 'lab_reagent_low_stock', label: 'Low-stock Reagents', section: 'lab_reagent', kind: 'card', defaultEnabled: true, position: 82 },
  { metricKey: 'lab_reagent_out_of_stock', label: 'Out-of-stock Reagents', section: 'lab_reagent', kind: 'card', defaultEnabled: true, position: 83 },
  { metricKey: 'lab_reagent_expiring_soon', label: 'Reagent Lots Near Expiry', section: 'lab_reagent', kind: 'card', defaultEnabled: true, position: 84 },
  { metricKey: 'lab_reagent_qc_issues', label: 'Reagent QC Exceptions', section: 'lab_reagent', kind: 'card', defaultEnabled: true, position: 85 },
  { metricKey: 'unmapped_lab_tests', label: 'Unmapped Lab Tests', section: 'lab_reagent', kind: 'card', defaultEnabled: true, position: 86 },
  { metricKey: 'consumption_exceptions', label: 'Consumption Exceptions', section: 'lab_reagent', kind: 'card', defaultEnabled: true, position: 87 },
  { metricKey: 'reagent_reconciliation_table', label: 'Reagent Reconciliation', section: 'lab_reagent', kind: 'panel', defaultEnabled: true, position: 89 },
  { metricKey: 'radiology_exams_completed', label: 'Imaging Exams Completed', section: 'radiology_stock', kind: 'card', defaultEnabled: true, position: 90 },
  { metricKey: 'radiology_stock_skus', label: 'Available Radiology Stock', section: 'radiology_stock', kind: 'card', defaultEnabled: true, position: 91 },
  { metricKey: 'radiology_low_stock', label: 'Low-stock Radiology Items', section: 'radiology_stock', kind: 'card', defaultEnabled: true, position: 92 },
  { metricKey: 'radiology_out_of_stock', label: 'Out-of-stock Radiology Items', section: 'radiology_stock', kind: 'card', defaultEnabled: true, position: 93 },
  { metricKey: 'radiology_expiring_soon', label: 'Radiology Lots Near Expiry', section: 'radiology_stock', kind: 'card', defaultEnabled: true, position: 94 },
  { metricKey: 'radiology_issue_lines', label: 'Radiology Issues', section: 'radiology_stock', kind: 'card', defaultEnabled: true, position: 95 },
] as const satisfies ReadonlyArray<ExecutiveDashboardRegistryItem>;

type ExecutiveKpiMetricKey = typeof EXECUTIVE_KPI_REGISTRY[number]['metricKey'];
type DashboardKpiConfigRow = {
  metric_key?: string | null;
  enabled?: number | string | null;
  position?: number | string | null;
  label_override?: string | null;
};

function isExecutiveKpiMetric(metricKey: string): metricKey is ExecutiveKpiMetricKey {
  return EXECUTIVE_KPI_REGISTRY.some((item) => item.metricKey === metricKey);
}

type ExecutiveCardMetricKey = Exclude<ExecutiveKpiMetricKey, ExecutivePanelMetric>;

function isExecutiveCardMetric(metricKey: string): metricKey is ExecutiveCardMetricKey {
  return EXECUTIVE_KPI_REGISTRY.some((item) => item.metricKey === metricKey && item.kind === 'card');
}

function mergeExecutiveKpiConfig(rows: DashboardKpiConfigRow[]) {
  const overrides = new Map(rows.map((row) => [String(row.metric_key || ''), row]));
  return EXECUTIVE_KPI_REGISTRY
    .map((item) => {
      const override = overrides.get(item.metricKey);
      const labelOverride = typeof override?.label_override === 'string' && override.label_override.trim()
        ? override.label_override.trim()
        : null;
      return {
        metricKey: item.metricKey,
        section: item.section,
        kind: item.kind,
        enabled: override
          ? Number(override.enabled ?? (item.defaultEnabled ? 1 : 0)) === 1
          : item.defaultEnabled,
        position: override ? Number(override.position ?? item.position) : item.position,
        label: labelOverride || item.label,
        labelOverride,
      };
    })
    .sort((a, b) => a.position - b.position || a.metricKey.localeCompare(b.metricKey));
}

function monthEndDate(targetMonth: string): string {
  const [year, month] = targetMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function localReportDate(expression: string): string {
  const valueExpr = expression.includes(',') ? `COALESCE(${expression})` : expression;
  return `CASE
    WHEN ${valueExpr} IS NULL THEN NULL
    WHEN ${valueExpr} LIKE '%Z' OR ${valueExpr} LIKE '%+00:00' OR ${valueExpr} LIKE '%-00:00'
      THEN date(${valueExpr}, '+6 hours')
    ELSE date(${valueExpr})
  END`;
}

function billOutstandingDueExpr(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) {
    throw new Error('Invalid bill table alias');
  }

  return `MAX(0, COALESCE(${alias}.due, COALESCE(${alias}.total, 0) - COALESCE(${alias}.paid, 0), 0))`;
}

function addDaysGMT6(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00+06:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousMonthGMT6(monthString: string): string {
  const [year, month] = monthString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1, 12));
  return date.toISOString().slice(0, 7);
}

function startOfWeekGMT6(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00+06:00`);
  return addDaysGMT6(dateString, -date.getUTCDay());
}

function rowNumber(row: Record<string, unknown> | null | undefined, key: string): number {
  return roundMoney(Number(row?.[key] ?? 0));
}

function dashboardRangeDays(range: string | undefined): number | null {
  if (!range || range === 'today') return 1;
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  return null;
}

function validateDashboardDateParam(dateParam: string | undefined): boolean {
  return !dateParam || /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
}

type KpiBreakdownMetric =
  | 'accounting_income'
  | 'accounting_expenses'
  | 'accounting_profit'
  | 'opd_income'
  | 'lab_income'
  | 'ipd_collection'
  | 'ot_income'
  | 'pharmacy_income'
  | 'radiology_income'
  | 'uncategorized_income'
  | 'visit_commission'
  | 'test_commission'
  | 'total_commission'
  | 'other_doctor_commission'
  | 'total_visits'
  | 'pending_approvals'
  | 'patient_due'
  | 'patient_advance'
  | 'pending_handover'
  | 'total_discount'
  | 'pending_posting'
  | 'gl_income'
  | 'gl_expenses'
  | 'gl_profit'
  | 'doctor_payout'
  | 'cash_received'
  | 'billing_collection'
  | 'due_collection'
  | 'deposit_collection'
  | 'drawer_cash'
  | 'cash_movement'
  | 'inventory_stock_skus'
  | 'inventory_low_stock'
  | 'inventory_out_of_stock'
  | 'inventory_expiring_soon'
  | 'inventory_expired'
  | 'inventory_pending_purchase'
  | 'lab_tests_completed'
  | 'lab_reagent_consumed'
  | 'lab_reagent_stock_skus'
  | 'lab_reagent_low_stock'
  | 'lab_reagent_out_of_stock'
  | 'lab_reagent_expiring_soon'
  | 'lab_reagent_qc_issues'
  | 'unmapped_lab_tests'
  | 'consumption_exceptions'
  | 'radiology_exams_completed'
  | 'radiology_stock_skus'
  | 'radiology_low_stock'
  | 'radiology_out_of_stock'
  | 'radiology_expiring_soon'
  | 'radiology_issue_lines';

type KpiBreakdownSourceRow = {
  source_label?: string | null;
  source_key?: string | number | null;
  doctor_id?: string | number | null;
  amount?: number | string | null;
  row_count?: number | string | null;
};

type KpiBreakdownDetailRow = ExecutiveInventoryDetailRow & {
  id?: string | number | null;
  occurred_at?: string | null;
  source_type?: string | null;
  source_label?: string | null;
  reference_no?: string | null;
  counter_name?: string | null;
  user_name?: string | null;
  amount?: number | string | null;
  status?: string | null;
  bill_id?: string | number | null;
  invoice_no?: string | null;
  patient_name?: string | null;
  patient_code?: string | null;
  discount_reference?: string | null;
  discount_reason?: string | null;
  service_names?: string | null;
  item_count?: string | number | null;
  payment_method?: string | null;
  gross_amount?: number | string | null;
  discount_amount?: number | string | null;
  net_amount?: number | string | null;
  paid_amount?: number | string | null;
  due_amount?: number | string | null;
};

type KpiBreakdownPage = { page: number; pageSize: number; offset: number };

const DEFAULT_KPI_BREAKDOWN_PAGE: KpiBreakdownPage = { page: 1, pageSize: 50, offset: 0 };

const CASH_BILL_SOURCE_LABELS = [
  'mdDashboard.kpi.cashMovementSourceBill',
  'mdDashboard.kpi.cashMovementSourceVisit',
  'mdDashboard.kpi.cashMovementSourceTest',
  'mdDashboard.kpi.cashMovementSourceRadiology',
  'mdDashboard.kpi.cashMovementSourceAdmission',
  'mdDashboard.kpi.cashMovementSourceOperation',
  'mdDashboard.kpi.cashMovementSourceMedicine',
  'mdDashboard.kpi.cashMovementSourceOtherService',
] as const;

const CASH_RECEIVED_SOURCE_LABELS = [
  ...CASH_BILL_SOURCE_LABELS,
  'mdDashboard.kpi.cashMovementSourceDueCollection',
  'mdDashboard.kpi.cashMovementSourceDeposit',
] as const;

const CASH_MOVEMENT_SOURCE_LABELS = [
  ...CASH_RECEIVED_SOURCE_LABELS,
  'mdDashboard.kpi.cashMovementSourceRefund',
  'mdDashboard.kpi.cashMovementSourceExpense',
  'mdDashboard.kpi.cashMovementSourcePayout',
] as const;

function normalizeCashMovementSourceLabel(sourceLabel: string | undefined): string | null {
  if (!sourceLabel) return null;
  return CASH_MOVEMENT_SOURCE_LABELS.includes(sourceLabel as typeof CASH_MOVEMENT_SOURCE_LABELS[number]) ? sourceLabel : null;
}

function parseKpiBreakdownPage(pageParam: string | undefined, pageSizeParam: string | undefined): KpiBreakdownPage {
  const rawPage = Number.parseInt(String(pageParam || '1'), 10);
  const rawPageSize = Number.parseInt(String(pageSizeParam || '50'), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Math.min(100, Math.max(25, Number.isFinite(rawPageSize) && rawPageSize > 0 ? rawPageSize : 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function sourceRowCount(sources: Array<{ count: number }>): number {
  return sources.reduce((sum, row) => sum + Number(row.count || 0), 0);
}

function parseKpiSourceLabels(sourceLabelParam: string | undefined): string[] {
  if (!sourceLabelParam) return [];
  return Array.from(new Set(
    sourceLabelParam
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 80),
  ));
}

function sqlPlaceholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function normalizeKpiMetric(metric: string | undefined): KpiBreakdownMetric | null {
  if (metric && isExecutiveInventoryMetric(metric)) return metric;
  if (metric && isExecutiveCommissionMetric(metric)) return metric;
  if (
    metric === 'accounting_income'
    || metric === 'accounting_expenses'
    || metric === 'accounting_profit'
    || metric === 'opd_income'
    || metric === 'lab_income'
    || metric === 'ipd_collection'
    || metric === 'ot_income'
    || metric === 'pharmacy_income'
    || metric === 'radiology_income'
    || metric === 'uncategorized_income'
    || metric === 'total_commission'
    || metric === 'total_visits'
    || metric === 'pending_approvals'
    || metric === 'patient_due'
    || metric === 'patient_advance'
    || metric === 'pending_handover'
    || metric === 'total_discount'
    || metric === 'pending_posting'
    || metric === 'gl_income'
    || metric === 'gl_expenses'
    || metric === 'gl_profit'
    || metric === 'doctor_payout'
    || metric === 'cash_received'
    || metric === 'billing_collection'
    || metric === 'due_collection'
    || metric === 'deposit_collection'
    || metric === 'drawer_cash'
    || metric === 'cash_movement'
  ) return metric;
  return null;
}

function kpiBreakdownTitle(metric: KpiBreakdownMetric): string {
  const executiveMetric = EXECUTIVE_KPI_REGISTRY.find((item) => item.metricKey === metric);
  if (executiveMetric) return executiveMetric.label;
  if (metric === 'accounting_expenses') return 'Accounting Expenses';
  if (metric === 'accounting_profit') return 'Net Income';
  if (metric === 'lab_income') return 'Diagnostic / Laboratory Collection';
  if (metric === 'total_commission') return 'Total Commission';
  if (metric === 'total_visits') return 'Total Visits';
  if (metric === 'pending_approvals') return 'Pending Approvals';
  if (metric === 'gl_income') return 'Accounted Income';
  if (metric === 'gl_expenses') return 'Accounted Expenses';
  if (metric === 'gl_profit') return 'Income - Approved Expense';
  if (metric === 'patient_due') return 'Patient Due';
  if (metric === 'patient_advance') return 'Patient Advance';
  if (metric === 'pending_handover') return 'Pending Handover';
  if (metric === 'total_discount') return 'Total Discount';
  if (metric === 'pending_posting') return 'Pending Posting';
  if (metric === 'doctor_payout') return 'Doctor Payouts';
  if (metric === 'cash_received') return 'Total Cash Received';
  if (metric === 'billing_collection') return 'Billing Collection';
  if (metric === 'ipd_collection') return 'Admission/IPD Collection';
  if (metric === 'due_collection') return 'Due Collection';
  if (metric === 'deposit_collection') return 'Deposit Received';
  if (metric === 'drawer_cash') return 'Available Drawer Cash';
  if (metric === 'cash_movement') return "Today's Cash Movement";
  return 'Accounting Income';
}

function buildKpiBreakdownPeriod(input: {
  preset?: string;
  range?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
}) {
  const period = resolveExecutiveDashboardPeriod(input);
  if (!period) return null;
  return {
    startDate: period.startDate,
    endDate: period.endDate,
    label: period.label,
  };
}

function mapKpiSources(rows: KpiBreakdownSourceRow[]) {
  return rows.map((row) => {
    const doctorId = optionalNumber(row.doctor_id);
    return {
      label: String(row.source_label || 'Other'),
      amount: roundMoney(Number(row.amount ?? 0)),
      count: Number(row.row_count ?? 0),
      ...(row.source_key !== null && row.source_key !== undefined ? { key: String(row.source_key) } : {}),
      ...(doctorId !== null ? { doctorId } : {}),
    };
  });
}

function optionalNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapKpiRows(rows: KpiBreakdownDetailRow[]) {
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    occurredAt: row.occurred_at || '',
    sourceType: row.source_type || 'unknown',
    sourceLabel: row.source_label || 'Other',
    referenceNo: row.reference_no || null,
    counterName: row.counter_name || null,
    userName: row.user_name || null,
    amount: roundMoney(Number(row.amount ?? 0)),
    status: row.status || null,
    billId: optionalNumber(row.bill_id),
    invoiceNo: row.invoice_no || row.reference_no || null,
    patientName: row.patient_name || null,
    patientCode: row.patient_code || null,
    discountReference: row.discount_reference || null,
    discountReason: row.discount_reason || null,
    serviceNames: row.service_names || null,
    itemCount: optionalNumber(row.item_count),
    paymentMethod: row.payment_method || null,
    grossAmount: optionalNumber(row.gross_amount),
    discountAmount: optionalNumber(row.discount_amount),
    netAmount: optionalNumber(row.net_amount),
    paidAmount: optionalNumber(row.paid_amount),
    dueAmount: optionalNumber(row.due_amount),
    itemName: row.item_name || null,
    itemCode: row.item_code || null,
    unitName: row.unit_name || null,
    availableQuantity: optionalNumber(row.available_quantity),
    reorderLevel: optionalNumber(row.reorder_level),
    storeName: row.store_name || null,
    batchNo: row.batch_no || null,
    expiryDate: row.expiry_date || null,
    qcStatus: row.qc_status || null,
    consumedQuantity: optionalNumber(row.consumed_quantity),
  }));
}

/**
 * Cash Movement detail rows: UNION ALL across the 4 sources, projected into the
 * KpiBreakdownDetailRow shape. Exported so the schema regression test runs the
 * *same* SQL the route runs (not a copy) against an in-memory SQLite with the
 * production schema — see `test/integration/routes/dashboard-cash-movement-kpi.test.ts`.
 *
 * NOTE: `payments` has no `status` column — use the joined bill's status
 * (paid / cancelled / refunded / etc.) so the drawer shows a meaningful badge.
 * Detail rows are server-paginated so the drawer can browse every matching row.
 */
export function getCashMovementDetailSql(): string {
  return `
    SELECT * FROM (
      -- Bills
      SELECT
        'bill-' || p.id AS id,
        COALESCE(p.date, p.created_at) AS occurred_at,
        'bill' AS source_type,
        CASE
          WHEN COALESCE(p.payment_type, 'current') = 'due'
            OR (
              b.id IS NOT NULL
              AND b.created_at IS NOT NULL
              AND ${localReportDate('b.created_at')} < date(?)
            )
          THEN 'mdDashboard.kpi.cashMovementSourceDueCollection'
          WHEN EXISTS (
            SELECT 1
            FROM invoice_items radiology_item
            WHERE radiology_item.tenant_id = b.tenant_id
              AND radiology_item.bill_id = b.id
              AND COALESCE(radiology_item.status, 'active') <> 'cancelled'
              AND LOWER(TRIM(COALESCE(radiology_item.item_category, ''))) IN ('radiology', 'imaging')
          ) THEN 'mdDashboard.kpi.cashMovementSourceRadiology'
          WHEN COALESCE(b.test_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceTest'
          WHEN COALESCE(b.doctor_visit_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceVisit'
          WHEN COALESCE(b.admission_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceAdmission'
          WHEN COALESCE(b.operation_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceOperation'
          WHEN COALESCE(b.medicine_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceMedicine'
          ELSE 'mdDashboard.kpi.cashMovementSourceOtherService'
        END AS source_label,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), p.receipt_no, CAST(p.id AS TEXT)) AS reference_no,
        bc.counter_name AS counter_name,
        u.name AS user_name,
        COALESCE(p.amount, 0) AS amount,
        COALESCE(b.status, 'posted') AS status,
        b.id AS bill_id,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS invoice_no,
        pt.name AS patient_name,
        pt.patient_code AS patient_code,
        COALESCE(NULLIF(TRIM(b.discount_by_name), ''), NULLIF(TRIM(b.referred_by_name), ''), NULL) AS discount_reference,
        NULLIF(TRIM(b.discount_reason), '') AS discount_reason,
        COALESCE(
          (
            SELECT GROUP_CONCAT(description, ', ')
            FROM (
              SELECT NULLIF(TRIM(ii.description), '') AS description
              FROM invoice_items ii
              WHERE ii.tenant_id = b.tenant_id
                AND ii.bill_id = b.id
                AND COALESCE(ii.status, 'active') != 'cancelled'
              ORDER BY ii.id
              LIMIT 5
            ) service_names
            WHERE description IS NOT NULL
          ),
          CASE
            WHEN COALESCE(b.test_bill, 0) > 0 THEN 'Lab/test bill'
            WHEN COALESCE(b.doctor_visit_bill, 0) > 0 THEN 'Doctor visit bill'
            WHEN COALESCE(b.admission_bill, 0) > 0 THEN 'Admission/IPD bill'
            WHEN COALESCE(b.operation_bill, 0) > 0 THEN 'OT/procedure bill'
            WHEN COALESCE(b.medicine_bill, 0) > 0 THEN 'Medicine bill'
            ELSE 'Other service bill'
          END
        ) AS service_names,
        (
          SELECT COUNT(*)
          FROM invoice_items ii
          WHERE ii.tenant_id = b.tenant_id
            AND ii.bill_id = b.id
            AND COALESCE(ii.status, 'active') != 'cancelled'
        ) AS item_count,
        p.payment_method AS payment_method,
        COALESCE(b.total, 0) + COALESCE(b.discount, 0) AS gross_amount,
        COALESCE(b.discount, 0) AS discount_amount,
        COALESCE(b.total, 0) AS net_amount,
        COALESCE(b.paid, 0) AS paid_amount,
        COALESCE(b.due, 0) AS due_amount
      FROM payments p
      LEFT JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
      LEFT JOIN billing_counter_sessions bcs ON p.counter_session_id = bcs.id AND bcs.tenant_id = p.tenant_id
      LEFT JOIN billing_counters bc ON bcs.counter_id = bc.id AND bc.tenant_id = p.tenant_id
      LEFT JOIN patients pt ON pt.id = b.patient_id AND pt.tenant_id = b.tenant_id
      LEFT JOIN users u ON u.id = p.received_by AND u.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
        AND LOWER(TRIM(COALESCE(p.payment_method, 'cash'))) = 'cash'
        AND ${localReportDate('p.date, p.created_at')} >= date(?)
        AND ${localReportDate('p.date, p.created_at')} <= date(?)

      UNION ALL

      -- Patient deposits
      SELECT
        'deposit-' || e.id AS id,
        e.transaction_date AS occurred_at,
        'deposit' AS source_type,
        'mdDashboard.kpi.cashMovementSourceDeposit' AS source_label,
        e.description AS reference_no,
        NULL AS counter_name,
        NULL AS user_name,
        ABS(e.amount) AS amount,
        'posted' AS status,
        NULL AS bill_id, NULL AS invoice_no, NULL AS patient_name, NULL AS patient_code,
        NULL AS discount_reference, NULL AS discount_reason, NULL AS service_names,
        NULL AS item_count, e.payment_method AS payment_method, NULL AS gross_amount,
        NULL AS discount_amount, NULL AS net_amount, NULL AS paid_amount, NULL AS due_amount
      FROM emp_cash_transactions e
      WHERE e.tenant_id = ?
        AND LOWER(TRIM(COALESCE(e.payment_method, 'cash'))) = 'cash'
        AND e.reference_type = 'deposit'
        AND ${localReportDate('e.transaction_date, e.created_at')} >= date(?)
        AND ${localReportDate('e.transaction_date, e.created_at')} <= date(?)

      UNION ALL

      -- Cash refunds / returns recorded by the counter
      SELECT
        'refund-' || e.id AS id,
        COALESCE(e.transaction_date, e.created_at) AS occurred_at,
        'refund' AS source_type,
        'mdDashboard.kpi.cashMovementSourceRefund' AS source_label,
        e.description AS reference_no,
        NULL AS counter_name,
        u.name AS user_name,
        -ABS(e.amount) AS amount,
        'paid' AS status,
        NULL AS bill_id, NULL AS invoice_no, NULL AS patient_name, NULL AS patient_code,
        NULL AS discount_reference, NULL AS discount_reason, NULL AS service_names,
        NULL AS item_count, e.payment_method AS payment_method, NULL AS gross_amount,
        NULL AS discount_amount, NULL AS net_amount, NULL AS paid_amount, NULL AS due_amount
      FROM emp_cash_transactions e
      LEFT JOIN users u ON u.id = e.employee_id AND u.tenant_id = e.tenant_id
      WHERE e.tenant_id = ?
        AND LOWER(TRIM(COALESCE(e.payment_method, 'cash'))) = 'cash'
        AND e.transaction_type IN ('ReturnDeposit', 'SalesReturn', 'CashDiscountGiven')
        AND ${localReportDate('e.transaction_date, e.created_at')} >= date(?)
        AND ${localReportDate('e.transaction_date, e.created_at')} <= date(?)

      UNION ALL

      -- Cash drawer expenses
      SELECT
        'expense-' || m.id AS id,
        m.created_at AS occurred_at,
        'expense' AS source_type,
        'mdDashboard.kpi.cashMovementSourceExpense' AS source_label,
        COALESCE(m.description, CAST(m.reference_id AS TEXT)) AS reference_no,
        NULL AS counter_name,
        NULL AS user_name,
        -m.amount AS amount,
        'paid' AS status,
        NULL AS bill_id, NULL AS invoice_no, NULL AS patient_name, NULL AS patient_code,
        NULL AS discount_reference, NULL AS discount_reason, NULL AS service_names,
        NULL AS item_count, 'cash' AS payment_method, NULL AS gross_amount,
        NULL AS discount_amount, NULL AS net_amount, NULL AS paid_amount, NULL AS due_amount
      FROM cash_drawer_movements m
      WHERE m.tenant_id = ?
        AND m.movement_type = 'cash_out'
        AND LOWER(TRIM(COALESCE(m.payment_method, 'cash'))) = 'cash'
        AND m.reference_type IN ('expense', 'expense_pending')
        AND ${localReportDate('m.created_at')} >= date(?)
        AND ${localReportDate('m.created_at')} <= date(?)

      UNION ALL

      -- Doctor payouts
      SELECT
        'payout-' || m.id AS id,
        m.created_at AS occurred_at,
        'payout' AS source_type,
        'mdDashboard.kpi.cashMovementSourcePayout' AS source_label,
        COALESCE(m.description, CAST(m.reference_id AS TEXT)) AS reference_no,
        NULL AS counter_name,
        NULL AS user_name,
        -m.amount AS amount,
        'paid' AS status,
        NULL AS bill_id, NULL AS invoice_no, NULL AS patient_name, NULL AS patient_code,
        NULL AS discount_reference, NULL AS discount_reason, NULL AS service_names,
        NULL AS item_count, 'cash' AS payment_method, NULL AS gross_amount,
        NULL AS discount_amount, NULL AS net_amount, NULL AS paid_amount, NULL AS due_amount
      FROM cash_drawer_movements m
      WHERE m.tenant_id = ?
        AND m.movement_type = 'cash_out'
        AND LOWER(TRIM(COALESCE(m.payment_method, 'cash'))) = 'cash'
        AND m.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
        AND ${localReportDate('m.created_at')} >= date(?)
        AND ${localReportDate('m.created_at')} <= date(?)
    )
    ORDER BY occurred_at DESC
    LIMIT ? OFFSET ?
  `;
}

async function getCashMovementKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const db = getDb(dbBinding);

  // Source summary: bill cash is split into same-day bill payments vs due collections when payment rows are available.
  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.$client.batch() for KPI Breakdown to reduce network requests.
  const batchResults = await db.$client.batch([
    // Physical cash uses operational payment rows with an explicit cash method.
    // Accounting events are intentionally not used here because older events do not
    // reliably preserve payment method and would mix bank/mobile receipts into cash.
    db.$client.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS total, COUNT(*) AS row_count
      FROM payments p
      WHERE p.tenant_id = ?
        AND LOWER(TRIM(COALESCE(p.payment_method, 'cash'))) = 'cash'
        AND ${localReportDate('p.date, p.created_at')} >= date(?)
        AND ${localReportDate('p.date, p.created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),

    db.$client.prepare(`
      SELECT
        CASE
          WHEN COALESCE(p.payment_type, 'current') = 'due'
            OR (
              b.id IS NOT NULL
              AND b.created_at IS NOT NULL
              AND ${localReportDate('b.created_at')} < date(?)
            )
          THEN 'mdDashboard.kpi.cashMovementSourceDueCollection'
          WHEN EXISTS (
            SELECT 1
            FROM invoice_items radiology_item
            WHERE radiology_item.tenant_id = b.tenant_id
              AND radiology_item.bill_id = b.id
              AND COALESCE(radiology_item.status, 'active') <> 'cancelled'
              AND LOWER(TRIM(COALESCE(radiology_item.item_category, ''))) IN ('radiology', 'imaging')
          ) THEN 'mdDashboard.kpi.cashMovementSourceRadiology'
          WHEN COALESCE(b.test_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceTest'
          WHEN COALESCE(b.doctor_visit_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceVisit'
          WHEN COALESCE(b.admission_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceAdmission'
          WHEN COALESCE(b.operation_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceOperation'
          WHEN COALESCE(b.medicine_bill, 0) > 0 THEN 'mdDashboard.kpi.cashMovementSourceMedicine'
          ELSE 'mdDashboard.kpi.cashMovementSourceOtherService'
        END AS source_label,
        COALESCE(SUM(p.amount), 0) AS amount,
        COUNT(*) AS row_count
      FROM payments p
      LEFT JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
        AND LOWER(TRIM(COALESCE(p.payment_method, 'cash'))) = 'cash'
        AND ${localReportDate('p.date, p.created_at')} >= date(?)
        AND ${localReportDate('p.date, p.created_at')} <= date(?)
      GROUP BY source_label
      ORDER BY amount DESC
    `).bind(startDate, tenantId, startDate, endDate),

    // Patient deposits: emp_cash_transactions with ref_type='deposit'
    db.$client.prepare(`
      SELECT COALESCE(SUM(ABS(amount)), 0) AS total, COUNT(*) AS row_count
      FROM emp_cash_transactions
      WHERE tenant_id = ?
        AND LOWER(TRIM(COALESCE(payment_method, 'cash'))) = 'cash'
        AND reference_type = 'deposit'
        AND ${localReportDate('transaction_date, created_at')} >= date(?)
        AND ${localReportDate('transaction_date, created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),

    // Cash refunds / returns: cash-out movements recorded in counter cash transactions
    db.$client.prepare(`
      SELECT COALESCE(SUM(ABS(amount)), 0) AS total, COUNT(*) AS row_count
      FROM emp_cash_transactions
      WHERE tenant_id = ?
        AND LOWER(TRIM(COALESCE(payment_method, 'cash'))) = 'cash'
        AND transaction_type IN ('ReturnDeposit', 'SalesReturn', 'CashDiscountGiven')
        AND ${localReportDate('transaction_date, created_at')} >= date(?)
        AND ${localReportDate('transaction_date, created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),

    // Cash drawer expenses: cash_out movements with ref='expense'
    db.$client.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS row_count
      FROM cash_drawer_movements
      WHERE tenant_id = ?
        AND movement_type = 'cash_out'
        AND LOWER(TRIM(COALESCE(payment_method, 'cash'))) = 'cash'
        AND reference_type IN ('expense', 'expense_pending')
        AND ${localReportDate('created_at')} >= date(?)
        AND ${localReportDate('created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),

    // Doctor payouts: cash_out with doctor refs
    db.$client.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS row_count
      FROM cash_drawer_movements
      WHERE tenant_id = ?
        AND movement_type = 'cash_out'
        AND LOWER(TRIM(COALESCE(payment_method, 'cash'))) = 'cash'
        AND reference_type IN ('doctor_commission_settlement', 'doctor_payout')
        AND ${localReportDate('created_at')} >= date(?)
        AND ${localReportDate('created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),
  ]);

  const billRow = batchResults[0]?.results?.[0] as unknown as { total: number; row_count: number };
  const billSplitResult = { results: batchResults[1]?.results as unknown as KpiBreakdownSourceRow[] };
  const depositRow = batchResults[2]?.results?.[0] as unknown as { total: number; row_count: number };
  const refundRow = batchResults[3]?.results?.[0] as unknown as { total: number; row_count: number };
  const expenseRow = batchResults[4]?.results?.[0] as unknown as { total: number; row_count: number };
  const payoutRow = batchResults[5]?.results?.[0] as unknown as { total: number; row_count: number };

  const billAmount = roundMoney(Number(billRow?.total ?? 0));
  const depositAmount = roundMoney(Number(depositRow?.total ?? 0));
  const refundAmount = roundMoney(Number(refundRow?.total ?? 0));
  const expenseAmount = roundMoney(Number(expenseRow?.total ?? 0));
  const payoutAmount = roundMoney(Number(payoutRow?.total ?? 0));
  const splitBillSources = mapKpiSources(billSplitResult.results || []).filter((source) => source.label && source.amount > 0);
  const splitBillAmount = roundMoney(splitBillSources.reduce((sum, source) => sum + source.amount, 0));
  const billSources = splitBillSources.length > 0 && Math.abs(splitBillAmount - billAmount) < 0.01
    ? splitBillSources.map((source) => ({ ...source, direction: 'in' as const }))
    : [{ label: 'mdDashboard.kpi.cashMovementSourceBill', amount: billAmount, count: Number(billRow?.row_count ?? 0), direction: 'in' as const }];

  const sources = [
    ...billSources,
    { label: 'mdDashboard.kpi.cashMovementSourceDeposit', amount: depositAmount, count: Number(depositRow?.row_count ?? 0), direction: 'in' as const },
    { label: 'mdDashboard.kpi.cashMovementSourceRefund', amount: -refundAmount, count: Number(refundRow?.row_count ?? 0), direction: 'out' as const },
    { label: 'mdDashboard.kpi.cashMovementSourceExpense', amount: -expenseAmount, count: Number(expenseRow?.row_count ?? 0), direction: 'out' as const },
    { label: 'mdDashboard.kpi.cashMovementSourcePayout', amount: -payoutAmount, count: Number(payoutRow?.row_count ?? 0), direction: 'out' as const },
  ];

  // Detail rows: UNION ALL across the 5 sources, projected into the KpiBreakdownDetailRow shape.
  // Detail rows are server-paginated so the drawer can browse every matching row.
  // The SQL builder is exported (`getCashMovementDetailSql`) so the schema
  // regression test runs the *same* SQL the route runs against a real
  // in-memory SQLite with the production schema — see
  // `test/integration/routes/dashboard-cash-movement-kpi.test.ts`.
  const detailResult = includeDetails
    ? await db.$client
      .prepare(getCashMovementDetailSql())
      .bind(
        tenantId, startDate, startDate, endDate,
        tenantId, startDate, endDate,
        tenantId, startDate, endDate,
        tenantId, startDate, endDate,
        tenantId, startDate, endDate,
        page.pageSize,
        page.offset,
      )
      .all<KpiBreakdownDetailRow>()
    : { results: [] as KpiBreakdownDetailRow[] };

  const rows = mapKpiRows(detailResult.results || []);
  return {
    sources,
    rows,
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getCashMovementSourceKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  labels: string[],
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const full = await getCashMovementKpiBreakdown(dbBinding, tenantId, startDate, endDate, page, includeDetails);
  const labelSet = new Set(labels);
  const sources = full.sources.filter((source) => labelSet.has(source.label));
  const rows = full.rows.filter((row) => labelSet.has(row.sourceLabel));
  return {
    sources,
    rows,
    totalRows: rows.length,
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getDrawerCashKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const db = getDb(dbBinding);
  const result = await db.$client.prepare(`
    SELECT
      'counter-' || s.id AS id,
      s.opened_at AS occurred_at,
      'active_counter' AS source_type,
      COALESCE(c.counter_name, 'Counter') AS source_label,
      COALESCE(c.counter_code, CAST(s.id AS TEXT)) AS reference_no,
      c.counter_name AS counter_name,
      u.name AS user_name,
      COALESCE(s.opening_cash, 0) + COALESCE(ect.cash_in, 0) - COALESCE(ect.cash_out, 0) + COALESCE(cdm.manual_cash_in, 0) - COALESCE(cdm.manual_cash_out, 0) - COALESCE(cdm.cash_drop_total, 0) AS amount,
      COALESCE(s.status, 'active') AS status,
      NULL AS bill_id, NULL AS invoice_no, NULL AS patient_name, NULL AS patient_code,
      NULL AS discount_reference, NULL AS discount_reason, NULL AS gross_amount,
      NULL AS discount_amount, NULL AS net_amount, NULL AS paid_amount, NULL AS due_amount
    FROM billing_counter_sessions s
    LEFT JOIN billing_counters c ON c.id = s.counter_id AND c.tenant_id = s.tenant_id
    LEFT JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
    LEFT JOIN (
      SELECT counter_session_id,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(payment_method, 'cash'))) = 'cash' AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN amount ELSE 0 END) AS cash_in,
        SUM(CASE WHEN LOWER(TRIM(COALESCE(payment_method, 'cash'))) = 'cash' AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN amount ELSE 0 END) AS cash_out
      FROM emp_cash_transactions WHERE tenant_id = ? GROUP BY counter_session_id
    ) ect ON ect.counter_session_id = s.id
    LEFT JOIN (
      SELECT counter_session_id,
        SUM(CASE WHEN movement_type = 'cash_in' THEN amount ELSE 0 END) AS manual_cash_in,
        SUM(CASE WHEN movement_type = 'cash_out' THEN amount ELSE 0 END) AS manual_cash_out,
        SUM(CASE WHEN movement_type = 'cash_drop' THEN amount ELSE 0 END) AS cash_drop_total
      FROM cash_drawer_movements
      WHERE tenant_id = ?
        AND LOWER(TRIM(COALESCE(payment_method, 'cash'))) = 'cash'
      GROUP BY counter_session_id
    ) cdm ON cdm.counter_session_id = s.id
    WHERE s.tenant_id = ? AND s.status = 'active'
    ORDER BY s.opened_at DESC
  `).bind(tenantId, tenantId, tenantId).all<KpiBreakdownDetailRow>();
  const allRows = mapKpiRows(result.results || []);
  const rows = includeDetails ? allRows.slice(page.offset, page.offset + page.pageSize) : [];
  const sources = allRows.map((row) => ({ label: row.sourceLabel, amount: row.amount, count: 1, direction: 'in' as const }));
  return { sources, rows, totalRows: allRows.length, total: sources.reduce((sum, row) => sum + row.amount, 0) };
}

function accountingIncomeAllocationCte(): string {
  return executivePaymentAllocationCte();
}

export function getAccountingIncomeSourceSql(sourceLabels: string[] = []): string {
  const sourceFilterSql = sourceLabels.length > 0
    ? `WHERE source_label IN (${sqlPlaceholders(sourceLabels)})`
    : '';
  return `${accountingIncomeAllocationCte()}
    SELECT
      source_label,
      ROUND(COALESCE(SUM(allocated_amount), 0), 2) AS amount,
      COUNT(DISTINCT payment_id) AS row_count
    FROM payment_allocations
    ${sourceFilterSql}
    GROUP BY source_label
    ORDER BY amount DESC, source_label ASC
  `;
}

function getAccountingIncomeDetailSql(sourceLabels: string[] = []): string {
  const sourceFilterSql = sourceLabels.length > 0
    ? `WHERE pa.source_label IN (${sqlPlaceholders(sourceLabels)})`
    : '';
  return `${accountingIncomeAllocationCte()}
    SELECT
      'payment-' || pa.payment_id || '-' || LOWER(REPLACE(pa.source_label, ' ', '-')) AS id,
      pa.occurred_at,
      'payment' AS source_type,
      pa.source_label,
      COALESCE(pa.receipt_no, 'PAY-' || pa.payment_id) AS reference_no,
      bc.counter_name,
      u.name AS user_name,
      ROUND(SUM(pa.allocated_amount), 2) AS amount,
      'posted' AS status,
      pa.bill_id,
      COALESCE(NULLIF(TRIM(pa.invoice_no), ''), 'BILL-' || pa.bill_id) AS invoice_no,
      pt.name AS patient_name,
      pt.patient_code,
      pa.payment_method,
      COALESCE(NULLIF(TRIM(pa.discount_by_name), ''), NULLIF(TRIM(pa.referred_by_name), ''), NULL) AS discount_reference,
      NULLIF(TRIM(pa.discount_reason), '') AS discount_reason,
      GROUP_CONCAT(pa.service_name, ', ') AS service_names,
      SUM(pa.item_count) AS item_count,
      pa.bill_total + pa.discount_amount AS gross_amount,
      pa.discount_amount,
      pa.bill_total AS net_amount,
      MIN(pa.bill_total, pa.paid_amount) AS paid_amount,
      pa.due_amount
    FROM payment_allocations pa
    LEFT JOIN billing_counter_sessions bcs ON pa.counter_session_id = bcs.id AND bcs.tenant_id = pa.tenant_id
    LEFT JOIN billing_counters bc ON bcs.counter_id = bc.id AND bc.tenant_id = pa.tenant_id
    LEFT JOIN patients pt ON pt.id = pa.patient_id AND pt.tenant_id = pa.tenant_id
    LEFT JOIN users u ON u.id = pa.received_by AND u.tenant_id = pa.tenant_id
    ${sourceFilterSql}
    GROUP BY pa.payment_id, pa.source_label
    ORDER BY pa.occurred_at DESC
    LIMIT ? OFFSET ?
  `;
}

async function getAccountingIncomeKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  sourceLabels: string[] = [],
  includeDetails = true,
) {
  const db = getDb(dbBinding);
  const sourceSummaryParams = [tenantId, startDate, endDate, ...sourceLabels];
  const detailParams = [tenantId, startDate, endDate, ...sourceLabels, page.pageSize, page.offset];
  const batchResults = await db.$client.batch([
    db.$client.prepare(getAccountingIncomeSourceSql(sourceLabels)).bind(...sourceSummaryParams),
    ...(includeDetails
      ? [db.$client.prepare(getAccountingIncomeDetailSql(sourceLabels)).bind(...detailParams)]
      : []),
  ]);
  const sourcesResult = batchResults[0];
  const detailsResult = includeDetails ? batchResults[1] : undefined;

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || [])
    .filter((source) => source.amount !== 0 || source.count !== 0);
  return {
    sources,
    rows: mapKpiRows((detailsResult?.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

function depositPaymentMethodLabelExpr(column: string): string {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${column}, 'cash'))) IN ('cash', 'cash payment') THEN 'Cash'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('bkash', 'b-kash', 'b kash') THEN 'bKash'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) = 'nagad' THEN 'Nagad'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) = 'rocket' THEN 'Rocket'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('card', 'debit_card', 'credit_card') THEN 'Card'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('bank', 'bank_transfer', 'bank transfer') THEN 'Bank Transfer'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) = 'cheque' THEN 'Cheque'
    ELSE COALESCE(NULLIF(TRIM(${column}), ''), 'Unknown')
  END`;
}

async function getDepositReceivedKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const db = getDb(dbBinding);
  const methodLabel = depositPaymentMethodLabelExpr('d.payment_method');
  const batchResults = await db.$client.batch([
    db.$client.prepare(`
      SELECT
        ${methodLabel} AS source_label,
        ROUND(COALESCE(SUM(d.amount), 0), 2) AS amount,
        COUNT(*) AS row_count
      FROM billing_deposits d
      WHERE d.tenant_id = ?
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
        AND COALESCE(d.is_active, 1) = 1
        AND LOWER(TRIM(COALESCE(d.transaction_type, 'deposit'))) = 'deposit'
        AND COALESCE(d.amount, 0) > 0
      GROUP BY source_label
    `).bind(tenantId, startDate, endDate),
    ...(includeDetails ? [db.$client.prepare(`
      SELECT
        'deposit-' || d.id AS id,
        d.created_at AS occurred_at,
        'deposit_collection' AS source_type,
        ${methodLabel} AS source_label,
        COALESCE(d.deposit_receipt_no, 'DEP-' || d.id) AS reference_no,
        bc.counter_name,
        u.name AS user_name,
        ROUND(COALESCE(d.amount, 0), 2) AS amount,
        'posted' AS status,
        d.reference_bill_id AS bill_id,
        NULL AS invoice_no,
        pt.name AS patient_name,
        pt.patient_code,
        d.payment_method,
        NULL AS discount_reference,
        NULL AS discount_reason,
        'Patient deposit / advance receipt' AS service_names,
        1 AS item_count,
        NULL AS gross_amount,
        NULL AS discount_amount,
        NULL AS net_amount,
        NULL AS paid_amount,
        NULL AS due_amount
      FROM billing_deposits d
      LEFT JOIN billing_counters bc ON bc.id = d.counter_id AND bc.tenant_id = d.tenant_id
      LEFT JOIN users u ON u.id = d.created_by AND u.tenant_id = d.tenant_id
      LEFT JOIN patients pt ON pt.id = d.patient_id AND pt.tenant_id = d.tenant_id
      WHERE d.tenant_id = ?
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
        AND COALESCE(d.is_active, 1) = 1
        AND LOWER(TRIM(COALESCE(d.transaction_type, 'deposit'))) = 'deposit'
        AND COALESCE(d.amount, 0) > 0
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, page.pageSize, page.offset)] : []),
  ]);

  const sourcesResult = batchResults[0];
  const detailsResult = includeDetails ? batchResults[1] : undefined;
  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || [])
    .filter((source) => source.amount !== 0 || source.count !== 0);
  return {
    sources,
    rows: mapKpiRows((detailsResult?.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getManagementCollectionKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  sourceLabels: string[] = [],
  includeDetails = true,
) {
  const mergePage: KpiBreakdownPage = includeDetails
    ? { page: 1, pageSize: page.offset + page.pageSize, offset: 0 }
    : page;
  const includeDeposits = sourceLabels.length === 0 || sourceLabels.includes('deposit_collection');
  const incomeSourceLabels = sourceLabels.filter((label) => label !== 'deposit_collection');
  const includeIncome = sourceLabels.length === 0 || incomeSourceLabels.length > 0;
  const emptyBreakdown = { sources: [], rows: [], totalRows: 0, total: 0 };

  const [income, deposits] = await Promise.all([
    includeIncome
      ? getAccountingIncomeKpiBreakdown(
        dbBinding,
        tenantId,
        startDate,
        endDate,
        mergePage,
        incomeSourceLabels,
        includeDetails,
      )
      : Promise.resolve(emptyBreakdown),
    includeDeposits
      ? getDepositReceivedKpiBreakdown(
        dbBinding,
        tenantId,
        startDate,
        endDate,
        mergePage,
        includeDetails,
      )
      : Promise.resolve(emptyBreakdown),
  ]);

  const rows = includeDetails
    ? [...income.rows, ...deposits.rows]
      .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')))
      .slice(page.offset, page.offset + page.pageSize)
    : [];
  return {
    sources: [...income.sources, ...deposits.sources],
    rows,
    totalRows: Number(income.totalRows ?? income.rows.length) + Number(deposits.totalRows ?? deposits.rows.length),
    total: Number(income.total ?? 0) + Number(deposits.total ?? 0),
  };
}

async function getLabIncomeKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const db = getDb(dbBinding);
  const batchResults = await db.$client.batch([
    db.$client.prepare(`${accountingIncomeAllocationCte()}
      SELECT
        service_name AS source_label,
        ROUND(COALESCE(SUM(allocated_amount), 0), 2) AS amount,
        SUM(item_count) AS row_count
      FROM payment_allocations
      WHERE source_label = 'Lab'
      GROUP BY service_name
      ORDER BY amount DESC, service_name ASC
    `).bind(tenantId, startDate, endDate),
    ...(includeDetails ? [db.$client.prepare(`${accountingIncomeAllocationCte()}
      SELECT
        'lab-' || pa.payment_id || '-' || LOWER(REPLACE(pa.service_name, ' ', '-')) AS id,
        pa.occurred_at,
        'payment' AS source_type,
        pa.service_name AS source_label,
        COALESCE(pa.receipt_no, 'PAY-' || pa.payment_id) AS reference_no,
        bc.counter_name,
        u.name AS user_name,
        ROUND(SUM(pa.allocated_amount), 2) AS amount,
        'posted' AS status,
        pa.bill_id,
        COALESCE(NULLIF(TRIM(pa.invoice_no), ''), 'BILL-' || pa.bill_id) AS invoice_no,
        pt.name AS patient_name,
        pt.patient_code,
        pa.payment_method,
        pa.service_name AS service_names,
        SUM(pa.item_count) AS item_count,
        pa.bill_total + pa.discount_amount AS gross_amount,
        pa.discount_amount,
        pa.bill_total AS net_amount,
        MIN(pa.bill_total, pa.paid_amount) AS paid_amount,
        pa.due_amount
      FROM payment_allocations pa
      LEFT JOIN billing_counter_sessions bcs ON pa.counter_session_id = bcs.id AND bcs.tenant_id = pa.tenant_id
      LEFT JOIN billing_counters bc ON bcs.counter_id = bc.id AND bc.tenant_id = pa.tenant_id
      LEFT JOIN patients pt ON pt.id = pa.patient_id AND pt.tenant_id = pa.tenant_id
      LEFT JOIN users u ON u.id = pa.received_by AND u.tenant_id = pa.tenant_id
      WHERE pa.source_label = 'Lab'
      GROUP BY pa.payment_id, pa.service_name
      ORDER BY pa.occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, page.pageSize, page.offset)] : []),
  ]);
  const sourcesResult = batchResults[0];
  const detailsResult = includeDetails ? batchResults[1] : undefined;

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []);
  return {
    sources,
    rows: mapKpiRows((detailsResult?.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getVisitsKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const db = getDb(dbBinding);
  const consultationPredicate = `(
    LOWER(TRIM(COALESCE(ii.item_category, ''))) IN ('consultation', 'doctor_visit', 'opd', 'visit')
    OR LOWER(COALESCE(ii.description, '')) LIKE '%consult%'
    OR LOWER(COALESCE(ii.description, '')) LIKE '%doctor%'
  )`;
  const visitLinesCte = `
    WITH visit_lines AS (
      SELECT
        ii.id AS line_id,
        ii.tenant_id,
        ii.bill_id,
        COALESCE(NULLIF(TRIM(ii.description), ''), 'Consultation') AS description,
        COALESCE(ii.quantity, 1) AS quantity,
        COALESCE(ii.unit_price, 0) AS unit_price,
        COALESCE(ii.line_total, 0) AS line_total
      FROM invoice_items ii
      WHERE ii.tenant_id = ?
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND ${consultationPredicate}

      UNION ALL

      SELECT
        NULL AS line_id,
        b.tenant_id,
        b.id AS bill_id,
        'Doctor visit' AS description,
        1 AS quantity,
        COALESCE(b.doctor_visit_bill, 0) AS unit_price,
        COALESCE(b.doctor_visit_bill, 0) AS line_total
      FROM bills b
      WHERE b.tenant_id = ?
        AND COALESCE(b.doctor_visit_bill, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM invoice_items ii
          WHERE ii.tenant_id = b.tenant_id
            AND ii.bill_id = b.id
            AND COALESCE(ii.status, 'active') != 'cancelled'
            AND ${consultationPredicate}
        )
    )
  `;
  const batchResults = await db.$client.batch([
    db.$client.prepare(`${visitLinesCte}
      SELECT
        COALESCE(NULLIF(TRIM(d.name), ''), 'Unassigned Doctor') AS source_label,
        COALESCE(SUM(vl.line_total), 0) AS amount,
        COUNT(DISTINCT COALESCE(b.visit_id, b.id)) AS row_count,
        COALESCE(v.doctor_id, b.referring_doctor_id, 0) AS resolved_doctor_id
      FROM visit_lines vl
      JOIN bills b ON b.id = vl.bill_id AND b.tenant_id = vl.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN doctors d ON d.id = COALESCE(v.doctor_id, b.referring_doctor_id) AND d.tenant_id = b.tenant_id
      WHERE COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localReportDate('b.created_at, b.updated_at')} >= date(?)
        AND ${localReportDate('b.created_at, b.updated_at')} <= date(?)
      GROUP BY resolved_doctor_id, source_label
      ORDER BY row_count DESC, amount DESC
    `).bind(tenantId, tenantId, startDate, endDate),
    ...(includeDetails ? [db.$client.prepare(`${visitLinesCte}
      SELECT
        'visit-' || COALESCE(CAST(vl.line_id AS TEXT), 'bill-' || b.id) AS id,
        COALESCE(v.visit_date, b.created_at) AS occurred_at,
        'visit' AS source_type,
        COALESCE(NULLIF(TRIM(d.name), ''), 'Unassigned Doctor') AS source_label,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS reference_no,
        bc.counter_name,
        u.name AS user_name,
        vl.line_total AS amount,
        COALESCE(b.status, 'posted') AS status,
        b.id AS bill_id,
        b.invoice_no,
        pt.name AS patient_name,
        pt.patient_code,
        vl.description AS service_names,
        vl.quantity AS item_count,
        vl.unit_price * vl.quantity AS gross_amount,
        MAX(0, vl.unit_price * vl.quantity - vl.line_total) AS discount_amount,
        vl.line_total AS net_amount,
        MIN(vl.line_total, COALESCE(b.paid, 0)) AS paid_amount,
        COALESCE(b.due, 0) AS due_amount
      FROM visit_lines vl
      JOIN bills b ON b.id = vl.bill_id AND b.tenant_id = vl.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN doctors d ON d.id = COALESCE(v.doctor_id, b.referring_doctor_id) AND d.tenant_id = b.tenant_id
      LEFT JOIN patients pt ON pt.id = b.patient_id AND pt.tenant_id = b.tenant_id
      LEFT JOIN billing_counter_sessions bcs ON b.counter_session_id = bcs.id AND bcs.tenant_id = b.tenant_id
      LEFT JOIN billing_counters bc ON bcs.counter_id = bc.id AND bc.tenant_id = b.tenant_id
      LEFT JOIN users u ON u.id = b.created_by AND u.tenant_id = b.tenant_id
      WHERE COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localReportDate('b.created_at, b.updated_at')} >= date(?)
        AND ${localReportDate('b.created_at, b.updated_at')} <= date(?)
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, tenantId, startDate, endDate, page.pageSize, page.offset)] : []),
  ]);
  const sourcesResult = batchResults[0];
  const detailsResult = includeDetails ? batchResults[1] : undefined;

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []);
  return {
    sources,
    rows: mapKpiRows((detailsResult?.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sourceRowCount(sources),
  };
}

async function getPendingApprovalsKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const db = getDb(dbBinding);
  const batchResults = await db.$client.batch([
    db.$client.prepare(`
      SELECT COALESCE(NULLIF(TRIM(type), ''), 'other') AS source_label, 0 AS amount, COUNT(*) AS row_count
      FROM approval_requests
      WHERE tenant_id = ? AND status = 'pending'
      GROUP BY source_label
      ORDER BY row_count DESC
    `).bind(tenantId),
    db.$client.prepare(`
      SELECT 'expense' AS source_label, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS row_count
      FROM expenses
      WHERE tenant_id = ? AND COALESCE(approval_status, status) = 'pending'
      GROUP BY source_label
    `).bind(tenantId),
    db.$client.prepare(`
      SELECT 'cash_handover' AS source_label,
        COALESCE(SUM(COALESCE(receiver_counted_amount, handover_amount, 0)), 0) AS amount,
        COUNT(*) AS row_count
      FROM billing_handovers
      WHERE tenant_id = ?
        AND handover_type = 'counter'
        AND status IN ('receiver_verified', 'disputed')
        AND COALESCE(admin_verification_status, 'pending_admin') = 'pending_admin'
      GROUP BY source_label
    `).bind(tenantId),
    ...(includeDetails ? [db.$client.prepare(`
      SELECT * FROM (
        SELECT
          'approval-' || ar.id AS id,
          ar.created_at AS occurred_at,
          'approval' AS source_type,
          COALESCE(NULLIF(TRIM(ar.type), ''), 'other') AS source_label,
          COALESCE(NULLIF(TRIM(ar.entity_no), ''), 'APPROVAL-' || ar.id) AS reference_no,
          NULL AS counter_name,
          u.name AS user_name,
          COALESCE(CAST(json_extract(ar.request_data, '$.amount') AS REAL), 0) AS amount,
          ar.status AS status,
          NULL AS bill_id,
          NULL AS invoice_no,
          NULL AS patient_name,
          NULL AS patient_code,
          ar.type AS service_names,
          1 AS item_count
        FROM approval_requests ar
        LEFT JOIN users u ON u.id = ar.requested_by AND u.tenant_id = ar.tenant_id
        WHERE ar.tenant_id = ? AND ar.status = 'pending'

        UNION ALL

        SELECT
          'expense-approval-' || e.id,
          COALESCE(e.created_at, e.date),
          'approval',
          'expense',
          'EXP-' || e.id,
          NULL,
          u.name,
          COALESCE(e.amount, 0),
          'pending',
          NULL, NULL, NULL, NULL,
          COALESCE(NULLIF(TRIM(e.category), ''), 'Expense'),
          1
        FROM expenses e
        LEFT JOIN users u ON u.id = e.created_by AND u.tenant_id = e.tenant_id
        WHERE e.tenant_id = ? AND COALESCE(e.approval_status, e.status) = 'pending'

        UNION ALL

        SELECT
          'handover-approval-' || h.id,
          h.created_at,
          'approval',
          'cash_handover',
          'HANDOVER-' || h.id,
          NULL,
          u.name,
          COALESCE(h.receiver_counted_amount, h.handover_amount, 0),
          'pending',
          NULL, NULL, NULL, NULL,
          'Cash handover',
          1
        FROM billing_handovers h
        LEFT JOIN users u ON u.id = h.handover_by AND u.tenant_id = h.tenant_id
        WHERE h.tenant_id = ?
          AND h.handover_type = 'counter'
          AND h.status IN ('receiver_verified', 'disputed')
          AND COALESCE(h.admin_verification_status, 'pending_admin') = 'pending_admin'
      )
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, tenantId, tenantId, page.pageSize, page.offset)] : []),
  ]);
  const canonicalResult = batchResults[0];
  const expenseResult = batchResults[1];
  const handoverResult = batchResults[2];
  const detailsResult = includeDetails ? batchResults[3] : undefined;

  const sources = [
    ...mapKpiSources((canonicalResult.results as unknown as KpiBreakdownSourceRow[]) || []),
    ...mapKpiSources((expenseResult.results as unknown as KpiBreakdownSourceRow[]) || []),
    ...mapKpiSources((handoverResult.results as unknown as KpiBreakdownSourceRow[]) || []),
  ].filter((source) => source.count > 0);
  return {
    sources,
    rows: mapKpiRows((detailsResult?.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sourceRowCount(sources),
  };
}

async function getPatientDueKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  _startDate: string,
  _endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  const db = getDb(dbBinding);
  const dueExpr = billOutstandingDueExpr('b');
  const dueStatusExpr = `CASE
    WHEN COALESCE(b.paid, 0) <= 0 THEN 'unpaid'
    WHEN ${dueExpr} > 0 THEN 'partial'
    ELSE 'paid'
  END`;
  const billReferenceExpr = `COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id)`;
  const discountReferenceExpr = `COALESCE(
    NULLIF(TRIM(b.discount_by_name), ''),
    NULLIF(TRIM(b.referred_by_name), ''),
    NULL
  )`;
  const serviceSummaryExpr = `(
    SELECT GROUP_CONCAT(description, ', ')
    FROM (
      SELECT NULLIF(TRIM(ii.description), '') AS description
      FROM invoice_items ii
      WHERE ii.tenant_id = b.tenant_id
        AND ii.bill_id = b.id
        AND COALESCE(ii.status, 'active') != 'cancelled'
      ORDER BY ii.id
      LIMIT 5
    ) service_names
    WHERE description IS NOT NULL
  )`;
  const itemCountExpr = `(
    SELECT COUNT(*)
    FROM invoice_items ii
    WHERE ii.tenant_id = b.tenant_id
      AND ii.bill_id = b.id
      AND COALESCE(ii.status, 'active') != 'cancelled'
  )`;
  const [sourcesResult, detailsResult] = await db.$client.batch([
    db.$client.prepare(`
      SELECT
        ${dueStatusExpr} AS source_label,
        COALESCE(SUM(${dueExpr}), 0) AS amount,
        COUNT(*) AS row_count
      FROM bills b
      WHERE b.tenant_id = ?
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${dueExpr} > 0
      GROUP BY source_label
      ORDER BY amount DESC
    `).bind(tenantId),
    db.$client.prepare(`
      SELECT
        'bill-due-' || b.id AS id,
        b.created_at AS occurred_at,
        'patient_due' AS source_type,
        ${dueStatusExpr} AS source_label,
        ${billReferenceExpr} AS reference_no,
        NULL AS counter_name,
        u.name AS user_name,
        ${dueExpr} AS amount,
        ${dueStatusExpr} AS status,
        b.id AS bill_id,
        ${billReferenceExpr} AS invoice_no,
        p.name AS patient_name,
        p.patient_code AS patient_code,
        ${discountReferenceExpr} AS discount_reference,
        NULLIF(TRIM(b.discount_reason), '') AS discount_reason,
        COALESCE(b.total, 0) + COALESCE(b.discount, 0) AS gross_amount,
        COALESCE(b.discount, 0) AS discount_amount,
        COALESCE(b.total, 0) AS net_amount,
        COALESCE(b.paid, 0) AS paid_amount,
        ${dueExpr} AS due_amount,
        ${serviceSummaryExpr} AS service_names,
        ${itemCountExpr} AS item_count
      FROM bills b
      LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      LEFT JOIN users u ON u.id = b.created_by AND u.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${dueExpr} > 0
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, page.pageSize, page.offset),
  ]);

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []);
  return {
    sources,
    rows: mapKpiRows((detailsResult.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getAccountingExpenseKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const db = getDb(dbBinding);
  const paidExpensePredicate = `
    COALESCE(e.status, 'approved') != 'rejected'
    AND (COALESCE(e.payment_status, 'unpaid') = 'paid' OR e.cash_movement_id IS NOT NULL)
  `;
  const batchResults = await db.$client.batch([
    db.$client.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(e.category), ''), 'other') AS source_label,
        COALESCE(SUM(e.amount), 0) AS amount,
        COUNT(*) AS row_count
      FROM expenses e
      WHERE e.tenant_id = ?
        AND e.date >= date(?)
        AND e.date <= date(?)
        AND ${paidExpensePredicate}
      GROUP BY source_label
      ORDER BY amount DESC
    `).bind(tenantId, startDate, endDate),
    db.$client.prepare(`
      SELECT
        'Doctor payouts' AS source_label,
        COALESCE(SUM(m.amount), 0) AS amount,
        COUNT(*) AS row_count
      FROM cash_drawer_movements m
      WHERE m.tenant_id = ?
        AND m.movement_type = 'cash_out'
        AND m.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
        AND ${localReportDate('m.created_at')} >= date(?)
        AND ${localReportDate('m.created_at')} <= date(?)
      GROUP BY source_label
    `).bind(tenantId, startDate, endDate),
    ...(includeDetails ? [db.$client.prepare(`
      SELECT * FROM (
        SELECT
          'expense-' || e.id AS id,
          COALESCE(e.date, e.created_at) AS occurred_at,
          'expense' AS source_type,
          COALESCE(NULLIF(TRIM(e.category), ''), 'other') AS source_label,
          COALESCE(NULLIF(TRIM(e.description), ''), 'EXP-' || e.id) AS reference_no,
          NULL AS counter_name,
          u.name AS user_name,
          COALESCE(e.amount, 0) AS amount,
          COALESCE(e.status, 'approved') AS status,
          NULL AS payment_method
        FROM expenses e
        LEFT JOIN users u ON u.id = e.created_by AND u.tenant_id = e.tenant_id
        WHERE e.tenant_id = ?
          AND e.date >= date(?)
          AND e.date <= date(?)
          AND ${paidExpensePredicate}

        UNION ALL

        SELECT
          'payout-' || m.id AS id,
          m.created_at AS occurred_at,
          'doctor_payout' AS source_type,
          'Doctor payouts' AS source_label,
          COALESCE(NULLIF(TRIM(m.description), ''), NULLIF(TRIM(CAST(m.reference_id AS TEXT)), ''), 'PAYOUT-' || m.id) AS reference_no,
          NULL AS counter_name,
          NULL AS user_name,
          COALESCE(m.amount, 0) AS amount,
          'paid' AS status,
          COALESCE(NULLIF(TRIM(m.payment_method), ''), 'cash') AS payment_method
        FROM cash_drawer_movements m
        WHERE m.tenant_id = ?
          AND m.movement_type = 'cash_out'
          AND m.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
          AND ${localReportDate('m.created_at')} >= date(?)
          AND ${localReportDate('m.created_at')} <= date(?)
      )
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, tenantId, startDate, endDate, page.pageSize, page.offset)] : []),
  ]);
  const expenseSourcesResult = batchResults[0];
  const payoutSourcesResult = batchResults[1];
  const detailsResult = includeDetails ? batchResults[2] : undefined;

  const sources = [
    ...mapKpiSources((expenseSourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []),
    ...mapKpiSources((payoutSourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []),
  ].filter((source) => source.amount !== 0 || source.count !== 0);
  return {
    sources,
    rows: mapKpiRows((detailsResult?.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getPatientAdvanceKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  const db = getDb(dbBinding);
  const signedAmountExpr = `CASE
    WHEN d.transaction_type IN ('refund', 'adjustment') THEN -ABS(COALESCE(d.amount, 0))
    ELSE COALESCE(d.amount, 0)
  END`;
  const [sourcesResult, detailsResult] = await db.$client.batch([
    db.$client.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(d.transaction_type), ''), 'deposit') AS source_label,
        COALESCE(SUM(${signedAmountExpr}), 0) AS amount,
        COUNT(*) AS row_count
      FROM billing_deposits d
      WHERE d.tenant_id = ?
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
        AND COALESCE(d.is_active, 1) = 1
      GROUP BY source_label
      ORDER BY amount DESC
    `).bind(tenantId, startDate, endDate),
    db.$client.prepare(`
      SELECT
        'deposit-' || d.id AS id,
        d.created_at AS occurred_at,
        'patient_advance' AS source_type,
        COALESCE(NULLIF(TRIM(d.transaction_type), ''), 'deposit') AS source_label,
        COALESCE(d.deposit_receipt_no, 'DEP-' || d.id) AS reference_no,
        NULL AS counter_name,
        u.name AS user_name,
        ${signedAmountExpr} AS amount,
        'posted' AS status
      FROM billing_deposits d
      LEFT JOIN users u ON u.id = d.created_by AND u.tenant_id = d.tenant_id
      WHERE d.tenant_id = ?
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
        AND COALESCE(d.is_active, 1) = 1
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, page.pageSize, page.offset),
  ]);

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []);
  return {
    sources,
    rows: mapKpiRows((detailsResult.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}


async function getDoctorPayoutKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  const db = getDb(dbBinding);
  const [sourcesResult, detailsResult] = await db.$client.batch([
    db.$client.prepare(`
      SELECT
        'mdDashboard.kpi.cashMovementSourcePayout' AS source_label,
        -COALESCE(SUM(m.amount), 0) AS amount,
        COUNT(*) AS row_count
      FROM cash_drawer_movements m
      WHERE m.tenant_id = ?
        AND m.movement_type = 'cash_out'
        AND m.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
        AND ${localReportDate('m.created_at')} >= date(?)
        AND ${localReportDate('m.created_at')} <= date(?)
    `).bind(tenantId, startDate, endDate),
    db.$client.prepare(`
      SELECT
        'payout-' || m.id AS id,
        m.created_at AS occurred_at,
        'doctor_payout' AS source_type,
        'mdDashboard.kpi.cashMovementSourcePayout' AS source_label,
        COALESCE(NULLIF(TRIM(m.description), ''), NULLIF(TRIM(m.reference_id), ''), 'PAYOUT-' || m.id) AS reference_no,
        NULL AS counter_name,
        NULL AS user_name,
        -COALESCE(m.amount, 0) AS amount,
        'paid' AS status,
        COALESCE(NULLIF(TRIM(m.payment_method), ''), 'cash') AS payment_method
      FROM cash_drawer_movements m
      WHERE m.tenant_id = ?
        AND m.movement_type = 'cash_out'
        AND m.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
        AND ${localReportDate('m.created_at')} >= date(?)
        AND ${localReportDate('m.created_at')} <= date(?)
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, page.pageSize, page.offset),
  ]);

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []);
  return {
    sources,
    rows: mapKpiRows((detailsResult.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getPendingHandoverKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  const db = getDb(dbBinding);
  const [sourcesResult, detailsResult] = await db.$client.batch([
    db.$client.prepare(`
      WITH pending_handover_sources AS (
        SELECT 'counter handover' AS source_label,
          CASE WHEN status = 'partial' THEN COALESCE(due_amount, 0) ELSE COALESCE(handover_amount, 0) END AS amount
        FROM billing_handovers
        WHERE tenant_id = ?
          AND handover_type = 'counter'
          AND status IN ('pending', 'partial')
        UNION ALL
        SELECT 'cash transfer' AS source_label,
          CASE WHEN status IN ('partial', 'disputed') THEN COALESCE(due_amount, amount, 0) ELSE COALESCE(amount, 0) END AS amount
        FROM billing_counter_cash_transfers
        WHERE tenant_id = ?
          AND status IN ('pending', 'partial', 'disputed')
      )
      SELECT source_label, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS row_count
      FROM pending_handover_sources
      GROUP BY source_label
      ORDER BY amount DESC
    `).bind(tenantId, tenantId),
    db.$client.prepare(`
      SELECT * FROM (
        SELECT
          'handover-' || h.id AS id,
          h.created_at AS occurred_at,
          'pending_handover' AS source_type,
          'counter handover' AS source_label,
          'handover-' || h.id AS reference_no,
          NULL AS counter_name,
          u.name AS user_name,
          CASE WHEN h.status = 'partial' THEN COALESCE(h.due_amount, 0) ELSE COALESCE(h.handover_amount, 0) END AS amount,
          h.status AS status
        FROM billing_handovers h
        LEFT JOIN users u ON u.id = h.handover_by AND u.tenant_id = h.tenant_id
        WHERE h.tenant_id = ?
          AND h.handover_type = 'counter'
          AND h.status IN ('pending', 'partial')

        UNION ALL

        SELECT
          'transfer-' || t.id AS id,
          t.created_at AS occurred_at,
          'pending_handover' AS source_type,
          'cash transfer' AS source_label,
          COALESCE(t.transfer_no, 'transfer-' || t.id) AS reference_no,
          bc.counter_name AS counter_name,
          u.name AS user_name,
          CASE WHEN t.status IN ('partial', 'disputed') THEN COALESCE(t.due_amount, t.amount, 0) ELSE COALESCE(t.amount, 0) END AS amount,
          t.status AS status
        FROM billing_counter_cash_transfers t
        LEFT JOIN billing_counters bc ON bc.id = t.counter_id AND bc.tenant_id = t.tenant_id
        LEFT JOIN users u ON u.id = t.transfer_by AND u.tenant_id = t.tenant_id
        WHERE t.tenant_id = ?
          AND t.status IN ('pending', 'partial', 'disputed')
      )
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, tenantId, page.pageSize, page.offset),
  ]);

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []);
  return {
    sources,
    rows: mapKpiRows((detailsResult.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getDiscountKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  const db = getDb(dbBinding);
  const discountReferenceExpr = `COALESCE(
    NULLIF(TRIM(b.discount_by_name), ''),
    NULLIF(TRIM(b.referred_by_name), ''),
    'Missing'
  )`;
  const billReferenceExpr = `COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id)`;
  const serviceSummaryExpr = `(
    SELECT GROUP_CONCAT(description, ', ')
    FROM (
      SELECT NULLIF(TRIM(ii.description), '') AS description
      FROM invoice_items ii
      WHERE ii.tenant_id = b.tenant_id
        AND ii.bill_id = b.id
        AND COALESCE(ii.status, 'active') != 'cancelled'
      ORDER BY ii.id
      LIMIT 5
    ) service_names
    WHERE description IS NOT NULL
  )`;
  const itemCountExpr = `(
    SELECT COUNT(*)
    FROM invoice_items ii
    WHERE ii.tenant_id = b.tenant_id
      AND ii.bill_id = b.id
      AND COALESCE(ii.status, 'active') != 'cancelled'
  )`;
  const [sourcesResult, detailsResult] = await db.$client.batch([
    db.$client.prepare(`
      SELECT
        ${discountReferenceExpr} AS source_label,
        COALESCE(SUM(COALESCE(b.discount, 0)), 0) AS amount,
        COUNT(*) AS row_count
      FROM bills b
      WHERE b.tenant_id = ?
        AND ${localReportDate('b.created_at')} >= date(?)
        AND ${localReportDate('b.created_at')} <= date(?)
        AND COALESCE(b.discount, 0) > 0
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      GROUP BY source_label
      ORDER BY amount DESC
    `).bind(tenantId, startDate, endDate),
    db.$client.prepare(`
      SELECT
        'discount-' || b.id AS id,
        b.created_at AS occurred_at,
        'discount' AS source_type,
        ${discountReferenceExpr} AS source_label,
        ${billReferenceExpr} AS reference_no,
        NULL AS counter_name,
        u.name AS user_name,
        COALESCE(b.discount, 0) AS amount,
        'applied' AS status,
        b.id AS bill_id,
        ${billReferenceExpr} AS invoice_no,
        p.name AS patient_name,
        p.patient_code AS patient_code,
        ${discountReferenceExpr} AS discount_reference,
        NULLIF(TRIM(b.discount_reason), '') AS discount_reason,
        COALESCE(b.total, 0) + COALESCE(b.discount, 0) AS gross_amount,
        COALESCE(b.discount, 0) AS discount_amount,
        COALESCE(b.total, 0) AS net_amount,
        COALESCE(b.paid, 0) AS paid_amount,
        COALESCE(b.due, 0) AS due_amount,
        ${serviceSummaryExpr} AS service_names,
        ${itemCountExpr} AS item_count
      FROM bills b
      LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      LEFT JOIN users u ON u.id = b.created_by AND u.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND ${localReportDate('b.created_at')} >= date(?)
        AND ${localReportDate('b.created_at')} <= date(?)
        AND COALESCE(b.discount, 0) > 0
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, page.pageSize, page.offset),
  ]);

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []);
  return {
    sources,
    rows: mapKpiRows((detailsResult.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getPendingPostingKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  const db = getDb(dbBinding);
  const [sourcesResult, detailsResult] = await db.$client.batch([
    db.$client.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(ape.status), ''), 'pending') AS source_label,
        COUNT(*) AS amount,
        COUNT(*) AS row_count
      FROM accounting_posting_events ape
      WHERE ape.tenant_id = ?
        AND ${localReportDate('ape.event_date, ape.created_at')} >= date(?)
        AND ${localReportDate('ape.event_date, ape.created_at')} <= date(?)
        AND COALESCE(ape.status, 'pending') IN ('pending', 'failed')
      GROUP BY source_label
      ORDER BY amount DESC
    `).bind(tenantId, startDate, endDate),
    db.$client.prepare(`
      SELECT
        'posting-' || ape.id AS id,
        COALESCE(ape.event_date, ape.created_at) AS occurred_at,
        'pending_posting' AS source_type,
        COALESCE(NULLIF(TRIM(ape.status), ''), 'pending') AS source_label,
        COALESCE(ape.event_type, 'posting_event') AS reference_no,
        NULL AS counter_name,
        NULL AS user_name,
        1 AS amount,
        COALESCE(ape.status, 'pending') AS status
      FROM accounting_posting_events ape
      WHERE ape.tenant_id = ?
        AND ${localReportDate('ape.event_date, ape.created_at')} >= date(?)
        AND ${localReportDate('ape.event_date, ape.created_at')} <= date(?)
        AND COALESCE(ape.status, 'pending') IN ('pending', 'failed')
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, page.pageSize, page.offset),
  ]);

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || []);
  return {
    sources,
    rows: mapKpiRows((detailsResult.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getGlKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  type: 'revenue' | 'expense',
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  const glRows = await getGlBreakdown(dbBinding, tenantId, startDate, endDate, type);
  const sources = glRows.map((row) => ({
    label: row.name || row.code || (type === 'revenue' ? 'Revenue' : 'Expense'),
    amount: roundMoney(row.amount),
    count: Number(row.count ?? 0),
    direction: type === 'revenue' ? 'in' as const : 'out' as const,
  }));
  const detailRows = glRows.slice(page.offset, page.offset + page.pageSize).map((row) => ({
    id: `gl-${type}-${row.code || row.name}`,
    occurred_at: endDate,
    source_type: type === 'revenue' ? 'gl_income' : 'gl_expense',
    source_label: row.name || row.code || (type === 'revenue' ? 'Revenue' : 'Expense'),
    reference_no: row.code || row.name,
    counter_name: null,
    user_name: null,
    amount: row.amount,
    status: 'verified',
  }));
  return {
    sources,
    rows: mapKpiRows(detailRows),
    totalRows: glRows.length,
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getGlProfitKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  const [income, expenses] = await Promise.all([
    getGlKpiBreakdown(dbBinding, tenantId, startDate, endDate, 'revenue'),
    getGlKpiBreakdown(dbBinding, tenantId, startDate, endDate, 'expense'),
  ]);
  const expenseSources = expenses.sources.map((source) => ({ ...source, amount: -Math.abs(source.amount), direction: 'out' as const }));
  const expenseRows = expenses.rows.map((row) => ({ ...row, amount: -Math.abs(row.amount) }));
  const rows = [...income.rows, ...expenseRows]
    .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')))
    .slice(page.offset, page.offset + page.pageSize);
  return {
    sources: [...income.sources, ...expenseSources],
    rows,
    totalRows: Number(income.totalRows ?? 0) + Number(expenses.totalRows ?? 0),
    total: Number(income.total ?? 0) - Math.abs(Number(expenses.total ?? 0)),
  };
}

async function getIncomeReturnKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
  includeDetails = true,
) {
  const db = getDb(dbBinding);
  const batchResults = await db.$client.batch([
    db.$client.prepare(`
      SELECT
        'Sales returns / refunds' AS source_label,
        COALESCE(SUM(ABS(e.amount)), 0) AS amount,
        COUNT(*) AS row_count
      FROM emp_cash_transactions e
      WHERE e.tenant_id = ?
        AND e.transaction_type = 'SalesReturn'
        AND ${localReportDate('e.transaction_date, e.created_at')} >= date(?)
        AND ${localReportDate('e.transaction_date, e.created_at')} <= date(?)
      GROUP BY source_label
    `).bind(tenantId, startDate, endDate),
    ...(includeDetails ? [db.$client.prepare(`
      SELECT
        'income-return-' || e.id AS id,
        COALESCE(e.transaction_date, e.created_at) AS occurred_at,
        'income_return' AS source_type,
        'Sales returns / refunds' AS source_label,
        COALESCE(NULLIF(TRIM(e.description), ''), NULLIF(TRIM(CAST(e.reference_id AS TEXT)), ''), 'RETURN-' || e.id) AS reference_no,
        bc.counter_name,
        u.name AS user_name,
        ABS(e.amount) AS amount,
        'paid' AS status,
        NULL AS bill_id,
        NULL AS invoice_no,
        NULL AS patient_name,
        NULL AS patient_code,
        e.payment_method,
        NULL AS discount_reference,
        NULL AS discount_reason,
        'Sales return / refund' AS service_names,
        1 AS item_count,
        NULL AS gross_amount,
        NULL AS discount_amount,
        NULL AS net_amount,
        NULL AS paid_amount,
        NULL AS due_amount
      FROM emp_cash_transactions e
      LEFT JOIN billing_counters bc ON bc.id = e.counter_id AND bc.tenant_id = e.tenant_id
      LEFT JOIN users u ON u.id = e.employee_id AND u.tenant_id = e.tenant_id
      WHERE e.tenant_id = ?
        AND e.transaction_type = 'SalesReturn'
        AND ${localReportDate('e.transaction_date, e.created_at')} >= date(?)
        AND ${localReportDate('e.transaction_date, e.created_at')} <= date(?)
      ORDER BY occurred_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, startDate, endDate, page.pageSize, page.offset)] : []),
  ]);
  const sourcesResult = batchResults[0];
  const detailsResult = includeDetails ? batchResults[1] : undefined;

  const sources = mapKpiSources((sourcesResult.results as unknown as KpiBreakdownSourceRow[]) || [])
    .filter((source) => source.amount !== 0 || source.count !== 0);
  return {
    sources,
    rows: mapKpiRows((detailsResult?.results as unknown as KpiBreakdownDetailRow[]) || []),
    totalRows: sourceRowCount(sources),
    total: sources.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function getAccountingProfitKpiBreakdown(
  dbBinding: Env['DB'],
  tenantId: string,
  startDate: string,
  endDate: string,
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  // Each source is independently ordered. Fetch through the requested global offset
  // from every source before merging, otherwise page 2 can be empty or incomplete.
  const mergePage: KpiBreakdownPage = {
    page: 1,
    pageSize: page.offset + page.pageSize,
    offset: 0,
  };
  const [income, expenses] = await Promise.all([
    getManagementCollectionKpiBreakdown(dbBinding, tenantId, startDate, endDate, mergePage),
    getAccountingExpenseKpiBreakdown(dbBinding, tenantId, startDate, endDate, mergePage),
  ]);

  const expenseSources = expenses.sources.map((source) => ({
    ...source,
    amount: -Math.abs(source.amount),
    direction: 'out' as const,
  }));
  const incomeSources = income.sources.map((source) => ({
    ...source,
    direction: 'in' as const,
  }));
  const expenseRows = expenses.rows.map((row) => ({
    ...row,
    amount: -Math.abs(row.amount),
  }));

  return {
    sources: [...incomeSources, ...expenseSources],
    rows: [...income.rows, ...expenseRows]
      .sort((a, b) => String(b.occurredAt || '').localeCompare(String(a.occurredAt || '')))
      .slice(page.offset, page.offset + page.pageSize),
    totalRows: Number(income.totalRows ?? income.rows.length)
      + Number(expenses.totalRows ?? expenses.rows.length),
    total: Number(income.total ?? income.sources.reduce((sum, row) => sum + row.amount, 0))
      - Math.abs(Number(expenses.total ?? expenses.sources.reduce((sum, row) => sum + row.amount, 0))),
  };
}

function emptyKpiBreakdown() {
  return { sources: [] as ReturnType<typeof mapKpiSources>, rows: [] as ReturnType<typeof mapKpiRows> };
}

function buildKpiBreakdownPayload(
  metric: KpiBreakdownMetric,
  period: { startDate: string; endDate: string; label: string },
  breakdown: {
    sources: Array<{
      label: string;
      amount: number;
      count: number;
      direction?: 'in' | 'out';
      key?: string;
      doctorId?: number;
    }>;
    rows: Array<ReturnType<typeof mapKpiRows>[number]>;
    totalRows?: number;
    total?: number;
  },
  valueType: 'money' | 'count' = 'money',
  page: KpiBreakdownPage = DEFAULT_KPI_BREAKDOWN_PAGE,
) {
  return {
    metric,
    title: kpiBreakdownTitle(metric),
    total: roundMoney(Number(breakdown.total ?? breakdown.sources.reduce((sum, row) => sum + row.amount, 0))),
    period,
    valueType,
    totalRows: Number(breakdown.totalRows ?? sourceRowCount(breakdown.sources) ?? breakdown.rows.length),
    page: page.page,
    pageSize: page.pageSize,
    hasNextPage: page.offset + breakdown.rows.length < Number(breakdown.totalRows ?? sourceRowCount(breakdown.sources) ?? breakdown.rows.length),
    sources: breakdown.sources.map((row) => ({
      label: row.label,
      amount: row.amount,
      count: row.count,
      direction: row.direction,
      ...(row.key !== undefined ? { key: row.key } : {}),
      ...(row.doctorId !== undefined ? { doctorId: row.doctorId } : {}),
    })),
    rows: breakdown.rows,
  };
}

dashboardRoutes.get('/kpi-config', adminGuard, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(`
    SELECT metric_key, enabled, position, label_override
    FROM dashboard_kpi_config
    WHERE tenant_id = ? AND dashboard_key = ?
  `).bind(tenantId, EXECUTIVE_DASHBOARD_KEY).all<DashboardKpiConfigRow>();

  return c.json({
    dashboardKey: EXECUTIVE_DASHBOARD_KEY,
    items: mergeExecutiveKpiConfig(results || []),
  });
});

dashboardRoutes.put('/kpi-config', dashboardConfigWriteGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const actorId = String(c.get('userId') ?? '');
  const body = await c.req.json().catch(() => null) as { items?: unknown } | null;
  if (!body || !Array.isArray(body.items) || body.items.length > EXECUTIVE_KPI_REGISTRY.length) {
    return c.json({ error: 'items must be an array of dashboard KPI overrides' }, 400);
  }

  const allowedKeys = new Set(['metricKey', 'enabled', 'position', 'labelOverride']);
  const seen = new Set<string>();
  const normalized: Array<{
    metricKey: ExecutiveKpiMetricKey;
    enabled: boolean;
    position: number;
    labelOverride: string | null;
  }> = [];

  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return c.json({ error: 'Each KPI override must be an object' }, 400);
    }
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => !allowedKeys.has(key))) {
      return c.json({ error: 'Unsupported KPI configuration field' }, 400);
    }
    const metricKey = typeof item.metricKey === 'string' ? item.metricKey : '';
    if (!isExecutiveKpiMetric(metricKey) || seen.has(metricKey)) {
      return c.json({ error: 'Unknown or duplicate dashboard KPI metric' }, 400);
    }
    if (typeof item.enabled !== 'boolean' || !Number.isInteger(item.position) || Number(item.position) < 0 || Number(item.position) > 100) {
      return c.json({ error: 'Invalid enabled or position value' }, 400);
    }
    if (item.labelOverride !== null && item.labelOverride !== undefined && typeof item.labelOverride !== 'string') {
      return c.json({ error: 'labelOverride must be a string or null' }, 400);
    }
    const labelOverride = typeof item.labelOverride === 'string' ? item.labelOverride.trim() : null;
    if (labelOverride && labelOverride.length > 60) {
      return c.json({ error: 'labelOverride must be 60 characters or fewer' }, 400);
    }
    seen.add(metricKey);
    normalized.push({
      metricKey,
      enabled: item.enabled,
      position: Number(item.position),
      labelOverride: labelOverride || null,
    });
  }

  const db = getDb(c.env.DB);
  if (normalized.length > 0) {
    await db.$client.batch(normalized.map((item) => db.$client.prepare(`
      INSERT INTO dashboard_kpi_config (
        tenant_id, dashboard_key, metric_key, enabled, position, label_override, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
      ON CONFLICT (tenant_id, dashboard_key, metric_key) DO UPDATE SET
        enabled = excluded.enabled,
        position = excluded.position,
        label_override = excluded.label_override,
        updated_by = excluded.updated_by,
        updated_at = datetime('now', '+6 hours')
    `).bind(
      tenantId,
      EXECUTIVE_DASHBOARD_KEY,
      item.metricKey,
      item.enabled ? 1 : 0,
      item.position,
      item.labelOverride,
      actorId,
    )));
  }

  const { results } = await db.$client.prepare(`
    SELECT metric_key, enabled, position, label_override
    FROM dashboard_kpi_config
    WHERE tenant_id = ? AND dashboard_key = ?
  `).bind(tenantId, EXECUTIVE_DASHBOARD_KEY).all<DashboardKpiConfigRow>();

  return c.json({
    dashboardKey: EXECUTIVE_DASHBOARD_KEY,
    items: mergeExecutiveKpiConfig(results || []),
  });
});

// GET / — aggregated overview (backward compat)
dashboardRoutes.get('/', adminGuard, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const today = getTodayGMT6();
    const [patients, revenue, appointments] = await Promise.all([
      db.$client.prepare('SELECT COUNT(*) as cnt FROM patients WHERE tenant_id = ?')
        .bind(tenantId).first<{ cnt: number }>(),
      db.$client.prepare('SELECT COALESCE(SUM(total),0) as total, COALESCE(SUM(due),0) as due FROM bills WHERE tenant_id = ?')
        .bind(tenantId).first<{ total: number; due: number }>(),
      db.$client.prepare(`SELECT COUNT(*) as cnt FROM appointments WHERE tenant_id = ? AND ${localReportDate('created_at')} = date(?)`)
        .bind(tenantId, today).first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    ]);
    return c.json({
      totalPatients: patients?.cnt ?? 0,
      todayAppointments: appointments?.cnt ?? 0,
      totalRevenue: revenue?.total ?? 0,
      pendingDue: revenue?.due ?? 0,
    });
  } catch {
    return c.json({ totalPatients: 0, todayAppointments: 0, totalRevenue: 0, pendingDue: 0 });
  }
});

// Get dashboard stats
dashboardRoutes.get('/stats', adminGuard, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  // Optional ?date=YYYY-MM-DD override. Empty / missing → today (GMT+6).
  // Optional ?range=today|7d|30d drives aggregate/trend windows for executive views.
  const dateParam = c.req.query('date');
  if (!validateDashboardDateParam(dateParam)) {
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  }
  const rangeParam = c.req.query('range') || 'today';
  const rangeDays = dashboardRangeDays(rangeParam);
  if (rangeDays === null) {
    return c.json({ error: 'range must be today, 7d, or 30d' }, 400);
  }
  const today = dateParam || getTodayGMT6();
  const financeToday = today;
  const periodStartStr = addDaysGMT6(today, -(rangeDays - 1));
  const revenueTrendStartStr = rangeDays > 1 ? periodStartStr : addDaysGMT6(today, -6);
  const revenueTrendDays = rangeDays > 1 ? rangeDays : 7;
  const sevenDaysAgoStr = addDaysGMT6(today, -6);

  try {
    const currentMonth = today.slice(0, 7);
    const lastMonth = previousMonthGMT6(currentMonth);
    const currentMonthStart = `${currentMonth}-01`;
    const currentMonthEnd = monthEndDate(currentMonth);
    const lastMonthStart = `${lastMonth}-01`;
    const lastMonthEnd = monthEndDate(lastMonth);

    // Week-over-week comparison dates
    const thisWeekStartStr = startOfWeekGMT6(today);
    const lastWeekStartStr = addDaysGMT6(thisWeekStartStr, -7);
    const lastWeekEndStr = addDaysGMT6(thisWeekStartStr, -1);

    // ⚡ BOLT OPTIMIZATION:
    // Replaced Promise.all() with db.$client.batch() for dashboard stats.
    const batchResults = await db.$client.batch([
      // Total patients
      db.$client.prepare('SELECT COUNT(*) as count FROM patients WHERE tenant_id = ?').bind(tenantId),
      // Today's patients
      db.$client.prepare(`SELECT COUNT(*) as count FROM patients WHERE tenant_id = ? AND ${localReportDate('created_at')} = date(?)`).bind(tenantId, today),
      // Diagnostic stats from lab order items and billed test items.
      db.$client.prepare(`
        WITH diagnostic_items AS (
          SELECT loi.id, COALESCE(loi.status, 'pending') AS status, COALESCE(loi.completed_at, lo.order_date, lo.created_at) AS activity_at
          FROM lab_order_items loi
          LEFT JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
          WHERE loi.tenant_id = ?
          UNION ALL
          SELECT bi.id, 'pending' AS status, COALESCE(bi.created_at, b.created_at) AS activity_at
          FROM bill_items bi
          LEFT JOIN bills b ON b.id = bi.bill_id AND b.tenant_id = bi.tenant_id
          WHERE bi.tenant_id = ?
            AND LOWER(COALESCE(bi.item_category, '')) IN ('lab', 'test', 'diagnostic', 'diagnostics')
            AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        )
        SELECT
          SUM(CASE WHEN status IN ('pending', 'collected', 'received', 'processing') THEN 1 ELSE 0 END) as pending,
          SUM(CASE
            WHEN status IN ('completed', 'verified', 'delivered', 'reported', 'ready')
             AND ${localReportDate('activity_at')} = date(?)
            THEN 1 ELSE 0 END) as completed
        FROM diagnostic_items
      `).bind(tenantId, tenantId, today),
      // Bill stats (pending bills and total revenue)
      db.$client.prepare(`
        SELECT
          SUM(CASE WHEN due > 0 THEN 1 ELSE 0 END) as pending_bills,
          SUM(total) as total_revenue
        FROM bills WHERE tenant_id = ?
      `).bind(tenantId),
      // Staff count
      db.$client.prepare('SELECT COUNT(*) as count FROM staff WHERE tenant_id = ?').bind(tenantId),
      // Low stock medicines count
      db.$client.prepare('SELECT COUNT(*) as count FROM medicines WHERE tenant_id = ? AND quantity < 10').bind(tenantId),
      // Collection trend for the selected window. Use the same source-selection
      // rule as the daily collection report: posted ledger events when they cover
      // operational payments, otherwise operational payments as fallback.
      db.$client.prepare(`
        WITH ledger_by_day AS (
          SELECT
            ${localReportDate("event_date, created_at")} AS date,
            COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) AS total
          FROM accounting_posting_events
          WHERE tenant_id = ?
            AND event_type = 'payment_received'
            AND status = 'posted'
            AND ${localReportDate("event_date, created_at")} >= date(?)
            AND ${localReportDate("event_date, created_at")} <= date(?)
          GROUP BY ${localReportDate("event_date, created_at")}
        ),
        payment_by_day AS (
          SELECT
            ${localReportDate('date, created_at')} AS date,
            COALESCE(SUM(amount), 0) AS total
          FROM payments
          WHERE tenant_id = ?
            AND ${localReportDate('date, created_at')} >= date(?)
            AND ${localReportDate('date, created_at')} <= date(?)
          GROUP BY ${localReportDate('date, created_at')}
        ),
        refund_by_day AS (
          SELECT
            ${localReportDate('transaction_date, created_at')} AS date,
            COALESCE(SUM(ABS(amount)), 0) AS total
          FROM emp_cash_transactions
          WHERE tenant_id = ?
            AND transaction_type = 'SalesReturn'
            AND ${localReportDate('transaction_date, created_at')} >= date(?)
            AND ${localReportDate('transaction_date, created_at')} <= date(?)
          GROUP BY ${localReportDate('transaction_date, created_at')}
        ),
        source_choice AS (
          SELECT
            COALESCE((SELECT SUM(total) FROM ledger_by_day), 0) AS ledger_total,
            COALESCE((SELECT SUM(total) FROM payment_by_day), 0) AS payment_total
        ),
        selected_gross AS (
          SELECT date, total FROM ledger_by_day, source_choice
          WHERE source_choice.ledger_total >= source_choice.payment_total
            AND source_choice.ledger_total > 0
          UNION ALL
          SELECT date, total FROM payment_by_day, source_choice
          WHERE NOT (
            source_choice.ledger_total >= source_choice.payment_total
            AND source_choice.ledger_total > 0
          )
        )
        SELECT
          selected_gross.date,
          MAX(0, selected_gross.total - COALESCE(refund_by_day.total, 0)) AS total
        FROM selected_gross
        LEFT JOIN refund_by_day ON refund_by_day.date = selected_gross.date
        ORDER BY selected_gross.date
      `).bind(
        tenantId, revenueTrendStartStr, financeToday,
        tenantId, revenueTrendStartStr, financeToday,
        tenantId, revenueTrendStartStr, financeToday,
      ),
      // Recent Activity (Audit Logs)
      db.$client.prepare(`
        SELECT al.id, al.action, al.table_name as tableName, al.record_id as recordId, al.new_value as newValue, al.created_at as createdAt, u.name as userName,
               ${buildAuditBillStateSelect('b')}
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id AND u.tenant_id = al.tenant_id
        LEFT JOIN bills b
          ON al.tenant_id = b.tenant_id
          AND al.table_name IN ('bills', 'billing')
          AND al.record_id = b.id
        WHERE al.tenant_id = ?
        ORDER BY al.created_at DESC
        LIMIT 15
      `).bind(tenantId),
      // Revenue This Month
      db.$client.prepare(`
        SELECT SUM(total) as total FROM bills 
        WHERE tenant_id = ?
          AND ${localReportDate('created_at')} BETWEEN date(?) AND date(?)
          AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      `).bind(tenantId, currentMonthStart, currentMonthEnd),
      // Revenue Last Month
      db.$client.prepare(`
        SELECT SUM(total) as total FROM bills 
        WHERE tenant_id = ?
          AND ${localReportDate('created_at')} BETWEEN date(?) AND date(?)
          AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      `).bind(tenantId, lastMonthStart, lastMonthEnd),
      // Revenue This Week
      db.$client.prepare(`
        SELECT COALESCE(SUM(total), 0) as total FROM bills
        WHERE tenant_id = ?
          AND ${localReportDate('created_at')} >= date(?)
          AND ${localReportDate('created_at')} <= date(?)
          AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      `).bind(tenantId, thisWeekStartStr, financeToday),
      // Revenue Last Week
      db.$client.prepare(`
        SELECT COALESCE(SUM(total), 0) as total FROM bills
        WHERE tenant_id = ?
          AND ${localReportDate('created_at')} >= date(?)
          AND ${localReportDate('created_at')} <= date(?)
          AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      `).bind(tenantId, lastWeekStartStr, lastWeekEndStr),
      db.$client.prepare(`
        WITH ledger_total AS (
          SELECT COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) AS total
          FROM accounting_posting_events
          WHERE tenant_id = ?
            AND event_type = 'payment_received'
            AND status = 'posted'
            AND ${localReportDate("event_date, created_at")} = date(?)
        ),
        payment_total AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM payments
          WHERE tenant_id = ?
            AND ${localReportDate('date, created_at')} = date(?)
        ),
        refund_total AS (
          SELECT COALESCE(SUM(ABS(amount)), 0) AS total
          FROM emp_cash_transactions
          WHERE tenant_id = ?
            AND transaction_type = 'SalesReturn'
            AND ${localReportDate('transaction_date, created_at')} = date(?)
        ),
        selected_gross AS (
          SELECT CASE
            WHEN (SELECT total FROM ledger_total) >= (SELECT total FROM payment_total)
              AND (SELECT total FROM ledger_total) > 0
            THEN (SELECT total FROM ledger_total)
            ELSE (SELECT total FROM payment_total)
          END AS total
        )
        SELECT MAX(0, selected_gross.total - (SELECT total FROM refund_total)) AS today_collection_total
        FROM selected_gross
      `).bind(tenantId, financeToday, tenantId, financeToday, tenantId, financeToday),
      db.$client.prepare(`
        WITH pending_handover_sources AS (
          SELECT
            CASE WHEN status = 'partial' THEN COALESCE(due_amount, 0) ELSE COALESCE(handover_amount, 0) END AS amount
          FROM billing_handovers
          WHERE tenant_id = ?
            AND handover_type = 'counter'
            AND status IN ('pending', 'partial')
          UNION ALL
          SELECT
            CASE WHEN status IN ('partial', 'disputed') THEN COALESCE(due_amount, amount, 0) ELSE COALESCE(amount, 0) END AS amount
          FROM billing_counter_cash_transfers
          WHERE tenant_id = ?
            AND status IN ('pending', 'partial', 'disputed')
        )
        SELECT
          COALESCE(SUM(amount), 0) AS pending_handover_amount,
          COUNT(*) AS pending_handover_count
        FROM pending_handover_sources
      `).bind(tenantId, tenantId),
      db.$client.prepare(`
        SELECT COALESCE(SUM(${billOutstandingDueExpr('b')}), 0) AS patient_due_total
        FROM bills b
        WHERE b.tenant_id = ?
          AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0)
          AS patient_advance_total
        FROM billing_deposits
        WHERE tenant_id = ?
          AND is_active = 1
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS today_deposit_total
        FROM billing_deposits
        WHERE tenant_id = ?
          AND transaction_type = 'deposit'
          AND is_active = 1
          AND ${localReportDate('created_at')} = date(?)
      `).bind(tenantId, financeToday),
      db.$client.prepare(`
        SELECT COUNT(*) AS pending_posting_events
        FROM accounting_posting_events
        WHERE tenant_id = ?
          AND status = 'pending'
      `).bind(tenantId),
      // ── Today Summary additions ──
      // Today's appointments
      db.$client.prepare(`
        SELECT COUNT(*) as count FROM appointments
        WHERE tenant_id = ? AND date(appt_date) = ?
      `).bind(tenantId, today),
      // Today's completed consultations (visits)
      db.$client.prepare(`
        SELECT COUNT(*) as count FROM visits
        WHERE tenant_id = ? AND ${localReportDate('visit_date')} = date(?) AND status IN ('completed', 'closed')
      `).bind(tenantId, today),
      // Today's pharmacy sales
      db.$client.prepare(`
        SELECT COALESCE(SUM(net_amount), 0) as total, COUNT(*) as count FROM pharmacy_sales
        WHERE tenant_id = ? AND ${localReportDate('created_at')} = date(?) AND status = 'completed'
      `).bind(tenantId, today),
      // Today's admitted patients
      db.$client.prepare(`
        SELECT COUNT(*) as count FROM admissions
        WHERE tenant_id = ? AND ${localReportDate('admission_date')} = date(?) AND status IN ('admitted', 'critical')
      `).bind(tenantId, today),
      // Today's discharged patients
      db.$client.prepare(`
        SELECT COUNT(*) as count FROM admissions
        WHERE tenant_id = ? AND ${localReportDate('discharge_date')} = date(?) AND status = 'discharged'
      `).bind(tenantId, today),
      // ── Financial Summary additions ──
      // Weekly collection (same source-selection rule as daily collection report)
      db.$client.prepare(`
        WITH ledger_total AS (
          SELECT COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) AS total
          FROM accounting_posting_events
          WHERE tenant_id = ?
            AND event_type = 'payment_received'
            AND status = 'posted'
            AND ${localReportDate("event_date, created_at")} >= date(?)
            AND ${localReportDate("event_date, created_at")} <= date(?)
        ),
        payment_total AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM payments
          WHERE tenant_id = ?
            AND ${localReportDate('date, created_at')} >= date(?)
            AND ${localReportDate('date, created_at')} <= date(?)
        ),
        refund_total AS (
          SELECT COALESCE(SUM(ABS(amount)), 0) AS total
          FROM emp_cash_transactions
          WHERE tenant_id = ?
            AND transaction_type = 'SalesReturn'
            AND ${localReportDate('transaction_date, created_at')} >= date(?)
            AND ${localReportDate('transaction_date, created_at')} <= date(?)
        ),
        selected_gross AS (
          SELECT CASE
            WHEN (SELECT total FROM ledger_total) >= (SELECT total FROM payment_total)
              AND (SELECT total FROM ledger_total) > 0
            THEN (SELECT total FROM ledger_total)
            ELSE (SELECT total FROM payment_total)
          END AS total
        )
        SELECT MAX(0, selected_gross.total - (SELECT total FROM refund_total)) AS total
        FROM selected_gross
      `).bind(
        tenantId, sevenDaysAgoStr, financeToday,
        tenantId, sevenDaysAgoStr, financeToday,
        tenantId, sevenDaysAgoStr, financeToday,
      ),
      // Cashier-wise collection today (same source-selection rule as daily collection report)
      db.$client.prepare(`
        WITH ledger_by_cashier AS (
          SELECT
            CAST(created_by AS INTEGER) AS cashier_id,
            COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) AS total_collected
          FROM accounting_posting_events
          WHERE tenant_id = ?
            AND event_type = 'payment_received'
            AND status = 'posted'
            AND ${localReportDate("event_date, created_at")} = date(?)
          GROUP BY CAST(created_by AS INTEGER)
        ),
        payment_by_cashier AS (
          SELECT
            received_by AS cashier_id,
            COALESCE(SUM(amount), 0) AS total_collected
          FROM payments
          WHERE tenant_id = ?
            AND ${localReportDate('date, created_at')} = date(?)
          GROUP BY received_by
        ),
        refund_by_cashier AS (
          SELECT
            employee_id AS cashier_id,
            COALESCE(SUM(ABS(amount)), 0) AS refund_amount
          FROM emp_cash_transactions
          WHERE tenant_id = ?
            AND transaction_type = 'SalesReturn'
            AND ${localReportDate('transaction_date, created_at')} = date(?)
          GROUP BY employee_id
        ),
        source_choice AS (
          SELECT
            COALESCE((SELECT SUM(total_collected) FROM ledger_by_cashier), 0) AS ledger_total,
            COALESCE((SELECT SUM(total_collected) FROM payment_by_cashier), 0) AS payment_total
        ),
        selected AS (
          SELECT cashier_id, total_collected FROM ledger_by_cashier, source_choice
          WHERE source_choice.ledger_total >= source_choice.payment_total
            AND source_choice.ledger_total > 0
          UNION ALL
          SELECT cashier_id, total_collected FROM payment_by_cashier, source_choice
          WHERE NOT (
            source_choice.ledger_total >= source_choice.payment_total
            AND source_choice.ledger_total > 0
          )
        )
        SELECT
          u.name as cashier_name,
          MAX(0, selected.total_collected - COALESCE(refund_by_cashier.refund_amount, 0)) AS total_collected
        FROM selected
        LEFT JOIN refund_by_cashier ON refund_by_cashier.cashier_id = selected.cashier_id
        LEFT JOIN users u ON u.id = selected.cashier_id AND u.tenant_id = ?
        ORDER BY total_collected DESC
        LIMIT 10
      `).bind(tenantId, financeToday, tenantId, financeToday, tenantId, financeToday, tenantId),
      // Due collection today (same source-selection rule as daily collection report)
      db.$client.prepare(`
        WITH ledger_total AS (
          SELECT COALESCE(SUM(CAST(json_extract(payload_json, '$.amount') AS REAL)), 0) AS total
          FROM accounting_posting_events
          WHERE tenant_id = ?
            AND event_type = 'payment_received'
            AND status = 'posted'
            AND json_extract(payload_json, '$.paymentType') = 'due'
            AND ${localReportDate("event_date, created_at")} = date(?)
        ),
        payment_total AS (
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM payments
          WHERE tenant_id = ?
            AND payment_type = 'due'
            AND ${localReportDate('date, created_at')} = date(?)
        )
        SELECT
          CASE
            WHEN (SELECT total FROM ledger_total) >= (SELECT total FROM payment_total)
              AND (SELECT total FROM ledger_total) > 0
            THEN (SELECT total FROM ledger_total)
            ELSE (SELECT total FROM payment_total)
          END AS total
      `).bind(tenantId, financeToday, tenantId, financeToday),
      // ── Patient Summary additions ──
      // Returning patients today (patients with more than 1 visit ever)
      db.$client.prepare(`
        SELECT COUNT(DISTINCT v.patient_id) as count
        FROM visits v
        WHERE v.tenant_id = ? AND ${localReportDate('v.visit_date')} = date(?)
          AND v.patient_id IN (
            SELECT patient_id FROM visits WHERE tenant_id = ? GROUP BY patient_id HAVING COUNT(*) > 1
          )
      `).bind(tenantId, today, tenantId),
      // OPD/IPD/Emergency patient split today
      db.$client.prepare(`
        SELECT
          SUM(CASE WHEN (visit_type = 'opd' OR visit_type IS NULL) AND COALESCE(admission_flag, 0) != 1 THEN 1 ELSE 0 END) as opd,
          SUM(CASE WHEN visit_type = 'ipd' OR admission_flag = 1 THEN 1 ELSE 0 END) as ipd,
          SUM(CASE WHEN visit_type = 'emergency' THEN 1 ELSE 0 END) as emergency
        FROM visits
        WHERE tenant_id = ? AND ${localReportDate('visit_date')} = date(?)
      `).bind(tenantId, today),
      // ── Lab Summary ──
      // Daily lab income
      db.$client.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM income
        WHERE tenant_id = ? AND date = ? AND source = 'laboratory'
      `).bind(tenantId, today),
      // ── Bed Dashboard ──
      // Bed status summary (available, occupied, cleaning, maintenance, reserved)
      db.$client.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
          SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
          SUM(CASE WHEN status = 'cleaning' THEN 1 ELSE 0 END) as cleaning,
          SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance,
          SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved
        FROM beds WHERE tenant_id = ?
      `).bind(tenantId),
      // ── Today's total discount ──
      db.$client.prepare(`
        SELECT COALESCE(SUM(discount), 0) as total_discount
        FROM bills
        WHERE tenant_id = ? AND ${localReportDate('created_at')} = date(?)
          AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      `).bind(tenantId, today),
      // ── Today's cash-basis expense (paid operating expense + doctor payouts) ──
      db.$client.prepare(`
        SELECT
          COALESCE((
            SELECT SUM(e.amount)
            FROM expenses e
            WHERE e.tenant_id = ?
              AND e.date = ?
              AND COALESCE(e.status, 'approved') != 'rejected'
              AND (COALESCE(e.payment_status, 'unpaid') = 'paid' OR e.cash_movement_id IS NOT NULL)
          ), 0)
          + COALESCE((
            SELECT SUM(m.amount)
            FROM cash_drawer_movements m
            WHERE m.tenant_id = ?
              AND m.movement_type = 'cash_out'
              AND m.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
              AND ${localReportDate('m.created_at')} = date(?)
          ), 0) AS total_expense
      `).bind(tenantId, today, tenantId, today),
      // ── Department-wise revenue today ──
      db.$client.prepare(`
        SELECT
          COALESCE(item_category, 'other') as department,
          COALESCE(SUM(line_total), 0) as total
        FROM bill_items
        WHERE tenant_id = ? AND ${localReportDate('created_at')} = date(?)
          AND bill_id IN (
            SELECT id FROM bills WHERE tenant_id = ? AND ${localReportDate('created_at')} = date(?)
              AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
          )
        GROUP BY item_category
        ORDER BY total DESC
      `).bind(tenantId, today, tenantId, today),
      // ── Active doctors today (doctors with appointments or visits today) ──
      db.$client.prepare(`
        SELECT COUNT(DISTINCT doctor_id) as count
        FROM appointments
        WHERE tenant_id = ? AND appt_date = ? AND status NOT IN ('cancelled', 'no_show')
      `).bind(tenantId, today),
    ]);

    const [
      totalPatientsBatch,
      todayPatientsBatch,
      testStatsBatch,
      billStatsBatch,
      staffCountBatch,
      lowStockBatch,
      incomeBatch,
      recentActivityBatch,
      thisMonthRevenueBatch,
      lastMonthRevenueBatch,
      thisWeekRevenueBatch,
      lastWeekRevenueBatch,
      todayCollectionBatch,
      pendingHandoverBatch,
      patientDueBatch,
      patientAdvanceBatch,
      todayDepositBatch,
      pendingPostingBatch,
      todayAppointmentsBatch,
      todayConsultationsBatch,
      pharmacySalesBatch,
      todayAdmittedBatch,
      todayDischargedBatch,
      weeklyIncomeBatch,
      cashierCollectionBatch,
      dueCollectionBatch,
      returningPatientsBatch,
      patientTypeSplitBatch,
      dailyLabIncomeBatch,
      bedStatusBatch,
      todayDiscountBatch,
      todayExpenseBatch,
      departmentRevenueBatch,
      activeDoctorsBatch,
    ] = batchResults;

    const totalPatientsResult = totalPatientsBatch.results[0] as {count: number} | undefined;
    const todayPatientsResult = todayPatientsBatch.results[0] as {count: number} | undefined;
    const testStatsResult = testStatsBatch.results[0] as {pending: number, completed: number} | undefined;
    const billStatsResult = billStatsBatch.results[0] as {pending_bills: number, total_revenue: number} | undefined;
    const staffCountResult = staffCountBatch.results[0] as {count: number} | undefined;
    const lowStockResult = lowStockBatch.results[0] as {count: number} | undefined;
    const incomeList = (incomeBatch.results || []) as { date: string; total: number }[];
    const thisMonthRevenue = (thisMonthRevenueBatch.results[0] as {total: number} | undefined)?.total || 0;
    const lastMonthRevenue = (lastMonthRevenueBatch.results[0] as {total: number} | undefined)?.total || 0;
    const thisWeekRevenue = Number((thisWeekRevenueBatch.results[0] as {total: number} | undefined)?.total || 0);
    const lastWeekRevenue = Number((lastWeekRevenueBatch.results[0] as {total: number} | undefined)?.total || 0);
    const todayCollection = todayCollectionBatch.results[0] as { today_collection_total?: number } | undefined;
    const pendingHandover = pendingHandoverBatch.results[0] as { pending_handover_amount?: number; pending_handover_count?: number } | undefined;
    const patientDue = patientDueBatch.results[0] as { patient_due_total?: number } | undefined;
    const patientAdvance = patientAdvanceBatch.results[0] as { patient_advance_total?: number } | undefined;
    const todayDeposit = todayDepositBatch.results[0] as { today_deposit_total?: number } | undefined;
    const pendingPosting = pendingPostingBatch.results[0] as { pending_posting_events?: number } | undefined;
    // ── New batch results ──
    const todayAppointments = todayAppointmentsBatch.results[0] as { count: number } | undefined;
    const todayConsultations = todayConsultationsBatch.results[0] as { count: number } | undefined;
    const pharmacySales = pharmacySalesBatch.results[0] as { total: number; count: number } | undefined;
    const todayAdmitted = todayAdmittedBatch.results[0] as { count: number } | undefined;
    const todayDischarged = todayDischargedBatch.results[0] as { count: number } | undefined;
    const weeklyIncome = weeklyIncomeBatch.results[0] as { total: number } | undefined;
    const cashierCollection = (cashierCollectionBatch.results || []) as { cashier_name: string; total_collected: number }[];
    const dueCollection = dueCollectionBatch.results[0] as { total: number } | undefined;
    const returningPatients = returningPatientsBatch.results[0] as { count: number } | undefined;
    const patientTypeSplit = patientTypeSplitBatch.results[0] as { opd: number; ipd: number; emergency: number } | undefined;
    const dailyLabIncome = dailyLabIncomeBatch.results[0] as { total: number } | undefined;
    const bedStatus = bedStatusBatch.results[0] as { total: number; available: number; occupied: number; cleaning: number; maintenance: number; reserved: number } | undefined;
    const todayDiscount = todayDiscountBatch.results[0] as { total_discount: number } | undefined;
    const todayExpense = todayExpenseBatch.results[0] as { total_expense: number } | undefined;
    const departmentRevenue = (departmentRevenueBatch.results || []) as { department: string; total: number }[];
    const activeDoctors = activeDoctorsBatch.results[0] as { count: number } | undefined;

    // Format revenue data for chart. Today defaults to a 7-day trend; range tabs show the full selected window.
    const revenueData: { day: string; revenue: number }[] = [];
    for (let i = revenueTrendDays - 1; i >= 0; i--) {
      const dateStr = addDaysGMT6(today, -i);
      const dayName = new Date(`${dateStr}T12:00:00+06:00`).toLocaleDateString('en-US', {
        ...(revenueTrendDays > 7 ? { month: 'short', day: 'numeric' } : { weekday: 'short' }),
        timeZone: 'Asia/Dhaka',
      });
      
      const found = incomeList.find((inc) => inc.date === dateStr);
      revenueData.push({
        day: dayName,
        revenue: found ? Number(found.total) : 0
      });
    }
    
    return c.json({
      stats: {
        totalPatients: totalPatientsResult?.count || 0,
        todayPatients: todayPatientsResult?.count || 0,
        pendingTests: testStatsResult?.pending || 0,
        completedTests: testStatsResult?.completed || 0,
        pendingBills: billStatsResult?.pending_bills || 0,
        totalRevenue: billStatsResult?.total_revenue || 0,
        staffCount: staffCountResult?.count || 0,
        lowStockItems: lowStockResult?.count || 0,
        activeDoctorsToday: activeDoctors?.count || 0,
        thisMonthRevenue,
        lastMonthRevenue,
        thisWeekRevenue: roundMoney(thisWeekRevenue),
        lastWeekRevenue: roundMoney(lastWeekRevenue),
        weekOverWeekChange: lastWeekRevenue > 0
          ? parseFloat((((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100).toFixed(1))
          : thisWeekRevenue > 0 ? 100 : 0,
      },
      todaySummary: {
        newPatients: todayPatientsResult?.count || 0,
        totalAppointments: todayAppointments?.count || 0,
        completedConsultations: todayConsultations?.count || 0,
        pendingTests: testStatsResult?.pending || 0,
        completedTests: testStatsResult?.completed || 0,
        pharmacySales: roundMoney(pharmacySales?.total ?? 0),
        pharmacySalesCount: pharmacySales?.count || 0,
        totalCollection: roundMoney(todayCollection?.today_collection_total ?? 0),
        totalDue: roundMoney(patientDue?.patient_due_total ?? 0),
        admittedPatients: todayAdmitted?.count || 0,
        dischargedPatients: todayDischarged?.count || 0,
        totalDiscount: roundMoney(todayDiscount?.total_discount ?? 0),
      },
      patientSummary: {
        newPatients: todayPatientsResult?.count || 0,
        returningPatients: returningPatients?.count || 0,
        opdPatients: patientTypeSplit?.opd || 0,
        ipdPatients: patientTypeSplit?.ipd || 0,
        emergencyPatients: patientTypeSplit?.emergency || 0,
      },
      financialSummary: {
        dailyIncome: roundMoney(todayCollection?.today_collection_total ?? 0),
        weeklyIncome: roundMoney(weeklyIncome?.total ?? 0),
        monthlyIncome: thisMonthRevenue,
        dueCollection: roundMoney(dueCollection?.total ?? 0),
        cashierCollection: cashierCollection.map((c) => ({
          cashierName: c.cashier_name || 'Unknown',
          amount: roundMoney(c.total_collected),
        })),
      },
      labSummary: {
        dailyIncome: roundMoney(dailyLabIncome?.total ?? 0),
        pendingTests: testStatsResult?.pending || 0,
        completedTests: testStatsResult?.completed || 0,
      },
      pharmacySummary: {
        todaySales: roundMoney(pharmacySales?.total ?? 0),
        todaySalesCount: pharmacySales?.count || 0,
        lowStockItems: lowStockResult?.count || 0,
      },
      bedSummary: {
        total: bedStatus?.total || 0,
        available: bedStatus?.available || 0,
        occupied: bedStatus?.occupied || 0,
        cleaning: bedStatus?.cleaning || 0,
        maintenance: bedStatus?.maintenance || 0,
        reserved: bedStatus?.reserved || 0,
        occupancyPercentage: bedStatus && bedStatus.total > 0
          ? parseFloat(((bedStatus.occupied / bedStatus.total) * 100).toFixed(1))
          : 0,
      },
      recentActivity: recentActivityBatch.results || [],
      revenuePeriod: {
        monthStart: currentMonthStart,
        monthEnd: currentMonthEnd,
        weekStart: thisWeekStartStr,
        weekEnd: financeToday,
        lastWeekStart: lastWeekStartStr,
        lastWeekEnd: lastWeekEndStr,
      },
      revenueData,
      departmentRevenue: departmentRevenue.map((d) => ({
        name: d.department === 'test' ? 'Lab' :
              d.department === 'doctor_visit' ? 'OPD' :
              d.department === 'medicine' ? 'Pharmacy' :
              d.department === 'admission' ? 'IPD' :
              d.department === 'operation' ? 'OT' :
              d.department,
        value: roundMoney(d.total),
      })),
      finance: {
        todayCollection: roundMoney(todayCollection?.today_collection_total ?? 0),
        pendingHandoverAmount: roundMoney(pendingHandover?.pending_handover_amount ?? 0),
        pendingHandoverCount: Number(pendingHandover?.pending_handover_count ?? 0),
        patientDue: roundMoney(patientDue?.patient_due_total ?? 0),
        patientAdvance: roundMoney(patientAdvance?.patient_advance_total ?? 0),
        todayDeposit: roundMoney(todayDeposit?.today_deposit_total ?? 0),
        pendingPostingEvents: Number(pendingPosting?.pending_posting_events ?? 0),
        todayExpense: roundMoney(todayExpense?.total_expense ?? 0),
      },
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return c.json({ error: 'Failed to fetch dashboard stats' }, 500);
  }
});

// GET /cash-control — finance control-room data for drawer movement, evidence, handover, and posting checks
dashboardRoutes.get('/cash-control', adminGuard, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const reportDate = c.req.query('date') || getTodayGMT6();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  }

  try {
    const month = reportDate.slice(0, 7);
    const weekStart = startOfWeekGMT6(reportDate);
    const totalsRow = await db.$client.prepare(`
      SELECT
        (
          SELECT COALESCE(SUM(ABS(amount)), 0)
          FROM emp_cash_transactions
          WHERE tenant_id = ?
            AND COALESCE(payment_method, 'cash') = 'cash'
            AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
            AND ${localReportDate('transaction_date')} = date(?)
        ) AS bill_cash_in,
        (
          SELECT COALESCE(SUM(ABS(amount)), 0)
          FROM emp_cash_transactions
          WHERE tenant_id = ?
            AND COALESCE(payment_method, 'cash') = 'cash'
            AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
            AND ${localReportDate('transaction_date')} = date(?)
        ) AS refund_cash_out,
        (
          SELECT COALESCE(SUM(CASE WHEN movement_type = 'cash_in' THEN amount ELSE 0 END), 0)
          FROM cash_drawer_movements
          WHERE tenant_id = ?
            AND ${localReportDate('created_at')} = date(?)
        ) AS manual_cash_in,
        (
          SELECT COALESCE(SUM(CASE WHEN movement_type = 'cash_out' THEN amount ELSE 0 END), 0)
          FROM cash_drawer_movements
          WHERE tenant_id = ?
            AND ${localReportDate('created_at')} = date(?)
        ) AS manual_cash_out,
        (
          SELECT COALESCE(SUM(CASE WHEN movement_type = 'cash_drop' THEN amount ELSE 0 END), 0)
          FROM cash_drawer_movements
          WHERE tenant_id = ?
            AND ${localReportDate('created_at')} = date(?)
        ) AS cash_drop_total,
        (
          SELECT COALESCE(SUM(CASE WHEN movement_type = 'handover' THEN amount ELSE 0 END), 0)
          FROM cash_drawer_movements
          WHERE tenant_id = ?
            AND ${localReportDate('created_at')} = date(?)
        ) AS handover_collected,
        (
          SELECT COALESCE(SUM(
            COALESCE(s.opening_cash, 0)
            + COALESCE(ect.cash_in, 0)
            - COALESCE(ect.cash_out, 0)
            + COALESCE(cdm.manual_cash_in, 0)
            - COALESCE(cdm.manual_cash_out, 0)
            - COALESCE(cdm.cash_drop_total, 0)
          ), 0)
          FROM billing_counter_sessions s
          LEFT JOIN (
            SELECT
              counter_session_id,
              SUM(CASE
                WHEN COALESCE(payment_method, 'cash') = 'cash'
                 AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
                THEN amount ELSE 0 END) AS cash_in,
              SUM(CASE
                WHEN COALESCE(payment_method, 'cash') = 'cash'
                 AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
                THEN amount ELSE 0 END) AS cash_out
            FROM emp_cash_transactions
            WHERE tenant_id = ?
            GROUP BY counter_session_id
          ) ect ON ect.counter_session_id = s.id
          LEFT JOIN (
            SELECT
              counter_session_id,
              SUM(CASE WHEN movement_type = 'cash_in' THEN amount ELSE 0 END) AS manual_cash_in,
              SUM(CASE WHEN movement_type = 'cash_out' THEN amount ELSE 0 END) AS manual_cash_out,
              SUM(CASE WHEN movement_type = 'cash_drop' THEN amount ELSE 0 END) AS cash_drop_total
            FROM cash_drawer_movements
            WHERE tenant_id = ?
            GROUP BY counter_session_id
          ) cdm ON cdm.counter_session_id = s.id
          WHERE s.tenant_id = ?
            AND s.status = 'active'
        ) AS active_expected_cash,
        (
          SELECT COUNT(*)
          FROM billing_counter_sessions
          WHERE tenant_id = ?
            AND status = 'active'
        ) AS active_counter_count,
        (
          SELECT COALESCE(SUM(pending_amount), 0)
          FROM (
            SELECT CASE WHEN status = 'partial' THEN COALESCE(due_amount, 0) ELSE handover_amount END AS pending_amount
            FROM billing_handovers
            WHERE tenant_id = ?
              AND handover_type = 'counter'
              AND status IN ('pending', 'partial')
            UNION ALL
            SELECT COALESCE(due_amount, amount) AS pending_amount
            FROM billing_counter_cash_transfers
            WHERE tenant_id = ?
              AND status IN ('pending', 'partial', 'disputed')
          ) pending_cash
        ) AS pending_handover_amount,
        (
          SELECT COALESCE(SUM(row_count), 0)
          FROM (
            SELECT COUNT(*) AS row_count
            FROM billing_handovers
            WHERE tenant_id = ?
              AND handover_type = 'counter'
              AND status IN ('pending', 'partial')
            UNION ALL
            SELECT COUNT(*) AS row_count
            FROM billing_counter_cash_transfers
            WHERE tenant_id = ?
              AND status IN ('pending', 'partial', 'disputed')
          ) pending_cash_count
        ) AS pending_handover_count,
        (
          SELECT COALESCE(SUM(COALESCE(variance, 0)), 0)
          FROM billing_counter_sessions
          WHERE tenant_id = ?
            AND status = 'closed'
            AND ${localReportDate('closed_at')} = date(?)
        ) AS closed_variance,
        (
          SELECT COUNT(*)
          FROM billing_counter_sessions
          WHERE tenant_id = ?
            AND status = 'closed'
            AND ${localReportDate('closed_at')} = date(?)
        ) AS closed_session_count,
        (
          SELECT COALESCE(SUM(amount), 0)
          FROM expenses
          WHERE tenant_id = ?
            AND status = 'approved'
            AND date(date) = date(?)
        ) AS approved_expense_total,
        (
          SELECT COUNT(*)
          FROM expenses
          WHERE tenant_id = ?
            AND date(date) = date(?)
        ) AS expense_count,
        (
          SELECT COUNT(*)
          FROM expenses
          WHERE tenant_id = ?
            AND date(date) = date(?)
            AND receipt_key IS NOT NULL
            AND receipt_key != ''
        ) AS expense_with_receipt_count,
        (
          SELECT COUNT(*)
          FROM expenses
          WHERE tenant_id = ?
            AND date(date) = date(?)
            AND (receipt_key IS NULL OR receipt_key = '')
        ) AS expense_missing_receipt_count,
        (
          SELECT COUNT(*)
          FROM expenses
          WHERE tenant_id = ?
            AND status = 'pending'
            AND date(date) = date(?)
        ) AS pending_expense_count,
        (
          SELECT COUNT(*)
          FROM cash_drawer_movements
          WHERE tenant_id = ?
            AND movement_type = 'cash_out'
            AND ${localReportDate('created_at')} = date(?)
            AND COALESCE(reference_type, '') NOT IN ('expense', 'expense_pending')
        ) AS unclassified_cash_out_count,
        (
          SELECT COUNT(*)
          FROM accounting_posting_events
          WHERE tenant_id = ?
            AND status = 'pending'
            AND source_type IN ('cash_handover', 'direct_expense')
        ) AS pending_posting_event_count,
        (
          SELECT COUNT(*)
          FROM accounting_posting_events
          WHERE tenant_id = ?
            AND status = 'failed'
            AND source_type IN ('cash_handover', 'direct_expense')
        ) AS failed_posting_event_count
    `).bind(
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, tenantId, tenantId,
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId, reportDate,
      tenantId,
      tenantId,
    ).first<Record<string, unknown>>();

    const movements = await db.$client.prepare(`
      SELECT
        m.id,
        m.movement_type,
        m.amount,
        m.description,
        m.created_at,
        m.reference_type,
        m.reference_id,
        c.counter_name,
        c.counter_code,
        operator_user.name AS operator_name,
        creator.name AS created_by_name,
        e.category AS expense_category,
        e.description AS expense_description,
        e.receipt_key
      FROM cash_drawer_movements m
      LEFT JOIN billing_counters c ON c.id = m.counter_id AND c.tenant_id = m.tenant_id
      LEFT JOIN users operator_user ON operator_user.id = m.employee_id AND operator_user.tenant_id = m.tenant_id
      LEFT JOIN users creator ON creator.id = m.created_by AND creator.tenant_id = m.tenant_id
      LEFT JOIN expenses e
        ON e.tenant_id = m.tenant_id
       AND CAST(e.id AS TEXT) = CAST(m.reference_id AS TEXT)
       AND m.reference_type IN ('expense', 'expense_pending')
      WHERE m.tenant_id = ?
        AND ${localReportDate('m.created_at')} = date(?)
        AND m.movement_type IN ('cash_in', 'cash_out', 'handover', 'cash_drop')
      ORDER BY m.created_at DESC
      LIMIT 20
    `).bind(tenantId, reportDate).all<Record<string, unknown>>();

    const statementRows = await db.$client.prepare(`
      SELECT * FROM (
        SELECT
          'payment' AS source_type,
          CAST(ect.id AS TEXT) AS id,
          COALESCE(ect.transaction_date, ect.created_at) AS created_at,
          CASE
            WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN 'Patient cash collection'
            WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN 'Refund / return'
            ELSE ect.transaction_type
          END AS label,
          COALESCE(ect.description, ect.transaction_type) AS detail,
          ABS(ect.amount) AS amount,
          CASE
            WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN ABS(ect.amount)
            ELSE -ABS(ect.amount)
          END AS signed_amount,
          c.counter_name,
          u.name AS operator_name,
          ect.reference_type,
          CAST(ect.reference_id AS TEXT) AS reference_no
        FROM emp_cash_transactions ect
        LEFT JOIN billing_counter_sessions s ON s.id = ect.counter_session_id AND s.tenant_id = ect.tenant_id
        LEFT JOIN billing_counters c ON c.id = s.counter_id AND c.tenant_id = ect.tenant_id
        LEFT JOIN users u ON u.id = ect.employee_id AND u.tenant_id = ect.tenant_id
        WHERE ect.tenant_id = ?
          AND COALESCE(ect.payment_method, 'cash') = 'cash'
          AND ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived', 'SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
          AND ${localReportDate('ect.transaction_date, ect.created_at')} = date(?)
        UNION ALL
        SELECT
          'drawer_movement' AS source_type,
          CAST(m.id AS TEXT) AS id,
          m.created_at,
          CASE
            WHEN m.movement_type = 'cash_in' THEN 'Drawer cash received'
            WHEN m.movement_type = 'cash_out' AND m.reference_type = 'doctor_commission_settlement' THEN 'Doctor payout'
            WHEN m.movement_type = 'cash_out' AND m.reference_type IN ('expense', 'expense_pending') THEN 'Expense payment'
            WHEN m.movement_type = 'cash_out' THEN 'Drawer cash out'
            WHEN m.movement_type = 'cash_drop' THEN 'Cash transfer / deposit'
            WHEN m.movement_type = 'handover' THEN 'Shift handover'
            ELSE m.movement_type
          END AS label,
          COALESCE(m.description, e.description, m.reference_type, m.movement_type) AS detail,
          ABS(m.amount) AS amount,
          CASE
            WHEN m.movement_type = 'cash_in' THEN ABS(m.amount)
            WHEN m.movement_type IN ('handover', 'cash_drop') THEN 0
            ELSE -ABS(m.amount)
          END AS signed_amount,
          c.counter_name,
          u.name AS operator_name,
          m.reference_type,
          CAST(m.reference_id AS TEXT) AS reference_no
        FROM cash_drawer_movements m
        LEFT JOIN billing_counters c ON c.id = m.counter_id AND c.tenant_id = m.tenant_id
        LEFT JOIN users u ON u.id = m.employee_id AND u.tenant_id = m.tenant_id
        LEFT JOIN expenses e ON e.tenant_id = m.tenant_id AND CAST(e.id AS TEXT) = CAST(m.reference_id AS TEXT) AND m.reference_type IN ('expense', 'expense_pending')
        WHERE m.tenant_id = ?
          AND ${localReportDate('m.created_at')} = date(?)
          AND m.movement_type IN ('cash_in', 'cash_out', 'handover', 'cash_drop')
          AND COALESCE(m.reference_type, '') NOT IN ('bill_payment', 'payment', 'patient_transaction')
      ) cash_statement
      ORDER BY datetime(created_at) ASC, id ASC
      LIMIT 200
    `).bind(tenantId, reportDate, tenantId, reportDate).all<Record<string, unknown>>();

    const expenses = await db.$client.prepare(`
      SELECT
        e.id,
        e.date,
        e.category,
        e.amount,
        e.description,
        e.status,
        e.receipt_key,
        creator.name AS created_by_name,
        approver.name AS approved_by_name
      FROM expenses e
      LEFT JOIN users creator ON creator.id = e.created_by AND creator.tenant_id = e.tenant_id
      LEFT JOIN users approver ON approver.id = e.approved_by AND approver.tenant_id = e.tenant_id
      WHERE e.tenant_id = ?
        AND date(e.date) = date(?)
      ORDER BY e.created_at DESC
      LIMIT 10
    `).bind(tenantId, reportDate).all<Record<string, unknown>>();

    const handovers = await db.$client.prepare(`
      SELECT * FROM (
        SELECT
          h.id AS id,
          'counter_handover' AS source_type,
          h.handover_amount AS amount,
          h.due_amount AS due_amount,
          h.status AS status,
          h.created_at AS created_at,
          from_user.name AS handover_by_name,
          to_user.name AS handover_to_name,
          c.counter_name AS counter_name,
          COALESCE(s.variance, 0) AS variance
        FROM billing_handovers h
        LEFT JOIN users from_user ON from_user.id = h.handover_by AND from_user.tenant_id = h.tenant_id
        LEFT JOIN users to_user ON to_user.id = h.handover_to AND to_user.tenant_id = h.tenant_id
        LEFT JOIN billing_counter_sessions s ON s.id = h.counter_session_id AND s.tenant_id = h.tenant_id
        LEFT JOIN billing_counters c ON c.id = s.counter_id AND c.tenant_id = h.tenant_id
        WHERE h.tenant_id = ?
          AND h.handover_type = 'counter'
          AND (${localReportDate('h.created_at')} = date(?) OR h.status IN ('pending', 'partial'))
        UNION ALL
        SELECT
          t.id AS id,
          'cash_custody_transfer' AS source_type,
          t.amount AS amount,
          COALESCE(t.due_amount, t.amount) AS due_amount,
          t.status AS status,
          t.created_at AS created_at,
          from_user.name AS handover_by_name,
          to_user.name AS handover_to_name,
          c.counter_name AS counter_name,
          CASE WHEN t.status = 'disputed' THEN COALESCE(t.due_amount, 0) ELSE 0 END AS variance
        FROM billing_counter_cash_transfers t
        LEFT JOIN users from_user ON from_user.id = t.transfer_by AND from_user.tenant_id = t.tenant_id
        LEFT JOIN users to_user ON to_user.id = t.transfer_to AND to_user.tenant_id = t.tenant_id
        LEFT JOIN billing_counters c ON c.id = t.counter_id AND c.tenant_id = t.tenant_id
        WHERE t.tenant_id = ?
          AND (${localReportDate('t.created_at')} = date(?) OR t.status IN ('pending', 'partial', 'disputed'))
      ) combined_handovers
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 20
    `).bind(tenantId, reportDate, tenantId, reportDate).all<Record<string, unknown>>();

    const totals = {
      billCashIn: rowNumber(totalsRow, 'bill_cash_in'),
      refundCashOut: rowNumber(totalsRow, 'refund_cash_out'),
      manualCashIn: rowNumber(totalsRow, 'manual_cash_in'),
      manualCashOut: rowNumber(totalsRow, 'manual_cash_out'),
      cashDrop: rowNumber(totalsRow, 'cash_drop_total'),
      handoverCollected: rowNumber(totalsRow, 'handover_collected'),
      activeExpectedCash: rowNumber(totalsRow, 'active_expected_cash'),
      activeCounterCount: Number(totalsRow?.active_counter_count ?? 0),
      pendingHandoverAmount: rowNumber(totalsRow, 'pending_handover_amount'),
      pendingHandoverCount: Number(totalsRow?.pending_handover_count ?? 0),
      closedVariance: rowNumber(totalsRow, 'closed_variance'),
      closedSessionCount: Number(totalsRow?.closed_session_count ?? 0),
      approvedExpenseTotal: rowNumber(totalsRow, 'approved_expense_total'),
      unclassifiedCashOutCount: Number(totalsRow?.unclassified_cash_out_count ?? 0),
      pendingPostingEventCount: Number(totalsRow?.pending_posting_event_count ?? 0),
      failedPostingEventCount: Number(totalsRow?.failed_posting_event_count ?? 0),
    };

    const netCashPosition = totals.billCashIn
      - totals.refundCashOut
      + totals.manualCashIn
      - totals.manualCashOut
      - totals.cashDrop
      - totals.handoverCollected;

    let runningBalance = 0;
    const cashStatementAscending = (statementRows.results ?? []).map((row) => {
      const signedAmount = roundMoney(Number(row.signed_amount ?? 0));
      runningBalance = roundMoney(runningBalance + signedAmount);
      return {
        id: `${String(row.source_type ?? 'cash')}-${String(row.id ?? '')}`,
        createdAt: String(row.created_at ?? ''),
        label: String(row.label ?? 'Cash movement'),
        detail: row.detail ? String(row.detail) : null,
        counterName: row.counter_name ? String(row.counter_name) : null,
        operatorName: row.operator_name ? String(row.operator_name) : null,
        amount: roundMoney(Number(row.amount ?? Math.abs(signedAmount))),
        signedAmount,
        balanceAfter: runningBalance,
        netMovementAfter: runningBalance,
        direction: signedAmount >= 0 ? 'in' : 'out',
        sourceType: row.source_type ? String(row.source_type) : null,
        referenceType: row.reference_type ? String(row.reference_type) : null,
        referenceNo: row.reference_no ? String(row.reference_no) : null,
      };
    });

    return c.json({
      date: reportDate,
      periods: {
        monthStart: `${month}-01`,
        monthEnd: monthEndDate(month),
        weekStart,
        weekEnd: reportDate,
      },
      totals: {
        ...totals,
        netCashPosition: roundMoney(netCashPosition),
      },
      receiptSummary: {
        expenseCount: Number(totalsRow?.expense_count ?? 0),
        withReceiptCount: Number(totalsRow?.expense_with_receipt_count ?? 0),
        missingReceiptCount: Number(totalsRow?.expense_missing_receipt_count ?? 0),
        pendingExpenseCount: Number(totalsRow?.pending_expense_count ?? 0),
      },
      latestMovements: (movements.results ?? []).map((row) => ({
        id: Number(row.id),
        movementType: String(row.movement_type ?? ''),
        amount: roundMoney(Number(row.amount ?? 0)),
        reason: String(row.description ?? row.expense_description ?? row.reference_type ?? row.movement_type ?? ''),
        createdAt: String(row.created_at ?? ''),
        counterName: row.counter_name ? String(row.counter_name) : null,
        counterCode: row.counter_code ? String(row.counter_code) : null,
        operatorName: row.operator_name ? String(row.operator_name) : null,
        createdByName: row.created_by_name ? String(row.created_by_name) : null,
        referenceType: row.reference_type ? String(row.reference_type) : null,
        referenceId: row.reference_id ? String(row.reference_id) : null,
        expenseCategory: row.expense_category ? String(row.expense_category) : null,
        expenseDescription: row.expense_description ? String(row.expense_description) : null,
        receiptAvailable: Boolean(row.receipt_key),
      })),
      cashStatement: cashStatementAscending.reverse(),
      latestExpenses: (expenses.results ?? []).map((row) => ({
        id: Number(row.id),
        date: String(row.date ?? ''),
        category: String(row.category ?? 'Uncategorized'),
        amount: roundMoney(Number(row.amount ?? 0)),
        description: row.description ? String(row.description) : null,
        status: String(row.status ?? ''),
        createdByName: row.created_by_name ? String(row.created_by_name) : null,
        approvedByName: row.approved_by_name ? String(row.approved_by_name) : null,
        hasReceipt: Boolean(row.receipt_key),
      })),
      latestHandovers: (handovers.results ?? []).map((row) => ({
        id: Number(row.id),
        amount: roundMoney(Number(row.amount ?? 0)),
        sourceType: row.source_type ? String(row.source_type) : null,
        dueAmount: roundMoney(Number(row.due_amount ?? 0)),
        status: String(row.status ?? ''),
        createdAt: String(row.created_at ?? ''),
        fromName: row.handover_by_name ? String(row.handover_by_name) : null,
        toName: row.handover_to_name ? String(row.handover_to_name) : null,
        counterName: row.counter_name ? String(row.counter_name) : null,
        variance: roundMoney(Number(row.variance ?? 0)),
      })),
    });
  } catch (error) {
    console.error('Cash control dashboard error:', error);
    return c.json({ error: 'Failed to fetch cash control dashboard' }, 500);
  }
});

// GET /active-counters — real-time counter status board
dashboardRoutes.get('/active-counters', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const counters = await db.$client.prepare(`
      SELECT
        s.id as session_id,
        s.counter_id,
        c.counter_name,
        c.counter_code,
        c.location,
        u.name as operator_name,
        u.id as operator_id,
        s.opening_cash,
        s.opened_at,
        COALESCE(ect.cash_in, 0) as cash_in,
        COALESCE(ect.cash_out, 0) as cash_out,
        COALESCE(ect.transaction_count, 0) as transaction_count,
        COALESCE(cdm.manual_cash_in, 0) as manual_cash_in,
        COALESCE(cdm.manual_cash_out, 0) as manual_cash_out,
        COALESCE(cdm.cash_drop_total, 0) as cash_drop_total
      FROM billing_counter_sessions s
      JOIN billing_counters c ON c.id = s.counter_id AND c.tenant_id = s.tenant_id
      LEFT JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
      LEFT JOIN (
        SELECT
          counter_session_id,
          SUM(CASE
            WHEN COALESCE(payment_method, 'cash') = 'cash'
             AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN amount
            ELSE 0 END) as cash_in,
          SUM(CASE
            WHEN COALESCE(payment_method, 'cash') = 'cash'
             AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN amount
            ELSE 0 END) as cash_out,
          COUNT(*) as transaction_count
        FROM emp_cash_transactions
        WHERE tenant_id = ?
        GROUP BY counter_session_id
      ) ect ON ect.counter_session_id = s.id
      LEFT JOIN (
        SELECT
          counter_session_id,
          SUM(CASE WHEN movement_type = 'cash_in' THEN amount ELSE 0 END) as manual_cash_in,
          SUM(CASE WHEN movement_type = 'cash_out' THEN amount ELSE 0 END) as manual_cash_out,
          SUM(CASE WHEN movement_type = 'cash_drop' THEN amount ELSE 0 END) as cash_drop_total
        FROM cash_drawer_movements
        WHERE tenant_id = ?
          AND movement_type IN ('cash_in', 'cash_out', 'cash_drop')
        GROUP BY counter_session_id
      ) cdm ON cdm.counter_session_id = s.id
      WHERE s.tenant_id = ? AND s.status = 'active'
      ORDER BY s.opened_at DESC
    `).bind(tenantId, tenantId, tenantId).all();

    return c.json({
      activeCounters: counters.results.map((row: any) => ({
        sessionId: row.session_id,
        counterId: row.counter_id,
        counterName: row.counter_name,
        counterCode: row.counter_code,
        location: row.location,
        operatorName: row.operator_name || 'Unknown',
        operatorId: row.operator_id,
        openingCash: Number(row.opening_cash ?? 0),
        cashIn: Number(row.cash_in ?? 0),
        cashOut: Number(row.cash_out ?? 0),
        manualCashIn: Number(row.manual_cash_in ?? 0),
        manualCashOut: Number(row.manual_cash_out ?? 0),
        cashDrop: Number(row.cash_drop_total ?? 0),
        expectedCash:
          Number(row.opening_cash ?? 0)
          + Number(row.cash_in ?? 0)
          - Number(row.cash_out ?? 0)
          + Number(row.manual_cash_in ?? 0)
          - Number(row.manual_cash_out ?? 0)
          - Number(row.cash_drop_total ?? 0),
        transactionCount: Number(row.transaction_count ?? 0),
        openedAt: row.opened_at,
      })),
      totalActive: counters.results.length,
    });
  } catch (error) {
    console.error('Active counters error:', error);
    return c.json({ error: 'Failed to fetch active counters' }, 500);
  }
});

// GET /fraud-alerts — fraud detection alerts
dashboardRoutes.get('/fraud-alerts', adminGuard, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  const largeTxnThreshold = Number(c.req.query('largeTransactionThreshold') ?? 100000);
  const highVoidRateThreshold = Number(c.req.query('highVoidRateThreshold') ?? 5);

  try {
    const alerts: Array<{ type: string; severity: string; message: string; details: any }> = [];

    // Check for high void rates
    const highVoids = await db.$client.prepare(`
      SELECT
        u.name as operator_name,
        COUNT(CASE WHEN ect.transaction_type = 'SalesReturn' THEN 1 END) as void_count,
        COUNT(*) as total_transactions,
        ROUND(COUNT(CASE WHEN ect.transaction_type = 'SalesReturn' THEN 1 END) * 100.0 / COUNT(*), 2) as void_rate
      FROM emp_cash_transactions ect
      LEFT JOIN users u ON u.id = ect.employee_id AND u.tenant_id = ect.tenant_id
      WHERE ect.tenant_id = ? AND ${localReportDate('ect.transaction_date')} = date(?)
      GROUP BY ect.employee_id
      HAVING void_rate > ?
    `).bind(tenantId, today, highVoidRateThreshold).all();

    for (const row of highVoids.results as any[]) {
      alerts.push({
        type: 'HIGH_VOID_RATE',
        severity: 'warning',
        message: `${row.operator_name} has ${row.void_rate}% return rate (${row.void_count}/${row.total_transactions} transactions)`,
        details: row,
      });
    }

    // Check for large individual transactions
    const largeTransactions = await db.$client.prepare(`
      SELECT ect.*, u.name as operator_name
      FROM emp_cash_transactions ect
      LEFT JOIN users u ON u.id = ect.employee_id AND u.tenant_id = ect.tenant_id
      WHERE ect.tenant_id = ? AND ${localReportDate('ect.transaction_date')} = date(?) AND ect.amount > ?
    `).bind(tenantId, today, largeTxnThreshold).all();

    for (const row of largeTransactions.results as any[]) {
      alerts.push({
        type: 'LARGE_TRANSACTION',
        severity: 'info',
        message: `Large transaction: ৳${Number(row.amount).toLocaleString()} by ${row.operator_name} (${row.transaction_type})`,
        details: row,
      });
    }

    // Check for pending handovers older than 24 hours
    const staleHandovers = await db.$client.prepare(`
      SELECT h.*, u.name as handover_by_name
      FROM billing_handovers h
      LEFT JOIN users u ON u.id = h.handover_by AND u.tenant_id = h.tenant_id
      WHERE h.tenant_id = ? AND h.status = 'pending'
        AND datetime(h.created_at) < datetime('now', '+6 hours', '-24 hours')
    `).bind(tenantId).all();

    for (const row of staleHandovers.results as any[]) {
      alerts.push({
        type: 'STALE_HANDOVER',
        severity: 'warning',
        message: `Pending handover from ${row.handover_by_name} for ৳${Number(row.handover_amount).toLocaleString()} is older than 24 hours`,
        details: row,
      });
    }

    // Check for accounting posting backlog
    const pendingPosting = await db.$client.prepare(`
      SELECT COUNT(*) as count FROM accounting_posting_events WHERE tenant_id = ? AND status = 'pending'
    `).bind(tenantId).first();

    if (Number(pendingPosting?.count ?? 0) > 100) {
      alerts.push({
        type: 'ACCOUNTING_BACKLOG',
        severity: 'critical',
        message: `${pendingPosting?.count} pending accounting events — posting backlog detected`,
        details: { pendingCount: pendingPosting?.count },
      });
    }

    return c.json({
      alerts,
      summary: {
        total: alerts.length,
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        info: alerts.filter(a => a.severity === 'info').length,
      },
      thresholds: {
        largeTransaction: largeTxnThreshold,
        highVoidRate: highVoidRateThreshold,
      },
    });
  } catch (error) {
    console.error('Fraud alerts error:', error);
    return c.json({ error: 'Failed to fetch fraud alerts' }, 500);
  }
});

// Get daily/period income
dashboardRoutes.get('/daily-income', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const dateParam = c.req.query('date');
  if (!validateDashboardDateParam(dateParam)) {
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  }
  const rangeParam = c.req.query('range') || 'today';
  const rangeDays = dashboardRangeDays(rangeParam);
  if (rangeDays === null) {
    return c.json({ error: 'range must be today, 7d, or 30d' }, 400);
  }
  const endDate = dateParam || getTodayGMT6();
  const startDate = addDaysGMT6(endDate, -(rangeDays - 1));
  
  try {
    const income = await getGlBreakdown(c.env.DB, tenantId, startDate, endDate, 'revenue');
    const total = income.reduce((sum, row) => sum + row.amount, 0);
    
    return c.json({
      date: endDate,
      startDate,
      endDate,
      range: rangeParam,
      bySource: income.map(row => ({ source: row.name, total: row.amount })),
      total,
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch income' }, 500);
  }
});

// Get daily/period expenses
dashboardRoutes.get('/daily-expenses', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const dateParam = c.req.query('date');
  if (!validateDashboardDateParam(dateParam)) {
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  }
  const rangeParam = c.req.query('range') || 'today';
  const rangeDays = dashboardRangeDays(rangeParam);
  if (rangeDays === null) {
    return c.json({ error: 'range must be today, 7d, or 30d' }, 400);
  }
  const endDate = dateParam || getTodayGMT6();
  const startDate = addDaysGMT6(endDate, -(rangeDays - 1));
  
  try {
    const expenses = await getGlBreakdown(c.env.DB, tenantId, startDate, endDate, 'expense');
    const total = expenses.reduce((sum, row) => sum + row.amount, 0);
    
    return c.json({
      date: endDate,
      startDate,
      endDate,
      range: rangeParam,
      byCategory: expenses.map(row => ({ category: row.name, total: row.amount })),
      total,
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch expenses' }, 500);
  }
});

// Get monthly summary
dashboardRoutes.get('/monthly-summary', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const month = c.req.query('month') || getTodayGMT6().slice(0, 7);
  
  try {
    const totals = await getGlIncomeExpenseTotals(c.env.DB, tenantId, `${month}-01`, monthEndDate(month));
    const income = totals.income;
    const expenses = totals.expense;
    const profit = totals.profit;
    
    return c.json({
      month,
      income,
      expenses,
      profit,
      margin: income > 0 ? ((profit / income) * 100).toFixed(2) : 0
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch summary' }, 500);
  }
});

// GET /doctor-performance — paginated doctor-wise visit, test, collection, and commission analytics.
dashboardRoutes.get('/doctor-performance', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  const sortByParam = c.req.query('sortBy') || 'payableCommission';
  if (!DOCTOR_PERFORMANCE_SORTS.has(sortByParam as DoctorPerformanceSort)) {
    return c.json({ error: 'Unsupported doctor performance sort field' }, 400);
  }
  const sortDirectionParam = c.req.query('sortDirection') || 'desc';
  if (!DOCTOR_PERFORMANCE_DIRECTIONS.has(sortDirectionParam as DoctorPerformanceSortDirection)) {
    return c.json({ error: 'sortDirection must be asc or desc' }, 400);
  }

  const pageParam = c.req.query('page') || '1';
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1) {
    return c.json({ error: 'page must be a positive integer' }, 400);
  }
  const pageSizeParam = c.req.query('pageSize') || '25';
  if (!/^\d+$/.test(pageSizeParam) || !DOCTOR_PERFORMANCE_PAGE_SIZES.has(Number(pageSizeParam))) {
    return c.json({ error: 'pageSize must be 10, 25, 50, or 100' }, 400);
  }

  try {
    const response = await getDoctorPerformance({
      dbBinding: c.env.DB,
      tenantId,
      period,
      search: c.req.query('search'),
      sortBy: sortByParam as DoctorPerformanceSort,
      sortDirection: sortDirectionParam as DoctorPerformanceSortDirection,
      page: Number(pageParam),
      pageSize: Number(pageSizeParam),
    });
    return c.json(response);
  } catch (error) {
    console.error('Doctor performance error:', error);
    return c.json({ error: 'Failed to fetch doctor performance' }, 500);
  }
});

// GET /doctor-performance/activity — one doctor's unified operational and compensation timeline.
dashboardRoutes.get('/doctor-performance/activity', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  const doctorIdParam = c.req.query('doctorId');
  if (!doctorIdParam || !/^\d+$/.test(doctorIdParam) || Number(doctorIdParam) <= 0) {
    return c.json({ error: 'doctorId must be a positive integer' }, 400);
  }

  const pageParam = c.req.query('page') || '1';
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1) {
    return c.json({ error: 'page must be a positive integer' }, 400);
  }
  const pageSizeParam = c.req.query('pageSize') || '50';
  if (!/^\d+$/.test(pageSizeParam) || !DOCTOR_PERFORMANCE_PAGE_SIZES.has(Number(pageSizeParam))) {
    return c.json({ error: 'pageSize must be 10, 25, 50, or 100' }, 400);
  }

  const permissions = c.get('permissions') as string[] | undefined;
  const patientIdentityVisible = Boolean(
    permissions?.includes('*') || permissions?.includes('patients:read'),
  );

  try {
    const response = await getDoctorActivity({
      dbBinding: c.env.DB,
      tenantId,
      period,
      doctorId: Number(doctorIdParam),
      page: Number(pageParam),
      pageSize: Number(pageSizeParam),
      patientIdentityVisible,
    });
    return c.json(response);
  } catch (error) {
    console.error('Doctor activity error:', error);
    return c.json({ error: 'Failed to fetch doctor activity' }, 500);
  }
});

// GET /doctor-performance/details — one selected doctor's visit, test, or commission facts.
dashboardRoutes.get('/doctor-performance/details', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  const doctorIdParam = c.req.query('doctorId');
  let doctorId: number | null;
  if (doctorIdParam === 'unassigned') {
    doctorId = null;
  } else if (doctorIdParam && /^\d+$/.test(doctorIdParam) && Number(doctorIdParam) > 0) {
    doctorId = Number(doctorIdParam);
  } else {
    return c.json({ error: 'doctorId must be a positive integer or unassigned' }, 400);
  }

  const tabParam = c.req.query('tab');
  if (!tabParam || !DOCTOR_PERFORMANCE_TABS.has(tabParam as DoctorPerformanceDetailsTab)) {
    return c.json({ error: 'tab must be visits, tests, referred-tests, performed-tests, or commissions' }, 400);
  }
  const pageParam = c.req.query('page') || '1';
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1) {
    return c.json({ error: 'page must be a positive integer' }, 400);
  }
  const pageSizeParam = c.req.query('pageSize') || '25';
  if (!/^\d+$/.test(pageSizeParam) || !DOCTOR_PERFORMANCE_PAGE_SIZES.has(Number(pageSizeParam))) {
    return c.json({ error: 'pageSize must be 10, 25, 50, or 100' }, 400);
  }

  try {
    const response = await getDoctorPerformanceDetails({
      dbBinding: c.env.DB,
      tenantId,
      period,
      doctorId,
      tab: tabParam as DoctorPerformanceDetailsTab,
      page: Number(pageParam),
      pageSize: Number(pageSizeParam),
    });
    return c.json(response);
  } catch (error) {
    console.error('Doctor performance details error:', error);
    return c.json({ error: 'Failed to fetch doctor performance details' }, 500);
  }
});

// GET /test-performance — paginated test-wise operational, financial, and commission analytics.
dashboardRoutes.get('/test-performance', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  if (c.req.query('status') !== undefined) {
    return c.json({ error: 'status is not supported for billing-backed test performance' }, 400);
  }
  const sortByParam = c.req.query('sortBy') || 'quantity';
  if (!TEST_PERFORMANCE_SORTS.has(sortByParam as TestPerformanceSort)) {
    return c.json({ error: 'Unsupported test performance sort field' }, 400);
  }
  const sortDirectionParam = c.req.query('sortDirection') || 'desc';
  if (!TEST_PERFORMANCE_DIRECTIONS.has(sortDirectionParam as TestPerformanceSortDirection)) {
    return c.json({ error: 'sortDirection must be asc or desc' }, 400);
  }
  const pageParam = c.req.query('page') || '1';
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1) {
    return c.json({ error: 'page must be a positive integer' }, 400);
  }
  const pageSizeParam = c.req.query('pageSize') || '25';
  if (!/^\d+$/.test(pageSizeParam) || !DOCTOR_PERFORMANCE_PAGE_SIZES.has(Number(pageSizeParam))) {
    return c.json({ error: 'pageSize must be 10, 25, 50, or 100' }, 400);
  }

  try {
    const response = await getTestPerformance({
      dbBinding: c.env.DB,
      tenantId,
      period,
      search: c.req.query('search'),
      sortBy: sortByParam as TestPerformanceSort,
      sortDirection: sortDirectionParam as TestPerformanceSortDirection,
      page: Number(pageParam),
      pageSize: Number(pageSizeParam),
    });
    return c.json(response);
  } catch (error) {
    console.error('Test performance error:', error);
    return c.json({ error: 'Failed to fetch test performance' }, 500);
  }
});

// GET /test-performance/:testId/details — one operational test catalog item's order details.
dashboardRoutes.get('/test-performance/:testId/details', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const testIdParam = c.req.param('testId');
  if (!/^-?\d+$/.test(testIdParam) || Number(testIdParam) === 0) {
    return c.json({ error: 'testId must be a non-zero integer' }, 400);
  }
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }
  const viewParam = c.req.query('view') || 'lines';
  if (!TEST_PERFORMANCE_DETAIL_VIEWS.has(viewParam as TestPerformanceDetailView)) {
    return c.json({ error: 'view must be lines, referred, or performed' }, 400);
  }
  const pageParam = c.req.query('page') || '1';
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1) {
    return c.json({ error: 'page must be a positive integer' }, 400);
  }
  const pageSizeParam = c.req.query('pageSize') || '25';
  if (!/^\d+$/.test(pageSizeParam) || !DOCTOR_PERFORMANCE_PAGE_SIZES.has(Number(pageSizeParam))) {
    return c.json({ error: 'pageSize must be 10, 25, 50, or 100' }, 400);
  }

  try {
    const response = await getTestPerformanceDetails({
      dbBinding: c.env.DB,
      tenantId,
      period,
      testId: Number(testIdParam),
      view: viewParam as TestPerformanceDetailView,
      page: Number(pageParam),
      pageSize: Number(pageSizeParam),
    });
    return c.json(response);
  } catch (error) {
    console.error('Test performance details error:', error);
    return c.json({ error: 'Failed to fetch test performance details' }, 500);
  }
});

// GET /income-services — exact service-level collection allocation.
dashboardRoutes.get('/income-services', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) return c.json({ error: 'Invalid dashboard date range' }, 400);

  const categoryParam = c.req.query('category') || 'all';
  if (!INCOME_SERVICE_CATEGORIES.has(categoryParam as IncomeServiceCategory)) {
    return c.json({ error: 'category must be all, lab, or non_lab' }, 400);
  }
  const sortByParam = c.req.query('sortBy') || 'collection';
  if (!INCOME_SERVICE_SORTS.has(sortByParam as IncomeServiceSort)) {
    return c.json({ error: 'Unsupported income service sort field' }, 400);
  }
  const sortDirectionParam = c.req.query('sortDirection') || 'desc';
  if (!INCOME_SERVICE_DIRECTIONS.has(sortDirectionParam as IncomeServiceSortDirection)) {
    return c.json({ error: 'sortDirection must be asc or desc' }, 400);
  }
  const pageParam = c.req.query('page') || '1';
  const pageSizeParam = c.req.query('pageSize') || '25';
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1) return c.json({ error: 'page must be a positive integer' }, 400);
  if (!/^\d+$/.test(pageSizeParam) || !DOCTOR_PERFORMANCE_PAGE_SIZES.has(Number(pageSizeParam))) {
    return c.json({ error: 'pageSize must be 10, 25, 50, or 100' }, 400);
  }

  try {
    return c.json(await getIncomeServiceAnalysis({
      dbBinding: c.env.DB,
      tenantId,
      period,
      category: categoryParam as IncomeServiceCategory,
      search: c.req.query('search'),
      sortBy: sortByParam as IncomeServiceSort,
      sortDirection: sortDirectionParam as IncomeServiceSortDirection,
      page: Number(pageParam),
      pageSize: Number(pageSizeParam),
    }));
  } catch (error) {
    console.error('Income service analysis error:', error);
    return c.json({ error: 'Failed to fetch income service analysis' }, 500);
  }
});

// GET /expense-analysis — paid operating expenses plus executed doctor payouts.
dashboardRoutes.get('/expense-analysis', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) return c.json({ error: 'Invalid dashboard date range' }, 400);

  const sortByParam = c.req.query('sortBy') || 'paidAmount';
  if (!EXPENSE_ANALYSIS_SORTS.has(sortByParam as ExpenseAnalysisSort)) {
    return c.json({ error: 'Unsupported expense analysis sort field' }, 400);
  }
  const sortDirectionParam = c.req.query('sortDirection') || 'desc';
  if (!EXPENSE_ANALYSIS_DIRECTIONS.has(sortDirectionParam as ExpenseAnalysisSortDirection)) {
    return c.json({ error: 'sortDirection must be asc or desc' }, 400);
  }
  const pageParam = c.req.query('page') || '1';
  const pageSizeParam = c.req.query('pageSize') || '25';
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1) return c.json({ error: 'page must be a positive integer' }, 400);
  if (!/^\d+$/.test(pageSizeParam) || !DOCTOR_PERFORMANCE_PAGE_SIZES.has(Number(pageSizeParam))) {
    return c.json({ error: 'pageSize must be 10, 25, 50, or 100' }, 400);
  }

  try {
    return c.json(await getExpenseAnalysis({
      dbBinding: c.env.DB,
      tenantId,
      period,
      search: c.req.query('search'),
      sortBy: sortByParam as ExpenseAnalysisSort,
      sortDirection: sortDirectionParam as ExpenseAnalysisSortDirection,
      page: Number(pageParam),
      pageSize: Number(pageSizeParam),
    }));
  } catch (error) {
    console.error('Expense analysis error:', error);
    return c.json({ error: 'Failed to fetch expense analysis' }, 500);
  }
});

// GET /reagent-reconciliation — completed tests versus actual reagent movements and usable stock.
dashboardRoutes.get('/reagent-reconciliation', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) return c.json({ error: 'Invalid dashboard date range' }, 400);

  const pageParam = c.req.query('page') || '1';
  const pageSizeParam = c.req.query('pageSize') || '25';
  if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1) return c.json({ error: 'page must be a positive integer' }, 400);
  if (!/^\d+$/.test(pageSizeParam) || !DOCTOR_PERFORMANCE_PAGE_SIZES.has(Number(pageSizeParam))) {
    return c.json({ error: 'pageSize must be one of 10, 25, 50, or 100' }, 400);
  }

  try {
    return c.json(await getReagentReconciliation({
      dbBinding: c.env.DB,
      tenantId,
      period,
      page: Number(pageParam),
      pageSize: Number(pageSizeParam),
    }));
  } catch (error) {
    console.error('Reagent reconciliation error:', error);
    return c.json({ error: 'Failed to fetch reagent reconciliation' }, 500);
  }
});

type AdminOverviewBreakdown = {
  total?: number;
  totalRows?: number;
  sources?: Array<{ amount: number; count: number }>;
};

const ADMIN_OVERVIEW_COMPARISON_MODES = new Set<DashboardComparisonMode>([
  'previous_period',
  'previous_day',
  'previous_month',
  'none',
]);

function adminOverviewRoleContext(role: string | undefined): {
  rolePreset: DashboardRolePreset;
  permissions: string[];
} {
  if (role === 'hospital_admin') return { rolePreset: 'hospital_admin', permissions: ['*'] };
  if (role === 'md' || role === 'director') {
    return {
      rolePreset: 'md_director',
      permissions: ['billing:report:read', 'billing:aging:read'],
    };
  }
  if (role === 'accountant') {
    return {
      rolePreset: 'accountant',
      permissions: ['billing:report:read', 'billing:aging:read', 'billing:cash:read', 'billing:deposit:read'],
    };
  }
  return {
    rolePreset: 'manager_operations',
    permissions: ['billing:report:read', 'billing:cash:read', 'pharmacy:read'],
  };
}

function adminOverviewMetricPeriod(
  metric: DashboardMetricDefinition,
  context: NonNullable<ReturnType<typeof resolveDashboardFilterContext>>,
  generatedAt: string,
): DashboardMetricResult['period'] {
  if (metric.temporalMode === 'live') {
    return { asOf: generatedAt, label: 'Live/current state' };
  }
  if (metric.temporalMode === 'as_of') {
    return { asOf: context.period.endDate, label: `As of ${context.period.endDate}` };
  }
  return { ...context.period };
}

function unavailableAdminOverviewMetric(
  metric: DashboardMetricDefinition,
  context: NonNullable<ReturnType<typeof resolveDashboardFilterContext>>,
  generatedAt: string,
  reasonCode: string,
  message: string,
): DashboardMetricResult {
  return {
    key: metric.key,
    label: metric.fallbackLabel,
    value: null,
    valueType: metric.valueType,
    temporalMode: metric.temporalMode,
    dateBasis: metric.dateBasis,
    period: adminOverviewMetricPeriod(metric, context, generatedAt),
    generatedAt,
    sourceStatus: resolveDashboardSourceStatus({
      requiredSources: metric.sourceOfTruth,
      loadedSources: [],
      unavailableSources: metric.sourceOfTruth.map((source) => ({ source, reasonCode, message })),
      generatedAt,
      staleAfterSeconds: 60,
      now: generatedAt,
    }),
    warnings: [{
      code: reasonCode,
      severity: 'warning',
      domain: metric.section,
      message,
    }],
    drill: metric.drillTarget,
  };
}

function successfulAdminOverviewMetric(
  metric: DashboardMetricDefinition,
  context: NonNullable<ReturnType<typeof resolveDashboardFilterContext>>,
  generatedAt: string,
  breakdown: AdminOverviewBreakdown,
): DashboardMetricResult {
  const total = roundMoney(Number(breakdown.total ?? 0));
  const totalRows = Math.max(0, Number(breakdown.totalRows ?? breakdown.sources?.reduce((sum, row) => sum + Number(row.count ?? 0), 0) ?? 0));
  return {
    key: metric.key,
    label: metric.fallbackLabel,
    value: total,
    valueType: metric.valueType,
    temporalMode: metric.temporalMode,
    dateBasis: metric.dateBasis,
    period: adminOverviewMetricPeriod(metric, context, generatedAt),
    generatedAt,
    sourceStatus: resolveDashboardSourceStatus({
      requiredSources: metric.sourceOfTruth,
      loadedSources: metric.sourceOfTruth,
      unavailableSources: [],
      generatedAt,
      staleAfterSeconds: metric.temporalMode === 'live' ? 60 : 300,
      now: generatedAt,
    }),
    reconciliation: metric.reconciliationRequired
      ? buildDashboardReconciliation({
        summaryTotal: total,
        detailTotal: total,
        detailRowCount: totalRows,
        checkedAt: generatedAt,
        providerMode: 'legacy',
      })
      : undefined,
    warnings: [],
    drill: metric.drillTarget,
  };
}

async function loadAdminOverviewMetric(
  metric: DashboardMetricDefinition,
  dbBinding: Env['DB'],
  tenantId: string,
  context: NonNullable<ReturnType<typeof resolveDashboardFilterContext>>,
  generatedAt: string,
): Promise<DashboardMetricResult> {
  const page: KpiBreakdownPage = { page: 1, pageSize: 1, offset: 0 };
  try {
    let breakdown: AdminOverviewBreakdown;
    switch (metric.key) {
      case 'recognized_income':
        breakdown = await getGlKpiBreakdown(dbBinding, tenantId, context.period.startDate, context.period.endDate, 'revenue', page);
        break;
      case 'total_collection':
        breakdown = await getManagementCollectionKpiBreakdown(dbBinding, tenantId, context.period.startDate, context.period.endDate, page, [], false);
        break;
      case 'approved_expense_paid':
        breakdown = await getAccountingExpenseKpiBreakdown(dbBinding, tenantId, context.period.startDate, context.period.endDate, page, false);
        break;
      case 'operating_result':
        breakdown = await getAccountingProfitKpiBreakdown(dbBinding, tenantId, context.period.startDate, context.period.endDate, page);
        break;
      case 'outstanding_due_as_of':
        breakdown = await getPatientDueKpiBreakdown(dbBinding, tenantId, context.period.startDate, context.period.endDate, page);
        break;
      case 'available_drawer_cash':
        breakdown = await getDrawerCashKpiBreakdown(dbBinding, tenantId, page, false);
        break;
      case 'pending_approvals':
        breakdown = await getPendingApprovalsKpiBreakdown(dbBinding, tenantId, page, false);
        break;
      case 'critical_inventory_exceptions': {
        const values = await getExecutiveInventoryKpiSummary(
          dbBinding,
          tenantId,
          context.period.startDate,
          context.period.endDate,
          ['inventory_out_of_stock', 'inventory_expired'],
        );
        const total = Number(values.inventory_out_of_stock ?? 0) + Number(values.inventory_expired ?? 0);
        breakdown = { total, totalRows: total, sources: [{ amount: total, count: total }] };
        break;
      }
      case 'patient_deposit_liability':
        return unavailableAdminOverviewMetric(
          metric,
          context,
          generatedAt,
          'LEGACY_AS_OF_SOURCE_UNAVAILABLE',
          'The legacy deposit source cannot yet prove an as-of liability balance.',
        );
      case 'doctor_payable_outstanding':
        return unavailableAdminOverviewMetric(
          metric,
          context,
          generatedAt,
          'LEGACY_PAYABLE_SOURCE_UNAVAILABLE',
          'The legacy summary does not expose a reconciled outstanding doctor-payable balance.',
        );
      default:
        return unavailableAdminOverviewMetric(
          metric,
          context,
          generatedAt,
          'DASHBOARD_METRIC_UNSUPPORTED',
          'This metric is not available from the current overview provider.',
        );
    }
    return successfulAdminOverviewMetric(metric, context, generatedAt, breakdown);
  } catch (error) {
    return unavailableAdminOverviewMetric(
      metric,
      context,
      generatedAt,
      'DASHBOARD_SOURCE_FAILED',
      error instanceof Error ? error.message : 'Dashboard source failed',
    );
  }
}

function createAdminOverviewProvider(
  domain: string,
  dbBinding: Env['DB'],
  tenantId: string,
): DashboardOverviewProvider {
  return async ({ context, metrics, generatedAt }) => {
    const results = await Promise.all(metrics.map((metric) => (
      loadAdminOverviewMetric(metric, dbBinding, tenantId, context, generatedAt)
    )));
    const warnings: DashboardWarning[] = results.flatMap((metric) => metric.warnings);
    return { domain, metrics: results, warnings };
  };
}

// GET /admin-overview-v2 — feature-flagged, bounded semantic overview.
dashboardRoutes.get('/admin-overview-v2', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const previewEnabled = isAdminCommandCenterPreviewHostname(new URL(c.req.url).hostname)
    || isAdminCommandCenterPreviewMode(c.req.query('preview'));
  if (!previewEnabled && !await isAdminCommandCenterEnabled(c.env.DB, tenantId)) {
    return c.json({ error: 'Not found' }, 404);
  }

  const comparisonModeParam = c.req.query('comparisonMode');
  if (comparisonModeParam && !ADMIN_OVERVIEW_COMPARISON_MODES.has(comparisonModeParam as DashboardComparisonMode)) {
    return c.json({ error: 'Invalid dashboard reporting context' }, 400);
  }
  const roleContext = adminOverviewRoleContext(c.get('role'));
  const context = resolveDashboardFilterContext({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
    dateBasis: c.req.query('dateBasis'),
    branchId: c.req.query('branchId'),
    departmentId: c.req.query('departmentId'),
    doctorId: c.req.query('doctorId'),
    testSearch: c.req.query('testSearch'),
    rolePreset: roleContext.rolePreset,
    comparisonMode: comparisonModeParam as DashboardComparisonMode | undefined,
  });
  if (!context) {
    return c.json({ error: 'Invalid dashboard reporting context' }, 400);
  }

  const generatedAt = new Date().toISOString();
  const overview = await assembleAdminDashboardOverview({
    context,
    rolePreset: roleContext.rolePreset,
    permissions: roleContext.permissions,
    generatedAt,
    providers: {
      financial: createAdminOverviewProvider('financial', c.env.DB, tenantId),
      operations: createAdminOverviewProvider('operations', c.env.DB, tenantId),
      domainHealth: createAdminOverviewProvider('domain_health', c.env.DB, tenantId),
    },
  });
  return c.json(overview);
});

// GET /financial-control — reconciled financial control blocks for the command center.
dashboardRoutes.get('/financial-control', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStartDate = c.req.query('startDate');
  const requestedEndDate = c.req.query('endDate');
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset') ?? (requestedStartDate || requestedEndDate ? 'custom' : undefined),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: requestedStartDate,
    endDate: requestedEndDate,
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  const summaryPage: KpiBreakdownPage = { page: 1, pageSize: 1, offset: 0 };
  const recognizedIncomePromise = getGlKpiBreakdown(
    c.env.DB,
    tenantId,
    period.startDate,
    period.endDate,
    'revenue',
    summaryPage,
  );
  const approvedExpensePromise = getAccountingExpenseKpiBreakdown(
    c.env.DB,
    tenantId,
    period.startDate,
    period.endDate,
    summaryPage,
    false,
  );

  const response = await assembleFinancialControl({
    period,
    loaders: {
      recognizedIncome: () => recognizedIncomePromise,
      approvedExpensePaid: () => approvedExpensePromise,
      operatingResult: async () => {
        const [income, expense] = await Promise.all([recognizedIncomePromise, approvedExpensePromise]);
        return {
          sources: [...income.sources, ...expense.sources.map((source) => ({
            ...source,
            amount: -Math.abs(source.amount),
            direction: 'out' as const,
          }))],
          rows: [],
          totalRows: Number(income.totalRows ?? 0) + Number(expense.totalRows ?? 0),
          total: Number(income.total ?? 0) - Math.abs(Number(expense.total ?? 0)),
        };
      },
      depositReceipts: () => getDepositReceivedKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        summaryPage,
        false,
      ),
      collectionSplit: () => loadFinancialCollectionSplit({
        dbBinding: c.env.DB,
        tenantId,
        startDate: period.startDate,
        endDate: period.endDate,
      }),
      cashMovement: () => getCashMovementKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        summaryPage,
        false,
      ),
      drawerCash: () => getDrawerCashKpiBreakdown(c.env.DB, tenantId, summaryPage, false),
      doctorLiability: async () => {
        const doctorPerformance = await getDoctorPerformance({
          dbBinding: c.env.DB,
          tenantId,
          period,
          search: '',
          sortBy: 'outstandingCommission',
          sortDirection: 'desc',
          page: 1,
          pageSize: 10,
        });
        return {
          earned: doctorPerformance.totals.earnedCommission,
          waiver: doctorPerformance.totals.doctorWaiver,
          payable: doctorPerformance.totals.payableCommission,
          paid: doctorPerformance.totals.paidCommission,
          outstanding: doctorPerformance.totals.outstandingCommission,
          rowCount: doctorPerformance.totalRows,
          providerMode: doctorPerformance.queryContract.dataSource === 'canonical' ? 'canonical_only' : 'legacy',
        };
      },
    },
  });

  return c.json(response);
});

// GET /payment-methods — range-aware billing collection methods with deposits separate.
dashboardRoutes.get('/payment-methods', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStartDate = c.req.query('startDate');
  const requestedEndDate = c.req.query('endDate');
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset') ?? (requestedStartDate || requestedEndDate ? 'custom' : undefined),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: requestedStartDate,
    endDate: requestedEndDate,
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  const response = await getDashboardPaymentMethodBreakdown({
    dbBinding: c.env.DB,
    tenantId,
    period,
  });
  return c.json(response);
});

// GET /financial-trend — reconciled collection, paid expense, and result series.
dashboardRoutes.get('/financial-trend', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStartDate = c.req.query('startDate');
  const requestedEndDate = c.req.query('endDate');
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset') ?? (requestedStartDate || requestedEndDate ? 'custom' : undefined),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: requestedStartDate,
    endDate: requestedEndDate,
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  const allowedSeries = new Set<FinancialTrendSeries>(['collection', 'expense', 'result']);
  const requestedSeries = (c.req.query('series') || 'collection,expense,result')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean) as FinancialTrendSeries[];
  if (requestedSeries.length === 0 || requestedSeries.some((series) => !allowedSeries.has(series))) {
    return c.json({ error: 'series must contain collection, expense, or result' }, 400);
  }

  const response = await getDashboardFinancialTrend({
    dbBinding: c.env.DB,
    tenantId,
    period,
    requestedSeries: [...new Set(requestedSeries)],
  });
  return c.json(response);
});

// GET /kpi-summary — one compact response for all configurable executive cards.
// Full source/detail rows are fetched only when a user opens a KPI drilldown.
dashboardRoutes.get('/kpi-summary', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const period = buildKpiBreakdownPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  const summaryPage: KpiBreakdownPage = { page: 1, pageSize: 1, offset: 0 };
  const metricParam = c.req.query('metrics');
  const normalizedRequestedMetrics = metricParam
    ? metricParam
      .split(',')
      .map((value) => value.trim())
      .filter(isExecutiveCardMetric)
    : EXECUTIVE_KPI_REGISTRY.filter((item) => item.kind === 'card').map((item) => item.metricKey);
  const requestedMetricKeys = [...new Set(normalizedRequestedMetrics)] as ExecutiveCardMetricKey[];
  const requestedMetricSet = new Set<ExecutiveCardMetricKey>(requestedMetricKeys);
  const requestedInventoryMetrics = requestedMetricKeys.filter(isExecutiveInventoryMetric) as ExecutiveInventoryMetric[];
  const emptyBreakdown = () => ({ sources: [], rows: [], totalRows: 0, total: 0 });
  const emptyCommissionTotals = {
    visit_commission: 0,
    test_commission: 0,
    other_doctor_commission: 0,
    total_commission: 0,
  };
  const needsCategoryIncome = requestedMetricSet.has('opd_income')
    || requestedMetricSet.has('ot_income')
    || requestedMetricSet.has('pharmacy_income')
    || requestedMetricSet.has('radiology_income')
    || requestedMetricSet.has('uncategorized_income');
  const needsManagementIncome = requestedMetricSet.has('accounting_income') || requestedMetricSet.has('accounting_profit');
  const needsIncome = needsManagementIncome || needsCategoryIncome;
  const needsExpenses = requestedMetricSet.has('accounting_expenses') || requestedMetricSet.has('accounting_profit');
  const needsLabIncome = requestedMetricSet.has('lab_income');
  const needsIpdCollection = requestedMetricSet.has('ipd_collection');
  const needsDepositCollection = requestedMetricSet.has('deposit_collection');
  const needsCommission = requestedMetricSet.has('visit_commission')
    || requestedMetricSet.has('test_commission')
    || requestedMetricSet.has('other_doctor_commission')
    || requestedMetricSet.has('total_commission');
  const needsVisits = requestedMetricSet.has('total_visits');
  const needsPendingApprovals = requestedMetricSet.has('pending_approvals');
  const needsCashReceived = requestedMetricSet.has('cash_received');
  const needsCashMovement = requestedMetricSet.has('cash_movement');
  const needsDrawerCash = requestedMetricSet.has('drawer_cash');

  try {
    const [
      income,
      expenses,
      labIncome,
      ipdCollection,
      depositCollection,
      commissionTotals,
      visits,
      pendingApprovals,
      cashReceived,
      cashMovement,
      drawerCash,
      inventoryMetrics,
    ] = await Promise.all([
      needsManagementIncome
        ? getManagementCollectionKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, summaryPage, [], false)
        : needsIncome
          ? getAccountingIncomeKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, summaryPage, [], false)
          : Promise.resolve(emptyBreakdown()),
      needsExpenses
        ? getAccountingExpenseKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, summaryPage, false)
        : Promise.resolve(emptyBreakdown()),
      needsLabIncome
        ? getLabIncomeKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, summaryPage, false)
        : Promise.resolve(emptyBreakdown()),
      needsIpdCollection
        ? getIpdCollectionBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, summaryPage, false)
        : Promise.resolve(emptyBreakdown()),
      needsDepositCollection
        ? getDepositReceivedKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, summaryPage, false)
        : Promise.resolve(emptyBreakdown()),
      needsCommission
        ? getExecutiveCommissionTotals({
          dbBinding: c.env.DB,
          tenantId,
          startDate: period.startDate,
          endDate: period.endDate,
        })
        : Promise.resolve(emptyCommissionTotals),
      needsVisits
        ? getVisitsKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, summaryPage, false)
        : Promise.resolve(emptyBreakdown()),
      needsPendingApprovals
        ? getPendingApprovalsKpiBreakdown(c.env.DB, tenantId, summaryPage, false)
        : Promise.resolve(emptyBreakdown()),
      needsCashReceived
        ? getCashMovementSourceKpiBreakdown(
          c.env.DB,
          tenantId,
          period.startDate,
          period.endDate,
          [...CASH_RECEIVED_SOURCE_LABELS],
          summaryPage,
          false,
        )
        : Promise.resolve(emptyBreakdown()),
      needsCashMovement
        ? getCashMovementKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, summaryPage, false)
        : Promise.resolve(emptyBreakdown()),
      needsDrawerCash
        ? getDrawerCashKpiBreakdown(c.env.DB, tenantId, summaryPage, false)
        : Promise.resolve(emptyBreakdown()),
      getExecutiveInventoryKpiSummary(c.env.DB, tenantId, period.startDate, period.endDate, requestedInventoryMetrics),
    ]);

    const incomeTotal = Number(income.total ?? 0);
    const expenseTotal = Math.abs(Number(expenses.total ?? 0));
    const incomeBySource = new Map(
      income.sources.map((source) => [source.label, Number(source.amount ?? 0)]),
    );
    const categoryIncomeTotal = (sourceLabel: string) => Number(incomeBySource.get(sourceLabel) ?? 0);
    const values: Record<ExecutiveCardMetricKey, { total: number; valueType: 'money' | 'count' }> = {
      accounting_income: { total: incomeTotal, valueType: 'money' },
      accounting_expenses: { total: expenseTotal, valueType: 'money' },
      accounting_profit: { total: incomeTotal - expenseTotal, valueType: 'money' },
      opd_income: { total: categoryIncomeTotal('OPD'), valueType: 'money' },
      lab_income: { total: Number(labIncome.total ?? 0), valueType: 'money' },
      ipd_collection: { total: Number(ipdCollection.total ?? 0), valueType: 'money' },
      ot_income: { total: categoryIncomeTotal('OT'), valueType: 'money' },
      pharmacy_income: { total: categoryIncomeTotal('Pharmacy'), valueType: 'money' },
      radiology_income: { total: categoryIncomeTotal('Radiology'), valueType: 'money' },
      deposit_collection: { total: Number(depositCollection.total ?? 0), valueType: 'money' },
      uncategorized_income: { total: categoryIncomeTotal('Uncategorized'), valueType: 'money' },
      visit_commission: { total: commissionTotals.visit_commission, valueType: 'money' },
      test_commission: { total: commissionTotals.test_commission, valueType: 'money' },
      total_commission: { total: commissionTotals.total_commission, valueType: 'money' },
      other_doctor_commission: { total: commissionTotals.other_doctor_commission, valueType: 'money' },
      total_visits: { total: Number(visits.total ?? 0), valueType: 'count' },
      pending_approvals: { total: Number(pendingApprovals.total ?? 0), valueType: 'count' },
      cash_received: { total: Number(cashReceived.total ?? 0), valueType: 'money' },
      cash_movement: { total: Number(cashMovement.total ?? 0), valueType: 'money' },
      drawer_cash: { total: Number(drawerCash.total ?? 0), valueType: 'money' },
      inventory_stock_skus: { total: inventoryMetrics.inventory_stock_skus, valueType: 'count' },
      inventory_low_stock: { total: inventoryMetrics.inventory_low_stock, valueType: 'count' },
      inventory_out_of_stock: { total: inventoryMetrics.inventory_out_of_stock, valueType: 'count' },
      inventory_expiring_soon: { total: inventoryMetrics.inventory_expiring_soon, valueType: 'count' },
      inventory_expired: { total: inventoryMetrics.inventory_expired, valueType: 'count' },
      inventory_pending_purchase: { total: inventoryMetrics.inventory_pending_purchase, valueType: 'count' },
      lab_tests_completed: { total: inventoryMetrics.lab_tests_completed, valueType: 'count' },
      lab_reagent_consumed: { total: inventoryMetrics.lab_reagent_consumed, valueType: 'count' },
      lab_reagent_stock_skus: { total: inventoryMetrics.lab_reagent_stock_skus, valueType: 'count' },
      lab_reagent_low_stock: { total: inventoryMetrics.lab_reagent_low_stock, valueType: 'count' },
      lab_reagent_out_of_stock: { total: inventoryMetrics.lab_reagent_out_of_stock, valueType: 'count' },
      lab_reagent_expiring_soon: { total: inventoryMetrics.lab_reagent_expiring_soon, valueType: 'count' },
      lab_reagent_qc_issues: { total: inventoryMetrics.lab_reagent_qc_issues, valueType: 'count' },
      unmapped_lab_tests: { total: inventoryMetrics.unmapped_lab_tests, valueType: 'count' },
      consumption_exceptions: { total: inventoryMetrics.consumption_exceptions, valueType: 'count' },
      radiology_exams_completed: { total: inventoryMetrics.radiology_exams_completed, valueType: 'count' },
      radiology_stock_skus: { total: inventoryMetrics.radiology_stock_skus, valueType: 'count' },
      radiology_low_stock: { total: inventoryMetrics.radiology_low_stock, valueType: 'count' },
      radiology_out_of_stock: { total: inventoryMetrics.radiology_out_of_stock, valueType: 'count' },
      radiology_expiring_soon: { total: inventoryMetrics.radiology_expiring_soon, valueType: 'count' },
      radiology_issue_lines: { total: inventoryMetrics.radiology_issue_lines, valueType: 'count' },
    };

    return c.json({
      period,
      metrics: EXECUTIVE_KPI_REGISTRY
        .filter((item): item is typeof item & { metricKey: ExecutiveCardMetricKey; kind: 'card' } => (
          item.kind === 'card' && requestedMetricSet.has(item.metricKey as ExecutiveCardMetricKey)
        ))
        .map((item) => ({
          metric: item.metricKey,
          title: item.label,
          total: roundMoney(values[item.metricKey].total),
          valueType: values[item.metricKey].valueType,
        })),
    });
  } catch (error) {
    console.error('KPI summary error:', error);
    return c.json({ error: 'Failed to fetch KPI summary' }, 500);
  }
});

// GET /kpi-breakdown — drill into a dashboard KPI metric with source breakdown and detail rows
dashboardRoutes.get('/kpi-breakdown', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const metric = normalizeKpiMetric(c.req.query('metric'));
  if (!metric) {
    return c.json({ error: 'Unsupported KPI metric' }, 400);
  }

  const period = buildKpiBreakdownPeriod({
    preset: c.req.query('preset'),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  });
  const page = parseKpiBreakdownPage(c.req.query('page'), c.req.query('pageSize'));
  const sourceLabelParam = c.req.query('sourceLabel');
  const cashMovementSourceLabel = normalizeCashMovementSourceLabel(sourceLabelParam);
  if (sourceLabelParam && metric !== 'accounting_income' && !cashMovementSourceLabel) {
    return c.json({ error: 'Unsupported cash movement source label' }, 400);
  }
  const sourceLabels = metric === 'accounting_income' ? parseKpiSourceLabels(sourceLabelParam) : [];
  const doctorIdParam = c.req.query('doctorId');
  const parsedDoctorId = doctorIdParam === undefined || doctorIdParam === '' ? null : Number(doctorIdParam);
  if (parsedDoctorId !== null && (!Number.isInteger(parsedDoctorId) || parsedDoctorId <= 0)) {
    return c.json({ error: 'doctorId must be a positive integer' }, 400);
  }
  if (parsedDoctorId !== null && !isExecutiveCommissionMetric(metric)) {
    return c.json({ error: 'doctorId is only supported for commission metrics' }, 400);
  }
  const doctorId = parsedDoctorId as number | null;
  if (!period) {
    return c.json({ error: 'Invalid dashboard date range' }, 400);
  }

  try {
    if (isExecutiveInventoryMetric(metric)) {
      const inventoryBreakdown = await getExecutiveInventoryKpiBreakdown(
        c.env.DB,
        tenantId,
        metric,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, {
        ...inventoryBreakdown,
        rows: mapKpiRows(inventoryBreakdown.rows),
      }, 'count', page));
    }

    if (cashMovementSourceLabel) {
      const breakdown = await getCashMovementSourceKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        [cashMovementSourceLabel],
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }

    if (metric === 'cash_received') {
      const breakdown = await getCashMovementSourceKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        [...CASH_RECEIVED_SOURCE_LABELS],
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'ipd_collection') {
      const breakdown = await getIpdCollectionBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }

    if (metric === 'billing_collection') {
      const breakdown = await getCashMovementSourceKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        [...CASH_BILL_SOURCE_LABELS],
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'due_collection') {
      const breakdown = await getCashMovementSourceKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        ['mdDashboard.kpi.cashMovementSourceDueCollection'],
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'deposit_collection') {
      const breakdown = await getDepositReceivedKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'drawer_cash') {
      const breakdown = await getDrawerCashKpiBreakdown(c.env.DB, tenantId, page);
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'cash_movement') {
      const breakdown = await getCashMovementKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'doctor_payout') {
      const breakdown = await getDoctorPayoutKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'gl_income') {
      const breakdown = await getGlKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, 'revenue', page);
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'gl_expenses') {
      const breakdown = await getGlKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, 'expense', page);
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'gl_profit') {
      const breakdown = await getGlProfitKpiBreakdown(c.env.DB, tenantId, period.startDate, period.endDate, page);
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'accounting_income') {
      const breakdown = await getManagementCollectionKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
        sourceLabels,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    const categorySourceLabel = metric === 'opd_income'
      ? 'OPD'
      : metric === 'ot_income'
        ? 'OT'
        : metric === 'pharmacy_income'
          ? 'Pharmacy'
          : metric === 'radiology_income'
            ? 'Radiology'
            : metric === 'uncategorized_income'
              ? 'Uncategorized'
              : null;
    if (categorySourceLabel) {
      const breakdown = await getAccountingIncomeKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
        [categorySourceLabel],
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'lab_income') {
      const breakdown = await getLabIncomeKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (isExecutiveCommissionMetric(metric)) {
      const commissionBreakdown = await getExecutiveCommissionBreakdown({
        dbBinding: c.env.DB,
        tenantId,
        startDate: period.startDate,
        endDate: period.endDate,
        metric,
        page,
        doctorId: doctorId ?? undefined,
      });
      return c.json(buildKpiBreakdownPayload(metric, period, {
        ...commissionBreakdown,
        rows: mapKpiRows(commissionBreakdown.rows),
      }, 'money', page));
    }
    if (metric === 'total_visits') {
      const breakdown = await getVisitsKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'count', page));
    }
    if (metric === 'pending_approvals') {
      const breakdown = await getPendingApprovalsKpiBreakdown(c.env.DB, tenantId, page);
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'count', page));
    }
    if (metric === 'patient_due') {
      const breakdown = await getPatientDueKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'accounting_expenses') {
      const breakdown = await getAccountingExpenseKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'accounting_profit') {
      const breakdown = await getAccountingProfitKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'patient_advance') {
      const breakdown = await getPatientAdvanceKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'pending_handover') {
      const breakdown = await getPendingHandoverKpiBreakdown(c.env.DB, tenantId, page);
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'total_discount') {
      const breakdown = await getDiscountKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'money', page));
    }
    if (metric === 'pending_posting') {
      const breakdown = await getPendingPostingKpiBreakdown(
        c.env.DB,
        tenantId,
        period.startDate,
        period.endDate,
        page,
      );
      return c.json(buildKpiBreakdownPayload(metric, period, breakdown, 'count', page));
    }

    return c.json(buildKpiBreakdownPayload(metric, period, emptyKpiBreakdown()));
  } catch (error) {
    console.error('KPI breakdown error:', error);
    return c.json({ error: 'Failed to fetch KPI breakdown' }, 500);
  }
});

// GET /security-alerts — fraud detection & security monitoring
dashboardRoutes.get('/security-alerts', adminGuard, async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();

  try {
    const batchResults = await db.$client.batch([
      // Canceled bills today (suspicious activity)
      db.$client.prepare(`
        SELECT b.id, b.invoice_no, b.total, b.discount, b.cancelled_at,
               u.name as cancelled_by_name, b.cancel_reason
        FROM bills b
        LEFT JOIN users u ON b.cancelled_by = u.id AND u.tenant_id = b.tenant_id
        WHERE b.tenant_id = ? AND ${localReportDate('b.cancelled_at')} = date(?)
        ORDER BY b.cancelled_at DESC
        LIMIT 20
      `).bind(tenantId, today),
      // All discounted bills today, kept separate from high-discount alerts.
      db.$client.prepare(`
        /* all_discount_bills */
        WITH bill_subtotals AS (
          SELECT
            b.id,
            COALESCE(
              NULLIF(SUM(COALESCE(ii.quantity, 1) * COALESCE(ii.unit_price, 0)), 0),
              MAX(COALESCE(b.total, 0) + COALESCE(b.discount, 0) - COALESCE(b.tax_total, 0)),
              MAX(COALESCE(b.total, 0) + COALESCE(b.discount, 0)),
              0
            ) AS subtotal
          FROM bills b
          LEFT JOIN invoice_items ii ON ii.bill_id = b.id AND ii.tenant_id = b.tenant_id
          WHERE b.tenant_id = ? AND ${localReportDate('b.created_at')} = date(?)
          GROUP BY b.id
        )
        SELECT b.id, b.invoice_no, b.total, bs.subtotal, b.discount, b.created_at,
               NULLIF(TRIM(COALESCE(b.discount_by_name, '')), '') AS discount_by_name,
               CASE WHEN bs.subtotal > 0 THEN ROUND((b.discount * 100.0 / bs.subtotal), 1) ELSE 0 END as discount_pct,
               u.name as created_by_name
        FROM bills b
        JOIN bill_subtotals bs ON bs.id = b.id
        LEFT JOIN users u ON b.created_by = u.id AND u.tenant_id = b.tenant_id
        WHERE b.tenant_id = ? AND ${localReportDate('b.created_at')} = date(?)
          AND b.discount > 0
          AND bs.subtotal > 0
          AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        ORDER BY b.discount DESC, b.created_at DESC
        LIMIT 50
      `).bind(tenantId, today, tenantId, today),
      // High discount bills today (> 20% of the pre-discount subtotal).
      db.$client.prepare(`
        /* high_discount_bills */
        WITH bill_subtotals AS (
          SELECT
            b.id,
            COALESCE(
              NULLIF(SUM(COALESCE(ii.quantity, 1) * COALESCE(ii.unit_price, 0)), 0),
              MAX(COALESCE(b.total, 0) + COALESCE(b.discount, 0) - COALESCE(b.tax_total, 0)),
              MAX(COALESCE(b.total, 0) + COALESCE(b.discount, 0)),
              0
            ) AS subtotal
          FROM bills b
          LEFT JOIN invoice_items ii ON ii.bill_id = b.id AND ii.tenant_id = b.tenant_id
          WHERE b.tenant_id = ? AND ${localReportDate('b.created_at')} = date(?)
          GROUP BY b.id
        )
        SELECT b.id, b.invoice_no, b.total, bs.subtotal, b.discount,
               NULLIF(TRIM(COALESCE(b.discount_by_name, '')), '') AS discount_by_name,
               CASE WHEN bs.subtotal > 0 THEN ROUND((b.discount * 100.0 / bs.subtotal), 1) ELSE 0 END as discount_pct,
               u.name as created_by_name, b.created_at
        FROM bills b
        JOIN bill_subtotals bs ON bs.id = b.id
        LEFT JOIN users u ON b.created_by = u.id AND u.tenant_id = b.tenant_id
        WHERE b.tenant_id = ? AND ${localReportDate('b.created_at')} = date(?)
          AND b.discount > 0
          AND bs.subtotal > 0
          AND (b.discount * 100.0 / bs.subtotal) > 20
          AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        ORDER BY discount_pct DESC
        LIMIT 20
      `).bind(tenantId, today, tenantId, today),
      // Shift handover discrepancies (shortage alerts)
      db.$client.prepare(`
        SELECT h.id, bc.counter_name, h.handover_amount,
               s.closing_cash_declared as received_amount,
               s.variance, h.status, h.created_at,
               u.name as handed_over_by
        FROM billing_handovers h
        JOIN billing_counter_sessions s
          ON s.id = h.counter_session_id AND s.tenant_id = h.tenant_id
        LEFT JOIN billing_counters bc
          ON bc.id = s.counter_id AND bc.tenant_id = h.tenant_id
        LEFT JOIN users u
          ON u.id = h.handover_by AND u.tenant_id = h.tenant_id
        WHERE h.tenant_id = ? AND ${localReportDate('s.closed_at')} = date(?)
          AND COALESCE(s.variance, 0) != 0
          AND h.handover_type = 'counter'
        ORDER BY ABS(s.variance) DESC
        LIMIT 20
      `).bind(tenantId, today),
      // Suspicious: bills edited after creation (audit trail)
      db.$client.prepare(`
        SELECT al.id, al.action, al.table_name, al.record_id,
               al.created_at, u.name as user_name,
               al.old_value, al.new_value
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id AND u.tenant_id = al.tenant_id
        WHERE al.tenant_id = ? AND ${localReportDate('al.created_at')} = date(?)
          AND al.table_name = 'bills'
          AND al.action IN ('UPDATE', 'DELETE')
        ORDER BY al.created_at DESC
        LIMIT 20
      `).bind(tenantId, today),
      // Low stock medicines (quantity < 10)
      db.$client.prepare(`
        SELECT id, name, quantity
        FROM medicines
        WHERE tenant_id = ? AND quantity < 10 AND quantity >= 0
        ORDER BY quantity ASC
        LIMIT 10
      `).bind(tenantId),
    ]);

    const [
      canceledBillsBatch,
      discountBillsBatch,
      highDiscountBillsBatch,
      handoverDiscrepanciesBatch,
      billEditsBatch,
      lowStockBatch,
    ] = batchResults;

    return c.json({
      canceledBills: (canceledBillsBatch.results || []).map((r: any) => ({
        id: r.id,
        invoiceNo: r.invoice_no,
        total: Number(r.total ?? 0),
        discount: Number(r.discount ?? 0),
        cancelledAt: r.cancelled_at,
        cancelledBy: r.cancelled_by_name,
        reason: r.cancel_reason,
      })),
      discountBills: (discountBillsBatch.results || []).map((r: any) => {
        const paidAmount = Number(r.total ?? 0);
        const discount = Number(r.discount ?? 0);
        const totalAmount = Number(r.subtotal ?? 0) || (paidAmount + discount);
        return {
          id: r.id,
          invoiceNo: r.invoice_no,
          total: totalAmount,
          totalAmount,
          paidAmount,
          subtotal: totalAmount,
          discount,
          discountPct: totalAmount > 0 ? Number(((discount * 100) / totalAmount).toFixed(1)) : 0,
          discountByName: r.discount_by_name || null,
          createdBy: r.created_by_name,
          createdAt: r.created_at,
        };
      }),
      highDiscountBills: (highDiscountBillsBatch.results || []).map((r: any) => {
        const paidAmount = Number(r.total ?? 0);
        const discount = Number(r.discount ?? 0);
        const totalAmount = Number(r.subtotal ?? 0) || (paidAmount + discount);
        return {
          id: r.id,
          invoiceNo: r.invoice_no,
          total: totalAmount,
          totalAmount,
          paidAmount,
          subtotal: totalAmount,
          discount,
          discountPct: Number(r.discount_pct ?? (totalAmount > 0 ? ((discount * 100) / totalAmount).toFixed(1) : 0)),
          discountByName: r.discount_by_name || null,
          createdBy: r.created_by_name,
          createdAt: r.created_at,
        };
      }),
      handoverDiscrepancies: (handoverDiscrepanciesBatch.results || []).map((r: any) => ({
        id: r.id,
        counterName: r.counter_name,
        handoverAmount: Number(r.handover_amount ?? 0),
        receivedAmount: Number(r.received_amount ?? 0),
        variance: Number(r.variance ?? 0),
        status: r.status,
        handedOverBy: r.handed_over_by,
        createdAt: r.created_at,
      })),
      billEdits: (billEditsBatch.results || []).map((r: any) => ({
        id: r.id,
        action: r.action,
        tableName: r.table_name,
        recordId: r.record_id,
        createdAt: r.created_at,
        userName: r.user_name,
        oldValues: r.old_value,
        newValues: r.new_value,
      })),
      lowStockItems: (lowStockBatch.results || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        quantity: Number(r.quantity ?? 0),
        unit: 'units',
      })),
      summary: {
        canceledCount: (canceledBillsBatch.results || []).length,
        highDiscountCount: (highDiscountBillsBatch.results || []).length,
        discrepancyCount: (handoverDiscrepanciesBatch.results || []).length,
        billEditCount: (billEditsBatch.results || []).length,
        lowStockCount: (lowStockBatch.results || []).length,
      },
    });
  } catch (error) {
    console.error('Security alerts error:', error);
    return c.json({ error: 'Failed to fetch security alerts' }, 500);
  }
});

// GET /patient-age-analytics/details — aggregate services, doctors, or departments for one age bucket.
dashboardRoutes.get('/patient-age-analytics/details', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStartDate = c.req.query('startDate');
  const requestedEndDate = c.req.query('endDate');
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset') ?? (requestedStartDate || requestedEndDate ? 'custom' : undefined),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: requestedStartDate,
    endDate: requestedEndDate,
  });
  if (!period) return c.json({ error: 'Invalid reporting period' }, 400);

  const ageBucket = c.req.query('ageBucket') as PatientAgeBucket | undefined;
  if (!ageBucket || !PATIENT_AGE_BUCKET_ORDER.includes(ageBucket)) {
    return c.json({ error: 'Invalid age bucket' }, 400);
  }

  const requestedView = c.req.query('view');
  if (!requestedView || !['services', 'doctors', 'departments', 'patients'].includes(requestedView)) {
    return c.json({ error: 'Invalid detail view' }, 400);
  }
  const view = requestedView as PatientAgeAggregateDetailView | 'patients';
  if (view === 'patients') {
    const role = c.get('role');
    const permissions = new Set<string>([
      ...getPermissionsForRole(role),
      ...(c.get('permissions') ?? []),
    ]);
    const canReadPatients = role === 'hospital_admin'
      || role === 'super_admin'
      || permissions.has('*')
      || permissions.has('patients:read');
    if (!canReadPatients) {
      return c.json({ error: 'Patients read permission required' }, 403);
    }
  }

  const sortBy = (c.req.query('sortBy') ?? (view === 'services' ? 'services' : view === 'patients' ? 'name' : 'visits')) as PatientAgeDetailSort;
  if (!(['name', 'uniquePatients', 'visits', 'services', 'collection'] as const).includes(sortBy)) {
    return c.json({ error: 'Invalid sort field' }, 400);
  }
  const sortDirection = (c.req.query('sortDirection') ?? 'desc') as PatientAgeDetailSortDirection;
  if (!(['asc', 'desc'] as const).includes(sortDirection)) {
    return c.json({ error: 'Invalid sort direction' }, 400);
  }

  const pageRaw = c.req.query('page') ?? '1';
  const pageSizeRaw = c.req.query('pageSize') ?? '25';
  if (!/^\d+$/.test(pageRaw) || !/^\d+$/.test(pageSizeRaw)) {
    return c.json({ error: 'Invalid pagination' }, 400);
  }
  const page = Number(pageRaw);
  const pageSize = Number(pageSizeRaw);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return c.json({ error: 'Invalid pagination' }, 400);
  }

  if (view === 'patients') {
    const response = await getPatientAgePatientDetails({
      dbBinding: c.env.DB,
      tenantId,
      period,
      ageBucket,
      sortBy,
      sortDirection,
      page,
      pageSize,
    });
    return c.json(response);
  }

  const response = await getPatientAgeAggregateDetails({
    dbBinding: c.env.DB,
    tenantId,
    period,
    ageBucket,
    view,
    sortBy,
    sortDirection,
    page,
    pageSize,
  });
  return c.json(response);
});

// GET /patient-age-analytics — aggregate age-at-service reporting without patient identity.
dashboardRoutes.get('/patient-age-analytics', adminGuard, async (c) => {
  const tenantId = requireTenantId(c);
  const requestedStartDate = c.req.query('startDate');
  const requestedEndDate = c.req.query('endDate');
  const period = resolveExecutiveDashboardPeriod({
    preset: c.req.query('preset') ?? (requestedStartDate || requestedEndDate ? 'custom' : undefined),
    range: c.req.query('range'),
    date: c.req.query('date'),
    startDate: requestedStartDate,
    endDate: requestedEndDate,
  });
  if (!period) return c.json({ error: 'Invalid reporting period' }, 400);

  const response = await getPatientAgeAnalytics({
    dbBinding: c.env.DB,
    tenantId,
    period,
  });
  return c.json(response);
});

export default dashboardRoutes;

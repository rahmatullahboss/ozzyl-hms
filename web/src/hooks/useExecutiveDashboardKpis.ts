import { useMemo } from 'react';
import type { KpiBreakdownData } from '../components/dashboard/KpiBreakdownDrawer';
import { useApiQuery } from './useApiQuery';

export type ExecutiveDashboardSection =
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

export type ExecutiveDashboardPanelMetric =
  | 'doctor_performance_table'
  | 'test_volume_table'
  | 'income_service_breakdown'
  | 'expense_source_breakdown'
  | 'reagent_reconciliation_table';

export type ExecutiveDashboardCardMetric =
  | 'accounting_income'
  | 'accounting_expenses'
  | 'accounting_profit'
  | 'opd_income'
  | 'lab_income'
  | 'ipd_collection'
  | 'ot_income'
  | 'pharmacy_income'
  | 'radiology_income'
  | 'deposit_collection'
  | 'uncategorized_income'
  | 'visit_commission'
  | 'test_commission'
  | 'total_commission'
  | 'other_doctor_commission'
  | 'total_visits'
  | 'pending_approvals'
  | 'cash_received'
  | 'cash_movement'
  | 'drawer_cash'
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

export type ExecutiveDashboardMetric = ExecutiveDashboardCardMetric | ExecutiveDashboardPanelMetric;
export type ExecutiveDashboardKind = 'card' | 'panel';

export interface ExecutiveDashboardKpiConfigItem {
  metricKey: ExecutiveDashboardMetric;
  section: ExecutiveDashboardSection;
  kind: ExecutiveDashboardKind;
  enabled: boolean;
  position: number;
  label: string;
  labelOverride: string | null;
}

export type ExecutiveDashboardCardConfigItem = ExecutiveDashboardKpiConfigItem & {
  kind: 'card';
  metricKey: ExecutiveDashboardCardMetric;
};

export type ExecutiveDashboardPanelConfigItem = ExecutiveDashboardKpiConfigItem & {
  kind: 'panel';
  metricKey: ExecutiveDashboardPanelMetric;
};

export interface ExecutiveDashboardKpiConfigResponse {
  dashboardKey: 'executive';
  items: ExecutiveDashboardKpiConfigItem[];
}

export interface ExecutiveDashboardSectionDefinition {
  key: ExecutiveDashboardSection;
  title: string;
  description: string;
}

export const EXECUTIVE_DASHBOARD_SECTIONS: ExecutiveDashboardSectionDefinition[] = [
  { key: 'management', title: 'Management', description: 'Collection, expense, income, and doctor commission controls.' },
  { key: 'doctor_performance', title: 'Doctor Performance', description: 'Doctor-wise visits, collections, tests, and commissions.' },
  { key: 'test_performance', title: 'Test Performance', description: 'Test-wise volume, completion, billing, collection, and due.' },
  { key: 'income_analysis', title: 'Income Analysis', description: 'Exact service-level collection allocation.' },
  { key: 'expense_analysis', title: 'Expense Analysis', description: 'Paid operating expenses and executed doctor payouts.' },
  { key: 'cash_control', title: 'Cash Control', description: 'Physical cash movement and available drawer balances.' },
  { key: 'approvals', title: 'Approvals', description: 'Pending management approval workload.' },
  { key: 'inventory', title: 'Inventory Control', description: 'Stock availability, reorder, expiry, and purchase-request monitoring.' },
  { key: 'lab_reagent', title: 'Laboratory Reagent Control', description: 'Reagent use, stock, mapping, reconciliation, expiry, and QC.' },
  { key: 'radiology_stock', title: 'Radiology / X-ray Stock', description: 'Imaging activity and radiology consumable stock monitoring.' },
];

export const DEFAULT_EXECUTIVE_KPI_CONFIG: ExecutiveDashboardKpiConfigItem[] = [
  { metricKey: 'accounting_income', section: 'management', kind: 'card', enabled: true, position: 0, label: 'Total Collection', labelOverride: null },
  { metricKey: 'accounting_expenses', section: 'management', kind: 'card', enabled: true, position: 1, label: 'Total Expense', labelOverride: null },
  { metricKey: 'accounting_profit', section: 'management', kind: 'card', enabled: true, position: 2, label: 'Net Income', labelOverride: null },
  { metricKey: 'opd_income', section: 'management', kind: 'card', enabled: true, position: 3, label: 'OPD / Doctor Visit Collection', labelOverride: null },
  { metricKey: 'lab_income', section: 'management', kind: 'card', enabled: true, position: 4, label: 'Diagnostic / Laboratory Collection', labelOverride: null },
  { metricKey: 'ipd_collection', section: 'management', kind: 'card', enabled: true, position: 5, label: 'IPD / Admitted Patient Collection', labelOverride: null },
  { metricKey: 'ot_income', section: 'management', kind: 'card', enabled: true, position: 6, label: 'OT / Procedure Collection', labelOverride: null },
  { metricKey: 'pharmacy_income', section: 'management', kind: 'card', enabled: true, position: 7, label: 'Pharmacy / Medicine Collection', labelOverride: null },
  { metricKey: 'radiology_income', section: 'management', kind: 'card', enabled: true, position: 8, label: 'Radiology / Imaging Collection', labelOverride: null },
  { metricKey: 'deposit_collection', section: 'management', kind: 'card', enabled: true, position: 9, label: 'Deposits / Advances', labelOverride: null },
  { metricKey: 'uncategorized_income', section: 'management', kind: 'card', enabled: true, position: 10, label: 'Uncategorized Services', labelOverride: null },
  { metricKey: 'visit_commission', section: 'management', kind: 'card', enabled: true, position: 11, label: 'Visit Commission', labelOverride: null },
  { metricKey: 'test_commission', section: 'management', kind: 'card', enabled: true, position: 12, label: 'Test Commission', labelOverride: null },
  { metricKey: 'total_commission', section: 'management', kind: 'card', enabled: true, position: 13, label: 'Total Doctor Commission', labelOverride: null },
  { metricKey: 'other_doctor_commission', section: 'management', kind: 'card', enabled: true, position: 14, label: 'Other Doctor Commission', labelOverride: null },
  { metricKey: 'doctor_performance_table', section: 'doctor_performance', kind: 'panel', enabled: true, position: 10, label: 'Doctor Performance', labelOverride: null },
  { metricKey: 'total_visits', section: 'doctor_performance', kind: 'card', enabled: false, position: 11, label: 'Total Visits', labelOverride: null },
  { metricKey: 'test_volume_table', section: 'test_performance', kind: 'panel', enabled: true, position: 20, label: 'Test Performance', labelOverride: null },
  { metricKey: 'lab_tests_completed', section: 'test_performance', kind: 'card', enabled: true, position: 21, label: 'Tests Completed', labelOverride: null },
  { metricKey: 'income_service_breakdown', section: 'income_analysis', kind: 'panel', enabled: true, position: 30, label: 'Income by Service', labelOverride: null },
  { metricKey: 'expense_source_breakdown', section: 'expense_analysis', kind: 'panel', enabled: true, position: 40, label: 'Expense Analysis', labelOverride: null },
  { metricKey: 'cash_received', section: 'cash_control', kind: 'card', enabled: true, position: 50, label: 'Physical Cash In', labelOverride: null },
  { metricKey: 'cash_movement', section: 'cash_control', kind: 'card', enabled: true, position: 51, label: 'Net Cash Movement', labelOverride: null },
  { metricKey: 'drawer_cash', section: 'cash_control', kind: 'card', enabled: true, position: 52, label: 'Available Drawer Cash', labelOverride: null },
  { metricKey: 'pending_approvals', section: 'approvals', kind: 'card', enabled: true, position: 55, label: 'Pending Approvals', labelOverride: null },
  { metricKey: 'inventory_stock_skus', section: 'inventory', kind: 'card', enabled: true, position: 70, label: 'Active Stock SKUs', labelOverride: null },
  { metricKey: 'inventory_low_stock', section: 'inventory', kind: 'card', enabled: true, position: 71, label: 'Low-stock SKUs', labelOverride: null },
  { metricKey: 'inventory_out_of_stock', section: 'inventory', kind: 'card', enabled: true, position: 72, label: 'Out-of-stock SKUs', labelOverride: null },
  { metricKey: 'inventory_expiring_soon', section: 'inventory', kind: 'card', enabled: true, position: 73, label: 'Expiring Soon', labelOverride: null },
  { metricKey: 'inventory_expired', section: 'inventory', kind: 'card', enabled: true, position: 74, label: 'Expired Lots', labelOverride: null },
  { metricKey: 'inventory_pending_purchase', section: 'inventory', kind: 'card', enabled: true, position: 75, label: 'Pending Purchase Requests', labelOverride: null },
  { metricKey: 'lab_reagent_consumed', section: 'lab_reagent', kind: 'card', enabled: true, position: 80, label: 'Reagent Types Used', labelOverride: null },
  { metricKey: 'lab_reagent_stock_skus', section: 'lab_reagent', kind: 'card', enabled: true, position: 81, label: 'Available Reagent SKUs', labelOverride: null },
  { metricKey: 'lab_reagent_low_stock', section: 'lab_reagent', kind: 'card', enabled: true, position: 82, label: 'Low-stock Reagents', labelOverride: null },
  { metricKey: 'lab_reagent_out_of_stock', section: 'lab_reagent', kind: 'card', enabled: true, position: 83, label: 'Out-of-stock Reagents', labelOverride: null },
  { metricKey: 'lab_reagent_expiring_soon', section: 'lab_reagent', kind: 'card', enabled: true, position: 84, label: 'Reagent Lots Near Expiry', labelOverride: null },
  { metricKey: 'lab_reagent_qc_issues', section: 'lab_reagent', kind: 'card', enabled: true, position: 85, label: 'Reagent QC Exceptions', labelOverride: null },
  { metricKey: 'unmapped_lab_tests', section: 'lab_reagent', kind: 'card', enabled: true, position: 86, label: 'Unmapped Lab Tests', labelOverride: null },
  { metricKey: 'consumption_exceptions', section: 'lab_reagent', kind: 'card', enabled: true, position: 87, label: 'Consumption Exceptions', labelOverride: null },
  { metricKey: 'reagent_reconciliation_table', section: 'lab_reagent', kind: 'panel', enabled: true, position: 89, label: 'Reagent Reconciliation', labelOverride: null },
  { metricKey: 'radiology_exams_completed', section: 'radiology_stock', kind: 'card', enabled: true, position: 90, label: 'Imaging Exams Completed', labelOverride: null },
  { metricKey: 'radiology_stock_skus', section: 'radiology_stock', kind: 'card', enabled: true, position: 91, label: 'Available Radiology Stock', labelOverride: null },
  { metricKey: 'radiology_low_stock', section: 'radiology_stock', kind: 'card', enabled: true, position: 92, label: 'Low-stock Radiology Items', labelOverride: null },
  { metricKey: 'radiology_out_of_stock', section: 'radiology_stock', kind: 'card', enabled: true, position: 93, label: 'Out-of-stock Radiology Items', labelOverride: null },
  { metricKey: 'radiology_expiring_soon', section: 'radiology_stock', kind: 'card', enabled: true, position: 94, label: 'Radiology Lots Near Expiry', labelOverride: null },
  { metricKey: 'radiology_issue_lines', section: 'radiology_stock', kind: 'card', enabled: true, position: 95, label: 'Radiology Issues', labelOverride: null },
];

const EXECUTIVE_COUNT_METRICS = new Set<ExecutiveDashboardCardMetric>([
  'total_visits',
  'pending_approvals',
  'inventory_stock_skus',
  'inventory_low_stock',
  'inventory_out_of_stock',
  'inventory_expiring_soon',
  'inventory_expired',
  'inventory_pending_purchase',
  'lab_tests_completed',
  'lab_reagent_consumed',
  'lab_reagent_stock_skus',
  'lab_reagent_low_stock',
  'lab_reagent_out_of_stock',
  'lab_reagent_expiring_soon',
  'lab_reagent_qc_issues',
  'unmapped_lab_tests',
  'consumption_exceptions',
  'radiology_exams_completed',
  'radiology_stock_skus',
  'radiology_low_stock',
  'radiology_out_of_stock',
  'radiology_expiring_soon',
  'radiology_issue_lines',
]);

export function executiveDashboardMetricValueType(metric: ExecutiveDashboardCardMetric): 'money' | 'count' {
  return EXECUTIVE_COUNT_METRICS.has(metric) ? 'count' : 'money';
}

interface ExecutiveKpiSummaryResponse {
  period: KpiBreakdownData['period'];
  metrics: Array<{
    metric: ExecutiveDashboardCardMetric;
    title: string;
    total: number;
    valueType: 'money' | 'count';
  }>;
}

interface ExecutiveKpiQueryState {
  data?: KpiBreakdownData;
  isLoading: boolean;
  isError: boolean;
}

function appendQuery(path: string, suffix = ''): string {
  if (!suffix) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${suffix.replace(/^\?/, '')}`;
}

function isCardItem(item: ExecutiveDashboardKpiConfigItem): item is ExecutiveDashboardCardConfigItem {
  return item.kind === 'card';
}

function isPanelItem(item: ExecutiveDashboardKpiConfigItem): item is ExecutiveDashboardPanelConfigItem {
  return item.kind === 'panel';
}

export function useExecutiveDashboardKpis(queryKeyScope: string, querySuffix = '') {
  const configQuery = useApiQuery<ExecutiveDashboardKpiConfigResponse>(
    [queryKeyScope, 'executive-kpis', 'config'],
    '/api/dashboard/kpi-config',
    { staleTime: 5 * 60_000 },
  );
  const allItems = useMemo(
    () => [...(configQuery.data?.items ?? DEFAULT_EXECUTIVE_KPI_CONFIG)]
      .sort((a, b) => a.position - b.position || a.metricKey.localeCompare(b.metricKey)),
    [configQuery.data?.items],
  );
  const enabledItems = useMemo(() => allItems.filter((item) => item.enabled), [allItems]);
  const cardItems = useMemo(() => enabledItems.filter(isCardItem), [enabledItems]);
  const panelItems = useMemo(() => enabledItems.filter(isPanelItem), [enabledItems]);
  const requestedMetricParam = cardItems.map((item) => item.metricKey).join(',');
  const summarySuffix = [querySuffix.replace(/^\?/, ''), `metrics=${encodeURIComponent(requestedMetricParam)}`]
    .filter(Boolean)
    .join('&');
  const summaryQuery = useApiQuery<ExecutiveKpiSummaryResponse>(
    [queryKeyScope, 'executive-kpis', 'summary', querySuffix || 'today', requestedMetricParam],
    appendQuery('/api/dashboard/kpi-summary', summarySuffix),
    { refetchInterval: 60_000, enabled: !configQuery.isLoading && cardItems.length > 0 },
  );

  const queries = useMemo(() => {
    const metricRows = new Map(
      (summaryQuery.data?.metrics ?? []).map((item) => [item.metric, item]),
    );
    const result = {} as Record<ExecutiveDashboardCardMetric, ExecutiveKpiQueryState>;

    for (const config of DEFAULT_EXECUTIVE_KPI_CONFIG.filter(isCardItem)) {
      const summary = metricRows.get(config.metricKey);
      result[config.metricKey] = {
        data: summary && summaryQuery.data ? {
          metric: summary.metric,
          title: summary.title,
          total: Number(summary.total ?? 0),
          valueType: summary.valueType,
          period: summaryQuery.data.period,
          sources: [],
          rows: [],
          totalRows: 0,
        } : undefined,
        isLoading: summaryQuery.isLoading,
        isError: summaryQuery.isError,
      };
    }
    return result;
  }, [summaryQuery.data, summaryQuery.isError, summaryQuery.isLoading]);

  const sections = EXECUTIVE_DASHBOARD_SECTIONS.map((section) => ({
    ...section,
    allItems: allItems.filter((item) => item.section === section.key),
    enabledItems: enabledItems.filter((item) => item.section === section.key),
    items: cardItems.filter((item) => item.section === section.key),
    panels: panelItems.filter((item) => item.section === section.key),
  }));

  return {
    configQuery,
    summaryQuery,
    allItems,
    enabledItems,
    items: cardItems,
    cardItems,
    panelItems,
    sections,
    managementItems: cardItems.filter((item) => item.section === 'management'),
    doctorPerformanceItems: cardItems.filter((item) => item.section === 'doctor_performance'),
    doctorPerformancePanels: panelItems.filter((item) => item.section === 'doctor_performance'),
    testPerformanceItems: cardItems.filter((item) => item.section === 'test_performance'),
    testPerformancePanels: panelItems.filter((item) => item.section === 'test_performance'),
    incomeAnalysisPanels: panelItems.filter((item) => item.section === 'income_analysis'),
    expenseAnalysisPanels: panelItems.filter((item) => item.section === 'expense_analysis'),
    cashControlItems: cardItems.filter((item) => item.section === 'cash_control'),
    approvalItems: cardItems.filter((item) => item.section === 'approvals'),
    inventoryItems: cardItems.filter((item) => item.section === 'inventory'),
    labReagentItems: cardItems.filter((item) => item.section === 'lab_reagent'),
    labReagentPanels: panelItems.filter((item) => item.section === 'lab_reagent'),
    radiologyStockItems: cardItems.filter((item) => item.section === 'radiology_stock'),
    queries,
  };
}

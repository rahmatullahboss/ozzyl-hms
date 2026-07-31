import type {
  DashboardMetricDefinition,
  DashboardRolePreset,
  DashboardSection,
} from './types';

export type DashboardWorkspace = 'overview' | 'money' | 'doctors' | 'patients' | 'ipd' | 'diagnostics' | 'inventory' | 'audit';

const drill = (route: string, permission: string) => ({
  kind: 'page' as const,
  route,
  query: {},
  permission,
  label: 'View details',
});

const metric = (definition: DashboardMetricDefinition): DashboardMetricDefinition => definition;

export const ADMIN_DASHBOARD_METRICS: DashboardMetricDefinition[] = [
  metric({
    key: 'recognized_income', labelKey: 'adminDashboard.metrics.recognizedIncome', fallbackLabel: 'Recognized income',
    description: 'Posted operating income recognized in the selected posting period.', formula: 'sum of posted income entries excluding patient deposit liabilities',
    valueType: 'money', temporalMode: 'period', dateBasis: 'posting_date', desirableDirection: 'neutral', sourceOfTruth: ['accounting_entries'],
    comparisonMode: 'previous_period', reconciliationRequired: true, defaultRoles: ['hospital_admin', 'md_director', 'accountant'], section: 'financial',
    drillTarget: drill('/reports/accounting', 'billing:report:read'), requiredPermission: 'billing:report:read',
  }),
  metric({
    key: 'total_collection', labelKey: 'adminDashboard.metrics.totalCollection', fallbackLabel: 'Total collection',
    description: 'Eligible receipts collected in the selected payment period.', formula: 'sum of eligible payment receipts by payment date',
    valueType: 'money', temporalMode: 'period', dateBasis: 'payment_date', desirableDirection: 'neutral', sourceOfTruth: ['payments', 'emp_cash_transactions'],
    comparisonMode: 'previous_period', reconciliationRequired: true, defaultRoles: ['hospital_admin', 'md_director', 'accountant'], section: 'primary',
    drillTarget: drill('/cash/daily-collection', 'billing:report:read'), requiredPermission: 'billing:report:read',
  }),
  metric({
    key: 'patient_deposit_liability', labelKey: 'adminDashboard.metrics.patientDepositLiability', fallbackLabel: 'Patient deposit liability',
    description: 'Unused patient advance balance outstanding at period end.', formula: 'deposit receipts minus applied, refunded, or reversed deposit amounts through period end',
    valueType: 'money', temporalMode: 'as_of', dateBasis: 'business_date', desirableDirection: 'neutral', sourceOfTruth: ['deposits', 'deposit_adjustments'],
    comparisonMode: 'previous_period', reconciliationRequired: true, defaultRoles: ['hospital_admin', 'accountant'], section: 'financial',
    drillTarget: drill('/deposits', 'billing:deposit:read'), requiredPermission: 'billing:deposit:read',
  }),
  metric({
    key: 'available_drawer_cash', labelKey: 'adminDashboard.metrics.availableDrawerCash', fallbackLabel: 'Available drawer cash',
    description: 'Physical cash currently held across open and controlled drawer sessions.', formula: 'opening physical cash plus cash in minus cash out and accepted handovers',
    valueType: 'money', temporalMode: 'live', dateBasis: 'current_state', desirableDirection: 'neutral', sourceOfTruth: ['cash_drawer_sessions', 'cash_drawer_movements'],
    comparisonMode: 'none', reconciliationRequired: true, defaultRoles: ['hospital_admin', 'accountant', 'manager_operations'], section: 'live',
    drillTarget: drill('/cash/live', 'billing:cash:read'), requiredPermission: 'billing:cash:read',
  }),
  metric({
    key: 'doctor_payable_outstanding', labelKey: 'adminDashboard.metrics.doctorPayableOutstanding', fallbackLabel: 'Doctor payable outstanding',
    description: 'Doctor compensation earned and payable but not yet settled.', formula: 'payable commission plus immutable adjustments minus settled commission',
    valueType: 'money', temporalMode: 'as_of', dateBasis: 'commission_accrual_date', desirableDirection: 'lower', sourceOfTruth: ['doctor_commission_accruals', 'doctor_commission_settlements'],
    comparisonMode: 'previous_period', reconciliationRequired: true, defaultRoles: ['hospital_admin', 'md_director', 'accountant'], section: 'financial',
    drillTarget: drill('/commissions', 'billing:report:read'), requiredPermission: 'billing:report:read',
  }),
  metric({
    key: 'approved_expense_paid', labelKey: 'adminDashboard.metrics.approvedExpensePaid', fallbackLabel: 'Approved expense paid',
    description: 'Executed approved operating expenses in the selected payment period.', formula: 'sum of executed approved expense payments',
    valueType: 'money', temporalMode: 'period', dateBasis: 'payment_date', desirableDirection: 'lower', sourceOfTruth: ['expenses', 'cash_drawer_movements'],
    comparisonMode: 'previous_period', reconciliationRequired: true, defaultRoles: ['hospital_admin', 'md_director', 'accountant'], section: 'primary',
    drillTarget: drill('/cash/expenses', 'billing:cash:read'), requiredPermission: 'billing:cash:read',
  }),
  metric({
    key: 'operating_result', labelKey: 'adminDashboard.metrics.operatingResult', fallbackLabel: 'Operating result',
    description: 'Recognized operating income less executed operating expense.', formula: 'recognized income minus executed operating expense',
    valueType: 'money', temporalMode: 'period', dateBasis: 'posting_date', desirableDirection: 'higher', sourceOfTruth: ['accounting_entries', 'expenses'],
    comparisonMode: 'previous_period', reconciliationRequired: true, defaultRoles: ['hospital_admin', 'md_director', 'accountant'], section: 'primary',
    drillTarget: drill('/reports/accounting', 'billing:report:read'), requiredPermission: 'billing:report:read',
  }),
  metric({
    key: 'outstanding_due_as_of', labelKey: 'adminDashboard.metrics.outstandingDue', fallbackLabel: 'Outstanding patient due',
    description: 'Patient receivable balance outstanding at the selected period end.', formula: 'eligible net billed amount minus settled payments and approved reversals through period end',
    valueType: 'money', temporalMode: 'as_of', dateBasis: 'bill_date', desirableDirection: 'lower', sourceOfTruth: ['bills', 'payments'],
    comparisonMode: 'previous_period', reconciliationRequired: true, defaultRoles: ['hospital_admin', 'md_director', 'accountant'], section: 'primary',
    drillTarget: drill('/cash/dues', 'billing:aging:read'), requiredPermission: 'billing:aging:read',
  }),
  metric({
    key: 'pending_approvals', labelKey: 'adminDashboard.metrics.pendingApprovals', fallbackLabel: 'Pending approvals',
    description: 'Management decisions waiting in the Action Center.', formula: 'count of open approval decisions across supported action sources',
    valueType: 'count', temporalMode: 'live', dateBasis: 'current_state', desirableDirection: 'lower', sourceOfTruth: ['approval_requests', 'action_center'],
    comparisonMode: 'none', reconciliationRequired: false, defaultRoles: ['hospital_admin', 'md_director', 'manager_operations'], section: 'primary',
    drillTarget: drill('/action/approvals', 'billing:report:read'), requiredPermission: 'billing:report:read',
  }),
  metric({
    key: 'critical_inventory_exceptions', labelKey: 'adminDashboard.metrics.criticalInventoryExceptions', fallbackLabel: 'Critical inventory exceptions',
    description: 'Current out-of-stock, expired, and critical stock exceptions.', formula: 'count of current critical inventory exception records',
    valueType: 'count', temporalMode: 'live', dateBasis: 'current_state', desirableDirection: 'zero', sourceOfTruth: ['inventory_items', 'inventory_batches'],
    comparisonMode: 'none', reconciliationRequired: false, defaultRoles: ['hospital_admin', 'manager_operations'], section: 'primary',
    drillTarget: drill('/inventory', 'pharmacy:read'), requiredPermission: 'pharmacy:read',
  }),
];

export interface DashboardRolePresetDefinition {
  primaryMetricKeys: string[];
  defaultWorkspace: DashboardWorkspace;
}

export const ADMIN_DASHBOARD_ROLE_PRESETS: Record<DashboardRolePreset, DashboardRolePresetDefinition> = {
  hospital_admin: {
    primaryMetricKeys: ['total_collection', 'approved_expense_paid', 'operating_result', 'outstanding_due_as_of', 'doctor_payable_outstanding', 'available_drawer_cash', 'pending_approvals', 'critical_inventory_exceptions'],
    defaultWorkspace: 'overview',
  },
  md_director: {
    primaryMetricKeys: ['total_collection', 'operating_result', 'outstanding_due_as_of', 'doctor_payable_outstanding', 'pending_approvals'],
    defaultWorkspace: 'overview',
  },
  accountant: {
    primaryMetricKeys: ['recognized_income', 'total_collection', 'approved_expense_paid', 'operating_result', 'outstanding_due_as_of', 'patient_deposit_liability', 'doctor_payable_outstanding', 'available_drawer_cash'],
    defaultWorkspace: 'money',
  },
  manager_operations: {
    primaryMetricKeys: ['pending_approvals', 'critical_inventory_exceptions', 'available_drawer_cash'],
    defaultWorkspace: 'overview',
  },
};

const LEGACY_WORKSPACE_BY_METRIC: Record<string, DashboardWorkspace> = {
  accounting_income: 'money', accounting_expenses: 'money', accounting_profit: 'money', opd_income: 'money', ipd_collection: 'ipd', ot_income: 'money',
  pharmacy_income: 'money', deposit_collection: 'money', cash_received: 'money', cash_movement: 'money', drawer_cash: 'money',
  lab_income: 'diagnostics', radiology_income: 'diagnostics', lab_tests_completed: 'diagnostics', lab_reagent_consumed: 'diagnostics',
  lab_reagent_stock_skus: 'diagnostics', lab_reagent_low_stock: 'diagnostics', lab_reagent_out_of_stock: 'diagnostics',
  lab_reagent_expiring_soon: 'diagnostics', lab_reagent_qc_issues: 'diagnostics', unmapped_lab_tests: 'diagnostics', consumption_exceptions: 'diagnostics',
  visit_commission: 'doctors', test_commission: 'doctors', total_commission: 'doctors', other_doctor_commission: 'doctors', total_visits: 'doctors',
  inventory_stock_skus: 'inventory', inventory_low_stock: 'inventory', inventory_out_of_stock: 'inventory', inventory_expiring_soon: 'inventory',
  inventory_expired: 'inventory', inventory_pending_purchase: 'inventory', radiology_stock_skus: 'inventory', radiology_low_stock: 'inventory',
  radiology_out_of_stock: 'inventory', radiology_expiring_soon: 'inventory', radiology_issue_lines: 'inventory',
  uncategorized_income: 'audit',
};

export function dashboardWorkspaceForMetric(metricKey: string): DashboardWorkspace {
  const registered = ADMIN_DASHBOARD_METRICS.find((item) => item.key === metricKey);
  if (registered) {
    const section = registered.section as DashboardSection;
    if (section === 'financial' || section === 'money') return 'money';
    if (section === 'doctors' || section === 'patients' || section === 'ipd' || section === 'diagnostics' || section === 'inventory' || section === 'audit') return section;
    return 'overview';
  }
  return LEGACY_WORKSPACE_BY_METRIC[metricKey] ?? 'audit';
}

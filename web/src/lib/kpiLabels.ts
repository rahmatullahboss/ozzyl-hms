export type KpiValueType = 'money' | 'count';

const SOURCE_LABELS: Record<string, string> = {
  'mdDashboard.kpi.cashMovementSourceBill': 'Same-day bill payments',
  'mdDashboard.kpi.cashMovementSourceVisit': 'Doctor visit collection',
  'mdDashboard.kpi.cashMovementSourceTest': 'Test collection',
  'mdDashboard.kpi.cashMovementSourceRadiology': 'Radiology / imaging collection',
  'mdDashboard.kpi.cashMovementSourceAdmission': 'Admission/IPD collection',
  'mdDashboard.kpi.cashMovementSourceOperation': 'OT/procedure collection',
  'mdDashboard.kpi.cashMovementSourceMedicine': 'Medicine collection',
  'mdDashboard.kpi.cashMovementSourceOtherService': 'Other service collection',
  'mdDashboard.kpi.cashMovementSourceDueCollection': 'Due collections',
  'mdDashboard.kpi.cashMovementSourceDeposit': 'Patient deposits',
  'mdDashboard.kpi.cashMovementSourceRefund': 'Refunds / returns',
  'mdDashboard.kpi.cashMovementSourceExpense': 'Operating expenses',
  'mdDashboard.kpi.cashMovementSourcePayout': 'Doctor payouts',
  billing_collection: 'Billing collection',
  due_collection: 'Due collection',
  deposit_collection: 'Deposit received',
  visit_commission: 'Visit commission accrual',
  test_commission: 'Test commission accrual',
  other_doctor_commission: 'Other doctor commission accrual',
  total_commission: 'Total doctor commission',
  lab_tests_completed: 'Completed laboratory tests',
  unmapped_lab_tests: 'Unmapped completed lab tests',
  consumption_exceptions: 'Reagent consumption exceptions',
  drawer_cash: 'Available drawer cash',
  'manual discount': 'Manual discount',
  partial: 'Partially paid bills',
  unpaid: 'Unpaid bills',
  paid: 'Paid bills',
};

const METRIC_FORMULAS: Record<string, string> = {
  accounting_income: 'Billing and due collections plus patient deposits received for the selected period.',
  accounting_expenses: 'Paid operating expenses plus doctor payouts for the selected period.',
  accounting_profit: 'Total Collection minus Total Expense for the selected period.',
  visit_commission: 'Commission accruals whose source type is a doctor visit for the selected period.',
  test_commission: 'Commission accruals whose source type is a laboratory or diagnostic test for the selected period.',
  other_doctor_commission: 'Doctor commission accruals not classified as visit or test for the selected period.',
  total_commission: 'Visit Commission plus Test Commission plus Other Doctor Commission for the selected period.',
  total_visits: 'Completed or billable doctor visits in the selected period; disabled by default because the doctor table provides the fuller view.',
  lab_tests_completed: 'Laboratory order items completed in the selected period, independent of whether their bill is fully paid.',
  income_service_breakdown: 'Collected amount allocated to exact billed service lines using the same proportional payment allocation as Total Collection.',
  expense_source_breakdown: 'Paid operating expenses plus executed doctor payouts; approved-but-unpaid and rejected rows are excluded.',
  reagent_reconciliation_table: 'Expected reagent usage from completed-test mappings compared with actual issue movements minus returns, kept separate by unit.',
  unmapped_lab_tests: 'Completed tests that have no active reagent-consumption mapping.',
  consumption_exceptions: 'Mapped reagents with missing or materially different actual consumption versus expected usage.',
  patient_due: 'Current outstanding due from active bills.',
  patient_advance: 'Patient deposit and advance balances not yet adjusted against bills.',
  pending_handover: 'Counter cash handovers waiting to be received or verified.',
  total_discount: 'Discount applied on active bills for the selected period.',
  pending_posting: 'Accounting events not finalized in the ledger yet.',
  doctor_payout: 'Doctor payout cash movements for the selected date.',
  cash_received: 'Billing collection plus due collection plus patient deposits for the selected date.',
  billing_collection: 'Same-day bill payments received on the selected date.',
  due_collection: 'Old bill dues collected on the selected date.',
  deposit_collection: 'Patient deposit and advance cash received on the selected date.',
  drawer_cash: 'Expected cash currently available in active counters and drawers.',
  cash_movement: 'Physical drawer cash movement for the selected date.',
};

const METRIC_EMPTY_STATES: Record<string, string> = {
  accounting_income: 'No posted income rows found for this period.',
  accounting_expenses: 'No paid operating expense or executed doctor payout rows found for this period.',
  patient_due: 'No active patient due rows found.',
  total_discount: 'No discount rows found for this period.',
  doctor_payout: 'No doctor payout rows found for this date.',
  cash_movement: 'No drawer cash movement found for this date.',
};

export function displayKpiSourceLabel(label: string | null | undefined): string {
  const raw = String(label ?? '').trim();
  if (!raw) return 'Other';
  return SOURCE_LABELS[raw] ?? raw.replace(/^mdDashboard\.kpi\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

export function kpiFormulaNote(metric: string | null | undefined): string {
  return METRIC_FORMULAS[String(metric ?? '')] ?? 'Source rows for the selected KPI and period.';
}

export function kpiEmptyState(metric: string | null | undefined, fallback: string): string {
  return METRIC_EMPTY_STATES[String(metric ?? '')] ?? fallback;
}

export function safeT(t: (key: string, options?: Record<string, unknown>) => string, key: string, defaultValue: string): string {
  const translated = t(key, { defaultValue });
  return translated === key ? defaultValue : translated;
}

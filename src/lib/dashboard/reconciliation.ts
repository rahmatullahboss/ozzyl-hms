import type {
  FinancialReconciliationEnvelope,
  ReconciliationResult,
} from '../../../packages/shared/src/dashboard';

export interface BuildDashboardReconciliationInput {
  summaryTotal: number;
  detailTotal: number | null;
  detailRowCount: number;
  currentPageRowCount?: number;
  tolerance?: number;
  checkedAt?: string;
  providerMode?: ReconciliationResult['providerMode'];
}

export interface BuildFinancialReconciliationInput extends BuildDashboardReconciliationInput {
  detailGrain: string;
  unavailableReason?: string;
  warnings?: string[];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildDashboardReconciliation(
  input: BuildDashboardReconciliationInput,
): ReconciliationResult {
  const tolerance = Math.max(0, input.tolerance ?? 0.01);
  if (input.detailTotal === null || !Number.isFinite(input.detailTotal)) {
    return {
      summaryTotal: roundMoney(input.summaryTotal),
      detailTotal: null,
      unexplainedDifference: null,
      tolerance,
      isBalanced: null,
      detailRowCount: Math.max(0, Math.trunc(input.detailRowCount)),
      providerMode: input.providerMode,
      checkedAt: input.checkedAt ?? new Date().toISOString(),
    };
  }

  const summaryTotal = roundMoney(input.summaryTotal);
  const detailTotal = roundMoney(input.detailTotal);
  const rawDifference = summaryTotal - detailTotal;
  const isBalanced = Math.abs(rawDifference) < tolerance;

  return {
    summaryTotal,
    detailTotal,
    unexplainedDifference: isBalanced ? 0 : roundMoney(rawDifference),
    tolerance,
    isBalanced,
    detailRowCount: Math.max(0, Math.trunc(input.detailRowCount)),
    providerMode: input.providerMode,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  };
}

export function reconciliationNeedsWarning(
  reconciliation: Pick<FinancialReconciliationEnvelope, 'status' | 'unexplainedDifference'>,
): boolean {
  const difference = reconciliation.unexplainedDifference;
  return reconciliation.status !== 'reconciled'
    || (difference !== null && Number.isFinite(difference) && difference !== 0);
}

export function buildFinancialReconciliation(
  input: BuildFinancialReconciliationInput,
): FinancialReconciliationEnvelope {
  const base = buildDashboardReconciliation(input);
  const warnings = [...(input.warnings ?? [])];
  let status: FinancialReconciliationEnvelope['status'];

  if (base.detailTotal === null || base.isBalanced === null) {
    status = 'unavailable';
    warnings.push(input.unavailableReason ?? 'Full-detail reconciliation is unavailable.');
  } else if (base.isBalanced) {
    status = 'reconciled';
  } else {
    status = 'warning';
    warnings.push(`Summary and detail totals differ by BDT ${Math.abs(base.unexplainedDifference ?? 0).toFixed(2)}.`);
  }

  return {
    ...base,
    detailGrain: input.detailGrain,
    status,
    warnings,
  };
}

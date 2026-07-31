export const COMMISSION_REASON_CODES = [
  'rule_matched',
  'no_matching_rule',
  'doctor_missing',
  'bill_unpaid',
  'cancelled',
  'refunded',
  'eligible_base_zero',
  'doctor_waived',
  'manual_adjustment',
  'reversal',
  'held_for_review',
] as const;

export type CommissionReasonCode = (typeof COMMISSION_REASON_CODES)[number];

const COMMISSION_REASON_LABELS: Record<CommissionReasonCode, string> = {
  rule_matched: 'Rule matched',
  no_matching_rule: 'No matching commission rule',
  doctor_missing: 'Doctor not recorded',
  bill_unpaid: 'Bill not paid',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  eligible_base_zero: 'Eligible base is zero',
  doctor_waived: 'Doctor waived commission',
  manual_adjustment: 'Manual adjustment',
  reversal: 'Reversal',
  held_for_review: 'Held for review',
};

const COMMISSION_REASON_CODE_SET = new Set<string>(COMMISSION_REASON_CODES);

export function normalizeCommissionReasonCode(value: unknown): CommissionReasonCode {
  const normalized = String(value ?? '').trim().toLowerCase();
  return COMMISSION_REASON_CODE_SET.has(normalized)
    ? normalized as CommissionReasonCode
    : 'held_for_review';
}

export function commissionReasonLabel(code: CommissionReasonCode): string {
  return COMMISSION_REASON_LABELS[code];
}

export interface ResolveCommissionReasonInput {
  storedReasonCode?: unknown;
  ruleId?: unknown;
  status?: unknown;
  eligibleBaseAmount?: unknown;
  waiverAmount?: unknown;
  adjustmentAmount?: unknown;
  payableAmount?: unknown;
}

function finiteAmount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasRuleIdentity(value: unknown): boolean {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  return String(value ?? '').trim().length > 0;
}

export function resolveCommissionReasonCode(
  input: ResolveCommissionReasonInput,
): CommissionReasonCode {
  const storedReason = String(input.storedReasonCode ?? '').trim().toLowerCase();
  if (storedReason) return normalizeCommissionReasonCode(storedReason);

  const status = String(input.status ?? '').trim().toLowerCase();
  if (status === 'cancelled') return 'cancelled';
  if (status === 'reversed' || status === 'reversal') return 'reversal';
  if (status === 'refunded' || status === 'refund') return 'refunded';
  if (status === 'unpaid' || status === 'payment_failed' || status === 'payment_pending') {
    return 'bill_unpaid';
  }

  if (finiteAmount(input.eligibleBaseAmount) <= 0) return 'eligible_base_zero';
  if (finiteAmount(input.waiverAmount) > 0) return 'doctor_waived';
  if (finiteAmount(input.adjustmentAmount) !== 0) return 'manual_adjustment';
  if (!hasRuleIdentity(input.ruleId)) return 'no_matching_rule';
  if (finiteAmount(input.payableAmount) >= 0) return 'rule_matched';
  return 'held_for_review';
}

export interface CommissionBridgeInput {
  grossAmount: number;
  discountAmount: number;
  performerReserveAmount: number;
  eligibleBaseAmount: number;
  earnedAmount: number;
  waiverAmount: number;
  adjustmentAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  tolerance?: number;
}

export interface CommissionBridgeValidation {
  status: 'valid' | 'warning';
  differences: {
    eligibleBase: number;
    payable: number;
    outstanding: number;
  };
  warnings: string[];
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function visibleDifference(expected: number, actual: number, tolerance: number): number {
  const difference = roundMoney(expected - actual);
  return Math.abs(difference) < tolerance ? 0 : difference;
}

function differenceWarning(message: string, difference: number): string {
  return `${message} by BDT ${Math.abs(difference).toFixed(2)}.`;
}

export function validateCommissionBridge(input: CommissionBridgeInput): CommissionBridgeValidation {
  const tolerance = Math.max(0, Number(input.tolerance ?? 0.01));
  const eligibleBaseDifference = visibleDifference(
    roundMoney(input.grossAmount - input.discountAmount - input.performerReserveAmount),
    roundMoney(input.eligibleBaseAmount),
    tolerance,
  );
  const payableDifference = visibleDifference(
    roundMoney(input.earnedAmount - input.waiverAmount + input.adjustmentAmount),
    roundMoney(input.payableAmount),
    tolerance,
  );
  const outstandingDifference = visibleDifference(
    roundMoney(input.payableAmount - input.paidAmount),
    roundMoney(input.outstandingAmount),
    tolerance,
  );

  const warnings: string[] = [];
  if (eligibleBaseDifference !== 0) {
    warnings.push(differenceWarning(
      'Gross less discount and performer reserve differs from eligible base',
      eligibleBaseDifference,
    ));
  }
  if (payableDifference !== 0) {
    warnings.push(differenceWarning(
      'Earned less waiver plus adjustment differs from payable',
      payableDifference,
    ));
  }
  if (outstandingDifference !== 0) {
    warnings.push(differenceWarning(
      'Payable less paid differs from outstanding',
      outstandingDifference,
    ));
  }

  return {
    status: warnings.length === 0 ? 'valid' : 'warning',
    differences: {
      eligibleBase: eligibleBaseDifference,
      payable: payableDifference,
      outstanding: outstandingDifference,
    },
    warnings,
  };
}

export interface HistoricalRuleSnapshotInput {
  ruleId: number | null | undefined;
  ruleVersion: number | null | undefined;
}

export interface HistoricalRuleSnapshot {
  ruleId: number | null;
  ruleVersion: number | null;
  warnings: string[];
}

function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveHistoricalRuleSnapshot(input: HistoricalRuleSnapshotInput): HistoricalRuleSnapshot {
  const ruleId = positiveIntegerOrNull(input.ruleId);
  if (ruleId === null) {
    return {
      ruleId: null,
      ruleVersion: null,
      warnings: ['Historical commission rule not recorded.'],
    };
  }

  const ruleVersion = positiveIntegerOrNull(input.ruleVersion);
  return {
    ruleId,
    ruleVersion,
    warnings: ruleVersion === null ? ['Historical rule version not recorded.'] : [],
  };
}

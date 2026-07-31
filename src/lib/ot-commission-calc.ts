/**
 * OT Commission Calculation Service
 *
 * Pure deterministic calculation — no LLM, no side effects.
 * Blueprint §21: Surgeon & Anesthetist Commission.
 *
 * Usage:
 *   const entries = calculateCommissions(billItems, rules, bookingId, billId, userId);
 *   // entries is an array of ot_commissions rows ready to INSERT
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BillItemForCommission {
  id: number;
  charge_head: string;
  doctor_id: number | null;
  total: number;
  is_commissionable: number;
}

export interface CommissionRule {
  id: number;
  role: string;
  rule_type: string;
  amount: number;
  percent: number;
  procedure_id: number | null;
  department_id: number | null;
  doctor_id: number | null;
  include_emergency_surcharge: number;
  priority: number;
}

export interface CommissionEntry {
  booking_id: number;
  ot_bill_id: number;
  doctor_id: number;
  role: string;
  gross_amount: number;
  commission_rule: string;
  commission_percent: number;
  commission_amount: number;
  deduction: number;
  net_payable: number;
  created_by: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHARGE_HEAD_TO_ROLE: Record<string, string> = {
  surgeon_fee: 'chief_surgeon',
  assistant_surgeon_fee: 'assistant_surgeon',
  anesthesia: 'anesthetist',
  anesthetist_fee: 'anesthetist',
  ot_nurse_service: 'circulating_nurse',
};

// ─── Pure Functions ──────────────────────────────────────────────────────────

/**
 * Find the best matching commission rule for a given role and bill item.
 * Rules are sorted by priority DESC; first match wins.
 * Matching criteria: role must match, then optional doctor_id filter.
 */
export function findMatchingRule(
  rules: CommissionRule[],
  role: string,
  doctorId?: number,
): CommissionRule | null {
  // Filter to rules for this role, then prefer doctor-specific rules
  const candidates = rules
    .filter(r => r.role === role)
    .sort((a, b) => b.priority - a.priority);

  // First try: doctor-specific rule
  if (doctorId) {
    const doctorRule = candidates.find(r => r.doctor_id === doctorId);
    if (doctorRule) return doctorRule;
  }

  // Second try: generic rule (no doctor_id filter)
  return candidates.find(r => !r.doctor_id) ?? candidates[0] ?? null;
}

/**
 * Calculate commission amount from a rule and a gross amount.
 * Returns { amount, percent, ruleDescription }.
 */
export function applyCommissionRule(
  rule: CommissionRule,
  grossAmount: number,
): { amount: number; percent: number; description: string } {
  switch (rule.rule_type) {
    case 'fixed_amount':
      return {
        amount: rule.amount,
        percent: 0,
        description: `Fixed ${rule.amount}`,
      };
    case 'percentage_of_surgery':
    case 'percentage_after_discount':
    case 'package_based':
    case 'department_based':
    case 'doctor_based': {
      const amount = Math.round((grossAmount * rule.percent) / 100 * 100) / 100;
      return {
        amount,
        percent: rule.percent,
        description: `${rule.percent}% of ${grossAmount}`,
      };
    }
    default:
      return { amount: 0, percent: 0, description: 'No matching rule' };
  }
}

/**
 * Calculate commissions for all commissionable bill items.
 * Returns an array of CommissionEntry ready to INSERT into ot_commissions.
 */
export function calculateCommissions(
  billItems: BillItemForCommission[],
  rules: CommissionRule[],
  bookingId: number,
  billId: number,
  userId: number,
): CommissionEntry[] {
  const entries: CommissionEntry[] = [];

  for (const item of billItems) {
    if (!item.is_commissionable || !item.doctor_id) continue;

    const role = CHARGE_HEAD_TO_ROLE[item.charge_head];
    if (!role) continue;

    const rule = findMatchingRule(rules, role, item.doctor_id);
    if (!rule) continue;

    const { amount, percent, description } = applyCommissionRule(rule, item.total);
    if (amount <= 0) continue;

    entries.push({
      booking_id: bookingId,
      ot_bill_id: billId,
      doctor_id: item.doctor_id,
      role,
      gross_amount: item.total,
      commission_rule: description,
      commission_percent: percent,
      commission_amount: amount,
      deduction: 0,
      net_payable: amount,
      created_by: userId,
    });
  }

  return entries;
}

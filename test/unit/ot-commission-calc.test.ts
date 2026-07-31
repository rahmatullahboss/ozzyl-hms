import { describe, expect, it } from 'vitest';
import {
  findMatchingRule,
  applyCommissionRule,
  calculateCommissions,
  type BillItemForCommission,
  type CommissionRule,
} from '../../src/lib/ot-commission-calc';

const RULES: CommissionRule[] = [
  { id: 1, role: 'chief_surgeon', rule_type: 'percentage_of_surgery',
    amount: 0, percent: 15, procedure_id: null, department_id: null,
    doctor_id: null, include_emergency_surcharge: 0, priority: 10 },
  { id: 2, role: 'chief_surgeon', rule_type: 'fixed_amount',
    amount: 5000, percent: 0, procedure_id: null, department_id: null,
    doctor_id: 5, include_emergency_surcharge: 0, priority: 20 },
  { id: 3, role: 'anesthetist', rule_type: 'fixed_amount',
    amount: 3000, percent: 0, procedure_id: null, department_id: null,
    doctor_id: null, include_emergency_surcharge: 0, priority: 10 },
  { id: 4, role: 'assistant_surgeon', rule_type: 'percentage_of_surgery',
    amount: 0, percent: 10, procedure_id: null, department_id: null,
    doctor_id: null, include_emergency_surcharge: 0, priority: 5 },
];

const ITEMS: BillItemForCommission[] = [
  { id: 1, charge_head: 'surgery', doctor_id: null, total: 20000, is_commissionable: 1 },
  { id: 2, charge_head: 'surgeon_fee', doctor_id: 1, total: 20000, is_commissionable: 1 },
  { id: 3, charge_head: 'anesthesia', doctor_id: 3, total: 7000, is_commissionable: 1 },
  { id: 4, charge_head: 'assistant_surgeon_fee', doctor_id: 4, total: 5000, is_commissionable: 1 },
  { id: 5, charge_head: 'ot_room', doctor_id: null, total: 8000, is_commissionable: 0 },
  { id: 6, charge_head: 'consumables', doctor_id: null, total: 3000, is_commissionable: 0 },
  { id: 7, charge_head: 'surgeon_fee', doctor_id: 5, total: 20000, is_commissionable: 1 },
];

describe('findMatchingRule', () => {
  it('returns the highest priority generic rule when no doctorId', () => {
    const rule = findMatchingRule(RULES, 'chief_surgeon');
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe(1); // generic rule (no doctor_id), priority 10
  });

  it('returns null when no rule matches', () => {
    const rule = findMatchingRule(RULES, 'scrub_nurse');
    expect(rule).toBeNull();
  });

  it('returns null for empty rules', () => {
    expect(findMatchingRule([], 'chief_surgeon')).toBeNull();
  });
});

describe('applyCommissionRule', () => {
  it('calculates fixed_amount', () => {
    const rule = RULES[2]; // anesthetist, fixed 3000
    const result = applyCommissionRule(rule, 7000);
    expect(result.amount).toBe(3000);
    expect(result.percent).toBe(0);
    expect(result.description).toContain('Fixed');
  });

  it('calculates percentage_of_surgery', () => {
    const rule = RULES[0]; // chief_surgeon, 15%
    const result = applyCommissionRule(rule, 20000);
    expect(result.amount).toBe(3000);
    expect(result.percent).toBe(15);
    expect(result.description).toContain('15%');
  });

  it('rounds to 2 decimal places', () => {
    const rule: CommissionRule = { ...RULES[0], percent: 12.5 };
    const result = applyCommissionRule(rule, 33333);
    expect(result.amount).toBe(4166.63);
  });

  it('returns 0 for unknown rule_type', () => {
    const rule: CommissionRule = { ...RULES[0], rule_type: 'unknown' };
    const result = applyCommissionRule(rule, 10000);
    expect(result.amount).toBe(0);
  });
});

describe('calculateCommissions', () => {
  it('creates entries for all commissionable items with matching rules', () => {
    const entries = calculateCommissions(ITEMS, RULES, 50, 1, 1);
    // surgeon_fee (doctor 1) → chief_surgeon rule 1 (15%) = 3000
    // anesthesia (doctor 3) → anesthetist rule 3 (fixed 3000)
    // assistant_surgeon_fee (doctor 4) → assistant_surgeon rule 4 (10%) = 500
    // surgeon_fee (doctor 5) → chief_surgeon rule 2 (fixed 5000, priority 20)
    expect(entries.length).toBe(4);
    expect(entries[0].commission_amount).toBe(3000); // 15% of 20000
    expect(entries[1].commission_amount).toBe(3000); // fixed
    expect(entries[2].commission_amount).toBe(500);  // 10% of 5000
    expect(entries[3].commission_amount).toBe(5000); // fixed, higher priority
  });

  it('skips non-commissionable items', () => {
    const small: BillItemForCommission[] = [
      { id: 5, charge_head: 'ot_room', doctor_id: null, total: 8000, is_commissionable: 0 },
    ];
    expect(calculateCommissions(small, RULES, 50, 1, 1).length).toBe(0);
  });

  it('skips items without doctor_id', () => {
    const small: BillItemForCommission[] = [
      { id: 1, charge_head: 'surgery', doctor_id: null, total: 20000, is_commissionable: 1 },
    ];
    expect(calculateCommissions(small, RULES, 50, 1, 1).length).toBe(0);
  });

  it('skips items with unmapped charge_head', () => {
    const small: BillItemForCommission[] = [
      { id: 1, charge_head: 'medicines', doctor_id: 1, total: 5000, is_commissionable: 1 },
    ];
    expect(calculateCommissions(small, RULES, 50, 1, 1).length).toBe(0);
  });

  it('skips items with no matching rule', () => {
    const small: BillItemForCommission[] = [
      { id: 1, charge_head: 'surgeon_fee', doctor_id: 1, total: 20000, is_commissionable: 1 },
    ];
    // Only anesthetist rules, no chief_surgeon
    const anesthetistOnly = RULES.filter(r => r.role === 'anesthetist');
    expect(calculateCommissions(small, anesthetistOnly, 50, 1, 1).length).toBe(0);
  });

  it('populates all required fields on the entry', () => {
    const entries = calculateCommissions(
      [{ id: 2, charge_head: 'surgeon_fee', doctor_id: 1, total: 20000, is_commissionable: 1 }],
      RULES, 50, 1, 99,
    );
    expect(entries.length).toBe(1);
    const e = entries[0];
    expect(e.booking_id).toBe(50);
    expect(e.ot_bill_id).toBe(1);
    expect(e.doctor_id).toBe(1);
    expect(e.role).toBe('chief_surgeon');
    expect(e.gross_amount).toBe(20000);
    expect(e.commission_rule).toBeDefined();
    expect(e.net_payable).toBe(e.commission_amount);
    expect(e.created_by).toBe(99);
  });

  it('returns empty for empty items', () => {
    expect(calculateCommissions([], RULES, 50, 1, 1).length).toBe(0);
  });

  it('returns empty for empty rules', () => {
    expect(calculateCommissions(ITEMS, [], 50, 1, 1).length).toBe(0);
  });
});

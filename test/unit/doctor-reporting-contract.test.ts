import { describe, expect, it } from 'vitest';
import {
  commissionReasonLabel,
  normalizeCommissionReasonCode,
  resolveCommissionReasonCode,
  resolveHistoricalRuleSnapshot,
  validateCommissionBridge,
} from '../../src/services/dashboard/doctorReportingContract';

describe('doctor reporting explanation contract', () => {
  it('maps every supported reason code to an administrator-readable label', () => {
    expect(commissionReasonLabel('rule_matched')).toBe('Rule matched');
    expect(commissionReasonLabel('no_matching_rule')).toBe('No matching commission rule');
    expect(commissionReasonLabel('doctor_missing')).toBe('Doctor not recorded');
    expect(commissionReasonLabel('bill_unpaid')).toBe('Bill not paid');
    expect(commissionReasonLabel('cancelled')).toBe('Cancelled');
    expect(commissionReasonLabel('refunded')).toBe('Refunded');
    expect(commissionReasonLabel('eligible_base_zero')).toBe('Eligible base is zero');
    expect(commissionReasonLabel('doctor_waived')).toBe('Doctor waived commission');
    expect(commissionReasonLabel('manual_adjustment')).toBe('Manual adjustment');
    expect(commissionReasonLabel('reversal')).toBe('Reversal');
    expect(commissionReasonLabel('held_for_review')).toBe('Held for review');
  });

  it('maps unknown or unsafe internal statuses to held_for_review', () => {
    expect(normalizeCommissionReasonCode('rule_matched')).toBe('rule_matched');
    expect(normalizeCommissionReasonCode('PAID_OK')).toBe('held_for_review');
    expect(normalizeCommissionReasonCode('')).toBe('held_for_review');
    expect(normalizeCommissionReasonCode(null)).toBe('held_for_review');
  });

  it('never labels a zero-payable row as rule matched when no rule identity exists', () => {
    expect(resolveCommissionReasonCode({
      storedReasonCode: null,
      ruleId: null,
      status: 'accrued',
      eligibleBaseAmount: 0,
      waiverAmount: 0,
      adjustmentAmount: 0,
      payableAmount: 0,
    })).toBe('eligible_base_zero');
    expect(resolveCommissionReasonCode({
      storedReasonCode: null,
      ruleId: null,
      status: 'accrued',
      eligibleBaseAmount: 500,
      waiverAmount: 0,
      adjustmentAmount: 0,
      payableAmount: 0,
    })).toBe('no_matching_rule');
  });

  it('resolves cancelled, reversed, unpaid, waived, and adjusted states from structured facts', () => {
    const base = {
      storedReasonCode: null,
      ruleId: 9,
      eligibleBaseAmount: 500,
      waiverAmount: 0,
      adjustmentAmount: 0,
      payableAmount: 100,
    };
    expect(resolveCommissionReasonCode({ ...base, status: 'cancelled' })).toBe('cancelled');
    expect(resolveCommissionReasonCode({ ...base, status: 'reversed' })).toBe('reversal');
    expect(resolveCommissionReasonCode({ ...base, status: 'unpaid' })).toBe('bill_unpaid');
    expect(resolveCommissionReasonCode({ ...base, status: 'accrued', waiverAmount: 50 })).toBe('doctor_waived');
    expect(resolveCommissionReasonCode({ ...base, status: 'accrued', adjustmentAmount: -20 })).toBe('manual_adjustment');
  });

  it('validates the full commission bridge within currency tolerance', () => {
    expect(validateCommissionBridge({
      grossAmount: 1_000,
      discountAmount: 100,
      performerReserveAmount: 200,
      eligibleBaseAmount: 700,
      earnedAmount: 175,
      waiverAmount: 25,
      adjustmentAmount: 10,
      payableAmount: 160,
      paidAmount: 60,
      outstandingAmount: 100,
    })).toEqual({
      status: 'valid',
      differences: {
        eligibleBase: 0,
        payable: 0,
        outstanding: 0,
      },
      warnings: [],
    });
  });

  it('reports every broken bridge equation without hiding the differences', () => {
    expect(validateCommissionBridge({
      grossAmount: 1_000,
      discountAmount: 100,
      performerReserveAmount: 200,
      eligibleBaseAmount: 690,
      earnedAmount: 175,
      waiverAmount: 25,
      adjustmentAmount: 10,
      payableAmount: 150,
      paidAmount: 60,
      outstandingAmount: 80,
    })).toEqual({
      status: 'warning',
      differences: {
        eligibleBase: 10,
        payable: 10,
        outstanding: 10,
      },
      warnings: [
        'Gross less discount and performer reserve differs from eligible base by BDT 10.00.',
        'Earned less waiver plus adjustment differs from payable by BDT 10.00.',
        'Payable less paid differs from outstanding by BDT 10.00.',
      ],
    });
  });

  it('keeps a missing historical rule version null and explains the limitation', () => {
    expect(resolveHistoricalRuleSnapshot({ ruleId: 42, ruleVersion: null })).toEqual({
      ruleId: 42,
      ruleVersion: null,
      warnings: ['Historical rule version not recorded.'],
    });
  });

  it('does not invent a rule identity when none was stored', () => {
    expect(resolveHistoricalRuleSnapshot({ ruleId: null, ruleVersion: 7 })).toEqual({
      ruleId: null,
      ruleVersion: null,
      warnings: ['Historical commission rule not recorded.'],
    });
  });
});

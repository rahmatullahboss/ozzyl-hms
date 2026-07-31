import { describe, expect, it } from 'vitest';
import {
  allocateProportionalMoney,
  calculateDiagnosticLinePayoutSplit,
  calculateUnitPerformerReserve,
  normalizePerformerRule,
  splitMoneyAcrossUnits,
} from '../../src/lib/diagnostic-performer-payout';

describe('diagnostic performer payout calculations', () => {
  it('splits a flat BDT 200 performer reserve before referral commission', () => {
    const result = calculateDiagnosticLinePayoutSplit({
      serviceAmountExcludingTax: 1000,
      discountAmount: 0,
      quantity: 1,
      rule: { rateType: 'flat', rateValue: 200 },
    });

    expect(result.performerReserveAmount).toBe(200);
    expect(result.commissionBaseAmount).toBe(800);
    expect(result.units).toEqual([
      {
        unitSequence: 1,
        unitServiceAmount: 1000,
        unitDiscountAmount: 0,
        netUnitServiceAmount: 1000,
        reservedAmount: 200,
      },
    ]);
  });

  it('normalizes 15 percent to 1500 basis points', () => {
    expect(normalizePerformerRule({ rateType: 'percent', percent: 15 }))
      .toEqual({ rateType: 'percent', rateValue: 1500 });
  });

  it('retains a flat amount without percentage conversion', () => {
    expect(normalizePerformerRule({ rateType: 'flat', flatAmount: 200 }))
      .toEqual({ rateType: 'flat', rateValue: 200 });
  });

  it('calculates percentage reserve from net service amount after discount', () => {
    const result = calculateDiagnosticLinePayoutSplit({
      serviceAmountExcludingTax: 1000,
      discountAmount: 100,
      quantity: 1,
      rule: { rateType: 'percent', rateValue: 1500 },
    });

    expect(result.netServiceAmount).toBe(900);
    expect(result.performerReserveAmount).toBe(135);
    expect(result.commissionBaseAmount).toBe(765);
  });

  it('pays the full flat reserve even when it exceeds the discounted unit amount', () => {
    expect(calculateUnitPerformerReserve({
      netUnitServiceAmount: 120,
      rule: { rateType: 'flat', rateValue: 200 },
    })).toBe(200);
  });

  it('preserves cents exactly across three units', () => {
    const units = splitMoneyAcrossUnits(1000, 3);
    expect(units).toEqual([333.34, 333.33, 333.33]);
    expect(units.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1000, 2);
  });

  it('allocates proportional money with deterministic largest remainder', () => {
    expect(allocateProportionalMoney(10, [1, 1, 1])).toEqual([3.34, 3.33, 3.33]);
    expect(allocateProportionalMoney(10, [2, 1])).toEqual([6.67, 3.33]);
  });

  it('keeps a flat reserve payable after full discount and never creates a negative commission base', () => {
    const result = calculateDiagnosticLinePayoutSplit({
      serviceAmountExcludingTax: 100,
      discountAmount: 150,
      quantity: 2,
      rule: { rateType: 'flat', rateValue: 200 },
    });

    expect(result.netServiceAmount).toBe(0);
    expect(result.performerReserveAmount).toBe(400);
    expect(result.commissionBaseAmount).toBe(0);
  });

  it('rejects invalid quantity and percentage boundaries', () => {
    expect(() => splitMoneyAcrossUnits(100, 0)).toThrow('Quantity must be a positive integer');
    expect(() => normalizePerformerRule({ rateType: 'percent', percent: 100.01 }))
      .toThrow('Percentage must be between 0 and 100');
  });
});

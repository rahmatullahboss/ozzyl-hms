import { describe, expect, it } from 'vitest';
import { resolvePayoutLineAmounts } from '../src/lib/performer-payout-overrides';

describe('resolvePayoutLineAmounts', () => {
  const rows = [
    { lineId: 11, calculatedAmount: 500, maximumAmount: 2000 },
    { lineId: 12, calculatedAmount: 800, maximumAmount: 2000 },
  ];

  it('keeps calculated amounts when no overrides are supplied', () => {
    expect(resolvePayoutLineAmounts(rows, [])).toEqual([
      { lineId: 11, calculatedAmount: 500, finalAmount: 500, differenceAmount: 0, overrideReason: null },
      { lineId: 12, calculatedAmount: 800, finalAmount: 800, differenceAmount: 0, overrideReason: null },
    ]);
  });

  it('resolves an increased and decreased final payout with reasons', () => {
    expect(resolvePayoutLineAmounts(rows, [
      { lineId: 11, payoutAmount: 800, reason: 'Senior performer fee' },
      { lineId: 12, payoutAmount: 600, reason: 'External hospital allocation' },
    ])).toEqual([
      { lineId: 11, calculatedAmount: 500, finalAmount: 800, differenceAmount: 300, overrideReason: 'Senior performer fee' },
      { lineId: 12, calculatedAmount: 800, finalAmount: 600, differenceAmount: -200, overrideReason: 'External hospital allocation' },
    ]);
  });

  it('requires a reason when the payout differs', () => {
    expect(() => resolvePayoutLineAmounts(rows, [{ lineId: 11, payoutAmount: 800 }]))
      .toThrow('Override reason is required for line 11');
  });

  it('rejects duplicate and unknown override lines', () => {
    expect(() => resolvePayoutLineAmounts(rows, [
      { lineId: 11, payoutAmount: 600, reason: 'One' },
      { lineId: 11, payoutAmount: 700, reason: 'Two' },
    ])).toThrow('Duplicate payout override for line 11');
    expect(() => resolvePayoutLineAmounts(rows, [
      { lineId: 99, payoutAmount: 700, reason: 'Unknown line' },
    ])).toThrow('Payout override line 99 is not selected');
  });

  it('rejects non-positive and above-service payout amounts', () => {
    expect(() => resolvePayoutLineAmounts(rows, [
      { lineId: 11, payoutAmount: 0, reason: 'Invalid' },
    ])).toThrow('Payout amount must be positive for line 11');
    expect(() => resolvePayoutLineAmounts(rows, [
      { lineId: 11, payoutAmount: 2100, reason: 'Too high' },
    ])).toThrow('Payout amount exceeds service amount for line 11');
  });

  it('normalizes an unchanged amount as no override', () => {
    expect(resolvePayoutLineAmounts(rows, [
      { lineId: 11, payoutAmount: 500, reason: 'Ignored' },
    ])[0]).toEqual({
      lineId: 11,
      calculatedAmount: 500,
      finalAmount: 500,
      differenceAmount: 0,
      overrideReason: null,
    });
  });
});

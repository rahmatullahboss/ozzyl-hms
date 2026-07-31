import { describe, expect, it } from 'vitest';
import { allocateCompensationSettlement } from '../../src/lib/canonical/compensation-settlement-allocation';

describe('canonical compensation settlement allocation', () => {
  it('distributes net cash proportionally while keeping every selected accrual reversible', () => {
    expect(allocateCompensationSettlement([10000, 10000], 5000)).toEqual([
      { grossMinor: 10000, adjustmentMinor: 7500, allocationMinor: 2500 },
      { grossMinor: 10000, adjustmentMinor: 7500, allocationMinor: 2500 },
    ]);
  });

  it('preserves exact gross amounts when there is no deduction', () => {
    expect(allocateCompensationSettlement([1250, 875], 2125)).toEqual([
      { grossMinor: 1250, adjustmentMinor: 0, allocationMinor: 1250 },
      { grossMinor: 875, adjustmentMinor: 0, allocationMinor: 875 },
    ]);
  });

  it('uses stable largest-remainder ordering for uneven amounts', () => {
    const result = allocateCompensationSettlement([20000, 10000, 5000], 17500);
    expect(result).toEqual([
      { grossMinor: 20000, adjustmentMinor: 10000, allocationMinor: 10000 },
      { grossMinor: 10000, adjustmentMinor: 5000, allocationMinor: 5000 },
      { grossMinor: 5000, adjustmentMinor: 2500, allocationMinor: 2500 },
    ]);
  });

  it('rejects a net amount too small to retain one minor unit per accrual', () => {
    expect(() => allocateCompensationSettlement([100, 100], 1)).toThrow(
      'Net settlement amount must retain at least one minor unit per accrual',
    );
  });
});

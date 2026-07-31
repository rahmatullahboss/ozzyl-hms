import { describe, expect, it } from 'vitest';
import { allocateWholeTaka, getDividendEligibleTypes } from '../src/lib/shareholder-distribution';

describe('shareholder distribution helpers', () => {
  it('defaults dividend eligibility to ownership/profit classes and excludes doctors', () => {
    expect(getDividendEligibleTypes({})).toEqual(['owner', 'profit', 'investor', 'shareholder']);
  });

  it('parses configured eligible types, deduplicates them, and ignores invalid values', () => {
    expect(getDividendEligibleTypes({ dividend_eligible_types: 'owner,doctor,owner,staff,profit' })).toEqual(['owner', 'doctor', 'profit']);
  });

  it('falls back to defaults when configured eligible types are invalid', () => {
    expect(getDividendEligibleTypes({ dividend_eligible_types: 'staff,visitor' })).toEqual(['owner', 'profit', 'investor', 'shareholder']);
  });

  it('allocates whole taka deterministically and reconciles to the pool', () => {
    const allocation = allocateWholeTaka(100, [
      { id: 2, weight: 1 },
      { id: 1, weight: 1 },
      { id: 3, weight: 1 },
    ]);

    expect([...allocation.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 34],
      [2, 33],
      [3, 33],
    ]);
    expect([...allocation.values()].reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it('ignores zero and negative weights without over-allocating', () => {
    const allocation = allocateWholeTaka(101, [
      { id: 1, weight: 0 },
      { id: 2, weight: -5 },
      { id: 3, weight: 10 },
    ]);

    expect(allocation.get(1)).toBe(0);
    expect(allocation.get(2)).toBe(0);
    expect(allocation.get(3)).toBe(101);
  });
});

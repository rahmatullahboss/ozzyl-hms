import { describe, expect, it } from 'vitest';
import {
  computeTodayProfit,
  profitColor,
  formatMonthlyProfit,
  aggregateStaffByDepartment,
  dateParamFor,
  UNASSIGNED_KEY,
} from './MDDashboard.helpers';

describe('computeTodayProfit — edge cases', () => {
  it('NaN propagates (signals upstream data is broken)', () => {
    expect(Number.isNaN(computeTodayProfit(NaN, 0))).toBe(true);
    expect(Number.isNaN(computeTodayProfit(0, NaN))).toBe(true);
  });

  it('Infinity stays Infinity', () => {
    expect(computeTodayProfit(Infinity, 0)).toBe(Infinity);
    expect(computeTodayProfit(-Infinity, 0)).toBe(-Infinity);
  });

  it('handles very large integers without precision loss', () => {
    expect(computeTodayProfit(Number.MAX_SAFE_INTEGER, 0)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles fractional inputs', () => {
    expect(computeTodayProfit(100.5, 50.25)).toBeCloseTo(50.25, 10);
  });
});

describe('profitColor — edge cases', () => {
  it('NaN treated as not-positive → red', () => {
    // NaN >= 0 is false, so profitColor returns the negative class.
    expect(profitColor(NaN)).toBe('text-red-600');
  });

  it('Infinity is positive → primary', () => {
    expect(profitColor(Infinity)).toBe('text-[var(--color-primary)]');
  });

  it('Negative infinity → red', () => {
    expect(profitColor(-Infinity)).toBe('text-red-600');
  });

  it('0.001 (tiny positive) is still positive', () => {
    expect(profitColor(0.001)).toBe('text-[var(--color-primary)]');
  });

  it('-0.001 is negative', () => {
    expect(profitColor(-0.001)).toBe('text-red-600');
  });
});

describe('formatMonthlyProfit — edge cases', () => {
  it('very large value does not crash', () => {
    const out = formatMonthlyProfit(1_000_000_000, '12.5');
    expect(out).toContain('12.5%');
    expect(out.startsWith('৳')).toBe(true);
  });

  it('empty margin string still produces well-formed output', () => {
    const out = formatMonthlyProfit(100, '');
    expect(out).toBe('৳100 (%)');
  });

  it('fractionDigits=2 produces 2-decimal output', () => {
    const out = formatMonthlyProfit(3500, '70', 2);
    expect(out).toContain('3,500.00');
    expect(out).toContain('70%');
  });

  it('fractionDigits=0 produces no decimals', () => {
    const out = formatMonthlyProfit(3500, '70', 0);
    expect(out).not.toContain('.');
  });
});

describe('aggregateStaffByDepartment — edge cases', () => {
  it('handles staff with whitespace-only department as unassigned', () => {
    const staff = [
      { id: 1, department: '   ' },
      { id: 2, department: 'ICU' },
    ];
    const result = aggregateStaffByDepartment(staff);
    const byKey = Object.fromEntries(result);
    expect(byKey['ICU']).toBe(1);
    expect(byKey[UNASSIGNED_KEY]).toBe(1);
  });

  it('handles staff with undefined and null department alike', () => {
    const staff = [
      { id: 1, department: undefined },
      // @ts-expect-error — testing runtime tolerance of null even though the type says undefined
      { id: 2, department: null },
    ];
    const result = aggregateStaffByDepartment(staff);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe(UNASSIGNED_KEY);
    expect(result[0][1]).toBe(2);
  });

  it('handles very large staff lists (1000 entries, 5 departments)', () => {
    const staff: Array<{ id: number; department: string }> = [];
    for (let i = 0; i < 1000; i++) {
      staff.push({ id: i, department: `D${i % 5}` });
    }
    const result = aggregateStaffByDepartment(staff);
    // Each department has 200 staff; sort is stable enough to return all 5.
    expect(result).toHaveLength(5);
    for (const [, count] of result) {
      expect(count).toBe(200);
    }
  });

  it('topN=0 returns empty array', () => {
    const staff = [{ id: 1, department: 'A' }];
    expect(aggregateStaffByDepartment(staff, 0)).toEqual([]);
  });

  it('topN=1 returns only the highest-count department', () => {
    const staff = [
      { id: 1, department: 'A' },
      { id: 2, department: 'B' },
      { id: 3, department: 'B' },
    ];
    expect(aggregateStaffByDepartment(staff, 1)).toEqual([['B', 2]]);
  });

  it('preserves case-sensitivity in department names (no implicit folding)', () => {
    const staff = [
      { id: 1, department: 'ICU' },
      { id: 2, department: 'icu' },
    ];
    const result = aggregateStaffByDepartment(staff);
    expect(result).toHaveLength(2);
    expect(result.find(([d]) => d === 'ICU')?.[1]).toBe(1);
    expect(result.find(([d]) => d === 'icu')?.[1]).toBe(1);
  });

  it('handles unicode department names', () => {
    const staff = [
      { id: 1, department: 'নিবিড় পরিচর্যা' }, // ICU in Bengali
      { id: 2, department: 'বহির্বিভাগ' },     // OPD in Bengali
    ];
    const result = aggregateStaffByDepartment(staff);
    expect(result).toEqual([
      ['নিবিড় পরিচর্যা', 1],
      ['বহির্বিভাগ', 1],
    ]);
  });
});

describe('dateParamFor — edge cases', () => {
  it('year-boundary date passes through (2025-12-31 → 2026-01-01 window shifts)', () => {
    expect(dateParamFor('custom', '2025-12-31')).toBe('?date=2025-12-31');
    expect(dateParamFor('custom', '2026-01-01')).toBe('?date=2026-01-01');
  });

  it('leap-day date is preserved (2024-02-29)', () => {
    expect(dateParamFor('custom', '2024-02-29')).toBe('?date=2024-02-29');
  });

  it('only whitespace is treated as empty (no param)', () => {
    // encodeURIComponent would happily encode whitespace; we don't want
    // a URL like '?date=%20%20%20' to leak to the backend.
    expect(dateParamFor('custom', '   ')).toBe('');
  });

  it('rejects special chars in a custom date instead of creating extra query parameters', () => {
    expect(dateParamFor('custom', '2026-01-15&extra=injected')).toBe('');
  });
});

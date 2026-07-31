import { describe, expect, it } from 'vitest';
import {
  aggregateStaffByDepartment,
  computeTodayProfit,
  profitColor,
  UNASSIGNED_KEY,
} from './MDDashboard.helpers';

interface StaffLike {
  id: number;
  department?: string;
}

describe('aggregateStaffByDepartment', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateStaffByDepartment([])).toEqual([]);
  });

  it('groups staff by department, counts each occurrence', () => {
    const staff: StaffLike[] = [
      { id: 1, department: 'ICU' },
      { id: 2, department: 'ICU' },
      { id: 3, department: 'ICU' },
      { id: 4, department: 'OPD' },
      { id: 5, department: 'OPD' },
      { id: 6, department: 'Lab' },
    ];
    expect(aggregateStaffByDepartment(staff)).toEqual([
      ['ICU', 3],
      ['OPD', 2],
      ['Lab', 1],
    ]);
  });

  it('places staff with missing department under the unassigned key', () => {
    const staff: StaffLike[] = [
      { id: 1, department: 'ICU' },
      { id: 2 }, // no department
      { id: 3 }, // no department
    ];
    const result = aggregateStaffByDepartment(staff);
    // ICU has 1, unassigned has 2 → unassigned sorts first. We assert both
    // rows are present and the counts are correct, regardless of how equal
    // counts are tie-broken.
    const byKey = Object.fromEntries(result);
    expect(byKey['ICU']).toBe(1);
    expect(byKey['__unassigned__']).toBe(2);
  });

  it('treats empty-string department the same as missing', () => {
    const staff: StaffLike[] = [
      { id: 1, department: '' },
      { id: 2, department: 'ICU' },
    ];
    const result = aggregateStaffByDepartment(staff);
    const byKey = Object.fromEntries(result);
    expect(byKey['ICU']).toBe(1);
    expect(byKey['__unassigned__']).toBe(1);
  });

  it('sorts departments by count descending', () => {
    const staff: StaffLike[] = [
      { id: 1, department: 'A' },
      { id: 2, department: 'B' },
      { id: 3, department: 'B' },
      { id: 4, department: 'B' },
      { id: 5, department: 'C' },
      { id: 6, department: 'C' },
    ];
    const result = aggregateStaffByDepartment(staff);
    expect(result.map(([_, count]) => count)).toEqual([3, 2, 1]);
  });

  it('caps the result at the requested top-N', () => {
    const staff: StaffLike[] = [];
    for (let i = 0; i < 7; i++) staff.push({ id: i, department: `D${i}` });
    expect(aggregateStaffByDepartment(staff, 3)).toHaveLength(3);
    expect(aggregateStaffByDepartment(staff, 3).map(([d]) => d)).toEqual(['D0', 'D1', 'D2']);
  });

  it('returns all rows when top-N exceeds unique department count', () => {
    const staff: StaffLike[] = [
      { id: 1, department: 'A' },
      { id: 2, department: 'B' },
    ];
    expect(aggregateStaffByDepartment(staff, 10)).toHaveLength(2);
  });

  it('uses default top-N of 5 when not specified', () => {
    const staff: StaffLike[] = [];
    for (let i = 0; i < 8; i++) staff.push({ id: i, department: `D${i}` });
    expect(aggregateStaffByDepartment(staff)).toHaveLength(5);
  });
});

describe('UNASSIGNED_KEY', () => {
  it('is the literal string "__unassigned__"', () => {
    expect(UNASSIGNED_KEY).toBe('__unassigned__');
  });
});

describe('computeTodayProfit', () => {
  it('returns positive value when income > expenses', () => {
    expect(computeTodayProfit(1000, 200)).toBe(800);
  });

  it('returns negative value when expenses > income', () => {
    expect(computeTodayProfit(200, 1000)).toBe(-800);
  });

  it('returns 0 when income equals expenses', () => {
    expect(computeTodayProfit(500, 500)).toBe(0);
  });

  it('treats 0 income as a valid input (returns -expenses)', () => {
    expect(computeTodayProfit(0, 300)).toBe(-300);
  });
});

describe('profitColor', () => {
  it('returns primary class for positive profit', () => {
    expect(profitColor(100)).toBe('text-[var(--color-primary)]');
  });

  it('returns primary class for zero (breakeven is not a loss)', () => {
    expect(profitColor(0)).toBe('text-[var(--color-primary)]');
  });

  it('returns red class for negative profit', () => {
    expect(profitColor(-1)).toBe('text-red-600');
  });
});

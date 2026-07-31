import { describe, expect, it } from 'vitest';
import {
  calculateCycleDay,
  enumerateInclusiveDates,
  resolveAttendanceBusinessDate,
  resolveWeekPattern,
} from '../../../src/modules/workforce-management';

describe('workforce roster domain policies', () => {
  it('wraps rotation cycle days with an offset', () => {
    expect(calculateCycleDay({
      startDate: '2026-07-01',
      targetDate: '2026-07-09',
      cycleDays: 7,
      cycleOffset: 1,
    })).toBe(3);
  });

  it('rejects an inclusive date range longer than 62 days', () => {
    expect(() => enumerateInclusiveDates('2026-07-01', '2026-09-01'))
      .toThrow('date range exceeds 62 days');
  });

  it('resolves configured alternating weekend patterns', () => {
    expect(resolveWeekPattern('1st_3rd', 1)).toBe(true);
    expect(resolveWeekPattern('1st_3rd', 2)).toBe(false);
    expect(resolveWeekPattern('1st_3rd', 3)).toBe(true);
    expect(resolveWeekPattern('2nd_4th', 2)).toBe(true);
    expect(resolveWeekPattern('2nd_4th', 3)).toBe(false);
    expect(resolveWeekPattern('2nd_4th', 4)).toBe(true);
  });

  it('maps an overnight 02:00 punch to the previous roster business date', () => {
    expect(resolveAttendanceBusinessDate({
      localDate: '2026-07-27',
      localTime: '02:00',
      shiftStartTime: '22:00',
      shiftEndTime: '06:00',
      isNightShift: true,
    })).toBe('2026-07-26');
  });

  it('keeps a normal shift punch on its local date', () => {
    expect(resolveAttendanceBusinessDate({
      localDate: '2026-07-27',
      localTime: '10:00',
      shiftStartTime: '08:00',
      shiftEndTime: '16:00',
      isNightShift: false,
    })).toBe('2026-07-27');
  });
});

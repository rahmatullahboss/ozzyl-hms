import { describe, expect, it } from 'vitest';
import { appendDashboardPeriod, dashboardPeriodQuery, periodForRange, singleDayPeriod } from './dashboardPeriod';

describe('dashboardPeriod', () => {
  it('creates a single-day reporting period', () => {
    expect(singleDayPeriod('2026-07-17')).toEqual({
      startDate: '2026-07-17',
      endDate: '2026-07-17',
      label: '2026-07-17',
    });
  });

  it('serializes inclusive from/to dates without losing existing query parameters', () => {
    const period = { startDate: '2026-07-01', endDate: '2026-07-17', label: '1–17 July 2026' };
    expect(dashboardPeriodQuery(period)).toBe('?from=2026-07-01&to=2026-07-17');
    expect(appendDashboardPeriod('/api/ip-billing/stats?page=2', period))
      .toBe('/api/ip-billing/stats?page=2&from=2026-07-01&to=2026-07-17');
  });

  it('resolves today, 7d, 30d, and custom periods inclusively', () => {
    expect(periodForRange('today', '', '', '2026-07-17')).toMatchObject({ startDate: '2026-07-17', endDate: '2026-07-17' });
    expect(periodForRange('7d', '', '', '2026-07-17')).toMatchObject({ startDate: '2026-07-11', endDate: '2026-07-17' });
    expect(periodForRange('30d', '', '', '2026-07-17')).toMatchObject({ startDate: '2026-06-18', endDate: '2026-07-17' });
    expect(periodForRange('custom', '2026-07-01', '2026-07-10', '2026-07-17')).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-10' });
  });

  it('rejects malformed and reversed periods', () => {
    expect(() => dashboardPeriodQuery({ startDate: '17-07-2026', endDate: '2026-07-17', label: 'bad' })).toThrow(/YYYY-MM-DD/);
    expect(() => dashboardPeriodQuery({ startDate: '2026-07-18', endDate: '2026-07-17', label: 'bad' })).toThrow(/startDate/);
    expect(() => periodForRange('custom', '2026-07-18', '2026-07-17', '2026-07-17')).toThrow(/startDate/);
  });
});

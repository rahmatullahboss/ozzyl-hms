import { describe, expect, it } from 'vitest';
import { resolveExecutiveDashboardPeriod } from '../../src/lib/executive-dashboard-period';

describe('resolveExecutiveDashboardPeriod', () => {
  it('resolves this month through the supplied Bangladesh-local today', () => {
    expect(resolveExecutiveDashboardPeriod({ preset: 'this_month', today: '2026-07-12' })).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-12',
      label: '2026-07-01 → 2026-07-12',
      preset: 'this_month',
    });
  });

  it('resolves the full previous calendar month', () => {
    expect(resolveExecutiveDashboardPeriod({ preset: 'last_month', today: '2026-07-12' })).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      label: '2026-06-01 → 2026-06-30',
      preset: 'last_month',
    });
  });

  it('resolves a Monday-based current week', () => {
    expect(resolveExecutiveDashboardPeriod({ preset: 'this_week', today: '2026-07-12' })).toEqual({
      startDate: '2026-07-06',
      endDate: '2026-07-12',
      label: '2026-07-06 → 2026-07-12',
      preset: 'this_week',
    });
  });

  it('keeps the legacy single-date parameter as a one-day period', () => {
    expect(resolveExecutiveDashboardPeriod({ date: '2026-07-03', today: '2026-07-12' })).toEqual({
      startDate: '2026-07-03',
      endDate: '2026-07-03',
      label: '2026-07-03',
      preset: 'custom',
    });
  });

  it('accepts an inclusive custom date range up to 366 calendar days', () => {
    const result = resolveExecutiveDashboardPeriod({
      preset: 'custom',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      today: '2026-07-12',
    });

    expect(result).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      label: '2024-01-01 → 2024-12-31',
      preset: 'custom',
    });
  });

  it('keeps a valid future custom period so analytics return an explicit empty result', () => {
    expect(resolveExecutiveDashboardPeriod({
      preset: 'custom',
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      today: '2026-07-12',
    })).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      label: '2026-08-01',
      preset: 'custom',
    });
  });

  it.each([
    { preset: 'custom', startDate: '2026-07-31', endDate: '2026-07-01' },
    { preset: 'custom', startDate: 'bad', endDate: '2026-07-01' },
    { preset: 'custom', startDate: '2026-07-01', endDate: '2026-02-30' },
    { preset: 'custom', startDate: '2024-01-01', endDate: '2025-01-01' },
    { preset: 'unknown' },
  ])('rejects invalid period input %#', (input) => {
    expect(resolveExecutiveDashboardPeriod({ ...input, today: '2026-07-12' })).toBeNull();
  });
});

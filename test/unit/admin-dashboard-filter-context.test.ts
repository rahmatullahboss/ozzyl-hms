import { describe, expect, it } from 'vitest';
import { resolveDashboardFilterContext } from '../../src/lib/dashboard/filter-context';

describe('admin dashboard filter context', () => {
  const today = '2026-07-27';

  it.each([
    ['today', '2026-07-27', '2026-07-27'],
    ['yesterday', '2026-07-26', '2026-07-26'],
    ['this_week', '2026-07-27', '2026-07-27'],
    ['this_month', '2026-07-01', '2026-07-27'],
    ['last_month', '2026-06-01', '2026-06-30'],
    ['7d', '2026-07-21', '2026-07-27'],
    ['30d', '2026-06-28', '2026-07-27'],
  ])('normalizes %s in Asia/Dhaka', (preset, startDate, endDate) => {
    const result = resolveDashboardFilterContext({ preset, today });
    expect(result?.period).toMatchObject({ startDate, endDate });
    expect(result?.timeZone).toBe('Asia/Dhaka');
  });

  it('accepts an inclusive 366-day custom period and rejects 367 days', () => {
    expect(resolveDashboardFilterContext({
      preset: 'custom',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      today,
    })).not.toBeNull();

    expect(resolveDashboardFilterContext({
      preset: 'custom',
      startDate: '2024-01-01',
      endDate: '2025-01-01',
      today,
    })).toBeNull();
  });

  it('resolves an equal-duration previous-period comparison', () => {
    const result = resolveDashboardFilterContext({
      preset: 'custom',
      startDate: '2026-07-21',
      endDate: '2026-07-27',
      comparisonMode: 'previous_period',
      today,
    });

    expect(result?.comparisonPeriod).toEqual({
      startDate: '2026-07-14',
      endDate: '2026-07-20',
      label: '2026-07-14 → 2026-07-20',
    });
  });

  it('resolves previous-month comparison using full calendar months', () => {
    const result = resolveDashboardFilterContext({
      preset: 'this_month',
      comparisonMode: 'previous_month',
      today,
    });

    expect(result?.comparisonPeriod).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      label: '2026-06-01 → 2026-06-30',
    });
  });

  it('rejects invalid custom dates, invalid ids, and unknown date basis', () => {
    expect(resolveDashboardFilterContext({ preset: 'custom', startDate: '2026-07-01', today })).toBeNull();
    expect(resolveDashboardFilterContext({ preset: 'custom', startDate: '2026-07-31', endDate: '2026-07-01', today })).toBeNull();
    expect(resolveDashboardFilterContext({ preset: 'today', doctorId: '0', today })).toBeNull();
    expect(resolveDashboardFilterContext({ preset: 'today', branchId: '1.5', today })).toBeNull();
    expect(resolveDashboardFilterContext({ preset: 'today', dateBasis: 'created_date', today })).toBeNull();
  });

  it('normalizes valid identifiers and role preset', () => {
    const result = resolveDashboardFilterContext({
      preset: 'today',
      doctorId: '17',
      branchId: '3',
      departmentId: '8',
      dateBasis: 'service_date',
      rolePreset: 'hospital_admin',
      today,
    });

    expect(result?.request).toMatchObject({
      doctorId: 17,
      branchId: 3,
      departmentId: 8,
      dateBasis: 'service_date',
      rolePreset: 'hospital_admin',
    });
  });
});

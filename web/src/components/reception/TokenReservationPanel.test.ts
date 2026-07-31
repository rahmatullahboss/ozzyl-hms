import { describe, it, expect } from 'vitest';
import {
  isAlwaysEnd,
  addDaysISO,
  daysBetweenInclusive,
} from './TokenReservationPanel';

describe('isAlwaysEnd', () => {
  it('returns true for null and undefined', () => {
    expect(isAlwaysEnd(null)).toBe(true);
    expect(isAlwaysEnd(undefined)).toBe(true);
  });

  it('returns true for the sentinel 2099-12-31', () => {
    expect(isAlwaysEnd('2099-12-31')).toBe(true);
  });

  it('returns false for any concrete past or future date', () => {
    expect(isAlwaysEnd('2026-06-05')).toBe(false);
    expect(isAlwaysEnd('2025-01-01')).toBe(false);
    expect(isAlwaysEnd('2099-12-30')).toBe(false);
  });
});

describe('addDaysISO', () => {
  it('adds positive days', () => {
    expect(addDaysISO('2026-06-05', 6)).toBe('2026-06-11');
  });

  it('subtracts when given negative days', () => {
    expect(addDaysISO('2026-06-05', -5)).toBe('2026-05-31');
  });

  it('handles month boundaries (forward)', () => {
    expect(addDaysISO('2026-06-28', 5)).toBe('2026-07-03');
  });

  it('handles year boundaries', () => {
    expect(addDaysISO('2026-12-30', 5)).toBe('2027-01-04');
  });

  it('handles leap year (Feb 29)', () => {
    // 2028 is a leap year
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('handles non-leap February', () => {
    // 2027 is not a leap year
    expect(addDaysISO('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('returns the same date for 0 days', () => {
    expect(addDaysISO('2026-06-05', 0)).toBe('2026-06-05');
  });
});

describe('daysBetweenInclusive', () => {
  it('returns 1 for the same day', () => {
    expect(daysBetweenInclusive('2026-06-05', '2026-06-05')).toBe(1);
  });

  it('returns 7 for a 1-week range', () => {
    expect(daysBetweenInclusive('2026-06-01', '2026-06-07')).toBe(7);
  });

  it('returns 2 for an overnight range', () => {
    expect(daysBetweenInclusive('2026-06-01', '2026-06-02')).toBe(2);
  });

  it('handles month boundaries', () => {
    expect(daysBetweenInclusive('2026-06-28', '2026-07-03')).toBe(6);
  });

  it('handles year boundaries', () => {
    expect(daysBetweenInclusive('2026-12-30', '2027-01-04')).toBe(6);
  });

  it('handles a multi-year range (Always-sentinel scenario)', () => {
    // From 2026-06-05 to 2099-12-31 is about 73.5 years
    const days = daysBetweenInclusive('2026-06-05', '2099-12-31');
    expect(days).toBeGreaterThan(26000);
    expect(days).toBeLessThan(27000);
  });

  it('treats end before start as at least 1 day (defensive floor)', () => {
    // The function is used in display only, but we should never crash on
    // inverted input.
    expect(daysBetweenInclusive('2026-06-10', '2026-06-05')).toBe(1);
  });
});

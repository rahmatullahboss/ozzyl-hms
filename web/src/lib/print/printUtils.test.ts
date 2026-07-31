import { describe, expect, it } from 'vitest';
import { formatDate } from './printUtils';

describe('print formatDate', () => {
  it('formats YYYY-MM-DD as numeric day-month-year with dashes', () => {
    expect(formatDate('2026-06-11')).toBe('11-06-2026');
  });

  it('returns dash for missing date', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatDate,
  formatDateLong,
  formatDateMedium,
  formatDateTime,
  formatDateTimeShort,
  formatTime,
  formatDurationMinutes,
} from './format';
import { formatAuditDateTimeGMT6, formatDateTimeGMT6, formatDisplayDate } from './date-utils';

// Force the en locale for deterministic assertions
vi.mock('./i18n', () => ({
  default: {
    get language() {
      return 'en';
    },
  },
}));

describe('formatCurrency', () => {
  it('formats 1500 as ৳1,500.00 in en', () => {
    expect(formatCurrency(1500)).toBe('৳1,500.00');
  });

  it('formats 0 as ৳0.00', () => {
    expect(formatCurrency(0)).toBe('৳0.00');
  });

  it('handles null and undefined as 0', () => {
    expect(formatCurrency(null)).toBe('৳0.00');
    expect(formatCurrency(undefined)).toBe('৳0.00');
  });

  it('handles NaN as ৳0.00', () => {
    expect(formatCurrency(NaN)).toBe('৳0.00');
  });

  it('respects custom fractionDigits=0', () => {
    expect(formatCurrency(1500, { fractionDigits: 0 })).toBe('৳1,500');
  });

  it('formats large numbers with thousand separators', () => {
    expect(formatCurrency(1234567.89)).toBe('৳1,234,567.89');
  });

  it('formats small decimals', () => {
    expect(formatCurrency(0.5)).toBe('৳0.50');
  });

  it('formats negative amounts', () => {
    expect(formatCurrency(-1500)).toBe('৳-1,500.00');
  });
});

describe('formatNumber', () => {
  it('formats with thousand separators', () => {
    expect(formatNumber(1500)).toBe('1,500');
  });

  it('respects Intl.NumberFormatOptions', () => {
    expect(formatNumber(0.5, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe('0.50');
  });
});

describe('formatPercent', () => {
  it('formats with default 1 decimal', () => {
    expect(formatPercent(23.456)).toBe('23.5%');
  });

  it('respects custom fractionDigits', () => {
    expect(formatPercent(60, 0)).toBe('60%');
    expect(formatPercent(99.99, 2)).toBe('99.99%');
  });
});

describe('formatDate', () => {
  it('formats ISO date string as numeric day-month-year', () => {
    expect(formatDate('2026-06-11T10:00:00Z')).toBe('11-06-2026');
  });

  it('returns — for null/undefined', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('returns — for invalid date', () => {
    expect(formatDate('not a date')).toBe('—');
  });
});

describe('formatDateLong', () => {
  it('includes weekday', () => {
    const result = formatDateLong('2026-06-11T10:00:00Z');
    expect(result).toMatch(/2026/);
    // Should include weekday name (Thursday or similar)
    expect(result.length).toBeGreaterThan(15);
  });
});

describe('formatDateMedium', () => {
  it('formats with month abbreviation', () => {
    const result = formatDateMedium('2026-06-11T10:00:00Z');
    expect(result).toContain('2026');
    expect(result.length).toBeGreaterThan(8);
  });
});

describe('formatDateTime', () => {
  it('formats with numeric day-month-year and 12-hour time', () => {
    expect(formatDateTime('2026-06-11T15:45:00Z')).toContain('11-06-2026');
    expect(formatDateTime('2026-06-11T15:45:00Z')).toMatch(/PM/);
  });

  it('returns — for null', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatDateTimeShort', () => {
  it('formats with numeric day-month-year and 12-hour time', () => {
    const result = formatDateTimeShort('2026-06-11T15:45:00Z');
    expect(result).toContain('11-06-2026');
    expect(result).toMatch(/PM/);
  });
});

describe('formatTime', () => {
  it('extracts just the time portion in 12-hour format', () => {
    expect(formatTime('2026-06-11T15:45:00Z')).toMatch(/PM/);
  });

  it('treats naive database timestamps as UTC and converts to Asia/Dhaka', () => {
    // SQLite's `datetime('now')` stores naive UTC. '2026-06-19 22:23:36' UTC → '2026-06-20 04:23:36' BD.
    expect(formatTime('2026-06-19 22:23:36')).toBe('4:23 AM');
    expect(formatDateTime('2026-06-19 22:23:36')).toContain('20-06-2026');
    expect(formatDateTime('2026-06-19 22:23:36')).toContain('4:23 AM');
  });

  it('returns — for null', () => {
    expect(formatTime(null)).toBe('—');
  });
});

describe('Bangladesh timestamp utilities', () => {
  it('formats audit timestamps with numeric date-month-year and 12-hour time', () => {
    expect(formatAuditDateTimeGMT6('2026-06-19 22:23:36', 'en')).toBe('20-06-2026, 04:23 AM');
  });

  it('formats GMT+6 timestamps with numeric day-month-year and 12-hour time', () => {
    expect(formatDateTimeGMT6('2026-06-19 22:23:36')).toBe('19-06-2026 10:23:36 PM');
  });

  it('formats display dates as DD-MM-YYYY', () => {
    expect(formatDisplayDate('2026-06-19')).toBe('19-06-2026');
  });
});

describe('formatDurationMinutes', () => {
  it('formats 0 as 0m', () => {
    expect(formatDurationMinutes(0)).toBe('0m');
  });

  it('formats sub-hour as just minutes', () => {
    expect(formatDurationMinutes(30)).toBe('30m');
    expect(formatDurationMinutes(45)).toBe('45m');
  });

  it('formats exact hour as just hours', () => {
    expect(formatDurationMinutes(60)).toBe('1h');
    expect(formatDurationMinutes(120)).toBe('2h');
  });

  it('formats hours and minutes', () => {
    expect(formatDurationMinutes(90)).toBe('1h 30m');
    expect(formatDurationMinutes(125)).toBe('2h 5m');
  });
});

describe('bn locale (Bengali)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('formats currency with Bengali numerals', async () => {
    vi.doMock('./i18n', () => ({
      default: { get language() { return 'bn'; } },
    }));
    const { formatCurrency: formatBn } = await import('./format');
    // Bengali numerals: ১,৫০০.০০
    const result = formatBn(1500);
    expect(result).toContain('৳');
    expect(result).toContain('১,৫০০');
  });
});

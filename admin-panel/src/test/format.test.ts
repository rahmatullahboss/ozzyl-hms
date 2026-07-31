import { describe, it, expect } from 'vitest';
import { formatBDT, formatBDTLakh, formatDate } from '../lib/format';

describe('formatBDT', () => {
  it('formats a non-zero amount with the ৳ prefix and en-BD grouping', () => {
    expect(formatBDT(1500)).toMatch(/৳/);
    expect(formatBDT(1500)).toMatch(/1,500|1\.500/);
  });

  it('formats zero as ৳0', () => {
    expect(formatBDT(0)).toMatch(/৳/);
    expect(formatBDT(0)).toMatch(/0/);
  });

  it('handles large numbers without breaking (no lakh shorthand)', () => {
    const out = formatBDT(12_345_678);
    expect(out).toMatch(/৳/);
    // Should be 12,345,678 or 12.345.678, NOT "1.2 Cr"
    expect(out).not.toMatch(/Cr/);
  });
});

describe('formatBDTLakh', () => {
  it('renders the lakh shorthand for amounts > 100k', () => {
    expect(formatBDTLakh(150000)).toBe('৳1.5L');
  });

  it('falls back to formatBDT for amounts under 100k', () => {
    expect(formatBDTLakh(50000)).toBe('৳50,000');
  });
});

describe('formatDate', () => {
  it('renders an en-BD date with the year, month, and day', () => {
    const out = formatDate('2026-05-12T08:00:00Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/May/);
    expect(out).toMatch(/12/);
  });

  it('returns "-" for falsy input', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
  });
});

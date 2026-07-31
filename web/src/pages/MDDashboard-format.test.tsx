import { describe, expect, it } from 'vitest';
import { formatMonthlyProfit } from './MDDashboard.helpers';

describe('formatMonthlyProfit', () => {
  it('combines the currency value with the margin percentage', () => {
    // formatCurrency('en') emits "৳3,500" (with the Taka prefix and a thousand
    // separator) when fractionDigits=0. We assert the *value* is present by
    // stripping the prefix and commas before matching.
    const out = formatMonthlyProfit(3500, '70');
    const numeric = out.replace(/[৳,%\s]/g, '');
    expect(numeric).toContain('3500');
    expect(numeric).toContain('70');
  });

  it('handles 0 profit with 0% margin', () => {
    const out = formatMonthlyProfit(0, '0');
    expect(out).toContain('0');
  });

  it('handles negative profit', () => {
    const out = formatMonthlyProfit(-500, '-10');
    const numeric = out.replace(/[৳,%\s]/g, '');
    expect(numeric).toContain('500');
    expect(numeric).toContain('-10');
  });

  it('keeps the percentage a string (margin comes from the API as string)', () => {
    const out = formatMonthlyProfit(1000, '23.5');
    expect(out).toContain('23.5%');
  });
});

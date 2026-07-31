import { describe, expect, it } from 'vitest';
import { formatMonthlyProfit } from './MDDashboard.helpers';

describe('formatMonthlyProfit — visual shape', () => {
  it('starts with the Taka prefix', () => {
    expect(formatMonthlyProfit(1000, '10').startsWith('৳')).toBe(true);
  });

  it('has the percent sign somewhere after the value', () => {
    const out = formatMonthlyProfit(1000, '10');
    expect(out).toContain('%');
  });

  it('uses parentheses around the margin', () => {
    const out = formatMonthlyProfit(1000, '10');
    const open = out.indexOf('(');
    const close = out.indexOf(')');
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
  });

  it('keeps numeric value visible after stripping formatting chars', () => {
    const out = formatMonthlyProfit(1234567, '12.34');
    const numeric = out.replace(/[৳,()%\s-]/g, '');
    expect(numeric).toContain('1234567');
    expect(numeric).toContain('12.34');
  });

  it('handles zero profit (no NaN)', () => {
    const out = formatMonthlyProfit(0, '0');
    expect(out).not.toMatch(/NaN/);
    expect(out).toMatch(/৳/);
  });

  it('handles negative profit', () => {
    const out = formatMonthlyProfit(-100, '-20');
    // formatCurrency emits "৳-100" — the minus is part of the number, not a
    // separate token. Just assert the output mentions the values.
    expect(out).toMatch(/-100/);
    expect(out).toMatch(/-20/);
  });
});

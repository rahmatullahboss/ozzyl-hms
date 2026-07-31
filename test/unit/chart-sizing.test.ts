import { describe, expect, it } from 'vitest';
import { shouldRenderMeasuredChart } from '../../web/src/lib/chartSizing';

describe('chartSizing', () => {
  it('returns false for zero or negative dimensions', () => {
    expect(shouldRenderMeasuredChart(-1, -1)).toBe(false);
    expect(shouldRenderMeasuredChart(0, 120)).toBe(false);
    expect(shouldRenderMeasuredChart(320, 0)).toBe(false);
  });

  it('returns true only when both dimensions are positive', () => {
    expect(shouldRenderMeasuredChart(1, 1)).toBe(true);
    expect(shouldRenderMeasuredChart(320, 220)).toBe(true);
  });
});
